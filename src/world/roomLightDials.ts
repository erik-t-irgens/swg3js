// The rooms' lights' dials (src/ui/dials.ts, Map-maker II's wave of the rooms' lights): the numbers that light every room --
// how bright a lamp is, the ambient and its floor, the room's parallel light -- and how the flickers move, on sliders in the
// debug menu when `roomLights` is picked. Each is set through `tuneRoomLights`, exactly as `__debug.roomLights({ tune })` sets
// it, so the clamps and the words are the console's own and the line the menu copies out is that helper's own argument
// (`roomLights({ tune: { lightScale: 3.5 } })`). Feel, the owner's to judge by eye (CLAUDE.md, "Feel is the owner's"); a
// slider's range is ours. The casting slots' biases and map sizes are technical and have no slider (the console moves them).
//
// Pure: it imports the tunes and the dials' own types and nothing of the page, so a node test moves every dial through the
// real tables.
import type { DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { ROOM_LIGHT_TUNE } from './roomLights.ts';
import { FLICKER_TUNE } from './lightFlicker.ts';
import { tuneRoomLights } from './roomLightPool.ts';

type RoomKey = 'lightScale' | 'ambientScale' | 'ambientFloor' | 'parallel' | 'parallelBack';
type FlickerKey = keyof typeof FLICKER_TUNE;

/** A number of `ROOM_LIGHT_TUNE`, set through `tuneRoomLights` as the console's line writes it (`{ tune: { lightScale } }`). */
function roomDial(k: RoomKey, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => ROOM_LIGHT_TUNE[k], set: (v) => tuneRoomLights({ [k]: v }) };
}

/** A number of `FLICKER_TUNE`, set through `tuneRoomLights` (`{ tune: { flicker: { candleFine } } }`). */
function flickerDial(k: FlickerKey, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  return { kind: 'number', key: `tune.flicker.${k}`, label, note, min, max, step, unit, get: () => FLICKER_TUNE[k], set: (v) => tuneRoomLights({ flicker: { [k]: v } }) };
}

const ROOM_GROUPS: DialGroup[] = [
  {
    title: 'How every room is lit',
    note: "The numbers every room's lights are put on with, the game's own lights and the owner's alike: at their first values every room is lit exactly as before. Each move plans the lit room again (uniforms alone: nothing compiles).",
    dials: [
      roomDial('lightScale', 'Lamps brightened', 0, 12, 0.05, '×', "A lamp's intensity is nine times its value at 3 m times this (the world's 3): three's inverse square against the game's own falloff, brightened."),
      roomDial('ambientScale', 'Ambient', 0, 6, 0.05, '×', "The rooms' ambient over its summed colour (the world's 1.2)."),
      roomDial('ambientFloor', 'Ambient floor', 0, 1, 0.01, '', "Where the ambient starts under every room's own fill: rooms are never pitch black (the world's 0.18)."),
      roomDial('parallel', "The room's parallel light", 0, 6, 0.05, '', "The room's parallel light's intensity (the world's 1.2); a directional the owner put down is a share of it."),
      roomDial('parallelBack', 'Parallel hung back', 0, 200, 1, 'm', "Metres back along its way the parallel light is hung from its own place (the world's 20)."),
    ],
  },
  {
    title: 'How the lights flicker',
    note: "The flicker shapes' own numbers (a light's rate and depth are its own, in the lights file). On the shared clock, so every browser flickers alike.",
    dials: [
      flickerDial('candleFine', 'Candle: fine share', 0, 1, 0.01, '', "How much of a candle's waver is the fine, quick one over the slow."),
      flickerDial('candleFineRate', 'Candle: fine rate', 0, 20, 0.1, '×', "The fine waver's rate over the light's own."),
      flickerDial('strobeLit', 'Strobe: lit share', 0.01, 0.99, 0.01, '', "The share of a strobe's beat it is lit."),
      flickerDial('brokenShare', 'Broken: off share', 0, 1, 0.01, '', 'The share of its beats a broken light drops out.'),
      flickerDial('brokenDrop', 'Broken: a drop lasts', 0, 1, 0.01, '', 'How long a drop out lasts, as a share of its cycle.'),
      flickerDial('brokenStutter', 'Broken: stutters', 0, 20, 1, '', 'How many times it stutters back on the way out of a drop.'),
    ],
  },
];

/** The rooms' lights' dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const ROOM_LIGHT_DIALS: DialSet = { helper: 'roomLights', groups: ROOM_GROUPS, shipped: readDials(ROOM_GROUPS) };

/** The dials the `roomLights` helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function roomLightDialsFor(helper: string): DialSet | null {
  return helper === 'roomLights' ? ROOM_LIGHT_DIALS : null;
}
