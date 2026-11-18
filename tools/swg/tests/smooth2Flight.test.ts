// Climbing II, Smoothness II, item 1 (`climb.hopFlight` 'timed'): hops, grabs and drops timed to their clip's own hands,
// through the game's own movement and climbing (the grapple's harness, tools/swg/tests/grappleBody.ts, on the real Rapier,
// the course's pieces stood by tools/swg/tests/climbCourseBody.ts), frame by frame while moving, at 30, 60, 144 and 240
// frames a second:
//  - a hop sideways and a hop up: the body stands still on the held lip's hang place until the clip's own leave (the owner's
//    timing, src/anim/handTimes.ts), then goes through the air with a constant acceleration (its position's second difference
//    the same from frame to frame: a thrown body's), is on the new lip's hang place in the very frame the clip's clock reaches
//    its touch and stands still there after; an up hop slows to its top (its rise each frame shrinking to nothing at the
//    touch); the clip's rate handed to the rig adds up to the clip's own clock; the flight takes its clip stretch over its
//    fitted rate at every rate within a frame; the capsule meets nothing that stands still at any frame of the flight;
//  - a grab from a standing jump: the body on the hang place exactly as the grab clip's clock reaches its touch;
//  - a drop by the owner's drops' rule: the clip never played faster than its own rate, held at the feet's touch while a
//    long fall goes on, put there at once where the fall is shorter than the clip's own, its end handed over once;
//  - under 'before' none of it: no timed move, no rate handed over.
//
// Run: node tools/swg/tests/smooth2Flight.test.ts
import assert from 'node:assert/strict';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { CLIMB_TUNE, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { resetMoveTune } from '../../../src/anim/moveTune.ts';
import { handMoment } from '../../../src/anim/handTimes.ts';
import { LEDGE_FACTS, LEDGE_ROLES } from '../../../src/anim/ledgeClips.ts';
import { LEDGE_HANG, LEDGE_MOVE, LEDGE_NONE } from '../../../src/player/ledge.ts';
import { STILL_FLAGS } from '../../../src/player/stairSense.ts';
import { RAPIER } from '../../../src/core/physics.ts';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { bodyAt, runUntil, shimmy, standPiece, tap } from './climbCourseBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const RATES = [30, 60, 144, 240] as const;
const piece = (id: string) => climbCourse({ pieces: [id] }).pieces[0];
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
const capsule = new RAPIER.Capsule(0.45, 0.35);
const rot = { x: 0, y: 0, z: 0, w: 1 };
const ALL = 0xffffffff;

/** Whether the standing capsule with its feet at the body's place meets anything that stands still (the ledges' own test). */
function capsuleClear(b: TestBody): boolean {
  const at = { x: b.pos.x, y: b.pos.y + 0.35 + 0.45, z: b.pos.z };
  return b.physics.world.intersectionWithShape(at, rot, capsule, STILL_FLAGS, ALL) === null;
}

/** One frame of a move, as recorded. */
interface Frame {
  t: number;
  phase: number;
  timed: boolean;
  clip: number;
  rate: number;
  x: number;
  y: number;
  z: number;
  clear: boolean;
}

/** Frames until the body hangs again (or `seconds`), each recorded while the ledges carry it through a one-off. */
function record(b: TestBody, fps: number, seconds: number, untilHang = true): Frame[] {
  const L = b.ledge;
  const out: Frame[] = [];
  let left = false;
  runUntil(b, fps, seconds, () => {
    const m = L.move;
    if (L.phase === LEDGE_MOVE) out.push({ t: b.t, phase: L.phase, timed: m.timed, clip: m.time, rate: L.moveRate, x: b.pos.x, y: b.pos.y, z: b.pos.z, clear: capsuleClear(b) });
    if (L.phase !== LEDGE_HANG) left = true;
    return untilHang && left && hangs(b);
  });
  return out;
}

/**
 * The flight's checks over a recorded timed move (`what` the words): still to the leave, a constant acceleration in the air,
 * on the end exactly as the clock reaches the touch and still after, the rates adding up, no frame inside anything.
 */
function flightChecks(frames: Frame[], b: TestBody, fps: number, id: string, what: string): { upEnd: number; upStart: number; flightSec: number } {
  const m = b.ledge.move;
  const dt = 1 / fps;
  const tL = handMoment(id, 'leave');
  const tT = handMoment(id, 'touch');
  ok(frames.length > 0 && frames.every((f) => f.timed), `${what} @${fps}: a timed move (${frames.length} frames)`);
  // Before the leave: the move's start.
  const pre = frames.filter((f) => f.clip <= tL + 1e-9);
  const sx = m.fx;
  const sy = m.fy;
  const sz = m.fz;
  ok(pre.every((f) => Math.hypot(f.x - sx, f.y - sy, f.z - sz) < 1e-9), `${what} @${fps}: still on the held lip's hang place to the leave at ${tL} s (${pre.length} frames)`);
  // In the air: constant acceleration (the second difference of the place over whole frames inside the flight).
  const air = frames.filter((f) => f.clip > tL + 1e-9 && f.clip < tT - 1e-9);
  let accWorst = 0;
  for (let k = 2; k < air.length; k++) {
    // Only frames whose step lay wholly inside the flight (the first one straddles the leave).
    if (air[k - 2].clip <= tL + 1e-9) continue;
    for (const c of ['x', 'y', 'z'] as const) {
      const a1 = air[k][c] - 2 * air[k - 1][c] + air[k - 2][c];
      const a0 = k >= 3 && air[k - 3].clip > tL + 1e-9 ? air[k - 1][c] - 2 * air[k - 2][c] + air[k - 3][c] : a1;
      accWorst = Math.max(accWorst, Math.abs(a1 - a0) / (dt * dt));
    }
  }
  ok(air.length >= 2 && accWorst < 1e-5, `${what} @${fps}: through the air on a thrown body's arc, its acceleration the same every frame (worst change ${accWorst.toExponential(1)} m/s^2 over ${air.length} frames)`);
  // At the touch: the move's end, exactly, in the frame the clock reaches it, and still after.
  const arrive = frames.findIndex((f) => f.clip >= tT - 1e-9);
  const ex = m.tx;
  const ey = m.ty;
  const ez = m.tz;
  const post = arrive >= 0 ? frames.slice(arrive) : [];
  ok(arrive > 0 && Math.hypot(frames[arrive - 1].x - ex, frames[arrive - 1].y - ey, frames[arrive - 1].z - ez) > 1e-6 && post.every((f) => Math.hypot(f.x - ex, f.y - ey, f.z - ez) < 1e-9), `${what} @${fps}: on the new lip's hang place in the frame the clip's clock reaches its touch (${tT} s) and still after (${post.length} frames), short of it the frame before`);
  // The rates handed to the rig add up to the clip's own clock (each frame's clip advance over its seconds).
  let sum = frames[0].clip - frames[0].rate * dt;
  let rateWorst = 0;
  for (const f of frames) {
    sum += f.rate * dt;
    rateWorst = Math.max(rateWorst, Math.abs(sum - f.clip));
  }
  ok(rateWorst < 1e-9, `${what} @${fps}: the rate handed to the rig a frame adds up to the move's own clock (worst ${rateWorst.toExponential(1)} s)`);
  ok(frames.every((f) => f.rate <= CLIMB_TUNE.flightRateMax + 1e-9 && f.rate >= Math.min(1, CLIMB_TUNE.flightRateMin) - 1e-9), `${what} @${fps}: the clip played between ${CLIMB_TUNE.flightRateMin} and ${CLIMB_TUNE.flightRateMax} of its own rate every frame`);
  ok(frames.every((f) => f.clear), `${what} @${fps}: the body's capsule meets nothing that stands still at any frame of the move`);
  // The flight's own seconds: from the instant the clock passes the leave (its own rate before it) to the instant it reaches
  // the touch (the flight's rate), both found inside their frames: the stretch over the fitted rate, at every rate.
  const k = frames.findIndex((f) => f.clip > tL + 1e-9);
  const crossL = k > 0 ? frames[k - 1].t + (tL - frames[k - 1].clip) : Number.NaN;
  const crossT = arrive > 0 ? frames[arrive - 1].t + (tT - Math.max(tL, frames[arrive - 1].clip)) / m.fr + Math.max(0, tL - frames[arrive - 1].clip) : Number.NaN;
  const flightSec = crossT - crossL;
  const want = (tT - tL) / m.fr;
  ok(Math.abs(flightSec - want) < 1e-9, `${what} @${fps}: in the air for its stretch over its rate (${flightSec.toFixed(4)} s against ${want.toFixed(4)} at ${m.fr.toFixed(3)} of the clip's rate)`);
  const upStart = air.length >= 2 ? (air[1].y - air[0].y) / dt : 0;
  const upEnd = air.length >= 2 ? (frames[arrive].y - air[air.length - 1].y) / dt : 0;
  return { upEnd, upStart, flightSec };
}

resetClimbTune();
resetMoveTune();
ok(CLIMB_TUNE.hopFlight === 'timed', 'the round ships hops timed to the hands');

// ---- 1. a hop sideways --------------------------------------------------------------------------------------------------------
{
  const s = await standPiece(piece('gap-side-1.5'));
  const seconds: number[] = [];
  for (const fps of RATES) {
    resetClimbTune();
    const { b, w } = bodyAt(s, 'onA', fps);
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2.5, () => hangs(b));
    b.key('KeyE', false);
    runUntil(b, fps, 0.3, () => false);
    shimmy(s, b, w, 'KeyD', fps);
    b.key('KeyD', true);
    tap(b, 'Space', fps);
    b.key('KeyD', false);
    const frames = record(b, fps, 4);
    const id = b.ledge.move.id;
    ok(id === LEDGE_ROLES.braced.hopRight, `@${fps}: the hop right plays ${LEDGE_ROLES.braced.hopRight} (${id})`);
    const r = flightChecks(frames, b, fps, id, 'a hop sideways');
    seconds.push(r.flightSec);
    ok(hangs(b), `@${fps}: and hangs from the lip it hopped to`);
    b.physics.world.removeRigidBody(b.body);
  }
  // The flight's seconds are the way's alone (each rate's own above, exact): they differ between rates only by where the shimmy
  // stopped at A's end (phase 1's own stop, millimetres apart by rate), never by the frames.
  const spread = Math.max(...seconds) - Math.min(...seconds);
  ok(spread < 0.01, `the hop's flight alike at every rate (${seconds.map((v) => v.toFixed(4)).join(', ')}: the way's own length moves it, the shimmy's stop millimetres apart)`);
}

// ---- 2. a hop up: it slows to its top -----------------------------------------------------------------------------------------
{
  // 1.5 m up: past the ladder's reach, a hop (W held shows its cue, Space takes it, as the owner's keys have it).
  const s = await standPiece(piece('gap-updown-1.5'));
  for (const fps of RATES) {
    resetClimbTune();
    const { b, w } = bodyAt(s, 'onA', fps);
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2.5, () => hangs(b));
    b.key('KeyE', false);
    runUntil(b, fps, 0.3, () => false);
    // Along A to under B's middle (the harness's own up-and-down script: A's chain begins 4 m to the left of the piece's middle).
    shimmy(s, b, w, 'KeyD', fps, 20, 4);
    b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
    b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
    b.key('KeyW', true);
    runUntil(b, fps, 2, () => b.ledge.cue >= 0.99);
    tap(b, 'Space', fps);
    b.key('KeyW', false);
    const frames = record(b, fps, 4);
    const id = b.ledge.move.id;
    const r = flightChecks(frames, b, fps, id, 'a hop up');
    ok(r.upStart > 0 && r.upEnd <= 20.3 / fps + 1e-6 && r.upEnd < r.upStart, `@${fps}: the hop up rises fastest as it leaves (${r.upStart.toFixed(2)} m/s) and slows to its top at the touch (${r.upEnd.toFixed(3)} m/s over the last frame)`);
    b.physics.world.removeRigidBody(b.body);
  }
}

// ---- 3. a grab from a standing jump: on the hang place as the clip's hands touch ---------------------------------------------
{
  const s = await standPiece(piece('lip-braced-2.4'));
  for (const fps of RATES) {
    resetClimbTune();
    const { b } = bodyAt(s, 'stand', fps);
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    const frames = record(b, fps, 3);
    b.key('KeyE', false);
    const m = b.ledge.move;
    const id = m.id;
    const tT = handMoment(id, 'touch');
    ok(frames.length > 0 && frames[0].timed && m.kind === 'grab', `@${fps}: the grab (${id}) is timed`);
    const arrive = frames.findIndex((f) => f.clip >= tT - 1e-9);
    const post = arrive >= 0 ? frames.slice(arrive) : [];
    ok(arrive > 0 && post.every((f) => Math.hypot(f.x - m.tx, f.y - m.ty, f.z - m.tz) < 1e-9) && Math.hypot(frames[arrive - 1].x - m.tx, frames[arrive - 1].y - m.ty, frames[arrive - 1].z - m.tz) > 1e-6, `@${fps}: on the hang place in the frame the grab clip's clock reaches its touch (${tT} s), never before`);
    ok(frames.every((f) => f.clear), `@${fps}: the capsule meets nothing still on the way`);
    b.physics.world.removeRigidBody(b.body);
  }
}

// ---- 4. the drops' rule ---------------------------------------------------------------------------------------------------------
{
  const id = LEDGE_ROLES.braced.drop;
  const tL = handMoment(id, 'leave');
  const tT = handMoment(id, 'touch');
  const dur = LEDGE_FACTS[id].dur;
  for (const H of [3.4, 8, 20]) {
    for (const fps of RATES) {
      resetClimbTune();
      resetMoveTune();
      const p = await makePhysics();
      ground(p, 0);
      box(p, [-3, 0, 1], [3, H, 2.5]);
      p.stepOnce();
      (p as unknown as { acc: number }).acc = 0;
      const b = new TestBody(p);
      b.jka.forceLevel = 0;
      b.place(0, H - 1.6, 0.4);
      b.forward.set(0, 0, 1);
      b.right.set(-1, 0, 0);
      b.heading = 0;
      b.vel.set(0, -1, 0);
      b.grounded = false;
      b.key('KeyE', true);
      runUntil(b, fps, 3, () => hangs(b));
      b.key('KeyE', false);
      runUntil(b, fps, 0.4, () => false);
      const L = b.ledge;
      ok(hangs(b) && L.braced && Math.abs(L.lip.ey - H) < 0.02, `a ${H} m wall @${fps}: braced on its lip`);
      // The drop: a crouch tap with no lip beneath lets go; its clip then follows the owner's rule frame by frame (the player
      // hands the drop's clocks the body's own grounded after each frame).
      b.key('ControlLeft', true);
      b.frame(1 / fps);
      b.key('ControlLeft', false);
      ok(L.phase === LEDGE_NONE && L.dropId === id, `a ${H} m wall @${fps}: let go, the drop's clip (${L.dropId}) played by the rule`);
      let fastest = 0;
      let landedAt = Number.NaN;
      let clockAtLand = Number.NaN;
      let beforeLand = 0;
      let cuts = 0;
      let clock = 0;
      for (let k = 0; k < Math.round(6 * fps) && L.dropId; k++) {
        // (The frame runs the player's own drop call, `driveDropClip`, after the ledge's tick: the clip put at the clock's start
        // and run at the frame's rate, every frame.)
        b.frame(1 / fps);
        if (L.cutNow) cuts++;
        const r = L.dropRateNow;
        if (r === r) fastest = Math.max(fastest, r);
        if (L.dropSeek === L.dropSeek) clock = L.dropSeek;
        if (r === r) clock += r / fps;
        if (b.grounded && !(landedAt === landedAt)) {
          landedAt = b.t;
          clockAtLand = clock;
        }
        if (!b.grounded) beforeLand = Math.max(beforeLand, clock);
      }
      ok(fastest <= 1 + 1e-9, `a ${H} m wall @${fps}: never played faster than its own rate (fastest ${fastest.toFixed(3)})`);
      ok(beforeLand <= tT + 1e-9, `a ${H} m wall @${fps}: not past the feet's touch (${tT} s) while still falling (${beforeLand.toFixed(3)})`);
      ok(clockAtLand === clockAtLand && clockAtLand >= tT - 1e-9 && clockAtLand <= tT + 1 / fps + 1e-9, `a ${H} m wall @${fps}: at the feet's touch as they meet the ground (${clockAtLand.toFixed(3)} s into the clip)`);
      ok(cuts === 1 && !L.dropId && clock >= dur - 1e-6, `a ${H} m wall @${fps}: played to its end after the landing and handed over once (${cuts})`);
      void tL;
      b.physics.world.removeRigidBody(b.body);
    }
  }
}

// ---- 5. 'before': nothing of it ----------------------------------------------------------------------------------------------
{
  const s = await standPiece(piece('gap-side-1.5'));
  for (const fps of [30, 240]) {
    resetClimbTune();
    tuneClimb({ hopFlight: 'before' });
    const { b, w } = bodyAt(s, 'onA', fps);
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2.5, () => hangs(b));
    b.key('KeyE', false);
    runUntil(b, fps, 0.3, () => false);
    shimmy(s, b, w, 'KeyD', fps);
    b.key('KeyD', true);
    tap(b, 'Space', fps);
    b.key('KeyD', false);
    const frames = record(b, fps, 4);
    const m = b.ledge.move;
    ok(frames.length > 0 && frames.every((f) => !f.timed && !(f.rate === f.rate)) && Math.hypot(frames[0].x - m.fx, frames[0].y - m.fy, frames[0].z - m.fz) > 1e-6, `under 'before' @${fps}: no timed move, no rate handed over, the body moving from the hop's first frame as before`);
    b.physics.world.removeRigidBody(b.body);
  }
  resetClimbTune();
}
console.log(`smooth2Flight: ${checks} checks passed`);
