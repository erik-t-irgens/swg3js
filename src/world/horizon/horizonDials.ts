// The far ground's numbers of look and feel as the debug menu's sliders, when `horizon` is picked (the horizon pass): the
// reach, the fog's cap, the morph, the drop, the near band's grain and the horizon fade. Each is set through
// `tuneHorizon`, exactly as `__debug.horizon({ tune })` sets it, so a slider and a typed line never mean two things.
//
// Pure: the tune table and the dials' shapes, nothing of the page.
import type { DialGroup, DialSet, NumberDial, ChoiceDial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';
import { HORIZON_TUNE, HORIZON_VIEWS } from './horizonMath.ts';

const CHOICES: Record<string, readonly string[]> = {
  ground: ['tiles', 'both', 'rings'],
  drawn: ['rings', 'tiles'],
  dropAt: ['seam', 'everywhere'],
  detail: ['tile', 'off'],
  fadeTo: ['sky', 'fog', 'none'],
  view: HORIZON_VIEWS,
};

/** The reach the console and the slider may set, metres (the console's own bounds since the first wave). */
export const REACH_RANGE = [500, 32000] as const;

/** The numbers the measurement's far plane and sky radius are worked out from: a move of one is told to `HORIZON_WATCH`. */
const MEASURED = new Set(['reach', 'skyMargin', 'farMargin', 'measure']);

/**
 * Told whenever `tuneHorizon` moves a number the measurement's far plane and sky follow (`main.ts` hangs its
 * `applyHorizonMeasure` here), so a slider and a typed line move the far plane alike.
 */
export const HORIZON_WATCH: { moved: (() => void) | null } = { moved: null };

/**
 * Any `HORIZON_TUNE` value set by name (a number held finite and positive where it must be, the reach inside
 * `REACH_RANGE`, a switch, a choice among its own words); answers what it would not take. `ground` is the console's to
 * move (`__debug.horizon({ ground })`, which loads the bake behind a curtain): set here it says so and is left.
 */
export function tuneHorizon(o: Record<string, unknown>): string[] {
  const t = HORIZON_TUNE as unknown as Record<string, unknown>;
  const said: string[] = [];
  let measured = false;
  for (const [k, v] of Object.entries(o)) {
    if (!(k in t)) {
      said.push(`horizon has no ${k}`);
      continue;
    }
    if (k === 'ground') {
      said.push("ground is moved by __debug.horizon({ ground }), which loads the bake behind a curtain");
      continue;
    }
    const was = t[k];
    if (typeof was === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) said.push(`${k} takes a number`);
      else if (k === 'reach') t[k] = Math.min(REACH_RANGE[1], Math.max(REACH_RANGE[0], v));
      // Whole far tiles, at least one each way (the far cards' and the race's far grids).
      else if (k === 'farGridRadius') t[k] = Math.max(1, Math.round(v));
      else t[k] = k === 'renderOrder' ? Math.round(v) : Math.max(k === 'drop' ? 0 : 1e-4, v);
    } else if (typeof was === 'boolean') {
      if (v === 'on' || v === 'off') t[k] = v === 'on';
      else if (typeof v !== 'boolean') said.push(`${k} takes true or false`);
      else t[k] = v;
    } else if (CHOICES[k]) {
      if (!CHOICES[k].includes(v as string)) said.push(`${k} takes ${CHOICES[k].join(', ')}`);
      else t[k] = v;
    }
    if (MEASURED.has(k) && t[k] !== was) measured = true;
  }
  if (HORIZON_TUNE.morph >= 1) HORIZON_TUNE.morph = 0.99;
  if (measured) HORIZON_WATCH.moved?.();
  return said;
}

function num(k: keyof typeof HORIZON_TUNE, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  const t = HORIZON_TUNE as unknown as Record<string, number>;
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => t[k], set: (v) => tuneHorizon({ [k]: v }) };
}
function choice(k: keyof typeof HORIZON_TUNE, label: string, note: string): ChoiceDial {
  const t = HORIZON_TUNE as unknown as Record<string, string | boolean>;
  const words = typeof t[k] === 'boolean' ? ['on', 'off'] : CHOICES[k];
  return {
    kind: 'choice',
    key: `tune.${k}`,
    label,
    note,
    choices: [...words],
    get: () => (typeof t[k] === 'boolean' ? (t[k] ? 'on' : 'off') : (t[k] as string)),
    set: (v) => tuneHorizon({ [k]: v }),
  } as ChoiceDial;
}

const HORIZON_GROUPS: DialGroup[] = [
  {
    title: 'How far',
    note: "The reach of the rings, and where the planet's fog takes it over (the reach in force). The ground switch is the console's.",
    dials: [
      num('reach', 'Reach', 1000, 16000, 100, 'm', 'How far the rings go (the Graphics page\'s Terrain distance from a later wave).'),
      choice('fogCap', 'Stop where the fog hides it', 'The rings stop where the fog leaves less than one level in 255 of the ground.'),
      num('lod0', 'Level 0 range', 400, 4000, 50, 'm', "The finest level's range, before the floor the standing chunks set."),
      num('morph', 'Morph share', 0.05, 0.6, 0.01, '', 'The outer share of each range, and of each edge band, a vertex morphs over.'),
      num('edgeBand', 'Edge band', 16, 256, 8, 'm', "The first band of the edge's level: the rings' finest lattice at the hole's edge, doubling outward."),
    ],
  },
  {
    title: 'At the seam',
    dials: [
      num('drop', 'Drop', 0, 10, 0.1, 'm', 'How far under the bake the rings stand at the hole\'s edge, so the chunks win where both stand.'),
      num('dropFade', 'Drop fades over', 16, 2000, 8, 'm', 'Over how much of the distance from the hole the drop fades to nought.'),
      num('ringSkirt', 'Skirt', 0, 64, 1, 'm', "How far a leaf's skirt hangs toward the hole."),
    ],
  },
  {
    title: 'The look',
    dials: [
      choice('detail', 'Near grain', "The tile's own picture's grain and bump from the hole to the detail's reach."),
      num('detailReach', 'Grain reach', 0, 3000, 50, 'm', 'Where the near grain starts to fade.'),
      num('detailFade', 'Grain fade', 0, 1000, 25, 'm', 'Over how far it fades out.'),
      choice('fadeTo', 'Horizon fades to', "The last stretch of the reach dissolves into the sky's colour behind it, the fog's, or nothing."),
      num('fade', 'Horizon fade share', 0, 0.5, 0.01, '', 'The share of the reach in force the fade runs over.'),
      num('fogCheap', 'Fog cheap path', 0.9, 1, 0.001, '', 'Past this fog factor a fragment is the fog\'s colour with no taps.'),
      choice('view', 'View', 'What the program draws (the lit ground, or a part of it).'),
    ],
  },
];

/** The far ground's dials, with the values the game shipped. */
export const HORIZON_DIALS: DialSet = { helper: 'horizon', groups: HORIZON_GROUPS, shipped: readDials(HORIZON_GROUPS) };

export function horizonDialsFor(helper: string): DialSet | null {
  return helper === 'horizon' ? HORIZON_DIALS : null;
}
