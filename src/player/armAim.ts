// An arm pointed along a direction over whatever the clip posed, and how much of it: the arithmetic of
// `CharacterRig.aimArm`, here on its own so a node test can load it (the rig itself reaches the page through
// imports node cannot follow). At a weight of 1 it is the rig's arithmetic as it always was, to the bit; under 1
// the upper arm and the forearm are eased from the clip's pose toward that aim by the weight, so the grapple's
// left arm can come up the rope and go back down without a snap; at nought nothing is touched.
//
// The scratch objects are kept here, so an aim a frame makes nothing.
import * as THREE from 'three';

const rootQ = new THREE.Quaternion();
const parentQ = new THREE.Quaternion();
const alignQ = new THREE.Quaternion();
const rollQ = new THREE.Quaternion();
const aimQ = new THREE.Quaternion();
const restWorld = new THREE.Vector3();
const dirWorld = new THREE.Vector3();

/**
 * Point the upper arm `upper` along `dir`, a direction in the root's own frame (+Z forward, +Y up), from its rest axis
 * `rest` (in that frame too): the bone's world turn is the turn from the rest axis to the direction times its bind
 * pose (`bindToRoot`, relative to the root), written in its parent's frame so it keeps its authored twist; `roll`
 * turns it about the direction. The forearm goes to its bind pose (`bindLocal`). `weight` is how much of that aim
 * is laid over the clip's pose: 1 the aim outright, nought nothing at all. Call after the rig's update, with world
 * matrices current.
 */
export function aimArmBones(
  root: THREE.Object3D,
  upper: THREE.Object3D,
  fore: THREE.Object3D | null,
  rest: THREE.Vector3,
  bindToRoot: THREE.Quaternion,
  bindLocal: THREE.Quaternion | null,
  dir: THREE.Vector3,
  roll = 0,
  weight = 1,
): void {
  if (!(weight > 0) || !upper.parent) return;
  // The rest axis is known in root space, so the world rest axis is the root's rotation applied to it.
  root.getWorldQuaternion(rootQ);
  upper.parent.getWorldQuaternion(parentQ);
  restWorld.copy(rest).applyQuaternion(rootQ);
  dirWorld.copy(dir).applyQuaternion(rootQ).normalize();
  alignQ.setFromUnitVectors(restWorld, dirWorld);
  if (roll !== 0) alignQ.multiply(rollQ.setFromAxisAngle(dirWorld, roll));
  // World rotation = align × the bone's bind-pose world rotation, expressed in the parent's frame,
  // so the bone keeps its authored twist and only the arm direction changes.
  if (weight >= 1) {
    upper.quaternion.copy(parentQ).invert().multiply(alignQ).multiply(rootQ).multiply(bindToRoot);
    if (fore && bindLocal) fore.quaternion.copy(bindLocal);
    return;
  }
  aimQ.copy(parentQ).invert().multiply(alignQ).multiply(rootQ).multiply(bindToRoot);
  upper.quaternion.slerp(aimQ, weight);
  if (fore && bindLocal) fore.quaternion.slerp(bindLocal, weight);
}
