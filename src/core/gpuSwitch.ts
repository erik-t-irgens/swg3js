// Which renderer the game draws with, read once at boot and held for the session (the GPU port's step 3).
//
// `?renderer=webgpu` on the address, else `localStorage['swg.renderer']` ('webgpu' or 'webgl'), else WebGPU (the owner's call of 2026-11-18: the port is the trunk and starts on WebGPU; `?renderer=webgl` is the old renderer). No Graphics
// row: the branch is not for players yet, and the README names the switch. Read once, before the first frame, by
// `readRendererSwitch` (the boot); every site that draws differently on WebGPU asks `GPU.webgpu` and nothing else --
// never `navigator.gpu` on its own.
//
// This module is the one piece of the port the WebGL boot loads: plain fields and types, nothing of three. Everything
// of three's WebGPU build (`three/webgpu`, `three/tsl`, `CSMShadowNode`) lives under `src/core/gpu/`, reached by one
// dynamic import from the boot and only with the switch at WebGPU (`gpuOff.test.ts` holds both). The runtime that
// import hands back is described here as an interface, so a site the WebGL path loads can call it with a type and no
// import of its module.

import type * as THREE from 'three';
import type { DomeCapture } from '../world/envmap.ts';
import type { GroundTileUniforms } from '../world/terrainTextures.ts';
import type { RingUniforms } from '../world/horizon/horizonRings.ts';
import type { BakeGrid } from '../world/horizon/horizonMath.ts';
import type { PostFX } from './postfx.ts';
import type { FxSettings } from './fxRegistry.ts';
import type { FxInstallDeps } from './fx/install.ts';
import type { ShadowHold, ShadowMovers } from '../world/shadowCadence.ts';

/** How the switch was read. */
export type RendererChoice = 'webgl' | 'webgpu';
export type SwitchSource = 'address' | 'storage' | 'default';

/** A colour kept by a site of the WebGL path that a stand-in reads live (the dome's, a water look's): only its numbers. */
export interface LiveColour {
  r: number;
  g: number;
  b: number;
}

/** The stand-ins a site registers for a `ShaderMaterial` WebGPU cannot draw (`userData.gpuStandIn`, made once and kept). */
export interface GpuStandIns {
  /** The sky dome: its horizon and zenith colours as a plain gradient by the view's elevation, live. */
  sky(horizon: LiveColour, zenith: LiveColour): THREE.Material;
  /**
   * Lava: the client's own (step 5, `gpu/gpuPrograms.ts`), its uniforms read off each lava material as it is drawn; its
   * ramp's middle colour, unlit (step 3's), where the part is left out at load (`localStorage['swg.gpu.lava'] = '0'`).
   */
  lava(colour: LiveColour): THREE.Material;
  /** The marks (step 5): one graph for both sheets, each sheet's uniforms read as it is drawn. */
  marks(): THREE.Material;
  /** A lightsaber blade's ribbon (step 5): one graph for every ribbon, each one's colour, brightness and edge read as it is drawn. */
  blade(): THREE.Material;
  /** A particle batch (step 5), or the weather's variant of one (`weather`): one graph a kind, each batch's uniforms read as it is drawn. */
  particles(weather: boolean): THREE.Material;
  /** The hyperspace tunnel (step 5). */
  tunnel(): THREE.Material;
  /** The ground's tile program: the chunk's own colour-map colour where it carries one ('tint' the tile chunks', 'color' vertex colours), else a mid grey, lit. */
  ground(source: 'tint' | 'color' | 'grey'): THREE.Material;
  /** The portal renderer's depth reset behind the doorways: writes the far depth where its stencil passes, no colour. */
  depthReset(reversed: boolean): THREE.Material;
  /**
   * The ground's tile program over its uniforms (step 5, `gpu/gpuGround.ts`); step 3's plain ground ('tint') where the
   * ground's part is left out at load (`localStorage['swg.gpu.ground'] = '0'`).
   */
  groundTiles(u: GroundTileUniforms): THREE.Material;
  /** The version-3 ground program over a world's pictures and lookups (step 5); step 3's plain ground ('color') where left out. */
  groundFamilies(p: { texture: THREE.Texture; layerOf: Float32Array; sizeOf: Float32Array; normals: THREE.DataArrayTexture | null; normalScale: { value: number }; glossScale: { value: number } }): THREE.Material;
  /** The far rings over the session's uniforms and the tile program's (step 5). */
  ring(u: RingUniforms, ground: GroundTileUniforms): THREE.Material;
}

/**
 * The region tiers' still meshes in three's render bundles (`src/core/gpu/bundles.ts`, item 7). The streamer and the portal
 * renderer call these on WebGPU alone; a tier is named by its own record object, which the bundles keep only weakly.
 */
export interface GpuBundles {
  /** The scene they hang in and the exit narrowing's parents (the world's, once its portals stand). */
  attach(scene: THREE.Scene, narrowParents: THREE.Object3D[]): void;
  /** A tier made: its bulk's still meshes marked before their programs are built (the first `bulk` of `meshes`). */
  mark(tier: object, meshes: readonly THREE.Object3D[], bulk: number, isFurniture: (m: THREE.Object3D) => boolean): void;
  /** The tier shown: what was marked moved under a bundle of its own. */
  take(tier: object, scene: THREE.Scene): void;
  /** The tier let go: its meshes back in the scene as the streamer hung them (before it removes them). */
  drop(tier: object): void;
  /** Something of the tier changed that a recorded bundle cannot follow (a row hidden or shown in place): recorded again. */
  dirty(tier: object): void;
  /** A level sweep or a caster switch: every bundle looked at again before the next frame. */
  poke(): void;
  /** Once a frame before the passes: each bundle shown while the view or the sun's shadow reach meets it. */
  frame(camera: THREE.Camera): void;
  /** A pass begins: the bundles drawn only where its camera sees the world's layer. */
  pass(seesWorld: boolean): void;
}

/**
 * Reflections on WebGPU (`src/core/gpu/gpuEnv.ts`, the port's step 4): our sky captured and filtered by three's WebGPU
 * generator through the WebGL path's own `DomeCapture`, and the black stand-in of the same kind. The world calls these
 * on WebGPU alone (`World.refreshEnvironmentGpu`).
 */
export interface GpuEnvironment {
  /** Whether our sky is captured and handed to the registry now (taken in at load, and the console's look switch on). */
  readonly capturing: boolean;
  /** The black filtered stand-in the registry hands every registered material while the world has none; null when left out at load. */
  readonly standIn: THREE.Texture | null;
  /** The dome's capture, made once for the session and warmed with one capture of an empty scene. */
  makeDome(): DomeCapture;
  /** An area's own cube (the 'game' source) filtered at its own size into a target of its own, the caller's to free. */
  filterCube(cube: THREE.Texture): THREE.RenderTarget;
  /** What `__debug.gpu()` says of it. */
  report(): Record<string, unknown>;
}

/**
 * The effects chain on WebGPU (`src/core/gpu/gpuChainPasses.ts`, the port's step 6): the passes ported (the sanitize, the
 * bloom, the colour grade, the output) put on the WebGL path's own runner (`PostFX`) in place of the WebGL ones, each its
 * WebGL pass with its draw on a node graph over that pass's own uniforms. Every other effect pass is not made on WebGPU.
 */
export interface GpuChain {
  /** Taken in at load: `localStorage['swg.gpu.chain'] = '0'` and a reload holds the Effects setting off on WebGPU, as step 5 drew. */
  readonly atLoad: boolean;
  /** The scene target's depth and stencil, its type read off three's WebGPU renderer as the WebGL path reads its own. */
  sceneDepth(width: number, height: number): THREE.DepthTexture;
  /**
   * The scene target itself (pass 1, wave 5): the WebGL path's own, and with the motion on (`gpu/motion.ts`) a second
   * half-float output every draw into it writes its motion into.
   */
  sceneTarget(width: number, height: number, depth: THREE.DepthTexture): THREE.WebGLRenderTarget;
  /** A new chain's spine (`PostFX`'s constructor): the sanitize, the bloom and the output, in the registry's places. */
  spine(fx: PostFX, width: number, height: number, settings: FxSettings): void;
  /** Every ported effect beyond the spine (`installEffects`): the colour grade. */
  install(fx: PostFX, deps: FxInstallDeps): void;
  /** Whether a Graphics page row moves the picture on WebGPU: the Effects setting and each ported pass's own rows. */
  knobPorted(key: string): boolean;
  /** What a row says where its pass, or the chain, was left out at load; null where it is simply not on WebGPU yet. */
  knobWhy(key: string): string | null;
  /**
   * One warm-up item that names its own target compiled against it (`PostFX.warmUp`, `warmPasses`), through the camera it
   * is drawn with (the chain's orthographic one where it names none): the render context is keyed on the camera's kind.
   */
  warmInto(into: THREE.RenderTarget, object: THREE.Object3D, camera?: THREE.Camera): Promise<unknown>;
  /** What the occlusion drew of the water on WebGPU (`__debug.ssao().water.webgpu`). */
  ssaoWater(): Record<string, unknown>;
  /** What `__debug.gpu()` says of the chain. */
  report(): Record<string, unknown>;
}

/**
 * The morph bake on WebGPU (`src/core/gpu/morphBake.ts`, pass 1, wave 4): in play each look's shape sliders worked into one
 * copy of its positions and normals, shared by its clones, so a drawn body carries no morph targets. The world and the
 * previews call these on WebGPU alone.
 */
export interface GpuMorphBake {
  /** A drawable the world adopts (`World.adoptMaterials`): baked where it carries morph targets, in play. */
  adopt(object: THREE.Object3D): void;
  /** Once a frame before the passes: a look whose sliders moved baked again in place. */
  frame(): void;
  /** A preview's clone handed its sources, so the preview's own context morphs it live. */
  unbake(root: THREE.Object3D): void;
  /** Play begins (before the arrival's sweep) or ends (the select screen, the creator): nothing is baked out of play. */
  play(on: boolean): void;
}

/**
 * The bone pool on WebGPU (`src/core/gpu/bonePool.ts`, `patchBones.ts`, pass 1, wave 4): every body's bones in one storage
 * buffer, written once a frame. The portal renderer calls it on WebGPU alone.
 */
export interface GpuBones {
  /**
   * Once a frame, after the scene's one walk of its matrices and before any pass (`PortalRenderer.walkOnce`): every skeleton a
   * draw met last frame written, one write to the card. `walk` true where the frame's walk was left to each pass
   * (`matrixOnce` off): the scene is walked here first, so the bones read are this frame's.
   */
  frame(scene: THREE.Scene, walk: boolean): void;
}

/**
 * The motion output on WebGPU (`src/core/gpu/motion.ts`, pass 1, wave 5): every draw into the scene target writes its motion
 * since the last frame. The portal renderer calls it on WebGPU alone.
 */
export interface GpuMotion {
  /** Once a game frame before any pass draws (`PortalRenderer.render`): the camera's change since the last frame, in doubles. */
  frame(camera: THREE.Camera): void;
  /**
   * A mesh whose vertices the game lays on the CPU each frame in its own space (a rope's strip), registered as it is made, before
   * its first draw: `positions` is its position attribute's array. Its geometry is given each vertex's change since the last
   * frame, worked once a frame; on WebGL nothing calls it.
   */
  laid(mesh: THREE.Mesh, positions: Float32Array): void;
}

/** What the WebGPU side hands the game (`src/core/gpu/start.ts`). Only ever set with the switch at WebGPU. */
export interface GpuRuntime {
  /** The morph bake (pass 1, wave 4). */
  readonly morphBake: GpuMorphBake;
  /** The bone pool (pass 1, wave 4). */
  readonly bones: GpuBones;
  /** The motion output (pass 1, wave 5). */
  readonly motion: GpuMotion;
  /**
   * The person warm's stand-ins made off real bodies (pass 1, wave 4, `gpu/bodyStandIns.ts`): every way of drawing a body met
   * so far, `scene` learnt from first; null with the switch off, when the warm takes `personKeys.ts`'s own.
   */
  bodyStandIns(scene: THREE.Object3D | null): THREE.Mesh[] | null;
  /** The region tiers' bundles (item 7). */
  readonly bundles: GpuBundles;
  /** The effects chain (step 6). */
  readonly chain: GpuChain;
  /** Reflections (step 4, item 2). */
  readonly environment: GpuEnvironment;
  /** Answers once everything the warm-up has been handed is built and every pipeline asked for has landed (item 9). */
  compiled(): Promise<void>;
  /** The warm-up's count of compiles so far: `compiledSince` waits for the ones made after it alone. */
  compileMark(): number;
  /** Answers once every compile made after `mark` is built and its pipelines have landed. */
  compiledSince(mark: number): Promise<void>;
  /**
   * `fn` run with the warm-up building each compile's items there and then, in this task, each pipeline still asked for
   * asynchronously (pass 1, wave 4's fixer: a jump's world swap, `World.gpuMadeNow`), so the next frame skips what has not
   * landed rather than building it.
   */
  compileNow(fn: () => void): void;
  /** The console's switches (`__debug.gpu({ bundles, patches, warm })`): answers what they came to. */
  tune(o: Record<string, unknown>): Record<string, unknown>;
  /**
   * The performance step's `sweepPace` (`gpu/drawCost.ts`): the milliseconds of listing a sweep in play (the Effects switch's)
   * spends before it waits a frame, the warm-up's own in-play slice; nought with the switch off, where it waits after every
   * batch as step 6's did (`World.sweepBatches`, `sweepYieldPaced`).
   */
  sweepPaceMs(): number;
  /** three's `WebGPURenderer`, initialised, on the WebGPU backend; typed as the classic renderer the game is written to. */
  readonly renderer: THREE.WebGLRenderer;
  readonly standIns: GpuStandIns;
  /**
   * The sun of the cascades on WebGPU (`CSMShadowNode`): made once a world's cascades exist, the classic cascades' three
   * lights hidden. `sync` copies their direction, colour, intensity and shadow look a frame; `frustums` refits.
   */
  makeSun(scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: GpuSunOptions): GpuSun;
  /** One frame's counters for `__debug.gpu()` and `perf()` (draws, triangles, pipelines). */
  frameStats(): GpuFrameStats;
  /**
   * The draws made since the last frame's end, read as the frame's passes end: what WebGL's `info.render.calls` counts
   * there (three's WebGPU `calls` counts render calls, and is never put back, since three keys its uploads on it).
   */
  frameDraws(): number;
  /** Everything `__debug.gpu()` says. */
  report(extra: Record<string, unknown>): Record<string, unknown>;
  /**
   * The stand-ins' look dials (`GPU_LOOK`) and the models' looks' switches (`GPU_LOOKS`: `spec`, `env`, `detail`, step 4),
   * moved live; answers them as they stand.
   */
  look(o: Record<string, unknown>): Record<string, number | boolean>;
  /**
   * After each frame is drawn: the frame's counters taken, and whether a loading screen was up (pipelines made in play);
   * `traveling` whether an arrival is under way (pass 1's landing log: an arrival begins when it goes up).
   */
  endFrame(loading: boolean, traveling?: boolean): void;
  /**
   * The key census (pass 1, wave 1, `gpu/keyCensus.ts`): every render pipeline three holds, the field of three's key that
   * separates each from its nearest sibling, counted by that field, and what the pool and the morph bake would merge.
   */
  keys(o: { list?: boolean; limit?: number }): Record<string, unknown>;
  /**
   * The landing log (pass 1, wave 1, `gpu/pipeLedger.ts`): each pipeline asked and landed since the page's start, by arrival.
   * `exact` (pass 1, wave 2: `__debug.load()`'s) gives each row its times in milliseconds unrounded.
   */
  landing(o: { all?: boolean; last?: number; exact?: boolean }): Record<string, unknown>;
  /**
   * The frame report on WebGPU (the performance step, `gpu/framePerf.ts`): the main thread's sections with the sun's cascades
   * timed apart, the WebGPU calls a frame and three's own steps by kind, and the card's time where asked (`{ gpu: true }`).
   */
  perf(o: { frames?: number; gpu?: boolean; gpuFrames?: number; noCount?: boolean }): Promise<Record<string, unknown>>;
  /** The console's helpers that reach under three's WebGL renderer, made to answer in words (`consoleWords.ts`); once, at boot. */
  wrapConsole(debug: Record<string, unknown>): void;
  /** A thing forced off on WebGPU, named for the report (once each). */
  forced(name: string, why: string): void;
  /**
   * `__debug.horizon({ selfTest: true })` on WebGPU (step 5, `gpu/gpuGroundSelfTest.ts`): the layer means against the card's
   * top mip, the ring program's textures off its own WGSL, and the ring's arithmetic on the GPU against `horizonMath.ts`.
   */
  horizonSelfTest(o: { ground: { colour: Uint8Array; size: number; depth: number } | null; groundArray: THREE.Texture | null; patch: THREE.Mesh; scene: THREE.Scene; camera: THREE.Camera; uniforms?: RingUniforms; fine?: BakeGrid | null; coarse?: BakeGrid | null; shape?: { placed: boolean; gi0: number; gj0: number; side: number; step: number; ringHeight(rx: number, rz: number, bake: number, fade: number): number } | null }): Promise<Record<string, unknown>>;
  /**
   * Compiles what a pass would draw of a root as the WebGL warm-up would, and every sun cascade's shadow of it where the
   * pass sees the sun (`src/core/gpu/patchWarm.ts`): listed at once, built on its own clock; answers when it is built.
   */
  compile(scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene | null): Promise<void>;
}

export interface GpuSunOptions {
  maxFar: number;
  mapSize: number;
  lightMargin: number;
  splits: (amount: number, near: number, far: number, target: number[]) => void;
}

export interface GpuSun {
  readonly light: THREE.DirectionalLight;
  /**
   * Pass 1, wave 3 (`gpu/heldCsm.ts`): whether the middle and far cascades are held by age, as WebGL's are; false where
   * three is not the revision the held node was read against (every cascade then drawn every frame), `notHeld` saying why.
   */
  readonly holds: boolean;
  readonly notHeld: string | null;
  /**
   * The world's holds handed to the node, bound to its own cascade lights, with the frame's fast movers and who counts
   * each decision's cascades drawn and holds refused; answers whether it holds. Once, as the sun is made.
   */
  hold(hold: ShadowHold, movers: ShadowMovers, counted: ((drawn: number, refused: number) => void) | null): boolean;
  /** Once a game frame, where WebGL's `updateShadows` decides: the next render that lights with the sun decides, once. */
  arm(now: number): void;
  /** Every frame after the classic cascades' `update`: direction, colour, intensity, shadow intensity, bias, softness, reach. */
  sync(cascades: { lightDirection: THREE.Vector3; lights: THREE.DirectionalLight[]; maxFar: number }, camera: THREE.PerspectiveCamera, castShadow: boolean): void;
  /** The camera's projection or the splits moved: the cascades refitted. */
  frustums(): void;
  /** What the console says of it (`__debug.gpu()`): the light, the breaks and each cascade's box, depth, bias and map. */
  describe(): Record<string, unknown>;
  /** Three's `CSMShadowNode`, for the console's own looks. */
  readonly node: unknown;
  /**
   * The sun and its cascades as the effects read them (`World.fillFxLights`, the GPU port's step 6): this light's colour and
   * intensity and the cascades three's node draws on WebGPU (their maps, matrices, biases), the classic cascades' direction.
   */
  fillFx(sky: import('./fx/lights.ts').FxSkyLights, cascades: { lightDirection: THREE.Vector3; fade: boolean }, renderer: { shadowMap: { enabled: boolean } }, range: number): void;
  dispose(): void;
}

export interface GpuFrameStats {
  calls: number;
  triangles: number;
  pipelines: number;
}

export const GPU = {
  /** What the switch asked for. */
  asked: 'webgpu' as RendererChoice,
  /** Where it was read from. */
  how: 'default' as SwitchSource,
  /** True once the game draws on WebGPU: the one flag every site asks. Set before the first frame, never changed. */
  webgpu: false,
  /** Why WebGPU was asked for and not given (no `navigator.gpu`, an adapter refused, `init()` threw), or null. */
  refused: null as string | null,
  /** Whether `readRendererSwitch` has run. */
  read: false,
  /** The WebGPU side, set by the boot with the switch at WebGPU and only then. */
  rt: null as GpuRuntime | null,
};

/** The switch, read once: the address, then this browser's storage, then WebGPU. */
export function readRendererSwitch(search: string = typeof location === 'undefined' ? '' : location.search): void {
  if (GPU.read) return;
  GPU.read = true;
  const asked = new URLSearchParams(search).get('renderer');
  if (asked === 'webgpu' || asked === 'webgl') {
    GPU.asked = asked;
    GPU.how = 'address';
    return;
  }
  try {
    const kept = typeof localStorage === 'undefined' ? null : localStorage.getItem('swg.renderer');
    if (kept === 'webgpu' || kept === 'webgl') {
      GPU.asked = kept;
      GPU.how = 'storage';
    }
  } catch {
    // Storage refused (a private window): the default.
  }
}
