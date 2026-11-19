// The ambient occlusion on WebGPU (the GPU port's step 6, item 4): the WebGL `SsaoPass` made over again with its draws put
// through the node graphs of `gpuSsao.ts`, registered on the very runner the WebGL path uses (`PostFX`) by the WebGPU
// chain's install (`chainRuntime`), with the two depth products it asks for and the debug view its views draw through.
//
// The pass extends the WebGL one: its `prepare` (every uniform worked out of the frame and its lights) is the WebGL pass's
// own, its `setSize`, `enabled`, `needs`, `reason`, `lightsReport`, `setRoomLights` and tuning too; only its draws differ.
// Two things are its own:
//   - **the water's coverage**: WebGPU has no water mask (the water is a remake), so each frame water is in view the pass
//     draws the water bodies' own twins (`WaterFxSource.syncTwins`, the very meshes WebGL's mask draws) into the region
//     target's green, flat as the stand-in itself is drawn, depth tested against the scene's own depth and never writing it;
//     the apply leaves those pixels alone as WebGL leaves the mask's. Where no water source was handed over, AO darkens
//     what it sees through the water's surface, the bed under it;
//   - **the probe answers asynchronously** (`__debug.ssao().centre` is a promise the console awaits): WebGPU reads back only
//     so.
//
// Each graph is warmed against the very target it draws into (`FxWarmItem.into`): the occlusion's own eight-bit buffers,
// the region target that shares the scene's depth and stencil, the half-resolution products' own targets, since WebGPU keys
// a pipeline on its target's colour format and its depth-stencil attachment; and the water's coverage through its own
// perspective camera on each of the water twins' geometry layouts (`FxWarmItem.camera`, step 6's fixer), since WebGPU keys a
// render context on the camera's kind and a program on every attribute. Nothing here is loaded on the WebGL path.

import * as THREE from 'three';
import type { PostFX } from '../postfx.ts';
import type { FxFrameContext } from '../fx/context.ts';
import { FX_CAMERA, type FxWarmItem } from '../fx/pass.ts';
import { SsaoPass, type SsaoHost, type SsaoProbe } from '../fx/ssao.ts';
import { decodeCeiling } from '../fx/ssaoMath.ts';
import { LinearDepthHalf, NormalsHalf } from '../fx/products.ts';
import { DebugViewPass } from '../fx/passes.ts';
import { createSharedDepthTarget } from '../fx/geometry.ts';
import type { WaterFxSource } from '../fx/water.ts';
import type { ChainGraph } from './gpuChain.ts';
import { applyGraph, blurGraph, debugViewGraph, gtaoGraph, linearDepthHalfGraph, normalsHalfGraph, probeGraph, regionGraph, singleSampled, waterCoverageMaterial, type SsaoUniforms } from './gpuSsao.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A graph drawn into a target (null: the canvas). */
function draw(r: Any, g: ChainGraph, into: THREE.RenderTarget | null): void {
  r.setRenderTarget(into);
  r.render(g.mesh, FX_CAMERA);
}

const warmInto = (g: ChainGraph, into: THREE.RenderTarget): FxWarmItem => ({ material: g.material, object: g.mesh, where: 'target', into });
const warmItem = (g: ChainGraph, where: FxWarmItem['where']): FxWarmItem => ({ material: g.material, object: g.mesh, where });

/**
 * A geometry's layout as three keys a program on it (`RenderObject.getGeometryCacheKey`): each attribute's name, the kind of
 * array it is read from (keyed from three's development commit 577fb27 on, pass 1's wave 2), its size and normalisation.
 */
export function geometryLayout(g: THREE.BufferGeometry): string {
  let key = '';
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    key += `${name},${a.array?.constructor?.name ?? ''},${a.itemSize ?? ''},${a.normalized ? 'n,' : ''}`;
  }
  return key;
}

/** The depth the scene target carries on this renderer: a float under reversed depth (with the portals' stencil), else 24 bits. */
const depthTypeOf = (renderer: Any): THREE.TextureDataType => (renderer.reversedDepthBuffer === true ? THREE.FloatType : THREE.UnsignedInt248Type);

/**
 * The host a WebGPU chain gives the pass: its product list, and a region target sharing the scene's depth and stencil with
 * two eight-bit channels where WebGL's has one (red the rooms' region as on WebGL, green the water stand-ins' coverage).
 */
export function gpuSsaoHost(postfx: PostFX): SsaoHost {
  return {
    hasProduct: (id) => postfx.product(id) !== undefined,
    createRegionTarget: () => createSharedDepthTarget(postfx, { format: THREE.RGFormat, type: THREE.UnsignedByteType, name: 'fx.ssao.region' }),
  };
}

const BLACK = new THREE.Color(0, 0, 0);

export class GpuSsaoPass extends SsaoPass {
  private readonly graphs: { gtao: [ChainGraph, ChainGraph]; blur: [ChainGraph, ChainGraph]; apply: [ChainGraph, ChainGraph]; probe: ChainGraph; region: ChainGraph };
  /** 1 while the region target's green holds the water stand-ins' coverage this frame (the apply's own record). */
  private readonly waterOn = { value: 0 };
  private readonly regionTexture: { value: THREE.Texture | null };
  private readonly waterMaterial = waterCoverageMaterial();
  /** The twins' stand-ins: one mesh each over its twin's geometry, at its matrix, drawn with the coverage material. */
  private readonly waterGroup = new THREE.Group();
  private readonly mirrors: THREE.Mesh[] = [];
  /**
   * A triangle of positions alone, warmed beside a stand-in on each layout the water's twins carry at a warm (`waterWarms`):
   * for water whose geometry is positions alone, met after the warm.
   */
  private readonly waterWarm: THREE.Mesh;
  private readonly kept = new THREE.Color();
  /**
   * The camera the twins are drawn with: the game camera's projection and place copied each frame, on layer 0 alone (the
   * game's camera also sees the actors' layer, which the warm-up's camera does not, and the twins stand on layer 0 alone).
   */
  private readonly waterCam = new THREE.PerspectiveCamera();
  /** What the pass drew of the water last frame, for the console. */
  waterDrawn = 0;

  constructor(
    host: SsaoHost,
    private readonly water: WaterFxSource | null,
    renderer: Any,
  ) {
    super(host);
    const self = this as Any;
    const u: SsaoUniforms = { gU: self.gU, bU: self.bU, aU: self.aU, pU: self.pU };
    const reversed = renderer.reversedDepthBuffer === true;
    const depthType = depthTypeOf(renderer);
    // The WebGL pass's own stand-in for the cascades' maps, held single-sampled wherever it is met (singleSampled).
    singleSampled(self.noShadow as THREE.DepthTexture);
    this.regionTexture = { value: (self.region as THREE.RenderTarget).texture };
    this.graphs = {
      gtao: [gtaoGraph(u, false, reversed, depthType), gtaoGraph(u, true, reversed, depthType)],
      blur: [blurGraph(u, false, reversed, depthType), blurGraph(u, true, reversed, depthType)],
      apply: [applyGraph(u, false, reversed, depthType, this.waterOn, this.regionTexture), applyGraph(u, true, reversed, depthType, this.waterOn, this.regionTexture)],
      probe: probeGraph(u, reversed, depthType),
      region: regionGraph(),
    };
    this.waterGroup.matrixAutoUpdate = false;
    this.waterGroup.matrixWorldAutoUpdate = false;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
    this.waterWarm = new THREE.Mesh(tri, this.waterMaterial);
    this.waterWarm.frustumCulled = false;
    const c = this.waterCam as Any;
    c.matrixAutoUpdate = false;
    c.matrixWorldAutoUpdate = false;
    // Turned as three would turn it at its first draw, so three never works its projection out again over the copy.
    if (reversed) c._reversedDepth = true;
  }

  /** The water's twins stood in for (their geometry, their matrix, their visibility): how many show this frame. */
  private syncWater(ctx: FxFrameContext): number {
    const src = this.water;
    if (!src) return 0;
    const n = src.syncTwins(ctx.camera);
    const twins = src.maskScene.children;
    let shown = 0;
    for (let i = 0; i < twins.length; i++) {
      const twin = twins[i] as THREE.Mesh;
      let m = this.mirrors[i];
      if (!m) {
        m = new THREE.Mesh(twin.geometry, this.waterMaterial);
        m.matrixAutoUpdate = false;
        m.matrixWorldAutoUpdate = false;
        m.frustumCulled = false;
        this.mirrors.push(m);
        this.waterGroup.add(m);
      }
      m.geometry = twin.geometry;
      m.matrixWorld.copy(twin.matrixWorld);
      m.visible = n > 0 && twin.visible === true && !!twin.geometry;
      if (m.visible) shown++;
    }
    for (let i = twins.length; i < this.mirrors.length; i++) this.mirrors[i].visible = false;
    return shown;
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const r = ctx.renderer as Any;
    const self = this as Any;
    self.drawnFrame = ctx.frame;
    const k = self.half ? 0 : 1;
    const g = this.graphs;
    const region = self.region as THREE.RenderTarget;
    const useRegion = self.useRegion === true;
    const water = this.syncWater(ctx);
    this.waterDrawn = water;
    this.waterOn.value = water > 0 ? 1 : 0;
    // The region target is drawn when it is read, and cleared when only the debug view would show it.
    if (useRegion || water > 0 || ctx.debugViewPass === 'ssao') {
      r.setRenderTarget(region);
      r.getClearColor(this.kept);
      const alpha = r.getClearAlpha();
      r.setClearColor(BLACK, 0);
      r.clear(true, false, false);
      r.setClearColor(this.kept, alpha);
      if (water > 0) {
        const c = this.waterCam;
        const s = ctx.camera;
        c.projectionMatrix.copy(s.projectionMatrix);
        c.projectionMatrixInverse.copy(s.projectionMatrixInverse);
        c.matrixWorld.copy(s.matrixWorld);
        c.matrixWorldInverse.copy(s.matrixWorldInverse);
        c.near = s.near;
        c.far = s.far;
        r.render(this.waterGroup, c);
      }
      if (useRegion) {
        // The WebGL region material's own stencil reference, written by its `prepare` (rooms 1 inside, 3 from outside).
        g.region.material.stencilRef = (self.regionMaterial as THREE.Material).stencilRef;
        draw(r, g.region, region);
      }
    }
    draw(r, g.gtao[k], self.aoA);
    const b = self.bU;
    b.tAo.value = self.aoA.texture;
    (b.uStep.value as THREE.Vector2).set(1, 0);
    draw(r, g.blur[k], self.aoB);
    b.tAo.value = self.aoB.texture;
    (b.uStep.value as THREE.Vector2).set(0, 1);
    draw(r, g.blur[k], self.aoA);
    const a = self.aU;
    a.tDiffuse.value = input.texture;
    if (self.debugTarget) {
      a.uDebug.value = 1;
      draw(r, g.apply[k], self.debugTarget);
      a.uDebug.value = 0;
    }
    draw(r, g.apply[k], output);
    return true;
  }

  /** Each graph against the very target it draws into: both resolutions, the region's two, and the probe's. */
  materials(): FxWarmItem[] {
    const self = this as Any;
    const g = this.graphs;
    const out: FxWarmItem[] = [];
    for (const k of [0, 1]) {
      out.push(warmInto(g.gtao[k], self.aoA), warmInto(g.blur[k], self.aoA), warmItem(g.apply[k], 'target'));
    }
    out.push(warmInto(g.region, self.region), warmInto(g.probe, self.probeTarget));
    // The water's coverage through the very camera it is drawn with (a perspective one: WebGPU keys a render context on the
    // camera's kind) and on each geometry layout the world's water twins carry now (three keys a program on every
    // attribute's name, size and normalisation), with the triangle for water that comes later: warmed through the chain's
    // orthographic camera on the triangle alone, every new chain built it at its first frame with water in view.
    for (const object of this.waterWarms()) out.push({ material: this.waterMaterial, object, where: 'target', into: self.region, camera: this.waterCam });
    return out;
  }

  /** One stand-in of the coverage on each geometry layout the water's twins have (and the triangle), made at each warm. */
  private waterWarms(): THREE.Mesh[] {
    const out = [this.waterWarm];
    const twins = this.water?.maskScene.children ?? [];
    const seen = new Set<string>([geometryLayout(this.waterWarm.geometry)]);
    for (const t of twins) {
      const geometry = (t as THREE.Mesh).geometry;
      if (!geometry) continue;
      const key = geometryLayout(geometry);
      if (seen.has(key)) continue;
      seen.add(key);
      const m = new THREE.Mesh(geometry, this.waterMaterial);
      m.frustumCulled = false;
      out.push(m);
    }
    return out;
  }

  /** What the AO target holds under the crosshair, read back asynchronously: a promise of the WebGL answer's shape. */
  probe(ctx: FxFrameContext): SsaoProbe | null {
    const self = this as Any;
    if (self.drawnFrame !== ctx.frame - 1) return null;
    const r = ctx.renderer as Any;
    const u = self.pU;
    const cx = ctx.width >> 1;
    const cy = ctx.height >> 1;
    u.tDepth.value = ctx.depth;
    u.tAo.value = self.aoA.texture;
    (u.uPixel.value as THREE.Vector2).set(cx, cy);
    if (self.last.half) (u.uAoTexel.value as THREE.Vector2).set(Math.min(cx >> 1, self.aoA.width - 1), Math.min(cy >> 1, self.aoA.height - 1));
    else (u.uAoTexel.value as THREE.Vector2).set(cx, cy);
    u.uNear.value = ctx.near;
    u.uFar.value = ctx.far;
    const previous = r.getRenderTarget();
    draw(r, this.graphs.probe, self.probeTarget);
    r.setRenderTarget(previous);
    const round3 = (v: number) => Math.round(v * 1000) / 1000;
    return (r.readRenderTargetPixelsAsync(self.probeTarget, 0, 0, 1, 1) as Promise<Float32Array>).then((v) => ({
      viewZ: v[0] < 0 ? null : round3(v[0]),
      ao: round3(v[1]),
      fraction: round3(v[2]),
      ceiling: round3(decodeCeiling(v[3])),
    })) as unknown as SsaoProbe;
  }

  /** What the console says of the water on WebGPU. */
  waterReport(): Record<string, unknown> {
    return { source: !!this.water, twinsDrawn: this.waterDrawn, how: "the water bodies' own twins drawn flat into the region target's green (the stand-in's surface, no waves); the apply leaves those pixels alone" };
  }

  dispose(): void {
    const g = this.graphs;
    for (const x of [...g.gtao, ...g.blur, ...g.apply, g.probe, g.region]) x.material.dispose();
    this.waterMaterial.dispose();
    this.waterWarm.geometry.dispose();
    this.mirrors.length = 0;
    super.dispose();
  }
}

export class GpuLinearDepthHalf extends LinearDepthHalf {
  private readonly g: ChainGraph;

  constructor(renderer: Any) {
    super();
    const self = this as Any;
    this.g = linearDepthHalfGraph((self.material as THREE.ShaderMaterial).uniforms, renderer.reversedDepthBuffer === true, depthTypeOf(renderer));
  }

  render(ctx: FxFrameContext): void {
    const self = this as Any;
    const u = (self.material as THREE.ShaderMaterial).uniforms;
    u.tDepth.value = ctx.depth;
    (u.uNearFar.value as THREE.Vector2).set(ctx.near, ctx.far);
    draw(ctx.renderer, this.g, self.target);
  }

  materials(): FxWarmItem[] {
    return [warmInto(this.g, (this as Any).target)];
  }

  dispose(): void {
    this.g.material.dispose();
    super.dispose();
  }
}

export class GpuNormalsHalf extends NormalsHalf {
  private readonly g: ChainGraph;

  constructor() {
    super();
    this.g = normalsHalfGraph(((this as Any).material as THREE.ShaderMaterial).uniforms);
  }

  render(ctx: FxFrameContext): void {
    const self = this as Any;
    const u = (self.material as THREE.ShaderMaterial).uniforms;
    u.tLinear.value = ctx.products.linearDepthHalf;
    (u.uTexel.value as THREE.Vector2).set(1 / self.target.width, 1 / self.target.height);
    (u.uTanHalfFov.value as THREE.Vector2).copy(ctx.tanHalfFov);
    u.uFar.value = ctx.far;
    draw(ctx.renderer, this.g, self.target);
  }

  materials(): FxWarmItem[] {
    return [warmInto(this.g, (this as Any).target)];
  }

  dispose(): void {
    this.g.material.dispose();
    super.dispose();
  }
}

/**
 * The debug view on WebGPU, for the occlusion's views and the two products (`__debug.ssao({ view })`, `__debug.fxView`):
 * the WebGL pass's own `prepare` and modes, drawn onto the canvas with its numbers as they are. Only the console's override
 * turns it on; a view of a pass not ported shows the scene's raw colour.
 */
export class GpuDebugViewPass extends DebugViewPass {
  private readonly g: ChainGraph;

  constructor(renderer: Any) {
    super();
    this.g = debugViewGraph(this.material.uniforms, renderer.reversedDepthBuffer === true, depthTypeOf(renderer));
  }

  render(ctx: FxFrameContext, _input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    draw(ctx.renderer, this.g, output);
    return true;
  }

  materials(): FxWarmItem[] {
    return [warmItem(this.g, 'screen')];
  }

  dispose(): void {
    this.g.material.dispose();
    super.dispose();
  }
}
