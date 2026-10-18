// The race drive's dials (src/ui/dials.ts): the numbers of how a pod and a racing bike feel, on sliders in the debug
// menu when `race` is picked, and the engines' when `engines` is. Each is set through `tuneRace`, `tuneBase` or
// `tuneEngines`, exactly as `__debug.race({ tune })`, `race({ base })` and `engines({ tune })` set it, so the clamps,
// the words and the drives building their handling again are the console's own. A slider's range is ours, chosen
// wide enough to try anything sensible; a number typed into its box may go past it, as far as the helper allows.
//
// Pure: it imports the tune tables and nothing of the page, so a node test moves every dial through the real tables.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { ENGINE_TUNE, tuneEngines, type EngineTune } from './drivetrain.ts';
import type { RaceNumber } from './raceMath.ts';
import { CEILING_LEAST, CEILING_MOST, RACE_BASE, RACE_TUNE, tuneBase, tuneRace, type RaceTune } from './raceTune.ts';

const kmh = (v: number) => `${Math.round(v * 3.6)} km/h`;

/** A number of `RACE_TUNE`, set through `tuneRace`. */
function rule(k: keyof RaceTune, label: string, min: number, max: number, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  const t = RACE_TUNE as unknown as Record<string, number>;
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => t[k], set: (v) => tuneRace({ [k]: v }), text };
}

/** A switch of `RACE_TUNE`, set through `tuneRace`. */
function choice(k: keyof RaceTune, label: string, choices: readonly string[], note: string): ChoiceDial {
  const t = RACE_TUNE as unknown as Record<string, string>;
  return { kind: 'choice', key: `tune.${k}`, label, note, choices, get: () => String(t[k]), set: (v) => tuneRace({ [k]: v }) };
}

/** A number of the pod's handling, set through `tuneBase`; the racing bike is made from the pod again, so it follows. */
function pod(k: RaceNumber, label: string, min: number, max: number, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  const b = RACE_BASE.podracer as unknown as Record<string, number>;
  return { kind: 'number', key: `base.podracer.${k}`, label, note, min, max, step, unit, get: () => b[k], set: (v) => tuneBase({ podracer: { [k]: v } }), text };
}

/** A number of the engines, set through `tuneEngines`. */
function engine(k: keyof EngineTune, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  const t = ENGINE_TUNE as unknown as Record<string, number>;
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => t[k], set: (v) => tuneEngines({ [k]: v }) };
}

const RACE_GROUPS: DialGroup[] = [
  {
    title: 'Holding to the ground',
    note: 'Loose is the new hold: crests are jumps and dips are carried over. Firm is the first ride\'s, held hard to its line, kept to compare. The pod\'s numbers move the racing bike with them.',
    dials: [
      choice('hold', 'Hold', ['loose', 'firm'], 'Loose: crests jumped, dips carried over. Firm: the first ride\'s, held hard to its line.'),
      rule('looseFall', 'Fall (loose)', 2, 60, 0.5, 'm/s²', 'How hard it comes down once it is over its band, off a crest or a lip. Lower floats longer; 20 is the world\'s own gravity.'),
      rule('looseGrip', 'Grip (loose)', 0, 100, 1, 'm/s²', 'The hardest the cushion pulls it down onto its ride within its band. Higher follows more of the ground\'s dips; lower carries over more of them.'),
      rule('looseFeed', 'Lift from slopes (loose)', 0, 400, 5, 'm/s²', 'How fast it takes up the ground\'s rise under it. Higher keeps more of a slope\'s lift, so crests throw it higher; lower makes a kerb a nudge.'),
      pod('ride', 'Ride height', 0.3, 4, 0.05, 'm', 'How high it rides over the ground (a racing bike rides at its own, lower).'),
      pod('band', 'Band', 0.5, 10, 0.1, 'm', 'How far over its ride it may be before it counts as in the air.'),
      pod('riseRate', 'Rise', 1, 30, 0.5, '/s', 'How quickly it climbs back to its ride when it is under it (both holds).'),
      pod('fall', 'Fall (firm)', 20, 600, 10, 'm/s²', 'Firm hold only: how hard it is pulled down to its line.'),
      rule('lookAhead', 'Look ahead', 0, 1.5, 0.05, 's', 'How far ahead, in seconds of travel, it starts raising its line for a rise coming.'),
      rule('lookShare', 'Look ahead share', 0, 1, 0.05, '', 'How much of the way toward that rise the line is raised.'),
      choice('bridge', 'Glide over pits', ['on', 'off'], 'On: a pit crossed quickly enough is glided over. Off: the ground is followed into every pit.'),
      rule('bridgeTime', 'Glide time', 0, 1.5, 0.05, 's', 'A pit crossed in less than this is glided over: longer glides over wider pits.'),
    ],
  },
  {
    title: 'Speed',
    note: 'The ceiling is a full pod\'s top with its boost; a racing bike\'s is 350/600 of it.',
    dials: [
      rule('ceiling', 'Ceiling', CEILING_LEAST, CEILING_MOST, 10, 'km/h', 'A full pod\'s top with its boost. With "cap" only the top moves; with "all" every speed of both kinds scales with it.'),
      choice('ceilingMoves', 'Ceiling moves', ['cap', 'all'], 'cap: only the ceiling moves. all: every speed of both kinds scales with it.'),
      pod('stockTop', 'Stock top', 0.3, 1, 0.01, '', 'A stock pod\'s top as a share of a fully upgraded one\'s.'),
      pod('t75', 'Pick-up', 0.5, 8, 0.1, 's', 'Seconds a stock pod takes to reach three-quarters of its top. Lower is punchier.'),
      pod('coast', 'Coast', 0.5, 15, 0.1, '', 'How long it carries its speed off the throttle. Higher coasts further.'),
      pod('brake', 'Air brake', 0.2, 5, 0.1, '', 'How hard the air brake (S) bites. Higher stops sooner.'),
      pod('boostSeconds', 'Boost', 1, 20, 0.5, 's', 'Seconds of boost from cold before the engines overheat.'),
      pod('coolSeconds', 'Cool down', 2, 40, 0.5, 's', 'Seconds a stock pod takes to cool from hot.'),
    ],
  },
  {
    title: 'Steering',
    dials: [
      pod('maxTurn', 'Fastest turn', 20, 200, 1, '°/s', 'The fastest it can turn, whatever the mouse does.'),
      pod('turnResponse', 'Turn pick-up', 50, 800, 10, '°/s²', 'How quickly it comes into a turn. Higher is snappier.'),
      pod('tau', 'Drift', 0.05, 1.5, 0.01, 's', 'How long its travel lags its nose. Higher slides wider through a bend.'),
      rule('slide', 'Slide (Space)', 1, 10, 0.1, '×', 'How much more it drifts while Space is held.'),
      pod('bankMax', 'Bank', 0, 80, 1, '°', 'How far it rolls into a turn.'),
      pod('leanMax', 'Lean (Z, V)', 0, 85, 1, '°', 'How far Z and V lean it onto its side.'),
    ],
  },
  {
    title: 'Slopes',
    dials: [
      rule('slopeDown', 'Downhill', 0, 10, 0.1, '', 'How hard a descent speeds it up.'),
      rule('slopeUp', 'Uphill', 0, 5, 0.1, '', 'How much a climb slows it.'),
      rule('slopeFloor', 'Flat below', 0, 15, 0.5, '°', 'Slopes gentler than this do nothing either way.'),
    ],
  },
  {
    title: 'Walls and landings',
    dials: [
      choice('offCourse', 'A terrain face', ['crash', 'stop'], 'crash: a face met hard enough destroys it. stop: it is a hard scrape that stops it instead.'),
      pod('crashImpact', 'Crash speed', 10, 150, 1, 'm/s', 'Hit a wall head on faster than this and it is destroyed.', kmh),
      rule('hitLoss', 'Hit at', 0.5, 20, 0.5, 'm/s', 'Speed a step may lose to a wall before it counts as a hit at all.'),
      rule('scrapeHull', 'Scrape cost', 0, 2, 0.05, '', 'How much hull a scrape costs, for each m/s of it.'),
      pod('strikeHurt', 'Landing hurts at', 2, 60, 0.5, 'm/s', 'Landing harder than this hurts the hull.', kmh),
    ],
  },
  {
    title: 'Camera',
    dials: [
      rule('camPull', 'Pull back', 0, 1, 0.05, '', 'How much further out the camera stands at the ceiling (0.3 is thirty per cent).'),
      rule('fovAdd', 'Widen', 0, 40, 1, '°', 'How much the view widens at the ceiling.'),
      rule('camLag', 'Trail', 0, 0.6, 0.01, 's', 'How far the camera trails behind a turn.'),
      rule('steerLead', 'Mouse lead', 0.1, 1.5, 0.05, 'rad', 'How far ahead of the nose a flick of the mouse may set the heading.'),
    ],
  },
];

const ENGINE_GROUPS: DialGroup[] = [
  {
    title: 'Engine parts',
    note: 'A pod has two engines of three parts, a racing bike one engine. R held while racing mends the worst part.',
    dials: [
      engine('scrapePart', 'Scrape damage', 0, 0.1, 0.001, '', 'How much a scrape damages a part on the side it struck, for each m/s of it.'),
      engine('strikePart', 'Landing damage', 0, 0.05, 0.001, '', 'How much a hard landing damages a part, for each m/s past the landing\'s hurt.'),
      engine('fireRate', 'Burn', 0.02, 1, 0.01, '/s', 'How fast a burning part burns out: 0.12 takes about eight seconds from whole.'),
      engine('pullAt', 'Pulls from', 0, 1, 0.05, '', 'How damaged a part must be before it pulls the pod toward its side.'),
      engine('pullPart', 'Pull', 0, 1, 0.01, '', 'How hard each such part pulls the stick toward its side.'),
      engine('limp', 'Limp', 0.2, 1, 0.05, '', 'The share of its top a pod is held under with a side out, or while it is repaired.'),
    ],
  },
];

/** The race drive's dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const RACE_DIALS: DialSet = { helper: 'race', groups: RACE_GROUPS, shipped: readDials(RACE_GROUPS) };

/** The engines' dials. */
export const ENGINE_DIALS: DialSet = { helper: 'engines', groups: ENGINE_GROUPS, shipped: readDials(ENGINE_GROUPS) };

/** The dials a helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function vehicleDialsFor(helper: string): DialSet | null {
  return helper === 'race' ? RACE_DIALS : helper === 'engines' ? ENGINE_DIALS : null;
}
