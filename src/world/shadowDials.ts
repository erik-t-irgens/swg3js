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
import { SHADOW_SPLIT_TUNE, softShare, tuneShadowSplits } from './shadowSplits.ts';

/** Where a map ends or how soft it is, set through `tuneShadowSplits` as the console's line writes it (`{ splits: { nearReach: 16 } }`). */
function splitDial(k: 'nearReach' | 'midReach', label: string, min: number, max: number, step: number, note: string, text?: (v: number) => string): NumberDial {
  return { kind: 'number', key: `splits.${k}`, label, note, min, max, step, unit: 'm', get: () => SHADOW_SPLIT_TUNE[k], set: (v) => tuneShadowSplits({ [k]: v }), text };
}

/** One map's share of the page's softness. */
function softDial(i: number, label: string, note: string): NumberDial {
  return { kind: 'number', key: `splits.soft.${i}`, label, note, min: 0.25, max: 4, step: 0.05, unit: '', get: () => softShare(i), set: (v) => tuneShadowSplits({ soft: { [i]: v } }) };
}

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
    title: 'How far each shadow map reaches, and how soft',
    note: 'Three maps of the same size share the shadow distance: the nearer a map ends, the sharper its shadows. The near map ends at its own reach whatever the Shadow distance on the Graphics page, so near shadows stay sharp at any range; the middle map ends where the near reach and the distance meet on a log scale unless you give it a reach; the far map takes the rest. The page\'s Shadow softness is multiplied by each map\'s share.',
    dials: [
      splitDial('nearReach', 'Near map ends at', 2, 60, 1, 'Metres from your eye. 16 m is about 2 cm a texel at 2048: crisp. Larger keeps more ground sharp and each texel coarser.'),
      splitDial('midReach', 'Middle map ends at', 0, 400, 5, 'Metres; 0 is the near reach and the distance met halfway on a log scale (about 72 m at the default 320 m, 113 m at 800).', (v) => (v > 0 ? `${v} m` : 'automatic')),
      softDial(0, 'Near softness share', 'Times the page\'s softness, in the near map\'s own fine texels.'),
      softDial(1, 'Middle softness share', 'Times the page\'s softness, in the middle map\'s texels.'),
      softDial(2, 'Far softness share', 'Times the page\'s softness, in the far map\'s coarse texels: above 1 makes the far shadows more of a suggestion.'),
    ],
  },
  {
    title: 'How old the far shadows may be',
    note: 'The near map is drawn every frame. The middle and far maps are drawn again once this old: what stands still looks the same, and a moving thing\'s shadow there may trail it by up to this long. 0 is every frame, as before.',
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
