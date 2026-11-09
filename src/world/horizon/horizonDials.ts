// The far ground's numbers of look and feel as the debug menu's sliders, when `horizon` is picked (the horizon pass): the
// reach, the fog's cap, the morph, the drop, the near band's grain and the horizon fade. Each is set through
// `tuneHorizon`, exactly as `__debug.horizon({ tune })` sets it, so a slider and a typed line never mean two things.
//
// Pure: the tune table and the dials' shapes, nothing of the page.
import type { DialGroup, DialSet, NumberDial, ChoiceDial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';
import { HORIZON_TUNE, HORIZON_VIEWS, shapeReachMost } from './horizonMath.ts';
import { GROUND_DETAIL_TUNE, groundTileUniforms, tuneGroundDetail, writeGroundDetail } from '../terrainTextures.ts';

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
/**
 * The furthest the 2 m shape may hold (wave 3b's review), at the shipped fade, morph and gap: the 4 m range it asks, a
 * morph step and all, inside the shape window's whole share in its worst axis (`shapeReachMost`, 703 m, to the dial's
 * 25 m steps: 700). Past it the finer levels would stand on the bake's 8 m; `shapeRanges` holds them inside whatever the
 * tune says. The Graphics page's Terrain shape detail stops here too (`menu.ts`, held to it by `horizonShape.test.ts`).
 */
export const SHAPE_REACH_MOST = Math.floor(shapeReachMost(HORIZON_TUNE) / 25) * 25;

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
      // Wave 3b: nought is the rings' shape of before; the finest is the near ground's 2 m or 4 m.
      else if (k === 'shapeReach') {
        t[k] = Math.min(SHAPE_REACH_MOST, Math.max(0, v));
        if (v > SHAPE_REACH_MOST) said.push(`shapeReach held at ${SHAPE_REACH_MOST} m: the shape window round the eye holds its 2 m heights no further`);
      } else if (k === 'shapeFinest') t[k] = v <= 3 ? 2 : 4;
      // W4: never under nought (a negative share would lay nothing; mips every frame at nought).
      else if (k === 'mipsEvery' || k === 'liveMs') t[k] = Math.max(0, v);
      // The morph share the ranges are placed with and the ring morphs by, one number for both (`shapeRanges`' own hold).
      else if (k === 'shapeMorph') t[k] = Math.min(0.9, Math.max(0.01, v));
      // The program divides by the fade: never under one sample.
      else if (k === 'shapeFade') t[k] = Math.max(1, v);
      else if (k === 'shapePad') t[k] = Math.max(0, v);
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
      choice('detail', 'Near ground\'s own look', "Inside the ground detail distance the rings draw the near ground's own composition (its pictures, alternates, masks, tint, bump and gloss); off, the bake's per-tile mean everywhere."),
      num('detailReach', 'Ground detail distance', 0, 6000, 50, 'm', "Where the near ground's own look is gone (the Graphics page's Ground detail distance, which a reload puts back). The window it reads is made again at a new size when this moves."),
      num('detailFadeShare', 'Its fade', 0, 1, 0.05, '', "The share of the distance it fades over into the bake's per-tile mean, so no line shows where it ends."),
      choice('fadeTo', 'Horizon fades to', "The last stretch of the reach dissolves into the sky's colour behind it, the fog's, or nothing."),
      num('fade', 'Horizon fade share', 0, 0.5, 0.01, '', 'The share of the reach in force the fade runs over.'),
      num('fogCheap', 'Fog cheap path', 0.9, 1, 0.001, '', 'Past this fog factor a fragment is the fog\'s colour with no taps.'),
      choice('view', 'View', 'What the program draws (the lit ground, or a part of it).'),
    ],
  },
  {
    title: 'The shape up close',
    note: "Wave 3b: finer levels than the bake's 8 m just past the detailed ground, standing on the near ground's own 2 m heights round the eye, so the shape does not change where the detailed ground ends.",
    dials: [
      choice('shape', 'Finer levels', "On, the rings take the near ground's 2 m (and 4 m) shape out to the Terrain shape detail; off, the rings' shape of before."),
      num('shapeReach', 'Terrain shape detail', 0, SHAPE_REACH_MOST, 25, 'm', "How far the finest holds before it gives way to 4 m, then 8 m (the Graphics page's Terrain shape detail, which a reload puts back). Nought is off."),
      num('shapeFinest', 'Finest spacing', 2, 4, 2, 'm', "The finest ring level's spacing: the near ground's own 2 m, or 4 m (half the triangles)."),
      num('shapePad', 'Box growth', 0, 40, 1, 'm', "How far a node's box is grown up and down for the frustum, for 2 m crests that stand off the bake's samples."),
      num('shapeFade', 'Window edge fade', 1, 64, 1, 'samples', "Over how many 2 m samples the shape window's heights fade into the bake's at the window's edge."),
    ],
  },
];

// ---------------------------------------------------------------- the ground up close (wave 3b), under `ground`

const GROUND_GROUPS: DialGroup[] = [
  {
    title: 'Steep faces',
    note: "On faces steeper than From the ground's pictures are also laid from the two side axes, wholly so past To, so a cliff wears its pictures and not their stretch; flatter ground is drawn exactly as before. The near ground and the rings' near look alike.",
    dials: [
      groundChoice('tri', 'Side pictures on steep faces', 'On, the pictures laid from the sides on steep faces; off, stretched as before (a uniform: nothing is built).'),
      groundNum('tri', 'from', 'From', 0, 89, 1, '°', 'The slope the side pictures begin at.'),
      groundNum('tri', 'to', 'To', 0, 89.9, 1, '°', 'The slope past which the sides take the face whole.'),
      groundNum('tri', 'sharp', 'Sharpness', 0.5, 16, 0.5, '', 'How sharply the two sides share a face that leans both ways.'),
    ],
  },
  {
    title: 'Relief near the eye',
    note: "Within a few metres of the eye the near ground's pictures are moved by the height each carries, in four fixed steps, fading to nothing by the reach. The rings never take it.",
    dials: [
      groundChoice('relief', 'Relief', 'On, the pictures stand up near the eye; off, flat as before (a uniform: nothing is built).'),
      groundNum('relief', 'depth', 'Depth', 0, 0.3, 0.005, 'm', 'How deep the relief is, peak to peak.'),
      groundNum('relief', 'reach', 'Reach', 1, 30, 0.5, 'm', 'How far from the eye it reaches.'),
      groundNum('relief', 'fade', 'Its fade', 0, 1, 0.05, '', 'The share of the reach it fades over.'),
    ],
  },
];

function groundChoice(part: 'tri' | 'relief', label: string, note: string): ChoiceDial {
  return {
    kind: 'choice',
    key: `${part}.on`,
    label,
    note,
    choices: ['on', 'off'],
    get: () => (GROUND_DETAIL_TUNE[part].on ? 'on' : 'off'),
    set: (v) => setGroundDetail({ [part]: v }),
  } as ChoiceDial;
}
function groundNum(part: 'tri' | 'relief', k: string, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  return { kind: 'number', key: `${part}.${k}`, label, note, min, max, step, unit, get: () => (GROUND_DETAIL_TUNE[part] as unknown as Record<string, number>)[k], set: (v) => setGroundDetail({ [part]: { [k]: v } }) };
}
/** The ground's knobs moved as the console moves them, and written into the session's uniforms. */
function setGroundDetail(o: { tri?: unknown; relief?: unknown }): string[] {
  const said = tuneGroundDetail(o);
  writeGroundDetail(groundTileUniforms());
  return said;
}

/** The ground up close's dials, with the values the game shipped. */
export const GROUND_DIALS: DialSet = { helper: 'ground', groups: GROUND_GROUPS, shipped: readDials(GROUND_GROUPS) };

/** The far ground's dials, with the values the game shipped. */
export const HORIZON_DIALS: DialSet = { helper: 'horizon', groups: HORIZON_GROUPS, shipped: readDials(HORIZON_GROUPS) };

export function horizonDialsFor(helper: string): DialSet | null {
  return helper === 'horizon' ? HORIZON_DIALS : helper === 'ground' ? GROUND_DIALS : null;
}
