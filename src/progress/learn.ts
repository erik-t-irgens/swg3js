// What learning and giving back nodes, and gaining XP, write into a record: each one a batch of the record's own
// closed list, worked out against the record as it stands and handed to a host to apply, so the browser and the
// server write the same thing. Pure, its own folder.
//
// The player's own half: a node learnt at a trainer for its tier's XP and Skill Points, half its XP again within
// a month of giving it back (`relearnDays`, `relearnShare`); a node given back at a trainer for a fee in credits,
// the Skill Points coming back and the XP not, from the bottom of a branch up and the Master first; and a quest's
// bonus, paid into the skills the character used while the quest ran and never into a general pool. The page
// never decides a cost of its own: it asks `whyNotLearn` and `whyNotSurrender`, the very rules the host applies.
//
// And the developer's half, which the console and a server's admin use: a node granted with no XP, Skill Points
// or teacher asked for (with whatever it needs above it, so the tree it leaves is one a record may hold and
// survives being read back), a node taken away (with whatever stands on it), XP given or taken, and a record
// emptied.

import { xpCap } from './core.ts';
import { DISCIPLINES, TRAINERS, disciplineOf, nodeById, prerequisitesMet, spOf, TIER_COST, type NodeDef } from './disciplines.ts';
import { CORE_SKILLS, LOG_SOURCES, POOLS, applyProgress, copyRecord, fnv32, isCoreSkill, isPool, secondsOf, spSpent, trimFor, type CoreSkill, type Pool, type ProgressChange, type ProgressRecord } from './record.ts';
import { PROGRESS_LIMITS, PROGRESS_RULES, type ProgressLimits, type ProgressRules } from './tune.ts';

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

// ---- the player's own: learning, giving back, the quest bonus ---------------------------------------------

/** Whether a kind of person (`trainer_commando`) teaches a node's discipline (`TRAINERS`). */
export function teaches(teacher: string | null | undefined, node: NodeDef): boolean {
  return !!teacher && Object.hasOwn(TRAINERS, teacher) && TRAINERS[teacher].includes(node.discipline);
}

/** Whether a node's tier is learnt only from a teacher (the Novice, III, IV and the Master). */
export function wantsTeacher(node: NodeDef): boolean {
  return TIER_COST[node.tier]?.teacher === 'trainer';
}

/** Seconds in a day, for the relearn window. */
const DAY = 86400;

/** The XP a node costs to learn now (`now` whole seconds): its tier's, or the relearn share of it within `relearnDays` of giving it back. */
export function learnCost(rec: ProgressRecord, node: NodeDef, now: number, rules: ProgressRules = PROGRESS_RULES): number {
  const full = TIER_COST[node.tier]?.xp ?? 0;
  const gone = rec.gone && Object.hasOwn(rec.gone, node.id) ? rec.gone[node.id] : undefined;
  return gone !== undefined && now - gone <= rules.relearnDays * DAY ? Math.round(full * rules.relearnShare) : full;
}

/** The credits giving a node back costs: `feePerTier` times its tier plus one. */
export function surrenderFee(node: NodeDef, rules: ProgressRules = PROGRESS_RULES): number {
  return rules.feePerTier * (node.tier + 1);
}

/**
 * Why a node may not be learnt now, or null when it may: there is no such node; it is owned; what it needs is
 * not owned (the Novice, the node above it in its branch, three branches for the Master); it would spend more
 * Skill Points than there are; it wants a teacher of its discipline and none is in reach; or its discipline's
 * pool has not the XP. `now` is whole seconds on the shared clock.
 */
export function whyNotLearn(rec: ProgressRecord, id: string, teacher: string | null, now: number, rules: ProgressRules = PROGRESS_RULES): string | null {
  const node = nodeById(id);
  if (!node) return `there is no node ${id}`;
  if (Object.hasOwn(rec.nodes, id)) return `${node.name} is learnt already`;
  if (!prerequisitesMet(node, (x) => Object.hasOwn(rec.nodes, x))) {
    const want = (TIER_COST[node.tier] as { branches?: number }).branches;
    if (want) return `${node.name} wants ${want} branches learnt to the end`;
    const missing = node.requires.map((r) => nodeById(r)).filter((n): n is NodeDef => !!n && !Object.hasOwn(rec.nodes, n.id));
    return `${node.name} wants ${missing.map((n) => n.name).join(' and ') || 'what comes before it'} first`;
  }
  const sp = spSpent(rec) + spOf(node);
  if (sp > rules.spCap) return `that would spend ${sp} Skill Points of ${rules.spCap}`;
  if (wantsTeacher(node) && !teaches(teacher, node)) return `${node.name} is learnt from a trainer who teaches ${disciplineOf(node.discipline)?.name ?? node.discipline}`;
  const cost = learnCost(rec, node, now, rules);
  const bank = rec.pools[node.discipline] ?? 0;
  if (bank < cost) return `${node.name} costs ${cost.toLocaleString('en-GB')} ${disciplineOf(node.discipline)?.name ?? node.discipline} experience and you have ${bank.toLocaleString('en-GB')}`;
  return null;
}

/** Where a node stands for the character, as the page draws it. */
export type NodeState = 'owned' | 'learnable' | 'needsXp' | 'needsTrainer' | 'needsSp' | 'locked';

/** A node's state, by the very rule `whyNotLearn` applies, read in the order a player meets them. */
export function nodeState(rec: ProgressRecord, id: string, teacher: string | null, now: number, rules: ProgressRules = PROGRESS_RULES): NodeState {
  const node = nodeById(id);
  if (!node) return 'locked';
  if (Object.hasOwn(rec.nodes, id)) return 'owned';
  if (!prerequisitesMet(node, (x) => Object.hasOwn(rec.nodes, x))) return 'locked';
  if (spSpent(rec) + spOf(node) > rules.spCap) return 'needsSp';
  if ((rec.pools[node.discipline] ?? 0) < learnCost(rec, node, now, rules)) return 'needsXp';
  if (wantsTeacher(node) && !teaches(teacher, node)) return 'needsTrainer';
  return 'learnable';
}

/**
 * A node learnt: owned from `at` at what it cost, its discipline's pool less that, and the record of having given
 * it back cleared. Refused, with nothing written, for anything `whyNotLearn` refuses.
 */
export function learnChanges(rec: ProgressRecord, id: string, teacher: string | null, at: number, rules: ProgressRules = PROGRESS_RULES): LearnResult & { xp?: number } {
  const why = whyNotLearn(rec, id, teacher, at, rules);
  if (why) return { ch: [], why };
  const node = nodeById(id)!;
  const cost = learnCost(rec, node, at, rules);
  const bank = rec.pools[node.discipline] ?? 0;
  const ch: ProgressChange[] = [{ k: 'node', id, rec: { at, xp: cost } }, { k: 'pool', pool: node.discipline, xp: bank - cost }];
  if (rec.gone && Object.hasOwn(rec.gone, id)) ch.push({ k: 'goneClear', id });
  return { ch, xp: cost };
}

/**
 * Why a node may not be given back now, or null when it may: it is not owned; nobody in reach teaches its
 * discipline; a node stands on it (the one below it in its branch, everything on the Novice); or it is not the
 * Master while the Master stands, which goes first.
 */
export function whyNotSurrender(rec: ProgressRecord, id: string, teacher: string | null): string | null {
  const node = nodeById(id);
  if (!node) return `there is no node ${id}`;
  if (!Object.hasOwn(rec.nodes, id)) return `${node.name} is not learnt`;
  if (!teaches(teacher, node)) return `${node.name} is given back to a trainer who teaches ${disciplineOf(node.discipline)?.name ?? node.discipline}`;
  const d = disciplineOf(node.discipline);
  const master = d?.nodes.find((n) => (TIER_COST[n.tier] as { branches?: number }).branches && Object.hasOwn(rec.nodes, n.id) && n.id !== id);
  if (master) return `${master.name} goes first`;
  const on = (d?.nodes ?? []).filter((n) => n.id !== id && Object.hasOwn(rec.nodes, n.id) && n.requires.includes(id));
  if (on.length) return `${on.map((n) => n.name).join(' and ')} stands on ${node.name}: give that back first`;
  return null;
}

/** A node given back: no longer owned, written down as given back at `at`, and the fee the purse is to take. */
export function surrenderChanges(rec: ProgressRecord, id: string, teacher: string | null, at: number, rules: ProgressRules = PROGRESS_RULES): LearnResult & { fee: number } {
  const why = whyNotSurrender(rec, id, teacher);
  if (why) return { ch: [], why, fee: 0 };
  const node = nodeById(id)!;
  return { ch: [{ k: 'nodeGone', id }, { k: 'gone', id, at }], fee: surrenderFee(node, rules) };
}

/**
 * A quest's bonus (`PayOrder.bonus`): `xp` times the XP rate, split over the skills and pools the character was
 * paid into since the quest's run began (`since`, the shared clock's milliseconds), by what each earned in that
 * time (the record's `log`), each held to its cap. Its key, the story's own reward key hashed, goes first in the
 * batch, so it is paid once whatever asks again. No skill used, nothing paid: it never pays a general pool. It
 * never takes the rested bonus, and never fills a bucket.
 */
export function questBonus(rec: ProgressRecord, key: string, xp: number, since: number, ctx: { now: number; rules?: ProgressRules; limits?: ProgressLimits }): LearnResult & { paid: Partial<Record<CoreSkill | Pool, number>> } {
  const rules = ctx.rules ?? PROGRESS_RULES;
  const limits = ctx.limits ?? PROGRESS_LIMITS;
  const bkey = fnv32(key);
  if (rec.bonus?.includes(bkey)) return { ch: [], why: 'that bonus is paid already', paid: {} };
  const total = Math.round(Math.max(0, xp) * rules.xpRate);
  if (!(total > 0)) return { ch: [], why: 'the quest pays no experience', paid: {} };
  const from = secondsOf(since);
  const weight = new Map<number, number>();
  for (const row of rec.log ?? []) if (row[1] >= from && row[3] > 0) weight.set(row[2], (weight.get(row[2]) ?? 0) + row[3]);
  const sum = [...weight.values()].reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return { ch: [], why: 'no skill was used during the quest', paid: {} };
  const draft = copyRecord(rec);
  const ch: ProgressChange[] = [];
  const add = (c: ProgressChange): void => {
    if (applyProgress(draft, [c], limits).changed) ch.push(c);
  };
  for (const d of trimFor(draft, 'bonus', limits) ?? []) add(d);
  add({ k: 'bonus', key: bkey });
  const paid: Partial<Record<CoreSkill | Pool, number>> = {};
  for (const [src, w] of [...weight].sort((a, b) => a[0] - b[0])) {
    const pool = LOG_SOURCES[src];
    const share = Math.round((total * w) / sum);
    if (!pool || share <= 0) continue;
    if (isCoreSkill(pool)) {
      const was = draft.core[pool] ?? 0;
      const now = Math.min(xpCap(rules), was + share);
      if (now > was) {
        add({ k: 'core', skill: pool, xp: now });
        paid[pool] = now - was;
      }
    } else if (isPool(pool)) {
      const was = draft.pools[pool] ?? 0;
      const now = Math.min(rules.bankCap, was + share);
      if (now > was) {
        add({ k: 'pool', pool, xp: now });
        add({ k: 'earned', pool, xp: (draft.earned?.[pool] ?? 0) + (now - was) });
        paid[pool] = now - was;
      }
    }
  }
  if (!Object.keys(paid).length) return { ch: [], why: 'every skill used is full', paid: {} };
  return { ch, paid };
}

/** Every node of every discipline in the page's order: the Novice, each branch top to bottom, then the Master. */
export function treeOrder(): NodeDef[] {
  const out: NodeDef[] = [];
  for (const d of DISCIPLINES) {
    out.push(...d.nodes.filter((n) => n.branch === null && n.tier === 0));
    for (const b of d.branches) out.push(...d.nodes.filter((n) => n.branch === b.id).sort((p, q) => p.tier - q.tier));
    out.push(...d.nodes.filter((n) => n.branch === null && n.tier > 0));
  }
  return out;
}
