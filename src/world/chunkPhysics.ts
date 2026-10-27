// A chunk's plantings stood up in the physics (the world's `addChunkPhysics` after the chunk's heightfield): a planting
// with the client's own shapes stands on them, exactly where they are (`floraCollision.ts`), and one the pack has no word on
// stands on the guess, one upright cylinder from half a metre under the ground at its foot to the top it was planted with.
// Out of `world.ts` so a node test stands the very colliders the world stands (`sculptFlora.test.ts`): a sculpt stroke's
// replant (Map-maker II) remakes them from plantings planted again on the new ground, and every collider must then stand on
// it -- remade from plantings that were not planted again, a raise would bury every trunk and a lower would leave every one
// an invisible wall.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties.

import type { Collider } from './props.ts';
import type { ColliderPart } from './floraCollision.ts';

/** What standing a planting's colliders asks of the physics (`Physics`). */
export interface PlantingPhysics<C> {
  createStaticPart(part: ColliderPart): C | null;
  createStaticCylinder(x: number, y: number, z: number, radius: number, halfHeight: number): C | null;
}

/** Every planting of a chunk as its colliders, pushed into `out` (after its heightfield, which the world puts first). */
export function plantingColliders<C>(physics: PlantingPhysics<C>, colliders: readonly Collider[], groundAt: (x: number, z: number) => number, out: C[]): C[] {
  for (const p of colliders) {
    // A planting with the client's own shapes stands on them, exactly where they are (`floraCollision.ts`).
    if (p.parts) {
      for (const part of p.parts) {
        const col = physics.createStaticPart(part);
        if (col) out.push(col);
      }
      continue;
    }
    const ground = groundAt(p.x, p.z) - 0.5;
    const halfH = (p.top - ground) / 2;
    const col = physics.createStaticCylinder(p.x, ground + halfH, p.z, p.r, halfH);
    if (col) out.push(col);
  }
  return out;
}
