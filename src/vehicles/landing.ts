// Ships on the ground: where a hull rests, how much slope it will take, and the ease onto it.
//
// The game's hulls carry one point under them, `landing1`, which we read as where the ship stands.
// That reading is ours: no player hull has gear in the client's files, so every ship rests on its
// belly. The point can sit far below the mesh (up to a couple of metres on the heaviest hulls),
// which would leave a ship standing on nothing, so the foot is never lower than the hull's own
// underside less `LANDING.gap`; a hull with no point rests on its underside with that same gap.
//
// Nothing here touches the world: the caller passes the floor it sampled and takes back a pose.
import * as THREE from 'three';

/**
 * Which ground rule a ship uses. 'landing' sets it down, holds it there and lets the engines be cut;
 * 'springs' is the older ride, where a slow ship hovers on its four springs and never rests. Live
 * through `__debug.landing({ rule: 'springs' })`, so the old behaviour can be had back at once if the
 * new one misbehaves on a hull.
 */
export const SHIP_GROUND: { rule: 'landing' | 'springs' } = { rule: 'landing' };

/**
 * The key that cuts a flying ship's engines (KeyboardEvent.code). It has no rebindable action of its
 * own yet, so it is read straight from the key rather than through the bindings.
 */
export const CUT_ENGINES_KEY = 'KeyJ';

/**
 * Invented numbers, all of them ours: the game never flew ships on a planet. Every one is live
 * through `__debug.landing({ ... })`.
 * - `gap`: the most a resting hull stands off the ground (m). The owner's choice.
 * - `tilt`: the steepest slope a ship will put down on (degrees); steeper is refused.
 * - `settle`: how long the ease onto the rest pose takes (s).
 * - `reach`: how near the floor the foot must be before a put-down begins (m).
 * - `catchLead`: how many seconds of its own fall a dropping hull is caught ahead of the floor by, so a
 *   fast fall is caught before it passes through the ground between two steps.
 * - `hold`: how long "down" is held at the bottom of the hover band before the ship puts down (s).
 * - `hard`: how fast a touch-down has to be (m/s) before it counts as a crash rather than a landing.
 * - `floorReach`: how far a floor ray looks down from the hull's middle (m): a hangar is tens of metres high.
 * - `spread`: the share of the footprint the four outer floor samples stand out at.
 * - `bandSlack`: how far over the bottom of its hover band a ship still counts as at the bottom of it (m).
 */
export const LANDING = {
  gap: 0.3,
  tilt: 20,
  settle: 1.2,
  reach: 3,
  catchLead: 0.15,
  hold: 0.35,
  hard: 8,
  floorReach: 120,
  spread: 0.45,
  bandSlack: 0.05,
};

/**
 * A ship standing in a building's rooms: how it is followed and how much room it wants. All three are
 * invented, and live through `__debug.landing({ ... })` with the rest.
 * - `every`: at most this often (s) is a ship's room looked for again, the mobiles' own rate.
 * - `step`: and at least every this far (m) it moves, the mobiles' own distance.
 * - `spare`: a room must hold a ship's box with this much to spare (m), all round, to stand it inside.
 */
export const SHIP_ROOM = {
  every: 0.25,
  step: 2,
  spare: 2,
};

/** A hull's extents as the spec carries them (the model's box). */
export interface HullBounds {
  min: readonly number[];
  max: readonly number[];
}

/**
 * Where the hull rests on the ground, in the hull's own frame: the `landing1` point when the model
 * carries one, kept between the hull's underside and `LANDING.gap` below it; the middle of the underside
 * with that gap when it carries none. The upper clamp matters as much as the lower: the runtime's box is
 * the assembled ship's, so a point that sits over the lowest thing hung under the hull would hold the
 * ship with that part in the ground.
 */
export function landingFoot(point: THREE.Vector3 | null, b: HullBounds, out: THREE.Vector3): THREE.Vector3 {
  const low = Math.min(b.min[1], b.max[1]);
  if (point) return out.set(point.x, Math.min(Math.max(point.y, low - LANDING.gap), low), point.z);
  return out.set((b.min[0] + b.max[0]) / 2, low - LANDING.gap, (b.min[2] + b.max[2]) / 2);
}

/**
 * The floor under a hull: in a building's rooms it is the room's own ray and nothing else (the terrain
 * runs under the building and is not its floor), outside it is whichever of the ray and the terrain is
 * higher (there is no collider on the open ground until the terrain's own chunk is in). -Infinity from
 * both means "no floor here", which every caller guards.
 */
export function floorUnder(inRoom: boolean, ray: number, terrain: number): number {
  return inRoom ? ray : Math.max(ray, terrain);
}

/**
 * A collider's Rapier interaction groups with only the filter half replaced: each collider keeps the
 * memberships it was made with, so switching a hull between the outside and the inside rule never
 * flattens what a part of it belongs to.
 */
export function withFilter(current: number, filter: number): number {
  return ((current & 0xffff0000) | (filter & 0x0000ffff)) >>> 0;
}

/**
 * How near the floor a hull coming down under its own weight is caught: its reach, or the distance it
 * would fall in `LANDING.catchLead` seconds when that is further, so a fast fall never steps through
 * the ground. `fall` is metres a second downward.
 */
export function catchDistance(fall: number): number {
  return Math.max(LANDING.reach, fall * LANDING.catchLead);
}

/** A floor fitted to the samples: y = a·x + b·z + c, in the world. */
export interface FloorPlane {
  a: number;
  b: number;
  c: number;
}

/**
 * Least squares fit of y = a·x + b·z + c through the samples (three or more). Samples that stand in
 * a line, or all at one spot, leave no slope to read: the fit is then flat at their mean height.
 * Returns false when there is nothing to fit at all.
 */
export function fitFloor(samples: readonly THREE.Vector3[], out: FloorPlane): boolean {
  const n = samples.length;
  out.a = 0;
  out.b = 0;
  out.c = 0;
  if (!n) return false;
  let sy = 0;
  for (const s of samples) sy += s.y;
  out.c = sy / n;
  if (n < 3) return true;
  let sxx = 0;
  let sxz = 0;
  let sx = 0;
  let szz = 0;
  let sz = 0;
  let sxy = 0;
  let szy = 0;
  for (const s of samples) {
    sxx += s.x * s.x;
    sxz += s.x * s.z;
    sx += s.x;
    szz += s.z * s.z;
    sz += s.z;
    sxy += s.x * s.y;
    szy += s.z * s.y;
  }
  // The 3x3 normal equations, by Cramer's rule.
  const m = [sxx, sxz, sx, sxz, szz, sz, sx, sz, n];
  const det = det3(m);
  // The samples stand in a line or at one point: no slope can be read, so the floor is flat at their mean.
  if (Math.abs(det) < 1e-9) return true;
  const rhs = [sxy, szy, sy];
  out.a = det3(replaceColumn(m, rhs, 0)) / det;
  out.b = det3(replaceColumn(m, rhs, 1)) / det;
  out.c = det3(replaceColumn(m, rhs, 2)) / det;
  return true;
}

function det3(m: readonly number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** A copy of the 3x3 with one column replaced (Cramer's rule); allocates, and is called only when a ship puts down. */
function replaceColumn(m: readonly number[], col: readonly number[], i: number): number[] {
  const out = m.slice();
  out[i] = col[0];
  out[i + 3] = col[1];
  out[i + 6] = col[2];
  return out;
}

/** The floor's height at a point. */
export function planeY(p: FloorPlane, x: number, z: number): number {
  return p.a * x + p.b * z + p.c;
}

/** The floor's upward normal. */
export function planeUp(p: FloorPlane, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-p.a, 1, -p.b).normalize();
}

/** How far the floor leans from level (rad). */
export function planeTilt(p: FloorPlane): number {
  return Math.acos(THREE.MathUtils.clamp(1 / Math.sqrt(p.a * p.a + 1 + p.b * p.b), -1, 1));
}

const upTmp = new THREE.Vector3();
const fwdTmp = new THREE.Vector3();
const rightTmp = new THREE.Vector3();
const axisTmp = new THREE.Vector3();
const footTmp = new THREE.Vector3();
const basis = new THREE.Matrix4();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Where a hull comes to rest on a fitted floor: its nose kept on the heading it had, its up turned to
 * the floor's normal, and its foot set on the floor under the place it stands. `maxTilt` is in radians;
 * a steeper floor is refused with null, unless `clamp` is set (a hull coming down with its engines cut
 * has nowhere else to go), where the pose leans as far as `maxTilt` and no further. Returns the tilt
 * taken, in radians.
 */
export function restPose(
  plane: FloorPlane,
  foot: THREE.Vector3,
  x: number,
  z: number,
  heading: number,
  maxTilt: number,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
  clamp = false,
): number | null {
  planeUp(plane, upTmp);
  let tilt = Math.acos(THREE.MathUtils.clamp(upTmp.y, -1, 1));
  if (tilt > maxTilt) {
    if (!clamp) return null;
    axisTmp.crossVectors(upTmp, WORLD_UP);
    if (axisTmp.lengthSq() > 1e-12) upTmp.applyAxisAngle(axisTmp.normalize(), tilt - maxTilt);
    else upTmp.copy(WORLD_UP);
    tilt = maxTilt;
  }
  // The nose on its heading, leaned onto the floor: right = up × forward, forward = right × up.
  fwdTmp.set(Math.sin(heading), 0, Math.cos(heading));
  rightTmp.crossVectors(upTmp, fwdTmp);
  if (rightTmp.lengthSq() < 1e-9) rightTmp.set(1, 0, 0);
  rightTmp.normalize();
  fwdTmp.crossVectors(rightTmp, upTmp).normalize();
  basis.makeBasis(rightTmp, upTmp, fwdTmp);
  outQuat.setFromRotationMatrix(basis);
  // The foot, turned as the hull will stand, lands on the floor under where the hull stands now.
  footTmp.copy(foot).applyQuaternion(outQuat);
  outPos.set(x, planeY(plane, x + footTmp.x, z + footTmp.z) - footTmp.y, z);
  return tilt;
}

const framePos = new THREE.Vector3();
const frameTurn = new THREE.Quaternion();
const frameScale = new THREE.Vector3();

/**
 * Where a held hull stands in the world: a pose in a frame (another object's live matrix, read every
 * step, so a hull carried by something that moves follows it exactly), or the pose itself when there
 * is no frame. Only the turn ignores the frame's scale: a hull is never stretched by what carries it,
 * but a scaled frame still places it where its own matrix says.
 */
export function heldPose(frame: THREE.Matrix4 | null, pos: THREE.Vector3, quat: THREE.Quaternion, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  if (!frame) {
    outPos.copy(pos);
    outQuat.copy(quat);
    return;
  }
  outPos.copy(pos).applyMatrix4(frame);
  frame.decompose(framePos, frameTurn, frameScale);
  outQuat.copy(frameTurn).multiply(quat);
}

/** The ease a settle follows, 0 to 1: still at both ends, so nothing jerks as the hull comes down. */
export function settleEase(t: number): number {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
}
