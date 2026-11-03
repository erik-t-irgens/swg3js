// The world editor's dials (`src/ui/dials.ts`): its numbers of feel as sliders in the debug menu when `editor` is picked,
// each set through `__debug.editor({ tune })`'s own setter (`tuneEditor`), so the line the menu copies out is that
// helper's (`editor({ tune: { cam: { speed: 20 } } })`). Every one is the owner's to judge by hand; a slider's range is
// ours. The dev server's alone: reached only through the editor's own dynamic import.
//
// Pure: the tune and the dials' own types. Rule for this file (node runs it with type stripping): every import with its
// `.ts` extension, no enum, no namespace, no constructor parameter properties.

import type { DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { EDITOR_EXTRA_DEFAULTS, EDITOR_EXTRA_TUNES, EDITOR_TUNE, EDITOR_TUNE_DEFAULTS, FLORA_PAINT_TUNE, FLORA_PAINT_TUNE_DEFAULTS, PAINT_TUNE, PAINT_TUNE_DEFAULTS, PLACES_TOOL_CHOICES, PLACES_TOOL_TUNE, PLACES_TOOL_TUNE_DEFAULTS, SCULPT_TUNE, SCULPT_TUNE_DEFAULTS, WATER_TUNE, WATER_TUNE_DEFAULTS, tuneEditor, tuneFloraPaint, tunePaint, tunePlacesTool, tuneSculpt, tuneWater } from './editorTune.ts';
import { GROUND_PAINT_TUNE, GROUND_REWRITE_TUNE } from '../world/groundRewrite.ts';
import { LAKE_TUNE, RIVER_TUNE, tuneRiverTune } from '../world/ourWater.ts';
import { DRESSER_TUNE, tuneDresser } from './dresser.ts';

/** The lakes' own shipped numbers, as this module first saw them (before any console line moved them). */
const LAKE_TUNE_SHIPPED = { ...LAKE_TUNE };
/** The rivers' own, the same way (the sixth wave). */
const RIVER_TUNE_SHIPPED = { ...RIVER_TUNE };

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

/**
 * The paint brush's numbers of feel (Map-maker II's second wave, §2.16), as `[key, label, min, max, step, unit, note]`: one
 * list both sets read, the editor's (through `editor({ tune: { paint } })`) and `groundPaint`'s own (through
 * `groundPaint({ tune })`, in the debug menu).
 */
const PAINT_DIALS: [string, string, number, number, number, string, string][] = [
  ['radius', 'Radius', 2, 200, 0.5, 'm', 'The disc (C held with the wheel steps it).'],
  ['radiusStep', 'A notch steps it', 1.01, 2, 0.01, '×', 'One notch of the wheel with C held multiplies the radius by this.'],
  ['radiusMin', 'Smallest', 0.5, 50, 0.5, 'm', 'The least the radius steps to.'],
  ['radiusMax', 'Largest', 10, 500, 5, 'm', 'The most the radius steps to.'],
  ['hard', 'Hard core', 0, 1, 0.01, '', 'The share of the radius at full strength before the feather begins.'],
  ['strength', 'Strength', 0, 1, 0.01, '', 'How hard a stamp bites: a family cell takes the paint where its weight passes the line below.'],
  ['cellAt', 'A cell takes it past', 0.01, 1, 0.01, '', 'The weight past which a family cell is painted (a cell is one family or the other).'],
  ['rate', 'Rate', 1, 60, 1, '/s', 'Stamps a second while a button is held (the same paint at any frame rate).'],
  ['colourAmount', 'Colour: how much', 0, 1, 0.01, '', 'How much of the chosen colour a cell tends to.'],
  ['colourRate', 'Colour: how fast', 0.1, 20, 0.1, '/s', 'How fast a held stroke lays it: a held second lays 1 - e^-this of the way.'],
  ['previewMs', 'Preview a frame', 0.25, 16, 0.25, 'ms', "A stroke's preview may spend this much of a frame rewriting the ground it reached."],
];

/** The paint brush's group, its dials set through `set` and read off the paint tune. */
function paintGroup(prefix: string, set: (k: string, v: number) => string[]): DialGroup {
  return {
    title: 'The paint brush',
    note: 'U arms it; LMB held paints the chosen family (or colour), RMB held erases; Shift+click and the middle button pick what is under the aim. Its layer, palette and the world row are on the Tools tab.',
    dials: PAINT_DIALS.map(([k, label, min, max, step, unit, note]) => ({
      kind: 'number' as const,
      key: `tune.${prefix}${k}`,
      label,
      note,
      min,
      max,
      step,
      unit,
      get: () => (PAINT_TUNE as unknown as Record<string, number>)[k],
      set: (v: number) => set(k, v),
    })),
  };
}

/**
 * The colour wash's numbers as the debug menu shows them (a real-elevation world's, when its paint file's world row names
 * one): every number of the wash the owner's, each written into the world row through `groundPaint({ wash })`'s own setter.
 * The paint brush hands the menu its wash and its setter here (`editorPaint.ts`); null, there is no wash to dial.
 */
export const WASH_DIALS: { host: { wash(): { base: number[]; bands?: { above?: number; below?: number; slopeAbove?: number; slopeBelow?: number; colour: number[]; amount: number }[]; noise?: { scale: number; amount: number } } | null; set(partial: Record<string, unknown>): string[] } | null } = { host: null };

/** The wash's groups, or none where no wash is named. */
function washGroups(): DialGroup[] {
  const h = WASH_DIALS.host;
  const w = h?.wash();
  if (!h || !w) return [];
  const num = (key: string, label: string, min: number, max: number, step: number, unit: string, note: string, get: () => number, write: (v: number) => Record<string, unknown>): NumberDial => ({ kind: 'number', key: `wash.${key}`, label, note, min, max, step, unit, get, set: (v) => h.set(write(v)) });
  const base: DialGroup = {
    title: 'The wash',
    note: "A colour map of ours made from the raster (no generator paints one): its base, the slow variation over it, and the bands below. Written into the world row as you move them.",
    dials: [
      num('baseR', 'Base red', 0, 255, 1, '', 'The base colour, red.', () => h.wash()?.base[0] ?? 0, (v) => ({ baseR: v })),
      num('baseG', 'Base green', 0, 255, 1, '', 'The base colour, green.', () => h.wash()?.base[1] ?? 0, (v) => ({ baseG: v })),
      num('baseB', 'Base blue', 0, 255, 1, '', 'The base colour, blue.', () => h.wash()?.base[2] ?? 0, (v) => ({ baseB: v })),
      num('noiseScale', 'Variation size', 1, 5000, 1, 'm', 'Metres a feature of the slow variation.', () => h.wash()?.noise?.scale ?? 200, (v) => ({ noiseScale: v })),
      num('noiseAmount', 'Variation strength', 0, 1, 0.01, '', 'How far it moves each channel, a share of a byte either way.', () => h.wash()?.noise?.amount ?? 0, (v) => ({ noiseAmount: v })),
    ],
  };
  const bands: DialGroup[] = (w.bands ?? []).map((b, i) => ({
    title: `Wash band ${i + 1}`,
    note: 'Laid over the base where its height (metres above sea level) and slope hold, by the client\'s replace-with-amount.',
    dials: [
      num(`band${i}.above`, 'From height', -500, 9000, 5, 'm', 'Heights above sea level it starts at.', () => h.wash()?.bands?.[i]?.above ?? -500, (v) => ({ [`band${i}`]: { above: v } })),
      num(`band${i}.below`, 'To height', -500, 9000, 5, 'm', 'And stops at.', () => h.wash()?.bands?.[i]?.below ?? 9000, (v) => ({ [`band${i}`]: { below: v } })),
      num(`band${i}.slopeAbove`, 'From slope', 0, 90, 1, '°', 'Degrees of slope it starts at.', () => h.wash()?.bands?.[i]?.slopeAbove ?? 0, (v) => ({ [`band${i}`]: { slopeAbove: v } })),
      num(`band${i}.slopeBelow`, 'To slope', 0, 90, 1, '°', 'And stops at.', () => h.wash()?.bands?.[i]?.slopeBelow ?? 90, (v) => ({ [`band${i}`]: { slopeBelow: v } })),
      num(`band${i}.r`, 'Red', 0, 255, 1, '', 'Its colour, red.', () => h.wash()?.bands?.[i]?.colour[0] ?? 0, (v) => ({ [`band${i}`]: { r: v } })),
      num(`band${i}.g`, 'Green', 0, 255, 1, '', 'Its colour, green.', () => h.wash()?.bands?.[i]?.colour[1] ?? 0, (v) => ({ [`band${i}`]: { g: v } })),
      num(`band${i}.b`, 'Blue', 0, 255, 1, '', 'Its colour, blue.', () => h.wash()?.bands?.[i]?.colour[2] ?? 0, (v) => ({ [`band${i}`]: { b: v } })),
      num(`band${i}.amount`, 'How much', 0, 1, 0.01, '', 'How much of its colour it lays.', () => h.wash()?.bands?.[i]?.amount ?? 0, (v) => ({ [`band${i}`]: { amount: v } })),
    ],
  }));
  return [base, ...bands];
}

/** The `groundPaint` helper's own dials (the debug menu's, when `groundPaint` is picked): the brush's numbers of feel, and the wash's where one is named. */
export function paintDialSet(): DialSet {
  const g = [paintGroup('', (k, v) => tunePaint({ [k]: v }, { rewrite: GROUND_REWRITE_TUNE, paint: GROUND_PAINT_TUNE })), ...washGroups()];
  const shipped = readDials(g);
  for (const [k] of shipped) {
    if (!k.startsWith('tune.')) continue;
    const v = (PAINT_TUNE_DEFAULTS as unknown as Record<string, unknown>)[k.slice('tune.'.length)];
    if (typeof v === 'number') shipped.set(k, v);
  }
  return { helper: 'groundPaint', groups: g, shipped };
}

/**
 * The paint brush's plants layer's numbers of feel (Map-maker II's fourth wave, §2.16), as `[key, label, min, max, step,
 * unit, note]`: one list both sets read, the editor's (through `editor({ tune: { floraPaint } })`) and `floraPaint`'s own
 * (through `floraPaint({ tune })`, in the debug menu).
 */
const FLORA_PAINT_DIALS: [string, string, number, number, number, string, string][] = [
  ['radius', 'Radius', 4, 200, 0.5, 'm', 'The disc (C held with the wheel steps it).'],
  ['radiusStep', 'A notch steps it', 1.01, 2, 0.01, '×', 'One notch of the wheel with C held multiplies the radius by this.'],
  ['radiusMin', 'Smallest', 0.5, 50, 0.5, 'm', 'The least the radius steps to.'],
  ['radiusMax', 'Largest', 10, 500, 5, 'm', 'The most the radius steps to.'],
  ['hard', 'Hard core', 0, 1, 0.01, '', 'The share of the radius at full strength before the feather begins.'],
  ['strength', 'Strength', 0, 1, 0.01, '', 'How hard a stamp bites (a share of its weight).'],
  ['amount', 'How much', 0, 1, 0.01, '', "How much of the chosen recipe a cell tends to: the amount the generator's flora takes (a feathered edge, less)."],
  ['thicken', 'How fast it thickens', 0.1, 30, 0.1, '/s', 'How fast a held stroke thickens toward that (or an erasing one thins): a held second goes 1 - e^-this of the way.'],
  ['rate', 'Rate', 1, 60, 1, '/s', 'Stamps a second while a button is held (the same plants at any frame rate).'],
  ['density', 'A new add’s density', 0, 4, 0.01, '', "The density a recipe built on the Tools tab adds its family at (0: the family's own, the world's planting given back)."],
  ['thin', 'A new thin keeps', 0, 1, 0.01, '', 'The share of the plants a recipe built on the Tools tab thins to.'],
];

/** The plants layer's group, its dials set through `set` and read off the flora paint tune. */
function floraPaintGroup(prefix: string, set: (k: string, v: number) => string[]): DialGroup {
  return {
    title: 'The plants layer',
    note: 'U arms the paint brush; the Plants layer on the Tools tab paints the chosen recipe (LMB thickens it, RMB thins it out); its recipes are built there. A recipe already written keeps the density and share it was made with.',
    dials: FLORA_PAINT_DIALS.map(([k, label, min, max, step, unit, note]) => ({
      kind: 'number' as const,
      key: `tune.${prefix}${k}`,
      label,
      note,
      min,
      max,
      step,
      unit,
      get: () => (FLORA_PAINT_TUNE as unknown as Record<string, number>)[k],
      set: (v: number) => set(k, v),
    })),
  };
}

/** The `floraPaint` helper's own dials (the debug menu's, when `floraPaint` is picked): the plants layer's numbers of feel. */
export function floraPaintDialSet(): DialSet {
  const g = [floraPaintGroup('', (k, v) => tuneFloraPaint({ [k]: v }))];
  const shipped = readDials(g);
  for (const [k] of shipped) {
    const v = (FLORA_PAINT_TUNE_DEFAULTS as unknown as Record<string, unknown>)[k.slice('tune.'.length)];
    if (typeof v === 'number') shipped.set(k, v);
  }
  return { helper: 'floraPaint', groups: g, shipped };
}

/**
 * The water tool's numbers of feel (Map-maker II's fifth wave), as `[key, label, min, max, step, unit, note]`: one list both
 * sets read, the editor's (through `editor({ tune: { water } })`) and `lakes`' own (through `lakes({ tune })`).
 */
const WATER_DIALS: [string, string, number, number, number, string, string][] = [
  ['rise', 'A clicked lake stands', -5, 5, 0.05, 'm', "Over the ground its level is taken from (the lowest under its points, or the first's): a lake a little full or a little shy."],
  ['traceRise', 'A trace floods', 0, 20, 0.05, 'm', "Over the ground at its seed: a basin is flooded to the seed's ground and this much more."],
  ['traceStep', 'Trace step', 0.5, 16, 0.5, 'm', 'Metres between the samples a trace floods (the ground’s own 2 m).'],
  ['traceReach', 'Trace reaches', 50, 12000, 50, 'm', 'The farthest a trace floods from its seed before it says the level spills.'],
  ['tolerance', 'Outline within', 0.05, 20, 0.05, 'm', 'How far a traced outline may stand off the shore it walked (doubled until it fits the most points).'],
  ['mostPoints', 'Outline at most', 3, 1024, 1, 'pts', 'The most points a traced outline keeps.'],
  ['closeReach', 'Closes within', 0, 50, 0.5, 'm', 'A click this near an outline’s first point closes it.'],
  ['seaNudge', 'Off the sea by', 0, 1, 0.005, 'm', "A lake this near the sea's own height is raised to it plus this, or it reads as the sea and swells."],
  ['raiseStep', 'A notch raises', 0.01, 5, 0.01, 'm', 'A notch of the wheel with F held raises a picked lake by this.'],
  ['hitPx', 'Ring reach', 3, 40, 1, 'px', "How near the cursor must be to a lake's ring to pick it."],
  ['fallWidth', 'A fall is wide', 0.5, 100, 0.5, 'm', 'How wide a fall is written.'],
  ['fallDepth', 'And deep', 0.05, 5, 0.05, '×', "Its depth as a share of its width's scale."],
  ['fallTurn', 'Turned past its way', -180, 180, 1, '°', 'Degrees a fall is turned past facing from its top toward its bottom.'],
  ['fallAlong', 'Stands toward its foot', 0, 1, 0.05, '', "Where between its ends a fall stands: 0 at the top's place, 1 at the bottom's (a sheet over a slope is inside it)."],
  ['fallMin', 'Least drop', 0, 50, 0.5, 'm', 'A fall is written for a drop of at least this.'],
];

/** The water tool's group, its dials set through `set` and read off the water tune. */
function waterGroup(prefix: string, set: (k: string, v: number) => string[]): DialGroup {
  return {
    title: 'The water tool',
    note: 'Z arms it; its mode (clicks, a trace, a fall) and where a lake’s level comes from are on the Tools tab; a picked lake’s look is on the Selected tab and below.',
    dials: WATER_DIALS.map(([k, label, min, max, step, unit, note]) => ({
      kind: 'number' as const,
      key: `tune.${prefix}${k}`,
      label,
      note,
      min,
      max,
      step,
      unit,
      get: () => (WATER_TUNE as unknown as Record<string, number>)[k],
      set: (v: number) => set(k, v),
    })),
  };
}

/**
 * The picked lake's look as sliders (the `lakes` set's last group): its opacity, ripple and drift in force, each written into
 * the water file a moment after the slider rests (one write, one undo). The editor hands its picked lake's look and the
 * setter here; null, or nothing picked, and there is no group.
 */
export const LAKE_LOOK_DIALS: { host: { look(): { id: string; opacity: number; ripple: number; drift: number } | null; set(partial: Record<string, number>): string[] } | null } = { host: null };

function lakeLookGroups(): DialGroup[] {
  const h = LAKE_LOOK_DIALS.host;
  const now = h?.look();
  if (!h || !now) return [];
  const num = (k: 'opacity' | 'ripple' | 'drift', label: string, max: number, note: string): NumberDial => ({ kind: 'number', key: `look.${k}`, label, note, min: 0, max, step: 0.01, unit: '', get: () => h.look()?.[k] ?? 0, set: (v) => h.set({ [k]: v }) });
  return [
    {
      title: `The picked lake: ${now.id}`,
      note: "Its look over its shader's (or the planet's) own, written into the water file as a slider rests. Its colour is the Selected tab's.",
      dials: [num('opacity', 'Opacity', 1, 'How much of the bed it hides.'), num('ripple', 'Ripple', 8, "How steep the fine ripples' slopes are, over its shader's."), num('drift', 'Drift', 8, 'How fast the fine ripples drift, over its shader’s.')],
    },
  ];
}

/**
 * The `lakes` helper's own dials (the debug menu's, when `lakes` is picked): the water tool's numbers of feel, the water a
 * plant is taken under (`LAKE_TUNE.floraUnder`, the world's own), and the picked lake's look where one is picked.
 */
export function lakesDialSet(): DialSet {
  const under: DialGroup = {
    title: 'What the lakes take',
    dials: [
      {
        kind: 'number',
        key: 'tune.floraUnder',
        label: 'Plants taken under',
        note: 'A planting stands no more under a lake of ours than this much water over the ground (the grass asks the water itself). From the next replant.',
        min: 0,
        max: 5,
        step: 0.05,
        unit: 'm',
        get: () => LAKE_TUNE.floraUnder,
        set: (v) => {
          LAKE_TUNE.floraUnder = Math.max(0, v);
          return [];
        },
      },
    ],
  };
  const lakeDefaults = LAKE_TUNE_SHIPPED;
  const g = [waterGroup('', (k, v) => tuneWater({ [k]: v })), under, ...lakeLookGroups()];
  const shipped = readDials(g);
  for (const [k] of shipped) {
    if (k === 'tune.floraUnder') shipped.set(k, lakeDefaults.floraUnder);
    else if (k.startsWith('tune.')) {
      const v = (WATER_TUNE_DEFAULTS as unknown as Record<string, unknown>)[k.slice('tune.'.length)];
      if (typeof v === 'number') shipped.set(k, v);
    }
  }
  return { helper: 'lakes', groups: g, shipped };
}

/**
 * The `rivers` helper's own dials (Map-maker II's sixth wave; the debug menu's, when `rivers` is picked): the width, velocity
 * and rise of a river being drawn (the water tool's), and the rivers' own numbers of feel (`RIVER_TUNE`: the slope past which
 * a reach is a fall, the detail's flow, and the fall effects' spacing, drop and most), each set through `rivers({ tune })`'s
 * own setter, so a moved slope limit makes every river again and the line the menu copies keeps it.
 */
export function riversDialSet(): DialSet {
  const tool: DialGroup = {
    title: 'A river drawn',
    note: 'Z arms the water tool; its river mode is on the Tools tab. A picked river’s own width and velocity are the Selected tab’s.',
    dials: (
      [
        ['riverWidth', 'Width', 0.5, 200, 0.5, 'm', 'How wide a river is written.'],
        ['riverVelocity', 'Velocity', 0, 20, 0.05, 'm/s', 'How fast it runs from its first point to its last (its detail drifts at it, the moving air’s liquid pulls toward it).'],
        ['riverRise', 'Over its ground', -5, 10, 0.05, 'm', 'Each point’s surface over the ground clicked (the bed is the sculpt brush’s).'],
      ] as const
    ).map(([k, label, min, max, step, unit, note]) => ({
      kind: 'number' as const,
      key: `tune.${k}`,
      label,
      note,
      min,
      max,
      step,
      unit,
      get: () => (WATER_TUNE as unknown as Record<string, number>)[k],
      set: (v: number) => tuneWater({ [k]: v }),
    })),
  };
  const own: DialGroup = {
    title: 'What a river does',
    note: 'Every river on the world, the terrain’s own and ours. A moved slope limit or effect number makes every river again (no program is built).',
    dials: (
      [
        ['slopeMax', 'A fall past', 0, 60, 0.5, '°', 'A reach between two points steeper than this is a fall: its effects stand there (or it is no water, by Steep on the Tools tab). A river’s own limit wins.'],
        ['flow', 'Detail flows at', 0, 4, 0.05, '×', 'Every river’s velocity times this, as its detail drifts downstream.'],
        ['effectEvery', 'Bank sprays every', 1, 100, 0.5, 'm', 'Along a steep reach, a spray at each bank this far apart.'],
        ['bigDrop', 'Big fall from', 0, 200, 1, 'm', 'A steep reach dropping this much stands the 200 m fall’s spray and mist at its foot.'],
        ['effectsMost', 'Effects at most', 0, 200, 1, '', 'The most fall effects one river stands.'],
        ['effectScale', 'Effects scaled', 0.1, 4, 0.05, '×', 'Every fall effect’s placement times this, over what its drop gives it (how wide its particles start and how fast they leave).'],
        ['smallRef', 'Small fall made for', 1, 100, 0.5, 'm', 'The drop the small fall’s spray and mist are drawn at their own scale for: a reach dropping twice this stands them at twice it.'],
        ['bigRef', 'Big fall made for', 10, 500, 5, 'm', 'The drop the 200 m fall’s spray and mist are drawn at their own scale for.'],
        ['scaleLeast', 'Scale at least', 0.05, 2, 0.05, '×', 'No fall effect stands smaller than this, however short its drop.'],
        ['scaleMost', 'Scale at most', 0.5, 10, 0.1, '×', 'No fall effect stands larger than this, however long its drop.'],
      ] as const
    ).map(([k, label, min, max, step, unit, note]) => ({
      kind: 'number' as const,
      key: `tune.${k}`,
      label,
      note,
      min,
      max,
      step,
      unit,
      get: () => (RIVER_TUNE as unknown as Record<string, number>)[k],
      set: (v: number) => (RIVER_DIALS.host ? RIVER_DIALS.host.tune({ [k]: v }) : tuneRiverTune({ [k]: v }, () => {})),
    })),
  };
  const g = [tool, own];
  const shipped = readDials(g);
  for (const [k] of shipped) {
    const key = k.slice('tune.'.length);
    const v = key in RIVER_TUNE_SHIPPED ? (RIVER_TUNE_SHIPPED as unknown as Record<string, unknown>)[key] : (WATER_TUNE_DEFAULTS as unknown as Record<string, unknown>)[key];
    if (typeof v === 'number') shipped.set(k, v);
  }
  return { helper: 'rivers', groups: g, shipped };
}

/** Who makes the rivers again when a dial moves one (the editor hands its own `rivers({ tune })` here); none, the tune alone moves. */
export const RIVER_DIALS: { host: { tune(partial: Record<string, number>): string[] } | null } = { host: null };

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

/**
 * A number of a tune of the world's own the editor registered (`EDITOR_EXTRA_TUNES`: the seventh wave's `look` and
 * `attach`), as a slider: read off the very object the world reads, moved through `tuneEditor`, its shipped value the one it
 * had when registered.
 */
function extraDial(name: string, key: string, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  return {
    kind: 'number',
    key: `extra.${name}.${key}`,
    label,
    note,
    min,
    max,
    step,
    unit,
    get: () => Number(EDITOR_EXTRA_TUNES[name]?.[key] ?? 0),
    set: (v) => tuneEditor({ [name]: { [key]: v } }),
  };
}

/** The looks' and attachments' numbers of feel (Map-maker II's seventh wave), once the editor has registered them. */
function looksGroup(): DialGroup[] {
  if (!EDITOR_EXTRA_TUNES.look || !EDITOR_EXTRA_TUNES.attach) return [];
  return [
    {
      title: 'Looks and attachments',
      note: "A row's tints, borrowed pictures and materials, and the effects and sounds hung on it (the Selected tab, and the library's Effects and Sounds).",
      dials: [
        extraDial('look', 'tintStrength', 'Tint strength', 0, 1, 0.01, '', 'How much of a tint a copy takes: 1 multiplies the colour by the tint as written, 0 leaves the model\'s own. Moves every tinted copy at once; nothing compiles.'),
        extraDial('attach', 'size', 'A new effect\'s size', 0.05, 10, 0.05, '×', 'The size an effect taken from the library is hung at, of its own.'),
        extraDial('attach', 'lift', 'Hung over the hit', -2, 5, 0.05, 'm', 'Metres over the point the aim met that a new effect or sound is hung (and a mark stands).'),
        extraDial('attach', 'preview', 'Shown in hand at', 0, 5, 0.05, '×', 'The effect in hand shown at the aim at this size of its own; 0 shows none.'),
        extraDial('attach', 'handlePx', 'Handle size', 2, 20, 0.5, 'px', 'Half the size of an attachment\'s handle on the screen.'),
        extraDial('attach', 'pickPx', 'Handle reach', 3, 40, 1, 'px', 'How near the cursor must be to a handle to pick it.'),
        extraDial('attach', 'turnPerPx', 'Turn a pixel', 0.001, 0.05, 0.001, 'rad', 'R held on a picked attachment: how far a pixel of the mouse turns it.'),
        extraDial('attach', 'liftPerPx', 'Raise a pixel', 0.001, 0.1, 0.001, 'm', 'F held: how far a pixel of the mouse raises it.'),
        extraDial('attach', 'sizePerPx', 'Size a pixel', 0.001, 0.05, 0.001, '', 'C held: the size multiplied by exp(this × pixels), mouse up larger.'),
        extraDial('attach', 'reach', 'Effects stood within', 50, 2000, 10, 'm', 'How far from the eye a row\'s effects are stood (taken away a little past it).'),
      ],
    },
  ];
}

/** The zone tool's and a placed person's numbers of feel (Map-maker II's twelfth wave), once the editor has registered them. */
function removalsGroups(): DialGroup[] {
  if (!EDITOR_EXTRA_TUNES.zone || !EDITOR_EXTRA_TUNES.person) return [];
  return [
    {
      title: 'The no-spawn zone tool',
      note: 'Armed from the Tools tab (no key of its own): a click draws a circle, a drag a rectangle, clicks an outline; what a zone keeps away (wild, people, ours) is on the Tools tab.',
      dials: [
        extraDial('zone', 'radius', 'A new circle', 1, 2000, 1, 'm', "The radius a click draws a zone's circle at (C held with the wheel steps it): about a lair's camp and its herd."),
        extraDial('zone', 'sizeStep', 'A notch steps it', 1.01, 4, 0.01, '×', 'One notch of C with the wheel grows (or shrinks) the next circle by this.'),
        extraDial('zone', 'sizeRest', 'Size written after', 0, 5, 0.05, 's', "Seconds after the last notch before a picked zone's new size is written."),
        extraDial('zone', 'rectLeast', 'A drag at least', 0.1, 50, 0.1, 'm', "A rectangle's least side: a drag shorter than this one way is a slip and writes nothing."),
        extraDial('zone', 'closePx', 'Close within', 2, 60, 1, 'px', "A click this near an outline's first point, on the screen, closes it."),
        extraDial('zone', 'hitPx', 'Handle reach', 2, 40, 1, 'px', "How near the cursor must be to a zone's handle to pick it."),
        extraDial('zone', 'circlePoints', 'A circle drawn with', 8, 256, 1, '', 'Points a circle is drawn with on the overlay.'),
      ],
    },
    {
      title: 'A person put down',
      note: "What a person put down from the library's People is written with (Selected changes one already there).",
      dials: [
        extraDial('person', 'still', 'Stands still', 0, 1, 1, '', '1: stands at the spot, its brain off, as a town\'s people do; 0: walks about its post.'),
        extraDial('person', 'peaceful', 'Peaceful', 0, 1, 1, '', '1: may not be fought, part of the furniture; 0: its creature\'s own temper.'),
        extraDial('person', 'respawn', 'Back after', 0, 3600, 5, 's', 'Seconds a killed one stays down; 0 stays down until the world is left.'),
        extraDial('person', 'roam', 'Steps about', 0, 30, 0.5, 'm', 'How far round its spot it steps about (with Stands still at 0).'),
      ],
    },
  ];
}

/** The lights tool's numbers of feel (Map-maker II's wave of the rooms' lights), once the editor has registered them. */
function lightsGroups(): DialGroup[] {
  if (!EDITOR_EXTRA_TUNES.lightsTool) return [];
  return [
    {
      title: 'The lights tool',
      note: "; arms it: a click picks a light, a preset (Tools tab, the library's Lights) is put down by the next click. The pool's own numbers (how bright a lamp, the ambient, the flicker, the shadows) are the debug menu's `roomLights`.",
      dials: [
        extraDial('lightsTool', 'markerPx', 'Marker size', 3, 30, 0.5, 'px', "Half the size of a light's marker on the screen."),
        extraDial('lightsTool', 'pickPx', 'Marker reach', 3, 40, 1, 'px', 'How near the cursor must be to a marker to pick it.'),
        extraDial('lightsTool', 'near', 'Shown within', 10, 1000, 5, 'm', 'How far from the eye an outdoor light, or one hung on a row, is marked.'),
        extraDial('lightsTool', 'gizmoPx', 'Gizmo size', 30, 240, 5, 'px', "How far a picked light's handles reach out on the screen."),
        extraDial('lightsTool', 'hitPx', 'Handle reach', 3, 30, 1, 'px', 'How near the cursor must be to a handle to grab it.'),
        extraDial('lightsTool', 'dupStep', 'Duplicate beside by', 0, 10, 0.25, 'm', "How far to the camera's right Ctrl+D puts a light's copy (0: the grid step)."),
        extraDial('lightsTool', 'lift', 'Put down over the hit', 0, 3, 0.05, 'm', 'Metres over where the aim met the world that a light put down stands.'),
      ],
    },
  ];
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
    paintGroup('paint.', (k, v) => tuneEditor({ paint: { [k]: v } })),
    floraPaintGroup('floraPaint.', (k, v) => tuneEditor({ floraPaint: { [k]: v } })),
    waterGroup('water.', (k, v) => tuneEditor({ water: { [k]: v } })),
    ...looksGroup(),
    ...removalsGroups(),
    ...lightsGroups(),
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
  if (key.startsWith('extra.')) {
    const [, name, k] = key.split('.');
    const v = EDITOR_EXTRA_DEFAULTS[name]?.[k];
    return typeof v === 'number' ? v : now;
  }
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

/**
 * The places tool's numbers of feel (Map-maker II's eighth wave), as `[key, label, min, max, step, unit, note]`: each a
 * slider in the debug menu's `locations` set (handed in through `LOCATION_DIALS.tool` as the editor loads), set through
 * `__debug.locations({ tool })`'s own setter (`tunePlacesTool`), so the line the menu copies out is that helper's.
 */
const PLACES_DIALS: [string, string, number, number, number, string, string][] = [
  ['radius', 'A new circle', 0.5, 5000, 0.5, 'm', "The radius a click draws a circle at (C held with the wheel steps it): a small town's."],
  ['sizeStep', 'A notch steps it', 1.01, 4, 0.01, '×', 'One notch of C with the wheel grows (or shrinks) the next circle, or a picked place, by this.'],
  ['sizeRest', 'Size written after', 0, 5, 0.05, 's', "Seconds after the last notch before a picked place's new size is written."],
  ['rectLeast', 'A drag at least', 0.1, 50, 0.1, 'm', "A rectangle's least side: a drag shorter than this one way is a slip and writes nothing."],
  ['closePx', 'Close within', 2, 60, 1, 'px', "A click this near an outline's first point, on the screen, closes it."],
  ['hitPx', 'Handle reach', 2, 40, 1, 'px', "How near the cursor must be to a place's handle to pick it."],
  ['circlePoints', 'A circle drawn with', 8, 256, 1, '', 'Points a circle is drawn with on the overlay.'],
];

/** The places tool's dials and their shipped values (its own defaults), for the `locations` set. */
export function placesToolDials(): { groups(): DialGroup[]; shipped: ReadonlyMap<string, number | string> } {
  const groups = (): DialGroup[] => [
    {
      title: 'The places tool (the world editor)',
      note: 'P arms it: a click draws a circle, a drag a rectangle, clicks an outline. Its mode and kind are on the Tools tab too.',
      dials: [
        {
          kind: 'choice',
          key: 'tool.mode',
          label: 'A click draws',
          note: 'A circle at the aim, a rectangle by a drag, or an outline by clicks.',
          choices: PLACES_TOOL_CHOICES.mode,
          get: () => PLACES_TOOL_TUNE.mode,
          set: (v) => tunePlacesTool({ mode: v }),
        },
        {
          kind: 'choice',
          key: 'tool.kind',
          label: 'Written as',
          note: "The kind a new place is written as (a city's name is said walking in and its outline is on the minimap; a zone is drawn on no map).",
          choices: PLACES_TOOL_CHOICES.kind,
          get: () => PLACES_TOOL_TUNE.kind,
          set: (v) => tunePlacesTool({ kind: v }),
        },
        ...PLACES_DIALS.map(([k, label, min, max, step, unit, note]): NumberDial => ({
          kind: 'number',
          key: `tool.${k}`,
          label,
          note,
          min,
          max,
          step,
          unit,
          get: () => (PLACES_TOOL_TUNE as unknown as Record<string, number>)[k],
          set: (v) => {
            const said = tunePlacesTool({ [k]: v });
            const now = (PLACES_TOOL_TUNE as unknown as Record<string, number>)[k];
            return now === v ? said : [...said, `held at ${now}`];
          },
        })),
      ],
    },
  ];
  const shipped = new Map<string, number | string>();
  for (const g of groups()) for (const d of g.dials) {
    const v = (PLACES_TOOL_TUNE_DEFAULTS as unknown as Record<string, number | string>)[d.key.slice('tool.'.length)];
    if (typeof v === 'number' || typeof v === 'string') shipped.set(d.key, v);
  }
  return { groups, shipped };
}

/** The debug menu's dials for `editor`, or null for another helper. */
export function editorDialsFor(helper: string): DialSet | null {
  return helper === 'editor' ? editorDialSet() : helper === 'sculpt' ? sculptDialSet() : helper === 'groundPaint' ? paintDialSet() : helper === 'floraPaint' ? floraPaintDialSet() : helper === 'lakes' ? lakesDialSet() : helper === 'rivers' ? riversDialSet() : helper === 'ownLooks' ? ownLooksDialSet() : null;
}

/** The dresser's numbers as they shipped: what a reset puts back. */
const DRESSER_SHIPPED = { ...DRESSER_TUNE };

/**
 * The `ownLooks` helper's own dials (Map-maker II's thirteenth wave; the debug menu's, when `ownLooks` is picked): the
 * dresser's doll's framing, light and size and how many entries a find offers, each set through `ownLooks({ tune })`'s own
 * setter, so the doll is framed and lit again at once and the line the menu copies keeps it.
 */
export function ownLooksDialSet(): DialSet {
  const doll: DialGroup = {
    title: 'The dresser’s doll',
    note: 'The Looks tab’s figure, in a preview of its own: a moved framing takes effect as the doll is framed again (now, and at every figure).',
    dials: (
      [
        ['yaw', 'Turned', -3.14, 3.14, 0.01, 'rad', 'How far round from the front the doll is framed: a little round reads a coat’s depth and a sleeve.'],
        ['pitch', 'Tilted', -0.5, 0.7, 0.01, 'rad', 'How far from above it is looked on.'],
        ['light', 'Light', 0, 4, 0.05, '×', 'Its three lights and its sky at this share of their own strength.'],
        ['dollHeight', 'Height on the tab', 120, 900, 10, 'px', 'How tall the doll stands on the Looks tab.'],
        ['startHits', 'Start from offers', 1, 60, 1, '', 'How many dressed people a Start from find offers.'],
      ] as const
    ).map(([k, label, min, max, step, unit, note]) => ({
      kind: 'number' as const,
      key: `tune.${k}`,
      label,
      note,
      min,
      max,
      step,
      unit,
      get: () => DRESSER_TUNE[k],
      set: (v: number) => {
        const said = tuneDresser({ [k]: v });
        DRESSER_RETUNE.moved?.();
        return said.length ? [] : [`${label} held where it was`];
      },
    })),
  };
  const groups = [doll];
  const shipped = readDials(groups);
  for (const [k] of shipped) {
    const v = (DRESSER_SHIPPED as unknown as Record<string, unknown>)[k.slice('tune.'.length)];
    if (typeof v === 'number') shipped.set(k, v);
  }
  return { helper: 'ownLooks', groups, shipped };
}

/** What a dial's move tells the dresser (its doll framed and lit again): set by the editor once the dresser is made. */
export const DRESSER_RETUNE: { moved: (() => void) | null } = { moved: null };
