// The ground's height edits (Map-maker II, DESIGN.md §2.4): a delta in metres at every 2 m pole of the raw frame, kept in
// sparse tiles of 32 x 32 poles (64 m, aligned to multiples of 64 in the raw frame -- exactly the sampler's block interior on
// every converted world, and the chunk lattice about (0, 0) on a real-elevation world), looked up by number and never by a
// string on a frame's path.
//
// **Where it is laid, and nowhere else**: over a generated grid as it enters a cache on the main thread (a block the
// sampler made, a block the worker made, a far grid of either), and at the end of `Terrain.heightAt` on a world with no
// converted terrain. Never inside the generator or its worker, which stay the client's ground (`terrainSnap.test.ts` and
// the client's own baked heights keep proving the port), and never under a building's terrain layer, which still reads raw
// ground (`TerrainSampler.baseHeightAt`).
//
// **Every write is from raw** (`lay`): a sample's height is `fround(raw + d)` where its delta is not nought and the raw
// height itself where it is, so a patched block, a block generated afresh and an undone one are the same bits by
// construction, and the two copies of a block's edge pole (one block's pad, the next one's own) always agree. A nought is
// skipped because `-0 + 0` is `+0`: with no tile, an empty store or a store of nought tiles, every grid is the generator's
// to the bit.
//
// Pure, and imports nothing: the release's own source list carries it (`tools/launcher/pack.mjs`, `SOURCE_FILES`), since
// the shipped sampler names it. Rule for this file (node runs it with type stripping): no enum, no namespace, no
// constructor parameter properties.

/** Metres between two poles: the client's own lattice on every ground world but the copies' (whose 8 m poles are refused). */
export const HEIGHT_POLE = 2;
/** Poles a tile has along a side, and metres a tile spans. */
export const HEIGHT_TILE_POLES = 32;
export const HEIGHT_TILE = HEIGHT_POLE * HEIGHT_TILE_POLES;
/** Deltas a tile holds. */
export const HEIGHT_TILE_DELTAS = HEIGHT_TILE_POLES * HEIGHT_TILE_POLES;
/** Tiles either way along an axis a number may name (4,095 tiles, 262 km: past any world the game has). */
const TILE_REACH = 4095;

/** A tile's place as one small integer, a map key with nothing made; -1 past `TILE_REACH` either way. */
export function tileNumber(tx: number, tz: number): number {
  if (tx < -TILE_REACH || tx > TILE_REACH || tz < -TILE_REACH || tz > TILE_REACH) return -1;
  return (tx + 4096) * 8192 + (tz + 4096);
}

/** A tile's place from its number. */
export function tileOfNumber(n: number): { tx: number; tz: number } {
  return { tx: Math.floor(n / 8192) - 4096, tz: (n % 8192) - 4096 };
}

/** The tile a raw coordinate lies in, along one axis. */
export function tileAt(v: number): number {
  return Math.floor(v / HEIGHT_TILE);
}

/**
 * A grid laid over (`HeightEdits.layIn`): `n` samples along x from `x0` a step `dx` apart (a step may be negative: a far grid
 * in the game's column order runs against the raw frame), `nz` along z from `z0` a step `dz` apart, row by row, `raw` the
 * heights as the generator made them and `out` where the laid heights go (the very array the cache holds). A kept record:
 * numbers ride it, never a call the compiler may leave out.
 */
export interface LayAsk {
  raw: Float32Array | null;
  out: Float32Array | null;
  x0: number;
  dx: number;
  z0: number;
  dz: number;
  nx: number;
  nz: number;
}

/** A lay's ask, made once. */
export function layAsk(): LayAsk {
  return { raw: null, out: null, x0: 0.5, dx: 2.5, z0: 0.5, dz: 2.5, nx: 0, nz: 0 };
}

/** The store: the tiles by number, and a count of changes (`version`), which anything that keeps a laid copy can ask. */
export class HeightEdits {
  private readonly tiles = new Map<number, Float32Array>();
  /** Bumped by every change of a tile, so a reader can tell a store that moved. */
  version = 0;
  /** The extent of every tile held, in the raw frame (for `touches`'s first answer); kept as tiles come and go. */
  private x0 = Infinity;
  private z0 = Infinity;
  private x1 = -Infinity;
  private z1 = -Infinity;

  /** How many tiles are held. */
  get size(): number {
    return this.tiles.size;
  }

  /** Every tile held, by place: for the writer and the console. Allocates (never a frame's). */
  entries(): { tx: number; tz: number; d: Float32Array }[] {
    const out: { tx: number; tz: number; d: Float32Array }[] = [];
    for (const [n, d] of this.tiles) {
      const t = tileOfNumber(n);
      out.push({ tx: t.tx, tz: t.tz, d });
    }
    return out;
  }

  /** A tile's deltas, or null where none is held. The array is the store's own: write through `set`. */
  tile(tx: number, tz: number): Float32Array | null {
    const n = tileNumber(tx, tz);
    return n < 0 ? null : (this.tiles.get(n) ?? null);
  }

  /**
   * A tile put (its 1,024 deltas, row by row along z, each row along x) or taken away (null, or a tile whose every delta is
   * nought, which is the same ground). Copies what it is handed. Answers whether the store holds a tile there now.
   */
  set(tx: number, tz: number, d: Float32Array | null): boolean {
    const n = tileNumber(tx, tz);
    if (n < 0) return false;
    let any = false;
    if (d) for (let i = 0; i < d.length; i++) if (d[i] !== 0) any = true;
    this.version++;
    if (!d || !any || d.length !== HEIGHT_TILE_DELTAS) {
      if (this.tiles.delete(n)) this.reExtent();
      return false;
    }
    this.tiles.set(n, new Float32Array(d));
    this.x0 = Math.min(this.x0, tx * HEIGHT_TILE);
    this.z0 = Math.min(this.z0, tz * HEIGHT_TILE);
    this.x1 = Math.max(this.x1, (tx + 1) * HEIGHT_TILE);
    this.z1 = Math.max(this.z1, (tz + 1) * HEIGHT_TILE);
    return true;
  }

  /**
   * A tile's own deltas to write into in place (a sculpt stroke's stamps, which write as they go), made of noughts where
   * none is held. A tile left all nought is no tile once `prune` is asked of it. Bumps the version.
   */
  writable(tx: number, tz: number): Float32Array | null {
    const n = tileNumber(tx, tz);
    if (n < 0) return null;
    let t = this.tiles.get(n);
    if (!t) {
      t = new Float32Array(HEIGHT_TILE_DELTAS);
      this.tiles.set(n, t);
      this.x0 = Math.min(this.x0, tx * HEIGHT_TILE);
      this.z0 = Math.min(this.z0, tz * HEIGHT_TILE);
      this.x1 = Math.max(this.x1, (tx + 1) * HEIGHT_TILE);
      this.z1 = Math.max(this.z1, (tz + 1) * HEIGHT_TILE);
    }
    this.version++;
    return t;
  }

  /** A tile whose every delta is nought let go (it is the same ground as none). Answers whether a tile is still held. */
  prune(tx: number, tz: number): boolean {
    const n = tileNumber(tx, tz);
    const t = n < 0 ? undefined : this.tiles.get(n);
    if (!t) return false;
    for (let i = 0; i < t.length; i++) if (t[i] !== 0) return true;
    this.tiles.delete(n);
    this.version++;
    this.reExtent();
    return false;
  }

  /** Every tile let go. */
  clear(): void {
    this.tiles.clear();
    this.version++;
    this.reExtent();
  }

  private reExtent(): void {
    this.x0 = Infinity;
    this.z0 = Infinity;
    this.x1 = -Infinity;
    this.z1 = -Infinity;
    for (const n of this.tiles.keys()) {
      const t = tileOfNumber(n);
      this.x0 = Math.min(this.x0, t.tx * HEIGHT_TILE);
      this.z0 = Math.min(this.z0, t.tz * HEIGHT_TILE);
      this.x1 = Math.max(this.x1, (t.tx + 1) * HEIGHT_TILE);
      this.z1 = Math.max(this.z1, (t.tz + 1) * HEIGHT_TILE);
    }
  }

  /** The delta at the pole of the raw lattice nearest (x, z), nought off every tile. */
  deltaAt(x: number, z: number): number {
    return this.poleDelta(Math.round(x / HEIGHT_POLE), Math.round(z / HEIGHT_POLE));
  }

  /** The delta at pole (px, pz) of the raw lattice (pole px stands at x = 2 px), nought off every tile. */
  poleDelta(px: number, pz: number): number {
    const tx = Math.floor(px / HEIGHT_TILE_POLES);
    const tz = Math.floor(pz / HEIGHT_TILE_POLES);
    const n = tileNumber(tx, tz);
    if (n < 0) return 0;
    const t = this.tiles.get(n);
    if (t === undefined) return 0;
    return t[(pz - tz * HEIGHT_TILE_POLES) * HEIGHT_TILE_POLES + (px - tx * HEIGHT_TILE_POLES)];
  }

  /**
   * The delta between poles, bilinear over the four round (x, z) of the raw frame: on a pole exactly its own delta, nought
   * off every tile. What a point of a real-elevation world's ground takes (`Terrain.heightAt`), and a foot between poles.
   */
  bilinear(x: number, z: number): number {
    if (!this.tiles.size || x < this.x0 - HEIGHT_POLE || x > this.x1 + HEIGHT_POLE || z < this.z0 - HEIGHT_POLE || z > this.z1 + HEIGHT_POLE) return 0;
    const fx = x / HEIGHT_POLE;
    const fz = z / HEIGHT_POLE;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const d00 = this.poleDelta(i, j);
    const d10 = this.poleDelta(i + 1, j);
    const d01 = this.poleDelta(i, j + 1);
    const d11 = this.poleDelta(i + 1, j + 1);
    if (d00 === 0 && d10 === 0 && d01 === 0 && d11 === 0) return 0;
    // On a pole (u and v nought) this is d00 and nothing else, to the bit.
    if (u === 0 && v === 0) return d00;
    return (d00 * (1 - u) + d10 * u) * (1 - v) + (d01 * (1 - u) + d11 * u) * v;
  }

  /** Whether any tile meets a rectangle of the raw frame (its poles at the edges included). */
  touches(x0: number, z0: number, x1: number, z1: number): boolean {
    if (!this.tiles.size) return false;
    const lx = Math.min(x0, x1);
    const hx = Math.max(x0, x1);
    const lz = Math.min(z0, z1);
    const hz = Math.max(z0, z1);
    if (hx < this.x0 || lx > this.x1 || hz < this.z0 || lz > this.z1) return false;
    const tx0 = tileAt(lx);
    const tx1 = tileAt(hx);
    const tz0 = tileAt(lz);
    const tz1 = tileAt(hz);
    // A rectangle of many tiles asks the map once a tile it holds rather than once a tile the rectangle covers.
    if ((tx1 - tx0 + 1) * (tz1 - tz0 + 1) > this.tiles.size) {
      for (const n of this.tiles.keys()) {
        const t = tileOfNumber(n);
        if (t.tx >= tx0 && t.tx <= tx1 && t.tz >= tz0 && t.tz <= tz1) return true;
      }
      return false;
    }
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) if (this.tiles.has(tileNumber(tx, tz))) return true;
    return false;
  }

  /**
   * A grid laid from raw (`ask`, `LayAsk`): every sample `out[k] = raw[k] + d` (rounded into the float32 `out` once) where
   * its pole's delta is not nought, and `raw[k]` itself where it is. Answers whether any sample took a delta. Nothing made.
   */
  layIn(ask: LayAsk): boolean {
    const raw = ask.raw;
    const out = ask.out;
    if (!raw || !out) return false;
    const nx = ask.nx;
    const nz = ask.nz;
    const x0 = ask.x0;
    const dx = ask.dx;
    const z0 = ask.z0;
    const dz = ask.dz;
    let moved = false;
    for (let j = 0; j < nz; j++) {
      const pz = Math.round((z0 + j * dz) / HEIGHT_POLE);
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        const k = row + i;
        const d = this.poleDelta(Math.round((x0 + i * dx) / HEIGHT_POLE), pz);
        if (d !== 0) {
          out[k] = raw[k] + d;
          moved = true;
        } else out[k] = raw[k];
      }
    }
    return moved;
  }

  /** `layIn` with its numbers given (for the tests and the console). */
  lay(raw: Float32Array, out: Float32Array, x0: number, dx: number, z0: number, dz: number, nx: number, nz: number): boolean {
    const a = layAsk();
    a.raw = raw;
    a.out = out;
    a.x0 = x0;
    a.dx = dx;
    a.z0 = z0;
    a.dz = dz;
    a.nx = nx;
    a.nz = nz;
    return this.layIn(a);
  }
}

/** FNV-1a 32 over float32 heights' bytes, eight hex: the digest of the raw ground a tile was authored over (`on`). */
export function fnv1aHeights(h: Float32Array): string {
  const bytes = new Uint8Array(h.buffer, h.byteOffset, h.byteLength);
  let x = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    x ^= bytes[i];
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x.toString(16).padStart(8, '0');
}
