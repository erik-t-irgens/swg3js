// The moving air's dials (src/ui/dials.ts): the numbers of feel -- how fast the air is pulled to the wind, how gusty,
// how much it swirls, how fast the dust settles, how hard a jet or a blast pushes, how far a grain falls -- as sliders
// in the debug menu when `air` is picked. Each is set through `tuneAir`, exactly as `__debug.air({ tune })` sets it,
// so the line the menu copies out is that helper's own argument (`air({ tune: { dust: { settle: 4 } } })`). Every one is
// the owner's to judge by eye (CLAUDE.md, "Feel is the owner's"); a slider's range is ours, wide enough to try
// anything sensible. The technical numbers of the table (loop bounds, budgets, the window's size) have no slider.
//
// Pure: it imports the tune table and the dials' own types and nothing of the page.
import type { DialGroup, DialSet, NumberDial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';
import { AIR_TUNE, tuneAir } from './airTune.ts';

type Group = keyof typeof AIR_TUNE;

/** One number of `AIR_TUNE`, as a slider set through `tuneAir`. */
function dial(group: Group, key: string, label: string, min: number, max: number, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  const table = AIR_TUNE[group] as unknown as Record<string, number>;
  return {
    kind: 'number',
    key: `tune.${group}.${key}`,
    label,
    note,
    min,
    max,
    step,
    unit,
    get: () => table[key],
    set: (v) => tuneAir({ [group]: { [key]: v } }).notes,
    text,
  };
}

const kmh = (v: number): string => `${Math.round(v * 3.6)} km/h`;

const AIR_GROUPS: DialGroup[] = [
  {
    title: 'The wind',
    note: 'The planet\'s own wind, from the weather. The air is pulled toward it everywhere, and gust cells about 29 m across ride along it.',
    dials: [
      dial('solver', 'relax', 'Pull toward the wind', 0, 3, 0.05, '/s', 'How fast the air settles back to the wind after a jet or a blast has stirred it. Higher, a wake fills in sooner.'),
      dial('wind', 'gust', 'Gusts', 0, 2, 0.05, '', 'How much stronger and weaker, and how far turned, the wind is cell to cell. 0 is one steady wind.'),
      dial('wind', 'scale', 'Wind strength', 0, 3, 0.05, '×', 'The weather\'s wind taken as metres a second, times this.'),
      dial('solver', 'swirl', 'Swirl', 0, 60, 1, '', 'How much the stirred air curls into eddies, at the demo\'s own cell (held per metre whatever the air detail).'),
      dial('solver', 'dissipation', 'Stirred air dies away', 0, 2, 0.05, '/s', 'How fast the air\'s own motion fades on its own, besides the pull toward the wind.'),
      dial('slabs', 'reach', 'Height a push reaches', 0.3, 3, 0.05, '×', 'How far up and down from where it is made a push still stirs the layer of air near the ground.'),
    ],
  },
  {
    title: 'The dust',
    dials: [
      dial('dust', 'settle', 'Dust settles in', 0.5, 10, 0.1, 's', 'How long lifted dust hangs in the air before it falls out: it decays as 1 / (1 + dt / this).'),
      dial('dust', 'height', 'Dust hugs the ground to', 0.5, 6, 0.1, 'm', 'How high dust stands over the ground on a calm day: it thins as exp(-height / this).'),
      dial('dust', 'stormHeight', 'Storm dust stands to', 2, 30, 0.5, 'm', 'How high a full storm\'s dust stands.'),
      dial('dust', 'stormShed', 'Storm lifts off the sand', 0, 3, 0.05, '/s', 'How much dust sandy ground sheds a second in a full storm, more under a gust.'),
      dial('dust', 'stormInflow', 'Storm on the wind', 0, 2, 0.05, '', 'How much dust a full storm carries in from beyond the square that follows you.'),
      dial('dust', 'extinction', 'Dust thickness', 0.05, 3, 0.05, '', 'How much light a unit of dust takes. Thicker hides more of what is behind it.'),
      dial('dust', 'slopeFrom', 'Steep ground sheds less from', 5, 60, 1, '°', 'Ground steeper than this sheds less dust, whatever it is made of.'),
      dial('dust', 'slopeTo', 'Steep ground sheds none from', 10, 80, 1, '°', 'And none at all past this: a cliff face throws no dust.'),
    ],
  },
  {
    title: 'The light in the dust',
    dials: [
      dial('volume', 'phaseLift', 'Glow toward the sun', 0, 5, 0.05, '', 'How much brighter dust is looking toward the sun through it than away from it.'),
      dial('volume', 'sun', 'Sunlit dust', 0, 3, 0.05, '×', 'How strongly the sun lights the dust.'),
      dial('volume', 'ambient', 'Shaded dust', 0, 3, 0.05, '×', 'How much the sky\'s own light lights the dust in shade.'),
      dial('light', 'k', 'Dark heart', 0, 1, 0.01, '', 'How dark the inside of a dust cloud is, from the dust between it and the sun.'),
      dial('volume', 'history', 'New frame\'s share', 0.02, 1, 0.01, '', 'How much of each new frame goes into the smoothed picture. Lower is smoother and slower to follow; 1 is no smoothing.'),
    ],
  },
  {
    title: 'Engines',
    note: 'An engine\'s exit speed is its kind\'s, times how hard it runs (the heat its glow already shows).',
    dials: [
      dial('engine', 'exitSpeeder', 'Speeder exit speed', 0, 150, 1, 'm/s', 'A speeder\'s or a bike\'s jet at full heat.', kmh),
      dial('engine', 'exitFlyer', 'Flyer exit speed', 0, 150, 1, 'm/s', 'A flyer\'s jet at full heat.', kmh),
      dial('engine', 'exitPod', 'Pod exit speed', 0, 150, 1, 'm/s', 'A pod\'s engines between them at full heat.', kmh),
      dial('engine', 'exitShip', 'Ship exit speed', 0, 150, 1, 'm/s', 'A ship\'s engines at full heat. They point aft, so they stir the ground only low and fast.', kmh),
      dial('engine', 'downwashShip', 'Ship downwash', 0, 150, 1, 'm/s', 'A hovering ship blowing straight down under itself: what lifts dust under a ship holding its height.', kmh),
      dial('engine', 'downwashFlyer', 'Flyer downwash', 0, 150, 1, 'm/s', 'The same under a flyer off the ground.', kmh),
      dial('engine', 'downwashFade', 'Downwash gone at', 1, 100, 1, 'm/s', 'The forward speed at which the downwash has faded to nothing.', kmh),
      dial('engine', 'spreadPush', 'Spread under a low nozzle', 0, 150, 1, '', 'How hard a jet skimming the ground shoves the air out from under it.'),
      dial('engine', 'spreadDust', 'Dust from a low nozzle', 0, 10, 0.1, '/s', 'How much dust a jet skimming sand lifts.'),
      dial('engine', 'impactDust', 'Dust where a jet lands', 0, 1, 0.01, '', 'How much dust a jet pointed at the ground lifts, times its speed there.'),
    ],
  },
  {
    title: 'Blasts and the Force',
    dials: [
      dial('blast', 'shove', 'Blast shove', 0, 150, 1, 'm/s', 'A thermal detonator\'s ring of shoves; others by their own push.'),
      dial('blast', 'dust', 'Blast dust', 0, 10, 0.1, '', 'The dust a thermal detonator lifts; others by their radius.'),
      dial('force', 'push', 'Push shove', 0, 80, 1, 'm/s', 'A Force push through its cone.'),
      dial('force', 'pull', 'Pull draw', 0, 80, 1, 'm/s', 'A Force pull drawing the air back.'),
      dial('force', 'repulse', 'Repulse ring', 0, 80, 1, 'm/s', 'A repulse ringing the air away.'),
    ],
  },
  {
    title: 'Grains that fall back',
    dials: [
      dial('grains', 'gravity', 'Grains fall at', 1, 30, 0.1, 'm/s²', 'How hard a thrown grain is pulled back to the ground.'),
      dial('grains', 'rest', 'Grains lie for', 0, 3, 0.05, 's', 'How long a grain lies on the sand before it fades.'),
      dial('grains', 'blast', 'Grains a blast throws', 0, 1000, 10, '', 'At a thermal detonator\'s radius; others by theirs.'),
    ],
  },
];

/** The air's dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const AIR_DIALS: DialSet = { helper: 'air', groups: AIR_GROUPS, shipped: readDials(AIR_GROUPS) };

/** The dials the air's helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function airDialsFor(helper: string): DialSet | null {
  return helper === 'air' ? AIR_DIALS : null;
}
