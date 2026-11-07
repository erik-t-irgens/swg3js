// Race walls (the race drawer's third wave, `A:\swg3js\racedrawer\DESIGN.md` §2.10's binding block and §5): walls the owner
// draws anywhere on a track, each a line of straight edges and circular arcs with a height over its feet and a lean, met only
// by a race-driven hull a run hands them to (or every race-driven hull, with `COURSE_TUNE.walls` 'racing'). Nothing else is
// told and no collider is made: the drive asks the set itself, inside the plan's sub-steps (`raceDrive.ts`).
//
// **In the file** a track's `walls` list (beside its `course`, read, hashed and written only where present): each wall a name,
// `high` (metres over its feet), `lean` (degrees from upright, positive toward the wall's right as drawn) and its points in the
// file's frame, each a place and its foot's height `y`, and `r` on a point for the edge leaving it when that edge is a circular
// arc (signed: positive bulges to the edge's right as seen in the game; absent, straight).
//
// **In the game** a set (`RaceWallSet`) of the walls sampled into straight segments in the game's frame (an arc cut every
// `arcStep`), each with its feet's heights, its height, its lean's tangent and its right normal, made once a change. Its two
// questions write their answers into kept records and make nothing: whether a hull's box, moved between two places, crosses a
// wall's slanted face between its foot and its top (`crossBox`), and how far along a ray the first wall a hull of that height
// meets stands (`clipAhead`: the look-ahead reads no ground past it).
//
// Pure: node loads it; it imports nothing.

/** The limits one reader holds every file to (ours), with the endpoint's: never moved from the browser. */
export const WALL_LIMITS = {
  /** Walls a track may hold, and points a wall (an open line: two at least). */
  walls: 64,
  pointsLeast: 2,
  points: 200,
  /** A wall's height over its feet (m) and its lean either way (degrees). */
  highLeast: 0.5,
  highMost: 50,
  leanMost: 60,
  /** Two consecutive points this far apart on the ground at least and at most (m). */
  edgeLeast: 0.5,
  edgeMost: 4000,
  /** An arc's radius at most (m); at least half its chord, or there is no such arc. */
  radiusMost: 100000,
  name: 80,
};

/** A point of a wall in the file's frame: its place, its foot's height, and the signed radius of the edge leaving it (absent: straight). */
export interface WallPoint {
  x: number;
  y: number;
  z: number;
  r?: number;
}

export interface RaceWall {
  name: string;
  /** Its height over its feet (m). */
  high: number;
  /** Degrees from upright, positive toward its right as drawn. */
  lean: number;
  points: WallPoint[];
}

const WALL_FIELDS = new Set(['name', 'high', 'lean', 'points']);
const POINT_FIELDS = new Set(['x', 'y', 'z', 'r']);
const CONTROL = /[\u0000-\u001f\u007f]/;

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** The words an arc too tight for its chord is refused in. */
export function arcRefusal(chord: number): string {
  return `an arc's radius is at least half its chord (${(chord / 2).toFixed(2)} m)`;
}

/**
 * A track's walls cleaned, or why they are refused. `reach` and `height` are the track file's own limits; fields this build
 * does not read are named into `unknown` as `<prefix>[<i>].<field>` (a point's as `<prefix>[<i>].points[<j>].<field>`).
 */
export function readWalls(v: unknown, unknown: string[], prefix: string, reach: number, height: number): RaceWall[] | string {
  const L = WALL_LIMITS;
  if (!Array.isArray(v) || v.length > L.walls) return `its walls are a list of at most ${L.walls}`;
  const out: RaceWall[] = [];
  for (let i = 0; i < v.length; i++) {
    const what = `wall ${i}`;
    const w = v[i];
    if (!w || typeof w !== 'object' || Array.isArray(w)) return `${what} is an object`;
    const o = w as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!WALL_FIELDS.has(k)) unknown.push(`${prefix}[${i}].${k}`);
    if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > L.name || CONTROL.test(o.name)) return `${what}'s name is words of ${L.name} characters at most`;
    const high = num(o.high);
    if (high === undefined || high < L.highLeast || high > L.highMost) return `${what}'s high is ${L.highLeast} to ${L.highMost} m`;
    const lean = num(o.lean);
    if (lean === undefined || Math.abs(lean) > L.leanMost) return `${what}'s lean is ${L.leanMost} degrees either way at most`;
    if (!Array.isArray(o.points) || o.points.length < L.pointsLeast || o.points.length > L.points) return `${what} has ${L.pointsLeast} to ${L.points} points`;
    const points: WallPoint[] = [];
    for (let j = 0; j < o.points.length; j++) {
      const pw = `${what}'s point ${j}`;
      const p = o.points[j];
      if (!p || typeof p !== 'object' || Array.isArray(p)) return `${pw} is an object`;
      const po = p as Record<string, unknown>;
      for (const k of Object.keys(po)) if (!POINT_FIELDS.has(k)) unknown.push(`${prefix}[${i}].points[${j}].${k}`);
      const x = num(po.x);
      const y = num(po.y);
      const z = num(po.z);
      if (x === undefined || y === undefined || z === undefined) return `${pw}'s place is not three numbers`;
      if (Math.abs(x) > reach || Math.abs(z) > reach) return `${pw} is more than ${reach} m out`;
      if (Math.abs(y) > height) return `${pw}'s height is more than ${height} m off`;
      const q: WallPoint = { x, y, z };
      if (po.r !== undefined) {
        const r = num(po.r);
        if (r === undefined || r === 0 || Math.abs(r) > L.radiusMost) return `${pw}'s r is a radius of ${L.radiusMost} m at most, either way (absent: straight)`;
        if (j === o.points.length - 1) return `${pw}'s r names no edge: the last point has none leaving it`;
        q.r = r;
      }
      points.push(q);
    }
    for (let j = 0; j + 1 < points.length; j++) {
      const a = points[j];
      const b = points[j + 1];
      const c = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
      if (c < L.edgeLeast || c > L.edgeMost) return `${what}'s edge ${j} is ${L.edgeLeast} to ${L.edgeMost} m long on the ground`;
      if (a.r !== undefined && Math.abs(a.r) < c / 2 - 1e-9) return `${what}'s edge ${j}: ${arcRefusal(c)}`;
    }
    out.push({ name: o.name, high, lean, points });
  }
  return out;
}

const POINT_ORDER: readonly (keyof WallPoint)[] = ['x', 'y', 'z', 'r'];

/** A track's walls as their block of the file: a wall's own numbers on its line, then one point a line. */
export function wallsText(walls: readonly RaceWall[]): string {
  const blocks = walls.map((w) => {
    const pts = (w.points ?? []).map((p) => `            { ${POINT_ORDER.filter((k) => p[k] !== undefined).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(p[k])}`).join(', ')} }`).join(',\n');
    return `        { "name": ${JSON.stringify(w.name)}, "high": ${JSON.stringify(w.high)}, "lean": ${JSON.stringify(w.lean)}, "points": [\n${pts}\n          ] }`;
  });
  return `[\n${blocks.join(',\n')}\n      ]`;
}

/** The right of a way across the ground in the game's frame (`-z`, `x`: the drive's own, -x at heading nought). */
export function wallRight(dx: number, dz: number, out: { x: number; z: number }): void {
  const l = Math.sqrt(dx * dx + dz * dz);
  out.x = l > 0 ? -dz / l : 1;
  out.z = l > 0 ? dx / l : 0;
}

/**
 * An edge's samples in the game's frame, the first point and every one after it to the second: straight, its two ends; an arc
 * of signed radius `r` (bulging to the edge's right for a positive one), cut every `step` metres of its length, its feet's
 * heights carried evenly between the ends'. Pushed onto `xs`, `ys`, `zs` (the first point left out where `skipFirst`).
 */
export function edgeSamples(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number | undefined, step: number, skipFirst: boolean, xs: number[], ys: number[], zs: number[]): void {
  const dx = bx - ax;
  const dz = bz - az;
  const c = Math.sqrt(dx * dx + dz * dz);
  const a = c / 2;
  if (r === undefined || !(c > 0) || Math.abs(r) < a) {
    if (!skipFirst) {
      xs.push(ax);
      ys.push(ay);
      zs.push(az);
    }
    xs.push(bx);
    ys.push(by);
    zs.push(bz);
    return;
  }
  const R = Math.abs(r);
  const s = r > 0 ? 1 : -1;
  const ux = dx / c;
  const uz = dz / c;
  // The right of the chord (`-uz`, `ux`), the arc's middle toward it for a positive radius, its centre the other way.
  const e1x = -uz * s;
  const e1z = ux * s;
  const off = Math.sqrt(Math.max(0, R * R - a * a));
  const cx = (ax + bx) / 2 - e1x * off;
  const cz = (az + bz) / 2 - e1z * off;
  const alpha = Math.asin(Math.min(1, a / R));
  const n = Math.max(1, Math.ceil((R * 2 * alpha) / Math.max(0.05, step)));
  for (let k = skipFirst ? 1 : 0; k <= n; k++) {
    const th = -alpha + (2 * alpha * k) / n;
    const co = Math.cos(th);
    const si = Math.sin(th);
    // The ends exactly where the points stand (no rounding drift between an arc and the edge after it).
    xs.push(k === 0 ? ax : k === n ? bx : cx + R * (co * e1x + si * ux));
    zs.push(k === 0 ? az : k === n ? bz : cz + R * (co * e1z + si * uz));
    ys.push(ay + ((by - ay) * k) / n);
  }
}

/** An edge's middle handle in the game's frame: an arc's middle, a straight edge's middle. */
export function edgeMiddle(ax: number, az: number, bx: number, bz: number, r: number | undefined, out: { x: number; z: number }): void {
  const dx = bx - ax;
  const dz = bz - az;
  const c = Math.sqrt(dx * dx + dz * dz);
  out.x = (ax + bx) / 2;
  out.z = (az + bz) / 2;
  if (r === undefined || !(c > 0) || Math.abs(r) < c / 2) return;
  const R = Math.abs(r);
  const s = r > 0 ? 1 : -1;
  const sag = R - Math.sqrt(Math.max(0, R * R - (c / 2) * (c / 2)));
  out.x += (-dz / c) * s * sag;
  out.z += (dx / c) * s * sag;
}

/**
 * The signed radius that bends an edge (game frame) so its middle passes through a point (`px`, `pz`): its offset from the
 * chord along the chord's right is the sagitta; under `straightBelow` metres of it the edge is straight (undefined). An arc
 * past a half circle is held to a half circle (the middle's offset at most half the chord).
 */
export function radiusThrough(ax: number, az: number, bx: number, bz: number, px: number, pz: number, straightBelow = 0.1): number | undefined {
  const dx = bx - ax;
  const dz = bz - az;
  const c = Math.sqrt(dx * dx + dz * dz);
  if (!(c > 0)) return undefined;
  const a = c / 2;
  let sag = (px - (ax + bx) / 2) * (-dz / c) + (pz - (az + bz) / 2) * (dx / c);
  if (Math.abs(sag) < straightBelow) return undefined;
  if (Math.abs(sag) > a) sag = Math.sign(sag) * a;
  return (a * a + sag * sag) / (2 * sag);
}

/** What `crossBox` is asked and answers, a kept record: nothing crosses a call as a number. */
export interface WallCross {
  /** The box's middle at the start and the end of the move (game frame), its lowest point at each, and its height. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  lowA: number;
  lowB: number;
  hh: number;
  /**
   * Its heading's sine and cosine at the start (`s`, `c`) and the end (`s2`, `c2`: the same for a move alone, another for
   * a turn, each point then judged along its chord), and its local box across (`x0`..`x1`) and along (`z0`..`z1`).
   */
  s: number;
  c: number;
  s2: number;
  c2: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** The answer: the share of the move at the first crossing, the face's horizontal normal into it, and the segment and wall. */
  t: number;
  gx: number;
  gz: number;
  seg: number;
  wall: number;
}

export function wallCross(): WallCross {
  return { ax: 0.5, az: 0.5, bx: 0.5, bz: 0.5, lowA: 0.5, lowB: 0.5, hh: 0.5, s: 0.5, c: 0.5, s2: 0.5, c2: 0.5, x0: 0.5, x1: 0.5, z0: 0.5, z1: 0.5, t: 0.5, gx: 0.5, gz: 0.5, seg: -1, wall: -1 };
}

/** What `clipAhead` is asked and answers: a ray from (`ox`, `oz`) along a unit way, to `most` metres, for a hull between `lo` and `hi`; `d` the first wall's distance (Infinity: none). */
export interface WallRay {
  ox: number;
  oz: number;
  dx: number;
  dz: number;
  most: number;
  lo: number;
  hi: number;
  d: number;
  wall: number;
}

export function wallRay(): WallRay {
  return { ox: 0.5, oz: 0.5, dx: 0.5, dz: 0.5, most: 0.5, lo: 0.5, hi: 0.5, d: 0.5, wall: -1 };
}

/** One wall's place in a set: its name and track, its segments (`first`, `count`) and its box on the ground (its lean's reach in). */
export interface WallEntry {
  name: string;
  track: string;
  index: number;
  first: number;
  count: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** How many of a wall's segments one run of the bucket index holds. */
export const WALL_CHUNK = 16;

/** The eight points of a box a crossing is asked for: its corners, the middles of its long sides, its nose's and its tail's. */
const BOX_X = new Float64Array([0, 1, 0, 1, 0, 1, 0.5, 0.5]);
const BOX_Z = new Float64Array([0, 0, 1, 1, 0.5, 0.5, 1, 0]);

/**
 * Walls sampled into segments in the game's frame, made once a change. Its questions make nothing: they read and write kept
 * records and typed arrays.
 */
export class RaceWallSet {
  readonly walls: WallEntry[];
  readonly n: number;
  readonly ax: Float64Array;
  readonly az: Float64Array;
  readonly bx: Float64Array;
  readonly bz: Float64Array;
  readonly ya: Float64Array;
  readonly yb: Float64Array;
  readonly high: Float64Array;
  readonly tl: Float64Array;
  readonly nx: Float64Array;
  readonly nz: Float64Array;
  readonly wallOf: Int32Array;
  /** The walls whose box stands within reach of the last `near` asked, by index into `walls`. */
  readonly nearList: Int32Array;
  nearN = 0;
  /** The two band edges a segment is asked at, kept: the wall's line at a height, its two ends. */
  private readonly line = new Float64Array(4);

  constructor(walls: WallEntry[], seg: { ax: number[]; az: number[]; bx: number[]; bz: number[]; ya: number[]; yb: number[]; high: number[]; tl: number[]; wall: number[] }) {
    this.walls = walls;
    const n = seg.ax.length;
    this.n = n;
    this.ax = Float64Array.from(seg.ax);
    this.az = Float64Array.from(seg.az);
    this.bx = Float64Array.from(seg.bx);
    this.bz = Float64Array.from(seg.bz);
    this.ya = Float64Array.from(seg.ya);
    this.yb = Float64Array.from(seg.yb);
    this.high = Float64Array.from(seg.high);
    this.tl = Float64Array.from(seg.tl);
    this.wallOf = Int32Array.from(seg.wall);
    this.nx = new Float64Array(n);
    this.nz = new Float64Array(n);
    const r = { x: 0, z: 0 };
    for (let i = 0; i < n; i++) {
      wallRight(this.bx[i] - this.ax[i], this.bz[i] - this.az[i], r);
      this.nx[i] = r.x;
      this.nz[i] = r.z;
    }
    this.nearList = new Int32Array(Math.max(1, walls.length));
    // The bucket index: each wall's segments in runs of `WALL_CHUNK` along it, each run's box on the ground (its lean's
    // reach in), so a question tests only the runs its own box meets (a wall round a 6 km circuit is thousands of segments).
    const cf: number[] = [];
    const cc: number[] = [];
    const bx0: number[] = [];
    const bx1: number[] = [];
    const bz0: number[] = [];
    const bz1: number[] = [];
    this.chunk0 = new Int32Array(Math.max(1, walls.length));
    this.chunkN = new Int32Array(Math.max(1, walls.length));
    for (let wi = 0; wi < walls.length; wi++) {
      const e = walls[wi];
      this.chunk0[wi] = cf.length;
      for (let i = e.first; i < e.first + e.count; i += WALL_CHUNK) {
        const end = Math.min(e.first + e.count, i + WALL_CHUNK);
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        for (let k = i; k < end; k++) {
          const reach = Math.abs(this.tl[k] * this.high[k]) + 1e-6;
          x0 = Math.min(x0, this.ax[k] - reach, this.bx[k] - reach);
          x1 = Math.max(x1, this.ax[k] + reach, this.bx[k] + reach);
          z0 = Math.min(z0, this.az[k] - reach, this.bz[k] - reach);
          z1 = Math.max(z1, this.az[k] + reach, this.bz[k] + reach);
        }
        cf.push(i);
        cc.push(end - i);
        bx0.push(x0);
        bx1.push(x1);
        bz0.push(z0);
        bz1.push(z1);
      }
      this.chunkN[wi] = cf.length - this.chunk0[wi];
    }
    this.cFirst = Int32Array.from(cf);
    this.cCount = Int32Array.from(cc);
    this.cMinX = Float64Array.from(bx0);
    this.cMaxX = Float64Array.from(bx1);
    this.cMinZ = Float64Array.from(bz0);
    this.cMaxZ = Float64Array.from(bz1);
    this.cand = new Int32Array(Math.max(1, cf.length));
  }

  /** The bucket index (made with the set): each wall's runs (`chunk0`, `chunkN` by its place in `walls`), each run's segments and box. */
  readonly chunk0: Int32Array;
  readonly chunkN: Int32Array;
  readonly cFirst: Int32Array;
  readonly cCount: Int32Array;
  readonly cMinX: Float64Array;
  readonly cMaxX: Float64Array;
  readonly cMinZ: Float64Array;
  readonly cMaxZ: Float64Array;
  /** The runs a `crossBox` gathers before it tests its points, kept; how many segments the last question tested (for the tests). */
  private readonly cand: Int32Array;
  tested = 0;

  /** Where `near` gathers round and how far (written before it is asked: nothing crosses the call as a number). */
  nearX = 0.5;
  nearZ = 0.5;
  nearR = 0.5;
  /** The height `lineAt` reads the wall's line at. */
  private lineY = 0.5;

  /** The walls whose box stands within `nearR` of (`nearX`, `nearZ`) into `nearList` (a plan's work, once). */
  near(): void {
    const x = this.nearX;
    const z = this.nearZ;
    const r = this.nearR;
    let k = 0;
    const ws = this.walls;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (x < w.minX - r || x > w.maxX + r || z < w.minZ - r || z > w.maxZ + r) continue;
      this.nearList[k++] = i;
    }
    this.nearN = k;
  }

  /**
   * The wall's line at a height `y` over segment `i` into `line` (its two ends): the foot line moved along the segment's right
   * by the lean's reach at that height, held to the wall's own height at each end.
   */
  private lineAt(i: number): void {
    const y = this.lineY;
    const h = this.high[i];
    const tl = this.tl[i];
    const ha = y - this.ya[i];
    const hb = y - this.yb[i];
    const oa = (ha < 0 ? 0 : ha > h ? h : ha) * tl;
    const ob = (hb < 0 ? 0 : hb > h ? h : hb) * tl;
    const L = this.line;
    L[0] = this.ax[i] + this.nx[i] * oa;
    L[1] = this.az[i] + this.nz[i] * oa;
    L[2] = this.bx[i] + this.nx[i] * ob;
    L[3] = this.bz[i] + this.nz[i] * ob;
  }

  /**
   * Whether the box `q` asks of, moved from its start to its end (its eight points each along the move, at its heights), crosses
   * a wall of `nearList` between the wall's foot and top along its lean, either way; the first crossing's share of the move and
   * the face's horizontal normal into it written into `q`. A wall's face at a height is crossed where a point's path meets the
   * wall's line at that height; the hull's height range meets the wall's band of lines at one of the band's two edges first
   * (its lowest point's height and its top's, each held to the wall's), and is met only where, at the crossing, the hull's
   * range and the wall's (its foot to its top there) overlap. A point starting on the line goes through.
   */
  crossBox(q: WallCross): boolean {
    q.t = Infinity;
    q.seg = -1;
    q.wall = -1;
    const L = this.line;
    // The runs of the near walls whose box the box's whole move can reach (its middle's two places, its half diagonal round them).
    const R = Math.sqrt((q.x0 * q.x0 > q.x1 * q.x1 ? q.x0 * q.x0 : q.x1 * q.x1) + (q.z0 * q.z0 > q.z1 * q.z1 ? q.z0 * q.z0 : q.z1 * q.z1));
    const rx0 = (q.ax < q.bx ? q.ax : q.bx) - R;
    const rx1 = (q.ax < q.bx ? q.bx : q.ax) + R;
    const rz0 = (q.az < q.bz ? q.az : q.bz) - R;
    const rz1 = (q.az < q.bz ? q.bz : q.az) + R;
    let nc = 0;
    for (let w = 0; w < this.nearN; w++) {
      const wi = this.nearList[w];
      for (let k = this.chunk0[wi]; k < this.chunk0[wi] + this.chunkN[wi]; k++) {
        if (rx1 < this.cMinX[k] || rx0 > this.cMaxX[k] || rz1 < this.cMinZ[k] || rz0 > this.cMaxZ[k]) continue;
        this.cand[nc++] = k;
      }
    }
    let tested = 0;
    for (let p = 0; p < 8; p++) {
      const lx = q.x0 + (q.x1 - q.x0) * BOX_X[p];
      const lz = q.z0 + (q.z1 - q.z0) * BOX_Z[p];
      // The drive's own turn of a local point (`footprintAt`), at the start; its move to its place at the end (the turn's
      // chord added: nought for a move alone, so its move is the middle's to the bit).
      const px = q.ax + lx * q.c + lz * q.s;
      const pz = q.az - lx * q.s + lz * q.c;
      const mx = q.bx - q.ax + (lx * (q.c2 - q.c) + lz * (q.s2 - q.s));
      const mz = q.bz - q.az + (lz * (q.c2 - q.c) - lx * (q.s2 - q.s));
      for (let ci = 0; ci < nc; ci++) {
        const k = this.cand[ci];
        const first = this.cFirst[k];
        const end = first + this.cCount[k];
        const w = this.wallOf[first];
        for (let i = first; i < end; i++) {
          tested++;
          for (let band = 0; band < 2; band++) {
            if (band === 1 && this.tl[i] === 0) break;
            this.lineY = band === 0 ? q.lowA : q.lowA + q.hh;
            this.lineAt(i);
            // The point's path (p + m t) against the line (a + (b - a) u).
            const ex = L[2] - L[0];
            const ez = L[3] - L[1];
            const den = mx * ez - mz * ex;
            if (den === 0) continue;
            const wx = L[0] - px;
            const wz = L[1] - pz;
            const t = (wx * ez - wz * ex) / den;
            if (!(t > 1e-9) || t > 1 || t >= q.t) continue;
            const u = (wx * mz - wz * mx) / den;
            if (u < -1e-9 || u > 1 + 1e-9) continue;
            // The heights meet there: the hull's range and the wall's, its feet carried along the segment.
            const foot = this.ya[i] + (this.yb[i] - this.ya[i]) * (u < 0 ? 0 : u > 1 ? 1 : u);
            const lo = q.lowA + (q.lowB - q.lowA) * t;
            if (lo > foot + this.high[i] || lo + q.hh < foot) continue;
            q.t = t;
            q.seg = i;
            q.wall = this.walls[w].index;
            // Into the wall: against the side the point came from.
            const side = (px - L[0]) * this.nx[i] + (pz - L[1]) * this.nz[i];
            const sg = side > 0 ? -1 : side < 0 ? 1 : mx * this.nx[i] + mz * this.nz[i] >= 0 ? 1 : -1;
            q.gx = this.nx[i] * sg;
            q.gz = this.nz[i] * sg;
          }
        }
      }
    }
    this.tested = tested;
    return q.seg >= 0;
  }

  /**
   * How far along the ray `q` asks of the first wall a hull between `q.lo` and `q.hi` meets stands (the look-ahead's clip),
   * into `q.d` (Infinity for none): every wall whose box the ray's reaches, at the band's two edges as `crossBox` asks.
   */
  clipAhead(q: WallRay): void {
    q.d = Infinity;
    q.wall = -1;
    const mx = q.dx * q.most;
    const mz = q.dz * q.most;
    const x0 = q.ox < q.ox + mx ? q.ox : q.ox + mx;
    const x1 = q.ox < q.ox + mx ? q.ox + mx : q.ox;
    const z0 = q.oz < q.oz + mz ? q.oz : q.oz + mz;
    const z1 = q.oz < q.oz + mz ? q.oz + mz : q.oz;
    const L = this.line;
    for (let w = 0; w < this.walls.length; w++) {
      const e = this.walls[w];
      if (x1 < e.minX || x0 > e.maxX || z1 < e.minZ || z0 > e.maxZ) continue;
      for (let k = this.chunk0[w]; k < this.chunk0[w] + this.chunkN[w]; k++) {
        if (x1 < this.cMinX[k] || x0 > this.cMaxX[k] || z1 < this.cMinZ[k] || z0 > this.cMaxZ[k]) continue;
        for (let i = this.cFirst[k]; i < this.cFirst[k] + this.cCount[k]; i++) {
          for (let band = 0; band < 2; band++) {
            if (band === 1 && this.tl[i] === 0) break;
            this.lineY = band === 0 ? q.lo : q.hi;
            this.lineAt(i);
            const ex = L[2] - L[0];
            const ez = L[3] - L[1];
            const den = mx * ez - mz * ex;
            if (den === 0) continue;
            const wx = L[0] - q.ox;
            const wz = L[1] - q.oz;
            const t = (wx * ez - wz * ex) / den;
            if (!(t > 1e-9) || t > 1) continue;
            const d = t * q.most;
            if (d >= q.d) continue;
            const u = (wx * mz - wz * mx) / den;
            if (u < -1e-9 || u > 1 + 1e-9) continue;
            const foot = this.ya[i] + (this.yb[i] - this.ya[i]) * (u < 0 ? 0 : u > 1 ? 1 : u);
            if (q.lo > foot + this.high[i] || q.hi < foot) continue;
            q.d = d;
            q.wall = e.index;
          }
        }
      }
    }
  }
}

/**
 * A set made from tracks' walls: each wall's points carried into the game's frame (`place`, which writes into its `out`),
 * its edges sampled (`edgeSamples`, every `arcStep` of an arc), its segments' feet, height, lean and right normal. Null where
 * there are no walls at all.
 */
export function buildWallSet(list: readonly { track: string; walls: readonly RaceWall[] | undefined }[], place: (x: number, z: number, out: { x: number; z: number }) => void, arcStep: number): RaceWallSet | null {
  const entries: WallEntry[] = [];
  const seg = { ax: [] as number[], az: [] as number[], bx: [] as number[], bz: [] as number[], ya: [] as number[], yb: [] as number[], high: [] as number[], tl: [] as number[], wall: [] as number[] };
  const g = { x: 0, z: 0 };
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  let index = 0;
  for (const k of list) {
    for (const w of k.walls ?? []) {
      xs.length = 0;
      ys.length = 0;
      zs.length = 0;
      for (let j = 0; j + 1 < w.points.length; j++) {
        const a = w.points[j];
        const b = w.points[j + 1];
        place(a.x, a.z, g);
        const ax = g.x;
        const az = g.z;
        place(b.x, b.z, g);
        edgeSamples(ax, a.y, az, g.x, b.y, g.z, a.r, arcStep, j > 0, xs, ys, zs);
      }
      const tl = Math.tan((w.lean * Math.PI) / 180);
      const reach = Math.abs(tl * w.high);
      const first = seg.ax.length;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i + 1 < xs.length; i++) {
        seg.ax.push(xs[i]);
        seg.az.push(zs[i]);
        seg.bx.push(xs[i + 1]);
        seg.bz.push(zs[i + 1]);
        seg.ya.push(ys[i]);
        seg.yb.push(ys[i + 1]);
        seg.high.push(w.high);
        seg.tl.push(tl);
        seg.wall.push(entries.length);
      }
      for (let i = 0; i < xs.length; i++) {
        minX = Math.min(minX, xs[i] - reach);
        maxX = Math.max(maxX, xs[i] + reach);
        minZ = Math.min(minZ, zs[i] - reach);
        maxZ = Math.max(maxZ, zs[i] + reach);
      }
      entries.push({ name: w.name, track: k.track, index, first, count: seg.ax.length - first, minX, maxX, minZ, maxZ });
      index++;
    }
  }
  return entries.length ? new RaceWallSet(entries, seg) : null;
}
