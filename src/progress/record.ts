// A character's progress: one record, and the one function that changes it. Pure: no page, no clock of its
// own, and nothing imported but its own folder and the hashing, so the server runs this very file under node's
// type stripping and the browser runs it as it is (the story book's own rule, `src/story/book.ts`).
//
// **How a record changes.** Only through `applyProgress`, which takes a batch of change records from a closed
// list -- `core`, `pool` and `earned` (XP), `node`, `nodeGone`, `gone` and `goneClear` (what is learnt and
// what was surrendered), `seen`/`seenDrop`, `recent`/`recentDrop`, `paid`/`paidDrop`, `bonus`/`bonusDrop`,
// `logRow`/`logDrop` (the payouts' memory), `last` and `rested` -- and applies each one the record will take, in
// order, saying why for each it will not. **Every number is whole and already clamped**: an XP is written as
// the total it now is, never an amount to add, so two hosts whose rules differ still apply each other's batches
// to the same record. `rev` rises once for every batch that changed anything.
//
// **A trim is a change.** `applyProgress` refuses a change that would take a list past the limits it is handed
// and never trims anything itself: the host that makes a batch writes the drops its own limits call for as
// changes in it (`trimFor`, oldest first, ties by key), so a browser applying a server's batch under the
// backstop arrives at exactly the server's record whatever either one's limits.
//
// **The three counters** are the book's: `rev` the record's revision, `base` the server revision this copy last
// matched, `local` the batches applied here with nobody else holding it, which is what the character's change
// counter reads. Skill Points are not stored: what is spent is the sum of what the owned nodes cost.
//
// Every time in a record is whole seconds on the shared clock.

import { utf8 } from '../net/hash.ts';
import { xpCap } from './core.ts';
import { DISCIPLINES, nodeById, prerequisitesMet, spOf } from './disciplines.ts';
import { PROGRESS_LIMITS, PROGRESS_RULES, type ProgressLimits, type ProgressRules } from './tune.ts';

export const PROGRESS_VERSION = 1;

export type CoreSkill = 'athletics' | 'acrobatics' | 'marksmanship' | 'melee' | 'fortitude' | 'awareness' | 'finesse';
export const CORE_SKILLS: readonly CoreSkill[] = ['athletics', 'acrobatics', 'marksmanship', 'melee', 'fortitude', 'awareness', 'finesse'];

/** A discipline's pool of XP banked and not yet spent. One in this pass. */
export type Pool = 'demolitions';
export const POOLS: readonly Pool[] = ['demolitions'];

/** What a log row's source index names: the core skills, then the pools. */
export const LOG_SOURCES: readonly (CoreSkill | Pool)[] = [...CORE_SKILLS, ...POOLS];

/** When a node was learnt and what XP it really cost. */
export interface NodeRec {
  at: number;
  xp: number;
}

/** One payout's row: when its first and last payout were, its source (`LOG_SOURCES`), and the XP. */
export type LogRow = [number, number, number, number];

export interface ProgressRecord {
  v: 1;
  /** The character it belongs to. */
  char: string;
  rev: number;
  base: number;
  local: number;
  /** XP per core skill; the rating is worked out of it (`core.ts`). */
  core: Partial<Record<CoreSkill, number>>;
  /** A discipline's XP banked and not yet spent. */
  pools: Partial<Record<Pool, number>>;
  /** A discipline's XP over a character's life, for the page. */
  earned?: Partial<Record<Pool, number>>;
  /** The nodes owned. */
  nodes: Record<string, NodeRec>;
  /** The nodes surrendered, and when: learnt again within the relearn window for a share of their XP. */
  gone?: Record<string, number>;
  /** The creatures and planets a win has been had against, as `fnv32` keys, oldest first. */
  seen?: string[];
  /** Diminishing returns: a key's last time and how many times it has repeated. */
  recent?: Record<string, [number, number]>;
  /** The claims and tasks paid, and when. */
  paid?: Record<string, number>;
  /** The quest bonuses paid, as `fnv32` keys of the story's own key. */
  bonus?: string[];
  /** The payouts, a row a pool for every few minutes, for the quest bonus. */
  log?: LogRow[];
  /** When the last claim was paid: what the rested bonus reads. */
  last?: number;
  /** Rested XP still to double payouts with. */
  rested?: number;
  /** Progression II's equipped perks; absent until then. */
  perks?: string[];
  /** Sections a later wave writes, kept as they came when they are plain data. */
  [section: string]: unknown;
}

/** The longest a record may be written out, in characters, before it is refused [ours]: a full one is about 14 KB. */
export const RECORD_MAX = 20000;

/** The one closed list of changes. */
export type ProgressChange =
  | { k: 'core'; skill: CoreSkill; xp: number }
  | { k: 'pool'; pool: Pool; xp: number }
  | { k: 'earned'; pool: Pool; xp: number }
  | { k: 'node'; id: string; rec: NodeRec }
  | { k: 'nodeGone'; id: string }
  | { k: 'gone'; id: string; at: number }
  | { k: 'goneClear'; id: string }
  | { k: 'seen'; key: string }
  | { k: 'seenDrop'; key: string }
  | { k: 'recent'; key: string; at: number; n: number }
  | { k: 'recentDrop'; key: string }
  | { k: 'paid'; key: string; at: number }
  | { k: 'paidDrop'; key: string }
  | { k: 'bonus'; key: string }
  | { k: 'bonusDrop'; key: string }
  | { k: 'logRow'; row: LogRow }
  | { k: 'logDrop'; first: number; src: number }
  | { k: 'last'; at: number }
  | { k: 'rested'; xp: number };

/** The names the language gives a meaning to: never a key of anything a browser chose. */
export const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** A character id as the browser makes them (the story book and `server/wire.mjs` hold the same rule). */
const CHARACTER = /^[A-Za-z0-9_.-]{1,64}$/;
/** An `fnv32` key. */
const HASH_KEY = /^[0-9a-f]{8}$/;
/** A claim's or a task's id. */
const PAID_KEY = /^[A-Za-z0-9_.:-]{1,64}$/;
/** A perk's id (Progression II's). */
const PERK = /^[A-Za-z0-9_.:-]{1,64}$/;
/** The largest a count or an XP may be before it is nonsense. */
const COUNT_MAX = 1e12;
/** How deep, and how big, a later wave's section may be before it is not well formed. */
const SECTION_DEPTH = 16;
const SECTION_NODES = 20000;
/** Every field the record reads itself; anything else is a later wave's section. */
const KNOWN = ['v', 'char', 'rev', 'base', 'local', 'core', 'pools', 'earned', 'nodes', 'gone', 'seen', 'recent', 'paid', 'bonus', 'log', 'last', 'rested', 'perks'];

export function isCharacterId(x: unknown): x is string {
  return typeof x === 'string' && CHARACTER.test(x) && !FORBIDDEN_KEYS.includes(x);
}

export function isCoreSkill(x: unknown): x is CoreSkill {
  return typeof x === 'string' && (CORE_SKILLS as readonly string[]).includes(x);
}

export function isPool(x: unknown): x is Pool {
  return typeof x === 'string' && (POOLS as readonly string[]).includes(x);
}

function isHashKey(x: unknown): x is string {
  return typeof x === 'string' && HASH_KEY.test(x);
}

function isPaidKey(x: unknown): x is string {
  return typeof x === 'string' && PAID_KEY.test(x) && !FORBIDDEN_KEYS.includes(x);
}

/** A whole count, nought or more, or undefined. */
function whole(x: unknown, max = COUNT_MAX): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max && Number.isInteger(x) ? x : undefined;
}

/** A count read from a file: floored and held to its range, nought when it is not a number. */
function count(x: unknown, max = COUNT_MAX): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(max, Math.floor(x)) : 0;
}

/** A keyed table with no prototype, so a key off the wire is only ever a key. */
export function table<T>(from?: Record<string, T>): Record<string, T> {
  const out = Object.create(null) as Record<string, T>;
  if (from) for (const k of Object.keys(from)) out[k] = from[k];
  return out;
}

function own<T>(t: Record<string, T> | undefined, key: string): T | undefined {
  return t && Object.hasOwn(t, key) ? t[key] : undefined;
}

function size(t: object | undefined): number {
  return t ? Object.keys(t).length : 0;
}

/** Our 32-bit FNV-1a over the text's UTF-8, eight hex digits: the keys of `seen`, `recent` and `bonus`. */
export function fnv32(text: string): string {
  let h = 0x811c9dc5;
  for (const b of utf8(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A time on the shared clock in whole seconds, from milliseconds. */
export function secondsOf(ms: number): number {
  return Math.round(ms / 1000);
}

/** A new, empty record. */
export function emptyRecord(char: string): ProgressRecord {
  return { v: PROGRESS_VERSION, char, rev: 0, base: 0, local: 0, core: table<number>(), pools: table<number>(), nodes: table<NodeRec>() };
}

/** Skill Points spent: the sum of what every owned node costs. */
export function spSpent(rec: ProgressRecord | null): number {
  let sp = 0;
  for (const id of Object.keys(rec?.nodes ?? {})) {
    const n = nodeById(id);
    if (n) sp += spOf(n);
  }
  return sp;
}

/** A copy of plain data, or undefined when it is not plain data (the book's rule, smaller). */
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

/** The oldest first, ties by key: the one order every host trims and keeps in. */
function byAge<T>(entries: [string, T][], at: (v: T) => number): [string, T][] {
  return entries.sort((a, b) => at(a[1]) - at(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** A log row read from anywhere, or null. */
function cleanLogRow(x: unknown): LogRow | null {
  if (!Array.isArray(x) || x.length !== 4) return null;
  const [first, last, src, xp] = x.map((v) => whole(v));
  if (first === undefined || last === undefined || src === undefined || xp === undefined || src >= LOG_SOURCES.length || last < first) return null;
  return [first, last, src, xp];
}

/**
 * Drop nodes until what is owned is a tree the data allows: a node not in the data, a node whose prerequisites
 * are not owned (again and again, since one dropped can orphan another), then the latest-learnt until the Skill
 * Points spent are within the cap. In place.
 */
function repairNodes(nodes: Record<string, NodeRec>, rules: ProgressRules): void {
  for (const id of Object.keys(nodes)) if (!nodeById(id)) delete nodes[id];
  const prune = (): void => {
    for (let changed = true; changed; ) {
      changed = false;
      for (const id of Object.keys(nodes)) {
        const n = nodeById(id)!;
        if (!prerequisitesMet(n, (x) => Object.hasOwn(nodes, x))) {
          delete nodes[id];
          changed = true;
        }
      }
    }
  };
  prune();
  const spent = (): number => Object.keys(nodes).reduce((a, id) => a + spOf(nodeById(id)!), 0);
  while (spent() > rules.spCap) {
    const latest = byAge(Object.entries(nodes), (r) => r.at).pop();
    if (!latest) break;
    delete nodes[latest[0]];
    prune();
  }
}

/**
 * A record handed in from anywhere -- storage, the wire, a server's file -- cleaned, or null when it is not a
 * record at all. Every list is held to the limits handed in (the newest kept), XP to its caps, and the nodes to a
 * tree the data allows within the Skill Point cap; a section a later wave writes is kept when it is plain data.
 */
export function cleanRecord(raw: unknown, limits: ProgressLimits = PROGRESS_LIMITS, rules: ProgressRules = PROGRESS_RULES): ProgressRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== PROGRESS_VERSION || !isCharacterId(o.char)) return null;
  const rec = emptyRecord(o.char);
  rec.rev = count(o.rev);
  rec.base = count(o.base);
  rec.local = count(o.local);
  const cap = xpCap(rules);
  if (o.core && typeof o.core === 'object') {
    for (const s of CORE_SKILLS) {
      const xp = count((o.core as Record<string, unknown>)[s], cap);
      if (xp > 0) rec.core[s] = xp;
    }
  }
  if (o.pools && typeof o.pools === 'object') {
    for (const p of POOLS) {
      const xp = count((o.pools as Record<string, unknown>)[p], rules.bankCap);
      if (xp > 0) rec.pools[p] = xp;
    }
  }
  if (o.earned && typeof o.earned === 'object') {
    const earned = table<number>();
    for (const p of POOLS) {
      const xp = count((o.earned as Record<string, unknown>)[p]);
      if (xp > 0) earned[p] = xp;
    }
    rec.earned = earned;
  }
  if (o.nodes && typeof o.nodes === 'object' && !Array.isArray(o.nodes)) {
    for (const id of Object.keys(o.nodes)) {
      const n = (o.nodes as Record<string, unknown>)[id];
      if (!nodeById(id) || !n || typeof n !== 'object') continue;
      rec.nodes[id] = { at: count((n as Record<string, unknown>).at), xp: count((n as Record<string, unknown>).xp) };
    }
    repairNodes(rec.nodes, rules);
    // The cap on how many is a backstop, the latest-learnt past it dropped: the data has far fewer nodes than any limit.
    for (const [id] of byAge(Object.entries(rec.nodes), (r) => r.at).slice(limits.nodes)) delete rec.nodes[id];
    repairNodes(rec.nodes, rules);
  }
  if (o.gone && typeof o.gone === 'object' && !Array.isArray(o.gone)) {
    const gone: [string, number][] = [];
    for (const id of Object.keys(o.gone)) {
      const at = whole((o.gone as Record<string, unknown>)[id]);
      if (nodeById(id) && at !== undefined) gone.push([id, at]);
    }
    rec.gone = table(Object.fromEntries(byAge(gone, (a) => a).slice(-limits.gone)));
  }
  if (Array.isArray(o.seen)) {
    const seen: string[] = [];
    for (const k of o.seen) if (isHashKey(k) && !seen.includes(k)) seen.push(k);
    rec.seen = seen.slice(-limits.seen);
  }
  if (o.recent && typeof o.recent === 'object' && !Array.isArray(o.recent)) {
    const recent: [string, [number, number]][] = [];
    for (const k of Object.keys(o.recent)) {
      const v = (o.recent as Record<string, unknown>)[k];
      if (!isHashKey(k) || !Array.isArray(v) || v.length !== 2) continue;
      const at = whole(v[0]);
      const n = whole(v[1]);
      if (at !== undefined && n !== undefined) recent.push([k, [at, n]]);
    }
    rec.recent = table(Object.fromEntries(byAge(recent, (v) => v[0]).slice(-limits.recent)));
  }
  if (o.paid && typeof o.paid === 'object' && !Array.isArray(o.paid)) {
    const paid: [string, number][] = [];
    for (const k of Object.keys(o.paid)) {
      const at = whole((o.paid as Record<string, unknown>)[k]);
      if (isPaidKey(k) && at !== undefined) paid.push([k, at]);
    }
    rec.paid = table(Object.fromEntries(byAge(paid, (a) => a).slice(-limits.paid)));
  }
  if (Array.isArray(o.bonus)) {
    const bonus: string[] = [];
    for (const k of o.bonus) if (isHashKey(k) && !bonus.includes(k)) bonus.push(k);
    rec.bonus = bonus.slice(-limits.bonus);
  }
  if (Array.isArray(o.log)) {
    const log: LogRow[] = [];
    for (const r of o.log) {
      const row = cleanLogRow(r);
      if (row && !log.some((x) => x[0] === row[0] && x[2] === row[2])) log.push(row);
    }
    rec.log = log.slice(-limits.log);
  }
  const last = whole(o.last);
  if (last !== undefined && last > 0) rec.last = last;
  const rested = count(o.rested, rules.restedMax);
  if (rested > 0) rec.rested = rested;
  if (Array.isArray(o.perks)) rec.perks = o.perks.filter((p): p is string => typeof p === 'string' && PERK.test(p)).slice(0, 64);
  const budget = { left: SECTION_NODES };
  for (const k of Object.keys(o)) {
    if (KNOWN.includes(k) || FORBIDDEN_KEYS.includes(k) || k in Object.prototype) continue;
    const kept = plainCopy(o[k], 0, budget);
    if (kept !== undefined) rec[k] = kept;
  }
  return rec;
}

/** A change handed in from anywhere, cleaned, or null when it is not one this record takes. */
export function cleanChange(x: unknown): ProgressChange | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  switch (o.k) {
    case 'core': {
      const xp = whole(o.xp);
      return isCoreSkill(o.skill) && xp !== undefined ? { k: 'core', skill: o.skill, xp } : null;
    }
    case 'pool':
    case 'earned': {
      const xp = whole(o.xp);
      return isPool(o.pool) && xp !== undefined ? { k: o.k, pool: o.pool, xp } : null;
    }
    case 'node': {
      const r = o.rec && typeof o.rec === 'object' ? (o.rec as Record<string, unknown>) : null;
      const at = whole(r?.at);
      const xp = whole(r?.xp);
      return typeof o.id === 'string' && nodeById(o.id) && at !== undefined && xp !== undefined ? { k: 'node', id: o.id, rec: { at, xp } } : null;
    }
    case 'nodeGone':
    case 'goneClear':
      return typeof o.id === 'string' && nodeById(o.id) ? { k: o.k, id: o.id } : null;
    case 'gone': {
      const at = whole(o.at);
      return typeof o.id === 'string' && nodeById(o.id) && at !== undefined ? { k: 'gone', id: o.id, at } : null;
    }
    case 'seen':
    case 'seenDrop':
    case 'recentDrop':
    case 'bonus':
    case 'bonusDrop':
      return isHashKey(o.key) ? { k: o.k, key: o.key } : null;
    case 'recent': {
      const at = whole(o.at);
      const n = whole(o.n);
      return isHashKey(o.key) && at !== undefined && n !== undefined ? { k: 'recent', key: o.key, at, n } : null;
    }
    case 'paid': {
      const at = whole(o.at);
      return isPaidKey(o.key) && at !== undefined ? { k: 'paid', key: o.key, at } : null;
    }
    case 'paidDrop':
      return isPaidKey(o.key) ? { k: 'paidDrop', key: o.key } : null;
    case 'logRow': {
      const row = cleanLogRow(o.row);
      return row ? { k: 'logRow', row } : null;
    }
    case 'logDrop': {
      const first = whole(o.first);
      const src = whole(o.src);
      return first !== undefined && src !== undefined && src < LOG_SOURCES.length ? { k: 'logDrop', first, src } : null;
    }
    case 'last': {
      const at = whole(o.at);
      return at !== undefined ? { k: 'last', at } : null;
    }
    case 'rested': {
      const xp = whole(o.xp);
      return xp !== undefined ? { k: 'rested', xp } : null;
    }
    default:
      return null;
  }
}

function logAt(rec: ProgressRecord, first: number, src: number): number {
  const log = rec.log ?? [];
  for (let i = 0; i < log.length; i++) if (log[i][0] === first && log[i][2] === src) return i;
  return -1;
}

/** Why the record will not take a change as it stands, or null when it will. Changes nothing, and never trims. */
export function whyNotProgress(rec: ProgressRecord, c: ProgressChange, limits: ProgressLimits = PROGRESS_LIMITS): string | null {
  switch (c.k) {
    case 'core':
    case 'pool':
    case 'earned':
    case 'last':
    case 'rested':
      return null;
    case 'node':
      return !own(rec.nodes, c.id) && size(rec.nodes) >= limits.nodes ? `a record keeps ${limits.nodes} nodes` : null;
    case 'nodeGone':
      return own(rec.nodes, c.id) ? null : 'that node is not owned';
    case 'gone':
      return own(rec.gone, c.id) === undefined && size(rec.gone) >= limits.gone ? `a record remembers ${limits.gone} surrendered nodes` : null;
    case 'goneClear':
      return own(rec.gone, c.id) === undefined ? 'that node was not surrendered' : null;
    case 'seen':
      if (rec.seen?.includes(c.key)) return 'that is seen already';
      return (rec.seen?.length ?? 0) >= limits.seen ? `a record remembers ${limits.seen} things seen` : null;
    case 'seenDrop':
      return rec.seen?.includes(c.key) ? null : 'that is not seen';
    case 'recent':
      return own(rec.recent, c.key) === undefined && size(rec.recent) >= limits.recent ? `a record remembers ${limits.recent} recent wins` : null;
    case 'recentDrop':
      return own(rec.recent, c.key) === undefined ? 'that is not recent' : null;
    case 'paid':
      // The one rule every payment rests on: a claim is paid once, wherever it is paid.
      if (own(rec.paid, c.key) !== undefined) return 'that is paid already';
      return size(rec.paid) >= limits.paid ? `a record remembers ${limits.paid} payments` : null;
    case 'paidDrop':
      return own(rec.paid, c.key) === undefined ? 'that was not paid' : null;
    case 'bonus':
      if (rec.bonus?.includes(c.key)) return 'that bonus is paid already';
      return (rec.bonus?.length ?? 0) >= limits.bonus ? `a record remembers ${limits.bonus} quest bonuses` : null;
    case 'bonusDrop':
      return rec.bonus?.includes(c.key) ? null : 'that bonus was not paid';
    case 'logRow':
      return logAt(rec, c.row[0], c.row[2]) < 0 && (rec.log?.length ?? 0) >= limits.log ? `a record keeps ${limits.log} rows of payouts` : null;
    case 'logDrop':
      return logAt(rec, c.first, c.src) < 0 ? 'there is no such row' : null;
  }
}

function applyOne(rec: ProgressRecord, c: ProgressChange): void {
  switch (c.k) {
    // An XP of nought takes the entry away, so a record emptied is the empty record.
    case 'core':
      if (c.xp > 0) (rec.core ??= table<number>())[c.skill] = c.xp;
      else if (rec.core) delete rec.core[c.skill];
      return;
    case 'pool':
      if (c.xp > 0) (rec.pools ??= table<number>())[c.pool] = c.xp;
      else if (rec.pools) delete rec.pools[c.pool];
      return;
    case 'earned':
      if (c.xp > 0) (rec.earned ??= table<number>())[c.pool] = c.xp;
      else if (rec.earned) delete rec.earned[c.pool];
      return;
    case 'node':
      (rec.nodes ??= table<NodeRec>())[c.id] = { at: c.rec.at, xp: c.rec.xp };
      return;
    case 'nodeGone':
      delete rec.nodes[c.id];
      return;
    case 'gone':
      (rec.gone ??= table<number>())[c.id] = c.at;
      return;
    case 'goneClear':
      delete rec.gone![c.id];
      return;
    case 'seen':
      (rec.seen ??= []).push(c.key);
      return;
    case 'seenDrop':
      rec.seen!.splice(rec.seen!.indexOf(c.key), 1);
      return;
    case 'recent':
      (rec.recent ??= table<[number, number]>())[c.key] = [c.at, c.n];
      return;
    case 'recentDrop':
      delete rec.recent![c.key];
      return;
    case 'paid':
      (rec.paid ??= table<number>())[c.key] = c.at;
      return;
    case 'paidDrop':
      delete rec.paid![c.key];
      return;
    case 'bonus':
      (rec.bonus ??= []).push(c.key);
      return;
    case 'bonusDrop':
      rec.bonus!.splice(rec.bonus!.indexOf(c.key), 1);
      return;
    case 'logRow': {
      const log = (rec.log ??= []);
      const i = logAt(rec, c.row[0], c.row[2]);
      const row: LogRow = [c.row[0], c.row[1], c.row[2], c.row[3]];
      if (i >= 0) log[i] = row;
      else log.push(row);
      return;
    }
    case 'logDrop':
      rec.log!.splice(logAt(rec, c.first, c.src), 1);
      return;
    case 'last':
      if (c.at > 0) rec.last = c.at;
      else delete rec.last;
      return;
    case 'rested':
      if (c.xp > 0) rec.rested = c.xp;
      else delete rec.rested;
      return;
  }
}

/**
 * Apply a batch to a record, in place: each change cleaned, then taken if the record will take it as it stands
 * after the ones before it, refused with a reason if not. `rev` rises by one when anything was taken. The same
 * batch on the same record always does the same thing, which is what lets a server write a batch to its log and
 * play it back, and a browser apply the server's batch to its own copy and arrive at the same record.
 */
export function applyProgress(rec: ProgressRecord, ch: unknown, limits: ProgressLimits = PROGRESS_LIMITS): { changed: number; why: string[] } {
  const why: string[] = [];
  if (!Array.isArray(ch)) return { changed: 0, why: ['that is not a list of changes'] };
  let changed = 0;
  for (const raw of ch) {
    const c = cleanChange(raw);
    if (!c) {
      why.push('that is not a change this record takes');
      continue;
    }
    const no = whyNotProgress(rec, c, limits);
    if (no) {
      why.push(`${c.k}: ${no}`);
      continue;
    }
    applyOne(rec, c);
    changed++;
  }
  if (changed) rec.rev++;
  return { changed, why };
}

/** A list a payout may have to make room in before it adds one. */
export type TrimList = 'seen' | 'recent' | 'paid' | 'bonus' | 'log';

/**
 * The drops a batch must carry before it adds one entry to a list that is at its limit: the oldest first, ties by
 * key. Null when room cannot be made: a payment made at or after `keepFrom` (whole seconds: now less the claims'
 * longest age) is never dropped, since dropping it could let that claim be paid twice.
 */
export function trimFor(rec: ProgressRecord, list: TrimList, limits: ProgressLimits = PROGRESS_LIMITS, keepFrom = Infinity): ProgressChange[] | null {
  const out: ProgressChange[] = [];
  const limit = limits[list];
  if (list === 'seen' || list === 'bonus') {
    const items = rec[list] ?? [];
    for (let i = 0; items.length - i >= limit; i++) out.push({ k: list === 'seen' ? 'seenDrop' : 'bonusDrop', key: items[i] });
    return out;
  }
  if (list === 'log') {
    const rows = [...(rec.log ?? [])].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    for (let i = 0; rows.length - i >= limit; i++) out.push({ k: 'logDrop', first: rows[i][0], src: rows[i][2] });
    return out;
  }
  if (list === 'recent') {
    const rows = byAge(Object.entries(rec.recent ?? {}), (v) => v[0]);
    for (let i = 0; rows.length - i >= limit; i++) out.push({ k: 'recentDrop', key: rows[i][0] });
    return out;
  }
  const rows = byAge(Object.entries(rec.paid ?? {}), (at) => at);
  for (let i = 0; rows.length - i >= limit; i++) {
    if (rows[i][1] >= keepFrom) return null;
    out.push({ k: 'paidDrop', key: rows[i][0] });
  }
  return out;
}

/** The record as one line of text, as it is kept and sent. */
export function recordText(rec: ProgressRecord): string {
  return JSON.stringify(rec);
}

/**
 * A copy of a record that changes nothing in it: every table a table of its own with no prototype, every list
 * and every row a list of its own, a later wave's section copied as plain data. What a host works a batch out
 * on (so each trim it writes is decided against the list as the changes before it left it) and what a batch is
 * tried on before the record held takes it, without a round trip through `cleanRecord`, which would repair.
 */
export function copyRecord(rec: ProgressRecord): ProgressRecord {
  const out: ProgressRecord = { ...rec, core: table(rec.core), pools: table(rec.pools), nodes: table<NodeRec>() };
  for (const id of Object.keys(rec.nodes)) out.nodes[id] = { at: rec.nodes[id].at, xp: rec.nodes[id].xp };
  if (rec.earned) out.earned = table(rec.earned);
  if (rec.gone) out.gone = table(rec.gone);
  if (rec.seen) out.seen = [...rec.seen];
  if (rec.recent) {
    const r = table<[number, number]>();
    for (const k of Object.keys(rec.recent)) r[k] = [rec.recent[k][0], rec.recent[k][1]];
    out.recent = r;
  }
  if (rec.paid) out.paid = table(rec.paid);
  if (rec.bonus) out.bonus = [...rec.bonus];
  if (rec.log) out.log = rec.log.map((row) => [row[0], row[1], row[2], row[3]] as LogRow);
  if (rec.perks) out.perks = [...rec.perks];
  for (const k of Object.keys(rec)) {
    if (KNOWN.includes(k)) continue;
    const kept = plainCopy(rec[k], 0, { left: SECTION_NODES });
    if (kept !== undefined) out[k] = kept;
  }
  return out;
}

/** What `__debug.progress()` and a server's status page say of a record. */
export function recordSummary(rec: ProgressRecord | null): Record<string, unknown> | null {
  if (!rec) return null;
  return {
    char: rec.char,
    rev: rec.rev,
    base: rec.base,
    local: rec.local,
    sp: spSpent(rec),
    core: { ...rec.core },
    pools: { ...rec.pools },
    earned: { ...(rec.earned ?? {}) },
    nodes: Object.keys(rec.nodes).sort(),
    gone: Object.keys(rec.gone ?? {}).sort(),
    lists: { seen: rec.seen?.length ?? 0, recent: size(rec.recent), paid: size(rec.paid), bonus: rec.bonus?.length ?? 0, log: rec.log?.length ?? 0 },
    last: rec.last ?? null,
    rested: rec.rested ?? 0,
    chars: recordText(rec).length,
  };
}

/** Every node of every discipline, for the page and the console: its id, what it costs, its name. */
export function allNodes(): { id: string; tier: number; name: string; sp: number }[] {
  return DISCIPLINES.flatMap((d) => d.nodes.map((n) => ({ id: n.id, tier: n.tier, name: n.name, sp: spOf(n) })));
}
