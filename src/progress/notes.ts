// What the message line says when a character's progress moves, in our words and one line each: a payout ("Marksmanship
// +84, Demolitions +84"), a rating crossing a milestone ("Acrobatics 25: a landing roll from no higher than eight metres
// takes nothing"), a node learnt or given back, a quest's bonus ("Quest bonus: Marksmanship +40"). Worked out from the
// record as it stood before a batch and as it stands after, so nothing about them crosses a wire: whichever host
// paid, the browser that holds the copy says it. Pure, its own folder.

import { BUILT_CORE, coreDef, milestonesCrossed, ratingOf } from './core.ts';
import { DISCIPLINES, nodeById } from './disciplines.ts';
import { CORE_SKILLS, POOLS, type CoreSkill, type Pool, type ProgressRecord } from './record.ts';
import { PROGRESS_RULES, type ProgressRules } from './tune.ts';

/** What a record held of what the notes read, taken before a batch: small, and made only when a batch is applied. */
export interface ProgressSnap {
  core: Partial<Record<CoreSkill, number>>;
  pools: Partial<Record<Pool, number>>;
  nodes: string[];
}

export function snapOf(rec: ProgressRecord | null): ProgressSnap {
  return { core: { ...(rec?.core ?? {}) }, pools: { ...(rec?.pools ?? {}) }, nodes: Object.keys(rec?.nodes ?? {}) };
}

/** A core skill's or a pool's name as the page and the line say it. */
export function nameOf(what: CoreSkill | Pool): string {
  const c = coreDef(what as CoreSkill);
  if (c) return c.name;
  return DISCIPLINES.find((d) => d.id === what)?.name ?? what;
}

/** Why a batch was made, for what is said of it. */
export type NoteKind = 'claim' | 'task' | 'bonus' | 'learn' | 'surrender';

/** What every skill and pool gained, as one line, or null when nothing did; `prefix` heads it ("Quest bonus: "). */
export function gainWords(before: ProgressSnap, after: ProgressRecord, prefix = ''): string | null {
  const parts: string[] = [];
  for (const s of CORE_SKILLS) {
    const d = (after.core[s] ?? 0) - (before.core[s] ?? 0);
    if (d > 0) parts.push(`${nameOf(s)} +${d.toLocaleString('en-GB')}`);
  }
  for (const p of POOLS) {
    const d = (after.pools[p] ?? 0) - (before.pools[p] ?? 0);
    if (d > 0) parts.push(`${nameOf(p)} +${d.toLocaleString('en-GB')}`);
  }
  return parts.length ? `${prefix}${parts.join(', ')}` : null;
}

/** Every milestone a batch carried a skill past, a line each: what it does now, or what it waits on. */
export function milestoneWords(before: ProgressSnap, after: ProgressRecord, rules: ProgressRules = PROGRESS_RULES): string[] {
  const out: string[] = [];
  for (const s of BUILT_CORE) {
    const from = ratingOf(before.core[s] ?? 0, rules);
    const to = ratingOf(after.core[s] ?? 0, rules);
    for (const m of milestonesCrossed(s, from, to)) out.push(m.waits ? `${nameOf(s)} ${m.at}: ${m.name} (${m.waits})` : `${nameOf(s)} ${m.at}: ${m.text}`);
  }
  return out;
}

/** What one batch comes to on the message line. `fee` is a node given back's, in credits. */
export function progressNotes(kind: NoteKind, before: ProgressSnap, after: ProgressRecord, rules: ProgressRules = PROGRESS_RULES, fee = 0): string[] {
  const out: string[] = [];
  if (kind === 'learn') {
    for (const id of Object.keys(after.nodes)) if (!before.nodes.includes(id)) out.push(`Learnt ${nodeById(id)?.name ?? id}`);
  } else if (kind === 'surrender') {
    for (const id of before.nodes) if (!Object.hasOwn(after.nodes, id)) out.push(`Gave back ${nodeById(id)?.name ?? id}${fee > 0 ? ` for ${fee.toLocaleString('en-GB')} credits` : ''}`);
  } else {
    const gained = gainWords(before, after, kind === 'bonus' ? 'Quest bonus: ' : '');
    if (gained) out.push(gained);
  }
  out.push(...milestoneWords(before, after, rules));
  return out;
}
