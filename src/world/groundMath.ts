// The ground's composition as arithmetic: what the tile program (`terrainTextures.ts`) works out at a pixel,
// line for line, so a node test can sweep it and `__debug.groundSelfTest()` can hold the drawn pixels to it,
// the way `gradeMath.ts` stands beside the colour grade. Pure, imports only the tile rules.
//
//  - a tile's colour is its bottom layer, each overlay laid over it by its mask in turn (the client's chain of
//    lerps), the bump map and the gloss by the same weights;
//  - the colour map's tint is the byte decoded from the client's gamma, in one of four modes (`tintGamma`);
//  - the blended bump leans level ground by its slope, its x turned with the pictures' way round (`bumpNormal`);
//  - the client's cloud shadow lays grey 0.2 over the lit ground in its own gamma at the texture's alpha
//    squared, and here darkens only (`cloudShade`), the tile drifting with the clock (`cloudUv`);
//  - the flat shine, the client's specular power of nought, is the gloss times the light over pi (`flatShine`).
//
// The self test draws every one of these with the program and reads it back against these functions: the
// colour, the tint (its gain cap binding), the clouds at their place and drift, the bump and gloss, and the
// flat shine under a light of its own.
import { MASK_OPPOSITE, MASK_QUARTER, maskKind, maskTurn, turnTile } from './groundTiles.ts';

/** Rec. 709's weights, which the world's brightness reference was measured with. */
export const LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

/** The grey the client's cloud layer lays over the ground, in its own gamma (read from its tile shader's colour). */
export const CLOUD_GREY = 0.2;

/** The cloud tile's scale and drift: world metres per repeat, and one repeat every this many seconds each way (+x, -z). */
export const CLOUD_METRES = 256;
export const CLOUD_PERIOD = 256;

/** sRGB's own decode, extended past one by the same curve (a normalised tint can pass one). */
export function srgbDecode(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** And its encode, for a colour in [0, 1]. */
export function srgbEncode(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** The world's brightness reference as the tint reads it (`ColorReference` cut to its numbers); null reads as white. */
export interface TintReference {
  rgb: readonly [number, number, number];
  luminance: number;
}

/**
 * The colour map's tint at a vertex, in the client's gamma, from its three bytes as 0..1. Modes as the shader
 * numbers them: 0 off, 1 the client's own value, 2 normalised (the world's median brightness taken to one,
 * the hue kept, and no pole past `cap` in brightness), 3 each channel to its own median, each held to `cap`.
 */
export function tintGamma(c: readonly [number, number, number], mode: number, ref: TintReference | null, cap: number, out: [number, number, number]): [number, number, number] {
  if (mode < 0.5) {
    out[0] = out[1] = out[2] = 1;
    return out;
  }
  if (mode < 1.5) {
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
    return out;
  }
  if (mode < 2.5) {
    const lum = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
    const gain = Math.min(1 / Math.max(ref?.luminance ?? 1, 1e-3), cap / Math.max(lum, 1e-6));
    out[0] = c[0] * gain;
    out[1] = c[1] * gain;
    out[2] = c[2] * gain;
    return out;
  }
  for (let i = 0; i < 3; i++) out[i] = Math.min(c[i] / Math.max(ref?.rgb[i] ?? 1, 1e-3), cap);
  return out;
}

/** A mask texture read at (u, v) in the image's own frame, 0..1: what the program's sampler hands back. */
export type MaskSample = (kind: number, u: number, v: number) => number;

const turned: [number, number] = [0, 0];

/**
 * How much of an overlay shows at a tile place (s, t): its mask, turned onto its corners. `add` takes an
 * opposite pair's two quarters summed and held to one rather than the stronger; `painted` false steps the
 * mask at a half, the hard border to compare with.
 */
export function maskWeight(code: number, s: number, t: number, sample: MaskSample, add: boolean, painted: boolean): number {
  const kind = maskKind(code);
  if (kind < 0) return 0;
  const k = maskTurn(code);
  let m: number;
  if (kind === MASK_OPPOSITE) {
    turnTile(s, t, k, turned);
    const a = sample(MASK_QUARTER, turned[0], turned[1]);
    turnTile(s, t, k + 2, turned);
    const b = sample(MASK_QUARTER, turned[0], turned[1]);
    m = add ? Math.min(a + b, 1) : Math.max(a, b);
  } else {
    turnTile(s, t, k, turned);
    m = sample(kind, turned[0], turned[1]);
  }
  return painted ? m : m >= 0.5 ? 1 : 0;
}

/**
 * A tile's colour (or its bump, or anything sampled layer by layer) at a place: the bottom layer, each overlay
 * mixed over it by its weight, in order. `layer(i, out)` writes the i-th layer's sample; `codes` are the three
 * overlays' mask codes, nought past the last. Writes the three weights into `weights` when given.
 */
export function composeTile(layer: (i: number, out: number[]) => void, codes: ArrayLike<number>, s: number, t: number, sample: MaskSample, add: boolean, painted: boolean, out: number[], weights?: number[]): number[] {
  layer(0, out);
  const over: number[] = new Array(out.length).fill(0);
  for (let i = 0; i < 3; i++) {
    if (weights) weights[i] = 0;
    if (!(codes[i] > 0)) break;
    const w = maskWeight(codes[i], s, t, sample, add, painted);
    if (weights) weights[i] = w;
    layer(i + 1, over);
    for (let c = 0; c < out.length; c++) out[c] = out[c] + (over[c] - out[c]) * w;
  }
  return out;
}

/**
 * The lean a tile's blended bump gives level ground (the program's normal stage over a geometry normal straight
 * up): the bump's direction as a slope, its x turned with the pictures' way round (`mirror` +1 the client's: a
 * slope toward the picture's right runs toward the world's -x), times `scale`, as a unit normal in the world's
 * frame, y up. `rgb` are the bump's bytes over 255.
 */
export function bumpNormal(rgb: ArrayLike<number>, mirror: number, scale: number, out: [number, number, number]): [number, number, number] {
  const nx = rgb[0] * 2 - 1;
  const ny = rgb[1] * 2 - 1;
  const d = Math.max(rgb[2] * 2 - 1, 0.2);
  const sx = (-nx / d) * scale * -mirror;
  const sz = (-ny / d) * scale;
  const len = Math.hypot(sx, 1, sz);
  out[0] = -sx / len;
  out[1] = 1 / len;
  out[2] = -sz / len;
  return out;
}

/** The cloud tile's coordinate at a terrain-space point and a time, the pictures' own way round (`mirror` +1 or -1). */
export function cloudUv(terrainX: number, terrainZ: number, mirror: number, seconds: number, out: [number, number]): [number, number] {
  const t = ((seconds % CLOUD_PERIOD) + CLOUD_PERIOD) % CLOUD_PERIOD;
  out[0] = (mirror * terrainX) / CLOUD_METRES + t / CLOUD_PERIOD;
  out[1] = terrainZ / CLOUD_METRES - t / CLOUD_PERIOD;
  return out;
}

/**
 * The factor the cloud layer multiplies one channel of the lit ground by: the client's grey laid over it in
 * gamma at the tile's alpha squared times `strength`, worked on the colour as it would be shown (held to one),
 * and never more than one, so a cloud only ever darkens (ours: a ground darker than the grey is left alone).
 */
export function cloudShade(lit: number, alpha: number, strength: number): number {
  const k = Math.min(1, Math.max(0, alpha * alpha * strength));
  const g = srgbEncode(Math.min(1, Math.max(0, lit)));
  const base = srgbDecode(g);
  const shaded = srgbDecode(g + (CLOUD_GREY - g) * k);
  return Math.min(1, shaded / Math.max(base, 1e-5));
}

/** The flat shine one light adds, in the same units three's lighting works in: the gloss times the light over pi times the strength. */
export function flatShine(lightColour: number, gloss: number, strength: number): number {
  return (lightColour * gloss * strength) / Math.PI;
}
