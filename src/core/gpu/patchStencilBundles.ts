// The fourth of the port's four private patches of three (the GPU port's step 3, item 8; `patchTable.ts`): the spike's
// `patchStencilBundles` (`A:\swg3js\webgpu\tree\src\spike\webgpu\q4Stencil.ts`, commit 52106df), changed in two ways
// for the game, on WebGPU alone and only where `patchApplies` says three is the revision it was written for.
//
// A WebGPU render bundle has no stencil reference of its own: the reference is the pass's state. Three asks the current
// encoder for `setStencilReference` at a draw whose material writes the stencil, so recording one inside a bundle throws.
// The spike's patch gives the bundle's encoder a `setStencilReference` that only notes what was asked, keeps it on the
// bundle, and replays each bundle at the end of the pass with that reference set first. The game's passes need two things
// more, so this patch differs from the spike's:
//  - **the reference is the one the bundle's materials carry now**, never the one noted when it was recorded: every
//    material the portal renderer registers reads one shared reference (`stencilRef.ts`), which is 1 in the world pass
//    outdoors and 2 in the world seen through a building's exits, and one bundle is replayed in both. The noted one is
//    kept only to count a bundle whose materials asked for more than one (`mixed`), which WebGPU cannot draw;
//  - **a bundle runs after its pass's opaque draws and before its blended ones** (`_renderTransparents`, else the pass's
//    end): three replays every bundle after every draw that is in no bundle, so a still wall in a bundle was drawn over
//    the water, the glass and every decal drawn before it; run at the pass's head instead (tried first), it was painted
//    over by the sky, whose dome and bodies three draws first among the opaque with no depth test. The port bundles opaque
//    things only, which belong at the opaque list's end. WebGPU resets the pass's pipeline, bind groups and buffers after
//    `executeBundles`, so three's record of what is set is reset with it.
//
// Its switch (`STENCIL_PATCH.on`, `gpu({ patches: { stencil: false } })`, `localStorage['swg.gpu.patch.stencil'] = '0'`
// at load) is live; the bundles are held off while it is off (a stencil-tested material in a bundle would throw).

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const STENCIL_PATCH = { on: true, applied: false, why: '' as string, recorded: 0, run: 0, mixed: 0 };

export function installStencilPatch(renderer: Any): void {
  const be = renderer.backend;
  const beginBundle = be.beginBundle.bind(be);
  be.beginBundle = (ctx: Any) => {
    if (!STENCIL_PATCH.on) return beginBundle(ctx);
    const data = be.get(ctx);
    const passRef = data.currentStencilRef;
    beginBundle(ctx);
    const enc = data.currentPass;
    const asked = { ref: null as number | null, passRef };
    enc.__stencil = asked;
    enc.setStencilReference = (ref: number) => {
      if (asked.ref !== null && asked.ref !== ref) STENCIL_PATCH.mixed++;
      asked.ref = ref;
    };
    // So that the recording's first stencil-tested draw always says its reference.
    data.currentStencilRef = Number.NaN;
  };
  const finishBundle = be.finishBundle.bind(be);
  be.finishBundle = (ctx: Any, bundle: Any) => {
    const data = be.get(ctx);
    const asked = data.currentPass?.__stencil;
    finishBundle(ctx, bundle);
    if (asked) {
      // The pass's own reference, as it stood before the recording.
      data.currentStencilRef = asked.passRef;
      STENCIL_PATCH.recorded++;
    }
  };
  const addBundle = be.addBundle.bind(be);
  /**
   * Three's record of what the pass has set, emptied in place as WebGPU empties the pass after `executeBundles` (no
   * object made: a frame runs this once a bundle a pass). Its vertex buffers are kept by slot, which WebGPU caps far
   * under `VERTEX_SLOTS`.
   */
  const VERTEX_SLOTS = 32;
  const forget = (s: Any): void => {
    s.pipeline = null;
    s.index = null;
    s.bindingGroups.length = 0;
    const a = s.attributes;
    for (let i = 0; i < VERTEX_SLOTS; i++) if (a[i] !== undefined) a[i] = undefined;
  };
  /** The one bundle handed to `executeBundles`, in a kept array. */
  const one: Any[] = [null];
  /** Run every bundle this context's pass holds, each with the reference its own materials carry now. */
  const flush = (ctx: Any): void => {
    if (!ctx) return;
    const data = be.get(ctx);
    const pending = data.__bundles as Any[] | undefined;
    if (!pending || pending.length === 0) return;
    const passes = data.__bundlePasses as Any[];
    const pass = data.currentPass;
    // No pass open, or a bundle being recorded (its encoder runs no bundles): left for the pass's own end.
    if (!pass || typeof pass.executeBundles !== 'function') return;
    for (let k = 0; k < pending.length; k++) {
      // A bundle left over from a pass that threw before its end is not this pass's.
      if (passes[k] !== pass) continue;
      const rec = pending[k];
      if (ctx.stencil === true) {
        // The reference the bundle's own materials carry now: the first that writes the stencil (one a bundle).
        const ros = rec.renderObjects as Any[] | undefined;
        let ref: number | null = null;
        if (ros) {
          for (let i = 0; i < ros.length; i++) {
            const m = ros[i].material;
            if (m && m.stencilWrite === true) {
              ref = m.stencilRef;
              break;
            }
          }
        }
        if (ref !== null && data.currentStencilRef !== ref) {
          pass.setStencilReference(ref);
          data.currentStencilRef = ref;
        }
      }
      one[0] = rec.bundleGPU;
      pass.executeBundles(one);
      one[0] = null;
      STENCIL_PATCH.run++;
    }
    pending.length = 0;
    passes.length = 0;
    forget(data.currentSets);
  };
  be.addBundle = (ctx: Any, bundle: Any) => {
    if (!STENCIL_PATCH.on) return addBundle(ctx, bundle);
    const rec = be.get(bundle);
    if (!rec.bundleGPU) return addBundle(ctx, bundle);
    const data = be.get(ctx);
    (data.__bundles ??= []).push(rec);
    (data.__bundlePasses ??= []).push(data.currentPass);
  };
  // Where they run: after the pass's opaque draws and before its blended ones (`_renderTransparents`), or at its end where it
  // draws nothing blended (`finishRender`). Three draws the sky's dome and bodies first among the opaque, with no depth test,
  // so a bundle run at the pass's head was painted over by the sky; run at its end, every blended thing drawn before it was
  // painted over by the bundle.
  const transparents = renderer._renderTransparents.bind(renderer);
  renderer._renderTransparents = (renderList: Any, doublePassList: Any, camera: Any, scene: Any, lightsNode: Any) => {
    if (STENCIL_PATCH.on) flush(renderer._currentRenderContext);
    return transparents(renderList, doublePassList, camera, scene, lightsNode);
  };
  const finishRender = be.finishRender.bind(be);
  be.finishRender = (ctx: Any) => {
    if (STENCIL_PATCH.on) flush(ctx);
    return finishRender(ctx);
  };
  STENCIL_PATCH.applied = true;
}
