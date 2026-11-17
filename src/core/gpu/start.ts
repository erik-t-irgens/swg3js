// The WebGPU side of the game (the GPU port's step 3), reached by one dynamic import from the boot and only with the
// switch at WebGPU (`gpuSwitch.ts`). Nothing here is loaded on the WebGL path.
//
// `startWebGPU` makes three's `WebGPURenderer` on the game's canvas (the WebGPU backend, never `forceWebGL`), waits for
// `init()`, and gives it what the game's WebGL-shaped code reads of a renderer without throwing:
//   - `info.programs` an empty list (WebGPU keeps pipelines, not programs; every reader already takes "none"),
//   - `properties` that knows no material (`has` false, `get` an empty record),
//   - `debug` with shader checks off, `state` with the two calls the game makes on it (the stencil's clear value and the
//     depth test's question), and `compile` the runtime's own (`GpuRuntime.compile`, which hands over to the warm-up),
// then installs the one fallback for materials three cannot draw (`fallback.ts`), the four private patches of three's
// (`patches.ts`, each only where it applies), the warm-up (`patchWarm.ts`, which `compile` and `compileAsync` reach
// through `RT_HOOKS.compile`) and the region tiers' render bundles (`bundles.ts`).
// What it hands back is `GpuRuntime`: the renderer, the stand-ins, the sun's cascades, the bundles, the warm-up's waits,
// the frame's counters, the console's switches and its report.

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { GpuFrameStats, GpuRuntime, GpuSun, GpuSunOptions } from '../gpuSwitch.ts';
import { installFallback, type FallbackStats } from './fallback.ts';
import { makeStandIns } from './standIns.ts';
import { makeSun } from './sun.ts';
import { GPU_LOOK, tuneGpuLook } from './gpuLook.ts';
import { wrapConsole } from './consoleWords.ts';
import { applyPatches, isPatchName, patchReport, setPatch } from './patches.ts';
import { installWarm, WARM_PATCH, WARM_STATS, WARM_TUNE } from './patchWarm.ts';
import { BUNDLE_TUNE, TierBundles } from './bundles.ts';
import { installUsageHint, setUsageHint, USAGE_HINT } from './usageHint.ts';
import { installLooks, LOOK_PARTS, LOOKS_AT_LOAD, looksReport, setLooks } from './looks.ts';
import { DETAIL_GPU_STATS, detailPart } from './gpuDetail.ts';
import { SPEC_GPU_STATS, specPart } from './gpuSpec.ts';
import { specSelfTestGpu } from './gpuSpecSelfTest.ts';
import { CARD_GPU_STATS, cardPart } from './gpuCard.ts';
import { cardLightSelfTestGpu, leafShadowSelfTestGpu } from './gpuCardSelfTest.ts';
import { carriesReport, STAYS } from './carries.ts';
import { NOT_PORTED } from './carries.ts';
import { programsReport } from './gpuPrograms.ts';
import { makeGpuEnvironment } from './gpuEnv.ts';
import { GROUND_GPU_STATS } from './gpuGround.ts';
import { groundSelfTestGpu, horizonSelfTestGpu, type HorizonSelfTestInput } from './gpuGroundSelfTest.ts';
import { chainRuntime } from './gpuChainPasses.ts';
import { INLINE, inlineReport, installInline } from './inlineOutput.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The adapter as WebGPU describes it, asked of an adapter of our own (three keeps none it hands back). */
export interface AdapterInfo {
  vendor: string;
  architecture: string;
  description: string;
  device: string;
  fallback: boolean;
  features: string[];
}

/**
 * What the rest of the step plugs in: the warm-up's compile (`patchWarm.ts`, set by `startWebGPU`) and anything more for the
 * report. Each is null until it is set; the runtime calls through them.
 */
export const RT_HOOKS: {
  compile: ((renderer: Any, scene: THREE.Object3D, camera: THREE.Camera, target: THREE.Scene | null) => Promise<void>) | null;
  report: ((out: Record<string, unknown>) => void) | null;
} = { compile: null, report: null };

/** Three's own methods the runtime stood in for on the renderer, kept for whoever builds on them (the warm-up). */
export const NATIVE: { compileAsync: ((scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene | null) => Promise<unknown>) | null } = { compileAsync: null };

async function askAdapter(): Promise<AdapterInfo | null> {
  const gpu = (navigator as Any).gpu;
  if (!gpu) return null;
  const a = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!a) return null;
  const i = a.info ?? {};
  return { vendor: String(i.vendor ?? ''), architecture: String(i.architecture ?? ''), description: String(i.description ?? ''), device: String(i.device ?? ''), fallback: !!(a.isFallbackAdapter ?? i.isFallbackAdapter), features: [...a.features].map(String).sort() };
}

/** The WebGL-shaped fields the game reads of a renderer, given to the WebGPU one (this module runs on WebGPU alone). */
function shim(r: Any): void {
  if (!Array.isArray(r.info.programs)) r.info.programs = [];
  if (!r.properties) {
    const none = Object.freeze({});
    r.properties = { has: () => false, get: () => none, remove() {}, update() {} };
  }
  if (!r.debug) r.debug = { checkShaderErrors: false, onShaderError: null };
  if (!r.extensions) r.extensions = { has: () => false, get: () => null };
  if (!r.state) {
    r.state = {
      buffers: {
        stencil: { setClear: (v: number) => r.setClearStencil(v) },
        depth: { setFunc() {}, getReversed: () => r.reversedDepthBuffer === true },
        color: { setClear() {} },
      },
      reset() {},
    };
  }
  if (!r.shadowMap.render) r.shadowMap.render = () => {};
}

export async function startWebGPU(canvas: HTMLCanvasElement, opts: { reversedDepth: boolean; timestamps: boolean }): Promise<GpuRuntime> {
  if (!(navigator as Any).gpu) throw new Error('this browser has no navigator.gpu');
  const adapter = await askAdapter();
  if (!adapter) throw new Error('no WebGPU adapter was given');
  const renderer: Any = new WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: true, reversedDepthBuffer: opts.reversedDepth, trackTimestamp: opts.timestamps } as Any);
  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) throw new Error('three fell back to its WebGL2 backend');
  const device = renderer.backend.device;
  const granted: string[] = device ? [...device.features].map(String).sort() : [];
  shim(renderer);
  // Three's own reset of its counters runs at its own animation frame, which the game's frame does not line up with: the
  // counters are never reset by three, and the frame's draws are read as what they rose by (`endFrame`).
  renderer.info.autoReset = false;
  // The game's `DynamicDrawUsage` hint dropped as it is set, before any world is made (`usageHint.ts`).
  installUsageHint();
  // A rectangle put on the card by `copyTextureToTexture` from a data texture holding it (the far rings' windows, the shape
  // window and the edits, step 5): WebGL's copy uploads the source's own bytes as they stand at every call, whatever its
  // version; WebGPU's copies texture to texture, takes a source never marked for upload as a 1 by 1 picture, and copies a
  // source the field refills in place (the shape window's whole stand-in and its block, kept and rewritten) from its first
  // upload for good. So a data source holding bytes is marked at every copy, and its bytes go up first, as on WebGL.
  const copyTexture = renderer.copyTextureToTexture.bind(renderer);
  renderer.copyTextureToTexture = (src: Any, dst: Any, ...rest: Any[]) => {
    if ((src?.isDataTexture === true || src?.isDataArrayTexture === true) && src.image?.data) src.needsUpdate = true;
    return copyTexture(src, dst, ...rest);
  };
  const fallback: FallbackStats = installFallback(renderer);
  // The models' own looks on the node copies three makes (step 4): the detail map's colour, then the client's highlight,
  // then the leaf cards' changes to that highlight's lighting (`gpuCard.ts`).
  LOOK_PARTS.push(detailPart, specPart, cardPart);
  installLooks(renderer);
  // The Effects-off picture drawn the way WebGL draws it (step 6, item 5): every material's output tone-mapped and encoded
  // onto the canvas, before any material is built.
  installInline(renderer, LOOKS_AT_LOAD.inline);
  // The four private patches (item 8), each only where three is the revision it was written for.
  applyPatches(renderer);
  const forcedOff = new Map<string, string>();
  const standIns = makeStandIns();
  // The frame's counters: draws and triangles read off three's own (never reset by the game's passes), and the pipelines
  // three holds, with those made while no loading screen was up counted apart.
  const frame = { draws: 0, triangles: 0, pipelines: 0, madeInPlay: 0, lastDraws: 0, lastTris: 0, skipped: 0 };
  const pipelinesNow = (): number => renderer._pipelines?.caches?.size ?? 0;
  let errors = 0;
  let lastError = '';
  /** The last sun made (a world's cascades on WebGPU), for the report. */
  let sunNow: GpuSun | null = null;
  const onError = renderer.onError?.bind(renderer);
  renderer.onError = (info: Any) => {
    errors++;
    lastError = String(info?.message ?? info).slice(0, 300);
    onError?.(info);
  };
  // Whether a loading screen was up at the last frame's end (`endFrame`): what a pipeline made now counts as.
  let loadingNow = true;
  // The region tiers' bundles (item 7): shown within the sun's shadow reach as well as the view.
  const bundles = new TierBundles();
  bundles.shadowReach = () => (sunNow && renderer.shadowMap.enabled && (sunNow.light as Any).castShadow ? Number((sunNow.node as Any)?.maxFar ?? 0) : 0);
  try {
    if (localStorage.getItem('swg.gpu.bundles') === '0') BUNDLE_TUNE.on = false;
  } catch {
    // Storage refused: the default.
  }
  // Three's own compileAsync, kept before the runtime stands in for it, and the warm-up over it (item 9).
  const nativeCompileAsync = renderer.compileAsync.bind(renderer);
  const warm = installWarm(renderer, nativeCompileAsync, {
    shadowNodes: () => ((sunNow?.node as Any)?._shadowNodes ?? []) as Any[],
    loading: () => loadingNow,
  });
  RT_HOOKS.compile = (_r, scene, camera, target) => warm.compile(scene, camera, target);
  // Reflections (step 4): the black stand-in made here, at start, behind the first loading screen, with the dome's generator.
  const environment = makeGpuEnvironment(renderer);
  // The effects chain (step 6): the ported passes, put on the WebGL path's own runner by its constructor and its install.
  const chain = chainRuntime(renderer);
  const rt: GpuRuntime & {
    fallback: FallbackStats;
    adapter: AdapterInfo;
  } = {
    look(o: Record<string, unknown>) {
      return { ...tuneGpuLook(o as Partial<typeof GPU_LOOK>), ...setLooks(o) };
    },
    wrapConsole(debug: Record<string, unknown>) {
      // The occlusion's console (step 6, item 4): the WebGL helper as it stands, its probe of the centre a WebGPU readback
      // the answer waits for, and what the pass drew of the water.
      const ssao0 = debug.ssao as ((o?: unknown) => unknown) | undefined;
      wrapConsole(debug, () => ({ draws: frame.draws, triangles: frame.triangles, pipelinesHeld: pipelinesNow(), pipelinesMadeInPlay: frame.madeInPlay, drawsSteppedOver: frame.skipped, timestamps: renderer.backend?.trackTimestamp === true ? 'on' : "off (localStorage['swg.gpu.timestamps'] = '1' and a reload)" }), {
        ...(ssao0
          ? {
              ssao: (o?: unknown) => {
                const out = ssao0(o) as Record<string, unknown> | string;
                if (!out || typeof out !== 'object') return out;
                const water = { ...(out.water as object), webgpu: chain.ssaoWater() };
                const c = out.centre as Promise<unknown> | null;
                if (c && typeof (c as Promise<unknown>).then === 'function') return c.then((centre) => ({ ...out, water, centre }));
                return { ...out, water };
              },
            }
          : {}),
        // The client's highlight drawn through the lighting model of ours and held to its mirror (step 4).
        specSelfTest: () => specSelfTestGpu(renderer),
        // The leaf cards drawn through the parts of ours and held to their mirror (step 4).
        cardLightSelfTest: () => cardLightSelfTestGpu(renderer),
        leafShadowSelfTest: () => leafShadowSelfTestGpu(renderer),
        // The ground's tile program drawn through its node graph and held to its mirror (step 5).
        groundSelfTest: () => groundSelfTestGpu(renderer),
      });
    },
    renderer: renderer as THREE.WebGLRenderer,
    environment,
    standIns,
    fallback,
    adapter,
    bundles,
    chain,
    compiled: () => warm.compiled(),
    compileMark: () => warm.mark(),
    compiledSince: (mark: number) => warm.since(mark),
    tune(o: Record<string, unknown>) {
      const out: Record<string, unknown> = {};
      if (typeof o.bundles === 'boolean') {
        bundles.setOn(o.bundles);
        out.bundles = BUNDLE_TUNE.on;
      }
      const p = o.patches as Record<string, unknown> | undefined;
      if (p && typeof p === 'object') {
        const said: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(p)) {
          if (!isPatchName(k) || typeof v !== 'boolean') continue;
          said[k] = setPatch(k, v);
          // The bundles run only with the stencil patch: off, every bundled mesh is drawn as it was.
          if (k === 'stencil') bundles.setOn(BUNDLE_TUNE.on);
        }
        out.patches = said;
        if (said.shadow !== undefined) out.note = "the shadow patch moved: each opaque caster's shadow program is made again (pipelines made in play)";
      }
      const w = o.warm as Record<string, unknown> | undefined;
      if (w && typeof w === 'object') {
        for (const k of Object.keys(WARM_TUNE) as (keyof typeof WARM_TUNE)[]) if (typeof w[k] === 'number' && Number.isFinite(w[k] as number)) WARM_TUNE[k] = Math.max(0, w[k] as number);
        out.warm = { ...WARM_TUNE };
      }
      // The inline output (step 6, item 5) live: only where it was installed at load.
      if (typeof o.inline === 'boolean') {
        INLINE.on = o.inline && INLINE.applied;
        out.inline = inlineReport();
      }
      if (typeof o.dynamicHint === 'boolean') out.dynamicHint = setUsageHint((o.scene as THREE.Object3D | undefined) ?? null, o.dynamicHint);
      // What the node copies carry of the materials the scene holds now (step 4, item 5): checked, never rebuilt.
      if (o.carries === true) out.carries = carriesReport(renderer, (o.scene as THREE.Object3D | undefined) ?? null);
      return out;
    },
    makeSun(scene: THREE.Scene, camera: THREE.PerspectiveCamera, o: GpuSunOptions) {
      sunNow = makeSun(renderer, scene, camera, o);
      return sunNow;
    },
    frameStats(): GpuFrameStats {
      return { calls: frame.draws, triangles: frame.triangles, pipelines: pipelinesNow() };
    },
    frameDraws(): number {
      return renderer.info.render.drawCalls - frame.lastDraws;
    },
    forced(name: string, why: string) {
      if (!forcedOff.has(name)) forcedOff.set(name, why);
    },
    horizonSelfTest(o: HorizonSelfTestInput) {
      return horizonSelfTestGpu(renderer, o);
    },
    async compile(scene: THREE.Object3D, camera: THREE.Camera, target: THREE.Scene | null = null) {
      if (RT_HOOKS.compile) await RT_HOOKS.compile(renderer, scene, camera, target);
    },
    endFrame(loading: boolean) {
      loadingNow = loading;
      const r = renderer.info.render;
      // The draws as they rose this frame; the triangles the game's own frame zeroes as it begins drawing.
      frame.draws = r.drawCalls - frame.lastDraws;
      frame.lastDraws = r.drawCalls;
      frame.triangles = r.triangles;
      frame.skipped = fallback.skippedDraws;
      fallback.skippedDraws = 0;
      const p = pipelinesNow();
      if (!loading && p > frame.pipelines) frame.madeInPlay += p - frame.pipelines;
      frame.pipelines = p;
    },
    report(extra: Record<string, unknown>) {
      const out: Record<string, unknown> = {
        backend: 'WebGPU (three WebGPURenderer, WebGPU backend)',
        three: THREE.REVISION,
        adapter: { vendor: adapter.vendor, architecture: adapter.architecture, description: adapter.description, device: adapter.device, fallbackAdapter: adapter.fallback },
        features: { asked: 'every feature the adapter offers (three asks for all of them)', offered: adapter.features, granted },
        reversedDepth: renderer.reversedDepthBuffer === true,
        frame: { draws: frame.draws, triangles: frame.triangles, drawsSteppedOver: frame.skipped },
        pipelines: { held: pipelinesNow(), madeInPlay: frame.madeInPlay },
        unsupported: Object.fromEntries([...fallback.unsupported.entries()].sort((a, b) => b[1] - a[1])),
        standIns: Object.fromEntries(fallback.standIns.entries()),
        forcedOff: Object.fromEntries(forcedOff.entries()),
        // What stays as step 3 left it (step 4, item 5); `__debug.gpu({ carries: true })` checks what the node copies carry.
        stays: { ...STAYS },
        look: { ...GPU_LOOK },
        looks: looksReport({ spec: { ...SPEC_GPU_STATS, by: "a lighting model of ours extending three's physical one, its direct specular the client's term (gpuSpec.ts)" }, detail: { ...DETAIL_GPU_STATS, by: "the node copy's colour times the detail at uv(1) (gpuDetail.ts)" }, card: { ...CARD_GPU_STATS, by: "the card rule's cut, the stored normal, the client's sum after three's indirect light, the sun's shadow from the cascades' own node, the leaf skip as the lookup's place moved toward the sun (gpuCard.ts)" }, env: environment.report() }),
        // Step 5: the ground's tile program, the version-3 ground and the far rings, node graphs of ours over the WebGL uniforms.
        ground: { tiles: LOOKS_AT_LOAD.ground ? 'the tile program, a node graph over the very uniforms the WebGL program reads (gpuGround.ts)' : "step 3's plain ground: the part is left out at load (localStorage['swg.gpu.ground'] = '0')", rings: LOOKS_AT_LOAD.rings ? 'the far rings, a node graph over the session ring uniforms and the tile program uniforms (gpuGround.ts); __debug.horizon({ ground }) and the Graphics page move them' : "left out at load (localStorage['swg.gpu.rings'] = '0'): the far ground is drawn as far tiles", graphs: { ...GROUND_GPU_STATS, builds: { ...GROUND_GPU_STATS.builds } }, live: "__debug.gpu({ look: { ground: false } }) draws step 3's plain look through the same graph (a uniform; nothing built)", diffuseBack: GPU_LOOK.groundDiffuseBack, selfTests: '__debug.groundSelfTest() and __debug.horizon({ selfTest: true }) run on WebGPU' },
        // Step 5's own programs (lava, the marks, the blades, the client's particles, the tunnel), and what is left for the remakes.
        programs: programsReport(),
        // Step 6's effects chain: what is ported, whether it was taken in at load, what each graph binds, and what draws now.
        chain: chain.report(),
        // Step 6, item 5: the Effects-off picture drawn the way WebGL draws it (every material tone-mapped onto the canvas).
        inline: inlineReport(),
        notPorted: { ...NOT_PORTED },
        sun: sunNow ? sunNow.describe() : 'no cascades yet (the first world makes them)',
        gpuErrors: { count: errors, last: lastError || null },
        warmUp: {
          by: WARM_PATCH.on && WARM_PATCH.applied ? "the warm patch: every pass's items and every sun cascade's casters listed by three's walk and built ahead" : "three's own compileAsync (the warm patch is off or did not apply): no shadow pass warmed",
          pending: warm.pending(),
          pipelinesMade: { byDrawInPlay: WARM_STATS.drawMadeInPlay, byDrawBehindScreen: WARM_STATS.drawMadeBehind, aheadInPlay: WARM_STATS.asyncInPlay, aheadBehindScreen: WARM_STATS.asyncBehind, lastByDrawInPlay: [...WARM_STATS.lastInPlay], forSelfTests: WARM_STATS.selfTestMade },
        },
        patches: patchReport(),
        bundles: bundles.report(),
        dynamicHint: {
          kept: USAGE_HINT.kept,
          droppedFrom: USAGE_HINT.dropped,
          does: "the game's DynamicDrawUsage hint is not kept on WebGPU: an attribute is written to the GPU when its version moves, as on WebGL (three's WebGPU wrote it again every render call and refreshed its mesh in full every draw)",
          switch: "__debug.gpu({ dynamicHint: true }) keeps it live, or localStorage['swg.gpu.dynamicHint'] = '1' and a reload",
        },
        ...extra,
      };
      RT_HOOKS.report?.(out);
      return out;
    },
  };
  // `compile` is a getter on three's renderer handing back `compileAsync`: the game calls it as the WebGL renderer's
  // synchronous compile all through its warm-up, and `compileAsync` where it waits. On WebGPU both are the runtime's own,
  // which hands over to the warm-up (`RT_HOOKS.compile`, set above): what it lists has its pipelines made ahead, and what
  // it never saw is made at its first draw. Three's own `compileAsync` is kept as `NATIVE.compileAsync`.
  NATIVE.compileAsync = renderer.compileAsync.bind(renderer);
  Object.defineProperty(renderer, 'compile', { configurable: true, writable: true, value: (scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene | null) => void rt.compile(scene, camera, target ?? null) });
  renderer.compileAsync = (scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene | null) => rt.compile(scene, camera, target ?? null);
  return rt;
}
