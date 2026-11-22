// The stars of a system's night sky (the GPU port's pass 2, wave 3; the design's 2.7): each system's own field, seeded by its
// name and drawn out of the galaxy's one density (`galaxyDensity.ts`) about the system's place on the galaxy map, so the
// faint stars crowd along the band they stand in and the near bright ones scatter over the whole sky, as a real sky's do.
//
//   - **Where**: candidates drawn in the density about the place (a column `CATALOGUE.reach` units across the plane and the
//     layer's height above and below it), each kept by the density's own odds; a star's direction is its place less the
//     system's, in the map's frame (the band's: `nightGpu.ts` turns both into the world's sky together).
//   - **How bright**: each a luminosity from a luminosity function (`CATALOGUE.lf`), so its brightness by its distance ranks
//     it among the others; the brightest `STAR_MOST` kept, and each given the magnitude its rank has under a real sky's
//     counts (`CATALOGUE.counts`: about three times as many stars a magnitude fainter, the twelve-thousandth at 6.8, a dark
//     site's naked-eye limit), so a tier's count reaches the magnitude a real eye's would.
//   - **What colour**: a temperature by its luminosity (blue and red giants among the bright, white and yellow stars between,
//     orange dwarfs among the faint), each seeded, through `stars.ts`'s black body.
//   - **How big**: a soft card of 2 to 3 pixels across (its half-power width), wider as it is brighter and a little wider as
//     it is cooler, its light the same whatever its size.
//
// The quality tiers draw the brightest 2,000 (Low), 4,000 (Medium), 8,000 (High) or 12,000 (Ultra) of one buffer
// (`nightTune.ts`'s counts), so a tier moved changes a count and builds nothing.
//
// Pure: no three, no DOM; the node test imports it. Worked once a system behind the loading screen (and kept for the session).

import { densityOf, NUM_OPS, hash2Number, numberParams, seeded, type DensityOut, type DensityParams } from './galaxyDensity.ts';
import { kelvinToLinear } from '../stars.ts';

/** The most stars a sky draws (Ultra's), and so the buffers' size. */
export const STAR_MOST = 12000;

/**
 * The catalogue's numbers (ours, each with its reason):
 *   - `reach` 120 units (about 950 parsecs at the map's 8 a unit): far enough that the faint end crowds the plane, near enough
 *     that the draw stays in the place's own stretch of the disc;
 *   - `candidates` two and a half times the most drawn, so the brightest kept are the luminous few of a larger volume;
 *   - `faintest` 6.8: the twelve-thousandth star's magnitude (a dark site's eye sees some twelve thousand to about 6.8);
 *   - `brightest` -1.6: no star brighter than the brightest of ours (Sirius, -1.46), so one near giant never outshines a planet;
 *   - `pcPerUnit` 8: the map's disc of 1,900 units read as the fifteen kiloparsecs of a galaxy's disc;
 *   - `lf`: absolute magnitudes from -6 to 6, the count rising tenfold every eight magnitudes toward the faint: the stars an eye
 *     sees are the luminous ones of a large volume (blue-white and orange giants and white stars) more than the near dwarfs;
 *   - `counts` 0.45: the slope of the count by magnitude (`N(< m) ∝ 10^(0.45 m)`), a real sky's from the first magnitude to
 *     the sixth (some 80 stars brighter than 2, 660 than 4, 5,200 than 6), the rank given its magnitude by it.
 */
export const CATALOGUE = { reach: 120, candidates: 2.5, faintest: 6.8, brightest: -1.6, pcPerUnit: 8, lf: { bright: -6, faint: 6, slope: 0.12 }, counts: 0.45 };

/** The magnitude of the `rank`-th brightest star (1 the brightest) under the counts' slope, the last kept at `faintest`. */
export function magnitudeOfRank(rank: number): number {
  const m = CATALOGUE.faintest + Math.log10(rank / STAR_MOST) / CATALOGUE.counts;
  return m < CATALOGUE.brightest ? CATALOGUE.brightest : m;
}

/** One system's stars, the brightest first: `star` x, y, z (a unit direction in the map's frame) and the magnitude; `tint` the colour (its luminance one) and a seed; `size` the card's width in pixels. */
export interface StarCatalogue {
  readonly key: string;
  readonly count: number;
  readonly star: Float32Array;
  readonly tint: Float32Array;
  readonly size: Float32Array;
  /** The magnitude each tier's count reaches to, by count. */
  readonly brightest: number;
  readonly faintest: number;
  /** How the draw went, for the console. */
  readonly tries: number;
  readonly ms: number;
}

/** A temperature's colour, worked once over the range the catalogue draws (log-spaced) and read by the nearest. */
const KELVIN_TABLE = (() => {
  const n = 96;
  const lo = Math.log(2400);
  const hi = Math.log(32000);
  const rgb = new Float32Array(n * 3);
  const c = [1, 1, 1];
  for (let i = 0; i < n; i++) {
    kelvinToLinear(Math.exp(lo + ((hi - lo) * i) / (n - 1)), c);
    rgb[i * 3] = c[0];
    rgb[i * 3 + 1] = c[1];
    rgb[i * 3 + 2] = c[2];
  }
  return { n, lo, hi, rgb };
})();

/** A temperature's colour (luminance one), into `out` at `at`. */
function kelvinInto(kelvin: number, out: Float32Array, at: number): void {
  const t = (Math.log(Math.max(2400, Math.min(32000, kelvin))) - KELVIN_TABLE.lo) / (KELVIN_TABLE.hi - KELVIN_TABLE.lo);
  const i = Math.round(t * (KELVIN_TABLE.n - 1)) * 3;
  out[at] = KELVIN_TABLE.rgb[i];
  out[at + 1] = KELVIN_TABLE.rgb[i + 1];
  out[at + 2] = KELVIN_TABLE.rgb[i + 2];
}

/** A star's temperature by its absolute magnitude and two fractions of its own (the kinds named at the top). */
export function kelvinOf(M: number, a: number, b: number): number {
  if (M < -3) return a < 0.6 ? 15000 + b * 15000 : 3400 + b * 800;
  if (M < 1) return a < 0.5 ? 9000 + b * 6000 : a < 0.8 ? 4000 + b * 800 : 7000 + b * 2000;
  if (M < 4) return 5800 + b * 1700;
  return 3500 + b * 2300;
}

/** A card's width in pixels (its half-power width) by its magnitude and temperature: 2 to 3. */
export function cardSize(m: number, kelvin: number): number {
  const byLight = Math.min(1, Math.max(0, (3 - m) / 5));
  const byColour = kelvin >= 10000 ? -0.15 : kelvin <= 4000 ? 0.15 : 0;
  const s = 2 + byLight + byColour;
  return s < 2 ? 2 : s > 3 ? 3 : s;
}

/** A name's seed (FNV-1a), so a system's sky is the same in every session and every browser. */
export function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The catalogues worked this session, by key (a system's sky is the same at every arrival). */
const MADE = new Map<string, StarCatalogue>();

/**
 * A system's stars (`key` its id, `place` where it stands in the map's frame), the brightest `STAR_MOST`, worked once a
 * session. The draw: candidates uniform across a column about the place and over the layer's height, each kept with the
 * density's odds against the column's largest value, then given a luminosity and so a magnitude by its distance.
 */
export function catalogueOf(key: string, place: { x: number; y: number; z: number }, p: DensityParams<number> = numberParams()): StarCatalogue {
  const sig = `${key}|${place.x.toFixed(2)}|${place.y.toFixed(2)}|${place.z.toFixed(2)}|${p.radius}|${p.arms}|${p.thick}`;
  const had = MADE.get(sig);
  if (had) return had;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rnd = seeded(seedOf(key));
  const C = CATALOGUE;
  const want = Math.round(STAR_MOST * C.candidates);
  const R = C.reach;
  const r0 = Math.sqrt(place.x * place.x + place.z * place.z) / p.radius;
  const h0 = p.thick * (1.2 - Math.min(1, r0)) * 0.29;
  const yLo = Math.min(place.y, 0) - 4 * h0;
  const yHi = Math.max(place.y, 0) + 4 * h0;
  const d: DensityOut<number> = { emit: 0, warm: 0, dust: 0 };
  // The column's largest density, from a scan, a little over.
  let most = 0;
  for (let i = 0; i < 4096; i++) {
    const a = rnd() * 2 * Math.PI;
    const rr = R * Math.sqrt(rnd());
    densityOf(NUM_OPS, place.x + Math.cos(a) * rr, yLo + rnd() * (yHi - yLo), place.z + Math.sin(a) * rr, p, d);
    if (d.emit > most) most = d.emit;
  }
  // The layer's own middle, which a scan may step past.
  densityOf(NUM_OPS, place.x, 0, place.z, p, d);
  most = Math.max(most, d.emit) * 1.25;
  const dir = new Float32Array(want * 3);
  const mag = new Float32Array(want);
  const absM = new Float32Array(want);
  const lf = C.lf;
  const k = Math.LN10 * lf.slope;
  const e0 = Math.exp(k * lf.bright);
  const e1 = Math.exp(k * lf.faint);
  let tries = 0;
  for (let n = 0; n < want; n++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (;;) {
      tries++;
      const a = rnd() * 2 * Math.PI;
      const rr = R * Math.sqrt(rnd());
      x = Math.cos(a) * rr;
      z = Math.sin(a) * rr;
      y = yLo + rnd() * (yHi - yLo) - place.y;
      densityOf(NUM_OPS, place.x + x, place.y + y, place.z + z, p, d);
      if (rnd() * most <= d.emit) break;
    }
    const dist = Math.max(0.5, Math.sqrt(x * x + y * y + z * z));
    dir[n * 3] = x / dist;
    dir[n * 3 + 1] = y / dist;
    dir[n * 3 + 2] = z / dist;
    const M = Math.log(e0 + rnd() * (e1 - e0)) / k;
    absM[n] = M;
    mag[n] = M + 5 * Math.log10((dist * C.pcPerUnit) / 10);
  }
  // The brightest kept, each given its rank's magnitude under a real sky's counts.
  const order = Array.from({ length: want }, (_, i) => i).sort((a, b) => mag[a] - mag[b]);
  const count = STAR_MOST;
  const star = new Float32Array(count * 4);
  const tint = new Float32Array(count * 4);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const j = order[i];
    const m = magnitudeOfRank(i + 1);
    star[i * 4] = dir[j * 3];
    star[i * 4 + 1] = dir[j * 3 + 1];
    star[i * 4 + 2] = dir[j * 3 + 2];
    star[i * 4 + 3] = m;
    const a = hash2Number(j, 7);
    const b = hash2Number(j, 13);
    const kelvin = kelvinOf(absM[j], a, b);
    kelvinInto(kelvin, tint, i * 4);
    tint[i * 4 + 3] = hash2Number(j, 29);
    size[i] = cardSize(m, kelvin);
  }
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  const cat: StarCatalogue = { key, count, star, tint, size, brightest: star[3], faintest: star[(count - 1) * 4 + 3], tries, ms };
  MADE.set(sig, cat);
  return cat;
}

/** The magnitude of the faintest star a tier's count draws. */
export function faintestOf(cat: StarCatalogue, count: number): number {
  const n = Math.max(1, Math.min(cat.count, Math.round(count)));
  return cat.star[(n - 1) * 4 + 3];
}

// ---------------------------------------------------------------- what an eye sees, and a star's light

/**
 * The faintest star a dark-adapted eye sees against a background of `cd` candelas a square metre (Schaefer's fit, 1990/1993,
 * of Hecht's threshold): `7.93 âˆ’ 5 log10(10^(4.316 âˆ’ b/5) + 1)` with `b` the background in magnitudes a square arcsecond,
 * which is `7.93 âˆ’ 5 log10(63.0 âˆšcd + 1)`. A dark site (2e-4 cd/mÂ²) reaches 6.6, a full moon's sky (5e-3) 4.2, twilight
 * (0.3) 2.2, a blue day sky (8000) âˆ’10.8: the card's `seen` reads it per star (`nightGpu.ts`), so a star shows only where a
 * real eye would see it, day and night and beside a city's glow.
 */
export function limitingMag(cd: number): number {
  return 7.93 - 5 * Math.log10(63.0 * Math.sqrt(cd > 0 ? cd : 0) + 1);
}

/** The constant of `limitingMag`: `10^4.316 / âˆš(10.8e4)`, the background's term of a candela. */
export const LIMIT_K = Math.pow(10, 4.316) / Math.sqrt(10.8e4);

/**
 * A star's light at the top of the air, in the scene's units of illuminance, for a magnitude `m` and the scene's units
 * `sceneUnits` (`AIR_UNITS.scene`, the top-of-air sun's light): the sun's `10^(âˆ’0.4 (m + 26.74))` of it (the sun's own
 * magnitude âˆ’26.74).
 */
export function starLight(m: number, sceneUnits: number): number {
  return sceneUnits * Math.pow(10, -0.4 * (m + 26.74));
}
