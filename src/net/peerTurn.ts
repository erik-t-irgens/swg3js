// How another player's figure is turned between their states: toward the whole turn a state carries (`q`: aboard a
// hull, adrift in space, leaning on a grapple's rope), else to their heading about straight up.
//
// One trap is why this is a file of its own. A figure eased toward a whole turn has its Euler angles worked out from
// that turn in three's own order (XYZ), and that order hands back a yaw of 180 degrees less the heading, with a half
// turn about each of the other two axes, for any heading more than a quarter turn from nought. The glide that came
// before set the pitch and roll to nothing and read the heading off that yaw the frame a peer stopped sending `q`, so
// a figure facing past a quarter turn was shown mirrored (150 degrees drawn as about 48 a frame later), and a figure
// still leaning was stood upright in one frame. So a figure whose turn last came off the wire whole (`turned`) is eased
// upright on its heading as a whole turn, at the very rate of every other glide, and handed back to the heading's own
// glide only once it stands upright, with its yaw read off the turn itself. A browser built before this still mirrors
// such a figure; the sender's tail (`GRAPPLE_TUNE.leanTail`) is what keeps its tilt from snapping.
//
// Nothing here allocates: the target is one kept quaternion.
import * as THREE from 'three';

/** What the glide keeps of a figure between frames: whether its turn last came off the wire whole. */
export interface PeerTurnState {
  turned: boolean;
}

/** How near upright (the turn's x² + z², the sine of half the tilt squared) a figure is handed back to its heading: 0.01 degrees. */
export const UPRIGHT_EPS = 1e-8;

const UP = new THREE.Vector3(0, 1, 0);
const upright = new THREE.Quaternion();

/** The heading of a turn: the way it turns +Z, about straight up, radians (three's own sense, as `rotation.y`). */
export function yawOf(q: THREE.Quaternion): number {
  return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
}

/**
 * One frame of a peer figure's turn, `k` of the way (the glide's own `1 − exp(−dt / 0.1)`): toward `targetQ` when the
 * last state carried one, else upright on `heading`, as a whole turn while the figure is still `turned` and by its yaw
 * alone once it is upright.
 */
export function glidePeerTurn(obj: THREE.Object3D, targetQ: THREE.Quaternion | null, heading: number, k: number, s: PeerTurnState): void {
  if (targetQ) {
    obj.quaternion.slerp(targetQ, k);
    s.turned = true;
    return;
  }
  if (s.turned) {
    const q = obj.quaternion;
    upright.setFromAxisAngle(UP, heading);
    q.slerp(upright, k);
    if (q.x * q.x + q.z * q.z < UPRIGHT_EPS) {
      // Upright: the yaw read off the turn itself, never off the Euler angles three worked out from it.
      obj.rotation.set(0, yawOf(q), 0);
      s.turned = false;
    }
    return;
  }
  let diff = heading - obj.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  obj.rotation.set(0, obj.rotation.y + diff * k, 0);
}
