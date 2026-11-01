// Lakes of ours (Map-maker II, DESIGN.md §2.7, its fifth wave): the water file's lakes (`editFiles/waterFile.ts`) made
// into exactly what the game's every water reader already takes, a client lake's table -- a name, an outline in the game's
// frame, a height, a shader key, a water type, a shader size and its box (`SwgWaterTable`'s fields) -- appended after the
// client's own tables, so `SwgTerrain.waterAt` (the higher surface wins) and `waterTableAt` (the earliest on a tie) answer
// for it with nothing changed in any reader, and drawn by the very loop that draws the client's.
//
// **The cell index.** One polygon of 2,000 points costs 3.5 µs a test and the grass asks the rule once a tuft candidate
// [measured r3], so a lake of ours carries, from its arrival, a coarse grid over its box (`LAKE_TUNE.cell`, 16 m): a cell
// no edge's box reaches is wholly in or wholly out, by its middle; a cell some edge reaches answers by the full crossing
// test over the edges whose z-range reaches its row, which is `pointInPolygon` itself with the edges that cannot answer
// left out (an edge whose z-range misses the point's z fails that test's first condition, and the crossings' parity does
// not care about their order), so the index answers exactly as the full test does. A client table carries none
// (`cells` null), and its path is today's.
//
// **Plants under it**: the static flora's affectors know nothing of water, so the planter is handed `underOurWater`, true
// where a lake of ours stands more than `LAKE_TUNE.floraUnder` over the ground at a candidate, and null with no lake at
// all (the planting today's by identity).
//
// **Roofs under it**: the water's depth window answers the higher of the ground and the top of a building with rooms
// standing under a lake of ours (`RoofList`), so the surface over a submerged roof is seen through as much water as stands
// over the roof rather than over the bed; empty with no lake, so the window's answer is today's to the bit.
//
// **Rivers** (the sixth wave): a river of the water file, or one of the terrain's own wet rivers made a row of the same
// shape (`soeRiverRows`), is a strip down its spine built by the client's own ribbon quads (`ribbonQuads`, `gameRibbon`),
// each quad sloped between two points, asked by `ribbonAt`'s own arithmetic through a bucket index (`RIVER_TUNE.bucket`,
// each 16 m cell listing the quads over it) and answered after the lakes by `SwgTerrain.waterAt` (the higher wins) and
// `waterTableAt` (a river's record carrying its surface at the point last asked, so the camera's look names its shader).
// A quad steeper than the river's limit (`fallFrom`, else `RIVER_TUNE.slopeMax`) is a fall: water with the game's own
// fall effects along it (`'effects'`, the owner's default), or no water at all (`'fall'`, `'refuse'`).
//
// The walk grid's bake reads lakes and rivers through this file too (`tools/swg/navgrid.mjs`), so the grid and the drawn
// world agree: it imports the water file's reader and the ribbons, and the release carries all three. Rule for this file
// (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no constructor
// parameter properties.

import type { WaterLakeRow, WaterLookRow, WaterRiverRow } from './editFiles/waterFile.ts';
import { gameRibbon, inTriangle, planeHeight, ribbonQuads, type TerrainRibbon } from '../swg/terrain/ribbons.ts';

/**
 * The lakes' shipped numbers (ours). `cell` is a cost number (the index's grain), never feel; `floraUnder` how much water
 * over the ground takes a plant away; `roofDepth` whether the depth window reads a submerged roof (a switch, to compare).
 * Live through `__debug.lakes({ tune })`; `cell` is read as each lake is made, so a moved cell reaches the next lake made.
 */
export const LAKE_TUNE = {
  cell: 16,
  floraUnder: 0.3,
  roofDepth: true,
};

/** A lake's coarse index (`lakeCells`): its grid's corner and cell, each cell out (0), in (1) or crossed by an edge (2), and each row's edges. */
export interface LakeCells {
  ox: number;
  oz: number;
  size: number;
  nx: number;
  nz: number;
  state: Uint8Array;
  /** Per row of cells, the indices `i` of the edges (`points[i]`, `points[i - 1]`) whose z-range reaches that row. */
  rows: Int32Array[];
}

/** A lake as the game's water readers take a table: `SwgWaterTable`'s fields, its index, and what it is of ours. */
export interface LakeTable {
  name: string;
  points: { x: number; z: number }[];
  height: number;
  shader: string;
  waterType: number;
  shaderSize: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** The index (`lakeCells`); null on every client table. */
  cells: LakeCells | null;
  /** The water file's row it was made from (its id, its look), absent on a client table. */
  ours?: WaterLakeRow;
}

/**
 * The full crossing test, the very arithmetic `SwgTerrain`'s `pointInPolygon` makes (`a` the point, `b` the one before it).
 */
export function pointInLake(x: number, z: number, pts: readonly { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** The crossing test over one row's edges alone (`LakeCells.rows`): `pointInLake` with the edges that cannot answer left out. */
function rowInLake(x: number, z: number, pts: readonly { x: number; z: number }[], edges: Int32Array): boolean {
  let inside = false;
  const n = pts.length;
  for (let e = 0; e < edges.length; e++) {
    const i = edges[e];
    const a = pts[i];
    const b = pts[i === 0 ? n - 1 : i - 1];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** How far past a cell's sides an edge's box must stay to leave the cell uncrossed (metres): conservative, never exact. */
const CELL_PAD = 1e-6;

/**
 * A lake's coarse index over its box at `size` metres a cell (`LAKE_TUNE.cell`). Built once a lake (its arrival, or the
 * moment it lands); a lake of a few points over a small box is no cheaper to index than to test, but the index answers as
 * the full test does whatever its shape, so every lake of ours carries one.
 */
export function lakeCells(points: readonly { x: number; z: number }[], minX: number, maxX: number, minZ: number, maxZ: number, size: number): LakeCells {
  const s = size > 0.5 ? size : 0.5;
  const nx = Math.max(1, Math.ceil((maxX - minX) / s) + 1);
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / s) + 1);
  const state = new Uint8Array(nx * nz);
  const n = points.length;
  const rowsList: number[][] = [];
  for (let j = 0; j < nz; j++) rowsList.push([]);
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[i === 0 ? n - 1 : i - 1];
    const ex0 = Math.min(a.x, b.x) - CELL_PAD;
    const ex1 = Math.max(a.x, b.x) + CELL_PAD;
    const ez0 = Math.min(a.z, b.z) - CELL_PAD;
    const ez1 = Math.max(a.z, b.z) + CELL_PAD;
    const i0 = Math.max(0, Math.floor((ex0 - minX) / s));
    const i1 = Math.min(nx - 1, Math.floor((ex1 - minX) / s));
    const j0 = Math.max(0, Math.floor((ez0 - minZ) / s));
    const j1 = Math.min(nz - 1, Math.floor((ez1 - minZ) / s));
    for (let j = j0; j <= j1; j++) {
      rowsList[j].push(i);
      for (let c = i0; c <= i1; c++) state[j * nx + c] = 2;
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let c = 0; c < nx; c++) {
      const k = j * nx + c;
      if (state[k] === 2) continue;
      state[k] = pointInLake(minX + (c + 0.5) * s, minZ + (j + 0.5) * s, points) ? 1 : 0;
    }
  }
  return { ox: minX, oz: minZ, size: s, nx, nz, state, rows: rowsList.map((r) => Int32Array.from(r)) };
}

/** Whether a point within a lake's box is in it, through its index: exactly `pointInLake`'s answer. */
export function inLakeCells(c: LakeCells, pts: readonly { x: number; z: number }[], x: number, z: number): boolean {
  const i = Math.floor((x - c.ox) / c.size);
  const j = Math.floor((z - c.oz) / c.size);
  if (i < 0 || j < 0 || i >= c.nx || j >= c.nz) return pointInLake(x, z, pts);
  const s = c.state[j * c.nx + i];
  if (s === 0) return false;
  if (s === 1) return true;
  return rowInLake(x, z, pts, c.rows[j]);
}

/**
 * A lake of the water file made a table of the game's frame: its outline turned by `toGameX`, `toGameZ` (the terrain's
 * own mirror on a converted world, `gx = cx - x`, `gz = z - cz`; about (0, 0) on a real-elevation world), its box, its
 * index, and the client's own fields a lake carries (`waterType` 0 water, or 1 where its shader is lava: `lava` answers
 * that from the shader key, as the world's water reading does; `shaderSize` 2, the client's usual repeat).
 */
export function lakeTable(row: WaterLakeRow, toGameX: (x: number) => number, toGameZ: (z: number) => number, lava: (shader: string) => boolean = () => false, cell = LAKE_TUNE.cell): LakeTable {
  const points = row.points.map(([x, z]) => ({ x: toGameX(x), z: toGameZ(z) }));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const shader = row.shader ?? '';
  return { name: `ours:${row.id}`, points, height: row.h, shader, waterType: shader && lava(shader) ? 1 : 0, shaderSize: 2, minX, maxX, minZ, maxZ, cells: lakeCells(points, minX, maxX, minZ, maxZ, cell), ours: row };
}

/** Whether a table covers a point of the game's frame: its box, then its index or the full test. */
export function tableCovers(t: LakeTable, x: number, z: number): boolean {
  if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) return false;
  return t.cells ? inLakeCells(t.cells, t.points, x, z) : pointInLake(x, z, t.points);
}

/** The highest surface of the tables covering a point (the higher wins), or -Infinity: the rule a lake list answers by. */
export function surfaceOf(tables: readonly LakeTable[], x: number, z: number, from = -Infinity): number {
  let h = from;
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    if (t.height > h && tableCovers(t, x, z)) h = t.height;
  }
  return h;
}

/** The highest table covering a point (the earliest on a tie), or null: `SwgTerrain.waterTableAt`'s rule over a list. */
export function tableOf(tables: readonly LakeTable[], x: number, z: number): LakeTable | null {
  let best: LakeTable | null = null;
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    if (best && t.height <= best.height) continue;
    if (tableCovers(t, x, z)) best = t;
  }
  return best;
}

/**
 * Whether a planting at a point of the game's frame stands under a lake of ours: more than `LAKE_TUNE.floraUnder` of its
 * water over the ground there. The planter's predicate (`FloraPlanter.underOurWater`), which is null with no lake at all.
 */
export function underLakes(tables: readonly LakeTable[], x: number, z: number, ground: number): boolean {
  const s = surfaceOf(tables, x, z);
  return s > -Infinity && s - ground > LAKE_TUNE.floraUnder;
}

/**
 * What a landing of the water file's rows comes to (`World.landWater`, a write's answer or the file read again): the lakes in
 * force after it, sorted by id (the file's own order), and the ids that moved -- each one taken out or put, whatever it put
 * -- every one of which is taken out and stood again by difference, while a lake that did not move keeps its body as it
 * stands. Pure, so the live path's difference is a test's to run.
 */
export function planLakeLanding<R extends { id: string }>(was: readonly R[], put: readonly R[], deleted: readonly string[]): { rows: R[]; moved: Set<string> } {
  const byId = new Map<string, R>();
  for (const r of was) byId.set(r.id, r);
  const moved = new Set<string>();
  for (const id of deleted) if (byId.delete(id)) moved.add(id);
  for (const r of put) {
    byId.set(r.id, r);
    moved.add(r.id);
  }
  return { rows: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), moved };
}

/**
 * The lakes' tables after a landing: for every row in force, the very table it had before where its row is the same object
 * and its id did not move (`planLakeLanding` keeps an unmoved lake's row object), else one made afresh (`make`, null for a
 * row left out). Every reader that knows a table by itself -- the lava's set (`World.lavaTables`, tested by identity), the
 * camera's look cache, a body's record -- keeps knowing an unmoved lake across another's landing.
 */
export function keptTables<T extends { ours?: object }, R extends { id: string }>(prev: readonly T[], rows: readonly R[], moved: ReadonlySet<string> | null, make: (row: R) => T | null): T[] {
  const byRow = new Map<object, T>();
  for (const t of prev) if (t.ours) byRow.set(t.ours, t);
  const out: T[] = [];
  for (const row of rows) {
    const had = moved && moved.has(row.id) ? undefined : byRow.get(row);
    const t = had ?? make(row);
    if (t) out.push(t);
  }
  return out;
}

/**
 * Whether a landing of these rows makes the lava again (`World.waterLandingTouchesLava`): a lake put whose shader is lava
 * here (`isLava`), or a lake put or taken out whose table stands as lava now (water type 1 among `tables`, the lakes of ours
 * in force) -- a lava lake moved, made water or taken out, which an undo or a redo does as well as the tool.
 */
export function landingTouchesLava(tables: readonly LakeTable[], put: readonly { id: string; shader: string | null }[], deleted: readonly string[], isLava: (shader: string) => boolean): boolean {
  for (const r of put) if (r.shader && isLava(r.shader)) return true;
  const ids = new Set<string>(deleted);
  for (const r of put) ids.add(r.id);
  for (const t of tables) if (t.ours && ids.has(t.ours.id) && t.waterType === 1) return true;
  return false;
}

/** A lake's look of its own laid over the look its shader or the planet gives it: each number the row names, the rest as given. */
export function lookOver<L extends { color: string; opacity: number; ripple: number; drift: number }>(base: L, own: WaterLookRow | undefined): L {
  if (!own) return base;
  return { ...base, color: own.color ?? base.color, opacity: own.opacity ?? base.opacity, ripple: own.ripple ?? base.ripple, drift: own.drift ?? base.drift };
}

/** One submerged roof: a building with rooms under a lake of ours, its turned box on the ground and its top. */
export interface Roof {
  x: number;
  z: number;
  hx: number;
  hz: number;
  cos: number;
  sin: number;
  top: number;
}

/**
 * The roofs the water's depth window reads (`World`'s depth callback): kept records, written afresh as lakes land and as
 * the streamer stands buildings. `topAt` answers the higher of the ground and a roof's top inside its box, and with no roof
 * the ground itself, the very value handed in.
 */
export class RoofList {
  readonly list: Roof[] = [];
  count = 0;

  /** Every roof let go (the records kept for the next). */
  clear(): void {
    this.count = 0;
  }

  /** One roof written into the next kept record. */
  add(x: number, z: number, hx: number, hz: number, cos: number, sin: number, top: number): void {
    let r = this.list[this.count];
    if (!r) this.list.push((r = { x: 0.5, z: 0.5, hx: 0.5, hz: 0.5, cos: 1, sin: 0.5, top: 0.5 }));
    r.x = x;
    r.z = z;
    r.hx = hx;
    r.hz = hz;
    r.cos = cos;
    r.sin = sin;
    r.top = top;
    this.count++;
  }

  /**
   * A building with rooms kept as a roof where its top stands under `surface` (the water over its origin; a building whose
   * top stands at or over it is no roof under water): its own box (`box`, the model's, either corner first) through its
   * matrix (`e`, column-major as three keeps it, turned only about up): the box's middle carried there, its half sizes, the
   * turn read off the matrix's first column on the ground (three's own sense: local (x, z) at (x cos + z sin, -x sin + z
   * cos), so the record's `sin` is minus the turn's), and its top. Answers whether it was kept. `World.refreshRoofs` asks it
   * of every building standing.
   */
  addBuilding(e: ArrayLike<number>, box: { min: readonly number[]; max: readonly number[] }, surface: number): boolean {
    const x = e[12];
    const y = e[13];
    const z = e[14];
    const top = y + Math.max(box.min[1], box.max[1]);
    if (!(surface > top)) return false;
    const mx = (box.min[0] + box.max[0]) / 2;
    const mz = (box.min[2] + box.max[2]) / 2;
    const l = Math.sqrt(e[0] * e[0] + e[2] * e[2]) || 1;
    const cos = e[0] / l;
    const sin = e[2] / l;
    this.add(x + mx * cos - mz * sin, z + mx * sin + mz * cos, Math.abs(box.max[0] - box.min[0]) / 2, Math.abs(box.max[2] - box.min[2]) / 2, cos, sin, top);
    return true;
  }

  /** The higher of `ground` and the top of a roof whose box holds the point; `ground` itself with none. */
  topAt(x: number, z: number, ground: number): number {
    let h = ground;
    for (let i = 0; i < this.count; i++) {
      const r = this.list[i];
      if (!(r.top > h)) continue;
      const dx = x - r.x;
      const dz = z - r.z;
      const u = dx * r.cos + dz * r.sin;
      const v = -dx * r.sin + dz * r.cos;
      if (u >= -r.hx && u <= r.hx && v >= -r.hz && v <= r.hz) h = r.top;
    }
    return h;
  }
}

// ---- Rivers (the sixth wave) ----------------------------------------------------------------------------------------------

/** What a reach steeper than its river's limit is (`RIVER_TUNE.steep`). */
export type RiverSteep = 'effects' | 'fall' | 'refuse';

/** The three answers, for the console and the Tools tab. */
export const RIVER_STEEP: readonly RiverSteep[] = ['effects', 'fall', 'refuse'];

/**
 * The rivers' shipped numbers (ours, every one; the owner's to move by hand, never chosen by measuring), live through
 * `__debug.rivers({ tune })` and the `rivers` dials.
 * - `slopeMax`: degrees past which a reach between two points is a fall rather than water (12: the water's surface keeps the
 *   level normal, `water.ts`, so a steep run is lit as level water; SOE's own test river runs at up to about 15). A river's
 *   own `fallFrom` wins over it.
 * - `steep`: what a reach past it is (the owner's amendment of 2026-10-31): `'effects'` water with the game's own fall effects
 *   standing along it and at its foot; `'fall'` cut out of the water, the editor writing a fall row there (W5's fall); `'refuse'`
 *   cut out of the water and said.
 * - `flow`: a multiplier on every river's velocity as its detail drifts (1: the river's own), rewritten into each reach's
 *   `uWind` live.
 * - `effectEvery`: metres along a steep stretch between its banks' sprays; `bigDrop`: a drop past which its foot stands the
 *   200 m fall's spray and mist rather than the small fall's; `effectsMost`: the most effects one river stands.
 * - The drop scales them too: each effect's placement is scaled by its stretch's drop over the drop its file was made for
 *   (`smallRef` for the small fall's, `bigRef` for the 200 m fall's), held to `scaleLeast`..`scaleMost` and times
 *   `effectScale`. A placement's scale spreads where the particles start and how fast they leave (the emitter's frame); the
 *   particles' own sizes are the file's (the particle system scales a particle by its file alone).
 * - `bucket` (a cost: the index's cell, metres) and `spacingMin` (a rule: two points of a spine nearer than this are merged
 *   as it is written, `mergeClosePoints`), neither feel.
 */
export const RIVER_TUNE = {
  slopeMax: 12,
  steep: 'effects' as RiverSteep,
  flow: 1,
  effectEvery: 10,
  bigDrop: 20,
  effectsMost: 40,
  effectScale: 1,
  smallRef: 10,
  bigRef: 200,
  scaleLeast: 0.5,
  scaleMost: 3,
  bucket: 16,
  spacingMin: 4,
};

/** The keys of `RIVER_TUNE` that are another river's tool's (the editor's `WATER_TUNE`), passed over by `tuneRiverTune`. */
const RIVER_TOOL_KEYS = new Set(['riverWidth', 'riverVelocity', 'riverRise', 'riverHeights']);

/**
 * What a move of `RIVER_TUNE` asks of the rivers standing (`World.retuneRivers`): `'flow'` each reach's wind written again
 * in place (a uniform); `'effects'` the fall effects stood again, every table and body kept (the stretches are the slope
 * limit's, never the effects' numbers); `'shape'` every river's table made again, a river's bodies taken out and stood
 * again only where its water moved (`riverRetunePlan`), and the effects stood again.
 */
export type RiverRetune = 'flow' | 'effects' | 'shape';

/** The keys of `RIVER_TUNE` that reach the fall effects alone (`riverEffects`, `effectScaleOf`): no table or body moves. */
const RIVER_EFFECT_KEYS = new Set(['effectEvery', 'bigDrop', 'effectsMost', 'effectScale', 'smallRef', 'bigRef', 'scaleLeast', 'scaleMost']);

/**
 * `__debug.rivers({ tune })`'s half for `RIVER_TUNE`: each number written where it is a finite number (held to sense), `steep`
 * only as one of its three; the editor's own river numbers (`riverWidth` and the rest) passed over for its caller; anything
 * else said. Then `retune('shape')` where anything that shapes a table moved (the slope limit, what a steep reach is, the
 * index's cell), else `retune('effects')` where only the effects' numbers did, and `retune('flow')` where the flow did (after
 * a shape too: a river whose water did not move keeps its bodies and their winds); `spacingMin` reaches the next write and
 * the terrain's rivers at the next arrival, and asks nothing now. Answers what was said.
 */
export function tuneRiverTune(tune: Record<string, unknown>, retune: (what: RiverRetune) => void): string[] {
  const said: string[] = [];
  let shape = false;
  let effects = false;
  let flow = false;
  const t = RIVER_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(tune)) {
    if (RIVER_TOOL_KEYS.has(k)) continue;
    if (k === 'steep') {
      if (typeof v === 'string' && (RIVER_STEEP as readonly string[]).includes(v)) {
        if (RIVER_TUNE.steep !== v) shape = true;
        RIVER_TUNE.steep = v as RiverSteep;
      } else said.push(`steep is one of ${RIVER_STEEP.join(', ')}`);
      continue;
    }
    if (!(k in RIVER_TUNE)) {
      said.push(`${k} is none of the rivers' numbers (${Object.keys(RIVER_TUNE).join(', ')})`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`${k} takes a number`);
      continue;
    }
    if (t[k] === v) continue;
    t[k] = v;
    if (k === 'flow') flow = true;
    else if (RIVER_EFFECT_KEYS.has(k)) effects = true;
    else if (k !== 'spacingMin') shape = true;
  }
  RIVER_TUNE.slopeMax = Math.min(89, Math.max(0, RIVER_TUNE.slopeMax));
  RIVER_TUNE.bucket = Math.max(0.5, RIVER_TUNE.bucket);
  RIVER_TUNE.spacingMin = Math.max(0, RIVER_TUNE.spacingMin);
  RIVER_TUNE.effectEvery = Math.max(0.5, RIVER_TUNE.effectEvery);
  RIVER_TUNE.bigDrop = Math.max(0, RIVER_TUNE.bigDrop);
  RIVER_TUNE.effectsMost = Math.max(0, Math.round(RIVER_TUNE.effectsMost));
  RIVER_TUNE.effectScale = Math.max(0.01, RIVER_TUNE.effectScale);
  RIVER_TUNE.smallRef = Math.max(0.1, RIVER_TUNE.smallRef);
  RIVER_TUNE.bigRef = Math.max(0.1, RIVER_TUNE.bigRef);
  RIVER_TUNE.scaleLeast = Math.max(0.01, RIVER_TUNE.scaleLeast);
  RIVER_TUNE.scaleMost = Math.max(RIVER_TUNE.scaleLeast, RIVER_TUNE.scaleMost);
  if (shape) retune('shape');
  else if (effects) retune('effects');
  if (flow) retune('flow');
  return said;
}

/** A straight run of a river's water quads, drawn as one body with its own `uWind`. */
export interface RiverReach {
  /** Its first and last quads. */
  first: number;
  last: number;
  /** Its way downstream on the ground, a unit, in the game's frame. */
  runX: number;
  runZ: number;
  /** The steepest of its quads, degrees. */
  slope: number;
}

/** A run of quads steeper than the river's limit: where its fall effects stand, or where it is cut out of the water. */
export interface RiverStretch {
  first: number;
  last: number;
  /** Its higher end and its foot on the spine, in the game's frame, at the water's surface there. */
  top: { x: number; y: number; z: number };
  foot: { x: number; y: number; z: number };
  /** Metres it drops, metres it runs over the ground, and the steepest of its quads in degrees. */
  drop: number;
  length: number;
  slope: number;
  /** Its way from its top toward its foot on the ground, a unit. */
  runX: number;
  runZ: number;
}

/** A river's strip: every quad of its ribbon in the game's frame, what each is, its reaches, its stretches and its index. */
export interface RiverShape {
  width: number;
  velocity: number;
  /** The slope limit it was made with, degrees, and what a quad past it is. */
  limit: number;
  steep: RiverSteep;
  /** Four corners a quad (x, y, z each), the client's order (`ribbonQuads`). */
  quads: Float64Array;
  /** Each quad's run, x and z, a unit (downstream from the first point toward the last). */
  runs: Float64Array;
  /** Each quad's box on the ground: min x, max x, min z, max z. */
  quadBounds: Float64Array;
  /** Each quad's slope between its two ends, degrees. */
  slopes: Float64Array;
  /** 1 where a quad is water, 0 where it is a fall cut out (`'fall'`, `'refuse'`). */
  water: Uint8Array;
  /** The highest surface of its water quads (-Infinity with none): a point higher than it needs no test. */
  top: number;
  reaches: RiverReach[];
  stretches: RiverStretch[];
  /** The spine in the game's frame, x, h, z a point. */
  spine: Float64Array;
  /** The bucket index over its water quads: its corner, its cell, its cells across and along. */
  ox: number;
  oz: number;
  size: number;
  nx: number;
  nz: number;
  /** Each cell's first entry in `list`, one more than the cells (the last is the list's end). */
  start: Int32Array;
  /** The water quads over each cell, in quad order. */
  list: Int32Array;
}

/**
 * A river as the game's water readers take it: `SwgWaterTable`'s fields, so `waterTableAt` may answer with it, its `height`
 * written with its surface at the point last asked (`riverTableAt`); its strip; and what it is of ours or the terrain's.
 */
export interface RiverTable {
  name: string;
  /** None: a river has no outline, and every reader of an outline walks the lakes alone. */
  points: { x: number; z: number }[];
  height: number;
  shader: string;
  waterType: number;
  shaderSize: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cells: null;
  /** The water file's row a river of ours was made from; absent on the terrain's own. */
  ours?: WaterRiverRow;
  /** The terrain's own river this is (`soeRiverRows`'s id), absent on ours. */
  soe?: string;
  river: RiverShape;
}

/** The most cells a river's index holds: a longer river's cell grows past `RIVER_TUNE.bucket` to keep under it. */
const RIVER_CELLS_MOST = 1 << 20;

/**
 * A river row made a table of the game's frame: its spine built into the client's own ribbon quads in the row's raw frame
 * (`ribbonQuads`) and carried into the game's (`gameRibbon`, as the terrain's ribbons are, so each quad is split along the
 * very diagonal the client split it along), each quad's slope worked out, the quads past the limit cut out of the water
 * unless the steep reach stays water (`'effects'`), the reaches and the steep stretches found, and its bucket index made.
 * `soe` names the terrain's own river it is (absent: one of ours, whose row is `ours`).
 */
export function riverTable(row: WaterRiverRow, toGameX: (x: number) => number, toGameZ: (z: number) => number, soe?: string, tune = RIVER_TUNE): RiverTable {
  const raw = row.points.map(([x, z, h]) => ({ x, z, h }));
  const { quads, runs } = ribbonQuads(raw, row.width);
  const shader = row.shader ?? '';
  const stub: TerrainRibbon = { version: 5, points: raw, width: row.width, shaderSize: 2, velocity: row.velocity, capWidth: 0, familyId: 0, featherFunction: 0, featherDistance: 0, shader, waterType: 0, name: row.id, quads, runs, cap: null, capHeight: 0 };
  const g = gameRibbon(stub, toGameX, toGameZ);
  const q = g.quads;
  const nq = q.length / 12;
  const limit = typeof row.fallFrom === 'number' ? row.fallFrom : tune.slopeMax;
  const steep = tune.steep;
  const slopes = new Float64Array(nq);
  const water = new Uint8Array(nq);
  const lengths = new Float64Array(nq);
  for (let i = 0; i < nq; i++) {
    const o = i * 12;
    // From the middle of its first end to the middle of its second, each end at its own height.
    const dx = (q[o + 6] + q[o + 9]) / 2 - (q[o] + q[o + 3]) / 2;
    const dz = (q[o + 8] + q[o + 11]) / 2 - (q[o + 2] + q[o + 5]) / 2;
    const len = Math.sqrt(dx * dx + dz * dz);
    const dh = Math.abs(q[o + 7] - q[o + 1]);
    lengths[i] = len;
    slopes[i] = dh > 0 ? (Math.atan2(dh, len) * 180) / Math.PI : 0;
    water[i] = slopes[i] > limit && steep !== 'effects' ? 0 : 1;
  }
  // The box and the highest surface over the water quads alone.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let top = -Infinity;
  for (let i = 0; i < nq; i++) {
    if (!water[i]) continue;
    const b = i * 4;
    if (g.quadBounds[b] < minX) minX = g.quadBounds[b];
    if (g.quadBounds[b + 1] > maxX) maxX = g.quadBounds[b + 1];
    if (g.quadBounds[b + 2] < minZ) minZ = g.quadBounds[b + 2];
    if (g.quadBounds[b + 3] > maxZ) maxZ = g.quadBounds[b + 3];
    const h = Math.max(q[i * 12 + 1], q[i * 12 + 7]);
    if (h > top) top = h;
  }
  // The reaches: straight runs of water quads, a new one where the way turns or the water is cut.
  const reaches: RiverReach[] = [];
  for (let i = 0; i < nq; i++) {
    if (!water[i]) continue;
    const rx = g.runs[i * 2];
    const rz = g.runs[i * 2 + 1];
    const cur = reaches[reaches.length - 1];
    if (cur && cur.last === i - 1 && cur.runX * rx + cur.runZ * rz >= 0.9999) {
      cur.last = i;
      if (slopes[i] > cur.slope) cur.slope = slopes[i];
    } else reaches.push({ first: i, last: i, runX: rx, runZ: rz, slope: slopes[i] });
  }
  // The steep stretches: runs of quads past the limit, whatever becomes of them.
  const stretches: RiverStretch[] = [];
  for (let i = 0; i < nq; i++) {
    if (!(slopes[i] > limit)) continue;
    const cur = stretches[stretches.length - 1];
    if (cur && cur.last === i - 1) {
      cur.last = i;
      continue;
    }
    stretches.push({ first: i, last: i, top: { x: 0, y: 0, z: 0 }, foot: { x: 0, y: 0, z: 0 }, drop: 0, length: 0, slope: 0, runX: 0, runZ: 0 });
  }
  for (const s of stretches) {
    const a = s.first * 12;
    const b = s.last * 12;
    const start = { x: (q[a] + q[a + 3]) / 2, y: q[a + 1], z: (q[a + 2] + q[a + 5]) / 2 };
    const end = { x: (q[b + 6] + q[b + 9]) / 2, y: q[b + 7], z: (q[b + 8] + q[b + 11]) / 2 };
    const hiFirst = start.y >= end.y;
    s.top = hiFirst ? start : end;
    s.foot = hiFirst ? end : start;
    s.drop = Math.abs(start.y - end.y);
    for (let i = s.first; i <= s.last; i++) {
      s.length += lengths[i];
      if (slopes[i] > s.slope) s.slope = slopes[i];
    }
    const dx = s.foot.x - s.top.x;
    const dz = s.foot.z - s.top.z;
    const l = Math.sqrt(dx * dx + dz * dz);
    s.runX = l > 0 ? dx / l : g.runs[s.first * 2];
    s.runZ = l > 0 ? dz / l : g.runs[s.first * 2 + 1];
  }
  // The bucket index over the water quads (a cell grown past `bucket` where the river's box is very large).
  let size = tune.bucket > 0.5 ? tune.bucket : 0.5;
  const w = maxX - minX;
  const d = maxZ - minZ;
  if (Number.isFinite(w) && Number.isFinite(d) && ((w / size + 1) * (d / size + 1)) > RIVER_CELLS_MOST) size = Math.sqrt(((w + size) * (d + size)) / RIVER_CELLS_MOST) + 1;
  const nx = Number.isFinite(w) ? Math.max(1, Math.ceil(w / size) + 1) : 0;
  const nz = Number.isFinite(d) ? Math.max(1, Math.ceil(d / size) + 1) : 0;
  const counts = new Int32Array(nx * nz + 1);
  const cellsOf = (i: number, visit: (k: number) => void): void => {
    const b = i * 4;
    const i0 = Math.max(0, Math.floor((g.quadBounds[b] - minX) / size));
    const i1 = Math.min(nx - 1, Math.floor((g.quadBounds[b + 1] - minX) / size));
    const j0 = Math.max(0, Math.floor((g.quadBounds[b + 2] - minZ) / size));
    const j1 = Math.min(nz - 1, Math.floor((g.quadBounds[b + 3] - minZ) / size));
    for (let j = j0; j <= j1; j++) for (let c = i0; c <= i1; c++) visit(j * nx + c);
  };
  for (let i = 0; i < nq; i++) if (water[i]) cellsOf(i, (k) => counts[k + 1]++);
  for (let k = 0; k < nx * nz; k++) counts[k + 1] += counts[k];
  const list = new Int32Array(nx * nz ? counts[nx * nz] : 0);
  const fill = counts.slice(0, Math.max(0, nx * nz));
  for (let i = 0; i < nq; i++) if (water[i]) cellsOf(i, (k) => (list[fill[k]++] = i));
  const spine = new Float64Array(raw.length * 3);
  for (let i = 0; i < raw.length; i++) {
    spine[i * 3] = toGameX(raw[i].x);
    spine[i * 3 + 1] = raw[i].h;
    spine[i * 3 + 2] = toGameZ(raw[i].z);
  }
  const river: RiverShape = { width: row.width, velocity: row.velocity, limit, steep, quads: q, runs: g.runs, quadBounds: g.quadBounds, slopes, water, top, reaches, stretches, spine, ox: minX, oz: minZ, size, nx, nz, start: counts, list };
  return { name: soe ? `soe:${soe}` : `ours:${row.id}`, points: [], height: top, shader, waterType: 0, shaderSize: 2, minX, maxX, minZ, maxZ, cells: null, ...(soe ? { soe } : { ours: row }), river };
}

/** What `riverScan` found: the surface, the river's place in the list and the quad. Kept: nothing is made a call. */
export interface RiverHit {
  h: number;
  table: number;
  quad: number;
}

/** A kept hit for the readers below, which answer at once (never across another call). */
const SCAN: RiverHit = { h: 0.5, table: -1, quad: -1 };

/**
 * The highest water quad of any river in `list` over a game point and higher than `from`, by `ribbonAt`'s own arithmetic
 * (each quad's two triangles, the client's split, the height on the plane through each), through each river's box, its
 * highest surface and its bucket index: writes `out` and answers whether one was found. Allocates nothing.
 */
export function riverScan(list: readonly RiverTable[], x: number, z: number, from: number, out: RiverHit): boolean {
  let best = from;
  let found = false;
  for (let r = 0; r < list.length; r++) {
    const t = list[r];
    if (t.river.top <= best || x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue;
    const s = t.river;
    const ci = Math.floor((x - s.ox) / s.size);
    const cj = Math.floor((z - s.oz) / s.size);
    if (ci < 0 || cj < 0 || ci >= s.nx || cj >= s.nz) continue;
    const k = cj * s.nx + ci;
    const q = s.quads;
    const qb = s.quadBounds;
    for (let e = s.start[k]; e < s.start[k + 1]; e++) {
      const i = s.list[e];
      const b = i * 4;
      if (x < qb[b] || x > qb[b + 1] || z < qb[b + 2] || z > qb[b + 3]) continue;
      const o = i * 12;
      const in1 = inTriangle(x, z, q[o], q[o + 2], q[o + 3], q[o + 5], q[o + 6], q[o + 8]);
      const in2 = !in1 && inTriangle(x, z, q[o], q[o + 2], q[o + 6], q[o + 8], q[o + 9], q[o + 11]);
      if (!in1 && !in2) continue;
      const v1 = in1 ? 3 : 9;
      const h = planeHeight(x, z, q[o], q[o + 1], q[o + 2], q[o + v1], q[o + v1 + 1], q[o + v1 + 2], q[o + 6], q[o + 7], q[o + 8]);
      if (!Number.isFinite(h) || h <= best) continue;
      best = h;
      found = true;
      out.h = h;
      out.table = r;
      out.quad = i;
    }
  }
  return found;
}

/** The higher of `from` and the highest river surface over a game point: what `waterAt` takes after the lakes. */
export function riversSurface(list: readonly RiverTable[], x: number, z: number, from: number): number {
  return riverScan(list, x, z, from, SCAN) ? SCAN.h : from;
}

/**
 * The river standing higher than `best` (a lake's table, or null) over a game point, its `height` written with its surface
 * there, or `best` itself: `waterTableAt` after the lakes (the earliest on a tie, so a lake at the same height wins).
 */
export function riverTableAt<T extends { height: number }>(list: readonly RiverTable[], x: number, z: number, best: T | null): T | RiverTable | null {
  if (!riverScan(list, x, z, best ? best.height : -Infinity, SCAN)) return best;
  const t = list[SCAN.table];
  t.height = SCAN.h;
  return t;
}

/** A river's flow over a game point (`riverFlowAt`): its surface, and its run times its velocity, metres a second. */
export interface RiverFlow {
  h: number;
  fx: number;
  fz: number;
}

/** The highest river over a game point, its surface and its flow written into `out` (the liquid's feed); false with none. */
export function riverFlowAt(list: readonly RiverTable[], x: number, z: number, out: RiverFlow): boolean {
  if (!riverScan(list, x, z, -Infinity, SCAN)) return false;
  const s = list[SCAN.table].river;
  out.h = SCAN.h;
  out.fx = s.runs[SCAN.quad * 2] * s.velocity;
  out.fz = s.runs[SCAN.quad * 2 + 1] * s.velocity;
  return true;
}

/**
 * The air's ground sample fed a river's flow (`World.airGround`, the moving air's liquid tile pulling toward it as toward a
 * lava ribbon's): where the sample is water (`medium` 2) and the highest river over the point is the very surface the
 * water is there (`water`, a lake or the sea standing higher wins), its run times its velocity, m/s; nothing written
 * anywhere else, nor with no river at all. `hit` is the caller's kept record. Allocates nothing.
 */
export function feedRiverFlow(list: readonly RiverTable[], x: number, z: number, water: number, out: { medium: number; flowX: number; flowZ: number }, hit: RiverFlow): void {
  if (out.medium !== 2 || !list.length || !riverFlowAt(list, x, z, hit) || hit.h !== water) return;
  out.flowX = hit.fx;
  out.flowZ = hit.fz;
}

/** Whether a planting at a game point stands under a river: more than `LAKE_TUNE.floraUnder` of its water over the ground. */
export function underRivers(list: readonly RiverTable[], x: number, z: number, ground: number): boolean {
  const s = riversSurface(list, x, z, -Infinity);
  return s > -Infinity && s - ground > LAKE_TUNE.floraUnder;
}

/**
 * One effect a steep stretch stands (`riverEffects`): which, where, the way it faces (a turn about up, three's sense), and
 * the scale its placement takes from its stretch's drop.
 */
export interface RiverEffect {
  kind: 'spray' | 'mist' | 'sprayBig' | 'mistBig';
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** The scale a steep stretch's drop gives its effects: the drop over the one their file was made for, held, times the tune's. */
export function effectScaleOf(drop: number, big: boolean, tune = RIVER_TUNE): number {
  const ref = big ? tune.bigRef : tune.smallRef;
  const s = drop / (ref > 0.1 ? ref : 0.1);
  const held = s < tune.scaleLeast ? tune.scaleLeast : s > tune.scaleMost ? tune.scaleMost : s;
  return held * tune.effectScale;
}

/**
 * The game's own fall effects a river's steep stretches stand while they stay water (`'effects'`): at each stretch's foot a
 * spray and a mist (the 200 m fall's past `bigDrop`, else the small fall's), and along it a spray at each bank every
 * `effectEvery` metres; at most `effectsMost` in all; each scaled by the stretch's drop (`effectScaleOf`). Every stretch's
 * foot is stood first, in spine order, and only then the banks' sprays, a pair at a time round the stretches in turn (the
 * first pair of each, then the second of each, ...), so a cap reached leaves no stretch with nothing while an earlier one
 * has its whole length lined (how many stand is the owner's number; which stretches go without is the rule's). None for a
 * river whose steep quads are cut out (`'fall'`, `'refuse'`). Pure: the world places them.
 */
export function riverEffects(t: RiverTable, tune = RIVER_TUNE): RiverEffect[] {
  const s = t.river;
  const out: RiverEffect[] = [];
  if (s.steep !== 'effects') return out;
  const most = Math.max(0, Math.floor(tune.effectsMost));
  const q = s.quads;
  const half = s.width / 2;
  const every = tune.effectEvery > 0.5 ? tune.effectEvery : 0.5;
  // Each stretch's banks' sprays, worked out before any is stood (never more of one stretch's than the cap could take).
  const banks: RiverEffect[][] = [];
  for (const st of s.stretches) {
    if (out.length >= most) break;
    const yaw = Math.atan2(st.runX, st.runZ);
    const big = st.drop >= tune.bigDrop;
    const scale = effectScaleOf(st.drop, big, tune);
    // The banks' sprays are the small fall's, scaled by the stretch's drop as the small fall's are.
    const bank = effectScaleOf(st.drop, false, tune);
    out.push({ kind: big ? 'sprayBig' : 'spray', x: st.foot.x, y: st.foot.y, z: st.foot.z, yaw, scale });
    if (out.length < most) out.push({ kind: big ? 'mistBig' : 'mist', x: st.foot.x, y: st.foot.y, z: st.foot.z, yaw, scale });
    // Along the stretch, from its first quad to its last, a spray at each bank every `every` metres (the first half a step in).
    const pairs: RiverEffect[] = [];
    let walked = 0;
    let next = every / 2;
    for (let i = st.first; i <= st.last && pairs.length < most; i++) {
      const o = i * 12;
      const ax = (q[o] + q[o + 3]) / 2;
      const az = (q[o + 2] + q[o + 5]) / 2;
      const bx = (q[o + 6] + q[o + 9]) / 2;
      const bz = (q[o + 8] + q[o + 11]) / 2;
      const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
      const nx = s.runs[i * 2 + 1];
      const nz = -s.runs[i * 2];
      while (next <= walked + len && pairs.length < most) {
        const f = len > 0 ? (next - walked) / len : 0;
        const x = ax + (bx - ax) * f;
        const z = az + (bz - az) * f;
        const y = q[o + 1] + (q[o + 7] - q[o + 1]) * f;
        pairs.push({ kind: 'spray', x: x + nx * half, y, z: z + nz * half, yaw, scale: bank });
        pairs.push({ kind: 'spray', x: x - nx * half, y, z: z - nz * half, yaw, scale: bank });
        next += every;
      }
      walked += len;
    }
    banks.push(pairs);
  }
  // The banks, a pair of each stretch's in turn, until the cap or every stretch's sprays are stood.
  for (let p = 0; out.length < most; p += 2) {
    let any = false;
    for (const pairs of banks) {
      if (p >= pairs.length) continue;
      any = true;
      out.push(pairs[p]);
      if (out.length < most) out.push(pairs[p + 1]);
      if (out.length >= most) break;
    }
    if (!any) break;
  }
  return out;
}

/**
 * What the world hands a river effects' sync (`RiverEffectsKeeper.sync`): a file made ready (its textures uploaded; whether
 * it loaded), one effect stood from a file (its handle), one taken away, and whether the world the sync began in is still
 * the one in force (its load, its particles).
 */
export interface RiverFxHost<H> {
  prepare(file: string): Promise<boolean>;
  place(file: string, e: RiverEffect): H;
  remove(h: H): void;
  still(): boolean;
}

/** What a sync stood: the effects placed, the files that loaded and the kinds whose file did not. */
export interface RiverFxStood {
  placed: number;
  files: number;
  missing: string[];
}

/**
 * The rivers' fall effects standing, by river, and the one way they are stood again (`sync`), which every landing, retune and
 * arrival goes through. A sync takes every effect standing away, makes each kind's file ready (an await each), then stands
 * the rivers' effects; a sync begun while another waits overtakes it (`gen`, moved by every sync begun and every `forget`),
 * and the one overtaken stands nothing, so two syncs that overlap -- a slider dragged while a file is fetched, a file landing
 * late while the arrival's own sync waits -- leave one set standing, never two with the first out of reach.
 */
export class RiverEffectsKeeper<H> {
  /** Each river's effects standing, by its table's name. */
  readonly byRiver = new Map<string, H[]>();
  /** The sync in force: one begun with any other number stands nothing. */
  private gen = 0;

  /** Every effect let go of with nothing taken away (the world going, its particles with it), and a sync in flight overtaken. */
  forget(): void {
    this.gen++;
    this.byRiver.clear();
  }

  /** How many effects stand, over every river. */
  get count(): number {
    let n = 0;
    for (const list of this.byRiver.values()) n += list.length;
    return n;
  }

  /**
   * Every effect standing taken away, then the `tables`' fall effects (`riverEffects`) stood from `files` by kind through
   * `host`. Answers what it stood, or null where nothing was to be done (no host, no river) or where it was overtaken by a
   * newer sync or its world went while it waited, in which case it stood nothing.
   */
  async sync(tables: readonly RiverTable[], files: Readonly<Record<RiverEffect['kind'], string>>, host: RiverFxHost<H> | null, tune = RIVER_TUNE): Promise<RiverFxStood | null> {
    const gen = ++this.gen;
    for (const list of this.byRiver.values()) for (const h of list) host?.remove(h);
    this.byRiver.clear();
    if (!host || !tables.length) return null;
    const plans = tables.map((t) => ({ t, list: riverEffects(t, tune) }));
    const kinds = new Set<RiverEffect['kind']>();
    for (const p of plans) for (const e of p.list) kinds.add(e.kind);
    const ready = new Map<RiverEffect['kind'], boolean>();
    for (const k of kinds) {
      ready.set(k, await host.prepare(files[k]));
      if (gen !== this.gen || !host.still()) return null;
    }
    const missing = [...ready].filter(([, ok]) => !ok).map(([k]) => k);
    let placed = 0;
    for (const p of plans) {
      const handles: H[] = [];
      for (const e of p.list) if (ready.get(e.kind)) handles.push(host.place(files[e.kind], e));
      if (handles.length) this.byRiver.set(p.t.name, handles);
      placed += handles.length;
    }
    return { placed, files: ready.size - missing.length, missing };
  }
}

/**
 * Which rivers' bodies a landing of the water file's rivers takes down and stands again (`World.landRivers`): every river of
 * ours that `moved` (put, moved or taken out) as it stood (`before`) is taken down, and as it stands now (`after`) stood
 * again; what stands under either (old place and new) is `touched`. A river that did not move, and the terrain's own, are
 * left alone. Pure.
 */
export function riverLandingPlan(before: readonly RiverTable[], after: readonly RiverTable[], moved: ReadonlySet<string>): { drop: string[]; add: RiverTable[]; touched: RiverTable[] } {
  const drop: string[] = [];
  const add: RiverTable[] = [];
  const touched: RiverTable[] = [];
  for (const t of before) {
    if (!t.ours || !moved.has(t.ours.id)) continue;
    drop.push(t.name);
    touched.push(t);
  }
  for (const t of after) {
    if (!t.ours || !moved.has(t.ours.id)) continue;
    if (!drop.includes(t.name)) drop.push(t.name);
    add.push(t);
    touched.push(t);
  }
  return { drop, add, touched };
}

/** Whether two tables of one river draw the very same water: the same quads, the same quads water, its velocity and shader. */
export function sameRiverWater(a: RiverTable, b: RiverTable): boolean {
  if (a.ours !== b.ours || a.soe !== b.soe || a.shader !== b.shader || a.river.velocity !== b.river.velocity) return false;
  const qa = a.river.quads;
  const qb = b.river.quads;
  const wa = a.river.water;
  const wb = b.river.water;
  if (qa.length !== qb.length || wa.length !== wb.length) return false;
  for (let i = 0; i < qa.length; i++) if (!Object.is(qa[i], qb[i])) return false;
  for (let i = 0; i < wa.length; i++) if (wa[i] !== wb[i]) return false;
  return true;
}

/**
 * Which rivers' bodies a retune that shapes them takes down and stands again (`World.retuneRivers('shape')`): a river whose
 * new table draws the very water its old one drew keeps its bodies (`keep`, each handed its new table: its reaches are the
 * same, so its winds and geometry stand), and only where its water moved (a steep reach cut out or put back, a river come or
 * gone) are its bodies taken down (`drop`) and stood again (`add`), and what stands under it made again (`touched`). Pure.
 */
export function riverRetunePlan(before: readonly RiverTable[], after: readonly RiverTable[]): { drop: string[]; add: RiverTable[]; keep: { from: RiverTable; to: RiverTable }[]; touched: RiverTable[] } {
  const was = new Map<string, RiverTable>();
  for (const t of before) was.set(t.name, t);
  const drop: string[] = [];
  const add: RiverTable[] = [];
  const keep: { from: RiverTable; to: RiverTable }[] = [];
  const touched: RiverTable[] = [];
  for (const t of after) {
    const b = was.get(t.name);
    was.delete(t.name);
    if (b && sameRiverWater(b, t)) {
      keep.push({ from: b, to: t });
      continue;
    }
    if (b) {
      drop.push(b.name);
      touched.push(b);
    }
    add.push(t);
    touched.push(t);
  }
  for (const b of was.values()) {
    drop.push(b.name);
    touched.push(b);
  }
  return { drop, add, keep, touched };
}

/**
 * The detail's wind a reach of a river is drawn with (`water.ts`'s `uWind`, in its own units): the reach's run times the
 * river's velocity (and `RIVER_TUNE.flow`), divided by the metres a second a flow of one carries the detail at (`unit`:
 * `uDrift · DETAIL_FLOW · DETAIL_CYCLE`, `water.ts`'s `riverWindUnit`), written into `out`.
 */
export function reachWind(reach: RiverReach, velocity: number, unit: number, flow: number, out: { x: number; y: number }): void {
  const k = (velocity * flow) / (unit > 1e-6 ? unit : 1e-6);
  out.x = reach.runX * k;
  out.y = reach.runZ * k;
}
