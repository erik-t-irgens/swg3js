// The motion blur's dials (src/ui/dials.ts): the race view's own shutter, strength, longest smear and taps, and the rule
// that keeps what the camera follows sharp, on sliders in the debug menu when `motionTune` is picked. Each is set through
// `tuneMotion`, exactly as `__debug.motionTune({ ... })` sets it, so the checks and the words are the console's own. How
// long a streak is and how strong is the owner's to decide; the starts are in `MOTION_TUNING` with their reasons. A
// slider's range is ours, wide enough to try anything sensible; a number typed into its box may go past it, as far as
// `tuneMotion` allows.
//
// Pure: it imports the tune table and nothing of the page, so a node test moves every dial through the real table.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';
import { FOLLOW_RULES, MAX_TILE_K, MOTION_TUNING, tuneMotion, type MotionChanges } from './velocityMath.ts';

type NumberKey = 'raceShutter' | 'raceStrength' | 'raceRadiusOfHeight' | 'raceSamples' | 'maskCutNear' | 'maskCutFull';

/** A number of `MOTION_TUNING`, set through `tuneMotion`. */
function num(k: NumberKey, label: string, min: number, max: number, step: number, unit: string, note: string, get: () => number, text?: (v: number) => string): NumberDial {
  return { kind: 'number', key: k, label, note, min, max, step, unit, get, set: (v) => tuneMotion({ [k]: v } as MotionChanges), text };
}

const px = (share: number, h: number) => Math.min(MAX_TILE_K, Math.max(8, Math.round(share * h)));

const RULE: ChoiceDial = {
  kind: 'choice',
  key: 'followRule',
  label: 'What follows stays sharp by',
  note: "auto: its own pixels in the race view and a flown ship's chase, the depth cut elsewhere. cut: the depth cut everywhere, as before. mask: its own pixels in every view from outside (first person and the cockpit keep the cut).",
  choices: FOLLOW_RULES,
  get: () => MOTION_TUNING.followRule,
  set: (v) => tuneMotion({ followRule: v }),
};

const MOTION_GROUPS: DialGroup[] = [
  {
    title: 'The race view',
    note: "These move only the race view (a pod, or a bike in racing mode, ridden and seen from outside); the Graphics page's strength is under them.",
    dials: [
      num('raceShutter', 'Shutter', 0.004, 0.05, 0.001, 's', 'How long a frame the blur pretends to be: longer smears further.', () => MOTION_TUNING.raceShutter, (v) => `1/${Math.round(1 / v)}`),
      num('raceStrength', 'Strength', 0, 3, 0.05, '×', "Times the Graphics page's motion blur strength, in the race view alone.", () => MOTION_TUNING.raceStrength),
      num('raceRadiusOfHeight', 'Longest streak', 0.01, 0.14, 0.005, '', 'The longest smear either side of a pixel, as a share of the screen height.', () => MOTION_TUNING.raceRadiusOfHeight, (v) => `${px(v, 900)} px at 900, ${px(v, 1440)} at 1440`),
      num('raceSamples', 'Taps', 4, 32, 1, '', 'Samples along each streak: more keep a long streak smooth rather than dotted, at a little GPU time each.', () => MOTION_TUNING.raceSamples),
    ],
  },
  {
    title: 'What the camera follows',
    note: 'Kept sharp either by its own pixels (the mask) or by a cut on depth that also holds everything nearer than its far side.',
    dials: [
      RULE,
      num('maskCutNear', 'Mask: smear from', 0, 5, 0.05, 'm', 'Under the mask, nothing nearer the lens than this smears with the camera.', () => MOTION_TUNING.maskCut[0]),
      num('maskCutFull', 'Mask: full from', 0.1, 10, 0.05, 'm', 'Under the mask, everything this far from the lens and beyond smears fully with the camera.', () => MOTION_TUNING.maskCut[1]),
    ],
  },
];

/** The motion blur's dials, with the values the game shipped (read once, as this module loads). */
export const MOTION_DIALS: DialSet = { helper: 'motionTune', groups: MOTION_GROUPS, shipped: readDials(MOTION_GROUPS) };
