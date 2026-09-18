// The air of the room the camera is in: daylight scattered in beams from its doorways, and a soft
// glow around its lamps, with a faint haze in the room's own colours.
//
// A beam is a doorway's rectangle extruded along the sun's travel, soft at its edges and streaked
// across, worked out analytically along each pixel's view ray at half resolution and stopped by the
// scene's depth, so whoever stands in it hides what is behind them and the camera may stand inside
// it. A lamp's glow is the closed form of 1 / (distance^2 + eps^2) along the same ray. The result
// is brought back to full resolution with a depth-aware upsample and added to the picture. Drawn as
// meshes with the rooms, the beams were wiped wherever a doorway was behind them (the world seen
// through a doorway is drawn after the rooms) and could not be stopped by what stood in them.
//
// Where a beam lands the pass also writes a mask (alpha) that the composite turns into a sunlit
// patch in proportion to what the surface already shows. Its gain is held at 0 until it has been
// judged by eye, and while it is 0 the pass never asks for the normals.
//
// What it draws comes from `RoomAir` (src/world/roomAir.ts) through the frame context's `room`.
import * as THREE from 'three';
import type { FxFrameContext } from './context';
import type { FxProductId, FxSettings } from '../fxRegistry.ts';
import { createFxQuad, FX_CAMERA, type FxDebugTexture, type FxPass, type FxWarmItem } from './pass';
import { FX_BILATERAL_UPSAMPLE, FX_FULLSCREEN_VERTEX, FX_HASH, FX_LINEARIZE, FX_PHASE_HG, FX_SLAB, FX_SOFT_BAND, FX_VIEW_POS, FX_VNOISE } from './glsl';
import { MAX_LAMPS, MAX_SHAFTS, NOISE_FREQ, ROOM_AIR_SETTING_DEFAULTS, readRoomAirSettings, type RoomAirSettings } from '../../world/roomAirMath.ts';
import type { RoomAirFrame } from '../../world/roomAir';

/** The streaks' two octave frequencies (cycles per metre) as GLSL floats, the ones `octaveFade` is pinned against. */
const NOISE_F1 = NOISE_FREQ[0].toFixed(4);
const NOISE_F2 = NOISE_FREQ[1].toFixed(4);

const HAZE_FRAG = /* glsl */ `
  #define MAX_SHAFTS ${MAX_SHAFTS}
  #define MAX_LAMPS ${MAX_LAMPS}
  uniform highp sampler2D tLinear;
  uniform sampler2D tNormals;
  uniform bool uHasNormals;
  uniform vec2 uFullSize;
  uniform vec2 uTanHalfFov;
  uniform float uFar;
  uniform mat4 uViewToRoom;
  uniform vec3 uCamRoom;
  uniform float uTime;
  uniform int uShaftCount;
  uniform mat4 uShaftToUnit[MAX_SHAFTS];
  uniform vec4 uShaftSize[MAX_SHAFTS];
  uniform vec3 uShaftBoxMin[MAX_SHAFTS];
  uniform vec3 uShaftBoxMax[MAX_SHAFTS];
  uniform vec4 uShaftLight[MAX_SHAFTS];
  uniform vec4 uShaftRect[MAX_SHAFTS];
  uniform vec3 uSunDirRoom;
  uniform float uScatter;
  uniform float uSaturation;
  uniform float uNoise;
  uniform float uPhaseG;
  uniform int uLampCount;
  uniform vec4 uLampPos[MAX_LAMPS];
  uniform vec4 uLampColor[MAX_LAMPS];
  uniform float uLampSigma;
  uniform float uLampEps;
  uniform vec4 uRoomHaze;
  varying vec2 vUv;
  ${FX_VIEW_POS}
  ${FX_HASH}
  ${FX_VNOISE}
  ${FX_SLAB}
  ${FX_SOFT_BAND}
  ${FX_PHASE_HG}

  // m: metres across and up the doorway. The unit prism's a and b are constant along the light, so a
  // point's (a, b) is its projection onto the doorway along the light and the noise draws streaks. An
  // octave with more than about two cycles over the segment's span on the doorway cannot be resolved
  // by four samples and would crawl as the camera moves; it is faded to its mean (f1, f2).
  float streaks(vec2 m, float t, float f1, float f2) {
    float a = f1 > 0.0 ? fxVnoise(m * ${NOISE_F1} + vec2(0.0, t * 0.05)) : 0.5;
    float b = f2 > 0.0 ? fxVnoise(m * ${NOISE_F2} - vec2(t * 0.03, 0.0)) : 0.5;
    return 0.65 * mix(0.5, a, f1) + 0.35 * mix(0.5, b, f2);
  }

  void main() {
    ivec2 hp = ivec2(gl_FragCoord.xy);
    float z = texelFetch(tLinear, hp, 0).r;
    // The half-resolution depth samples half texel i at full texel 2i + 1, whose centre is at 2i + 1.5.
    vec2 uv = (vec2(hp) * 2.0 + 1.5) / uFullSize;
    bool sky = z >= uFar * 0.999;
    vec3 P = (uViewToRoom * vec4(fxViewPos(uv, sky ? 1.0 : z, uTanHalfFov), 1.0)).xyz;
    vec3 ray = P - uCamRoom;
    float rayLen = length(ray);
    vec3 dir = ray / max(rayLen, 1e-6);
    float D = sky ? 1.0e4 : rayLen;

    bool surface = false;
    vec3 N = vec3(0.0);
    if (uHasNormals && !sky) {
      vec4 nt = texelFetch(tNormals, hp, 0);
      surface = nt.a > 0.5;
      N = mat3(uViewToRoom) * (nt.xyz * 2.0 - 1.0);
    }

    vec3 beam = vec3(0.0);
    float patchLight = 0.0;
    for (int i = 0; i < MAX_SHAFTS; i++) {
      if (i >= uShaftCount) break;
      if (uShaftLight[i].a <= 0.0) continue;                 // a freed or never-used slot
      vec4 rc = uShaftRect[i];
      if (uv.x < rc.x || uv.y < rc.y || uv.x > rc.z || uv.y > rc.w) continue;
      vec4 sz = uShaftSize[i];
      vec2 e = vec2(sz.w / sz.x, sz.w / sz.y);
      vec3 o = (uShaftToUnit[i] * vec4(uCamRoom, 1.0)).xyz;
      vec3 d = mat3(uShaftToUnit[i]) * dir;                  // s stays in metres: the map is affine
      vec2 inBox = fxSlab(uCamRoom, dir, uShaftBoxMin[i], uShaftBoxMax[i]);
      vec2 prism = fxSlab(o, d, vec3(-e, 0.0), vec3(1.0 + e, 1.0));
      float lo = max(max(inBox.x, prism.x), 0.0);
      float hi = min(min(inBox.y, prism.y), D);
      if (hi > lo) {
        float len = hi - lo;
        vec3 q0 = o + d * lo, q1 = o + d * hi;
        float span = length((q1.xy - q0.xy) * sz.xy);       // metres the segment covers on the doorway plane
        float f1 = 1.0 - smoothstep(0.5, 2.0, ${NOISE_F1} * span);
        float f2 = 1.0 - smoothstep(0.5, 2.0, ${NOISE_F2} * span);
        float m = 0.0;
        for (int k = 0; k < 4; k++) {
          vec3 q = mix(q0, q1, (float(k) + 0.5) * 0.25);
          float density = mix(1.0, 0.35 + 1.3 * streaks(q.xy * sz.xy, uTime, f1, f2), uNoise);
          m += fxSoftBand(q.x, e.x) * fxSoftBand(q.y, e.y) * density;
        }
        float L = len * m * 0.25;
        beam += uShaftLight[i].rgb * (1.0 - exp(-uSaturation * L)) / uSaturation;
      }
      if (surface) {                                         // where the beam lands
        vec3 pu = (uShaftToUnit[i] * vec4(P, 1.0)).xyz;
        vec3 bl = uShaftBoxMin[i] - 0.1, bh = uShaftBoxMax[i] + 0.1;
        float boxed = step(bl.x, P.x) * step(P.x, bh.x) * step(bl.y, P.y) * step(P.y, bh.y) * step(bl.z, P.z) * step(P.z, bh.z);
        float mm = fxSoftBand(pu.x, e.x) * fxSoftBand(pu.y, e.y) * step(-0.01, pu.z) * step(pu.z, 1.01) * boxed;
        patchLight += mm * uShaftLight[i].a * max(0.0, dot(N, uSunDirRoom));
      }
    }
    vec3 haze = beam * uScatter * (0.3 + 0.7 * fxPhaseHG(dot(dir, uSunDirRoom), uPhaseG));

    vec3 glow = vec3(0.0);
    for (int j = 0; j < MAX_LAMPS; j++) {
      if (j >= uLampCount) break;
      vec3 dl = uCamRoom - uLampPos[j].xyz;
      float b = dot(dir, dl);
      float h2 = max(dot(dl, dl) - b * b, 0.0);              // the lamp's squared distance from the ray's line
      float range = uLampPos[j].w;
      float win = 1.0 - smoothstep(0.5 * range, range, sqrt(h2));
      if (win <= 0.0) continue;
      float sq = sqrt(h2 + uLampEps * uLampEps);
      glow += uLampColor[j].rgb * uLampColor[j].a * win * (atan((D + b) / sq) - atan(b / sq)) / sq;
    }
    haze += glow * uLampSigma;
    haze += uRoomHaze.rgb * (1.0 - exp(-uRoomHaze.a * min(D, 40.0)));

    // clamp() does not reliably remove NaN, and this pass runs after sanitize, so a NaN here would spread through bloom.
    vec4 outc = vec4(haze, patchLight);
    if (any(isnan(outc)) || any(isinf(outc))) outc = vec4(0.0);
    gl_FragColor = vec4(clamp(outc.rgb, 0.0, 64.0), clamp(outc.a, 0.0, 4.0));
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tHaze;
  uniform highp sampler2D tLinear;
  uniform highp sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform vec3 uPatchColor;
  uniform int uDebug;
  varying vec2 vUv;
  ${FX_LINEARIZE}
  ${FX_VIEW_POS}
  ${FX_BILATERAL_UPSAMPLE}

  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    ivec2 t00, t10, t01, t11;
    vec4 w;
    fxHalfTaps(gl_FragCoord.xy, textureSize(tHaze, 0), t00, t10, t01, t11, w);
    vec4 h00 = texelFetch(tHaze, t00, 0), h10 = texelFetch(tHaze, t10, 0), h01 = texelFetch(tHaze, t01, 0), h11 = texelFetch(tHaze, t11, 0);
    vec4 hmax = max(max(h00, h10), max(h01, h11)), hmin = min(min(h00, h10), min(h01, h11));
    vec4 haze;
    if (all(lessThan(hmax - hmin, vec4(0.002) + 0.02 * hmax))) {
      haze = h00 * w.x + h10 * w.y + h01 * w.z + h11 * w.w;           // flat: plain bilinear, no depth fetches
    } else {
      float d = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r;
      float z = d >= 1.0 ? uFar : fxViewZ(d, uNear, uFar);
      vec4 ww = fxDepthWeights(tLinear, t00, t10, t01, t11, w, z);
      haze = h00 * ww.x + h10 * ww.y + h01 * ww.z + h11 * ww.w;
    }
    if (uDebug == 1) { gl_FragColor = vec4(haze.rgb * 4.0, 1.0); return; }
    if (uDebug == 2) { gl_FragColor = vec4(vec3(haze.a), 1.0); return; }
    gl_FragColor = vec4(c.rgb + haze.rgb + c.rgb * uPatchColor * haze.a, 1.0);
  }
`;

const NEEDS_DEPTH: readonly FxProductId[] = ['linearDepthHalf'];
const NEEDS_DEPTH_NORMALS: readonly FxProductId[] = ['linearDepthHalf', 'normalsHalf'];

/**
 * The room this frame is drawn from inside: the frame context's `room`, which the game fills from
 * `RoomAir.frame` (null outside, and on any frame drawn from outside).
 */
function roomOf(ctx: FxFrameContext): RoomAirFrame | null {
  return ctx.room;
}

export class LightShaftsPass implements FxPass {
  readonly id = 'lightShafts' as const;
  readonly timerLabel = 'pass:lightShafts';
  private readonly hazeTarget: THREE.WebGLRenderTarget;
  private readonly hazeMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly hazeQuad: THREE.Mesh;
  private readonly compositeQuad: THREE.Mesh;
  private readonly viewToRoom = new THREE.Matrix4();
  private readonly patchColor = new THREE.Color();
  private readonly roomHaze = new THREE.Vector4();
  private readonly S: RoomAirSettings = { ...ROOM_AIR_SETTING_DEFAULTS };
  private readonly debug: readonly FxDebugTexture[];

  constructor() {
    this.hazeTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.hazeTarget.texture.name = 'fx.shafts.haze';
    // Until the first room arrives the arrays are kept stand-ins of the right lengths, so the
    // warm-up compiles and uploads against something; the frame's own arrays replace them.
    const mats: THREE.Matrix4[] = [];
    const v4 = () => {
      const out: THREE.Vector4[] = [];
      for (let i = 0; i < MAX_SHAFTS; i++) out.push(new THREE.Vector4());
      return out;
    };
    const v3 = () => {
      const out: THREE.Vector3[] = [];
      for (let i = 0; i < MAX_SHAFTS; i++) out.push(new THREE.Vector3());
      return out;
    };
    for (let i = 0; i < MAX_SHAFTS; i++) mats.push(new THREE.Matrix4());
    const lamps = () => {
      const out: THREE.Vector4[] = [];
      for (let i = 0; i < MAX_LAMPS; i++) out.push(new THREE.Vector4());
      return out;
    };
    this.hazeMaterial = new THREE.ShaderMaterial({
      name: 'fx.lightShafts.haze',
      uniforms: {
        tLinear: { value: null },
        tNormals: { value: null },
        uHasNormals: { value: false },
        uFullSize: { value: new THREE.Vector2(1, 1) },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uFar: { value: 9000 },
        uViewToRoom: { value: this.viewToRoom },
        uCamRoom: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uShaftCount: { value: 0 },
        uShaftToUnit: { value: mats },
        uShaftSize: { value: v4() },
        uShaftBoxMin: { value: v3() },
        uShaftBoxMax: { value: v3() },
        uShaftLight: { value: v4() },
        uShaftRect: { value: v4() },
        uSunDirRoom: { value: new THREE.Vector3(0, 1, 0) },
        uScatter: { value: 0 },
        uSaturation: { value: 0.35 },
        uNoise: { value: 0.6 },
        uPhaseG: { value: 0.35 },
        uLampCount: { value: 0 },
        uLampPos: { value: lamps() },
        uLampColor: { value: lamps() },
        uLampSigma: { value: 0 },
        uLampEps: { value: 0.3 },
        uRoomHaze: { value: this.roomHaze },
      },
      vertexShader: FX_FULLSCREEN_VERTEX,
      fragmentShader: HAZE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      name: 'fx.lightShafts.composite',
      uniforms: {
        tDiffuse: { value: null },
        tHaze: { value: this.hazeTarget.texture },
        tLinear: { value: null },
        tDepth: { value: null },
        uNear: { value: 0.05 },
        uFar: { value: 9000 },
        uPatchColor: { value: this.patchColor },
        uDebug: { value: 0 },
      },
      vertexShader: FX_FULLSCREEN_VERTEX,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.hazeQuad = createFxQuad(this.hazeMaterial);
    this.compositeQuad = createFxQuad(this.compositeMaterial);
    this.debug = [
      { name: 'haze', texture: this.hazeTarget.texture, channels: 'rgb', scale: 4 },
      { name: 'patch', texture: this.hazeTarget.texture, channels: 'a' },
    ];
  }

  /** Only while something in the room is lit: the room's ambient alone (it has a floor in every building) never turns it on. */
  enabled(ctx: FxFrameContext): boolean {
    const r = roomOf(ctx);
    if (!r || r.fade <= 0.001) return false;
    const S = readRoomAirSettings(ctx.settings, this.S);
    const shafts = S.lightShaftStrength > 0 && r.shaftsLit;
    // The haze keeps the pass on for the second it takes to fade after the last beam or lamp goes.
    const glow = S.roomGlowStrength > 0 && (r.lampSightCount > 0 || r.hazeWeight > 0.001);
    return shafts || glow;
  }

  reason(ctx: FxFrameContext): string | null {
    const r = roomOf(ctx);
    if (!r) return 'not in a room';
    const S = readRoomAirSettings(ctx.settings, this.S);
    if (!(S.lightShaftStrength > 0) && !(S.roomGlowStrength > 0)) return 'strengths are 0';
    return 'nothing lit (no sunlit doorway beam, no lamp in sight)';
  }

  needs(ctx: FxFrameContext): readonly FxProductId[] {
    const r = roomOf(ctx);
    if (!r) return NEEDS_DEPTH;
    const S = readRoomAirSettings(ctx.settings, this.S);
    return S.lightShaftStrength > 0 && r.shaftsLit && r.tuning.patch > 0 ? NEEDS_DEPTH_NORMALS : NEEDS_DEPTH;
  }

  prepare(ctx: FxFrameContext): void {
    const r = roomOf(ctx);
    if (!r) return;
    const S = readRoomAirSettings(ctx.settings, this.S);
    const T = r.tuning;
    const u = this.hazeMaterial.uniforms;
    u.tLinear.value = ctx.products.linearDepthHalf;
    u.tNormals.value = ctx.products.normalsHalf;
    // SSAO may compute the normals anyway; the patch is still drawn only while its gain is above 0.
    u.uHasNormals.value = T.patch > 0 && !!ctx.products.normalsHalf;
    (u.uFullSize.value as THREE.Vector2).set(ctx.width, ctx.height);
    (u.uTanHalfFov.value as THREE.Vector2).copy(ctx.tanHalfFov);
    u.uFar.value = ctx.far;
    this.viewToRoom.multiplyMatrices(r.worldToRoom, ctx.camera.matrixWorld);
    u.uCamRoom.value = r.cameraRoom;
    u.uTime.value = r.time;
    u.uShaftCount.value = S.lightShaftStrength > 0 ? r.shaftCount : 0;
    u.uShaftToUnit.value = r.shaftToUnit;
    u.uShaftSize.value = r.shaftSize;
    u.uShaftBoxMin.value = r.shaftBoxMin;
    u.uShaftBoxMax.value = r.shaftBoxMax;
    u.uShaftLight.value = r.shaftLight;
    u.uShaftRect.value = r.shaftRect;
    u.uSunDirRoom.value = r.sunDirRoom;
    u.uScatter.value = T.scatter * S.lightShaftStrength * r.scatterBoost;
    u.uSaturation.value = Math.max(1e-3, T.saturation);
    u.uNoise.value = T.noise;
    u.uPhaseG.value = T.phaseG;
    u.uLampCount.value = S.roomGlowStrength > 0 ? r.lampSightCount : 0;
    u.uLampPos.value = r.lampPos;
    u.uLampColor.value = r.lampColor;
    u.uLampSigma.value = T.lampSigma * S.roomGlowStrength;
    u.uLampEps.value = Math.max(1e-3, T.lampEps);
    const k = T.hazeAlbedo * r.hazeWeight;
    this.roomHaze.set((r.ambient.r + 0.5 * r.parallelColor.r) * k, (r.ambient.g + 0.5 * r.parallelColor.g) * k, (r.ambient.b + 0.5 * r.parallelColor.b) * k, T.haze * S.roomGlowStrength);

    const c = this.compositeMaterial.uniforms;
    c.tLinear.value = ctx.products.linearDepthHalf;
    c.tDepth.value = ctx.depth;
    c.uNear.value = ctx.near;
    c.uFar.value = ctx.far;
    this.patchColor.copy(r.sunColor).multiplyScalar((r.sunLight * T.patch * S.lightShaftStrength) / Math.max(0.25, r.roomLuma));
    c.uDebug.value = r.debugView;
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const g = ctx.renderer;
    g.setRenderTarget(this.hazeTarget);
    g.render(this.hazeQuad, FX_CAMERA);
    this.compositeMaterial.uniforms.tDiffuse.value = input.texture;
    g.setRenderTarget(output);
    g.render(this.compositeQuad, FX_CAMERA);
    return true;
  }

  /** Half the buffer, as the half-resolution depth is, so a haze texel and a depth texel are the same place. */
  setSize(width: number, height: number, _settings: FxSettings): void {
    this.hazeTarget.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
  }

  materials(): FxWarmItem[] {
    return [
      { material: this.hazeMaterial, where: 'target' },
      { material: this.compositeMaterial, where: 'target' },
    ];
  }

  debugTextures(): readonly FxDebugTexture[] {
    return this.debug;
  }

  dispose(): void {
    this.hazeMaterial.dispose();
    this.compositeMaterial.dispose();
    this.hazeTarget.dispose();
  }
}
