// The sky's one time (the GPU port's pass 2, wave 1, the design's 2.11): `DayCycle.count`, an unbroken day count that
// moves with the time by the very step or ease the time takes, so nothing that reads the sky in days ever jumps a day
// where the clock's day turns over. The game's own `DayCycle` and shared clock under node:
//   - with no server it walks with the time across midnight and the client's 06:00 without a jump, its fraction the time;
//   - held (the console's write of the time, `__debug.sky('dawn')`'s) it follows the write the shorter way round and walks on;
//   - paused it stands; under the fast-forward key it runs at the fast rate;
//   - with a server it is the shared clock's own unfloored count where the time is taken outright, so two browsers share it
//     to the day, and it eases with the time across a turn of the day;
//   - another day length (a server's own) moves nothing: it counts days.
import assert from 'node:assert/strict';
import { GAME_DAY_SECONDS, dayTune, sharedClock } from '../../../src/world/sharedClock.ts';
import { DayCycle } from '../../../src/world/daycycle.ts';

let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const frac = (x: number): number => x - Math.floor(x);
/** The count's fraction against the time, the short way round the clock face. */
const off = (d: DayCycle): number => {
  const e = frac(d.count) - d.time;
  return Math.abs(e - Math.round(e));
};
const EPOCH = 1_700_000_000_000;

function freshDay(): DayCycle {
  const d = new DayCycle(0, 1);
  d.phase = 0;
  return d;
}

// ---------------------------------------------------------------- no server
{
  let wall = EPOCH;
  sharedClock.wall = () => wall;
  sharedClock.none();
  const day = freshDay();
  const dt = 1 / 60;
  ok(day.count === day.time, `a fresh day's count is its time (${day.count})`);
  // Walk to just before midnight, then over it and on over the client's 06:00.
  day.time = 0.9995;
  day.update(dt, false);
  const c0 = day.count;
  let worstJump = 0;
  let worstOff = 0;
  let last = day.count;
  const frames = Math.round(GAME_DAY_SECONDS * 0.3 * 60);
  for (let i = 0; i < frames; i++) {
    wall += dt * 1000;
    day.update(dt, false);
    worstJump = Math.max(worstJump, Math.abs(day.count - last - dt / GAME_DAY_SECONDS));
    worstOff = Math.max(worstOff, off(day));
    last = day.count;
  }
  ok(day.time > 0.29 && day.time < 0.31 && Math.abs(day.count - c0 - frames * (dt / GAME_DAY_SECONDS)) < 1e-9, `with no server it walks across midnight and 06:00 with the time, a step a frame (${frames} frames: ${(day.count - c0).toFixed(6)} days)`);
  ok(worstJump < 1e-12 && worstOff < 1e-9, `never a jump (worst ${worstJump.toExponential(1)} days off a step) and its fraction is the time (worst ${worstOff.toExponential(1)})`);
  ok(Math.floor(day.count) === Math.floor(c0) + 1, `and it has counted the day turned over (${Math.floor(c0)} to ${Math.floor(day.count)})`);

  // Held: a write by hand (the console's, `__debug.sky('dawn')`'s) is followed the shorter way round.
  /** A step in days the short way round the clock face. */
  const shortWay = (d: number): number => d - Math.floor(d + 0.5);
  const before = day.count;
  const t0 = day.time;
  day.time = 0.2; // from about 0.30: back a tenth of a day
  day.update(dt, false);
  ok(day.held && Math.abs(day.count - (before + shortWay(0.2 - t0) + dt / GAME_DAY_SECONDS)) < 1e-9 && off(day) < 1e-9, `a time written by hand holds the day and the count follows it the shorter way (back ${(before - day.count).toFixed(4)} days)`);
  const held = day.count;
  const t1 = day.time;
  day.time = 0.95; // from about 0.2 the shorter way to 0.95 is back over midnight, a quarter of a day
  day.update(dt, false);
  ok(Math.abs(day.count - (held + shortWay(0.95 - t1) + dt / GAME_DAY_SECONDS)) < 1e-9 && shortWay(0.95 - t1) < 0 && off(day) < 1e-9 && Math.floor(day.count) === Math.floor(held) - 1, `and a write across midnight goes the shorter way too, back over it (back ${(held - day.count).toFixed(4)} days, the count a day lower, its fraction the time)`);
  let lastH = day.count;
  let jumpH = 0;
  // Some 450 seconds of the game's day: from 0.95 over midnight.
  for (let i = 0; i < 450 * 60; i++) {
    wall += dt * 1000;
    day.update(dt, false);
    jumpH = Math.max(jumpH, Math.abs(day.count - lastH - dt / GAME_DAY_SECONDS));
    lastH = day.count;
  }
  ok(day.time < 0.5 && jumpH < 1e-12 && off(day) < 1e-9, `held, it walks on with the day over midnight without a jump (time ${day.time.toFixed(4)})`);

  // Paused (the creator's hour): it stands.
  day.paused = true;
  const p = day.count;
  for (let i = 0; i < 120; i++) day.update(dt, false);
  ok(day.count === p, 'paused, it stands');
  day.paused = false;

  // The fast-forward key: at the fast rate.
  const fb = day.count;
  for (let i = 0; i < 60; i++) {
    wall += dt * 1000;
    day.update(dt, true);
  }
  ok(Math.abs(day.count - fb - (60 * dt) / dayTune.fastDaySeconds) < 1e-9 && off(day) < 1e-9, `under the fast-forward key it runs at the fast rate (${(day.count - fb).toFixed(4)} days in a second)`);

  // Another day length: it counts days, whatever their length.
  day.dayLengthSeconds = 1800;
  const lb = day.count;
  for (let i = 0; i < 600; i++) {
    wall += dt * 1000;
    day.update(dt, false);
  }
  ok(Math.abs(day.count - lb - (600 * dt) / 1800) < 1e-9, 'another day length moves nothing: a 30-minute day counts its own days');
  day.dayLengthSeconds = GAME_DAY_SECONDS;
}

// ---------------------------------------------------------------- a server
{
  let wall = EPOCH;
  sharedClock.wall = () => wall;
  sharedClock.none();
  sharedClock.hail(wall);
  const day = freshDay();
  day.update(0, false);
  const want = { shared: 0, wall: 0 };
  sharedClock.dayCountIn(day, want);
  ok(Math.abs(day.count - want.shared) < 1e-6 && off(day) < 1e-9, `with a server, taken outright behind the screen, it is the shared clock's own count (${day.count.toFixed(4)} against ${want.shared.toFixed(4)})`);
  // A second browser whose count stood anywhere at all (its time not written: a hand's write holds the day off the clock).
  const other = freshDay();
  other.count = 12.1;
  other.update(0, false);
  ok(Math.abs(other.count - day.count) < 1e-6, 'and a second browser on the same clock has the same count to the day, whatever it held before');
  // Walk the shared day across its turn, the day easing after it.
  const dt = 1 / 60;
  let last = day.count;
  let worst = 0;
  const frames = Math.round(GAME_DAY_SECONDS * 1.05 * 60);
  for (let i = 0; i < frames; i++) {
    wall += dt * 1000;
    day.update(dt, false);
    const step = day.count - last;
    worst = Math.max(worst, Math.abs(step));
    last = day.count;
  }
  sharedClock.dayCountIn(day, want);
  ok(worst < (4 * dt) / GAME_DAY_SECONDS && Math.abs(day.count - want.shared) < 1e-3 && off(day) < 1e-9, `over a whole shared day and its turn it eases with the time, never a step larger than the ease's (worst ${(worst / (dt / GAME_DAY_SECONDS)).toFixed(2)} steps), still the shared count (${day.count.toFixed(4)} against ${want.shared.toFixed(4)})`);
  sharedClock.none();
}

console.log(`\ndayCount: ${checks} checks passed`);
