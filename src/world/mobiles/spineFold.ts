// The spine fold: turning a body's chest about its own vertical (and tilting it forward) on top of
// whatever clip is posing it, so that a mobile holding a blaster can point the weapon where its
// shot is really going while its legs go on doing what they were doing.
//
// It is `CharacterRig.twistTorso` (`src/player/rig.ts`) with the rig taken out of it. The rig
// cannot be borrowed: a mobile has a bare `AnimationMixer` over a cloned skeleton and no rig at
// all, and giving every catalogue body a rig is 200 MB of clips apiece. So the arithmetic is the
// player's, copied once into a module that has nothing in it but three, and a node test drives the
// very function the game runs.
//
// The one thing here that is not obvious, and that is the whole reason for the per-bone record: a
// clip may key no track at all for a joint it never moves, so a bone can come out of the mixer
// still holding **last frame's folded value**. Fold that again and the turn compounds, frame on
// frame, until the chest is wound right round. The record says what the fold last wrote and what it
// wrote it on top of, and a bone whose quaternion is still exactly what the fold left has its clean
// value put back before this frame's fold goes on.
//
// Allocation-free: the six quaternions are module-level and written in place, and the only thing
// ever made is one small record per bone, the first time that bone is folded.
//
// Rule for this file (it is run by node with type stripping for the tests): value imports from
// three only, no enum, no namespace, no constructor parameter properties.
import * as THREE from 'three';

const foldQ = new THREE.Quaternion();
const pitchQ = new THREE.Quaternion();
const rootQ = new THREE.Quaternion();
const rootInvQ = new THREE.Quaternion();
const parentQ = new THREE.Quaternion();
const alignQ = new THREE.Quaternion();

const UP = new THREE.Vector3(0, 1, 0);
/** The body's own right, which the tilt turns about: positive bends the chest forward and down. */
const RIGHT = new THREE.Vector3(1, 0, 0);

/** Which bones the fold is spread over. The rig's own rule, so a body folds where the player does. */
export const SPINE_BONE = /^spine_?[1-3]$/i;

/**
 * How far the fold may turn and tilt the chest, in radians. The rig's own clamps, which are not
 * the aim's: the aim's own caps (`STANCE_TUNE.maxYaw`, `spineMax`) decide how much of the
 * correction is offered here, and these decide what a spine will physically take.
 */
export const FOLD_YAW_MAX = 1.2;
export const FOLD_PITCH_MAX = 0.9;

/** What the fold last wrote on one bone, and what it wrote it on top of. One per bone, made once. */
export interface FoldRecord {
  clean: THREE.Quaternion;
  folded: THREE.Quaternion;
}

// Which bones a body's spine is has one home and it is `SPINE_BONE` above. There is deliberately no
// `spineBonesOf` here: the game collects them inside the one walk `Mobile.attach` already takes over
// the fresh clone, so a second walk of its own would be a second implementation to keep in step and
// the node test would be driving the one the game does not run.

/**
 * Fold `spines` by `angle` about `root`'s vertical and `pitch` about its right, sharing both
 * equally between them, and update each bone's world matrix so whatever hangs off it (an arm, a
 * hand, the weapon in it) has moved by the time anything reads it.
 *
 * `root` is the frame the turn is expressed in -- the body's own group, so the fold is about the
 * body's up and right whatever the animation has done to the hips. `folded` is the caller's own
 * map, kept for the life of the body.
 *
 * Returns the yaw it really applied, after the clamp, which is what anything measuring the chest
 * (a head that looks on top of it) would have to take off.
 */
export function foldSpine(spines: readonly THREE.Bone[], root: THREE.Object3D, folded: Map<THREE.Bone, FoldRecord>, angle: number, pitch: number): number {
  if (!spines.length) return 0;
  const yaw = Math.max(-FOLD_YAW_MAX, Math.min(FOLD_YAW_MAX, angle));
  const tilt = Math.max(-FOLD_PITCH_MAX, Math.min(FOLD_PITCH_MAX, pitch));
  const each = yaw / spines.length;
  const eachPitch = tilt / spines.length;
  root.getWorldQuaternion(rootQ);
  rootInvQ.copy(rootQ).invert();
  foldQ.setFromAxisAngle(UP, each);
  if (eachPitch !== 0) foldQ.multiply(pitchQ.setFromAxisAngle(RIGHT, eachPitch));
  let touched = false;
  for (const bone of spines) {
    const parent = bone.parent;
    if (!parent) continue;
    let rec = folded.get(bone);
    if (!rec) {
      rec = { clean: new THREE.Quaternion(), folded: new THREE.Quaternion() };
      folded.set(bone, rec);
    } else if (bone.quaternion.equals(rec.folded)) {
      // Still holding what the fold wrote, so the clip keyed nothing for it: put the clip's own
      // value back before folding again. Unwinding a real turn is itself a change.
      if (!rec.folded.equals(rec.clean)) touched = true;
      bone.quaternion.copy(rec.clean);
    }
    rec.clean.copy(bone.quaternion);
    if (each !== 0 || eachPitch !== 0) {
      // The turn is about the body's axes, expressed in this bone's parent frame. The inverse is
      // the kept one, never a fresh quaternion: this runs per spine bone per frame per armed body.
      parent.getWorldQuaternion(parentQ);
      alignQ.copy(parentQ).invert().multiply(rootQ).multiply(foldQ).multiply(rootInvQ).multiply(parentQ);
      bone.quaternion.premultiply(alignQ);
      touched = true;
    }
    rec.folded.copy(bone.quaternion);
  }
  // And now the world matrices, in **one** pass rather than one a bone, and only when a bone
  // really moved. Forcing a bone's subtree is the expensive half of all this -- everything above
  // the waist, some fifty nodes on a person -- and doing it inside the loop does that work once
  // for each spine bone, three times over, since each one's subtree contains the next. So it is
  // done here, for the bones whose parent is not itself a spine bone: on a spine that is a chain
  // (every skeleton here) that is the lowest one alone and it covers the rest, and a spine of
  // siblings would simply take one pass apiece.
  //
  // The bones' own matrices are already right by then: `getWorldQuaternion` above updates a bone's
  // parents and itself as it reads them, so each was made current when the next asked for it.
  //
  // `touched` is what makes a body standing with its weapon down free: nothing was folded last
  // frame and nothing is folded this one, so there is nothing to compose and the renderer's own
  // pass over the scene does what it always did.
  if (touched) for (const bone of spines) if (!bone.parent || spines.indexOf(bone.parent as THREE.Bone) < 0) bone.updateMatrixWorld(true);
  return yaw;
}
