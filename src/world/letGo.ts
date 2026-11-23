// What the world takes down for good is let go by three's WebGPU renderer too (pass 2, wave 5, agent P: the lag).
//
// Three's WebGPU renderer keeps every render object it ever made in a strong set (`RenderObjects._renderObjects`), and each
// render object hangs a `dispose` listener on its material, on the material a pass draws it with in its stead (the shadow
// pass's), and on the scene's lights node; it lets one go only when its object, its material or its lights node dispatches
// `dispose`. Taking a mesh out of the scene, or disposing its geometry, lets nothing go. So a mesh drawn once and taken down for
// good while its material lives on -- a terrain chunk's ground and its far tiles on the session's tile material, every caster
// on the shadow pass's own material -- was held for the session, and through `parent` its whole group with every sibling and
// their arrays: after six world loads the base held 2,777 such chunk groups (19,616 meshes, Endor's flora on Tatooine) and the
// live meshes had gone from 12,402 to 28,842 at the same view.
//
// `letGoDrawn` dispatches three's own `dispose` event (what three 0.187's `Object3D.dispose` does, and nothing more: it frees
// no geometry, material or texture, which may be shared) on every object under a root the world has taken down for good, so
// three lets its render objects go; on WebGL it does nothing (WebGL keeps no such set, and the old lines stand as they were).
// Never on a stand-in or a cached prototype that will be drawn again: its render objects are what keep its pipelines.

import * as THREE from 'three';
import { GPU } from '../core/gpuSwitch.ts';

/** Three's `dispose` event, one object for every dispatch (three writes its `target` and reads nothing else of it). */
const DISPOSE_EVENT = { type: 'dispose' } as const;

/** How many objects have been let go this session, for the console (`__debug.gpu()`'s report is the runtime's; this is the world's). */
export const LET_GO_STATS = { roots: 0, objects: 0 };

/** One object let go: three's render objects of it disposed. */
function letGoOne(o: THREE.Object3D): void {
  (o as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent(DISPOSE_EVENT);
  LET_GO_STATS.objects++;
}

/**
 * Every object under `root` (the root too) let go by three's WebGPU renderer, after the world has taken it out of the scene
 * for good; nothing on WebGL. Answers how many objects were let go. Not for a frame: it walks the subtree.
 */
export function letGoDrawn(root: THREE.Object3D | null | undefined): number {
  if (!root || !GPU.webgpu) return 0;
  const before = LET_GO_STATS.objects;
  root.traverse(letGoOne);
  LET_GO_STATS.roots++;
  return LET_GO_STATS.objects - before;
}

/**
 * A keeper for a kind of mesh the world takes down and makes again on one material (the fixer of pass 2, wave 5). Three
 * releases a pipeline when the last render object drawn with it is let go (`Pipelines.delete`, at `usedTimes` 0), so where
 * every mesh of a kind can go at once -- a teleport on one planet drops every ground chunk together -- the next one made
 * would build its pipeline by a draw in play, its material being one the world has long since compiled. The keeper is
 * three vertices laid out exactly as `like`'s geometry (each attribute's name, array kind, width and normalisation, and its
 * index's kind: what three's vertex layout key reads), on `like`'s material, casting and receiving as it does, never in the
 * scene and never culled. Compiled behind every loading screen with the world's other stand-ins and never let go, its render
 * objects hold the pipelines its kind is drawn with. Null where `like`'s geometry is interleaved (no ground is made so).
 */
export function keeperLike(like: THREE.Mesh): THREE.Mesh | null {
  const src = like.geometry;
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const a = src.attributes[name] as THREE.BufferAttribute;
    if ((a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute === true) {
      g.dispose();
      return null;
    }
    const Kind = a.array.constructor as unknown as new (n: number) => Float32Array;
    g.setAttribute(name, new THREE.BufferAttribute(new Kind(3 * a.itemSize), a.itemSize, a.normalized));
  }
  if (src.index) {
    const Kind = src.index.array.constructor as unknown as new (n: number) => Uint32Array;
    const ix = new Kind(3);
    ix[1] = 1;
    ix[2] = 2;
    g.setIndex(new THREE.BufferAttribute(ix, 1));
  }
  const k = new THREE.Mesh(g, like.material);
  k.name = 'ground keeper';
  k.castShadow = like.castShadow;
  k.receiveShadow = like.receiveShadow;
  k.frustumCulled = false;
  return k;
}
