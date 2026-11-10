// The far ground's rings for a world with no converted terrain (the horizon pass's h6b, DESIGN.md §2.12 and §8, widened by
// the owner to every packless ground world): a real-elevation world's raster, a world of yours' flat ground or test-terrain
// recipe, and a world whose raster is not served standing on the planet's noise. Nothing is baked: the decode worker makes the
// bake's own lattices (`planBake`, about (0, 0), the `fineMost` rule's step) and sections here, behind the arrival's loading
// screen, and from there on the world is an ordinary field: the overlays, the live edits, the windows and the far cards' surface
// take it unchanged.
//
// **The heights**: `farAt`, the ground as `Terrain.groundRawAt` answers it less the fractal detail (the raster's `demDetail`
// and the noise's `terrain.detail`: a metre of relief at a 9 m wavelength, which 8 m samples would only alias; the near ground
// keeps it and the rings' drop covers it at the seam). `nearAt` is the near ground's own to the bit, what the shape window's 2 m
// blocks and a ruled world's families read. **The bake is raw**: nothing of the owner's is in it, the edits, the carve and the
// paint are laid over it in the browser as on a converted world (§2.3).
//
// **The colours**: the families the world names (its lent ground's rules or base) on the 8 m pattern, the wash's colour
// at each cell, white with none. A world that names no ground (no rules, no base) has no pictures to compose: `PlainColours`
// gives its albedo the very colour its chunks' vertices take (`Terrain.colorAt`, its palette by height, slope and shore, the
// per-half-metre grain at its mean), and its composition window stays empty.
//
// Pure: no three, no page. Node runs every line with type stripping: every import with its `.ts` extension, no enum, no
// namespace, no constructor parameter properties.

import { GENERATOR_REVISION } from '../../swg/terrain/generator.ts';
import type { CourseCarve } from '../../swg/terrain/courseCarve.ts';
import { CARVE_BUCKET, carveAsk } from '../../swg/terrain/courseCarve.ts';
import { HEIGHT_TILE, layAsk, type HeightEdits } from '../../swg/terrain/heightEdits.ts';
import { PAINT_TILE, paintTileNumber, paintTileOf } from '../../swg/terrain/groundPaint.ts';
import { DemShader, type GroundRules } from '../demShader.ts';
import { madeDemPatch, makeDemPatch, type DemMeta, type DemPatch } from '../demTerrain.ts';
import { Wash, type WashSpec } from '../demWash.ts';
import { FBM } from '../noise.ts';
import { ALBEDO_SCALE, encByte } from './horizonDecode.ts';
import { HORIZON_FORMAT, HORIZON_SECTIONS, planBake, sectionSize, type HeightLattice, type HorizonHeader, type Lattice } from './horizonFile.ts';
import type { ShapeTerrain } from './shapeWindow.ts';

/** The planet's own noise block (`PlanetDef.terrain`). */
export interface MadeNoise {
  base: number;
  amplitude: number;
  frequency: number;
  octaves: number;
  ridged: number;
  flatten: number;
  detail: number;
}

/** A world's palette and its bands, what its plain chunks' vertices are coloured by (`Terrain.colorAt`). */
export interface PlainGround {
  low: number;
  mid: number;
  high: number;
  slope: number;
  shore: number;
  minH: number;
  maxH: number;
  waterLevel: number;
  water: boolean;
}

/** Everything the worker makes a world's rings from: plain data, so it crosses to the worker by the structured clone. */
export interface MadeGroundSpec {
  world: string;
  /** Metres a side of the square its ground fills, about (0, 0). */
  size: number;
  made: 'raster' | 'flat' | 'noise';
  /** A flat ground's height. */
  height: number;
  /** The raster's own bytes (a copy: the worker keeps them for the shape window), its `base.json` and how it is laid. */
  source: { raw: ArrayBuffer; meta: DemMeta; where: { centreX?: number; centreZ?: number; size?: number; lift?: number; feather?: number } } | null;
  /** The raster's fractal detail, metres (`Terrain.demDetail`). */
  detail: number;
  /** The raster's lift: game height less metres above sea level. */
  lift: number;
  terrain: MadeNoise;
  seed: number;
  /** The families the world's lent ground names (its rules, its base), by the lent pack's ids; null: none (a plain world). */
  families: { spec: GroundRules; names: [string, number][]; lift: number; baseId: number } | null;
  wash: WashSpec | null;
  /** What a world that names no ground is coloured by; null with families. */
  plain: PlainGround | null;
}

/** A made world's ground: the planet's noise and the raster, as its `Terrain` answers them, in the worker. */
export class MadeGround {
  readonly spec: MadeGroundSpec;
  readonly patch: DemPatch;
  readonly rules: DemShader | null;
  readonly wash: Wash | null;
  private readonly fbm: FBM;
  private readonly detail: FBM;
  private ux = 0.5;
  private uz = 0.5;
  private readonly underFar = (): number => this.noiseAt(this.ux, this.uz);
  private readonly underNear = (): number => this.noiseFull(this.ux, this.uz);
  /** The near ground's height, as one function made once (a ruled world's families read it five times a sample). */
  readonly nearHeight = (x: number, z: number): number => this.nearAt(x, z);

  constructor(spec: MadeGroundSpec) {
    this.spec = spec;
    this.fbm = new FBM(spec.seed);
    this.detail = new FBM(spec.seed * 31 + 7);
    this.patch = spec.source ? makeDemPatch(spec.source.raw, spec.source.meta, spec.source.where) : madeDemPatch(spec.made === 'flat' ? 'flat' : 'noise', spec.size, spec.height, spec.terrain);
    const f = spec.families;
    let rules: DemShader | null = null;
    if (f) {
      rules = new DemShader(f.spec, new Map(f.names), f.lift, 4);
      rules.baseId = f.baseId;
    }
    this.rules = rules;
    this.wash = spec.wash ? new Wash(spec.wash) : null;
  }

  /** The planet's noise at a game point, less its detail: `Terrain.rawHeightAt`'s own arithmetic. */
  noiseAt(x: number, z: number): number {
    const t = this.spec.terrain;
    const f = t.frequency;
    let v = this.fbm.fbm(x * f, z * f, t.octaves);
    if (t.ridged > 0) {
      const r = this.fbm.ridged(x * f * 0.7 + 100, z * f * 0.7 + 100, 4);
      v = v * (1 - t.ridged) + (r * 2 - 1) * t.ridged;
    }
    if (t.flatten !== 1) v = Math.sign(v) * Math.pow(Math.abs(v), t.flatten);
    return t.base + v * t.amplitude;
  }

  /** `Terrain.rawHeightAt` to the bit. */
  noiseFull(x: number, z: number): number {
    const t = this.spec.terrain;
    const d = t.detail > 0 ? this.detail.fbm(x * 0.09, z * 0.09, 2) * t.detail : 0;
    return this.noiseAt(x, z) + d;
  }

  /** The rings' ground at a game point: `groundRawAt` less the fractal detail. */
  farAt(x: number, z: number): number {
    this.ux = x;
    this.uz = z;
    const h = this.patch.heightAt(x, z, this.underFar);
    return h !== null ? h : this.noiseAt(x, z);
  }

  /** The near ground at a game point, as `Terrain.groundRawAt` answers it on a world with no converted terrain. */
  nearAt(x: number, z: number): number {
    this.ux = x;
    this.uz = z;
    const h = this.patch.heightAt(x, z, this.underNear);
    if (h !== null) {
      const dd = this.spec.detail;
      return dd > 0 ? h + this.detail.fbm(x * 0.11, z * 0.11, 3) * dd : h;
    }
    return this.noiseFull(x, z);
  }

  /** A raw-frame grid of the near ground's heights (`n` by `n`, every `step` m from raw (startX, startZ)): the shape window's blocks. */
  polesIn(startX: number, startZ: number, n: number, step: number): Float32Array {
    const out = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = startZ + j * step;
      for (let i = 0; i < n; i++) out[j * n + i] = this.nearAt(-(startX + i * step), z);
    }
    return out;
  }

  /** The family a world with no rules names (nought with none); -1 with rules, which ask at every place. */
  get constantFamily(): number {
    const r = this.rules;
    if (!r) return 0;
    if (r.groundSpec.rules.length) return -1;
    return r.familyAt(0, 0, this.nearHeight);
  }
}

const ORIGIN = { x: 0, z: 0 };

/** A sRGB channel to linear light, as three reads a colour's hex (`THREE.Color`, `SRGBToLinear`). */
function srgbLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** The grain on a plain chunk's vertices (`0.9 + 0.14 hash`) at its mean: every metre's half of it is below what the rings can hold. */
export const PLAIN_GRAIN_MEAN = 0.97;

/** A plain world's colour at a height and an up-normal: `Terrain.colorAt`'s arithmetic, the grain at its mean. */
export class PlainColours {
  private readonly table = new Float64Array(15);
  private readonly p: PlainGround;
  constructor(p: PlainGround) {
    this.p = p;
    const hexes = [p.low, p.mid, p.high, p.slope, p.shore];
    for (let i = 0; i < 5; i++) {
      this.table[i * 3] = srgbLinear(((hexes[i] >> 16) & 255) / 255);
      this.table[i * 3 + 1] = srgbLinear(((hexes[i] >> 8) & 255) / 255);
      this.table[i * 3 + 2] = srgbLinear((hexes[i] & 255) / 255);
    }
  }

  /** Linear light into `out`, three numbers. */
  colourAt(h: number, ny: number, out: Float64Array): void {
    const p = this.p;
    const c = this.table;
    const span = p.maxH - p.minH;
    const t = span > 1e-6 ? Math.min(1, Math.max(0, (h - p.minH) / span)) : 0.5;
    const a = t < 0.5 ? 0 : 3;
    const f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    let r = c[a] + (c[a + 3] - c[a]) * f;
    let g = c[a + 1] + (c[a + 4] - c[a + 1]) * f;
    let b = c[a + 2] + (c[a + 5] - c[a + 2]) * f;
    if (p.water) {
      const s0 = Math.min(1, Math.max(0, 1 - (h - p.waterLevel) / 2.5));
      const s = s0 * s0;
      r += (c[12] - r) * s;
      g += (c[13] - g) * s;
      b += (c[14] - b) * s;
    }
    const steep = Math.min(1, Math.max(0, (0.72 - ny) / 0.32));
    r += (c[9] - r) * steep;
    g += (c[10] - g) * steep;
    b += (c[11] - b) * steep;
    out[0] = r * PLAIN_GRAIN_MEAN;
    out[1] = g * PLAIN_GRAIN_MEAN;
    out[2] = b * PLAIN_GRAIN_MEAN;
  }
}

const encPlain = (v: number): number => encByte(Math.min(1, Math.max(0, v / ALBEDO_SCALE)));
const scratchRgb = new Float64Array(3);

/**
 * A plain world's albedo over a rectangle of a lattice's samples (inclusive), RGBA into `out` with rows `ow` wide from
 * sample (oi, oj), each from its height and the central differences round it (one-sided at the lattice's edge). A chunk's
 * vertex colour at the sample's own place, as the tile program's albedo is a tile's. Pure.
 */
export function plainAlbedoRect(colours: PlainColours, h: Float32Array, L: Lattice, i0: number, j0: number, i1: number, j1: number, out: Uint8Array, oi = 0, oj = 0, ow = L.nx): Uint8Array {
  const s = L.step;
  const nx = L.nx;
  const nz = L.nz;
  const rgb = scratchRgb;
  for (let j = j0; j <= j1; j++) {
    const jd = j > 0 ? j - 1 : j;
    const ju = j < nz - 1 ? j + 1 : j;
    for (let i = i0; i <= i1; i++) {
      const il = i > 0 ? i - 1 : i;
      const ir = i < nx - 1 ? i + 1 : i;
      const k = j * nx + i;
      const dx = (h[j * nx + ir] - h[j * nx + il]) / ((ir - il) * s || 1);
      const dz = (h[ju * nx + i] - h[jd * nx + i]) / ((ju - jd) * s || 1);
      colours.colourAt(h[k], 1 / Math.sqrt(dx * dx + 1 + dz * dz), rgb);
      const o = ((j - oj) * ow + i - oi) * 4;
      out[o] = encPlain(rgb[0]);
      out[o + 1] = encPlain(rgb[1]);
      out[o + 2] = encPlain(rgb[2]);
      out[o + 3] = 0;
    }
  }
  return out;
}

/** A world's rings' sections, in the bake's own shapes, the heights as floats (nothing to quantise: they cross no file). */
export interface MadeBake {
  header: HorizonHeader;
  fine: Float32Array;
  coarse: Float32Array;
  families: Uint8Array;
  colour: Uint8Array;
  coarseFamilies: Uint8Array;
  coarseColour: Uint8Array;
}

const heightLattice = (L: Lattice, h: Float32Array): HeightLattice => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < h.length; k++) {
    if (h[k] < lo) lo = h[k];
    if (h[k] > hi) hi = h[k];
  }
  return { ...L, lo, q: hi > lo ? (hi - lo) / 65535 : 1 };
};

const byteFamily = (f: number): number => (f > 255 || f < 0 ? 0 : f);

/**
 * The bake's own lattices (`planBake` about (0, 0): 8 m, or 16 m where 8 m would pass `fineMost` samples a side) and sections
 * made for a world with no converted terrain. The ground is sampled in the game's frame (`x = -raw`), as `Terrain` reads it.
 */
export function makeBake(g: MadeGround): MadeBake {
  const spec = g.spec;
  const plan = planBake(spec.size, ORIGIN);
  const F = plan.fine;
  const C = plan.coarse;
  const G = plan.ground;
  const K = plan.colour;
  const fine = new Float32Array(F.nx * F.nz);
  for (let j = 0; j < F.nz; j++) {
    const z = F.z0 + j * F.step;
    for (let i = 0; i < F.nx; i++) fine[j * F.nx + i] = g.farAt(-(F.x0 + i * F.step), z);
  }
  // A coarse sample inside the fine extent stands on a fine one (every eighth, or fourth at 16 m): read, not made again.
  const coarse = new Float32Array(C.nx * C.nz);
  const fx1 = F.x0 + (F.nx - 1) * F.step;
  const fz1 = F.z0 + (F.nz - 1) * F.step;
  for (let j = 0; j < C.nz; j++) {
    const z = C.z0 + j * C.step;
    for (let i = 0; i < C.nx; i++) {
      const x = C.x0 + i * C.step;
      coarse[j * C.nx + i] = x >= F.x0 && x <= fx1 && z >= F.z0 && z <= fz1 ? fine[((z - F.z0) / F.step) * F.nx + (x - F.x0) / F.step] : g.farAt(-x, z);
    }
  }
  const constant = g.constantFamily;
  const rules = g.rules;
  const families = new Uint8Array(G.nx * G.nz);
  if (constant >= 0) families.fill(byteFamily(constant));
  else if (rules) {
    // The family lattice is 8 m at any width, and a rule asks five heights: on a wide world (a 16 m step, 19 million corners
    // at 32 km, near a minute) the rules are asked at the heights' own step and each answer held over its block.
    const every = Math.max(1, Math.round(F.step / G.step));
    for (let j = 0; j < G.nz; j += every) {
      const z = G.z0 + j * G.step;
      for (let i = 0; i < G.nx; i += every) {
        const f = byteFamily(rules.familyAt(-(G.x0 + i * G.step), z, g.nearHeight));
        for (let b = j; b < Math.min(G.nz, j + every); b++) for (let a = i; a < Math.min(G.nx, i + every); a++) families[b * G.nx + a] = f;
      }
    }
  }
  const coarseFamilies = new Uint8Array(C.nx * C.nz);
  if (constant >= 0) coarseFamilies.fill(byteFamily(constant));
  else if (rules) {
    for (let j = 0; j < C.nz; j++) {
      const z = C.z0 + j * C.step;
      for (let i = 0; i < C.nx; i++) coarseFamilies[j * C.nx + i] = byteFamily(rules.familyAt(-(C.x0 + i * C.step), z, g.nearHeight));
    }
  }
  const colour = new Uint8Array(K.nx * K.nz * 3);
  washInto(g, K, fine, F, colour);
  const coarseColour = new Uint8Array(C.nx * C.nz * 3);
  washInto(g, C, coarse, C, coarseColour);
  const fineH = heightLattice(F, fine);
  const coarseH = heightLattice(C, coarse);
  const parts = { fine: fineH, ground: G, colour: K, coarse: coarseH };
  const header: HorizonHeader = {
    format: HORIZON_FORMAT,
    source: { generator: GENERATOR_REVISION, trn: { length: 0, sha1: '' }, inputs: spec.made, centre: { ...ORIGIN }, layers: { sha1: '', list: [] }, lifeDay: false, made: 'browser' },
    ...parts,
    sections: HORIZON_SECTIONS.map((name) => ({ name, offset: 0, length: 0, size: sectionSize(parts, name) })),
  };
  return { header, fine, coarse, families, colour, coarseFamilies, coarseColour };
}

/** Each cell of a colour lattice the wash's colour at its place (white with no wash), its slope from the heights lattice round it. */
function washInto(g: MadeGround, L: Lattice, h: Float32Array, H: Lattice, out: Uint8Array): void {
  const wash = g.wash;
  if (!wash) {
    out.fill(255);
    return;
  }
  const px = new Uint8Array(3);
  const lift = g.spec.lift;
  for (let j = 0; j < L.nz; j++) {
    const z = L.z0 + j * L.step;
    const hj = Math.round((z - H.z0) / H.step);
    const jd = hj > 0 ? hj - 1 : hj;
    const ju = hj < H.nz - 1 ? hj + 1 : hj;
    for (let i = 0; i < L.nx; i++) {
      const x = L.x0 + i * L.step;
      const hi = Math.round((x - H.x0) / H.step);
      const il = hi > 0 ? hi - 1 : hi;
      const ir = hi < H.nx - 1 ? hi + 1 : hi;
      const dx = (h[hj * H.nx + ir] - h[hj * H.nx + il]) / ((ir - il) * H.step || 1);
      const dz = (h[ju * H.nx + hi] - h[jd * H.nx + hi]) / ((ju - jd) * H.step || 1);
      const slope = Math.atan(Math.sqrt(dx * dx + dz * dz)) * 57.29577951308232;
      wash.colourAt(x, z, h[hj * H.nx + hi] - lift, slope, px);
      const o = (j * L.nx + i) * 3;
      out[o] = px[0];
      out[o + 1] = px[1];
      out[o + 2] = px[2];
    }
  }
}

/** A plain world's two albedos. */
export function plainAlbedos(b: MadeBake, p: PlainGround): { albedo: Uint8Array; coarseAlbedo: Uint8Array } {
  const colours = new PlainColours(p);
  const F = b.header.colour;
  const C = b.header.coarse;
  const albedo = plainAlbedoRect(colours, b.fine, b.header.fine, 0, 0, F.nx - 1, F.nz - 1, new Uint8Array(F.nx * F.nz * 4));
  const coarseAlbedo = plainAlbedoRect(colours, b.coarse, C, 0, 0, C.nx - 1, C.nz - 1, new Uint8Array(C.nx * C.nz * 4));
  return { albedo, coarseAlbedo };
}

/** The paint's 512 m tiles over a raw rectangle (a ruled or washed world's families and colours moved with its heights). */
export function paintKeysOver(x0: number, z0: number, x1: number, z1: number): number[] {
  const out: number[] = [];
  const tx0 = Math.floor(Math.min(x0, x1) / PAINT_TILE);
  const tx1 = Math.floor(Math.max(x0, x1) / PAINT_TILE);
  const tz0 = Math.floor(Math.min(z0, z1) / PAINT_TILE);
  const tz1 = Math.floor(Math.max(z0, z1) / PAINT_TILE);
  for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) out.push(paintTileNumber(tx, tz));
  return out;
}

/** The paint's 512 m tiles under rectangles of a made world's game frame (the raw frame mirrored in x about (0, 0)), each once. */
export function paintKeysOverGame(rects: readonly { x0: number; z0: number; x1: number; z1: number }[], n: number): Set<number> {
  const out = new Set<number>();
  for (let k = 0; k < n; k++) {
    const r = rects[k];
    for (const key of paintKeysOver(-r.x1, r.z0, -r.x0, r.z1)) out.add(key);
  }
  return out;
}

/** A raw rectangle a made world composes again from its near ground's own rules (`HorizonField.regenerate`), no height moved. */
export interface MadeRegenAsk {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  heights: boolean;
}

/** One rectangle a 512 m paint tile, each tile once, in the order first named. */
function paintTileAsks(keys: Iterable<number>): MadeRegenAsk[] {
  const out: MadeRegenAsk[] = [];
  const seen = new Set<number>();
  for (const n of keys) {
    if (seen.has(n)) continue;
    seen.add(n);
    const t = paintTileOf(n);
    out.push({ x0: t.tx * PAINT_TILE, z0: t.tz * PAINT_TILE, x1: (t.tx + 1) * PAINT_TILE, z1: (t.tz + 1) * PAINT_TILE, heights: false });
  }
  return out;
}

/**
 * The rectangles a made world composes again at an arrival (h6b): every painted 512 m tile, and, where its families or
 * colours move with its heights (`movesWithHeight`: a rule or a wash), every tile its kept height edits and its drawn
 * courses' carve reach, since the near ground asks its rules and its wash of `heightAt`, which carries both, while the worker
 * made the bake's from the raw ground (h6b's review round). A plain world, and a ruled one with no edit and no course, asks
 * only its paint.
 */
export function madeRegenAsksOf(paint: { readonly empty: boolean; readonly fam: { keys(): Iterable<number> }; readonly col: { keys(): Iterable<number> } } | null, edits: { entries(): Iterable<{ tx: number; tz: number }> } | null, course: { cells(): [number, number][] } | null, movesWithHeight: boolean): MadeRegenAsk[] {
  const asks = paint && !paint.empty ? paintTileAsks([...paint.fam.keys(), ...paint.col.keys()]) : [];
  if (!movesWithHeight) return asks;
  const moved = new Set<number>();
  if (edits) for (const e of edits.entries()) for (const k of paintKeysOver(e.tx * HEIGHT_TILE, e.tz * HEIGHT_TILE, (e.tx + 1) * HEIGHT_TILE, (e.tz + 1) * HEIGHT_TILE)) moved.add(k);
  if (course) for (const [cx, cz] of course.cells()) for (const k of paintKeysOver(cx * CARVE_BUCKET, cz * CARVE_BUCKET, (cx + 1) * CARVE_BUCKET, (cz + 1) * CARVE_BUCKET)) moved.add(k);
  asks.push(...paintTileAsks(moved));
  return asks;
}

/** What a made world's paint reads of its ground at a game point (`Terrain`'s own rules: the game hands them over). */
export interface MadePoleSource {
  /** The family the chunks name there, the paint's first. */
  familyAt(gx: number, gz: number): number;
  /** The alternate a pole takes there, a painted cell's or the pole's own. */
  choiceAt(gx: number, gz: number): number;
  /** The colour map at a game point, three bytes into `out` (`Terrain.demColourAt`). */
  colourAt(gx: number, gz: number, out: Uint8Array): void;
  /** Nothing reddens the ground (no wash and no colour painted): every pole white, none asked. */
  white: boolean;
}

/** How long a slice of a paint's grid runs before the frame gets its turn, milliseconds [ours]. */
export const MADE_POLES_SLICE_MS = 2;

/**
 * The 2 m grid a paint's rectangle is made again from (`PoleGenerate`, `overridesOf` reads it) on a world with no terrain worker:
 * worked on the main thread, a slice of rows at a time with a breath between, each 4 m pole's family and choice (all
 * `overridesOf` reads of them) and every pole's colour where anything colours the ground. The heights are left out: a paint
 * moves none.
 */
export async function madePoles(src: MadePoleSource, startX: number, startZ: number, n: number, step: number, breath: () => Promise<void>, now: () => number = () => performance.now()): Promise<{ heights: Float32Array; shaders: Int32Array; children: Uint8Array; colors: Uint8Array }> {
  const shaders = new Int32Array(n * n);
  const children = new Uint8Array(n * n);
  const colors = new Uint8Array(n * n * 3);
  if (src.white) colors.fill(255);
  const px = new Uint8Array(3);
  let t0 = now();
  for (let j = 0; j < n; j++) {
    const rz = startZ + j * step;
    const pole4z = rz % 4 === 0;
    for (let i = 0; i < n; i++) {
      const rx = startX + i * step;
      const k = j * n + i;
      if (pole4z && rx % 4 === 0) {
        shaders[k] = src.familyAt(-rx, rz);
        children[k] = src.choiceAt(-rx, rz);
      }
      if (!src.white) {
        src.colourAt(-rx, rz, px);
        colors[k * 3] = px[0];
        colors[k * 3 + 1] = px[1];
        colors[k * 3 + 2] = px[2];
      }
    }
    if (now() - t0 >= MADE_POLES_SLICE_MS) {
      await breath();
      t0 = now();
    }
  }
  return { heights: new Float32Array(0), shaders, children, colors };
}

/** Poles a side of a made world's block grid (`ShapeTerrain`): the block's own 32 and its two of margin before them. */
export const MADE_BLOCK_POLES = 34;
const MADE_BLOCK_WIDTH = 64;
const MADE_BLOCK_START = 4;

/** What a made world's near ground lays over its raw heights: its edits and its course (the terrain's own stores). */
export interface MadeStores {
  readonly heights: HeightEdits | null;
  readonly course: CourseCarve | null;
}

const blockCarve = carveAsk();
const blockLay = layAsk();

/**
 * A block-shaped grid laid as the near ground lays its poles (the drawn courses carved, then the edits over them): in place,
 * from the raw heights it holds; left as it came where neither touches it. `TerrainSampler.layBlockHeights`' own rule.
 */
export function layMadeBlock(bx: number, bz: number, heights: Float32Array, stores: MadeStores, np = MADE_BLOCK_POLES): void {
  const h = stores.heights;
  const c = stores.course;
  if (!h && !c) return;
  const step = 2;
  const x0 = bx * MADE_BLOCK_WIDTH - MADE_BLOCK_START;
  const z0 = bz * MADE_BLOCK_WIDTH - MADE_BLOCK_START;
  const x1 = x0 + (np - 1) * step;
  const z1 = z0 + (np - 1) * step;
  if ((!h || !h.touches(x0, z0, x1, z1)) && (!c || !c.touches(x0, z0, x1, z1))) return;
  const carving = !!c && !c.empty;
  const raw = heights.slice();
  if (carving) {
    const k = blockCarve;
    k.raw = raw;
    k.out = heights;
    k.x0 = x0;
    k.dx = step;
    k.z0 = z0;
    k.dz = step;
    k.nx = np;
    k.nz = np;
    k.widen = 0;
    c.layIn(k);
    k.raw = null;
    k.out = null;
  }
  if (h) {
    const a = blockLay;
    a.raw = carving ? heights : raw;
    a.out = heights;
    a.x0 = x0;
    a.dx = step;
    a.z0 = z0;
    a.dz = step;
    a.nx = np;
    a.nz = np;
    h.layIn(a);
    a.raw = null;
    a.out = null;
  }
}

/** The rings' shape window's source over a made world (`shapeSourceOf`'s `ShapeTerrain`): no cache of blocks, the decode worker's raster for its poles. */
export function madeShapeTerrain(field: { readonly workerUp: boolean; madePoles(startX: number, startZ: number, n: number, step: number): Promise<{ heights: Float32Array } | null> }, stores: MadeStores): ShapeTerrain {
  return {
    sampler: {
      poleStep: 2,
      numberOfPoles: MADE_BLOCK_POLES,
      copyInnerHeights: () => false,
      layBlockHeights: (bx, bz, heights) => layMadeBlock(bx, bz, heights, stores),
      blockStart: (bx, bz) => ({ x: bx * MADE_BLOCK_WIDTH - MADE_BLOCK_START, z: bz * MADE_BLOCK_WIDTH - MADE_BLOCK_START }),
    },
    get workerUp() {
      return field.workerUp;
    },
    generatePoles: (startX, startZ, n, step) => field.madePoles(startX, startZ, n, step),
  };
}
