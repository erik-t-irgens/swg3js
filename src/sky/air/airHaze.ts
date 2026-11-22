// The haze to the horizon on WebGPU (the GPU port's pass 2, wave 1; the design's 2.2), under our sky: the air between the
// eye and everything it sees, worked from the air's own tables (`airApi.ts`'s `AIR.tables`) and nothing else.
//
// Two halves, one rule (`airHazeMath.ts`):
//   - **the haze pass** (`GpuHazePass`, the registry's `haze`, before the edge smoothing): each solid pixel of the effects'
//     scene target keeps what gets through the air and gains what the air adds, from the haze volume at its own distance to
//     24 km and the sky view past it, and what was drawn in front of it is laid back over it from the see-through layer
//     (`airSee.ts`), which those things hazed at their own distance as they drew. The sky's pixels (nothing solid drawn) take
//     no haze of the pass (the sky view is the air already), nor does a room's solid pixel seen from inside its building (the
//     rooms take none this pass; the room air of a later pass is theirs). One full-screen draw a frame, no product asked for.
//   - **the scene's one fog node** (`hazeFogNode`): set once at load on the world's scene as three's `fogNode` (three keys every
//     render object on it, so it is never set again and no pipeline key moves), it hazes at its own distance whatever draws
//     with three's fog on and is not hazed by the pass: everything see-through (smoke, fire, bolts, glass, water that writes
//     no depth), and every solid where the pass does not draw (Effects off: the scene straight onto the canvas). A solid drawn
//     into a scene target that carries the layer it leaves as it is. The rooms' pass draws through a scene of its own that
//     takes a fog node of no haze (`ROOMS_FOG`).
//
// The haze volume's place is the frame camera's own (the screen's normalised place and the distance), so a pixel's place is
// worked out of its texel and the depth, and a see-through thing's out of its view place and the camera's projection.
//
// Nothing here is loaded on the WebGL path.

import * as THREE from 'three';
import { Node } from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { FxFrameContext } from '../../core/fx/context.ts';
import { FX_CAMERA, type FxPass, type FxWarmItem } from '../../core/fx/pass.ts';
import type { FxPassId, FxProductId, FxSettings } from '../../core/fxRegistry.ts';
import { chainMaterial, graph, storedOf, type ChainGraph } from '../../core/gpu/gpuChain.ts';
import { liveTexture } from '../../core/gpu/gpuGround.ts';
import { AIR, HAZE_REACH_M } from './airApi.ts';
import { buildsLayer, seeTextureOf } from './airSee.ts';
import { seeKindOf } from './airHazeMath.ts';
import { skyOurs } from '../skyMode.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, If, abs, cameraProjectionMatrix, clamp, float, floatBitsToUint, floor, ivec2, length, max, min, normalize, output, outputStruct, positionView, pow, renderGroup, select, sqrt, struct, texture, uint, uniform, uv, vec2, vec3, vec4 } = TSL as Any;

/**
 * The haze's numbers that are no dial: the exponent field a value that is not a number fills and the brightest a pixel is
 * held to (the sanitize's own, which stands before this pass: `gpuChain.ts`'s `CHAIN_NUMBERS.sanitize`), and a floor.
 */
export const HAZE_NUMBERS = { exponent: 0x7f800000, ceiling: 256.0, tFloor: 1e-6 } as const;

/** What the haze has done, for `__debug.sky()` and the tests. */
export const HAZE_STATS = { drawn: 0, plain: 0, built: 0, fogBuilt: { solid: 0, seeThrough: 0, none: 0 } };

/** Every pass made and not yet let go of, newest last: the console's word on what draws. */
const LIVE_PASSES: GpuHazePass[] = [];
export function hazePassNow(): GpuHazePass | null {
  return LIVE_PASSES.length > 0 ? LIVE_PASSES[LIVE_PASSES.length - 1] : null;
}

/** A value that is not a number or is infinite (the sanitize's test, on the f32's exponent field). */
const notFinite = (x: Any): Any => floatBitsToUint(x).bitAnd(uint(HAZE_NUMBERS.exponent)).equal(uint(HAZE_NUMBERS.exponent));
/** Every channel of a vec4 a number. */
const finite4 = (v: Any): Any => notFinite(v.x).or(notFinite(v.y)).or(notFinite(v.z)).or(notFinite(v.w)).not();

/** A linear half-float texel of its own: the chain buffer's slot until the runner binds one. */
function halfFallback(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** What the graph reads, each kept by the pass and written in place. */
export interface HazeInputs {
  /** The picture coming in (a chain buffer: the colour target as the surface passes left it). */
  input: { value: THREE.Texture | null };
  /** The scene target's depth and its see-through layer, each fixed for a chain's life. */
  depth: THREE.Texture;
  see: THREE.Texture;
  reversed: boolean;
  /** (near, far, 1 while the camera is inside a building, 1 while the air draws this frame). */
  p0: THREE.Vector4;
  /** (tan of the half field of view times the aspect, tan of the half field of view, the scene's width, its height). */
  p1: THREE.Vector4;
  /** The frame camera's turn (its world matrix's upper three rows and columns): a view's direction made a world one. */
  turn: THREE.Matrix3;
}

/** A depth texel's view distance along the view's axis (`airHazeMath.ts`'s `viewZOfDepth`), reversed or not. */
function viewZ(d: Any, near: Any, far: Any, reversed: boolean): Any {
  return reversed ? near.mul(far).div(near.add(d.mul(far.sub(near)))) : near.mul(far).div(far.sub(d.mul(far.sub(near))));
}

/** Whether a depth texel is the clear (`isSkyDepth`). */
function skyDepth(d: Any, reversed: boolean): Any {
  return reversed ? d.lessThanEqual(0) : d.greaterThanEqual(1);
}

/** A texel's place on the screen in normalised device coordinates (x right, y up) from its texture coordinate (rows from the top). */
function ndcOf(st: Any): Any {
  return vec2(st.x.mul(2).sub(1), float(1).sub(st.y.mul(2)));
}

/** The ray's length to a view depth `z` at a place `ndc` (`rayDistance`), for the view's extents `p1.xy`. */
function rayLength(z: Any, ndc: Any, p1: Any): Any {
  const vx = ndc.x.mul(p1.x);
  const vy = ndc.y.mul(p1.y);
  return z.mul(sqrt(float(1).add(vx.mul(vx)).add(vy.mul(vy))));
}

/**
 * The air between the eye and a point at `ndc` and `dist` metres (`hazeBeyondIn`'s rule past the reach): what gets through
 * (`t`, the air's mean) and what the air adds (`l`), each taken into a variable named `tag`. Reads the haze volume and the sky
 * view, so it is called at the top of a fragment, before anything branches.
 */
function airTerms(tables: NonNullable<typeof AIR.tables>, ndc: Any, dist: Any, p1: Any, turn: Any, tag: string): { t: Any; l: Any } {
  const dirW = normalize(turn.mul(vec3(ndc.x.mul(p1.x), ndc.y.mul(p1.y), -1))).toVar(`swgHaze${tag}Dir`);
  const h = vec4(tables.hazeAt(ndc, min(dist, HAZE_REACH_M))).toVar(`swgHaze${tag}H`);
  const skyL = vec3(tables.skyRadiance(dirW)).toVar(`swgHaze${tag}Sky`);
  const t0 = max(h.a, HAZE_NUMBERS.tFloor);
  const far = dist.greaterThan(HAZE_REACH_M);
  const t = select(far, pow(t0, dist.div(HAZE_REACH_M)), h.a).toVar(`swgHaze${tag}T`);
  const l = select(far, h.rgb.add(skyL.sub(h.rgb).mul(float(1).sub(t.div(t0)))), h.rgb).toVar(`swgHaze${tag}L`);
  return { t, l };
}

/**
 * The haze pass's graph at full resolution. `air` false builds the plain composite alone (`c + s.rgb` everywhere), drawn while
 * the air's tables are not there (before the air's maker made them, a world with no air, space): the see-through layer is laid
 * back all the same. `terms` (the half-resolution mode's) takes the air's terms from the half-size picture `hazeTermsGraph`
 * drew, each pixel from the one of its four nearest half texels whose distance is nearest its own (so a pole before a far
 * ridge keeps its own air), in place of working them out a pixel.
 */
export function hazeGraph(u: HazeInputs, air: boolean, terms: HazeTerms | null = null): ChainGraph {
  const m = chainMaterial(terms ? 'fx.gpu.haze.half' : air ? 'fx.gpu.haze' : 'fx.gpu.haze.plain');
  const input = liveTexture(u.input, halfFallback());
  const depth = texture(u.depth);
  const see = texture(u.see);
  const p0 = uniform(u.p0).setGroup(renderGroup);
  const p1 = uniform(u.p1).setGroup(renderGroup);
  const turn = uniform(u.turn).setGroup(renderGroup);
  const tables = air ? AIR.tables : null;
  const tl = terms ? texture(terms.target.textures[0]) : null;
  const td = terms ? texture(terms.target.textures[1]) : null;
  const hs = terms ? uniform(terms.size).setGroup(renderGroup) : null;
  m.fragmentNode = Fn(() => {
    const st = uv();
    const px = ivec2(st.mul(p1.zw));
    // Every read at the top, before anything branches (three writes a `select` out as an `if`).
    const c = vec4(input.sample(st)).toVar('swgHazeC');
    const s = vec4(see.load(px)).toVar('swgHazeS');
    If(notFinite(s.x).or(notFinite(s.y)).or(notFinite(s.z)).or(notFinite(s.w)), () => {
      s.assign(vec4(0, 0, 0, 1));
    });
    const out = c.rgb.add(s.rgb).toVar('swgHazeOut');
    if (tables) {
      const d = float(depth.load(px).x).toVar('swgHazeD');
      const sky = skyDepth(d, u.reversed);
      const ndc = ndcOf(st).toVar('swgHazeNdc');
      const dist = rayLength(viewZ(d, p0.x, p0.y, u.reversed), ndc, p1).toVar('swgHazeDist');
      let t: Any;
      let l: Any;
      if (tl && td && hs) {
        // The four half texels round the pixel's middle, the one whose distance is nearest the pixel's own taken.
        const q = floor(st.mul(hs.xy).sub(0.5));
        const best = float(1e30).toVar('swgHazeBest');
        t = float(1).toVar('swgHazeHT');
        l = vec3(0).toVar('swgHazeHL');
        for (let j = 0; j <= 1; j++) {
          for (let i = 0; i <= 1; i++) {
            const at = ivec2(clamp(q.add(vec2(i, j)), vec2(0), hs.xy.sub(1)));
            const a = vec4(tl.load(at)).toVar(`swgHazeA${i}${j}`);
            const b = float(td.load(at).x).toVar(`swgHazeB${i}${j}`);
            const gap = abs(b.sub(dist));
            If(gap.lessThan(best), () => {
              best.assign(gap);
              t.assign(a.a);
              l.assign(a.rgb);
            });
          }
        }
      } else {
        const a = airTerms(tables, ndc, dist, p1, turn, 'F');
        t = a.t;
        l = a.l;
      }
      const room = s.a.lessThan(0).and(p0.z.greaterThan(0.5));
      const hazed = sky.not().and(room.not()).and(p0.w.greaterThan(0.5));
      // Pass 2, wave 2's fixer: the picture and the layer are stored pre-exposed (`src/sky/exposure/preExpose.ts`), so the
      // air's own light, in the scene's units, is stood in theirs (`storedOf`); what gets through is a share and takes none.
      const ls = l.mul(storedOf()).toVar('swgHazeLS');
      If(hazed, () => {
        out.assign(c.rgb.mul(t).add(ls.mul(abs(s.a))).add(s.rgb));
      });
      // The pass stands after the sanitize: a value of the air's that is not a number (a table not yet drawn, a ray the tables
      // cannot reach) would be spread by the bloom into a black box, so such a pixel takes the composite alone.
      If(notFinite(out.x).or(notFinite(out.y)).or(notFinite(out.z)), () => {
        out.assign(c.rgb.add(s.rgb));
      });
    }
    // The ceiling is the scene's (the sanitize's), stood in the picture's units (the wave's fixer).
    return vec4(clamp(out, vec3(0), vec3(storedOf().mul(HAZE_NUMBERS.ceiling))), 1);
  })();
  HAZE_STATS.built++;
  const textures: Record<string, Any> = { input, depth, see };
  if (tl && td) Object.assign(textures, { terms: tl, termsDistance: td });
  return graph(m, Object.keys(textures).length, { uniforms: { p0, p1, turn, ...(hs ? { termsSize: hs } : {}) }, textures });
}

/**
 * The half-resolution mode's picture of the air's terms (the Low tier's, the design's 2.2): a texel for each two by two of the
 * scene's pixels, in its first output what the air adds (rgb) and what gets through (a) for the nearest solid of the four, and
 * in its second that solid's distance (the sky's four the far kept, so no solid takes their terms).
 */
export interface HazeTerms {
  target: THREE.RenderTarget;
  /** (its width, its height, the scene's width, the scene's height). */
  size: THREE.Vector4;
}

/** The distance a texel with no solid keeps (a half float holds 65,504), the far side of any reach. */
const FAR_KEPT = 60000;

/** The terms' two outputs. */
const TERMS_OUT = struct({ terms: 'vec4', distance: 'vec4' });

export function hazeTermsGraph(u: HazeInputs, terms: HazeTerms): ChainGraph | null {
  const tables = AIR.tables;
  if (!tables) return null;
  const m = chainMaterial('fx.gpu.haze.terms');
  // Two outputs, carried through no output of three's (the edge smoothing's resolves' way: the inline output would otherwise
  // build its arithmetic over the struct).
  (m as Any).swgRawOut = true;
  const depth = texture(u.depth);
  const p0 = uniform(u.p0).setGroup(renderGroup);
  const p1 = uniform(u.p1).setGroup(renderGroup);
  const turn = uniform(u.turn).setGroup(renderGroup);
  const hs = uniform(terms.size).setGroup(renderGroup);
  const out = Fn(() => {
    const st = uv();
    const q = floor(st.mul(hs.xy));
    // The four scene pixels under the texel, the nearest solid among them taken (its distance, its place on the screen).
    const nearD = float(FAR_KEPT * 2).toVar('swgHazeTD');
    const nearUv = vec2(st).toVar('swgHazeTU');
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= 1; i++) {
        const pf = clamp(q.mul(2).add(vec2(i, j)), vec2(0), hs.zw.sub(1));
        const d = float(depth.load(ivec2(pf)).x);
        const pst = pf.add(0.5).div(hs.zw);
        const dist = rayLength(viewZ(d, p0.x, p0.y, u.reversed), ndcOf(pst), p1);
        const solid = skyDepth(d, u.reversed).not();
        If(solid.and(dist.lessThan(nearD)), () => {
          nearD.assign(dist);
          nearUv.assign(pst);
        });
      }
    }
    const a = airTerms(tables, ndcOf(nearUv), min(nearD, FAR_KEPT), p1, turn, 'T');
    const any = nearD.lessThan(FAR_KEPT * 2);
    return TERMS_OUT(vec4(a.l, a.t), vec4(select(any, nearD, float(FAR_KEPT)), 0, 0, 1));
  })().toConst();
  // The two outputs as the edge smoothing's resolves write theirs (`taaGraphs.ts`): a struct, its members handed out.
  m.fragmentNode = outputStruct(out.get('terms'), out.get('distance'));
  return graph(m, 1, { uniforms: { p0, p1, turn, termsSize: hs }, textures: { depth } });
}

/**
 * The haze pass. Registered by the WebGPU chain's spine under our sky alone; it draws whenever the scene target carries the
 * see-through layer (which it always lays back), the plain composite while the air's tables are not there. The air's graph
 * is built where the warm-up asks for the pass's materials once the tables exist, never at a draw.
 */
export class GpuHazePass implements FxPass {
  readonly id: FxPassId = 'haze';
  readonly timerLabel = 'pass:haze';
  private readonly renderer: Any;
  private readonly inputs: HazeInputs | null;
  private readonly plain: ChainGraph | null;
  private air: ChainGraph | null = null;
  /**
   * The half-resolution mode (the Graphics page's Haze row, `hazeResolution` 0.5, the Low tier's): the terms' picture, a pixel
   * while the full mode draws (made and warmed all the same, so a change of mode builds nothing), and its two graphs.
   */
  private readonly terms: HazeTerms;
  private termsG: ChainGraph | null = null;
  private halfG: ChainGraph | null = null;
  private half = false;
  /** What drew last, for the console. */
  private drew: 'air' | 'half' | 'plain' | 'none' = 'none';

  constructor(renderer: Any, sceneTarget: THREE.RenderTarget, settings?: FxSettings) {
    this.half = (settings?.hazeResolution ?? 1) < 1;
    const t = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0, count: 2 });
    t.textures[0].name = 'fx.gpu.haze.terms';
    t.textures[1].name = 'fx.gpu.haze.termsDistance';
    t.textures[1].format = THREE.RedFormat;
    for (const x of t.textures) {
      x.minFilter = THREE.NearestFilter;
      x.magFilter = THREE.NearestFilter;
      x.generateMipmaps = false;
    }
    this.terms = { target: t, size: new THREE.Vector4(1.5, 1.5, 1.5, 1.5) };
    this.renderer = renderer;
    const see = seeTextureOf(sceneTarget.texture);
    this.inputs = see
      ? {
          input: { value: null },
          depth: sceneTarget.depthTexture as THREE.Texture,
          see,
          reversed: renderer.reversedDepthBuffer === true,
          // Each field begun as a fraction (a field begun as a whole number boxes every fraction written into it after).
          p0: new THREE.Vector4(0.05, 9000.5, 0.5, 0.5),
          p1: new THREE.Vector4(0.5, 0.5, 1.5, 1.5),
          // Begun with fractions, as a turning camera's always are (its elements an array of doubles from the start).
          turn: new THREE.Matrix3().set(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5),
        }
      : null;
    this.plain = this.inputs ? hazeGraph(this.inputs, false) : null;
    LIVE_PASSES.push(this);
  }

  /** The air's graphs, once the air's tables exist: made where the warm-up asks for the materials (behind a screen). */
  private airGraph(): ChainGraph | null {
    if (this.air === null && this.inputs !== null && AIR.tables !== null) {
      this.air = hazeGraph(this.inputs, true);
      this.termsG = hazeTermsGraph(this.inputs, this.terms);
      this.halfG = hazeGraph(this.inputs, true, this.terms);
    }
    return this.air;
  }

  enabled(_ctx: FxFrameContext): boolean {
    return this.inputs !== null;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_NEEDS;
  }

  reason(_ctx: FxFrameContext): string | null {
    return this.inputs === null ? 'the scene target carries no see-through layer (the motion output off at load): every material hazes itself' : null;
  }

  prepare(ctx: FxFrameContext): void {
    const u = this.inputs;
    if (!u) return;
    u.p0.x = ctx.near;
    u.p0.y = ctx.far;
    u.p0.z = ctx.inside ? 1 : 0;
    u.p0.w = AIR.frame.on && AIR.tables !== null && AIR.tables.ready && !ctx.space ? 1 : 0;
    u.p1.x = ctx.tanHalfFov.x;
    u.p1.y = ctx.tanHalfFov.y;
    // The camera's turn, its world matrix's upper rows and columns (both column by column), element by element: three's
    // `setFromMatrix4` hands nine numbers to `set`, each made wherever the compiler leaves the call out.
    const t = u.turn.elements;
    const m = ctx.camera.matrixWorld.elements;
    t[0] = m[0];
    t[1] = m[1];
    t[2] = m[2];
    t[3] = m[4];
    t[4] = m[5];
    t[5] = m[6];
    t[6] = m[8];
    t[7] = m[9];
    t[8] = m[10];
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const u = this.inputs;
    if (!u || output === null) return false;
    const r = ctx.renderer as Any;
    if (u.p1.z !== input.width || u.p1.w !== input.height) {
      u.p1.z = input.width;
      u.p1.w = input.height;
    }
    u.input.value = input.texture;
    // The air's graph only once it is built (by the warm-up) and the air draws; else the layer laid back alone.
    const air = this.air !== null && u.p0.w > 0.5;
    if (air && this.half && this.termsG !== null && this.halfG !== null) {
      // The half mode: the terms drawn at half size first (its size written only where the scene's moved), then laid on.
      const s = this.terms.size;
      if (s.z !== input.width || s.w !== input.height) this.sizeTerms(input.width, input.height);
      r.setRenderTarget(this.terms.target);
      r.render(this.termsG.mesh, FX_CAMERA);
      r.setRenderTarget(output);
      r.render(this.halfG.mesh, FX_CAMERA);
      this.drew = 'half';
      HAZE_STATS.drawn++;
      return true;
    }
    const g = air ? this.air! : this.plain!;
    r.setRenderTarget(output);
    r.render(g.mesh, FX_CAMERA);
    this.drew = air ? 'air' : 'plain';
    if (air) HAZE_STATS.drawn++;
    else HAZE_STATS.plain++;
    return true;
  }

  /** The terms' picture sized for a scene of `w` by `h` (half each way, rounded up) under the half mode, else a pixel. */
  private sizeTerms(w: number, h: number): void {
    const s = this.terms.size;
    const tw = this.half ? Math.max(1, Math.ceil(w / 2)) : 1;
    const th = this.half ? Math.max(1, Math.ceil(h / 2)) : 1;
    if (this.terms.target.width !== tw || this.terms.target.height !== th) this.terms.target.setSize(tw, th);
    s.x = tw;
    s.y = th;
    s.z = w;
    s.w = h;
  }

  setSize(width: number, height: number, settings: FxSettings): void {
    this.half = (settings.hazeResolution ?? 1) < 1;
    this.sizeTerms(width, height);
  }

  materials(): FxWarmItem[] {
    const out: FxWarmItem[] = [];
    if (this.plain) out.push({ material: this.plain.material, object: this.plain.mesh, where: 'target' });
    const a = this.airGraph();
    if (a) out.push({ material: a.material, object: a.mesh, where: 'target' });
    // Both modes warmed whichever draws, so a change of mode builds nothing: the terms against their own picture (WebGPU keys
    // a pipeline on its target's outputs' formats), the half mode's lay-on against a chain buffer as the full mode's.
    if (this.termsG) out.push({ material: this.termsG.material, object: this.termsG.mesh, where: 'target', into: this.terms.target });
    if (this.halfG) out.push({ material: this.halfG.material, object: this.halfG.mesh, where: 'target' });
    return out;
  }

  /** What `__debug.sky()` says of it. */
  report(): Record<string, unknown> {
    return { layer: this.inputs !== null, airGraph: this.air !== null, resolution: this.half ? 'half (the terms at half size, laid on a pixel by the nearest of four)' : 'full', terms: [this.terms.target.width, this.terms.target.height], drewLast: this.drew, ...HAZE_STATS };
  }

  dispose(): void {
    this.plain?.material.dispose();
    this.air?.material.dispose();
    this.termsG?.material.dispose();
    this.halfG?.material.dispose();
    this.terms.target.dispose();
    const at = LIVE_PASSES.indexOf(this);
    if (at >= 0) LIVE_PASSES.splice(at, 1);
  }
}

const NO_NEEDS: readonly FxProductId[] = [];

// ---------------------------------------------------------------- the scene's one fog node

/**
 * The scene's fog node under our sky (`scene.fogNode`, three reads it before the scene's own fog): worked out per build from
 * the classic material three keys the draw on and the target it draws into. Three hands a material's colour to the fog as
 * `output` and takes the node's answer as the colour (`NodeMaterial.setupFog`), before its premultiplied alpha.
 */
class HazeFogNode extends Node {
  static get type(): string {
    return 'SwgHazeFogNode';
  }
  constructor() {
    super('vec4');
  }
  setup(builder: Any): Any {
    const k = seeKindOf(builder.material);
    const o = vec4(output);
    // A solid drawn into a scene target that carries the layer: the pass hazes it.
    if (k === 'solid' && buildsLayer(builder)) {
      HAZE_STATS.fogBuilt.none++;
      return o;
    }
    const tables = AIR.tables;
    if (!tables) {
      HAZE_STATS.fogBuilt.none++;
      return o;
    }
    if (k === 'solid') HAZE_STATS.fogBuilt.solid++;
    else HAZE_STATS.fogBuilt.seeThrough++;
    // Its own place: the view place made a place on the screen by the camera's projection, and its distance.
    const clip = cameraProjectionMatrix.mul(vec4(positionView, 1));
    const ndc = clip.xy.div(max(clip.w, 1e-6));
    const dist = length(positionView);
    const h = vec4(tables.hazeAt(ndc, min(dist, HAZE_REACH_M)));
    // No haze where the air does not draw, or where its value is not a number (the pass's own rule).
    const on = hazeOn().greaterThan(0.5).and(finite4(h));
    const t = select(on, h.a, float(1));
    const l = select(on, h.rgb, vec3(0));
    if (k === 'add' || k === 'addPremultiplied') return vec4(o.rgb.mul(t), o.a);
    if (k === 'keep') return vec4(vec3(1).sub(vec3(1).sub(o.rgb).mul(t)), o.a);
    return vec4(o.rgb.mul(t).add(l), o.a);
  }
}

/**
 * A see-through program of its own hazed at its own distance (the client's particles, `gpuPrograms.ts`, whose fog is their
 * own and not three's): its colour `rgb` (vec3 node) and `additive` (a float node, 1 for a glow) into the hazed colour, a glow
 * keeping what gets through (`rgb · T`) and a smoke gaining the air in front too (`rgb · T + L`). Null under SWG's sky or
 * before the air's tables exist, where the program keeps its own fog.
 */
export function hazeOwnNode(rgb: Any, additive: Any): Any | null {
  const tables = AIR.tables;
  if (!skyOurs() || !tables) return null;
  const clip = cameraProjectionMatrix.mul(vec4(positionView, 1));
  const ndc = clip.xy.div(max(clip.w, 1e-6));
  const h = vec4(tables.hazeAt(ndc, min(length(positionView), HAZE_REACH_M)));
  const on = hazeOn().greaterThan(0.5).and(finite4(h));
  const t = select(on, h.a, float(1));
  const l = select(on, h.rgb, vec3(0));
  return rgb.mul(t).add(l.mul(float(1).sub(additive)));
}

/** 1 while the air draws this frame (`AIR.frame.on` and its tables drawn), read once a render in the shared group. */
let HAZE_ON: Any = null;
function hazeOn(): Any {
  if (!HAZE_ON) HAZE_ON = uniform(0).setGroup(renderGroup).onRenderUpdate(() => (AIR.frame.on && AIR.tables !== null && AIR.tables.ready ? 1 : 0));
  return HAZE_ON;
}

/** A fog node of no haze: the colour as it comes (the rooms' pass draws through it, `PassScenes.rooms`). */
class NoHazeNode extends Node {
  static get type(): string {
    return 'SwgNoHazeNode';
  }
  constructor() {
    super('vec4');
  }
  setup(): Any {
    return vec4(output);
  }
}

let FOG: Any = null;
let ROOMS: Any = null;

/** The world scene's fog node under our sky: one for the session. */
export function hazeFogNode(): Any {
  if (!FOG) FOG = new HazeFogNode();
  return FOG;
}

/** The rooms' pass's fog node under our sky: one for the session. */
export function roomsFogNode(): Any {
  if (!ROOMS) ROOMS = new NoHazeNode();
  return ROOMS;
}

/** What `__debug.sky()` says of the haze. */
export function hazeReport(): Record<string, unknown> {
  // Under SWG's sky the pass is never registered (`gpuChainPasses.ts`), whatever the Effects setting says (the review: the
  // report blamed the setting there), and the materials fog through the planet's own FogExp2.
  if (!skyOurs()) return { pass: "SWG's sky: no haze pass; every material fogs through the planet's own FogExp2", fog: { ...HAZE_STATS.fogBuilt } };
  const p = hazePassNow();
  return { pass: p ? p.report() : 'no chain: the Effects setting is off (every material hazes itself through the scene fog node)', fog: { ...HAZE_STATS.fogBuilt } };
}
