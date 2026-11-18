// The performance step's `shadowCull` (`drawCost.ts`): in a shadow pass, a thing that casts no shadow is culled before its
// frustum test. On WebGPU alone.
//
// Three draws a shadow map as a whole render of the scene through the light's camera: its drawing pipeline walks every
// object, tests each one's sphere against the cascade's frustum, lists and sorts what passes, and only at the draw does the
// shadow pass's render function step over what casts no shadow (`object.castShadow`, or a receiver under the variance
// shadow type). Three asks its drawing pipeline whether an object is culled (`StandardDrawingPipeline.isCulled`, a hook it
// documents for strategies of this kind), so the pipeline is told, as each render begins (`begin`), whether the render is a
// shadow pass (its render function is three's shadow function, which carries its `shadowType`), and answers "culled" for
// exactly what that function would step over. Nothing that function draws is culled here, and nothing it steps over was
// ever drawn: the shadow maps are what they were. Inside a render bundle three culls nothing (`_bundleDepth`), and a
// non-caster culled there is one the bundle's recording would have stepped over at its draw: the bundle holds the same
// draws. A walk that lists for the warm-up goes through the same pipeline and lists what the draws will draw.
//
// Its switch (`DRAW_COST.shadowCull`, `gpu({ draw: { shadowCull: false } })`, `localStorage['swg.gpu.draw.shadowCull'] =
// '0'` at load) is live: off, the pipeline is three's own.

import { DRAW_APPLIED, DRAW_COST, DRAW_STATS } from './drawCost.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Three's `VSMShadowMap`: under it a receiver is drawn into the shadow map too. */
const VSM = 3;

export function installShadowCull(renderer: Any): void {
  const dp = renderer.drawingPipeline;
  if (!dp || typeof dp.isCulled !== 'function' || typeof dp.begin !== 'function') {
    DRAW_APPLIED.shadowCull = { applied: false, why: "three's drawing pipeline has no isCulled or begin" };
    return;
  }
  const begin = dp.begin;
  const isCulled = dp.isCulled;
  /** The shadow type of the render now walked when it is a shadow pass, else -1. */
  let shadowType = -1;
  dp.begin = function (this: Any, camera: Any, renderContext: Any): void {
    const f = renderer._currentRenderObjectFunction;
    shadowType = DRAW_COST.shadowCull && f && typeof f.shadowType === 'number' ? f.shadowType : -1;
    return begin.call(this, camera, renderContext);
  };
  dp.isCulled = function (this: Any, object: Any, camera: Any): boolean {
    if (shadowType >= 0 && object.castShadow !== true && !(object.receiveShadow === true && shadowType === VSM)) {
      DRAW_STATS.shadowCulled++;
      return true;
    }
    return isCulled.call(this, object, camera);
  };
  DRAW_APPLIED.shadowCull = { applied: true, why: '' };
}
