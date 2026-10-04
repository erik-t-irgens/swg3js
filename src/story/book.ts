// The story book: everything a character's story holds, in one record, and the one function that
// changes it. Pure: no DOM, no three, no clock of its own, and nothing imported but its own folder, so
// the server runs this very file under node's type stripping (`server/stories.mjs`) and the browser
// runs it as it is. There is one rule book and two hosts of it, never two rule books.
//
// **How a book changes.** Only through `applyChanges`, which takes a batch of change records (a closed
// list: `wpSet`, `wpEdit`, `wpOn`, `wpGone`, `qwpOn`, `trackWp`, `track` for the waypoints and the
// tracker; `qState`, `step`, `flag`, `paid`, `xp`, `trackAdd`, `closed` for the jobs; `heard`, `npcMet`
// for the conversations; `docGive`, `docOpen`, `docDone`, `journal`, `fileAdd` for the documents, the
// journal and the file; `trackSet`, `npc`, `debt`, `companion` for Standing, the story's people, what is
// owed and the companion) and applies each
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
// **Conversations** keep two sections and nothing else: `heard`, every node a character has reached and
// every answer it has given (`<tree>#<node>`, `<tree>#<node>.<reply>`), with when it first happened, which is
// what `heard(...)`, `chosen(...)` and a reply's `once` read; and `npcs`, the people it has met and been told
// the name of (`met`, `named`), which a later wave adds Standing, Trust and the rest to. Where a conversation
// stands is never in the book: a host keeps that for the line it is on, so a reload starts it cleanly.
//
// **Documents, the journal and the file.** `docs` is every document handed over, by its id, with where it was
// handed from, the journal entry it was frozen into the first time it was opened (`j`) and when it was read to
// its end (`done`): what is still to read is what is handed and not done (`docGive`, `docOpen`, `docDone`).
// `journal` is what the character witnessed, in order (`journal.ts`), and `files` what an agency has on them
// (`file.ts`). Neither of the last two has a change that takes anything away: an entry is only ever added
// (`journal`, `fileAdd`), each with the next id in line, and a list is replaced by a longer one rather than
// changed in place, so a working copy (`draftOf`) shares them with the book it was taken from.
//
// **Standing, the people, the debts and the companion.** A track's whole record -- its Standing and Trust,
// the rank held, its status, its cell, the Empire's division, a suspension and what a burn left behind, and
// the history of all of it -- is replaced whole (`trackSet`), as a named person's is (`npc`: their own
// Standing and Trust, whether they will speak to the character, whether they are alive and what the
// character knows of that, and where they were last seen), a debt is set to what is owed (`debt`), and the
// one companion's record is replaced or cleared (`companion`). Every number in them is worked out by the rules
// (`quests.ts`, `standing.ts`) before it is written, clamped and capped, so applying a batch is storing it and
// two hosts whose tunes differ still apply each other's batches to the same book.
//
// Every number here is ours.

import { cleanFileEntry, cleanFileRec, fileShrinks, isAgency, nextFileId, type Agency, type FileEntry, type FileRec } from './file.ts';
import { cleanJournal, cleanJournalEntry, isDocId, isJournalId, journalShrinks, mineFits, nextJournalId, type JournalEntry } from './journal.ts';
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
  /** Every node reached and answer given in a conversation (`<tree>#<node>`, `<tree>#<node>.<reply>`), with when it first was. */
  heard?: Record<string, number>;
  /** The people met (`<set>:cast/<id>`, `row:<key>`), and whether they gave their name. */
  npcs?: Record<string, NpcRec>;
  /** Every document handed over, by its id: what is still to read, and the journal entry each was frozen into. */
  docs?: Record<string, DocRec>;
  /** What the character witnessed, in order: only ever added to. */
  journal?: JournalEntry[];
  /** What an agency has on the character, by agency (`isb`): only ever added to. */
  files?: Partial<Record<Agency, FileRec>>;
  /** What the character owes, by whom it is owed to: credits a fine could not take, and debts the story wrote. */
  debts?: Record<string, number>;
  /** The one companion, or null with none. */
  companion?: CompanionRec | null;
  /** Sections a later wave writes, kept as they came. */
  [section: string]: unknown;
}

/** What a named person lets the character do: speak freely, warily, not at all, or again since somebody vouched for them. */
export type Access = 'open' | 'wary' | 'refused' | 'vouched';
export const ACCESS: readonly Access[] = ['open', 'wary', 'refused', 'vouched'];

/** How a track stands with the character: never asked, holding leverage over them, taken on, suspended, or burned. */
export type TrackStatus = 'none' | 'used' | 'active' | 'suspended' | 'burned';
export const TRACK_STATUSES: readonly TrackStatus[] = ['none', 'used', 'active', 'suspended', 'burned'];

/** The Empire's divisions a character may be assigned to (the bible's six). */
export const DIVISIONS = ['surveillance', 'investigations', 'interrogation', 'internalAffairs', 'enforcement', 'reEducation'] as const;
export type Division = (typeof DIVISIONS)[number];

/** One line of a track's history: when, what was done, and what it changed from and to. */
export interface TrackHistory {
  at: number;
  what: string;
  from: string | number | null;
  to: string | number | null;
}

/** Where a companion told to wait is waiting: the world, the place in the frame a story writes places in, and a room. */
export interface WaitAt {
  world: string;
  raw: [number, number];
  room?: { cell: string };
}

export type CompanionState = 'active' | 'waiting' | 'downed' | 'dead' | 'released';
export const COMPANION_STATES: readonly CompanionState[] = ['active', 'waiting', 'downed', 'dead', 'released'];

/**
 * The one companion: who, how they stand (with the character, waiting where they were told to, down in a fight,
 * dead by the story's word, or let go and back where they were left), where they wait, how many times they have
 * gone down, and when they last did and when they joined.
 */
export interface CompanionRec {
  who: string;
  state: CompanionState;
  waitAt?: WaitAt;
  downs: number;
  downedAt?: number;
  recruitedAt: number;
}

/**
 * A document handed over: when (`at`), from where (the job and its step, or a job's card offered), who calls
 * when it is a call (`from`), the journal entry it was frozen into the first time it was opened (`j`), and when
 * it was read to its end (`done`). Handed again, it is a new handing: read again, and frozen again.
 */
export interface DocRec {
  at: number;
  quest?: string;
  step?: string;
  card?: 1;
  from?: string;
  j?: string;
  done?: number;
}

/**
 * A person as a character knows them: when they first spoke (`met`) and when they gave their name (`named`);
 * and, for a person the story names (a cast member, or one of the game's own people a cast file promotes),
 * their own Standing and Trust toward the character, whether they will speak to them (`access`), whether
 * they are alive -- the truth, which the People tab never shows -- and what the character knows of it
 * (`known`: dead, and the document that told them), with when and where they were last seen.
 */
export interface NpcRec {
  met?: number;
  named?: number;
  standing?: number;
  trust?: number;
  access?: Access;
  alive?: boolean;
  diedAt?: number;
  how?: string;
  known?: { alive?: boolean; by?: string };
  lastSeenAt?: number;
  lastSeenWhere?: string;
  [field: string]: unknown;
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

/**
 * A track as the character stands on it: Standing and Trust, the rung held (`rank`, a ladder's rung id, or
 * null), the status, the cell (the Rebellion's cell, the Empire's sector office, the freelance licence), the
 * Empire's division, a suspension's end, what a burn left behind (`burnedFrom`), when the status last changed
 * (`since`) and the history of every change, newest last. Only Standing and Trust are always there: a record
 * from before ranks reads as no rank, status none.
 */
export interface TrackRec {
  standing: number;
  trust: number;
  rank?: string | null;
  status?: TrackStatus;
  cell?: string | null;
  division?: Division;
  attached?: string;
  suspendedUntil?: number;
  burnedFrom?: string;
  since?: number;
  history?: TrackHistory[];
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
  /** Conversation nodes reached and answers given that a book remembers. */
  heard: number;
  /** People a character remembers meeting. */
  npcs: number;
  /** Entries a journal holds; past it nothing more is written, and nothing is ever taken away. */
  journal: number;
  /** Entries one agency's file holds. */
  file: number;
  /** Documents a book remembers handing over. */
  docs: number;
  /** People a debt is owed to. */
  debts: number;
  /** Lines of one track's history. */
  trackHistory: number;
}

export const BOOK_LIMITS: BookLimits = { waypoints: WAYPOINT_TUNE.max, tracked: 3, wpOff: 4000, sectionNodes: 200000, quests: 4000, steps: 64, flags: 2000, paid: 20000, closed: 4000, history: 8, heard: 20000, npcs: 2000, journal: 20000, file: 5000, docs: 4000, debts: 200, trackHistory: 64 };

/**
 * What a browser holds a book to that a server decided, rather than one it changes itself: the server's own
 * batches, its book handed down, and that book read back out of storage. A server may run with caps of its
 * own (`--set story.waypoints=200`), so these are only a backstop against nonsense and never a second
 * judgement: a copy read back under the browser's own caps would come out cut to them, and a change made
 * alone on top of it would then hand the server back a book shorter than the one it wrote down. A change a
 * browser makes itself is still held to `BOOK_LIMITS` when it is applied.
 */
export const BACKSTOP_LIMITS: BookLimits = { waypoints: 10000, tracked: 100, wpOff: 100000, sectionNodes: 2000000, quests: 40000, steps: 640, flags: 20000, paid: 200000, closed: 40000, history: 8, heard: 200000, npcs: 40000, journal: 200000, file: 50000, docs: 40000, debts: 2000, trackHistory: 640 };

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
  | { k: 'trackAdd'; track: Track; standing: number; trust?: number }
  | { k: 'closed'; quest: string }
  | { k: 'heard'; key: string; at: number }
  | { k: 'npcMet'; who: string; at: number; named?: boolean }
  | { k: 'docGive'; doc: string; at: number; quest?: string; step?: string; card?: 1; from?: string }
  | { k: 'docOpen'; doc: string; j: string }
  | { k: 'docDone'; doc: string; at: number }
  | { k: 'journal'; entry: JournalEntry }
  | { k: 'fileAdd'; agency: Agency; entry: FileEntry; level: number }
  | { k: 'trackSet'; track: Track; rec: TrackRec }
  | { k: 'npc'; who: string; rec: NpcRec }
  | { k: 'debt'; to: string; owed: number }
  | { k: 'companion'; rec: CompanionRec | null };

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
/** A conversation's node or answer as `heard` keeps it: `<tree>#<node>` or `<tree>#<node>.<reply>`. */
const HEARD_KEY = /^[A-Za-z0-9_-]{1,24}:talk\/[A-Za-z0-9_.-]{1,96}#[A-Za-z0-9_-]{1,48}(\.[A-Za-z0-9_-]{1,48})?$/;
/** A person a story names: one of a set's cast (`<set>:cast/<id>`), or one of the game's own people (`row:<key>`). */
const WHO = /^(row:[A-Za-z0-9_.-]{1,96}|[A-Za-z0-9_-]{1,24}:cast\/[A-Za-z0-9_.-]{1,96})$/;
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

export function isHeardKey(x: unknown): x is string {
  return typeof x === 'string' && HEARD_KEY.test(x);
}

export function isWho(x: unknown): x is string {
  return typeof x === 'string' && WHO.test(x);
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

/** A rung's id, a cell's name, a division's: a plain word. */
const RANK_WORD = /^[A-Za-z0-9_.:-]{1,64}$/;
/** What a debt is owed to: a plain name, as a flag's is (`cast/x`, `fines`, `test.bank`). */
const DEBT_KEY = /^[A-Za-z0-9_.:/-]{1,64}$/;

export function isRankWord(x: unknown): x is string {
  return typeof x === 'string' && RANK_WORD.test(x) && !FORBIDDEN_KEYS.includes(x);
}

export function isDebtKey(x: unknown): x is string {
  return typeof x === 'string' && DEBT_KEY.test(x) && !FORBIDDEN_KEYS.includes(x);
}

function finite(x: unknown, lo = -COUNT_MAX, hi = COUNT_MAX): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : undefined;
}

/**
 * One track's record, cleaned: Standing and Trust always (nought where they are not numbers), every field this
 * wave knows rebuilt to its kind, and the history held to its length from the newest. Anything else a later
 * wave adds is kept when it is plain data, as any later section is.
 */
export function cleanTrackRec(x: unknown, limits: BookLimits = BOOK_LIMITS): TrackRec | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const rest = plainCopy(r, 1, { left: 2000 });
  const row: TrackRec = { ...(rest && typeof rest === 'object' && !Array.isArray(rest) ? (rest as Record<string, unknown>) : {}), standing: 0, trust: 0 };
  for (const k of ['rank', 'status', 'cell', 'division', 'attached', 'suspendedUntil', 'burnedFrom', 'since', 'history']) delete row[k];
  row.standing = finite(r.standing) ?? 0;
  row.trust = finite(r.trust) ?? 0;
  if (r.rank === null) row.rank = null;
  else if (isRankWord(r.rank)) row.rank = r.rank;
  if ((TRACK_STATUSES as readonly unknown[]).includes(r.status)) row.status = r.status as TrackStatus;
  if (r.cell === null) row.cell = null;
  else if (isRankWord(r.cell)) row.cell = r.cell;
  if ((DIVISIONS as readonly unknown[]).includes(r.division)) row.division = r.division as Division;
  if (isRankWord(r.attached)) row.attached = r.attached;
  const until = time(r.suspendedUntil);
  if (until !== undefined) row.suspendedUntil = until;
  if (isRankWord(r.burnedFrom)) row.burnedFrom = r.burnedFrom;
  const since = time(r.since);
  if (since !== undefined) row.since = since;
  if (Array.isArray(r.history)) {
    const history: TrackHistory[] = [];
    for (const h of r.history) {
      if (!h || typeof h !== 'object' || Array.isArray(h)) continue;
      const o = h as Record<string, unknown>;
      const what = words(o.what);
      if (!what) continue;
      const side = (v: unknown): string | number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? (words(v) ?? null) : null);
      history.push({ at: time(o.at) ?? 0, what: what.slice(0, 32), from: side(o.from), to: side(o.to) });
    }
    while (history.length > limits.trackHistory) history.shift();
    row.history = history;
  }
  return row;
}

function cleanTracks(x: unknown, limits: BookLimits): Partial<Record<Track, TrackRec>> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out: Partial<Record<Track, TrackRec>> = table<TrackRec>();
  for (const t of TRACKS) {
    const row = cleanTrackRec((x as Record<string, unknown>)[t], limits);
    if (row) out[t] = row;
  }
  return out;
}

/** One person's record, cleaned: every field this wave knows rebuilt to its kind, anything else plain data kept as it came. */
export function cleanNpcRec(x: unknown): NpcRec | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const v = x as Record<string, unknown>;
  // What a later wave keeps on a person is kept when it is plain data, as any later section is.
  const rest = plainCopy(v, 1, { left: 200 });
  const row: NpcRec = { ...(rest && typeof rest === 'object' && !Array.isArray(rest) ? (rest as Record<string, unknown>) : {}) };
  for (const k of ['met', 'named', 'standing', 'trust', 'access', 'alive', 'diedAt', 'how', 'known', 'lastSeenAt', 'lastSeenWhere']) delete row[k];
  const met = time(v.met);
  const named = time(v.named);
  if (met !== undefined) row.met = met;
  if (named !== undefined) row.named = named;
  const standing = finite(v.standing, -1e9, 1e9);
  if (standing !== undefined) row.standing = standing;
  const trust = finite(v.trust, -1e9, 1e9);
  if (trust !== undefined) row.trust = trust;
  if ((ACCESS as readonly unknown[]).includes(v.access)) row.access = v.access as Access;
  if (typeof v.alive === 'boolean') row.alive = v.alive;
  const died = time(v.diedAt);
  if (died !== undefined) row.diedAt = died;
  if (isRankWord(v.how)) row.how = v.how;
  if (v.known && typeof v.known === 'object' && !Array.isArray(v.known)) {
    const k = v.known as Record<string, unknown>;
    const known: { alive?: boolean; by?: string } = {};
    if (typeof k.alive === 'boolean') known.alive = k.alive;
    if (isDocId(k.by)) known.by = k.by;
    row.known = known;
  }
  const seen = time(v.lastSeenAt);
  if (seen !== undefined) row.lastSeenAt = seen;
  const where = words(v.lastSeenWhere);
  if (where) row.lastSeenWhere = where.slice(0, 64);
  return row;
}

/** The one companion's record, cleaned, or null when it is not one. */
export function cleanCompanionRec(x: unknown): CompanionRec | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!isWho(o.who) || !(COMPANION_STATES as readonly unknown[]).includes(o.state)) return null;
  const out: CompanionRec = { who: o.who, state: o.state as CompanionState, downs: count(o.downs), recruitedAt: time(o.recruitedAt) ?? 0 };
  const down = time(o.downedAt);
  if (down !== undefined) out.downedAt = down;
  if (o.waitAt && typeof o.waitAt === 'object' && !Array.isArray(o.waitAt)) {
    const w = o.waitAt as Record<string, unknown>;
    const world = cleanWorld(w.world);
    const p = Array.isArray(w.raw) && w.raw.length === 2 ? cleanPlace(w.raw) : null;
    if (world && p) {
      out.waitAt = { world, raw: [p[0], p[1]] };
      const room = w.room && typeof w.room === 'object' ? (w.room as Record<string, unknown>).cell : undefined;
      if (typeof room === 'string' && /^[A-Za-z0-9_ .-]{1,64}$/.test(room)) out.waitAt.room = { cell: room };
    }
  }
  return out;
}

function cleanDebts(x: unknown, limits: BookLimits): Record<string, number> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out = table<number>();
  for (const k of Object.keys(x)) {
    const v = finite((x as Record<string, unknown>)[k], 0, 1e12);
    if (!isDebtKey(k) || v === undefined || v <= 0 || sizeOf(out) >= limits.debts) continue;
    out[k] = v;
  }
  return out;
}

function cleanHeard(x: unknown, limits: BookLimits): Record<string, number> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out = table<number>();
  for (const k of Object.keys(x)) {
    const at = time((x as Record<string, unknown>)[k]);
    if (!isHeardKey(k) || at === undefined || sizeOf(out) >= limits.heard) continue;
    out[k] = at;
  }
  return out;
}

function cleanNpcs(x: unknown, limits: BookLimits): Record<string, NpcRec> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out = table<NpcRec>();
  for (const k of Object.keys(x)) {
    if (!isWho(k) || sizeOf(out) >= limits.npcs) continue;
    const row = cleanNpcRec((x as Record<string, unknown>)[k]);
    if (row) out[k] = row;
  }
  return out;
}

/** One document's record, cleaned, or null. */
function cleanDocRec(x: unknown): DocRec | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const at = time(o.at);
  if (at === undefined) return null;
  const out: DocRec = { at };
  if (isQuestId(o.quest)) out.quest = o.quest;
  if (isStepName(o.step)) out.step = o.step;
  if (o.card === 1 || o.card === true) out.card = 1;
  if (isWho(o.from)) out.from = o.from;
  if (isJournalId(o.j)) out.j = o.j;
  const done = time(o.done);
  if (done !== undefined) out.done = done;
  return out;
}

function cleanDocs(x: unknown, limits: BookLimits): Record<string, DocRec> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out = table<DocRec>();
  for (const k of Object.keys(x)) {
    if (!isDocId(k) || sizeOf(out) >= limits.docs) continue;
    const rec = cleanDocRec((x as Record<string, unknown>)[k]);
    if (rec) out[k] = rec;
  }
  return out;
}

function cleanFiles(x: unknown, limits: BookLimits): Partial<Record<Agency, FileRec>> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out = table<FileRec>() as Partial<Record<Agency, FileRec>>;
  for (const k of Object.keys(x)) {
    if (!isAgency(k)) continue;
    const rec = cleanFileRec((x as Record<string, unknown>)[k], limits.file);
    if (rec) out[k] = rec;
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
  heard: cleanHeard,
  npcs: cleanNpcs,
  docs: cleanDocs,
  journal: (x, limits) => cleanJournal(x, limits.journal),
  files: cleanFiles,
  debts: cleanDebts,
  companion: (x) => (x === null ? null : (cleanCompanionRec(x) ?? undefined)),
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
    case 'trackAdd': {
      if (!isTrack(o.track) || typeof o.standing !== 'number' || !Number.isFinite(o.standing) || Math.abs(o.standing) > 1e9) return null;
      const out: { k: 'trackAdd'; track: Track; standing: number; trust?: number } = { k: 'trackAdd', track: o.track, standing: o.standing };
      if (o.trust !== undefined) {
        if (typeof o.trust !== 'number' || !Number.isFinite(o.trust) || Math.abs(o.trust) > 1e9) return null;
        out.trust = o.trust;
      }
      return out;
    }
    case 'closed':
      return isQuestId(o.quest) ? { k: 'closed', quest: o.quest } : null;
    case 'heard': {
      const at = time(o.at);
      return isHeardKey(o.key) && at !== undefined ? { k: 'heard', key: o.key, at } : null;
    }
    case 'npcMet': {
      const at = time(o.at);
      if (!isWho(o.who) || at === undefined) return null;
      return o.named === true ? { k: 'npcMet', who: o.who, at, named: true } : { k: 'npcMet', who: o.who, at };
    }
    case 'docGive': {
      const at = time(o.at);
      if (!isDocId(o.doc) || at === undefined) return null;
      const out: Extract<StoryChange, { k: 'docGive' }> = { k: 'docGive', doc: o.doc, at };
      if (o.quest !== undefined) {
        if (!isQuestId(o.quest)) return null;
        out.quest = o.quest;
      }
      if (o.step !== undefined) {
        if (!isStepName(o.step)) return null;
        out.step = o.step;
      }
      if (o.card === 1 || o.card === true) out.card = 1;
      if (o.from !== undefined) {
        if (!isWho(o.from)) return null;
        out.from = o.from;
      }
      return out;
    }
    case 'docOpen':
      return isDocId(o.doc) && isJournalId(o.j) ? { k: 'docOpen', doc: o.doc, j: o.j } : null;
    case 'docDone': {
      const at = time(o.at);
      return isDocId(o.doc) && at !== undefined ? { k: 'docDone', doc: o.doc, at } : null;
    }
    case 'journal': {
      // An entry's id is its place in its own journal, which is checked when it is taken (`whyNot`).
      const entry = cleanJournalEntry(o.entry);
      return entry ? { k: 'journal', entry } : null;
    }
    case 'fileAdd': {
      if (!isAgency(o.agency) || typeof o.level !== 'number' || !Number.isInteger(o.level) || o.level < 0 || o.level > 1000) return null;
      const entry = cleanFileEntry(o.entry);
      return entry ? { k: 'fileAdd', agency: o.agency, entry, level: o.level } : null;
    }
    case 'trackSet': {
      // A whole record, held only to the backstop's history: the rules wrote it to their own caps already.
      const rec = isTrack(o.track) ? cleanTrackRec(o.rec, BACKSTOP_LIMITS) : null;
      return rec ? { k: 'trackSet', track: o.track as Track, rec } : null;
    }
    case 'npc': {
      const rec = isWho(o.who) ? cleanNpcRec(o.rec) : null;
      return rec ? { k: 'npc', who: o.who as string, rec } : null;
    }
    case 'debt': {
      const owed = finite(o.owed, 0, 1e12);
      return isDebtKey(o.to) && owed !== undefined ? { k: 'debt', to: o.to, owed } : null;
    }
    case 'companion': {
      if (o.rec === null) return { k: 'companion', rec: null };
      const rec = cleanCompanionRec(o.rec);
      return rec ? { k: 'companion', rec } : null;
    }
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
    case 'heard':
      // Only the first time is kept: what `heard` and `once` read is that it happened at all.
      if (ownOf(book.heard, c.key) !== undefined) return 'that is heard already';
      return sizeOf(book.heard) >= limits.heard ? `a book remembers ${limits.heard} things heard` : null;
    case 'npcMet': {
      const had = ownOf(book.npcs, c.who);
      if (had && had.met !== undefined && (!c.named || had.named !== undefined)) return 'that person is known already';
      return !had && sizeOf(book.npcs) >= limits.npcs ? `a character remembers ${limits.npcs} people` : null;
    }
    case 'docGive': {
      const had = ownOf(book.docs, c.doc);
      if (had && had.done === undefined) return 'that document is handed over already';
      return !had && sizeOf(book.docs) >= limits.docs ? `a book remembers ${limits.docs} documents` : null;
    }
    case 'docOpen': {
      const had = ownOf(book.docs, c.doc);
      if (!had) return 'that document was never handed over';
      if (had.j !== undefined) return 'that document is opened already';
      return (book.journal ?? []).some((e) => e.id === c.j) ? null : 'there is no such journal entry';
    }
    case 'docDone': {
      const had = ownOf(book.docs, c.doc);
      if (!had) return 'that document was never handed over';
      return had.done !== undefined ? 'that document is read already' : null;
    }
    case 'journal': {
      // An entry is only ever the next one: written once, in its place, and never taken away.
      const len = book.journal?.length ?? 0;
      if (c.entry.id !== nextJournalId(len)) return `the next journal entry is ${nextJournalId(len)}, not ${c.entry.id}`;
      if (c.entry.kind === 'mine' && !mineFits(book.journal, c.entry.ref)) return 'a note of your own is written on an entry of the journal';
      return len >= limits.journal ? `a journal holds ${limits.journal} entries` : null;
    }
    case 'fileAdd': {
      const rec = ownOf(book.files as Record<string, FileRec> | undefined, c.agency);
      const len = rec?.entries.length ?? 0;
      if (c.entry.id !== nextFileId(len)) return `the next file entry is ${nextFileId(len)}, not ${c.entry.id}`;
      return len >= limits.file ? `a file holds ${limits.file} entries` : null;
    }
    case 'trackSet':
      return (c.rec.history?.length ?? 0) > limits.trackHistory ? `a track keeps ${limits.trackHistory} lines of history` : null;
    case 'npc':
      return !ownOf(book.npcs, c.who) && sizeOf(book.npcs) >= limits.npcs ? `a character remembers ${limits.npcs} people` : null;
    case 'debt':
      return c.owed > 0 && ownOf(book.debts, c.to) === undefined && sizeOf(book.debts) >= limits.debts ? `a character owes at most ${limits.debts} people` : null;
    case 'companion':
      return null;
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
      tracks[c.track] = { ...t, standing: t.standing + c.standing, trust: (t.trust ?? 0) + (c.trust ?? 0) };
      return;
    }
    case 'closed':
      (book.closed ??= []).push(c.quest);
      return;
    case 'heard':
      (book.heard ??= table<number>())[c.key] = c.at;
      return;
    case 'npcMet': {
      // A person's record is replaced, never changed in place, as the jobs' are (`draftOf`).
      const npcs = (book.npcs ??= table<NpcRec>());
      const had = npcs[c.who];
      const row: NpcRec = { ...had };
      row.met ??= c.at;
      if (c.named) row.named ??= c.at;
      npcs[c.who] = row;
      return;
    }
    // A document's record is replaced as a person's is; handed again, it is a new handing.
    case 'docGive': {
      const row: DocRec = { at: c.at };
      if (c.quest) row.quest = c.quest;
      if (c.step) row.step = c.step;
      if (c.card) row.card = 1;
      if (c.from) row.from = c.from;
      (book.docs ??= table<DocRec>())[c.doc] = row;
      return;
    }
    case 'docOpen': {
      const docs = book.docs!;
      docs[c.doc] = { ...docs[c.doc], j: c.j };
      return;
    }
    case 'docDone': {
      const docs = book.docs!;
      docs[c.doc] = { ...docs[c.doc], done: c.at };
      return;
    }
    // The journal and the files are replaced by a longer list, never pushed to, so a working copy that shares
    // them with its book (`draftOf`) never moves the book.
    case 'journal':
      book.journal = [...(book.journal ?? []), c.entry];
      return;
    case 'fileAdd': {
      const files = (book.files ??= table<FileRec>() as Partial<Record<Agency, FileRec>>);
      const had = files[c.agency] ?? { entries: [], exposure: 0, level: 0 };
      files[c.agency] = { entries: [...had.entries, c.entry], exposure: had.exposure + c.entry.weight * c.entry.mult, level: Math.max(had.level, c.level) };
      return;
    }
    // A track's, a person's and the companion's records are replaced whole, and a debt is set to what is owed:
    // the rules worked every number out before they wrote it, so storing it is all there is to do here.
    case 'trackSet':
      (book.tracks ??= table<TrackRec>())[c.track] = c.rec;
      return;
    case 'npc':
      (book.npcs ??= table<NpcRec>())[c.who] = c.rec;
      return;
    case 'debt': {
      const debts = (book.debts ??= table<number>());
      if (c.owed > 0) debts[c.to] = c.owed;
      else delete debts[c.to];
      return;
    }
    case 'companion':
      book.companion = c.rec;
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
  if (book.heard) d.heard = table(book.heard);
  if (book.npcs) d.npcs = table(book.npcs);
  if (book.docs) d.docs = table(book.docs);
  if (book.files) d.files = table(book.files as Record<string, FileRec>) as Partial<Record<Agency, FileRec>>;
  if (book.debts) d.debts = table(book.debts);
  // The journal is shared, never copied: a change replaces it with a longer list (`applyOne`). The companion's
  // record is replaced whole, never changed in place, so it is shared as it is.
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

/**
 * Why a book handed up may not replace the one a server holds, when it would lose any of the journal or the
 * file within one timeline, or null. One timeline is a book that descends from the server's own copy as it
 * stands: it last matched that copy (`base`) at the revision the copy is at now, so everything in the copy was
 * in the book when it was handed down, and only a book that has had pages taken out of it has fewer. A book
 * from another timeline -- played from nothing, or from a revision the server has moved on from -- is not
 * compared: two timelines are never merged, and which one stands is the character's own settle's to say.
 */
export function shrinksWithin(offered: StoryBook, mine: StoryBook | null | undefined): string | null {
  if (!mine || offered.base <= 0 || offered.base !== mine.rev) return null;
  return journalShrinks(offered.journal, mine.journal) ?? fileShrinks(offered, mine);
}

/** What a book holds, in numbers: what `__debug.story()` and the server's status page print. */
export function bookSummary(book: StoryBook | null): { char: string; rev: number; base: number; local: number; waypoints: number; on: number; trackWp: string | null; tracked: number; wpOff: number; quests: number; active: number; flags: number; xp: number; heard: number; met: number; journal: number; toRead: number; file: number; exposure: number; level: number; ranks: Record<string, string>; debts: number; companion: string | null; sections: string[] } | null {
  if (!book) return null;
  const ranks: Record<string, string> = {};
  for (const t of TRACKS) {
    const r = ownOf(book.tracks as Record<string, TrackRec> | undefined, t);
    if (r && (r.rank || (r.status && r.status !== 'none'))) ranks[t] = `${r.rank ?? 'no rank'} (${r.status ?? 'none'})`;
  }
  let debts = 0;
  for (const k of Object.keys(book.debts ?? {})) debts += book.debts![k];
  let on = 0;
  for (const w of book.waypoints) if (w.on) on++;
  let active = 0;
  for (const q of Object.keys(book.quests ?? {})) if (book.quests![q].state === 'active') active++;
  let toRead = 0;
  for (const d of Object.keys(book.docs ?? {})) if (book.docs![d].done === undefined) toRead++;
  const isb = ownOf(book.files as Record<string, FileRec> | undefined, 'isb');
  return {
    journal: book.journal?.length ?? 0,
    toRead,
    file: isb?.entries.length ?? 0,
    exposure: isb?.exposure ?? 0,
    level: isb?.level ?? 0,
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
    heard: sizeOf(book.heard),
    met: sizeOf(book.npcs),
    ranks,
    debts,
    companion: book.companion ? `${book.companion.who} (${book.companion.state})` : null,
    sections: Object.keys(book).filter((k) => !KNOWN.includes(k)),
  };
}
