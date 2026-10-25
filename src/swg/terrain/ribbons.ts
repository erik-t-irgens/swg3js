// The terrain's ribbons (ARIB, `AffectorRibbon`): strips of water or lava laid down a slope, each point at its own
// height, starting in a pool (the end cap) -- on the retail worlds Mustafar's thirty-three lava falls and nothing else.
// The client built each ribbon into quads and an eight-sided cap when the terrain loaded, drew them with the ribbon's
// own water shader and counted them in its water height; this port reads the same data (`generator.ts`) and builds the
// same shapes, restated in our words:
//
// - **The quads.** A ribbon of n points makes n + 1 quads: one reaching back half a width behind its first point at that
//   point's height, one between each pair of points, and one reaching on half a width past its last point at that
//   point's height. Each quad's two ends are crossed by a normal flat on the ground, square to its run; where two quads
//   meet, the normal is the mean of their two (never made a unit again, so a bend narrows the strip a little, as the
//   client's did). A quad's corners are its first end plus and minus the normal times half the width, then its second
//   end minus and plus it.
// - **The cap.** A tapered square of eight corners, three cap widths across, standing off the first point on the side
//   away from the second, at the first point's height: the pool the fall pours out of. None for a cap width of nought.
//
// Pure: no three. The world turns these into meshes (`World.buildRibbons`) and the air asks them what liquid is over a
// point (`ribbonAt`).
import { Layer, AffectorRibbon, type RibbonData, type TerrainGenerator } from './generator.ts';

/** A ribbon of the terrain in its own (SWG) frame, with its quads and its cap built. */
export interface TerrainRibbon extends RibbonData {
  name: string;
  /** Four corners a quad, x, y, z each, in the order the client lists them: twelve numbers a quad. */
  quads: Float64Array;
  /** Each quad's way along the ribbon (its run from the first end to the second, flat and a unit), x and z. */
  runs: Float64Array;
  /** The cap's eight corners, x and z each, or null for none; and the height it stands at. */
  cap: Float64Array | null;
  capHeight: number;
}

/**
 * The quads of a ribbon of `points` (x, z and each one's height) and `width` metres, as the client built them: twelve
 * numbers a quad (four corners, x y z), and each quad's run (x, z, a unit) beside. Nothing for fewer than two points.
 */
export function ribbonQuads(points: readonly { x: number; z: number; h: number }[], width: number): { quads: Float64Array; runs: Float64Array } {
  const n = points.length;
  if (n < 2) return { quads: new Float64Array(0), runs: new Float64Array(0) };
  const half = width / 2;
  // Segments: [topX, topY, topZ, bottomX, bottomY, bottomZ, dirX, dirZ, topNormalX, topNormalZ, bottomNormalX, bottomNormalZ].
  const segs: number[][] = [];
  const unit = (x: number, z: number): [number, number] => {
    const l = Math.sqrt(x * x + z * z);
    return l > 0 ? [x / l, z / l] : [0, 0];
  };
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      // The first: reaching back half a width from the first point, at its height.
      const p = points[0];
      const q = points[1];
      const [dx, dz] = unit(q.x - p.x, q.z - p.z);
      segs.push([p.x - dx * half, p.h, p.z - dz * half, p.x, p.h, p.z, dx, dz, dz, -dx, dz, -dx]);
    }
    if (i === n - 1) {
      // The last: reaching on half a width past the last point, at its height, along the run before it.
      const last = segs[segs.length - 1];
      const [dx, dz] = [last[6], last[7]];
      const tx = last[3];
      const ty = last[4];
      const tz = last[5];
      segs.push([tx, ty, tz, tx + dx * half, ty, tz + dz * half, dx, dz, dz, -dx, dz, -dx]);
    } else {
      // Between this point and the next.
      const p = points[i];
      const q = points[i + 1];
      const [dx, dz] = unit(q.x - p.x, q.z - p.z);
      segs.push([p.x, p.h, p.z, q.x, q.h, q.z, dx, dz, dz, -dx, dz, -dx]);
    }
  }
  // Where two meet, the mean of the two normals, never made a unit again (the client's own).
  for (let i = 1; i < segs.length; i++) {
    const nx = (segs[i][8] + segs[i - 1][10]) / 2;
    const nz = (segs[i][9] + segs[i - 1][11]) / 2;
    segs[i][8] = nx;
    segs[i][9] = nz;
    segs[i - 1][10] = nx;
    segs[i - 1][11] = nz;
  }
  const quads = new Float64Array(segs.length * 12);
  const runs = new Float64Array(segs.length * 2);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const o = i * 12;
    quads[o] = s[0] + s[8] * half;
    quads[o + 1] = s[1];
    quads[o + 2] = s[2] + s[9] * half;
    quads[o + 3] = s[0] - s[8] * half;
    quads[o + 4] = s[1];
    quads[o + 5] = s[2] - s[9] * half;
    quads[o + 6] = s[3] - s[10] * half;
    quads[o + 7] = s[4];
    quads[o + 8] = s[5] - s[11] * half;
    quads[o + 9] = s[3] + s[10] * half;
    quads[o + 10] = s[4];
    quads[o + 11] = s[5] + s[11] * half;
    runs[i * 2] = s[6];
    runs[i * 2 + 1] = s[7];
  }
  return { quads, runs };
}

/** The cap's eight corners (x, z each) off the first point, three `capWidth` across, or null for none. */
export function ribbonCap(points: readonly { x: number; z: number }[], capWidth: number): Float64Array | null {
  if (!(capWidth > 0) || points.length < 2) return null;
  let ux = points[0].x - points[1].x;
  let uz = points[0].z - points[1].z;
  const l = Math.sqrt(ux * ux + uz * uz);
  if (l > 0) {
    ux /= l;
    uz /= l;
  }
  // Right of the way up, and the four ways scaled by the cap's width.
  const rx = uz;
  const rz = -ux;
  const out = new Float64Array(16);
  let x = points[0].x - rx * (capWidth / 2);
  let z = points[0].z - rz * (capWidth / 2);
  const c = capWidth;
  const step = (i: number, ax: number, az: number): void => {
    x += ax * c;
    z += az * c;
    out[i * 2] = x;
    out[i * 2 + 1] = z;
  };
  out[0] = x;
  out[1] = z;
  step(1, ux - rx, uz - rz);
  step(2, ux, uz);
  step(3, rx + ux, rz + uz);
  step(4, rx, rz);
  step(5, rx - ux, rz - uz);
  step(6, -ux, -uz);
  step(7, -rx - ux, -rz - uz);
  return out;
}

/**
 * Every ribbon the terrain draws: an active ribbon affector in an active layer, every layer above it active, as the
 * client collected them when its terrain loaded; a ribbon whose data could not be read, or of fewer than two points,
 * is left out.
 */
export function terrainRibbons(generator: TerrainGenerator): TerrainRibbon[] {
  const out: TerrainRibbon[] = [];
  const walk = (layers: readonly Layer[]): void => {
    for (const l of layers) {
      if (!l.active) continue;
      for (const a of l.affectors) {
        if (!a.active || !(a instanceof AffectorRibbon) || !a.ribbon || a.ribbon.points.length < 2) continue;
        const r = a.ribbon;
        const { quads, runs } = ribbonQuads(r.points, r.width);
        out.push({ ...r, name: a.name, quads, runs, cap: ribbonCap(r.points, r.capWidth), capHeight: r.points[0].h });
      }
      walk(l.layers);
    }
  };
  walk(generator.layers);
  return out;
}

/**
 * A ribbon in the game's frame: its corners and runs carried by `toX` and `toZ` (the game's X is the client's mirrored),
 * its bounds, and its surface's flow -- along its run, downstream from its first point to its last, at its velocity
 * read as metres a second (an inference: 1 on every retail ribbon, where a water shader's repeat of 64 m would make
 * repeats a second 64 m/s; the client's drawing of it is not in any source this work has).
 */
export interface GameRibbon {
  name: string;
  shader: string;
  waterType: number;
  velocity: number;
  shaderSize: number;
  width: number;
  quads: Float64Array;
  runs: Float64Array;
  cap: Float64Array | null;
  capHeight: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Each quad's own bounds, four numbers a quad (min x, max x, min z, max z). */
  quadBounds: Float64Array;
}

/** A terrain ribbon carried into the game's frame. */
export function gameRibbon(r: TerrainRibbon, toX: (x: number) => number, toZ: (z: number) => number): GameRibbon {
  const quads = new Float64Array(r.quads.length);
  for (let i = 0; i < r.quads.length; i += 3) {
    quads[i] = toX(r.quads[i]);
    quads[i + 1] = r.quads[i + 1];
    quads[i + 2] = toZ(r.quads[i + 2]);
  }
  // A run's way under the mirror: its X turned over with the place's.
  const sx = toX(1) - toX(0);
  const sz = toZ(1) - toZ(0);
  const runs = new Float64Array(r.runs.length);
  for (let i = 0; i < r.runs.length; i += 2) {
    runs[i] = r.runs[i] * sx;
    runs[i + 1] = r.runs[i + 1] * sz;
  }
  const cap = r.cap ? new Float64Array(r.cap.length) : null;
  if (cap && r.cap) {
    for (let i = 0; i < r.cap.length; i += 2) {
      cap[i] = toX(r.cap[i]);
      cap[i + 1] = toZ(r.cap[i + 1]);
    }
  }
  const nq = quads.length / 12;
  const qb = new Float64Array(nq * 4);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let q = 0; q < nq; q++) {
    let a = Infinity;
    let b = -Infinity;
    let c = Infinity;
    let d = -Infinity;
    for (let k = 0; k < 4; k++) {
      const x = quads[q * 12 + k * 3];
      const z = quads[q * 12 + k * 3 + 2];
      if (x < a) a = x;
      if (x > b) b = x;
      if (z < c) c = z;
      if (z > d) d = z;
    }
    qb[q * 4] = a;
    qb[q * 4 + 1] = b;
    qb[q * 4 + 2] = c;
    qb[q * 4 + 3] = d;
    if (a < minX) minX = a;
    if (b > maxX) maxX = b;
    if (c < minZ) minZ = c;
    if (d > maxZ) maxZ = d;
  }
  if (cap) {
    for (let i = 0; i < cap.length; i += 2) {
      if (cap[i] < minX) minX = cap[i];
      if (cap[i] > maxX) maxX = cap[i];
      if (cap[i + 1] < minZ) minZ = cap[i + 1];
      if (cap[i + 1] > maxZ) maxZ = cap[i + 1];
    }
  }
  return { name: r.name, shader: r.shader, waterType: r.waterType, velocity: r.velocity, shaderSize: r.shaderSize, width: r.width, quads, runs, cap, capHeight: r.capHeight, minX, maxX, minZ, maxZ, quadBounds: qb };
}

/** Whether (x, z) is in the triangle (a, b, c) of the XZ plane, edges included. */
function inTriangle(x: number, z: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): boolean {
  const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
  const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
  const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** The height over (x, z) of the plane through three corners, or NaN where it stands on edge. */
function planeHeight(x: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  // The normal's components; its y nought is a plane on edge, which no point of the ground stands under.
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (Math.abs(ny) < 1e-9) return Number.NaN;
  return ay - (nx * (x - ax) + nz * (z - az)) / ny;
}

/** Whether (x, z) is in the cap's triangle of corners a, b and c. */
function inCap(c: Float64Array, x: number, z: number, a: number, b: number, d: number): boolean {
  return inTriangle(x, z, c[a * 2], c[a * 2 + 1], c[b * 2], c[b * 2 + 1], c[d * 2], c[d * 2 + 1]);
}

/** What `ribbonAt` answers: the surface's height, its flow (m/s, x and z) and its water type (0 water, 1 lava). */
export interface RibbonPoint {
  h: number;
  fx: number;
  fz: number;
  type: number;
}

/**
 * The highest ribbon surface over a game point, as the client's water height found it (each quad's two triangles, the
 * height on the plane through their corners; each cap's six triangles at its first point's height), with its flow there:
 * the quad's run times the ribbon's velocity, nought in a cap's pool. Writes `out` and answers whether any covers the
 * point. Allocates nothing.
 */
export function ribbonAt(ribbons: readonly GameRibbon[], x: number, z: number, out: RibbonPoint): boolean {
  let found = false;
  let best = -Infinity;
  for (let r = 0; r < ribbons.length; r++) {
    const g = ribbons[r];
    if (x < g.minX || x > g.maxX || z < g.minZ || z > g.maxZ) continue;
    const q = g.quads;
    const nq = q.length / 12;
    for (let i = 0; i < nq; i++) {
      const b = i * 4;
      if (x < g.quadBounds[b] || x > g.quadBounds[b + 1] || z < g.quadBounds[b + 2] || z > g.quadBounds[b + 3]) continue;
      const o = i * 12;
      const in1 = inTriangle(x, z, q[o], q[o + 2], q[o + 3], q[o + 5], q[o + 6], q[o + 8]);
      const in2 = !in1 && inTriangle(x, z, q[o], q[o + 2], q[o + 6], q[o + 8], q[o + 9], q[o + 11]);
      if (!in1 && !in2) continue;
      const v1 = in1 ? 3 : 9;
      const h = planeHeight(x, z, q[o], q[o + 1], q[o + 2], q[o + v1], q[o + v1 + 1], q[o + v1 + 2], q[o + 6], q[o + 7], q[o + 8]);
      if (!Number.isFinite(h) || h <= best) continue;
      best = h;
      found = true;
      out.h = h;
      out.fx = g.runs[i * 2] * g.velocity;
      out.fz = g.runs[i * 2 + 1] * g.velocity;
      out.type = g.waterType;
    }
    const c = g.cap;
    if (c && g.capHeight > best) {
      // The two fans the client tested: (0 1 2) (0 2 3) (0 3 4) and (4 5 6) (4 6 7) (4 7 0).
      if (inCap(c, x, z, 0, 1, 2) || inCap(c, x, z, 0, 2, 3) || inCap(c, x, z, 0, 3, 4) || inCap(c, x, z, 4, 5, 6) || inCap(c, x, z, 4, 6, 7) || inCap(c, x, z, 4, 7, 0)) {
        best = g.capHeight;
        found = true;
        out.h = g.capHeight;
        out.fx = 0;
        out.fz = 0;
        out.type = g.waterType;
      }
    }
  }
  return found;
}

/**
 * A ribbon's surface as triangles to draw: its quads (two triangles each, the client's own split) and its cap's six, in
 * the game's frame, positions three numbers a corner and an index.
 */
export function ribbonTriangles(g: GameRibbon): { position: Float32Array; index: Uint32Array } {
  const nq = g.quads.length / 12;
  const capCorners = g.cap ? 8 : 0;
  const position = new Float32Array(nq * 12 + capCorners * 3);
  for (let i = 0; i < g.quads.length; i++) position[i] = g.quads[i];
  const index: number[] = [];
  for (let i = 0; i < nq; i++) {
    const v = i * 4;
    index.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  if (g.cap) {
    const base = nq * 4;
    for (let k = 0; k < 8; k++) {
      position[(base + k) * 3] = g.cap[k * 2];
      position[(base + k) * 3 + 1] = g.capHeight;
      position[(base + k) * 3 + 2] = g.cap[k * 2 + 1];
    }
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3], [0, 3, 4], [4, 5, 6], [4, 6, 7], [4, 7, 0]]) index.push(base + a, base + b, base + c);
  }
  return { position, index: Uint32Array.from(index) };
}
