// The story's words on the wire, both ways, and the one way a whole book crosses it: in pieces.
//
// Every word is `{ t: 'story', do, ... }`. A browser says `sync` (what it holds), `offer` (its book,
// in pieces, when the server has asked for it) and `wp` (a waypoint set, renamed, recoloured, switched,
// taken away or tracked); a server says `book` (its book, in pieces), `want` (send me yours), `ch` (a
// batch of changes at a revision) and `no` (why not). Each is cleaned the house way -- a class of
// characters, a length, a finite number, a hard cap on a list, and the three names that mean something
// to the language refused outright -- and anything that fails is dropped rather than answered.
//
// **Why in pieces.** The relay drops what a browser sends past 64 KB in a second and closes a line that
// goes twice past it, so a book of any size goes up as pieces of `offerChunk` characters with a gap
// between them, and comes down the same way so the two sides read it with the same code. A book is
// written with every character past plain ASCII escaped (`bookText`), so a piece's length in
// characters is its length in bytes and the pacing means what it says.
//
// Pure, nothing imported but this folder: the server reads these words with this file.

import { cleanChange, type StoryChange } from './book.ts';
import { cleanWaypointAsk, cleanWaypointName, isQuestWaypoint, isWaypointColour, isWaypointId, type WaypointAsk, type WaypointColour } from './waypoints.ts';

/** The caps on a word. Ours; the pacing and the sizes a server will take are its own (`STORY_TUNING`). */
export const STORY_WIRE = {
  /** The longest piece of a book a word may carry, in characters (bytes, since a book is ASCII). */
  partMax: 65536,
  /** The most pieces one book may be cut into. */
  partsMax: 100000,
  /** The longest reason a `no` may give. */
  whyMax: 160,
  /** The most changes one `ch` may carry. */
  changesMax: 1000,
};

/** What a browser says. */
export type StoryUp =
  | { do: 'sync'; has: boolean; base: number; local: number; known: boolean }
  | { do: 'offer'; id: number; n: number; of: number; part: string; known: boolean }
  | { do: 'wp'; op: 'set'; wp: WaypointAsk }
  | { do: 'wp'; op: 'edit'; id: string; name?: string; colour?: WaypointColour }
  | { do: 'wp'; op: 'on' | 'off' | 'gone'; id: string }
  | { do: 'wp'; op: 'track'; id: string | null };

/** What a server says. `whole` on a `ch` is false when a change in it could not be read: the batch is then asked for again whole. */
export type StoryDown =
  | { do: 'book'; id: number; n: number; of: number; part: string; take: 'browser' | 'server' }
  | { do: 'want' }
  | { do: 'ch'; rev: number; ch: StoryChange[]; whole: boolean }
  | { do: 'no'; why: string };

const CONTROL = /[\u0000-\u001f\u007f]/g;

function whole(x: unknown, max = 1e12): number | null {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : null;
}

/** The pieces' own numbers: which book, which piece, how many, and the text. Null when any is wrong. */
function piece(o: Record<string, unknown>): { id: number; n: number; of: number; part: string } | null {
  const id = whole(o.id);
  const n = whole(o.n, STORY_WIRE.partsMax);
  const of = whole(o.of, STORY_WIRE.partsMax);
  if (id === null || n === null || of === null || of < 1 || n >= of) return null;
  if (typeof o.part !== 'string' || o.part.length > STORY_WIRE.partMax) return null;
  return { id, n, of, part: o.part };
}

/**
 * A story word, cleaned, or null. `up` is a browser's word as the server reads it; `down` a server's as
 * the browser reads it. Nothing a word carries is passed on that was not rebuilt here.
 */
export function cleanStoryWord(x: unknown, dir: 'up'): StoryUp | null;
export function cleanStoryWord(x: unknown, dir: 'down'): StoryDown | null;
export function cleanStoryWord(x: unknown, dir: 'up' | 'down'): StoryUp | StoryDown | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (o.t !== undefined && o.t !== 'story') return null;
  if (dir === 'up') {
    if (o.do === 'sync') {
      const base = whole(o.base);
      const local = whole(o.local);
      if (base === null || local === null) return null;
      return { do: 'sync', has: o.has === 1 || o.has === true, base, local, known: o.known === 1 || o.known === true };
    }
    if (o.do === 'offer') {
      const p = piece(o);
      return p ? { do: 'offer', ...p, known: o.known === 1 || o.known === true } : null;
    }
    if (o.do === 'wp') {
      const wp = o.wp && typeof o.wp === 'object' && !Array.isArray(o.wp) ? (o.wp as Record<string, unknown>) : null;
      if (!wp) return null;
      if (o.op === 'set') {
        const ask = cleanWaypointAsk(wp);
        return ask ? { do: 'wp', op: 'set', wp: ask } : null;
      }
      if (o.op === 'edit') {
        if (!isWaypointId(wp.id)) return null;
        const out: { do: 'wp'; op: 'edit'; id: string; name?: string; colour?: WaypointColour } = { do: 'wp', op: 'edit', id: wp.id };
        const name = wp.name === undefined ? null : cleanWaypointName(wp.name);
        if (name) out.name = name;
        if (isWaypointColour(wp.colour)) out.colour = wp.colour;
        return out.name === undefined && out.colour === undefined ? null : out;
      }
      if (o.op === 'on' || o.op === 'off' || o.op === 'gone') return isWaypointId(wp.id) ? { do: 'wp', op: o.op, id: wp.id } : null;
      if (o.op === 'track') return wp.id === null || isWaypointId(wp.id) || isQuestWaypoint(wp.id) ? { do: 'wp', op: 'track', id: (wp.id as string | null) ?? null } : null;
      return null;
    }
    return null;
  }
  if (o.do === 'book') {
    const p = piece(o);
    return p ? { do: 'book', ...p, take: o.take === 'browser' ? 'browser' : 'server' } : null;
  }
  if (o.do === 'want') return { do: 'want' };
  if (o.do === 'ch') {
    const rev = whole(o.rev);
    if (rev === null || !Array.isArray(o.ch) || o.ch.length > STORY_WIRE.changesMax) return null;
    const ch: StoryChange[] = [];
    for (const raw of o.ch) {
      const c = cleanChange(raw);
      if (c) ch.push(c);
    }
    return { do: 'ch', rev, ch, whole: ch.length === o.ch.length };
  }
  if (o.do === 'no') {
    const why = typeof o.why === 'string' ? o.why.replace(CONTROL, '').slice(0, STORY_WIRE.whyMax) : '';
    return { do: 'no', why: why || 'the server would not' };
  }
  return null;
}

/** The story a server's hail says it holds: its version, 0 when it says nothing (every relay before this one). */
export function storyHailVersion(x: unknown): number {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return 0;
  const v = (x as Record<string, unknown>).v;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1000 ? v : 0;
}

/**
 * A book as the text that crosses the wire: JSON with every character past plain ASCII written as an
 * escape, so its length in characters is its length in bytes. `JSON.parse` reads it back unchanged.
 */
export function bookText(book: unknown): string {
  return JSON.stringify(book).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** A text cut into pieces of at most `size` characters, in order. Never fewer than one. */
export function chunkText(s: string, size: number): string[] {
  const step = Math.max(1, Math.floor(size));
  if (!s.length) return [''];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += step) out.push(s.slice(i, i + step));
  return out;
}

/**
 * A book coming in pieces, put back together: one book at a time, its pieces in order, no more than
 * `max` characters in all and no longer than `wait` milliseconds between one piece and the next. A piece
 * numbered 0 starts a book over, whatever was arriving before. Both sides use it: the server for a
 * browser's offer, the browser for the server's book.
 */
export class Reassembly {
  max: number;
  wait: number;
  private id = -1;
  private of = 0;
  private parts: string[] = [];
  private size = 0;
  private last = 0;

  constructor(max: number, wait: number) {
    this.max = max;
    this.wait = wait;
  }

  /** Whether a book is half in. */
  get busy(): boolean {
    return this.id >= 0;
  }

  /** How many characters of the book in progress have arrived. */
  get received(): number {
    return this.size;
  }

  clear(): void {
    this.id = -1;
    this.of = 0;
    this.parts = [];
    this.size = 0;
  }

  /**
   * One piece. Answers the whole text once the last piece is in, a reason when the book cannot be
   * taken (and forgets it), or null while more is to come or the piece belongs to a book given up.
   */
  add(p: { id: number; n: number; of: number; part: string }, now: number): { text: string } | { why: string } | null {
    if (p.n === 0) {
      this.clear();
      this.id = p.id;
      this.of = p.of;
    } else if (p.id !== this.id) {
      return null;
    } else if (p.of !== this.of || p.n !== this.parts.length) {
      this.clear();
      return { why: 'the pieces came out of order' };
    } else if (now - this.last > this.wait) {
      this.clear();
      return { why: 'the pieces stopped coming' };
    }
    if (this.size + p.part.length > this.max) {
      this.clear();
      return { why: 'that book is larger than this server takes' };
    }
    this.parts.push(p.part);
    this.size += p.part.length;
    this.last = now;
    if (this.parts.length < this.of) return null;
    const text = this.parts.join('');
    this.clear();
    return { text };
  }

  /** Give up on a book whose next piece is overdue. True when one was given up. */
  expire(now: number): boolean {
    if (this.id < 0 || now - this.last <= this.wait) return false;
    this.clear();
    return true;
  }
}
