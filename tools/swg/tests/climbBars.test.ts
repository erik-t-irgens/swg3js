// Climbing II, phase 3 (maker A): bars, under `climb.bars` 'on' (src/player/barShape.ts, src/player/barSwing.ts, the bar's clip
// src/anim/barClips.ts and its hand-over src/player/hangClips.ts's `driveBarClips`), through the game's own movement and
// climbing on the real Rapier (the grapple's harness, tools/swg/tests/grappleBody.ts, and the course's bars stood by
// tools/swg/tests/climbCourseBody.ts) at 30, 60, 144 and 240 frames a second, and the game's own rig posed by the hand-over
// (tools/swg/tests/climbFigure.ts):
//  - the clip: `run_and_swing` imported as a one-off with nothing under its feet, and measured on the human male the owner's
//    frames hold (the hands on the bar from frame 25 to 51, released at 52), the swing one swing forward, and the table measured
//    off the game's own rig at its first use agreeing with the facts the body hangs by;
//  - what a bar is: long, level and thin, by its collider's own shape (a box, a cylinder, a capsule, a mesh), turned or not;
//    what is not (the free beams, a short rod, a pole, a rail on a slant);
//  - a bar is never a lip: the ledges' rays pass it to the lip behind, and under 'off' the course's bar is a lip as before; a
//    bar-shaped rod with no room under it (along a wall's top) is no bar, and the ledges take it as under 'off' (the fix round's);
//  - grabbing with E: from the ground under it, in a standing jump, falling past it, and a running jump at the course's bars
//    (the clip's reach, the run's speed carried); never without E, and never where the hanging body has no room;
//  - the swing: integrated on the physics' own steps, step for step the same at every rate from the same state; a still hang
//    held still; W pumping a still hang to the largest swing and no further, S too, nothing held dying away; A and D along the
//    bar at its speed to its ends; a swing stopped at a wall, never in it;
//  - the pose: the drawn hands on the bar and the drawn hips at the pendulum's angle every frame, the clip's time the table's
//    for that angle, played forward as the swing goes forward and backward as it comes back, a still hang held at the window's
//    straight-down frame;
//  - with `climb.bars` at 'off' nothing of it runs; and the hand-overs only the game makes, pinned as text.
//
// Run: node tools/swg/tests/climbBars.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { figure, FIGURE_CLIPS, HAVE_BODY, type Figure } from './climbFigure.ts';

const { RAPIER, FIXED_DT } = await import('../../../src/core/physics.ts');
const { TestBody, box, ground, makePhysics } = await import('./grappleBody.ts');
const { CLIMB_TUNE, CLIMB_BARS_BEFORE, climbSmooth3Before, resetClimbTune, tuneClimb } = await import('../../../src/anim/climbTune.ts');
const { BAR_CLIP, BAR_CLIP_NAMES, BAR_FACTS, BAR_IDS, BAR_TIMES, measureBarTable } = await import('../../../src/anim/barClips.ts');
const { BarAxis, barAxisOf, isBarCollider, SHAPE_CAPSULE, SHAPE_CONVEX, SHAPE_CUBOID, SHAPE_CYLINDER, SHAPE_ROUND_CONVEX, SHAPE_ROUND_CUBOID, SHAPE_ROUND_CYLINDER, SHAPE_TRIMESH } = await import('../../../src/player/barShape.ts');
const { BAR_GRAB, BAR_NONE, BAR_STEP, BAR_SWING } = await import('../../../src/player/barSwing.ts');
const { driveBarClips } = await import('../../../src/player/hangClips.ts');
const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { worldToCourse } = await import('../../../src/anim/climbCourseBuild.ts');
const { bodyAt, standPiece } = await import('./climbCourseBody.ts');
const { REPO } = await import('./oldModules.ts');
type Body = InstanceType<typeof TestBody>;
type Phys = Awaited<ReturnType<typeof makePhysics>>;
type Table = NonNullable<ReturnType<typeof measureBarTable>>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const DEG = 180 / Math.PI;
const fresh = () => {
  resetClimbTune();
};
fresh();

// ---- the clip ---------------------------------------------------------------------------------------------------------------
{
  const index = JSON.parse(readFileSync(join(REPO, 'public', 'anims', 'mixamo', 'index.json'), 'utf8')) as { clips: { id: string; frames: number; duration: number; loop: boolean; feet: unknown[]; speed: number; travelNet: number[] }[] };
  const row = index.clips.find((c) => c.id === BAR_CLIP);
  ok(!!row && row.frames === 74 && Math.abs(row.duration - 2.41667) < 1e-4 && !row.loop && row.feet.length === 0 && row.speed === 0 && Math.abs(row.travelNet[2] - 5.84) < 0.01, `the pack holds ${BAR_CLIP} as a one-off with nothing under its feet (74 frames, 2.417 s, 5.84 m: the import's report and the owner's table agree)`);
  ok(BAR_IDS.includes(BAR_CLIP) && BAR_CLIP_NAMES[BAR_CLIP] === `mx_${BAR_CLIP}`, 'the bars ask the pack for it by its rig name, made once');
  const pack = readFileSync(join(REPO, 'src', 'anim', 'mixamoPack.ts'), 'utf8');
  ok(/also: \[\.\.\.moreClips\(\), \.\.\.STAIR_IDS, \.\.\.LEDGE_IDS, \.\.\.WALL_IDS, \.\.\.BAR_IDS[,\]]/.test(pack), 'and the game\'s pack asks for it beside the ledges\' and the walls\' (`browserIo`\'s `also`)');
  ok(Math.abs(BAR_TIMES.touch - 25 / 30) < 1e-9 && Math.abs(BAR_TIMES.swingEnd - 51 / 30) < 1e-9 && Math.abs(BAR_TIMES.release - 52 / 30) < 1e-9 && Math.abs(BAR_TIMES.reach - 0.7) < 1e-9, 'the swing window is the owner\'s frames 25 to 51 at 30 a second, the reach from 21 (0.70 s), the release at 52');
}

/** The game's rig with the bar's clip, posed (the tests' figure). */
const F: Figure = figure();
const T = measureBarTable(F.rig as never);
ok(T !== null && FIGURE_CLIPS.some((c) => c.name === BAR_CLIP_NAMES[BAR_CLIP]), 'the bar\'s clip is fitted to the figure and its swing table measured off the game\'s own rig');
const table = T!;
{
  const stillR = table.rad[Math.round((table.still - table.t0) * 120)];
  const tol = HAVE_BODY ? 0.01 : 0.2;
  ok(Math.abs(table.still - BAR_FACTS.still) < tol && Math.abs(stillR - BAR_FACTS.radius) < tol && Math.abs(table.from * DEG - BAR_FACTS.from) < (HAVE_BODY ? 0.5 : 10) && Math.abs(table.to * DEG - BAR_FACTS.to) < (HAVE_BODY ? 0.5 : 10), `the table: the hips straight down at ${table.still.toFixed(3)} s, ${stillR.toFixed(3)} m under the hands, from ${(table.from * DEG).toFixed(1)} to ${(table.to * DEG).toFixed(1)} degrees (the facts the body hangs by: ${BAR_FACTS.still} s, ${BAR_FACTS.radius} m, ${BAR_FACTS.from} to ${BAR_FACTS.to})`);
  let rises = true;
  for (let i = table.w0 + 1; i <= table.w1; i++) if (table.ang[i] < table.ang[i - 1] - 0.003) rises = false;
  ok(rises, 'the clip\'s whole swing window is one swing forward (the hips\' angle never falls by more than a sixth of a degree between samples): played by the angle, forward one way and backward the other');
  // The owner's frames against the clip's own: the hands still on the bar (the grip's speed, the window's own drift added back,
  // under 1 m/s) from the touch to the window's end, moving at the reach before it and the release after it.
  const times = new Float64Array(Math.round(2.4 * 30) + 1);
  for (let i = 0; i < times.length; i++) times[i] = i / 30;
  const joints = ['', 'lWrist', 'lIndex01', 'rWrist', 'rIndex01'];
  const S = new Float64Array(times.length * joints.length * 3);
  ok(F.rig.sampleJoints(BAR_CLIP_NAMES[BAR_CLIP], joints, times, S), 'the rig samples the clip\'s joints at any time from its own tracks');
  const grip = (i: number, k: number) => (S[(i * 5 + 1) * 3 + k] + S[(i * 5 + 2) * 3 + k] + S[(i * 5 + 3) * 3 + k] + S[(i * 5 + 4) * 3 + k]) / 4;
  const rate = (grip(51, 2) - grip(25, 2)) / (26 / 30);
  const speed = (i: number) => Math.hypot(grip(i, 0) - grip(i - 1, 0), grip(i, 1) - grip(i - 1, 1), grip(i, 2) - grip(i - 1, 2) - rate / 30) * 30;
  let first = -1;
  let last = -1;
  for (let i = 1; i < times.length; i++) {
    if (speed(i) < 1) {
      if (first < 0 && i > 15) first = i - 1;
      if (first >= 0 && last < 0 && i > first) last = i;
    } else if (first >= 0 && last >= 0 && i > first + 5) break;
  }
  let end = first;
  while (end + 1 < times.length && speed(end + 1) < 1) end++;
  const said = `the hands come to rest at frame ${first} and leave at frame ${end + 1} (the owner's 25 and 52)`;
  if (HAVE_BODY) ok(Math.abs(first - 25) <= 2 && Math.abs(end + 1 - 52) <= 2, `measured on the human male, ${said}: within two frames`);
  else note(`no converted human male: ${said} on the tests' own skeleton`);
}

// ---- what a bar is ------------------------------------------------------------------------------------------------------------
{
  ok(BAR_STEP === FIXED_DT, `the swing's step is the physics' own (${BAR_STEP})`);
  const ST = RAPIER.ShapeType as unknown as Record<string, number>;
  ok(SHAPE_CUBOID === ST.Cuboid && SHAPE_CAPSULE === ST.Capsule && SHAPE_TRIMESH === ST.TriMesh && SHAPE_CONVEX === ST.ConvexPolyhedron && SHAPE_CYLINDER === ST.Cylinder && SHAPE_ROUND_CUBOID === ST.RoundCuboid && SHAPE_ROUND_CYLINDER === ST.RoundCylinder && SHAPE_ROUND_CONVEX === ST.RoundConvexPolyhedron, 'the shape types read are the engine\'s own');
  const p = await makePhysics();
  const w = p.world;
  const q = (deg: number, ax: [number, number, number]) => {
    const h = (deg * Math.PI) / 360;
    return { x: ax[0] * Math.sin(h), y: ax[1] * Math.sin(h), z: ax[2] * Math.sin(h), w: Math.cos(h) };
  };
  const A = new BarAxis();
  const cases: [string, RAPIER.Collider, boolean, number][] = [
    ['a box 4 m by 0.07', w.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, 3, 0)), true, 4],
    ['the same turned 30 degrees about up', w.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, 3, 10).setRotation(q(30, [0, 1, 0]))), true, 4],
    ['a cylinder 3 m by 0.06, lying', w.createCollider(RAPIER.ColliderDesc.cylinder(1.5, 0.03).setTranslation(0, 3, 20).setRotation(q(90, [0, 0, 1]))), true, 3],
    ['a capsule 2 m by 0.08, lying', w.createCollider(RAPIER.ColliderDesc.capsule(0.96, 0.04).setTranslation(0, 3, 30).setRotation(q(90, [1, 0, 0]))), true, 2],
    ['a mesh rod 3 m by 0.07 (a placed row\'s model)', box(p, [-1.5, 2.965, 39.965], [1.5, 3.035, 40.035]), true, 3],
    ['a free beam 0.2 by 0.3', w.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.1, 0.15).setTranslation(0, 3, 50)), false, 0],
    ['a rod 0.5 m long', w.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 0.035, 0.035).setTranslation(0, 3, 60)), false, 0],
    ['a pole standing', w.createCollider(RAPIER.ColliderDesc.cuboid(0.04, 3, 0.04).setTranslation(0, 3, 70)), false, 0],
    ['a rail on a 20 degree slant', w.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, 3, 80).setRotation(q(20, [0, 0, 1]))), false, 0],
  ];
  for (const [what, c, is, len] of cases) {
    const got = barAxisOf(c as never, A);
    ok(got === is && (!is || (Math.abs(A.len - len) < 1e-4 && Math.abs(A.uy) < 1e-6 && A.thick <= CLIMB_TUNE.barThin)), `${what}: ${is ? `a bar, ${A.len.toFixed(2)} m along (${A.ux.toFixed(3)}, ${A.uz.toFixed(3)})` : 'no bar'}`);
  }
  const turned = cases[1][1];
  barAxisOf(turned as never, A);
  ok(Math.abs(A.ux - Math.cos(Math.PI / 6)) < 1e-6 && Math.abs(A.uz + Math.sin(Math.PI / 6)) < 1e-6 && Math.abs(A.ax + A.ux * 2) < 1e-6 && Math.abs(A.az - 10 + A.uz * 2) < 1e-6, 'a turned bar\'s axis is turned with it, from one end to the other through its middle');
  tuneClimb({ barThin: 0.05 });
  ok(!isBarCollider(cases[0][1] as never), 'the cross-section is the slider\'s: at barThin 0.05 the 0.07 box is no bar');
  fresh();
  const course = climbCourse({ extras: true });
  const shapes = course.pieces.flatMap((pc) => pc.solids.filter((s) => s.kind === 'box' && s.role === 'bar').map((s) => ({ id: pc.id, s })));
  ok(shapes.length >= 14, `the course has its bars (${shapes.length}: bars-2 to bars-5, the free run's, the tower's)`);
}

// ---- a bar is never a lip -----------------------------------------------------------------------------------------------------
{
  // A wall whose lip stands 2.25 m up, and a bar 0.4 m out in front of its face 1.95 m up: both in the ledges' band, from a body 0.7 m out.
  const p = await makePhysics();
  ground(p, 0);
  box(p, [-3, 0, 1], [3, 2.25, 2]);
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, 1.95, 0.6));
  p.stepOnce();
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(0, 0, 0.3);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.run(60, 0.3);
  const li = (b as unknown as { fillLedgeIn(dt: number, m: null, g: boolean): InstanceType<typeof import('../../../src/player/ledge.ts').LedgeIn> }).fillLedgeIn(1 / 60, null, false);
  const found = () => (b.ledge as unknown as { found: { ey: number } }).found.ey;
  const on = b.ledge.canGrab(p.world as never, b, li) ? found() : Number.NaN;
  tuneClimb({ bars: 'off' });
  const off = b.ledge.canGrab(p.world as never, b, li) ? found() : Number.NaN;
  fresh();
  ok(Math.abs(on - 2.25) < 0.02 && Math.abs(off - 1.985) < 0.02, `the ledges' band passes a bar to the lip behind it (found the lip at ${on.toFixed(3)} m, the wall's own), and under 'off' takes the bar's top for a lip as before (${off.toFixed(3)} m)`);
}
{
  // The fix round's: a rod along a wall's top (bar-shaped, but with no room under it for a hanging body: the wall is there) is no
  // bar. A standing jump at the wall with E held grabs the same lip under 'on' as under 'off', and nothing is said about a bar.
  const rows: string[] = [];
  let same = true;
  for (const rodZ of [0.55, 0.7]) {
    for (const fps of RATES) {
      const got: string[] = [];
      for (const mode of ['on', 'off'] as const) {
        tuneClimb({ bars: mode });
        const p = await makePhysics();
        ground(p, 0);
        box(p, [-3, 0, 0.5], [3, 2.3, 2.5]);
        p.world.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.03, 0.03).setTranslation(0, 2.33, rodZ));
        p.stepOnce();
        const b = bodyIn(p, 0, 0, 0.05, fps);
        b.key('KeyE', true);
        b.key('Space', true);
        b.frame(1 / fps);
        b.key('Space', false);
        for (let t = 0; !b.ledge.holding && !b.bar.holding && t < 1.5; t += 1 / fps) b.frame(1 / fps);
        b.key('KeyE', false);
        const words = b.ledgeWords.filter((w) => /bar/.test(w)).length;
        got.push(b.ledge.holding && !b.bar.holding && words === 0 ? `${b.ledge.lip.ey.toFixed(3)},${b.ledge.lip.ez.toFixed(3)}` : `ledge ${b.ledge.holding} bar ${b.bar.holding} words ${words}`);
        fresh();
      }
      same &&= got[0] === got[1] && !got[0].startsWith('ledge');
      if (fps === 60 || got[0] !== got[1]) rows.push(`rod at z ${rodZ}, ${fps} fps: on ${got[0]}, off ${got[1]}`);
    }
  }
  ok(same, `a rod along a wall's top, with no room under it, is no bar: the ledges grab the same lip under 'on' as under 'off' and no word is said of a bar, at every rate (${rows.join('; ')})`);
}
{
  // The course's bars: a running jump with E held, under 'off' the ledges catch the first bar free (as phase 2 measured it).
  tuneClimb({ bars: 'off' });
  const s = await standPiece(climbCourse({ pieces: ['bars-2'] }).pieces[0]);
  const { b } = bodyAt(s, 'run', 60);
  runJump(s, b, 60);
  ok(b.ledge.holding && !b.bar.holding && b.bar.casts === 0, `under 'off' the ledges catch bars-2's first bar as before (${b.ledge.braced ? 'braced' : 'free'}, the lip at ${b.ledge.lip.ey.toFixed(3)} m) and the bar asks nothing`);
  fresh();
}

/** A running jump at a course piece's first bar: W and E held from its run start, Space as the body nears the take-off edge. */
function runJump(s: Awaited<ReturnType<typeof standPiece>>, b: Body, fps: number): number {
  const dt = 1 / fps;
  b.key('KeyW', true);
  b.key('KeyE', true);
  let jumped = false;
  let t = 0;
  for (let i = 0; i < 4 * fps; i++) {
    const c = worldToCourse(s.frame, s.piece, b.pos.x, b.pos.y, b.pos.z, { x: 0, y: 0, z: 0 });
    if (!jumped && c.z >= 4.2) {
      b.key('Space', true);
      jumped = true;
    } else b.key('Space', false);
    b.frame(dt);
    t += dt;
    if (b.bar.holding || b.ledge.holding) break;
  }
  b.key('KeyW', false);
  b.key('KeyE', false);
  b.key('Space', false);
  return t;
}

// ---- grabbing -----------------------------------------------------------------------------------------------------------------
/** A world with a bar `y` m over open ground across x at z 0 (and `more` boxes). */
async function barWorld(y: number, more?: (p: Phys) => void): Promise<Phys> {
  const p = await makePhysics();
  ground(p, 0);
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, y, 0));
  more?.(p);
  p.stepOnce();
  return p;
}
function bodyIn(p: Phys, x: number, y: number, z: number, fps: number, settle = 0.5): Body {
  (p as unknown as { acc: number }).acc = 0;
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(x, y, z);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.heading = 0;
  if (settle > 0) b.run(fps, settle);
  return b;
}
{
  const fromGround: string[] = [];
  const jump: string[] = [];
  const fall: string[] = [];
  const none: string[] = [];
  const roomless: string[] = [];
  let groundOk = true;
  let jumpOk = true;
  let fallOk = true;
  let noneOk = true;
  let roomOk = true;
  for (const fps of RATES) {
    const dt = 1 / fps;
    // From the ground under a bar 2.2 m up (within a standing reach): E pressed, the bar taken that frame.
    {
      const p = await barWorld(2.2);
      const b = bodyIn(p, 0, 0, 0, fps);
      b.key('KeyE', true);
      b.frame(dt);
      b.key('KeyE', false);
      const took = b.bar.holding;
      for (let i = 0; i < Math.round(0.6 * fps); i++) b.frame(dt);
      groundOk &&= took && b.bar.phase === BAR_SWING && Math.abs(b.pos.y + 0.8 + BAR_FACTS.radius - 2.2) < 1e-6;
      fromGround.push(`${fps}: ${took ? 'grabbed' : 'not'}, feet ${b.pos.y.toFixed(3)} m`);
    }
    // A standing jump at a bar 2.9 m up (past a standing reach) with E held: taken in the jump's flight.
    {
      const p = await barWorld(2.9);
      const b = bodyIn(p, 0, 0, 0, fps);
      b.key('KeyE', true);
      b.key('Space', true);
      b.frame(dt);
      b.key('Space', false);
      let t = dt;
      while (!b.bar.holding && t < 1.5) {
        b.frame(dt);
        t += dt;
      }
      b.key('KeyE', false);
      jumpOk &&= b.bar.holding;
      jump.push(`${fps}: ${b.bar.holding ? `grabbed at ${t.toFixed(3)} s` : 'not'}`);
    }
    // Falling past a bar 2.2 m up from 3.2 m over the ground, 0.6 m beside it (the capsule clear of it: 0.45 m beside it, the slope rule's fan takes the bar's top for ground and the body stands in the air beside it, the movement's own), E held: taken on the way down.
    {
      const p = await barWorld(2.2);
      const b = bodyIn(p, 0, 3.2, 0.6, fps, 0);
      b.key('KeyE', true);
      let t = 0;
      let lowest = b.pos.y;
      while (!b.bar.holding && t < 1.5) {
        b.frame(dt);
        t += dt;
        lowest = Math.min(lowest, b.pos.y);
      }
      b.key('KeyE', false);
      fallOk &&= b.bar.holding && lowest > 0.2;
      fall.push(`${fps}: ${b.bar.holding ? `grabbed at ${t.toFixed(3)} s, the feet no lower than ${lowest.toFixed(2)} m` : 'not'}`);
    }
    // No E: the same fall lands, the same jump comes down, nothing grabbed.
    {
      const p = await barWorld(2.2);
      const b = bodyIn(p, 0, 3.2, 0.6, fps, 0);
      for (let i = 0; i < Math.round(1.2 * fps); i++) b.frame(dt);
      const p2 = await barWorld(2.9);
      const b2 = bodyIn(p2, 0, 0, 0, fps);
      b2.key('Space', true);
      b2.frame(dt);
      b2.key('Space', false);
      let held = false;
      for (let i = 0; i < Math.round(1.5 * fps); i++) {
        b2.frame(dt);
        held ||= b2.bar.holding;
      }
      noneOk &&= !b.bar.holding && b.grounded && !held && b.bar.casts === 0;
      none.push(`${fps}: ${b.bar.holding || held ? 'grabbed' : 'landed'}`);
    }
    // A bar 1.6 m up: the hanging body would stand in the ground, so E takes nothing, said once.
    {
      const p = await barWorld(1.6);
      const b = bodyIn(p, 0, 0, 0, fps);
      b.key('KeyE', true);
      for (let i = 0; i < Math.round(0.5 * fps); i++) b.frame(dt);
      b.key('KeyE', false);
      const said = b.ledgeWords.filter((w) => /No room to hang from the bar/.test(w)).length;
      roomOk &&= !b.bar.holding && said === 1;
      roomless.push(`${fps}: ${b.bar.holding ? 'grabbed' : 'not'}, said ${said}`);
    }
  }
  ok(groundOk, `E under a bar 2.2 m up takes it the frame it is pressed and the body hangs straight down from it, the clip's radius under it (${fromGround.join('; ')})`);
  ok(jumpOk, `a standing jump at a bar 2.9 m up with E held takes it in the flight (${jump.join('; ')})`);
  ok(fallOk, `falling past a bar with E held takes it on the way down (${fall.join('; ')})`);
  ok(noneOk, `with no E, nothing is grabbed and the bar asks nothing (${none.join('; ')})`);
  ok(roomOk, `under a bar with no room for the hanging body E takes nothing and says so once (${roomless.join('; ')})`);
}
{
  // The course's bars: a running jump with E held plays the clip's reach and carries the run's speed into the swing.
  const got: string[] = [];
  let all = true;
  for (const id of ['bars-2', 'bars-3', 'bars-4', 'bars-5']) {
    for (const fps of RATES) {
      const s = await standPiece(climbCourse({ pieces: [id] }).pieces[0]);
      const { b } = bodyAt(s, 'run', fps);
      const t = runJump(s, b, fps);
      const r = b.bar.report() as { phase: string; amplitude: number };
      const okHere = b.bar.holding && !b.ledge.holding && r.phase === 'reach' && r.amplitude > 40 && b.bar.om > 0;
      all &&= okHere;
      if (fps === 30 || fps === 240) got.push(`${id}@${fps}: ${r.phase} at ${t.toFixed(3)} s, ${r.amplitude.toFixed(1)} degrees`);
    }
  }
  ok(all, `a running jump at each of the course's bars with E held takes the first bar with the clip's reach, the run's speed carried into a swing forward of more than 40 degrees, at every rate (${got.join('; ')})`);
}

// ---- the swing ----------------------------------------------------------------------------------------------------------------
/** A still hang under a bar 2.2 m up (in a standing reach), taken at half a second (E pressed then, the body straight under it). */
async function stillHang(fps: number): Promise<Body> {
  const p = await barWorld(2.2);
  const b = bodyIn(p, 0, 0, 0, fps, 0);
  b.run(fps, 0.5);
  b.key('KeyE', true);
  b.frame(1 / fps);
  b.key('KeyE', false);
  return b;
}
{
  let still = true;
  const said: string[] = [];
  for (const fps of RATES) {
    const b = await stillHang(fps);
    // (Past the grab's carry onto the bar, climb.barGrab.)
    b.run(fps, 0.5);
    const y0 = b.pos.y;
    let worst = 0;
    for (let i = 0; i < 5 * fps; i++) {
      b.frame(1 / fps);
      worst = Math.max(worst, Math.abs(b.bar.th), Math.abs(b.bar.om), Math.abs(b.pos.y - y0));
    }
    // (Its place the clip's radius under the bar's own line, as the engine keeps it: in single floats.)
    still &&= b.bar.holding && worst === 0 && Math.abs(y0 - (b.bar.bar.ay - BAR_FACTS.radius - 0.8)) < 1e-12 && Math.abs(b.pos.z) < 1e-9;
    said.push(`${fps}: ${worst.toExponential(1)}`);
  }
  ok(still, `a still hang straight under its bar is held still, to the bit, with nothing held, at every rate (the worst angle, speed or drop off its place over five seconds: ${said.join(', ')})`);
}
{
  // From one state, the same keys on the same steps: every rate's swing step for step the same (the state after each step, by the
  // physics' own count of steps).
  // (Every rate's frames meet at whole seconds. From a whole second the physics' remainder is put three tenths of a step in, so
  // no step's boundary falls on any rate's frame boundary and each step's keys are the same frame's keys at every rate.)
  const traces: Map<number, number[]>[] = [];
  for (const fps of RATES) {
    const b = await stillHang(fps);
    const dt = 1 / fps;
    for (let i = 0; i < fps / 2 - 1; i++) b.frame(dt);
    (b.physics as unknown as { acc: number }).acc = 0.3 * FIXED_DT;
    b.bar.th = 0.3;
    b.bar.om = 0;
    // (Counted from here: the steps taken before differ by one at a whole second at some rates, by the remainder's rounding.)
    const s0 = b.physics.steps;
    const tr = new Map<number, number[]>();
    const step = () => {
      b.frame(dt);
      tr.set(b.physics.steps - s0, [b.bar.th, b.bar.om, b.pos.x, b.pos.y, b.pos.z]);
    };
    b.key('KeyW', true);
    for (let i = 0; i < 3 * fps; i++) step();
    b.key('KeyW', false);
    b.key('KeyS', true);
    for (let i = 0; i < 2 * fps; i++) step();
    b.key('KeyS', false);
    for (let i = 0; i < 3 * fps; i++) step();
    traces.push(tr);
  }
  let worst = 0;
  let common = 0;
  for (const [k, v] of traces[1]) {
    const all = traces.map((t) => t.get(k));
    if (all.some((x) => !x)) continue;
    common++;
    for (const x of all) for (let j = 0; j < 5; j++) worst = Math.max(worst, Math.abs(x![j] - v[j]));
  }
  ok(common >= 240 && worst < 1e-9, `from one state with the keys changed on the same steps, the swing at 30, 60, 144 and 240 frames a second is step for step the same (${common} steps every rate stood at, the worst difference ${worst.toExponential(1)})`);
}
{
  const most = CLIMB_TUNE.swingMost;
  const rows: string[] = [];
  let pumps = true;
  let backPumps = true;
  let dies = true;
  let capped = true;
  const amps: number[][] = [];
  for (const fps of RATES) {
    const b = await stillHang(fps);
    const dt = 1 / fps;
    const amp = () => (b.bar.report() as { amplitude: number }).amplitude;
    // W alone from a still hang.
    b.key('KeyW', true);
    const at: number[] = [];
    let peak = 0;
    for (let i = 1; i <= 10 * fps; i++) {
      b.frame(dt);
      peak = Math.max(peak, Math.abs(b.bar.th) * DEG);
      if (i % fps === 0) at.push(amp());
    }
    b.key('KeyW', false);
    amps.push(at);
    pumps &&= at[2] > 30 && peak > most - 2;
    capped &&= peak <= most + 1;
    // Nothing held: it dies away.
    const a0 = amp();
    for (let i = 0; i < 5 * fps; i++) b.frame(dt);
    const a5 = amp();
    dies &&= a5 < a0 / 2;
    // S alone from a still hang (a fresh one).
    const c = await stillHang(fps);
    c.key('KeyS', true);
    for (let i = 0; i < 6 * fps; i++) c.frame(dt);
    c.key('KeyS', false);
    backPumps &&= (c.bar.report() as { amplitude: number }).amplitude > 40;
    rows.push(`${fps}: W ${at.map((x) => x.toFixed(0)).join('/')}, the largest ${peak.toFixed(1)}; let go ${a0.toFixed(0)} to ${a5.toFixed(0)} in 5 s`);
  }
  ok(pumps, `W held pumps a still hang up past 30 degrees in three seconds and swings it out to the largest swing (${most}) in ten (${rows.join('; ')})`);
  ok(capped, `and never more than a degree past the largest swing`);
  ok(dies, 'nothing held, the swing dies away (more than half its swing gone in five seconds)');
  ok(backPumps, 'S held pumps a still hang too (at the swing\'s backward phase)');
  let alike = 0;
  for (let k = 0; k < amps[0].length; k++) alike = Math.max(alike, ...amps.map((a) => Math.abs(a[k] - amps[1][k])));
  ok(alike < 1.5, `the pumped swing's height second by second is the same at every rate within ${alike.toFixed(2)} degrees`);
}
{
  // A and D along the bar at its speed, to its ends (the hands' half span short of each).
  let alongOk = true;
  const rows: string[] = [];
  for (const fps of RATES) {
    const b = await stillHang(fps);
    const dt = 1 / fps;
    const s0 = b.bar.s;
    b.key('KeyA', true);
    for (let i = 0; i < fps; i++) b.frame(dt);
    b.key('KeyA', false);
    const s1 = b.bar.s;
    b.key('KeyD', true);
    for (let i = 0; i < 10 * fps; i++) b.frame(dt);
    b.key('KeyD', false);
    const s2 = b.bar.s;
    b.key('KeyA', true);
    for (let i = 0; i < 10 * fps; i++) b.frame(dt);
    b.key('KeyA', false);
    const s3 = b.bar.s;
    const left = b.bar.bar.ux * 1 > 0 ? 1 : -1;
    alongOk &&= Math.abs(Math.abs(s1 - s0) - CLIMB_TUNE.barShimmy) < 0.02 && Math.abs(Math.min(s2, s3) - 0.3) < 1e-6 && Math.abs(Math.max(s2, s3) - 3.7) < 1e-6 && b.bar.holding;
    rows.push(`${fps}: ${(s1 - s0).toFixed(3)} m in a second, ends ${Math.min(s2, s3).toFixed(2)} and ${Math.max(s2, s3).toFixed(2)}`);
    void left;
  }
  ok(alongOk, `A and D move the hands along the bar at its speed (${CLIMB_TUNE.barShimmy} m/s) and stop them a half span short of each end (${rows.join('; ')})`);
}
{
  // A wall 0.9 m in front of the bar, from 1 m under it to over it: a swing forward is stopped at it, never in it.
  let wallOk = true;
  const rows: string[] = [];
  for (const fps of RATES) {
    const p = await barWorld(2.2, (q) => box(q, [-3, 1.2, 0.9], [3, 2.6, 1.5], false));
    const b = bodyIn(p, 0, 0, 0, fps, 0);
    b.run(fps, 0.5);
    b.key('KeyE', true);
    b.frame(1 / fps);
    b.key('KeyE', false);
    b.key('KeyW', true);
    let deepest = 0;
    let most = -Infinity;
    for (let i = 0; i < 8 * fps; i++) {
      b.frame(1 / fps);
      // The capsule's front, 0.35 m ahead of the body's middle, against the wall's face at z 0.9 (only where the wall stands).
      const mid = b.pos.y + 0.8;
      if (mid + 0.8 > 1.2 && mid - 0.8 < 2.6) deepest = Math.max(deepest, b.pos.z + 0.35 - 0.9);
      most = Math.max(most, b.bar.th * DEG);
    }
    b.key('KeyW', false);
    wallOk &&= deepest <= 1e-6 && b.bar.holding;
    rows.push(`${fps}: the front ${(-deepest * 100).toFixed(1)} cm short of the face at the most, the swing no further than ${most.toFixed(1)} degrees`);
  }
  ok(wallOk, `a swing into a wall is stopped at it, the body's capsule never in it (${rows.join('; ')})`);
}

// ---- the pose -----------------------------------------------------------------------------------------------------------------
const X = new THREE.Vector3(1, 0, 0);
const V = new THREE.Vector3();
const G = new THREE.Vector3();
/** The game's bar frame on the figure after the body's (the player's `animateBar` and `placeVisual`'s `applyBarRoot`). */
function drawBar(b: Body, Fg: Figure, dt: number, tab: Table | null): void {
  const B = b.bar;
  B.placeFigure(tab, Fg.root.scale.y, b.pos);
  driveBarClips(Fg.rig as never, B as never, dt, Fg.hang);
  Fg.group.position.set(b.pos.x, b.pos.y, b.pos.z);
  Fg.group.rotation.set(0, B.heading, 0);
  const c = Math.cos(B.heading);
  const s = Math.sin(B.heading);
  Fg.root.position.set(B.offX * c - B.offZ * s, B.offY, B.offX * s + B.offZ * c);
  Fg.root.quaternion.setFromAxisAngle(X, B.tilt);
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
{
  // (The swing window's own pose: the feedback round II's free hang, which a still hang and a swing let alone come to under its
  // `climb.barHang` 'free', has its own suite, climbFb2Bars.test.ts; here the swing's clip is what is drawn whatever the swing.)
  tuneClimb({ barHang: 'swing' });
  const rows: string[] = [];
  let poseOk = true;
  let dirOk = true;
  let stillOk = true;
  for (const fps of RATES) {
    const Fg = figure();
    const tab = measureBarTable(Fg.rig as never);
    const b = await stillHang(fps);
    const dt = 1 / fps;
    drawBar(b, Fg, dt, tab);
    // Held still for a second: the window's straight-down frame.
    let stillT = 0;
    for (let i = 0; i < fps; i++) {
      b.frame(dt);
      drawBar(b, Fg, dt, tab);
      stillT = Math.max(stillT, Math.abs(Fg.rig.overrideAt() - tab!.still));
    }
    stillOk &&= stillT < 0.01;
    // Pumped with W for eight seconds, then let alone for four.
    b.key('KeyW', true);
    let gripWorst = 0;
    let angWorst = 0;
    let seekWorst = 0;
    let fwd = 0;
    let fwdUp = 0;
    let back = 0;
    let backDown = 0;
    let lastT = Fg.rig.overrideAt();
    for (let i = 0; i < 12 * fps; i++) {
      if (i === 8 * fps) b.key('KeyW', false);
      b.frame(dt);
      drawBar(b, Fg, dt, tab);
      const B = b.bar;
      const gx = B.bar.ax + B.bar.ux * B.s;
      const gy = B.bar.ay + B.bar.uy * B.s;
      const gz = B.bar.az + B.bar.uz * B.s;
      const g = gripOf(Fg);
      gripWorst = Math.max(gripWorst, Math.hypot(g.x - gx, g.y - gy, g.z - gz));
      const h = hips(Fg);
      const ang = Math.atan2((h.x - gx) * B.fx + (h.z - gz) * B.fz, gy - h.y);
      angWorst = Math.max(angWorst, Math.abs(ang - B.thDraw));
      const t = Fg.rig.overrideAt();
      seekWorst = Math.max(seekWorst, Math.abs(t - B.poseT));
      // Inside the window (not held at an end), the clip's time moves with the swing's way.
      const inside = B.thDraw > tab!.from + 0.02 && B.thDraw < tab!.to - 0.02;
      if (inside && Math.abs(B.om) > 0.3) {
        if (B.om > 0) {
          fwd++;
          if (t > lastT) fwdUp++;
        } else {
          back++;
          if (t < lastT) backDown++;
        }
      }
      lastT = t;
    }
    b.key('KeyW', false);
    poseOk &&= gripWorst < 0.01 && angWorst < 0.002 && seekWorst < 1e-9;
    dirOk &&= fwd > 0 && back > 0 && fwdUp / fwd > 0.97 && backDown / back > 0.97;
    rows.push(`${fps}: hands ${(gripWorst * 1000).toFixed(1)} mm off the bar, hips ${(angWorst * DEG).toFixed(3)} degrees off the swing's angle; forward ${fwdUp}/${fwd} frames on, back ${backDown}/${back} back`);
  }
  ok(stillOk, 'a still hang holds the clip at the window\'s straight-down frame (`climb.barHang` at \'swing\')');
  ok(poseOk, `swinging, every frame the drawn hands are on the bar within a centimetre and the drawn hips stand at the pendulum's own angle (the clip's time the swing asks put on the rig) (${rows.join('; ')})`);
  ok(dirOk, 'the clip plays forward while the swing goes forward and backward while it comes back');
  fresh();
}

// ---- 'off', the switch's other setting, and the hand-overs -------------------------------------------------------------------
{
  climbSmooth3Before();
  const offAll = CLIMB_TUNE.bars === CLIMB_BARS_BEFORE.bars && CLIMB_BARS_BEFORE.bars === 'off';
  fresh();
  ok(offAll && CLIMB_TUNE.bars === 'on', 'Smoothness III\'s put back (and so every older round\'s chain) puts the bars to \'off\'; the game ships them \'on\'');
  tuneClimb({ bars: 'off' });
  const b = await stillHang(60);
  ok(!b.bar.holding && b.bar.casts === 0 && b.bar.phase === BAR_NONE, 'under \'off\' E under a bar takes nothing and the bar asks the engine nothing');
  fresh();
}
{
  const text = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
  const player = text('src/player/player.ts');
  const harness = text('tools/swg/tests/grappleBody.ts');
  const tune = text('src/anim/climbTune.ts');
  const clips = text('src/player/hangClips.ts');
  ok(player.indexOf('if (this.bar.holding) {\n      this.barFrame(dt, input, cam, world);\n      return;\n    }') >= 0 && player.indexOf('if (this.bar.holding) {\n      this.barFrame(dt, input, cam, world);') < player.indexOf('if (this.ledge.holding) {\n      this.hangFrame(dt, input, cam, world);'), 'the player: on a bar, the swing\'s frame in place of the movement, before the ledge\'s');
  ok(player.indexOf('if (this.senseBar(dt, input, move, wasGrounded, atControls)) {') >= 0 && player.indexOf('if (this.senseBar(') < player.indexOf('if (this.senseLedge(dt, input, move, wasGrounded, atControls)) {'), 'and the bar\'s grab after the move, before the ledges\'');
  ok(/return this\.ledge\.holding \|\| this\.wall\.holding \|\| this\.bar\.holding( \|\| this\.rope\.holding)?;/.test(player) && /this\.reachBar = this\.bar\.canGrab\(this\.physics\.world as unknown as BarWorld, this, li\);\n    return this\.reachBar \|\| this\.ledge\.canGrab\(w, this, li\) \|\| this\.wall\.canClimb\(w, this, li\)( \|\| this\.ropeReach\(li\))?;/.test(player), 'a bar held mutes the fight\'s keys and refuses the hook as a hang does, and a bar in reach is the use key\'s climb');
  ok(/B\.steps = this\.barStepsOnce >= 0 \? this\.barStepsOnce : this\.physics\.stepsAhead\(dt\);\r?\n    this\.barStepsOnce = -1;\r?\n    B\.behind = this\.physics\.behind;\r?\n    B\.step\(this\.physics\.world as unknown as BarWorld, this, li\);/.test(player) && /B\.steps = this\.barStepsOnce >= 0 \? this\.barStepsOnce : this\.physics\.stepsAhead\(dt\);\r?\n    this\.barStepsOnce = -1;\r?\n    B\.behind = this\.physics\.behind;\n    B\.step\(this\.physics\.world as unknown as BarWorld, this, this\.fillLedgeIn\(dt, null, false\)\);/.test(harness), 'the player and the harness both hand the swing the physics\' coming steps and remainder before it steps');
  ok(/this\.bar\.placeFigure\(this\.barTableRig === rig \? this\.barTable : null, rig\.root\.scale\.y, this\.pos\);\n    driveBarClips\(rig, this\.bar, dt, this\.hangClips\);/.test(player) && /const T = measureBarTable\(rig\);/.test(player), 'the player measures the clip off its own rig once, places the figure, then hands the rig the clip (as the tests\' figure does)');
  ok(/rig\.root\.position\.x = B\.offX \* c - B\.offZ \* s;\n    rig\.root\.position\.y \+= B\.offY;\n    rig\.root\.position\.z = B\.offX \* s \+ B\.offZ \* c;\n    rig\.root\.quaternion\.setFromAxisAngle\(AXIS_X, B\.tilt\);/.test(player), 'and draws the figure where the swing says (`applyBarRoot`), as the tests\' figure does');
  ok(/releaseBarClip\(this\.rig, this\.bar\);\n    this\.bar\.tick\(dt\);/.test(player) && /this\.bar\.tick\(dt\);/.test(harness), 'off the bar, a let-go\'s clip let go of and the bar\'s clocks stepped, every frame of the movement');
  ok(/this\.bar\.reset\('stood elsewhere'\);/.test(player) && /if \(this\.bar\.holding\) this\.bar\.reset\('off the feet'\);/.test(player), 'stood elsewhere or off the feet, the bar lets go');
  ok(/export function climbSmooth3Before\(\): void \{\n  \/\/ [^\n]*\n  climbBarsBefore\(\);/.test(tune), 'Smoothness III\'s put back calls phase 3\'s first');
  ok(/rig\.overrideSeekAt = B\.poseT;\n    rig\.overrideSeekNow\(B\.clipName\);/.test(clips) && !/driveBarClips[\s\S]*ledgeClipName\(/.test(clips.slice(clips.indexOf('export function driveBarClips'), clips.indexOf('export function releaseBarClip'))), 'the bar\'s clip is put at the swing\'s time through the rig\'s own field, by the name made once (no name made, no number handed across a call)');
  void BAR_GRAB;
}
console.log(`climbBars: ${checks} checks passed`);
