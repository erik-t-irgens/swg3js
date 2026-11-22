// What the lens flare follows under our sky (the GPU port's pass 2, wave 3; the design's 2.9): the sun discs the air draws
// (`airSky.ts`), and at night the moon, the brightest body up by the air's own rule (`AIR.frame.lightDir`, wave 2's), each
// coloured by what the air lets through to the camera, written into the flare's kept records (`FxSkyLight`) as the sky's
// own sources were (`SwgSky.flareLights`), with the light a source sends a steradian beside them for the pass's read
// through the eye (`FLARE_SEEN`). Slot 0 is the light (the casting sun by day, the moon by night) and slot 1 Tatooine's
// second sun, so a slot's smoothed visibility always follows one body through a day.
//
// No three's WebGPU build here (only its core's vectors in the records): the world calls it on WebGPU under our sky.
import type { FxSkyLight } from '../../core/fx/lensFlare.ts';
import type { AirFrame } from '../air/airApi.ts';
import { angularRadius, DISC_FILL, GLOW_FILL, MAX_FLARE_SOURCES } from '../../core/fx/flareMath.ts';
import { casterOf, secondOf } from '../stars.ts';
import { FLARE_AIR } from './nightTune.ts';

/** Each slot's source's light a steradian toward the camera, luminance in the scene's units (the pass's `seen`); nought where none. */
export const FLARE_SEEN = { radiance: new Float64Array(MAX_FLARE_SOURCES) };

/**
 * The light a steradian that opens the pass's seen gate whatever the eye and the player's exposure (the GPU port's pass 2,
 * wave 3's fixer). Where the flare's sources are not the air's (a space zone's stars, a sky with no air) they are SWG's
 * sprites, whose own alpha is the flare's rule as on WebGL, so the gate must stand fully open there: this times the least
 * exposure the eye is held to (`PRE_FIXED.least`, 2^-12) and the player's least (two stops down) is over the seen band's
 * highest dial (`seenTo`'s 100) by some 6e5, and times the most (2^24, two stops up) still far inside a 32-bit float. Not a
 * dial: a gate's open state.
 */
export const FLARE_SEEN_OPEN = 1e12;

/**
 * Every slot's seen gate open (`FLARE_SEEN_OPEN`), for a frame whose sources are not the air's: the world calls it on WebGPU
 * wherever `airFlareLights` is not what wrote the sources, or the gate kept the last world's sun or moon (a space zone flared or
 * not by the hour the player left the ground, and never in a session begun in space). Writes a constant: allocates nothing.
 */
export function openFlareSeen(): void {
  const r = FLARE_SEEN.radiance;
  for (let i = 0; i < r.length; i++) r[i] = FLARE_SEEN_OPEN;
}

/** The sky body's size and glow as a sky's data gives them (`SkyData`'s `sun` and `moon`). */
interface BodyData {
  size: number;
  glowSize: number;
}

/** A world's flare bodies under our sky: each disc's and glow's angular radius (radians) and weight, worked once a sky. */
export interface AirFlareDiscs {
  sunRadius: number;
  sunGlow: number;
  sun2: boolean;
  sun2Radius: number;
  sun2Glow: number;
  sun2Weight: number;
  moon: boolean;
  moonRadius: number;
  moonGlow: number;
}

/**
 * The bodies for a world (`planet` a PLANETS id) and its sky's data: the suns' discs from the star table (`stars.ts`), their
 * glows from SWG's own sun glow where the sky has one (as the flare's veil and starburst were sized by it), else twelve discs
 * across; the moon's disc and glow from SWG's moon picture, which still draws it; Tatooine's second sun weighted by the
 * square root of its strength against the caster.
 */
export function airFlareDiscs(planet: string, sun: BodyData | null, moon: BodyData | null): AirFlareDiscs {
  const c = casterOf(planet);
  const s2 = secondOf(planet);
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const sunRadius = rad(c.radiusDeg);
  const sunGlow = sun && sun.glowSize > 0 ? angularRadius(sun.glowSize, GLOW_FILL) : sunRadius * 12;
  const sun2Radius = s2 ? rad(s2.radiusDeg) : sunRadius;
  const moonRadius = moon && moon.size > 0 ? angularRadius(moon.size, DISC_FILL) : 0;
  return {
    sunRadius,
    sunGlow,
    sun2: !!s2,
    sun2Radius,
    sun2Glow: s2 ? (sunGlow * s2.radiusDeg) / c.radiusDeg : 0,
    sun2Weight: s2 ? Math.sqrt(s2.strength) : 0,
    moon: moonRadius > 0,
    moonRadius,
    moonGlow: moon && moon.glowSize > 0 ? angularRadius(moon.glowSize, GLOW_FILL) : moonRadius * 3,
  };
}

/** Which body a slot is written from (plain numbers: node's stripped TypeScript takes no enum). */
const Body = { Sun: 0, Sun2: 1, Moon: 2 } as const;
type Body = (typeof Body)[keyof typeof Body];

/**
 * What the world hands in, kept in fields (a number handed across a call is a number made): the sky's distance, and the
 * flare's `nightSuns` switch (`flareTune({ nightSuns })`), which under our sky takes the night's flare, the moon's, out as it
 * takes Mustafar's night sun out under SWG's sky (the wave's fixer).
 */
export const AIR_FLARE_IN = { skyDistance: 3500.5, nightSuns: true };

/**
 * One record written from a body of the frame record: its direction, hue (brightest channel 1), shown or not, sizes and
 * weight, and the light it sends. Every number is read from the records' own fields, none handed in.
 */
function writeSlot(o: FxSkyLight, slot: number, f: AirFrame, d: AirFlareDiscs, body: Body, up: boolean): void {
  const dir = body === Body.Moon ? f.moonDir : body === Body.Sun2 ? f.sun2Dir : f.sunDir;
  const here = body === Body.Moon ? f.moonHere : body === Body.Sun2 ? f.sun2Here : f.sunHere;
  // Field by field (a setter handed numbers is a call the compiler may leave out, and then numbers are made).
  const od = o.dir;
  od.x = dir.x;
  od.y = dir.y;
  od.z = dir.z;
  const r = here.r;
  const g = here.g;
  const b = here.b;
  const m = r > g ? (r > b ? r : b) : g > b ? g : b;
  const k = m > 1e-30 ? 1 / m : 0;
  const oc = o.color;
  oc.r = k > 0 ? r * k : 1;
  oc.g = k > 0 ? g * k : 1;
  oc.b = k > 0 ? b * k : 1;
  o.alpha = up && m > 1e-30 ? 1 : 0;
  // Each body's numbers on a path of its own: one choice of three records' fields feeding one store made a number a frame
  // (measured: 16 B, `nightAlloc.test.ts`), each store fed one field does not.
  if (body === Body.Moon) {
    o.discRadius = d.moonRadius;
    o.glowRadius = d.moonGlow;
    o.weight = FLARE_AIR.moonWeight;
  } else if (body === Body.Sun2) {
    o.discRadius = d.sun2Radius;
    o.glowRadius = d.sun2Glow;
    o.weight = d.sun2Weight;
  } else {
    o.discRadius = d.sunRadius;
    o.glowRadius = d.sunGlow;
    o.weight = 1;
  }
  o.star = false;
  o.skyDistance = AIR_FLARE_IN.skyDistance;
  const disc = o.discRadius;
  FLARE_SEEN.radiance[slot] = o.alpha > 0 ? (0.2126 * r + 0.7152 * g + 0.0722 * b) / (Math.PI * disc * disc) : 0;
}

/**
 * The flare's sources from the air's frame record (`f`, written this frame), into `out` (the flare's kept records, at least
 * two); answers how many slots this world has. A body under the land, the moon by day, or the moon at night with
 * `AIR_FLARE_IN.nightSuns` off, is written with no light (alpha nought) and keeps its slot. The sky's distance is
 * `AIR_FLARE_IN.skyDistance`, written first (`SwgSky.flareSkyDistance`: the far ground's own where it is drawn). Reads the
 * records' fields and writes the kept records alone: allocates nothing.
 */
export function airFlareLights(out: readonly FxSkyLight[], f: AirFrame, d: AirFlareDiscs): number {
  if (out.length < 1) return 0;
  // Night: the moon sends more light to the ground than the sun (the air's own aim of the main light, wave 2).
  const L = f.lightDir;
  const M = f.moonDir;
  const night = d.moon && L.x * M.x + L.y * M.y + L.z * M.z > 0.9999;
  if (night) writeSlot(out[0], 0, f, d, Body.Moon, AIR_FLARE_IN.nightSuns && M.y > -d.moonRadius);
  else writeSlot(out[0], 0, f, d, Body.Sun, f.sunDir.y > -d.sunRadius);
  if (!d.sun2 || out.length < 2) return 1;
  writeSlot(out[1], 1, f, d, Body.Sun2, !night && f.sun2 && f.sun2Dir.y > -d.sun2Radius);
  return 2;
}
