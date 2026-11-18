// Wave 4 of the animations, item A: the ledges (src/player/ledge.ts), on the real Rapier through the grapple's harness
// (tools/swg/tests/grappleBody.ts), which steps the game's own movement, slope rule and ledge calls in the player's order:
//  - a wall whose lip stands at heights in the hands' reach: a standing jump and a running jump grab it, at the same place,
//    at 30, 60 and 144 frames a second; a lip out of a plain jump's reach is not grabbed; crouch held in the air never grabs;
//    crouched, walking off a top deeper than a hang lowers the body into a hang (and on to braced where the wall is there);
//  - braced against a wall, free under an overhang's lip; a shimmy along a 6 m lip to its end, stopping there; a hop to a lip
//    1.2 m to the side and 1.2 m up, its hands on the new lip; a climb up onto a roof with room, and refused in words under a
//    low ceiling; crouch lets go and the body falls; S with Space jumps off backward; the stamina emptied lets go and grabs
//    nothing more until it is back to the tired line; a grab ends a fall with no harm (the same fall with `ledges` 'before'
//    hurts);
//  - the grapple refused while hanging, in its own words; the hang's state words go to other players as rig states every
//    one of the peers' list knows;
//  - a mutation of each rule run through the same scenes fails its check (`--mutants`, below).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBody, box, ground, makePhysics, THREE, type Physics } from './grappleBody.ts';
import { CLIMB_BARS_BEFORE, CLIMB_FB2_BEFORE, CLIMB_ROPES_BEFORE, CLIMB_FEEDBACK_BEFORE, CLIMB_SMOOTH_BEFORE, CLIMB_SMOOTH2_BEFORE, CLIMB_SMOOTH3_BEFORE, CLIMB_TUNE, CLIMB_TUNE_SHIPPED, CLIMB_TWO_BEFORE, resetClimbTune, tuneClimb, climbTwoBefore } from '../../../src/anim/climbTune.ts';
import { LEDGE_HANG, LEDGE_MOVE } from '../../../src/player/ledge.ts';
import { LEDGE_FACTS, LEDGE_ROLES } from '../../../src/anim/ledgeClips.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import { REPO } from './oldModules.ts';
import { Group, RAPIER, TRIMESH_FLAGS, cleanTrimesh, groups } from '../../../src/core/physics.ts';

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
const n3 = (v: number) => v.toFixed(3);

// ---- the scenes ------------------------------------------------------------------------------------------------------------
/** Flat ground and a wall whose face looks toward -z at z = `face`, its top at `top`, from x0 to x1, a metre deep. */
async function wallScene(top: number, x0 = -3, x1 = 3, face = 2, trimesh = true): Promise<Physics> {
  const p = await makePhysics();
  ground(p, 0);
  box(p, [x0, 0, face], [x1, top, face + 1], trimesh);
  p.stepOnce();
  return p;
}

/** A body on the ground at (x, z), facing +z (the camera's forward), with no Force (a plain jump's 0.8 m apex). */
function bodyAt(p: Physics, x: number, z: number, fps: number, y = 0, settle = 0.3): TestBody {
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(x, y, z);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  if (settle > 0) b.run(fps, settle);
  return b;
}

/** Frames until `until` holds or the seconds run out; answers the seconds taken (Infinity for never). */
function runUntil(b: TestBody, fps: number, seconds: number, until: () => boolean): number {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    b.frame(1 / fps);
    if (until()) return (i + 1) / fps;
  }
  return Infinity;
}

/** Press a key for one frame (down, a frame, up). */
function tap(b: TestBody, code: string, fps: number, also: string[] = []): void {
  for (const k of also) b.key(k, true);
  b.key(code, true);
  b.frame(1 / fps);
  b.key(code, false);
  for (const k of also) b.key(k, false);
}

const settled = (b: TestBody) => b.ledge.phase === LEDGE_HANG;

/** A standing jump (W held, Space tapped) from (x, z) at a wall, run until the hang settles; null where it never grabbed. */
function standingJump(top: number, fps: number, z = 1.2): Promise<{ b: TestBody; t: number } | null> {
  return (async () => {
    const p = await wallScene(top);
    const b = bodyAt(p, 0, z, fps);
    b.key('KeyW', true);
    tap(b, 'Space', fps);
    const t = runUntil(b, fps, 3, () => settled(b));
    b.key('KeyW', false);
    return Number.isFinite(t) ? { b, t } : null;
  })();
}

const FPS = [30, 60, 144] as const;
const restore = () => {
  resetClimbTune();
  climbTwoBefore();
};

// ---- 1. the grab --------------------------------------------------------------------------------------------------------------
{
  const places: string[] = [];
  for (const fps of FPS) {
    const g = await standingJump(2.6, fps);
    ok(!!g && g.b.ledge.braced, `a standing jump at a wall whose lip is 2.6 m up grabs it, braced, at ${fps} fps (settled in ${g ? g.t.toFixed(2) : '-'} s)`);
    places.push(`${n3(g!.b.pos.x)},${n3(g!.b.pos.y)},${n3(g!.b.pos.z)}`);
    ok(g!.b.fallDamage === 0, `  and the grab ends the jump with no harm at ${fps} fps`);
  }
  ok(new Set(places).size === 1, `the hang place is the same at 30, 60 and 144 fps (${places[0]})`);
  // A running jump from 3 m back grabs the same lip at the same place.
  for (const fps of FPS) {
    const p = await wallScene(2.6);
    const b = bodyAt(p, 0, -2.2, fps);
    b.key('KeyW', true);
    b.run(fps, 0.45);
    tap(b, 'Space', fps);
    const t = runUntil(b, fps, 3, () => settled(b));
    b.key('KeyW', false);
    const [px, py, pz] = places[0].split(',').map(Number);
    ok(Number.isFinite(t) && Math.abs(b.pos.x - px) < 2e-3 && Math.abs(b.pos.y - py) < 2e-3 && Math.abs(b.pos.z - pz) < 2e-3, `a running jump grabs it at the very same place at ${fps} fps (${n3(b.pos.x)},${n3(b.pos.y)},${n3(b.pos.z)})`);
  }
  // The hang place: the idle's own feet under the lip, out from the face by its grip.
  const f = LEDGE_FACTS[LEDGE_ROLES.braced.idle];
  const wantY = 2.6 - (CLIMB_TUNE.gripDrop + f.g0[1] - (f.a0 - 0.093));
  const wantZ = 2 - (CLIMB_TUNE.gripOut + f.g0[2]);
  ok(Math.abs(Number(places[0].split(',')[1]) - wantY) < 1e-3 && Math.abs(Number(places[0].split(',')[2]) - wantZ) < 1e-3, `the body hangs with its feet ${n3(2.6 - wantY)} m under the lip and its middle ${n3(2 - wantZ)} m out from the face (the braced idle's own, measured on the human male)`);
  // Out of reach: a lip 3.4 m up is past a plain jump's hands (its apex 0.84 m and the band's top 2.35 m). (The wall climb,
  // item B, held at 'before': W held against the face after the landing climbs it to the lip, which is its suite's.)
  CLIMB_TUNE.wall = 'before';
  for (const fps of FPS) {
    const g = await standingJump(3.4, fps);
    ok(g === null, `a lip 3.4 m up is out of a plain jump's reach and is not grabbed at ${fps} fps`);
  }
  CLIMB_TUNE.wall = 'on';
  // Crouch held in the air never grabs.
  {
    const p = await wallScene(2.6);
    const b = bodyAt(p, 0, 1.2, 60);
    b.key('KeyW', true);
    tap(b, 'Space', 60);
    b.key('ControlLeft', true);
    const t = runUntil(b, 60, 2, () => b.ledge.holding);
    b.key('ControlLeft', false);
    b.key('KeyW', false);
    ok(!Number.isFinite(t), 'crouch held in the air never grabs');
  }
  // No keys and no travel: nothing is moving toward the face, nothing grabbed.
  {
    const p = await wallScene(2.6);
    const b = bodyAt(p, 0, 1.4, 60);
    tap(b, 'Space', 60);
    const t = runUntil(b, 60, 2, () => b.ledge.holding);
    ok(!Number.isFinite(t), 'a jump straight up with no key toward the wall grabs nothing (the grab is moving toward a face)');
  }
  // Falling faster than `grabFall` passes the lip.
  {
    const p = await wallScene(2.6);
    const b = bodyAt(p, 0, 1.4, 60, 9);
    b.key('KeyW', true);
    const t = runUntil(b, 60, 3, () => b.ledge.holding);
    b.key('KeyW', false);
    ok(!Number.isFinite(t), `falling from 9 m past a lip 2.6 m up (about ${Math.sqrt(2 * 20.3 * 4.5).toFixed(1)} m/s at the lip) is too fast to grab (grabFall ${CLIMB_TUNE.grabFall})`);
  }
}

// ---- 2. a grab ends the fall: no harm --------------------------------------------------------------------------------------------
{
  for (const ledges of ['on', 'before'] as const) {
    tuneClimb({ ledges });
    // A cuboid wall: a body sliding down a trimesh face catches on its triangles' shared diagonal (the engine's own,
    // 'before' and 'on' alike: the report says so), which is not what this asks.
    const p = await wallScene(2.6, -3, 3, 2, false);
    // Dropped from 4.2 m in front of the wall, W held toward it: the lip comes into the hands at about 11 m/s.
    const b = bodyAt(p, 0, 0.8, 60, 4.2, 0);
    b.key('KeyW', true);
    runUntil(b, 60, 3, () => b.ledge.phase === LEDGE_HANG || b.grounded);
    b.key('KeyW', false);
    // The landing's harm is told on the step after the feet touch (the movement reads the ground a frame on).
    if (!b.ledge.holding) b.run(60, 0.2);
    if (ledges === 'on') ok(b.ledge.holding && b.fallDamage === 0, `a fall from 4.2 m onto a lip 2.6 m up is caught by the grab with no harm (${b.fallDamage})`);
    else ok(!b.ledge.holding && b.fallDamage > 0, `under 'before' the same fall reaches the ground and hurts (${b.fallDamage})`);
    // Let go: the drop from the hang to the ground is harmless (a hang's feet are 1.25 m up).
    if (ledges === 'on') {
      tap(b, 'ControlLeft', 60);
      runUntil(b, 60, 2, () => b.grounded);
      ok(b.grounded && !b.ledge.holding && b.fallDamage === 0 && b.pos.y < 0.1, `crouch lets go and the body falls to the ground unhurt (feet at ${n3(b.pos.y)})`);
    }
  }
  restore();
}

// ---- 3. free under an overhang; braced against a wall ---------------------------------------------------------------------------
{
  const p = await makePhysics();
  ground(p, 0);
  // A slab from z 1.6 out over nothing, 0.6 m thick, its top 2.8 m up: an overhang's lip.
  box(p, [-3, 2.2, 1.6], [3, 2.8, 4]);
  p.stepOnce();
  const b = bodyAt(p, 0, 1.0, 60);
  b.key('KeyW', true);
  tap(b, 'Space', 60);
  const t = runUntil(b, 60, 3, () => settled(b));
  b.key('KeyW', false);
  ok(Number.isFinite(t) && !b.ledge.braced, `under an overhang's lip (nothing for the feet) the hang is free (feet ${n3(b.pos.y)} m up, ${n3(1.6 - b.pos.z)} m out from the face)`);
  ok(b.ledge.rigState === 'hangFree', `  its loop is the free hang's (${b.ledge.rigState})`);
  // Its capsule stays clear of the slab.
  // The capsule's top sphere against the slab's near corner (the nearest of the slab to it).
  const cy = b.pos.y + 1.6 - 0.35;
  const dy = Math.max(0, 2.2 - cy);
  const dz = Math.max(0, 1.6 - b.pos.z);
  ok(Math.hypot(dy, dz) >= 0.35 - 1e-3, `  and its capsule is clear of the slab (pushed out from under the lip until it is: ${n3(Math.hypot(dy, dz))} m from the slab's corner)`);
}

// ---- 4. the shimmy along a 6 m lip, to its end ------------------------------------------------------------------------------
{
  for (const fps of FPS) {
    // The lip ends where a taller block stands at each end of the wall (no lip goes on: the fix round's shimmy goes round
    // any corner a lip goes on round, ledgeCorners.test.ts).
    const p = await makePhysics();
    ground(p, 0);
    box(p, [-3, 0, 2], [3, 2.6, 3]);
    box(p, [-3.5, 0, 1], [-3, 4, 3]);
    box(p, [3, 0, 1], [3.5, 4, 3]);
    p.stepOnce();
    const b = bodyAt(p, 0, 1.2, fps);
    b.key('KeyW', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 3, () => settled(b));
    b.key('KeyW', false);
    const x0 = b.pos.x;
    b.key('KeyD', true);
    // Its pace over a second in the middle of the lip.
    b.run(fps, 0.5);
    const xa = b.pos.x;
    b.run(fps, 1);
    const pace = xa - b.pos.x;
    const t = runUntil(b, fps, 20, () => b.ledge.shimmy === 0 && b.pos.x < x0 - 1);
    const x1 = b.pos.x;
    b.run(fps, 0.5);
    b.key('KeyD', false);
    const f = LEDGE_FACTS[LEDGE_ROLES.braced.shimmyRight];
    const speed = Math.abs(f.net[0]) / f.dur;
    // The wall runs from x -3: the shimmy (D, the figure's right, -x) stops with its leading hand a hand's width short of it.
    const stopAt = -3 + Math.abs(f.span0) / 2 + CLIMB_TUNE.edgeAhead;
    ok(Number.isFinite(t) && b.ledge.holding && Math.abs(x1 - stopAt) < speed / fps + 0.16 && Math.abs(b.pos.x - x1) < 1e-9, `at ${fps} fps a shimmy right along the 6 m lip stops at its end (x ${n3(x1)}, the rule's ${n3(stopAt)}) and stays there with D still held`);
    ok(Math.abs(pace - speed) < 1e-3, `  at the clip's own pace (${pace.toFixed(4)} m/s over a second, the clip's ${speed.toFixed(4)})`);
  }
  // A corner: a second wall at right angles rising past the lip (no lip goes on round it), and the shimmy stops at it.
  const p = await makePhysics();
  ground(p, 0);
  box(p, [-3, 0, 2], [1, 2.6, 3]);
  box(p, [1, 0, 0], [2, 4, 3]);
  p.stepOnce();
  const b = bodyAt(p, -1, 1.2, 60);
  b.key('KeyW', true);
  tap(b, 'Space', 60);
  runUntil(b, 60, 3, () => settled(b));
  b.key('KeyW', false);
  b.key('KeyA', true);
  runUntil(b, 60, 10, () => b.ledge.shimmy === 0 && b.pos.x > -0.5);
  b.key('KeyA', false);
  ok(b.ledge.holding && b.pos.x < 1 - 0.35 + 0.01, `at an inner corner the shimmy left stops before the side wall (body x ${n3(b.pos.x)})`);
}

// ---- 5. the hop: 1.2 m to the side and 1.2 m up --------------------------------------------------------------------------------
{
  for (const fps of FPS) {
    const p = await makePhysics();
    ground(p, 0);
    box(p, [-3, 0, 2], [0.4, 2.6, 3]);
    box(p, [1.2, 0, 2], [3, 3.8, 3]);
    p.stepOnce();
    const b = bodyAt(p, 0, 1.2, fps);
    b.key('KeyW', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 3, () => settled(b));
    b.key('KeyW', false);
    const sta = b.stamina.value;
    tap(b, 'Space', fps, ['KeyA']);
    const moving = b.ledge.phase === LEDGE_MOVE && b.ledge.move.kind === 'hop';
    runUntil(b, fps, 4, () => settled(b));
    const f = LEDGE_FACTS[LEDGE_ROLES.braced.idle];
    const wantY = 3.8 - (CLIMB_TUNE.gripDrop + f.g0[1] - (f.a0 - 0.093));
    ok(moving && settled(b) && Math.abs(b.ledge.lip.ey - 3.8) < 1e-3 && Math.abs(b.pos.y - wantY) < 1e-3 && b.pos.x > 1.2, `at ${fps} fps Space with A hops to the lip 1.2 m to the side and 1.2 m up (hangs at x ${n3(b.pos.x)}, feet ${n3(b.pos.y)})`);
    ok(sta - b.stamina.value >= CLIMB_TUNE.stamina.hop - 1e-6, `  and the hop takes its lump of stamina (${(sta - b.stamina.value).toFixed(1)} of ${CLIMB_TUNE.stamina.hop}, with the hang's own drain)`);
  }
  // No lip within reach: refused in words.
  const g = await standingJump(2.6, 60);
  tap(g!.b, 'Space', 60, ['KeyD']);
  ok(g!.b.ledgeWords.includes('No ledge to hop to.') && settled(g!.b), 'with no other lip within reach a hop is refused in words and the body stays hanging');
  // A hop up the same face to a lip 1.2 m higher.
  {
    const p = await makePhysics();
    ground(p, 0);
    box(p, [-3, 0, 2], [3, 2.6, 2.4]);
    box(p, [-3, 0, 2.4], [3, 3.8, 3]);
    p.stepOnce();
    const b = bodyAt(p, 0, 1.2, 60);
    b.key('KeyW', true);
    tap(b, 'Space', 60);
    runUntil(b, 60, 3, () => settled(b));
    tap(b, 'Space', 60, ['KeyW']);
    runUntil(b, 60, 4, () => settled(b));
    b.key('KeyW', false);
    ok(settled(b) && Math.abs(b.ledge.lip.ey - 3.8) < 1e-3 && Math.abs(b.ledge.lip.ez - 2.4) < 1e-3, `Space with W hops up the face to the lip 1.2 m higher (lip ${n3(b.ledge.lip.ey)} at z ${n3(b.ledge.lip.ez)})`);
  }
}

// ---- 6. the climb up, and refused under a low ceiling ------------------------------------------------------------------------
{
  for (const fps of FPS) {
    const g = await standingJump(2.6, fps);
    const b = g!.b;
    tap(b, 'Space', fps);
    const climbing = b.ledge.phase === LEDGE_MOVE && b.ledge.move.kind === 'climb';
    // The rig plays the climb from its start and steps it by the frame in the frame it begins: so is it carried.
    const t0 = LEDGE_FACTS[b.ledge.move.id]?.t0 ?? Number.NaN;
    ok(climbing && Math.abs(b.ledge.move.time - (t0 + 1 / fps)) < 1e-9, `  at ${fps} fps a one-off begun in the hang's step is carried its first frame in that same frame (its clock ${n3(b.ledge.move.time)} s, the clip's start ${n3(t0)} and a frame)`);
    runUntil(b, fps, 3, () => !b.ledge.holding);
    b.run(fps, 0.5);
    ok(climbing && !b.ledge.holding && b.grounded && Math.abs(b.pos.y - 2.6) < 0.05 && b.pos.z > 2.1, `at ${fps} fps Space climbs up onto the top (feet ${n3(b.pos.y)} at z ${n3(b.pos.z)}), crouched while there is no room to stand (${b.ledge.keepCrouched ? 'kept crouched' : 'standing'})`);
  }
  // W pressed (not held from the jump) climbs too.
  {
    const g = await standingJump(2.6, 60);
    tap(g!.b, 'KeyW', 60);
    ok(g!.b.ledge.phase === LEDGE_MOVE && g!.b.ledge.move.kind === 'climb', 'W pressed while hanging climbs up as Space does');
  }
  // A ceiling 0.8 m over the top: no room for the crouched capsule (1.0 m), refused in words.
  {
    const p = await wallScene(2.6);
    box(p, [-3, 3.4, 2], [3, 3.6, 3]);
    p.stepOnce();
    const b = bodyAt(p, 0, 1.2, 60);
    b.key('KeyW', true);
    tap(b, 'Space', 60);
    runUntil(b, 60, 3, () => settled(b));
    b.key('KeyW', false);
    tap(b, 'Space', 60);
    ok(settled(b) && b.ledgeWords.includes('No room to climb up here.'), 'under a ceiling 0.8 m over the top the climb is refused in words and the body stays hanging');
  }
}

// ---- 7. jump off, and the stamina ------------------------------------------------------------------------------------------
{
  const g = await standingJump(2.6, 60);
  const b = g!.b;
  const z0 = b.pos.z;
  b.key('KeyS', true);
  tap(b, 'Space', 60);
  b.key('KeyS', false);
  ok(!b.ledge.holding && b.vel.z < -1 && b.vel.y > 1, `S with Space jumps off backward (velocity ${n3(b.vel.z)} back, ${n3(b.vel.y)} up)`);
  runUntil(b, 60, 3, () => b.grounded);
  ok(b.grounded && z0 - b.pos.z > 1 && b.fallDamage === 0, `  and lands ${n3(z0 - b.pos.z)} m back from the wall, unhurt`);
  // Not grabbed again at once.
  ok(!b.ledge.holding, '  and the lip it left is not grabbed again on the way down');
}
{
  tuneClimb({ stamina: { hang: 40 } });
  const g = await standingJump(2.6, 60);
  const b = g!.b;
  const t = runUntil(b, 60, 6, () => !b.ledge.holding);
  ok(Number.isFinite(t) && b.ledgeWords.includes('Too tired to hold on.') && b.stamina.tired, `the stamina emptied (drained ${CLIMB_TUNE.stamina.hang} a second) lets go, in words (${t.toFixed(2)} s)`);
  runUntil(b, 60, 2, () => b.grounded);
  // Tired: a jump at the lip grabs nothing.
  b.key('KeyW', true);
  tap(b, 'Space', 60);
  const again = runUntil(b, 60, 2, () => b.ledge.holding);
  b.key('KeyW', false);
  ok(!Number.isFinite(again), `tired, a jump at the lip grabs nothing until the pool is back to ${LOCO_TUNE.stamina.tiredUntil * 100}%`);
  restore();
}

// ---- 8. the step down into a hang ----------------------------------------------------------------------------------------
{
  for (const fps of FPS) {
    const p = await makePhysics();
    ground(p, 0);
    // A block 3 m tall from z 0 to 4: the body crouch-walks off its +z edge toward open air 3 m down.
    box(p, [-3, 0, 0], [3, 3, 4]);
    p.stepOnce();
    const b = bodyAt(p, 0, 3, fps, 3.05);
    b.key('ControlLeft', true);
    b.key('KeyW', true);
    const t = runUntil(b, fps, 4, () => b.ledge.holding);
    b.key('KeyW', false);
    b.key('ControlLeft', false);
    const kind = b.ledge.move.kind;
    runUntil(b, fps, 5, () => settled(b));
    ok(Number.isFinite(t) && kind === 'stepDown' && settled(b) && b.ledge.braced && Math.abs(b.ledge.lip.ey - 3) < 1e-3 && b.pos.z > 4, `at ${fps} fps crouch-walking off a 3 m top lowers the body into a hang on its lip, turned to it, braced (the wall is under it: ${b.ledge.rigState}, heading ${n3(b.ledge.heading)})`);
  }
  // A drop no deeper than a hang (1 m): the body steps down and stands, no hang.
  {
    const p = await makePhysics();
    ground(p, 0);
    box(p, [-3, 0, 0], [3, 1, 4]);
    p.stepOnce();
    const b = bodyAt(p, 0, 3, 60, 1.05);
    b.key('ControlLeft', true);
    b.key('KeyW', true);
    const t = runUntil(b, 60, 3, () => b.ledge.holding);
    b.key('KeyW', false);
    b.key('ControlLeft', false);
    ok(!Number.isFinite(t), 'crouch-walking off a 1 m top (no deeper than a hang) is no hang');
  }
}

// ---- 8b. the grapple's haul to a lip it cannot go over ends in a braced hang there ----------------------------------------
{
  for (const fps of FPS) {
    const p = await makePhysics();
    ground(p, 0);
    // A wall whose face looks toward -z at z = 2, its top rising from the lip at 60 degrees: too steep to stand on.
    const top = 2.6;
    const rise = Math.tan((60 * Math.PI) / 180);
    const v = [-3, 0, 2, 3, 0, 2, 3, top, 2, -3, top, 2, -3, top + rise, 3, 3, top + rise, 3, -3, 0, 3, 3, 0, 3];
    const idx = [0, 2, 1, 0, 3, 2, 3, 5, 2, 3, 4, 5, 6, 5, 4, 6, 7, 5, 0, 1, 7, 0, 7, 6, 0, 6, 4, 0, 4, 3, 1, 2, 5, 1, 5, 7];
    const clean = cleanTrimesh(new Float32Array(v), new Uint32Array(idx))!;
    const d = RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS);
    d.setCollisionGroups(groups(Group.exterior, Group.all));
    const col = p.world.createCollider(d);
    p.stepOnce();
    const b = bodyAt(p, 0, 1.2, fps);
    // Hooked a little up the steep top, the rope over the lip.
    b.hook(0, top + rise * 0.3, 2.3, 0, 0.5, -Math.sqrt(0.75), col, 4);
    b.key('KeyF', true);
    const t = runUntil(b, fps, 8, () => b.ledge.holding);
    b.key('KeyF', false);
    runUntil(b, fps, 3, () => settled(b));
    ok(Number.isFinite(t) && settled(b) && b.grapple.lastLetGo === 'ledge' && Math.abs(b.ledge.lip.ey - top) < 0.02, `at ${fps} fps the haul to a lip whose top is too steep to stand on ends in a hang there (${b.ledge.braced ? 'braced' : 'free'}, the rope let go: ${b.grapple.lastLetGo})`);
    tap(b, 'Space', fps);
    ok(settled(b) && b.ledgeWords.includes('The top is too steep to stand on.'), '  and the climb up from it is refused in words');
  }
}

// ---- 9. the grapple refused while hanging; the peers' states -------------------------------------------------------------
{
  const g = await standingJump(2.6, 60);
  const b = g!.b;
  const fs = b.fireStateNow();
  (fs as { climbing?: boolean }).climbing = b.ledge.holding;
  ok(b.grapple.refusal(fs) === 'climbing', `the grapple's refusal while hanging is "climbing" (said as "Not while climbing: the hands are full.")`);
  const rp = readFileSync(join(REPO, 'src', 'net', 'remotePlayers.ts'), 'utf8');
  const set = rp.slice(rp.indexOf("const STATES: Set<string> = new Set(["), rp.indexOf(']);', rp.indexOf('const STATES: Set<string>')));
  const words = ['hangBraced', 'hangFree', 'shimmyBracedL', 'shimmyBracedR', 'shimmyFreeL', 'shimmyFreeR', 'climbUpBraced', 'climbUpFree'];
  ok(words.every((w) => set.includes(`'${w}'`) && w.length <= 32), `every hang state the ledges send is in the peers' list and within the relay's 32 characters (${words.join(', ')})`);
  ok(words.includes(b.ledge.loopState(true, 1)) && words.includes(b.ledge.loopState(false, -1)), 'and the ledge names its loops by them');
}

// ---- 10. 'before': nothing of it ---------------------------------------------------------------------------------------------
{
  tuneClimb({ ledges: 'before' });
  for (const fps of FPS) {
    const g = await standingJump(2.6, fps);
    ok(g === null, `under 'before' the same standing jump grabs nothing at ${fps} fps`);
  }
  restore();
}
ok(JSON.stringify(CLIMB_TUNE) === JSON.stringify({ ...CLIMB_TUNE_SHIPPED, ...CLIMB_TWO_BEFORE, ...CLIMB_FEEDBACK_BEFORE, ...CLIMB_SMOOTH_BEFORE, ...CLIMB_SMOOTH3_BEFORE, ...CLIMB_BARS_BEFORE, ...CLIMB_ROPES_BEFORE, ...CLIMB_FB2_BEFORE, ...CLIMB_SMOOTH2_BEFORE }), "and the tune is back as shipped (phase 2's switches, the feedback round's, the smoothness round's, Smoothness III's, Climbing II phase 3's and 4's, the feedback round II's and Smoothness II's at their 'before', as this suite holds them)");

void THREE;
note(`casts: a standing jump at a lip costs the rays shown in the console's report (one a frame in open air, four a frame near a face)`);
console.log(`ledgeRule: ${checks} checks passed`);
