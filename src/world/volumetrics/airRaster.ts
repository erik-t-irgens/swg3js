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
// Pure: no three; the field uploads these arrays as textures.

/** What the world answers for one point of the ground; the sampler writes it and answers false where it knows nothing yet. */
export interface GroundSample {
  /** Metres. */
  h: number;
  /** The shader family painting the ground there, -1 for none known. */
  family: number;
  /** 1 land, 2 water, 3 lava. */
  medium: number;
}

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
  /** The dust's colour as sRGB bytes and the medium byte (`MEDIUM_BYTE`). */
  colour = new Uint8Array(0);
  /** 1 where the cell is known. */
  known = new Uint8Array(0);
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
  private readonly s: GroundSample = { h: 0, family: -1, medium: 0 };

  /** A raster of `n` a side, every cell unknown. */
  resize(n: number): void {
    if (n === this.n) return;
    this.n = n;
    this.height = new Float32Array(n * n);
    this.response = new Uint8Array(n * n * 4);
    this.colour = new Uint8Array(n * n * 4);
    this.known = new Uint8Array(n * n);
    this.clear();
  }

  /** Every cell unknown (a jump, a new world). */
  clear(): void {
    this.height.fill(this.mean);
    this.response.fill(0);
    this.colour.fill(0);
    this.known.fill(0);
    this.unknown = this.n * this.n;
    this.cursor = 0;
    this.dirty = true;
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
    shiftGrid(this.known, n, 1, dx, dz, 0);
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
    if (!src.sample(this.askOx + (i + 0.5) * cell, this.askOz + (j + 0.5) * cell, s) || !Number.isFinite(s.h)) {
      if (was) {
        this.known[k] = 0;
        this.colour[k * 4 + 3] = 0;
        this.response[k * 4 + 3] = 0;
        this.unknown++;
        this.dirty = true;
      }
      return;
    }
    this.height[k] = s.h;
    const fam = s.family;
    const fr = this.familyResponse;
    const fc = this.familyColour;
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
    if (known && fam * 4 + 3 < fc.length && fc[fam * 4 + 3] > 0) {
      this.colour[p] = fc[fam * 4];
      this.colour[p + 1] = fc[fam * 4 + 1];
      this.colour[p + 2] = fc[fam * 4 + 2];
    } else {
      this.colour[p] = this.fallback[0];
      this.colour[p + 1] = this.fallback[1];
      this.colour[p + 2] = this.fallback[2];
    }
    this.colour[p + 3] = s.medium === 3 ? 255 : s.medium === 2 ? 170 : 85;
    if (!was) {
      this.known[k] = 1;
      this.unknown--;
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
export function shiftGrid(a: Float32Array | Uint8Array, n: number, c: number, dx: number, dz: number, fill: number): void {
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
