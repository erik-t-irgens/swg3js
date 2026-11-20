// The GPU port's step 6, its fixer, in node: the warm-up (`src/core/gpu/patchWarm.ts`) driven over a stand-in renderer that
// records what it is asked to build and under which target, since node has no WebGPU.
//
//  1. an item is built under the target the walk listed it under, whatever target the renderer holds when the warm-up's own
//     clock comes round to it (three's own precompile puts each item's target back the same way): a pipeline for the canvas
//     keys its sample count on the renderer's current target, so built under another it was one no draw used;
//  2. two objects whose pipelines differ are never taken for one by the warm-up's own dedupe: one material on two objects
//     that differ in receiving shadows, in the winding a mirrored matrix gives them, in an attribute's size or
//     normalisation, or in their bones' count, is two builds; the same object twice in one burst is one.
//
// Run: node tools/swg/tests/gpuWarmKey.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WARM_NOW, WARM_PATCH, WARM_STATS, WARM_TUNE, installWarm } from '../../../src/core/gpu/patchWarm.ts';
import { BONES } from '../../../src/core/gpu/bonePool.ts';
import { GPU_KEYS } from '../../../src/core/gpu/gpuKeys.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};

/** What the stand-in renderer was asked to build: the object, the material and the target bound at the build. */
const built: { object: THREE.Object3D; material: THREE.Material; rt: unknown }[] = [];
/** Pipeline promises held open, to keep the warm-up's queue busy while a second call lists. */
const held: (() => void)[] = [];
let holdPipelines = false;

const ctx = { id: 7 };
const r: Any = {
  _renderTarget: null,
  _currentRenderContext: null,
  _currentSourceMaterial: null,
  depth: true,
  stencil: true,
  shadowMap: { enabled: false },
  getRenderTarget(): unknown {
    return this._renderTarget;
  },
  _createObjectPipeline: null,
  _objects: { get: (object: THREE.Object3D, material: THREE.Material) => ({ object, material, context: ctx, getNodeBuilderState() {}, getCacheKey: () => 1, drawRange: null, group: null }) },
  _geometries: { updateForRender() {} },
  _nodes: { updateForRender() {} },
  _bindings: { updateForRender() {} },
  _pipelines: {
    getForRender: (ro: Any, promises: Promise<unknown>[]) => {
      built.push({ object: ro.object, material: ro.material, rt: r._renderTarget });
      promises.push(holdPipelines ? new Promise<void>((res) => held.push(res)) : Promise.resolve());
    },
  },
  backend: { createRenderPipeline: () => undefined },
};

/** Three's own walk, as far as the warm-up uses it: every drawable under the root listed through `_createObjectPipeline`. */
function nativeCompileAsync(root: THREE.Object3D, camera: THREE.Camera, scene: THREE.Object3D | null): Promise<void> {
  r._currentRenderContext = ctx;
  root.traverse((o: Any) => {
    if (o !== root && o.material) r._createObjectPipeline.call(r, o, o.material, scene ?? root, camera, { id: 1 }, null, null, undefined);
  });
  return Promise.resolve();
}

WARM_PATCH.applied = true;
WARM_PATCH.on = true;
WARM_TUNE.inFlight = 1;
const warm = installWarm(r, nativeCompileAsync as never, { shadowNodes: () => [], loading: () => true });
const camera = new THREE.PerspectiveCamera();
const tri = (): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  return g;
};
const breath = (): Promise<void> => new Promise((res) => setTimeout(res, 0));

// ---------------------------------------------------------------- 1. built under the target it was listed under
{
  const canvasMat = new THREE.MeshBasicMaterial();
  const targetMat = new THREE.MeshBasicMaterial();
  const A = new THREE.WebGLRenderTarget(4, 4);
  const B = new THREE.WebGLRenderTarget(4, 4);
  built.length = 0;
  // The first call's pipelines held open: its own item builds at once, and the queue then waits on it.
  holdPipelines = true;
  r._renderTarget = A;
  const first = warm.compile(new THREE.Mesh(tri(), targetMat), camera, null);
  // The second call lists for the canvas while the queue is busy: its item waits for the warm-up's clock.
  r._renderTarget = null;
  const second = warm.compile(new THREE.Mesh(tri(), canvasMat), camera, null);
  ok(built.length === 1 && built[0].rt === A, 'the first item is built at once, under the target it was listed under');
  // Then the renderer is left holding another target, as a frame or a later compile may leave it, and the queue goes on.
  r._renderTarget = B;
  holdPipelines = false;
  while (held.length) held.shift()!();
  for (let i = 0; i < 20 && built.length < 2; i++) await breath();
  await Promise.all([first, second]);
  const canvasBuild = built.find((b) => b.material === canvasMat);
  ok(!!canvasBuild && canvasBuild.rt === null, `the canvas item is built under the canvas it was listed under, not the target the renderer held when the queue reached it (${canvasBuild?.rt === B ? 'B' : String(canvasBuild?.rt)})`);
  ok(r._renderTarget === B, 'and the renderer is handed back the target it held');
  r._renderTarget = null;
}

// ---------------------------------------------------------------- 2. what three keys apart is never taken for one
{
  const mat = new THREE.MeshStandardMaterial();
  const plain = new THREE.Mesh(tri(), mat);
  const receives = new THREE.Mesh(tri(), mat);
  receives.receiveShadow = true;
  const mirrored = new THREE.Mesh(tri(), mat);
  mirrored.scale.set(-1, 1, 1);
  mirrored.updateMatrixWorld(true);
  const wideUv = tri();
  wideUv.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const narrowUv = tri();
  narrowUv.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const normUv = tri();
  normUv.setAttribute('uv', new THREE.Uint8BufferAttribute([0, 0, 255, 0, 0, 255], 2, true));
  const wide = new THREE.Mesh(wideUv, mat);
  const narrow = new THREE.Mesh(narrowUv, mat);
  const normed = new THREE.Mesh(normUv, mat);
  const same = new THREE.Mesh(plain.geometry, mat);
  const bones = (n: number): THREE.SkinnedMesh => {
    const g = tri();
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const s = new THREE.SkinnedMesh(g, mat);
    s.bind(new THREE.Skeleton(Array.from({ length: n }, () => new THREE.Bone())));
    return s;
  };
  const few = bones(3);
  const many = bones(5);
  const root = new THREE.Group();
  for (const o of [plain, receives, mirrored, wide, narrow, normed, same, few, many]) root.add(o);
  built.length = 0;
  const before = WARM_STATS.same;
  await warm.compile(root, camera, null);
  const of = (o: THREE.Object3D): number => built.filter((b) => b.object === o).length;
  ok(of(plain) === 1 && of(receives) === 1, 'one material on two objects, one receiving shadows: two builds');
  ok(of(mirrored) === 1, 'one mirrored by its matrix (the other winding): a build of its own');
  ok(of(wide) === 1 && of(narrow) === 1 && of(normed) === 1, "an attribute of another size, or normalised, or of another array: a build each");
  ok(of(few) === 1 && of(many) === 1, "two skeletons of other bone counts: a build each");
  ok(of(same) === 0 && WARM_STATS.same === before + 1, 'an object exactly like one already built in the burst: no build of its own');
  // Pass 1, wave 4: with the bone pool applied and on, three keys every skinned body "pooled" whatever its bones
  // (`patchBones.ts`), and the dedupe keys them so: one build for both.
  BONES.applied = true;
  GPU_KEYS.boneStorage = true;
  try {
    const pooledRoot = new THREE.Group();
    const a = bones(3);
    const b = bones(5);
    pooledRoot.add(a, b);
    built.length = 0;
    await warm.compile(pooledRoot, camera, null);
    ok(built.filter((x) => x.object === a || x.object === b).length === 1, 'with the bone pool on, two skeletons of other bone counts: one build (both keyed "pooled")');
  } finally {
    BONES.applied = false;
  }
}

// ---------------------------------------------------------------- 3. each build keyed as the scene stands (pass 1, wave 4)
{
  // Three keeps a render object's environment key one a scene and lights per render id, and between frames the id stands at
  // nought for good (a render puts back the id it found): a build read the key first worked out there, for the scene as it
  // stood then. Each build takes an id of its own, below nought, and the renderer's is put back after it.
  const seenIds: number[] = [];
  r._nodes.nodeFrame = { renderId: 0 };
  const getForRender = r._pipelines.getForRender;
  r._pipelines.getForRender = (ro: Any, promises: Promise<unknown>[]) => {
    seenIds.push(r._nodes.nodeFrame.renderId);
    return getForRender(ro, promises);
  };
  const root = new THREE.Group();
  root.add(new THREE.Mesh(tri(), new THREE.MeshBasicMaterial()), new THREE.Mesh(tri(), new THREE.MeshLambertMaterial()));
  await warm.compile(root, camera, null);
  ok(seenIds.length === 2 && seenIds.every((x) => x < 0) && new Set(seenIds).size === 2, `each build is made under a render id of its own, below nought (${seenIds.join(', ')})`);
  ok(r._nodes.nodeFrame.renderId === 0, "and the renderer's render id is put back after it");
  r._pipelines.getForRender = getForRender;
  delete r._nodes.nodeFrame;
}

// ---------------------------------------------------------------- 4. built at once (wave 4's fixer, a jump's world swap)
{
  // With `WARM_NOW` on (`compileNow`, `World.gpuMadeNow`) a compile's items are built in the caller's task, each pipeline still
  // asked for asynchronously, whatever the warm-up's queue holds: the next frame finds each pipeline asked for and skips what
  // has not landed, where on the queue's clock it met the item first and built it itself. Off, the queue's clock as before.
  await warm.compiled();
  built.length = 0;
  // The queue kept busy (a pipeline held open, one in flight at most), so an item on its clock waits.
  holdPipelines = true;
  const busy = warm.compile(new THREE.Mesh(tri(), new THREE.MeshBasicMaterial()), camera, null);
  const queued = new THREE.Mesh(tri(), new THREE.MeshLambertMaterial());
  const later = warm.compile(queued, camera, null);
  ok(built.length === 1 && !built.some((b) => b.object === queued), `on the queue's clock, an item listed while the queue is busy waits for it (${built.length} built)`);
  const now = new THREE.Group();
  const a = new THREE.Mesh(tri(), new THREE.MeshStandardMaterial());
  const b = new THREE.Points(tri(), new THREE.PointsMaterial());
  now.add(a, b);
  const calls = WARM_NOW.calls;
  WARM_NOW.on = true;
  let answered: Promise<void>;
  try {
    answered = warm.compile(now, camera, null);
  } finally {
    WARM_NOW.on = false;
  }
  ok(built.some((x) => x.object === a) && built.some((x) => x.object === b), 'with it on, every item of the call is built before the call returns, though the queue is busy');
  ok(WARM_NOW.calls === calls + 1 && !built.some((x) => x.object === queued), "and the queue's own item still waits for the queue");
  holdPipelines = false;
  while (held.length) held.shift()!();
  for (let i = 0; i < 40 && held.length; i++) await breath();
  while (held.length) held.shift()!();
  await Promise.all([busy, later, answered]);
  ok(built.some((x) => x.object === queued), "and the queue's item is built on its clock once it is free");
}

console.log(`gpuWarmKey: ${checks} checks passed`);
// The warm-up's message channel keeps node's loop alive (the reason `warmDepth.ts` is a module of its own).
process.exit(0);
