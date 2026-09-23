// How opaque the water's own surface is, seen from above, as the depth under each pixel.
//
// The owner's report: "I think we need to have depth be visible from the surface as a separate
// visual change because I can see as far as possible through the surface of the water." Asked
// whether the surface seen from above should hide what is below, they said yes.
//
// Until now a body's opacity was one number for the whole body — the converter's reading of the
// client's own water texture — and nothing about it varied with how deep the water was under the
// pixel, so a shelving bay and the trench beyond it were seen through exactly alike. This module is
// the rule that changes that, and nothing else: the converted opacity stands in the shallows and
// rises toward `most` over deep water, so where the bed is deep the surface is nearly a sheet and
// where it is a hand's breadth down the water is as clear as it ever was.
//
// Three things it deliberately is not.
//
// It is **not part of the effects chain**. This is the water's own material, so it holds with the
// Effects setting off exactly as with it on — which is the point, since the look under water is a
// pass and dies with the setting while the water seen from a beach must not.
//
// It is **one program**. The rule is a handful of lines inside the fragment injection every water
// material already shares, driven by two uniform objects shared by every body, and the numbers below
// reach the card by being written into those objects rather than by anything being compiled. A body
// whose own opacity is already above `most` keeps its own: the rule only ever raises.
//
// And it applies **only to an eye above the surface**. From below, looking up is the way out — the
// look pass's whole ceiling argument rests on it — so the rise is faded out over the last
// `eyeBand` metres as the camera comes down through the surface, and under water the surface is
// exactly the surface it always was.
//
// And it applies **only where the depth under the pixel is really known**. The depth the water
// programs read is a 2048 m window that slides with the player and fills a slice of its cells a
// frame, and it answers a flat 100 m wherever it cannot speak — outside the window, and in any cell
// the refresh has not reached yet. Taken as a number that is a trench; taken as what it is, it is a
// shrug. So the grid's own verdict comes in beside the depth and no verdict means no rule: the first
// seconds after a load, and every lake past about 900 m, are the water exactly as it was rather than
// a sheet.
//
// There was no such rule in the game (there was no going under, and the client's water pixel shader
// takes its alpha from the texture alone), so every number here is ours and every one is live.
//
// No imports: a plain node script (tools/swg/tests/waterSurface.test.ts) runs this directly and
// sweeps it, and reads `src/world/water.ts` as text to check the shader is these same lines.

export interface WaterSurfaceTune {
  /**
   * 0 to 1: how much of the rule is applied. **0 is the water exactly as it was** on every body and
   * at every depth, which is the switch, and 1 is the whole of it.
   */
  hide: number;
  /**
   * The opacity deep water reaches. Near-opaque rather than opaque on purpose: a sheet that let
   * nothing at all through would kill the shallow-to-deep gradient at the far end, where a hint of
   * what is below is most of what says the water is water.
   */
  most: number;
  /** Metres of water under a pixel at or below which the body keeps the converted shader's own opacity exactly. */
  shallow: number;
  /** Metres at which it has reached `most`; between the two it is GLSL's smoothstep. */
  deep: number;
  /**
   * Metres the camera must stand over the surface for the whole of the rule: from the surface line
   * up to this it fades in, so the picture does not step as a swimmer's head breaks the water, and
   * below the line there is no rise at all.
   */
  eyeBand: number;
}

/**
 * The tuning, live: `__debug.waterSurface({ most: 0.85 })` writes here and every water material
 * reads it from the next frame (the setter pushes it into the shared uniform objects; nothing is
 * compiled and nothing is read per frame). Every one of these is ours.
 */
export const WATER_SURFACE_TUNE: WaterSurfaceTune = {
  hide: 1,
  most: 0.96,
  shallow: 0.5,
  deep: 5,
  eyeBand: 0.5,
};

// --- helpers (no imports, so each is written out; both are GLSL's) ---

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function finite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

/** The deep edge, never at or below the shallow one however the two are typed. */
export function deepEdge(tune: WaterSurfaceTune): number {
  const shallow = Math.max(0, finite(tune.shallow, 0.5));
  return Math.max(shallow + 0.01, finite(tune.deep, 5));
}

/** Metres the camera must stand over a body's surface for the whole of the rule, as the card takes it. */
export function surfaceBandFor(tune: WaterSurfaceTune): number {
  return Math.max(0.001, finite(tune.eyeBand, 0.5));
}

/**
 * The four numbers the card is given, **in the order the fragment program reads them**: `.x` the
 * strength, `.y` the opacity deep water reaches, `.z` and `.w` the metres of depth the fade runs
 * between. `syncWaterSurface` in `water.ts` writes them straight into the shared `vec4` from this
 * array and does no arithmetic of its own, so the clamps below are the very ones `surfaceHideFor`
 * applies and a transposition is one thing to get wrong rather than two.
 *
 * Writes into `out` and returns it: called at load and when the console knob is turned, never on a
 * frame, but the caller holds one array all the same so nothing about it can allocate.
 */
export function surfaceHideUniform(tune: WaterSurfaceTune, out: number[]): number[] {
  out[0] = clamp01(finite(tune.hide, 1));
  out[1] = clamp01(finite(tune.most, 0.96));
  out[2] = Math.max(0, finite(tune.shallow, 0.5));
  out[3] = deepEdge(tune);
  return out;
}

/**
 * How much of the rule this pixel takes, 0 to 1: the depth under it between `shallow` and `deep`,
 * times the strength, times how far over the surface the eye stands, times whether the depth is a
 * measurement at all. Every argument that is not a number reads as the harmless answer.
 *
 * `eyeOver` is metres the camera stands above this body's own surface, negative under it.
 *
 * `known` is the depth grid's own verdict, 0 or 1, and it is not a nicety. The window is 2048 m
 * wide, slides in 128 m hops and fills a slice of its cells a frame, and the shader answers a flat
 * 100 m for every point it cannot speak for — a point outside the window, or a cell the refresh has
 * not reached. Read as a number that would be a trench, which is to say the whole rule: every water
 * pixel in the frame for the first seconds after a load, and all shallow water past about 900 m for
 * ever, drawn as a near-opaque sheet. So the verdict comes in beside the number and no verdict means
 * no rule — the water exactly as it was. (A body really deeper than 100 m answers 100 too, and is
 * known: it is deep, and it is meant to be a sheet.)
 */
export function surfaceHideFor(depth: number, eyeOver: number, tune: WaterSurfaceTune, known = 1): number {
  const k = clamp01(finite(tune.hide, 1));
  if (!(k > 0)) return 0;
  const verdict = clamp01(finite(known, 1));
  if (!(verdict > 0)) return 0;
  const shallow = Math.max(0, finite(tune.shallow, 0.5));
  const over = smoothstep(0, surfaceBandFor(tune), finite(eyeOver, 0));
  return smoothstep(shallow, deepEdge(tune), Math.max(0, finite(depth, 0))) * k * over * verdict;
}

/**
 * What the surface's alpha becomes: the body's own `base` in the shallows, rising toward `most` over
 * deep water. It only ever raises — a body the converter read as thicker than `most` keeps its own
 * number at every depth — and it never passes 1. `known` is `surfaceHideFor`'s: 0 hands the body its
 * own opacity back whatever the depth said.
 */
export function surfaceOpacityFor(base: number, depth: number, eyeOver: number, tune: WaterSurfaceTune, known = 1): number {
  const a = clamp01(finite(base, 0.75));
  const most = clamp01(finite(tune.most, 0.96));
  const top = a > most ? a : most;
  return a + (top - a) * surfaceHideFor(depth, eyeOver, tune, known);
}

/**
 * Write a few of the tuning numbers, ignoring anything that is not a key of its own kind: the one
 * place `__debug.waterSurface` is allowed to change. Returns the live object. It does **not** push
 * the numbers to the card — `setWaterSurface` in `water.ts` does that and is what the console calls,
 * so this stays free of anything a node script cannot run.
 */
export function tuneWaterSurface(patch: Partial<WaterSurfaceTune> | undefined): WaterSurfaceTune {
  if (!patch) return WATER_SURFACE_TUNE;
  const into = WATER_SURFACE_TUNE as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in WATER_SURFACE_TUNE)) continue;
    if (typeof value !== typeof into[key]) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    into[key] = value;
  }
  return WATER_SURFACE_TUNE;
}
