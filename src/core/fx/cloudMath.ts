// The cloud march's numbers, and the density rule written out once in plain arithmetic.
//
// It is a module of its own for the same reason the blade glow's, the grade's and the lens's are:
// the rule that decides how much cloud is at a point has to be evaluated in three places -- in the
// shader, which is a string; in the converter, which calibrates the coverage against the volume it
// has just written; and in a node test, which checks the two agree. One copy of the numbers and one
// copy of the arithmetic, with the shader's own text checked against them, is the only way that
// stays true. Nothing here imports three, so the converter and the tests can read it under node.

/**
 * Every invented number of the march. The client had no volume at all, so all of it is ours; the
 * shape of the technique is published, the numbers it is tuned to here are not. Live through
 * `__debug.clouds`, and the ones the shader bakes in rebuild its program when they move.
 */
export const CLOUD_MARCH = {
  /**
   * Where the deck sits, in metres, at the sheets' own altitudes and in the same frame they hang
   * in: the world's, not the camera's.
   *
   * It rode the camera at first, on the reasoning that a world whose ground climbs a kilometre
   * would otherwise have cloud underfoot. That is wrong twice over. The client's own sheets hang at
   * a fixed height (their group sits at zero and each sheet at its altitude), so a deck that
   * follows the eye is not the deck the sheets were in; and a deck always exactly fifteen hundred
   * metres overhead is one no ship can ever climb into, which is most of the point of having a
   * volume at all. Cloud underfoot on a high plateau is the price, and it is the client's price too.
   */
  bottom: 1500,
  top: 2300,
  /** How far along the ray to bother, in metres. Past this the haze has the sky anyway. */
  reach: 26000,
  /** Steps through the slab, and steps toward the sun from each of them. The cost, in two numbers. */
  steps: 64,
  lightSteps: 5,
  /** Metres per unit of the base volume, and of the detail volume. */
  baseScale: 4200,
  detailScale: 260,
  /** How hard the detail eats the edge of the shape. */
  detailBite: 0.32,
  /** How hard the base volume's own erosion channels eat it, before the detail does. */
  erodeBite: 0.35,
  /** Scattering: forward, backward, and how they are mixed. Two lobes, as cloud needs. */
  gForward: 0.72,
  gBackward: -0.24,
  gMix: 0.42,
  /** How thick a metre of cloud is. */
  density: 0.055,
  /** Sun-ward extinction, and the powder term that keeps a lit edge from reading as a flat card. */
  lightDensity: 0.9,
  powder: 0.42,
  /** How much of the sky's ambient a cloud picks up, top and bottom. */
  ambientTop: 0.55,
  ambientBottom: 0.22,
  /** How far the deck fades out at its own floor and ceiling, as a share of its depth. */
  feather: 0.22,
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The deck's own profile, 0 at its floor and ceiling and widest through the middle. A cloud is not
 * a brick: it is narrow at the bottom where it is forming and frayed at the top. Two decks get a
 * second, thinner sheet above.
 */
export function profileAt(h: number, decks: number, tune = CLOUD_MARCH): number {
  const low = smoothstep(0, tune.feather, h) * smoothstep(1, 1 - tune.feather * 1.6, h);
  if (decks < 1.5) return low;
  const split = smoothstep(0.52, 0.62, h);
  return mix(low, low * 0.75 + smoothstep(0.6, 0.72, h) * smoothstep(1, 0.86, h) * 0.6, split);
}

/** The base volume's three erosion channels weighed into one, and the detail volume's likewise. */
export const erodeOf = (g: number, b: number, a: number): number => g * 0.625 + b * 0.25 + a * 0.125;

/**
 * How much cloud is at a point, from the two volumes already sampled there: the billow cut to the
 * coverage, eaten by the base's own erosion channels, shaped by the deck's profile, then eaten
 * again by the detail, harder at the top where a cloud frays.
 *
 * `base` is the four channels of the base volume and `detail` the three of the detail volume; pass
 * `null` for the detail to get the cheap answer the sun-ward steps use.
 */
export function densityFrom(base: readonly number[], detail: readonly number[] | null, h: number, cut: number, decks: number, tune = CLOUD_MARCH): number {
  let shape = (base[0] - cut) / Math.max(1e-3, 1 - cut);
  if (shape <= 0) return 0;
  shape = clamp01(shape - (1 - erodeOf(base[1], base[2], base[3])) * tune.erodeBite) * profileAt(h, decks, tune);
  if (shape <= 0 || !detail) return shape;
  return clamp01(shape - (1 - erodeOf(detail[0], detail[1], detail[2])) * tune.detailBite * mix(0.4, 1, h));
}

/**
 * The cut at which this texel's cloud vanishes, from the base volume alone.
 *
 * It is the one line that makes the coverage calibration cheap enough to do over a whole volume:
 * a texel is cloud when `(r - cut) / (1 - cut)` is still above what its own erosion takes off, so
 * solving for the cut at which those two are equal gives, per texel, exactly the threshold it
 * survives up to. The share of the deck that is cloud at a given cut is then the share of texels
 * whose vanishing cut is above it -- one sort instead of a march per candidate.
 */
export function vanishingCut(base: readonly number[], tune = CLOUD_MARCH): number {
  const e = (1 - erodeOf(base[1], base[2], base[3])) * tune.erodeBite;
  return (base[0] - e) / (1 - e);
}

/** One texel of an RGBA volume, wrapped, without interpolation: what a calibration sweep needs. */
export function volumeTexel(buf: Uint8Array, size: number, x: number, y: number, z: number, out: number[]): number[] {
  const wrap = (i: number): number => ((i % size) + size) % size;
  const o = ((wrap(z) * size + wrap(y)) * size + wrap(x)) * 4;
  out[0] = buf[o] / 255;
  out[1] = buf[o + 1] / 255;
  out[2] = buf[o + 2] / 255;
  out[3] = buf[o + 3] / 255;
  return out;
}

/** A cut and the share of sky it really fills, as the calibration measured it off the volume. */
export interface CoverPoint {
  cut: number;
  sky: number;
}

/**
 * The cut that gives this share of sky, read off a curve the converter measured.
 *
 * **Why a measured curve and not arithmetic.** Coverage is a share of sky and the march turns it
 * into a threshold on the billow channel, and three things stand between the two. The billow does
 * not fill nought to one (measured, it lies between 0.576 and 0.898), so a cut of `1 - coverage` is
 * a cliff. The erosion and the detail then eat most of what survives the cut, so a cut placed by
 * the billow's own ends alone under-delivers badly at the thin end -- a world asking for a quarter
 * of the sky got almost none, which is sixteen of the game's eighteen worlds. And a ray crosses
 * eight hundred metres of deck, so the share of sky a ray finds cloud in is far higher than the
 * share of the volume that is cloud. None of the three is arithmetic anybody should be doing in
 * their head, so the converter marches the real volume at a set of cuts, writes down what share of
 * sky each one filled, and this reads that table backwards.
 *
 * The curve runs from the most cloud to the least, which is the order the cuts rise in.
 */
export function cutForCover(coverage: number, curve: readonly CoverPoint[]): number {
  const want = clamp01(coverage);
  if (curve.length === 0) return 1;
  if (want >= curve[0].sky) return curve[0].cut;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (want >= b.sky) {
      const span = a.sky - b.sky;
      const t = span > 1e-6 ? (want - b.sky) / span : 0;
      return b.cut + (a.cut - b.cut) * t;
    }
  }
  return curve[curve.length - 1].cut;
}
