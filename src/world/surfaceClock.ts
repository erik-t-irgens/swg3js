// The clock of a flip-book surface: which frame of a shader's texture list shows at a given time.
// The timing modes are the client's own switchers, one per timing form of an SWTS or SWSH shader:
// DTST steps at a fixed time per frame, DRTS draws each frame's time from a range, DPPT plays
// forward then back with the same drawn times, and DFST / DRFS (samples only) step every frame
// or jump to a random other frame. Pure and without three, so the tests run it in node.

export type FlipMode = 'time' | 'random' | 'pingpong' | 'frame' | 'randomFrame';

export interface FlipClock {
  count: number;
  mode: FlipMode;
  /** Seconds a frame shows, as a range (equal for a fixed time); `min <= max`. */
  min: number;
  max: number;
  frame: number;
  /** Ping-pong's direction. */
  dir: 1 | -1;
  /** When the current frame ends; NaN until the first step starts the clock. */
  nextAt: number;
}

/** No frame shows for less than this, so a zero or broken time can never spin a step. */
const MIN_SECONDS = 1e-3;

export function makeClock(count: number, mode: FlipMode, seconds: [number, number]): FlipClock {
  const a = Number.isFinite(seconds[0]) ? seconds[0] : 0.1;
  const b = Number.isFinite(seconds[1]) ? seconds[1] : a;
  const min = Math.max(MIN_SECONDS, Math.min(a, b));
  const max = Math.max(min, Math.max(a, b));
  return { count: Math.max(1, Math.floor(count)), mode, min, max, frame: 0, dir: 1, nextAt: Number.NaN };
}

/** How long the frame starting now shows: one draw from the range when it is a range, none when fixed. */
function durationOf(c: FlipClock, rng: () => number): number {
  if (c.mode === 'time' || c.mode === 'frame' || c.max <= c.min) return c.min;
  return c.min + rng() * (c.max - c.min);
}

/** The frame after the current one, by the clock's mode. */
function advance(c: FlipClock, rng: () => number): void {
  const n = c.count;
  if (n <= 1) return;
  switch (c.mode) {
    case 'pingpong': {
      if (n <= 2) {
        c.frame = (c.frame + 1) % n;
        return;
      }
      let next = c.frame + c.dir;
      if (next >= n) {
        c.dir = -1;
        next = n - 2;
      } else if (next < 0) {
        c.dir = 1;
        next = 1;
      }
      c.frame = next;
      return;
    }
    case 'randomFrame': {
      // Uniform over the other frames: never the one showing.
      const k = Math.min(n - 2, Math.floor(rng() * (n - 1)));
      c.frame = k >= c.frame ? k + 1 : k;
      return;
    }
    default:
      c.frame = (c.frame + 1) % n;
  }
}

/**
 * Advance to time t (seconds); true when the frame changed.
 * - A gap longer than a whole cycle jumps once (never more than `count` steps in one call); nextAt ends in the future.
 * - 'time': frame + 1 mod count, each frame min seconds.
 * - 'random': frame + 1 mod count, each frame's duration drawn in [min, max] when it starts (one rng call).
 * - 'pingpong': frame + dir, turning at 0 and count - 1 (0,1,2,3,2,1,0,1 for count 4); durations as 'random'. count <= 2 behaves as 'random'.
 * - 'frame': as 'time'. 'randomFrame': another frame picked uniformly, never the current one when count > 1.
 */
export function stepClock(c: FlipClock, t: number, rng: () => number): boolean {
  if (c.count <= 1) return false;
  if (Number.isNaN(c.nextAt)) {
    c.nextAt = t + durationOf(c, rng);
    return false;
  }
  if (t < c.nextAt) return false;
  const before = c.frame;
  if (t - c.nextAt >= c.count * c.max) {
    // Away longer than a whole cycle (a hidden tab, a long load): one step, and start afresh from now.
    advance(c, rng);
    c.nextAt = t + durationOf(c, rng);
    return c.frame !== before;
  }
  let steps = 0;
  while (t >= c.nextAt && steps < c.count) {
    advance(c, rng);
    c.nextAt += durationOf(c, rng);
    steps++;
  }
  if (t >= c.nextAt) c.nextAt = t + durationOf(c, rng);
  return c.frame !== before;
}

/** The fractional part, always in [0, 1): a scroll offset kept small over a long session. */
export const frac = (x: number): number => x - Math.floor(x);
