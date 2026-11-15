// The speed class the keys ask for, and the stamina that pays for it. Shift raises the class (held: the run; let go
// and pressed again quickly: one higher), letting go lowers it a class at a time after a moment, and nothing held is
// the jog. The stamina pool is drained by the sprint, held by the run and regained at the slower classes; emptied, the
// body is tired until a share of it is back.
//
// Both are counted on a clock of seconds and by a frame's own seconds, never by frames, so the same keys at the same
// moments give the same class and the same pool at any frame rate (locoClass.test.ts runs them at 30, 60 and 144).
//
// Pure: no three.js and nothing of the page. Nothing here makes an object on a frame, and no number is handed across
// a call on a frame's own path (`advance`, `stepFor`, `rest`): a number handed to a call the compiler does not build
// in is a number made.

import type { LocoTune } from './locoTune.ts';

/** The jog: what nothing held gives, and what the class falls back to. */
export const JOG = 2;
export const RUN = 3;
export const SPRINT = 4;

/** What Shift asks for. */
export class ShiftClass {
  /** The class asked: the jog, the run or the sprint. */
  cls = JOG;
  private held = false;
  /** The clock, seconds. (Declared as fractions, as every time here is: each is counted by a frame's step.) */
  private now = 0.5;
  /** When Shift was last let go, and the class it was let go at: what a quick second press raises from. */
  private releasedAt = 0.5;
  private releasedCls = JOG;
  /** When the class next drops by one. */
  private dropAt = Infinity;

  constructor() {
    this.now = 0;
    this.releasedAt = -1e9;
  }

  /**
   * A frame of `dt` seconds: `held` whether Shift is down as the frame ends and `pressed` whether it went down during
   * it. Answers the class asked.
   */
  advance(dt: number, held: boolean, pressed: boolean, tune: LocoTune): number {
    this.now += dt;
    return this.keys(held, pressed, tune);
  }

  /** The same with the clock handed in: how the tests name their moments. */
  step(now: number, held: boolean, pressed: boolean, tune: LocoTune): number {
    this.now = now;
    return this.keys(held, pressed, tune);
  }

  /**
   * One frame's keys, written out in one body with no call of its own: a press and a let-go are seldom, and code
   * reached only seldom is never compiled, where every number it reads or works out is a number made. Here the
   * clock, the delay and the window are read on every frame, and the seldom branches only store them.
   */
  private keys(held: boolean, pressed: boolean, tune: LocoTune): number {
    const was = this.held;
    const now = this.now;
    const delay = tune.shift.dropDelay > 0.01 ? tune.shift.dropDelay : 0.01;
    const window = tune.shift.tapWindow;
    // Pressed during the frame (or found down with no press seen: the keys handed back after a mute).
    const down = pressed || (held && !was);
    // Let go. Down before the frame and pressed during it, the key was let go and pressed again inside the frame (a
    // key's own repeats never count as presses): the let-go comes first, so a quick double tap is one at any frame rate.
    if (was && (down || !held)) {
      this.releasedAt = now;
      this.releasedCls = this.cls;
      this.dropAt = now + delay;
    }
    if (down) {
      // Pressed. Again, inside the tap's window of a let-go at the run or above: one class higher than the class it
      // was let go at, whatever the class has dropped to since (the window is its own number, not the drop's delay).
      // Otherwise the run.
      if (this.releasedCls >= RUN && now - this.releasedAt < window) this.cls = this.releasedCls < SPRINT ? this.releasedCls + 1 : SPRINT;
      else if (this.cls < RUN) this.cls = RUN;
      this.dropAt = Infinity;
      // Up again as the frame ends, it was a tap begun and ended inside it: a press and a let-go at once.
      if (!held) {
        this.releasedAt = now;
        this.releasedCls = this.cls;
        this.dropAt = now + delay;
      }
    }
    this.held = held;
    if (!held) {
      // Let go: a class lower after the delay, and again each delay, down to the jog.
      while (this.cls > JOG && now >= this.dropAt) {
        this.cls--;
        this.dropAt += delay;
      }
    }
    return this.cls;
  }

  /** The class asked is held to `most` from here (the sprint refused for want of stamina does not come back by itself). */
  cap(most: number): void {
    if (this.cls > most) this.cls = most;
    if (this.releasedCls > most) this.releasedCls = most;
  }

  /**
   * A let-go before now opens no tap's window any more: the next press is a first press, and only a let-go after it
   * makes a double tap. What a fight's key ending the sprint asks, so a Shift let go just before the attack and pressed
   * once after it gives the run and not the sprint (the two taps would straddle the attack).
   */
  forgetLetGo(): void {
    this.releasedAt = -1e9;
  }

  reset(): void {
    this.cls = JOG;
    this.held = false;
    this.releasedAt = -1e9;
    this.releasedCls = JOG;
    this.dropAt = Infinity;
  }
}

/**
 * What a second does to the pool, points: `dir` the way moved as `dirOf` gives it (-1 standing), `cls` the class
 * the body really moves at. Standing and walking forward, the standard rate. Backward (straight or to a side) the
 * backward rate at any class. Sideways and the forward diagonals, the sideways walk's rate at the walk and the
 * sideways rate from the jog up. Forward: the jog regains slower, the run holds, the sprint burns. In the air and
 * swimming (`afloat`) the pool regains no faster than the air's rate, and what the class spends it still spends.
 */
export function staminaRate(tune: LocoTune, dir: number, cls: number, afloat: boolean): number {
  const s = tune.stamina;
  const r = dir < 0 ? s.walk : dir >= 3 && dir <= 5 ? s.back : dir !== 0 ? (cls <= 1 ? s.sideWalk : s.side) : cls >= SPRINT ? s.sprint : cls === RUN ? s.run : cls <= 1 ? s.walk : s.jog;
  return afloat && r > s.air ? s.air : r;
}

/** The pool. */
export class Stamina {
  /** Points left. (Declared as a fraction: it is counted by a frame's step.) */
  value = 0.5;
  /** Emptied, and not yet back to the tune's share. */
  tired = false;
  /** Seconds since the pool was last under full: what keeps the bar up a moment after. */
  private sinceFull = 0.5;
  /** A step's own numbers: the seconds, the points a second and the pool's size, written by whichever way the step is asked. */
  private dt = 0.5;
  private rate = 0.5;
  private pool = 0.5;

  constructor(pool: number) {
    this.value = pool;
    this.sinceFull = 1e9;
    this.dt = 0;
    this.rate = 0;
    this.pool = pool;
  }

  /** A frame: `rate` points a second, the pool held between nought and `pool`. (The tests' and the console's way of asking.) */
  step(dt: number, rate: number, pool: number, tune: LocoTune): void {
    this.dt = dt;
    this.rate = rate;
    this.pool = pool;
    this.apply(tune);
  }

  /**
   * A frame of the body's: the seconds and the pool's size read off the frame's own record, and the rate worked out
   * here by `staminaRate`'s own lines (written out, so no number crosses a call; the test holds the two to each other).
   */
  stepFor(f: { dt: number; pool: number }, tune: LocoTune, dir: number, cls: number, afloat: boolean): void {
    const s = tune.stamina;
    const r = dir < 0 ? s.walk : dir >= 3 && dir <= 5 ? s.back : dir !== 0 ? (cls <= 1 ? s.sideWalk : s.side) : cls >= SPRINT ? s.sprint : cls === RUN ? s.run : cls <= 1 ? s.walk : s.jog;
    this.dt = f.dt;
    this.rate = afloat && r > s.air ? s.air : r;
    this.pool = f.pool;
    this.apply(tune);
  }

  /** A frame of a body that is not on its feet at all (riding, flying, adrift): the pool regains as standing does. */
  rest(dt: number, pool: number, tune: LocoTune): void {
    this.dt = dt;
    this.rate = tune.stamina.walk;
    this.pool = pool;
    this.apply(tune);
  }

  private apply(tune: LocoTune): void {
    const pool = this.pool;
    const v = this.value + this.rate * this.dt;
    if (v <= 0) {
      this.value = 0;
      if (this.rate < 0) this.tired = true;
    } else this.value = v > pool ? pool : v;
    if (this.tired && this.value >= pool * tune.stamina.tiredUntil) this.tired = false;
    if (this.value < pool) this.sinceFull = 0;
    else this.sinceFull += this.dt;
  }

  /** Whether the bar shows: while the pool is not full, and for the tune's moment after. */
  shown(pool: number, tune: LocoTune): boolean {
    return this.value < pool || this.sinceFull < tune.stamina.linger;
  }

  /** Full again, and rested: a respawn, an arrival. */
  fill(pool: number): void {
    this.value = pool;
    this.tired = false;
    this.sinceFull = 1e9;
  }
}
