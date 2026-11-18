// The four private patches of three's WebGPU renderer the port carries (the GPU port's step 3, item 8), as a table: what
// each is called, its switch, the file that holds it, and the methods of three's it replaces or leans on, each named by
// the class it is a method of and the build file that class ships in. Nothing here is code that runs: the patches read
// it to say what they need before they touch anything (`patchApplies`), and `gpuPatches.test.ts` reads it to hold the
// text of every one of those methods in `node_modules/three` to a recorded hash, so an upgrade that moves one fails the
// test naming it. Imports nothing, so node loads it.
//
// The four, from the spike (`A:\swg3js\webgpu\tree`, commit 52106df):
//   shadow  `main.ts`'s shadowfix: an opaque caster's shadow program is made without its colour map, and a still caster's
//           shadow program is told it carries no node, so three stops refreshing it in every cascade on every frame;
//   still   `main.ts`'s stillfix: the same tell for a still thing's program in the scene's own passes;
//   warm    `q2Materials.ts`'s warm-up: what a pass would draw is listed by three's own walk (`compileAsync`'s synchronous
//           half, with `_createObjectPipeline` swapped for a list for one turn), each shadow pass with its override's
//           adjustments as they stood for each object, and each item built here, its pipeline made asynchronously;
//   stencil `q4Stencil.ts`'s `patchStencilBundles`: a render bundle has no stencil reference of its own, so the bundle's
//           encoder is given one that only notes what was asked, and each bundle is run on the pass with the reference
//           its own materials carry now (one reference a bundle, which the portal renderer's passes are), after the pass's
//           opaque draws and before its blended ones.
// And a fifth, the performance step's own (`drawCost.ts`, its switch `swg.gpu.draw.replay` rather than a patch switch):
//   replay  a bundle's replay asks three whether a render object needs refreshing only where the answer could be other than
//           "nothing", once its last full replay found none in need and nothing it depends on has moved since.

/** One method of three's: its class, its name, and the build file its class ships in. */
export interface ThreeMethod {
  /** The class it is a method of, as it is declared in the build file (`class Renderer {`). */
  cls: string;
  /** Its name as declared (`_getShadowNodes`). */
  method: string;
  /** The build file under `node_modules/three/build/` the class is in. */
  file: 'three.webgpu.js' | 'three.tsl.js';
}

export interface PatchEntry {
  /** The patch's name: the console's word for it and the key of its switch. */
  name: 'shadow' | 'still' | 'warm' | 'stencil' | 'replay';
  /** The file under `src/core/gpu/` that holds it. */
  file: string;
  /** What it does, in a line, for the console. */
  does: string;
  /** Methods of three's it replaces (on the renderer, its node manager or its backend: never on a prototype). */
  replaces: ThreeMethod[];
  /** Methods whose behaviour it leans on without replacing them: a change to one changes what the patch means. */
  relies: ThreeMethod[];
}

/** The three revision every patch was written against: a patch applies on this one alone. */
export const PATCH_REVISION = '187';

export const PATCH_TABLE: readonly PatchEntry[] = [
  {
    name: 'shadow',
    file: 'patchShadow.ts',
    does: "an opaque caster's shadow program made without its colour map, and a still caster's told it carries no node (not refreshed in every cascade on every frame)",
    replaces: [
      { cls: 'Renderer', method: '_getShadowNodes', file: 'three.webgpu.js' },
      { cls: 'NodeManager', method: '_createNodeBuilderState', file: 'three.webgpu.js' },
    ],
    relies: [
      { cls: 'Renderer', method: 'renderObject', file: 'three.webgpu.js' },
      { cls: 'NodeMaterialObserver', method: 'needsRefresh', file: 'three.tsl.js' },
    ],
  },
  {
    name: 'still',
    file: 'patchStill.ts',
    does: "a still thing's program in the scene's own passes told it carries no node (refreshed only when its material or object moved)",
    replaces: [{ cls: 'NodeManager', method: '_createNodeBuilderState', file: 'three.webgpu.js' }],
    relies: [{ cls: 'NodeMaterialObserver', method: 'needsRefresh', file: 'three.tsl.js' }],
  },
  {
    name: 'warm',
    file: 'patchWarm.ts',
    does: "what a pass and every sun cascade would draw listed by three's own walk and built ahead, each pipeline made asynchronously",
    replaces: [
      { cls: 'Renderer', method: '_createObjectPipeline', file: 'three.webgpu.js' },
      // Wrapped to count the pipelines three makes, by whether a draw (null) or a precompile (a list) asked for one.
      { cls: 'WebGPUBackend', method: 'createRenderPipeline', file: 'three.webgpu.js' },
    ],
    relies: [
      { cls: 'Renderer', method: 'compileAsync', file: 'three.webgpu.js' },
      { cls: 'Renderer', method: 'renderObject', file: 'three.webgpu.js' },
      { cls: 'Renderer', method: '_renderObjectDirect', file: 'three.webgpu.js' },
      { cls: 'Pipelines', method: 'getForRender', file: 'three.webgpu.js' },
    ],
  },
  {
    name: 'stencil',
    file: 'patchStencilBundles.ts',
    does: "a render bundle's stencil reference noted while it is recorded, and each bundle run on the pass with the reference its materials carry now, after the pass's opaque draws and before its blended ones",
    replaces: [
      { cls: 'WebGPUBackend', method: 'beginBundle', file: 'three.webgpu.js' },
      { cls: 'WebGPUBackend', method: 'finishBundle', file: 'three.webgpu.js' },
      { cls: 'WebGPUBackend', method: 'addBundle', file: 'three.webgpu.js' },
      { cls: 'WebGPUBackend', method: 'finishRender', file: 'three.webgpu.js' },
      { cls: 'Renderer', method: '_renderTransparents', file: 'three.webgpu.js' },
    ],
    relies: [
      { cls: 'Renderer', method: '_renderBundle', file: 'three.webgpu.js' },
      { cls: 'Renderer', method: '_renderScene', file: 'three.webgpu.js' },
      { cls: 'WebGPUBackend', method: 'draw', file: 'three.webgpu.js' },
    ],
  },
  {
    name: 'replay',
    file: 'patchReplay.ts',
    does: "a render bundle's replay asks three whether a render object needs refreshing only where the answer could be other than nothing, once its last full replay found none in need and nothing it depends on has moved",
    replaces: [
      // Each wrapped on the live renderer and called whole: neither is copied.
      { cls: 'Renderer', method: '_renderBundle', file: 'three.webgpu.js' },
      { cls: 'NodeManager', method: 'needsRefresh', file: 'three.webgpu.js' },
    ],
    relies: [
      { cls: 'Renderer', method: '_bundleNeedsUpdate', file: 'three.webgpu.js' },
      { cls: 'NodeMaterialObserver', method: 'needsRefresh', file: 'three.tsl.js' },
      { cls: 'NodeMaterialObserver', method: 'hasDynamicInstancing', file: 'three.tsl.js' },
      { cls: 'NodeMaterialObserver', method: 'equals', file: 'three.tsl.js' },
    ],
  },
];

/** The private fields and methods each patch reaches on a live renderer, checked before it is applied (`patchApplies`). */
export const PATCH_NEEDS: Readonly<Record<PatchEntry['name'], readonly string[]>> = {
  shadow: ['_getShadowNodes', '_nodes._createNodeBuilderState'],
  still: ['_nodes._createNodeBuilderState'],
  warm: ['_createObjectPipeline', '_objects.get', '_geometries.updateForRender', '_nodes.updateForRender', '_bindings.updateForRender', '_pipelines.getForRender', 'backend.createRenderPipeline'],
  stencil: ['backend.beginBundle', 'backend.finishBundle', 'backend.addBundle', 'backend.finishRender', 'backend.get', '_renderTransparents'],
  replay: ['_renderBundle', '_bundleNeedsUpdate', '_bundles.get', 'backend.get', '_nodes.needsRefresh', 'getRenderTarget', 'getOutputRenderTarget', 'getCanvasTarget', 'getMRT'],
};

/**
 * Whether a patch may be applied to this renderer: three's revision is the one it was written against and every private
 * method it reaches is there. Answers null when it may, or why not in words.
 */
export function patchApplies(name: PatchEntry['name'], revision: string, renderer: Record<string, unknown>): string | null {
  if (revision !== PATCH_REVISION) return `three is r${revision}, the patch was written for r${PATCH_REVISION}`;
  for (const path of PATCH_NEEDS[name]) {
    let o: unknown = renderer;
    for (const k of path.split('.')) o = o === null || o === undefined ? undefined : (o as Record<string, unknown>)[k];
    if (typeof o !== 'function') return `three has no ${path}`;
  }
  return null;
}
