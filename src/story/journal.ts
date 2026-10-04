// The journal: what a character witnessed, and nothing else. Pure, nothing imported but this folder and the
// game's own hashing (`src/net/hash.ts`), so the server and the browser keep it by the same rules.
//
// **Witnessed only.** An entry is written by the host that holds the story, and only at the moment it hands
// something to that character's screen: a document opened (`doc`), a call heard (`comm`), a conversation's
// transcript once it closes (`talk`), a line the story notes where the player is present (`note`), and the
// player's own notes on an entry, marked as theirs (`mine`). Never from a hidden step, a deadline that ran
// out on the world clock, a signal raised somewhere else, a file entry, a change of Standing or another
// player's act: none of those is something the player saw.
//
// **It only grows.** There is no change that takes an entry away (`book.ts`), each entry's id is the next
// in line (`j<n>`), and a book handed up whose journal is shorter than the one it would replace, within one
// timeline, is refused (`shrinksWithin`). A later document that says something else is a new entry; status
// is a fact on the quest list and never an entry here.
//
// **The words are kept by what they say.** An entry carries the hash of its text (`textHash`: SHA-256, the
// first sixteen hex digits), and the text itself is kept apart, once for everyone who saw it -- a server's
// `storyTexts`, this browser's IndexedDB -- so when the owner rewrites a line, an entry already written still
// shows the words as they were. A text nobody kept shows as `NOT_KEPT` rather than as a guess.
//
// Every number here is ours.

import { hashText } from '../net/hash.ts';
import type { Room } from './set.ts';
import { cleanRoom, cleanWorld, FORBIDDEN_KEYS } from './waypoints.ts';

/** The journal's own numbers. Ours. */
export const JOURNAL_TUNE = {
  /** Entries a page of the journal window shows. */
  page: 50,
  /** Lines one conversation's transcript keeps, its first ones. */
  talkLines: 200,
  /** The longest note of the player's own, in characters. */
  mineMax: 400,
};

/** Set any of those, clamped; the answer is the table as it stands. */
export function tuneJournal(o: Partial<typeof JOURNAL_TUNE> | null | undefined): typeof JOURNAL_TUNE {
  const n = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (o && n(o.page)) JOURNAL_TUNE.page = Math.max(5, Math.min(500, Math.round(o.page)));
  if (o && n(o.talkLines)) JOURNAL_TUNE.talkLines = Math.max(10, Math.min(1000, Math.round(o.talkLines)));
  if (o && n(o.mineMax)) JOURNAL_TUNE.mineMax = Math.max(40, Math.min(4000, Math.round(o.mineMax)));
  return JOURNAL_TUNE;
}

/** What an entry whose words nobody kept shows. */
export const NOT_KEPT = '[this page was not kept]';

export const JOURNAL_KINDS = ['doc', 'talk', 'comm', 'note', 'mine'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/**
 * Where it happened: the world, and the place across the ground in the frame a story writes places in (the
 * raw frame on a planet, the zone's own game frame in space), with the room when there was one.
 */
export interface JournalPlace {
  world: string;
  raw: [number, number];
  room?: Room;
}

/** One line of a conversation's transcript: whose it was (the player's own, or the speaker's), and its words by their hash. */
export interface JournalLine {
  you?: 1;
  /** The words' hash; absent when nobody handed the words up (a client string a browser did not resolve), when `ref` stands. */
  h?: string;
  /** The reference the line was written as, kept only when its words were not. */
  ref?: string;
}

export interface JournalEntry {
  /** `j<n>`: the n-th entry of this book, never reused. */
  id: string;
  /** When, on the shared clock. */
  at: number;
  kind: JournalKind;
  place: JournalPlace | null;
  /** Who was there: the cast id or the game's own person (`row:<key>`) of the one who spoke or called. */
  with: string[];
  quest?: string;
  /** The document read or the call heard. */
  doc?: string;
  /** The version of it read, frozen as it was read: nothing anywhere says which version is the true one. */
  variant?: string;
  /** What it is called in the list: a document's title, the speaker as named to the player at the time. */
  title?: string;
  /** The whole text's hash: a document's frozen page, a call's, a note's words, the player's own. */
  h?: string;
  /** A conversation's lines in turn. */
  lines?: JournalLine[];
  /** The entry the player's own note is on. */
  ref?: string;
}

/** A text's hash, as the journal keeps it: SHA-256, the first sixteen hex digits. */
export function textHash(text: string): string {
  return hashText(text).slice(0, 16);
}

/** Whether a string is a text's hash. */
export function isTextHash(x: unknown): x is string {
  return typeof x === 'string' && /^[0-9a-f]{16}$/.test(x);
}

/** Whether a string is a journal entry's id. */
export function isJournalId(x: unknown): x is string {
  return typeof x === 'string' && /^j[1-9][0-9]{0,8}$/.test(x);
}

/** The id the next entry of a journal of that many takes. */
export function nextJournalId(len: number): string {
  return `j${len + 1}`;
}

const CONTROL = /[\u0000-\u001f\u007f]/g;
const WHO = /^(row:[A-Za-z0-9_.-]{1,96}|[A-Za-z0-9_-]{1,24}:cast\/[A-Za-z0-9_.-]{1,96})$/;
const QUEST = /^[A-Za-z0-9_-]{1,24}:[A-Za-z0-9_./-]{1,96}$/;
const DOC = /^[A-Za-z0-9_-]{1,24}:doc\/[A-Za-z0-9_.-]{1,96}$/;
const VARIANT = /^[A-Za-z0-9_-]{1,48}$/;
const REF = /^@[A-Za-z0-9_/.-]{1,120}:[A-Za-z0-9_.-]{1,120}$/;
/** The longest title an entry keeps, in characters. */
const TITLE_MAX = 160;
/** The most people one entry names. */
const WITH_MAX = 8;
const TIME_MAX = 1e13;

export function isDocId(x: unknown): x is string {
  return typeof x === 'string' && DOC.test(x) && !FORBIDDEN_KEYS.includes(x);
}

/** A place an entry was written at, cleaned, or null. */
export function cleanJournalPlace(x: unknown): JournalPlace | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const world = cleanWorld(o.world);
  const r = o.raw;
  if (!world || !Array.isArray(r) || r.length !== 2 || !r.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7)) return null;
  const out: JournalPlace = { world, raw: [r[0] as number, r[1] as number] };
  const room = o.room === undefined ? null : cleanRoom(o.room);
  if (room) out.room = room;
  return out;
}

/** One entry, from storage or the wire, cleaned, or null when it is not one. Every field rebuilt. */
export function cleanJournalEntry(x: unknown): JournalEntry | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!isJournalId(o.id) || !(JOURNAL_KINDS as readonly unknown[]).includes(o.kind)) return null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) && o.at >= 0 && o.at <= TIME_MAX ? o.at : null;
  if (at === null) return null;
  const out: JournalEntry = { id: o.id, at, kind: o.kind as JournalKind, place: cleanJournalPlace(o.place), with: [] };
  if (Array.isArray(o.with)) for (const w of o.with) if (typeof w === 'string' && WHO.test(w) && !out.with.includes(w) && out.with.length < WITH_MAX) out.with.push(w);
  if (typeof o.quest === 'string' && QUEST.test(o.quest) && !FORBIDDEN_KEYS.includes(o.quest)) out.quest = o.quest;
  if (isDocId(o.doc)) out.doc = o.doc;
  if (typeof o.variant === 'string' && VARIANT.test(o.variant)) out.variant = o.variant;
  if (typeof o.title === 'string') {
    const t = o.title.replace(CONTROL, '').slice(0, TITLE_MAX);
    if (t.trim()) out.title = t;
  }
  if (isTextHash(o.h)) out.h = o.h;
  if (Array.isArray(o.lines)) {
    const lines: JournalLine[] = [];
    for (const l of o.lines) {
      if (lines.length >= JOURNAL_TUNE.talkLines) break;
      if (!l || typeof l !== 'object' || Array.isArray(l)) continue;
      const r = l as Record<string, unknown>;
      const line: JournalLine = {};
      if (r.you === 1 || r.you === true) line.you = 1;
      if (isTextHash(r.h)) line.h = r.h;
      else if (typeof r.ref === 'string' && REF.test(r.ref)) line.ref = r.ref;
      else continue;
      lines.push(line);
    }
    out.lines = lines;
  }
  if (isJournalId(o.ref)) out.ref = o.ref;
  // Each kind carries what it is: a page has its words, a transcript its lines, a note of the player's its entry.
  if ((out.kind === 'doc' || out.kind === 'comm') && (!out.doc || !out.h)) return null;
  if (out.kind === 'talk' && !out.lines) return null;
  if ((out.kind === 'note' || out.kind === 'mine') && !out.h) return null;
  if (out.kind === 'mine' && !out.ref) return null;
  return out;
}

/**
 * A note of the player's own as it is kept: no control characters but the line break and the tab, cut to
 * `mineMax` and then trimmed, so cleaning it twice changes nothing. Every host and the wire clean it with this
 * one function, so the browser that wrote a note can keep its words under the very hash the host writes.
 */
export function cleanMine(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, JOURNAL_TUNE.mineMax).trim();
}

/** Whether a note of the player's own may stand on `ref` in this journal: an entry already in it, and not one of their own notes. */
export function mineFits(journal: readonly JournalEntry[] | undefined, ref: string | undefined): boolean {
  if (!ref || !journal) return false;
  const n = Number(ref.slice(1));
  const on = journal[n - 1];
  return !!on && on.id === ref && on.kind !== 'mine';
}

/** A journal from storage or the wire, cleaned: every entry that is one, in order, ids as they came, up to `max`. */
export function cleanJournal(x: unknown, max: number): JournalEntry[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: JournalEntry[] = [];
  for (const e of x) {
    if (out.length >= max) break;
    const entry = cleanJournalEntry(e);
    // An entry out of its place is not one this journal wrote: what follows it would be numbered wrong. Nor is a
    // note of the player's own on an entry before it that is not there, or is a note of their own.
    if (!entry || entry.id !== nextJournalId(out.length) || (entry.kind === 'mine' && !mineFits(out, entry.ref))) break;
    out.push(entry);
  }
  return out;
}

/** The texts a journal names, by hash: what a server asks a browser for when it takes that browser's book. */
export function journalHashes(journal: readonly JournalEntry[] | undefined): string[] {
  const out = new Set<string>();
  for (const e of journal ?? []) {
    if (e.h) out.add(e.h);
    for (const l of e.lines ?? []) if (l.h) out.add(l.h);
  }
  return [...out];
}

/** What the journal window filters by: a world, a person, a job. Any left out takes everything. */
export interface JournalFilter {
  world?: string | null;
  who?: string | null;
  quest?: string | null;
  kind?: JournalKind | null;
}

/** Whether an entry passes a filter. */
export function journalPasses(e: JournalEntry, f: JournalFilter | null | undefined): boolean {
  if (!f) return true;
  if (f.world && e.place?.world !== f.world) return false;
  if (f.who && !e.with.includes(f.who)) return false;
  if (f.quest && e.quest !== f.quest) return false;
  if (f.kind && e.kind !== f.kind) return false;
  return true;
}

/**
 * One page of the entries that pass a filter, oldest first within the page and the newest page last, as a
 * journal reads: `page` counts from 0; `pages` is how many there are. The player's own notes are not listed
 * among the entries: they are shown on the entry they are written on.
 */
export function journalPage(journal: readonly JournalEntry[] | undefined, f: JournalFilter | null | undefined, page: number, size = JOURNAL_TUNE.page): { entries: JournalEntry[]; page: number; pages: number; total: number } {
  const all = (journal ?? []).filter((e) => e.kind !== 'mine' && journalPasses(e, f));
  const per = Math.max(1, Math.floor(size));
  const pages = Math.max(1, Math.ceil(all.length / per));
  const p = Math.max(0, Math.min(pages - 1, Math.floor(Number.isFinite(page) ? page : pages - 1)));
  return { entries: all.slice(p * per, (p + 1) * per), page: p, pages, total: all.length };
}

/** The player's own notes on an entry, in order. */
export function minesOn(journal: readonly JournalEntry[] | undefined, id: string): JournalEntry[] {
  return (journal ?? []).filter((e) => e.kind === 'mine' && e.ref === id);
}

/**
 * What a filter can be set to, read off a journal: every world an entry was written on, everybody it names
 * and every job, each once, in the order they first appear.
 */
export function journalFacets(journal: readonly JournalEntry[] | undefined): { worlds: string[]; who: string[]; quests: string[] } {
  const worlds: string[] = [];
  const who: string[] = [];
  const quests: string[] = [];
  for (const e of journal ?? []) {
    if (e.kind === 'mine') continue;
    if (e.place && !worlds.includes(e.place.world)) worlds.push(e.place.world);
    for (const w of e.with) if (!who.includes(w)) who.push(w);
    if (e.quest && !quests.includes(e.quest)) quests.push(e.quest);
  }
  return { worlds, who, quests };
}

/**
 * Whether a book handed up loses pages of the one it would replace within the same timeline: it descends
 * from that copy (`base`, the revision it last matched, is the copy's own revision now, so the copy has not
 * moved since) and yet holds fewer entries, or other entries where the copy's are. A book from another
 * timeline -- played from nothing, or from a revision the server's copy has moved on from -- replaces it
 * whole or not at all as the character's own settle says, and is never compared entry by entry, since two
 * timelines are never merged. The reason, or null when nothing is lost.
 */
export function journalShrinks(offered: readonly JournalEntry[] | undefined, mine: readonly JournalEntry[] | undefined): string | null {
  const a = offered ?? [];
  const b = mine ?? [];
  if (a.length < b.length) return `that book's journal has ${a.length} entries where this server's has ${b.length}`;
  for (let i = 0; i < b.length; i++) {
    if (a[i].id !== b[i].id || a[i].kind !== b[i].kind || (a[i].h ?? '') !== (b[i].h ?? '')) return `that book's journal differs from this server's at ${b[i].id}`;
  }
  return null;
}
