// One shape test for every zone of the world (Map-maker II, DESIGN.md §2.10, its eighth wave): whether a point, or a circle
// round it, touches a circle, a rectangle, an outline or a ring, over a list of zones kept in typed arrays in the game's
// frame, so a verdict asked every frame a ghost moves makes nothing.
//
// The list is made once a world (`places.ts` builds it when a locations file lands) and asked many times: `zoneAt` the first
// zone a circle of `r` round a point touches (the no-build verdict: players' houses by their clear circle, props by their
// half-width, the editor's note), `smallestAt` the smallest zone holding a point (which place a point is in: the city line,
// the loading screen's line). Each zone keeps its box, grown by `r` at the ask, as the pre-test, so a world of hundreds of
// the game's no-build areas costs a few comparisons a zone.
//
// A ring (Core3's no-build areas include rings) holds what lies between its two radii. An outline holds what its crossings
// say (the same rule the story's `inShape` and the client's lakes use), and a circle touches one when its middle is inside or
// an edge comes within its radius.
//
// Pure: no three, nothing imported. Rule for this file (node runs it with type stripping): no enum, no namespace, no
// constructor parameter properties.

export const ZONE_CIRCLE = 0;
export const ZONE_RECT = 1;
export const ZONE_POLY = 2;
export const ZONE_RING = 3;

/** Zones in the game's frame, grown as they are added and never in a frame. */
export class ZoneList {
  count = 0;
  /** Each zone's kind (`ZONE_*`). */
  kinds = new Uint8Array(8);
  /** Four numbers a zone: a circle's middle and radius; a rectangle's min and max; a ring's middle, inner and outer radius; an outline's first point and count. */
  p = new Float64Array(32);
  /** Each zone's box, min x, min z, max x, max z. */
  box = new Float64Array(32);
  /** Each zone's area, square metres. */
  area = new Float64Array(8);
  /** What the caller files each zone under (its own record's index). */
  tag = new Int32Array(8);
  /** Every outline's points, x and z. */
  pts = new Float64Array(64);
  ptsN = 0;
  /** The plain forms' own ask, kept. */
  readonly q = new ZoneAsk();

  private grow(): number {
    const i = this.count;
    if (i >= this.kinds.length) {
      const n = this.kinds.length * 2;
      const k = new Uint8Array(n);
      k.set(this.kinds);
      this.kinds = k;
      const p = new Float64Array(n * 4);
      p.set(this.p);
      this.p = p;
      const b = new Float64Array(n * 4);
      b.set(this.box);
      this.box = b;
      const a = new Float64Array(n);
      a.set(this.area);
      this.area = a;
      const t = new Int32Array(n);
      t.set(this.tag);
      this.tag = t;
    }
    this.count++;
    return i;
  }

  private setBox(i: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.box[i * 4] = minX;
    this.box[i * 4 + 1] = minZ;
    this.box[i * 4 + 2] = maxX;
    this.box[i * 4 + 3] = maxZ;
  }

  /** A circle, its middle and radius. Answers its index. */
  addCircle(x: number, z: number, r: number, tag: number): number {
    const i = this.grow();
    this.kinds[i] = ZONE_CIRCLE;
    this.p[i * 4] = x;
    this.p[i * 4 + 1] = z;
    this.p[i * 4 + 2] = r;
    this.p[i * 4 + 3] = 0;
    this.setBox(i, x - r, z - r, x + r, z + r);
    this.area[i] = Math.PI * r * r;
    this.tag[i] = tag;
    return i;
  }

  /** A rectangle by two corners (either first). Answers its index. */
  addRect(x0: number, z0: number, x1: number, z1: number, tag: number): number {
    const i = this.grow();
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minZ = Math.min(z0, z1);
    const maxZ = Math.max(z0, z1);
    this.kinds[i] = ZONE_RECT;
    this.p[i * 4] = minX;
    this.p[i * 4 + 1] = minZ;
    this.p[i * 4 + 2] = maxX;
    this.p[i * 4 + 3] = maxZ;
    this.setBox(i, minX, minZ, maxX, maxZ);
    this.area[i] = (maxX - minX) * (maxZ - minZ);
    this.tag[i] = tag;
    return i;
  }

  /** A ring: what lies between `inner` and `outer` metres of its middle. Answers its index. */
  addRing(x: number, z: number, inner: number, outer: number, tag: number): number {
    const i = this.grow();
    const lo = Math.max(0, Math.min(inner, outer));
    const hi = Math.max(inner, outer);
    this.kinds[i] = ZONE_RING;
    this.p[i * 4] = x;
    this.p[i * 4 + 1] = z;
    this.p[i * 4 + 2] = lo;
    this.p[i * 4 + 3] = hi;
    this.setBox(i, x - hi, z - hi, x + hi, z + hi);
    this.area[i] = Math.PI * (hi * hi - lo * lo);
    this.tag[i] = tag;
    return i;
  }

  /** An outline, its points `[x0, z0, x1, z1, ...]` (three at least). Answers its index. */
  addPoly(xz: ArrayLike<number>, tag: number): number {
    const n = Math.floor(xz.length / 2);
    const i = this.grow();
    if (this.pts.length < (this.ptsN + n) * 2) {
      const grown = new Float64Array(Math.max(this.pts.length * 2, (this.ptsN + n) * 2));
      grown.set(this.pts);
      this.pts = grown;
    }
    const start = this.ptsN;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    let a = 0;
    for (let k = 0; k < n; k++) {
      const x = xz[k * 2];
      const z = xz[k * 2 + 1];
      this.pts[(start + k) * 2] = x;
      this.pts[(start + k) * 2 + 1] = z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      const j = (k + n - 1) % n;
      a += xz[j * 2] * z - x * xz[j * 2 + 1];
    }
    this.ptsN += n;
    this.kinds[i] = ZONE_POLY;
    this.p[i * 4] = start;
    this.p[i * 4 + 1] = n;
    this.p[i * 4 + 2] = 0;
    this.p[i * 4 + 3] = 0;
    this.setBox(i, minX, minZ, maxX, maxZ);
    this.area[i] = Math.abs(a) / 2;
    this.tag[i] = tag;
    return i;
  }

  /** Every zone let go (the arrays kept for the next world). */
  clear(): void {
    this.count = 0;
    this.ptsN = 0;
  }
}

/**
 * A point and a radius asked of a list, kept: what every ask reads, so no number crosses a call the compiler may leave out
 * (a number handed to one is boxed, which a ghost asking every frame would pay for). Fractions from the start.
 */
export class ZoneAsk {
  x = 0.5;
  z = 0.5;
  r = 0.5;
}

/** Whether a point is inside an outline of the list, by its crossings along +x. Allocates nothing. */
function insidePoly(L: ZoneList, start: number, n: number, q: ZoneAsk): boolean {
  const P = L.pts;
  const x = q.x;
  const z = q.z;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = P[(start + i) * 2];
    const zi = P[(start + i) * 2 + 1];
    const xj = P[(start + j) * 2];
    const zj = P[(start + j) * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether any edge of an outline of the list comes within the ask's radius of its point (squared distances). Allocates nothing. */
function nearPolyEdge(L: ZoneList, start: number, n: number, q: ZoneAsk): boolean {
  const P = L.pts;
  const x = q.x;
  const z = q.z;
  const r2 = q.r * q.r;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = P[(start + j) * 2];
    const az = P[(start + j) * 2 + 1];
    const ex = P[(start + i) * 2] - ax;
    const ez = P[(start + i) * 2 + 1] - az;
    const ll = ex * ex + ez * ez;
    let t = ll > 0 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = ax + ex * t - x;
    const dz = az + ez * t - z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

/** Whether zone `i` of a list holds the ask's point, or touches its circle (radius 0: holds the point). Allocates nothing. */
export function zoneTouchesAsk(L: ZoneList, i: number, q: ZoneAsk): boolean {
  const p = L.p;
  const o = i * 4;
  const x = q.x;
  const z = q.z;
  const r = q.r;
  switch (L.kinds[i]) {
    case ZONE_CIRCLE: {
      const dx = x - p[o];
      const dz = z - p[o + 1];
      const R = p[o + 2] + r;
      return dx * dx + dz * dz <= R * R;
    }
    case ZONE_RECT: {
      const dx = x < p[o] ? p[o] - x : x > p[o + 2] ? x - p[o + 2] : 0;
      const dz = z < p[o + 1] ? p[o + 1] - z : z > p[o + 3] ? z - p[o + 3] : 0;
      return dx * dx + dz * dz <= r * r;
    }
    case ZONE_RING: {
      const dx = x - p[o];
      const dz = z - p[o + 1];
      const d = Math.sqrt(dx * dx + dz * dz);
      const near = d - r > 0 ? d - r : 0;
      return near <= p[o + 3] && d + r >= p[o + 2];
    }
    default: {
      // Whole numbers handed across the call (a double out of the typed array would be boxed there).
      const start = p[o] | 0;
      const n = p[o + 1] | 0;
      if (insidePoly(L, start, n, q)) return true;
      return r > 0 && nearPolyEdge(L, start, n, q);
    }
  }
}

/** Whether a point is within the ask's radius of zone `i`'s box: the pre-test every ask makes first. */
function inBox(L: ZoneList, i: number, q: ZoneAsk): boolean {
  const b = L.box;
  const o = i * 4;
  const r = q.r;
  return q.x >= b[o] - r && q.x <= b[o + 2] + r && q.z >= b[o + 1] - r && q.z <= b[o + 3] + r;
}

/** The first zone of a list the ask's circle touches (its index), or -1. Allocates nothing. */
export function zoneAtAsk(L: ZoneList, q: ZoneAsk): number {
  if (!(q.r > 0)) q.r = 0;
  for (let i = 0; i < L.count; i++) if (inBox(L, i, q) && zoneTouchesAsk(L, i, q)) return i;
  return -1;
}

/** The smallest zone of a list holding the ask's point (its index), or -1: a town inside a region inside the world reads as it is drawn. */
export function smallestAtAsk(L: ZoneList, q: ZoneAsk): number {
  q.r = 0;
  let best = -1;
  let bestArea = Infinity;
  for (let i = 0; i < L.count; i++) {
    if (!inBox(L, i, q) || !zoneTouchesAsk(L, i, q)) continue;
    if (L.area[i] < bestArea) {
      bestArea = L.area[i];
      best = i;
    }
  }
  return best;
}

/** The plain forms, for the tests and the console: each writes the list's own ask and asks it. */
export function zoneTouches(L: ZoneList, i: number, x: number, z: number, r: number): boolean {
  const q = L.q;
  q.x = x;
  q.z = z;
  q.r = r;
  return zoneTouchesAsk(L, i, q);
}

export function zoneAt(L: ZoneList, x: number, z: number, r: number): number {
  const q = L.q;
  q.x = x;
  q.z = z;
  q.r = r;
  return zoneAtAsk(L, q);
}

export function smallestAt(L: ZoneList, x: number, z: number): number {
  const q = L.q;
  q.x = x;
  q.z = z;
  q.r = 0;
  return smallestAtAsk(L, q);
}