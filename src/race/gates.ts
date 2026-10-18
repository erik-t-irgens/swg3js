// A track's gates as the run tests them: each one baked once into a row of numbers in the game's frame (its middle,
// the way through it, its right, its up, and its window), and the swept crossing of a segment through it, interpolated
// to the instant of crossing within the segment. The run tests only the next gate, and only from the place its last
// test left to the place the race drive's step finds, so every metre the body moved is tested once whatever the frame
// loop or the physics' accumulator did between (`raceRun.ts`).
//
// A gate stands on its place: its window runs `w` metres across, centred, and `h` metres up from an eighth of itself
// below the place. A gate is dropped at a vehicle's middle, so the window reaches a little under a hull riding low and
// far over one thrown off a crest (ours: the share is a shape of the gate, not a number of feel).
//
// Pure arithmetic over typed arrays and kept records: nothing is allocated in a call, and a crossing's numbers go out
// through the segment record it was handed, never as a returned fraction (a number handed back from a call the
// compiler did not build in is a number made, and this is called from inside the drive's step). Node loads it.

/** Numbers a baked gate takes in its row. */
export const GATE_STRIDE = 16;
/** How much of a gate's height stands below its place (the rest above it). */
export const GATE_BELOW = 0.125;

/** A gate's place in the game's frame: its middle, its turn in three's order `[x, y, z, w]`, and its window. */
export interface GatePlace {
  x: number;
  y: number;
  z: number;
  q: readonly [number, number, number, number] | readonly number[];
  w: number;
  h: number;
}

/**
 * One gate baked into `out` at row `i`: its middle, the way through it (its own +Z turned by its turn), its right (+X),
 * its up (+Y), half its width, and how far its window reaches below and above its place.
 */
export function bakeGate(g: GatePlace, out: Float64Array, i: number): void {
  const o = i * GATE_STRIDE;
  const qx = g.q[0];
  const qy = g.q[1];
  const qz = g.q[2];
  const qw = g.q[3];
  out[o] = g.x;
  out[o + 1] = g.y;
  out[o + 2] = g.z;
  // The turn's own axes: +Z, +X and +Y turned.
  out[o + 3] = 2 * (qx * qz + qw * qy);
  out[o + 4] = 2 * (qy * qz - qw * qx);
  out[o + 5] = 1 - 2 * (qx * qx + qy * qy);
  out[o + 6] = 1 - 2 * (qy * qy + qz * qz);
  out[o + 7] = 2 * (qx * qy + qw * qz);
  out[o + 8] = 2 * (qx * qz - qw * qy);
  out[o + 9] = 2 * (qx * qy - qw * qz);
  out[o + 10] = 1 - 2 * (qx * qx + qz * qz);
  out[o + 11] = 2 * (qy * qz + qw * qx);
  out[o + 12] = g.w / 2;
  out[o + 13] = g.h * GATE_BELOW;
  out[o + 14] = g.h * (1 - GATE_BELOW);
  out[o + 15] = 0;
}

/** A segment handed to `crossGate`, and what it found: the fraction along it the crossing was at. */
export interface Segment {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** The fraction of the way from the first point to the second the plane was crossed at (0 to 1). */
  t: number;
  /** Where in the window it crossed: metres right of the middle and up from the place. */
  across: number;
  up: number;
}

/** A segment record, every field holding a number of its own from the first (it starts as a fraction). */
export function newSegment(): Segment {
  const s = { x0: 0.5, y0: 0.5, z0: 0.5, x1: 0.5, y1: 0.5, z1: 0.5, t: 0.5, across: 0.5, up: 0.5 };
  s.x0 = s.y0 = s.z0 = s.x1 = s.y1 = s.z1 = s.t = s.across = s.up = 0;
  return s;
}

/** The answers `crossGate` gives. */
export const CROSS_NONE = 0;
export const CROSS_FORWARD = 1;
export const CROSS_BACKWARD = -1;

/**
 * Whether the segment `s` passes through the gate at row `i`, and which way: forward (from behind its plane to in
 * front of it), backward, or not at all (it never crosses the plane, or crosses it outside the window). The instant is
 * written into `s.t` as the fraction along the segment, and where in the window into `s.across` and `s.up`. A segment
 * that starts exactly on the plane and leaves it forward is a forward crossing at its start; one that ends on it counts
 * as having reached the far side.
 */
export function crossGate(g: Float64Array, i: number, s: Segment): number {
  const o = i * GATE_STRIDE;
  const cx = g[o];
  const cy = g[o + 1];
  const cz = g[o + 2];
  const nx = g[o + 3];
  const ny = g[o + 4];
  const nz = g[o + 5];
  const d0 = (s.x0 - cx) * nx + (s.y0 - cy) * ny + (s.z0 - cz) * nz;
  const d1 = (s.x1 - cx) * nx + (s.y1 - cy) * ny + (s.z1 - cz) * nz;
  let dir = CROSS_NONE;
  if (d0 < 0 && d1 >= 0) dir = CROSS_FORWARD;
  else if (d0 >= 0 && d1 < 0) dir = CROSS_BACKWARD;
  else return CROSS_NONE;
  const t = d0 / (d0 - d1);
  const px = s.x0 + (s.x1 - s.x0) * t - cx;
  const py = s.y0 + (s.y1 - s.y0) * t - cy;
  const pz = s.z0 + (s.z1 - s.z0) * t - cz;
  const across = px * g[o + 6] + py * g[o + 7] + pz * g[o + 8];
  const up = px * g[o + 9] + py * g[o + 10] + pz * g[o + 11];
  if (across < -g[o + 12] || across > g[o + 12] || up < -g[o + 13] || up > g[o + 14]) return CROSS_NONE;
  s.t = t;
  s.across = across;
  s.up = up;
  return dir;
}

/**
 * The four corners of a gate's window into `out` from `at` (x, y, z each: bottom left, bottom right, top right, top
 * left as the gate is driven through), for the overlay to project and draw.
 */
export function gateCorners(g: Float64Array, i: number, out: Float64Array, at: number): void {
  const o = i * GATE_STRIDE;
  const hw = g[o + 12];
  const lo = -g[o + 13];
  const hi = g[o + 14];
  for (let k = 0; k < 4; k++) {
    const a = k === 0 || k === 3 ? -hw : hw;
    const b = k < 2 ? lo : hi;
    out[at + k * 3] = g[o] + g[o + 6] * a + g[o + 9] * b;
    out[at + k * 3 + 1] = g[o + 1] + g[o + 7] * a + g[o + 10] * b;
    out[at + k * 3 + 2] = g[o + 2] + g[o + 8] * a + g[o + 11] * b;
  }
}

/** The heading (rad: 0 along +z, growing toward +x) from one point on the ground to another. */
export function headingTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(bx - ax, bz - az);
}

/** A turn about the up axis as three's `[x, y, z, w]`: the way a gate dropped facing a heading is turned. */
export function headingTurn(heading: number): [number, number, number, number] {
  return [0, Math.sin(heading / 2), 0, Math.cos(heading / 2)];
}

/** The heading a turn faces (its +Z on the ground). */
export function turnHeading(q: readonly number[]): number {
  const fx = 2 * (q[0] * q[2] + q[3] * q[1]);
  const fz = 1 - 2 * (q[0] * q[0] + q[1] * q[1]);
  return Math.atan2(fx, fz);
}
