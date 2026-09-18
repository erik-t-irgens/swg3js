// What an effect is, from the runner's side. A pass reads one picture and writes another; a
// product is something several passes want computed once a frame (half-resolution depth, view
// normals, the heat in the air, the water's surface, how fast things move).
//
// Rules a pass must keep, whatever it does:
//   - nothing is allocated in enabled, needs, prepare or render: the arrays `needs` returns are
//     kept ones, and every vector and matrix belongs to the pass;
//   - a pass with nothing to do this frame says so from `enabled` and costs nothing;
//   - no pass puts a light in a scene of its own: the number of lights in a scene is in every
//     program's key, so one added light recompiles the world.
import * as THREE from 'three';
import type { FxProductId, FxPassId, FxSettings } from '../fxRegistry.ts';
import type { FxFrameContext } from './context';

/** The empty `needs`, shared so a pass that wants nothing allocates nothing. */
export const NO_PRODUCTS: readonly FxProductId[] = [];

/** The camera every full-screen draw uses: the triangle already fills clip space. */
export const FX_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/**
 * One triangle that overhangs the screen, drawn instead of two: no seam down the diagonal and one
 * fewer vertex. Shared by every full-screen draw, so it is never disposed while a pass lives.
 */
export const FX_TRIANGLE = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  return g;
})();

/** A mesh on the shared triangle, never culled, for drawing a material over the whole screen. */
export function createFxQuad(material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(FX_TRIANGLE, material);
  mesh.frustumCulled = false;
  return mesh;
}

export interface FxWarmItem {
  material: THREE.Material;
  /** What to compile it with; a full-screen triangle by default, a stand-in skinned mesh for a skinned override. */
  object?: THREE.Object3D;
  /** Where it draws: into a target, onto the canvas, or either, for a pass that can be last. */
  where?: 'target' | 'screen' | 'both';
}

/** A working texture a pass will show on request: `__debug.fxView('ssao.ao')`. */
export interface FxDebugTexture {
  /** The part after the dot. */
  name: string;
  texture: THREE.Texture | null;
  /** One channel shown as grey, or the three as colour. */
  channels: 'r' | 'g' | 'b' | 'a' | 'rgb';
  /** Multiplied before it is shown, for values that do not sit in 0 to 1. */
  scale?: number;
}

export interface FxPass {
  readonly id: FxPassId;
  /** 'pass:<id>', built once. */
  readonly timerLabel: string;
  /** Conditions in the frame only: the settings toggles have already been checked by the runner. */
  enabled(ctx: FxFrameContext): boolean;
  /** The products it wants this frame; return a kept array. */
  needs(ctx: FxFrameContext): readonly FxProductId[];
  /** Uniforms from the context and its products. Only called on the frames it draws. */
  prepare(ctx: FxFrameContext): void;
  /**
   * Read `input.texture` and draw into `output` (null: the canvas). True when it wrote `output`,
   * so the runner swaps; false when it changed `input` where it stands.
   */
  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean;
  setSize(width: number, height: number, settings: FxSettings): void;
  materials(): FxWarmItem[];
  dispose(): void;
  /** Why it did not draw, for the console listing only; never called on a drawing frame. */
  reason?(ctx: FxFrameContext): string | null;
  /** Working textures the debug view can show. */
  debugTextures?(): readonly FxDebugTexture[];
}

export interface FxProduct {
  readonly id: FxProductId;
  readonly kind: 'depth' | 'geometry';
  /** 'product:<id>', built once. */
  readonly timerLabel: string;
  needs(ctx: FxFrameContext): readonly FxProductId[];
  render(ctx: FxFrameContext): void;
  readonly texture: THREE.Texture;
  setSize(width: number, height: number, settings: FxSettings): void;
  materials(): FxWarmItem[];
  dispose(): void;
  /**
   * Every frame, right after the context is updated and before any pass decides: a question asked of
   * the finished scene (the water's occlusion query). It may bind the scene target only to draw with
   * colour, depth and stencil writes all off.
   */
  probe?(ctx: FxFrameContext): void;
  /** A frame nothing wants this product: its chance to give storage back after a while unused. */
  idle?(ctx: FxFrameContext): void;
  /** Whether its targets hold storage on the card now; absent means always. */
  readonly allocated?: boolean;
}

/** A pass that is one full-screen draw of one shader. */
export abstract class ShaderFxPass implements FxPass {
  abstract readonly id: FxPassId;
  protected readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private label?: string;

  /**
   * `inputName` is the uniform the picture coming in is bound to; null for a pass that takes its
   * input from somewhere else (the sanitize pass reads the scene target itself).
   */
  protected constructor(
    shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string; defines?: Record<string, unknown> },
    private readonly inputName: string | null = 'tDiffuse',
  ) {
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(shader.uniforms),
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      defines: { ...shader.defines },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = createFxQuad(this.material);
  }

  get timerLabel(): string {
    return (this.label ??= `pass:${this.id}`);
  }

  enabled(_ctx: FxFrameContext): boolean {
    return true;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_PRODUCTS;
  }

  prepare(_ctx: FxFrameContext): void {}

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    if (this.inputName) this.material.uniforms[this.inputName].value = input.texture;
    ctx.renderer.setRenderTarget(output);
    ctx.renderer.render(this.quad, FX_CAMERA);
    return true;
  }

  setSize(_width: number, _height: number, _settings: FxSettings): void {}

  materials(): FxWarmItem[] {
    return [{ material: this.material }];
  }

  dispose(): void {
    this.material.dispose();
  }
}

/** What a pass of three's own looks like from here (`UnrealBloomPass`, `OutputPass`). */
interface InnerPass {
  needsSwap: boolean;
  renderToScreen: boolean;
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** A pass of three's own, driven by the runner rather than by a composer. */
export abstract class ThreePassAdapter implements FxPass {
  abstract readonly id: FxPassId;
  private label?: string;

  protected constructor(protected readonly inner: InnerPass) {}

  get timerLabel(): string {
    return (this.label ??= `pass:${this.id}`);
  }

  enabled(_ctx: FxFrameContext): boolean {
    return true;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_PRODUCTS;
  }

  prepare(_ctx: FxFrameContext): void {}

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    this.inner.renderToScreen = output === null;
    // A pass that composites in place ignores the write buffer, so passing the input is harmless.
    this.inner.render(ctx.renderer, output ?? input, input, ctx.dt, false);
    return this.inner.needsSwap;
  }

  setSize(width: number, height: number, _settings: FxSettings): void {
    this.inner.setSize(width, height);
  }

  abstract materials(): FxWarmItem[];

  dispose(): void {
    this.inner.dispose();
  }
}
