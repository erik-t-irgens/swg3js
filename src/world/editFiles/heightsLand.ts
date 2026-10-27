// Tiles of a world's heights file landed into the store the ground reads (Map-maker II, DESIGN.md §2.4): what
// `World.landHeights` (a write's answer: a stroke, an undo, a redo) and `World.replaceHeights` (the file read again whole)
// do to the store and to the rows the editor names each tile by, moved out of `world.ts` so a node test runs the very rules
// the game runs (`heightsEdits.test.ts`), never a copy of them.
//
// **By difference**: a tile whose deltas are the store's already moves nothing, so a stroke's own answer, laid over the very
// deltas the stroke stamped into the store as it went, rebuilds nothing. **A tile a stroke under way holds is never
// written** (`held`): a write's answer is laid a moment after the write returns (its tiles are inflated by the browser's
// stream first), and the next stroke may have begun and stamped into one of those tiles meanwhile; laid over it, every pole
// the new stroke had stamped and did not stamp again went back to the old stroke's deltas, in the drawn ground and in the
// file the new stroke then wrote. The rows are still kept as the file holds them (the new stroke's write names them as they
// were), and the stroke's own write is what the file ends with.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties.

import type { HeightEdits } from '../../swg/terrain/heightEdits.ts';
import type { HeightTileRow } from './heightsFile.ts';

/** Whether a stroke under way holds a tile (the sculpt brush's: `EditorSculpt.holds`), or null for none held. */
export type HeldTiles = ((tx: number, tz: number) => boolean) | null;

/** A tile landed: its place and its deltas, null for one taken out. */
export interface LandedTile {
  tx: number;
  tz: number;
  d: Float32Array | null;
}

/** What laying tiles came to: how many moved, and how many a stroke under way held and were left as it stamped them. */
export interface LayCount {
  moved: number;
  held: number;
}

/** About how many bytes a tile's row takes in the file's text, beside its deltas (its id, its digest, its moment, the keys and the indent). */
const ROW_BYTES = 64;
/** About how many bytes the file's header and its closing take. */
const HEAD_BYTES = 140;

/**
 * A heights file's rows as it holds them now, by tile id, and about how many bytes they come to written (the bar's note
 * that the file is past its soft line: it ships in every release). Kept as reads and answers land, so the size is the
 * file's as the editor last wrote it, never only as it was last read.
 */
export class HeightRows {
  readonly rows = new Map<string, HeightTileRow>();
  private kept = 0;

  /** About how many bytes the file is (nought for no file). */
  get bytes(): number {
    return this.rows.size ? HEAD_BYTES + this.kept : 0;
  }

  get size(): number {
    return this.rows.size;
  }

  get(id: string): HeightTileRow | undefined {
    return this.rows.get(id);
  }

  /** A row put (a copy kept), in place of one under its id. */
  put(row: HeightTileRow): void {
    this.delete(row.id);
    this.rows.set(row.id, { ...row });
    this.kept += row.d.length + row.id.length + ROW_BYTES;
  }

  /** A row taken out. */
  delete(id: string): void {
    const had = this.rows.get(id);
    if (!had) return;
    this.rows.delete(id);
    this.kept -= had.d.length + had.id.length + ROW_BYTES;
  }

  clear(): void {
    this.rows.clear();
    this.kept = 0;
  }

  /** The rows of a whole file, in place of every row kept. */
  takeAll(rows: readonly HeightTileRow[]): void {
    this.clear();
    for (const r of rows) this.put(r);
  }

  /** A write's answer: the rows it put and the ids it took out. */
  land(put: readonly HeightTileRow[], deleted: readonly string[]): void {
    for (const r of put) this.put(r);
    for (const id of deleted) this.delete(id);
  }
}

/**
 * A write's answered tiles inflated into deltas (`inflate`, the browser's stream or node's zlib; `deltasOf` the file's own
 * reader of a tile's bytes): every tile put, then every tile taken out as null. A tile whose deltas do not read is skipped
 * and said (`warn`).
 */
export async function decodeLanded(
  put: readonly HeightTileRow[],
  deleted: readonly string[],
  inflate: (b64: string) => Promise<Uint8Array | null>,
  deltasOf: (bytes: Uint8Array | null) => Float32Array | string,
  tileOfId: (id: string) => { tx: number; tz: number },
  warn: (words: string) => void,
): Promise<LandedTile[]> {
  const out: LandedTile[] = [];
  for (const row of put) {
    const d = deltasOf(await inflate(row.d));
    if (typeof d === 'string') {
      warn(`heights: tile ${row.id} landed and is skipped: ${d}`);
      continue;
    }
    const t = tileOfId(row.id);
    out.push({ tx: t.tx, tz: t.tz, d });
  }
  for (const id of deleted) {
    const t = tileOfId(id);
    out.push({ tx: t.tx, tz: t.tz, d: null });
  }
  return out;
}

/** Whether two tiles' deltas are the same bits. */
export function sameDeltas(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * Tiles laid into the store by difference: each one put or let go where it differs from what the store holds, unless a
 * stroke under way holds it. `moved` is told each tile that moved (the ground over it is rebuilt).
 */
export function layLanded(store: HeightEdits, tiles: readonly LandedTile[], held: HeldTiles, moved: (tx: number, tz: number) => void): LayCount {
  const n: LayCount = { moved: 0, held: 0 };
  for (const t of tiles) {
    const had = store.tile(t.tx, t.tz);
    if (t.d === null ? !had : had && sameDeltas(had, t.d)) continue;
    if (held && held(t.tx, t.tz)) {
      n.held++;
      continue;
    }
    store.set(t.tx, t.tz, t.d);
    moved(t.tx, t.tz);
    n.moved++;
  }
  return n;
}

/**
 * A whole file's store laid over the store in force by difference: every tile it does not hold let go, every tile that
 * differs put, none a stroke under way holds touched. `moved` is told each tile that moved.
 */
export function layWhole(store: HeightEdits, next: HeightEdits | null, held: HeldTiles, moved: (tx: number, tz: number) => void): LayCount {
  const tiles: LandedTile[] = [];
  for (const t of store.entries()) if (!next?.tile(t.tx, t.tz)) tiles.push({ tx: t.tx, tz: t.tz, d: null });
  for (const t of next?.entries() ?? []) tiles.push({ tx: t.tx, tz: t.tz, d: t.d });
  return layLanded(store, tiles, held, moved);
}
