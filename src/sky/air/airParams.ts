// The air's record (the GPU port's pass 2, wave 1, the design's 2.1): one set of numbers per world, and per weather row
// through the fit (`airFit.ts`), from which the sky, the sun's colour, the ambient and the haze are all worked out. Pure:
// plain numbers in kept typed arrays, so the main thread's twin, the fit's worker and the node tests run this very code.
//
// The method is Hillaire's ("A Scalable and Production Ready Sky and Atmosphere Rendering Technique", 2020), as the MIT
// ports the design names carry it (pmndrs/sky, Dennis Smolek; webgpu-sky-atmosphere, Lukas Herzberger: see CREDITS.md);
// the numbers below are the physical constants that method is published with, written here in our own record.
//
// Units: kilometres and coefficients per kilometre (`airApi.ts`).
import { casterOf, kelvinToLinear as starKelvinToLinear, type SunSpec } from '../stars.ts';

/** A record: the air's numbers in one kept array, laid out by `F`. */
export type AirRecord = Float64Array;

/** Where each number of a record sits. */
export const F = {
  /** The planet's radius and the top of its air, km from the centre. */
  bottom: 0,
  top: 1,
  /** Rayleigh scattering at the surface, per km, red, green and blue (the blue of clear air); and its scale height, km. */
  rayR: 2,
  rayG: 3,
  rayB: 4,
  rayH: 5,
  /** Mie scattering and absorption at the surface, per km (haze and dust; grey), its scale height, km, and its phase's g. */
  mieS: 6,
  mieA: 7,
  mieH: 8,
  mieG: 9,
  /** Ozone's absorption at its peak, per km, red, green and blue (twilight's blue), its peak's height and half width, km. */
  ozR: 10,
  ozG: 11,
  ozB: 12,
  ozC: 13,
  ozW: 14,
  /** The ground's albedo, red, green and blue: the light it bounces back up into the air. */
  groundR: 15,
  groundG: 16,
  groundB: 17,
  /** The sun's colour at the top of the air (linear, luminance 1), its strength (1 is our sun's) and its angular radius, radians. */
  sunR: 18,
  sunG: 19,
  sunB: 20,
  sunStrength: 21,
  sunRadius: 22,
  /** The share of the world's clear-day visibility this row has (1 a clear row, less for weather): the fit's, from `sky.json`'s fog. */
  visShare: 23,
  /** The Mie's single-scattering albedo: what share of the light a haze particle meets it scatters rather than absorbs. */
  mieAlbedo: 24,
} as const;

/** How many numbers a record holds. */
export const AIR_FIELD_COUNT = 25;

/**
 * Hillaire's Earth, the published constants of the method (2020, its section 3 and the reference code's defaults): a
 * 6,360 km planet under 100 km of air, Rayleigh (5.802, 13.558, 33.1) per Mm with an 8 km scale height, Mie scattering
 * 3.996 and absorption 4.40 per Mm with 1.2 km and a phase g of 0.8, ozone (0.650, 1.881, 0.085) per Mm in a tent 30 km
 * wide about 25 km. The Mie here is replaced by the world's visibility (`setVisibility`) before anything draws.
 */
export const EARTH = {
  bottom: 6360,
  top: 6460,
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3] as const,
  rayleighHeight: 8,
  mieScatter: 3.996e-3,
  mieAbsorb: 4.4e-3,
  mieHeight: 1.2,
  mieG: 0.8,
  ozone: [0.65e-3, 1.881e-3, 0.085e-3] as const,
  ozoneCentre: 25,
  ozoneHalfWidth: 15,
};

/** Koschmieder's constant: a dark thing's contrast falls to 2% (the meteorological visibility) at `3.912 / extinction`. */
export const KOSCHMIEDER = 3.912;

/** Linear sRGB's luminance weights (Rec. 709). */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

/** A fresh record at Hillaire's Earth, a grey ground of 0.25, a white sun of our strength and size, a clear row. */
export function newAirRecord(): AirRecord {
  const r = new Float64Array(AIR_FIELD_COUNT);
  r[F.bottom] = EARTH.bottom;
  r[F.top] = EARTH.top;
  r[F.rayR] = EARTH.rayleigh[0];
  r[F.rayG] = EARTH.rayleigh[1];
  r[F.rayB] = EARTH.rayleigh[2];
  r[F.rayH] = EARTH.rayleighHeight;
  r[F.mieS] = EARTH.mieScatter;
  r[F.mieA] = EARTH.mieAbsorb;
  r[F.mieH] = EARTH.mieHeight;
  r[F.mieG] = EARTH.mieG;
  r[F.ozR] = EARTH.ozone[0];
  r[F.ozG] = EARTH.ozone[1];
  r[F.ozB] = EARTH.ozone[2];
  r[F.ozC] = EARTH.ozoneCentre;
  r[F.ozW] = EARTH.ozoneHalfWidth;
  r[F.groundR] = r[F.groundG] = r[F.groundB] = 0.25;
  r[F.sunR] = r[F.sunG] = r[F.sunB] = 1;
  r[F.sunStrength] = 1;
  // Our sun from the ground: 0.2666 degrees across its half.
  r[F.sunRadius] = (0.2666 * Math.PI) / 180;
  r[F.visShare] = 1;
  r[F.mieAlbedo] = 0.9;
  return r;
}

/** One record copied into another. */
export function copyRecord(from: AirRecord, to: AirRecord): void {
  for (let i = 0; i < AIR_FIELD_COUNT; i++) to[i] = from[i];
}

/** The air's extinction at the surface in the green, per km (what the eye's visibility is judged by). */
export function groundExtinctionG(r: AirRecord): number {
  return r[F.rayG] + r[F.mieS] + r[F.mieA];
}

/**
 * The haze set to a meteorological visibility (km): the Mie's extinction at the surface is whatever, added to the clear
 * air's own Rayleigh in the green, falls a dark thing's contrast to 2% at that distance, split into scattering and
 * absorption by the record's single-scattering albedo. Air clearer than Rayleigh alone allows (beyond 288 km on Earth's)
 * leaves no haze at all.
 */
export function setVisibility(r: AirRecord, visibilityKm: number): void {
  const v = visibilityKm > 0.05 ? visibilityKm : 0.05;
  const want = KOSCHMIEDER / v - r[F.rayG];
  const ext = want > 0 ? want : 0;
  const a = r[F.mieAlbedo];
  r[F.mieS] = ext * a;
  r[F.mieA] = ext * (1 - a);
}

/** The meteorological visibility a record's surface air gives, km (`setVisibility`'s inverse). */
export function visibilityOf(r: AirRecord): number {
  const e = groundExtinctionG(r);
  return e > 0 ? KOSCHMIEDER / e : 1e6;
}

// ---------------------------------------------------------------- the sun

const starRgb = [1, 1, 1];

/**
 * A star's numbers written into a record (`src/sky/stars.ts`'s, so the disc the sky draws and the light the air sends are
 * one star's): its temperature's colour (the star table's own black body, luminance 1), its strength against its system's
 * caster and its disc's angular radius.
 */
export function setStar(r: AirRecord, star: SunSpec): void {
  starKelvinToLinear(star.kelvin, starRgb);
  r[F.sunR] = starRgb[0];
  r[F.sunG] = starRgb[1];
  r[F.sunB] = starRgb[2];
  r[F.sunStrength] = star.strength > 0 ? star.strength : 0;
  r[F.sunRadius] = star.radiusDeg > 0 ? (star.radiusDeg * Math.PI) / 180 : r[F.sunRadius];
}

// ---------------------------------------------------------------- each world's own numbers

/**
 * What differs between the worlds before any fit: the ground's albedo (the light the land bounces into the air from
 * below) and the haze's single-scattering albedo (dust and ash absorb more than water haze) and its phase's g. Physical
 * properties of the ground and the air, not looks: the looks are the fit's and the owner's dials; the star is the star
 * table's (`src/sky/stars.ts`). A world not named here takes `DEFAULT_WORLD`.
 */
export interface AirWorld {
  ground: readonly [number, number, number];
  mieAlbedo: number;
  mieG: number;
}

/** A temperate world: a mixed land of 0.2 albedo, continental haze (0.9 scattering, g 0.8). */
export const DEFAULT_WORLD: AirWorld = { ground: [0.2, 0.2, 0.2], mieAlbedo: 0.9, mieG: 0.8 };

export const AIR_WORLDS: Record<string, AirWorld> = {
  // Sand and rock: a bright warm ground; desert dust absorbs a little more and scatters forward less than water haze.
  tatooine: { ground: [0.4, 0.33, 0.24], mieAlbedo: 0.85, mieG: 0.7 },
  // Grass and forest under wet air.
  naboo: { ground: [0.12, 0.15, 0.09], mieAlbedo: 0.95, mieG: 0.8 },
  rori: { ground: [0.12, 0.15, 0.09], mieAlbedo: 0.95, mieG: 0.8 },
  corellia: { ground: [0.16, 0.17, 0.12], mieAlbedo: 0.92, mieG: 0.8 },
  dantooine: { ground: [0.2, 0.2, 0.13], mieAlbedo: 0.9, mieG: 0.8 },
  talus: { ground: [0.15, 0.16, 0.12], mieAlbedo: 0.9, mieG: 0.8 },
  // Forest moons and worlds: a dark green ground under humid haze.
  endor: { ground: [0.09, 0.12, 0.07], mieAlbedo: 0.95, mieG: 0.8 },
  yavin4: { ground: [0.09, 0.12, 0.07], mieAlbedo: 0.95, mieG: 0.8 },
  kashyyyk: { ground: [0.08, 0.11, 0.06], mieAlbedo: 0.95, mieG: 0.8 },
  // Red rock and dust.
  dathomir: { ground: [0.25, 0.14, 0.1], mieAlbedo: 0.85, mieG: 0.75 },
  // Grey rock and lava fields.
  lok: { ground: [0.18, 0.17, 0.15], mieAlbedo: 0.88, mieG: 0.75 },
  // Black rock under ash, which absorbs much of what it meets.
  mustafar: { ground: [0.07, 0.06, 0.06], mieAlbedo: 0.7, mieG: 0.7 },
  // Snow: most of the light goes back up.
  adventure2: { ground: [0.8, 0.82, 0.85], mieAlbedo: 0.95, mieG: 0.8 },
};

/** A world's own numbers (`AIR_WORLDS`, else `DEFAULT_WORLD`). */
export function airWorldOf(planetId: string): AirWorld {
  return AIR_WORLDS[planetId] ?? DEFAULT_WORLD;
}

/** A world's base record before any fit: Hillaire's Earth with the world's ground, haze and casting star. */
export function worldRecord(planetId: string, out: AirRecord = newAirRecord()): AirRecord {
  const w = airWorldOf(planetId);
  const fresh = newAirRecord();
  copyRecord(fresh, out);
  out[F.groundR] = w.ground[0];
  out[F.groundG] = w.ground[1];
  out[F.groundB] = w.ground[2];
  out[F.mieAlbedo] = w.mieAlbedo;
  out[F.mieG] = w.mieG;
  setStar(out, casterOf(planetId));
  return out;
}

// ---------------------------------------------------------------- the owner's dials per world

/**
 * The owner's two dials per world (his answers of 20 and 21 November): the clear-day visibility and the steer toward
 * SWG's colours. Feel is his; these are where they start.
 *   - **visibilityKm: 40.** The design's clear day (2.2, "visibility starts at 40 km on a clear day"): the meteorological
 *     range of a very clear day on Earth, which is the physical value the record's haze is set to before he moves it.
 *     Weather scales from wherever it stands (each row's `visShare`), so a dial set nearer takes the storms nearer too.
 *   - **steer: 0.** Realism first (his answer): 0 draws the physical air alone; 1 bends the sky's light to SWG's colour
 *     of the hour channel by channel.
 */
export interface AirDialRow {
  visibilityKm: number;
  steer: number;
}

export const AIR_DIAL_START: AirDialRow = { visibilityKm: 40, steer: 0 };

/** The dials as they stand, by world id; a world never moved reads the start. */
export const AIR_DIALS: Record<string, AirDialRow> = {};

/** A world's dials (made at the start on first ask, so the menu's rows always have something to read). */
export function airDialsOf(planetId: string): AirDialRow {
  let d = AIR_DIALS[planetId];
  if (!d) {
    d = { visibilityKm: AIR_DIAL_START.visibilityKm, steer: AIR_DIAL_START.steer };
    AIR_DIALS[planetId] = d;
  }
  return d;
}

/** The dials' ranges (the sliders'), and what a value outside is held to. */
export const AIR_DIAL_RANGE = { visibilityKm: [0.2, 300] as const, steer: [0, 1] as const };

/** A count the dials move by, so a reader can tell the numbers moved without comparing them (the tables' rebuild). */
export const AIR_DIAL_STATE = { version: 0 };

/**
 * The dials moved as the console line writes them (`{ tatooine: { visibilityKm: 25, steer: 0.2 } }`): each held to its
 * range; words for anything held or refused.
 */
export function tuneAirDials(o: Record<string, unknown>): string[] {
  const words: string[] = [];
  if (!o || typeof o !== 'object') return ['the air dials take { <world>: { visibilityKm, steer } }'];
  for (const [id, v] of Object.entries(o)) {
    if (!v || typeof v !== 'object') {
      words.push(`${id}: not a row`);
      continue;
    }
    const row = airDialsOf(id);
    const vv = v as Record<string, unknown>;
    for (const key of ['visibilityKm', 'steer'] as const) {
      if (vv[key] === undefined) continue;
      const n = Number(vv[key]);
      if (!Number.isFinite(n)) {
        words.push(`${id}.${key}: not a number`);
        continue;
      }
      const [lo, hi] = AIR_DIAL_RANGE[key];
      const held = n < lo ? lo : n > hi ? hi : n;
      if (held !== n) words.push(`${id}.${key} held to ${held}`);
      row[key] = held;
    }
    for (const k of Object.keys(vv)) if (k !== 'visibilityKm' && k !== 'steer') words.push(`${id}.${k}: no such dial (visibilityKm, steer)`);
  }
  AIR_DIAL_STATE.version++;
  return words;
}

// ---------------------------------------------------------------- blending and moving

/**
 * Records blended by weight into `out` (the weather's four rows at most, weights summing to 1): numbers, never colours
 * (the design's 2.1). The sun's colour is blended too and put back to luminance 1. `n` of `recs` and `weights` are read.
 */
export function blendRecords(out: AirRecord, recs: readonly AirRecord[], weights: ArrayLike<number>, n: number): void {
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i] > 0 ? weights[i] : 0;
  if (!(total > 0)) {
    if (n > 0) copyRecord(recs[0], out);
    return;
  }
  for (let f = 0; f < AIR_FIELD_COUNT; f++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const w = weights[i] > 0 ? weights[i] : 0;
      s += recs[i][f] * w;
    }
    out[f] = s / total;
  }
  const lum = LUMA_R * out[F.sunR] + LUMA_G * out[F.sunG] + LUMA_B * out[F.sunB];
  if (lum > 0) {
    out[F.sunR] /= lum;
    out[F.sunG] /= lum;
    out[F.sunB] /= lum;
  }
}

/**
 * Whether two records differ by more than `share` of either's value in any number (the slow tables are drawn again only
 * when one does, the design's 2.1). Nought differs from nought by nothing.
 */
export function recordMoved(a: AirRecord, b: AirRecord, share: number): boolean {
  for (let f = 0; f < AIR_FIELD_COUNT; f++) {
    const x = a[f];
    const y = b[f];
    if (x === y) continue;
    const ax = x < 0 ? -x : x;
    const ay = y < 0 ? -y : y;
    const m = ax > ay ? ax : ay;
    const d = x - y;
    if ((d < 0 ? -d : d) > share * m) return true;
  }
  return false;
}

/** A record as plain numbers (the console's and the report's), rounded. */
export function recordWords(r: AirRecord): Record<string, unknown> {
  const n = (v: number, d = 4) => Number(v.toPrecision(d));
  return {
    planetKm: [n(r[F.bottom], 6), n(r[F.top], 6)],
    rayleighPerKm: [n(r[F.rayR]), n(r[F.rayG]), n(r[F.rayB])],
    rayleighHeightKm: n(r[F.rayH]),
    miePerKm: { scatter: n(r[F.mieS]), absorb: n(r[F.mieA]), heightKm: n(r[F.mieH]), g: n(r[F.mieG]) },
    ozonePerKm: [n(r[F.ozR]), n(r[F.ozG]), n(r[F.ozB])],
    ozoneAtKm: [n(r[F.ozC]), n(r[F.ozW])],
    ground: [n(r[F.groundR], 3), n(r[F.groundG], 3), n(r[F.groundB], 3)],
    sun: { colour: [n(r[F.sunR], 3), n(r[F.sunG], 3), n(r[F.sunB], 3)], strength: n(r[F.sunStrength], 3), radiusDeg: n((r[F.sunRadius] * 180) / Math.PI, 3) },
    visibilityKm: n(visibilityOf(r), 4),
    visShare: n(r[F.visShare], 3),
  };
}
