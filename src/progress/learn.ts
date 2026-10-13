// What learning and giving back nodes, and gaining XP, write into a record: each one a batch of the record's own
// closed list, worked out against the record as it stands and handed to a host to apply, so the browser and the
// server write the same thing. Pure, its own folder.
//
// This wave builds the developer's half, which the console and a server's admin use: a node granted with no XP,
// Skill Points or teacher asked for (with whatever it needs above it, so the tree it leaves is one a record may
// hold and survives being read back), a node taken away (with whatever stands on it), XP given or taken, and a
// record emptied. Learning at a trainer, surrendering for a fee and the quest bonus are the next wave's, here.

import { xpCap } from './core.ts';
import { disciplineOf, nodeById, prerequisitesMet, TIER_COST, type NodeDef } from './disciplines.ts';
import { CORE_SKILLS, POOLS, isCoreSkill, isPool, spSpent, type CoreSkill, type Pool, type ProgressChange, type ProgressRecord } from './record.ts';
import type { ProgressRules } from './tune.ts';

export interface LearnResult {
  ch: ProgressChange[];
  why?: string;
}

/** The nodes a node needs owned with it, itself last, the ones already owned left out: its whole way down from the Novice. */
function wayTo(rec: ProgressRecord, node: NodeDef): NodeDef[] {
  const owned = new Set(Object.keys(rec.nodes));
  const want: NodeDef[] = [];
  const add = (n: NodeDef): void => {
    if (owned.has(n.id) || want.includes(n)) return;
    for (const r of n.requires) {
      const up = nodeById(r);
      if (up) add(up);
    }
    const branches = (TIER_COST[n.tier] as { branches?: number }).branches;
    if (branches) {
      // A Master wants whole branches: the ones furthest along first, in the data's order on a tie.
      const d = disciplineOf(n.discipline);
      const has = (b: string): number => (d?.nodes ?? []).filter((x) => x.branch === b && (owned.has(x.id) || want.includes(x))).length;
      const order = [...(d?.branches ?? [])].sort((a, b) => has(b.id) - has(a.id));
      for (const b of order.slice(0, branches)) for (const x of (d?.nodes ?? []).filter((y) => y.branch === b.id).sort((p, q) => p.tier - q.tier)) add(x);
    }
    want.push(n);
  };
  add(node);
  return want;
}

/**
 * A node given outright, the developer's and the admin's way: no XP, no Skill Points asked for and no teacher,
 * with every node it needs above it, each learnt at `at` for nought, and the relearn window of any of them
 * cleared. Refused for a node that is not one, one owned already, and a way down that would pass the Skill Point
 * cap (a record past it is cut back when it is read, so the grant would not survive a reload).
 */
export function grantChanges(rec: ProgressRecord, id: string, at: number, rules: ProgressRules): LearnResult {
  const node = nodeById(id);
  if (!node) return { ch: [], why: `there is no node ${id}` };
  if (Object.hasOwn(rec.nodes, id)) return { ch: [], why: `${node.name} is learnt already` };
  const way = wayTo(rec, node);
  const sp = spSpent(rec) + way.reduce((a, n) => a + (TIER_COST[n.tier]?.sp ?? 0), 0);
  if (sp > rules.spCap) return { ch: [], why: `that would spend ${sp} Skill Points of ${rules.spCap}` };
  const ch: ProgressChange[] = [];
  for (const n of way) {
    ch.push({ k: 'node', id: n.id, rec: { at, xp: 0 } });
    if (rec.gone && Object.hasOwn(rec.gone, n.id)) ch.push({ k: 'goneClear', id: n.id });
  }
  return { ch };
}

/**
 * A node taken away, the developer's way: with every owned node that stands on it (below it in its branch, and a
 * Master that loses a whole branch), each written down as surrendered at `at`. No fee and no XP back: the next
 * wave's surrender at a trainer is the player's way.
 */
export function unlearnChanges(rec: ProgressRecord, id: string, at: number): LearnResult {
  const node = nodeById(id);
  if (!node) return { ch: [], why: `there is no node ${id}` };
  if (!Object.hasOwn(rec.nodes, id)) return { ch: [], why: `${node.name} is not learnt` };
  const left = new Set(Object.keys(rec.nodes));
  left.delete(id);
  for (let changed = true; changed; ) {
    changed = false;
    for (const x of [...left]) {
      const n = nodeById(x);
      if (n && !prerequisitesMet(n, (y) => left.has(y))) {
        left.delete(x);
        changed = true;
      }
    }
  }
  const ch: ProgressChange[] = [];
  for (const x of Object.keys(rec.nodes).sort()) {
    if (left.has(x)) continue;
    ch.push({ k: 'nodeGone', id: x }, { k: 'gone', id: x, at });
  }
  return { ch };
}

/**
 * XP given (or taken, with a number under nought) to core skills and pools, written as the totals they come to,
 * each held to its cap: a core skill to what 100 needs, a pool to the bank's cap. A pool's lifetime XP rises by
 * what was given and never falls.
 */
export function xpChanges(rec: ProgressRecord, gains: Record<string, unknown>, rules: ProgressRules): LearnResult {
  const ch: ProgressChange[] = [];
  const bad: string[] = [];
  for (const k of Object.keys(gains)) {
    const n = gains[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      bad.push(k);
      continue;
    }
    const add = Math.round(n);
    if (isCoreSkill(k)) {
      ch.push({ k: 'core', skill: k, xp: Math.max(0, Math.min(xpCap(rules), (rec.core[k] ?? 0) + add)) });
    } else if (isPool(k)) {
      const now = Math.max(0, Math.min(rules.bankCap, (rec.pools[k] ?? 0) + add));
      ch.push({ k: 'pool', pool: k, xp: now });
      const gained = now - (rec.pools[k] ?? 0);
      if (gained > 0) ch.push({ k: 'earned', pool: k, xp: (rec.earned?.[k] ?? 0) + gained });
    } else bad.push(k);
  }
  return bad.length ? { ch, why: `not a core skill or a pool: ${bad.join(', ')} (${[...CORE_SKILLS, ...POOLS].join(', ')})` } : { ch };
}

/**
 * Everything a record holds taken away, change by change, so it comes out the empty record (its counters apart),
 * and a host applies it like any other batch.
 */
export function resetChanges(rec: ProgressRecord): ProgressChange[] {
  const ch: ProgressChange[] = [];
  for (const s of Object.keys(rec.core) as CoreSkill[]) ch.push({ k: 'core', skill: s, xp: 0 });
  for (const p of Object.keys(rec.pools) as Pool[]) ch.push({ k: 'pool', pool: p, xp: 0 });
  for (const p of Object.keys(rec.earned ?? {}) as Pool[]) ch.push({ k: 'earned', pool: p, xp: 0 });
  for (const id of Object.keys(rec.nodes)) ch.push({ k: 'nodeGone', id });
  for (const id of Object.keys(rec.gone ?? {})) ch.push({ k: 'goneClear', id });
  for (const key of rec.seen ?? []) ch.push({ k: 'seenDrop', key });
  for (const key of Object.keys(rec.recent ?? {})) ch.push({ k: 'recentDrop', key });
  for (const key of Object.keys(rec.paid ?? {})) ch.push({ k: 'paidDrop', key });
  for (const key of rec.bonus ?? []) ch.push({ k: 'bonusDrop', key });
  for (const row of rec.log ?? []) ch.push({ k: 'logDrop', first: row[0], src: row[2] });
  if (rec.last) ch.push({ k: 'last', at: 0 });
  if (rec.rested) ch.push({ k: 'rested', xp: 0 });
  return ch;
}
