// The world's clock. Today every browser runs its own twelve-minute day from wherever it happened
// to start, so one player can be at noon while another is at dusk on the same planet. The server
// holds one clock instead, hands it out in the hail and answers a ping with it, and each browser
// works its time of day out from that rather than from its own start.
//
// This module is pure and dependency-free so the tests can run it: nothing here reads a socket, and
// the only outside thing it touches is the `now` it is given, which the tests hand in.

/**
 * A day is 720 seconds, which is what the game's own day cycle has always run at
 * (`DayCycle.dayLengthSeconds`). It is not ours; the knob that changes it is.
 */
export const DAY_MS = 720000;

/** The fraction of a day, 0 at midnight and 0.5 at noon, for a clock reading and a planet's phase. */
export function dayFraction(clockMs, phaseMs = 0, dayMs = DAY_MS) {
  if (!Number.isFinite(clockMs) || !Number.isFinite(phaseMs) || !(dayMs > 0)) return 0;
  const x = ((clockMs + phaseMs) % dayMs) / dayMs;
  return x < 0 ? x + 1 : x;
}

/** The shortest and the longest day a server may be told to keep: a second, and a real day. Ours, as the browser's own limits are. */
export const DAY_LIMITS = { minMs: 1000, maxMs: 24 * 60 * 60 * 1000 };

/**
 * How far into the day the world is at `clockMs`, before any planet's own phase, in days and not yet
 * wrapped: the anchor's fraction plus what has passed since the anchor at the day's length. With no
 * anchor (`atMs` 0, `from` 0) it is the wall clock over the length, which is what every server kept
 * before a day's length could be changed while it ran, to the last bit.
 */
export function daysAt(clockMs, dayMs, atMs = 0, from = 0) {
  return from + (clockMs - atMs) / dayMs;
}

/**
 * A cleaned copy of an admin's `day` word, or undefined: how long a day is to be, in ms, inside the
 * limits and nothing else. Who may say it is the relay's to ask; this only reads it.
 */
export function cleanDay(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const ms = Number(x.ms);
  if (!Number.isFinite(ms) || ms < DAY_LIMITS.minMs || ms > DAY_LIMITS.maxMs) return undefined;
  return { ms: Math.round(ms) };
}

/**
 * The clock the server hands out: the wall time in milliseconds, the moment this world first ran,
 * and how long a day is.
 *
 * The time of day is the wall clock and nothing else, so it survives a restart by construction and
 * two servers of the same world agree without being told anything. The epoch is not part of it: it
 * is kept, and written to disk, so the server can say how old the world is and so that anything
 * later which wants to count from the world's birth has one moment to count from.
 */
export class WorldClock {
  /**
   * @param {{ epoch?: number, dayMs?: number, dayAt?: number, dayFrom?: number, now?: () => number }} options
   * `dayAt` and `dayFrom` are the anchor a change of the day's length leaves (see `setDay`): the clock
   * reading it was made at, and how far into the day the world stood then. With none the day is the
   * wall clock over its length, as it always was.
   */
  constructor({ epoch = Date.now(), dayMs = DAY_MS, dayAt = 0, dayFrom = 0, now = () => Date.now() } = {}) {
    this.epoch = Number.isFinite(epoch) ? epoch : Date.now();
    this.dayMs = dayMs > 0 ? dayMs : DAY_MS;
    this.dayAt = Number.isFinite(dayAt) ? dayAt : 0;
    this.dayFrom = Number.isFinite(dayFrom) ? dayFrom - Math.floor(dayFrom) : 0;
    this.reading = now;
  }

  /**
   * How long a day is from now on, changed with the world running and without moving the sun: the day
   * is anchored where it stands this instant -- the fraction it has reached, at the clock reading it has
   * reached it at -- and runs on from there at the new length. Every browser told the anchor works the
   * same hour out of it, and nobody's sun jumps, because at the anchor the old day and the new one are
   * the same day. The answer is the new anchor, which is what the browsers are told.
   */
  setDay(dayMs) {
    const ms = Number(dayMs);
    if (!Number.isFinite(ms) || ms < DAY_LIMITS.minMs || ms > DAY_LIMITS.maxMs) return this.dayHand();
    const now = this.now();
    const here = daysAt(now, this.dayMs, this.dayAt, this.dayFrom);
    this.dayFrom = here - Math.floor(here);
    this.dayAt = now;
    this.dayMs = Math.round(ms);
    return this.dayHand();
  }

  /** The day's length and its anchor, as the browsers are told them; no anchor at all while there is none. */
  dayHand() {
    return this.dayAt ? { dayMs: this.dayMs, dayAt: this.dayAt, dayFrom: this.dayFrom } : { dayMs: this.dayMs };
  }

  /** The wall clock, in milliseconds, as everyone on this server reads it. */
  now() {
    return this.reading();
  }

  /** Milliseconds since this world first ran. */
  elapsed() {
    return this.now() - this.epoch;
  }

  /** The time of day now, for a planet whose own phase is `phaseMs`. */
  dayFraction(phaseMs = 0) {
    // With no anchor, the very sum it always was, so a world nobody changed the day of reads the same
    // hour to the last bit.
    if (!this.dayAt) return dayFraction(this.now(), phaseMs, this.dayMs);
    const d = daysAt(this.now(), this.dayMs, this.dayAt, this.dayFrom) + phaseMs / this.dayMs;
    return d - Math.floor(d);
  }

  /**
   * What goes in the hail and in the welcome: the clock, the epoch and the length of a day, and its
   * anchor once a day's length has been changed while the world ran. A browser built before the anchor
   * reads the length and not the anchor, and works its hour out of the wall clock as it always has.
   */
  hand() {
    return { now: this.now(), epoch: this.epoch, ...this.dayHand() };
  }

  /** A line for the log and the status page. */
  describe() {
    const up = Math.max(0, Math.round(this.elapsed() / 1000));
    return `clock ${new Date(this.now()).toISOString()}, world ${up} s old, a day is ${Math.round(this.dayMs / 1000)} s`;
  }
}
