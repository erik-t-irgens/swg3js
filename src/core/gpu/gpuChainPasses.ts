// The effects chain on WebGPU (the GPU port's step 6, items 1 to 3): the WebGL passes made over again with their draws
// put through node graphs of their own (`gpuChain.ts`), registered on the very runner the WebGL path uses (`PostFX`), so the
// registry's order, the settings' toggles and strengths, a pass's `enabled`, the console's overrides and every report
// read alike on both renderers.
//
// Each pass here extends the WebGL one: its `prepare` (the uniforms worked out of the frame) is the WebGL pass's own, and
// only its draw differs, writing the WebGL pass's uniforms exactly as the WebGL draw does and drawing the graph that reads
// them. Its `materials()` are the graphs, each with the mesh it is drawn on, so the warm-up builds the very pipelines the
// frame draws (behind the loading screen, and behind the notice when the Effects setting moves in play).
//
//   - **sanitize**: the scene target into the first chain buffer, values that are not numbers made black and the brightest
//     held to 256;
//   - **bloom**: three's pass's own five levels and their targets (`HeldBloomPass`, 0.185's blur), drawn in the order its
//     `render` draws them, composited in place over the picture as WebGL does;
//   - **colorGrade**: `ColorGradePass` whole (the planet's look, the place's ease, the rooms' 30%, the console's look,
//     freeze, split and room), only its draw on the graph; its self test the WebGL test's own colours drawn through the
//     graph and read back asynchronously;
//   - **output**: the picture drawn straight onto the canvas, taking three's own ACES fit at the renderer's exposure and the
//     sRGB curve in its own output (the inline output, `inlineOutput.ts`, the start: the WebGL `OutputPass`'s arithmetic);
//     with the inline output left out at load, copied into three's frame-buffer target, which three's own output pass
//     tone-maps and encodes.
//
// `chainRuntime` is what the WebGPU runtime hands the game (`GpuRuntime.chain`): the targets' depth, the spine and the rest
// put on a new chain, the Graphics page's rows, and the console's words. Nothing here is loaded on the WebGL path.

import * as THREE from 'three';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { PostFX } from '../postfx.ts';
import { BloomPass, OutputFxPass, SanitizePass } from '../fx/passes.ts';
import { ColorGradePass, type GradeCheck, type GradeSelfTest } from '../fx/grade.ts';
import { applyGradePixel, limitChroma, normLuma, TINT_LIMIT, type GradeParams, type Vec3 } from '../fx/gradeMath.ts';
import { FX_CAMERA, type FxWarmItem } from '../fx/pass.ts';
import type { FxFrameContext } from '../fx/context.ts';
import { FX_KNOBS, type FxPassId, type FxSettings } from '../fxRegistry.ts';
import type { FxInstallDeps } from '../fx/install.ts';
import type { GpuChain } from '../gpuSwitch.ts';
import { BLUR_DIRECTIONS, bloomGraphs, gradeGraph, motionViewGraph, outputGraph, sanitizeGraph, type BloomGraphs, type ChainGraph } from './gpuChain.ts';
import { LOOKS_AT_LOAD } from './looks.ts';
import { GpuDebugViewPass, GpuLinearDepthHalf, GpuNormalsHalf, GpuSsaoPass, gpuSsaoHost } from './gpuSsaoPass.ts';
import { markMotionTarget, motionTextureOf, motionWanted, MOTION_VIEW } from './motion.ts';
import { GpuTaaPass, taaPassNow } from './taa/taaPass.ts';
import { SCENE_SIZE, sceneSizeFor } from './taa/taaSize.ts';
import { JITTER } from './taa/taaJitter.ts';
import { skyOurs } from '../../sky/skyMode.ts';
import { markSeeTarget } from '../../sky/air/airSee.ts';
import { GpuHazePass } from '../../sky/air/airHaze.ts';
import { GpuEyePass } from '../../sky/exposure/eyeGpu.ts';
import { markSceneTarget } from '../../sky/exposure/preExpose.ts';
import { GpuLensFlarePass } from '../../sky/night/gpuFlare.ts';
import { GpuMixBloomPass } from './gpuBloomMix.ts';
import { withOutputDither } from './outputDither.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A graph drawn into a target (null: the canvas, straight under the inline output, else through three's frame-buffer target and its output pass). */
function draw(r: Any, g: ChainGraph, into: THREE.RenderTarget | null): void {
  r.setRenderTarget(into);
  r.render(g.mesh, FX_CAMERA);
}

const warmItem = (g: ChainGraph, where: FxWarmItem['where']): FxWarmItem => ({ material: g.material, object: g.mesh, where });

/** The chains made on WebGPU that are not yet disposed, the newest last: the console's word on what draws. */
const LIVE: PostFX[] = [];

// ---------------------------------------------------------------- the passes

export class GpuSanitizePass extends SanitizePass {
  // The sky and light fix round: under our sky the ceiling is the stored picture's own (`CHAIN_NUMBERS.sanitize.stored`).
  private readonly g = sanitizeGraph(this.material.uniforms as never, skyOurs());
  fx: PostFX | null = null;

  render(ctx: FxFrameContext, _input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    draw(ctx.renderer, this.g, output);
    return true;
  }

  materials(): FxWarmItem[] {
    return [warmItem(this.g, 'target')];
  }

  dispose(): void {
    if (this.fx) {
      const i = LIVE.indexOf(this.fx);
      if (i >= 0) LIVE.splice(i, 1);
    }
    this.g.material.dispose();
    super.dispose();
  }
}

export class GpuBloomPass extends BloomPass {
  private readonly g: BloomGraphs;

  constructor(width: number, height: number, strength: number) {
    super(width, height, strength);
    this.g = bloomGraphs(this.held);
    // Three's pass makes its levels with a depth buffer nothing reads (a target's default): on WebGPU they are made with
    // none, so every draw of the chain is into a target with no depth, the one the warm-up compiles its items against
    // (`bufferA`), and builds no pipeline of its own at its first frame. Set before anything is drawn, so nothing is allocated.
    const b = this.held as Any;
    for (const t of [b.renderTargetBright, ...b.renderTargetsHorizontal, ...b.renderTargetsVertical] as THREE.RenderTarget[]) {
      t.depthBuffer = false;
      t.stencilBuffer = false;
    }
  }

  /** Three's pass (its targets, its materials' uniforms, its numbers), the one WebGL draws with. */
  private get held(): UnrealBloomPass {
    return this.inner as unknown as UnrealBloomPass;
  }

  /** `UnrealBloomPass.render`, step for step, with each draw on its graph: never the canvas (the bloom is never last). */
  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, _output: THREE.WebGLRenderTarget | null): boolean {
    const r = ctx.renderer as Any;
    const b = this.held as Any;
    const g = this.g;
    // 1. the bright areas
    b.highPassUniforms.tDiffuse.value = input.texture;
    // A number written into a uniform's `{ value }` is a number made each frame (step 6's allocation check): written only when
    // it moved. The graphs read the same `{ value }` (gpuChain's `live`), so what they read is the same.
    const hp = b.highPassUniforms.luminosityThreshold;
    if (hp.value !== b.threshold) hp.value = b.threshold;
    draw(r, g.bright, b.renderTargetBright);
    // 2. each level blurred along x, then along y, from the level before
    let from = b.renderTargetBright as THREE.RenderTarget;
    for (let i = 0; i < b.nMips; i++) {
      const m = b.separableBlurMaterials[i] as THREE.ShaderMaterial;
      m.uniforms.colorTexture.value = from.texture;
      m.uniforms.direction.value = BLUR_DIRECTIONS.x;
      draw(r, g.blurs[i].h, b.renderTargetsHorizontal[i]);
      m.uniforms.colorTexture.value = b.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = BLUR_DIRECTIONS.y;
      draw(r, g.blurs[i].v, b.renderTargetsVertical[i]);
      from = b.renderTargetsVertical[i];
    }
    // 3. the levels composited
    const cu = b.compositeMaterial.uniforms;
    if (cu.bloomStrength.value !== b.strength) cu.bloomStrength.value = b.strength;
    if (cu.bloomRadius.value !== b.radius) cu.bloomRadius.value = b.radius;
    cu.bloomTintColors.value = b.bloomTintColors;
    draw(r, g.composite, b.renderTargetsHorizontal[0]);
    // 4. added over the picture where it stands
    b.copyUniforms.tDiffuse.value = b.renderTargetsHorizontal[0].texture;
    draw(r, g.blend, input);
    return false;
  }

  materials(): FxWarmItem[] {
    const g = this.g;
    const out = [warmItem(g.bright, 'target')];
    for (const l of g.blurs) out.push(warmItem(l.h, 'target'), warmItem(l.v, 'target'));
    out.push(warmItem(g.composite, 'target'), warmItem(g.blend, 'target'));
    return out;
  }

  dispose(): void {
    const g = this.g;
    for (const m of [g.bright, ...g.blurs.flatMap((l) => [l.h, l.v]), g.composite, g.blend]) m.material.dispose();
    super.dispose();
  }
}

/** The WebGL self test's own eight hues and its two sets, `grade.ts`'s. */
const SELF_TEST_HUES: Readonly<Vec3>[] = [
  [1, 1, 1],
  [1, 0.6, 0.25],
  [0.3, 0.45, 1],
  [0.3, 1, 0.35],
  [1, 0.95, 0.35],
  [1, 0.35, 0.95],
  [1, 0, 0],
  [0, 0, 1],
];

export class GpuColorGradePass extends ColorGradePass {
  private readonly g = gradeGraph(this.material.uniforms as never);

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    this.material.uniforms.tDiffuse.value = input.texture;
    draw(ctx.renderer, this.g, output);
    return true;
  }

  materials(): FxWarmItem[] {
    return [warmItem(this.g, 'target')];
  }

  /**
   * The WebGL test's own colours (`grade.ts`'s `selfTest`) drawn through this pass's own graph into a half-float target of
   * the chain buffers' kind (the pipeline the frame draws), read back asynchronously and held to `applyGradePixel`. The
   * picture goes up as half floats (a float picture is filterable only with a feature), so the mirror is worked on the
   * very halves the graph reads. Answers a promise, which the console awaits; typed as the WebGL answer it stands for.
   */
  selfTest(renderer: THREE.WebGLRenderer): GradeSelfTest {
    return this.selfTestGpu(renderer) as unknown as GradeSelfTest;
  }

  private async selfTestGpu(renderer: THREE.WebGLRenderer): Promise<GradeSelfTest & { renderer: string; input: string }> {
    const r = renderer as Any;
    const size = 16;
    const count = size * size;
    const data = new Uint16Array(count * 4);
    const hues: Vec3[] = SELF_TEST_HUES.map((h) => normLuma([h[0], h[1], h[2]]));
    const input: Vec3[] = [];
    const half = (v: number): number => THREE.DataUtils.toHalfFloat(v);
    for (let i = 0; i < count; i++) {
      const hue = hues[i % hues.length];
      const l = Math.pow(2, -12 + 18 * ((i >> 3) / 31));
      for (let k = 0; k < 3; k++) data[i * 4 + k] = half(hue[k] * l);
      data[i * 4 + 3] = half(1);
      input.push([THREE.DataUtils.fromHalfFloat(data[i * 4]), THREE.DataUtils.fromHalfFloat(data[i * 4 + 1]), THREE.DataUtils.fromHalfFloat(data[i * 4 + 2])]);
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    const rt = new THREE.RenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const u = this.material.uniforms;
    const kept = {
      tDiffuse: u.tDiffuse.value as THREE.Texture | null,
      amount: u.uAmount.value as number,
      balance: (u.uBalance.value as THREE.Vector3).clone(),
      shadow: (u.uShadowTint.value as THREE.Vector3).clone(),
      highlight: (u.uHighlightTint.value as THREE.Vector3).clone(),
      split: u.uSplit.value as number,
      saturation: u.uSaturation.value as number,
      contrast: u.uContrast.value as number,
      pivot: u.uPivot.value as number,
      compare: u.uCompare.value as number,
    };
    const balance = normLuma([1.3, 0.95, 0.7]);
    const shadowTint = limitChroma(normLuma([0.6, 0.8, 1.4]), TINT_LIMIT, [0, 0, 0]);
    const highlightTint = limitChroma(normLuma([1.3, 0.95, 0.6]), TINT_LIMIT, [0, 0, 0]);
    const sets: { saturation: number; contrast: number; pivot: number }[] = [
      { saturation: 1.2, contrast: 1.1, pivot: 0.18 },
      { saturation: 0.7, contrast: 0.94, pivot: 0.09 },
    ];
    let maxError = 0;
    let worst: GradeSelfTest['worst'] = null;
    const js: Vec3 = [0, 0, 0];
    const gpu: Vec3 = [0, 0, 0];
    const previous = r.getRenderTarget();
    try {
      for (const set of sets) {
        u.tDiffuse.value = texture;
        u.uAmount.value = 1;
        (u.uBalance.value as THREE.Vector3).fromArray(balance);
        (u.uShadowTint.value as THREE.Vector3).fromArray(shadowTint);
        (u.uHighlightTint.value as THREE.Vector3).fromArray(highlightTint);
        u.uSplit.value = 0.3;
        u.uSaturation.value = set.saturation;
        u.uContrast.value = set.contrast;
        u.uPivot.value = set.pivot;
        u.uCompare.value = -1;
        draw(r, this.g, rt);
        // A WebGPU readback's first row is the picture's top, and so is the texture's first row: index for index.
        const pixels = (await r.readRenderTargetPixelsAsync(rt, 0, 0, size, size)) as Uint16Array;
        const params: GradeParams = { balance, shadowTint, highlightTint, split: 0.3, saturation: set.saturation, contrast: set.contrast, pivot: set.pivot };
        for (let i = 0; i < count; i++) {
          applyGradePixel(input[i], params, 1, js);
          gpu[0] = THREE.DataUtils.fromHalfFloat(pixels[i * 4]);
          gpu[1] = THREE.DataUtils.fromHalfFloat(pixels[i * 4 + 1]);
          gpu[2] = THREE.DataUtils.fromHalfFloat(pixels[i * 4 + 2]);
          for (let k = 0; k < 3; k++) {
            const err = Math.abs(gpu[k] - js[k]) / Math.max(Math.abs(js[k]), 1e-3);
            if (err > maxError) {
              maxError = err;
              worst = { input: [input[i][0], input[i][1], input[i][2]], gpu: [gpu[0], gpu[1], gpu[2]], js: [js[0], js[1], js[2]] };
            }
          }
        }
      }
    } finally {
      r.setRenderTarget(previous);
      u.tDiffuse.value = kept.tDiffuse;
      u.uAmount.value = kept.amount;
      (u.uBalance.value as THREE.Vector3).copy(kept.balance);
      (u.uShadowTint.value as THREE.Vector3).copy(kept.shadow);
      (u.uHighlightTint.value as THREE.Vector3).copy(kept.highlight);
      u.uSplit.value = kept.split;
      u.uSaturation.value = kept.saturation;
      u.uContrast.value = kept.contrast;
      u.uPivot.value = kept.pivot;
      u.uCompare.value = kept.compare;
      texture.dispose();
      rt.dispose();
    }
    return { renderer: 'WebGPU', input: 'half floats (the mirror worked on the very halves the graph reads)', ok: maxError < 0.005, texels: count * sets.length, maxError, worst };
  }

  /** `grade.ts`'s `check` with three's asynchronous readback of the scene target (a promise the console awaits). */
  check(renderer: THREE.WebGLRenderer, scene: THREE.WebGLRenderTarget): GradeCheck {
    return this.checkGpu(renderer, scene) as unknown as GradeCheck;
  }

  private async checkGpu(renderer: THREE.WebGLRenderer, scene: THREE.WebGLRenderTarget): Promise<GradeCheck> {
    const r = renderer as Any;
    const w = scene.width;
    const h = scene.height;
    const buf = (await r.readRenderTargetPixelsAsync(scene, 0, 0, w, h)) as Uint16Array;
    // The WebGL check's own walk over a buffer read the other way up: the samples are the same pixels, in another order.
    const flipped = new Uint16Array(buf.length);
    for (let y = 0; y < h; y++) flipped.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    const fake = { readRenderTargetPixels: (_t: unknown, _x: number, _y: number, _w: number, _h: number, out: Uint16Array) => out.set(flipped) };
    return ColorGradePass.prototype.check.call(this, fake as unknown as THREE.WebGLRenderer, scene);
  }

  dispose(): void {
    this.g.material.dispose();
    super.dispose();
  }
}

export class GpuOutputPass extends OutputFxPass {
  private readonly g: ChainGraph;
  /** Pass 1, wave 5: the motion buffer drawn in place of the picture (`__debug.gpu({ view: 'motion' })`), and what it reads. */
  private readonly mvU = { tMotion: { value: null as THREE.Texture | null }, size: new THREE.Vector2(1, 1), pixels: MOTION_VIEW };
  private readonly mv: ChainGraph;

  constructor() {
    super();
    this.g = outputGraph((this.inner as unknown as { uniforms: { tDiffuse: { value: THREE.Texture | null } } }).uniforms);
    // The one chain graph WebGL tone-maps (its OutputPass): under the inline output (item 5) it is drawn straight onto the
    // canvas and takes the ACES fit and the sRGB curve in its own output; without it three's output pass does, after it.
    this.g.material.toneMapped = true;
    // The sky and light fix round: under our sky one 8-bit step of dither after those curves (`outputDither.ts`, the demo's).
    if (skyOurs()) withOutputDither(this.g.material);
    this.mv = motionViewGraph(this.mvU);
  }

  /** Three's `OutputPass.render` writes its picture and the exposure into its uniforms: the picture here, three's output pass reading the renderer's exposure itself. */
  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const u = (this.inner as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    u.tDiffuse.value = input.texture;
    u.toneMappingExposure.value = ctx.renderer.toneMappingExposure;
    // The motion buffer in place of the picture, where it is asked for and this chain's scene target carries it.
    const motion = MOTION_VIEW.on ? motionTextureOf(ctx.sceneColor) : null;
    if (motion !== null) {
      this.mvU.tMotion.value = motion;
      if (this.mvU.size.x !== ctx.width || this.mvU.size.y !== ctx.height) this.mvU.size.set(ctx.width, ctx.height);
      draw(ctx.renderer, this.mv, output);
      return true;
    }
    draw(ctx.renderer, this.g, output);
    return true;
  }

  /**
   * The chain's last pass on WebGPU but while the console's debug view replaces the picture (the occlusion's views, step 6
   * item 4): built for the canvas, and for a chain buffer, which it is copied into under the view. The motion view with it.
   */
  materials(): FxWarmItem[] {
    const where = CHAIN_PORTED.has('debugView') ? 'both' : 'screen';
    return [warmItem(this.g, where), warmItem(this.mv, where)];
  }

  /** WebGL's three's output pass settles its defines on a first draw; three's WebGPU output pass is its own. */
  settleDefines(): void {}

  dispose(): void {
    this.g.material.dispose();
    this.mv.material.dispose();
    super.dispose();
  }
}

/** What the chain's report says of its edges (pass 1, wave 6): the smoothing's mode and its state, or why it does not draw. */
function taaEdges(): Record<string, unknown> {
  const p = taaPassNow();
  return {
    how: "with the effects on, the edge smoothing over frames (src/core/gpu/taa/: the camera nudged by a Halton(2, 3) fraction of a pixel round the scene's passes, each pixel's history reprojected by the motion buffer, held by a linear depth test and the neighbourhood's spread, the reactive mark raising the new frame's share); with the effects off three's canvas multisampled 4x as before",
    switch: "the Graphics page's Smoothing row (Off, Full, Upscaled); the dials __debug.gpu({ taa: { share, current, currentUp, reactive, depth, edge } }) and the debug menu's sliders when gpu is picked",
    scene: { ...SCENE_SIZE },
    pass: p ? p.report() : 'no chain: the Effects setting is off',
    jitterNow: JITTER.on,
  };
}

// ---------------------------------------------------------------- what the runtime hands the game

/**
 * The passes this step ports, each with the at-load switch that leaves it out (null: none, the spine's own). The ambient
 * occlusion goes on this list with its pass.
 */
export const CHAIN_PASSES: ReadonlyMap<FxPassId, keyof typeof LOOKS_AT_LOAD | null> = new Map<FxPassId, keyof typeof LOOKS_AT_LOAD | null>([
  ['sanitize', null],
  ['ssao', 'ssao'],
  // Pass 2, wave 1: our sky's haze (`src/sky/air/airHaze.ts`), the spine's own under our sky (the Sky row, read at load).
  ['haze', null],
  // Pass 1, wave 6: the edge smoothing (`taa/`), the spine's own once the motion buffer is: no switch at load of its own.
  ['taa', null],
  // Pass 2, wave 2: the eye (`src/sky/exposure/eyeGpu.ts`), the spine's own under our sky (the Sky row, read at load).
  ['exposure', null],
  ['bloom', 'bloom'],
  // Pass 2, wave 3 (maker A): the lens flare under our sky (`src/sky/night/gpuFlare.ts`), following the air's discs and the
  // moon through the eye; registered under our sky alone, so SWG's sky on WebGPU draws as it did (`flareHere`).
  ['lensFlare', null],
  ['colorGrade', 'grade'],
  ['output', null],
  // The console's view of a pass's working texture or a product (the occlusion's __debug.ssao({ view })): with the occlusion.
  ['debugView', 'ssao'],
]);

/** The passes ported and taken in at load: what the chain on WebGPU holds. */
export const CHAIN_PORTED = new Set<FxPassId>([...CHAIN_PASSES].filter(([, at]) => at === null || LOOKS_AT_LOAD[at]).map(([id]) => id));

/** The passes a row of the Graphics page belongs to, read off the registry's knobs. */
const KNOB_PASS = new Map<string, FxPassId | null>(FX_KNOBS.map((k) => [k.key, k.pass]));

/** Whether a ported pass is drawn this session: every one but the lens flare, which is our sky's alone (pass 2, wave 3). */
function flareHere(pass: FxPassId): boolean {
  return pass !== 'lensFlare' || skyOurs();
}

/** What each graph binds (rule 4), for the console. */
export const CHAIN_BINDS = {
  sanitize: '1 texture (the scene target) and its sampler',
  bloom: "under our sky the demo's bloom (gpuBloomMix.ts): each of the six downs 1 (thirteen taps), each of the five ups 1 (nine taps), the mix 1 (nine taps), each texture with its sampler; under SWG's sky three's: the bright pass 1, each of the ten blurs 1 (one binding however many taps: 11 to 43), the composite 5, the blend 1: each texture with its sampler",
  ssao: "as the WGSL declares them (read off `renderer.debug.getShaderAsync` at 1600 by 900, step 6's fixer), at half resolution (the default) and at full: the GTAO 6 textures at half (the half distance, the half normals, the region, the three cascades' maps) and 5 at full (the scene's depth, the region, the three cascades' maps), with 3 samplers declared beside the cascades' maps in both and never sampled (the maps are fetched and compared by hand: three 0.187 declares no comparison sampler for a node texture's compare); the blur 2 at either (the occlusion and the half distance at half, the occlusion and the depth at full), no sampler; the apply 6 textures at half (the picture, the depth, the occlusion, the half distance, the half normals, the region's green for the water) and 4 at full (the picture, the depth, the occlusion, the region), 1 sampler (the picture's); the region read 0 (a stencil test), the water's coverage 0, the probe 2 (the depth, the occlusion), the debug view 3 and 2 samplers; the products: the half distance 1 (the depth), the half normals 1 (the half distance); every graph under 16 of each",
  colorGrade: '1 texture (the chain buffer) and its sampler',
  taa: "each resolve 5 textures (this frame's picture, the history's colour and its distance, the scene's depth, the motion buffer), the history's two with a sampler (read at level 0), the others loaded; then the colour copied into the chain buffer",
  output: "1 texture (the chain buffer) and its sampler, drawn straight onto the canvas under the inline output (the start); with it left out, three's own output pass 1 more (its frame-buffer target)",
  lensFlare: "under our sky alone (pass 2, wave 3): the occlusion 6 (the scene's depth loaded, last frame's visibility loaded, the four cloud sheets sampled at their mip), the elements 1 (the visibility, loaded in the vertex stage), the composite 2 (the chain buffer and the flare's half-size target)",
};

export function chainRuntime(renderer: Any): GpuChain {
  const atLoad = LOOKS_AT_LOAD.chain;
  return {
    atLoad,
    sceneDepth(width: number, height: number): THREE.DepthTexture {
      // The WebGL path's own choice, read off three's WebGPU renderer: a float depth under reversed depth (depth32float with
      // the stencil the portals need), else 24 bits and the stencil.
      return new THREE.DepthTexture(width, height, renderer.reversedDepthBuffer === true ? THREE.FloatType : THREE.UnsignedInt248Type);
    },
    sceneTarget(width: number, height: number, depth: THREE.DepthTexture): THREE.WebGLRenderTarget {
      // The WebGL path's own target, and with the motion on (pass 1, wave 5: `motion.ts`) a second half-float output beside its
      // colour, which every draw into it writes (motion in red and green, the reactive mark in alpha): 8 bytes a pixel more.
      const motion = motionWanted();
      // Pass 2, wave 1: under our sky a third half-float output, the see-through layer the haze pass composites (`airSee.ts`),
      // riding the motion's multi-output node: 8 bytes a pixel more. SWG's sky, or the motion off, makes the target of before.
      const see = motion && skyOurs();
      const t = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 0, depthTexture: depth, ...(motion ? { count: see ? 3 : 2 } : {}) });
      if (motion) markMotionTarget(t);
      if (see) markSeeTarget(t);
      // Pass 2, wave 2's fixer: what the scene is stored into pre-exposed (`src/sky/exposure/preExpose.ts`'s gate).
      markSceneTarget(t);
      return t;
    },
    spine(fx: PostFX, width: number, height: number, settings: FxSettings): void {
      // The two depth products the occlusion asks for (item 4), and the debug view its views draw through.
      if (CHAIN_PORTED.has('ssao')) {
        fx.registerProduct(new GpuLinearDepthHalf(renderer));
        fx.registerProduct(new GpuNormalsHalf());
        fx.registerPass(new GpuDebugViewPass(renderer));
      }
      const s = new GpuSanitizePass();
      s.fx = fx;
      LIVE.push(fx);
      fx.registerPass(s);
      // Pass 2, wave 1: our sky's haze, after the surfaces and before the edge smoothing (the registry's place), over this chain's
      // scene target and its see-through layer; SWG's sky registers none, and its chain is the one it was.
      if (skyOurs()) fx.registerPass(new GpuHazePass(renderer, fx.sceneTarget, settings));
      // Pass 1, wave 6: the edge smoothing, after the occlusion and before the bloom (the registry's place), over this chain's scene target.
      fx.registerPass(new GpuTaaPass(renderer, fx.sceneTarget, settings));
      // Pass 2, wave 2: the eye, after everything that adds light and before the bloom (the registry's place); SWG's sky
      // registers none, and its chain is the one it was.
      if (skyOurs()) fx.registerPass(new GpuEyePass(renderer));
      // The sky and light fix round: under our sky the owner's demo's bloom (`gpuBloomMix.ts`: no threshold, mixed over the
      // picture at the Bloom strength row's share); SWG's sky keeps three's Unreal bloom, its chain the one it was.
      if (CHAIN_PORTED.has('bloom')) fx.registerPass(skyOurs() ? new GpuMixBloomPass(width, height, settings.bloomMix) : new GpuBloomPass(width, height, settings.bloomStrength));
      fx.registerPass(new GpuOutputPass());
    },
    install(fx: PostFX, deps: FxInstallDeps): void {
      // The occlusion reads the frame's lights from the context, as on WebGL, and the water's own twins for its coverage.
      if (CHAIN_PORTED.has('ssao')) fx.registerPass(new GpuSsaoPass(gpuSsaoHost(fx), deps.water ?? null, renderer));
      if (CHAIN_PORTED.has('colorGrade')) fx.registerPass(new GpuColorGradePass());
      // Pass 2, wave 3 (maker A): the lens flare under our sky, its sources the air's discs and the moon (`flareSources.ts`).
      if (CHAIN_PORTED.has('lensFlare') && flareHere('lensFlare')) fx.registerPass(new GpuLensFlarePass(renderer));
    },
    inputSize(width: number, height: number, settings: FxSettings, out: THREE.Vector2): THREE.Vector2 {
      // The upscaled smoothing draws the scene at its share of the canvas, only where the smoothing can draw (a motion buffer).
      return sceneSizeFor(width, height, Number(settings.smoothing), motionWanted(), out);
    },
    knobPorted(key: string): boolean {
      if (key === 'effects') return atLoad;
      const pass = KNOB_PASS.get(key);
      return atLoad && !!pass && CHAIN_PORTED.has(pass) && flareHere(pass);
    },
    knobWhy(key: string): string | null {
      // Only a row that would move WebGPU but for a switch at load says so; every other is simply not on WebGPU yet.
      const pass = KNOB_PASS.get(key);
      if (key !== 'effects' && !(pass && CHAIN_PASSES.has(pass))) return null;
      if (!atLoad) return "the effects chain is left out at load on WebGPU (localStorage['swg.gpu.chain'] = '0')";
      if (pass && !flareHere(pass)) return "drawn on WebGPU under our sky alone (the Sky row), whose discs and moon it follows";
      const at = pass ? CHAIN_PASSES.get(pass) : null;
      if (at && !LOOKS_AT_LOAD[at]) return `left out at load on WebGPU (localStorage['swg.gpu.${at}'] = '0')`;
      return null;
    },
    warmInto(into: THREE.RenderTarget, object: THREE.Object3D, camera?: THREE.Camera): Promise<unknown> {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(into);
      try {
        return (renderer.compileAsync(object, camera ?? FX_CAMERA) as Promise<unknown>).catch(() => {});
      } finally {
        renderer.setRenderTarget(prev);
      }
    },
    ssaoWater(): Record<string, unknown> {
      const fx = LIVE[LIVE.length - 1] ?? null;
      const p = fx?.pass<GpuSsaoPass>('ssao');
      return p ? p.waterReport() : { source: false, why: fx ? 'the ambient occlusion is left out at load' : 'no chain: the Effects setting is off' };
    },
    report(): Record<string, unknown> {
      const fx = LIVE[LIVE.length - 1] ?? null;
      const d = fx ? fx.describe() : null;
      return {
        atLoad: { chain: atLoad, bloom: LOOKS_AT_LOAD.bloom, grade: LOOKS_AT_LOAD.grade },
        switches: "the Graphics page's Effects, Bloom and Colour grade rows (and their strengths) move WebGPU as WebGL; localStorage['swg.gpu.chain'] (or 'bloom', 'grade') = '0' and a reload leaves it out at load",
        how: "the WebGL runner (PostFX) with these passes' draws on node graphs over their own uniforms (gpuChain.ts): the scene into a half-float target with its depth and stencil, no multisampling; values that are not numbers zeroed; the occlusion; the bloom; the grade; the output drawn straight onto the canvas with three's own ACES fit at the renderer's exposure and the sRGB curve in its own output (the inline output, the start), or with that left out at load copied into three's frame-buffer target and tone-mapped there by three's own output pass",
        ported: [...CHAIN_PORTED],
        binds: { ...CHAIN_BINDS },
        chainsLive: LIVE.length,
        drawing: d ? { effects: true, size: d.size, lastToScreen: d.lastPassToScreen, memoryMB: d.memoryMB, passes: d.passes.map((p) => ({ id: p.id, drew: p.drewLastFrame, ...(p.why ? { why: p.why } : {}) })) } : 'no chain: the Effects setting is off, the scene straight to the canvas with three\'s tone mapping at the game\'s exposure',
        edges: taaEdges(),
      };
    },
  };
}
