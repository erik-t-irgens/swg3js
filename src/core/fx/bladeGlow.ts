// The light a lit lightsaber throws on what is around it. One full-screen draw after the occlusion:
// each pixel's view-space position and a normal are rebuilt from the scene's depth, and every lit
// blade is added as a short segment light (inverse square from the blade's nearest point with a
// soft core and a smooth knee, a wrapped Lambert term, the surface's hue, zero at the tune's range).
// No light is added to any scene and no decal is laid, so nothing recompiles and nothing floats past
// an edge; the pool follows the depth exactly, in rooms, on terrain and aboard.
//
// A short march in screen space from each lit pixel toward the blade (eight depth taps, one march
// per pixel) cuts the light where a wall, crate, hull or body on screen stands between them.
//
// The arithmetic, the tuning and the march's numbers live in `bladeGlowMath.ts`, which a node test
// mirrors; the shader's constants are written from there.
import * as THREE from 'three';
import type { FxFrameContext } from './context';
import { ShaderFxPass } from './pass';
import { FX_FULLSCREEN_VERTEX, FX_LINEARIZE, FX_VIEW_POS } from './glsl';
import { UNSET_BLADES, type FxBladeList } from './bladeList';
import { BLADE_GLOW_GUARD, BLADE_GLOW_MARCH, BLADE_GLOW_MAX, BLADE_GLOW_TUNE, emptyRect, lightRect, unionRect, type UvRect } from './bladeGlowMath.ts';

/** A number as a GLSL float literal: an integer gets its `.0`. */
function glslFloat(v: number): string {
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

let warnedUnwired = false;

/**
 * Never silent: without the game's list the pass lights nothing while the blades have given up the
 * pooled lights, so a frame that ran with no list handed over says so, once.
 */
function warnUnwired(): void {
  if (warnedUnwired) return;
  warnedUnwired = true;
  console.warn('bladeGlow: the frame context carries no blade list from the game (FxFrameContext.blades is not handed over in updateContext), so no blade lights anything');
}

/** The glow's shader, built fresh for each pass instance: its uniform arrays must never be shared. */
export function bladeGlowShader(): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } {
  const M = BLADE_GLOW_MARCH;
  const G = BLADE_GLOW_GUARD;
  const f = glslFloat;
  const vec3s = () => Array.from({ length: BLADE_GLOW_MAX }, () => new THREE.Vector3());
  return {
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
      uNear: { value: 0.05 },
      uFar: { value: 9000 },
      uTanHalfFov: { value: new THREE.Vector2(1, 1) },
      /** The uv box the blades' reach covers: outside it the pass is one fetch. */
      uRect: { value: new THREE.Vector4(0, 0, 0, 0) },
      /** Nothing farther than this along the view axis can be in reach. */
      uMaxViewZ: { value: 0 },
      uCount: { value: 0 },
      /** View space: each blade's emitter and the end of its lit part. */
      uA: { value: vec3s() },
      uB: { value: vec3s() },
      /** Linear colour times intensity times strength. */
      uColor: { value: vec3s() },
      /** 1 for the player's blades, marched together. A typed array, which three's uniform clone would share: the reason the shader is built per instance. */
      uOwn: { value: new Float32Array(BLADE_GLOW_MAX) },
      uRange: { value: BLADE_GLOW_TUNE.range },
      uCore: { value: BLADE_GLOW_TUNE.core },
      uPower: { value: BLADE_GLOW_TUNE.power },
      uKnee: { value: BLADE_GLOW_TUNE.knee },
      uAlbedo: { value: BLADE_GLOW_TUNE.albedo },
      uHueMix: { value: BLADE_GLOW_TUNE.hue },
      uWrap: { value: BLADE_GLOW_TUNE.wrap },
      uWallScale: { value: BLADE_GLOW_TUNE.walls },
      /** Floors' up in view space. */
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uFogDensity: { value: 0 },
      uLitCeiling: { value: 1 },
      uGlowDim: { value: BLADE_GLOW_TUNE.glowDim },
      uOcclusion: { value: 1 },
      uMarchMin: { value: BLADE_GLOW_TUNE.marchMin },
      uJitter: { value: 0 },
      uDebug: { value: 0 },
    },
    vertexShader: FX_FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      #define MAX_BLADES ${BLADE_GLOW_MAX}
      #define MARCH_STEPS ${M.steps}
      #define PI 3.14159265
      uniform sampler2D tDiffuse;
      uniform highp sampler2D tDepth;
      uniform float uNear;
      uniform float uFar;
      uniform vec2 uTanHalfFov;
      uniform vec4 uRect;
      uniform float uMaxViewZ;
      uniform int uCount;
      uniform vec3 uA[MAX_BLADES];
      uniform vec3 uB[MAX_BLADES];
      uniform vec3 uColor[MAX_BLADES];
      uniform float uOwn[MAX_BLADES];
      uniform float uRange;
      uniform float uCore;
      uniform float uPower;
      uniform float uKnee;
      uniform float uAlbedo;
      uniform float uHueMix;
      uniform float uWrap;
      uniform float uWallScale;
      uniform vec3 uUp;
      uniform float uFogDensity;
      uniform float uLitCeiling;
      uniform float uGlowDim;
      uniform float uOcclusion;
      uniform float uMarchMin;
      uniform float uJitter;
      uniform int uDebug;
      varying vec2 vUv;
      ${FX_LINEARIZE}
      ${FX_VIEW_POS}
      const float MARCH_BIAS = ${f(M.bias)};
      const float MARCH_BIAS_PER_M = ${f(M.biasPerM)};
      const float MARCH_SKIP_END = ${f(M.skipEnd)};
      const float MARCH_MIN_SPAN = ${f(M.minSpan)};
      const float MARCH_THICK_MIN = ${f(M.thickMin)};
      const float MARCH_THICK_STEPS = ${f(M.thickSteps)};
      const float MARCH_THICK_RAMP = ${f(M.thickRamp)};
      const float MARCH_MARGIN = ${f(M.margin)};
      const float MARCH_MARGIN_PER_M = ${f(M.marginPerM)};
      const float MARCH_SOFT = ${f(M.soft)};
      const float MARCH_SLACK = ${f(M.slack)};
      const float MARCH_SLACK_RAMP = ${f(M.slackRamp)};
      const float MARCH_NEAR = ${f(M.near)};
      const float MARCH_NEAR_FULL = ${f(M.nearFull)};
      const float GUARD_RATIO_FROM = ${f(G.ratioFrom)};
      const float GUARD_RATIO_TO = ${f(G.ratioTo)};
      const float GUARD_LUM_FROM = ${f(G.lumFrom)};
      const float GUARD_LUM_TO = ${f(G.lumTo)};
      const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

      vec3 viewAt(ivec2 p, ivec2 size) {
        p = clamp(p, ivec2(0), size - 1);
        return fxViewPos((vec2(p) + 0.5) / vec2(size), fxViewZ(texelFetch(tDepth, p, 0).r, uNear, uFar), uTanHalfFov);
      }

      // Inverse square with a soft core, a smooth fourth-power knee at uKnee, zero at uRange.
      float irradiance(float d2, float d) {
        float e = uPower / (d2 + uCore);
        float r = e / uKnee;
        r *= r;
        r *= r;
        return e / sqrt(sqrt(1.0 + r)) * (1.0 - smoothstep(0.55 * uRange, uRange, d));
      }

      // How much of the light from Q reaches P past what the depth buffer shows between them, 0..1.
      float marchVisibility(vec3 P, vec3 n, vec3 Q, float z, ivec2 size, ivec2 px) {
        vec3 start = P + n * (MARCH_BIAS + MARCH_BIAS_PER_M * z);
        vec3 seg = Q - start;
        float len = length(seg);
        float span = len - MARCH_SKIP_END;
        if (span <= MARCH_MIN_SPAN) return 1.0;
        vec3 dir = seg / len;
        float stepLen = span / float(MARCH_STEPS);
        float thick = max(MARCH_THICK_MIN, MARCH_THICK_STEPS * stepLen);
        // No point of a straight path is nearer the eye than its nearer end: a surface much nearer
        // than that stands between the camera and the path, not on it.
        float nearest = min(-start.z, -Q.z) - MARCH_SLACK;
        float jitter = uJitter * ((BAYER[(px.x & 3) + 4 * (px.y & 3)] + 0.5) / 16.0 - 0.5);
        float vis = 1.0;
        for (int s = 0; s < MARCH_STEPS; s++) {
          vec3 S = start + dir * ((float(s) + 0.5 + jitter) * stepLen);
          float sz = -S.z;
          if (sz <= uNear) break;                                             // behind the eye from here on
          vec2 uv = S.xy / (sz * uTanHalfFov) * 0.5 + 0.5;
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) break;  // off screen from here on: taken as clear
          float bz = fxViewZ(texelFetch(tDepth, clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1), 0).r, uNear, uFar);
          float diff = sz - bz;                                               // > 0: the sample is behind what the screen shows
          float margin = MARCH_MARGIN + MARCH_MARGIN_PER_M * sz;
          float o = smoothstep(margin, margin + MARCH_SOFT, diff)
                  * (1.0 - smoothstep(thick, thick + MARCH_THICK_RAMP, diff))
                  * smoothstep(nearest - MARCH_SLACK_RAMP, nearest, bz);
          vis = min(vis, 1.0 - o);
          if (vis <= 0.0) break;
        }
        return vis;
      }

      // The light this pixel gains, 0 where none; the normal it used goes to nOut (zero where none was built).
      vec3 bladeLight(vec3 srcRgb, out vec3 nOut) {
        nOut = vec3(0.0);
        ivec2 size = textureSize(tDepth, 0);
        ivec2 px = ivec2(gl_FragCoord.xy);
        float depth = texelFetch(tDepth, px, 0).r;
        if (depth >= 1.0) return vec3(0.0);                                  // sky, and anything that wrote no depth over it
        float z = fxViewZ(depth, uNear, uFar);
        if (z > uMaxViewZ) return vec3(0.0);
        vec3 P = fxViewPos(vUv, z, uTanHalfFov);
        float r2 = uRange * uRange;

        // Any blade in reach? Only then is the normal worth four more fetches.
        bool inRange = false;
        for (int i = 0; i < MAX_BLADES; i++) {
          if (i >= uCount) break;
          vec3 ab = uB[i] - uA[i];
          vec3 q = uA[i] + ab * clamp(dot(P - uA[i], ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0) - P;
          if (dot(q, q) < r2) { inRange = true; break; }
        }
        if (!inRange) return vec3(0.0);

        // The normal from the nearer neighbour on each axis, so a silhouette does not bend it.
        vec3 pl = viewAt(px - ivec2(1, 0), size);
        vec3 pr = viewAt(px + ivec2(1, 0), size);
        vec3 pd = viewAt(px - ivec2(0, 1), size);
        vec3 pu = viewAt(px + ivec2(0, 1), size);
        vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
        vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
        vec3 n = cross(dx, dy);
        float nl = length(n);
        if (nl < 1e-12) return vec3(0.0);
        n /= nl;
        if (dot(n, -P) < 0.0) n = -n;                                        // facing the eye
        nOut = n;
        float wall = mix(uWallScale, 1.0, smoothstep(0.3, 0.7, abs(dot(n, uUp))));

        // Each blade's light, summed by group: the player's blades together, the fighters' apart, with the strongest of each.
        vec3 own = vec3(0.0);
        vec3 ownFar = vec3(0.0);
        vec3 other = vec3(0.0);
        vec3 otherFar = vec3(0.0);
        float ownBest = 0.0;
        float otherBest = 0.0;
        vec3 ownQ = P;
        vec3 otherQ = P;
        for (int i = 0; i < MAX_BLADES; i++) {
          if (i >= uCount) break;
          vec3 ab = uB[i] - uA[i];
          vec3 Q = uA[i] + ab * clamp(dot(P - uA[i], ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
          vec3 q = Q - P;
          float dd = dot(q, q);
          if (dd >= r2) continue;
          float d = sqrt(dd);
          vec3 contrib = uColor[i] * (irradiance(dd, d) * clamp((dot(n, q / max(d, 1e-4)) + uWrap) / (1.0 + uWrap), 0.0, 1.0));
          vec3 far = contrib * smoothstep(MARCH_NEAR, MARCH_NEAR_FULL, d);   // nearer than half a metre nothing fits between
          float s = max(far.r, max(far.g, far.b));
          if (uOwn[i] > 0.5) {
            own += contrib;
            ownFar += far;
            if (s > ownBest) { ownBest = s; ownQ = Q; }
          } else {
            other += contrib;
            if (s > otherBest) { otherBest = s; otherQ = Q; otherFar = far; }
          }
        }
        // One march per pixel: toward the player's strongest blade for all the player's light, or toward the strongest fighter's.
        if (uOcclusion > 0.5) {
          if (ownBest >= otherBest) {
            if (ownBest > uMarchMin) own -= ownFar * (1.0 - marchVisibility(P, n, ownQ, z, size, px));
          } else if (otherBest > uMarchMin) {
            other -= otherFar * (1.0 - marchVisibility(P, n, otherQ, z, size, px));
          }
        }
        vec3 light = max(own, vec3(0.0)) + max(other, vec3(0.0));

        // The surface's hue, not its brightness: there is no albedo buffer, and a dark pixel at night is not a dark surface.
        // A pixel brighter than the frame's lights could make any surface is mostly additive glow (a blade, a bolt, a flame):
        // its hue is the glow's, so the hue is not used and the light is dimmed a little instead.
        float maxc = max(srcRgb.r, max(srcRgb.g, srcRgb.b));
        float lum = dot(srcRgb, vec3(0.2126, 0.7152, 0.0722));
        float guard = (1.0 - smoothstep(GUARD_RATIO_FROM, GUARD_RATIO_TO, lum / max(uLitCeiling, 1e-3))) * (1.0 - smoothstep(GUARD_LUM_FROM, GUARD_LUM_TO, lum));
        vec3 hue = srcRgb / max(maxc, 1e-4);
        vec3 albedo = uAlbedo * mix(uGlowDim, 1.0, guard) * mix(vec3(1.0), hue, uHueMix * guard * smoothstep(0.002, 0.02, maxc));
        float fz = uFogDensity * z;                                          // three's FogExp2 on view depth
        return light * albedo * (wall * exp(-fz * fz) / PI);
      }

      void main() {
        vec4 src = texture2D(tDiffuse, vUv);
        bool inRect = vUv.x >= uRect.x && vUv.y >= uRect.y && vUv.x <= uRect.z && vUv.y <= uRect.w;
        vec3 n = vec3(0.0);
        vec3 add = vec3(0.0);
        if (inRect) add = bladeLight(src.rgb, n);
        // This pass runs after sanitize: a NaN or Inf here would reach bloom and become a black box.
        if (any(isnan(add)) || any(isinf(add))) add = vec3(0.0);
        add = clamp(add, 0.0, 64.0);
        // One composition for every exit, so the debug views show everywhere.
        vec3 rgb = src.rgb + add;
        if (uDebug == 1) rgb = src.rgb * 0.15 + add;
        else if (uDebug == 2) rgb = dot(n, n) > 0.5 ? clamp(n * 0.5 + 0.5, 0.0, 1.0) : src.rgb * 0.15;
        if (uDebug == 3 && inRect) rgb += vec3(0.02, 0.0, 0.02);
        gl_FragColor = vec4(rgb, src.a);
      }
    `,
  };
}

/** What `debug` shows: the picture, the added light over it at 15%, the normals it lit with, the box it worked in tinted. */
export const BLADE_GLOW_VIEWS = ['picture', 'light', 'normals', 'rect'] as const;

export class BladeGlowPass extends ShaderFxPass {
  readonly id = 'bladeGlow' as const;
  /** Console: 0 the picture; 1 the added light over the picture at 15%; 2 the normals it lit with (the rest at 15%); 3 the picture with the box it worked in tinted. */
  debug = 0;
  /** Console: march for walls when the setting allows it. */
  occlusion = true;
  /** Console: offset the march's taps by a 4x4 ordered pattern, if banding shows along shadow edges. */
  jitter = false;
  private readonly rect: UvRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly blade: UvRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Indices into the frame's blade list of the blades whose reach is on screen this frame. */
  private readonly shown = new Int8Array(BLADE_GLOW_MAX);
  private shownCount = 0;
  /** The list the last `enabled` looked at, for the console. */
  private seen: FxBladeList | null = null;

  constructor() {
    // A fresh shader per instance. UniformsUtils.clone copies an array of three's objects by
    // slicing it, and a typed array (uOwn) not at all, so two instances alive during the effects
    // switch would share them if the shader object were a module constant.
    super(bladeGlowShader());
  }

  /** The list of blades the pass last looked at (the game's kept one), or null before the first frame. */
  get lastBlades(): FxBladeList | null {
    return this.seen;
  }

  /** The uv box the last frame worked in, or null when no blade's reach was on screen. */
  get lastRect(): Readonly<UvRect> | null {
    return this.shownCount > 0 ? this.rect : null;
  }

  /** How many blades the last frame lit. */
  get lastShown(): number {
    return this.shownCount;
  }

  enabled(ctx: FxFrameContext): boolean {
    this.shownCount = 0;
    const list = ctx.blades;
    if (list === UNSET_BLADES && ctx.time > 0) warnUnwired();
    this.seen = list;
    if (ctx.settings.bladeGlowStrength <= 0) return false;
    emptyRect(this.rect);
    const range = BLADE_GLOW_TUNE.range;
    for (let i = 0; i < list.count && i < BLADE_GLOW_MAX; i++) {
      const bl = list.items[i];
      if (bl.intensity <= 0) continue;
      if (!lightRect(bl.a, bl.b, range, ctx.viewProj.elements, ctx.near, this.blade)) continue;
      unionRect(this.rect, this.blade);
      this.shown[this.shownCount++] = i;
    }
    return this.shownCount > 0;
  }

  reason(ctx: FxFrameContext): string | null {
    if (ctx.settings.bladeGlowStrength <= 0) return 'strength 0';
    if (ctx.blades.count === 0) return 'no lit blade within reach of the camera';
    return this.shownCount === 0 ? "no blade's light on screen" : null;
  }

  prepare(ctx: FxFrameContext): void {
    const u = this.material.uniforms;
    const T = BLADE_GLOW_TUNE;
    const list = ctx.blades;
    const strength = ctx.settings.bladeGlowStrength;
    const own = u.uOwn.value as Float32Array;
    const A = u.uA.value as THREE.Vector3[];
    const B = u.uB.value as THREE.Vector3[];
    const C = u.uColor.value as THREE.Vector3[];
    // Everything in view space: world coordinates on a planet reach thousands of metres, where a
    // float's millimetre would put degrees of noise into a normal taken from neighbours a centimetre apart.
    let maxZ = 0;
    for (let k = 0; k < this.shownCount; k++) {
      const bl = list.items[this.shown[k]];
      const a = A[k].copy(bl.a).applyMatrix4(ctx.view);
      const b = B[k].copy(bl.b).applyMatrix4(ctx.view);
      maxZ = Math.max(maxZ, -a.z, -b.z);
      C[k].set(bl.color.r, bl.color.g, bl.color.b).multiplyScalar(bl.intensity * strength);
      own[k] = bl.own ? 1 : 0;
    }
    u.uCount.value = this.shownCount;
    u.uMaxViewZ.value = maxZ + T.range;
    (u.uRect.value as THREE.Vector4).set(this.rect.x0, this.rect.y0, this.rect.x1, this.rect.y1);
    u.tDepth.value = ctx.depth;
    u.uNear.value = ctx.near;
    u.uFar.value = ctx.far;
    (u.uTanHalfFov.value as THREE.Vector2).copy(ctx.tanHalfFov);
    u.uFogDensity.value = ctx.fogDensity;
    (u.uUp.value as THREE.Vector3).copy(list.up).transformDirection(ctx.view);
    u.uLitCeiling.value = list.litCeiling;
    u.uRange.value = T.range;
    u.uCore.value = T.core;
    u.uPower.value = T.power;
    u.uKnee.value = T.knee;
    u.uAlbedo.value = T.albedo;
    u.uHueMix.value = T.hue;
    u.uGlowDim.value = T.glowDim;
    u.uWrap.value = T.wrap;
    u.uWallScale.value = T.walls;
    u.uOcclusion.value = ctx.settings.bladeGlowShadows && this.occlusion ? 1 : 0;
    u.uMarchMin.value = T.marchMin;
    u.uJitter.value = this.jitter ? 1 : 0;
    u.uDebug.value = this.debug;
  }
}
