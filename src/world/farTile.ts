// The far tiles' quads under the detailed chunks, cut out one tile at a time and in place (commit 4a of
// the frame-time wave).
//
// A far tile is the coarse ground past the detailed chunks, 512 m of it drawn from a 32 by 32 grid of
// quads, and where a detailed chunk has come in over it its quads are left out so only one ground shows
// (on a cliff the coarse one pokes through the fine). That used to be worked out afresh for every far tile
// whenever any chunk came or went: a string key built for each of about 170 000 quads, pushed into a new
// array and handed to `setIndex`, which makes a new index attribute every time and never frees the one it
// replaces on the card. It cost 41 to 53 ms on the owner's settings, a tenth of the frames at 40 m/s and
// nearly half at 120, and the buffers it leaked were counted in the thousands.
//
// A 64 m chunk lies inside exactly one 512 m tile, so a chunk coming or going changes that tile alone.
// Each tile keeps which of its quads a chunk covers (one byte a quad), its whole index as the converter's
// terrain built it, and one index attribute made once at the tile's full size: the quads kept are written
// to its front, the draw range set to them, and only that span uploaded. No buffer is made, nothing is
// keyed by a string, and nothing is left behind. `FAR_TILE_TUNE.local` false is the old rebuild of every
// tile, kept so the two can be put side by side (`__debug.perf({ ab: { key: 'farTileLocal' } })`).
//
// No imports but three and the upload range, so a node test drives it with the real three
// (`farTile.test.ts`); value imports carry `.ts`.
import * as THREE from 'three';
import { keepUploadRange, type UploadRange } from './uploadRange.ts';

/** The switch: true cuts the tile a chunk lies in, and only it, in place. */
export const FAR_TILE_TUNE = { local: true };

/** One far tile's cut, kept for its life. */
export interface FarTileCut {
  /** Quads across (and along). */
  n: number;
  /** The whole index, six entries a quad in row order, as the tile was built. */
  full: ArrayLike<number>;
  /** 1 where a loaded chunk covers the quad. */
  covered: Uint8Array;
  /** The chunk column of each quad column, and the chunk row of each quad row. */
  colChunk: Int32Array;
  rowChunk: Int32Array;
  /** The one index attribute, made at the full size: the kept quads at its front. */
  index: THREE.BufferAttribute;
  /** The one upload range handed to three for it (`uploadRange.ts`). */
  range: UploadRange;
  /** Quads kept after the last cut. */
  kept: number;
}

/**
 * Make a tile's cut: `n` quads each way from (`ox`, `oz`) at `step` metres, `full` its whole index, and
 * `chunk` the detailed chunks' size. Every quad starts uncovered; `coverFrom` fills it from the chunks
 * loaded. The index attribute is Uint16 whenever the tile's vertices allow (a 33 by 33 grid, or 6 144
 * corners one a triangle for the textured ground), Uint32 otherwise.
 */
export function makeFarTileCut(full: ArrayLike<number>, n: number, ox: number, oz: number, step: number, chunk: number): FarTileCut {
  let max = 0;
  for (let i = 0; i < full.length; i++) if (full[i] > max) max = full[i];
  const size = n * n * 6;
  const array = max < 65536 ? new Uint16Array(size) : new Uint32Array(size);
  const index = new THREE.BufferAttribute(array, 1);
  index.setUsage(THREE.DynamicDrawUsage);
  const colChunk = new Int32Array(n);
  const rowChunk = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    colChunk[i] = Math.floor((ox + (i + 0.5) * step) / chunk);
    rowChunk[i] = Math.floor((oz + (i + 0.5) * step) / chunk);
  }
  return { n, full, covered: new Uint8Array(n * n), colChunk, rowChunk, index, range: { start: 0, count: 0 }, kept: -1 };
}

/** Whether a chunk lies over any of the tile's quads at all. */
export function chunkInTile(t: FarTileCut, cx: number, cz: number): boolean {
  const n = t.n;
  return cx >= t.colChunk[0] && cx <= t.colChunk[n - 1] && cz >= t.rowChunk[0] && cz <= t.rowChunk[n - 1];
}

/** A chunk came (`covered` true) or went: its quads' marks set. Answers whether any mark changed. */
export function coverChunk(t: FarTileCut, cx: number, cz: number, covered: boolean): boolean {
  if (!chunkInTile(t, cx, cz)) return false;
  const n = t.n;
  const v = covered ? 1 : 0;
  let changed = false;
  for (let j = 0; j < n; j++) {
    if (t.rowChunk[j] !== cz) continue;
    for (let i = 0; i < n; i++) {
      if (t.colChunk[i] !== cx) continue;
      const q = j * n + i;
      if (t.covered[q] !== v) {
        t.covered[q] = v;
        changed = true;
      }
    }
  }
  return changed;
}

/** Every quad's mark from what is loaded now: once, when the tile is made (or the switch comes back on). */
export function coverFrom(t: FarTileCut, has: (cx: number, cz: number) => boolean): void {
  const n = t.n;
  let lastCx = Number.NaN;
  let lastCz = Number.NaN;
  let lastHas = false;
  for (let j = 0; j < n; j++) {
    const cz = t.rowChunk[j];
    for (let i = 0; i < n; i++) {
      const cx = t.colChunk[i];
      // One question a chunk, not one a quad: four quads a side share each chunk.
      if (cx !== lastCx || cz !== lastCz) {
        lastCx = cx;
        lastCz = cz;
        lastHas = has(cx, cz);
      }
      t.covered[j * n + i] = lastHas ? 1 : 0;
    }
  }
}

/**
 * Write the quads kept to the front of the tile's one index attribute, draw only them, and upload only
 * that span. Puts the attribute back on the geometry if the old rebuild replaced it meanwhile. Answers
 * how many quads are kept.
 */
export function writeKept(t: FarTileCut, geometry: THREE.BufferGeometry): number {
  const n = t.n;
  const full = t.full;
  const out = t.index.array as Uint16Array | Uint32Array;
  const cov = t.covered;
  let w = 0;
  for (let q = 0, total = n * n; q < total; q++) {
    if (cov[q]) continue;
    const s = q * 6;
    out[w] = full[s];
    out[w + 1] = full[s + 1];
    out[w + 2] = full[s + 2];
    out[w + 3] = full[s + 3];
    out[w + 4] = full[s + 4];
    out[w + 5] = full[s + 5];
    w += 6;
  }
  if (geometry.index !== t.index) geometry.setIndex(t.index);
  geometry.setDrawRange(0, w);
  if (w > 0) {
    keepUploadRange(t.index.updateRanges, t.range, 0, w);
    t.index.needsUpdate = true;
  }
  t.kept = w / 6;
  return t.kept;
}

/**
 * The old rule, for the node test to hold the cut to and for the switch's other side: the whole index
 * of the quads no loaded chunk covers, worked out from scratch.
 */
export function keptFromScratch(full: ArrayLike<number>, n: number, ox: number, oz: number, step: number, chunk: number, has: (cx: number, cz: number) => boolean): number[] {
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    const cz = Math.floor((oz + (j + 0.5) * step) / chunk);
    for (let i = 0; i < n; i++) {
      const cx = Math.floor((ox + (i + 0.5) * step) / chunk);
      if (has(cx, cz)) continue;
      const q = (j * n + i) * 6;
      for (let k = 0; k < 6; k++) out.push(full[q + k]);
    }
  }
  return out;
}
