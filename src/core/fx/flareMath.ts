// The lens flare's arithmetic, with nothing imported: the pass, the sky and the world read it, and
// a plain node script (tools/swg/tests/flare.test.ts) checks it without a browser. Which sky bodies
// flare, how big they are on screen, how the occlusion tells sky from something in front of it,
// how deep into a cloud sheet's mip chain to sample, and the composite's promise that it never
// pushes a pixel into white are all here, so the shader and its test cannot drift apart.

/** Most sources the pass follows at once (Tatooine's two suns; a space zone's two brightest stars). */
export const MAX_FLARE_SOURCES = 2;
/** Most cloud sheets the occlusion samples (the weather design's pool: two at each altitude). */
export const MAX_CLOUD_LAYERS = 4;
/** The client draws celestial quads 3 m in front of the camera: a body's size is a half-width there. */
export const CELESTIAL_DISTANCE = 3;
/** Share of a sun sprite's half-width the visible disc fills (sun_single.png: half brightness at 0.19). */
export const DISC_FILL = 0.2;
/** Share of a glow sprite's half-width that reads as bright (sunglow2.png: half brightness at 0.48). */
export const GLOW_FILL = 0.45;
/** Share of a star sprite's half-width its bright centre fills (starglow_back.png). */
export const STAR_DISC_FILL = 0.08;
/** Share of a star glow sprite's half-width that reads as bright (starglow, starglow_radial). */
export const STAR_GLOW_FILL = 0.5;
/** A second star group flares only when at least this bright relative to the first. */
export const SECOND_STAR_RATIO = 0.8;
/** Depth at or beyond this share of a body's sky distance counts as sky. */
export const SKY_SHARE = 0.98;
/** Occlusion taps reach at most this share of the screen height from the sun's centre. */
export const MAX_TAP_RADIUS_SHARE = 0.07;
/** How much full overcast takes off the sun's flare and rays. */
export const OVERCAST_DIMMING = 0.85;
/** The starburst's two spike sets, as the phase in cos(3a + phase): six primary spikes and six fainter between. */
export const SPIKE_PHASES = [0.3, 0.8236] as const;

export interface FlareCelestialLike {
  shader: string;
  size: number;
  glowSize: number;
  image: unknown;
  glowImage: unknown;
}
export interface StarSpriteLike {
  shader: string;
  size: number;
  yaw: number;
  pitch: number;
  image: unknown;
}
export interface StarGroup {
  yaw: number;
  pitch: number;
  backSize: number;
  glowSize: number;
  score: number;
  weight: number;
}

/** A sky body that flares: a sun shader with a disc and a glow (not Yavin's gas giant, not a moon, not an empty slot). */
export function isFlareBody(c: FlareCelestialLike | null | undefined): boolean {
  return !!c && !!c.image && !!c.glowImage && c.glowSize > 0 && /(^|\/)sun_[^/]*\.sht$/.test(c.shader);
}

/** Angular radius (radians) of the part of a sprite of `size` that `fill` of its half-width covers. */
export function angularRadius(size: number, fill: number): number {
  return Math.atan((size * fill) / CELESTIAL_DISTANCE);
}

/** Pixels on screen of an angular radius, for a vertical half field of view with this tangent. */
export function discPixels(angle: number, tanHalfFovY: number, heightPx: number): number {
  return (Math.tan(angle) / Math.max(1e-4, tanHalfFovY)) * heightPx * 0.5;
}

/**
 * A space zone's star groups (sprites sharing yaw and pitch), best first, at most MAX_FLARE_SOURCES.
 * A group flares only with a `starglow*` member; its score is its largest glow plus a quarter of its
 * largest `cels_star` back. The second group is kept only when nearly as bright as the first. Pass
 * only sprites that were made; one with no image is skipped anyway.
 */
export function rankStarGroups(sprites: readonly StarSpriteLike[]): StarGroup[] {
  const groups = new Map<string, StarGroup>();
  for (const s of sprites) {
    if (!s || !s.image) continue;
    const key = `${s.yaw}|${s.pitch}`;
    let g = groups.get(key);
    if (!g) {
      g = { yaw: s.yaw, pitch: s.pitch, backSize: 0, glowSize: 0, score: 0, weight: 0 };
      groups.set(key, g);
    }
    const size = s.size > 0 ? s.size : 0;
    if (s.shader.includes('starglow')) g.glowSize = Math.max(g.glowSize, size);
    else if (s.shader.includes('cels_star')) g.backSize = Math.max(g.backSize, size);
  }
  const list: StarGroup[] = [];
  for (const g of groups.values()) {
    if (!(g.glowSize > 0)) continue;
    g.score = g.glowSize + 0.25 * g.backSize;
    list.push(g);
  }
  list.sort((a, b) => b.score - a.score || a.yaw - b.yaw || a.pitch - b.pitch);
  const out: StarGroup[] = [];
  const first = list[0];
  if (!first) return out;
  first.weight = Math.min(1, Math.max(0.4, first.score));
  out.push(first);
  const second = list[1];
  if (MAX_FLARE_SOURCES > 1 && second && second.score >= SECOND_STAR_RATIO * first.score) {
    second.weight = (first.weight * second.score) / first.score;
    out.push(second);
  }
  return out;
}

/** Scale that brings a light colour's brightest channel to min(1, 1.3 x itself): the hue kept, a dim dusk light dimmer. 0 for black. */
export function tintScale(r: number, g: number, b: number): number {
  const m = Math.max(r, g, b);
  return m > 1e-3 ? Math.min(1, 1.3 * m) / m : 0;
}

/** A sun's fade as it meets the horizon (sky dome beyond the far terrain would otherwise show it below). */
export function elevationFade(y: number): number {
  const t = Math.min(1, Math.max(0, (y + 0.01) / 0.04));
  return t * t * (3 - 2 * t);
}

/** Share of the way to a new value in `dt` seconds for a time constant `tau`. */
export function smoothingRate(dt: number, tau: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau);
}

/** What overcast weather (0..1) leaves of the sun's flare and god rays. */
export function overcastFade(overcast: number): number {
  return 1 - OVERCAST_DIMMING * Math.min(1, Math.max(0, overcast));
}

/**
 * 1 minus the depth buffer's value (three's perspective, [0,1]) at a distance along the view axis.
 * The occlusion shader compares 1 - depth with this, which is exact to the depth buffer's steps even near the far plane.
 */
export function skyDepthGap(near: number, far: number, viewZ: number): number {
  return (near * (far - viewZ)) / (viewZ * (far - near));
}

/**
 * Mip level at which a cloud sheet's texel covers the sun disc's footprint on the sheet: the footprint is
 * 2 t tan(disc) across and that over dir.y along (t the distance along the sun's line to the sheet), taken as
 * their geometric mean. 0 when the sheet is not between the camera and the sun. Clamped to the texture's levels.
 */
export function cloudLod(sheetAltitude: number, cameraY: number, dirY: number, discRadius: number, repeat: number, texels: number): number {
  if (dirY <= 0.01) return 0;
  const t = (sheetAltitude - cameraY) / dirY;
  if (t <= 0) return 0;
  const across = 2 * t * Math.tan(discRadius);
  const footprint = across / Math.sqrt(dirY);
  const texel = repeat / Math.max(1, texels);
  return Math.min(Math.log2(Math.max(1, texels)), Math.max(0, Math.log2(footprint / texel)));
}

/** The composite's added exposed luminance, as the shader does it: nothing at or above the ceiling, less near it. */
export function flareAdd(luma: number, flareLuma: number, kneeStart: number, ceiling: number): number {
  // NaN and Inf too, as the shader: every comparison with NaN is false.
  if (!(flareLuma >= 1e-5 && flareLuma < 1e4)) return 0;
  const t = Math.min(1, Math.max(0, (luma - kneeStart) / (ceiling - kneeStart)));
  const knee = 1 - t * t * (3 - 2 * t);
  return Math.min(flareLuma * knee, Math.max(ceiling - luma, 0));
}

/** Which spike of a set an angle (radians, -pi..pi) belongs to, 0..5, as the shader picks its length: constant across a spike, changing only between spikes. */
export function spikeId(angle: number, phase: number): number {
  const k = Math.floor((3 * angle + phase) / Math.PI + 0.5);
  return k - 6 * Math.floor(k / 6);
}

/** The starburst's brightness at an angle and a radius (0..1 of its quad), as the shader draws it (test mirror; the shader's fxHash mirrored). */
export function burstProfile(angle: number, r: number): number {
  const hash = (x: number, y: number) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const len1 = 0.6 + 0.4 * hash(spikeId(angle, SPIKE_PHASES[0]), 7);
  const len2 = 0.6 + 0.4 * hash(spikeId(angle, SPIKE_PHASES[1]), 13);
  const s =
    Math.abs(Math.cos(3 * angle + SPIKE_PHASES[0])) ** 80 * Math.exp((-r / len1) * 4) +
    0.5 * Math.abs(Math.cos(3 * angle + SPIKE_PHASES[1])) ** 160 * Math.exp((-r / len2) * 4);
  const t = Math.min(1, Math.max(0, (r - 0.9) / 0.1));
  return s * (1 - t * t * (3 - 2 * t));
}

export const FLARE_KINDS = { core: 0, veil: 1, burst: 2, streak: 3, disc: 4, hex: 5, ring: 6 } as const;
export type FlareKind = (typeof FLARE_KINDS)[keyof typeof FLARE_KINDS];

export interface FlareElement {
  kind: FlareKind;
  /** Place along the axis through the screen centre: 1 on the sun, 0 at the centre, negative past it. */
  t: number;
  /** core: x disc radius; veil, burst: x glow radius (the burst capped by the look); streak: half-length in screen heights; ghosts: radius in screen heights. */
  size: number;
  /** Amplitude before the look's gain for its kind and the source's intensity. */
  amp: number;
  tint: readonly [number, number, number];
  /** Chromatic spread of a ghost's edge (share of its radius between the red and blue edges). */
  chroma: number;
}

export const FLARE_ELEMENTS: readonly FlareElement[] = [
  { kind: 0, t: 1, size: 2.5, amp: 1, tint: [1, 1, 1], chroma: 0 },
  { kind: 1, t: 1, size: 1, amp: 1, tint: [1, 0.95, 0.85], chroma: 0 },
  { kind: 2, t: 1, size: 3, amp: 1, tint: [1, 1, 1], chroma: 0 },
  { kind: 3, t: 1, size: 0.9, amp: 1, tint: [0.65, 0.8, 1], chroma: 0 },
  { kind: 4, t: 0.55, size: 0.035, amp: 0.1, tint: [1, 0.7, 0.4], chroma: 0.02 },
  { kind: 5, t: 0.25, size: 0.07, amp: 0.07, tint: [0.5, 1, 0.6], chroma: 0.03 },
  { kind: 4, t: -0.15, size: 0.025, amp: 0.12, tint: [0.7, 0.8, 1], chroma: 0.02 },
  { kind: 6, t: -0.4, size: 0.12, amp: 0.06, tint: [0.9, 0.6, 1], chroma: 0.04 },
  { kind: 5, t: -0.65, size: 0.05, amp: 0.08, tint: [1, 0.85, 0.5], chroma: 0.03 },
  { kind: 4, t: -1, size: 0.09, amp: 0.05, tint: [0.5, 0.75, 1], chroma: 0.03 },
  { kind: 6, t: -1.35, size: 0.2, amp: 0.035, tint: [1, 0.8, 0.6], chroma: 0.05 },
];

/** The look, tunable live from the console (not saved). Gains are at lensFlareStrength 1; the default strength 0.5 halves them. */
export interface FlareLook {
  core: number;
  veil: number;
  burst: number;
  streak: number;
  ghosts: number;
  /** Gaussian scale of the streak's thickness, screen heights. */
  streakThickness: number;
  /** Largest half-size of the starburst's quad, screen heights. */
  burstCap: number;
  /** Ghost gain on every source after the first one on screen. */
  secondaryGhosts: number;
  /** Exposed luminance where the composite starts adding less, and the ceiling it never lifts past. */
  kneeStart: number;
  ceiling: number;
  /** Time constants (s) for the visibility rising and falling. */
  rise: number;
  fall: number;
  /** Mustafar's night sun flares (the exception to "off at night"). */
  nightSuns: boolean;
  /** Show only the flare, on black. */
  debugOnly: boolean;
}

export const FLARE_LOOK_DEFAULTS: Readonly<FlareLook> = {
  core: 0.8,
  veil: 0.12,
  burst: 0.35,
  streak: 0.25,
  ghosts: 1,
  streakThickness: 0.0025,
  burstCap: 0.25,
  secondaryGhosts: 0.5,
  kneeStart: 0.3,
  ceiling: 0.9,
  rise: 0.05,
  fall: 0.08,
  nightSuns: true,
  debugOnly: false,
};
