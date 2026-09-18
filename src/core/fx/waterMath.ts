// The water reflections' own arithmetic that needs no renderer, so the node tests can check it.

/** What the reflections pass knows about a frame it did not draw. */
export interface WaterReflectionsState {
  /** Whether its setting (or a console override) asks for it now (`PostFX.passWanted`). */
  wantedNow: boolean;
  /** Whether it was asked for when the last frame began (`WaterBodies.wanted`). */
  wanted: boolean;
  /** The camera sat within the swell's reach of the surface when the frame began. */
  underwater: boolean;
  /** Water was in the frustum and not hidden behind terrain or buildings. */
  inView: boolean;
  /** The lit water left its environment term out for the pass to add. */
  active: boolean;
}

/**
 * Why the reflections did not draw last frame, as `__debug.postfx()` lists it: null only while
 * the setting or a console override has it off, which the chain says in its own words ("its
 * setting is off", "forced off"); every other frame it sat out has its reason.
 */
export function waterReflectionsWhy(s: WaterReflectionsState): string | null {
  if (!s.wantedNow) return null;
  // Wanted now but not when the frame began: no frame has begun since the planet loaded, or the
  // setting or an override turned it on after the frame's decision was taken.
  if (!s.wanted) return 'not asked for when the last frame began';
  if (s.underwater) return 'camera under water';
  if (!s.inView) return 'no water in view';
  if (!s.active) return 'not wanted when the frame began';
  // Decided on, but the chain never reached it (no frame drawn since, or it stopped before it).
  return 'wanted, but the chain did not draw it last frame';
}
