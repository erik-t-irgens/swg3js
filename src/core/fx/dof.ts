// Depth of field while a gun is aimed: the lens focuses on what the crosshair is on and softens what
// lies nearer and farther, with the player's own figure and their shots kept sharp.
//
// The focus lives on the GPU in a 1x1 float ping-pong pair: the median of five taps of the
// half-resolution depth around the screen's centre (the shooter and the sky do not count), eased in
// dioptres, so nothing is read back and nothing lags a frame. Until a surface has been under the
// crosshair this aim there is no lens at all; after one, the sky under the crosshair holds it.
//
// The blur is drawn on a lens grid (half resolution, a quarter on buffers taller than 2000 px):
//   1. focus (1x1)            the ping-pong above
//   2. prefilter (grid)       a CoC-aware average of each block; alpha carries the raw CoC
//   3. tile max (grid/4)      the largest near radius per tile
//   4. dilate (grid/4)        spread over as many tiles as the largest radius reaches
//   5. gather (grid)          16 golden-angle taps (24 above 7 texels) with a bokeh weight
//   6. fill (grid)            closes the gaps between taps, above a 2-texel radius
//   7. composite (full)       the pixel's own blur from full-resolution depth, a near blur over it
// A texel's raw CoC rises with depth, so comparing two raw values says which is farther: the gather
// orders its taps without a depth fetch. A blurred foreground spills softly over a sharp background;
// a blurred background never bleeds over a sharp target, a sharp glow or the shooter.
//
// Glows (bolts, flashes, bursts, blade cores) write no depth; the `dofGlow` product records theirs,
// and wherever it is set the prefilter and the composite take the nearer of the two.
//
// The arithmetic is in `dofMath.ts`; every formula here has its twin there, pinned by dof.test.ts.
import * as THREE from 'three';
import type { FxDebugTexture, FxPass, FxWarmItem } from './pass';
import { createFxQuad, FX_CAMERA } from './pass';
import type { FxFrameContext } from './context';
import type { FxProductId, FxSettings } from '../fxRegistry.ts';
import { FX_FULLSCREEN_VERTEX, FX_LINEARIZE } from './glsl';
import { DOF_GLOW_ID, type DofGlowProduct } from './dofGlow';
import { clampTuning, createDofFrame, DOF_DEFAULTS, DOF_TAP_MAX, dofFrame, dofStride, focusBlend, glslVec2Array, vogelTaps, type DofFrameInput, type DofTuning } from './dofMath.ts';

export type DofView = 'coc' | 'blur' | 'tiles' | 'focus' | 'glow' | null;

const VIEW_CODE = { none: 0, coc: 1, blur: 2, tiles: 3, focus: 4, glow: 5 } as const;

const NEEDS_GLOW: readonly FxProductId[] = ['linearDepthHalf', DOF_GLOW_ID];
const NEEDS_PLAIN: readonly FxProductId[] = ['linearDepthHalf'];

/** The 24 golden-angle taps, spliced into the gather: one source for the shader and the test. */
const TAPS_GLSL = glslVec2Array('DOF_TAPS', vogelTaps(DOF_TAP_MAX));

/** The lens, shared by the prefilter, tile max, gather and composite. */
const DOF_COC = /* glsl */ `
  uniform highp sampler2D tFocus;
  uniform float uAperture, uApertureStop, uDeadZone, uMaxRadius, uFadeFrom, uFadeTo;
  uniform int uStride;
  uniform ivec2 uGridMax;
  struct DofLens { float fd; float ks; float rmax; };
  // The focus texel: r the focus in dioptres (0 before a surface this aim), a how far the lens has come in (0..1).
  DofLens dofLens() {
    vec4 f = texelFetch(tFocus, ivec2(0), 0);
    float fd = max(f.r, 1e-4);
    // ks = A sqrt(min(s, stop)): the aperture widens with the focus distance, up to the stop.
    return DofLens(fd, max(uAperture * inversesqrt(max(fd, 1.0 / uApertureStop)), 1e-4), uMaxRadius * f.a);
  }
  float dofRaw(float z, DofLens L) { return L.ks * (L.fd - 1.0 / max(z, 1e-3)); }
  // Signed grid pixels: positive farther than the focus, negative nearer, the near side faded in past the shooter.
  float dofRadius(float c, DofLens L) {
    float mag = clamp((abs(c) - uDeadZone) / (1.0 - uDeadZone), 0.0, 1.0);
    if (c >= 0.0) return mag * L.rmax;
    float z = 1.0 / (L.fd - c / L.ks);                                 // c < 0: the denominator exceeds fd > 0
    return -mag * smoothstep(uFadeFrom, uFadeTo, z) * L.rmax;
  }
  const vec3 DOF_LUMA = vec3(0.2126, 0.7152, 0.0722);
`;

/** The view distance a full-resolution texel's blur is decided by (needs FX_LINEARIZE). */
const DOF_DEPTH = /* glsl */ `
  uniform highp sampler2D tDepth;
  uniform highp sampler2D tGlow;
  uniform int uGlow;
  uniform float uNear, uFar;
  // The scene's, or a listed glow's where one is nearer.
  float dofViewZ(ivec2 q) {
    float z = fxViewZ(texelFetch(tDepth, q, 0).r, uNear, uFar);
    if (uGlow == 1) { float g = texelFetch(tGlow, q, 0).r; if (g > 0.0) z = min(z, 1.0 / g); }
    return z;
  }
`;

const FOCUS_FRAG = /* glsl */ `
  uniform highp sampler2D tPrev;
  uniform highp sampler2D tLinear;
  uniform ivec2 uCenter, uDepthMax;
  uniform float uMinFocus, uMaxFocus, uSkyZ, uBlendNearer, uBlendFarther, uSnap;
  void main() {
    const ivec2 O[5] = ivec2[5](ivec2(0), ivec2(2, 0), ivec2(-2, 0), ivec2(0, 2), ivec2(0, -2));
    float v[5];
    int n = 0;
    for (int i = 0; i < 5; i++) {
      float z = texelFetch(tLinear, clamp(uCenter + O[i], ivec2(0), uDepthMax), 0).r;
      if (z >= uMinFocus && z < uSkyZ) { v[n] = min(z, uMaxFocus); n++; }      // not the shooter, not the sky
    }
    for (int i = 1; i < n; i++) { float k = v[i]; int j = i - 1; while (j >= 0 && v[j] > k) { v[j + 1] = v[j]; j--; } v[j + 1] = k; }
    vec4 prev = texelFetch(tPrev, ivec2(0), 0);
    bool fresh = uSnap > 0.5 || prev.a <= 0.0;                               // no surface yet this aim
    if (n == 0) {
      // Nothing under the crosshair: no lens yet, or hold the last surface.
      gl_FragColor = fresh ? vec4(0.0) : vec4(prev.r, prev.g, 0.0, prev.a);
      return;
    }
    float target = 1.0 / v[(n - 1) / 2];
    if (fresh) {
      // The first surface: focus there. On a snap the blend is 1, so the lens is fully in.
      gl_FragColor = vec4(target, target, float(n), uBlendNearer);
      return;
    }
    float now = mix(prev.r, target, target > prev.r ? uBlendNearer : uBlendFarther);
    gl_FragColor = vec4(now, target, float(n), mix(prev.a, 1.0, uBlendNearer));
  }
`;

const PREFILTER_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform ivec2 uFullMax;
  uniform float uFirefly;
  ${DOF_COC}
  ${FX_LINEARIZE}
  ${DOF_DEPTH}
  const ivec2 BOX[4] = ivec2[4](ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(1, 1));
  const ivec2 ROOK[4] = ivec2[4](ivec2(1, 0), ivec2(3, 1), ivec2(0, 2), ivec2(2, 3));   // one per row and column of a 4x4 block
  void main() {
    ivec2 base = ivec2(gl_FragCoord.xy) * (2 * uStride);
    DofLens L = dofLens();
    vec3 col[4]; float raw[4]; float rad[4];
    float lo = 1e9, hi = -1e9;
    for (int k = 0; k < 4; k++) {
      // Stride 1: the 2x2 block. Stride 2 or more: four texels of the (2s)x(2s) block, spread as rooks.
      ivec2 off = uStride == 1 ? BOX[k] : (ROOK[k] * uStride) / 2;
      ivec2 q = min(base + off, uFullMax);
      col[k] = texelFetch(tColor, q, 0).rgb;
      raw[k] = dofRaw(dofViewZ(q), L);
      rad[k] = dofRadius(raw[k], L);
      lo = min(lo, raw[k]); hi = max(hi, raw[k]);
    }
    // A near blur dominates the texel (it spreads over what is behind it); otherwise the farthest decides.
    float pick = dofRadius(lo, L) < -0.5 ? lo : hi;
    float rp = dofRadius(pick, L);
    vec3 sum = vec3(0.0); float w = 0.0;
    for (int k = 0; k < 4; k++) {
      float wk = 1.0 / (1.0 + uFirefly * dot(col[k], DOF_LUMA)) * max(0.05, 1.0 - abs(rad[k] - rp) / max(1.0, 0.5 * abs(rp)));
      sum += col[k] * wk; w += wk;
    }
    gl_FragColor = vec4(sum / max(w, 1e-6), pick);
  }
`;

const TILE_MAX_FRAG = /* glsl */ `
  uniform sampler2D tGrid;
  ${DOF_COC}
  void main() {
    ivec2 base = ivec2(gl_FragCoord.xy) * 4;
    DofLens L = dofLens();
    float m = 0.0;
    for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++)
      m = max(m, -dofRadius(texelFetch(tGrid, min(base + ivec2(x, y), uGridMax), 0).a, L));
    gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
  }
`;

const DILATE_FRAG = /* glsl */ `
  uniform sampler2D tTile;
  uniform ivec2 uTileMax;
  uniform int uReach;
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    float m = 0.0;
    for (int y = -3; y <= 3; y++) {
      if (abs(y) > uReach) continue;
      for (int x = -3; x <= 3; x++) {
        if (abs(x) > uReach) continue;
        m = max(m, texelFetch(tTile, clamp(p + ivec2(x, y), ivec2(0), uTileMax), 0).r);
      }
    }
    gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
  }
`;

const GATHER_FRAG = /* glsl */ `
  uniform sampler2D tGrid;
  uniform sampler2D tTiles;
  uniform int uTapCount;
  uniform float uTapScale, uBokehGain, uBokehLo, uBokehHi;
  ${DOF_COC}
  ${TAPS_GLSL}
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 c = texelFetch(tGrid, p, 0);
    DofLens L = dofLens();
    float cc = c.a;                                   // raw: comparisons say nearer or farther
    float rc = dofRadius(cc, L);
    float R = min(L.rmax, max(abs(rc), texelFetch(tTiles, p / 4, 0).r));
    // Sharp, and no near blur reaches it (always, before a surface is found).
    if (R < 0.5) { gl_FragColor = vec4(c.rgb, rc); return; }
    vec3 acc = c.rgb; float tot = 1.0;
    float nearM = 0.0, nearSum = 0.0;
    for (int i = 0; i < uTapCount; i++) {
      vec2 o = DOF_TAPS[i] * (uTapScale * R);
      float d = length(o);
      vec4 t = texelFetch(tGrid, clamp(p + ivec2(round(o)), ivec2(0), uGridMax), 0);
      float rt = dofRadius(t.a, L);
      float r = abs(rt);
      if (t.a > cc) r = min(r, 2.0 * abs(rc));        // farther than the centre: may not cover a sharper centre
      float m = smoothstep(d - 0.5, d + 0.5, r);      // the tap's own blur reaches the centre
      float h = 1.0 + uBokehGain * smoothstep(uBokehLo, uBokehHi, dot(t.rgb, DOF_LUMA));
      acc += t.rgb * (m * h) + c.rgb * (1.0 - m);     // a tap that does not reach counts as the centre
      tot += m * h + (1.0 - m);
      if (t.a < cc && rt < -0.5) { nearM += m; nearSum += m * -rt; }
    }
    float nearR = nearM > 0.0 ? (nearSum / nearM) * smoothstep(0.0, 0.35, nearM / float(uTapCount)) : 0.0;
    float eff = nearR > 0.5 ? min(-nearR, rc) : rc;   // a nearer blur covering this texel shows as negative
    gl_FragColor = vec4(acc / tot, eff);
  }
`;

const FILL_FRAG = /* glsl */ `
  uniform sampler2D tBlur;
  uniform ivec2 uGridMax;
  void main() {
    const ivec2 D[4] = ivec2[4](ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1));
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 c = texelFetch(tBlur, p, 0);
    if (abs(c.a) < 2.0) { gl_FragColor = c; return; }
    vec3 sum = c.rgb * 2.0; float w = 2.0;
    for (int i = 0; i < 4; i++) {
      vec4 t = texelFetch(tBlur, clamp(p + D[i], ivec2(0), uGridMax), 0);
      float k = clamp(1.0 - abs(t.a - c.a) / (0.5 * abs(c.a)), 0.0, 1.0);
      sum += t.rgb * k; w += k;
    }
    gl_FragColor = vec4(sum / w, c.a);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tBlur;
  uniform sampler2D tTiles;
  uniform int uView;
  ${DOF_COC}
  ${FX_LINEARIZE}
  ${DOF_DEPTH}
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    DofLens L = dofLens();
    float own = dofRadius(dofRaw(dofViewZ(p), L), L);
    if (uView == 1) {
      // The circle of confusion: green in focus, red near, blue far, brighter as it blurs more.
      float k = min(1.0, abs(own) / max(L.rmax, 1e-3));
      gl_FragColor = vec4(abs(own) < 0.5 ? vec3(0.1, 0.8, 0.1) : own < 0.0 ? vec3(k, 0.05, 0.05) : vec3(0.05, 0.05, k), 1.0);
      return;
    }
    if (uView == 5) {
      // Where a glow's own depth is set, in magenta; the rest dimmed.
      float g = uGlow == 1 ? texelFetch(tGlow, p, 0).r : 0.0;
      vec3 base = texelFetch(tDiffuse, p, 0).rgb;
      gl_FragColor = vec4(g > 0.0 ? mix(base, vec3(1.0, 0.1, 0.9), 0.7) : base * 0.5, 1.0);
      return;
    }
    // The grid texel this pixel falls in, exactly as the prefilter blocked it (2 x stride pixels a texel).
    vec2 gridUv = gl_FragCoord.xy / (float(2 * uStride) * vec2(uGridMax + ivec2(1)));
    vec4 b = texture2D(tBlur, gridUv);                                  // bilinear: rgb and effective radius
    float aOwn = smoothstep(0.5, 1.5, abs(own));                        // this pixel's own blur, decided at full resolution
    float aNear = smoothstep(0.5, 1.5, -b.a);                           // a nearer blur spilling over it
    float a = uView == 2 ? 1.0 : max(aOwn, aNear);
    if (a < 0.002 && uView < 3) { gl_FragColor = texelFetch(tDiffuse, p, 0); return; }
    vec3 blurred = b.rgb;
    if (abs(b.a - own) > 1.0 && aNear < 0.5) {                          // the footprint straddles blur sizes: weight by likeness
      vec2 hp = gl_FragCoord.xy / float(2 * uStride) - 0.5;
      ivec2 i0 = ivec2(floor(hp));
      vec2 fr = hp - vec2(i0);
      vec3 sum = vec3(0.0); float w = 0.0;
      for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
        vec4 t = texelFetch(tBlur, clamp(i0 + ivec2(x, y), ivec2(0), uGridMax), 0);
        float bw = (x == 1 ? fr.x : 1.0 - fr.x) * (y == 1 ? fr.y : 1.0 - fr.y);
        float wk = bw / (0.5 + abs(t.a - own));
        sum += t.rgb * wk; w += wk;
      }
      blurred = sum / max(w, 1e-4);
    }
    vec3 sharp = a < 0.998 ? texelFetch(tDiffuse, p, 0).rgb : vec3(0.0);
    vec3 outc = mix(sharp, blurred, a);
    if (uView == 3) outc = mix(outc * 0.4, vec3(1.0, 0.2, 0.1), min(1.0, texelFetch(tTiles, p / (8 * uStride), 0).r / max(L.rmax, 1e-3)));
    if (uView == 4 && abs(own) < 0.5) outc = mix(outc, vec3(0.1, 1.0, 0.1), 0.35);
    gl_FragColor = vec4(outc, 1.0);
  }
`;

type U = Record<string, THREE.IUniform>;

function lensMaterial(fragmentShader: string, uniforms: U, name: string): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FX_FULLSCREEN_VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
  m.name = `fx.dof.${name}`;
  return m;
}

function lensTarget(name: string, opts: { type: THREE.TextureDataType; format: THREE.PixelFormat; filter: THREE.MagnificationTextureFilter }): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    type: opts.type,
    format: opts.format,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    generateMipmaps: false,
    minFilter: opts.filter,
    magFilter: opts.filter,
  });
  rt.texture.name = `fx.dof.${name}`;
  return rt;
}

export interface DofLast {
  frame: number;
  ease: number;
  stride: number;
  maxRadiusGrid: number;
  reach: number;
  fill: boolean;
  tapCount: number;
  minFocus: number;
  selfDepth: number;
  fadeFrom: number;
  fadeTo: number;
  glow: boolean;
  snapped: boolean;
}

export class DepthOfFieldPass implements FxPass {
  readonly id = 'depthOfField' as const;
  readonly timerLabel = 'pass:depthOfField';
  /** The lens's numbers, a live copy of DOF_DEFAULTS: __debug.dof edits it, nothing saves it. */
  readonly tuning: DofTuning = { ...DOF_DEFAULTS };
  /** Console: draw as if fully aimed, without the camera's shoulder move (screenshots, headless checks). */
  force = false;
  /** Console: replace the picture with a diagnostic. */
  view: DofView = null;
  /** What the last drawn frame used, for __debug.dof. */
  readonly last: DofLast = {
    frame: -10,
    ease: 0,
    stride: 1,
    maxRadiusGrid: 0,
    reach: 0,
    fill: false,
    tapCount: 16,
    minFocus: 0,
    selfDepth: 0,
    fadeFrom: 0,
    fadeTo: 0,
    glow: false,
    snapped: false,
  };
  /** Target sizes, for __debug.dof: [width, height] each, kept arrays. */
  readonly size: { full: [number, number]; grid: [number, number]; tiles: [number, number]; depthHalf: [number, number] } = {
    full: [1, 1],
    grid: [1, 1],
    tiles: [1, 1],
    depthHalf: [1, 1],
  };

  private sized = false;
  private focusRead: THREE.WebGLRenderTarget;
  private focusWrite: THREE.WebGLRenderTarget;
  private readonly grid: THREE.WebGLRenderTarget;
  private readonly gathered: THREE.WebGLRenderTarget;
  private readonly tileA: THREE.WebGLRenderTarget;
  private readonly tileB: THREE.WebGLRenderTarget;
  private readonly shared = {
    tFocus: { value: null as THREE.Texture | null },
    uAperture: { value: DOF_DEFAULTS.aperture },
    uApertureStop: { value: DOF_DEFAULTS.apertureStop },
    uDeadZone: { value: DOF_DEFAULTS.deadZone },
    uMaxRadius: { value: 0 },
    uFadeFrom: { value: 0 },
    uFadeTo: { value: 0 },
    uNear: { value: 0.05 },
    uFar: { value: 9000 },
    tGlow: { value: null as THREE.Texture | null },
    uGlow: { value: 0 },
    uStride: { value: 1 },
    uGridMax: { value: new THREE.Vector2(0, 0) },
  };
  private readonly focusMat: THREE.ShaderMaterial;
  private readonly prefilterMat: THREE.ShaderMaterial;
  private readonly tileMaxMat: THREE.ShaderMaterial;
  private readonly dilateMat: THREE.ShaderMaterial;
  private readonly gatherMat: THREE.ShaderMaterial;
  private readonly fillMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly frameIn: DofFrameInput = { height: 1, strength: 1, aimAmount: 0, firstPerson: false, orbitDistance: 0, tuning: this.tuning };
  private readonly frameOut = createDofFrame();
  private readonly focusPixel = new Float32Array(4);
  private readonly debugList: FxDebugTexture[];

  /** Whether the dofGlow product was registered with this pass (installEffects had a collector). */
  readonly withGlow: boolean;

  /** `glow`: the glow depth product registered beside this pass (installEffects had a collector), or null. */
  constructor(readonly glow: DofGlowProduct | null = null) {
    this.withGlow = glow !== null;
    const float = { type: THREE.FloatType, format: THREE.RGBAFormat, filter: THREE.NearestFilter } as const;
    this.focusRead = lensTarget('focusA', float);
    this.focusWrite = lensTarget('focusB', float);
    this.grid = lensTarget('grid', { type: THREE.HalfFloatType, format: THREE.RGBAFormat, filter: THREE.LinearFilter });
    this.gathered = lensTarget('gathered', { type: THREE.HalfFloatType, format: THREE.RGBAFormat, filter: THREE.LinearFilter });
    this.tileA = lensTarget('tileA', { type: THREE.HalfFloatType, format: THREE.RedFormat, filter: THREE.NearestFilter });
    this.tileB = lensTarget('tileB', { type: THREE.HalfFloatType, format: THREE.RedFormat, filter: THREE.NearestFilter });
    const s = this.shared as unknown as U;
    const lens: U = {
      tFocus: s.tFocus,
      uAperture: s.uAperture,
      uApertureStop: s.uApertureStop,
      uDeadZone: s.uDeadZone,
      uMaxRadius: s.uMaxRadius,
      uFadeFrom: s.uFadeFrom,
      uFadeTo: s.uFadeTo,
      uStride: s.uStride,
      uGridMax: s.uGridMax,
    };
    const depth: U = { tGlow: s.tGlow, uGlow: s.uGlow, uNear: s.uNear, uFar: s.uFar };
    this.focusMat = lensMaterial(
      FOCUS_FRAG,
      {
        tPrev: { value: null },
        tLinear: { value: null },
        uCenter: { value: new THREE.Vector2(0, 0) },
        uDepthMax: { value: new THREE.Vector2(0, 0) },
        uMinFocus: { value: 0.3 },
        uMaxFocus: { value: DOF_DEFAULTS.focusMax },
        uSkyZ: { value: 8910 },
        uBlendNearer: { value: 1 },
        uBlendFarther: { value: 1 },
        uSnap: { value: 1 },
      },
      'focus',
    );
    this.prefilterMat = lensMaterial(
      PREFILTER_FRAG,
      { ...lens, ...depth, tColor: { value: null }, tDepth: { value: null }, uFullMax: { value: new THREE.Vector2(0, 0) }, uFirefly: { value: DOF_DEFAULTS.firefly } },
      'prefilter',
    );
    this.tileMaxMat = lensMaterial(TILE_MAX_FRAG, { ...lens, tGrid: { value: this.grid.texture } }, 'tileMax');
    this.dilateMat = lensMaterial(DILATE_FRAG, { tTile: { value: this.tileA.texture }, uTileMax: { value: new THREE.Vector2(0, 0) }, uReach: { value: 0 } }, 'dilate');
    this.gatherMat = lensMaterial(
      GATHER_FRAG,
      {
        ...lens,
        tGrid: { value: this.grid.texture },
        tTiles: { value: this.tileB.texture },
        uTapCount: { value: 16 },
        uTapScale: { value: Math.sqrt(1.5) },
        uBokehGain: { value: DOF_DEFAULTS.bokehGain },
        uBokehLo: { value: DOF_DEFAULTS.bokehLo },
        uBokehHi: { value: DOF_DEFAULTS.bokehHi },
      },
      'gather',
    );
    this.fillMat = lensMaterial(FILL_FRAG, { tBlur: { value: this.gathered.texture }, uGridMax: s.uGridMax }, 'fill');
    this.compositeMat = lensMaterial(
      COMPOSITE_FRAG,
      { ...lens, ...depth, tDiffuse: { value: null }, tDepth: { value: null }, tBlur: { value: null }, tTiles: { value: this.tileB.texture }, uView: { value: 0 } },
      'composite',
    );
    this.quad = createFxQuad(this.focusMat);
    this.debugList = [
      { name: 'grid', texture: this.grid.texture, channels: 'rgb' },
      { name: 'blur', texture: this.gathered.texture, channels: 'rgb' },
      { name: 'radius', texture: this.gathered.texture, channels: 'a', scale: 1 / 12 },
      { name: 'tiles', texture: this.tileB.texture, channels: 'r', scale: 1 / 12 },
    ];
  }

  enabled(ctx: FxFrameContext): boolean {
    return this.sized && (this.force || ctx.aimAmount > 0.02) && ctx.settings.depthOfFieldStrength > 0;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return this.withGlow ? NEEDS_GLOW : NEEDS_PLAIN;
  }

  reason(ctx: FxFrameContext): string | null {
    if (!this.sized) return 'not sized';
    if (!(ctx.settings.depthOfFieldStrength > 0)) return 'strength 0';
    if (!this.force && !(ctx.aimAmount > 0.02)) return 'not aiming';
    return null;
  }

  prepare(ctx: FxFrameContext): void {
    const t = this.tuning;
    const p = this.frameIn;
    p.height = ctx.height;
    p.strength = ctx.settings.depthOfFieldStrength;
    p.aimAmount = this.force ? 1 : ctx.aimAmount;
    p.firstPerson = ctx.firstPerson;
    p.orbitDistance = ctx.orbitDistance;
    p.tuning = t;
    const f = dofFrame(p, this.frameOut);
    // A fresh start: the first frame drawn after frames that were not, or a cut (resize, travel, effects switched in).
    const snap = ctx.cameraCut || ctx.frame !== this.last.frame + 1;
    const s = this.shared;
    s.uAperture.value = t.aperture;
    s.uApertureStop.value = t.apertureStop;
    s.uDeadZone.value = t.deadZone;
    s.uMaxRadius.value = f.maxRadiusGrid;
    s.uFadeFrom.value = f.fadeFrom;
    s.uFadeTo.value = f.fadeTo;
    s.uNear.value = ctx.near;
    s.uFar.value = ctx.far;
    const glow = this.withGlow ? ctx.products[DOF_GLOW_ID] ?? null : null;
    s.tGlow.value = glow;
    s.uGlow.value = glow ? 1 : 0;
    const fu = this.focusMat.uniforms;
    fu.tLinear.value = ctx.products.linearDepthHalf;
    fu.uMinFocus.value = f.minFocus;
    fu.uMaxFocus.value = t.focusMax;
    fu.uSkyZ.value = t.skyFraction * ctx.far;
    fu.uBlendNearer.value = focusBlend(ctx.dt, t.tauNearer, snap);
    fu.uBlendFarther.value = focusBlend(ctx.dt, t.tauFarther, snap);
    fu.uSnap.value = snap ? 1 : 0;
    this.dilateMat.uniforms.uReach.value = f.reach;
    const gu = this.gatherMat.uniforms;
    gu.uTapCount.value = f.tapCount;
    gu.uTapScale.value = f.tapScale;
    gu.uBokehGain.value = t.bokehGain;
    gu.uBokehLo.value = t.bokehLo;
    gu.uBokehHi.value = t.bokehHi;
    this.prefilterMat.uniforms.uFirefly.value = t.firefly;
    this.compositeMat.uniforms.uView.value = VIEW_CODE[this.view ?? 'none'];
    // Field by field: no object literal per frame.
    const L = this.last;
    L.frame = ctx.frame;
    L.snapped = snap;
    L.ease = f.ease;
    L.stride = f.stride;
    L.maxRadiusGrid = f.maxRadiusGrid;
    L.reach = f.reach;
    L.fill = f.fill;
    L.tapCount = f.tapCount;
    L.minFocus = f.minFocus;
    L.selfDepth = f.selfDepth;
    L.fadeFrom = f.fadeFrom;
    L.fadeTo = f.fadeTo;
    L.glow = glow !== null;
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    // canBeLast is false: the runner never hands this pass the canvas.
    if (!output) throw new Error('depthOfField cannot be last');
    const r = ctx.renderer;
    // 1. Focus: previous -> next, then swap so tFocus names the one just written.
    this.focusMat.uniforms.tPrev.value = this.focusRead.texture;
    this.draw(r, this.focusMat, this.focusWrite);
    const tmp = this.focusRead;
    this.focusRead = this.focusWrite;
    this.focusWrite = tmp;
    this.shared.tFocus.value = this.focusRead.texture;
    // 2. Prefilter (full -> grid).
    this.prefilterMat.uniforms.tColor.value = input.texture;
    this.prefilterMat.uniforms.tDepth.value = ctx.depth;
    this.draw(r, this.prefilterMat, this.grid);
    // 3-4. The near tiles.
    this.draw(r, this.tileMaxMat, this.tileA);
    this.draw(r, this.dilateMat, this.tileB);
    // 5. Gather.
    this.draw(r, this.gatherMat, this.gathered);
    // 6. Fill, into grid (the prefilter's content is spent).
    let blur = this.gathered;
    if (this.last.fill) {
      this.draw(r, this.fillMat, this.grid);
      blur = this.grid;
    }
    // 7. Composite into the chain.
    const cu = this.compositeMat.uniforms;
    cu.tDiffuse.value = input.texture;
    cu.tDepth.value = ctx.depth;
    cu.tBlur.value = blur.texture;
    this.draw(r, this.compositeMat, output);
    return true;
  }

  private draw(r: THREE.WebGLRenderer, m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = m;
    r.setRenderTarget(target);
    r.render(this.quad, FX_CAMERA);
  }

  setSize(w: number, h: number, _settings: FxSettings): void {
    const stride = dofStride(h);
    const gw = Math.max(1, Math.ceil(w / (2 * stride)));
    const gh = Math.max(1, Math.ceil(h / (2 * stride)));
    const tw = Math.max(1, Math.ceil(gw / 4));
    const th = Math.max(1, Math.ceil(gh / 4));
    // The half-resolution depth's size (products.ts), whatever the stride.
    const dw = Math.max(1, Math.ceil(w / 2));
    const dh = Math.max(1, Math.ceil(h / 2));
    this.grid.setSize(gw, gh);
    this.gathered.setSize(gw, gh);
    this.tileA.setSize(tw, th);
    this.tileB.setSize(tw, th);
    this.shared.uStride.value = stride;
    this.shared.uGridMax.value.set(gw - 1, gh - 1);
    (this.prefilterMat.uniforms.uFullMax.value as THREE.Vector2).set(w - 1, h - 1);
    (this.focusMat.uniforms.uDepthMax.value as THREE.Vector2).set(dw - 1, dh - 1);
    (this.focusMat.uniforms.uCenter.value as THREE.Vector2).set(Math.floor(dw / 2), Math.floor(dh / 2));
    (this.dilateMat.uniforms.uTileMax.value as THREE.Vector2).set(tw - 1, th - 1);
    const z = this.size;
    z.full[0] = w;
    z.full[1] = h;
    z.grid[0] = gw;
    z.grid[1] = gh;
    z.tiles[0] = tw;
    z.tiles[1] = th;
    z.depthHalf[0] = dw;
    z.depthHalf[1] = dh;
    this.sized = w > 1 && h > 1;
  }

  materials(): FxWarmItem[] {
    return [this.focusMat, this.prefilterMat, this.tileMaxMat, this.dilateMat, this.gatherMat, this.fillMat, this.compositeMat].map((material) => ({ material, where: 'target' as const }));
  }

  debugTextures(): readonly FxDebugTexture[] {
    return this.debugList;
  }

  /**
   * One synchronous read of the 1x1 focus (a GPU sync): console only. `metres` and `target` are null
   * before a surface has been found this aim.
   */
  readFocus(renderer: THREE.WebGLRenderer): { metres: number | null; target: number | null; samples: number; amount: number } | null {
    if (!this.sized) return null;
    const px = this.focusPixel;
    renderer.readRenderTargetPixels(this.focusRead, 0, 0, 1, 1, px);
    const [now, target, samples, amount] = px;
    const found = amount > 0;
    return {
      metres: found && now > 0 ? Number((1 / now).toFixed(2)) : null,
      target: found && target > 0 ? Number((1 / target).toFixed(2)) : null,
      samples,
      amount: Number(amount.toFixed(3)),
    };
  }

  /**
   * Console: live tuning, no recompile. Only the lens's own keys are taken, each only with the type
   * its default has (taps only as 16 or 24); `force`, `view` and the glow mask's `glowLevel` besides.
   */
  tune(opts: Partial<DofTuning> & { force?: boolean; view?: DofView; glowLevel?: number }): void {
    const t = this.tuning as unknown as Record<string, unknown>;
    const d = DOF_DEFAULTS as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(opts)) {
      if (!(k in d) || typeof v !== typeof d[k]) continue;
      if (typeof v === 'number' && !Number.isFinite(v)) continue;
      if (k === 'taps' && v !== 16 && v !== 24) continue;
      t[k] = v;
    }
    // Nothing the console sets may make the shaders divide by zero (a NaN here reaches bloom).
    clampTuning(this.tuning);
    if (typeof opts.force === 'boolean') this.force = opts.force;
    if (opts.view !== undefined && (opts.view === null || opts.view in VIEW_CODE)) this.view = opts.view;
    if (typeof opts.glowLevel === 'number' && Number.isFinite(opts.glowLevel) && this.glow) this.glow.level.value = Math.max(0, opts.glowLevel);
  }

  /** Console: what the lens did on the last frame it drew, with one read of the focus (a GPU sync). */
  report(ctx: FxFrameContext, row: { drewLastFrame: boolean; why?: string } | undefined) {
    const L = this.last;
    const t = this.tuning;
    // The focus texel keeps the last aim's value once the lens stops drawing: shown only while it draws.
    const focus = row?.drewLastFrame ? this.readFocus(ctx.renderer) : null;
    const r2 = (v: number) => Number(v.toFixed(2));
    return {
      setting: ctx.settings.depthOfField,
      strength: ctx.settings.depthOfFieldStrength,
      drewLastFrame: row?.drewLastFrame ?? false,
      why: row?.why ?? this.reason(ctx),
      aimAmount: Number(ctx.aimAmount.toFixed(3)),
      ease: Number(L.ease.toFixed(3)),
      force: this.force,
      view: this.view,
      focus: focus ? { ...focus, snapped: L.snapped } : null,
      minFocus: r2(L.minFocus),
      selfDepth: r2(L.selfDepth),
      fade: [r2(L.fadeFrom), r2(L.fadeTo)],
      keepShooterSharp: t.keepShooterSharp,
      maxRadiusPx: r2(L.maxRadiusGrid * 2 * L.stride),
      maxRadiusGrid: r2(L.maxRadiusGrid),
      stride: L.stride,
      tileReach: L.reach,
      fill: L.fill,
      taps: L.tapCount,
      glow: { product: this.withGlow, drawn: L.glow, objects: this.glow?.last.objects ?? 0, textured: this.glow?.last.textured ?? 0, level: this.glow?.level.value ?? null },
      size: { full: [...this.size.full], grid: [...this.size.grid], tiles: [...this.size.tiles], depthHalf: [...this.size.depthHalf] },
      tuning: { ...t },
    };
  }

  dispose(): void {
    for (const t of [this.focusRead, this.focusWrite, this.grid, this.gathered, this.tileA, this.tileB]) t.dispose();
    for (const m of [this.focusMat, this.prefilterMat, this.tileMaxMat, this.dilateMat, this.gatherMat, this.fillMat, this.compositeMat]) m.dispose();
    // The quad's geometry is the shared triangle: never disposed while a pass lives.
  }
}
