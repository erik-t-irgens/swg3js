// Ambient occlusion: the share of the sky's (or a room's) ambient light a surface cannot see, found
// from the frame's depth and taken off only that share of each pixel's light.
//
// The occlusion is ground-truth ambient occlusion (a horizon search in three view-aligned slices,
// two steps a side, the cosine-weighted visibility integrated in closed form), at half resolution by
// default, cleaned by a depth-aware separable blur and brought back to full size by weighting the
// four half-resolution taps by how far this pixel lies off each one's plane. One pass, four
// full-screen draws, and a fifth (a stencil read) while rooms are lit or the camera is in a building.
//
// What gets darkened. At each surface the pass works out the lights that drew it, as luminances: the
// sky's set outdoors (the hemisphere and the fill as ambient; the sun through its cascades, one
// shadow tap, and the torch as direct), the rooms' set where the portal renderer's stencil says the
// interior pass drew (the cell's ambient as ambient; its parallel light and lamps as direct), and the
// flash lights in both. For a diffuse surface `colour x mix(1, ao, ambient / (ambient + direct))` is
// exactly occlusion applied to the ambient term alone, so sunlit and lamp-lit surfaces keep their
// light. A pixel brighter than any surface lit that way could be (a glow, a blade, a bolt, lava, a
// highlight) is left alone in proportion; fog is taken out before darkening and put back after; the
// sky and water (the water mask's coverage) are never darkened.
//
// Every number the shaders use comes from ssaoMath.ts, which a node test checks.
import * as THREE from 'three';
import type { FxFrameContext } from './context';
import type { PostFX } from '../postfx';
import type { FxProductId, FxSettings } from '../fxRegistry.ts';
import { createFxQuad, FX_CAMERA, type FxDebugTexture, type FxPass, type FxWarmItem } from './pass';
import { createSharedDepthTarget, disposeSharedDepthTarget } from './geometry';
import { FX_BILATERAL_UPSAMPLE, FX_FULLSCREEN_VERTEX, FX_IGN, FX_LINEARIZE, FX_LUMA, FX_VIEW_POS } from './glsl';
import { FX_MAX_FLASH_LIGHTS, FX_MAX_ROOM_LIGHTS, type FxLights } from './lights';
import {
  decodeCeiling,
  SSAO_ALBEDO_CEILING,
  SSAO_BLUR_TOLERANCE,
  SSAO_CSM_FADE_MARGIN,
  SSAO_CEILING_LOG_MIN,
  SSAO_CEILING_LOG_SPAN,
  SSAO_FADE_END,
  SSAO_FADE_START,
  SSAO_FALLOFF,
  SSAO_MAX_RADIUS_SHARE,
  SSAO_MIN_FRACTION,
  SSAO_NEAR_RADIUS_AT,
  SSAO_NEAR_RADIUS_MIN,
  SSAO_OPEN_BIAS,
  SSAO_SLICES,
  SSAO_STEPS,
  ssaoRoomsStencil,
  ssaoShape,
  type SsaoShape,
} from './ssaoMath.ts';

/** A number as a GLSL float literal: an integer gets its `.0`. */
function glslFloat(v: number): string {
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

const MAX_POINTS = FX_MAX_FLASH_LIGHTS + FX_MAX_ROOM_LIGHTS;

/** aoZ: an AO texel's view depth, from the half-resolution depth or, at full resolution, the scene's own; shared by the GTAO and blur shaders. */
const AO_TEXELS = /* glsl */ `
  float aoZ(ivec2 t) {
  #ifdef AO_FULL
    float d = texelFetch(tDepth, t, 0).r;
    return d >= 1.0 ? uFar : fxViewZ(d, uNear, uFar);
  #else
    return texelFetch(tLinear, t, 0).r;
  #endif
  }
`;

export const SSAO_GTAO_FRAG = /* glsl */ `
  #define SLICES ${SSAO_SLICES}
  #define STEPS ${SSAO_STEPS}
  #define MAX_POINTS ${MAX_POINTS}
  #define PI 3.14159265
  #define HALF_PI 1.57079633
  #define CEILING_LOG_MIN ${glslFloat(SSAO_CEILING_LOG_MIN)}
  #define CEILING_LOG_SPAN ${glslFloat(SSAO_CEILING_LOG_SPAN)}
  #define MIN_FRACTION ${glslFloat(SSAO_MIN_FRACTION)}
  #define CSM_FADE_MARGIN ${glslFloat(SSAO_CSM_FADE_MARGIN)}
  uniform highp sampler2D tLinear;
  uniform highp sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform sampler2D tRegion;
  uniform vec2 uFullSize;
  uniform vec2 uAoSize;
  uniform vec2 uTanHalfFov;
  uniform float uNear;
  uniform float uFar;
  uniform float uFadeEnd;
  uniform float uRadius;
  uniform float uNearRadiusAt;
  uniform float uNearRadiusMin;
  uniform float uMaxRadiusPx;
  uniform float uFalloff;
  uniform float uThin;
  uniform float uOpenBias;
  uniform mat4 uCamToWorld;
  uniform vec2 uHemi;
  uniform vec4 uFill;
  uniform vec4 uSun;
  uniform vec4 uSpotPos;
  uniform vec4 uSpotDir;
  uniform vec3 uSpotCone;
  uniform int uCascades;
  uniform highp sampler2DShadow tShadow0;
  uniform highp sampler2DShadow tShadow1;
  uniform highp sampler2DShadow tShadow2;
  uniform mat4 uShadowMatrix[3];
  uniform vec4 uShadowParams[3];
  uniform vec2 uCascade[3];
  uniform float uShadowRange;
  uniform int uCascadeFade;
  uniform float uRoomAmbient;
  uniform vec4 uRoomParallel;
  uniform vec4 uPointPos[MAX_POINTS];
  uniform vec2 uPointLum[MAX_POINTS];
  uniform int uFlashCount;
  uniform int uRoomPointCount;
  uniform int uRegion;
  varying vec2 vUv;
  ${FX_LINEARIZE}
  ${FX_VIEW_POS}
  ${FX_IGN}
  ${FX_LUMA}
  ${AO_TEXELS}

  const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

  vec2 aoUv(ivec2 t) {
  #ifdef AO_FULL
    return (vec2(t) + 0.5) / uFullSize;
  #else
    return (vec2(t) * 2.0 + 1.5) / uFullSize;
  #endif
  }
  ivec2 fullTexel(ivec2 t) {
  #ifdef AO_FULL
    return t;
  #else
    return min(t * 2 + 1, ivec2(uFullSize) - 1);
  #endif
  }
  vec3 aoPos(ivec2 t) { return fxViewPos(aoUv(t), aoZ(t), uTanHalfFov); }
  vec3 aoNormal(ivec2 t, vec3 p, float z) {
  #ifdef AO_FULL
    ivec2 lim = ivec2(uAoSize) - 1;
    ivec2 tl = clamp(t - ivec2(1, 0), ivec2(0), lim), tr = clamp(t + ivec2(1, 0), ivec2(0), lim);
    ivec2 td = clamp(t - ivec2(0, 1), ivec2(0), lim), tu = clamp(t + ivec2(0, 1), ivec2(0), lim);
    float zl = aoZ(tl), zr = aoZ(tr), zd = aoZ(td), zu = aoZ(tu);
    vec3 dx = (tr != t && (tl == t || abs(zr - z) < abs(z - zl))) ? aoPos(tr) - p : p - aoPos(tl);
    vec3 dy = (tu != t && (td == t || abs(zu - z) < abs(z - zd))) ? aoPos(tu) - p : p - aoPos(td);
    vec3 c = cross(dx, dy);
    float l = length(c);
    return l > 1e-10 ? c / l : vec3(0.0, 0.0, 1.0);
  #else
    vec3 n = texelFetch(tNormal, t, 0).xyz * 2.0 - 1.0;
    float l = length(n);
    return l > 1e-4 ? n / l : vec3(0.0, 0.0, 1.0);
  #endif
  }

  float lightFalloff(float d, float cutoff, float decay) {
    float f = 1.0 / max(pow(d, decay), 0.01);
    if (cutoff > 0.0) {
      float x = d / cutoff;
      float s = clamp(1.0 - x * x * x * x, 0.0, 1.0);
      f *= s * s;
    }
    return f;
  }
  float pointsDirect(vec3 pw, vec3 nw, int from, int to) {
    float direct = 0.0;
    for (int i = 0; i < MAX_POINTS; i++) {
      if (i >= to) break;
      if (i < from) continue;
      vec3 l = uPointPos[i].xyz - pw;
      float d = length(l);
      float c = dot(nw, l) / max(d, 1e-4);
      if (c > 0.0) direct += uPointLum[i].x * c * lightFalloff(d, uPointPos[i].w, uPointLum[i].y);
    }
    return direct;
  }
  // cascadeShadowKeep in ssaoMath.ts: how much of the shadow the materials took at this depth. Past
  // the last cascade (and, with CSM's fade, through its far margin) three lights the sun unshadowed.
  float cascadeKeep(float ld) {
    float x = uCascade[2].x;
    float y = uCascade[2].y;
    if (uCascadeFade == 0) return ld < y ? 1.0 : 0.0;
    if (ld <= 0.5 * (x + y)) return 1.0;
    float m = max(CSM_FADE_MARGIN * y * y, 1e-6);
    return clamp(min(ld - (x - 0.5 * m), y + 0.5 * m - ld) / m, 0.0, 1.0);
  }
  float sunShadow(vec3 pw, vec3 nw, float viewZ) {
    if (uCascades == 0) return 1.0;
    float ld = viewZ / uShadowRange;
    float keep = cascadeKeep(ld);
    if (keep <= 0.0) return 1.0;
    int i = ld < uCascade[0].y ? 0 : (ld < uCascade[1].y ? 1 : 2);
    vec4 sc = uShadowMatrix[i] * vec4(pw + nw * uShadowParams[i].y, 1.0);
    sc.xyz /= sc.w;
    sc.z += uShadowParams[i].x;
    if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
    float s = i == 0 ? textureLod(tShadow0, sc.xyz, 0.0) : (i == 1 ? textureLod(tShadow1, sc.xyz, 0.0) : textureLod(tShadow2, sc.xyz, 0.0));
    return mix(1.0, s, uShadowParams[i].z * keep);
  }
  // The world pass's lights at a surface, split into what occlusion takes (sky, fill) and what it does not (sun, torch).
  void skyLight(vec3 pw, vec3 nw, float viewZ, out float indirect, out float direct) {
    indirect = mix(uHemi.y, uHemi.x, 0.5 * nw.y + 0.5) + uFill.w * max(dot(nw, uFill.xyz), 0.0);
    direct = 0.0;
    float ndl = dot(nw, uSun.xyz);
    if (uSun.w > 0.0 && ndl > 0.0) direct += uSun.w * ndl * sunShadow(pw, nw, viewZ);
    if (uSpotDir.w > 0.0) {
      vec3 l = uSpotPos.xyz - pw;
      float d = length(l);
      vec3 ld = l / max(d, 1e-4);
      float c = dot(nw, ld);
      float cone = smoothstep(uSpotCone.x, uSpotCone.y, dot(ld, uSpotDir.xyz));
      if (c > 0.0 && cone > 0.0) direct += uSpotDir.w * c * cone * lightFalloff(d, uSpotPos.w, uSpotCone.z);
    }
  }
  // The interior pass's lights: the cell's ambient, its parallel light and its lamps.
  void roomLight(vec3 pw, vec3 nw, out float indirect, out float direct) {
    indirect = uRoomAmbient;
    direct = uRoomParallel.w * max(dot(nw, uRoomParallel.xyz), 0.0) + pointsDirect(pw, nw, uFlashCount, uFlashCount + uRoomPointCount);
  }

  void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    float z = aoZ(t);
    if (z >= uFadeEnd) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
    vec3 P = fxViewPos(aoUv(t), z, uTanHalfFov);
    vec3 N = aoNormal(t, P, z);
    vec3 V = normalize(-P);
    vec3 pw = (uCamToWorld * vec4(P, 1.0)).xyz;
    vec3 nw = normalize(mat3(uCamToWorld) * N);
    float indirect, direct;
    if (uRegion == 1 && texelFetch(tRegion, fullTexel(t), 0).r > 0.5) roomLight(pw, nw, indirect, direct);
    else skyLight(pw, nw, z, indirect, direct);
    direct += pointsDirect(pw, nw, 0, uFlashCount);
    float total = indirect + direct;
    float fraction = total > 1e-4 ? indirect / total : 0.0;
    float ceilingEnc = clamp((log2(max(total / PI, 1e-6)) - CEILING_LOG_MIN) / CEILING_LOG_SPAN, 0.0, 1.0);
    vec4 open = vec4(1.0, fraction, ceilingEnc, 1.0);
    if (fraction < MIN_FRACTION) { gl_FragColor = open; return; }

    float radius = uRadius * clamp(z / uNearRadiusAt, uNearRadiusMin, 1.0);
    float pxPerMetre = uAoSize.y * 0.5 / (uTanHalfFov.y * z);
    float radiusPx = min(radius * pxPerMetre, uMaxRadiusPx);
    if (radiusPx < 1.5) { gl_FragColor = open; return; }
    radius = radiusPx / pxPerMetre;
    float falloffRange = uFalloff * radius;
    float falloffMul = -1.0 / falloffRange;
    float falloffAdd = (radius - falloffRange) / falloffRange + 1.0;
    float minS = 1.3 / radiusPx;
    ivec2 lim = ivec2(uAoSize) - 1;

    float noiseSlice = fxIgn(gl_FragCoord.xy);
    float noiseStep = (BAYER[(t.y & 3) * 4 + (t.x & 3)] + 0.5) / 16.0;
    float visibility = 0.0;
    for (int s = 0; s < SLICES; s++) {
      float phi = (float(s) + noiseSlice) * PI / float(SLICES);
      vec2 omega = vec2(cos(phi), sin(phi));
      vec3 dirV = vec3(omega, 0.0);
      vec3 ortho = dirV - dot(dirV, V) * V;
      vec3 axis = normalize(cross(ortho, V));
      vec3 projN = N - axis * dot(N, axis);
      float projLen = length(projN);
      float cosN = clamp(dot(projN, V) / max(projLen, 1e-4), 0.0, 1.0);
      float n = (dot(ortho, projN) < 0.0 ? -1.0 : 1.0) * acos(cosN);
      float low0 = cos(n + HALF_PI);
      float low1 = cos(n - HALF_PI);
      float hc0 = low0;
      float hc1 = low1;
      for (int j = 0; j < STEPS; j++) {
        float stepNoise = fract(noiseStep + float(s + j * STEPS) * 0.6180339887);
        float st = (float(j) + stepNoise) / float(STEPS);
        st = st * st + minS;
        ivec2 off = ivec2(round(omega * st * radiusPx));
        ivec2 t0 = t + off;
        ivec2 t1 = t - off;
        if (all(greaterThanEqual(t0, ivec2(0))) && all(lessThanEqual(t0, lim))) {
          vec3 d0 = aoPos(t0) - P;
          float l0 = length(d0);
          float w0 = clamp(length(vec3(d0.xy, d0.z * (1.0 + uThin))) * falloffMul + falloffAdd, 0.0, 1.0);
          hc0 = max(hc0, mix(low0, dot(d0, V) / max(l0, 1e-4), w0));
        }
        if (all(greaterThanEqual(t1, ivec2(0))) && all(lessThanEqual(t1, lim))) {
          vec3 d1 = aoPos(t1) - P;
          float l1 = length(d1);
          float w1 = clamp(length(vec3(d1.xy, d1.z * (1.0 + uThin))) * falloffMul + falloffAdd, 0.0, 1.0);
          hc1 = max(hc1, mix(low1, dot(d1, V) / max(l1, 1e-4), w1));
        }
      }
      float h0 = -acos(clamp(hc1, -1.0, 1.0));
      float h1 = acos(clamp(hc0, -1.0, 1.0));
      h0 = n + clamp(h0 - n, -HALF_PI, HALF_PI);
      h1 = n + clamp(h1 - n, -HALF_PI, HALF_PI);
      float sinN = sin(n);
      float a0 = (cosN + 2.0 * h0 * sinN - cos(2.0 * h0 - n)) * 0.25;
      float a1 = (cosN + 2.0 * h1 * sinN - cos(2.0 * h1 - n)) * 0.25;
      visibility += projLen * (a0 + a1);
    }
    visibility = clamp(visibility / (float(SLICES) * uOpenBias), 0.0, 1.0);
    gl_FragColor = vec4(visibility, fraction, ceilingEnc, 1.0);
  }
`;

export const SSAO_BLUR_FRAG = /* glsl */ `
  uniform sampler2D tAo;
  uniform highp sampler2D tLinear;
  uniform highp sampler2D tDepth;
  uniform ivec2 uStep;
  uniform float uNear;
  uniform float uFar;
  uniform float uFadeEnd;
  uniform float uBlurTolerance;
  varying vec2 vUv;
  ${FX_LINEARIZE}
  ${AO_TEXELS}
  // A Gaussian of sigma 2 over -4..4: it passes 1.2% of the step pattern's 4-texel period.
  const float BW[5] = float[5](0.2042, 0.1802, 0.1238, 0.0663, 0.0276);
  void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    vec4 c0 = texelFetch(tAo, t, 0);
    float z0 = aoZ(t);
    if (z0 >= uFadeEnd) { gl_FragColor = c0; return; }
    ivec2 lim = textureSize(tAo, 0) - 1;
    float zm = aoZ(clamp(t - uStep, ivec2(0), lim));
    float zp = aoZ(clamp(t + uStep, ivec2(0), lim));
    // 1/z of a plane changes evenly across the screen: take the step from the side that continues this surface.
    float inv0 = 1.0 / z0;
    float dInv = abs(zp - z0) < abs(z0 - zm) ? 1.0 / zp - inv0 : inv0 - 1.0 / zm;
    float tolerance = z0 * uBlurTolerance + 0.05;
    vec4 sum = c0 * BW[0];
    float wsum = BW[0];
    for (int k = 1; k <= 4; k++) {
      for (int side = -1; side <= 1; side += 2) {
        int o = k * side;
        ivec2 tk = t + uStep * o;
        if (any(lessThan(tk, ivec2(0))) || any(greaterThan(tk, lim))) continue;
        float predicted = 1.0 / max(inv0 + dInv * float(o), 1e-6);
        float w = BW[k] * clamp(1.0 - abs(aoZ(tk) - predicted) / tolerance, 0.0, 1.0);
        sum += texelFetch(tAo, tk, 0) * w;
        wsum += w;
      }
    }
    gl_FragColor = sum / wsum;
  }
`;

export const SSAO_APPLY_FRAG = /* glsl */ `
  #define ALBEDO_CEILING ${glslFloat(SSAO_ALBEDO_CEILING)}
  #define CEILING_LOG_MIN ${glslFloat(SSAO_CEILING_LOG_MIN)}
  #define CEILING_LOG_SPAN ${glslFloat(SSAO_CEILING_LOG_SPAN)}
  uniform sampler2D tDiffuse;
  uniform highp sampler2D tDepth;
  uniform sampler2D tAo;
  uniform highp sampler2D tLinear;
  uniform sampler2D tNormal;
  uniform sampler2D tWater;
  uniform int uWaterMask;
  uniform vec2 uTanHalfFov;
  uniform vec2 uFullSize;
  uniform float uNear;
  uniform float uFar;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uStrength;
  uniform float uPower;
  uniform float uDirectShare;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uSplit;
  uniform int uDebug;
  varying vec2 vUv;
  ${FX_LINEARIZE}
  ${FX_VIEW_POS}
  ${FX_LUMA}
  ${FX_BILATERAL_UPSAMPLE}
  float aoMultiBounce(float v, float albedo) {
    float a = 2.0404 * albedo - 0.3324;
    float b = -4.7951 * albedo + 0.6417;
    float c = 2.7552 * albedo + 0.6903;
    return max(v, ((v * a + b) * v + c) * v);
  }
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    ivec2 p = ivec2(gl_FragCoord.xy);
    float d = texelFetch(tDepth, p, 0).r;
    float z = d >= 1.0 ? uFar : fxViewZ(d, uNear, uFar);
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, z);
    if (fade <= 0.0 || (uSplit > 0.0 && vUv.x > uSplit)) { gl_FragColor = uDebug == 1 ? vec4(1.0) : c; return; }
  #ifdef AO_FULL
    vec4 a = texelFetch(tAo, p, 0);
  #else
    vec4 a = fxBilateralUpsample(tAo, tLinear, tNormal, gl_FragCoord.xy, uFullSize, uTanHalfFov, z, vec4(1.0, 0.0, 0.5, 1.0));
  #endif
    float ceiling = pow(2.0, a.b * CEILING_LOG_SPAN + CEILING_LOG_MIN);
    float fogKeep = exp(-uFogDensity * uFogDensity * z * z);
    vec3 surface = max(c.rgb - uFogColor * (1.0 - fogKeep), 0.0);
    float lum = fxLuma(surface) / max(fogKeep, 1e-3);
    float albedo = clamp(lum / max(ceiling, 1e-4), 0.0, 0.9);
    // The fit overshoots 1 by up to 5e-5 at full visibility; held there, so nothing is brightened.
    float v = min(aoMultiBounce(pow(a.r, uPower), albedo), 1.0);
    float weight = mix(a.g, 1.0, uDirectShare) * fade * min(uStrength, 1.0);
    // Water writes no depth: the bed under it is not what is seen, so wherever the mask drew, nothing darkens.
    if (uWaterMask == 1) weight *= 1.0 - step(1e-4, texelFetch(tWater, p, 0).a);
    float lit = ceiling * ALBEDO_CEILING;
    float accountable = lum > lit ? lit / lum : 1.0;
    float darken = (1.0 - v) * weight * accountable;
    gl_FragColor = uDebug == 1 ? vec4(vec3(1.0 - darken), 1.0) : vec4(c.rgb - surface * darken, c.a);
  }
`;

/** Marks where the rooms' lights drew: the material's stencil test does the work. */
export const SSAO_REGION_FRAG = /* glsl */ `
  void main() { gl_FragColor = vec4(1.0); }
`;

export const SSAO_PROBE_FRAG = /* glsl */ `
  uniform highp sampler2D tDepth;
  uniform sampler2D tAo;
  uniform ivec2 uPixel;
  uniform ivec2 uAoTexel;
  uniform float uNear;
  uniform float uFar;
  ${FX_LINEARIZE}
  void main() {
    float d = texelFetch(tDepth, uPixel, 0).r;
    vec4 a = texelFetch(tAo, uAoTexel, 0);
    gl_FragColor = vec4(d >= 1.0 ? -1.0 : fxViewZ(d, uNear, uFar), a.r, a.g, a.b);
  }
`;

/** What the pass needs from its chain, given by the installer. */
export interface SsaoHost {
  /** Whether a product is registered (a map lookup, no allocation); asked every frame, so a product registered later is picked up. */
  hasProduct(id: FxProductId): boolean;
  /** A scene-size R8 target sharing the scene's depth-stencil texture; disposed with disposeSharedDepthTarget. */
  createRegionTarget(): THREE.WebGLRenderTarget;
}

/** The host a chain gives the pass: its product list and a region target sharing its depth. */
export function ssaoHostFor(postfx: PostFX): SsaoHost {
  return {
    hasProduct: (id) => postfx.product(id) !== undefined,
    createRegionTarget: () => createSharedDepthTarget(postfx, { format: THREE.RedFormat, type: THREE.UnsignedByteType, name: 'fx.ssao.region' }),
  };
}

/** Console tuning (`__debug.ssao`); never saved. */
export interface SsaoTune {
  /** Above 0: the picture past this share of the width is left without occlusion, for side-by-side comparison. */
  split: number;
  /** Metres, over the setting; null follows `ssaoRadius`. */
  radius: number | null;
  /** Over the shaped power; null follows the strength. */
  power: number | null;
  fadeStart: number;
  fadeEnd: number;
  falloff: number;
  thin: number;
  /** 1 is none. */
  openBias: number;
  /** 0 occludes only the ambient share; up to 1 also takes that share of the direct light (contact shade under small sunlit props). */
  directShare: number;
  /** False: the sky's lights everywhere and no stencil read, to compare. */
  region: boolean;
}

export const SSAO_TUNE_DEFAULTS: Readonly<SsaoTune> = {
  split: 0,
  radius: null,
  power: null,
  fadeStart: SSAO_FADE_START,
  fadeEnd: SSAO_FADE_END,
  falloff: SSAO_FALLOFF,
  thin: 0,
  openBias: SSAO_OPEN_BIAS,
  directShare: 0,
  region: true,
};

/** What the AO target holds under the crosshair after the blur (a GPU read-back, on demand only). */
export interface SsaoProbe {
  /** Metres along the view axis; null over sky. */
  viewZ: number | null;
  ao: number;
  fraction: number;
  ceiling: number;
}

/** What the last prepare chose, for the console. */
export interface SsaoLast {
  half: boolean;
  /** 'sky': no stencil read; 'rooms at 1': camera inside a building; 'rooms at 3': rooms through doors from outside. */
  lightSets: 'sky' | 'rooms at 1' | 'rooms at 3';
  waterMask: boolean;
}

/** The lights as read for the console: luminances and counts. */
export interface SsaoLightsReport {
  sky: { hemiSky: number; hemiGround: number; fill: number; sun: number; cascades: number; torch: number };
  rooms: { lit: boolean; cell: number; ambient: number; parallel: number; points: number };
  flash: number;
}

const HALF: readonly FxProductId[] = ['linearDepthHalf', 'normalsHalf'];
const HALF_WATER: readonly FxProductId[] = ['linearDepthHalf', 'normalsHalf', 'waterMask'];
const FULL: readonly FxProductId[] = [];
const FULL_WATER: readonly FxProductId[] = ['waterMask'];
const BLACK = new THREE.Color(0, 0, 0);
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The frame's lights, as the game hands them in drawFrame (`FxFrameContext.lights`), read through the
 * declared field so the compiler holds the wiring; null only if a caller built a context without them.
 */
function frameLights(ctx: FxFrameContext): FxLights | null {
  return ctx.lights ?? null;
}

function aoTarget(name: string): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    samples: 0,
  });
  rt.texture.name = name;
  return rt;
}

interface Quads {
  gtao: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  blur: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  apply: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
}

export class SsaoPass implements FxPass {
  readonly id = 'ssao' as const;
  readonly timerLabel = 'pass:ssao';
  readonly tune: SsaoTune = { ...SSAO_TUNE_DEFAULTS };
  readonly last: SsaoLast = { half: true, lightSets: 'sky', waterMask: false };

  private readonly aoA = aoTarget('fx.ssao.a');
  private readonly aoB = aoTarget('fx.ssao.b');
  private readonly region: THREE.WebGLRenderTarget;
  private debugTarget: THREE.WebGLRenderTarget | null = null;
  private readonly probeTarget: THREE.WebGLRenderTarget;
  private readonly probeBuffer = new Float32Array(4);

  /** One uniform record per shader, shared by its half and full materials. */
  private readonly gU: Record<string, THREE.IUniform>;
  private readonly bU: Record<string, THREE.IUniform>;
  private readonly aU: Record<string, THREE.IUniform>;
  private readonly pU: Record<string, THREE.IUniform>;
  private readonly halfQuads: Quads;
  private readonly fullQuads: Quads;
  private readonly regionMaterial: THREE.ShaderMaterial;
  private readonly regionQuad: THREE.Mesh;
  private readonly probeMaterial: THREE.ShaderMaterial;
  private readonly probeQuad: THREE.Mesh;
  private readonly all: THREE.ShaderMaterial[];
  private readonly debugList: FxDebugTexture[];
  private readonly shape: SsaoShape = { weight: 1, power: 1.5 };
  private readonly savedClear = new THREE.Color();
  /** What the shadow samplers hold while there are no cascades: a real 1x1 compare-mode depth texture (never read then). */
  private readonly noShadow: THREE.DepthTexture;

  private half = true;
  private useRegion = false;
  /** The frame number render last ran in; the context's counter moves on at the end of that frame. */
  private drawnFrame = -2;

  constructor(private readonly host: SsaoHost) {
    this.region = host.createRegionTarget();
    this.region.texture.minFilter = THREE.NearestFilter;
    this.region.texture.magFilter = THREE.NearestFilter;
    this.region.texture.generateMipmaps = false;
    this.probeTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, samples: 0 });
    this.probeTarget.texture.name = 'fx.ssao.probe';
    this.noShadow = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.noShadow.name = 'fx.ssao.noShadow';
    this.noShadow.compareFunction = THREE.LessEqualCompare;
    this.noShadow.needsUpdate = true;

    this.gU = {
      tLinear: { value: null },
      tDepth: { value: null },
      tNormal: { value: null },
      tRegion: { value: null },
      uFullSize: { value: new THREE.Vector2(1, 1) },
      uAoSize: { value: new THREE.Vector2(1, 1) },
      uTanHalfFov: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.05 },
      uFar: { value: 9000 },
      uFadeEnd: { value: SSAO_FADE_END },
      uRadius: { value: 1.2 },
      uNearRadiusAt: { value: SSAO_NEAR_RADIUS_AT },
      uNearRadiusMin: { value: SSAO_NEAR_RADIUS_MIN },
      uMaxRadiusPx: { value: 1 },
      uFalloff: { value: SSAO_FALLOFF },
      uThin: { value: 0 },
      uOpenBias: { value: SSAO_OPEN_BIAS },
      uCamToWorld: { value: new THREE.Matrix4() },
      uHemi: { value: new THREE.Vector2() },
      uFill: { value: new THREE.Vector4(0, 1, 0, 0) },
      uSun: { value: new THREE.Vector4(0, 1, 0, 0) },
      uSpotPos: { value: new THREE.Vector4() },
      uSpotDir: { value: new THREE.Vector4(0, 1, 0, 0) },
      uSpotCone: { value: new THREE.Vector3(1, 1, 2) },
      uCascades: { value: 0 },
      tShadow0: { value: this.noShadow },
      tShadow1: { value: this.noShadow },
      tShadow2: { value: this.noShadow },
      uShadowMatrix: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] },
      uShadowParams: { value: new Float32Array(12) },
      uCascade: { value: new Float32Array(6) },
      uShadowRange: { value: 1 },
      uCascadeFade: { value: 0 },
      uRoomAmbient: { value: 0 },
      uRoomParallel: { value: new THREE.Vector4(0, 1, 0, 0) },
      uPointPos: { value: new Float32Array(MAX_POINTS * 4) },
      uPointLum: { value: new Float32Array(MAX_POINTS * 2) },
      uFlashCount: { value: 0 },
      uRoomPointCount: { value: 0 },
      uRegion: { value: 0 },
    };
    this.bU = {
      tAo: { value: null },
      tLinear: { value: null },
      tDepth: { value: null },
      uStep: { value: new THREE.Vector2(1, 0) },
      uNear: { value: 0.05 },
      uFar: { value: 9000 },
      uFadeEnd: { value: SSAO_FADE_END },
      uBlurTolerance: { value: SSAO_BLUR_TOLERANCE },
    };
    this.aU = {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tAo: { value: null },
      tLinear: { value: null },
      tNormal: { value: null },
      tWater: { value: null },
      uWaterMask: { value: 0 },
      uTanHalfFov: { value: new THREE.Vector2(1, 1) },
      uFullSize: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.05 },
      uFar: { value: 9000 },
      uFadeStart: { value: SSAO_FADE_START },
      uFadeEnd: { value: SSAO_FADE_END },
      uStrength: { value: 1 },
      uPower: { value: 1.5 },
      uDirectShare: { value: 0 },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0 },
      uSplit: { value: 0 },
      uDebug: { value: 0 },
    };
    this.pU = {
      tDepth: { value: null },
      tAo: { value: null },
      uPixel: { value: new THREE.Vector2() },
      uAoTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.05 },
      uFar: { value: 9000 },
    };

    const make = (uniforms: Record<string, THREE.IUniform>, fragmentShader: string, full: boolean) =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: FX_FULLSCREEN_VERTEX,
        fragmentShader,
        defines: full ? { AO_FULL: '' } : {},
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
    const quads = (full: boolean): Quads => ({
      gtao: createFxQuad(make(this.gU, SSAO_GTAO_FRAG, full)) as Quads['gtao'],
      blur: createFxQuad(make(this.bU, SSAO_BLUR_FRAG, full)) as Quads['blur'],
      apply: createFxQuad(make(this.aU, SSAO_APPLY_FRAG, full)) as Quads['apply'],
    });
    this.halfQuads = quads(false);
    this.fullQuads = quads(true);

    // The stencil read: tested Equal against the value that marks the rooms, never written; no
    // depth test or write. A target sharing the scene's depth-stencil texture is bound for it.
    this.regionMaterial = make({}, SSAO_REGION_FRAG, false);
    const rm = this.regionMaterial;
    rm.stencilWrite = true;
    rm.stencilFunc = THREE.EqualStencilFunc;
    rm.stencilRef = 1;
    rm.stencilFuncMask = 0xff;
    rm.stencilWriteMask = 0x00;
    rm.stencilFail = THREE.KeepStencilOp;
    rm.stencilZFail = THREE.KeepStencilOp;
    rm.stencilZPass = THREE.KeepStencilOp;
    this.regionQuad = createFxQuad(rm);
    this.probeMaterial = make(this.pU, SSAO_PROBE_FRAG, false);
    this.probeQuad = createFxQuad(this.probeMaterial);

    this.all = [
      this.halfQuads.gtao.material,
      this.fullQuads.gtao.material,
      this.halfQuads.blur.material,
      this.fullQuads.blur.material,
      this.halfQuads.apply.material,
      this.fullQuads.apply.material,
      this.regionMaterial,
      this.probeMaterial,
    ];
    this.debugList = [
      { name: 'ao', texture: this.aoA.texture, channels: 'r' },
      { name: 'fraction', texture: this.aoA.texture, channels: 'g' },
      // The log2 encoding: mid-grey is a ceiling of 1.
      { name: 'ceiling', texture: this.aoA.texture, channels: 'b' },
      { name: 'multiplier', texture: this.aoA.texture, channels: 'r' },
      { name: 'region', texture: this.region.texture, channels: 'r' },
    ];
  }

  enabled(ctx: FxFrameContext): boolean {
    return ctx.settings.ssaoStrength > 0.001 && frameLights(ctx) !== null;
  }

  reason(ctx: FxFrameContext): string | null {
    if (ctx.settings.ssaoStrength <= 0.001) return 'ambient occlusion strength is zero';
    if (!frameLights(ctx)) return 'the game has not handed the frame its lights (FxFrameContext.lights)';
    return null;
  }

  needs(ctx: FxFrameContext): readonly FxProductId[] {
    const water = ctx.waterInView && this.host.hasProduct('waterMask');
    return this.half ? (water ? HALF_WATER : HALF) : water ? FULL_WATER : FULL;
  }

  prepare(ctx: FxFrameContext): void {
    const L = frameLights(ctx);
    if (!L) return;
    const tune = this.tune;
    const half = this.half;
    this.last.half = half;
    const g = this.gU;
    const b = this.bU;
    const a = this.aU;
    const linear = half ? ctx.products.linearDepthHalf : null;
    const normals = half ? ctx.products.normalsHalf : null;

    // 1. The frame.
    (g.uAoSize.value as THREE.Vector2).set(this.aoA.width, this.aoA.height);
    (g.uFullSize.value as THREE.Vector2).set(ctx.width, ctx.height);
    (g.uTanHalfFov.value as THREE.Vector2).copy(ctx.tanHalfFov);
    g.uNear.value = ctx.near;
    g.uFar.value = ctx.far;
    (g.uCamToWorld.value as THREE.Matrix4).copy(ctx.camera.matrixWorld);

    // 2. The search.
    g.uRadius.value = tune.radius ?? ctx.settings.ssaoRadius;
    g.uMaxRadiusPx.value = SSAO_MAX_RADIUS_SHARE * this.aoA.height;
    g.uFalloff.value = tune.falloff;
    g.uThin.value = tune.thin;
    g.uFadeEnd.value = tune.fadeEnd;
    g.uOpenBias.value = tune.openBias;
    g.tLinear.value = linear;
    g.tNormal.value = normals;
    g.tDepth.value = ctx.depth;

    // 3. The sky's set.
    const S = L.sky;
    (g.uHemi.value as THREE.Vector2).set(S.hemiSkyLuminance, S.hemiGroundLuminance);
    (g.uFill.value as THREE.Vector4).set(S.fill.direction.x, S.fill.direction.y, S.fill.direction.z, S.fill.luminance);
    (g.uSun.value as THREE.Vector4).set(S.sun.direction.x, S.sun.direction.y, S.sun.direction.z, S.sun.luminance);
    const torch = S.torch;
    (g.uSpotPos.value as THREE.Vector4).set(torch.position.x, torch.position.y, torch.position.z, torch.distance);
    (g.uSpotDir.value as THREE.Vector4).set(torch.direction.x, torch.direction.y, torch.direction.z, torch.luminance);
    (g.uSpotCone.value as THREE.Vector3).set(torch.coneCos, torch.penumbraCos, torch.decay);
    const C = S.cascades;
    g.uCascades.value = C.count;
    // Every frame, so a map disposed while shadows were off is never left bound. Not null: three's
    // own empty shadow texture is never uploaded, so null binds no texture at all, and a shadow
    // sampler with no compare-mode texture behind it throws the whole draw away.
    const none = this.noShadow;
    g.tShadow0.value = C.count > 0 ? C.maps[0] : none;
    g.tShadow1.value = C.count > 0 ? C.maps[1] : none;
    g.tShadow2.value = C.count > 0 ? C.maps[2] : none;
    if (C.count > 0) {
      const m = g.uShadowMatrix.value as THREE.Matrix4[];
      for (let i = 0; i < 3; i++) m[i].copy(C.matrices[i]);
      (g.uShadowParams.value as Float32Array).set(C.params);
      (g.uCascade.value as Float32Array).set(C.ranges);
      g.uShadowRange.value = C.range;
      g.uCascadeFade.value = C.fade ? 1 : 0;
    }

    // 4. The rooms' set and where it applies.
    const R = L.rooms;
    const useRegion = tune.region && (ctx.portalView || R.lit);
    this.useRegion = useRegion;
    g.uRegion.value = useRegion ? 1 : 0;
    g.tRegion.value = useRegion ? this.region.texture : null;
    this.regionMaterial.stencilRef = ssaoRoomsStencil(ctx.portalView);
    g.uRoomAmbient.value = R.ambientLuminance;
    (g.uRoomParallel.value as THREE.Vector4).set(R.parallel.direction.x, R.parallel.direction.y, R.parallel.direction.z, R.parallel.luminance);
    const pos = g.uPointPos.value as Float32Array;
    const lum = g.uPointLum.value as Float32Array;
    let n = 0;
    for (let i = 0; i < L.flashCount && n < FX_MAX_FLASH_LIGHTS; i++, n++) {
      const p = L.flash[i];
      pos[n * 4] = p.position.x;
      pos[n * 4 + 1] = p.position.y;
      pos[n * 4 + 2] = p.position.z;
      pos[n * 4 + 3] = p.distance;
      lum[n * 2] = p.luminance;
      lum[n * 2 + 1] = p.decay;
    }
    const flash = n;
    if (useRegion) {
      for (let i = 0; i < R.pointCount && n < MAX_POINTS; i++, n++) {
        const p = R.points[i];
        pos[n * 4] = p.position.x;
        pos[n * 4 + 1] = p.position.y;
        pos[n * 4 + 2] = p.position.z;
        pos[n * 4 + 3] = p.distance;
        lum[n * 2] = p.luminance;
        lum[n * 2 + 1] = p.decay;
      }
    }
    g.uFlashCount.value = flash;
    g.uRoomPointCount.value = n - flash;
    this.last.lightSets = !useRegion ? 'sky' : ctx.portalView ? 'rooms at 1' : 'rooms at 3';

    // 5. The blur.
    b.tLinear.value = linear;
    b.tDepth.value = ctx.depth;
    b.uNear.value = ctx.near;
    b.uFar.value = ctx.far;
    b.uFadeEnd.value = tune.fadeEnd;

    // 6. The apply.
    const shape = ssaoShape(ctx.settings.ssaoStrength, this.shape);
    a.uStrength.value = shape.weight;
    a.uPower.value = tune.power ?? shape.power;
    a.uDirectShare.value = tune.directShare;
    a.uFadeStart.value = tune.fadeStart;
    a.uFadeEnd.value = tune.fadeEnd;
    (a.uFogColor.value as THREE.Color).copy(ctx.fogColor);
    a.uFogDensity.value = ctx.fogDensity;
    (a.uTanHalfFov.value as THREE.Vector2).copy(ctx.tanHalfFov);
    (a.uFullSize.value as THREE.Vector2).set(ctx.width, ctx.height);
    a.uNear.value = ctx.near;
    a.uFar.value = ctx.far;
    a.tDepth.value = ctx.depth;
    a.tLinear.value = linear;
    a.tNormal.value = normals;
    a.tAo.value = this.aoA.texture;
    // The mask's first texture carries coverage in alpha; asked for only while water is in view.
    const mask = ctx.products.waterMask;
    a.uWaterMask.value = mask ? 1 : 0;
    a.tWater.value = mask;
    this.last.waterMask = !!mask;
    a.uSplit.value = tune.split;
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const r = ctx.renderer;
    this.drawnFrame = ctx.frame;
    const q = this.half ? this.halfQuads : this.fullQuads;
    // The region is drawn when it is read, and cleared when only the debug view would show it, so the
    // view never shows a stale one.
    if (this.useRegion || ctx.debugViewPass === 'ssao') {
      // Colour only: the depth and stencil stay as the portal renderer left them, and are only tested.
      r.setRenderTarget(this.region);
      r.getClearColor(this.savedClear);
      const alpha = r.getClearAlpha();
      r.setClearColor(BLACK, 0);
      r.clear(true, false, false);
      r.setClearColor(this.savedClear, alpha);
      if (this.useRegion) r.render(this.regionQuad, FX_CAMERA);
    }
    r.setRenderTarget(this.aoA);
    r.render(q.gtao, FX_CAMERA);
    const b = this.bU;
    b.tAo.value = this.aoA.texture;
    (b.uStep.value as THREE.Vector2).set(1, 0);
    r.setRenderTarget(this.aoB);
    r.render(q.blur, FX_CAMERA);
    b.tAo.value = this.aoB.texture;
    (b.uStep.value as THREE.Vector2).set(0, 1);
    r.setRenderTarget(this.aoA);
    r.render(q.blur, FX_CAMERA);
    const a = this.aU;
    a.tDiffuse.value = input.texture;
    if (this.debugTarget) {
      a.uDebug.value = 1;
      r.setRenderTarget(this.debugTarget);
      r.render(q.apply, FX_CAMERA);
      a.uDebug.value = 0;
    }
    r.setRenderTarget(output);
    r.render(q.apply, FX_CAMERA);
    return true;
  }

  setSize(width: number, height: number, settings: FxSettings): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.half = settings.ssaoResolution < 1;
    const aw = this.half ? Math.ceil(w / 2) : w;
    const ah = this.half ? Math.ceil(h / 2) : h;
    this.aoA.setSize(aw, ah);
    this.aoB.setSize(aw, ah);
    // The same call that resizes the scene target, whose depth this one shares.
    this.region.setSize(w, h);
    this.debugTarget?.setSize(w, h);
  }

  materials(): FxWarmItem[] {
    // Both resolutions, so switching never compiles; the probe too, so the console never does.
    return this.all.map((material) => ({ material, where: 'target' as const }));
  }

  debugTextures(): readonly FxDebugTexture[] {
    return this.debugList;
  }

  /** Make (true) or free (false) the target the multiplier view draws into, and point that view at it. Never called from render. */
  setMultiplierView(on: boolean): void {
    const entry = this.debugList[3];
    if (on && !this.debugTarget) {
      const t = new THREE.WebGLRenderTarget(this.region.width, this.region.height, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
      });
      t.texture.name = 'fx.ssao.multiplier';
      this.debugTarget = t;
      entry.texture = t.texture;
    } else if (!on && this.debugTarget) {
      this.debugTarget.dispose();
      this.debugTarget = null;
      entry.texture = this.aoA.texture;
    }
  }

  /**
   * What the AO target holds under the crosshair, read back from the card (one GPU sync; the console
   * only). It reads the last frame's depth and occlusion; null when the pass did not draw then.
   */
  probe(ctx: FxFrameContext): SsaoProbe | null {
    // The runner moves the frame counter on as it finishes a frame, so the frame just drawn is one behind.
    if (this.drawnFrame !== ctx.frame - 1) return null;
    const r = ctx.renderer;
    const u = this.pU;
    const cx = ctx.width >> 1;
    const cy = ctx.height >> 1;
    u.tDepth.value = ctx.depth;
    u.tAo.value = this.aoA.texture;
    (u.uPixel.value as THREE.Vector2).set(cx, cy);
    if (this.last.half) (u.uAoTexel.value as THREE.Vector2).set(Math.min(cx >> 1, this.aoA.width - 1), Math.min(cy >> 1, this.aoA.height - 1));
    else (u.uAoTexel.value as THREE.Vector2).set(cx, cy);
    u.uNear.value = ctx.near;
    u.uFar.value = ctx.far;
    const previous = r.getRenderTarget();
    r.setRenderTarget(this.probeTarget);
    r.render(this.probeQuad, FX_CAMERA);
    r.readRenderTargetPixels(this.probeTarget, 0, 0, 1, 1, this.probeBuffer);
    r.setRenderTarget(previous);
    const v = this.probeBuffer;
    return { viewZ: v[0] < 0 ? null : round3(v[0]), ao: round3(v[1]), fraction: round3(v[2]), ceiling: round3(decodeCeiling(v[3])) };
  }

  /** The lights the pass reads this frame, as luminances and counts (for the console). */
  lightsReport(ctx: FxFrameContext): SsaoLightsReport | null {
    const L = frameLights(ctx);
    if (!L) return null;
    const S = L.sky;
    const R = L.rooms;
    return {
      sky: { hemiSky: round3(S.hemiSkyLuminance), hemiGround: round3(S.hemiGroundLuminance), fill: round3(S.fill.luminance), sun: round3(S.sun.luminance), cascades: S.cascades.count, torch: round3(S.torch.luminance) },
      rooms: { lit: R.lit, cell: R.cell, ambient: round3(R.ambientLuminance), parallel: round3(R.parallel.luminance), points: R.pointCount },
      flash: L.flashCount,
    };
  }

  /** The occlusion buffer's size in pixels: half the drawing buffer's each way, or all of it. */
  get aoSize(): [number, number] {
    return [this.aoA.width, this.aoA.height];
  }

  /** Whether the pass drew the frame just finished. */
  drewLastFrame(ctx: FxFrameContext): boolean {
    return this.drawnFrame === ctx.frame - 1;
  }

  dispose(): void {
    this.aoA.dispose();
    this.aoB.dispose();
    // The region shares the scene's depth-stencil texture: detached first, or it would go with it.
    disposeSharedDepthTarget(this.region);
    this.debugTarget?.dispose();
    this.debugTarget = null;
    this.probeTarget.dispose();
    this.noShadow.dispose();
    for (const m of this.all) m.dispose();
  }
}
