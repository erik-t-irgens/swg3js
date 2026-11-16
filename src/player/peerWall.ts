// Another player's figure on a wall, and another player's hands bracing (wave 4 of the animations, item B): their game
// holds the face and sends only its rig state (`wallUp`, `wallStill` and the rest, src/player/wallClimb.ts) with the place
// their body is held at; this side plays the same clip at the rate the state's speed asks, draws their figure leant into
// a face found here in front of it and lined up on it as their own game lines it up, and within `ik.peerReach` of the
// camera puts its hands and feet on that face by the same solves as this player's own (`WallClimb.peerFace`,
// `limbsFor`). Their bracing is this side's own rule over their figure (src/player/brace.ts): what their hands hold and
// their state say what may brace, their glided travel says how they move, and the walls and bodies are this world's.
//
// Nothing is made on a frame; the face's ray is cast only while their figure moves.

import * as THREE from 'three';
import { WallClimb, isWallState } from './wallClimb.ts';
import type { LedgeWorld } from './ledge.ts';
import type { LimbPlace, LimbRig, LimbWorld } from './limbPlace.ts';
import type { RAPIER } from '../core/physics.ts';
import type { PeerHangIn } from './peerHang.ts';

const AXIS_X = new THREE.Vector3(1, 0, 0);

export class PeerWall {
  readonly wall: WallClimb;
  readonly limbs: LimbPlace;
  /** The root's offset and lean put on last frame (taken back off before anything writes the root again, `undo`). */
  private onY = 0.5;
  private rooted = false;
  /** Their body as the climb reads it: its feet's place (and a velocity nobody reads). */
  private readonly body = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } };

  constructor(makeRay: () => RAPIER.Ray, makeCapsule: (h: number, r: number) => RAPIER.Shape, limbs: LimbPlace) {
    this.wall = new WallClimb({ ray: makeRay, capsule: makeCapsule });
    this.limbs = limbs;
    this.onY = 0;
  }

  /** The offset and lean put on the root last frame taken back off (before the swim's sink and the feet's drop write it again). */
  undo(root: THREE.Object3D): void {
    if (!this.rooted) return;
    root.position.x = 0;
    root.position.z = 0;
    root.position.y -= this.onY;
    root.quaternion.set(0, 0, 0, 1);
    this.onY = 0;
    this.rooted = false;
  }

  /**
   * A frame of their figure, after it is posed and placed: on a wall, the root's offset and lean for the climb's clip, and
   * within reach its hands and feet on the face (`q`: their rig state, place, heading and size, the camera's reach).
   */
  step(rig: LimbRig, world: (LedgeWorld & LimbWorld) | null, q: PeerHangIn): void {
    const W = this.wall;
    if (!isWallState(q.state) || !world) {
      if (W.hands > 0 || W.drawn) W.peerOff(q.dt);
      return;
    }
    const b = this.body;
    b.pos.x = q.x;
    b.pos.y = q.y;
    b.pos.z = q.z;
    const found = W.peerFace(world, q.x, q.y, q.z, q.heading, q.scale, q.filter, q.state, q.dt, b);
    if (!found) return;
    const c = Math.cos(q.heading);
    const s = Math.sin(q.heading);
    const root = rig.root;
    root.position.x = W.offX * c - W.offZ * s;
    root.position.y += W.offY;
    root.position.z = W.offX * s + W.offZ * c;
    root.quaternion.setFromAxisAngle(AXIS_X, W.lean);
    this.onY = W.offY;
    this.rooted = true;
    if (!q.near) return;
    root.updateMatrixWorld(true);
    this.limbs.filter = q.filter;
    W.limbsFor(this.limbs, rig, world, null);
    // The hands' anchor moves the root too (taken back off with the offset).
    this.onY += W.lifted;
    this.limbs.place(rig, world, null);
  }
}
