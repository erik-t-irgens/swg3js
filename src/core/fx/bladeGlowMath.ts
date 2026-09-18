// The light a lit lightsaber throws on what is around it, as numbers. The glow pass (`bladeGlow.ts`)
// adds every blade as a short segment light on the surfaces the scene's depth holds; this module is
// the same arithmetic with no imports at all, so a plain node test can pin the curve, the screen box
// the pass works in and the march that stops the light at walls, and the shader is built from the
// constants below so the two cannot drift apart.
//
// Units: metres, and light in three's own terms (a surface of albedo a lit by irradiance E sends
// a x E / PI). Every function here is allocation-free.

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** A box on the screen in uv, 0 to 1 from the bottom left. */
export interface UvRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BladeGlowTune {
  /** Intensity of a fully lit blade: before the knee, irradiance is power / (d^2 + core). */
  power: number;
  /** Softens the peak: the squared radius inside which the light stops rising like 1/d^2. */
  core: number;
  /** The irradiance the light levels off at where a blade touches a surface: a smooth fourth-power knee, never a flat cap. */
  knee: number;
  /** Metres from the blade where the light reaches zero; it starts fading at 0.55 of it. */
  range: number;
  /** The albedo assumed for every surface (there is no albedo buffer). */
  albedo: number;
  /** How much of the surface's own hue (its colour over its brightest channel) tints the light, 0..1. */
  hue: number;
  /** Over a pixel that is mostly additive glow, the light is scaled by this (the surface's hue is unknown there). */
  glowDim: number;
  /** Wrap-around Lambert: surfaces a little past side-on still catch some light, which hides depth-normal facets. */
  wrap: number;
  /** Walls (normals near horizontal to `up`) get this share of what floors and ceilings get. */
  walls: number;
  /** No light from blades farther than this from the camera, fading from `fadeFrom`. */
  far: number;
  fadeFrom: number;
  /** The light's colour: the blade's, this far toward white. */
  whiteness: number;
  /** A group's marchable light (its strongest channel, before albedo) below this is not marched. */
  marchMin: number;
}

/** The tuning, live: `__debug.bladeGlow({ power: 3 })` writes here and the pass reads it every frame. */
export const BLADE_GLOW_TUNE: BladeGlowTune = {
  power: 2.54,
  core: 0.2025,
  knee: 3,
  range: 3.5,
  albedo: 0.45,
  hue: 0.6,
  glowDim: 0.85,
  wrap: 0.3,
  walls: 0.8,
  far: 60,
  fadeFrom: 45,
  whiteness: 0.12,
  marchMin: 0.02,
};

/** Blades lit per frame: the size of the shader's uniform arrays (MAX_BLADES). */
export const BLADE_GLOW_MAX = 8;

/**
 * A pixel brighter than `ratioFrom..ratioTo` times the light ceiling, or than `lumFrom..lumTo` in
 * luminance, is taken for glow (a blade, a bolt, a flame) rather than a lit surface: its hue is not
 * used and the light over it is dimmed a little instead.
 */
export const BLADE_GLOW_GUARD = { ratioFrom: 1, ratioTo: 2, lumFrom: 1.5, lumTo: 3 } as const;

/** The screen-space march that stops the light at walls; emitted into the shader as consts. */
export const BLADE_GLOW_MARCH = {
  /** Depth taps per marched pixel. */
  steps: 8,
  /** Metres off the surface along its normal the march starts, plus biasPerM per metre of view depth. */
  bias: 0.02,
  biasPerM: 0.004,
  /** The last metres before the blade are never tested (the hilt, the hand around it). */
  skipEnd: 0.25,
  /** A shorter path is not marched. */
  minSpan: 0.1,
  /** A sample at most max(thickMin, thickSteps x step) behind the depth is inside a blocker ... */
  thickMin: 0.4,
  thickSteps: 2,
  /** ... and beyond that it fades out over this. */
  thickRamp: 0.25,
  /** A sample must be this far behind the depth to count, plus marginPerM per metre. */
  margin: 0.03,
  marginPerM: 0.006,
  /** The occlusion ramps in over this past the margin. */
  soft: 0.1,
  /** A surface nearer the eye than the path's nearer end by more than this is in front of the path, not on it ... */
  slack: 0.3,
  /** ... fading in over this. */
  slackRamp: 0.15,
  /** Light from a blade nearer than this is never marched, fully marched from nearFull. */
  near: 0.5,
  nearFull: 0.8,
} as const;

/** GLSL's smoothstep. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Parameter of the point on segment a-b nearest p, 0..1. */
export function closestOnSegment(p: Vec3Like, a: Vec3Like, b: Vec3Like): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / Math.max(len2, 1e-6);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Squared distance from p to the nearest point of segment a-b. */
export function segmentDistanceSq(p: Vec3Like, a: Vec3Like, b: Vec3Like): number {
  const t = closestOnSegment(p, a, b);
  const qx = a.x + (b.x - a.x) * t - p.x;
  const qy = a.y + (b.y - a.y) * t - p.y;
  const qz = a.z + (b.z - a.z) * t - p.z;
  return qx * qx + qy * qy + qz * qz;
}

/**
 * Irradiance at distance d (d2 = d^2): e = power / (d2 + core), then e / (1 + (e / knee)^4)^(1/4),
 * times 1 - smoothstep(0.55 range, range, d). Rises all the way in and levels off at `knee`.
 */
export function irradiance(d2: number, t: BladeGlowTune): number {
  const d = Math.sqrt(Math.max(0, d2));
  const e = t.power / (d2 + t.core);
  let r = e / t.knee;
  r *= r;
  r *= r;
  return (e / Math.sqrt(Math.sqrt(1 + r))) * (1 - smoothstep(0.55 * t.range, t.range, d));
}

/** clamp((cosine + wrap) / (1 + wrap), 0, 1). */
export function wrapLambert(cosine: number, wrap: number): number {
  const v = (cosine + wrap) / (1 + wrap);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** What one channel of a white light adds on a neutral surface: irradiance x wrapLambert x albedo / PI (walls factor and fog left to the caller). */
export function radiance(d2: number, cosine: number, t: BladeGlowTune): number {
  return (irradiance(d2, t) * wrapLambert(cosine, t.wrap) * t.albedo) / Math.PI;
}

/** 1 up to fadeFrom, 0 from far, smooth between. */
export function distanceFade(d: number, t: BladeGlowTune): number {
  return 1 - smoothstep(t.fadeFrom, t.far, d);
}

/** Rec. 709 luminance. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * A point light's irradiance luminance at a point `d` metres away, taken no nearer than `reach`
 * short of it and never nearer than 1 m: lum x intensity / max(1, d - reach)^decay. An estimate
 * that errs high, for the brightness a surface near the blades can have from that light.
 */
export function pointIrradiance(lum: number, intensity: number, d: number, reach: number, decay: number): number {
  return (lum * intensity) / Math.pow(Math.max(1, d - reach), decay);
}

/** 1 for a pixel a lit surface can explain, 0 for one that is mostly glow: (1 - smoothstep(1, 2, lum / ceiling)) x (1 - smoothstep(1.5, 3, lum)). */
export function glowGuard(lum: number, ceiling: number): number {
  const G = BLADE_GLOW_GUARD;
  return (1 - smoothstep(G.ratioFrom, G.ratioTo, lum / Math.max(ceiling, 1e-3))) * (1 - smoothstep(G.lumFrom, G.lumTo, lum));
}

export function emptyRect(r: UvRect): void {
  r.x0 = Infinity;
  r.y0 = Infinity;
  r.x1 = -Infinity;
  r.y1 = -Infinity;
}

export function unionRect(into: UvRect, r: UvRect): void {
  if (r.x0 < into.x0) into.x0 = r.x0;
  if (r.y0 < into.y0) into.y0 = r.y0;
  if (r.x1 > into.x1) into.x1 = r.x1;
  if (r.y1 > into.y1) into.y1 = r.y1;
}

/** Clip-space x, y, w of the eight box corners, kept so `lightRect` allocates nothing. */
const cx = new Float64Array(8);
const cy = new Float64Array(8);
const cw = new Float64Array(8);

/**
 * The screen box a blade's light can touch: the uv box of the segment's bounding box grown by
 * `range`, projected with `viewProj` (column-major, Matrix4.elements). Corners in front of the near
 * plane are projected as they are; each of the box's 12 edges that crosses the near plane (clip
 * w = near) adds its crossing point. Clamped to 0..1. False when no part of the box is in front of
 * the near plane, or the box misses the screen.
 */
export function lightRect(a: Vec3Like, b: Vec3Like, range: number, viewProj: ArrayLike<number>, near: number, out: UvRect): boolean {
  const e = viewProj;
  const lox = Math.min(a.x, b.x) - range;
  const loy = Math.min(a.y, b.y) - range;
  const loz = Math.min(a.z, b.z) - range;
  const hix = Math.max(a.x, b.x) + range;
  const hiy = Math.max(a.y, b.y) + range;
  const hiz = Math.max(a.z, b.z) + range;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? hix : lox;
    const y = i & 2 ? hiy : loy;
    const z = i & 4 ? hiz : loz;
    cx[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    cy[i] = e[1] * x + e[5] * y + e[9] * z + e[13];
    cw[i] = e[3] * x + e[7] * y + e[11] * z + e[15];
  }
  // A hair past the near plane, so a crossing point never divides by a w of zero.
  const clipW = near * 1.001;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let any = false;
  for (let i = 0; i < 8; i++) {
    if (cw[i] < clipW) continue;
    const u = (cx[i] / cw[i]) * 0.5 + 0.5;
    const v = (cy[i] / cw[i]) * 0.5 + 0.5;
    if (u < x0) x0 = u;
    if (v < y0) y0 = v;
    if (u > x1) x1 = u;
    if (v > y1) y1 = v;
    any = true;
  }
  // The edges: corner i to the corner that differs from it in one axis bit, each edge once.
  for (let i = 0; i < 8; i++) {
    for (let bit = 1; bit <= 4; bit <<= 1) {
      const j = i | bit;
      if (j === i) continue;
      const wi = cw[i];
      const wj = cw[j];
      if (wi >= clipW === wj >= clipW) continue;
      const t = (clipW - wi) / (wj - wi);
      const x = cx[i] + (cx[j] - cx[i]) * t;
      const y = cy[i] + (cy[j] - cy[i]) * t;
      const u = (x / clipW) * 0.5 + 0.5;
      const v = (y / clipW) * 0.5 + 0.5;
      if (u < x0) x0 = u;
      if (v < y0) y0 = v;
      if (u > x1) x1 = u;
      if (v > y1) y1 = v;
      any = true;
    }
  }
  if (!any || x1 < 0 || y1 < 0 || x0 > 1 || y0 > 1) return false;
  out.x0 = Math.max(0, x0);
  out.y0 = Math.max(0, y0);
  out.x1 = Math.min(1, x1);
  out.y1 = Math.min(1, y1);
  return true;
}

/** smoothstep(near, nearFull, d): how much of a blade's light at distance d is subject to the march. */
export function marchWeight(d: number): number {
  return smoothstep(BLADE_GLOW_MARCH.near, BLADE_GLOW_MARCH.nearFull, d);
}

/**
 * The CPU copy of the shader's march, for tests. View space: P the surface (z < 0), n its unit
 * normal, Q the nearest point of the blade; z = -P.z. `depthAt(u, v)` returns the view depth
 * (positive metres) the screen holds at uv; the shader reads the texel under uv, the copy reads uv
 * directly. `jitter` is the ordered offset in steps (-0.5..0.5). Returns visibility 0..1.
 */
export function marchVisibility(
  P: Vec3Like,
  n: Vec3Like,
  Q: Vec3Like,
  z: number,
  depthAt: (u: number, v: number) => number,
  tanHalfFov: { x: number; y: number },
  near: number,
  jitter = 0,
): number {
  const M = BLADE_GLOW_MARCH;
  const lift = M.bias + M.biasPerM * z;
  const sx = P.x + n.x * lift;
  const sy = P.y + n.y * lift;
  const sz0 = P.z + n.z * lift;
  const gx = Q.x - sx;
  const gy = Q.y - sy;
  const gz = Q.z - sz0;
  const len = Math.sqrt(gx * gx + gy * gy + gz * gz);
  const span = len - M.skipEnd;
  if (span <= M.minSpan) return 1;
  const dx = gx / len;
  const dy = gy / len;
  const dz = gz / len;
  const stepLen = span / M.steps;
  const thick = Math.max(M.thickMin, M.thickSteps * stepLen);
  const nearest = Math.min(-sz0, -Q.z) - M.slack;
  let vis = 1;
  for (let s = 0; s < M.steps; s++) {
    const t = (s + 0.5 + jitter) * stepLen;
    const Sx = sx + dx * t;
    const Sy = sy + dy * t;
    const Sz = sz0 + dz * t;
    const depth = -Sz;
    // Behind the eye from here on, or off screen: neither comes back along a straight path.
    if (depth <= near) break;
    const u = (Sx / (depth * tanHalfFov.x)) * 0.5 + 0.5;
    const v = (Sy / (depth * tanHalfFov.y)) * 0.5 + 0.5;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) break;
    const bz = depthAt(u, v);
    const diff = depth - bz;
    const margin = M.margin + M.marginPerM * depth;
    const o = smoothstep(margin, margin + M.soft, diff) * (1 - smoothstep(thick, thick + M.thickRamp, diff)) * smoothstep(nearest - M.slackRamp, nearest, bz);
    vis = Math.min(vis, 1 - o);
    if (vis <= 0) break;
  }
  return vis;
}
