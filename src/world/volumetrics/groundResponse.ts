// What the ground is made of, as the moving air sees it: each shader family's class (sand, rock, mud, ...), and so how
// much dust it sheds, how far its pattern moves, how deep it gives and how fast it heals (`GROUND_RESPONSE_CLASSES`).
//
// Decided in this order (the design's §2.7, research3 §3.3, checked by picture there):
//   1. an override of ours, keyed `<world>:<family id>` where one name is two grounds on two worlds, else by name;
//   2. SOE's own surface template for the family (`abstract/terrain_surface/sand.iff`, which the game already reads
//      for footsteps), which allows a set of classes, refined by the name rules only inside that set;
//   3. else the name rules over the shaders the family draws (by weight), then its own name;
//   4. a family that none of these reaches falls to `dirt`, said as `fallback` -- which the node test over every
//      converted world holds at nought, never a silent dirt.
//
// It names family and shader names only and numbers of ours, never anything else of the files, as
// `BASIN_WATER_SHADERS` does (`surfaces.ts`). The rules are the handoff's (`family_defaults.py`) with research3's
// fixes: `ash` only where it does not follow a `k` (17 Kashyyyk families were read as loose ash), the bare words
// Naboo names its sand with, Mustafar's volcanic ground, forest litter and wet shore sand.
//
// Pure: no three and nothing of the page.
import { GROUND_RESPONSE_CLASSES, type GroundClass } from './airTune.ts';

/** What a family is to the classifier: its id and name, SOE's surface template (empty for none), and the shaders it draws. */
export interface FamilyFacts {
  id: number;
  name: string;
  surface: string;
  children: readonly { name: string; weight: number }[];
}

export type Decider = 'override' | 'surface' | 'surface+name' | 'name' | 'fallback';

export interface FamilyClass {
  cls: GroundClass;
  by: Decider;
  /** The override's reason, when one decided. */
  why?: string;
}

/** The name rules, first match wins, so the specific ones stand above the general (research3's fixes in place). */
const RULES: readonly [RegExp, GroundClass][] = [
  [/mudcrack|bigcracks/, 'packed'],
  [/(^|[^k])ash/, 'ash'],
  [/wet|waterline|surf|pbls|pebble_surf/, 'wetsand'],
  [/mud/, 'mud'],
  [/road|tile|street|concrete|court|cobble|pave/, 'paved'],
  [/snow/, 'snow'],
  [/sand|dune|wndblwn/, 'sand'],
  [/gravel|smallrock|rocky(?!_?mtn)|brokenrock/, 'gravel'],
  [/grss|grass/, 'grass'],
  [/lava|sulfur|cheese|chunk|slate/, 'rock'],
  [/rock|cliff|granite|plate|coral/, 'rock'],
  [/leaf|leaves|needle|fern|ivy|moss(?!ydirt)|deep_forest/, 'litter'],
  [/dirt|canyonfloor|path|scorched|earth|grnd/, 'dirt'],
];

/** One word's class by the rules, or null. */
export function ruleClass(word: string): GroundClass | null {
  const n = word.toLowerCase();
  for (const [p, c] of RULES) if (p.test(n)) return c;
  return null;
}

/** What each of SOE's surfaces allows, its first the class it gives when the names say something it does not allow. */
export const SURFACE_ALLOWS: Readonly<Record<string, readonly GroundClass[]>> = {
  stone: ['paved'],
  rock: ['rock', 'gravel'],
  snow: ['snow'],
  grass: ['grass', 'litter'],
  harddirt: ['dirt', 'packed', 'gravel'],
  softdirt: ['dirt', 'mud', 'litter', 'ash'],
  sand: ['sand', 'wetsand', 'ash'],
  mud: ['mud'],
  surf: ['wetsand'],
};

/**
 * The overrides, committed as ours, each looked at against its own picture (research3 §3.4). Keyed
 * `<world>:<family id>` where one name is two grounds, else by name.
 */
export const GROUND_OVERRIDES: Readonly<Record<string, readonly [GroundClass, string]>> = {
  rock_lok_glowinglava: ['rock', "the handoff's: molten in look, the lava's job, not the wind's"],
  rock_dath_desertash: ['ash', "the handoff's: draws loose desert ash though SOE's surface says rock"],
  'kashyyyk_main:18': ['rock', 'named a steep cliff, draws shoreline dirt, used on faces'],
  'kashyyyk_north_dungeons:2': ['rock', 'the same cliff family there, with no surface, drawing the green path at half weight'],
  'kashyyyk_hunting:1': ['dirt', 'SOE says grass; draws a bare light dirt path'],
  'kashyyyk_hunting:18': ['litter', 'named cliffwall; draws dirt with ferns'],
  'kashyyyk_main:3': ['dirt', 'draws dry cracked dirt, not mud'],
  'kashyyyk_main:1': ['dirt', 'ptch_dath_canyoncoverlight on Kashyyyk draws the light path'],
  'kashyyyk_north_dungeons:4': ['dirt', 'ptch_dath_canyoncoverlight on Kashyyyk draws the light path'],
  ptch_dath_canyoncover: ['grass', 'ground-cover plants over stones'],
  ptch_dath_canyoncoverlight: ['grass', 'ground-cover plants over stones (on Dathomir; Kashyyyk has its own rows)'],
  'kashyyyk_dead_forest:31': ['grass', 'mossy green ground with stones'],
  'kashyyyk_north_dungeons:10': ['grass', 'mossy green ground with stones'],
  'kashyyyk_rryatt_trail:9': ['grass', 'green ground cover'],
  'kashyyyk_rryatt_trail:10': ['grass', 'green ground cover'],
  tar: ['rock', 'draws jagged rock'],
  dirt_muddampcracks: ['packed', 'dried mud crust, as mudcracks'],
  dirt_grasslands: ['dirt', 'SOE harddirt; the grass is what grows on it'],
  sand_beach_packed: ['packed', 'firm packed beach sand'],
  Family_0: ['paved', 'the ground nobody sees'],
};

/** SOE's surface template as its bare word (`abstract/terrain_surface/sand.iff` is `sand`), or ''. */
export function surfaceWordOf(path: string): string {
  if (!path) return '';
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.iff$/i, '').toLowerCase();
}

/** The class the names give: the drawn shaders by weight, then the family's own name; null where none speaks. */
function nameClass(f: FamilyFacts): GroundClass | null {
  let best: GroundClass | null = null;
  let bestWeight = -1;
  const votes = new Map<GroundClass, number>();
  for (const c of f.children) {
    const cls = ruleClass(c.name);
    if (!cls) continue;
    const w = (votes.get(cls) ?? 0) + (Number.isFinite(c.weight) ? c.weight : 1);
    votes.set(cls, w);
  }
  for (const [cls, w] of votes) {
    if (w > bestWeight) {
      best = cls;
      bestWeight = w;
    }
  }
  return best ?? ruleClass(f.name);
}

/**
 * Overrides set live from the console (`__debug.air({ family: { 'kashyyyk_main:18': 'rock' } })`), keyed as the
 * committed ones are and asked before them; a texture upload when the world's tables are made again, never a program.
 * Empty unless somebody set one this session.
 */
export const LIVE_GROUND_OVERRIDES = new Map<string, GroundClass>();

/** A family's class on a world (`world` the pack id), and what decided it. */
export function classifyFamily(world: string, f: FamilyFacts): FamilyClass {
  if (LIVE_GROUND_OVERRIDES.size) {
    const live = LIVE_GROUND_OVERRIDES.get(`${world}:${f.id}`) ?? LIVE_GROUND_OVERRIDES.get(f.name);
    if (live) return { cls: live, by: 'override', why: 'set from the console this session' };
  }
  const scoped = GROUND_OVERRIDES[`${world}:${f.id}`];
  if (scoped) return { cls: scoped[0], by: 'override', why: scoped[1] };
  const named = Object.prototype.hasOwnProperty.call(GROUND_OVERRIDES, f.name) ? GROUND_OVERRIDES[f.name] : undefined;
  if (named) return { cls: named[0], by: 'override', why: named[1] };
  const byName = nameClass(f);
  const allows = SURFACE_ALLOWS[surfaceWordOf(f.surface)];
  if (allows) {
    if (byName && allows.includes(byName)) return { cls: byName, by: 'surface+name' };
    return { cls: allows[0], by: 'surface' };
  }
  if (byName) return { cls: byName, by: 'name' };
  return { cls: 'dirt', by: 'fallback' };
}

/** A class's four numbers. */
export function responseOf(cls: GroundClass): (typeof GROUND_RESPONSE_CLASSES)[GroundClass] {
  return GROUND_RESPONSE_CLASSES[cls];
}

/**
 * The response table for a world's families, by family id: four bytes each (moves, heals, gives over 3, dust, all
 * 0..255), the layout of the response raster's texels. A family id past `size` is not filed. Answers how many fell
 * to the fallback.
 */
export function fillResponseTable(world: string, families: Iterable<FamilyFacts>, out: Uint8Array): number {
  let fallback = 0;
  const size = out.length >> 2;
  for (const f of families) {
    if (!(f.id >= 0 && f.id < size)) continue;
    const c = classifyFamily(world, f);
    if (c.by === 'fallback') fallback++;
    const r = GROUND_RESPONSE_CLASSES[c.cls];
    out[f.id * 4] = Math.round(r.moves * 255);
    out[f.id * 4 + 1] = Math.round(r.heals * 255);
    out[f.id * 4 + 2] = Math.round(Math.min(1, r.gives / 3) * 255);
    out[f.id * 4 + 3] = Math.round(r.dust * 255);
  }
  return fallback;
}

/**
 * The per-layer lookup for a world's layers, two rows of four bytes a layer: row 0 each layer's family's response
 * (moves, heals, gives, dust: `fillResponseTable`'s layout), row 1 (from wave 2b) its family's colour as the dust
 * takes it (the lighter tones as sRGB bytes, `colour`'s layout by family id, alpha 255 where the family has one), from
 * the tile set's layer list (family id to its children's layers). Into `out` (`layers` texels a row, two rows); a layer
 * no family names is nought (nothing blows over it). Answers how many layers were filed.
 */
export function fillLayerResponse(childLayers: ReadonlyMap<number, readonly number[]>, response: Uint8Array, out: Uint8Array, colour: Uint8Array = new Uint8Array(0)): number {
  out.fill(0);
  const layers = out.length >> 3;
  const families = response.length >> 2;
  const coloured = colour.length >> 2;
  const row = layers * 4;
  let n = 0;
  for (const [family, list] of childLayers) {
    if (!(family >= 0 && family < families)) continue;
    for (const layer of list) {
      if (!(layer >= 0 && layer < layers)) continue;
      for (let c = 0; c < 4; c++) out[layer * 4 + c] = response[family * 4 + c];
      if (family < coloured) for (let c = 0; c < 4; c++) out[row + layer * 4 + c] = colour[family * 4 + c];
      n++;
    }
  }
  return n;
}
