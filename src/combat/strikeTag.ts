// What struck, held for the length of one blow. A blow on a body is one call -- `damage(amount, from, push,
// source)` -- and that contract says who struck but never with what, and a dozen files in four folders make it.
// The player's progress pays the skill a blow used (a gun Marksmanship, a grenade Demolitions, a blade Melee),
// so each of the player's own strikes says what it is here, makes its call, and puts back what was there in a
// `finally`, exactly as the blow's direction is held for the length of a call (`App.hurtSource`). Whatever
// listens to the blow -- the world's hit watch -- reads it inside that call and nowhere else.
//
// Nothing here allocates: one kept record, written and put back. Every site is synchronous, so a blow can
// never be read with another's kind, and a blow nobody tagged reads as null, which pays nothing.

import type { Hittable, Living } from './kit.ts';

/** What a blow of the player's used: a gun's shot, a launcher's rocket, a grenade or a charge, a blade, a turned bolt, the Force. */
export type StrikeKind = 'gun' | 'launcher' | 'demolitions' | 'melee' | 'deflect' | 'force';

/** The kind of the blow being dealt just now, or null when nobody said. */
export const STRIKE: { kind: StrikeKind | null } = { kind: null };

/**
 * One blow dealt as a kind: the kind held for the call and put back after it, whatever the call does. For a
 * single blow; a loop of them (a held flame's cone) holds the kind round the whole loop instead. A kind of null
 * is a blow nobody's progress pays for (a bolt the player did not fire), held as null for its length.
 */
export function strikeAs(kind: StrikeKind | null, t: Hittable, amount: number, from?: Parameters<Hittable['damage']>[1], push?: number, source?: Living | null): void {
  const was = STRIKE.kind;
  STRIKE.kind = kind;
  try {
    t.damage(amount, from, push, source);
  } finally {
    STRIKE.kind = was;
  }
}
