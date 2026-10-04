// The ISB's file on a character: what the agency has on them, which only ever grows, and which works on
// people before the player can read why. Pure, nothing imported but this folder, so the server and the
// browser keep it by the same rules.
//
// **What it is.** `files.isb` in the book: the entries, each with its kind (an intercept, a sighting, an
// associate, an incident, a classification, a note), its weight, the document that is its page where it
// has one, its tags, where in the story it was written and when the player may see it (`revealAt`); the
// exposure, which is every entry's weight times the exposure multiplier of the ranks the player held when it
// was written (one until the ranks arrive), and the level that exposure has reached by the set's own
// thresholds (`file.jsonc`).
//
// **It never shrinks.** No change takes an entry away or lowers the exposure (`book.ts`), a weight is never
// below nought (misfiling, which would lower one, is kept for a later pass), and a book handed up whose file
// is shorter or whose exposure is lower than the one it would replace, within one timeline, is refused
// (`fileShrinks`). The level is kept on the record and never falls: a threshold the owner raises later does
// not take a level away, and one lowered is reached at the next entry.
//
// **Before the player knows why.** A condition reads the level and the tags at once (`fileLevel(isb)`,
// `fileHas(isb, tag)`), and a level may make people greet coldly (`reacts`, which the view hands the
// browser); the player sees an entry only once its `revealAt` has passed (`FILE_TUNE.revealGameHours`, or
// the set's own), or once the story has handed them the entry's own page. Nothing about the file is ever
// said on the message line.
//
// Every number here is ours; the level names in the committed test set are "TEST LEVEL n".

import { cleanSpan, GAME_HOUR_MS, type Span } from './clock.ts';
import type { StoryBook } from './book.ts';
import { isDocId } from './journal.ts';
import { FORBIDDEN_KEYS } from './waypoints.ts';

/** The file's own numbers. Ours. */
export const FILE_TUNE = {
  /** Game hours after an entry is written before the player may see it, unless the set says otherwise. */
  revealGameHours: 6,
  /** The most tags one entry carries. */
  tagsMax: 12,
};

/** Set any of those, clamped; the answer is the table as it stands. */
export function tuneFile(o: Partial<typeof FILE_TUNE> | null | undefined): typeof FILE_TUNE {
  if (o && typeof o.revealGameHours === 'number' && Number.isFinite(o.revealGameHours)) FILE_TUNE.revealGameHours = Math.max(0, Math.min(24 * 365, o.revealGameHours));
  if (o && typeof o.tagsMax === 'number' && Number.isFinite(o.tagsMax)) FILE_TUNE.tagsMax = Math.max(1, Math.min(64, Math.round(o.tagsMax)));
  return FILE_TUNE;
}

/** The agencies a file may be kept by. The bible names only the ISB; the shape is keyed so others can join. */
export const AGENCIES = ['isb'] as const;
export type Agency = (typeof AGENCIES)[number];

export const FILE_KINDS = ['intercept', 'sighting', 'associate', 'incident', 'classification', 'note'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** Where in the story an entry was written. */
export interface FileSource {
  quest?: string;
  step?: string;
  talk?: string;
}

export interface FileEntry {
  /** `f<n>`: the n-th entry of this file, never reused. */
  id: string;
  at: number;
  kind: FileKind;
  weight: number;
  /** The exposure multiplier it was written under (the ranks held then; one until they arrive). */
  mult: number;
  doc?: string;
  tags: string[];
  source: FileSource;
  /** When the player may see it, on the shared clock. */
  revealAt: number;
}

export interface FileRec {
  entries: FileEntry[];
  exposure: number;
  level: number;
}

/** One level of a file, as the set writes it: the exposure it is reached at, its name (the owner's), and how people of a track greet a character at it. */
export interface FileLevel {
  at: number;
  name: string;
  /** The warmest a track's people greet a character on file at this level: `mid` or `mean`. */
  reacts: Partial<Record<'rebellion' | 'empire' | 'freelance', 'mid' | 'mean'>>;
}

/** A file's definition in a set (`file.jsonc`): its levels, lowest first, and how long an entry waits before the player sees it. */
export interface FileDef {
  levels: FileLevel[];
  reveal: Span | null;
  revealBy: Partial<Record<FileKind, Span>>;
}

/** A set's `file.jsonc`: one definition per agency. */
export type FilesDef = Partial<Record<Agency, FileDef>>;

const TAG = /^[A-Za-z0-9_.:-]{1,48}$/;
const QUEST = /^[A-Za-z0-9_-]{1,24}:[A-Za-z0-9_./-]{1,96}$/;
const STEP = /^[A-Za-z0-9_.-]{1,48}$/;
const TALK = /^[A-Za-z0-9_-]{1,24}:talk\/[A-Za-z0-9_.-]{1,96}$/;
const TIME_MAX = 1e13;
const WEIGHT_MAX = 1e6;

export function isAgency(x: unknown): x is Agency {
  return typeof x === 'string' && (AGENCIES as readonly string[]).includes(x);
}

export function isFileKind(x: unknown): x is FileKind {
  return typeof x === 'string' && (FILE_KINDS as readonly string[]).includes(x);
}

export function isFileTag(x: unknown): x is string {
  return typeof x === 'string' && TAG.test(x) && !FORBIDDEN_KEYS.includes(x);
}

export function isFileEntryId(x: unknown): x is string {
  return typeof x === 'string' && /^f[1-9][0-9]{0,8}$/.test(x);
}

/** The id the next entry of a file of that many takes. */
export function nextFileId(len: number): string {
  return `f${len + 1}`;
}

/** One entry, cleaned, or null. */
export function cleanFileEntry(x: unknown): FileEntry | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const finite = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  const at = finite(o.at, 0, TIME_MAX);
  const weight = finite(o.weight, 0, WEIGHT_MAX);
  const mult = finite(o.mult, 0, 1000) ?? 1;
  const revealAt = finite(o.revealAt, 0, TIME_MAX);
  if (!isFileEntryId(o.id) || !isFileKind(o.kind) || at === null || weight === null || revealAt === null) return null;
  const tags: string[] = [];
  if (Array.isArray(o.tags)) for (const t of o.tags) if (isFileTag(t) && !tags.includes(t) && tags.length < FILE_TUNE.tagsMax) tags.push(t);
  const source: FileSource = {};
  const s = o.source && typeof o.source === 'object' && !Array.isArray(o.source) ? (o.source as Record<string, unknown>) : {};
  if (typeof s.quest === 'string' && QUEST.test(s.quest)) source.quest = s.quest;
  if (typeof s.step === 'string' && STEP.test(s.step) && !FORBIDDEN_KEYS.includes(s.step)) source.step = s.step;
  if (typeof s.talk === 'string' && TALK.test(s.talk)) source.talk = s.talk;
  const out: FileEntry = { id: o.id, at, kind: o.kind, weight, mult, tags, source, revealAt };
  if (isDocId(o.doc)) out.doc = o.doc;
  return out;
}

/** A file record, cleaned: its entries in order with their ids in line, up to `max`; the exposure never below what they add to. */
export function cleanFileRec(x: unknown, max: number): FileRec | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const entries: FileEntry[] = [];
  let sum = 0;
  if (Array.isArray(o.entries)) {
    for (const e of o.entries) {
      if (entries.length >= max) break;
      const entry = cleanFileEntry(e);
      if (!entry || entry.id !== nextFileId(entries.length)) break;
      entries.push(entry);
      sum += entry.weight * entry.mult;
    }
  }
  const exposure = typeof o.exposure === 'number' && Number.isFinite(o.exposure) && o.exposure >= 0 ? Math.max(o.exposure, sum) : sum;
  const level = typeof o.level === 'number' && Number.isInteger(o.level) && o.level >= 0 && o.level <= 1000 ? o.level : 0;
  return { entries, exposure, level };
}

/** A character's file kept by an agency, or null with none yet. */
export function fileOf(book: Pick<StoryBook, 'files'> | null | undefined, agency: string): FileRec | null {
  const files = book?.files;
  if (!files || typeof files !== 'object' || !Object.hasOwn(files, agency)) return null;
  return (files as Record<string, FileRec>)[agency] ?? null;
}

/** The level an exposure reaches by a definition's thresholds: how many of them it has reached. */
export function levelAt(def: FileDef | null | undefined, exposure: number): number {
  let n = 0;
  for (const l of def?.levels ?? []) if (exposure >= l.at) n++;
  return n;
}

/** The level a character's file stands at: the record's, which never falls. Nought with no file. */
export function fileLevel(book: Pick<StoryBook, 'files'> | null | undefined, agency: string): number {
  return fileOf(book, agency)?.level ?? 0;
}

/** Whether any entry of a character's file carries a tag. */
export function fileHas(book: Pick<StoryBook, 'files'> | null | undefined, agency: string, tag: string): boolean {
  for (const e of fileOf(book, agency)?.entries ?? []) if (e.tags.includes(tag)) return true;
  return false;
}

/** When an entry of a kind written at `at` may be seen: the set's span for its kind, its span for every kind, or `revealGameHours`. */
export function revealAtOf(def: FileDef | null | undefined, kind: FileKind, at: number): number {
  const span = def?.revealBy[kind] ?? def?.reveal ?? null;
  return at + (span ? span.ms : Math.round(FILE_TUNE.revealGameHours * GAME_HOUR_MS));
}

/**
 * Whether the player may see an entry just now: its time has come, or the story has handed them its page
 * (the entry's document is among those handed over, or read).
 */
export function revealed(e: FileEntry, now: number, handed: (doc: string) => boolean): boolean {
  return now >= e.revealAt || (!!e.doc && handed(e.doc));
}

/** How warmly each track's people may greet a character at a level: the coldest any level reached says, by track. */
export function reactsAt(def: FileDef | null | undefined, level: number): Partial<Record<'rebellion' | 'empire' | 'freelance', 'mid' | 'mean'>> {
  const out: Partial<Record<'rebellion' | 'empire' | 'freelance', 'mid' | 'mean'>> = {};
  const levels = def?.levels ?? [];
  for (let i = 0; i < Math.min(level, levels.length); i++) {
    for (const t of ['rebellion', 'empire', 'freelance'] as const) {
      const r = levels[i].reacts[t];
      if (r === 'mean' || (r === 'mid' && out[t] !== 'mean')) out[t] = r;
    }
  }
  return out;
}

/**
 * Whether a book handed up loses any of the file it would replace within one timeline (`journalShrinks` says
 * which books are compared at all): fewer entries, other entries where the copy's are, or a lower exposure.
 */
export function fileShrinks(offered: Pick<StoryBook, 'files'> | null | undefined, mine: Pick<StoryBook, 'files'> | null | undefined): string | null {
  for (const agency of AGENCIES) {
    const a = fileOf(offered, agency);
    const b = fileOf(mine, agency);
    if (!b) continue;
    const ae = a?.entries ?? [];
    if (ae.length < b.entries.length) return `that book's ${agency} file has ${ae.length} entries where this server's has ${b.entries.length}`;
    for (let i = 0; i < b.entries.length; i++) if (ae[i].id !== b.entries[i].id || ae[i].weight !== b.entries[i].weight) return `that book's ${agency} file differs from this server's at ${b.entries[i].id}`;
    if ((a?.exposure ?? 0) < b.exposure) return `that book's ${agency} file has less exposure than this server's`;
  }
  return null;
}

// ---- the set's own file.jsonc -------------------------------------------------------------------------------

/** What reading `file.jsonc` reports a problem with: the path in the file and why. */
export type FileDefIssue = { path: string; message: string; level: 'error' | 'warning' };

/**
 * A set's `file.jsonc`, read: `{ "isb": { "levels": [ { "at": 10, "name": "...", "reacts": { "empire": "mean" } } ],
 * "reveal": span, "revealBy": { "<kind>": span } } }`. Levels are put in order of the exposure they are reached at.
 */
export function fileDefOf(v: unknown, issues: FileDefIssue[]): FilesDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    issues.push({ path: '', message: 'file.jsonc holds one object, an agency\'s file by its name ("isb")', level: 'error' });
    return null;
  }
  const out: FilesDef = {};
  for (const k of Object.keys(v)) {
    if (!isAgency(k)) {
      issues.push({ path: `/${k}`, message: `${k} is not an agency that keeps a file: isb`, level: 'error' });
      continue;
    }
    const o = (v as Record<string, unknown>)[k] as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || Array.isArray(o)) {
      issues.push({ path: `/${k}`, message: 'a file is { "levels": [...], "reveal": span }', level: 'error' });
      continue;
    }
    for (const key of Object.keys(o)) if (!['levels', 'reveal', 'revealBy'].includes(key)) issues.push({ path: `/${k}/${key}`, message: `${key} is not part of a file`, level: 'warning' });
    const levels: FileLevel[] = [];
    if (o.levels !== undefined && !Array.isArray(o.levels)) issues.push({ path: `/${k}/levels`, message: 'levels are a list of { "at": exposure, "name": words }', level: 'error' });
    (Array.isArray(o.levels) ? o.levels : []).forEach((l, i) => {
      const p = `/${k}/levels/${i}`;
      const r = l as Record<string, unknown>;
      if (!r || typeof r !== 'object' || typeof r.at !== 'number' || !Number.isFinite(r.at) || r.at < 0 || typeof r.name !== 'string' || !r.name.trim()) {
        issues.push({ path: p, message: 'a level is { "at": exposure of nought or more, "name": words }', level: 'error' });
        return;
      }
      const reacts: FileLevel['reacts'] = {};
      if (r.reacts !== undefined) {
        const re = r.reacts as Record<string, unknown>;
        if (!re || typeof re !== 'object' || Array.isArray(re)) issues.push({ path: `${p}/reacts`, message: 'reacts is { "<track>": "mid" | "mean" }', level: 'error' });
        else
          for (const t of Object.keys(re)) {
            if ((t === 'rebellion' || t === 'empire' || t === 'freelance') && (re[t] === 'mid' || re[t] === 'mean')) reacts[t] = re[t] as 'mid' | 'mean';
            else issues.push({ path: `${p}/reacts/${t}`, message: 'reacts names a track (rebellion, empire, freelance) and "mid" or "mean"', level: 'error' });
          }
      }
      levels.push({ at: r.at, name: r.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80), reacts });
    });
    levels.sort((a, b) => a.at - b.at);
    const span = (x: unknown, p: string): Span | null => {
      if (x === undefined) return null;
      const s = cleanSpan(x);
      if (typeof s === 'string') {
        issues.push({ path: p, message: s, level: 'error' });
        return null;
      }
      return s;
    };
    const revealBy: FileDef['revealBy'] = {};
    if (o.revealBy !== undefined) {
      const rb = o.revealBy as Record<string, unknown>;
      if (!rb || typeof rb !== 'object' || Array.isArray(rb)) issues.push({ path: `/${k}/revealBy`, message: 'revealBy is { "<kind>": span }', level: 'error' });
      else
        for (const kind of Object.keys(rb)) {
          if (!isFileKind(kind)) {
            issues.push({ path: `/${k}/revealBy/${kind}`, message: `${kind} is not a kind of entry: ${FILE_KINDS.join(', ')}`, level: 'error' });
            continue;
          }
          const s = span(rb[kind], `/${k}/revealBy/${kind}`);
          if (s) revealBy[kind] = s;
        }
    }
    out[k] = { levels, reveal: span(o.reveal, `/${k}/reveal`), revealBy };
  }
  return out;
}
