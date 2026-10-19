// The NPC ship ladder's dials (src/ui/dials.ts): which tier's numbers each of tiers 6 to 10 is read at, as sliders in
// the debug menu when `npcShips` is picked. Each is set through `tuneTierLadder`, exactly as
// `__debug.npcShips({ ladder })` sets it, so the clamps and the words are the console's own, and the line the menu
// copies out is that helper's own argument (`npcShips({ ladder: { grade: { 8: 4 } } })`). Every number here is the
// owner's to move by hand once he has flown against a tier 10: tier 5's for all three until then, since tiers 6 to 10
// are SOE's families from publish 55 on and nothing in the archives says how they flew (`tierLadder.ts`).
//
// Pure: it imports the ladder and the dials' own types and nothing of the page, so a node test moves every dial
// through the real table.
import type { DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { TIER_LADDER_TUNE, tuneTierLadder } from './tierLadder.ts';

type Row = 'grade' | 'skill' | 'strength';

/** One tier's row of the ladder, set through `tuneTierLadder`: a tier from 1 to 5 whose numbers that tier is read at. */
function tierDial(row: Row, tier: number, note: string): NumberDial {
  return {
    kind: 'number',
    key: `ladder.${row}.${tier}`,
    label: `Tier ${tier}`,
    note,
    min: 1,
    max: 5,
    step: 1,
    unit: '',
    get: () => TIER_LADDER_TUNE[row][tier] ?? 5,
    set: (v) => {
      tuneTierLadder({ [row]: { [tier]: v } });
      const now = TIER_LADDER_TUNE[row][tier];
      return now === v ? [] : [`held at tier ${now}: a tier above 5 is read as a tier from 1 to 5`];
    },
  };
}

const tiers = [6, 7, 8, 9, 10];

const LADDER_GROUPS: DialGroup[] = [
  {
    title: 'Component grade',
    note: "The tier whose components each of tiers 6 to 10 is fitted with (TIER_GRADE): a ship's fit is made when it is stood, so a move reaches the next one stood.",
    dials: tiers.map((t) => tierDial('grade', t, `Which tier's component grade a tier ${t} ship is fitted with. Higher fits better guns, shields and engines.`)),
  },
  {
    title: 'Pilot skill',
    note: "The tier whose hand on the stick and aim each flies with (PILOT_SKILL): the brain reads it at every think, so a move reaches every ship already in the air.",
    dials: tiers.map((t) => tierDial('skill', t, `Which tier's pilot flies a tier ${t} ship: how fast it turns its stick, how well it aims and leads.`)),
  },
  {
    title: 'Strength',
    note: 'The tier the durability and damage formulas are read at: made when a ship is stood, so a move reaches the next one stood. Read at its own tier by formulas written for tiers 1 to 5, a tier 10 would be 2.6 times as hard to kill and hit 2.2 times as hard, where tier 5 is 1.6 and 1.45.',
    dials: tiers.map((t) => tierDial('strength', t, `Which tier's toughness and hitting power a tier ${t} ship has.`)),
  },
  {
    title: 'Ladder',
    dials: [
      {
        kind: 'number',
        key: 'ladder.top',
        label: 'Highest tier',
        note: 'The highest tier a type may carry; one above it is read as this one. 10 is where SOE\'s own families stop.',
        min: 6,
        max: 10,
        step: 1,
        unit: '',
        get: () => TIER_LADDER_TUNE.top,
        set: (v) => {
          tuneTierLadder({ top: v });
          return TIER_LADDER_TUNE.top === v ? [] : [`held at ${TIER_LADDER_TUNE.top}: the ladder runs from 6 to 10`];
        },
      },
    ],
  },
];

/** The ladder's dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const TIER_DIALS: DialSet = { helper: 'npcShips', groups: LADDER_GROUPS, shipped: readDials(LADDER_GROUPS) };

/** The dials a ship helper of `__debug` has, or null: what the debug menu asks as a helper is picked (the racing ones are `raceDials.ts`'s). */
export function shipDialsFor(helper: string): DialSet | null {
  return helper === 'npcShips' ? TIER_DIALS : null;
}
