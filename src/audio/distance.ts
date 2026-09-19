/**
 * How loud a sound is at a distance, how far it carries, and what happens when it is heard from
 * another room. Pure arithmetic with no Web Audio in it, so a node test can sweep it.
 *
 * The game's own sound templates give exactly one distance: `full`, the radius within which the
 * sound plays at its full volume. What happens past that was in the client's audio library and is
 * not in the archives, so every number below is INVENTED. They are kept together here, and
 * `__debug.audio({ distance: { ... } })` moves them live.
 */

export interface DistanceTune {
  /** INVENTED: a sound is silent past `full` times this (inverse distance until then). */
  audible: number;
  /** INVENTED: the last share of the audible radius is a smooth fade to nothing. */
  fadeShare: number;
  /** INVENTED: a non-positional emitter's radius is floored here (the table's values run down to 0.1 m). */
  flatMin: number;
  /** INVENTED: a non-positional emitter fades to nothing at its radius times this. */
  flatReach: number;
  /** INVENTED: every radius is multiplied by this, for tuning a space zone's much larger scale. */
  zone: number;
  /** INVENTED: a voice heard from another room loses this much gain on top of the low-pass. */
  muffleGain: number;
  /** INVENTED: the low-pass a voice heard from another room goes through, in hertz. */
  muffleHz: number;
  /** INVENTED: seconds a voice takes to move between dry and muffled, so nothing clicks on a doorway. */
  muffleEase: number;
}

export const DISTANCE_TUNE: DistanceTune = {
  audible: 10,
  fadeShare: 0.2,
  flatMin: 2,
  flatReach: 4,
  zone: 1,
  muffleGain: 0.5,
  muffleHz: 1200,
  muffleEase: 0.15,
};

/** The template's full-volume radius with the zone scale applied, never zero. */
export function fullRadius(full: number, tune: DistanceTune = DISTANCE_TUNE): number {
  return Math.max(0.01, full) * Math.max(0.01, tune.zone);
}

/** Past this the sound is not heard at all: what the emitter grid tests against. */
export function audibleRadius(full: number, tune: DistanceTune = DISTANCE_TUNE): number {
  return fullRadius(full, tune) * tune.audible;
}

/** 1 within `full`, then inverse distance, faded to nothing over the last share of the radius. */
export function gainAt(distance: number, full: number, tune: DistanceTune = DISTANCE_TUNE): number {
  const f = fullRadius(full, tune);
  const far = f * tune.audible;
  const d = Math.max(0, distance);
  if (d >= far) return 0;
  const g = d <= f ? 1 : f / d;
  const from = far * (1 - Math.max(0, Math.min(1, tune.fadeShare)));
  if (d <= from || far <= from) return g;
  const t = (far - d) / (far - from);
  return g * t * t * (3 - 2 * t);
}

/** A non-positional emitter (the cantina and crowd beds) is heard within this. */
export function flatRadius(full: number, tune: DistanceTune = DISTANCE_TUNE): number {
  return Math.max(full, tune.flatMin) * Math.max(0.01, tune.zone) * tune.flatReach;
}

/** Full within its own radius (floored), then a smooth fall to nothing at `flatReach` times it. */
export function flatGainAt(distance: number, full: number, tune: DistanceTune = DISTANCE_TUNE): number {
  const f = Math.max(full, tune.flatMin) * Math.max(0.01, tune.zone);
  const far = f * tune.flatReach;
  const d = Math.max(0, distance);
  if (d <= f) return 1;
  if (d >= far) return 0;
  const t = (far - d) / (far - f);
  return t * t * (3 - 2 * t);
}

/** Where a voice is: -1 as the building means the open world, and the cell only matters inside one. */
export interface SoundSpace {
  building: number;
  cell: number;
}

export const OUTSIDE: SoundSpace = { building: -1, cell: -1 };

/**
 * How much of a voice goes through the muffled path: 1 when the listener and the source are not in
 * the same building (either way round), 0 when they share one or are both outside. Whether the
 * client muffled at all is unknown; this is ours, and one call decides it for every voice.
 */
export function muffleShare(listener: SoundSpace, source: SoundSpace): number {
  return listener.building === source.building ? 0 : 1;
}
