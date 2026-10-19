// The people's program keys (the performance pass): the morph ladder every skinned primitive is padded to at load
// (the second wave), and in the fourth wave the normalisation of person and rack-weapon materials onto one set of
// shapes warmed once a session.
//
// A skinned primitive's morph count is in three's program key, and the converted packs carry counts from 0 to 33 (the
// heads 19 to 33, different by species and gender), so the motion blur's variants and the skinned depth programs were
// sets read off whatever the packs happened to hold, met for the first time in play and built there. Padded at load to
// the next rung of a ladder of ours (`morphLadder`, with zero targets that move no vertex at an influence of nought),
// the counts in the keys come to three, and every warm list built from them is closed and ours: nothing read off the
// packs is committed. A count past the top rung keeps its own.
//
// Both numbers are read once at load. The warm lists are built from the ladder at the first loading screen, and a
// ladder moved in a session would pad new geometry to rungs nobody warmed, so `__debug.skinnedLoad` prints them and
// refuses a change in words. Pure; node loads it.

/** Read once at load; see the file's head. [ours] */
export const PERSON_KEYS_TUNE: { readonly morphLadder: readonly number[]; readonly on: boolean } = Object.freeze({
  /**
   * Every skinned primitive's morph count is padded up to the next rung (wave 2); one past the top keeps its own. 7
   * takes the commonest counts (3 and 4 are about five in six of the morphed primitives converted) and 33 the highest
   * any converted primitive carries (the heads run 19 to 33); a rung between would warm programs few bodies use.
   */
  morphLadder: Object.freeze([0, 7, 33]),
  /** The fourth wave's maps superset and reflection at nought; `localStorage['swg.personKeys'] = '0'` skips it at load. */
  on: readHatch('swg.personKeys'),
});

/** A `localStorage` hatch read once: on unless it says '0'. Storage that throws (a private window) reads as on. */
export function readHatch(key: string): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

/**
 * Whether the ladder is in force this session, read once at load: `localStorage['swg.morphLadder'] = '0'` leaves every
 * skinned primitive its own count, and then every warm list made from the ladder is the first wave's instead (the
 * motion blur's fourteen variants read off the packs, no skinned depth combinations), so the hatch really is the old
 * way to compare against and not the ladder's lists warming counts nothing carries.
 */
export const MORPH_LADDER_ON: boolean = readHatch('swg.morphLadder');

/** The ladder the warm lists are made from this session: the ladder, or none with the hatch off. */
export function warmLadder(on: boolean = MORPH_LADDER_ON): readonly number[] | null {
  return on ? PERSON_KEYS_TUNE.morphLadder : null;
}

/** The rung a morph count is padded to: the first at or above it, or the count itself past the top. */
export function morphRung(count: number, ladder: readonly number[] = PERSON_KEYS_TUNE.morphLadder): number {
  for (let i = 0; i < ladder.length; i++) if (count <= ladder[i]) return ladder[i];
  return count;
}
