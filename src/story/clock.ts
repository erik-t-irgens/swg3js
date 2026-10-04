// How long things take in a story, and on which clock. Pure, nothing imported.
//
// **Units.** An author writes `seconds`, `realHours`, `gameHours` or `gameDays`, and may mix them in one
// span. A game day is the game's own 720 seconds, so a game hour is 30 real seconds and a 72-hour deadline
// is 36 real minutes written in game hours, or three days written in real ones: the author picks per
// timer. Every time a book holds is shared-clock milliseconds (the server's clock, or
// `Date.now()` with no server) and never the frame's own clock, which stops while a panel is open.
//
// **Two clocks.** `world`, the default, runs while the character is logged off: harsh, and on tone. A
// span on `played` counts only while the character is in the world, so its step keeps the time it has
// left while the character is away (`StepRec.remaining`) and starts counting again on the way back in.
//
// What is the game's: the 720-second day. Everything else here is ours.

/** The game's own day, in real milliseconds. */
export const GAME_DAY_MS = 720000;
export const GAME_HOUR_MS = GAME_DAY_MS / 24;
export const REAL_HOUR_MS = 3600000;
export const REAL_DAY_MS = 86400000;
/** The longest span a story may ask for: a year of real time. Anything longer is a mistake. */
export const SPAN_MAX_MS = 365 * REAL_DAY_MS;

export type ClockKind = 'world' | 'played';

/** A span as the loader keeps it: its length, its clock, and the words it was written in for an objective line. */
export interface Span {
  ms: number;
  clock: ClockKind;
  words: string;
}

const UNITS: readonly [key: string, ms: number, one: string, many: string][] = [
  ['gameDays', GAME_DAY_MS, 'game day', 'game days'],
  ['gameHours', GAME_HOUR_MS, 'game hour', 'game hours'],
  ['realHours', REAL_HOUR_MS, 'hour', 'hours'],
  ['seconds', 1000, 'second', 'seconds'],
];

/** The keys a span may carry. */
export const SPAN_KEYS = ['seconds', 'realHours', 'gameHours', 'gameDays', 'clock'];

/**
 * A span written in a file (`{ "seconds": 30 }`, `{ "gameHours": 1, "clock": "played" }`), or why it is
 * not one. At least one unit, none negative, the whole under a year.
 */
export function cleanSpan(x: unknown): Span | string {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return 'a span is written { "seconds": 30 }, with seconds, realHours, gameHours or gameDays';
  const o = x as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!SPAN_KEYS.includes(k)) return `${k} is not part of a span`;
  let ms = 0;
  const said: string[] = [];
  for (const [key, unit, one, many] of UNITS) {
    const v = o[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `${key} is a number of nought or more`;
    ms += v * unit;
    if (v > 0) said.push(`${Number(v.toFixed(3))} ${v === 1 ? one : many}`);
  }
  if (!said.length && ms === 0 && !UNITS.some(([k]) => o[k] !== undefined)) return 'a span needs one of seconds, realHours, gameHours or gameDays';
  if (ms > SPAN_MAX_MS) return 'a span may not be longer than a year';
  const clock = o.clock === undefined ? 'world' : o.clock;
  if (clock !== 'world' && clock !== 'played') return 'a span\'s clock is "world" or "played"';
  return { ms: Math.round(ms), clock, words: said.join(' and ') || 'no time at all' };
}

/** The game day a shared-clock time falls in, counted from the clock's own zero. */
export function gameDayOf(ms: number): number {
  return Math.floor(ms / GAME_DAY_MS);
}

/** The real (UTC) day a shared-clock time falls in. */
export function realDayOf(ms: number): number {
  return Math.floor(ms / REAL_DAY_MS);
}
