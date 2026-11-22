// The fit (the GPU port's pass 2, wave 1, the design's 2.1): each environment row of a world's `sky.json` given its own
// air record, in a worker behind the loading screen (`airFit.worker.ts`), with no reconversion. Three things are read off
// the client's table:
//   - **fog becomes a visibility.** A row's share of the world's clear-day visibility is its family's clear row's fog
//     density over its own (the client's exponential-squared fog falls to 2% at a distance inversely as its density), so a
//     storm row with ten times the clear row's fog sees a tenth as far, from wherever the owner's dial stands;
//   - **the noon colour becomes a sky tint.** A clear row's Rayleigh is turned in hue along its power law of the
//     wavelength alone, never in strength, until the physical sky beside the noon sun has the hue of the row's clear colour
//     at noon as near as such a law can (a purple or a green no clear air makes is left to the steer dial);
//   - **the dusk colour becomes the ozone tint.** A clear row's ozone is scaled until the zenith with the sun just set has
//     the blue-to-red balance of the row's clear colour at dusk, never under half of Earth's (`OZONE_MIN`), which keeps a
//     clear twilight's zenith blue.
// A weather row takes its family's clear row's tint and ozone, and differs from it by its haze alone: weather blends
// numbers, never colours. The world's column densities and each distinct record's multiple-scattering table (`airTwin.ts`)
// are made here too, for the twin.
//
// Pure: plain numbers, so the worker and the node tests run this very code.
import { F, LUMA_B, LUMA_G, LUMA_R, EARTH, copyRecord, setHazeTint, setVisibility, worldRecord, type AirRecord } from './airParams.ts';

/** A grey haze (pass 2, wave 4a): the haze colour every world's dial starts at, the record as it was. */
const GREY_HAZE: readonly [number, number, number] = [1, 1, 1];
import { buildDepthTable, buildPsiTable, columnDepths, hitsGround, miePhase, opticalDepth, rayLength, rayleighPhase, DEPTH_FLOATS, PSI_FLOATS } from './airTwin.ts';

/** What the fit reads of one environment row (`SkyBlock`'s fields, so a block is handed as it is). */
export interface FitRow {
  name: string;
  weatherIndex: number;
  ramp: { rows: number; rgba: string } | null;
  fog: { enabled: boolean; min: number; max: number };
  /** The row's gradient sky picture (its columns the time of day, its rows the height from the horizon), or null. */
  gradientSky?: string | null;
}

/**
 * A gradient sky picture read as the dome reads it (`DOME_COLOUR_GLSL`: across the day's `normalized` time, up the view's
 * height, 0 the horizon), linear, into `out`; false where the picture could not be read. The worker's reads the decoded
 * pictures; a test hands its own.
 */
export type GradientSampler = (file: string, u: number, v: number, out: Float64Array) => boolean;

/** What the fit reads of a world's sky. */
export interface FitSky {
  planet: string;
  sunElevationDegrees: number;
  blocks: readonly FitRow[];
}

/** One row's answer. */
export interface FitAnswer {
  /** The record, with the visibility of `visibilityKm` times its share resolved into its haze. */
  record: AirRecord;
  /** Its multiple-scattering table at the twin's size (rows of one record share one). */
  psi: Float32Array;
  /** What the fit made of the row, for the console. */
  visShare: number;
  tint: [number, number, number];
  ozone: number;
  /** Which distinct record this row is (rows of one record share their tables). */
  distinct: number;
}

export interface FitResult {
  planet: string;
  visibilityKm: number;
  rows: FitAnswer[];
  /** The world's column densities (one table: every row shares its heights). */
  depth: Float32Array;
  /** Distinct records the multiple scattering was made for. */
  distinct: number;
  ms: number;
}

/** Where between the client's least and most fog density its far plane puts the fog (`sky.ts`'s `update`: the client's 1,024 m far plane between 512 and 2,048). */
export const FOG_FAR_T = (1024 - 512) / (2048 - 512);

/** A row's fog density as the sky works it out (`SwgSky.update`): nought with its fog off. */
export function rowFogDensity(row: FitRow): number {
  if (!row.fog.enabled) return 0;
  return row.fog.min + (row.fog.max - row.fog.min) * FOG_FAR_T;
}

/**
 * Each row's share of the world's clear-day visibility: its family's clear row's fog density (the family's weather-0
 * row, else the world's `global` clear row) over its own, never above one (weather never clears the air beyond a clear
 * day); one where either has no fog.
 */
export function visibilityShares(rows: readonly FitRow[]): Float64Array {
  const out = new Float64Array(rows.length);
  const clearOf = new Map<string, number>();
  for (const r of rows) if (r.weatherIndex === 0 && !clearOf.has(r.name.toLowerCase())) clearOf.set(r.name.toLowerCase(), rowFogDensity(r));
  const global = clearOf.get('global') ?? 0;
  for (let i = 0; i < rows.length; i++) {
    const own = rowFogDensity(rows[i]);
    const fam = clearOf.get(rows[i].name.toLowerCase());
    const ref = fam !== undefined && fam > 0 ? fam : global;
    out[i] = own > 0 && ref > 0 ? Math.min(1, ref / own) : 1;
  }
  return out;
}

// ---------------------------------------------------------------- the client's colours

/** A ramp's bytes (base64), decoded once a row. */
function rampBytes(row: FitRow): Uint8Array | null {
  if (!row.ramp?.rgba) return null;
  const s = atob(row.ramp.rgba);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** The ramp's colour at a row and column, linear, into `out`; false where the ramp has no such row. */
export function rampLinear(bytes: Uint8Array, rows: number, row: number, index: number, out: Float64Array): boolean {
  if (row >= rows) return false;
  const o = (row * 256 + index) * 4;
  out[0] = srgbToLinear(bytes[o] / 255);
  out[1] = srgbToLinear(bytes[o + 1] / 255);
  out[2] = srgbToLinear(bytes[o + 2] / 255);
  return true;
}

/** The ramp's clear colour row (`sky.ts`'s `Row.Clear`). */
const CLEAR_ROW = 5;
/**
 * The ramp's columns the fit reads, on SWG's path of the sun (`DayCycle`'s `normalized`: the day over the first 128
 * columns, the night over the rest): noon is the middle of the day's half; just after sunset, with the sun some 3 degrees
 * under the horizon, is column 130.
 */
export const NOON_COLUMN = 64;
export const DUSK_COLUMN = 130;
/** The same moments on a gradient picture (`normalized` across), and the heights read: 45 degrees up at noon, the zenith at dusk. */
export const NOON_U = NOON_COLUMN / 256 + 0.5 / 256;
export const DUSK_U = DUSK_COLUMN / 256 + 0.5 / 256;
export const NOON_V = Math.SQRT1_2;
export const DUSK_V = 0.98;

// ---------------------------------------------------------------- the fit's own sums (single scattering, no tables)

const depth3 = new Float64Array(3);

/**
 * The single-scattered radiance toward a view (elevation `el` above the eye's level, azimuth `az` from the sun) with the
 * sun at elevation `sunEl`, from the surface, per unit of the sun's illuminance, into `out`: the fit's own short sum, its
 * light's transmittance marched directly (no table), which is all a hue needs.
 */
export function singleScatter(rec: AirRecord, el: number, az: number, sunEl: number, out: Float64Array, steps = 16): void {
  const bottom = rec[F.bottom];
  const top = rec[F.top];
  const r = bottom + 0.01;
  const dx = Math.cos(el) * Math.cos(az);
  const dy = Math.sin(el);
  const dz = Math.cos(el) * Math.sin(az);
  const sx = Math.cos(sunEl);
  const sy = Math.sin(sunEl);
  const c = dx * sx + dy * sy;
  const pR = rayleighPhase(c);
  const pM = miePhase(c, rec[F.mieG]);
  const len = rayLength(r, dy, bottom, top);
  const mieT = rec[F.mieS] + rec[F.mieA];
  let L0 = 0;
  let L1 = 0;
  let L2 = 0;
  let T0 = 1;
  let T1 = 1;
  let T2 = 1;
  let prev = 0;
  for (let i = 0; i < steps; i++) {
    const u = (i + 1) / steps;
    const e = len * u * u;
    const dt = e - prev;
    const t = prev + 0.5 * dt;
    prev = e;
    const px = t * dx;
    const py = r + t * dy;
    const pz = t * dz;
    const rr = Math.sqrt(px * px + py * py + pz * pz);
    const h = rr - bottom;
    const dR = Math.exp(-(h > 0 ? h : 0) / rec[F.rayH]);
    const dM = Math.exp(-(h > 0 ? h : 0) / rec[F.mieH]);
    const oz = 1 - Math.abs(h - rec[F.ozC]) / rec[F.ozW];
    const dO = oz > 0 ? oz : 0;
    const muL = (px * sx + py * sy) / rr;
    let l0 = 0;
    let l1 = 0;
    let l2 = 0;
    if (!hitsGround(rr, muL, bottom)) {
      opticalDepth(rec, rr, muL, 12, depth3, 0);
      l0 = Math.exp(-depth3[0]);
      l1 = Math.exp(-depth3[1]);
      l2 = Math.exp(-depth3[2]);
    }
    // Pass 2, wave 4a: the haze's scattering by channel (its colour; 1, 1, 1 grey, the sum as it was to the bit).
    const sM = rec[F.mieS] * dM;
    const e0 = rec[F.rayR] * dR + mieT * dM + rec[F.ozR] * dO;
    const e1 = rec[F.rayG] * dR + mieT * dM + rec[F.ozG] * dO;
    const e2 = rec[F.rayB] * dR + mieT * dM + rec[F.ozB] * dO;
    L0 += T0 * l0 * (rec[F.rayR] * dR * pR + sM * rec[F.mieTintR] * pM) * dt;
    L1 += T1 * l1 * (rec[F.rayG] * dR * pR + sM * rec[F.mieTintG] * pM) * dt;
    L2 += T2 * l2 * (rec[F.rayB] * dR * pR + sM * rec[F.mieTintB] * pM) * dt;
    T0 *= Math.exp(-e0 * dt);
    T1 *= Math.exp(-e1 * dt);
    T2 *= Math.exp(-e2 * dt);
  }
  out[0] = L0;
  out[1] = L1;
  out[2] = L2;
}

/** A colour's hue as its two log ratios to its green (red over green, blue over green). */
function logRatios(c: Float64Array, out: Float64Array): void {
  const g = c[1] > 1e-12 ? c[1] : 1e-12;
  out[0] = Math.log((c[0] > 1e-12 ? c[0] : 1e-12) / g);
  out[1] = Math.log((c[2] > 1e-12 ? c[2] : 1e-12) / g);
}

/**
 * How far the tint may move the Rayleigh's power law from Earth's fourth power of the wavelength, either way: the tint turns
 * the sky's hue only along `Î»^-n` (`fitTint`), never channel by channel. Channel by channel, Tatooine's noon picture cut the
 * Rayleigh's red to a third and raised its green by a third, a spectrum no gas scatters, and with the ozone fitted away its
 * dusk sky came out dark green (the wave's review); along a power law the red is always scattered least and transmitted
 * most, so a low sun reddens and the twilight's hue is the ozone's. Two to six spans a whiter sky of larger particles to a
 * deeper blue than any air of ours.
 */
export const TINT_EXPONENT = { least: 2, most: 6 } as const;
/**
 * How far ozone may be scaled from Earth's (this to `OZONE_MAX`): ozone's absorption of the orange is what keeps a clear
 * twilight's zenith blue (Hulburt's), and fitted to nought (Tatooine's dusk picture asked 2.4% of Earth's) the zenith turned
 * green over blue. At half of Earth's a reddish world's (Dathomir's forests, the floor binding there) came out grey, blue
 * and green alike; at three quarters the zenith three degrees after sunset is blue over green by a sixth or more on every
 * world's fitted clear row, the floor binding only where SWG's dusk is red (`airFit.test.ts` holds Tatooine's).
 */
export const OZONE_MIN = 0.75;
/** How far ozone may be scaled from Earth's (`OZONE_MIN` to this). */
export const OZONE_MAX = 4;

/** Each channel's log of its Rayleigh over the green's per power of the wavelength: Earth's coefficients are `Î»^-4`'s (680, 550, 440 nm). */
const RAY_LOG_R = Math.log(EARTH.rayleigh[0] / EARTH.rayleigh[1]) / 4;
const RAY_LOG_B = Math.log(EARTH.rayleigh[2] / EARTH.rayleigh[1]) / 4;

/** The record's Rayleigh set to the power law `Î»^-n` about the green, its luminance-weighted strength at Earth's. */
function rayleighPower(rec: AirRecord, n: number): void {
  const r = Math.exp(RAY_LOG_R * n);
  const b = Math.exp(RAY_LOG_B * n);
  const earthLum = LUMA_R * EARTH.rayleigh[0] + LUMA_G * EARTH.rayleigh[1] + LUMA_B * EARTH.rayleigh[2];
  const g = earthLum / (LUMA_R * r + LUMA_G + LUMA_B * b);
  rec[F.rayR] = r * g;
  rec[F.rayG] = g;
  rec[F.rayB] = b * g;
}
/** A clear colour greyer than this (its spread over its brightest channel) says nothing of a hue: the tint is left at Earth's. */
const GREY = 0.04;

/** Whether a linear colour has a hue to fit to. */
function hasHue(c: Float64Array): boolean {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  return mx > 1e-4 && (mx - mn) / mx > GREY;
}

/**
 * The Rayleigh turned in hue toward a target sky colour beside the noon sun (45 degrees up, a quarter turn from the sun)
 * along its power law alone (`Î»^-n`, n within `TINT_EXPONENT`, by a golden-section search on the hue's two log ratios), its
 * luminance-weighted strength held at Earth's. Answers the channels' factors over Earth's.
 */
export function fitTint(rec: AirRecord, target: Float64Array, noonEl: number, out: [number, number, number]): void {
  out[0] = out[1] = out[2] = 1;
  if (!hasHue(target)) return;
  const want = new Float64Array(2);
  logRatios(target, want);
  const got = new Float64Array(2);
  const col = new Float64Array(3);
  const cost = (n: number): number => {
    rayleighPower(rec, n);
    singleScatter(rec, Math.PI / 4, Math.PI / 2, noonEl, col);
    logRatios(col, got);
    const dr = want[0] - got[0];
    const db = want[1] - got[1];
    return dr * dr + db * db;
  };
  const phi = (Math.sqrt(5) - 1) / 2;
  let a: number = TINT_EXPONENT.least;
  let b: number = TINT_EXPONENT.most;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = cost(c);
  let fd = cost(d);
  for (let i = 0; i < 20; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = cost(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = cost(d);
    }
  }
  rayleighPower(rec, (a + b) / 2);
  out[0] = rec[F.rayR] / EARTH.rayleigh[0];
  out[1] = rec[F.rayG] / EARTH.rayleigh[1];
  out[2] = rec[F.rayB] / EARTH.rayleigh[2];
}

const noonDepth = new Float64Array(3);

/** The luminance of the sun's light through a record's air at the noon height `noonEl`, per unit of its own (a direct sum). */
export function noonSunLuminance(rec: AirRecord, noonEl: number): number {
  columnDepths(rec, rec[F.bottom] + 0.01, Math.sin(noonEl), 200, noonDepth, 0);
  const mie = (rec[F.mieS] + rec[F.mieA]) * noonDepth[1];
  const tr = Math.exp(-(rec[F.rayR] * noonDepth[0] + mie + rec[F.ozR] * noonDepth[2]));
  const tg = Math.exp(-(rec[F.rayG] * noonDepth[0] + mie + rec[F.ozG] * noonDepth[2]));
  const tb = Math.exp(-(rec[F.rayB] * noonDepth[0] + mie + rec[F.ozB] * noonDepth[2]));
  return rec[F.sunStrength] * (LUMA_R * rec[F.sunR] * tr + LUMA_G * rec[F.sunG] * tg + LUMA_B * rec[F.sunB] * tb);
}

/**
 * The fit's tint and ozone turn the sky's hue, never the day's strength: the Rayleigh scaled as one (its hue kept) until
 * the noon sun's light through the row's air is what it was through the world's own before the fit (`target`), by
 * Newton's steps on the scale. So a clear Tatooine noon lights the world at today's key light there (`TODAY_NOON_KEY`)
 * whatever hue its sky was fitted to (unheld, the first cut's channel-by-channel tint read 2.8% over it).
 */
export function holdNoonSun(rec: AirRecord, target: number, noonEl: number): void {
  for (let it = 0; it < 6; it++) {
    columnDepths(rec, rec[F.bottom] + 0.01, Math.sin(noonEl), 200, noonDepth, 0);
    const mie = (rec[F.mieS] + rec[F.mieA]) * noonDepth[1];
    const dR = noonDepth[0];
    const tr = Math.exp(-(rec[F.rayR] * dR + mie + rec[F.ozR] * noonDepth[2]));
    const tg = Math.exp(-(rec[F.rayG] * dR + mie + rec[F.ozG] * noonDepth[2]));
    const tb = Math.exp(-(rec[F.rayB] * dR + mie + rec[F.ozB] * noonDepth[2]));
    const s = rec[F.sunStrength];
    const f = s * (LUMA_R * rec[F.sunR] * tr + LUMA_G * rec[F.sunG] * tg + LUMA_B * rec[F.sunB] * tb) - target;
    // d f / d k at k = 1, for the Rayleigh scaled by k.
    const df = -s * dR * (LUMA_R * rec[F.sunR] * tr * rec[F.rayR] + LUMA_G * rec[F.sunG] * tg * rec[F.rayG] + LUMA_B * rec[F.sunB] * tb * rec[F.rayB]);
    if (!(Math.abs(df) > 1e-12)) return;
    const k = 1 - f / df;
    const kk = k < 0.25 ? 0.25 : k > 4 ? 4 : k;
    rec[F.rayR] *= kk;
    rec[F.rayG] *= kk;
    rec[F.rayB] *= kk;
    if (Math.abs(f) < 1e-7 * target) return;
  }
}

/**
 * The ozone scaled (`least` to `most` of Earth's: `OZONE_MIN` and `OZONE_MAX` to start, the owner's dials since pass 2, wave 2,
 * `airParams.ts`'s `AIR_OZONE` and a world's own) toward a target zenith colour with the sun 3 degrees under: answers the scale.
 */
export function fitOzone(rec: AirRecord, target: Float64Array, least: number = OZONE_MIN, most: number = OZONE_MAX): number {
  if (!hasHue(target)) return 1;
  const want = new Float64Array(2);
  logRatios(target, want);
  const got = new Float64Array(2);
  const col = new Float64Array(3);
  const sunEl = (-3 * Math.PI) / 180;
  const cost = (s: number): number => {
    rec[F.ozR] = EARTH.ozone[0] * s;
    rec[F.ozG] = EARTH.ozone[1] * s;
    rec[F.ozB] = EARTH.ozone[2] * s;
    singleScatter(rec, Math.PI / 2 - 1e-3, 0, sunEl, col);
    logRatios(col, got);
    // The blue-to-red balance is what ozone moves.
    const d = want[1] - want[0] - (got[1] - got[0]);
    return d * d;
  };
  // A golden-section search over the scale.
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = least > 0 ? least : OZONE_MIN;
  let b = most > a ? most : a;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = cost(c);
  let fd = cost(d);
  for (let i = 0; i < 18; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = cost(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = cost(d);
    }
  }
  const s = (a + b) / 2;
  cost(s);
  return s;
}

// ---------------------------------------------------------------- the whole world

/**
 * Every row of a world fitted (the worker's one job, and the node tests'): `visibilityKm` the owner's clear-day dial for
 * this world. Rows whose records come out the same share their tables.
 */
export function fitWorld(sky: FitSky, visibilityKm: number, gradient: GradientSampler | null = null, ozoneLeast: number = OZONE_MIN, ozoneMost: number = OZONE_MAX, hazeTint: readonly [number, number, number] = GREY_HAZE): FitResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const rows = sky.blocks;
  const shares = visibilityShares(rows);
  const noonEl = ((Number.isFinite(sky.sunElevationDegrees) && sky.sunElevationDegrees > 0 ? sky.sunElevationDegrees : 67.5) * Math.PI) / 180;
  // Each family's clear row's fit, then every row from its family's (else the world's global's, else the world's base).
  const base = worldRecord(sky.planet);
  const fitted = new Map<string, { tint: [number, number, number]; ozone: number; rec: AirRecord }>();
  const colour = new Float64Array(3);
  for (const row of rows) {
    if (row.weatherIndex !== 0) continue;
    const key = row.name.toLowerCase();
    if (fitted.has(key)) continue;
    const rec = new Float64Array(base.length);
    copyRecord(base, rec);
    setVisibility(rec, visibilityKm);
    const bytes = rampBytes(row);
    const tint: [number, number, number] = [1, 1, 1];
    let ozone = 1;
    // What SWG's dome shows: the row's gradient picture where it has one (the ramp's clear colour is its haze, not its
    // sky), else the clear colour the dome draws without one.
    const file = row.gradientSky ?? null;
    const fromPicture = (u: number, v: number): boolean => !!file && !!gradient && gradient(file, u, v, colour);
    const noonBefore = noonSunLuminance(rec, noonEl);
    if (fromPicture(NOON_U, NOON_V) || (!file && bytes && row.ramp && rampLinear(bytes, row.ramp.rows, CLEAR_ROW, NOON_COLUMN, colour))) fitTint(rec, colour, noonEl, tint);
    if (fromPicture(DUSK_U, DUSK_V) || (!file && bytes && row.ramp && rampLinear(bytes, row.ramp.rows, CLEAR_ROW, DUSK_COLUMN, colour))) ozone = fitOzone(rec, colour, ozoneLeast, ozoneMost);
    // The hue fitted, the day's strength put back: the noon sun as bright through this row's air as through the world's own.
    holdNoonSun(rec, noonBefore, noonEl);
    tint[0] = rec[F.rayR] / EARTH.rayleigh[0];
    tint[1] = rec[F.rayG] / EARTH.rayleigh[1];
    tint[2] = rec[F.rayB] / EARTH.rayleigh[2];
    fitted.set(key, { tint, ozone, rec });
  }
  const globalFit = fitted.get('global') ?? null;
  const answers: FitAnswer[] = [];
  // The world's column densities, once: every row is the world's base record with other coefficients, so one set of heights.
  const depth64 = new Float64Array(DEPTH_FLOATS);
  buildDepthTable(base, depth64);
  const depth = new Float32Array(DEPTH_FLOATS);
  depth.set(depth64);
  const tables = new Map<string, { psi: Float32Array; index: number }>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fam = fitted.get(row.name.toLowerCase()) ?? globalFit;
    const rec = new Float64Array(base.length);
    copyRecord(fam ? fam.rec : base, rec);
    rec[F.visShare] = shares[i];
    setVisibility(rec, visibilityKm * shares[i]);
    // Pass 2, wave 4a: the haze's colour is the world's dial's (grey to start), never fitted: the hue and the ozone above are
    // fitted on a grey haze, so the dial moves only the light the haze adds and its multiple scattering below.
    setHazeTint(rec, hazeTint[0], hazeTint[1], hazeTint[2]);
    // Rows alike to two figures share one multiple-scattering table (it turns slowly with the numbers; each row keeps its
    // own record, so its transmittance is exact).
    let key = '';
    for (let f = 0; f < rec.length; f++) if (f !== F.visShare) key += `${rec[f].toPrecision(2)},`;
    let t = tables.get(key);
    if (!t) {
      const psi = new Float32Array(PSI_FLOATS);
      buildPsiTable(rec, depth64, psi);
      t = { psi, index: tables.size };
      tables.set(key, t);
    }
    answers.push({ record: rec, psi: t.psi, visShare: shares[i], tint: fam ? fam.tint : [1, 1, 1], ozone: fam ? fam.ozone : 1, distinct: t.index });
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  return { planet: sky.planet, visibilityKm, rows: answers, depth, distinct: tables.size, ms: t1 - t0 };
}

// ---------------------------------------------------------------- the worker's messages

/** What the page sends the worker: the world's sky (its rows' own fields only) and the dial. */
export interface FitAsk {
  id: number;
  sky: FitSky;
  visibilityKm: number;
  /** Each gradient picture the rows name, by file, at the address the worker fetches it from. */
  gradients: Record<string, string>;
  /** Pass 2, wave 2: the ozone's limits for this world (the owner's dials, `airParams.ts`'s `ozoneOf`); absent, `OZONE_MIN` and `OZONE_MAX`. */
  ozoneMin?: number;
  ozoneMax?: number;
  /** Pass 2, wave 4a: the world's haze colour (its dials, `airParams.ts`'s `hazeR..B`); absent, a grey haze. */
  hazeTint?: [number, number, number];
}

/** What the worker answers: the rows' records and tables as transferable arrays, in row order. */
export interface FitReply {
  id: number;
  planet: string;
  visibilityKm: number;
  /** The world's column densities. */
  depth: Float32Array;
  records: Float64Array[];
  psis: Float32Array[];
  distinct: number;
  ms: number;
  words: { visShare: number; tint: [number, number, number]; ozone: number }[];
  error?: string;
}

/** A fit worked into the reply the worker posts (the tables of rows sharing one are copied so each can be transferred). */
export function fitReply(ask: FitAsk, gradient: GradientSampler | null = null): FitReply {
  try {
    const r = fitWorld(ask.sky, ask.visibilityKm, gradient, ask.ozoneMin ?? OZONE_MIN, ask.ozoneMax ?? OZONE_MAX, ask.hazeTint ?? GREY_HAZE);
    return {
      id: ask.id,
      planet: r.planet,
      visibilityKm: r.visibilityKm,
      depth: r.depth,
      records: r.rows.map((a) => a.record),
      psis: r.rows.map((a) => a.psi.slice()),
      distinct: r.distinct,
      ms: r.ms,
      words: r.rows.map((a) => ({ visShare: a.visShare, tint: a.tint, ozone: a.ozone })),
    };
  } catch (e) {
    return { id: ask.id, planet: ask.sky.planet, visibilityKm: ask.visibilityKm, depth: new Float32Array(0), records: [], psis: [], distinct: 0, ms: 0, words: [], error: String((e as Error)?.message ?? e) };
  }
}

/** The fit's rows from a sky's blocks: only the fields it reads, so the message to the worker carries no pictures' names or sounds. */
export function fitSkyOf(planet: string, sunElevationDegrees: number, blocks: readonly FitRow[]): FitSky {
  return { planet, sunElevationDegrees, blocks: blocks.map((b) => ({ name: b.name, weatherIndex: b.weatherIndex, ramp: b.ramp, fog: b.fog, gradientSky: b.gradientSky ?? null })) };
}

/** The gradient pictures a sky's clear rows name (the only ones the fit reads). */
export function fitGradients(sky: FitSky): string[] {
  const out = new Set<string>();
  for (const b of sky.blocks) if (b.weatherIndex === 0 && b.gradientSky) out.add(b.gradientSky);
  return [...out];
}

/**
 * A sampler over decoded pictures (each its width, height and sRGB bytes, top row first, as a canvas reads them): the
 * dome's `v` of 0 is the picture's bottom row (three's loader turns a picture over), bilinear between texel centres.
 */
export function pictureSampler(pictures: ReadonlyMap<string, { width: number; height: number; data: Uint8ClampedArray | Uint8Array }>): GradientSampler {
  return (file, u, v, out) => {
    const p = pictures.get(file);
    if (!p || p.width < 1 || p.height < 1) return false;
    const x = Math.min(p.width - 1, Math.max(0, u * p.width - 0.5));
    const y = Math.min(p.height - 1, Math.max(0, (1 - v) * p.height - 0.5));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(p.width - 1, x0 + 1);
    const y1 = Math.min(p.height - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    for (let k = 0; k < 3; k++) {
      const at = (xx: number, yy: number) => srgbToLinear(p.data[(yy * p.width + xx) * 4 + k] / 255);
      const a = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
      const b = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
      out[k] = a + (b - a) * fy;
    }
    return true;
  };
}
