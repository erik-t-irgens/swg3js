// The third of the port's four private patches of three (the GPU port's step 3, items 8 and 9; `patchTable.ts`): the
// spike's warm-up (`A:\swg3js\webgpu\tree\src\spike\webgpu\q2Materials.ts`, commit 52106df), made the game's own
// compile on WebGPU, and only where `patchApplies` says three is the revision it was written for.
//
// The game compiles through `renderer.compile` (a pass's layers on the camera, its target bound, its own scene as the
// target scene; `World.compileFor`, `compileOne`), and on WebGPU both `compile` and `compileAsync` hand over to `compile`
// here (`RT_HOOKS.compile`). Three's own `compileAsync` would serve for the scene's pass but misses the shadow passes
// altogether (three 0.187 draws no shadow map while precompiling), and with the shadow material as the scene's override
// it forgets the adjustments three makes to it for each caster (its side, its cut, its colour and position nodes), so it
// would build the wrong program. So, as the spike did:
//  1. **list** what a pass would draw by three's own walk: `compileAsync`'s synchronous half, with `_createObjectPipeline`
//     swapped for a list for that one turn, each item with its render context, its source material and the shadow
//     override's adjustments as they stood for it. Synchronous: the camera's layers, the target and the scene are read as
//     the caller set them. The scene's pass for the objects handed over (each forced visible and unculled for the walk, as
//     WebGL's compile takes every material whatever its object's visibility, the game's tiers being hidden until their
//     programs exist), and where the pass sees the sun's layer, each of the sun's cascades with its shadow material as
//     the override and its map as the target, casters alone;
//  2. **build** each item on its own clock (`WARM_TUNE.sliceMs` of the main thread a turn, a message's breath between,
//     never a frame's): its render object, node graph, geometry, nodes and bindings made synchronously, its pipeline
//     asynchronously (`createRenderPipelineAsync`), at most `WARM_TUNE.inFlight` at once. A frame that draws an item
//     before its pipeline lands finds the pipeline in three's cache, not ready, and skips the draw: no frame waits on a
//     pipeline. Items of one burst that would build the same program twice (one material on many objects) are built once.
// Each call answers once its own items are built and their pipelines have landed (or `WARM_TUNE.landMs` has gone by,
// counted lost: a pipeline three failed to make is said in the console by three itself); `compiled()` answers once
// everything handed over so far has. Every loading screen's sweep waits on `compiled()` (`World.sweepBatches`), and
// anything made ready in play waits on its own calls (`World.gpuReady`, `since`).
//
// With the switch off (`WARM_PATCH.on`, `gpu({ patches: { warm: false } })`, `localStorage['swg.gpu.patch.warm'] = '0'`
// at load) the same calls go to three's own `compileAsync` over the same objects, waited for the same way: no shadow
// pass is warmed.
//
// The pipelines three makes are counted here too, by whether a draw made one synchronously (the main thread waited for
// it) or one was asked for ahead, and whether a loading screen was up: `__debug.gpu()`'s pipelines made in play.

import * as THREE from 'three';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const WARM_PATCH = { on: true, applied: false, why: '' as string };

/**
 * The warm-up's own numbers (ours): the main thread's slice a turn behind a screen and in play (a node graph built
 * synchronously costs a few milliseconds), the pipelines in flight at once (Chrome makes them on its GPU process, which
 * on a cold shader cache took about one a second here whatever the number in flight), and how long a pipeline is waited
 * for before it is counted lost.
 */
export const WARM_TUNE = { sliceMs: 8, sliceInPlayMs: 3, inFlight: 32, landMs: 30000 };

/** What it has done: items listed and built, duplicates skipped, pipelines asked for, its time, and what three made by itself. */
export const WARM_STATS = {
  calls: 0,
  listed: 0,
  shadowListed: 0,
  built: 0,
  same: 0,
  pipelinesAsked: 0,
  pipelinesLanded: 0,
  pipelinesLost: 0,
  listMs: 0,
  buildMs: 0,
  longestItemMs: 0,
  /** Pipelines made synchronously by a draw (the main thread waited), behind a screen and in play. */
  drawMadeBehind: 0,
  drawMadeInPlay: 0,
  /** Of those made in play, the ones for an object the warm-up had listed (its pipeline came out other than the draw's). */
  drawInPlayOfWarmed: 0,
  /** Pipelines asked for asynchronously (by this warm-up or three's own compileAsync), behind a screen and in play. */
  asyncBehind: 0,
  asyncInPlay: 0,
  /** Labels of the last few pipelines a draw made in play. */
  lastInPlay: [] as string[],
  errors: 0,
  lastError: '',
};

/** The adjustments three makes to the shadow material for each caster (`Renderer.renderObject`). */
const TWEAKS = ['side', 'alphaTest', 'alphaMap', 'displacementMap', 'displacementScale', 'displacementBias', 'transparent', 'colorNode', 'depthNode', 'positionNode'] as const;

/** One call's work: how much of it is still out, and its answer. */
interface Job {
  left: number;
  seq: number;
  resolve: () => void;
}

interface Item {
  a: Any[];
  ctx: Any;
  tweak: Any[] | null;
  /** The material's side as the walk drew it: three draws a blended two-sided thing twice, back then front (`renderObject`). */
  side: number;
  src: Any;
  scene: Any;
  job: Job | null;
}

export interface WarmDeps {
  /** The shadow nodes of the sun's cascades as they stand (three's `CSMShadowNode._shadowNodes`), or none. */
  shadowNodes(): Any[];
  /** Whether a loading screen is up now (pipelines a draw makes then are not "in play"). */
  loading(): boolean;
}

export interface Warm {
  /** The game's compile on WebGPU: lists now, builds on its own clock; answers when this call's items are built and landed. */
  compile(root: THREE.Object3D, camera: THREE.Camera, targetScene: THREE.Scene | null): Promise<void>;
  /** Answers once everything handed over so far is built and every pipeline asked for has landed. */
  compiled(): Promise<void>;
  /** The count of calls made so far, to wait for the calls made after it (`since`). */
  mark(): number;
  /** Answers once every call made after `mark` is answered. */
  since(mark: number): Promise<void>;
  /** Items listed and not yet built, and pipeline batches in flight. */
  pending(): { items: number; inFlight: number };
}

/** A macrotask's breath: a message to itself, which a hidden tab never throttles (a timer would wait a second there). */
const channel = typeof MessageChannel === 'undefined' ? null : new MessageChannel();
const waiting: (() => void)[] = [];
if (channel) channel.port1.onmessage = () => waiting.shift()?.();
const breath = (): Promise<void> =>
  new Promise((r) => {
    if (!channel) {
      setTimeout(r, 0);
      return;
    }
    waiting.push(r);
    channel.port2.postMessage(0);
  });

export function installWarm(renderer: Any, nativeCompileAsync: (scene: Any, camera: Any, target?: Any) => Promise<unknown>, deps: WarmDeps): Warm {
  const r = renderer;
  /** Objects the warm-up has listed, for the console's word on a pipeline a draw made in play, and how it last built one. */
  const builtFor = new WeakSet<object>();
  const builtHow = new WeakMap<object, string>();
  /** A render object's context, pass, side, scene, layers and lights, as words (the console's, on a pipeline made in play). */
  const howOf = (ro: Any): string => `ctx ${ro?.context?.id} pass ${ro?.passId ?? '-'} side ${ro?.material?.side} scene ${ro?.scene?.id} layers ${ro?.camera?.layers?.mask} lights ${ro?.lightsNode?.getCacheKey?.() ?? '?'} key ${String(ro?.getCacheKey?.() ?? '').slice(0, 40)}`;
  // ---- counting every pipeline three makes, by who asked ------------------------------------------------------------------
  // A wrap of three's private `WebGPUBackend.createRenderPipeline` (whose second argument says a draw made it, null, or a
  // precompile, a list): the patch's own, so only where the patch applied (`patchApplies`: three is the revision it was
  // written for, the method is there). Elsewhere the counts stay at nought and the report says the patch did not apply.
  const be = r.backend;
  if (WARM_PATCH.applied) {
    const createRenderPipeline = be.createRenderPipeline.bind(be);
    be.createRenderPipeline = (ro: Any, promises: Any) => {
      const behind = deps.loading();
      if (promises === null || promises === undefined) {
        if (behind) WARM_STATS.drawMadeBehind++;
        else {
          WARM_STATS.drawMadeInPlay++;
          const m = ro?.material;
          // Whether the warm-up had been handed this object at all: the console's clue to what is not warmed.
          const was = !!ro?.object && builtFor.has(ro.object);
          if (was) WARM_STATS.drawInPlayOfWarmed++;
          const warmed = was ? `warmed as ${builtHow.get(ro.object) ?? '?'}, drawn as ${howOf(ro)}` : 'never warmed';
          const name = `${m?.isShadowPassMaterial ? 'shadow of ' : ''}${m?.name || m?.type || '?'}#${m?.id ?? '?'} on ${ro?.object?.name || ro?.object?.type || '?'}#${ro?.object?.id ?? '?'} (${warmed})`;
          WARM_STATS.lastInPlay.push(name.slice(0, 320));
          if (WARM_STATS.lastInPlay.length > 12) WARM_STATS.lastInPlay.shift();
        }
      } else if (behind) WARM_STATS.asyncBehind++;
      else WARM_STATS.asyncInPlay++;
      return createRenderPipeline(ro, promises);
    };
  }

  // ---- the work: items listed, built on their own clock -------------------------------------------------------------------
  const queue: Item[] = [];
  let head = 0;
  let running = false;
  /** Pipeline batches asked for and not landed. */
  let inFlight = 0;
  /** Calls made, and the ones not yet answered by their count. */
  let calls = 0;
  const open = new Map<number, Promise<void>>();
  const idleWaiters: (() => void)[] = [];
  /** What this burst has built already, by what decides its program: built once however many objects share it. */
  const seen = new Set<string>();

  const keyOf = (it: Item): string => {
    // The scene and its lights are in it: one object warmed for the world's pass and a room's in one burst is two
    // pipelines (each pass draws through a scene of its own with its own lights, `passScenes.ts`), and keyed without
    // them the room's was taken for the world's and never built.
    const [object, material, scene, , lightsNode, , , passId] = it.a;
    const g = object.geometry;
    // Three keys a program on its morph targets' own attributes (`getGeometryCacheKey`), so a morphed geometry is its own.
    const morph = (g?.morphAttributes?.position?.length ?? 0) > 0 ? `m${g.id}` : '0';
    const attrs = g ? Object.keys(g.attributes).join(',') : '';
    const kind = `${object.isInstancedMesh ? 'I' : ''}${object.isSkinnedMesh ? 'S' : ''}${object.isBatchedMesh ? 'B' : ''}${object.isPoints ? 'P' : ''}${object.isLine ? 'L' : ''}${object.isSprite ? 'Sp' : ''}`;
    const tw = it.tweak ? `${it.tweak[0]}|${it.tweak[1]}|${it.tweak[2] ? 1 : 0}|${it.tweak[6] ? 1 : 0}|${it.tweak[7]?.id ?? '-'}|${it.tweak[9]?.id ?? '-'}` : '';
    return `${it.ctx?.id}:${scene?.id ?? '-'}:${lightsNode?.id ?? '-'}:${material.id}:${it.src?.id ?? '-'}:${it.side}:${passId ?? ''}:${kind}:${morph}:${attrs}:${tw}`;
  };

  const settleIdle = (): void => {
    if (head < queue.length || inFlight > 0 || running) return;
    queue.length = 0;
    head = 0;
    // A burst's duplicates are its own: three lets a pipeline go once nothing uses it (a world's objects disposed), so
    // what was built in an earlier burst may be gone, and is built again when it is next listed.
    seen.clear();
    while (idleWaiters.length) idleWaiters.shift()!();
  };

  /** One piece of a call's work done (an item handled, a batch of its pipelines landed). */
  const done = (job: Job | null): void => {
    if (!job) return;
    if (--job.left <= 0) {
      open.delete(job.seq);
      job.resolve();
    }
  };

  /** Waits for a batch of pipelines, bounded: one three never answers is counted lost and waited for no longer. */
  const land = (promises: Promise<unknown>[], job: Job | null): void => {
    WARM_STATS.pipelinesAsked += promises.length;
    inFlight++;
    if (job) job.left++;
    let over = false;
    const finish = (lost: boolean): void => {
      if (over) return;
      over = true;
      inFlight--;
      if (lost) WARM_STATS.pipelinesLost += promises.length;
      else WARM_STATS.pipelinesLanded += promises.length;
      done(job);
      settleIdle();
    };
    const timer = setTimeout(() => finish(true), WARM_TUNE.landMs);
    void Promise.all(promises).then(
      () => {
        clearTimeout(timer);
        finish(false);
      },
      () => {
        clearTimeout(timer);
        finish(false);
      },
    );
  };

  const buildOne = (it: Item): Promise<unknown>[] => {
    const [object, material, scene, camera, lightsNode, grp, clip, passId] = it.a;
    const promises: Promise<unknown>[] = [];
    const before = it.tweak ? TWEAKS.map((k) => material[k]) : null;
    // The alpha test goes in under its setter's own field (three does the same, so the material's version does not move).
    const put = (k: string, v: Any) => (k === 'alphaTest' && '_alphaTest' in material ? (material._alphaTest = v) : (material[k] = v));
    if (it.tweak) TWEAKS.forEach((k, i) => put(k, it.tweak![i]));
    // The side the walk drew it with (a blended two-sided thing's back and front passes), as three's own precompile does.
    const side = material.side;
    material.side = it.side;
    const source = r._currentSourceMaterial;
    const ctx = r._currentRenderContext;
    const sceneOverride = it.scene ? it.scene.overrideMaterial : null;
    r._currentSourceMaterial = it.src ?? null;
    // Node builds take their shared bind groups from the current render context (three 0.187's precompile does the same).
    r._currentRenderContext = it.ctx;
    // And the scene says which material is the override for as long as the object is built: three keeps a material's
    // program key by its version unless it is the scene's override, whose key it works out each time.
    if (it.tweak && it.scene) it.scene.overrideMaterial = material;
    try {
      const ro = r._objects.get(object, material, scene, camera, lightsNode, it.ctx, clip, passId);
      ro.drawRange = object.geometry.drawRange;
      ro.group = grp;
      ro.getNodeBuilderState();
      builtHow.set(object, howOf(ro));
      r._geometries.updateForRender(ro);
      r._nodes.updateForRender(ro);
      r._bindings.updateForRender(ro);
      r._pipelines.getForRender(ro, promises);
    } finally {
      material.side = side;
      if (before) TWEAKS.forEach((k, i) => put(k, before[i]));
      r._currentSourceMaterial = source;
      r._currentRenderContext = ctx;
      if (it.tweak && it.scene) it.scene.overrideMaterial = sceneOverride;
    }
    return promises;
  };

  /** One item handled: built (its pipelines asked for) unless this burst built its program already. */
  const handle = (it: Item): void => {
    const key = keyOf(it);
    if (seen.has(key)) {
      WARM_STATS.same++;
      done(it.job);
      return;
    }
    seen.add(key);
    const t = performance.now();
    let promises: Promise<unknown>[] = [];
    try {
      promises = buildOne(it);
      WARM_STATS.built++;
    } catch (err) {
      WARM_STATS.errors++;
      WARM_STATS.lastError = String((err as Error)?.message ?? err).slice(0, 300);
    }
    const ms = performance.now() - t;
    WARM_STATS.buildMs += ms;
    if (ms > WARM_STATS.longestItemMs) WARM_STATS.longestItemMs = ms;
    if (promises.length) land(promises, it.job);
    done(it.job);
  };

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      let sliceFrom = performance.now();
      while (head < queue.length) {
        const it = queue[head];
        queue[head++] = null as unknown as Item;
        handle(it);
        while (inFlight >= WARM_TUNE.inFlight) await breath();
        const slice = deps.loading() ? WARM_TUNE.sliceMs : WARM_TUNE.sliceInPlayMs;
        if (performance.now() - sliceFrom > slice) {
          await breath();
          sliceFrom = performance.now();
        }
      }
    } finally {
      running = false;
      settleIdle();
    }
  };

  // ---- the listing ------------------------------------------------------------------------------------------------------
  /** One walk of three's own: what this pass would draw of `root` (a scene, or a stand-in holding the objects as children). */
  const list = (root: Any, camera: Any, targetScene: Any, override: Any, shadow: boolean, out: Item[]): void => {
    const sceneRef = root.isScene === true ? root : targetScene?.isScene === true ? targetScene : null;
    const prev = { override: sceneRef?.overrideMaterial ?? null, background: sceneRef?.background ?? null, create: r._createObjectPipeline };
    r._createObjectPipeline = function (this: Any, ...a: Any[]) {
      // The shadow pass draws casters alone (three's own render object function for it).
      if (shadow && a[0]?.castShadow !== true) return;
      builtFor.add(a[0]);
      out.push({ a, ctx: this._currentRenderContext, tweak: override ? TWEAKS.map((k) => a[1][k]) : null, side: a[1].side, src: this._currentSourceMaterial, scene: sceneRef, job: null });
    };
    if (override && sceneRef) {
      sceneRef.overrideMaterial = override;
      sceneRef.background = null;
    }
    let p: Promise<unknown> | null = null;
    try {
      // The synchronous half of three's own compile walks and lists; its own queue stays empty, so what it answers
      // settles with nothing more done.
      p = nativeCompileAsync(root, camera, targetScene ?? null);
    } finally {
      r._createObjectPipeline = prev.create;
      if (override && sceneRef) {
        sceneRef.overrideMaterial = prev.override;
        sceneRef.background = prev.background;
      }
    }
    void p?.catch(() => undefined);
  };

  /** The objects a compile is handed, as the drawables three would walk: a scene as it stands, else every drawable under the root. */
  const holder = new THREE.Object3D();
  holder.matrixWorldAutoUpdate = false;
  holder.matrixAutoUpdate = false;
  const drawables: Any[] = [];
  const kept: { o: Any; v: boolean; f: boolean }[] = [];
  /** Every drawable under a root shown and unculled for a walk, each a child of a holder that is no parent of any. */
  const holdOut = (root: Any): Any => {
    drawables.length = 0;
    root.traverse((o: Any) => {
      if ((o.isMesh || o.isLine || o.isPoints || o.isSprite) && o.material) drawables.push(o);
    });
    kept.length = 0;
    for (const o of drawables) {
      kept.push({ o, v: o.visible, f: o.frustumCulled });
      o.visible = true;
      o.frustumCulled = false;
    }
    (holder as Any).children = drawables;
    return holder;
  };
  const putBack = (): void => {
    for (const k of kept) {
      k.o.visible = k.v;
      k.o.frustumCulled = k.f;
    }
    kept.length = 0;
    (holder as Any).children = [];
    drawables.length = 0;
  };

  /** A call's answer, filed by its count until it is answered. */
  const answer = (p: Promise<void>): Promise<void> => {
    const seq = ++calls;
    open.set(seq, p);
    void p.then(() => open.delete(seq));
    return p;
  };

  const compile = (root: THREE.Object3D, camera: THREE.Camera, targetScene: THREE.Scene | null): Promise<void> => {
    WARM_STATS.calls++;
    const t0 = performance.now();
    const isScene = (root as Any).isScene === true;
    // The game's own stand-in roots (`World.rootOf`) list their objects by `traverse` and hold no children of their own.
    const walkRoot = isScene ? root : holdOut(root);
    if (!WARM_PATCH.on || !WARM_PATCH.applied) {
      // Three's own compile over the same objects, waited for the same way: no shadow pass is warmed. Its walk is
      // synchronous (its items keep their objects), so what was shown for it is put back at once.
      let p: Promise<unknown>;
      try {
        p = nativeCompileAsync(walkRoot, camera, targetScene ?? null).catch(() => undefined) as Promise<unknown>;
      } finally {
        if (!isScene) putBack();
        WARM_STATS.listMs += performance.now() - t0;
      }
      inFlight++;
      const fin = (): void => {
        inFlight--;
        settleIdle();
      };
      void p.then(fin, fin);
      return answer(p.then(() => undefined));
    }
    const items: Item[] = [];
    try {
      list(walkRoot, camera, targetScene, null, false, items);
      const sceneItems = items.length;
      WARM_STATS.listed += sceneItems;
      // The sun's cascades, where this pass sees the sun's layer and the shadows are on.
      const shadowScene = targetScene ?? (isScene ? root : null);
      if (shadowScene && r.shadowMap?.enabled && camera.layers.test(SUN_LAYERS)) {
        // Three makes a cascade's map only when it first builds a program lit by the sun: the first of this pass's items
        // built here until the maps stand, so the very first compile of a world lists its shadows too.
        const nodes = deps.shadowNodes();
        // Handled now, before the call has its job: left in the list, each is a duplicate the burst steps over in the queue.
        for (let i = 0; i < items.length && i < 64 && nodes.some((sn) => sn && !sn.shadowMap); i++) handle(items[i]);
        for (const sn of nodes) {
          if (!sn?.shadowMap || typeof sn.getShadowMaterial !== 'function') continue;
          const sc = sn.shadow?.camera;
          if (!sc) continue;
          const mask = sc.layers.mask;
          // As three draws the map: the shadow camera sees what the pass's camera sees where it has no layers of its own.
          if ((mask & 0xfffffffe) === 0) sc.layers.mask = camera.layers.mask;
          const target = r.getRenderTarget();
          const face = r.getActiveCubeFace();
          const mip = r.getActiveMipmapLevel();
          r.setRenderTarget(sn.shadowMap);
          try {
            list(walkRoot, sc, shadowScene, sn.getShadowMaterial(), true, items);
          } finally {
            r.setRenderTarget(target, face, mip);
            sc.layers.mask = mask;
          }
        }
        WARM_STATS.shadowListed += items.length - sceneItems;
      }
    } finally {
      if (!isScene) putBack();
      WARM_STATS.listMs += performance.now() - t0;
    }
    if (!items.length) return Promise.resolve();
    const p = new Promise<void>((resolve) => {
      const job: Job = { left: items.length, seq: 0, resolve };
      for (const it of items) {
        it.job = job;
        queue.push(it);
      }
    });
    void run();
    return answer(p);
  };

  const compiled = (): Promise<void> =>
    new Promise<void>((res) => {
      if (head >= queue.length && inFlight === 0 && !running) res();
      else idleWaiters.push(res);
    });

  const mark = (): number => calls;
  const since = (m: number): Promise<void> => {
    const wait: Promise<void>[] = [];
    for (const [seq, p] of open) if (seq > m) wait.push(p);
    return wait.length ? Promise.all(wait).then(() => undefined) : Promise.resolve();
  };

  return { compile, compiled, mark, since, pending: () => ({ items: queue.length - head, inFlight }) };
}

/** The sun's layer: a pass whose camera sees it draws with the sun, and three draws the sun's maps in it. */
const SUN_LAYERS = new THREE.Layers();
SUN_LAYERS.set(0);
