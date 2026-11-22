// Which quality tier the settings hold (the GPU port's pass 2, wave 3): the stars a tier draws (`nightTune.ts`'s counts) follow
// the Graphics page's quality slider. `qualityTiers.ts`'s `tierOf` answers it by building each tier's values as a record, so
// the night sky asks this instead, which walks the same table (`TIER_TABLE`, `TIER_KEYS`) and the same rule (the render scale
// held to the screen's own, numbers alike to a millionth) and builds nothing; the node test holds it to `tierOf` over every
// tier and a custom set.
//
// Pure: no three, no DOM.
import type { Settings } from '../../core/settings.ts';
import { TIER_KEYS, TIER_NAMES, TIER_TABLE, screenScale } from '../../ui/qualityTiers.ts';

/** The tier the settings hold on this screen (`TIER_NAMES`' index, 0 Low to 3 Ultra), or −1 where they are none of them. */
export function tierIndexOf(s: Pick<Settings, (typeof TIER_KEYS)[number]>, dpr: number = screenScale()): number {
  const table = TIER_TABLE as unknown as Record<string, readonly (number | boolean | null)[]>;
  const read = s as unknown as Record<string, unknown>;
  for (let t = 0; t < TIER_NAMES.length; t++) {
    let all = true;
    for (let k = 0; k < TIER_KEYS.length && all; k++) {
      const key = TIER_KEYS[k];
      let want = table[key][t];
      if (want === null) continue;
      if (key === 'renderScale') want = Math.min(want as number, dpr > 0 ? dpr : 1);
      const have = read[key];
      if (typeof want === 'number' && typeof have === 'number') all = Math.abs(have - want) < 1e-6;
      else all = have === want;
    }
    if (all) return t;
  }
  return -1;
}
