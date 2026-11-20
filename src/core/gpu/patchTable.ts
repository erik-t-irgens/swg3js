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
// And a sixth, pass 1's wave 4 (`patchBones.ts`, its switch `GPU_KEYS.boneStorage`):
//   bones   a skinned body skinned from the bone pool (`bonePool.ts`), keyed "pooled" where three keys its bone count, and
//           refreshed in full only where something of its own moved.

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
  name: 'shadow' | 'still' | 'warm' | 'stencil' | 'replay' | 'bones';
  /** The file under `src/core/gpu/` that holds it. */
  file: string;
  /** What it does, in a line, for the console. */
  does: string;
  /** Methods of three's it replaces (on the renderer, its node manager or its backend: never on a prototype). */
  replaces: ThreeMethod[];
  /** Methods whose behaviour it leans on without replacing them: a change to one changes what the patch means. */
  relies: ThreeMethod[];
}

/**
 * The three revision each patch was last read against: a patch applies on that one alone (pass 1, wave 2).
 * Three's development branch is `188dev` at every commit, so the commit is pinned by the lockfile (a tarball of three's
 * `577fb27`, held by its integrity) and each method a patch reaches by `gpuPatches.test.ts`'s hashes of the installed text.
 * At 577fb27 each was read against the build's text and proven by the node suites alone: the browser measures that should
 * decide each (on against off, by frame report, in play and by arrival) are owed, the wave's browser having been refused.
 * When the released 0.188.0 replaces it, each patch is read against it again and moved to `'188'` one by one.
 */
export const PATCH_REVISIONS: Readonly<Record<PatchEntry['name'], string>> = {
  shadow: '188dev',
  still: '188dev',
  warm: '188dev',
  stencil: '188dev',
  replay: '188dev',
  // Pass 1, wave 4: read against the development commit 577fb27 alone.
  bones: '188dev',
};

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
  {
    name: 'bones',
    file: 'patchBones.ts',
    does: "a skinned body skinned from the bone pool (bonePool.ts: one storage buffer of every body's bones, body space, written once a frame): its render object keyed 'pooled' where three keys its bone count, its graph's position set up by three's own and then the pool's skinning, and refreshed in full only where something of its own moved",
    replaces: [
      // Each wrapped on the live node manager or library and called whole.
      { cls: 'NodeManager', method: 'getForRenderCacheKey', file: 'three.webgpu.js' },
      { cls: 'NodeManager', method: '_createNodeBuilderState', file: 'three.webgpu.js' },
      { cls: 'NodeManager', method: 'needsRefresh', file: 'three.webgpu.js' },
      { cls: 'NodeLibrary', method: 'fromMaterial', file: 'three.webgpu.js' },
      // Given, as an own method, to each node material built for a pooled body; three's own is run first.
      { cls: 'NodeMaterial', method: 'setupPosition', file: 'three.tsl.js' },
    ],
    relies: [
      // The key: three's own, worked out with the skeleton read as "pooled" (its bone count is the one place it reads one).
      { cls: 'RenderObject', method: 'getMaterialCacheKey', file: 'three.webgpu.js' },
      { cls: 'RenderObject', method: 'getCacheKey', file: 'three.webgpu.js' },
      { cls: 'NodeManager', method: 'getForRender', file: 'three.webgpu.js' },
      // Asks the key again as a render object's last user lets its graph go: handed the one the graph was filed under.
      { cls: 'NodeManager', method: 'delete', file: 'three.webgpu.js' },
      // Makes a render object again where its key moved (the scene's environment), its old one let go through the delete.
      { cls: 'RenderObjects', method: 'get', file: 'three.webgpu.js' },
      // Every material a node builder builds is handed over by the library (a node material as itself).
      { cls: 'NodeBuilder', method: 'prebuild', file: 'three.webgpu.js' },
      // The position set up in the vertex stage, and three's own skinning there (what the pooled one leaves out).
      { cls: 'NodeMaterial', method: 'setupVertex', file: 'three.tsl.js' },
      // The observer's animated rule, and the refresh it decides.
      { cls: 'NodeMaterialObserver', method: 'constructor', file: 'three.tsl.js' },
      { cls: 'NodeMaterialObserver', method: 'needsRefresh', file: 'three.tsl.js' },
      { cls: 'Renderer', method: '_renderObjectDirect', file: 'three.webgpu.js' },
      // A storage buffer is uploaded only as its version moves (the pool writes the card's copy itself).
      { cls: 'Bindings', method: '_update', file: 'three.webgpu.js' },
      { cls: 'WebGPUAttributeUtils', method: 'createAttribute', file: 'three.webgpu.js' },
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
  bones: ['_nodes.getForRenderCacheKey', '_nodes._createNodeBuilderState', '_nodes.needsRefresh', 'library.fromMaterial', 'backend.get', 'backend.device.queue.writeBuffer'],
};

/**
 * Whether a patch may be applied to this renderer: three's revision is the one it was written against and every private
 * method it reaches is there. Answers null when it may, or why not in words.
 */
export function patchApplies(name: PatchEntry['name'], revision: string, renderer: Record<string, unknown>): string | null {
  const own = PATCH_REVISIONS[name];
  if (revision !== own) return `three is r${revision}, the patch was proven on r${own}`;
  for (const path of PATCH_NEEDS[name]) {
    let o: unknown = renderer;
    for (const k of path.split('.')) o = o === null || o === undefined ? undefined : (o as Record<string, unknown>)[k];
    if (typeof o !== 'function') return `three has no ${path}`;
  }
  return null;
}
