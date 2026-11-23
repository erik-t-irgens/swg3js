// The eye on the card (the GPU port's pass 2, wave 2; the design's 2.8, "built from the method of his demo"): a pass of the
// effects chain before the bloom that measures the scene and eases the exposure, all on the card, nothing read back.
//
//   1. **the quarter copy**: the chain's picture (after the edge smoothing, before the bloom, whose levels see only the
//      highlights) drawn at a quarter of its size each way as each texel's log2 luminance, four bilinear taps covering the
//      four by four pixels under it, into a half-float red target: what the eye needs kept as a log, so a moonlit night's
//      1e-6 is no nearer the half float's underflow there than noon's 1;
//   2. **the count**: a compute pass, one invocation a texel, adds its weight (`weightAt`: more toward the middle) to its
//      bin of `EYE_FIXED.bins` in an atomic histogram;
//   3. **the eye**: a compute pass of one invocation walks the bins (`eyeMath.ts`'s `eyeFrame`, line for line): the mean
//      between the 40th and the top percentile (maker L's `EYE_LIGHTS.top`, 0.96), his demo's curve (the mean held to the
//      darkest and brightest scenes adapted to, a share of each stop under the knee, the stops to the key), the ease by the
//      frame's time at the demo's rates, and writes the eye's buffer (`eyeBuffer.ts`), keeping the count it read for the
//      console's check and emptying it.
//
// The pass draws only while the main thread says the card adapts (`EYE_FRAME.adapting`: our sky, a world whose air draws, a
// chain whose eye pass is wanted and ready, the Eye adaptation row on); otherwise the buffer holds the main thread's answer
// (`eyeRun.ts`). A third compute of the same kit (the wave's fixer) rolls the scene's pre-exposure once a drawn frame before
// the scene (`eyeBegin`, `preExpose.ts`). Its four pipelines (the copy's against its own target, the three computes) are built
// when the chain is made, behind the loading screen or the Effects switch's notice, and the computes are dispatched only once
// they have landed (a compute drawn before its pipeline lands throws in the frame: wave 1's lesson). Nothing here is loaded
// on the WebGL path.
import * as THREE from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { FX_CAMERA, type FxPass, type FxWarmItem } from '../../core/fx/pass.ts';
import type { FxFrameContext } from '../../core/fx/context.ts';
import type { FxPassId, FxProductId, FxSettings } from '../../core/fxRegistry.ts';
import { LUMA } from '../../core/fx/gradeMath.ts';
import { chainMaterial, graph, tex, type ChainGraph } from '../../core/gpu/gpuChain.ts';
import { EYE_DEMO, EYE_FIXED, EYE_FRAME, EYE_SLOT, EYE_STATE, EYE_TUNE, binCentreLog, eyeFrame, targetStops, tuneEye } from './eyeMath.ts';
import { EYE_LIGHTS } from '../eyeLights.ts';
import { EYE_ATTR, EYE_BUFFER_FLOATS, EYE_GLOW_STATS, EYE_SLOT_MORE, readEyeBuffer, writeEyeCpu } from './eyeBuffer.ts';
import { EYE_IN, EYE_OUT, eyeFrameRun, eyeRange } from './eyeRun.ts';
import { PRE_ATTR, PRE_FIXED, PRE_SLOT, PRE_STATS, preNode } from './preExpose.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, If, Loop, atomicAdd, atomicLoad, atomicStore, clamp, dot, exp, exp2, float, floatBitsToUint, floor, instanceIndex, int, ivec2, log2, max, min, renderGroup, select, storage, uint, uniform, uv, vec2, vec3, vec4 } = TSL as Any;

const NO_NEEDS: readonly FxProductId[] = [];

/** The count, and the kept count the console reads back (its last place the frame it was kept at). */
const BINS = EYE_FIXED.bins;
const HIST_ATTR: Any = new StorageBufferAttribute(new Uint32Array(BINS), 1);
/**
 * The kept count with its frame in one buffer, so one read back is one frame: the bins, then the frame's count, then the frame's
 * own numbers as their float bits (`KEEP_AT`: the stops eased from, the seconds, the snap, the mean, the full make-up, the
 * target, the stops, the exposure, the glow).
 */
const KEEP_AT = { frames: BINS, prev: BINS + 1, dt: BINS + 2, snap: BINS + 3, mean: BINS + 4, full: BINS + 5, target: BINS + 6, stops: BINS + 7, exposure: BINS + 8, glow: BINS + 9 } as const;
const KEEP_ATTR: Any = new StorageBufferAttribute(new Uint32Array(BINS + 10), 1);

/**
 * A number of the eye's tables as a uniform of the shared render group, handed to three only when it moved (a number handed
 * back each render is a number made, step 6's lesson); the compute passes refresh every binding they have at each dispatch.
 */
function dial(read: () => number): Any {
  return uniform(read())
    .setGroup(renderGroup)
    .onRenderUpdate((_f: unknown, self: Any) => {
      const v = read();
      return self.value !== v ? v : undefined;
    });
}

/** The eye's passes, made once a session (the chain's passes are made again at an Effects switch; these are shared). */
interface EyeKit {
  /** The copy's size, in texels (the count's dispatch). */
  qw: Any;
  count: Any;
  adapt: Any;
  /** The fixer's: the scene's pre-exposure rolled once a drawn frame before the scene (`preExpose.ts`). */
  roll: Any;
  ready: boolean;
  asked: boolean;
}

let KIT: EyeKit | null = null;

/** The quarter copy's texture node, rebound to each chain's own target. */
const QUARTER = { value: null as THREE.Texture | null };

function kit(): EyeKit {
  if (KIT) return KIT;
  const F = EYE_FIXED;
  const hist = storage(HIST_ATTR, 'uint', BINS).toAtomic();
  const keep = storage(KEEP_ATTR, 'uint', BINS + 10);
  const eye = storage(EYE_ATTR, 'float', EYE_BUFFER_FLOATS);
  const qw = uniform(1, 'uint').setGroup(renderGroup);
  const qwF = uniform(1).setGroup(renderGroup);
  const qhF = uniform(1).setGroup(renderGroup);
  const quarter = tex(QUARTER);
  const centre = dial(() => EYE_TUNE.centre);
  const count = Fn(() => {
    const i = instanceIndex;
    const x = i.mod(qw);
    const y = i.div(qw);
    const l = float(quarter.load(ivec2(int(x), int(y))).r).toVar('eyeL');
    const t = clamp(l.sub(F.minLog).div(F.maxLog - F.minLog), 0, 0.99999);
    const bin = uint(t.mul(BINS)).toVar('eyeBin');
    const px = float(x).add(0.5).div(qwF).mul(2).sub(1);
    const py = float(y).add(0.5).div(qhF).mul(2).sub(1);
    // The demo's centre weight: `mix(4, 16, exp(-1.5 d²))` at `centre` 3 (`weightAt`).
    const d2 = px.mul(px).add(py.mul(py));
    const w = float(F.unit).mul(float(1).add(centre.mul(exp(d2.mul(-F.fall)))));
    atomicAdd(hist.element(bin), uint(floor(w.add(0.5))));
  })().compute(1, [64]);
  const dtUs = dial(() => EYE_FRAME.dtUs);
  const snap = dial(() => EYE_FRAME.snap);
  const logKey = dial(() => Math.log2(EYE_TUNE.key));
  const low = dial(() => EYE_TUNE.low);
  const high = dial(() => EYE_TUNE.high);
  const knee = dial(() => EYE_TUNE.knee);
  const share = dial(() => EYE_TUNE.share);
  const intoLight = dial(() => EYE_TUNE.intoLight);
  const intoDark = dial(() => EYE_TUNE.intoDark);
  const glow = dial(() => EYE_TUNE.glow);
  // Maker L's dial (`src/sky/eyeLights.ts`): the percentile the mean is taken up to, never under the bottom one.
  const top = dial(() => EYE_LIGHTS.top);
  const stepLog = (F.maxLog - F.minLog) / BINS;
  const adapt = Fn(() => {
    const total = float(0).toVar('eyeTotal');
    Loop(BINS, ({ i }: Any) => {
      total.addAssign(float(atomicLoad(hist.element(i))));
    });
    const lo = total.mul(F.bottom).toVar('eyeLo');
    const hi = total.mul(max(top, F.bottom)).toVar('eyeHi');
    const cum = float(0).toVar('eyeCum');
    const sum = float(0).toVar('eyeSum');
    const w = float(0).toVar('eyeW');
    Loop(BINS, ({ i }: Any) => {
      const hu = atomicLoad(hist.element(i)).toVar('eyeHu');
      const h = float(hu).toVar('eyeH');
      const a = clamp(cum, lo, hi);
      const c = cum.add(h).toVar('eyeC');
      const b = clamp(c, lo, hi);
      const part = b.sub(a).toVar('eyePart');
      sum.addAssign(part.mul(float(i).add(0.5).mul(stepLog).add(F.minLog)));
      w.addAssign(part);
      cum.assign(c);
      keep.element(i).assign(hu);
      atomicStore(hist.element(i), uint(0));
    });
    const mean = float(eye.element(EYE_SLOT.mean)).toVar('eyeMean');
    If(w.greaterThan(0), () => {
      mean.assign(sum.div(w));
    });
    const m = logKey.sub(mean).toVar('eyeFull');
    // His demo's curve (`kneeInto`): the mean held to [low, high], below the knee a share of each further stop, to the key.
    const c = clamp(mean, low, high).toVar('eyeHeld');
    const p = max(c, knee).add(share.mul(min(c.sub(knee), 0))).toVar('eyePerceived');
    const s = clamp(logKey.sub(p), F.least, F.most).toVar('eyeTarget');
    const prev = float(eye.element(EYE_SLOT.stops)).toVar('eyePrev');
    const dt = float(dtUs).mul(1e-6).toVar('eyeDt');
    const rate = select(s.lessThan(prev), intoLight, intoDark);
    const k = float(1).sub(exp(dt.mul(rate).negate()));
    const eased = select(snap.greaterThan(0.5), s, prev.add(s.sub(prev).mul(k))).toVar('eyeEased');
    eye.element(EYE_SLOT_MORE.prev).assign(prev);
    eye.element(EYE_SLOT_MORE.dt).assign(dt);
    eye.element(EYE_SLOT_MORE.snap).assign(snap);
    eye.element(EYE_SLOT.stops).assign(eased);
    eye.element(EYE_SLOT.target).assign(s);
    eye.element(EYE_SLOT.mean).assign(mean);
    eye.element(EYE_SLOT.full).assign(m);
    eye.element(EYE_SLOT.weight).assign(total);
    const frames = float(eye.element(EYE_SLOT.frames)).add(1).toVar('eyeFrames');
    eye.element(EYE_SLOT.frames).assign(frames);
    const ex = exp2(eased).toVar('eyeEx');
    const gl = exp2(glow.negate().mul(eased)).toVar('eyeGl');
    eye.element(EYE_SLOT.exposure).assign(ex);
    eye.element(EYE_SLOT.glow).assign(gl);
    // The frame kept beside its count for the console's check (one read back, one frame).
    keep.element(KEEP_AT.frames).assign(uint(frames));
    keep.element(KEEP_AT.prev).assign(floatBitsToUint(prev));
    keep.element(KEEP_AT.dt).assign(floatBitsToUint(dt));
    keep.element(KEEP_AT.snap).assign(floatBitsToUint(float(snap)));
    keep.element(KEEP_AT.mean).assign(floatBitsToUint(mean));
    keep.element(KEEP_AT.full).assign(floatBitsToUint(m));
    keep.element(KEEP_AT.target).assign(floatBitsToUint(s));
    keep.element(KEEP_AT.stops).assign(floatBitsToUint(eased));
    keep.element(KEEP_AT.exposure).assign(floatBitsToUint(ex));
    keep.element(KEEP_AT.glow).assign(floatBitsToUint(gl));
  })().compute(1, [1]);
  // The fixer's: the pre-exposure the scene is stored at this frame (`preExpose.ts`): last frame's moved into its own place and
  // the eye's exposure (the card's own, or the main thread's where the card does not adapt) taken, held to the eye's range.
  const pre = storage(PRE_ATTR, 'float', 2);
  const roll = Fn(() => {
    pre.element(PRE_SLOT.last).assign(pre.element(PRE_SLOT.now));
    pre.element(PRE_SLOT.now).assign(clamp(float(eye.element(EYE_SLOT.exposure)), PRE_FIXED.least, PRE_FIXED.most));
  })().compute(1, [1]);
  KIT = { qw: { node: qw, wf: qwF, hf: qhF }, count, adapt, roll, ready: false, asked: false };
  return KIT;
}

/** The two computes' pipelines asked for once (behind the screen that makes the first chain); dispatched only once landed. */
function warmKit(renderer: Any): void {
  const k = kit();
  if (k.asked) return;
  k.asked = true;
  if (typeof renderer.compileComputeAsync !== 'function') {
    k.ready = true;
    return;
  }
  Promise.all([renderer.compileComputeAsync(k.count), renderer.compileComputeAsync(k.adapt), renderer.compileComputeAsync(k.roll)])
    .then(() => {
      k.ready = true;
    })
    .catch(() => {
      // Left unready: the buffer keeps the main thread's answer and the console says why.
      EYE_GPU_STATS.why = 'the eye\'s compute pipelines failed to build';
    });
}

/** What the console reads of the card's side. */
export const EYE_GPU_STATS = { drawn: 0, skipped: 0, why: '', size: [1, 1] as [number, number] };

/**
 * The copy's graph: four bilinear taps over the four by four pixels under each texel, their mean's log2 luminance in the
 * scene's own units (the fixer's: the picture is stored times `pre`, `preExpose.ts`, so its mean is taken back over it).
 */
function copyGraph(input: { value: THREE.Texture | null }, inv: THREE.Vector2): ChainGraph {
  const m = chainMaterial('fx.gpu.eye.copy');
  const picture = tex(input);
  const step = uniform(inv).setGroup(renderGroup);
  const L = vec3(LUMA[0], LUMA[1], LUMA[2]);
  m.fragmentNode = Fn(() => {
    const at = uv();
    // Every sample at the top (a sample read under a branch is taken where the quad's lanes part: step 5's lesson).
    const a = vec3(picture.sample(at.add(step.mul(vec2(-1, -1)))).rgb).toVar('eyeA');
    const b = vec3(picture.sample(at.add(step.mul(vec2(1, -1)))).rgb).toVar('eyeB');
    const c = vec3(picture.sample(at.add(step.mul(vec2(-1, 1)))).rgb).toVar('eyeC4');
    const d = vec3(picture.sample(at.add(step.mul(vec2(1, 1)))).rgb).toVar('eyeD');
    const l = dot(a.add(b).add(c).add(d).mul(0.25), L).div(max(preNode(), PRE_FIXED.least));
    return vec4(log2(max(l, Math.pow(2, -30))), 0, 0, 1);
  })();
  return graph(m, 1, { uniforms: { step }, textures: { tInput: picture } });
}

/** The live passes (one a chain), the newest last: the console's. */
const LIVE: GpuEyePass[] = [];

/** The chain's eye pass (the registry's `exposure`, before the bloom), on WebGPU alone. */
export class GpuEyePass implements FxPass {
  readonly id: FxPassId = 'exposure';
  readonly timerLabel = 'pass:exposure';
  private readonly renderer: Any;
  private readonly input = { value: null as THREE.Texture | null };
  /** One input texel's size (its uv step), written in place when the size moves. */
  private readonly inv = new THREE.Vector2(0.5, 0.5);
  private readonly quarter: THREE.RenderTarget;
  private readonly copy: ChainGraph;
  private w = 1;
  private h = 1;

  constructor(renderer: Any) {
    this.renderer = renderer;
    const t = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, stencilBuffer: false, samples: 0 });
    t.texture.name = 'fx.gpu.eye.quarter';
    t.texture.minFilter = THREE.NearestFilter;
    t.texture.magFilter = THREE.NearestFilter;
    t.texture.generateMipmaps = false;
    this.quarter = t;
    QUARTER.value = t.texture;
    this.copy = copyGraph(this.input, this.inv);
    kit();
    warmKit(renderer);
    LIVE.push(this);
  }

  enabled(_ctx: FxFrameContext): boolean {
    return true;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_NEEDS;
  }

  prepare(_ctx: FxFrameContext): void {}

  /** Measures and eases; writes nothing into the chain (the picture goes on as it came). */
  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, _output: THREE.WebGLRenderTarget | null): boolean {
    const k = KIT;
    if (!k || !k.ready || EYE_FRAME.adapting !== 1) {
      EYE_GPU_STATS.skipped++;
      return false;
    }
    const r = ctx.renderer as Any;
    if (input.width !== this.w || input.height !== this.h) this.size(input.width, input.height);
    this.input.value = input.texture;
    QUARTER.value = this.quarter.texture;
    r.setRenderTarget(this.quarter);
    r.render(this.copy.mesh, FX_CAMERA);
    r.compute(k.count);
    r.compute(k.adapt);
    EYE_GPU_STATS.drawn++;
    return false;
  }

  /** The copy sized for a picture of `w` by `h` (a quarter each way, rounded up), the count's dispatch with it. */
  private size(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.inv.x = 1 / (w > 0 ? w : 1);
    this.inv.y = 1 / (h > 0 ? h : 1);
    const qw = Math.max(1, Math.ceil(w / 4));
    const qh = Math.max(1, Math.ceil(h / 4));
    if (this.quarter.width !== qw || this.quarter.height !== qh) this.quarter.setSize(qw, qh);
    const k = kit();
    k.qw.node.value = qw;
    k.qw.wf.value = qw;
    k.qw.hf.value = qh;
    k.count.count = qw * qh;
    EYE_GPU_STATS.size = [qw, qh];
  }

  setSize(width: number, height: number, _settings: FxSettings): void {
    this.size(width, height);
  }

  materials(): FxWarmItem[] {
    return [{ material: this.copy.material, object: this.copy.mesh, where: 'target', into: this.quarter }];
  }

  dispose(): void {
    this.copy.material.dispose();
    this.quarter.dispose();
    const i = LIVE.indexOf(this);
    if (i >= 0) LIVE.splice(i, 1);
    if (QUARTER.value === this.quarter.texture) QUARTER.value = LIVE.length ? LIVE[LIVE.length - 1].quarter.texture : null;
  }
}

/**
 * The eye's frame on the WebGPU side, once a game frame before anything is drawn: the main thread's part (`eyeFrameRun`, from
 * `EYE_IN`), its answer written into the buffer where the card does not adapt, and three's exposure. Allocates nothing.
 */
export function eyeFrameGpu(renderer: Any): void {
  eyeFrameRun();
  const o = EYE_OUT;
  if (o.write) writeEyeCpu();
  if (renderer.toneMappingExposure !== o.renderer) renderer.toneMappingExposure = o.renderer;
}

/**
 * The fixer's: whether the eye's computes have landed, so the pass will draw where it is wanted (the main thread's mode reads
 * it: a pass that cannot draw leaves the buffer to the main thread, never frozen).
 */
export function eyeReady(): boolean {
  return KIT !== null && KIT.ready;
}

/** Counts for the console: the rolls dispatched; and the prover's switch (`__debug.exposure({ pre: false })`). */
export const PRE_ROLLS = { n: 0, on: true };

/**
 * The prover's switch, live: off stands the buffer at `[1, 1]` (written once from the main thread) and stops the roll, so the
 * scene is stored as it was before the wave's fixer, everything else alike (an A/B on one screen); on again rolls from the
 * next drawn frame (its first roll brings the edge smoothing's history from 1 to the eye's exposure, as any roll does).
 */
export function preSwitch(on: boolean): void {
  if (PRE_ROLLS.on === on) return;
  PRE_ROLLS.on = on;
  if (!on) {
    const a = PRE_ATTR.array as Float32Array;
    a[PRE_SLOT.now] = 1;
    a[PRE_SLOT.last] = 1;
    PRE_ATTR.needsUpdate = true;
  }
}

/**
 * The fixer's: once a drawn frame with a chain, before the scene (`main.ts`'s draw, just before `PostFX.begin`): the scene's
 * pre-exposure rolled on the card (`preExpose.ts`), only once the computes have landed (until then the buffer stands at
 * `[1, 1]`: the scene stored as it always was). Allocates nothing of ours.
 */
export function eyeBegin(renderer: Any): void {
  const k = KIT;
  if (!k || !k.ready || !PRE_ROLLS.on) return;
  renderer.compute(k.roll);
  PRE_ROLLS.n++;
}

/** What `__debug.exposure()` says: the measured scene, the eased exposure, the target, the knee's effect, the dials; read back from the card (asked, never in a frame). */
export async function eyeReport(renderer: Any, check: boolean): Promise<Record<string, unknown>> {
  const n4 = (v: number) => Number(v.toFixed(4));
  const modeWord = ['today\'s (WebGL, SWG\'s sky, space or a world with no air: an exposure of 1)', 'following the sun\'s height (the Eye adaptation row off, or the Effects off)', 'adapting on the card'][EYE_OUT.mode];
  const base: Record<string, unknown> = {
    mode: modeWord,
    compensationStops: EYE_IN.stops,
    rendererExposure: n4(EYE_OUT.renderer),
    count: { range: eyeRange(), percentiles: [EYE_FIXED.bottom, EYE_LIGHTS.top], quarter: EYE_GPU_STATS.size },
    tune: { ...EYE_TUNE },
    lights: { ...EYE_LIGHTS },
    units: `his demo's sun ${EYE_DEMO.demo} at the top of the air against ours ${EYE_DEMO.ours}: its log2 luminances moved by ${EYE_DEMO.shift.toFixed(4)} stops (its clamp -14 to 4 is ${(-14 + EYE_DEMO.shift).toFixed(2)} to ${(4 + EYE_DEMO.shift).toFixed(2)} here, its knee -2 is ${(-2 + EYE_DEMO.shift).toFixed(2)})`,
    glowParts: { ...EYE_GLOW_STATS },
    passes: { drawn: EYE_GPU_STATS.drawn, skipped: EYE_GPU_STATS.skipped, ready: KIT?.ready ?? false, ...(EYE_GPU_STATS.why ? { why: EYE_GPU_STATS.why } : {}) },
    preExposure: { installed: PRE_STATS.installed, on: PRE_ROLLS.on, graphsTaken: PRE_STATS.graphs, graphsLeft: PRE_STATS.left, rolls: PRE_ROLLS.n, ...(PRE_STATS.why ? { why: PRE_STATS.why } : {}), does: `the scene stored times last frame's eye exposure (pre), held to ${PRE_FIXED.cap}, every reader of the scene's units dividing it back out` },
  };
  if (typeof renderer.getArrayBufferAsync !== 'function') return { ...base, card: 'this build of three cannot read a storage buffer back' };
  const pre = new Float32Array(((await renderer.getArrayBufferAsync(PRE_ATTR)) as ArrayBuffer).slice(0));
  (base.preExposure as Record<string, unknown>).pre = Number(pre[PRE_SLOT.now].toPrecision(5));
  (base.preExposure as Record<string, unknown>).preLast = Number(pre[PRE_SLOT.last].toPrecision(5));
  const b = await readEyeBuffer(renderer);
  const card = {
    sceneMeanLog2: n4(b[EYE_SLOT.mean]),
    sceneLuminance: Number(Math.pow(2, b[EYE_SLOT.mean]).toPrecision(4)),
    fullMakeUpStops: n4(b[EYE_SLOT.full]),
    targetStops: n4(b[EYE_SLOT.target]),
    kneeTakesStops: n4(b[EYE_SLOT.full] - b[EYE_SLOT.target]),
    easedStops: n4(b[EYE_SLOT.stops]),
    exposure: Number(b[EYE_SLOT.exposure].toPrecision(5)),
    glow: Number(b[EYE_SLOT.glow].toPrecision(5)),
    weightCounted: b[EYE_SLOT.weight],
    frames: b[EYE_SLOT.frames],
    lastDt: n4(b[EYE_SLOT_MORE.dt]),
  };
  const out: Record<string, unknown> = { ...base, card, curve: `a scene at log2 ${card.sceneMeanLog2} wants ${card.fullMakeUpStops} stops to the key; the curve at the dials now makes up ${n4(targetStops(b[EYE_SLOT.mean]))}` };
  if (check) out.check = await eyeCheck(renderer);
  return out;
}

/**
 * The card's eye held to `eyeMath.ts`: the count it kept and the buffer it wrote read back from one frame (by the frame count
 * kept with the count), the JavaScript frame worked over that count from the same starting stops, time and snap, and each
 * number set beside the card's. Asked from the console; it waits on the card.
 */
async function eyeCheck(renderer: Any): Promise<Record<string, unknown>> {
  const raw = (await renderer.getArrayBufferAsync(KEEP_ATTR)) as ArrayBuffer;
  const u = new Uint32Array(raw.slice(0));
  const f = new Float32Array(u.buffer);
  const js = new Float64Array(EYE_BUFFER_FLOATS);
  // The mean a frame with nothing counted keeps is the one before it: the card's own frame's, handed in as its start.
  js[EYE_SLOT.mean] = f[KEEP_AT.mean];
  eyeFrame(u.subarray(0, BINS), f[KEEP_AT.prev], f[KEEP_AT.dt], f[KEEP_AT.snap] > 0.5, js);
  const card = { mean: f[KEEP_AT.mean], full: f[KEEP_AT.full], target: f[KEEP_AT.target], stops: f[KEEP_AT.stops], exposure: f[KEEP_AT.exposure], glow: f[KEEP_AT.glow] };
  const worst = Math.max(Math.abs(js[EYE_SLOT.mean] - card.mean), Math.abs(js[EYE_SLOT.full] - card.full), Math.abs(js[EYE_SLOT.target] - card.target), Math.abs(js[EYE_SLOT.stops] - card.stops));
  const rel = Math.max(Math.abs(js[EYE_SLOT.exposure] / card.exposure - 1), Math.abs(js[EYE_SLOT.glow] / card.glow - 1));
  // The count's shape: the log2 luminance at a few shares of its weight, and the share in the lowest bin (black and the
  // half float's last subnormals).
  const hist = u.subarray(0, BINS);
  let total = 0;
  for (let i = 0; i < BINS; i++) total += hist[i];
  const at = (share: number): number => {
    let c = 0;
    for (let i = 0; i < BINS; i++) {
      c += hist[i];
      if (c >= share * total) return Number(binCentreLog(i).toFixed(2));
    }
    return EYE_FIXED.maxLog;
  };
  return {
    frame: u[KEEP_AT.frames],
    binsCounted: Array.from(hist).reduce((n, v) => n + (v > 0 ? 1 : 0), 0),
    shape: { log2At: { 5: at(0.05), 25: at(0.25), 40: at(0.4), 50: at(0.5), 75: at(0.75), 96: at(0.96), 99: at(0.99) }, lowestBinShare: total > 0 ? Number((hist[0] / total).toFixed(4)) : 0 },
    from: { prevStops: f[KEEP_AT.prev], dt: f[KEEP_AT.dt], snap: f[KEEP_AT.snap] },
    card,
    js: { mean: js[EYE_SLOT.mean], full: js[EYE_SLOT.full], target: js[EYE_SLOT.target], stops: js[EYE_SLOT.stops], exposure: js[EYE_SLOT.exposure], glow: js[EYE_SLOT.glow] },
    worstStops: worst,
    worstShare: rel,
    // The card works in 32-bit floats and the mirror in doubles: a thousandth of a stop is far under what the eye sees.
    ok: worst < 1e-3 && rel < 1e-3,
  };
}

/** The console's dials (`__debug.exposure({ tune })`): moved through `tuneEye`, read by the passes at their next dispatch. */
export function eyeTune(o: Record<string, unknown>): string[] {
  const said = tuneEye(o);
  void EYE_STATE.version;
  return said;
}
