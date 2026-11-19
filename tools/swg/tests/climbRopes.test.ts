// Climbing II, phase 4 (maker A): ropes, under `climb.ropes` 'on' (src/player/hangingRope.ts, src/player/ropeSwing.ts, the rope's
// clips src/anim/ropeClips.ts and their hand-over src/player/hangClips.ts's `driveRopeClips`), through the game's own movement
// and climbing on the real Rapier (the grapple's harness, tools/swg/tests/grappleBody.ts, and the course's rope stood by
// tools/swg/tests/climbCourseBody.ts) at 30, 60, 144 and 240 frames a second, and the game's own rig posed by the hand-over
// (tools/swg/tests/climbFigure.ts):
//  - the clips: the rope's seven in the pack as the import's report has them (the owner's lengths, the trims his frames name,
//    nothing under the feet of the three the rope plays), asked for by the game, and measured on the human male;
//  - what a rope is: no collider, hanging from its anchor, its length the slider's (or its own), the course's rope piece one, its
//    column switched off while ropes are on and back on while they are off, drawn along the hook's points;
//  - grabbing with E at the height met: standing by it, a rope ending just in reach, a jump, a fall past it; never without E, out
//    of reach, or where the hanging body has no room (in words);
//  - on it: a still hang held still, the give settling; W and S climbing at the slider's speed to the top and the end and to the
//    ground under it (stopping clear of it), the swing kept as a pendulum keeps it; the pump keys building a swing to the largest
//    and no further, alike at 30 and 240 frames a second; 'ws'; the plane turned toward the view; a swing into a wall stopped
//    there, never in it;
//  - the pose: the drawn hands on the rope and the drawn hips on its line, the swing's clip's time the pendulum's, played forward
//    as it swings forward and backward as it comes back, the climb's clip by the way climbed;
//  - the plain let-go (Space on the swing's velocity, the crouch straight down) and the rope swinging on by itself;
//  - with `climb.ropes` at 'off' nothing of it runs; and the hand-overs only the game makes, pinned as text.
//
// Run: node tools/swg/tests/climbRopes.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { figure, HAVE_BODY, type Figure } from './climbFigure.ts';

const { RAPIER, FIXED_DT } = await import('../../../src/core/physics.ts');
const { TestBody, box, ground, makePhysics } = await import('./grappleBody.ts');
const { CLIMB_TUNE, CLIMB_ROPES_BEFORE, climbBarsBefore, climbSmooth3Before, resetClimbTune, tuneClimb } = await import('../../../src/anim/climbTune.ts');
const { ROPE_CLIMB, ROPE_CLIP_NAMES, ROPE_FACTS, ROPE_HANG, ROPE_IDS, ROPE_SWING, ROPE_SWING_TWIN, ROPE_TIMES, measureRopeTables } = await import('../../../src/anim/ropeClips.ts');
const { HangingRope, ROPE_STEP } = await import('../../../src/player/hangingRope.ts');
const { MODE_CLIMB, MODE_HANG, MODE_SWING, ROPE_END, ROPE_GRAB, ROPE_HANG: PHASE_HANG, ROPE_NONE, ROPE_TOP } = await import('../../../src/player/ropeSwing.ts');
const { driveRopeClips } = await import('../../../src/player/hangClips.ts');
const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { courseTriangles } = await import('../../../src/anim/climbCourseBuild.ts');
const { standPiece } = await import('./climbCourseBody.ts');
const { REPO } = await import('./oldModules.ts');
type Body = InstanceType<typeof TestBody>;
type Phys = Awaited<ReturnType<typeof makePhysics>>;
type Rope = InstanceType<typeof HangingRope>;
type Tables = NonNullable<ReturnType<typeof measureRopeTables>>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const DEG = 180 / Math.PI;
const fresh = () => resetClimbTune();
fresh();

// ---- the clips ----------------------------------------------------------------------------------------------------------------
{
  const index = JSON.parse(readFileSync(join(REPO, 'public', 'anims', 'mixamo', 'index.json'), 'utf8')) as { clips: { id: string; frames: number; duration: number; loop: boolean; feet: unknown[]; trimStart: number }[] };
  const want: Record<string, [number, number, boolean, number]> = {
    hanging: [78, 2.58333, true, 0],
    climbing_a_rope: [77, 2.55, true, 0],
    start_swinging: [62, 2.03333, false, 1.067],
    swinging: [74, 2.43333, false, 1.033],
    swing_to_land_1: [62, 2.03333, false, 1.333],
    swing_to_land: [66, 2.16667, false, 1.033],
    swing_into_wall: [92, 3.03333, false, 0.933],
  };
  const off: string[] = [];
  for (const [id, [frames, d, loop, trim]] of Object.entries(want)) {
    const row = index.clips.find((c) => c.id === id);
    if (!row || row.frames !== frames || Math.abs(row.duration - d) > 1e-4 || row.loop !== loop || Math.abs(row.trimStart - trim) > 1e-6 || row.feet.length !== 0) off.push(id);
  }
  ok(off.length === 0, `the pack holds the rope's seven clips as the import's report has them: the owner's lengths (78, 77, 62, 74, 62, 66 and 92 frames), the hang and the climb loops, the rest one-offs trimmed at his frames (32 for the swing's start, 31, 40, 31 and 28 for the let-goes), nothing under any one's feet${off.length ? ` (off: ${off.join(', ')})` : ''}`);
  const table = readFileSync(join(REPO, 'tools', 'anim', 'mixamoClips.mjs'), 'utf8');
  ok(['hanging', 'climbing_a_rope', 'start_swinging'].every((id) => new RegExp(`\\n  ${id}: \\{[^}]*ground: false`).test(table)), "the import's table says the three the rope plays have nothing under their feet");
  ok(ROPE_IDS.length === 7 && ROPE_IDS.every((id) => id in want && ROPE_CLIP_NAMES[id] === `mx_${id}`) && ROPE_SWING_TWIN === `mx_${ROPE_SWING}~2`, 'the ropes ask the pack for all seven by their rig names, made once, and the swing\'s twin by a name of its own');
  const pack = readFileSync(join(REPO, 'src', 'anim', 'mixamoPack.ts'), 'utf8');
  // (Phase 5 asks for the pole's clip after them: `.concat(POLE_IDS)`.)
  ok(/also: \[\.\.\.moreClips\(\), \.\.\.STAIR_IDS, \.\.\.LEDGE_IDS, \.\.\.WALL_IDS, \.\.\.BAR_IDS, \.\.\.ROPE_IDS\](\.concat\(POLE_IDS\))?,/.test(pack), "and the game's pack asks for them beside the bars' (`browserIo`'s `also`)");
  ok(Math.abs(ROPE_TIMES.swingFrom - 32 / 30) < 1e-12 && Math.abs(ROPE_TIMES.swingTo - 61 / 30) < 1e-12 && Math.abs(ROPE_TIMES.landKnee - 40 / 30) < 1e-12 && Math.abs(ROPE_TIMES.landWaist - 28 / 30) < 1e-12, "the swing's window is the owner's frame 32 to the clip's last, the let-goes his frames");
}

/** The game's rig with the rope's clips, posed (the tests' figure), and its tables measured off it as the player's `animateRope` does. */
const F: Figure = figure();
const T = measureRopeTables(F.rig as never);
ok(T !== null, "the rope's three clips are fitted to the figure and their tables measured off the game's own rig");
const tables = T as Tables;
{
  const D = HAVE_BODY ? 1 : 0;
  const hang = tables.hang.meanPose;
  const tol = HAVE_BODY ? 0.01 : 0.3;
  ok(Math.abs(hang.radius - ROPE_FACTS.hang) < tol && Math.abs(hang.gy - ROPE_FACTS.grip) < tol + 0.01, `the still hang: the hips ${hang.radius.toFixed(3)} m under the grip, the grip ${hang.gy.toFixed(3)} m over the rig's root (the facts the body hangs by: ${ROPE_FACTS.hang} and ${ROPE_FACTS.grip})`);
  ok(Math.abs(tables.climb.rise - ROPE_FACTS.climbRise) < tol + 0.02 * (1 - D), `the climb: ${tables.climb.rise.toFixed(3)} m up the rope a round of its clip (a hand's fall while it holds, the two hands' mean; the fact is ${ROPE_FACTS.climbRise})`);
  const S = tables.swing;
  ok(Math.abs(S.from * DEG - ROPE_FACTS.from) < (HAVE_BODY ? 0.5 : 15) && Math.abs(S.to * DEG - ROPE_FACTS.to) < (HAVE_BODY ? 0.5 : 15), `the swing's run: the hips about the grip from ${(S.from * DEG).toFixed(1)} degrees at ${(S.t0 + S.w0 / 120).toFixed(3)} s to ${(S.to * DEG).toFixed(1)} at its end (the facts: ${ROPE_FACTS.from} to ${ROPE_FACTS.to})`);
  let rises = true;
  for (let i = S.w0 + 1; i < S.n; i++) if (S.ang[i] < S.ang[i - 1] - 0.003) rises = false;
  ok(rises && S.w0 > 0, "the run from the swing's lowest angle on is one swing forward (never falling by more than a sixth of a degree between samples): played by the pendulum's angle, forward one way and backward the other");
  if (!HAVE_BODY) note('no converted human male: the clips measured on the tests\' own skeleton');
}

/** A world with flat ground at nought, a rope hanging from `(0, ay, 3)` `length` long (the slider's when none), a body at (0, 0, 2.5) facing +z. */
async function ropeWorld(fps: number, ay = 9, length = Number.NaN, settle = 0.5): Promise<{ p: Phys; b: Body; r: Rope }> {
  const p = await makePhysics();
  ground(p, 0);
  p.stepOnce();
  (p as unknown as { acc: number }).acc = 0;
  const r = new HangingRope('test', 0, ay, 3, length);
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(0, 0, 2.5);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.heading = 0;
  b.rope.ropes = [r];
  if (settle > 0) b.run(fps, settle);
  return { p, b, r };
}
/** E pressed for a frame and let go. */
const pressE = (b: Body, fps: number) => {
  b.key('KeyE', true);
  b.frame(1 / fps);
  b.key('KeyE', false);
};
/** The body's middle off where the pendulum puts it on the rope's line, metres. */
const offLine = (b: Body, r: Rope): number => {
  const R = b.rope;
  const rad = R.s + R.e + R.hang;
  const sn = Math.sin(R.th);
  return Math.hypot(b.pos.x - (r.ax + rad * sn * R.fx), b.pos.y + 0.8 - (r.ay - rad * Math.cos(R.th)), b.pos.z - (r.az + rad * sn * R.fz));
};

// ---- what a rope is -----------------------------------------------------------------------------------------------------------
{
  ok(ROPE_STEP === FIXED_DT, `the free swing and the body's swing step on the physics' own step (${ROPE_STEP})`);
  const course = climbCourse({ pieces: ['rope'] });
  const s = await standPiece(course.pieces[0]);
  ok(s.ropes.length === 1, "the course's rope piece stands one rope");
  const r = s.ropes[0];
  const column = s.colliders.find((c) => c.role === 'rope')!.collider;
  const beam = s.colliders.find((c) => c.role === 'beam')!.collider;
  const bt = beam.translation();
  ok(Math.abs(r.ax - bt.x) < 1e-6 && Math.abs(r.az - bt.z) < 1e-6 && Math.abs(r.ay - (bt.y - 0.1)) < 1e-6 && r.len === CLIMB_TUNE.ropeLength && CLIMB_TUNE.ropeLength === 8, `it hangs from the beam's underside (${r.ay.toFixed(2)} m), the slider's 8 m long: the course's own column, from the beam to a metre over the pit's floor`);
  ok(!column.isEnabled() && !r.columnStands, "under 'on' its column's collider is off: nothing walks on a rope and nothing is stopped by it");
  // A ray straight down through the rope's middle meets the pit's floor, not the column.
  s.physics.stepOnce();
  const down = s.physics.world.castRay(new RAPIER.Ray({ x: r.ax, y: r.ay - 0.3, z: r.az }, { x: 0, y: -1, z: 0 }), 20, true);
  ok(!!down && down.collider.handle !== column.handle && Math.abs(r.ay - 0.3 - down.timeOfImpact) < 0.05, `a ray down the rope's line meets the pit's floor ${down ? (r.ay - 0.3 - down.timeOfImpact).toFixed(2) : '?'} m up, never the rope`);
  tuneClimb({ ropes: 'off' });
  r.sync();
  ok(column.isEnabled() && r.columnStands, "under 'off' the column stands again, live (`sync`, every frame): the course of before to the collider");
  tuneClimb({ ropes: 'on' });
  r.sync();
  ok(!column.isEnabled(), 'and back off under \'on\'');
  // Its points and its length.
  r.lay();
  ok(r.count === 1 && r.pts[0] === r.ax && r.pts[1] === r.ay && Math.abs(r.endY - (r.ay - 8)) < 1e-9 && Math.abs(r.drawnLength() - 8) < 1e-9, "nobody holding it, the hook's points are its anchor and its end on along it, its drawn length its length (the hook's own arithmetic)");
  tuneClimb({ ropeLength: 5 });
  r.lay();
  const own = new HangingRope('own', 0, 9, 0, 3);
  ok(Math.abs(r.drawnLength() - 5) < 1e-9 && own.len === 3, 'a rope with no length of its own follows the slider, live; one stood with its own keeps it');
  fresh();
  // Its own swing, nobody holding it: dies away, alike at every rate (its own clock on the physics' step).
  const amps: number[] = [];
  for (const fps of RATES) {
    const q = new HangingRope('free', 0, 9, 0);
    q.th = 0.5;
    for (let i = 0; i < 4 * fps; i++) {
      q.dt = 1 / fps;
      q.stepFree();
    }
    amps.push(q.th);
  }
  ok(amps.every((a) => Math.abs(a - amps[0]) < 0.01) && Math.abs(amps[0]) < 0.5, `a rope swung and let alone swings on by itself and dies away on the physics' own steps, alike at every rate to within a step (${amps.map((a) => (a * DEG).toFixed(2)).join(', ')} degrees after 4 s, from 28.6)`);
}

// ---- grabbing -----------------------------------------------------------------------------------------------------------------
{
  const standing: string[] = [];
  let standOk = true;
  for (const fps of RATES) {
    const { b, r } = await ropeWorld(fps);
    pressE(b, fps);
    const took = b.rope.holding;
    b.run(fps, 1);
    const grip = r.ay - b.rope.s;
    const line = offLine(b, r);
    standOk &&= took && b.rope.phase === PHASE_HANG && Math.abs(grip - ROPE_FACTS.grip) < 0.01 && line < 1e-6 && b.pos.y > 0.2;
    standing.push(`${fps}: the hands at ${grip.toFixed(3)} m, the feet lifted ${b.pos.y.toFixed(2)} m (the hang's 0.49 less the rope's give), ${(line * 1000).toFixed(3)} mm off the line`);
  }
  ok(standOk, `E standing by a rope grabs it where the hanging clip's hands are over the feet (${ROPE_FACTS.grip} m), the body carried onto the rope's line and lifted off the ground (${standing.join('; ')})`);
  // A rope ending just in the band: the hands at its end, short of its last `ROPE_END`.
  let endOk = true;
  for (const fps of RATES) {
    const { b, r } = await ropeWorld(fps, 2.1 + 6, 6);
    pressE(b, fps);
    endOk &&= b.rope.holding && Math.abs(b.rope.s - (6 - ROPE_END)) < 1e-9;
    void r;
  }
  ok(endOk, `a rope ending 2.1 m over the ground is taken at its end, ${ROPE_END} m short of it`);
  // Without E, out of reach: nothing.
  let none = true;
  for (const fps of RATES) {
    const { b } = await ropeWorld(fps);
    b.run(fps, 0.5);
    none &&= !b.rope.holding && b.rope.casts === 0;
    const far = await ropeWorld(fps);
    far.b.place(0, 0, 1.9);
    far.b.run(fps, 0.3);
    pressE(far.b, fps);
    none &&= !far.b.rope.holding;
  }
  ok(none, 'never without E (nothing asked), and never from 1.1 m off the rope (past the hands\' reach)');
  // A jump at a rope ending over a standing reach, E held: grabbed in the air at the hands' height.
  const jumps: string[] = [];
  let jumpOk = true;
  for (const fps of RATES) {
    const { b, r } = await ropeWorld(fps, 2.8 + 6, 6);
    b.key('KeyE', true);
    b.key('Space', true);
    b.frame(1 / fps);
    b.key('Space', false);
    let t = 0;
    for (; !b.rope.holding && t < 1.5; t += 1 / fps) b.frame(1 / fps);
    b.key('KeyE', false);
    const grip = r.ay - b.rope.s;
    jumpOk &&= b.rope.holding && grip > 2.8 && grip < 2.8 + 6;
    jumps.push(`${fps}: at ${t.toFixed(2)} s, the hands ${grip.toFixed(2)} m up`);
  }
  ok(jumpOk, `a standing jump with E held grabs a rope ending 2.8 m up (past a standing reach) in the air (${jumps.join('; ')})`);
  // Falling past it, E held: grabbed (no faster than `grabFall`).
  const falls: string[] = [];
  let fallOk = true;
  for (const fps of RATES) {
    const { b, r } = await ropeWorld(fps, 12, 11, 0);
    b.place(0, 8, 2.5);
    // Falling 0.35 s before E is pressed and held (some 7 m/s down).
    b.run(fps, 0.35);
    const vFall = b.vel.y;
    b.key('KeyE', true);
    let t = 0;
    for (; !b.rope.holding && t < 1.5; t += 1 / fps) b.frame(1 / fps);
    b.key('KeyE', false);
    fallOk &&= b.rope.holding && b.rope.ev >= 0;
    falls.push(`${fps}: falling ${(-vFall).toFixed(1)} m/s, grabbed ${t.toFixed(2)} s after E, ${(r.ay - b.rope.s).toFixed(2)} m up`);
    // The give takes the fall: the rope stretched past its rest and back.
    let most = 0;
    for (let i = 0; i < 2 * fps; i++) {
      b.frame(1 / fps);
      most = Math.max(most, b.rope.e);
    }
    const rest = CLIMB_TUNE.ropeGive * (b.rope.s / r.len);
    fallOk &&= most > rest && Math.abs(b.rope.e - rest) < 0.02;
  }
  ok(fallOk, `falling past a rope with E held grabs it, the fall's speed out along the rope taken by its give, which settles at its rest (${falls.join('; ')})`);
  // No room for the hanging body: a beam just over the standing body's head, where the hanging body's head and shoulders go.
  const p = await makePhysics();
  ground(p, 0);
  box(p, [-1, 1.7, 2.2], [1, 2, 2.8]);
  p.stepOnce();
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(0, 0, 2.5);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.rope.ropes = [new HangingRope('walled', 0, 9, 3)];
  b.run(60, 0.5);
  pressE(b, 60);
  ok(!b.rope.holding && b.ledgeWords.includes('No room to hang from the rope here.'), 'a rope with no room for the hanging body is refused, in words');
}

// ---- on the rope --------------------------------------------------------------------------------------------------------------
/** A body on a rope over open ground: grabbed standing, then lifted up the rope 2 m so nothing near asks the engine. */
async function onRope(fps: number, ay = 12): Promise<{ p: Phys; b: Body; r: Rope }> {
  const w = await ropeWorld(fps, ay, ay - 1);
  pressE(w.b, fps);
  w.b.key('KeyW', true);
  w.b.run(fps, 2 / CLIMB_TUNE.ropeClimb);
  w.b.key('KeyW', false);
  w.b.run(fps, 1);
  return w;
}
{
  // Still: held still, the give settled.
  let stillOk = true;
  const rows: string[] = [];
  for (const fps of RATES) {
    const { b, r } = await onRope(fps);
    const amp0 = b.rope.amplitude();
    b.run(fps, 3);
    const rest = CLIMB_TUNE.ropeGive * (b.rope.s / r.len);
    const amp = b.rope.amplitude();
    stillOk &&= b.rope.holding && b.rope.phase === PHASE_HANG && amp < amp0 && amp * DEG < CLIMB_TUNE.ropeSwingFrom * 0.5 && Math.abs(b.rope.e - rest) < 1e-3 && b.rope.mode === MODE_HANG;
    rows.push(`${fps}: the grab's own sway ${(amp0 * DEG).toFixed(2)} to ${(amp * DEG).toFixed(2)} degrees, stretched ${b.rope.e.toFixed(3)} m of ${rest.toFixed(3)}`);
  }
  ok(stillOk, `nothing held, a hang only stills (the grab's own sway dying away) and plays the hang, the rope's give settled at its rest (${rows.join('; ')})`);
}
{
  // W and S: the climb's speed, to the top and the end; the climb's mode.
  const rows: string[] = [];
  let climbOk = true;
  const tops: number[] = [];
  for (const fps of RATES) {
    const { b, r } = await ropeWorld(fps, 12, 11);
    pressE(b, fps);
    b.run(fps, 0.5);
    const s0 = b.rope.s;
    b.key('KeyW', true);
    b.run(fps, 2);
    const up2 = s0 - b.rope.s;
    const mode = b.rope.mode;
    b.run(fps, 30);
    const top = b.rope.s;
    const stopTop = b.rope.stop;
    b.key('KeyW', false);
    b.key('KeyS', true);
    b.run(fps, 40);
    const end = b.rope.s;
    const stopEnd = b.rope.stop;
    b.key('KeyS', false);
    climbOk &&= Math.abs(up2 - 2 * CLIMB_TUNE.ropeClimb) < 0.02 && mode === MODE_CLIMB && Math.abs(top - ROPE_TOP) < 1e-9 && stopTop === 'top' && b.rope.holding;
    tops.push(end);
    rows.push(`${fps}: up ${up2.toFixed(3)} m in 2 s, the top at ${top.toFixed(3)} (${stopTop}), down to ${end.toFixed(3)} (${stopEnd}), the feet ${b.pos.y.toFixed(3)} m over the ground`);
    climbOk &&= stopEnd === 'end' ? Math.abs(end - (r.len - ROPE_END)) < 1e-9 : stopEnd === 'met' && b.pos.y > 0.05;
  }
  ok(climbOk, `W climbs at the slider's ${CLIMB_TUNE.ropeClimb} m/s playing the climb, stopping with the hands ${ROPE_TOP} m under the anchor; S climbs down to the rope's end, or stops clear of the ground under it (${rows.join('; ')})`);
  ok(tops.every((v) => Math.abs(v - tops[0]) < 0.02), 'and the bottom is the same at every rate');
}
{
  // The pump: A from a still hang over open ground, alike at every rate; to the largest swing and no further; dying away let alone.
  const amps: number[] = [];
  const rows: string[] = [];
  let pumpOk = true;
  for (const fps of RATES) {
    const { b } = await onRope(fps);
    const c0 = b.rope.casts;
    b.key('KeyA', true);
    b.run(fps, 6);
    const a6 = b.rope.amplitude();
    b.run(fps, 30);
    const most = b.rope.amplitude();
    b.key('KeyA', false);
    const mode = b.rope.mode;
    b.run(fps, 4);
    const after = b.rope.amplitude();
    amps.push(a6);
    // A strong push (the slider at 12) reaches the largest swing, and no further.
    tuneClimb({ ropePush: 12 });
    const s2 = await onRope(fps);
    s2.b.key('KeyA', true);
    let top = 0;
    for (let i = 0; i < 20 * fps; i++) {
      s2.b.frame(1 / fps);
      top = Math.max(top, s2.b.rope.amplitude());
    }
    s2.b.key('KeyA', false);
    fresh();
    pumpOk &&= mode === MODE_SWING && a6 > 0.3 && most > a6 && after < most && b.rope.casts - c0 < 4 && top * DEG <= CLIMB_TUNE.ropeMost + 1 && top * DEG > CLIMB_TUNE.ropeMost - 2;
    rows.push(`${fps}: ${(a6 * DEG).toFixed(2)} degrees after 6 s, ${(most * DEG).toFixed(2)} where the push meets the damping, ${(after * DEG).toFixed(2)} 4 s let alone; pushed at 12, ${(top * DEG).toFixed(2)} at the most`);
  }
  ok(pumpOk, `A pumps a still hang to a swing at the swing's own phase, building to where the push meets the damping (with a push strong enough, to the largest, ${CLIMB_TUNE.ropeMost} degrees, and no further than the step that crosses it), playing the swing, and let alone it dies away, its room asked only as the plane turns (${rows.join('; ')})`);
  ok(amps.every((a) => Math.abs(a - amps[0]) * DEG < 0.1), `and the swing is alike at every rate: ${amps.map((a) => (a * DEG).toFixed(3)).join(', ')} degrees after 6 s at 30, 60, 144 and 240`);
}
{
  // D pumps the other way at the same phase; 'ws' lets W and S pump while it swings and climb while it hangs still.
  const { b } = await onRope(60);
  b.key('KeyD', true);
  b.run(60, 4);
  b.key('KeyD', false);
  const dAmp = b.rope.amplitude();
  ok(dAmp * DEG > 10, `D pumps it too, away from the view (${(dAmp * DEG).toFixed(1)} degrees in 4 s)`);
  const w = await onRope(60);
  // (The grab's own sway let die away first: a still hang.)
  w.b.run(60, 8);
  tuneClimb({ ropeKeys: 'ws' });
  const s0 = w.b.rope.s;
  w.b.key('KeyW', true);
  w.b.run(60, 0.5);
  w.b.key('KeyW', false);
  const climbedStill = s0 - w.b.rope.s;
  w.b.key('KeyA', true);
  w.b.run(60, 3);
  w.b.key('KeyA', false);
  const s1 = w.b.rope.s;
  const a1 = w.b.rope.amplitude();
  w.b.key('KeyW', true);
  w.b.run(60, 3);
  w.b.key('KeyW', false);
  ok(climbedStill > 0.2 && Math.abs(w.b.rope.s - s1) < 1e-9 && w.b.rope.amplitude() > a1, `under 'ws' W climbs while the rope hangs still (${climbedStill.toFixed(2)} m) and, once it swings, pumps it on (${(a1 * DEG).toFixed(1)} to ${(w.b.rope.amplitude() * DEG).toFixed(1)} degrees) without climbing`);
  fresh();
}
{
  // Climbing up a swinging rope swings it faster (the angular momentum kept); the radius the hands', the give's and the hang's.
  // Two bodies swung alike, one climbing up the rope 2 m and the other hanging on: the one that climbed swings faster at the swing's
  // bottom (where its speed is the swing's whole), the damping the same for both.
  const swung = async (climb: boolean): Promise<{ om: number; R: number }> => {
    const { b } = await onRope(60, 14);
    b.key('KeyA', true);
    b.run(60, 6);
    b.key('KeyA', false);
    if (climb) b.key('KeyW', true);
    b.run(60, 4);
    b.key('KeyW', false);
    // The fastest the swing goes over the next three seconds (the swing's bottom, a swing or two of each).
    let om = 0;
    for (let i = 0; i < 180; i++) {
      b.frame(1 / 60);
      om = Math.max(om, Math.abs(b.rope.om));
    }
    return { om, R: b.rope.s + b.rope.e + b.rope.hang };
  };
  const hung = await swung(false);
  const climbed = await swung(true);
  ok(climbed.R < hung.R - 1.5 && Math.abs(climbed.om) > Math.abs(hung.om) * 1.1, `a swing climbed up swings faster as a pendulum's does, its angular momentum kept through the climb (at the swing's bottom: hanging on at ${hung.R.toFixed(2)} m, ${(hung.om * DEG).toFixed(1)} degrees a second; climbed to ${climbed.R.toFixed(2)} m, ${(climbed.om * DEG).toFixed(1)})`);
}
{
  // The plane turns toward the view at `ropeTurn`.
  const { b } = await onRope(60);
  b.forward.set(1, 0, 0);
  b.right.set(0, 0, 1);
  b.run(60, 0.5);
  const half = Math.atan2(b.rope.fx, b.rope.fz) * DEG;
  b.run(60, 2);
  const whole = Math.atan2(b.rope.fx, b.rope.fz) * DEG;
  ok(Math.abs(half - CLIMB_TUNE.ropeTurn * 0.5) < 1.5 && Math.abs(whole - 90) < 1e-6 && Math.abs(b.rope.heading * DEG - 90) < 1e-6, `the swing's plane, and the body with it, turns toward the view at ${CLIMB_TUNE.ropeTurn} degrees a second (${half.toFixed(1)} in half a second, at the view's 90 by ${whole.toFixed(1)})`);
}
{
  // A swing into a wall stops there, never in it.
  const rows: string[] = [];
  let wallOk = true;
  for (const fps of RATES) {
    const p = await makePhysics();
    ground(p, 0);
    box(p, [-3, 0, 4.4], [3, 12, 6]);
    p.stepOnce();
    (p as unknown as { acc: number }).acc = 0;
    const r = new HangingRope('by a wall', 0, 12, 3, 11);
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.place(0, 0, 2.5);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.rope.ropes = [r];
    b.run(fps, 0.5);
    pressE(b, fps);
    b.key('KeyW', true);
    b.run(fps, 4);
    b.key('KeyW', false);
    b.key('KeyA', true);
    let deepest = 0;
    for (let i = 0; i < 10 * fps; i++) {
      b.frame(1 / fps);
      deepest = Math.max(deepest, b.pos.z + 0.35 - 4.4);
    }
    b.key('KeyA', false);
    wallOk &&= deepest <= 0 && b.rope.holding;
    rows.push(`${fps}: the body's front ${(-deepest * 100).toFixed(1)} cm short of the wall`);
  }
  ok(wallOk, `a swing pumped into a wall stops there, never in it (${rows.join('; ')})`);
}

// ---- the pose -----------------------------------------------------------------------------------------------------------------
const X = new THREE.Vector3(1, 0, 0);
const V = new THREE.Vector3();
const G = new THREE.Vector3();
/** The game's rope frame on the figure after the body's (the player's `animateRope` and `placeVisual`'s `applyRopeRoot`). */
function drawRope(b: Body, Fg: Figure, dt: number, tab: Tables | null): void {
  const R = b.rope;
  R.placeFigure(tab, Fg.root.scale.y, b.pos);
  driveRopeClips(Fg.rig as never, R as never, dt, Fg.hang);
  Fg.group.position.set(b.pos.x, b.pos.y, b.pos.z);
  Fg.group.rotation.set(0, R.heading, 0);
  const c = Math.cos(R.heading);
  const s = Math.sin(R.heading);
  Fg.root.position.set(R.offX * c - R.offZ * s, R.offY, R.offX * s + R.offZ * c);
  Fg.root.quaternion.setFromAxisAngle(X, R.tilt);
  Fg.group.updateMatrixWorld(true);
}
const hips = (Fg: Figure): THREE.Vector3 => {
  let root: THREE.Object3D | null = null;
  Fg.root.traverse((o) => {
    if (!root && (o as THREE.Bone).isBone && !(o.parent as THREE.Bone).isBone) root = o;
  });
  return (root as unknown as THREE.Object3D).getWorldPosition(V);
};
const gripOf = (Fg: Figure): THREE.Vector3 => {
  G.set(0, 0, 0);
  for (const n of ['lWrist', 'lIndex01', 'rWrist', 'rIndex01']) G.add(Fg.rig.boneNamed(n)!.getWorldPosition(new THREE.Vector3()));
  return G.multiplyScalar(0.25);
};
/** A point's distance off the rope's drawn line (anchor at its drawn angle), metres. */
const offRope = (r: Rope, R: Body['rope'], q: THREE.Vector3): number => {
  const sn = Math.sin(R.thDraw);
  const ux = sn * R.fx;
  const uy = -Math.cos(R.thDraw);
  const uz = sn * R.fz;
  const dx = q.x - r.ax;
  const dy = q.y - r.ay;
  const dz = q.z - r.az;
  const t = dx * ux + dy * uy + dz * uz;
  return Math.hypot(dx - t * ux, dy - t * uy, dz - t * uz);
};
{
  F.rig.twinClip(ROPE_CLIP_NAMES[ROPE_SWING], ROPE_SWING_TWIN);
  const rows: string[] = [];
  let poseOk = true;
  let dirOk = true;
  let climbOk = true;
  for (const fps of RATES) {
    const Fg = figure();
    const tab = measureRopeTables(Fg.rig as never)!;
    Fg.rig.twinClip(ROPE_CLIP_NAMES[ROPE_SWING], ROPE_SWING_TWIN);
    const { b, r } = await ropeWorld(fps, 12, 11);
    const dt = 1 / fps;
    pressE(b, fps);
    drawRope(b, Fg, dt, tab);
    // The grab's carry, then a still hang a second: the hang's clip, the hands on the rope.
    let hangWorst = 0;
    let hangAng = 0;
    let hangSeek = 0;
    for (let i = 0; i < 1.5 * fps; i++) {
      b.frame(dt);
      drawRope(b, Fg, dt, tab);
      if (i > 0.5 * fps) {
        // The hands on the rope; the hips on its line in the swing's plane (the clip's own hips stand a few centimetres to one side).
        hangWorst = Math.max(hangWorst, offRope(r, b.rope, gripOf(Fg)));
        const R = b.rope;
        const gd = R.s + R.e;
        const gx = r.ax + gd * Math.sin(R.thDraw) * R.fx;
        const gy = r.ay - gd * Math.cos(R.thDraw);
        const gz = r.az + gd * Math.sin(R.thDraw) * R.fz;
        const h = hips(Fg);
        hangAng = Math.max(hangAng, Math.abs(Math.atan2((h.x - gx) * R.fx + (h.z - gz) * R.fz, gy - h.y) - R.thDraw));
        const cur = (Fg.rig as unknown as { current: THREE.AnimationAction | null }).current;
        if (cur && cur.getClip().name === ROPE_CLIP_NAMES[ROPE_HANG]) hangSeek = Math.max(hangSeek, Math.abs(cur.time - R.loopT));
      }
    }
    const hangClip = Fg.rig.currentClip;
    // Climbing: the climb's clip at the way climbed.
    b.key('KeyW', true);
    let climbHands = 0;
    let climbSeek = 0;
    let lastT = Number.NaN;
    let ups = 0;
    let upsOn = 0;
    for (let i = 0; i < 2 * fps; i++) {
      b.frame(dt);
      drawRope(b, Fg, dt, tab);
      if (i > 0.3 * fps) {
        climbHands = Math.max(climbHands, offRope(r, b.rope, gripOf(Fg)));
        const cur = (Fg.rig as unknown as { current: THREE.AnimationAction | null }).current;
        if (cur && cur.getClip().name === ROPE_CLIP_NAMES[ROPE_CLIMB]) climbSeek = Math.max(climbSeek, Math.abs(cur.time - b.rope.loopT));
        if (lastT === lastT && b.rope.climbNow > 0) {
          ups++;
          const d = b.rope.loopT - lastT;
          if (d > 0 || d < -tab.climb.duration / 2) upsOn++;
        }
      }
      lastT = b.rope.loopT;
    }
    b.key('KeyW', false);
    climbOk &&= climbSeek < 1e-6 && ups > 0 && upsOn === ups && climbHands < 0.03;
    // Pumped with A for eight seconds: the swing's clip, the hands on the rope and the hips on its line.
    b.run(fps, 1);
    b.key('KeyA', true);
    let gripWorst = 0;
    let angWorst = 0;
    let seekWorst = 0;
    let fwd = 0;
    let fwdUp = 0;
    let back = 0;
    let backDown = 0;
    let lastS = Fg.rig.overrideAt();
    for (let i = 0; i < 8 * fps; i++) {
      b.frame(dt);
      drawRope(b, Fg, dt, tab);
      const R = b.rope;
      if (R.mode !== MODE_SWING) {
        lastS = Number.NaN;
        continue;
      }
      // (Past the mode's own ease, the placement is the swing's alone.)
      const g = gripOf(Fg);
      const gd = R.s + R.e;
      const gx = r.ax + gd * Math.sin(R.thDraw) * R.fx;
      const gy = r.ay - gd * Math.cos(R.thDraw);
      const gz = r.az + gd * Math.sin(R.thDraw) * R.fz;
      const t = Fg.rig.overrideAt();
      if (i > 2 * fps) {
        gripWorst = Math.max(gripWorst, Math.hypot(g.x - gx, g.y - gy, g.z - gz));
        const h = hips(Fg);
        const ang = Math.atan2((h.x - gx) * R.fx + (h.z - gz) * R.fz, gy - h.y);
        angWorst = Math.max(angWorst, Math.abs(ang - R.thDraw));
        seekWorst = Math.max(seekWorst, Math.abs(t - R.poseT));
        if (Math.abs(R.om) > 0.1 && lastS === lastS) {
          if (R.om > 0) {
            fwd++;
            if (t >= lastS) fwdUp++;
          } else {
            back++;
            if (t <= lastS) backDown++;
          }
        }
      }
      lastS = t;
    }
    b.key('KeyA', false);
    poseOk &&= hangClip === ROPE_CLIP_NAMES[ROPE_HANG] && hangWorst < 0.01 && hangAng < 0.002 && hangSeek < 1e-6 && gripWorst < 0.01 && angWorst < 0.002 && seekWorst < 1e-9;
    dirOk &&= fwd > 0 && back > 0 && fwdUp / fwd > 0.97 && backDown / back > 0.97;
    rows.push(`${fps}: hanging the hands ${(hangWorst * 1000).toFixed(1)} mm off the rope, the hips ${(hangAng * DEG).toFixed(3)} degrees off its line; climbing the hands ${(climbHands * 100).toFixed(1)} cm off it (sliding along it as the clip reaches and pulls); swinging the hands ${(gripWorst * 1000).toFixed(1)} mm off the rope's grip, the hips ${(angWorst * DEG).toFixed(3)} degrees off its line; forward ${fwdUp}/${fwd} frames on, back ${backDown}/${back} back`);
  }
  ok(poseOk, `the figure plays the hang still and the swing swinging, its hands on the rope and its hips on the rope's line every frame (the swing's clip at the time the pendulum asks) (${rows.join('; ')})`);
  ok(dirOk, "the swing's clip plays forward while the swing goes forward and backward while it comes back");
  ok(climbOk, "the climb's clip is put at the way climbed, going forward as the body climbs up, the hands on the rope's line within 3 cm");
}

// ---- letting go (the plain let-go) --------------------------------------------------------------------------------------------
{
  let spaceOk = true;
  let dropOk = true;
  const rows: string[] = [];
  for (const fps of RATES) {
    const { b, r } = await onRope(fps);
    b.key('KeyA', true);
    b.run(fps, 6);
    b.key('KeyA', false);
    // Let go at the swing's bottom, moving forward.
    for (let i = 0; i < 10 * fps && !(b.rope.th > 0 && b.rope.th < 0.05 && b.rope.om > 0); i++) b.frame(1 / fps);
    const R = b.rope.s + b.rope.e + b.rope.hang;
    const v = R * b.rope.om;
    const th = b.rope.th;
    const om = b.rope.om;
    b.key('Space', true);
    b.frame(1 / fps);
    b.key('Space', false);
    spaceOk &&= !b.rope.holding && Math.abs(b.vel.z - v * Math.cos(th)) < 0.6 && !r.held && Math.abs(r.om - om) < 0.2;
    rows.push(`${fps}: let go at ${(v).toFixed(2)} m/s, the body at ${b.vel.z.toFixed(2)} m/s across`);
    // The rope swings on by itself and is not grabbed again at once.
    const o = await onRope(fps);
    o.b.key('ControlLeft', true);
    o.b.frame(1 / fps);
    o.b.key('ControlLeft', false);
    const vy = o.b.vel.y;
    dropOk &&= !o.b.rope.holding && Math.abs(vy) < 0.5 && Math.abs(o.b.vel.x) < 1e-6 && Math.abs(o.b.vel.z) < 1e-6;
  }
  ok(spaceOk, `Space lets go on the swing's own velocity, the rope swinging on from where the body left it (${rows.join('; ')})`);
  ok(dropOk, 'the crouch key lets go straight down');
}

// ---- 'off', the switch's other setting, and the hand-overs -------------------------------------------------------------------
{
  climbSmooth3Before();
  const offAll = CLIMB_TUNE.ropes === CLIMB_ROPES_BEFORE.ropes && CLIMB_ROPES_BEFORE.ropes === 'off';
  fresh();
  climbBarsBefore();
  const viaBars = CLIMB_TUNE.ropes === 'off';
  fresh();
  ok(offAll && viaBars && CLIMB_TUNE.ropes === 'on', "phase 3's put back (and so every older round's chain) puts the ropes to 'off'; the game ships them 'on'");
  tuneClimb({ ropes: 'off' });
  const { b } = await ropeWorld(60);
  pressE(b, 60);
  b.run(60, 0.5);
  ok(!b.rope.holding && b.rope.casts === 0 && b.rope.phase === ROPE_NONE && b.rope.grabs === 0, "under 'off' E by a rope takes nothing and the rope asks the engine nothing");
  fresh();
  void ROPE_GRAB;
}
{
  const text = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
  const player = text('src/player/player.ts');
  const harness = text('tools/swg/tests/grappleBody.ts');
  const tune = text('src/anim/climbTune.ts');
  const clips = text('src/player/hangClips.ts');
  const main = text('src/main.ts');
  const build = text('src/anim/climbCourseBuild.ts');
  const body = text('tools/swg/tests/climbCourseBody.ts');
  const at = (s: string, x: string) => s.indexOf(x);
  ok(at(player, 'if (this.rope.holding) {\n      this.ropeFrame(dt, input, cam, world);\n      return;\n    }') > at(player, 'if (this.bar.holding) {\n      this.barFrame(dt, input, cam, world);') && at(player, 'if (this.rope.holding) {\n      this.ropeFrame(dt, input, cam, world);') < at(player, 'if (this.ledge.holding) {\n      this.hangFrame(dt, input, cam, world);'), "the player: on a rope, the swing's frame in place of the movement, after the bar's and before the ledge's");
  ok(at(player, 'if (this.senseRope(dt, input, move, wasGrounded, atControls, cam)) {') > at(player, 'if (this.senseBar(dt, input, move, wasGrounded, atControls)) {') && at(player, 'if (this.senseRope(') < at(player, 'if (this.senseLedge(dt, input, move, wasGrounded, atControls)) {'), "and the rope's grab after the move, after the bars' and before the ledges'");
  ok(/li\.busy = this\.swimming \|\| this\.grapple\.out \|\| this\.grapple\.released \|\| this\.flung \|\| this\.hp <= 0 \|\| atControls \|\| this\.prone/.test(player.slice(at(player, '  private senseRope('))) && /return this\.ledge\.holding \|\| this\.wall\.holding \|\| this\.bar\.holding \|\| this\.rope\.holding;/.test(player), "a hook rope out refuses the rope's grab, and a rope held mutes the fight's keys and refuses the hook (`climbHolds`), as a hang and a bar do");
  ok(/return this\.reachBar \|\| this\.ledge\.canGrab\(w, this, li\) \|\| this\.wall\.canClimb\(w, this, li\) \|\| this\.ropeReach\(li\);/.test(player) && /if \(player\.climbFalls && player\.climbReach\(\)\) player\.climbAsk\.press\(\);/.test(main), "a rope in reach is the use key's climb, through the game's one use-key dispatch (falling first, else what nothing else took)");
  ok(/R\.steps = this\.physics\.stepsAhead\(dt\);\n    R\.behind = this\.physics\.behind;\n    R\.step\(this\.physics\.world as unknown as RopeWorld, this, li\);/.test(player) && /R\.steps = this\.physics\.stepsAhead\(dt\);\n    R\.behind = this\.physics\.behind;\n    R\.step\(this\.physics\.world as unknown as RopeWorld, this, this\.fillLedgeIn\(dt, null, false\)\);/.test(harness), "the player and the harness both hand the swing the physics' coming steps and remainder before it steps");
  ok(/this\.rope\.placeFigure\(this\.ropeTablesRig === rig \? this\.ropeTables : null, rig\.root\.scale\.y, this\.pos\);\n    driveRopeClips\(rig, this\.rope, dt, this\.hangClips\);/.test(player) && /const T = measureRopeTables\(rig\);/.test(player) && /rig\.twinClip\(ROPE_CLIP_NAMES\[ROPE_SWING\], ROPE_SWING_TWIN\);/.test(player), "the player measures the clips off its own rig once, makes the swing's twin, places the figure, then hands the rig the clips (as the tests' figure does)");
  ok(/rig\.root\.position\.x = R\.offX \* c - R\.offZ \* s;\n    rig\.root\.position\.y \+= R\.offY;\n    rig\.root\.position\.z = R\.offX \* s \+ R\.offZ \* c;\n    rig\.root\.quaternion\.setFromAxisAngle\(AXIS_X, R\.tilt\);/.test(player), 'and draws the figure where the swing says (`applyRopeRoot`), as the tests\' figure does');
  ok(/releaseRopeClip\(this\.rig, this\.rope\);\n    this\.rope\.tick\(dt\);/.test(player) && /this\.rope\.tick\(dt\);/.test(harness), "off the rope, a let-go's clips let go of and the rope's clocks stepped (the free ropes swung), every frame of the movement");
  ok(/this\.rope\.reset\('stood elsewhere'\);/.test(player) && /if \(this\.rope\.holding\) this\.rope\.reset\('off the feet'\);/.test(player) && /this\.rope\.reset\('stood elsewhere'\);/.test(harness), 'stood elsewhere or off the feet, the rope lets go');
  ok(/export function climbBarsBefore\(\): void \{\n  \/\/ [^\n]*\n  climbRopesBefore\(\);/.test(tune), "phase 3's put back calls phase 4's first");
  ok(/rig\.overrideSeekAt = R\.poseT;\n      rig\.overrideSeekNow\(R\.swingName\);/.test(clips) && /rig\.timeAt = R\.loopT;\n      rig\.setTimeNow\(climbing \? ROPE_CLIP_NAMES\[ROPE_CLIMB\] : ROPE_CLIP_NAMES\[ROPE_HANG\]\);/.test(clips) && !/ledgeClipName\(|`mx_/.test(clips.slice(at(clips, 'export function driveRopeClips'), at(clips, 'export function releaseRopeClip'))), "the clips are put at the swing's and the climb's times through the rig's own fields, by the names made once (no name made, no number handed across a call)");
  ok(/player\.drawGrapple\(this\.cam\.camera, window\.innerHeight\);\n(\s+\/\/[^\n]*\n)*\s+player\.drawRopes\(this\.cam\.camera, window\.innerHeight\);/.test(main) && /this\.player\.drawGrapple\(this\.cam\.camera, window\.innerHeight\);\n\s+this\.player\.drawRopes\(this\.cam\.camera, window\.innerHeight\);/.test(main), "the game lays the ropes beside the hook's rope every frame it draws (the frame loop's and the console's advance)");
  ok(/const ropes = standCourseRopes\(course, frame, colliders\);/.test(main) && /this\.player\.addRope\(r\);/.test(main) && /for \(const r of s\.ropes\) this\.player\.removeRope\(r\);/.test(main) && /const ropes = standCourseRopes\(one, frame, colliders\);\n  physics\.stepOnce\(\);/.test(body) && /courseRopes\(/.test(build), "the course's rope stood the one way, by the game's `climbTest` and the harness alike, and taken down with the course");
  ok(/this\.dropClimbTest\(why\);\n\s+\/\/[^\n]*\n\s+this\.dropConsoleRopes\(\);/.test(main) && /if \(o\.rope !== undefined && o\.rope !== false\) words\.push\(this\.consoleRope\(o\.rope\)\);/.test(main) && /rope: p\.rope\.report\(\),/.test(main), "the console stands a rope at the aim (`climb({ rope })`), reports the ropes, and the world's leaving takes its ropes down");
  // The course's mesh drawn without the rope's column, and the column apart (shown only while ropes are 'off').
  const course = climbCourse({ pieces: ['rope', 'bars-2'] });
  const f = { ox: 0, oz: 0, h: 0, ref: () => 0 };
  const all = courseTriangles(course, f).positions.length;
  const rest = courseTriangles(course, f, (role) => role !== 'rope').positions.length;
  const col = courseTriangles(course, f, (role) => role === 'rope').positions.length;
  ok(col > 0 && rest + col === all && /courseTriangles\(course, frame, notRopeColumn\)/.test(main) && /courseTriangles\(course, frame, ropeColumnOnly\)/.test(main), "the course's mesh is every solid but the rope's column, which is drawn apart");
}

console.log(`climbRopes: ${checks} checks passed`);
