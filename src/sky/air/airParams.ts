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
import { SMOKE_DIAL_NAMES, SMOKE_DIAL_RANGE, SMOKE_DIAL_START, SMOKE_NONE, hasSmoke, smokeInto, type SmokeDials } from '../look/airProfile.js';

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
  /**
   * Pass 2, wave 4a (the viewer's atmosphere wave B, appended as it appended them, `src/sky/look/airProfile.js`): the haze's
   * colour, each channel's Mie scattering as a share of `mieS` (its brightest 1; 1, 1, 1 a grey haze, the record as it was).
   * The haze's extinction stays grey (`mieS + mieA` in every channel): a channel it scatters less it absorbs more (scattering
   * `mieS · t`, absorption `mieA + mieS · (1 − t)`), as dust, ash and smoke do, so only the light the haze adds (the single
   * scattering and the multiple scattering's table) is coloured, and the sun through it is dimmed, never tinted.
   */
  mieTintR: 25,
  mieTintG: 26,
  mieTintB: 27,
  /**
   * Pass 2, wave 6: the second aerosol layer, smoke and ash, appended as the haze's colour was (`src/sky/look/airProfile.js`
   * lays the same twelve, `smokeInto`). Its extinction at the layer's peak, per km, red, green and blue: chromatic, by its
   * Angstrom exponent (`(lambda / 550)^-alpha` at the channels' 680, 550 and 440 nm), so the sun reddens through it where
   * the haze keeps its extinction grey.
   */
  smokeER: 28,
  smokeEG: 29,
  smokeEB: 30,
  /** Its scattering at the peak, per km (its extinction less its absorption: its single-scattering albedo by channel). */
  smokeSR: 31,
  smokeSG: 32,
  smokeSB: 33,
  /** The layer's middle and half depth above the ground, km (a tent, as the ozone's), and its phase's g. */
  smokeC: 34,
  smokeW: 35,
  smokeG: 36,
  /** The glow from below (the lava's upward light the air scatters back down), a share of a strength-1 sun at the top of the air, linear rgb. */
  glowR: 37,
  glowG: 38,
  glowB: 39,
} as const;

/** How many numbers a record holds (the game's 25 and, since pass 2's wave 4a, the haze's colour, and since wave 6 the smoke and ash). */
export const AIR_FIELD_COUNT = 40;
/** Pass 2, wave 6: the record's count before the smoke and ash (a record with none is the record of 28 as it was, and appended nought). */
export const HAZE_FIELD_COUNT = 28;

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
  // Pass 2, wave 4a: a grey haze, the record as it was.
  r[F.mieTintR] = r[F.mieTintG] = r[F.mieTintB] = 1;
  // Pass 2, wave 6: no smoke or ash and no glow (every number nought but the tent's finite shape: `SMOKE_NONE`).
  r[F.smokeC] = SMOKE_NONE.c;
  r[F.smokeW] = SMOKE_NONE.w;
  r[F.smokeG] = SMOKE_NONE.g;
  return r;
}

/**
 * Pass 2, wave 6: a world's smoke and ash and its glow from below laid into a record from its dials (`airProfile.js`'
 * `smokeInto`, the viewer's and the body path's own rule): a depth and a glow of nought is none, the record as it was.
 */
export function setSmoke(r: AirRecord, d: SmokeDials): void {
  smokeInto(r, d);
}

/** Whether a record carries any smoke, ash or glow (`airProfile.js`' `hasSmoke`). */
export function smokeOn(r: AirRecord): boolean {
  return hasSmoke(r);
}

/** A record's haze colour set (pass 2, wave 4a): each channel's share of the Mie scattering, held to [0, 1]. */
export function setHazeTint(r: AirRecord, red: number, green: number, blue: number): void {
  r[F.mieTintR] = red > 0 ? (red < 1 ? red : 1) : 0;
  r[F.mieTintG] = green > 0 ? (green < 1 ? green : 1) : 0;
  r[F.mieTintB] = blue > 0 ? (blue < 1 ? blue : 1) : 0;
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
  // Pass 2, wave 4b (maker A): the fields his saved air names for this world (none with no file: the record as before).
  const ff = AIR_FILE_FIELDS[planetId];
  if (ff) applyAirFileFields(out, ff);
  return out;
}

// ---------------------------------------------------------------- his saved air's own fields (pass 2, wave 4b)

/**
 * The record fields a world's saved air names (the space body viewer's Save to game, `src/sky/look/bodiesFile.ts`'s
 * `gameAirOf`) that no dial of the game's twins and no fit moves: the planet's radius and the air's thickness, how fast the
 * clear air thins (and the ozone's layer with it, as the viewer's record lays it), the haze's height and its brightness, the
 * ground's bounce. Laid over the world's own numbers by `worldRecord`, so the world's fitted rows (the fit's worker is handed
 * them, `FitAsk.fileFields`), its twin and its body's record seen from another world (`bodyAir.ts`) carry them alike. **Empty
 * with no file**, or a file that names no world: every record exactly as before. The haze's forward glow (its phase's g) was
 * one of them until the two lines met (22 November): the fix round gave it a dial of the game's own (`glow`, "Glow round the
 * sun"), so a saved glow now sets that dial as the visibility and the haze colour set theirs, and one number, the dial, is
 * what every path lays (`applyHazeDials`, the run's rows, the fit's ask): the file and the dial cannot disagree.
 */
export interface AirFileFields {
  radiusKm?: number;
  thicknessKm?: number;
  rayleighHeightKm?: number;
  hazeHeightKm?: number;
  hazeAlbedo?: number;
  groundAlbedo?: number;
}

/** The names `AirFileFields` holds (the worker's message and the tests read them). */
export const AIR_FILE_FIELD_NAMES = ['radiusKm', 'thicknessKm', 'rayleighHeightKm', 'hazeHeightKm', 'hazeAlbedo', 'groundAlbedo'] as const;

/** Each world's file fields in force, by world id (set behind a loading screen, `setAirFileFields`). */
export const AIR_FILE_FIELDS: Record<string, AirFileFields> = {};

/** A world's file fields set (null or empty: none, its record as before). */
export function setAirFileFields(planetId: string, fields: AirFileFields | null | undefined): void {
  if (!fields || !Object.keys(fields).length) delete AIR_FILE_FIELDS[planetId];
  else AIR_FILE_FIELDS[planetId] = { ...fields };
}

/**
 * File fields into a record, as the viewer's `recordOf` (airProfile.js) sets the same numbers: the radius the bottom and the
 * thickness above it the top, the clear air's scale height (the ozone's centre and half width scaled by it from Earth's), the
 * haze's scale height, its single-scattering albedo (the haze's extinction re-split by it), the ground's albedo in every
 * channel. A field absent keeps the world's own number. (The haze's phase is the glow dial's: `setHazeGlow`.)
 */
export function applyAirFileFields(r: AirRecord, f: AirFileFields): void {
  const thick = r[F.top] - r[F.bottom];
  if (Number.isFinite(f.radiusKm)) r[F.bottom] = f.radiusKm as number;
  r[F.top] = r[F.bottom] + (Number.isFinite(f.thicknessKm) ? (f.thicknessKm as number) : thick);
  if (Number.isFinite(f.rayleighHeightKm)) {
    const h = f.rayleighHeightKm as number;
    r[F.rayH] = h;
    const thin = h / EARTH.rayleighHeight;
    r[F.ozC] = EARTH.ozoneCentre * thin;
    r[F.ozW] = EARTH.ozoneHalfWidth * thin;
  }
  if (Number.isFinite(f.hazeHeightKm)) r[F.mieH] = f.hazeHeightKm as number;
  if (Number.isFinite(f.hazeAlbedo)) {
    const ext = r[F.mieS] + r[F.mieA];
    const a = f.hazeAlbedo as number;
    r[F.mieAlbedo] = a;
    r[F.mieS] = ext * a;
    r[F.mieA] = ext * (1 - a);
  }
  if (Number.isFinite(f.groundAlbedo)) r[F.groundR] = r[F.groundG] = r[F.groundB] = f.groundAlbedo as number;
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
  /**
   * Pass 2, wave 2 (the owner's answer 3 of 21 November, "I'd rather I be able to set the limit higher and lower myself"):
   * this world's own limits on the fit's ozone, as a share of Earth's; nought takes the all-worlds limits (`AIR_OZONE`).
   */
  ozoneMin: number;
  ozoneMax: number;
  /**
   * Pass 2, wave 4a (the brief's item 6; the viewer's haze colour, wave B): this world's haze colour, each channel's share of
   * the haze's scattering (`F.mieTintR..B`). **1, 1, 1 to start: a grey haze**, the record as it was (the brief's default,
   * "every world's haze starting grey"), so every world's sky and ground are drawn as before until the owner moves one; a warm
   * desert dust is about 1, 0.9, 0.7 (the viewer's desert start), an ash a little browner and darker. Feel is his.
   */
  hazeR: number;
  hazeG: number;
  hazeB: number;
  /**
   * The sky and light fix round (maker L; the owner's "if I want haze it makes the sun huge"): the glow round the sun, the
   * haze's phase g (how strongly it throws light forward, `F.mieG`). **Each world's own to start** (`AIR_WORLDS`' `mieG`: 0.7
   * for Tatooine's dust and Mustafar's ash, 0.75 for Dathomir and Lok, 0.8 for the wetter worlds), so every sky is drawn as
   * before until the owner moves one. Lower spreads the aureole round the sun and the moon wider and dimmer; higher draws it
   * tighter and brighter at the disc. It shapes only the air's own light (the sun's and the moon's in-scatter): the flashlight
   * and the blades light no haze. Feel is his.
   */
  glow: number;
  /**
   * Pass 2, wave 6 (the owner's "Mustafar very clear and different than its game and movie counterparts"): the second aerosol
   * layer, smoke and ash, and the glow from below; the names and ranges `airProfile.js`' (`SMOKE_DIAL_RANGE`, one set for the
   * game and the viewer's air box). **None to start on every world** (a depth and a glow of nought: every record and table the
   * base's) but Mustafar, which starts at a measured volcanic plume (`SMOKE_STARTS`). Feel is his.
   */
  smokeDepth: number;
  smokeAngstrom: number;
  smokeAlbedo: number;
  smokeBrown: number;
  smokeHeightKm: number;
  smokeThickKm: number;
  smokeG: number;
  glowLux: number;
  glowKelvin: number;
}

/**
 * Pass 2, wave 6: each world's smoke and ash to start where it is not none (`SMOKE_DIAL_START`, `airProfile.js`, for the
 * rest: a depth and a glow of nought, the other dials where a mixed volcanic plume stands when he raises the depth). Feel is
 * his; these are where they start.
 *
 * **Mustafar** (black rock and open lava under ash and smoke), from measured plumes of both:
 *   - `smokeDepth` 1: the optical depth at 500 nm of Eyjafjallajokull's ash layer over central Europe on 16 April 2010 stood
 *     between about 0.6 and 1 (Ansmann et al. 2010, Geophys. Res. Lett. 37, L13810: EARLINET lidar and AERONET photometers at
 *     Leipzig and Munich), a plume some 1,500 km from its vent; a world of open lava stands under its own at the top of that.
 *   - `smokeHeightKm` 3, `smokeThickKm` 5: that layer stood between about 2 and 6 km (the same lidars); near its sources it
 *     reaches lower, so here from half a kilometre to five and a half, densest at three.
 *   - `smokeAngstrom` 1: between coarse ash's, near nought in the same measurements, and fresh smoke's 1.6 to 2.1 over 440 to
 *     870 nm (Dubovik et al. 2002, J. Atmos. Sci. 59, 590-608, AERONET's biomass-burning sites): a plume of both, so the sun
 *     through it reddens without the deep red of pure smoke.
 *   - `smokeAlbedo` 0.85: smoke's single-scattering albedo at 440 nm runs from about 0.84 (African savanna) to 0.94 (Amazon
 *     forest) in Dubovik et al. 2002; a dark, sooty plume over burning ground at the low end.
 *   - `smokeBrown` 1.5: absorption Angstrom exponents near 1 for black carbon and about 1.5 to 2 for biomass smoke (Bergstrom et
 *     al. 2007, Atmos. Chem. Phys. 7, 5937-5943): soot with some brown.
 *   - `smokeG` 0.7: smoke's asymmetry at 440 nm is about 0.64 to 0.69 (Dubovik et al. 2002); ash's larger grains throw forward
 *     a little more.
 *   - `glowLux` 1 at `glowKelvin` 1250: **not measured** (no measure of a lava field's upward light over its whole area was found):
 *     a start for his eye, four times a full moon's 0.25 lux, from crusted lava whose open cracks glow at basalt's 1,100 to
 *     1,200 degrees C; the colour of the crust's mean, an orange.
 */
export const SMOKE_STARTS: Record<string, Partial<SmokeDials>> = {
  mustafar: { smokeDepth: 1, smokeAngstrom: 1, smokeAlbedo: 0.85, smokeBrown: 1.5, smokeHeightKm: 3, smokeThickKm: 5, smokeG: 0.7, glowLux: 1, glowKelvin: 1250 },
};

/** A world's smoke and ash dials to start (`SMOKE_STARTS` over `SMOKE_DIAL_START`). */
export function smokeStartOf(planetId: string): SmokeDials {
  return { ...SMOKE_DIAL_START, ...(SMOKE_STARTS[planetId] ?? {}) };
}

/** Every row's start but the glow, whose start is each world's own (`glowStartOf`), and the smoke and ash (`smokeStartOf`). */
export const AIR_DIAL_START: AirDialRow = { visibilityKm: 40, steer: 0, ozoneMin: 0, ozoneMax: 0, hazeR: 1, hazeG: 1, hazeB: 1, glow: EARTH.mieG, ...SMOKE_DIAL_START };

/** A world's glow round the sun to start (the sky and light fix round): its own haze's g (`AIR_WORLDS`, else the default world's). */
export function glowStartOf(planetId: string): number {
  return airWorldOf(planetId).mieG;
}

/**
 * The fit's ozone limits for every world (the owner's dials since pass 2, wave 2), as shares of Earth's: they start where
 * wave 1 left them and the owner has seen (`airFit.ts`'s `OZONE_MIN` and `OZONE_MAX`, whose reasons are there): at least
 * three quarters, which keeps a clear twilight's zenith blue over green on every world, and at most four times, the top
 * six worlds' fits stand at. Moved, every world whose own limits are nought is fitted again in the worker and its tables
 * made again (numbers only).
 */
export const AIR_OZONE = { min: 0.75, max: 4 };

/** The ozone dials' ranges: the all-worlds limits', and a world's own (nought is "the all-worlds limits"). */
export const AIR_OZONE_RANGE = { all: [0.05, 12] as const, own: [0, 12] as const };

/** A world's ozone limits in force, into `out` as [least, most]: its own where set, else the all-worlds ones, the most never under the least. */
export function ozoneOf(planetId: string, out: [number, number]): [number, number] {
  const d = airDialsOf(planetId);
  const lo = d.ozoneMin > 0 ? d.ozoneMin : AIR_OZONE.min;
  const hi = d.ozoneMax > 0 ? d.ozoneMax : AIR_OZONE.max;
  out[0] = lo;
  out[1] = hi > lo ? hi : lo;
  return out;
}

/** The dials as they stand, by world id; a world never moved reads the start. */
export const AIR_DIALS: Record<string, AirDialRow> = {};

/** A world's dials (made at the start on first ask, so the menu's rows always have something to read). */
export function airDialsOf(planetId: string): AirDialRow {
  let d = AIR_DIALS[planetId];
  if (!d) {
    const s = AIR_DIAL_START;
    d = { visibilityKm: s.visibilityKm, steer: s.steer, ozoneMin: s.ozoneMin, ozoneMax: s.ozoneMax, hazeR: s.hazeR, hazeG: s.hazeG, hazeB: s.hazeB, glow: glowStartOf(planetId), ...smokeStartOf(planetId) };
    AIR_DIALS[planetId] = d;
  }
  return d;
}

/** The dials' ranges (the sliders'), and what a value outside is held to. */
export const AIR_DIAL_RANGE = { visibilityKm: [0.2, 300] as const, steer: [0, 1] as const, hazeR: [0, 1] as const, hazeG: [0, 1] as const, hazeB: [0, 1] as const, glow: [0, 0.95] as const, ...SMOKE_DIAL_RANGE };

/** The dials a world's row holds, as `tuneAirDials` takes them. */
const ROW_DIALS = ['visibilityKm', 'steer', 'ozoneMin', 'ozoneMax', 'hazeR', 'hazeG', 'hazeB', 'glow', ...SMOKE_DIAL_NAMES] as const;

/** Pass 2, wave 6: the smoke and ash dials of a world's row (the names `airProfile.js` and the viewer share). */
export const SMOKE_ROW_DIALS = SMOKE_DIAL_NAMES;

/** The haze's phase g written into a record (the sky and light fix round's glow round the sun), held to the dial's range. */
export function setHazeGlow(r: AirRecord, g: number): void {
  const [lo, hi] = AIR_DIAL_RANGE.glow;
  r[F.mieG] = g > lo ? (g < hi ? g : hi) : lo;
}

/**
 * A world's haze colour in force (its dials), into a record (pass 2, wave 4a); and its glow round the sun (the fix round);
 * and (pass 2, wave 6) its smoke and ash and its glow from below, so a body showing the world (`bodyAir.ts`) and the viewer's
 * drawing of its ground sky carry them as its own sky does.
 */
export function applyHazeDials(planetId: string, r: AirRecord): void {
  const d = airDialsOf(planetId);
  setHazeTint(r, d.hazeR, d.hazeG, d.hazeB);
  setHazeGlow(r, d.glow);
  smokeInto(r, d);
}

/** A count the dials move by, so a reader can tell the numbers moved without comparing them (the tables' rebuild). */
export const AIR_DIAL_STATE = { version: 0 };

/**
 * The dials moved as the console line writes them (`{ tatooine: { visibilityKm: 25, steer: 0.2 } }`): each held to its
 * range; words for anything held or refused.
 */
export function tuneAirDials(o: Record<string, unknown>): string[] {
  const words: string[] = [];
  if (!o || typeof o !== 'object') return [`the air dials take { <world>: { ${ROW_DIALS.join(', ')} } } and { all: { ozoneMin, ozoneMax } }`];
  for (const [id, v] of Object.entries(o)) {
    if (!v || typeof v !== 'object') {
      words.push(`${id}: not a row`);
      continue;
    }
    const vv = v as Record<string, unknown>;
    // Pass 2, wave 2: `all` is every world's ozone limits (a world's own nought takes them).
    if (id === 'all') {
      for (const key of ['ozoneMin', 'ozoneMax'] as const) {
        if (vv[key] === undefined) continue;
        const n = Number(vv[key]);
        if (!Number.isFinite(n)) {
          words.push(`all.${key}: not a number`);
          continue;
        }
        const [lo, hi] = AIR_OZONE_RANGE.all;
        const held = n < lo ? lo : n > hi ? hi : n;
        if (held !== n) words.push(`all.${key} held to ${held}`);
        AIR_OZONE[key === 'ozoneMin' ? 'min' : 'max'] = held;
      }
      for (const k of Object.keys(vv)) if (k !== 'ozoneMin' && k !== 'ozoneMax') words.push(`all.${k}: no such dial (ozoneMin, ozoneMax)`);
      continue;
    }
    const row = airDialsOf(id);
    for (const key of ROW_DIALS) {
      if (vv[key] === undefined) continue;
      const n = Number(vv[key]);
      if (!Number.isFinite(n)) {
        words.push(`${id}.${key}: not a number`);
        continue;
      }
      const [lo, hi] = key === 'ozoneMin' || key === 'ozoneMax' ? AIR_OZONE_RANGE.own : AIR_DIAL_RANGE[key];
      const held = n < lo ? lo : n > hi ? hi : n;
      if (held !== n) words.push(`${id}.${key} held to ${held}`);
      row[key] = held;
    }
    for (const k of Object.keys(vv)) if (!(ROW_DIALS as readonly string[]).includes(k)) words.push(`${id}.${k}: no such dial (${ROW_DIALS.join(', ')})`);
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
    hazeColour: [n(r[F.mieTintR], 3), n(r[F.mieTintG], 3), n(r[F.mieTintB], 3)],
    // Pass 2, wave 6: the smoke and ash at its peak and the glow from below (none: nought throughout).
    smoke: hasSmoke(r)
      ? {
          extinctionPerKm: [n(r[F.smokeER]), n(r[F.smokeEG]), n(r[F.smokeEB])],
          scatterPerKm: [n(r[F.smokeSR]), n(r[F.smokeSG]), n(r[F.smokeSB])],
          middleKm: n(r[F.smokeC]),
          halfDepthKm: n(r[F.smokeW]),
          g: n(r[F.smokeG], 3),
          glowShare: [n(r[F.glowR], 3), n(r[F.glowG], 3), n(r[F.glowB], 3)],
        }
      : 'none',
  };
}
