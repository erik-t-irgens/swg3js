// Climbing II, phase 2 (maker B: items 6 and 7, and the faults phase 1 found), through the game's own movement, ledges and wall
// climb on the real Rapier (the course's harness over the grapple's TestBody), frame by frame while moving, at 30, 60, 144 and
// 240 frames a second, on the course's own pieces (src/anim/climbCourse.ts), and where a pose is asked of, on a skeleton the
// game draws (the converted human male's where the packs are here, else the tests' own) posed by the very clips the pack fits
// for it, through the very limbs' solve the player hands them to:
//  6. on a wall A or D alone plays the braced shimmy clip of that way at the rate that keeps its hands where they are, the body
//     going along at the sideways speed as before (`climb.wallSide`); every hand and foot the clip plants is held on its hold
//     until that limb's next reach, one limb reaching in turn at a time, while climbing diagonally (`climb.wallLimbs`): a held
//     limb's hold never moves, its posed grip or ball stands on it, no held foot's hold stands past its leg's reach, and no more
//     than one limb reaches in turn at once (a limb carried past `holdMost` or out of its leg's reach reaches at once, forced,
//     and those are counted: on a diagonal at the shipped most they are most of the reaches);
//  7. braced and still, the view turned past `lookStart` turns the spine toward it by `lookTwist`, the leading hand leaves the
//     lip into the hop clip's coil (the trailing hand staying on its lip within a centimetre) and reaches toward the view;
//     Space alone then hops to a lip behind in the view's way, turning round the leading side's way, else jumps a little off
//     (`climb.lookAway`); under the threshold nothing moves;
//  and the faults (each switch's other word the fault as phase 1 found it, shown here too): the turn at a lip's end the same at
//  every rate (`climb.corners`), a top too thin to stand on hung from (`climb.thinTop`), a slope exactly at the limit shimmied
//  along (`climb.slopeLimit`), a lip the reach band passed between two frames grabbed (`climb.grabSweep`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { CLIMB_TUNE, CLIMB_TUNE_SHIPPED, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { climbCourse, type CoursePiece } from '../../../src/anim/climbCourse.ts';
import { LEDGE_HANG, LEDGE_MOVE } from '../../../src/player/ledge.ts';
import { WALL_ON } from '../../../src/player/wallClimb.ts';
import { LEDGE_FACTS, LEDGE_ROLES } from '../../../src/anim/ledgeClips.ts';
import { PALM_OFF, WALL_ALL_IDS, WALL_CLIPS, WALL_CLIP_NAMES, WALL_FACTS, WALL_PLANT, WALL_SIDE } from '../../../src/anim/wallClips.ts';
import { BALL_OFF, LimbPlace } from '../../../src/player/limbPlace.ts';
import { Group, RAPIER, groups } from '../../../src/core/physics.ts';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { LOOK_BACK_DEG, bodyAt, jump, lookHop, nearestLip, runCourse, runUntil, standPiece, tap, type Stood } from './climbCourseBody.ts';
import { TestBody, box, ground, makePhysics, type Physics } from './grappleBody.ts';
import { glbSkeleton, speciesBodies, targetSkeleton } from './animFixtures.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const n3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const RATES = [30, 60, 144, 240] as const;
const piece = (id: string): CoursePiece => climbCourse({ pieces: [id] }).pieces[0];
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
const DEG = Math.PI / 180;
const ALL = groups(Group.all, Group.all);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const LOOK_BACK_DEG_LOCAL = LOOK_BACK_DEG;

resetClimbTune();
ok(CLIMB_TUNE.wallSide === 'shimmy' && CLIMB_TUNE.wallLimbs === 'held' && CLIMB_TUNE.lookAway === 'reach' && CLIMB_TUNE.corners === 'ramp' && CLIMB_TUNE.thinTop === 'hang' && CLIMB_TUNE.slopeLimit === 'inclusive' && CLIMB_TUNE.grabSweep === 'swept', "maker B's switches ship on: the wall's shimmy and holds, the look-away, and the four faults mended");

/** A body at a piece's start grabbed onto its lip by a standing jump (null where it was not). */
async function grabbed(id: string, start: string, fps: number): Promise<{ s: Stood; b: TestBody } | null> {
  const s = await standPiece(piece(id));
  const { b } = bodyAt(s, start, fps);
  return jump(b, 'stand', fps).ok ? { s, b } : null;
}
/** The camera turned `deg` from the way the body faces (positive to its left). */
function view(b: TestBody, deg: number): void {
  const v = b.heading + deg * DEG;
  b.forward.set(Math.sin(v), 0, Math.cos(v));
  b.right.set(-Math.cos(v), 0, Math.sin(v));
}

// ---- 6. sideways on a wall: the braced shimmy clips -----------------------------------------------------------------------------
const PACE = Math.abs(LEDGE_FACTS[WALL_SIDE.right].net[0]) / LEDGE_FACTS[WALL_SIDE.right].dur;
for (const fps of RATES) {
  for (const side of ['shimmy', 'before'] as const) {
    resetClimbTune();
    tuneClimb({ wallSide: side });
    const s = await standPiece(piece('wall-10'));
    const { b } = bodyAt(s, 'stand', fps);
    // E held with W into the wall: on it as the face comes into reach, then up with W alone.
    b.key('KeyE', true);
    b.key('KeyW', true);
    runUntil(b, fps, 2, () => b.wall.holding);
    b.key('KeyE', false);
    runUntil(b, fps, 1.5, () => false);
    b.key('KeyW', false);
    const W = b.wall;
    let frames = 0;
    let wrong = 0;
    let worst = 0;
    for (const [key, state, clip] of [['KeyD', 'wallRight', side === 'shimmy' ? WALL_SIDE.right : WALL_CLIPS.up], ['KeyA', 'wallLeft', side === 'shimmy' ? WALL_SIDE.left : WALL_CLIPS.up]] as const) {
      b.key(key, true);
      for (let i = 0; i < fps; i++) {
        const x0 = b.pos.x;
        const z0 = b.pos.z;
        b.frame(1 / fps);
        if (W.phase !== WALL_ON) {
          wrong++;
          continue;
        }
        frames++;
        const rate = side === 'shimmy' ? CLIMB_TUNE.wallSpeed.side / PACE : CLIMB_TUNE.wallSpeed.side / WALL_FACTS[WALL_CLIPS.up].stride;
        if (W.rigState !== state || W.rigClip !== clip || Math.abs(W.rate - rate) > 1e-9) wrong++;
        worst = Math.max(worst, Math.abs(Math.hypot(b.pos.x - x0, b.pos.z - z0) - CLIMB_TUNE.wallSpeed.side / fps));
      }
      b.key(key, false);
    }
    ok(frames === 2 * fps && wrong === 0 && worst < 1e-6, `${fps} fps, wallSide ${side}: D and A on a wall play ${side === 'shimmy' ? `the braced shimmy clips (${WALL_SIDE.right}, ${WALL_SIDE.left}) at the sideways speed over their pace (${n3(CLIMB_TUNE.wallSpeed.side / PACE)})` : `the up clip slowed, as before (${n3(CLIMB_TUNE.wallSpeed.side / WALL_FACTS[WALL_CLIPS.up].stride)})`}, every frame on the wall, the body going along at ${CLIMB_TUNE.wallSpeed.side} m/s (worst ${(worst * 1000).toFixed(4)} mm a frame off)`);
  }
}

// ---- 7. braced, looking away: the look, its pose, and the hop behind -------------------------------------------------------------
for (const fps of RATES) {
  resetClimbTune();
  const g = await grabbed('gap-behind-2.0', 'onA', fps);
  assert.ok(g, `${fps} fps: grabbed A`);
  const { b } = g!;
  const L = b.ledge;
  const h0 = b.heading;
  // Under the threshold: nothing.
  view(b, -(CLIMB_TUNE.lookStart - 10));
  runUntil(b, fps, 0.4, () => false);
  const quiet = L.look === 0 && L.lookSide === 0 && L.poseClip === '' && L.lookTwistNow === 0;
  // Past it, to the right: the right hand leads.
  view(b, -LOOK_BACK_DEG_LOCAL);
  const need = Math.ceil(CLIMB_TUNE.ease * fps - 1e-9);
  let steady = true;
  const p0 = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
  let inAt = -1;
  for (let i = 0; i < need + 3; i++) {
    b.frame(1 / fps);
    if (inAt < 0 && L.look === 1) inAt = i + 1;
    if (b.pos.x !== p0.x || b.pos.y !== p0.y || b.pos.z !== p0.z || b.heading !== h0 || !hangs(b)) steady = false;
  }
  const twist = -CLIMB_TUNE.lookTwist * DEG;
  ok(quiet && L.lookSide === -1 && inAt === need && Math.abs(L.lookTwistNow - twist) < 1e-12 && L.poseClip === LEDGE_ROLES.braced.hopRight && L.poseAt === CLIMB_TUNE.lookPose && steady, `${fps} fps: braced on A, the view ${CLIMB_TUNE.lookStart - 10} degrees from the wall moves nothing; at ${LOOK_BACK_DEG_LOCAL} to the right the right hand leads, the look in after ${inAt} frames (the ease's ${need}), the spine turned ${n3(L.lookTwistNow / DEG)} degrees, the pose ${L.poseClip} at ${L.poseAt} s, the body still where it hung`);
  // Space: the hop behind, on from the held pose, turning round to the right, onto B.
  tap(b, 'Space', fps);
  const m = L.move;
  const began = L.phase === LEDGE_MOVE && m.kind === 'hop' && m.id === LEDGE_ROLES.braced.hopRight && m.t0 === CLIMB_TUNE.lookPose && m.spin === -1;
  let turnsRight = true;
  let last = b.heading;
  let turned = 0;
  runUntil(b, fps, 3, () => {
    const d = wrap(b.heading - last);
    if (d > 1e-9) turnsRight = false;
    turned += d;
    last = b.heading;
    return hangs(b);
  });
  const on = hangs(b) ? nearestLip(g!.s, L.lip.ex, L.lip.ey, L.lip.ez) : null;
  ok(began && turnsRight && Math.abs(turned + Math.PI) < 0.02 && on?.chain === 'B', `${fps} fps: ... Space hops behind on the right hop clip from ${m.t0} s, turning round to the right every frame (${n3(turned / DEG)} degrees), onto B`);
}
for (const fps of RATES) {
  // To the left: the left hand leads, turning round the left.
  resetClimbTune();
  const g = await grabbed('gap-behind-3.0', 'onA', fps);
  const { b, s } = g!;
  const h = lookHop(s, b, fps, 'B', LOOK_BACK_DEG_LOCAL);
  ok(h.reached && b.ledge.behindHops === 1, `${fps} fps: looking back over the left shoulder on a 3 m corridor, Space hops onto B (the left hand leading)`);
}
for (const fps of RATES) {
  // Nothing behind within reach: the small jump off.
  resetClimbTune();
  const g = await grabbed('gap-behind-4.0', 'onA', fps);
  const { b, s } = g!;
  const h = lookHop(s, b, fps, 'B', -LOOK_BACK_DEG_LOCAL);
  ok(!h.reached && b.ledge.behindHops === 0 && b.ledge.lastLetGo === 'jumped off a little', `${fps} fps: on a 4 m corridor (past \`hopBehind\` ${CLIMB_TUNE.hopBehind}) Space jumps a little off the wall instead`);
}
for (const fps of RATES) {
  // Under 'before': the view is free.
  resetClimbTune();
  tuneClimb({ lookAway: 'before' });
  const g = await grabbed('gap-behind-2.0', 'onA', fps);
  const { b } = g!;
  view(b, -LOOK_BACK_DEG_LOCAL);
  runUntil(b, fps, 0.4, () => false);
  const L = b.ledge;
  const still = L.look === 0 && L.lookSide === 0 && L.poseClip === '' && L.lookTwistNow === 0;
  tap(b, 'Space', fps);
  ok(still && L.behindHops === 0, `${fps} fps, lookAway before: looking back changes nothing and Space hops behind nowhere`);
}
for (const fps of RATES) {
  // Looking back to the wall, or a side key, eases the look out.
  resetClimbTune();
  const g = await grabbed('gap-behind-2.0', 'onA', fps);
  const { b } = g!;
  const L = b.ledge;
  view(b, -LOOK_BACK_DEG_LOCAL);
  runUntil(b, fps, 0.4, () => false);
  view(b, 0);
  const need = Math.ceil(CLIMB_TUNE.ease * fps - 1e-9);
  let outAt = -1;
  for (let i = 0; i < need + 3; i++) {
    b.frame(1 / fps);
    if (outAt < 0 && L.look === 0) outAt = i + 1;
  }
  const back = outAt === need && L.lookSide === 0 && L.poseClip === '' && L.lookTwistNow === 0;
  view(b, -LOOK_BACK_DEG_LOCAL);
  runUntil(b, fps, 0.4, () => false);
  b.key('KeyD', true);
  b.frame(1 / fps);
  const keyed = L.poseClip === '';
  b.key('KeyD', false);
  ok(back && keyed, `${fps} fps: the view back to the wall eases the look out in the ease's ${need} frames; a side key lets it go at once`);
}

// ---- the faults phase 1 found ---------------------------------------------------------------------------------------------------
const corners = ['corner-outer-90', 'corner-inner-90', 'bend-outer-30', 'bend-outer-45', 'bend-outer-60', 'bend-inner-30', 'bend-inner-45', 'bend-inner-60', 'curve-outer-3m', 'curve-inner-3m'];
for (const rule of ['ramp', 'before'] as const) {
  resetClimbTune();
  tuneClimb({ corners: rule });
  const { runs } = await runCourse(corners);
  let same = 0;
  let differ: string[] = [];
  for (const id of corners) {
    const at = runs.filter((r) => r.id === id);
    const ends = at.map((r) => r.shimmies.map((sh) => sh.turned));
    const ref = ends[0];
    // Within a tenth of a degree: a curve's own faces turn a little a rail step, so where a body stops along one (a frame's
    // step apart at one rate and another, under a centimetre) turns it by that much; a corner's turn is exact.
    const equal = ends.every((e) => e.length === ref.length && e.every((v, k) => Math.abs(v - ref[k]) < 0.1));
    if (equal) same++;
    else differ.push(`${id} ${ends.map((e) => e.join('/')).join(' | ')}`);
  }
  if (rule === 'ramp') ok(same === corners.length, `corners ramp: every corner, bend and curve turns the body alike at 30, 60, 144 and 240, within a tenth of a degree (round its turn, to its end and all the way back): ${same} of ${corners.length}`);
  else ok(differ.length > 0, `corners before: the turn at a lip's end differs by frame rate as phase 1 found (${differ.length} of ${corners.length}: ${differ[0]})`);
}
for (const rule of ['hang', 'before'] as const) {
  resetClimbTune();
  tuneClimb({ thinTop: rule });
  const { runs } = await runCourse(['wall-edge-8', 'wall-6']);
  const edge = runs.filter((r) => r.id === 'wall-edge-8');
  const deep = runs.filter((r) => r.id === 'wall-6');
  if (rule === 'hang') ok(edge.every((r) => r.stages.includes('still hanging at the lip') && r.words.includes('The top is too narrow to stand on.')) && deep.every((r) => r.stages.some((st) => st.startsWith('on top'))), `thinTop hang: at every rate the 8 m wall's 0.2 m top is hung from ("The top is too narrow to stand on."), and the 6 m wall's 2 m top is still climbed onto`);
  else ok(edge.every((r) => r.stages.some((st) => st.startsWith('on top'))), 'thinTop before: the body stands on the 0.2 m edge at every rate, as phase 1 found');
}
for (const rule of ['inclusive', 'before'] as const) {
  resetClimbTune();
  tuneClimb({ slopeLimit: rule });
  const { runs } = await runCourse(['slope-35', 'slope-38']);
  const at = runs.filter((r) => r.id === 'slope-35');
  const past = runs.filter((r) => r.id === 'slope-38');
  if (rule === 'inclusive') ok(at.every((r) => r.shimmies[0].why === 'end' && Math.abs(r.shimmies[0].rose - 1.751) < 0.002) && past.every((r) => r.shimmies[0].why === 'stopped'), `slopeLimit inclusive: at every rate the 35-degree lip (the limit) is shimmied to its end (rising ${at[0].shimmies[0].rose} m), and the 38-degree one is still stopped at its foot`);
  else ok(at.every((r) => r.shimmies[0].why === 'stopped'), 'slopeLimit before: the 35-degree lip is refused at its foot at every rate, as phase 1 found');
}
// The fixer: a step taller than `stepMax` is the lip's end, down as well as up (`steps` 'hands'), so no false corner round the
// step's side is followed and where the body stops is the same at every rate; 'before' goes round the side, as phase 1 found.
for (const rule of ['hands', 'before'] as const) {
  resetClimbTune();
  tuneClimb({ steps: rule });
  const { runs } = await runCourse(['steps-0.6']);
  const down = runs.map((r) => r.shimmies.find((sh) => sh.key === 'A')!);
  const up = runs.map((r) => r.shimmies.find((sh) => sh.key === 'D')!);
  if (rule === 'hands') {
    const m0 = down[0].moved;
    ok(down.every((sh) => sh.why === 'stopped' && sh.turned === 0 && sh.rose === 0 && Math.abs(sh.moved - m0) < 0.01) && up.every((sh) => sh.why === 'stopped' && sh.turned === 0) && runs.every((r) => r.handOff === 0), `steps hands: at every rate the 0.6 m step down is the lip's end (A stops ${down.map((sh) => sh.moved).join('/')} m along, unturned, as alike as a centimetre) and so is the step up (D ${up.map((sh) => sh.moved).join('/')} m), no hand off the lip`);
  } else ok(down.every((sh) => sh.turned < -40 && sh.moved > 0.9) && runs.every((r) => r.handOff > 0.5), `steps before: the shimmy goes round the 0.6 m step down's side at every rate, as phase 1 found (turned ${down.map((sh) => sh.turned).join('/')} degrees, the hand ${runs.map((r) => r.handOff).join('/')} m off the lip)`);
}
for (const rule of ['swept', 'before'] as const) {
  resetClimbTune();
  tuneClimb({ grabSweep: rule });
  const firsts: number[] = [];
  for (const fps of RATES) {
    const s = await standPiece(piece('lip-braced-1.8'));
    const { b } = bodyAt(s, 'stand', fps);
    b.key('KeyE', true);
    b.key('KeyW', true);
    tap(b, 'Space', fps);
    let f = 1;
    for (; f <= fps && b.ledge.grabs === 0; f++) b.frame(1 / fps);
    firsts.push(b.ledge.grabs > 0 ? f : Infinity);
  }
  if (rule === 'swept') ok(firsts.every((f) => f === 1), `grabSweep swept: E held through a standing jump at the 1.8 m lip grabs it on the jump's own frame at every rate (frames ${firsts.join(', ')})`);
  else ok(firsts[0] > 1, `grabSweep before: at 30 fps the jump's first frame carries the hands past the 1.8 m lip and it is grabbed only after the landing (frame ${firsts[0]}), as phase 1 found`);
}

{
  // The swept band is asked only where the frame's own finds nothing: its foot ray stands lower, and under a thin lip (a bar
  // 0.07 m thick) it passes beneath the face the band itself meets, so asked first it lost the bar at 30 fps.
  resetClimbTune();
  const { runs } = await runCourse(['bars-2', 'bars-3', 'bars-4', 'bars-5']);
  const firsts = runs.map((r) => r.stages[0]);
  ok(firsts.every((st) => st === 'hung from a lip at y 5.435, z 5.965 (free)'), `grabSweep swept: the first bar over every pit is caught free at every rate, as before (${runs.length} runs)`);
}
// ---- the limbs: the wall's holds and shimmies, and the look-away's hands, on a skeleton posed by the pack's own clips ---------
const body = speciesBodies(REPO).find((x) => x.id === 'human_male');
const target = body ? glbSkeleton(body.body) : targetSkeleton();
note(body ? "the converted human male's skeleton" : "no converted human male here: the tests' own skeleton");
const packDir = join(REPO, 'public', 'anims', 'mixamo');
const HOPS = [LEDGE_ROLES.braced.idle, LEDGE_ROLES.braced.hopLeft, LEDGE_ROLES.braced.hopRight];
const pack = new MixamoPack({
  enabled: () => true,
  index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
  clip: async (file: string) => {
    const x = readFileSync(join(packDir, file));
    return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer;
  },
  breath: async () => {},
  also: [...WALL_ALL_IDS, ...HOPS],
  now: () => performance.now(),
});
const info = console.info;
console.info = () => {};
const clips = await pack.clipsFor(target as never, 'climbII-B');
console.info = info;
const clipOf = (name: string) => clips.find((c) => c.name === name) ?? null;
ok([...WALL_ALL_IDS, ...HOPS].every((id) => !!clipOf(`mx_${id}`)), 'the pack fits the wall clips, the braced shimmies, the braced idle and both braced hops');
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
  const x = new THREE.Bone();
  x.name = j.name;
  x.position.fromArray(j.restP);
  x.quaternion.fromArray(j.restQ);
  made.push(x);
  bones.set(j.name, x);
  (j.parent < 0 ? inner : made[j.parent]).add(x);
});
const rig = { root, boneNamed: (n: string) => bones.get(n) ?? null, limbPose: null as { restore(): void } | null };
const mixer = new THREE.AnimationMixer(root);
const AX = new THREE.Vector3(1, 0, 0);
/** The game's rig as the climb drives it: one clip at a time at its rate, a change crossfaded over `climb.ease`; a held one at a time. */
class RigEmu {
  private readonly acts = new Map<string, THREE.AnimationAction>();
  private cur = '';
  act(name: string): THREE.AnimationAction {
    let a = this.acts.get(name);
    if (!a) {
      a = mixer.clipAction(clipOf(name)!);
      a.setLoop(THREE.LoopRepeat, Infinity);
      this.acts.set(name, a);
    }
    return a;
  }
  show(name: string, rate: number, at = -1): void {
    if (name !== this.cur) {
      const next = this.act(name).reset().play();
      next.setEffectiveWeight(1);
      if (at >= 0) next.time = at;
      if (this.cur) this.act(this.cur).crossFadeTo(next, CLIMB_TUNE.ease, false);
      this.cur = name;
    }
    this.act(name).timeScale = rate;
  }
  update(dt: number): void {
    rig.limbPose?.restore();
    mixer.update(dt);
  }
  stop(): void {
    mixer.stopAllAction();
    this.cur = '';
  }
}
const emu = new RigEmu();
const P = (n: string, out = new THREE.Vector3()) => bones.get(n)!.getWorldPosition(out);
function faceDistance(p: Physics, at: THREE.Vector3, n: THREE.Vector3): number {
  const h = p.world.castRayAndGetNormal(new RAPIER.Ray({ x: at.x + n.x * 0.5, y: at.y + n.y * 0.5, z: at.z + n.z * 0.5 }, { x: -n.x, y: -n.y, z: -n.z }), 2, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, ALL);
  return h ? h.timeOfImpact - 0.5 : Number.NaN;
}
async function wallWorld(): Promise<Physics> {
  const q = await makePhysics();
  ground(q, 0);
  box(q, [-12, 0, 2], [12, 12, 3]);
  q.stepOnce();
  return q;
}
/** One frame of the figure on the wall as the player poses and places it, then its limbs. */
function poseWall(b: TestBody, lp: LimbPlace, p: Physics, dt: number): void {
  const W = b.wall;
  emu.show(WALL_CLIP_NAMES[W.rigClip], W.rate);
  emu.update(dt);
  group.position.set(b.pos.x, b.pos.y, b.pos.z);
  group.rotation.set(0, W.heading, 0);
  const c = Math.cos(W.heading);
  const s = Math.sin(W.heading);
  root.position.set(W.offX * c - W.offZ * s, W.offY, W.offX * s + W.offZ * c);
  root.quaternion.setFromAxisAngle(AX, W.lean);
  group.updateMatrixWorld(true);
  lp.filter = ALL;
  W.limbsFor(lp, rig as never, p.world as never, null);
  lp.place(rig as never, p.world, null);
  group.updateMatrixWorld(true);
}

// Diagonals: every limb held on its hold until its next reach, one at a time.
for (const fps of RATES) {
  for (const rule of ['held', 'before'] as const) {
    resetClimbTune();
    tuneClimb({ wallLimbs: rule });
    emu.stop();
    const p = await wallWorld();
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.place(0, 0, 1);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.run(fps, 0.3);
    b.key('KeyE', true);
    b.key('KeyW', true);
    runUntil(b, fps, 2, () => b.wall.holding);
    b.key('KeyE', false);
    b.key('KeyW', false);
    const lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
    const H = b.wall.holds;
    const dt = 1 / fps;
    const lastAt = new Float64Array(12).fill(Number.NaN);
    let moved = 0;
    let heldFrames = 0;
    let worstHeld = 0;
    let most = 0;
    let mostAll = 0;
    let footHeld = 0;
    let worstFoot = 0;
    let worstFootHip = 0;
    let slid = 0;
    const n = new THREE.Vector3();
    const plantedAt = [new THREE.Vector3(), new THREE.Vector3()];
    const planted = [false, false];
    const keys = (t: number) => (t < 2 ? ['KeyW', 'KeyD'] : t < 4 ? ['KeyW', 'KeyA'] : ['KeyS', 'KeyD']);
    let held: string[] = [];
    for (let k = 0; k < Math.round(5 * fps); k++) {
      const want = keys(k * dt);
      for (const key of held) if (!want.includes(key)) b.key(key, false);
      for (const key of want) if (!held.includes(key)) b.key(key, true);
      held = want;
      b.frame(dt);
      if (b.wall.phase !== WALL_ON) continue;
      poseWall(b, lp, p, dt);
      if (rule === 'held') {
        most = Math.max(most, H.reaching());
        // Every limb between its holds, forced reaches counted (the fixer: the in-turn count alone hides them).
        let between = 0;
        for (let limb = 0; limb < 4; limb++) if (H.moving[limb] === 1) between++;
        mostAll = Math.max(mostAll, between);
        // Each foot wholly on its hold: its posed ball stands on it, and the hold is within the leg's length of the hip.
        for (let f = 2; f < 4; f++) {
          if (!(H.on[f] === 1 && H.share[f] === 1)) continue;
          const sd = f === 2 ? 'l' : 'r';
          const toe = P(sd + 'Toe');
          worstFoot = Math.max(worstFoot, Math.hypot(toe.x - H.at[f * 3], toe.y - H.at[f * 3 + 1], toe.z - H.at[f * 3 + 2]));
          const hip = P(sd + 'Thigh');
          const knee = P(sd + 'Shin');
          const ankle = P(sd + 'Ankle');
          const chain = hip.distanceTo(knee) + knee.distanceTo(ankle) + ankle.distanceTo(toe);
          worstFootHip = Math.max(worstFootHip, Math.hypot(hip.x - H.at[f * 3], hip.y - H.at[f * 3 + 1], hip.z - H.at[f * 3 + 2]) / chain);
          footHeld++;
        }
        for (let limb = 0; limb < 4; limb++) {
          if (H.on[limb] === 1) {
            // A hold never moves while held.
            if (lastAt[limb * 3] === lastAt[limb * 3] && (H.at[limb * 3] !== lastAt[limb * 3] || H.at[limb * 3 + 1] !== lastAt[limb * 3 + 1] || H.at[limb * 3 + 2] !== lastAt[limb * 3 + 2])) moved++;
            lastAt[limb * 3] = H.at[limb * 3];
            lastAt[limb * 3 + 1] = H.at[limb * 3 + 1];
            lastAt[limb * 3 + 2] = H.at[limb * 3 + 2];
          } else lastAt.fill(Number.NaN, limb * 3, limb * 3 + 3);
        }
        // Each hand wholly on its hold: its posed grip stands on it.
        for (let side = 0; side < 2; side++) {
          if (!(H.on[side] === 1 && H.share[side] === 1 && lp.handW[side] >= 0.999)) continue;
          const gp = lp.gripNow(rig as never, side, null, new THREE.Vector3())!;
          worstHeld = Math.max(worstHeld, Math.hypot(gp.x - H.at[side * 3], gp.y - H.at[side * 3 + 1], gp.z - H.at[side * 3 + 2]));
          heldFrames++;
        }
      } else {
        // Under 'before', a wholly placed hand slides along the face with the body while the clip has it planted.
        n.set(b.wall.nx, b.wall.ny, b.wall.nz);
        for (let side = 0; side < 2; side++) {
          const gp = lp.gripNow(rig as never, side, null, new THREE.Vector3())!;
          const now = lp.handW[side] >= 0.999;
          if (now && planted[side]) slid = Math.max(slid, Math.hypot(gp.x - plantedAt[side].x, gp.z - plantedAt[side].z));
          if (now && !planted[side]) plantedAt[side].copy(gp);
          planted[side] = now;
        }
      }
    }
    for (const key of held) b.key(key, false);
    if (rule === 'held') {
      ok(moved === 0 && H.taken > 6 && H.reaches > 4 && heldFrames > fps && worstHeld < 0.01, `${fps} fps, wallLimbs held: climbing diagonally up and down for 5 s, every hold stays put while held (${H.taken} taken, ${H.reaches} reaches), and a held hand's grip stands on its hold within a centimetre (worst ${(worstHeld * 1000).toFixed(2)} mm over ${heldFrames} hand-frames)`);
      ok(footHeld > fps && worstFoot < 0.01 && worstFootHip <= 1, `${fps} fps, wallLimbs held: a held foot's posed ball stands on its hold within a centimetre (worst ${(worstFoot * 1000).toFixed(2)} mm over ${footHeld} foot-frames), and no held foot's hold stands past the leg's whole chain from its hip (worst ${worstFootHip.toFixed(3)} of it; ${H.beyond} holds let go of out of a leg's reach)`);
      // One limb at a time holds among the reaches taken in turn; a limb carried past the most or out of its leg's reach
      // reaches at once, and on a diagonal at the shipped most that is the larger part of the reaches (counted, not hidden).
      ok(most <= 1 && H.forced > 0 && mostAll > 1 && mostAll <= 4, `${fps} fps, wallLimbs held: never more than one limb reaches in turn at once (most ${most}, ${H.waited} frames a limb waited its turn); with the forced reaches counted, as many as ${mostAll} limbs between their holds at once (${H.forced} of ${H.reaches} reaches forced by the most or a leg's reach): one limb at a time is not what a diagonal does at holdMost ${CLIMB_TUNE.holdMost}`);
    }
    else ok(slid > 0.05, `${fps} fps, wallLimbs before: a wholly placed hand slides with the body across the face while the clip has it planted (as far as ${n3(slid)} m), as it did`);
  }
}

// Sideways on the shimmy clips: the hands and feet on the face.
for (const fps of RATES) {
  resetClimbTune();
  emu.stop();
  const p = await wallWorld();
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(0, 0, 1);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.run(fps, 0.3);
  b.key('KeyE', true);
  b.key('KeyW', true);
  runUntil(b, fps, 2, () => b.wall.holding);
  b.key('KeyE', false);
  runUntil(b, fps, 1, () => false);
  b.key('KeyW', false);
  const lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
  const dt = 1 / fps;
  const n = new THREE.Vector3();
  let handFrames = 0;
  let footFrames = 0;
  let worstHand = 0;
  let worstFoot = 0;
  for (const key of ['KeyD', 'KeyA']) {
    b.key(key, true);
    for (let k = 0; k < Math.round(1.5 * fps); k++) {
      b.frame(dt);
      if (b.wall.phase !== WALL_ON) continue;
      poseWall(b, lp, p, dt);
      if (b.wall.rigClip !== WALL_SIDE.left && b.wall.rigClip !== WALL_SIDE.right) continue;
      n.set(b.wall.nx, b.wall.ny, b.wall.nz);
      for (let side = 0; side < 2; side++) {
        if (!(lp.handW[side] >= 0.999)) continue;
        const gp = lp.gripNow(rig as never, side, null, new THREE.Vector3())!;
        worstHand = Math.max(worstHand, Math.abs(faceDistance(p, gp, n) - PALM_OFF));
        handFrames++;
      }
      for (let f = 0; f < 2; f++) {
        if (!(b.wall.holds.on[2 + f] === 1 && b.wall.holds.share[2 + f] === 1)) continue;
        const d = faceDistance(p, P(f === 0 ? 'lToe' : 'rToe'), n);
        if (!(d === d)) continue;
        worstFoot = Math.max(worstFoot, Math.abs(d - BALL_OFF));
        footFrames++;
      }
    }
    b.key(key, false);
  }
  ok(handFrames > fps && worstHand < 0.01 && footFrames > fps && worstFoot < 0.01, `${fps} fps: sideways on the braced shimmy clips, every wholly placed hand's grip stands a palm off the face within a centimetre (worst ${(worstHand * 1000).toFixed(2)} mm over ${handFrames}) and every held foot's ball ${BALL_OFF} off it (worst ${(worstFoot * 1000).toFixed(2)} mm over ${footFrames})`);
}

// The look-away's hands: the trailing hand on the lip, the leading one off it and reaching toward the view.
for (const fps of RATES) {
  for (const arm of [CLIMB_TUNE_SHIPPED.lookArm, 1]) {
    resetClimbTune();
    tuneClimb({ lookArm: arm });
    emu.stop();
    const g = await grabbed('gap-behind-2.0', 'onA', fps);
    const { b } = g!;
    const L = b.ledge;
    const lp = new LimbPlace(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
    view(b, -LOOK_BACK_DEG_LOCAL);
    const dt = 1 / fps;
    let trail = 0;
    let off = Infinity;
    let reach = 0;
    let frames = 0;
    for (let k = 0; k < Math.round(0.6 * fps); k++) {
      b.frame(dt);
      // The player's `animateHang`: the hang's loop, the pose held from the hop clip while looking away.
      if (L.poseClip) emu.show(`mx_${L.poseClip}`, 0, L.poseAt);
      else emu.show(`mx_${L.rigClip}`, 1);
      emu.update(dt);
      group.position.set(b.pos.x, b.pos.y, b.pos.z);
      group.rotation.set(0, L.heading, 0);
      const c = Math.cos(L.heading);
      const s = Math.sin(L.heading);
      root.position.set(L.offX * c - L.offZ * s, L.offY, L.offX * s + L.offZ * c);
      root.quaternion.set(0, 0, 0, 1);
      group.updateMatrixWorld(true);
      lp.filter = ALL;
      L.limbsFor(lp, rig as never, null);
      lp.place(rig as never, g!.s.physics.world, null);
      group.updateMatrixWorld(true);
      if (L.look < 1) continue;
      frames++;
      // Right lead (looking right): the right hand (1) leads, the left (0) trails.
      const tg = lp.gripNow(rig as never, 0, null, new THREE.Vector3())!;
      trail = Math.max(trail, Math.hypot(tg.x - lp.hand[0], tg.y - lp.hand[1], tg.z - lp.hand[2]));
      const lg = lp.gripNow(rig as never, 1, null, new THREE.Vector3())!;
      // How far the leading grip stands off the lip's grip line (across it: the line's way taken out).
      const ex = lg.x - L.lineX;
      const ey = lg.y - L.lineY;
      const ez = lg.z - L.lineZ;
      const along = ex * L.lineTx + ez * L.lineTz;
      off = Math.min(off, Math.hypot(ex - L.lineTx * along, ey - L.lineSlope * along, ez - L.lineTz * along));
      reach = Math.max(reach, Math.hypot(lg.x - lp.hand[3], lg.y - lp.hand[4], lg.z - lp.hand[5]));
    }
    ok(frames > 0 && trail < 0.01 && off > 0.15 && (arm < 1 || reach < 0.02), `${fps} fps, lookArm ${arm}: looking back over the right shoulder the left hand stays on its place on the lip (worst ${(trail * 1000).toFixed(2)} mm) and the right hand is off it (at least ${n3(off)} m from the lip)${arm === 1 ? `, on its reach toward the view within 2 cm (worst ${(reach * 1000).toFixed(1)} mm)` : ''}`);
  }
}

console.log(`climbWallLook: ${checks} checks passed`);
