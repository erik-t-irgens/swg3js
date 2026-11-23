// The eye's dials (the GPU port's pass 2, wave 2; src/ui/dials.ts; his demo's curve in the sky and light fix round): on
// sliders in the debug menu when `exposure` is picked, each set through `tuneEye`, exactly as `__debug.exposure({ tune })` sets
// it, so the menu's copied line is that helper's own argument. Feel is the owner's: each starts where `EYE_TUNE` says (his
// demo's value carried into our units), with its reason there, and nobody tunes it by measuring.
//
// More groups join the same set through `EYE_DIAL_GROUPS` (read the first time the set is asked for): maker L's Carried
// lights and the eye's top percentile (`src/sky/eyeLights.ts`, set through `__debug.exposure({ lights })`). The output's dither
// is the night sky's (`src/sky/night/dither.ts`, its slider in the `stars` set): the fix round's own, which sat here, was
// dropped when the two lines were merged, so the picture is dithered once.
//
// Pure: no three, no DOM.
import type { DialGroup, DialSet, NumberDial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';
import { EYE_DEMO, EYE_TUNE, EYE_TUNE_RANGE, tuneEye } from './eyeMath.ts';
import { eyeLightsGroup } from '../eyeLights.ts';

type Key = keyof typeof EYE_TUNE;

function dial(k: Key, label: string, step: number, unit: string, note: string): NumberDial {
  const [min, max] = EYE_TUNE_RANGE[k];
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => EYE_TUNE[k], set: (v) => tuneEye({ tune: { [k]: v } }) };
}

/** A log2 luminance of ours said as his demo's (its numbers are 2.72 stops brighter: the file's head in `eyeMath.ts`). */
const asDemo = (v: number): string => `his demo's ${(v - EYE_DEMO.shift).toFixed(2)}`;

const GROUPS: DialGroup[] = [
  {
    title: 'How bright the eye makes the scene',
    note: "His demo's eye: the scene's brightness measured (the middle of its spread, weighted to the middle of the view), held to the range below, a share of each stop made up past the knee, then brought to the key.",
    dials: [dial('key', 'Key', 0.01, '', 'The brightness a measured scene is brought to before the tone curve: 0.18 (mid grey, his demo\'s). Higher brightens everything the eye adapts to.')],
  },
  {
    title: 'How fast the eye follows',
    note: "Eased in stops, 1 − e^(−rate · seconds) of the way: his demo's rates.",
    dials: [
      dial('intoLight', 'Into light', 0.05, '/s', 'Toward a brighter scene: 2.6 per second settles the glare within about a second.'),
      dial('intoDark', 'Into the dark', 0.05, '/s', 'Toward a darker one: 1.1 per second lets a room read within about two seconds.'),
    ],
  },
  {
    title: 'Dark nights and bright days',
    note: "The scene's brightness in log2 of our scene's units (his demo's numbers less 2.72 stops). Under the knee only a share of each stop of darkness is made up, so dusk reads as dusk and a night as a night.",
    dials: [
      { ...dial('knee', 'Knee', 0.05, 'log2', 'Below this scene brightness only the share below of each further stop is made up: −4.72 (his demo\'s −2).'), text: asDemo },
      dial('share', 'Make-up share', 0.05, '', 'Of each stop of darkness under the knee, the share made up: 0.85 to start (his demo\'s 0.7 leaves every night black).'),
      { ...dial('low', 'Darkest adapted to', 0.1, 'log2', 'The darkest scene the eye adapts to; darker is left darker: −20.5 to start, a dark but readable night (his demo\'s −14 is −16.72 here, which leaves every night black).'), text: asDemo },
      { ...dial('high', 'Brightest adapted to', 0.1, 'log2', 'The brightest scene the eye adapts to; brighter is left brighter: 1.28 (his demo\'s 4).'), text: asDemo },
    ],
  },
  {
    title: 'What the eye looks at, and what glows',
    dials: [
      dial('centre', 'Centre weight', 0.25, '×', "The middle of the view's extra weight in the count: 3 counts the very middle four times the edges (his demo's 16 against 4)."),
      dial('glow', 'Emissive compensation', 0.05, '', "Sabers, lamps, bolts, lit windows and every unlit surface: 1 keeps them as they looked at an exposure of 1 however far the eye opens; 0 lets them take the eye's exposure (sixteen times brighter at +4 stops)."),
    ],
  },
];

/** More groups for the same set, each made when the set is first asked for (pushed as their modules load). */
export const EYE_DIAL_GROUPS: (() => DialGroup)[] = [eyeLightsGroup];

let SET: DialSet | null = null;

/** The eye's dials (read the first time the set is asked for, before anything moved them). */
export function eyeDialSet(): DialSet {
  if (!SET) {
    const groups = [...GROUPS, ...EYE_DIAL_GROUPS.map((g) => g())];
    SET = { helper: 'exposure', groups, shipped: readDials(groups) };
  }
  return SET;
}

/** The dials the `exposure` helper of `__debug` has, or null. */
export function eyeDialsFor(helper: string): DialSet | null {
  return helper === 'exposure' ? eyeDialSet() : null;
}
