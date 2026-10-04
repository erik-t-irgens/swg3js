// The story book: everything a character's story holds, in one record, and the one function that
// changes it. Pure: no DOM, no three, no clock of its own, and nothing imported but its own folder, so
// the server runs this very file under node's type stripping (`server/stories.mjs`) and the browser
// runs it as it is. There is one rule book and two hosts of it, never two rule books.
//
// **How a book changes.** Only through `applyChanges`, which takes a batch of change records (a closed
// list: `wpSet`, `wpEdit`, `wpOn`, `wpGone`, `qwpOn`, `trackWp`, `track` in this wave) and applies each
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
// **What later waves add.** Sections this wave does not know (`quests`, `flags`, `paid`, `journal` and
// the rest) are kept as they came when they are well formed -- plain data, no key that means something
// to the language, not too deep and not too big -- and dropped whole when they are not, so a book
// written by a newer browser passes through an older one without being cut up.
//
// Every number here is ours.

import { FORBIDDEN_KEYS, WAYPOINT_TUNE, cleanWaypoint, cleanWaypointName, isQuestWaypoint, isWaypointColour, isWaypointId, waypointNumber, type Waypoint, type WaypointColour } from './waypoints.ts';

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
  /** Sections a later wave writes, kept as they came. */
  [section: string]: unknown;
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
}

export const BOOK_LIMITS: BookLimits = { waypoints: WAYPOINT_TUNE.max, tracked: 3, wpOff: 4000, sectionNodes: 200000 };

/**
 * What a browser holds a book to that a server decided, rather than one it changes itself: the server's own
 * batches, its book handed down, and that book read back out of storage. A server may run with caps of its
 * own (`--set story.waypoints=200`), so these are only a backstop against nonsense and never a second
 * judgement: a copy read back under the browser's own caps would come out cut to them, and a change made
 * alone on top of it would then hand the server back a book shorter than the one it wrote down. A change a
 * browser makes itself is still held to `BOOK_LIMITS` when it is applied.
 */
export const BACKSTOP_LIMITS: BookLimits = { waypoints: 10000, tracked: 100, wpOff: 100000, sectionNodes: 2000000 };

/** One change. A closed list: anything else is not a change this book takes. */
export type StoryChange =
  | { k: 'wpSet'; wp: Waypoint }
  | { k: 'wpEdit'; id: string; name?: string; colour?: WaypointColour }
  | { k: 'wpOn'; id: string; on: boolean }
  | { k: 'wpGone'; id: string }
  | { k: 'qwpOn'; key: string; on: boolean }
  | { k: 'trackWp'; id: string | null }
  | { k: 'track'; quest: string; on: boolean };

/** The sections this wave reads itself; every other one is a later wave's, kept as it came. */
const KNOWN = ['v', 'char', 'rev', 'base', 'local', 'waypoints', 'nextWp', 'wpOff', 'trackWp', 'tracked'];

/** A character id as the browser makes them (`server/wire.mjs` holds the same rule). */
const CHARACTER = /^[A-Za-z0-9_.-]{1,64}$/;
/** A quest's id: its set's prefix and its own name (`own:courier`, `test:goto`). */
const QUEST_ID = /^[A-Za-z0-9_-]{1,24}:[A-Za-z0-9_./-]{1,96}$/;
/** How deep a later wave's section may nest before it is not well formed. */
const SECTION_DEPTH = 24;
/** The largest a counter may be before it is nonsense. */
const COUNT_MAX = 1e12;

export function isCharacterId(x: unknown): x is string {
  return typeof x === 'string' && CHARACTER.test(x) && !FORBIDDEN_KEYS.includes(x);
}

export function isQuestId(x: unknown): x is string {
  return typeof x === 'string' && QUEST_ID.test(x);
}

function count(x: unknown, least = 0): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= least && x <= COUNT_MAX ? Math.floor(x) : least;
}

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
    if (KNOWN.includes(k) || FORBIDDEN_KEYS.includes(k)) continue;
    const kept = plainCopy(o[k], 0, budget);
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
      return !c.on && !book.wpOff.includes(c.key) && book.wpOff.length >= limits.wpOff ? 'too many of a quest’s waypoints are switched off' : null;
    case 'trackWp':
      return c.id !== null && isWaypointId(c.id) && waypointAt(book, c.id) < 0 ? 'there is no such waypoint' : null;
    case 'track':
      return c.on && !book.tracked.includes(c.quest) && book.tracked.length >= limits.tracked ? `at most ${limits.tracked} jobs are tracked at once` : null;
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
      const at = book.wpOff.indexOf(c.key);
      if (c.on && at >= 0) book.wpOff.splice(at, 1);
      else if (!c.on && at < 0) book.wpOff.push(c.key);
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
  }
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
    const c = cleanChange(raw);
    if (!c) {
      refused.push({ change: raw, why: 'that is not a change this book takes' });
      continue;
    }
    const why = whyNot(book, c, limits);
    if (why) {
      refused.push({ change: raw, why });
      continue;
    }
    applyOne(book, c);
    applied.push(c);
  }
  if (applied.length) book.rev++;
  return { applied, refused };
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
export function bookSummary(book: StoryBook | null): { char: string; rev: number; base: number; local: number; waypoints: number; on: number; trackWp: string | null; tracked: number; wpOff: number; sections: string[] } | null {
  if (!book) return null;
  let on = 0;
  for (const w of book.waypoints) if (w.on) on++;
  return { char: book.char, rev: book.rev, base: book.base, local: book.local, waypoints: book.waypoints.length, on, trackWp: book.trackWp, tracked: book.tracked.length, wpOff: book.wpOff.length, sections: Object.keys(book).filter((k) => !KNOWN.includes(k)) };
}
