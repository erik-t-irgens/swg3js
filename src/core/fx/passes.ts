// The passes the game has today, repaired and put in the order that makes each of them mean
// something: the picture is cleaned of pixels that are not numbers, the sun's rays are scattered
// into it, the camera's movement smears it, the bright parts spill over, the tone curve and the
// colour space are applied once, the edges are smoothed, and a debug view can replace the lot with
// one of the shared products.
//
// The god rays and the motion blur read the frame's own depth. That only works because the scene
// now has a target of its own that nothing in the chain writes into: before, each of them wrote
// into the very buffer whose depth it was sampling, the browser threw the draw away, and the rays
// never showed while the blur and the bloom went missing whenever the sun was off screen.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { FxPassId, FxProductId, FxSettings } from '../fxRegistry.ts';
import type { FxFrameContext } from './context';
import { NO_PRODUCTS, ShaderFxPass, ThreePassAdapter, type FxDebugTexture, type FxWarmItem } from './pass';
import { FX_FULLSCREEN_VERTEX, FX_LINEARIZE } from './glsl';

/** The blur is scaled as if every frame lasted this long, so a slow frame is not a longer smear. */
const SHUTTER = 1 / 60;

/**
 * A pixel that is not a number (a material that divided by zero: a degenerate tangent, a zero
 * roughness against a reflection) is black on the screen, and the bloom's blur spreads it into a
 * black box the size of its coarsest level. Such pixels are made black and opaque before anything
 * else sees them, and the brightest are held to a ceiling.
 */
const SANITIZE = {
  uniforms: { tScene: { value: null as THREE.Texture | null } },
  vertexShader: FX_FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tScene;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tScene, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 256.0), 1.0);
    }
  `,
};

/**
 * God rays: light from the sun scattered towards the eye, drawn from the frame's own depth. Where
 * the depth says sky, the sun shines through; where it says a wall, a tree, a hull, it is blocked;
 * the picture is marched towards the sun's place on the screen, summing the open sky along the
 * way with a decay, and the sum tints the pixel with the sun's colour. Nothing is drawn twice.
 */
const GOD_RAYS = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    /** The sun on the screen, in uv, and how much of it shows (0 behind the camera or under the horizon). */
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVisible: { value: 0 },
    uColor: { value: new THREE.Color(1, 0.95, 0.85) },
    uStrength: { value: 0.6 },
    uAspect: { value: 1.6 },
    uNearFar: { value: new THREE.Vector2(0.05, 9000) },
    /** Depth past this distance counts as sky. */
    uSkyDistance: { value: 2500 },
  },
  vertexShader: FX_FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uSun;
    uniform float uSunVisible;
    uniform vec3 uColor;
    uniform float uStrength;
    uniform float uAspect;
    uniform vec2 uNearFar;
    uniform float uSkyDistance;
    varying vec2 vUv;
    ${FX_LINEARIZE}
    float sky(vec2 uv) {
      return step(uSkyDistance, fxViewZ(texture2D(tDepth, uv).x, uNearFar.x, uNearFar.y));
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (uSunVisible <= 0.001 || uStrength <= 0.001) {
        gl_FragColor = c;
        return;
      }
      // The rays are strongest around the sun and fade across the screen.
      vec2 toSun = (uSun - vUv) * vec2(uAspect, 1.0);
      float falloff = smoothstep(1.6, 0.05, length(toSun));
      if (falloff <= 0.0) {
        gl_FragColor = c;
        return;
      }
      const int N = 48;
      vec2 step2 = (uSun - vUv) * (0.85 / float(N));
      vec2 uv = vUv;
      float illum = 1.0;
      float acc = 0.0;
      for (int i = 0; i < N; i++) {
        uv += step2;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        acc += sky(uv) * illum;
        illum *= 0.965;
      }
      acc /= float(N);
      c.rgb += uColor * (acc * acc * 1.4 + acc * 0.3) * uStrength * uSunVisible * falloff;
      gl_FragColor = c;
    }
  `,
};

/**
 * A camera motion blur from the depth buffer: each pixel's point is found in the world from its
 * depth, projected with the last frame's camera to see where it was on the screen, and the colour
 * is averaged along that movement. Nothing is stored per object, so what moves with the camera
 * (the ship flown) stays sharp, and what the camera moves past smears in proportion.
 */
const MOTION_BLUR = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uInvViewProj: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    /** How much of the movement is smeared (0 none, 1 the whole frame's). */
    uStrength: { value: 0.5 },
    /** The longest smear, as a share of the screen. */
    uMaxLength: { value: 0.04 },
    /** The camera's near and far planes, to turn depth into distance. */
    uNearFar: { value: new THREE.Vector2(0.05, 9000) },
    /** Nothing nearer than the first distance smears, everything past the second does: what moves with the camera (the ship flown, a cockpit) sits close and stays sharp. */
    uNearCut: { value: new THREE.Vector2(25, 60) },
  },
  vertexShader: FX_FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform mat4 uInvViewProj;
    uniform mat4 uPrevViewProj;
    uniform float uStrength;
    uniform float uMaxLength;
    uniform vec2 uNearFar;
    uniform vec2 uNearCut;
    varying vec2 vUv;
    ${FX_LINEARIZE}
    void main() {
      float depth = texture2D(tDepth, vUv).x;
      float ndcZ = depth * 2.0 - 1.0;
      vec4 clip = vec4(vUv * 2.0 - 1.0, ndcZ, 1.0);
      vec4 world = uInvViewProj * clip;
      world /= world.w;
      vec4 prev = uPrevViewProj * world;
      vec2 prevUv = prev.xy / prev.w * 0.5 + 0.5;
      // How far away the point is: what is close moves with the camera (the hull, the cockpit) and is left sharp.
      float dist = fxViewZ(depth, uNearFar.x, uNearFar.y);
      vec2 v = (vUv - prevUv) * uStrength * smoothstep(uNearCut.x, uNearCut.y, dist);
      float len = length(v);
      if (len > uMaxLength) v *= uMaxLength / len;
      // Nothing to do for a still pixel: the sharp picture as it is.
      if (len < 0.0005) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      vec4 c = vec4(0.0);
      const int N = 12;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1) - 0.5;
        c += texture2D(tDiffuse, vUv + v * t);
      }
      gl_FragColor = c / float(N);
    }
  `,
};

export class SanitizePass extends ShaderFxPass {
  readonly id: FxPassId = 'sanitize';

  constructor() {
    // The only pass that reads the scene target's colour, so it takes no input from the chain.
    super(SANITIZE, null);
  }

  prepare(ctx: FxFrameContext): void {
    this.material.uniforms.tScene.value = ctx.sceneColor;
  }
}

export class GodRaysPass extends ShaderFxPass {
  readonly id: FxPassId = 'godRays';

  constructor() {
    super(GOD_RAYS);
  }

  enabled(ctx: FxFrameContext): boolean {
    return !!ctx.sun && ctx.sun.fade > 0 && ctx.settings.godRayStrength > 0;
  }

  reason(ctx: FxFrameContext): string | null {
    if (ctx.settings.godRayStrength <= 0) return 'god ray strength is zero';
    if (!ctx.sun) return 'no sun on this world';
    if (ctx.sun.fade <= 0) return ctx.sun.behind ? 'the sun is behind the camera' : 'no sun on screen';
    return null;
  }

  prepare(ctx: FxFrameContext): void {
    const sun = ctx.sun!;
    const u = this.material.uniforms;
    (u.uSun.value as THREE.Vector2).copy(sun.screen);
    u.uSunVisible.value = sun.fade;
    (u.uColor.value as THREE.Color).copy(sun.color);
    u.uStrength.value = ctx.settings.godRayStrength;
    u.uAspect.value = ctx.width / Math.max(1, ctx.height);
    u.tDepth.value = ctx.depth;
    (u.uNearFar.value as THREE.Vector2).set(ctx.near, ctx.far);
  }
}

export class MotionBlurPass extends ShaderFxPass {
  readonly id: FxPassId = 'motionBlur';

  constructor() {
    super(MOTION_BLUR);
  }

  enabled(ctx: FxFrameContext): boolean {
    return ctx.settings.motionBlurStrength > 0 && !ctx.cameraCut;
  }

  reason(ctx: FxFrameContext): string | null {
    if (ctx.settings.motionBlurStrength <= 0) return 'motion blur strength is zero';
    if (ctx.cameraCut) return 'the camera jumped, so there is no history';
    return null;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    // Only the camera's own movement for now; the velocity product joins it with moving things.
    return NO_PRODUCTS;
  }

  prepare(ctx: FxFrameContext): void {
    const u = this.material.uniforms;
    u.tDepth.value = ctx.depth;
    (u.uInvViewProj.value as THREE.Matrix4).copy(ctx.invViewProj);
    (u.uPrevViewProj.value as THREE.Matrix4).copy(ctx.prevViewProj);
    u.uStrength.value = ctx.settings.motionBlurStrength * THREE.MathUtils.clamp(SHUTTER / Math.max(ctx.dt, 1e-3), 0.25, 2);
    (u.uNearFar.value as THREE.Vector2).set(ctx.near, ctx.far);
  }
}

export class BloomPass extends ThreePassAdapter {
  readonly id: FxPassId = 'bloom';
  private readonly bloom: UnrealBloomPass;

  constructor(width: number, height: number, strength: number) {
    // The full size goes in: the pass halves whatever it is given, so passing half meant the
    // bright target started at a quarter and the glow grew wider after every resize.
    const inner = new UnrealBloomPass(new THREE.Vector2(width, height), strength, 0.5, 0.85);
    super(inner);
    this.bloom = inner;
  }

  /** The blurred levels, coarsest last; the lens flare reuses them rather than blurring again. */
  get mips(): THREE.Texture[] {
    return this.bloom.renderTargetsVertical.map((t) => t.texture);
  }

  enabled(ctx: FxFrameContext): boolean {
    return ctx.settings.bloomStrength > 0;
  }

  reason(ctx: FxFrameContext): string | null {
    return ctx.settings.bloomStrength > 0 ? null : 'bloom strength is zero';
  }

  prepare(ctx: FxFrameContext): void {
    this.bloom.strength = ctx.settings.bloomStrength;
  }

  materials(): FxWarmItem[] {
    // The pass never draws to the canvas, so its plain copy material is never used.
    const items: FxWarmItem[] = [{ material: this.bloom.materialHighPassFilter }, { material: this.bloom.compositeMaterial }, { material: this.bloom.blendMaterial }];
    for (const m of this.bloom.separableBlurMaterials) items.push({ material: m });
    return items;
  }
}

export class OutputFxPass extends ThreePassAdapter {
  readonly id: FxPassId = 'output';
  private readonly output: OutputPass;

  constructor() {
    const inner = new OutputPass();
    super(inner);
    this.output = inner;
  }

  materials(): FxWarmItem[] {
    return [{ material: this.output.material, where: 'both' }];
  }

  /**
   * three's output pass works out the tone curve and the colour space it was asked for on its first
   * draw, so compiling it before then builds a program with neither, which nothing ever draws with.
   * One throw-away draw first, into a buffer it is not reading, settles them.
   */
  settleDefines(renderer: THREE.WebGLRenderer, into: THREE.WebGLRenderTarget, from: THREE.WebGLRenderTarget): void {
    const previous = renderer.getRenderTarget();
    this.output.renderToScreen = false;
    this.output.render(renderer, into, from, 0, false);
    renderer.setRenderTarget(previous);
  }
}

export class FxaaPass extends ShaderFxPass {
  readonly id: FxPassId = 'fxaa';

  constructor() {
    super(FXAAShader);
  }

  setSize(width: number, height: number, _settings: FxSettings): void {
    (this.material.uniforms.resolution.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }
}

const DEBUG_VIEW = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tScene: { value: null as THREE.Texture | null },
    tShown: { value: null as THREE.Texture | null },
    uMode: { value: 0 },
    uChannel: { value: 0 },
    uScale: { value: 1 },
    uNearFar: { value: new THREE.Vector2(0.05, 9000) },
  },
  vertexShader: FX_FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tScene;
    uniform sampler2D tShown;
    uniform int uMode;
    uniform int uChannel;
    uniform float uScale;
    uniform vec2 uNearFar;
    varying vec2 vUv;
    ${FX_LINEARIZE}
    float greyDistance(float z) {
      return log(1.0 + max(0.0, z)) / log(1.0 + uNearFar.y);
    }
    void main() {
      vec4 s = texture2D(tShown, vUv);
      vec3 c;
      if (uMode == 0) {
        vec3 raw = texture2D(tScene, vUv).rgb;
        c = raw / (raw + vec3(1.0));
      } else if (uMode == 1) {
        c = vec3(greyDistance(s.r));
      } else if (uMode == 2) {
        c = s.rgb * uScale;
      } else if (uMode == 3) {
        float v = uChannel == 0 ? s.r : uChannel == 1 ? s.g : uChannel == 2 ? s.b : s.a;
        c = vec3(v * uScale);
      } else if (uMode == 4) {
        c = mix(texture2D(tDiffuse, vUv).rgb, s.rgb, clamp(s.a, 0.0, 1.0));
      } else if (uMode == 5) {
        c = vec3(0.5 + s.r * uScale, 0.5 + s.g * uScale, 0.5);
      } else if (uMode == 7) {
        // The water mask: its octahedral normal as colour wherever water shows, over the picture.
        vec3 raw = texture2D(tScene, vUv).rgb;
        vec3 under = raw / (raw + vec3(1.0));
        c = s.a > 0.0 ? mix(under, vec3(s.rg * 0.5 + 0.5, 0.0), 0.8) : under;
      } else {
        c = vec3(greyDistance(fxViewZ(s.x, uNearFar.x, uNearFar.y)));
      }
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

/** How each product is best read, and how much to multiply it by to see it. */
const PRODUCT_VIEW: Record<FxProductId, { mode: number; channel: number; scale: number }> = {
  linearDepthHalf: { mode: 1, channel: 0, scale: 1 },
  normalsHalf: { mode: 2, channel: 0, scale: 1 },
  heat: { mode: 2, channel: 0, scale: 1 },
  debugMask: { mode: 3, channel: 0, scale: 1 },
  waterMask: { mode: 7, channel: 0, scale: 1 },
  velocity: { mode: 5, channel: 0, scale: 20 },
};
const CHANNEL_INDEX: Record<string, number> = { r: 0, g: 1, b: 2, a: 3 };

/**
 * Replace the picture with one of the shared products, or with a pass's own working texture, for
 * inspection: `__debug.fxView('normalsHalf')`, `fxView('depth')`, `fxView('scene')`. Never on in
 * play; only the console override turns it on.
 */
export class DebugViewPass extends ShaderFxPass {
  readonly id: FxPassId = 'debugView';
  /** A product id, 'depth', 'scene', or '<pass>.<texture>'. */
  show: string | null = null;
  /** A pass's own texture, looked up once a frame by the runner. */
  external: FxDebugTexture | null = null;
  private readonly one: FxProductId[] = ['linearDepthHalf'];

  constructor() {
    super(DEBUG_VIEW);
  }

  enabled(_ctx: FxFrameContext): boolean {
    return this.show !== null;
  }

  reason(_ctx: FxFrameContext): string | null {
    return this.show === null ? 'nothing asked for' : null;
  }

  needs(ctx: FxFrameContext): readonly FxProductId[] {
    const show = this.show;
    if (show && show in ctx.products) {
      this.one[0] = show as FxProductId;
      return this.one;
    }
    return NO_PRODUCTS;
  }

  prepare(ctx: FxFrameContext): void {
    const u = this.material.uniforms;
    (u.uNearFar.value as THREE.Vector2).set(ctx.near, ctx.far);
    u.tScene.value = ctx.sceneColor;
    const show = this.show;
    if (show === 'scene') {
      u.uMode.value = 0;
      u.tShown.value = ctx.sceneColor;
      return;
    }
    if (show === 'depth') {
      u.uMode.value = 6;
      u.tShown.value = ctx.depth;
      return;
    }
    if (show && show in ctx.products) {
      const look = PRODUCT_VIEW[show as FxProductId];
      u.uMode.value = look.mode;
      u.uChannel.value = look.channel;
      u.uScale.value = look.scale;
      u.tShown.value = ctx.products[show as FxProductId];
      return;
    }
    const ext = this.external;
    if (!ext || !ext.texture) {
      // Nothing to show under that name: the raw picture, so the view never goes blank.
      u.uMode.value = 0;
      u.tShown.value = ctx.sceneColor;
      return;
    }
    u.uMode.value = ext.channels === 'rgb' ? 2 : 3;
    u.uChannel.value = CHANNEL_INDEX[ext.channels] ?? 0;
    u.uScale.value = ext.scale ?? 1;
    u.tShown.value = ext.texture;
  }
}
