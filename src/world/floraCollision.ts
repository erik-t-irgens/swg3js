// What a world's trees and rocks are solid at: the shapes the client authored for each one, hung on
// every planting, with the old guess kept for a pack that has none.
//
// The shapes, the guess, a permanent row's parts and the file's merge are `floraShapes.ts` (pure, imports nothing, so the
// walk grid's bake, which ships, stands a permanent flora row exactly as the game does: Map-maker II's fifth wave moved
// them there unchanged), named here as they always were. What is here is the planter's half: a chunk's plantings made
// colliders.
//
// Nothing here runs per frame: a chunk's colliders are worked out once, when it is planted, and again only when the
// console moves the rule.

import type { FloraChunkData } from './floraBatch.ts';
import type { Collider } from './props.ts';
import { FLORA_COLLISION, guessRadius, shapeParts, trunkRadius, type ColliderPart, type FloraCollision } from './floraShapes.ts';

export {
  FLORA_COLLISION,
  FLORA_COLLISION_DEFAULTS,
  FLORA_COLLISION_VERSION,
  guessRadius,
  mergeFloraCollision,
  modelExtentOf,
  rowFloraParts,
  shapeParts,
  trunkRadius,
} from './floraShapes.ts';
export type { ColliderPart, FloraCollision, FloraShape } from './floraShapes.ts';

/** How far a part reaches across the ground from (x, z), and how high its top stands. */
function reachOf(p: ColliderPart, x: number, z: number): { across: number; top: number } {
  const off = Math.hypot(p.x - x, p.z - z);
  if (p.kind === 'cyl') return { across: off + p.r, top: p.y + p.hy };
  if (p.kind === 'ball') return { across: off + p.r, top: p.y + p.r };
  if (p.kind === 'box') return { across: off + Math.hypot(p.hx, p.hz), top: p.y + p.hy };
  let across = 0;
  let top = -Infinity;
  const v = p.verts!;
  for (let k = 0; k < v.length; k += 3) {
    across = Math.max(across, Math.hypot(v[k] - x, v[k + 2] - z));
    top = Math.max(top, v[k + 1]);
  }
  return { across, top };
}

/**
 * Every collidable planting of a chunk as its colliders, into `out`. A planting whose model the pack
 * has the client's shapes for stands on them (`parts`); one the client walked through stands on
 * nothing (or on the guess's trunk, with `nullTrunk`); one the pack has no word on stands on the
 * guess, the one upright cylinder it always did. `r` and `top` are kept on every collider, for the
 * console's list: how far across the ground it reaches from the planting, and its top.
 */
export function floraColliders(data: FloraChunkData, out: Collider[] = [], t = FLORA_COLLISION): Collider[] {
  for (let i = 0; i < data.n; i++) {
    if (!data.collidable[i]) continue;
    const model = data.models[i];
    const s = data.scale[i];
    const x = data.x[i];
    const y = data.y[i];
    const z = data.z[i];
    const r = model.radius * s;
    const h = model.height * s;
    // A model with no def at all (a stand-in) is no word, and is guessed.
    const c = t.rule === 'client' ? (model.def as { collision?: FloraCollision } | undefined)?.collision : undefined;
    if (!c) {
      out.push({ x, z, r: guessRadius(r, h, t), top: y + h });
      continue;
    }
    if (!c.shapes.length) {
      if (t.nullTrunk && h > t.treeRatio * r) out.push({ x, z, r: trunkRadius(r, t), top: y + h });
      continue;
    }
    const parts = shapeParts(c.shapes, data.mats, i * 16, s);
    if (!parts.length) continue;
    let across = 0;
    let top = -Infinity;
    for (const p of parts) {
      const e = reachOf(p, x, z);
      across = Math.max(across, e.across);
      top = Math.max(top, e.top);
    }
    out.push({ x, z, r: across, top, parts });
  }
  return out;
}
