// The window's CPU rasters: the ground's height, its response (moves, heals, gives, dust), the dust's colour and the
// medium (land, water, lava) for every cell of the air's grid, kept in the window's own cell order and shifted with
// it (the design's §2.2, §2.7). They are filled from the ground the world has already built -- the terrain's cached
// heights and the chunks' own family grids, never a generation on the main thread -- in strips: every row and column
// the window moved over this frame and `stripMargin` more are asked again at once, so the unknown band never grows
// however fast the window moves, and a cell still unknown (no chunk built yet) is asked again within a time budget.
//
// A cell that is unknown takes no dust and no response (its medium byte is nought) and carries the window's mean
// height, so nothing that reads it ever reads a NaN. The heights are float32: half floats step a metre at 1-2 km.
//
// **The colour raster stays bytes** (wave 2b, the design's §2.3): its RGB the family's lighter tones as sRGB, its
// alpha the medium byte, which six readers compare as a byte. Beside it a **tint raster** holds each cell's pole's own
// colour-map bytes, copied from the chunk the ground was built from as numbers it hands back whole (no number converted
// on a moving frame), alpha 255 where the pole is known; the dust pass works the tint out per texel with the tile
// program's own functions, and the CPU, where it needs the cell's colour (the motes, the storm's colour), through
// `tintedAt` with the ground's own `tintGamma` and a decode table made once from its `srgbDecode`.
//
// Pure: no three; the field uploads these arrays as textures.
import { srgbDecode, tintGammaOf, type TintAsk, type TintReference } from '../groundMath.ts';
import { CLASS_INDEX } from './airSpawn.ts';

/** The class a known cell whose family the table has none for takes: dirt's, as its response is (the design's §2.7). */
const DIRT_CLASS = CLASS_INDEX.dirt;

/** What the world answers for one point of the ground; the sampler writes it and answers false where it knows nothing yet. */
export interface GroundSample {
  /** Metres. */
  h: number;
  /** The shader family painting the ground there, -1 for none known. */
  family: number;
  /** 1 land, 2 water, 3 lava. */
  medium: number;
  /** The pole's colour-map bytes packed `0xRRGGBB`, or -1 where there are none (no chunk built, no colour map). */
  tint: number;
  /**
   * The liquid's own flow there, m/s along x and z (the fifth wave: a ribbon's velocity along its run where the terrain's
   * lava falls are drawn), nought where it has none. The raster sets both to nought before every ask.
   */
  flowX: number;
  flowZ: number;
}

/** sRGB bytes decoded, once, by the ground's own `srgbDecode`: what `tintedAt` reads a colour byte through. */
const DECODE = ((): Float64Array => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbDecode(i / 255);
  return t;
})();

/** The decode table, for the tests (each byte `srgbDecode`'s by `Object.is`). */
export const BYTE_DECODE: Readonly<Float64Array> = DECODE;

export interface GroundSampler {
  sample(x: number, z: number, out: GroundSample): boolean;
}

/** The medium bytes the colour raster's alpha carries: nought for a cell not known yet. */
export const MEDIUM_BYTE = { unknown: 0, land: 85, water: 170, lava: 255 } as const;

export class AirRaster {
  n = 0;
  /** Metres, the window's cell order (row j along +Z, column i along +X); the window's mean where unknown. */
  height = new Float32Array(0);
  /** Moves, heals, gives over 3, dust: four bytes a cell. */
  response = new Uint8Array(0);
  /** The dust's colour as sRGB bytes (the family's lighter tones) and the medium byte (`MEDIUM_BYTE`). */
  colour = new Uint8Array(0);
  /** The pole's own colour-map bytes, alpha 255 where known and there is a colour map, nought otherwise (a tint of one). */
  tint = new Uint8Array(0);
  /** 1 where the cell is known. */
  known = new Uint8Array(0);
  /**
   * The family each known cell was painted from, plus one (nought for none): so a new colour table (the owner's `dust.tone`
   * dial) repaints the colour bytes in place (`repaintColour`) rather than forgetting every cell and asking the world again
   * over seconds, which left the dust laying nothing and the march reading a flat mean ground meanwhile.
   */
  fam = new Uint16Array(0);
  /**
   * Each cell's ground class (the fourth wave, `CLASS_INDEX`: the class's place in the response table plus one), nought
   * where the cell is not known or is a liquid: which kind of particle the ground throws (leaves off grass and litter,
   * puffs and streaks off sand, ash and dirt), which neither the response bytes nor the medium byte name.
   */
  klass = new Uint8Array(0);
  /**
   * The liquid's own flow at each cell, m/s along x and z (the fifth wave's flow raster: a ribbon's velocity where the
   * terrain's lava falls are drawn), nought where it has none: what the liquid tile is pulled toward beside its share of
   * the wind (`LIQUID_TARGET_GLSL`).
   */
  flow = new Float32Array(0);
  /** Set when the flow moved since the field last uploaded it (most frames it has not: a world with no ribbon never writes it). */
  flowDirty = false;
  /**
   * How many cells hold a flow other than nought: a window's move or a clear dirties the flow only while there is any,
   * so on a world with no ribbon (every world but one) the flow raster is never uploaded again after it is made.
   */
  flowCells = 0;
  /** Each family's class index by family id, from the world's table (`fillClassTable`); a family past it is dirt's. */
  familyClass: Uint8Array = new Uint8Array(0);
  /**
   * How the ground's tint is drawn now, as `tintedAt` works it out: the tile program's mode (`COLOUR_MODES`' index), the
   * world's colour reference, the gain cap, and how much of it the dust takes (`dust.tint`). Written by the world.
   */
  tintMode = 0;
  tintRef: TintReference | null = null;
  tintCap = 1.6;
  tintShare = 1;
  /** Set when an array moved since the field last uploaded it. */
  dirty = false;
  /** The known cells' lowest, highest and mean ground (the volume's band and the far integral's ground). */
  lowest = 0;
  highest = 0;
  mean = 0;
  /** Cells still unknown. */
  unknown = 0;
  /** Cells asked of the world, since `asked` was last read. */
  asked = 0;
  private cursor = 0;
  /** Each family's response and colour, from the world's table: four bytes a family. */
  familyResponse: Uint8Array = new Uint8Array(0);
  familyColour: Uint8Array = new Uint8Array(0);
  /** The colour a cell takes whose family has none: sRGB bytes. */
  fallback = [204, 168, 117];
  private readonly s: GroundSample = { h: 0, family: -1, medium: 0, tint: -1, flowX: 0.5, flowZ: 0.5 };
  /** `tintedAt`'s scratch: the tint's bytes as 0..1, and what `tintGamma` made of them. */
  private readonly tc: [number, number, number] = [0.5, 0.5, 0.5];
  private readonly tg: [number, number, number] = [0.5, 0.5, 0.5];
  /** `tintedAt`'s ask of `tintGammaOf`: the mode, the reference and the cap (a fraction from the start, so never boxed). */
  private readonly tintAsk: TintAsk = { mode: 0, ref: null, cap: 1.5 };

  /** A raster of `n` a side, every cell unknown. */
  resize(n: number): void {
    if (n === this.n) return;
    this.n = n;
    this.height = new Float32Array(n * n);
    this.response = new Uint8Array(n * n * 4);
    this.colour = new Uint8Array(n * n * 4);
    this.tint = new Uint8Array(n * n * 4);
    this.known = new Uint8Array(n * n);
    this.fam = new Uint16Array(n * n);
    this.klass = new Uint8Array(n * n);
    this.flow = new Float32Array(n * n * 2);
    this.clear();
  }

  /** Every cell unknown (a jump, a new world). */
  clear(): void {
    this.height.fill(this.mean);
    this.response.fill(0);
    this.colour.fill(0);
    this.tint.fill(0);
    this.known.fill(0);
    this.fam.fill(0);
    this.klass.fill(0);
    this.flow.fill(0);
    // A raster of nought flow already uploads nothing new (a resize's texture is made fresh with its data).
    if (this.flowCells > 0) this.flowDirty = true;
    this.flowCells = 0;
    this.unknown = this.n * this.n;
    this.cursor = 0;
    this.dirty = true;
  }

  /**
   * The cells of a game-frame rectangle marked unknown (Map-maker II: the ground under them was sculpted, painted or
   * flooded), so the fill's own budgeted round asks them of the world again, the rest of the raster as it was; the cells
   * are those of the window as the last fill laid it (its corner and cell). The one reader of the ground that does not heal
   * by itself: it asks only unknown cells and the band a move uncovers. Kept arrays, nothing made. Answers how many it
   * forgot.
   */
  forget(x0: number, z0: number, x1: number, z1: number): number {
    const n = this.n;
    if (!n) return 0;
    const cell = this.askCell;
    const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - this.askOx) / cell));
    const i1 = Math.min(n - 1, Math.floor((Math.max(x0, x1) - this.askOx) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - this.askOz) / cell));
    const j1 = Math.min(n - 1, Math.floor((Math.max(z0, z1) - this.askOz) / cell));
    let forgot = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        if (!this.known[k]) continue;
        this.known[k] = 0;
        this.colour[k * 4 + 3] = 0;
        this.response[k * 4 + 3] = 0;
        this.tint[k * 4 + 3] = 0;
        this.klass[k] = 0;
        this.height[k] = this.mean;
        this.unknown++;
        forgot++;
      }
    }
    if (forgot) this.dirty = true;
    return forgot;
  }

  /**
   * The window moved by (dx, dz) whole cells: every array's content moves the other way, and what comes in at the
   * leading edges is unknown until it is filled.
   */
  shift(dx: number, dz: number): void {
    const n = this.n;
    if (dx === 0 && dz === 0) return;
    if (Math.abs(dx) >= n || Math.abs(dz) >= n) {
      this.clear();
      return;
    }
    // Every grid moves with a fill of nought, and the height's incoming cells take the window's mean in the count's own
    // loop below: the mean handed to `shiftGrid` (and on to the typed array's `fill`) was a double across a call the
    // compiler does not build in, a number made on every frame the window moved -- 13 bytes a frame, which is every
    // frame of a ride or a flight, and the air's own, not the terrain's.
    shiftGrid(this.height, n, 1, dx, dz, 0);
    shiftGrid(this.response, n, 4, dx, dz, 0);
    shiftGrid(this.colour, n, 4, dx, dz, 0);
    shiftGrid(this.tint, n, 4, dx, dz, 0);
    shiftGrid(this.known, n, 1, dx, dz, 0);
    shiftGrid(this.fam, n, 1, dx, dz, 0);
    shiftGrid(this.klass, n, 1, dx, dz, 0);
    // The flow moves (and is uploaded again) only where it holds any: what leaves the window takes its count with it.
    if (this.flowCells > 0) {
      shiftGrid(this.flow, n, 2, dx, dz, 0);
      this.flowDirty = true;
      const fl = this.flow;
      let cells = 0;
      for (let k = 0; k < fl.length; k += 2) if (fl[k] !== 0 || fl[k + 1] !== 0) cells++;
      this.flowCells = cells;
    }
    let unknown = 0;
    const kn = this.known;
    const h = this.height;
    const mean = this.mean;
    for (let k = 0; k < kn.length; k++) {
      if (kn[k]) continue;
      unknown++;
      h[k] = mean;
    }
    this.unknown = unknown;
    this.dirty = true;
  }

  /**
   * Ask the world again for every cell of the band the window moved over (`dx`, `dz` cells) and `margin` rows and
   * columns more, at once, so the unknown band never grows; then cells still unknown, round the grid, until
   * `budgetMs` is spent. The window's corner is (`ox`, `oz`), its cell `cell` metres.
   */
  fill(src: GroundSampler, ox: number, oz: number, cell: number, dx: number, dz: number, margin: number, budgetMs: number, now: () => number): void {
    const f = this.fillArgs;
    f.ox = ox;
    f.oz = oz;
    f.cell = cell;
    f.dx = dx;
    f.dz = dz;
    f.margin = margin;
    f.budgetMs = budgetMs;
    this.fillIn(src, now);
  }

  /** `fill`'s numbers, in a kept record the field writes before `fillIn` (its frame hands no number across a call). */
  readonly fillArgs = { ox: 0.5, oz: 0.5, cell: 1.5, dx: 0, dz: 0, margin: 2, budgetMs: 0.2 };

  /** `fill` over `fillArgs`. */
  fillIn(src: GroundSampler, now: () => number): void {
    const n = this.n;
    const f = this.fillArgs;
    this.askOx = f.ox;
    this.askOz = f.oz;
    this.askCell = f.cell;
    const dx = f.dx;
    const dz = f.dz;
    if (dx !== 0) {
      const w = Math.min(n, Math.abs(dx) + f.margin);
      const c0 = dx > 0 ? n - w : 0;
      for (let j = 0; j < n; j++) for (let i = c0; i < c0 + w; i++) this.ask(src, i, j);
    }
    if (dz !== 0) {
      const w = Math.min(n, Math.abs(dz) + f.margin);
      const r0 = dz > 0 ? n - w : 0;
      for (let j = r0; j < r0 + w; j++) for (let i = 0; i < n; i++) this.ask(src, i, j);
    }
    if (this.unknown > 0 && f.budgetMs > 0) {
      const t0 = now();
      const total = n * n;
      let looked = 0;
      while (looked < total && this.unknown > 0) {
        const k = this.cursor;
        this.cursor = (this.cursor + 1) % total;
        looked++;
        if (this.known[k]) continue;
        this.ask(src, k % n, Math.floor(k / n));
        // The clock is read every sixteen cells asked, not every one.
        if ((looked & 15) === 0 && now() - t0 > f.budgetMs) break;
      }
    }
    this.measure();
  }

  /** Every cell asked, at once (an arrival, behind the loading screen). */
  fillAll(src: GroundSampler, ox: number, oz: number, cell: number): void {
    const n = this.n;
    this.askOx = ox;
    this.askOz = oz;
    this.askCell = cell;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.ask(src, i, j);
    this.measure();
  }

  /** Where the cells being asked stand: the window's corner and its cell, set once a fill. */
  private askOx = 0.5;
  private askOz = 0.5;
  private askCell = 1.5;

  private ask(src: GroundSampler, i: number, j: number): void {
    const k = j * this.n + i;
    const s = this.s;
    const cell = this.askCell;
    this.asked++;
    const was = this.known[k];
    s.tint = -1;
    s.flowX = 0;
    s.flowZ = 0;
    if (!src.sample(this.askOx + (i + 0.5) * cell, this.askOz + (j + 0.5) * cell, s) || !Number.isFinite(s.h)) {
      if (was) {
        this.known[k] = 0;
        this.colour[k * 4 + 3] = 0;
        this.response[k * 4 + 3] = 0;
        this.tint[k * 4 + 3] = 0;
        this.klass[k] = 0;
        this.unknown++;
        this.dirty = true;
      }
      return;
    }
    this.height[k] = s.h;
    const fam = s.family;
    const fr = this.familyResponse;
    const known = fam >= 0 && fam * 4 + 3 < fr.length;
    const p = k * 4;
    if (s.medium !== 1) {
      // Over water or lava nothing is lifted, nothing drifts and nothing gives: the liquid is the fourth wave's.
      this.response[p] = 0;
      this.response[p + 1] = 255;
      this.response[p + 2] = 0;
      this.response[p + 3] = 0;
    } else if (known) {
      this.response[p] = fr[fam * 4];
      this.response[p + 1] = fr[fam * 4 + 1];
      this.response[p + 2] = fr[fam * 4 + 2];
      this.response[p + 3] = fr[fam * 4 + 3];
    } else {
      // A family the world has no class for (a world with no families): dirt [ours, the design's §2.7].
      this.response[p] = 102;
      this.response[p + 1] = 230;
      this.response[p + 2] = 51;
      this.response[p + 3] = 153;
    }
    this.fam[k] = fam >= 0 && fam < 65535 ? fam + 1 : 0;
    // The class (the fourth wave's): a liquid's nought (spray is the medium byte's), a family the table has none for
    // dirt's, as its response is.
    const fc = this.familyClass;
    this.klass[k] = s.medium !== 1 ? 0 : fam >= 0 && fam < fc.length && fc[fam] > 0 ? fc[fam] : DIRT_CLASS;
    this.paintColour(p, known ? fam : -1);
    this.colour[p + 3] = s.medium === 3 ? 255 : s.medium === 2 ? 170 : 85;
    // The liquid's own flow (the fifth wave's), written only where it moved, so a world with none never dirties it.
    const fx = s.medium !== 1 && Number.isFinite(s.flowX) ? s.flowX : 0;
    const fz = s.medium !== 1 && Number.isFinite(s.flowZ) ? s.flowZ : 0;
    const fl = this.flow;
    if (fl[k * 2] !== fx || fl[k * 2 + 1] !== fz) {
      const had = fl[k * 2] !== 0 || fl[k * 2 + 1] !== 0;
      const has = fx !== 0 || fz !== 0;
      if (had !== has) this.flowCells += has ? 1 : -1;
      fl[k * 2] = fx;
      fl[k * 2 + 1] = fz;
      this.flowDirty = true;
    }
    // The pole's own colour-map bytes as the terrain hands them back, a whole number packed (a version-3 pack, a
    // real-elevation world or a pole no built chunk covers answers none: a tint of one).
    const tint = s.tint;
    if (tint >= 0) {
      this.tint[p] = (tint >> 16) & 255;
      this.tint[p + 1] = (tint >> 8) & 255;
      this.tint[p + 2] = tint & 255;
      this.tint[p + 3] = 255;
    } else {
      this.tint[p] = 255;
      this.tint[p + 1] = 255;
      this.tint[p + 2] = 255;
      this.tint[p + 3] = 0;
    }
    if (!was) {
      this.known[k] = 1;
      this.unknown--;
    }
    this.dirty = true;
  }

  /**
   * The colour bytes at `p` from the family table (`fam`, -1 for a family the response table does not know): the
   * family's lighter tones where it has a colour, else the fallback. A cell's medium byte is not touched. Whole numbers
   * only cross the call.
   */
  private paintColour(p: number, fam: number): void {
    const fc = this.familyColour;
    if (fam >= 0 && fam * 4 + 3 < fc.length && fc[fam * 4 + 3] > 0) {
      this.colour[p] = fc[fam * 4];
      this.colour[p + 1] = fc[fam * 4 + 1];
      this.colour[p + 2] = fc[fam * 4 + 2];
    } else {
      this.colour[p] = this.fallback[0];
      this.colour[p + 1] = this.fallback[1];
      this.colour[p + 2] = this.fallback[2];
    }
  }

  /**
   * A new colour table (the world's `familyColour`, made again when the owner's `dust.tone` dial moves) painted into every
   * known cell's colour bytes from the family it was painted from, in one walk: the heights, the response, the medium
   * byte, the tint and what is known all stand as they were, so the dust lays on as before and nothing is asked of the
   * world again. The same bytes a cell asked afresh would take (`ask`'s own rule).
   */
  repaintColour(): void {
    const n2 = this.n * this.n;
    const kn = this.known;
    const fa = this.fam;
    const fr = this.familyResponse;
    for (let k = 0; k < n2; k++) {
      if (!kn[k]) continue;
      const fam = fa[k] - 1;
      this.paintColour(k * 4, fam >= 0 && fam * 4 + 3 < fr.length ? fam : -1);
    }
    this.dirty = true;
  }

  /** The known cells' lowest, highest and mean ground; an unknown cell is given the mean. */
  private measure(): void {
    const n2 = this.n * this.n;
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    let count = 0;
    const h = this.height;
    const kn = this.known;
    for (let k = 0; k < n2; k++) {
      if (!kn[k]) continue;
      const v = h[k];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
      count++;
    }
    if (count > 0) {
      this.lowest = lo;
      this.highest = hi;
      this.mean = sum / count;
      for (let k = 0; k < n2; k++) if (!kn[k]) h[k] = this.mean;
    }
  }

  /**
   * A cell's dust colour in linear light, into `out` (the dust pass's own colour, the motes' and the storm's): the colour
   * raster's lighter tones decoded through the table, times the ground's own tint of the cell's pole (`tintGamma` in the
   * drawn ground's mode, then `srgbDecode`), blended toward one by `tintShare`; a tint of one where the cell has no
   * colour-map bytes. Answers false, and writes nothing, for a cell not known yet. Nothing made: the scratch is kept.
   */
  tintedAt(i: number, j: number, out: [number, number, number]): boolean {
    const n = this.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return false;
    const k = j * n + i;
    if (this.known[k] !== 1) return false;
    const p = k * 4;
    const c = this.colour;
    const t = this.tint;
    const share = this.tintShare;
    if (t[p + 3] > 0) {
      const tc = this.tc;
      tc[0] = t[p] / 255;
      tc[1] = t[p + 1] / 255;
      tc[2] = t[p + 2] / 255;
      // The ask in a kept record (`tintGammaOf`, which `tintGamma` is): the cap handed across the call as a number was a
      // number made in a process whose compiler did not build the call in (16 bytes a mote, a run in three, measured).
      const ask = this.tintAsk;
      ask.mode = this.tintMode;
      ask.ref = this.tintRef;
      ask.cap = this.tintCap;
      const tg = tintGammaOf(tc, ask, this.tg);
      out[0] = DECODE[c[p]] * (1 + (srgbDecode(tg[0]) - 1) * share);
      out[1] = DECODE[c[p + 1]] * (1 + (srgbDecode(tg[1]) - 1) * share);
      out[2] = DECODE[c[p + 2]] * (1 + (srgbDecode(tg[2]) - 1) * share);
    } else {
      out[0] = DECODE[c[p]];
      out[1] = DECODE[c[p + 1]];
      out[2] = DECODE[c[p + 2]];
    }
    return true;
  }

  /** The cell under a world point, as `i + j · n`, or -1 outside the window. */
  cellAt(ox: number, oz: number, cell: number, x: number, z: number): number {
    const i = Math.floor((x - ox) / cell);
    const j = Math.floor((z - oz) / cell);
    const n = this.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return j * n + i;
  }

  /** The ground's height at a world point by the nearest cell, into `out.h`; false outside the window or where unknown. */
  heightAt(ox: number, oz: number, cell: number, x: number, z: number, out: { h: number }): boolean {
    const i = Math.floor((x - ox) / cell);
    const j = Math.floor((z - oz) / cell);
    const n = this.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return false;
    const k = j * n + i;
    out.h = this.height[k];
    return this.known[k] === 1;
  }

  /** The medium byte at a world point (nought outside or unknown). */
  mediumAt(ox: number, oz: number, cell: number, x: number, z: number): number {
    const i = Math.floor((x - ox) / cell);
    const j = Math.floor((z - oz) / cell);
    const n = this.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return 0;
    return this.colour[(j * n + i) * 4 + 3];
  }

  /**
   * The share of sand's grains a machine throws at a world point while the kick-up is on (the third wave, the owner's
   * answer of 2026-10-24): one where the ground sheds whole (sand, ash), `hard` on rock and paving (ground that neither
   * moves nor gives: "drastically reduced, but not fully gone"), the response's dust share on any other land, and nought
   * over water or lava, on mud or wet sand (which shed no dust), outside the window or where the ground is not known.
   */
  grainShareAt(ox: number, oz: number, cell: number, x: number, z: number, hard: number): number {
    const i = Math.floor((x - ox) / cell);
    const j = Math.floor((z - oz) / cell);
    const n = this.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return 0;
    const k = j * n + i;
    if (!this.known[k]) return 0;
    const p = k * 4;
    if (this.colour[p + 3] !== MEDIUM_BYTE.land) return 0;
    const dust = this.response[p + 3];
    if (dust >= 255) return 1;
    if (dust === 0) return 0;
    if (this.response[p] === 0 && this.response[p + 2] === 0) return hard > 0 ? (hard < 1 ? hard : 1) : 0;
    return dust / 255;
  }

  /** The response's dust byte at a world point over 255 (nought outside, unknown, or on a liquid). */
  dustAt(ox: number, oz: number, cell: number, x: number, z: number): number {
    const i = Math.floor((x - ox) / cell);
    const j = Math.floor((z - oz) / cell);
    const n = this.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return 0;
    const k = j * n + i;
    if (!this.known[k]) return 0;
    return this.response[k * 4 + 3] / 255;
  }
}

/**
 * Move a grid's content by (-dx, -dz) cells in place, `c` values a cell, filling what comes in with `fill`: the
 * window moving +dx means what was at column i is now at column i - dx.
 */
export function shiftGrid(a: Float32Array | Uint8Array | Uint16Array, n: number, c: number, dx: number, dz: number, fill: number): void {
  const row = n * c;
  if (dz > 0) {
    a.copyWithin(0, dz * row, n * row);
    a.fill(fill, (n - dz) * row, n * row);
  } else if (dz < 0) {
    a.copyWithin(-dz * row, 0, (n + dz) * row);
    a.fill(fill, 0, -dz * row);
  }
  if (dx !== 0) {
    for (let j = 0; j < n; j++) {
      const r = j * row;
      if (dx > 0) {
        a.copyWithin(r, r + dx * c, r + row);
        a.fill(fill, r + (n - dx) * c, r + row);
      } else {
        a.copyWithin(r - dx * c, r, r + row + dx * c);
        a.fill(fill, r, r - dx * c);
      }
    }
  }
}
