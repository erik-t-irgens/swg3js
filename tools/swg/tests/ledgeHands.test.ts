// Wave 4 of the animations, the hands on the lip and the feet on the wall (src/player/limbPlace.ts through the ledges'
// line, src/player/ledge.ts), frame by frame while the body moves, on a skeleton the game draws (the converted human male's
// where the packs are here, else the tests' own) posed by the very clips the pack fits for it (`MixamoPack.clipsFor`), on
// the real Rapier through the grapple's harness (its body grabs, hangs, shimmies and hops as the player's does):
//  - the clips posed as the game's rig poses them (`RigEmu`: a one-off from where the ledge starts it over the loop, each
//    change a crossfade, every clip stepped by the frame after it is asked for);
//  - at 30, 60 and 144 frames a second, every frame a hand is wholly placed (its weight 1) its grip point stands within a
//    centimetre of the lip's grip line, through the grab's end, hanging still, shimmying along the lip and starting and
//    stopping, and on a hop's landing; every frame each elbow stays on the clip's own side of the line from its shoulder to
//    its wrist; the body hung from its hands (the anchor) never moves the figure 0.2 m;
//  - braced, each foot's ball stands its `BALL_OFF` off the wall's face within a centimetre, every knee on the clip's side;
//  - the clean pose comes back whole (`restore`), so nothing builds up from frame to frame;
//  - under `climb.ledges` 'before' nothing is placed at all.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { TestBody, box, ground, makePhysics, type Physics } from './grappleBody.ts';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { LEDGE_FACTS, LEDGE_IDS, ledgeClipName } from '../../../src/anim/ledgeClips.ts';
import { LEDGE_HANG, LEDGE_MOVE } from '../../../src/player/ledge.ts';
import { BALL_OFF, LimbPlace } from '../../../src/player/limbPlace.ts';
import { CLIMB_TUNE, climbTwoBefore } from '../../../src/anim/climbTune.ts';
import { RAPIER } from '../../../src/core/physics.ts';
import { glbSkeleton, speciesBodies, targetSkeleton } from './animFixtures.ts';
import { REPO } from './oldModules.ts';
import { PeerHang, PeerHangIn, figureScaleOf } from '../../../src/player/peerHang.ts';

// Climbing II, phase 2: these scenes hold today's climbing (a lip grabbed by moving at it, a wall climbed by W pressed
// into it, the hang's keys as they were): every phase 2 switch at its 'before' setting, here and after every reset (the new
// controls are climbControls.test.ts's).
climbTwoBefore();

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const body = speciesBodies(REPO).find((b) => b.id === 'human_male');
const target = body ? glbSkeleton(body.body) : targetSkeleton();
note(body ? "the converted human male's skeleton" : "no converted human male here: the tests' own skeleton");

const packDir = join(REPO, 'public', 'anims', 'mixamo');
const pack = new MixamoPack({
  enabled: () => true,
  index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
  clip: async (file: string) => {
    const b = readFileSync(join(packDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  breath: async () => {},
  also: LEDGE_IDS,
  now: () => performance.now(),
});
const info = console.info;
console.info = () => {};
const clips = await pack.clipsFor(target as never, 'hands');
console.info = info;
const clipOf = (id: string) => clips.find((c) => c.name === ledgeClipName(id)) ?? null;
ok(LEDGE_IDS.every((id) => !!clipOf(id)), `the pack fits every ledge clip the game names (${LEDGE_IDS.length})`);

// ---- the figure: bones under a root under the body's group, as the game's rig holds them ----------------------------------
const group = new THREE.Group();
const root = new THREE.Group();
const inner = new THREE.Group();
inner.position.fromArray(target.base.p);
inner.quaternion.fromArray(target.base.q);
root.add(inner);
group.add(root);
const bones = new Map<string, THREE.Bone>();
const made: THREE.Bone[] = [];
target.joints.forEach((j) => {
  const b = new THREE.Bone();
  b.name = j.name;
  b.position.fromArray(j.restP);
  b.quaternion.fromArray(j.restQ);
  made.push(b);
  bones.set(j.name, b);
  (j.parent < 0 ? inner : made[j.parent]).add(b);
});
const rig = { root, boneNamed: (n: string) => bones.get(n) ?? null, restSkeleton: () => target, limbPose: null as { restore(): void } | null };
const mixer = new THREE.AnimationMixer(root);
interface Act {
  a: THREE.AnimationAction;
  t: number;
  w: number;
  goal: number;
  rate: number;
  dur: number;
  loop: boolean;
}
/**
 * The game's rig as the ledges drive it (`Player.animateHang`): a one-off played from where the ledge says over the hang's
 * loop, the loop changed by a crossfade under it, the one-off let go into the loop by a crossfade at its end; every clip
 * stepped by the frame after it is asked for (the rig's `update` after its `play`), a one-off held on its last frame.
 */
class RigEmu {
  readonly acts = new Map<string, Act>();
  over = '';
  loop = '';
  act(id: string): Act {
    let x = this.acts.get(id);
    if (!x) {
      const clip = clipOf(id)!;
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      x = { a, t: 0, w: 0, goal: 0, rate: 0, dur: clip.duration, loop: LEDGE_FACTS[id].loop };
      this.acts.set(id, x);
    }
    return x;
  }
  /** `id` shown, everything else let go, over `fade` seconds. */
  show(id: string, fade: number): void {
    const rate = fade > 1e-6 ? 1 / fade : Infinity;
    for (const [k, x] of this.acts) {
      x.goal = k === id ? 1 : 0;
      x.rate = rate;
    }
    this.act(id).goal = 1;
    this.act(id).rate = rate;
  }
  frame(dt: number): void {
    const L = b0!.ledge;
    if (L.startClip) {
      const x = this.act(L.startClip);
      x.t = L.startFrom;
      x.w = 0;
      this.over = L.startClip;
      this.show(L.startClip, L.startFade);
    } else if (L.ended && this.over) {
      this.over = '';
      if (this.loop) this.show(this.loop, CLIMB_TUNE.ease);
    }
    if (L.rigClip && L.rigClip !== this.loop && L.holding) {
      this.loop = L.rigClip;
      const x = this.act(this.loop);
      x.t = 0;
      if (!this.over) this.show(this.loop, CLIMB_TUNE.ease);
    }
    for (const x of this.acts.values()) {
      x.t += dt;
      x.t = x.loop ? x.t % x.dur : Math.min(x.t, x.dur - 1e-4);
      x.w = x.w < x.goal ? Math.min(x.goal, x.w + x.rate * dt) : Math.max(x.goal, x.w - x.rate * dt);
    }
  }
  /** The pose (the clean pose put back first, as the rig's hook does before its mixer). */
  pose(): void {
    rig.limbPose?.restore();
    for (const x of this.acts.values()) {
      x.a.time = x.t;
      x.a.setEffectiveWeight(x.w);
    }
    mixer.update(0);
  }
}
let b0: TestBody | null = null;
/** The clip `id` at `t` seconds alone (the clean pose put back first). */
function pose(id: string, t: number): void {
  rig.limbPose?.restore();
  for (const x of emu.acts.values()) x.a.setEffectiveWeight(0);
  const x = emu.act(id);
  x.a.time = t;
  x.a.setEffectiveWeight(1);
  mixer.update(0);
}
let emu = new RigEmu();

const v = new THREE.Vector3();
const w = new THREE.Vector3();
const a = new THREE.Vector3();
const k = new THREE.Vector3();
const c = new THREE.Vector3();
const pos = (n: string, out: THREE.Vector3) => bones.get(n)!.getWorldPosition(out);

/** The side of the elbow (or knee) off the line from the upper joint to the end, as a unit vector into `out` (zero for a straight limb). */
function sideOf(top: string, mid: string, end: string, out: THREE.Vector3): number {
  pos(top, a);
  pos(mid, k);
  pos(end, c);
  const ax = c.clone().sub(a);
  const len = ax.length();
  ax.normalize();
  out.copy(k).sub(a);
  out.addScaledVector(ax, -out.dot(ax));
  const off = out.length();
  if (off > 1e-6) out.divideScalar(off);
  return off / Math.max(1e-6, len);
}

interface Tally {
  frames: number;
  placed: number;
  worst: number;
  backward: number;
  lift: number;
  feetMissed: number;
  feetPlaced: number;
  feetWorst: number;
  kneesBack: number;
}

/** A frame of the drawn figure after the body's: posed by the ledge's clip, placed, its limbs put on the lip. */
function drawFrame(b: TestBody, lp: LimbPlace, dt: number, tally: Tally, wall: { z: number } | null): void {
  const L = b.ledge;
  emu.frame(dt);
  if (!L.holding) return;
  emu.pose();
  group.position.set(b.pos.x, b.pos.y, b.pos.z);
  group.rotation.set(0, L.heading, 0);
  const h = L.heading;
  root.position.set(L.offX * Math.cos(h) - L.offZ * Math.sin(h), L.offY, L.offX * Math.sin(h) + L.offZ * Math.cos(h));
  // Turned with a sloping lip about its own front, on its hands (as `Player.applyLedgeRoot` turns it).
  root.quaternion.set(0, 0, 0, 1);
  if (L.tilt !== 0) L.applyTilt(root);
  group.updateMatrixWorld(true);
  // The clip's own elbows and knees, before anything is placed.
  const posedL = new THREE.Vector3();
  const posedR = new THREE.Vector3();
  const posedKL = new THREE.Vector3();
  const posedKR = new THREE.Vector3();
  const bentL = sideOf('lArm', 'lForeArm', 'lWrist', posedL);
  const bentR = sideOf('rArm', 'rForeArm', 'rWrist', posedR);
  const kneeL = sideOf('lThigh', 'lShin', 'lAnkle', posedKL);
  const kneeR = sideOf('rThigh', 'rShin', 'rAnkle', posedKR);
  const feetWas = lp.feetOn;
  L.limbsFor(lp, rig as never, null);
  tally.lift = Math.max(tally.lift, Math.abs(L.lifted));
  lp.filter = b.filter;
  const pre = [0, 1].map((s) => {
    lp.reachAt[0] = lp.hand[s * 3];
    lp.reachAt[1] = lp.hand[s * 3 + 1];
    lp.reachAt[2] = lp.hand[s * 3 + 2];
    lp.reachPastIn(rig as never, s, null, w);
    return lp.past;
  });
  lp.place(rig as never, b.physics.world, null);
  group.updateMatrixWorld(true);
  tally.frames++;
  for (let s = 0; s < 2; s++) {
    if (lp.handW[s] < 1 - 1e-9) continue;
    lp.gripNow(rig as never, s, null, v);
    const d = Math.hypot(v.x - lp.hand[s * 3], v.y - lp.hand[s * 3 + 1], v.z - lp.hand[s * 3 + 2]);
    tally.placed++;
    if (d > tally.worst && process.env.LEDGE_DIAG) { pos(s === 0 ? 'lArm' : 'rArm', a); const reach = Math.hypot(a.x - lp.hand[s * 3], a.y - lp.hand[s * 3 + 1], a.z - lp.hand[s * 3 + 2]); console.log('worst', s, d.toFixed(4), 'pre', pre[s].toFixed(4), L.phase, emu.over || emu.loop, [...emu.acts.entries()].filter(([, x]) => x.w > 0).map(([k, x]) => k + ':' + x.t.toFixed(2) + '@' + x.w.toFixed(2)).join(' '), 'reach', reach.toFixed(3), 'shoulder', a.x.toFixed(2), a.y.toFixed(2), a.z.toFixed(2), 'target', lp.hand[s*3].toFixed(2), lp.hand[s*3+1].toFixed(2), lp.hand[s*3+2].toFixed(2), 'off', L.offX.toFixed(3), L.offY.toFixed(3), L.offZ.toFixed(3), 'body', b.pos.x.toFixed(3), b.pos.y.toFixed(3), b.pos.z.toFixed(3), 'lip', L.lip.ey.toFixed(3), 's', (L as any).s, JSON.stringify(L.report()), 'fade', (L as any).fadeT, (L as any).fadeDur, (L as any).ofY); }
    tally.worst = Math.max(tally.worst, d);
    const side = s === 0 ? sideOf('lArm', 'lForeArm', 'lWrist', w) : sideOf('rArm', 'rForeArm', 'rWrist', w);
    const posed = s === 0 ? posedL : posedR;
    const bent = s === 0 ? bentL : bentR;
    if (bent > 0.02 && side > 0.02 && w.dot(posed) < 0) tally.backward++;
  }
  if (wall && lp.wallW >= 1 - 1e-9) {
    // Every foot wholly on the wall by its own ray met the face this frame (the solve placed it, not the clip's own pose); a
    // foot whose own ray stops meeting the face (past a wall's end) comes off it eased (the fix round's).
    const full = (lp.footW(0) >= 1 - 1e-9 ? 1 : 0) + (lp.footW(1) >= 1 - 1e-9 ? 1 : 0);
    if (lp.feetOn - feetWas < full) tally.feetMissed++;
    for (const s of ['l', 'r']) {
      if (lp.footW(s === 'l' ? 0 : 1) < 1 - 1e-9) continue;
      pos(`${s}Toe`, v);
      const off = wall.z - v.z;
      tally.feetPlaced++;
      tally.feetWorst = Math.max(tally.feetWorst, Math.abs(off - BALL_OFF));
      const side = sideOf(`${s}Thigh`, `${s}Shin`, `${s}Ankle`, w);
      const posed = s === 'l' ? posedKL : posedKR;
      const bent = s === 'l' ? kneeL : kneeR;
      if (bent > 0.02 && side > 0.02 && w.dot(posed) < 0) tally.kneesBack++;
    }
  }
}

async function scene(): Promise<Physics> {
  const p = await makePhysics();
  ground(p, 0);
  box(p, [-3, 0, 2], [0.4, 2.6, 3]);
  // A post rising past the lip at the wall's end (the fix round's shimmy goes round any corner a lip goes on round: this one
  // ends the lip, so the shimmy stops at the gap and the hop goes across it).
  box(p, [0.4, 0, 2], [0.6, 4, 3]);
  box(p, [1.2, 0, 2], [3, 3.8, 3]);
  p.stepOnce();
  return p;
}

for (const fps of [30, 60, 144]) {
  const dt = 1 / fps;
  const p = await scene();
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.ledgeScale = figureScaleOf(rig as never);
  b.place(-1, 0, 1.2);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.run(fps, 0.3);
  const lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  emu = new RigEmu();
  b0 = b;
  const tally: Tally = { frames: 0, placed: 0, worst: 0, backward: 0, lift: 0, feetMissed: 0, feetPlaced: 0, feetWorst: 0, kneesBack: 0 };
  const frame = () => {
    b.frame(dt);
    drawFrame(b, lp, dt, tally, { z: 2 });
  };
  // Grab, hang a moment, shimmy left toward the gap, hop across and up to the other lip, hang there.
  b.key('KeyW', true);
  b.key('Space', true);
  frame();
  b.key('Space', false);
  for (let i = 0; i < 2 * fps; i++) frame();
  b.key('KeyW', false);
  ok(b.ledge.phase === LEDGE_HANG && b.ledge.braced, `${fps} fps: grabbed and hanging braced`);
  b.key('KeyA', true);
  for (let i = 0; i < 2.5 * fps; i++) frame();
  b.key('KeyA', false);
  b.key('Space', true);
  b.key('KeyA', true);
  frame();
  b.key('Space', false);
  b.key('KeyA', false);
  for (let i = 0; i < 3 * fps; i++) frame();
  ok(b.ledge.phase === LEDGE_HANG && Math.abs(b.ledge.lip.ey - 3.8) < 1e-3, `${fps} fps: shimmied to the gap and hopped across and up to the other lip`);
  ok(tally.placed > fps * 4, `${fps} fps: ${tally.placed} hand-frames wholly placed over ${tally.frames} frames`);
  ok(tally.worst < 0.01, `${fps} fps: every hand wholly placed stands within a centimetre of the lip's grip line, frame by frame (worst ${(tally.worst * 1000).toFixed(2)} mm)`);
  ok(tally.backward === 0, `${fps} fps: no elbow on the far side of its shoulder-to-wrist line from where the clip bends it (${tally.backward})`);
  ok(tally.lift < 0.2, `${fps} fps: the body hung from its hands (the anchor) moves the figure by at most ${(tally.lift * 1000).toFixed(1)} mm, under 0.2 m`);
  ok(tally.feetPlaced > fps && tally.feetWorst < 0.01, `${fps} fps: braced, every foot's ball stands its ${BALL_OFF} m off the wall within a centimetre (${tally.feetPlaced} foot-frames, worst ${(tally.feetWorst * 1000).toFixed(2)} mm)`);
  ok(tally.feetMissed === 0, `${fps} fps: braced, both feet meet the wall's face every frame they are placed (missed ${tally.feetMissed})`);
  ok(tally.kneesBack === 0, `${fps} fps: no knee on the far side of the clip's own bend (${tally.kneesBack})`);
}

// ---- the fix round: round a corner, along a sloping lip, and a big figure's feet where the wall under the lip ends ----------
{
  /** How far a hand's place stands off the lip under it (its grip: `gripOut` out from the face's line, `gripDrop` under the top). */
  const offOutline = (x: number, z: number, mn: number[], mx: number[]) => {
    const inside = x > mn[0] && x < mx[0] && z > mn[2] && z < mx[2];
    if (inside) return Math.min(x - mn[0], mx[0] - x, z - mn[2], mx[2] - z);
    return Math.hypot(x - Math.max(mn[0], Math.min(mx[0], x)), z - Math.max(mn[2], Math.min(mx[2], z)));
  };
  const tan34 = Math.tan((34 * Math.PI) / 180);
  /** The bigger figure's size against the human male (its skeleton's own times the root's 1.22). */
  const sBig = 1.22 * figureScaleOf({ root: new THREE.Object3D(), restSkeleton: () => target } as never);
  const scenes: { name: string; scale: number; x: number; secs: number; wall: { z: number } | null; make: (p: Physics) => void; lip: (x: number, y: number, z: number) => number }[] = [
    {
      name: 'round an outer corner',
      scale: 1,
      x: -0.5,
      secs: 5,
      wall: null,
      make: (p) => void box(p, [-3, 0, 2], [1, 2.6, 4]),
      lip: (x, y, z) => Math.max(Math.abs(offOutline(x, z, [-3, 0, 2], [1, 2.6, 4]) - CLIMB_TUNE.gripOut), Math.abs(y - (2.6 - CLIMB_TUNE.gripDrop))),
    },
    {
      name: 'along a lip sloping up at 34 degrees',
      scale: 1,
      x: 0,
      secs: 3,
      wall: { z: 2 },
      lip: (x, y, z) => Math.max(Math.abs(y - (2.6 + tan34 * x - CLIMB_TUNE.gripDrop)), Math.abs(z - (2 - CLIMB_TUNE.gripOut))),
      make: (p) => {
        const a = (34 * Math.PI) / 180;
        p.world.createCollider(RAPIER.ColliderDesc.cuboid(8, 1.5, 1).setTranslation(Math.sin(a) * 1.5, 2.6 - Math.cos(a) * 1.5, 3).setRotation({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) }));
      },
    },
    {
      name: "a figure 1.22 times the human male's size along a lip whose wall ends under it (an overhang goes on past)",
      scale: 1.22,
      x: -1.5,
      secs: 4,
      wall: { z: 2 },
      lip: (x, y, z) => Math.max(Math.abs(y - (2.6 - CLIMB_TUNE.gripDrop * sBig)), Math.abs(z - (2 - CLIMB_TUNE.gripOut * sBig))),
      make: (p) => {
        box(p, [-3, 0, 2], [0, 2.2, 3]);
        box(p, [-3, 2.2, 2], [3, 2.6, 3]);
      },
    },
  ];
  for (const sc of scenes) {
    const fps = 60;
    const dt = 1 / fps;
    const p = await makePhysics();
    ground(p, 0);
    sc.make(p);
    p.stepOnce();
    root.scale.setScalar(sc.scale);
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.ledgeScale = figureScaleOf(rig as never);
    b.place(sc.x, 0, 1.2);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.run(fps, 0.3);
    const lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
    emu = new RigEmu();
    b0 = b;
    const tally: Tally = { frames: 0, placed: 0, worst: 0, backward: 0, lift: 0, feetMissed: 0, feetPlaced: 0, feetWorst: 0, kneesBack: 0 };
    let pastEnd = 0;
    let footJump = 0;
    let lipWorst = 0;
    let onLip = 0;
    const was = [0, 0];
    const frame = () => {
      b.frame(dt);
      drawFrame(b, lp, dt, tally, sc.wall);
      // Each hand's place itself on the lip under that hand (its own height on a slope, its own face round a corner).
      if (b.ledge.phase === LEDGE_HANG) {
        for (let s = 0; s < 2; s++) {
          if (lp.handW[s] < 1 - 1e-9) continue;
          onLip++;
          lipWorst = Math.max(lipWorst, sc.lip(lp.hand[s * 3], lp.hand[s * 3 + 1], lp.hand[s * 3 + 2]));
        }
      }
      for (let s = 0; s < 2; s++) {
        const fw = lp.footW(s);
        footJump = Math.max(footJump, Math.abs(fw - was[s]));
        was[s] = fw;
        if (fw < 1 - 1e-9 || !sc.wall || lp.wallW < 1 - 1e-9) continue;
        pos(`${s === 0 ? 'l' : 'r'}Toe`, v);
        if (sc.scale !== 1 && v.x > 0.02) pastEnd++;
      }
    };
    b.key('KeyW', true);
    b.key('Space', true);
    frame();
    b.key('Space', false);
    for (let i = 0; i < 2 * fps; i++) frame();
    b.key('KeyW', false);
    b.key('KeyA', true);
    for (let i = 0; i < sc.secs * fps; i++) frame();
    b.key('KeyA', false);
    root.scale.setScalar(1);
    ok(tally.placed > fps && tally.worst < 0.01, `${sc.name}: every hand wholly placed stands within a centimetre of its place, frame by frame (${tally.placed} hand-frames, worst ${(tally.worst * 1000).toFixed(2)} mm)`);
    ok(onLip > fps && lipWorst < 0.01, `${sc.name}: and every hanging hand's place is the lip under that hand, its grip's own out and drop from it, within a centimetre (${onLip} hand-frames, worst ${(lipWorst * 1000).toFixed(2)} mm)`);
    ok(tally.backward === 0 && tally.kneesBack === 0, `${sc.name}: no elbow or knee bent the other way from the clip's (${tally.backward}, ${tally.kneesBack})`);
    if (sc.wall) ok(tally.feetWorst < 0.01 && tally.feetMissed === 0, `${sc.name}: every foot wholly on the wall stands its ${BALL_OFF} m off the face within a centimetre (worst ${(tally.feetWorst * 1000).toFixed(2)} mm, missed ${tally.feetMissed})`);
    if (sc.scale !== 1) ok(pastEnd === 0 && footJump <= dt / CLIMB_TUNE.ease + 1e-9, `${sc.name}: no foot stays wholly on the wall past its end, each eased off as its own ray stops meeting the face (${pastEnd} frames past, largest step ${footJump.toFixed(3)})`);
  }
}

// ---- the clean pose put back whole ----------------------------------------------------------------------------------------
{
  pose('braced_hanging_idle', 0.4);
  group.updateMatrixWorld(true);
  const before = bones.get('lArm')!.quaternion.clone();
  const lp = new LimbPlace(null);
  lp.setHand(0, 0.5, 1.5, 0.5, 1);
  lp.place(rig as never, null, null);
  const turned = !bones.get('lArm')!.quaternion.equals(before);
  lp.restore();
  ok(turned && bones.get('lArm')!.quaternion.equals(before), "a placed arm is put back on the clip's own pose by `restore` (the rig's hook before its mixer)");
}
// ---- another player's figure: their rig state and place, the lip found here -----------------------------------------------
{
  const LOOP_OF: Record<string, string> = {
    hangBraced: 'braced_hanging_idle',
    hangFree: 'free_hang_hanging_idle',
    shimmyBracedL: 'braced_hang_shimmy_1',
    shimmyBracedR: 'braced_hang_shimmy',
    shimmyFreeL: 'free_hang_left_shimmy',
    shimmyFreeR: 'free_hang_right_shimmy',
  };
  for (const fps of [30, 60, 144]) {
    const dt = 1 / fps;
    const p = await scene();
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.ledgeScale = figureScaleOf(rig as never);
    b.place(-1, 0, 1.2);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.run(fps, 0.3);
    const hq = new PeerHangIn();
    const ph = new PeerHang(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), (h, r) => new RAPIER.Capsule(h, r));
    emu = new RigEmu();
    let loop = '';
    let worst = 0;
    let placed = 0;
    let lineWorst = 0;
    let undoWorst = 0;
    // The figure is the player's sections' too: its root put back at rest before their figure is drawn on it.
    root.position.set(0, 0, 0);
    const frame = () => {
      b.frame(dt);
      const state = b.ledge.holding ? b.ledge.rigState : 'air';
      // Their rig: the state's own loop, crossfaded at a change (a peer plays no one-off of the ledges').
      const clip = LOOP_OF[state] ?? '';
      if (clip && clip !== loop) {
        loop = clip;
        emu.act(clip).t = 0;
        emu.show(clip, CLIMB_TUNE.ease);
      }
      for (const x of emu.acts.values()) {
        x.t = x.loop ? (x.t + dt) % x.dur : Math.min(x.t + dt, x.dur - 1e-4);
        x.w = x.w < x.goal ? Math.min(x.goal, x.w + x.rate * dt) : Math.max(x.goal, x.w - x.rate * dt);
      }
      // Their frame's own writes first (as the peers' pass has them): the offset of the frame before taken back off.
      ph.undo(root);
      undoWorst = Math.max(undoWorst, Math.abs(root.position.x), Math.abs(root.position.y), Math.abs(root.position.z));
      root.position.set(0, 0, 0);
      if (!loop) return;
      emu.pose();
      group.position.set(b.pos.x, b.pos.y, b.pos.z);
      group.rotation.set(0, b.ledge.heading, 0);
      group.updateMatrixWorld(true);
      hq.state = state;
      hq.x = b.pos.x;
      hq.y = b.pos.y;
      hq.z = b.pos.z;
      hq.heading = b.ledge.heading;
      hq.scale = figureScaleOf(rig as never);
      hq.filter = b.filter;
      hq.near = true;
      hq.dt = dt;
      ph.step(rig as never, b.physics.world as never, hq);
      group.updateMatrixWorld(true);
      for (let s = 0; s < 2; s++) {
        if (ph.limbs.handW[s] < 1 - 1e-9) continue;
        ph.limbs.gripNow(rig as never, s, null, v);
        placed++;
        worst = Math.max(worst, Math.hypot(v.x - ph.limbs.hand[s * 3], v.y - ph.limbs.hand[s * 3 + 1], v.z - ph.limbs.hand[s * 3 + 2]));
        const lw = Math.max(Math.abs(v.y - (b.ledge.lip.ey - CLIMB_TUNE.gripDrop * figureScaleOf(rig as never))), Math.abs(v.z - (2 - CLIMB_TUNE.gripOut)));
        if (process.env.LEDGE_DIAG && lw > lineWorst) console.log('peer', s, v.x.toFixed(3), v.y.toFixed(3), v.z.toFixed(3), 'lip', b.ledge.lip.ex.toFixed(3), b.ledge.lip.ey.toFixed(3), 'body', b.pos.x.toFixed(3), JSON.stringify(ph.ledge.report()));
        lineWorst = Math.max(lineWorst, lw);
      }
    };
    b.key('KeyW', true);
    b.key('Space', true);
    frame();
    b.key('Space', false);
    for (let i = 0; i < 2 * fps; i++) frame();
    b.key('KeyW', false);
    b.key('KeyA', true);
    for (let i = 0; i < 2 * fps; i++) frame();
    b.key('KeyA', false);
    for (let i = 0; i < fps; i++) frame();
    ok(undoWorst < 1e-9, `${fps} fps: taking a frame's line-up back off (\`undo\`) puts their root back exactly where it stood, the hands' anchor's lift included (worst ${undoWorst})`);
    ok(placed > 2 * fps && worst < 0.01 && lineWorst < 0.01, `${fps} fps: another player's figure hanging and shimmying, drawn from their rig state and place alone: its hands found the lip here and stand on it within a centimetre, frame by frame (${placed} hand-frames, worst ${(worst * 1000).toFixed(2)} mm off their places, ${(lineWorst * 1000).toFixed(2)} mm off the lip)`);
  }
}

// ---- under 'before', nothing --------------------------------------------------------------------------------------------
{
  CLIMB_TUNE.ledges = 'before';
  try {
    const p = await scene();
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.ledgeScale = figureScaleOf(rig as never);
    b.place(-1, 0, 1.2);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.run(60, 0.3);
    const lp = new LimbPlace(null);
    emu = new RigEmu();
    b0 = b;
    const tally: Tally = { frames: 0, placed: 0, worst: 0, backward: 0, lift: 0, feetMissed: 0, feetPlaced: 0, feetWorst: 0, kneesBack: 0 };
    b.key('KeyW', true);
    b.key('Space', true);
    b.frame(1 / 60);
    b.key('Space', false);
    for (let i = 0; i < 120; i++) {
      b.frame(1 / 60);
      drawFrame(b, lp, 1 / 60, tally, { z: 2 });
    }
    b.key('KeyW', false);
    ok(!b.ledge.holding && tally.frames === 0 && !lp.busy && emu.acts.size === 0, "under 'before' the same jump at the lip hangs from nothing, poses no ledge clip and places no limb");
  } finally {
    CLIMB_TUNE.ledges = 'on';
  }
}
console.log(`ledgeHands: ${checks} checks passed`);
