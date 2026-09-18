// The look on top of the picture: a colour grade in linear light just before the tone curve, and
// a vignette, a film grain and a dither on the display values at the very end.
//
// The grade is parametric, not a lookup table. Each frame the planet's hand-set mood
// (`GRADE_LOOKS`) and the light of the moment (the sky's key, its ambient and the air) come to a
// white balance, a shadow and a highlight tint, a split amount, a saturation, a contrast and a
// pivot, and the shader applies them to every pixel. Every tint keeps the pixel's own luminance
// and the contrast leaves the deep shadows and the highlights alone, so the grade can move colour
// but cannot crush or clip. `gradeMath.ts` holds the arithmetic, with a mirror of this shader that
// a node test sweeps and `selfTest` compares the GPU against.
import * as THREE from 'three';
import type { FxPassId, FxSettings } from '../fxRegistry.ts';
import type { FxFrameContext } from './context';
import { ShaderFxPass, FX_CAMERA } from './pass';
import { FX_PCG3D } from './glsl';
import {
  AIM_VIGNETTE,
  GRAIN_CELL_1080,
  GRAIN_RATE,
  ROOM_DAMP,
  ROOM_TAU,
  SOURCE_TAU,
  applyGradePixel,
  clamp01,
  createGradeParams,
  createGradeSource,
  createGradeTerms,
  deriveGrade,
  gradePivot,
  limitChroma,
  linearToSrgbHex,
  lookFor,
  luma,
  normLuma,
  setNeutralSource,
  smoothSource,
  sourceLag,
  TINT_LIMIT,
  type GradeLook,
  type GradeParams,
  type GradeSource,
  type GradeTerms,
  type Vec3,
} from './gradeMath';

const FULLSCREEN_CLIP_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COLOR_GRADE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 1 },
    uBalance: { value: new THREE.Vector3(1, 1, 1) },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
    uSplit: { value: 0 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uPivot: { value: 0.18 },
    /** Left of this fraction of the width the picture is left ungraded; negative is off. */
    uCompare: { value: -1 },
  },
  vertexShader: FULLSCREEN_CLIP_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform vec3 uBalance, uShadowTint, uHighlightTint;
    uniform float uSplit, uSaturation, uContrast, uPivot, uCompare;
    varying vec2 vUv;
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float a = vUv.x < uCompare ? 0.0 : clamp(uAmount, 0.0, 1.0);
      float l0 = dot(c, LUMA);
      if (a <= 0.0 || l0 <= 1e-7) { gl_FragColor = vec4(c, 1.0); return; }
      // 1. white balance
      c *= mix(vec3(1.0), uBalance, a);
      // 2. split toning by the original luma's zone, then back to that luma
      float t = clamp((log2(l0 + 1e-5) - log2(uPivot) + 2.0) / 4.0, 0.0, 1.0);
      float w = 1.0 - t * t * (3.0 - 2.0 * t);
      c *= mix(vec3(1.0), mix(uHighlightTint, uShadowTint, w), uSplit * a);
      c *= l0 / max(dot(c, LUMA), 1e-7);
      // 3. saturation: a raise scaled by how grey the pixel already is, a cut in full; no negative
      // channel; back to that luma
      float mx = max(c.r, max(c.g, c.b));
      float mn = min(c.r, min(c.g, c.b));
      float s = mix(1.0, uSaturation, a);
      if (s > 1.0) s = 1.0 + (s - 1.0) * (1.0 - (mx - mn) / max(mx, 1e-7));
      c = max(mix(vec3(l0), c, s), 0.0);
      c *= l0 / max(dot(c, LUMA), 1e-7);
      // 4. contrast on log luma about the pivot, guarded below a thirty-second of it and above
      // thirty-two times it, so deep shadows and bright highlights are left alone
      float lc = uPivot * pow(l0 / uPivot, mix(1.0, uContrast, a));
      float g = smoothstep(uPivot / 32.0, uPivot / 4.0, l0) * (1.0 - smoothstep(uPivot * 8.0, uPivot * 32.0, l0));
      c *= mix(l0, lc, g) / l0;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

const GRAIN_VIGNETTE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uGrainCell: { value: GRAIN_CELL_1080 },
    uGrainStep: { value: 0 },
    uFrame: { value: 0 },
  },
  vertexShader: FULLSCREEN_CLIP_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uGrain, uGrainCell, uGrainStep, uFrame;
    varying vec2 vUv;
    ${FX_PCG3D}
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    const float VIGNETTE_MAX = 0.55, VIGNETTE_INNER = 0.45, GRAIN_MAX = 0.09;

    float lattice(vec2 cell, uint layer) {
      return float(fxPcg3d(uvec3(uvec2(cell), layer)).x) / 4294967295.0;
    }
    float valueNoise(vec2 p, uint layer) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 s = f * f * (3.0 - 2.0 * f);
      float a = lattice(i, layer), b = lattice(i + vec2(1.0, 0.0), layer);
      float c = lattice(i + vec2(0.0, 1.0), layer), d = lattice(i + vec2(1.0, 1.0), layer);
      return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // vignette: elliptical on the screen's shape, and only ever a multiply
      float d = length(vUv - 0.5) * 1.41421356;
      c *= 1.0 - uVignette * VIGNETTE_MAX * smoothstep(VIGNETTE_INNER, 1.0, d);
      // grain: one pattern, stepped a set number of times a second, no crossfade
      if (uGrain > 0.0) {
        float n = valueNoise(gl_FragCoord.xy / uGrainCell, uint(uGrainStep)) - 0.5;
        float l = clamp(dot(c, LUMA), 0.0, 1.0);
        c += n * uGrain * GRAIN_MAX * pow(clamp(4.0 * l * (1.0 - l), 0.0, 1.0), 0.6);
      }
      // dither: triangular, one 8-bit step, fading to nothing within two steps of 0 and 1 per
      // channel, so pure black stays black
      uvec3 h = fxPcg3d(uvec3(uvec2(gl_FragCoord.xy), uint(uFrame)));
      vec3 e = clamp(min(c, 1.0 - c) * 127.5, 0.0, 1.0);
      c += e * ((float(h.x) + float(h.y)) / 4294967295.0 - 1.0) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export interface GradeReport {
  on: boolean;
  strength: number;
  planet: string;
  path: 'sky ramp' | 'space zone' | 'neutral';
  look: GradeLook | null;
  lookOverride: boolean;
  frozen: boolean;
  compare: number | null;
  /** How far the grade still lags the sky: 0 once it has caught up. */
  lag: number;
  exposure: number;
  source: { key: string; fill: string; air: string; keyLuma: number; night: number; space: boolean };
  terms: GradeTerms;
  params: GradeParams;
  room: { target: 0 | 1; weight: number; forced: boolean; amount: number };
}

export interface GradeSelfTest {
  ok: boolean;
  texels: number;
  maxError: number;
  worst: { input: Vec3; gpu: Vec3; js: Vec3 } | null;
}

export interface GradePercentiles {
  p1: number;
  p5: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface GradeCheck {
  sampled: number;
  /** Samples skipped because a channel was not a number; the sanitize pass would have zeroed them. */
  nonFinite: number;
  amount: number;
  /**
   * The split screen's fraction while this was measured, or null when it is off. Every sample here
   * is graded, so with a split on the screen the left half of the picture is not what these
   * numbers describe.
   */
  compare: number | null;
  before: GradePercentiles;
  after: GradePercentiles;
  /** Of the pixels with any light in them, the share the grade darkens by more than 15%. */
  darkened: number;
  /** ... and the share it brightens by more than 30%. */
  brightened: number;
  ratio: [number, number];
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round3v = (v: Readonly<Vec3>): Vec3 => [round3(v[0]), round3(v[1]), round3(v[2])];

/** The eight hues the self test sweeps, before they are normalised to luma 1. */
const SELF_TEST_HUES: Readonly<Vec3>[] = [
  [1, 1, 1],
  [1, 0.6, 0.25],
  [0.3, 0.45, 1],
  [0.3, 1, 0.35],
  [1, 0.95, 0.35],
  [1, 0.35, 0.95],
  [1, 0, 0],
  [0, 0, 1],
];

export class ColorGradePass extends ShaderFxPass {
  readonly id: FxPassId = 'colorGrade';

  /** Try a look without editing `GRADE_LOOKS`; null follows the planet's own. Console only, never saved. */
  lookOverride: GradeLook | null = null;
  /** Stop following the sky and hold the parameters where they are. Console only. */
  frozen = false;
  /** Force parameters after the derivation. Console only. */
  forcedParams: Partial<GradeParams> | null = null;
  /** Force the room weight, 0 to 1; null follows the camera. Console only. */
  forcedRoom: number | null = null;
  /** Split screen: left of this fraction of the width the picture is ungraded. Console only. */
  compare: number | null = null;

  private readonly source: GradeSource = createGradeSource();
  private readonly target: GradeSource = createGradeSource();
  private readonly params: GradeParams = createGradeParams();
  private readonly terms: GradeTerms = createGradeTerms();
  private room = 0;
  private want: 0 | 1 = 0;
  /** 0 until `prepare` has run once, so a report before the first drawn frame claims no grade. */
  private amount = 0;
  private lastFrame = -2;
  private planetId = '';
  private lighting: FxFrameContext['lighting'] = null;
  private look: GradeLook | undefined = undefined;
  private path: GradeReport['path'] = 'neutral';

  constructor() {
    super(COLOR_GRADE);
  }

  enabled(ctx: FxFrameContext): boolean {
    return ctx.settings.colorGradeStrength > 0;
  }

  reason(ctx: FxFrameContext): string | null {
    return ctx.settings.colorGradeStrength > 0 ? null : 'the colour grade strength is zero';
  }

  prepare(ctx: FxFrameContext): void {
    const planetChanged = ctx.planetId !== this.planetId;
    if (planetChanged) {
      this.planetId = ctx.planetId;
      this.look = lookFor(ctx.planetId);
    }
    // A new sky object (another planet, another zone, or the sky arriving after the loading
    // screen) is a cut: the grade snaps to it rather than gliding from the last world's.
    const skyChanged = ctx.lighting !== this.lighting;
    this.lighting = ctx.lighting;
    const cut = ctx.cameraCut || planetChanged || skyChanged || ctx.frame !== this.lastFrame + 1;
    this.lastFrame = ctx.frame;
    const look = this.lookOverride ?? this.look;
    const exposure = ctx.renderer.toneMappingExposure;

    if (!this.frozen) {
      this.readSource(ctx, this.target);
      smoothSource(this.source, this.target, cut ? 1 : 1 - Math.exp(-ctx.dt / SOURCE_TAU));
      deriveGrade(this.source, look, exposure, this.params, this.terms);
    } else this.params.pivot = gradePivot(exposure);
    if (this.forcedParams) Object.assign(this.params, this.forcedParams);

    this.want = ctx.portalView || ctx.cameraInHull ? 1 : 0;
    if (this.forcedRoom !== null) this.room = clamp01(this.forcedRoom);
    else this.room = cut ? this.want : this.room + (this.want - this.room) * (1 - Math.exp(-ctx.dt / ROOM_TAU));

    this.amount = clamp01(ctx.settings.colorGradeStrength * (look?.strength ?? 1)) * (1 - ROOM_DAMP * this.room);
    const u = this.material.uniforms;
    u.uAmount.value = this.amount;
    (u.uBalance.value as THREE.Vector3).fromArray(this.params.balance);
    (u.uShadowTint.value as THREE.Vector3).fromArray(this.params.shadowTint);
    (u.uHighlightTint.value as THREE.Vector3).fromArray(this.params.highlightTint);
    u.uSplit.value = this.params.split;
    u.uSaturation.value = this.params.saturation;
    u.uContrast.value = this.params.contrast;
    u.uPivot.value = this.params.pivot;
    u.uCompare.value = this.compare ?? -1;
  }

  /** What the console shows: what the sky gave, the planet's look, the terms, the parameters and the room weight. */
  report(ctx: FxFrameContext): GradeReport {
    const look = this.lookOverride ?? this.look ?? null;
    return {
      // The runner steps the frame after the last pass, so a pass that drew the frame just
      // finished has `lastFrame` one behind. With the strength at zero `prepare` is never called
      // and the parameters below are the last drawn frame's, not this one's: `on` says so.
      on: this.lastFrame === ctx.frame - 1 && this.amount > 0,
      strength: ctx.settings.colorGradeStrength,
      planet: this.planetId,
      path: this.path,
      look: look ? { ...look } : null,
      lookOverride: this.lookOverride !== null,
      frozen: this.frozen,
      compare: this.compare,
      lag: Math.round(sourceLag(this.source, this.target) * 10000) / 10000,
      exposure: ctx.renderer.toneMappingExposure,
      source: {
        key: linearToSrgbHex(this.source.key),
        fill: linearToSrgbHex(this.source.fill),
        air: linearToSrgbHex(this.source.air),
        keyLuma: round3(luma(this.source.key)),
        night: round3(this.source.night),
        space: this.source.space,
      },
      terms: {
        keyLuma: round3(this.terms.keyLuma),
        keyWarmth: round3(this.terms.keyWarmth),
        heat: round3(this.terms.heat),
        gloom: round3(this.terms.gloom),
        sunny: round3(this.terms.sunny),
        cool: round3(this.terms.cool),
        night: round3(this.terms.night),
        ratio: round3(this.terms.ratio),
      },
      params: {
        balance: round3v(this.params.balance),
        shadowTint: round3v(this.params.shadowTint),
        highlightTint: round3v(this.params.highlightTint),
        split: round3(this.params.split),
        saturation: round3(this.params.saturation),
        contrast: round3(this.params.contrast),
        pivot: round3(this.params.pivot),
      },
      room: { target: this.want, weight: round3(this.room), forced: this.forcedRoom !== null, amount: round3(this.amount) },
    };
  }

  /**
   * Draw the grade's own shader over a small image of known colours, twice (once through each
   * branch of the saturation and the contrast), and compare every texel with `applyGradePixel`.
   * Nothing is compiled: it is the same material, drawn into a target, as the warm-up prepared.
   */
  selfTest(renderer: THREE.WebGLRenderer): GradeSelfTest {
    const size = 16;
    const count = size * size;
    const data = new Float32Array(count * 4);
    const hues: Vec3[] = SELF_TEST_HUES.map((h) => normLuma([h[0], h[1], h[2]]));
    const input: Vec3[] = [];
    for (let i = 0; i < count; i++) {
      const hue = hues[i % hues.length];
      const l = Math.pow(2, -12 + 18 * ((i >> 3) / 31));
      const c: Vec3 = [hue[0] * l, hue[1] * l, hue[2] * l];
      input.push(c);
      data[i * 4] = c[0];
      data[i * 4 + 1] = c[1];
      data[i * 4 + 2] = c[2];
      data[i * 4 + 3] = 1;
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;

    const u = this.material.uniforms;
    const kept = {
      tDiffuse: u.tDiffuse.value as THREE.Texture | null,
      amount: u.uAmount.value as number,
      balance: (u.uBalance.value as THREE.Vector3).clone(),
      shadow: (u.uShadowTint.value as THREE.Vector3).clone(),
      highlight: (u.uHighlightTint.value as THREE.Vector3).clone(),
      split: u.uSplit.value as number,
      saturation: u.uSaturation.value as number,
      contrast: u.uContrast.value as number,
      pivot: u.uPivot.value as number,
      compare: u.uCompare.value as number,
    };

    const balance = normLuma([1.3, 0.95, 0.7]);
    const shadowTint = limitChroma(normLuma([0.6, 0.8, 1.4]), TINT_LIMIT, [0, 0, 0]);
    const highlightTint = limitChroma(normLuma([1.3, 0.95, 0.6]), TINT_LIMIT, [0, 0, 0]);
    const sets: { saturation: number; contrast: number; pivot: number }[] = [
      { saturation: 1.2, contrast: 1.1, pivot: 0.18 },
      { saturation: 0.7, contrast: 0.94, pivot: 0.09 },
    ];

    let maxError = 0;
    let worst: GradeSelfTest['worst'] = null;
    const js: Vec3 = [0, 0, 0];
    const gpu: Vec3 = [0, 0, 0];
    const pixels = new Uint16Array(count * 4);
    const previous = renderer.getRenderTarget();
    try {
      for (const set of sets) {
        u.tDiffuse.value = texture;
        u.uAmount.value = 1;
        (u.uBalance.value as THREE.Vector3).fromArray(balance);
        (u.uShadowTint.value as THREE.Vector3).fromArray(shadowTint);
        (u.uHighlightTint.value as THREE.Vector3).fromArray(highlightTint);
        u.uSplit.value = 0.3;
        u.uSaturation.value = set.saturation;
        u.uContrast.value = set.contrast;
        u.uPivot.value = set.pivot;
        u.uCompare.value = -1;
        renderer.setRenderTarget(rt);
        renderer.render(mesh, FX_CAMERA);
        renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
        const params: GradeParams = { balance, shadowTint, highlightTint, split: 0.3, saturation: set.saturation, contrast: set.contrast, pivot: set.pivot };
        for (let i = 0; i < count; i++) {
          applyGradePixel(input[i], params, 1, js);
          gpu[0] = THREE.DataUtils.fromHalfFloat(pixels[i * 4]);
          gpu[1] = THREE.DataUtils.fromHalfFloat(pixels[i * 4 + 1]);
          gpu[2] = THREE.DataUtils.fromHalfFloat(pixels[i * 4 + 2]);
          for (let k = 0; k < 3; k++) {
            const err = Math.abs(gpu[k] - js[k]) / Math.max(Math.abs(js[k]), 1e-3);
            if (err > maxError) {
              maxError = err;
              worst = { input: [input[i][0], input[i][1], input[i][2]], gpu: [gpu[0], gpu[1], gpu[2]], js: [js[0], js[1], js[2]] };
            }
          }
        }
      }
    } finally {
      renderer.setRenderTarget(previous);
      u.tDiffuse.value = kept.tDiffuse;
      u.uAmount.value = kept.amount;
      (u.uBalance.value as THREE.Vector3).copy(kept.balance);
      (u.uShadowTint.value as THREE.Vector3).copy(kept.shadow);
      (u.uHighlightTint.value as THREE.Vector3).copy(kept.highlight);
      u.uSplit.value = kept.split;
      u.uSaturation.value = kept.saturation;
      u.uContrast.value = kept.contrast;
      u.uPivot.value = kept.pivot;
      u.uCompare.value = kept.compare;
      texture.dispose();
      rt.dispose();
      geometry.dispose();
    }
    return { ok: maxError < 0.005, texels: count * sets.length, maxError, worst };
  }

  /**
   * An estimate of what this frame's grade does to the frame just drawn. It is an estimate: the
   * grade's real input is the chain buffer after the rays, the bloom and the flare have added
   * light, and that buffer is gone by the time the console runs, so the scene target is read
   * instead. The percentiles describe the world as drawn; the ratios describe what the grade does
   * to pixels like those. It allocates, which is fine for a console call.
   */
  check(renderer: THREE.WebGLRenderer, scene: THREE.WebGLRenderTarget): GradeCheck {
    const w = scene.width;
    const h = scene.height;
    const buf = new Uint16Array(w * h * 4);
    renderer.readRenderTargetPixels(scene, 0, 0, w, h, buf);
    const stride = 4;
    const cols = Math.ceil(w / stride);
    const rows = Math.ceil(h / stride);
    const before = new Float32Array(cols * rows);
    const after = new Float32Array(cols * rows);
    const src: Vec3 = [0, 0, 0];
    const dst: Vec3 = [0, 0, 0];
    let n = 0;
    let nonFinite = 0;
    let lit = 0;
    let darkened = 0;
    let brightened = 0;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const o = (y * w + x) * 4;
        src[0] = THREE.DataUtils.fromHalfFloat(buf[o]);
        src[1] = THREE.DataUtils.fromHalfFloat(buf[o + 1]);
        src[2] = THREE.DataUtils.fromHalfFloat(buf[o + 2]);
        if (!Number.isFinite(src[0]) || !Number.isFinite(src[1]) || !Number.isFinite(src[2])) {
          nonFinite++;
          continue;
        }
        const l0 = luma(src);
        applyGradePixel(src, this.params, this.amount, dst);
        const l1 = luma(dst);
        before[n] = l0;
        after[n] = l1;
        n++;
        if (l0 > 1e-4) {
          lit++;
          const ratio = l1 / l0;
          if (ratio < 0.85) darkened++;
          if (ratio > 1.3) brightened++;
          if (ratio < lowest) lowest = ratio;
          if (ratio > highest) highest = ratio;
        }
      }
    }
    return {
      sampled: n,
      nonFinite,
      amount: this.amount,
      compare: this.compare,
      before: percentiles(before.subarray(0, n)),
      after: percentiles(after.subarray(0, n)),
      darkened: lit > 0 ? darkened / lit : 0,
      brightened: lit > 0 ? brightened / lit : 0,
      ratio: lit > 0 ? [lowest, highest] : [1, 1],
    };
  }

  private readSource(ctx: FxFrameContext, out: GradeSource): void {
    const L = ctx.lighting;
    out.space = ctx.space;
    out.night = ctx.space ? 0 : 1 - ctx.daylight;
    if (!L) {
      setNeutralSource(out);
      this.path = 'neutral';
      return;
    }
    out.key[0] = L.main.r * L.mainScale;
    out.key[1] = L.main.g * L.mainScale;
    out.key[2] = L.main.b * L.mainScale;
    out.fill[0] = L.ambient.r * L.ambientScale;
    out.fill[1] = L.ambient.g * L.ambientScale;
    out.fill[2] = L.ambient.b * L.ambientScale;
    // The air is the fog the scene is actually drawn with; where it is black (in space, and
    // indoors) the sky's clear colour stands for it.
    const f = ctx.fogColor;
    const air = 0.2126 * f.r + 0.7152 * f.g + 0.0722 * f.b > 0.002 ? f : L.clear;
    out.air[0] = air.r;
    out.air[1] = air.g;
    out.air[2] = air.b;
    this.path = ctx.space ? 'space zone' : 'sky ramp';
  }
}

function percentiles(values: Float32Array): GradePercentiles {
  if (values.length === 0) return { p1: 0, p5: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = Float32Array.from(values).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  return { p1: at(0.01), p5: at(0.05), p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

export class GrainVignettePass extends ShaderFxPass {
  readonly id: FxPassId = 'grainVignette';

  constructor() {
    super(GRAIN_VIGNETTE);
  }

  enabled(ctx: FxFrameContext): boolean {
    const s = ctx.settings;
    return (s.filmGrain && s.filmGrainStrength > 0) || (s.vignette && s.vignetteStrength > 0);
  }

  reason(ctx: FxFrameContext): string | null {
    return this.enabled(ctx) ? null : 'the vignette and the grain are both at zero';
  }

  prepare(ctx: FxFrameContext): void {
    const s = ctx.settings;
    const u = this.material.uniforms;
    // Aiming tightens the vignette a little, as a focus cue, and only while it is on at all.
    u.uVignette.value = s.vignette ? Math.min(1, s.vignetteStrength + AIM_VIGNETTE * ctx.aimAmount) : 0;
    u.uGrain.value = s.filmGrain ? s.filmGrainStrength : 0;
    u.uGrainStep.value = Math.floor(ctx.time * GRAIN_RATE) % 65536;
    u.uFrame.value = ctx.frame % 65536;
  }

  setSize(_width: number, height: number, _settings: FxSettings): void {
    // The same apparent grain size at any resolution and render scale.
    this.material.uniforms.uGrainCell.value = Math.max(1, (height / 1080) * GRAIN_CELL_1080);
  }
}
