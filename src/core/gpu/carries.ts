// What the node copies three makes of the game's materials already carry, checked rather than rebuilt (the GPU port's
// step 4, item 5), and what stays as step 3 left it. This module runs on WebGPU alone (reached by step 3's one dynamic
// import, through `start.ts`).
//
// Three 0.187 makes a node copy of a classic material by copying every enumerable field of it onto a fresh node material
// (`NodeLibrary.fromMaterial`: `for (const key in material) nodeMaterial[key] = material[key]`), and its nodes read the
// material's maps, colours and strengths through reference nodes that look at the render object's own material, which is
// the classic one, at every render: so what the game writes on the classic material in play (a flip-book's picture, a
// scroll's offset, an environment's strength) reaches the picture without the copy being made again, while the pipeline's
// state (blending, depth write, polygon offset, the stencil reference) is read off the classic material at each draw.
//
// The check here makes a throwaway copy by three's own method (the prototype's, past the looks' wrap, so no part of ours
// is put on it and nothing is counted) of up to `CARRY_SAMPLE` materials of each kind the scene holds now and compares the
// fields each kind depends on. Nothing is built: a copy is never compiled, and is dropped.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

import * as THREE from 'three/webgpu';
import { isFlatNormal } from '../../world/personKeys.ts';

/** How many materials of a kind are compared at most (a scene holds thousands; the kinds' rules are the same for all). */
export const CARRY_SAMPLE = 40;

/** One kind of material the node copy must carry: how a material is told to be one, and the fields compared. */
interface Kind {
  name: string;
  /** What the game's WebGL path does with this kind, and why the copy carries it. */
  says: string;
  is(m: Any): boolean;
  /** The fields that must be the same object or value on the copy; a colour compared by `equals`. */
  fields: readonly string[];
  /** A further check of the copy's own, past the fields (the class three chose). */
  extra?(m: Any, copy: Any): string | null;
}

const KINDS: readonly Kind[] = [
  {
    name: 'person keys',
    says: 'the superset a skinned or racked material is given at adoption (a flat float normal map, white roughness and metalness, the environment at nought): carried as the same textures and strength, so the copy draws what the classic did',
    is: (m) => m.isMeshStandardMaterial === true && isFlatNormal(m),
    fields: ['normalMap', 'roughnessMap', 'metalnessMap', 'envMap', 'envMapIntensity', 'normalScale'],
  },
  {
    name: 'emissive splits',
    says: "a glow split from its picture into an emissive map (the converter's): the map, the colour and the strength carried",
    is: (m) => !!m.emissiveMap,
    fields: ['emissiveMap', 'emissive', 'emissiveIntensity', 'map'],
  },
  {
    name: 'unlit',
    says: "a KHR_materials_unlit material (`userData.unlit`): three's basic material, a basic node material on WebGPU",
    is: (m) => m.userData?.unlit === true,
    fields: ['map', 'color', 'transparent', 'blending', 'fog'],
    extra: (m, copy) => (m.isMeshBasicMaterial && !copy.isMeshBasicNodeMaterial ? `copy is ${copy.type}` : null),
  },
  {
    name: 'decals',
    says: "a decal (`userData.decal`): blended, no depth write, cut where wholly clear, held over what it lies on by a polygon offset; the pipeline reads these off the classic material at each draw",
    is: (m) => m.userData?.decal === true,
    fields: ['transparent', 'depthWrite', 'blending', 'alphaTest', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'castShadow'],
  },
  {
    name: 'flip-books and scrolls',
    says: "a flip-book's picture swapped and a scroll's offset moved in play (`userData.swgTrack`, `swgScroll`): the copy's texture node reads the classic material's map at every render and the texture's own matrix, so neither needs the copy made again",
    is: (m) => !!m.userData?.swgTrack || Array.isArray(m.userData?.swgScroll),
    fields: ['map', 'emissiveMap', 'alphaMap'],
  },
  {
    name: 'stencil reference',
    says: "the portal renderer's one reference, read through the accessor on Material.prototype (`stencilRef.ts`), which a node copy inherits, and read off the classic material by the pipeline at each draw",
    is: (m) => m.stencilWrite === true || m.stencilFunc !== THREE.AlwaysStencilFunc || m._portalRefShared === true,
    fields: ['stencilRef', 'stencilWrite', 'stencilFunc', 'stencilFail', 'stencilZFail', 'stencilZPass', 'stencilFuncMask', 'stencilWriteMask'],
  },
];

const same = (a: Any, b: Any): boolean => {
  if (a === b) return true;
  if (a && b && typeof a.equals === 'function' && a.constructor === b.constructor) return a.equals(b);
  return Number.isNaN(a) && Number.isNaN(b);
};

/** What each kind carries, over the scene as it stands. */
export function carriesReport(renderer: Any, scene: THREE.Object3D | null): Record<string, unknown> {
  const lib = renderer?.library;
  const own = lib ? Object.getPrototypeOf(lib)?.fromMaterial : null;
  if (!scene || typeof own !== 'function') return { checked: false, why: 'no scene, or three has no node library here' };
  const materials = new Set<Any>();
  scene.traverse((o: Any) => {
    const m = o.material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) if (x && !x.isNodeMaterial && !x.isShaderMaterial) materials.add(x);
  });
  const out: Record<string, unknown> = {};
  for (const k of KINDS) {
    let found = 0;
    let checked = 0;
    let carried = 0;
    const misses: string[] = [];
    for (const m of materials) {
      if (!k.is(m)) continue;
      found++;
      if (checked >= CARRY_SAMPLE) continue;
      checked++;
      const copy = own.call(lib, m);
      if (!copy) {
        misses.push(`${m.name || m.type}: three has no node class for ${m.type}`);
        continue;
      }
      const bad = k.fields.filter((f) => !same(m[f], copy[f]));
      const more = k.extra?.(m, copy) ?? null;
      if (!bad.length && !more) carried++;
      else if (misses.length < 6) misses.push(`${m.name || m.type}: ${[...bad, ...(more ? [more] : [])].join(', ')}`);
    }
    out[k.name] = { found, checked, carried, misses, says: k.says };
  }
  return { checked: true, materials: materials.size, by: "three's own NodeLibrary.fromMaterial, past the looks' wrap; nothing built", kinds: out };
}

/** What stays as step 3 left it on WebGPU (the report's `stays`), in words. */
export const STAYS: Readonly<Record<string, string>> = {
  wetness: "the rain's wet look is an onBeforeCompile wrap (`wetness.ts`), which a node copy never runs: no surface wets on WebGPU (a remake of the owner's)",
  sway: "the flora sway is an onBeforeCompile wrap (`floraSway.ts`) with depth materials of its own: nothing sways on WebGPU, and a swaying mesh casts through three's own depth (a remake of the owner's)",
  ground: "the ground's tile program is a ShaderMaterial (step 5): drawn as the ground stand-in (`gpu stand-in: ground`)",
  shaderMaterials: 'every ShaderMaterial is step 5: listed by name and count under `unsupported`, a stand-in drawn where one is named under `standIns`',
  effects: 'the effects chain is step 6: forced off (`forcedOff.effects`), straight to the canvas with three\'s tone mapping at the game\'s exposure',
};
