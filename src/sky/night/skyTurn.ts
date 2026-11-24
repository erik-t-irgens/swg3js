// How the night sky stands in a world's sky (the GPU port's pass 2, wave 3; the design's 2.7): the galaxy's frame (the map's,
// where the stars and the band are made) turned into the world's sky by the world's tilt against the galaxy (two seeded
// dials, `nightTune.ts`'s `tiltOf`) and then by the day's turn, so the stars and the band wheel across the sky with the sun.
//
// The day's turn is read off the sun, never off a clock of its own: SWG's day carries its light round a great circle whose
// noon stands 67.5 degrees up (`daycycle.ts`, the client's pitch of 22.5 degrees off the vertical), which is a turn about a
// pole lying 22.5 degrees over the horizon toward +Z. The sun's place on that circle is the day's angle, so whatever moves
// the sun (the day's path today, wave 5's orbits later) moves the stars with it, and the sun stands still among them.
//
// Pure: no three, no DOM. `nightFrameInto` writes a kept 3 by 3 matrix (column after column, three's `Matrix3.elements`
// order) and allocates nothing: what a frame calls.

/** The client's pitch of its light off the vertical, degrees (`daycycle.ts`'s `SWG_LIGHT_ELEVATION` is 90 less it). */
export const SWG_POLE_DEG = 22.5;

const E = ((90 - SWG_POLE_DEG) * Math.PI) / 180;
const SP = Math.sin(E);
const CP = Math.cos(E);

/** The day's turn: its axis (unit, a turn about it by the day's angle carries the noon sun `NOON` round), and the noon sun. */
export const DAY_AXIS = { x: 0, y: -CP, z: -SP } as const;
/**
 * The axis's three numbers as the frame reads them: plain constants of the module, never the record's fields (a record whose
 * `x` is a whole nought beside fractions made a number a frame where the frame read it, `nightAlloc.test.ts`).
 */
const AX = 0;
const AY = -CP;
const AZ = -SP;
export const NOON = { x: 0, y: SP, z: -CP } as const;
/** The axis crossed with the noon sun: where the day's angle of a quarter turn puts the sun (its setting point). */
export const QUARTER = { x: 1, y: 0, z: 0 } as const;

/** A direction's three fields. */
export interface Dir3 {
  x: number;
  y: number;
  z: number;
}

/** The day's angle for a sun direction (unit): its place round the day's circle from the noon sun toward `QUARTER`. */
export function dayAngleOf(sun: Dir3): number {
  return Math.atan2(sun.x, SP * sun.y - CP * sun.z);
}

/** How far a direction stands off the day's circle (its share along the day's axis): nought for every sun the day writes. */
export function offCircle(sun: Dir3): number {
  return sun.x * DAY_AXIS.x + sun.y * DAY_AXIS.y + sun.z * DAY_AXIS.z;
}

/**
 * The galaxy's frame against the world's sky at the day's angle nought (into `out`, nine numbers column after column): the
 * galactic north (the map's +Y) stood `tiltDeg` off the day's upper pole toward the noon sun and turned `nodeDeg` about the
 * pole; the map's +X along the line where the two equators cross; its +Z making the frame right-handed.
 */
export function tiltFrameInto(tiltDeg: number, nodeDeg: number, out: Float64Array | Float32Array | number[]): void {
  // The upper pole (the day's axis turned over: 22.5 degrees up toward +Z).
  const px = -DAY_AXIS.x;
  const py = -DAY_AXIS.y;
  const pz = -DAY_AXIS.z;
  const t = (tiltDeg * Math.PI) / 180;
  const n = (nodeDeg * Math.PI) / 180;
  // The galactic north: the pole tipped toward the noon sun by the tilt...
  let gx = Math.cos(t) * px + Math.sin(t) * NOON.x;
  let gy = Math.cos(t) * py + Math.sin(t) * NOON.y;
  let gz = Math.cos(t) * pz + Math.sin(t) * NOON.z;
  // ...then turned about the pole by the node (Rodrigues: v cos + (k × v) sin + k (k · v)(1 − cos)).
  const c = Math.cos(n);
  const s = Math.sin(n);
  const kv = px * gx + py * gy + pz * gz;
  const cx = py * gz - pz * gy;
  const cy = pz * gx - px * gz;
  const cz = px * gy - py * gx;
  const yx = gx * c + cx * s + px * kv * (1 - c);
  const yy = gy * c + cy * s + py * kv * (1 - c);
  const yz = gz * c + cz * s + pz * kv * (1 - c);
  // The line of the crossing: the pole crossed with the galactic north (any line in the day's equator when they agree).
  let xx = py * yz - pz * yy;
  let xy = pz * yx - px * yz;
  let xz = px * yy - py * yx;
  let l = Math.sqrt(xx * xx + xy * xy + xz * xz);
  if (l < 1e-9) {
    xx = QUARTER.x;
    xy = QUARTER.y;
    xz = QUARTER.z;
    l = 1;
  }
  xx /= l;
  xy /= l;
  xz /= l;
  gx = yx;
  gy = yy;
  gz = yz;
  // +Z = +X × +Y.
  const zx = xy * gz - xz * gy;
  const zy = xz * gx - xx * gz;
  const zz = xx * gy - xy * gx;
  out[0] = xx;
  out[1] = xy;
  out[2] = xz;
  out[3] = gx;
  out[4] = gy;
  out[5] = gz;
  out[6] = zx;
  out[7] = zy;
  out[8] = zz;
}

/**
 * (The fixer of pass 2, wave 6: the owner's late addition 2) The galaxy's frame in the sky of a world whose star system is
 * applied, into `out` (nine numbers column after column): the world's own celestial frame now, `cel` (its equator's reference,
 * the equator a quarter turn on and its pole: `SkyMotion.celestial`, written by the day's `at` each frame), carrying `tilt`
 * (`tiltFrameInto`'s frame at the day's angle nought, laid against SWG's day frame: `QUARTER`, `NOON` and the upper pole) as
 * the world's own equator and pole carry it. So the tilt dials keep their meaning (the galactic pole `tiltDeg` off the world's
 * celestial pole, turned `nodeDeg` about it), and the stars turn about the world's own axis at its own spin, its sidereal day:
 * the stars, the sun's path and the bodies one sky. Reads the arrays alone and writes the kept one: what a frame calls.
 */
export function celestialFrameInto(tilt: ArrayLike<number>, cel: ArrayLike<number>, out: Float64Array | Float32Array | number[]): void {
  for (let col = 0; col < 3; col++) {
    const x = tilt[col * 3];
    const y = tilt[col * 3 + 1];
    const z = tilt[col * 3 + 2];
    // into the day frame's own terms (along `QUARTER`, along `NOON`, along the upper pole)...
    const a = x;
    const b = SP * y - CP * z;
    const c = CP * y + SP * z;
    // ...and out along the world's own
    out[col * 3] = a * cel[0] + b * cel[3] + c * cel[6];
    out[col * 3 + 1] = a * cel[1] + b * cel[4] + c * cel[7];
    out[col * 3 + 2] = a * cel[2] + b * cel[5] + c * cel[8];
  }
}

/**
 * The galaxy's frame in the world's sky now, into `out` (nine numbers column after column): `tilt` the frame at the day's
 * angle nought (`tiltFrameInto`, worked when a dial moves), turned about the day's axis by the angle the sun `sun` (unit)
 * stands at. A direction of the map's frame `g` stands in the world's sky at `out · g`. Reads the vectors' fields and writes
 * the kept array alone, so no number crosses a call that may not be built in: what a frame calls.
 */
export function nightFrameInto(tilt: ArrayLike<number>, sun: Dir3, out: Float64Array | Float32Array | number[]): void {
  // The day's angle's cosine and sine are the sun's own place on the day's circle (along the noon sun and along `QUARTER`),
  // made unit: no angle is worked out only to be turned back into them (`dayAngleOf` is the angle itself, for the tests and the
  // console).
  const cn = SP * sun.y - CP * sun.z;
  const sn = sun.x;
  const l = Math.sqrt(cn * cn + sn * sn);
  const c = l > 1e-12 ? cn / l : 1;
  const s = l > 1e-12 ? sn / l : 0;
  const k = 1 - c;
  const ax = AX;
  const ay = AY;
  const az = AZ;
  // Rodrigues' matrix about the day's axis, row by row.
  const r00 = c + ax * ax * k;
  const r01 = ax * ay * k - az * s;
  const r02 = ax * az * k + ay * s;
  const r10 = ay * ax * k + az * s;
  const r11 = c + ay * ay * k;
  const r12 = ay * az * k - ax * s;
  const r20 = az * ax * k - ay * s;
  const r21 = az * ay * k + ax * s;
  const r22 = c + az * az * k;
  for (let col = 0; col < 3; col++) {
    const x = tilt[col * 3];
    const y = tilt[col * 3 + 1];
    const z = tilt[col * 3 + 2];
    out[col * 3] = r00 * x + r01 * y + r02 * z;
    out[col * 3 + 1] = r10 * x + r11 * y + r12 * z;
    out[col * 3 + 2] = r20 * x + r21 * y + r22 * z;
  }
}
