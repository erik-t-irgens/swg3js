// A capsule swept through the world: whatever it touches that can be hurt is, once per `already`.
// The blades, the kicks, the thrown saber and the fists all hit this way.
import * as THREE from 'three';
import { RAPIER } from '../core/physics';
import type { Hittable, KitContext } from './kit';

const mid = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const quat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Hurt every creature a capsule between two points touches, each once per `already`; returns how many were hit this call. */
export function sweepCapsule(ctx: KitContext, from: THREE.Vector3, to: THREE.Vector3, radius: number, damage: number, already: Set<Hittable>, push = 5, color = 0x9fd4ff): number {
  const { player, world, physics, effects } = ctx;
  mid.copy(from).add(to).multiplyScalar(0.5);
  tmp.copy(to).sub(from);
  const len = Math.max(0.01, tmp.length());
  quat.setFromUnitVectors(UP, tmp.normalize());
  let hits = 0;
  physics.world.intersectionsWithShape(
    mid,
    quat,
    new RAPIER.Capsule(len / 2, radius),
    (collider) => {
      const c = world.hittableAt(collider.handle);
      // Aboard, the hull around the rooms is not a target: a fight inside must not cut the ship down.
      if (c && !already.has(c) && c !== player.aboard?.vehicle) {
        already.add(c);
        c.damage(damage * player.damageBoost, player.pos, push);
        tmp2.copy(c.pos).y += c.halfHeight;
        effects.burst(tmp2, color, 1.2, 0.2);
        effects.flash(tmp2, color, 10, 8, 0.15);
        hits++;
      }
      return true;
    },
    undefined,
    undefined,
    undefined,
    player.body,
  );
  return hits;
}
