// The sculpt brush's "This track" stroke (the race drawer's wave 3b, `A:\swg3js\racedrawer\DESIGN.md` §5b), pure: a stroke
// over one path's brush lattice (`courseGround.ts`: a cell every 2 m along the path's own arclength and every 2 m across from
// its spine, kept in chunks of 16 along), never over the world's heights. Each stamp moves the cells whose places on the
// ground fall in its disc by the sculpt's own rules (`sculpt.ts`: raise and lower per second, flatten toward a height,
// smooth by the 1-2-1 mean, all weighted by the client's feather), in float64; the chunks it touched are handed back as
// float32 once it ends, each trimmed to the cells across it holds and none for a chunk of noughts.
//
// "The ground now" at a cell (flatten's and smooth's `h`) is the ground the world drew where the cell lies when the stroke
// first met it, less the cell's own delta then, plus its delta now.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. The dev server's alone: reached only through the editor's own dynamic import.

import { BRUSH_ALONG, BRUSH_CELL, GROUND_LIMITS, brushCells, brushLattice, latticeEdge, type BrushChunk } from '../race/courseGround.ts';
import { locateAlong } from '../race/courseGates.ts';
import { nearestOn, spineAt, spineNear, spinePoint, type Spine } from '../race/coursePath.ts';
import { stampWeight, type StampAsk } from './sculpt.ts';

/** One chunk as the stroke keeps it: its first cell across, its count, its deltas (16 along by `n`) in float64. */
interface Working {
  a: number;
  n: number;
  d: Float64Array;
}

/** A stroke over one path of a track. */
export class TrackStroke {
  readonly path: string;
  private readonly spine: Spine;
  private readonly ground: (x: number, z: number) => number;
  /** Each chunk the stroke has read (from the track, or made), by its index along; and which it has changed. */
  private readonly work = new Map<number, Working>();
  readonly touched = new Set<number>();
  /** The ground under each cell where the stroke first met it, less its delta then (`I`, `J` keyed). */
  private readonly base = new Map<number, number>();
  stamps = 0;
  private readonly P = spinePoint();
  private readonly at = { e: 0, t: 0 };
  /** The lattice the nodes anchor (`brushLattice`): its coordinate at each node and its last edge's end, and its edge count. */
  private readonly lam: Float64Array;
  private readonly E: number;
  /** A closed path's cells along (they wrap at it); an open path's first and last cell on it. */
  private readonly N: number;
  private readonly lo: number;
  private readonly hi: number;
  private readonly closed: boolean;
  /** Chunks of this path the track names whose deltas were never inflated here (the review round: a stroke over one is refused). */
  readonly missing = new Set<number>();

  /**
   * `nodes` (with their `bs`) and `bl` the path's own: its lattice; with none, the lattice is the arclength from node 0, as a
   * path never stroked keeps it.
   */
  constructor(path: string, spine: Spine, chunks: readonly BrushChunk[], ground: (x: number, z: number) => number, nodes?: readonly { bs?: number }[], bl?: number) {
    this.path = path;
    this.spine = spine;
    this.ground = ground;
    this.closed = spine.closed;
    this.E = spine.edges.length;
    const ns = nodes ?? Array.from({ length: spine.closed ? this.E : this.E + 1 }, () => ({}));
    this.lam = brushLattice(ns, spine.start, spine.length, spine.closed, bl);
    const P = this.lam[this.E] - this.lam[0];
    this.N = spine.closed ? Math.ceil(P / BRUSH_CELL) : 0;
    this.lo = Math.ceil(this.lam[0] / BRUSH_CELL);
    this.hi = Math.floor(this.lam[this.E] / BRUSH_CELL);
    for (const c of chunks) {
      if (c.path !== path) continue;
      const cells = brushCells(c.d);
      if (!cells || cells.length !== BRUSH_ALONG * c.n) {
        this.missing.add(c.k);
        continue;
      }
      const d = new Float64Array(cells.length);
      for (let i = 0; i < cells.length; i++) d[i] = cells[i];
      this.work.set(c.k, { a: c.a, n: c.n, d });
    }
  }

  /** A cell's lattice index along wrapped onto the path (null past an open path's ends). */
  private along(I: number): number | null {
    if (this.closed) return this.N > 0 ? ((I % this.N) + this.N) % this.N : null;
    return I >= this.lo && I <= this.hi ? I : null;
  }

  /** The lattice coordinate at an arclength along the spine (a closed path's taken round). */
  private latOf(s: number): number {
    locateAlong(this.spine, s, this.at);
    const e = this.at.e;
    return this.lam[e] + this.at.t * (this.lam[e + 1] - this.lam[e]);
  }

  /** A cell's delta now (nought where no chunk holds it). */
  delta(I: number, J: number): number {
    const w = this.work.get(Math.floor(I / BRUSH_ALONG));
    if (!w) return 0;
    const j = J - w.a;
    return j < 0 || j >= w.n ? 0 : w.d[(I - Math.floor(I / BRUSH_ALONG) * BRUSH_ALONG) * w.n + j];
  }

  /** A cell's delta written, its chunk made or widened across as it needs. */
  private write(I: number, J: number, v: number): void {
    const k = Math.floor(I / BRUSH_ALONG);
    let w = this.work.get(k);
    if (!w) {
      w = { a: J, n: 1, d: new Float64Array(BRUSH_ALONG) };
      this.work.set(k, w);
    } else if (J < w.a || J >= w.a + w.n) {
      const a = Math.min(w.a, J);
      const n = Math.max(w.a + w.n, J + 1) - a;
      const d = new Float64Array(BRUSH_ALONG * n);
      for (let i = 0; i < BRUSH_ALONG; i++) for (let j = 0; j < w.n; j++) d[i * n + (w.a - a + j)] = w.d[i * w.n + j];
      w = { a, n, d };
      this.work.set(k, w);
    }
    w.d[(I - k * BRUSH_ALONG) * w.n + (J - w.a)] = v;
    this.touched.add(k);
  }

  /** A cell's place on the ground (the raw frame) into `out`; false past the path. */
  place(I: number, J: number, out: { x: number; z: number }): boolean {
    if (!latticeEdge(this.lam, this.E, this.closed, I * BRUSH_CELL, this.at)) return false;
    if (!spineAt(this.spine, this.at.e, this.at.t, this.P)) return false;
    const o = J * BRUSH_CELL;
    out.x = this.P.x + this.P.tz * o;
    out.z = this.P.z - this.P.tx * o;
    return true;
  }

  private readonly pl = { x: 0, z: 0 };

  /** The ground now at a cell (the world's where the stroke first met it, less its delta then, plus its delta now). */
  heightAt(I: number, J: number): number {
    const key = I * 1000 + J;
    let b = this.base.get(key);
    if (b === undefined) {
      b = this.place(I, J, this.pl) ? this.ground(this.pl.x, this.pl.z) - this.delta(I, J) : Number.NaN;
      this.base.set(key, b);
    }
    return b + this.delta(I, J);
  }

  /**
   * One stamp (`a` in the raw frame, its `dt` the stamp's seconds): every cell of the path whose place lies in the disc moved
   * by the mode's rule. Answers how many cells it changed.
   */
  stamp(a: StampAsk): number {
    const R = a.radius;
    if (!(R > 0) || !(a.dt > 0)) return 0;
    const near = spineNear();
    if (!nearestOn(this.spine, a.cx, a.cz, near)) return 0;
    this.stamps++;
    const sc = this.spine.start[near.e] + near.t * this.spine.edges[near.e].len;
    // The window of cells: twice the disc along (a curve's outside stretches it) taken onto the lattice, the disc and a cell
    // across.
    const lc = this.lam[near.e] + near.t * (this.lam[near.e + 1] - this.lam[near.e]);
    let llo = this.latOf(sc - 2 * R);
    let lhi = this.latOf(sc + 2 * R);
    if (this.closed) {
      const P = this.lam[this.E] - this.lam[0];
      if (llo > lc) llo -= P;
      if (lhi < lc) lhi += P;
    }
    const I0 = Math.floor(llo / BRUSH_CELL);
    const I1 = Math.ceil(lhi / BRUSH_CELL);
    const J0 = Math.max(-GROUND_LIMITS.across, Math.floor((near.o - R) / BRUSH_CELL) - 1);
    const J1 = Math.min(GROUND_LIMITS.across, Math.ceil((near.o + R) / BRUSH_CELL) + 1);
    const qFlat = 1 - Math.exp(-a.dt / Math.max(1e-6, a.tau));
    const qSmooth = 1 - Math.exp(-a.dt / Math.max(1e-6, a.smoothTau));
    // Smooth reads the ground before the stamp (Jacobi): the window's heights, a cell past it each way.
    const nx = I1 - I0 + 3;
    const nj = J1 - J0 + 3;
    let hs: Float64Array | null = null;
    if (a.mode === 'smooth') {
      hs = new Float64Array(nx * nj);
      for (let i = 0; i < nx; i++) {
        const I = this.along(I0 - 1 + i);
        for (let j = 0; j < nj; j++) hs[i * nj + j] = I === null ? Number.NaN : this.heightAt(I, J0 - 1 + j);
      }
    }
    let changed = 0;
    const pl = this.pl;
    for (let ii = I0; ii <= I1; ii++) {
      const I = this.along(ii);
      if (I === null) continue;
      for (let J = J0; J <= J1; J++) {
        if (!this.place(I, J, pl)) continue;
        const dx = pl.x - a.cx;
        const dz = pl.z - a.cz;
        const f = stampWeight(Math.sqrt(dx * dx + dz * dz), R, a.hard, a.falloff);
        if (!(f > 0)) continue;
        const w = a.strength * f;
        const d = this.delta(I, J);
        let next = d;
        if (a.mode === 'raise') next = d + w * a.speed * a.dt;
        else if (a.mode === 'lower') next = d - w * a.speed * a.dt;
        else if (a.mode === 'flatten') {
          const h = this.heightAt(I, J);
          if (!Number.isFinite(h)) continue;
          const want = a.height - h;
          if ((a.flatMode === 'raise' && want <= 0) || (a.flatMode === 'lower' && want >= 0)) continue;
          next = d + w * qFlat * want;
        } else {
          const i = ii - I0 + 1;
          const j = J - J0 + 1;
          const k = i * nj + j;
          const h = hs![k];
          if (!Number.isFinite(h)) continue;
          const m = (4 * h + 2 * (hs![k - nj] + hs![k + nj] + hs![k - 1] + hs![k + 1]) + (hs![k - nj - 1] + hs![k - nj + 1] + hs![k + nj - 1] + hs![k + nj + 1])) / 16;
          if (!Number.isFinite(m)) continue;
          next = d + w * qSmooth * (m - h);
        }
        if (next === d) continue;
        const most = GROUND_LIMITS.delta;
        this.write(I, J, Math.max(-most, Math.min(most, next)));
        changed++;
      }
    }
    return changed;
  }

  /**
   * The chunks the stroke changed, as float32 cells trimmed to the columns across that hold anything (null for a chunk of
   * noughts): what is deflated and written once the stroke ends, and what a preview carves.
   */
  chunks(): Map<number, { a: number; n: number; cells: Float32Array } | null> {
    const out = new Map<number, { a: number; n: number; cells: Float32Array } | null>();
    for (const k of this.touched) {
      const w = this.work.get(k)!;
      let lo = w.n;
      let hi = -1;
      for (let j = 0; j < w.n; j++) {
        for (let i = 0; i < BRUSH_ALONG; i++) {
          if (Math.fround(w.d[i * w.n + j]) !== 0) {
            if (j < lo) lo = j;
            if (j > hi) hi = j;
            break;
          }
        }
      }
      if (hi < 0) {
        out.set(k, null);
        continue;
      }
      const n = hi - lo + 1;
      const cells = new Float32Array(BRUSH_ALONG * n);
      for (let i = 0; i < BRUSH_ALONG; i++) for (let j = 0; j < n; j++) cells[i * n + j] = w.d[i * w.n + lo + j];
      out.set(k, { a: w.a + lo, n, cells });
    }
    return out;
  }
}

/** The path of a track whose spine is nearest a point of the raw frame (the stroke's), or null. */
export function nearestPath(spines: readonly Spine[], ids: readonly string[], x: number, z: number): { path: string; spine: Spine } | null {
  const near = spineNear();
  let best = -1;
  let bd = Infinity;
  for (let p = 0; p < spines.length; p++) {
    if (!nearestOn(spines[p], x, z, near) || near.d >= bd) continue;
    bd = near.d;
    best = p;
  }
  return best < 0 ? null : { path: ids[best], spine: spines[best] };
}
