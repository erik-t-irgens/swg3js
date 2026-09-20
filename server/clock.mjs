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
  /** @param {{ epoch?: number, dayMs?: number, now?: () => number }} options */
  constructor({ epoch = Date.now(), dayMs = DAY_MS, now = () => Date.now() } = {}) {
    this.epoch = Number.isFinite(epoch) ? epoch : Date.now();
    this.dayMs = dayMs > 0 ? dayMs : DAY_MS;
    this.reading = now;
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
    return dayFraction(this.now(), phaseMs, this.dayMs);
  }

  /** What goes in the hail and in the welcome: the clock, the epoch and the length of a day. */
  hand() {
    return { now: this.now(), epoch: this.epoch, dayMs: this.dayMs };
  }

  /** A line for the log and the status page. */
  describe() {
    const up = Math.max(0, Math.round(this.elapsed() / 1000));
    return `clock ${new Date(this.now()).toISOString()}, world ${up} s old, a day is ${Math.round(this.dayMs / 1000)} s`;
  }
}
