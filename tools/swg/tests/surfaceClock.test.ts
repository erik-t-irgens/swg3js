// The flip-book clock, checked without a browser: the fixed-time loop, the drawn times of the
// random switcher (one draw per frame), the ping-pong turn at both ends, a long gap taken as one
// step, the random frame never repeating itself, and the fractional part the scrolls use.
import assert from 'node:assert/strict';
import { frac, makeClock, stepClock, type FlipMode } from '../../../src/world/surfaceClock.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const never = () => {
  throw new Error('rng called for a fixed time');
};

// DTST 8 x 0.1: frames 0, 0, 3 and 0 at 0, 0.05, 0.35 and 0.85.
{
  const c = makeClock(8, 'time', [0.1, 0.1]);
  const at = (t: number) => {
    stepClock(c, t, never);
    return c.frame;
  };
  ok(at(0) === 0, 'time: frame 0 at t = 0 (the first step starts the clock)');
  ok(at(0.05) === 0, 'time: frame 0 at t = 0.05');
  ok(at(0.35) === 3, 'time: frame 3 at t = 0.35');
  ok(at(0.85) === 0, 'time: frame 0 again at t = 0.85 (eight frames of 0.1 s loop)');
  ok(c.nextAt > 0.85, 'time: the next change is in the future');
}

// random [1, 2]: every second with rng 0, about every two with rng 0.999, one draw per change.
for (const [value, every] of [[0, 1], [0.999, 1.999]] as const) {
  let calls = 0;
  const rng = () => {
    calls++;
    return value;
  };
  const c = makeClock(6, 'random', [2, 1]);
  ok(c.min === 1 && c.max === 2, `random: the range is sorted (min ${c.min}, max ${c.max})`);
  const changes: number[] = [];
  const dt = 0.01;
  for (let i = 0; i <= 1000; i++) {
    const t = i * dt;
    if (stepClock(c, t, rng)) changes.push(t);
  }
  const gaps = changes.slice(1).map((t, i) => t - changes[i]);
  ok(changes.length > 3 && gaps.every((g) => Math.abs(g - every) <= dt + 1e-9), `random with rng ${value}: a change every ${every} s (${changes.length} changes)`);
  ok(calls === changes.length + 1, `random with rng ${value}: one draw per change plus the first frame's (${calls} draws, ${changes.length} changes)`);
}

// pingpong, count 4: 0,1,2,3,2,1,0,1; count 1 never changes; count 2 alternates.
{
  const c = makeClock(4, 'pingpong', [0.2, 0.2]);
  const seen: number[] = [];
  for (let i = 0; i < 8; i++) {
    stepClock(c, i * 0.2 + 1e-9, Math.random);
    seen.push(c.frame);
  }
  ok(seen.join(',') === '0,1,2,3,2,1,0,1', `pingpong over four frames plays forward then back (${seen.join(',')})`);
  const one = makeClock(1, 'pingpong', [0.2, 0.2]);
  let changed = false;
  for (let i = 0; i < 10; i++) changed = stepClock(one, i * 0.2, Math.random) || changed;
  ok(!changed && one.frame === 0, 'pingpong with one frame never changes');
  const two = makeClock(2, 'pingpong', [0.2, 0.2]);
  const alt: number[] = [];
  for (let i = 0; i < 6; i++) {
    stepClock(two, i * 0.2 + 1e-9, Math.random);
    alt.push(two.frame);
  }
  ok(alt.join(',') === '0,1,0,1,0,1', `pingpong with two frames alternates (${alt.join(',')})`);
}

// A jump of 100 s steps once, and the next change is in the future.
for (const mode of ['time', 'random', 'pingpong'] as FlipMode[]) {
  const c = makeClock(8, mode, [0.1, 0.1]);
  stepClock(c, 0, Math.random);
  stepClock(c, 0.15, Math.random);
  const before = c.frame;
  const changed = stepClock(c, 100.15, Math.random);
  ok(changed && c.frame === before + 1, `${mode}: a jump of 100 s steps once (${before} -> ${c.frame})`);
  ok(c.nextAt > 100.15, `${mode}: after the jump the next change is in the future (${c.nextAt.toFixed(3)})`);
}

// A gap within one cycle takes every step in it, never more than the frame count.
{
  const c = makeClock(8, 'time', [0.1, 0.1]);
  stepClock(c, 0, never);
  stepClock(c, 0.79, never);
  ok(c.frame === 7, `time: a gap of 0.79 s takes the seven steps in it (frame ${c.frame})`);
}

// randomFrame never repeats the current frame when count > 1.
{
  let s = 12345;
  const rng = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const c = makeClock(5, 'randomFrame', [1 / 30, 1 / 30]);
  stepClock(c, 0, rng);
  let repeats = 0;
  let changes = 0;
  const visited = new Set<number>([0]);
  for (let i = 1; i <= 600; i++) {
    const before = c.frame;
    const changed = stepClock(c, i / 30 + 1e-6, rng);
    if (changed) changes++;
    if (!changed || c.frame === before) repeats++;
    visited.add(c.frame);
  }
  ok(repeats === 0 && changes === 600, `randomFrame: every step picks another frame (${changes} changes, ${repeats} repeats)`);
  ok(visited.size === 5, `randomFrame: every frame is reached (${[...visited].sort().join(',')})`);
  const edge = makeClock(3, 'randomFrame', [1, 1]);
  stepClock(edge, 0, () => 0.99999);
  stepClock(edge, 1, () => 0.99999);
  ok(edge.frame === 2, `randomFrame: rng near 1 picks the last other frame (${edge.frame})`);
}

// frame (DFST) steps like time.
{
  const c = makeClock(3, 'frame', [1 / 30, 1 / 30]);
  stepClock(c, 0, never);
  stepClock(c, 1 / 30 + 1e-9, never);
  ok(c.frame === 1, 'frame: steps one a frame time, like time');
}

// frac.
ok(Math.abs(frac(-1.65) - 0.35) < 1e-12, `frac(-1.65) is 0.35 (${frac(-1.65)})`);
ok(Math.abs(frac(0.5 * 3.3) - 0.65) < 1e-12, `frac(0.5 * 3.3) is 0.65 (${frac(0.5 * 3.3)})`);
ok(frac(2) === 0 && frac(-2) === 0, 'frac of a whole number is 0');

console.log(`surfaceClock: ${passed} passed`);
