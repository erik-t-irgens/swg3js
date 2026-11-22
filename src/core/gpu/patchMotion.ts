// The seventh of the port's private patches of three (pass 1, wave 5; `patchTable.ts`): the motion output (`motion.ts`) drawn
// by three. Only where `patchApplies` says three is the revision it was read against; its switch is `GPU_MOTION.on` (read at load
// from `localStorage['swg.gpu.motion']`, moved live by `__debug.gpu({ motion })`, which makes the effects chain again), read
// where a chain's scene target is made: with it off the target has one output and nothing here does anything.
//
// Two of three's methods are wrapped on the live renderer and its backend's pipeline maker, never on a prototype, and three's own
// is called whole; neither is copied:
//  - `Renderer.setRenderTarget`: three keys a render context, and builds every node graph's outputs, on the renderer's own
//    multi-output node (`getMRT`), which is one for every target. So the node follows the target: set to a scene target that
//    carries the motion output, the renderer's node is ours; set to any other (a shadow map, a chain buffer, the canvas, a
//    reflection's cube), it is taken off where it is ours. Three's shadow node and its precompile save and put back the
//    renderer's node themselves (`resetRendererState`, `restoreRendererState`), which agrees with it.
//  - `WebGPUPipelineUtils.createRenderPipeline`: three reads each output's blend off the render context's node, and has no blend
//    an output of a material's own, so the node's answer for the motion output is told, for the synchronous part of the call in
//    which three reads it, whether the material three blends (`seeThrough`, three's own rule over the material's blending and
//    transparency). Both are in the pipeline's key (`WebGPUBackend.getRenderCacheKey`), which carries neither the node nor its
//    blends: two draws three would take for one pipeline never want the motion output blended two ways.

import { MOTION, MOTION_STATS, PIPELINE_NOW, isMotionTarget, motionMrt, seeThrough } from './motion.ts';
import { seeKindOf } from '../../sky/air/airHazeMath.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** How many see-through pipelines are named for the census. */
const NAMED = 48;

/** The patch on a live renderer (`patches.ts`, once `patchApplies` said yes). */
export function installMotionPatch(renderer: Any): void {
  const node = motionMrt();
  // The renderer's multi-output node follows the target: ours on a motion target, taken off any other.
  const setTarget = renderer.setRenderTarget;
  renderer.setRenderTarget = function (this: Any, target: Any, face?: number, mip?: number): Any {
    const r = setTarget.call(this, target, face, mip);
    if (isMotionTarget(target)) {
      if (this.getMRT() !== node) this.setMRT(node);
    } else if (this.getMRT() === node) this.setMRT(null);
    return r;
  };
  // Each output's blend read as three makes a pipeline: the motion output's kept by a see-through material.
  const utils = renderer.backend.pipelineUtils;
  const make = utils.createRenderPipeline;
  utils.createRenderPipeline = function (this: Any, renderObject: Any, promises: Any): Any {
    if (renderObject?.context?.mrt !== node) return make.call(this, renderObject, promises);
    const m = renderObject.material;
    const see = seeThrough(m);
    MOTION_STATS.pipelines++;
    if (see) {
      MOTION_STATS.seeThrough++;
      if (MOTION_STATS.seeThroughNames.length < NAMED) MOTION_STATS.seeThroughNames.push(`${m?.name || m?.type || '?'} on ${renderObject.object?.name || renderObject.object?.type || '?'}`);
    }
    PIPELINE_NOW.seeThrough = see;
    // Pass 2, wave 1: how the draw goes into our sky's see-through layer, which the layer's blend reads (`airSee.ts`).
    PIPELINE_NOW.see = seeKindOf(m);
    try {
      return make.call(this, renderObject, promises);
    } finally {
      PIPELINE_NOW.seeThrough = false;
      PIPELINE_NOW.see = 'solid';
    }
  };
  MOTION.applied = true;
  MOTION.why = '';
}
