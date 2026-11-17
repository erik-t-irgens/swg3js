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
import { WARM_PATCH, WARM_STATS, WARM_TUNE, installWarm } from '../../../src/core/gpu/patchWarm.ts';

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
}

console.log(`gpuWarmKey: ${checks} checks passed`);
// The warm-up's message channel keeps node's loop alive (the reason `warmDepth.ts` is a module of its own).
process.exit(0);
