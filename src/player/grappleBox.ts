// An oriented box the grapple's rope can meet without asking the physics engine (Grapple §3.18): a ray against it (the
// slab test, with the face it entered by), whether a span reaches into it, and whether the fan a free span sweeps meets
// it (two triangles' separating axes). Each is worked in the box's own frame, from a pose (its middle and its turn, a
// unit quaternion x, y, z, w) and its half-size handed in, so a box that stands where the engine has nothing -- another
// player's vehicle, whose picture is a sensor every query passes -- is still something the rope bends on. Pure: no
// engine, no three, and nothing made a call (the scratch it works in is kept here).

/** Where a ray met a box: how far along it, and the face's outward normal in the world. */
export interface BoxHit {
  toi: number;
  nx: number;
  ny: number;
  nz: number;
}

export function newBoxHit(): BoxHit {
  return { toi: 0, nx: 0, ny: 0, nz: 0 };
}

const lo = new Float64Array(3);
const ld = new Float64Array(3);
const lb = new Float64Array(3);
const tri = new Float64Array(9);

/** `v` (at `vo` of `src`) turned by the unit turn `q` or its inverse, into `out` at `oo`. */
function turn(q: Float64Array, inverse: boolean, src: Float64Array, vo: number, out: Float64Array, oo: number): void {
  const x = src[vo];
  const y = src[vo + 1];
  const z = src[vo + 2];
  const qx = inverse ? -q[0] : q[0];
  const qy = inverse ? -q[1] : q[1];
  const qz = inverse ? -q[2] : q[2];
  const qw = q[3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[oo] = x + qw * tx + (qy * tz - qz * ty);
  out[oo + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[oo + 2] = z + qw * tz + (qx * ty - qy * tx);
}

/** A world point (at `o` of `src`) into the box's own frame, into `out` at `oo`. */
function intoBox(p: Float64Array, q: Float64Array, src: Float64Array, o: number, out: Float64Array, oo: number): void {
  lb[0] = src[o] - p[0];
  lb[1] = src[o + 1] - p[1];
  lb[2] = src[o + 2] - p[2];
  turn(q, true, lb, 0, out, oo);
}

/**
 * The ray from `origin` along unit `dir` (each three numbers) for at most `len` against the box at middle `p`, turn `q`
 * and half-size `half`: the first face it enters, into `out`, and true; false when it misses or starts inside.
 */
export function rayBox(origin: Float64Array, dir: Float64Array, len: number, p: Float64Array, q: Float64Array, half: Float64Array, out: BoxHit): boolean {
  intoBox(p, q, origin, 0, lo, 0);
  turn(q, true, dir, 0, ld, 0);
  let tmin = 0;
  let tmax = len;
  let axis = -1;
  let sign = 0;
  for (let k = 0; k < 3; k++) {
    const o = lo[k];
    const d = ld[k];
    const h = half[k];
    if (d > -1e-12 && d < 1e-12) {
      if (o < -h || o > h) return false;
      continue;
    }
    let t1 = (-h - o) / d;
    let t2 = (h - o) / d;
    let s = -1;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = k;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Started inside (no face was crossed on the way in): nothing to bend on from here.
  if (axis < 0) return false;
  out.toi = tmin;
  lb[0] = axis === 0 ? sign : 0;
  lb[1] = axis === 1 ? sign : 0;
  lb[2] = axis === 2 ? sign : 0;
  turn(q, false, lb, 0, lb, 0);
  out.nx = lb[0];
  out.ny = lb[1];
  out.nz = lb[2];
  return true;
}

/**
 * How far the span from `a` to `b` reaches into the box (its deepest point's distance inside the nearest face), nought
 * when it stays out: what the rope's `blocked` counts against `wrapOffset`. Sampled at `steps` points along the span.
 */
export function spanDepth(a: Float64Array, b: Float64Array, p: Float64Array, q: Float64Array, half: Float64Array, steps = 16): number {
  intoBox(p, q, a, 0, lo, 0);
  intoBox(p, q, b, 0, ld, 0);
  let deepest = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = lo[0] + (ld[0] - lo[0]) * t;
    const y = lo[1] + (ld[1] - lo[1]) * t;
    const z = lo[2] + (ld[2] - lo[2]) * t;
    const dx = half[0] - Math.abs(x);
    const dy = half[1] - Math.abs(y);
    const dz = half[2] - Math.abs(z);
    if (dx <= 0 || dy <= 0 || dz <= 0) continue;
    const d = dx < dy ? (dx < dz ? dx : dz) : dy < dz ? dy : dz;
    if (d > deepest) deepest = d;
  }
  return deepest;
}

/** Whether the triangle in `tri` (box frame, nine numbers) meets the box of half-size `half`, by the separating axes. */
function triMeetsBox(half: Float64Array): boolean {
  const ax = tri[0];
  const ay = tri[1];
  const az = tri[2];
  const bx = tri[3];
  const by = tri[4];
  const bz = tri[5];
  const cx = tri[6];
  const cy = tri[7];
  const cz = tri[8];
  // The box's own three axes.
  if (Math.max(ax, bx, cx) < -half[0] || Math.min(ax, bx, cx) > half[0]) return false;
  if (Math.max(ay, by, cy) < -half[1] || Math.min(ay, by, cy) > half[1]) return false;
  if (Math.max(az, bz, cz) < -half[2] || Math.min(az, bz, cz) > half[2]) return false;
  // The triangle's own normal.
  const e0x = bx - ax;
  const e0y = by - ay;
  const e0z = bz - az;
  const e1x = cx - bx;
  const e1y = cy - by;
  const e1z = cz - bz;
  const e2x = ax - cx;
  const e2y = ay - cy;
  const e2z = az - cz;
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  const nd = nx * ax + ny * ay + nz * az;
  const nr = half[0] * Math.abs(nx) + half[1] * Math.abs(ny) + half[2] * Math.abs(nz);
  if (nd > nr || nd < -nr) return false;
  // The nine crosses of the box's axes with the triangle's edges.
  for (let e = 0; e < 3; e++) {
    const ex = e === 0 ? e0x : e === 1 ? e1x : e2x;
    const ey = e === 0 ? e0y : e === 1 ? e1y : e2y;
    const ez = e === 0 ? e0z : e === 1 ? e1z : e2z;
    for (let k = 0; k < 3; k++) {
      // Axis = unit k cross the edge.
      const lx = k === 0 ? 0 : k === 1 ? ez : -ey;
      const ly = k === 0 ? -ez : k === 1 ? 0 : ex;
      const lz = k === 0 ? ey : k === 1 ? -ex : 0;
      if (lx === 0 && ly === 0 && lz === 0) continue;
      const pa = lx * ax + ly * ay + lz * az;
      const pb = lx * bx + ly * by + lz * bz;
      const pc = lx * cx + ly * cy + lz * cz;
      const r = half[0] * Math.abs(lx) + half[1] * Math.abs(ly) + half[2] * Math.abs(lz);
      if (Math.max(pa, pb, pc) < -r || Math.min(pa, pb, pc) > r) return false;
    }
  }
  return true;
}

/**
 * Whether the quad a free span swept (`quad`, twelve numbers: the pivot at the start and the end, the hand at the start
 * and the end, as the rope's fan keeps them) meets the box, as its two triangles.
 */
export function quadMeetsBox(quad: Float64Array, p: Float64Array, q: Float64Array, half: Float64Array): boolean {
  // Triangle one: the pivot at the start, the hand at the start, the hand at the end.
  intoBox(p, q, quad, 0, tri, 0);
  intoBox(p, q, quad, 6, tri, 3);
  intoBox(p, q, quad, 9, tri, 6);
  if (triMeetsBox(half)) return true;
  // Triangle two: the hand at the end, the pivot at the end, the pivot at the start.
  intoBox(p, q, quad, 9, tri, 0);
  intoBox(p, q, quad, 3, tri, 3);
  intoBox(p, q, quad, 0, tri, 6);
  return triMeetsBox(half);
}
