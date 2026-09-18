// The colour grade's arithmetic, with no imports at all: what a planet's hand-set mood and the
// light of the moment come to as seven numbers, the guards that stop the grade crushing shadows or
// clipping highlights, and a mirror of every line of the shader. A plain node script
// (tools/swg/tests/grade.test.ts) runs this file directly, and `__debug.gradeSelfTest()` draws the
// shader over known colours and compares it with `applyGradePixel` here, so the two can never
// quietly drift apart.
//
// Nothing here allocates: every working colour is a module scratch vector, so a frame's derivation
// costs no garbage.

/** Linear-light RGB, written in place. */
export type Vec3 = [number, number, number];

/** The light that lights the scene at this moment. */
export interface GradeSource {
  /** The key light, linear: SkyLighting.main x mainScale. */
  key: Vec3;
  /** What lights the shadows, linear: SkyLighting.ambient x ambientScale. */
  fill: Vec3;
  /** The air, linear: the scene fog colour, or SkyLighting.clear when the fog is black. */
  air: Vec3;
  /** 0 by day, 1 by night: 1 - daylight; 0 in space. */
  night: number;
  space: boolean;
}

/**
 * A planet's mood and hand-set push, keyed by the planet's id (a space zone by its own id). Every
 * field is taste, chosen by eye, not a number read out of the game's data.
 */
export interface GradeLook {
  /** 0..1, bleak: less saturation, cooler shadows and balance, highlights toward white, softer contrast, a stronger split. Fades at night. Ignored in space. */
  gloom?: number;
  /** 0..1, hot: the balance follows the key light's hue much further, more saturation, a stronger split. Holds at night, and cancels gloom and the night's cool. Ignored in space. */
  heat?: number;
  /** -1 cold .. +1 warm: the balance up to half way toward steel blue or amber. Fades at night. */
  warmth?: number;
  /** 0..1 added to the cool term (shadows and balance toward steel blue), day and night. */
  cool?: number;
  /** Added to saturation after the mood's own clamp (0.8..1.15); the sum is clamped to 0.7..1.2. */
  saturation?: number;
  /** Added to contrast before its clamp (0.94..1.1). */
  contrast?: number;
  /** Multiplies the menu strength on this planet; the product is clamped to 0..1. Default 1. */
  strength?: number;
}

export interface GradeParams {
  /** Luma-1 gains: the white balance. */
  balance: Vec3;
  /** Luma-1 chroma the shadows move toward. */
  shadowTint: Vec3;
  /** Luma-1 chroma the highlights move toward. */
  highlightTint: Vec3;
  /** How far toward the tints, 0..0.3. */
  split: number;
  /** About the pixel's own luma, 0.7..1.2; a raise is applied as vibrance. */
  saturation: number;
  /** Slope of log luma about the pivot, 0.94..1.1. */
  contrast: number;
  /** Linear luma the contrast turns about: display mid-grey, 0.18 divided by the exposure. */
  pivot: number;
}

/** The intermediate terms, for `__debug.grade()`. */
export interface GradeTerms {
  keyLuma: number;
  keyWarmth: number;
  heat: number;
  gloom: number;
  sunny: number;
  cool: number;
  night: number;
  ratio: number;
}

export const LUMA: Readonly<Vec3> = [0.2126, 0.7152, 0.0722];
/** Display mid-grey in scene units at exposure 1. */
export const GRADE_PIVOT = 0.18;
/** A room keeps this much less of the grade than the world: 0.7 leaves 30%. */
export const ROOM_DAMP = 0.7;
/** Seconds: how quickly the grade follows the sky (ramp columns step every few seconds; the day and night split jumps). */
export const SOURCE_TAU = 1.0;
/** Seconds: how quickly the room weight follows the camera through a door, both ways. */
export const ROOM_TAU = 0.35;
/** Chroma saturation the key, fill and air colours are limited to before they become tints. */
export const TINT_LIMIT = 0.55;

/**
 * Hand-set looks, keyed by the planet's id. Each entry is taste, not data. The sky's environment
 * blocks differ from region to region (one planet's keys run from dim to bright), so how bleak or
 * hot a planet feels is set here, and the sky supplies only the hues of the moment.
 */
export const GRADE_LOOKS: Readonly<Record<string, GradeLook>> = {
  tatooine: { warmth: 0.5, saturation: 0.03 },
  dathomir: { gloom: 0.8, warmth: -0.4, cool: 0.3, saturation: -0.06 },
  mustafar: { heat: 1 },
};

/** The hand-set look for a planet or space zone id, or nothing when it has none of its own. */
export function lookFor(planetId: string): GradeLook | undefined {
  return Object.prototype.hasOwnProperty.call(GRADE_LOOKS, planetId) ? GRADE_LOOKS[planetId] : undefined;
}

// --- helpers ---

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** GLSL's smoothstep: the Hermite curve between the two edges, flat outside them. */
export function smoothstep(a: number, b: number, x: number): number {
  if (b === a) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function luma(c: Readonly<Vec3>): number {
  return LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
}

export function copy3(from: Readonly<Vec3>, out: Vec3): Vec3 {
  out[0] = from[0];
  out[1] = from[1];
  out[2] = from[2];
  return out;
}

/** Linear blend; `out` may be either input. */
export function mix3(a: Readonly<Vec3>, b: Readonly<Vec3>, t: number, out: Vec3): Vec3 {
  const a0 = a[0];
  const a1 = a[1];
  const a2 = a[2];
  out[0] = a0 + (b[0] - a0) * t;
  out[1] = a1 + (b[1] - a1) * t;
  out[2] = a2 + (b[2] - a2) * t;
  return out;
}

/** Channelwise product; `out` may be either input. */
export function mul3(a: Readonly<Vec3>, b: Readonly<Vec3>, out: Vec3): Vec3 {
  out[0] = a[0] * b[0];
  out[1] = a[1] * b[1];
  out[2] = a[2] * b[2];
  return out;
}

export function scale3(v: Vec3, k: number): Vec3 {
  v[0] *= k;
  v[1] *= k;
  v[2] *= k;
  return v;
}

/** In place: v divided by its own luma, so it becomes a gain that leaves brightness alone; white for anything too dark to have a hue. */
export function normLuma(v: Vec3): Vec3 {
  const l = luma(v);
  if (!(l > 1e-6)) {
    v[0] = 1;
    v[1] = 1;
    v[2] = 1;
    return v;
  }
  return scale3(v, 1 / l);
}

/** A colour's hue as a luma-1 gain; white when it is too dark to have one. `out` may be `c`. */
export function chromaOf(c: Readonly<Vec3>, out: Vec3): Vec3 {
  const l = luma(c);
  if (!(l > 1e-4)) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    return out;
  }
  out[0] = c[0] / l;
  out[1] = c[1] / l;
  out[2] = c[2] / l;
  return out;
}

/** How warm a colour reads: (r - b) / (r + g + b); 0 for black. */
export function warmthOf(c: Readonly<Vec3>): number {
  const sum = c[0] + c[1] + c[2];
  return sum > 1e-7 ? (c[0] - c[2]) / sum : 0;
}

/** (max - min) / max: 0 for grey and black, 1 when a channel is 0. The shader computes the same. */
export function saturationOf(c: Readonly<Vec3>): number {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  return (mx - mn) / Math.max(mx, 1e-7);
}

/**
 * Pull a luma-1 chroma toward white until its saturation is at most `maxSat`. A blend between two
 * luma-1 colours is itself luma 1, so the limit costs no brightness. `out` may be `c`.
 */
export function limitChroma(c: Readonly<Vec3>, maxSat: number, out: Vec3): Vec3 {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  if (!(mx > 1e-9)) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    return out;
  }
  if ((mx - mn) / mx <= maxSat) return copy3(c, out);
  const t = maxSat / Math.max(1e-6, mx - mn - maxSat * (mx - 1));
  return mix3(WHITE, c, clamp01(t), out);
}

/** '#rrggbb' for a linear colour, for the console report only. */
export function linearToSrgbHex(c: Readonly<Vec3>): string {
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const v = c[i];
    const lin = Number.isFinite(v) ? Math.max(0, v) : 0;
    const srgb = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
    const byte = Math.round(clamp01(srgb) * 255);
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Display mid-grey in scene units. The output pass multiplies by the exposure before the tone
 * curve, so the scene value the player sees as mid-grey is 0.18 divided by it, and that is where
 * the contrast turns.
 */
export function gradePivot(exposure: number): number {
  const e = Number.isFinite(exposure) ? exposure : 1;
  return GRADE_PIVOT / clamp(e, 0.25, 4);
}

export function createGradeParams(): GradeParams {
  return { balance: [1, 1, 1], shadowTint: [1, 1, 1], highlightTint: [1, 1, 1], split: 0, saturation: 1, contrast: 1, pivot: GRADE_PIVOT };
}

export function createGradeSource(): GradeSource {
  return setNeutralSource({ key: [0, 0, 0], fill: [0, 0, 0], air: [0, 0, 0], night: 0, space: false });
}

/** The stand-in light for a frame with no converted sky: a plain day, no hue of its own. Leaves `night` and `space` alone. */
export function setNeutralSource(out: GradeSource): GradeSource {
  out.key[0] = 0.8;
  out.key[1] = 0.8;
  out.key[2] = 0.8;
  out.fill[0] = 0.3;
  out.fill[1] = 0.3;
  out.fill[2] = 0.3;
  out.air[0] = 0.5;
  out.air[1] = 0.5;
  out.air[2] = 0.5;
  return out;
}

export function copyGradeParams(from: Readonly<GradeParams>, to: GradeParams): GradeParams {
  copy3(from.balance, to.balance);
  copy3(from.shadowTint, to.shadowTint);
  copy3(from.highlightTint, to.highlightTint);
  to.split = from.split;
  to.saturation = from.saturation;
  to.contrast = from.contrast;
  to.pivot = from.pivot;
  return to;
}

// Steel blue and amber, as luma-1 gains, and plain white.
const WHITE: Readonly<Vec3> = [1, 1, 1];
const COOL: Readonly<Vec3> = normLuma([0.78, 0.92, 1.18]);
const WARM: Readonly<Vec3> = normLuma([1.12, 1.0, 0.82]);

// Working colours, so nothing allocates on a frame.
const KC: Vec3 = [1, 1, 1];
const FC: Vec3 = [1, 1, 1];
const AC: Vec3 = [1, 1, 1];
const T1: Vec3 = [1, 1, 1];
const T2: Vec3 = [1, 1, 1];

// --- the derivation ---

/**
 * The seven numbers the shader wants, from the planet's hand-set mood and the light of the moment.
 * The mood never comes from the sky: a planet's environment blocks differ region by region, so a
 * mood read from whichever block is in use would swing between neighbouring regions. The sky gives
 * the hues and how hard the key light stands against the fill, which are properly of the moment.
 */
export function deriveGrade(src: Readonly<GradeSource>, look: GradeLook | undefined, exposure: number, out: GradeParams, terms?: GradeTerms): GradeParams {
  const lk = luma(src.key);
  const lf = luma(src.fill);
  const keyWarmth = warmthOf(src.key);
  limitChroma(chromaOf(src.key, KC), TINT_LIMIT, KC);
  limitChroma(chromaOf(src.fill, FC), TINT_LIMIT, FC);
  limitChroma(chromaOf(src.air, AC), TINT_LIMIT, AC);
  const space = src.space;
  const night = space ? 0 : clamp01(src.night);

  // The mood is the planet's, never the sky block's.
  const heat = space ? 0 : clamp01(look?.heat ?? 0);
  const gloom = space ? 0 : clamp01(look?.gloom ?? 0) * (1 - heat) * (1 - night);
  const sunny = space ? 0.5 : (1 - gloom) * (1 - night) * (1 - heat);
  const cool = clamp01((space ? 0.15 : clamp01(0.8 * gloom + 0.5 * night) * (1 - heat)) + (look?.cool ?? 0));

  // White balance: part of the way to the key light's hue, pulled toward steel blue by the cool
  // term, then the look's own warmth, which fades out at night.
  normLuma(mix3(KC, COOL, 0.7 * cool, T1));
  const balanceMix = space ? 0.06 : 0.08 + 0.1 * sunny + 0.22 * heat + 0.06 * gloom;
  normLuma(mix3(WHITE, T1, balanceMix, out.balance));
  const w = clamp(look?.warmth ?? 0, -1, 1) * (1 - night);
  if (w !== 0) normLuma(mix3(out.balance, w > 0 ? WARM : COOL, 0.5 * Math.abs(w), out.balance));

  // Split toning: the shadows toward what lights them (the sky ambient, a little of the air),
  // cooled; the highlights toward the key light, toward white as the mood goes bleak or dark.
  if (space) normLuma(mix3(FC, COOL, 0.15, out.shadowTint));
  else normLuma(mix3(mix3(FC, AC, 0.3, T2), COOL, cool, out.shadowTint));
  normLuma(mix3(KC, WHITE, Math.max(0.25 * night, 0.6 * gloom), out.highlightTint));
  out.split = Math.min(0.3, space ? 0.06 : 0.1 + 0.08 * gloom + 0.08 * heat + 0.04 * night);

  const moodSaturation = space ? 1.05 : clamp(1 + 0.08 * sunny + 0.14 * heat - 0.24 * gloom - 0.12 * night, 0.8, 1.15);
  out.saturation = clamp(moodSaturation + (look?.saturation ?? 0), 0.7, 1.2);
  const ratio = lk / Math.max(lf, 0.03);
  out.contrast = clamp((space ? 1.05 : 1 + 0.08 * clamp01((ratio - 1.5) / 3) * (1 - 0.7 * night) - 0.04 * gloom) + (look?.contrast ?? 0), 0.94, 1.1);
  out.pivot = gradePivot(exposure);
  if (terms) {
    terms.keyLuma = lk;
    terms.keyWarmth = keyWarmth;
    terms.heat = heat;
    terms.gloom = gloom;
    terms.sunny = sunny;
    terms.cool = cool;
    terms.night = night;
    terms.ratio = ratio;
  }
  return out;
}

export function createGradeTerms(): GradeTerms {
  return { keyLuma: 0, keyWarmth: 0, heat: 0, gloom: 0, sunny: 0, cool: 0, night: 0, ratio: 0 };
}

// --- following the sky ---

/** Ease the live source toward the sky's: `cur += (target - cur) * k` throughout. k = 1 snaps. */
export function smoothSource(cur: GradeSource, target: Readonly<GradeSource>, k: number): void {
  for (let i = 0; i < 3; i++) {
    cur.key[i] += (target.key[i] - cur.key[i]) * k;
    cur.fill[i] += (target.fill[i] - cur.fill[i]) * k;
    cur.air[i] += (target.air[i] - cur.air[i]) * k;
  }
  cur.night += (target.night - cur.night) * k;
  cur.space = target.space;
}

/** The largest difference over key, fill, air (per channel) and night: 0 once the grade has caught up. */
export function sourceLag(a: Readonly<GradeSource>, b: Readonly<GradeSource>): number {
  let worst = Math.abs(a.night - b.night);
  for (let i = 0; i < 3; i++) {
    worst = Math.max(worst, Math.abs(a.key[i] - b.key[i]), Math.abs(a.fill[i] - b.fill[i]), Math.abs(a.air[i] - b.air[i]));
  }
  return worst;
}

// --- the pixel, mirrored from the shader ---

/**
 * What the grade does to one linear pixel. This is the shader of `ColorGradePass` line for line:
 * `__debug.gradeSelfTest()` draws the shader over known colours and compares the two, and the node
 * test sweeps this one for the guards.
 */
export function applyGradePixel(c: Readonly<Vec3>, P: Readonly<GradeParams>, amountIn: number, out: Vec3): Vec3 {
  const amount = clamp01(amountIn);
  const l0 = luma(c);
  if (amount <= 0 || l0 <= 1e-7) return copy3(c, out);
  // 1. white balance
  mul3(c, mix3(WHITE, P.balance, amount, T1), out);
  // 2. split toning by the zone of the original luma, then back to that luma
  const t = clamp01((Math.log2(l0 + 1e-5) - Math.log2(P.pivot) + 2) / 4);
  const w = 1 - t * t * (3 - 2 * t);
  mix3(P.highlightTint, P.shadowTint, w, T2);
  mul3(out, mix3(WHITE, T2, P.split * amount, T2), out);
  scale3(out, l0 / Math.max(luma(out), 1e-7));
  // 3. saturation about the luma: a raise scaled by how grey the pixel already is (vibrance), a
  // cut in full; no channel goes negative; then back to that luma
  let s = 1 + (P.saturation - 1) * amount;
  if (s > 1) s = 1 + (s - 1) * (1 - saturationOf(out));
  for (let i = 0; i < 3; i++) out[i] = Math.max(0, l0 + (out[i] - l0) * s);
  scale3(out, l0 / Math.max(luma(out), 1e-7));
  // 4. contrast on log luma about the pivot, fading to nothing in the deep shadows and in the
  // highlights the tone curve is about to roll off
  const k = 1 + (P.contrast - 1) * amount;
  const lc = P.pivot * Math.pow(l0 / P.pivot, k);
  const g = smoothstep(P.pivot / 32, P.pivot / 4, l0) * (1 - smoothstep(P.pivot * 8, P.pivot * 32, l0));
  return scale3(out, (l0 + (lc - l0) * g) / l0);
}

// --- the vignette, the grain and the dither, mirrored from their shader ---

/** The most a corner loses at strength 1, as a share of its display value. */
export const VIGNETTE_MAX = 0.55;
/** Where the falloff starts, as a fraction of the way from the centre to a corner. */
export const VIGNETTE_INNER = 0.45;
/** Display units per unit of noise at strength 1, at mid-grey. */
export const GRAIN_MAX = 0.09;
/** Grain patterns a second: one is held between steps, as film does. */
export const GRAIN_RATE = 24;
/** Pixels per grain cell at 1080 lines; scaled with the height, so the grain reads the same at any resolution. */
export const GRAIN_CELL_1080 = 1.25;
/** Added to the vignette's strength at full aim. */
export const AIM_VIGNETTE = 0.12;

/** What the vignette multiplies a display value by at uv: elliptical, following the screen's shape. */
export function vignetteFactor(u: number, v: number, strength: number): number {
  const d = Math.hypot(u - 0.5, v - 0.5) * Math.SQRT2;
  return 1 - strength * VIGNETTE_MAX * smoothstep(VIGNETTE_INNER, 1, d);
}

/** How much grain a display luma takes: none at black and white, all of it at mid-grey. */
export function grainResponse(l: number): number {
  return Math.pow(clamp01(4 * l * (1 - l)), 0.6);
}

/** How much of the one-step dither a display channel takes: none at 0 and 1, all of it from two 8-bit steps in. */
export function ditherWeight(c: number): number {
  return clamp01(Math.min(c, 1 - c) * 127.5);
}
