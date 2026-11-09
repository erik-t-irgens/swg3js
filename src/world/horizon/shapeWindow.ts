// The rings' shape window (the horizon pass's wave 3b): the live generator's own 2 m heights round the eye, laid as the
// near ground lays them, so the rings' finer levels just past the near ground stand on the very poles the chunks stand on
// and not on the bake's 8 m samples (the bake is made from 2 m poles but keeps one in sixteen). A square of `side` samples,
// toroidal by the global sample index (raw over the step), made a block (a 64 m chunk of 32 poles) at a time, nearest the
// eye first: from the near ground's own cached block where there is one (its heights as laid, the courses carved and the
// owner's edits over them), else asked of the terrain worker one at a time (its grid the near ground's block's own, laid by
// the sampler's own rule), so the near ground's own asks never wait behind a strip of it. A sample not made holds
// `SHAPE_EMPTY`, which the ring program reads as none.
//
// Pure of the page and the card: the field puts the made blocks on the card (`dirty`, `takeDirty`); a frame that moves
// nothing makes nothing.

/**
 * The hatch at load: `localStorage['swg.horizon.shape'] = '0'` makes no shape window and no finer level, which is the rings
 * of before (the atlas, the selection and the uniforms of before; `HORIZON_TUNE.shape` is the live switch).
 */
export const SHAPE_WANTED: boolean = (() => {
  try {
    return localStorage.getItem('swg.horizon.shape') !== '0';
  } catch {
    return true;
  }
})();

/**
 * Samples a side of the window (2,048 m at 2 m). Its heights hold at their whole share to `shapeWindowReach` along an axis
 * from an eye anywhere in its block (926 m at the default fade), which the finer levels' ranges are held inside.
 */
export const SHAPE_SIDE = 1024;
/** Samples a side of a block: a 64 m chunk of the near ground's 2 m poles. */
export const SHAPE_BLOCK = 32;
/**
 * Wave h6a (the owner's "finer shape far out"): the window's sides the Graphics page offers (its Terrain shape window), the
 * first today's. 2,048 holds the 2 m shape about twice as far (`shapeReachMostOf`) for four times the samples: about 18 MB
 * more on the card and about 28 MB more on the CPU (its heights, and the raw grids kept beside the worker's blocks), and
 * four times the worker's fill.
 */
export const SHAPE_SIDES: readonly number[] = [1024, 2048];
/**
 * The window's side in force (the Graphics page's choice, written by the game before any world and when it moves): read by
 * the world as it makes a field, by the Terrain shape detail's most and by `tuneHorizon`'s hold. A move in play makes the
 * field's window again behind a short curtain (`World.reshapeHorizon`).
 */
export const SHAPE_CHOICE = { side: SHAPE_SIDE };
/** A setting's number as a side the window takes: 2,048 where it says so, else today's 1,024. */
export function shapeSideOf(v: unknown): number {
  return v === 2048 ? 2048 : SHAPE_SIDE;
}
/**
 * The furthest the 2 m shape may hold for a window of `side` samples under a fade, morph share and gap (wave 3b's review,
 * `shapeReachMost`'s arithmetic by the side): the finest level's range a 4 m morph step inside `shapeWindowReach`, its
 * coarser neighbour's morph its gap of 32 m nodes past it. 703 m at 1,024 samples, 1,574 m at 2,048, at the shipped tune.
 */
export function shapeReachMostOf(side: number, fade: number, morph: number, gap: number): number {
  const f = Math.max(fade, 1);
  const half = (side / SHAPE_BLOCK) >> 1;
  const bw = SHAPE_BLOCK * 2;
  const most = Math.min((side - 1 - f) * 2 - (half + 1) * bw, half * bw - f * 2) - 4;
  const mf = Math.min(Math.max(morph, 0.01), 0.9);
  return most * (1 - mf) - Math.max(gap, 0) * 32;
}
/** The Graphics page's Terrain shape detail top for a window side at the shipped fade, morph and gap, kilometres on its 25 m steps. */
export function shapeDetailTopKm(side: number): number {
  return (Math.floor(shapeReachMostOf(shapeSideOf(side), 16, 0.15, 2.5) / 25) * 25) / 1000;
}
/**
 * The Terrain shape detail (kilometres) held where a window of `side` holds it (h6a's review): a setting saved under the
 * window of 2,048 and read, or left standing, under 1,024 is the page's top there, so the page, the console and the rings
 * say one number. Never under nought.
 */
export function heldShapeDetailKm(km: number, side: number): number {
  return Math.min(shapeDetailTopKm(side), Math.max(0, Number.isFinite(km) ? km : 0));
}
/** What a sample not made holds; the ring program reads anything under -1e29 as none. */
export const SHAPE_EMPTY = -1e30;
/**
 * How far from the eye, along an axis in its worst direction, the window's heights hold at their whole share (wave 3b's
 * review): it stands blocks `ebx - half .. ebx + half - 1` round the eye's block, its last `fade` samples fade and its
 * bilinear reads one sample on, so from an eye at its block's far edge one side holds `(side - 1 - fade) * step - (half +
 * 1) * 64` metres and the other `half * 64 - fade * step` (926 m at 1,024 samples and a fade of 16). The finer ring levels
 * are held inside it (`shapeRanges`, which writes the same arithmetic out); past it the 2 m shape would be the bake's 8 m.
 */
export function shapeWindowReach(fade: number, side = SHAPE_SIDE, step = 2): number {
  const f = Math.max(fade, 1);
  const half = (side / SHAPE_BLOCK) >> 1;
  const bw = SHAPE_BLOCK * step;
  return Math.min((side - 1 - f) * step - (half + 1) * bw, half * bw - f * step);
}
/** How many blocks a frame asks the near ground's cache for at most (a number key now: the arrival's first fill is spread over frames). */
export const SHAPE_CACHE_PER_FRAME = 48;

/** Where a block's heights come from: the near ground's cache, or the live generator. */
export interface ShapeSource {
  /** The near ground's cached block (bx, bz)'s 32 by 32 own poles from raw (bx·64, bz·64), as laid, into `out`; false when not cached. */
  cached(bx: number, bz: number, out: Float32Array): boolean;
  /**
   * The block made by the live generator and laid as the near ground lays a block, its own 32 by 32 poles; null when it
   * cannot now (no worker). W4: with the raw grid it was laid from beside them (`ShapeMade`), so an edit made later lays it
   * again from raw with no worker (`lay`).
   */
  make(bx: number, bz: number): Promise<Float32Array | ShapeMade | null> | null;
  /** W4: a block `make` handed back laid again from its raw grid with the edits in force now, its own 32 by 32 poles into `out`. */
  lay?(bx: number, bz: number, raw: Float32Array, out: Float32Array): void;
}

/** A block the live generator made (W4): its own poles as laid, and the raw grid they were laid from. */
export interface ShapeMade {
  inner: Float32Array;
  raw: Float32Array;
}

/** Slot states. */
const WANTED = 0;
const PENDING = 1;
const ASKED = 2;
const MADE = 3;

export class ShapeWindow {
  readonly side: number;
  readonly blocks: number;
  readonly step: number;
  /** The window's heights, `side` by `side`, toroidal by the global sample index (`mod(gi, side)`). */
  readonly heights: Float32Array;
  /** The window's first block each way (raw block index), and whether it stands anywhere yet. */
  bx0 = 0;
  bz0 = 0;
  placed = false;
  /** Which block each slot (toroidal by block index) holds, and how far along it is. */
  private readonly slotX: Int32Array;
  private readonly slotZ: Int32Array;
  private readonly state: Uint8Array;
  /** Slots a frame should put on the card (made, or emptied by a move), a queue of slot numbers; and whether the whole window should go at once. */
  private readonly dirtyQ: Int32Array;
  private dirtyN = 0;
  private readonly isDirty: Uint8Array;
  whole = false;
  /** The window moved this frame: every slot it emptied must reach the card in the frame its new place is written (the field clears it). */
  moved = false;
  /** The slots in order of their distance from the window's middle (block offsets), walked from the eye's block. */
  private readonly spiral: Int16Array;
  private readonly scratch: Float32Array;
  /** The block asked of the worker and not answered (one at a time), or -1. */
  private asked = -1;
  private eyeBx = 0;
  private eyeBz = 0;
  made = 0;
  /**
   * For the console: blocks copied from the near ground's cache, made by the worker, answers dropped (moved past), nulls;
   * W4: blocks laid again under an edit (`relaid`: copied again from the cache, or laid from a kept raw grid) and blocks an
   * edit could do neither for, asked again (`reasked`).
   */
  readonly counts = { cached: 0, generated: 0, dropped: 0, failed: 0, moves: 0, relaid: 0, reasked: 0 };
  /** W4: the raw grid each slot the worker made was laid from (null where its block came from the cache), by slot. */
  private readonly raws: (Float32Array | null)[];
  source: ShapeSource | null = null;
  disposed = false;

  constructor(side = SHAPE_SIDE, step = 2) {
    this.side = side;
    this.step = step;
    this.blocks = side / SHAPE_BLOCK;
    const B = this.blocks;
    this.heights = new Float32Array(side * side).fill(SHAPE_EMPTY);
    this.slotX = new Int32Array(B * B).fill(0x7fffffff);
    this.slotZ = new Int32Array(B * B).fill(0x7fffffff);
    this.state = new Uint8Array(B * B);
    this.dirtyQ = new Int32Array(B * B);
    this.isDirty = new Uint8Array(B * B);
    this.scratch = new Float32Array(SHAPE_BLOCK * SHAPE_BLOCK);
    this.raws = new Array<Float32Array | null>(B * B).fill(null);
    const offs: [number, number, number][] = [];
    const h = B >> 1;
    for (let dz = -h; dz < B - h; dz++) for (let dx = -h; dx < B - h; dx++) offs.push([dx, dz, dx * dx + dz * dz]);
    offs.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    this.spiral = new Int16Array(offs.length * 2);
    offs.forEach(([dx, dz], i) => {
      this.spiral[i * 2] = dx;
      this.spiral[i * 2 + 1] = dz;
    });
  }

  /** A block's slot (toroidal), by its raw block index. */
  slotOf(bx: number, bz: number): number {
    const B = this.blocks;
    return (((bz % B) + B) % B) * B + (((bx % B) + B) % B);
  }

  /** The window's first global sample each way (the ring's `uHorizonShapeWin.x`, `.y`). */
  get gi0(): number {
    return this.bx0 * SHAPE_BLOCK;
  }
  get gj0(): number {
    return this.bz0 * SHAPE_BLOCK;
  }

  /**
   * A frame (the eye's raw place): the window stood round the eye's block (a move empties the slots it hands to new
   * blocks), up to `SHAPE_CACHE_PER_FRAME` wanted blocks taken from the near ground's cache, and one block asked of the
   * worker when none is out. Nothing made when nothing moved and nothing is wanted.
   */
  stepTo(rx: number, rz: number): void {
    this.eye[0] = rx;
    this.eye[1] = rz;
    this.stepEye();
  }

  /** The eye's raw place, written by the field a frame (a fraction handed across a call is a number made). */
  readonly eye = new Float64Array(2);

  /** `stepTo` at the place in `eye`: the frame's own call. */
  stepEye(): void {
    if (this.disposed) return;
    const BW = SHAPE_BLOCK * this.step;
    const ebx = Math.floor(this.eye[0] / BW);
    const ebz = Math.floor(this.eye[1] / BW);
    this.eyeBx = ebx;
    this.eyeBz = ebz;
    const h = this.blocks >> 1;
    const nbx = ebx - h;
    const nbz = ebz - h;
    if (!this.placed || nbx !== this.bx0 || nbz !== this.bz0) this.place(nbx, nbz);
    if (this.made === this.blocks * this.blocks || !this.source) return;
    this.fill();
  }

  /** The window stood at a new first block: every slot whose block moved out handed to the block now there, emptied. */
  private place(nbx: number, nbz: number): void {
    const B = this.blocks;
    const far = !this.placed || Math.abs(nbx - this.bx0) >= B >> 2 || Math.abs(nbz - this.bz0) >= B >> 2;
    this.bx0 = nbx;
    this.bz0 = nbz;
    this.placed = true;
    this.moved = true;
    this.counts.moves++;
    if (far) this.whole = true;
    for (let j = 0; j < B; j++) {
      for (let i = 0; i < B; i++) {
        const bx = nbx + i;
        const bz = nbz + j;
        const s = this.slotOf(bx, bz);
        if (this.slotX[s] === bx && this.slotZ[s] === bz) continue;
        if (this.state[s] === MADE) this.made--;
        this.slotX[s] = bx;
        this.slotZ[s] = bz;
        this.state[s] = WANTED;
        this.raws[s] = null;
        this.clear(s);
        if (!far) this.markDirty(s);
      }
    }
  }

  private clear(s: number): void {
    const B = this.blocks;
    const n = this.side;
    const c0 = (s % B) * SHAPE_BLOCK;
    const r0 = Math.floor(s / B) * SHAPE_BLOCK;
    for (let j = 0; j < SHAPE_BLOCK; j++) this.heights.fill(SHAPE_EMPTY, (r0 + j) * n + c0, (r0 + j) * n + c0 + SHAPE_BLOCK);
  }

  private markDirty(s: number): void {
    if (this.isDirty[s]) return;
    this.isDirty[s] = 1;
    this.dirtyQ[this.dirtyN++] = s;
  }

  /** A frame's share: the wanted blocks nearest the eye taken from the near ground's cache, and one asked of the worker when none is out. */
  private fill(): void {
    this.pump(SHAPE_CACHE_PER_FRAME);
  }

  /**
   * Walks the slots nearest the eye first: a wanted one is looked for in the near ground's cache (at most `probes` of them)
   * and taken from it, or left pending; the first pending one is asked of the worker when none is out.
   */
  private pump(probes: number): void {
    const src = this.source;
    if (!src) return;
    const B = this.blocks;
    let firstPending = -1;
    const n = this.spiral.length >> 1;
    for (let k = 0; k < n; k++) {
      const bx = this.eyeBx + this.spiral[k * 2];
      const bz = this.eyeBz + this.spiral[k * 2 + 1];
      if (bx < this.bx0 || bz < this.bz0 || bx >= this.bx0 + B || bz >= this.bz0 + B) continue;
      const s = this.slotOf(bx, bz);
      if (this.state[s] === WANTED) {
        if (probes <= 0) continue;
        probes--;
        if (src.cached(bx, bz, this.scratch)) {
          this.raws[s] = null;
          this.put(s, this.scratch);
          this.counts.cached++;
          continue;
        }
        this.state[s] = PENDING;
      }
      if (this.state[s] === PENDING && firstPending < 0) {
        firstPending = s;
        if (probes <= 0) break;
      }
    }
    if (firstPending >= 0 && this.asked < 0) this.ask(firstPending);
  }

  /** One block asked of the worker; its answer put where its slot still wants it, and the next asked at once (never waiting for a frame). */
  private ask(s: number): void {
    const src = this.source;
    if (!src) return;
    const bx = this.slotX[s];
    const bz = this.slotZ[s];
    const p = src.make(bx, bz);
    if (!p) return;
    this.asked = s;
    this.state[s] = ASKED;
    p.then(
      (h) => this.landed(s, bx, bz, h),
      () => this.landed(s, bx, bz, null),
    );
  }

  private landed(s: number, bx: number, bz: number, h: Float32Array | ShapeMade | null): void {
    if (this.asked === s) this.asked = -1;
    if (this.disposed) return;
    const still = this.slotX[s] === bx && this.slotZ[s] === bz && this.state[s] === ASKED;
    if (!still) this.counts.dropped++;
    else if (!h) {
      this.counts.failed++;
      this.state[s] = PENDING;
    } else if (h instanceof Float32Array) {
      this.raws[s] = null;
      this.put(s, h);
      this.counts.generated++;
    } else {
      // The raw grid kept beside it (W4): an edit made later lays the block again from it with no worker.
      this.raws[s] = h.raw;
      this.put(s, h.inner);
      this.counts.generated++;
    }
    // The next nearest block asked at once (a wanted one looked for in the cache first): the worker makes the window as fast
    // as it can between the near ground's asks, with no frame between.
    if (this.asked < 0) this.pump(SHAPE_CACHE_PER_FRAME);
  }

  /** A block's 32 by 32 poles into its slot, and the slot due on the card. */
  private put(s: number, h: Float32Array): void {
    const B = this.blocks;
    const n = this.side;
    const c0 = (s % B) * SHAPE_BLOCK;
    const r0 = Math.floor(s / B) * SHAPE_BLOCK;
    // Written out (a `subarray` a row is an object made, and a frame's cached block lands here).
    const H = this.heights;
    for (let j = 0; j < SHAPE_BLOCK; j++) for (let i = 0; i < SHAPE_BLOCK; i++) H[(r0 + j) * n + c0 + i] = h[j * SHAPE_BLOCK + i];
    if (this.state[s] !== MADE) this.made++;
    this.state[s] = MADE;
    this.markDirty(s);
  }

  /** Slots due on the card, handed one at a time (`-1` when none): their texels are `heights`' own block. */
  takeDirty(): number {
    if (!this.dirtyN) return -1;
    const s = this.dirtyQ[--this.dirtyN];
    this.isDirty[s] = 0;
    return s;
  }
  get dirty(): number {
    return this.dirtyN;
  }
  /** Every slot's due upload dropped (the whole window is going at once). */
  dropDirty(): void {
    while (this.dirtyN) this.isDirty[this.dirtyQ[--this.dirtyN]] = 0;
  }

  /**
   * The window's height at a raw place (the far cards' surface, the console): the bilinear of its four samples, NaN where it
   * holds the place not or any of the four is not made (`shapeHeight`'s arithmetic, written out).
   */
  heightAt(rx: number, rz: number): number {
    if (!this.placed) return Number.NaN;
    const fx = rx / this.step;
    const fz = rz / this.step;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const lx = ix - this.gi0;
    const lz = iz - this.gj0;
    const n = this.side;
    if (lx < 0 || lz < 0 || lx > n - 2 || lz > n - 2) return Number.NaN;
    const c0 = ((ix % n) + n) % n;
    const c1 = (((ix + 1) % n) + n) % n;
    const r0 = ((iz % n) + n) % n;
    const r1 = (((iz + 1) % n) + n) % n;
    const H = this.heights;
    const h00 = H[r0 * n + c0];
    const h10 = H[r0 * n + c1];
    const h01 = H[r1 * n + c0];
    const h11 = H[r1 * n + c1];
    if (h00 < -1e29 || h10 < -1e29 || h01 < -1e29 || h11 < -1e29) return Number.NaN;
    const ax = fx - ix;
    const az = fz - iz;
    const a = h00 + (h10 - h00) * ax;
    const b = h01 + (h11 - h01) * ax;
    return a + (b - a) * az;
  }

  /**
   * A ring vertex's height at a raw place, as the vertex stage reads it (`ringHeightAt`, written out): the window's bilinear
   * mixed into the bake's `bake` by the window's share there (one inside, fading to nought over its last `fade` samples, nought
   * where a sample of the four is not made). The far cards' surface (wave 3b's review: the cards stand on what the ring draws).
   */
  ringHeight(rx: number, rz: number, bake: number, fade: number): number {
    if (!this.placed) return bake;
    const fx = rx / this.step;
    const fz = rz / this.step;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const lx = ix - this.gi0;
    const lz = iz - this.gj0;
    const n = this.side;
    const inner = Math.min(Math.min(lx, lz), Math.min(n - 2 - lx, n - 2 - lz));
    const share = Math.min(Math.max(inner / Math.max(fade, 1), 0), 1);
    if (share <= 0) return bake;
    const c0 = ((ix % n) + n) % n;
    const c1 = (((ix + 1) % n) + n) % n;
    const r0 = ((iz % n) + n) % n;
    const r1 = (((iz + 1) % n) + n) % n;
    const H = this.heights;
    const h00 = H[r0 * n + c0];
    const h10 = H[r0 * n + c1];
    const h01 = H[r1 * n + c0];
    const h11 = H[r1 * n + c1];
    if (h00 < -1e29 || h10 < -1e29 || h01 < -1e29 || h11 < -1e29) return bake;
    const ax = fx - ix;
    const az = fz - iz;
    const a = h00 * (1 - ax) + h10 * ax;
    const b = h01 * (1 - ax) + h11 * ax;
    const w = a * (1 - az) + b * az;
    return bake * (1 - share) + w * share;
  }

  /**
   * The finest ring's own surface at a raw place (the far cards stand on it where the window holds them): the 2 m cell's
   * triangle under it, split as the patch is (the raw south-west to north-east diagonal), never the bilinear. NaN where the
   * window does not hold the cell.
   */
  surfaceAt(rx: number, rz: number): number {
    if (!this.placed) return Number.NaN;
    const fx = rx / this.step;
    const fz = rz / this.step;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const n = this.side;
    if (ix - this.gi0 < 0 || iz - this.gj0 < 0 || ix - this.gi0 > n - 2 || iz - this.gj0 > n - 2) return Number.NaN;
    const c0 = ((ix % n) + n) % n;
    const c1 = (((ix + 1) % n) + n) % n;
    const r0 = ((iz % n) + n) % n;
    const r1 = (((iz + 1) % n) + n) % n;
    const H = this.heights;
    const h00 = H[r0 * n + c0];
    const h10 = H[r0 * n + c1];
    const h01 = H[r1 * n + c0];
    const h11 = H[r1 * n + c1];
    if (h00 < -1e29 || h10 < -1e29 || h01 < -1e29 || h11 < -1e29) return Number.NaN;
    const u = fx - ix;
    const v = fz - iz;
    return u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + v * (h01 - h00) + u * (h11 - h01);
  }

  /**
   * W4 (DESIGN.md §6): the blocks whose own poles a rectangle of the raw frame reaches laid again as they are made (a
   * stroke's stamp, a course's piece, an undo, a file landed): a made block taken again from the near ground's cache (which
   * its own relay laid first), else laid again from the raw grid the worker made it from (`ShapeSource.lay`), else asked of
   * the worker again, its heights standing until the answer lands; a block on its way is laid as it lands, with the edits
   * then in force; one not made yet waits to be made. Put on the card a few a frame as made blocks are (`takeDirty`).
   * Answers how many it laid. A stamp's work: the cache's copy and the lay allocate only the lay's own copy of a raw grid.
   */
  relayRect(x0: number, z0: number, x1: number, z1: number): number {
    const src = this.source;
    if (!src || this.disposed || !this.placed) return 0;
    const BW = SHAPE_BLOCK * this.step;
    // A pole of reach each way (an edit's rectangle is a pole's; a block's own poles end a pole short of the next block).
    const lx = Math.min(x0, x1) - this.step;
    const hx = Math.max(x0, x1) + this.step;
    const lz = Math.min(z0, z1) - this.step;
    const hz = Math.max(z0, z1) + this.step;
    const B = this.blocks;
    const bx0 = Math.max(this.bx0, Math.floor(lx / BW));
    const bx1 = Math.min(this.bx0 + B - 1, Math.floor(hx / BW));
    const bz0 = Math.max(this.bz0, Math.floor(lz / BW));
    const bz1 = Math.min(this.bz0 + B - 1, Math.floor(hz / BW));
    let laid = 0;
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const s = this.slotOf(bx, bz);
        if (this.slotX[s] !== bx || this.slotZ[s] !== bz || this.state[s] !== MADE) continue;
        const raw = this.raws[s];
        if (src.cached(bx, bz, this.scratch)) {
          this.raws[s] = null;
          this.put(s, this.scratch);
        } else if (raw && src.lay) {
          src.lay(bx, bz, raw, this.scratch);
          this.put(s, this.scratch);
        } else {
          // Neither: asked of the worker again, the heights it holds standing meanwhile.
          this.state[s] = WANTED;
          this.made--;
          this.counts.reasked++;
          continue;
        }
        laid++;
      }
    }
    this.counts.relaid += laid;
    if (this.made < B * B && this.asked < 0) this.pump(SHAPE_CACHE_PER_FRAME);
    return laid;
  }

  /** The bytes of the raw grids kept beside the blocks the worker made (`raws`): the console's memory (h6a's review). */
  rawBytes(): number {
    let n = 0;
    for (const r of this.raws) if (r) n += r.byteLength;
    return n;
  }

  /** Every made block let go (a late heights or course file: the near ground's own blocks are laid again, so the window takes them again). */
  forget(): void {
    const B = this.blocks;
    for (let s = 0; s < B * B; s++) {
      if (this.state[s] === ASKED) continue;
      this.state[s] = WANTED;
    }
    this.made = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.source = null;
  }
}

/** What the near ground's terrain hands the shape window (`SwgTerrain` and its sampler satisfy it). */
export interface ShapeTerrain {
  readonly sampler: {
    readonly poleStep: number;
    copyInnerHeights(bx: number, bz: number, out: Float32Array): boolean;
    layBlockHeights(bx: number, bz: number, heights: Float32Array): void;
    blockStart(bx: number, bz: number): { x: number; z: number };
    readonly numberOfPoles: number;
  };
  readonly workerUp: boolean;
  generatePoles(startX: number, startZ: number, n: number, step: number): Promise<{ heights: Float32Array } | null>;
}

/** The ORIGIN_OFFSET of a block's grid (trn.ts): its own poles start this many in. */
const BLOCK_OFFSET = 2;

/**
 * The shape window's source over the near ground's terrain: a cached block's own poles, else the very grid the near ground
 * would ask the worker for that block, laid by the sampler's own rule, its own poles taken; nothing asked with no worker (the
 * main thread never generates a block for it).
 */
export function shapeSourceOf(t: ShapeTerrain): ShapeSource {
  return {
    cached: (bx, bz, out) => t.sampler.copyInnerHeights(bx, bz, out),
    make: (bx, bz) => {
      if (!t.workerUp) return null;
      const s = t.sampler.blockStart(bx, bz);
      const np = t.sampler.numberOfPoles;
      return t.generatePoles(s.x, s.z, np, t.sampler.poleStep).then((b) => {
        if (!b) return null;
        // The raw grid kept beside the laid poles (W4): an edit made later lays the block again from it (`lay`).
        const raw = b.heights.slice();
        t.sampler.layBlockHeights(bx, bz, b.heights);
        const out = new Float32Array(SHAPE_BLOCK * SHAPE_BLOCK);
        for (let j = 0; j < SHAPE_BLOCK; j++) for (let i = 0; i < SHAPE_BLOCK; i++) out[j * SHAPE_BLOCK + i] = b.heights[(j + BLOCK_OFFSET) * np + i + BLOCK_OFFSET];
        return { inner: out, raw };
      });
    },
    lay: (bx, bz, raw, out) => {
      // From raw every time, by the sampler's own rule for a block entering the cache (the carve, then the edits over it).
      const g = raw.slice();
      t.sampler.layBlockHeights(bx, bz, g);
      const np = t.sampler.numberOfPoles;
      for (let j = 0; j < SHAPE_BLOCK; j++) for (let i = 0; i < SHAPE_BLOCK; i++) out[j * SHAPE_BLOCK + i] = g[(j + BLOCK_OFFSET) * np + i + BLOCK_OFFSET];
    },
  };
}
