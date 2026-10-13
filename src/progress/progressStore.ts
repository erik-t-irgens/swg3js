// Where this browser keeps a character's progress: `swg.progress.<character>`, apart from the character list
// and from the story book, so a write that fails (a full quota, a private window) takes nothing else with it.
// The storage is handed in -- localStorage behind guards in the browser, a plain map in a test -- so nothing
// here touches a page, and the whole folder ships with the release by one rule.
//
// A copy a server would not take is set aside rather than thrown away, under
// `swg.progress.<character>.aside.<n>`, the last three kept, so the owner can put one back by hand. Nothing in
// the game reads them. A record is read back under the backstop and never the browser's own limits: what is
// kept is very often a server's record, which a server may hold to longer lists than this browser would.

import { cleanRecord, recordText, type ProgressRecord } from './record.ts';
import { PROGRESS_BACKSTOP, PROGRESS_RULES } from './tune.ts';

/** Where the strings go. The browser hands in localStorage behind guards; a test, a map. */
export interface ProgressStorage {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

/** How many set-aside copies are kept per character. Ours. */
export const ASIDE_KEPT = 3;

const KEY = (char: string): string => `swg.progress.${char}`;
const ASIDES = (char: string): string => `swg.progress.${char}.asides`;
const ASIDE = (char: string, n: number): string => `swg.progress.${char}.aside.${n}`;

/** The record kept for a character, cleaned, or null when there is none (or what is there is not one). */
export function loadRecord(store: ProgressStorage, char: string): ProgressRecord | null {
  const raw = store.get(KEY(char));
  if (!raw) return null;
  try {
    const rec = cleanRecord(JSON.parse(raw), PROGRESS_BACKSTOP, PROGRESS_RULES);
    return rec && rec.char === char ? rec : null;
  } catch {
    return null;
  }
}

/** Keep a record. False when it could not be kept (the record still stands for the session). */
export function saveRecord(store: ProgressStorage, rec: ProgressRecord | null): boolean {
  if (!rec) return false;
  return store.set(KEY(rec.char), recordText(rec));
}

/**
 * How many changes a character's kept record holds that no server has seen, read without making it anybody's:
 * what the change counter of a character this browser is not holding reads.
 */
export function localOf(store: ProgressStorage, char: string): number {
  return loadRecord(store, char)?.local ?? 0;
}

/** The numbers of the copies set aside for a character, oldest first. */
export function asides(store: ProgressStorage, char: string): number[] {
  try {
    const list = JSON.parse(store.get(ASIDES(char)) ?? '[]');
    return Array.isArray(list) ? list.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
}

/** One set-aside copy, or null. */
export function asideRecord(store: ProgressStorage, char: string, n: number): ProgressRecord | null {
  try {
    return cleanRecord(JSON.parse(store.get(ASIDE(char, n)) ?? 'null'), PROGRESS_BACKSTOP, PROGRESS_RULES);
  } catch {
    return null;
  }
}

/** Set a copy aside, keeping the last `ASIDE_KEPT`. Answers its number, or 0 when it could not be kept. */
export function setAside(store: ProgressStorage, rec: ProgressRecord): number {
  const list = asides(store, rec.char);
  const n = (list.length ? Math.max(...list) : 0) + 1;
  if (!store.set(ASIDE(rec.char, n), recordText(rec))) return 0;
  list.push(n);
  while (list.length > ASIDE_KEPT) store.remove(ASIDE(rec.char, list.shift()!));
  store.set(ASIDES(rec.char), JSON.stringify(list));
  return n;
}
