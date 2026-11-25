// The clouds' fill-in over frames and their flight mode on WebGPU (the GPU port's pass 3, wave 2, maker T; the design's 2.2
// "the trace and filling in", "reset by motion", "flying through and above"; the cloud-look plan's rank 3, after Red Dead
// Redemption 2's way, Bauer's SIGGRAPH 2019 talk as report B read it: the method only, no code of anyone's).
//
//   1. **The quarter update.** The march (`cloudMarch.ts`) takes one pixel of each two by two of the trace a frame, into a
//      target a quarter of the trace's size, and says which (`subPixelOf`): in the frame's order (a Bayer order, a checkerboard
//      offset between neighbouring tiles), except where the tile spans a depth edge (a roof against the sky, a tree's crown),
//      where the frames alternate between its near and its far pixels so neither side waits four frames.
//   2. **The resolve** (`resolveGraph`, into the trace-sized history, two taken in turn): a pixel marched this frame takes its
//      new ray; every other one its history, found where its cloud stood last frame (its point at its cloud distance, moved
//      back by its own layer's drift and by the camera's own move, seen by last frame's camera), held to the box of the new rays
//      round it that share its depth (neighbours across a depth edge left out, so a roof's history is not let through by the
//      sky's rays), or, with no history, the new rays round it that share its depth. A marched pixel keeps `history` of its own
//      history, so a jitter that keeps moving everywhere, far clouds included, is averaged away rather than frozen.
//   3. **Resets.** The whole history at a cut (`postfx.reset()`, a resize, the switch on, flight mode left, a layer changed);
//      per pixel, its weight falls as its point moves over a trace pixel a frame, and goes where its cloud distance changed by
//      over a tenth or its ray now ends elsewhere (a roof gone from in front of the sky).
//   4. **Flight mode** (`flightStep`): flying or aboard a ship inside a deck, or within 300 m of one climbing or falling faster
//      than 30 m/s, the whole trace is marched each frame at a smaller size and nothing is reused; pods never enter it.
//   5. **The motion** (`motionGraph`): the clouds' own motion (each pixel's cloud point moved by its drift and the camera)
//      laid over the scene's motion by what the cloud covers, into a target the scene's size the edge smoothing reads in place
//      of the scene's own motion on a frame the clouds drew (`TAA_MOTION_IN`), its reactive mark raised under cloud.
//
// The rules the node tests hold are written here once as numbers (`subPixelOf`, `flightStep`, `historyUvInto`) beside the
// graphs that are their card form. Nothing here is loaded on the WebGL path.

import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { chainMaterial, graph, type ChainGraph } from '../../core/gpu/gpuChain.ts';
import { liveTexture } from '../../core/gpu/gpuGround.ts';
import { preRatioNode } from '../exposure/preExpose.ts';
import { CLOUD_LAYER_MAX, CLOUD_LAYER_VEC4 } from './cloudLayers.ts';
import { CLOUD_TUNE } from './cloudTune.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, If, abs, clamp, float, floor, ivec2, length, max, min, mix, normalize, outputStruct, select, smoothstep, sqrt, struct, texture, transpose, uniform, uv, vec2, vec3, vec4, renderGroup } = TSL as Any;

/** What the fill-in has done, for `__debug.clouds()` and the tests. */
export const CLOUD_REUSE_STATS = { resolved: 0, resets: 0, flightFrames: 0, fullFrames: 0, motionDrawn: 0, flightEntered: 0 };

/** The trace's distances are kept in kilometres (a storm's 80 km reach is past a half float's 65,504). */
export const DIST_UNIT = 0.001;

// ---------------------------------------------------------------- the rules as numbers (the node tests' twins of the graphs)

/** The order a two by two tile's pixels are marched in, frame by frame (0 top left, 1 top right, 2 bottom left, 3 bottom right). */
export const TILE_ORDER: readonly number[] = [0, 3, 1, 2];

/**
 * Which pixel of a two by two tile the march takes this frame: `phase` the frame's 0 to 11, (`qx`, `qy`) the tile, `d` the four
 * pixels' scene distances (the sky any number past the reach), `match` the depth match's share. With no depth edge in the tile,
 * the frame's order (`TILE_ORDER`) offset by two on every other tile (a checkerboard); across an edge, even frames take the
 * far side and odd the near (a tile's checkerboard turning which), each side's pixels in turn. The march's graph is this rule.
 */
export function subPixelOf(phase: number, qx: number, qy: number, d: ArrayLike<number>, match: number): number {
  const checker = (qx + qy) & 1;
  let lo = d[0];
  let hi = d[0];
  for (let i = 1; i < 4; i++) {
    if (d[i] < lo) lo = d[i];
    if (d[i] > hi) hi = d[i];
  }
  const edge = hi - lo > lo * match + 2;
  if (!edge) return TILE_ORDER[(phase + 2 * checker) & 3];
  const mid = (lo + hi) * 0.5;
  const wantFar = ((phase + checker) & 1) === 0 ? 1 : 0;
  let n = 0;
  for (let i = 0; i < 4; i++) if ((d[i] > mid ? 1 : 0) === wantFar) n++;
  const k = (phase >> 1) + checker;
  const m = k - n * Math.floor(k / n);
  let seen = 0;
  let pick = 0;
  for (let i = 0; i < 4; i++) {
    const c = (d[i] > mid ? 1 : 0) === wantFar ? 1 : 0;
    if (c === 1 && seen === m) pick = i;
    seen += c;
  }
  return pick;
}

/** What flight mode keeps between frames (made once by the pass; `flightStep` writes it in place). */
export interface FlightState {
  on: boolean;
  /** Seconds its reason has been gone while still on. */
  gone: number;
  /** The camera's height last frame, metres, and whether there was one. */
  lastY: number;
  has: boolean;
  /** Metres a second up (+) or down, last worked. */
  vy: number;
}

export function newFlightState(): FlightState {
  return { on: false, gone: 0.5, lastY: 0.5, has: false, vy: 0.5 };
}

/**
 * Flight mode this frame (the design's 2.2): a ship flown or boarded (`ship`; a pod or a speeder never) whose camera stands inside
 * a drawn layer's band, or within `flightNear` of one while climbing or falling faster than `flightClimb`; held `flightHold`
 * seconds after its reason has gone. `stack` the packed stack (`count` slots). Writes `s` in place; answers whether it is on.
 */
export function flightStep(s: FlightState, ship: boolean, camY: number, dt: number, stack: Float32Array | null, count: number): boolean {
  const T = CLOUD_TUNE;
  if (s.has && dt > 1e-4) s.vy = (camY - s.lastY) / dt;
  else s.vy = 0;
  s.lastY = camY;
  s.has = true;
  let reason = false;
  if (ship && stack) {
    const V = CLOUD_LAYER_VEC4 * 4;
    const fast = s.vy > T.flightClimb || s.vy < -T.flightClimb;
    for (let i = 0; i < count && i < CLOUD_LAYER_MAX; i++) {
      const o = i * V;
      // A drawn layer: on with a type, a density and some cover now (the contract's s1.w, s0.z and s2.w).
      if (!(stack[o + 7] > 0) || !(stack[o + 2] > 0) || !(stack[o + 11] > 0)) continue;
      const lo = stack[o];
      const hi = stack[o + 1];
      if (camY >= lo && camY <= hi) reason = true;
      else if (fast && camY >= lo - T.flightNear && camY <= hi + T.flightNear) reason = true;
    }
  }
  if (!ship) {
    s.on = false;
    s.gone = 0;
  } else if (reason) {
    s.on = true;
    s.gone = 0;
  } else if (s.on) {
    s.gone += dt > 0 ? dt : 0;
    if (s.gone > T.flightHold) s.on = false;
  }
  return s.on;
}

/** Forget the last height (a cut, a travel): the next frame's climb is not worked across it. */
export function flightForget(s: FlightState): void {
  s.has = false;
  s.vy = 0;
}

/**
 * Where a trace pixel's cloud stood on last frame's screen (the resolve's and the motion's rule, in numbers): the pixel at `ndc`
 * (x right, y up) looking along the camera's turn `turn` (a Matrix3's column-major elements, camera to world) with half-angle
 * tangents `tan`, its cloud `dist` metres away drifting at (`vx`, `vz`) m/s, the camera moved by `dc` (now less last frame's,
 * metres) in `dt` seconds, seen by last frame's turn `prevTurn` and tangents `prevTan`. Into `out` as [u, v] (rows from the top),
 * and answers whether it stood in front of last frame's camera.
 */
export function historyUvInto(out: Float64Array | number[], ndcX: number, ndcY: number, turn: ArrayLike<number>, tan: ArrayLike<number>, dist: number, vx: number, vz: number, dt: number, dc: ArrayLike<number>, prevTurn: ArrayLike<number>, prevTan: ArrayLike<number>): boolean {
  const lx = ndcX * tan[0];
  const ly = ndcY * tan[1];
  const lz = -1;
  const t = turn;
  let wx = t[0] * lx + t[3] * ly + t[6] * lz;
  let wy = t[1] * lx + t[4] * ly + t[7] * lz;
  let wz = t[2] * lx + t[5] * ly + t[8] * lz;
  const n = Math.sqrt(wx * wx + wy * wy + wz * wz);
  wx /= n;
  wy /= n;
  wz /= n;
  // The point last frame, from last frame's camera: where it is now, less its drift, plus the camera's own move.
  const px = wx * dist - vx * dt + dc[0];
  const py = wy * dist + dc[1];
  const pz = wz * dist - vz * dt + dc[2];
  const p = prevTurn;
  const cx = p[0] * px + p[1] * py + p[2] * pz;
  const cy = p[3] * px + p[4] * py + p[5] * pz;
  const cz = p[6] * px + p[7] * py + p[8] * pz;
  const front = cz < -1e-3;
  const iz = front ? -1 / cz : 0;
  const nx = cx * iz / prevTan[0];
  const ny = cy * iz / prevTan[1];
  out[0] = nx * 0.5 + 0.5;
  out[1] = 0.5 - ny * 0.5;
  return front;
}

/** The history's weight left for a point moving `px` trace pixels a frame (the design's "falls as its point moves over a trace pixel"). */
export function motionShareOf(px: number): number {
  const T = CLOUD_TUNE;
  const a = T.motionFrom;
  const b = T.motionTo > a + 1e-3 ? T.motionTo : a + 1e-3;
  const x = px <= a ? 0 : px >= b ? 1 : (px - a) / (b - a);
  const s = x * x * (3 - 2 * x);
  return 1 + (T.motionKeep - 1) * s;
}

// ---------------------------------------------------------------- the kept numbers the graphs read

/**
 * Every number the resolve and the motion read beside the march's (`CLOUD_U`), each a vector or matrix written in place once a
 * frame, every field begun as a fraction.
 */
export interface CloudReuseUniforms {
  /** (the quarter update on 1, the frame's phase 0 to 11, reset 1, the frame's seconds). */
  ru: THREE.Vector4;
  /** The quarter target's (width, height), the trace's (width, height). */
  qs: THREE.Vector4;
  /** (the camera's move since last frame, x, y, z, metres; 0). */
  dc: THREE.Vector4;
  /** (last frame's half-angle tangents x and y, 0, 0). */
  pt: THREE.Vector4;
  /** Last frame's camera turn (its world matrix's upper three rows and columns). */
  prevTurn: THREE.Matrix3;
  /** (history, clamp widen, motion from, motion to), (motion keep, distance change, reactive, depth match), (flight's history, 0, 0, 0). */
  rd0: THREE.Vector4;
  rd1: THREE.Vector4;
  rd2: THREE.Vector4;
  /** The picture the composite and the motion read: (its width, its height, 0, 0). */
  ct: THREE.Vector4;
}

export function newReuseUniforms(): CloudReuseUniforms {
  const v = (): THREE.Vector4 => new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  return { ru: v(), qs: v(), dc: v(), pt: v(), prevTurn: new THREE.Matrix3().set(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5), rd0: v(), rd1: v(), rd2: v(), ct: v() };
}

/** The session's one set (every chain's pass reads the same objects). */
export const CLOUD_RU: CloudReuseUniforms = newReuseUniforms();

/** The fill-in's dials into their vectors (a frame's, in place), field by field. */
export function writeReuseDials(u: CloudReuseUniforms): void {
  const T = CLOUD_TUNE;
  const a = u.rd0;
  a.x = T.history;
  a.y = T.clampWiden;
  a.z = T.motionFrom;
  a.w = T.motionTo > T.motionFrom + 1e-3 ? T.motionTo : T.motionFrom + 1e-3;
  const b = u.rd1;
  b.x = T.motionKeep;
  b.y = T.distChange;
  b.z = T.reactive;
  b.w = T.depthMatch;
  u.rd2.x = T.flightHistory;
}

/**
 * The edge smoothing's motion for this frame where another pass laid its own over the scene's (the clouds), and the frame it is
 * for: the smoothing's pass reads it in its `prepare` (after the clouds' pass has drawn), else the scene's own motion.
 */
export { TAA_MOTION_IN } from '../../core/gpu/taa/taaGraphs.ts';

// ---------------------------------------------------------------- the graphs' shared parts

/** A view ray's way in the world for a place `ndc` on the screen, by the camera turn `turn` (a mat3 node) and tangents `tan`. */
export function rayDirOf(ndc: Any, turn: Any, tan: Any): Any {
  return normalize(turn.mul(vec3(ndc.x.mul(tan.x), ndc.y.mul(tan.y), -1)));
}

/** A texel's place on the screen in normalised device coordinates (x right, y up) from its texture coordinate (rows from the top). */
export function ndcAt(st: Any): Any {
  return vec2(st.x.mul(2).sub(1), float(1).sub(st.y.mul(2)));
}

/**
 * Last frame's screen place (uv, rows from the top) of the cloud along `dir` at `distM` metres drifting at `vel` (m/s, x and z),
 * and its distance from last frame's camera, and whether it stood in front of it: `historyUvInto`'s graph.
 */
export function historyUvOf(dir: Any, distM: Any, vel: Any, R: { ru: Any; dc: Any; pt: Any; prevTurn: Any }): { uv: Any; dist: Any; front: Any } {
  const dt = R.ru.w;
  const p = dir.mul(distM).sub(vec3(vel.x, 0, vel.y).mul(dt)).add(R.dc.xyz).toVar();
  const c = transpose(R.prevTurn).mul(p).toVar();
  const front = c.z.lessThan(-1e-3);
  const iz = float(-1).div(min(c.z, -1e-3));
  const n = vec2(c.x.mul(iz).div(R.pt.x), c.y.mul(iz).div(R.pt.y));
  return { uv: vec2(n.x.mul(0.5).add(0.5), float(0.5).sub(n.y.mul(0.5))), dist: length(p), front };
}

/** The scene's depth at a texel made a view distance, reversed or not (the march's own rule). */
function viewZ(d: Any, near: Any, far: Any, reversed: boolean): Any {
  return reversed ? near.mul(far).div(near.add(d.mul(far.sub(near)))) : near.mul(far).div(far.sub(d.mul(far.sub(near))));
}
function skyDepth(d: Any, reversed: boolean): Any {
  return reversed ? d.lessThanEqual(0) : d.greaterThanEqual(1);
}
function rayLengthOf(z: Any, ndc: Any, p1: Any): Any {
  const vx = ndc.x.mul(p1.x);
  const vy = ndc.y.mul(p1.y);
  return z.mul(sqrt(float(1).add(vx.mul(vx)).add(vy.mul(vy))));
}

/**
 * Where a trace texel's ray ends, metres: the farthest of the four scene pixels round its middle (the sky's, the reach), held to
 * the reach (`t1.y`); the march's own rule, so the resolve's depth match is the march's.
 */
export function traceRayEndOf(depth: Any, st: Any, ndc: Any, p0: Any, p1: Any, t1: Any, reversed: boolean, tag: string): Any {
  const q = floor(st.mul(p1.zw).sub(0.5));
  const far = float(0).toVar(`swgCloud${tag}Far`);
  for (let j = 0; j <= 1; j++) {
    for (let i = 0; i <= 1; i++) {
      const at = ivec2(clamp(q.add(vec2(i, j)), vec2(0), p1.zw.sub(1)));
      const dz = float(depth.load(at).x);
      far.assign(max(far, select(skyDepth(dz, reversed), float(1e9), rayLengthOf(viewZ(dz, p0.x, p0.y, reversed), ndc, p1))));
    }
  }
  return min(far, t1.y);
}

/**
 * The trace under a picture pixel at `st` whose own distance is `distM` (the composite's and the motion's read): the four nearest
 * texels of the trace (`size` its texels) by the bilinear weights times how near each texel's ray end is to the pixel's distance,
 * or where none is near, the nearest in distance whole. Answers the cloud's light and what gets through (rgba), its mean distance
 * in metres, and its drift (m/s, x and z).
 */
export function traceTapsOf(tl: Any, td: Any, size: Any, st: Any, distM: Any, match: Any, tag: string): { tr: Any; meanD: Any; vel: Any } {
  const tc = st.mul(size).sub(0.5);
  const q = floor(tc);
  const f = tc.sub(q);
  const acc = vec4(0).toVar(`swgCloud${tag}Acc`);
  const accD = vec3(0).toVar(`swgCloud${tag}AccD`);
  const wsum = float(0).toVar(`swgCloud${tag}W`);
  const best = float(1e30).toVar(`swgCloud${tag}Best`);
  const bestL = vec4(0, 0, 0, 1).toVar(`swgCloud${tag}BL`);
  const bestD = vec3(0).toVar(`swgCloud${tag}BD`);
  const distK = distM.mul(DIST_UNIT);
  const tol = distK.mul(match).add(2 * DIST_UNIT).toVar(`swgCloud${tag}Tol`);
  for (let j = 0; j <= 1; j++) {
    for (let i = 0; i <= 1; i++) {
      const at = ivec2(clamp(q.add(vec2(i, j)), vec2(0), size.sub(1)));
      const a = vec4(tl.load(at)).toVar(`swgCloud${tag}A${i}${j}`);
      const b = vec4(td.load(at)).toVar(`swgCloud${tag}B${i}${j}`);
      const bw = (i === 0 ? float(1).sub(f.x) : f.x).mul(j === 0 ? float(1).sub(f.y) : f.y);
      const gap = abs(b.y.sub(distK));
      const k = gap.div(tol);
      const w = bw.div(float(1).add(k.mul(k).mul(16))).add(1e-6).toVar(`swgCloud${tag}Wt${i}${j}`);
      acc.addAssign(a.mul(w));
      accD.addAssign(vec3(b.x, b.z, b.w).mul(w));
      wsum.addAssign(w);
      If(gap.lessThan(best), () => {
        best.assign(gap);
        bestL.assign(a);
        bestD.assign(vec3(b.x, b.z, b.w));
      });
    }
  }
  const matched = best.lessThan(tol);
  const tr = select(matched, acc.div(max(wsum, 1e-6)), bestL).toVar(`swgCloud${tag}Tr`);
  const dd = select(matched, accD.div(max(wsum, 1e-6)), bestD).toVar(`swgCloud${tag}DD`);
  return { tr, meanD: dd.x.div(DIST_UNIT), vel: dd.yz };
}

// ---------------------------------------------------------------- the resolve

/**
 * What the resolve reads: the march's three pictures this frame (by `{ value }`: the quarter under the fill-in, the whole trace
 * at its smaller size in flight mode), last frame's history (two, swapped each frame), the scene's depth.
 */
export interface ResolveSources {
  quarter: { light: { value: THREE.Texture | null }; dist: { value: THREE.Texture | null }; pick: { value: THREE.Texture | null } };
  history: { light: { value: THREE.Texture | null }; dist: { value: THREE.Texture | null } };
  depth: THREE.Texture;
  reversed: boolean;
}

/** The march's kept vectors the resolve reads too (`CLOUD_U`'s p0, p1, turn, tr, t1), handed as nodes by the march's maker. */
export interface MarchNodes {
  p0: Any;
  p1: Any;
  turn: Any;
  tr: Any;
  t1: Any;
}

const RESOLVE_OUT = struct({ light: 'vec4', dist: 'vec4' });

function halfFallback(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.needsUpdate = true;
  return t;
}

/** The reuse's vectors as nodes, made once a graph. */
function reuseNodes(u: CloudReuseUniforms): { ru: Any; qs: Any; dc: Any; pt: Any; prevTurn: Any; rd0: Any; rd1: Any; rd2: Any; ct: Any } {
  const g = (v: unknown): Any => uniform(v as never).setGroup(renderGroup);
  return { ru: g(u.ru), qs: g(u.qs), dc: g(u.dc), pt: g(u.pt), prevTurn: g(u.prevTurn), rd0: g(u.rd0), rd1: g(u.rd1), rd2: g(u.rd2), ct: g(u.ct) };
}

/**
 * The resolve: the trace-sized history from this frame's quarter and last frame's history (two outputs: the cloud's light and
 * what gets through; its mean distance and ray end in kilometres and its drift). Drawn into the history target not read.
 */
export function resolveGraph(m0: MarchNodes, u: CloudReuseUniforms, s: ResolveSources): ChainGraph {
  const R = reuseNodes(u);
  const m = chainMaterial('fx.gpu.clouds.resolve');
  (m as Any).swgRawOut = true;
  const ql = liveTexture(s.quarter.light, halfFallback());
  const qd = liveTexture(s.quarter.dist, halfFallback());
  const qi = liveTexture(s.quarter.pick, halfFallback());
  const hl = liveTexture(s.history.light, halfFallback());
  const hd = liveTexture(s.history.dist, halfFallback());
  const depth = texture(s.depth);
  const out = Fn(() => {
    const size = m0.tr.xy;
    const p = floor(uv().mul(size)).toVar('swgCloudRP');
    const st = p.add(0.5).div(size).toVar('swgCloudRSt');
    const ndc = ndcAt(st).toVar('swgCloudRNdc');
    const dir = rayDirOf(ndc, m0.turn, m0.p1).toVar('swgCloudRDir');
    // This texel's own ray end now (kilometres), as the march finds it.
    const re = traceRayEndOf(depth, st, ndc, m0.p0, m0.p1, m0.t1, s.reversed, 'R').mul(DIST_UNIT).toVar('swgCloudRRe');
    // Under the fill-in (`ru.x` 1) the march's texel under this one is its two by two's; in flight mode (0) the whole trace at
    // its smaller size (`qs.xy`), whose texel under this one's middle every texel takes, none of them its own.
    const quarter = R.ru.x.greaterThan(0.5);
    const q = select(quarter, floor(p.mul(0.5)), floor(st.mul(R.qs.xy))).toVar('swgCloudRQ');
    const own = p.x.sub(floor(p.x.mul(0.5)).mul(2)).add(p.y.sub(floor(p.y.mul(0.5)).mul(2)).mul(2)).toVar('swgCloudROwn');
    const scale = size.div(R.qs.xy).toVar('swgCloudRScale');
    const tol = re.mul(R.rd1.w).add(2 * DIST_UNIT).toVar('swgCloudRTol');
    const lo = vec4(1e30).toVar('swgCloudRLo');
    const hi = vec4(-1e30).toVar('swgCloudRHi');
    // The new rays' cloud distances round it (kilometres), the box a history's own distance must lie in.
    const dLo = float(1e30).toVar('swgCloudRDLo');
    const dHi = float(-1e30).toVar('swgCloudRDHi');
    const acc = vec4(0).toVar('swgCloudRAcc');
    const accD = vec4(0).toVar('swgCloudRAccD');
    const ws = float(0).toVar('swgCloudRWs');
    const best = float(1e30).toVar('swgCloudRBest');
    const bestA = vec4(0, 0, 0, 1).toVar('swgCloudRBA');
    const bestB = vec4(0).toVar('swgCloudRBB');
    const selfA = vec4(0, 0, 0, 1).toVar('swgCloudRSA');
    const selfB = vec4(0).toVar('swgCloudRSB');
    const isNew = float(0).toVar('swgCloudRNew');
    const qMax = R.qs.xy.sub(1);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const qn = clamp(q.add(vec2(i, j)), vec2(0), qMax);
        const at = ivec2(qn);
        const a = vec4(ql.load(at)).toVar(`swgCloudRA${i + 1}${j + 1}`);
        const b = vec4(qd.load(at)).toVar(`swgCloudRB${i + 1}${j + 1}`);
        const k = float(qi.load(at).x).toVar(`swgCloudRK${i + 1}${j + 1}`);
        const ky = floor(k.mul(0.5).add(0.25));
        // Where its ray stood, in this texel's own units: its two by two's marched pixel, or the whole trace texel's middle.
        const pn = select(quarter, qn.mul(2).add(vec2(k.sub(ky.mul(2)), ky)), qn.add(0.5).mul(scale).sub(0.5));
        const gap = abs(b.y.sub(re));
        const dd = pn.sub(p);
        const wd = float(1).div(float(1).add(dd.dot(dd)));
        If(gap.lessThan(tol), () => {
          lo.assign(min(lo, a));
          hi.assign(max(hi, a));
          dLo.assign(min(dLo, b.x));
          dHi.assign(max(dHi, b.x));
          acc.addAssign(a.mul(wd));
          accD.addAssign(b.mul(wd));
          ws.addAssign(wd);
        });
        If(gap.lessThan(best), () => {
          best.assign(gap);
          bestA.assign(a);
          bestB.assign(b);
        });
        if (i === 0 && j === 0) {
          selfA.assign(a);
          selfB.assign(b);
          isNew.assign(select(quarter.and(abs(k.sub(own)).lessThan(0.5)), float(1), float(0)));
        }
      }
    }
    const any = ws.greaterThan(0);
    const fresh = isNew.greaterThan(0.5);
    const C = select(fresh, selfA, select(any, acc.div(max(ws, 1e-9)), bestA)).toVar('swgCloudRC');
    const CB = select(fresh, selfB, select(any, accD.div(max(ws, 1e-9)), bestB)).toVar('swgCloudRCB');
    // Where its cloud stood last frame: its point at its mean distance, moved back by its drift and the camera's move.
    const h = historyUvOf(dir, CB.x.div(DIST_UNIT), CB.zw, R);
    const huv = vec2(h.uv).toVar('swgCloudRHuv');
    const H = vec4(hl.sample(huv).level(0)).toVar('swgCloudRH');
    const HD = vec4(hd.sample(huv).level(0)).toVar('swgCloudRHD');
    // Last frame's light was stored at last frame's pre-exposure: brought to this frame's (the edge smoothing's own way).
    const Hn = vec4(H.rgb.mul(preRatioNode()), H.a).toVar('swgCloudRHn');
    const onPic = huv.greaterThanEqual(vec2(0)).all().and(huv.lessThanEqual(vec2(1)).all());
    const dm = h.dist.toVar('swgCloudRDm');
    // The history's cloud distance held to the new rays' round it, widened by the share (the design's tenth): one ray's own
    // distance is no measure, since in a sky of several layers one ray through a gap ends tens of kilometres past its
    // neighbour's, and a test against it alone threw the history away on noise and wrote the outlier whole. With no new ray of
    // its depth round it, its own reprojected distance (`dm`) is the measure.
    const hk = HD.x.toVar('swgCloudRHk');
    const boxOk = hk.greaterThanEqual(dLo.mul(float(1).sub(R.rd1.y)).sub(DIST_UNIT)).and(hk.lessThanEqual(dHi.mul(float(1).add(R.rd1.y)).add(DIST_UNIT)));
    const distOk = select(ws.greaterThan(0), boxOk, abs(hk.div(DIST_UNIT).sub(dm)).lessThan(dm.mul(R.rd1.y).add(1)));
    const endOk = abs(HD.y.sub(re)).lessThan(re.mul(R.rd1.y).add(length(R.dc.xyz).mul(DIST_UNIT)).add(2 * DIST_UNIT));
    const held = onPic.and(h.front).and(distOk).and(endOk).and(R.ru.z.lessThan(0.5));
    const motionPx = length(huv.sub(st).mul(size));
    const keep = mix(float(1), R.rd1.x, smoothstep(R.rd0.z, R.rd0.w, motionPx));
    // Held to the box of the new rays round it that share its depth, widened by a share of the box.
    const ext = hi.sub(lo).mul(R.rd0.y).add(1e-6);
    const Hc = select(any, clamp(Hn, lo.sub(ext), hi.add(ext)), Hn);
    const w = select(held, keep, float(0));
    // A marched pixel keeps `history` of its history; in flight mode every pixel is new from the whole trace and keeps only
    // flight's own short history (`rd2.x`), so a climb at speed lets go within a few frames.
    const wNew = select(fresh, w.mul(R.rd0.x), select(quarter, w, w.mul(R.rd2.x))).toVar('swgCloudRW');
    const light = mix(C, Hc, wNew);
    const meanK = mix(CB.x, HD.x, wNew);
    return RESOLVE_OUT(light, vec4(meanK, re, CB.z, CB.w));
  })().toConst();
  m.fragmentNode = outputStruct(out.get('light'), out.get('dist'));
  return graph(m, 6, { uniforms: { ...R }, textures: { quarterLight: ql, quarterDist: qd, quarterPick: qi, historyLight: hl, historyDist: hd, depth } });
}

// ---------------------------------------------------------------- the motion

/** What the motion reads: the scene's own motion buffer and depth, and the trace the composite reads (swapped each frame). */
export interface MotionSources {
  motion: THREE.Texture;
  depth: THREE.Texture;
  light: { value: THREE.Texture | null };
  dist: { value: THREE.Texture | null };
  reversed: boolean;
}

/**
 * The clouds' motion over the scene's (a picture the scene's size): each pixel's cloud point (its mean distance, its drift, the
 * camera's move) seen by last frame's camera gives its own motion, laid over the scene's by what the cloud covers (one less what
 * gets through); the scene's change of distance kept; the reactive mark the larger of the scene's and the cloud's.
 */
export function motionGraph(m0: MarchNodes, u: CloudReuseUniforms, s: MotionSources): ChainGraph {
  const R = reuseNodes(u);
  const m = chainMaterial('fx.gpu.clouds.motion');
  m.blending = THREE.NoBlending;
  m.transparent = false;
  (m as Any).swgRawOut = true;
  const mot = texture(s.motion);
  const depth = texture(s.depth);
  const tl = liveTexture(s.light, halfFallback());
  const td = liveTexture(s.dist, halfFallback());
  m.fragmentNode = Fn(() => {
    const st = uv();
    const px = ivec2(st.mul(m0.p1.zw));
    const mv = vec4(mot.load(px)).toVar('swgCloudMMv');
    const dz = float(depth.load(px).x);
    const ndc = ndcAt(st).toVar('swgCloudMNdc');
    const dist = min(select(skyDepth(dz, s.reversed), m0.t1.y, rayLengthOf(viewZ(dz, m0.p0.x, m0.p0.y, s.reversed), ndc, m0.p1)), m0.t1.y);
    const t = traceTapsOf(tl, td, R.ct.xy, st, dist, R.rd1.w, 'M');
    const dir = rayDirOf(ndc, m0.turn, m0.p1);
    const h = historyUvOf(dir, max(t.meanD, 1), t.vel, R);
    const prevNdc = vec2(h.uv.x.mul(2).sub(1), float(1).sub(h.uv.y.mul(2)));
    const cmv = select(h.front, ndc.sub(prevNdc), mv.xy);
    const cover = clamp(float(1).sub(t.tr.w), 0, 1);
    // The reactive mark only where the trace was marched whole (flight mode, or the fill-in off): there the clouds keep no
    // history of their own and the smoothing's is the only one to smear; under the fill-in their own history has gathered the
    // grain, and a mark there would only stop the smoothing gathering the rest.
    const react = cover.mul(R.rd1.z).mul(float(1).sub(R.ru.x));
    return vec4(mix(mv.xy, cmv, cover), mv.z, max(mv.w, react));
  })();
  return graph(m, 4, { uniforms: { ...R }, textures: { motion: mot, depth, traceLight: tl, traceDist: td } });
}
