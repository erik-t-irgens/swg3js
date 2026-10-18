// Another player's grappling hook, on this side (the design's §3.15, wave 4): their rope and their dart, drawn from
// their drawn left hand on the one material every rope in the game uses, their arm raised up the line, and the
// clank, the bite and the let-go heard at that hand. Nothing of it hurts anybody and nothing is ever put on a vehicle:
// it is a picture of what their own game is doing.
//
// What comes off the wire is their state's `gr` and `grf`, which the peers read into one kept record a peer
// (`src/net/peerRope.ts`) and hand on in the view. Every point of a held rope is a world point as their screen drew it;
// those world points are glided toward each new state at the figure's own rate (`PEER_GLIDE`), so a rope runs from a
// glided hand to an anchor glided the same way and keeps its true length, and they are snapped, not eased, on the first
// state and whenever the count of points changes -- bends come and go at the player's end, so the anchor's place in
// the list never moves. A point that rides a third player's vehicle (`grf`) is put on this browser's own picture of
// that vehicle (`framePose`, the rider's real vehicle on the rider's own browser), which is where this browser draws the
// hull, so the rope's end stays on it; one whose vehicle is not shown here draws its world point, glided.
//
// The dart in flight is flown on from where the last state put it by the velocity it carried, at most `peerLead` past
// that state, and stopped where a ray in this world says it struck (`cast`). The free span is hung by the slack the
// sender worked out (its figure here stands up to a quarter of a metre inside a taut rope, which drawn by its own
// length would droop a twenty metre rope by over a metre) and drawn straight inside the taut band.
//
// Nothing is built while playing: a peer's ribbon is a `RopeRibbon` and its dart a `dartMesh`, on the material the
// player's own were built with behind every loading screen, and three keys a program on the material and the
// attributes, not on the geometry object. A peer who leaves hands their ribbon on to the next one rather than
// disposing it. With nobody roping, a frame costs one look at a list.
//
// This module knows nothing about the socket. It listens to the peers through their own watcher (`watchPeers`): told
// once a frame after every figure and picture has been placed (`peerMoved`), which is where a point on a vehicle is
// resolved and the arm aimed; the laying of the ribbon waits for the camera, at the point in the frame the player's own
// rope is laid (`draw`).
import * as THREE from 'three';
import { GRAPPLE_TUNE } from '../player/grapple.ts';
import { RopeRibbon, dartMesh } from '../player/grappleDraw.ts';
import { armAimFor } from '../player/grappleMath.ts';
import { PEER_GLIDE } from '../player/grappleFrames.ts';
import { markActor } from '../world/portalRender.ts';
import { PEER_ROPE_POINTS, PEER_ROPE_TUNE, type PeerRope } from './peerRope.ts';
import { watchPeers, type PeerWatcher } from './remotePlayers.ts';

/** As much of a peer's rig as the rope needs: the left hand it hangs from, and the arm it raises. `CharacterRig` is one. */
export interface RopeRig {
  readonly root: THREE.Object3D;
  boneFor(role: 'leftHand'): THREE.Object3D | null;
  aimArm(side: 'left', dir: THREE.Vector3, roll?: number, weight?: number): void;
}

/** One peer as the ropes read them: the peers' own `PeerView` satisfies it as it stands. */
export interface PeerRopeView {
  id: number;
  /** Drawn here at all: on this world, not in a jump, and heard from. */
  shown: boolean;
  /** Their own browser says they are down: nothing of theirs is drawn. */
  down: boolean;
  /** Their figure's group: its origin is their drawn feet, its turn theirs, leaning included. */
  group: THREE.Object3D;
  rig: RopeRig | null;
  rope: PeerRope;
}

/** Renderers kept for the next peer when one leaves, past which they are let go (their geometry only: the material is everyone's). */
const SPARE = 4;

/** One peer's rope as this side draws it. Everything in it is kept: a frame writes in place. */
interface RopeRecord {
  id: number;
  /** Told where they are since the last draw. */
  moved: boolean;
  /** Shown and standing, this frame and the frame before (a rope first seen already out plays no sound). */
  shown: boolean;
  wasShown: boolean;
  group: THREE.Object3D | null;
  rig: RopeRig | null;
  /** As drawn: -1 none, 0 the dart, 1 a rope; how many points, the slack sent, and the record's own count of states read. */
  kind: number;
  count: number;
  slack: number;
  heard: number;
  heardAt: number;
  /** The world points as last heard, as glided, and as drawn (glided, with each point on a shown vehicle put on it). */
  readonly target: Float64Array;
  readonly glided: Float64Array;
  readonly drawn: Float64Array;
  snap: boolean;
  /** The points riding another player's vehicle, as last heard, and which of them were put on one this frame. */
  frames: number;
  readonly frameId: Int32Array;
  readonly frameIndex: Int32Array;
  readonly frameLocal: Float64Array;
  readonly onFrame: Uint8Array;
  /** The dart's velocity as last heard, and where it is drawn this frame. */
  readonly vel: Float64Array;
  readonly dartAt: Float64Array;
  /** The left arm up the rope: how much of it, eased in and out as the player's own is, and the way it last pointed. */
  armWeight: number;
  readonly armDir: THREE.Vector3;
  ribbon: RopeRibbon | null;
  dart: THREE.Mesh | null;
}

const AXIS_Z = new THREE.Vector3(0, 0, 1);
const hand = new THREE.Vector3();
const ropePoint = new THREE.Vector3();
const dir = new THREE.Vector3();
const local = new THREE.Vector3();
const aimed = { x: 0, y: 0, z: 0 };
const turn = new THREE.Quaternion();
const posePos = new THREE.Vector3();
const poseQuat = new THREE.Quaternion();

/**
 * Every peer's rope. One of these exists for the life of the page: it listens to the peers, is told the frame's step
 * once before they are moved (`tick`), and is asked once a frame to lay what it gathered.
 */
export class RemoteRopes implements PeerWatcher {
  private readonly records = new Map<number, RopeRecord>();
  /** The same records as a list, walked by index in a frame (a map's iterator is an object). */
  private readonly live: RopeRecord[] = [];
  private readonly spares: { ribbon: RopeRibbon; dart: THREE.Mesh }[] = [];
  private dt = 0;
  /** How many ribbons have ever been built: it climbs when somebody first ropes and then stands still. */
  private made = 0;
  /** Stops listening to the peers again; set once by the one that listens for the page. */
  private unwatch: (() => void) | null = null;

  /**
   * Where the vehicle of the player with this relay id stands here (`RemotePlayers.framePose`): their real vehicle on
   * their own browser, this browser's picture of it elsewhere. Null until the game sets it, and then every point is
   * drawn as the world place sent.
   */
  framePose: ((id: number, pos: THREE.Vector3, quat: THREE.Quaternion) => boolean) | null = null;
  /**
   * How far along the segment a to b (`seg[0..2]`, `seg[3..5]`) the first thing that stands still is in this world,
   * written into `seg[6]`, which is Infinity when it is clear (`Physics.blockDistance`): what stops a peer's dart where it
   * struck. The answer goes back in the kept array rather than as a number handed back, which would be a fresh one every
   * frame a dart flies. Null until the game sets it.
   */
  cast: ((seg: Float64Array) => void) | null = null;
  /** A peer's hook heard at their hand: their dart going out, biting, and the rope let go. Null until the game sets it. */
  sound: ((what: 'fire' | 'bite' | 'letGo', x: number, y: number, z: number) => void) | null = null;

  constructor() {
    theRopes = this;
  }

  /** The frame's step, told once before the peers are moved: the glide and the arm's ease read it. */
  tick(dt: number): void {
    this.dt = dt;
    // The dart's lead, read off its table once a frame into a kept record, so the dart's own arithmetic reads a field it
    // has seen on every frame rather than a table the console can change under it.
    this.dartNow.lead = PEER_ROPE_TUNE.peerLead;
  }

  // --- what the peers tell it ----------------------------------------------------------------------------------------

  /** A peer arrived. Nothing is made: a ribbon is made the first time they hold a rope. */
  peerAdded(p: PeerRopeView): void {
    this.peerRemoved(p.id);
    this.keep(this.blank(p.id));
  }

  /**
   * Once a frame, after their figure and the picture of every vehicle have been put where they are drawn: what their
   * last state said is read in, the world points glided, each point on a shown vehicle put on it, and their arm raised up
   * the line. The ribbon is laid in `draw`, with the camera.
   */
  peerMoved(p: PeerRopeView): void {
    let r = this.records.get(p.id);
    if (!r) {
      r = this.blank(p.id);
      this.keep(r);
    }
    r.moved = true;
    r.wasShown = r.shown;
    r.shown = p.shown && !p.down;
    r.group = p.group;
    r.rig = p.rig;
    const rope = p.rope;
    if (rope.kind !== r.kind || rope.heard !== r.heard) this.take(r, rope);
    // Shown again after being away (another world, a jump): its points are where they are now, not glided across.
    if (r.shown && !r.wasShown) r.snap = true;
    if (r.shown && r.kind === 1) {
      this.glide(r);
      this.resolve(r);
    }
    this.aim(r);
  }

  /** A peer went: their rope leaves the scene, and its renderers wait for the next one. */
  peerRemoved(id: number): void {
    const r = this.records.get(id);
    if (!r) return;
    this.handBack(r);
    this.records.delete(id);
    const i = this.live.indexOf(r);
    if (i >= 0) this.live.splice(i, 1);
  }

  private keep(r: RopeRecord): void {
    this.records.set(r.id, r);
    this.live.push(r);
  }

  private blank(id: number): RopeRecord {
    return {
      id,
      moved: false,
      shown: false,
      wasShown: false,
      group: null,
      rig: null,
      kind: -1,
      count: 0,
      slack: 0,
      heard: 0,
      heardAt: 0,
      target: new Float64Array(3 * PEER_ROPE_POINTS),
      glided: new Float64Array(3 * PEER_ROPE_POINTS),
      drawn: new Float64Array(3 * PEER_ROPE_POINTS),
      snap: true,
      frames: 0,
      frameId: new Int32Array(PEER_ROPE_POINTS),
      frameIndex: new Int32Array(PEER_ROPE_POINTS),
      frameLocal: new Float64Array(3 * PEER_ROPE_POINTS),
      onFrame: new Uint8Array(PEER_ROPE_POINTS),
      vel: new Float64Array(3),
      dartAt: new Float64Array(3),
      armWeight: 0,
      armDir: new THREE.Vector3(0, 1, 0),
      ribbon: null,
      dart: null,
    };
  }

  /**
   * A state read in: the points, the dart's velocity and the frames copied, the glide told to snap when the kind or the
   * count of points changed, and the change heard at their hand -- unless the peer has only just been shown, whose rope
   * was out before this browser saw them.
   */
  private take(r: RopeRecord, rope: PeerRope): void {
    const was = r.kind;
    const now = rope.kind;
    if (r.shown && r.wasShown && this.sound) {
      const what = was < 0 && now === 0 ? 'fire' : now === 1 && was !== 1 ? 'bite' : was >= 0 && now < 0 ? 'letGo' : '';
      if (what) {
        this.handOf(r, hand);
        this.sound(what, hand.x, hand.y, hand.z);
      }
    }
    if (now !== was || rope.count !== r.count) r.snap = true;
    r.kind = now;
    r.count = rope.count;
    r.slack = rope.slack;
    r.heard = rope.heard;
    r.heardAt = rope.heardAt;
    const n = 3 * rope.count;
    for (let i = 0; i < n; i++) r.target[i] = rope.pts[i];
    r.vel[0] = rope.vel[0];
    r.vel[1] = rope.vel[1];
    r.vel[2] = rope.vel[2];
    r.frames = rope.frames;
    for (let i = 0; i < rope.frames; i++) {
      r.frameId[i] = rope.frameId[i];
      r.frameIndex[i] = rope.frameIndex[i];
      r.frameLocal[3 * i] = rope.frameLocal[3 * i];
      r.frameLocal[3 * i + 1] = rope.frameLocal[3 * i + 1];
      r.frameLocal[3 * i + 2] = rope.frameLocal[3 * i + 2];
    }
  }

  /** The world points eased toward the last heard at the figure's own rate, or snapped onto them. */
  private glide(r: RopeRecord): void {
    const n = 3 * r.count;
    const g = r.glided;
    const t = r.target;
    if (r.snap) {
      for (let i = 0; i < n; i++) g[i] = t[i];
      r.snap = false;
      return;
    }
    const k = 1 - Math.exp(-this.dt / PEER_GLIDE);
    for (let i = 0; i < n; i++) g[i] += (t[i] - g[i]) * k;
  }

  /** The points as drawn: the glided world points, each that rides a vehicle shown here put on that vehicle. */
  private resolve(r: RopeRecord): void {
    const n = 3 * r.count;
    const d = r.drawn;
    const g = r.glided;
    for (let i = 0; i < n; i++) d[i] = g[i];
    const on = r.onFrame;
    for (let i = 0; i < r.count; i++) on[i] = 0;
    const pose = this.framePose;
    if (!pose) return;
    for (let i = 0; i < r.frames; i++) {
      const index = r.frameIndex[i];
      if (index >= r.count || !pose(r.frameId[i], posePos, poseQuat)) continue;
      local.set(r.frameLocal[3 * i], r.frameLocal[3 * i + 1], r.frameLocal[3 * i + 2]).applyQuaternion(poseQuat).add(posePos);
      d[3 * index] = local.x;
      d[3 * index + 1] = local.y;
      d[3 * index + 2] = local.z;
      on[index] = 1;
    }
  }

  /** The rope point on their figure: their drawn feet, plus `ropeY` up their own (leaning) up. Into `out`. */
  private ropePointOf(r: RopeRecord, out: THREE.Vector3): THREE.Vector3 {
    const g = r.group;
    if (!g) return out.set(0, 0, 0);
    return out.set(0, GRAPPLE_TUNE.ropeY, 0).applyQuaternion(g.quaternion).add(g.position);
  }

  /** Their drawn left hand, where the rope leaves them, or their rope point with no rig. Into `out`. */
  private handOf(r: RopeRecord, out: THREE.Vector3): THREE.Vector3 {
    const bone = r.rig?.boneFor('leftHand') ?? null;
    if (bone) return bone.getWorldPosition(out);
    return this.ropePointOf(r, out);
  }

  /**
   * Their left arm up the rope, by the player's own rule (`armAimFor`, `armIn`, `armOut`): the way from their rope point
   * to the rope's first point (the dart while it flies), taken into the figure's own frame and laid over their pose by
   * the eased weight. After their pose, which is what `peerMoved` is.
   */
  private aim(r: RopeRecord): void {
    const T = GRAPPLE_TUNE;
    const dt = this.dt;
    const wants = r.shown && r.kind >= 0 && !!r.rig;
    if (wants) {
      if (r.armWeight < 1) r.armWeight = Math.min(1, r.armWeight + dt / T.armIn);
    } else if (r.armWeight > 0) r.armWeight = Math.max(0, r.armWeight - dt / T.armOut);
    const rig = r.rig;
    const g = r.group;
    if (!(r.armWeight > 0) || !rig || !g || !r.shown) return;
    if (r.kind >= 0) {
      const at = r.kind === 1 ? r.drawn : r.target;
      const i = r.kind === 1 ? 3 * (r.count - 1) : 0;
      this.ropePointOf(r, ropePoint);
      const dx = at[i] - ropePoint.x;
      const dy = at[i + 1] - ropePoint.y;
      const dz = at[i + 2] - ropePoint.z;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dl > 1e-4) r.armDir.set(dx / dl, dy / dl, dz / dl);
    }
    turn.copy(g.quaternion).multiply(rig.root.quaternion).invert();
    local.copy(r.armDir).applyQuaternion(turn);
    armAimFor(local.x, local.y, local.z, T, aimed);
    rig.aimArm('left', local.set(aimed.x, aimed.y, aimed.z), 0, r.armWeight);
  }

  // --- the drawing -----------------------------------------------------------------------------------------------------

  /**
   * Every peer's rope and dart laid for this frame, after their figures were moved, posed and aimed and before the frame
   * is drawn, beside the player's own: from their drawn left hand, turned to `camera`, at least the rope's least width
   * on a screen `screenH` pixels tall. `now` is the frame's own clock (ms, as the states were stamped). Nothing at all
   * runs with nobody here.
   */
  draw(camera: THREE.PerspectiveCamera, screenH: number, now: number): void {
    if (!this.live.length) return;
    for (let i = 0; i < this.live.length; i++) {
      const r = this.live[i];
      if (!r.shown || !r.moved || r.kind < 0 || !r.group) this.hide(r);
      else this.lay(r, camera, screenH, now);
      r.moved = false;
    }
  }

  /**
   * One peer's rope or dart laid, each by a method of its own so neither carries the other's arithmetic. Measured with
   * the sampling heap profiler, one method laying both made 32 bytes a frame with one peer roping and another's dart in
   * flight: the dart's lead read off the hook's tune (then 128 keys, which the engine keeps out of the object, see
   * `PEER_ROPE_TUNE`) and merged with an age worked out here came out a fresh number, and so did the lengths three's
   * `normalize` handed back.
   */
  private lay(r: RopeRecord, camera: THREE.PerspectiveCamera, screenH: number, now: number): void {
    if (!r.ribbon || !r.dart) this.give(r);
    const root = rootOf(r.group);
    if (root) {
      rehome(root, r.ribbon!.mesh);
      rehome(root, r.dart!);
    }
    this.handOf(r, hand);
    if (r.kind === 1) this.layRope(r, camera, screenH);
    else {
      this.dartNow.now = now;
      this.layDart(r, camera, screenH);
    }
    this.pointDart(r.dart!);
  }

  /** A held rope: from the anchor through every bend to the hand, hung by the slack sent; the dart bitten in at the anchor. */
  private layRope(r: RopeRecord, camera: THREE.PerspectiveCamera, screenH: number): void {
    const ribbon = r.ribbon!;
    ribbon.slack = r.slack;
    ribbon.screenH = screenH;
    ribbon.lay(r.drawn, r.count, hand, camera);
    // Bitten in along the way the rope comes to it: from the next point toward it, or from the hand.
    const d = r.drawn;
    r.dart!.position.set(d[0], d[1], d[2]);
    if (r.count > 1) dir.set(d[0] - d[3], d[1] - d[4], d[2] - d[5]);
    else dir.set(d[0] - hand.x, d[1] - hand.y, d[2] - hand.z);
  }

  /** The frame's clock for the dart, and the segment its ray is cast along (a, b, then the answer), kept: handed in fields. */
  private readonly dartNow = { now: 0.5, lead: PEER_ROPE_TUNE.peerLead };
  private readonly seg = new Float64Array(7);

  /**
   * The dart flown on from where the state put it, at most `peerLead` past it, and stopped where it struck here; the
   * line runs straight to it from the hand. Its age is held by comparisons rather than `Math.min`/`Math.max`, and the
   * ray's answer comes back in a field, since a number handed back by a call not built in is a fresh one.
   */
  private layDart(r: RopeRecord, camera: THREE.PerspectiveCamera, screenH: number): void {
    const lead = this.dartNow.lead;
    let age = (this.dartNow.now - r.heardAt) / 1000;
    if (!(age > 0)) age = 0;
    else if (age > lead) age = lead;
    const t = r.target;
    const v = r.vel;
    const a = r.dartAt;
    a[0] = t[0] + v[0] * age;
    a[1] = t[1] + v[1] * age;
    a[2] = t[2] + v[2] * age;
    const cast = this.cast;
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) * age;
    if (cast && len > 1e-4) {
      const s = this.seg;
      s[0] = t[0];
      s[1] = t[1];
      s[2] = t[2];
      s[3] = a[0];
      s[4] = a[1];
      s[5] = a[2];
      s[6] = Infinity;
      cast(s);
      if (s[6] < len) {
        const k = s[6] / len;
        a[0] = t[0] + (a[0] - t[0]) * k;
        a[1] = t[1] + (a[1] - t[1]) * k;
        a[2] = t[2] + (a[2] - t[2]) * k;
      }
    }
    const ribbon = r.ribbon!;
    ribbon.slack = 0;
    ribbon.screenH = screenH;
    ribbon.lay(a, 1, hand, camera);
    r.dart!.position.set(a[0], a[1], a[2]);
    if (v[0] * v[0] + v[1] * v[1] + v[2] * v[2] > 1e-6) dir.set(v[0], v[1], v[2]);
    else dir.set(a[0] - hand.x, a[1] - hand.y, a[2] - hand.z);
  }

  /** The dart turned to point along `dir`, made unit in line (three's `normalize` hands its length across a call). */
  private pointDart(dart: THREE.Mesh): void {
    const dl = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (dl > 1e-6) {
      dir.x /= dl;
      dir.y /= dl;
      dir.z /= dl;
      dart.quaternion.setFromUnitVectors(AXIS_Z, dir);
    }
    dart.visible = true;
  }

  /** A ribbon and a dart for a peer: a spare one if there is one, else made, hidden, on the rope's own material. */
  private give(r: RopeRecord): void {
    const spare = this.spares.pop();
    if (spare) {
      r.ribbon = spare.ribbon;
      r.dart = spare.dart;
      return;
    }
    this.made++;
    r.ribbon = new RopeRibbon(PEER_ROPE_POINTS, GRAPPLE_TUNE.sagSegments);
    r.dart = dartMesh();
    markActor(r.ribbon.mesh);
    markActor(r.dart);
  }

  private hide(r: RopeRecord): void {
    if (r.ribbon?.mesh.visible) r.ribbon.hide();
    if (r.dart?.visible) r.dart.visible = false;
  }

  /** A peer's renderers out of the scene and kept for the next one, past `SPARE` let go (their geometry: the material is everyone's). */
  private handBack(r: RopeRecord): void {
    const ribbon = r.ribbon;
    const dart = r.dart;
    r.ribbon = null;
    r.dart = null;
    if (!ribbon || !dart) return;
    ribbon.hide();
    dart.visible = false;
    ribbon.mesh.removeFromParent();
    dart.removeFromParent();
    if (this.spares.length < SPARE) this.spares.push({ ribbon, dart });
    else {
      ribbon.mesh.geometry.dispose();
      dart.geometry.dispose();
    }
  }

  /** Everything let go: the page is going. Only geometry is disposed; the material is the player's own as well. */
  dispose(): void {
    while (this.live.length) this.peerRemoved(this.live[this.live.length - 1].id);
    for (const s of this.spares) {
      s.ribbon.mesh.geometry.dispose();
      s.dart.geometry.dispose();
    }
    this.spares.length = 0;
    this.unwatch?.();
    this.unwatch = null;
    if (theRopes === this) theRopes = null;
  }

  /** Set once by the one that listens for the page, so a dispose can stop listening again. */
  listening(stop: () => void): void {
    this.unwatch = stop;
  }

  /**
   * For the console (`__debug.grapple().peers`): every peer with a rope out, its kind, its points and slack, and each
   * point riding a vehicle with whether that vehicle is shown here and where the point is drawn. Allocates freely; never
   * called in a frame.
   */
  report(): { ropes: Record<string, unknown>[]; made: number; spare: number; peerLead: number } {
    const n2 = (v: number) => Number(v.toFixed(2));
    const ropes: Record<string, unknown>[] = [];
    for (const r of this.live) {
      if (r.kind < 0) continue;
      const frames: Record<string, unknown>[] = [];
      for (let i = 0; i < r.frames; i++) {
        const k = r.frameIndex[i];
        const shown = r.kind === 1 && k < r.count && r.onFrame[k] === 1;
        frames.push({ vehicleOf: r.frameId[i], index: k, shown, drawn: [n2(r.drawn[3 * k]), n2(r.drawn[3 * k + 1]), n2(r.drawn[3 * k + 2])], sent: [n2(r.target[3 * k]), n2(r.target[3 * k + 1]), n2(r.target[3 * k + 2])] });
      }
      ropes.push({ id: r.id, kind: r.kind === 0 ? 'dart' : 'rope', points: r.count, slack: n2(r.slack), shown: r.shown, drawnHere: !!r.ribbon?.mesh.visible, armWeight: n2(r.armWeight), frames, anchor: r.kind === 1 ? [n2(r.drawn[0]), n2(r.drawn[1]), n2(r.drawn[2])] : [n2(r.dartAt[0]), n2(r.dartAt[1]), n2(r.dartAt[2])] });
    }
    return { ropes, made: this.made, spare: this.spares.length, peerLead: PEER_ROPE_TUNE.peerLead };
  }
}

/** The top of the tree a node hangs in: the scene, when it is in one. */
function rootOf(node: THREE.Object3D | null): THREE.Object3D | null {
  if (!node) return null;
  let o: THREE.Object3D = node;
  while (o.parent) o = o.parent;
  return o === node ? null : o;
}

/** A ribbon or a dart moved to the tree its peer is in now, marked as an actor there. */
function rehome(root: THREE.Object3D, o: THREE.Object3D): void {
  if (o.parent === root) return;
  root.add(o);
  markActor(o);
}

/** The one set of peer ropes, so the console can report them; let go on dispose. */
let theRopes: RemoteRopes | null = null;

/** The ropes for the console, or null before any. */
export function peerRopes(): RemoteRopes | null {
  return theRopes;
}

/**
 * The one set for the page, listening to the peers from the moment anything imports this file, as the peers' blades
 * do: the game's only words with it are the frame's step (`tick`), the one call a frame that lays what it gathered, and
 * the three seams it sets once (`framePose`, `cast`, `sound`).
 */
export const remoteRopes = new RemoteRopes();
remoteRopes.listening(watchPeers(remoteRopes));
