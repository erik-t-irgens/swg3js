// The landmarks' numbers of look as the debug menu's sliders, when `landmarks` is picked (the horizon pass's wave 5b): how far
// a big thing is kept for its size, how big a thing must be, and the band it is shown and hidden over. Each is set through
// `tuneLandmarks`, exactly as `__debug.landmarks({ tune })` sets it, so a slider and a typed line never mean two things. The
// size rule's switch is the console's (`__debug.landmarks({ on })`, which builds the index behind a curtain).
//
// Pure: the tune table and the dials' shapes, nothing of the page.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { LANDMARK_MIN_SIZE_FLOOR, LANDMARK_TUNE, tuneLandmarks } from './landmarkMath.ts';

/** What the least half-span's slider says as it moves: it is written, and taken only behind a screen or a curtain. */
export const MIN_SIZE_TAKEN = 'taken behind a short curtain by __debug.landmarks({ apply: true }), or at the next arrival';

function num(k: 'k' | 'minSize' | 'hysteresis' | 'sweepMetres', label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  // The least half-span is written and never collected by the frame (a lower one brings in models no tier has drawn).
  const set = k === 'minSize' ? (v: number) => [...tuneLandmarks({ [k]: v }), MIN_SIZE_TAKEN] : (v: number) => tuneLandmarks({ [k]: v });
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => LANDMARK_TUNE[k], set };
}

/**
 * The size rule's switch as a dial (the owner, 2026-11-09: "I turned it on in the sliders ... Jabba's palace disappears no
 * matter what I do": the dials had no switch, only Drawn). main.ts hands it the app's own `setLandmarks` (collected behind
 * a short curtain in a world, at the next arrival elsewhere, and remembered in this browser); with none handed (a test) it
 * only writes the rule.
 */
export const LANDMARK_SWITCH: { set: ((on: boolean) => void) | null } = { set: null };

const rule: ChoiceDial = {
  kind: 'choice',
  key: 'on',
  label: 'Big things by size',
  note: 'On, every placed thing at least the least half-span is kept far off. Moved, it is collected behind a short loading screen (at the next arrival out of a world) and remembered in this browser.',
  choices: ['on', 'off'],
  get: () => (LANDMARK_TUNE.on ? 'on' : 'off'),
  set: (v) => {
    const on = v === 'on';
    if (LANDMARK_SWITCH.set) {
      LANDMARK_SWITCH.set(on);
      return [on ? 'collecting the landmarks behind a short loading screen' : 'landmarks by size off'];
    }
    LANDMARK_TUNE.on = on;
    return ['taken at the next arrival'];
  },
};

const drawn: ChoiceDial = {
  kind: 'choice',
  key: 'tune.drawn',
  label: 'Drawn',
  note: 'Off hides every landmark copy and lets go of nothing: the same view without them, to compare.',
  choices: ['on', 'off'],
  get: () => (LANDMARK_TUNE.drawn ? 'on' : 'off'),
  set: (v) => tuneLandmarks({ drawn: v }),
};

const GROUPS: DialGroup[] = [
  {
    title: 'How far',
    note: "A big placed thing kept at its lowest level past its tier's own range, never past the far ground's reach in force (the far tiles' 3.3 km with the rings off). 'Big things by size' is the switch; Drawn only hides what is collected.",
    dials: [
      rule,
      num('k', 'Half-spans kept', 50, 1000, 10, '×', "How far a landmark is kept, in its own half-spans (a 12 m one at 400 is kept to 4.8 km). The handoff's four-pixel rule at 1440p is about 690."),
      num('minSize', 'Least half-span', LANDMARK_MIN_SIZE_FLOOR, 100, 1, 'm', `How big a placed thing must be (half its largest span) to be a landmark by its size, never under the streamer's first size tier (${LANDMARK_MIN_SIZE_FLOOR} m). Moved, it is ${MIN_SIZE_TAKEN}: a lower one loads models no tier has drawn, which is never done on a frame.`),
      num('hysteresis', 'Band', 0, 0.3, 0.01, '', 'The share of its cut a landmark passes back inside or beyond before it is shown or hidden again, so one standing on the line never flickers.'),
      num('sweepMetres', 'Sweep every', 1, 64, 1, 'm', 'How far the eye moves before the landmarks are looked at again (a quarter of a second, a tier shown or let go, or the reach moving do it too).'),
      drawn,
    ],
  },
];

export const LANDMARK_DIALS: DialSet = { helper: 'landmarks', groups: GROUPS, shipped: readDials(GROUPS) };

/** The landmarks' dials, for the debug menu (null for any other helper). */
export function landmarkDialsFor(helper: string): DialSet | null {
  return helper === 'landmarks' ? LANDMARK_DIALS : null;
}
