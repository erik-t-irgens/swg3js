// Climbing II, Smoothness II, items 2 and 8 on the game's own rig (src/player/rig.ts's `CharacterRig`, loaded in node with the
// character's parts stood in as tools/swg/tests/animRig.test.ts stands them), posed by the pack's own ledge clips fitted to
// the human male (`MixamoPack.clipsFor`), driven by the game's own hang hand-over (src/player/hangClips.ts's
// `driveHangClips`, which the player's `animateHang` calls) and placed by the game's own limbs (src/player/limbPlace.ts),
// frame by frame through the grapple's harness on the real Rapier and the course's pieces, at 30, 60, 144 and 240 frames a
// second:
//  - item 2 (`climb.transitions` 'blend'): through a grab from a standing jump, the hang, a shimmy started and stopped, a
//    hop sideways and its landing, every bone's place in the figure's own frame never moves more in a frame than `poseJump`
//    times what the clips playing move it on their own and their crossfade's (a jump), the figure's line-up's spring reported (its own move against the
//    frame before), and no stretch of frames where the pose stands still while a clip playing moves (a freeze);
//  - item 8 (`climb.slopeHands` 'each'): on every sloped lip of the course (15, 25, 35 degrees and the limit) and on the
//    stepped lips, each hand wholly placed and within 2 cm of the lip at its own place from the grab clip's touch on, through
//    the hang and a shimmy; under 'before' the lower hand is the one left short (the owner's words), which the measure shows.
//
// Run: node tools/swg/tests/smooth2Rig.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import * as THREE from 'three';

const charStub = 'export class Character { static async load() { throw new Error("no pack in a test"); } }';
const hook = `import { existsSync } from 'node:fs';
export async function resolve(s, c, next) {
  if (s === './character' || s === './character.ts' || s.endsWith('/player/character') || s.endsWith('/player/character.ts')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(charStub)}), shortCircuit: true };
  }
  if (s.startsWith('.') && !/\\.[a-z]+$/.test(s) && c.parentURL && existsSync(new URL(s + '.ts', c.parentURL))) return next(s + '.ts', c);
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { CharacterRig } = await import('../../../src/player/rig.ts');
const { driveHangClips } = await import('../../../src/player/hangClips.ts');
const { MixamoPack } = await import('../../../src/anim/mixamoPack.ts');
const { LEDGE_IDS, LEDGE_ROLES, ledgeClipName } = await import('../../../src/anim/ledgeClips.ts');
const { LEDGE_HANG, LEDGE_MOVE } = await import('../../../src/player/ledge.ts');
const { LimbPlace } = await import('../../../src/player/limbPlace.ts');
const { CLIMB_TUNE, resetClimbTune: resetShipped, climbSmooth3Before, tuneClimb } = await import('../../../src/anim/climbTune.ts');
// (Smoothness III's switches at their other setting too: this suite holds Smoothness II's climbing.)
const resetClimbTune = (): void => {
  resetShipped();
  climbSmooth3Before();
};
const { resetMoveTune: resetMoveShipped, moveSmooth3Before } = await import('../../../src/anim/moveTune.ts');
// (Smoothness III's body switches at their other setting too: this suite holds the body before it.)
const resetMoveTune = (): void => {
  resetMoveShipped();
  moveSmooth3Before();
};
const { handMoment } = await import('../../../src/anim/handTimes.ts');
const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { figureScaleOf } = await import('../../../src/player/peerHang.ts');
const { glbSkeleton, speciesBodies, targetSkeleton } = await import('./animFixtures.ts');
const { REPO } = await import('./oldModules.ts');
const { bodyAt, nearestLip, runUntil, shimmy, standPiece, tap } = await import('./climbCourseBody.ts');
type TestBody = import('./grappleBody.ts').TestBody;
type Rig = InstanceType<typeof CharacterRig>;
type HangState = import('../../../src/player/hangClips.ts').HangClipState;
type Limbs = InstanceType<typeof LimbPlace>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const piece = (id: string) => climbCourse({ pieces: [id] }).pieces[0];

const body = speciesBodies(REPO).find((x) => x.id === 'human_male');
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
ok(LEDGE_IDS.every((id) => clips.some((c) => c.name === ledgeClipName(id))), `the pack fits every ledge clip the game names (${LEDGE_IDS.length})`);

// ---- the figure: the body's group, the rig's root, the skeleton's base, the bones (as the game's rig holds them) ----------
interface Figure {
  group: THREE.Group;
  root: THREE.Group;
  rig: Rig;
  bones: THREE.Bone[];
  /** A twin skeleton posing one clip alone (the clips' own speeds). */
  twinMixer: THREE.AnimationMixer;
  twinBones: THREE.Bone[];
  twinActs: Map<THREE.AnimationClip, THREE.AnimationAction>;
}
function skeleton(): { root: THREE.Group; bones: THREE.Bone[] } {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.fromArray(target.base.p);
  inner.quaternion.fromArray(target.base.q);
  root.add(inner);
  const made: THREE.Bone[] = [];
  target.joints.forEach((j) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.restP);
    b.quaternion.fromArray(j.restQ);
    made.push(b);
    (j.parent < 0 ? inner : made[j.parent]).add(b);
  });
  return { root, bones: made };
}
function figure(): Figure {
  const group = new THREE.Group();
  const s = skeleton();
  group.add(s.root);
  const rig = CharacterRig.fromCharacter({ group: s.root, clips } as never);
  const twin = skeleton();
  return { group, root: s.root, rig, bones: s.bones, twinMixer: new THREE.AnimationMixer(twin.root), twinBones: twin.bones, twinActs: new Map() };
}

/** The bones' places in the rig root's frame into `out` (3 a bone). */
function poseOf(root: THREE.Object3D, bones: THREE.Bone[], out: Float64Array): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3();
  for (let i = 0; i < bones.length; i++) {
    bones[i].getWorldPosition(v).applyMatrix4(inv);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
}
/** Clip `clip` posed alone on the twin at `t`, its bones' places into `out`. */
function poseAlone(F: Figure, clip: THREE.AnimationClip, t: number, out: Float64Array): void {
  let a = F.twinActs.get(clip);
  if (!a) {
    a = F.twinMixer.clipAction(clip);
    a.play();
    F.twinActs.set(clip, a);
  }
  for (const x of F.twinActs.values()) x.setEffectiveWeight(x === a ? 1 : 0);
  a.time = Math.max(0, Math.min(clip.duration, t));
  F.twinMixer.update(0);
  poseOf(F.twinBones[0].parent!.parent!, F.twinBones, out);
}
const most = (u: Float64Array, w: Float64Array) => {
  let m = 0;
  for (let i = 0; i < u.length; i += 3) m = Math.max(m, Math.hypot(u[i] - w[i], u[i + 1] - w[i + 1], u[i + 2] - w[i + 2]));
  return m;
};
const P0 = new Float64Array(512 * 3);
const P1 = new Float64Array(512 * 3);
/** The largest a bone moves in the twin, clip `clip` posed alone at `t0` and then `t1` (through its end where it loops round). */
function ownMove(F: Figure, clip: THREE.AnimationClip, t0: number, t1: number, loops: boolean): number {
  const n = F.twinBones.length * 3;
  const p0 = P0.subarray(0, n);
  const p1 = P1.subarray(0, n);
  if (loops && t1 < t0) {
    poseAlone(F, clip, t0, p0);
    poseAlone(F, clip, clip.duration, p1);
    const one = most(p0, p1);
    poseAlone(F, clip, 0, p0);
    poseAlone(F, clip, t1, p1);
    return one + most(p0, p1);
  }
  poseAlone(F, clip, t0, p0);
  poseAlone(F, clip, t1, p1);
  return most(p0, p1);
}
/** How far apart two clips' poses stand (the largest bone's), each at its own time: what a crossfade between them must cover. */
function apart(F: Figure, a: THREE.AnimationClip, ta: number, b: THREE.AnimationClip, tb: number): number {
  const n = F.twinBones.length * 3;
  poseAlone(F, a, ta, P0.subarray(0, n));
  poseAlone(F, b, tb, P1.subarray(0, n));
  return most(P0.subarray(0, n), P1.subarray(0, n));
}
/** The game's hang frame on the figure after the body's: the clips (the player's `animateHang`), the figure placed, the limbs. */
function drawHang(b: TestBody, F: Figure, lp: Limbs, st: HangState, dt: number, posed?: () => void): void {
  const L = b.ledge;
  if (!L.holding) return;
  driveHangClips(F.rig, L, dt, st);
  // (The mixer's own pose, before the limbs are put on the lip: what the clips' blends alone make of the figure.)
  posed?.();
  F.group.position.set(b.pos.x, b.pos.y, b.pos.z);
  F.group.rotation.set(0, L.heading, 0);
  const h = L.heading;
  F.root.position.set(L.offX * Math.cos(h) - L.offZ * Math.sin(h), L.offY, L.offX * Math.sin(h) + L.offZ * Math.cos(h));
  F.root.quaternion.set(0, 0, 0, 1);
  if (L.tilted) L.applyTilt(F.root);
  F.group.updateMatrixWorld(true);
  L.limbsFor(lp, F.rig as never, null);
  lp.filter = b.filter;
  lp.place(F.rig as never, b.physics.world, null);
  F.group.updateMatrixWorld(true);
}

/** Every action the rig's mixer has running with any weight: its clip, its time, whether it loops. */
function playing(rig: Rig): { clip: THREE.AnimationClip; time: number; loops: boolean; action: THREE.AnimationAction }[] {
  const m = rig.mixer as unknown as { _actions: THREE.AnimationAction[]; _nActiveActions: number };
  const out: { clip: THREE.AnimationClip; time: number; loops: boolean; action: THREE.AnimationAction }[] = [];
  for (let i = 0; i < m._nActiveActions; i++) {
    const a = m._actions[i];
    if (a.getEffectiveWeight() > 1e-6) out.push({ clip: a.getClip(), time: a.time, loops: a.loop === THREE.LoopRepeat, action: a });
  }
  return out;
}

const resetAll = (blend: boolean, each: boolean) => {
  resetClimbTune();
  resetMoveTune();
  tuneClimb({ transitions: blend ? 'blend' : 'before', slopeHands: each ? 'each' : 'before' });
};
resetAll(true, true);
ok(CLIMB_TUNE.transitions === 'blend' && CLIMB_TUNE.slopeHands === 'each', "the round ships transitions blended and each hand on its own place on a sloping lip");

// ---- 1. item 2: transitions with no jump and no freeze ----------------------------------------------------------------------
// Measured on the mixer's own pose (the rig's bones as its clips and their blends leave them, in the rig root's frame, before
// the limbs are put on the lip: the hands and feet placed are items 4 and 5's and wave 4's), over every frame a one-off plays:
//  - a jump: a frame moving any bone more than `poseJump` times what the clips playing move it on their own plus what a
//    crossfade between the two weightiest must cover spread over the round's `transitionBlend` (their poses' distance apart);
//  - a freeze: the pose standing still over more than a frame while a clip playing moves on its own;
//  - the line-up (the rig root in the body's frame) against its own move the frame before, reported (a shimmy's start moves it
//    under either setting: wave 4's anchor, not a one-off's blend).
interface Measure {
  jump: number;
  spring: number;
  freeze: number;
  frames: number;
  where: string;
}
const OWN_FLOOR = 0.05; // m/s: a pose may move this fast in a frame with clips that stand still (the floor of "their own")
async function transitions(fps: number, blend: boolean): Promise<Measure> {
  resetAll(blend, true);
  const s = await standPiece(piece('gap-side-1.5'));
  const { b, w } = bodyAt(s, 'onA', fps);
  const F = figure();
  b.ledgeScale = figureScaleOf(F.rig as never);
  const lp = new LimbPlace(null);
  const st: HangState = { posePlaying: '', hangFade: { fade: CLIMB_TUNE.ease }, ladderRate: { rate: 1, fade: CLIMB_TUNE.ease } };
  const dt = 1 / fps;
  const now = new Float64Array(F.bones.length * 3);
  const was = new Float64Array(F.bones.length * 3);
  const times = new Map<THREE.AnimationAction, number>();
  const rootWas = new THREE.Vector3();
  let springWas = -1;
  let have = false;
  const m: Measure = { jump: 0, spring: 0, freeze: 0, frames: 0, where: '' };
  let still = 0;
  const posed = () => poseOf(F.root, F.bones, now);
  const hold = b.frame.bind(b);
  b.frame = (t: number) => {
    hold(t);
    if (!b.ledge.holding) {
      have = false;
      return;
    }
    drawHang(b, F, lp, st, dt, posed);
    const act = playing(F.rig);
    let own = OWN_FLOOR * dt;
    for (const x of act) {
      const t0 = times.get(x.action);
      if (t0 !== undefined) own = Math.max(own, ownMove(F, x.clip, t0, x.time, x.loops));
    }
    times.clear();
    for (const x of act) times.set(x.action, x.time);
    const oneOff = act.some((x) => !x.loops);
    if (have && oneOff) {
      // The two weightiest: what a crossfade between them covers, spread over the round's blend.
      const by = act.slice().sort((p, q) => q.action.getEffectiveWeight() - p.action.getEffectiveWeight());
      const spread = by.length > 1 ? (apart(F, by[0].clip, by[0].time, by[1].clip, by[1].time) * dt) / Math.max(dt, CLIMB_TUNE.transitionBlend) : 0;
      const moved = most(now, was);
      const r = moved / (own + spread);
      if (r > m.jump) {
        m.jump = r;
        m.where = `${(moved * 100).toFixed(2)} cm, ${b.ledge.move.kind} ${act.map((x) => x.clip.name + '@' + x.time.toFixed(2) + 'x' + x.action.getEffectiveWeight().toFixed(2)).join(' ')}`;
      }
      // A freeze: the pose standing still while a clip playing moves on its own.
      if (moved < 1e-6 && own > OWN_FLOOR * dt * 2) still++;
      else still = 0;
      m.freeze = Math.max(m.freeze, still);
      m.frames++;
    }
    if (have) {
      // The line-up (the rig root in the body's frame): never springing against its own move the frame before.
      const sp = F.root.position.distanceTo(rootWas);
      if (springWas >= 0) m.spring = Math.max(m.spring, sp / Math.max(springWas, OWN_FLOOR * dt));
      springWas = sp;
    }
    rootWas.copy(F.root.position);
    was.set(now);
    have = true;
  };
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 2.5, () => b.ledge.phase === LEDGE_HANG);
  b.key('KeyE', false);
  runUntil(b, fps, 0.6, () => false);
  shimmy(s, b, w, 'KeyD', fps);
  runUntil(b, fps, 0.5, () => false);
  b.key('KeyD', true);
  tap(b, 'Space', fps);
  b.key('KeyD', false);
  let left = false;
  runUntil(b, fps, 3, () => {
    if (b.ledge.phase !== LEDGE_HANG) left = true;
    return left && b.ledge.phase === LEDGE_HANG;
  });
  runUntil(b, fps, 0.8, () => false);
  b.frame = hold;
  b.physics.world.removeRigidBody(b.body);
  return m;
}
for (const fps of RATES) {
  const m = await transitions(fps, true);
  const o = await transitions(fps, false);
  ok(m.frames > fps, `@${fps}: a grab's and a hop's one-offs measured, in and out (${m.frames} frames)`);
  ok(m.jump <= CLIMB_TUNE.poseJump, `@${fps}: no bone jumps: the worst frame moves ${m.jump.toFixed(2)} times the clips' own and their crossfade's (under ${CLIMB_TUNE.poseJump}; ${m.where})`);
  ok(m.freeze <= 1, `@${fps}: no freeze: the pose never stands still over more than a frame while a clip playing moves (${m.freeze})`);
  note(`@${fps}: under 'before' the worst frame ${o.jump.toFixed(2)} (${o.where}), the longest freeze ${o.freeze} frames, the line-up's worst spring ${o.spring.toFixed(2)}; under 'blend' ${m.spring.toFixed(2)}`);
}
// ---- 2. item 8: each hand on its own place on a sloping lip, from the touch on -----------------------------------------------
// The body is stood under the sloping run (or a step's joint) so both hands land on it, grabs from a standing jump, hangs and
// shimmies along. From the grab clip's touch until the shimmy begins every hand is wholly placed and within 2 cm of the lip at
// its own place (its height there, the target `limbsFor` hands the limbs, which is the lip under that hand); through the
// shimmy, whose clip lifts each hand off the lip in turn, every hand wholly placed is within 2 cm, and how often each was not
// is counted.
interface HandTally {
  frames: number;
  worst: number;
  short: number;
  lower: number;
  lifted: number;
  shimmyWorst: number;
  touchSeen: boolean;
  off: number;
}
/** Where on the course (its own x) the hands land on a piece's sloping run or step joint, and how high the lip is there. */
const GRAB_X: Record<string, number> = { 'slope-15': -0.38, 'slope-25': -0.86, 'slope-35': -1.07, 'slope-38': -1.12, 'steps-0.2': -0.75, 'steps-0.35': -0.75 };
async function slope(id: string, fps: number, each: boolean): Promise<HandTally> {
  resetAll(true, each);
  const s = await standPiece(piece(id));
  const { b, w } = bodyAt(s, 'stand', fps);
  // Under the sloping run: the course's x is the world's -x (`standPiece`), the start's own x known.
  const st0 = s.piece.starts[0].at[0];
  b.place(b.pos.x - (GRAB_X[id] - st0), b.pos.y, b.pos.z);
  b.run(fps, 0.3);
  const F = figure();
  b.ledgeScale = figureScaleOf(F.rig as never);
  const lp = new LimbPlace(null);
  const st: HangState = { posePlaying: '', hangFade: { fade: CLIMB_TUNE.ease }, ladderRate: { rate: 1, fade: CLIMB_TUNE.ease } };
  const dt = 1 / fps;
  const t: HandTally = { frames: 0, worst: 0, short: 0, lower: 0, lifted: 0, shimmyWorst: 0, touchSeen: false, off: 0 };
  const g = new THREE.Vector3();
  let touched = false;
  let shimmying = false;
  const hold = b.frame.bind(b);
  b.frame = (tt: number) => {
    hold(tt);
    const L = b.ledge;
    if (!L.holding) return;
    drawHang(b, F, lp, st, dt);
    const m = L.move;
    if (L.phase === LEDGE_MOVE && m.kind === 'grab' && m.time >= handMoment(m.id, 'touch') - 1e-9) touched = true;
    if (L.phase === LEDGE_HANG) touched = true;
    if (!touched) return;
    t.touchSeen = true;
    t.frames++;
    for (let k = 0; k < 2; k++) {
      lp.gripNow(F.rig as never, k, null, g);
      const tx = lp.hand[k * 3];
      const ty = lp.hand[k * 3 + 1];
      const tz = lp.hand[k * 3 + 2];
      // (Wholly placed to a hundredth: the near share's last thousandths are a hand already on its place.)
      const whole = lp.handW[k] >= 0.99;
      const d = Math.hypot(g.x - tx, g.y - ty, g.z - tz);
      // The target is the lip at that hand's own place (its height there, not the pair's middle).
      t.off = Math.max(t.off, nearestLip(s, tx, ty, tz).off);
      if (shimmying) {
        if (whole) t.shimmyWorst = Math.max(t.shimmyWorst, d);
        else t.lifted++;
        continue;
      }
      t.worst = Math.max(t.worst, d);
      if (d > 0.02) {
        t.short++;
        // Which hand is short: the lower one (its target below the other's).
        if (ty < lp.hand[(1 - k) * 3 + 1] - 1e-3) t.lower++;
      }
    }
  };
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 3, () => b.ledge.phase === LEDGE_HANG);
  b.key('KeyE', false);
  const hung = b.ledge.phase === LEDGE_HANG;
  runUntil(b, fps, 0.6, () => false);
  if (hung) {
    shimmying = true;
    shimmy(s, b, w, 'KeyD', fps, 1.5);
    runUntil(b, fps, 0.4, () => false);
  }
  b.frame = hold;
  b.physics.world.removeRigidBody(b.body);
  return t;
}
const SLOPED = ['slope-15', 'slope-25', 'slope-35', 'slope-38', 'steps-0.2', 'steps-0.35'];
for (const id of SLOPED) {
  for (const fps of RATES) {
    const e = await slope(id, fps, true);
    ok(e.touchSeen && e.frames > fps, `${id} @${fps}: grabbed on the sloping run, hung and shimmied (${e.frames} frames from the touch)`);
    ok(e.short === 0 && e.worst <= 0.02, `${id} @${fps}: from the grab clip's touch to the shimmy each hand within 2 cm of the lip at its own place (worst ${(e.worst * 100).toFixed(2)} cm)`);
    ok(e.shimmyWorst <= 0.02, `${id} @${fps}: through the shimmy each hand on the lip within 2 cm of its own place (worst ${(e.shimmyWorst * 100).toFixed(2)} cm; ${e.lifted} hand-frames lifted by the shimmy's own stride)`);
    if (fps === 60) {
      const o = await slope(id, fps, false);
      note(`${id} @60 under 'before': ${o.short} hand-frames off the lip from the touch to the shimmy (${o.lower} of them the lower hand), worst ${(o.worst * 100).toFixed(1)} cm`);
    }
  }
}resetClimbTune();
console.log(`smooth2Rig: ${checks} checks passed`);
