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
// The walk grid's bake reads lakes through this file too (`tools/swg/navgrid.mjs`), so the grid and the drawn world agree:
// it imports only the water file's reader, and the release carries both. Rule for this file (node runs it with type
// stripping): every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import type { WaterLakeRow, WaterLookRow } from './editFiles/waterFile.ts';

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
export function planLakeLanding(was: readonly WaterLakeRow[], put: readonly WaterLakeRow[], deleted: readonly string[]): { rows: WaterLakeRow[]; moved: Set<string> } {
  const byId = new Map<string, WaterLakeRow>();
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
export function keptTables<T extends { ours?: WaterLakeRow }>(prev: readonly T[], rows: readonly WaterLakeRow[], moved: ReadonlySet<string> | null, make: (row: WaterLakeRow) => T | null): T[] {
  const byRow = new Map<WaterLakeRow, T>();
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
export function landingTouchesLava(tables: readonly LakeTable[], put: readonly WaterLakeRow[], deleted: readonly string[], isLava: (shader: string) => boolean): boolean {
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
