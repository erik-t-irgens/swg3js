// Climbing II, the smoothness round, maker A's items 1 to 3, through the game's own movement and climbing (the grapple's
// harness, tools/swg/tests/grappleBody.ts, stepping the player's order) on the real Rapier, frame by frame while moving, at
// 30, 60, 144 and 240 frames a second, on the course's own extra rows (src/anim/climbCourse.ts) stood one at a time:
//  1. shallow lips are lips (`climb.shelves` 'grab'): a jump with E, E pressed in the air and a fall past with E held each
//     grab a ladder's rung and a chimney's rung, the hands on it; under 'before' none does;
//  2. the owner's grammar while hanging (`climb.hangKeys` 'cue'): W held climbs a ladder-like ladder rung by rung (each landing's
//     hands on the rung) and onto its top, S held climbs it down; the cue shows only while its key is held and only where Space
//     would hop, and Space hops exactly to the lip it showed; a side's cue once its shimmy has stopped; with nothing shown Space
//     jumps a little off; W looking back up a chimney, Space taking each rung behind;
//  3. the crouch: a tap drops to the lip beneath, held it falls past every lip to the ground; S held shows the drop's cue (the
//     leading hand and the head) only while held;
//  and the round's review: W, S and the crouch find a lip at every depth it can be hung from with the scene at a non-round place,
//  the chimney's top found wherever the piece stands, and what a wall climbed and a shimmy ask the real engine a frame.
// The digests with every switch of the round at its other setting are `climbToday`, `climbAfter` and `climbFeedbackAfter`'s.
//
// Run: node tools/swg/tests/climbSmooth.test.ts
import assert from 'node:assert/strict';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { courseWayToWorld, courseToWorld } from '../../../src/anim/climbCourseBuild.ts';
import { resetClimbTune, tuneClimb, CLIMB_TUNE, CLIMB_SMOOTH_BEFORE, climbSmoothBefore } from '../../../src/anim/climbTune.ts';
import { LEDGE_HANG, WAYK_DROP, WAYK_HOP, WAYK_LADDER, WAYK_NONE } from '../../../src/player/ledge.ts';
import { resetMoveTune } from '../../../src/anim/moveTune.ts';
import { WALL_ON } from '../../../src/player/wallClimb.ts';
import { bodyAt, nearestLip, runUntil, standPiece, tap, type Stood } from './climbCourseBody.ts';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const RATES = [30, 60, 144, 240] as const;
const piece = (id: string) => climbCourse({ extras: true, pieces: [id] }).pieces[0];
const lipOf = (s: Stood, b: TestBody) => (b.ledge.holding ? nearestLip(s, b.ledge.lip.ex, b.ledge.lip.ey, b.ledge.lip.ez) : null);
const nameOf = (s: Stood, b: TestBody) => lipOf(s, b)?.name ?? '-';
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
/** The hands' places on the lip held (the rail's samples at their rest spacing), their worst distance off the course's lips. */
function handsOff(s: Stood, b: TestBody): number {
  const L = b.ledge;
  const R = L.rail;
  const half = 0.299 * b.ledgeScale;
  let worst = 0;
  for (const k of [-1, 1]) {
    R.q = L.barc + half * k;
    R.sample();
    worst = Math.max(worst, nearestLip(s, R.sx, R.sy, R.sz).off);
  }
  return worst;
}
/** A standing jump with E pressed on its frame and held, no move key: frames until it hangs (or 2.5 s). */
function jumpE(s: Stood, b: TestBody, fps: number): boolean {
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 2.5, () => hangs(b));
  b.key('KeyE', false);
  return hangs(b);
}
/** The view (the camera's flattened forward) turned to a way of the piece. */
function look(s: Stood, b: TestBody, dx: number, dz: number): void {
  const f = courseWayToWorld(s.frame, dx, dz, { x: 0, z: 0 });
  b.forward.set(f.x, 0, f.z);
  b.right.set(-f.z, 0, f.x);
}

ok(Object.keys(CLIMB_SMOOTH_BEFORE).join(',') === 'shelves,hangKeys,diagonals' && CLIMB_TUNE.shelves === 'grab' && CLIMB_TUNE.hangKeys === 'cue' && CLIMB_TUNE.diagonals === 'below', 'the round ships its switches on (shelves grab, hangKeys cue, and maker B\'s diagonals below), each with its other setting in CLIMB_SMOOTH_BEFORE');
climbSmoothBefore();
ok(CLIMB_TUNE.shelves === 'before' && CLIMB_TUNE.hangKeys === 'before' && CLIMB_TUNE.diagonals === 'before', 'climbSmoothBefore puts them back to the feedback round\'s climbing');
resetClimbTune();

// ---- 1. shallow lips: a jump with E, E in the air, a fall past with E held ---------------------------------------------------
for (const id of ['ladder-0.75', 'chimney-2.5'] as const) {
  const first = id === 'chimney-2.5' ? 'A0' : 'R0';
  for (const fps of RATES) {
    resetClimbTune();
    const s = await standPiece(piece(id));
    // A standing jump, E pressed on its frame.
    {
      const { b } = bodyAt(s, 'stand', fps);
      const got = jumpE(s, b, fps);
      ok(got && nameOf(s, b) === first && b.ledge.braced && handsOff(s, b) < 0.02, `${id} @${fps}: a standing jump with E grabs the first rung ${first} braced, the hands on it (${handsOff(s, b).toFixed(4)} m)`);
      b.physics.world.removeRigidBody(b.body);
    }
    // E pressed in the air, after the jump has left the ground.
    {
      const { b } = bodyAt(s, 'stand', fps);
      tap(b, 'Space', fps);
      runUntil(b, fps, 0.1, () => false);
      b.key('KeyE', true);
      runUntil(b, fps, 2.5, () => hangs(b));
      b.key('KeyE', false);
      ok(hangs(b) && nameOf(s, b) === first, `${id} @${fps}: E pressed in the air on the way up grabs ${first} (${nameOf(s, b)})`);
      b.physics.world.removeRigidBody(b.body);
    }
    // A fall past a rung with E held: dropped from 4.6 m, 0.7 m in front of the face, falling, the first rung met in the reach caught.
    {
      const { b } = bodyAt(s, 'stand', fps);
      const w = { x: 0, y: 0, z: 0 };
      const st = s.piece.starts.find((q) => q.name === 'stand')!;
      courseToWorld(s.frame, s.piece, st.at[0], 4.6, st.at[2] + 0.1, w);
      b.place(w.x, w.y, w.z);
      b.vel.set(0, -1, 0);
      b.grounded = false;
      b.key('KeyE', true);
      runUntil(b, fps, 2.5, () => hangs(b) || b.grounded);
      b.key('KeyE', false);
      const name = nameOf(s, b);
      ok(hangs(b) && name !== '-' && handsOff(s, b) < 0.02, `${id} @${fps}: a fall past with E held catches a rung (${name}), the hands on it`);
      b.physics.world.removeRigidBody(b.body);
    }
    // Under 'before' no rung is a lip: the same jump grabs nothing.
    {
      tuneClimb({ shelves: 'before' });
      const { b } = bodyAt(s, 'stand', fps);
      b.key('KeyE', true);
      tap(b, 'Space', fps);
      let grabbed = false;
      runUntil(b, fps, 1.5, () => {
        if (b.ledge.holding) grabbed = true;
        return false;
      });
      b.key('KeyE', false);
      ok(!grabbed, `${id} @${fps}: under shelves 'before' the same jump grabs no rung`);
      b.physics.world.removeRigidBody(b.body);
      resetClimbTune();
    }
  }
}

// ---- 2. a ladder-like ladder by W and S held ----------------------------------------------------------------------------------
const ladderTimes: Record<string, string> = {};
for (const id of ['ladder-0.75', 'ladder-1'] as const) {
  for (const fps of RATES) {
    resetClimbTune();
    const s = await standPiece(piece(id));
    const { b, w } = bodyAt(s, 'stand', fps);
    jumpE(s, b, fps);
    const L = b.ledge;
    ok(nameOf(s, b) === 'R0', `${id} @${fps}: hanging on R0`);
    // W held: each rung in turn, a ladder's climb each (no cue, no hop), the hands on each rung at its landing.
    const seen: string[] = [];
    const landed: number[] = [];
    let worst = 0;
    let cueSeen = 0;
    let last = 'R0';
    const t0 = b.t;
    b.key('KeyW', true);
    runUntil(b, fps, 10, () => {
      if (L.cue > cueSeen) cueSeen = L.cue;
      const n = nameOf(s, b);
      if (hangs(b) && n !== last && n !== '-') {
        seen.push(n);
        landed.push(Math.round((b.t - t0) * 100) / 100);
        worst = Math.max(worst, handsOff(s, b));
        last = n;
      }
      return !L.holding;
    });
    b.key('KeyW', false);
    ok(seen.join(' ') === 'R1 R2 R3 R4 R5' && L.ladders === 5 && L.cueHops === 0 && cueSeen === 0, `${id} @${fps}: W held climbs R1 to R5 rung by rung by the ladder's climb alone (${L.ladders} climbs, no cue, no hop): ${seen.join(' ')}`);
    ok(worst < 0.02, `${id} @${fps}: ... each landing's hands on its rung (worst ${worst.toFixed(4)} m)`);
    ok(!L.holding && L.lastLetGo === 'climbed up' && b.grounded, `${id} @${fps}: ... and W still held at the last rung climbs onto the top (${L.lastLetGo})`);
    ladderTimes[`${id}@${fps}`] = landed.join(',');
    ok(w.falls === 0, `${id} @${fps}: nothing let go on the way`);
    b.physics.world.removeRigidBody(b.body);
    // S held: down from R3 rung by rung.
    {
      const { b: c } = bodyAt(s, 'stand', fps);
      jumpE(s, c, fps);
      c.key('KeyW', true);
      runUntil(c, fps, 6, () => hangs(c) && nameOf(s, c) === 'R3');
      c.key('KeyW', false);
      const down: string[] = [];
      let at = nameOf(s, c);
      c.key('KeyS', true);
      runUntil(c, fps, 6, () => {
        const n = nameOf(s, c);
        if (hangs(c) && n !== at) {
          down.push(n);
          at = n;
        }
        return n === 'R0' && hangs(c);
      });
      c.key('KeyS', false);
      ok(down.join(' ') === 'R2 R1 R0' && c.ledge.cueKind === WAYK_NONE, `${id} @${fps}: S held climbs down R3 to R0 rung by rung, no cue (${down.join(' ')})`);
      c.physics.world.removeRigidBody(c.body);
    }
  }
  const ref = ladderTimes[`${id}@60`].split(',').map(Number);
  for (const fps of RATES) {
    const t = ladderTimes[`${id}@${fps}`].split(',').map(Number);
    ok(t.length === ref.length && t.every((v, k) => Math.abs(v - ref[k]) <= 0.05), `${id}: the rungs are reached at the same moments at ${fps} as at 60 within 0.05 s (${t.join(', ')})`);
  }
}

// ---- 2. the cue: only while held, only where Space would hop, Space hops exactly there ------------------------------------------
for (const fps of RATES) {
  resetClimbTune();
  const s = await standPiece(piece('ladder-1.25'));
  const { b } = bodyAt(s, 'stand', fps);
  jumpE(s, b, fps);
  const L = b.ledge;
  runUntil(b, fps, 0.5, () => false);
  ok(L.cue === 0 && L.cueKind === WAYK_NONE && L.poseClip === '', `ladder-1.25 @${fps}: hanging with no key held, no cue`);
  b.key('KeyW', true);
  runUntil(b, fps, 0.5, () => false);
  const shown = L.cueKind === WAYK_HOP && L.cue === 1 && L.wayKind === WAYK_HOP && L.poseClip !== '';
  const named = nearestLip(s, L.dryLip.ex, L.dryLip.ey, L.dryLip.ez).name;
  ok(shown && named === 'R1' && hangs(b) && nameOf(s, b) === 'R0', `ladder-1.25 @${fps}: W held shows the hop's cue (a pull-up, the hop up clip's coil held) toward R1, the body still on R0`);
  b.key('KeyW', false);
  runUntil(b, fps, 0.5, () => false);
  ok(L.cue === 0 && L.poseClip === '', `ladder-1.25 @${fps}: W let go, the cue eases out`);
  b.key('KeyW', true);
  runUntil(b, fps, 0.1, () => false);
  const cuedY = L.dryLip.ey;
  tap(b, 'Space', fps);
  b.key('KeyW', false);
  runUntil(b, fps, 3, () => hangs(b));
  ok(nameOf(s, b) === 'R1' && Math.abs(L.lip.ey - cuedY) < 1e-6 && L.cueHops === 1, `ladder-1.25 @${fps}: Space while it shows hops to the very lip it showed (R1)`);
  b.physics.world.removeRigidBody(b.body);
}
for (const fps of RATES) {
  resetClimbTune();
  // A lip with nothing above it: W shows nothing, and Space jumps a little off.
  const s = await standPiece(piece('shelves-2'));
  const { b } = bodyAt(s, 'stand', fps);
  jumpE(s, b, fps);
  const L = b.ledge;
  b.key('KeyA', true);
  runUntil(b, fps, 0.4, () => false);
  ok(L.cue === 0 && L.wayKind === WAYK_NONE, `shelves-2 @${fps}: A held along a lip that runs on shows no cue (the shimmy)`);
  b.key('KeyA', false);
  runUntil(b, fps, 0.3, () => false);
  tap(b, 'Space', fps);
  ok(!L.holding && L.lastLetGo === 'jumped off a little', `shelves-2 @${fps}: Space with no cue showing jumps a little off (${L.lastLetGo})`);
  b.physics.world.removeRigidBody(b.body);
  // W with the next tier 2 m up (past the hop's reach): nothing shown, and the press climbs onto the 0.6 m top.
  const { b: c } = bodyAt(s, 'stand', fps);
  jumpE(s, c, fps);
  let cue = 0;
  c.key('KeyW', true);
  runUntil(c, fps, 4, () => {
    if (c.ledge.cue > cue) cue = c.ledge.cue;
    return !c.ledge.holding;
  });
  c.key('KeyW', false);
  ok(cue === 0 && c.ledge.lastLetGo === 'climbed up' && c.grounded && Math.abs(c.pos.y - 2.6) < 0.05, `shelves-2 @${fps}: W with nothing in the way up shows no cue and climbs onto the top (${c.ledge.lastLetGo}, y ${c.pos.y.toFixed(2)})`);
  c.physics.world.removeRigidBody(c.body);
}
for (const fps of RATES) {
  resetClimbTune();
  // A side: D held along the lip toward a gap; while no lip across is in a hop's reach, nothing shows; once one is, the lean
  // (the shimmy still under way), and Space hops to the lip it showed. Out of the hop's reach (2 m), no cue the whole way.
  for (const id of ['gap-side-1.5', 'gap-side-2.0'] as const) {
    const s = await standPiece(climbCourse({ pieces: [id] }).pieces[0]);
    const { b } = bodyAt(s, 'onA', fps);
    jumpE(s, b, fps);
    const L = b.ledge;
    b.key('KeyD', true);
    let early = 0;
    let lean = 0;
    runUntil(b, fps, id === 'gap-side-2.0' ? 3 : 6, () => {
      if (L.cueKind !== 0 && L.wayKind !== WAYK_HOP) early++;
      if (L.leanNow !== 0) lean = L.leanNow;
      return L.cueKind === WAYK_HOP && L.cue === 1;
    });
    if (id === 'gap-side-2.0') {
      ok(L.cueKind === WAYK_NONE && lean === 0, `${id} @${fps}: D held along a lip with nothing across within a hop's reach shows no cue`);
      b.physics.world.removeRigidBody(b.body);
      continue;
    }
    const to = nearestLip(s, L.dryLip.ex, L.dryLip.ey, L.dryLip.ez).name;
    ok(L.cueKind === WAYK_HOP && early === 0 && to === 'B' && lean < -0.13 && lean > -0.15, `${id} @${fps}: D held toward the gap shows the hop's cue (a lean of ${((lean * 180) / Math.PI).toFixed(1)} degrees to the right) toward ${to} once it is in reach, never before`);
    tap(b, 'Space', fps);
    b.key('KeyD', false);
    runUntil(b, fps, 3, () => hangs(b));
    ok(nameOf(s, b) === 'B' && L.cueHops === 1 && L.leanNow === 0, `${id} @${fps}: Space hops to the lip it showed (${nameOf(s, b)}), the lean let go`);
    b.physics.world.removeRigidBody(b.body);
  }
}

// ---- 2. W looking back up a chimney --------------------------------------------------------------------------------------------
const chimneyPaths: string[] = [];
for (const fps of RATES) {
  resetClimbTune();
  const s = await standPiece(piece('chimney-2.5'));
  const { b } = bodyAt(s, 'stand', fps);
  jumpE(s, b, fps);
  const L = b.ledge;
  const path = [nameOf(s, b)];
  for (let k = 0; k < 7 && L.holding; k++) {
    look(s, b, 0, path[path.length - 1].startsWith('A') ? -1 : 1);
    runUntil(b, fps, 0.3, () => false);
    const cued = L.cueKind === WAYK_HOP && L.lookSide !== 0;
    b.key('KeyW', true);
    runUntil(b, fps, 0.4, () => false);
    const cuedHeld = L.cueKind === WAYK_HOP && L.lookSide !== 0;
    tap(b, 'Space', fps);
    b.key('KeyW', false);
    runUntil(b, fps, 3, () => hangs(b) || !L.holding);
    if (k === 0) ok(!cued && cuedHeld, `chimney-2.5 @${fps}: looking back, the reach back shows only once W is held (the behind cue)`);
    path.push(nameOf(s, b));
  }
  chimneyPaths.push(path.join(' '));
  ok(path.join(' ') === 'A0 B0 A1 B1 A2 B2 A3 B3', `chimney-2.5 @${fps}: W looking back and Space climb the chimney rung by rung, face to face: ${path.join(' ')}`);
  // At the top rung, W at its own wall: up to the wall's top (1 m, a ladder's reach) and onto it.
  look(s, b, 0, -1);
  b.key('KeyW', true);
  runUntil(b, fps, 6, () => !L.holding);
  b.key('KeyW', false);
  ok(!L.holding && L.lastLetGo === 'climbed up' && b.pos.y > 11.9, `chimney-2.5 @${fps}: W at the top rung climbs to the wall's top and onto it (${L.lastLetGo}, y ${b.pos.y.toFixed(2)})`);
  b.physics.world.removeRigidBody(b.body);
}

// ---- 3. the crouch, and S's drop cue ------------------------------------------------------------------------------------------
for (const fps of RATES) {
  resetClimbTune();
  const s = await standPiece(piece('ladder-1.25'));
  const { b } = bodyAt(s, 'stand', fps);
  jumpE(s, b, fps);
  const L = b.ledge;
  b.key('KeyW', true);
  runUntil(b, fps, 0.2, () => false);
  tap(b, 'Space', fps);
  b.key('KeyW', false);
  runUntil(b, fps, 3, () => hangs(b) && nameOf(s, b) === 'R1');
  ok(nameOf(s, b) === 'R1', `ladder-1.25 @${fps}: up on R1`);
  // S held: the drop's cue (a hand let go and lowered toward R0, the head down), only while held.
  b.key('KeyS', true);
  runUntil(b, fps, 0.5, () => false);
  ok(L.cueKind === WAYK_DROP && L.cue === 1 && (L.dropLead === 0 || L.dropLead === 1) && L.headShare === 1 && L.headDown > 0.5 && hangs(b), `ladder-1.25 @${fps}: S held shows the drop's cue (hand ${L.dropLead === 0 ? 'left' : 'right'}, the head ${(L.headDown * 57.3).toFixed(0)} degrees down), the body still on R1`);
  b.key('KeyS', false);
  runUntil(b, fps, 0.5, () => false);
  ok(L.cue === 0 && L.headShare === 0 && L.cueKind === WAYK_NONE, `ladder-1.25 @${fps}: S let go, the drop's cue eases out`);
  // A tap of crouch: the drop to R0, caught.
  tap(b, 'ControlLeft', fps);
  runUntil(b, fps, 3, () => hangs(b) || !L.holding);
  ok(hangs(b) && nameOf(s, b) === 'R0' && L.drops === 1, `ladder-1.25 @${fps}: a tap of crouch drops to the lip beneath (R0) and holds it`);
  // Held: lets go fully and falls past every lip to the ground.
  b.key('ControlLeft', true);
  let held = 0;
  runUntil(b, fps, 4, () => {
    if (L.holding && !hangs(b)) held++;
    return b.grounded && !L.holding;
  });
  b.key('ControlLeft', false);
  ok(!L.holding && b.grounded && b.pos.y < 0.2, `ladder-1.25 @${fps}: crouch held lets go fully and falls to the ground (${L.lastLetGo})`);
  b.physics.world.removeRigidBody(b.body);
}
for (const fps of RATES) {
  resetClimbTune();
  // Held through a drop to a lip beneath: let go fully past dropHold, the lip beneath never caught.
  const s = await standPiece(piece('ladder-1.25'));
  const { b } = bodyAt(s, 'stand', fps);
  jumpE(s, b, fps);
  const L = b.ledge;
  b.key('KeyW', true);
  runUntil(b, fps, 0.2, () => false);
  tap(b, 'Space', fps);
  b.key('KeyW', false);
  runUntil(b, fps, 3, () => hangs(b) && nameOf(s, b) === 'R1');
  b.key('ControlLeft', true);
  let caught = false;
  runUntil(b, fps, 4, () => {
    if (b.ledge.phase === LEDGE_HANG) caught = true;
    return b.grounded;
  });
  b.key('ControlLeft', false);
  ok(!caught && b.grounded && L.drops === 1 && L.lastLetGo === 'let go fully', `ladder-1.25 @${fps}: crouch held from R1 begins the drop and lets go fully past dropHold, catching no lip (its feet stand at R0's rung, which it lands on: maker B's finding)`);
  b.physics.world.removeRigidBody(b.body);
}

// ---- the round's review: the way's look at every depth, wherever the piece stands ------------------------------------------
// The way's columns in depth stood 0.2 m apart, where a column takes a lip only with its face within about 0.15 m of it: lips
// whose face stood 0.25 to 0.3 m (and 0.45 to 0.5 m) behind the held edge were never found, and at 0.3 m the world's own
// rounding decided, so the course's chimney top was found or not by where the piece stood. Each scene here stands at a
// non-round place, and every depth a lip can be hung from is found.
const OX = 3.137;
const OZ = 7.291;
const fill = (b: TestBody) => {
  b.stamina.value = 100;
  b.stamina.tired = false;
};
for (const fps of [30, 240] as const) {
  // W up: hanging on a rung `deep` out of its wall, the wall's top 0.9 m over it, a ladder's reach: W alone climbs to it and
  // onto it (from 0.55 m the rung under the top fills the hang's place there, so nothing is found: the room's own refusal).
  const ups: string[] = [];
  let upOk = true;
  for (let k = 0; k <= 7; k++) {
    const deep = 0.15 + k * 0.05;
    resetClimbTune();
    resetMoveTune();
    const p = await makePhysics();
    ground(p, 0);
    box(p, [OX - 3, 0, OZ + 1], [OX + 3, 3.4, OZ + 2.5]);
    box(p, [OX - 1.5, 2.35, OZ + 1 - deep], [OX + 1.5, 2.5, OZ + 1]);
    p.stepOnce();
    p.acc = 0;
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.place(OX, 0, OZ + 1 - deep - 0.6);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.heading = 0;
    b.run(fps, 0.3);
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2.5, () => hangs(b));
    b.key('KeyE', false);
    runUntil(b, fps, 0.5, () => false);
    const grabbed = hangs(b) && Math.abs(b.ledge.lip.ey - 2.5) < 0.02;
    b.key('KeyW', true);
    runUntil(b, fps, 0.1, () => false);
    const found = b.ledge.report().way.found;
    runUntil(b, fps, 4, () => !b.ledge.holding && b.grounded);
    b.key('KeyW', false);
    const top = !b.ledge.holding && b.grounded && Math.abs(b.pos.y - 3.4) < 0.05;
    upOk &&= grabbed && found === 'ladder' && top;
    ups.push(`${deep.toFixed(2)}:${found}:${top ? 'top' : b.pos.y.toFixed(2)}`);
    fill(b);
  }
  ok(upOk, `@${fps}: W at a rung whose wall's top stands 0.15 to 0.5 m behind its edge, every 0.05 m, the scene at (${OX}, ${OZ}): the top found as a ladder's and climbed onto (${ups.join(' ')})`);
  // S and the crouch: hanging on a rung 0.5 m deep at 4.0, a rung beneath at 2.5 whose edge stands from 0.05 m in front of the
  // held edge to 0.35 m behind it (deeper, the rung beneath is under `shelfMin` deep and no lip): S shows the drop's cue and a
  // crouch tap drops to it and holds it.
  const downs: string[] = [];
  let downOk = true;
  for (let k = 0; k <= 8; k++) {
    const back = -0.05 + k * 0.05;
    resetClimbTune();
    resetMoveTune();
    const p = await makePhysics();
    ground(p, 0);
    box(p, [OX - 3, 0, OZ + 1], [OX + 3, 6, OZ + 2.5]);
    box(p, [OX - 1.5, 3.85, OZ + 0.5], [OX + 1.5, 4.0, OZ + 1]);
    box(p, [OX - 1.5, 2.35, OZ + 0.5 + back], [OX + 1.5, 2.5, OZ + 1]);
    p.stepOnce();
    p.acc = 0;
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.place(OX, 4.4, OZ - 0.1);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.heading = 0;
    b.vel.set(0, -1, 0);
    b.grounded = false;
    b.key('KeyE', true);
    runUntil(b, fps, 2, () => hangs(b) || b.grounded);
    b.key('KeyE', false);
    runUntil(b, fps, 0.4, () => false);
    const held = hangs(b) && Math.abs(b.ledge.lip.ey - 4) < 0.02;
    b.key('KeyS', true);
    runUntil(b, fps, 0.4, () => false);
    const cued = b.ledge.cueKind === WAYK_DROP && b.ledge.cue === 1;
    b.key('KeyS', false);
    runUntil(b, fps, 0.4, () => false);
    tap(b, 'ControlLeft', fps);
    runUntil(b, fps, 3, () => (hangs(b) && Math.abs(b.ledge.lip.ey - 4) > 0.05) || (!b.ledge.holding && b.grounded));
    const caught = hangs(b) && Math.abs(b.ledge.lip.ey - 2.5) < 0.02;
    downOk &&= held && cued && caught;
    downs.push(`${back.toFixed(2)}:${cued ? 'cue' : '-'}:${caught ? 'caught' : b.ledge.holding ? b.ledge.lip.ey.toFixed(2) : 'fell'}`);
  }
  ok(downOk, `@${fps}: S at a rung with one 1.5 m beneath it whose edge stands 0.05 m in front to 0.35 m behind, every 0.05 m, the scene at (${OX}, ${OZ}): the drop's cue shown and a crouch tap catching it (${downs.join(' ')})`);
}
// The course's chimney stood where the harness stands it and moved by non-round amounts along both of its axes: W at the top
// rung finds the wall's top and climbs onto it wherever the piece stands.
{
  const tops: string[] = [];
  let topOk = true;
  for (const [sx, sz] of [[0, 0.07], [0.07, 0], [0, 7.3], [2.5, 0.13]] as const) {
    resetClimbTune();
    const s = await standPiece(piece('chimney-2.5'), sx, sz);
    const fps = 30;
    const { b } = bodyAt(s, 'stand', fps);
    jumpE(s, b, fps);
    const L = b.ledge;
    const path = [nameOf(s, b)];
    for (let k = 0; k < 7 && L.holding; k++) {
      look(s, b, 0, path[path.length - 1].startsWith('A') ? -1 : 1);
      runUntil(b, fps, 0.3, () => false);
      b.key('KeyW', true);
      runUntil(b, fps, 0.4, () => false);
      tap(b, 'Space', fps);
      b.key('KeyW', false);
      runUntil(b, fps, 3, () => hangs(b) || !L.holding);
      path.push(nameOf(s, b));
    }
    look(s, b, 0, -1);
    b.key('KeyW', true);
    runUntil(b, fps, 6, () => !L.holding);
    b.key('KeyW', false);
    const up = path.join(' ') === 'A0 B0 A1 B1 A2 B2 A3 B3' && L.lastLetGo === 'climbed up' && b.pos.y > 11.9;
    topOk &&= up;
    tops.push(`(${sx}, ${sz}):${up ? 'top' : path.join(' ') + ' ' + L.lastLetGo}`);
    b.physics.world.removeRigidBody(b.body);
  }
  ok(topOk, `chimney-2.5 @30 moved by (0, 0.07), (0.07, 0), (0, 7.3) and (2.5, 0.13) m: face to face to B3 and W onto the top every time (${tops.join(' ')})`);
}

// ---- the round's review: what a climbing frame and a shimmy ask the real engine ------------------------------------------------
// A wall climbed under `shelves` 'grab' asked the shallow lips' column every frame (14 rays against 2): a plain face across the
// whole column now spares it (three queries), while a sill in a window's recess is still handed over to; a shimmy along a lip
// that runs on looked along the whole of a hop's reach again every quarter metre (8 rays a frame against 2.9): the walk is
// carried on. Rays a frame on the real Rapier, the round's settings against `climbSmoothBefore`'s.
for (const fps of [60, 144] as const) {
  const wall = async (window: boolean, before: boolean) => {
    resetClimbTune();
    resetMoveTune();
    if (before) climbSmoothBefore();
    const p = await makePhysics();
    ground(p, 0);
    if (window) {
      box(p, [-3, 0, 1], [3, 4.0, 2]);
      box(p, [-3, 4.6, 1], [3, 9, 2]);
      box(p, [-3, 4.0, 1.5], [3, 4.6, 2]);
      box(p, [-3, 4.0, 1], [-0.8, 4.6, 1.5]);
      box(p, [0.8, 4.0, 1], [3, 4.6, 1.5]);
    } else box(p, [-3, 0, 1], [3, 9, 2]);
    p.stepOnce();
    p.acc = 0;
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.place(0, 0, 0.3);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.heading = 0;
    b.run(fps, 0.3);
    b.key('KeyE', true);
    b.key('KeyW', true);
    let climbing = 0;
    let rays = 0;
    for (let i = 0; i < 8 * fps && !b.ledge.holding; i++) {
      const c0 = b.ledge.casts;
      b.frame(1 / fps);
      fill(b);
      // (Counted while the climb is on the wall with its band of hands under 5 m: the wall's top in the band asks the column at
      // either setting, and is no frame of a plain face.)
      if (b.wall.phase === WALL_ON && !b.ledge.holding && b.pos.y < 2.6) {
        climbing++;
        rays += b.ledge.casts - c0;
      }
    }
    b.key('KeyE', false);
    b.key('KeyW', false);
    return { perFrame: rays / Math.max(1, climbing), climbing, lip: b.ledge.holding ? b.ledge.lip.ey : Number.NaN, y: b.pos.y, flat: b.ledge.flatGated };
  };
  const plain = await wall(false, false);
  const plainBefore = await wall(false, true);
  ok(plain.climbing > fps && plain.perFrame <= plainBefore.perFrame + 2.5 && plain.flat > 0 && Math.abs(plain.lip - plainBefore.lip) < 1e-6 && Math.abs(plain.lip - 9) < 0.02, `@${fps}: a plain wall climbed under 'grab' asks ${plain.perFrame.toFixed(2)} rays a frame against ${plainBefore.perFrame.toFixed(2)} over ${plain.climbing} frames (the plain face's gate sparing the column ${plain.flat} times) and hands over at the same top (${plain.lip.toFixed(3)} and ${plainBefore.lip.toFixed(3)})`);
  const sill = await wall(true, false);
  const sillBefore = await wall(true, true);
  ok(Math.abs(sill.lip - 4) < 0.02 && Math.abs(sillBefore.lip - 9) < 0.02, `@${fps}: a window's sill, 0.5 m deep at 4 m, is still a shallow lip the climb hands over to under 'grab' (the gate never spares a column with a recess in it; ${sill.lip.toFixed(2)}), where 'before' climbs on to the top (${sillBefore.lip})`);
  // A shimmy along a lip 120 m long, A held, past the hop band's reach either way: rays a frame.
  const shimmy = async (before: boolean) => {
    resetClimbTune();
    resetMoveTune();
    if (before) climbSmoothBefore();
    const p = await makePhysics();
    ground(p, 0);
    box(p, [-60, 0, 1], [60, 2.5, 2.5]);
    p.stepOnce();
    p.acc = 0;
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.place(0, 0, 0.4);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.heading = 0;
    b.run(fps, 0.3);
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2.5, () => hangs(b));
    b.key('KeyE', false);
    runUntil(b, fps, 0.5, () => false);
    b.key('KeyA', true);
    runUntil(b, fps, 1, () => false);
    const c0 = b.ledge.casts;
    const x0 = b.pos.x;
    const n = 5 * fps;
    for (let i = 0; i < n; i++) {
      b.frame(1 / fps);
      fill(b);
    }
    b.key('KeyA', false);
    return { perFrame: (b.ledge.casts - c0) / n, moved: Math.abs(b.pos.x - x0), seeks: b.ledge.seeks, hanging: hangs(b) };
  };
  const sh = await shimmy(false);
  const shBefore = await shimmy(true);
  ok(sh.hanging && sh.moved > 2 && Math.abs(sh.moved - shBefore.moved) < 1e-6 && sh.seeks > 8 && sh.perFrame <= shBefore.perFrame + 1.5, `@${fps}: a shimmy along a long lip, A held for 5 s (${sh.moved.toFixed(2)} m, the way looked for again ${sh.seeks} times), asks ${sh.perFrame.toFixed(2)} rays a frame against ${shBefore.perFrame.toFixed(2)} under 'before'`);
}

// ---- the other settings: phase 2's keys, untouched -------------------------------------------------------------------------
for (const fps of RATES) {
  resetClimbTune();
  tuneClimb({ hangKeys: 'before' });
  const s = await standPiece(piece('ladder-1.25'));
  const { b } = bodyAt(s, 'stand', fps);
  jumpE(s, b, fps);
  const L = b.ledge;
  b.key('KeyW', true);
  let cue = 0;
  runUntil(b, fps, 3, () => {
    if (L.cue > cue) cue = L.cue;
    return hangs(b) && nameOf(s, b) === 'R1';
  });
  b.key('KeyW', false);
  ok(cue === 0 && L.cueKind === WAYK_NONE && L.seeks === 0 && L.wayKind === WAYK_NONE && nameOf(s, b) === 'R1' && WAYK_LADDER === 1, `ladder-1.25 @${fps}: under hangKeys 'before' W pressed hops up to R1 at once as phase 2's W did, nothing looked for and nothing shown`);
  tap(b, 'ControlLeft', fps);
  ok(!L.holding && L.drops === 0, `ladder-1.25 @${fps}: ... and a tap of crouch lets go as phase 2 did`);
  b.physics.world.removeRigidBody(b.body);
}
resetClimbTune();
console.log(`chimney ${chimneyPaths[0]}`);
console.log(`climbSmooth: ${checks} checks passed`);
