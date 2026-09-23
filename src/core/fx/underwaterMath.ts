// What the water does to the picture when the camera is under it, as numbers. The pass
// (`underwater.ts`) is one full-screen draw built from exactly these constants and these formulas;
// this module has no imports at all, so a plain node script (tools/swg/tests/underwater.test.ts)
// runs it directly and pins the curve, the way out through the surface overhead and the shimmer.
// That test also reads the pass's own source and checks the shader text against what is here, so
// the two cannot drift apart quietly.
//
// There was no under water in the game at all: you could not go under, so there is nothing in the
// archives to be faithful to. Every number below is ours, chosen by eye, and every one of them is
// live through `__debug.underwater`.
//
// Units: metres, and light in the renderer's own linear terms (the scene target is linear and
// brighter than white; the tone curve comes later). Every function here is allocation-free: the
// caller owns every vector written into.

/** Linear-light RGB, written in place. */
export type Vec3 = [number, number, number];

export interface UnderwaterTune {
  /**
   * Metres: how far the water's *strongest* channel travels before it has lost 1 - 1/e of itself.
   * The other channels are shorter in proportion to the body's own colour, so the whole look reads
   * as "I can see about this far".
   */
  sight: number;
  /**
   * 0..1: how much the body's own colour drives the per-channel distances. 0 is a colourless murk
   * that eats every channel alike; 1 gives a channel that is absent from the water's colour almost
   * no reach at all, which is what makes red die first in blue water.
   */
  tint: number;
  /** The least a channel's distance may be, as a share of `sight`: without it a body with a zero channel would eat it in centimetres. */
  minLength: number;
  /**
   * 0..1: how much the body's *own* opacity, as the converter read it from the client's water
   * texture, moves that reach. 0 gives every body on every planet the same visibility; 1 lets a
   * silty pond eat the picture in a fraction of the distance open sea does.
   */
  bodyMurk: number;
  /** The opacity that counts as ordinary water, so a body at exactly this is seen exactly `sight` through. */
  bodyMurkRef: number;
  /** The radiance of the murk's brightest channel at the surface in full daylight, in scene units. */
  murkLight: number;
  /** The share of that the murk keeps at midnight, so a night dive is dark rather than black. */
  nightFloor: number;
  /** Metres: the depth over which the daylight reaching the murk falls away toward `deepFloor`. */
  lightDepth: number;
  /** The share of its surface brightness the murk keeps however deep the camera goes. */
  deepFloor: number;
  /** The most of the whole picture the depth veil may take, 0..1. `veilFor` never returns more than this, at any strength. */
  veilMax: number;
  /** Metres: the camera depth at which the veil has reached 1 - 1/e of `veilMax`. */
  veilDepth: number;
  /**
   * Metres: the camera depth over which the *whole* look comes in, from nothing at the surface line
   * to all of itself. See `easeIn` — this is the number that keeps the picture from changing in one
   * frame as the eye crosses the water.
   */
  surfaceEase: number;
  /** The murk stops at the water surface overhead rather than running to the far plane (see `waterPath`). */
  ceiling: boolean;
  /** How far the shimmer may move the picture, in uv across the screen's *width*, at shimmer strength 1 and right under the eye. */
  shimmerUv: number;
  /**
   * Noise cells across the screen's width. The finer of the two octaves is 2.3 times this, and the
   * field repeats every `SHIMMER_PERIOD` cells, so past `SHIMMER_PERIOD / 2.3` the finer octave
   * starts to tile across the view: keep this under about 13.
   */
  shimmerCells: number;
  /** Cells a second the noise drifts (the first octave travels `sqrt(1.25)` of this; see `shimmerPhase`). */
  shimmerRate: number;
  /** Metres of water in front of a pixel: full shimmer at or nearer than this ... */
  shimmerNear: number;
  /** ... and none at all past this, so a far wall does not swim. */
  shimmerFar: number;
  /** Metres: the camera depth over which the shimmer eases from all of itself toward `shimmerDeep`. */
  shimmerSurface: number;
  /** The share of the shimmer left far under the surface, where the ripples' own light no longer reaches. */
  shimmerDeep: number;
}

/**
 * The tuning, live: `__debug.underwater({ sight: 30 })` writes here and the pass reads it on the
 * next frame it draws. Every one of these is ours.
 */
export const UNDERWATER_TUNE: UnderwaterTune = {
  sight: 22,
  tint: 0.85,
  minLength: 0.08,
  bodyMurk: 0.6,
  bodyMurkRef: 0.75,
  murkLight: 0.35,
  nightFloor: 0.06,
  lightDepth: 12,
  deepFloor: 0.25,
  veilMax: 0.35,
  veilDepth: 9,
  surfaceEase: 0.6,
  ceiling: true,
  shimmerUv: 0.006,
  shimmerCells: 5.5,
  shimmerRate: 0.09,
  shimmerNear: 2,
  shimmerFar: 28,
  shimmerSurface: 10,
  shimmerDeep: 0.35,
};

/**
 * The neutral body: `waterLookFor`'s own default (#2e7fbb) in linear light, its own opacity, and a
 * depth to stand in with. The pass wears the depth on the one frame in a thousand that says the
 * camera is under water and hands over a depth that is not a number; the colour and the opacity are
 * the ones a record starts life with before any body has been asked about.
 */
export const UNDERWATER_FALLBACK: { readonly color: Readonly<Vec3>; readonly depth: number; readonly opacity: number } = {
  color: [0.0273, 0.2123, 0.4969],
  depth: 1.5,
  opacity: 0.75,
};

/**
 * The shimmer's noise repeats every this many cells in both axes, and its drift wraps at twice that.
 * Both are whole numbers and the second is twice the first **on purpose**: across one wrap the first
 * octave's sample point moves (2P, P) cells and the second's (-P, -2P), each a whole number of
 * periods, so the field after the wrap is the field before it to the last bit. Plain value noise has
 * no period at all, so a drift that simply reset its phase would snap the whole picture sideways
 * once every `SHIMMER_WRAP / shimmerRate` seconds. The pass writes `SHIMMER_PERIOD` straight into
 * its own GLSL from here, so the two cannot disagree.
 *
 * It is 32 rather than the 16 the wrap needs because the period is also how far the field may be
 * stretched before it tiles across the screen, and `shimmerCells` is a live knob: at 32 the finer
 * octave has room out to about 13 cells across the view.
 */
export const SHIMMER_PERIOD = 32;
export const SHIMMER_WRAP = SHIMMER_PERIOD * 2;

/** What one frame comes to: the five things the shader is given. */
export interface UnderwaterLook {
  /** Per channel, 1 / metres: how fast it is eaten. Already times the look's strength, the body's own murkiness and the surface ease. */
  extinction: Vec3;
  /** The colour a far pixel becomes, in scene units: lit, dimmed for the camera's depth and for the hour. */
  murk: Vec3;
  /** 0..1: how much of the whole picture, near pixels and the surface overhead included, is taken by the murk. */
  veil: number;
  /** How far the shimmer may move a pixel right under the eye, in uv; the distance fade is per pixel. */
  shimmer: number;
  /** 0..1: how much of the whole look this depth has brought in (`easeIn`), kept for the console only. */
  ease: number;
}

export function createUnderwaterLook(): UnderwaterLook {
  return { extinction: [0, 0, 0], murk: [0, 0, 0], veil: 0, shimmer: 0, ease: 0 };
}

// --- helpers (no imports, so each is written out) ---

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** GLSL's smoothstep. */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** A finite number, or `fallback`. */
function finite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

// --- the derivation ---

/**
 * How much of the whole look this camera depth has brought in: 0 at the surface line, all of it by
 * `surfaceEase` metres under.
 *
 * This is not a nicety. "Am I under water" is answered with a margin and 20 cm of hysteresis
 * (`waterLineMath.ts`), so for the whole band between the plain surface and up to half a metre
 * *above* it the answer is yes and the depth is exactly 0 — and at depth 0 the water is nothing:
 * every ray leaves through the surface at once, so without this the picture would split at the
 * horizon, everything below it taking the full murk and everything above it untouched, with the
 * camera still in the air. Easing the whole look in on the depth makes depth 0 a frame the pass
 * leaves bit-for-bit alone, which is the only honest answer while the eye is above the water.
 */
export function easeIn(cameraDepth: number, tune: UnderwaterTune): number {
  const over = Math.max(0.0001, finite(tune.surfaceEase, 0.6));
  return smoothstep(0, over, Math.max(0, finite(cameraDepth, 0)));
}

/**
 * How much faster this body eats the picture than ordinary water: its converted opacity against
 * `bodyMurkRef`, softened by `bodyMurk` and held inside sane bounds so no converted entry can
 * either blind the player or make the water disappear. This is the one per-body signal there is of
 * how thick the water is, so without it a silty pond and open sea are seen exactly as far through.
 */
export function murkinessFor(opacity: number, tune: UnderwaterTune): number {
  const ref = Math.max(0.05, finite(tune.bodyMurkRef, 0.75));
  const o = finite(opacity, ref);
  if (!(o > 0)) return 1;
  const k = clamp01(finite(tune.bodyMurk, 0.6));
  const raw = 1 + k * (o / ref - 1);
  return raw < 0.35 ? 0.35 : raw > 2.5 ? 2.5 : raw;
}

/**
 * How fast each channel is eaten, 1 / metres. The body's brightest channel travels `sight` metres;
 * a channel at a share s of it travels `sight x (1 - tint + tint x s)`, never less than
 * `sight x minLength`. `strength` is the menu's, applied here so that 0 leaves the picture exactly
 * as it was and 2 halves every distance.
 */
export function extinctionFor(color: Readonly<Vec3>, strength: number, tune: UnderwaterTune, out: Vec3): Vec3 {
  const k = Math.max(0, finite(strength, 1));
  const sight = Math.max(0.01, finite(tune.sight, 22));
  const tint = clamp01(finite(tune.tint, 0.85));
  const floor = clamp01(finite(tune.minLength, 0.08));
  const peak = Math.max(color[0], color[1], color[2], 1e-6);
  for (let i = 0; i < 3; i++) {
    const share = clamp01(Math.max(0, color[i]) / peak);
    const length = sight * Math.max(floor, 1 - tint + tint * share);
    out[i] = k / length;
  }
  return out;
}

/**
 * The colour a far pixel becomes: the body's own hue, at the brightness `murkLight` sets, dimmed as
 * the camera goes down (the light has that much more water to get through) and as the day goes
 * (`daylight` is the world's own 0 at night, 1 by day).
 */
export function murkFor(color: Readonly<Vec3>, cameraDepth: number, daylight: number, tune: UnderwaterTune, out: Vec3): Vec3 {
  const depth = Math.max(0, finite(cameraDepth, 0));
  const deepFloor = clamp01(finite(tune.deepFloor, 0.25));
  const lightDepth = Math.max(0.01, finite(tune.lightDepth, 12));
  const nightFloor = clamp01(finite(tune.nightFloor, 0.06));
  const down = deepFloor + (1 - deepFloor) * Math.exp(-depth / lightDepth);
  const day = nightFloor + (1 - nightFloor) * clamp01(finite(daylight, 1));
  const level = Math.max(0, finite(tune.murkLight, 0.35)) * down * day;
  const peak = Math.max(color[0], color[1], color[2], 1e-6);
  for (let i = 0; i < 3; i++) out[i] = (Math.max(0, color[i]) / peak) * level;
  return out;
}

/**
 * The flat tint over the whole picture, the sky through the surface included: nothing at the
 * surface, rising toward `veilMax` as the camera goes down. This is the term the pixel's own
 * distance cannot give, and it is what makes deep water read as deep rather than merely far.
 *
 * `veilMax` is a ceiling and not a scale: the strength brings the veil on sooner, never past what
 * the field says is its most, so the knob's top end cannot take the whole picture.
 */
export function veilFor(cameraDepth: number, strength: number, tune: UnderwaterTune): number {
  const depth = Math.max(0, finite(cameraDepth, 0));
  const veilDepth = Math.max(0.01, finite(tune.veilDepth, 9));
  const max = clamp01(finite(tune.veilMax, 0.35));
  const v = max * (1 - Math.exp(-depth / veilDepth)) * Math.max(0, finite(strength, 1));
  return v < 0 ? 0 : v > max ? max : v;
}

/**
 * How much water a pixel is seen through. Ordinarily that is simply how far away it is, but the
 * water stops at its own surface: looking up from two metres down, a ray leaves the water after
 * `cameraDepth / up` metres however far off what it lands on is. Without that, the sky and the
 * surface overhead — which write the far plane's depth, since water writes no depth at all — would
 * be painted solid murk and there would be no looking up.
 *
 * `rayUp` is the ray's component along world up, 0 level and 1 straight up. The divisor is held off
 * zero rather than the test being made at a threshold, so the answer moves smoothly through the
 * horizon instead of stepping at whatever angle the threshold happened to be.
 */
export function waterPath(distance: number, rayUp: number, cameraDepth: number, tune: UnderwaterTune): number {
  const d = Math.max(0, finite(distance, 0));
  if (!tune.ceiling) return d;
  const up = finite(rayUp, 0);
  if (!(up > 0)) return d;
  const exit = Math.max(0, finite(cameraDepth, 0)) / Math.max(up, 1e-4);
  return Math.min(d, exit);
}

/**
 * How far the shimmer may move a pixel, in uv: all of it near the eye, nothing past `shimmerFar`,
 * and less the deeper the camera is, since what makes the picture wobble is the light bending
 * through the ripples overhead.
 *
 * `path` is the water in front of the pixel (`waterPath`), not how far off the pixel is. That is
 * deliberate: the surface overhead and the sky through it carry the far plane's depth, and they are
 * the one thing whose ripples cause this, so faded on distance they would be the one place in the
 * picture that did not wobble.
 */
export function shimmerFor(path: number, cameraDepth: number, strength: number, tune: UnderwaterTune): number {
  const k = Math.max(0, finite(strength, 1));
  if (k <= 0) return 0;
  const near = Math.max(0, finite(tune.shimmerNear, 2));
  const far = Math.max(near + 0.01, finite(tune.shimmerFar, 28));
  const fade = 1 - smoothstep(near, far, Math.max(0, finite(path, 0)));
  const surface = Math.max(0.01, finite(tune.shimmerSurface, 10));
  const deep = clamp01(finite(tune.shimmerDeep, 0.35));
  const sank = 1 - Math.exp(-Math.max(0, finite(cameraDepth, 0)) / surface);
  return Math.max(0, finite(tune.shimmerUv, 0.006)) * k * fade * (1 + (deep - 1) * sank);
}

/**
 * Where the drift stands at this moment, wrapped at `SHIMMER_WRAP`. The wrap is done here, in double
 * precision, so the shader never carries a large and growing number into a hash that would lose its
 * nerve; it is seamless because the noise repeats every `SHIMMER_PERIOD` cells and each octave moves
 * a whole number of periods across one wrap.
 */
export function shimmerPhase(time: number, tune: UnderwaterTune): number {
  const t = finite(time, 0) * finite(tune.shimmerRate, 0.09);
  if (!Number.isFinite(t)) return 0;
  const w = ((t % SHIMMER_WRAP) + SHIMMER_WRAP) % SHIMMER_WRAP;
  return Number.isFinite(w) ? w : 0;
}

/**
 * The whole frame's numbers in one go: what `prepare` writes into the uniforms and what the node
 * test sweeps. `shimmer` here is the amplitude right under the eye; the shader applies the fade on
 * the water in front of each pixel, which is `shimmerFor` with the same arguments.
 */
export function deriveUnderwater(
  color: Readonly<Vec3>,
  opacity: number,
  cameraDepth: number,
  daylight: number,
  strength: number,
  shimmerStrength: number,
  tune: UnderwaterTune,
  out: UnderwaterLook,
): UnderwaterLook {
  // Nothing at the surface line, all of it a short way under: see `easeIn`.
  const ease = easeIn(cameraDepth, tune);
  const body = murkinessFor(opacity, tune);
  extinctionFor(color, Math.max(0, finite(strength, 1)) * body * ease, tune, out.extinction);
  murkFor(color, cameraDepth, daylight, tune, out.murk);
  out.veil = veilFor(cameraDepth, strength, tune) * ease;
  out.shimmer = shimmerFor(0, cameraDepth, shimmerStrength, tune) * ease;
  out.ease = ease;
  return out;
}

/**
 * What the look does to one linear pixel, line for line with the shader: the water between the eye
 * and the pixel eats it and puts its own colour in its place, and the veil takes a little of
 * whatever is left. An exponential, so the far end settles onto the murk exactly rather than
 * running past it and being clipped.
 */
export function applyUnderwaterPixel(color: Readonly<Vec3>, path: number, look: Readonly<UnderwaterLook>, out: Vec3): Vec3 {
  const d = Math.max(0, finite(path, 0));
  const veil = clamp01(look.veil);
  for (let i = 0; i < 3; i++) {
    const t = Math.exp(-look.extinction[i] * d);
    const lit = color[i] * t + look.murk[i] * (1 - t);
    out[i] = lit + (look.murk[i] - lit) * veil;
  }
  return out;
}

// --- the console knob ---

/**
 * Write a few of the tuning numbers, ignoring anything that is not a key of its own kind: the one
 * place `__debug.underwater` is allowed to change. Returns the live object.
 */
export function tuneUnderwater(patch: Partial<UnderwaterTune> | undefined): UnderwaterTune {
  if (!patch) return UNDERWATER_TUNE;
  const into = UNDERWATER_TUNE as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in UNDERWATER_TUNE)) continue;
    if (typeof value !== typeof into[key]) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    into[key] = value;
  }
  return UNDERWATER_TUNE;
}
