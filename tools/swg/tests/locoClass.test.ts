// The speed class the keys ask for and the stamina that pays for it (src/anim/locoClass.ts): Shift's holds, taps and
// drops, run at 20, 30, 60 and 144 frames a second against one script of key moments, and the pool drained and
// regained at the same rates. Each must come to the same answer whatever the frame rate.
import assert from 'node:assert/strict';
import { JOG, RUN, ShiftClass, SPRINT, Stamina, staminaRate } from '../../../src/anim/locoClass.ts';
import { dirOf } from '../../../src/anim/locoTable.ts';
import { LOCO_TUNE_SHIPPED, type LocoTune } from '../../../src/anim/locoTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const T = (): LocoTune => JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED)) as LocoTune;
const RATES = [30, 60, 144];

/**
 * Shift down between each pair of moments (seconds), stepped at a frame rate: a frame reads whether the key is down
 * as it ends and whether it went down during it, as the game's input does. The class at each moment asked about is
 * the class after the last frame that ended at or before it.
 */
function runShift(fps: number, downs: [number, number][], asks: number[], tune: LocoTune, total: number): number[] {
  const m = new ShiftClass();
  const out: number[] = [];
  let next = 0;
  let cls = JOG;
  const frames = Math.round(total * fps);
  for (let f = 1; f <= frames; f++) {
    const t0 = (f - 1) / fps, t1 = f / fps;
    while (next < asks.length && asks[next] < t1 - 1e-9) {
      out.push(cls);
      next++;
    }
    const held = downs.some(([a, b]) => a <= t1 + 1e-9 && t1 < b - 1e-9);
    const pressed = downs.some(([a]) => a > t0 + 1e-9 && a <= t1 + 1e-9);
    cls = m.step(t1, held, pressed, tune);
  }
  while (next++ < asks.length) out.push(cls);
  return out;
}

// ---- Shift ---------------------------------------------------------------------------------------------------------------
{
  const tune = T();
  // Every key moment and every moment asked about is a third or two of a second apart from every drop, so no frame
  // rate's own grid lands one on the other side of it.
  // Held 1 to 3: the run. Let go at 3: the jog at 3.5. Held 5 to 6, let go, pressed again at 6.2 (inside the tap's
  // 0.35): the sprint. Let go at 8: the run at 8.5, the jog at 9. Held 11 to 12, pressed again at 12.45 (outside the
  // tap): the run only. A press at 14 let go at once (a tap by itself): the run for half a second.
  const downs: [number, number][] = [[1, 3], [5, 6], [6.2, 8], [11, 12], [12.45, 13.2], [14, 14.02]];
  const asks = [0.5, 1.2, 2.9, 3.3, 3.7, 5.2, 6.1, 6.4, 7.9, 8.3, 8.7, 9.2, 11.5, 12.3, 12.6, 13.4, 13.9, 14.3, 14.7, 15.5];
  const want = [JOG, RUN, RUN, RUN, JOG, RUN, RUN, SPRINT, SPRINT, SPRINT, RUN, JOG, RUN, RUN, RUN, RUN, JOG, RUN, JOG, JOG];
  const got = RATES.map((fps) => runShift(fps, downs, asks, tune, 16));
  for (let i = 0; i < RATES.length; i++) assert.deepEqual(got[i], want, `at ${RATES[i]} frames a second: ${got[i].join('')} for ${want.join('')}`);
  ok(true, `Shift held is the run, let go the jog after the drop's delay, pressed again inside the tap's window the sprint, which drops a class each delay; outside the window only the run: the same ${asks.length} answers at ${RATES.join(', ')} frames a second`);

  // A press that began and ended inside one frame is still a press (the input keeps it for the frame).
  const m = new ShiftClass();
  ok(m.step(1, false, true, tune) === RUN && m.step(1.2, false, false, tune) === RUN && m.step(1.6, false, false, tune) === JOG, 'a tap begun and ended inside one frame is the run for the drop\'s delay');
  // Two taps: the second inside the window raises to the sprint.
  const m2 = new ShiftClass();
  m2.step(1, false, true, tune);
  ok(m2.step(1.2, true, true, tune) === SPRINT, 'and a second tap inside the window is the sprint');
  // The sprint is the top.
  m2.step(1.3, false, false, tune);
  ok(m2.step(1.4, true, true, tune) === SPRINT, 'a third press is still the sprint: nothing is faster');
  // One long frame after a let-go drops every class it covers.
  m2.step(2, false, false, tune);
  ok(m2.step(9, false, false, tune) === JOG, 'a frame longer than both delays drops both classes at once');
  // The dials are read live.
  const slow = T();
  slow.shift.dropDelay = 2;
  const g = runShift(60, [[1, 2]], [2.5, 3.9, 4.1], slow, 5);
  ok(g.join() === [RUN, RUN, JOG].join(), 'the drop\'s delay is the tune\'s: at 2 s the run holds two seconds after Shift is let go');
  const wide = T();
  wide.shift.tapWindow = 0;
  ok(runShift(60, [[1, 2], [2.2, 3]], [2.6], wide, 4)[0] === RUN, 'and with the tap\'s window at nought a second press is only the run');
  // Capped (the sprint refused for want of stamina) it does not come back by itself.
  const c = new ShiftClass();
  c.step(1, true, true, tune);
  c.step(1.5, false, false, tune);
  c.step(1.6, true, true, tune);
  c.cap(RUN);
  ok(c.step(3, true, false, tune) === RUN, 'a sprint capped to the run stays the run while Shift is held');
  c.reset();
  ok(c.cls === JOG, 'and a reset is the jog');
  // Capped at the let-go too: a quick second press after a capped sprint is one over the run, never two.
  const c2 = new ShiftClass();
  c2.step(1, true, true, tune);
  c2.step(1.5, false, false, tune);
  c2.step(1.6, true, true, tune);
  c2.step(2, false, false, tune);
  c2.cap(RUN);
  ok(c2.step(2.1, true, true, tune) === SPRINT && c2.cls === SPRINT, 'a sprint capped after it was let go is raised from the run by a quick second press');

  // A let-go and a press inside one frame: the key was down as the last frame ended, went down during this one and is
  // down as it ends. That is a double tap all the same, at a frame rate where the two fall in one frame as at one
  // where they fall in two.
  const tap: [number, number][] = [[1, 1.505], [1.53, 3]];
  const fast = [20, 30, 60, 144].map((fps) => runShift(fps, tap, [2], tune, 3)[0]);
  ok(fast.every((v) => v === SPRINT), `Shift let go and pressed again 25 ms later is the sprint whether the two fall inside one frame (20 and 30 frames a second) or across two (60 and 144): ${fast.join(' ')}`);
  const one = new ShiftClass();
  one.step(1, true, true, tune);
  ok(one.step(1.05, true, true, tune) === SPRINT, 'held, and pressed again inside the frame while still held as it ends: the let-go came first, so it is the sprint');
  const three = new ShiftClass();
  three.step(1, true, true, tune);
  ok(three.step(1.05, false, true, tune) === SPRINT && three.step(1.4, false, false, tune) === SPRINT && three.step(1.6, false, false, tune) === RUN, 'held, then let go, pressed and let go again inside one frame: the sprint, which then drops a class each delay from that frame');

  // The tap's window is its own number: it is counted from the let-go and judged against the class Shift was let go
  // at, so it is not cut short by a drop that has already come.
  const long = T();
  long.shift.tapWindow = 1;
  long.shift.dropDelay = 0.5;
  ok(runShift(60, [[1, 2], [2.7, 4]], [2.6, 3], long, 4).join() === [JOG, SPRINT].join(), 'with the window at a second and the drop at half of one, a second press 0.7 s after the let-go is the sprint although the class had dropped to the jog meanwhile');
  ok(runShift(60, [[1, 2], [3.2, 4]], [3.5], long, 4)[0] === RUN, 'and past the window only the run');
  const quick = T();
  quick.shift.dropDelay = 0.2;
  ok(runShift(60, [[1, 2], [2.3, 4]], [3], quick, 4)[0] === SPRINT && runShift(60, [[1, 2], [2.4, 4]], [3], quick, 4)[0] === RUN, 'with the drop shortened to a fifth of a second the window is still 0.35 s: a press at 0.3 s is the sprint, at 0.4 s the run');

  // `advance`, which the body's frame calls, is `step` on a clock of its own.
  const a = new ShiftClass(), b = new ShiftClass();
  let same = true;
  let t = 0;
  const keys: [boolean, boolean][] = [[false, false], [true, true], [true, false], [true, false], [false, false], [true, true], [true, false], [false, false], [false, false], [false, false], [false, false], [false, true], [false, false]];
  for (let i = 0; i < 400; i++) {
    const [held, pressed] = keys[(i * 7) % keys.length];
    t += 1 / 60;
    if (a.advance(1 / 60, held, pressed, tune) !== b.step(t, held, pressed, tune)) same = false;
  }
  ok(same, 'a frame stepped by its own seconds (`advance`, the game\'s way) gives the class the same keys give on a clock handed in');
}

// ---- stamina -------------------------------------------------------------------------------------------------------------
{
  const tune = T();
  const F = dirOf(1, 0), B = dirOf(-1, 0), L = dirOf(0, -1), FL = dirOf(1, -1), BR = dirOf(-1, 1), R = dirOf(0, 1), FR = dirOf(1, 1), BL = dirOf(-1, -1);
  const r = (dir: number, cls: number, afloat = false) => staminaRate(tune, dir, cls, afloat);
  ok(r(F, 4) === -12 && r(F, 3) === 0 && r(F, 2) === 4 && r(F, 1) === 10 && r(-1, 2) === 10, 'forward: the sprint burns 12 a second, the run holds, the jog regains 4, the walk and standing 10');
  ok(r(B, 1) === 10 && r(B, 2) === 10 && r(B, 3) === 10 && r(BR, 3) === 10, 'backward regains at the standard rate at any class, a backward diagonal too');
  ok(r(L, 1) === 10 && r(L, 2) === 0 && r(L, 3) === 0 && r(FL, 2) === 0 && r(FL, 1) === 10, 'sideways and the forward diagonals neither spend nor regain from the jog up, and regain at a walk');
  ok(r(F, 1, true) === 0 && r(-1, 2, true) === 0 && r(F, 3, true) === 0 && r(B, 2, true) === 0, 'in the air and swimming nothing is regained');
  ok(r(F, 4, true) === -12, 'and what a class spends it spends in the air too: a sprint kept up by hopping costs what the sprint costs');
  // Every rate is a dial of its own: each given a number no other has, and each read where the brief has it.
  const each = T();
  Object.assign(each.stamina, { sprint: -13, run: -1.5, jog: 3.25, walk: 9.5, back: 7.25, side: -0.75, sideWalk: 5.5, air: 2.125 });
  const e = (dir: number, cls: number, afloat = false) => staminaRate(each, dir, cls, afloat);
  ok(e(-1, 2) === 9.5 && e(F, 1) === 9.5 && e(F, 2) === 3.25 && e(F, 3) === -1.5 && e(F, 4) === -13, 'standing and the forward walk at the walk\'s rate, then the jog\'s, the run\'s and the sprint\'s');
  ok([B, BL, BR].every((d) => e(d, 1) === 7.25 && e(d, 2) === 7.25 && e(d, 3) === 7.25), 'backward, straight or to a side, at the backward rate at every class, the walk included');
  ok([L, R, FL, FR].every((d) => e(d, 1) === 5.5 && e(d, 2) === -0.75 && e(d, 3) === -0.75), 'sideways and the forward diagonals at the sideways walk\'s own rate at the walk (a dial apart from the forward walk\'s, so it can be the brief\'s nought), and the sideways rate from the jog up');
  ok(e(F, 1, true) === 2.125 && e(-1, 2, true) === 2.125 && e(B, 3, true) === 2.125 && e(L, 1, true) === 2.125 && e(F, 2, true) === 2.125 && e(F, 3, true) === -1.5 && e(L, 2, true) === -0.75 && e(F, 4, true) === -13, 'the air\'s rate is the most the pool regains off the ground; a rate under it is kept');
  // The body's own step works the rate out itself (no number crosses a call on a frame): the same pool, to the bit.
  let apart = 0;
  for (const tn of [tune, each]) {
    for (let dir = -1; dir < 8; dir++) {
      for (let cls = 1; cls <= 4; cls++) {
        for (const afloat of [false, true]) {
          const x = new Stamina(100), y = new Stamina(100);
          x.step(0.25, -70, 100, tn);
          y.step(0.25, -70, 100, tn);
          x.step(0.4, staminaRate(tn, dir, cls, afloat), 100, tn);
          y.stepFor({ dt: 0.4, pool: 100 }, tn, dir, cls, afloat);
          if (!Object.is(x.value, y.value) || x.tired !== y.tired) apart++;
        }
      }
    }
  }
  ok(apart === 0, 'a frame stepped for a way and a class (`stepFor`, the game\'s way) leaves the very pool that the rate handed in leaves, for every way, class, tune and the air');
  const rested = new Stamina(100), stood = new Stamina(100);
  rested.step(1, -50, 100, each);
  stood.step(1, -50, 100, each);
  rested.rest(0.5, 100, each);
  stood.step(0.5, staminaRate(each, -1, 2, false), 100, each);
  ok(Object.is(rested.value, stood.value) && rested.value === 54.75, 'and a body off its feet altogether (riding, flying) regains as standing does');

  /** A script of (seconds, way, class) legs, stepped at a frame rate; the class is held to the jog while tired, as the body's is. */
  const run = (fps: number, legs: [number, number, number][]): { v: number; tired: boolean; firstTired: number; rested: number } => {
    const s = new Stamina(tune.stamina.pool);
    let t = 0, firstTired = -1, rested = -1;
    for (const [seconds, dir, cls] of legs) {
      const n = Math.round(seconds * fps);
      for (let i = 0; i < n; i++) {
        const was = s.tired;
        s.step(1 / fps, staminaRate(tune, dir, s.tired ? Math.min(cls, 2) : cls, false), tune.stamina.pool, tune);
        t += 1 / fps;
        if (s.tired && !was && firstTired < 0) firstTired = t;
        if (!s.tired && was && rested < 0) rested = t;
      }
    }
    return { v: s.value, tired: s.tired, firstTired, rested };
  };
  // Sprint 5 s (100 to 40), run 2 s (holds), jog 3 s (to 52), walk 2 s (to 72).
  const a = RATES.map((fps) => run(fps, [[5, F, 4], [2, F, 3], [3, F, 2], [2, F, 1]]));
  ok(a.every((x) => Math.abs(x.v - 72) < 1e-6 && !x.tired), `five seconds of sprint, two of run, three of jog and two of walk leave 72 of 100 at ${RATES.join(', ')} frames a second (${a.map((x) => x.v.toFixed(4)).join(', ')})`);
  // Sprint until empty: tired at 100 / 12 s; then the tired jog regains 4 a second, and the body is rested at 30.
  const b = RATES.map((fps) => run(fps, [[12, F, 4], [9, F, 2]]));
  ok(b.every((x) => Math.abs(x.firstTired - 100 / 12) < 1 / 30 + 1e-6), `a sprint from full empties the pool in 8.33 s (${b.map((x) => x.firstTired.toFixed(3)).join(', ')} s), to within a frame`);
  // Emptied at 8.33 s; 3.67 s of the tired jog more; then 30 points take 7.5 s: rested at about 15.83 s.
  ok(b.every((x) => Math.abs(x.rested - (100 / 12 + 30 / 4)) < 1 / 30 + 0.06), `tired until the pool is back to 30% of itself, 7.5 s of the tired jog later (${b.map((x) => x.rested.toFixed(3)).join(', ')} s)`);
  ok(Math.max(...b.map((x) => x.v)) - Math.min(...b.map((x) => x.v)) < 0.2, `and the pool after it is the same to a fifth of a point whatever the frame rate (${b.map((x) => x.v.toFixed(3)).join(', ')})`);
  // Honest: with the tired line taken out the body would run again at once.
  const s = new Stamina(100);
  s.step(1, -100, 100, tune);
  ok(s.tired && s.value === 0, 'emptied, the body is tired');
  s.step(7.4, 4, 100, tune);
  ok(s.tired && Math.abs(s.value - 29.6) < 1e-9, 'still tired a shade under the share');
  s.step(0.2, 4, 100, tune);
  ok(!s.tired, 'and rested once it is back to it');
  // The bar: up while the pool is not full and for the tune's moment after.
  const bar = new Stamina(100);
  ok(!bar.shown(100, tune), 'the bar is down on a full pool that was never spent');
  bar.step(0.5, -12, 100, tune);
  ok(bar.shown(100, tune), 'up as soon as the pool is spent from');
  // In sixtieths from here: the moment counts from the frame the pool is full.
  const frames = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 60); i++) bar.step(1 / 60, 10, 100, tune); };
  frames(0.6);
  ok(bar.value === 100 && bar.shown(100, tune), 'still up the moment it is full again');
  frames(tune.stamina.linger - 0.1);
  ok(bar.shown(100, tune), 'and through the tune\'s moment');
  frames(0.2);
  ok(!bar.shown(100, tune), 'then down');
  // A bigger pool (what progression may give) keeps the share.
  const big = new Stamina(200);
  big.step(1, -500, 200, tune);
  big.step(14.9, 4, 200, tune);
  ok(big.tired && big.value < 60, 'a pool of 200 is tired until 60');
  big.step(0.2, 4, 200, tune);
  ok(!big.tired, 'and rested there');
  big.fill(200);
  ok(big.value === 200 && !big.tired && !big.shown(200, tune), 'a respawn fills it, rested, the bar down');
}

console.log(`\n${checks} checks passed`);
