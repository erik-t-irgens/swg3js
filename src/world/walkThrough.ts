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

/**
 * This world's own template rows (Map-maker II's twelfth wave: its removal file's `t:` rows, `src/story/removals.ts`), in
 * force for the world arrived on and over the shared file's: the narrowest row wins (a thing's own, then this world's, then
 * every world's). Set at an arrival and at each landing; empty between worlds.
 */
const worldRowsInForce = new Map<string, boolean>();

/** This world's template rows, set at an arrival and at each landing of its removal file (none: every world reads the shared file alone). */
export function setWorldSolidRows(rows: ReadonlyMap<string, boolean>): void {
  worldRowsInForce.clear();
  for (const [k, v] of rows) worldRowsInForce.set(k, v);
}

/** This world's template rows in force, for the console. */
export function worldSolidRows(): ReadonlyMap<string, boolean> {
  return worldRowsInForce;
}

/** The session's rows, read from the shared file once before the first world. */
export function setSolidRows(rows: ReadonlyMap<string, boolean>): void {
  rowsInForce.clear();
  for (const [k, v] of rows) rowsInForce.set(k, v);
}

/** The rows in force, for the console. */
export function solidRows(): ReadonlyMap<string, boolean> {
  return rowsInForce;
}

/**
 * A template's word: this world's own row first (its removal file's), else the shared file's; `false` walked through, `true`
 * solid, undefined no row (or the rows off). With no world row this is the shared file's word exactly, as before the wave.
 */
export function solidRuleOf(template: string | undefined): boolean | undefined {
  if (!SOLID_TUNE.use || !template) return undefined;
  if (worldRowsInForce.size) {
    const here = worldRowsInForce.get(template);
    if (here !== undefined) return here;
  }
  return rowsInForce.get(template);
}

/**
 * One template's row of the shared file, as the world editor's batch keeps it: the template its id and its word. No `at`: the
 * owner's file carries none, and a row the batch stamped would write one in where an undo must give the file back as it was.
 */
export interface SolidFileRow {
  id: string;
  solid: boolean;
  at?: number;
}

/**
 * The shared file read as rows (the world editor's batch, Map-maker II's twelfth wave): each template's row in the file's own
 * order, its very object kept beside it (`raws`, the template as its `id`), a row that does not read skipped and named, and a
 * file carrying anything but `version` and `everywhere` at its top refused whole (the batch would write over it).
 */
export function readSolidFileRows(text: string, raws?: Record<string, unknown>[]): { rows: SolidFileRow[]; skipped: { id: string; why: string }[]; problem: string | null } {
  const out: { rows: SolidFileRow[]; skipped: { id: string; why: string }[]; problem: string | null } = { rows: [], skipped: [], problem: null };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (err) {
    out.problem = `not JSON (${err instanceof Error ? err.message : String(err)})`;
    return out;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    out.problem = 'not an object';
    return out;
  }
  const o = v as Record<string, unknown>;
  if (o.version !== SOLID_FILE_VERSION) {
    out.problem = `version ${String(o.version)}, where this build reads ${SOLID_FILE_VERSION}`;
    return out;
  }
  const strange = Object.keys(o).filter((k) => k !== 'version' && k !== 'everywhere');
  if (strange.length) {
    out.problem = `it carries ${strange.join(', ')} beside version and everywhere`;
    return out;
  }
  const every = o.everywhere;
  if (!every || typeof every !== 'object' || Array.isArray(every)) {
    out.problem = 'no everywhere scope';
    return out;
  }
  for (const [template, row] of Object.entries(every as Record<string, unknown>)) {
    const r = readSolidFileRow({ ...(row && typeof row === 'object' ? (row as Record<string, unknown>) : {}), id: template });
    if (typeof r === 'string') {
      out.skipped.push({ id: template, why: r });
      continue;
    }
    out.rows.push(r);
    raws?.push({ ...(row as Record<string, unknown>), id: template });
  }
  return out;
}

/** One template's row cleaned (`{ id: <template>, solid }`), or why it is refused. Any other field is the row's own, kept by the batch's extras. */
export function readSolidFileRow(v: Record<string, unknown>): SolidFileRow | string {
  if (typeof v.id !== 'string' || !TEMPLATE.test(v.id)) return 'its key is an object template (object/...iff)';
  if (typeof v.solid !== 'boolean') return 'solid is true or false';
  return { id: v.id, solid: v.solid };
}

/** Whether an id is a template the shared file may key a row by. */
export function isSolidFileId(v: unknown): v is string {
  return typeof v === 'string' && TEMPLATE.test(v);
}

/**
 * The shared file's whole text from its rows, in the order handed (the file's own, a new row after the rest): the owner's
 * file is `JSON.stringify` at one space and a newline, which this writes back byte for byte (each row's own fields but its
 * id, in their own order).
 */
export function solidFileText(rows: readonly Record<string, unknown>[]): string {
  const every: Record<string, unknown> = {};
  for (const r of rows) {
    const { id, ...rest } = r;
    every[String(id)] = rest;
  }
  return `${JSON.stringify({ version: SOLID_FILE_VERSION, everywhere: every }, null, 1)}\n`;
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
