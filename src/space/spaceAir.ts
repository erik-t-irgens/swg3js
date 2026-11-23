// The air round a space zone's planets (the GPU port's pass 2, wave 4b, maker C; the design's 2.6, "planets in space gain the
// air round them"): which air each planet of a zone's file has, the place each one is in the space body viewer (so the owner's
// Save to game names it), and the painted rim drawn from that air where the tier paints it (and on the galaxy map's globes).
// Pure: no three, no page, so the node tests read the very rules the drawing reads.
//
// **Which record.** A planet that is a ground world of the game (Tatooine, Naboo, Endor's forest moon and the rest) takes that
// world's own record at its dials (`bodyAir.ts`'s `bodyRecord`, the very record its ground sky is fitted from and its rim from
// a moon is drawn with), so its ground sky, its rim from a moon and its rim from orbit change together. A planet with no ground
// of ours takes its look's own record where the owner's Save to game gives the place a look with air, else the viewer's start
// for its kind: Yavin Prime and Endor's gas giant a giant's, Kessel and Ord Mantell a temperate world's. A moon has none.
//
// **The painted rim** (the Painted form, the Low tier's, and the map's globes'): the limb's own light, marched once by the
// viewer's march (`airProfile.js`'s `marchAir`, the body path itself) along grazing rays at a few heights through the shell with
// the star overhead at the limb, kept as a small table of colours by height, so a painted rim is the scattered rim's own colour
// and fall-off at the lit limb, laid round the disc without a march a pixel.
import { airStartFor, makeTables, marchAir, recordKey, recordOf, type LookAir } from '../sky/look/airProfile.js';
import { F } from '../sky/air/airParams.ts';
import type { BodyAir } from '../sky/bodies/bodyAir.ts';
import { BODY_LAY } from '../sky/bodies/bodyTier.ts';

/** The ground worlds of the game a zone's planet may be (`planet_<world>.pln`), by the game's planet ids. */
const GROUND_WORLDS = new Set(['tatooine', 'naboo', 'corellia', 'dantooine', 'dathomir', 'endor', 'kashyyyk', 'lok', 'yavin4', 'talus', 'rori', 'mustafar']);
/** Giants of air with no ground: Endor's gas giant, Yavin Prime. */
const GIANTS = new Set(['gas_endor', 'yavin']);
/** Worlds of air with no ground of ours: a temperate world's start until a look of his names their air. */
const TEMPERATE = new Set(['kessel', 'ord_mantell']);

/** A zone's planet's name as its appearance gives it: `appearance/planet_naboo.pln` is `planet_naboo`. */
export function appearanceName(appearance: string): string {
  const a = String(appearance ?? '').toLowerCase();
  return a.slice(a.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/, '');
}

/** What a zone's planet shows, by its appearance: a ground world (its id), a giant, a temperate world with no ground, or a moon. */
export function spaceBodyAir(appearance: string): BodyAir {
  const name = appearanceName(appearance);
  const m = /^planet_(.+)$/.exec(name);
  if (!m) return { kind: 'airless' };
  const w = m[1];
  if (/moon/.test(w)) return { kind: 'airless' };
  if (GIANTS.has(w)) return { kind: 'giant' };
  if (TEMPERATE.has(w)) return { kind: 'temperate' };
  if (GROUND_WORLDS.has(w)) return { kind: 'world', world: w };
  return { kind: 'airless' };
}

/**
 * Each planet's place in the space body viewer, in the file's order (`places.js`' `buildPlaces`): `<zone>:<appearance>`, with
 * `#n` counting from 1 where the zone holds more than one of the same appearance. The owner's Save to game names a place's look
 * by it (`bodiesFile.ts`'s `bodyLookOf`).
 */
export function spacePlaceIds(zone: string, appearances: readonly string[]): string[] {
  const names = appearances.map(appearanceName);
  const seen: Record<string, number> = {};
  for (const n of names) seen[n] = (seen[n] ?? 0) + 1;
  const count: Record<string, number> = {};
  return names.map((n) => {
    count[n] = (count[n] ?? 0) + 1;
    return `${zone}:${n}${seen[n] > 1 ? '#' + count[n] : ''}`;
  });
}

/**
 * The record of a body with no ground: its look's own air where the owner's Save to game gives the place a look with air (the
 * viewer's record, `recordOf`), else the viewer's start for its kind (a giant's or a temperate world's). Null for a ground world
 * (its world's record is `bodyRecord`'s) and for a moon.
 */
export function ownRecordOf(air: BodyAir, lookAir: Record<string, unknown> | null): Float64Array | null {
  if (air.kind === 'world' || air.kind === 'airless' || air.kind === 'none') return null;
  if (lookAir && typeof lookAir === 'object') return recordOf(lookAir as LookAir);
  return recordOf(airStartFor(air.kind === 'giant' ? 'gasgiant' : 'temperate'));
}

/**
 * The record of a body with no ground of ours, as the drawing takes it: `ownRecordOf`'s, and for a moon (no air of its own in
 * SWG's zone) the air of the look the owner's file puts on it where that look has air not set to None (a moon he made Rori).
 */
export function lookRecordOf(air: BodyAir, lookAir: Record<string, unknown> | null): Float64Array | null {
  const own = ownRecordOf(air, lookAir);
  if (own) return own;
  if (air.kind === 'airless' && lookAir && typeof lookAir === 'object' && lookFormOf(lookAir) !== 'none') return recordOf(lookAir as LookAir);
  return null;
}

/** A look's own form of air (`air.mode`: Scattered, Painted or None), or null where it names none (the tier's then). */
export function lookFormOf(lookAir: Record<string, unknown> | null): 'scattered' | 'painted' | 'none' | null {
  const m = lookAir && typeof lookAir === 'object' ? lookAir.mode : null;
  return m === 'scattered' || m === 'painted' || m === 'none' ? m : null;
}

// ---------------------------------------------------------------- the painted rim

/** Heights the painted rim's table holds: the shell from the ground to its top. */
export const RIM_PROFILE_SIZE = 32;

/**
 * Small tables the profile is marched through (`makeTables`' sizes): the rim is a painting of the limb, and these make one in a
 * few milliseconds on the main thread where the full tables take some 90, so a body whose full tables wait for the next screen
 * (the bake cache's budget) still has its painted rim, and the map's globes have theirs without a bake.
 */
export const RIM_TABLES = {
  transmittance: { width: 48, height: 16, steps: 24 },
  multiScatter: { width: 12, height: 12, dirs: 12, steps: 10 },
  irradiance: { width: 16, height: 1, rings: 3, azimuths: 6, steps: 8 },
};

/** The march's steps for each height of the profile (Ultra's count: once a record, so the best). */
const RIM_STEPS = 16;

const marchOut = new Float64Array(6);
const PROFILES = new Map<string, Float32Array>();

/**
 * The painted rim's table: for each of `RIM_PROFILE_SIZE` heights `u` from the ground (0) to the top of the shell (1), the
 * light the limb's air sends to an eye far off along a ray whose nearest approach is that high, the star overhead there (so a
 * phase of 90 degrees: the lit limb seen side on), per unit of the star's light: RGBA, the A its share of what lies behind
 * that comes through (1 less the grey of the march's transmittance). Kept by the record's numbers.
 */
export function rimProfile(rec: ArrayLike<number>): Float32Array {
  const key = recordKey(rec);
  const had = PROFILES.get(key);
  if (had) return had;
  const out = new Float32Array(RIM_PROFILE_SIZE * 4);
  const bottom = rec[F.bottom];
  const top = rec[F.top];
  if (!(top > bottom) || !(bottom > 0)) {
    PROFILES.set(key, out);
    return out;
  }
  const tabs = makeTables(rec, RIM_TABLES);
  // The eye far off down -z, the rays along +z offset in x by the height asked; the star along +x, overhead at the limb.
  const far = bottom * 40;
  for (let i = 0; i < RIM_PROFILE_SIZE; i++) {
    // Laid by the square of the height's share, as the march lays its steps: the limb's light is nearly all in the lowest
    // tenth of the shell (the haze and the dense air), which these put most of the table in.
    const t = i / (RIM_PROFILE_SIZE - 1);
    const u = t * t;
    const b = bottom + u * (top - bottom) * 0.999 + (top - bottom) * 0.0005;
    marchAir(rec, tabs, b, 0, -far, 0, 0, 1, 1, 0, 0, RIM_STEPS, NaN, null, marchOut, BODY_LAY);
    out[i * 4] = marchOut[0];
    out[i * 4 + 1] = marchOut[1];
    out[i * 4 + 2] = marchOut[2];
    out[i * 4 + 3] = 1 - (marchOut[3] + marchOut[4] + marchOut[5]) / 3;
  }
  PROFILES.set(key, out);
  return out;
}

/**
 * The painted rim's light at a pixel, per unit of the star's light (`rimProfile`'s rule as the graphs read it, here for the tests
 * and the map's globes' check): `rho` the ray's nearest approach over the ground's radius, `muS` the star's height over the
 * nearest point (its cosine), `shell` the shell's top over the ground's radius; into `out` RGB. Past the top nothing; over the
 * disc the limb's light at the ground's height times the slant path's share of the grazing one.
 */
export function paintedRimAt(profile: Float32Array, rho: number, muS: number, shell: number, strength: number, out: Float64Array | number[]): Float64Array | number[] {
  out[0] = out[1] = out[2] = 0;
  if (!(shell > 1) || rho >= shell) return out;
  const u = rho > 1 ? (rho - 1) / (shell - 1) : 0;
  // The table is laid by the square of the height's share (`rimProfile`), so it is read at the share's square root.
  const x = Math.sqrt(u) * (RIM_PROFILE_SIZE - 1);
  const i0 = Math.min(RIM_PROFILE_SIZE - 1, Math.floor(x));
  const i1 = Math.min(RIM_PROFILE_SIZE - 1, i0 + 1);
  const f = x - i0;
  // Over the disc: the air between the eye and the ground is the slant path, about the shell's height over the cosine there,
  // against the grazing ray's about the square root of twice the radius times the height: their ratio, held to 1.
  const graze = Math.sqrt((shell - 1) * 0.5);
  const inside = rho < 1 ? Math.min(1, graze / Math.sqrt(Math.max(1 - rho * rho, 1e-6))) : 1;
  const lit = smooth(RIM_LIT.from, RIM_LIT.to, muS);
  const k = inside * lit * strength;
  for (let c = 0; c < 3; c++) out[c] = (profile[i0 * 4 + c] * (1 - f) + profile[i1 * 4 + c] * f) * k;
  return out;
}

/** Where the painted rim lights by the star's height over the limb (a cosine): out from just past twilight to well up. */
export const RIM_LIT = { from: -0.2, to: 0.35 };

function smooth(a: number, b: number, x: number): number {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/**
 * The space rims' dials (feel is the owner's; each start's reason beside it). Moved through `tuneSpaceRims` (the console's
 * `__debug.spaceRims({ tune })`), read by the drawing a frame.
 */
export const SPACE_RIM_TUNE = {
  /**
   * The painted rim's strength over the limb's own light (1: the scattered rim's own light at the lit limb). 1 to start: the
   * painted rim stands for the scattered one, so on Low a planet's rim reads as it does on High at its lit limb.
   */
  painted: 1,
  /** The prover's switch: 1 draws no rim at all (the planets as before this wave): an A/B on one screen. */
  off: 0,
};

export const SPACE_RIM_RANGE = { painted: [0, 8], off: [0, 1] } as const;

/** Set the rims' dials from the console's argument, each held to its range; words for anything held or refused. */
export function tuneSpaceRims(o: Record<string, unknown>): string[] {
  const said: string[] = [];
  if (!o || typeof o !== 'object') return ['the rims take { painted, off }'];
  const t = SPACE_RIM_TUNE as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(o)) {
    const r = (SPACE_RIM_RANGE as Record<string, readonly [number, number]>)[k];
    if (!r) {
      said.push(`${k}: no such dial`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`${k}: not a number`);
      continue;
    }
    const held = v < r[0] ? r[0] : v > r[1] ? r[1] : v;
    if (held !== v) said.push(`${k}: held to ${held}`);
    t[k] = held;
  }
  return said;
}
