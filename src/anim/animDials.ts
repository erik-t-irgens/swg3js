// The imported animations' dials (src/ui/dials.ts): every number of `ANIM_TUNE` on a slider in the debug menu when
// `anim` is picked. Each is set through `tuneAnim`, exactly as `__debug.anim({ tune })` sets it, so a slider and a
// typed line can never mean two things, and the line the menu copies out is that helper's own argument
// (`anim({ tune: { land: { soft: 8 } } })`). Every number here is how a jump, a landing or a fall looks and is the
// owner's to judge by eye; a slider's range is ours, wide enough to try anything sensible.
//
// Pure: it imports the tune and the dials' own types and nothing of the page, so a node test moves every dial
// through the real table.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { ANIM_CHOICES, ANIM_RANGES, ANIM_TUNE, tuneAnim } from './animTune.ts';

/** A number of `ANIM_TUNE`, by its group and name, set through `tuneAnim`. */
function dial(group: 'land' | 'jump' | 'impact' | 'trim' | 'fall' | 'swim', name: string, label: string, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  const table = ANIM_TUNE as unknown as Record<string, Record<string, number>>;
  const range = ANIM_RANGES[`${group}.${name}`];
  return { kind: 'number', key: `tune.${group}.${name}`, label, note, min: range.min, max: range.max, step, unit, get: () => table[group][name], set: (v) => tuneAnim({ [group]: { [name]: v } }), text };
}

/** A choice of `ANIM_TUNE`, by its path (`airRule`, `swim.rule`), set through `tuneAnim`. */
function choice(path: string, label: string, note: string): ChoiceDial {
  const parts = path.split('.');
  const read = (): string => {
    let at: unknown = ANIM_TUNE;
    for (const p of parts) at = (at as Record<string, unknown>)[p];
    return String(at);
  };
  const patch = (v: string): Record<string, unknown> => (parts.length === 1 ? { [parts[0]]: v } : { [parts[0]]: { [parts[1]]: v } });
  return { kind: 'choice', key: `tune.${path}`, label, note, choices: ANIM_CHOICES[path], get: read, set: (s) => tuneAnim(patch(s)) };
}

/** A landing speed said as the height of a fall that gives it, under the game's own gravity (20.3 m/s²). */
const asDrop = (v: number) => `a fall of about ${((v * v) / (2 * 20.32)).toFixed(1)} m`;
/** A trim said in the brief's own frames (30 a second). */
const asFrames = (v: number) => `${(v * 30).toFixed(1)} frames`;

const ANIM_GROUPS: DialGroup[] = [
  {
    title: 'Landings',
    note: 'Which landing plays by how fast the body comes down. A plain hop on level ground lands at 5.7 m/s; a Force user\'s, which the Force lifts while the key is down, at 7.4 to 9.6 by how long the tap was (held past about 0.12 s it is a Force jump, whose landing is the game\'s own). A fall first hurts a body with no Force at about 8.5 m/s. A landing that harms is always the hard one; a Force jump\'s, a roll and one mid-swing are the game\'s own.',
    dials: [
      dial('land', 'min', 'No landing under', 0.1, 'm/s', 'A landing slower than this plays no clip at all (a kerb, a slope\'s bumps).', asDrop),
      dial('land', 'soft', 'Short landing under', 0.1, 'm/s', 'Under this the short landing plays; from this up, with no harm done, the longer one.', asDrop),
      dial('land', 'fade', 'Fades in over', 0.01, 's', 'How long a landing takes to fade in over the falling loop.'),
      dial('land', 'moveCut', 'Moving cuts it after', 0.05, 's', 'How much of a landing plays before a held move key ends it. No clip moves the body, so a landing held to its end under a running body slides its feet; at 3 a landing is never cut.'),
      dial('land', 'moveFade', 'Cut fades over', 0.01, 's', 'How long a landing cut short takes to fade into the run.'),
    ],
  },
  {
    title: 'The jump and the thrown fall',
    dials: [
      dial('jump', 'fade', 'Jump fades in over', 0.01, 's', 'How long the jump\'s start takes to fade in.'),
      dial('impact', 'lock', 'Keys held through the impact', 0.05, '', 'The share of the thrown fall\'s impact the keys are held for: 1 until it ends, 0 not at all.'),
      dial('impact', 'fade', 'Impact fades in over', 0.01, 's', 'How long the impact takes to fade in over the fall.'),
    ],
  },
  {
    title: 'The air and the water',
    note: 'The owner\'s rules of 2026-11-15, each beside the rule before it.',
    dials: [
      choice('airRule', 'The air', 'owner: a plain jump floats (the Force jump\'s float) with no start of its own until it falls past the float\'s speed, then the falling loop; on the grappling rope off the ground the float; a step off a ledge over the drop plays the hop and then the falling loop, under it the falling loop. before: every plain jump the hop and the falling loop, the rope the falling loop.'),
      dial('fall', 'hopDrop', 'Ledge hop from a drop of', 0.05, 'm', 'Stepping off something with no jump plays the hop where what is under the feet is at least this far down (one ray, as the feet leave).'),
      dial('fall', 'floatUntil', 'A jump floats until falling at', 0.1, 'm/s', 'A plain jump hands over from the float to the falling loop once it falls faster than this. Every hop comes down slower than 9.6 m/s, so at 10 each floats to its landing and a jump off something hands over about 2.5 m into its fall.', asDrop),
      choice('swim.rule', 'Treading water', 'owner: treading at the surface the drawn figure sits lower in the water, and held still under the water it treads too. before: at the float line, and the swimming stroke under the water.'),
      dial('swim', 'sink', 'Treading figure drawn lower by', 0.01, 'm', 'How far the treading figure is drawn under where its body floats, on a figure of a human\'s size (scaled by the figure\'s own). At 0.3 the waterline is at a human\'s collarbones. Only at the surface; never in first person.'),
      dial('swim', 'ease', 'Sinks and rises over', 0.01, 's', 'How fast the treading figure goes down as the body stops and comes back up as it swims off (a time constant).'),
      choice('jkaSpine', 'Jedi Academy\'s lower back', 'mended: the saber moves\' spine laid on the game\'s own standing pose rather than the skeleton\'s bind pose, whose lower back is bent back against it. before: as converted.'),
      choice('swingPelvis', 'A swing on the move stands on', 'mended: a saber swing riding the upper body over moving legs keeps its own hips\' tilt, so it goes where it goes standing. before: on the legs\' hips, so over the back-pedal or a walk a medium or strong swing leaned back and passed over people.'),
    ],
  },
  {
    title: 'Where each one-off starts',
    note: 'Seconds into the clip. The first three are the brief\'s trims; the importer prints where each clip\'s feet are at its trim and when they come down.',
    dials: [
      dial('trim', 'falling_flat_impact', 'Thrown fall\'s impact', 0.01, 's', 'Where the impact starts (the brief: after the first 11 or 12 frames).', asFrames),
      dial('trim', 'falling_to_landing', 'Longer landing', 0.01, 's', 'Where the longer landing starts (the brief: skip the first 7 frames).', asFrames),
      dial('trim', 'hard_landing', 'Hard landing', 0.01, 's', 'Where the hard landing starts (the brief: skip the first 16 frames).', asFrames),
      dial('trim', 'jumping_down', 'Short landing', 0.01, 's', 'Where the short landing starts. Its feet are 0.43 m up at its beginning and come down at 0.24 s.', asFrames),
      dial('trim', 'jumping_up', 'Jump', 0.01, 's', 'Where the jump\'s start begins.', asFrames),
    ],
  },
];

/** The dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const ANIM_DIALS: DialSet = { helper: 'anim', groups: ANIM_GROUPS, shipped: readDials(ANIM_GROUPS) };

/** The dials `__debug.anim` has, or null: what the debug menu asks as a helper is picked. */
export function animDialsFor(helper: string): DialSet | null {
  return helper === 'anim' ? ANIM_DIALS : null;
}
