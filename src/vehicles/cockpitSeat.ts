// Where a ship's pilot looks from and sits: plain numbers, so the node tests can run it.
//
// The eye is the cockpit frame's own camera point (its one hardpoint, `camera`) with the cockpit
// file's first-person offset (all of it, or a hull's share of it); the body hangs under it with the
// seated clip's eyes exactly on it, in first and third person alike. The seat cushion one downward
// ray through the frame's triangles finds is still measured, for the console and for the older rule
// that moved the body onto it (`SEAT_RULE`).
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

/** The gun hardpoint patterns the garage reads muzzles and mounts by. */
export const GUN_MUZZLE = /muzzle|barrel|(^|_)fire|flash/i;
export const GUN_MOUNT = /^weapon\d*(_[a-z]+)?\d*$|^gun\d*(_[a-z]+)?\d*$/i;
/** The seat and eye patterns, before the gun test takes the guns out of them. */
const SEAT_NAME = /rider|saddle|seat|driver|pilot|passenger|player|mount/i;
const EYE_NAME = /cockpit|canopy|camera|view|pilot/i;
/** space_sitting's first frame at scale 1, over the rider's origin, for a rig that cannot say: the eyes' middle, and the pelvis joint. */
export const SEATED_EYE_FALLBACK: Vec3 = [0, 1.213, 0.109];
export const SEATED_PELVIS_FALLBACK: Vec3 = [0, 0.505, 0];
/** The same eyes over the pelvis joint (the difference of the two above). */
export const EYE_OVER_PELVIS: Vec3 = [0, 0.708, 0.109];
/**
 * The head joint to the eyes, for a skeleton without eye joints: in the figure's own frame at scale 1 (the rig
 * root's frame before its scale), added to the head joint's composed position, never turned by the head's own turn.
 */
export const HEAD_TO_EYE: Vec3 = [0, 0.0725, 0.09];
/** A seated pelvis joint over the cushion under it, at scale 1. */
export const PELVIS_OVER_SEAT = 0.1;
/** The seat is looked for this far under the eye (metres), on a surface at least this level (|normal.y|). */
export const SEAT_DROP_MIN = 0.45;
export const SEAT_DROP_MAX = 1.2;
export const SEAT_MIN_UP = 0.4;
/** The most the body is moved up or down to sit on the seat. */
export const LIFT_LIMIT = 0.3;
/** In first person the body rises at most this much over hanging from the eye, at scale 1: more and the camera meets the collar. */
export const FIRST_PERSON_RAISE_MAX = 0.1;
/** How far the hovering cockpit's heading target may lead the hull, radians. */
export const COCKPIT_LEAD = 0.6;
/**
 * Per-frame corrections of the body under the eye, in the hull's frame (x, y, z as __debug.seat takes them), keyed by the
 * frame's file name ('tie_fighter_cockpit_cockpit.glb'): where the owner's reports from __debug.seat land. Empty to start.
 */
export const COCKPIT_BODY_NUDGE: Readonly<Record<string, Vec3>> = {};
/**
 * How a ship's seated pilot is placed under the eye. `eyes`: the seated clip's eyes exactly on the first-person eye (the
 * owner's call: the head lines up with the view, which also looks right from outside), whatever cushion is under it.
 * `cushion`: the older rule, the body moved up or down onto the cushion the frame's triangles give (bodyLift). Mutable so
 * `__debug.cockpit({ cushion: true })` can compare the two live.
 */
export const SEAT_RULE: { place: 'eyes' | 'cushion' } = { place: 'eyes' };
/**
 * The share of the cockpit file's first-person offset (1OFF) the view takes, by cockpit frame file (the key
 * COCKPIT_BODY_NUDGE uses); a frame not listed takes all of it. INVENTED: the B-wing's full 1OFF (0.14 up, 0.10 ahead)
 * framed the instruments better for fighting and none looked more real, so the owner asked for the difference split.
 * Tunable live with `__debug.cockpit({ share })`.
 */
export const COCKPIT_OFFSET_SHARE: Readonly<Record<string, number>> = { 'bwing_cockpit_cockpit.glb': 0.5 };

/** A cockpit frame's share of its 1OFF (COCKPIT_OFFSET_SHARE, else 1), kept within 0..1. */
export function offsetShare(file: string | null | undefined): number {
  const s = COCKPIT_OFFSET_SHARE[frameFileName(file)];
  return typeof s === 'number' && Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 1;
}

/** The first-person eye in the hull's frame: the camera point plus the share of the (mirrored) 1OFF. */
export function viewEye(camera: Vec3, offset: Vec3, share: number): Vec3 {
  return [camera[0] + offset[0] * share, camera[1] + offset[1] * share, camera[2] + offset[2] * share];
}

/** The cushion drop the body is placed by: none (the eyes go on the eye) under the 'eyes' rule, else the one measured. */
export function seatDropUsed(cushion: number | null, place: 'eyes' | 'cushion' = SEAT_RULE.place): number | null {
  return place === 'eyes' ? null : cushion;
}

/** A cockpit frame's file name without its folder ('tie_fighter_cockpit_cockpit.glb'), the key of COCKPIT_BODY_NUDGE and COCKPIT_OFFSET_SHARE. */
export function frameFileName(file: string | null | undefined): string {
  return (file ?? '').replace(/^.*[\\/]/, '');
}

/** A gun's hardpoint: a muzzle or a weapon mount. */
export function isGunHardpoint(name: string): boolean {
  return GUN_MUZZLE.test(name) || GUN_MOUNT.test(name);
}

/** A hardpoint that seats a rider (never a gun: the gunboats' `pilotmuzzle1` is one). */
export function isSeatHardpoint(name: string): boolean {
  return SEAT_NAME.test(name) && !isGunHardpoint(name);
}

/** A hardpoint that names where the cockpit view is (never a gun). */
export function isEyeHardpoint(name: string): boolean {
  return EYE_NAME.test(name) && !isGunHardpoint(name);
}

/** The cockpit file's first-person offset in the hull's frame: the converter mirrors X, so X changes sign; null gives zeros. */
export function mirroredOffset(off: readonly number[] | null | undefined): Vec3 {
  if (!off || off.length < 3) return [0, 0, 0];
  // `0 - x` rather than `-x`, so a zero stays a plain zero.
  return [0 - off[0], off[1], off[2]];
}

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * The first seat surface straight down from (x, y, z): the nearest triangle (both faces) whose |normal.y| is at least
 * `minUp` and which lies between `min` and `max` under the point. `tris` holds nine numbers per triangle. Returns how far
 * under the point it is, or null.
 */
export function seatDropBelow(tris: ArrayLike<number>, x: number, y: number, z: number, min = SEAT_DROP_MIN, max = SEAT_DROP_MAX, minUp = SEAT_MIN_UP): number | null {
  // Möller–Trumbore with the direction (0, -1, 0), no culling. With that direction the determinant is the
  // triangle's (unnormalised) normal's y, so the level test and the parallel test are the same number.
  let best: number | null = null;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const e1x = tris[i + 3] - ax, e1y = tris[i + 4] - ay, e1z = tris[i + 5] - az;
    const e2x = tris[i + 6] - ax, e2y = tris[i + 7] - ay, e2z = tris[i + 8] - az;
    // pvec = D x e2 = (-e2z, 0, e2x); det = e1 . pvec
    const det = e1z * e2x - e1x * e2z;
    const nx = e1y * e2z - e1z * e2y;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, det, nz);
    if (len < 1e-12 || Math.abs(det) / len < minUp) continue;
    const inv = 1 / det;
    const tx = x - ax, ty = y - ay, tz = z - az;
    const u = (-tx * e2z + tz * e2x) * inv;
    if (u < 0 || u > 1) continue;
    // qvec = tvec x e1; v = D . qvec = -qvec.y
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = -qy * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t < min || t > max) continue;
    if (best === null || t < best) best = t;
  }
  return best;
}

/**
 * How far the body is moved up (negative: down) from hanging with its eyes on the eye, so the pelvis sits PELVIS_OVER_SEAT
 * over the seat `drop` under the eye: `eyeOverPelvis + PELVIS_OVER_SEAT*scale - drop`, within ±LIFT_LIMIT, and in first
 * person no more than FIRST_PERSON_RAISE_MAX*scale up. 0 with no seat.
 */
export function bodyLift(drop: number | null, eyeOverPelvis: number, scale: number, firstPerson: boolean): number {
  if (drop === null || !Number.isFinite(drop)) return 0;
  let lift = eyeOverPelvis + PELVIS_OVER_SEAT * scale - drop;
  lift = Math.min(LIFT_LIMIT, Math.max(-LIFT_LIMIT, lift));
  if (firstPerson) lift = Math.min(lift, FIRST_PERSON_RAISE_MAX * scale);
  return lift;
}

/** The pelvis for the logs and spec.seat at scale 1, wheeled out: eye - EYE_OVER_PELVIS + (0, bodyLift(drop, 0.708, 1, false), 0). */
export function pelvisOnSeat(eye: Vec3, drop: number | null): Vec3 {
  const lift = bodyLift(drop, EYE_OVER_PELVIS[1], 1, false);
  return [eye[0] - EYE_OVER_PELVIS[0], eye[1] - EYE_OVER_PELVIS[1] + lift, eye[2] - EYE_OVER_PELVIS[2]];
}

/** A vector turned by a unit quaternion. */
function turn(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * (q.xyz x v); v' = v + w * t + q.xyz x t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

/** Where the figure's origin goes so its seated eye lands on `eye` moved by `offset` (hull frame): eye - q*(seatedEye - offset). */
export function riderOrigin(eye: Vec3, seatedEye: Vec3, q: Quat, offset: Vec3 = [0, 0, 0]): Vec3 {
  const r = turn(q, [seatedEye[0] - offset[0], seatedEye[1] - offset[1], seatedEye[2] - offset[2]]);
  return [eye[0] - r[0], eye[1] - r[1], eye[2] - r[2]];
}

/** A point in the frame a chain of joints hangs from: links parent first, each its local position and turn. */
export function chainPoint(links: readonly { p: Vec3; q: Quat }[], local: Vec3): Vec3 {
  let v: Vec3 = [local[0], local[1], local[2]];
  for (let i = links.length - 1; i >= 0; i--) {
    const r = turn(links[i].q, v);
    const p = links[i].p;
    v = [p[0] + r[0], p[1] + r[1], p[2] + r[2]];
  }
  return v;
}

/**
 * The first-frame links of a joint chain (parent first): each node's `<name>.position` track's first three values, else
 * its rest position, and `<name>.quaternion`'s first four, else its rest turn.
 */
export function clipLinks(chain: readonly { name: string; restP: Vec3; restQ: Quat }[], tracks: ReadonlyMap<string, ArrayLike<number>>): { p: Vec3; q: Quat }[] {
  return chain.map((n) => {
    const pt = tracks.get(`${n.name}.position`);
    const qt = tracks.get(`${n.name}.quaternion`);
    const p: Vec3 = pt && pt.length >= 3 ? [pt[0], pt[1], pt[2]] : [n.restP[0], n.restP[1], n.restP[2]];
    let q: Quat = qt && qt.length >= 4 ? [qt[0], qt[1], qt[2], qt[3]] : [n.restQ[0], n.restQ[1], n.restQ[2], n.restQ[3]];
    // A key is a unit quaternion in the file, but a tolerance in its encoding is normalised away.
    const l = Math.hypot(q[0], q[1], q[2], q[3]);
    if (l > 1e-9 && Math.abs(l - 1) > 1e-9) q = [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
    return { p, q };
  });
}

/**
 * The hovering cockpit's heading target after the mouse's sideways movement: started at the hull's heading, moved as the
 * orbit's yaw would be (heading - dx*k), and kept within COCKPIT_LEAD of the hull.
 */
export function cockpitYawStep(target: number | null, heading: number, mouseDX: number, k: number, lead = COCKPIT_LEAD): number {
  const t = (target ?? heading) - mouseDX * k;
  let d = t - heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  d = Math.min(lead, Math.max(-lead, d));
  return heading + d;
}
