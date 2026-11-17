// The ambient occlusion's node graphs on WebGPU (the GPU port's step 6, item 4): the WebGL pass's four programs
// (`ssao.ts`'s GTAO, blur, apply and probe) and its region read, and the two depth products it asks for (`products.ts`'s
// half-resolution distance and normals), each the WebGL text line for line over that pass's very uniform objects (rule 2):
// the WebGL `SsaoPass` is made on WebGPU too (its `ShaderMaterial`s are never drawn there), its `prepare` writes its
// uniforms exactly as on WebGL, and each graph here reads them once a render (`live`, `liveTexture`), a vector or matrix by
// reference (`ref`), an array's element through its `Float32Array` (`fromArray` into a vector of the graph's own, read once a
// render: the WebGL pass makes the spots' and casting points' arrays again when the rooms' pool changes shape, so the
// array is read through its uniform's `{ value }` at every render, never held). Every number that is not a uniform is the
// mirror's own (`ssaoMath.ts`) or the WebGL text's literal (`SSAO_GPU_NUMBERS`, held to the text by `gpuSsao.test.ts`).
//
// Four things about WebGPU decided the shape:
//   - **the coordinates are WebGL's**: every texel fetch and every place worked out of a pixel's position is in WebGL's frame
//     (rows counted from the bottom, `gl_FragCoord` from the bottom left), so the noise, the search's taps and the upsample's
//     weights fall on the very pixels they fall on in WebGL; a fetch turns its row over by the texture's own height
//     (`loadGL`), and the pixel's own place is WebGPU's `@builtin(position)` turned over by its target's height;
//   - **the sun's shadow is the lookup three's `ShadowNode` makes on WebGPU** (its `y` turned over, its bias taken off under
//     reversed depth, its frustum test, its compare), over the cascades three's `CSMShadowNode` draws: the WebGL pass reads
//     the WebGL cascades, which WebGPU never draws, and the darkening must follow the shadows the pixel was really lit by.
//     Each of the three maps is sampled at the top of the fragment (a comparison sample is an implicitly filtered one, which
//     WGSL allows only in uniform control flow: rule 3), and the cascade the pixel's depth falls in is chosen after;
//   - **a fallback picture of each slot's own kind**: WebGPU keys a bind group's layout on each texture's kind (depth,
//     unfilterable float, float, the comparison sampler), and the graph is built over the fallback when its uniform is null,
//     so each slot's fallback is the kind its real picture will be (a depth texture, a 32-bit float, eight-bit colour);
//   - **water is a coverage of the stand-in**: WebGPU has no water mask (the water is a remake), so where the water is drawn
//     its coverage is the region target's green, drawn by the pass itself from the water's own twins (`gpuSsaoPass.ts`), and
//     the apply leaves those pixels alone as WebGL leaves the mask's.
//
// Nothing here is loaded on the WebGL path (`gpuOff.test.ts`). The passes that draw these are `gpuSsaoPass.ts`.

import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { chainMaterial, graph, live, ref, type ChainGraph } from './gpuChain.ts';
import { asShownFB, liveTexture } from './gpuGround.ts';
import { FX_MAX_FLASH_LIGHTS, FX_MAX_ROOM_CAST, FX_MAX_ROOM_LIGHTS, FX_MAX_ROOM_SPOTS } from '../fx/lights.ts';
import {
  SSAO_ALBEDO_CEILING,
  SSAO_CEILING_LOG_MIN,
  SSAO_CEILING_LOG_SPAN,
  SSAO_CSM_FADE_MARGIN,
  SSAO_MIN_FRACTION,
  SSAO_SLICES,
  SSAO_STEPS,
  SSAO_UPSAMPLE_TOLERANCE_METRES,
  SSAO_UPSAMPLE_TOLERANCE_SHARE,
} from '../fx/ssaoMath.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const {
  Fn,
  If,
  abs,
  acos,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  int,
  ivec2,
  length,
  log2,
  max,
  min,
  mix,
  normalize,
  pow,
  renderGroup,
  round,
  screenCoordinate,
  select,
  sin,
  smoothstep,
  step,
  textureSize,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} = TSL as Any;

/** The points the GTAO's arrays hold: the flash pool's, then the rooms' lamps (`ssao.ts`'s MAX_POINTS). */
export const SSAO_GPU_POINTS = FX_MAX_FLASH_LIGHTS + FX_MAX_ROOM_LIGHTS;

/**
 * Every number the graphs are built from that is neither a uniform nor the mirror's, each the WebGL text's own literal
 * (`gpuSsao.test.ts` reads the GLSL out of `ssao.ts`, `glsl.ts` and `products.ts` and holds these to it):
 *   - the GTAO's: pi and its half, the Bayer table, the golden ratio's step, the falloff's floor, the minimum step's 1.3
 *     pixels, the radius's 1.5 pixels, the normal's and the direction's floors;
 *   - the blur's Gaussian (sigma 2 over -4..4) and its 5 cm;
 *   - the apply's multi-bounce fit and its floors;
 *   - the interleaved gradient noise's three numbers, the luma's Rec. 709 weights, and the normals' 0.999 of the far plane.
 */
export const SSAO_GPU_NUMBERS = {
  pi: 3.14159265,
  halfPi: 1.57079633,
  bayer: [0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0],
  golden: 0.6180339887,
  ign: [52.9829189, 0.06711056, 0.00583715],
  luma: [0.2126, 0.7152, 0.0722],
  blurWeights: [0.2042, 0.1802, 0.1238, 0.0663, 0.0276],
  blurFloor: 0.05,
  bounce: { a: [2.0404, -0.3324], b: [-4.7951, 0.6417], c: [2.7552, 0.6903] },
  albedoMost: 0.9,
  fogFloor: 1e-3,
  ceilingFloor: 1e-4,
  minStepPx: 1.3,
  minRadiusPx: 1.5,
  fallback: [1.0, 0.0, 0.5, 1.0],
  normalsFar: 0.999,
} as const;

// ---------------------------------------------------------------- the slots and their fallbacks

/**
 * A depth texture held by a render target of one sample. Three counts a depth texture of no target, not yet on the card, as
 * having the renderer's current samples, and draws onto the canvas are multisampled under the inline output (item 5): a
 * slot's layout made while such a texture stood in it said multisampled, and every real depth picture bound there after
 * failed the pipeline's layout. Held by a target of its own it is single-sampled whenever it is met.
 */
export function singleSampled(d: THREE.DepthTexture): void {
  if ((d as Any).renderTarget) return;
  new THREE.RenderTarget(1, 1, { depthBuffer: true, stencilBuffer: d.format === THREE.DepthStencilFormat, samples: 0, depthTexture: d });
}

/** A fallback of a slot's own kind (each its own: two nodes holding one texture would be one binding). */
function fallbackOf(kind: 'linear' | 'rgba8' | 'rg8' | 'half' | 'depth' | 'shadow', depthType: THREE.TextureDataType = THREE.FloatType): THREE.Texture {
  if (kind === 'depth' || kind === 'shadow') {
    const d = new THREE.DepthTexture(1, 1, kind === 'shadow' ? THREE.UnsignedIntType : depthType);
    if (kind === 'depth') d.format = THREE.DepthStencilFormat;
    else d.compareFunction = THREE.LessEqualCompare;
    d.needsUpdate = true;
    singleSampled(d);
    return d;
  }
  const t =
    kind === 'linear'
      ? new THREE.DataTexture(new Float32Array(1), 1, 1, THREE.RedFormat, THREE.FloatType)
      : kind === 'half'
        ? new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType)
        : kind === 'rg8'
          ? new THREE.DataTexture(new Uint8Array(2), 1, 1, THREE.RGFormat, THREE.UnsignedByteType)
          : new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  const linear = kind === 'half';
  t.minFilter = t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** A picture a WebGL uniform holds through `{ value }`, with a fallback of its kind. */
const slot = (u: { value: unknown }, kind: Parameters<typeof fallbackOf>[0], depthType?: THREE.TextureDataType): Any => liveTexture(u as { value: THREE.Texture | null }, fallbackOf(kind, depthType));

/** A texel of `t` at WebGL's integer coordinate `c` (rows from the bottom), in a picture `h` texels tall. */
const loadGL = (t: Any, c: Any, h: Any): Any => t.load(ivec2(c.x, int(h).sub(1).sub(c.y)));
/** A sample of `t` at WebGL's uv (v up), on WebGPU's (v down). */
const sampleGL = (t: Any, at: Any): Any => t.sample(vec2(at.x, float(1).sub(at.y)));
/** The pixel's WebGL `gl_FragCoord` in a target `h` texels tall: WebGPU's `@builtin(position)` turned over. */
const fragGL = (h: Any): Any => vec2(screenCoordinate.x, h.sub(screenCoordinate.y));

/** A vector of the graph's own, refilled once a render from four (or `n`) numbers of a WebGL array through its `{ value }`. */
function element(u: { value: unknown }, i: number, n: 2 | 3 | 4): Any {
  const at = i * n;
  // One function literal a kind of vector, so each copy writes one class of object, and the bounds asked once: a copy
  // writing all three kinds, or reading past an array's end answered `?? 0`, boxed its numbers (262 bytes a frame in the
  // browser; in node 135 bytes a render of the GTAO's 52 elements against nothing for these).
  if (n === 2) {
    const v = new THREE.Vector2();
    return uniform(v)
      .setGroup(renderGroup)
      .onRenderUpdate(() => {
        const a = u.value as ArrayLike<number>;
        if (at + 2 <= a.length) {
          v.x = a[at];
          v.y = a[at + 1];
        } else v.x = v.y = 0;
        return v;
      });
  }
  if (n === 3) {
    const v = new THREE.Vector3();
    return uniform(v)
      .setGroup(renderGroup)
      .onRenderUpdate(() => {
        const a = u.value as ArrayLike<number>;
        if (at + 3 <= a.length) {
          v.x = a[at];
          v.y = a[at + 1];
          v.z = a[at + 2];
        } else v.x = v.y = v.z = 0;
        return v;
      });
  }
  const v = new THREE.Vector4();
  return uniform(v)
    .setGroup(renderGroup)
    .onRenderUpdate(() => {
      const a = u.value as ArrayLike<number>;
      if (at + 4 <= a.length) {
        v.x = a[at];
        v.y = a[at + 1];
        v.z = a[at + 2];
        v.w = a[at + 3];
      } else v.x = v.y = v.z = v.w = 0;
      return v;
    });
}

// ---------------------------------------------------------------- shared pieces (glsl.ts's)

/** `fxViewZ` on WebGPU: under reversed depth WebGL's own (both clip to 0..1); else WebGPU's ordinary 0..1 depth. */
const viewZOf = (d: Any, near: Any, far: Any, reversed: boolean): Any => (reversed ? near.mul(far).div(near.add(d.mul(far.sub(near)))) : near.mul(far).div(far.sub(d.mul(far.sub(near)))));
/** `skyTest`: where nothing was drawn (a cleared depth is 0 reversed, 1 ordinarily). */
const skyOf = (d: Any, reversed: boolean): Any => (reversed ? d.lessThanEqual(0) : d.greaterThanEqual(1));
/** `fxViewPos`. */
const viewPos = (at: Any, z: Any, tan: Any): Any => {
  const ndc = at.mul(2).sub(1);
  return vec3(ndc.x.mul(tan.x).mul(z), ndc.y.mul(tan.y).mul(z), z.negate());
};
const N = SSAO_GPU_NUMBERS;
const lumaOf = (c: Any): Any => dot(c, vec3(N.luma[0], N.luma[1], N.luma[2]));
/** `fxIgn`. */
const ign = (p: Any): Any => fract(float(N.ign[0]).mul(fract(dot(p, vec2(N.ign[1], N.ign[2])))));

/** What the AO's graphs need of the WebGL pass: its four uniform records, and its region read's material. */
export interface SsaoUniforms {
  gU: Record<string, { value: Any }>;
  bU: Record<string, { value: Any }>;
  aU: Record<string, { value: Any }>;
  pU: Record<string, { value: Any }>;
}

// ---------------------------------------------------------------- the GTAO (`ssao.ts`'s SSAO_GTAO_FRAG, with `ssaoGtaoFrag`'s spots and casting points)

/**
 * The GTAO at half resolution (`full` false) or full. Takes the rooms' spots and casting points always, their counts nought
 * until the pool has such slots (`fillRoomPoolUniforms` writes nothing else), which is the plain text's program then and
 * `ssaoGtaoFrag`'s once the pool has them: one graph for every shape of the pool, nothing built again when it moves.
 */
export function gtaoGraph(u: SsaoUniforms, full: boolean, reversed: boolean, depthType: THREE.TextureDataType): ChainGraph {
  const g = u.gU;
  const m = chainMaterial(full ? 'fx.gpu.ssao.gtao.full' : 'fx.gpu.ssao.gtao.half');
  const tLinear = slot(g.tLinear, 'linear');
  const tDepth = slot(g.tDepth, 'depth', depthType);
  const tNormal = slot(g.tNormal, 'rgba8');
  const tRegion = slot(g.tRegion, 'rg8');
  const tShadow = [slot(g.tShadow0, 'shadow'), slot(g.tShadow1, 'shadow'), slot(g.tShadow2, 'shadow')];
  const fullSize = ref(g.uFullSize);
  const aoSize = ref(g.uAoSize);
  const tan = ref(g.uTanHalfFov);
  const near = live(g.uNear);
  const far = live(g.uFar);
  const fadeEnd = live(g.uFadeEnd);
  const radiusU = live(g.uRadius);
  const nearRadiusAt = live(g.uNearRadiusAt);
  const nearRadiusMin = live(g.uNearRadiusMin);
  const maxRadiusPx = live(g.uMaxRadiusPx);
  const falloff = live(g.uFalloff);
  const thin = live(g.uThin);
  const openBias = live(g.uOpenBias);
  const camToWorld = ref(g.uCamToWorld);
  const hemi = ref(g.uHemi);
  const fill = ref(g.uFill);
  const sun = ref(g.uSun);
  const spotPos = ref(g.uSpotPos);
  const spotDir = ref(g.uSpotDir);
  const spotCone = ref(g.uSpotCone);
  const cascades = live(g.uCascades);
  const shadowMatrix = [0, 1, 2].map((i) => uniform((g.uShadowMatrix.value as THREE.Matrix4[])[i]).setGroup(renderGroup));
  const shadowParams = [0, 1, 2].map((i) => element(g.uShadowParams, i, 4));
  const cascade = [0, 1, 2].map((i) => element(g.uCascade, i, 2));
  const shadowRange = live(g.uShadowRange);
  const cascadeFade = live(g.uCascadeFade);
  const roomAmbient = live(g.uRoomAmbient);
  const roomParallel = ref(g.uRoomParallel);
  const pointPos = Array.from({ length: SSAO_GPU_POINTS }, (_, i) => element(g.uPointPos, i, 4));
  const pointLum = Array.from({ length: SSAO_GPU_POINTS }, (_, i) => element(g.uPointLum, i, 2));
  const flashCount = live(g.uFlashCount);
  const roomPointCount = live(g.uRoomPointCount);
  const region = live(g.uRegion);
  const roomSpotPos = Array.from({ length: FX_MAX_ROOM_SPOTS }, (_, i) => element(g.uRoomSpotPos, i, 4));
  const roomSpotDir = Array.from({ length: FX_MAX_ROOM_SPOTS }, (_, i) => element(g.uRoomSpotDir, i, 4));
  const roomSpotCone = Array.from({ length: FX_MAX_ROOM_SPOTS }, (_, i) => element(g.uRoomSpotCone, i, 3));
  const roomSpotCount = live(g.uRoomSpotCount);
  const roomCastPos = Array.from({ length: FX_MAX_ROOM_CAST }, (_, i) => element(g.uRoomCastPos, i, 4));
  const roomCastLum = Array.from({ length: FX_MAX_ROOM_CAST }, (_, i) => element(g.uRoomCastLum, i, 2));
  const roomCastCount = live(g.uRoomCastCount);

  const PI = float(N.pi);
  const HALF_PI = float(N.halfPi);

  m.fragmentNode = Fn(() => {
    const aoZ = (c: Any): Any => {
      if (!full) return loadGL(tLinear, c, aoSize.y).x;
      const d = float(loadGL(tDepth, c, aoSize.y).x);
      return select(skyOf(d, reversed), far, viewZOf(d, near, far, reversed));
    };
    const aoUv = (c: Any): Any => (full ? vec2(c).add(0.5).div(fullSize) : vec2(c).mul(2).add(1.5).div(fullSize));
    const fullTexel = (c: Any): Any => (full ? c : min(c.mul(2).add(1), ivec2(fullSize).sub(1)));
    const aoPos = (c: Any): Any => viewPos(aoUv(c), aoZ(c), tan);

    const fc = fragGL(aoSize.y).toVar('swgAoFc');
    const t = ivec2(fc).toVar('swgAoT');
    const lim = ivec2(aoSize).sub(1).toVar('swgAoLim');
    const z = float(aoZ(t)).toVar('swgAoZ');
    const P = vec3(viewPos(aoUv(t), z, tan)).toVar('swgAoP');
    // aoNormal
    const Nn = vec3(0, 0, 1).toVar('swgAoN');
    if (full) {
      const tl = clamp(t.sub(ivec2(1, 0)), ivec2(0), lim).toVar();
      const tr = clamp(t.add(ivec2(1, 0)), ivec2(0), lim).toVar();
      const td = clamp(t.sub(ivec2(0, 1)), ivec2(0), lim).toVar();
      const tu = clamp(t.add(ivec2(0, 1)), ivec2(0), lim).toVar();
      const zl = float(aoZ(tl)).toVar();
      const zr = float(aoZ(tr)).toVar();
      const zd = float(aoZ(td)).toVar();
      const zu = float(aoZ(tu)).toVar();
      const same = (a: Any, b: Any): Any => a.x.equal(b.x).and(a.y.equal(b.y));
      const dx = vec3(P.sub(aoPos(tl))).toVar();
      If(same(tr, t).not().and(same(tl, t).or(abs(zr.sub(z)).lessThan(abs(z.sub(zl))))), () => {
        dx.assign(aoPos(tr).sub(P));
      });
      const dy = vec3(P.sub(aoPos(td))).toVar();
      If(same(tu, t).not().and(same(td, t).or(abs(zu.sub(z)).lessThan(abs(z.sub(zd))))), () => {
        dy.assign(aoPos(tu).sub(P));
      });
      const c = cross(dx, dy).toVar();
      const l = length(c);
      If(l.greaterThan(1e-10), () => {
        Nn.assign(c.div(l));
      });
    } else {
      const n = vec3(loadGL(tNormal, t, aoSize.y).xyz.mul(2).sub(1)).toVar();
      const l = length(n);
      If(l.greaterThan(1e-4), () => {
        Nn.assign(n.div(l));
      });
    }
    const V = normalize(P.negate()).toVar('swgAoV');
    const pw = camToWorld.mul(vec4(P, 1)).xyz.toVar('swgAoPw');
    const nw = normalize(camToWorld.mul(vec4(Nn, 0)).xyz).toVar('swgAoNw');

    // The sun's three cascades, each looked up where three's ShadowNode looks one up on WebGPU (its y turned over, its bias
    // taken off under reversed depth, its frustum test), with WebGL's one comparison tap: the hardware's two by two compare,
    // bilinear, done by hand over four loads (a load is allowed under a branch, so only the cascade the depth falls in is
    // read, as on WebGL; and three declares no comparison sampler for a cascade's map it meets as a float depth).
    const coords: Any[] = [];
    const inFrustum: Any[] = [];
    for (let i = 0; i < 3; i++) {
      const sp = shadowMatrix[i].mul(vec4(pw.add(nw.mul(shadowParams[i].y)), 1));
      const q = sp.xyz.div(sp.w);
      const c = vec3(q.x, float(1).sub(q.y), reversed ? q.z.sub(shadowParams[i].x) : q.z.add(shadowParams[i].x)).toVar(`swgAoSc${i}`);
      coords.push(c);
      inFrustum.push(c.x.greaterThanEqual(0).and(c.x.lessThanEqual(1)).and(c.y.greaterThanEqual(0)).and(c.y.lessThanEqual(1)).and(c.z.lessThanEqual(1)));
    }
    /** A compare of one texel: passes where the reference is on the light's side (GreaterEqual reversed, LessEqual else). */
    const passes = (texel: Any, refz: Any): Any => select(reversed ? refz.greaterThanEqual(texel) : refz.lessThanEqual(texel), float(1), float(0));
    const pcf = (map: Any, c: Any): Any => {
      const size = vec2(textureSize(map, 0));
      const p = c.xy.mul(size).sub(0.5);
      const i0 = ivec2(floor(p));
      const fr = fract(p);
      const hi = ivec2(size).sub(1);
      const at = (dx: number, dy: number): Any => clamp(i0.add(ivec2(dx, dy)), ivec2(0), hi);
      const s00 = passes(map.load(at(0, 0)).x, c.z);
      const s10 = passes(map.load(at(1, 0)).x, c.z);
      const s01 = passes(map.load(at(0, 1)).x, c.z);
      const s11 = passes(map.load(at(1, 1)).x, c.z);
      return mix(mix(s00, s10, fr.x), mix(s01, s11, fr.x), fr.y);
    };
    // The rooms' region at this texel (a load, never filtered).
    const regionHere = float(loadGL(tRegion, fullTexel(t), fullSize.y).x).toVar('swgAoRegion');

    // lightFalloff
    const lightFalloff = (d: Any, cutoff: Any, decay: Any): Any => {
      const f = float(1).div(max(pow(d, decay), 0.01)).toVar();
      If(cutoff.greaterThan(0), () => {
        const x = d.div(cutoff);
        const s = clamp(float(1).sub(x.mul(x).mul(x).mul(x)), 0, 1);
        f.mulAssign(s.mul(s));
      });
      return f;
    };
    // cascadeKeep
    const ld = z.div(shadowRange).toVar('swgAoLd');
    const keep = float(0).toVar('swgAoKeep');
    {
      const x = cascade[2].x;
      const y = cascade[2].y;
      If(cascadeFade.equal(0), () => {
        keep.assign(select(ld.lessThan(y), float(1), float(0)));
      }).Else(() => {
        If(ld.lessThanEqual(x.add(y).mul(0.5)), () => {
          keep.assign(1);
        }).Else(() => {
          const mm = max(float(SSAO_CSM_FADE_MARGIN).mul(y).mul(y), 1e-6);
          keep.assign(clamp(min(ld.sub(x.sub(mm.mul(0.5))), y.add(mm.mul(0.5)).sub(ld)).div(mm), 0, 1));
        });
      });
    }
    // sunShadow
    const shadowed = float(1).toVar('swgAoSun');
    If(cascades.notEqual(0).and(keep.greaterThan(0)), () => {
      const s = float(1).toVar();
      const intensity = float(0).toVar();
      const pick = (i: number): void => {
        intensity.assign(shadowParams[i].z);
        If(inFrustum[i], () => {
          s.assign(pcf(tShadow[i], coords[i]));
        });
      };
      If(ld.lessThan(cascade[0].y), () => {
        pick(0);
      })
        .ElseIf(ld.lessThan(cascade[1].y), () => {
          pick(1);
        })
        .Else(() => {
          pick(2);
        });
      shadowed.assign(mix(float(1), s, intensity.mul(keep)));
    });

    // skyLight
    const skyIndirect = mix(hemi.y, hemi.x, nw.y.mul(0.5).add(0.5)).add(fill.w.mul(max(dot(nw, fill.xyz), 0))).toVar('swgAoSkyI');
    const skyDirect = float(0).toVar('swgAoSkyD');
    const ndl = dot(nw, sun.xyz);
    If(sun.w.greaterThan(0).and(ndl.greaterThan(0)), () => {
      skyDirect.assign(sun.w.mul(ndl).mul(shadowed));
    });
    // The points: the flash pool's (both sets) and the rooms' lamps, one pass over the arrays.
    const flashDirect = float(0).toVar('swgAoFlash');
    const roomPoints = float(0).toVar('swgAoRoomPts');
    const roomTo = flashCount.add(roomPointCount);
    for (let i = 0; i < SSAO_GPU_POINTS; i++) {
      If(float(i).lessThan(roomTo), () => {
        const lv = pointPos[i].xyz.sub(pw);
        const d = length(lv);
        const c = dot(nw, lv).div(max(d, 1e-4));
        If(c.greaterThan(0), () => {
          const add = pointLum[i].x.mul(c).mul(lightFalloff(d, pointPos[i].w, pointLum[i].y));
          If(float(i).lessThan(flashCount), () => {
            flashDirect.addAssign(add);
          }).Else(() => {
            roomPoints.addAssign(add);
          });
        });
      });
    }
    // spotDirect: the torch.
    const torch = float(0).toVar('swgAoTorch');
    If(spotDir.w.greaterThan(0), () => {
      const lv = spotPos.xyz.sub(pw);
      const d = length(lv);
      const ldir = lv.div(max(d, 1e-4));
      const c = dot(nw, ldir);
      const cone = smoothstep(spotCone.x, spotCone.y, dot(ldir, spotDir.xyz));
      If(c.greaterThan(0).and(cone.greaterThan(0)), () => {
        torch.assign(spotDir.w.mul(c).mul(cone).mul(lightFalloff(d, spotPos.w, spotCone.z)));
      });
    });
    // The rooms' spots and casting points (`ssaoGtaoFrag`'s), counts nought until the pool has such slots.
    const roomSpots = float(0).toVar('swgAoRoomSpots');
    for (let i = 0; i < FX_MAX_ROOM_SPOTS; i++) {
      If(float(i).lessThan(roomSpotCount), () => {
        const lv = roomSpotPos[i].xyz.sub(pw);
        const d = length(lv);
        const ldir = lv.div(max(d, 1e-4));
        const c = dot(nw, ldir);
        const cone = smoothstep(roomSpotCone[i].x, roomSpotCone[i].y, dot(ldir, roomSpotDir[i].xyz));
        If(c.greaterThan(0).and(cone.greaterThan(0)), () => {
          roomSpots.addAssign(roomSpotDir[i].w.mul(c).mul(cone).mul(lightFalloff(d, roomSpotPos[i].w, roomSpotCone[i].z)));
        });
      });
    }
    const roomCast = float(0).toVar('swgAoRoomCast');
    for (let i = 0; i < FX_MAX_ROOM_CAST; i++) {
      If(float(i).lessThan(roomCastCount), () => {
        const lv = roomCastPos[i].xyz.sub(pw);
        const d = length(lv);
        const c = dot(nw, lv).div(max(d, 1e-4));
        If(c.greaterThan(0), () => {
          roomCast.addAssign(roomCastLum[i].x.mul(c).mul(lightFalloff(d, roomCastPos[i].w, roomCastLum[i].y)));
        });
      });
    }
    // Which set the pixel took, then the flash pool and the torch in either.
    const indirect = float(skyIndirect).toVar('swgAoIndirect');
    const direct = float(skyDirect).toVar('swgAoDirect');
    If(region.equal(1).and(regionHere.greaterThan(0.5)), () => {
      indirect.assign(roomAmbient);
      direct.assign(roomParallel.w.mul(max(dot(nw, roomParallel.xyz), 0)).add(roomPoints).add(roomSpots).add(roomCast));
    });
    direct.addAssign(flashDirect);
    direct.addAssign(torch);
    const total = indirect.add(direct).toVar('swgAoTotal');
    const fraction = select(total.greaterThan(1e-4), indirect.div(total), float(0)).toVar('swgAoFraction');
    const ceilingEnc = clamp(log2(max(total.div(PI), 1e-6)).sub(SSAO_CEILING_LOG_MIN).div(SSAO_CEILING_LOG_SPAN), 0, 1).toVar('swgAoCeil');
    const out = vec4(1, fraction, ceilingEnc, 1).toVar('swgAoOut');

    // The search, where it has work: in reach, enough of the light ambient, and a radius of a pixel and a half or more.
    const radius = radiusU.mul(clamp(z.div(nearRadiusAt), nearRadiusMin, 1)).toVar('swgAoRadius');
    const pxPerMetre = aoSize.y.mul(0.5).div(tan.y.mul(z)).toVar('swgAoPx');
    const radiusPx = min(radius.mul(pxPerMetre), maxRadiusPx).toVar('swgAoRadiusPx');
    If(z.greaterThanEqual(fadeEnd), () => {
      out.assign(vec4(1, 0, 0, 1));
    }).ElseIf(fraction.greaterThanEqual(SSAO_MIN_FRACTION).and(radiusPx.greaterThanEqual(N.minRadiusPx)), () => {
      const r2 = radiusPx.div(pxPerMetre);
      const falloffRange = falloff.mul(r2);
      const falloffMul = float(-1).div(falloffRange);
      const falloffAdd = r2.sub(falloffRange).div(falloffRange).add(1);
      const minS = float(N.minStepPx).div(radiusPx);
      const noiseSlice = ign(fc);
      // BAYER[(t.y & 3) * 4 + (t.x & 3)], written out as a sum of the table's sixteen entries.
      const bi = t.y.bitAnd(3).mul(4).add(t.x.bitAnd(3));
      let bayer: Any = float(0);
      for (let k = 0; k < 16; k++) bayer = select(bi.equal(k), float(N.bayer[k]), bayer);
      const noiseStep = float(bayer).add(0.5).div(16).toVar();
      const visibility = float(0).toVar('swgAoVis');
      for (let s = 0; s < SSAO_SLICES; s++) {
        const phi = float(s).add(noiseSlice).mul(PI).div(SSAO_SLICES);
        const omega = vec2(cos(phi), sin(phi)).toVar();
        const dirV = vec3(omega, 0);
        const ortho = dirV.sub(V.mul(dot(dirV, V))).toVar();
        const axis = normalize(cross(ortho, V));
        const projN = Nn.sub(axis.mul(dot(Nn, axis))).toVar();
        const projLen = length(projN).toVar();
        const cosN = clamp(dot(projN, V).div(max(projLen, 1e-4)), 0, 1).toVar();
        const nAng = select(dot(ortho, projN).lessThan(0), float(-1), float(1)).mul(acos(cosN)).toVar();
        const low0 = cos(nAng.add(HALF_PI)).toVar();
        const low1 = cos(nAng.sub(HALF_PI)).toVar();
        const hc0 = float(low0).toVar();
        const hc1 = float(low1).toVar();
        for (let j = 0; j < SSAO_STEPS; j++) {
          const stepNoise = fract(noiseStep.add(float(s + j * SSAO_STEPS).mul(N.golden)));
          const st0 = float(j).add(stepNoise).div(SSAO_STEPS);
          const st = st0.mul(st0).add(minS);
          const off = ivec2(round(omega.mul(st).mul(radiusPx))).toVar();
          const t0 = t.add(off).toVar();
          const t1 = t.sub(off).toVar();
          If(t0.x.greaterThanEqual(0).and(t0.y.greaterThanEqual(0)).and(t0.x.lessThanEqual(lim.x)).and(t0.y.lessThanEqual(lim.y)), () => {
            const d0 = vec3(aoPos(t0).sub(P)).toVar();
            const l0 = length(d0);
            const w0 = clamp(length(vec3(d0.xy, d0.z.mul(thin.add(1)))).mul(falloffMul).add(falloffAdd), 0, 1);
            hc0.assign(max(hc0, mix(low0, dot(d0, V).div(max(l0, 1e-4)), w0)));
          });
          If(t1.x.greaterThanEqual(0).and(t1.y.greaterThanEqual(0)).and(t1.x.lessThanEqual(lim.x)).and(t1.y.lessThanEqual(lim.y)), () => {
            const d1 = vec3(aoPos(t1).sub(P)).toVar();
            const l1 = length(d1);
            const w1 = clamp(length(vec3(d1.xy, d1.z.mul(thin.add(1)))).mul(falloffMul).add(falloffAdd), 0, 1);
            hc1.assign(max(hc1, mix(low1, dot(d1, V).div(max(l1, 1e-4)), w1)));
          });
        }
        const h0a = acos(clamp(hc1, -1, 1)).negate();
        const h1a = acos(clamp(hc0, -1, 1));
        const h0 = nAng.add(clamp(h0a.sub(nAng), HALF_PI.negate(), HALF_PI)).toVar();
        const h1 = nAng.add(clamp(h1a.sub(nAng), HALF_PI.negate(), HALF_PI)).toVar();
        const sinN = sin(nAng);
        const a0 = cosN.add(h0.mul(2).mul(sinN)).sub(cos(h0.mul(2).sub(nAng))).mul(0.25);
        const a1 = cosN.add(h1.mul(2).mul(sinN)).sub(cos(h1.mul(2).sub(nAng))).mul(0.25);
        visibility.addAssign(projLen.mul(a0.add(a1)));
      }
      out.assign(vec4(clamp(visibility.div(float(SSAO_SLICES).mul(openBias)), 0, 1), fraction, ceilingEnc, 1));
    });
    return out;
  })();
  const parts = {
    uniforms: {
      uFullSize: fullSize,
      uAoSize: aoSize,
      uTanHalfFov: tan,
      uNear: near,
      uFar: far,
      uFadeEnd: fadeEnd,
      uRadius: radiusU,
      uNearRadiusAt: nearRadiusAt,
      uNearRadiusMin: nearRadiusMin,
      uMaxRadiusPx: maxRadiusPx,
      uFalloff: falloff,
      uThin: thin,
      uOpenBias: openBias,
      uCamToWorld: camToWorld,
      uHemi: hemi,
      uFill: fill,
      uSun: sun,
      uSpotPos: spotPos,
      uSpotDir: spotDir,
      uSpotCone: spotCone,
      uCascades: cascades,
      ...Object.fromEntries(shadowMatrix.map((n, i) => [`uShadowMatrix[${i}]`, n])),
      ...Object.fromEntries(shadowParams.map((n, i) => [`uShadowParams{${i}}`, n])),
      ...Object.fromEntries(cascade.map((n, i) => [`uCascade{${i}}`, n])),
      uShadowRange: shadowRange,
      uCascadeFade: cascadeFade,
      uRoomAmbient: roomAmbient,
      uRoomParallel: roomParallel,
      ...Object.fromEntries(pointPos.map((n, i) => [`uPointPos{${i}}`, n])),
      ...Object.fromEntries(pointLum.map((n, i) => [`uPointLum{${i}}`, n])),
      uFlashCount: flashCount,
      uRoomPointCount: roomPointCount,
      uRegion: region,
      ...Object.fromEntries(roomSpotPos.map((n, i) => [`uRoomSpotPos{${i}}`, n])),
      ...Object.fromEntries(roomSpotDir.map((n, i) => [`uRoomSpotDir{${i}}`, n])),
      ...Object.fromEntries(roomSpotCone.map((n, i) => [`uRoomSpotCone{${i}}`, n])),
      uRoomSpotCount: roomSpotCount,
      ...Object.fromEntries(roomCastPos.map((n, i) => [`uRoomCastPos{${i}}`, n])),
      ...Object.fromEntries(roomCastLum.map((n, i) => [`uRoomCastLum{${i}}`, n])),
      uRoomCastCount: roomCastCount,
    },
    textures: { tLinear, tDepth, tNormal, tRegion, tShadow0: tShadow[0], tShadow1: tShadow[1], tShadow2: tShadow[2] },
  };
  return graph(m, 7, parts);
}

// ---------------------------------------------------------------- the blur (`ssao.ts`'s SSAO_BLUR_FRAG)

/** The depth-aware separable blur, one direction per draw (`uStep` the WebGL pass's own vector, set before each draw). */
export function blurGraph(u: SsaoUniforms, full: boolean, reversed: boolean, depthType: THREE.TextureDataType): ChainGraph {
  const b = u.bU;
  const m = chainMaterial(full ? 'fx.gpu.ssao.blur.full' : 'fx.gpu.ssao.blur.half');
  const tAo = slot(b.tAo, 'rgba8');
  const tLinear = slot(b.tLinear, 'linear');
  const tDepth = slot(b.tDepth, 'depth', depthType);
  // The step is the WebGL pass's own vector, which it sets before each of its two draws: read once a render.
  const stepV = uniform(new THREE.Vector2()).setGroup(renderGroup).onRenderUpdate(() => b.uStep.value as THREE.Vector2);
  const near = live(b.uNear);
  const far = live(b.uFar);
  const fadeEnd = live(b.uFadeEnd);
  const tolerance = live(b.uBlurTolerance);
  // `textureSize(tAo, 0)`: the AO buffer's size, the GTAO's own uniform (the WebGL blur asks the texture).
  const aoSize = ref(u.gU.uAoSize);
  m.fragmentNode = Fn(() => {
    const aoZ = (c: Any): Any => {
      if (!full) return loadGL(tLinear, c, aoSize.y).x;
      const d = float(loadGL(tDepth, c, aoSize.y).x);
      return select(skyOf(d, reversed), far, viewZOf(d, near, far, reversed));
    };
    const t = ivec2(fragGL(aoSize.y)).toVar('swgBlurT');
    const c0 = vec4(loadGL(tAo, t, aoSize.y)).toVar('swgBlurC0');
    const z0 = float(aoZ(t)).toVar('swgBlurZ0');
    const out = vec4(c0).toVar('swgBlurOut');
    If(z0.lessThan(fadeEnd), () => {
      const lim = ivec2(aoSize).sub(1).toVar();
      const st = ivec2(stepV).toVar();
      const zm = float(aoZ(clamp(t.sub(st), ivec2(0), lim)));
      const zp = float(aoZ(clamp(t.add(st), ivec2(0), lim)));
      const inv0 = float(1).div(z0).toVar();
      const dInv = select(abs(zp.sub(z0)).lessThan(abs(z0.sub(zm))), float(1).div(zp).sub(inv0), inv0.sub(float(1).div(zm))).toVar();
      const tol = z0.mul(tolerance).add(N.blurFloor).toVar();
      const sum = c0.mul(N.blurWeights[0]).toVar();
      const wsum = float(N.blurWeights[0]).toVar();
      for (let k = 1; k <= 4; k++) {
        for (const side of [-1, 1]) {
          const o = k * side;
          const tk = t.add(st.mul(o)).toVar();
          If(tk.x.greaterThanEqual(0).and(tk.y.greaterThanEqual(0)).and(tk.x.lessThanEqual(lim.x)).and(tk.y.lessThanEqual(lim.y)), () => {
            const predicted = float(1).div(max(inv0.add(dInv.mul(o)), 1e-6));
            const w = float(N.blurWeights[k]).mul(clamp(float(1).sub(abs(float(aoZ(tk)).sub(predicted)).div(tol)), 0, 1)).toVar();
            sum.addAssign(loadGL(tAo, tk, aoSize.y).mul(w));
            wsum.addAssign(w);
          });
        }
      }
      out.assign(sum.div(wsum));
    });
    return out;
  })();
  return graph(m, 3, { uniforms: { uStep: stepV, uNear: near, uFar: far, uFadeEnd: fadeEnd, uBlurTolerance: tolerance }, textures: { tAo, tLinear, tDepth } });
}

// ---------------------------------------------------------------- the apply (`ssao.ts`'s SSAO_APPLY_FRAG, with glsl.ts's FX_BILATERAL_UPSAMPLE)

/**
 * The darkening laid on the picture. `water` is the pass's own record (1 while the region target's green holds the water
 * stand-ins' coverage this frame): WebGL's mask is the water's twins drawn with their waves; WebGPU's the same twins drawn
 * flat, as the stand-in itself is drawn.
 */
export function applyGraph(u: SsaoUniforms, full: boolean, reversed: boolean, depthType: THREE.TextureDataType, water: { value: number }, region: { value: THREE.Texture | null }): ChainGraph {
  const a = u.aU;
  const m = chainMaterial(full ? 'fx.gpu.ssao.apply.full' : 'fx.gpu.ssao.apply.half');
  const tDiffuse = slot(a.tDiffuse, 'half');
  const tDepth = slot(a.tDepth, 'depth', depthType);
  const tAo = slot(a.tAo, 'rgba8');
  const tLinear = slot(a.tLinear, 'linear');
  const tNormal = slot(a.tNormal, 'rgba8');
  const tWater = slot(region, 'rg8');
  const waterOn = live(water);
  const tan = ref(a.uTanHalfFov);
  const fullSize = ref(a.uFullSize);
  const near = live(a.uNear);
  const far = live(a.uFar);
  const fadeStart = live(a.uFadeStart);
  const fadeEnd = live(a.uFadeEnd);
  const strength = live(a.uStrength);
  const power = live(a.uPower);
  const directShare = live(a.uDirectShare);
  const fogColor = ref(a.uFogColor);
  const fogDensity = live(a.uFogDensity);
  const split = live(a.uSplit);
  const debug = live(a.uDebug);
  // `textureSize(tHalf, 0)` of the upsample: the AO buffer's size, the GTAO's own uniform.
  const halfSize = ref(u.gU.uAoSize);
  m.fragmentNode = Fn(() => {
    // The picture first, at the top (rule 3): every other read is a load.
    const c = vec4(tDiffuse.sample(uv())).toVar('swgApplyC');
    const fc = fragGL(fullSize.y).toVar('swgApplyFc');
    const p = ivec2(fc).toVar('swgApplyP');
    const d = float(loadGL(tDepth, p, fullSize.y).x).toVar('swgApplyD');
    const z = select(skyOf(d, reversed), far, viewZOf(d, near, far, reversed)).toVar('swgApplyZ');
    const fade = float(1).sub(smoothstep(fadeStart, fadeEnd, z)).toVar('swgApplyFade');
    const uvGL = vec2(uv().x, float(1).sub(uv().y));
    const out = vec4(c).toVar('swgApplyOut');
    If(fade.lessThanEqual(0).or(split.greaterThan(0).and(uvGL.x.greaterThan(split))), () => {
      If(debug.equal(1), () => {
        out.assign(vec4(1));
      });
    }).Else(() => {
      const ao = vec4(1).toVar('swgApplyA');
      if (full) {
        ao.assign(loadGL(tAo, p, fullSize.y));
      } else {
        // fxHalfTaps
        const h = fc.sub(1.5).mul(0.5);
        const bb = ivec2(floor(h)).toVar();
        const f = h.sub(vec2(bb)).toVar();
        const hi = ivec2(halfSize).sub(1).toVar();
        const t00 = clamp(bb, ivec2(0), hi).toVar();
        const t10 = clamp(bb.add(ivec2(1, 0)), ivec2(0), hi).toVar();
        const t01 = clamp(bb.add(ivec2(0, 1)), ivec2(0), hi).toVar();
        const t11 = clamp(bb.add(ivec2(1, 1)), ivec2(0), hi).toVar();
        const w = vec4(float(1).sub(f.x).mul(float(1).sub(f.y)), f.x.mul(float(1).sub(f.y)), float(1).sub(f.x).mul(f.y), f.x.mul(f.y)).toVar();
        // fxBilateralUpsample
        const pf = vec3(viewPos(fc.div(fullSize), z, tan)).toVar();
        const tolerance = z.mul(SSAO_UPSAMPLE_TOLERANCE_SHARE).add(SSAO_UPSAMPLE_TOLERANCE_METRES).toVar();
        const plane = (tt: Any): Any => {
          const ne = vec4(loadGL(tNormal, tt, halfSize.y)).toVar();
          const out2 = float(0).toVar();
          If(ne.a.greaterThanEqual(0.5), () => {
            const n = ne.xyz.mul(2).sub(1).toVar();
            const pt = viewPos(vec2(tt).mul(2).add(1.5).div(fullSize), loadGL(tLinear, tt, halfSize.y).x, tan);
            out2.assign(clamp(float(1).sub(abs(dot(n, pf.sub(pt))).div(tolerance.mul(max(length(n), 0.5)))), 0, 1));
          });
          return out2;
        };
        w.x.mulAssign(plane(t00));
        w.y.mulAssign(plane(t10));
        w.z.mulAssign(plane(t01));
        w.w.mulAssign(plane(t11));
        const sum = w.x.add(w.y).add(w.z).add(w.w).toVar();
        ao.assign(vec4(N.fallback[0], N.fallback[1], N.fallback[2], N.fallback[3]));
        If(sum.greaterThanEqual(1e-3), () => {
          ao.assign(
            loadGL(tAo, t00, halfSize.y)
              .mul(w.x)
              .add(loadGL(tAo, t10, halfSize.y).mul(w.y))
              .add(loadGL(tAo, t01, halfSize.y).mul(w.z))
              .add(loadGL(tAo, t11, halfSize.y).mul(w.w))
              .div(sum),
          );
        });
      }
      const ceiling = pow(float(2), ao.b.mul(SSAO_CEILING_LOG_SPAN).add(SSAO_CEILING_LOG_MIN)).toVar();
      const fogKeep = exp(fogDensity.mul(fogDensity).mul(z).mul(z).negate()).toVar();
      const surface = max(c.rgb.sub(fogColor.mul(float(1).sub(fogKeep))), 0).toVar();
      const lum = lumaOf(surface).div(max(fogKeep, N.fogFloor)).toVar();
      const albedo = clamp(lum.div(max(ceiling, N.ceilingFloor)), 0, N.albedoMost);
      // aoMultiBounce
      const vv = pow(ao.r, power);
      const ka = albedo.mul(N.bounce.a[0]).add(N.bounce.a[1]);
      const kb = albedo.mul(N.bounce.b[0]).add(N.bounce.b[1]);
      const kc = albedo.mul(N.bounce.c[0]).add(N.bounce.c[1]);
      const v = min(max(vv, vv.mul(ka).add(kb).mul(vv).add(kc).mul(vv)), 1);
      const weight = mix(ao.g, float(1), directShare).mul(fade).mul(min(strength, 1)).toVar();
      // Water writes no depth: where its coverage is (the stand-in drawn into the region's green), nothing darkens.
      If(waterOn.equal(1), () => {
        weight.mulAssign(float(1).sub(step(1e-4, loadGL(tWater, p, fullSize.y).y)));
      });
      const lit = ceiling.mul(SSAO_ALBEDO_CEILING);
      const accountable = select(lum.greaterThan(lit), lit.div(lum), float(1));
      const darken = float(1).sub(v).mul(weight).mul(accountable).toVar();
      If(debug.equal(1), () => {
        out.assign(vec4(vec3(float(1).sub(darken)), 1));
      }).Else(() => {
        out.assign(vec4(c.rgb.sub(surface.mul(darken)), c.a));
      });
    });
    return out;
  })();
  return graph(m, 6, {
    uniforms: { uTanHalfFov: tan, uFullSize: fullSize, uNear: near, uFar: far, uFadeStart: fadeStart, uFadeEnd: fadeEnd, uStrength: strength, uPower: power, uDirectShare: directShare, uFogColor: fogColor, uFogDensity: fogDensity, uSplit: split, uDebug: debug, uWaterMask: waterOn },
    textures: { tDiffuse, tDepth, tAo, tLinear, tNormal, tWater },
  });
}

// ---------------------------------------------------------------- the probe (`ssao.ts`'s SSAO_PROBE_FRAG)

export function probeGraph(u: SsaoUniforms, reversed: boolean, depthType: THREE.TextureDataType): ChainGraph {
  const p = u.pU;
  const m = chainMaterial('fx.gpu.ssao.probe');
  const tDepth = slot(p.tDepth, 'depth', depthType);
  const tAo = slot(p.tAo, 'rgba8');
  const pixel = ref(p.uPixel);
  const aoTexel = ref(p.uAoTexel);
  const near = live(p.uNear);
  const far = live(p.uFar);
  // The heights the pixel and the texel are counted from the bottom of: the GTAO's own sizes (the WebGL probe fetches in GL's rows).
  const fullSize = ref(u.gU.uFullSize);
  const aoSize = ref(u.gU.uAoSize);
  m.fragmentNode = Fn(() => {
    const d = float(loadGL(tDepth, ivec2(pixel), fullSize.y).x).toVar();
    const ao = vec4(loadGL(tAo, ivec2(aoTexel), aoSize.y)).toVar();
    return vec4(select(skyOf(d, reversed), float(-1), viewZOf(d, near, far, reversed)), ao.r, ao.g, ao.b);
  })();
  return graph(m, 2, { uniforms: { uPixel: pixel, uAoTexel: aoTexel, uNear: near, uFar: far }, textures: { tDepth, tAo } });
}

// ---------------------------------------------------------------- the region read and the water's coverage

/**
 * Added, one and one: the region target is red and green alone (no alpha), and WebGPU refuses a blend that reads an alpha
 * the target has not got (three's additive blending is the source's alpha and one).
 */
function addOne(m: NodeMaterial): void {
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquation = THREE.AddEquation;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.blendEquationAlpha = THREE.AddEquation;
}

/** The rooms' region: red where the stencil holds the rooms' value (the WebGL region material's own stencil state, copied at each draw). */
export function regionGraph(): ChainGraph {
  const m = chainMaterial('fx.gpu.ssao.region');
  m.fragmentNode = vec4(1, 0, 0, 1);
  addOne(m);
  m.stencilWrite = true;
  m.stencilFunc = THREE.EqualStencilFunc;
  m.stencilRef = 1;
  m.stencilFuncMask = 0xff;
  m.stencilWriteMask = 0x00;
  m.stencilFail = THREE.KeepStencilOp;
  m.stencilZFail = THREE.KeepStencilOp;
  m.stencilZPass = THREE.KeepStencilOp;
  return graph(m, 0, { uniforms: {}, textures: {} });
}

/**
 * The water stand-ins' coverage: green wherever a water body's twin is in front of the scene's depth, drawn into the region
 * target (which shares that depth), never writing it; both faces, added, so two twins over one pixel still read covered.
 */
export function waterCoverageMaterial(): NodeMaterial {
  const m = new NodeMaterial();
  m.name = 'fx.gpu.ssao.water';
  (m as Any).lights = false;
  m.fog = false;
  m.toneMapped = false;
  m.depthTest = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  addOne(m);
  m.fragmentNode = vec4(0, 1, 0, 1);
  return m;
}

// ---------------------------------------------------------------- the two depth products (`products.ts`)

/** `LinearDepthHalf`: the distance along the view axis at the full pixel a half texel stands over, in a 32-bit float. */
export function linearDepthHalfGraph(u: Record<string, { value: Any }>, reversed: boolean, depthType: THREE.TextureDataType): ChainGraph {
  const m = chainMaterial('fx.gpu.linearDepthHalf');
  const tDepth = slot(u.tDepth, 'depth', depthType);
  const nearFar = ref(u.uNearFar);
  const fullTexel = ref(u.uFullTexel);
  m.fragmentNode = Fn(() => {
    // `texture2D(tDepth, vUv + uFullTexel * 0.5)` of a nearest-filtered picture: the texel that point falls in, by WebGL's rows.
    const at = vec2(uv().x, float(1).sub(uv().y)).add(fullTexel.mul(0.5));
    const size = vec2(1).div(fullTexel);
    const c = clamp(ivec2(floor(at.mul(size))), ivec2(0), ivec2(size).sub(1));
    const d = float(loadGL(tDepth, c, size.y).x).toVar();
    return vec4(select(skyOf(d, reversed), nearFar.y, viewZOf(d, nearFar.x, nearFar.y, reversed)), 0, 0, 1);
  })();
  return graph(m, 1, { uniforms: { uNearFar: nearFar, uFullTexel: fullTexel }, textures: { tDepth } });
}

/** `NormalsHalf`: each surface's facing from the distances round it, the nearer neighbour on each axis. */
export function normalsHalfGraph(u: Record<string, { value: Any }>): ChainGraph {
  const m = chainMaterial('fx.gpu.normalsHalf');
  const tLinear = slot(u.tLinear, 'linear');
  const texel = ref(u.uTexel);
  const tan = ref(u.uTanHalfFov);
  const far = live(u.uFar);
  m.fragmentNode = Fn(() => {
    const at = vec2(uv().x, float(1).sub(uv().y)).toVar();
    // Every tap first, at the top (rule 3); a nearest-filtered picture is fetched, never filtered.
    const z = float(sampleGL(tLinear, at).x).toVar();
    const zl = float(sampleGL(tLinear, at.sub(vec2(texel.x, 0))).x).toVar();
    const zr = float(sampleGL(tLinear, at.add(vec2(texel.x, 0))).x).toVar();
    const zd = float(sampleGL(tLinear, at.sub(vec2(0, texel.y))).x).toVar();
    const zu = float(sampleGL(tLinear, at.add(vec2(0, texel.y))).x).toVar();
    const out = vec4(0.5, 0.5, 1, 0).toVar();
    If(z.lessThan(far.mul(N.normalsFar)), () => {
      const p = viewPos(at, z, tan).toVar();
      const dx = select(abs(zr.sub(z)).lessThan(abs(z.sub(zl))), viewPos(at.add(vec2(texel.x, 0)), zr, tan).sub(p), p.sub(viewPos(at.sub(vec2(texel.x, 0)), zl, tan))).toVar();
      const dy = select(abs(zu.sub(z)).lessThan(abs(z.sub(zd))), viewPos(at.add(vec2(0, texel.y)), zu, tan).sub(p), p.sub(viewPos(at.sub(vec2(0, texel.y)), zd, tan))).toVar();
      const c = cross(dx, dy).toVar();
      const l = length(c);
      const n = select(l.greaterThan(1e-8), c.div(l), vec3(0, 0, 1));
      out.assign(vec4(n.mul(0.5).add(0.5), 1));
    });
    return out;
  })();
  return graph(m, 1, { uniforms: { uTexel: texel, uTanHalfFov: tan, uFar: far }, textures: { tLinear } });
}

// ---------------------------------------------------------------- the debug view (`passes.ts`'s DEBUG_VIEW, the modes the occlusion's views and the two products use)

/**
 * The debug view's modes 0 (the scene's raw colour), 1 (a distance in grey), 2 (colour times a scale), 3 (one channel times
 * a scale) and 6 (the scene's depth in grey); any other mode shows the scene's raw colour (the views of passes not ported).
 * Drawn onto the canvas as WebGL draws it there (no tone mapping, no colour space: `swgRawOut`), its numbers as they are.
 */
export function debugViewGraph(u: Record<string, { value: Any }>, reversed: boolean, depthType: THREE.TextureDataType): ChainGraph {
  const m = chainMaterial('fx.gpu.debugView');
  (m as Any).swgRawOut = true;
  const tScene = slot(u.tScene, 'half');
  // The shown picture is a colour texture or the scene's depth, and a slot's kind is fixed when its graph is built: two
  // slots, each reading the shown picture only when it is its kind (the other reads its fallback), the mode picks which.
  const shown = u.tShown as { value: THREE.Texture | null };
  const tShown = liveTexture({ get value() { return shown.value && !(shown.value as Any).isDepthTexture ? shown.value : null; } } as never, fallbackOf('half'));
  const tDepth = liveTexture({ get value() { return shown.value && (shown.value as Any).isDepthTexture ? shown.value : null; } } as never, fallbackOf('depth', depthType));
  const mode = live(u.uMode);
  const channel = live(u.uChannel);
  const scale = live(u.uScale);
  const nearFar = ref(u.uNearFar);
  m.fragmentNode = Fn(() => {
    const at = uv();
    // Every picture first, at the top (rule 3).
    const raw = vec3(tScene.sample(at).rgb).toVar();
    const s = vec4(tShown.sample(at)).toVar();
    const d = float(tDepth.sample(at).x).toVar();
    const grey = (zv: Any): Any => log2(max(zv, 0).add(1)).div(log2(nearFar.y.add(1)));
    const c = vec3(raw.div(raw.add(1))).toVar();
    If(mode.equal(1), () => {
      c.assign(vec3(grey(s.r)));
    })
      .ElseIf(mode.equal(2), () => {
        c.assign(s.rgb.mul(scale));
      })
      .ElseIf(mode.equal(3), () => {
        const v = select(channel.equal(0), s.r, select(channel.equal(1), s.g, select(channel.equal(2), s.b, s.a)));
        c.assign(vec3(v.mul(scale)));
      })
      .ElseIf(mode.equal(6), () => {
        c.assign(vec3(grey(viewZOf(d, nearFar.x, nearFar.y, reversed))));
      });
    // WebGL writes the view onto the canvas as it is: carried back only where three's own output pass tone-maps after it.
    return asShownFB(vec4(c, 1));
  })();
  return graph(m, 3, { uniforms: { uMode: mode, uChannel: channel, uScale: scale, uNearFar: nearFar }, textures: { tScene, tShown, tDepth } });
}