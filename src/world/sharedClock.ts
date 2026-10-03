// One clock for everyone. The time of day and the weather schedule follow a server's clock when
// there is one, ease rather than jump when it arrives or drifts, carry on smoothly by themselves
// when the server goes away, and are exactly the wall clock when no server address is set -- which
// is what every player already shares today, and must stay untouched.
//
// Three states, and the difference between the last two matters: `off` is "no server is
// configured", where this file adds nothing at all and every reader sees Date.now(); `shared` is
// "a server is answering", where the reader sees the server's clock; `adrift` is "there was a
// server and the socket has gone", where the last offset is kept and the clock carries on at its
// own rate rather than jumping back to this machine's wall clock.
//
// No three, no DOM, no import of anything that has either: a node test runs this file as it is.
// Nothing here allocates per frame -- the offset is a pure function of the wall clock and the last
// estimate, so nobody has to tick it, and the notes are cached strings that change only when the
// state does.

/**
 * Every invented number of the shared clock in one place; all of them live through the knob at the
 * foot of this file. The server's own rates are its business; these are what this side does with
 * what it is told.
 */
export const CLOCK_TUNE = {
  /** Seconds between round trips (invented: often enough to catch drift, rare enough to cost nothing). */
  pingSeconds: 10,
  /** How many round trips the offset's median is taken over (invented: nine, so four slow ones cannot move it). */
  samples: 9,
  /** How fast the offset itself is corrected, milliseconds of clock per second of play (invented: 50 ms/s, well under one frame of day, so no correction can be seen). */
  easeMsPerSecond: 50,
  /** A correction larger than this is made at once instead of eased (invented: two seconds, past which easing would take most of a minute). */
  snapMs: 2000,
  /** A round trip slower than this tells us nothing but its own delay and is thrown away (invented: four seconds, past any real line and under the longest stall a loading frame causes). */
  maxRttMs: 4000,
  /** How fast the weather's own reading of the clock walks off a correction, milliseconds per second (invented: 500, so it is never seen to run backwards -- anything past 1000 would). */
  weatherEaseMsPerSecond: 500,
  /** A correction bigger than this is taken by the weather at once (invented: half a minute -- past it, walking would leave two players in different weather for minutes, which matters more than a wind that turns in one frame). */
  weatherEaseMaxMs: 30_000,
};

/**
 * Limits that reject what cannot be true, rather than numbers to tune: a clock before the game
 * existed or a century out is a bug, an old build or a stranger on the address, and believing it
 * would put the whole world in 1970. They are reported by the knob and deliberately not settable
 * through it, the same way the day length's own floor is not.
 */
export const CLOCK_LIMITS = {
  /** Invented: no clock this game shares can be earlier than this. */
  earliestMs: Date.UTC(2020, 0, 1),
  /** Invented: nor later than this. */
  latestMs: Date.UTC(2100, 0, 1),
  /** A server's day cannot be shorter than a second or longer than a real day (invented, the same shape as the floor that was always here). */
  minDayMs: 1000,
  maxDayMs: 24 * 60 * 60 * 1000,
};

/** The game's own day, in seconds: twelve minutes, the one number of the day that is not ours. */
export const GAME_DAY_SECONDS = 720;

export type ClockState = 'off' | 'shared' | 'adrift';

/** What the clock needs of the day to report it and to let the console let go of it. */
export interface SharedDay {
  time: number;
  phase: number;
  dayLengthSeconds: number;
  readonly held: boolean;
  readonly fast: boolean;
  release(): void;
}

/** The server's clock as this browser sees it: an offset on the wall clock, estimated from round trips. */
export class SharedClock {
  /** The wall clock, in milliseconds. A test replaces it; nothing else ever should. */
  wall: () => number = () => Date.now();

  private state: ClockState = 'off';
  /** The offsets of the last round trips, oldest first (milliseconds to add to the wall clock). */
  private readonly samples: number[] = [];
  private readonly scratch: number[] = [];
  /** The offset the estimate wants, the one it was at when that changed, and when it changed. */
  private aimMs = 0;
  private fromMs = 0;
  private fromAt = 0;
  private lastRtt = 0;
  private lastPingAt = 0;
  private pendingAt = 0;
  /** What the weather's reading of the clock is still behind the day's by, and when that was set. */
  private lagMs = 0;
  private lagAt = 0;
  /** Round trips and greetings thrown away for being impossible; reported, never silent. */
  private refusedCount = 0;
  private warned = false;
  /** This build's own day length, kept while a server's is in force. */
  private ownDaySeconds: number | null = null;
  /**
   * Where the server anchored its day when its length last changed while it ran: the server's clock
   * reading in ms, and how far into the day it stood then. 0 and 0 is no anchor, which is the wall
   * clock over the day's length exactly as every server kept it before a day's length could change.
   */
  private dayAt = 0;
  private dayFrom = 0;
  /**
   * What `setOwnDayLength` asks while the shared clock is in use: the wiring answers for the world's
   * admin by asking the server and saying so, or null for anybody else, who is refused in words.
   */
  adminDay: ((seconds: number) => string | null) | null = null;

  /** True while a server's clock is driving this one (including after the socket has gone). */
  get shared(): boolean {
    return this.state !== 'off';
  }

  get where(): ClockState {
    return this.state;
  }

  get rttMs(): number {
    return this.lastRtt;
  }

  /** No server address is set, or the address turned out to be an old relay: this file adds nothing. */
  none(): void {
    const here = this.offsetMs();
    this.state = 'off';
    this.samples.length = 0;
    this.aimMs = 0;
    this.fromMs = 0;
    this.fromAt = 0;
    this.lastRtt = 0;
    this.pendingAt = 0;
    if (this.ownDaySeconds !== null && theDay) theDay.dayLengthSeconds = this.ownDaySeconds;
    this.ownDaySeconds = null;
    this.dayAt = 0;
    this.dayFrom = 0;
    // The clock everybody shares has gone back to this machine's own in one step; the weather walks
    // that off rather than stepping its schedule with it. The day needs nothing: with no shared
    // time to follow it simply carries on from where it is.
    this.carryLag(-here);
    // A day held by hand was held against a clock that is no longer there; the day is its own from
    // here, so there is nothing left to hold it off.
    theDay?.release();
    note.day = '';
  }

  /**
   * The server's clock, straight from its greeting: the first estimate, taken as it stands. A
   * server that says how long its day is is believed, so a world running a longer day than this
   * build's own still comes out right; what the day was before is put back if the server goes.
   */
  hail(serverNowMs: number, dayMs?: number, dayAt?: number, dayFrom?: number): void {
    if (!this.sane(serverNowMs)) return;
    const opening = this.state === 'off';
    this.state = 'shared';
    this.samples.length = 0;
    this.samples.push(serverNowMs - this.wall());
    this.setAim(this.samples[0], true);
    this.setDayLength(dayMs);
    this.setAnchor(dayAt, dayFrom);
    // A time set from the console before there was a server was held against this machine's clock;
    // the greeting that opens sharing is where the shared day starts, so the day is handed back
    // rather than quietly refusing to follow it for the rest of the session with nothing on the
    // screen to say why. A later greeting -- a reconnect -- leaves a hold the player made while
    // connected exactly where they put it.
    if (opening) theDay?.release();
  }

  /** A day's length in milliseconds as the server keeps it; anything unreadable or impossible is ignored. */
  setDayLength(dayMs?: number): void {
    if (dayMs === undefined || !Number.isFinite(dayMs) || dayMs < CLOCK_LIMITS.minDayMs || dayMs > CLOCK_LIMITS.maxDayMs || !theDay) return;
    if (this.ownDaySeconds === null) this.ownDaySeconds = theDay.dayLengthSeconds;
    theDay.dayLengthSeconds = dayMs / 1000;
  }

  /**
   * Where the server anchored its day (`server/clock.mjs`'s `setDay`): the server's clock reading the
   * anchor was made at and how far into the day the world stood then. A server that has never changed
   * its day's length sends none, and none is no anchor. A reading that could not be a clock is ignored.
   */
  setAnchor(dayAt?: number, dayFrom?: number): void {
    const at = Number(dayAt);
    const from = Number(dayFrom);
    if (!Number.isFinite(at) || at <= 0 || !this.sane(at) || !Number.isFinite(from)) {
      this.dayAt = 0;
      this.dayFrom = 0;
      return;
    }
    this.dayAt = at;
    this.dayFrom = from - Math.floor(from);
  }

  /**
   * The server's `day` word: the day's new length and where it was anchored as it changed. The day is
   * the same day at the anchor whichever length it is read at, so the sun does not move; what changes is
   * only how fast it goes from here. The clock itself is not touched, so the weather's own reading of it
   * -- which keys on seconds and not on days -- carries on exactly where it was, with nothing to walk off.
   */
  dayWord(dayMs: number, dayAt?: number, dayFrom?: number): void {
    if (this.state === 'off') return;
    this.setDayLength(dayMs);
    this.setAnchor(dayAt, dayFrom);
  }

  /** A clock that could be a clock: finite, and somewhere this game could be played. */
  private sane(ms: number): boolean {
    if (Number.isFinite(ms) && ms >= CLOCK_LIMITS.earliestMs && ms <= CLOCK_LIMITS.latestMs) return true;
    this.refusedCount++;
    if (!this.warned) {
      this.warned = true;
      console.warn(`[clock] the server's clock cannot be true (${ms}); the day and the weather stay on this machine's own`);
    }
    return false;
  }

  /** The stamp to put in a `ping`; the answer is handed back to `pong` with it. */
  beginPing(): number {
    const now = this.wall();
    this.lastPingAt = now;
    this.pendingAt = now;
    return now;
  }

  /** Whether it is time for another round trip. */
  duePing(): boolean {
    return this.state === 'shared' && this.wall() - this.lastPingAt >= CLOCK_TUNE.pingSeconds * 1000;
  }

  /**
   * A `pong` came back. The offset of one round trip is `server - (sent + rtt / 2)`, which assumes
   * the two legs are the same length; the median of the last few throws away the round trips where
   * they were not.
   */
  pong(sentMs: number, serverMs: number): void {
    // Told there is no server -- put down on purpose, or the address turned out to be an old relay
    // -- an answer still on its way in must not bring one back and hand the whole offset over with
    // it. A greeting may re-open sharing; an answer to a question nobody is waiting for may not.
    if (this.state === 'off') return;
    if (!Number.isFinite(sentMs) || !this.sane(serverMs)) return;
    const now = this.wall();
    const rtt = Math.max(0, now - sentMs);
    // An answer that came home long after it was sent tells us nothing but its own delay, and half
    // of that would go straight into the offset: a compile, a trimesh build or a streamed tier is
    // enough to make one. So is an answer to a question two questions old.
    if (rtt > CLOCK_TUNE.maxRttMs || sentMs !== this.lastPingAt) {
      this.refusedCount++;
      this.pendingAt = 0;
      return;
    }
    this.lastRtt = rtt;
    this.pendingAt = 0;
    const first = this.state !== 'shared';
    this.state = 'shared';
    this.samples.push(serverMs - (sentMs + rtt / 2));
    while (this.samples.length > CLOCK_TUNE.samples) this.samples.shift();
    this.setAim(this.median(), first);
  }

  /**
   * The socket has gone. What was estimated is kept, and the clock carries on at its own rate.
   * Whatever was still being eased finishes by itself: the ease is a pure function of the wall
   * clock, so nothing has to come and finish it, and cutting it short here would be one more jump
   * in the weather's schedule at exactly the moment the design asks for none.
   */
  lost(): void {
    if (this.state === 'shared') this.state = 'adrift';
    this.pendingAt = 0;
  }

  /** Milliseconds to add to the wall clock now: eased toward the estimate, snapped when it is far. */
  offsetMs(): number {
    if (this.state === 'off') return 0;
    const d = this.aimMs - this.fromMs;
    if (d === 0) return this.aimMs;
    const moved = CLOCK_TUNE.easeMsPerSecond * (Math.max(0, this.wall() - this.fromAt) / 1000);
    if (moved >= Math.abs(d)) return this.aimMs;
    return this.fromMs + (d < 0 ? -moved : moved);
  }

  /** The clock everything shares, in milliseconds: the server's when there is one, this machine's otherwise. */
  now(): number {
    return this.wall() + this.offsetMs();
  }

  nowSeconds(): number {
    return this.now() / 1000;
  }

  /**
   * The same clock as `nowSeconds`, walked rather than stepped: the weather's schedule reads this
   * one. The day is protected from a step by the day's own easing, and the schedule has no such
   * thing -- a step would turn the wind, the rain's lean and the clouds' drift in a single frame,
   * and move the step of the schedule itself. So whenever the offset is put right in one go (a
   * greeting, a correction too big to ease, a connection put down on purpose) the difference is
   * kept here and shed at a bounded rate. The rate is under real time, so this clock is never seen
   * to run backwards; a difference too big to walk off in a reasonable while is taken at once
   * instead, because two players' weather agreeing matters more than one player's wind turning.
   */
  walkSeconds(): number {
    return (this.now() - this.lagNow()) / 1000;
  }

  /** What the weather's clock is still behind the day's by, now; zero almost always. */
  lagNow(): number {
    if (this.lagMs === 0) return 0;
    const shed = (CLOCK_TUNE.weatherEaseMsPerSecond * Math.max(0, this.wall() - this.lagAt)) / 1000;
    const size = Math.abs(this.lagMs);
    if (shed >= size) return 0;
    return this.lagMs < 0 ? this.lagMs + shed : this.lagMs - shed;
  }

  /** The offset moved by `delta` in one step: the weather keeps reading what it read and walks after it. */
  private carryLag(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    const lag = this.lagNow() + delta;
    this.lagMs = Math.abs(lag) > CLOCK_TUNE.weatherEaseMaxMs ? 0 : lag;
    this.lagAt = this.wall();
  }

  /**
   * The time of day the shared clock says, in [0, 1), or null when there is no server to share.
   * `phase` is in days and is what keeps two planets from being at the same hour.
   */
  timeOfDay(dayLengthSeconds: number, phase: number): number | null {
    if (this.state === 'off') return null;
    const len = dayLengthSeconds > 0 ? dayLengthSeconds : 1;
    // With no anchor this is `now / len + phase` to the last bit, which is what it always was.
    const t = this.dayAt ? this.dayFrom + (this.now() - this.dayAt) / (len * 1000) + phase : this.nowSeconds() / len + phase;
    return t - Math.floor(t);
  }

  report(): { where: ClockState; offsetMs: number; aimMs: number; rttMs: number; samples: number; waiting: boolean; weatherLagMs: number; refused: number; dayAt: number; dayFrom: number } {
    return {
      where: this.state,
      offsetMs: Math.round(this.offsetMs()),
      aimMs: Math.round(this.aimMs),
      rttMs: Math.round(this.lastRtt),
      samples: this.samples.length,
      waiting: this.pendingAt !== 0,
      weatherLagMs: Math.round(this.lagNow()),
      refused: this.refusedCount,
      dayAt: this.dayAt,
      dayFrom: Number(this.dayFrom.toFixed(6)),
    };
  }

  private setAim(aim: number, snap: boolean): void {
    if (!Number.isFinite(aim)) return;
    const here = this.offsetMs();
    const atOnce = snap || Math.abs(aim - here) >= CLOCK_TUNE.snapMs;
    this.fromMs = atOnce ? aim : here;
    this.fromAt = this.wall();
    this.aimMs = aim;
    // Only a correction taken in one step is a step; an eased one is already gentle enough for the
    // weather to read straight off.
    if (atOnce) this.carryLag(aim - here);
  }

  private median(): number {
    const s = this.scratch;
    s.length = 0;
    for (const v of this.samples) s.push(v);
    s.sort((a, b) => a - b);
    const n = s.length;
    if (!n) return 0;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
}

/** The one clock the day and the weather read. */
export const sharedClock = new SharedClock();

/** The note the head-up display shows when the day is not the shared clock's; a kept string, never built per frame. */
const note = { day: '' };

/** The day registered itself here so the knob can report it and let go of it. */
let theDay: SharedDay | null = null;

export function registerDay(day: SharedDay | null): void {
  theDay = day;
}

/** Set by the day whenever its own state changes; '' when nothing is out of the ordinary. */
export function setDayNote(text: string): void {
  note.day = text;
}

/** One line for the head-up display: '' unless the day is being driven by hand while a server's clock is there. */
export function sharedNote(): string {
  return note.day;
}

/**
 * The live knob, on the window as `__sharedDay()`: every invented number of the shared day, and the
 * way back when the console has taken the day off the shared clock. Reading it costs nothing.
 */
export interface ClockKnob {
  ease?: number;
  snapAt?: number;
  catchUp?: number;
  minRate?: number;
  gapSeconds?: number;
  phase?: number;
  phaseSpread?: number;
  pingSeconds?: number;
  samples?: number;
  easeMsPerSecond?: number;
  snapMs?: number;
  maxRttMs?: number;
  weatherEaseMsPerSecond?: number;
  weatherEaseMaxMs?: number;
  release?: boolean;
  /**
   * How long the whole day is, in seconds, or null for the game's own twelve minutes. With no server
   * the day is this browser's to set; with one it is the server's, and only the world's admin may set
   * it, for everybody at once -- a browser running a day of its own length beside it would have its sun
   * somewhere else from everybody's.
   */
  length?: number | null;
}

/**
 * The whole day's length set from the console; the sentence to say back. With no server it is set
 * here: the day is walked by `dt / length`, so a new length bends the sun's pace from the next frame and
 * the hour it stands at never jumps; and a server met later keeps this length as this build's own and
 * gives it back when it goes, exactly as it keeps the twelve minutes now. While the shared clock is in
 * use (a server answering, or one that has gone and left its offset in force) the length is the
 * server's: the world's admin asks the server for it (`adminDay`), which anchors the day where it stands
 * and tells everybody, and anybody else is refused in words.
 */
export function setOwnDayLength(seconds: number | null): string {
  if (!theDay) return 'there is no day to set yet';
  const want = seconds === null ? GAME_DAY_SECONDS : seconds;
  const lo = CLOCK_LIMITS.minDayMs / 1000;
  const hi = CLOCK_LIMITS.maxDayMs / 1000;
  const fits = typeof want === 'number' && Number.isFinite(want) && want >= lo && want <= hi;
  if (sharedClock.shared) {
    if (!fits) return `a day is between ${lo} and ${hi} seconds long; it stays ${Math.round(theDay.dayLengthSeconds)} s`;
    const asked = sharedClock.adminDay?.(want) ?? null;
    if (asked !== null) return asked;
    return `the day is the server's while one is in use: ${Math.round(theDay.dayLengthSeconds)} s, the same for everyone on it; only the world's admin may change it (or the server's own start: npm run relay -- --day=<seconds>)`;
  }
  if (!fits) return `a day is between ${lo} and ${hi} seconds long; it stays ${Math.round(theDay.dayLengthSeconds)} s`;
  theDay.dayLengthSeconds = want;
  return want === GAME_DAY_SECONDS ? `a day is the game's own ${GAME_DAY_SECONDS} s again` : `a day is now ${want} s long (the game's own is ${GAME_DAY_SECONDS} s)`;
}

export interface DayTune {
  /** How many times its own rate the day may run to catch a drift up. */
  easeMax: number;
  /** How far out of step, in days, the day has to be before it is a correction rather than a drift. */
  snapAt: number;
  /** How many times its own rate the day may run to make a correction, by the shorter way round. */
  catchUp: number;
  /** The least the day may run at while it waits for the shared clock, in its own rate. */
  minRate: number;
  /** How long the frames have to have been away before the day is put right outright, in seconds. */
  gapSeconds: number;
  /** How much of a day the planets' phases are spread over. */
  phaseSpread: number;
}

/**
 * The day's own invented numbers, kept beside the clock's so that one knob reaches both. Four times
 * the day's rate is about as fast as the sun can move without being watched moving, and a quarter
 * of it is slow enough to be waited for without standing still; a hundredth of a day is 7.2 seconds
 * of a twelve-minute day, which is more than any drift between two machines and less than anything
 * worth calling a correction; thirty times the rate puts the worst correction there is (half a day,
 * by the shorter way) right in twelve seconds, which is visible and brief, where easing it at four
 * would be a minute and a half of a racing sun; a second of frames away is far longer than any
 * stall and far shorter than a tab switch; a whole day of spread is simply "anywhere".
 */
export const dayTune: DayTune = { easeMax: 4, snapAt: 0.01, catchUp: 30, minRate: 0.25, gapSeconds: 1, phaseSpread: 1 };

export function clockKnob(opts?: ClockKnob): Record<string, unknown> {
  let said = '';
  if (opts) {
    if (opts.length !== undefined) said = setOwnDayLength(opts.length);
    if (opts.ease !== undefined && Number.isFinite(opts.ease)) dayTune.easeMax = Math.max(1, opts.ease);
    if (opts.snapAt !== undefined && Number.isFinite(opts.snapAt)) dayTune.snapAt = Math.max(0, opts.snapAt);
    if (opts.catchUp !== undefined && Number.isFinite(opts.catchUp)) dayTune.catchUp = Math.max(1, opts.catchUp);
    if (opts.minRate !== undefined && Number.isFinite(opts.minRate)) dayTune.minRate = Math.max(0, Math.min(1, opts.minRate));
    if (opts.gapSeconds !== undefined && Number.isFinite(opts.gapSeconds)) dayTune.gapSeconds = Math.max(0, opts.gapSeconds);
    if (opts.phaseSpread !== undefined && Number.isFinite(opts.phaseSpread)) dayTune.phaseSpread = Math.max(0, opts.phaseSpread);
    if (opts.pingSeconds !== undefined && Number.isFinite(opts.pingSeconds)) CLOCK_TUNE.pingSeconds = Math.max(1, opts.pingSeconds);
    if (opts.samples !== undefined && Number.isFinite(opts.samples)) CLOCK_TUNE.samples = Math.max(1, Math.round(opts.samples));
    if (opts.easeMsPerSecond !== undefined && Number.isFinite(opts.easeMsPerSecond)) CLOCK_TUNE.easeMsPerSecond = Math.max(0, opts.easeMsPerSecond);
    if (opts.snapMs !== undefined && Number.isFinite(opts.snapMs)) CLOCK_TUNE.snapMs = Math.max(0, opts.snapMs);
    if (opts.maxRttMs !== undefined && Number.isFinite(opts.maxRttMs)) CLOCK_TUNE.maxRttMs = Math.max(0, opts.maxRttMs);
    if (opts.weatherEaseMsPerSecond !== undefined && Number.isFinite(opts.weatherEaseMsPerSecond))
      // Anything at or past real time would be the weather's clock standing still or running
      // backwards, which is worse than the step it is there to avoid.
      CLOCK_TUNE.weatherEaseMsPerSecond = Math.max(0, Math.min(900, opts.weatherEaseMsPerSecond));
    if (opts.weatherEaseMaxMs !== undefined && Number.isFinite(opts.weatherEaseMaxMs)) CLOCK_TUNE.weatherEaseMaxMs = Math.max(0, opts.weatherEaseMaxMs);
    if (opts.phase !== undefined && Number.isFinite(opts.phase) && theDay) theDay.phase = opts.phase - Math.floor(opts.phase);
    if (opts.release && theDay) theDay.release();
  }
  const r = sharedClock.report();
  const shared = theDay ? sharedClock.timeOfDay(theDay.dayLengthSeconds, theDay.phase) : null;
  return {
    clock: r,
    serverTime: new Date(sharedClock.now()).toISOString(),
    day: theDay
      ? {
          time: Number(theDay.time.toFixed(4)),
          shared: shared === null ? null : Number(shared.toFixed(4)),
          phase: Number(theDay.phase.toFixed(4)),
          lengthSeconds: theDay.dayLengthSeconds,
          gameLengthSeconds: GAME_DAY_SECONDS,
          held: theDay.held,
          fast: theDay.fast,
        }
      : null,
    ...(said ? { said } : {}),
    note: note.day,
    tune: { ...dayTune, ...CLOCK_TUNE },
    limits: { ...CLOCK_LIMITS },
  };
}

// Reachable wherever there is a console, browser or node: the day and the weather have no panel of
// their own, and this is the only way to tune them while the game is running.
(globalThis as unknown as { __sharedDay?: typeof clockKnob }).__sharedDay = clockKnob;
