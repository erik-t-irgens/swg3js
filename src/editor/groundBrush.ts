// The paint brush's stroke, pure (Map-maker II, DESIGN.md §2.5): what a stamp does to the ground's paint, worked out in the
// raw frame over the cells of the paint's lattice (`groundPaint.ts`: 4 m, the owner's, unless the world's file says
// another), each cell a corner of the lattice.
//
// **The weight** of a stamp at a cell is the sculpt brush's own (`stampWeight`: the client's four feathers over the band past
// the hard core) times `strength`. Two layers:
//   - **family**: a cell takes the palette entry (or, erasing, the world's own: nought) where the weight passes `cellAt` --
//     a cell is one family or the other, never a share of one; a feathered edge is the client's masks between corners;
//   - **colour**: a cell's colour is faded toward the chosen one and its amount toward `colourAmount` by
//     `q = w (1 - exp(-colourRate dt))` a stamp, so a held second lays the same at any rate; erasing fades the amount out;
//   - **plants** (the fourth wave): a cell takes the chosen flora recipe and its amount is faded toward `floraAmount` by the
//     same law at `floraRate` (a held stroke thickens, an erasing one thins, the same at any rate); a cell of another recipe
//     is faded out by that law first and takes the chosen one only once it has come to nought, so the feather holds there.
// A stroke keeps every tile it touched as it stood before it (null for one it made), so the glue writes the tiles that
// changed once, as the stroke ends, and a refused write puts every one back.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties. The dev server's alone: reached only through the editor.

import { paintTileNumber, paintTileOf, type GroundPaint } from '../swg/terrain/groundPaint.ts';
import { rawRect, stampWeight, type RawRect, type SculptFalloff } from './sculpt.ts';

export type PaintLayer = 'family' | 'colour' | 'plants';
export const PAINT_LAYERS: readonly PaintLayer[] = ['family', 'colour', 'plants'];

/** What a stamp is asked: its layer, its middle in the raw frame, its numbers, its seconds, and what it lays. */
export interface PaintStampAsk {
  layer: PaintLayer;
  cx: number;
  cz: number;
  radius: number;
  hard: number;
  falloff: SculptFalloff;
  strength: number;
  /** The weight past which a family cell takes the paint. */
  cellAt: number;
  /** The palette entry a family stamp lays (1..255). */
  entry: number;
  /** The colour a colour stamp lays, three bytes, how much of it a cell tends to, and how fast (a second). */
  r: number;
  g: number;
  b: number;
  colourAmount: number;
  colourRate: number;
  /** The recipe a plants stamp lays (1..255), how much of it a cell tends to (0 to 1), and how fast (a second): the fourth wave's. */
  recipe: number;
  floraAmount: number;
  floraRate: number;
  dt: number;
  /** Erasing: the world's own family, a colour faded out. */
  erase: boolean;
}

/** A stamp's ask, made once (fractions from the start). */
export function paintStampAsk(): PaintStampAsk {
  return { layer: 'family', cx: 0.5, cz: 0.5, radius: 0.5, hard: 0.5, falloff: 'easeInOut', strength: 0.5, cellAt: 0.5, entry: 1, r: 255, g: 255, b: 255, colourAmount: 0.5, colourRate: 0.5, recipe: 1, floraAmount: 0.5, floraRate: 0.5, dt: 0.5, erase: false };
}

/** A tile the stroke touched: its layer, place and number, and its cells before the stroke and now (null: no tile). */
export interface PaintTouched {
  layer: 'fam' | 'col' | 'flo';
  tx: number;
  tz: number;
  key: number;
  before: Uint8Array | null;
  after: Uint8Array | null;
}

/** Whether every byte of a tile's cells is nought (a family tile of nothing; a colour tile's amounts are every fourth byte). */
export function emptyCells(cells: Uint8Array, colour: boolean): boolean {
  if (colour) {
    for (let i = 3; i < cells.length; i += 4) if (cells[i] !== 0) return false;
    return true;
  }
  for (let i = 0; i < cells.length; i++) if (cells[i] !== 0) return false;
  return true;
}

/** A stroke over a paint: the tiles it touched kept as they stood before it, its cells written into the paint as it goes. */
export class PaintStroke {
  readonly paint: GroundPaint;
  /** Each touched family and colour tile's cells before the stroke, by number (null for one the stroke made). */
  readonly beforeFam = new Map<number, Uint8Array | null>();
  readonly beforeCol = new Map<number, Uint8Array | null>();
  /** And each touched flora tile's (the fourth wave). */
  readonly beforeFlo = new Map<number, Uint8Array | null>();
  /** The raw rectangle every stamp changed, unioned. */
  readonly rect: RawRect = rawRect();
  stamps = 0;

  constructor(paint: GroundPaint) {
    this.paint = paint;
  }

  /**
   * One stamp: every cell whose corner the disc reaches written as the ask says, into the paint's own tiles (made where a
   * cell is painted into none); answers the raw rectangle it changed (empty where it changed nothing), written into `out`.
   */
  stamp(a: PaintStampAsk, out: RawRect): RawRect {
    this.stamps++;
    out.x0 = Infinity;
    out.z0 = Infinity;
    out.x1 = -Infinity;
    out.z1 = -Infinity;
    const p = this.paint;
    const cell = p.cell;
    const n = p.n;
    const r = a.radius;
    const c0x = Math.ceil((a.cx - r) / cell);
    const c1x = Math.floor((a.cx + r) / cell);
    const c0z = Math.ceil((a.cz - r) / cell);
    const c1z = Math.floor((a.cz + r) / cell);
    const colour = a.layer === 'colour';
    const plants = a.layer === 'plants';
    const q0 = colour ? 1 - Math.exp(-Math.max(0, a.colourRate) * Math.max(0, a.dt)) : plants ? 1 - Math.exp(-Math.max(0, a.floraRate) * Math.max(0, a.dt)) : 0;
    const target = Math.round(Math.min(1, Math.max(0, plants ? a.floraAmount : a.colourAmount)) * 255);
    let changed = false;
    let mx0 = Infinity;
    let mx1 = -Infinity;
    let mz0 = Infinity;
    let mz1 = -Infinity;
    for (let cz = c0z; cz <= c1z; cz++) {
      const tz = Math.floor(cz / n);
      const j = cz - tz * n;
      const dz = cz * cell - a.cz;
      for (let cx = c0x; cx <= c1x; cx++) {
        const dx = cx * cell - a.cx;
        const w = stampWeight(Math.sqrt(dx * dx + dz * dz), r, a.hard, a.falloff) * Math.min(1, Math.max(0, a.strength));
        if (!(w > 0)) continue;
        const tx = Math.floor(cx / n);
        const i = cx - tx * n;
        const k = j * n + i;
        if (plants) {
          // A flora cell (the fourth wave): its amount faded toward the chosen recipe's target by the same law the colour's
          // takes, a held second the same at any rate, its recipe the chosen one; erasing fades the amount out, and a cell
          // of nought is no cell. A cell of another recipe is faded out first by that same law and only takes the chosen
          // recipe once its amount has come to nought (then grows from nought), so a stroke's feather holds where two
          // recipes meet: the faint edge of a disc thins the forest beside it a little, never swaps it whole.
          const q = w * q0;
          if (!(q > 0)) continue;
          const have = p.floraTile(tx, tz, false);
          const o = k * 2;
          const r0 = have ? have[o] : 0;
          if (a.erase && (r0 === 0 || !have || have[o + 1] === 0)) continue;
          const other = !a.erase && r0 !== 0 && r0 !== a.recipe && !!have && have[o + 1] !== 0;
          const f = this.floraFloats(paintTileNumber(tx, tz), have);
          const fa = f[k];
          f[k] = a.erase || other ? fa * (1 - q) : fa + (target - fa) * q;
          let na = Math.round(f[k]);
          if (na < 0) na = 0;
          if (na > 255) na = 255;
          // The other recipe gone: the cell is free, and the chosen one grows from nought at the next stamp.
          if (other && na === 0) f[k] = 0;
          const nr = na === 0 ? 0 : a.erase || other ? r0 : a.recipe;
          if (have && have[o] === nr && have[o + 1] === na) continue;
          if (!have && na === 0) continue;
          const t = this.touch('flo', tx, tz, na !== 0);
          if (!t) continue;
          t[o] = nr;
          t[o + 1] = na;
        } else if (!colour) {
          if (w < a.cellAt) continue;
          const v = a.erase ? 0 : a.entry;
          const have = p.familyTile(tx, tz, false);
          if ((have ? have[k] : 0) === v) continue;
          const t = this.touch('fam', tx, tz, v !== 0);
          if (!t) continue;
          t[k] = v;
        } else {
          const q = w * q0;
          if (!(q > 0)) continue;
          const have = p.colourTile(tx, tz, false);
          const o = k * 4;
          if (a.erase && (!have || have[o + 3] === 0)) continue;
          // The stroke's own float copy of the cell (made from its bytes the first time it is reached), so the bytes a held
          // second comes to do not hang on how many stamps carried it.
          const key = paintTileNumber(tx, tz);
          const f = this.colourFloats(key, have);
          const fa = f[o + 3];
          if (a.erase) f[o + 3] = fa * (1 - q);
          else {
            f[o + 3] = fa + (target - fa) * q;
            if (fa <= 0) {
              f[o] = a.r;
              f[o + 1] = a.g;
              f[o + 2] = a.b;
            } else {
              f[o] += (a.r - f[o]) * q;
              f[o + 1] += (a.g - f[o + 1]) * q;
              f[o + 2] += (a.b - f[o + 2]) * q;
            }
          }
          let na = Math.round(f[o + 3]);
          const nr = na === 0 ? 0 : Math.round(f[o]);
          const ng = na === 0 ? 0 : Math.round(f[o + 1]);
          const nb = na === 0 ? 0 : Math.round(f[o + 2]);
          if (na < 0) na = 0;
          if (have && have[o] === nr && have[o + 1] === ng && have[o + 2] === nb && have[o + 3] === na) continue;
          if (!have && na === 0) continue;
          const t = this.touch('col', tx, tz, na !== 0);
          if (!t) continue;
          t[o] = nr;
          t[o + 1] = ng;
          t[o + 2] = nb;
          t[o + 3] = na;
        }
        changed = true;
        const x = cx * cell;
        const z = cz * cell;
        if (x < mx0) mx0 = x;
        if (x > mx1) mx1 = x;
        if (z < mz0) mz0 = z;
        if (z > mz1) mz1 = z;
      }
    }
    if (!changed) return out;
    // A family cell reaches the poles round its corner a half cell either way; a colour or flora cell, laid bilinearly, a whole one.
    const reach = colour || plants ? cell : cell / 2;
    out.x0 = mx0 - reach;
    out.x1 = mx1 + reach;
    out.z0 = mz0 - reach;
    out.z1 = mz1 + reach;
    const s = this.rect;
    if (out.x0 < s.x0) s.x0 = out.x0;
    if (out.z0 < s.z0) s.z0 = out.z0;
    if (out.x1 > s.x1) s.x1 = out.x1;
    if (out.z1 > s.z1) s.z1 = out.z1;
    return out;
  }

  /** The stroke's float copies of the colour tiles it reached, by number. */
  private readonly colF = new Map<number, Float64Array>();

  /** A colour tile's float copy, made from its bytes (or noughts) the first time the stroke reaches it. */
  private colourFloats(key: number, have: Uint8Array | null): Float64Array {
    let f = this.colF.get(key);
    if (!f) {
      f = new Float64Array(this.paint.n * this.paint.n * 4);
      if (have) for (let i = 0; i < have.length; i++) f[i] = have[i];
      this.colF.set(key, f);
    }
    return f;
  }

  /** The stroke's float copies of the flora tiles' amounts it reached (one a cell), by number. */
  private readonly floF = new Map<number, Float64Array>();

  /** A flora tile's amounts as floats, made from its bytes (or noughts) the first time the stroke reaches it. */
  private floraFloats(key: number, have: Uint8Array | null): Float64Array {
    let f = this.floF.get(key);
    if (!f) {
      f = new Float64Array(this.paint.n * this.paint.n);
      if (have) for (let i = 0; i < f.length; i++) f[i] = have[i * 2 + 1];
      this.floF.set(key, f);
    }
    return f;
  }

  /** A tile made ready to write into: its before kept the first time the stroke touches it; made only where `make`. */
  private touch(layer: 'fam' | 'col' | 'flo', tx: number, tz: number, make: boolean): Uint8Array | null {
    const key = paintTileNumber(tx, tz);
    if (key < 0) return null;
    const p = this.paint;
    const before = layer === 'fam' ? this.beforeFam : layer === 'col' ? this.beforeCol : this.beforeFlo;
    const have = layer === 'fam' ? p.familyTile(tx, tz, false) : layer === 'col' ? p.colourTile(tx, tz, false) : p.floraTile(tx, tz, false);
    if (!before.has(key)) before.set(key, have ? have.slice() : null);
    if (have) return have;
    if (!make) return null;
    return layer === 'fam' ? p.familyTile(tx, tz, true) : layer === 'col' ? p.colourTile(tx, tz, true) : p.floraTile(tx, tz, true);
  }

  /**
   * Every tile the stroke touched, each with its cells before and now: a tile left empty is taken out of the paint here
   * (`after` null), so the file never holds a tile of nothing.
   */
  touched(): PaintTouched[] {
    const out: PaintTouched[] = [];
    const p = this.paint;
    for (const [layer, map] of [['fam', this.beforeFam], ['col', this.beforeCol], ['flo', this.beforeFlo]] as const) {
      for (const [key, before] of map) {
        const { tx, tz } = paintTileOf(key);
        const colour = layer === 'col';
        let now = layer === 'col' ? p.colourTile(tx, tz, false) : layer === 'fam' ? p.familyTile(tx, tz, false) : p.floraTile(tx, tz, false);
        // A flora cell of no amount holds no recipe either (the stamp writes both nought), so every byte nought is empty.
        if (now && emptyCells(now, colour)) {
          if (layer === 'col') p.setColourTile(tx, tz, null);
          else if (layer === 'fam') p.setFamilyTile(tx, tz, null);
          else p.setFloraTile(tx, tz, null);
          now = null;
        }
        out.push({ layer, tx, tz, key, before, after: now ? now.slice() : null });
      }
    }
    return out;
  }

  /** The tile numbers the stroke touched, by layer (what the worker is handed). */
  famKeys(): number[] {
    return [...this.beforeFam.keys()];
  }

  colKeys(): number[] {
    return [...this.beforeCol.keys()];
  }

  floKeys(): number[] {
    return [...this.beforeFlo.keys()];
  }

  /** Every tile the stroke touched put back as it stood before it; answers the raw rectangle they cover. */
  putBack(): RawRect {
    const p = this.paint;
    for (const [key, before] of this.beforeFam) {
      const { tx, tz } = paintTileOf(key);
      p.setFamilyTile(tx, tz, before ? before.slice() : null);
    }
    for (const [key, before] of this.beforeCol) {
      const { tx, tz } = paintTileOf(key);
      p.setColourTile(tx, tz, before ? before.slice() : null);
    }
    for (const [key, before] of this.beforeFlo) {
      const { tx, tz } = paintTileOf(key);
      p.setFloraTile(tx, tz, before ? before.slice() : null);
    }
    return this.rect;
  }
}

/** Whether two tiles' cells are the same bytes (null: no tile). */
export function sameCells(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
