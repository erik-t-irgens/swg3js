// The sun's cascades made again at another size in play on WebGPU (the GPU port's pass 1, wave 6: `src/core/gpu/sun.ts`'s sync,
// `bundles.ts`'s `relight`, the runtime's `resized`). Moving Shadow resolution in play (the row, or a quality tier) on WebGPU left
// every lit render object binding the destroyed maps, a GPU error a draw ("Destroyed texture [ShadowDepthTexture] used in a
// submit", 3,483 of them in the first tier's measure): three refreshes a render object's bindings only in full, and in full on a
// map's resize only where the size its observer reads moved, which is the sun light's own, never a cascade's copy. The game's own
// `makeSun` over a stand-in renderer, as `heldCsm.test.ts` builds it:
//
//   1. the sizes alike, the sync resizes nothing and tells nobody
//   2. the classic cascades moved to another size: the sun's own size moves with them (three's own observer reads it: its
//      `getLightsData` run over the sun gives the new width), each cascade's copy takes it, each map is made again at it once,
//      before anything draws, and the hook is told once; a sync after changes nothing
//   3. back again, the same; and the hook optional (a sun made without one resizes alike)
//   4. the region tiers' bundles: `relight` records every bundle taken again, and none not taken
//
// Run: node tools/swg/tests/gpuShadowResize.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShadowNode, NodeMaterialObserver } from 'three/webgpu';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { SHADOW_SPLIT_TUNE, splitBreaks } from '../../../src/world/shadowSplits.ts';
import { makeSun } from '../../../src/core/gpu/sun.ts';
import { TierBundles } from '../../../src/core/gpu/bundles.ts';
import { STENCIL_PATCH } from '../../../src/core/gpu/patchStencilBundles.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};

// Three's draw stood in (nothing is drawn in node).
(ShadowNode.prototype as Any).updateShadow = function (this: Any): void {
  this.shadow.updateMatrices(this.light);
};

function stage(withHook: boolean) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1600 / 900, 0.05, 9000);
  const splits = (amount: number, near: number, far: number, target: number[]): void => splitBreaks(amount, near, far, SHADOW_SPLIT_TUNE, target);
  const csm = new CSM({ camera, parent: scene, cascades: 3, maxFar: 320, mode: 'custom', customSplitsCallback: splits, shadowMapSize: 2048, lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 2, lightMargin: 150, lightNear: 1, lightFar: 470 });
  for (const l of csm.lights) l.visible = false;
  const renderer = { coordinateSystem: THREE.WebGPUCoordinateSystem, reversedDepthBuffer: true, shadowMap: { enabled: true } };
  const told = { n: 0 };
  const sun = makeSun(renderer, scene, camera, { maxFar: 320, mapSize: 2048, lightMargin: 150, splits, ...(withHook ? { resized: () => void told.n++ } : {}) });
  const node = sun.node as Any;
  // Three makes each cascade's map at its first build; stand-ins that keep what they were sized to, and how often.
  const maps = (node._shadowNodes as Any[]).map((sn) => {
    const m = { w: 2048, h: 2048, depth: 1, sized: 0, setSize(w: number, h: number, d?: number) { if (w !== this.w || h !== this.h) this.sized++; this.w = w; this.h = h; this.depth = d ?? 1; } };
    sn.shadowMap = m;
    return m;
  });
  return { csm, camera, sun, node, maps, told };
}

const observed = (light: THREE.DirectionalLight): number => {
  // Three's own record of a light for its refresh (`NodeMaterialObserver.getLightsData`), run over the sun.
  const data = (NodeMaterialObserver.prototype as Any).getLightsData.call({}, [light], []);
  return data[0]?.shadowMapWidth ?? -1;
};

// ---------------------------------------------------------------- 1. alike: nothing
{
  const s = stage(true);
  s.sun.sync(s.csm as Any, s.camera, true);
  ok(s.told.n === 0 && s.maps.every((m) => m.sized === 0) && s.sun.light.shadow.mapSize.x === 2048, 'the sizes alike, the sync resizes no map and tells nobody');
  ok(observed(s.sun.light) === 2048, "three's observer reads the sun's own size (2048)");
}

// ---------------------------------------------------------------- 2. and 3. moved, and back
for (const withHook of [true, false]) {
  const s = stage(withHook);
  for (const l of s.csm.lights) l.shadow.mapSize.set(1024, 1024);
  s.sun.sync(s.csm as Any, s.camera, true);
  const own = s.node.lights as { shadow: THREE.DirectionalLightShadow }[];
  ok(s.sun.light.shadow.mapSize.x === 1024 && s.sun.light.shadow.mapSize.y === 1024, `${withHook ? '' : '(no hook) '}the classic cascades at 1024: the sun's own size moves with them`);
  ok(observed(s.sun.light) === 1024, `${withHook ? '' : '(no hook) '}three's observer reads the new size, so every lit render object is refreshed in full once, its bindings with it`);
  ok(own.every((l) => l.shadow.mapSize.x === 1024), `${withHook ? '' : '(no hook) '}each cascade's copy takes it`);
  ok(s.maps.every((m) => m.sized === 1 && m.w === 1024 && m.h === 1024 && m.depth === 1), `${withHook ? '' : '(no hook) '}each map made again at it once, in the sync, before anything draws`);
  if (withHook) ok(s.told.n === 1, 'the hook told once (the bundles recorded again)');
  s.sun.sync(s.csm as Any, s.camera, true);
  ok(s.maps.every((m) => m.sized === 1) && (!withHook || s.told.n === 1), `${withHook ? '' : '(no hook) '}a sync after changes nothing`);
  for (const l of s.csm.lights) l.shadow.mapSize.set(4096, 4096);
  s.sun.sync(s.csm as Any, s.camera, true);
  ok(s.sun.light.shadow.mapSize.x === 4096 && observed(s.sun.light) === 4096 && s.maps.every((m) => m.sized === 2 && m.w === 4096) && (!withHook || s.told.n === 2), `${withHook ? '' : '(no hook) '}and to 4096 the same`);
}

// ---------------------------------------------------------------- 4. the bundles
{
  const was = { on: STENCIL_PATCH.on, applied: STENCIL_PATCH.applied };
  STENCIL_PATCH.on = true;
  STENCIL_PATCH.applied = true;
  try {
    const scene = new THREE.Scene();
    const b = new TierBundles();
    b.attach(scene, []);
    const make = () => {
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2);
      m.computeBoundingSphere();
      scene.add(m);
      return m;
    };
    const tierA = {};
    const tierB = {};
    b.mark(tierA, [make()], 1, () => false);
    b.mark(tierB, [make()], 1, () => false);
    b.take(tierA, scene);
    b.take(tierB, scene);
    b.setOn(false);
    b.setOn(true);
    const groups = (b.root.children as Any[]).filter((g) => g.isBundleGroup === true);
    const vBefore = groups.map((g) => g.version);
    const again = b.stats.recordedAgain;
    b.relight();
    ok(groups.length === 2 && groups.every((g, i) => g.version > vBefore[i]) && b.stats.recordedAgain === again + 2, `relight records every bundle taken again (${groups.length})`);
    b.setOn(false);
    const off = b.stats.recordedAgain;
    b.relight();
    ok(b.stats.recordedAgain === off, 'and none that is not taken (the switch off)');
  } finally {
    STENCIL_PATCH.on = was.on;
    STENCIL_PATCH.applied = was.applied;
  }
}

console.log(`\ngpuShadowResize: ${checks} checks passed`);
