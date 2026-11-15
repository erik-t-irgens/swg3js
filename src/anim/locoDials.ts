// The speed classes' dials (src/ui/dials.ts): every number of `LOCO_TUNE` on a slider in the debug menu when `loco`
// is picked, and its two switches beside them. Each is set through `tuneLoco`, exactly as `__debug.loco({ tune })`
// sets it, so a slider and a typed line can never mean two things, and the line the menu copies out is that helper's
// own argument (`loco({ tune: { speed: { forward: { run: 5.2 } } } })`). Every number here is how moving on foot
// feels and is the owner's to judge by hand; a slider's range is ours, wide enough to try anything sensible.
//
// Pure: it imports the tune and the dials' own types and nothing of the page, so a node test moves every dial
// through the real table.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { LOCO_RANGES, LOCO_TUNE, tuneLoco } from './locoTune.ts';

/** A nested patch for one path: `speed.forward.run`, 5 is `{ speed: { forward: { run: 5 } } }`. */
function patchOf(path: string, v: unknown): Record<string, unknown> {
  const parts = path.split('.');
  const root: Record<string, unknown> = {};
  let at = root;
  for (let i = 0; i < parts.length - 1; i++) at = at[parts[i]] = {} as Record<string, unknown>;
  at[parts[parts.length - 1]] = v;
  return root;
}

function read(path: string): unknown {
  let at: unknown = LOCO_TUNE;
  for (const p of path.split('.')) at = (at as Record<string, unknown>)[p];
  return at;
}

/** A number of `LOCO_TUNE`, by its path, set through `tuneLoco`. */
function dial(path: string, label: string, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  const range = LOCO_RANGES[path];
  return { kind: 'number', key: `tune.${path}`, label, note, min: range.min, max: range.max, step, unit, get: () => read(path) as number, set: (v) => tuneLoco(patchOf(path, v)), text };
}

function choice(path: string, label: string, choices: readonly string[], note: string, from: (v: unknown) => string, to: (s: string) => unknown): ChoiceDial {
  return { kind: 'choice', key: `tune.${path}`, label, note, choices, get: () => from(read(path)), set: (s) => tuneLoco(patchOf(path, to(s))) };
}

const onOff = (v: unknown) => (v ? 'on' : 'off');
const isOn = (s: string) => s === 'on';
const kmh = (v: number) => `${(v * 3.6).toFixed(1)} km/h`;
const speed = (path: string, label: string, note: string) => dial(`speed.${path}`, label, 0.05, 'm/s', note, kmh);

const LOCO_GROUPS: DialGroup[] = [
  {
    title: 'The classes',
    note: 'Off, moving on foot is what it was before the speed classes: one run, Shift walks, and the body turns the way it runs. The walk key (Alt unless rebound) is held: it walks only while it is down.',
    dials: [
      choice('on', 'Speed classes', ['on', 'off'], 'The whole of it: off is the movement before the classes.', onOff, isOn),
      choice('gunSquare', 'Blaster up: diagonals stay square', ['on', 'off'], 'With a blaster ready or aimed a diagonal plays its own jog clip at every class and the body stays square to the view (ours). Off is the brief\'s rule with a blaster up too: the strafe or the backward clip with the body turned 45 degrees.', onOff, isOn),
    ],
  },
  {
    title: 'Forward',
    note: 'What each class moves the body at. Each starts at its clip\'s own measured speed, but the run (4.9) and the sprint (6.35, the one run the game had before): their two clips measure almost alike.',
    dials: [
      speed('forward.walk', 'Walk', 'The walk class: what the walk key held gives.'),
      speed('forward.jog', 'Jog', 'Forward with nothing held.'),
      speed('forward.tired', 'Tired jog', 'The jog while tired (the pool emptied and not yet back to its share).'),
      speed('forward.run', 'Run', 'Shift held.'),
      speed('forward.sprint', 'Sprint', 'Shift let go and pressed again quickly. Burns stamina; no attack while it lasts.'),
    ],
  },
  {
    title: 'Backward and sideways',
    dials: [
      speed('back.walk', 'Back: walk', 'Backing up at a walk.'),
      speed('back.jog', 'Back: jog', 'Backing up with nothing held.'),
      speed('back.run', 'Back: run', 'Backing up with Shift (there is no sprint but forward).'),
      speed('side.walk', 'Side: walk', 'Strafing at a walk: the slow strafe.'),
      speed('side.jog', 'Side: jog', 'Strafing with nothing held.'),
      speed('side.run', 'Side: run', 'Strafing with Shift.'),
    ],
  },
  {
    title: 'Diagonals',
    note: 'The jogs have clips of their own. The walks and the runs are the strafes (forward) and the backward clips (backward) with the body turned 45 degrees.',
    dials: [
      speed('forwardDiag.walk', 'Forward diagonal: walk', 'Forward and to a side at a walk: the strafe walk, the body turned.'),
      speed('forwardDiag.jog', 'Forward diagonal: jog', 'Forward and to a side with nothing held.'),
      speed('forwardDiag.run', 'Forward diagonal: run', 'Forward and to a side with Shift: the strafe run, the body turned.'),
      speed('backDiag.walk', 'Backward diagonal: walk', 'Back and to a side at a walk: the backward walk, the body turned.'),
      speed('backDiag.jog', 'Backward diagonal: jog', 'Back and to a side with nothing held.'),
      speed('backDiag.run', 'Backward diagonal: run', 'Back and to a side with Shift: the backward run, the body turned.'),
    ],
  },
  {
    title: 'Shift and the feet',
    dials: [
      dial('shift.dropDelay', 'Class drops after', 0.05, 's', 'How long after Shift is let go the class drops by one, and again by one each such time, down to the jog.'),
      dial('shift.tapWindow', 'Second press within', 0.05, 's', 'Shift let go and pressed again within this raises the class by one over the class it was let go at (the run to the sprint).'),
      dial('rate.min', 'Slowest playback', 0.05, 'x', 'A clip never plays slower than this while it follows the ground speed.'),
      dial('rate.max', 'Fastest playback', 0.05, 'x', 'Nor faster than this (Force Speed raises it by its own factor).'),
      dial('rate.feet', 'Feet against the ground', 0.01, 'x', 'Every clip\'s own foot speed as a share of what the pack says: past 1 the legs play slower for the same ground speed (raise it if planted feet slip back, lower it if they slip forward).'),
    ],
  },
  {
    title: 'Stamina',
    note: 'Points a second by what the body is doing. Emptied, the body is tired: no run or sprint, and the jog is the tired one, until the pool is back to its share.',
    dials: [
      dial('stamina.pool', 'Pool', 5, 'points', 'How much there is.'),
      dial('stamina.sprint', 'Sprinting', 0.5, '/s', 'What a second of the sprint takes.'),
      dial('stamina.run', 'Running', 0.5, '/s', 'A second of the run forward: nothing, by the brief.'),
      dial('stamina.jog', 'Jogging', 0.5, '/s', 'A second of the jog forward.'),
      dial('stamina.walk', 'Walking and standing', 0.5, '/s', 'The standard rate: walking forward, and standing.'),
      dial('stamina.back', 'Backward', 0.5, '/s', 'Backing up, at any class.'),
      dial('stamina.side', 'Sideways', 0.5, '/s', 'Strafing and the forward diagonals, from the jog up.'),
      dial('stamina.sideWalk', 'Sideways at a walk', 0.5, '/s', 'Strafing and the forward diagonals at the walk. Starts at the standard rate; nought is the brief\'s "won\'t allow for stamina regen" read to the letter.'),
      dial('stamina.air', 'Most regained in the air', 0.5, '/s', 'The most the pool regains a second off the ground and in the water. What a class spends it spends in the air too.'),
      dial('stamina.tiredUntil', 'Tired until', 0.01, '', 'Emptied, the body is tired until the pool is back to this share of itself.', (v) => `${Math.round(v * 100)}%`),
      dial('stamina.linger', 'Bar stays for', 0.1, 's', 'How long the bar stays up after the pool is full again.'),
    ],
  },
  {
    title: 'Blending and the turned body',
    dials: [
      dial('fade.loco', 'Between two classes', 0.01, 's', 'The fade between two walking or running clips, their feet kept in step.'),
      dial('fade.idle', 'Standing to moving', 0.01, 's', 'The fade between the standing idle and a walk or a run, either way.'),
      dial('fade.jka', 'Into a block or a swing', 0.01, 's', 'The fade into and out of the saber\'s own legs.'),
      dial('turn.torso', 'Torso turns back', 0.05, '', 'How much of a turned body\'s angle the spine takes back toward the view; the head\'s look takes what it can of the rest.', (v) => `${Math.round(v * 100)}%`),
      dial('turn.rate', 'Body comes round at', 0.5, '/s', 'How fast the body turns to where its clip wants it.'),
      dial('turn.aimSpine', 'Spine turns for the aim', 1, 'deg', 'With a blaster up over the classes\' legs: how far the spine turns to bring the barrel onto the crosshair before the body turns instead. At its most the body stays square to its legs.'),
      dial('fight.walkUnder', 'Block or swing: saber walk under', 0.05, 'x', 'Under a block or a swing the legs are the saber\'s own walk below this share of the speed at which its walk played fast and its run played slow are equally far from their own rates, and its run from there up. Nought: the run at every class above the walk.'),
      dial('peer.settle', 'Others change class after', 0.05, 's', 'How long another player\'s speed must have said a new class before their figure changes clip.'),
      dial('peer.hold', 'Others keep their way within', 1, 'deg', 'How far past halfway to another clip\'s way another player\'s travel must lie before their legs change way: a slope or a wall turns a body\'s travel a few degrees from its heading.'),
    ],
  },
];

/** The dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const LOCO_DIALS: DialSet = { helper: 'loco', groups: LOCO_GROUPS, shipped: readDials(LOCO_GROUPS) };

/** The dials `__debug.loco` has, or null: what the debug menu asks as a helper is picked. */
export function locoDialsFor(helper: string): DialSet | null {
  return helper === 'loco' ? LOCO_DIALS : null;
}
