// The clouds' march and its composite on WebGPU (the GPU port's pass 3, wave 1, maker V; the design's 2.2): the owner's
// layers marched as volumes through pass 2's air, every trace pixel each frame for now (wave 2 adds the quarter update, the
// reprojection and the flight mode), behind the switch that starts off (`cloudTune.ts`'s `CLOUD_DRAW`).
//
//   1. **The march** (one full-screen draw into the trace, half the display's width and height, capped by a ray budget,
//      `traceSizeOf`): each trace pixel's ray from the lens, through the scene's depth (the farthest of the scene's pixels
//      under it: mountains, ships and rooftops cut it; indoors the walls stop it), walking only the height bands of the layers
//      that are on (the contract's `band`s, sorted and merged), jumping the gaps between them, stepped finely over the first
//      kilometre and by its distance's share past it, grown over clear map, ended at 1% transmittance or the reach. At each
//      sample every layer whose band holds it is read from the map (`CloudMapFace.sample`) and shaped (`cloudShape.ts`'s
//      `shapeOf`, the one function), and where there is cloud it is lit (`cloudLight.ts`: six light steps in a cone and one far
//      along the air's light, the bodies through the air's transmittance at the sample's own height, the sky's ambient).
//      Out: the cloud's light (stored pre-exposed, the scene's units times `pre`) and what gets through it, and the cloud's
//      mean distance (weighted by what each step took) beside the ray's end.
//   2. **The composite** (one full-screen draw, after the haze pass and before the edge smoothing): each pixel takes the trace
//      by its four nearest texels weighed by how near each texel's ray end is to its own depth (so a roof's edge keeps its
//      own), the cloud hazed at its mean distance by the haze pass's own rule (`airTerms`), and lays it over the picture:
//      the solid as hazed times what gets through the cloud, plus the cloud; the see-through layer (bolts, smoke, glass) laid
//      back over the cloud, since that layer keeps no distance (the design's 2.2).
//
// Not drawn in a space zone, under water, on SWG's Sky row (not registered there), or with the switch off: then the pass is
// not on and the frame is the base's. Nothing here is loaded on the WebGL path.

import * as THREE from 'three';
import * as TSL from 'three/tsl';
import type { FxFrameContext } from '../../core/fx/context.ts';
import { FX_CAMERA, type FxPass, type FxWarmItem } from '../../core/fx/pass.ts';
import type { FxPassId, FxProductId, FxSettings } from '../../core/fxRegistry.ts';
import { CHAIN_NUMBERS, chainMaterial, graph, storedOf, type ChainGraph } from '../../core/gpu/gpuChain.ts';
import { liveTexture } from '../../core/gpu/gpuGround.ts';
import { withTargetDepth } from '../../core/gpu/warmDepth.ts';
import { AIR } from '../air/airApi.ts';
import { airTerms } from '../air/airHaze.ts';
import { seeTextureOf } from '../air/airSee.ts';
import { PRE_FIXED } from '../exposure/preExpose.ts';
import { CLOUD_LAYER_MAX, CLOUD_LAYER_VEC4, CLOUD_TYPE_TUNE, type CloudMapFace, type CloudTypeId } from './cloudLayers.ts';
import { CLOUD_LOOK, shapeOf, type ShapeOps } from './cloudShape.ts';
import { LIGHT_STEPS, ambientShareOf, octavesOf, powderOf, stepLightOf, type LightOps } from './cloudLight.ts';
import { CLOUD_DRAW, CLOUD_FEED, CLOUD_STEPS_MOST, CLOUD_TUNE, cloudsWhyNot, cloudsWouldDraw, traceSizeOf } from './cloudTune.ts';
import { cloudNoise, type CloudNoise } from './cloudNoise.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Break, Fn, If, Loop, abs, clamp, dot, exp, float, floatBitsToUint, floor, fract, int, interleavedGradientNoise, ivec2, max, min, mix, normalize, outputStruct, pow, renderGroup, select, smoothstep, sqrt, struct, texture, texture3D, uint, uniform, uniformArray, uv, vec2, vec3, vec4 } = TSL as Any;

/** What the march has done, for `__debug.clouds()` and the tests. */
export const CLOUD_MARCH_STATS = { built: 0, drawn: 0, skipped: 0, compiles: 0, landed: 0 };

// ---------------------------------------------------------------- the operations over three's shading language

/** The shape's operations over nodes: the march's graph is `shapeOf` itself, handed these. */
export const SHAPE_NODE: ShapeOps<Any> = {
  k: (v) => float(v),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  div: (a, b) => a.div(b),
  min: (a, b) => min(a, b),
  max: (a, b) => max(a, b),
  pow: (a, b) => pow(a, b),
  clamp01: (a) => clamp(a, 0, 1),
  smoothstep: (e0, e1, x) => smoothstep(e0, e1, x),
  mix: (a, b, t) => mix(a, b, t),
};

/** The light's operations over nodes. */
export const LIGHT_NODE: LightOps<Any> = {
  k: (v) => float(v),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  div: (a, b) => a.div(b),
  max: (a, b) => max(a, b),
  exp: (a) => exp(a),
  sqrt: (a) => sqrt(a),
  mix: (a, b, t) => mix(a, b, t),
};

// ---------------------------------------------------------------- the kept numbers the graphs read

/**
 * Every number the march and the composite read, each a vector or a matrix written in place once a frame (a double written
 * into a uniform's `value` is a number made each write: `webgpu.md`), in the shared render group, every field begun as a
 * fraction (a field begun as a whole number boxes every fraction written after it).
 */
export interface CloudMarchUniforms {
  /** (near, far, the camera's world y, the camera's height over the air's datum in km). */
  p0: THREE.Vector4;
  /** (tan of the half field of view times the aspect, tan of the half field of view, the scene's width, its height). */
  p1: THREE.Vector4;
  /** The frame camera's turn (its world matrix's upper three rows and columns). */
  turn: THREE.Matrix3;
  /** (the trace's width, its height, the frame's jitter phase 0 to 1, the jitter on). */
  tr: THREE.Vector4;
  /** (steps, near step, near reach, grow), (far step, reach, light reach, least transmittance), (clear grow, depth match, 0, 0). */
  t0: THREE.Vector4;
  t1: THREE.Vector4;
  t2: THREE.Vector4;
  /** The look: (sigma, erosion, edge hard, edge soft), (wispy band, shape tile, detail tile, curl), (forward, back, forward share, albedo), (octave extinction, light, phase, powder), (powder depth, ambient, belly, cone). */
  l0: THREE.Vector4;
  l1: THREE.Vector4;
  l2: THREE.Vector4;
  l3: THREE.Vector4;
  l4: THREE.Vector4;
  /** (carve, tallness, taper from, anvil power), (anvil from, anvil to, bite, soft bite): the shape's windows, each a dial (the fixer's). */
  l5: THREE.Vector4;
  l6: THREE.Vector4;
  /** The light march's way (the air's `lightDir`: the sun by day, the moon by night), w 0. */
  light: THREE.Vector4;
  /**
   * Each layer's noise frame: (the shape tile's offset along its streak axis, across it, the detail tile's along, across), each
   * a share of its tile, worked on the main thread in double precision from the camera and the layer's full drift, so nothing
   * measured from the world's middle reaches the card; (the vertical offsets of the shape and the detail, the streak axis's
   * cosine and sine); (the streak, 0, 0, 0).
   */
  off: THREE.Vector4[];
  off2: THREE.Vector4[];
  streak: THREE.Vector4[];
}

function newUniforms(): CloudMarchUniforms {
  const v = (): THREE.Vector4 => new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  const each = (): THREE.Vector4[] => Array.from({ length: CLOUD_LAYER_MAX }, v);
  return {
    p0: v(),
    p1: v(),
    turn: new THREE.Matrix3().set(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5),
    tr: v(),
    t0: v(),
    t1: v(),
    t2: v(),
    l0: v(),
    l1: v(),
    l2: v(),
    l3: v(),
    l4: v(),
    l5: v(),
    l6: v(),
    light: v(),
    off: each(),
    off2: each(),
    streak: each(),
  };
}

/** The session's one set (every chain's pass reads the same objects). */
export const CLOUD_U: CloudMarchUniforms = newUniforms();

/**
 * The look's and the march's dials into their vectors (a frame's, in place), field by field: a vector's `set` hands its
 * numbers across a call the compiler may leave out, each a number made.
 */
export function writeDials(u: CloudMarchUniforms): void {
  const T = CLOUD_TUNE;
  const L = CLOUD_LOOK;
  const t0 = u.t0;
  t0.x = T.steps;
  t0.y = T.nearStep;
  t0.z = T.nearReach;
  t0.w = T.grow;
  const t1 = u.t1;
  t1.x = T.farStep;
  t1.y = T.reach;
  t1.z = T.lightReach;
  t1.w = T.minTransmittance;
  u.t2.x = T.clearGrow;
  u.t2.y = T.depthMatch;
  const l0 = u.l0;
  l0.x = L.sigma;
  l0.y = L.erosion;
  l0.z = L.edgeHard;
  l0.w = L.edgeSoft;
  const l1 = u.l1;
  l1.x = L.wispyBand;
  l1.y = L.shapeTile;
  l1.z = L.detailTile;
  l1.w = L.curl;
  const l2 = u.l2;
  l2.x = L.forward;
  l2.y = L.back;
  l2.z = L.forwardShare;
  l2.w = L.albedo;
  const l3 = u.l3;
  l3.x = L.octaveExtinction;
  l3.y = L.octaveLight;
  l3.z = L.octavePhase;
  l3.w = L.powder;
  const l4 = u.l4;
  l4.x = L.powderDepth;
  l4.y = L.ambient;
  l4.z = L.belly;
  l4.w = L.cone;
  const l5 = u.l5;
  l5.x = L.carve;
  l5.y = L.tallness;
  l5.z = L.taperFrom;
  l5.w = L.anvilPower;
  const l6 = u.l6;
  l6.x = L.anvilFrom;
  l6.y = L.anvilTo;
  l6.z = L.bite;
  l6.w = L.softBite;
}

/**
 * A layer's streak (its types' `stretch` weighed by their shares) and its axis (radians: a fixed angle of its own from its
 * seed and its `turn`, never the wind's heading, which wanders: an axis that turned would sweep the whole field about the
 * drift's origin). Into `out` at `at` as [stretch, angle]. Allocates nothing.
 */
export function streakInto(types: readonly string[], shares: readonly number[], seed: number, turnDeg: number, out: Float64Array, at: number): void {
  let s = 0;
  let w = 0;
  for (let i = 0; i < types.length; i++) {
    const p = CLOUD_TYPE_TUNE[types[i] as CloudTypeId];
    if (!p) continue;
    const k = shares[i] > 0 ? shares[i] : 0;
    s += p.stretch * k;
    w += k;
  }
  out[at] = w > 0 ? s / w : 1;
  out[at + 1] = ((seed % 3600) / 3600) * Math.PI + (turnDeg * Math.PI) / 180;
}

/** `x` modulo `m` into [0, m), in double precision. */
export function wrapInto(x: number, m: number): number {
  const r = x - Math.floor(x / m) * m;
  return r >= m || r < 0 ? 0 : r;
}

/**
 * Each layer's noise frame, in double precision, into `u.off`, `u.off2`, `u.streak`: the camera less the layer's FULL drift,
 * turned onto the layer's streak axis and its along-axis divided by its streak, taken modulo each noise's tile, plus a share
 * of the tile from the layer's seed (so two layers of one type are not one cloud). The card then adds only the sample's place
 * from the camera, turned and divided alike, so a sample's noise coordinate is the same function of its world place in every
 * browser, whatever the camera. `streaks` holds each layer's [stretch, angle]. Allocates nothing.
 */
export function writeOffsets(u: CloudMarchUniforms, stack: Float32Array, count: number, drift: Float64Array | null, streaks: Float64Array, cam: { readonly x: number; readonly z: number }): void {
  // The camera's place read off its own vector here (two numbers handed across the call would be two numbers made).
  const camX = cam.x;
  const camZ = cam.z;
  const V = CLOUD_LAYER_VEC4 * 4;
  const dt = CLOUD_LOOK.detailTile;
  for (let i = 0; i < CLOUD_LAYER_MAX; i++) {
    const on = i < count;
    // The shape noise's tile follows the layer's cell size (the look's tile is a cumulus's of 1,600 m), held to a power of two
    // so the drift's wrap never jumps it: small-celled types (altocumulus, cirrocumulus) take billows to their own scale.
    const cell = on ? stack[i * V + 16] : 1600;
    const raw = CLOUD_LOOK.shapeTile * (cell > 1 ? cell : 1) / 1600;
    const p2 = Math.round(Math.log2(raw > 256 ? raw : 256));
    const st = 2 ** (p2 < 14 ? p2 : 14);
    const s0 = on ? streaks[i * 2] : 1;
    const s = s0 > 0.05 ? s0 : 0.05;
    const a = on ? streaks[i * 2 + 1] : 0;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    // The full drift where the map's maker hands it; the contract's wrapped one otherwise (a streaked layer would then jump
    // once each time the wrap turns over).
    const dx = on ? (drift ? drift[i * 4] : stack[i * V + 12]) : 0;
    const dz = on ? (drift ? drift[i * 4 + 1] : stack[i * V + 13]) : 0;
    const x = camX - dx;
    const z = camZ - dz;
    const along = (x * c + z * sn) / s;
    const across = z * c - x * sn;
    const seed = on ? stack[i * V + 19] : 0;
    // Each fraction worked in line (`v − floor(v)`): a number handed back from a helper the compiler leaves out is one made.
    const ax = seed * 0.6180339887;
    const az = seed * 0.4142135624;
    const ay = seed * 0.7320508076;
    const sx = ax - Math.floor(ax);
    const sz = az - Math.floor(az);
    const sy = ay - Math.floor(ay);
    const off = u.off[i];
    const v0 = along / st + sx;
    const v1 = across / st + sz;
    off.x = v0 - Math.floor(v0);
    off.y = v1 - Math.floor(v1);
    // The detail's frame is turned off the vertical (DETAIL_TURN), so its tile's repeat never stacks as rings up a tower: its
    // offset is the turn of the camera's place less the drift (the vertical measured from each layer's own base needs none).
    const R = DETAIL_TURN;
    const ad = along / dt;
    const cd = across / dt;
    const v2 = R[0] * ad + R[2] * cd + sz;
    const v4 = R[3] * ad + R[5] * cd + sy * 1.7;
    const v3 = R[6] * ad + R[8] * cd + sx;
    off.z = v2 - Math.floor(v2);
    off.w = v3 - Math.floor(v3);
    const o2 = u.off2[i];
    o2.x = sy;
    o2.y = v4 - Math.floor(v4);
    o2.z = c;
    o2.w = sn;
    const sk = u.streak[i];
    sk.x = s;
    sk.y = st;
  }
}

/**
 * The detail noise's frame turned off the world's axes (rows of a rotation, by 0.7 radians about a slanted axis): a tower's wall
 * meets the detail's tile along a slanted line, whose repeat is long, where an upright tile stacked the same frays every
 * 256 m up a nine-kilometre cumulonimbus as rings. Not a dial: the noise's frame.
 */
export const DETAIL_TURN: readonly number[] = (() => {
  const ax = [0.6, 0.48, 0.64];
  const n = Math.hypot(ax[0], ax[1], ax[2]);
  const [x, y, z] = [ax[0] / n, ax[1] / n, ax[2] / n];
  const a = 0.7;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = 1 - c;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
})();

// ---------------------------------------------------------------- the density at a point

/** The graph's readers, built once a graph. */
interface Reads {
  face: CloudMapFace;
  shape: Any;
  detail: Any;
  curl: Any;
  off: Any;
  off2: Any;
  streak: Any;
  l0: Any;
  l1: Any;
  l5: Any;
  l6: Any;
}

/**
 * The cloud at a point `p` (metres from the camera, vec3) whose world height is `y`, as a function of the program: every layer
 * whose band holds it read from the map and shaped, their extinctions summed. Answers vec4(extinction per metre, the height
 * share it was weighed at, the most map cover met, 0). `detail` false leaves the detail volume unread (the light march's cheap
 * samples, the erosion at its middle). Every picture is read at a named level, so it may run inside the march's loops.
 */
function densityFn(R: Reads, detail: boolean): Any {
  const face = R.face;
  const tag = detail ? 'V' : 'L';
  return Fn(([p, y]: Any[]) => {
    const sigma = float(0).toVar(`swgCloud${tag}Sig`);
    const hw = float(0).toVar(`swgCloud${tag}Hw`);
    const cov = float(0).toVar(`swgCloud${tag}Cov`);
    const layers = int(face.frame.x);
    Loop({ start: int(0), end: layers, type: 'int', condition: '<', name: 'li' }, ({ li }: Any) => {
      const s0 = vec4(face.slot(li, 0)).toVar(`swgCloud${tag}S0`);
      const s1 = vec4(face.slot(li, 1)).toVar(`swgCloud${tag}S1`);
      If(s1.w.greaterThan(0.5).and(y.greaterThan(s0.x)).and(y.lessThan(s0.y)), () => {
        const m = vec4(face.sample(li, p)).toVar(`swgCloud${tag}M`);
        cov.assign(max(cov, m.x));
        If(m.x.greaterThan(1e-3), () => {
          const h = y.sub(s0.x).div(max(s0.y.sub(s0.x), 1)).toVar(`swgCloud${tag}H`);
          const w = vec3(face.weights(li, m.y)).toVar(`swgCloud${tag}W`);
          const ta = int(s1.x);
          const tb = int(s1.y);
          const tc = int(s1.z);
          const blend = (k: number): Any => vec4(face.typeSlot(ta, k)).mul(w.x).add(vec4(face.typeSlot(tb, k)).mul(w.y)).add(vec4(face.typeSlot(tc, k)).mul(w.z));
          const q0 = blend(0).toVar(`swgCloud${tag}P0`);
          const q1 = blend(1).toVar(`swgCloud${tag}P1`);
          const q2 = blend(2).toVar(`swgCloud${tag}P2`);
          // The types' column in the layer (`ShapeProfile.reach`): the blended thickness over the tallest of the three slots'.
          const reach = q2.w.div(max(max(vec4(face.typeSlot(ta, 2)).w, vec4(face.typeSlot(tb, 2)).w), max(vec4(face.typeSlot(tc, 2)).w, 1))).toVar(`swgCloud${tag}Reach`);
          // The layer's noise frame: its streak axis turned, its along-axis divided by its streak, its offsets the main thread's.
          const o = vec4(R.off.element(li)).toVar(`swgCloud${tag}O`);
          const o2 = vec4(R.off2.element(li)).toVar(`swgCloud${tag}O2`);
          const sk = vec4(R.streak.element(li)).x;
          const along = p.x.mul(o2.z).add(p.z.mul(o2.w)).div(sk).toVar(`swgCloud${tag}Al`);
          const across = p.z.mul(o2.z).sub(p.x.mul(o2.w)).toVar(`swgCloud${tag}Ac`);
          const up = y.sub(s0.x);
          const sTile = vec4(R.streak.element(li)).y;
          const suv = vec3(along.div(sTile).add(o.x), up.div(sTile.mul(R.l5.y)).add(o2.x), across.div(sTile).add(o.y)).toVar(`swgCloud${tag}Suv`);
          const low = vec4(R.shape.sample(suv).level(0)).toVar(`swgCloud${tag}Low`);
          let det: Any;
          if (detail) {
            // The curl turns the detail's samples about, most at the base, none at the top.
            const dTile = R.l1.z;
            const cu = vec4(R.curl.sample(suv.xz.mul(4)).level(0)).xy.mul(2).sub(1);
            const bend = R.l1.w.mul(float(1).sub(h));
            const da = along.add(cu.x.mul(bend)).div(dTile);
            const du = up.div(dTile);
            const dc = across.add(cu.y.mul(bend)).div(dTile);
            const T3 = DETAIL_TURN;
            const duv = vec3(da.mul(T3[0]).add(du.mul(T3[1])).add(dc.mul(T3[2])).add(o.z), da.mul(T3[3]).add(du.mul(T3[4])).add(dc.mul(T3[5])).add(o2.y), da.mul(T3[6]).add(du.mul(T3[7])).add(dc.mul(T3[8])).add(o.w));
            det = vec4(R.detail.sample(duv).level(0)).toVar(`swgCloud${tag}Det`);
          } else det = vec4(0.5, 0.5, 0.5, 1);
          const d = shapeOf(
            SHAPE_NODE,
            { h, cover: m.x, top: m.w, edge: s0.w, layerDensity: s0.z, low0: low.x, low1: low.y, low2: low.z, low3: low.w, det0: det.x, det1: det.y, det2: det.z },
            { rise: q0.x, fallFrom: q0.y, fallTo: q0.z, anvil: q0.w, billow: q1.y, erosion: q1.z, taper: q2.z, density: q2.x, reach },
            { sigma: R.l0.x, erosion: R.l0.y, edgeHard: R.l0.z, edgeSoft: R.l0.w, wispyBand: R.l1.x, carve: R.l5.x, taperFrom: R.l5.z, anvilFrom: R.l6.x, anvilTo: R.l6.y, anvilPower: R.l5.w, bite: R.l6.z, softBite: R.l6.w },
          );
          const dd = float(d).toVar(`swgCloud${tag}D`);
          sigma.addAssign(dd);
          hw.addAssign(dd.mul(h));
        });
      });
    });
    return vec4(sigma, hw.div(max(sigma, 1e-9)), cov, 0);
  }).setLayout({ name: detail ? 'swgCloudDensity' : 'swgCloudDensityLight', type: 'vec4', inputs: [{ name: 'p', type: 'vec3' }, { name: 'y', type: 'float' }] });
}

// ---------------------------------------------------------------- the march's graph

/** The scene's depth at a texel made a view distance (`airHazeMath.ts`'s `viewZOfDepth`), reversed or not. */
function viewZ(d: Any, near: Any, far: Any, reversed: boolean): Any {
  return reversed ? near.mul(far).div(near.add(d.mul(far.sub(near)))) : near.mul(far).div(far.sub(d.mul(far.sub(near))));
}

/**
 * Whether a depth texel is the clear: a pixel where nothing solid was drawn is the sky, never a surface at the far plane (the
 * September march's second bug: its deck 1.5 km up was already 8.6 km away at ten degrees, past a 9 km far plane).
 */
function skyDepth(d: Any, reversed: boolean): Any {
  return reversed ? d.lessThanEqual(0) : d.greaterThanEqual(1);
}

/** A texel's place on the screen in normalised device coordinates (x right, y up) from its texture coordinate (rows from the top). */
function ndcOf(st: Any): Any {
  return vec2(st.x.mul(2).sub(1), float(1).sub(st.y.mul(2)));
}

/** A view ray's length to a view depth `z` at a place `ndc`, for the view's extents `p1.xy`. */
function rayLengthOf(z: Any, ndc: Any, p1: Any): Any {
  const vx = ndc.x.mul(p1.x);
  const vy = ndc.y.mul(p1.y);
  return z.mul(sqrt(float(1).add(vx.mul(vx)).add(vy.mul(vy))));
}

/** The march's two outputs: the light and what gets through (rgba), and the distances (mean cloud, ray end). */
const TRACE_OUT = struct({ light: 'vec4', dist: 'vec4' });

/** A value that is not a number or is infinite (the f32's exponent field filled: WGSL has no `isnan` that holds). */
const notFinite = (x: Any): Any => floatBitsToUint(x).bitAnd(uint(0x7f800000)).equal(uint(0x7f800000));

/** What a march graph reads beside the kept numbers: the scene's depth, the noise, the map's face. */
export interface MarchSources {
  depth: THREE.Texture;
  reversed: boolean;
  noise: CloudNoise;
  face: CloudMapFace;
}

/** The farthest distance a half float of the trace's distance output keeps, metres. */
const FAR_KEPT = 60000;

/**
 * The march (the full-screen draw into the trace). Every picture read inside its loops is at a named level; its loop is built
 * to `CLOUD_STEPS_MOST` and walks `CLOUD_TUNE.steps` of it, so a change of steps builds nothing.
 */
export function marchGraph(u: CloudMarchUniforms, s: MarchSources): ChainGraph {
  const tables = AIR.tables;
  if (!tables) throw new Error('the clouds march through the air: its tables must exist first');
  CLOUD_MARCH_STATS.built++;
  const m = chainMaterial('fx.gpu.clouds.march');
  // Two outputs, carried through no output of three's (the haze's terms' way).
  (m as Any).swgRawOut = true;
  const g = (v: unknown): Any => uniform(v as never).setGroup(renderGroup);
  const P0 = g(u.p0);
  const P1 = g(u.p1);
  const TURN = g(u.turn);
  const TR = g(u.tr);
  const T0 = g(u.t0);
  const T1 = g(u.t1);
  const T2 = g(u.t2);
  const L0 = g(u.l0);
  const L1 = g(u.l1);
  const L2 = g(u.l2);
  const L3 = g(u.l3);
  const L4 = g(u.l4);
  const L5 = g(u.l5);
  const L6 = g(u.l6);
  const LIGHT = g(u.light);
  const OFF = uniformArray(u.off, 'vec4').setGroup(renderGroup);
  const OFF2 = uniformArray(u.off2, 'vec4').setGroup(renderGroup);
  const STREAK = uniformArray(u.streak, 'vec4').setGroup(renderGroup);
  const depth = texture(s.depth);
  const shape = texture3D(s.noise.shape);
  const detail = texture3D(s.noise.detail);
  const curl = texture(s.noise.curl);
  const R: Reads = { face: s.face, shape, detail, curl, off: OFF, off2: OFF2, streak: STREAK, l0: L0, l1: L1, l5: L5, l6: L6 };
  const dens = densityFn(R, true);
  const densL = densityFn(R, false);
  const n = tables.nodes;
  const look = { forward: L2.x, back: L2.y, forwardShare: L2.z, octaveExtinction: L3.x, octaveLight: L3.y, octavePhase: L3.z, powder: L3.w, powderDepth: L4.x };
  const face = s.face;
  const out = Fn(() => {
    const st = uv();
    // The ray: its way in the world (the camera's turn of its view direction), from the lens.
    const ndc = ndcOf(st).toVar('swgCloudNdc');
    const dir = normalize(TURN.mul(vec3(ndc.x.mul(P1.x), ndc.y.mul(P1.y), -1))).toVar('swgCloudDir');
    // The scene under this trace pixel: the farthest of the four scene pixels round its middle (the sky's, if any), so a ray
    // over a roof's edge is marched to the sky and the composite's depth match gives the roof its own.
    const q = floor(st.mul(P1.zw).sub(0.5));
    const far = float(0).toVar('swgCloudFar');
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= 1; i++) {
        const at = ivec2(clamp(q.add(vec2(i, j)), vec2(0), P1.zw.sub(1)));
        const dz = float(depth.load(at).x);
        const dist = select(skyDepth(dz, s.reversed), float(1e9), rayLengthOf(viewZ(dz, P0.x, P0.y, s.reversed), ndc, P1));
        far.assign(max(far, dist));
      }
    }
    const maxT = min(far, T1.y).toVar('swgCloudMaxT');
    const camY = P0.z;
    // The bands along the ray: each one's stretch of it (t0, t1), empty where the band is not or the ray misses it.
    const bands = int(face.frame.y);
    const iv: Any[] = [];
    const tEnter = float(1e9).toVar('swgCloudTIn');
    const tExit = float(-1).toVar('swgCloudTOut');
    const dy = select(abs(dir.y).lessThan(1e-5), select(dir.y.lessThan(0), float(-1e-5), float(1e-5)), dir.y).toVar('swgCloudDy');
    for (let b = 0; b < CLOUD_LAYER_MAX; b++) {
      const band = vec4(face.band(int(b))).toVar(`swgCloudB${b}`);
      const ta = band.x.sub(camY).div(dy);
      const tb = band.y.sub(camY).div(dy);
      const a0 = max(min(ta, tb), 0);
      const a1 = min(max(ta, tb), maxT);
      const ok = int(b).lessThan(bands).and(a1.greaterThan(a0));
      const v = vec2(select(ok, a0, float(1e9)), select(ok, a1, float(-1))).toVar(`swgCloudIv${b}`);
      iv.push(v);
      tEnter.assign(min(tEnter, v.x));
      tExit.assign(max(tExit, v.y));
    }
    // Each step's jitter (interleaved gradient noise over the trace's pixels, its phase moving each frame; a step's middle with it off).
    const jit = select(TR.w.greaterThan(0.5), fract(interleavedGradientNoise(st.mul(TR.xy)).add(TR.z)), float(0.5)).toVar('swgCloudJit');
    // The light: the air's numbers this frame, the ambient about the sky at the camera, the multiple scattering at the camera.
    const Ldir = normalize(LIGHT.xyz).toVar('swgCloudLDir');
    const sunAz = normalize(vec3(n.sunDir.x, 0, n.sunDir.z).add(vec3(1e-4, 0, 0))).toVar('swgCloudSunAz');
    const ambTop = vec3(tables.skyRadiance(vec3(0, 1, 0)))
      .add(vec3(tables.skyRadiance(normalize(sunAz.add(vec3(0, 0.15, 0))))))
      .add(vec3(tables.skyRadiance(normalize(sunAz.negate().add(vec3(0, 0.15, 0))))))
      .mul(1 / 3)
      .toVar('swgCloudAmb');
    const msCamL = dot(vec3(tables.multiScatterAt(P0.w, n.sunDir.y)), vec3(1 / 3)).toVar('swgCloudMsCam');
    const stored = storedOf().toVar('swgCloudStored');
    const T = float(1).toVar('swgCloudT');
    const L = vec3(0).toVar('swgCloudL');
    const dSum = float(0).toVar('swgCloudDSum');
    const wSum = float(0).toVar('swgCloudWSum');
    const grow = float(1).toVar('swgCloudGrow');
    const t = float(tEnter).toVar('swgCloudTT');
    const steps = int(T0.x);
    If(tEnter.lessThan(tExit), () => {
      Loop({ start: int(0), end: int(CLOUD_STEPS_MOST), type: 'int', condition: '<', name: 'cs' }, ({ cs }: Any) => {
        If(cs.greaterThanEqual(steps).or(t.greaterThanEqual(tExit)).or(T.lessThan(T1.w)), () => {
          Break();
        });
        // Inside a band, or jumped to the next one's start along the ray (the gaps between layers cost no step).
        const inBand = float(0).toVar('swgCloudIn');
        const next = float(1e9).toVar('swgCloudNext');
        const bandEnd = float(1e9).toVar('swgCloudEnd');
        for (const v of iv) {
          If(t.greaterThanEqual(v.x).and(t.lessThan(v.y)), () => {
            inBand.assign(1);
            bandEnd.assign(min(bandEnd, v.y));
          });
          If(v.x.greaterThan(t), () => {
            next.assign(min(next, v.x));
          });
        }
        If(inBand.lessThan(0.5), () => {
          If(next.greaterThan(1e8), () => {
            Break();
          });
          t.assign(next);
          for (const v of iv) {
            If(t.greaterThanEqual(v.x).and(t.lessThan(v.y)), () => {
              bandEnd.assign(min(bandEnd, v.y));
            });
          }
        });
        // The step: fine over the first kilometre, its distance's share past it, grown over clear map.
        const base = select(t.lessThan(T0.z), T0.y, clamp(t.mul(T0.w), T0.y, T1.x));
        const ds0 = min(base.mul(grow), T1.x);
        const ds = max(min(ds0, bandEnd.sub(t)), 0.5).toVar('swgCloudDs');
        // Each step's sample jittered within its own stretch (a pixel's own fraction, moving each frame): a sample at each step's
        // middle sliced an opaque tower into stacked discs a step apart, which no jitter of the first step alone broke up.
        const tm = t.add(ds.mul(jit)).toVar('swgCloudTm');
        const p = dir.mul(tm).toVar('swgCloudP');
        const y = camY.add(p.y).toVar('swgCloudY');
        const d = vec4(dens(p, y)).toVar('swgCloudDen');
        const sig = d.x;
        If(sig.greaterThan(1e-7), () => {
          grow.assign(1);
          // The light march: six steps in a cone toward the light and one far, the cheap density (no detail) at each.
          const tau = float(0).toVar('swgCloudTau');
          let prevEnd = 0;
          for (let k = 0; k < LIGHT_STEPS.ends.length; k++) {
            const e = LIGHT_STEPS.ends[k];
            const mid = (prevEnd + e) * 0.5;
            const len = e - prevEnd;
            prevEnd = e;
            const kv = LIGHT_STEPS.kernel[k];
            const dist = T1.z.mul(mid);
            const lp = p.add(Ldir.mul(dist)).add(vec3(kv[0], kv[1], kv[2]).mul(dist.mul(L4.w))).toVar(`swgCloudLp${k}`);
            tau.addAssign(vec4(densL(lp, camY.add(lp.y))).x.mul(T1.z.mul(len)));
          }
          // Each body's light at the sample's own height through the air, through the cloud by the light march's depth.
          const hKm = max(y.mul(0.001), 0.001).toVar('swgCloudHKm');
          const lit = (dirB: Any, top: Any, tag: string): Any => {
            const ta = vec3(tables.transmittanceAt(hKm, dirB.y)).toVar(`swgCloudTa${tag}`);
            return top.mul(ta).mul(octavesOf(LIGHT_NODE, look, tau, dot(dir, dirB)));
          };
          const Ls = lit(n.sunDir, n.sunTop, 'S').add(lit(n.sun2Dir, n.sun2Top, 'S2')).add(lit(n.moonDir, n.moonTop, 'M')).toVar('swgCloudLs');
          const powder = powderOf(LIGHT_NODE, look, sig, dot(dir, Ldir));
          const ms = dot(vec3(tables.multiScatterAt(hKm, n.sunDir.y)), vec3(1 / 3));
          const amb = ambTop.mul(ambientShareOf(LIGHT_NODE, ms, msCamL, d.y, L4.z)).mul(L4.y);
          const S = Ls.mul(powder).add(amb).mul(L2.w).toVar('swgCloudS');
          const add = stepLightOf(LIGHT_NODE, S, sig, ds);
          const Tn = T.mul(exp(sig.mul(ds).negate())).toVar('swgCloudTn');
          L.addAssign(add.mul(T));
          dSum.addAssign(tm.mul(T.sub(Tn)));
          wSum.addAssign(T.sub(Tn));
          T.assign(Tn);
        }).Else(() => {
          // Over clear map the step grows (where a band holds the point and its map has no cover at all), up to the longest.
          grow.assign(min(grow.mul(select(d.z.lessThan(1e-3), T2.x, float(1))), 8));
        });
        t.addAssign(ds);
      });
    });
    const endD = min(maxT, T1.y);
    const meanD = select(wSum.greaterThan(1e-4), dSum.div(max(wSum, 1e-9)), endD);
    const light = min(L.mul(stored), vec3(PRE_FIXED.cap));
    const bad = notFinite(light.x).or(notFinite(light.y)).or(notFinite(light.z)).or(notFinite(T));
    return TRACE_OUT(select(bad, vec4(0, 0, 0, 1), vec4(light, clamp(T, 0, 1))), vec4(min(meanD, FAR_KEPT), min(endD, FAR_KEPT), 0, 1));
  })().toConst();
  m.fragmentNode = outputStruct(out.get('light'), out.get('dist'));
  return graph(m, 8, { uniforms: { p0: P0, p1: P1, turn: TURN, tr: TR, t0: T0, t1: T1, t2: T2, l0: L0, l1: L1, l2: L2, l3: L3, l4: L4, light: LIGHT }, textures: { depth, shape, detail, curl } });
}

// ---------------------------------------------------------------- the composite's graph

/** What the composite reads: the picture coming in, the trace's two pictures, the scene's depth and its see-through layer. */
export interface CompositeSources {
  input: { value: THREE.Texture | null };
  trace: THREE.RenderTarget;
  depth: THREE.Texture;
  see: THREE.Texture;
  reversed: boolean;
}

function halfFallback(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * The composite: each pixel's trace from its four nearest texels by the bilinear weights times how near each texel's ray end
 * is to the pixel's own distance (where none is near, the nearest in distance whole), the cloud hazed at its mean distance by
 * the haze pass's rule, laid over the picture with the see-through layer back over it. Opaque, writing its alpha as one (a
 * full-screen pass writes its target outright: the September march's first bug was an alpha read as coverage), and keeping
 * the picture wherever anything is not a number.
 */
export function compositeGraph(u: CloudMarchUniforms, s: CompositeSources): ChainGraph {
  const tables = AIR.tables;
  if (!tables) throw new Error('the clouds composite through the air: its tables must exist first');
  CLOUD_MARCH_STATS.built++;
  const m = chainMaterial('fx.gpu.clouds.composite');
  m.blending = THREE.NoBlending;
  m.transparent = false;
  const g = (v: unknown): Any => uniform(v as never).setGroup(renderGroup);
  const P0 = g(u.p0);
  const P1 = g(u.p1);
  const TURN = g(u.turn);
  const TR = g(u.tr);
  const T1 = g(u.t1);
  const T2 = g(u.t2);
  const input = liveTexture(s.input, halfFallback());
  const tl = texture(s.trace.textures[0]);
  const td = texture(s.trace.textures[1]);
  const depth = texture(s.depth);
  const see = texture(s.see);
  // The march's view, read once a render (a small whole number written, never boxed).
  const VIEW = int(uniform(0).setGroup(renderGroup).onRenderUpdate(() => CLOUD_DRAW.view));
  m.fragmentNode = Fn(() => {
    const st = uv();
    const px = ivec2(st.mul(P1.zw));
    // Every read at the top, before anything branches.
    const c = vec4(input.sample(st)).toVar('swgCloudCC');
    const sv = vec4(see.load(px)).toVar('swgCloudCS');
    If(notFinite(sv.x).or(notFinite(sv.y)).or(notFinite(sv.z)).or(notFinite(sv.w)), () => {
      sv.assign(vec4(0, 0, 0, 1));
    });
    const dz = float(depth.load(px).x).toVar('swgCloudCD');
    const ndc = ndcOf(st).toVar('swgCloudCNdc');
    const dist = min(select(skyDepth(dz, s.reversed), T1.y, rayLengthOf(viewZ(dz, P0.x, P0.y, s.reversed), ndc, P1)), T1.y).toVar('swgCloudCDist');
    // The trace is sampled at its own size: its coordinates are the pixel's share of the screen times the trace's texels (the
    // September march's third bug read a half-size product's taps at every size).
    const tc = st.mul(TR.xy).sub(0.5);
    const q = floor(tc);
    const f = tc.sub(q);
    const acc = vec4(0).toVar('swgCloudCAcc');
    const accD = float(0).toVar('swgCloudCAccD');
    const wsum = float(0).toVar('swgCloudCW');
    const best = float(1e30).toVar('swgCloudCBest');
    const bestL = vec4(0, 0, 0, 1).toVar('swgCloudCBL');
    const bestD = float(0).toVar('swgCloudCBD');
    const tol = dist.mul(T2.y).add(2).toVar('swgCloudCTol');
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= 1; i++) {
        const at = ivec2(clamp(q.add(vec2(i, j)), vec2(0), TR.xy.sub(1)));
        const a = vec4(tl.load(at)).toVar(`swgCloudCA${i}${j}`);
        const b = vec4(td.load(at)).toVar(`swgCloudCB${i}${j}`);
        const bw = (i === 0 ? float(1).sub(f.x) : f.x).mul(j === 0 ? float(1).sub(f.y) : f.y);
        const gap = abs(b.y.sub(dist));
        const k = gap.div(tol);
        const w = bw.div(float(1).add(k.mul(k).mul(16))).add(1e-6).toVar(`swgCloudCWt${i}${j}`);
        acc.addAssign(a.mul(w));
        accD.addAssign(b.x.mul(w));
        wsum.addAssign(w);
        If(gap.lessThan(best), () => {
          best.assign(gap);
          bestL.assign(a);
          bestD.assign(b.x);
        });
      }
    }
    const matched = best.lessThan(tol);
    const tr = select(matched, acc.div(max(wsum, 1e-6)), bestL).toVar('swgCloudCTr');
    const meanD = select(matched, accD.div(max(wsum, 1e-6)), bestD).toVar('swgCloudCMean');
    // The cloud hazed at its mean distance by the haze pass's own rule (the volume to 24 km, the sky view and the far rule
    // past it), the air's light stood in the stored picture's units; what the air adds laid in the share the cloud covers.
    const a = airTerms(tables, ndc, max(meanD, 1), P1, TURN, 'Cloud');
    const Tc = clamp(tr.w, 0, 1).toVar('swgCloudCTc');
    const cloud = tr.rgb.mul(a.t).add(a.l.mul(storedOf()).mul(float(1).sub(Tc)));
    // The solid as the haze pass left it, less the see-through layer it laid back, times what gets through the cloud; then the
    // cloud; then the layer over it.
    const solid = max(c.rgb.sub(sv.rgb), vec3(0));
    const outC = solid.mul(Tc).add(cloud).add(sv.rgb).toVar('swgCloudCOut');
    // The console's views (`setMarchView`), in the stored picture's units so the eye shows them grey: the mean distance, what gets through.
    If(VIEW.equal(1), () => {
      outC.assign(vec3(clamp(meanD.div(T1.y), 0, 1)).mul(storedOf()));
    }).ElseIf(VIEW.equal(2), () => {
      outC.assign(vec3(Tc).mul(storedOf()));
    });
    const bad = notFinite(outC.x).or(notFinite(outC.y)).or(notFinite(outC.z));
    return vec4(clamp(select(bad, c.rgb, outC), vec3(0), vec3(CHAIN_NUMBERS.sanitize.stored)), 1);
  })();
  return graph(m, 5, { uniforms: { p0: P0, p1: P1, turn: TURN, tr: TR, t1: T1, t2: T2 }, textures: { input, traceLight: tl, traceDist: td, depth, see } });
}

// ---------------------------------------------------------------- the pass

/** Every pass made and not yet let go of, newest last: the console's word on what draws. */
const LIVE: GpuCloudPass[] = [];
export function cloudPassNow(): GpuCloudPass | null {
  return LIVE.length > 0 ? LIVE[LIVE.length - 1] : null;
}

/**
 * The map's face and its readiness, handed by the map's maker (`cloudMapGpu.ts`): the face, whether its pipelines have landed
 * and its map is drawn, and its frame (the map rewritten for this camera, called by the march just before it draws). Null
 * until it is handed.
 */
export const CLOUD_FACE: { face: CloudMapFace | null; ready: () => boolean; frame: ((camera: THREE.PerspectiveCamera) => void) | null } = {
  face: null,
  ready: () => false,
  frame: null,
};

/**
 * The trace the march drew last (its colour picture, whose alpha is what gets through the cloud), for the lens flare's read at
 * the sun's pixel (`gpuFlare.ts`); null until a march has drawn. The flare reads it only on a frame the march drew.
 */
export const CLOUD_TRACE: { value: THREE.Texture | null } = { value: null };

/** A target of a chain buffer's own kind (half floats, no depth, no stencil): the composite is compiled against it in play. */
const WARM_BUFFER = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0 });

/**
 * The clouds' pass (the registry's `clouds`, after the haze and before the edge smoothing), registered by the WebGPU chain's
 * spine under our sky alone. With the switch off it makes nothing and is never on, so the frame and its pipelines are the
 * base's; on, it builds its graphs off the frame (the noise's computes, the march against its trace and the composite against
 * a chain buffer's kind, each compiled before its first draw), bakes the noise a slab a frame, and draws once all has landed.
 */
export class GpuCloudPass implements FxPass {
  readonly id: FxPassId = 'clouds';
  readonly timerLabel = 'pass:clouds';
  private readonly renderer: Any;
  private readonly sceneTarget: THREE.RenderTarget;
  private readonly see: THREE.Texture | null;
  private readonly input = { value: null as THREE.Texture | null };
  /** The trace: the cloud's light and transmittance, and its distances (two half-float outputs). */
  readonly trace: THREE.RenderTarget;
  private marchG: ChainGraph | null = null;
  private compG: ChainGraph | null = null;
  private building: Promise<void> | null = null;
  private landed = false;
  private noise: CloudNoise | null = null;
  private readonly size = new Int32Array(2);
  private readonly streaks = new Float64Array(CLOUD_LAYER_MAX * 2);
  private streakVersion = -1;
  private frameNo = 0;
  /** Whether it drew last frame, and why not where it did not (for the console). */
  drewLast = false;
  whyNot: string | null = 'off';

  constructor(renderer: Any, sceneTarget: THREE.RenderTarget) {
    this.renderer = renderer;
    this.sceneTarget = sceneTarget;
    this.see = seeTextureOf(sceneTarget.texture);
    const t = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0, count: 2 });
    t.textures[0].name = 'fx.gpu.clouds.trace';
    t.textures[1].name = 'fx.gpu.clouds.traceDistance';
    for (const x of t.textures) {
      x.minFilter = THREE.NearestFilter;
      x.magFilter = THREE.NearestFilter;
      x.generateMipmaps = false;
    }
    this.trace = t;
    LIVE.push(this);
  }

  /** The trace's colour picture (its alpha what gets through the cloud: the flare reads it at the sun's pixel). */
  get traceTexture(): THREE.Texture {
    return this.trace.textures[0];
  }

  /** Whether the graphs are made (a warm-up item there to hand). */
  get built(): boolean {
    return this.marchG !== null && this.compG !== null;
  }

  /**
   * The graphs made and compiled, once the switch is on and the air's tables and the map's face exist: off the frame, each
   * `compileAsync` asked with its own target set and the renderer's depth and stencil flags that target's (`withTargetDepth`),
   * the old target put back at once; the noise's computes beside them.
   */
  private build(): void {
    if (this.building || !this.see || !AIR.tables || !CLOUD_FACE.face) return;
    const r = this.renderer;
    this.noise = cloudNoise(r);
    const reversed = r.reversedDepthBuffer === true;
    const depth = this.sceneTarget.depthTexture as THREE.Texture;
    this.marchG = marchGraph(CLOUD_U, { depth, reversed, noise: this.noise, face: CLOUD_FACE.face });
    this.compG = compositeGraph(CLOUD_U, { input: this.input, trace: this.trace, depth, see: this.see, reversed });
    const jobs: Promise<unknown>[] = [this.noise.compile()];
    const prev = r.getRenderTarget();
    try {
      for (const [into, g] of [
        [this.trace, this.marchG],
        [WARM_BUFFER, this.compG],
      ] as const) {
        r.setRenderTarget(into);
        jobs.push(Promise.resolve(withTargetDepth(r, () => r.compileAsync(g.mesh, FX_CAMERA))).catch(() => {}));
      }
    } finally {
      r.setRenderTarget(prev);
    }
    CLOUD_MARCH_STATS.compiles++;
    this.building = Promise.all(jobs).then(() => {
      this.landed = true;
      CLOUD_MARCH_STATS.landed++;
    });
  }

  /** Whether everything is built and baked; asks for what is not (a slab of the noise a frame). Allocates nothing once built. */
  private progress(): boolean {
    if (!CLOUD_DRAW.want) return false;
    if (!this.see) {
      CLOUD_DRAW.waiting = 'the scene target carries no see-through layer (the motion output off at load)';
      return false;
    }
    if (!AIR.tables || !AIR.tables.ready) {
      CLOUD_DRAW.waiting = "the air's tables (our sky over a planet)";
      return false;
    }
    if (!CLOUD_FACE.face) {
      CLOUD_DRAW.waiting = "the map's face (cloudMapGpu.ts)";
      return false;
    }
    this.build();
    if (!this.landed) {
      CLOUD_DRAW.waiting = "the march's pipelines (compiling off the frame)";
      return false;
    }
    if (!this.noise!.bakeStep()) {
      CLOUD_DRAW.waiting = 'the noise (a slab a frame)';
      return false;
    }
    if (!CLOUD_FACE.ready()) {
      CLOUD_DRAW.waiting = "the map's pipelines";
      return false;
    }
    CLOUD_DRAW.waiting = '';
    return true;
  }

  /** The bake whole behind a loading screen (the world's arrival, with the switch on): answers once it is. */
  async bakeBehindScreen(): Promise<void> {
    if (!CLOUD_DRAW.want) return;
    this.build();
    if (this.building) await this.building;
    if (this.noise) await this.noise.bakeAll();
  }

  enabled(ctx: FxFrameContext): boolean {
    CLOUD_DRAW.ready = this.progress();
    // Under water is the camera really below the surface (cameraSubmerged, what anything that draws reads), never the safe
    // answer with its margin (cameraUnderwater, true in plain air near water: the march stood down over Mos Eisley's street).
    const draws = cloudsWouldDraw(ctx.space, ctx.cameraSubmerged, AIR.frame.on && AIR.tables !== null && AIR.tables.ready);
    if (!draws) {
      // Why, in words, only when the console asks (`reason`): a word made each frame is a string made each frame.
      this.drewLast = false;
      CLOUD_DRAW.drew = false;
      if (CLOUD_DRAW.want) CLOUD_MARCH_STATS.skipped++;
    }
    return draws;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_NEEDS;
  }

  reason(ctx: FxFrameContext): string | null {
    return cloudsWhyNot(ctx.space, ctx.cameraSubmerged, AIR.frame.on && AIR.tables !== null && AIR.tables.ready);
  }

  prepare(ctx: FxFrameContext): void {
    const u = CLOUD_U;
    const cam = ctx.camera.position;
    u.p0.x = ctx.near;
    u.p0.y = ctx.far;
    u.p0.z = cam.y;
    u.p0.w = AIR.frame.heightKm;
    u.p1.x = ctx.tanHalfFov.x;
    u.p1.y = ctx.tanHalfFov.y;
    // The camera's turn, element by element (three's `setFromMatrix4` hands nine numbers across a call).
    const t = u.turn.elements;
    const mw = ctx.camera.matrixWorld.elements;
    t[0] = mw[0];
    t[1] = mw[1];
    t[2] = mw[2];
    t[3] = mw[4];
    t[4] = mw[5];
    t[5] = mw[6];
    t[6] = mw[8];
    t[7] = mw[9];
    t[8] = mw[10];
    const ld = AIR.frame.lightDir;
    u.light.x = ld.x;
    u.light.y = ld.y;
    u.light.z = ld.z;
    writeDials(u);
    this.frameNo++;
    // A golden-ratio walk of the jitter's phase, frame by frame (the edge smoothing gathers it).
    u.tr.z = (this.frameNo * 0.6180339887) % 1;
    u.tr.w = CLOUD_TUNE.jitter;
    const F = CLOUD_FEED;
    if (F.stack) {
      if (F.version !== this.streakVersion) {
        this.streakVersion = F.version;
        const n = F.layers.length < CLOUD_LAYER_MAX ? F.layers.length : CLOUD_LAYER_MAX;
        for (let i = 0; i < n; i++) {
          const l = F.layers[i];
          streakInto(l.types, l.shares, l.seed, l.turn, this.streaks, i * 2);
        }
      }
      writeOffsets(u, F.stack, F.count, F.drift, this.streaks, cam);
    }
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    if (output === null || !this.marchG || !this.compG) return false;
    const r = ctx.renderer as Any;
    const u = CLOUD_U;
    if (u.p1.z !== input.width || u.p1.w !== input.height) {
      u.p1.z = input.width;
      u.p1.w = input.height;
    }
    this.sizeTrace();
    // The map rewritten for this camera first (the map's maker's frame), then the march, then the composite.
    CLOUD_FACE.frame?.(ctx.camera);
    r.setRenderTarget(this.trace);
    r.render(this.marchG.mesh, FX_CAMERA);
    CLOUD_TRACE.value = this.trace.textures[0];
    this.input.value = input.texture;
    r.setRenderTarget(output);
    r.render(this.compG.mesh, FX_CAMERA);
    this.drewLast = true;
    this.whyNot = null;
    CLOUD_DRAW.drew = true;
    CLOUD_DRAW.drewFrame = ctx.frame;
    CLOUD_MARCH_STATS.drawn++;
    return true;
  }

  /** The trace sized to the display (its CSS pixels: neither the pixel ratio nor the render scale multiplies it), capped by the budget. */
  private sizeTrace(): void {
    const el = this.renderer.domElement as HTMLCanvasElement | undefined;
    // Whole numbers (a canvas's client size is; the scene's held as one), so nothing is boxed across the call.
    const w = el && el.clientWidth > 0 ? el.clientWidth | 0 : CLOUD_U.p1.z | 0;
    const h = el && el.clientHeight > 0 ? el.clientHeight | 0 : CLOUD_U.p1.w | 0;
    traceSizeOf(w, h, this.size);
    const tw = this.size[0];
    const th = this.size[1];
    if (this.trace.width !== tw || this.trace.height !== th) this.trace.setSize(tw, th);
    if (CLOUD_U.tr.x !== tw || CLOUD_U.tr.y !== th) {
      CLOUD_U.tr.x = tw;
      CLOUD_U.tr.y = th;
    }
  }

  setSize(_width: number, _height: number, _settings: FxSettings): void {}

  /** Off: nothing (the base's pipelines exactly); on: the march against its trace and the composite against a chain buffer. */
  materials(): FxWarmItem[] {
    if (!CLOUD_DRAW.want) return [];
    this.build();
    // The noise baked whole while the warm-up's screen is up (its computes compiled first, off the frame).
    if (this.noise && !this.noise.baked) void this.bakeBehindScreen();
    const out: FxWarmItem[] = [];
    if (this.marchG) out.push({ material: this.marchG.material, object: this.marchG.mesh, where: 'target', into: this.trace });
    if (this.compG) out.push({ material: this.compG.material, object: this.compG.mesh, where: 'target' });
    return out;
  }

  /** What `__debug.clouds()` says of the march. */
  report(): Record<string, unknown> {
    return {
      drewLast: this.drewLast,
      whyNot: this.drewLast ? null : cloudsWhyNot(false, false, AIR.frame.on && AIR.tables !== null && AIR.tables.ready),
      trace: [this.trace.width, this.trace.height],
      graphs: { march: this.marchG !== null, composite: this.compG !== null, landed: this.landed },
      noise: this.noise ? this.noise.report() : 'not made (the switch has not been on)',
      ...CLOUD_MARCH_STATS,
    };
  }

  dispose(): void {
    this.marchG?.material.dispose();
    this.compG?.material.dispose();
    this.trace.dispose();
    const at = LIVE.indexOf(this);
    if (at >= 0) LIVE.splice(at, 1);
  }
}

const NO_NEEDS: readonly FxProductId[] = [];

/** The march's numbers for `__debug.clouds()` (the switch, the trace, the dials, what drew), whichever chain is live. */
export function cloudMarchReport(): Record<string, unknown> {
  const p = cloudPassNow();
  return {
    switch: { ...CLOUD_DRAW },
    pass: p ? p.report() : "no chain: the Effects setting is off, or the sky is SWG's",
    tune: { ...CLOUD_TUNE },
    look: { ...CLOUD_LOOK },
  };
}
