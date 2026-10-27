// The world editor's dials (`src/ui/dials.ts`): its numbers of feel as sliders in the debug menu when `editor` is picked,
// each set through `__debug.editor({ tune })`'s own setter (`tuneEditor`), so the line the menu copies out is that
// helper's (`editor({ tune: { cam: { speed: 20 } } })`). Every one is the owner's to judge by hand; a slider's range is
// ours. The dev server's alone: reached only through the editor's own dynamic import.
//
// Pure: the tune and the dials' own types. Rule for this file (node runs it with type stripping): every import with its
// `.ts` extension, no enum, no namespace, no constructor parameter properties.

import type { DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { EDITOR_TUNE, EDITOR_TUNE_DEFAULTS, SCULPT_TUNE, SCULPT_TUNE_DEFAULTS, tuneEditor, tuneSculpt } from './editorTune.ts';
import { GROUND_REWRITE_TUNE } from '../world/groundRewrite.ts';

/**
 * The sculpt brush's numbers of feel (Map-maker II §2.16), as `[key, label, min, max, step, unit, note]`: one list both
 * sets read, the editor's (through `editor({ tune: { sculpt } })`, on the Tools tab) and `sculpt`'s own (through
 * `sculpt({ tune })`, in the debug menu).
 */
const SCULPT_DIALS: [string, string, number, number, number, string, string][] = [
  ['radius', 'Radius', 1, 200, 0.5, 'm', 'The disc (C held with the wheel steps it).'],
  ['radiusStep', 'A notch steps it', 1.01, 2, 0.01, '×', 'One notch of the wheel with C held multiplies the radius by this.'],
  ['radiusMin', 'Smallest', 0.5, 50, 0.5, 'm', 'The least the radius steps to.'],
  ['radiusMax', 'Largest', 10, 500, 5, 'm', 'The most the radius steps to.'],
  ['hard', 'Hard core', 0, 1, 0.01, '', 'The share of the radius at full strength before the feather begins.'],
  ['strength', 'Strength', 0, 1, 0.01, '', 'How hard a stamp bites, every mode.'],
  ['speed', 'Raise and lower', 0.05, 50, 0.05, 'm/s', 'Metres a second held at the middle.'],
  ['tau', 'Flatten closes in', 0.02, 5, 0.01, 's', 'Seconds a flatten takes to close most of the way to its height.'],
  ['smoothTau', 'Smooth closes in', 0.02, 5, 0.01, 's', 'Seconds a smooth takes to close most of the way to the mean.'],
  ['rate', 'Rate', 1, 120, 1, '/s', 'Stamps a second while a button is held (the same ground at any frame rate).'],
  ['keepMargin', 'Keep off by', 0, 20, 0.25, 'm', 'How far past what stands the ground is held.'],
  ['keepFeather', 'Then fade over', 0, 40, 0.25, 'm', 'How far it fades back to the whole stroke.'],
  ['keepTrunkMargin', 'Trunks kept by', 0, 5, 0.05, 'm', "How far past a placed tree's trunk."],
  ['keepTrunkFeather', 'Trunks fade over', 0, 10, 0.1, 'm', 'How far that fades back.'],
  ['carryNear', 'Carry within', 0, 2, 0.01, 'm', "A row whose foot stands this near its ground goes up and down with it."],
  ['frameMs', 'Rebuild a frame', 0.25, 16, 0.25, 'ms', "The ground's rewrite and replant may spend this much of a frame."],
  ['floraHz', 'Replant', 0.25, 30, 0.25, '/s', 'How many times a second a held stroke plants its ground again.'],
];

/** The sculpt brush's group, its dials set through `set` and read off `path` within the tune it names. */
function sculptGroup(prefix: string, set: (k: string, v: number) => string[]): DialGroup {
  return {
    title: 'The sculpt brush',
    note: 'K arms it; LMB held applies its mode, RMB held lowers (raise) or raises (lower). Its modes, flatten’s height and its switches are on the Tools tab.',
    dials: SCULPT_DIALS.map(([k, label, min, max, step, unit, note]) => ({
      kind: 'number' as const,
      key: `tune.${prefix}${k}`,
      label,
      note,
      min,
      max,
      step,
      unit,
      get: () => (SCULPT_TUNE as unknown as Record<string, number>)[k],
      set: (v: number) => set(k, v),
    })),
  };
}

/** The `sculpt` helper's own dials (the debug menu's, when `sculpt` is picked): every number of feel in `SCULPT_TUNE`. */
export function sculptDialSet(): DialSet {
  const g = [sculptGroup('', (k, v) => tuneSculpt({ [k]: v }, GROUND_REWRITE_TUNE))];
  const shipped = readDials(g);
  for (const [k] of shipped) {
    const v = (SCULPT_TUNE_DEFAULTS as unknown as Record<string, unknown>)[k.slice('tune.'.length)];
    if (typeof v === 'number') shipped.set(k, v);
  }
  return { helper: 'sculpt', groups: g, shipped };
}

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
      title: 'The hand on what is picked',
      note: 'R held turns, F held raises, C held scales, Shift+R (not flying) tips and rolls; the gizmo is dragged with the left button.',
      dials: [
        dial('cam.scalePerPx', 'Scale a pixel', 0.0005, 0.02, 0.0005, '', 'How far a pixel of the mouse with C held scales: exp(this × pixels), mouse up larger.'),
        dial('gizmo.px', 'Gizmo size', 30, 240, 5, 'px', 'How far the handles reach out from the pivot on the screen.'),
        dial('gizmo.width', 'Gizmo lines', 0.5, 6, 0.25, 'px', 'How thick the handles are drawn.'),
        dial('pick.hitPx', 'Handle reach', 3, 30, 1, 'px', 'How near the cursor must be to a handle to grab it.'),
        dial('dupOffset', 'Duplicate offset', 0, 10, 0.25, 'm', 'How far Ctrl+D puts a copy from what it copies (0: in place).'),
      ],
    },
    {
      title: 'Snapping',
      note: '[ and ] step the grid (Shift: the angle); \\ turns snapping off and on.',
      dials: [
        dial('snap.scaleStep', 'Scale step', 0.01, 0.5, 0.01, '', 'The step a scale snaps to while snapping is on, and the wheel with C held steps by.'),
        dial('snap.normalMaxDeg', 'Lean at most', 0, 45, 1, '°', 'Shift+End leans a thing toward the surface under it by at most this.'),
        dial('snap.neighbourPx', 'Flush within', 2, 40, 1, 'px', 'V held while dragging takes the faces flush to a neighbour within this.'),
      ],
    },
    {
      title: 'The brush',
      note: 'B arms it with the library entries Shift+clicked (or what is in hand); LMB held paints, RMB held erases. Its switches (yaw at random, lean to the ground, keep off water and what stands, the height filter) are on the Tools tab.',
      dials: [
        dial('brush.radius', 'Radius', 1, 64, 0.5, 'm', "The brush's disc."),
        dial('brush.density', 'Density', 0.05, 50, 0.05, '/100 m²', 'The rows of its own entries a stroke fills the disc toward, counting what stands.'),
        dial('brush.spacing', 'Spacing', 0, 20, 0.1, 'm', 'The least distance between two plants, and from anything standing.'),
        dial('brush.rate', 'Rate', 0.5, 30, 0.5, '/s', 'Stamps a second while a button is held (the same at any frame rate).'),
        dial('brush.scaleMin', 'Scale from', 0.05, 5, 0.05, '×', 'The least uniform scale a plant is drawn at.'),
        dial('brush.scaleMax', 'Scale to', 0.05, 5, 0.05, '×', 'The most.'),
        dial('brush.alignMax', 'Lean at most', 0, 45, 1, '°', 'With the lean on, how far a plant leans toward the ground.'),
        dial('brush.slopeMin', 'Slope from', 0, 90, 1, '°', 'The least slope of ground a plant stands on.'),
        dial('brush.slopeMax', 'Slope to', 0, 90, 1, '°', 'The most.'),
        dial('brush.heightMin', 'Height from', -1000, 4000, 5, 'm', 'With the height filter on, the lowest ground a plant stands on.'),
        dial('brush.heightMax', 'Height to', -1000, 10000, 5, 'm', 'The highest.'),
        dial('brush.eraseShare', 'Erase takes', 0.05, 1, 0.05, '', 'The share of its own rows in the disc an erase stamp takes.'),
        dial('brush.tries', 'Tries a plant', 1, 40, 1, '', 'Candidates a stamp tries for each plant it still wants.'),
      ],
    },
    sculptGroup('sculpt.', (k, v) => tuneEditor({ sculpt: { [k]: v } })),
    {
      title: 'Folding',
      note: 'Rows written while their tier stands are drawn one by one until the next arrival or Fold now (Tools).',
      dials: [
        dial('foldHint', 'Say past', 1, 5000, 1, 'rows', 'Past this many rows drawn one by one the bar offers Fold now.'),
        dial('autoFoldIdle', 'Fold by itself after', 0.5, 30, 0.5, 's', 'With the automatic fold on (Tools), how long nothing must happen first.'),
      ],
    },
    {
      title: 'The window',
      dials: [
        dial('window.width', 'Opens this wide', 400, 900, 10, 'px', 'How wide the window opens (from the next session; drag its corner meanwhile).'),
        dial('outline.width', 'Box lines', 0.5, 4, 0.25, 'px', 'How thick the boxes the editor draws are.'),
        dial('outline.most', 'Boxes at most', 1, 200, 1, '', 'Past this many picked, one box round them all.'),
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
  return helper === 'editor' ? editorDialSet() : helper === 'sculpt' ? sculptDialSet() : null;
}
