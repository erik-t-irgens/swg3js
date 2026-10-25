// The volume: the dust the moving air carries (src/world/volumetrics/), marched through the band of air over the
// ground near the camera and integrated past it, lit by the very sun and ambient the scene is lit by, darkened by the
// dust between it and the sun (the light pass: a lit face and a dark heart) and by the sun's own cascades (dust in a
// street's shade or under a hovering hull is dark), and composited as `scene · T + inscatter` (the design's §2.8).
//
// Built on the unfinished clouds pass's skeleton (`clouds.ts`) and on none of its code, whose imports a node test cannot
// load: an outdoor pass with an extinction composite, its own fraction of the screen, an upsample of its own size, a
// refusal with a reason. The four bugs that pass met are each kept out here and tested (`airVolume.test.ts`): every
// material says `NoBlending`; a far-plane depth texel is sky and never a surface; the upsample is worked out from the
// march's own size and never `fxHalfTaps`; and an amount of nought refuses rather than compositing a copy.
//
// **Grain** is hidden by an ordered 4×4 offset turned each frame and a history: the march writes a current target, a
// resolve blends it into a history reprojected through last frame's view at the scene depth clamped to the window's
// far side, clamped to the current 3×3 neighbourhood, reset on a cut. Off, the composite reads the current target.
//
// Every value import here carries its extension and nothing of `clouds.ts` is imported, so the node test loads it
// under plain type stripping.
//
// **From the third wave** it draws smoke and fog beside the dust, the dust in every tile of a field a layer, and the
// wisps: one march material a wisps mode (`WISP_MODE` 0 off, 1 bands, 2 noise, 3 noise ×2), all four compiled while the
// master is on and switched by the mode the field has in force (class M), since the Start's measurement found the one
// program with the modes as uniform branches too dear on Direct3D 11 (`W3-notes.md`).
import * as THREE from 'three';
import type { FxProductId, FxSettings } from '../fxRegistry.ts';
import type { FxFrameContext } from './context.ts';
import { createFxQuad, FX_CAMERA, type FxDebugTexture, type FxPass, type FxWarmItem } from './pass.ts';
import { FX_FULLSCREEN_VERTEX, FX_LINEARIZE, FX_SLAB, FX_VIEW_POS } from './glsl.ts';
import { SSAO_CSM_FADE_MARGIN } from './ssaoMath.ts';
import type { AirSource } from '../../world/volumetrics/airField.ts';
import { AIR_TUNE } from '../../world/volumetrics/airTune.ts';
import { AIR_ERF_GLSL, AIR_FOG_PROFILE_GLSL, AIR_PROFILE_GLSL, AIR_SMOKE_AT_GLSL } from '../../world/volumetrics/airShaders.ts';

/** The march's loop bound: no setting asks for more samples (`AIR_TUNE.volume.maxSteps`, 48). */
export const MAX_VOLUME_STEPS = 48;
/** The height-only taps that find where a ray lies in the band of air. */
export const FIND_TAPS = 8;

const NEEDS: readonly FxProductId[] = ['linearDepthHalf'];

const MARCH_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
varying vec2 vUv;
uniform sampler2D uDepth;
uniform sampler2D uDust;
uniform sampler2D uShape;
uniform sampler2D uLight;
uniform sampler2D uHeight;
uniform sampler2D uObstacles;
uniform vec2 uTanHalfFov;
uniform float uFar;
uniform mat3 uViewToWorld;
uniform vec3 uCamera;
uniform vec3 uCamFwd;
uniform vec4 uWindow;
uniform vec2 uLightShift;
uniform vec3 uBand;
uniform vec2 uInflow;
uniform vec3 uStormColour;
uniform float uLightOn;
uniform mat4 uHullInverse;
uniform vec4 uHullBox;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform int uSteps;
uniform float uAmount;
uniform float uFrame;
uniform float uBelow;
uniform float uAbove;
uniform float uFarReach;
uniform float uExtinction;
uniform vec3 uPhase;
uniform vec2 uLightK;
uniform int uCascades;
uniform highp sampler2DShadow tShadow0;
uniform highp sampler2DShadow tShadow1;
uniform highp sampler2DShadow tShadow2;
uniform mat4 uShadowMatrix[3];
uniform vec4 uShadowParams[3];
uniform vec2 uCascade[3];
uniform float uShadowRange;
uniform int uCascadeFade;
uniform float uShadowsOn;
// From wave 2b: the light pass's four heights over the ground; the dust's look (how bright, the debug view, the
// band's top, the thinnest spread); and H₀ with the near fade's two ends.
uniform vec4 uLightH;
uniform vec4 uLook;
uniform vec4 uShapeP;
#define uBright uLook.x
#define uDustView uLook.y
#define uBandTop uLook.z
#define uSpreadMin uLook.w
#define uH0 uShapeP.x
#define uNearFrom uShapeP.y
#define uNearTo uShapeP.z
// The third wave's: smoke (a slab a channel) and the fog (alpha), the smoke's colour, the gust noise the fog's top is
// varied by; the fog's hour (its top, whether it is carried, the top noise's cells a metre, the level) and the top
// noise's drift; whether the dust, the smoke and the fog are drawn and the view (0 none, 1 smoke, 2 fog, 3 the wisps'
// keep); the smoke's and the fog's extinction, the top's rise and its low share; the fog past the window, the dust's tiles
// and half a texel of one, the march's pixel angle; the smoke's colour where nothing tinted it.
uniform sampler2D uSmoke;
uniform sampler2D uSmokeTint;
uniform sampler2D uNoise2;
uniform vec4 uFog;
uniform vec2 uFogDrift;
uniform vec4 uAirP;
uniform vec4 uAirQ;
uniform vec4 uAirR;
uniform vec3 uSmokeGrey;
#define uDustOn uAirP.x
#define uSmokeOn uAirP.y
#define uFogOn uAirP.z
#define uAirView uAirP.w

${FX_LINEARIZE}
${FX_VIEW_POS}
${FX_SLAB}
${AIR_ERF_GLSL}
${AIR_PROFILE_GLSL}
${AIR_SMOKE_AT_GLSL}
${AIR_FOG_PROFILE_GLSL}

const float CSM_FADE_MARGIN = ${SSAO_CSM_FADE_MARGIN.toFixed(4)};

// The materials' own fade between the last cascade and none (the ambient occlusion's rule, ssaoMath.ts).
float cascadeKeep(float ld) {
  float x = uCascade[2].x;
  float y = uCascade[2].y;
  if (uCascadeFade == 0) return ld < y ? 1.0 : 0.0;
  if (ld <= 0.5 * (x + y)) return 1.0;
  float m = max(CSM_FADE_MARGIN * y * y, 1e-6);
  return clamp(min(ld - (x - 0.5 * m), y + 0.5 * m - ld) / m, 0.0, 1.0);
}
// One compare tap in the cascade this point's view depth picks: 1 lit, 0 in shade.
float sunShadow(vec3 pw, float viewZ) {
  if (uShadowsOn < 0.5 || uCascades == 0) return 1.0;
  float ld = viewZ / uShadowRange;
  float keep = cascadeKeep(ld);
  if (keep <= 0.0) return 1.0;
  int i = ld < uCascade[0].y ? 0 : (ld < uCascade[1].y ? 1 : 2);
  vec4 sc = uShadowMatrix[i] * vec4(pw, 1.0);
  sc.xyz /= sc.w;
  sc.z += uShadowParams[i].x;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  float s = i == 0 ? textureLod(tShadow0, sc.xyz, 0.0) : (i == 1 ? textureLod(tShadow1, sc.xyz, 0.0) : textureLod(tShadow2, sc.xyz, 0.0));
  return mix(1.0, s, uShadowParams[i].z * keep);
}
float bayer4(vec2 c) {
  vec2 m = mod(floor(c), 4.0);
  float b = mod(m.x + m.y * 2.0, 4.0) * 4.0 + mod(m.x * 2.0 + m.y, 4.0);
  return (b + 0.5) / 16.0;
}
vec2 windowUv(vec3 p) { return (p.xz - uWindow.xy) / uWindow.z; }
bool inWin(vec2 uv) { return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0; }
float phaseOf(float mu) { return uPhase.x + uPhase.y * pow(max(mu, 0.0), uPhase.z); }
// How far a point is over the ground of the window under it.
float overGround(vec3 p) { return p.y - texture(uHeight, windowUv(p)).r; }
// Where the air thins out: the band's top the field worked out from the lifts it queued, the storm, the smoke lingering and
// the fog's varied top (the third wave's high band), never under four of H₀ and never over the band's own ceiling.
float bandTop() { return min(uAbove, uBandTop); }
bool inHull(vec3 p) {
  if (uHullBox.w < 0.5) return false;
  vec3 q = (uHullInverse * vec4(p, 1.0)).xyz;
  return all(lessThan(abs(q), uHullBox.xyz));
}
// The optical depth toward the sun at h metres over the ground, from the light pass's four heights: piecewise linear
// between them, held at the lowest's below it and the highest's above it (lightDepthAtHeight is its mirror). The wisps'
// bands are read across the same four heights by the same rule.
float lightTau(vec4 t, float h) {
  if (h <= uLightH.x) return t.x;
  if (h <= uLightH.y) return mix(t.x, t.y, (h - uLightH.x) / max(uLightH.y - uLightH.x, 1e-3));
  if (h <= uLightH.z) return mix(t.y, t.z, (h - uLightH.y) / max(uLightH.z - uLightH.y, 1e-3));
  if (h <= uLightH.w) return mix(t.z, t.w, (h - uLightH.z) / max(uLightH.w - uLightH.z, 1e-3));
  return t.w;
}
// The optical depth of the storm's dust along t0..t1 of a ray past the window, in closed form over the window's mean
// ground (from wave 2b): D standing as the half-normal of the storm's spread, nought under the ground,
// D · (erf(b / σ√2) − erf(a / σ√2)) / |dy| (farHalfNormalDepth is its mirror).
float farDepth(float t0, float t1, float cy, float dy, float D) {
  if (t1 <= t0 || D <= 0.0) return 0.0;
  float G = uBand.z;
  float s = max(uInflow.y, 1e-3);
  float y0 = cy + dy * t0 - G;
  float y1 = cy + dy * t1 - G;
  if (abs(dy) < 1e-4) return D * airProfile(y0, 0.0, s) * (t1 - t0);
  float k = 1.0 / (1.4142135623730951 * s);
  return D * abs(airErf(max(y1, 0.0) * k) - airErf(max(y0, 0.0) * k)) / abs(dy);
}
// A dust tile's uv (a field a layer, Ultra's: three tiles side by side), clamped half a texel inside the tile.
vec2 tileUv(int k, vec2 q) {
  if (uAirR.y < 1.5) return q;
  float h = uAirR.z;
  return vec2((float(k) + clamp(q.x, h, 1.0 - h)) / uAirR.y, clamp(q.y, h, 1.0 - h));
}
// One dust tile's patch at a sample: its density by its carried shape (wave 2b's folded profile at H₀), and its colour,
// mean height, spread, age and rise for the views and the wisps.
float dustAt(vec2 uv, float hy, out vec3 tint, out float mu, out float sg, out float age, out float rise) {
  tint = uStormColour;
  mu = 0.0;
  sg = uSpreadMin;
  age = 0.0;
  rise = 0.0;
  vec4 d = texture(uDust, uv);
  float D = max(d.a, 0.0);
  if (D < 1e-5) return 0.0;
  // The patch's own carried shape (wave 2b's): its folded profile at its mean height and spread, so a unit of dust keeps
  // the first wave's column wherever its mass sits.
  vec4 sh = texture(uShape, uv);
  mu = sh.r / D;
  sg = sqrt(max(sh.g / D - mu * mu, uSpreadMin * uSpreadMin));
  age = sh.a / D;
  rise = sh.b / D;
  tint = d.a > 1e-4 ? d.rgb / d.a : uStormColour;
  float dens = D * uH0 * airProfile(hy, mu, sg) * uExtinction * uAmount;
  return dens;
}
#if WISP_MODE > 0
// The wisps (the third wave, the design's §2.14): the slabs' air read at a height (blended between the slabs' middles as
// the smoke is), a noise carried by it in two phases cross-faded (or, in the bands mode, the bands' pass read across the
// light's four heights), and the erosion's remap that is one at an erosion of nought.
uniform sampler2D uVelAtlas;
uniform vec4 uSlabTiles[3];
uniform vec4 uSlabScale;
uniform vec4 uSlabShare;
uniform vec2 uAtlasHalf;
uniform vec2 uWind;
// The noise's scale a metre, its stretch, the flow's period, the second octave's share; the two phases, the cross-fade
// and the age term's seconds; erode, erodeFull, keepColumn and keepFloor; the expected keep at sixteen erosions.
uniform vec4 uWispA;
uniform vec4 uWispB;
uniform vec4 uWispC;
uniform float uKeepTable[16];
#if WISP_MODE == 1
uniform sampler2D uBands;
#else
uniform highp sampler3D uNoise3;
#endif
vec2 slabVelM(vec2 q, int k) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return uWind * uSlabShare[k];
  vec4 r = uSlabTiles[k];
  vec2 a = r.xy + clamp(q * r.zw, uAtlasHalf, r.zw - uAtlasHalf);
  return textureLod(uVelAtlas, a, 0.0).xy * uSlabScale[k];
}
vec2 velAtHeight(vec2 q, float hy) {
  if (hy < uSlabMid.x) return slabVelM(q, 0);
  if (hy < uSlabMid.y) return mix(slabVelM(q, 0), slabVelM(q, 1), (hy - uSlabMid.x) / max(uSlabMid.y - uSlabMid.x, 1e-3));
  if (hy < uSlabMid.z) return mix(slabVelM(q, 1), slabVelM(q, 2), (hy - uSlabMid.y) / max(uSlabMid.z - uSlabMid.y, 1e-3));
  return slabVelM(q, 2);
}
// The eroding noise at a sample (0 to 1): textureLod at a level worked out from the sample's distance, never the
// implicit derivatives inside the march's divergent loop.
float wispNoise(vec3 p, vec2 q, float hy, float rise, float t) {
#if WISP_MODE == 1
  return lightTau(textureLod(uBands, q, 0.0), hy);
#else
  vec2 v = velAtHeight(q, hy);
  vec3 flow = vec3(v.x, rise, v.y) * uWispA.z;
  vec3 c = vec3(p.x, hy * uWispA.y, p.z) * uWispA.x;
  float lod = max(log2(max(t * uAirR.w * uWispA.x * float(textureSize(uNoise3, 0).x), 1e-6)), 0.0);
  float n = mix(textureLod(uNoise3, c - flow * uWispB.x * uWispA.x, lod).r, textureLod(uNoise3, c - flow * uWispB.y * uWispA.x + 0.37, lod).r, uWispB.z);
#if WISP_MODE == 3
  // The second octave at twice the scale, carried by the air a layer up: the upper wisps run ahead of the lower.
  vec2 v2 = velAtHeight(q, hy + (uSlabMid.y - uSlabMid.x));
  vec3 flow2 = vec3(v2.x, rise, v2.y) * uWispA.z;
  vec3 c2 = c * 2.03;
  float n2 = mix(textureLod(uNoise3, c2 - flow2 * uWispB.x * uWispA.x * 2.03, lod + 1.0).r, textureLod(uNoise3, c2 - flow2 * uWispB.y * uWispA.x * 2.03 + 0.61, lod + 1.0).r, uWispB.z);
  n = mix(n, n2, uWispA.w);
#endif
  return n;
#endif
}
// The expected keep at an erosion, from the table (linear between its entries): what keepColumn divides by.
float expectedKeep(float e) {
  float x = clamp(e, 0.0, 1.0) * 15.0;
  int i = int(floor(x));
  int j = i + 1 < 16 ? i + 1 : 15;
  return mix(uKeepTable[i], uKeepTable[j], x - float(i));
}
// The erosion's keep (wispKeep is its mirror): the cut brought in over the first erodeFull of erosion, one exactly at an
// erosion of nought, and with keepColumn the mean opacity held through the table, never divided by under keepFloor.
float wispKeep(float n, float e) {
  float ee = min(e, 1.0);
  float cut = clamp((n - ee) / max(1.0 - ee, 1e-3), 0.0, 1.0);
  float keep = mix(1.0, cut, clamp(ee / max(uWispC.y, 1e-3), 0.0, 1.0));
  if (uWispC.z > 0.0) keep /= max(mix(1.0, expectedKeep(ee), uWispC.z), uWispC.w);
  return keep;
}
#endif
void main() {
  vec3 dir = normalize(uViewToWorld * fxViewPos(vUv, 1.0, uTanHalfFov));
  // A far-plane depth texel is sky, not a surface nine kilometres off.
  float depth = texture(uDepth, vUv).r;
  float tScene = (depth > 0.0 && depth < uFar * 0.999) ? depth / max(dot(dir, uCamFwd), 1e-4) : 1e7;
  float top = bandTop();
  vec3 lo = vec3(uWindow.x, uBand.x - uBelow, uWindow.y);
  vec3 hi = vec3(uWindow.x + uWindow.z, uBand.y + top, uWindow.y + uWindow.z);
  vec2 hit = fxSlab(uCamera, dir, lo, hi);
  float ta = max(hit.x, 0.0);
  float tb = min(hit.y, tScene);
  float mu = dot(dir, uSunDir);
  float ph = phaseOf(mu);
  vec3 acc = vec3(0.0);
  float T = 1.0;
  // The debug views (uniform branches): the first dusty sample's carried colour or shape, or (the third wave's) the first
  // sample's smoke, fog or the wisps' keep, drawn opaque in place of the in-scatter.
  bool viewing = uDustView > 0.5;
  bool airViewing = uAirView > 0.5;
  bool viewed = false;
  vec3 view = vec3(0.0);
  float jitter = bayer4(gl_FragCoord.xy + vec2(mod(uFrame, 4.0), mod(floor(uFrame / 4.0), 4.0)));
  if (tb > ta) {
    // Where the ray lies in the band of air: height-only taps, a segment's margin each side.
    float seg = (tb - ta) / float(${FIND_TAPS});
    float fa = -1.0;
    float fb = -1.0;
    for (int i = 0; i < ${FIND_TAPS}; i++) {
      float t = ta + seg * (float(i) + 0.5);
      vec3 p = uCamera + dir * t;
      float hy = overGround(p);
      if (hy > -0.5 && hy < top) {
        if (fa < 0.0) fa = ta + seg * float(i);
        fb = ta + seg * float(i + 1);
      }
    }
    if (fa >= 0.0) {
      fa = max(ta, fa - seg);
      fb = min(tb, fb + seg);
      float span = fb - fa;
      int n = uSteps;
      for (int i = 0; i < ${MAX_VOLUME_STEPS}; i++) {
        if (i >= n || T < 0.02) break;
        // Samples a little closer together near the eye than far from it.
        float x = (float(i) + jitter) / float(n);
        float t = fa + span * 0.5 * (x + x * x);
        float dt = span * 0.5 * (1.0 + 2.0 * x) / float(n);
        vec3 p = uCamera + dir * t;
        vec2 uv = windowUv(p);
        if (!inWin(uv)) continue;
        float hy = p.y - texture(uHeight, uv).r;
        if (hy < 0.0) continue;
        // Inside a solid, below its top: a room seen through a door from outside takes no dust either. The green
        // channel: every wall, and the rooms of a compound too wide to be a wall itself (airObstacles.ts).
        if (texture(uObstacles, uv).g > hy) continue;
        if (inHull(p)) continue;
        // The dust, a tile at a time (one, or a field a layer), each eroded by the wisps.
        float densD = 0.0;
        vec3 colD = vec3(0.0);
        float keepSeen = 1.0;
#if WISP_MODE > 0
        bool haveN = false;
        float wn = 0.5;
#endif
        if (uDustOn > 0.5) {
          for (int k = 0; k < 3; k++) {
            if (float(k) >= uAirR.y) break;
            vec3 tint;
            float dmu;
            float sg;
            float age;
            float rise;
            float dk = dustAt(tileUv(k, uv), hy, tint, dmu, sg, age, rise);
            if (dk <= 0.0) continue;
            if (viewing) {
              view = uDustView < 1.5 ? tint : vec3(uDustView < 2.5 ? dmu / 10.0 : (uDustView < 3.5 ? sg / 4.0 : age / 20.0));
              viewed = true;
              break;
            }
#if WISP_MODE > 0
            if (uWispC.x > 0.0) {
              if (!haveN) {
                wn = wispNoise(p, uv, hy, rise, t);
                haveN = true;
              }
              float ag = 1.0;
              if (uWispB.w > 0.0) ag = smoothstep(0.0, uWispB.w, age);
              float e = uWispC.x * (0.4 + 0.6 * clamp(abs(hy - dmu) / sg, 0.0, 1.0)) * ag;
              float kp = wispKeep(wn, e);
              dk *= kp;
              keepSeen = min(keepSeen, kp);
            }
#endif
            densD += dk;
            colD += tint * dk;
          }
          if (viewed) break;
        }
        // Smoke and fog (the third wave): smoke interpolated between the slabs' middles in its own colour; the fog under
        // its varied top, in the scene's own fog colour, eroded by the wisps as the dust is.
        float densS = 0.0;
        float densF = 0.0;
        vec3 colS = uSmokeGrey;
        if (uSmokeOn > 0.5) {
          vec4 s = texture(uSmoke, uv);
          float sm = smokeAt(hy, s.xyz);
          if (sm > 1e-6) {
            densS = sm * uAirQ.x * uAmount;
            vec4 st = texture(uSmokeTint, uv);
            colS = st.a > 1e-4 ? st.rgb / st.a : uSmokeGrey;
          }
          if (uFogOn > 0.5 && s.w > 1e-6) {
            float tn = texture(uNoise2, (p.xz * uFog.z - uFogDrift) / float(textureSize(uNoise2, 0).x)).r;
            float ftop = uFog.x * (uAirQ.w + (1.0 + uAirQ.z - uAirQ.w) * tn);
            densF = s.w * fogProfileAt(hy, ftop) * uAirQ.y * uAmount;
#if WISP_MODE > 0
            if (uWispC.x > 0.0 && densF > 0.0) {
              if (!haveN) {
                wn = wispNoise(p, uv, hy, 0.0, t);
                haveN = true;
              }
              float kf = wispKeep(wn, uWispC.x * (0.4 + 0.6 * clamp(hy / max(ftop, 1e-3), 0.0, 1.0)));
              densF *= kf;
              keepSeen = min(keepSeen, kf);
            }
#endif
          }
          if (airViewing && (sm > 1e-6 || s.w > 1e-6 || keepSeen < 1.0)) {
            view = uAirView < 1.5 ? s.xyz : (uAirView < 2.5 ? vec3(s.w) : vec3(keepSeen));
            viewed = true;
            break;
          }
        } else if (airViewing && uAirView > 2.5 && keepSeen < 1.0) {
          view = vec3(keepSeen);
          viewed = true;
          break;
        }
        float dens = densD + densS + densF;
        // The clear bubble round the lens: a uniform branch round the whole term, never a smoothstep of equal edges.
        if (uNearTo > uNearFrom) dens *= smoothstep(uNearFrom, uNearTo, t);
        if (dens < 1e-4) continue;
        // What scatters here: the dust's carried colour at its brightness, the smoke's, the fog's, weighted by each one's share.
        vec3 tint = (colD * uBright + colS * densS + uFogColor * densF) / max(densD + densS + densF, 1e-6);
        float toSun = uLightOn > 0.5 ? exp(-max(lightTau(texture(uLight, uv + uLightShift), hy), 0.0)) : 1.0;
        float viewZ = dot(p - uCamera, uCamFwd);
        float vis = sunShadow(p, viewZ);
        vec3 lit = tint * (uSunColor * ph * toSun * vis * uLightK.x + uAmbient * uLightK.y);
        float fogT = exp(-(uFogDensity * t) * (uFogDensity * t));
        float a = 1.0 - exp(-dens * dt);
        acc += T * lit * a * fogT;
        T *= 1.0 - a;
      }
    }
  }
  if (viewed) {
    vec4 vo = vec4(view, 0.0);
    if (any(isnan(vo)) || any(isinf(vo))) vo = vec4(0.0, 0.0, 0.0, 1.0);
    gl_FragColor = vo;
    return;
  }
  // Past the window: the storm's dust along the rest of the ray, to the far reach, in closed form.
  vec2 box = fxSlab(uCamera, dir, vec3(uWindow.x, -1e7, uWindow.y), vec3(uWindow.x + uWindow.z, 1e7, uWindow.y + uWindow.z));
  float t0 = max(box.y, 0.0);
  float t1 = min(tScene, uFarReach);
  if (uInflow.x > 0.0 && T > 0.02 && t1 > t0) {
    float tau = farDepth(t0, t1, uCamera.y, dir.y, uInflow.x * uH0 * uExtinction * uAmount);
    float mid = 0.5 * (t0 + t1);
    float fogT = exp(-(uFogDensity * mid) * (uFogDensity * mid));
    vec3 lit = uStormColour * (uSunColor * ph * uLightK.x + uAmbient * uLightK.y) * uBright;
    float a = 1.0 - exp(-tau);
    acc += T * lit * a * fogT;
    T *= 1.0 - a;
  }
  // And the fog the hour carries in on the wind past the window (the third wave), six taps of its profile over the
  // window's mean ground under the hour's top.
  if (uAirR.x > 0.0 && T > 0.02 && t1 > t0) {
    float st = (t1 - t0) / 6.0;
    float tau = 0.0;
    for (int j = 0; j < 6; j++) {
      float tj = t0 + st * (float(j) + 0.5);
      tau += uAirR.x * fogProfileAt(uCamera.y + dir.y * tj - uBand.z, uFog.x) * st;
    }
    tau *= uAirQ.y * uAmount;
    float mid = 0.5 * (t0 + t1);
    float fogT = exp(-(uFogDensity * mid) * (uFogDensity * mid));
    vec3 lit = uFogColor * (uSunColor * ph * uLightK.x + uAmbient * uLightK.y);
    float a = 1.0 - exp(-tau);
    acc += T * lit * a * fogT;
    T *= 1.0 - a;
  }
  vec4 o = vec4(acc, T);
  if (any(isnan(o)) || any(isinf(o))) o = vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = o;
}
`;

/**
 * The history: this frame's march blended into last frame's, reprojected through last frame's view at the scene depth
 * held to the window's far side, and held to the current 3×3 neighbourhood so a reprojection that missed cannot smear.
 */
const RESOLVE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform sampler2D uDepth;
uniform vec2 uTanHalfFov;
uniform float uFar;
uniform mat3 uViewToWorld;
uniform vec3 uCamera;
uniform vec3 uCamFwd;
uniform mat4 uPrevViewProj;
uniform vec4 uWindow;
uniform float uBlend;
uniform float uCut;
${FX_VIEW_POS}
${FX_SLAB}
void main() {
  vec4 cur = texture(uCurrent, vUv);
  if (uCut > 0.5) { gl_FragColor = cur; return; }
  vec2 ts = 1.0 / vec2(textureSize(uCurrent, 0));
  vec4 mn = cur;
  vec4 mx = cur;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec4 s = texture(uCurrent, vUv + vec2(float(i), float(j)) * ts);
      mn = min(mn, s);
      mx = max(mx, s);
    }
  }
  vec3 dir = normalize(uViewToWorld * fxViewPos(vUv, 1.0, uTanHalfFov));
  float depth = texture(uDepth, vUv).r;
  float tScene = (depth > 0.0 && depth < uFar * 0.999) ? depth / max(dot(dir, uCamFwd), 1e-4) : 1e7;
  vec2 box = fxSlab(uCamera, dir, vec3(uWindow.x, -1e7, uWindow.y), vec3(uWindow.x + uWindow.z, 1e7, uWindow.y + uWindow.z));
  float t = min(tScene, max(box.y, 0.0));
  vec4 clip = uPrevViewProj * vec4(uCamera + dir * t, 1.0);
  vec2 prev = clip.xy / max(clip.w, 1e-6) * 0.5 + 0.5;
  if (clip.w <= 0.0 || prev.x < 0.0 || prev.y < 0.0 || prev.x > 1.0 || prev.y > 1.0) { gl_FragColor = cur; return; }
  vec4 hist = clamp(texture(uHistory, prev), mn, mx);
  vec4 o = mix(hist, cur, uBlend);
  if (any(isnan(o)) || any(isinf(o))) o = cur;
  gl_FragColor = o;
}
`;

/**
 * The composite through an upsample of the march's own size (the clouds' lesson: never `fxHalfTaps`, which is for a
 * buffer at exactly half the screen), each of the four taps weighted by how near its own depth is to this pixel's,
 * both in metres: `scene · T + inscatter`.
 */
const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uVolume;
uniform sampler2D uDepthHalf;
uniform sampler2D uDepthFull;
uniform vec2 uNearFar;
${FX_LINEARIZE}
void main() {
  vec4 scene = texture(uScene, vUv);
  vec2 cs = vec2(textureSize(uVolume, 0));
  vec2 f = vUv * cs - 0.5;
  ivec2 b = ivec2(floor(f));
  vec2 t = f - vec2(b);
  ivec2 hi = ivec2(cs) - 1;
  ivec2 t00 = clamp(b, ivec2(0), hi);
  ivec2 t10 = clamp(b + ivec2(1, 0), ivec2(0), hi);
  ivec2 t01 = clamp(b + ivec2(0, 1), ivec2(0), hi);
  ivec2 t11 = clamp(b + ivec2(1, 1), ivec2(0), hi);
  vec4 w = vec4((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y);
  float mine = fxViewZ(texture(uDepthFull, vUv).r, uNearFar.x, uNearFar.y);
  vec4 dz = vec4(
    texture(uDepthHalf, (vec2(t00) + 0.5) / cs).r,
    texture(uDepthHalf, (vec2(t10) + 0.5) / cs).r,
    texture(uDepthHalf, (vec2(t01) + 0.5) / cs).r,
    texture(uDepthHalf, (vec2(t11) + 0.5) / cs).r);
  vec4 ww = w / (abs(dz - vec4(mine)) * 0.05 + 1e-3);
  float sum = ww.x + ww.y + ww.z + ww.w;
  vec4 c = (texelFetch(uVolume, t00, 0) * ww.x + texelFetch(uVolume, t10, 0) * ww.y + texelFetch(uVolume, t01, 0) * ww.z + texelFetch(uVolume, t11, 0) * ww.w) / max(sum, 1e-5);
  vec4 o = vec4(scene.rgb * clamp(c.a, 0.0, 1.0) + max(c.rgb, vec3(0.0)), scene.a);
  if (any(isnan(o)) || any(isinf(o))) o = vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = o;
}
`;

/** The wisps' modes, the march material each is drawn with (`WISP_MODE`). */
export const WISP_MODES = ['off', 'bands', 'noise', 'noise2'] as const;

/**
 * Every fragment shader of the volume, for the scanner: the march once a wisps mode, as the program three builds for it
 * (its `#define` first), the resolve and the composite.
 */
export const AIR_VOLUME_FRAGMENTS: Readonly<Record<string, string>> = {
  march: `#define WISP_MODE 0\n${MARCH_FRAGMENT}`,
  'march.bands': `#define WISP_MODE 1\n${MARCH_FRAGMENT}`,
  'march.noise': `#define WISP_MODE 2\n${MARCH_FRAGMENT}`,
  'march.noise2': `#define WISP_MODE 3\n${MARCH_FRAGMENT}`,
  resolve: RESOLVE_FRAGMENT,
  composite: COMPOSITE_FRAGMENT,
};
/** The march's source as written, before a mode is defined over it. */
export const AIR_MARCH_SOURCE = MARCH_FRAGMENT;

function target(name: string): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  t.texture.name = name;
  return t;
}

/** The volume's own numbers, taken from the settings in `setSize` (never read off the settings in a frame). */
interface VolumeQuality {
  resolution: number;
  steps: number;
  amount: number;
  history: boolean;
  shadows: boolean;
  on: boolean;
}

export class AirVolumePass implements FxPass {
  readonly id = 'airVolume' as const;
  readonly timerLabel = 'pass:airVolume';
  private readonly source: () => AirSource | null;
  /** The march's own material for each wisps mode, and the one with the mode off (whose uniforms every one shares). */
  private readonly marchMats: THREE.ShaderMaterial[];
  private readonly marchMat: THREE.ShaderMaterial;
  private readonly resolveMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly marchQuads: THREE.Mesh[];
  private readonly resolveQuad: THREE.Mesh;
  private readonly compositeQuad: THREE.Mesh;
  private readonly current: THREE.WebGLRenderTarget;
  private readonly histories: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  /** A real 1×1 compare depth texture bound wherever a cascade has no map: a null shadow sampler drops the whole draw. */
  private readonly noShadow: THREE.DepthTexture;
  private readonly debug: readonly FxDebugTexture[];
  private readonly q: VolumeQuality = { resolution: 0.5, steps: 16, amount: 1, history: true, shadows: true, on: false };
  private width = 1;
  private height = 1;
  private frame = 0;
  private historyValid = false;
  /** What the last frame did, for the console. */
  last = { drew: false, size: [0, 0] as [number, number], steps: 0, history: false, shadows: 0, wisps: 0 };
  /**
   * Which wisps modes' march materials are built and linked (the fourth wave, W3's carried cold warm): every one behind a
   * loading screen (`materials()`, the warm-up compiles them all), and only the mode in force when the master is turned on
   * in play (`warmMaterials`), the others behind the notice when the mode is moved (`App.warmWispMode`, class W). A frame
   * draws the mode asked only once it is ready, and the last ready one meanwhile, so no frame waits on a link.
   */
  readonly ready: boolean[] = [true, true, true, true];
  /** The last mode drawn (what a mode not yet ready is drawn as). */
  private drawnMode = 0;

  constructor(source: () => AirSource | null) {
    this.source = source;
    this.noShadow = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.noShadow.name = 'fx.airVolume.noShadow';
    this.noShadow.compareFunction = THREE.LessEqualCompare;
    this.noShadow.needsUpdate = true;
    const S = AIR_TUNE.smoke;
    const F = AIR_TUNE.fog;
    const marchUniforms: Record<string, THREE.IUniform> = {
        uDepth: { value: null },
        uDust: { value: null },
        uShape: { value: null },
        uLight: { value: null },
        uHeight: { value: null },
        uObstacles: { value: null },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uFar: { value: 9000 },
        uViewToWorld: { value: new THREE.Matrix3() },
        uCamera: { value: new THREE.Vector3() },
        uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
        uWindow: { value: new THREE.Vector4(0, 0, 192, 1.5) },
        uLightShift: { value: new THREE.Vector2() },
        uBand: { value: new THREE.Vector3() },
        uInflow: { value: new THREE.Vector2(0, 1.8) },
        uStormColour: { value: new THREE.Color() },
        uLightOn: { value: 1 },
        uHullInverse: { value: new THREE.Matrix4() },
        uHullBox: { value: new THREE.Vector4() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uAmbient: { value: new THREE.Color(0.3, 0.3, 0.3) },
        uFogColor: { value: new THREE.Color() },
        uFogDensity: { value: 0 },
        uSteps: { value: 16 },
        uAmount: { value: 1 },
        uFrame: { value: 0 },
        uBelow: { value: AIR_TUNE.volume.below },
        uAbove: { value: AIR_TUNE.volume.above },
        uFarReach: { value: AIR_TUNE.volume.farReach },
        uExtinction: { value: AIR_TUNE.dust.extinction },
        uPhase: { value: new THREE.Vector3(AIR_TUNE.volume.phaseBase, AIR_TUNE.volume.phaseLift, AIR_TUNE.volume.phasePower) },
        uLightK: { value: new THREE.Vector2(AIR_TUNE.volume.sun, AIR_TUNE.volume.ambient) },
        uCascades: { value: 0 },
        tShadow0: { value: this.noShadow },
        tShadow1: { value: this.noShadow },
        tShadow2: { value: this.noShadow },
        uShadowMatrix: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] },
        uShadowParams: { value: new Float32Array(12) },
        uCascade: { value: new Float32Array(6) },
        uShadowRange: { value: 1 },
        uCascadeFade: { value: 0 },
        uShadowsOn: { value: 1 },
        uLightH: { value: new THREE.Vector4(0, 2, 5, 10) },
        uLook: { value: new THREE.Vector4(0.6, 0, 7.2, AIR_TUNE.dust.spreadMin) },
        uShapeP: { value: new THREE.Vector4(AIR_TUNE.dust.height, AIR_TUNE.volume.nearFrom, AIR_TUNE.volume.nearTo, 0) },
        // The third wave's: smoke and fog, the fog's top noise, the slabs' middles, the dust's tiles and the wisps.
        uSmoke: { value: null },
        uSmokeTint: { value: null },
        uNoise2: { value: null },
        uFog: { value: new THREE.Vector4() },
        uFogDrift: { value: new THREE.Vector2() },
        uAirP: { value: new THREE.Vector4(1, 0, 0, 0) },
        uAirQ: { value: new THREE.Vector4(S.extinction, F.extinction, F.topRise, F.topLow) },
        uAirR: { value: new THREE.Vector4(0, 1, 0.5 / 512, 1e-3) },
        uSmokeGrey: { value: new THREE.Vector3(S.greyR, S.greyG, S.greyB) },
        uSlabMid: { value: new THREE.Vector4(AIR_TUNE.slabs.centre, AIR_TUNE.slabs.centre1, AIR_TUNE.slabs.centre2, AIR_TUNE.slabs.ceiling2 + 2) },
        uVelAtlas: { value: null },
        uSlabTiles: { value: [new THREE.Vector4(0, 0, 1, 1), new THREE.Vector4(0, 0, 1, 1), new THREE.Vector4(0, 0, 1, 1)] },
        uSlabScale: { value: new THREE.Vector4(1, 1, 1, 1) },
        uSlabShare: { value: new THREE.Vector4(1, 1, 1, 0) },
        uAtlasHalf: { value: new THREE.Vector2(0.5 / 128, 0.5 / 128) },
        uWind: { value: new THREE.Vector2() },
        uWispA: { value: new THREE.Vector4(AIR_TUNE.wisps.scale, AIR_TUNE.wisps.stretch, AIR_TUNE.wisps.period, AIR_TUNE.wisps.octave) },
        uWispB: { value: new THREE.Vector4(0, 0.5, 1, AIR_TUNE.wisps.ageWisp) },
        uWispC: { value: new THREE.Vector4(AIR_TUNE.wisps.erode, AIR_TUNE.wisps.erodeFull, AIR_TUNE.wisps.keepColumn, AIR_TUNE.wisps.keepFloor) },
        uKeepTable: { value: new Float32Array(16).fill(1) },
        uBands: { value: null },
        uNoise3: { value: null },
    };
    // One march material a wisps mode, every one over the same uniforms by reference (the Start's decision, class M).
    this.marchMats = WISP_MODES.map(
      (mode, i) =>
        new THREE.ShaderMaterial({
          name: i === 0 ? 'fx.airVolume.march' : `fx.airVolume.march.${mode}`,
          vertexShader: FX_FULLSCREEN_VERTEX,
          fragmentShader: MARCH_FRAGMENT,
          defines: { WISP_MODE: i },
          blending: THREE.NoBlending,
          toneMapped: false,
          depthTest: false,
          depthWrite: false,
          uniforms: marchUniforms,
        }),
    );
    this.marchMat = this.marchMats[0];
    this.resolveMat = new THREE.ShaderMaterial({
      name: 'fx.airVolume.resolve',
      vertexShader: FX_FULLSCREEN_VERTEX,
      fragmentShader: RESOLVE_FRAGMENT,
      blending: THREE.NoBlending,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCurrent: { value: null },
        uHistory: { value: null },
        uDepth: { value: null },
        uTanHalfFov: this.marchMat.uniforms.uTanHalfFov,
        uFar: this.marchMat.uniforms.uFar,
        uViewToWorld: this.marchMat.uniforms.uViewToWorld,
        uCamera: this.marchMat.uniforms.uCamera,
        uCamFwd: this.marchMat.uniforms.uCamFwd,
        uPrevViewProj: { value: new THREE.Matrix4() },
        uWindow: this.marchMat.uniforms.uWindow,
        uBlend: { value: AIR_TUNE.volume.history },
        uCut: { value: 1 },
      },
    });
    this.compositeMat = new THREE.ShaderMaterial({
      name: 'fx.airVolume.composite',
      vertexShader: FX_FULLSCREEN_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      blending: THREE.NoBlending,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uScene: { value: null },
        uVolume: { value: null },
        uDepthHalf: { value: null },
        uDepthFull: { value: null },
        uNearFar: { value: new THREE.Vector2(0.05, 9000) },
      },
    });
    this.marchQuads = this.marchMats.map((m) => createFxQuad(m));
    this.resolveQuad = createFxQuad(this.resolveMat);
    this.compositeQuad = createFxQuad(this.compositeMat);
    this.current = target('fx.airVolume.march');
    this.histories = [target('fx.airVolume.history.a'), target('fx.airVolume.history.b')];
    // The march's own picture, and the air's fields as the field holds them now (read through the source each frame the
    // debug view shows one, since the fields swap between their pair of targets): `__debug.air({ view })`.
    const air = this.source;
    const field = (name: string, channels: FxDebugTexture['channels'], scale?: number): FxDebugTexture => ({
      name,
      channels,
      scale,
      get texture(): THREE.Texture | null {
        return air()?.debugTexture(name) ?? null;
      },
    });
    this.debug = [
      { name: 'inscatter', texture: this.current.texture, channels: 'rgb' },
      { name: 'clear', texture: this.current.texture, channels: 'a' },
      field('dust', 'a', 1),
      field('velocity', 'rgb', 1 / 20),
      // Red the walls, green the walls and a compound's rooms: yellow a wall, green a room only the volume keeps clear.
      field('obstacles', 'rgb', 1 / 20),
      field('height', 'r', 1 / 200),
      field('response', 'rgb'),
      field('colour', 'rgb'),
      field('medium', 'a'),
      // The light toward the sun (wave 2b's): an optical depth at four heights, the ground's in red, four to full.
      field('light', 'rgb', 1 / 4),
      // The shape the dust carries (premultiplied: D·μ in red, D·(σ² + μ²) in green, D·w in blue), and the tint raster.
      field('shape', 'rgb', 1 / 4),
      field('tint', 'rgb'),
      // The ground's (the second wave's): the blowing sand's two phases, metres in red and green (phase A, a quarter
      // metre to full), the dents, metres in red (ten centimetres to full).
      field('offsets', 'rgb', 4),
      field('dents', 'r', 10),
      // The third wave's: smoke a slab a channel (slab 0 red, 1 green, 2 blue), the fog (alpha, one to full), the
      // smoke's colour, the wisps' bands at the light's four heights, the sand carried in the air (its amount in alpha).
      field('smokeField', 'rgb', 1),
      field('fogField', 'a', 1),
      field('smokeTint', 'rgb', 1),
      field('bands', 'rgb', 1),
      field('carry', 'a', 1),
      // The fourth wave's: the class raster (`CLASS_INDEX`, a byte: sand 1 to wet sand 12, nought for water and the
      // unknown), red, a twelfth of the way a class, so grass and litter read bright and sand dark.
      field('class', 'r', 255 / 12),
      // The fifth wave's: the liquid's own flow (a ribbon's, m/s in red and green, two to full), and the velocity atlas
      // with the liquid's tile beside the slabs (as `velocity`).
      field('flow', 'rgb', 1 / 2),
      field('liquid', 'rgb', 1 / 20),
    ];
  }

  debugTextures(): readonly FxDebugTexture[] {
    return this.debug;
  }

  /**
   * The march's own picture round a point of the screen (`u`, `v` from the bottom left, 0 to 1), read back (console
   * only, a GPU sync, never in a frame): the in-scatter's luminance and the transmittance, each the mean of a 5×5 block
   * of the march's texels so the ordered offset averages out. Null before the pass has drawn or where the card will not
   * read its half floats back.
   */
  sampleAt(r: THREE.WebGLRenderer, u: number, v: number): { inscatter: number; clear: number } | null {
    if (!this.last.drew || !(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
    const t = this.current;
    const n = 5;
    const x = Math.max(0, Math.min(t.width - n, Math.round(u * t.width) - 2));
    const y = Math.max(0, Math.min(t.height - n, Math.round(v * t.height) - 2));
    const data = new Uint16Array(n * n * 4);
    try {
      r.readRenderTargetPixels(t, x, y, n, n, data);
    } catch {
      return null;
    }
    let lum = 0;
    let clear = 0;
    for (let i = 0; i < n * n; i++) {
      const rr = THREE.DataUtils.fromHalfFloat(data[i * 4]);
      const gg = THREE.DataUtils.fromHalfFloat(data[i * 4 + 1]);
      const bb = THREE.DataUtils.fromHalfFloat(data[i * 4 + 2]);
      lum += 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      clear += THREE.DataUtils.fromHalfFloat(data[i * 4 + 3]);
    }
    return { inscatter: Math.round((lum / (n * n)) * 10000) / 10000, clear: Math.round((clear / (n * n)) * 10000) / 10000 };
  }

  /** What the pass holds now, for the console. */
  report(): Record<string, unknown> {
    return { ...this.q, size: [this.current.width, this.current.height], last: { ...this.last } };
  }

  enabled(ctx: FxFrameContext): boolean {
    return this.reason(ctx) === null;
  }

  /** Why it does not draw, or null: the first reason that holds. Allocates nothing (its answers are literals). */
  reason(ctx: FxFrameContext): string | null {
    if (!this.q.on) return 'the volumetrics master is off';
    const src = this.source();
    if (!src) return 'no air field: it is built at an arrival with the master on';
    if (!(this.q.amount > 0)) return 'the dust over the picture is at 0';
    if (ctx.space) return 'in space there is no air';
    if (ctx.portalView) return 'the camera is in a building';
    if (ctx.inside) return 'the player is in a building';
    if (ctx.cameraSubmerged) return 'the camera is under water';
    // The dust, or (the third wave) the smoke and fog, carried this frame, never the last texture a switch left behind:
    // with the moving air or the dust turned off (the master on) the field keeps its targets, and that texture is a frame
    // frozen where it was, or sliding with the window (`AirSource.dustLive`, `smokeLive`).
    const dust = !!src.dust.value && src.dustLive;
    const smoke = !!src.smokeField?.value && src.smokeLive === true;
    if (!dust && !smoke) return 'the air is not stepping its dust, smoke or fog (the moving air, or the dust and the smoke and the fog, are off)';
    if (!src.hasAir()) return 'nothing is airborne';
    return null;
  }

  needs(): readonly FxProductId[] {
    return NEEDS;
  }

  prepare(): void {}

  setSize(width: number, height: number, settings: FxSettings): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const s = settings as Partial<FxSettings>;
    const r = s.airVolumeResolution;
    this.q.resolution = r === 0.25 || r === 1 ? r : 0.5;
    const steps = Number(s.airVolumeSteps);
    this.q.steps = Math.max(1, Math.min(MAX_VOLUME_STEPS, Math.round(Number.isFinite(steps) ? steps : 16)));
    const amount = Number(s.airVolumeAmount);
    this.q.amount = Math.max(0, Math.min(4, Number.isFinite(amount) ? amount : 1));
    this.q.history = s.airVolumeHistory !== false;
    this.q.shadows = s.airVolumeShadows !== false;
    this.q.on = s.volumetrics === true;
    const w = Math.max(1, Math.round(this.width * this.q.resolution));
    const h = Math.max(1, Math.round(this.height * this.q.resolution));
    if (this.current.width !== w || this.current.height !== h) {
      this.current.setSize(w, h);
      for (const t of this.histories) t.setSize(w, h);
      this.historyValid = false;
    }
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const src = this.source();
    if (!src) return false;
    const g = ctx.renderer;
    const cam = ctx.camera;
    const u = this.marchMat.uniforms;
    (u.uTanHalfFov.value as THREE.Vector2).copy(ctx.tanHalfFov);
    u.uFar.value = ctx.far;
    (u.uViewToWorld.value as THREE.Matrix3).setFromMatrix4(cam.matrixWorld);
    (u.uCamera.value as THREE.Vector3).copy(ctx.cameraPos);
    const e = cam.matrixWorld.elements;
    (u.uCamFwd.value as THREE.Vector3).set(-e[8], -e[9], -e[10]).normalize();
    u.uDepth.value = ctx.products.linearDepthHalf ?? null;
    u.uDust.value = src.dust.value;
    u.uShape.value = src.shape.value;
    u.uLight.value = src.light.value;
    (u.uLightH.value as THREE.Vector4).copy(src.lightHeights.value);
    (u.uLook.value as THREE.Vector4).copy(src.look.value);
    // H₀ and the near fade's two ends, its near end never past its far one.
    const sp = u.uShapeP.value as THREE.Vector4;
    const V = AIR_TUNE.volume;
    sp.x = AIR_TUNE.dust.height;
    sp.y = V.nearFrom < V.nearTo ? V.nearFrom : V.nearTo;
    sp.z = V.nearTo;
    u.uHeight.value = src.height.value;
    u.uObstacles.value = src.obstacles.value;
    (u.uWindow.value as THREE.Vector4).copy(src.window.value);
    (u.uLightShift.value as THREE.Vector2).copy(src.lightShift.value);
    (u.uBand.value as THREE.Vector3).copy(src.band.value);
    (u.uInflow.value as THREE.Vector2).copy(src.inflow.value);
    (u.uStormColour.value as THREE.Color).copy(src.stormColour.value);
    u.uLightOn.value = src.lightOn.value;
    (u.uHullInverse.value as THREE.Matrix4).copy(src.hullInverse.value);
    (u.uHullBox.value as THREE.Vector4).copy(src.hullBox.value);
    const sun = ctx.sun;
    if (sun) {
      (u.uSunDir.value as THREE.Vector3).copy(sun.dir).normalize();
      (u.uSunColor.value as THREE.Color).copy(sun.color).multiplyScalar(Math.max(0, sun.intensity));
    } else (u.uSunColor.value as THREE.Color).setRGB(0, 0, 0);
    const lighting = ctx.lighting;
    if (lighting) (u.uAmbient.value as THREE.Color).copy(lighting.ambient);
    (u.uFogColor.value as THREE.Color).copy(ctx.fogColor);
    u.uFogDensity.value = ctx.fogDensity;
    u.uSteps.value = this.q.steps;
    u.uAmount.value = this.q.amount;
    this.frame = (this.frame + 1) % 16;
    u.uFrame.value = this.frame;
    u.uBelow.value = AIR_TUNE.volume.below;
    u.uAbove.value = AIR_TUNE.volume.above;
    u.uFarReach.value = AIR_TUNE.volume.farReach;
    u.uExtinction.value = AIR_TUNE.dust.extinction;
    (u.uPhase.value as THREE.Vector3).set(AIR_TUNE.volume.phaseBase, AIR_TUNE.volume.phaseLift, AIR_TUNE.volume.phasePower);
    (u.uLightK.value as THREE.Vector2).set(AIR_TUNE.volume.sun, AIR_TUNE.volume.ambient);
    // The cascades, by reference to what the frame was drawn with; never a null shadow sampler.
    const C = ctx.lights.sky.cascades;
    const on = this.q.shadows && C.count > 0;
    u.uShadowsOn.value = on ? 1 : 0;
    u.uCascades.value = C.count;
    const none = this.noShadow;
    u.tShadow0.value = C.count > 0 ? C.maps[0] ?? none : none;
    u.tShadow1.value = C.count > 0 ? C.maps[1] ?? none : none;
    u.tShadow2.value = C.count > 0 ? C.maps[2] ?? none : none;
    if (C.count > 0) {
      const m = u.uShadowMatrix.value as THREE.Matrix4[];
      for (let i = 0; i < 3; i++) m[i].copy(C.matrices[i]);
      (u.uShadowParams.value as Float32Array).set(C.params);
      (u.uCascade.value as Float32Array).set(C.ranges);
      u.uShadowRange.value = C.range;
      u.uCascadeFade.value = C.fade ? 1 : 0;
    }
    // The third wave's: what is drawn, smoke and fog, the dust's tiles and the wisps, each read off the field by reference
    // or copied into the kept uniform objects (nothing made a frame).
    const smokeLive = !!src.smokeField?.value && src.smokeLive === true;
    const fogOn = smokeLive && src.fog.value.y > 0.5;
    const ap = u.uAirP.value as THREE.Vector4;
    ap.x = src.dust.value && src.dustLive ? 1 : 0;
    ap.y = smokeLive ? 1 : 0;
    ap.z = fogOn ? 1 : 0;
    ap.w = src.airView;
    u.uSmoke.value = src.smokeField.value;
    u.uSmokeTint.value = src.smokeTint.value;
    u.uNoise2.value = src.noise2.value;
    (u.uFog.value as THREE.Vector4).copy(src.fog.value);
    (u.uFogDrift.value as THREE.Vector2).copy(src.fogDrift.value);
    const Sm = AIR_TUNE.smoke;
    const Fg = AIR_TUNE.fog;
    const aq = u.uAirQ.value as THREE.Vector4;
    aq.x = Sm.extinction;
    aq.y = Fg.extinction;
    aq.z = Fg.topRise;
    aq.w = Fg.topLow;
    (u.uSmokeGrey.value as THREE.Vector3).set(Sm.greyR, Sm.greyG, Sm.greyB);
    const ar = u.uAirR.value as THREE.Vector4;
    // The fog the hour carries in past the window: its bank times the level times the patches' mean share.
    const gaps = Fg.gaps > 0 ? (Fg.gaps < 0.99 ? Fg.gaps : 0.99) : 0;
    ar.x = fogOn ? Fg.bank * src.fog.value.w * (1 - gaps) * 0.5 : 0;
    ar.y = src.dustTiles.value.x;
    ar.z = src.dustTiles.value.y;
    // A march pixel's angle, radians: the wisps' level of detail by the sample's distance.
    ar.w = (2 * ctx.tanHalfFov.y) / (this.current.height > 0 ? this.current.height : 1);
    (u.uSlabMid.value as THREE.Vector4).copy(src.slabMid.value);
    const want = src.wispMode > 0 && src.wispMode < 4 ? src.wispMode : 0;
    // A mode whose material is still being built in the background draws as the last one ready (`ready`).
    let mode = want;
    if (!this.ready[mode]) mode = this.ready[this.drawnMode] ? this.drawnMode : this.ready.indexOf(true);
    if (mode < 0) return false;
    this.drawnMode = mode;
    if (mode > 0) {
      u.uVelAtlas.value = src.velocity.value;
      const st = u.uSlabTiles.value as THREE.Vector4[];
      const ss = src.slabTiles.value;
      st[0].copy(ss[0]);
      st[1].copy(ss[1]);
      st[2].copy(ss[2]);
      (u.uSlabScale.value as THREE.Vector4).copy(src.slabScale.value);
      (u.uSlabShare.value as THREE.Vector4).copy(src.slabShare.value);
      (u.uAtlasHalf.value as THREE.Vector2).copy(src.atlasHalf.value);
      (u.uWind.value as THREE.Vector2).copy(src.wind.value);
      (u.uWispA.value as THREE.Vector4).copy(src.wispA.value);
      (u.uWispB.value as THREE.Vector4).copy(src.wispB.value);
      (u.uWispC.value as THREE.Vector4).copy(src.wispC.value);
      u.uKeepTable.value = src.keepTable.value;
      u.uBands.value = src.bands.value;
      u.uNoise3.value = src.noise3.value;
    }
    this.last.wisps = mode;
    g.setRenderTarget(this.current);
    g.render(this.marchQuads[mode], FX_CAMERA);
    let shown: THREE.Texture = this.current.texture;
    if (this.q.history) {
      const r = this.resolveMat.uniforms;
      const prev = this.histories[0];
      const next = this.histories[1];
      r.uCurrent.value = this.current.texture;
      r.uHistory.value = prev.texture;
      r.uDepth.value = ctx.products.linearDepthHalf ?? null;
      (r.uPrevViewProj.value as THREE.Matrix4).copy(ctx.prevViewProj);
      r.uBlend.value = AIR_TUNE.volume.history;
      r.uCut.value = ctx.cameraCut || !this.historyValid ? 1 : 0;
      g.setRenderTarget(next);
      g.render(this.resolveQuad, FX_CAMERA);
      this.histories[0] = next;
      this.histories[1] = prev;
      this.historyValid = true;
      shown = next.texture;
    } else this.historyValid = false;
    const c = this.compositeMat.uniforms;
    c.uScene.value = input.texture;
    c.uVolume.value = shown;
    c.uDepthHalf.value = ctx.products.linearDepthHalf ?? null;
    c.uDepthFull.value = ctx.depth;
    (c.uNearFar.value as THREE.Vector2).set(cam.near, cam.far);
    g.setRenderTarget(output);
    g.render(this.compositeQuad, FX_CAMERA);
    src.volumeDrew = true;
    src.volumeAmount = this.q.amount;
    this.last.drew = true;
    this.last.size[0] = this.current.width;
    this.last.size[1] = this.current.height;
    this.last.steps = this.q.steps;
    this.last.history = this.q.history;
    this.last.shadows = on ? C.count : 0;
    return true;
  }

  /**
   * What the master turned on in play warms (the fourth wave, W3's carried cold warm): the march of the wisps mode in force
   * alone, the resolve and the composite, every other mode marked not ready until it is warmed in its turn (`marchItem`,
   * `ready`). On a cold Direct3D 11 profile the four large march materials were most of the warm's frame gaps.
   */
  warmMaterials(mode: number): FxWarmItem[] {
    const m = mode > 0 && mode < 4 ? mode : 0;
    for (let i = 0; i < this.ready.length; i++) this.ready[i] = i === m;
    return [this.marchItem(m), { material: this.resolveMat, object: this.resolveQuad, where: 'target' }, { material: this.compositeMat, object: this.compositeQuad, where: 'target' }];
  }

  /** One wisps mode's march, for a warm of its own. */
  marchItem(mode: number): FxWarmItem {
    const m = mode > 0 && mode < 4 ? mode : 0;
    return { material: this.marchMats[m], object: this.marchQuads[m], where: 'target' };
  }

  /** Every material for the warm-up: the march once a wisps mode (all four, class M), the resolve and the composite. */
  materials(): FxWarmItem[] {
    const list: FxWarmItem[] = this.marchMats.map((m, i) => ({ material: m, object: this.marchQuads[i], where: 'target' as const }));
    list.push({ material: this.resolveMat, object: this.resolveQuad, where: 'target' }, { material: this.compositeMat, object: this.compositeQuad, where: 'target' });
    return list;
  }

  dispose(): void {
    this.current.dispose();
    for (const t of this.histories) t.dispose();
    for (const m of this.marchMats) m.dispose();
    this.resolveMat.dispose();
    this.compositeMat.dispose();
    this.noShadow.dispose();
  }
}
