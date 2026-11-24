// Each world's starting stack of cloud layers (pass 3, wave 1). Pure: no three, no DOM.
//
// The owner's late word of 24 November: "the decks can still be a good starting point for realism that I can adjust after with
// layers or more decks". So every world STARTS from the design's 2.1 realistic decks, one layer each, named for its deck: the
// Low deck (base 0.3 to 3 km over the world's ground, by its moisture: a wet world's low, a dry world's high; its storm towers
// rising to about 10 km), the Middle deck (3 to 6 km) and the High deck (7 to 10 km). Each deck holds the real types its
// world's climate and lore give it, as a mix of up to three whose shares may move with the weather level (a fair cumulus deck
// giving way to nimbostratus as the rain comes, `levelShares`), and a cover at each level; a deck the world rarely shows starts
// with little or no cover at most levels but stands there for him to adjust. He adds layers or more decks from the same starts
// (`__debug.clouds({ layer: { add: 'low' | 'middle' | 'high' | 'blank' } })`, `cloudDeckFor`), and nothing here is a limit.
//
// What chose the types (his word of 24 November): the real cloud types a world takes, from the lore gathered for each world
// (`src/sky/look/lore.js`), its terrain and its weather rows (which levels rain, which blow dust, which hang fog), and SWG's own
// sheets studied only for WHICH types a world shows. Never a number, colour or shape of theirs: every height, cover and density
// here is ours, from the types' real heights and each world's character. Shapes no real sky makes (Corellia's spiral sheets)
// are left out. Rain gives nimbostratus or cumulonimbus by the world's character, snow nimbostratus, dust a bare low deck, fog a
// low stratus. A world of his own takes the stack of the world whose ground rules or sky it borrows.
//
// Heights are metres over the world's ground (its median height, worked out at the arrival). A deck's thickness reaches its
// tallest type's top; each type's own clouds stand its thickness of that (`CLOUD_TYPE_TUNE`, the shape's `reach`), so the low
// deck's fair heaps stay 1.5 km tall while its storm towers rise through the whole deck. Cover is per weather level 0 (the
// clearest) to 4 (the stormiest).
import { CLOUD_LEVELS, CLOUD_TYPE_TUNE, cleanLayer, copyStack, newCloudLayer, type CloudLayer, type CloudTypeId } from './cloudLayers.ts';

/** The three decks of the design's 2.1, in the order a stack starts with them. */
export const CLOUD_DECKS = ['low', 'middle', 'high'] as const;
export type CloudDeckId = (typeof CLOUD_DECKS)[number];

/** Each deck's layer name (the start's, and how a saved layer of that name finds its start). */
export const DECK_NAMES: Readonly<Record<CloudDeckId, string>> = { low: 'Low deck', middle: 'Middle deck', high: 'High deck' };

/** Five numbers, one a weather level. */
type Levels = [number, number, number, number, number];

/** A deck written short: its type or mix (each share one number, or five by level), its covers by level, what differs from its type's starts. */
interface Deck {
  types: CloudTypeId[];
  shares?: (number | Levels)[];
  cover: Levels;
  base: number;
  thickness?: number;
  density?: number;
  cellSize?: number;
  drift?: number;
  turn?: number;
  diurnal?: number;
  edge?: number;
  mixScale?: number;
}

/** One world's three decks and its one line of why. */
interface WorldStart {
  why: string;
  low: Deck;
  middle: Deck;
  high: Deck;
}

/**
 * The drift of a deck by its height, the starts: the one wind aloft (`wind.ts`'s `aloft.low`) at the low deck, more and turned
 * with height above (winds aloft are stronger and veer), as `aloft.bottom` / `aloft.low` and `aloft.top` / `aloft.low` have
 * the WebGL sheets. Each layer's own `drift` and `turn` are his.
 */
const MID_DRIFT = 1.6;
const MID_TURN = 12;
const HIGH_DRIFT = 2.3;
const HIGH_TURN = 25;

/** The top of a storm tower over the ground, metres (2.1: storm towers to 10 km): a low deck holding cumulonimbus reaches it. */
const TOWER_TOP = 10000;

/** A middle deck of the world's usual middle cloud. */
const mid = (types: CloudTypeId[], cover: Levels, base: number, more: Partial<Deck> = {}): Deck => ({ types, cover, base, drift: MID_DRIFT, turn: MID_TURN, ...more });
/** A high deck of the world's usual high cloud. */
const high = (types: CloudTypeId[], cover: Levels, base: number, more: Partial<Deck> = {}): Deck => ({ types, cover, base, drift: HIGH_DRIFT, turn: HIGH_TURN, ...more });

export const CLOUD_CLIMATES: Readonly<Record<string, WorldStart>> = {
  // Dry: high thin cirrus thickening to a veil as the dust rises, rare fair cumulus on a high base, a middle deck it hardly shows.
  tatooine: {
    why: 'Desert world (lore: dune seas, water drawn from the dry air; every stormier level of its rows blows dust): a dry high base near 3 km with rare fair cumulus, bare at the dust levels; a middle deck it hardly shows; high thin cirrus giving way to a cirrostratus veil as the dust rises.',
    low: { types: ['cumulus'], cover: [0.12, 0.05, 0.02, 0, 0], base: 3000, diurnal: 0.08 },
    middle: mid(['altocumulus'], [0.04, 0.02, 0, 0, 0], 5000),
    high: high(['cirrus', 'cirrostratus'], [0.25, 0.3, 0.35, 0.45, 0.55], 9000, { shares: [[1, 1, 0.7, 0.4, 0.3], [0, 0.25, 0.5, 0.8, 1]] }),
  },
  // Mild and green: fair cumulus building through the afternoon, the rain deck coming in at the stormier levels; middle and high cloud.
  naboo: {
    why: 'Mild green world of plains, swamps and lakes (lore); rain at its stormier levels: a low deck near 1.1 km of fair cumulus building through the afternoon, giving way to nimbostratus as the rain comes; altocumulus thickening to altostratus; cirrus.',
    low: { types: ['cumulus', 'nimbostratus'], shares: [[1, 1, 0.7, 0.3, 0.1], [0, 0, 0.3, 0.7, 0.9]], cover: [0.3, 0.45, 0.55, 0.75, 0.95], base: 1100, diurnal: 0.2 },
    middle: mid(['altocumulus', 'altostratus'], [0.1, 0.25, 0.4, 0.5, 0.5], 3800, { shares: [[1, 0.8, 0.6, 0.3, 0.2], [0, 0.2, 0.4, 0.7, 0.8]] }),
    high: high(['cirrus'], [0.25, 0.3, 0.35, 0.3, 0.25], 8500),
  },
  // An old Core world's coast: stratocumulus and cumulus off the sea, nimbostratus for the rain, a middle sheet, cirrus.
  corellia: {
    why: 'Temperate coastal Core world (lore: Coronet on the coast); rain at its stormier levels: a low deck near 0.9 km part stratocumulus, part cumulus off the sea, nimbostratus as the rain comes; altostratus; cirrus (its spiral sheets are no real sky and are left out).',
    low: { types: ['stratocumulus', 'cumulus', 'nimbostratus'], shares: [[0.55, 0.55, 0.5, 0.3, 0.1], [0.45, 0.45, 0.3, 0.1, 0], [0, 0, 0.2, 0.6, 0.9]], cover: [0.3, 0.45, 0.6, 0.8, 0.95], base: 900, diurnal: 0.1 },
    middle: mid(['altostratus'], [0, 0.15, 0.35, 0.5, 0.45], 3800),
    high: high(['cirrus'], [0.25, 0.3, 0.3, 0.25, 0.2], 8500),
  },
  // Corellia's sister: rain at every level past the first, so a grey temperate sky.
  talus: {
    why: 'Temperate world of the Corellian system (lore); its rows rain from the first level up: a low deck near 0.9 km of stratocumulus most days with cumulus in it, nimbostratus soon after; altostratus; a high cirrostratus veil.',
    low: { types: ['stratocumulus', 'cumulus', 'nimbostratus'], shares: [[0.7, 0.6, 0.4, 0.2, 0.1], [0.3, 0.2, 0.1, 0, 0], [0, 0.2, 0.5, 0.8, 0.9]], cover: [0.35, 0.55, 0.7, 0.85, 0.95], base: 900 },
    middle: mid(['altostratus'], [0.1, 0.2, 0.35, 0.45, 0.45], 3500),
    high: high(['cirrostratus'], [0.2, 0.3, 0.4, 0.4, 0.35], 8000),
  },
  // Rolling grassland: fair cumulus over the plains by day, plains storms rising from them when it rains, altocumulus, cirrus.
  dantooine: {
    why: 'Grassland and plains world (lore: savannas, steppes); rain from its first level: a low deck near 1.3 km of fair cumulus building by day over the plains, cumulonimbus rising from it as a plains storm when it rains; altocumulus; cirrus.',
    low: { types: ['cumulus', 'cumulonimbus'], shares: [[1, 0.9, 0.75, 0.6, 0.5], [0, 0.1, 0.25, 0.4, 0.5]], cover: [0.25, 0.4, 0.45, 0.5, 0.55], base: 1300, thickness: TOWER_TOP - 1300, diurnal: 0.25 },
    middle: mid(['altocumulus'], [0.1, 0.2, 0.3, 0.3, 0.25], 4000),
    high: high(['cirrus'], [0.2, 0.25, 0.35, 0.4, 0.4], 9000),
  },
  // Barren, dusty, volcanic: a dry high base that hardly shows, a sparse middle sky thickening to haze with the dust, cirrus.
  lok: {
    why: 'Barren dusty world of hardened desert, plateaus and volcanoes (lore); its stormier levels blow dust: a dry low deck near 3 km it hardly shows; sparse high-based altocumulus thickening into an altostratus haze over the volcanoes as the dust rises; cirrus.',
    low: { types: ['cumulus'], cover: [0.05, 0.03, 0.01, 0, 0], base: 3000 },
    middle: mid(['altocumulus', 'altostratus'], [0.12, 0.15, 0.25, 0.4, 0.5], 4200, { shares: [[1, 0.8, 0.5, 0.3, 0.1], [0, 0.2, 0.5, 0.7, 0.9]], density: 0.8 }),
    high: high(['cirrus'], [0.2, 0.25, 0.25, 0.2, 0.2], 9000),
  },
  // The forest moon: fair cumulus over the canopy, a low grey deck thickening into the rain deck as it rains, cirrus.
  endor: {
    why: 'Forest moon of towering forest, savanna and mountains (lore); rain at its stormier levels: a low deck near 1 km of cumulus over the canopy by day, stratocumulus thickening into nimbostratus as it rains; a little altocumulus; cirrus.',
    low: { types: ['cumulus', 'stratocumulus', 'nimbostratus'], shares: [[0.8, 0.6, 0.4, 0.15, 0.05], [0.2, 0.4, 0.4, 0.35, 0.15], [0, 0, 0.2, 0.5, 0.8]], cover: [0.3, 0.45, 0.55, 0.75, 0.9], base: 1000, diurnal: 0.2 },
    middle: mid(['altocumulus'], [0.05, 0.15, 0.25, 0.3, 0.25], 3800),
    high: high(['cirrus'], [0.2, 0.25, 0.3, 0.3, 0.25], 8500),
  },
  // Hot jungle: cumulus building hard through the afternoon into towers and storms, the storms' cirrus and its veil.
  yavin4: {
    why: 'Hot jungle moon of marsh and fast rivers (lore); rain at its stormier levels: a low deck near 0.9 km of cumulus building hard through the afternoon, towering cumulus in it, cumulonimbus rising to 10 km as a tropical storm; a little altocumulus; high cirrus off the anvils thickening to a veil.',
    low: { types: ['cumulus', 'towering', 'cumulonimbus'], shares: [[0.8, 0.6, 0.4, 0.25, 0.15], [0.2, 0.35, 0.35, 0.3, 0.25], [0, 0.05, 0.25, 0.45, 0.6]], cover: [0.3, 0.45, 0.5, 0.6, 0.7], base: 900, thickness: TOWER_TOP - 900, diurnal: 0.3 },
    middle: mid(['altocumulus'], [0.05, 0.1, 0.15, 0.2, 0.2], 4000),
    high: high(['cirrus', 'cirrostratus'], [0.2, 0.3, 0.4, 0.45, 0.5], 9500, { shares: [[1, 1, 0.8, 0.6, 0.5], [0, 0, 0.2, 0.4, 0.5]] }),
  },
  // Twisted forest, swamp and mountain, fog in every row, storms in its sheets: low stratus, dark heaps, storm towers, a lid.
  dathomir: {
    why: 'World of twisted forest, swamp and mountain (lore); its rows hang fog at every level and rain from the first, its sheets show storm: a wet low deck near 0.4 km of stratus for the fog and dark stratocumulus, cumulonimbus rising from it as it rains; an altostratus lid; high cloud it hardly shows.',
    low: { types: ['stratus', 'stratocumulus', 'cumulonimbus'], shares: [[0.4, 0.35, 0.3, 0.25, 0.2], [0.6, 0.5, 0.45, 0.35, 0.3], [0, 0.15, 0.25, 0.4, 0.5]], cover: [0.4, 0.5, 0.6, 0.65, 0.7], base: 400, thickness: TOWER_TOP - 400, density: 1.2 },
    middle: mid(['altostratus'], [0.1, 0.25, 0.4, 0.55, 0.6], 4000),
    high: high(['cirrus'], [0.1, 0.1, 0.05, 0.05, 0.05], 8500),
  },
  // Wetter and swampier than Naboo: a low base, broken stratocumulus and cumulus, the rain deck more often.
  rori: {
    why: "Naboo's moon, wetter and swampier than Naboo with rain more often (lore); rain at its stormier levels: a low deck near 0.8 km part stratocumulus, part cumulus, giving way to nimbostratus sooner than Naboo's; altostratus; a little cirrus.",
    low: { types: ['stratocumulus', 'cumulus', 'nimbostratus'], shares: [[0.6, 0.5, 0.35, 0.15, 0.05], [0.4, 0.4, 0.25, 0.1, 0], [0, 0.1, 0.4, 0.75, 0.95]], cover: [0.35, 0.5, 0.65, 0.85, 0.95], base: 800, diurnal: 0.15 },
    middle: mid(['altostratus'], [0.1, 0.25, 0.4, 0.5, 0.5], 3500),
    high: high(['cirrus'], [0.15, 0.2, 0.2, 0.15, 0.1], 8000),
  },
  // Immense forest, ocean and swamp: humid heaps and towers building by day, the rain deck, cirrus.
  kashyyyk: {
    why: 'Wookiee world of immense forest, ocean and swamp (lore); rain at its stormier levels: a low deck near 0.9 km of humid cumulus building by day with towering cumulus among it, nimbostratus as the rain comes; a little altocumulus; cirrus.',
    low: { types: ['cumulus', 'towering', 'nimbostratus'], shares: [[0.8, 0.7, 0.45, 0.2, 0.1], [0.2, 0.3, 0.3, 0.2, 0.1], [0, 0, 0.25, 0.6, 0.8]], cover: [0.3, 0.45, 0.55, 0.75, 0.9], base: 900, diurnal: 0.25 },
    middle: mid(['altocumulus'], [0.05, 0.1, 0.2, 0.25, 0.2], 4000),
    high: high(['cirrus'], [0.2, 0.25, 0.35, 0.35, 0.3], 9500),
  },
  // Volcanic: storm towers over the flows rising from heaps of their own heat, an ash-grey middle lid, a high veil.
  mustafar: {
    why: 'Volcanic world (lore: kneaded by two gas giants into fire); its rows are smoke, ash and lightning: a low deck near 1.2 km of heaps over the flows with cumulonimbus rising from them as fire storms; an altostratus lid of ash; a high cirrostratus veil.',
    low: { types: ['cumulus', 'cumulonimbus'], shares: [[0.6, 0.5, 0.4, 0.4, 0.4], [0.4, 0.5, 0.6, 0.6, 0.6]], cover: [0.12, 0.2, 0.3, 0.3, 0.3], base: 1200, thickness: TOWER_TOP - 1200, density: 1.4 },
    middle: mid(['altostratus'], [0.45, 0.6, 0.75, 0.75, 0.75], 3000, { density: 1.3 }),
    high: high(['cirrostratus'], [0.3, 0.35, 0.4, 0.4, 0.4], 9000),
  },
  // A farming world of meadows: fair weather heaps over the fields, the rain deck at the stormier levels, altocumulus, cirrus.
  taanab: {
    why: 'Farming world of reddish-brown meadows and fields (lore); rain at its stormier levels: a low deck near 1.2 km of fair cumulus over the fields by day, giving way to nimbostratus as the rain comes; altocumulus; cirrus.',
    low: { types: ['cumulus', 'nimbostratus'], shares: [[1, 1, 0.7, 0.3, 0.1], [0, 0, 0.3, 0.7, 0.9]], cover: [0.25, 0.4, 0.5, 0.75, 0.9], base: 1200, diurnal: 0.2 },
    middle: mid(['altocumulus'], [0.1, 0.2, 0.35, 0.35, 0.3], 3800),
    high: high(['cirrus'], [0.2, 0.25, 0.3, 0.3, 0.25], 8500),
  },
  // An ice world: a low grey stratus giving way to nimbostratus as the snow comes, altostratus, a thin high veil.
  hoth: {
    why: 'Ice world (lore: a frozen sixth planet whose ice its moons crack): a low deck near 0.4 km of grey stratus most days, giving way to nimbostratus for the snow; altostratus; a thin cirrostratus veil.',
    low: { types: ['stratus', 'nimbostratus'], shares: [[1, 0.8, 0.5, 0.25, 0.1], [0, 0.2, 0.5, 0.75, 0.9]], cover: [0.3, 0.5, 0.6, 0.75, 0.95], base: 400 },
    middle: mid(['altostratus'], [0.15, 0.3, 0.45, 0.55, 0.55], 3200),
    high: high(['cirrostratus'], [0.1, 0.1, 0.1, 0.1, 0.1], 8000),
  },
};

/** The decks for a world none of the above names: an ordinary temperate sky. */
const DEFAULT_START: WorldStart = {
  why: 'A world with no lore of its own here: a temperate sky, a low deck near 1.1 km of fair cumulus giving way to nimbostratus at the stormier levels, altocumulus and cirrus.',
  low: { types: ['cumulus', 'nimbostratus'], shares: [[1, 1, 0.7, 0.3, 0.1], [0, 0, 0.3, 0.7, 0.9]], cover: [0.25, 0.4, 0.5, 0.75, 0.9], base: 1100, diurnal: 0.15 },
  middle: mid(['altocumulus'], [0.1, 0.2, 0.35, 0.35, 0.3], 3800),
  high: high(['cirrus'], [0.2, 0.25, 0.3, 0.3, 0.25], 8500),
};

/** The climate key a world or pack id matches (equal, or it and an underscore, as the weather's `CLIMATES` keys match), or null. */
export function climateKey(id: string | null | undefined): string | null {
  if (!id) return null;
  const s = id.toLowerCase();
  for (const key of Object.keys(CLOUD_CLIMATES)) if (s === key || s.startsWith(`${key}_`)) return key;
  return null;
}

/** The thickness a deck needs to hold its tallest type's clouds (`CLOUD_TYPE_TUNE`'s thickness). */
function tallestOf(types: readonly CloudTypeId[]): number {
  let t = 0;
  for (const id of types) t = Math.max(t, CLOUD_TYPE_TUNE[id].thickness);
  return t;
}

/** A deck written short, made a whole layer of that name (its first type's starts under what it sets). */
function layerOf(d: Deck, name: string): CloudLayer {
  const t = CLOUD_TYPE_TUNE[d.types[0]];
  return cleanLayer(
    {
      name,
      types: d.types,
      shares: d.shares ?? d.types.map(() => 1),
      cover: d.cover,
      base: d.base,
      thickness: d.thickness ?? tallestOf(d.types),
      density: d.density ?? 1,
      cellSize: d.cellSize ?? t.cellSize,
      drift: d.drift ?? 1,
      turn: d.turn ?? 0,
      diurnal: d.diurnal ?? 0,
      edge: d.edge ?? 0.5,
      mixScale: d.mixScale ?? 6000,
    },
    newCloudLayer(d.types[0], name),
  );
}

/** The world's climate key: the planet's id first, then the pack's, then the world whose ground rules or sky it borrows. */
function keyOf(planetId: string | null | undefined, packId?: string | null, borrowId?: string | null): string | null {
  return climateKey(planetId) ?? climateKey(packId) ?? climateKey(borrowId);
}

/**
 * A world's starting stack and its line of why: its three decks, Low, Middle and High, for the planet's id first, then the
 * pack's (a copy of a world, a sub-pack), then the world whose ground rules or sky it borrows (a world of his own: Granyon's
 * ground is Lok's, Rainier borrows Dantooine's sky), else the temperate default. Fresh records each call.
 */
export function cloudStartFor(planetId: string | null | undefined, packId?: string | null, borrowId?: string | null): { key: string | null; why: string; layers: CloudLayer[] } {
  const key = keyOf(planetId, packId, borrowId);
  const start = key ? CLOUD_CLIMATES[key] : DEFAULT_START;
  return { key, why: start.why, layers: copyStack(CLOUD_DECKS.map((d) => layerOf(start[d], DECK_NAMES[d]))) };
}

/**
 * One of a world's decks as a fresh layer at its real height and with its types and covers (`add: 'low' | 'middle' | 'high'`),
 * named for the deck, for a second low deck or another high one he then edits; by the same keys as `cloudStartFor`.
 */
export function cloudDeckFor(deck: CloudDeckId, planetId: string | null | undefined, packId?: string | null, borrowId?: string | null): CloudLayer {
  const key = keyOf(planetId, packId, borrowId);
  const start = key ? CLOUD_CLIMATES[key] : DEFAULT_START;
  return copyStack([layerOf(start[deck], DECK_NAMES[deck])])[0];
}

/** A blank layer (`add: 'blank'`): a cumulus at its type's starts with no cover at any level, for him to make anything of. */
export function blankLayer(name = 'New layer'): CloudLayer {
  const l = newCloudLayer('cumulus', name);
  l.cover = new Array<number>(CLOUD_LEVELS).fill(0);
  return l;
}

/** Every world named, for the proofs' pictures and the report. */
export function climateWorlds(): string[] {
  return Object.keys(CLOUD_CLIMATES);
}
