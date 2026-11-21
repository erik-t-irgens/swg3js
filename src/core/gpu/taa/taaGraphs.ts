// The edge smoothing's two resolves as node graphs (the GPU port's pass 1, wave 6; the design's section 6): the full smoothing,
// a picture the scene target's size gathered over frames, and the upscaled one, a picture the canvas's size gathered from a
// scene drawn at a share of it. Each pixel takes its history from where the motion buffer (`motion.ts`) says its surface stood
// last frame, keeps it only where the depth there agrees, holds it to the spread of this frame's colours round the pixel, and
// mixes a share of the new frame in.
//
// What is the game's own, where three's nodes (three.js, MIT, `LICENSES/three-MIT.txt`: `TRAANode`, `TAAUNode` and the shared
// `Reprojection` of its commit 0245b6d, which this follows in its method) do otherwise:
//   - **the history is reprojected by the motion buffer**, this frame's place less last frame's in normalised device
//     coordinates, unjittered, with no velocity pass and no matrices of last frame's here;
//   - **the depth test is linear and relative**: the motion buffer's blue is the surface's view distance now less last frame's,
//     so last frame's distance of the surface here is this frame's less it, held against the distance kept with the history
//     where the history is read, as a share of it. Three compares its depth buffer's own values, which with the game's 5 cm near
//     plane span a metre at ten metres and a hundred at a hundred; and its camera-only reprojection of last frame's depth throws
//     away the history of whatever moves with the camera (a ridden pod), which the surface's own change keeps;
//   - **reactive**: the motion buffer's alpha (what a see-through or additive draw covered) raises the new frame's share;
//   - **the history's distance is kept beside its colour**, in a second output of the history target (one channel under the full
//     smoothing; the upscaled one's lock beside it), so no depth texture is copied;
//   - a reset (a cut, a resize, the first frame) is a uniform taking the new frame whole, never a seeding draw of its own.
// The neighbourhood clip is the usual one (the spread's box round the mean, the history moved along its line to the mean onto
// the box), the mix weighted by each colour's inverse brightness so a bright speck neither flickers nor smears, and the upscaled
// resolve weights the scene's nearest nine samples round each canvas pixel by a Gaussian fit of a Blackman-Harris window at
// each sample's jittered place, its lock holding a thin bright line (a wire, a frond) against the clip. Every texture is read
// with `load` or with a sample at level 0, so nothing is read inside a branch with a derivative.
//
// Nothing here is loaded on the WebGL path. The pass that draws these is `taaPass.ts`.

import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { chainMaterial, graph, type ChainGraph } from '../gpuChain.ts';
import { liveTexture } from '../gpuGround.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, If, abs, clamp, dot, exp, float, floor, ivec2, max, min, mix, outputStruct, select, smoothstep, sqrt, struct, texture, uniform, uv, vec2, vec3, vec4, renderGroup } = TSL as Any;

/**
 * Every number the graphs are built from that is not a uniform: the distance a pixel with nothing drawn is kept at (a half float
 * holds 65,504), the Gaussian's width (the usual fit of a Blackman-Harris window over a pixel), the clip's spread under motion
 * (from the whole spread at rest to half of it at the motion's top: three's own), the lock's rise (a line brighter than its
 * neighbours by a fifth is held whole) and fall (half a frame), and the luminance weights (Rec. 709).
 */
export const TAA_NUMBERS = {
  farKept: 60000,
  gauss: 2.29,
  gammaMoving: 0.5,
  gammaStill: 1,
  lockRise: 0.2,
  lockFall: 0.5,
  luma: [0.2126, 0.7152, 0.0722] as const,
  eps: 1e-5,
};

/** What the graphs read: the pictures by `{ value }` (the pass swaps them each frame) and four kept vectors by reference. */
export interface TaaInputs {
  /** This frame's picture coming in (a chain buffer). */
  input: { value: THREE.Texture | null };
  /** Last frame's smoothed picture and what was kept beside it (its distance, and under the upscaled smoothing its lock). */
  history: { value: THREE.Texture | null };
  aux: { value: THREE.Texture | null };
  /** The scene target's depth and its motion buffer, each fixed for a chain's life. */
  depth: THREE.Texture;
  motion: THREE.Texture;
  /** The renderer draws reversed depth (the clear is nought). */
  reversed: boolean;
  /** (near, far, the new frame's least share, the reactive share). */
  p0: THREE.Vector4;
  /** (the depth test's share, the edge's share, the motion in pixels at which history counts for nothing, reset: 1 or 0). */
  p1: THREE.Vector4;
  /** (the scene's width and height, the picture's width and height). */
  size: THREE.Vector4;
  /** The frame's jitter in the scene's pixels (`taaJitter.ts`'s x and y). */
  jitter: THREE.Vector2;
}

/** A linear half-float texel of its own (each slot its own, or two slots holding one texture would be one binding). */
function halfFallback(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** The graphs' shared parts, made once a graph. */
interface Parts {
  input: Any;
  history: Any;
  aux: Any;
  depth: Any;
  motion: Any;
  p0: Any;
  p1: Any;
  size: Any;
  jitter: Any;
}

function parts(u: TaaInputs): Parts {
  return {
    input: liveTexture(u.input, halfFallback()),
    history: liveTexture(u.history, halfFallback()),
    aux: liveTexture(u.aux, halfFallback()),
    depth: texture(u.depth),
    motion: texture(u.motion),
    p0: uniform(u.p0).setGroup(renderGroup),
    p1: uniform(u.p1).setGroup(renderGroup),
    size: uniform(u.size).setGroup(renderGroup),
    jitter: uniform(u.jitter).setGroup(renderGroup),
  };
}

const N = TAA_NUMBERS;
const lumaOf = (c: Any): Any => dot(c.rgb, vec3(N.luma[0], N.luma[1], N.luma[2]));

/** A depth texel's view distance (the occlusion's formula, `gpuSsao.ts`'s `viewZOf`), and where nothing was drawn the far kept. */
function linearZ(d: Any, near: Any, far: Any, reversed: boolean): Any {
  const z = reversed ? near.mul(far).div(near.add(d.mul(far.sub(near)))) : near.mul(far).div(far.sub(d.mul(far.sub(near))));
  const sky = reversed ? d.lessThanEqual(0) : d.greaterThanEqual(1);
  return min(select(sky, float(N.farKept), z), float(N.farKept));
}

/** The nearest and farthest distance of the nine texels round `c`, and the nearest's texel (the motion is read there). */
function dilate(p: Parts, c: Any, sizeI: Any, reversed: boolean, tag: string): { zNear: Any; zFar: Any; at: Any } {
  const near = p.p0.x;
  const far = p.p0.y;
  const zNear = float(N.farKept * 2).toVar(`swgTaa${tag}Zn`);
  const zFar = float(0).toVar(`swgTaa${tag}Zf`);
  const at = ivec2(c).toVar(`swgTaa${tag}At`);
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const t = clamp(c.add(ivec2(x, y)), ivec2(0), sizeI.sub(1));
      const z = linearZ(float(p.depth.load(t).x), near, far, reversed);
      If(z.lessThan(zNear), () => {
        zNear.assign(z);
        at.assign(t);
      });
      zFar.assign(max(zFar, z));
    }
  }
  return { zNear, zFar, at };
}

/**
 * The history's place and whether it holds: last frame's place of this pixel's surface (the motion read at the nearest texel round
 * it, as is usual, so an edge takes the nearer thing's motion), and the depth test there.
 */
function reproject(p: Parts, at: Any, uvNow: Any, zNear: Any, zFar: Any, tag: string): { historyUv: Any; held: Any; motionPx: Any; reactive: Any; changed: Any; onPicture: Any } {
  const mv = vec4(p.motion.load(at)).toVar(`swgTaa${tag}Mv`);
  const historyUv = vec2(uvNow.sub(mv.xy.mul(vec2(0.5, -0.5)))).toVar(`swgTaa${tag}Huv`);
  const onPicture = historyUv.greaterThanEqual(vec2(0)).all().and(historyUv.lessThanEqual(vec2(1)).all());
  // Last frame's distance of the surface here: this frame's less its change (the motion buffer's blue), against the history's own.
  const zLast = max(zNear.sub(mv.z), float(1e-3));
  const zKept = float(p.aux.sample(historyUv).level(0).x).toVar(`swgTaa${tag}Zk`);
  const changed = abs(zKept.sub(zLast)).greaterThan(p.p1.x.mul(zLast));
  const edge = zFar.sub(zNear).greaterThan(p.p1.y.mul(zNear));
  const held = onPicture.and(edge.or(changed.not())).and(p.p1.w.lessThan(0.5));
  const motionPx = mv.xy.mul(p.size.xy).mul(0.5).length();
  return { historyUv, held, motionPx, reactive: clamp(mv.w, 0, 1), changed, onPicture };
}

/** The history moved along its line to the mean until it lies in the box the spread makes round the mean. */
function clipToSpread(history: Any, mean: Any, spread: Any): Any {
  const e = spread.rgb.add(N.eps);
  const v = history.rgb.sub(mean.rgb);
  const u = abs(v.div(e));
  const most = max(u.x, max(u.y, u.z));
  return vec4(select(most.greaterThan(1), mean.rgb.add(v.div(most)), history.rgb), 1);
}

/** The new frame and the clipped history mixed at `w`, each weighted by its inverse brightness (no speck flickers or smears). */
function mixWeighted(current: Any, history: Any, w: Any): Any {
  const wc = w.div(lumaOf(current).add(1));
  const wh = float(1).sub(w).div(lumaOf(history).add(1));
  return current.rgb.mul(wc).add(history.rgb.mul(wh)).div(max(wc.add(wh), N.eps));
}

const OUT = struct({ color: 'vec4', aux: 'vec4' });

/** A resolve's material: its two outputs written straight into the pass's own history target, carried through no output of three's. */
function resolveMaterial(name: string, resolve: Any): Any {
  const m = chainMaterial(name);
  const r = resolve().toConst();
  m.fragmentNode = outputStruct(r.get('color'), r.get('aux'));
  // Drawn into a target of the pass's own, linear, two outputs: no output of the inline one's (`inlineOutput.ts`) applies.
  (m as Any).swgRawOut = true;
  return m;
}

/** The full smoothing: the picture the scene target's size, each pixel's history at its own surface's last place. */
export function traaGraph(u: TaaInputs): ChainGraph {
  const p = parts(u);
  const resolve = Fn(() => {
    const at = uv();
    const inSize = vec2(p.size.x, p.size.y);
    const sizeI = ivec2(inSize);
    const c = clamp(ivec2(floor(at.mul(inSize))), ivec2(0), sizeI.sub(1));
    const d = dilate(p, c, sizeI, u.reversed, 'F');
    const r = reproject(p, d.at, at, d.zNear, d.zFar, 'F');
    const history = vec4(p.history.sample(r.historyUv).level(0)).toVar('swgTaaFH');
    // This frame's colour and the spread of its nine round it (values that are not numbers were zeroed by the sanitize).
    const current = vec4(max(p.input.load(c), vec4(0))).toVar('swgTaaFC');
    const m1 = vec4(current).toVar('swgTaaFM1');
    const m2 = vec4(current.mul(current)).toVar('swgTaaFM2');
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        if (x === 0 && y === 0) continue;
        const n = max(p.input.load(clamp(c.add(ivec2(x, y)), ivec2(0), sizeI.sub(1))), vec4(0));
        m1.addAssign(n);
        m2.addAssign(n.mul(n));
      }
    }
    const mean = m1.div(9);
    const motionShare = clamp(r.motionPx.div(p.p1.z), 0, 1);
    const gamma = mix(float(N.gammaMoving), float(N.gammaStill), float(1).sub(motionShare).mul(float(1).sub(motionShare)));
    const spread = sqrt(max(m2.div(9).sub(mean.mul(mean)), vec4(0))).mul(gamma);
    const clipped = clipToSpread(history, mean, spread);
    const w = clamp(p.p0.z.add(motionShare).add(r.reactive.mul(p.p0.w)), 0, 1);
    const weight = select(r.held, w, float(1));
    const out = mixWeighted(current, clipped, weight);
    return OUT(vec4(out, 1), vec4(d.zNear, 0, 0, 1));
  });
  const m = resolveMaterial('fx.gpu.taa.full', resolve);
  return graph(m, 5, { uniforms: { p0: p.p0, p1: p.p1, size: p.size, jitter: p.jitter }, textures: { input: p.input, history: p.history, aux: p.aux, depth: p.depth, motion: p.motion } });
}

/**
 * The upscaled smoothing: the picture the canvas's size from a scene drawn at a share of it. Each canvas pixel finds the scene's
 * sample nearest its centre at this frame's jitter, rebuilds this frame's colour from the nine round it weighted by their
 * distance, and gathers the rest from its history, its lock (the history target's second output's green) holding a thin line.
 */
export function taauGraph(u: TaaInputs): ChainGraph {
  const p = parts(u);
  const resolve = Fn(() => {
    const at = uv();
    const inSize = vec2(p.size.x, p.size.y);
    const sizeI = ivec2(inSize);
    // The canvas pixel's centre in the scene's pixels; the scene's texel (m, n) shows what lies at (m, n) + 0.5 + the jitter.
    const pIn = at.mul(inSize);
    const tapF = floor(pIn.sub(p.jitter));
    const c = clamp(ivec2(tapF), ivec2(0), sizeI.sub(1));
    const d = dilate(p, c, sizeI, u.reversed, 'U');
    const r = reproject(p, d.at, at, d.zNear, d.zFar, 'U');
    const history = vec4(p.history.sample(r.historyUv).level(0)).toVar('swgTaaUH');
    const keptLock = float(p.aux.sample(r.historyUv).level(0).y).toVar('swgTaaUL');
    const sum = vec4(0).toVar('swgTaaUS');
    const wsum = float(0).toVar('swgTaaUW');
    const m1 = vec4(0).toVar('swgTaaUM1');
    const m2 = vec4(0).toVar('swgTaaUM2');
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        const t = clamp(c.add(ivec2(x, y)), ivec2(0), sizeI.sub(1));
        const centre = vec2(t).add(0.5).add(p.jitter);
        const dd = pIn.sub(centre);
        const wt = exp(dot(dd, dd).mul(-N.gauss));
        const s = max(p.input.load(t), vec4(0));
        sum.addAssign(s.mul(wt));
        wsum.addAssign(wt);
        m1.addAssign(s);
        m2.addAssign(s.mul(s));
      }
    }
    const current = vec4(sum.div(max(wsum, N.eps))).toVar('swgTaaUC');
    const mean = m1.div(9);
    const motionShare = clamp(r.motionPx.div(p.p1.z), 0, 1);
    const gamma = mix(float(N.gammaMoving), float(N.gammaStill), float(1).sub(motionShare).mul(float(1).sub(motionShare)));
    const spread = sqrt(max(m2.div(9).sub(mean.mul(mean)), vec4(0))).mul(gamma);
    const clipped = clipToSpread(history, mean, spread);
    // The lock: a line brighter or darker than the mean round it by a share rises toward whole, where the depth held and nothing
    // see-through was drawn over it; it falls by half a frame, and to nought where the surface changed.
    const meanL = max(lumaOf(mean), N.eps);
    const thin = smoothstep(0, N.lockRise, abs(lumaOf(current).sub(meanL)).div(meanL));
    const canLock = r.onPicture.and(r.changed.not()).and(p.p1.w.lessThan(0.5));
    const lock = clamp(max(select(canLock, thin, float(0)), keptLock.mul(select(r.changed, float(0), float(N.lockFall)))).mul(float(1).sub(r.reactive)), 0, 1);
    const lockedHistory = mix(clipped.rgb, history.rgb, lock);
    const w = clamp(p.p0.z.add(motionShare).add(r.reactive.mul(p.p0.w)), 0, 1);
    const weight = select(r.held, w, float(1));
    const out = mixWeighted(current, vec4(lockedHistory, 1), weight);
    return OUT(vec4(out, 1), vec4(d.zNear, select(r.held, lock, float(0)), 0, 1));
  });
  const m = resolveMaterial('fx.gpu.taa.upscaled', resolve);
  return graph(m, 5, { uniforms: { p0: p.p0, p1: p.p1, size: p.size, jitter: p.jitter }, textures: { input: p.input, history: p.history, aux: p.aux, depth: p.depth, motion: p.motion } });
}
