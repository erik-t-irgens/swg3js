// The reflections' capture of the real sky, its numbers (the GPU port's pass 2, wave 2, maker B; the design's 2.3): how
// often the sky is taken again, how it is spread over the frames, and how the sun looks in it. Each is a dial on the debug
// menu's sliders when `reflections` is picked (src/ui/dials.ts), set through `tuneCapture`, exactly as
// `__debug.reflections({ tune })` sets it, so the menu's copied line is that helper's own argument. Look and feel are the
// owner's: each number starts where the design says, with its reason beside it, and nobody tunes it by measuring.
//
// Pure: no three, no DOM; the capture (`skyCapture.ts`) and our sky's disc in it (`airSky.ts`) read these fields, and a node
// test moves every dial through `tuneCapture`.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';

/**
 * - `every`: seconds between two refreshes of the sky's capture; 4 is the design's (2.3) and what the capture has always
 *   kept, often enough that a sky moving with the day never looks stale on a hull and seldom enough to cost little.
 * - `sunMoveDeg`: the light's turn since the last refresh that takes the sky again before `every` is up; 0.5 is the design's.
 *   The game's day turns the sun that far in about eleven seconds, so in play the clock comes first; an hour moved by hand (a
 *   held hour, the creator's slider) or the moon taking over from the sun comes at once.
 * - `pace`: `faces` draws one face of the cube a frame and filters on a seventh (the design's, so no frame carries the whole
 *   refresh), `once` all six and the filter on one frame, as the four-second capture before this wave did, to compare by.
 * - `sunDeg`: the least radius of a sun's disc in the capture, in degrees. The cube is 128 texels to a face, 0.7 degrees a
 *   texel, and a real disc of a quarter of a degree would fall between texels and flicker as it moved; at 1 its light, kept
 *   whole, is spread over about three texels across, so it never falls between them.
 * - `sunCap`: the most a sun's disc in the capture sends a steradian, as a share of the light that sun gives a surface
 *   facing it (so it follows the sun as it dims and reddens through the air). 4 makes a mirror's sun spot about a dozen times
 *   as bright as a white wall in full sun, which reads as the sun and is too dim and too wide to sparkle on a moving hull;
 *   uncapped, the spot is a thousand times the wall and every glossy pixel near it a spark.
 */
export const CAPTURE_TUNE: { every: number; sunMoveDeg: number; pace: 'faces' | 'once'; sunDeg: number; sunCap: number } = { every: 4.5, sunMoveDeg: 0.5, pace: 'faces', sunDeg: 1.5, sunCap: 4.5 };
// Begun as fractions (a field that will hold a fraction is started as one, CLAUDE.md), then set to the design's numbers.
CAPTURE_TUNE.every = 4;
CAPTURE_TUNE.sunDeg = 1;
CAPTURE_TUNE.sunCap = 4;

/** The ranges every number of `tuneCapture` is held to, the sliders' and the console's alike. */
export const CAPTURE_TUNE_RANGE = {
  every: [0.25, 30],
  sunMoveDeg: [0.05, 10],
  sunDeg: [0.25, 5],
  sunCap: [0, 1000],
} as const;

const PACES = ['faces', 'once'] as const;

/**
 * Set the capture's numbers from the console's argument (`{ every, sunMoveDeg, pace, sunDeg, sunCap }`): each number held to
 * its range, words for anything held or refused.
 */
export function tuneCapture(o: unknown): string[] {
  const said: string[] = [];
  if (o === undefined) return said;
  if (!o || typeof o !== 'object') return ['tune: not a record'];
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k === 'pace') {
      if (v === 'faces' || v === 'once') CAPTURE_TUNE.pace = v;
      else said.push(`tune.pace: 'faces' or 'once'`);
      continue;
    }
    const r = (CAPTURE_TUNE_RANGE as Record<string, readonly [number, number]>)[k];
    if (!r) {
      said.push(`tune.${k}: no such dial`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`tune.${k}: not a number`);
      continue;
    }
    const held = v < r[0] ? r[0] : v > r[1] ? r[1] : v;
    if (held !== v) said.push(`tune.${k}: held to ${held}`);
    (CAPTURE_TUNE as unknown as Record<string, number>)[k] = held;
  }
  return said;
}

function dial(k: keyof typeof CAPTURE_TUNE_RANGE, label: string, step: number, unit: string, note: string): NumberDial {
  const r = CAPTURE_TUNE_RANGE[k];
  return { kind: 'number', key: `tune.${k}`, label, note, min: r[0], max: r[1], step, unit, get: () => CAPTURE_TUNE[k], set: (v) => tuneCapture({ [k]: v }) };
}

const pace: ChoiceDial = {
  kind: 'choice',
  key: 'tune.pace',
  label: 'Spread over',
  note: "'faces': a face of the cube a frame and the filter on a seventh; 'once': the whole refresh on one frame, as before this wave.",
  choices: PACES,
  get: () => CAPTURE_TUNE.pace,
  set: (v) => tuneCapture({ pace: v }),
};

const GROUPS: DialGroup[] = [
  {
    title: "The sky's capture",
    note: "What every shiny surface reflects on WebGPU: the sky as drawn (our air's dome or SWG's, its moons and pictures, in space the skybox and the planets), taken again into a 128 px cube and filtered.",
    dials: [
      dial('every', 'Taken again every', 0.25, 's', "Seconds between two refreshes of the capture: 4 is the design's."),
      dial('sunMoveDeg', 'Or when the light turns', 0.05, '°', "A refresh comes sooner when the sun (or the moon by night) has turned this far since the last: 0.5 is the design's."),
      pace,
    ],
  },
  {
    title: 'The sun in the capture',
    note: "Our sky's discs as a shiny surface sees them: spread over a few texels so they never flicker, and capped so they never sparkle.",
    dials: [
      dial('sunDeg', 'Least disc radius', 0.05, '°', 'A disc smaller than this is spread to it, its light kept whole: 1 is about three texels of the cube across.'),
      dial('sunCap', 'Brightest it gets', 0.25, '×', "At most this share of the sun's own light a steradian: 4 makes a mirror's sun spot about a dozen times a white wall in full sun."),
    ],
  },
];

let SET: DialSet | null = null;

/** The capture's dials, with the values the game shipped (read the first time the set is asked for, before anything moved them). */
export function captureDialSet(): DialSet {
  if (!SET) SET = { helper: 'reflections', groups: GROUPS, shipped: readDials(GROUPS) };
  return SET;
}

/** The dials `__debug.reflections` has, or null: what the debug menu asks as a helper is picked. */
export function captureDialsFor(helper: string): DialSet | null {
  return helper === 'reflections' ? captureDialSet() : null;
}
