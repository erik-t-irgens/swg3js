// The second of the port's four private patches of three (the GPU port's step 3, item 8; `patchTable.ts`): the spike's
// stillfix (`A:\swg3js\webgpu\tree\src\spike\webgpu\main.ts`, commit 52106df), on WebGPU alone and only where
// `patchApplies` says three is the revision it was written for.
//
// `NodeManager._createNodeBuilderState`: three's observer calls any program carrying a node dynamic, and refreshes it on
// every draw of every frame, in a bundle or out of one. A still thing's program (`isStill`) in the scene's own passes is
// told it carries none, and is refreshed by three's own comparison instead. In this step every model draws through
// three's own node copy of its classic material, which carries no node of its own, so this tell finds nothing to change
// (`told` counts what it found); it is carried for the ports of steps 4 and 5, whose materials are all nodes.
//
// Its switch (`STILL_PATCH.on`, `gpu({ patches: { still: false } })`, `localStorage['swg.gpu.patch.still'] = '0'` at load)
// is live: the states it told are told the truth again.

import { isStill } from './stillMark.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const STILL_PATCH = { on: true, applied: false, why: '' as string, told: 0 };

const toldStates = new Set<{ hasNode: boolean }>();

export function setStillPatch(on: boolean): void {
  if (STILL_PATCH.on === on) return;
  STILL_PATCH.on = on;
  for (const o of toldStates) o.hasNode = !on;
}

export function installStillPatch(renderer: Any): void {
  const N = renderer._nodes;
  const makeState = N._createNodeBuilderState.bind(N);
  N._createNodeBuilderState = (nodeBuilder: Any) => {
    const state = makeState(nodeBuilder);
    const o = state?.observer;
    if (nodeBuilder.material?.isShadowPassMaterial !== true && isStill(nodeBuilder.object) && o && o.hasNode === true) {
      toldStates.add(o);
      STILL_PATCH.told++;
      if (STILL_PATCH.on) o.hasNode = false;
    }
    return state;
  };
  STILL_PATCH.applied = true;
}
