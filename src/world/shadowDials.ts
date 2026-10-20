// The shadow pass's dials (src/ui/dials.ts): the numbers of the cascades' holds that change what the owner sees, on
// sliders in the debug menu when `shadowPass` is picked. Each is set through `tuneShadowPass`, exactly as
// `__debug.shadowPass({ tune })` sets it, so the clamps and the words are the console's own, and the line the menu copies
// out is that helper's own argument (`shadowPass({ tune: { maxAgeMs: { 2: 100 } } })`). The ages and the fast mover are
// how far a moving thing's shadow may trail it in the middle and far maps, and `coverDeep` how far a held far map's depth
// may fall short while the view turns (0 since the far map reaches its whole band, Q8; it shows only with the old depth
// put back): the owner's to judge by eye (CLAUDE.md, "Feel is the owner's"); a slider's range
// is ours, wide enough to try anything sensible. Every other number of the table is technical and has no slider.
//
// Pure: it imports the tune table and the dials' own types and nothing of the page, so a node test moves every dial
// through the real table.
import type { DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { SHADOW_PASS_TUNE, tuneShadowPass } from './shadowCadence.ts';

/** The frames a cascade aged this many ms is drawn on, at the owner's 144 Hz and at 60. */
const framesAt = (ms: number) => (ms > 0 ? `every ${Math.max(1, Math.ceil((ms * 144) / 1000 - 1e-9))} frames at 144 Hz, every ${Math.max(1, Math.ceil((ms * 60) / 1000 - 1e-9))} at 60` : 'every frame');

/** One cascade's age, set through `tuneShadowPass` as the console's line writes it (`{ maxAgeMs: { 1: 13 } }`). */
function ageDial(i: number, label: string, note: string): NumberDial {
  return {
    kind: 'number',
    key: `tune.maxAgeMs.${i}`,
    label,
    note,
    min: 0,
    max: 200,
    step: 1,
    unit: 'ms',
    get: () => SHADOW_PASS_TUNE.maxAgeMs[i] ?? 0,
    set: (v) => tuneShadowPass({ maxAgeMs: { [i]: v } }),
    text: framesAt,
  };
}

/** A number of `SHADOW_PASS_TUNE`, set through `tuneShadowPass`. */
function dial(k: 'fastMover' | 'coverDeep', label: string, min: number, max: number, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => SHADOW_PASS_TUNE[k], set: (v) => tuneShadowPass({ [k]: v }), text };
}

const SHADOW_GROUPS: DialGroup[] = [
  {
    title: 'How old the far shadows may be',
    note: 'The near map (to 54 m) is drawn every frame. The middle (54 to 115 m) and far (115 to 320 m) maps are drawn again once this old: what stands still looks the same, and a moving thing\'s shadow there may trail it by up to this long. 0 is every frame, as before.',
    dials: [
      ageDial(1, 'Middle map, at most', 'The middle map is drawn again once its picture is this old. 13 ms is every second frame at 144 Hz: a walker\'s shadow trails 8 cm.'),
      ageDial(2, 'Far map, at most', 'The far map is drawn again once its picture is this old. 41 ms is every sixth frame at 144 Hz: a walker\'s shadow trails 25 cm, under one of its 40 cm texels.'),
    ],
  },
  {
    title: 'What draws them every frame',
    dials: [
      dial('fastMover', 'Faster than', 0, 200, 1, 'm/s', 'A vehicle, a shuttle in flight or another player moving faster than this draws every far map its shadow could fall in, every frame, so its shadow never trails it. The one you ride casts into the near map only.', (v) => `${Math.round(v * 3.6)} km/h`),
      dial('coverDeep', 'Far cut-off may step', 0, 60, 1, 'm', 'How far a held far map\'s depth may fall short of a fresh one\'s while the view turns. 0, exact: the far map now reaches all of its own ground (the Q8 fix), so 0 costs little. With the old depth put back (`shadowPass({ farDepth: \'slice\' })`) the far shadows end short of their ground looking across the sun, and above 0 that edge steps by up to this while the view turns, where 0 draws the far map on about half the frames turning.'),
    ],
  },
];

/** The shadow pass's dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const SHADOW_DIALS: DialSet = { helper: 'shadowPass', groups: SHADOW_GROUPS, shipped: readDials(SHADOW_GROUPS) };

/** The dials the shadow pass's helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function shadowDialsFor(helper: string): DialSet | null {
  return helper === 'shadowPass' ? SHADOW_DIALS : null;
}
