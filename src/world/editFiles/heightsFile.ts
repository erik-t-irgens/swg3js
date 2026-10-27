// The heights file (Map-maker II, DESIGN.md §2.4): `public/placements/heights/<world>.json`, the ground's height edits as
// plain JSON a build ships and every browser reads, written only by the dev server's batch.
//
//   { "version": 1, "world": "naboo", "frame": "raw", "pole": 2, "tile": 64, "enc": "f32-deflate-raw-b64",
//     "rows": [
//       { "id": "12,-3", "d": "<1,024 float32 deltas in metres, deflate-raw, base64>", "on": "9f3a01c2", "at": 1793000000000 }
//     ] }
//
// A row is one tile of 32 x 32 poles (`heightEdits.ts`), named by its place (`"tx,tz"`, so a stroke changes the lines of
// the tiles it touched and nothing else), its deltas a metre each at every 2 m pole row by row along z (each row along x),
// exact float32 against the float32 heights they are added to; `on` is an FNV-1a 32 digest (eight hex) of the raw ground
// the tile was authored over, so a node test over the committed files can name a tile whose raw ground has since moved
// under it (a port fix like the feathers'); `at` the moment the endpoint wrote it. A tile whose every delta is nought is no
// tile (taken out instead), and the file goes with its last tile, as a placements file goes with its last row.
//
// **The deltas are deflated** (deflate-raw, base64): node's own `zlib` in the dev server's glue and the tests, the
// browser's `DecompressionStream('deflate-raw')` in the game. Both are handed in (`inflate`), never imported, so this file
// stays pure and the shipped reader carries no codec of its own.
//
// **Backstops, not live** (`HEIGHTS_LIMITS`): every build agrees on what a committed file means, so a tile past one is
// skipped and named by every build alike; the editor's own soft lines (the file's tiles and bytes) are notes on its bar.
//
// Pure: imports only the store's own constants. Rule for this file (node runs it with type stripping): every import with
// its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { parseJsonc } from '../../story/jsonc.ts';
import { HEIGHT_POLE, HEIGHT_TILE, HEIGHT_TILE_DELTAS, HeightEdits } from '../../swg/terrain/heightEdits.ts';

export const HEIGHTS_VERSION = 1;
/** How a tile's deltas are kept: float32, deflate-raw, base64. */
export const HEIGHTS_ENC = 'f32-deflate-raw-b64';

/** The reader's backstops (ours), far past any use: every build holds a file to them alike, so none is live. */
export const HEIGHTS_LIMITS = {
  /** The most a delta may be, metres either way. */
  delta: 4000,
  /** Tiles a file holds: any world's whole ground (16 km a side is 65,536 tiles). */
  tiles: 262144,
  /** Deltas a tile holds, exactly. */
  deltas: HEIGHT_TILE_DELTAS,
};

/** One tile of the file, as read and cleaned. */
export interface HeightTileRow {
  id: string;
  /** The deltas, deflate-raw, base64. */
  d: string;
  /** FNV-1a 32 of the raw heights it was authored over, eight hex. */
  on: string;
  at?: number;
}

/** What reading a file gave. */
export interface HeightsRead {
  rows: HeightTileRow[];
  skipped: { id: string; why: string }[];
  unknown: string[];
  problem: string | null;
}

const TILE_ID = /^-?\d{1,5},-?\d{1,5}$/;
const DIGEST = /^[0-9a-f]{8}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const FIELDS = new Set(['id', 'd', 'on', 'at']);
const ORDER: (keyof HeightTileRow)[] = ['id', 'd', 'on', 'at'];

/** Whether an id names a tile (`"tx,tz"`). */
export function isTileId(v: unknown): v is string {
  return typeof v === 'string' && TILE_ID.test(v);
}

/** A tile's id from its place. */
export function tileIdOf(tx: number, tz: number): string {
  return `${tx},${tz}`;
}

/** A tile's place from its id. */
export function tileOfId(id: string): { tx: number; tz: number } {
  const comma = id.indexOf(',');
  return { tx: Number(id.slice(0, comma)), tz: Number(id.slice(comma + 1)) };
}

/**
 * A tile's deltas out of its inflated bytes: exactly 1,024 little-endian float32, each finite and within the backstop;
 * or why not. A tile whose every delta is nought is no tile.
 */
export function deltasOf(bytes: Uint8Array | null): Float32Array | string {
  if (!bytes) return 'its deltas do not inflate';
  if (bytes.byteLength !== HEIGHTS_LIMITS.deltas * 4) return `its deltas are ${bytes.byteLength} bytes, where a tile is ${HEIGHTS_LIMITS.deltas * 4}`;
  const copy = new Uint8Array(bytes);
  const d = new Float32Array(copy.buffer, 0, HEIGHTS_LIMITS.deltas);
  let any = false;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (!Number.isFinite(v) || Math.abs(v) > HEIGHTS_LIMITS.delta) return `a delta is not a number of metres within ${HEIGHTS_LIMITS.delta} either way`;
    if (v !== 0) any = true;
  }
  if (!any) return 'every delta is nought: a tile of noughts is no tile';
  return new Float32Array(d);
}

/** A tile's deltas as the bytes deflated (little-endian float32, the platform's own on every browser the game runs on). */
export function deltaBytes(d: Float32Array): Uint8Array {
  return new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
}

/**
 * One row cleaned, or why it is refused: its shape (an id that names a tile, base64 deltas, an eight-hex digest, a moment),
 * and, where `inflate` is handed in, its deltas themselves (`deltasOf`). Fields this build does not read go into `unknown`.
 */
export function readTileRow(v: unknown, unknown: string[] = [], inflate?: (b64: string) => Uint8Array | null): HeightTileRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a tile is an object';
  const o = v as Record<string, unknown>;
  if (!isTileId(o.id)) return 'its id is not a tile\'s place ("tx,tz")';
  for (const k of Object.keys(o)) if (!FIELDS.has(k)) unknown.push(`${o.id}.${k}`);
  if (typeof o.d !== 'string' || !B64.test(o.d)) return 'its deltas are not base64';
  if (typeof o.on !== 'string' || !DIGEST.test(o.on)) return 'its digest (on) is not eight hex';
  const row: HeightTileRow = { id: o.id, d: o.d, on: o.on };
  if (o.at !== undefined) {
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0) return 'its at is a time in milliseconds';
    row.at = o.at;
  }
  if (inflate) {
    const d = deltasOf(inflate(o.d));
    if (typeof d === 'string') return d;
  }
  return row;
}

/** Two tiles that read the same: their place, their deltas' bytes as written, their digest and their moment. */
export function sameTile(a: HeightTileRow, b: HeightTileRow): boolean {
  return a.id === b.id && a.d === b.d && a.on === b.on && a.at === b.at;
}

/**
 * Read a world's heights file. A file whose header is not this world's, or not the shape this build writes (its version,
 * its frame, its pole, its tile, its encoding), is refused whole, since every tile in it would be laid in the wrong place;
 * a ground world alone keeps one (a space zone's ground is no ground: "space maps are a later pass"). A bad tile, a tile
 * past the backstop and a second tile under one id are skipped and named.
 */
export function readHeightsFile(text: string, world: string, kindOfWorld: 'ground' | 'space', inflate?: (b64: string) => Uint8Array | null, raws?: Record<string, unknown>[]): HeightsRead {
  const out: HeightsRead = { rows: [], skipped: [], unknown: [], problem: null };
  if (kindOfWorld === 'space') {
    out.problem = 'a space zone keeps no heights: space maps are a later pass';
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
  if (f.version !== HEIGHTS_VERSION) {
    out.problem = `its version is not ${HEIGHTS_VERSION}`;
    return out;
  }
  if (f.world !== world) {
    out.problem = `it says it is ${typeof f.world === 'string' ? f.world : 'no world'}'s, and its name says ${world}'s`;
    return out;
  }
  if (f.frame !== 'raw') {
    out.problem = `a world's heights are written in the raw frame, and it says ${typeof f.frame === 'string' ? f.frame : 'none'}`;
    return out;
  }
  if (f.pole !== HEIGHT_POLE || f.tile !== HEIGHT_TILE) {
    out.problem = `its poles are ${HEIGHT_POLE} m apart in tiles of ${HEIGHT_TILE} m, and it says ${String(f.pole)} and ${String(f.tile)}`;
    return out;
  }
  if (f.enc !== HEIGHTS_ENC) {
    out.problem = `its tiles are ${HEIGHTS_ENC}, and it says ${typeof f.enc === 'string' ? f.enc : 'none'}`;
    return out;
  }
  if (!Array.isArray(f.rows)) {
    out.problem = 'it has no rows list';
    return out;
  }
  const seen = new Set<string>();
  for (let i = 0; i < f.rows.length; i++) {
    const raw = f.rows[i];
    const named = raw && typeof raw === 'object' && isTileId((raw as { id?: unknown }).id) ? (raw as { id: string }).id : `#${i}`;
    if (out.rows.length >= HEIGHTS_LIMITS.tiles) {
      out.skipped.push({ id: named, why: `past the ${HEIGHTS_LIMITS.tiles} tiles a file may hold` });
      continue;
    }
    const row = readTileRow(raw, out.unknown, inflate);
    if (typeof row === 'string') {
      out.skipped.push({ id: named, why: row });
      continue;
    }
    if (seen.has(row.id)) {
      out.skipped.push({ id: row.id, why: 'a second tile under the same id' });
      continue;
    }
    seen.add(row.id);
    out.rows.push(row);
    if (raws) raws.push(raw as Record<string, unknown>);
  }
  return out;
}

/**
 * A whole file's text: its header a field a line, then one line a tile, sorted by id, each tile's fields in one fixed
 * order (and, after them, whatever a tile read from the file carried that this build does not read). A change to one tile
 * is a change to one line.
 */
export function heightsFileText(world: string, rows: readonly Record<string, unknown>[]): string {
  const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const lines = sorted.map((r) => {
    const parts: string[] = [];
    for (const k of ORDER) {
      const v = r[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    }
    for (const k of Object.keys(r)) {
      if (FIELDS.has(k) || r[k] === undefined) continue;
      parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    }
    return `    { ${parts.join(', ')} }`;
  });
  const body = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${HEIGHTS_VERSION},\n  "world": ${JSON.stringify(world)},\n  "frame": "raw",\n  "pole": ${HEIGHT_POLE},\n  "tile": ${HEIGHT_TILE},\n  "enc": ${JSON.stringify(HEIGHTS_ENC)},\n  "rows": ${body}\n}\n`;
}

/** A tile row's own fields, for the batch's write-back: the cleaned row, with whatever the row it replaces held that this build does not read. */
export function tileWithExtras(row: HeightTileRow, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (was) for (const k of Object.keys(was)) if (!FIELDS.has(k) && !(k in out)) out[k] = was[k];
  return out;
}

/**
 * The tiles of a file read into a store (`HeightEdits`), each tile's deltas inflated by `inflate` (the browser's
 * `DecompressionStream`, node's zlib in a test): a tile whose deltas do not read is skipped and named. Answers the store,
 * the read, and the tiles laid by their place.
 */
export async function storeOfRead(read: HeightsRead, inflate: (b64: string) => Promise<Uint8Array | null>): Promise<{ store: HeightEdits; skipped: { id: string; why: string }[] }> {
  const store = new HeightEdits();
  const skipped: { id: string; why: string }[] = [...read.skipped];
  for (const row of read.rows) {
    const d = deltasOf(await inflate(row.d));
    if (typeof d === 'string') {
      skipped.push({ id: row.id, why: d });
      continue;
    }
    const t = tileOfId(row.id);
    store.set(t.tx, t.tz, d);
  }
  return { store, skipped };
}
