// The body's shape on foot (Climbing II's feedback round, items 3 and 4) as dials (src/ui/dials.ts): every number of
// `MOVE_TUNE` on a slider in the debug menu when `move` is picked, and its two switches beside them. Each is set through
// `tuneMove`, exactly as `__debug.move({ tune })` sets it, so a slider and a typed line can never mean two things, and the
// line the menu copies out is that helper's own argument (`move({ tune: { duckAhead: 0.9 } })`). Every number here is how
// lying down and ducking feel and is the owner's to judge by hand; a slider's range is the table's own (`MOVE_RANGES`).
//
// Pure: it imports the tune and the dials' own types and nothing of the page, so a node test moves every dial through the
// real table.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { MOVE_CHOICES, MOVE_RANGES, MOVE_TUNE, tuneMove } from './moveTune.ts';

function read(key: string): unknown {
  return (MOVE_TUNE as unknown as Record<string, unknown>)[key];
}

/** A number of `MOVE_TUNE`, set through `tuneMove`. */
function dial(key: string, label: string, step: number, unit: string, note: string): NumberDial {
  const range = MOVE_RANGES[key];
  return { kind: 'number', key: `tune.${key}`, label, note, min: range.min, max: range.max, step, unit, get: () => read(key) as number, set: (v) => tuneMove({ [key]: v }) };
}

function choice(key: string, label: string, note: string): ChoiceDial {
  return { kind: 'choice', key: `tune.${key}`, label, note, choices: MOVE_CHOICES[key], get: () => String(read(key)), set: (s) => tuneMove({ [key]: s }) };
}

export const MOVE_GROUPS: DialGroup[] = [
  {
    title: 'Lying prone',
    note: "lying: a prone body wears a capsule lying along it (0.4 m round at the radius's start, turned with the heading and tipped along the ground), so it passes under anything 0.48 m up or more; going prone where it does not fit, and getting up where there is no room to stand, are refused in words. crouch: today's (the crouch's upright 1.0 m capsule).",
    dials: [
      choice('proneShape', 'Prone shape', "crouch is today's: the crouch's upright capsule."),
      dial('lyingRadius', 'Lying capsule radius', 0.01, 'm', "0.2: with the controller's 0.04 m kept off the ground and off a roof the lying body stands 0.48 m, about the 0.45 m a body lying on its front stands, and passes under a 0.5 m slab at every frame rate (it needs twice the radius and 0.08 m)."),
    ],
  },
  {
    title: 'Ducking under things',
    note: "on: what stands still over the body and ahead along its travel sets how tall its capsule may be, from standing down past the crouch to the deepest duck, without the key; the crouch blends into the pose and, past the crouch's height, the spine and neck bend. off: today's (standing, or crouched by the key alone).",
    dials: [
      choice('duck', 'Duck under overhangs', "off is today's."),
      dial('duckAhead', 'Looks ahead past its front', 0.05, 'm', '0.6: a stride. The look ahead also grows with the speed, by how far the body goes while the capsule shrinks.'),
      dial('duckMost', 'Deepest duck', 0.01, 'm', "0.75 m of body: a deep stoop under the crouch's 1.0. Never under 0.7, the capsule's own ball."),
      dial('duckRate', 'Ducks and rises at', 0.1, 'm/s', "3: standing to the crouch's height in 0.2 s, about the rig's own fade between two clips."),
      dial('duckBend', 'Spine bends at the deepest', 1, 'deg', "40: the head lowered the quarter metre past the crouch over a torso of about 0.6 m."),
      dial('duckNeck', 'Neck bends with it', 1, 'deg', '20: the head carried down with the back, the face still ahead.'),
    ],
  },
  {
    title: "Ducking's pace (Climbing II, smoothness)",
    note: "height: a ducked body slows from its walk's speed toward the crouch's as it lowers, wears the crouch's clips at their height and walks at their pace, slows on toward the crawl's past it, and where the room is too low for the deepest duck but a lying body fits it lies down and crawls, getting up again into a crouch where the room comes back. before: the feedback round's duck at the walk's own speeds and clips.",
    dials: [
      choice('duckPace', 'Pace by height', "before is the feedback round's duck."),
      dial('crouchAt', "Crouch's clips at", 0.01, 'm', "1.05: the crouch's own 1.0 and the 5 cm the duck keeps over it, so a roof the crouch just passes under is walked under crouched."),
      dial('crouchBand', 'Back to the walk past it by', 0.01, 'm', "0.05: a hand's width, so a duck holding at the crouch's height never swaps clips back and forth."),
      dial('paceCurve', 'Pace follows the height', 0.05, '', '1: straight; over 1 it keeps the faster pace longer, under 1 slows sooner.'),
      dial('proneUnder', 'Lies down under', 0.01, 'm', "0.8: the deepest duck's 0.75 and its 0.05 clearance, so every room the duck passes under it walks under and only a lower one is crawled."),
      dial('proneAhead', 'Lies down this far before it', 0.05, 'm', "1.2: the lying body's half length, 0.9, and a third of a stride, so it is down before its head reaches the roof."),
      dial('riseAt', 'Gets up where the room is', 0.01, 'm', "1.0: the crouch's own height; the duck stands it the rest of the way as the room allows."),
    ],
  },
  {
    title: "The duck's head (Climbing II, Smoothness II)",
    note: "clear: the duck keeps the room over and ahead of the body as tall as the drawn figure's own top (its head, neck and chest spheres as the pose stands) and headSkin more, so it ducks further, and lies down sooner, until the drawn head clears what is over it. before: the smoothness round's duck, the capsule's own 5 cm.",
    dials: [
      choice('duckHead', 'The head clear of a low roof', "before is the smoothness round's duck."),
      dial('headSkin', 'The head keeps under a roof by', 0.005, 'm', '0.03: a hair, so a beam just over the head is passed with the head brushing nothing.'),
    ],
  },
  {
    title: "Lying down and the duck's crouch (Climbing II, Smoothness III)",
    note: "proneMin opening: the duck lies down only into a real opening, a gap whose floor and roof run on past the lying body's length with the skin below to spare (never at a wall, a step or a slab's side); a probe that begins inside something answers nothing and the body stands. today: the room alone, as Smoothness II left it. duckClip clearance: the duck wears the crouch clip whose head stands highest and still clears what is over it by headSkin (the sneak walk the last), its capsule shrunk to that clip's own measured head, and lies only under the sneak's head; one: the one crouch walk the duck always wore.",
    dials: [
      choice('proneMin', 'Lying down', 'opening: only into a real opening; today: the room alone, as before.'),
      dial('proneSkin', 'An opening has to have to spare', 0.005, 'm', "Ours: 0.05, the duck's own clearance: a gap the lying body only scrapes through is no opening."),
      choice('duckClip', "The duck's crouch", 'clearance: the highest crouch clip that clears, the sneak walk last; one: the one crouch walk, as before.'),
    ],
  },
];

export const MOVE_DIALS: DialSet = { helper: 'move', groups: MOVE_GROUPS, shipped: readDials(MOVE_GROUPS) };

/** The dials `__debug.move` has, or null: what the debug menu asks as a helper is picked. */
export function moveDialsFor(helper: string): DialSet | null {
  return helper === 'move' ? MOVE_DIALS : null;
}
