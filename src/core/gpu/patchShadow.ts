// The first of the port's four private patches of three (the GPU port's step 3, item 8; `patchTable.ts`): the spike's
// shadowfix (`A:\swg3js\webgpu\tree\src\spike\webgpu\main.ts`, commit 52106df), in two halves, on WebGPU alone and only
// where `patchApplies` says three is the revision it was written for.
//
//  1. `Renderer._getShadowNodes`: three makes every caster's shadow program sample its colour map's alpha whenever the
//     material has a map, cut out or not. An opaque material with no alpha test, no alpha map, not transparent and no node
//     of its own casts its whole surface whatever the map's alpha says, so its shadow nodes are answered with no colour
//     node: the shadow program reads no texture, and every such caster shares one shadow program.
//  2. `NodeManager._createNodeBuilderState`: three's shadow material always carries a colour node (a constant where the
//     caster has no map), and three's observer calls any program carrying a node dynamic, so every caster in every cascade
//     was refreshed (its nodes, bindings and geometry walked) on every frame. A still caster's shadow program is told it
//     carries none, and is refreshed by three's own comparison instead (a moved matrix, a changed material or attribute).
//     "Still" is the game's word (`isStill`): what the port bundles, marked before its programs are built.
//
// Its switch (`SHADOW_PATCH.on`, `gpu({ patches: { shadow: false } })`, `localStorage['swg.gpu.patch.shadow'] = '0'` at
// load) is live: the states it told are told again the other way, and the first half answers three's own record again,
// which makes each opaque caster's shadow program again (pipelines made in play, said so).

import { isStill } from './stillMark.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The switch, and what it has done: states told still, and opaque casters answered with no colour node. */
export const SHADOW_PATCH = { on: true, applied: false, why: '' as string, told: 0, plainCasters: 0 };

/** Every shadow program state this patch told, so turning it off can tell them the truth again. */
const toldStates = new Set<{ hasNode: boolean }>();

export function setShadowPatch(on: boolean): void {
  if (SHADOW_PATCH.on === on) return;
  SHADOW_PATCH.on = on;
  for (const o of toldStates) o.hasNode = !on;
}

export function installShadowPatch(renderer: Any): void {
  // 1. The shadow nodes of an opaque caster, with no colour node.
  const shadowNodes = renderer._getShadowNodes.bind(renderer);
  const plainOf = new WeakMap<object, object>();
  renderer._getShadowNodes = (material: Any) => {
    const c = shadowNodes(material);
    if (!SHADOW_PATCH.on) return c;
    if (c.colorNode === null || material.alphaTest > 0 || material.transparent === true || material.alphaMap || material.colorNode || material.maskNode || material.maskShadowNode || material.castShadowNode) return c;
    let p = plainOf.get(c);
    if (!p) {
      plainOf.set(c, (p = { version: c.version, colorNode: null, depthNode: c.depthNode, positionNode: c.positionNode }));
      SHADOW_PATCH.plainCasters++;
    }
    return p;
  };
  // 2. A still caster's shadow program told it carries no node.
  const N = renderer._nodes;
  const makeState = N._createNodeBuilderState.bind(N);
  N._createNodeBuilderState = (nodeBuilder: Any) => {
    const state = makeState(nodeBuilder);
    const o = state?.observer;
    if (nodeBuilder.material?.isShadowPassMaterial === true && isStill(nodeBuilder.object) && o && o.hasNode === true) {
      toldStates.add(o);
      SHADOW_PATCH.told++;
      if (SHADOW_PATCH.on) o.hasNode = false;
    }
    return state;
  };
  SHADOW_PATCH.applied = true;
}
