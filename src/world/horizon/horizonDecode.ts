// The browser's half of the far ground's bake made ready to draw (DESIGN.md §2.5, §2.13), worked in a worker of its own
// (`horizonDecodeWorker.ts`) behind the loading screen: the sections inflated, the heights put back as float32, the
// normals worked out of them, the leaves' min/max pyramid, the albedo composed per 4 m tile the way the tile program
// draws it (every family at its pictures' mean, the masks averaged over sixteen places of the tile, then the colour
// map's tint), and the composition window: each 4 m tile's layers and mask codes as the near ground's chunk builder
// works them out, and the colour cells' tint, round the eye, from which the ring draws the tile program's own
// composition inside the ground detail distance (the third wave). Every function here is pure and node runs it.
import { childChoiceAt } from '../../swg/terrain/generator.ts';
import { composeTile, srgbDecode, srgbEncode, tintGamma, type MaskSample, type TintReference } from '../groundMath.ts';
import { tileLayers, type GroundTiler } from '../groundTiles.ts';
import { decodeHeights, sectionOf, type HorizonHeader, type HorizonSectionName, type Lattice } from './horizonFile.ts';
import { LEAF, LEVELS_MOST, type MinMaxPyramid } from './horizonMath.ts';

/** The albedo is stored at this share of itself, so a tint past one keeps its colour in eight bits (the shader takes it back). */
export const ALBEDO_SCALE = 2;
/** A tile of the composition window: 4 m, the near ground's own (each 2 m cell lies in one). */
export const DETAIL_TILE = 4;

// ---------------------------------------------------------------- the composition window (the third wave)

/**
 * How far past the ground detail distance the composition window reaches, metres: it is made again round the eye by
 * strips once the eye has moved `STRIP_TILES` tiles off its middle, so this is what a strip still on its way may lag
 * by before a pixel inside the distance reads a tile the window has not got (one that does reads the far albedo).
 */
export const WINDOW_SLACK = 512;
/** The window's side in tiles is a multiple of this. */
export const WINDOW_ROUND = 64;
/** How far (tiles) the eye moves off the window's middle before a strip makes it again round the eye. */
export const STRIP_TILES = 32;

/** The window's side in 4 m tiles for a ground detail distance (metres): the distance and its slack each way, rounded up. */
export function windowTiles(reach: number): number {
  const r = Math.max(0, Number.isFinite(reach) ? reach : 0);
  return Math.max(4 * WINDOW_ROUND, Math.ceil((2 * (r + WINDOW_SLACK)) / (DETAIL_TILE * WINDOW_ROUND)) * WINDOW_ROUND);
}

/** The tint window's side in colour cells for a window of `S` tiles on a colour lattice of `step` metres: every cell a bilinear inside it reads. */
export function tintCells(S: number, step: number): number {
  return Math.ceil((S * DETAIL_TILE) / step) + 2;
}

/** Where a window stands: its first tile (raw tile index, raw = 4 x index), its side, its tint window's first cell and side. */
export interface WindowPlace {
  ox: number;
  oz: number;
  S: number;
  ci0: number;
  cj0: number;
  T: number;
}

/** The window of `S` tiles centred on raw (rx, rz), and its tint window on the colour lattice `colour`. */
export function windowPlace(rx: number, rz: number, S: number, colour: Lattice, out: WindowPlace = { ox: 0, oz: 0, S: 0, ci0: 0, cj0: 0, T: 0 }): WindowPlace {
  out.S = S;
  out.ox = Math.floor(rx / DETAIL_TILE) - S / 2;
  out.oz = Math.floor(rz / DETAIL_TILE) - S / 2;
  out.T = tintCells(S, colour.step);
  out.ci0 = Math.floor((out.ox * DETAIL_TILE - colour.x0) / colour.step);
  out.cj0 = Math.floor((out.oz * DETAIL_TILE - colour.z0) / colour.step);
  return out;
}

/** A rectangle of a window's index space (tiles or cells): `w` by `h` from (x0, z0). */
export interface IndexRect {
  x0: number;
  z0: number;
  w: number;
  h: number;
}

/**
 * What of a window of side `S` from (nx, nz) the window from (ox, oz) did not hold: none when they are the same, the whole
 * new window when they share nothing, else at most two rectangles (the columns the new one gained, whole, and the rows it
 * gained over the columns both hold).
 */
export function freshRects(ox: number, oz: number, nx: number, nz: number, S: number): IndexRect[] {
  const dx = nx - ox;
  const dz = nz - oz;
  if (dx === 0 && dz === 0) return [];
  if (Math.abs(dx) >= S || Math.abs(dz) >= S) return [{ x0: nx, z0: nz, w: S, h: S }];
  const out: IndexRect[] = [];
  // The columns gained, every row of the new window.
  if (dx > 0) out.push({ x0: ox + S, z0: nz, w: dx, h: S });
  else if (dx < 0) out.push({ x0: nx, z0: nz, w: -dx, h: S });
  // The rows gained, over the columns both windows hold.
  const cx0 = Math.max(ox, nx);
  const cx1 = Math.min(ox, nx) + S;
  if (cx1 > cx0) {
    if (dz > 0) out.push({ x0: cx0, z0: oz + S, w: cx1 - cx0, h: dz });
    else if (dz < 0) out.push({ x0: cx0, z0: nz, w: cx1 - cx0, h: -dz });
  }
  return out;
}

/**
 * What of a rectangle of index space lies inside the window of side `S` from (x0, z0), pushed onto `out` (nothing when
 * they do not meet): a rectangle regenerated (the paint, a dropped building's ground) is made again in the window by the
 * strip path, and only where the window holds it, since a tile past the window would land on another tile's texel.
 */
export function clipRect(r: IndexRect, x0: number, z0: number, S: number, out: IndexRect[]): void {
  const a = Math.max(r.x0, x0);
  const b = Math.max(r.z0, z0);
  const c = Math.min(r.x0 + r.w, x0 + S);
  const d = Math.min(r.z0 + r.h, z0 + S);
  if (c > a && d > b) out.push({ x0: a, z0: b, w: c - a, h: d - b });
}

/**
 * The window's tiles an overlay's poles reach: every tile one of the poles is a corner of (a pole at raw x is the corner of
 * the tiles x/4 - 1 and x/4), so a strip over this rectangle makes every tile the overlay changed again, and nothing else.
 */
export function poleTiles(p: Pick<PoleOverride, 'x0' | 'z0' | 'n' | 'm'>): IndexRect {
  const x0 = Math.floor(p.x0 / DETAIL_TILE) - 1;
  const z0 = Math.floor(p.z0 / DETAIL_TILE) - 1;
  const x1 = Math.ceil((p.x0 + (p.n - 1) * DETAIL_TILE) / DETAIL_TILE);
  const z1 = Math.ceil((p.z0 + (p.m - 1) * DETAIL_TILE) / DETAIL_TILE);
  return { x0, z0, w: x1 - x0 + 1, h: z1 - z0 + 1 };
}

/** A piece of a rectangle as it lands in a toroidal texture of side `S`: from (sx, sz) of the rectangle's own data, at texel (dx, dz). */
export interface WrapPiece {
  sx: number;
  sz: number;
  dx: number;
  dz: number;
  w: number;
  h: number;
}

const modS = (v: number, S: number) => ((v % S) + S) % S;

/** A rectangle of index space split where it wraps round a toroidal texture of side `S` (at most four pieces). */
export function wrapPieces(r: IndexRect, S: number): WrapPiece[] {
  const out: WrapPiece[] = [];
  for (let z = r.z0; z < r.z0 + r.h; ) {
    const dz = modS(z, S);
    const h = Math.min(S - dz, r.z0 + r.h - z);
    for (let x = r.x0; x < r.x0 + r.w; ) {
      const dx = modS(x, S);
      const w = Math.min(S - dx, r.x0 + r.w - x);
      out.push({ sx: x - r.x0, sz: z - r.z0, dx, dz, w, h });
      x += w;
    }
    z += h;
  }
  return out;
}

/**
 * The composition window's texels over a rectangle of tiles (index space, raw = 4 x index), as the near ground's chunk
 * builder works each tile out (`tileLayers` over its four corner poles' families and choices: the bake's pattern corner
 * and the place's hash, or a pole the live generator made again): four layers (the unused ones the top layer again) and
 * the overlays' three mask codes, packed as RGBA16UI: R the first two layers' bytes, G the last two, B the codes five bits
 * each, A how many layers the tile holds. Written rectangle-ordered, or, with `S`, each tile at its toroidal texel.
 */
export function windowRect(comp: TileComposer, r: IndexRect, out = new Uint16Array(r.w * r.h * 4), S = 0): Uint16Array {
  const P = r.w + 1;
  let sF = new Int32Array(P);
  let sC = new Int32Array(P);
  let nF = new Int32Array(P);
  let nC = new Int32Array(P);
  const x0 = r.x0 * DETAIL_TILE;
  comp.poleRow(x0, r.z0 * DETAIL_TILE, P, sF, sC);
  const L = comp.layers;
  const C = comp.codes;
  for (let j = 0; j < r.h; j++) {
    comp.poleRow(x0, (r.z0 + j + 1) * DETAIL_TILE, P, nF, nC);
    const row = S ? modS(r.z0 + j, S) * S : j * r.w;
    for (let i = 0; i < r.w; i++) {
      const count = comp.layersFrom(sF, sC, nF, nC, i);
      const o = (row + (S ? modS(r.x0 + i, S) : i)) * 4;
      if (count === 1) {
        // `layersFrom`'s one-family answer writes the first layer alone: `tileLayers` repeats it and writes no code.
        const l = L[0];
        out[o] = l | (l << 8);
        out[o + 1] = l | (l << 8);
        out[o + 2] = 0;
      } else {
        out[o] = L[0] | (L[1] << 8);
        out[o + 1] = L[2] | (L[3] << 8);
        out[o + 2] = C[0] | (C[1] << 5) | (C[2] << 10);
      }
      out[o + 3] = count;
    }
    const f = sF;
    sF = nF;
    nF = f;
    const c = sC;
    sC = nC;
    nC = c;
  }
  return out;
}

/** A window texel unpacked: its four layers, three codes and count (the program's own unpacking, for the tests). */
export function unpackWindow(w: Uint16Array, o: number, layers: number[], codes: number[]): number {
  layers[0] = w[o] & 255;
  layers[1] = w[o] >> 8;
  layers[2] = w[o + 1] & 255;
  layers[3] = w[o + 1] >> 8;
  codes[0] = w[o + 2] & 31;
  codes[1] = (w[o + 2] >> 5) & 31;
  codes[2] = (w[o + 2] >> 10) & 31;
  return w[o + 3];
}

/**
 * The tint window's texels over a rectangle of colour cells (the colour lattice's own indices; a cell past the lattice
 * reads its nearest): the colour map's bytes as the bake keeps them (a cell the live generator made again read before
 * them), alpha 255, for the program's bilinear between cell centres. Rectangle-ordered, or with `T` toroidal.
 */
export function tintRect(colour: Uint8Array, lat: Lattice, cov: readonly ColourOverride[], r: IndexRect, out = new Uint8Array(r.w * r.h * 4), T = 0): Uint8Array {
  const rgb = [0, 0, 0];
  for (let j = 0; j < r.h; j++) {
    const cj = Math.min(lat.nz - 1, Math.max(0, r.z0 + j));
    const row = T ? modS(r.z0 + j, T) * T : j * r.w;
    for (let i = 0; i < r.w; i++) {
      const ci = Math.min(lat.nx - 1, Math.max(0, r.x0 + i));
      cellRgbAt(colour, lat.nx, cov, ci, cj, rgb);
      const o = (row + (T ? modS(r.x0 + i, T) : i)) * 4;
      out[o] = rgb[0];
      out[o + 1] = rgb[1];
      out[o + 2] = rgb[2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/** A whole window (both textures) made at a place, toroidally ordered: what the decode and a remake hand the field. */
export function wholeWindow(t: TileTables, header: HorizonHeader, fam: Uint8Array, colour: Uint8Array, poles: readonly PoleOverride[], cells: readonly ColourOverride[], p: WindowPlace): { window: Uint16Array; tint: Uint8Array } {
  const comp = new TileComposer(t, fam, header.ground);
  comp.setOverrides(poles);
  const window = windowRect(comp, { x0: p.ox, z0: p.oz, w: p.S, h: p.S }, new Uint16Array(p.S * p.S * 4), p.S);
  const tint = tintRect(colour, header.colour, cells, { x0: p.ci0, z0: p.cj0, w: p.T, h: p.T }, new Uint8Array(p.T * p.T * 4), p.T);
  return { window, tint };
}

/** A section inflated (zlib, which `DecompressionStream('deflate')` reads). */
export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every section of a bake inflated, by name. */
export async function inflateSections(header: HorizonHeader, bin: Uint8Array): Promise<Record<HorizonSectionName, Uint8Array>> {
  const out = {} as Record<HorizonSectionName, Uint8Array>;
  for (const s of header.sections) out[s.name] = await inflate(bin.subarray(s.offset, s.offset + s.length));
  for (const s of header.sections) if (out[s.name].length !== sectionOf(header, s.name).size) throw new Error(`the ${s.name} section inflates to ${out[s.name].length} bytes, not ${s.size}`);
  return out;
}

/** What the albedo's composition reads of the tile program: tables made from the world's tiler on the main thread. */
export interface TileTables {
  /** family * 256 + choice -> the array layer the tiler's `layer` gives. */
  layerOf: Uint8Array;
  /** family -> its rank at a border (`tiler.rank`). */
  rankOf: Float64Array;
  /** The corners asked for a choice, in order (`tiler.corners`). */
  corners: number[];
  /** Each layer's mean colour in linear light, three a layer. */
  means: Float32Array;
  /** The client's three masks, `ms` a side, one byte each, kind after kind (the tile arrays' own). */
  masks: Uint8Array;
  ms: number;
  /** The tint (`GROUND_DRAW_TUNE.colour`'s index, `gainCap`, the world's reference) and the masks' two switches. */
  tintMode: number;
  gainCap: number;
  reference: TintReference | null;
  add: boolean;
  painted: boolean;
}

/** A tiler over the tables: what `tileLayers` asks. */
export function tableTiler(t: TileTables): GroundTiler {
  return { rank: (f) => t.rankOf[f & 255], layer: (f, c) => t.layerOf[(f & 255) * 256 + (c & 255)], corners: t.corners };
}

/** The masks' bilinear sample, clamped at the edges, as the program's sampler is set. */
export function maskSampler(masks: Uint8Array, ms: number): MaskSample {
  const at = (k: number, x: number, y: number) => masks[k * ms * ms + Math.min(ms - 1, Math.max(0, y)) * ms + Math.min(ms - 1, Math.max(0, x))] / 255;
  return (kind, u, v) => {
    const fx = u * ms - 0.5;
    const fy = v * ms - 0.5;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const ax = fx - x;
    const ay = fy - y;
    return (at(kind, x, y) * (1 - ax) + at(kind, x + 1, y) * ax) * (1 - ay) + (at(kind, x, y + 1) * (1 - ax) + at(kind, x + 1, y + 1) * ax) * ay;
  };
}

/** The pattern's corner a 4 m pole takes its family from: the nearest, a tie going up (`snapFamilies`). */
export function cornerOf(w: number): number {
  return Math.floor(w / 8 + 0.5) * 8;
}

/** A 4 m pole's family off the bake's pattern corners (nought past them). */
export function poleFamily(fam: Uint8Array, ground: Lattice, x: number, z: number): number {
  const i = (cornerOf(x) - ground.x0) / 8;
  const j = (cornerOf(z) - ground.z0) / 8;
  if (i < 0 || j < 0 || i >= ground.nx || j >= ground.nz) return 0;
  return fam[j * ground.nx + i];
}

const PLACES = 4;

/**
 * A rectangle of 4 m poles made again by the live generator (W2's overlays: the paint, a dropped building's ground, Life
 * Day): `n` by `m` poles from raw (x0, z0), every 4 m, each its family (0 past a byte, as the bake keeps it) and choice.
 * Read in place of the bake's pattern corner and the place's hash wherever one holds a pole, the newest first.
 */
export interface PoleOverride {
  x0: number;
  z0: number;
  n: number;
  m: number;
  fam: Uint8Array;
  choice: Uint8Array;
}

/** A rectangle of colour cells made again (the colour lattice's own indices): `w` by `h` cells from (i0, j0), three bytes each. */
export interface ColourOverride {
  i0: number;
  j0: number;
  w: number;
  h: number;
  rgb: Uint8Array;
}

/**
 * The tile with its south-west corner at raw (tx, tz): its four corners' families and choices (the place's own hash), its
 * layers and codes by `tileLayers`, and its colour in linear light at every picture's mean, the masks averaged over a 4
 * by 4 grid of places (`composeTile`): written into `out`. With `memo` (by the tile's signature) a tile of the same
 * layers and codes is composed once a world. Its rows of poles (`poleRow`, `layersFrom`) are the composition window's too.
 */
export class TileComposer {
  private readonly fams = new Int32Array(4);
  private readonly choices = new Int32Array(4);
  readonly layers = new Uint8Array(4);
  readonly codes = new Uint8Array(3);
  private readonly tiler: GroundTiler;
  private readonly sample: MaskSample;
  // The memo by the tile's signature in two integers (the four layers' bytes, and the three codes plus one), in an
  // open-addressed table of its own: a 47-bit double key in a `Map` hashed a heap number on every look-up.
  private keyLo = new Int32Array(4096);
  private keyHi = new Int32Array(4096);
  private keyAt = new Int32Array(4096);
  private memoRgb = new Float32Array(3 * 1024);
  private memoN = 0;
  private readonly one = [0, 0, 0];
  private readonly t: TileTables;
  private readonly fam: Uint8Array;
  private readonly ground: Lattice;
  private readonly corner0: number;
  constructor(t: TileTables, fam: Uint8Array, ground: Lattice) {
    this.t = t;
    this.fam = fam;
    this.ground = ground;
    this.tiler = tableTiler(t);
    this.sample = maskSampler(t.masks, t.ms);
    this.corner0 = t.corners.length ? t.corners[0] : 0;
  }
  get memoSize(): number {
    return this.memoN;
  }
  /** The poles made again (W2), read before the bake's own; none (the decode's) leaves every path as it was. */
  private ov: readonly PoleOverride[] = [];
  setOverrides(ov: readonly PoleOverride[]): void {
    this.ov = ov;
  }
  /** One pole's family and choice into slot `k` of the two arrays: the newest override holding it, else the bake's corner and the hash. */
  private pole(x: number, z: number, famOut: Int32Array, choiceOut: Int32Array, k: number): void {
    const ov = this.ov;
    for (let q = ov.length - 1; q >= 0; q--) {
      const o = ov[q];
      const a = (x - o.x0) / DETAIL_TILE;
      const b = (z - o.z0) / DETAIL_TILE;
      if (a >= 0 && b >= 0 && a < o.n && b < o.m && a === Math.floor(a) && b === Math.floor(b)) {
        famOut[k] = o.fam[b * o.n + a];
        choiceOut[k] = o.choice[b * o.n + a];
        return;
      }
    }
    famOut[k] = poleFamily(this.fam, this.ground, x, z);
    choiceOut[k] = childChoiceAt(x, z);
  }
  /** The tile's layers and codes into `layers` and `codes`; answers how many layers it holds. */
  layersAt(tx: number, tz: number): number {
    const { fam, ground } = this;
    if (this.ov.length) {
      this.pole(tx, tz, this.fams, this.choices, 0);
      this.pole(tx + 4, tz, this.fams, this.choices, 1);
      this.pole(tx, tz + 4, this.fams, this.choices, 2);
      this.pole(tx + 4, tz + 4, this.fams, this.choices, 3);
      return tileLayers(this.fams, this.choices, this.tiler, this.layers, this.codes);
    }
    this.fams[0] = poleFamily(fam, ground, tx, tz);
    this.fams[1] = poleFamily(fam, ground, tx + 4, tz);
    this.fams[2] = poleFamily(fam, ground, tx, tz + 4);
    this.fams[3] = poleFamily(fam, ground, tx + 4, tz + 4);
    this.choices[0] = childChoiceAt(tx, tz);
    this.choices[1] = childChoiceAt(tx + 4, tz);
    this.choices[2] = childChoiceAt(tx, tz + 4);
    this.choices[3] = childChoiceAt(tx + 4, tz + 4);
    return tileLayers(this.fams, this.choices, this.tiler, this.layers, this.codes);
  }
  /**
   * A row of 4 m poles' families and choices (`P` of them from raw x0 eastward every 4 m, at raw z), each worked once:
   * the albedo hands `layersFrom` two such rows, so a pole four tiles share is hashed once and not four times.
   */
  poleRow(x0: number, z: number, P: number, famOut: Int32Array, choiceOut: Int32Array): void {
    const { fam, ground } = this;
    if (this.ov.length) {
      for (let a = 0; a < P; a++) this.pole(x0 + a * DETAIL_TILE, z, famOut, choiceOut, a);
      return;
    }
    for (let a = 0; a < P; a++) {
      const x = x0 + a * DETAIL_TILE;
      famOut[a] = poleFamily(fam, ground, x, z);
      choiceOut[a] = childChoiceAt(x, z);
    }
  }
  /** `layersAt` for the tile whose south-west pole is column `a` of `southF`/`southC` (its north poles in `northF`/`northC`). */
  layersFrom(southF: Int32Array, southC: Int32Array, northF: Int32Array, northC: Int32Array, a: number): number {
    const f = southF[a];
    // A tile of one family is that family at the first asked corner's choice (`tileLayers`' own answer for it, written
    // without its loops: most tiles are one family). Only `layers[0]` is written, which is all a count of one is read for.
    if (southF[a + 1] === f && northF[a] === f && northF[a + 1] === f) {
      const c0 = this.corner0;
      const choice = c0 === 0 ? southC[a] : c0 === 1 ? southC[a + 1] : c0 === 2 ? northC[a] : northC[a + 1];
      this.layers[0] = this.t.layerOf[(f & 255) * 256 + (choice & 255)];
      return 1;
    }
    this.fams[0] = f;
    this.fams[1] = southF[a + 1];
    this.fams[2] = northF[a];
    this.fams[3] = northF[a + 1];
    this.choices[0] = southC[a];
    this.choices[1] = southC[a + 1];
    this.choices[2] = northC[a];
    this.choices[3] = northC[a + 1];
    return tileLayers(this.fams, this.choices, this.tiler, this.layers, this.codes);
  }
  /** The tile's colour (linear, every picture at its mean), memo or none. */
  colourAt(tx: number, tz: number, out: number[], memo = true): number[] {
    return this.colourOf(this.layersAt(tx, tz), out, memo);
  }
  /** The colour of the layers and codes standing now (`layersAt`'s or `layersFrom`'s), `count` of them. */
  colourOf(count: number, out: number[], memo = true): number[] {
    const means = this.t.means;
    if (count === 1) {
      const l = this.layers[0] * 3;
      out[0] = means[l];
      out[1] = means[l + 1];
      out[2] = means[l + 2];
      return out;
    }
    const L = this.layers;
    const C = this.codes;
    const lo = L[0] | (L[1] << 8) | (L[2] << 16) | (L[3] << 24);
    const hi = C[0] + 32 * (C[1] + 32 * C[2]) + 1;
    let slot = -1;
    if (memo) {
      const mask = this.keyHi.length - 1;
      let h = (Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi, 0x85ebca77)) & mask;
      for (;;) {
        const kh = this.keyHi[h];
        if (kh === 0) break;
        if (kh === hi && this.keyLo[h] === lo) {
          const at = this.keyAt[h];
          out[0] = this.memoRgb[at * 3];
          out[1] = this.memoRgb[at * 3 + 1];
          out[2] = this.memoRgb[at * 3 + 2];
          return out;
        }
        h = (h + 1) & mask;
      }
      slot = h;
    }
    this.composeSlow(out);
    if (memo) {
      if (this.memoN * 3 >= this.memoRgb.length) {
        const g = new Float32Array(this.memoRgb.length * 2);
        g.set(this.memoRgb);
        this.memoRgb = g;
      }
      this.keyLo[slot] = lo;
      this.keyHi[slot] = hi;
      this.keyAt[slot] = this.memoN;
      this.memoRgb[this.memoN * 3] = out[0];
      this.memoRgb[this.memoN * 3 + 1] = out[1];
      this.memoRgb[this.memoN * 3 + 2] = out[2];
      this.memoN++;
      if (this.memoN * 2 > this.keyHi.length) this.growMemo();
    }
    return out;
  }
  /** The memo's table doubled, every signature put again. */
  private growMemo(): void {
    const lo = this.keyLo;
    const hi = this.keyHi;
    const at = this.keyAt;
    const size = hi.length * 2;
    this.keyLo = new Int32Array(size);
    this.keyHi = new Int32Array(size);
    this.keyAt = new Int32Array(size);
    const mask = size - 1;
    for (let k = 0; k < hi.length; k++) {
      if (hi[k] === 0) continue;
      let h = (Math.imul(lo[k], 0x9e3779b1) ^ Math.imul(hi[k], 0x85ebca77)) & mask;
      while (this.keyHi[h] !== 0) h = (h + 1) & mask;
      this.keyLo[h] = lo[k];
      this.keyHi[h] = hi[k];
      this.keyAt[h] = at[k];
    }
  }
  /** The layers and codes standing now composed at the sixteen places, with no memo and no fast path. */
  composeSlow(out: number[]): number[] {
    const means = this.t.means;
    const layer = (i: number, o: number[]) => {
      const l = this.layers[i] * 3;
      o[0] = means[l];
      o[1] = means[l + 1];
      o[2] = means[l + 2];
    };
    out[0] = out[1] = out[2] = 0;
    for (let q = 0; q < PLACES; q++) {
      for (let p = 0; p < PLACES; p++) {
        composeTile(layer, this.codes, (p + 0.5) / PLACES, (q + 0.5) / PLACES, this.sample, this.t.add, this.t.painted, this.one);
        out[0] += this.one[0];
        out[1] += this.one[1];
        out[2] += this.one[2];
      }
    }
    const k = 1 / (PLACES * PLACES);
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    return out;
  }
}

const tintOut: [number, number, number] = [0, 0, 0];
const tintIn: [number, number, number] = [0, 0, 0];

/** A cell's tint, as the tile program lays it: the colour map's bytes through `tintGamma`, then decoded to linear light. */
export function cellTint(t: TileTables, r: number, g: number, b: number, out: number[]): number[] {
  tintIn[0] = r / 255;
  tintIn[1] = g / 255;
  tintIn[2] = b / 255;
  tintGamma(tintIn, t.tintMode, t.reference, t.gainCap, tintOut);
  out[0] = srgbDecode(tintOut[0]);
  out[1] = srgbDecode(tintOut[1]);
  out[2] = srgbDecode(tintOut[2]);
  return out;
}

/**
 * The least linear value each sRGB byte is rounded from (`ENC_AT[b]`: the first x with round(srgbEncode(x) * 255) >= b),
 * found by halving with `srgbEncode` itself, so `encByte` answers the very byte the formula rounds to by eight
 * comparisons where the formula took a `Math.pow` (a quarter of the albedo's time, measured).
 */
const ENC_AT = (() => {
  const at = new Float64Array(256);
  for (let b = 1; b < 256; b++) {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 64; k++) {
      const mid = (lo + hi) / 2;
      if (Math.round(srgbEncode(mid) * 255) >= b) hi = mid;
      else lo = mid;
    }
    at[b] = hi;
  }
  return at;
})();
/** The sRGB byte of a linear value in [0, 1] (clamped), as `Math.round(srgbEncode(x) * 255)`. */
export function encByte(x: number): number {
  let b = 0;
  for (let s = 128; s > 0; s >>= 1) if (x >= ENC_AT[b + s]) b += s;
  return b;
}
const enc = (v: number) => encByte(Math.min(1, Math.max(0, v / ALBEDO_SCALE)));

/**
 * The fine albedo: one texel a colour cell (centred on its pattern corner), the mean in linear light of the cell's own 4 m
 * tiles each as the near ground draws it, times the cell's tint, stored sRGB at `ALBEDO_SCALE`'s share (RGBA, alpha
 * nought). The 4 m poles' families and choices are worked once a pole, a row of them at a time (two rows kept, the
 * north one of a row of tiles the south one of the next), from the place's hash; each cell's tiles are summed in the
 * order the cell's own loop summed them (its rows south to north, each west to east), so the bytes are the same.
 */
export function composeAlbedo(t: TileTables, header: HorizonHeader, fam: Uint8Array, colour: Uint8Array, out = new Uint8Array(header.colour.nx * header.colour.nz * 4)): { rgba: Uint8Array; memo: number; ms: number } {
  const t0 = performance.now();
  const c = header.colour;
  const comp = new TileComposer(t, fam, header.ground);
  const tile = [0, 0, 0];
  const tint = [0, 0, 0];
  const per = c.step / DETAIL_TILE;
  const k = 1 / (per * per);
  // Pole column a stands at raw x xs + 4a, pole row b at zs + 4b; tile (a, b) has its south-west pole there.
  const P = c.nx * per + 1;
  const xs = c.x0 - c.step / 2;
  const zs = c.z0 - c.step / 2;
  let sF = new Int32Array(P);
  let sC = new Int32Array(P);
  let nF = new Int32Array(P);
  let nC = new Int32Array(P);
  const acc = new Float64Array(c.nx * 3);
  let lastRgb = -1;
  comp.poleRow(xs, zs, P, sF, sC);
  for (let j = 0; j < c.nz; j++) {
    acc.fill(0);
    for (let q = 0; q < per; q++) {
      const b = j * per + q;
      comp.poleRow(xs, zs + (b + 1) * DETAIL_TILE, P, nF, nC);
      for (let a = 0; a < P - 1; a++) {
        comp.colourOf(comp.layersFrom(sF, sC, nF, nC, a), tile);
        const o = ((a / per) | 0) * 3;
        acc[o] += tile[0];
        acc[o + 1] += tile[1];
        acc[o + 2] += tile[2];
      }
      const f = sF;
      sF = nF;
      nF = f;
      const ch = sC;
      sC = nC;
      nC = ch;
    }
    for (let i = 0; i < c.nx; i++) {
      const o = (j * c.nx + i) * 3;
      // The colour map is smooth: a cell with its west neighbour's three bytes takes its tint (a pure function of them).
      const rgb = (colour[o] << 16) | (colour[o + 1] << 8) | colour[o + 2];
      if (rgb !== lastRgb) {
        cellTint(t, colour[o], colour[o + 1], colour[o + 2], tint);
        lastRgb = rgb;
      }
      const d = (j * c.nx + i) * 4;
      out[d] = enc(acc[i * 3] * k * tint[0]);
      out[d + 1] = enc(acc[i * 3 + 1] * k * tint[1]);
      out[d + 2] = enc(acc[i * 3 + 2] * k * tint[2]);
      out[d + 3] = 0;
    }
  }
  return { rgba: out, memo: comp.memoSize, ms: performance.now() - t0 };
}

/**
 * The coarse albedo, a texel a 64 m sample: inside the fine extent the fine texels' mean round it (in linear light);
 * past it the 64 m grid's own family (its layer at the place's choice) at its mean, times its own colour's tint.
 */
export function composeCoarseAlbedo(t: TileTables, header: HorizonHeader, fineRgba: Uint8Array, cf: Uint8Array, cc: Uint8Array): Uint8Array {
  const co = header.coarse;
  const c = header.colour;
  const out = new Uint8Array(co.nx * co.nz * 4);
  const tint = [0, 0, 0];
  const lin = new Float32Array(256);
  for (let v = 0; v < 256; v++) lin[v] = srgbDecode(v / 255) * ALBEDO_SCALE;
  const half = co.step / 2;
  for (let j = 0; j < co.nz; j++) {
    const z = co.z0 + j * co.step;
    for (let i = 0; i < co.nx; i++) {
      const x = co.x0 + i * co.step;
      const d = (j * co.nx + i) * 4;
      const fi0 = Math.ceil((x - half - c.x0) / c.step);
      const fi1 = Math.floor((x + half - c.x0) / c.step);
      const fj0 = Math.ceil((z - half - c.z0) / c.step);
      const fj1 = Math.floor((z + half - c.z0) / c.step);
      if (fi0 >= 0 && fj0 >= 0 && fi1 < c.nx && fj1 < c.nz && fi1 >= fi0 && fj1 >= fj0) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let fj = fj0; fj <= fj1; fj++) {
          for (let fi = fi0; fi <= fi1; fi++) {
            const s = (fj * c.nx + fi) * 4;
            r += lin[fineRgba[s]];
            g += lin[fineRgba[s + 1]];
            b += lin[fineRgba[s + 2]];
            n++;
          }
        }
        out[d] = enc(r / n);
        out[d + 1] = enc(g / n);
        out[d + 2] = enc(b / n);
        continue;
      }
      const f = cf[j * co.nx + i];
      const l = t.layerOf[f * 256 + (childChoiceAt(x, z) & 255)] * 3;
      cellTint(t, cc[(j * co.nx + i) * 3], cc[(j * co.nx + i) * 3 + 1], cc[(j * co.nx + i) * 3 + 2], tint);
      out[d] = enc(t.means[l] * tint[0]);
      out[d + 1] = enc(t.means[l + 1] * tint[1]);
      out[d + 2] = enc(t.means[l + 2] * tint[2]);
    }
  }
  return out;
}

/** A rectangle of a texture's texels: `w` by `h` from (i0, j0), RGBA. */
export interface RgbaRegion {
  i0: number;
  j0: number;
  w: number;
  h: number;
  rgba: Uint8Array;
}

/** The colour bytes of cell (i, j): the newest colour override holding it, else the bake's section. */
function cellRgbAt(colour: Uint8Array, nx: number, cov: readonly ColourOverride[], i: number, j: number, out: number[]): void {
  for (let q = cov.length - 1; q >= 0; q--) {
    const o = cov[q];
    const a = i - o.i0;
    const b = j - o.j0;
    if (a >= 0 && b >= 0 && a < o.w && b < o.h) {
      const s = (b * o.w + a) * 3;
      out[0] = o.rgb[s];
      out[1] = o.rgb[s + 1];
      out[2] = o.rgb[s + 2];
      return;
    }
  }
  const s = (j * nx + i) * 3;
  out[0] = colour[s];
  out[1] = colour[s + 1];
  out[2] = colour[s + 2];
}

/**
 * The fine albedo over the colour cells [i0, i1] by [j0, j1] (clamped to the lattice), with the poles and colour cells
 * made again laid over the bake's (W2): `composeAlbedo`'s own sums in its own order for every cell, so where nothing is
 * laid over the bytes are the whole composition's (`horizonOverlay.test.ts` holds it).
 */
export function composeAlbedoRegion(t: TileTables, header: HorizonHeader, fam: Uint8Array, colour: Uint8Array, ov: readonly PoleOverride[], cov: readonly ColourOverride[], i0: number, j0: number, i1: number, j1: number): RgbaRegion {
  const c = header.colour;
  i0 = Math.max(0, i0);
  j0 = Math.max(0, j0);
  i1 = Math.min(c.nx - 1, i1);
  j1 = Math.min(c.nz - 1, j1);
  const w = Math.max(0, i1 - i0 + 1);
  const h = Math.max(0, j1 - j0 + 1);
  const out = new Uint8Array(w * h * 4);
  if (!w || !h) return { i0, j0, w, h, rgba: out };
  const comp = new TileComposer(t, fam, header.ground);
  comp.setOverrides(ov);
  const tile = [0, 0, 0];
  const tint = [0, 0, 0];
  const rgb = [0, 0, 0];
  const per = c.step / DETAIL_TILE;
  const k = 1 / (per * per);
  const P = w * per + 1;
  const xs = c.x0 - c.step / 2 + i0 * c.step;
  const zs = c.z0 - c.step / 2 + j0 * c.step;
  let sF = new Int32Array(P);
  let sC = new Int32Array(P);
  let nF = new Int32Array(P);
  let nC = new Int32Array(P);
  const acc = new Float64Array(w * 3);
  comp.poleRow(xs, zs, P, sF, sC);
  for (let jj = 0; jj < h; jj++) {
    acc.fill(0);
    for (let q = 0; q < per; q++) {
      const b = jj * per + q;
      comp.poleRow(xs, zs + (b + 1) * DETAIL_TILE, P, nF, nC);
      for (let a = 0; a < P - 1; a++) {
        comp.colourOf(comp.layersFrom(sF, sC, nF, nC, a), tile);
        const o = ((a / per) | 0) * 3;
        acc[o] += tile[0];
        acc[o + 1] += tile[1];
        acc[o + 2] += tile[2];
      }
      const f = sF;
      sF = nF;
      nF = f;
      const ch = sC;
      sC = nC;
      nC = ch;
    }
    for (let ii = 0; ii < w; ii++) {
      cellRgbAt(colour, c.nx, cov, i0 + ii, j0 + jj, rgb);
      cellTint(t, rgb[0], rgb[1], rgb[2], tint);
      const d = (jj * w + ii) * 4;
      out[d] = enc(acc[ii * 3] * k * tint[0]);
      out[d + 1] = enc(acc[ii * 3 + 1] * k * tint[1]);
      out[d + 2] = enc(acc[ii * 3 + 2] * k * tint[2]);
      out[d + 3] = 0;
    }
  }
  return { i0, j0, w, h, rgba: out };
}

/** The coarse texels whose 64 m window meets the colour cells [i0, i1] by [j0, j1], and the colour cells those windows reach. */
export function coarseReach(header: HorizonHeader, i0: number, j0: number, i1: number, j1: number): { ci0: number; cj0: number; ci1: number; cj1: number; fi0: number; fj0: number; fi1: number; fj1: number } {
  const co = header.coarse;
  const c = header.colour;
  const half = co.step / 2;
  // Texel ci's window holds cells ceil((x - half - c.x0) / step) to floor((x + half - c.x0) / step), x = co.x0 + ci step.
  const ci0 = Math.max(0, Math.ceil((c.x0 + i0 * c.step - half - co.x0) / co.step));
  const ci1 = Math.min(co.nx - 1, Math.floor((c.x0 + i1 * c.step + half - co.x0) / co.step));
  const cj0 = Math.max(0, Math.ceil((c.z0 + j0 * c.step - half - co.z0) / co.step));
  const cj1 = Math.min(co.nz - 1, Math.floor((c.z0 + j1 * c.step + half - co.z0) / co.step));
  const fi0 = Math.max(0, Math.ceil((co.x0 + ci0 * co.step - half - c.x0) / c.step));
  const fi1 = Math.min(c.nx - 1, Math.floor((co.x0 + ci1 * co.step + half - c.x0) / c.step));
  const fj0 = Math.max(0, Math.ceil((co.z0 + cj0 * co.step - half - c.z0) / c.step));
  const fj1 = Math.min(c.nz - 1, Math.floor((co.z0 + cj1 * co.step + half - c.z0) / c.step));
  return { ci0, cj0, ci1, cj1, fi0, fj0, fi1, fj1 };
}

/**
 * The coarse albedo's texels [ci0, ci1] by [cj0, cj1] from a fine region that holds every cell their windows reach
 * inside the fine extent (`composeCoarseAlbedo`'s own per texel), past the extent the 64 m grid's own family and colour.
 */
export function coarseAlbedoRegion(t: TileTables, header: HorizonHeader, fine: RgbaRegion, cf: Uint8Array, cc: Uint8Array, ci0: number, cj0: number, ci1: number, cj1: number): RgbaRegion {
  const co = header.coarse;
  const c = header.colour;
  const w = Math.max(0, ci1 - ci0 + 1);
  const hh = Math.max(0, cj1 - cj0 + 1);
  const out = new Uint8Array(w * hh * 4);
  const tint = [0, 0, 0];
  const lin = new Float32Array(256);
  for (let v = 0; v < 256; v++) lin[v] = srgbDecode(v / 255) * ALBEDO_SCALE;
  const half = co.step / 2;
  for (let jj = 0; jj < hh; jj++) {
    const j = cj0 + jj;
    const z = co.z0 + j * co.step;
    for (let ii = 0; ii < w; ii++) {
      const i = ci0 + ii;
      const x = co.x0 + i * co.step;
      const d = (jj * w + ii) * 4;
      const fi0 = Math.ceil((x - half - c.x0) / c.step);
      const fi1 = Math.floor((x + half - c.x0) / c.step);
      const fj0 = Math.ceil((z - half - c.z0) / c.step);
      const fj1 = Math.floor((z + half - c.z0) / c.step);
      if (fi0 >= 0 && fj0 >= 0 && fi1 < c.nx && fj1 < c.nz && fi1 >= fi0 && fj1 >= fj0) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let fj = fj0; fj <= fj1; fj++) {
          for (let fi = fi0; fi <= fi1; fi++) {
            const s = ((fj - fine.j0) * fine.w + (fi - fine.i0)) * 4;
            r += lin[fine.rgba[s]];
            g += lin[fine.rgba[s + 1]];
            b += lin[fine.rgba[s + 2]];
            n++;
          }
        }
        out[d] = enc(r / n);
        out[d + 1] = enc(g / n);
        out[d + 2] = enc(b / n);
        continue;
      }
      const f = cf[j * co.nx + i];
      const l = t.layerOf[f * 256 + (childChoiceAt(x, z) & 255)] * 3;
      cellTint(t, cc[(j * co.nx + i) * 3], cc[(j * co.nx + i) * 3 + 1], cc[(j * co.nx + i) * 3 + 2], tint);
      out[d] = enc(t.means[l] * tint[0]);
      out[d + 1] = enc(t.means[l + 1] * tint[1]);
      out[d + 2] = enc(t.means[l + 2] * tint[2]);
    }
  }
  return { i0: ci0, j0: cj0, w, h: hh, rgba: out };
}

/**
 * Normals of a heights lattice, central differences one step either side (one-sided at an edge), as RG8 biased by 128:
 * the normal's x and z in the game's frame (raw x runs the other way, so the slope along it changes sign), y rebuilt.
 */
export function normalsOf(h: Float32Array, lat: Lattice): Uint8Array {
  const out = new Uint8Array(lat.nx * lat.nz * 2);
  return normalsRect(h, lat, 0, 0, lat.nx - 1, lat.nz - 1, out);
}

/** `normalsOf` over the samples [i0, i1] by [j0, j1] alone (clamped), written into the whole lattice's `out` (W2's overlays). */
export function normalsRect(h: Float32Array, lat: Lattice, i0: number, j0: number, i1: number, j1: number, out: Uint8Array, oi = 0, oj = 0, ow = lat.nx): Uint8Array {
  const { nx, nz, step } = lat;
  i0 = Math.max(0, i0);
  j0 = Math.max(0, j0);
  i1 = Math.min(nx - 1, i1);
  j1 = Math.min(nz - 1, j1);
  for (let j = j0; j <= j1; j++) {
    const ju = Math.min(nz - 1, j + 1);
    const jd = Math.max(0, j - 1);
    for (let i = i0; i <= i1; i++) {
      const ir = Math.min(nx - 1, i + 1);
      const il = Math.max(0, i - 1);
      const dxr = (h[j * nx + ir] - h[j * nx + il]) / ((ir - il) * step);
      const dzr = (h[ju * nx + i] - h[jd * nx + i]) / ((ju - jd) * step);
      // Game frame: d/dgx = -d/drx, d/dgz = d/drz; the normal is (-dh/dgx, 1, -dh/dgz) made unit.
      const gx = dxr;
      const gz = -dzr;
      const len = Math.sqrt(gx * gx + 1 + gz * gz);
      // `out` is the whole lattice's (`oi`, `oj` nought, `ow` its width) or a region's own from (oi, oj), `ow` wide.
      const o = ((j - oj) * ow + (i - oi)) * 2;
      out[o] = Math.min(255, Math.max(0, Math.round((gx / len) * 127.5 + 127.5)));
      out[o + 1] = Math.min(255, Math.max(0, Math.round((gz / len) * 127.5 + 127.5)));
    }
  }
  return out;
}

/**
 * The leaves' min/max pyramid (§2.4) in the game's frame, base cells one leaf on the leaves' lattice (the ground's shift
 * plus multiples of 64, aligned to the topmost level), covering the coarse extent: each cell the least and most of every
 * fine sample within it and a step round it, and of every coarse sample round it where the fine extent does not hold the
 * cell whole; NaN where neither stands.
 */
export function pyramidOf(header: HorizonHeader, fine: Float32Array, coarse: Float32Array, centre: { x: number; z: number }, shift: { x: number; z: number }): MinMaxPyramid {
  const top = LEAF * (1 << LEVELS_MOST);
  const co = header.coarse;
  const gxMin = centre.x - (co.x0 + (co.nx - 1) * co.step);
  const gxMax = centre.x - co.x0;
  const gzMin = co.z0 - centre.z;
  const gzMax = co.z0 + (co.nz - 1) * co.step - centre.z;
  const x0 = shift.x + top * Math.floor((gxMin - shift.x) / top);
  const z0 = shift.z + top * Math.floor((gzMin - shift.z) / top);
  const span = Math.max(gxMax - x0, gzMax - z0);
  const n = Math.ceil(span / top) * (1 << LEVELS_MOST);
  const lo0 = new Float32Array(n * n).fill(Infinity);
  const hi0 = new Float32Array(n * n).fill(-Infinity);
  const covered = new Uint8Array(n * n);
  const put = (lat: Lattice, h: Float32Array, reach: number, only: boolean) => {
    for (let j = 0; j < lat.nz; j++) {
      const gz = lat.z0 + j * lat.step - centre.z;
      const cj0 = Math.max(0, Math.floor((gz - reach - z0) / LEAF));
      const cj1 = Math.min(n - 1, Math.floor((gz + reach - z0) / LEAF));
      for (let i = 0; i < lat.nx; i++) {
        const gx = centre.x - (lat.x0 + i * lat.step);
        const v = h[j * lat.nx + i];
        const ci0 = Math.max(0, Math.floor((gx - reach - x0) / LEAF));
        const ci1 = Math.min(n - 1, Math.floor((gx + reach - x0) / LEAF));
        for (let cj = cj0; cj <= cj1; cj++) {
          for (let ci = ci0; ci <= ci1; ci++) {
            const k = cj * n + ci;
            if (only && covered[k]) continue;
            if (v < lo0[k]) lo0[k] = v;
            if (v > hi0[k]) hi0[k] = v;
          }
        }
      }
    }
  };
  const f = header.fine;
  put(f, fine, f.step, false);
  // A cell the fine extent holds whole (with its step round it) takes the fine samples alone.
  const fgx0 = centre.x - (f.x0 + (f.nx - 1) * f.step) + f.step;
  const fgx1 = centre.x - f.x0 - f.step;
  const fgz0 = f.z0 - centre.z + f.step;
  const fgz1 = f.z0 + (f.nz - 1) * f.step - centre.z - f.step;
  for (let cj = 0; cj < n; cj++) {
    const z = z0 + cj * LEAF;
    if (z < fgz0 || z + LEAF > fgz1) continue;
    for (let ci = 0; ci < n; ci++) {
      const x = x0 + ci * LEAF;
      if (x >= fgx0 && x + LEAF <= fgx1) covered[cj * n + ci] = 1;
    }
  }
  put(co, coarse, co.step, true);
  const lo: Float32Array[] = [lo0];
  const hi: Float32Array[] = [hi0];
  for (let k = 0; k < n * n; k++) if (lo0[k] > hi0[k]) lo0[k] = hi0[k] = NaN;
  let m = n;
  for (let L = 1; L <= LEVELS_MOST; L++) {
    const p = m >> 1;
    const pl = new Float32Array(p * p);
    const ph = new Float32Array(p * p);
    const cl = lo[L - 1];
    const chh = hi[L - 1];
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < p; i++) {
        let a = Infinity;
        let b = -Infinity;
        for (let q = 0; q < 4; q++) {
          const k = (2 * j + (q >> 1)) * m + 2 * i + (q & 1);
          const l = cl[k];
          if (l === l) {
            if (l < a) a = l;
            if (chh[k] > b) b = chh[k];
          }
        }
        pl[j * p + i] = a <= b ? a : NaN;
        ph[j * p + i] = a <= b ? b : NaN;
      }
    }
    lo.push(pl);
    hi.push(ph);
    m = p;
  }
  return { x0, z0, n, levels: LEVELS_MOST + 1, lo, hi };
}

/**
 * The pyramid made again over the leaves whose value fine samples in a game-frame rectangle reach (W2's overlays: a laid
 * height moved them), every level above them with it: `pyramidOf`'s own rule cell by cell (each cell the least and most of
 * every fine sample within it and a step round it, the coarse samples where the fine extent does not hold it whole), so
 * the pyramid is what `pyramidOf` would make of the laid heights (`horizonOverlay.test.ts` holds it to the bit).
 */
export function pyramidRelay(p: MinMaxPyramid, header: HorizonHeader, fine: Float32Array, coarse: Float32Array, centre: { x: number; z: number }, gx0: number, gz0: number, gx1: number, gz1: number): void {
  const f = header.fine;
  const co = header.coarse;
  const n = p.n;
  const reach = f.step;
  const ci0 = Math.max(0, Math.floor((gx0 - reach - p.x0) / LEAF));
  const ci1 = Math.min(n - 1, Math.floor((gx1 + reach - p.x0) / LEAF));
  const cj0 = Math.max(0, Math.floor((gz0 - reach - p.z0) / LEAF));
  const cj1 = Math.min(n - 1, Math.floor((gz1 + reach - p.z0) / LEAF));
  if (ci0 > ci1 || cj0 > cj1) return;
  const lo0 = p.lo[0];
  const hi0 = p.hi[0];
  for (let cj = cj0; cj <= cj1; cj++) {
    for (let ci = ci0; ci <= ci1; ci++) {
      lo0[cj * n + ci] = Infinity;
      hi0[cj * n + ci] = -Infinity;
    }
  }
  // The cells' own game rectangle, and a sample's reach round it: every sample that can land in one of them.
  const cx0 = p.x0 + ci0 * LEAF;
  const cx1 = p.x0 + (ci1 + 1) * LEAF;
  const cz0 = p.z0 + cj0 * LEAF;
  const cz1 = p.z0 + (cj1 + 1) * LEAF;
  const fgx0 = centre.x - (f.x0 + (f.nx - 1) * f.step) + f.step;
  const fgx1 = centre.x - f.x0 - f.step;
  const fgz0 = f.z0 - centre.z + f.step;
  const fgz1 = f.z0 + (f.nz - 1) * f.step - centre.z - f.step;
  const covered = (ci: number, cj: number): boolean => {
    const z = p.z0 + cj * LEAF;
    if (z < fgz0 || z + LEAF > fgz1) return false;
    const x = p.x0 + ci * LEAF;
    return x >= fgx0 && x + LEAF <= fgx1;
  };
  const put = (lat: Lattice, h: Float32Array, r: number, only: boolean) => {
    // gx = centre.x - (x0 + i step) in [cx0 - r, cx1 + r]; gz = z0 + j step - centre.z in [cz0 - r, cz1 + r].
    const i0 = Math.max(0, Math.floor((centre.x - cx1 - r - lat.x0) / lat.step) - 1);
    const i1 = Math.min(lat.nx - 1, Math.ceil((centre.x - cx0 + r - lat.x0) / lat.step) + 1);
    const j0 = Math.max(0, Math.floor((cz0 - r + centre.z - lat.z0) / lat.step) - 1);
    const j1 = Math.min(lat.nz - 1, Math.ceil((cz1 + r + centre.z - lat.z0) / lat.step) + 1);
    for (let j = j0; j <= j1; j++) {
      const gz = lat.z0 + j * lat.step - centre.z;
      const a0 = Math.max(cj0, Math.max(0, Math.floor((gz - r - p.z0) / LEAF)));
      const a1 = Math.min(cj1, Math.min(n - 1, Math.floor((gz + r - p.z0) / LEAF)));
      if (a0 > a1) continue;
      for (let i = i0; i <= i1; i++) {
        const gx = centre.x - (lat.x0 + i * lat.step);
        const b0 = Math.max(ci0, Math.max(0, Math.floor((gx - r - p.x0) / LEAF)));
        const b1 = Math.min(ci1, Math.min(n - 1, Math.floor((gx + r - p.x0) / LEAF)));
        if (b0 > b1) continue;
        const v = h[j * lat.nx + i];
        for (let cj = a0; cj <= a1; cj++) {
          for (let ci = b0; ci <= b1; ci++) {
            if (only && covered(ci, cj)) continue;
            const k = cj * n + ci;
            if (v < lo0[k]) lo0[k] = v;
            if (v > hi0[k]) hi0[k] = v;
          }
        }
      }
    }
  };
  put(f, fine, f.step, false);
  put(co, coarse, co.step, true);
  for (let cj = cj0; cj <= cj1; cj++) {
    for (let ci = ci0; ci <= ci1; ci++) {
      const k = cj * n + ci;
      if (lo0[k] > hi0[k]) lo0[k] = hi0[k] = NaN;
    }
  }
  let m = n;
  let a0 = ci0;
  let a1 = ci1;
  let b0 = cj0;
  let b1 = cj1;
  for (let L = 1; L < p.levels; L++) {
    const q = m >> 1;
    a0 >>= 1;
    a1 = Math.min(q - 1, a1 >> 1);
    b0 >>= 1;
    b1 = Math.min(q - 1, b1 >> 1);
    const cl = p.lo[L - 1];
    const ch = p.hi[L - 1];
    const pl = p.lo[L];
    const ph = p.hi[L];
    for (let j = b0; j <= b1; j++) {
      for (let i = a0; i <= a1; i++) {
        let a = Infinity;
        let b = -Infinity;
        for (let s = 0; s < 4; s++) {
          const k = (2 * j + (s >> 1)) * m + 2 * i + (s & 1);
          const l = cl[k];
          if (l === l) {
            if (l < a) a = l;
            if (ch[k] > b) b = ch[k];
          }
        }
        pl[j * q + i] = a <= b ? a : NaN;
        ph[j * q + i] = a <= b ? b : NaN;
      }
    }
    m = q;
  }
}

/** Each layer's mean colour in linear light, read off the colour array every `stride` texels each way (sRGB decoded). */
export function layerMeans(colour: Uint8Array, size: number, depth: number, stride = 4): Float32Array {
  const lin = new Float32Array(256);
  for (let v = 0; v < 256; v++) lin[v] = srgbDecode(v / 255);
  const out = new Float32Array(Math.max(256, depth) * 3);
  const per = size * size * 4;
  for (let l = 0; l < depth; l++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = 0; y < size; y += stride) {
      for (let x = 0; x < size; x += stride) {
        const k = l * per + (y * size + x) * 4;
        r += lin[colour[k]];
        g += lin[colour[k + 1]];
        b += lin[colour[k + 2]];
        n++;
      }
    }
    out[l * 3] = r / n;
    out[l * 3 + 1] = g / n;
    out[l * 3 + 2] = b / n;
  }
  return out;
}

/** Everything the decode worker hands the field. */
export interface DecodedBake {
  fine: Float32Array;
  coarse: Float32Array;
  fineNormal: Uint8Array;
  albedo: Uint8Array;
  coarseAlbedo: Uint8Array;
  pyramid: MinMaxPyramid;
  /** The composition window and its tint window at `place`, toroidally ordered (the third wave's). */
  window: Uint16Array;
  tint: Uint8Array;
  place: WindowPlace;
  ms: { inflate: number; heights: number; normals: number; albedo: number; pyramid: number; detail: number; memo: number };
  /** A bake made in the worker (`horizonDem.ts`), which has no file to read a header from: the one it made. */
  header?: HorizonHeader;
}

/** The whole decode, in the worker's order; the window made round the eye at side `S` tiles. */
export async function decodeBake(header: HorizonHeader, bin: Uint8Array, t: TileTables, centre: { x: number; z: number }, shift: { x: number; z: number }, eye: { rx: number; rz: number }, S = windowTiles(2500)): Promise<DecodedBake> {
  const clock = () => performance.now();
  let t0 = clock();
  const s = await inflateSections(header, bin);
  const ms = { inflate: clock() - t0, heights: 0, normals: 0, albedo: 0, pyramid: 0, detail: 0, memo: 0 };
  t0 = clock();
  const fine = decodeHeights(s.heights, header.fine.nx, header.fine.nz, header.fine.lo, header.fine.q);
  const coarse = decodeHeights(s.coarseHeights, header.coarse.nx, header.coarse.nz, header.coarse.lo, header.coarse.q);
  ms.heights = clock() - t0;
  return composeBake(header, fine, coarse, s, t, centre, shift, eye, S, ms);
}

/**
 * From the heights on (the decode's, and a bake made in the worker for a world with no converted terrain, `horizonDem.ts`): the
 * normals, the albedos composed from the tile tables, the pyramid and the composition window. With `plain` (a made world that
 * names no ground and so has no tables) its two albedos as handed in and a window that holds nothing, whose every tile reads as
 * empty and is never asked for again.
 */
export function composeBake(header: HorizonHeader, fine: Float32Array, coarse: Float32Array, s: Pick<Record<HorizonSectionName, Uint8Array>, 'families' | 'colour' | 'coarseFamilies' | 'coarseColour'>, t: TileTables | null, centre: { x: number; z: number }, shift: { x: number; z: number }, eye: { rx: number; rz: number }, S: number, ms: DecodedBake['ms'], plain: { albedo: Uint8Array; coarseAlbedo: Uint8Array } | null = null): DecodedBake {
  const clock = () => performance.now();
  let t0 = clock();
  // The coarse lattice's normals are worked out in the ring's vertex stage from its heights (the third wave's sampler budget).
  const fineNormal = normalsOf(fine, header.fine);
  ms.normals = clock() - t0;
  let albedo: Uint8Array;
  let coarseAlbedo: Uint8Array;
  if (t) {
    const a = composeAlbedo(t, header, s.families, s.colour);
    ms.albedo = a.ms;
    ms.memo = a.memo;
    albedo = a.rgba;
    t0 = clock();
    coarseAlbedo = composeCoarseAlbedo(t, header, a.rgba, s.coarseFamilies, s.coarseColour);
    ms.albedo += clock() - t0;
  } else {
    albedo = plain!.albedo;
    coarseAlbedo = plain!.coarseAlbedo;
  }
  t0 = clock();
  const pyramid = pyramidOf(header, fine, coarse, centre, shift);
  ms.pyramid = clock() - t0;
  t0 = clock();
  const place = windowPlace(eye.rx, eye.rz, S, header.colour);
  const w = t ? wholeWindow(t, header, s.families, s.colour, [], [], place) : { window: new Uint16Array(place.S * place.S * 4), tint: new Uint8Array(place.T * place.T * 4) };
  ms.detail = clock() - t0;
  return { fine, coarse, fineNormal, albedo, coarseAlbedo, pyramid, window: w.window, tint: w.tint, place, ms };
}
