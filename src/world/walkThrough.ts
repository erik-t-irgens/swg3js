// What the client walked through that the placed models' own triangles would make solid here, by two rules: the
// owner's shared file of templates (`public/placements/solid.json`), and the falling water every waterfall model wears.
//
// **The shared file** (the owner, 2026-10-31: "keep all furniture solid and skeletons etc but for the trees and ferns and
// such and floor cables (not tree walls), let's make those walkable"): a template's row in its `everywhere` scope says
// whether every placed copy of it is solid (`solid: false` the plants, the roots, the mushrooms and Echo Base's floor
// cables the lead chose, `A:\swg3js\mapfix\walkable.txt`). It ships with the build like every other placements file, is
// read once a session before the first world (`App.loadSolidFile`), and is asked wherever a collider is made, through the
// streamer's one rule (`collidesByRule`): a thing with a word of its own -- a house, a fitting, a seat of ours, a
// permanent row -- keeps it, and a placed object of the world's with none takes its template's row here, else the size
// rule. The outdoor walk grid's bake reads the same file (`tools/swg/navgrid.mjs`), so the people and creatures walk
// through what the player walks through. Map-maker II's W12 adds the editor over it, a world's own scope and one thing's.
//
// **Falling water** (the owner, 2026-10-31: "i know that the waterfalls shouldn't be collidable though"): a piece of a
// placed model drawn by one of `FALLING_WATER_SHADERS` builds no collider, its rock or its basin staying solid; a model
// that is all falling water is solid nowhere. Named exactly, shader by shader, as the basins are (`BASIN_WATER_SHADERS`).
//
// Pure, node-importable (the walk grid's bake and the tests read it): every import with its `.ts` extension, no enum, no
// namespace, no constructor parameter properties.

/** The shared walk-through file, under the build's `public/`, and the shape it is read as. */
export const SOLID_FILE = 'placements/solid.json';
export const SOLID_FILE_VERSION = 1;

/** A template as the layout writes one: an object template's path under `object/`, ending `.iff`. */
const TEMPLATE = /^object\/[a-z0-9_/.-]+\.iff$/;

/** A read of the shared file: each template's word, in the file's order, or why the file is not read. */
export interface SolidRead {
  rows: Map<string, boolean>;
  problem: string | null;
}

/**
 * The shared file read: `{ version, everywhere: { <template>: { solid: <boolean> } } }`. A row whose template is not one
 * or whose `solid` is not a boolean is passed over; a file of another shape is read as no rows, with why.
 */
export function readSolidFile(text: string): SolidRead {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (err) {
    return { rows: new Map(), problem: `not JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { rows: new Map(), problem: 'not an object' };
  const o = v as Record<string, unknown>;
  if (o.version !== SOLID_FILE_VERSION) return { rows: new Map(), problem: `version ${String(o.version)}, where this build reads ${SOLID_FILE_VERSION}` };
  const every = o.everywhere;
  if (!every || typeof every !== 'object' || Array.isArray(every)) return { rows: new Map(), problem: 'no everywhere scope' };
  const rows = new Map<string, boolean>();
  for (const [template, row] of Object.entries(every as Record<string, unknown>)) {
    if (!TEMPLATE.test(template) || !row || typeof row !== 'object') continue;
    const solid = (row as Record<string, unknown>).solid;
    if (typeof solid === 'boolean') rows.set(template, solid);
  }
  return { rows, problem: null };
}

/**
 * Whether the shared file's rows are asked at all: off puts the rule before them back for every collider made from then
 * on, to compare (`__debug.solid({ use: false })`). Not a number of feel.
 */
export const SOLID_TUNE = { use: true };

/** The rows in force this session (`setSolidRows`), by template. */
const rowsInForce = new Map<string, boolean>();

/** The session's rows, read from the shared file once before the first world. */
export function setSolidRows(rows: ReadonlyMap<string, boolean>): void {
  rowsInForce.clear();
  for (const [k, v] of rows) rowsInForce.set(k, v);
}

/** The rows in force, for the console. */
export function solidRows(): ReadonlyMap<string, boolean> {
  return rowsInForce;
}

/** A template's word in the shared file: `false` walked through, `true` solid, undefined no row (or the file off). */
export function solidRuleOf(template: string | undefined): boolean | undefined {
  if (!SOLID_TUNE.use || !template) return undefined;
  return rowsInForce.get(template);
}

/**
 * The shaders a placed model's falling water is drawn with, measured over every converted pack's placed models
 * (`A:\swg3js\mapfix\scratch\w3\waterfallCensus.txt`): the four scrolling split-alpha falls (`a_splitalpha_scroll`: the
 * statue fountains' streams, the Naboo and Dantooine falls of every width), the whitewater that runs down them, and the
 * Corellian crystal geysers' falling water and its fade. Every one of them is a sheet of water the client's extents
 * left out. Not here: a basin's standing water (`BASIN_WATER_SHADERS`, drawn by the water system), the geysers' bowl
 * water (`rock_crystl_water`), a tank's or a canister's water, and the rock under any of them.
 */
export const FALLING_WATER_SHADERS: ReadonlySet<string> = new Set([
  'shader/waterfall_fountain_fast.sht',
  'shader/waterfall_scroll.sht',
  'shader/waterfall_scroll_fast.sht',
  'shader/waterfall_scroll_slow.sht',
  'shader/whitewater_mesh_aa7.sht',
  'shader/rock_geyser_crystlfall_aa7.sht',
  'shader/rock_geyser_crystlfall_fade_aa7.sht',
]);

/** Whether a converted material's shader is falling water (`FALLING_WATER_SHADERS`), by the shader's name. */
export function isFallingWaterShader(name: string | undefined): boolean {
  return !!name && FALLING_WATER_SHADERS.has(name);
}
