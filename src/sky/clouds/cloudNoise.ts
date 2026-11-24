// The clouds' noise on WebGPU (the GPU port's pass 3, wave 1, maker V; the design's 2.2): three pictures baked on compute
// from fixed seeds, behind the loading screen, and read by the shape function (`cloudShape.ts`) at a named level:
//
//   - **the shape volume**, 128 cubed, eight bits a channel (8 MiB): red a Perlin noise dilated by a Worley one (the low
//     frequency's billows), green, blue and alpha Worley noise summed over three octaves at 4, 8 and 16 cells a tile (the
//     cells the billows are made of, coarse to fine);
//   - **the detail volume**, 32 cubed: Worley noise summed over three octaves at 2, 4 and 8 cells a tile, which erodes the
//     edges;
//   - **the curl picture**, 128 square: the curl of a two-dimensional gradient noise, which turns the detail's samples about
//     so the edges curl as rising air curls them.
//
// Every picture tiles in every direction (each octave's lattice wraps at its own period), so the march reads them at any
// place with no seam. The method is the published one (Schneider's "Nubis" talks, 2015 and 2017: a Perlin-Worley low
// frequency and Worley octaves; Worley 1996; Perlin 2002's quintic fade), written here from those papers; nothing is lifted
// from any other program. Every cell's number is an integer hash (PCG, Jarzynski and Olano, JCGT 2020) of its whole-number
// place and a fixed seed, so every card bakes the same pictures to the last bit of the hash.
//
// Made once a session (the volumes are the session's), only when the clouds are on: with the switch off nothing here is
// made, so the frame is the base's. Behind a loading screen every slab is baked at once; switched on in play, the bake
// is spread over frames (`CLOUD_NOISE_SPEC.slabs` of the shape volume a frame), its pipelines compiled first off the frame,
// and the clouds draw only once it is whole. Nothing here is loaded on the WebGL path.

import * as THREE from 'three';
import { Storage3DTexture, StorageTexture } from 'three/webgpu';
import * as TSL from 'three/tsl';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, Loop, abs, clamp, dot, float, floor, instanceIndex, int, ivec2, ivec3, max, min, mix, renderGroup, sqrt, storageTexture3D, textureStore, uint, uniform, vec2, vec3, vec4 } = TSL as Any;

/** The pictures' sizes: texels along each side (not dials: the bake's memory and every reader's scale are made for them). */
export const CLOUD_NOISE_SIZES = { shape: 128, detail: 32, curl: 128 } as const;

/**
 * How the pictures are made (not dials: a picture changed is a new noise everywhere, and the shape's dials read them as
 * they stand). Frequencies are cells (Worley) or lattice periods (Perlin) across one tile, each a whole number so the
 * tile wraps. `fbm` is the three Worley octaves' shares (coarse to fine, summing to one). `seed` is the session's one
 * fixed seed; each octave and channel adds its own offset to it. `slabs`: the shape volume baked in this many slices
 * of its depth when it is baked in play (8 of 128 deep a frame, about an eighth of the whole bake's card time).
 */
export const CLOUD_NOISE_SPEC = {
  seed: 0x2f6b1c3d,
  shape: { perlinFreq: 4, perlinOctaves: 6, worley: [4, 8, 16] as readonly number[] },
  detail: { worley: [2, 4, 8] as readonly number[] },
  curl: { freq: 4, octaves: 3, scale: 0.35 },
  fbm: [0.625, 0.25, 0.125] as readonly number[],
  slabs: 16,
} as const;

/** What the noise has done, for `__debug.clouds()` and the tests. */
export const CLOUD_NOISE_STATS = { made: 0, compiled: 0, baked: 0, slabsBaked: 0, bakeMs: -1, bakeWhere: 'not yet' as 'not yet' | 'screen' | 'play' };

// ---------------------------------------------------------------- the hash and the two noises, in three's shading language

/**
 * PCG's three-wide step (Jarzynski and Olano 2020, "pcg3d"): three unsigned whole numbers in, three fractions in [0, 1) out.
 * Integer arithmetic alone (wrapping 32-bit), so every card answers the same bits.
 */
export function pcg3Node(ax: Any, ay: Any, az: Any): Any {
  const x0 = ax.mul(uint(1664525)).add(uint(1013904223));
  const y0 = ay.mul(uint(1664525)).add(uint(1013904223));
  const z0 = az.mul(uint(1664525)).add(uint(1013904223));
  const x1 = x0.add(y0.mul(z0));
  const y1 = y0.add(z0.mul(x1));
  const z1 = z0.add(x1.mul(y1));
  const x2 = x1.bitXor(x1.shiftRight(uint(16)));
  const y2 = y1.bitXor(y1.shiftRight(uint(16)));
  const z2 = z1.bitXor(z1.shiftRight(uint(16)));
  const x3 = x2.add(y2.mul(z2));
  const y3 = y2.add(z2.mul(x3));
  const z3 = z2.add(x3.mul(y3));
  return vec3(float(x3), float(y3), float(z3)).mul(1 / 4294967296);
}

/** PCG3D over plain numbers (the node's twin, for the tests): three unsigned whole numbers into `out` as fractions. */
export function pcg3Number(ax: number, ay: number, az: number, out: Float64Array | number[]): void {
  let x = (Math.imul(ax >>> 0, 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(ay >>> 0, 1664525) + 1013904223) >>> 0;
  let z = (Math.imul(az >>> 0, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  out[0] = x / 4294967296;
  out[1] = y / 4294967296;
  out[2] = z / 4294967296;
}

/** A lattice coordinate (a float node holding a whole number, at least −period) wrapped into [0, period), as a `u32`. */
const wrapped = (c: Any, period: Any): Any => uint(int(c.add(period).mod(period)));

/**
 * Worley's cellular noise, the distance to the nearest of one feature point a cell (F1), tiling at `period` cells: `p` in
 * cells (a vec3 node), `seed` a whole number. 27 cells round the point, in the shader's own loop, written once as a function
 * of the program (its every call one call), so the bake's program stays small and compiles quickly.
 */
const worleyFn = /*@__PURE__*/ Fn(([p, period, seed]: Any[]) => {
  const cell = floor(p).toVar();
  const f = p.sub(cell).toVar();
  const best = float(8).toVar();
  Loop(27, ({ i }: Any) => {
    const ox = float(i.mod(3)).sub(1);
    const oy = float(i.div(3).mod(3)).sub(1);
    const oz = float(i.div(9)).sub(1);
    const o = vec3(ox, oy, oz);
    const c = cell.add(o);
    const h = pcg3Node(wrapped(c.x, period).add(seed), wrapped(c.y, period), wrapped(c.z, period));
    const d = o.add(h).sub(f);
    best.assign(min(best, dot(d, d)));
  });
  return sqrt(best);
}).setLayout({ name: 'swgCloudWorley', type: 'float', inputs: [{ name: 'p', type: 'vec3' }, { name: 'period', type: 'float' }, { name: 'seed', type: 'uint' }] });

function worleyNode(p: Any, period: number, seed: number): Any {
  return worleyFn(p, float(period), uint(seed >>> 0));
}

/** Worley noise summed over three octaves from `freq` cells a tile, inverted (one at a cell's middle), in [0, 1]. */
function worleyFbmNode(p: Any, freq: number, seed: number): Any {
  const w = CLOUD_NOISE_SPEC.fbm;
  const a = worleyNode(p.mul(freq), freq, seed);
  const b = worleyNode(p.mul(freq * 2), freq * 2, seed + 101);
  const c = worleyNode(p.mul(freq * 4), freq * 4, seed + 202);
  return clamp(float(1).sub(a.mul(w[0]).add(b.mul(w[1])).add(c.mul(w[2]))), 0, 1);
}

/** The eight corners of a lattice cell. */
const CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

/**
 * Perlin's gradient noise tiling at `period` lattice cells (a random unit-ish gradient a corner from the hash, the quintic
 * fade), in about [−1, 1]: `p` in lattice cells.
 */
const gradientFn = /*@__PURE__*/ Fn(([p, period, seed]: Any[]) => {
  const i0 = floor(p).toVar();
  const f = p.sub(i0).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10)).toVar();
  const n: Any[] = [];
  for (const k of CORNERS) {
    const c = i0.add(vec3(k[0], k[1], k[2]));
    const g = pcg3Node(wrapped(c.x, period).add(seed), wrapped(c.y, period), wrapped(c.z, period)).mul(2).sub(1);
    n.push(dot(g, f.sub(vec3(k[0], k[1], k[2]))).toVar());
  }
  const x00 = mix(n[0], n[1], u.x);
  const x10 = mix(n[2], n[3], u.x);
  const x01 = mix(n[4], n[5], u.x);
  const x11 = mix(n[6], n[7], u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}).setLayout({ name: 'swgCloudGradient', type: 'float', inputs: [{ name: 'p', type: 'vec3' }, { name: 'period', type: 'float' }, { name: 'seed', type: 'uint' }] });

function gradientNode(p: Any, period: number, seed: number): Any {
  return gradientFn(p, float(period), uint(seed >>> 0));
}

/** Gradient noise summed over `octaves` from `freq` a tile, each octave twice the last's frequency at half its share, in about [−1, 1]. */
function gradientFbmNode(p: Any, freq: number, octaves: number, seed: number): Any {
  let sum: Any = float(0);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const fo = freq * 2 ** o;
    sum = sum.add(gradientNode(p.mul(fo), fo, seed + 31 * o).mul(amp));
    norm += amp;
    amp *= 0.5;
  }
  return sum.mul(1 / norm);
}

/** Schneider's remap: `v` carried from [l0, h0] to [l1, h1]. */
const remap = (v: Any, l0: Any, h0: Any, l1: Any, h1: Any): Any => l1.add(v.sub(l0).mul(h1.sub(l1)).div(max(h0.sub(l0), 1e-5)));

// ---------------------------------------------------------------- the bake

/** The session's noise: its three pictures, their compute nodes and how far the bake has come. */
export class CloudNoise {
  readonly shape: Storage3DTexture;
  readonly detail: Storage3DTexture;
  readonly curl: StorageTexture;
  /** The shape volume's compute for one slab (`slab.x` its first depth), the detail's and the curl's whole. */
  private readonly shapeNode: Any;
  private readonly detailNode: Any;
  private readonly curlNode: Any;
  /** The slab's first texel row in depth (x), written in place. */
  private readonly slab = new THREE.Vector4(0.5, 0, 0, 0);
  private readonly renderer: Any;
  private compiling: Promise<void> | null = null;
  private compiledOnce = false;
  /** Slabs of the shape volume baked so far (all of them and the detail and curl: `baked`). */
  slabsDone = 0;
  detailDone = false;

  constructor(renderer: Any) {
    this.renderer = renderer;
    const S = CLOUD_NOISE_SIZES;
    const vol = (n: number, name: string): Storage3DTexture => {
      const t = new Storage3DTexture(n, n, n);
      t.type = THREE.UnsignedByteType;
      t.format = THREE.RGBAFormat;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = (t as Any).wrapR = THREE.RepeatWrapping;
      t.generateMipmaps = false;
      t.name = name;
      return t;
    };
    this.shape = vol(S.shape, 'clouds-shape-noise');
    this.detail = vol(S.detail, 'clouds-detail-noise');
    const curl = new StorageTexture(S.curl, S.curl);
    curl.type = THREE.UnsignedByteType;
    curl.format = THREE.RGBAFormat;
    curl.minFilter = curl.magFilter = THREE.LinearFilter;
    curl.wrapS = curl.wrapT = THREE.RepeatWrapping;
    curl.generateMipmaps = false;
    curl.name = 'clouds-curl-noise';
    this.curl = curl;
    this.shapeNode = shapeBake(this.shape, uniform(this.slab).setGroup(renderGroup));
    this.detailNode = detailBake(this.detail);
    this.curlNode = curlBake(this.curl);
    CLOUD_NOISE_STATS.made++;
  }

  /** Every slab, the detail and the curl baked. */
  get baked(): boolean {
    return this.detailDone && this.slabsDone >= CLOUD_NOISE_SPEC.slabs;
  }

  /** The three computes' pipelines made off the frame (`compileComputeAsync`): asked once, answered by every later call. */
  compile(): Promise<void> {
    if (!this.compiling) {
      const r = this.renderer;
      const jobs: Promise<unknown>[] = [];
      if (typeof r.compileComputeAsync === 'function') {
        for (const n of [this.shapeNode, this.detailNode, this.curlNode]) jobs.push(Promise.resolve(r.compileComputeAsync(n)).catch(() => {}));
      }
      this.compiling = Promise.all(jobs).then(() => {
        this.compiledOnce = true;
        CLOUD_NOISE_STATS.compiled++;
      });
    }
    return this.compiling;
  }

  /** Whether the computes' pipelines have landed (a compute drawn before it lands throws in the frame: `webgpu.md`). */
  get compiled(): boolean {
    return this.compiledOnce;
  }

  /**
   * Behind a loading screen: the computes compiled, every slab, the detail and the curl dispatched, and the card waited on,
   * so `CLOUD_NOISE_STATS.bakeMs` is the bake's own time on the card (from the first dispatch to the queue's work done).
   */
  async bakeAll(): Promise<void> {
    await this.compile();
    if (this.baked) return;
    const r = this.renderer;
    const t0 = performance.now();
    while (this.slabsDone < CLOUD_NOISE_SPEC.slabs) this.dispatchSlab();
    if (!this.detailDone) this.dispatchRest();
    const dev = r.backend?.device;
    if (dev?.queue?.onSubmittedWorkDone) await dev.queue.onSubmittedWorkDone();
    CLOUD_NOISE_STATS.bakeMs = performance.now() - t0;
    CLOUD_NOISE_STATS.bakeWhere = 'screen';
    CLOUD_NOISE_STATS.baked++;
  }

  /**
   * In play, once a frame while not whole: one slab, or the detail and the curl last, only once the pipelines have landed
   * (asked here the first time). Answers whether the bake is whole. Allocates nothing once compiled.
   */
  bakeStep(): boolean {
    if (this.baked) return true;
    if (!this.compiledOnce) {
      void this.compile();
      return false;
    }
    if (this.slabsDone < CLOUD_NOISE_SPEC.slabs) this.dispatchSlab();
    else if (!this.detailDone) {
      this.dispatchRest();
      CLOUD_NOISE_STATS.bakeWhere = 'play';
      CLOUD_NOISE_STATS.baked++;
    }
    return this.baked;
  }

  private dispatchSlab(): void {
    const per = CLOUD_NOISE_SIZES.shape / CLOUD_NOISE_SPEC.slabs;
    this.slab.x = this.slabsDone * per;
    this.renderer.compute(this.shapeNode);
    this.slabsDone++;
    CLOUD_NOISE_STATS.slabsBaked++;
  }

  private dispatchRest(): void {
    this.renderer.compute(this.detailNode);
    this.renderer.compute(this.curlNode);
    this.detailDone = true;
  }

  /** What `__debug.clouds()` says of the noise. */
  report(): Record<string, unknown> {
    const S = CLOUD_NOISE_SIZES;
    return {
      sizes: `shape ${S.shape}³, detail ${S.detail}³ (RGBA, 8 bits a channel), curl ${S.curl}²`,
      memoryMB: Number(((S.shape ** 3 * 4 + S.detail ** 3 * 4 + S.curl ** 2 * 4) / 1048576).toFixed(2)),
      landed: this.compiledOnce,
      slabs: `${this.slabsDone} of ${CLOUD_NOISE_SPEC.slabs}`,
      whole: this.baked,
      stats: { ...CLOUD_NOISE_STATS },
    };
  }

  dispose(): void {
    this.shape.dispose();
    this.detail.dispose();
    this.curl.dispose();
  }
}

/** The shape volume's compute for one slab of `128 / slabs` texels deep, one invocation a texel. */
function shapeBake(out: Storage3DTexture, slab: Any): Any {
  const N = CLOUD_NOISE_SIZES.shape;
  const per = N / CLOUD_NOISE_SPEC.slabs;
  const sp = CLOUD_NOISE_SPEC.shape;
  const seed = CLOUD_NOISE_SPEC.seed;
  return Fn(() => {
    const idx = instanceIndex;
    const ix = idx.mod(N);
    const iy = idx.div(N).mod(N);
    const iz = idx.div(N * N).add(uint(int(slab.x)));
    const p = vec3(float(ix), float(iy), float(iz)).add(0.5).mul(1 / N).toVar('swgCloudNoiseP');
    // The billows: gradient noise in [0, 1], dilated by the coarsest Worley octaves (Schneider's Perlin-Worley).
    const perlin = clamp(gradientFbmNode(p, sp.perlinFreq, sp.perlinOctaves, seed).mul(0.5).add(0.5), 0, 1).toVar('swgCloudNoisePn');
    const w0 = worleyFbmNode(p, sp.worley[0], seed + 1000).toVar('swgCloudNoiseW0');
    const pw = clamp(remap(perlin, w0.sub(1), float(1), float(0), float(1)), 0, 1);
    const w1 = worleyFbmNode(p, sp.worley[1], seed + 2000);
    const w2 = worleyFbmNode(p, sp.worley[2], seed + 3000);
    const store = storageTexture3D(out, ivec3(int(ix), int(iy), int(iz)), vec4(pw, w0, w1, w2));
    store.toWriteOnly();
    store.toStack();
  })().compute((N * N * per), [64]);
}

/** The detail volume's compute, one invocation a texel. */
function detailBake(out: Storage3DTexture): Any {
  const N = CLOUD_NOISE_SIZES.detail;
  const dp = CLOUD_NOISE_SPEC.detail;
  const seed = CLOUD_NOISE_SPEC.seed + 5000;
  return Fn(() => {
    const idx = instanceIndex;
    const ix = idx.mod(N);
    const iy = idx.div(N).mod(N);
    const iz = idx.div(N * N);
    const p = vec3(float(ix), float(iy), float(iz)).add(0.5).mul(1 / N).toVar('swgCloudNoiseQ');
    const a = worleyFbmNode(p, dp.worley[0], seed);
    const b = worleyFbmNode(p, dp.worley[1], seed + 1000);
    const c = worleyFbmNode(p, dp.worley[2], seed + 2000);
    const store = storageTexture3D(out, ivec3(int(ix), int(iy), int(iz)), vec4(a, b, c, 1));
    store.toWriteOnly();
    store.toStack();
  })().compute(N * N * N, [64]);
}

/** The curl picture's compute: the curl of a tiling gradient noise by central differences, stored about a half. */
function curlBake(out: StorageTexture): Any {
  const N = CLOUD_NOISE_SIZES.curl;
  const cp = CLOUD_NOISE_SPEC.curl;
  const seed = CLOUD_NOISE_SPEC.seed + 9000;
  return Fn(() => {
    const idx = instanceIndex;
    const ix = idx.mod(N);
    const iy = idx.div(N);
    const p = vec2(float(ix), float(iy)).add(0.5).mul(1 / N).toVar('swgCloudNoiseC');
    const e = 1 / N;
    const at = (dx: number, dy: number): Any => gradientFbmNode(vec3(p.x.add(dx), p.y.add(dy), float(0.5 / N)), cp.freq, cp.octaves, seed);
    const dndx = at(e, 0).sub(at(-e, 0)).mul(1 / (2 * e));
    const dndy = at(0, e).sub(at(0, -e)).mul(1 / (2 * e));
    // The curl of a scalar field in the plane: (dN/dy, −dN/dx), scaled into about [−1, 1] by the field's frequency.
    const k = cp.scale / cp.freq;
    const cx = clamp(dndy.mul(k), -1, 1);
    const cy = clamp(dndx.mul(-k), -1, 1);
    const store = textureStore(out, ivec2(int(ix), int(iy)), vec4(cx.mul(0.5).add(0.5), cy.mul(0.5).add(0.5), abs(cx).add(abs(cy)).mul(0.5), 1));
    store.toWriteOnly();
    store.toStack();
  })().compute(N * N, [64]);
}

/** The session's one noise (made at the first ask, with the clouds on). */
let NOISE: CloudNoise | null = null;

export function cloudNoise(renderer: Any): CloudNoise {
  if (!NOISE) NOISE = new CloudNoise(renderer);
  return NOISE;
}

/** The noise if it has been made (the console's), never making it. */
export function cloudNoiseNow(): CloudNoise | null {
  return NOISE;
}
