// The edge smoothing's pass in the effects chain on WebGPU (the GPU port's pass 1, wave 6; the design's section 6): after the
// ambient occlusion and before the bloom, the picture gathered over frames from the camera's jitter (`taaJitter.ts`) by the
// resolves of `taaGraphs.ts`, the Graphics page's Smoothing row choosing Off, Full (the scene target's size) or Upscaled (a scene
// drawn at `TAA_TUNE.share` of the canvas, every pass before this one at that size, `PostFX`'s WebGPU sizing).
//
// Each resolve draws into a history target of the pass's own, two of them taken in turn (the one drawn last frame read, the
// other written): its colour, and beside it in a second output the distance of each pixel's surface (and under the upscaled
// smoothing its lock), which next frame's depth test reads. The colour is then copied into the chain's buffer, since the bloom
// after it adds into the picture it is handed and the history must stay as it was resolved. Only the mode drawing holds targets
// the picture's size; the other mode's stand at a pixel, made and warmed so a change of mode builds nothing.
//
// Memory at 1600 by 900: the full smoothing 20 bytes a pixel (two colours of 8, two distances of 2), 29 MB; the upscaled one 24
// (its distance and lock 4 each), 35 MB, its scene and the buffers before it at its share. Nothing here is loaded on the WebGL
// path. The approach follows three's `TRAANode` and `TAAUNode` (three.js, MIT, `LICENSES/three-MIT.txt`).

import * as THREE from 'three';
import { FX_CAMERA, type FxPass, type FxWarmItem } from '../../fx/pass.ts';
import type { FxFrameContext } from '../../fx/context.ts';
import type { FxPassId, FxProductId, FxSettings } from '../../fxRegistry.ts';
import { motionTextureOf } from '../motion.ts';
import type { ChainGraph } from '../gpuChain.ts';
import { JITTER } from './taaJitter.ts';
import { SMOOTHING, TAA_TUNE } from './taaTune.ts';
import { TAA_MOTION_IN, taauGraph, traaGraph, type TaaInputs } from './taaGraphs.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const NO_NEEDS: readonly FxProductId[] = [];

/** Two history targets of one mode, taken in turn, and which was written last. */
interface History {
  rt: [THREE.RenderTarget, THREE.RenderTarget];
  last: number;
  /** Whether it holds the picture's size (the mode drawing), or a pixel. */
  live: boolean;
}

/** A history target: its colour, and a second output of `auxFormat` (the distance; with the lock beside it, two channels). */
function historyTarget(name: string, auxFormat: THREE.PixelFormat): THREE.RenderTarget {
  const t = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0, count: 2 });
  t.textures[0].name = `${name}.color`;
  t.textures[1].name = `${name}.aux`;
  t.textures[1].format = auxFormat;
  for (const x of t.textures) {
    x.minFilter = THREE.LinearFilter;
    x.magFilter = THREE.LinearFilter;
    x.generateMipmaps = false;
  }
  return t;
}

function history(name: string, auxFormat: THREE.PixelFormat): History {
  return { rt: [historyTarget(`${name}.0`, auxFormat), historyTarget(`${name}.1`, auxFormat)], last: 0, live: false };
}

/** What the pass did, for `__debug.gpu()` and the tests. */
export const TAA_STATS = { resolved: 0, resets: 0, copies: 0, resizes: 0 };

/**
 * Every pass made and not yet let go of, oldest first: one a chain on WebGPU, two while the Effects switch warms a new chain
 * beside the one drawing (wave 6's fixer: a new chain thrown away there leaves the old one standing, never none).
 */
const LIVE_PASSES: GpuTaaPass[] = [];
/** The newest pass not let go of (the console's word on what draws; whether a chain stands, for the scene's size), or null. */
export function taaPassNow(): GpuTaaPass | null {
  return LIVE_PASSES.length > 0 ? LIVE_PASSES[LIVE_PASSES.length - 1] : null;
}

export class GpuTaaPass implements FxPass {
  readonly id: FxPassId = 'taa';
  readonly timerLabel = 'pass:taa';
  private readonly renderer: Any;
  private readonly inputs: TaaInputs;
  private readonly full: History;
  private readonly up: History;
  private readonly gFull: ChainGraph;
  private readonly gUp: ChainGraph;
  /** The mode the settings ask for, and the picture's size (the chain's output size: the canvas's). */
  private mode = SMOOTHING.full as number;
  private width = 1;
  private height = 1;
  /** The scene target carries a motion buffer: without one nothing can be reprojected and the pass never draws. */
  private readonly motion: THREE.Texture | null;
  /** The next resolve takes the new frame whole (made, resized, a mode changed). */
  private fresh = true;

  constructor(renderer: Any, sceneTarget: THREE.RenderTarget, settings: FxSettings) {
    this.renderer = renderer;
    this.motion = motionTextureOf(sceneTarget.texture);
    const standIn = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    standIn.needsUpdate = true;
    this.inputs = {
      input: { value: null },
      history: { value: null },
      aux: { value: null },
      depth: sceneTarget.depthTexture as THREE.Texture,
      motion: this.motion ?? standIn,
      reversed: renderer.reversedDepthBuffer === true,
      // Each field begun as a fraction (a field begun as a whole number boxes every fraction written into it after).
      p0: new THREE.Vector4(0.05, 9000.5, 0.05, 0.8),
      p1: new THREE.Vector4(0.05, 0.1, 128.5, 0.5),
      size: new THREE.Vector4(1.5, 1.5, 1.5, 1.5),
      jitter: new THREE.Vector2(0.25, 0.25),
      // Pass 3, wave 2 (maker T): the clouds' motion over the scene's on a frame they drew (`TAA_MOTION_IN`), the scene's otherwise.
      motionIn: { value: null },
    };
    this.full = history('fx.gpu.taa.full', THREE.RedFormat);
    this.up = history('fx.gpu.taa.upscaled', THREE.RGFormat);
    this.gFull = traaGraph(this.inputs);
    this.gUp = taauGraph(this.inputs);
    this.mode = Number(settings.smoothing ?? SMOOTHING.full);
    LIVE_PASSES.push(this);
  }

  enabled(_ctx: FxFrameContext): boolean {
    return this.motion !== null && this.mode !== SMOOTHING.off;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_NEEDS;
  }

  reason(_ctx: FxFrameContext): string | null {
    if (this.motion === null) return "the scene target carries no motion buffer (__debug.gpu({ motion: false }), or the motion patch did not apply): nothing can be reprojected";
    if (this.mode === SMOOTHING.off) return 'Smoothing is Off on the Graphics page';
    return null;
  }

  /** Whether the frame should be jittered for this pass: it will draw (the chain's own `passWanted` asked first by the runtime). */
  canDraw(): boolean {
    return this.motion !== null && this.mode !== SMOOTHING.off;
  }

  /** The mode drawing now ('off', 'full', 'upscaled'). */
  get modeName(): 'off' | 'full' | 'upscaled' {
    return this.mode === SMOOTHING.upscaled ? 'upscaled' : this.mode === SMOOTHING.full ? 'full' : 'off';
  }

  prepare(ctx: FxFrameContext): void {
    const u = this.inputs;
    const t = TAA_TUNE;
    const up = this.mode === SMOOTHING.upscaled;
    // Written field by field into kept vectors, which three reads by reference; nothing is allocated.
    u.p0.x = ctx.near;
    u.p0.y = ctx.far;
    u.p0.z = up ? t.currentUp : t.current;
    u.p0.w = t.reactive;
    u.p1.x = t.depth;
    u.p1.y = t.edge;
    u.p1.z = t.maxMotion;
    const reset = this.fresh || ctx.cameraCut;
    u.p1.w = reset ? 1 : 0;
    if (reset) TAA_STATS.resets++;
    u.jitter.x = JITTER.on ? JITTER.x : 0;
    u.jitter.y = JITTER.on ? JITTER.y : 0;
    // Pass 3, wave 2 (maker T): the clouds' motion where they drew this frame (they stand before this pass in the chain).
    u.motionIn!.value = TAA_MOTION_IN.frame === ctx.frame ? TAA_MOTION_IN.value : null;
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const r = ctx.renderer as Any;
    const up = this.mode === SMOOTHING.upscaled;
    const h = up ? this.up : this.full;
    const g = up ? this.gUp : this.gFull;
    const read = h.rt[h.last];
    const write = h.rt[1 - h.last];
    const u = this.inputs;
    u.size.x = input.width;
    u.size.y = input.height;
    u.size.z = write.width;
    u.size.w = write.height;
    u.input.value = input.texture;
    u.history.value = read.textures[0];
    u.aux.value = read.textures[1];
    r.setRenderTarget(write);
    r.render(g.mesh, FX_CAMERA);
    h.last = 1 - h.last;
    this.fresh = false;
    TAA_STATS.resolved++;
    // The smoothed picture into the chain's buffer, which the bloom adds into; the history stays as resolved.
    if (output !== null) {
      r.copyTextureToTexture(write.textures[0], output.texture);
      TAA_STATS.copies++;
    }
    return output !== null;
  }

  setSize(width: number, height: number, settings: FxSettings): void {
    const mode = Number(settings.smoothing ?? SMOOTHING.full);
    if (mode !== this.mode || width !== this.width || height !== this.height) this.fresh = true;
    this.mode = mode;
    this.width = width;
    this.height = height;
    // Only the mode drawing holds targets the picture's size; the other's stand at a pixel (made, and warmed, all the same).
    const fullLive = mode === SMOOTHING.full;
    const upLive = mode === SMOOTHING.upscaled;
    for (const [h, live] of [
      [this.full, fullLive],
      [this.up, upLive],
    ] as const) {
      const w = live ? width : 1;
      const hh = live ? height : 1;
      for (const t of h.rt) if (t.width !== w || t.height !== hh) t.setSize(w, hh);
      h.live = live;
    }
    TAA_STATS.resizes++;
  }

  materials(): FxWarmItem[] {
    // Each resolve warmed against a history target of its own kind: WebGPU keys a pipeline on the target's outputs' formats.
    return [
      { material: this.gFull.material, object: this.gFull.mesh, where: 'target', into: this.full.rt[0] },
      { material: this.gUp.material, object: this.gUp.mesh, where: 'target', into: this.up.rt[0] },
    ];
  }

  /** The history's colour and distance, for the debug view (`__debug.fxView('taa.history')`, `'taa.depth'`). */
  debugTextures(): { name: string; texture: THREE.Texture | null; channels: 'r' | 'rgb'; scale?: number }[] {
    const h = this.mode === SMOOTHING.upscaled ? this.up : this.full;
    const t = h.rt[h.last];
    return [
      { name: 'history', texture: t.textures[0], channels: 'rgb' },
      { name: 'depth', texture: t.textures[1], channels: 'r', scale: 0.01 },
    ];
  }

  /** What `__debug.gpu()` says of it. */
  report(): Record<string, unknown> {
    const h = this.mode === SMOOTHING.upscaled ? this.up : this.full;
    const px = h.live ? h.rt[0].width * h.rt[0].height : 0;
    const bytes = this.mode === SMOOTHING.upscaled ? 24 : this.mode === SMOOTHING.full ? 20 : 0;
    return {
      mode: this.modeName,
      motionBuffer: this.motion !== null,
      picture: h.live ? [h.rt[0].width, h.rt[0].height] : null,
      scene: [this.inputs.size.x, this.inputs.size.y],
      historyMB: Math.round((px * bytes) / (1024 * 1024)),
      jitter: { on: JITTER.on, x: JITTER.x, y: JITTER.y, index: JITTER.index, framesJittered: JITTER.frames, putBackLate: JITTER.stale },
      ...TAA_STATS,
      tune: { ...TAA_TUNE },
    };
  }

  dispose(): void {
    for (const h of [this.full, this.up]) for (const t of h.rt) t.dispose();
    this.gFull.material.dispose();
    this.gUp.material.dispose();
    const at = LIVE_PASSES.indexOf(this);
    if (at >= 0) LIVE_PASSES.splice(at, 1);
  }
}

