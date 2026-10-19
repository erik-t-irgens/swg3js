// The NPC ship ladder above tier 5.
//
// From publish 55 on SOE's own NPC ship families run to tier 10 where they had stopped at 5, and the ships command
// converts every one of them. Nothing in the archives says how a tier 6 to 10 ship flies, fits or fights: that was the
// server's, and every number of tiers 1 to 5 is ours already (`TIER_GRADE`, `PILOT_SKILL`, `tierDurability`,
// `tierDamage`). So a tier above 5 is read here as the tier whose numbers it takes: tier 5's for all three until the
// owner flies them and moves the dials (`__debug.npcShips({ ladder })`). Unladdered, a tier 10 ship would have taken
// 2.6 times the damage to kill and dealt 2.2 times as much as a tier 5, from formulas written for tiers 1 to 5.
//
// Tiers 1 to 5 read exactly what they always did: every reader here is the identity there (`tierLadder.test.ts` holds
// the readers to their versions at the pass's base). Pure, so node loads it.

/** How the tiers above 5 fly, fit and fight; every number is the owner's to move by hand. */
export const TIER_LADDER_TUNE = {
  /** The highest tier a type may carry [SOE: the families run to tier 10]; a tier above it reads as this one. */
  top: 10,
  /** The tier whose component grade each tier above 5 asks for (`TIER_GRADE`) [ours: tier 5's until he flies them]. */
  grade: { 6: 5, 7: 5, 8: 5, 9: 5, 10: 5 } as Record<number, number>,
  /** The tier whose pilot skill each flies with (`PILOT_SKILL`) [ours: tier 5's]. */
  skill: { 6: 5, 7: 5, 8: 5, 9: 5, 10: 5 } as Record<number, number>,
  /** The tier `tierDurability` and `tierDamage` are read at [ours: tier 5's, the strongest the formulas were written for]. */
  strength: { 6: 5, 7: 5, 8: 5, 9: 5, 10: 5 } as Record<number, number>,
};

/** The ladder's tiers, 6 to the top. */
const ABOVE = (): number[] => {
  const out: number[] = [];
  for (let t = 6; t <= TIER_LADDER_TUNE.top; t++) out.push(t);
  return out;
};

/** A tier above 5 as a whole tier of the ladder, clamped to `top`. */
function ladderTier(t: number): number {
  return Math.min(TIER_LADDER_TUNE.top, Math.max(6, Math.round(t)));
}

/**
 * The tier whose component grade tier `t` asks for: the old clamp (rounded, held to 1 to 5) wherever that answers
 * 5 or less, the ladder's row above.
 */
export function gradeTier(t: number): number {
  if (!(Math.round(t) > 5)) return Math.max(1, Math.min(5, Math.round(t)));
  return TIER_LADDER_TUNE.grade[ladderTier(t)] ?? 5;
}

/** The tier whose pilot skill tier `t` flies with, the same way. */
export function skillTier(t: number): number {
  if (!(Math.round(t) > 5)) return Math.min(5, Math.max(1, Math.round(t)));
  return TIER_LADDER_TUNE.skill[ladderTier(t)] ?? 5;
}

/**
 * The tier the durability and damage formulas are read at: `t` itself wherever it rounds to 5 or less (any number, as
 * they always took it), the ladder's row above.
 */
export function strengthTier(t: number): number {
  if (!(Math.round(t) > 5)) return t;
  return TIER_LADDER_TUNE.strength[ladderTier(t)] ?? 5;
}

/**
 * Move the ladder live: `top` (6 to 10) and any of `grade`, `skill`, `strength` as `{ <tier>: <tier 1 to 5> }`.
 * Unknown names, tiers outside 6 to 10 and values that are not a tier from 1 to 5 are ignored, so a typo never grows a
 * number nothing reads. Answers the table.
 */
export function tuneTierLadder(patch: Partial<{ top: number; grade: Record<number, number>; skill: Record<number, number>; strength: Record<number, number> }>): typeof TIER_LADDER_TUNE {
  if (typeof patch.top === 'number' && Number.isFinite(patch.top)) TIER_LADDER_TUNE.top = Math.max(6, Math.min(10, Math.round(patch.top)));
  for (const key of ['grade', 'skill', 'strength'] as const) {
    const rows = patch[key];
    if (!rows || typeof rows !== 'object') continue;
    for (const [tier, value] of Object.entries(rows)) {
      const t = Number(tier);
      if (!Number.isInteger(t) || t < 6 || t > 10) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      TIER_LADDER_TUNE[key][t] = Math.max(1, Math.min(5, Math.round(value)));
    }
  }
  return TIER_LADDER_TUNE;
}

/** The ladder in one line a console prints. */
export function ladderLine(): string {
  const row = (key: 'grade' | 'skill' | 'strength') => ABOVE().map((t) => `${t}:${TIER_LADDER_TUNE[key][t] ?? 5}`).join(' ');
  return `tiers 6 to ${TIER_LADDER_TUNE.top} read as: grade ${row('grade')}; skill ${row('skill')}; strength ${row('strength')}`;
}
