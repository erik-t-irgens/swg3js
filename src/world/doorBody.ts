// A door leaf's body in the engine, apart from the meshes and the packs so a node test makes the very
// body the game makes and moves it the very way the game does (`doors.ts` is the only other caller).
//
// A leaf is one kinematic body with one box, made once and moved, never added or taken away as the door
// opens and shuts. It is a member of the rooms' group, which the walkers indoors keep and the walkers
// outdoors take with everything else, while the roof over the rain and the doorway's sun ray leave it out;
// and it is marked a wall (`Physics.markWall`), so whatever stops only at what stands still -- a fighter's
// character controller, the camera, a gunner's line of fire, a corpse -- stops at it while it is shut.
import * as THREE from 'three';
import { Group, groups, RAPIER, type Physics } from '../core/physics.ts';

/** The collision groups of every door leaf: a member of the rooms' group, meeting everything. */
export const DOOR_LEAF_GROUPS = groups(Group.interior, Group.all);

/** The box a leaf's body is made of, in the leaf's own frame: its middle and its half sizes. */
export interface LeafBox {
  readonly mid: readonly number[];
  readonly half: readonly number[];
}

const tmpQ = new THREE.Quaternion();

/**
 * A leaf's kinematic body and its one box, standing at `at` (the leaf's matrix: its turn and its place),
 * marked a wall, and enabled as `solid` says. Made once per leaf, when the door is first shown.
 */
export function makeLeafBody(physics: Physics, at: THREE.Matrix4, box: LeafBox, solid: boolean): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const w = physics.world;
  const e = at.elements;
  tmpQ.setFromRotationMatrix(at);
  const body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(e[12], e[13], e[14]).setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }));
  const desc = RAPIER.ColliderDesc.cuboid(box.half[0], box.half[1], box.half[2]).setTranslation(box.mid[0], box.mid[1], box.mid[2]).setCollisionGroups(DOOR_LEAF_GROUPS).setFriction(0.5);
  const collider = w.createCollider(desc, body);
  collider.setEnabled(solid);
  physics.markWall(collider, true);
  return { body, collider };
}

/**
 * A leaf's body to a new place. Sliding (`jump` false) it is the engine's next kinematic place, so the
 * step moves it there and anything it meets on the way is pushed as a door pushes. Jumping, it is put
 * there outright with no velocity at all: a door's first step stands it as the bodies near it say,
 * which may be fully open, and a body made shut and then slid open in one step would sweep the whole
 * slide in a sixtieth of a second and shove whoever was standing in the doorway at a hundred metres a
 * second. `at` is copied out of at the call.
 */
export function moveLeafBody(body: RAPIER.RigidBody, at: { x: number; y: number; z: number }, jump: boolean): void {
  if (jump) body.setTranslation(at, true);
  else body.setNextKinematicTranslation(at);
}

/** A leaf's body out of the engine: its wall mark first, and the body only while the world still holds it. */
export function takeLeafBody(physics: Physics, body: RAPIER.RigidBody | null, collider: RAPIER.Collider | null): void {
  if (collider) physics.markWall(collider, false);
  // Once, and never from a world already broken: a body the world no longer holds removed again is a panic.
  if (body) physics.removeBody(body);
}
