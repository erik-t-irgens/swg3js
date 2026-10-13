// The client's own highlight, as arithmetic with no imports at all: what a surface's specular colour, its
// mask and its power come to under one light, a mirror of every line `specular.ts` injects into three's
// lighting. A plain node script (tools/swg/tests/specMath.test.ts) runs this file directly, and
// `__debug.specSelfTest()` draws a lit sphere with the injected program and compares its pixels with
// `clientSpecular` here, so the shader and this file can never quietly part.
//
// **What the client drew** (its own pixel programs and each shader's MATL, read by material format 6):
//
//   - the highlight is the specular colour times the mask times (N.H) to the power p, with no Fresnel term
//     and no N.L factor at all -- a highlight can sit on a face turned a little from the light, as it did;
//   - on the "fake anisotropic" programs (hair, fur, most of the two-tone cloth) the client bends N.H into a
//     band instead: one less the distance of 1.25 N.H from one, to the power of 0.15 p, less 0.15, never
//     below nought, and that band is multiplied by N.L. It peaks at N.H 0.8, a ring 37 degrees off the
//     mirror direction, at 0.85 of the colour, which is why hair shone in a broad soft band and not a dot.
//
// **Its scale against ours.** The client added its highlight to a diffuse term whose white surface facing
// the light is the light's colour. Three's white surface facing a light is the light's colour over pi, so
// the client's term is divided by pi here: relative to a white surface facing the light, the peak is the
// specular colour times the mask, which is exactly what it was in the client.
//
// **Ours, not the client's:** the cap (the client clamped every pixel to white, which an HDR frame does not,
// so without one a glass shader's colour of 10 blooms into a blob), the gain (1 is the client's strength),
// the gate (nought, the client's: no N.L test; it is there in case a highlight shows on a face turned right
// away from the sun), the film (how much of three's own GGX a wet or snowed surface keeps, since the rain's
// glint and the snow's matt both ride on roughness) and the switch back to three's GGX altogether.
//
// Nothing here allocates: the one answer that is a colour is written into the caller's own array.

/** A plain three-number vector, so a node script needs no three. */
export type Vec3 = [number, number, number];

/** The client's band: N.H is scaled by this before it is measured from one, which puts the peak at 1 / 1.25 = 0.8. */
export const BAND_TIGHTEN = 1.25;
/** The client's band: the share of the power its curve is raised to, and what is taken off the top of it. */
export const BAND_POWER = 0.15;
/** Where the band peaks, in N.H. */
export const BAND_PEAK_NH = 1 / BAND_TIGHTEN;

/** How a highlight is drawn, as the injected program's per-material uniform reads it. */
export const SPEC_MODE_CODE = { none: 0, phong: 1, aniso: 2 } as const;
export type SpecMode = keyof typeof SPEC_MODE_CODE;

/** The knobs, live through `__debug.spec`. `gain` 1 and `gate` 0 are the client's; `cap`, `film` and `use` are ours. */
export interface SpecTune {
  /** `'client'`: the client's own term; `'three'`: three's GGX, as every surface drew before. A uniform: switching compiles nothing. */
  use: 'client' | 'three';
  /** Times the client's term. 1 is the client's strength. */
  gain: number;
  /** The term never passes a white surface facing that light times this. Ours, standing in for the client's clamp to white. */
  cap: number;
  /** How much of a wet or snowed surface's highlight is three's GGX (the rain's glint, the snow's matt), times the weather's own amount. Ours. */
  film: number;
  /** 0 the client's (no N.L test); 1 draws no highlight on a face turned away from the light. Ours. */
  gate: number;
}

export const SPEC_TUNE: SpecTune = { use: 'client', gain: 1, cap: 1, film: 1, gate: 0 };

/** The floor every base is held to before it is raised to a power, so nothing is ever `pow` of nought or less. */
const FLOOR = 1e-6;

/** What a converted material says of its highlight (`userData.swgSpec`), made safe for a uniform: a mode, an RGB colour and a power. */
export interface SpecValues {
  mode: number;
  color: Vec3;
  power: number;
}

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * The uniform values for one material, out of whatever its `extras.swgSpec` holds. A mode it does not know,
 * a colour that is not three numbers or a power that is not a number reads as no highlight rather than as
 * whatever a NaN would draw (a NaN pixel is a screen-sized black box once the bloom has spread it).
 */
export function specValues(spec: unknown, out: SpecValues = { mode: 0, color: [0, 0, 0], power: 0 }): SpecValues {
  const s = (spec ?? {}) as { mode?: unknown; color?: unknown; power?: unknown };
  // The table's own names and nothing it inherits: `in` would take 'constructor' or '__proto__' for a mode and
  // hand the uniform a function, which uploads as NaN.
  const mode = typeof s.mode === 'string' && Object.hasOwn(SPEC_MODE_CODE, s.mode) ? SPEC_MODE_CODE[s.mode as SpecMode] : 0;
  const c = Array.isArray(s.color) ? s.color : [];
  out.mode = mode;
  out.color[0] = Math.max(0, finite(c[0], 0));
  out.color[1] = Math.max(0, finite(c[1], 0));
  out.color[2] = Math.max(0, finite(c[2], 0));
  out.power = Math.max(0, finite(s.power, 0));
  if (c.length < 3 || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || !Number.isFinite(c[2])) out.mode = 0;
  return out;
}

/** The client's plain highlight's shape: (N.H) to the power, N.H held to [0, 1] as its own `saturate` holds it. */
export function blinnShape(nh: number, power: number): number {
  const h = Math.min(1, Math.max(0, nh));
  return Math.pow(Math.max(h, FLOOR), Math.max(0, power));
}

/** The client's band of N.H, before its N.L: peaks at N.H 0.8 at 0.85, never below nought. */
export function bandShape(nh: number, power: number): number {
  const h = Math.min(1, Math.max(0, nh));
  const b = Math.max(1 - Math.abs(1 - BAND_TIGHTEN * h), FLOOR);
  return Math.max(Math.pow(b, Math.max(0, power) * BAND_POWER) - BAND_POWER, 0);
}

/** The shape for a mode code: the band times N.L on aniso, the plain power otherwise (nought for none is the caller's). */
export function specShape(mode: number, nh: number, nl: number, power: number): number {
  if (mode > 1.5) return bandShape(nh, power) * Math.min(1, Math.max(0, nl));
  return blinnShape(nh, power);
}

/**
 * The client's direct highlight from one light, in three's units, written into `out`: the light's colour
 * times the specular colour times the mask times the shape, over pi, times the gain and the gate, never past
 * the light's colour over pi times the cap. `light` is the light's colour as three hands it to the program;
 * `n`, `l` and `v` are unit vectors (the shading normal, toward the light, toward the eye). Every line is the
 * shader's (`swgClientSpecular`), floors included.
 */
export function clientSpecular(out: Vec3, light: Vec3, color: Vec3, mask: number, mode: number, power: number, n: Vec3, l: Vec3, v: Vec3, tune: SpecTune = SPEC_TUNE): Vec3 {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  if (mode < 0.5) return out;
  const hx = l[0] + v[0];
  const hy = l[1] + v[1];
  const hz = l[2] + v[2];
  const len = Math.sqrt(hx * hx + hy * hy + hz * hz);
  if (!(len >= FLOOR)) return out;
  const nl = n[0] * l[0] + n[1] * l[1] + n[2] * l[2];
  const nh = (n[0] * hx + n[1] * hy + n[2] * hz) / len;
  const shape = specShape(mode, nh, nl, power);
  const gateShare = Math.min(1, Math.max(0, tune.gate));
  const gate = 1 + ((nl >= 1e-4 ? 1 : 0) - 1) * gateShare;
  const k = (mask * shape * gate * Math.max(tune.gain, 0)) / Math.PI;
  const cap = Math.max(tune.cap, 0) / Math.PI;
  for (let i = 0; i < 3; i++) out[i] = Math.min(light[i] * color[i] * k, light[i] * cap);
  return out;
}

/**
 * The weather's amount the film is taken by, as `main()` reads it under `SWG_WET` (`specular.ts`'s
 * `SPEC_MAIN`): the largest of how wet the surface is, how much puddle stands on it and how much snow lies on
 * it. Snow is in it for the rain's reason: the wet look makes settled snow matte through roughness alone
 * (0.85), which the client's term never reads, so a snowed roof drawn with that term kept a highlight brighter
 * than the snow beside it. Under the film it is three's GGX at the snow's roughness, as it was before.
 */
export function weatherShare(wet: number, puddle: number, snow: number): number {
  return Math.max(wet, puddle, snow);
}

/**
 * How much of a surface's direct highlight is three's GGX rather than the client's term: all of it with
 * `use: 'three'`, and otherwise the weather's own amount (`weatherShare`) times `film`, so rain keeps the
 * glint it rides on roughness, snow stays matte, and a dry surface draws the client's highlight alone.
 */
export function filmShare(wet: number, tune: SpecTune = SPEC_TUNE): number {
  if (tune.use === 'three') return 1;
  return Math.min(1, Math.max(0, wet * tune.film));
}

/** The highlight at its peak, relative to a white surface facing the same light: the colour's channel times the mask, as the client drew it, until the cap. */
export function relativePeak(color: number, mask: number, mode: number, power: number, tune: SpecTune = SPEC_TUNE): number {
  if (mode < 0.5) return 0;
  const peak = mode > 1.5 ? bandShape(BAND_PEAK_NH, power) : blinnShape(1, power);
  return Math.min(color * mask * peak * Math.max(tune.gain, 0), Math.max(tune.cap, 0));
}

/**
 * The half-angle, in degrees, at which the plain highlight has fallen to half its peak, found by bisection on
 * the shape itself rather than by the closed form, so the test measures what is drawn. About 15 degrees at the
 * median power of 20, against the 0.8 to 3.6 degrees three's GGX drew at the same shaders' roughness.
 */
export function halfWidthDeg(power: number): number {
  let lo = 0;
  let hi = Math.PI / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (blinnShape(Math.cos(mid), power) > 0.5) lo = mid;
    else hi = mid;
  }
  return (((lo + hi) / 2) * 180) / Math.PI;
}
