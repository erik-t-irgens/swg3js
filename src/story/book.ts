// The story book: everything a character's story holds, in one record, and the one function that
// changes it. Pure: no DOM, no three, no clock of its own, and nothing imported but its own folder, so
// the server runs this very file under node's type stripping (`server/stories.mjs`) and the browser
// runs it as it is. There is one rule book and two hosts of it, never two rule books.
//
// **How a book changes.** Only through `applyChanges`, which takes a batch of change records (a closed
// list: `wpSet`, `wpEdit`, `wpOn`, `wpGone`, `qwpOn`, `trackWp`, `track` for the waypoints and the
// tracker; `qState`, `step`, `flag`, `paid`, `xp`, `trackAdd`, `closed` for the jobs) and applies each
// one the book will take, in order, saying why for each it will not. The same batch on the same book
// always comes out the same, which is what lets the server write a batch to its log and play it back
// on start, and lets a browser apply the server's batch to its own copy and arrive at the same book.
// `rev` goes up by one for every batch that changed anything.
//
// **The three counters.** `rev` is the book's own revision. `base` is the server revision this copy
// last matched (0 for a book no server has ever held). `local` is how many batches a browser applied
// with nobody holding the book but itself since then: it is what goes up the wire when a character
// meets a server again, and what the character's change counter reads (`characterMark`), so a story
// played alone settles exactly as the rest of the character does.
//
// **What later waves add.** Sections this wave does not know (`journal`, `files`, `npcs` and the rest)
// are kept as they came when they are well formed -- plain data, no key that means something to the
// language, not too deep and not too big -- and dropped whole when they are not, so a book written by a
// newer browser passes through an older one without being cut up.
//
// **The jobs.** A character's quests, flags, the rewards it has been paid, the quests closed to it for
// good, its experience and its standing on the three tracks are sections of their own (`quests`,
// `flags`, `paid`, `closed`, `xp`, `tracks`), absent until something writes them, so a book from before
// them reads as one with nothing in them. Their changes are whole records (`qState` a quest's, `step` one
// step's), never arithmetic on a field, except the two counters (`xp`, `trackAdd`) that only ever add.
// A keyed table is built with no prototype and refuses the three names the language gives a meaning to,
// so a quest, a flag or a reward can never be `__proto__`, and every lookup in one asks for the table's
// own key, so a table handed in with a prototype still never answers `toString` for a flag nobody set. A
// section of the book is never a name every object already has (`valueOf`, `hasOwnProperty`, ...): such
// a key is dropped as it is read, since kept on the book it would shadow the language's own method on
// every copy and a lookup of it would find that method instead. Nothing in here decides what a job does
// next: that is the step machine (`quests.ts`), which only ever hands this file changes.
//
// **A quest's waypoint switched by the player** is remembered both ways: `wpOff` for one switched off,
// `qwpOn` for one switched on, so a waypoint whose step starts it off can be switched on and stays so.
//
// Every number here is ours.

import { FORBIDDEN_KEYS, WAYPOINT_TUNE, cleanPlace, cleanWaypoint, cleanWaypointName, cleanWorld, isQuestWaypoint, isWaypointColour, isWaypointId, waypointNumber, type Waypoint, type WaypointColour } from './waypoints.ts';

/** The shape of a book. A book of another version is not read as this one. */
export const BOOK_VERSION = 1;

export interface StoryBook {
  v: 1;
  /** The character it belongs to. */
  char: string;
  rev: number;
  base: number;
  local: number;
  waypoints: Waypoint[];
  /** The counter the next personal waypoint's id is minted from: `w<nextWp>`. */
  nextWp: number;
  /** The quest waypoints switched off, by `q:<quest>#<step>`. */
  wpOff: string[];
  /** The one waypoint tracked, personal or a quest's, or null. */
  trackWp: string | null;
  /** The quests tracked, by id. */
  tracked: string[];
  /** Every quest this character has met, by id. Absent: none. */
  quests?: Record<string, QuestRec>;
  /** The story's own flags, by name. Absent: none set. */
  flags?: Record<string, number | string>;
  /**
   * Every reward paid, by the key of where it was paid (`<quest>#<n>#<step>` or `<quest>#<n>#out:<outcome>`,
   * `n` the completion it counts towards), and who paid it.
   */
  paid?: Record<string, PaidRec>;
  /** The quest waypoints switched on by the player, by `q:<quest>#<step>`: what wins over a step that starts its waypoint off. */
  qwpOn?: string[];
  /** Quests closed to this character for good. */
  closed?: string[];
  /** Experience recorded. It pays for nothing yet. */
  xp?: number;
  /** Standing (and, from a later wave, Trust and rank) on each of the three tracks. */
  tracks?: Partial<Record<Track, TrackRec>>;
  /** Sections a later wave writes, kept as they came. */
  [section: string]: unknown;
}

/** A quest as a character holds it. `offered` waits on an answer; `stalled` waits on Drop or an author. */
export type QuestState = 'offered' | 'active' | 'done' | 'failed' | 'dropped' | 'stalled' | 'none';
export type StepState = 'waiting' | 'active' | 'done' | 'failed' | 'skipped';
export type Track = 'rebellion' | 'empire' | 'freelance';
export const TRACKS: readonly Track[] = ['rebellion', 'empire', 'freelance'];
export const QUEST_STATES: readonly QuestState[] = ['offered', 'active', 'done', 'failed', 'dropped', 'stalled', 'none'];
export const STEP_STATES: readonly StepState[] = ['waiting', 'active', 'done', 'failed', 'skipped'];

/**
 * One step of the run in progress. `n` is its counter (kills, signals, or the milliseconds an observe
 * step has been watched); `deadline` when it runs out on the shared clock, `remaining` its time left while
 * a clock that counts only time played is stopped; `place` a place written relative to where the quest
 * began, worked out when the step began; `since` when an observe step's watcher stepped inside.
 */
export interface StepRec {
  state: StepState;
  n: number;
  at: number;
  deadline?: number;
  remaining?: number;
  choice?: string;
  place?: [number, number];
  since?: number;
}

/**
 * One quest. `run` counts the attempts; `at` is when this one began (or was offered), `ended` when the
 * last one ended. `defRev` and `defHash` are the definition the run began under, which is how a quest
 * rewritten under a player is noticed. `from` is where the run began (what a relative place is measured
 * from), and `day` how much Standing it has given today, `[real day, amount]`, against its daily cap.
 */
export interface QuestRec {
  state: QuestState;
  run: number;
  outcome?: string;
  at: number;
  ended?: number;
  completions: number;
  defRev: number;
  defHash: string;
  params?: Record<string, string | number>;
  steps: Record<string, StepRec>;
  history: { run: number; outcome: string; at: number }[];
  why?: string;
  from?: { world: string; p: [number, number] };
  day?: [number, number];
}

export interface PaidRec {
  at: number;
  by?: 'server' | 'browser' | 'settle';
}

/** A track's numbers. A later wave adds rank, status and the rest; what it adds is kept as it came. */
export interface TrackRec {
  standing: number;
  trust: number;
  [field: string]: unknown;
}

/** The caps a book is held to. The server moves its own with `--set story.<name>=n`. */
export interface BookLimits {
  /** Personal waypoints a character keeps. */
  waypoints: number;
  /** Quests tracked at once. */
  tracked: number;
  /** Quest waypoints that may be switched off. */
  wpOff: number;
  /** The values a section this wave does not know may hold, counted one per number, string or entry. */
  sectionNodes: number;
  /** Quests a character keeps a record of. */
  quests: number;
  /** Steps one quest's record may hold (the client's own quests never pass 16). */
  steps: number;
  /** Flags a character keeps. */
  flags: number;
  /** Rewards a book remembers paying. */
  paid: number;
  /** Quests closed to a character for good. */
  closed: number;
  /** Past runs a quest remembers the outcome of. */
  history: number;
}

export const BOOK_LIMITS: BookLimits = { waypoints: WAYPOINT_TUNE.max, tracked: 3, wpOff: 4000, sectionNodes: 200000, quests: 4000, steps: 64, flags: 2000, paid: 20000, closed: 4000, history: 8 };

/**
 * What a browser holds a book to that a server decided, rather than one it changes itself: the server's own
 * batches, its book handed down, and that book read back out of storage. A server may run with caps of its
 * own (`--set story.waypoints=200`), so these are only a backstop against nonsense and never a second
 * judgement: a copy read back under the browser's own caps would come out cut to them, and a change made
 * alone on top of it would then hand the server back a book shorter than the one it wrote down. A change a
 * browser makes itself is still held to `BOOK_LIMITS` when it is applied.
 */
export const BACKSTOP_LIMITS: BookLimits = { waypoints: 10000, tracked: 100, wpOff: 100000, sectionNodes: 2000000, quests: 40000, steps: 640, flags: 20000, paid: 200000, closed: 40000, history: 8 };

/** One change. A closed list: anything else is not a change this book takes. */
export type StoryChange =
  | { k: 'wpSet'; wp: Waypoint }
  | { k: 'wpEdit'; id: string; name?: string; colour?: WaypointColour }
  | { k: 'wpOn'; id: string; on: boolean }
  | { k: 'wpGone'; id: string }
  | { k: 'qwpOn'; key: string; on: boolean }
  | { k: 'trackWp'; id: string | null }
  | { k: 'track'; quest: string; on: boolean }
  | { k: 'qState'; quest: string; rec: QuestRec }
  | { k: 'step'; quest: string; step: string; rec: StepRec }
  | { k: 'flag'; name: string; value: number | string | null }
  | { k: 'paid'; key: string; at: number; by: 'server' | 'browser' | 'settle' }
  | { k: 'xp'; add: number }
  | { k: 'trackAdd'; track: Track; standing: number }
  | { k: 'closed'; quest: string };

/** The sections the first wave reads itself. Every other one is a section of its own (below) or a later wave's, kept as it came. */
const KNOWN = ['v', 'char', 'rev', 'base', 'local', 'waypoints', 'nextWp', 'wpOff', 'trackWp', 'tracked'];

/** A character id as the browser makes them (`server/wire.mjs` holds the same rule). */
const CHARACTER = /^[A-Za-z0-9_.-]{1,64}$/;
/** A quest's id: its set's prefix and its own name (`own:courier`, `test:goto`). */
const QUEST_ID = /^[A-Za-z0-9_-]{1,24}:[A-Za-z0-9_./-]{1,96}$/;
/** A step's or an outcome's name, inside its quest. */
const STEP_NAME = /^[A-Za-z0-9_.-]{1,48}$/;
/** A flag's name: plain characters, a dot or a colon to group them (`test.branch`). */
const FLAG_NAME = /^[A-Za-z0-9_.:/-]{1,64}$/;
/** Where a reward was paid: `<quest>#<n>#<step>` or `<quest>#<n>#out:<outcome>`. */
const PAID_KEY = /^[A-Za-z0-9_:./#-]{1,240}$/;
/** A definition's hash as a run keeps it: sixteen hex digits, or nothing for a record from before it. */
const DEF_HASH = /^([0-9a-f]{16})?$/;
/** The longest flag value, a reason or a parameter, in characters. */
const WORDS_MAX = 200;
/** How deep a later wave's section may nest before it is not well formed. */
const SECTION_DEPTH = 24;
/** The largest a counter may be before it is nonsense. */
const COUNT_MAX = 1e12;
const CONTROL = /[\u0000-\u001f\u007f]/g;

export function isCharacterId(x: unknown): x is string {
  return typeof x === 'string' && CHARACTER.test(x) && !FORBIDDEN_KEYS.includes(x);
}

export function isQuestId(x: unknown): x is string {
  return typeof x === 'string' && QUEST_ID.test(x);
}

export function isStepName(x: unknown): x is string {
  return typeof x === 'string' && STEP_NAME.test(x) && !FORBIDDEN_KEYS.includes(x);
}

export function isFlagName(x: unknown): x is string {
  return typeof x === 'string' && FLAG_NAME.test(x) && !FORBIDDEN_KEYS.includes(x);
}

export function isTrack(x: unknown): x is Track {
  return typeof x === 'string' && (TRACKS as readonly string[]).includes(x);
}

function count(x: unknown, least = 0): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= least && x <= COUNT_MAX ? Math.floor(x) : least;
}

/** A time on the shared clock, or undefined. */
function time(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= COUNT_MAX * 10 ? x : undefined;
}

function words(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const out = x.replace(CONTROL, '').slice(0, WORDS_MAX);
  return out || undefined;
}

/**
 * A keyed table with no prototype: a key that came off the wire or out of a file is only ever a key, never
 * a way into the language's own objects. JSON writes it like any other object.
 */
export function table<T>(from?: Record<string, T>): Record<string, T> {
  const out = Object.create(null) as Record<string, T>;
  if (from) for (const k of Object.keys(from)) out[k] = from[k];
  return out;
}

/**
 * A keyed table's own entry, or undefined: never anything its prototype carries. Every table this file
 * builds has none, but a book can reach the rules some other way (a file read back by somebody who did
 * not clean it), and `toString` must read as a flag nobody set there too.
 */
export function ownOf<T>(t: Record<string, T> | null | undefined, key: string): T | undefined {
  return t && Object.hasOwn(t, key) ? t[key] : undefined;
}

/** Whether a key is a name every plain object already answers to (`valueOf`, `__proto__`, ...): never a section of a book. */
function isLanguageKey(k: string): boolean {
  return FORBIDDEN_KEYS.includes(k) || k in Object.prototype;
}

function sizeOf(t: object | undefined): number {
  return t ? Object.keys(t).length : 0;
}

/** One step's record, cleaned, or null. */
export function cleanStepRec(x: unknown): StepRec | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!(STEP_STATES as readonly unknown[]).includes(o.state)) return null;
  const n = typeof o.n === 'number' && Number.isFinite(o.n) && Math.abs(o.n) <= COUNT_MAX ? o.n : 0;
  const out: StepRec = { state: o.state as StepState, n, at: time(o.at) ?? 0 };
  const deadline = time(o.deadline);
  if (deadline !== undefined) out.deadline = deadline;
  const remaining = time(o.remaining);
  if (remaining !== undefined) out.remaining = remaining;
  if (isStepName(o.choice)) out.choice = o.choice;
  if (Array.isArray(o.place) && o.place.length === 2) {
    const p = cleanPlace(o.place);
    if (p) out.place = [p[0], p[1]];
  }
  const since = time(o.since);
  if (since !== undefined) out.since = since;
  return out;
}

/**
 * One quest's record, cleaned, or null. Only its state is required: everything else has a resting value,
 * so a record cut short reads as the start of one rather than as nothing. Steps past the cap and history
 * past its length are dropped from the end.
 */
export function cleanQuestRec(x: unknown, limits: BookLimits = BOOK_LIMITS): QuestRec | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!(QUEST_STATES as readonly unknown[]).includes(o.state)) return null;
  const out: QuestRec = {
    state: o.state as QuestState,
    run: count(o.run, 1),
    at: time(o.at) ?? 0,
    completions: count(o.completions),
    defRev: count(o.defRev),
    defHash: typeof o.defHash === 'string' && DEF_HASH.test(o.defHash) ? o.defHash : '',
    steps: table<StepRec>(),
    history: [],
  };
  if (isStepName(o.outcome)) out.outcome = o.outcome;
  const ended = time(o.ended);
  if (ended !== undefined) out.ended = ended;
  if (o.params && typeof o.params === 'object' && !Array.isArray(o.params)) {
    const params = table<string | number>();
    for (const k of Object.keys(o.params)) {
      const v = (o.params as Record<string, unknown>)[k];
      if (!isFlagName(k) || sizeOf(params) >= 64) continue;
      if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
      else if (typeof v === 'string') params[k] = words(v) ?? '';
    }
    out.params = params;
  }
  if (o.steps && typeof o.steps === 'object' && !Array.isArray(o.steps)) {
    for (const k of Object.keys(o.steps)) {
      if (!isStepName(k) || sizeOf(out.steps) >= limits.steps) continue;
      const s = cleanStepRec((o.steps as Record<string, unknown>)[k]);
      if (s) out.steps[k] = s;
    }
  }
  if (Array.isArray(o.history)) {
    for (const h of o.history) {
      if (!h || typeof h !== 'object') continue;
      const r = h as Record<string, unknown>;
      if (!isStepName(r.outcome) && r.outcome !== 'dropped') continue;
      out.history.push({ run: count(r.run, 1), outcome: r.outcome as string, at: time(r.at) ?? 0 });
    }
    while (out.history.length > limits.history) out.history.shift();
  }
  const why = words(o.why);
  if (why) out.why = why;
  if (o.from && typeof o.from === 'object' && !Array.isArray(o.from)) {
    const f = o.from as Record<string, unknown>;
    const world = cleanWorld(f.world);
    const p = Array.isArray(f.p) && f.p.length === 2 ? cleanPlace(f.p) : null;
    if (world && p) out.from = { world, p: [p[0], p[1]] };
  }
  if (Array.isArray(o.day) && o.day.length === 2 && o.day.every((v) => typeof v === 'number' && Number.isFinite(v))) out.day = [Math.floor(o.day[0] as number), o.day[1] as number];
  return out;
}

function cleanQuests(x: unknown, limits: BookLimits): Record<string, QuestRec> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out = table<QuestRec>();
  for (const k of Object.keys(x)) {
    if (!isQuestId(k) || sizeOf(out) >= limits.quests) continue;
    const rec = cleanQuestRec((x as Record<string, unknown>)[k], limits);
    if (rec) out[k] = rec;
  }
  return out;
}

function cleanFlags(x: unknown, limits: BookLimits): Record<string, number | string> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out = table<number | string>();
  for (const k of Object.keys(x)) {
    const v = (x as Record<string, unknown>)[k];
    if (!isFlagName(k) || sizeOf(out) >= limits.flags) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = words(v) ?? '';
  }
  return out;
}

function cleanPaid(x: unknown, limits: BookLimits): Record<string, PaidRec> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out = table<PaidRec>();
  for (const k of Object.keys(x)) {
    const v = (x as Record<string, unknown>)[k];
    if (!PAID_KEY.test(k) || FORBIDDEN_KEYS.includes(k) || !v || typeof v !== 'object' || sizeOf(out) >= limits.paid) continue;
    const r = v as Record<string, unknown>;
    const row: PaidRec = { at: time(r.at) ?? 0 };
    if (r.by === 'server' || r.by === 'browser' || r.by === 'settle') row.by = r.by;
    out[k] = row;
  }
  return out;
}

function cleanClosed(x: unknown, limits: BookLimits): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: string[] = [];
  for (const q of x) if (isQuestId(q) && !out.includes(q) && out.length < limits.closed) out.push(q);
  return out;
}

function cleanQwpOn(x: unknown, limits: BookLimits): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: string[] = [];
  for (const k of x) if (isQuestWaypoint(k) && !out.includes(k) && out.length < limits.wpOff) out.push(k);
  return out;
}

function cleanTracks(x: unknown): Partial<Record<Track, TrackRec>> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out: Partial<Record<Track, TrackRec>> = table<TrackRec>();
  for (const t of TRACKS) {
    const v = (x as Record<string, unknown>)[t];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const r = v as Record<string, unknown>;
    // What a later wave adds to a track is kept when it is plain data, as any later section is.
    const rest = plainCopy(r, 1, { left: 2000 });
    const row: TrackRec = { ...(rest && typeof rest === 'object' && !Array.isArray(rest) ? (rest as Record<string, unknown>) : {}), standing: 0, trust: 0 };
    row.standing = typeof r.standing === 'number' && Number.isFinite(r.standing) ? r.standing : 0;
    row.trust = typeof r.trust === 'number' && Number.isFinite(r.trust) ? r.trust : 0;
    out[t] = row;
  }
  return out;
}

/**
 * The sections the jobs keep, each with its own cleaner. Read in the order a book has them, so a book read
 * back is the book written. A table with no prototype, because the key looked up in it is whatever the
 * book handed in says: a plain object would answer `valueOf` with the language's own method, and call it.
 */
const SECTIONS = table<(x: unknown, limits: BookLimits) => unknown>({
  quests: cleanQuests,
  flags: cleanFlags,
  paid: cleanPaid,
  closed: cleanClosed,
  xp: (x) => (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= COUNT_MAX ? Math.floor(x) : undefined),
  tracks: cleanTracks,
  qwpOn: cleanQwpOn,
});

/** A new, empty book. */
export function emptyBook(char: string): StoryBook {
  return { v: BOOK_VERSION, char, rev: 0, base: 0, local: 0, waypoints: [], nextWp: 1, wpOff: [], trackWp: null, tracked: [] };
}

/**
 * A copy of plain data, or undefined when it is not plain data: strings, finite numbers, booleans, null,
 * arrays and objects, none of whose keys is one the language gives a meaning to, no deeper than
 * `SECTION_DEPTH`, and no more values than the budget allows. It is rebuilt rather than trusted, so
 * nothing that came in can be reached through what goes out.
 */
function plainCopy(x: unknown, depth: number, budget: { left: number }): unknown {
  if (--budget.left < 0) return undefined;
  if (x === null || typeof x === 'string' || typeof x === 'boolean') return x;
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (depth >= SECTION_DEPTH || typeof x !== 'object') return undefined;
  if (Array.isArray(x)) {
    const out: unknown[] = [];
    for (const v of x) {
      const c = plainCopy(v, depth + 1, budget);
      if (c === undefined) return undefined;
      out.push(c);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(x)) {
    if (FORBIDDEN_KEYS.includes(k)) return undefined;
    const c = plainCopy((x as Record<string, unknown>)[k], depth + 1, budget);
    if (c === undefined) return undefined;
    out[k] = c;
  }
  return out;
}

/**
 * A book handed in from anywhere -- storage, the wire, the server's file -- cleaned, or null when it is
 * not a book at all. Every field this wave knows is rebuilt and held to its caps; a waypoint that is
 * not one is dropped and the rest kept; a section a later wave writes is kept only when it is well
 * formed, and dropped whole when it is not.
 */
export function cleanBook(raw: unknown, limits: BookLimits = BOOK_LIMITS): StoryBook | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== BOOK_VERSION || !isCharacterId(o.char)) return null;
  const book = emptyBook(o.char as string);
  book.rev = count(o.rev);
  book.base = count(o.base);
  book.local = count(o.local);
  book.nextWp = count(o.nextWp, 1);
  const ids = new Set<string>();
  for (const w of Array.isArray(o.waypoints) ? o.waypoints : []) {
    if (book.waypoints.length >= limits.waypoints) break;
    const wp = cleanWaypoint(w);
    if (!wp || ids.has(wp.id)) continue;
    ids.add(wp.id);
    book.waypoints.push(wp);
    // An id is never minted twice: the counter is past every one the book holds, whatever it said.
    book.nextWp = Math.max(book.nextWp, waypointNumber(wp.id) + 1);
  }
  for (const k of Array.isArray(o.wpOff) ? o.wpOff : []) if (isQuestWaypoint(k) && !book.wpOff.includes(k) && book.wpOff.length < limits.wpOff) book.wpOff.push(k);
  for (const q of Array.isArray(o.tracked) ? o.tracked : []) if (isQuestId(q) && !book.tracked.includes(q) && book.tracked.length < limits.tracked) book.tracked.push(q);
  if ((isWaypointId(o.trackWp) && ids.has(o.trackWp)) || isQuestWaypoint(o.trackWp)) book.trackWp = o.trackWp as string;
  const budget = { left: limits.sectionNodes };
  for (const k of Object.keys(o)) {
    if (KNOWN.includes(k) || isLanguageKey(k)) continue;
    const own = ownOf(SECTIONS, k);
    const kept = own ? own(o[k], limits) : plainCopy(o[k], 0, budget);
    if (kept !== undefined) book[k] = kept;
  }
  return book;
}

/** A change handed in from anywhere, cleaned, or null when it is not one this book takes. */
export function cleanChange(x: unknown): StoryChange | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  switch (o.k) {
    case 'wpSet': {
      const wp = cleanWaypoint(o.wp);
      return wp ? { k: 'wpSet', wp } : null;
    }
    case 'wpEdit': {
      if (!isWaypointId(o.id)) return null;
      const out: { k: 'wpEdit'; id: string; name?: string; colour?: WaypointColour } = { k: 'wpEdit', id: o.id };
      const name = o.name === undefined ? null : cleanWaypointName(o.name);
      if (name) out.name = name;
      if (isWaypointColour(o.colour)) out.colour = o.colour;
      return out;
    }
    case 'wpOn':
      return isWaypointId(o.id) && typeof o.on === 'boolean' ? { k: 'wpOn', id: o.id, on: o.on } : null;
    case 'wpGone':
      return isWaypointId(o.id) ? { k: 'wpGone', id: o.id } : null;
    case 'qwpOn':
      return isQuestWaypoint(o.key) && typeof o.on === 'boolean' ? { k: 'qwpOn', key: o.key, on: o.on } : null;
    case 'trackWp':
      return o.id === null || isWaypointId(o.id) || isQuestWaypoint(o.id) ? { k: 'trackWp', id: (o.id as string | null) ?? null } : null;
    case 'track':
      return isQuestId(o.quest) && typeof o.on === 'boolean' ? { k: 'track', quest: o.quest, on: o.on } : null;
    case 'qState': {
      const rec = isQuestId(o.quest) ? cleanQuestRec(o.rec, BACKSTOP_LIMITS) : null;
      return rec ? { k: 'qState', quest: o.quest as string, rec } : null;
    }
    case 'step': {
      const rec = isQuestId(o.quest) && isStepName(o.step) ? cleanStepRec(o.rec) : null;
      return rec ? { k: 'step', quest: o.quest as string, step: o.step as string, rec } : null;
    }
    case 'flag': {
      if (!isFlagName(o.name)) return null;
      if (o.value === null) return { k: 'flag', name: o.name, value: null };
      if (typeof o.value === 'number' && Number.isFinite(o.value)) return { k: 'flag', name: o.name, value: o.value };
      if (typeof o.value === 'string') return { k: 'flag', name: o.name, value: words(o.value) ?? '' };
      return null;
    }
    case 'paid': {
      const at = time(o.at);
      if (typeof o.key !== 'string' || !PAID_KEY.test(o.key) || FORBIDDEN_KEYS.includes(o.key) || at === undefined) return null;
      return o.by === 'server' || o.by === 'browser' || o.by === 'settle' ? { k: 'paid', key: o.key, at, by: o.by } : null;
    }
    case 'xp':
      return typeof o.add === 'number' && Number.isInteger(o.add) && Math.abs(o.add) <= 1e9 ? { k: 'xp', add: o.add } : null;
    case 'trackAdd':
      return isTrack(o.track) && typeof o.standing === 'number' && Number.isFinite(o.standing) && Math.abs(o.standing) <= 1e9 ? { k: 'trackAdd', track: o.track, standing: o.standing } : null;
    case 'closed':
      return isQuestId(o.quest) ? { k: 'closed', quest: o.quest } : null;
    default:
      return null;
  }
}

function waypointAt(book: StoryBook, id: string): number {
  for (let i = 0; i < book.waypoints.length; i++) if (book.waypoints[i].id === id) return i;
  return -1;
}

/** Why the book will not take a change as it stands, or null when it will. Changes nothing. */
export function whyNot(book: StoryBook, c: StoryChange, limits: BookLimits = BOOK_LIMITS): string | null {
  switch (c.k) {
    case 'wpSet':
      if (waypointAt(book, c.wp.id) >= 0) return 'that waypoint is already there';
      if (book.waypoints.length >= limits.waypoints) return `a character keeps ${limits.waypoints} waypoints`;
      return null;
    case 'wpEdit':
      if (waypointAt(book, c.id) < 0) return 'there is no such waypoint';
      if (c.name === undefined && c.colour === undefined) return 'there is nothing to change';
      return null;
    case 'wpOn':
    case 'wpGone':
      return waypointAt(book, c.id) < 0 ? 'there is no such waypoint' : null;
    case 'qwpOn':
      if (!c.on && !book.wpOff.includes(c.key) && book.wpOff.length >= limits.wpOff) return 'too many of a quest’s waypoints are switched off';
      return c.on && !book.qwpOn?.includes(c.key) && (book.qwpOn?.length ?? 0) >= limits.wpOff ? 'too many of a quest’s waypoints are switched on' : null;
    case 'trackWp':
      return c.id !== null && isWaypointId(c.id) && waypointAt(book, c.id) < 0 ? 'there is no such waypoint' : null;
    case 'track':
      return c.on && !book.tracked.includes(c.quest) && book.tracked.length >= limits.tracked ? `at most ${limits.tracked} jobs are tracked at once` : null;
    case 'qState':
      if (!ownOf(book.quests, c.quest) && sizeOf(book.quests) >= limits.quests) return `a character keeps a record of ${limits.quests} jobs`;
      return sizeOf(c.rec.steps) > limits.steps ? `a job keeps ${limits.steps} steps` : null;
    case 'step': {
      const q = ownOf(book.quests, c.quest);
      if (!q) return 'there is no such job in this book';
      return !ownOf(q.steps, c.step) && sizeOf(q.steps) >= limits.steps ? `a job keeps ${limits.steps} steps` : null;
    }
    case 'flag':
      return c.value !== null && ownOf(book.flags, c.name) === undefined && sizeOf(book.flags) >= limits.flags ? `a character keeps ${limits.flags} flags` : null;
    case 'paid':
      // The one rule every host's payment rests on: a reward is paid once, wherever it is paid.
      if (ownOf(book.paid, c.key)) return 'that reward is already paid';
      return sizeOf(book.paid) >= limits.paid ? `a book remembers ${limits.paid} rewards` : null;
    case 'xp':
    case 'trackAdd':
      return null;
    case 'closed':
      if (book.closed?.includes(c.quest)) return 'that job is already closed';
      return (book.closed?.length ?? 0) >= limits.closed ? `a character keeps ${limits.closed} closed jobs` : null;
  }
}

function applyOne(book: StoryBook, c: StoryChange): void {
  switch (c.k) {
    case 'wpSet':
      book.waypoints.push({ ...c.wp, p: [c.wp.p[0], c.wp.p[1], c.wp.p[2]], ...(c.wp.room ? { room: { ...c.wp.room } } : {}) });
      book.nextWp = Math.max(book.nextWp, waypointNumber(c.wp.id) + 1);
      return;
    case 'wpEdit': {
      const w = book.waypoints[waypointAt(book, c.id)];
      if (c.name !== undefined) w.name = c.name;
      if (c.colour !== undefined) w.colour = c.colour;
      return;
    }
    case 'wpOn':
      book.waypoints[waypointAt(book, c.id)].on = c.on;
      return;
    case 'wpGone':
      book.waypoints.splice(waypointAt(book, c.id), 1);
      if (book.trackWp === c.id) book.trackWp = null;
      return;
    case 'qwpOn': {
      // The player's word wins over the step's, either way, so the two lists never both hold one key. The
      // switched-on list is replaced rather than changed, as the jobs' sections are (`draftOf`).
      const at = book.wpOff.indexOf(c.key);
      if (c.on && at >= 0) book.wpOff.splice(at, 1);
      else if (!c.on && at < 0) book.wpOff.push(c.key);
      const on = book.qwpOn ?? [];
      if (c.on && !on.includes(c.key)) book.qwpOn = [...on, c.key];
      else if (!c.on && on.includes(c.key)) book.qwpOn = on.filter((k) => k !== c.key);
      return;
    }
    case 'trackWp':
      book.trackWp = c.id;
      return;
    case 'track': {
      const at = book.tracked.indexOf(c.quest);
      if (c.on && at < 0) book.tracked.push(c.quest);
      else if (!c.on && at >= 0) book.tracked.splice(at, 1);
      return;
    }
    // The jobs' sections are replaced a record at a time and never changed inside a record that is
    // already there, so a working copy that shares those records with the book it was taken from
    // (`draftOf`) can be written to without the book itself moving.
    case 'qState':
      (book.quests ??= table<QuestRec>())[c.quest] = c.rec;
      return;
    case 'step': {
      const quests = book.quests!;
      const q = quests[c.quest];
      const steps = table(q.steps);
      steps[c.step] = c.rec;
      quests[c.quest] = { ...q, steps };
      return;
    }
    case 'flag': {
      const flags = (book.flags ??= table<number | string>());
      if (c.value === null) delete flags[c.name];
      else flags[c.name] = c.value;
      return;
    }
    case 'paid':
      (book.paid ??= table<PaidRec>())[c.key] = { at: c.at, by: c.by };
      return;
    case 'xp':
      book.xp = (book.xp ?? 0) + c.add;
      return;
    case 'trackAdd': {
      const tracks = (book.tracks ??= table<TrackRec>());
      const t = tracks[c.track] ?? { standing: 0, trust: 0 };
      tracks[c.track] = { ...t, standing: t.standing + c.standing };
      return;
    }
    case 'closed':
      (book.closed ??= []).push(c.quest);
      return;
  }
}

/**
 * One change, cleaned and taken if the book will take it as it stands: the reason when it will not, null
 * when it was taken. `rev` is left alone: a batch moves it once, however many changes are in it.
 */
export function applyChange(book: StoryBook, raw: unknown, limits: BookLimits = BOOK_LIMITS): { change: StoryChange | null; why: string | null } {
  const c = cleanChange(raw);
  if (!c) return { change: null, why: 'that is not a change this book takes' };
  const why = whyNot(book, c, limits);
  if (why) return { change: null, why };
  applyOne(book, c);
  return { change: c, why: null };
}

/**
 * Apply a batch to a book, in place. Each change is cleaned, then taken if the book will take it as it
 * stands after the ones before it, and refused with a reason if not; `rev` rises by one when anything
 * was taken. The same batch on the same book always does the same thing.
 */
export function applyChanges(book: StoryBook, ch: unknown, limits: BookLimits = BOOK_LIMITS): { applied: StoryChange[]; refused: { change: unknown; why: string }[] } {
  const applied: StoryChange[] = [];
  const refused: { change: unknown; why: string }[] = [];
  if (!Array.isArray(ch)) return { applied, refused: [{ change: ch, why: 'that is not a list of changes' }] };
  for (const raw of ch) {
    const r = applyChange(book, raw, limits);
    if (r.change) applied.push(r.change);
    else refused.push({ change: raw, why: r.why ?? 'that is not a change this book takes' });
  }
  if (applied.length) book.rev++;
  return { applied, refused };
}

/**
 * A working copy of a book for the rules to write to while they work out what an event does: the book
 * itself is never touched, and the changes the rules made are what a host applies to it afterwards. Only
 * the lists and tables are copied, never the records in them, which is why a job's record is only ever
 * replaced and never changed in place.
 */
export function draftOf(book: StoryBook): StoryBook {
  const d: StoryBook = { ...book, waypoints: book.waypoints.map((w) => ({ ...w })), wpOff: [...book.wpOff], tracked: [...book.tracked] };
  if (book.quests) d.quests = table(book.quests);
  if (book.flags) d.flags = table(book.flags);
  if (book.paid) d.paid = table(book.paid);
  if (book.closed) d.closed = [...book.closed];
  if (book.tracks) d.tracks = table(book.tracks as Record<string, TrackRec>);
  if (book.qwpOn) d.qwpOn = [...book.qwpOn];
  return d;
}

/**
 * Whether a book holds nothing at all: no waypoint, nothing switched off or tracked, and no section a
 * later wave wrote. An empty book from a browser that believes a server already holds this character
 * is a cleared cache, not a story, and is never written down over one.
 */
export function bookIsEmpty(book: StoryBook): boolean {
  if (book.waypoints.length || book.wpOff.length || book.trackWp || book.tracked.length) return false;
  for (const k of Object.keys(book)) {
    if (KNOWN.includes(k)) continue;
    const v = book[k];
    if (v === null || v === undefined || v === 0 || v === '' || v === false) continue;
    if (Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v as object).length : true) return false;
  }
  return true;
}

/**
 * Every reward a book says a browser paid, marked as paid by whoever is named. A book a server takes from
 * a browser has its browser-paid rewards marked `browser`, so the server never pays them again. A row a
 * server already paid (`server`) or paid at a settle (`settle`) keeps that word: it is the one fact a later
 * settle reads to tell a reward somebody still owes from one already paid, and a book carrying a reward
 * the server paid from a copy it handed down, relabelled the browser's, would be paid a second time once
 * the copy it came from had been archived away. Only a row that names nobody, or names the browser, is
 * marked. The section is a later wave's, and a book without one is left as it is.
 */
export function markPaidBy(book: StoryBook, by: 'server' | 'browser' | 'settle'): number {
  const paid = book.paid;
  if (!paid || typeof paid !== 'object' || Array.isArray(paid)) return 0;
  let n = 0;
  for (const key of Object.keys(paid)) {
    const row = (paid as Record<string, unknown>)[key];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const was = (row as Record<string, unknown>).by;
    if (was === 'server' || was === 'settle') continue;
    (row as Record<string, unknown>).by = by;
    n++;
  }
  return n;
}

/** What a book holds, in numbers: what `__debug.story()` and the server's status page print. */
export function bookSummary(book: StoryBook | null): { char: string; rev: number; base: number; local: number; waypoints: number; on: number; trackWp: string | null; tracked: number; wpOff: number; quests: number; active: number; flags: number; xp: number; sections: string[] } | null {
  if (!book) return null;
  let on = 0;
  for (const w of book.waypoints) if (w.on) on++;
  let active = 0;
  for (const q of Object.keys(book.quests ?? {})) if (book.quests![q].state === 'active') active++;
  return {
    char: book.char,
    rev: book.rev,
    base: book.base,
    local: book.local,
    waypoints: book.waypoints.length,
    on,
    trackWp: book.trackWp,
    tracked: book.tracked.length,
    wpOff: book.wpOff.length,
    quests: sizeOf(book.quests),
    active,
    flags: sizeOf(book.flags),
    xp: book.xp ?? 0,
    sections: Object.keys(book).filter((k) => !KNOWN.includes(k)),
  };
}
