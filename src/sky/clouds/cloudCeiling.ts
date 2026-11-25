// The low deck's fair-weather top, for the ships' ceiling (the GPU port's pass 3, wave 2, maker B; `src/vehicles/shipCeiling.ts`).
// Pure: the stack he edits in, a height out, so the ceiling follows his heights.
//
// The low deck is the stack's lowest layer that is on (his "Low deck" in every world's start, or whatever he has put lowest).
// Its fair-weather top is its base plus its thickness times the column of the tallest of its types present at weather level 0
// (`levelMixInto`'s rule, the one the march's bands read): a deck of fair cumulus with storm towers that grow only in storms
// tops out at the cumulus's 1.5 km, not the towers' ten.
import { levelMixInto, type CloudLayer } from './cloudLayers.ts';

const mix = new Float64Array(3);

/** The low deck's fair-weather top over the world's ground (metres), or NaN where no layer is on. */
export function fairDeckTopOf(layers: readonly CloudLayer[]): number {
  let low: CloudLayer | null = null;
  for (const l of layers) if (l.on && (low === null || l.base < low.base)) low = l;
  if (low === null) return Number.NaN;
  levelMixInto(low, 0, mix, 0);
  return low.base + low.thickness * mix[2];
}
