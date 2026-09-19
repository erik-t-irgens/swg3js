// The other players: each one a rig of its species, stood where the relay last said, gliding to
// each new place, playing the state the other's rig plays, with a name over its head.
import * as THREE from 'three';
import { CharacterRig, loadPlayerRig, type RigState } from '../player/rig';
import { markActor } from '../world/portalRender';
import { isDanceClip, isFlourishClip, loopsEmote } from '../core/emotes';
import type { Hello, PeerState, PeerVehicle } from './net';
import type { Garage } from '../vehicles/garage';
import type { WingSet } from '../vehicles/wings';
import { changedSlots, fitKey, type ResolvedFit, type ShipFit } from '../vehicles/shipFit';
import type { ShipBuild } from '../vehicles/shipMounts';
import type { ShipPaint } from '../vehicles/shipPaint';
import { applyLookPrepared } from '../player/look';
import { weaponHolder, type WeaponCatalogue } from '../player/weapons';
import type { FxMoverList } from '../core/fx/velocity';
import { RELAY, stepRelayVelocity } from '../core/fx/velocityMath.ts';

/** The vehicle a peer is on, as a picture: which, where it is heading to, and how it is turned. */
interface RemoteVehicle {
  id: string;
  obj: THREE.Object3D | null;
  target: THREE.Vector3;
  targetQ: THREE.Quaternion;
  pose: string | null;
  /** Its world velocity from the relay's messages (m/s): its glide between them is not its speed. */
  vel: THREE.Vector3;
  /** performance.now() of its last message; 0 before the first. */
  heardAt: number;
  /** Its wings that open, once the picture is in (moved as the pilot's are); null before, or for a ride with none. */
  wings: WingSet | null;
  /** Whether the pilot's wings are open or opening: the relay's `w`, else (a peer on an older build) whether it is moving. */
  wingsWant: boolean;
  /** A fitted ship's build (its parts per slot, for a restage), its paint (disposed with the picture) and the fit it shows; null before the picture is in, or for a ride without a fit. */
  build: ShipBuild | null;
  paint: ShipPaint | null;
  fit: ResolvedFit | null;
  /** A refit of the picture under way, and the newest fit asked for meanwhile (the running pass takes it up when it ends). */
  busy: Promise<void> | null;
  want: ShipFit | null;
}

interface Remote {
  id: number;
  hello: Hello;
  group: THREE.Group;
  rig: CharacterRig | null;
  label: THREE.Sprite;
  target: THREE.Vector3;
  heading: number;
  /** The figure's whole turn, when the peer sends one (aboard a hull, adrift). */
  targetQ: THREE.Quaternion | null;
  state: string;
  speed: number;
  saber: boolean;
  /** Seconds since the last state: past a while the figure stands still. */
  silent: number;
  /** The dance loop playing, to come back to after a flourish. */
  dance: string | null;
  vehicle: RemoteVehicle | null;
  /** The look last put on the rig, so a repeated hello does not dress it again. */
  lookApplied: string | null;
  /** The dress of `lookApplied` while it goes on (resolved once it is on, or given up for a newer one); null before any. */
  lookPending: Promise<void> | null;
  /** The weapons last hung in its hands (`right|left` ids), or null when they are still to be (the rack was not in yet). */
  heldApplied: string | null;
  /** The holders hung on its hand bones. */
  heldModels: THREE.Object3D[];
  /** Its world velocity from the relay's messages (m/s), for the motion blur: the glide pulses ten times a second. */
  vel: THREE.Vector3;
  /** performance.now() of its last state message. */
  heardAt: number;
}

const STATES: Set<string> = new Set(['idle', 'walk', 'run', 'air', 'seated', 'swim', 'float', 'crouch', 'crouchWalk', 'crouchWalkBack', 'stance', 'strafeLeft', 'strafeRight', 'runBack', 'walkBack', 'runSaber', 'walkSaber', 'gunIdle', 'gunWalk', 'gunRun', 'gunReadyIdle', 'gunReadyWalk', 'gunReadyRun', 'gunAimIdle', 'gunAimWalk', 'gunAimRun', 'kneel', 'prone', 'proneMove']);

export class RemotePlayers {
  private readonly remotes = new Map<number, Remote>();
  /** The world the local player is on: peers elsewhere are kept but not shown. */
  private planet = '';
  private zone: string | undefined;

  /** The garage, for the vehicles the peers ride (loaded the first time one is seen). */
  private garage: Promise<Garage> | null = null;

  /** Called with a peer's rig once it is dressed, and again when their look changes: the motion blur prepares its shaders for it. */
  onDressed: ((root: THREE.Object3D) => void) | null = null;
  /** The weapons rack, for the weapons the peers hold (null until it is in). */
  weapons: (() => WeaponCatalogue | null) | null = null;
  /** Compile something of a peer's before it is shown (the world's actor preparation and the motion blur's). */
  prepare: ((root: THREE.Object3D) => Promise<void>) | null = null;
  /** Compile a peer's ride before it is shown (the world's vehicle preparation); set by the game after construction, read when a ride arrives. */
  prepareVehicle: ((roots: THREE.Object3D[]) => Promise<void>) | null = null;
  /** Take a peer's ship's paint copies out of the world's material sets when they go (World.forgetMaterials); set by the game after construction, read when a paint is made. */
  forget: ((materials: THREE.Material[]) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly baseUrl: string,
    private readonly loadGarage: () => Promise<Garage>,
  ) {}

  get count(): number {
    return this.remotes.size;
  }

  /** How many are on this world, and their names. */
  here(): string[] {
    return [...this.remotes.values()].filter((r) => this.sameWorld(r.hello)).map((r) => r.hello.name);
  }

  setWorld(planet: string, zone: string | undefined): void {
    this.planet = planet;
    this.zone = zone;
    for (const r of this.remotes.values()) r.group.visible = this.sameWorld(r.hello);
  }

  private sameWorld(h: Hello): boolean {
    return h.planet === this.planet && (h.zone ?? undefined) === this.zone;
  }

  add(id: number, hello: Hello): void {
    this.remove(id);
    const group = new THREE.Group();
    group.visible = this.sameWorld(hello);
    const label = makeLabel(hello.name);
    label.position.y = 2.15;
    group.add(label);
    this.scene.add(group);
    markActor(group);
    const remote: Remote = { id, hello, group, rig: null, label, target: new THREE.Vector3(0, -1000, 0), heading: 0, targetQ: null, state: 'idle', speed: 0, saber: false, silent: 0, dance: null, vehicle: null, lookApplied: null, lookPending: null, heldApplied: null, heldModels: [], vel: new THREE.Vector3(), heardAt: 0 };
    this.remotes.set(id, remote);
    void this.dress(remote);
  }

  /** The rig of the peer's species, put under its group once it loads (the placeholder is nothing meanwhile). */
  private async dress(remote: Remote): Promise<void> {
    const species = remote.hello.species;
    try {
      const rig = await loadPlayerRig(this.baseUrl, species);
      if (this.remotes.get(remote.id) !== remote || remote.hello.species !== species) return;
      rig.root.scale.setScalar(rig.scale);
      // Hidden until its look is on and its shaders compiled, as a fighter is: the first sight of a
      // peer must not be a stall.
      rig.root.visible = false;
      remote.group.add(rig.root);
      markActor(rig.root);
      remote.rig = rig;
      // A new rig wears nothing of the old one's: its look goes on afresh, even when the look is the same.
      remote.lookApplied = null;
      remote.lookPending = null;
      remote.heldApplied = null;
      remote.heldModels = [];
      remote.rig.setState('idle');
      try {
        await this.applyLook(remote);
        // A newer look that arrived meanwhile is still going on (the first gave way to it): the rig
        // waits for the last one, or it would show in the pack's default dress for a moment.
        await this.lookSettled(remote, rig);
        if (remote.rig === rig) await (this.prepare ?? noPrepare)(rig.root);
      } finally {
        rig.root.visible = true;
      }
      if (remote.rig !== rig) return;
      this.onDressed?.(rig.root);
      await this.applyHeld(remote);
    } catch (err) {
      console.warn(`remote player ${remote.hello.name}: no rig for ${species}`, err);
    }
  }

  /**
   * The peer's look on its rig: shape, height, colours and outfit, as their hello gives it (once per
   * look). A change of clothes goes on as the player's own does: loaded hidden, compiled, then shown,
   * and a newer look arriving meanwhile wins. The same look asked for again answers with the dress
   * already going, so whoever waits on it waits until it is on.
   */
  private applyLook(r: Remote): Promise<void> {
    const c = r.rig?.character;
    const look = r.hello.look;
    if (!c || !look) return Promise.resolve();
    const key = JSON.stringify(look);
    if (r.lookApplied === key) return r.lookPending ?? Promise.resolve();
    r.lookApplied = key;
    const alive = () => this.remotes.get(r.id) === r && r.rig?.character === c && r.lookApplied === key;
    const pending = applyLookPrepared(c, look, this.baseUrl, this.prepare ?? noPrepare, alive).catch((err) => {
      console.warn(`remote player ${r.hello.name}: their look did not go on`, err);
    });
    r.lookPending = pending;
    return pending;
  }

  /** Until the last look asked for on this rig has gone on (each one started meanwhile is waited for in turn), or the rig is gone. */
  private async lookSettled(r: Remote, rig: CharacterRig): Promise<void> {
    for (;;) {
      const pending = r.lookPending;
      if (pending) await pending;
      if (this.remotes.get(r.id) !== r || r.rig !== rig || r.lookPending === pending) return;
    }
  }

  /**
   * The weapons in the peer's hands, as their hello names them: each model prepared before it is hung on
   * the hand bone (every time, as the player's own are). The rack not in yet: tried again by refreshHeld.
   */
  private async applyHeld(r: Remote): Promise<void> {
    const rig = r.rig;
    if (!rig) return;
    const held = r.hello.held;
    const key = `${held?.r ?? ''}|${held?.l ?? ''}`;
    if (r.heldApplied === key) return;
    const cat = this.weapons?.() ?? null;
    if ((held?.r || held?.l) && !cat) {
      r.heldApplied = null;
      return;
    }
    r.heldApplied = key;
    for (const m of r.heldModels) m.removeFromParent();
    r.heldModels = [];
    if (!cat) return;
    for (const [role, id] of [['rightHand', held?.r], ['leftHand', held?.l]] as const) {
      if (!id) continue;
      const def = cat.weapons.find((w) => w.id === id);
      const bone = rig.boneFor(role);
      if (!def || !bone) continue;
      try {
        const model = await cat.model(def);
        const holder = weaponHolder(rig.root, bone, def, model);
        await (this.prepare ?? noPrepare)(holder);
        if (this.remotes.get(r.id) !== r || r.rig !== rig || r.heldApplied !== key) return;
        bone.add(holder);
        markActor(holder);
        r.heldModels.push(holder);
      } catch (err) {
        console.warn(`remote player ${r.hello.name}: their ${id} did not load`, err);
      }
    }
  }

  /** The weapons rack came in: every peer whose weapons were waiting for it is armed. */
  refreshHeld(): void {
    for (const r of this.remotes.values()) if (r.rig && r.heldApplied === null) void this.applyHeld(r);
  }

  hello(id: number, hello: Hello): void {
    const r = this.remotes.get(id);
    if (!r) return;
    const speciesChanged = r.hello.species !== hello.species;
    r.hello = hello;
    if (!speciesChanged)
      void this.applyLook(r).then(() => {
        if (!r.rig) return;
        this.onDressed?.(r.rig.root);
        void this.applyHeld(r);
      });
    r.group.visible = this.sameWorld(hello);
    // Their ship's fit changed (they closed its Edit page): the picture of it is repainted or refitted in place. A
    // ship other than the one they ride now changes nothing yet; its fit applies when that ship appears.
    const rv = r.vehicle;
    if (rv && hello.ship && hello.ship.id === rv.id) void this.refitRemote(r, rv, hello.ship.fit);
    (r.label.material as THREE.SpriteMaterial).map?.dispose();
    r.group.remove(r.label);
    r.label = makeLabel(hello.name);
    r.label.position.y = 2.15;
    r.group.add(r.label);
    if (speciesChanged) {
      if (r.rig) r.group.remove(r.rig.root);
      r.rig = null;
      void this.dress(r);
    }
  }

  state(id: number, s: PeerState): void {
    const r = this.remotes.get(id);
    if (!r) return;
    const first = r.target.y < -900;
    // Its speed from the messages themselves, smoothed: the glide below is a sawtooth around it.
    const now = performance.now();
    if (!first) stepRelayVelocity(r.vel, s.p[0] - r.target.x, s.p[1] - r.target.y, s.p[2] - r.target.z, (now - r.heardAt) / 1000);
    r.heardAt = now;
    r.target.set(s.p[0], s.p[1], s.p[2]);
    if (first) r.group.position.copy(r.target);
    r.heading = s.h;
    r.targetQ = s.q && s.q.length === 4 ? (r.targetQ ?? new THREE.Quaternion()).set(s.q[0], s.q[1], s.q[2], s.q[3]).normalize() : null;
    r.state = STATES.has(s.s) ? s.s : 'idle';
    r.speed = s.v;
    r.saber = s.sab;
    r.silent = 0;
    this.vehicleState(r, s.veh);
  }

  /** The vehicle a peer is on: brought in when first seen (or changed), moved along after, taken away when they are off it. */
  private vehicleState(r: Remote, veh: PeerVehicle | undefined): void {
    if (!veh) {
      this.dropVehicle(r);
      return;
    }
    if (!r.vehicle || r.vehicle.id !== veh.id) {
      this.dropVehicle(r);
      const rv: RemoteVehicle = { id: veh.id, obj: null, target: new THREE.Vector3(veh.p[0], veh.p[1], veh.p[2]), targetQ: new THREE.Quaternion(veh.q[0], veh.q[1], veh.q[2], veh.q[3]), pose: veh.pose ?? null, vel: new THREE.Vector3(), heardAt: 0, wings: null, wingsWant: veh.w === 1, build: null, paint: null, fit: null, busy: null, want: null };
      r.vehicle = rv;
      void this.bringVehicle(r, rv);
    }
    const rv = r.vehicle;
    const now = performance.now();
    if (rv.heardAt > 0) stepRelayVelocity(rv.vel, veh.p[0] - rv.target.x, veh.p[1] - rv.target.y, veh.p[2] - rv.target.z, (now - rv.heardAt) / 1000);
    rv.heardAt = now;
    rv.target.set(veh.p[0], veh.p[1], veh.p[2]);
    rv.targetQ.set(veh.q[0], veh.q[1], veh.q[2], veh.q[3]).normalize();
    rv.pose = veh.pose ?? null;
    // The pilot's wings as they send them; a peer on an older build sends none, and its wings open while it moves.
    rv.wingsWant = veh.w !== undefined ? veh.w === 1 : rv.vel.length() > 4;
    if (rv.obj && rv.obj.position.y < -900) {
      rv.obj.position.copy(rv.target);
      rv.obj.quaternion.copy(rv.targetQ);
    }
  }

  private async bringVehicle(r: Remote, rv: RemoteVehicle): Promise<void> {
    try {
      this.garage ??= this.loadGarage();
      const g = await this.garage;
      const def = g.find(rv.id);
      if (!def) {
        console.warn(`remote player ${r.hello.name} rides a ${rv.id} the garage does not know`);
        return;
      }
      // Its fit, as their hello gives it (stock when the hello names another ship, or none).
      const asked = r.hello.ship?.id === def.id ? r.hello.ship.fit : null;
      const fit = def.fit ? g.resolve(def, asked) : null;
      // Prepared (and painted) before it is shown, so the first sight of it compiles nothing.
      const { holder: obj, wings, build, paint } = await g.visualParts(def, { fit, prepare: this.prepareVehicle ?? undefined, forget: this.forget ?? undefined });
      if (r.vehicle !== rv) {
        paint?.dispose();
        return;
      }
      rv.build = def.fit ? build : null;
      rv.paint = paint;
      rv.fit = fit;
      obj.position.copy(rv.target);
      obj.quaternion.copy(rv.targetQ);
      obj.visible = r.group.visible;
      // A ship first seen in flight arrives with its wings where they are, not closed and opening.
      if (wings.length) wings.snap(rv.wingsWant);
      // A fitted ship keeps its set even while empty: a part a refit brings may carry a wing (stepping an empty set is free).
      if (wings.length || def.fit) rv.wings = wings;
      this.scene.add(obj);
      markActor(obj);
      rv.obj = obj;
      // A hello that came while the picture was being built: its fit now.
      const latest = r.hello.ship;
      if (latest && latest.id === rv.id && latest.fit !== asked) void this.refitRemote(r, rv, latest.fit);
    } catch (err) {
      console.warn(`remote player ${r.hello.name}: their ${rv.id} did not load`, err);
    }
  }

  /**
   * A peer's ship picture brought to a new fit in place, never rebuilt: only a repaint when no slot's look
   * changes, else the new parts staged, prepared and painted, then swapped in one step (Garage.restage).
   * Coalesced: a fit asked for while one is going waits, and only the newest is done when it ends.
   */
  private refitRemote(r: Remote, rv: RemoteVehicle, want: ShipFit): Promise<void> {
    rv.want = want;
    if (rv.busy) return rv.busy;
    const run = async () => {
      while (rv.want) {
        const asked = rv.want;
        rv.want = null;
        if (r.vehicle !== rv || !rv.build || !rv.fit) return;
        this.garage ??= this.loadGarage();
        const g = await this.garage;
        const def = g.find(rv.id);
        const next = def ? g.resolve(def, asked) : null;
        if (!def?.fit || !next || fitKey(next) === fitKey(rv.fit)) continue;
        const slots = changedSlots(def.fit, rv.fit, next);
        if (!slots.length) await rv.paint?.apply(next.paint);
        else {
          // Its wings set too: a wing a new part brings opens with the pilot's, and one on a part taken down leaves it.
          const s = await g.restage(def, rv.build, rv.fit, next, rv.paint, this.prepareVehicle ?? noPrepareRoots, rv.wings ?? undefined);
          if (r.vehicle !== rv) {
            for (const p of s.parts) rv.paint?.untrack(p.node);
            return;
          }
          s.commit();
        }
        if (r.vehicle !== rv) return;
        rv.fit = next;
      }
    };
    rv.busy = run()
      .catch((err) => console.warn(`remote player ${r.hello.name}: their ${rv.id} could not be refitted`, err))
      .finally(() => {
        rv.busy = null;
      });
    return rv.busy;
  }

  private dropVehicle(r: Remote): void {
    if (!r.vehicle) return;
    if (r.vehicle.obj) this.scene.remove(r.vehicle.obj);
    // Its paint's copies leave the world's material sets with it.
    r.vehicle.paint?.dispose();
    r.vehicle.paint = null;
    r.vehicle.want = null;
    r.vehicle = null;
  }

  /** An emote from the relay: a dance or a sit loops, a flourish plays over the dance (which comes back after it), an empty clip ends whatever plays. */
  emote(id: number, clip: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    if (!clip) {
      r.rig?.stopOverride(0.2);
      r.dance = null;
      return;
    }
    r.rig?.play(clip, { fadeIn: 0.15, loop: loopsEmote(clip) });
    r.dance = isDanceClip(clip) ? clip : isFlourishClip(clip) ? r.dance : null;
  }

  remove(id: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    this.dropVehicle(r);
    this.scene.remove(r.group);
    (r.label.material as THREE.SpriteMaterial).map?.dispose();
  }

  update(dt: number): void {
    for (const r of this.remotes.values()) {
      if (r.vehicle?.obj) r.vehicle.obj.visible = r.group.visible;
      if (!r.group.visible) continue;
      r.silent += dt;
      // Gone quiet: the speed the messages gave fades rather than holding the blur on a still figure.
      if (r.silent > RELAY.silentSeconds) {
        const fade = Math.exp(-dt / 0.1);
        r.vel.multiplyScalar(fade);
        r.vehicle?.vel.multiplyScalar(fade);
      }
      // Glide to the last place heard, a tenth of a second's worth at a time, so the figure moves
      // smoothly between the relay's few updates a second.
      const k = 1 - Math.exp(-dt / 0.1);
      r.group.position.lerp(r.target, k);
      if (r.targetQ) {
        // The whole turn: aboard a hull or adrift, the figure is not upright in the world.
        r.group.quaternion.slerp(r.targetQ, k);
      } else {
        let diff = r.heading - r.group.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        r.group.rotation.set(0, r.group.rotation.y + diff * k, 0);
      }
      const rv = r.vehicle;
      if (rv?.obj) {
        rv.obj.position.lerp(rv.target, k);
        rv.obj.quaternion.slerp(rv.targetQ, k);
        // The wings open and close as the pilot's do, each on its own clock (nothing moves once they have settled).
        if (rv.wings) {
          rv.wings.want = rv.wingsWant;
          rv.wings.step(dt);
        }
      }
      const rig = r.rig;
      if (rig) {
        // A flourish over, the dance goes on.
        if (r.dance && !rig.overriding) rig.play(r.dance, { fadeIn: 0.15, loop: true });
        const moving = r.silent < 0.6 && r.group.position.distanceTo(r.target) > 0.05;
        const state = (r.silent > 1.5 ? 'idle' : moving || r.state === 'idle' ? r.state : r.state) as RigState;
        // Seated the way the peer's own vehicle seats them: its riding pose's branch of the riding loop.
        if (state === 'seated') {
          const pose = rv?.pose ?? (rv ? `vehicle_${rv.id.replace(/^pv_/, '')}` : null);
          const clip = pose ? rig.variant('loop_riding', pose) : null;
          rig.prefer('seated', clip && clip !== 'loop_riding' ? clip : null);
        }
        rig.setState(rig.hasState(state) ? state : 'idle', r.speed);
        rig.update(dt);
      }
    }
  }

  /** The peers and what they ride, for the motion blur, with the relay's velocity: their glide between messages is not their speed. */
  collectMovers(out: FxMoverList): void {
    for (const r of this.remotes.values()) {
      if (!r.group.visible) continue;
      out.add(r.group, false, 'remote', r.vel);
      // Added to the scene root, not under the figure.
      if (r.vehicle?.obj) out.add(r.vehicle.obj, false, 'remoteVehicle', r.vehicle.vel);
    }
  }

  dispose(): void {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }
}

/** No preparation to wait for (the game has not given one). */
const noPrepare = (): Promise<void> => Promise.resolve();
const noPrepareRoots = (_roots: THREE.Object3D[]): Promise<void> => Promise.resolve();

/** A name over the head: text on a small canvas, as a sprite that faces the camera. */
function makeLabel(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = Math.min(250, ctx.measureText(name).width + 24);
  ctx.beginPath();
  ctx.roundRect(128 - w / 2, 12, w, 40, 8);
  ctx.fill();
  ctx.fillStyle = '#dff1ff';
  ctx.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}
