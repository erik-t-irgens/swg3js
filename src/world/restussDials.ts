// Restuss's dials (src/ui/dials.ts): the First Brigade of ours in the ruins and the circle Core3's town is skipped
// inside there, as sliders in the debug menu when `restuss` is picked. Each is set through `tuneRestussRoster` or
// `tuneRestuss`, exactly as `__debug.restuss({ roster })` and `__debug.restuss({ tune })` set them, so the clamps
// are the console's own, and the line the menu copies out is that helper's own argument
// (`restuss({ roster: { share: 0.6 } })`). Every number here is the owner's to move by hand once he has walked the
// ruins; each is read at the next arrival on Rori (`__debug.restuss({ go: true })` is one where you stand).
//
// Pure: it imports the tables and the dials' own types and nothing of the page, so a node test moves every dial
// through the real tables.
import type { DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { RESTUSS_ROSTER_TUNE, RESTUSS_TUNE, tuneRestuss, tuneRestussRoster } from './restuss.ts';

/** One number of the roster, set through `tuneRestussRoster`: what it holds the value to is said back where it differs. */
function rosterDial(name: 'share' | 'ring' | 'spacing' | 'respawn' | 'least' | 'most', label: string, note: string, min: number, max: number, step: number, unit: string, get: () => number): NumberDial {
  return {
    kind: 'number',
    key: `roster.${name}`,
    label,
    note,
    min,
    max,
    step,
    unit,
    get,
    set: (v) => {
      tuneRestussRoster({ [name]: v });
      const now = get();
      return now === v ? [] : [`held at ${now}`];
    },
  };
}

const RESTUSS_GROUPS: DialGroup[] = [
  {
    title: 'The First Brigade of ours',
    note: 'Who stands guard among the ruins: a rule over the ruins themselves, read at the next arrival on Rori. Nothing of it stands in the living city.',
    dials: [
      {
        kind: 'choice',
        key: 'roster.on',
        label: 'Stood',
        note: 'Whether the brigade stands in the ruins at all. Off, the ruins hold nobody of ours.',
        choices: ['yes', 'no'],
        get: () => (RESTUSS_ROSTER_TUNE.on ? 'yes' : 'no'),
        set: (v) => {
          tuneRestussRoster({ on: v });
          return [];
        },
      },
      rosterDial('share', 'Ruins guarded', 'Of the 35 ruins, the share with a post beside it, drawn by a hash of each ruin\'s own place.', 0, 1, 0.05, '', () => RESTUSS_ROSTER_TUNE.share),
      rosterDial('least', 'Fewest at a post', 'The fewest people standing at one post.', 0, 8, 1, '', () => RESTUSS_ROSTER_TUNE.group[0]),
      rosterDial('most', 'Most at a post', 'The most people standing at one post.', 0, 8, 1, '', () => RESTUSS_ROSTER_TUNE.group[1]),
      rosterDial('ring', 'Out from the ruin', 'How far outside a ruin\'s own footprint a post stands.', 0, 30, 0.5, 'm', () => RESTUSS_ROSTER_TUNE.ring),
      rosterDial('spacing', 'Apart at a post', 'How far apart two people at one post stand, along the ruin\'s side.', 0.5, 6, 0.1, 'm', () => RESTUSS_ROSTER_TUNE.spacing),
      {
        kind: 'choice',
        key: 'roster.temper',
        label: 'Temper',
        note: "'entry' is as their body's own entry says (the brigade's are defensive, so they fight when fought); 'peaceful' makes them part of the furniture, never fought.",
        choices: ['entry', 'peaceful'],
        get: () => RESTUSS_ROSTER_TUNE.temper,
        set: (v) => {
          tuneRestussRoster({ temper: v });
          return [];
        },
      },
      rosterDial('respawn', 'Back after', 'Seconds before one killed comes back; nought stays down until the world is left.', 0, 3600, 10, 's', () => RESTUSS_ROSTER_TUNE.respawn),
    ],
  },
  {
    title: "Core3's town in the ruins",
    note: "The circle round the city's middle inside which Core3's own people and fittings are skipped in the ruins: never taken off their lists, so every shared name stays.",
    dials: [
      {
        kind: 'number',
        key: 'tune.circle',
        label: 'Circle',
        note: "Metres round Restuss's middle; Core3's own no-spawn circle there is 700.",
        min: 100,
        max: 2000,
        step: 10,
        unit: 'm',
        get: () => RESTUSS_TUNE.circle,
        set: (v) => {
          tuneRestuss({ circle: v });
          return RESTUSS_TUNE.circle === v ? [] : [`held at ${RESTUSS_TUNE.circle}`];
        },
      },
    ],
  },
];

/** Restuss's dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const RESTUSS_DIALS: DialSet = { helper: 'restuss', groups: RESTUSS_GROUPS, shipped: readDials(RESTUSS_GROUPS) };

/** The dials a world helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function worldDialsFor(helper: string): DialSet | null {
  return helper === 'restuss' ? RESTUSS_DIALS : null;
}
