// The paint file (Map-maker II, DESIGN.md §2.5): `public/placements/paint/<world>.json`, the ground's painted families and
// colours as plain JSON a build ships and every browser reads, written only by the dev server's batch.
//
//   { "version": 1, "world": "yavin4", "frame": "raw", "cell": 4, "tile": 512,
//     "rows": [
//       { "id": "col:3,-2", "rle": "0*812,ff8040c0*14,0*15558", "at": 0 },
//       { "id": "fam:3,-2", "rle": "0*812,1*14,0*15558", "at": 0 },
//       { "id": "palette", "entries": [ { "pack": "yavin4", "name": "<a family>" }, { "pack": "yavin4", "name": "<another>", "child": 2 } ], "at": 0 },
//       { "id": "world", "follow": true, "at": 0 }
//     ] }
//
// In the terrain's own frame, cells on a lattice of `cell` metres (4, the owner's; a file of 8 m cells reads and draws as
// one), tiles of 512 m by their place. **Everything is a row**, so the batch and the undo of every kind carry it: the
// `world` row (the paint's settings: `follow`, the client's four anti-tiling layers per world, each family's alternate
// weights, and on a real-elevation world its base family and the wash), the `palette` row (each entry a family by its pack
// and name, so a name two worlds share never collides; an entry is only ever appended), and a row a layer a tile:
//   - `fam:tx,tz`, one byte a cell, the palette's index (nought the world's own), run-length text `value*count`;
//   - `col:tx,tz`, a cell's colour and how much of it, eight hex `rrggbbaa` (or `0`: the world's own colour).
// The cells run row by row along z, each row along x, and a row's runs come to exactly (512 / cell)² cells. A tile of
// nothing is no tile (taken out instead), and the file goes with its last row, as every edit file does. The flora's `flo:`
// rows and the `recipes` row are Map-maker II's fourth wave's.
//
// **Backstops, not live** (`PAINT_LIMITS`): every build agrees on what a committed file means, so a row past one is skipped
// and named alike everywhere; a family cell naming an entry the palette has not got is skipped with its tile.
//
// Pure: imports only the paint's constants, the wash's reader and the story's JSONC reader. Rule for this file (node runs it
// with type stripping): every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { parseJsonc } from '../../story/jsonc.ts';
import { GroundPaint, PAINT_CELL, PAINT_CELLS, PAINT_PALETTE_MOST, PAINT_TILE, type PaintPaletteEntry } from '../../swg/terrain/groundPaint.ts';
import { readWash, type WashSpec } from '../demWash.ts';

export const PAINT_VERSION = 1;

/** The reader's backstops (ours), far past any use: every build holds a file to them alike, so none is live. */
export const PAINT_LIMITS = {
  /** Palette entries: a family cell is one byte. */
  palette: PAINT_PALETTE_MOST,
  /** Rows a file holds: a whole 32 km world painted in both layers is 8,192. */
  rows: 65536,
  /** A world row's family weights: families named, and alternates a family. */
  weights: 512,
  alternates: 64,
};

/** The colour modes the world row's `tint` takes (the ground's own, `GROUND_DRAW_TUNE.colour`). */
export const TINT_MODES: readonly string[] = ['off', 'client', 'normalised', 'channels'];

/** The paint's world settings, each read only where the row sets it, so the code's own answers otherwise. */
export interface PaintWorldRow {
  id: 'world';
  /** Whether the world's plants follow the paint (true where absent). */
  follow?: boolean;
  /** The client's four anti-tiling layers: each family's alternates, the colour map's tint and its gain cap, the border masks and their opposite rule, the cloud shadows. */
  alternates?: boolean;
  tint?: string;
  gainCap?: number;
  masks?: boolean;
  opposite?: 'max' | 'add';
  clouds?: boolean | { on?: boolean; strength?: number };
  /** Each family's alternate weights, by `"<pack>:<name>"`: rarer or commoner alternates where the world draws them. */
  weights?: Record<string, number[]>;
  /** A real-elevation world's base family (what no rule and no paint names) and the packs it lends families from. */
  base?: { pack: string; name: string };
  packs?: string[];
  /** A real-elevation world's colour wash of ours (`demWash.ts`), for the tint to vary its ground by. */
  wash?: WashSpec;
  at?: number;
}

/** The palette: each entry a family by its pack and name, and the alternate it forces where it names one. */
export interface PaintPaletteRow {
  id: 'palette';
  entries: PaintPaletteEntry[];
  at?: number;
}

/** A tile of one layer: its cells as run-length text. */
export interface PaintTileRow {
  id: string;
  rle: string;
  at?: number;
}

export type PaintRow = PaintWorldRow | PaintPaletteRow | PaintTileRow;

/** What reading a file gave: its cell, its rows, what was skipped and why, what this build does not read, why it was not read. */
export interface PaintRead {
  cell: number;
  rows: PaintRow[];
  skipped: { id: string; why: string }[];
  unknown: string[];
  problem: string | null;
}

const TILE_ID = /^(fam|col):(-?\d{1,4}),(-?\d{1,4})$/;
const LATER_ID = /^(recipes$|flo:)/;
const PACK = /^[a-z0-9_]{1,40}$/;
/**
 * A family's name as the generator's group holds it: any text but control characters, quotes and backslashes. The game's
 * own names are not all plain words (Dathomir has `rock_dath_desertcanyon (mistyfalls)`), and a pattern of plain words
 * refused that family's every stroke.
 */
const FAMILY = /^[^\u0000-\u001f\u007f"\\]{1,80}$/;
const WORLD_FIELDS = new Set(['id', 'follow', 'alternates', 'tint', 'gainCap', 'masks', 'opposite', 'clouds', 'weights', 'base', 'packs', 'wash', 'at']);
const PALETTE_FIELDS = new Set(['id', 'entries', 'at']);
const TILE_FIELDS = new Set(['id', 'rle', 'at']);
const WORLD_ORDER = ['id', 'follow', 'alternates', 'tint', 'gainCap', 'masks', 'opposite', 'clouds', 'weights', 'base', 'packs', 'wash', 'at'];
const PALETTE_ORDER = ['id', 'entries', 'at'];
const TILE_ORDER = ['id', 'rle', 'at'];

/** Whether an id names a row of the paint file this build writes. */
export function isPaintId(v: unknown): v is string {
  return typeof v === 'string' && (v === 'world' || v === 'palette' || TILE_ID.test(v));
}

/** A tile row's layer and place from its id, or null. */
export function paintTileOfId(id: string): { layer: 'fam' | 'col'; tx: number; tz: number } | null {
  const m = TILE_ID.exec(id);
  return m ? { layer: m[1] as 'fam' | 'col', tx: Number(m[2]), tz: Number(m[3]) } : null;
}

/** A tile row's id. */
export function paintTileId(layer: 'fam' | 'col', tx: number, tz: number): string {
  return `${layer}:${tx},${tz}`;
}

/** How many cells a tile has at a cell. */
export function cellsOfTile(cell: number): number {
  const n = PAINT_TILE / cell;
  return n * n;
}

/** A family tile's cells as run-length text (`value*count`, or the value alone for a run of one). */
export function familyRle(cells: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  while (i < cells.length) {
    const v = cells[i];
    let j = i + 1;
    while (j < cells.length && cells[j] === v) j++;
    out.push(j - i === 1 ? String(v) : `${v}*${j - i}`);
    i = j;
  }
  return out.join(',');
}

/** A colour tile's cells as run-length text (eight hex a painted cell, `0` an unpainted one). */
export function colourRle(cells: Uint8Array): string {
  const n = cells.length >> 2;
  const out: string[] = [];
  const word = (i: number): string => {
    const k = i * 4;
    if (cells[k + 3] === 0) return '0';
    return (((cells[k] << 24) | (cells[k + 1] << 16) | (cells[k + 2] << 8) | cells[k + 3]) >>> 0).toString(16).padStart(8, '0');
  };
  let i = 0;
  while (i < n) {
    const v = word(i);
    let j = i + 1;
    while (j < n && word(j) === v) j++;
    out.push(j - i === 1 ? v : `${v}*${j - i}`);
    i = j;
  }
  return out.join(',');
}

/** A family tile's run-length text read into `count` cells, or why not. */
export function familyCells(rle: string, count: number): Uint8Array | string {
  const out = new Uint8Array(count);
  let at = 0;
  let any = false;
  for (const tok of rle.split(',')) {
    const star = tok.indexOf('*');
    const vs = star < 0 ? tok : tok.slice(0, star);
    const ns = star < 0 ? '1' : tok.slice(star + 1);
    if (!/^\d{1,3}$/.test(vs) || !/^\d{1,6}$/.test(ns)) return 'its cells are not runs of value*count';
    const v = Number(vs);
    const c = Number(ns);
    if (v > PAINT_PALETTE_MOST || c < 1) return 'a run is past a byte, or empty';
    if (at + c > count) return `its runs come to more than the ${count} cells a tile has`;
    if (v) {
      out.fill(v, at, at + c);
      any = true;
    }
    at += c;
  }
  if (at !== count) return `its runs come to ${at} cells, where a tile has ${count}`;
  if (!any) return 'every cell is the world\'s own: a tile of nothing is no tile';
  return out;
}

/** A colour tile's run-length text read into `count` cells, four bytes each, or why not. */
export function colourCells(rle: string, count: number): Uint8Array | string {
  const out = new Uint8Array(count * 4);
  let at = 0;
  let any = false;
  for (const tok of rle.split(',')) {
    const star = tok.indexOf('*');
    const vs = star < 0 ? tok : tok.slice(0, star);
    const ns = star < 0 ? '1' : tok.slice(star + 1);
    if (!(vs === '0' || /^[0-9a-f]{8}$/.test(vs)) || !/^\d{1,6}$/.test(ns)) return 'its cells are not runs of rrggbbaa*count';
    const c = Number(ns);
    if (c < 1) return 'a run is empty';
    if (at + c > count) return `its runs come to more than the ${count} cells a tile has`;
    if (vs !== '0') {
      const w = Number.parseInt(vs, 16) >>> 0;
      const a = w & 255;
      if (a === 0) return 'a painted cell of no amount is written 0';
      for (let i = at; i < at + c; i++) {
        out[i * 4] = (w >>> 24) & 255;
        out[i * 4 + 1] = (w >>> 16) & 255;
        out[i * 4 + 2] = (w >>> 8) & 255;
        out[i * 4 + 3] = a;
      }
      any = true;
    }
    at += c;
  }
  if (at !== count) return `its runs come to ${at} cells, where a tile has ${count}`;
  if (!any) return 'every cell is the world\'s own: a tile of nothing is no tile';
  return out;
}

/** The cells a tile's run-length text comes to (its runs summed), or -1 where it does not read as runs. */
function runCount(rle: string): number {
  let at = 0;
  for (const tok of rle.split(',')) {
    const star = tok.indexOf('*');
    const ns = star < 0 ? '1' : tok.slice(star + 1);
    if (!/^\d{1,6}$/.test(ns)) return -1;
    at += Number(ns);
  }
  return at;
}

/**
 * A palette entry read, or why not: the reader's own rule, which the editor asks before it puts an entry in the palette,
 * so an entry no file could hold is refused in words and never reaches a write.
 */
export function readPaintEntry(v: unknown): PaintPaletteEntry | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'an entry is an object';
  const o = v as Record<string, unknown>;
  if (typeof o.pack !== 'string' || !PACK.test(o.pack)) return "an entry's pack is a pack id";
  if (typeof o.name !== 'string' || !FAMILY.test(o.name)) return "an entry's name is a family's";
  const e: PaintPaletteEntry = { pack: o.pack, name: o.name };
  if (o.child !== undefined) {
    if (typeof o.child !== 'number' || !Number.isInteger(o.child) || o.child < 0 || o.child > 255) return "an entry's child is a whole number";
    e.child = o.child;
  }
  for (const k of Object.keys(o)) if (k !== 'pack' && k !== 'name' && k !== 'child') return `an entry carries ${k}, which this build does not read`;
  return e;
}

/** The world row's fields read, or why not; fields this build does not read go into `unknown`. */
function readWorld(o: Record<string, unknown>, unknown: string[]): PaintWorldRow | string {
  const row: PaintWorldRow = { id: 'world' };
  for (const k of Object.keys(o)) if (!WORLD_FIELDS.has(k)) unknown.push(`world.${k}`);
  const bool = (k: 'follow' | 'alternates' | 'masks'): string | null => {
    if (o[k] === undefined) return null;
    if (typeof o[k] !== 'boolean') return `its ${k} is true or false`;
    row[k] = o[k] as boolean;
    return null;
  };
  for (const k of ['follow', 'alternates', 'masks'] as const) {
    const no = bool(k);
    if (no) return no;
  }
  if (o.tint !== undefined) {
    if (typeof o.tint !== 'string' || !TINT_MODES.includes(o.tint)) return `its tint is one of ${TINT_MODES.join(', ')}`;
    row.tint = o.tint;
  }
  if (o.gainCap !== undefined) {
    if (typeof o.gainCap !== 'number' || !Number.isFinite(o.gainCap) || o.gainCap <= 0 || o.gainCap > 16) return 'its gainCap is a number above nought, at most 16';
    row.gainCap = o.gainCap;
  }
  if (o.opposite !== undefined) {
    if (o.opposite !== 'max' && o.opposite !== 'add') return 'its opposite is max or add';
    row.opposite = o.opposite;
  }
  if (o.clouds !== undefined) {
    if (typeof o.clouds === 'boolean') row.clouds = o.clouds;
    else if (o.clouds && typeof o.clouds === 'object' && !Array.isArray(o.clouds)) {
      const c = o.clouds as Record<string, unknown>;
      const out: { on?: boolean; strength?: number } = {};
      if (c.on !== undefined) {
        if (typeof c.on !== 'boolean') return "its clouds' on is true or false";
        out.on = c.on;
      }
      if (c.strength !== undefined) {
        if (typeof c.strength !== 'number' || !Number.isFinite(c.strength) || c.strength < 0 || c.strength > 4) return "its clouds' strength is a number from 0 to 4";
        out.strength = c.strength;
      }
      for (const k of Object.keys(c)) if (k !== 'on' && k !== 'strength') return `its clouds carry ${k}, which this build does not read`;
      row.clouds = out;
    } else return 'its clouds are true, false or { on, strength }';
  }
  if (o.weights !== undefined) {
    if (!o.weights || typeof o.weights !== 'object' || Array.isArray(o.weights)) return 'its weights are an object of "<pack>:<name>" to lists of numbers';
    const w: Record<string, number[]> = {};
    const entries = Object.entries(o.weights as Record<string, unknown>);
    if (entries.length > PAINT_LIMITS.weights) return `its weights name more than ${PAINT_LIMITS.weights} families`;
    for (const [k, list] of entries) {
      const colon = k.indexOf(':');
      if (colon < 1 || !PACK.test(k.slice(0, colon)) || !FAMILY.test(k.slice(colon + 1))) return `its weights' key ${k} is not "<pack>:<name>"`;
      if (!Array.isArray(list) || !list.length || list.length > PAINT_LIMITS.alternates || !list.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1000)) return `its weights for ${k} are a list of numbers from 0 to 1000`;
      w[k] = list as number[];
    }
    row.weights = w;
  }
  if (o.base !== undefined) {
    const b = o.base as Record<string, unknown> | null;
    if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.pack !== 'string' || !PACK.test(b.pack) || typeof b.name !== 'string' || !FAMILY.test(b.name) || Object.keys(b).some((k) => k !== 'pack' && k !== 'name')) return 'its base is { pack, name }';
    row.base = { pack: b.pack, name: b.name };
  }
  if (o.packs !== undefined) {
    if (!Array.isArray(o.packs) || o.packs.length > 16 || !o.packs.every((p) => typeof p === 'string' && PACK.test(p))) return 'its packs are a list of pack ids';
    row.packs = [...(o.packs as string[])];
  }
  if (o.wash !== undefined) {
    const w = readWash(o.wash);
    if (typeof w === 'string') return `its wash: ${w}`;
    row.wash = w;
  }
  return row;
}

/**
 * One row cleaned, or why it is refused: the world row, the palette or a tile, each by its own shape; a tile's runs held
 * to `count` cells where it is handed (the file's own header), else to a count some cell of a file gives. Fields this
 * build does not read go into `unknown`.
 */
export function readPaintRow(v: unknown, unknown: string[] = [], count = 0): PaintRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a row is an object';
  const o = v as Record<string, unknown>;
  if (typeof o.id === 'string' && LATER_ID.test(o.id)) return "the flora's paint is Map-maker II's fourth wave's, which this build does not read";
  if (!isPaintId(o.id)) return 'its id is world, palette, or a tile\'s ("fam:tx,tz", "col:tx,tz")';
  let at: number | undefined;
  if (o.at !== undefined) {
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0) return 'its at is a time in milliseconds';
    at = o.at;
  }
  if (o.id === 'world') {
    const row = readWorld(o, unknown);
    if (typeof row === 'string') return row;
    if (at !== undefined) row.at = at;
    return row;
  }
  if (o.id === 'palette') {
    for (const k of Object.keys(o)) if (!PALETTE_FIELDS.has(k)) unknown.push(`palette.${k}`);
    if (!Array.isArray(o.entries)) return 'its entries are a list';
    if (o.entries.length > PAINT_LIMITS.palette) return `its palette holds more than the ${PAINT_LIMITS.palette} entries a cell's byte can name`;
    const entries: PaintPaletteEntry[] = [];
    for (const e of o.entries) {
      const r = readPaintEntry(e);
      if (typeof r === 'string') return r;
      entries.push(r);
    }
    const row: PaintPaletteRow = { id: 'palette', entries };
    if (at !== undefined) row.at = at;
    return row;
  }
  for (const k of Object.keys(o)) if (!TILE_FIELDS.has(k)) unknown.push(`${o.id}.${k}`);
  if (typeof o.rle !== 'string' || !o.rle.length || o.rle.length > 400000) return 'its cells (rle) are run-length text';
  const t = paintTileOfId(o.id)!;
  const counts = count ? [count] : PAINT_CELLS.map(cellsOfTile);
  const have = runCount(o.rle);
  const n = counts.find((c) => c === have);
  if (n === undefined) return have < 0 ? 'its cells are not runs of value*count' : `its runs come to ${have} cells, where a tile has ${counts.join(' or ')}`;
  const cells = t.layer === 'fam' ? familyCells(o.rle, n) : colourCells(o.rle, n);
  if (typeof cells === 'string') return cells;
  const row: PaintTileRow = { id: o.id, rle: o.rle };
  if (at !== undefined) row.at = at;
  return row;
}

/**
 * Why a file's rows do not hang together, in words, or null: every tile of one cell (a file holds one), and no family cell
 * naming an entry past the palette's end. The batch asks it before it writes (`EditKind.whole`), so such a write is the
 * asker's to mend and never the read-back's surprise.
 */
export function paintRowsWhole(rows: readonly PaintRow[]): string | null {
  let count = -1;
  let palette = 0;
  for (const r of rows) if (r.id === 'palette') palette = (r as PaintPaletteRow).entries.length;
  for (const r of rows) {
    const t = paintTileOfId(r.id);
    if (!t) continue;
    const have = runCount((r as PaintTileRow).rle);
    if (count < 0) count = have;
    else if (have !== count) return `its tiles would be of two cells (${r.id}'s runs come to ${have}, another's to ${count})`;
    if (t.layer !== 'fam') continue;
    const cells = familyCells((r as PaintTileRow).rle, have);
    if (typeof cells === 'string') return `${r.id}: ${cells}`;
    let past = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i] > palette) past = Math.max(past, cells[i]);
    if (past) return `${r.id} would name palette entry ${past}, and the palette would hold ${palette}`;
  }
  return null;
}

/** Two rows that read the same: their fields as JSON, in the writer's own order. */
export function samePaintRow(a: PaintRow, b: PaintRow): boolean {
  return a.id === b.id && rowLine(a as unknown as Record<string, unknown>) === rowLine(b as unknown as Record<string, unknown>);
}

/** A row's fields in the writer's order, then whatever else it carries. */
function rowLine(r: Record<string, unknown>): string {
  const order = r.id === 'world' ? WORLD_ORDER : r.id === 'palette' ? PALETTE_ORDER : TILE_ORDER;
  const known = r.id === 'world' ? WORLD_FIELDS : r.id === 'palette' ? PALETTE_FIELDS : TILE_FIELDS;
  const parts: string[] = [];
  for (const k of order) if (r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
  for (const k of Object.keys(r)) if (!known.has(k) && r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
  return `{ ${parts.join(', ')} }`;
}

/** A row's own fields, for the batch's write-back: the cleaned row, with whatever the row it replaces held that this build does not read. */
export function paintWithExtras(row: PaintRow, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  const known = row.id === 'world' ? WORLD_FIELDS : row.id === 'palette' ? PALETTE_FIELDS : TILE_FIELDS;
  if (was) for (const k of Object.keys(was)) if (!known.has(k) && !(k in out)) out[k] = was[k];
  return out;
}

/**
 * Read a world's paint file. A file whose header is not this world's, or not the shape this build writes (its version, its
 * frame, its cell, its tile), is refused whole, since every cell in it would be laid in the wrong place; a ground world
 * alone keeps one (a space zone's ground is no ground: "space maps are a later pass"). A bad row, a row past the backstop,
 * a second row under one id, and a family tile naming an entry the palette has not got are skipped and named.
 */
export function readPaintFile(text: string, world: string, kindOfWorld: 'ground' | 'space', raws?: Record<string, unknown>[]): PaintRead {
  const out: PaintRead = { cell: PAINT_CELL, rows: [], skipped: [], unknown: [], problem: null };
  if (kindOfWorld === 'space') {
    out.problem = 'a space zone keeps no paint: space maps are a later pass';
    return out;
  }
  const doc = parseJsonc(text);
  if (doc.error) {
    out.problem = `it does not read (line ${doc.error.line}, column ${doc.error.col}: ${doc.error.message})`;
    return out;
  }
  const v = doc.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    out.problem = 'it is not an object';
    return out;
  }
  const f = v as Record<string, unknown>;
  if (f.version !== PAINT_VERSION) {
    out.problem = `its version is not ${PAINT_VERSION}`;
    return out;
  }
  if (f.world !== world) {
    out.problem = `it says it is ${typeof f.world === 'string' ? f.world : 'no world'}'s, and its name says ${world}'s`;
    return out;
  }
  if (f.frame !== 'raw') {
    out.problem = `a world's paint is written in the raw frame, and it says ${typeof f.frame === 'string' ? f.frame : 'none'}`;
    return out;
  }
  if (typeof f.cell !== 'number' || !PAINT_CELLS.includes(f.cell)) {
    out.problem = `its cell is ${PAINT_CELLS.join(', ')} or so many metres, and it says ${String(f.cell)}`;
    return out;
  }
  if (f.tile !== PAINT_TILE) {
    out.problem = `its tiles are ${PAINT_TILE} m, and it says ${String(f.tile)}`;
    return out;
  }
  out.cell = f.cell;
  if (!Array.isArray(f.rows)) {
    out.problem = 'it has no rows list';
    return out;
  }
  const count = cellsOfTile(f.cell);
  const seen = new Set<string>();
  const kept: { row: PaintRow; raw: Record<string, unknown> }[] = [];
  for (let i = 0; i < f.rows.length; i++) {
    const raw = f.rows[i];
    const named = raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : `#${i}`;
    if (kept.length >= PAINT_LIMITS.rows) {
      out.skipped.push({ id: named, why: `past the ${PAINT_LIMITS.rows} rows a file may hold` });
      continue;
    }
    const row = readPaintRow(raw, out.unknown, count);
    if (typeof row === 'string') {
      out.skipped.push({ id: named, why: row });
      continue;
    }
    if (seen.has(row.id)) {
      out.skipped.push({ id: row.id, why: 'a second row under the same id' });
      continue;
    }
    seen.add(row.id);
    kept.push({ row, raw: raw as Record<string, unknown> });
  }
  // A family cell names an entry of the palette by its place: one past the palette's end names nothing, and its tile is
  // skipped (a palette is only ever appended to, so this is a file edited by hand).
  const palette = kept.find((k) => k.row.id === 'palette')?.row as PaintPaletteRow | undefined;
  const most = palette?.entries.length ?? 0;
  for (const k of kept) {
    const t = paintTileOfId(k.row.id);
    if (t?.layer === 'fam') {
      const cells = familyCells((k.row as PaintTileRow).rle, count) as Uint8Array;
      let past = 0;
      for (let i = 0; i < cells.length; i++) if (cells[i] > most) past = Math.max(past, cells[i]);
      if (past) {
        out.skipped.push({ id: k.row.id, why: `a cell names palette entry ${past}, and the palette holds ${most}` });
        continue;
      }
    }
    out.rows.push(k.row);
    if (raws) raws.push(k.raw);
  }
  return out;
}

/**
 * A whole file's text: its header a field a line, then one line a row, sorted by id, each row's fields in one fixed order
 * (and, after them, whatever a row read from the file carried that this build does not read). A change to one tile is a
 * change to one line. The cell is the tiles' own (their runs' count says it), else `cell`, else the paint's own.
 */
export function paintFileText(world: string, rows: readonly Record<string, unknown>[], cell?: number): string {
  let c = cell && PAINT_CELLS.includes(cell) ? cell : PAINT_CELL;
  for (const r of rows) {
    if (typeof r.rle !== 'string') continue;
    const have = runCount(r.rle);
    const match = PAINT_CELLS.find((x) => cellsOfTile(x) === have);
    if (match) {
      c = match;
      break;
    }
  }
  const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const lines = sorted.map((r) => `    ${rowLine(r)}`);
  const body = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${PAINT_VERSION},\n  "world": ${JSON.stringify(world)},\n  "frame": "raw",\n  "cell": ${c},\n  "tile": ${PAINT_TILE},\n  "rows": ${body}\n}\n`;
}

/**
 * The paint file's rows as the game holds them now, by id (their `at` too): what the editor's next write names as each row
 * was, kept current by every read and every answer, with about how many bytes the file comes to written (its header and
 * its rows' lines).
 */
export class PaintRows {
  private readonly byId = new Map<string, PaintRow>();
  private lineBytes = new Map<string, number>();
  bytes = 0;

  /** Every row of a file read whole. */
  takeAll(rows: readonly PaintRow[]): void {
    this.byId.clear();
    this.lineBytes.clear();
    this.bytes = 0;
    for (const r of rows) this.put(r);
  }

  /** A write's answer, or a file's difference: the rows put (as stamped) and the ids taken out. */
  land(put: readonly PaintRow[], deleted: readonly string[]): void {
    for (const id of deleted) this.drop(id);
    for (const r of put) this.put(r);
  }

  get(id: string): PaintRow | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.byId.size;
  }

  values(): IterableIterator<PaintRow> {
    return this.byId.values();
  }

  private put(r: PaintRow): void {
    this.drop(r.id);
    this.byId.set(r.id, { ...r } as PaintRow);
    const b = rowLine(r as unknown as Record<string, unknown>).length + 6;
    this.lineBytes.set(r.id, b);
    this.bytes += b;
    if (this.byId.size === 1) this.bytes += 110;
  }

  private drop(id: string): void {
    if (!this.byId.has(id)) return;
    this.byId.delete(id);
    this.bytes -= this.lineBytes.get(id) ?? 0;
    this.lineBytes.delete(id);
    if (this.byId.size === 0) this.bytes = 0;
  }
}

/** What a read file comes to for the game: the paint (its tiles decoded), the palette's entries and the world row. */
export interface PaintLoaded {
  paint: GroundPaint;
  entries: PaintPaletteEntry[];
  world: PaintWorldRow;
  /** The file's rows as read, by id (their `at` too): what the editor's next write names as each row was. */
  rows: PaintRow[];
  bytes: number;
  skipped: { id: string; why: string }[];
  problem: string | null;
  rev: string | null;
}

/** A read file's rows made into a paint (its tiles' cells decoded) with its palette and world row beside. */
export function paintOfRead(read: PaintRead): { paint: GroundPaint; entries: PaintPaletteEntry[]; world: PaintWorldRow } {
  const paint = new GroundPaint(read.cell);
  const count = cellsOfTile(read.cell);
  let entries: PaintPaletteEntry[] = [];
  let world: PaintWorldRow = { id: 'world' };
  for (const r of read.rows) {
    if (r.id === 'palette') entries = (r as PaintPaletteRow).entries.map((e) => ({ ...e }));
    else if (r.id === 'world') world = { ...(r as PaintWorldRow) };
    else {
      const t = paintTileOfId(r.id);
      if (!t) continue;
      const rle = (r as PaintTileRow).rle;
      if (t.layer === 'fam') {
        const cells = familyCells(rle, count);
        if (typeof cells !== 'string') paint.setFamilyTile(t.tx, t.tz, cells);
      } else {
        const cells = colourCells(rle, count);
        if (typeof cells !== 'string') paint.setColourTile(t.tx, t.tz, cells);
      }
    }
  }
  paint.follow = world.follow !== false;
  return { paint, entries, world };
}
