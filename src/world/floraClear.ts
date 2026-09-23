// How far a placed object keeps flora off the ground around it.
//
// This was the snapshot's own `radius` plus two metres for years, and that radius is not the
// object's size: it is the distance at which the streamer starts loading the thing. Measured over
// the converted packs, its median is 128 to 200 m, four objects on one world carry 40,130 m each,
// and the result is that **eight worlds had no procedural flora at all** -- 100% of Naboo and of
// Endor lay inside somebody's exclusion, and a third of Tatooine. The same file already records the
// same trap for collision (`COLLIDER_RADIUS_CAP`), where it was found first.
//
// So the reach is taken from the model's own bounds, which the manifest carries for every model in
// the pack and which needs no reconversion. Measured against the client's own rule (the templates'
// `clearFloraRadius`, which only 342 of 28,297 templates set at all), this lands within 2% of its
// plant counts on every ordinary world, and it puts about 14 million plants back across the
// eighteen packs without losing a single one anywhere: today's disc is wider than the model on
// every placement of every world.
//
// `FLORA_CLEAR.rule` is the way back: 'snapshot' is exactly what the game did before.

/** A model's own extent, as the manifest carries it. */
export interface FloraBounds {
  min: number[];
  max: number[];
}

export interface FloraClearTune {
  /** 'model' takes the reach from the model's own bounds; 'snapshot' is the old streaming radius. */
  rule: 'model' | 'snapshot';
  /** Metres of ground kept clear beyond the model itself. */
  pad: number;
  /** The most any one object may clear, whichever rule is in force: a guard, not a number to tune. */
  cap: number;
  /** Below this the object keeps no flora off at all, as the old rule had it. */
  least: number;
}

export const FLORA_CLEAR: FloraClearTune = { rule: 'model', pad: 2, cap: 64, least: 1 };

/**
 * The model's own reach from its centre, on the ground plane.
 *
 * The two corners are taken componentwise and never by which is called `min`: a mesh's BOX chunk
 * holds the larger corner first, and every pack converted before that was understood carries them
 * the other way round. The larger of the two horizontal half-extents is the reach, so a long thin
 * wall keeps flora off along its whole length rather than off a disc that fits inside it.
 */
export function modelReach(bounds: FloraBounds | null | undefined): number {
  const min = bounds?.min;
  const max = bounds?.max;
  if (!min || !max || min.length < 3 || max.length < 3) return Number.NaN;
  const dx = Math.abs(max[0] - min[0]);
  const dz = Math.abs(max[2] - min[2]);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return Number.NaN;
  return Math.max(dx, dz) / 2;
}

/**
 * How far this object keeps flora off, or 0 for none.
 *
 * `snapshotRadius` is the layout's own figure and is only used by the old rule and as the fallback
 * for a model the pack does not carry -- which is drawn as nothing, so its reach is capped like any
 * other rather than trusted.
 */
export function floraClearRadius(snapshotRadius: number, bounds: FloraBounds | null | undefined, tune: FloraClearTune = FLORA_CLEAR): number {
  const cap = Number.isFinite(tune.cap) && tune.cap > 0 ? tune.cap : Infinity;
  const pad = Number.isFinite(tune.pad) ? Math.max(0, tune.pad) : 0;
  const snapshot = Number.isFinite(snapshotRadius) ? snapshotRadius : 0;
  if (tune.rule === 'snapshot') return snapshot >= tune.least ? Math.min(snapshot + pad, cap) : 0;
  const reach = modelReach(bounds);
  // No model in the pack: nothing is drawn there, so it clears what the snapshot says but never
  // more than the cap, which is what keeps one 40 km figure from emptying a whole world.
  const r = Number.isFinite(reach) ? reach : snapshot;
  if (!(r >= tune.least)) return 0;
  return Math.min(r + pad, cap);
}
