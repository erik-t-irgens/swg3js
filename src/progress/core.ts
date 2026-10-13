// The seven core skills of the owner's Table C, as data, the four the game has hooks for built (the doc's own
// build order): Marksmanship, Melee, Fortitude and Acrobatics. A skill is rated 0 to 100 from the XP it has,
// never from Skill Points; it steadies something a little along a curve (written as its value at 100 and met
// a hundredth at a time), and it has a milestone every 25 points, met whole once reached. A milestone that
// needs something the game has not got yet (a technique, a perk slot, the Force) says what it arrives with.
//
// **At rating 0 a skill grants nothing at all**: no entry is written, so a character who has done nothing is
// the game as it was, to the bit. Every number is `PROGRESS_RULES.core`'s, the rating curve `coreK` and
// `coreExp`, so all of it moves live through `__debug.progress({ rules })`. Pure, its own folder only.

import type { CoreSkill, ProgressRecord } from './record.ts';
import type { GrantOp, SourcedGrant, StatId } from './stats.ts';
import type { ProgressRules } from './tune.ts';

/** One thing a skill does: to which stat, how, and the name of its number in `PROGRESS_RULES.core[skill]`. */
export interface CoreEffect {
  stat: StatId;
  op: GrantOp;
  rule: string;
}

export interface Milestone {
  at: 25 | 50 | 75 | 100;
  /** The doc's name for it. */
  name: string;
  /** What it does, in our words. */
  text: string;
  /** What it grants once reached, whole. */
  grants: CoreEffect[];
  /** What it waits on, when the game has nothing for it to act on yet; null when it works. */
  waits: string | null;
}

export interface CoreDef {
  id: CoreSkill;
  name: string;
  /** What raises it (Table C's successes). */
  grows: string;
  /** What it improves. */
  improves: string;
  /** Whether this pass builds it. */
  built: boolean;
  /** What it does along its rating, written as its value at 100. */
  curve: CoreEffect[];
  milestones: Milestone[];
}

const later = (name: string, at: Milestone['at'], waits: string): Milestone => ({ at, name, text: name, grants: [], waits });

/** Table C, in the doc's order. */
export const CORE: readonly CoreDef[] = [
  {
    id: 'athletics',
    name: 'Athletics',
    grows: 'traversal that completes something: reaching an objective, escaping, catching a target',
    improves: 'sprint, stamina, jump height, climbing, the grapple',
    built: false,
    curve: [],
    milestones: [later('Vault obstacles', 25, 'not built yet'), later('Higher mantle', 50, 'not built yet'), later('Extended sprint', 75, 'not built yet'), later('Second wind', 100, 'not built yet')],
  },
  {
    id: 'acrobatics',
    name: 'Acrobatics',
    grows: 'a roll that saves you from a fall, a dodge that beats a blow',
    improves: 'how far you fall unhurt, a landing roll, air control, a roll’s dodge',
    built: true,
    curve: [
      { stat: 'fall.safeExtra', op: 'add', rule: 'safeExtra' },
      { stat: 'fall.rollDivisor', op: 'add', rule: 'rollDivisor' },
      { stat: 'move.airAccel', op: 'mul', rule: 'airAccel' },
      { stat: 'roll.iframes', op: 'add', rule: 'iframes' },
    ],
    milestones: [
      { at: 25, name: 'Roll out of falls up to 8 m', text: 'a landing roll from no higher than eight metres takes nothing', grants: [{ stat: 'fall.rollFree', op: 'set', rule: 'rollFree' }], waits: null },
      later('Wall run', 50, 'arrives with the Force pass'),
      later('Vault over enemies', 75, 'arrives later'),
      later('Aerial dodge', 100, 'arrives with the Force pass'),
    ],
  },
  {
    id: 'marksmanship',
    name: 'Marksmanship',
    grows: 'guns that land on a hostile in a fight you win',
    improves: 'spread from the hip and aimed, how fast the view comes to the shoulder',
    built: true,
    curve: [
      { stat: 'gun.spread', op: 'mul', rule: 'spread' },
      { stat: 'gun.aimSpread', op: 'mul', rule: 'aimSpread' },
    ],
    milestones: [
      { at: 25, name: 'Steady breath', text: 'aimed and still for a moment, a shot’s aimed spread halves', grants: [{ stat: 'gun.steady', op: 'set', rule: 'steady' }], waits: null },
      { at: 50, name: 'Snap aim', text: 'the view comes to the shoulder twice as fast (the view: a shot’s spread does not blend)', grants: [{ stat: 'gun.aimRate', op: 'set', rule: 'aimRate' }], waits: null },
      later('Weak-point highlight', 75, 'arrives later: nothing has weak points yet'),
      later('No moving-fire penalty', 100, 'arrives with proficiency: there is no penalty yet to take away'),
    ],
  },
  {
    id: 'melee',
    name: 'Melee',
    grows: 'blades and fists that land in a fight you win, blocks that save you',
    improves: 'your own saber’s swing, how hard a kick or a fist shoves',
    built: true,
    curve: [
      { stat: 'saber.swing', op: 'mul', rule: 'swing' },
      { stat: 'melee.push', op: 'mul', rule: 'push' },
    ],
    milestones: [later('Heavy attacks', 25, 'arrives with techniques'), later('Counter-strike', 50, 'arrives with techniques'), later('Guard break', 75, 'arrives with techniques'), later('Perfect-block slow-mo', 100, 'arrives with techniques, on your own screen only')],
  },
  {
    id: 'fortitude',
    name: 'Fortitude',
    grows: 'living through a fight that nearly killed you',
    improves: 'health, how long a burn lasts',
    built: true,
    curve: [
      { stat: 'health.max', op: 'add', rule: 'health' },
      { stat: 'resist.burn', op: 'mul', rule: 'burn' },
    ],
    milestones: [
      { at: 25, name: 'Faster stun recovery', text: 'a burn wears off in half the time again', grants: [{ stat: 'resist.burn', op: 'mul', rule: 'burnMore' }], waits: null },
      later('+1 perk slot', 50, 'arrives with perk slots'),
      { at: 75, name: 'Last stand', text: 'a blow that would kill you leaves you one point of health, once a fight', grants: [], waits: null },
      later('+1 perk slot', 100, 'arrives with perk slots'),
    ],
  },
  {
    id: 'awareness',
    name: 'Awareness',
    grows: 'spotting enemies, traps and tracks before they act on you',
    improves: 'detection, trap spotting, threat indicators',
    built: false,
    curve: [],
    milestones: [later('Directional footsteps', 25, 'not built yet'), later('Spot traps', 50, 'not built yet'), later('See tracks', 75, 'not built yet'), later('Ambush sense', 100, 'not built yet')],
  },
  {
    id: 'finesse',
    name: 'Finesse',
    grows: 'reloads under fire in fights you win; arming, disarming and slicing',
    improves: 'reload, swap, arm and disarm speed',
    built: false,
    curve: [],
    milestones: [later('Tactical reload', 25, 'not built yet'), later('Quick disarm', 50, 'not built yet'), later('Faster slicing', 75, 'not built yet'), later('Swap while sprinting', 100, 'not built yet')],
  },
];

/** The four this pass builds, in the doc's build order. */
export const BUILT_CORE: readonly CoreSkill[] = ['marksmanship', 'melee', 'fortitude', 'acrobatics'];

export function coreDef(skill: CoreSkill): CoreDef | undefined {
  return CORE.find((c) => c.id === skill);
}

/** XP a rating needs in all: `round(coreK x r^coreExp)`. */
export function xpFor(r: number, rules: ProgressRules): number {
  return Math.round(rules.coreK * Math.pow(Math.max(0, r), rules.coreExp));
}

/** The most XP a core skill holds: what 100 needs. */
export function xpCap(rules: ProgressRules): number {
  return xpFor(100, rules);
}

/** The whole rating some XP makes, 0 to 100. */
export function ratingOf(xp: number, rules: ProgressRules): number {
  if (!(xp > 0)) return 0;
  let r = Math.max(0, Math.min(100, Math.floor(Math.pow(xp / rules.coreK, 1 / rules.coreExp))));
  while (r < 100 && xpFor(r + 1, rules) <= xp) r++;
  while (r > 0 && xpFor(r, rules) > xp) r--;
  return r;
}

/** One skill's number by its name, out of `rules.core`; NaN when the rules have no such number. */
function ruleOf(skill: CoreSkill, rule: string, rules: ProgressRules): number {
  const t = (rules.core as Record<string, Record<string, number> | undefined>)[skill];
  const v = t ? t[rule] : undefined;
  return typeof v === 'number' ? v : NaN;
}

/** A curve's value at a rating: a factor met a hundredth at a time, an amount the same. */
function curveValue(op: GrantOp, at100: number, rating: number): number {
  if (op === 'mul') return 1 + ((at100 - 1) * rating) / 100;
  if (op === 'add') return (at100 * rating) / 100;
  return at100;
}

/**
 * The core layer's grants for a record: each built skill's curve at its rating, and every milestone it has
 * reached. A skill at 0 writes nothing.
 */
export function coreGrants(rec: ProgressRecord, rules: ProgressRules): SourcedGrant[] {
  const out: SourcedGrant[] = [];
  for (const skill of BUILT_CORE) {
    const r = ratingOf(rec.core?.[skill] ?? 0, rules);
    if (r <= 0) continue;
    const def = coreDef(skill);
    if (!def) continue;
    for (const c of def.curve) {
      const v = ruleOf(skill, c.rule, rules);
      if (Number.isFinite(v)) out.push({ stat: c.stat, op: c.op, value: curveValue(c.op, v, r), layer: 'core', from: `${def.name} ${r}` });
    }
    for (const m of def.milestones) {
      if (r < m.at) continue;
      for (const c of m.grants) {
        const v = ruleOf(skill, c.rule, rules);
        if (Number.isFinite(v)) out.push({ stat: c.stat, op: c.op, value: v, layer: 'core', from: `${def.name} ${m.at}: ${m.name}` });
      }
    }
  }
  return out;
}

/** Each built skill's whole rating, in order: what the stats are keyed on, beside the nodes owned. */
export function ratingsOf(rec: ProgressRecord | null, rules: ProgressRules): number[] {
  return BUILT_CORE.map((s) => ratingOf(rec?.core?.[s] ?? 0, rules));
}

/** Whether a skill's rating has reached a mark (a milestone's 25, 50, 75 or 100). */
export function reached(rec: ProgressRecord | null, skill: CoreSkill, at: number, rules: ProgressRules): boolean {
  return ratingOf(rec?.core?.[skill] ?? 0, rules) >= at;
}

/** The milestones a skill passed going from one rating to another, lowest first. */
export function milestonesCrossed(skill: CoreSkill, from: number, to: number): Milestone[] {
  const def = coreDef(skill);
  if (!def || to <= from) return [];
  return def.milestones.filter((m) => m.at > from && m.at <= to);
}
