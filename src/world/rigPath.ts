// The arithmetic of a shuttle's rig flown as a hull rather than drawn from the clock.
//
// A shuttle's rig is a skeleton whose hull joint (the joint carrying its biggest piece: the shuttle's
// `root`, the transport's `hold_transport`) is what moves the whole ship; every other joint only
// folds a strut or opens a door relative to it. A hull flown in the world pins that joint at its
// model's origin and lets the clips pose the rest, so where the vehicle stands is the hull joint's
// pose in the rig's frame, carried onto the pad the clock rig stands on, with the framing offset
// the garage measured turned along with it:
//
//     P(t) = Pad × J(t) × T(offset)
//
// which is exactly where the clock rig draws the same hull at the same moment of the same clip, so
// the one can be swapped for the other and nobody sees it happen. Everything here is pure three, so
// node runs it (`rigHull.test.ts`), and nothing allocates per call but what says it does.

import * as THREE from 'three';
import type { RigPose } from './travelTerminal.ts';

/** One joint of the chain from the top of a rig's skeleton down to its hull joint, with its rest pose. */
export interface ChainLink {
  name: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Where a shuttle's pad is: its place and its turn about the vertical, as `ShuttleRigs.stand` stands one. */
export interface Pad {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const padTurn = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const linkPos = new THREE.Vector3();
const linkQuat = new THREE.Quaternion();

/**
 * A pose in a rig's own frame carried onto its pad, in place: turned by the pad's yaw and moved to its
 * place, which is what the clock rig's root group does to everything under it.
 */
export function onPad(pad: Pad, pos: THREE.Vector3, quat: THREE.Quaternion): void {
  padTurn.setFromAxisAngle(AXIS_Y, pad.yaw);
  pos.applyQuaternion(padTurn);
  pos.x += pad.x;
  pos.y += pad.y;
  pos.z += pad.z;
  quat.premultiply(padTurn);
}

/**
 * Where the vehicle stands, from where its hull joint stands: the joint's place plus the framing offset
 * turned with the joint. Its turn is the joint's own, since the joint is pinned at the model's origin
 * with no turn of its own. `outPos` may be `jPos`.
 */
export function vehicleFromJoint(jPos: THREE.Vector3, jQuat: THREE.Quaternion, offset: THREE.Vector3, outPos: THREE.Vector3): THREE.Vector3 {
  tmpV.copy(offset).applyQuaternion(jQuat).add(jPos);
  return outPos.copy(tmpV);
}

/**
 * Where a chain's last joint stands in the rig's frame at a moment of a clip: each link's own tracks
 * sampled with the interpolants the mixer itself uses, and its rest pose where the clip has none,
 * composed from the top down. With no clip, the chain at rest. Build-time arithmetic: every
 * interpolant it makes is made for the one call.
 */
export function chainPose(chain: readonly ChainLink[], clip: THREE.AnimationClip | null, seconds: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  outPos.set(0, 0, 0);
  outQuat.identity();
  for (const link of chain) {
    linkPos.copy(link.position);
    linkQuat.copy(link.quaternion);
    if (clip) {
      for (const track of clip.tracks) {
        const dot = track.name.lastIndexOf('.');
        if (track.name.slice(0, dot) !== link.name) continue;
        // The interpolant the mixer would bind for this track (three sets it up; its typings leave it out).
        const value = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant().evaluate(Math.min(Math.max(0, seconds), clip.duration));
        const property = track.name.slice(dot + 1);
        if (property === 'position') linkPos.fromArray(value);
        else if (property === 'quaternion') linkQuat.fromArray(value).normalize();
      }
    }
    outPos.add(linkPos.applyQuaternion(outQuat));
    outQuat.multiply(linkQuat);
  }
}

/** What poses one rig: its mixer, its action for each role, and the one playing now. */
export interface RigActions {
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<RigPose['role'], THREE.AnimationAction>>;
  current: THREE.AnimationAction | null;
}

/**
 * Put a role's clip on a rig's joints at `seconds`, held there: the clock rig's pose and the flown
 * hull's limbs, one way for both, so the struts and the door of the one are where they are on the
 * other. A role with no clip of its own for parking on the ground takes the landing's last instant,
 * which is the same pose.
 */
export function poseRigAction(state: RigActions, role: RigPose['role'], seconds: number): void {
  // Parked on the ground with no clip of its own for it: the landing's last instant is the same pose.
  let action = state.actions[role];
  if (!action && role === 'ground') {
    action = state.actions.land;
    if (action) seconds = action.getClip().duration;
  }
  if (!action) return;
  if (state.current !== action) {
    state.current?.stop();
    action.reset();
    action.play();
    state.current = action;
  }
  action.paused = true;
  action.time = Math.min(seconds, action.getClip().duration);
  state.mixer.update(0);
}
