// A drawn course's road as a spine (the race drawer, `A:\swg3js\racedrawer\DESIGN.md` §2.3): a path's nodes turned into
// samples every two metres along each edge, each sample's place on the ground, its own arclength along its edge, and the
// road's height, half width, bank and shoulder there.
//
// **The plan curve.** A `straight` edge is a line. A `smooth` edge is a cubic Hermite whose end tangents are centripetal
// Catmull-Rom's (alpha 0.5, which neither loops nor cusps between unevenly spaced nodes) from the neighbouring nodes, except
// that a node joining a smooth edge to a straight one takes the straight edge's direction with the centripetal tangent's own
// length (any other length would lose the no-loop property), so a curve leaves a straight tangentially and a corner between
// two straights is a corner. An open path's ends take one-sided tangents (the derivative of the quadratic through the end
// three nodes in the same parametrisation). Every curve passes through its nodes.
//
// **Along the road** the height, the half width, the bank and the shoulder are each a monotone cubic over arclength: the
// piecewise cubic Hermite interpolant whose slope at a node is Fritsch and Butland's weighted harmonic mean of the two
// edges' secants (nought where they disagree in sign), the form of Fritsch and Carlson's method that needs no second pass:
// smooth through every node, never over the higher of two neighbouring nodes nor under the lower, and one slope at a node
// whatever the edges' lengths, so the grade has no kink there.
//
// **Edge by edge.** Each edge is sampled on its own, from the node it leaves, at `ceil(len / SPINE_STEP)` equal steps of its
// own arclength (found through an arclength table of at least `ARC_TABLE` pieces, none longer than `ARC_PIECE`), both ends included, into typed arrays of its own.
// An edge's samples depend only on the nodes that shape it (nodes `i - 2` to `i + 3` for edge `i`), and every quantity is
// worked out from those nodes alone in one fixed order, so an edge nothing changed keeps its samples to the bit, and a
// closed path's nodes rotated give the same edges to the bit. What a change moved is worked out by comparing, never listed
// (`dirtyEdges`).
//
// **The driver's right** in the file's (raw) frame along a tangent `(tx, tz)` is `(tz, -tx)` (`rightOf`): the game's frame
// mirrors x, and there the right of a nose `(sin h, cos h)` is `(-cos h, sin h)` (`raceGroup.ts`'s `gridSlot`).
//
// Pure: imports nothing. Rule for this file (node runs it with type stripping): no enum, no namespace, no constructor
// parameter properties.

/** The spine's step (m): one of the client's poles. A constant: it changes bits, so a later carve's version carries it. */
export const SPINE_STEP = 2;
/**
 * Pieces of an edge's arclength table at the least: a constant, for the same reason. A long edge takes more, so that no piece
 * is longer than `ARC_PIECE` along the curve's control polygon (which is never shorter than the curve): with sixty-four
 * pieces alone, a curve of three hundred metres put its two-metre samples up to 2.26 m apart on the ground, the Hermite's
 * speed changing inside a piece read as straight.
 */
export const ARC_TABLE = 64;
export const ARC_PIECE = 0.5;

/** What a path's node gives the spine: its place, width, bank (degrees), shoulder, the edge leaving it and its walls. */
export interface SpineNode {
  x: number;
  y: number;
  z: number;
  w: number;
  b: number;
  sh: number;
  c: string;
  wall?: string;
  /** `false`: the road follows the ground here (wave 3b); absent or true, it cuts. */
  cut?: boolean;
}

/** One edge's samples, from the node it leaves to the next. Only the first `count` of each array are its own. */
export interface SpineEdge {
  /** The node it leaves and the node it reaches. */
  from: number;
  to: number;
  straight: boolean;
  /** Its race walls: 1 the left, 2 the right. */
  walls: number;
  /** Its samples, both ends included, and its own arclength. */
  count: number;
  len: number;
  x: Float64Array;
  z: Float64Array;
  /** Each sample's arclength from the edge's start. */
  s: Float64Array;
  /** The road's surface, half width, tan of the bank (the driver's right up) and shoulder at each sample. */
  y: Float64Array;
  hw: Float64Array;
  tb: Float64Array;
  sh: Float64Array;
  /**
   * How much the carve cuts at each sample (wave 3b): 1 at a cutting node, 0 at a following one, eased between them by the
   * spine's own smooth step (the Hermite with slopes of nought, `t^2 (3 - 2t)`); exactly 1 along an edge between two cutting
   * nodes, so a course that cuts everywhere is carved as before to the bit.
   */
  k: Float64Array;
}

/** A path's spine: whether it is closed, its edges in order, its length and where each edge starts along it. */
export interface Spine {
  closed: boolean;
  nodes: number;
  edges: SpineEdge[];
  length: number;
  /** Each edge's start's arclength from node 0 (the edges' own lengths summed in order). */
  start: Float64Array;
}

function knot(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(Math.sqrt(dx * dx + dz * dz));
}

/** The road's numbers at a node: 0 the surface, 1 the half width, 2 the bank (degrees), 3 the shoulder. */
function valueOf(n: SpineNode, k: number): number {
  return k === 0 ? n.y : k === 1 ? n.w / 2 : k === 2 ? n.b : n.sh;
}

/** Fritsch and Butland's slope at an interior node from the secants either side and their edges' lengths. */
function pchipInner(dIn: number, dOut: number, hIn: number, hOut: number): number {
  if (!(dIn * dOut > 0)) return 0;
  const w1 = 2 * hOut + hIn;
  const w2 = hOut + 2 * hIn;
  return (w1 + w2) / (w1 / dIn + w2 / dOut);
}

/** The one-sided slope at an open end: `h0`, `d0` the end edge's, `h1`, `d1` the one beside it, held so the end stays monotone. */
function pchipEnd(h0: number, h1: number, d0: number, d1: number): number {
  const m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(m) !== Math.sign(d0)) return 0;
  if (Math.sign(d0) !== Math.sign(d1) && Math.abs(m) > Math.abs(3 * d0)) return 3 * d0;
  return m;
}

/**
 * The working arrays a spine is worked out in (each node's tangent, each edge's arclength table, pieces and length, each
 * node's slopes), kept for the module and grown by doubling, never handed out: `buildSpine` runs to its end with nothing in
 * between that could build another, so one set serves every call, and a spine made again into its own arrays (`into`)
 * makes no array once these and its edges are big enough. Made fresh each call, they were seven arrays and about 350 KB a
 * rebuild of a 400-node path, the arclength table the most of it.
 */
let TX: Float64Array = new Float64Array(16);
let TZ: Float64Array = new Float64Array(16);
let PIECES: Int32Array = new Int32Array(16);
let TABLE_AT: Int32Array = new Int32Array(17);
let TABLE: Float64Array = new Float64Array(1024);
let LENS: Float64Array = new Float64Array(16);
let SLOPE: Float64Array = new Float64Array(64);
const grownF = (a: Float64Array, n: number): Float64Array => (a.length >= n ? a : new Float64Array(Math.max(n, a.length * 2)));
const grownI = (a: Int32Array, n: number): Int32Array => (a.length >= n ? a : new Int32Array(Math.max(n, a.length * 2)));

/** An edge with arrays of room for `count` samples: the one handed in where it has the room, else a fresh one. */
function edgeOf(was: SpineEdge | undefined, count: number): SpineEdge {
  if (was && was.x.length >= count) return was;
  const cap = Math.max(count, was ? was.x.length * 2 : 0);
  return { from: 0, to: 0, straight: false, walls: 0, count: 0, len: 0, x: new Float64Array(cap), z: new Float64Array(cap), s: new Float64Array(cap), y: new Float64Array(cap), hw: new Float64Array(cap), tb: new Float64Array(cap), sh: new Float64Array(cap), k: new Float64Array(cap) };
}

/**
 * A path's spine. `closed`: the path wraps (a circuit's main line). `into`, where handed, is a spine whose edges' arrays are
 * reused while they hold enough (an edge that lengthens grows by doubling), and the working arrays are the module's own
 * (`TX` and its kin), so a spine made again into its own arrays many times a second makes no array once all of them are big
 * enough (the numbers it works out are another matter: run seldom, it runs unoptimised); the answer is `into` itself then.
 * Nodes nearer than nothing apart are the reader's to refuse
 * (`COURSE_LIMITS.edgeLeast`); here an edge of no length is a point.
 */
export function buildSpine(nodes: readonly SpineNode[], closed: boolean, into?: Spine): Spine {
  const n = nodes.length;
  const cl = closed && n >= 3;
  const edges = n < 2 ? 0 : cl ? n : n - 1;
  // Each node's centripetal tangent, unscaled (the derivative over the knot parameter).
  const tx = (TX = grownF(TX, n));
  const tz = (TZ = grownF(TZ, n));
  for (let k = 0; k < n; k++) {
    const prev = cl || k > 0 ? (k - 1 + n) % n : -1;
    const next = cl || k < n - 1 ? (k + 1) % n : -1;
    const P = nodes[k];
    let ax = 0;
    let az = 0;
    if (prev >= 0 && next >= 0) {
      const A = nodes[prev];
      const B = nodes[next];
      const t0 = knot(A.x, A.z, P.x, P.z);
      const t1 = knot(P.x, P.z, B.x, B.z);
      const s = t0 + t1;
      ax = (t0 > 0 ? (P.x - A.x) / t0 : 0) - (s > 0 ? (B.x - A.x) / s : 0) + (t1 > 0 ? (B.x - P.x) / t1 : 0);
      az = (t0 > 0 ? (P.z - A.z) / t0 : 0) - (s > 0 ? (B.z - A.z) / s : 0) + (t1 > 0 ? (B.z - P.z) / t1 : 0);
    } else if (next >= 0) {
      // An open path's start: the quadratic through its first three nodes, or its one edge's chord.
      const B = nodes[next];
      const t1 = knot(P.x, P.z, B.x, B.z);
      const d1x = t1 > 0 ? (B.x - P.x) / t1 : 0;
      const d1z = t1 > 0 ? (B.z - P.z) / t1 : 0;
      if (n >= 3) {
        const C = nodes[next + 1];
        const t2 = knot(B.x, B.z, C.x, C.z);
        const d2x = t2 > 0 ? (C.x - B.x) / t2 : 0;
        const d2z = t2 > 0 ? (C.z - B.z) / t2 : 0;
        const s = t1 + t2;
        ax = d1x - (s > 0 ? (t1 * (d2x - d1x)) / s : 0);
        az = d1z - (s > 0 ? (t1 * (d2z - d1z)) / s : 0);
      } else {
        ax = d1x;
        az = d1z;
      }
    } else if (prev >= 0) {
      // An open path's end, the other way round.
      const A = nodes[prev];
      const tb = knot(A.x, A.z, P.x, P.z);
      const dbx = tb > 0 ? (P.x - A.x) / tb : 0;
      const dbz = tb > 0 ? (P.z - A.z) / tb : 0;
      if (n >= 3) {
        const Z = nodes[prev - 1];
        const ta = knot(Z.x, Z.z, A.x, A.z);
        const dax = ta > 0 ? (A.x - Z.x) / ta : 0;
        const daz = ta > 0 ? (A.z - Z.z) / ta : 0;
        const s = ta + tb;
        ax = dbx + (s > 0 ? (tb * (dbx - dax)) / s : 0);
        az = dbz + (s > 0 ? (tb * (dbz - daz)) / s : 0);
      } else {
        ax = dbx;
        az = dbz;
      }
    }
    // A node between a smooth edge and a straight one: the straight one's direction, at the centripetal tangent's length.
    const inStraight = prev >= 0 && nodes[prev].c === 'straight';
    const outStraight = next >= 0 && P.c === 'straight';
    if (inStraight !== outStraight) {
      const Q = inStraight ? nodes[prev] : nodes[next];
      const dx = inStraight ? P.x - Q.x : Q.x - P.x;
      const dz = inStraight ? P.z - Q.z : Q.z - P.z;
      const dl = Math.sqrt(dx * dx + dz * dz);
      const tl = Math.sqrt(ax * ax + az * az);
      if (dl > 0) {
        ax = (dx / dl) * tl;
        az = (dz / dl) * tl;
      }
    }
    tx[k] = ax;
    tz[k] = az;
  }
  // Each edge's arclength table (its pieces as many as its control polygon's length asks, `ARC_PIECE` each, `ARC_TABLE` at
  // the least), and its length.
  const pieces = (PIECES = grownI(PIECES, edges));
  const tableAt = (TABLE_AT = grownI(TABLE_AT, edges + 1));
  tableAt[0] = 0;
  for (let e = 0; e < edges; e++) {
    const A = nodes[e];
    const B = nodes[(e + 1) % n];
    const kn = knot(A.x, A.z, B.x, B.z);
    // The Bezier control polygon of the Hermite (P0, P0 + M0 / 3, P1 - M1 / 3, P1), never shorter than the curve.
    const b1x = A.x + (kn * tx[e]) / 3;
    const b1z = A.z + (kn * tz[e]) / 3;
    const b2x = B.x - (kn * tx[(e + 1) % n]) / 3;
    const b2z = B.z - (kn * tz[(e + 1) % n]) / 3;
    const poly = A.c === 'straight' ? Math.hypot(B.x - A.x, B.z - A.z) : Math.hypot(b1x - A.x, b1z - A.z) + Math.hypot(b2x - b1x, b2z - b1z) + Math.hypot(B.x - b2x, B.z - b2z);
    pieces[e] = Math.max(ARC_TABLE, Math.ceil(poly / ARC_PIECE));
    tableAt[e + 1] = tableAt[e] + pieces[e] + 1;
  }
  const table = (TABLE = grownF(TABLE, tableAt[edges]));
  const lens = (LENS = grownF(LENS, edges));
  for (let e = 0; e < edges; e++) {
    const a = e;
    const b = (e + 1) % n;
    const A = nodes[a];
    const B = nodes[b];
    const straight = A.c === 'straight';
    const kn = knot(A.x, A.z, B.x, B.z);
    const m0x = kn * tx[a];
    const m0z = kn * tz[a];
    const m1x = kn * tx[b];
    const m1z = kn * tz[b];
    let px = A.x;
    let pz = A.z;
    let acc = 0;
    const o = tableAt[e];
    const P = pieces[e];
    table[o] = 0;
    for (let i = 1; i <= P; i++) {
      const u = i / P;
      let qx: number;
      let qz: number;
      if (straight) {
        qx = A.x + (B.x - A.x) * u;
        qz = A.z + (B.z - A.z) * u;
      } else {
        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;
        qx = h00 * A.x + h10 * m0x + h01 * B.x + h11 * m1x;
        qz = h00 * A.z + h10 * m0z + h01 * B.z + h11 * m1z;
      }
      const dx = qx - px;
      const dz = qz - pz;
      acc += Math.sqrt(dx * dx + dz * dz);
      table[o + i] = acc;
      px = qx;
      pz = qz;
    }
    lens[e] = acc;
  }
  // Each node's slope of the four road numbers over arclength.
  const slope = (SLOPE = grownF(SLOPE, n * 4));
  for (let k = 0; k < n; k++) {
    const inE = cl ? (k - 1 + n) % n : k - 1;
    const outE = k < edges ? k : -1;
    for (let q = 0; q < 4; q++) {
      const vk = valueOf(nodes[k], q);
      let m = 0;
      if (inE >= 0 && outE >= 0) {
        const dIn = lens[inE] > 0 ? (vk - valueOf(nodes[inE], q)) / lens[inE] : 0;
        const dOut = lens[outE] > 0 ? (valueOf(nodes[(outE + 1) % n], q) - vk) / lens[outE] : 0;
        m = pchipInner(dIn, dOut, lens[inE], lens[outE]);
      } else if (outE >= 0) {
        // An open start: its own edge and, where there is one, the next.
        const d0 = lens[0] > 0 ? (valueOf(nodes[1], q) - vk) / lens[0] : 0;
        if (edges >= 2) {
          const d1 = lens[1] > 0 ? (valueOf(nodes[2], q) - valueOf(nodes[1], q)) / lens[1] : 0;
          m = lens[0] + lens[1] > 0 ? pchipEnd(lens[0], lens[1], d0, d1) : 0;
        } else m = d0;
      } else if (inE >= 0) {
        // An open end: its own edge and the one before.
        const d0 = lens[inE] > 0 ? (vk - valueOf(nodes[inE], q)) / lens[inE] : 0;
        if (inE >= 1) {
          const d1 = lens[inE - 1] > 0 ? (valueOf(nodes[inE], q) - valueOf(nodes[inE - 1], q)) / lens[inE - 1] : 0;
          m = lens[inE] + lens[inE - 1] > 0 ? pchipEnd(lens[inE], lens[inE - 1], d0, d1) : 0;
        } else m = d0;
      }
      slope[k * 4 + q] = m;
    }
  }
  // The samples, edge by edge.
  const out = into ?? { closed: cl, nodes: n, edges: [], length: 0, start: new Float64Array(0) };
  out.closed = cl;
  out.nodes = n;
  if (out.start.length < edges) out.start = new Float64Array(Math.max(edges, out.start.length * 2));
  let total = 0;
  for (let e = 0; e < edges; e++) {
    const a = e;
    const b = (e + 1) % n;
    const A = nodes[a];
    const B = nodes[b];
    const L = lens[e];
    const steps = L > 0 ? Math.max(1, Math.ceil(L / SPINE_STEP)) : 1;
    const ed = edgeOf(out.edges[e], steps + 1);
    out.edges[e] = ed;
    ed.from = a;
    ed.to = b;
    ed.straight = A.c === 'straight';
    ed.walls = A.wall === 'left' ? 1 : A.wall === 'right' ? 2 : A.wall === 'both' ? 3 : 0;
    ed.count = steps + 1;
    ed.len = L;
    const kn = knot(A.x, A.z, B.x, B.z);
    const m0x = kn * tx[a];
    const m0z = kn * tz[a];
    const m1x = kn * tx[b];
    const m1z = kn * tz[b];
    const o = tableAt[e];
    const PC = pieces[e];
    let piece = 0;
    // How much each end cuts (wave 3b): a following node nought.
    const kA = A.cut === false ? 0 : 1;
    const kB = B.cut === false ? 0 : 1;
    for (let i = 0; i <= steps; i++) {
      const s = i === steps ? L : (L * i) / steps;
      // The table's piece this arclength falls in, walked forward (the samples rise), and the parameter inside it.
      while (piece < PC - 1 && table[o + piece + 1] < s) piece++;
      const lo = table[o + piece];
      const hi = table[o + piece + 1];
      const u = i === 0 ? 0 : i === steps ? 1 : (piece + (hi > lo ? (s - lo) / (hi - lo) : 0)) / PC;
      let qx: number;
      let qz: number;
      if (ed.straight) {
        qx = A.x + (B.x - A.x) * u;
        qz = A.z + (B.z - A.z) * u;
      } else {
        const u2 = u * u;
        const u3 = u2 * u;
        qx = (2 * u3 - 3 * u2 + 1) * A.x + (u3 - 2 * u2 + u) * m0x + (-2 * u3 + 3 * u2) * B.x + (u3 - u2) * m1x;
        qz = (2 * u3 - 3 * u2 + 1) * A.z + (u3 - 2 * u2 + u) * m0z + (-2 * u3 + 3 * u2) * B.z + (u3 - u2) * m1z;
      }
      ed.x[i] = i === 0 ? A.x : i === steps ? B.x : qx;
      ed.z[i] = i === 0 ? A.z : i === steps ? B.z : qz;
      ed.s[i] = s;
      // The road's numbers: each a cubic Hermite over the edge's arclength through its two nodes with their slopes.
      const t = L > 0 ? s / L : 0;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      ed.y[i] = h00 * A.y + h10 * L * slope[a * 4] + h01 * B.y + h11 * L * slope[b * 4];
      ed.hw[i] = h00 * (A.w / 2) + h10 * L * slope[a * 4 + 1] + h01 * (B.w / 2) + h11 * L * slope[b * 4 + 1];
      const bank = h00 * A.b + h10 * L * slope[a * 4 + 2] + h01 * B.b + h11 * L * slope[b * 4 + 2];
      ed.tb[i] = Math.tan((bank * Math.PI) / 180);
      ed.sh[i] = h00 * A.sh + h10 * L * slope[a * 4 + 3] + h01 * B.sh + h11 * L * slope[b * 4 + 3];
      // Exactly the end's own where both ends agree (1 between two cutting nodes, to the bit); else the smooth step between.
      ed.k[i] = kA === kB ? kA : kA + (kB - kA) * h01;
    }
    out.start[e] = total;
    total += L;
  }
  out.edges.length = edges;
  out.length = total;
  return out;
}

/** Whether two edges' samples are the same to the bit (their counts, places, arclengths, heights, widths, banks, shoulders and walls). */
export function sameEdge(a: SpineEdge, b: SpineEdge): boolean {
  if (a.count !== b.count || a.walls !== b.walls || a.from !== b.from || a.to !== b.to) return false;
  for (let i = 0; i < a.count; i++) {
    if (a.x[i] !== b.x[i] || a.z[i] !== b.z[i] || a.s[i] !== b.s[i] || a.y[i] !== b.y[i] || a.hw[i] !== b.hw[i] || a.tb[i] !== b.tb[i] || a.sh[i] !== b.sh[i] || a.k[i] !== b.k[i]) return false;
  }
  return true;
}

/**
 * The edges of `now` that differ from `was`'s edge of the same index, bit for bit, and every edge one of them has that the
 * other has not: what a change moved, worked out by comparing (§2.3), never trusted from a list.
 */
export function dirtyEdges(was: Spine, now: Spine): number[] {
  const out: number[] = [];
  const most = Math.max(was.edges.length, now.edges.length);
  for (let e = 0; e < most; e++) {
    const a = was.edges[e];
    const b = now.edges[e];
    if (!a || !b || !sameEdge(a, b)) out.push(e);
  }
  return out;
}

/** The driver's right along a tangent of the file's (raw) frame: `(tz, -tx)`, made unit, into `out`. */
export function rightOf(tx: number, tz: number, out: { x: number; z: number }): { x: number; z: number } {
  const l = Math.sqrt(tx * tx + tz * tz);
  out.x = l > 0 ? tz / l : 0;
  out.z = l > 0 ? -tx / l : 0;
  return out;
}

/** A point on a spine and the road there: its place, surface, half width, bank's tan, shoulder and unit tangent. */
export interface SpinePoint {
  x: number;
  z: number;
  y: number;
  hw: number;
  tb: number;
  sh: number;
  tx: number;
  tz: number;
  /** How much the road cuts the ground here (wave 3b): 1 cutting, 0 following, between eased by the spine's smooth step. */
  k: number;
}

/** A point record, fractions from the start. */
export function spinePoint(): SpinePoint {
  return { x: 0.5, z: 0.5, y: 0.5, hw: 0.5, tb: 0.5, sh: 0.5, tx: 0.5, tz: 0.5, k: 0.5 };
}

/**
 * The road at a share `t` (0 to 1) of edge `e`'s own arclength, into `out`: between the two samples either side of it, its
 * tangent along the samples' chord there. False for an edge the spine has not got.
 */
export function spineAt(sp: Spine, e: number, t: number, out: SpinePoint): boolean {
  const ed = sp.edges[e];
  if (!ed || ed.count < 2) return false;
  const s = Math.max(0, Math.min(1, t)) * ed.len;
  // The samples are evenly spaced in arclength: the one before is found directly.
  const step = ed.len / (ed.count - 1);
  let i = step > 0 ? Math.floor(s / step) : 0;
  if (i > ed.count - 2) i = ed.count - 2;
  if (i < 0) i = 0;
  const span = ed.s[i + 1] - ed.s[i];
  const f = span > 0 ? Math.max(0, Math.min(1, (s - ed.s[i]) / span)) : 0;
  out.x = ed.x[i] + (ed.x[i + 1] - ed.x[i]) * f;
  out.z = ed.z[i] + (ed.z[i + 1] - ed.z[i]) * f;
  out.y = ed.y[i] + (ed.y[i + 1] - ed.y[i]) * f;
  out.hw = ed.hw[i] + (ed.hw[i + 1] - ed.hw[i]) * f;
  out.tb = ed.tb[i] + (ed.tb[i + 1] - ed.tb[i]) * f;
  out.sh = ed.sh[i] + (ed.sh[i + 1] - ed.sh[i]) * f;
  out.k = ed.k[i] === ed.k[i + 1] ? ed.k[i] : ed.k[i] + (ed.k[i + 1] - ed.k[i]) * f;
  const dx = ed.x[i + 1] - ed.x[i];
  const dz = ed.z[i + 1] - ed.z[i];
  const l = Math.sqrt(dx * dx + dz * dz);
  out.tx = l > 0 ? dx / l : 0;
  out.tz = l > 0 ? dz / l : 0;
  return true;
}

/** Where a point lies against a spine: the edge and its share, how far from the spine, and its offset toward the driver's right. */
export interface SpineNear {
  e: number;
  t: number;
  d: number;
  o: number;
  x: number;
  z: number;
  y: number;
  hw: number;
}

/** A near record, fractions from the start. */
export function spineNear(): SpineNear {
  return { e: -1, t: 0.5, d: Infinity, o: 0.5, x: 0.5, z: 0.5, y: 0.5, hw: 0.5 };
}

/**
 * The nearest point of a spine to `(x, z)` on the ground, into `out` (its edge, the share of that edge's arclength, the
 * distance, the signed offset toward the driver's right, the spine's place, surface and half width there). False for a
 * spine with no edge. Every sample segment is looked at: a click's work, never a frame's of a long course.
 */
export function nearestOn(sp: Spine, x: number, z: number, out: SpineNear): boolean {
  out.e = -1;
  out.d = Infinity;
  for (let e = 0; e < sp.edges.length; e++) {
    const ed = sp.edges[e];
    for (let i = 0; i + 1 < ed.count; i++) {
      const ax = ed.x[i];
      const az = ed.z[i];
      const dx = ed.x[i + 1] - ax;
      const dz = ed.z[i + 1] - az;
      const l2 = dx * dx + dz * dz;
      const f = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const px = ax + dx * f;
      const pz = az + dz * f;
      const d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
      if (d < out.d) {
        out.d = d;
        out.e = e;
        const s = ed.s[i] + (ed.s[i + 1] - ed.s[i]) * f;
        out.t = ed.len > 0 ? s / ed.len : 0;
        out.x = px;
        out.z = pz;
        out.y = ed.y[i] + (ed.y[i + 1] - ed.y[i]) * f;
        out.hw = ed.hw[i] + (ed.hw[i + 1] - ed.hw[i]) * f;
        const l = Math.sqrt(l2);
        // The right of the segment's way, `(tz, -tx)`.
        out.o = l > 0 ? ((x - px) * dz - (z - pz) * dx) / l : 0;
      }
    }
  }
  return out.e >= 0;
}

/** One leg of a spine's corridor: from one place to the next, how far either side of the line it reaches, and where it starts along the path. */
export interface SpineLeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
  /** Its start's arclength from the path's node 0 (m): what names a leg in words (`track({ check })`). */
  s: number;
}

/**
 * A spine cut into legs about `step` metres long, each edge on its own, each leg's `half` the road's half width (the wider
 * of its ends) plus `clear`: the corridor along a drawn road (§2.3).
 */
export function spineLegs(sp: Spine, clear: number, step: number): SpineLeg[] {
  const out: SpineLeg[] = [];
  const a = spinePoint();
  const b = spinePoint();
  for (let e = 0; e < sp.edges.length; e++) {
    const ed = sp.edges[e];
    const n = Math.max(1, Math.ceil(ed.len / Math.max(0.5, step)));
    spineAt(sp, e, 0, a);
    for (let i = 1; i <= n; i++) {
      spineAt(sp, e, i / n, b);
      out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, half: Math.max(a.hw, b.hw) + clear, s: sp.start[e] + ((i - 1) / n) * ed.len });
      a.x = b.x;
      a.z = b.z;
      a.hw = b.hw;
    }
  }
  return out;
}

/**
 * Whether an edge's own samples cross themselves (a short smooth edge between two near-opposite straights can): every pair
 * of its segments that are not neighbours tested. An edge of more than `most` samples is not looked at (a note's work, never
 * a frame's, and a long edge's loop is a node's matter to see on the ground).
 */
export function edgeCrossesItself(ed: SpineEdge, most = 600): boolean {
  if (ed.count > most) return false;
  for (let i = 0; i + 1 < ed.count; i++) {
    for (let j = i + 2; j + 1 < ed.count; j++) {
      if (segmentsCross(ed.x[i], ed.z[i], ed.x[i + 1], ed.z[i + 1], ed.x[j], ed.z[j], ed.x[j + 1], ed.z[j + 1])) return true;
    }
  }
  return false;
}

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Where a turn is too tight for its road (§2.3): each edge whose spine somewhere turns on a radius less than the road's half
 * width plus its shoulder there (its inside edge folds over itself), measured from three consecutive samples. Answers the
 * edges, each once.
 */
export function foldingEdges(sp: Spine): number[] {
  const out: number[] = [];
  for (let e = 0; e < sp.edges.length; e++) {
    const ed = sp.edges[e];
    for (let i = 1; i + 1 < ed.count; i++) {
      const ax = ed.x[i - 1];
      const az = ed.z[i - 1];
      const bx = ed.x[i];
      const bz = ed.z[i];
      const cx = ed.x[i + 1];
      const cz = ed.z[i + 1];
      const ab = Math.hypot(bx - ax, bz - az);
      const bc = Math.hypot(cx - bx, cz - bz);
      const ca = Math.hypot(ax - cx, az - cz);
      const cross = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
      if (!(cross > 1e-9)) continue;
      const r = (ab * bc * ca) / (2 * cross);
      if (r < ed.hw[i] + ed.sh[i]) {
        out.push(e);
        break;
      }
    }
  }
  return out;
}
