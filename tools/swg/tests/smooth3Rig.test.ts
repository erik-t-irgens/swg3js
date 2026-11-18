// Climbing II, Smoothness III, items 0, 1 and 4b on the game's own rig (src/player/rig.ts's `CharacterRig`, the pack's clips fitted
// to the converted human male, tools/swg/tests/climbFigure.ts's figure: the game's own hang hand-over `driveHangClips`, the ledge's
// own limbs and the spheres), driven frame by frame through the grapple's harness on the real Rapier and the course's pieces, at
// 30, 60, 144 and 240 frames a second:
//  - item 0 (a fault, no switch): over a climb up onto the top of a braced and a free lip, and the 2 s after it, the drawn hips
//    never more than 3 cm under the lower of where the climb's own last frame and the pose it crossfades into put them over the
//    capsule (the climb's line-up held whole through its crossfade into the crouch lowered the figure a metre and more under the
//    top it had climbed onto: the browser's own trace before the mend, 1.39 m braced and 1.40 m free under the capsule's feet);
//    the line-up out by the crossfade's own share, nought by the end; the capsule standing on the top; and (the review's) the
//    spheres' push the climb laid on the figure gone out with the crossfade too, the hips at the hand-back's frame moving no
//    more than the frames either side (held whole, the figure dropped 14 to 17 cm in that frame);
//  - item 1 (`climb.hopFlight` 'arc'): a braced hop sideways, a free 3 m hop sideways and a hop up: each hand within 2 cm of the
//    lip at the frame the body arrives and every frame after while the move plays; no bone jumping and no freeze while the clip
//    waits for the contact (Smoothness II's own measure: a frame's move against the clips' own and their crossfade's);
//  - item 4b (`climb.dropMove` 'drop'): a drop to the lip beneath: the hands within 2 cm of the lower lip from the arrival, and
//    no bone jumping at either join (the release's into the fall, the catch's crossfade in).
//
// Run: node tools/swg/tests/smooth3Rig.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { figure, figureScale, drawHang, HAVE_BODY, type Figure } from './climbFigure.ts';

const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { CLIMB_TUNE, DROP_PARTS, resetClimbTune, tuneClimb } = await import('../../../src/anim/climbTune.ts');
const { resetMoveTune } = await import('../../../src/anim/moveTune.ts');
const { LEDGE_HANG, LEDGE_MOVE, LEDGE_NONE } = await import('../../../src/player/ledge.ts');
const { LEDGE_REST } = await import('../../../src/anim/ledgeClips.ts');
const { bodyAt, nearestLip, runUntil, shimmy, standPiece, tap } = await import('./climbCourseBody.ts');
type TestBody = import('./grappleBody.ts').TestBody;
type Stood = import('./climbCourseBody.ts').Stood;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const piece = (id: string) => climbCourse({ extras: true, pieces: [id] }).pieces[0];
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
const V = new THREE.Vector3();
const G = new THREE.Vector3();

if (!HAVE_BODY) note('no converted human male here: the figure is the tests\' own skeleton and the spheres are none');

/** The figure's hips (the skeleton's root bone) over the body's feet, metres. */
function hipsOver(b: TestBody, F: Figure): number {
  F.group.updateMatrixWorld(true);
  return F.bones[0].getWorldPosition(V).y - b.pos.y;
}

// ---- the measure of Smoothness II's item 2, on the mixer's own pose (smooth2Rig's, as it measures it) --------------------------
function poseOf(root: THREE.Object3D, bones: THREE.Bone[], out: Float64Array): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  for (let i = 0; i < bones.length; i++) {
    bones[i].getWorldPosition(V).applyMatrix4(inv);
    out[i * 3] = V.x;
    out[i * 3 + 1] = V.y;
    out[i * 3 + 2] = V.z;
  }
}
interface Twin {
  mixer: THREE.AnimationMixer;
  bones: THREE.Bone[];
  acts: Map<THREE.AnimationClip, THREE.AnimationAction>;
}
function twinOf(F: Figure): Twin {
  const root = F.root.clone(true);
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  return { mixer: new THREE.AnimationMixer(root), bones, acts: new Map() };
}
function poseAlone(T: Twin, clip: THREE.AnimationClip, t: number, out: Float64Array): void {
  let a = T.acts.get(clip);
  if (!a) {
    a = T.mixer.clipAction(clip);
    a.play();
    T.acts.set(clip, a);
  }
  for (const x of T.acts.values()) x.setEffectiveWeight(x === a ? 1 : 0);
  a.time = Math.max(0, Math.min(clip.duration, t));
  T.mixer.update(0);
  poseOf(T.bones[0].parent!.parent!, T.bones, out);
}
const most = (u: Float64Array, w: Float64Array) => {
  let m = 0;
  for (let i = 0; i < u.length; i += 3) m = Math.max(m, Math.hypot(u[i] - w[i], u[i + 1] - w[i + 1], u[i + 2] - w[i + 2]));
  return m;
};
const P0 = new Float64Array(512 * 3);
const P1 = new Float64Array(512 * 3);
function ownMove(T: Twin, clip: THREE.AnimationClip, t0: number, t1: number): number {
  const n = T.bones.length * 3;
  poseAlone(T, clip, t0, P0.subarray(0, n));
  poseAlone(T, clip, t1, P1.subarray(0, n));
  return most(P0.subarray(0, n), P1.subarray(0, n));
}
function apart(T: Twin, a: THREE.AnimationClip, ta: number, c: THREE.AnimationClip, tc: number): number {
  const n = T.bones.length * 3;
  poseAlone(T, a, ta, P0.subarray(0, n));
  poseAlone(T, c, tc, P1.subarray(0, n));
  return most(P0.subarray(0, n), P1.subarray(0, n));
}
function playing(F: Figure): { clip: THREE.AnimationClip; time: number; loops: boolean; action: THREE.AnimationAction }[] {
  const m = F.rig.mixer as unknown as { _actions: THREE.AnimationAction[]; _nActiveActions: number };
  const out: { clip: THREE.AnimationClip; time: number; loops: boolean; action: THREE.AnimationAction }[] = [];
  for (let i = 0; i < m._nActiveActions; i++) {
    const a = m._actions[i];
    if (a.getEffectiveWeight() > 1e-6) out.push({ clip: a.getClip(), time: a.time, loops: a.loop === THREE.LoopRepeat, action: a });
  }
  return out;
}
const OWN_FLOOR = 0.05;
/**
 * The rig's mixer's own pose (the clips and their blends, before the limbs are put on the lip, which drawHang has already done to
 * the figure's bones): every action the rig has running posed on the twin at its own time and weight, the twin's bones read.
 */
function mixerPose(F: Figure, T: Twin, out: Float64Array): void {
  for (const a of T.acts.values()) a.setEffectiveWeight(0);
  for (const x of playing(F)) {
    let a = T.acts.get(x.clip);
    if (!a) {
      a = T.mixer.clipAction(x.clip);
      a.play();
      T.acts.set(x.clip, a);
    }
    a.time = x.time;
    a.setEffectiveWeight(x.action.getEffectiveWeight());
  }
  T.mixer.update(0);
  poseOf(T.bones[0].parent!.parent!, T.bones, out);
}

/** What a one-off's frames showed: the worst jump (Smoothness II's measure), the longest freeze, each hand's worst off its lip from the arrival. */
interface Watch {
  jump: number;
  freeze: number;
  where: string;
  handWorst: number;
  handAt: string;
  handFrames: number;
  touchSeen: boolean;
  touchWorst: number;
  touchBest: number;
  touchShare: number;
  frames: number;
}
/** The figure drawn on the body every frame it holds (the player's hang frame), measuring one-offs from `armed()` on. */
function watchMove(b: TestBody, s: Stood, F: Figure, fps: number, armed: () => boolean): Watch {
  const dt = 1 / fps;
  const T = twinOf(F);
  const now = new Float64Array(F.bones.length * 3);
  const was = new Float64Array(F.bones.length * 3);
  const times = new Map<THREE.AnimationAction, number>();
  const W: Watch = { jump: 0, freeze: 0, where: '', handWorst: 0, handAt: '', handFrames: 0, touchSeen: false, touchWorst: 0, touchBest: Number.POSITIVE_INFINITY, touchShare: 1, frames: 0 };
  let have = false;
  let still = 0;
  const hold = b.frame.bind(b);
  b.frame = (t: number) => {
    hold(t);
    const L = b.ledge;
    if (!L.holding) {
      have = false;
      return;
    }
    drawHang(b, F, dt);
    mixerPose(F, T, now);
    if (!armed()) {
      have = false;
      return;
    }
    const act = playing(F);
    let own = OWN_FLOOR * dt;
    for (const x of act) {
      const t0 = times.get(x.action);
      if (t0 !== undefined && x.time >= t0) own = Math.max(own, ownMove(T, x.clip, t0, x.time));
      else if (t0 !== undefined) own = Math.max(own, ownMove(T, x.clip, x.time, t0));
    }
    // (A clip that played last frame and plays no more finished its crossfade this frame: what that last step covered counts as
    // the crossfade's too, which Smoothness II's measure, reading only the clips still playing, did not see.)
    let gone: { clip: THREE.AnimationClip; time: number } | null = null;
    for (const [a, t0] of times) if (!act.some((x) => x.action === a)) gone = { clip: a.getClip(), time: t0 };
    times.clear();
    for (const x of act) times.set(x.action, x.time);
    // (Smoothness II's measure: a frame a one-off plays in, the loops' own frames being the hang's.)
    if (have && L.phase === LEDGE_MOVE && act.some((x) => !x.loops)) {
      const by = act.slice().sort((p, q) => q.action.getEffectiveWeight() - p.action.getEffectiveWeight());
      const other = by.length > 1 ? by[1] : gone;
      const spread = other ? (apart(T, by[0].clip, by[0].time, other.clip, other.time) * dt) / Math.max(dt, CLIMB_TUNE.transitionBlend) : 0;
      const moved = most(now, was);
      const r = moved / (own + spread);
      if (r > W.jump) {
        W.jump = r;
        W.where = `${(moved * 100).toFixed(2)} cm at ${L.move.time.toFixed(3)} s, ${act.map((x) => x.clip.name + '@' + x.time.toFixed(2) + 'x' + x.action.getEffectiveWeight().toFixed(2)).join(' ')}`;
      }
      // A freeze: the pose standing still while a clip playing moves on its own (a hold the move means is a clip standing still).
      if (moved < 1e-6 && own > OWN_FLOOR * dt * 2) still++;
      else still = 0;
      W.freeze = Math.max(W.freeze, still);
      W.frames++;
    }
    was.set(now);
    have = true;
    // The hands at the frame the body arrives (the flight over: the clip's touch), each hand off the lip (the course's own
    // lips); and after it, while the clip settles, each wholly placed hand's worst (a note: the clip's own settle lifts a hand).
    const m = L.move;
    const arrived = L.phase === LEDGE_MOVE && (m.arc ? m.fly >= m.F : m.timed && m.time >= m.tT - 1e-9);
    for (let k = 0; k < 2 && arrived; k++) {
      // (The hand's grip point against its place on the lip, the target the ledge hands the limbs: on the lip's grip line,
      // `gripDrop` under its top and `gripOut` out from its face, which the target is checked to stand on, the course's own lip.)
      F.lp.gripNow(F.rig as never, k, null, G);
      const tx = F.lp.hand[k * 3];
      const ty = F.lp.hand[k * 3 + 1];
      const tz = F.lp.hand[k * 3 + 2];
      const line = Math.hypot(CLIMB_TUNE.gripOut, CLIMB_TUNE.gripDrop) * b.ledgeScale;
      const onLip = Math.abs(nearestLip(s, tx, ty, tz).off - line);
      const off = Math.max(Math.hypot(G.x - tx, G.y - ty, G.z - tz), onLip);
      if (!W.touchSeen) {
        W.touchWorst = Math.max(W.touchWorst, off);
        W.touchBest = Math.min(W.touchBest, off);
        W.touchShare = Math.min(W.touchShare, F.lp.handW[k]);
        continue;
      }
      if (!(F.lp.handW[k] >= 0.99)) continue;
      if (off > W.handWorst) W.handAt = `${k ? 'right' : 'left'} at ${m.time.toFixed(3)} s (touch ${m.tT.toFixed(3)})`;
      W.handWorst = Math.max(W.handWorst, off);
      W.handFrames++;
    }
    if (arrived) W.touchSeen = true;
  };
  return W;
}

// ---- 1. item 0: the climb up onto the top, and the 2 s after ---------------------------------------------------------------------
async function topOut(id: string, fps: number): Promise<{ lowest: number; offEnd: number; onTop: boolean; lowestBefore: number; step: number; around: number }> {
  resetClimbTune();
  resetMoveTune();
  const s = await standPiece(piece(id));
  const { b } = bodyAt(s, 'stand', fps);
  const F = figure();
  b.ledgeScale = figureScale(F);
  const dt = 1 / fps;
  let lowest = Number.POSITIVE_INFINITY;
  let lowestBefore = Number.POSITIVE_INFINITY;
  let blending = false;
  let upAt = Number.NaN;
  let topY = Number.NaN;
  // (The review's: the hips over the feet each frame from the climb's crossfade on, and the hand-back's frame among them.)
  const series: number[] = [];
  let backAt = -1;
  const hold = b.frame.bind(b);
  b.frame = (t: number) => {
    hold(t);
    const L = b.ledge;
    // (The hand-back's own frame drawn as the frames after it are: the figure off the ledge, its push let go.)
    if (!(upAt === upAt) && L.phase === LEDGE_NONE && L.lastLetGo === 'climbed up') {
      upAt = b.t;
      topY = b.pos.y;
      backAt = series.length;
    }
    // (The hand-back's own frame is still the player's hang frame, which draws the figure and its limbs as the hold ends: the
    // ledge held the body when the frame began.)
    if (L.holding || backAt === series.length) drawHang(b, F, dt);
    else if (upAt === upAt) {
      // After the hand-back: the rig steps on (its crossfade into what follows), its root where the ledge's eased offset puts it.
      F.rig.update(dt);
      const h = b.heading;
      F.group.position.set(b.pos.x, b.pos.y, b.pos.z);
      F.group.rotation.set(0, h, 0);
      F.root.position.set(L.offX * Math.cos(h) - L.offZ * Math.sin(h), L.offY, L.offX * Math.sin(h) + L.offZ * Math.cos(h));
    }
    if (L.phase === LEDGE_MOVE && L.move.kind === 'climb' && L.move.blending) blending = true;
    if (blending || upAt === upAt) lowest = Math.min(lowest, hipsOver(b, F));
    if ((blending || upAt === upAt) && series.length < backAt + 8 + (backAt < 0 ? 1e9 : 0)) series.push(hipsOver(b, F));
    if (L.phase === LEDGE_MOVE && L.move.kind === 'climb' && !blending) lowestBefore = Math.min(lowestBefore, hipsOver(b, F));
  };
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 3, () => hangs(b));
  b.key('KeyE', false);
  runUntil(b, fps, 0.6, () => false);
  b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
  b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
  b.key('KeyW', true);
  runUntil(b, fps, 6, () => upAt === upAt);
  b.key('KeyW', false);
  runUntil(b, fps, 2, () => false);
  const offEnd = Math.hypot(b.ledge.offX, b.ledge.offY, b.ledge.offZ);
  const onTop = upAt === upAt && b.grounded && Math.abs(b.pos.y - topY) < 0.01;
  b.frame = hold;
  b.physics.world.removeRigidBody(b.body);
  // The hand-back's frame against the frames either side: the hips' step there no bigger than the frames' own (and a centimetre).
  let step = Number.NaN;
  let around = Number.NaN;
  if (backAt >= 2 && backAt + 1 < series.length) {
    step = series[backAt] - series[backAt - 1];
    around = Math.max(Math.abs(series[backAt - 1] - series[backAt - 2]), Math.abs(series[backAt + 1] - series[backAt]));
  }
  return { lowest, offEnd, onTop, lowestBefore, step, around };
}
for (const id of ['lip-braced-2.4', 'lip-free-2.4', 'shelves-1']) {
  for (const fps of RATES) {
    const r = await topOut(id, fps);
    ok(r.onTop, `${id} @${fps}: climbed up and standing on the top 2 s later`);
    // The crossfade takes the hips from where the climb draws them to where the pose it goes into stands them on the capsule
    // (in node the rest pose: the pack's ledge clips carry no crouch of their own), so never lower than the lower of the two.
    ok(r.lowest >= Math.min(r.lowestBefore, LEDGE_REST.hips) - 0.03, `${id} @${fps}: through the climb's crossfade into what follows and the 2 s after it the drawn hips stand at least ${r.lowest.toFixed(3)} m over the capsule's feet (the climb's own lowest before its crossfade ${r.lowestBefore.toFixed(3)} m, the rest pose's ${LEDGE_REST.hips}; never a metre under the top as before the mend)`);
    ok(r.offEnd < 1e-9, `${id} @${fps}: the climb's line-up all gone 2 s after the top-out (${r.offEnd.toExponential(1)} m)`);
    // The review's: the spheres' push the climb laid on the figure (its feet's spheres in the top it stands on) goes out with the
    // crossfade (`LimbPlace.pushKeep`), never dropped at the hand-back (held whole, the hips fell 14 to 17 cm in that one frame).
    ok(CLIMB_TUNE.bodyClear === 'spheres' && Math.abs(r.step) <= r.around + 0.01, `${id} @${fps}: the hips at the hand-back's frame move ${(r.step * 100).toFixed(1)} cm, no more than the frames either side (${(r.around * 100).toFixed(1)} cm) and a centimetre (bodyClear 'spheres')`);
  }
}

// ---- 2. item 1: hops, the hands on the lip as the body arrives, no jump and no freeze -------------------------------------------
async function hopRig(id: string, fps: number, key: 'KeyD' | 'KeyW', tune: Record<string, unknown>): Promise<Watch> {
  resetClimbTune();
  resetMoveTune();
  tuneClimb(tune);
  const s = await standPiece(piece(id));
  const { b, w } = bodyAt(s, 'onA', fps);
  const F = figure();
  b.ledgeScale = figureScale(F);
  let go = false;
  const W = watchMove(b, s, F, fps, () => go);
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 2.5, () => hangs(b));
  b.key('KeyE', false);
  runUntil(b, fps, 0.6, () => false);
  if (key === 'KeyW') shimmy(s, b, w, 'KeyD', fps, 20, 4);
  else shimmy(s, b, w, 'KeyD', fps);
  runUntil(b, fps, 0.4, () => false);
  b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
  b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
  b.key(key, true);
  runUntil(b, fps, 2, () => b.ledge.cue >= 0.99);
  go = true;
  tap(b, 'Space', fps);
  b.key(key, false);
  let left = false;
  runUntil(b, fps, 4, () => {
    if (!hangs(b)) left = true;
    return left && hangs(b);
  });
  b.physics.world.removeRigidBody(b.body);
  return W;
}
for (const [id, key, tune, words] of [['gap-side-1.5', 'KeyD', {}, 'a braced hop sideways'], ['free-gap-side-3.0', 'KeyD', { hopSide: 3.5 }, 'a free 3 m hop sideways'], ['gap-updown-1.5', 'KeyW', {}, 'a hop up']] as const) {
  for (const fps of RATES) {
    const W = await hopRig(id, fps, key, tune);
    // (A free hop's touch is its leading hand's, the owner's: "both hands never leave the ledge ... 0.75 the leading hand"; the other
    // follows a fifth of a second later in its clip, as under Smoothness II's timed hop.)
    if (id.startsWith('free')) ok(W.touchSeen && W.touchBest <= 0.02 && W.touchShare >= 0.99, `${words} @${fps}: the leading hand wholly placed and within 2 cm of the lip in the frame the body arrives (${(W.touchBest * 100).toFixed(2)} cm; the trailing one ${(W.touchWorst * 100).toFixed(1)} cm, still on its way in its clip)`);
    else ok(W.touchSeen && W.touchWorst <= 0.02 && W.touchShare >= 0.99, `${words} @${fps}: each hand wholly placed and within 2 cm of the lip in the frame the body arrives (worst ${(W.touchWorst * 100).toFixed(2)} cm)`);
    note(`${words} @${fps}: after the arrival, while the clip settles, a wholly placed hand at worst ${(W.handWorst * 100).toFixed(2)} cm off the lip (${W.handAt}; ${W.handFrames} hand-frames)`);
    ok(W.jump <= CLIMB_TUNE.poseJump, `${words} @${fps}: no bone jumps (worst ${W.jump.toFixed(2)} times the clips' own, under ${CLIMB_TUNE.poseJump}; ${W.where})`);
    ok(W.freeze <= 1, `${words} @${fps}: no freeze while the clip waits for the contact (${W.freeze})`);
  }
}

// ---- 3. item 4b: a drop to the lip beneath on its own move -----------------------------------------------------------------------
for (const fps of RATES) {
  resetClimbTune();
  resetMoveTune();
  const s = await standPiece(piece('gap-updown-1.5'));
  const { b, w } = bodyAt(s, 'onA', fps);
  const F = figure();
  b.ledgeScale = figureScale(F);
  let go = false;
  const W = watchMove(b, s, F, fps, () => go);
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 2.5, () => hangs(b));
  b.key('KeyE', false);
  runUntil(b, fps, 0.3, () => false);
  shimmy(s, b, w, 'KeyD', fps, 20, 4);
  b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
  b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
  b.key('KeyW', true);
  runUntil(b, fps, 2, () => b.ledge.cue >= 0.99);
  tap(b, 'Space', fps);
  b.key('KeyW', false);
  runUntil(b, fps, 4, () => hangs(b) && b.ledge.lip.ey > 3);
  runUntil(b, fps, 0.6, () => false);
  go = true;
  const ids = new Set<string>();
  tap(b, 'ControlLeft', fps);
  runUntil(b, fps, 5, () => {
    if (b.ledge.phase === LEDGE_MOVE) ids.add(b.ledge.move.id);
    return hangs(b);
  });
  ok(ids.has(DROP_PARTS.braced) && ids.has(DROP_PARTS.catchBraced) && hangs(b) && b.ledge.lip.ey < 3, `a drop @${fps}: on its own move (${[...ids].join(', ')}) onto the lip beneath`);
  ok(W.touchSeen && W.touchWorst <= 0.02 && W.touchShare >= 0.99, `a drop @${fps}: each hand wholly placed and within 2 cm of the lower lip in the frame the body arrives (worst ${(W.touchWorst * 100).toFixed(2)} cm)`);
  note(`a drop @${fps}: after the arrival a wholly placed hand at worst ${(W.handWorst * 100).toFixed(2)} cm off the lip (${W.handAt})`);
  ok(W.jump <= CLIMB_TUNE.poseJump, `a drop @${fps}: no bone jumps at either join (worst ${W.jump.toFixed(2)} times the clips' own and their crossfade's, under ${CLIMB_TUNE.poseJump}; ${W.where})`);
  ok(W.freeze <= 1, `a drop @${fps}: no freeze (${W.freeze})`);
  b.physics.world.removeRigidBody(b.body);
}
resetClimbTune();
resetMoveTune();
console.log(`smooth3Rig: ${checks} checks passed`);
