// The GPU port's performance step (`A:\swg3js\port\STEP-PERF.md`, item 2): each of its ways of issuing the same draws for
// less of the main thread, driven over stand-ins of three's own pieces, held to give exactly what three gives with the
// switch off, and to save what it is for; and the frame report's counters, held to count and to put everything back.
//
//  1. `replay` (`patchReplay.ts`): a scripted run of renders over render objects watched by three's own
//     `NodeMaterialObserver` (imported from three's source), replayed by a stand-in of three's replay loop with the patch on
//     and off: every refresh three would answer, object by object and render by render, through a moved matrix, a flag
//     turned on, an attribute disposed, a target changed and a bundle recorded again, comes out the same, and with the
//     patch on three is asked far less;
//  2. `shadowCull` (`shadowCull.ts`): three's own drawing pipeline (imported from its source) walks a scene with the cull
//     on and off: in a shadow pass exactly the things the shadow function draws are listed with it on, and with it off
//     those and the rest; a main pass and the variance shadow type's receivers are untouched;
//  3. the frame report's counters (`framePerf.ts`): every call counted with its bytes, and every prototype and instance
//     method put back after.
//
// Run: node tools/swg/tests/gpuDraw.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import NodeMaterialObserver from '../../../node_modules/three/src/materials/nodes/manager/NodeMaterialObserver.js';
import StandardDrawingPipeline from '../../../node_modules/three/src/renderers/common/StandardDrawingPipeline.js';
import { DRAW_COST, DRAW_STATS, setDrawSwitch } from '../../../src/core/gpu/drawCost.ts';
import { installReplayPatch } from '../../../src/core/gpu/patchReplay.ts';
import { installShadowCull } from '../../../src/core/gpu/shadowCull.ts';
import { completeCardFrames, installCounters, writeBufferBytes } from '../../../src/core/gpu/framePerf.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};

// ---------------------------------------------------------------- 0. what each allocates, in a process of its own
// Run as `node --expose-gc gpuDraw.test.ts --alloc` by the test below: the bytes the young generation gains a render with
// each switch on and off, over a stand-in replay of a still bundle (200 objects of 10 programs) and three's own drawing
// pipeline walking a scene of 200 meshes for a shadow pass; a window with a collection in it is measured again.
if (process.argv.includes('--alloc')) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const window_ = async (step: () => void, n: number): Promise<number> => {
    for (let tries = 0; tries < 6; tries++) {
      for (let i = 0; i < 2000; i++) step();
      gc({ type: 'minor' });
      await turn();
      await turn();
      const c0 = collections;
      const b = young();
      for (let i = 0; i < n; i++) step();
      const a = young();
      await turn();
      await turn();
      if (collections === c0) return (a - b) / n;
    }
    return NaN;
  };
  const replayStep = (on: boolean): (() => void) => {
    const canvasTarget = { name: 'canvas' };
    const fake = { getRenderTarget: () => null, getOutputRenderTarget: () => null, getCanvasTarget: () => canvasTarget, getMRT: () => null };
    const nodeFrame = { renderId: 0, renderer: fake };
    const attributes = { disposeVersion: 0 };
    const group: Any = { static: true, version: 0 };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const material = new THREE.MeshStandardMaterial();
    const scene = new THREE.Scene();
    const lightsNode = { getBuiltinLights: () => [] };
    const context = {};
    const mons: Any[] = [];
    const ros: Any[] = [];
    for (let i = 0; i < 200; i++) {
      const object = new THREE.Mesh(geometry, material);
      if (i < 10) mons.push(new NodeMaterialObserver({ material: {}, context: {}, object } as Any));
      ros.push({ object, material, geometry, scene, lightsNode, context, renderer: fake, bundle: group, _geometries: { attributes }, _monitor: mons[i % 10], getMonitor() { return this._monitor; } });
    }
    const data: Any = { version: 0 };
    const r: Any = {
      _nodes: { nodeFrame, needsRefresh: (ro: Any) => ro.getMonitor().needsRefresh(ro, nodeFrame) },
      _attributes: attributes,
      _currentRenderContext: context,
      _bundles: { get: () => data },
      backend: { get: (x: Any) => x },
      getRenderTarget: () => null,
      getOutputRenderTarget: () => null,
      getCanvasTarget: () => canvasTarget,
      getMRT: () => null,
      _bundleNeedsUpdate: (g: Any, d: Any) => d.version !== g.version,
      _renderBundle(this: Any) {
        for (let i = 0; i < ros.length; i++) this._nodes.needsRefresh(ros[i]);
      },
    };
    installReplayPatch(r);
    const bundle = { bundleGroup: group, camera: null };
    return () => {
      DRAW_COST.replay = on;
      nodeFrame.renderId++;
      r._renderBundle(bundle, scene, lightsNode);
    };
  };
  const cullStep = (on: boolean): (() => void) => {
    const dp: Any = new StandardDrawingPipeline();
    const renderer: Any = { drawingPipeline: dp, sortObjects: false, _currentRenderObjectFunction: Object.assign(() => undefined, { shadowType: 1 }) };
    dp.renderer = renderer;
    installShadowCull(renderer);
    const scene = new THREE.Scene();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    for (let i = 0; i < 200; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set((i % 20) - 10, 0, -5 - Math.floor(i / 20));
      m.castShadow = i % 4 === 0;
      scene.add(m);
    }
    scene.updateMatrixWorld();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld();
    const list: Any = { push: () => undefined, pushLight: () => undefined, pushBundle: () => undefined };
    const ctx = { frustumArray: null };
    return () => {
      DRAW_COST.shadowCull = on;
      dp.begin(camera, ctx);
      dp.project(scene, camera, 0, list, null);
    };
  };
  const out: Record<string, number> = {};
  for (const [k, make] of [['replay', replayStep], ['shadowCull', cullStep]] as const) {
    // The cleanest of three windows each, the two settings in turn.
    for (const on of [false, true, false, true, false, true]) {
      const b = await window_(make(on), 20000);
      const key = `${k}.${on ? 'on' : 'off'}`;
      if (!(key in out) || b < out[key]) out[key] = b;
    }
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------- 1. replay
{
  // The stand-ins three's observer reads: a renderer for the output target and velocity, attributes with a dispose
  // counter, lights, a context.
  const targetA = { name: 'target A' };
  const targetB = { name: 'target B' };
  let target: object = targetA;
  // Each render object's own vertex buffer, and the buffers a disposal has destroyed (three's `Attributes.has` is false for
  // one until a full refresh uploads it again).
  const gone = new Set<object>();
  const attributes = { disposeVersion: 0, has: (b: object) => !gone.has(b) };
  const lightsNode = { getBuiltinLights: () => [] };
  const context = { width: 640, height: 360 };
  const scene = new THREE.Scene();
  const fakeRenderer = { getRenderTarget: () => target, getOutputRenderTarget: () => null, getCanvasTarget: () => null, getMRT: () => null };

  // Monitors: one program shared by objects 0..3, one by 4..5, one flagged (a node of its own) for 6, one for a skinned 7.
  const group: Any = { static: true, version: 0 };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const material = new THREE.MeshStandardMaterial();
  const plainBuilder = (object: Any) => ({ material: {}, context: {}, object });
  const meshes: Any[] = [];
  for (let i = 0; i < 8; i++) meshes.push(new THREE.Mesh(geometry, material));
  const monA = new NodeMaterialObserver(plainBuilder(meshes[0]) as Any);
  const monB = new NodeMaterialObserver(plainBuilder(meshes[4]) as Any);
  const monNode = new NodeMaterialObserver({ material: { colorNode: { isNode: true } }, context: {}, object: meshes[6] } as Any);
  const skinned = Object.assign(new THREE.Mesh(geometry, material), { isSkinnedMesh: true });
  meshes[7] = skinned;
  const monSkin = new NodeMaterialObserver(plainBuilder(skinned) as Any);
  ok(monNode.hasNode === true && monSkin.hasAnimation === true && monA.hasNode === false, 'the stand-in programs are flagged as three flags them');
  const monitors = [monA, monA, monA, monA, monB, monB, monNode, monSkin];
  const vbs = meshes.map((_, i) => ({ name: `vertex buffer ${i}` }));
  const ros: Any[] = meshes.map((object, i) => ({ object, material, geometry, scene, lightsNode, context, renderer: fakeRenderer, bundle: group, _geometries: { attributes }, _monitor: monitors[i], getMonitor() { return this._monitor; }, getVertexBuffers: () => [vbs[i]], getIndex: () => null }));

  // The render objects the bundle holds in a run (all of them, or the first few: none flagged).
  let live: Any[] = ros;
  // A stand-in of three's node manager (its `needsRefresh` is three's: the observer asked through the shared node frame)
  // and of three's replay loop (every object asked, in order, and what it was told recorded).
  const nodeFrame = { renderId: 0, renderer: fakeRenderer };
  const make = (patched: boolean) => {
    const asked: number[] = [];
    const nodes: Any = {
      nodeFrame,
      needsRefresh(ro: Any): number {
        asked.push(1);
        return ro.getMonitor().needsRefresh(ro, nodeFrame);
      },
    };
    const told: number[][] = [];
    // What each object's observer keeps of the attributes and the target it last saw, after every render: three's own
    // records, read without making one (`renderObjects` is the observer's own map).
    const records: string[] = [];
    let recorded = 0;
    // A full refresh uploads the object's attributes again (three's `updateForRender` of its geometry).
    const ask = (self: Any, ro: Any): number => {
      const v = self._nodes.needsRefresh(ro);
      if (v === 2) for (const b of ro.getVertexBuffers()) gone.delete(b);
      return v;
    };
    const r: Any = {
      _nodes: nodes,
      _attributes: attributes,
      _currentRenderContext: context,
      _bundles: { get: () => rb },
      backend: { get: () => data },
      getRenderTarget: () => target,
      getOutputRenderTarget: () => null,
      getCanvasTarget: () => null,
      getMRT: () => null,
      // Three's `_bundleNeedsUpdate` (0.187): recorded again on a new version, and, once an attribute anywhere was disposed,
      // when any of the bundle's own objects has lost a buffer (its version then nulled so it stays to be recorded).
      _bundleNeedsUpdate(g: Any, d: Any): boolean {
        if (d.version !== g.version) return true;
        if (d.dispose !== attributes.disposeVersion) {
          d.dispose = attributes.disposeVersion;
          for (const ro of live) {
            const index = ro.getIndex();
            let disposed = index !== null && attributes.has(index) === false;
            for (const b of ro.getVertexBuffers()) if (attributes.has(b) === false) disposed = true;
            if (disposed) {
              d.version = null;
              return true;
            }
          }
        }
        return false;
      },
      _renderBundle(this: Any): void {
        // Three's replay: a bundle recorded again has each object refreshed through its draw; else every object asked.
        const row: number[] = [];
        if (this._bundleNeedsUpdate(group, data)) {
          data.version = group.version;
          recorded++;
          for (const ro of live) row.push(ask(this, ro));
        } else for (const ro of live) row.push(ask(this, ro));
        told.push(row);
        records.push(
          live
            .map((ro) => {
              const d = ro._monitor.renderObjects.get(ro);
              return d ? `${d.attributesDisposeVersion}/${d.outputTarget?.name ?? '-'}` : 'none';
            })
            .join(','),
        );
      },
    };
    const rb = {};
    const data: Any = { version: -1, dispose: 0 };
    if (patched) installReplayPatch(r);
    return { r, told, asked, records, recorded: () => recorded };
  };
  // The script: renders one after another, with a change made before some of them. The two flag steps are markers the run
  // reads (a program's flag is its observer's, which each run makes afresh).
  const flagOn = (): void => undefined;
  const flagOff = (): void => undefined;
  const script: ((m: { r: Any }) => void)[] = [
    () => undefined,
    () => undefined,
    () => undefined,
    () => meshes[1].matrixWorld.elements[12]++, // a matrix moved
    () => undefined,
    flagOn, // a flag turned on for a program
    () => undefined,
    flagOff, // and off again
    () => undefined,
    () => undefined,
    () => attributes.disposeVersion++, // an attribute disposed somewhere
    () => undefined,
    () => {
      target = targetB; // drawn into another target
    },
    () => undefined,
    () => {
      target = targetA;
    },
    () => undefined,
    () => group.version++, // recorded again
    () => undefined,
    () => undefined,
    () => undefined,
  ];
  // Each run needs its own render objects' records in the observers, so each runs on observers of its own: rebuild them.
  const run = (patched: boolean, n = ros.length, switchOn = true): { told: number[][]; asked: number; records: string[]; recorded: number } => {
    // Fresh observers and object state for each run, the same start.
    const fresh = [new NodeMaterialObserver(plainBuilder(meshes[0]) as Any), new NodeMaterialObserver(plainBuilder(meshes[4]) as Any), new NodeMaterialObserver({ material: { colorNode: { isNode: true } }, context: {}, object: meshes[6] } as Any), new NodeMaterialObserver(plainBuilder(skinned) as Any)];
    const map = [0, 0, 0, 0, 1, 1, 2, 3];
    for (let i = 0; i < ros.length; i++) ros[i]._monitor = fresh[map[i]];
    for (const mesh of meshes) mesh.matrixWorld.identity();
    attributes.disposeVersion = 0;
    gone.clear();
    target = targetA;
    group.version = 0;
    nodeFrame.renderId = 0;
    live = ros.slice(0, n);
    const m = make(patched);
    const was = DRAW_COST.replay;
    DRAW_COST.replay = switchOn;
    try {
      for (const step of script) {
        // The flags are the program's: read through whichever observer the shared program has in this run.
        const a = fresh[0];
        if (step === flagOn) a.hasNode = true;
        else if (step === flagOff) a.hasNode = false;
        else step(m);
        nodeFrame.renderId++;
        m.r._renderBundle({ bundleGroup: group, camera: null }, scene, lightsNode);
      }
    } finally {
      DRAW_COST.replay = was;
    }
    return { told: m.told, asked: m.asked.length, records: m.records, recorded: m.recorded() };
  };
  // With the patch on the stand-in loop records three's answer where three was asked and the patch's own "nothing" where it
  // answered, each at the object's place in the row.
  const flat = (rows: number[][]) => rows.map((r) => r.join('')).join(' ');
  // A bundle that holds things three refreshes in full whatever (a node of its own, a skeleton): never a clean replay, so
  // every object is asked, and every answer is three's.
  {
    const off = run(false);
    const on = run(true);
    ok(off.told.length === script.length && on.told.length === script.length, 'every render replayed the bundle once');
    ok(flat(on.told) === flat(off.told), `with flagged objects in it, every object is told what three tells it with the patch off (on ${flat(on.told)}, off ${flat(off.told)})`);
    ok(on.asked === off.asked, 'and a bundle holding a flagged object is never stepped over');
  }
  // A bundle of still things alone (the region tiers' are): after its first clean replay the patch asks only where three's
  // answer could be other than nothing.
  {
    const skipped0 = DRAW_STATS.replaySkipped;
    const off = run(false, 6);
    const on = run(true, 6);
    ok(flat(on.told) === flat(off.told), `every object is told what three tells it with the patch off, render by render, through a moved matrix, a flag on and off, an attribute disposed, another target and a bundle recorded again (on ${flat(on.told)}, off ${flat(off.told)})`);
    ok(/2/.test(flat(off.told)) && /1/.test(flat(off.told)), 'the script makes three answer both a full and a shared refresh, so the comparison is not of "nothing" alone');
    ok(on.asked < off.asked, `the patch asks three less even through a render of changes every second render (${on.asked} of ${off.asked})`);
    ok(DRAW_STATS.replaySkipped > skipped0, 'the patch counted what it stepped over');
    // Renders with nothing changed: three is asked once a program a render (two programs here) after the first replay.
    const quiet = script.splice(0, script.length);
    for (let i = 0; i < 20; i++) script.push(() => undefined);
    try {
      const qOff = run(false, 6);
      const qOn = run(true, 6);
      ok(flat(qOn.told) === flat(qOff.told), 'quiet renders: every object told what three tells it');
      ok(qOff.asked === 6 * 20 && qOn.asked === 6 + 6 + 2 * 18, `quiet renders: three is asked about every object in the first two replays and then once a program a render (${qOn.asked} of ${qOff.asked})`);
    } finally {
      script.splice(0, script.length, ...quiet);
    }
    // Off, the patch is three's own loop: asked as often as without it.
    const offAgain = run(true, 6, false);
    ok(offAgain.asked === off.asked && flat(offAgain.told) === flat(off.told), 'with its switch off the patch asks three about every object, as three does');
    // The records three's observers keep (the attributes and the target each object last saw) are three's own after every
    // render of the script: the patch steps over only what three would leave as it is.
    ok(on.records.join(' | ') === off.records.join(' | '), `every object's record of the attributes and the target it last saw is three's own after every render (on ${on.records.join(' | ')}, off ${off.records.join(' | ')})`);
  }
  // A real disposal (three's `Attributes.dispose`): one of the bundle's own objects loses its vertex buffer, and later a buffer
  // outside the bundle goes. Three records the bundle again for the first and refreshes that object in full, which uploads
  // its buffer again; the second records nothing. The patch must never answer "nothing" across either: the object whose
  // buffer went is told FULL, and after a disposal anywhere the next replay asks every object, so each one's record of the
  // attributes it last saw is three's own (stepped over, it would keep the old dispose count until it was next asked).
  {
    const quiet = script.splice(0, script.length);
    const noop = (): void => undefined;
    const disposeOwn = (): void => {
      gone.add(vbs[1]);
      attributes.disposeVersion++;
    };
    const disposeElsewhere = (): void => {
      attributes.disposeVersion++;
    };
    script.push(noop, noop, noop, disposeOwn, noop, noop, noop, disposeElsewhere, noop, noop, noop);
    try {
      const off = run(false, 6);
      const on = run(true, 6);
      const at = 3;
      ok(flat(on.told) === flat(off.told), `through a disposal of one of the bundle's own buffers and one elsewhere, every object is told what three tells it (on ${flat(on.told)}, off ${flat(off.told)})`);
      ok(off.told[at][1] === 2 && on.told[at][1] === 2, `the object whose buffer was disposed is refreshed in full, its buffer uploaded again, with the patch on as off (on ${on.told[at][1]}, off ${off.told[at][1]})`);
      ok(on.recorded === off.recorded && off.recorded === 2, `the bundle is recorded again for the disposal of its own buffer and for nothing else (on ${on.recorded}, off ${off.recorded})`);
      ok(on.records.join(' | ') === off.records.join(' | '), `after each render every object's record of the attributes and target it last saw is three's own, a disposal outside the bundle included (on ${on.records.join(' | ')}, off ${off.records.join(' | ')})`);
      ok(on.asked < off.asked, `and the quiet renders between still ask three less (${on.asked} of ${off.asked})`);
    } finally {
      script.splice(0, script.length, ...quiet);
    }
  }
}

// ---------------------------------------------------------------- 2. shadowCull
{
  const dp: Any = new StandardDrawingPipeline();
  const renderer: Any = { drawingPipeline: dp, sortObjects: false, backend: {}, _currentRenderObjectFunction: null };
  dp.renderer = renderer;
  installShadowCull(renderer);
  const scene = new THREE.Scene();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const things: Any[] = [];
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set((i % 4) - 1.5, 0, -5 - Math.floor(i / 4));
    m.castShadow = i % 3 === 0;
    m.receiveShadow = i % 2 === 0;
    scene.add(m);
    things.push(m);
  }
  scene.updateMatrixWorld();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  const walk = (fn: Any): Any[] => {
    renderer._currentRenderObjectFunction = fn;
    const listed: Any[] = [];
    const list: Any = { push: (o: Any) => listed.push(o), pushLight: () => undefined, pushBundle: () => undefined };
    dp.begin(camera, { frustumArray: null });
    dp.project(scene, camera, 0, list, null);
    return listed;
  };
  const shadowFn = Object.assign(() => undefined, { shadowType: 1 });
  const vsmFn = Object.assign(() => undefined, { shadowType: 3 });
  const mainFn = () => undefined;
  const drawnBy = (listed: Any[], vsm: boolean) => listed.filter((o) => o.castShadow === true || (vsm && o.receiveShadow === true));
  setDrawSwitch('shadowCull', true);
  const onShadow = walk(shadowFn);
  const onMain = walk(mainFn);
  const onVsm = walk(vsmFn);
  setDrawSwitch('shadowCull', false);
  const offShadow = walk(shadowFn);
  const offMain = walk(mainFn);
  const offVsm = walk(vsmFn);
  setDrawSwitch('shadowCull', true);
  const ids = (a: Any[]) => a.map((o) => o.id).join(',');
  ok(offShadow.length === 12 && offMain.length === 12, 'with the cull off three lists every thing in view in every pass');
  ok(ids(onShadow) === ids(drawnBy(offShadow, false)) && onShadow.length === 4, `in a shadow pass the cull lists exactly what the shadow function draws (${onShadow.length} of ${offShadow.length})`);
  ok(ids(onMain) === ids(offMain), 'a main pass is untouched');
  ok(ids(onVsm) === ids(drawnBy(offVsm, true)), "under the variance shadow type a receiver is kept, as three's shadow function draws it");
  ok(DRAW_STATS.shadowCulled >= 8, 'the cull counted what it took');
}

// ---------------------------------------------------------------- 3. the frame report's counters
{
  ok(writeBufferBytes(new Float32Array(16), undefined, undefined) === 64 && writeBufferBytes(new Float32Array(16), 4, undefined) === 48 && writeBufferBytes(new Float32Array(16), 0, 8) === 32 && writeBufferBytes(new ArrayBuffer(100), 10, undefined) === 90, "a writeBuffer's bytes read as WebGPU reads its offset and size (elements of a typed array, bytes of a buffer)");
  // The card's time is summed over whole frames of a resolved set (three's pool, uid `r:<call>:<context>:f<frame>`): a set
  // that began in the middle of frame 7 (its overflow) and ends after two passes of frame 10 (the last frame, three's own
  // answer) gives frames 8 and 9 whole, never 7's tail or 10's head.
  {
    const ts = new Map<string, number>();
    let call = 0;
    const pass = (frame: number, ms: number): void => void ts.set(`r:${call++}:4:f${frame}`, ms);
    pass(7, 0.2); pass(7, 0.1);
    for (const f of [8, 9]) { pass(f, 0.5); pass(f, 2.5); pass(f, 0.25); pass(f, 0.75); }
    pass(10, 0.5); pass(10, 0.4);
    const whole = completeCardFrames(ts);
    ok(whole.length === 2 && whole[0].frame === '8' && whole[1].frame === '9' && whole.every((f) => f.passes === 4 && f.ms === 4), `a resolved set's whole frames are those strictly between its first and last (${JSON.stringify(whole)})`);
    ok(completeCardFrames(new Map([['r:0:4:f3', 1], ['r:1:4:f4', 1]])).length === 0 && completeCardFrames(new Map()).length === 0, 'a set of two frames or fewer holds no whole one');
  }
  const g = globalThis as Any;
  const names = ['GPURenderPassEncoder', 'GPURenderBundleEncoder', 'GPUQueue', 'GPUCommandEncoder', 'GPUDevice'];
  const had = names.map((n) => g[n]);
  class Pass {
    setPipeline() {}
    setBindGroup() {}
    draw() {}
    drawIndexed() {}
    executeBundles() {}
  }
  class Queue {
    writeBuffer() {}
    writeTexture() {}
    submit() {}
  }
  g.GPURenderPassEncoder = Pass;
  g.GPUQueue = Queue;
  const origSet = Pass.prototype.setPipeline;
  const r: Any = { _renderObjectDirect() {}, _renderBundle() {}, _renderScene() {}, _nodes: { needsRefresh: () => 2 } };
  const ownBefore = Object.keys(r).length;
  try {
    const c = installCounters(r);
    const p: Any = new Pass();
    const q: Any = new Queue();
    p.setPipeline();
    p.setPipeline();
    p.setBindGroup(0, {});
    p.drawIndexed(3);
    p.executeBundles([1, 2, 3]);
    q.writeBuffer({}, 0, new Float32Array(4));
    q.submit([]);
    r._renderObjectDirect();
    r._nodes.needsRefresh({});
    c.remove();
    ok(c.counts.calls.get('GPURenderPassEncoder.setPipeline') === 2 && c.counts.calls.get('GPURenderPassEncoder.setBindGroup') === 1 && c.counts.bundlesExecuted === 3 && c.counts.bufferBytes === 16 && c.counts.objects === 1 && c.counts.refresh[2] === 1, 'the counters count each call, the bundles executed, the bytes written, the objects handled and the refreshes by kind');
    ok(Pass.prototype.setPipeline === origSet && Object.keys(r).length === ownBefore && typeof r._nodes.needsRefresh === 'function', 'every wrapper is taken out after the counting window');
  } finally {
    names.forEach((n, i) => (g[n] = had[i]));
  }
}

// ---------------------------------------------------------------- 4. nothing more made a frame
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--expose-gc', new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--alloc'], { encoding: 'utf8', timeout: 300000 });
  const line = (r.stdout ?? '').trim().split('\n').pop() ?? '';
  let b: Record<string, number> = {};
  try {
    b = JSON.parse(line);
  } catch {
    ok(false, `the allocation measure answered (${line || r.stderr})`);
  }
  for (const k of ['replay', 'shadowCull']) {
    const on = b[`${k}.on`], off = b[`${k}.off`];
    ok(Number.isFinite(on) && Number.isFinite(off), `${k}: measured with no collection in the window (${on}, ${off})`);
    ok(on <= off + 0.5, `${k}: with it on a render makes no more than with it off (${on.toFixed(2)} bytes a render against ${off.toFixed(2)})`);
  }
}

console.log(`gpuDraw: ${checks} checks passed`);
