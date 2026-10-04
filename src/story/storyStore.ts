// Where this browser keeps a character's story book: `localStorage['swg.story.<character>']`, apart
// from `swg.characters` on purpose, so a write that fails (a full quota, a private window) can never
// take the character list down with it. Every access is guarded: with no storage at all the book lives
// for the session and the game runs exactly as it would otherwise.
//
// A copy of a book the server would not take -- one played in two places, where the server's stands --
// is set aside rather than thrown away, under `swg.story.<character>.aside.<n>`, the last three kept,
// so the owner can put one back by hand. Nothing in the game reads them.
//
// Pure apart from the storage handed in, which a test gives as a plain map.

import { BACKSTOP_LIMITS, cleanBook, type StoryBook } from './book.ts';
import { bookText } from './storyWire.ts';

/** Where the strings go. A browser gets localStorage; a test, a map. */
export interface StoryStorage {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

/** How many set-aside copies are kept per character. Ours. */
export const ASIDE_KEPT = 3;

const KEY = (char: string): string => `swg.story.${char}`;
const ASIDES = (char: string): string => `swg.story.${char}.asides`;
const ASIDE = (char: string, n: number): string => `swg.story.${char}.aside.${n}`;

/** localStorage, behind guards, or nothing when there is none. */
export function browserStoryStorage(): StoryStorage {
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* nothing kept to take away */
      }
    },
  };
}

/**
 * The book kept for a character, cleaned, or null when there is none (or what is there is not one). It is
 * read under the backstop and not the browser's own caps: what is kept is very often a server's book, and a
 * server may hold a character to more waypoints than this browser would set itself.
 */
export function loadBook(store: StoryStorage, char: string): StoryBook | null {
  const raw = store.get(KEY(char));
  if (!raw) return null;
  try {
    const book = cleanBook(JSON.parse(raw), BACKSTOP_LIMITS);
    return book && book.char === char ? book : null;
  } catch {
    return null;
  }
}

/** Keep a book. False when it could not be kept (the book still stands for the session). */
export function saveBook(store: StoryStorage, book: StoryBook | null): boolean {
  if (!book) return false;
  return store.set(KEY(book.char), bookText(book));
}

/** The numbers of the copies set aside for a character, oldest first. */
export function asides(store: StoryStorage, char: string): number[] {
  try {
    const list = JSON.parse(store.get(ASIDES(char)) ?? '[]');
    return Array.isArray(list) ? list.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
}

/** One set-aside copy, or null. */
export function asideBook(store: StoryStorage, char: string, n: number): StoryBook | null {
  try {
    return cleanBook(JSON.parse(store.get(ASIDE(char, n)) ?? 'null'), BACKSTOP_LIMITS);
  } catch {
    return null;
  }
}

/**
 * Set a copy aside, keeping the last `ASIDE_KEPT`. Answers its number, or 0 when it could not be kept.
 */
export function setAside(store: StoryStorage, book: StoryBook): number {
  const list = asides(store, book.char);
  const n = (list.length ? Math.max(...list) : 0) + 1;
  if (!store.set(ASIDE(book.char, n), bookText(book))) return 0;
  list.push(n);
  while (list.length > ASIDE_KEPT) store.remove(ASIDE(book.char, list.shift()!));
  store.set(ASIDES(book.char), JSON.stringify(list));
  return n;
}
