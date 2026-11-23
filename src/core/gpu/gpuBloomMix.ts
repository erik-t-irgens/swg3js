// The bloom under our sky on WebGPU (the sky and light fix round, maker E): the owner's demo's own bloom (`Feature-requests/
// Clouds and atmosphere — WebGPU demo.html`, its BLOOM_DOWN_WGSL, BLOOM_UP_WGSL and TONEMAP_WGSL), which he has seen work, in
// place of three's thresholded, additive Unreal bloom, whose threshold let every sunlit wall and the sand bloom by day.
//
//   - **down**: the picture halved up to `MIX_BLOOM_FIXED.levels` times (each level half the one before, stopping at a side of
//     two), each texel thirteen taps of the level above (Jimenez's down filter: a texel's four quarters and the middle, weighed
//     an eighth, an eighth, an eighth, an eighth and a half); on the first level each of the five groups weighed again by
//     `1 / (1 + its exposed luminance)` (Karis's average, the demo's, so one hot pixel never flickers a whole level);
//   - **up**: from the smallest level back up, each level's 3 by 3 tent (4, 2, 1 over 16) added into the level above it;
//   - **the mix**: the first level's tent, over 16 times the number of levels (the levels' average), laid over the picture as
//     `mix(picture, bloom, strength)` (a blend of `strength` and one less it): energy kept, no threshold, so what spills is a
//     share of everything, the sun most. Before the exposure: the eye's output multiplies the whole after it (`gpuChain.ts`),
//     as the demo's `mix(hdr, bloom, strength) · exposure`.
//
// The units: the picture is stored times `pre` (`preExpose.ts`), the scene a frame behind the eye; the Karis weights take the
// luminance as the eye exposes it (`exposure / pre`), the demo's `luma(c) · exposure`. The strength is the Graphics page's
// Bloom strength on WebGPU under our sky (`bloomMix`, 0 to 0.12, 0.04 the demo's); SWG's sky on WebGPU keeps the old pass and
// its row (`gpuChainPasses.ts`), and WebGL its own.
//
// Pipelines: the first level's down, the other levels' down (one graph's code, one pipeline however many levels), the up (one)
// and the mix (one): four, each warmed against the very target it draws into behind the loading screen (`materials()`).
// Nothing is allocated in a frame: every vector is the pass's own, every number a uniform read once a render and handed back
// only when it moved. Nothing here is loaded on the WebGL path.
import * as THREE from 'three';
import * as TSL from 'three/tsl';
import type { FxFrameContext } from '../fx/context.ts';
import { FX_CAMERA, type FxPass, type FxWarmItem } from '../fx/pass.ts';
import type { FxPassId, FxProductId, FxSettings } from '../fxRegistry.ts';
import { chainMaterial, graph, storedOf, tex, type ChainGraph } from './gpuChain.ts';
import { eyeExposureNode } from '../../sky/exposure/eyeBuffer.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, dot, float, max, renderGroup, uniform, uv, vec2, vec3, vec4 } = TSL as Any;

/**
 * What is not a dial (the demo's own numbers, held to its text by `gpuBloomMix.test.ts`):
 *   - `levels` 6 and `smallest` 2: up to six half-size levels, stopping before a side would reach two texels;
 *   - `luma` the demo's luminance (Rec. 709);
 *   - `down`: the thirteen taps' places in the source's texels and the five groups' weights (Jimenez's: the four corner
 *     groups an eighth each, the middle group a half); the plain down's own weights for the middle tap, the corners, the
 *     edges and the inner four (an eighth, a thirty-second, a sixteenth, an eighth);
 *   - `tent`: the up's 3 by 3 weights (4 the middle, 2 the edges, 1 the corners) over 16.
 */
export const MIX_BLOOM_FIXED = {
  levels: 6,
  smallest: 2,
  luma: [0.2126, 0.7152, 0.0722] as const,
  down: { outer: 2, inner: 1, group: 0.125, middleGroup: 0.5, plainMiddle: 0.125, plainCorner: 0.03125, plainEdge: 0.0625, plainInner: 0.125 },
  tent: { middle: 4, edge: 2, corner: 1, sum: 16 },
} as const;

/** The level sizes for a picture of `w` by `h`: each half the last (`>> 1`), up to `levels`, while both sides stay over `smallest`. */
export function mixBloomSizes(w: number, h: number, out: [number, number][]): number {
  const F = MIX_BLOOM_FIXED;
  let bw = w;
  let bh = h;
  let n = 0;
  while (n < F.levels && bw > F.smallest && bh > F.smallest) {
    bw = Math.max(1, bw >> 1);
    bh = Math.max(1, bh >> 1);
    out[n][0] = bw;
    out[n][1] = bh;
    n++;
  }
  if (n === 0) {
    out[0][0] = 1;
    out[0][1] = 1;
    n = 1;
  }
  return n;
}

/** A number of the pass's kept record as a uniform of the shared render group, handed to three only when it moved. */
function kept(read: () => number): Any {
  return uniform(read())
    .setGroup(renderGroup)
    .onRenderUpdate((_f: unknown, self: Any) => {
      const v = read();
      return self.value !== v ? v : undefined;
    });
}

/** A level's half-float target, no depth and no stencil (the chain's buffers' kind, so the warm-up's pipelines are the draw's). */
function levelTarget(name: string): THREE.RenderTarget {
  const t = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0 });
  t.texture.name = name;
  t.texture.minFilter = THREE.LinearFilter;
  t.texture.magFilter = THREE.LinearFilter;
  t.texture.generateMipmaps = false;
  return t;
}

/**
 * One level's down: thirteen taps of the source around the texel (`texel` one source texel in uv), each sampled at the top
 * (a sample read under a branch is taken where the quad's lanes part: step 5's lesson). `karis`: the first level's, each of
 * the five groups weighed by `1 / (1 + luma · exposure)`, the exposure the eye's over the store's.
 */
export function downGraph(src: { value: THREE.Texture | null }, texel: THREE.Vector2, karis: boolean, name: string): ChainGraph {
  const m = chainMaterial(name);
  const picture = tex(src);
  const step = uniform(texel).setGroup(renderGroup);
  const D = MIX_BLOOM_FIXED.down;
  const L = MIX_BLOOM_FIXED.luma;
  const LUM = vec3(L[0], L[1], L[2]);
  m.fragmentNode = Fn(() => {
    const at = uv();
    const tap = (x: number, y: number, n: string): Any => vec3(picture.sample(at.add(step.mul(vec2(x, y)))).rgb).toVar(n);
    const o = D.outer;
    const i = D.inner;
    const a = tap(-o, -o, 'swgBmA');
    const b = tap(0, -o, 'swgBmB');
    const c = tap(o, -o, 'swgBmC');
    const d = tap(-o, 0, 'swgBmD');
    const e = tap(0, 0, 'swgBmE');
    const f = tap(o, 0, 'swgBmF');
    const g = tap(-o, o, 'swgBmG');
    const h = tap(0, o, 'swgBmH');
    const k = tap(o, o, 'swgBmI');
    const j = tap(-i, -i, 'swgBmJ');
    const kk = tap(i, -i, 'swgBmK');
    const l = tap(-i, i, 'swgBmL');
    const mm = tap(i, i, 'swgBmM');
    if (karis) {
      const ex = max(eyeExposureNode().div(storedOf()), 1e-4);
      const g0 = a.add(b).add(d).add(e).mul(0.25);
      const g1 = b.add(c).add(e).add(f).mul(0.25);
      const g2 = d.add(e).add(g).add(h).mul(0.25);
      const g3 = e.add(f).add(h).add(k).mul(0.25);
      const g4 = j.add(kk).add(l).add(mm).mul(0.25);
      const kw = (x: Any, share: number): Any => float(share).div(float(1).add(dot(x, LUM).mul(ex)));
      const w0 = kw(g0, D.group);
      const w1 = kw(g1, D.group);
      const w2 = kw(g2, D.group);
      const w3 = kw(g3, D.group);
      const w4 = kw(g4, D.middleGroup);
      const s = g0.mul(w0).add(g1.mul(w1)).add(g2.mul(w2)).add(g3.mul(w3)).add(g4.mul(w4)).div(w0.add(w1).add(w2).add(w3).add(w4));
      return vec4(max(s, vec3(0)), 1);
    }
    const s = e
      .mul(D.plainMiddle)
      .add(a.add(c).add(g).add(k).mul(D.plainCorner))
      .add(b.add(d).add(f).add(h).mul(D.plainEdge))
      .add(j.add(kk).add(l).add(mm).mul(D.plainInner));
    return vec4(max(s, vec3(0)), 1);
  })();
  return graph(m, 1, { uniforms: { step }, textures: { src: picture } });
}

/** The 3 by 3 tent of a level at `texel` (one of its texels in uv), the demo's `tap` sum before it is divided. */
function tentOf(picture: Any, step: Any): Any {
  const T = MIX_BLOOM_FIXED.tent;
  const at = uv();
  const t = (x: number, y: number, n: string): Any => vec3(picture.sample(at.add(step.mul(vec2(x, y)))).rgb).toVar(n);
  const c = t(0, 0, 'swgTc');
  const l = t(-1, 0, 'swgTl');
  const r = t(1, 0, 'swgTr');
  const d = t(0, -1, 'swgTd');
  const u = t(0, 1, 'swgTu');
  const dl = t(-1, -1, 'swgTdl');
  const dr = t(1, -1, 'swgTdr');
  const ul = t(-1, 1, 'swgTul');
  const ur = t(1, 1, 'swgTur');
  return c.mul(T.middle).add(l.add(r).add(d).add(u).mul(T.edge)).add(dl.add(dr).add(ul).add(ur).mul(T.corner));
}

/** One level's up: the smaller level's tent over 16, added into the level it is drawn over (one and one, its alpha kept). */
export function upGraph(src: { value: THREE.Texture | null }, texel: THREE.Vector2, name: string): ChainGraph {
  const m = chainMaterial(name);
  const picture = tex(src);
  const step = uniform(texel).setGroup(renderGroup);
  m.fragmentNode = Fn(() => vec4(tentOf(picture, step).div(MIX_BLOOM_FIXED.tent.sum), 1))();
  m.transparent = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquationAlpha = THREE.AddEquation;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.premultipliedAlpha = false;
  return graph(m, 1, { uniforms: { step }, textures: { src: picture } });
}

/**
 * The mix: the first level's tent over 16 times the number of levels (`inv`), with the strength as its alpha, blended over the
 * picture by the alpha and one less it (`mix(picture, bloom, strength)`), the picture's alpha kept.
 */
export function mixGraph(src: { value: THREE.Texture | null }, texel: THREE.Vector2, inv: Any, strength: Any, name: string): ChainGraph {
  const m = chainMaterial(name);
  const picture = tex(src);
  const step = uniform(texel).setGroup(renderGroup);
  m.fragmentNode = Fn(() => vec4(tentOf(picture, step).mul(inv), strength))();
  m.transparent = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendEquationAlpha = THREE.AddEquation;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.premultipliedAlpha = false;
  return graph(m, 1, { uniforms: { step, inv, strength }, textures: { src: picture } });
}

/** A graph drawn into a target. */
function draw(r: Any, g: ChainGraph, into: THREE.RenderTarget): void {
  r.setRenderTarget(into);
  r.render(g.mesh, FX_CAMERA);
}

const NO_NEEDS: readonly FxProductId[] = [];

/** The live passes (one a chain), the newest last: the console's. */
const LIVE: GpuMixBloomPass[] = [];

/** The chain's bloom under our sky on WebGPU (the registry's `bloom`), the demo's. */
export class GpuMixBloomPass implements FxPass {
  readonly id: FxPassId = 'bloom';
  readonly timerLabel = 'pass:bloom';
  /** The levels, largest first (all `levels` made; `n` of them drawn for the picture's size). */
  readonly levels: THREE.RenderTarget[] = [];
  private readonly sizes: [number, number][] = [];
  /** Each down's source texel, each up's (its smaller level's), the mix's (the first level's): kept vectors written in place. */
  private readonly downTexel: THREE.Vector2[] = [];
  private readonly upTexel: THREE.Vector2[] = [];
  private readonly mixTexel = new THREE.Vector2(1, 1);
  /** The pictures each graph reads (the first down's is the chain's input, set at each draw; the rest stand still). */
  private readonly input = { value: null as THREE.Texture | null };
  private readonly downs: ChainGraph[] = [];
  private readonly ups: ChainGraph[] = [];
  private readonly mix: ChainGraph;
  /** The frame's numbers the mix reads: the strength (the setting) and one over 16 times the levels drawn. */
  private readonly k = { strength: 0.04, inv: 1 / 96 };
  private n = 1;
  private w = 0;
  private h = 0;

  constructor(width: number, height: number, strength: number) {
    const F = MIX_BLOOM_FIXED;
    for (let i = 0; i < F.levels; i++) {
      this.levels.push(levelTarget(`fx.gpu.bloomMix.level${i}`));
      this.sizes.push([1, 1]);
      this.downTexel.push(new THREE.Vector2(1, 1));
      this.upTexel.push(new THREE.Vector2(1, 1));
    }
    for (let i = 0; i < F.levels; i++) {
      const src = i === 0 ? this.input : { value: this.levels[i - 1].texture as THREE.Texture | null };
      this.downs.push(downGraph(src, this.downTexel[i], i === 0, i === 0 ? 'fx.gpu.bloomMix.downKaris' : 'fx.gpu.bloomMix.down'));
    }
    for (let i = 0; i < F.levels - 1; i++) this.ups.push(upGraph({ value: this.levels[i + 1].texture }, this.upTexel[i], 'fx.gpu.bloomMix.up'));
    const k = this.k;
    this.mix = mixGraph({ value: this.levels[0].texture }, this.mixTexel, kept(() => k.inv), kept(() => k.strength), 'fx.gpu.bloomMix.mix');
    this.k.strength = strength;
    this.size(width, height);
    LIVE.push(this);
  }

  enabled(ctx: FxFrameContext): boolean {
    return ctx.settings.bloomMix > 0;
  }

  reason(ctx: FxFrameContext): string | null {
    return ctx.settings.bloomMix > 0 ? null : 'bloom strength is zero';
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_NEEDS;
  }

  prepare(ctx: FxFrameContext): void {
    const s = ctx.settings.bloomMix;
    if (this.k.strength !== s) this.k.strength = s;
  }

  /** The levels down, back up, and mixed over the picture where it stands (never the canvas: the bloom is never last). */
  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, _output: THREE.WebGLRenderTarget | null): boolean {
    const r = ctx.renderer as Any;
    if (input.width !== this.w || input.height !== this.h) this.size(input.width, input.height);
    this.input.value = input.texture;
    const n = this.n;
    for (let i = 0; i < n; i++) draw(r, this.downs[i], this.levels[i]);
    for (let i = n - 2; i >= 0; i--) draw(r, this.ups[i], this.levels[i]);
    draw(r, this.mix, input);
    return false;
  }

  /** The levels sized for a picture of `w` by `h`, and every texel with them (written in place). */
  private size(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const n = mixBloomSizes(Math.max(1, w), Math.max(1, h), this.sizes);
    this.n = n;
    this.k.inv = 1 / (MIX_BLOOM_FIXED.tent.sum * n);
    for (let i = 0; i < n; i++) {
      const [lw, lh] = this.sizes[i];
      const t = this.levels[i];
      if (t.width !== lw || t.height !== lh) t.setSize(lw, lh);
    }
    this.downTexel[0].set(1 / Math.max(1, w), 1 / Math.max(1, h));
    for (let i = 1; i < n; i++) this.downTexel[i].set(1 / this.sizes[i - 1][0], 1 / this.sizes[i - 1][1]);
    for (let i = 0; i < n - 1; i++) this.upTexel[i].set(1 / this.sizes[i + 1][0], 1 / this.sizes[i + 1][1]);
    this.mixTexel.set(1 / this.sizes[0][0], 1 / this.sizes[0][1]);
  }

  setSize(width: number, height: number, _settings: FxSettings): void {
    this.size(width, height);
  }

  /** Every graph against the very target it draws into: the downs and ups their levels, the mix a chain buffer. */
  materials(): FxWarmItem[] {
    const out: FxWarmItem[] = [];
    for (let i = 0; i < this.downs.length; i++) out.push({ material: this.downs[i].material, object: this.downs[i].mesh, where: 'target', into: this.levels[i] });
    for (let i = 0; i < this.ups.length; i++) out.push({ material: this.ups[i].material, object: this.ups[i].mesh, where: 'target', into: this.levels[i] });
    out.push({ material: this.mix.material, object: this.mix.mesh, where: 'target' });
    return out;
  }

  /** What the console says of it. */
  report(): Record<string, unknown> {
    return { levels: this.n, sizes: this.sizes.slice(0, this.n).map((s) => `${s[0]}x${s[1]}`), strength: this.k.strength, divisor: 1 / this.k.inv };
  }

  dispose(): void {
    for (const g of [...this.downs, ...this.ups, this.mix]) g.material.dispose();
    for (const t of this.levels) t.dispose();
    const i = LIVE.indexOf(this);
    if (i >= 0) LIVE.splice(i, 1);
  }
}

/** The newest live pass's words, or why there is none (the console's `__debug.postfx()` carries the chain's own). */
export function mixBloomReport(): Record<string, unknown> {
  const p = LIVE[LIVE.length - 1];
  return p ? p.report() : { why: "no chain drawing the demo's bloom (Effects off, SWG's sky, or WebGL)" };
}
