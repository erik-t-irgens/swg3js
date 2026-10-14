// Progress on the wire: one word each way, `{ t: 'progress', do, ... }`, and the cleaner that rebuilds every one
// field by field on arrival, on either side, before anything reads it. Pure, and nothing imported but its own
// folder, so the server runs this very file under node's type stripping and the browser runs it as it is.
//
// Browser to server: `sync` (what this copy holds: whether it has anything, its revision, the server revision it
// last matched, the batches made here alone, and whether a server held the character before), `offer` (its record,
// asked for, in pieces), `claim` (a fight closed: what was fought and used, never an amount), `task` (a landing
// roll), `learn` and `surrender` (a node, and the kind of person teaching it), and the admin's `grant`, `xp` and
// `reset`. Server to browser: `rec` (the server's whole record, and whose copy stands), `want` (send yours), `ch`
// (a batch, at the revision it made, with the claim or task it answered and what kind of batch it is, for the
// words the browser makes of it), and `no` (a refusal in words, naming the claim or task it was about).
//
// **Nothing here is a number of the rules.** What a claim carries is clamped to what makes sense on the wire --
// how many members, how high a level -- and the server holds it tighter by its own tuning; the amount a claim pays
// is never on the wire at all.
//
// A record crosses as text cut into pieces and put back together on the far side. The cutting and the putting
// back are the story book's own (`src/story/storyWire.ts`'s `chunkText` and `Reassembly`), written out again here
// because this folder imports nothing outside itself: the release ships it whole by one rule, and the server's
// progress modules import only this folder.

import { ENCOUNTER_POOLS, type ClaimMember, type ClaimOutcome, type EncounterClaim, type EncounterPool, type ProgressTask } from './payout.ts';
import { FORBIDDEN_KEYS, RECORD_MAX } from './record.ts';

/**
 * The progress this server holds, as its hail says it (`progress: 1`). A browser built before this never reads the
 * field; one built for it holds progress itself against any far end whose hail does not carry it.
 */
export const PROGRESS_WIRE_VERSION = 1;

/** What the cleaner takes at most, whatever a server's own tuning holds it to after. Ours. */
export const PROGRESS_WIRE = {
  /** The longest id a claim, a task or a node may have. */
  idMax: 64,
  /** The longest creature a member may be, a planet a claim may name, and a refusal's words. */
  npcMax: 96,
  planetMax: 64,
  whyMax: 300,
  /** The most members a claim may carry on the wire, and the highest level one may have. */
  membersMax: 64,
  levelMax: 10000,
  /** The longest piece of a record, in characters: a whole record fits in one. */
  partMax: RECORD_MAX,
  /** The most pieces a record may be cut into, on the wire. */
  piecesMax: 64,
};

/** Why a batch was made, as the words the browser makes of it read it. */
export type ProgressBatchKind = 'claim' | 'task' | 'learn' | 'surrender' | 'bonus' | 'admin';
const BATCH_KINDS: readonly ProgressBatchKind[] = ['claim', 'task', 'learn', 'surrender', 'bonus', 'admin'];

export type ProgressUp =
  | { do: 'sync'; has: 0 | 1; rev: number; base: number; local: number; known: 0 | 1 }
  | { do: 'offer'; id: number; n: number; of: number; part: string; known: 0 | 1 }
  | { do: 'claim'; c: EncounterClaim }
  | { do: 'task'; k: ProgressTask }
  | { do: 'learn' | 'surrender'; node: string; teacher: string | null }
  | { do: 'grant'; node: string }
  | { do: 'xp'; src: string; n: number }
  | { do: 'reset' };

export type ProgressDown =
  | { do: 'rec'; rec: Record<string, unknown>; take: 'browser' | 'server'; rate?: number }
  | { do: 'want' }
  | { do: 'ch'; rev: number; ch: unknown[]; kind: ProgressBatchKind; of?: string; fee?: number }
  | { do: 'no'; why: string; of?: string };

/** An id the record keeps a payment under (a claim's, a task's) or a node's: plain characters, never a name the language gives a meaning. */
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
/** A world's own name for a shared body (`wild:`, `stood:`, `camp:`, an admin's spawn): the ownership's own rule. */
const WORLD_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
/** A planet as a claim names it: a pack's id. */
const PLANET = /^[A-Za-z0-9_ -]{0,64}$/;
/** A creature's name: printable, no control characters. Hashed and never a key of anything. */
const PRINTABLE = /^[\x20-\x7e]+$/;

function isId(x: unknown): x is string {
  return typeof x === 'string' && ID.test(x) && !FORBIDDEN_KEYS.includes(x);
}

/** A finite number held between two, or undefined. */
function num(x: unknown, lo: number, hi: number): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : undefined;
}

/** A whole count held between two, or undefined. */
function count(x: unknown, hi: number): number | undefined {
  const n = num(x, 0, hi);
  return n === undefined ? undefined : Math.floor(n);
}

function flag(x: unknown): 0 | 1 {
  return x === 1 || x === true ? 1 : 0;
}

/** What a claim may carry, beyond the wire's own ceilings: a server's tighter caps. */
export interface ClaimCaps {
  membersMax?: number;
  levelMax?: number;
}

/** One member of a claim, cleaned, or null. A level is a whole number from 1 to the cap, or null for one with none. */
function cleanMember(x: unknown, levelMax: number): ClaimMember | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.npc !== 'string' || !o.npc || o.npc.length > PROGRESS_WIRE.npcMax || !PRINTABLE.test(o.npc)) return null;
  const level = o.level === null || o.level === undefined ? null : num(o.level, 1, levelMax);
  if (level === undefined) return null;
  const share = num(o.share, 0, 1) ?? 1;
  const out: ClaimMember = { npc: o.npc, level: level === null ? null : Math.round(level), dead: o.dead === true, fought: o.fought === true, share };
  if (typeof o.w === 'string' && WORLD_NAME.test(o.w) && !FORBIDDEN_KEYS.includes(o.w)) out.w = o.w;
  return out;
}

/** A fight closed, as a browser says it, cleaned: what was fought and used, its members held to the caps, or null. */
export function cleanClaim(x: unknown, caps: ClaimCaps = {}): EncounterClaim | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const at = num(o.at, 0, 1e15);
  const outcome = o.outcome === 'won' || o.outcome === 'lost' || o.outcome === 'broken' ? (o.outcome as ClaimOutcome) : null;
  if (!isId(o.id) || at === undefined || !outcome || !Array.isArray(o.members)) return null;
  const used: EncounterPool[] = [];
  if (Array.isArray(o.used)) for (const p of o.used) if ((ENCOUNTER_POOLS as readonly unknown[]).includes(p) && !used.includes(p as EncounterPool)) used.push(p as EncounterPool);
  const planet = typeof o.planet === 'string' && PLANET.test(o.planet) ? o.planet : '';
  const membersMax = Math.max(0, Math.min(PROGRESS_WIRE.membersMax, Math.floor(caps.membersMax ?? PROGRESS_WIRE.membersMax)));
  const levelMax = Math.max(1, Math.min(PROGRESS_WIRE.levelMax, Math.floor(caps.levelMax ?? PROGRESS_WIRE.levelMax)));
  const members: ClaimMember[] = [];
  for (const m of o.members.slice(0, membersMax)) {
    const c = cleanMember(m, levelMax);
    if (c) members.push(c);
  }
  return { id: o.id, at, outcome, used, heavy: o.heavy === true, planet, diff: num(o.diff, 0, 10) ?? 1, members };
}

/** A landing roll, cleaned, or null. */
export function cleanTask(x: unknown): ProgressTask | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const at = num(o.at, 0, 1e15);
  const fell = num(o.fell, 0, 100000);
  const saved = num(o.saved, 0, 1e6);
  if (!isId(o.id) || at === undefined || o.kind !== 'roll' || fell === undefined || saved === undefined) return null;
  return { id: o.id, at, kind: 'roll', fell, saved };
}

/** A word a browser sent, cleaned, or null when it is not one. `caps` are a server's own, for a claim. */
export function cleanProgressUp(msg: unknown, caps: ClaimCaps = {}): ProgressUp | null {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const o = msg as Record<string, unknown>;
  if (o.t !== 'progress') return null;
  switch (o.do) {
    case 'sync': {
      const rev = count(o.rev, 1e12) ?? 0;
      const base = count(o.base, 1e12) ?? 0;
      const local = count(o.local, 1e12) ?? 0;
      return { do: 'sync', has: flag(o.has), rev, base, local, known: flag(o.known) };
    }
    case 'offer': {
      const id = count(o.id, 1e9);
      const n = count(o.n, PROGRESS_WIRE.piecesMax);
      const of = count(o.of, PROGRESS_WIRE.piecesMax);
      if (id === undefined || n === undefined || of === undefined || of < 1 || n >= of) return null;
      if (typeof o.part !== 'string' || o.part.length > PROGRESS_WIRE.partMax) return null;
      return { do: 'offer', id, n, of, part: o.part, known: flag(o.known) };
    }
    case 'claim': {
      const c = cleanClaim(o.c, caps);
      return c ? { do: 'claim', c } : null;
    }
    case 'task': {
      const k = cleanTask(o.k);
      return k ? { do: 'task', k } : null;
    }
    case 'learn':
    case 'surrender': {
      if (!isId(o.node)) return null;
      const teacher = o.teacher === null || o.teacher === undefined ? null : isId(o.teacher) ? o.teacher : undefined;
      if (teacher === undefined) return null;
      return { do: o.do, node: o.node, teacher };
    }
    case 'grant':
      return isId(o.node) ? { do: 'grant', node: o.node } : null;
    case 'xp': {
      const n = num(o.n, -1e9, 1e9);
      return isId(o.src) && n !== undefined ? { do: 'xp', src: o.src, n: Math.round(n) } : null;
    }
    case 'reset':
      return { do: 'reset' };
    default:
      return null;
  }
}

/** A word a server sent, cleaned, or null. The record in a `rec` is the client's to clean (`cleanRecord`): here it is only an object. */
export function cleanProgressDown(msg: unknown): ProgressDown | null {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const o = msg as Record<string, unknown>;
  if (o.t !== 'progress') return null;
  switch (o.do) {
    case 'rec': {
      if (!o.rec || typeof o.rec !== 'object' || Array.isArray(o.rec)) return null;
      if (o.take !== 'browser' && o.take !== 'server') return null;
      const rate = num(o.rate, 0, 100);
      return { do: 'rec', rec: o.rec as Record<string, unknown>, take: o.take, ...(rate !== undefined ? { rate } : {}) };
    }
    case 'want':
      return { do: 'want' };
    case 'ch': {
      const rev = count(o.rev, 1e12);
      if (rev === undefined || rev < 1 || !Array.isArray(o.ch)) return null;
      const kind = (BATCH_KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as ProgressBatchKind) : 'admin';
      const fee = count(o.fee, 1e12);
      return { do: 'ch', rev, ch: o.ch, kind, ...(isId(o.of) ? { of: o.of } : {}), ...(fee ? { fee } : {}) };
    }
    case 'no': {
      if (typeof o.why !== 'string' || !o.why) return null;
      return { do: 'no', why: o.why.slice(0, PROGRESS_WIRE.whyMax), ...(isId(o.of) ? { of: o.of } : {}) };
    }
    default:
      return null;
  }
}

/**
 * A record as the text that crosses the wire: JSON with every character past plain ASCII written as an escape, so
 * its length in characters is its length in bytes. `JSON.parse` reads it back unchanged.
 */
export function recordWireText(rec: unknown): string {
  return JSON.stringify(rec).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
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
 * A record coming in pieces, put back together: one at a time, its pieces in order, no more than `max` characters
 * in all and no longer than `wait` milliseconds between one piece and the next. A piece numbered 0 starts a record
 * over, whatever was arriving before.
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

  /** Whether a record is half in. */
  get busy(): boolean {
    return this.id >= 0;
  }

  clear(): void {
    this.id = -1;
    this.of = 0;
    this.parts = [];
    this.size = 0;
  }

  /**
   * One piece. Answers the whole text once the last piece is in, a reason when the record cannot be taken (and
   * forgets it), or null while more is to come or the piece belongs to one given up.
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
      return { why: 'that record is larger than this server takes' };
    }
    this.parts.push(p.part);
    this.size += p.part.length;
    this.last = now;
    if (this.parts.length < this.of) return null;
    const text = this.parts.join('');
    this.clear();
    return { text };
  }

  /** Give up on a record whose next piece is overdue. True when one was given up. */
  expire(now: number): boolean {
    if (this.id < 0 || now - this.last <= this.wait) return false;
    this.clear();
    return true;
  }
}
