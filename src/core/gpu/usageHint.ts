// The game's `DynamicDrawUsage` hint, not kept on WebGPU (the GPU port's step 3).
//
// The game marks an attribute it rewrites in play `DynamicDrawUsage` (a level group's copies, a flora batch's, the far
// tiles' cut, a trail, the rope, the landmarks) and bumps its version at every write, as WebGL needs: on WebGL the hint is
// only what `bufferData` is told. Three's WebGPU renderer reads it otherwise: an attribute of that usage is written to the
// GPU again in full every render call that draws it whether it changed or not (`Attributes.update`), and an instanced mesh
// whose matrices carry it is refreshed in full on every draw and every replay of a bundle that holds it
// (`NodeMaterialObserver.hasDynamicInstancing`). Measured at Mos Eisley's street in one session, turn about: the render
// call's median 10.3 to 10.7 ms with the hint kept, 6.0 ms without it. So on WebGPU the hint is dropped as it is set
// (`BufferAttribute.setUsage`, a public method, on the prototype the game's attributes share, set before any world is
// made), and an attribute is written to the GPU when its version moves, as on WebGL; three's own dynamic nodes set their
// usage on their own `InterleavedBuffer` or assign the field directly, so nothing of three's is touched.
//
// Its switch: `localStorage['swg.gpu.dynamicHint'] = '1'` and a reload keeps the hint; `__debug.gpu({ dynamicHint: true })`
// puts it back live on every attribute the scene holds that it was dropped from (one walk, the console's), and `false`
// drops it again.

import * as THREE from 'three';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Whether the hint is kept (the switch), and how many times a set of it was dropped. */
export const USAGE_HINT = { kept: false, dropped: 0 };

/** Every attribute the hint was dropped from, by itself, so the live switch can find them (weakly: nothing is held). */
const droppedFrom = new WeakSet<object>();

export function installUsageHint(): void {
  try {
    if (localStorage.getItem('swg.gpu.dynamicHint') === '1') USAGE_HINT.kept = true;
  } catch {
    // Storage refused: the default.
  }
  const proto = THREE.BufferAttribute.prototype as Any;
  const setUsage = proto.setUsage as (this: THREE.BufferAttribute, u: number) => THREE.BufferAttribute;
  proto.setUsage = function (this: THREE.BufferAttribute, u: number): THREE.BufferAttribute {
    if (u === THREE.DynamicDrawUsage && !USAGE_HINT.kept) {
      USAGE_HINT.dropped++;
      droppedFrom.add(this);
      return setUsage.call(this, THREE.StaticDrawUsage);
    }
    return setUsage.call(this, u);
  };
}

/** The switch moved live: the hint put back on, or dropped again from, every attribute of the scene it was dropped from. */
export function setUsageHint(scene: THREE.Object3D | null, kept: boolean): { kept: boolean; attributes: number } {
  USAGE_HINT.kept = kept;
  let n = 0;
  const set = (a: Any): void => {
    if (!a || !droppedFrom.has(a)) return;
    a.usage = kept ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage;
    n++;
  };
  scene?.traverse((o: Any) => {
    if (o.isInstancedMesh) {
      set(o.instanceMatrix);
      set(o.instanceColor);
    }
    const g = o.geometry;
    if (g?.attributes) {
      for (const k in g.attributes) set(g.attributes[k]);
      set(g.index);
    }
  });
  return { kept, attributes: n };
}
