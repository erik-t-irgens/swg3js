// The suns of the star systems (the GPU port's pass 2, wave 1; the design's 2.4): each system's stars as the air draws
// them, a disc that reddens and dims through each world's air, and nothing new that lights the scene. Ours, every number:
// SWG's files carry a sun picture a world and no star at all, so the colours, sizes and strengths here are the canon
// systems' as we read them, written as starts the owner moves (feel and look are his), each with its reason.
//
// A world's suns come from its system (`src/data/galaxy.ts`'s `systemOf`), so two worlds of one system share one star:
// Naboo and Rori both stand under Naboo's sun, Corellia and Talus under Corell. A world of no system (a heroic, the
// gallery, a world of the owner's own) takes the plain star, or the table's own word for it (`WORLD_SYSTEM`: Hoth's
// Echo Base is the heroic `adventure2`, under Hoth's blue-white sun).
//
// Tatooine's pair (decided on 18 November): the casting sun keeps the day's own path, and the second runs `PAIR_TUNE.belowDeg`
// below it in the caster's own vertical plane, so it rises after the caster and sets before it (SWG hangs it higher); it
// lights the world through the existing fill light, unshadowed, and both directions are kept for a later two-sun shadow.
// Since the GPU port's pass 2, wave 6 (maker K, the owner's ask of 23 November) `PAIR_TUNE.angleDeg` turns it round the
// caster (0 below as decided, 90 beside, 180 above), applied system or not.
//
// Pure: no three, no DOM; the node test imports it. Nothing here runs a frame but `pairDirectionIn`, which allocates nothing.

import { systemOf } from '../data/galaxy.ts';

/** One star as seen from its system's worlds. */
export interface SunSpec {
  /** A name for the console. */
  readonly name: string;
  /** Its colour as a black body's temperature, kelvin: the disc's colour and the light it sends, before the air. */
  readonly kelvin: number;
  /** The disc's angular radius as its worlds see it, degrees (our sun from Earth: 0.267). */
  readonly radiusDeg: number;
  /** Its light at its worlds against the system's caster (the first star, always 1): what the air scales it by. */
  readonly strength: number;
}

/** A system's stars, the caster first. */
export interface StarSystemSuns {
  /** The galaxy's system id (`galaxy.ts`), or `plain` for a world of none. */
  readonly system: string;
  readonly suns: readonly SunSpec[];
}

/**
 * Every system's stars. The caster's strength is 1 everywhere: what sets a world's daylight is the air's units
 * (`AIR_UNITS.scene`, a clear Tatooine noon's sun at today's key light there), and a star's strength says only how it stands against its
 * system's caster. Radii are near our sun's 0.267 degrees but where canon or the world's look says otherwise.
 */
export const STAR_SYSTEMS: Readonly<Record<string, StarSystemSuns>> = {
  // Tatoo I and II: a yellow-white caster a little larger in the sky than ours (the films' two discs read large), and an
  // orange companion, smaller and weaker, so the pair reads as two different stars rather than one doubled.
  tatoo: {
    system: 'tatoo',
    suns: [
      { name: 'Tatoo I', kelvin: 5900, radiusDeg: 0.32, strength: 1 },
      { name: 'Tatoo II', kelvin: 4600, radiusDeg: 0.24, strength: 0.45 },
    ],
  },
  // Naboo's sun, which Rori shares: a sun like ours.
  naboo: { system: 'naboo', suns: [{ name: 'Naboo', kelvin: 5700, radiusDeg: 0.27, strength: 1 }] },
  // Corell, Corellia's and Talus's: like ours.
  corellian: { system: 'corellian', suns: [{ name: 'Corell', kelvin: 5800, radiusDeg: 0.27, strength: 1 }] },
  // Kashyyyk's: a touch warmer, the wooded world's long light.
  kashyyyk: { system: 'kashyyyk', suns: [{ name: 'Kashyyyk', kelvin: 5500, radiusDeg: 0.27, strength: 1 }] },
  // Dathomir's: a cooler, redder star, under which its red-tinged sky reads as the world's own light.
  dathomir: { system: 'dathomir', suns: [{ name: 'Dathomir', kelvin: 4400, radiusDeg: 0.3, strength: 1 }] },
  // Yavin's star, far past the gas giant Yavin 4 circles: a little smaller in the sky.
  yavin: { system: 'yavin', suns: [{ name: 'Yavin', kelvin: 5900, radiusDeg: 0.25, strength: 1 }] },
  // Endor's sun over the forest moon.
  endor: { system: 'endor', suns: [{ name: 'Endor', kelvin: 5600, radiusDeg: 0.26, strength: 1 }] },
  dantooine: { system: 'dantooine', suns: [{ name: 'Dantooine', kelvin: 6000, radiusDeg: 0.26, strength: 1 }] },
  // Karthakk, Lok's: an orange star over the badlands.
  karthakk: { system: 'karthakk', suns: [{ name: 'Karthakk', kelvin: 4800, radiusDeg: 0.3, strength: 1 }] },
  // Mustafar's: a hot white star seen through the ash.
  mustafar: { system: 'mustafar', suns: [{ name: 'Mustafar', kelvin: 6400, radiusDeg: 0.26, strength: 1 }] },
  // Hoth's: blue-white, small in the sky (the design's 2.4), so the ice world's light is cold.
  hoth: { system: 'hoth', suns: [{ name: 'Hoth', kelvin: 9500, radiusDeg: 0.22, strength: 1 }] },
  kessel: { system: 'kessel', suns: [{ name: 'Kessel', kelvin: 5200, radiusDeg: 0.27, strength: 1 }] },
  ord_mantell: { system: 'ord_mantell', suns: [{ name: 'Ord Mantell', kelvin: 5800, radiusDeg: 0.27, strength: 1 }] },
  // A world of no system: a sun like ours.
  plain: { system: 'plain', suns: [{ name: 'the sun', kelvin: 5778, radiusDeg: 0.267, strength: 1 }] },
};

/** Worlds of no galaxy system that the table names a system for anyway (the PLANETS id to a key of `STAR_SYSTEMS`). */
export const WORLD_SYSTEM: Readonly<Record<string, string>> = {
  // The Battle of Echo Base's heroic is Hoth's ice.
  adventure2: 'hoth',
};

/** A world's stars (a PLANETS id): its system's, the table's own word for it, else the plain star. */
export function starsOf(planetId: string): StarSystemSuns {
  const own = WORLD_SYSTEM[planetId];
  if (own && STAR_SYSTEMS[own]) return STAR_SYSTEMS[own];
  const sys = systemOf(planetId);
  const s = sys ? STAR_SYSTEMS[sys.id] : undefined;
  return s ?? STAR_SYSTEMS.plain;
}

/**
 * (The GPU port's sky round, maker L, the brief's H: "size of sun and color of sun based on the system you're in") The suns
 * of the star system the bodies file applies to the world one stands on (`src/sky/system/systemSuns.ts`' `useSystemSuns`,
 * set behind each loading screen before anything reads a sun): its caster's and its pair's second sun's colour as a
 * temperature, brightness and size, which `casterOf` and `secondOf` hand every reader (the air's record, the disc, the flare,
 * the pair's gap) for that world alone. `caster` null: no system's word, and the table above as it always was.
 */
export const SYSTEM_SUNS: { planet: string; caster: SunSpec | null; second: SunSpec | null } = { planet: '', caster: null, second: null };

/** A world's casting sun: an applied system's (`SYSTEM_SUNS`) for the world it was set for, else the table's. */
export function casterOf(planetId: string): SunSpec {
  if (SYSTEM_SUNS.caster !== null && SYSTEM_SUNS.planet === planetId) return SYSTEM_SUNS.caster;
  return starsOf(planetId).suns[0];
}

/** A world's second sun, or null where its system has one (an applied system's word first, as `casterOf`). */
export function secondOf(planetId: string): SunSpec | null {
  if (SYSTEM_SUNS.caster !== null && SYSTEM_SUNS.planet === planetId) return SYSTEM_SUNS.second;
  const s = starsOf(planetId).suns;
  return s.length > 1 ? s[1] : null;
}

/**
 * (The sky round, maker L) The black body's temperature whose colour is nearest a colour `#rrggbb` (its chromaticity: the
 * linear channels over their luminance against `kelvinToLinear`'s), kelvin, 1,000 to 40,000: a coarse scan in steps of a
 * twentieth of a stop, then halving about the best. A star's colour in the viewer read as the temperature the air sends.
 * Worked once a star at a loading screen; null for no colour.
 */
export function kelvinOfColour(hex: string | null | undefined): number | null {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(parseInt(hex.slice(1, 3), 16));
  const g = lin(parseInt(hex.slice(3, 5), 16));
  const b = lin(parseInt(hex.slice(5, 7), 16));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (!(l > 1e-6)) return null;
  const want = [r / l, g / l, b / l];
  const c = [1, 1, 1];
  const miss = (k: number): number => {
    kelvinToLinear(k, c);
    return (c[0] - want[0]) ** 2 + (c[1] - want[1]) ** 2 + (c[2] - want[2]) ** 2;
  };
  const lo = Math.log2(1000);
  const hi = Math.log2(40000);
  let best = lo;
  let bestMiss = Infinity;
  for (let x = lo; x <= hi + 1e-9; x += 0.05) {
    const m = miss(2 ** x);
    if (m < bestMiss) {
      bestMiss = m;
      best = x;
    }
  }
  let a = best - 0.05;
  let z = best + 0.05;
  for (let i = 0; i < 40; i++) {
    const m1 = a + (z - a) / 3;
    const m2 = z - (z - a) / 3;
    if (miss(2 ** m1) < miss(2 ** m2)) z = m2;
    else a = m1;
  }
  return Math.round(2 ** ((a + z) / 2));
}

// ---------------------------------------------------------------- a star's colour

/** Planck's and Boltzmann's constants and the speed of light, SI (the black body's radiance). */
const H = 6.62607015e-34;
const C = 2.99792458e8;
const K = 1.380649e-23;

/** One lobe of the CIE 1931 matching functions' fit by Wyman, Sloan and Shirley (JCGT 2013): a Gaussian with a width either side. */
function lobe(l: number, mu: number, s1: number, s2: number): number {
  const t = (l - mu) / (l < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}

/**
 * A black body's colour at `kelvin` as linear Rec. 709 (sRGB's primaries, D65 white), scaled to a luminance of 1, into
 * `out` as [r, g, b]: Planck's law summed over 380 to 780 nm at 5 nm through the CIE 1931 matching functions (their
 * multi-lobe fit), XYZ to linear sRGB by the standard matrix, a channel under nought (a very hot star's red) held at
 * nought. A 6,500 K star comes out near white; ours (5,778 K) a little warm; a 9,500 K one blue-white; 3,000 K orange.
 * Worked once a star at load; nothing a frame calls it.
 */
export function kelvinToLinear(kelvin: number, out: Float64Array | number[]): void {
  const T = kelvin > 500 ? kelvin : 500;
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let nm = 380; nm <= 780; nm += 5) {
    const l = nm * 1e-9;
    const b = (2 * H * C * C) / (l ** 5 * (Math.exp((H * C) / (l * K * T)) - 1));
    const x = 1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
    const y = 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
    const z = 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
    X += b * x;
    Y += b * y;
    Z += b * z;
  }
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const bl = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const rr = r > 0 ? r : 0;
  const gg = g > 0 ? g : 0;
  const bb = bl > 0 ? bl : 0;
  const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
  const s = lum > 0 ? 1 / lum : 0;
  out[0] = rr * s;
  out[1] = gg * s;
  out[2] = bb * s;
}

// ---------------------------------------------------------------- Tatooine's pair

/**
 * The pair's rule (the owner's decision of 18 November, and his ask of 23 November for the angle), two dials of the sky's
 * (`__debug.sky({ pair })`, the debug menu's "Tatooine's second sun"):
 *   - `belowDeg`, "Distance from the first": how far from the caster the second sun stands, degrees from middle to middle
 *     along the sky. 1.5 is the decision's own number, small enough that the two discs read as a pair at noon and large
 *     enough that the second visibly rises after and sets before.
 *   - `angleDeg`, "Angle round the first": where round the caster it stands, in the caster's own tangent frame: 0 straight
 *     below it (today's rule, to the bit: the decision's), 90 beside it, ahead on the side the sun's path runs toward (where the
 *     caster goes next), 180 above it, -90 beside it behind. 0 to start: the decision's pair, nothing moved until he moves it.
 * Under a star system he applied in the viewer the system's own Line angle and Separation say where the pair stands
 * (`src/sky/system/skyMotion.ts`), measured the same way (its Line angle is this angle less 90: its -90 below, 0 ahead, 90
 * above) and its separation the gap between the discs' edges; each loading screen of such a world sets these two dials to
 * what the system says (`pairDialsFrom`), and a live move of either wins until the next screen (`PAIR_MOVES`).
 */
export const PAIR_TUNE = { belowDeg: 1.5, angleDeg: 0 };

/**
 * How many times the pair's dials were moved by hand (`tuneSky`, the menu's sliders and the console): an applied system's pair
 * (`skyMotion.ts`) stands by its own numbers until this moves after its loading screen, then by the dials.
 */
export const PAIR_MOVES = { n: 0 };

/** The pair's two dials' numbers. */
interface PairDials {
  belowDeg: number;
  angleDeg: number;
}

/** What the last loading screen set the pair's dials to from an applied system, and what they stood at before; null for none. */
let pairLent: { before: PairDials; to: PairDials } | null = null;

/**
 * A loading screen's word to the pair's dials (`World.followMotion`): an applied system's pair (`says`: its Line angle as
 * this dial's angle, its middles' distance as the screen draws them) sets them, so the menu shows what the sky shows and a
 * move starts from there; with no such pair, what an earlier screen set is put back, dial by dial, where it still stands
 * where that screen put it (the saved air's rule, `bodiesFile.ts`' `applyFileAir`). Never in a frame.
 */
export function pairDialsFrom(says: { angleDeg: number; distanceDeg: number } | null): void {
  if (pairLent) {
    if (PAIR_TUNE.belowDeg === pairLent.to.belowDeg) PAIR_TUNE.belowDeg = pairLent.before.belowDeg;
    if (PAIR_TUNE.angleDeg === pairLent.to.angleDeg) PAIR_TUNE.angleDeg = pairLent.before.angleDeg;
    pairLent = null;
  }
  if (!says) return;
  const before = { belowDeg: PAIR_TUNE.belowDeg, angleDeg: PAIR_TUNE.angleDeg };
  PAIR_TUNE.belowDeg = says.distanceDeg;
  PAIR_TUNE.angleDeg = says.angleDeg;
  pairLent = { before, to: { belowDeg: PAIR_TUNE.belowDeg, angleDeg: PAIR_TUNE.angleDeg } };
}

/** A direction's three fields. */
interface Dir {
  x: number;
  y: number;
  z: number;
}

/**
 * The second sun's direction for a caster's `c` (unit, +Y up), into `out`. At `PAIR_TUNE.angleDeg` 0 (today's rule, kept
 * line for line so it is the same to the bit): the caster's elevation less `PAIR_TUNE.belowDeg` at the caster's own azimuth,
 * so it stands under the caster on the caster's own arc of heights and meets the horizon after it rises and before it sets.
 * At any other angle: `belowDeg` along the sky from the caster toward `cos(angle) * down + sin(angle) * ahead`, the caster's
 * own tangent frame (down its vertical, and the level way the sun's path runs on, (-z, 0, x) of its azimuth), which at 0 is
 * the same place. A caster straight overhead has no azimuth: the second then stands toward +Z. Reads and writes the vectors'
 * own fields, so no number crosses the call (a number handed to a call the compiler leaves out is a number made): what a
 * frame calls. Allocates nothing. `src/sky/air/airRun.ts`' `pairInto` is its frame copy, held to it by `airRun.test.ts`.
 */
export function pairDirectionOf(c: Dir, out: Dir): void {
  const h = Math.sqrt(c.x * c.x + c.z * c.z);
  const y = c.y > 1 ? 1 : c.y < -1 ? -1 : c.y;
  if (PAIR_TUNE.angleDeg === 0) {
    const e = Math.asin(y) - (PAIR_TUNE.belowDeg * Math.PI) / 180;
    const ce = Math.cos(e);
    if (h > 1e-9) {
      out.x = (c.x / h) * ce;
      out.z = (c.z / h) * ce;
    } else {
      out.x = 0;
      out.z = ce;
    }
    out.y = Math.sin(e);
    return;
  }
  // The caster's tangent frame: its level way out (hx, hz), down its vertical (y hx, -h, y hz) and ahead (-hz, 0, hx).
  let hx = 0;
  let hz = 1;
  if (h > 1e-9) {
    hx = c.x / h;
    hz = c.z / h;
  }
  const t = (PAIR_TUNE.angleDeg * Math.PI) / 180;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const ox = ct * y * hx - st * hz;
  const oy = -ct * h;
  const oz = ct * y * hz + st * hx;
  const d = (PAIR_TUNE.belowDeg * Math.PI) / 180;
  const cd = Math.cos(d);
  const sd = Math.sin(d);
  const qx = cd * c.x + sd * ox;
  const qy = cd * y + sd * oy;
  const qz = cd * c.z + sd * oz;
  const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
  out.x = qx / ql;
  out.y = qy / ql;
  out.z = qz / ql;
}

/** The caster's three numbers held for `pairDirectionIn`. */
const CASTER: Dir = { x: 0.5, y: 0.5, z: 0.5 };

/** `pairDirectionOf` from the caster's three numbers (the tests' and the console's; a frame calls `pairDirectionOf`). */
export function pairDirectionIn(cx: number, cy: number, cz: number, out: Dir): void {
  CASTER.x = cx;
  CASTER.y = cy;
  CASTER.z = cz;
  pairDirectionOf(CASTER, out);
}
