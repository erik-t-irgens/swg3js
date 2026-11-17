// Wave 4 of the animations, item B: the hands' bracing rule (src/player/brace.ts) on the real Rapier, at 30, 60 and 144
// frames a second:
//  - running into a wall at the left shoulder the left hand reaches for it (and only that hand), its share eased in over
//    `brace.ease` alike at every rate, its target on the face at the shoulders' height a palm off it; a glance along the
//    wall never braces; head on into a wall both hands do; a passage narrower than `brace.tight` has both hands on its
//    sides while moving and none standing still;
//  - in a crowd: a body at the right shoulder takes the right hand on its capsule (with `brace.people` off, none);
//  - in space: drifting past a surface, both hands hold it and step hand over hand, each hold kept still in the world until
//    it would overreach, never two steps in one frame;
//  - a hand holding something never braces (the other may); busy, nothing; a hand changing what it rests on lets go first;
//  - standing still with nothing pushing casts nothing, and under `brace.rule` 'before' nothing is felt for at all.
import assert from 'node:assert/strict';
import { box, ground, makePhysics, type Physics } from './grappleBody.ts';
import { BRACE_NONE, BRACE_PERSON, BRACE_SPACE, BRACE_TIGHT, BRACE_WALL, BraceIn, Crowd, HandBrace, WALL_LOOK } from '../../../src/player/brace.ts';
import { CLIMB_TUNE, resetClimbTune, tuneClimb, climbTwoBefore } from '../../../src/anim/climbTune.ts';
import { PALM_OFF } from '../../../src/anim/wallClips.ts';
import { Group, RAPIER, groups } from '../../../src/core/physics.ts';

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
const n3 = (v: number) => v.toFixed(3);
const FPS = [30, 60, 144] as const;
const ALL = groups(Group.all, Group.all);
const makeRay = () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

async function world(build: (p: Physics) => void): Promise<Physics> {
  const p = await makePhysics();
  ground(p, 0);
  build(p);
  p.stepOnce();
  return p;
}

/** A frame record for a body at (x, z) facing +z (heading 0: its left is +x), moving along (vx, vz), keys pushing (mx, mz). */
function frame(dt: number, x: number, z: number, vx: number, vz: number, mx = 0, mz = 0): BraceIn {
  const i = new BraceIn();
  i.dt = dt;
  i.x = x;
  i.y = 0;
  i.z = z;
  i.heading = 0;
  i.scale = 1;
  i.filter = ALL;
  i.vx = vx;
  i.vz = vz;
  const ml = Math.hypot(mx, mz);
  i.moveX = ml > 0 ? mx / ml : 0;
  i.moveZ = ml > 0 ? mz / ml : 0;
  i.onFeet = true;
  return i;
}

// ---- a wall at the left shoulder, run into at a slant ----------------------------------------------------------------------
{
  resetClimbTune();
  climbTwoBefore();
  // The wall's face looks toward -x at x = 0.6 (the body's left is +x as it faces +z).
  const p = await world((q) => box(q, [0.6, 0, -10], [1.6, 3, 10]));
  const curves: number[][] = [];
  for (const fps of FPS) {
    const B = new HandBrace(makeRay);
    const dt = 1 / fps;
    const w: number[] = [];
    let z = 0;
    for (let k = 0; k < Math.round(0.4 * fps); k++) {
      // Running along +z at 6 m/s, the keys pushing into the wall by half (30 degrees off its line).
      const i = frame(dt, 0, z, 0, 6, 0.6, 0.8);
      B.step(p.world, i, null);
      z += 6 * dt;
      w.push(B.w[0]);
    }
    const t = (s: number) => w[Math.round(s * fps) - 1];
    curves.push([t(0.1), t(0.2), t(0.3)]);
    ok(B.src[0] === BRACE_WALL && B.w[1] === 0 && B.src[1] === BRACE_NONE, `${fps} fps: running into a wall at the left shoulder, the left hand braces on it and the right does not`);
    // How hard: the move's 0.6 into the face past brace.press, over what is left; how near: the face 0.6 m from the middle
    // line, wholly within the capsule and a hand (0.45), nought at a hand's reach from the shoulder (0.7 + 0.19).
    const press = (0.6 - CLIMB_TUNE.brace.press) / (1 - CLIMB_TUNE.brace.press);
    const nearS = 1 - (0.6 - 0.45) / (CLIMB_TUNE.brace.reach + 0.19 - 0.45);
    ok(Math.abs(B.w[0] - press * nearS) < 1e-5, `${fps} fps: its share ${n3(B.w[0])}, by how hard the body goes into the face (${n3(press)}) and how near it is (${n3(nearS)})`);
    // The target: on the face (x = 0.6) a palm off it, at the shoulders' height, beside the left shoulder.
    ok(Math.abs(B.at[0] - (0.6 - PALM_OFF)) < 1e-6 && Math.abs(B.at[1] - CLIMB_TUNE.brace.height) < 1e-9 && Math.abs(B.at[2] - (z - 6 * dt)) < 1e-6, `${fps} fps: its target stands a palm (${PALM_OFF}) off the face at the shoulders (${n3(B.at[0])}, ${n3(B.at[1])}, ${n3(B.at[2])}), beside the body as it runs`);
    ok(Math.abs(B.n[0] + 1) < 1e-6, `${fps} fps: and its palm is turned flat against the face (its normal ${n3(B.n[0])}, ${n3(B.n[1])}, ${n3(B.n[2])})`);
  }
  void curves;
  // The ease alike at every rate, toward a share of one (a wall at the capsule's skin, the keys pushing straight into it
  // while running along it): the share at a tenth, two and three tenths of a second in.
  const q = await world((r) => box(r, [0.42, 0, -10], [1.42, 3, 10]));
  const ease: number[][] = [];
  for (const fps of FPS) {
    const B = new HandBrace(makeRay);
    const dt = 1 / fps;
    const w: number[] = [];
    for (let k = 0; k < Math.round(0.4 * fps); k++) {
      B.step(q.world, frame(dt, 0, k * 6 * dt, 0, 6, 1, 0), null);
      w.push(B.w[0]);
    }
    // At times every rate's frames land on (a sixth of a second is 5, 10 and 24 frames).
    const t = (s: number) => w[Math.round(s * fps) - 1];
    ease.push([t(1 / 6), t(2 / 6), t(2 / 6 + 1 / 30)]);
  }
  const spread = [0, 1, 2].map((k) => Math.max(...ease.map((c) => c[k])) - Math.min(...ease.map((c) => c[k])));
  ok(spread.every((s) => s < 1e-9), `the share eases in alike at 30, 60 and 144 frames a second (${ease.map((c) => c.map(n3).join('/')).join(' | ')})`);
  ok(Math.abs(ease[0][0] - 1 / 6 / CLIMB_TUNE.brace.ease) < 1e-9 && ease[0][1] === 1, `over brace.ease (${CLIMB_TUNE.brace.ease} s): ${n3(ease[0][0])} in at a sixth of a second, wholly at a third`);
  // A glance along the wall (the keys straight ahead) never braces.
  const B = new HandBrace(makeRay);
  for (let k = 0; k < 30; k++) B.step(p.world, frame(1 / 60, 0, k * 0.1, 0, 6, 0, 1), null);
  ok(B.w[0] === 0 && B.w[1] === 0, 'running along the wall at a glance (the keys straight ahead) never braces');
}

// ---- head on, a tight passage, standing still ------------------------------------------------------------------------------
{
  resetClimbTune();
  climbTwoBefore();
  // The face 0.4 m ahead: the capsule (0.35) against it, its skin and a hand's width.
  const p = await world((q) => box(q, [-3, 0, 0.4], [3, 3, 1.4]));
  const B = new HandBrace(makeRay);
  for (let k = 0; k < 30; k++) B.step(p.world, frame(1 / 60, 0, 0, 0, 0, 0, 1), null);
  ok(B.src[0] === BRACE_WALL && B.src[1] === BRACE_WALL && B.w[0] === 1 && B.w[1] === 1, 'pressed head on into a wall (W held, the body stopped), both hands brace on it');
  ok(Math.abs(B.at[2] - (0.4 - PALM_OFF)) < 1e-6 && Math.abs(B.at[5] - (0.4 - PALM_OFF)) < 1e-6 && B.at[0] > 0 && B.at[3] < 0, 'each a palm off the face beside its own shoulder');
  const casts = B.casts;
  for (let k = 0; k < 60; k++) B.step(p.world, frame(1 / 60, 0, 0, 0, 0), null);
  ok(B.w[0] === 0 && B.w[1] === 0 && B.casts === casts, 'standing still with nothing pushing, the hands come back and nothing is cast');
}
{
  resetClimbTune();
  climbTwoBefore();
  // A passage 1.1 m wide along z: faces at x = +0.55 and -0.55.
  const p = await world((q) => {
    box(q, [0.55, 0, -10], [1.55, 3, 10]);
    box(q, [-1.55, 0, -10], [-0.55, 3, 10]);
  });
  const B = new HandBrace(makeRay);
  let z = 0;
  for (let k = 0; k < 30; k++) {
    B.step(p.world, frame(1 / 60, 0, z, 0, 2, 0, 1), null);
    z += 2 / 60;
  }
  ok(B.src[0] === BRACE_TIGHT && B.src[1] === BRACE_TIGHT && B.w[0] === 1 && B.w[1] === 1, `walking a passage 1.1 m wide (under brace.tight ${CLIMB_TUNE.brace.tight}), both hands touch its sides`);
  ok(B.at[0] < 0.55 - PALM_OFF && B.at[3] > -0.55 + PALM_OFF, 'lightly: each palm a little further off its side than a flat palm');
  tuneClimb({ brace: { tight: 1.0 } });
  const C = new HandBrace(makeRay);
  for (let k = 0; k < 30; k++) C.step(p.world, frame(1 / 60, 0, k * 0.03, 0, 2, 0, 1), null);
  ok(C.src[0] !== BRACE_TIGHT && C.w[0] === 0, 'a passage wider than brace.tight is no tight spot');
  resetClimbTune();
  climbTwoBefore();
}

// ---- the crowd -------------------------------------------------------------------------------------------------------------
{
  resetClimbTune();
  climbTwoBefore();
  const p = await world(() => {});
  const crowd = new Crowd();
  const B = new HandBrace(makeRay);
  for (let k = 0; k < 30; k++) {
    crowd.count = 0;
    // A body at the right shoulder (the right is -x), 0.6 m off the middle line, walking beside.
    crowd.add(0, k * 0.05, -0.75, k * 0.05, 0, 1.8, 0.3, 3);
    B.step(p.world, frame(1 / 60, 0, k * 0.05, 0, 3, 0, 1), crowd);
  }
  ok(B.src[1] === BRACE_PERSON && B.w[1] > 0 && B.w[0] === 0, `walking past a body at the right shoulder, the right hand rests on it (share ${n3(B.w[1])})`);
  const sx = -0.19;
  const ex = -0.75 + 0.3 + PALM_OFF;
  ok(Math.abs(B.at[3] - ex) < 0.02 && Math.abs(B.at[4] - CLIMB_TUNE.brace.height) < 1e-9 && Math.abs(B.n[3] - 1) < 1e-2, `on the nearest point of its capsule from the right shoulder (${n3(B.at[3])} against ${n3(ex)}; the shoulder at ${sx}), its palm on it`);
  tuneClimb({ brace: { people: 'off' } });
  const C = new HandBrace(makeRay);
  for (let k = 0; k < 30; k++) C.step(p.world, frame(1 / 60, 0, 0, 0, 3, 0, 1), crowd);
  ok(C.w[1] === 0, 'with brace.people off, no hand on anybody');
  resetClimbTune();
  climbTwoBefore();
}

// ---- held hands, busy, the change of what a hand rests on ------------------------------------------------------------------
{
  resetClimbTune();
  climbTwoBefore();
  const p = await world((q) => box(q, [-3, 0, 0.4], [3, 3, 1.4]));
  const B = new HandBrace(makeRay);
  for (let k = 0; k < 30; k++) {
    const i = frame(1 / 60, 0, 0, 0, 0, 0, 1);
    i.freeR = false;
    B.step(p.world, i, null);
  }
  ok(B.w[0] === 1 && B.w[1] === 0, 'a hand holding something never braces; the other does');
  const L = new HandBrace(makeRay);
  for (let k = 0; k < 30; k++) {
    const i = frame(1 / 60, 0, 0, 0, 0, 0, 1);
    i.freeL = false;
    L.step(p.world, i, null);
  }
  ok(L.w[0] === 0 && L.w[1] === 1, 'and the other way round: the left holding something, the right braces alone');
  for (let k = 0; k < 30; k++) {
    const i = frame(1 / 60, 0, 0, 0, 0, 0, 1);
    i.busy = true;
    B.step(p.world, i, null);
  }
  ok(B.w[0] === 0 && B.w[1] === 0, 'fighting, aiming, swinging, emoting (busy): both hands come back');
}
{
  resetClimbTune();
  climbTwoBefore();
  // A wall at the left, then a body at the left instead: the hand lets go of the wall before it takes the body.
  const p = await world((q) => box(q, [0.6, 0, -2], [1.6, 3, 0.2]));
  const crowd = new Crowd();
  const B = new HandBrace(makeRay);
  let z = -1;
  const seen: number[] = [];
  for (let k = 0; k < 90; k++) {
    crowd.count = 0;
    if (z > 0.6) crowd.add(0, z, 0.7, z, 0, 1.8, 0.3, 3);
    B.step(p.world, frame(1 / 60, 0, z, 0, 3, 0.4, 0.9), crowd);
    seen.push(B.src[0] * 10 + Math.round(B.w[0] * 9));
    z += 3 / 60;
  }
  const firstPerson = seen.findIndex((s) => Math.floor(s / 10) === BRACE_PERSON);
  ok(firstPerson > 0 && seen[firstPerson] % 10 <= 1 && seen.slice(0, firstPerson).some((s) => Math.floor(s / 10) === BRACE_WALL), 'running off the end of a wall onto a body at the same shoulder, the hand lets go of the wall before it reaches for the body (from nought)');
}

// ---- space: hand over hand along a surface -----------------------------------------------------------------------------------
{
  resetClimbTune();
  climbTwoBefore();
  // A hull's side 0.6 m off the body's left (its face at x 0.6), the body drifting along +z beside it, upright, far over the ground.
  const p = await world(() => {});
  const plate = p.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 10, 50).setTranslation(1.1, 50, 0));
  void plate;
  p.stepOnce();
  for (const fps of FPS) {
    const B = new HandBrace(makeRay);
    const dt = 1 / fps;
    let z = 0;
    let stepsSeen = 0;
    let twoAtOnce = false;
    let stillHolds = true;
    let over = 0;
    const last = [Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN];
    // A hand's hold moves only while it has let go (its share nought): never from one hold to the next with the palm still on.
    const was = [0, 0, 0, 0, 0, 0];
    const wasW = [0, 0];
    let jumped = false;
    for (let k = 0; k < Math.round(3 * fps); k++) {
      const i = frame(dt, 0, z, 0, 0.8);
      i.onFeet = false;
      i.space = true;
      i.y = 50;
      const before = B.steps;
      B.step(p.world, i, null);
      if (B.steps - before > 1) twoAtOnce = true;
      for (let s = 0; s < 2; s++) {
        const a = s * 3;
        if (wasW[s] > 0 && B.w[s] > 0 && (B.at[a] !== was[a] || B.at[a + 1] !== was[a + 1] || B.at[a + 2] !== was[a + 2])) jumped = true;
        was[a] = B.at[a];
        was[a + 1] = B.at[a + 1];
        was[a + 2] = B.at[a + 2];
        wasW[s] = B.w[s];
      }
      stepsSeen = B.steps;
      for (let s = 0; s < 2; s++) {
        if (B.src[s] !== BRACE_SPACE || B.w[s] < 1) continue;
        const a = s * 3;
        // A hold wholly taken stays where it was put while it is held.
        if (last[a] === last[a] && Math.abs(B.at[a + 2] - last[a + 2]) > 1e-12 && Math.abs(B.at[a + 2] - last[a + 2]) < 1e-6) stillHolds = false;
        last[a] = B.at[a];
        last[a + 1] = B.at[a + 1];
        last[a + 2] = B.at[a + 2];
        const sx = s === 0 ? 0.19 : -0.19;
        over = Math.max(over, Math.hypot(B.at[a] - sx, B.at[a + 1] - (50 + 1.3), B.at[a + 2] - z));
      }
      z += 0.8 * dt;
    }
    ok(!jumped, `${fps} fps: a hand's hold moves only once its palm is off (its share nought), never from one hold to the next with the palm still on`);
    ok(stepsSeen >= 4 && !twoAtOnce, `${fps} fps: drifting 2.4 m along a hull's side 0.6 m off the left, the hands step ${stepsSeen} times, hand over hand (never two in a frame)`);
    ok(stillHolds && over <= CLIMB_TUNE.brace.reach + 0.19 + 1e-9, `${fps} fps: each hold kept where it was put until it would overreach (farthest held ${n3(over)} m from its shoulder)`);
    ok(Math.abs(B.at[0] - (0.6 - PALM_OFF)) < 1e-5 && Math.abs(B.at[3] - (0.6 - PALM_OFF)) < 1e-5 && Math.abs(B.n[0] + 1) < 1e-5, `${fps} fps: both palms flat on the hull's side (${n3(B.at[0])}, ${n3(B.at[3])})`);
  }
  // Nothing in reach: nothing held, and the six ways looked along only every fifth of a second.
  const far = await world(() => {});
  const B = new HandBrace(makeRay);
  for (let k = 0; k < 60; k++) {
    const i = frame(1 / 60, 0, 0, 0, 0.5);
    i.onFeet = false;
    i.space = true;
    i.y = 20;
    B.step(far.world, i, null);
  }
  ok(B.w[0] === 0 && B.w[1] === 0 && B.casts <= 6 * 6, `drifting with no surface in reach, nothing held, the six ways felt along every fifth of a second (${B.casts} rays in a second)`);
}

// ---- the fix round: a walk in the open looks for a face only now and then, one near is felt every frame -----------------
{
  resetClimbTune();
  climbTwoBefore();
  const open = await world(() => {});
  const near = await world((q) => box(q, [0.6, 0, -10], [1.6, 3, 10]));
  for (const fps of FPS) {
    const dt = 1 / fps;
    const n = Math.round(2 * fps);
    const B = new HandBrace(makeRay);
    for (let k = 0; k < n; k++) B.step(open.world, frame(dt, 0, k * 2 * dt, 0, 2, 0, 1), null);
    const per = B.casts / n;
    const most = (3 * dt) / WALL_LOOK;
    ok(per <= most + 3 / n + 1e-9 && B.w[0] === 0 && B.w[1] === 0, `${fps} fps: walking in the open with no face near, the shoulders' three rays are cast once every ${WALL_LOOK} s (${per.toFixed(3)} a frame, at most ${most.toFixed(3)} and the first)`);
    // Along a wall within reach (the keys pushing into it): felt every frame once found.
    const C = new HandBrace(makeRay);
    for (let k = 0; k < fps; k++) C.step(near.world, frame(dt, 0, k * 6 * dt, 0, 6, 0.6, 0.8), null);
    ok(C.casts === 3 * fps && C.src[0] === BRACE_WALL, `${fps} fps: running a second along a wall within reach, it is felt for every frame (${C.casts} rays over ${fps} frames) and braced on`);
    // A move cut short against something looks at once, whatever the clock says.
    const D = new HandBrace(makeRay);
    D.step(open.world, frame(dt, 0, 0, 0, 2, 0, 1), null);
    const c0 = D.casts;
    const i = frame(dt, 0, 0.1, 0, 2, 0, 1);
    i.blocked = true;
    D.step(open.world, i, null);
    ok(D.casts - c0 === 3, `${fps} fps: a move cut short (pressed against something) looks at once`);
  }
}

// ---- 'before' ----------------------------------------------------------------------------------------------------------------
{
  resetClimbTune();
  climbTwoBefore();
  const p = await world((q) => box(q, [-3, 0, 0.4], [3, 3, 1.4]));
  tuneClimb({ brace: { rule: 'before' } });
  const B = new HandBrace(makeRay);
  for (let k = 0; k < 30; k++) B.step(p.world, frame(1 / 60, 0, 0, 0, 0, 0, 1), null);
  ok(B.w[0] === 0 && B.w[1] === 0 && B.casts === 0, "under brace.rule 'before' nothing is felt for (no ray) and no hand braces");
  resetClimbTune();
  climbTwoBefore();
}
console.log(`braceRule: ${checks} checks passed`);
