// The water standing in a placed fountain's or pool's basin, as the rest of the world asks about it:
// where it is, how high it stands, and what it looks like.
//
// A basin is drawn by the water system as a lake (`World.basinWaterBody`), but everything that asks
// "is there water over this point" -- a foot landing, the ripple field, the spray a wader throws, a
// lit blade -- asked the terrain's water table and nothing else, so a player could stand in a
// fountain and leave no ring. The answer here is the basin's own level surface, turned into the
// world once when the copy is placed: its upward triangles flattened onto the ground plane, and the
// height they stand at. A point is over the basin when it is inside one of those triangles, which
// matters because a round fountain's box reaches well past its rim at the corners, and a box test
// would have somebody standing on the paving beside it wading.
//
// Pure: numbers in and numbers out, so the node test builds a basin and asks it questions.

import type { WaterLook } from './waterLook.ts';

/** How a basin's water looks and how far it is asked about. Every number is ours; live through `__debug.fountains`. */
export const BASIN_WATER_TUNE = {
  /**
   * The water's own colour. The planet's lake colour, which is what a basin wore first, is a deep
   * body of water seen from far off and came out a swimming-pool blue in a stone bowl half a metre
   * deep; this is the green-grey of clear shallow water over stone.
   */
  color: '#5d7a70',
  /** How much of what is under the surface it hides: shallow and clear, so the basin's floor shows. */
  opacity: 0.45,
  /** The fine ripples' slope and drift, against a lake's 1 and 1: still water in a bowl. */
  ripple: 0.8,
  drift: 0.5,
  /** Metres over and under the surface a point may be and still be asked about: a balcony above a fountain is not in it. */
  reachUp: 3,
  reachDown: 3,
  /** Metres past a basin's own box within which the ripple field takes the basin's level rather than the planet's. */
  simMargin: 8,
};

/** The look every basin is drawn with, out of the table as it stands now. */
export function basinLook(): WaterLook {
  const t = BASIN_WATER_TUNE;
  return { color: t.color, opacity: t.opacity, ripple: t.ripple, drift: t.drift, cube: null, source: 'default', shader: null };
}

export interface BasinFootprint {
  /** The surface's height in the world. */
  top: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** The upward triangles on the ground plane: x0, z0, x1, z1, x2, z2 each. */
  tris: Float32Array;
}

/** How far from level an upward triangle may lean and still be part of the surface: its normal's y at least this. */
const LEVEL = 0.9;

/**
 * A basin's surface in the world, or null when the piece has no level triangle at all.
 * `positions` are the geometry's own (x, y, z each), `index` its index or null, and `m` the copy's
 * placement as a column-major 4x4 (three's `Matrix4.elements`).
 */
export function basinFootprint(positions: ArrayLike<number>, index: ArrayLike<number> | null, m: ArrayLike<number>): BasinFootprint | null {
  const count = index ? index.length : positions.length / 3;
  const world = (i: number, out: number[]) => {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  };
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  const kept: number[] = [];
  let ySum = 0;
  let yN = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let t = 0; t + 2 < count; t += 3) {
    world(index ? index[t] : t, a);
    world(index ? index[t + 1] : t + 1, b);
    world(index ? index[t + 2] : t + 2, c);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    // Either winding: the surface may be modelled to be seen from above or from both sides.
    if (!(len > 1e-9) || Math.abs(ny / len) < LEVEL) continue;
    kept.push(a[0], a[2], b[0], b[2], c[0], c[2]);
    ySum += a[1] + b[1] + c[1];
    yN += 3;
    for (const p of [a, b, c]) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[2] < minZ) minZ = p[2];
      if (p[2] > maxZ) maxZ = p[2];
    }
  }
  if (!yN) return null;
  return { top: ySum / yN, minX, maxX, minZ, maxZ, tris: new Float32Array(kept) };
}

/** Whether (x, z) is inside one of the basin's triangles on the ground plane (edges count). */
export function overBasin(b: BasinFootprint, x: number, z: number): boolean {
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  const t = b.tris;
  for (let i = 0; i + 5 < t.length; i += 6) {
    const d1 = (x - t[i + 2]) * (t[i + 1] - t[i + 3]) - (t[i] - t[i + 2]) * (z - t[i + 3]);
    const d2 = (x - t[i + 4]) * (t[i + 3] - t[i + 5]) - (t[i + 2] - t[i + 4]) * (z - t[i + 5]);
    const d3 = (x - t[i]) * (t[i + 5] - t[i + 1]) - (t[i + 4] - t[i]) * (z - t[i + 1]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return true;
  }
  return false;
}

/**
 * The height of the basin water over a point, or -Infinity where there is none. With `y` a number,
 * a point more than the reach above or below the surface is not asked about; `NaN` asks by column
 * alone (the splashes, which fall until they meet a surface).
 */
export function basinTopAt(list: readonly BasinFootprint[], x: number, z: number, y = Number.NaN): number {
  let best = -Infinity;
  const column = Number.isNaN(y);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.top <= best) continue;
    if (!column && (y > b.top + BASIN_WATER_TUNE.reachUp || y < b.top - BASIN_WATER_TUNE.reachDown)) continue;
    if (overBasin(b, x, z)) best = b.top;
  }
  return best;
}

/**
 * The level the ripple field should take near (x, z): the nearest basin whose box, grown by the
 * margin, reaches the point, or NaN when none does. The field is one plane, so it can ripple one
 * level at a time; a player at a fountain is the one who can see its rings.
 */
export function basinLevelNear(list: readonly BasinFootprint[], x: number, z: number, margin = BASIN_WATER_TUNE.simMargin): number {
  let level = Number.NaN;
  let nearest = Infinity;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
    const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
    const d = Math.max(dx, dz);
    if (d > margin || d >= nearest) continue;
    nearest = d;
    level = b.top;
  }
  return level;
}
