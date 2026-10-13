// What a discipline is, what its nodes cost and who teaches them. Each discipline is the SWG shape the doc
// keeps: a Novice node, four branches of four tiers, and a Master that needs three branches complete. A node
// costs its tier's Skill Points and its tier's XP out of the discipline's own pool (the doc's Figure 1), and
// the higher tiers want a teacher. Skill Points are never earned and never stored: the 250 are there from
// creation, and what is spent is the sum of what the nodes owned cost (`spSpent`).
//
// A node's grants are data; their numbers are `PROGRESS_RULES`'s by name (`rule`), so they move live through
// `__debug.progress({ rules })`, or a plain `value` where the number is a switch. `prof` is recorded and read
// by nothing until the proficiency table (Progression II); `technique` is a name only. Pure, its own folder.

import { DEMOLITIONS } from './demolitions.ts';
import type { Pool, ProgressRecord } from './record.ts';
import type { GrantOp, SourcedGrant, StatId } from './stats.ts';
import type { ProgressRules } from './tune.ts';

/** The doc's Figure 1: Skill Points, XP and the teacher each tier wants. */
export const TIER_COST = [
  { tier: 0, name: 'Novice', sp: 8, xp: 1000, teacher: 'trainer' },
  { tier: 1, name: 'I', sp: 4, xp: 2500, teacher: null },
  { tier: 2, name: 'II', sp: 6, xp: 6000, teacher: null },
  // A holocron, later.
  { tier: 3, name: 'III', sp: 8, xp: 12000, teacher: 'trainer' },
  // A player master, later.
  { tier: 4, name: 'IV', sp: 10, xp: 20000, teacher: 'trainer' },
  // A master trainer or a trial, later.
  { tier: 5, name: 'Master', sp: 14, xp: 35000, teacher: 'trainer', branches: 3 },
] as const;

/** One thing a node does: to which stat, how, and its number, written out or named in `PROGRESS_RULES[rules]`. */
export interface GrantDef {
  stat: StatId;
  op: GrantOp;
  value?: number;
  rule?: string;
}

export interface NodeDef {
  id: string;
  discipline: Pool;
  /** Its branch, or null for the Novice and the Master. */
  branch: string | null;
  tier: number;
  /** The doc's name, and its words for it. */
  name: string;
  text: string;
  /** What this pass makes of it, where that differs from the doc's words or waits on something. */
  note?: string;
  /** Said under the node on the page: what it is in this pass stands in for the doc's until something else is built. */
  standIn?: string;
  /** The nodes it needs owned: the Novice, or the node above it in its branch. The Master's three branches are its tier's rule. */
  requires: string[];
  grants: GrantDef[];
  prof?: { family: string; tier: 'familiar' | 'proficient' }[];
  technique?: string;
}

export interface DisciplineDef {
  id: Pool;
  name: string;
  /** Which table of `PROGRESS_RULES` its nodes' numbers are named in. */
  rules: 'demo';
  branches: { id: string; name: string }[];
  nodes: NodeDef[];
}

/** Every discipline this pass builds. */
export const DISCIPLINES: readonly DisciplineDef[] = [DEMOLITIONS];

/**
 * Who teaches what, by the kind of person the world stands [ours]: the game's own commando trainers carried the
 * thrown weapons, and nothing else in the world can teach Demolitions.
 */
export const TRAINERS: Record<string, string[]> = { trainer_commando: ['demolitions'] };

/**
 * The worlds that stand each kind of trainer [the emulator's]: the worlds whose rows in
 * `tools/swg/core3ref/statics.json` stand one (Corellia one, Rori three, Talus two, Tatooine three of the nine).
 */
export const TRAINER_WORLDS: Record<string, string[]> = { trainer_commando: ['corellia', 'rori', 'talus', 'tatooine'] };

/** What the page and the line call each kind of trainer [ours]. */
export const TRAINER_NAMES: Record<string, string> = { trainer_commando: 'commando trainer' };

const NODES = new Map<string, NodeDef>();
for (const d of DISCIPLINES) for (const n of d.nodes) NODES.set(n.id, n);

/** A node by its id, or undefined: only ever the data's own. */
export function nodeById(id: string): NodeDef | undefined {
  return typeof id === 'string' ? NODES.get(id) : undefined;
}

export function disciplineOf(pool: Pool): DisciplineDef | undefined {
  return DISCIPLINES.find((d) => d.id === pool);
}

/** Skill Points a node costs. */
export function spOf(node: NodeDef): number {
  return TIER_COST[node.tier]?.sp ?? 0;
}

/** Whether every node of a branch is owned. */
function branchDone(d: DisciplineDef, branch: string, owned: (id: string) => boolean): boolean {
  const nodes = d.nodes.filter((n) => n.branch === branch);
  return nodes.length > 0 && nodes.every((n) => owned(n.id));
}

/**
 * Whether a node may be held with the nodes owned: what it requires owned, and for a Master its discipline's
 * Novice and as many complete branches as its tier asks.
 */
export function prerequisitesMet(node: NodeDef, owned: (id: string) => boolean): boolean {
  for (const r of node.requires) if (!owned(r)) return false;
  const want = (TIER_COST[node.tier] as { branches?: number }).branches;
  if (want) {
    const d = disciplineOf(node.discipline);
    if (!d) return false;
    if (d.branches.filter((b) => branchDone(d, b.id, owned)).length < want) return false;
  }
  return true;
}

/** A node's grant's number: written out, or named in its discipline's table of the rules. */
function grantValue(g: GrantDef, rules: ProgressRules, table: 'demo'): number {
  if (g.rule !== undefined) {
    const v = (rules[table] as Record<string, number | undefined>)[g.rule];
    return typeof v === 'number' ? v : NaN;
  }
  return typeof g.value === 'number' ? g.value : NaN;
}

/**
 * The discipline layer's grants for a record: every owned node's, tier by tier and then by id, so a node that
 * sets a stat deeper in a tree wins over one above it (a `set`'s last one wins).
 */
export function nodeGrants(rec: ProgressRecord, rules: ProgressRules): SourcedGrant[] {
  const owned: NodeDef[] = [];
  for (const id of Object.keys(rec.nodes ?? {})) {
    const n = NODES.get(id);
    if (n) owned.push(n);
  }
  owned.sort((a, b) => a.tier - b.tier || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: SourcedGrant[] = [];
  for (const n of owned) {
    const d = disciplineOf(n.discipline);
    if (!d) continue;
    for (const g of n.grants) {
      const v = grantValue(g, rules, d.rules);
      if (Number.isFinite(v)) out.push({ stat: g.stat, op: g.op, value: v, layer: 'discipline', from: n.name });
    }
  }
  return out;
}
