// Water that mirrors the scene. Water writes no depth and is drawn blended, so nothing in the frame
// says where it is or which way it faces; a geometry product, the water mask, draws every water
// body again (its twin: the same shader compiled with WATER_FX_MASK) into three targets that share
// the scene's depth:
//   target 0: the surface's view normal (octahedral), its view depth, and coverage (1 wherever
//             water is drawn in front of the scene depth; the ambient occlusion reads this alpha).
//             Where one view ray meets the water several times it holds the last surface drawn,
//             which is not always the nearest;
//   target 1: the environment term the lit water leaves out while this pass runs, already weighted
//             by the blend and the fog; in alpha, how opaque the water is there;
//   target 2: in red, the weight a traced colour gets there.
// Targets 1 and 2 are blended as the lit water is blended, because where one view ray crosses the
// swell several times (a crest's front, its back, the next crest) the lit sea blends every layer,
// and a single surface a pixel would hold only one of them.
// The reflections pass marches each water pixel's reflected ray through the depth, takes the scene
// where the ray truly passes from in front of a surface to behind it, or the open sky along it,
// and falls back to the environment term only where neither shows. The composite adds
// `environment x (1 - confidence) + weight x traced` into the picture where it stands: where
// nothing is traced that is exactly what the lit water left out, so with nothing traced the frame
// is the one with reflections off.
//
// Whether the lit water leaves its term out is decided once, before the scene is drawn
// (`WaterBodies.active`, from `PostFX.passWanted`), and this pass's `enabled` returns that same
// decision, so the two never disagree about who adds it.
import * as THREE from 'three';
import { FX_WATER_NEEDS_FULL, FX_WATER_NEEDS_HALF, type FxProductId, type FxSettings } from '../fxRegistry.ts';
import type { FxFrameContext } from './context';
import type { PostFX } from '../postfx';
import { createFxQuad, FX_CAMERA, NO_PRODUCTS, type FxDebugTexture, type FxPass, type FxWarmItem } from './pass';
import { applyFxStencil, GeometryProduct } from './geometry';
import { FX_EDGE_FADE, FX_IGN, FX_LINEARIZE, FX_OCT, FX_VIEW_POS } from './glsl';

/** Effects time with no draw after which the mask's full-size targets are given back. */
const MASK_RELEASE_SECONDS = 10;
const BLACK = new THREE.Color(0, 0, 0);
const halfOf = (v: number) => Math.max(1, Math.ceil(v / 2));

/** What the water effect needs from the world; `WaterBodies` provides it. */
export interface WaterFxSource {
  /** The twins and nothing else: no lights, no fog. */
  readonly maskScene: THREE.Scene;
  /** Decided before the scene was drawn: the lit water left its environment term out for this pass to add. */
  readonly active: boolean;
  /** Whether the pass's setting asked for it when the frame began (`PostFX.passWanted`). */
  readonly wanted: boolean;
  readonly inView: boolean;
  readonly underwater: boolean;
  readonly probeMaterial: THREE.Material;
  /**
   * Twins take their meshes' world matrices; the in-frustum ones are made visible and ordered as
   * the lit water was drawn with `camera`. Returns how many bodies are drawn.
   */
  syncTwins(camera: THREE.Camera): number;
  /** The mask drew this many twins this frame, for the description. */
  maskDrawn(n: number): void;
  /** Ask, by an occlusion query drawn into `target` with every write off, whether any water in the frustum shows. */
  probe(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget): boolean;
  maskMaterials(): readonly THREE.Material[];
  warmObjects(): THREE.Object3D[];
}

/** Register the water mask and the reflections pass on a chain. */
export function installWaterReflections(postfx: PostFX, source: WaterFxSource): void {
  const mask = new WaterMaskProduct(postfx, source);
  postfx.registerProduct(mask);
  postfx.registerPass(new WaterReflectionsPass(source, mask));
}

/**
 * The water's own surface, drawn again with its own waves. Its three half-float targets are about
 * 88 MB at 1440p, so they exist only while the mask is drawn: three.js gives a target storage when
 * it is first bound, and ten seconds of effects time without a draw hands the storage back (`idle`).
 */
export class WaterMaskProduct extends GeometryProduct {
  /** Twins drawn this frame (0: cleared only, so no coverage and nothing added). */
  drawn = 0;
  private held = false;
  private lastDrawTime = -Infinity;

  constructor(
    postfx: PostFX,
    private readonly source: WaterFxSource,
  ) {
    super('waterMask', postfx, { format: THREE.RGBAFormat, type: THREE.HalfFloatType, clear: BLACK, clearAlpha: 0, count: 3 });
    this.target.textures[0].name = 'fx.waterMask.surface';
    this.target.textures[1].name = 'fx.waterMask.environment';
    this.target.textures[2].name = 'fx.waterMask.traced';
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_PRODUCTS;
  }

  /** rg the octahedral view normal, b the view depth in metres (of the last water surface drawn there), a coverage: 1 wherever water shows. */
  get surface(): THREE.Texture {
    return this.target.textures[0];
  }

  /** rgb the environment term the lit water left out, weighted by its blend and fog; a how opaque the water is. */
  get environment(): THREE.Texture {
    return this.target.textures[1];
  }

  /** r the weight a traced colour gets. */
  get traced(): THREE.Texture {
    return this.target.textures[2];
  }

  /** Whether the targets hold storage on the card now. */
  get allocated(): boolean {
    return this.held;
  }

  /** Seconds of effects time since the mask was last drawn (Infinity if never). */
  idleFor(ctx: FxFrameContext): number {
    return ctx.time - this.lastDrawTime;
  }

  /**
   * Every frame, before the passes decide: ask whether any water in the frustum really shows. Only
   * while something would use the answer (the reflections, or the occlusion, which reads coverage).
   */
  probe(ctx: FxFrameContext): void {
    if (!this.postfx.passWanted('waterReflections') && !this.postfx.passWanted('ssao')) return;
    applyFxStencil(this.source.probeMaterial, ctx, 'world');
    this.source.probe(ctx.renderer, ctx.camera, this.postfx.sceneTarget);
  }

  /** A frame the mask is not wanted: give the targets back after a while without a draw. */
  idle(ctx: FxFrameContext): void {
    if (this.held && ctx.time - this.lastDrawTime > MASK_RELEASE_SECONDS) this.release();
  }

  render(ctx: FxFrameContext): void {
    // Binding the target in the base render gives it storage again if it was released.
    this.held = true;
    this.lastDrawTime = ctx.time;
    super.render(ctx);
  }

  protected draw(ctx: FxFrameContext): void {
    const n = this.source.syncTwins(ctx.camera);
    this.drawn = n;
    this.source.maskDrawn(n);
    if (n === 0) return;
    const mats = this.source.maskMaterials();
    for (let i = 0; i < mats.length; i++) applyFxStencil(mats[i], ctx, 'world');
    const cam = ctx.camera;
    const layers = cam.layers.mask;
    // The portal renderer leaves whichever layer its last pass drew; the water is on layer 0.
    cam.layers.set(0);
    try {
      this.drawer.drawScene(ctx, this.source.maskScene);
    } finally {
      cam.layers.mask = layers;
    }
  }

  materials(): FxWarmItem[] {
    return this.source.warmObjects().map((o) => ({ material: (o as THREE.Mesh).material as THREE.Material, object: o, where: 'target' as const }));
  }

  dispose(): void {
    super.dispose();
    this.held = false;
  }

  /**
   * Free the storage and keep the target: the shared depth is detached first (disposing a target
   * disposes its depth texture) and attached again, so the next bind builds the same target anew.
   */
  private release(): void {
    const rt = this.target;
    rt.depthTexture = null;
    rt.dispose();
    rt.depthTexture = this.postfx.sceneDepth;
    this.held = false;
  }
}

const TRACE_VERTEX = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const TRACE_FRAGMENT = /* glsl */ `
  uniform sampler2D tMask;
  uniform sampler2D tMaskTraced;
  uniform sampler2D tColor;
  #ifdef FULL_RES
    uniform sampler2D tDepth;
  #else
    uniform sampler2D tLinear;
  #endif
  uniform mat4 uProj;
  uniform vec3 uViewUp;
  uniform vec2 uTanHalfFov;
  uniform float uNear;
  uniform float uFar;
  uniform vec2 uFullSize;
  uniform vec2 uTraceSize;
  uniform float uMaxDistance;
  uniform float uThickness;
  uniform float uThicknessPerMetre;
  uniform float uMinWeight;
  uniform float uSky;

  #define STEPS 32
  #define REFINE 6
  #define MAX_CROSSINGS 3

  ${FX_LINEARIZE}
  ${FX_VIEW_POS}
  ${FX_OCT}
  ${FX_IGN}
  ${FX_EDGE_FADE}

  // The reflected segment in trace pixels and homogeneous depth, set once per pixel in main.
  vec2 gS0;
  vec2 gS1;
  float gZ0;
  float gZ1;
  float gK0;
  float gK1;

  // The scene's positive view depth at a place in trace pixels; the far plane for sky and for
  // anything that wrote no depth (water, glows, particles).
  float sceneZAt(vec2 s) {
    ivec2 p = clamp(ivec2(s), ivec2(0), ivec2(uTraceSize) - 1);
    #ifdef FULL_RES
      float d = texelFetch(tDepth, p, 0).r;
      return d >= 1.0 ? uFar : fxViewZ(d, uNear, uFar);
    #else
      return texelFetch(tLinear, p, 0).r;
    #endif
  }
  // Positive view depth of the ray at screen parameter t (z/w and 1/w are linear in screen space).
  float rayDepth(float t) { return -mix(gZ0, gZ1, t) / mix(gK0, gK1, t); }
  bool solid(float sz) { return sz < uFar * 0.999; }

  void main() {
    ivec2 tp = ivec2(gl_FragCoord.xy);
    #ifdef FULL_RES
      ivec2 fp = tp;
    #else
      // The same full-resolution pixel the half-resolution depth sampled for this texel.
      ivec2 fp = min(tp * 2 + 1, ivec2(uFullSize) - 1);
    #endif
    vec4 m = texelFetch(tMask, fp, 0);
    // No water, or so little light to add (fogged far water, a nearly clear pool seen from above)
    // that tracing is wasted.
    if (m.a <= 0.0 || texelFetch(tMaskTraced, fp, 0).r < uMinWeight) { gl_FragColor = vec4(0.0); return; }

    vec2 uv = (vec2(fp) + 0.5) / uFullSize;
    vec3 P = fxViewPos(uv, m.b, uTanHalfFov);
    vec3 N = fxOctDecode(m.rg);
    vec3 V = normalize(P);
    // A crest seen from behind: nothing sensible to mirror.
    if (dot(N, -V) <= 1e-3) { gl_FragColor = vec4(0.0); return; }
    vec3 R = reflect(V, N);
    // A steep ripple can turn the reflection below the horizontal; it would mirror the bed, which
    // the surface hides.
    float up = dot(R, uViewUp);
    if (up <= 0.0) { gl_FragColor = vec4(0.0); return; }

    // 1. The segment from P along R, in screen space, never reaching behind the near plane.
    float len = uMaxDistance;
    if (R.z > 0.0) len = min(len, (-uNear * 1.01 - P.z) / R.z);
    vec3 Q = P + R * len;
    vec4 H0 = uProj * vec4(P, 1.0);
    vec4 H1 = uProj * vec4(Q, 1.0);
    gK0 = 1.0 / H0.w;
    gK1 = 1.0 / H1.w;
    gS0 = (H0.xy * gK0 * 0.5 + 0.5) * uTraceSize;
    gS1 = (H1.xy * gK1 * 0.5 + 0.5) * uTraceSize;
    gZ0 = P.z * gK0;
    gZ1 = Q.z * gK1;
    vec2 d = gS1 - gS0;
    // Where the segment leaves the screen.
    float tEnd = 1.0;
    if (d.x > 0.0) tEnd = min(tEnd, (uTraceSize.x - 0.5 - gS0.x) / d.x); else if (d.x < 0.0) tEnd = min(tEnd, (0.5 - gS0.x) / d.x);
    if (d.y > 0.0) tEnd = min(tEnd, (uTraceSize.y - 0.5 - gS0.y) / d.y); else if (d.y < 0.0) tEnd = min(tEnd, (0.5 - gS0.y) / d.y);
    // A pixel on the screen's very edge heading out of it has nothing to march.
    tEnd = max(tEnd, 0.0);
    float pixels = max(abs(d.x), abs(d.y)) * tEnd;
    // At least a pixel a step.
    float dt = max(tEnd / float(STEPS), tEnd / max(pixels, 1.0));
    float jitter = fxIgn(gl_FragCoord.xy);

    // 2. March. A hit is a crossing: in front of the scene at the previous sample, behind it at this
    //    one, confirmed after refinement to be a surface within a thickness that scales with depth.
    //    A ray passing behind a nearer object is not a hit and keeps going.
    bool hit = false;
    float tHit = 0.0;
    float tPrev = 0.0;
    // The start is on the surface, in front of the bed beneath it.
    bool behindPrev = false;
    int crossings = 0;
    if (tEnd > 0.0) {
      for (int i = 0; i < STEPS; i++) {
        float t = (float(i) + jitter) * dt;
        if (t > tEnd) break;
        float sz = sceneZAt(mix(gS0, gS1, t));
        bool behind = solid(sz) && rayDepth(t) > sz;
        if (behind && !behindPrev) {
          float a = tPrev;
          float b = t;
          // 64 times finer: under a pixel for any step up to 64 pixels.
          for (int j = 0; j < REFINE; j++) {
            float mid = 0.5 * (a + b);
            float sm = sceneZAt(mix(gS0, gS1, mid));
            if (solid(sm) && rayDepth(mid) > sm) b = mid; else a = mid;
          }
          float rb = rayDepth(b);
          float sb = sceneZAt(mix(gS0, gS1, b));
          // The allowed gap: a floor, a share of the depth, and how far the ray itself moves over
          // the last sub-pixel interval.
          float thick = max(uThickness, sb * uThicknessPerMetre) + abs(rb - rayDepth(a));
          if (rb - sb < thick) { hit = true; tHit = b; break; }
          crossings++;
          if (crossings >= MAX_CROSSINGS) break;
        }
        behindPrev = behind;
        tPrev = t;
      }
    }

    vec3 color = vec3(0.0);
    float conf = 0.0;
    if (hit) {
      vec2 huv = mix(gS0, gS1, tHit) / uTraceSize;
      color = texture2D(tColor, huv).rgb;
      // The hit's share of the reach in 3D (perspective-correct).
      float s3 = tHit * gK1 / mix(gK0, gK1, tHit);
      conf = fxEdgeFade(huv, 0.06)
           * (1.0 - smoothstep(0.75, 1.0, s3 * len / uMaxDistance))
           // Rays heading back at the camera see what is behind it, which is not on screen.
           * (1.0 - smoothstep(0.2, 0.7, R.z));
    } else if (uSky > 0.5 && R.z < 0.0) {
      // 3. Open sky along the reflected direction. The sky is centred on the camera, so its colour
      //    for direction R is on screen wherever a view ray has direction R; only where that pixel
      //    is sky: nothing wrote depth there, and it is not water, which wrote none either (the far
      //    ring beyond the loaded terrain reads as cleared depth).
      vec4 D = uProj * vec4(R, 0.0);
      vec2 duv = D.xy / D.w * 0.5 + 0.5;
      if (all(greaterThan(duv, vec2(0.0))) && all(lessThan(duv, vec2(1.0)))
          && !solid(sceneZAt(duv * uTraceSize))
          && texelFetch(tMask, clamp(ivec2(duv * uFullSize), ivec2(0), ivec2(uFullSize) - 1), 0).a <= 0.0) {
        color = texture2D(tColor, duv).rgb;
        conf = fxEdgeFade(duv, 0.1);
      }
    }
    // No step where a ripple tips the ray toward the horizontal.
    conf *= smoothstep(0.0, 0.05, up);
    // Premultiplied, so the upsample never darkens toward the edges of what was traced.
    gl_FragColor = vec4(color * conf, conf);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D tMask;
  uniform sampler2D tMaskEnv;
  uniform sampler2D tMaskTraced;
  uniform sampler2D tTrace;
  uniform vec2 uTraceSize;
  uniform vec2 uFullSize;
  uniform int uTraceScale;
  uniform int uTraceOffset;
  uniform float uStrength;
  uniform int uView;

  void main() {
    ivec2 fp = ivec2(gl_FragCoord.xy);
    vec4 m = texelFetch(tMask, fp, 0);
    bool debugPicture = uView == 1 || uView == 2;
    // Not water: unchanged, or darkened for a debug view.
    if (m.a <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, debugPicture ? 0.25 : 1.0); return; }
    // The weighted environment term, and the weight a traced colour gets.
    vec3 e = texelFetch(tMaskEnv, fp, 0).rgb;
    float k = texelFetch(tMaskTraced, fp, 0).r;

    // Depth-aware 2x2 upsample of the premultiplied trace, each texel weighted by how close its
    // water's depth is to this pixel's.
    vec2 tpos = (vec2(fp) - float(uTraceOffset)) / float(uTraceScale);
    ivec2 t0 = ivec2(floor(tpos));
    vec2 f = tpos - vec2(t0);
    vec4 sum = vec4(0.0);
    float wsum = 0.0;
    for (int j = 0; j <= 1; j++) {
      for (int i = 0; i <= 1; i++) {
        ivec2 tq = clamp(t0 + ivec2(i, j), ivec2(0), ivec2(uTraceSize) - 1);
        vec4 ms = texelFetch(tMask, min(tq * uTraceScale + uTraceOffset, ivec2(uFullSize) - 1), 0);
        float wz = ms.a > 0.0 ? exp(-abs(ms.b - m.b) / (0.02 * m.b + 0.05)) : 0.0;
        float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
        float w = (wb + 1e-3) * wz;
        sum += texelFetch(tTrace, tq, 0) * w;
        wsum += w;
      }
    }
    // Premultiplied: tr.rgb is the traced colour times its confidence.
    vec4 tr = wsum > 1e-6 ? sum / wsum : vec4(0.0);
    float conf = clamp(tr.a, 0.0, 1.0);

    vec3 add = uView == 3 ? e
             : uView == 4 ? k * tr.rgb
             : e * (1.0 - conf) + k * tr.rgb;
    add *= uStrength;
    // After the clean-up pass, so a bad value here would reach the bloom and spread: drop it, and
    // hold the rest under the clean-up's ceiling. The comparison also catches a not-a-number where
    // a driver folds isnan away.
    if (any(isnan(add)) || any(isinf(add)) || !all(greaterThanEqual(add, vec3(0.0)))) add = vec3(0.0);
    add = min(add, vec3(256.0));
    // Confidence: red traced, blue fallback.
    if (uView == 1) { gl_FragColor = vec4(conf, 0.0, 1.0 - conf, 0.0); return; }
    // The added light alone, brightened.
    if (uView == 2) { gl_FragColor = vec4(add * 4.0, 0.0); return; }
    gl_FragColor = vec4(add, 1.0);
  }
`;

/** The composite's views, by the name `__debug.waterFx({ view })` takes. */
const WATER_FX_VIEWS = { off: 0, confidence: 1, added: 2, envOnly: 3, tracedOnly: 4 } as const;

export class WaterReflectionsPass implements FxPass {
  readonly id = 'waterReflections' as const;
  readonly timerLabel = 'pass:waterReflections';
  /** `tune.view` by name, for `__debug.waterFx({ view })`, which reads the pass without importing it. */
  readonly views = WATER_FX_VIEWS;
  /** Console tuning (`__debug.waterFx`); not saved. */
  readonly tune = { maxDistance: 1500, thickness: 0.25, thicknessPerMetre: 0.01, minWeight: 0.002, sky: true, strength: 1, view: 0 as 0 | 1 | 2 | 3 | 4 };
  private readonly traceUniforms: Record<string, THREE.IUniform>;
  private readonly compositeUniforms: Record<string, THREE.IUniform>;
  private readonly traceHalf: THREE.ShaderMaterial;
  private readonly traceFull: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly traceHalfQuad: THREE.Mesh;
  private readonly traceFullQuad: THREE.Mesh;
  private readonly compositeQuad: THREE.Mesh;
  /** RGBA half floats, nearest, no depth: the premultiplied traced colour and its confidence. */
  private readonly trace: THREE.WebGLRenderTarget;
  /** World up in view space, for rays that a ripple tips under the horizontal. */
  private readonly viewUp = new THREE.Vector3();
  private full = false;
  private debugList: FxDebugTexture[] | null = null;

  constructor(
    private readonly source: WaterFxSource,
    private readonly mask: WaterMaskProduct,
  ) {
    this.trace = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.trace.texture.name = 'fx.waterReflections.trace';
    // One uniform set for both trace shaders: each program uploads only the ones it declares.
    this.traceUniforms = {
      tMask: { value: null },
      tMaskTraced: { value: null },
      tColor: { value: null },
      tLinear: { value: null },
      tDepth: { value: null },
      uProj: { value: new THREE.Matrix4() },
      uViewUp: { value: this.viewUp },
      uTanHalfFov: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.05 },
      uFar: { value: 9000 },
      uFullSize: { value: new THREE.Vector2(1, 1) },
      uTraceSize: { value: new THREE.Vector2(1, 1) },
      uMaxDistance: { value: this.tune.maxDistance },
      uThickness: { value: this.tune.thickness },
      uThicknessPerMetre: { value: this.tune.thicknessPerMetre },
      uMinWeight: { value: this.tune.minWeight },
      uSky: { value: 1 },
    };
    this.compositeUniforms = {
      tMask: { value: null },
      tMaskEnv: { value: null },
      tMaskTraced: { value: null },
      tTrace: { value: this.trace.texture },
      uTraceSize: { value: new THREE.Vector2(1, 1) },
      uFullSize: { value: new THREE.Vector2(1, 1) },
      uTraceScale: { value: 2 },
      uTraceOffset: { value: 1 },
      uStrength: { value: 1 },
      uView: { value: 0 },
    };
    const trace = (full: boolean) =>
      new THREE.ShaderMaterial({
        name: full ? 'fx.waterReflections.traceFull' : 'fx.waterReflections.traceHalf',
        uniforms: this.traceUniforms,
        vertexShader: TRACE_VERTEX,
        fragmentShader: TRACE_FRAGMENT,
        defines: full ? { FULL_RES: '' } : {},
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
    this.traceHalf = trace(false);
    this.traceFull = trace(true);
    // Added into the picture where it stands: src.rgb + dst.rgb x src.a, the destination's alpha
    // kept. A normal pixel writes (light, 1); a pixel with nothing to add (0, 0, 0, 1); the debug
    // views (colour, 0) on water, which replaces it, and (0, 0, 0, 0.25) elsewhere, which darkens it.
    // Three applies custom blending whether or not a material is transparent, and the factors are
    // not in the program's key.
    this.composite = new THREE.ShaderMaterial({
      name: 'fx.waterReflections.composite',
      uniforms: this.compositeUniforms,
      vertexShader: TRACE_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.traceHalfQuad = createFxQuad(this.traceHalf);
    this.traceFullQuad = createFxQuad(this.traceFull);
    this.compositeQuad = createFxQuad(this.composite);
  }

  /** Exactly the decision the lit water was drawn under this frame. */
  enabled(_ctx: FxFrameContext): boolean {
    return this.source.active;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return this.full ? FX_WATER_NEEDS_FULL : FX_WATER_NEEDS_HALF;
  }

  reason(_ctx: FxFrameContext): string | null {
    // Its setting (or a console override) is off: the chain's own words say so.
    if (!this.source.wanted) return null;
    if (this.source.underwater) return 'camera under water';
    if (!this.source.inView) return 'no water in view';
    if (!this.source.active) return 'not wanted when the frame began';
    return null;
  }

  prepare(ctx: FxFrameContext): void {
    const t = this.traceUniforms;
    const tune = this.tune;
    t.tMask.value = this.mask.surface;
    t.tMaskTraced.value = this.mask.traced;
    t.tLinear.value = ctx.products.linearDepthHalf;
    t.tDepth.value = ctx.depth;
    t.uProj.value = ctx.proj;
    t.uTanHalfFov.value = ctx.tanHalfFov;
    this.viewUp.set(0, 1, 0).transformDirection(ctx.view);
    t.uNear.value = ctx.near;
    t.uFar.value = ctx.far;
    (t.uFullSize.value as THREE.Vector2).set(ctx.width, ctx.height);
    (t.uTraceSize.value as THREE.Vector2).set(this.trace.width, this.trace.height);
    t.uMaxDistance.value = tune.maxDistance;
    t.uThickness.value = tune.thickness;
    t.uThicknessPerMetre.value = tune.thicknessPerMetre;
    t.uMinWeight.value = tune.minWeight;
    t.uSky.value = tune.sky ? 1 : 0;
    const c = this.compositeUniforms;
    c.tMask.value = this.mask.surface;
    c.tMaskEnv.value = this.mask.environment;
    c.tMaskTraced.value = this.mask.traced;
    (c.uTraceSize.value as THREE.Vector2).set(this.trace.width, this.trace.height);
    (c.uFullSize.value as THREE.Vector2).set(ctx.width, ctx.height);
    c.uTraceScale.value = this.full ? 1 : 2;
    c.uTraceOffset.value = this.full ? 0 : 1;
    c.uStrength.value = tune.strength;
    c.uView.value = tune.view;
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, _output: THREE.WebGLRenderTarget | null): boolean {
    const r = ctx.renderer;
    this.traceUniforms.tColor.value = input.texture;
    r.setRenderTarget(this.trace);
    // The triangle covers every texel, and every texel is written: no clear.
    r.render(this.full ? this.traceFullQuad : this.traceHalfQuad, FX_CAMERA);
    // Into the picture it read, as the bloom composites into its input. The composite samples the
    // mask and the trace only, never `input`, so there is no feedback.
    r.setRenderTarget(input);
    r.render(this.compositeQuad, FX_CAMERA);
    return false;
  }

  setSize(width: number, height: number, settings: FxSettings): void {
    this.full = settings.waterReflectionResolution >= 1;
    this.trace.setSize(this.full ? width : halfOf(width), this.full ? height : halfOf(height));
  }

  materials(): FxWarmItem[] {
    return [{ material: this.traceHalf }, { material: this.traceFull }, { material: this.composite }];
  }

  /**
   * `__debug.fxView('waterReflections.<name>')`: `trace` and `confidence` (what the march found),
   * `env` (the environment term the mask holds, times 4), `alpha` (how opaque the water is),
   * `weight` (a traced colour's weight, times 4), `surface` (coverage).
   */
  debugTextures(): readonly FxDebugTexture[] {
    return (this.debugList ??= [
      { name: 'trace', texture: this.trace.texture, channels: 'rgb' },
      { name: 'confidence', texture: this.trace.texture, channels: 'a' },
      { name: 'env', texture: this.mask.environment, channels: 'rgb', scale: 4 },
      { name: 'alpha', texture: this.mask.environment, channels: 'a' },
      { name: 'weight', texture: this.mask.traced, channels: 'r', scale: 4 },
      { name: 'surface', texture: this.mask.surface, channels: 'a' },
    ]);
  }

  dispose(): void {
    this.traceHalf.dispose();
    this.traceFull.dispose();
    this.composite.dispose();
    this.trace.dispose();
  }
}
