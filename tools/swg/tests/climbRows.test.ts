// Climbing II, the smoothness round, item 5: the course's extra rows (`climbCourse({ extras: true })`: the ladders, the zigzags,
// the shelves, the chimney, the tower and the low row) driven end to end with only the owner's keys as the round has them
// (W where the view looks, W or S held climbing a ladder-like ladder, a cue held and Space committing a hop, A or D with W or
// S for a diagonal, a crouch tap dropping to the lip beneath and held falling past every lip, E with a jump grabbing, E at a
// wall climbing it), through the game's own movement and climbing (the grapple's harness, tools/swg/tests/grappleBody.ts, on
// the real Rapier, one piece stood at a time by tools/swg/tests/climbCourseBody.ts), at 30, 60, 144 and 240 frames a second.
// Every step's lip and how it was reached is held, at every rate alike, and the whole trace (every frame of every body: its
// place, its hang's phase, its heading) goes into one digest recorded here (the extras are in no other digest).
//
// What the round found while driving them, at the shipped sliders, is held too, as what it is (each is the owner's slider or
// a later phase's, not a fault of the climbing code): ladder-2's rungs are past `hopUp` (1.5 m) and W there finds nothing;
// on a zigzag A or D alone takes the nearer lip that side, up or down (back down to the rung below), so a diagonal up is W
// with A or D; shelves-1's next tier, 1 m up and 0.6 m back, has no hang (the tier under it fills the body's place), so W
// climbs onto the tier's top and nothing grabs or climbs the waist-high tier from there (phase 6's clamber); the tower's 2 m
// hop to C is past `hopSide` (1.5 m) and the hop down to D, 1.8 m down, past `hopDown` (1.5 m), so its whole line is driven
// with those two sliders moved (2.5 and 2), as the owner would move them.
//
// Run: node tools/swg/tests/climbRows.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { climbCourse, extraIds } from '../../../src/anim/climbCourse.ts';
import { courseToWorld, courseWayToWorld, worldToCourse } from '../../../src/anim/climbCourseBuild.ts';
import { resetClimbTune as resetShipped, tuneClimb, climbSmooth2Before } from '../../../src/anim/climbTune.ts';
// Smoothness II: these drives hold the smoothness round's extra rows (its digest below), so Smoothness II's switches go to
// their 'before' at every reset.
// Smoothness II's item 9 drives these rows again with every switch of that round on (tools/swg/tests/smooth2Rows.test.ts sets
// SWG3JS_ROWS_AFTER and imports this file): its own digest below.
const ROWS_AFTER = process.env.SWG3JS_ROWS_AFTER === '1';
const resetClimbTune = (): void => {
  resetShipped();
  if (!ROWS_AFTER) climbSmooth2Before();
};
import { resetMoveTune } from '../../../src/anim/moveTune.ts';
import { LEDGE_HANG, WAYK_DROP, WAYK_HOP } from '../../../src/player/ledge.ts';
import { LYING, STAND_TALL } from '../../../src/player/bodyShape.ts';
import { bodyAt, nearestLip, runUntil, standPiece, tap, type Stood, type Watch } from './climbCourseBody.ts';
import type { TestBody } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const RATES = [30, 60, 144, 240] as const;
/** The digest of every frame of every drive below, at every rate, recorded from this round's own harness. */
const RECORDED = ROWS_AFTER ? '50f082fe9fee8e201f5a040ff94ec54bfbe4813dabb279f720b9aaa41bcdc509' : '22b33037449c98ba20a78757cf1ff9542bce41f1099a0ad773d10b89b7f9dd1d';
const piece = (id: string) => climbCourse({ extras: true, pieces: [id] }).pieces[0];
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
const nameOf = (s: Stood, b: TestBody) => (b.ledge.holding ? nearestLip(s, b.ledge.lip.ex, b.ledge.lip.ey, b.ledge.lip.ez).name : '-');
const r2 = (v: number) => v.toFixed(2);
const trace = createHash('sha256');
let frames = 0;
const table: string[] = [];

/** The hands' worst distance off the course's lips while hanging (the rail's samples at the hands' rest spacing). */
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
/** The view turned to the wall the body faces (W means up). */
function faceWall(b: TestBody): void {
  b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
  b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
}
/** The view turned to a way of the piece (its own x right, z ahead). */
function look(s: Stood, b: TestBody, dx: number, dz: number): void {
  const f = courseWayToWorld(s.frame, dx, dz, { x: 0, z: 0 });
  b.forward.set(f.x, 0, f.z);
  b.right.set(-f.z, 0, f.x);
}
/** Where the body stands in the piece's own frame. */
const here = (s: Stood, b: TestBody) => worldToCourse(s.frame, s.piece, b.pos.x, b.pos.y, b.pos.z, { x: 0, y: 0, z: 0 });
/** A standing jump with E held from its frame: the grab. */
function jumpE(b: TestBody, fps: number): boolean {
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 2.5, () => hangs(b));
  b.key('KeyE', false);
  return hangs(b);
}
/** One record of a drive: the steps' words, and the worst hands off a lip at a landing. */
class Drive {
  steps: string[] = [];
  handWorst = 0;
}
/**
 * A step by held keys (`keys`: W, S, or W/S with A or D): a ladder-like hold lands by the keys alone; a cue that shows is
 * taken by Space with the keys still held. The words: the lip it came to and how (`ladder`, `cue`, `none`).
 */
function step(s: Stood, b: TestBody, fps: number, keys: string[], d: Drive, cueKind = WAYK_HOP): string {
  const L = b.ledge;
  const from = nameOf(s, b);
  if (keys.includes('KeyW') && keys.length === 1) faceWall(b);
  for (const k of keys) b.key(k, true);
  let how = 'none';
  runUntil(b, fps, 4, () => {
    if (L.cueKind === cueKind && L.cue >= 0.99) {
      how = 'cue';
      return true;
    }
    if (hangs(b) && nameOf(s, b) !== from) {
      how = 'ladder';
      return true;
    }
    return !L.holding;
  });
  if (how === 'cue') tap(b, 'Space', fps);
  for (const k of keys) b.key(k, false);
  runUntil(b, fps, 3, () => (hangs(b) && nameOf(s, b) !== from) || !L.holding);
  runUntil(b, fps, 0.3, () => false);
  if (hangs(b) && nameOf(s, b) !== from) d.handWorst = Math.max(d.handWorst, handsOff(s, b));
  const word = `${nameOf(s, b)}:${how}`;
  d.steps.push(word);
  return word;
}
/** A tap of crouch: the drop to the lip beneath (or the let-go where none is). */
function crouchTap(s: Stood, b: TestBody, fps: number, d: Drive): string {
  const L = b.ledge;
  const from = nameOf(s, b);
  tap(b, 'ControlLeft', fps);
  runUntil(b, fps, 3, () => (hangs(b) && nameOf(s, b) !== from) || !L.holding);
  runUntil(b, fps, 0.3, () => false);
  if (hangs(b)) d.handWorst = Math.max(d.handWorst, handsOff(s, b));
  const word = `${nameOf(s, b)}:tap`;
  d.steps.push(word);
  return word;
}
/** A drive's body finished: its every frame into the round's digest, its record into the table. */
function done(id: string, fps: number, b: TestBody, w: Watch, d: Drive, what: string): void {
  const dig = w.hash.digest('hex');
  trace.update(`${id}@${fps} ${what} ${dig} ${d.steps.join(' ')}\n`);
  frames += w.frames;
  if (fps === 60) table.push(`${id} ${what}: ${d.steps.join(' ')}`);
  b.physics.world.removeRigidBody(b.body);
}
const join = (a: string[]) => a.join(' ');

resetClimbTune();
resetMoveTune();
// (The free twins, the traverses and the climbing walls the lead added after this round, `freePieces`, come after these rows and are
// driven by tools/swg/tests/smooth2Rows.test.ts.)
ok(JSON.stringify(extraIds().slice(0, 18)) === JSON.stringify(['ladder-0.75', 'ladder-1', 'ladder-1.25', 'ladder-1.5', 'ladder-2', 'ladder-zigzag-1', 'ladder-zigzag-1.5', 'shelves-1', 'shelves-1.5', 'shelves-2', 'chimney-2.5', 'tower', 'duck-1.5', 'duck-1.2', 'duck-0.9', 'tunnel-0.9', 'crawl-0.6', 'crawl-0.55']), 'every extra piece is driven below, in the rows\' order');

for (const fps of RATES) {
  // ---- the ladders: W up rung by rung, S down, W up again and onto the top ----------------------------------------------------
  for (const id of ['ladder-0.75', 'ladder-1', 'ladder-1.25', 'ladder-1.5'] as const) {
    resetClimbTune();
    const s = await standPiece(piece(id));
    const { b, w } = bodyAt(s, 'stand', fps);
    const d = new Drive();
    w.holdOn = true;
    jumpE(b, fps);
    d.steps.push(nameOf(s, b));
    const up: string[] = [];
    const down: string[] = [];
    for (let k = 0; k < 5; k++) up.push(step(s, b, fps, ['KeyW'], d));
    for (let k = 0; k < 5; k++) down.push(step(s, b, fps, ['KeyS'], d, WAYK_DROP));
    for (let k = 0; k < 5; k++) step(s, b, fps, ['KeyW'], d);
    w.holdOn = false;
    faceWall(b);
    tap(b, 'KeyW', fps);
    runUntil(b, fps, 3, () => !b.ledge.holding);
    runUntil(b, fps, 0.4, () => false);
    const how = id === 'ladder-0.75' || id === 'ladder-1' ? 'ladder' : 'cue';
    ok(join(up) === ['R1', 'R2', 'R3', 'R4', 'R5'].map((r) => `${r}:${how}`).join(' ') && join(down) === ['R4', 'R3', 'R2', 'R1', 'R0'].map((r) => `${r}:${how}`).join(' '), `${id} @${fps}: up rung by rung and down again by ${how === 'ladder' ? 'W and S held alone (a ladder-like ladder)' : 'W or S held, the cue, and Space'}: ${join(up)} | ${join(down)}`);
    ok(b.ledge.lastLetGo === 'climbed up' && b.grounded && w.falls === 0 && d.handWorst < 0.02, `${id} @${fps}: ... up again and W onto the top (${b.ledge.lastLetGo}); nothing let go on the way; each landing's hands on the rung (worst ${d.handWorst.toFixed(4)} m)`);
    done(id, fps, b, w, d, 'up, down, up, top');
    if (id !== 'ladder-1.25') continue;
    // A tap of crouch a rung down at a time from R5, and from R5 again, the crouch held: past every rung to the ground.
    const t2 = bodyAt(s, 'stand', fps);
    const d2 = new Drive();
    jumpE(t2.b, fps);
    for (let k = 0; k < 5; k++) step(s, t2.b, fps, ['KeyW'], d2);
    const taps: string[] = [];
    for (let k = 0; k < 6; k++) taps.push(crouchTap(s, t2.b, fps, d2));
    runUntil(t2.b, fps, 3, () => t2.b.grounded);
    ok(join(taps) === 'R4:tap R3:tap R2:tap R1:tap R0:tap -:tap' && t2.b.grounded && t2.b.pos.y < 0.2, `${id} @${fps}: down a crouch tap a rung (${join(taps)}), the last off to the ground`);
    for (let k = 0; k < 6 && !hangs(t2.b); k++) jumpE(t2.b, fps);
    for (let k = 0; k < 5; k++) step(s, t2.b, fps, ['KeyW'], d2);
    const at = nameOf(s, t2.b);
    t2.b.key('ControlLeft', true);
    let caught = 0;
    runUntil(t2.b, fps, 6, () => {
      if (hangs(t2.b)) caught++;
      return t2.b.grounded;
    });
    t2.b.key('ControlLeft', false);
    // (Hanging on a rung 1.25 m over the next, the feet stand at that rung's top, 0.3 m out from the wall: let go fully, the
    // body stands on it, a lip let go of and none caught. Found driving the rows; the owner's to judge.)
    const r4 = s.piece.lips.find((l) => l.name === 'R4')!;
    ok(at === 'R5' && caught === 0 && t2.b.grounded && here(s, t2.b).y > r4.a[1] - 0.4 && here(s, t2.b).y < r4.a[1] + 0.05 && t2.b.ledge.lastLetGo === 'let go fully', `${id} @${fps}: the crouch held from R5 lets go fully, catches no lip, and stands on R4's rung under the feet, on its front edge (y ${r2(here(s, t2.b).y)}, ${t2.b.ledge.lastLetGo})`);
    d2.steps.push('held');
    done(id, fps, t2.b, t2.w, d2, 'taps down, held');
  }
  // ---- ladder-2: past hopUp at the shipped sliders; with hopUp 2 (the owner's slider moved) up and down -------------------
  {
    resetClimbTune();
    const s = await standPiece(piece('ladder-2'));
    const { b, w } = bodyAt(s, 'stand', fps);
    const d = new Drive();
    jumpE(b, fps);
    d.steps.push(nameOf(s, b));
    const first = step(s, b, fps, ['KeyW'], d);
    ok(first === 'R0:none' && b.ledge.holding, `ladder-2 @${fps}: at the shipped hopUp (1.5 m) W from R0 finds nothing 2 m up and the body hangs on (${first}; the rung's 0.3 m top is too thin to stand on)`);
    done('ladder-2', fps, b, w, d, 'shipped');
    tuneClimb({ hopUp: 2 });
    const t2 = bodyAt(s, 'stand', fps);
    const d2 = new Drive();
    jumpE(t2.b, fps);
    const up: string[] = [];
    const down: string[] = [];
    for (let k = 0; k < 5; k++) up.push(step(s, t2.b, fps, ['KeyW'], d2));
    for (let k = 0; k < 5; k++) down.push(step(s, t2.b, fps, ['KeyS'], d2, WAYK_DROP));
    ok(join(up) === 'R1:cue R2:cue R3:cue R4:cue R5:cue' && join(down) === 'R4:cue R3:cue R2:cue R1:cue R0:cue' && t2.w.falls === 0, `ladder-2 @${fps}: with hopUp moved to 2 m, up and down by the cue and Space: ${join(up)} | ${join(down)}`);
    done('ladder-2', fps, t2.b, t2.w, d2, 'hopUp 2');
    resetClimbTune();
  }
  // ---- the zigzags: W with D or A up, S with A or D down ---------------------------------------------------------------------
  for (const id of ['ladder-zigzag-1', 'ladder-zigzag-1.5'] as const) {
    resetClimbTune();
    const s = await standPiece(piece(id));
    const { b, w } = bodyAt(s, 'stand', fps);
    const d = new Drive();
    w.holdOn = true;
    jumpE(b, fps);
    d.steps.push(nameOf(s, b));
    // A alone from R1 takes the nearer lip that side, up or down: back down to R0 (held as what it is).
    step(s, b, fps, ['KeyW', 'KeyD'], d);
    faceWall(b);
    const alone = step(s, b, fps, ['KeyA'], d);
    ok(alone === 'R0:cue', `${id} @${fps}: from R1, A alone takes the nearer lip to the left, which is R0 back down (${alone}): a diagonal up is W with A`);
    const up: string[] = [];
    for (let k = 0; k < 6; k++) {
      faceWall(b);
      up.push(step(s, b, fps, ['KeyW', k % 2 === 0 ? 'KeyD' : 'KeyA'], d));
    }
    const down: string[] = [];
    for (let k = 0; k < 6; k++) {
      faceWall(b);
      down.push(step(s, b, fps, ['KeyS', k % 2 === 0 ? 'KeyD' : 'KeyA'], d));
    }
    ok(join(up) === 'R1:cue R2:cue R3:cue R4:cue R5:cue R6:cue' && join(down) === 'R5:cue R4:cue R3:cue R2:cue R1:cue R0:cue' && w.falls === 0 && d.handWorst < 0.02, `${id} @${fps}: W with D or A up the zigzag, S with D or A down it, each by the side's cue and Space: ${join(up)} | ${join(down)} (hands worst ${d.handWorst.toFixed(4)} m)`);
    done(id, fps, b, w, d, 'up, down');
  }
  // ---- shelves-1.5: W, the cue and Space up; crouch taps down a tier at a time, off the last; held, past them all ------------
  {
    resetClimbTune();
    const s = await standPiece(piece('shelves-1.5'));
    const { b, w } = bodyAt(s, 'stand', fps);
    const d = new Drive();
    jumpE(b, fps);
    d.steps.push(nameOf(s, b));
    const up: string[] = [];
    for (let k = 0; k < 5; k++) up.push(step(s, b, fps, ['KeyW'], d));
    const down: string[] = [];
    for (let k = 0; k < 6; k++) down.push(crouchTap(s, b, fps, d));
    runUntil(b, fps, 3, () => b.grounded);
    ok(join(up) === 'T1:cue T2:cue T3:cue T4:cue T5:cue' && join(down) === 'T4:tap T3:tap T2:tap T1:tap T0:tap -:tap' && b.grounded && b.pos.y < 0.2, `shelves-1.5 @${fps}: up by the cue and Space (${join(up)}), down a crouch tap a tier, the last tap off to the ground (${join(down)})`);
    done('shelves-1.5', fps, b, w, d, 'up, taps down');
    const t2 = bodyAt(s, 'stand', fps);
    const d2 = new Drive();
    jumpE(t2.b, fps);
    for (let k = 0; k < 5; k++) step(s, t2.b, fps, ['KeyW'], d2);
    const at = nameOf(s, t2.b);
    t2.b.key('ControlLeft', true);
    let caught = 0;
    runUntil(t2.b, fps, 6, () => {
      if (hangs(t2.b)) caught++;
      return t2.b.grounded;
    });
    t2.b.key('ControlLeft', false);
    // (The tiers stand each 0.6 m out under the one above, so a body let go of T5 lands on T4's top, a step down: no lip caught.)
    ok(at === 'T5' && caught === 0 && t2.b.grounded && t2.b.ledge.lastLetGo === 'let go fully' && !t2.b.ledge.holding, `shelves-1.5 @${fps}: crouch held from T5 lets go fully, catches no lip and lands on the tier's top under it (y ${r2(here(s, t2.b).y)}, ${t2.b.ledge.lastLetGo})`);
    d2.steps.push('held');
    done('shelves-1.5', fps, t2.b, t2.w, d2, 'held');
  }
  // ---- shelves-2: W onto each top, a jump with E to the next tier; crouch taps down -------------------------------------------
  {
    resetClimbTune();
    const s = await standPiece(piece('shelves-2'));
    const { b, w } = bodyAt(s, 'stand', fps);
    const d = new Drive();
    jumpE(b, fps);
    d.steps.push(nameOf(s, b));
    for (let k = 0; k < 5; k++) {
      faceWall(b);
      tap(b, 'KeyW', fps);
      runUntil(b, fps, 4, () => !b.ledge.holding);
      runUntil(b, fps, 0.4, () => false);
      d.steps.push(`top${k}:${b.ledge.lastLetGo === 'climbed up' && b.grounded ? 'on' : 'no'}`);
      jumpE(b, fps);
      d.steps.push(`${nameOf(s, b)}:jumpE`);
    }
    const down: string[] = [];
    for (let k = 0; k < 6; k++) down.push(crouchTap(s, b, fps, d));
    runUntil(b, fps, 3, () => b.grounded);
    ok(join(d.steps.slice(0, 11)) === 'T0 top0:on T1:jumpE top1:on T2:jumpE top2:on T3:jumpE top3:on T4:jumpE top4:on T5:jumpE' && join(down) === 'T4:tap T3:tap T2:tap T1:tap T0:tap -:tap' && b.grounded, `shelves-2 @${fps}: each tier 2 m up (past hopUp) by W onto its top and a jump with E to the next (${join(d.steps.slice(0, 11))}); down a crouch tap a tier (${join(down)})`);
    done('shelves-2', fps, b, w, d, 'climb and jump up, taps down');
  }
  // ---- shelves-1: W onto T0's top (T1 has no hang over it); nothing climbs the waist-high tier from there --------------------
  {
    resetClimbTune();
    const s = await standPiece(piece('shelves-1'));
    const { b, w } = bodyAt(s, 'stand', fps);
    const d = new Drive();
    jumpE(b, fps);
    d.steps.push(nameOf(s, b));
    faceWall(b);
    let cue = 0;
    b.key('KeyW', true);
    runUntil(b, fps, 4, () => {
      if (b.ledge.cue > cue) cue = b.ledge.cue;
      return !b.ledge.holding;
    });
    b.key('KeyW', false);
    runUntil(b, fps, 0.4, () => false);
    const topY = here(s, b).y;
    d.steps.push(`top:${b.ledge.lastLetGo}`);
    const grabbed = jumpE(b, fps);
    runUntil(b, fps, 2, () => b.grounded);
    d.steps.push(`jumpE:${grabbed ? nameOf(s, b) : 'none'}`);
    ok(cue === 0 && d.steps[1] === 'top:climbed up' && Math.abs(topY - s.piece.lips[0].a[1]) < 0.05 && !grabbed, `shelves-1 @${fps}: W from T0 shows no cue and climbs onto T0's top (T1, 1 m up and 0.6 m back, has no hang: T0 fills the body's place under it); from the top a jump with E grabs nothing (T1's lip is 1 m over the feet): ${join(d.steps)}`);
    done('shelves-1', fps, b, w, d, 'W, then a jump with E');
  }
  // ---- the chimney: looking back, W held and Space rung to rung face to face; W at the top rung onto the top -----------------
  {
    resetClimbTune();
    const s = await standPiece(piece('chimney-2.5'));
    const { b, w } = bodyAt(s, 'stand', fps);
    const d = new Drive();
    w.holdOn = true;
    jumpE(b, fps);
    d.steps.push(nameOf(s, b));
    for (let k = 0; k < 7 && b.ledge.holding; k++) {
      look(s, b, 0, d.steps[d.steps.length - 1].startsWith('A') ? -1 : 1);
      runUntil(b, fps, 0.3, () => false);
      b.key('KeyW', true);
      runUntil(b, fps, 0.4, () => false);
      tap(b, 'Space', fps);
      b.key('KeyW', false);
      runUntil(b, fps, 3, () => hangs(b) || !b.ledge.holding);
      if (hangs(b)) d.handWorst = Math.max(d.handWorst, handsOff(s, b));
      d.steps.push(nameOf(s, b));
    }
    w.holdOn = false;
    look(s, b, 0, -1);
    b.key('KeyW', true);
    runUntil(b, fps, 6, () => !b.ledge.holding);
    b.key('KeyW', false);
    runUntil(b, fps, 0.4, () => false);
    d.steps.push(`top:${b.ledge.lastLetGo}`);
    ok(join(d.steps) === 'A0 B0 A1 B1 A2 B2 A3 B3 top:climbed up' && b.pos.y > 11.9 && d.handWorst < 0.02 && w.falls === 0, `chimney-2.5 @${fps}: up face to face by looking back, W and Space, and onto the top: ${join(d.steps)} (hands worst ${d.handWorst.toFixed(4)} m)`);
    done('chimney-2.5', fps, b, w, d, 'up');
  }
  // ---- the tower: at the shipped sliders to U2 (C is past hopSide); with hopSide 2.5 and hopDown 2 its whole line ------------
  for (const moved of [false, true]) {
    resetClimbTune();
    if (moved) tuneClimb({ hopSide: 2.5, hopDown: 2 });
    const s = await standPiece(piece('tower'));
    const { b, w } = bodyAt(s, 'stand', fps);
    const L = b.ledge;
    const d = new Drive();
    jumpE(b, fps);
    d.steps.push(nameOf(s, b));
    // D held along A and up its two steps (0.35 m each) to S2's end.
    faceWall(b);
    b.key('KeyD', true);
    runUntil(b, fps, 12, () => false);
    b.key('KeyD', false);
    runUntil(b, fps, 0.3, () => false);
    d.steps.push(`${nameOf(s, b)}:along`);
    step(s, b, fps, ['KeyW'], d);
    step(s, b, fps, ['KeyW'], d);
    // D held at U2: the cue toward C across 2 m, and Space.
    faceWall(b);
    b.key('KeyD', true);
    let cued = false;
    runUntil(b, fps, 6, () => {
      if (L.cueKind === WAYK_HOP && L.cue >= 0.99) cued = true;
      return cued || !L.holding;
    });
    if (cued) tap(b, 'Space', fps);
    b.key('KeyD', false);
    runUntil(b, fps, 3, () => (hangs(b) && nameOf(s, b) === 'C') || !L.holding);
    runUntil(b, fps, 0.3, () => false);
    d.steps.push(`${nameOf(s, b)}:${cued ? 'cue' : 'none'}`);
    if (!moved) {
      ok(join(d.steps) === 'A S2:along U1:cue U2:cue U2:none' && L.holding, `tower @${fps}: at the shipped sliders the grab, D up the steps, W and Space twice to U2, and D shows no cue toward C (2 m past hopSide 1.5): ${join(d.steps)}`);
      done('tower', fps, b, w, d, 'shipped');
      continue;
    }
    // W onto C's shelf, E at the wall over it and W up the wall to its top.
    faceWall(b);
    tap(b, 'KeyW', fps);
    runUntil(b, fps, 3, () => !L.holding);
    runUntil(b, fps, 0.5, () => false);
    d.steps.push(`shelf:${L.lastLetGo}`);
    b.key('KeyW', true);
    b.key('KeyE', true);
    runUntil(b, fps, 0.3, () => b.wall.holding);
    b.key('KeyE', false);
    runUntil(b, fps, 12, () => !b.wall.holding && !L.holding && b.grounded);
    b.key('KeyW', false);
    runUntil(b, fps, 0.5, () => false);
    d.steps.push(`wall:${here(s, b).y.toFixed(1)}`);
    // Hang from C2's front: the view out, crouched, E held, walked off the edge.
    {
      const c = here(s, b);
      const p = { x: 0, y: 0, z: 0 };
      courseToWorld(s.frame, s.piece, c.x, c.y, c.z - 1, p);
      const fx = p.x - b.pos.x;
      const fz = p.z - b.pos.z;
      const n = Math.hypot(fx, fz);
      b.forward.set(fx / n, 0, fz / n);
      b.right.set(-fz / n, 0, fx / n);
    }
    b.key('ControlLeft', true);
    b.key('KeyE', true);
    b.key('KeyW', true);
    runUntil(b, fps, 4, () => hangs(b));
    b.key('KeyW', false);
    b.key('KeyE', false);
    b.key('ControlLeft', false);
    runUntil(b, fps, 0.5, () => false);
    d.steps.push(`${nameOf(s, b)}:hang`);
    // D held: the cue toward D (2 m across, 1.8 m down) at C2's end, and Space.
    faceWall(b);
    b.key('KeyD', true);
    cued = false;
    runUntil(b, fps, 6, () => {
      if (L.cueKind === WAYK_HOP && L.cue >= 0.99) cued = true;
      return cued || !L.holding;
    });
    if (cued) tap(b, 'Space', fps);
    b.key('KeyD', false);
    runUntil(b, fps, 3, () => (hangs(b) && nameOf(s, b) === 'D') || !L.holding);
    runUntil(b, fps, 0.3, () => false);
    d.steps.push(`${nameOf(s, b)}:${cued ? 'cue' : 'none'}`);
    // W onto D's top, and off its back onto the platform P (4 m down).
    faceWall(b);
    tap(b, 'KeyW', fps);
    runUntil(b, fps, 3, () => !L.holding);
    runUntil(b, fps, 0.5, () => false);
    d.steps.push(`top:${here(s, b).y.toFixed(1)}`);
    look(s, b, 0, 1);
    b.key('KeyW', true);
    runUntil(b, fps, 4, () => here(s, b).y < 6 && b.grounded);
    b.key('KeyW', false);
    runUntil(b, fps, 0.3, () => false);
    d.steps.push(`P:${here(s, b).y.toFixed(1)}`);
    ok(join(d.steps) === 'A S2:along U1:cue U2:cue C:cue shelf:climbed up wall:10.8 C2:hang D:cue top:9.0 P:5.0', `tower @${fps}: with hopSide 2.5 and hopDown 2 the whole line, the grab to the drop onto its platform: ${join(d.steps)}`);
    done('tower', fps, b, w, d, 'hopSide 2.5, hopDown 2');
  }
  resetClimbTune();
  // ---- the low row: walk and run under each with W alone -----------------------------------------------------------------------
  for (const id of ['duck-1.5', 'duck-1.2', 'duck-0.9', 'tunnel-0.9', 'crawl-0.6', 'crawl-0.55'] as const) {
    for (const run of [true, false]) {
      resetMoveTune();
      const p = piece(id);
      const s = await standPiece(p);
      const { b, w } = bodyAt(s, 'stand', fps);
      const d = new Drive();
      b.key('KeyW', true);
      if (!run) b.key('ShiftLeft', true);
      const far = (p.numbers.long as number) + 3;
      let least = Infinity;
      let crouched = false;
      runUntil(b, fps, 30, () => {
        if (b.shape.kind !== LYING) least = Math.min(least, b.shape.tall);
        if (b.duck.crouch) crouched = true;
        return here(s, b).z > (p.solids[1] as { mid: number[]; half: number[] }).mid[2] + far;
      });
      b.key('KeyW', false);
      b.key('ShiftLeft', false);
      d.steps.push(`least:${r2(least)} crouch:${crouched} laid:${b.duck.laid} rose:${b.duck.rose}`);
      const under = p.numbers.under as number;
      const through = b.shape.kind !== LYING && b.shape.tall === STAND_TALL || b.shape.tall > 1.4;
      const lies = under < 0.8;
      ok(through && (lies ? b.duck.laid === 1 && b.duck.rose === 1 : b.duck.laid === 0) && (under <= 1 ? crouched || lies : !crouched) && (lies || least <= under - 0.04), `${id} ${run ? 'running' : 'walking'} @${fps}: passes under with W alone, ${lies ? 'lying down and crawling' : under <= 1 ? "on the crouch's clips at its height" : 'ducked on the walk\'s clips'}, and stands again past it (${d.steps[0]})`);
      done(id, fps, b, w, d, run ? 'run' : 'walk');
    }
  }
}

const digest = trace.digest('hex');
console.log(table.join('\n'));
console.log(`digest ${digest} over ${frames} frames`);
ok(digest === RECORDED, `the extra rows' whole trace at every rate is the one recorded (${digest.slice(0, 16)}, ${frames} frames)`);
console.log(`climbRows: ${checks} checks passed`);
