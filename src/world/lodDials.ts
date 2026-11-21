// The detail levels' numbers of look as the debug menu's sliders, when `lod` is picked (the GPU port's pass 1, wave 7): how
// far every level is kept out (`bias`), how far the levels the converter's `lods` made are kept out on top of it
// (`madeBias`, their own, since their switches are a rule of thumb of ours where the client's are the client's), and the
// band a copy must pass back across before its level changes back. Each is set through `__debug.lod({ tune })` itself,
// which the menu hands in (`lodDialsFor`), so a slider and a typed line never mean two things; with none handed (a test)
// a dial writes the tune as that helper does. Every level group and planting reads the tune at its next sweep (a quarter
// of a second at most), so each takes live.
//
// Pure: the tune table and the dials' shapes, nothing of the page.
import type { DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { LOD_LEVEL_TUNE, type LodLevelTune } from './lodLevels.ts';

type LodKey = 'bias' | 'madeBias' | 'hysteresis';

/** How a dial's value reaches the game: `__debug.lod({ tune })`, which the menu hands in; null in a test. */
const APPLY: { fn: ((tune: Partial<LodLevelTune>) => void) | null } = { fn: null };

/** A number written as the console helper writes one (a number, finite), when no helper was handed in. */
function write(k: LodKey, v: number): string[] {
  if (!(typeof v === 'number' && Number.isFinite(v))) return [`${k} must be a number`];
  if (APPLY.fn) APPLY.fn({ [k]: v });
  else LOD_LEVEL_TUNE[k] = v;
  return [];
}

function num(k: LodKey, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => LOD_LEVEL_TUNE[k], set: (v) => write(k, v) };
}

const GROUPS: DialGroup[] = [
  {
    title: 'Where the levels switch',
    note: "Every placed thing and plant out in the open is drawn at the level its distance picks: the client's own levels where it made them, and where it made none, the ones the converter's lods made. Each moves live.",
    dials: [
      num('bias', 'Every level', 0.25, 4, 0.05, '×', "Every switch distance, the client's and the made ones alike, times this: over 1 keeps each level out farther."),
      num('madeBias', 'Made levels', 0.25, 8, 0.05, '×', "The made levels' switch distances times this, on top of Every level. At 1 a made level switches in where its error comes to one pixel of a 1440-row screen; at 2, half a pixel. The client's own levels never move with it."),
      num('hysteresis', 'Band', 0, 0.3, 0.01, '', 'The share of a switch distance a copy must pass back across before its level changes back, so one standing on the line never flickers.'),
    ],
  },
];

/** The detail levels' dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const LOD_DIALS: DialSet = { helper: 'lod', groups: GROUPS, shipped: readDials(GROUPS) };

/** The detail levels' dials for the debug menu (null for any other helper); `apply` is `__debug.lod({ tune })` itself. */
export function lodDialsFor(helper: string, apply?: (tune: Partial<LodLevelTune>) => void): DialSet | null {
  if (helper !== 'lod') return null;
  if (apply) APPLY.fn = apply;
  return LOD_DIALS;
}
