// One room's walkable floor, and the pure rules a body crosses it with: where on the mesh a body
// is standing, which triangles a path from there to a point goes through, where the corners of
// that path are, and whether a body wider than the one the mesh was walked for fits round each.
//
// The mesh is the client's own: every cell of every portal building names a floor, and the
// converter writes it onto the cell in the same frame as everything else the pack carries for that
// model -- the building's model space, X already mirrored, exactly like `portals[].v`. Nothing in
// here knows about the world, a building's place in it, or three: it is numbers in and numbers out,
// so the node test can hand it a floor it drew by hand and check every corner it gets back.
//
// Nothing is allocated once a floor is built. The search's working room is made with the floor and
// written over on every path, the corridor and the corners are written into arrays the caller owns,
// and a visit stamp with a generation counter means no array is ever cleared between searches.
//
// Three numbers in here are the client's and the rest are ours: the mesh, its triangles and its
// adjacency are the game's, and every number in NAV_TUNE is invented (see the comments on each).

/** What the converter writes for a cell's floor. Several spellings are taken: see `buildFloor`. */
export interface FloorSource {
  /** Vertices, x, y, z per vertex, flat or as triples. */
  v?: unknown;
  /**
   * Triangle records. The converter writes **ten numbers a triangle**: three corner indices into
   * `v`, three neighbours (-1 at the mesh's edge), three portal link indices (-1 for none) and a
   * three-bit mask of which edges may be crossed. A mesh written by hand may instead carry three --
   * the corners alone -- and which of the two it is, is read off the numbers themselves
   * (`strideOf`), never guessed from the length, because 30 numbers are both 3 records of 10 and 10
   * of 3.
   */
  t?: unknown;
  /** How many numbers a triangle record holds, for a writer that would rather say than be read. */
  stride?: unknown;
  /** Triangle-to-triangle adjacency, three per triangle, -1 where an edge has no neighbour. */
  adj?: unknown;
  verts?: unknown;
  tris?: unknown;
  i?: unknown;
}

/** The search's working room: made with the floor, written over on every path, never cleared. */
export interface FloorWork {
  g: Float64Array;
  f: Float64Array;
  from: Int32Array;
  /** The generation each triangle was last opened in; `gen` moves on for every search. */
  stamp: Int32Array;
  /** 0 not seen, 1 open, 2 closed, for the generation in `stamp`. */
  how: Uint8Array;
  heap: Int32Array;
  heapLen: number;
  gen: number;
  /** The triangles a path crosses, start first. */
  corridor: Int32Array;
  corridorLen: number;
  /** The funnel's left and right points per portal: x, z, x, z. */
  portals: Float64Array;
  /** Triangles opened by the last search, for the console. */
  opened: number;
}

export interface NavFloor {
  /** x, y, z per vertex, in the building's model frame. */
  verts: Float64Array;
  /** Three vertex indices per triangle. */
  tris: Int32Array;
  /**
   * Three neighbours per triangle: `adj[t * 3 + e]` is the triangle across the edge from corner
   * `e` to corner `(e + 1) % 3`, or -1 for a wall.
   */
  adj: Int32Array;
  /** x, y, z of each triangle's middle. */
  centres: Float64Array;
  /** Each triangle's own flat box, minX, minZ, maxX, maxZ: the scan's first and cheapest question. */
  boxes: Float64Array;
  count: number;
  min: Float64Array;
  max: Float64Array;
  /** Edges that found no neighbour: a wall, or a seam the mesh does not close. */
  openEdges: number;
  /** Whether the converter's own adjacency was taken, or one rebuilt here from the shared edges. */
  adjFromFile: boolean;
  work: FloorWork;
}

/**
 * Every number here is INVENTED. None of them is in the archives: the client's floor carries the
 * mesh and the graph and says nothing about how often a body should ask for a path, how near a
 * corner counts as reached or how far past a doorway to aim. They are live through `__debug.nav`.
 */
export interface NavTune {
  /**
   * How near a corner counts as reached, metres, measured flat. It is not tied to the brains' own
   * arrival distance: `moveTo` is deliberately never overridden, so a body's arrival is still
   * measured against the real goal and a corner is only ever a thing to face. Too small and a body
   * fidgets at a doorjamb; too large and it cuts the corner and clips the wall.
   */
  reach: number;
  /** A goal that has moved at least this far asks for a fresh path, metres. */
  goalMoved: number;
  /** At most one fresh path this often for one body, seconds on the simulated clock. */
  every: number;
  /** After a search that found nothing, this long before another is tried, seconds. */
  retry: number;
  /** At most this many triangles opened in one search. */
  expand: number;
  /** At most this many searches in one step of the simulation, over every body there is. */
  perStep: number;
  /** At most this many corners kept from one path. */
  corners: number;
  /** How far above and below its feet a body looks for the floor it is standing on, metres. */
  yTol: number;
  /** How far off the mesh a body may stand and still be put on the nearest triangle, metres. */
  snap: number;
  /** The width the mesh is walked at: the player's own capsule radius (player.ts). */
  agent: number;
  /** Points tested round a corner when a body wider than `agent` asks whether it fits. */
  samples: number;
  /** How far past a doorway's middle a path through it aims, metres, so crossing it really changes the room. */
  through: number;
}

export const NAV_TUNE: NavTune = {
  reach: 0.45,
  goalMoved: 2,
  every: 0.5,
  retry: 2,
  expand: 4000,
  perStep: 4,
  corners: 32,
  yTol: 2.5,
  snap: 1.5,
  agent: 0.35,
  samples: 8,
  through: 0.6,
};

const EPS = 1e-5;
/** Where one corner's inset lands while it is being checked: written, never made. */
const INSET_SPOT = { x: 0, z: 0 };
/** A triangle record of corners alone, which is what a mesh drawn by hand in a test carries. */
const CORNERS_ONLY = 3;
/** The converter's own record: three corners, three neighbours, three portal ids and a mask. */
const FILE_RECORD = 10;

/**
 * Numbers out of whatever the converter wrote: a flat array, a typed array, or an array of rows.
 * Rows keep their own width when it is wider than `stride`, so a triangle record written as rows of
 * ten is not silently cut down to its first three numbers.
 */
function flatten(src: unknown, stride: number): Float64Array | null {
  if (src === null || src === undefined) return null;
  if (Array.isArray(src) && src.length > 0 && Array.isArray(src[0])) {
    const rows = src as number[][];
    const wide = Math.max(stride, rows[0].length | 0);
    const out = new Float64Array(rows.length * wide);
    for (let i = 0; i < rows.length; i++) for (let k = 0; k < wide; k++) out[i * wide + k] = rows[i][k] ?? 0;
    return out;
  }
  const arr = src as ArrayLike<number>;
  if (typeof arr.length !== 'number') return null;
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i];
  return out;
}

/**
 * Whether the triangle numbers read as records of `stride` numbers apiece. Every corner must name a
 * vertex the mesh has; a ten-wide record must also have every neighbour either -1 or a triangle of
 * this same mesh, every portal id at least -1, and a crossable mask of three bits. Those fields are
 * what tells a ten-wide record from three-wide ones when the length alone cannot (30 numbers are
 * both), so the file's own shape is read rather than guessed at.
 */
function strideOf(tf: Float64Array, stride: number, vCount: number): boolean {
  if (tf.length === 0 || tf.length % stride !== 0) return false;
  const count = tf.length / stride;
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    for (let c = 0; c < 3; c++) {
      const k = tf[o + c];
      if (!Number.isInteger(k) || k < 0 || k >= vCount) return false;
    }
    if (stride < FILE_RECORD) continue;
    for (let e = 0; e < 3; e++) {
      const n = tf[o + 3 + e];
      const p = tf[o + 6 + e];
      if (!Number.isInteger(n) || n < -1 || n >= count) return false;
      if (!Number.isInteger(p) || p < -1) return false;
    }
    const mask = tf[o + 9];
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) return false;
  }
  return true;
}

/**
 * A floor from whatever the converter wrote for the cell, or null when there is nothing usable.
 *
 * The vertices are taken as `v` or `verts`, the triangles as `t`, `tris` or `i`, and the adjacency
 * as `adj`; a flat array, a typed array and an array of triples all read the same. A triangle
 * record is the converter's ten numbers or a bare three, told apart by `strideOf` or stated by the
 * writer as `stride`.
 *
 * The adjacency -- the converter's own `adj`, or the three neighbour fields inside a ten-wide
 * record -- is used only when it is the right length and every link it names points back at the
 * triangle that named it across the same two corners, because a one-sided link walks a path through
 * a wall; otherwise it is rebuilt from the shared edges, which is the same answer for a mesh that
 * closes.
 *
 * The record's other two fields are read and deliberately not used. The portal ids say which of the
 * cell's own doorways lies behind an open edge, which nothing here asks (the room graph answers it
 * from the polygons, and does so in a pack that has no floors at all); the crossable mask is set on
 * every edge that has a neighbour, so gating the adjacency on it could only ever cut a floor into
 * islands if that ever stopped being true, and a floor in islands is a body with no path.
 */
export function buildFloor(src: FloorSource | null | undefined): NavFloor | null {
  if (!src) return null;
  const vf = flatten(src.v ?? src.verts, 3);
  const tf = flatten(src.t ?? src.tris ?? src.i, 3);
  if (!vf || !tf || vf.length < 9 || tf.length < 3) return null;
  const vCount = Math.floor(vf.length / 3);
  const verts = vf.length === vCount * 3 ? vf : vf.slice(0, vCount * 3);
  const said = Math.round(Number(src.stride));
  let stride = said === CORNERS_ONLY || said === FILE_RECORD ? said : 0;
  // The converter's own record first: a mesh of bare corners cannot pass its neighbour, portal and
  // mask fields, so trying the wider one first settles the lengths that are both.
  if (!stride && strideOf(tf, FILE_RECORD, vCount)) stride = FILE_RECORD;
  if (!stride && strideOf(tf, CORNERS_ONLY, vCount)) stride = CORNERS_ONLY;
  if (!stride) return null;
  const count = Math.floor(tf.length / stride);
  if (count < 1) return null;
  const tris = new Int32Array(count * 3);
  for (let t = 0; t < count; t++) {
    for (let c = 0; c < 3; c++) {
      const k = Math.round(tf[t * stride + c]);
      if (!(k >= 0 && k < vCount)) return null;
      tris[t * 3 + c] = k;
    }
  }
  const centres = new Float64Array(count * 3);
  const boxes = new Float64Array(count * 4);
  const min = new Float64Array([Infinity, Infinity, Infinity]);
  const max = new Float64Array([-Infinity, -Infinity, -Infinity]);
  for (let t = 0; t < count; t++) {
    for (let axis = 0; axis < 3; axis++) {
      let s = 0;
      for (let c = 0; c < 3; c++) {
        const val = verts[tris[t * 3 + c] * 3 + axis];
        s += val;
        if (val < min[axis]) min[axis] = val;
        if (val > max[axis]) max[axis] = val;
      }
      centres[t * 3 + axis] = s / 3;
    }
    let bx0 = Infinity;
    let bz0 = Infinity;
    let bx1 = -Infinity;
    let bz1 = -Infinity;
    for (let c = 0; c < 3; c++) {
      const vx = verts[tris[t * 3 + c] * 3];
      const vz = verts[tris[t * 3 + c] * 3 + 2];
      if (vx < bx0) bx0 = vx;
      if (vz < bz0) bz0 = vz;
      if (vx > bx1) bx1 = vx;
      if (vz > bz1) bz1 = vz;
    }
    boxes[t * 4] = bx0;
    boxes[t * 4 + 1] = bz0;
    boxes[t * 4 + 2] = bx1;
    boxes[t * 4 + 3] = bz1;
  }
  let adj = takeAdjacency(src.adj, count, tris);
  if (!adj && stride === FILE_RECORD) {
    const neighbours = new Float64Array(count * 3);
    for (let t = 0; t < count; t++) for (let e = 0; e < 3; e++) neighbours[t * 3 + e] = tf[t * stride + 3 + e];
    adj = takeAdjacency(neighbours, count, tris);
  }
  const adjFromFile = adj !== null;
  if (!adj) adj = rebuildAdjacency(count, tris);
  let openEdges = 0;
  for (let i = 0; i < adj.length; i++) if (adj[i] < 0) openEdges++;
  const work: FloorWork = {
    g: new Float64Array(count),
    f: new Float64Array(count),
    from: new Int32Array(count),
    stamp: new Int32Array(count),
    how: new Uint8Array(count),
    // The open list is pushed lazily, so a triangle can be pushed once for every edge that reaches
    // it: three, plus the one the search starts with. A typed array swallows a write past its end
    // in silence, and a search that lost a node would walk a path through a wall, so the room is
    // sized for the real bound and `heapPush` refuses anything past it rather than dropping it.
    heap: new Int32Array(count * 3 + 2),
    heapLen: 0,
    gen: 0,
    corridor: new Int32Array(count),
    corridorLen: 0,
    portals: new Float64Array((NAV_TUNE.corners + count + 2) * 4),
    opened: 0,
  };
  return { verts, tris, adj, centres, boxes, count, min, max, openEdges, adjFromFile, work };
}

/** The converter's own adjacency, when it is the right shape and every link is mutual; else null. */
function takeAdjacency(src: unknown, count: number, tris: Int32Array): Int32Array | null {
  const af = flatten(src, 3);
  if (!af || af.length !== count * 3) return null;
  const adj = new Int32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    const n = Math.round(af[i]);
    adj[i] = n >= 0 && n < count ? n : -1;
  }
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const n = adj[t * 3 + e];
      if (n < 0) continue;
      let back = false;
      for (let k = 0; k < 3; k++) if (adj[n * 3 + k] === t) back = true;
      if (!back) return null;
      // The link must name the same two corners on both sides, or it is not an edge at all.
      const a = tris[t * 3 + e];
      const b = tris[t * 3 + ((e + 1) % 3)];
      let shared = 0;
      for (let k = 0; k < 3; k++) {
        const c = tris[n * 3 + k];
        if (c === a || c === b) shared++;
      }
      if (shared < 2) return null;
    }
  }
  return adj;
}

/** Adjacency from the shared edges: an edge is a pair of vertex indices, and two triangles share it. */
function rebuildAdjacency(count: number, tris: Int32Array): Int32Array {
  const adj = new Int32Array(count * 3).fill(-1);
  const seen = new Map<number, number>();
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t * 3 + e];
      const b = tris[t * 3 + ((e + 1) % 3)];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = lo * 1048576 + hi;
      const other = seen.get(key);
      if (other === undefined) {
        seen.set(key, t * 3 + e);
      } else {
        adj[t * 3 + e] = Math.floor(other / 3);
        adj[other] = t;
        seen.delete(key);
      }
    }
  }
  return adj;
}

function inTriangle(floor: NavFloor, t: number, x: number, z: number): boolean {
  const v = floor.verts;
  const a = floor.tris[t * 3] * 3;
  const b = floor.tris[t * 3 + 1] * 3;
  const c = floor.tris[t * 3 + 2] * 3;
  const d1 = (x - v[a]) * (v[b + 2] - v[a + 2]) - (z - v[a + 2]) * (v[b] - v[a]);
  const d2 = (x - v[b]) * (v[c + 2] - v[b + 2]) - (z - v[b + 2]) * (v[c] - v[b]);
  const d3 = (x - v[c]) * (v[a + 2] - v[c + 2]) - (z - v[c + 2]) * (v[a] - v[c]);
  const neg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const pos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(neg && pos);
}

/** The floor's own height inside a triangle, by the plane the triangle lies in. */
export function heightIn(floor: NavFloor, t: number, x: number, z: number): number {
  const v = floor.verts;
  const a = floor.tris[t * 3] * 3;
  const b = floor.tris[t * 3 + 1] * 3;
  const c = floor.tris[t * 3 + 2] * 3;
  const x1 = v[b] - v[a];
  const z1 = v[b + 2] - v[a + 2];
  const x2 = v[c] - v[a];
  const z2 = v[c + 2] - v[a + 2];
  const det = x1 * z2 - x2 * z1;
  if (Math.abs(det) < 1e-9) return v[a + 1];
  const px = x - v[a];
  const pz = z - v[a + 2];
  const u = (px * z2 - pz * x2) / det;
  const w = (pz * x1 - px * z1) / det;
  return v[a + 1] + u * (v[b + 1] - v[a + 1]) + w * (v[c + 1] - v[a + 1]);
}

/**
 * The triangle a point stands on: the one it is inside whose own surface is nearest its height,
 * or, when it is inside none (it is standing on a step, or a hand's breadth off the mesh's edge),
 * the nearest triangle within `snap` metres flat and `yTol` up or down. -1 when there is none.
 */
export function locate(floor: NavFloor, x: number, y: number, z: number, yTol: number = NAV_TUNE.yTol, snap: number = NAV_TUNE.snap): number {
  if (x < floor.min[0] - snap || x > floor.max[0] + snap || z < floor.min[2] - snap || z > floor.max[2] + snap) return -1;
  let best = -1;
  let bestDy = Infinity;
  const boxes = floor.boxes;
  for (let t = 0; t < floor.count; t++) {
    // Its own flat box first: four comparisons throw out all but a handful of a room's triangles.
    if (x < boxes[t * 4] || x > boxes[t * 4 + 2] || z < boxes[t * 4 + 1] || z > boxes[t * 4 + 3]) continue;
    if (!inTriangle(floor, t, x, z)) continue;
    const dy = Math.abs(heightIn(floor, t, x, z) - y);
    if (dy > yTol || dy >= bestDy) continue;
    bestDy = dy;
    best = t;
  }
  if (best >= 0) return best;
  let bestD = snap * snap;
  for (let t = 0; t < floor.count; t++) {
    const dx = floor.centres[t * 3] - x;
    const dy = floor.centres[t * 3 + 1] - y;
    const dz = floor.centres[t * 3 + 2] - z;
    if (Math.abs(dy) > yTol) continue;
    const d = dx * dx + dz * dz;
    if (d >= bestD) continue;
    bestD = d;
    best = t;
  }
  return best;
}

// --- the search -------------------------------------------------------------------------------

/** Pushes one triangle, or answers false when the open list is full: see the heap's own comment. */
function heapPush(w: FloorWork, t: number): boolean {
  if (w.heapLen + 1 >= w.heap.length) return false;
  let i = ++w.heapLen;
  w.heap[i] = t;
  while (i > 1) {
    const p = i >> 1;
    if (w.f[w.heap[p]] <= w.f[w.heap[i]]) break;
    const tmp = w.heap[p];
    w.heap[p] = w.heap[i];
    w.heap[i] = tmp;
    i = p;
  }
  return true;
}

function heapPop(w: FloorWork): number {
  const top = w.heap[1];
  w.heap[1] = w.heap[w.heapLen--];
  let i = 1;
  for (;;) {
    const l = i << 1;
    const r = l + 1;
    let s = i;
    if (l <= w.heapLen && w.f[w.heap[l]] < w.f[w.heap[s]]) s = l;
    if (r <= w.heapLen && w.f[w.heap[r]] < w.f[w.heap[s]]) s = r;
    if (s === i) break;
    const tmp = w.heap[s];
    w.heap[s] = w.heap[i];
    w.heap[i] = tmp;
    i = s;
  }
  return top;
}

function span(floor: NavFloor, a: number, b: number): number {
  const c = floor.centres;
  const dx = c[a * 3] - c[b * 3];
  const dy = c[a * 3 + 1] - c[b * 3 + 1];
  const dz = c[a * 3 + 2] - c[b * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * The triangles a walk from `startTri` to `goalTri` crosses, written into the floor's own
 * `work.corridor`, start first. Returns how many, or 0 when there is no way through or the search
 * opened more triangles than `expand` allows (a room nobody should be pathing across is a room the
 * old straight line can have back rather than a frame spent on it).
 */
export function findCorridor(floor: NavFloor, startTri: number, goalTri: number, expand: number = NAV_TUNE.expand): number {
  const w = floor.work;
  w.opened = 0;
  w.corridorLen = 0;
  if (startTri < 0 || goalTri < 0 || startTri >= floor.count || goalTri >= floor.count) return 0;
  if (startTri === goalTri) {
    w.corridor[0] = startTri;
    w.corridorLen = 1;
    return 1;
  }
  const gen = ++w.gen;
  w.heapLen = 0;
  w.stamp[startTri] = gen;
  w.how[startTri] = 1;
  w.g[startTri] = 0;
  w.f[startTri] = span(floor, startTri, goalTri);
  w.from[startTri] = -1;
  if (!heapPush(w, startTri)) return 0;
  let found = false;
  while (w.heapLen > 0) {
    const t = heapPop(w);
    if (w.stamp[t] !== gen || w.how[t] === 2) continue;
    w.how[t] = 2;
    if (++w.opened > expand) return 0;
    if (t === goalTri) {
      found = true;
      break;
    }
    for (let e = 0; e < 3; e++) {
      const n = floor.adj[t * 3 + e];
      if (n < 0) continue;
      const g = w.g[t] + span(floor, t, n);
      if (w.stamp[n] === gen && w.how[n] !== 0 && g >= w.g[n]) continue;
      w.stamp[n] = gen;
      w.how[n] = 1;
      w.g[n] = g;
      w.f[n] = g + span(floor, n, goalTri);
      w.from[n] = t;
      // Full: the search cannot be finished honestly, so it says so and the straight line stands.
      if (!heapPush(w, n)) return 0;
    }
  }
  if (!found) return 0;
  let n = 0;
  for (let t = goalTri; t >= 0; t = w.from[t]) {
    n++;
    if (n > floor.count) return 0;
  }
  w.corridorLen = n;
  let i = n - 1;
  for (let t = goalTri; t >= 0; t = w.from[t]) w.corridor[i--] = t;
  return n;
}

// --- the funnel -------------------------------------------------------------------------------

function area2(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
}

/**
 * The corners of the straightest walk down a corridor: the simple funnel, ours, over the shared
 * edges of the corridor's triangles. Each edge's two ends are sorted into a left and a right by
 * the way the corridor is travelled -- looking along the step, left is `(dz, -dx)` -- so nothing
 * here depends on which way the client wound its triangles.
 *
 * Writes x, z pairs into `out` and returns how many; the last is always the end point itself.
 */
export function funnel(floor: NavFloor, sx: number, sz: number, ex: number, ez: number, out: Float64Array, maxCorners: number = NAV_TUNE.corners): number {
  const w = floor.work;
  const n = w.corridorLen;
  if (n <= 0) return 0;
  const p = w.portals;
  let np = 0;
  p[0] = sx;
  p[1] = sz;
  p[2] = sx;
  p[3] = sz;
  np = 1;
  for (let k = 0; k + 1 < n; k++) {
    const t = w.corridor[k];
    const next = w.corridor[k + 1];
    let e = -1;
    for (let j = 0; j < 3; j++) if (floor.adj[t * 3 + j] === next) e = j;
    if (e < 0) break;
    const ia = floor.tris[t * 3 + e] * 3;
    const ib = floor.tris[t * 3 + ((e + 1) % 3)] * 3;
    const ax = floor.verts[ia];
    const az = floor.verts[ia + 2];
    const bx = floor.verts[ib];
    const bz = floor.verts[ib + 2];
    const dx = floor.centres[next * 3] - floor.centres[t * 3];
    const dz = floor.centres[next * 3 + 2] - floor.centres[t * 3 + 2];
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    // Left of the way travelled is (dz, -dx): the end on that side is the funnel's left.
    const aLeft = (ax - mx) * dz + (az - mz) * -dx >= 0;
    const o = np * 4;
    if (o + 4 > p.length) break;
    p[o] = aLeft ? ax : bx;
    p[o + 1] = aLeft ? az : bz;
    p[o + 2] = aLeft ? bx : ax;
    p[o + 3] = aLeft ? bz : az;
    np++;
  }
  const last = np * 4;
  if (last + 4 <= p.length) {
    p[last] = ex;
    p[last + 1] = ez;
    p[last + 2] = ex;
    p[last + 3] = ez;
    np++;
  }
  let count = 0;
  let apexX = p[0];
  let apexZ = p[1];
  let leftX = p[0];
  let leftZ = p[1];
  let rightX = p[2];
  let rightZ = p[3];
  let apexI = 0;
  let leftI = 0;
  let rightI = 0;
  for (let i = 1; i < np; i++) {
    const lx = p[i * 4];
    const lz = p[i * 4 + 1];
    const rx = p[i * 4 + 2];
    const rz = p[i * 4 + 3];
    if (area2(apexX, apexZ, rightX, rightZ, rx, rz) <= 0) {
      if ((apexX === rightX && apexZ === rightZ) || area2(apexX, apexZ, leftX, leftZ, rx, rz) > 0) {
        rightX = rx;
        rightZ = rz;
        rightI = i;
      } else {
        if (count < maxCorners) {
          out[count * 2] = leftX;
          out[count * 2 + 1] = leftZ;
          count++;
        }
        apexX = leftX;
        apexZ = leftZ;
        apexI = leftI;
        rightX = apexX;
        rightZ = apexZ;
        leftI = apexI;
        rightI = apexI;
        i = apexI;
        continue;
      }
    }
    if (area2(apexX, apexZ, leftX, leftZ, lx, lz) >= 0) {
      if ((apexX === leftX && apexZ === leftZ) || area2(apexX, apexZ, rightX, rightZ, lx, lz) < 0) {
        leftX = lx;
        leftZ = lz;
        leftI = i;
      } else {
        if (count < maxCorners) {
          out[count * 2] = rightX;
          out[count * 2 + 1] = rightZ;
          count++;
        }
        apexX = rightX;
        apexZ = rightZ;
        apexI = rightI;
        leftX = apexX;
        leftZ = apexZ;
        leftI = apexI;
        rightI = apexI;
        i = apexI;
        continue;
      }
    }
  }
  if (count < maxCorners && (count === 0 || out[(count - 1) * 2] !== ex || out[(count - 1) * 2 + 1] !== ez)) {
    out[count * 2] = ex;
    out[count * 2 + 1] = ez;
    count++;
  }
  return count;
}

// --- the corner check -------------------------------------------------------------------------

/** Whether a body of `radius` standing at a point is wholly on the mesh: the middle and a ring round it. */
export function fitsAt(floor: NavFloor, x: number, y: number, z: number, radius: number, samples: number = NAV_TUNE.samples, yTol: number = NAV_TUNE.yTol): boolean {
  if (locate(floor, x, y, z, yTol, 0) < 0) return false;
  if (radius <= 0) return true;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    if (locate(floor, x + Math.cos(a) * radius, y, z + Math.sin(a) * radius, yTol, 0) < 0) return false;
  }
  return true;
}

/**
 * A corner pulled off the wall it sits on. The funnel's corners are wall corners exactly -- a
 * doorjamb, the tip of a pillar -- so a body of any width that walks one clips the wall.
 *
 * Which way to pull is not the bisector of the two legs but its opposite. A corner the funnel
 * emitted is always one the path wraps round something to reach, so the free space at it is
 * reflex: the wedge *between* the two legs, the short way round, is the obstacle, and the bisector
 * of that wedge points into it. The corner is therefore moved along the far side of that bisector,
 * by the body's own half-width and never by more than two-fifths of the shorter leg (a corner
 * moved past the middle of its own leg is a corner in the wrong room).
 *
 * Writes x, z into `out` and says whether it moved at all; two legs that run back along each other
 * are a point on a straight line with no open side, and are left alone.
 */
export function insetCorner(px: number, pz: number, cx: number, cz: number, nx: number, nz: number, radius: number, out: { x: number; z: number }): boolean {
  out.x = cx;
  out.z = cz;
  if (radius <= 0) return false;
  let ux = px - cx;
  let uz = pz - cz;
  let wx = nx - cx;
  let wz = nz - cz;
  const ul = Math.hypot(ux, uz);
  const wl = Math.hypot(wx, wz);
  if (ul < 1e-4 || wl < 1e-4) return false;
  ux /= ul;
  uz /= ul;
  wx /= wl;
  wz /= wl;
  let bx = -(ux + wx);
  let bz = -(uz + wz);
  const bl = Math.hypot(bx, bz);
  if (bl < 1e-3) return false;
  bx /= bl;
  bz /= bl;
  const step = Math.min(radius, 0.4 * Math.min(ul, wl));
  out.x = cx + bx * step;
  out.z = cz + bz * step;
  return step > 1e-4;
}

/**
 * Every corner of one path, inset for a body of `radius` and checked. A corner whose inset point
 * does not fit is left where the funnel put it -- the mesh is walked at one size and a body wider
 * than the doorway is a body the old stuck check can have, rather than one we quietly send through
 * a wall. Returns how many corners did not fit, which is what the console counts.
 *
 * What the check is depends on how wide the body is. The mesh is authored to be walked at
 * `tune.agent`, so for a body no wider than that the inset point only has to be on the mesh at all
 * -- one look. A body wider than the mesh was drawn for has the whole ring of its own width tested,
 * which costs a look apiece and is why it is asked only of the bodies that need it.
 *
 * The height each corner is looked for at walks with the path rather than staying at the body's own
 * feet: a corner is looked for `tune.yTol` above and below the floor the *last* corner stood on,
 * starting at the walker's own height. On the flat that is the same number throughout; on a ramp or
 * a stepped room it climbs with the path, where one fixed height would fail the look at the far
 * corners and leave them on the wall, which is indistinguishable from a body too fat to fit.
 */
export function insetPath(floor: NavFloor, sx: number, sz: number, corners: Float64Array, count: number, y: number, radius: number, tune: NavTune = NAV_TUNE): number {
  if (count < 1 || radius <= 0) return 0;
  const spot = INSET_SPOT;
  const wide = radius > tune.agent + 1e-6;
  let misses = 0;
  let at = y;
  for (let i = 0; i + 1 < count; i++) {
    const px = i === 0 ? sx : corners[(i - 1) * 2];
    const pz = i === 0 ? sz : corners[(i - 1) * 2 + 1];
    const cx = corners[i * 2];
    const cz = corners[i * 2 + 1];
    // The floor under the corner itself, which is where the next corner is looked for from.
    const here = locate(floor, cx, at, cz, tune.yTol, 0);
    if (here >= 0) at = heightIn(floor, here, cx, cz);
    if (!insetCorner(px, pz, cx, cz, corners[(i + 1) * 2], corners[(i + 1) * 2 + 1], radius, spot)) continue;
    const t = locate(floor, spot.x, at, spot.z, tune.yTol, 0);
    if (t < 0 || (wide && !fitsAt(floor, spot.x, heightIn(floor, t, spot.x, spot.z), spot.z, radius, tune.samples, tune.yTol))) {
      misses++;
      continue;
    }
    corners[i * 2] = spot.x;
    corners[i * 2 + 1] = spot.z;
  }
  return misses;
}

/**
 * The whole of it for one room: the corners of a walk from one point to another on this floor,
 * written into `out` as x, z pairs. Returns how many, or 0 when the body is not on the mesh, the
 * end is not on it, or there is no way across. The start point itself is never a corner.
 */
export function pathIn(
  floor: NavFloor,
  sx: number,
  sy: number,
  sz: number,
  ex: number,
  ey: number,
  ez: number,
  out: Float64Array,
  radius: number = 0,
  tune: NavTune = NAV_TUNE,
): number {
  const a = locate(floor, sx, sy, sz, tune.yTol, tune.snap);
  if (a < 0) return 0;
  const b = locate(floor, ex, ey, ez, tune.yTol, tune.snap);
  if (b < 0) return 0;
  if (findCorridor(floor, a, b, tune.expand) < 1) return 0;
  const count = funnel(floor, sx, sz, ex, ez, out, Math.min(tune.corners, Math.floor(out.length / 2)));
  if (count < 1) return 0;
  insetPath(floor, sx, sz, out, count, sy, Math.max(0, radius - 1e-6), tune);
  return count;
}
