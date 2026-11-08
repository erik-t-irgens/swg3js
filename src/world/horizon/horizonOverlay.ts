// What the browser lays over its copy of the far ground's bake (the horizon pass's second wave, DESIGN.md §2.3): the
// owner's height edits and the race drawer's carved courses over the fine heights, by the very composition the near
// ground takes (`out = fround(fround(carve(raw)) + d)`, `trn.ts`'s `layOne`, `swgTerrain.ts`'s `layFar`), from raw samples
// kept for every 512 m horizon tile an overlay touches; and, for what only the generator lays exactly (the paint, a
// building whose ground the removal file drops, Life Day's layer in season), the rectangles of colour cells to make again
// and what a 2 m grid the live generator made there gives the albedo's composition (each 4 m pole's family and choice,
// each colour cell's mean as the bake took it). Pure: node runs every line.
import { carveAsk, type CourseCarve } from '../../swg/terrain/courseCarve.ts';
import { AffectorEnvironment, ShaderGroup, type Layer, type TerrainGenerator } from '../../swg/terrain/generator.ts';
import { PAINT_TILE, paintTileOf, type GroundPaint } from '../../swg/terrain/groundPaint.ts';
import { layAsk, type HeightEdits } from '../../swg/terrain/heightEdits.ts';
import { parseLayerFile } from '../../swg/terrain/trn.ts';
import { DETAIL_TILE, type ColourOverride, type PoleOverride } from './horizonDecode.ts';
import type { HeightLattice, Lattice } from './horizonFile.ts';

/** Fine samples a side of a horizon tile: 512 m at the bake's 8 m step (a 16 m bake's tiles are 1,024 m). */
export const HORIZON_TILE = 64;

/** A rectangle of fine sample indices, inclusive. */
export interface SampleRect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

/**
 * The fine heights' raw copies and their laying. A tile's raw copy is kept while an overlay touches it (or its raw was made
 * again, `setRaw`: a dropped building's ground, kept for good), and every lay is from raw, so a store emptied puts the
 * bake back to the bit.
 */
export class HeightOverlay {
  readonly lat: HeightLattice;
  private readonly raw = new Map<number, Float32Array>();
  private readonly pinned = new Set<number>();
  private readonly scratch = new Float32Array(HORIZON_TILE * HORIZON_TILE);
  private readonly lay = layAsk();
  private readonly carve = carveAsk();
  private readonly tx: number;
  private readonly tz: number;
  /** What the last lay came to, for the console. */
  laid = 0;
  constructor(lat: HeightLattice) {
    this.lat = lat;
    this.tx = Math.ceil(lat.nx / HORIZON_TILE);
    this.tz = Math.ceil(lat.nz / HORIZON_TILE);
  }

  /** How many tiles keep a raw copy now. */
  get kept(): number {
    return this.raw.size;
  }

  private rectOf(ti: number, tj: number): SampleRect {
    const i0 = ti * HORIZON_TILE;
    const j0 = tj * HORIZON_TILE;
    return { i0, j0, i1: Math.min(this.lat.nx, i0 + HORIZON_TILE) - 1, j1: Math.min(this.lat.nz, j0 + HORIZON_TILE) - 1 };
  }

  /** The tile's samples out of the whole lattice into a contiguous copy. */
  private copyOut(fine: Float32Array, r: SampleRect, out: Float32Array): void {
    const nx = this.lat.nx;
    const w = r.i1 - r.i0 + 1;
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) out[(j - r.j0) * w + (i - r.i0)] = fine[j * nx + i];
  }
  private copyIn(fine: Float32Array, r: SampleRect, from: Float32Array): void {
    const nx = this.lat.nx;
    const w = r.i1 - r.i0 + 1;
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) fine[j * nx + i] = from[(j - r.j0) * w + (i - r.i0)];
  }

  /**
   * The raw heights made again over a rectangle of samples (a dropped building's ground: the generator without its layer),
   * `at(i, j)` each sample's new raw or NaN to keep it; the tiles it reaches keep their copies for good. Lay again after.
   */
  setRaw(fine: Float32Array, r: SampleRect, at: (i: number, j: number) => number): void {
    const t0i = Math.floor(Math.max(0, r.i0) / HORIZON_TILE);
    const t1i = Math.floor(Math.min(this.lat.nx - 1, r.i1) / HORIZON_TILE);
    const t0j = Math.floor(Math.max(0, r.j0) / HORIZON_TILE);
    const t1j = Math.floor(Math.min(this.lat.nz - 1, r.j1) / HORIZON_TILE);
    for (let tj = t0j; tj <= t1j; tj++) {
      for (let ti = t0i; ti <= t1i; ti++) {
        const key = tj * this.tx + ti;
        const tr = this.rectOf(ti, tj);
        let raw = this.raw.get(key);
        if (!raw) {
          raw = new Float32Array((tr.i1 - tr.i0 + 1) * (tr.j1 - tr.j0 + 1));
          this.copyOut(fine, tr, raw);
          this.raw.set(key, raw);
        }
        this.pinned.add(key);
        const w = tr.i1 - tr.i0 + 1;
        for (let j = Math.max(tr.j0, r.j0); j <= Math.min(tr.j1, r.j1); j++) {
          for (let i = Math.max(tr.i0, r.i0); i <= Math.min(tr.i1, r.i1); i++) {
            const v = at(i, j);
            if (v === v) raw[(j - tr.j0) * w + (i - tr.i0)] = v;
          }
        }
      }
    }
  }

  /**
   * Every tile the stores touch now, or that kept a raw copy, laid again from raw into `fine`: the courses carved first
   * (a sample within half the bake's step of a road takes the road, the race drawer's far-grid rule), the edits over that.
   * A tile no store touches any more is put back to its raw and lets its copy go (unless its raw was made again). Answers
   * the tiles laid, as sample rectangles. An arrival's or a late file's work, never a frame's.
   */
  layAll(fine: Float32Array, heights: HeightEdits | null, course: CourseCarve | null): SampleRect[] {
    const out: SampleRect[] = [];
    const L = this.lat;
    const s = L.step;
    const carving = !!course && !course.empty;
    for (let tj = 0; tj < this.tz; tj++) {
      for (let ti = 0; ti < this.tx; ti++) {
        const key = tj * this.tx + ti;
        const r = this.rectOf(ti, tj);
        const x0 = L.x0 + r.i0 * s;
        const z0 = L.z0 + r.j0 * s;
        const x1 = L.x0 + r.i1 * s;
        const z1 = L.z0 + r.j1 * s;
        // A step round the tile: a road's widening reaches a sample within half a step of it.
        const touched = (!!heights && heights.touches(x0 - s, z0 - s, x1 + s, z1 + s)) || (carving && course!.touches(x0 - s, z0 - s, x1 + s, z1 + s));
        let raw = this.raw.get(key);
        if (!touched) {
          if (!raw) continue;
          this.copyIn(fine, r, raw);
          if (!this.pinned.has(key)) this.raw.delete(key);
          out.push(r);
          continue;
        }
        const w = r.i1 - r.i0 + 1;
        const h = r.j1 - r.j0 + 1;
        if (!raw) {
          raw = new Float32Array(w * h);
          this.copyOut(fine, r, raw);
          this.raw.set(key, raw);
        }
        const o = this.scratch.subarray(0, w * h);
        if (carving) {
          const k = this.carve;
          k.raw = raw;
          k.out = o;
          k.x0 = x0;
          k.dx = s;
          k.z0 = z0;
          k.dz = s;
          k.nx = w;
          k.nz = h;
          k.widen = s / 2;
          course!.layIn(k);
          k.raw = null;
          k.out = null;
          if (heights) this.layEdits(heights, o, o, x0, z0, w, h);
        } else if (heights) this.layEdits(heights, raw, o, x0, z0, w, h);
        else o.set(raw);
        this.copyIn(fine, r, o);
        out.push(r);
      }
    }
    this.laid = out.length;
    return out;
  }

  private layEdits(heights: HeightEdits, raw: Float32Array, out: Float32Array, x0: number, z0: number, w: number, h: number): void {
    const a = this.lay;
    a.raw = raw;
    a.out = out;
    a.x0 = x0;
    a.dx = this.lat.step;
    a.z0 = z0;
    a.dz = this.lat.step;
    a.nx = w;
    a.nz = h;
    heights.layIn(a);
    a.raw = null;
    a.out = null;
  }
}

/** A rectangle of the raw frame. */
export interface RawRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** The paint's 512 m tiles (families or colours painted) as raw rectangles (`GroundPaint`'s own tile numbers). */
export function paintedRects(keys: Iterable<number>, tileOf: (n: number) => { tx: number; tz: number }, size: number): RawRect[] {
  const out: RawRect[] = [];
  const seen = new Set<number>();
  for (const n of keys) {
    if (seen.has(n)) continue;
    seen.add(n);
    const t = tileOf(n);
    out.push({ x0: t.tx * size, z0: t.tz * size, x1: (t.tx + 1) * size, z1: (t.tz + 1) * size });
  }
  return out;
}

/**
 * What the paint asks of the live generator: every painted 512 m tile, its heights not moved. One function for an arrival
 * (`World.horizonRegenAsks`) and a file landed late (`World.horizonPaintLate`), so the two lay alike (W2's review).
 */
export function paintRegenAsks(paint: Pick<GroundPaint, 'fam' | 'col'>): (RawRect & { heights: boolean })[] {
  return paintedRects([...paint.fam.keys(), ...paint.col.keys()], paintTileOf, PAINT_TILE).map((r) => ({ ...r, heights: false }));
}

/**
 * A building layer's extent in the raw frame, as the near ground would have placed it (`TerrainSampler.addBuildingLayer`:
 * placed, turned, prepared, its boundaries' extent), parsed against a stand-in of the planet's generator that shares its
 * fractals and keeps its own shader families, so the planet's own group is never written. Null for a layer with no extent.
 */
export function layerExtent(bytes: Uint8Array, gen: TerrainGenerator, x: number, z: number, yaw: number): RawRect | null {
  const standIn = { fractalGroup: gen.fractalGroup, shaderGroup: new ShaderGroup(), noteEnvironment: () => {} } as unknown as TerrainGenerator;
  const layer = parseLayerFile(bytes, standIn);
  if (!layer) return null;
  layer.setPosition(x, z);
  layer.setRotation(yaw);
  layer.prepare();
  layer.calculateExtent();
  return extentOf(layer);
}

function extentOf(layer: Layer): RawRect | null {
  if (!layer.useExtent) return null;
  const e = layer.extent;
  if (!(e.x1 >= e.x0) || !(e.y1 >= e.y0)) return null;
  return { x0: e.x0, z0: e.y0, x1: e.x1, z1: e.y1 };
}

/** Whether a layer, or one under it, paints a seasonal environment area (the generator's own rule, read through its public parts). */
function seasonal(gen: TerrainGenerator, layer: Layer): boolean {
  for (const a of layer.affectors) if (a.active && a instanceof AffectorEnvironment && gen.environmentGroup.isSeasonal(a.familyId)) return true;
  for (const s of layer.layers) if (s.active && seasonal(gen, s)) return true;
  return false;
}

/** The extents of the generator's top-level layers that paint Life Day's area and run (the bake is made out of season). */
export function seasonalExtents(gen: TerrainGenerator): RawRect[] {
  const out: RawRect[] = [];
  for (const l of gen.layers) {
    if (!l.active || !seasonal(gen, l)) continue;
    const e = extentOf(l);
    if (e) out.push(e);
  }
  return out;
}

/**
 * One rectangle to make again, as the albedo reads it: the colour cells [i0, i1] by [j0, j1] that meet the raw rectangle
 * (with `pad` cells round it), and the 2 m grid that holds every 4 m pole of their tiles, every pole each cell's mean reads
 * and four poles of margin past them (a corner snapped onto, a slope filter's own normals).
 */
export interface RegenPlan {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  startX: number;
  startZ: number;
  n: number;
  m: number;
}

export const REGEN_STEP = 2;
const REGEN_MARGIN = 4;

export function regenPlan(colour: Lattice, r: RawRect, pad = 1): RegenPlan | null {
  const c = colour;
  const i0 = Math.max(0, Math.floor((r.x0 - c.x0) / c.step) - pad);
  const i1 = Math.min(c.nx - 1, Math.ceil((r.x1 - c.x0) / c.step) + pad);
  const j0 = Math.max(0, Math.floor((r.z0 - c.z0) / c.step) - pad);
  const j1 = Math.min(c.nz - 1, Math.ceil((r.z1 - c.z0) / c.step) + pad);
  if (i0 > i1 || j0 > j1) return null;
  const startX = c.x0 + i0 * c.step - c.step / 2 - REGEN_MARGIN * REGEN_STEP;
  const startZ = c.z0 + j0 * c.step - c.step / 2 - REGEN_MARGIN * REGEN_STEP;
  // Square, as the generator makes its grids: the longer side's poles each way.
  const n = Math.max(i1 - i0 + 1, j1 - j0 + 1) * (c.step / REGEN_STEP) + 1 + 2 * REGEN_MARGIN;
  return { i0, j0, i1, j1, startX, startZ, n, m: n };
}

/** What the live generator's grid gives a plan's cells: each 4 m pole's family and choice, each cell's colour mean. */
export function overridesOf(c: Lattice, p: RegenPlan, g: { shaders: Int32Array; children: Uint8Array; colors: Uint8Array }): { poles: PoleOverride; cells: ColourOverride } {
  const per = c.step / DETAIL_TILE;
  const pn = (p.i1 - p.i0 + 1) * per + 1;
  const pm = (p.j1 - p.j0 + 1) * per + 1;
  const px0 = c.x0 + p.i0 * c.step - c.step / 2;
  const pz0 = c.z0 + p.j0 * c.step - c.step / 2;
  const pole = (x: number, z: number) => ((z - p.startZ) / REGEN_STEP) * p.n + (x - p.startX) / REGEN_STEP;
  const fam = new Uint8Array(pn * pm);
  const choice = new Uint8Array(pn * pm);
  for (let b = 0; b < pm; b++) {
    for (let a = 0; a < pn; a++) {
      const k = pole(px0 + a * DETAIL_TILE, pz0 + b * DETAIL_TILE);
      const f = g.shaders[k];
      // A family past a byte is nought, as the bake keeps it (`horizonWorker.mjs`).
      fam[b * pn + a] = f > 255 || f < 0 ? 0 : f;
      choice[b * pn + a] = g.children[k];
    }
  }
  const w = p.i1 - p.i0 + 1;
  const h = p.j1 - p.j0 + 1;
  const rgb = new Uint8Array(w * h * 3);
  const W = c.step;
  const half = W / 4;
  for (let j = 0; j < h; j++) {
    const z = c.z0 + (p.j0 + j) * W;
    for (let i = 0; i < w; i++) {
      const x = c.x0 + (p.i0 + i) * W;
      // The converter's own mean: weights 1, 2, ..., 2, 1 over the cell's poles each way (`horizonWorker.mjs`'s fineJob).
      let r = 0;
      let gg = 0;
      let bb = 0;
      for (let bz = -half; bz <= half; bz++) {
        const wz = bz === -half || bz === half ? 1 : 2;
        for (let ax = -half; ax <= half; ax++) {
          const wt = wz * (ax === -half || ax === half ? 1 : 2);
          const k = pole(x + ax * 2, z + bz * 2) * 3;
          r += wt * g.colors[k];
          gg += wt * g.colors[k + 1];
          bb += wt * g.colors[k + 2];
        }
      }
      const o = (j * w + i) * 3;
      const d = W * W;
      rgb[o] = Math.round(r / d);
      rgb[o + 1] = Math.round(gg / d);
      rgb[o + 2] = Math.round(bb / d);
    }
  }
  return { poles: { x0: px0, z0: pz0, n: pn, m: pm, fam, choice }, cells: { i0: p.i0, j0: p.j0, w, h, rgb } };
}

/** The fine samples a raw rectangle holds (inclusive), or null. */
export function samplesIn(lat: Lattice, r: RawRect): SampleRect | null {
  const i0 = Math.max(0, Math.ceil((r.x0 - lat.x0) / lat.step));
  const i1 = Math.min(lat.nx - 1, Math.floor((r.x1 - lat.x0) / lat.step));
  const j0 = Math.max(0, Math.ceil((r.z0 - lat.z0) / lat.step));
  const j1 = Math.min(lat.nz - 1, Math.floor((r.z1 - lat.z0) / lat.step));
  return i0 <= i1 && j0 <= j1 ? { i0, j0, i1, j1 } : null;
}
