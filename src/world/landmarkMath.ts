// Big things seen far away (the horizon pass's wave 5b, DESIGN.md §1b, the render handoff's Part B step 1): the rules of the
// landmark index, pure, so the node test runs the arithmetic the game runs.
//
// The streamer files every placed object in a size tier and loads a region's tier while its box is within that tier's range
// (`placedTiers.ts`: 1.7 km for the biggest, times the Object reach), so a 200 m pylon and a 12 m shed vanish at the same
// distance. The landmark index keeps every big placed thing beside the tiers, at the client's lowest level of detail, out to
// how far its own size says it can be seen: `LANDMARK_K` times its half-span (the handoff's 690 is where a thing is still
// four pixels wide at 1440p with a 60-degree view; 400 is its own more careful start), never past the reach in force (the
// far ground's: the rings' reach, or the far tiles' 3.3 km). It is hidden wherever the streamer holds the same object
// finer, which is a lookup of the object's own tier, so nothing is ever drawn twice. A permanent row may carry two fields of
// its own (the world editor's Selected tab): `landmark`, which makes it one whatever its size, and `drawDistance`, metres,
// which wins over the size rule both ways (a small beacon kept far, a big wall let go early). Only the rows' fields work
// with the switch off: with it off and no row carrying either, nothing is collected, loaded or drawn.
//
// Every number here is ours.
import { PLACED_TIERS } from './placedTiers.ts';

/**
 * The least `minSize` means anything (the review round): the index asks the size rule only of a thing the streamer files in
 * its first size tier (a row by its box at its scale), so a least half-span under that tier's own would collect nothing
 * more and only make the editor's words promise a far copy nobody draws.
 */
export const LANDMARK_MIN_SIZE_FLOOR = PLACED_TIERS[0].minRadius;

export interface LandmarkTune {
  /** The size rule: every placed thing at least `minSize` is a landmark. Off, only a row's own fields make one. */
  on: boolean;
  /** How far a landmark is kept, in its half-spans (the handoff's 400; 690 is its four-pixel rule at 1440p). */
  k: number;
  /**
   * The least half-span, metres, of a landmark by size (the streamer's first tier, and never under it:
   * `LANDMARK_MIN_SIZE_FLOOR`). Moved, it is taken at the next collection made behind a screen or a curtain (an arrival, or
   * `__debug.landmarks({ apply: true })`), never by the frame, since a lower one brings in models no tier has drawn.
   */
  minSize: number;
  /** The share of the cut a landmark must pass back inside or beyond before it is shown or hidden again. */
  hysteresis: number;
  /** A sweep runs once the eye has moved this far, metres... */
  sweepMetres: number;
  /** ...or this long has gone by, seconds... */
  sweepSeconds: number;
  /** ...or the reach in force has moved by this share of itself. */
  reachStep: number;
  /** Rows taken up or put down are collected again at most this often, seconds (a burst of placements is one collection). */
  collectSeconds: number;
  /** Models loading at once while the index is built. */
  loads: number;
  /**
   * The most a loading screen waits for the landmarks' models to load and their programs to be built, milliseconds: a
   * technical bound, never a number of feel. What is still loading after it is shown once built through the queue.
   */
  waitMs: number;
  /** False hides every landmark copy without letting go of anything (the frame report's A/B, `perf({ ab: { key: 'landmarks' } })`). */
  drawn: boolean;
}

export const LANDMARK_DEFAULTS: Readonly<LandmarkTune> = Object.freeze({
  on: false,
  k: 400,
  minSize: 12,
  hysteresis: 0.05,
  sweepMetres: 8,
  sweepSeconds: 0.25,
  reachStep: 0.02,
  collectSeconds: 0.5,
  loads: 3,
  waitMs: 8000,
  drawn: true,
});

export const LANDMARK_TUNE: LandmarkTune = { ...LANDMARK_DEFAULTS };

/** What makes a placed thing a landmark: the size rule (with the switch on), its row's `landmark`, or its row's `drawDistance`. */
export function isLandmark(size: number, flagged: boolean, drawDistance: number, on: boolean, minSize: number): boolean {
  if (flagged || drawDistance > 0) return true;
  return on && size >= minSize;
}

/**
 * How far a landmark is kept, metres, before the reach in force caps it: its row's `drawDistance` where it has one (more
 * than nought), else `k` times its half-span.
 */
export function landmarkRange(size: number, drawDistance: number, k: number): number {
  if (drawDistance > 0) return drawDistance;
  const r = k * size;
  return r > 0 ? r : 0;
}

/**
 * Whether a landmark copy at distance `d` is drawn, given its cut (`landmarkRange` held under the reach in force), whether
 * it was drawn before, and the band `h`: drawn inside `cut × (1 − h)`, hidden past `cut × (1 + h)`, and kept as it was in
 * between, so one standing on the line never flickers. Never drawn while the streamer holds it finer (`held`).
 */
export function landmarkWants(d: number, cut: number, prev: boolean, h: number, held: boolean): boolean {
  if (held || !(cut > 0)) return false;
  const band = h > 0 ? h : 0;
  return prev ? d <= cut * (1 + band) : d <= cut * (1 - band);
}

/** The far tiles' reach, metres: `farRadius` tiles each way round the eye's own tile, measured to the middle of the last. */
export function farTilesReach(farRadius: number, tile: number): number {
  return (farRadius + 0.5) * tile;
}

/** Whether a sweep is due: never run, forced, the eye moved, the clock ran, or the reach moved by its share. */
export function landmarkSweepDue(age: number, moved: number, reach: number, lastReach: number, tune: LandmarkTune = LANDMARK_TUNE): boolean {
  if (age >= tune.sweepSeconds || moved >= tune.sweepMetres) return true;
  const dr = reach - lastReach;
  return (dr < 0 ? -dr : dr) > lastReach * tune.reachStep;
}

/**
 * How far a row's far copy is kept, in words, for the world editor's Selected tab: its own reach, its size's (by its own word
 * or by the size rule), or none and why. `size` is its half-span at its scale (NaN with no box).
 */
export function farCopyWords(row: { landmark?: true; drawDistance?: number; inside?: boolean }, size: number, tune: LandmarkTune = LANDMARK_TUNE): string {
  // A row in a building's rooms is drawn with those rooms alone (the index leaves every contained thing out), whatever it carries.
  if (row.inside === true) return "none: it stands in a building's rooms, which have no far copy (only what stands out in the open is a landmark)";
  const tail = " (never past the far ground's reach in force; within its own tier's range the streamer draws it as always)";
  if (row.drawDistance !== undefined && row.drawDistance > 0) return `kept to ${Math.round(row.drawDistance)} m, its own reach${tail}`;
  const s = Number.isFinite(size) && size > 0 ? size : 0;
  if (row.landmark) return `kept to ${Math.round(landmarkRange(s, 0, tune.k))} m by its size, by its own word${tail}`;
  if (!tune.on) return 'none: the size rule is off (__debug.landmarks({ on: true })), and its row carries neither field';
  if (s >= tune.minSize) return `kept to ${Math.round(landmarkRange(s, 0, tune.k))} m by its size${tail}`;
  return `none: its half-span ${s.toFixed(1)} m is under the size rule's ${tune.minSize} m`;
}

/**
 * Any `LANDMARK_TUNE` value set by name (a number held finite and never under its floor, a switch); answers what it would
 * not take. `on` is the console's own to move (`__debug.landmarks({ on })`, which builds the index behind a curtain).
 */
export function tuneLandmarks(o: Record<string, unknown>): string[] {
  const t = LANDMARK_TUNE as unknown as Record<string, unknown>;
  const said: string[] = [];
  for (const [key, v] of Object.entries(o)) {
    if (!(key in t) || key === 'on') {
      said.push(key === 'on' ? 'on is moved by __debug.landmarks({ on }), which builds the index behind a curtain' : `landmarks has no ${key}`);
      continue;
    }
    const was = t[key];
    if (typeof was === 'boolean') {
      if (v === 'on' || v === 'off') t[key] = v === 'on';
      else if (typeof v === 'boolean') t[key] = v;
      else said.push(`${key} takes true or false`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`${key} takes a number`);
      continue;
    }
    if (key === 'loads') t[key] = Math.max(1, Math.round(v));
    else if (key === 'minSize') t[key] = Math.max(LANDMARK_MIN_SIZE_FLOOR, v);
    else if (key === 'k') t[key] = Math.max(0.1, v);
    else t[key] = Math.max(0, v);
  }
  return said;
}
