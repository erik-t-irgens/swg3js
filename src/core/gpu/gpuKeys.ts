// The switches of pass 1's fourth wave (the GPU port): what comes out of what makes each body its own pipeline on WebGPU.
// Each is read once at load from `localStorage['swg.gpu.keys.<name>']` ('0' leaves it off) and moved live by the console
// (`__debug.gpu({ bake: false })`, `__debug.gpu({ standIns: false })`), so the frame report can put a switch on against off
// in one tab. Reached only through `start.ts` (WebGPU alone); imports nothing, so node loads it.

/** A switch read once: on unless this browser's storage says '0'. Storage that throws (a private window), or none (node), reads as on. */
function readKey(name: string): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(`swg.gpu.keys.${name}`) !== '0';
  } catch {
    return true;
  }
}

export const GPU_KEYS = {
  /**
   * The morph bake (`morphBake.ts`): in play, each look's shape sliders baked into one copy of its positions and normals,
   * shared by its clones, so the drawn body carries no morph targets and three keys no pipeline on a morph attribute.
   */
  morphBake: readKey('morphBake'),
  /**
   * The warm-up's person stand-ins made on a real body's attribute layout, bone count and texture sampler states
   * (`bodyStandIns.ts`), so the pipelines they warm are the bodies' own; off, the one-bone stand-ins of `personKeys.ts`.
   */
  realStandIns: readKey('realStandIns'),
  /**
   * The bone pool (`bonePool.ts`, `patchBones.ts`): every body's bones in one storage buffer written once a frame, so three keys
   * no pipeline on a skeleton's bone count and refreshes no body in full at every draw; off, three's own skinning.
   */
  boneStorage: readKey('boneStorage'),
};
