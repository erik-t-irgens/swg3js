// The night sky's dials (the GPU port's pass 2, wave 3; the brief's defaults of 22 November, the owner asleep): the stars'
// light and the eye's reach, the twinkle, the Milky Way's brightness, the towns' glow, the stars a tier draws, each world's
// tilt of its sky against the galaxy, and the flare's moon and how bright a source must look to flare (and, since the two
// lines' merge of 22 November, wave 4b's screen dither, set through `tuneDither` as `stars({ dither })` sets it). On sliders in
// the debug menu when `stars` is picked (`src/ui/dials.ts`), each set through `tuneNight`, exactly as `__debug.stars({ tune,
// counts, tilt, flare })` sets it, so the menu's copied line is that helper's own argument. Feel and look are the owner's:
// each number starts where the brief says, with its reason beside it, and nobody tunes it by measuring.
//
// Pure: no three, no DOM; a node test moves every dial through the real tables.
import type { DialGroup, DialSet, NumberDial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';
import { AIR_DIAL_WORLDS } from '../air/airDials.ts';
import { seedOf } from './starCatalogue.ts';
import { DITHER_RANGE, DITHER_TUNE, tuneDither } from './ditherTune.ts';

/**
 * The look:
 *   - `stars` 1: the stars' light over their physical light (a star of magnitude m sends the sun's 10^(−0.4 (m + 26.74)));
 *   - `seeing` 0: magnitudes added to the dark-adapted eye's limit (`limitingMag`), so a star shows only where a real eye would
 *     see it against the sky behind it; above nought sees fainter stars, below fewer;
 *   - `twinkle` 0.3: the share of a star's light that flickers at the horizon, nought at the zenith and growing with the air it
 *     looks through (the brief's "subtle by default");
 *   - `twinkleRate` 4: flickers a second, about: slow enough to read as a twinkle at sixty frames, not as noise;
 *   - `milkyWay` 1: the band over its physical brightness (the brief's default: seen only on dark nights with the eye open);
 *   - `cityGlow` 1: the towns' glow over its start (`CITY_GLOW`).
 */
export const NIGHT_TUNE = { stars: 1, seeing: 0, twinkle: 0.3, twinkleRate: 4, milkyWay: 1, cityGlow: 1 };

/** The stars each tier draws, the brightest first (the brief's 2,000 Low, 4,000 Medium, 8,000 High, 12,000 Ultra). */
export const STAR_COUNTS = { low: 2000, medium: 4000, high: 8000, ultra: 12000 };

/**
 * The towns' glow (`cityGlow.ts`), each of `pois.json`'s cities with a reach:
 *   - `strength` 6.5e-8: the sky's light at the horizon over a town of 300 m reach from inside it, in the scene's units: so
 *     inside Mos Eisley (456 m) the horizon glows about one and a half moonlit skies (1e-7 each), and from 2 km a sixth of
 *     that low in its direction, a warm glow that hides the faint stars there;
 *   - `falloff` 2.5 and `near` 1000: how it fades with distance, `1 / (1 + (d / near)^falloff)`: Walker's law of a town's sky
 *     glow (the distance to the −2.5) far off, levelling off near and inside the town, where the law would grow without end;
 *   - `width` 0.35: the glow's half-width round the horizon past the town's own angle, radians;
 *   - `height` 0.12: how high it climbs, radians (a few degrees: low over the horizon), more for a near town;
 *   - `kelvin` 3200: its colour, a town's warm lamps scattered back by the air.
 */
export const CITY_GLOW = { strength: 6.5e-8, falloff: 2.5, near: 1000, width: 0.35, height: 0.12, kelvin: 3200 };

/**
 * The flare under our sky (`flareSources.ts`, `gpuFlare.ts`):
 *   - `moonWeight` 0.7: the moon's flare against the sun's (a camera facing a bright moon at night shows a glare and ghosts,
 *     a little less of them than facing the sun);
 *   - `seenFrom` 1 and `seenTo` 8: how bright a source must look on the screen to flare at all and to flare fully, in the
 *     display's own light (1 is white): a sun under the land or a moon in the day's blue flares none, read through the eye.
 */
export const FLARE_AIR = { moonWeight: 0.7, seenFrom: 1, seenTo: 8 };

/** A world's sky against the galaxy: the galactic pole's tilt off the world's celestial pole and its turn about it, degrees. */
export interface WorldTilt {
  tiltDeg: number;
  nodeDeg: number;
}

/** The worlds' tilts moved from their seeded starts (by the dials or the console). */
const TILTS = new Map<string, WorldTilt>();

/**
 * A world's tilt (two seeded dials, the design's 2.7): its galactic pole from 20 to 80 degrees off its celestial pole (so the
 * band crosses the sky at a slant that differs world to world, as the Milky Way's does at Earth's 63) and turned anywhere
 * about it, both from the world's name, so every browser sees the same sky; moved by the dials, kept for the session.
 */
export function tiltOf(world: string): WorldTilt {
  let t = TILTS.get(world);
  if (!t) {
    const s = seedOf(`tilt:${world}`);
    t = { tiltDeg: 20 + ((s & 0xffff) / 0xffff) * 60, nodeDeg: ((s >>> 16) / 0xffff) * 360 };
    t.tiltDeg = Math.round(t.tiltDeg * 10) / 10;
    t.nodeDeg = Math.round(t.nodeDeg * 10) / 10;
    TILTS.set(world, t);
  }
  return t;
}

/** A count every move of a dial adds to, so the sky reads its numbers again only when one moved. */
export const NIGHT_STATE = { version: 0 };

/** The ranges every number of `tuneNight` is held to, the sliders' and the console's alike. */
export const NIGHT_TUNE_RANGE = {
  tune: { stars: [0, 8], seeing: [-3, 3], twinkle: [0, 1], twinkleRate: [0.5, 12], milkyWay: [0, 50], cityGlow: [0, 20] },
  counts: { low: [0, 12000], medium: [0, 12000], high: [0, 12000], ultra: [0, 12000] },
  tilt: { tiltDeg: [0, 180], nodeDeg: [0, 360] },
  flare: { moonWeight: [0, 1.5], seenFrom: [0.05, 20], seenTo: [0.1, 100] },
} as const;

/** Hold a number to a range; words when it was held or refused. */
function held(path: string, v: unknown, r: readonly [number, number], said: string[]): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    said.push(`${path}: not a number`);
    return null;
  }
  const h = v < r[0] ? r[0] : v > r[1] ? r[1] : v;
  if (h !== v) said.push(`${path}: held to ${h}`);
  return h;
}

/**
 * Set the night sky's dials from the console's argument (`{ tune: { stars, seeing, twinkle, twinkleRate, milkyWay, cityGlow },
 * counts: { low, medium, high, ultra }, tilt: { <world>: { tiltDeg, nodeDeg } }, flare: { moonWeight, seenFrom, seenTo } }`):
 * each held to its range, words for anything held or refused.
 */
export function tuneNight(o: Record<string, unknown>): string[] {
  const said: string[] = [];
  const flat = (section: 'tune' | 'counts' | 'flare', table: Record<string, number>): void => {
    const part = o[section];
    if (part === undefined) return;
    if (!part || typeof part !== 'object') {
      said.push(`${section}: not a record`);
      return;
    }
    const range = NIGHT_TUNE_RANGE[section] as Record<string, readonly [number, number]>;
    for (const [k, v] of Object.entries(part as Record<string, unknown>)) {
      if (!range[k]) {
        said.push(`${section}.${k}: no such dial`);
        continue;
      }
      const h = held(`${section}.${k}`, v, range[k], said);
      if (h !== null) table[k] = section === 'counts' ? Math.round(h) : h;
    }
  };
  flat('tune', NIGHT_TUNE);
  flat('counts', STAR_COUNTS);
  flat('flare', FLARE_AIR);
  const tilt = o.tilt;
  if (tilt !== undefined) {
    if (!tilt || typeof tilt !== 'object') said.push('tilt: not a record');
    else {
      for (const [world, part] of Object.entries(tilt as Record<string, unknown>)) {
        if (!part || typeof part !== 'object') {
          said.push(`tilt.${world}: not a record`);
          continue;
        }
        const t = tiltOf(world);
        for (const [k, v] of Object.entries(part as Record<string, unknown>)) {
          const r = (NIGHT_TUNE_RANGE.tilt as Record<string, readonly [number, number]>)[k];
          if (!r) {
            said.push(`tilt.${world}.${k}: no such dial`);
            continue;
          }
          const h = held(`tilt.${world}.${k}`, v, r, said);
          if (h !== null) (t as unknown as Record<string, number>)[k] = h;
        }
      }
    }
  }
  NIGHT_STATE.version++;
  return said;
}

/** The count a tier draws (`TIER_NAMES`' index 0 to 3; anything else, a custom set of settings, High's). */
export function countOfTier(tier: number): number {
  const c = tier === 0 ? STAR_COUNTS.low : tier === 1 ? STAR_COUNTS.medium : tier === 3 ? STAR_COUNTS.ultra : STAR_COUNTS.high;
  return c < 0 ? 0 : c > 12000 ? 12000 : Math.round(c);
}

// ---------------------------------------------------------------- the dials

function dial(section: 'tune' | 'counts' | 'flare', k: string, label: string, step: number, unit: string, note: string): NumberDial {
  const r = (NIGHT_TUNE_RANGE[section] as Record<string, readonly [number, number]>)[k];
  const table = (section === 'tune' ? NIGHT_TUNE : section === 'counts' ? STAR_COUNTS : FLARE_AIR) as Record<string, number>;
  return { kind: 'number', key: `${section}.${k}`, label, note, min: r[0], max: r[1], step, unit, get: () => table[k], set: (v) => tuneNight({ [section]: { [k]: v } }) };
}

function tiltDial(world: string, k: 'tiltDeg' | 'nodeDeg', label: string, note: string): NumberDial {
  const r = NIGHT_TUNE_RANGE.tilt[k];
  return { kind: 'number', key: `tilt.${world}.${k}`, label, note, min: r[0], max: r[1], step: 0.5, unit: '°', get: () => tiltOf(world)[k], set: (v) => tuneNight({ tilt: { [world]: { [k]: v } } }) };
}

function groups(): DialGroup[] {
  const out: DialGroup[] = [
    {
      title: 'The stars',
      note: "Each system's own field (src/sky/night/starCatalogue.ts), at its physical light, seen only where a dark-adapted eye would see it against the sky behind it.",
      dials: [
        dial('tune', 'stars', 'Star brightness', 0.05, '×', "The stars' light over their physical light: 1 is a real sky's."),
        dial('tune', 'seeing', 'Eye reaches', 0.1, 'mag', "Magnitudes added to what a dark-adapted eye sees against the sky (Schaefer's limit): above nought shows fainter stars."),
        dial('tune', 'twinkle', 'Twinkle', 0.05, '', "The share of a star's light that flickers at the horizon, none at the zenith: 0.3 is subtle."),
        dial('tune', 'twinkleRate', 'Twinkle speed', 0.5, '/s', 'Flickers a second, about.'),
      ],
    },
    {
      title: 'The stars a tier draws',
      note: 'The brightest of one buffer of 12,000: a tier moved changes a count, nothing is built.',
      dials: [
        dial('counts', 'low', 'Low', 500, '', 'Stars drawn on Low (the brief: 2,000).'),
        dial('counts', 'medium', 'Medium', 500, '', 'Stars drawn on Medium (4,000).'),
        dial('counts', 'high', 'High', 500, '', 'Stars drawn on High and on settings of your own (8,000).'),
        dial('counts', 'ultra', 'Ultra', 500, '', 'Stars drawn on Ultra (12,000).'),
      ],
    },
    {
      title: 'The Milky Way and the towns',
      note: "The band is the galaxy map's disc seen from the system's place (src/sky/night/galaxyDensity.ts); the towns are pois.json's cities.",
      dials: [
        dial('tune', 'milkyWay', 'Milky Way brightness', 0.1, '×', "The band over its physical brightness (1): under SWG's moon, which is up all night, it is faint, as a real one is under a full moon."),
        dial('tune', 'cityGlow', 'Town glow', 0.1, '×', "The towns' glow low over the horizon toward them, which hides the faint stars there: 1 makes the horizon inside Mos Eisley about one and a half moonlit skies, and a sixth of that from 2 km."),
      ],
    },
    {
      title: 'The flare under our sky',
      note: 'Follows the sun discs, and the moon at night, through the eye.',
      dials: [
        dial('flare', 'moonWeight', "The moon's flare", 0.05, '×', "The moon's flare against the sun's."),
        dial('flare', 'seenFrom', 'Flares from', 0.05, '×', 'How bright a source must look on the screen to flare at all (1 is white).'),
        dial('flare', 'seenTo', 'Flares fully at', 0.5, '×', 'How bright it must look to flare fully.'),
      ],
    },
    {
      // Pass 2, wave 4b's dither (`dither.ts`, `ditherTune.ts`), given its slider here when the sky and light fix round met it
      // (22 November): the picture is dithered once, by this, and `__debug.stars({ dither })` is the same dial.
      title: "The screen's dither",
      note: "WebGPU's: a triangular noise added to the picture after the tone curve, as the canvas rounds it to eight bits, so a dark sky's and a haze's smooth ramps show a fine grain instead of steps.",
      dials: [
        {
          kind: 'number',
          key: 'dither',
          label: 'Dither',
          note: 'Levels of 255 either way at the noise\'s widest: 1 the least that takes the rounding\'s steps off any picture, 0 none.',
          min: DITHER_RANGE[0],
          max: DITHER_RANGE[1],
          step: 0.25,
          unit: 'levels',
          get: () => DITHER_TUNE.amount,
          set: (v) => tuneDither(v),
        },
      ],
    },
  ];
  for (const [id, name] of AIR_DIAL_WORLDS) {
    out.push({
      title: `${name}'s sky against the galaxy`,
      note: 'Two seeded dials: how far the galactic pole stands off the world\'s celestial pole, and its turn about it.',
      dials: [
        tiltDial(id, 'tiltDeg', 'Band tilt', 'The galactic pole\'s angle off the celestial pole: the band\'s slant across the turning sky.'),
        tiltDial(id, 'nodeDeg', 'Band turn', 'Where round the celestial pole the galactic pole stands.'),
      ],
    });
  }
  return out;
}

let SET: DialSet | null = null;

/** The night sky's dials, with the values the game shipped (read the first time the set is asked for, before anything moved them). */
export function nightDialSet(): DialSet {
  if (!SET) {
    const g = groups();
    SET = { helper: 'stars', groups: g, shipped: readDials(g) };
  }
  return SET;
}

/** The dials the stars' helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function starsDialsFor(helper: string): DialSet | null {
  return helper === 'stars' ? nightDialSet() : null;
}
