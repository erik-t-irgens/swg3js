// Volumetric clouds: a raymarch through a slab of sky, lit by the sun the world is already using.
//
// **It is the clouds and not the atmosphere.** The demo this came from welds two things together: a
// cloud march, which is what is here, and Hillaire's atmosphere, which is not. That atmosphere is
// Earth's air -- Rayleigh coefficients for our nitrogen, a Mie scale height of 1.2 km, ozone at
// 25 km, a ground radius of 6360 km -- and bolting it on would overrule the client's own per-planet,
// per-area, per-hour gradient sky and make every world look like a summer afternoon in Sweden. So
// the march takes its sun, its ambient and its haze from `SkyLighting`, which is what the rest of
// the scene is lit by, and that is also why Mustafar's red needs no table: its own sky ramp is
// already red and the cloud simply takes it.
//
// Four things here are load-bearing and would each be easy to get wrong.
//
// **The coverage cut is calibrated, not assumed.** Coverage is a share of sky, and it becomes a
// threshold on the billow channel -- which does not fill nought to one. Measured over the real
// volume it lies between 0.576 and 0.898, so cutting at `1 - coverage` is a cliff that gives a third
// covered eighty-eight per cent of the sky. The ends come from the noise pack; see `billowCut`.
//
// **It marches at half resolution and comes back through a depth-aware upsample.** A plain bilinear
// upsample haloes every ridge and hull edge, because a half texel that saw sky is blended into a
// full pixel that saw rock. `fxHalfTaps` weights the four taps by how close their own depth is, and
// it already keeps the half-texel rule: half texel t is full pixel 2t + 1.
//
// **The march is stopped by the scene depth.** Clouds are sky, so anything solid ends the ray; the
// slab is intersected first so a ray that never reaches the deck costs nothing at all.
//
// **It writes no depth and asks for no light.** Nothing else in the chain has to know it ran: the
// god rays still count a cloud pixel as sky (they threshold on depth, and this writes none), water
// reflections never saw the dome and still do not, and the light count never changes, so no material
// anywhere recompiles when it is switched on.

import * as THREE from 'three';
import type { FxFrameContext } from './context';
import type { FxProductId, FxSettings } from '../fxRegistry.ts';
import { createFxQuad, FX_CAMERA, type FxDebugTexture, type FxPass, type FxWarmItem } from './pass';
import { FX_FULLSCREEN_VERTEX, FX_HASH, FX_LINEARIZE, FX_PHASE_HG, FX_SLAB, FX_VIEW_POS } from './glsl';
import { CLOUD_MARCH, cutForCover, type CoverPoint } from './cloudMath.ts';

// The numbers and the density rule live in `cloudMath.ts`, which the converter and the node tests
// read too: the shader below is generated from them, and the test checks its text against them.
export { CLOUD_MARCH } from './cloudMath.ts';

/**
 * The march's program, built from the tune.
 *
 * Most of these are compile-time constants rather than uniforms on purpose: they are in the inner
 * loop, several of them twice over, and a shader that reads thirty uniforms per step to draw the
 * same picture is paying for a knob nobody moves in play. The price is that `__debug.clouds` rebuilds
 * the program when one of them is moved, which is one compile on a console line and no cost at all
 * to a frame nobody is tuning. The numbers that *are* uniforms (the slab, the step counts, the
 * look and the drift) are the ones the world moves every frame.
 */
function cloudFragment(): string {
  return /* glsl */ `
precision highp float;
precision highp sampler3D;
varying vec2 vUv;
uniform sampler2D uDepth;
uniform sampler3D uBase;
uniform sampler3D uDetail;
uniform vec2 uTanHalfFov;
uniform float uFar;
uniform mat3 uViewToWorld;
uniform vec3 uCamera;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogDensity;
/** x coverage cut on the billow, y brightness, z decks. */
uniform vec3 uLook;
/** Where the volume is sampled from, in metres per second of world x and z. */
uniform vec2 uDrift;
uniform float uTime;
uniform vec2 uSlab;
uniform float uSteps;
uniform float uLightSteps;
uniform float uJitter;

${FX_LINEARIZE}
${FX_VIEW_POS}
${FX_SLAB}
${FX_PHASE_HG}
${FX_HASH}

const float BASE_SCALE = ${CLOUD_MARCH.baseScale.toFixed(1)};
const float DETAIL_SCALE = ${CLOUD_MARCH.detailScale.toFixed(1)};
const float DETAIL_BITE = ${CLOUD_MARCH.detailBite.toFixed(3)};
const float ERODE_BITE = ${CLOUD_MARCH.erodeBite.toFixed(3)};
const float DENSITY = ${CLOUD_MARCH.density.toFixed(4)};
const float LIGHT_DENSITY = ${CLOUD_MARCH.lightDensity.toFixed(3)};
const float POWDER = ${CLOUD_MARCH.powder.toFixed(3)};
const float G_FWD = ${CLOUD_MARCH.gForward.toFixed(3)};
const float G_BACK = ${CLOUD_MARCH.gBackward.toFixed(3)};
const float G_MIX = ${CLOUD_MARCH.gMix.toFixed(3)};
const float AMB_TOP = ${CLOUD_MARCH.ambientTop.toFixed(3)};
const float AMB_BOT = ${CLOUD_MARCH.ambientBottom.toFixed(3)};
const float FEATHER = ${CLOUD_MARCH.feather.toFixed(3)};

/** Where in the deck a height is, 0 at its floor and 1 at its ceiling. */
float heightFrac(float y) { return clamp((y - uSlab.x) / max(1.0, uSlab.y - uSlab.x), 0.0, 1.0); }

/**
 * The deck's own profile. A cloud is not a brick: it is narrow at the bottom where it is forming,
 * widest through the middle, and frayed at the top. Two decks get a second, thinner sheet above.
 */
float profile(float h, float decks) {
  float low = smoothstep(0.0, FEATHER, h) * smoothstep(1.0, 1.0 - FEATHER * 1.6, h);
  if (decks < 1.5) return low;
  float split = smoothstep(0.52, 0.62, h);
  return mix(low, low * 0.75 + smoothstep(0.6, 0.72, h) * smoothstep(1.0, 0.86, h) * 0.6, split);
}

/** How much cloud is at a point: the shape, cut to the coverage, then eaten by the detail. */
float densityAt(vec3 p, float h, float cheap) {
  vec3 drift = vec3(uDrift.x * uTime, 0.0, uDrift.y * uTime);
  vec4 base = texture(uBase, (p + drift) / BASE_SCALE);
  // The billow, cut where the world's own coverage says. The cut is calibrated against the volume.
  float shape = (base.r - uLook.x) / max(1e-3, 1.0 - uLook.x);
  if (shape <= 0.0) return 0.0;
  // The erosion channels take the edges off the shape before the profile does.
  float erode = base.g * 0.625 + base.b * 0.25 + base.a * 0.125;
  shape = clamp(shape - (1.0 - erode) * ERODE_BITE, 0.0, 1.0) * profile(h, uLook.z);
  if (shape <= 0.0 || cheap > 0.5) return shape;
  vec3 dp = (p + drift * 2.0) / DETAIL_SCALE;
  vec3 d = texture(uDetail, dp).rgb;
  float detail = d.r * 0.625 + d.g * 0.25 + d.b * 0.125;
  // Eaten harder at the top, where a cloud frays, than at the base where it is solid.
  return clamp(shape - (1.0 - detail) * DETAIL_BITE * mix(0.4, 1.0, h), 0.0, 1.0);
}

/** How much sun reaches a point: a few long steps toward it, and the powder that lights an edge. */
float sunlight(vec3 p, float stepLen) {
  float od = 0.0;
  float t = stepLen * 0.5;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uLightSteps) break;
    vec3 q = p + uSunDir * t;
    float h = heightFrac(q.y);
    od += densityAt(q, h, 1.0) * stepLen;
    t += stepLen * (1.0 + float(i) * 0.6);
  }
  return exp(-od * DENSITY * LIGHT_DENSITY);
}

void main() {
  vec3 viewDir = fxViewPos(vUv, 1.0, uTanHalfFov);
  vec3 dir = normalize(uViewToWorld * viewDir);
  // Anything solid ends the ray: a cloud is sky.
  //
  // **A pixel at the far plane is sky, not a surface nine kilometres off.** The half-resolution
  // depth writes the far plane wherever nothing was drawn, which over a planet is most of the
  // upper half of the screen, and read as a surface it stops every ray before it reaches the deck:
  // the deck hangs 1500 m up, so at ten degrees above the horizon it is already 8.6 km away and at
  // five degrees it is seventeen, both of them past a 9 km far plane. That is a sky with no cloud
  // in it anywhere except straight overhead, which is exactly what it looked like.
  float depth = texture(uDepth, vUv).r;
  float solid = (depth > 0.0 && depth < uFar * 0.999) ? depth : ${CLOUD_MARCH.reach.toFixed(1)};
  vec2 hit = fxSlab(uCamera, dir, vec3(-1e7, uSlab.x, -1e7), vec3(1e7, uSlab.y, 1e7));
  float near = max(hit.x, 0.0);
  float far = min(min(hit.y, solid), ${CLOUD_MARCH.reach.toFixed(1)});
  if (far <= near) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  float span = far - near;
  float stepLen = span / uSteps;
  // A per-pixel offset, so the steps of neighbouring pixels do not line up into rings.
  float t = near + stepLen * fxHash(vUv * 1024.0 + uJitter);
  float cosT = dot(dir, uSunDir);
  float phase = mix(fxPhaseHG(cosT, G_FWD), fxPhaseHG(cosT, G_BACK), G_MIX);

  vec3 scattered = vec3(0.0);
  float transmittance = 1.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps || transmittance < 0.01) break;
    vec3 p = uCamera + dir * t;
    float h = heightFrac(p.y);
    float d = densityAt(p, h, 0.0);
    if (d > 0.001) {
      float sigma = d * DENSITY;
      float sun = sunlight(p, stepLen * 2.0);
      // The powder term: a cloud lit from behind is bright at its edge and dark in its body, which
      // a plain exponential cannot say. Without it a cloud reads as a flat card.
      float powder = 1.0 - exp(-sigma * stepLen * 6.0);
      vec3 light = uSunColor * sun * phase * mix(1.0, powder, POWDER);
      light += uAmbient * mix(AMB_BOT, AMB_TOP, h);
      // The cloud's own darkness, straight off the world's art.
      light *= uLook.y;
      float step_ = 1.0 - exp(-sigma * stepLen);
      scattered += light * step_ * transmittance;
      transmittance *= 1.0 - step_;
    }
    t += stepLen;
  }
  // The same haze everything else recedes into, so a far deck sits in the world's own air.
  float haze = 1.0 - exp(-uFogDensity * uFogDensity * near * near);
  scattered = mix(scattered, uFogColor * (1.0 - transmittance), clamp(haze, 0.0, 1.0));
  gl_FragColor = vec4(scattered, transmittance);
}
`;
}

// The upsample that brings the march back to the screen.
//
// **It cannot use `fxHalfTaps`,** which the rest of the chain does, and that cost this pass a whole
// evening. That helper is written for a buffer at exactly half the screen -- its "half texel i sits
// at full pixel 2i + 1" is baked into its arithmetic -- and the march runs at whatever fraction the
// quality setting picks, a quarter, a half or the whole screen. At full resolution it therefore
// read the cloud buffer at half of each coordinate, which is the bottom-left quarter of the march
// stretched over the whole screen; that quarter is nearly all ground, where the march writes its
// "no cloud here" value of (0, 0, 0, 1), and a composite handed that returns the scene untouched.
// Not a wrong picture, not a shifted one: no picture at all, which is indistinguishable from the
// pass being switched off. So the taps are worked out from the cloud buffer's own size.
//
// And the two depths must be in the same units. `uDepthHalf` is metres along the view axis and
// `uDepthFull` is the raw depth buffer, which is neither metres nor linear, so comparing them
// directly made the weights nonsense -- harmless here, since they are normalised, but nonsense.
const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uClouds;
uniform sampler2D uDepthHalf;
uniform sampler2D uDepthFull;
uniform vec2 uNearFar;
uniform float uAmount;

${FX_LINEARIZE}

void main() {
  vec4 scene = texture(uScene, vUv);
  // The four cloud texels around this pixel, at whatever fraction of the screen the march ran at.
  vec2 cs = vec2(textureSize(uClouds, 0));
  vec2 f = vUv * cs - 0.5;
  ivec2 b = ivec2(floor(f));
  vec2 t = f - vec2(b);
  ivec2 hi = ivec2(cs) - 1;
  ivec2 t00 = clamp(b, ivec2(0), hi);
  ivec2 t10 = clamp(b + ivec2(1, 0), ivec2(0), hi);
  ivec2 t01 = clamp(b + ivec2(0, 1), ivec2(0), hi);
  ivec2 t11 = clamp(b + ivec2(1, 1), ivec2(0), hi);
  vec4 w = vec4((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y);
  // Weighted by how near each tap's own depth is to this pixel's, both in metres. Without it the
  // clouds halo every ridge, because a tap that saw sky is blended into a pixel that saw rock.
  float mine = fxViewZ(texture(uDepthFull, vUv).r, uNearFar.x, uNearFar.y);
  vec4 dz = vec4(
    texture(uDepthHalf, (vec2(t00) + 0.5) / cs).r,
    texture(uDepthHalf, (vec2(t10) + 0.5) / cs).r,
    texture(uDepthHalf, (vec2(t01) + 0.5) / cs).r,
    texture(uDepthHalf, (vec2(t11) + 0.5) / cs).r);
  vec4 ww = w / (abs(dz - vec4(mine)) * 0.05 + 1e-3);
  float sum = ww.x + ww.y + ww.z + ww.w;
  vec4 c = (texelFetch(uClouds, t00, 0) * ww.x + texelFetch(uClouds, t10, 0) * ww.y + texelFetch(uClouds, t01, 0) * ww.z + texelFetch(uClouds, t11, 0) * ww.w) / max(sum, 1e-5);
  float a = mix(1.0, c.a, uAmount);
  gl_FragColor = vec4(scene.rgb * a + c.rgb * uAmount, scene.a);
}
`;

/** One half-float, as `readRenderTargetPixels` hands them back from a HalfFloat target. */
function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** The march, and the upsample that brings it back. */
export class CloudsPass implements FxPass {
  readonly id = 'volumetricClouds' as const;
  readonly timerLabel = 'pass:volumetricClouds';
  private readonly marchMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly marchQuad: THREE.Mesh;
  private readonly compositeQuad: THREE.Mesh;
  /**
   * The march's own buffer. Made once and resized, never made again: the debug view holds the
   * texture it was given, and a target rebuilt on every quality change would hand it a dead one.
   */
  private readonly target: THREE.WebGLRenderTarget;
  private readonly debug: readonly FxDebugTexture[];
  private width = 1;
  private height = 1;
  private quality = 0.5;
  private amount = 1;
  private time = 0;
  private base: THREE.Data3DTexture | null = null;
  private detail: THREE.Data3DTexture | null = null;
  /** The cut-to-sky curve the converter measured off the very volume above, most cloud first. */
  private cover: readonly CoverPoint[] = [];
  /**
   * What the world is asking for this frame, written by the game and read here. `coverage`,
   * `brightness` and `decks` are the world's own art (`cloudLook`); `drift` is the weather's wind in
   * metres a second and `heading` the way it blows. There is no switch of its own here: the setting
   * is the runner's, and a coverage of 0 is how the world says it has no cloud to draw.
   */
  look = { coverage: 0, brightness: 1, decks: 1, drift: 0, heading: 0 };
  /**
   * For the console: what the last frame really did, and where the deck stood relative to the eye,
   * which is the one thing that cannot be read off the picture.
   */
  last = { drew: false, coverage: 0, cut: 0, steps: 0, size: [0, 0] as [number, number], deck: [0, 0] as [number, number], eye: 0, where: 'under' as 'under' | 'in' | 'over' };

  constructor() {
    this.marchMat = new THREE.ShaderMaterial({
      vertexShader: FX_FULLSCREEN_VERTEX,
      fragmentShader: cloudFragment(),
      depthTest: false,
      depthWrite: false,
      // Both of these write every pixel of their target outright, and the alpha they write is data
      // -- how much light came through the cloud, and then the scene's own alpha carried on -- not
      // a blend factor. Left at three's default the composite's alpha would be read as coverage and
      // the pass would write nothing at all wherever the scene's alpha was zero, which is the sky.
      blending: THREE.NoBlending,
      uniforms: {
        uDepth: { value: null },
        uBase: { value: null },
        uDetail: { value: null },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uFar: { value: 9000 },
        uViewToWorld: { value: new THREE.Matrix3() },
        uCamera: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uAmbient: { value: new THREE.Color(0.3, 0.35, 0.4) },
        uFogColor: { value: new THREE.Color(0.6, 0.7, 0.8) },
        uFogDensity: { value: 0 },
        uLook: { value: new THREE.Vector3(0.9, 1, 1) },
        uDrift: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uSlab: { value: new THREE.Vector2(CLOUD_MARCH.bottom, CLOUD_MARCH.top) },
        uSteps: { value: CLOUD_MARCH.steps },
        uLightSteps: { value: CLOUD_MARCH.lightSteps },
        uJitter: { value: 0 },
      },
    });
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FX_FULLSCREEN_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      uniforms: {
        uScene: { value: null },
        uClouds: { value: null },
        uDepthHalf: { value: null },
        uDepthFull: { value: null },
        uNearFar: { value: new THREE.Vector2(0.05, 9000) },
        uAmount: { value: 1 },
      },
    });
    this.marchQuad = createFxQuad(this.marchMat);
    this.compositeQuad = createFxQuad(this.compositeMat);
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.target.texture.name = 'fx.volumetricClouds';
    // `march` is the light the ray gathered and `clear` is what it let through, white where the ray
    // found nothing at all. Between them they separate "the march drew nothing" from "the upsample
    // threw it away", which from the picture alone look exactly the same.
    this.debug = [
      { name: 'march', texture: this.target.texture, channels: 'rgb' },
      { name: 'clear', texture: this.target.texture, channels: 'a' },
    ];
  }

  debugTextures(): readonly FxDebugTexture[] {
    return this.debug;
  }

  /**
   * What the pass itself is holding, as against what the settings say.
   *
   * These are not the same thing and the difference has hidden two bugs already: `quality` and
   * `amount` are only ever written in `setSize`, so a setting changed without a resize behind it
   * leaves the pass running on the last values it was handed, and an `amount` of 0 makes the
   * composite a no-op by construction -- the scene multiplied by one and nothing added.
   */
  report(): { hasNoise: boolean; quality: number; amount: number; size: [number, number]; cover: number } {
    return { hasNoise: this.base !== null, quality: this.quality, amount: this.amount, size: [this.target.width, this.target.height], cover: this.cover.length };
  }

  /**
   * Read the march's own buffer back off the card and say what is in it: console only, and a GPU
   * sync, so never on a frame path.
   *
   * It answers the one question the picture cannot. The debug view forces the pass on, so seeing
   * cloud through `fxView` proves nothing about an ordinary frame; this reads the buffer as the
   * frame left it. `sky` is the share of the band that found cloud and `light` how bright it was,
   * so a buffer full of cloud with nothing on the screen puts the fault squarely in the composite,
   * and an empty buffer puts it in the march.
   */
  probe(renderer: THREE.WebGLRenderer): { sky: number; light: number; clear: number; samples: number } | null {
    const w = this.target.width;
    const h = this.target.height;
    if (w < 4 || h < 4) return null;
    // A band across the upper third, which is sky in any ordinary view.
    const bw = Math.min(64, w);
    const bh = Math.min(32, h);
    const x = Math.max(0, Math.floor((w - bw) / 2));
    const y = Math.max(0, Math.floor(h * 0.72));
    const buf = new Uint16Array(bw * bh * 4);
    try {
      renderer.readRenderTargetPixels(this.target, x, Math.min(y, h - bh), bw, bh, buf);
    } catch {
      return null;
    }
    let cloud = 0;
    let light = 0;
    let clear = 0;
    const n = bw * bh;
    for (let i = 0; i < n; i++) {
      const a = half(buf[i * 4 + 3]);
      clear += a;
      if (a < 0.98) cloud++;
      light += (half(buf[i * 4]) + half(buf[i * 4 + 1]) + half(buf[i * 4 + 2])) / 3;
    }
    return { sky: Number((cloud / n).toFixed(3)), light: Number((light / n).toFixed(4)), clear: Number((clear / n).toFixed(3)), samples: n };
  }

  /**
   * The noise volumes and their calibration, handed over once they have been fetched. Until then the
   * pass answers false to `enabled` and costs nothing: a march with no shape to march through would
   * draw a grey sky.
   */
  setNoise(base: THREE.Data3DTexture, detail: THREE.Data3DTexture, cover: readonly CoverPoint[]): void {
    this.base = base;
    this.detail = detail;
    this.cover = cover;
    this.marchMat.uniforms.uBase.value = base;
    this.marchMat.uniforms.uDetail.value = detail;
  }

  get hasNoise(): boolean {
    return this.base !== null;
  }

  /**
   * Build the march's program again from `CLOUD_MARCH`, after the console has moved one of the
   * numbers that is baked into it. One compile, on the next frame that draws.
   */
  retune(): void {
    this.marchMat.fragmentShader = cloudFragment();
    this.marchMat.needsUpdate = true;
  }

  /**
   * What `enabled` asks, without needing a frame: the game reads it to know whether to take the flat
   * sheets down, which it must decide before the scene is drawn and so before there is a context.
   */
  wouldDraw(space: boolean, inside: boolean): boolean {
    // No volume, nothing to march. In space there is no sky to put cloud in, and indoors the march
    // would be stopped by the ceiling on every pixel, which is fill spent to draw nothing.
    //
    // The strength belongs here too, rather than only in the shader, where at 0 the composite is
    // `scene * 1 + 0` -- an exact copy of its input. A pass that draws a copy of what it was given
    // costs six milliseconds to change nothing, reports that it drew, and cannot be told apart from
    // being switched off, which is precisely the state nobody can diagnose. R11: a pass with
    // nothing to do says so and costs nothing. It is in this test and not only in `enabled` so that
    // the flat sheets stay up: a sky with the march switched off and the sheets taken down for it
    // would be a sky with no cloud of any kind.
    return this.base !== null && this.amount > 0 && this.look.coverage > 0 && !space && !inside;
  }

  enabled(ctx: FxFrameContext): boolean {
    // The setting itself is the runner's: the registry ties this pass to `volumetricClouds`.
    return this.wouldDraw(ctx.space, ctx.inside);
  }

  reason(ctx: FxFrameContext): string | null {
    if (!this.base) return 'the noise volumes have not been converted (npm run swg -- clouds assets-private)';
    if (this.amount <= 0) return 'cloud strength is 0';
    if (ctx.space) return 'in space there is no sky to put cloud in';
    if (ctx.inside) return 'the camera is inside a building';
    if (this.look.coverage <= 0) return "this world's own sky has no cloud at this weather";
    return null;
  }

  needs(): readonly FxProductId[] {
    return ['linearDepthHalf'];
  }

  prepare(): void {}

  setSize(width: number, height: number, settings: FxSettings): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.quality = Math.min(1, Math.max(0.25, (settings as { volumetricCloudQuality?: number }).volumetricCloudQuality ?? 0.5));
    this.amount = Math.min(1, Math.max(0, (settings as { volumetricCloudAmount?: number }).volumetricCloudAmount ?? 1));
    this.target.setSize(Math.max(1, Math.round(this.width * this.quality)), Math.max(1, Math.round(this.height * this.quality)));
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const g = ctx.renderer;
    const target = this.target;
    if (!this.base) return false;
    const cam = ctx.camera;
    const u = this.marchMat.uniforms;
    const tan = Math.tan(((cam.fov * Math.PI) / 180) / 2);
    (u.uTanHalfFov.value as THREE.Vector2).set(tan * cam.aspect, tan);
    // What the depth product writes where nothing was drawn, which the march must read as sky.
    u.uFar.value = ctx.far;
    (u.uViewToWorld.value as THREE.Matrix3).setFromMatrix4(cam.matrixWorld);
    (u.uCamera.value as THREE.Vector3).copy(cam.position);
    // The sun the rest of the scene is lit by, which is where every world's own colour comes from.
    const sun = ctx.sun;
    if (sun) {
      (u.uSunDir.value as THREE.Vector3).copy(sun.dir).normalize();
      (u.uSunColor.value as THREE.Color).copy(sun.color).multiplyScalar(Math.max(0, sun.intensity));
    }
    const lighting = ctx.lighting;
    if (lighting) (u.uAmbient.value as THREE.Color).copy(lighting.ambient);
    // The same haze the rest of the scene recedes into, so a far deck sits in the world's own air.
    (u.uFogColor.value as THREE.Color).copy(ctx.fogColor);
    u.uFogDensity.value = ctx.fogDensity;
    // The deck hangs in the world at the sheets' own altitudes and does not follow the eye: a deck
    // that follows is one no ship can ever climb into. See `CLOUD_MARCH.bottom`.
    (u.uSlab.value as THREE.Vector2).set(CLOUD_MARCH.bottom, CLOUD_MARCH.top);
    const cut = cutForCover(this.look.coverage, this.cover);
    (u.uLook.value as THREE.Vector3).set(cut, this.look.brightness, this.look.decks);
    // The volume is sampled at `p + drift`, so a feature moves the other way: the sign here is what
    // makes the cloud blow *toward* the wind's heading, the way the rain leans and the dust does
    // (heading 0 is +Z turning toward +X, which is `driftScroll`'s own convention).
    (u.uDrift.value as THREE.Vector2).set(-Math.sin(this.look.heading) * this.look.drift, -Math.cos(this.look.heading) * this.look.drift);
    this.time += ctx.dt;
    u.uTime.value = this.time;
    u.uDepth.value = ctx.products.linearDepthHalf ?? null;
    u.uSteps.value = Math.round(CLOUD_MARCH.steps * (0.5 + this.quality));
    u.uLightSteps.value = CLOUD_MARCH.lightSteps;
    u.uJitter.value = (this.time * 37.1) % 1000;

    g.setRenderTarget(target);
    g.render(this.marchQuad, FX_CAMERA);

    const c = this.compositeMat.uniforms;
    c.uScene.value = input.texture;
    c.uClouds.value = target.texture;
    c.uDepthHalf.value = ctx.products.linearDepthHalf ?? null;
    c.uDepthFull.value = ctx.depth;
    (c.uNearFar.value as THREE.Vector2).set(cam.near, cam.far);
    c.uAmount.value = this.amount;
    g.setRenderTarget(output);
    g.render(this.compositeQuad, FX_CAMERA);
    const eye = cam.position.y;
    this.last = {
      drew: true,
      coverage: this.look.coverage,
      cut: Number(cut.toFixed(3)),
      steps: u.uSteps.value as number,
      size: [target.width, target.height],
      deck: [CLOUD_MARCH.bottom, CLOUD_MARCH.top],
      eye: Math.round(eye),
      where: eye < CLOUD_MARCH.bottom ? 'under' : eye > CLOUD_MARCH.top ? 'over' : 'in',
    };
    return true;
  }

  materials(): FxWarmItem[] {
    return [
      { material: this.marchMat, object: this.marchQuad, where: 'target' },
      { material: this.compositeMat, object: this.compositeQuad, where: 'both' },
    ];
  }

  dispose(): void {
    this.target.dispose();
    this.marchMat.dispose();
    this.compositeMat.dispose();
  }
}

