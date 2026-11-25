// The cloud map on the card (pass 3, wave 1, maker M): both rings of `cloudMap.ts`'s function on compute, rewritten each
// frame, one slice a layer of an RGBA8 array picture (the near ring 512² over ±32 km, the far 256² over ±128 km, two samples
// a texel), and the face the march, the shadow map and the bakes read it through (`CloudMapFace`, `cloudLayers.ts`).
//
// The compute is `evalTexel` line for line (`cloudMap.ts`); `checkMap` reads a ring back and holds it to the twin.
//
// WebGPU only: nothing here is loaded on the WebGL path. Every number a frame writes goes into a `Vector4` a uniform array
// holds by reference, copied from the run's kept typed arrays (`write`): nothing is made per frame. Both computes are
// compiled behind the loading screen (`warm`), so no pipeline is built in play.
import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';
import { StorageArrayTexture } from 'three/webgpu';
import { timerMs } from '../../core/gpu/gpuTimer.ts';
import * as TSL from 'three/tsl';
import {
  CLOUD_BAND_FLOATS,
  CLOUD_LAYER_MAX,
  CLOUD_LAYER_VEC4,
  CLOUD_MAP_RINGS,
  CLOUD_STACK_FLOATS,
  CLOUD_TYPE_COUNT,
  CLOUD_TYPE_FLOATS,
  CLOUD_TYPE_VEC4,
  type CloudMapFace,
} from './cloudLayers.ts';
import { CLOUD_MAP_PARTS, CLOUD_REGION_MAX, MAP_TUNE_FLOATS, MIX_OCTAVES, PLAN_FLOATS, REGION_DUST, RING_VEC4, SHEET_OCTAVES } from './cloudMap.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, If, Loop, abs, float, floor, instanceIndex, int, ivec2, max, mix, renderGroup, smoothstep, sqrt, step, storageTexture, texture, uint, uniform, uniformArray, vec2, vec3, vec4 } = TSL as Any;

/** Three's `GPUTimer` (r188's; not yet in the 0.187 type declarations), as `gpuTimer.ts` reaches it. */
const GPUTimer = (WEBGPU as Any).GPUTimer as new (renderer: Any) => { begin(): void; end(): Promise<number | { delta: number } | null> };

/** The PCG step on a `u32` node (`cloudMap.ts`'s `pcg`, the same constants). */
function pcgN(u: Any): Any {
  const v = u.mul(uint(747796405)).add(uint(2891336453));
  const w = v.shiftRight(v.shiftRight(uint(28)).add(uint(4))).bitXor(v).mul(uint(277803737));
  return w.shiftRight(uint(22)).bitXor(w);
}
/** A hash's 24 high bits as a float in [0, 1) (`unit`). */
const unitN = (h: Any): Any => float(h.shiftRight(uint(8))).mul(1 / 16777216);
/** A lattice point's hash (`hash2`): ix, iz ints already in 0 to 65,535. */
const hash2N = (ix: Any, iz: Any, salt: Any): Any => pcgN(uint(ix).bitOr(uint(iz).shiftLeft(uint(16))).bitXor(salt));
/** A layer's salt for one use (`saltOf`): `seed` a u32 node under 2^24. */
const saltN = (seed: Any, which: number): Any => pcgN(seed.mul(uint(16)).add(uint(which)));
const wrapN = (i: Any): Any => i.bitAnd(int(0xffff));

/** Value noise at a lattice cell (`valueNoise`). */
function valueNoiseN(ix: Any, iz: Any, fx: Any, fz: Any, salt: Any): Any {
  const ix1 = wrapN(ix.add(1));
  const iz1 = wrapN(iz.add(1));
  const a = unitN(hash2N(ix, iz, salt));
  const b = unitN(hash2N(ix1, iz, salt));
  const c = unitN(hash2N(ix, iz1, salt));
  const d = unitN(hash2N(ix1, iz1, salt));
  const sx = fx.mul(fx).mul(float(3).sub(fx.mul(2)));
  const sz = fz.mul(fz).mul(float(3).sub(fz.mul(2)));
  const ab = a.add(b.sub(a).mul(sx));
  const cd = c.add(d.sub(c).mul(sx));
  return ab.add(cd.sub(ab).mul(sz));
}

/** fBm of `octaves` value noises (`fbm`): the place as a wrapped integer and a running fraction on each axis. */
function fbmN(iwx: Any, gx: Any, iwz: Any, gz: Any, octaves: number, seed: Any, saltFirst: number): Any {
  let sum: Any = float(0);
  let amp = 1;
  let norm = 0;
  let scale = 1;
  for (let k = 0; k < octaves; k++) {
    const ux = gx.mul(scale);
    const uz = gz.mul(scale);
    const fx = floor(ux);
    const fz = floor(uz);
    const ix = wrapN(int(iwx).mul(1 << k).add(int(fx)));
    const iz = wrapN(int(iwz).mul(1 << k).add(int(fz)));
    sum = sum.add(valueNoiseN(ix, iz, ux.sub(fx), uz.sub(fz), saltN(seed, saltFirst + k)).mul(amp));
    norm += amp;
    amp *= 0.5;
    scale *= 2;
  }
  return sum.div(norm);
}
const rankedN = (n: Any, contrast: Any): Any => n.sub(0.5).mul(contrast).add(0.5).clamp(0, 1);

// Pass 3, wave 2 (maker B): each ring's half size in texels and its texel in metres, for the face's offsets (`faceOffsetOf`).
const HALF_N = CLOUD_MAP_RINGS.near.size / 2;
const HALF_F = CLOUD_MAP_RINGS.far.size / 2;
const TEXEL_N = CLOUD_MAP_RINGS.near.span / CLOUD_MAP_RINGS.near.size;
const TEXEL_F = CLOUD_MAP_RINGS.far.span / CLOUD_MAP_RINGS.far.size;

/**
 * The map's card side: its two array pictures, its uniform arrays (each `Vector4` written in place), its two computes and
 * the face. Made once a session (`cloudMapGpu()`), dispatched each frame while the clouds are on.
 */
export class CloudMapGpu {
  readonly near: StorageArrayTexture;
  readonly far: StorageArrayTexture;
  /** The uniforms' own vectors, written in place from the run's typed arrays. */
  private readonly stackV: THREE.Vector4[] = [];
  private readonly typesV: THREE.Vector4[] = [];
  private readonly planV: THREE.Vector4[] = [];
  private readonly bandsV: THREE.Vector4[] = [];
  private readonly tuneV: THREE.Vector4[] = [];
  private readonly regionsV: THREE.Vector4[] = [];
  /** Each layer's (near offX, offZ, far offX, offZ): the face's own, from the plan. */
  private readonly offV: THREE.Vector4[] = [];
  private readonly frameV = new THREE.Vector4();
  /** (groundY, regionCount, layers, the parts' turn: 0 to `CLOUD_MAP_PARTS.far` − 1, the near ring's its remainder by `near`). */
  private readonly extraV = new THREE.Vector4();
  readonly nearNode: Any;
  readonly farNode: Any;
  /** Pass 3, wave 2 (maker B): each ring's computes for one part of its rows (`CLOUD_MAP_PARTS`), the turn in `extra.w`. */
  readonly nearPartNode: Any;
  readonly farPartNode: Any;
  /** Both computes, handed to three as one list (one pass, one submission), kept so a frame makes no array. */
  private readonly both: Any[];
  private readonly bothParts: Any[];
  readonly face: CloudMapFace;
  /** Frames dispatched, and whether the computes were compiled behind a screen. */
  dispatches = 0;
  /** Pass 3, wave 2 (maker B): dispatches of the whole rings and of a part of them, and the parts' turn (0 to far − 1). */
  fullDispatches = 0;
  partDispatches = 0;
  private turn = 0;
  warmed = false;

  constructor() {
    const L = CLOUD_LAYER_MAX;
    this.near = this.array(CLOUD_MAP_RINGS.near.size, 'clouds.near');
    this.far = this.array(CLOUD_MAP_RINGS.far.size, 'clouds.far');
    for (let i = 0; i < L * CLOUD_LAYER_VEC4; i++) this.stackV.push(new THREE.Vector4());
    for (let i = 0; i < CLOUD_TYPE_COUNT * CLOUD_TYPE_VEC4; i++) this.typesV.push(new THREE.Vector4());
    for (let i = 0; i < L * 2 * RING_VEC4; i++) this.planV.push(new THREE.Vector4());
    for (let i = 0; i < L; i++) this.bandsV.push(new THREE.Vector4());
    for (let i = 0; i < MAP_TUNE_FLOATS / 4; i++) this.tuneV.push(new THREE.Vector4());
    for (let i = 0; i < CLOUD_REGION_MAX; i++) this.regionsV.push(new THREE.Vector4());
    for (let i = 0; i < L; i++) this.offV.push(new THREE.Vector4());
    // Every number in the render group (refreshed at every dispatch and every render: webgpu.md's lesson on the object group).
    const arr = (v: THREE.Vector4[]): Any => uniformArray(v, 'vec4').setGroup(renderGroup);
    const stack = arr(this.stackV);
    const types = arr(this.typesV);
    const plan = arr(this.planV);
    const bands = arr(this.bandsV);
    const tune = arr(this.tuneV);
    const regions = arr(this.regionsV);
    const off = arr(this.offV);
    const frame = uniform(this.frameV).setGroup(renderGroup);
    const extra = uniform(this.extraV).setGroup(renderGroup);

    const texelN = this.texelGraph(stack, types, plan, tune, regions, extra);
    const near = this.near;
    const far = this.far;
    const NN = CLOUD_MAP_RINGS.near.size;
    const NF = CLOUD_MAP_RINGS.far.size;
    const layersN = int(extra.z);
    // Pass 3, wave 2 (maker B): one ring's compute over every `parts`-th row from the turn (`parts` 1: the whole ring). Each
    // storage texel holds the lattice index it keeps modulo the ring's size (the wrapped ring, `cloudMap.ts`' `ringStoreOf`),
    // so its offset from the ring's centre corner is `relOfStore` of the layer's base (r5), line for line.
    const ringNode = (ring: 0 | 1, parts: number): Any => {
      const N = ring === 0 ? NN : NF;
      const target = ring === 0 ? near : far;
      return Fn(() => {
        const idx = instanceIndex;
        const i = int(idx.mod(uint(N)));
        const jp = int(idx.div(uint(N)));
        // The row: every `parts`-th from the turn (the near ring's turn the far's remainder by its own parts).
        const j = parts > 1 ? jp.mul(int(parts)).add(int(extra.w).mod(int(parts))) : jp;
        Loop({ start: int(0), end: layersN, type: 'int', condition: '<' }, ({ i: l }: Any) => {
          // A slot of count 0 (off, or clear now with no place forcing its weather) is skipped and left as it was: nothing reads
          // a slot of count 0 (the fixer's, pass 3 wave 1; a starting deck at a level that holds none of it costs nothing).
          If(stack.element(l.mul(CLOUD_LAYER_VEC4).add(1)).w.greaterThan(0.5), () => {
            const r5 = plan.element(l.mul(2).add(ring).mul(RING_VEC4).add(5));
            // relOfStore: ((s − base + n/2) mod n) − n/2, in whole numbers (both terms under n, so one add of n keeps it positive).
            const tx = float(i.sub(int(r5.x)).add(int(N / 2 + N)).mod(int(N)).sub(int(N / 2)));
            const tz = float(j.sub(int(r5.y)).add(int(N / 2 + N)).mod(int(N)).sub(int(N / 2)));
            let v: Any;
            if (ring === 0) v = texelN(l, 0, tx, tz);
            else {
              // Two samples on the texel's diagonal, as `evalRing` takes the far ring (`FAR_SAMPLES`).
              const a = texelN(l, 1, tx.sub(0.25), tz.add(0.25));
              const b = texelN(l, 1, tx.add(0.25), tz.sub(0.25));
              v = a.add(b).mul(0.5);
            }
            const st = storageTexture(target, ivec2(i, j), v).depth(l);
            st.toWriteOnly();
            st.toStack();
          });
        });
      })().compute((N * N) / parts, [64]);
    };
    this.nearNode = ringNode(0, 1);
    this.farNode = ringNode(1, 1);
    this.nearPartNode = ringNode(0, CLOUD_MAP_PARTS.near);
    this.farPartNode = ringNode(1, CLOUD_MAP_PARTS.far);
    this.both = [this.nearNode, this.farNode];
    this.bothParts = [this.nearPartNode, this.farPartNode];

    // ------------------------------------------------------------------ the face
    const halfN = CLOUD_MAP_RINGS.near.span / 2;
    const halfF = CLOUD_MAP_RINGS.far.span / 2;
    const fade0 = halfN * 0.9;
    const nearT = texture(near);
    const farT = texture(far);
    const readN = (l: Any, rel: Any): Any => {
      const o = off.element(l);
      const uvN = rel.xz.add(o.xy).div(CLOUD_MAP_RINGS.near.span).add(0.5);
      return nearT.sample(uvN).depth(l).level(0);
    };
    // The far ring read through a cubic B-spline in four bilinear taps (Sigg and Hadwiger's, GPU Gems 2, 2005), not one tap
    // (the fixer's, pass 3 wave 1): its texel is a kilometre, a storm's 2 km cell spans two, and a bilinear read's iso-lines
    // are straight, so towers far off drew as boxes with straight sides; the B-spline's are round. Only the far ring's reads.
    const NFR = CLOUD_MAP_RINGS.far.size;
    const readF = (l: Any, rel: Any): Any => {
      const o = off.element(l);
      const uvF = rel.xz.add(o.zw).div(CLOUD_MAP_RINGS.far.span).add(0.5);
      const t = uvF.mul(NFR).sub(0.5);
      const i0 = floor(t);
      const f = t.sub(i0);
      const f2 = f.mul(f);
      const f3 = f2.mul(f);
      const w0 = f3.mul(-1).add(f2.mul(3)).sub(f.mul(3)).add(1).div(6);
      const w1 = f3.mul(3).sub(f2.mul(6)).add(4).div(6);
      const w2 = f3.mul(-3).add(f2.mul(3)).add(f.mul(3)).add(1).div(6);
      const w3 = f3.div(6);
      const g0 = w0.add(w1).toVar();
      const g1 = w2.add(w3).toVar();
      // Each pair's blend as one bilinear tap: its place between the pair's texel middles, in the picture's coordinates.
      const p0 = i0.sub(1).add(w1.div(g0)).add(0.5).div(NFR).toVar();
      const p1 = i0.add(1).add(w3.div(g1)).add(0.5).div(NFR).toVar();
      const tap = (u: Any, v: Any): Any => farT.sample(vec2(u, v)).depth(l).level(0);
      return tap(p0.x, p0.y).mul(g0.x.mul(g0.y)).add(tap(p1.x, p0.y).mul(g1.x.mul(g0.y))).add(tap(p0.x, p1.y).mul(g0.x.mul(g1.y))).add(tap(p1.x, p1.y).mul(g1.x.mul(g1.y)));
    };
    this.face = {
      sample: (layer: Any, rel: Any): Any => {
        const l = int(layer);
        const d = max(abs(rel.x), abs(rel.z));
        const out = vec4(0, 0, 0, 1).toVar();
        If(d.lessThan(fade0), () => {
          out.assign(readN(l, rel));
        })
          .ElseIf(d.lessThan(halfN), () => {
            out.assign(mix(readN(l, rel), readF(l, rel), smoothstep(fade0, halfN, d)));
          })
          .ElseIf(d.lessThan(halfF), () => {
            out.assign(readF(l, rel));
          });
        return out;
      },
      weights: (layer: Any, mixV: Any): Any => {
        const s1 = stack.element(int(layer).mul(CLOUD_LAYER_VEC4).add(1));
        const s2 = stack.element(int(layer).mul(CLOUD_LAYER_VEC4).add(2));
        return weightsN(s1.w, s2.x, s2.y, s2.z, mixV);
      },
      slot: (layer: Any, k: number): Any => stack.element(int(layer).mul(CLOUD_LAYER_VEC4).add(k)),
      typeSlot: (type: Any, k: number): Any => types.element(int(type).mul(CLOUD_TYPE_VEC4).add(k)),
      frame,
      band: (i: Any): Any => bands.element(int(i)),
    };
  }

  private array(size: number, name: string): StorageArrayTexture {
    const t = new StorageArrayTexture(size, size, CLOUD_LAYER_MAX);
    t.name = name;
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    // Pass 3, wave 2 (maker B): repeating, since each ring is kept wrapped in its layer's frame (`cloudMap.ts`' `ringStoreOf`).
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = false;
    return t;
  }

  /** `evalTexel` on the card: a layer's vec4(cover, mix, wet, top) at an offset from a ring's centre corner in texels. */
  private texelGraph(stack: Any, types: Any, plan: Any, tune: Any, regions: Any, extra: Any): (l: Any, ring: number, tx: Any, tz: Any) => Any {
    return (l: Any, ring: number, tx: Any, tz: Any): Any => {
      const sb = l.mul(CLOUD_LAYER_VEC4);
      const s0 = stack.element(sb);
      const s1 = stack.element(sb.add(1));
      const s2 = stack.element(sb.add(2));
      const s4 = stack.element(sb.add(4));
      const pb = l.mul(2).add(ring).mul(RING_VEC4);
      const r0 = plan.element(pb);
      const r1 = plan.element(pb.add(1));
      const r2 = plan.element(pb.add(2));
      const r3 = plan.element(pb.add(3));
      const r4 = plan.element(pb.add(4));
      const t0v = tune.element(int(0));
      const t1v = tune.element(int(1));
      const t2v = tune.element(int(2));
      const t3v = tune.element(int(3));
      const t4v = tune.element(int(4));
      const out = vec4(0, 0, 0, 1).toVar();
      const count = s1.w;
      // `evalTexel`'s early answer: no cover and no place forcing its weather lays nothing.
      If(count.greaterThan(0.5).and(s2.w.greaterThan(0).or(extra.y.greaterThan(0.5))), () => {
        const seed = uint(int(s4.w)).toVar();
        const cover = s2.w.toVar();
        const edge = s0.w;
        const texel = r4.z;
        // The mix and the weights.
        const m = float(0).toVar();
        If(count.greaterThan(1.5), () => {
          const step = r4.x;
          m.assign(rankedN(fbmN(r3.x, r3.y.add(tx.mul(step)), r3.z, r3.w.add(tz.mul(step)), MIX_OCTAVES, seed, 5), t2v.y));
        });
        const w = weightsN(count, s2.x, s2.y, s2.z, m).toVar();
        const pT0 = types.element(int(s1.x).mul(CLOUD_TYPE_VEC4).add(1));
        const pT1 = types.element(int(s1.y).mul(CLOUD_TYPE_VEC4).add(1));
        const pT2 = types.element(int(s1.z).mul(CLOUD_TYPE_VEC4).add(1));
        const qT0 = types.element(int(s1.x).mul(CLOUD_TYPE_VEC4).add(2));
        const qT1 = types.element(int(s1.y).mul(CLOUD_TYPE_VEC4).add(2));
        const qT2 = types.element(int(s1.z).mul(CLOUD_TYPE_VEC4).add(2));
        const cells = w.x.mul(pT0.x).add(w.y.mul(pT1.x)).add(w.z.mul(pT2.x)).toVar();
        const wetShare = w.x.mul(qT0.y).add(w.y.mul(qT1.y)).add(w.z.mul(qT2.y)).toVar();
        // The continuous sheet.
        const cs = float(0).toVar();
        If(cells.lessThan(1), () => {
          const step = r0.w;
          const n = rankedN(fbmN(r2.x, r2.y.add(tx.mul(step)), r2.z, r2.w.add(tz.mul(step)), SHEET_OCTAVES, seed, 1), t2v.x);
          const wd = t2v.z.add(t2v.w.mul(edge));
          const th = float(1).sub(cover).mul(wd.mul(2).add(1)).sub(wd);
          cs.assign(smoothstep(th.sub(wd), th.add(wd), n));
        });
        // The cells.
        const cc = float(0).toVar();
        const ctop = float(1).toVar();
        const tw = float(0).toVar();
        const tsum = float(0).toVar();
        If(cells.greaterThan(0), () => {
          const step = r0.z;
          const gx = r1.y.add(tx.mul(step));
          const gz = r1.w.add(tz.mul(step));
          const fx0 = floor(gx);
          const fz0 = floor(gz);
          const ix = wrapN(int(r1.x).add(int(fx0))).toVar();
          const iz = wrapN(int(r1.z).add(int(fz0))).toVar();
          const fx = gx.sub(fx0).toVar();
          const fz = gz.sub(fz0).toVar();
          const salt = saltN(seed, 0).toVar();
          const presence = cover.mul(t0v.y).min(1).toVar();
          const rho0 = t0v.z.add(t0v.w.sub(t0v.z).mul(sqrt(cover))).toVar();
          const lifeOn = t4v.y;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              const cx = wrapN(ix.add(dx));
              const cz = wrapN(iz.add(dz));
              const h = hash2N(cx, cz, salt).toVar();
              const env = float(1).toVar();
              If(lifeOn.greaterThan(0.5), () => {
                const ph = t4v.w.add(unitN(h));
                const pf = floor(ph);
                const e = wrapN(int(t4v.z).add(int(pf)));
                const phi = ph.sub(pf);
                env.assign(smoothstep(0, t1v.z, phi).mul(float(1).sub(smoothstep(float(1).sub(t1v.w), 1, phi))));
                h.assign(pcgN(h.add(uint(e))));
              });
              // One hash's four bytes (`evalTexel`): the jitters, whether the cell is up, its size; its top from a second.
              const a = pcgN(h).toVar();
              const byteN = (shift: number): Any => float(a.shiftRight(uint(shift)).bitAnd(uint(255))).mul(1 / 256).add(1 / 512);
              If(byteN(16).lessThan(presence), () => {
                const px = byteN(0).sub(0.5).mul(t0v.x).add(dx + 0.5);
                const pz = byteN(8).sub(0.5).mul(t0v.x).add(dz + 0.5);
                const e2 = pcgN(a);
                const rho = rho0.mul(float(1).sub(t1v.x.mul(0.5)).add(t1v.x.mul(byteN(24)))).mul(env).min(1.1).toVar();
                If(rho.greaterThan(1e-4), () => {
                  const ddx = fx.sub(px);
                  const ddz = fz.sub(pz);
                  const v = float(1).sub(ddx.mul(ddx).add(ddz.mul(ddz)).div(rho.mul(rho))).toVar();
                  cc.assign(max(cc, v));
                  If(v.greaterThan(0), () => {
                    const w2 = v.mul(v);
                    tw.addAssign(w2);
                    tsum.addAssign(w2.mul(t1v.y.add(float(1).sub(t1v.y).mul(unitN(e2)).mul(sqrt(env)))));
                  });
                });
              });
            }
          }
          ctop.assign(tsum.add(0.01).div(tw.add(0.01)));
        });
        const cov = cs.add(cc.sub(cs).mul(cells)).toVar();
        const top = float(1).add(ctop.sub(1).mul(cells)).toVar();
        const wet = cov.mul(wetShare).mul(s4.z).toVar();
        // The regions, world-fixed.
        const rc = int(extra.y);
        If(rc.greaterThan(0), () => {
          const px = tx.add(0.5).mul(texel).sub(r0.x);
          const pz = tz.add(0.5).mul(texel).sub(r0.y);
          Loop({ start: int(0), end: rc, type: 'int', condition: '<', name: 'r' }, ({ r }: Any) => {
            const R = regions.element(r);
            const ddx = px.sub(R.x);
            const ddz = pz.sub(R.y);
            const dist = sqrt(ddx.mul(ddx).add(ddz.mul(ddz)));
            const k = float(1).sub(smoothstep(R.z.sub(t3v.x), R.z.add(t3v.x), dist)).toVar();
            If(k.greaterThan(0), () => {
              If(R.w.equal(float(REGION_DUST)), () => {
                If(s0.x.lessThan(extra.x.add(t4v.x)), () => {
                  cov.assign(cov.mul(float(1).sub(k.mul(t3v.w))));
                  wet.assign(wet.mul(float(1).sub(k)));
                });
              }).Else(() => {
                const want = max(cov, t3v.y);
                cov.assign(cov.add(k.mul(want.sub(cov))));
                const ws = max(wetShare, t3v.z);
                const wantWet = max(cov.mul(ws), wet);
                wet.assign(wet.add(k.mul(wantWet.sub(wet))));
              });
            });
          });
        });
        out.assign(vec4(cov.clamp(0, 1), m, wet.clamp(0, 1), top.clamp(0, 1)));
      });
      return out;
    };
  }

  /**
   * The frame's numbers from the run's typed arrays into the uniforms' vectors (field by field: a vector's `set` hands its
   * numbers across a call the compiler may leave out). Allocates nothing.
   */
  write(src: CloudMapSource): void {
    // Read off the run's record (a double handed across a call the compiler leaves out is a number made).
    const stack = src.stackF;
    const types = src.typesF;
    const plan = src.planF;
    const bands = src.bandsF;
    const tune = src.tuneF;
    const regions = src.mf.regions;
    const frame = src.frameF;
    copyInto(this.stackV, stack, CLOUD_STACK_FLOATS);
    copyInto(this.typesV, types, CLOUD_TYPE_FLOATS);
    copyInto(this.planV, plan, PLAN_FLOATS);
    copyInto(this.bandsV, bands, CLOUD_BAND_FLOATS);
    copyInto(this.tuneV, tune, MAP_TUNE_FLOATS);
    copyInto(this.regionsV, regions, CLOUD_REGION_MAX * 4);
    // Pass 3, wave 2 (maker B): the face's offsets into the wrapped rings (`faceOffsetOf`: the camera past its centre corner
    // plus where the ring keeps that corner, less half the ring), each under a ring's span, so nothing far reaches the card.
    // Written out here (a number handed back from a helper the compiler leaves out is a number made a frame).
    const RF = RING_VEC4 * 4;
    for (let l = 0; l < CLOUD_LAYER_MAX; l++) {
      const v = this.offV[l];
      const on = l * 2 * RF;
      const of = (l * 2 + 1) * RF;
      v.x = plan[on] + (plan[on + 20] - HALF_N) * TEXEL_N;
      v.y = plan[on + 1] + (plan[on + 21] - HALF_N) * TEXEL_N;
      v.z = plan[of] + (plan[of + 20] - HALF_F) * TEXEL_F;
      v.w = plan[of + 1] + (plan[of + 21] - HALF_F) * TEXEL_F;
    }
    const f = this.frameV;
    f.x = frame[0];
    f.y = frame[1];
    f.z = frame[2];
    f.w = frame[3];
    const e = this.extraV;
    e.x = src.groundY;
    e.y = src.mf.regionCount;
    e.z = src.count;
  }

  /**
   * Both rings rewritten (the run's `frame` calls it once the numbers are written): whole (`full`), or one part of each
   * (pass 3, wave 2, maker B: every `CLOUD_MAP_PARTS.near`-th row of the near ring and `far`-th of the far from the turn,
   * the turn moved on after).
   */
  compute(renderer: Any, full: boolean): void {
    const timing = this.timing;
    const part = this.timePart;
    if (timing) this.timer ??= new GPUTimer(renderer);
    // The parts' turn into the uniform (a small whole number, never boxed) before the dispatch reads it.
    this.extraV.w = this.turn;
    const both = full ? this.both : this.bothParts;
    if (part === 0) {
      // Both rings in one compute pass, one submission (two calls were two submissions with the card idle between them).
      if (timing) this.timer.begin();
      renderer.compute(both);
      if (timing) this.spans.push(this.timer.end());
    } else {
      // The console's split timing: each ring in a pass of its own.
      if (timing && part === 1) this.timer.begin();
      renderer.compute(both[0]);
      if (timing && part === 1) this.spans.push(this.timer.end());
      if (timing && part === 2) this.timer.begin();
      renderer.compute(both[1]);
      if (timing && part === 2) this.spans.push(this.timer.end());
    }
    if (full) this.fullDispatches++;
    else {
      this.partDispatches++;
      this.turn = this.turn + 1 < CLOUD_MAP_PARTS.far ? this.turn + 1 : 0;
    }
    this.dispatches++;
  }

  /** Timing (`time`): three's own timer round both computes, each frame's span kept until read. Off, nothing of it is made. */
  private timing = false;
  /** Which passes a span covers: 0 both, 1 the near ring's, 2 the far ring's. */
  timePart = 0;
  private timer: Any = null;
  private spans: Promise<number | { delta: number } | null>[] = [];

  /**
   * The map's card time over `frames` frames by three's timer spans (`GPUTimer`: from the first compute pass's start to the
   * last's end, each frame): the median, the 95th and the most, in milliseconds. Asynchronous; the console's.
   */
  async time(frames: number): Promise<{ frames: number; read: number; medianMs: number; p95Ms: number; mostMs: number } | { none: string }> {
    this.spans = [];
    this.timing = true;
    const t0 = performance.now();
    while (this.spans.length < frames && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 50));
    this.timing = false;
    const got = await Promise.race([Promise.all(this.spans), new Promise<null>((r) => setTimeout(() => r(null), 15000))]);
    this.spans = [];
    if (!got) return { none: 'the timer did not answer in time' };
    const ms = got.map((a) => timerMs(a)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!ms.length) return { none: 'no span read (no timestamp queries on this device?)' };
    const at = (q: number): number => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
    return { frames, read: ms.length, medianMs: Number(at(0.5).toFixed(4)), p95Ms: Number(at(0.95).toFixed(4)), mostMs: Number(ms[ms.length - 1].toFixed(4)) };
  }

  /** Both computes compiled, behind the loading screen. */
  async warm(renderer: Any): Promise<void> {
    if (this.warmed) return;
    // Pass 3, wave 2 (maker B): the parts' computes with the whole rings' (four compute pipelines, none built in play).
    await renderer.compileComputeAsync([this.nearNode, this.farNode, this.nearPartNode, this.farPartNode]);
    this.warmed = true;
  }

  /** One layer's ring read back as stored (RGBA8), asynchronously (never in a frame). */
  async readBack(renderer: Any, layer: number, ring: 0 | 1): Promise<Uint8Array> {
    const t = ring === 0 ? this.near : this.far;
    const N = ring === 0 ? CLOUD_MAP_RINGS.near.size : CLOUD_MAP_RINGS.far.size;
    // Raced against ten seconds: a lost device never answers, and the console must not wait for ever.
    const raw = await Promise.race([renderer.backend.copyTextureToBuffer(t, 0, 0, N, N, layer), new Promise<never>((_, no) => setTimeout(() => no(new Error('the read-back did not answer in 10 s')), 10000))]);
    return new Uint8Array(raw.buffer, raw.byteOffset, N * N * 4).slice();
  }

  dispose(): void {
    this.near.dispose();
    this.far.dispose();
  }
}

/** What the map's upload reads each frame: the run's kept arrays and numbers (`cloudRun.ts`'s `CloudRun`). */
export interface CloudMapSource {
  readonly stackF: Float32Array;
  readonly typesF: Float32Array;
  readonly planF: Float64Array;
  readonly bandsF: Float32Array;
  readonly tuneF: Float32Array;
  readonly frameF: Float32Array;
  readonly mf: { readonly regions: Float64Array; readonly regionCount: number };
  readonly groundY: number;
  readonly count: number;
}

/** The mix's weights on the card (`mixWeights`): count, the cuts, their half width, the mix value. */
export function weightsN(count: Any, cut0: Any, cut1: Any, soft: Any, m: Any): Any {
  const s = max(soft, 1e-4);
  const a = m.sub(cut0.sub(s)).div(s.mul(2)).clamp(0, 1);
  const w1 = a.mul(a).mul(float(3).sub(a.mul(2)));
  const b = m.sub(cut1.sub(s)).div(s.mul(2)).clamp(0, 1);
  const w2 = b.mul(b).mul(float(3).sub(b.mul(2)));
  const two = vec3(float(1).sub(w1), w1, 0);
  const three = vec3(float(1).sub(w1), w1.sub(w2), w2);
  // One type alone, two, or three (`count` a float on the card: 1, 2 or 3).
  return mix(mix(vec3(1, 0, 0), two, step(1.5, count)), three, step(2.5, count));
}

function copyInto(v: THREE.Vector4[], a: Float32Array | Float64Array, n: number): void {
  const k = n >> 2;
  for (let i = 0; i < k; i++) {
    const x = v[i];
    x.x = a[i * 4];
    x.y = a[i * 4 + 1];
    x.z = a[i * 4 + 2];
    x.w = a[i * 4 + 3];
  }
}

let made: CloudMapGpu | null = null;
/** The session's map on the card, made the first time it is asked for (on WebGPU alone). */
export function cloudMapGpu(): CloudMapGpu {
  made ??= new CloudMapGpu();
  return made;
}
/** Whether the session's map has been made (the console's; asks nothing of the card). */
export function cloudMapGpuMade(): boolean {
  return made !== null;
}
