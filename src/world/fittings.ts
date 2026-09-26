// The fittings: what the server stood on a world's buildings that travel has no use for.
//
// An elevator panel beside a lift's doorway, the bank terminal outside a bank, the cloning and
// insurance terminals in a cloning facility, the sign hanging over a cantina's door, a guild hall's
// ballot box. None of it is in a world snapshot, because all of it was the server's, which is why
// the rooms it belongs in have looked bare. The converter reads the same `childObjects` blocks the
// travel things come out of and keeps everything travel does not, so the two can never stand two
// things in one place; `tools/swg/fittings.mjs` says what was measured.
//
// There is nothing to press here and nothing to decide: a fitting is a model at a place, and a
// world with no `fittings.json` simply has none, which is how the game was before this existed.
//
// Pure: no three, no fetch, no DOM. Rule for this file (node runs it with type stripping for the
// tests): relative imports only as `import type`, no enum, no namespace, no constructor parameter
// properties.

import { childInWorld } from './travelTerminal.ts';

/** The pack this file reads. */
export const FITTINGS_PACK_VERSION = 1;

/** One fitting, as a world's pack carries it. */
export interface FittingRow {
  /** The model in this world's own pack that draws it. The converter writes no row without one. */
  model: string;
  /** The template it came from, kept so a fitting can be traced back to the data that placed it. */
  template?: string;
  building: string;
  /** The room it stands in, or 0 for out in the open. */
  cell: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Where the building it belongs to stands, in the snapshot's own frame. */
  bx: number;
  by: number;
  bz: number;
  byaw: number;
}

/** One of them in the world's own frame. */
export interface Fitting {
  model: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  cell: number;
  building: string;
}

/**
 * The fittings of a world, every one of them in the world's own frame.
 *
 * The frame is `childInWorld`'s, which is the travel terminals' own arithmetic and the one place
 * that knows how an indoor child gets from its building's frame into the world's. Getting it wrong
 * is not a small error: an indoor thing left in the building's frame stands a few metres from the
 * world's origin, which is kilometres from wherever the player is.
 */
export function fittingsOf(rows: readonly FittingRow[], centre: { x: number; z: number }): Fitting[] {
  const out: Fitting[] = [];
  for (const r of rows) {
    if (!r.model) continue;
    const p = childInWorld(r, centre);
    out.push({ model: r.model, building: r.building, x: p.x, y: p.y, z: p.z, yaw: p.yaw, cell: p.cell });
  }
  return out;
}

/**
 * What a world's fittings come to, by model: what `__debug.fittings()` reports.
 *
 * The busiest converted world has a couple of hundred of them over two dozen models, which is why
 * the game stands the lot on arrival rather than streaming them by distance: two dozen models is
 * two dozen loads, and every one after that is an instance of something already in the pack.
 */
export function fittingTally(things: readonly Fitting[]): { models: number; indoors: number; byModel: Record<string, number> } {
  const byModel: Record<string, number> = {};
  let indoors = 0;
  for (const f of things) {
    byModel[f.model] = (byModel[f.model] ?? 0) + 1;
    if (f.cell > 0) indoors++;
  }
  return { models: Object.keys(byModel).length, indoors, byModel };
}
