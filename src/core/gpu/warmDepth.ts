// The warm-up's walks made with the target's own depth and stencil (the GPU port's step 6): out of `patchWarm.ts` so a node
// test can load it, since that module keeps a message channel open from its first line.

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Three's `compileAsync` gives the render context it makes the renderer's own `depth` and `stencil` (`renderContext.depth =
 * this.depth`), where a draw gives it the target's (`renderTarget.depthBuffer`, `stencilBuffer`), and a pipeline keys its
 * depth-stencil attachment on them (`WebGPUUtils.getCurrentDepthStencilFormat`). So everything warmed into a target with no
 * depth or no stencil -- the effects chain's buffers and the bloom's levels (step 6) -- was built for an attachment its draws
 * never have and built again at its first draw: switching Effects on in play built the chain's ten at their first frame.
 * On (the start): the walk is made with the renderer's two flags set to the target's, and put back after. Off is three's own.
 */
export const WARM_DEPTH = { on: true };

/** A compile walk with the renderer's depth and stencil flags those of the target it is made for (`WARM_DEPTH`). */
export function withTargetDepth<T>(r: Any, walk: () => T): T {
  const rt = r.getRenderTarget?.() ?? null;
  if (!WARM_DEPTH.on || rt === null) return walk();
  const depth = r.depth;
  const stencil = r.stencil;
  r.depth = rt.depthBuffer;
  r.stencil = rt.stencilBuffer;
  try {
    return walk();
  } finally {
    r.depth = depth;
    r.stencil = stencil;
  }
}
