// The world editor's dials (`src/ui/dials.ts`): its numbers of feel as sliders in the debug menu when `editor` is picked,
// each set through `__debug.editor({ tune })`'s own setter (`tuneEditor`), so the line the menu copies out is that
// helper's (`editor({ tune: { cam: { speed: 20 } } })`). Every one is the owner's to judge by hand; a slider's range is
// ours. The dev server's alone: reached only through the editor's own dynamic import.
//
// Pure: the tune and the dials' own types. Rule for this file (node runs it with type stripping): every import with its
// `.ts` extension, no enum, no namespace, no constructor parameter properties.

import type { DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { EDITOR_TUNE, EDITOR_TUNE_DEFAULTS, tuneEditor } from './editorTune.ts';

/** A number of `EDITOR_TUNE` by its path, as a slider. */
function dial(path: string, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  const parts = path.split('.');
  const read = (from: unknown): number => parts.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], from) as number;
  return {
    kind: 'number',
    key: `tune.${path}`,
    label,
    note,
    min,
    max,
    step,
    unit,
    get: () => read(EDITOR_TUNE),
    set: (v) => {
      const partial: Record<string, unknown> = {};
      let at = partial;
      for (let i = 0; i < parts.length - 1; i++) {
        const next: Record<string, unknown> = {};
        at[parts[i]] = next;
        at = next;
      }
      at[parts[parts.length - 1]] = v;
      return tuneEditor(partial);
    },
  };
}

function groups(): DialGroup[] {
  return [
    {
      title: 'The free camera',
      note: 'How the eye flies. Every number moves live and is never saved: the menu copies the line that keeps it.',
      dials: [
        dial('cam.speed', 'Speed', 0.5, 200, 0.5, 'm/s', 'Metres a second with nothing held (the wheel and = and - step it while flying).'),
        dial('cam.fast', 'Shift times', 1, 20, 0.5, '×', 'Shift held flies this many times faster.'),
        dial('cam.slow', 'Alt times', 0.02, 1, 0.01, '×', 'Alt held flies at this share of the speed.'),
        dial('cam.wheelStep', 'A notch of the wheel', 1.05, 2, 0.01, '×', 'One notch multiplies the speed by this.'),
        dial('cam.min', 'Slowest', 0.1, 10, 0.1, 'm/s', 'The least the speed steps to.'),
        dial('cam.max', 'Fastest', 10, 5000, 10, 'm/s', 'The most the speed steps to.'),
        dial('cam.ease', 'Ease', 0, 1, 0.01, 's', 'Seconds the flight takes to reach what the keys ask: nought is instant.'),
        dial('cam.look', 'Mouse look', 0.1, 4, 0.05, '×', "The mouse's turn over the game's own sensitivity."),
      ],
    },
    {
      title: 'The world while you fly',
      dials: [dial('livingAbove', 'Living stand past', 1, 200, 1, 'm/s', 'Flying faster than this stands and puts away nobody (each body is a clone and a compile).')],
    },
    {
      title: 'The hand',
      dials: [
        dial('aim.skyReach', 'Into the sky at', 2, 400, 1, 'm', 'Where a thing in hand stands when the aim meets nothing (the wheel moves it).'),
        dial('aim.skyStep', 'A notch moves it', 0.02, 0.5, 0.01, '', 'One notch of the wheel moves it by this share of where it is.'),
      ],
    },
    {
      title: 'The window',
      dials: [
        dial('window.width', 'Opens this wide', 400, 900, 10, 'px', 'How wide the window opens (from the next session; drag its corner meanwhile).'),
        dial('outline.width', 'Box lines', 0.5, 4, 0.25, 'px', 'How thick the boxes the editor draws are.'),
      ],
    },
  ];
}

/** The tune's shipped value at a dial's key. */
function shippedValue(key: string, now: number | string): number | string {
  const parts = key.split('.').slice(1);
  const v = parts.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], EDITOR_TUNE_DEFAULTS);
  return typeof v === 'number' ? v : now;
}

/** The editor's dials, made each time the helper is picked. */
export function editorDialSet(): DialSet {
  const g = groups();
  const shipped = readDials(g);
  for (const [k, v] of shipped) shipped.set(k, shippedValue(k, v));
  return { helper: 'editor', groups: g, shipped };
}

/** The debug menu's dials for `editor`, or null for another helper. */
export function editorDialsFor(helper: string): DialSet | null {
  return helper === 'editor' ? editorDialSet() : null;
}
