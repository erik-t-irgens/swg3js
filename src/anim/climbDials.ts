// The climbing's dials (src/ui/dials.ts): every number of `CLIMB_TUNE` on a slider in the debug menu when `climb` is picked,
// and its switch beside them. Each is set through `tuneClimb`, exactly as `__debug.climb({ tune })` sets it, so a slider and
// a typed line can never mean two things, and the line the menu copies out is that helper's own argument
// (`climb({ tune: { stamina: { hang: 2 } } })`). Every number here is how hanging and climbing feel and is the owner's to
// judge by hand; a slider's range is the table's own (`CLIMB_RANGES`). Maker B's groups (wall climbing, the hands' bracing)
// join `CLIMB_GROUPS` beside these.
//
// Pure: it imports the tune and the dials' own types and nothing of the page, so a node test moves every dial through the
// real table.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { CLIMB_CHOICES, CLIMB_RANGES, CLIMB_TUNE, tuneClimb } from './climbTune.ts';

/** A nested patch for one path: `stamina.hang`, 2 is `{ stamina: { hang: 2 } }`. */
function patchOf(path: string, v: unknown): Record<string, unknown> {
  const parts = path.split('.');
  const root: Record<string, unknown> = {};
  let at = root;
  for (let i = 0; i < parts.length - 1; i++) at = at[parts[i]] = {} as Record<string, unknown>;
  at[parts[parts.length - 1]] = v;
  return root;
}

function read(path: string): unknown {
  let at: unknown = CLIMB_TUNE;
  for (const p of path.split('.')) at = (at as Record<string, unknown>)[p];
  return at;
}

/** A number of `CLIMB_TUNE`, by its path, set through `tuneClimb`. */
function dial(path: string, label: string, step: number, unit: string, note: string): NumberDial {
  const range = CLIMB_RANGES[path];
  return { kind: 'number', key: `tune.${path}`, label, note, min: range.min, max: range.max, step, unit, get: () => read(path) as number, set: (v) => tuneClimb(patchOf(path, v)) };
}

function choice(path: string, label: string, note: string): ChoiceDial {
  return { kind: 'choice', key: `tune.${path}`, label, note, choices: CLIMB_CHOICES[path], get: () => String(read(path)), set: (s) => tuneClimb(patchOf(path, s)) };
}

export const CLIMB_GROUPS: DialGroup[] = [
  {
    title: 'Ledges',
    note: 'before: the body as it was before the ledges (nothing is felt for, nothing grabbed). on: a lip in reach in the air is grabbed, hung from braced (feet on the wall) or free, shimmied along with A and D, hopped from with Space and a side or W, climbed with Space or W, dropped from with the crouch key and jumped off backward with S and Space.',
    dials: [
      choice('ledges', 'Ledges', 'The whole of it: before is the body as it was.'),
      dial('grabFall', 'Grabs while falling no faster than', 0.5, 'm/s', 'The brief\'s 12: falling faster, a lip in reach is passed.'),
      dial('reachLow', 'Hands reach from', 0.01, 'm', 'Over the feet, on the human male (scaled by the figure): 1.62, the rest pose\'s head.'),
      dial('reachHigh', 'Up to', 0.01, 'm', '2.285, the free hang\'s own grip over its feet: a standing jump grabs a top up to 3.15 m over the ground.'),
      dial('reachAhead', 'A face as far ahead as', 0.01, 'm', 'From the body\'s middle: 0.75, the braced hang\'s own 0.38 and an arm\'s bend more.'),
      dial('regrab', 'Not the same lip again for', 0.05, 's', 'After a let-go, a drop or a jump off: 0.4.'),
    ],
  },
  {
    title: 'The hands',
    dials: [
      dial('gripDrop', 'Grip under the top', 0.005, 'm', 'Measured off the climbs (their feet end on the top their hands started on): 0.06.'),
      dial('gripOut', 'Grip out from the face', 0.005, 'm', 'The knuckles over the edge: 0.03.'),
      dial('ease', 'Hands and feet ease in over', 0.01, 's', 'And the figure\'s line-up between two clips: 0.15.'),
    ],
  },
  {
    title: 'Moving on the lip',
    dials: [
      dial('shimmy', 'Shimmy pace', 0.05, 'of the clip\'s', '1: the clip\'s own (braced 0.48 m/s, free 0.27 to 0.28), so its hands keep their holds.'),
      dial('edgeAhead', 'Stops short of a lip\'s end by', 0.01, 'm', 'Felt for ahead of the leading hand: 0.12, a hand\'s width.'),
      dial('hopSide', 'A hop reaches sideways', 0.05, 'm', 'The brief\'s 1.5, to any lip that way (another face across a gap too); the slider goes to 8. With hops band, measured across the gap from the held lip\'s end.'),
      dial('hopUp', 'And up', 0.05, 'm', 'The brief\'s 1.5; to 8.'),
      dial('lipSlope', 'Shimmies up or down a lip as steep as', 1, 'deg', 'The owner\'s 35: the leading hand stops where the lip grows steeper.'),
      dial('lipTilt', 'The body turned with a sloping lip by', 0.05, 'of its slope', 'Ours, half: how much of the slope the hanging body leans with.'),
    ],
  },
  {
    title: 'Stamina',
    note: 'Wave 2a\'s pool of 100: hanging and shimmying drain it, a hop takes a share at once, and an empty pool lets go (no grab again until it is back to its share).',
    dials: [
      dial('stamina.hang', 'Hanging costs', 0.5, '/s', 'The brief\'s 3.'),
      dial('stamina.shimmy', 'Shimmying costs', 0.5, '/s', 'The brief\'s 5.'),
      dial('stamina.hop', 'A hop costs', 1, '', 'The brief\'s 12.'),
    ],
  },
  {
    title: 'Letting go',
    dials: [
      dial('dropCut', 'A drop\'s clip plays for', 0.05, 's', 'Before the falling loop takes the body: 0.3.'),
      dial('jumpBack', 'Jumping off: back at', 0.1, 'm/s', 'From the clip\'s own flight under the game\'s gravity: 3.'),
      dial('jumpUp', 'And up at', 0.1, 'm/s', '6.25.'),
      dial('freePush', 'A free hang\'s push back', 0.1, 'm/s', 'S and Space from a free hang (no clip of its own): 1.5.'),
    ],
  },
  {
    title: 'Wall climbing',
    note: 'before: the body as it was before the wall climb (nothing is felt for, nothing climbed). on: W held into a face steeper than the climb limit and no steeper than upright, pressed against it, climbs it: W up, S down, A and D sideways, onto a ledge at its lip (W still held climbs on up), the crouch key lets go, Space jumps off backward. Stamina drains while on the wall, and an empty pool lets go.',
    dials: [
      choice('wall', 'Wall climbing', 'The whole of it: before is the body as it was.'),
      dial('wallStart', 'Starts after pressing in for', 0.05, 's', 'The brief\'s 0.25: a brush along a wall never starts it.'),
      dial('wallSpeed.up', 'Climbs up at', 0.05, 'm/s', 'The brief\'s 1, along the face: the clip plays at 1.69 (its planted hands slide 0.592 m/s), so they stay put.'),
      dial('wallSpeed.down', 'Down at', 0.05, 'm/s', 'The brief\'s 1.2: the down clip at 2.05 (its hands 0.586 m/s).'),
      dial('wallSpeed.side', 'Sideways at', 0.05, 'm/s', 'The brief\'s 0.8 (no clip of its own: the up clip at 1.35).'),
      dial('wallStamina.climb', 'Climbing costs', 0.5, '/s', 'The brief\'s 8.'),
      dial('wallStamina.still', 'Holding still costs', 0.5, '/s', 'The brief\'s 4.'),
    ],
  },
  {
    title: 'Climbing II: the controls',
    note: 'Each switch\'s other word is the climbing as it was. Grab use: a lip is grabbed and a wall climbed only while E (the use key, when nothing else in reach takes it, or falling) is held; W at a ledge hops up to a lip above, else climbs onto the top; Space with nowhere to hop jumps a little up and off the wall; hops look for the nearest lip in the asked way within these reaches; a step along a lip up to the step\'s most is crossed hand by hand.',
    dials: [
      choice('grab', 'Grabbing and wall climbing', 'use: on E (pressed or held); auto: as before (moving at a lip in the air, W pressed into a wall).'),
      choice('wUp', 'W at a ledge', 'hop: up to a lip above where there is one, else onto the top; before: onto the top.'),
      choice('spaceOff', 'Space with nowhere to hop', 'jump: a small jump up and off the wall; before: Space alone climbs up.'),
      choice('hops', 'Where a hop looks', 'band: the asked way with a tolerance either side and up and down, the nearest lip taken; before: as it was.'),
      choice('steps', 'Steps along a lip', 'hands: crossed hand by hand up to the step\'s most; before: a step is the lip\'s end.'),
      dial('offUp', 'The small jump off rises', 0.05, 'm', 'Ours: 0.4, half a plain jump\'s 0.8 m apex.'),
      dial('offPush', 'And pushes off the wall at', 0.1, 'm/s', 'The free hang\'s own push back: 1.5.'),
      dial('hopDown', 'A hop reaches down', 0.05, 'm', 'Ours: 1.5, as far as up reaches.'),
      dial('hopSlack', 'Up or down, either side by', 0.05, 'm', 'Ours: 0.75, the hands\' span and a hand more.'),
      dial('hopDepth', 'A face in front of or behind by', 0.05, 'm', 'Ours: 0.5, a stepped wall\'s 0.3 setback with room.'),
      dial('hopArc', 'A hop\'s way rises at its middle by', 0.01, 'of its length', 'Ours: 0.1, a 3 m hop rising 0.3 m.'),
      dial('stepMax', 'A step along a lip crossed up to', 0.01, 'm', 'The owner\'s 0.5.'),
      dial('useReach', 'E reaches for a lip as far ahead as', 0.01, 'm', 'Ours: 0.95, a little past where the wall climb feels for a face (0.8 to 0.93), so a lip over a wall in reach is grabbed rather than climbed to.'),
    ],
  },
  {
    title: 'Climbing II: the wall and looking away',
    note: 'Each switch\'s other word is the climbing as it was. On a wall A or D alone plays the braced shimmy clips, and every hand and foot the clip plants is held where it was planted until that limb\'s next reach, one limb reaching at a time. Braced and still, looking away past the threshold turns the spine toward the view, the leading hand leaves the lip into the hop clip\'s coil and reaches toward the view, and Space hops to a lip behind that way, else jumps a little off the wall.',
    dials: [
      choice('wallSide', 'Sideways on a wall', 'shimmy: the braced shimmy clips; before: the up clip slowed.'),
      choice('wallLimbs', 'Hands and feet on a wall', 'held: each held where it was planted until its next reach, one at a time; before: put where the clip has it, frame by frame.'),
      dial('holdMost', 'A held limb reaches anyway once the body has moved', 0.01, 'm', 'Ours: 0.3, a forearm, from where the clip has it.'),
      choice('lookAway', 'Looking away while braced', 'reach: the spine turns, the leading hand leaves the lip, Space hops behind; before: the view is free.'),
      dial('lookStart', 'Begins once the view turns past', 1, 'deg', 'Ours: 100, a little past square to the wall, so a glance along it never lets go.'),
      dial('lookTwist', 'The spine turns toward it by at most', 1, 'deg', 'Ours: 40, the hips still to the wall; the rig\'s own clamp is 69.'),
      dial('lookPose', 'The reach-back pose from the hop clip at', 0.01, 's', 'Its coil: the hips risen, the arms bent, the hands still on the lip (they leave at 0.35 to 0.45 s).'),
      dial('lookArm', 'The leading hand reaches toward the view by', 0.05, 'of the way', 'Ours: 0.6; nought leaves it where the held pose has it.'),
      dial('hopBehind', 'A hop behind reaches', 0.05, 'm', 'Ours: 3, twice the side hop\'s start.'),
    ],
  },
  {
    title: 'Climbing II: the faults mended',
    note: 'Each switch\'s other word is the climbing as it was (CLIMB1-notes\' faults). corners ramp: a corner turns the hands\' faces over the same span either side of it, so the heading at a corner\'s lip is the place\'s, at any frame rate. thinTop hang: a top shallower than the least depth is no top to stand on. slopeLimit inclusive: a lip exactly as steep as the limit is shimmied along. grabSweep swept: a lip the reach band passed during the frame is grabbed, at any frame rate.',
    dials: [
      choice('corners', 'Corners along a lip', 'ramp: the same span either side at any rate; before: as the rail\'s sampling put it.'),
      choice('thinTop', 'A thin top', 'hang: refused, the body hangs; before: climbed onto.'),
      dial('topMin', 'A top to stand on is at least', 0.01, 'm', 'Ours: 0.35 behind its lip, the body\'s own capsule radius.'),
      choice('slopeLimit', 'A lip exactly at the slope limit', 'inclusive: shimmied along; before: refused at its foot.'),
      choice('grabSweep', 'The grab\'s reach band', 'swept: over the frame\'s whole rise or fall; before: where the frame ended.'),
    ],
  },
  {
    title: 'The hands bracing',
    note: 'before: the arms as they were (nothing is felt for). on: moving into a wall the hand on that side rests on it (head on, both), in a passage narrower than the tight share both touch its sides, among people the hand on their side rests on them, and drifting in space near a surface both hands reach to it and step along it.',
    dials: [
      choice('brace.rule', 'The hands bracing', 'The whole of it: before is the arms as they were.'),
      choice('brace.people', 'On people near', 'The brief\'s start: on (never on one fighting you).'),
      dial('brace.reach', 'A face within', 0.01, 'm', 'Of the shoulders, on the human male: his arm, 0.56, and the shoulder\'s 0.19 off the middle line, less a hand: 0.7.'),
      dial('brace.press', 'Moving into it by at least', 0.05, 'of the move', 'A third: a glance along a wall never braces.'),
      dial('brace.tight', 'A passage narrower than', 0.05, 'm', 'The brief\'s 1.4, wall to wall at the shoulders.'),
      dial('brace.moving', 'Only moving faster than', 0.05, 'm/s', 'For a passage and a crowd: 0.4 (standing among people is not passing them).'),
      dial('brace.height', 'At the height of', 0.01, 'm', 'Over the feet on the human male: 1.3, a little under the shoulders.'),
      dial('brace.spaceReach', 'In space, a surface within', 0.05, 'm', 'The brief\'s 1.2 of the chest.'),
      dial('brace.ease', 'Hands reach out over', 0.01, 's', '0.2, and come back as quickly.'),
    ],
  },
];

/** The dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const CLIMB_DIALS: DialSet = { helper: 'climb', groups: CLIMB_GROUPS, shipped: readDials(CLIMB_GROUPS) };

/** The dials `__debug.climb` has, or null: what the debug menu asks as a helper is picked. */
export function climbDialsFor(helper: string): DialSet | null {
  return helper === 'climb' ? CLIMB_DIALS : null;
}
