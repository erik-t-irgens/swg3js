// The eye's dials (the GPU port's pass 2, wave 2; src/ui/dials.ts): on sliders in the debug menu when `exposure` is picked,
// each set through `tuneEye`, exactly as `__debug.exposure({ tune })` sets it, so the menu's copied line is that helper's own
// argument. Feel is the owner's: each starts where `EYE_TUNE` says, with its reason there, and nobody tunes it by measuring.
//
// Pure: no three, no DOM.
import type { DialGroup, DialSet, NumberDial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';
import { EYE_TUNE, EYE_TUNE_RANGE, tuneEye } from './eyeMath.ts';

type Key = keyof typeof EYE_TUNE;

function dial(k: Key, label: string, step: number, unit: string, note: string): NumberDial {
  const [min, max] = EYE_TUNE_RANGE[k];
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => EYE_TUNE[k], set: (v) => tuneEye({ tune: { [k]: v } }) };
}

const GROUPS: DialGroup[] = [
  {
    title: 'How fast the eye follows',
    note: 'Eased in stops by an exponential of its own time constant: three of them take it about the whole way.',
    dials: [
      dial('intoLight', 'Into light', 0.01, 's', 'The time constant toward a brighter scene: 0.3 s settles the glare within about a second.'),
      dial('intoDark', 'Into the dark', 0.01, 's', 'The time constant toward a darker one: 0.65 s lets a room read within about two seconds.'),
    ],
  },
  {
    title: 'Dark nights',
    note: 'Up to the knee every stop of darkness is made up; past it only a share of each, and never more than a few stops short.',
    dials: [
      dial('knee', 'Knee', 0.25, 'stops', 'The stops over the day\'s exposure made up in full: a shaded street, an overcast day, a doorway.'),
      dial('share', 'Make-up share', 0.05, '', 'Of each stop past the knee, the share made up: 0.7 the design\'s.'),
      dial('most', 'Most stops short', 0.25, 'stops', 'The most the picture is kept darker than the full make-up: 4 the design\'s, so a moonlit night is dark but readable.'),
      dial('floor', "The eye's night floor", 0.5, 'stops', 'The most exposure over the day\'s the eye ever adds; it binds only where nothing at all is lit.'),
    ],
  },
  {
    title: 'What the eye looks at, and what glows',
    dials: [
      dial('centre', 'Centre weight', 0.25, '×', 'The middle of the view\'s extra weight in the count: 3 counts the very middle four times the edges.'),
      dial('glow', 'Emissive compensation', 0.05, '', 'Sabers, lamps, bolts, lit windows and every unlit surface: 1 keeps them as they looked at an exposure of 1 however far the eye opens; 0 lets them take the eye\'s exposure (sixteen times brighter at +4 stops).'),
    ],
  },
];

let SET: DialSet | null = null;

/** The eye's dials (read the first time the set is asked for, before anything moved them). */
export function eyeDialSet(): DialSet {
  if (!SET) SET = { helper: 'exposure', groups: GROUPS, shipped: readDials(GROUPS) };
  return SET;
}

/** The dials the `exposure` helper of `__debug` has, or null. */
export function eyeDialsFor(helper: string): DialSet | null {
  return helper === 'exposure' ? eyeDialSet() : null;
}
