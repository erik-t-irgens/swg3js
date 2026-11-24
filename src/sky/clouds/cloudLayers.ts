// CONTRACT (pass 3, wave 1): the one agreement between the cloud map (`cloudMap.ts`, `cloudMapGpu.ts`), the march, the shape
// and the light (`cloudMarch.ts`, `cloudShape.ts`, `cloudLight.ts`), the pure twin, and waves 2 to 5 (the shadow map, the flat
// layers, the cards, the viewer's Clouds tab and its save). Its owner is the map's maker; a change to anything below is said in
// that maker's report, and nothing here moves without it.
//
// A world's clouds are a STACK OF LAYERS the owner edits (his word of 24 November: "I'd like to be able to change clouds
// types, or even mix/match cloud types or add a different cloud layer myself on a world to edit its look, which is a little
// more important than realism/physics accuracy"). A layer is one real cloud type, or a mix of up to three laid in patches by a
// noise of its own scale, between a base and a top of its own over the world's ground, with a cover at each weather level.
// A type is a vertical profile and an erosion of the shape function, never a height: a cumulus put at 8 km draws as a cumulus.
// Editing first, physics second: nothing here refuses, moves or "corrects" what he makes (types at unusual heights,
// overlapping layers, several layers of one type). The clamps are for safety only (`CLOUD_CLAMP`).
//
// Pure: no three, no DOM. The GPU face (`CloudMapFace`) is declared here and built in `cloudMapGpu.ts`; the numbers it reads
// are packed here (`packStack`, `packTypes`, `packBands`), so the node tests hold the very layout the card reads.
//
// Every number of look below is a dial with its start and reason (feel is the owner's). No number, colour or shape of SWG's
// clouds is in this file: the types and their profiles are real meteorology's, written from the method.

// ------------------------------------------------------------------------------------------------ the types

/** The eleven real cloud types, in the order their index is read on the card (never reorder: a saved type is its name). */
export const CLOUD_TYPES = [
  'stratus',
  'stratocumulus',
  'cumulus',
  'towering',
  'cumulonimbus',
  'nimbostratus',
  'altostratus',
  'altocumulus',
  'cirrus',
  'cirrocumulus',
  'cirrostratus',
] as const;
export type CloudTypeId = (typeof CLOUD_TYPES)[number];
export const CLOUD_TYPE_COUNT = CLOUD_TYPES.length;

/** Each type's name in words (the debug menu's choices and the report). */
export const CLOUD_TYPE_WORDS: Readonly<Record<CloudTypeId, string>> = {
  stratus: 'Stratus',
  stratocumulus: 'Stratocumulus',
  cumulus: 'Cumulus',
  towering: 'Towering cumulus',
  cumulonimbus: 'Cumulonimbus',
  nimbostratus: 'Nimbostratus',
  altostratus: 'Altostratus',
  altocumulus: 'Altocumulus',
  cirrus: 'Cirrus',
  cirrocumulus: 'Cirrocumulus',
  cirrostratus: 'Cirrostratus',
};

/** A type's index on the card, or -1 for a name that is not a type. */
export function cloudTypeIndex(id: string): number {
  for (let i = 0; i < CLOUD_TYPE_COUNT; i++) if (CLOUD_TYPES[i] === id) return i;
  return -1;
}

/**
 * A type's profile: the slots the shape function reads (its vertical profile and erosion) and the map reads (how cellular it
 * is, how wet), and the starts a new layer of the type takes (heights, cell size). Every slot a dial (`CLOUD_TYPE_TUNE`).
 *
 * The vertical profile over a layer's height share h (0 at its base, 1 at its top) is
 * `smoothstep(0, rise, h) · (1 − smoothstep(fallFrom, fallTo, h))`, widened toward the top by `anvil` (the shape's).
 */
export interface CloudTypeProfile {
  /** h at which the density has risen from the base: small, a flat dark base (cumulus); larger, a soft one (stratiform). */
  rise: number;
  /** h at which it begins to fall toward the top, and h where it is gone: a cumulus's dome, a sheet's flat top. */
  fallFrom: number;
  fallTo: number;
  /** 0 to 1: how far the top spreads out sideways (the cumulonimbus's anvil); 0 for every other type. */
  anvil: number;
  /** 0 to 1: how much of the layer is cells (one cloud each, `cellSize` apart) rather than continuous noise. */
  cells: number;
  /** 0 wispy (cirrus) to 1 billowy (cumulus): which of the shape noise's channels the shape leans on. */
  billow: number;
  /** 0 to 1: how hard the detail noise eats the edges. */
  erosion: number;
  /** 1 round; more, the shape stretched along the layer's wind (cirrus streaks), as a factor on one axis. */
  stretch: number;
  /** 0 to 1: how far a cell narrows toward its top (a cumulus's dome; a tower stands straighter). */
  taper: number;
  /** A factor on the layer's own density: a type's typical optical thickness against a cumulus's. */
  density: number;
  /** 0 to 1: how readily the type rains (the map's wetness channel; passes 5 and 6 read it). */
  wet: number;
  /**
   * A new layer of this type starts here: base and thickness in metres over the world's ground, cell size in metres. The
   * thickness is also the type's column in a mix (the fixer's, pass 3 wave 1): in a layer of several types each type's clouds
   * stand its thickness over the tallest type's share of the layer (`p2.w`, `ShapeProfile.reach`), so a low deck of fair
   * cumulus with storm towers in it keeps its heaps 1.5 km tall while the towers rise through the whole deck; a layer of one
   * type fills its whole thickness, whatever he sets.
   */
  base: number;
  thickness: number;
  cellSize: number;
}

/**
 * The types' profiles, live (a dial moves a row in place, and the next frame packs it). The heights are the typical real
 * heights of each genus over the ground (the meteorological genera's own: low under 2 km, middle 2 to 7 km, high over 6 km),
 * only the starts of a new layer; the shape slots are ours, set so each type reads as itself.
 */
export const CLOUD_TYPE_TUNE: Record<CloudTypeId, CloudTypeProfile> = {
  // A grey even sheet low over the ground: soft base, flat top, no cells, a drizzle at most.
  stratus: { rise: 0.25, fallFrom: 0.55, fallTo: 1, anvil: 0, cells: 0, billow: 0.2, erosion: 0.25, stretch: 1.5, taper: 0, density: 0.7, wet: 0.15, base: 300, thickness: 500, cellSize: 1500 },
  // Lumpy rolls in a deck: half cells, half sheet, flattish tops.
  stratocumulus: { rise: 0.15, fallFrom: 0.5, fallTo: 1, anvil: 0, cells: 0.5, billow: 0.6, erosion: 0.4, stretch: 1.3, taper: 0.25, density: 0.85, wet: 0.1, base: 800, thickness: 700, cellSize: 1200 },
  // Fair-weather heaps: flat dark bases, domed tops, one cloud a cell.
  cumulus: { rise: 0.07, fallFrom: 0.35, fallTo: 1, anvil: 0, cells: 1, billow: 1, erosion: 0.55, stretch: 1, taper: 0.6, density: 1, wet: 0, base: 1000, thickness: 1500, cellSize: 1600 },
  // Cumulus congestus: the same heaps grown tall, standing straighter.
  towering: { rise: 0.05, fallFrom: 0.55, fallTo: 1, anvil: 0, cells: 1, billow: 1, erosion: 0.5, stretch: 1, taper: 0.35, density: 1.15, wet: 0.3, base: 1000, thickness: 4500, cellSize: 2000 },
  // The storm tower: a dark base near the ground, up to the high air, its top spread into an anvil.
  cumulonimbus: { rise: 0.04, fallFrom: 0.8, fallTo: 1, anvil: 1, cells: 1, billow: 0.9, erosion: 0.35, stretch: 1, taper: 0.15, density: 1.6, wet: 1, base: 800, thickness: 9000, cellSize: 2000 },
  // The rain deck: thick, dark, featureless, its base ragged and low.
  nimbostratus: { rise: 0.1, fallFrom: 0.7, fallTo: 1, anvil: 0, cells: 0, billow: 0.3, erosion: 0.2, stretch: 1.2, taper: 0, density: 1.3, wet: 1, base: 600, thickness: 3000, cellSize: 2000 },
  // A grey middle sheet the sun shows through as a smudge.
  altostratus: { rise: 0.3, fallFrom: 0.5, fallTo: 1, anvil: 0, cells: 0, billow: 0.15, erosion: 0.2, stretch: 1.5, taper: 0, density: 0.5, wet: 0.05, base: 3500, thickness: 1500, cellSize: 2000 },
  // Small middle heaps in rows and patches: cells, small and many.
  altocumulus: { rise: 0.15, fallFrom: 0.45, fallTo: 1, anvil: 0, cells: 0.8, billow: 0.75, erosion: 0.5, stretch: 1.4, taper: 0.4, density: 0.6, wet: 0, base: 3500, thickness: 600, cellSize: 700 },
  // High wisps of ice streaked along the wind. The three high types' densities (0.02, 0.04, 0.015) are the march's maker's
  // measure of 24 November: at the look's sigma of 0.06 a metre the first starts (0.25, 0.25, 0.15) drew every cirrus opaque,
  // where a real one's optical depth is about one at most; these give a 1.5 km cirrus a depth near a half.
  cirrus: { rise: 0.35, fallFrom: 0.5, fallTo: 1, anvil: 0, cells: 0, billow: 0, erosion: 0.7, stretch: 4, taper: 0, density: 0.02, wet: 0, base: 8000, thickness: 1500, cellSize: 2000 },
  // High ripples of tiny cells.
  cirrocumulus: { rise: 0.25, fallFrom: 0.5, fallTo: 1, anvil: 0, cells: 0.7, billow: 0.5, erosion: 0.6, stretch: 1.6, taper: 0.3, density: 0.04, wet: 0, base: 7500, thickness: 500, cellSize: 450 },
  // A high milky veil: the sun's halo sheet.
  cirrostratus: { rise: 0.35, fallFrom: 0.55, fallTo: 1, anvil: 0, cells: 0, billow: 0.05, erosion: 0.3, stretch: 2, taper: 0, density: 0.015, wet: 0, base: 8000, thickness: 1000, cellSize: 2000 },
};

// ------------------------------------------------------------------------------------------------ the layer

/** The weather levels a layer's cover is given at (the schedule's 0 clear to 4 stormiest). */
export const CLOUD_LEVELS = 5;

/** A layer of a world's clouds: what the owner edits, saves (`public/sky/clouds.json`, version 1) and sees. */
export interface CloudLayer {
  /** Its name (the debug menu's and the report's, and how a saved layer finds its start). */
  name: string;
  /** Off, it is kept but not drawn (and costs nothing). */
  on: boolean;
  /** One type, or up to three laid in patches by the mix noise (a deck part stratocumulus, part cumulus). */
  types: CloudTypeId[];
  /**
   * Each type's share of the layer's area, as many as `types` (normalised when packed; all equal when missing), the same at
   * every weather level; where `levelShares` is set, each of its rows' mean (what a reader with no level weighs).
   */
  shares: number[];
  /**
   * Each type's share at each weather level 0 to 4, one row of five a type (eased between levels as the cover is), so a deck's
   * rain or storm type grows as the weather worsens (a fair cumulus deck giving way to nimbostratus); null (or absent) when
   * `shares` hold at every level. The console, the copied line and the file write it as `shares` with five numbers in place
   * of one: `shares: [1, [0, 0, 0.3, 0.7, 0.9]]` (the fixer's, pass 3 wave 1, for the owner's realistic decks).
   */
  levelShares?: number[][] | null;
  /** The mix noise's patch size, metres: how large each type's patches are. */
  mixScale: number;
  /** Its base and its thickness, metres over the world's ground (`CloudGround.y`, the median of its ground). */
  base: number;
  thickness: number;
  /** Its cover, 0 to 1, at each weather level 0 to 4 (eased between them as the level moves). */
  cover: number[];
  /** A factor on its types' densities. */
  density: number;
  /** The cells' spacing, metres (one cloud a cell for its cellular types). */
  cellSize: number;
  /** A factor on the one wind aloft, and degrees its drift turns from the wind's heading (winds turn with height). */
  drift: number;
  turn: number;
  /** Cover added at the afternoon's peak and taken at the night's least (a humid world's cumulus building by day). */
  diurnal: number;
  /** 0 hard to 1 soft: how wide the band is where cover meets clear sky. */
  edge: number;
  /** Which arrangement of its noise (an integer; another number, other clouds in the same places' weather). */
  seed: number;
}

/**
 * The safety clamps, and only those (his word: nothing refused, nothing corrected): heights 0 to 20 km, cover 0 to 1, and
 * sizes that keep the map's arithmetic finite. Not dials of look.
 */
export const CLOUD_CLAMP = {
  heightMax: 20000,
  coverMax: 1,
  densityMax: 8,
  /** Cells and patches under a map texel (125 m) would alias, and over 64 km would be the whole near map. */
  sizeMin: 100,
  sizeMax: 64000,
  driftMax: 10,
  diurnalMax: 1,
  seedMax: 0x7fffffff,
} as const;

/**
 * The most layers a world's stack holds. A dial, read once a session at the map's build: it sizes the map's array textures
 * (each layer a 512² and a 256² slice of RGBA8, 1.25 MiB a layer, 7.5 MiB at six) and the uniform arrays, so a change here
 * takes a reload. Six: the starting stacks hold two to four, and six leaves him room to add two and still run the map at
 * about 0.03 ms a layer on the 5080 (the wave's measure is in its report).
 */
export const CLOUD_LAYER_MAX = 6;

/** The most types in one layer's mix. */
export const CLOUD_MIX_MAX = 3;

const clampN = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return n < lo ? lo : n > hi ? hi : n;
};

/** A fresh layer of one type at that type's starts (its cover 0 clear to 0.9 storm, a plain middle). */
export function newCloudLayer(type: CloudTypeId = 'cumulus', name?: string): CloudLayer {
  const t = CLOUD_TYPE_TUNE[type];
  return {
    name: name ?? type,
    on: true,
    types: [type],
    shares: [1],
    levelShares: null,
    mixScale: 6000,
    base: t.base,
    thickness: t.thickness,
    cover: [0.2, 0.35, 0.5, 0.7, 0.9],
    density: 1,
    cellSize: t.cellSize,
    drift: 1,
    turn: 0,
    diurnal: 0,
    edge: 0.5,
    seed: nameSeed(name ?? type),
  };
}

/** A layer's seed from its name (FNV-1a), so a layer keeps its clouds through a reorder. */
export function nameSeed(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

/**
 * A layer from anything (the console, the debug menu, the file), every field clamped for safety and a missing one taken from
 * `from` (a start), else from its first type's starts. Never refuses: an unknown type is dropped and noted in `notes`, a layer
 * left with no type takes `from`'s, else cumulus. Allocates (not a frame's path).
 */
export function cleanLayer(raw: Partial<CloudLayer> | Record<string, unknown>, from: CloudLayer | null, notes?: string[]): CloudLayer {
  const r = raw as Record<string, unknown>;
  const types: CloudTypeId[] = [];
  const rawTypes = r.types ?? (typeof r.type === 'string' ? [r.type] : undefined);
  if (Array.isArray(rawTypes)) {
    for (const t of rawTypes) {
      if (typeof t === 'string' && cloudTypeIndex(t) >= 0) {
        if (types.length < CLOUD_MIX_MAX && !types.includes(t as CloudTypeId)) types.push(t as CloudTypeId);
        else notes?.push(`type ${t} left out (a layer mixes up to ${CLOUD_MIX_MAX} types, each once)`);
      } else notes?.push(`"${String(t)}" is not a cloud type (${CLOUD_TYPES.join(', ')})`);
    }
  }
  const base0 = from ?? newCloudLayer(types[0] ?? 'cumulus', typeof r.name === 'string' ? r.name : undefined);
  if (!types.length) types.push(...base0.types);
  const rawShares = Array.isArray(r.shares) ? (r.shares as unknown[]) : null;
  const shares: number[] = [];
  for (let i = 0; i < types.length; i++) {
    const s = rawShares && i < rawShares.length ? rawShares[i] : types.length === base0.types.length ? base0.shares[i] : 1;
    shares.push(Array.isArray(s) ? meanOf(s) : clampN(s, 0, 1e6, 1));
  }
  // The shares by level: written in `shares` (an entry of five numbers) wins; else a whole `levelShares` of one row a type;
  // else none where plain shares were given or `levelShares` is null; else the start's, where it mixes as many types.
  let levelShares: number[][] | null = null;
  const rawLevels = Array.isArray(r.levelShares) ? (r.levelShares as unknown[]) : null;
  if (rawShares && rawShares.some((s) => Array.isArray(s))) {
    levelShares = types.map((_, i) => shareRow(i < rawShares.length ? rawShares[i] : 1));
  } else if (rawLevels) {
    if (rawLevels.length === types.length) levelShares = types.map((_, i) => shareRow(rawLevels[i]));
    else notes?.push(`levelShares has ${rawLevels.length} rows for ${types.length} types: the shares now hold at every level`);
  } else if (r.levelShares !== null && !rawShares && base0.levelShares && base0.levelShares.length === types.length) {
    levelShares = base0.levelShares.map((row) => [...row]);
  }
  if (levelShares) for (let i = 0; i < types.length; i++) shares[i] = meanOf(levelShares[i]);
  const rawCover = Array.isArray(r.cover) ? (r.cover as unknown[]) : typeof r.cover === 'number' ? [r.cover, r.cover, r.cover, r.cover, r.cover] : null;
  const cover: number[] = [];
  for (let i = 0; i < CLOUD_LEVELS; i++) cover.push(clampN(rawCover && i < rawCover.length ? rawCover[i] : base0.cover[i], 0, CLOUD_CLAMP.coverMax, 0));
  const name = typeof r.name === 'string' && r.name ? r.name : base0.name;
  const C = CLOUD_CLAMP;
  return {
    name,
    on: typeof r.on === 'boolean' ? r.on : base0.on,
    types,
    shares,
    levelShares,
    mixScale: clampN(r.mixScale, C.sizeMin, C.sizeMax, base0.mixScale),
    base: clampN(r.base, 0, C.heightMax, base0.base),
    thickness: clampN(r.thickness, 1, C.heightMax, base0.thickness),
    cover,
    density: clampN(r.density, 0, C.densityMax, base0.density),
    cellSize: clampN(r.cellSize, C.sizeMin, C.sizeMax, base0.cellSize),
    drift: clampN(r.drift, -C.driftMax, C.driftMax, base0.drift),
    turn: clampN(r.turn, -360, 360, base0.turn),
    diurnal: clampN(r.diurnal, -C.diurnalMax, C.diurnalMax, base0.diurnal),
    edge: clampN(r.edge, 0, 1, base0.edge),
    seed: Math.floor(clampN(r.seed, 0, C.seedMax, typeof r.name === 'string' && !from ? nameSeed(name) : base0.seed)),
  };
}

/** A share's row of five (one number for every level, or five; a short list's last carried on), each clamped. */
function shareRow(v: unknown): number[] {
  const row: number[] = [];
  for (let k = 0; k < CLOUD_LEVELS; k++) {
    const x = Array.isArray(v) ? (v.length ? v[k < v.length ? k : v.length - 1] : 1) : v;
    row.push(clampN(x, 0, 1e6, 1));
  }
  return row;
}

/** A list's mean (a row of shares as one number), clamped as a share is. */
function meanOf(v: readonly unknown[]): number {
  if (!v.length) return 1;
  let s = 0;
  for (const x of v) s += clampN(x, 0, 1e6, 1);
  return s / v.length;
}

/** The layer's shares as the console, the copied line and the file write them: a number where a type's share holds at every level, its five numbers where it does not. */
export function sharesWritten(l: CloudLayer): (number | number[])[] {
  return l.types.map((_, i) => {
    const row = l.levelShares?.[i];
    if (!row) return l.shares[i];
    return row.every((v) => v === row[0]) ? row[0] : [...row];
  });
}

/** The layer's type shares at a continuous level (eased between the whole levels either side), into `out`. Not a frame's path. */
export function sharesAtLevel(l: CloudLayer, level: number, out: number[]): number[] {
  const lv = level < 0 ? 0 : level > CLOUD_LEVELS - 1 ? CLOUD_LEVELS - 1 : level;
  const lo = Math.floor(lv);
  const hi = lo + 1 < CLOUD_LEVELS ? lo + 1 : lo;
  out.length = l.types.length;
  for (let i = 0; i < l.types.length; i++) {
    const row = l.levelShares?.[i];
    out[i] = row ? row[lo] + (lv - lo) * (row[hi] - row[lo]) : l.shares[i];
  }
  return out;
}

/** A deep copy of a stack (the console's report and the file's starts hand copies, never the live records). */
export function copyStack(layers: readonly CloudLayer[]): CloudLayer[] {
  return layers.map((l) => ({ ...l, types: [...l.types], shares: [...l.shares], levelShares: l.levelShares ? l.levelShares.map((row) => [...row]) : null, cover: [...l.cover] }));
}

// ------------------------------------------------------------------------------------------------ the card's layout

/**
 * The stack's uniform: `CLOUD_LAYER_VEC4` vec4 a layer, `CLOUD_LAYER_MAX` layers, in stack order (an off layer's slots are
 * written with `count` 0 and nothing reads further). Heights are WORLD y in metres (the ground's median plus the layer's own),
 * so a reader adds nothing; the march works relative to the camera and takes the camera's y itself.
 *
 *  s0 = (baseY, topY, density, edge)       density = the layer's own times nothing: each type's own factor is in its slots
 *  s1 = (type0, type1, type2, count)       type indices as floats (`CLOUD_TYPES` order); count 0 off, else 1 to 3; count 0
 *                                          too while its cover now is nought and no place forces its weather (the fixer's: the
 *                                          map skips the slot and leaves it unwritten, and nothing reads a slot of count 0)
 *  s2 = (cut0, cut1, mixSoft, cover)       the mix value's cuts between types 0|1 and 1|2 at the level now (its shares by
 *                                          level eased, `levelShares`), the cuts' half width; the cover now (after the level
 *                                          and the hour; before a region's), 0 to 1
 *  s3 = (driftX, driftZ, windX, windZ)     how far the layer has drifted, metres, modulo `CLOUD_DRIFT_WRAP` (sample a noise
 *                                          that tiles over a power of two of metres up to it at p − drift); its wind now, m/s
 *  s4 = (cellSize, mixScale, wet, seed)    metres; metres; the level's wetness now 0 to 1; the seed as a float (< 2^24)
 */
export const CLOUD_LAYER_VEC4 = 5;
export const CLOUD_STACK_FLOATS = CLOUD_LAYER_MAX * CLOUD_LAYER_VEC4 * 4;

/**
 * The types' uniform: `CLOUD_TYPE_VEC4` vec4 a type, in `CLOUD_TYPES` order.
 *
 *  p0 = (rise, fallFrom, fallTo, anvil)
 *  p1 = (cells, billow, erosion, stretch)
 *  p2 = (density, wet, taper, thickness)   thickness in metres: in a mix, a type's column is its thickness over the tallest
 *                                          of the layer's types' (the shape's `reach`; one for a layer of one type)
 */
export const CLOUD_TYPE_VEC4 = 3;
export const CLOUD_TYPE_FLOATS = CLOUD_TYPE_COUNT * CLOUD_TYPE_VEC4 * 4;

/**
 * The march's height bands: the on layers' [baseY, topY] sorted and merged where they overlap or touch, one vec4 each
 * (loY, hiY, 0, 0), `CLOUD_LAYER_MAX` of them; how many is the frame's `bands`.
 */
export const CLOUD_BAND_FLOATS = CLOUD_LAYER_MAX * 4;

/**
 * The frame's vec4: (layers, bands, level, seconds). `layers` is how many slots of the stack to walk (the stack's length,
 * off ones included with count 0), `bands` how many bands, `level` the weather's continuous level 0 to 4 the covers were
 * eased at, `seconds` the shared clock's seconds modulo 2^16 (for slow changes a reader wants; the drift is already in s3).
 */
export const CLOUD_FRAME_FLOATS = 4;

/** The drift's period on the card, metres: every noise a reader samples at p − drift tiles over a power of two dividing it. */
export const CLOUD_DRIFT_WRAP = 65536;

/**
 * The map's two rings: each a square centred on the camera (snapped to its own texels in each layer's drifting frame, so a
 * cloud does not shimmer across texels), `CLOUD_LAYER_MAX` slices of RGBA8, one a layer:
 *
 *  r = cover 0 to 1 (after the cell function for cellular types, after a region's term), g = the type mix value 0 to 1 (the
 *  layer's cuts turn it into its types' weights, `mixWeights`), b = wetness 0 to 1, a = the cell's top 0 to 1 (a cellular
 *  cloud's own height as a share of the layer's thickness; 1 where the layer is continuous).
 */
export const CLOUD_MAP_RINGS = {
  near: { size: 512, span: 64000 },
  far: { size: 256, span: 256000 },
} as const;

/** The type weights at a mix value: the pure form of the face's `weights` (into `out`, three numbers summing to 1). */
export function mixWeights(count: number, cut0: number, cut1: number, soft: number, m: number, out: Float32Array | Float64Array | number[]): void {
  if (count <= 1) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  const s = soft > 1e-4 ? soft : 1e-4;
  // A smooth step across each cut, so the patches' borders blend over `soft` of the mix value.
  let a = (m - (cut0 - s)) / (2 * s);
  a = a < 0 ? 0 : a > 1 ? 1 : a;
  const w1 = a * a * (3 - 2 * a);
  if (count === 2) {
    out[0] = 1 - w1;
    out[1] = w1;
    out[2] = 0;
    return;
  }
  let b = (m - (cut1 - s)) / (2 * s);
  b = b < 0 ? 0 : b > 1 ? 1 : b;
  const w2 = b * b * (3 - 2 * b);
  out[0] = 1 - w1;
  out[1] = w1 - w2;
  out[2] = w2;
}

/**
 * The cuts of a layer's mix (into `out`: cut0, cut1): the mix value is near-uniform over 0 to 1 (the map's noise is ranked
 * to be), so the cumulative shares are where one type gives way to the next.
 */
export function mixCuts(layer: CloudLayer, out: Float32Array | Float64Array | number[]): void {
  const n = layer.types.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.max(0, layer.shares[i]);
  if (!(total > 0) || n <= 1) {
    out[0] = 1;
    out[1] = 1;
    return;
  }
  // Math.max, never a conditional of 0 (the frame packs this: a conditional write of a whole number boxes the local).
  const s0 = Math.max(0, layer.shares[0]) / total;
  out[0] = s0;
  out[1] = n > 2 ? s0 + Math.max(0, layer.shares[1]) / total : 1;
}

/** The layer's cover at a continuous level (eased between the two whole levels either side). */
export function coverAtLevel(layer: CloudLayer, level: number): number {
  const lv = level < 0 ? 0 : level > CLOUD_LEVELS - 1 ? CLOUD_LEVELS - 1 : level;
  const lo = Math.floor(lv);
  const hi = lo + 1 < CLOUD_LEVELS ? lo + 1 : lo;
  const f = lv - lo;
  const a = layer.cover[lo];
  return a + f * (layer.cover[hi] - a);
}

/**
 * What a frame hands `packStack` beyond the layers: the ground's y, the level, the hour's swing, each layer's drift and wind,
 * the level's wetness and how many places force their weather; and what the packing hands back, each layer's band top now.
 * Kept records, written in place (nothing a frame makes).
 */
export interface CloudStackFrame {
  groundY: number;
  level: number;
  /** -1 (the night's least) to 1 (the afternoon's peak): what `diurnal` is multiplied by. */
  hour: number;
  /** The level's wetness now, 0 to 1 (`CLOUD_MAP_TUNE`'s ramp), times each type's `wet` on the card. */
  wet: number;
  /** Each layer's drift modulo `CLOUD_DRIFT_WRAP` (x, z) and its wind (x, z), four numbers a layer. */
  drift: Float64Array;
  seconds: number;
  /**
   * How many places force their weather (the run's regions; a whole number). With none, a layer whose cover now is nought is
   * packed with count 0, so the map skips its slot and the march its band; with some, its slot is laid, since a place forced
   * to rain lays cloud where the layer holds none.
   */
  regions: number;
  /**
   * Written by the packing: each layer's band top now, world y (its base plus its thickness times the tallest of its types
   * present at this level, each type's column its thickness over the tallest of the layer's types'), what the march's bands
   * reach to (`packBands`), so a fair-weather deck that holds storm towers only at its stormy levels is walked no higher than
   * its heaps on a fair day.
   */
  bandTop: Float64Array;
}

/** A kept frame record. */
export function newStackFrame(): CloudStackFrame {
  return { groundY: 0.5, level: 0.5, hour: 0.5, wet: 0.5, drift: new Float64Array(CLOUD_LAYER_MAX * 4), seconds: 0.5, regions: 0, bandTop: new Float64Array(CLOUD_LAYER_MAX) };
}

/** The layer's cover now: its level's, plus its diurnal swing at the hour, clamped to 0 to 1. */
export function coverNow(layer: CloudLayer, f: CloudStackFrame): number {
  const c = coverAtLevel(layer, f.level) + layer.diurnal * f.hour;
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

const shareScratch = new Float64Array(CLOUD_MIX_MAX);

/**
 * A layer's mix at a whole level k into `out` from `at`: its cuts (`mixCuts`'s rule, from its shares at that level) and the
 * tallest of its types present there, as a share of the layer's thickness (each type's column its own thickness over the
 * tallest of the layer's types', `CLOUD_TYPE_TUNE`; one for a layer of one type). Allocates nothing; not a frame's path.
 */
export function levelMixInto(L: CloudLayer, k: number, out: Float64Array, at: number): void {
  const n = L.types.length < CLOUD_MIX_MAX ? L.types.length : CLOUD_MIX_MAX;
  let total = 0;
  let thMax = 1;
  for (let i = 0; i < n; i++) {
    const row = L.levelShares ? L.levelShares[i] : null;
    const s = Math.max(0, row ? row[k] : L.shares[i]);
    shareScratch[i] = s;
    total += s;
    thMax = Math.max(thMax, CLOUD_TYPE_TUNE[L.types[i]].thickness);
  }
  if (!(total > 0) || n <= 1) {
    out[at] = 1;
    out[at + 1] = 1;
  } else {
    const s0 = shareScratch[0] / total;
    out[at] = s0;
    out[at + 1] = n > 2 ? s0 + shareScratch[1] / total : 1;
  }
  // With no share anywhere the cuts give the first type everywhere, so its column is the one that stands.
  let top = 0;
  for (let i = 0; i < n; i++) if (shareScratch[i] > 0 || (!(total > 0) && i === 0)) top = Math.max(top, CLOUD_TYPE_TUNE[L.types[i]].thickness / thMax);
  out[at + 2] = top > 0 ? top : 1;
}

const mixLo = new Float64Array(3);
const mixHi = new Float64Array(3);

/**
 * The stack into the card's layout (`CLOUD_STACK_FLOATS` numbers, `out`), at most `CLOUD_LAYER_MAX` layers; the rest
 * zeroed, and each layer's band top into `f.bandTop`. Returns how many slots are in use (the frame's `layers`). Allocates
 * nothing.
 */
export function packStack(layers: readonly CloudLayer[], f: CloudStackFrame, out: Float32Array): number {
  const n = layers.length < CLOUD_LAYER_MAX ? layers.length : CLOUD_LAYER_MAX;
  const V = CLOUD_LAYER_VEC4 * 4;
  const lv = Math.min(CLOUD_LEVELS - 1, Math.max(0, f.level));
  const lo = Math.floor(lv);
  const hi = lo + 1 < CLOUD_LEVELS ? lo + 1 : lo;
  const fr = lv - lo;
  for (let i = 0; i < n; i++) {
    const L = layers[i];
    const o = i * V;
    const baseY = f.groundY + L.base;
    out[o] = baseY;
    out[o + 1] = baseY + L.thickness;
    out[o + 2] = L.density;
    out[o + 3] = L.edge;
    const k = L.types.length < CLOUD_MIX_MAX ? L.types.length : CLOUD_MIX_MAX;
    out[o + 4] = k > 0 ? cloudTypeIndex(L.types[0]) : 0;
    out[o + 5] = k > 1 ? cloudTypeIndex(L.types[1]) : out[o + 4];
    out[o + 6] = k > 2 ? cloudTypeIndex(L.types[2]) : out[o + 5];
    // The cuts at the level now, each whole level's eased (as the frame's form eases them).
    levelMixInto(L, lo, mixLo, 0);
    levelMixInto(L, hi, mixHi, 0);
    out[o + 8] = mixLo[0] + fr * (mixHi[0] - mixLo[0]);
    out[o + 9] = mixLo[1] + fr * (mixHi[1] - mixLo[1]);
    out[o + 10] = CLOUD_MIX_SOFT;
    // `coverNow` written out: a number handed back from a call the compiler leaves out is a number made.
    const ca = L.cover[lo];
    const cov = Math.min(1, Math.max(0, ca + fr * (L.cover[hi] - ca) + L.diurnal * f.hour));
    out[o + 11] = cov;
    // Off, or clear now with no place forcing its weather: count 0, nothing laid and nothing read.
    out[o + 7] = L.on ? k * Math.min(1, Math.ceil(cov) + f.regions) : 0;
    f.bandTop[i] = baseY + L.thickness * Math.max(mixLo[2], mixHi[2] * Math.ceil(fr));
    const d = i * 4;
    out[o + 12] = f.drift[d];
    out[o + 13] = f.drift[d + 1];
    out[o + 14] = f.drift[d + 2];
    out[o + 15] = f.drift[d + 3];
    out[o + 16] = L.cellSize;
    out[o + 17] = L.mixScale;
    out[o + 18] = f.wet;
    out[o + 19] = L.seed & 0xffffff;
  }
  for (let i = n * V; i < CLOUD_STACK_FLOATS; i++) out[i] = 0;
  return n;
}

/**
 * What `packCovers` keeps a layer for the frame, `COVER_FLOATS` numbers: its covers by level, its diurnal swing, its two
 * cuts by level, its tallest type's column share by level, and its type count (0 off).
 */
export const COVER_AT = { cover: 0, swing: CLOUD_LEVELS, cut0: CLOUD_LEVELS + 1, cut1: 2 * CLOUD_LEVELS + 1, top: 3 * CLOUD_LEVELS + 1, count: 4 * CLOUD_LEVELS + 1 } as const;
export const COVER_FLOATS = 4 * CLOUD_LEVELS + 2;

/** The stack's still parts the frame reads (`COVER_AT`) into a kept array (`CLOUD_LAYER_MAX × COVER_FLOATS`), when the stack changes. */
export function packCovers(layers: readonly CloudLayer[], out: Float64Array): void {
  const n = layers.length < CLOUD_LAYER_MAX ? layers.length : CLOUD_LAYER_MAX;
  const A = COVER_AT;
  for (let i = 0; i < n; i++) {
    const L = layers[i];
    const c = i * COVER_FLOATS;
    for (let k = 0; k < CLOUD_LEVELS; k++) {
      out[c + A.cover + k] = L.cover[k];
      levelMixInto(L, k, mixLo, 0);
      out[c + A.cut0 + k] = mixLo[0];
      out[c + A.cut1 + k] = mixLo[1];
      out[c + A.top + k] = mixLo[2];
    }
    out[c + A.swing] = L.diurnal;
    out[c + A.count] = L.on ? (L.types.length < CLOUD_MIX_MAX ? L.types.length : CLOUD_MIX_MAX) : 0;
  }
}

/**
 * The frame's own slots of a stack packed already (`packStack` when the layers last changed): each layer's cover now (its
 * level's, plus its swing at the hour), its cuts and its count at the level now, its drift and wind and the level's wetness,
 * and its band top into `f.bandTop`, read off kept arrays and the frame's record alone, so the frame reads no layer's record
 * (a field of a record whose shape the compiler does not know is a number made at a read: CLAUDE.md). The frame's form of
 * `packStack`: the same numbers. Allocates nothing.
 */
export function packStackFrame(count: number, covers: Float64Array, f: CloudStackFrame, out: Float32Array): void {
  const V = CLOUD_LAYER_VEC4 * 4;
  const A = COVER_AT;
  const lv = Math.min(CLOUD_LEVELS - 1, Math.max(0, f.level));
  const lo = Math.floor(lv);
  const hi = Math.min(CLOUD_LEVELS - 1, lo + 1);
  const fr = lv - lo;
  const frUp = Math.ceil(fr);
  const hour = f.hour;
  const wet = f.wet;
  const dr = f.drift;
  const regions = f.regions;
  const tops = f.bandTop;
  for (let i = 0; i < count; i++) {
    const o = i * V;
    const c = i * COVER_FLOATS;
    const ca = covers[c + lo];
    const cov = Math.min(1, Math.max(0, ca + fr * (covers[c + hi] - ca) + covers[c + A.swing] * hour));
    out[o + 11] = cov;
    // Written by arithmetic, never a conditional (a conditional write of a whole number boxes the local: CLAUDE.md).
    out[o + 7] = covers[c + A.count] * Math.min(1, Math.ceil(cov) + regions);
    const a0 = covers[c + A.cut0 + lo];
    out[o + 8] = a0 + fr * (covers[c + A.cut0 + hi] - a0);
    const a1 = covers[c + A.cut1 + lo];
    out[o + 9] = a1 + fr * (covers[c + A.cut1 + hi] - a1);
    tops[i] = out[o] + (out[o + 1] - out[o]) * Math.max(covers[c + A.top + lo], covers[c + A.top + hi] * frUp);
    const d = i * 4;
    out[o + 12] = dr[d];
    out[o + 13] = dr[d + 1];
    out[o + 14] = dr[d + 2];
    out[o + 15] = dr[d + 3];
    out[o + 18] = wet;
  }
}

/**
 * The mix's cuts' half width, a share of the mix value: the patches' borders blend over this much either side. A dial: 0.08
 * gives borders about a sixth of a patch wide, so two types meet in a band rather than a line.
 */
export let CLOUD_MIX_SOFT = 0.08;
export function setMixSoft(v: number): void {
  CLOUD_MIX_SOFT = v < 0.001 ? 0.001 : v > 0.5 ? 0.5 : v;
}

/** The types' profiles into the card's layout (`CLOUD_TYPE_FLOATS` numbers). Allocates nothing. */
export function packTypes(out: Float32Array): void {
  for (let i = 0; i < CLOUD_TYPE_COUNT; i++) {
    const p = CLOUD_TYPE_TUNE[CLOUD_TYPES[i]];
    const o = i * CLOUD_TYPE_VEC4 * 4;
    out[o] = p.rise;
    out[o + 1] = p.fallFrom;
    out[o + 2] = p.fallTo;
    out[o + 3] = p.anvil;
    out[o + 4] = p.cells;
    out[o + 5] = p.billow;
    out[o + 6] = p.erosion;
    out[o + 7] = p.stretch;
    out[o + 8] = p.density;
    out[o + 9] = p.wet;
    out[o + 10] = p.taper;
    out[o + 11] = p.thickness;
  }
}

const bandLo = new Float64Array(CLOUD_LAYER_MAX);
const bandHi = new Float64Array(CLOUD_LAYER_MAX);

/**
 * The march's bands from a packed stack (`packStack`'s `out` and its count): the drawn layers' [baseY, top] (a layer of count
 * 0, or of no density, is left out; its top `tops`' where given, the packing's band tops, else its whole thickness), sorted
 * by base and merged where they overlap or touch, into `out` (`CLOUD_BAND_FLOATS`). Returns how many. Allocates nothing.
 */
export function packBands(stack: Float32Array, count: number, out: Float32Array, tops?: Float64Array | null): number {
  const V = CLOUD_LAYER_VEC4 * 4;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const o = i * V;
    if (!(stack[o + 7] > 0) || !(stack[o + 2] > 0)) continue;
    // Insertion by base, in place.
    let j = n;
    const lo = stack[o];
    const hi = tops ? tops[i] : stack[o + 1];
    while (j > 0 && bandLo[j - 1] > lo) {
      bandLo[j] = bandLo[j - 1];
      bandHi[j] = bandHi[j - 1];
      j--;
    }
    bandLo[j] = lo;
    bandHi[j] = hi;
    n++;
  }
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (m > 0 && bandLo[i] <= out[(m - 1) * 4 + 1]) {
      if (bandHi[i] > out[(m - 1) * 4 + 1]) out[(m - 1) * 4 + 1] = bandHi[i];
      continue;
    }
    out[m * 4] = bandLo[i];
    out[m * 4 + 1] = bandHi[i];
    out[m * 4 + 2] = 0;
    out[m * 4 + 3] = 0;
    m++;
  }
  for (let i = m * 4; i < CLOUD_BAND_FLOATS; i++) out[i] = 0;
  return m;
}

// ------------------------------------------------------------------------------------------------ the GPU face

/** A node of three's shading language (the port types them loosely, as every GPU file does). */
type Tsl = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The map's GPU face: what the march, the shadow map and the bakes call to read the map, built once a session by
 * `cloudMapGpu.ts` (`cloudMapFace()`), whether the map behind it is the GPU's compute or the twin's upload. Every read is at a
 * named level (WGSL refuses a plain read inside a loop that differs per pixel), so it may be called inside any loop.
 */
export interface CloudMapFace {
  /**
   * The map at a layer (an int node, 0 to `CLOUD_LAYER_MAX − 1`) and a place RELATIVE TO THE CAMERA (a vec3 node, metres;
   * its y is not read): vec4(cover, mix, wet, top) as `CLOUD_MAP_RINGS` says, from the near ring inside its reach and the
   * far ring beyond, cross-faded over the near ring's last tenth; nought beyond the far ring.
   */
  sample(layer: Tsl, rel: Tsl): Tsl;
  /** The layer's type weights (vec3, summing to 1) at a mix value (`mixWeights` on the card). */
  weights(layer: Tsl, mix: Tsl): Tsl;
  /** The layer's slot k (0 to `CLOUD_LAYER_VEC4 − 1`) of the stack: a vec4 node (`s0` to `s4` above). */
  slot(layer: Tsl, k: number): Tsl;
  /** A type's profile slot k (0 to `CLOUD_TYPE_VEC4 − 1`): a vec4 node (`p0` to `p2` above); `type` an int node. */
  typeSlot(type: Tsl, k: number): Tsl;
  /** The frame's vec4 (layers, bands, level, seconds) and band i's vec4 (loY, hiY, 0, 0). */
  readonly frame: Tsl;
  band(i: Tsl): Tsl;
}
