// Climbing II, Smoothness III, items 1, 2 and 4b through the game's own movement and climbing (the grapple's harness,
// tools/swg/tests/grappleBody.ts, on the real Rapier; the course's pieces stood by tools/swg/tests/climbCourseBody.ts), frame by
// frame while moving, at 30, 60, 144 and 240 frames a second:
//  - item 1 (`climb.hopFlight` 'arc'): a hop sideways, braced and free (a free 3 m hop, its own window 0.10 s), and a hop up fly
//    the time a thrown body's arc takes under `flightGravity`, rising `arcRise` over the higher end (their flight's seconds the
//    rise's and the fall's, within a frame at every rate; never quicker than that arc for its distance: the free 3 m hop takes
//    the time a 0.5 m rise and fall does, never the 0.1 s of its clip's window); the body still on the held lip to the clip's
//    leave, on the arc through the air (its vertical acceleration `flightGravity` every frame), on the new lip as the flight
//    ends and still after; the clip's clock at its touch as the flight ends, its rate never past `flightRateMax`, the rates handed
//    to the rig adding up to the clock from the seeks; a clip waiting for the contact eased into and out of its hold (its rate
//    never jumping inside the flight by more than the hold's own ease allows);
//  - item 4b (`climb.dropMove`): the crouch's tap from a hang over a lower lip drops to it on its own move ('drop': the held
//    kind's release clip, then the catch, crossfaded at the join; 'reverse': the hop up backward), falling from rest (its flight
//    the fall's own time), the hands touching as the flight ends; 'hop' the side hop as Smoothness II had it;
//  - item 2 (`climb.targetRoom` 'fit'): over the terrain's heightfield a lip whose hang stands in the ground (the edge of a base
//    slab a few centimetres over it, which a shape test cannot find a body wholly under) is no target for the crouch's drop
//    (the tap lets go), where 'none' takes the hang under the ground; every grab and hop the course's lips had are still taken;
//  - with this round's switches at their other setting, none of it (no arc's move, no drop's move).
//
// Run: node tools/swg/tests/smooth3Flight.test.ts
import assert from 'node:assert/strict';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { CLIMB_TUNE, DROP_PARTS, climbSmooth3Before, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { resetMoveTune } from '../../../src/anim/moveTune.ts';
import { handMoment } from '../../../src/anim/handTimes.ts';
import { LEDGE_FACTS, LEDGE_ROLES } from '../../../src/anim/ledgeClips.ts';
import { LEDGE_HANG, LEDGE_MOVE, LEDGE_NONE } from '../../../src/player/ledge.ts';
import { STILL_FLAGS } from '../../../src/player/stairSense.ts';
import { RAPIER } from '../../../src/core/physics.ts';
import { TestBody, box, heightChunk, makePhysics } from './grappleBody.ts';
import { bodyAt, runUntil, shimmy, standPiece, tap } from './climbCourseBody.ts';

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
const capsule = new RAPIER.Capsule(0.45, 0.35);
const rot = { x: 0, y: 0, z: 0, w: 1 };
const ALL = 0xffffffff;
const capsuleClear = (b: TestBody): boolean => b.physics.world.intersectionWithShape({ x: b.pos.x, y: b.pos.y + 0.8, z: b.pos.z }, rot, capsule, STILL_FLAGS, ALL) === null;

/** One frame of a move, as recorded. */
interface Frame {
  t: number;
  clock: number;
  fly: number;
  rate: number;
  seek: number;
  id: string;
  x: number;
  y: number;
  z: number;
  clear: boolean;
}
/** Frames of the one-off under way until the body hangs again (or `seconds`). */
function record(b: TestBody, fps: number, seconds: number): Frame[] {
  const L = b.ledge;
  const out: Frame[] = [];
  let left = false;
  runUntil(b, fps, seconds, () => {
    const m = L.move;
    if (L.phase === LEDGE_MOVE) out.push({ t: b.t, clock: m.time, fly: m.fly, rate: L.moveRate, seek: L.moveSeek, id: m.id, x: b.pos.x, y: b.pos.y, z: b.pos.z, clear: capsuleClear(b) });
    if (L.phase !== LEDGE_HANG) left = true;
    return left && hangs(b);
  });
  return out;
}

/** The arc's own flight time for a way from `fy` to `ty` rising `rise` over its higher end (`drop`: falling from rest). */
function arcSeconds(fy: number, ty: number, rise: number, drop: boolean): number {
  const g = CLIMB_TUNE.flightGravity;
  const top = drop ? fy : Math.max(fy, ty) + rise;
  return Math.sqrt((2 * (top - fy)) / g) + Math.sqrt((2 * (top - ty)) / g);
}

/**
 * The checks over an arc's move: still to the leave, a thrown body's acceleration in the air, on the end as the flight ends and
 * still after, the clock at its touch then, the rates adding up from the seeks, the rate held to `flightRateMax`, the hold eased.
 */
function arcChecks(frames: Frame[], b: TestBody, fps: number, what: string, drop: boolean): { F: number } {
  const L = b.ledge;
  const m = L.move;
  const dt = 1 / fps;
  ok(frames.length > 0 && m.arc, `${what} @${fps}: an arc's move (${frames.length} frames, ${m.id})`);
  const pre = frames.filter((f) => f.fly <= 0);
  ok(pre.every((f) => Math.hypot(f.x - m.fx, f.y - m.fy, f.z - m.fz) < 1e-9), `${what} @${fps}: still on the held lip's hang place to the clip's leave (${pre.length} frames)`);
  // In the air: the vertical acceleration the world's gravity (second differences of frames wholly inside the flight).
  const air = frames.filter((f) => f.fly > 0 && f.fly < m.F);
  const g = CLIMB_TUNE.flightGravity;
  // The arc's own seconds read off its way (a quadratic's bulge over its ends' middle is a quarter of g t^2), and the plain arc's.
  const bulge = 2 * m.cy - m.fy - m.ty;
  const curve = Math.sqrt((2 * bulge) / g);
  const own = arcSeconds(m.fy, m.ty, CLIMB_TUNE.arcRise * b.ledgeScale, drop);
  const aWant = (2 * (m.fy - 2 * m.cy + m.ty)) / (m.F * m.F);
  let accWorst = 0;
  for (let k = 2; k < air.length; k++) {
    if (!(air[k - 2].fly > dt * 1.01)) continue;
    const a = (air[k].y - 2 * air[k - 1].y + air[k - 2].y) / (dt * dt);
    accWorst = Math.max(accWorst, Math.abs(a - aWant));
  }
  ok(air.length >= 3 && accWorst < 1e-6 && (Math.abs(aWant + g) < 1e-9 || m.F > curve + 1e-9), `${what} @${fps}: through the air on the arc, falling at ${(-aWant).toFixed(2)} m/s^2 every frame (the world's ${g}${m.F > curve + 1e-9 ? ', flown slower for the clip' : ''}; worst ${accWorst.toExponential(1)} off, ${air.length} frames)`);
  // The flight's own seconds: the arc's rise and fall (or, where the clip's stretch at its quickest is longer, that).
  const want = Math.max(curve, m.S / CLIMB_TUNE.flightRateMax);
  ok(Math.abs(m.F - want) < 1e-9 && curve >= own - 1e-9, `${what} @${fps}: in the air for its arc's own ${curve.toFixed(4)} s (the plain arc's ${own.toFixed(4)}; flown ${m.F.toFixed(4)} s${m.F > curve + 1e-9 ? ': the clip\'s stretch at its quickest is longer' : ''})`);
  const end = frames.findIndex((f) => f.fly >= m.F);
  ok(end > 0 && Math.hypot(frames[end - 1].x - m.tx, frames[end - 1].y - m.ty, frames[end - 1].z - m.tz) > 1e-6 && frames.slice(end).every((f) => Math.hypot(f.x - m.tx, f.y - m.ty, f.z - m.tz) < 1e-9), `${what} @${fps}: on the new lip's hang place in the frame the flight ends and still after, short of it the frame before`);
  ok(frames.slice(end).every((f) => f.clock >= m.tT - 1e-9) && frames.slice(0, end).every((f) => f.clock < m.tT - 1e-9), `${what} @${fps}: the clip at its touch (${m.tT.toFixed(3)} s on the move's clock) in the very frame the body arrives, never before`);
  // The rig's clip: put at each frame's seek and run at its rate, it stands at the clock's own clip time at the frame's end.
  let rateWorst = 0;
  let fastest = 0;
  for (const f of frames) {
    if (!(f.seek === f.seek)) continue;
    const shown = f.seek + f.rate * dt;
    const parts = m.parts === 2;
    const want = parts ? (f.clock > m.d1 ? m.p2From + (f.clock - m.d1) : m.p1From + f.clock) : m.dir < 0 ? m.cd - f.clock : f.clock;
    rateWorst = Math.max(rateWorst, Math.abs(shown - want));
    if (f.fly > 0 && f.fly < m.F) fastest = Math.max(fastest, Math.abs(f.rate));
  }
  ok(rateWorst < 1e-9, `${what} @${fps}: the clip the rig shows stands at the move's clock every frame (worst ${rateWorst.toExponential(1)} s)`);
  ok(fastest <= CLIMB_TUNE.flightRateMax + 1e-9, `${what} @${fps}: its flight never played quicker than ${CLIMB_TUNE.flightRateMax} of its own rate (fastest ${fastest.toFixed(3)})`);
  // A hold eased: the rate inside the flight changes from frame to frame by no more than the ease's own slope allows.
  if (m.hm === 1) {
    let step = 0;
    // (Frames wholly inside the flight: the first one's step straddles the leave, played partly at the clip's own rate.)
    for (let k = 2; k < air.length; k++) if (air[k - 1].fly > dt * 1.01) step = Math.max(step, Math.abs(air[k].rate - air[k - 1].rate));
    const most = (m.ar * Math.PI * dt) / (2 * m.he) + 1e-9;
    ok(step <= most, `${what} @${fps}: waiting for the contact the clip slows into its hold and out of it eased, never stopped (its rate moves at most ${step.toFixed(4)} a frame, under ${most.toFixed(4)})`);
  }
  ok(frames.every((f) => f.clear), `${what} @${fps}: the body's capsule meets nothing that stands still at any frame of the move`);
  return { F: m.F };
}

resetClimbTune();
resetMoveTune();
ok(CLIMB_TUNE.hopFlight === 'arc' && CLIMB_TUNE.targetRoom === 'fit' && CLIMB_TUNE.dropMove === 'drop', 'the round ships the arc, the room under a target and the drop\'s own move');
ok(CLIMB_TUNE.flightGravity === 20.32, `the arc's gravity starts at the game's own on foot (Jedi Academy's 800 units: ${CLIMB_TUNE.flightGravity})`);
ok([DROP_PARTS.braced, DROP_PARTS.free, DROP_PARTS.catchBraced, DROP_PARTS.catchFree].every((id) => id in LEDGE_FACTS && handMoment(id, 'touch') === handMoment(id, 'touch')), "every clip of the owner's drop table is one the game asks the pack for, its moments known");

// ---- 1. hops sideways, braced and free -----------------------------------------------------------------------------------------
for (const [id, tune, words] of [['gap-side-1.5', {}, 'a braced hop sideways'], ['free-gap-side-3.0', { hopSide: 3.5 }, 'a free 3 m hop sideways']] as const) {
  const s = await standPiece(piece(id));
  const seconds: number[] = [];
  for (const fps of RATES) {
    resetClimbTune();
    tuneClimb(tune);
    const { b, w } = bodyAt(s, 'onA', fps);
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2.5, () => hangs(b));
    b.key('KeyE', false);
    runUntil(b, fps, 0.3, () => false);
    shimmy(s, b, w, 'KeyD', fps);
    b.key('KeyD', true);
    runUntil(b, fps, 2, () => b.ledge.cue >= 0.99);
    tap(b, 'Space', fps);
    b.key('KeyD', false);
    const frames = record(b, fps, 4);
    const r = arcChecks(frames, b, fps, words, false);
    seconds.push(r.F);
    const m = b.ledge.move;
    const dist = Math.hypot(m.tx - m.fx, m.ty - m.fy, m.tz - m.fz);
    if (id.startsWith('free')) {
      const lift = Math.sqrt((2 * 0.5) / CLIMB_TUNE.flightGravity) * 2;
      ok(r.F >= lift - 1e-9 && m.hm === 1, `${words} @${fps}: ${dist.toFixed(2)} m in ${r.F.toFixed(3)} s (${(dist / r.F).toFixed(1)} m/s), the time a 0.5 m rise and fall takes (${lift.toFixed(3)} s), never its clip's 0.1 s window (${((dist / 0.1)).toFixed(0)} m/s): the clip held for the contact`);
    }
    ok(hangs(b) && b.ledge.lip.ey > 0, `${words} @${fps}: hangs from the lip it hopped to`);
    b.physics.world.removeRigidBody(b.body);
  }
  ok(Math.max(...seconds) - Math.min(...seconds) < 0.01, `${words}: its flight alike at every rate (${seconds.map((v) => v.toFixed(4)).join(', ')})`);
}

// ---- 2. a hop up: it rises arcRise over the new lip's hang, then settles onto it -----------------------------------------------
{
  const s = await standPiece(piece('gap-updown-1.5'));
  for (const fps of RATES) {
    resetClimbTune();
    const { b, w } = bodyAt(s, 'onA', fps);
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
    const frames = record(b, fps, 4);
    arcChecks(frames, b, fps, 'a hop up', false);
    const m = b.ledge.move;
    const top = Math.max(...frames.map((f) => f.y));
    ok(Math.abs(top - (m.ty + CLIMB_TUNE.arcRise)) < 0.02, `a hop up @${fps}: rises to ${(top - m.ty).toFixed(3)} m over the new lip's hang (arcRise ${CLIMB_TUNE.arcRise}) and comes down onto it`);
    b.physics.world.removeRigidBody(b.body);
  }
}

// ---- 3. a drop to the lip beneath on its own move (item 4b) --------------------------------------------------------------------
/** A braced hang on gap-updown-1.5's upper lip (from the lower, a hop up), then a crouch tap: the frames of what that began. */
async function dropFrom(fps: number, tune: Record<string, unknown>): Promise<{ b: TestBody; frames: Frame[]; ids: Set<string> }> {
  const s = await standPiece(piece('gap-updown-1.5'));
  resetClimbTune();
  tuneClimb(tune);
  const { b, w } = bodyAt(s, 'onA', fps);
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
  runUntil(b, fps, 4, () => hangs(b) && b.ledge.move.kind === 'hop' && b.ledge.lip.ey > 3);
  runUntil(b, fps, 0.5, () => false);
  tap(b, 'ControlLeft', fps);
  const ids = new Set<string>();
  const frames = record(b, fps, 5);
  for (const f of frames) ids.add(f.id);
  return { b, frames, ids };
}
for (const fps of RATES) {
  const { b, frames, ids } = await dropFrom(fps, {});
  const m = b.ledge.move;
  ok(m.parts === 2 && ids.has(DROP_PARTS.braced) && ids.has(DROP_PARTS.catchBraced), `a drop @${fps}: the crouch's tap plays the drop's own two parts (${[...ids].join(', ')})`);
  arcChecks(frames, b, fps, 'a drop', true);
  const fall = Math.sqrt((2 * (m.fy - m.ty)) / CLIMB_TUNE.flightGravity);
  ok(Math.abs(m.F - Math.max(fall, m.S / CLIMB_TUNE.flightRateMax)) < 1e-9, `a drop @${fps}: falls from rest (${(m.fy - m.ty).toFixed(2)} m in ${m.F.toFixed(4)} s, the fall's own ${fall.toFixed(4)})`);
  const join = frames.findIndex((f) => f.id === DROP_PARTS.catchBraced);
  ok(join > 0 && frames[join].clock > m.d1 && frames[join - 1].clock <= m.d1, `a drop @${fps}: the catch begins in the very frame the clock crosses the join (${m.d1.toFixed(2)} s)`);
  ok(hangs(b) && b.ledge.lip.ey < 3 && b.ledge.dropMoves === 1, `a drop @${fps}: hangs from the lip beneath`);
  b.physics.world.removeRigidBody(b.body);
}
for (const fps of [30, 240]) {
  const r = await dropFrom(fps, { dropMove: 'reverse' });
  ok(r.b.ledge.move.dir === -1 && r.ids.has(LEDGE_ROLES.braced.hopUp ?? '') && r.ids.size === 1, `'reverse' @${fps}: the drop plays the hop up backward`);
  arcChecks(r.frames, r.b, fps, "a 'reverse' drop", true);
  ok(hangs(r.b) && r.b.ledge.lip.ey < 3, `'reverse' @${fps}: hangs from the lip beneath`);
  r.b.physics.world.removeRigidBody(r.b.body);
  const h = await dropFrom(fps, { dropMove: 'hop' });
  ok(h.b.ledge.move.parts === 0 && h.b.ledge.dropMoves === 0 && [...h.ids].every((id) => id === LEDGE_ROLES.braced.hopLeft || id === LEDGE_ROLES.braced.hopRight), `'hop' @${fps}: the drop plays the side hop as Smoothness II had it (${[...h.ids].join(', ')})`);
  ok(hangs(h.b) && h.b.ledge.lip.ey < 3, `'hop' @${fps}: and hangs from the lip beneath`);
  h.b.physics.world.removeRigidBody(h.b.body);
}

// ---- 4. item 2: a lip whose hang stands in the ground is no target --------------------------------------------------------------
/**
 * A wall 2 m tall standing on a base slab whose top is 5 cm over the terrain's heightfield (as the course's floors stand over
 * the world's ground), the slab running 0.3 m out in front of the wall's face: hanging from the wall's lip, a crouch tap looks
 * for a lip beneath, and the slab's front edge is one, whose hang stands two metres into the ground.
 */
async function slabDrop(fps: number, room: string): Promise<{ b: TestBody; target: number; refused: number; phase: number; under: boolean }> {
  resetClimbTune();
  resetMoveTune();
  tuneClimb({ targetRoom: room });
  const p = await makePhysics();
  heightChunk(p, -32, -32, () => 0);
  box(p, [-3, -0.5, 0], [3, 0.05, 3]);
  box(p, [-3, 0.05, 0.3], [3, 2.05, 1.3]);
  p.stepOnce();
  (p as unknown as { acc: number }).acc = 0;
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(0, 0.45, -0.1);
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
  const before = L.groundRefused;
  // (The drop's own look, as the cue's search makes it: where a hang under the slab's edge would stand, if anywhere.)
  b.key('ControlLeft', true);
  b.frame(1 / fps);
  b.key('ControlLeft', false);
  const target = L.move.ty;
  const phase = L.phase;
  const refused = L.groundRefused - before;
  let under = false;
  runUntil(b, fps, 3, () => {
    if (L.holding && b.pos.y < -0.5) under = true;
    return L.phase === LEDGE_NONE && b.grounded;
  });
  b.physics.world.removeRigidBody(b.body);
  return { b, target, refused, phase, under };
}
for (const fps of RATES) {
  const fit = await slabDrop(fps, 'fit');
  ok(fit.refused > 0 && fit.phase === LEDGE_NONE && !fit.under && fit.target > -0.5, `the slab's edge @${fps}: under 'fit' no hang stands in the ground: ${fit.refused} hangs under the slab's edge refused for the ground (none taken as a hop's target: the last one set ${fit.target.toFixed(2)} m), and the tap lets go (phase ${fit.phase})`);
  const none = await slabDrop(fps, 'none');
  ok(none.refused === 0 && none.target < -1, `the slab's edge @${fps}: under 'none' (Smoothness II) the drop's look takes the hang under the slab's edge, its feet ${none.target.toFixed(2)} m, under the ground (a shape test finds nothing there; its way then meets the slab)`);
}

// ---- 5. the course's lips: every grab and hop taken as before -----------------------------------------------------------------
{
  // The course's own grabs and hops, each piece at every rate, with 'fit' and with 'none': the same grabs and hops reached.
  const ids = ['lip-braced-2.4', 'lip-free-2.4', 'gap-side-1.0', 'gap-side-1.5', 'gap-updown-1.0', 'gap-updown-1.5', 'gap-diag-1.5', 'steps-0.35', 'slope-25', 'ladder-1', 'shelves-1.5'];
  let compared = 0;
  for (const id of ids) {
    for (const fps of RATES) {
      const out: string[] = [];
      for (const room of ['fit', 'none']) {
        resetClimbTune();
        tuneClimb({ targetRoom: room });
        const s = await standPiece(piece(id));
        const start = s.piece.starts.some((q) => q.name === 'onA') ? 'onA' : 'stand';
        const { b, w } = bodyAt(s, start, fps);
        b.key('KeyE', true);
        tap(b, 'Space', fps);
        runUntil(b, fps, 2.5, () => hangs(b));
        b.key('KeyE', false);
        const words = [hangs(b) ? `hung at ${b.ledge.lip.ey.toFixed(2)}` : 'no grab'];
        if (hangs(b)) {
          const d = shimmy(s, b, w, 'KeyD', fps, 3);
          words.push(`D ${d.moved.toFixed(2)}`);
          for (const k of ['KeyD', 'KeyW']) {
            b.forward.set(Math.sin(b.heading), 0, Math.cos(b.heading));
            b.right.set(-Math.cos(b.heading), 0, Math.sin(b.heading));
            b.key(k, true);
            runUntil(b, fps, 1.5, () => b.ledge.cue >= 0.99 || !hangs(b));
            if (b.ledge.cue >= 0.99) tap(b, 'Space', fps);
            b.key(k, false);
            runUntil(b, fps, 3, () => hangs(b) || !b.ledge.holding);
            words.push(hangs(b) ? `${k} ${b.ledge.lip.ey.toFixed(2)}` : `${k} let go`);
          }
        }
        out.push(words.join(' '));
        b.physics.world.removeRigidBody(b.body);
      }
      assert.equal(out[0], out[1], `${id} @${fps}: ${out[0]} | 'none' ${out[1]}`);
      compared++;
    }
  }
  ok(compared === ids.length * RATES.length, `every grab, shimmy and hop on ${ids.length} of the course's pieces at every rate the same under 'fit' as under 'none' (${compared} drives)`);
}

// ---- 6. this round's switches at their other setting: none of it --------------------------------------------------------------
{
  const s = await standPiece(piece('gap-side-1.5'));
  for (const fps of [30, 240]) {
    resetClimbTune();
    climbSmooth3Before();
    const { b, w } = bodyAt(s, 'onA', fps);
    b.key('KeyE', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2.5, () => hangs(b));
    b.key('KeyE', false);
    runUntil(b, fps, 0.3, () => false);
    shimmy(s, b, w, 'KeyD', fps);
    b.key('KeyD', true);
    runUntil(b, fps, 2, () => b.ledge.cue >= 0.99);
    tap(b, 'Space', fps);
    b.key('KeyD', false);
    const frames = record(b, fps, 4);
    ok(frames.length > 0 && !b.ledge.move.arc && b.ledge.move.timed && frames.every((f) => !(f.seek === f.seek)), `with Smoothness III's switches at their other setting @${fps}: Smoothness II's timed hop, no arc and no seek handed to the rig`);
    b.physics.world.removeRigidBody(b.body);
  }
}
note(`the arc's start: arcRise ${CLIMB_TUNE.arcRise} m, holdEase ${CLIMB_TUNE.holdEase} s, flightRateMin ${CLIMB_TUNE.flightRateMin}, flightRateMax ${CLIMB_TUNE.flightRateMax} (the owner's sliders)`);
resetClimbTune();
resetMoveTune();
console.log(`smooth3Flight: ${checks} checks passed`);
