// The sky's dials of look (the GPU port's pass 2, wave 1; src/ui/dials.ts): the sun discs, the pair's height under the
// caster and the hours' low sun, on sliders in the debug menu when `sky` is picked (wave 1's night floor went with wave 2's
// eye, whose dials are the `exposure` helper's). Each is set through `tuneSky`, exactly as `__debug.sky({ disc, pair, hours
// })` sets it, so the menu's copied line is that helper's own argument. Feel and look are the owner's: each number starts
// where the wave says, with its reason beside the table it moves (`DISC_TUNE` here, `stars.ts`'s `PAIR_TUNE`,
// `skyHours.ts`), and nobody tunes it by measuring. A world's own air (its visibility, its steer toward SWG and its ozone's
// limits) is the air's maker's (`airParams.ts`), and more groups join the same set through `SKY_DIAL_GROUPS`.
//
// Pure: no three, no DOM; a node test moves every dial through the real tables.
import type { DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { PAIR_TUNE } from './stars.ts';
import { SKY_HOURS } from './skyHours.ts';

/**
 * The discs' look (`airSky.ts` reads it once a render):
 *   - `limb`: the limb darkening's share (a disc's edge at one less it of its middle, `1 − limb (1 − μ)`); 0.6 is our own
 *     sun's in the visible, near enough every star of the table.
 *   - `edge`: the share of a disc's radius its rim softens over; 0.15 is about a pixel at 1440 lines for a disc of a third of
 *     a degree, so the rim neither steps nor blurs.
 *   - `gain`: the discs' light over what the air sends (1: the star's own), in the world and the reflections' capture alike.
 *     Console only: a real sun is some 45,000 times a sunlit white wall and the chain clips the scene at 256 times one
 *     before the bloom (`gpuChain.ts`'s sanitize), so any gain over about 0.006 looks the same in the world.
 *   - `stops`: the sun you SEE, in stops under the star's own light (each a halving), the world only; the capture keeps
 *     the star's light under its own cap (`CAPTURE_TUNE.sunCap`). 0 to start (the star's own, as before); nothing changes
 *     until about −8, where the disc comes under the clip, and −10 to −14 tames its glow. The owner's to set.
 */
export const DISC_TUNE = { limb: 0.6, edge: 0.15, gain: 1, stops: 0 };

/** The ranges every number of `tuneSky` is held to, the sliders' and the console's alike. */
export const SKY_TUNE_RANGE = {
  disc: { limb: [0, 0.95], edge: [0.01, 0.6], gain: [0, 4], stops: [-16, 0] },
  pair: { belowDeg: [0, 12] },
  hours: { lowDeg: [0.5, 15] },
} as const;

type Section = keyof typeof SKY_TUNE_RANGE;
const TABLES: { [K in Section]: Record<string, number> } = { disc: DISC_TUNE, pair: PAIR_TUNE, hours: SKY_HOURS };

/**
 * Set the sky's look from the console's argument (`{ disc: { limb, edge, gain }, pair: { belowDeg }, hours: { lowDeg } }`):
 * each number held to its range, words for anything held or refused.
 */
export function tuneSky(o: Record<string, unknown>): string[] {
  const said: string[] = [];
  for (const s of Object.keys(SKY_TUNE_RANGE) as Section[]) {
    const part = o[s];
    if (part === undefined) continue;
    if (!part || typeof part !== 'object') {
      said.push(`${s}: not a record`);
      continue;
    }
    const range = SKY_TUNE_RANGE[s] as Record<string, readonly [number, number]>;
    for (const [k, v] of Object.entries(part as Record<string, unknown>)) {
      const r = range[k];
      if (!r) {
        said.push(`${s}.${k}: no such dial`);
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        said.push(`${s}.${k}: not a number`);
        continue;
      }
      const held = v < r[0] ? r[0] : v > r[1] ? r[1] : v;
      if (held !== v) said.push(`${s}.${k}: held to ${held}`);
      TABLES[s][k] = held;
    }
  }
  return said;
}

/** A number of one of the tables, set through `tuneSky`. */
function dial(s: Section, k: string, label: string, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  const r = (SKY_TUNE_RANGE[s] as Record<string, readonly [number, number]>)[k];
  return { kind: 'number', key: `${s}.${k}`, label, note, min: r[0], max: r[1], step, unit, get: () => TABLES[s][k], set: (v) => tuneSky({ [s]: { [k]: v } }), text };
}

const GROUPS: DialGroup[] = [
  {
    title: 'The sun discs',
    note: "Each star of the world's system as a disc of its own colour and size (src/sky/stars.ts), reddening and dimming through the air, gone under the land, faded by the storms.",
    dials: [
      dial('disc', 'limb', 'Limb darkening', 0.05, '', "How much darker a disc's edge is than its middle: 0.6 is our sun's."),
      dial('disc', 'edge', 'Rim softness', 0.01, '', "The share of a disc's radius its rim softens over: 0.15 is about a pixel at 1440 lines."),
      dial('disc', 'stops', 'Disc brightness', 0.25, 'stops', "The sun you see, in stops under the star's own light (each halves it): 0 is the star's own. A real sun is far past what the screen shows, so nothing changes until about -8; -10 to -14 tames its glow. Reflections keep theirs (reflections: The sun in the capture).", (v) => `${(2 ** v).toPrecision(2)}×`),
    ],
  },
  {
    title: "Tatooine's second sun",
    dials: [dial('pair', 'belowDeg', 'Under the caster', 0.1, '°', "How far under the casting sun the second runs on its arc: it rises after it and sets before it (the owner's decision of 18 November: 1.5°).")],
  },
  {
    title: 'The hours of __debug.sky',
    dials: [dial('hours', 'lowDeg', 'Sun at dawn and dusk', 0.5, '°', "How high the sun stands at __debug.sky('dawn') and ('dusk'): low enough to be reddened, high enough to be over the land.")],
  },
];

/** More groups for the same set (the air's maker's own dials join here, read when the set is first asked for). */
export const SKY_DIAL_GROUPS: (() => DialGroup)[] = [];

let SET: DialSet | null = null;

/** The sky's dials, with the values the game shipped (read the first time the set is asked for, before anything moved them). */
export function skyDialSet(): DialSet {
  if (!SET) {
    const groups = [...GROUPS, ...SKY_DIAL_GROUPS.map((g) => g())];
    SET = { helper: 'sky', groups, shipped: readDials(groups) };
  }
  return SET;
}

/** The dials the sky's helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function skyDialsFor(helper: string): DialSet | null {
  return helper === 'sky' ? skyDialSet() : null;
}
