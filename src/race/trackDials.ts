// A race run's and the track editor's numbers of feel as the debug menu's sliders, when `track` is picked: the
// countdown, the start's window and boost, how long a crash keeps you out, the gates the editor drops and how far its
// buttons nudge one (`TRACK_TUNE`). Each is set through `tuneTrack`, exactly as `__debug.track({ tune })` sets it, so a
// slider and a typed line never mean two different things. A slider's range is ours, wide enough to try anything
// sensible; a number typed into its box may go past it, as far as the helper allows.
//
// Pure: it imports the tune table and the dials' own shapes, nothing of the page, so a node test moves every dial
// through the real table.
import type { DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { TRACK_TUNE, tuneTrack, type TrackTune } from './trackTune.ts';

/** A number of `TRACK_TUNE`, set through `tuneTrack`. */
function run(k: keyof TrackTune, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  const t = TRACK_TUNE as unknown as Record<string, number>;
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => t[k], set: (v) => tuneTrack({ [k]: v }) };
}

const TRACK_GROUPS: DialGroup[] = [
  {
    title: 'The start',
    note: 'A run stands at its grid for the countdown; W pressed in the window round go (not held from before it) gives a start boost.',
    dials: [
      run('countdown', 'Countdown', 0, 10, 0.5, 's', 'Seconds standing at the grid before go.'),
      run('startWindow', 'Start window', 0, 1, 0.05, 's', 'How long either side of go W may go down and still earn the start boost.'),
      run('startBoost', 'Start boost', 1, 6, 0.1, '×', 'How much quicker the thrust climbs while the start boost lasts.'),
      run('startCap', 'Start boost ends at', 0.2, 1, 0.05, '', 'The share of the plain top at which the start boost ends (it ends too when W is let go).'),
    ],
  },
  {
    title: 'A crash in a run',
    dials: [run('putBack', 'Put back after', 0, 10, 0.1, 's', 'Seconds a crash keeps you out before you are put back on a whole vehicle at the last gate, the clock running.')],
  },
  {
    title: 'Laying and editing a track',
    note: 'The size of a gate the editor drops (Numpad0 while laying, or Insert after), and how far its nudge buttons move one.',
    dials: [
      run('podGateWidth', 'Pod gate width', 4, 80, 1, 'm', 'How wide a gate is dropped for a pod.'),
      run('podGateHeight', 'Pod gate height', 5, 100, 1, 'm', 'How tall a gate is dropped for a pod.'),
      run('bikeGateWidth', 'Bike gate width', 4, 80, 1, 'm', 'How wide a gate is dropped for a bike.'),
      run('bikeGateHeight', 'Bike gate height', 5, 100, 1, 'm', 'How tall a gate is dropped for a bike.'),
      run('nudge', 'Nudge', 0.1, 10, 0.1, 'm', 'How far a nudge button moves a gate.'),
      run('nudgeTurn', 'Nudge turn', 0.5, 45, 0.5, '°', 'How far a turn button turns a gate.'),
      run('splitShow', 'Split shown', 0, 15, 0.5, 's', 'How long a split stands in the race block after its gate.'),
    ],
  },
];

/** The track's dials, with the values the game shipped (read once, as this module loads). */
export const TRACK_DIALS: DialSet = { helper: 'track', groups: TRACK_GROUPS, shipped: readDials(TRACK_GROUPS) };
