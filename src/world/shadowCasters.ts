// Which placed things and which plants cast the sun's shadow (materials and ground pass, wave 8), as one rule every
// path that makes a caster reads, and reads again live when a switch moves. Pure: no three, so the node test runs
// the very rule the game runs (`shadowCasters.test.ts`).
//
// **Two lines, not one.** A placed building or prop casts when its model's radius is at least the Graphics page's
// "Smallest shadow caster" (`placedMinRadius`), which until this wave reached almost nothing: the streamer filed
// every copy at a fixed 1.2 m and the slider walked the scene once, when it moved, missing every tier that loaded
// after. Flora keeps a line of its own (`floraMinRadius`, the 1.2 m both flora paths always used, a console knob),
// and the page's two switches say which side of it casts: a tree (as big as the line or bigger) by "Trees cast
// shadows", anything smaller by "Small plants cast shadows" -- and a small plant, when it casts at all, only at its
// finest level (`plantsFinest`), since its lower levels are the far cards a shadow would be wasted on. A placed
// piece that is flora -- any piece of a model its pack files as flora, or a piece that is itself a leaf card --
// follows the flora's rule, so one slider never changes two things; the solid pieces of a rock or a village that
// wear a few cards stay on the slider (`LayoutStreamer.packFlora`). All ours: the client's own shadows were
// stencil volumes it decided for itself.

/** The casters' rule, live: the page writes `placedMinRadius`, `trees` and `plants`; the console the rest. */
export interface ShadowCasterTune {
  /** A placed building or prop casts at this model radius (metres) and over: the Graphics page's "Smallest shadow caster". */
  placedMinRadius: number;
  /** Where flora stops being a tree and starts being a small plant: a model's radius times its planting's scale, metres (ours, the 1.2 m both flora paths always used). */
  floraMinRadius: number;
  /** Trees and other flora at the line or over cast (the page's "Trees cast shadows"). */
  trees: boolean;
  /** Flora under the line casts (the page's "Small plants cast shadows"). */
  plants: boolean;
  /** A small plant casts at its finest level only, never its lower levels' far cards. */
  plantsFinest: boolean;
}

/** As shipped: what every path did before the wave, trees casting and nothing small. */
export const SHADOW_CASTER_DEFAULTS: Readonly<ShadowCasterTune> = Object.freeze({ placedMinRadius: 1.2, floraMinRadius: 1.2, trees: true, plants: false, plantsFinest: true });

export const SHADOW_CASTER_TUNE: ShadowCasterTune = { ...SHADOW_CASTER_DEFAULTS };

/** Whether a planting this size (its model's radius times its scale) is a tree by the flora's line. */
export function floraBig(size: number, t: ShadowCasterTune = SHADOW_CASTER_TUNE): boolean {
  return size >= t.floraMinRadius;
}

/**
 * Whether flora this size casts at level position `level` (0 the finest), before the detail levels' own cascade
 * rule (`levelCasts`) and the material's (`castsShadow`): a tree by `trees`, a small plant by `plants` and then
 * only at its finest when `plantsFinest`. Allocates nothing.
 */
export function floraCasts(size: number, level: number, t: ShadowCasterTune = SHADOW_CASTER_TUNE): boolean {
  return floraBig(size, t) ? t.trees : t.plants && (level === 0 || !t.plantsFinest);
}

/** Whether a placed copy's piece casts: a piece that is flora by the flora's rule, any other by its model's radius against the page's line. */
export function placedCasts(radius: number, flora: boolean, level: number, t: ShadowCasterTune = SHADOW_CASTER_TUNE): boolean {
  return flora ? floraCasts(radius, level, t) : radius >= t.placedMinRadius;
}

/** Move the rule: anything not a usable value is left as it was. Answers whether anything moved (the caller walks the casters). */
export function setShadowCasterTune(o: Partial<ShadowCasterTune>, t: ShadowCasterTune = SHADOW_CASTER_TUNE): boolean {
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  let moved = false;
  if (num(o.placedMinRadius) && o.placedMinRadius !== t.placedMinRadius) {
    t.placedMinRadius = o.placedMinRadius;
    moved = true;
  }
  if (num(o.floraMinRadius) && o.floraMinRadius !== t.floraMinRadius) {
    t.floraMinRadius = o.floraMinRadius;
    moved = true;
  }
  for (const k of ['trees', 'plants', 'plantsFinest'] as const) {
    const v = o[k];
    if (typeof v === 'boolean' && v !== t[k]) {
      t[k] = v;
      moved = true;
    }
  }
  return moved;
}
