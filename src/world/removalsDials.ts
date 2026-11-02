// The removals' and the seats' dials (src/ui/dials.ts; Map-maker II's twelfth wave): their numbers of feel as sliders in
// the debug menu when `removals` or `seats` is picked. Each is set exactly as `__debug.removals({ tune })` and
// `__debug.seats({ tune, snap })` set them (`HIDE_TUNE`, `ZONE_TUNE`, `tuneSeats`, `SEAT_SNAP_TUNE`), so the line the menu
// copies out is that helper's own argument. Every one is the owner's to move by hand: how near a content key's place an
// object must stand to be the one it names, whether a zone keeps a site off by its bodies or its middle, and how near a
// sitter a chair or a table counts as its own (which is also how near the world editor's snap reaches).
//
// Pure: it imports the tables and the dials' own types and nothing of the page, so a node test moves every dial through
// the real tables. Rule for this file (node runs it with type stripping): every import with its `.ts` extension.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { HIDE_TUNE } from '../story/removals.ts';
import { ZONE_TUNE } from './mobiles/lairs.ts';
import { SEAT_SNAP_TUNE, SEAT_TUNE, tuneSeats } from './seatProps.ts';

const REMOVALS_GROUPS: DialGroup[] = [
  {
    title: 'Finding what a row names',
    note: "A removal row names one of the world's own objects by its template and its place to the centimetre: the copy of that template nearest the place within this, then its twin. Read at the next landing or arrival.",
    dials: [
      {
        kind: 'number',
        key: 'tune.match',
        label: 'Found within',
        note: "Metres round a key's own place its object must stand: wide enough for a conversion that rounded a hair the other way, narrow enough that a neighbour of the same template is never taken for it.",
        min: 0.005,
        max: 1,
        step: 0.005,
        unit: 'm',
        get: () => HIDE_TUNE.match,
        set: (v) => {
          if (v > 0 && v <= 5) HIDE_TUNE.match = v;
          return HIDE_TUNE.match === v ? [] : [`held at ${HIDE_TUNE.match}`];
        },
      },
    ],
  },
  {
    title: 'No-spawn zones',
    note: 'Read the next time the wildlife is laid (a landing of the removal file, or an arrival).',
    dials: [
      {
        kind: 'choice',
        key: 'tune.margin',
        label: 'A site is kept off by',
        note: "spread: by its bodies, its middle grown by half its footprint and its herd's spread, so nothing of it stands in the zone; middle: by its middle alone, so a herd at the edge may stand half inside.",
        choices: ['spread', 'middle'],
        get: () => ZONE_TUNE.margin,
        set: (v) => {
          if (v === 'spread' || v === 'middle') ZONE_TUNE.margin = v;
          return ZONE_TUNE.margin === v ? [] : [`held at ${ZONE_TUNE.margin}`];
        },
      } satisfies ChoiceDial,
    ],
  },
];

/** The removals' dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const REMOVALS_DIALS: DialSet = { helper: 'removals', groups: REMOVALS_GROUPS, shipped: readDials(REMOVALS_GROUPS) };

/** One number of `SEAT_TUNE`, set through `tuneSeats`. */
function seatDial(name: 'seatNear' | 'tableNear' | 'level' | 'ahead' | 'share', label: string, note: string, min: number, max: number, step: number): NumberDial {
  return {
    kind: 'number',
    key: `tune.${name}`,
    label,
    note,
    min,
    max,
    step,
    unit: 'm',
    get: () => SEAT_TUNE[name],
    set: (v) => {
      tuneSeats({ [name]: v });
      return SEAT_TUNE[name] === v ? [] : [`held at ${SEAT_TUNE[name]}`];
    },
  };
}

const SEATS_GROUPS: DialGroup[] = [
  {
    title: 'A seat and a table of the data',
    note: "How near a sitter a chair or a table (the world's own, a permanent row, or one in the editor's hand) is that sitter's: none of ours stands beside it, and the world editor's snap reaches this far. Read the next time the seats are stood (an arrival, or seats({ again: true })).",
    dials: [
      seatDial('seatNear', 'A chair within', "Metres from a chair sitter's spot a chair counts as its seat (and the snap puts one there).", 0.1, 3, 0.05),
      seatDial('tableNear', 'A table within', "Metres from the spot in front of a table sitter a table counts as its table (and the snap puts one there).", 0.1, 4, 0.05),
      seatDial('level', 'On the same floor within', 'Metres above or below that still count as the same floor: a balcony is not its bar.', 0.1, 5, 0.05),
      seatDial('ahead', 'A table stands ahead', "Metres in front of a table sitter its table's middle stands.", 0.2, 2, 0.05),
      seatDial('share', 'Tables are one within', "Metres within which two sitters' tables are one table.", 0.1, 4, 0.05),
      {
        kind: 'choice',
        key: 'snap',
        label: 'The editor snaps a seat',
        note: "on: a chair or a table in the world editor's hand jumps to the nearest sitter within reach, facing it; off: it stands where the aim puts it.",
        choices: ['on', 'off'],
        get: () => (SEAT_SNAP_TUNE.on ? 'on' : 'off'),
        set: (v) => {
          if (v === 'on' || v === 'off') SEAT_SNAP_TUNE.on = v === 'on';
          return [];
        },
      } satisfies ChoiceDial,
    ],
  },
];

/** The seats' dials, the same way. */
export const SEATS_DIALS: DialSet = { helper: 'seats', groups: SEATS_GROUPS, shipped: readDials(SEATS_GROUPS) };

/** The dials of `removals` or `seats`, or null for another helper. */
export function removalsDialsFor(helper: string): DialSet | null {
  return helper === 'removals' ? REMOVALS_DIALS : helper === 'seats' ? SEATS_DIALS : null;
}
