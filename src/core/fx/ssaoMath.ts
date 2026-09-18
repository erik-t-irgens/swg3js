// Ambient occlusion's constants and the arithmetic its shaders do, kept free of imports so a plain
// node test can check it. The shaders in ssao.ts take their numeric defines from here, so the two
// cannot drift apart; every function below is the shader's own expression written out in
// JavaScript.

export const SSAO_SLICES = 3;
export const SSAO_STEPS = 2;
/** Metres: the darkening starts fading. */
export const SSAO_FADE_START = 45;
/** Metres: gone (24-bit depth is 1.2 cm a step at 100 m and coarsening fast). */
export const SSAO_FADE_END = 95;
/** Metres: nearer than this, the radius shrinks with distance. */
export const SSAO_NEAR_RADIUS_AT = 4;
/** The least share of the radius kept up close. */
export const SSAO_NEAR_RADIUS_MIN = 0.25;
/** The radius's cap in pixels, as a share of the AO buffer's height. */
export const SSAO_MAX_RADIUS_SHARE = 0.25;
/** The share of the radius over which a sample's weight falls to nothing. */
export const SSAO_FALLOFF = 0.615;
/** The visibility is raised to this (times the strength past 1) before multi-bounce. */
export const SSAO_BASE_POWER = 1.5;
/** The blur's tolerance: the share of the depth a tap may miss the continued surface by (plus 5 cm). */
export const SSAO_BLUR_TOLERANCE = 0.04;
/** The brightest albedo a lit surface is taken to have: brighter pixels carry light no lit surface explains. */
export const SSAO_ALBEDO_CEILING = 0.85;
/** Below this ambient share there is nothing to occlude and the texel is written open. */
export const SSAO_MIN_FRACTION = 0.02;
/** The averaged visibility is divided by this: rounding sample offsets to texels reads flat ground as a little occluded. */
export const SSAO_OPEN_BIAS = 0.985;
/** log2 of the smallest ceiling the 8-bit channel stores. */
export const SSAO_CEILING_LOG_MIN = -8;
/** The log2 range the 8-bit channel stores. */
export const SSAO_CEILING_LOG_SPAN = 16;
export const SSAO_UPSAMPLE_TOLERANCE_SHARE = 0.01;
export const SSAO_UPSAMPLE_TOLERANCE_METRES = 0.03;
/** Stencil values the portal renderer leaves where the rooms' lights drew a pixel: 1 from inside a building, 3 through a door from outside. */
export const SSAO_ROOMS_STENCIL_INSIDE = 1;
export const SSAO_ROOMS_STENCIL_OUTSIDE = 3;

const HALF_PI = Math.PI / 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** The stencil value that marks the rooms' pixels: 1 with the camera inside a building, 3 outside. */
export function ssaoRoomsStencil(portalView: boolean): number {
  return portalView ? SSAO_ROOMS_STENCIL_INSIDE : SSAO_ROOMS_STENCIL_OUTSIDE;
}

export interface SsaoShape {
  weight: number;
  power: number;
}

/** Strength to the apply pass's weight and visibility power: 0.5 half the darkening, 1 the default, 2 a steeper curve. */
export function ssaoShape(strength: number, out: SsaoShape): SsaoShape {
  out.weight = clamp(strength, 0, 1);
  out.power = SSAO_BASE_POWER * Math.max(strength, 1);
  return out;
}

export interface AoRadius {
  metres: number;
  pixels: number;
  open: boolean;
}

/**
 * The radius the GTAO shader uses at a view depth: shrunk near the camera, capped at a share of the
 * AO buffer's height in pixels, and turned back into metres so the falloff matches the cap; open
 * when under 1.5 pixels.
 */
export function aoRadius(radius: number, viewZ: number, aoHeight: number, tanHalfFovY: number, out: AoRadius): AoRadius {
  const r = radius * clamp(viewZ / SSAO_NEAR_RADIUS_AT, SSAO_NEAR_RADIUS_MIN, 1);
  const pxPerMetre = (aoHeight * 0.5) / (tanHalfFovY * viewZ);
  const px = Math.min(r * pxPerMetre, SSAO_MAX_RADIUS_SHARE * aoHeight);
  out.pixels = px;
  out.metres = px / pxPerMetre;
  out.open = px < 1.5;
  return out;
}

/** Rec. 709 luminance of linear colour. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Three's getDistanceAttenuation: inverse power of the distance, smoothly cut to nothing at `cutoff` (0: no cutoff). */
export function lightFalloff(d: number, cutoff: number, decay: number): number {
  let f = 1 / Math.max(Math.pow(d, decay), 0.01);
  if (cutoff > 0) {
    const x = d / cutoff;
    const s = clamp(1 - x * x * x * x, 0, 1);
    f *= s * s;
  }
  return f;
}

/** The ambient share of a surface's light: indirect over the total, 0 when there is no light at all. */
export function indirectFraction(indirect: number, direct: number): number {
  const total = indirect + direct;
  return total > 1e-4 ? indirect / total : 0;
}

/** A ceiling (irradiance over pi) into 0..1 on a log2 scale, for the AO target's 8-bit blue channel. */
export function encodeCeiling(x: number): number {
  return clamp((Math.log2(Math.max(x, 1e-6)) - SSAO_CEILING_LOG_MIN) / SSAO_CEILING_LOG_SPAN, 0, 1);
}

export function decodeCeiling(e: number): number {
  return Math.pow(2, e * SSAO_CEILING_LOG_SPAN + SSAO_CEILING_LOG_MIN);
}

/** Light bounced inside a crease lifts the occlusion of a bright surface (the GTAO paper's fit). */
export function multiBounce(v: number, albedo: number): number {
  const a = 2.0404 * albedo - 0.3324;
  const b = -4.7951 * albedo + 0.6417;
  const c = 2.7552 * albedo + 0.6903;
  return Math.max(v, ((v * a + b) * v + c) * v);
}

/** Three's CSM fade margin: a cascade's edge `e` (a share of the shadow range) blends over `0.25 e^2` either side. */
export const SSAO_CSM_FADE_MARGIN = 0.25;

/**
 * How much of the sun's shadow the lit materials took at linear depth `ld` (view depth over the
 * cascades' range), given the last cascade's start `x` and end `y` (three's CSMShader). Without
 * CSM's fade: all of it inside the last cascade and none past it. With fade (the world's): all of it
 * up to the last cascade's middle, then the far edge's margin fades it out, to nothing at
 * `y + margin / 2`. Nearer cascades are always taken whole.
 */
export function cascadeShadowKeep(ld: number, x: number, y: number, fade: boolean): number {
  if (!fade) return ld < y ? 1 : 0;
  if (ld <= 0.5 * (x + y)) return 1;
  const m = Math.max(SSAO_CSM_FADE_MARGIN * y * y, 1e-6);
  return clamp(Math.min(ld - (x - 0.5 * m), y + 0.5 * m - ld) / m, 0, 1);
}

export function openBiased(v: number, bias: number): number {
  return clamp(v / bias, 0, 1);
}

/** How far off a half-resolution tap's plane a full-resolution pixel may lie and still take its value, in metres. */
export function upsampleTolerance(viewZ: number): number {
  return viewZ * SSAO_UPSAMPLE_TOLERANCE_SHARE + SSAO_UPSAMPLE_TOLERANCE_METRES;
}

/** The upsample's per-tap weight: normal n (need not be unit), offset d from the tap's point to the pixel's, tolerance in metres. */
export function planeWeight(n: readonly [number, number, number], d: readonly [number, number, number], tolerance: number): number {
  const len = Math.hypot(n[0], n[1], n[2]);
  const off = Math.abs(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]);
  return clamp(1 - off / (tolerance * Math.max(len, 0.5)), 0, 1);
}

export interface AoApplyInput {
  ao: number;
  fraction: number;
  ceiling: number;
  lum: number;
  fade: number;
  strength: number;
  directShare?: number;
}

const shapeTmp: SsaoShape = { weight: 1, power: SSAO_BASE_POWER };

/** The apply shader's multiplier on the surface part of a pixel, without fog or water. */
export function aoMultiplier(p: AoApplyInput): number {
  const shape = ssaoShape(p.strength, shapeTmp);
  const albedo = clamp(p.lum / Math.max(p.ceiling, 1e-4), 0, 0.9);
  // The fit overshoots 1 by up to 5e-5 at full visibility; held there, so nothing is brightened.
  const v = Math.min(multiBounce(Math.pow(p.ao, shape.power), albedo), 1);
  const share = p.directShare ?? 0;
  const weight = (p.fraction + (1 - p.fraction) * share) * p.fade * Math.min(shape.weight, 1);
  const lit = p.ceiling * SSAO_ALBEDO_CEILING;
  const accountable = p.lum > lit ? lit / p.lum : 1;
  const darken = (1 - v) * weight * accountable;
  return 1 - darken;
}

/** One slice's cosine-weighted visibility, horizons clamped to the normal's hemisphere (the shader's integral). */
export function gtaoSlice(n: number, cosN: number, projLen: number, h0: number, h1: number): number {
  const c0 = n + clamp(h0 - n, -HALF_PI, HALF_PI);
  const c1 = n + clamp(h1 - n, -HALF_PI, HALF_PI);
  const sinN = Math.sin(n);
  const a0 = (cosN + 2 * c0 * sinN - Math.cos(2 * c0 - n)) * 0.25;
  const a1 = (cosN + 2 * c1 * sinN - Math.cos(2 * c1 - n)) * 0.25;
  return projLen * (a0 + a1);
}

type V3 = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: readonly number[]): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};

/**
 * Mean visibility of an unoccluded surface with normal `n` seen along `v` (view space, v towards the
 * eye), over `slices` evenly turned slices: the shader's slice set-up with both horizons at the
 * surface's own tangent.
 */
export function gtaoOpenAverage(n: readonly [number, number, number], v: readonly [number, number, number], slices: number): number {
  const N = norm(n);
  const V = norm(v);
  let sum = 0;
  for (let s = 0; s < slices; s++) {
    const phi = ((s + 0.5) * Math.PI) / slices;
    const dirV: V3 = [Math.cos(phi), Math.sin(phi), 0];
    const dv = dot(dirV, V);
    const ortho: V3 = [dirV[0] - dv * V[0], dirV[1] - dv * V[1], dirV[2] - dv * V[2]];
    const axis = norm(cross(ortho, V));
    const na = dot(N, axis);
    const projN: V3 = [N[0] - axis[0] * na, N[1] - axis[1] * na, N[2] - axis[2] * na];
    const projLen = Math.hypot(projN[0], projN[1], projN[2]);
    const cosN = clamp(dot(projN, V) / Math.max(projLen, 1e-4), 0, 1);
    const nAngle = (dot(ortho, projN) < 0 ? -1 : 1) * Math.acos(cosN);
    // Nothing above the surface: each horizon lies along the surface itself.
    const hc0 = Math.cos(nAngle + HALF_PI);
    const hc1 = Math.cos(nAngle - HALF_PI);
    const h0 = -Math.acos(clamp(hc1, -1, 1));
    const h1 = Math.acos(clamp(hc0, -1, 1));
    sum += gtaoSlice(nAngle, cosN, projLen, h0, h1);
  }
  return sum / slices;
}
