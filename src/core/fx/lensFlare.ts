// Sun glare and lens flare. The sources are what the sky draws (its glowing suns; in space, its
// brightest star sprites), handed in through the frame context one fixed slot per body. Three draws:
//
//   1. Occlusion, into a 2x1 target of its own: 24 taps of the scene's depth over each sun's disc,
//      open where the depth lies at or beyond the distance the sky draws that body at, times the
//      cloud sheets' own alpha along the sun's line, smoothed against last frame's value.
//   2. The elements, instanced quads at half size (a core glare, a veil, a starburst, a streak and
//      seven ghosts per source), each faded in its vertex shader by the visibility just drawn, so
//      nothing is ever read back to the CPU.
//   3. The composite: the elements added onto the picture under a knee and a ceiling in exposed
//      luminance, so the flare never lifts a pixel into white or widens what is already white.
//
// Every number the shaders share with the CPU lives in flareMath.ts and is checked by a node test.
import * as THREE from 'three';
import type { FxFrameContext } from './context';
import type { FxDebugTexture, FxPass, FxWarmItem } from './pass';
import { FX_CAMERA, FX_TRIANGLE, NO_PRODUCTS } from './pass';
import { FX_FULLSCREEN_VERTEX, FX_HASH } from './glsl';
import type { FxProductId } from '../fxRegistry.ts';
import {
  FLARE_ELEMENTS,
  FLARE_LOOK_DEFAULTS,
  MAX_CLOUD_LAYERS,
  MAX_FLARE_SOURCES,
  MAX_TAP_RADIUS_SHARE,
  SKY_SHARE,
  SPIKE_PHASES,
  cloudLod,
  discPixels,
  elevationFade,
  overcastFade,
  smoothingRate,
  type FlareLook,
} from './flareMath';

/** A glowing body in the sky the lens flare follows, as the sky placed it this frame. */
export interface FxSkyLight {
  /** World direction towards the body (unit). */
  readonly dir: THREE.Vector3;
  /** Linear tint, brightest channel at most 1. */
  readonly color: THREE.Color;
  /** 0..1: how much the sky shows it (its sprite's opacity), before occlusion. 0 = not drawn this frame. */
  alpha: number;
  /** Angular radius of the visible disc, radians: the occlusion taps and the core glare. */
  discRadius: number;
  /** Angular radius of the sky's own glow sprite, radians: the veil and starburst scale from it. */
  glowRadius: number;
  /** 0..1, brightest first: the main sun 1. */
  weight: number;
  /** A space star (its sprite has its own spikes: no starburst, half streak). */
  star: boolean;
  /** Metres from the camera at which the sky draws the body: depth nearer than this (less a 2% margin) covers it. Infinity: behind everything drawn (the procedural dome). */
  skyDistance: number;
}

/** One cloud sheet as the sky drew it this frame. */
export interface FxCloudLayer {
  texture: THREE.Texture | null;
  /** Metres above sea level. */
  altitude: number;
  /** Metres per texture repeat. */
  repeat: number;
  readonly scroll: THREE.Vector2;
  /** 0..1; a hidden or empty sheet is not listed at all. */
  opacity: number;
  /** Horizontal distance (m) where the sheet starts and ends fading out (the material's uFade). */
  readonly fade: THREE.Vector2;
  /** Texels across one repeat (the texture's width), for the mip level. */
  texels: number;
}

/** n fresh records: dir (0,1,0), white, alpha 0, radii 0, weight 0, star false, skyDistance Infinity. */
export function createSkyLights(n: number): FxSkyLight[] {
  const out: FxSkyLight[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ dir: new THREE.Vector3(0, 1, 0), color: new THREE.Color(1, 1, 1), alpha: 0, discRadius: 0, glowRadius: 0, weight: 0, star: false, skyDistance: Infinity });
  }
  return out;
}

/** n fresh records: texture null, zeros, fade (0, 1), texels 1. */
export function createCloudLayers(n: number): FxCloudLayer[] {
  const out: FxCloudLayer[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ texture: null, altitude: 0, repeat: 1, scroll: new THREE.Vector2(), opacity: 0, fade: new THREE.Vector2(0, 1), texels: 1 });
  }
  return out;
}

/**
 * The five frame fields the flare reads. `FxFrameInput` and `FxFrameContext` carry them (the game
 * fills them in drawFrame); the pass reads them through this shape so that a context without them
 * leaves the flare off and says why, rather than reading undefined as a number.
 */
export interface FlareFrameFields {
  /** Kept array of MAX_FLARE_SOURCES records, refilled in drawFrame; entry i is flare slot i. */
  skyLights: readonly FxSkyLight[];
  /** Slots this sky has (0, 1 or 2); a slot not drawn this frame has alpha 0. */
  skyLightCount: number;
  /** Kept array of MAX_CLOUD_LAYERS records. */
  clouds: readonly FxCloudLayer[];
  /** Sheets listed this frame (0..4). */
  cloudCount: number;
  /** The camera is under a water surface: nothing beyond the water is seen as sky. */
  cameraUnderwater: boolean;
}
/** The context as the flare reads it: the Pick stops compiling if the context loses one of the five fields. */
type FlareContext = FxFrameContext & Pick<FxFrameContext, keyof FlareFrameFields>;

/** The live look every LensFlarePass reads; __debug.flareTune changes it. Survives the Effects switch; a reload restores the defaults. Not saved. */
export const flareLook: FlareLook = { ...FLARE_LOOK_DEFAULTS };

/**
 * Merge a patch into `flareLook` (or put the defaults back with 'reset'); returns a copy of the look.
 * Unknown keys, wrong types and numbers that are not finite are ignored. Needs no pass, so the look
 * can be tuned with the effects off and is there when they come back on.
 */
export function tuneFlareLook(patch?: Partial<FlareLook> | 'reset'): FlareLook {
  if (patch === 'reset') Object.assign(flareLook, FLARE_LOOK_DEFAULTS);
  else if (patch && typeof patch === 'object') {
    for (const key of Object.keys(patch) as (keyof FlareLook)[]) {
      if (!(key in FLARE_LOOK_DEFAULTS)) continue;
      const value = patch[key];
      if (typeof value !== typeof FLARE_LOOK_DEFAULTS[key]) continue;
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      (flareLook as unknown as Record<string, number | boolean>)[key] = value as number | boolean;
    }
  }
  return { ...flareLook };
}

/** One source as projected this frame (slot i follows ctx.skyLights[i]). */
interface FlareSlot {
  on: boolean;
  /** Screen uv. */
  uvX: number;
  uvY: number;
  /** From the centre, screen heights (x scaled by the aspect). */
  x: number;
  y: number;
  /** strength x alpha x weight x overcast x horizon. */
  intensity: number;
  /** Occlusion tap radius, pixels. */
  tapPx: number;
  /** Radii in screen heights. */
  discH: number;
  glowH: number;
  /** min(skyDistance, far) x SKY_SHARE, metres. */
  skyDepth: number;
  /** 1, or secondaryGhosts when an earlier slot is on. */
  ghostGain: number;
  star: boolean;
  /** Mip level per cloud layer. */
  readonly cloudLod: THREE.Vector4;
  readonly tint: THREE.Color;
  readonly dir: THREE.Vector3;
}

export interface FlareProbe {
  source: number;
  at: [number, number];
  size: number;
  exposure: number;
  ceiling: number;
  /** Pixels with exposed luminance over 1.0 (white on screen), before and after the flare: must be equal. */
  overWhiteBefore: number;
  overWhiteAfter: number;
  /** Pixels with exposed luminance over ceiling + 0.001, before and after: must be equal. */
  overCeilingBefore: number;
  overCeilingAfter: number;
  maxBefore: number;
  maxAfter: number;
  maxAdded: number;
}

const CLIP = new THREE.Vector4();
const VIEW_DIR = new THREE.Vector3();
const SAVED = new THREE.Color();
const ZERO2 = new THREE.Vector2();
const FADE_NONE = new THREE.Vector2(0, 1);
const CLOUD_SAMPLERS = ['tCloud0', 'tCloud1', 'tCloud2', 'tCloud3'] as const;
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;
const RAD = 180 / Math.PI;

/** A number as a GLSL float literal (an integer gets its ".0", or GLSL reads it as an int). */
function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}
// The shaders size their arrays and set the spike phases from flareMath.ts rather than repeating the
// numbers (flare.test.ts checks no literal is left). The occlusion's cloud code is written out for
// four sheets (four samplers, a vec4 of mip levels), which the test also pins MAX_CLOUD_LAYERS to.
const N_SRC = MAX_FLARE_SOURCES;
const N_CLOUD = MAX_CLOUD_LAYERS;

/** Stands in for a missing cloud layer; its opacity uniform is 0, so it is never read. Shared by every pass instance, never disposed. */
const EMPTY_CLOUD = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.name = 'fx.flare.noCloud';
  t.needsUpdate = true;
  return t;
})();

const FLARE_OCCLUSION = /* glsl */ `
  uniform highp sampler2D tDepth;
  uniform sampler2D tPrev;
  uniform sampler2D tCloud0;
  uniform sampler2D tCloud1;
  uniform sampler2D tCloud2;
  uniform sampler2D tCloud3;
  uniform vec2 uViewport;
  uniform vec2 uNearFar;
  uniform vec2 uTanHalfFov;
  uniform vec2 uRate;
  uniform vec4 uSource[${N_SRC}];
  uniform vec4 uSourceDir[${N_SRC}];
  uniform vec4 uCloudLod[${N_SRC}];
  uniform vec3 uCameraPos;
  uniform vec4 uCloud[${N_CLOUD}];
  uniform vec2 uCloudScroll[${N_CLOUD}];
  uniform vec2 uCloudFade[${N_CLOUD}];

  const int TAPS = 24;
  const float GOLDEN = 2.3999632;

  float cloudCover(sampler2D tex, vec4 layer, vec2 scroll, vec2 fade, float lod, vec3 dir) {
    if (layer.z <= 0.0 || dir.y <= 0.01) return 0.0;
    float t = (layer.x - uCameraPos.y) / dir.y;
    if (t <= 0.0) return 0.0;                                   // above the sheet: it cannot cover the sun
    vec2 xz = uCameraPos.xz + dir.xz * t;
    float dist = t * length(dir.xz);                            // horizontal distance, as the sheet fades by
    float f = 1.0 - smoothstep(fade.x, fade.y, dist);
    // The same mapping as the sheet's own shader, averaged over the disc's footprint by the mip level.
    return clamp(textureLod(tex, xz / layer.y + scroll, lod).a * layer.z * f, 0.0, 1.0);
  }

  void main() {
    int slot = int(gl_FragCoord.x);
    vec4 s = uSource[slot];
    float open = 0.0;
    float clouds = 1.0;
    if (s.w > 0.5) {
      vec2 centre = s.xy * uViewport;
      float skyDist = max(uSourceDir[slot].w, 1.0);
      float depthRange = uNearFar.y - uNearFar.x;
      for (int i = 0; i < TAPS; i++) {
        float fi = float(i);
        float r = sqrt((fi + 0.5) / float(TAPS)) * s.z;        // a Vogel disc over the visible disc
        float a = fi * GOLDEN;
        vec2 px = centre + vec2(cos(a), sin(a)) * r;
        if (px.x < 0.0 || px.y < 0.0 || px.x >= uViewport.x || px.y >= uViewport.y) continue;   // off screen: hidden
        vec2 ndc = (floor(px) + 0.5) / uViewport * 2.0 - 1.0;
        vec2 slope = ndc * uTanHalfFov;
        // The sky's distance along the view axis at this pixel, and 1 - depth there (flareMath skyDepthGap).
        float viewZ = skyDist * inversesqrt(1.0 + dot(slope, slope));
        float gap = uNearFar.x * (uNearFar.y - viewZ) / (viewZ * depthRange);
        float d = texelFetch(tDepth, ivec2(px), 0).r;
        open += step(1.0 - d, gap);                             // 1 when 1 - d <= gap: at or beyond the sky
      }
      open /= float(TAPS);
      vec3 dir = uSourceDir[slot].xyz;
      vec4 lod = uCloudLod[slot];
      clouds = (1.0 - cloudCover(tCloud0, uCloud[0], uCloudScroll[0], uCloudFade[0], lod.x, dir))
             * (1.0 - cloudCover(tCloud1, uCloud[1], uCloudScroll[1], uCloudFade[1], lod.y, dir))
             * (1.0 - cloudCover(tCloud2, uCloud[2], uCloudScroll[2], uCloudFade[2], lod.z, dir))
             * (1.0 - cloudCover(tCloud3, uCloud[3], uCloudScroll[3], uCloudFade[3], lod.w, dir));
    }
    float raw = open * clouds;
    float prev = texelFetch(tPrev, ivec2(slot, 0), 0).r;
    float k = raw > prev ? uRate.x : uRate.y;
    gl_FragColor = vec4(clamp(mix(prev, raw, k), 0.0, 1.0), open, clouds, 1.0);
  }
`;

const FLARE_ELEMENTS_VERT = /* glsl */ `
  attribute vec4 aShape;          // kind, t, size, amp
  attribute vec4 aTint;           // rgb, chroma
  attribute float aSlot;
  uniform sampler2D tVis;         // the 2x1 just drawn: r = smoothed visibility
  uniform vec4 uSource[${N_SRC}];        // x, y from the centre in screen heights (x scaled by the aspect); z intensity; w star
  uniform vec3 uSourceTint[${N_SRC}];
  uniform vec3 uSourceShape[${N_SRC}];   // disc radius, glow radius (screen heights), ghost gain
  uniform float uAspect;
  uniform vec4 uLook;             // core, veil, burst, streak gains
  uniform vec4 uLook2;            // ghosts gain, streak thickness, burst cap (screen heights), spare
  varying vec2 vLocal;
  varying vec3 vColor;
  varying float vKind;
  varying float vChroma;

  void main() {
    int slot = int(aSlot + 0.5);
    vec4 src = uSource[slot];
    vec3 shape = uSourceShape[slot];
    int kind = int(aShape.x + 0.5);
    float gain;
    if (kind == 0) gain = uLook.x;
    else if (kind == 1) gain = uLook.y;
    else if (kind == 2) gain = uLook.z * (1.0 - src.w);                  // no starburst on a space star
    else if (kind == 3) gain = uLook.w * (1.0 - 0.5 * src.w);
    else gain = uLook2.x * shape.z * smoothstep(0.03, 0.2, length(src.xy));   // ghosts collapse onto a centred sun: fade them there
    float vis = texelFetch(tVis, ivec2(slot, 0), 0).r;
    float intensity = src.z * vis * aShape.w * gain;
    if (!(intensity >= 1e-4)) {                                          // nothing to draw (or not a number): a quad outside the clip volume
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vLocal = vec2(0.0); vColor = vec3(0.0); vKind = 0.0; vChroma = 0.0;
      return;
    }
    vec2 halfSize;
    if (kind == 0) halfSize = vec2(aShape.z * shape.x);
    else if (kind == 1) halfSize = vec2(aShape.z * shape.y);
    else if (kind == 2) halfSize = vec2(min(aShape.z * shape.y, uLook2.z));   // capped: bounds the fill
    else if (kind == 3) halfSize = vec2(aShape.z, uLook2.y * 6.0);       // six thicknesses tall
    else halfSize = vec2(aShape.z);
    vec2 p = src.xy * aShape.y + position.xy * halfSize;                 // screen heights from the centre
    gl_Position = vec4(p.x / uAspect * 2.0, p.y * 2.0, 0.0, 1.0);
    vLocal = position.xy;
    vColor = aTint.rgb * uSourceTint[slot] * intensity;
    vKind = aShape.x;
    vChroma = aTint.w;
  }
`;

const FLARE_ELEMENTS_FRAG = /* glsl */ `
  varying vec2 vLocal;
  varying vec3 vColor;
  varying float vKind;
  varying float vChroma;
  ${FX_HASH}
  const float PI = 3.14159265;

  float hexagon(vec2 p) { p = abs(p); return max(p.x * 0.8660254 + p.y * 0.5, p.y); }
  vec3 edge3(vec3 x, float a, float b) { return vec3(1.0) - smoothstep(vec3(a), vec3(b), x); }   // 1 inside a, 0 past b

  void main() {
    int kind = int(vKind + 0.5);
    float r = length(vLocal);
    vec3 c;
    if (kind == 0) {                                  // core: a tight Gaussian inside the disc's surroundings
      c = vec3(exp(-r * r * 5.0) * (1.0 - smoothstep(0.8, 1.0, r)));
    } else if (kind == 1) {                           // veil: soft, inside the sky's own glow
      float f = max(1.0 - r, 0.0);
      c = vec3(f * f * f);
    } else if (kind == 2) {                           // starburst: six thin spikes of varied length, and six fainter between
      float a = dot(vLocal, vLocal) > 1e-12 ? atan(vLocal.y, vLocal.x) : 0.0;   // atan(0, 0) is undefined
      float p1 = 3.0 * a + ${glslFloat(SPIKE_PHASES[0])};
      float p2 = 3.0 * a + ${glslFloat(SPIKE_PHASES[1])};
      // One length per spike, from the spike's own index: constant across it, changing only where cos() is zero.
      float len1 = 0.6 + 0.4 * fxHash(vec2(mod(floor(p1 / PI + 0.5), 6.0), 7.0));
      float len2 = 0.6 + 0.4 * fxHash(vec2(mod(floor(p2 / PI + 0.5), 6.0), 13.0));
      float spikes = pow(abs(cos(p1)), 80.0) * exp(-r / len1 * 4.0) + 0.5 * pow(abs(cos(p2)), 160.0) * exp(-r / len2 * 4.0);
      c = vec3(spikes * (1.0 - smoothstep(0.9, 1.0, r)));
    } else if (kind == 3) {                           // streak: a thin horizontal line, long falloff
      float y = vLocal.y * 6.0;
      float along = max(1.0 - abs(vLocal.x), 0.0);
      c = vec3(exp(-y * y * 2.0) * along * along * along);
    } else {                                          // ghosts, with a chromatic edge
      vec3 rr = vec3(r * (1.0 - vChroma), r, r * (1.0 + vChroma));
      if (kind == 4) {
        c = edge3(rr, 0.75, 1.0);
      } else if (kind == 5) {
        float h = hexagon(vLocal);
        vec3 hh = vec3(h * (1.0 - vChroma), h, h * (1.0 + vChroma));
        c = edge3(hh, 0.85, 1.0) * 0.8 + edge3(hh, 0.0, 0.9) * 0.2;
      } else {
        c = vec3(1.0) - smoothstep(vec3(0.0), vec3(0.12), abs(rr - 0.85));
      }
    }
    gl_FragColor = vec4(c * vColor, 1.0);
  }
`;

const FLARE_COMPOSITE = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tFlare;
  uniform float uExposure;
  uniform vec2 uKnee;
  uniform float uDebugOnly;
  varying vec2 vUv;
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    vec3 f = max(texture2D(tFlare, vUv).rgb, vec3(0.0));
    float lf = dot(f, LUMA) * uExposure;
    // Nothing to add, or not a number (max() does not remove NaN; this comparison does): the picture as it is.
    if (!(lf >= 1e-5 && lf < 1e4)) { gl_FragColor = uDebugOnly > 0.5 ? vec4(0.0, 0.0, 0.0, 1.0) : c; return; }
    if (uDebugOnly > 0.5) { gl_FragColor = vec4(f, 1.0); return; }
    float l = dot(c.rgb, LUMA) * uExposure;
    float knee = 1.0 - smoothstep(uKnee.x, uKnee.y, l);         // less where the picture is already bright
    float add = min(lf * knee, max(uKnee.y - l, 0.0));          // never past the ceiling
    gl_FragColor = vec4(c.rgb + f * (add / lf), c.a);
  }
`;

function vec4s(n: number): THREE.Vector4[] {
  return Array.from({ length: n }, () => new THREE.Vector4());
}
function vec3s(n: number): THREE.Vector3[] {
  return Array.from({ length: n }, () => new THREE.Vector3());
}
function vec2s(n: number): THREE.Vector2[] {
  return Array.from({ length: n }, () => new THREE.Vector2());
}

function occlusionTarget(name: string): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(MAX_FLARE_SOURCES, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  t.texture.name = name;
  t.texture.generateMipmaps = false;
  return t;
}

/** The quad every element is drawn on, once per element per slot, with the element's own shape as instance data. */
function elementGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const n = MAX_FLARE_SOURCES * FLARE_ELEMENTS.length;
  const shape = new Float32Array(n * 4);
  const tint = new Float32Array(n * 4);
  const slot = new Float32Array(n);
  let k = 0;
  for (let s = 0; s < MAX_FLARE_SOURCES; s++) {
    for (const e of FLARE_ELEMENTS) {
      shape.set([e.kind, e.t, e.size, e.amp], k * 4);
      tint.set([e.tint[0], e.tint[1], e.tint[2], e.chroma], k * 4);
      slot[k] = s;
      k++;
    }
  }
  g.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
  g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 4));
  g.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 1));
  g.instanceCount = n;
  // The quads are placed in the vertex shader; a bound sphere that is never tested still has to exist.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export class LensFlarePass implements FxPass {
  readonly id = 'lensFlare' as const;
  readonly timerLabel = 'pass:lensFlare';
  /** The live look (the module's `flareLook`): every instance reads the same object. */
  readonly look: FlareLook = flareLook;
  /** Set by `__debug.flareProbe()`: the next drawn frame measures itself and clears it. */
  probeWanted = false;
  lastProbe: FlareProbe | { error: string } | null = null;

  private readonly slots: FlareSlot[] = [];
  private occRead: THREE.WebGLRenderTarget;
  private occWrite: THREE.WebGLRenderTarget;
  private readonly occMaterial: THREE.ShaderMaterial;
  private readonly occMesh: THREE.Mesh;
  private readonly flareTarget: THREE.WebGLRenderTarget;
  private readonly elementsMaterial: THREE.ShaderMaterial;
  private readonly elements: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly compositeMesh: THREE.Mesh;
  private readonly debugList: FxDebugTexture[];
  private projectedFrame = -1;
  private anyUp = false;
  private anyOn = false;
  private drawnFrame = -2;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    for (let i = 0; i < MAX_FLARE_SOURCES; i++) {
      this.slots.push({
        on: false, uvX: 0.5, uvY: 0.5, x: 0, y: 0, intensity: 0, tapPx: 1.5, discH: 0, glowH: 0, skyDepth: 1, ghostGain: 0, star: false,
        cloudLod: new THREE.Vector4(), tint: new THREE.Color(1, 1, 1), dir: new THREE.Vector3(0, 1, 0),
      });
    }

    // A new target's storage is zero-filled, so the first history reads 0.
    this.occRead = occlusionTarget('fx.flare.occA');
    this.occWrite = occlusionTarget('fx.flare.occB');
    renderer.initRenderTarget(this.occRead);
    renderer.initRenderTarget(this.occWrite);

    // Sized by registration (PostFX.registerPass calls setSize), allocated there too.
    this.flareTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0 });
    this.flareTarget.texture.name = 'fx.flare';
    this.flareTarget.texture.generateMipmaps = false;

    this.occMaterial = new THREE.ShaderMaterial({
      name: 'fx.flare.occlusion',
      uniforms: {
        tDepth: { value: null },
        tPrev: { value: null },
        tCloud0: { value: EMPTY_CLOUD },
        tCloud1: { value: EMPTY_CLOUD },
        tCloud2: { value: EMPTY_CLOUD },
        tCloud3: { value: EMPTY_CLOUD },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uNearFar: { value: new THREE.Vector2(0.05, 9000) },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uRate: { value: new THREE.Vector2(1, 1) },
        uSource: { value: vec4s(MAX_FLARE_SOURCES) },
        uSourceDir: { value: vec4s(MAX_FLARE_SOURCES) },
        uCloudLod: { value: vec4s(MAX_FLARE_SOURCES) },
        uCameraPos: { value: new THREE.Vector3() },
        uCloud: { value: vec4s(MAX_CLOUD_LAYERS) },
        uCloudScroll: { value: vec2s(MAX_CLOUD_LAYERS) },
        uCloudFade: { value: vec2s(MAX_CLOUD_LAYERS).map((v) => v.set(0, 1)) },
      },
      vertexShader: FX_FULLSCREEN_VERTEX,
      fragmentShader: FLARE_OCCLUSION,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.occMesh = new THREE.Mesh(FX_TRIANGLE, this.occMaterial);
    this.occMesh.frustumCulled = false;

    this.elementsMaterial = new THREE.ShaderMaterial({
      name: 'fx.flare.elements',
      uniforms: {
        tVis: { value: null },
        uSource: { value: vec4s(MAX_FLARE_SOURCES) },
        uSourceTint: { value: vec3s(MAX_FLARE_SOURCES) },
        uSourceShape: { value: vec3s(MAX_FLARE_SOURCES) },
        uAspect: { value: 1 },
        uLook: { value: new THREE.Vector4() },
        uLook2: { value: new THREE.Vector4() },
      },
      vertexShader: FLARE_ELEMENTS_VERT,
      fragmentShader: FLARE_ELEMENTS_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
    });
    this.elements = new THREE.Mesh(elementGeometry(), this.elementsMaterial);
    this.elements.frustumCulled = false;

    this.compositeMaterial = new THREE.ShaderMaterial({
      name: 'fx.flare.composite',
      uniforms: {
        tDiffuse: { value: null },
        tFlare: { value: null },
        uExposure: { value: 1 },
        uKnee: { value: new THREE.Vector2(FLARE_LOOK_DEFAULTS.kneeStart, FLARE_LOOK_DEFAULTS.ceiling) },
        uDebugOnly: { value: 0 },
      },
      vertexShader: FX_FULLSCREEN_VERTEX,
      fragmentShader: FLARE_COMPOSITE,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.compositeMesh = new THREE.Mesh(FX_TRIANGLE, this.compositeMaterial);
    this.compositeMesh.frustumCulled = false;

    this.debugList = [{ name: 'flare', texture: this.flareTarget.texture, channels: 'rgb' }];
  }

  enabled(ctx: FxFrameContext): boolean {
    if (ctx.settings.lensFlareStrength <= 0 || sourceCount(ctx) === 0) return false;
    this.project(ctx);
    return this.anyOn;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_PRODUCTS;
  }

  reason(ctx: FxFrameContext): string | null {
    const f = ctx as FlareContext;
    // The game's list always holds MAX_FLARE_SOURCES records; an empty or missing one was never handed over.
    if (!f.skyLights || f.skyLights.length === 0) return 'the frame context carries no sky light records: the game has not handed its list to the effects';
    if (ctx.settings.lensFlareStrength <= 0) return 'strength is 0';
    if (sourceCount(ctx) === 0) return 'this sky draws no glowing sun (Yavin 4, Dathomir, a zone with no star sprites)';
    this.projectForDebug(ctx);
    if (!this.anyUp) return 'no sun up (night, or its sprites hidden)';
    if (f.cameraUnderwater) return 'camera under water';
    if (!this.anyOn) return 'no sun on screen (behind you, below the horizon, or put out by overcast weather)';
    return null;
  }

  /**
   * For the console (reason, report), which runs between frames: PostFX.end has already moved
   * ctx.frame on while the inputs are still the last frame's, so a projection cached under that
   * number would be taken by the next real frame as its own. Project afresh and leave no cache.
   */
  private projectForDebug(ctx: FxFrameContext): void {
    this.projectedFrame = -1;
    this.project(ctx);
    this.projectedFrame = -1;
  }

  /** Where each source lands on the screen and how strong it is this frame; cached per frame, allocates nothing. */
  private project(ctx: FxFrameContext): void {
    if (this.projectedFrame === ctx.frame) return;
    this.projectedFrame = ctx.frame;
    this.anyOn = false;
    this.anyUp = false;
    const f = ctx as FlareContext;
    const count = sourceCount(ctx);
    const lights = f.skyLights;
    const look = this.look;
    const strength = ctx.settings.lensFlareStrength;
    // fx-weather 15.1: overcastFade(ctx.weather.overcast) once the weather is on the context.
    const weatherFade = overcastFade(0);
    const aspect = ctx.width / Math.max(1, ctx.height);
    const clouds = f.clouds;
    const cloudCount = clouds ? Math.min(f.cloudCount ?? 0, clouds.length, MAX_CLOUD_LAYERS) : 0;
    let seen = false;
    for (let i = 0; i < MAX_FLARE_SOURCES; i++) {
      const s = this.slots[i];
      s.on = false;
      s.intensity = 0;
      s.ghostGain = 0;
      if (i >= count || !lights) continue;
      const L = lights[i];
      if (!(L.alpha > 0.002)) continue;
      this.anyUp = true;
      if (f.cameraUnderwater) continue;
      // A direction (w = 0) through the view-projection: the vanishing point, whatever the camera's position.
      CLIP.set(L.dir.x, L.dir.y, L.dir.z, 0).applyMatrix4(ctx.viewProj);
      if (CLIP.w <= 1e-6) continue; // behind the camera
      const u = (CLIP.x / CLIP.w) * 0.5 + 0.5;
      const v = (CLIP.y / CLIP.w) * 0.5 + 0.5;
      const discPx = Math.max(1.5, discPixels(L.discRadius, ctx.tanHalfFov.y, ctx.height));
      const mu = discPx / Math.max(1, ctx.width);
      const mv = discPx / Math.max(1, ctx.height);
      if (u < -mu || u > 1 + mu || v < -mv || v > 1 + mv) continue; // the disc is wholly off screen
      const horizon = L.star ? 1 : elevationFade(L.dir.y);
      s.intensity = strength * L.alpha * L.weight * weatherFade * horizon;
      if (!(s.intensity >= 1e-3)) {
        s.intensity = 0;
        continue;
      }
      s.on = true;
      this.anyOn = true;
      s.ghostGain = seen ? look.secondaryGhosts : 1;
      seen = true;
      s.uvX = u;
      s.uvY = v;
      s.x = (u - 0.5) * aspect;
      s.y = v - 0.5;
      s.tapPx = Math.min(discPx, MAX_TAP_RADIUS_SHARE * ctx.height);
      s.discH = discPx / Math.max(1, ctx.height);
      s.glowH = discPixels(L.glowRadius, ctx.tanHalfFov.y, ctx.height) / Math.max(1, ctx.height);
      s.skyDepth = Math.max(1, Math.min(L.skyDistance, ctx.far) * SKY_SHARE);
      s.star = L.star;
      s.tint.copy(L.color);
      s.dir.copy(L.dir);
      for (let k = 0; k < MAX_CLOUD_LAYERS; k++) {
        const layer = k < cloudCount ? clouds![k] : null;
        s.cloudLod.setComponent(k, layer ? cloudLod(layer.altitude, ctx.cameraPos.y, L.dir.y, L.discRadius, layer.repeat, layer.texels) : 0);
      }
    }
  }

  prepare(ctx: FxFrameContext): void {
    this.project(ctx);
    const look = this.look;
    const f = ctx as FlareContext;
    // No history after a cut, or when the pass did not draw last frame (the sun came back on screen): snap to the new reading.
    const reset = ctx.cameraCut || this.drawnFrame !== ctx.frame - 1;
    const o = this.occMaterial.uniforms;
    o.tDepth.value = ctx.depth;
    o.tPrev.value = this.occRead.texture;
    (o.uViewport.value as THREE.Vector2).set(ctx.width, ctx.height);
    (o.uNearFar.value as THREE.Vector2).set(ctx.near, ctx.far);
    (o.uTanHalfFov.value as THREE.Vector2).copy(ctx.tanHalfFov);
    (o.uRate.value as THREE.Vector2).set(reset ? 1 : smoothingRate(ctx.dt, look.rise), reset ? 1 : smoothingRate(ctx.dt, look.fall));
    (o.uCameraPos.value as THREE.Vector3).copy(ctx.cameraPos);
    const src = o.uSource.value as THREE.Vector4[];
    const srcDir = o.uSourceDir.value as THREE.Vector4[];
    const lods = o.uCloudLod.value as THREE.Vector4[];
    for (let i = 0; i < MAX_FLARE_SOURCES; i++) {
      const s = this.slots[i];
      src[i].set(s.uvX, s.uvY, s.tapPx, s.on ? 1 : 0);
      srcDir[i].set(s.dir.x, s.dir.y, s.dir.z, s.skyDepth);
      lods[i].copy(s.cloudLod);
    }
    const clouds = f.clouds;
    const cloudCount = clouds ? Math.min(f.cloudCount ?? 0, clouds.length, MAX_CLOUD_LAYERS) : 0;
    const cl = o.uCloud.value as THREE.Vector4[];
    const scroll = o.uCloudScroll.value as THREE.Vector2[];
    const fade = o.uCloudFade.value as THREE.Vector2[];
    for (let k = 0; k < MAX_CLOUD_LAYERS; k++) {
      const layer = k < cloudCount ? clouds![k] : null;
      const tex = layer ? layer.texture : null;
      // Rebound every frame, so a sky unloaded under the pass never leaves a disposed texture bound.
      o[CLOUD_SAMPLERS[k]].value = tex ?? EMPTY_CLOUD;
      cl[k].set(layer ? layer.altitude : 0, Math.max(1, layer ? layer.repeat : 1), tex && layer ? layer.opacity : 0, 0);
      scroll[k].copy(layer ? layer.scroll : ZERO2);
      fade[k].copy(layer ? layer.fade : FADE_NONE);
    }

    const e = this.elementsMaterial.uniforms;
    e.uAspect.value = ctx.width / Math.max(1, ctx.height);
    (e.uLook.value as THREE.Vector4).set(look.core, look.veil, look.burst, look.streak);
    (e.uLook2.value as THREE.Vector4).set(look.ghosts, look.streakThickness, look.burstCap, 0);
    const es = e.uSource.value as THREE.Vector4[];
    const et = e.uSourceTint.value as THREE.Vector3[];
    const eh = e.uSourceShape.value as THREE.Vector3[];
    for (let i = 0; i < MAX_FLARE_SOURCES; i++) {
      const s = this.slots[i];
      es[i].set(s.x, s.y, s.on ? s.intensity : 0, s.star ? 1 : 0);
      et[i].set(s.tint.r, s.tint.g, s.tint.b);
      eh[i].set(s.discH, s.glowH, s.ghostGain);
    }

    const c = this.compositeMaterial.uniforms;
    c.uExposure.value = ctx.renderer.toneMappingExposure;
    (c.uKnee.value as THREE.Vector2).set(look.kneeStart, Math.max(look.kneeStart + 1e-3, look.ceiling));
    c.uDebugOnly.value = look.debugOnly ? 1 : 0;
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const r = ctx.renderer;
    // 1. How much of each sun shows, smoothed: reads the scene depth into a 2x1 colour target (R2).
    r.setRenderTarget(this.occWrite);
    r.render(this.occMesh, FX_CAMERA);
    const vis = this.occWrite.texture;
    // 2. The elements, at half size, faded by that visibility in their vertex shader.
    this.elementsMaterial.uniforms.tVis.value = vis;
    r.setRenderTarget(this.flareTarget);
    r.getClearColor(SAVED);
    const alpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setClearColor(SAVED, alpha);
    r.render(this.elements, FX_CAMERA);
    // 3. Onto the picture, under the knee and the ceiling.
    const c = this.compositeMaterial.uniforms;
    c.tDiffuse.value = input.texture;
    c.tFlare.value = this.flareTarget.texture;
    r.setRenderTarget(output);
    r.render(this.compositeMesh, FX_CAMERA);
    if (this.probeWanted && output) this.probe(ctx, input, output);
    const t = this.occRead;
    this.occRead = this.occWrite;
    this.occWrite = t;
    this.drawnFrame = ctx.frame;
    return true;
  }

  setSize(width: number, height: number): void {
    // Frees the old storage when the size changed, and allocates the new now rather than on the first sunrise.
    this.flareTarget.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
    this.renderer.initRenderTarget(this.flareTarget);
  }

  materials(): FxWarmItem[] {
    return [
      { material: this.occMaterial, where: 'target' },
      { material: this.elementsMaterial, object: this.elements, where: 'target' },
      { material: this.compositeMaterial, where: 'target' },
    ];
  }

  debugTextures(): readonly FxDebugTexture[] {
    return this.debugList;
  }

  /** Merge a patch into the live look (or put the defaults back with 'reset'); returns a copy of the look. */
  tune(patch?: Partial<FlareLook> | 'reset'): FlareLook {
    return tuneFlareLook(patch);
  }

  /** Debug: the 2x1 visibility read synchronously (a GPU sync; console only): per slot [smoothed, depth open, cloud transmittance]. */
  readVisibility(): number[][] {
    const buf = new Uint16Array(MAX_FLARE_SOURCES * 4);
    this.renderer.readRenderTargetPixels(this.occRead, 0, 0, MAX_FLARE_SOURCES, 1, buf);
    const out: number[][] = [];
    for (let i = 0; i < MAX_FLARE_SOURCES; i++) {
      out.push([0, 1, 2].map((c) => Number(THREE.DataUtils.fromHalfFloat(buf[i * 4 + c]).toFixed(3))));
    }
    return out;
  }

  /** Debug: this frame's slots, on or not, for __debug.flare. */
  report(ctx: FxFrameContext): object {
    const f = ctx as FlareContext;
    this.projectForDebug(ctx);
    const count = sourceCount(ctx);
    const sources: object[] = [];
    const n3 = (v: number) => Number(v.toFixed(3));
    const n2 = (v: number) => Number(v.toFixed(2));
    for (let i = 0; i < count; i++) {
      const L = f.skyLights![i];
      const s = this.slots[i];
      // The direction in the camera's frame: how far to turn right and up to face it, whatever steers the view.
      VIEW_DIR.copy(L.dir).transformDirection(ctx.view);
      const discPx = discPixels(L.discRadius, ctx.tanHalfFov.y, ctx.height);
      sources.push({
        slot: i,
        on: s.on,
        star: L.star,
        weight: n2(L.weight),
        alpha: n3(L.alpha),
        direction: L.dir.toArray().map(n3),
        uv: s.on ? [n3(s.uvX), n3(s.uvY)] : null,
        turn: { right: Number((Math.atan2(VIEW_DIR.x, -VIEW_DIR.z) * RAD).toFixed(1)), up: Number((Math.atan2(VIEW_DIR.y, Math.hypot(VIEW_DIR.x, VIEW_DIR.z)) * RAD).toFixed(1)) },
        tapPx: s.on ? n2(s.tapPx) : null,
        discPx: n2(discPx),
        glowPx: n2(discPixels(L.glowRadius, ctx.tanHalfFov.y, ctx.height)),
        skyDistance: Number.isFinite(L.skyDistance) ? L.skyDistance : 'beyond everything (the dome)',
        intensity: n3(s.intensity),
        ghostGain: n2(s.ghostGain),
        cloudLod: s.cloudLod.toArray().map(n2),
      });
    }
    const drew = this.drawnFrame === ctx.frame - 1;
    // reason() answers for the pass's own inputs; the toggle and a console override are the chain's, so name them here.
    const why = drew ? null : this.reason(ctx) ?? (ctx.settings.lensFlare ? 'forced off (__debug.postfx), or the chain did not reach it' : 'its setting is off');
    return {
      setting: ctx.settings.lensFlare,
      strength: ctx.settings.lensFlareStrength,
      drewLastFrame: drew,
      why,
      // fx-weather 15.1: the overcast factor from ctx.weather once it exists.
      overcast: overcastFade(0),
      exposure: ctx.renderer.toneMappingExposure,
      underwater: !!f.cameraUnderwater,
      clouds: f.clouds ? Math.min(f.cloudCount ?? 0, f.clouds.length) : 0,
      sources,
    };
  }

  dispose(): void {
    this.occMaterial.dispose();
    this.elementsMaterial.dispose();
    this.compositeMaterial.dispose();
    this.occRead.dispose();
    this.occWrite.dispose();
    this.flareTarget.dispose();
    // FX_TRIANGLE and EMPTY_CLOUD are shared and live for the app; only the element geometry is this pass's.
    this.elements.geometry.dispose();
  }

  /**
   * Debug only (allocates): the block of pixels round the first source on screen, read before and
   * after the composite, counted by exposed luminance. The counts over white and over the ceiling
   * must be equal before and after: the flare never pushes a pixel past either.
   */
  private probe(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget): void {
    this.probeWanted = false;
    let slot = -1;
    for (let i = 0; i < MAX_FLARE_SOURCES; i++) {
      if (this.slots[i].on) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      this.lastProbe = { error: 'no source on screen' };
      return;
    }
    const W = input.width;
    const H = input.height;
    const size = Math.min(129, W, H);
    const s = this.slots[slot];
    // Clamped inside the target: three reads nothing for a block that crosses an edge.
    const x = THREE.MathUtils.clamp(Math.round(s.uvX * W) - (size >> 1), 0, W - size);
    const y = THREE.MathUtils.clamp(Math.round(s.uvY * H) - (size >> 1), 0, H - size);
    const before = new Uint16Array(size * size * 4);
    const after = new Uint16Array(size * size * 4);
    this.renderer.readRenderTargetPixels(input, x, y, size, size, before);
    this.renderer.readRenderTargetPixels(output, x, y, size, size, after);
    const exposure = ctx.renderer.toneMappingExposure;
    const ceiling = Math.max(this.look.kneeStart + 1e-3, this.look.ceiling);
    const half = THREE.DataUtils.fromHalfFloat;
    const lum = (b: Uint16Array, i: number) => (LUMA_R * half(b[i]) + LUMA_G * half(b[i + 1]) + LUMA_B * half(b[i + 2])) * exposure;
    let overWhiteBefore = 0;
    let overWhiteAfter = 0;
    let overCeilingBefore = 0;
    let overCeilingAfter = 0;
    let maxBefore = 0;
    let maxAfter = 0;
    let maxAdded = 0;
    for (let i = 0; i < before.length; i += 4) {
      const lb = lum(before, i);
      const la = lum(after, i);
      if (lb > 1) overWhiteBefore++;
      if (la > 1) overWhiteAfter++;
      if (lb > ceiling + 1e-3) overCeilingBefore++;
      if (la > ceiling + 1e-3) overCeilingAfter++;
      if (lb > maxBefore) maxBefore = lb;
      if (la > maxAfter) maxAfter = la;
      if (la - lb > maxAdded) maxAdded = la - lb;
    }
    const n3 = (v: number) => Number(v.toFixed(3));
    this.lastProbe = {
      source: slot,
      at: [x + (size >> 1), y + (size >> 1)],
      size,
      exposure: n3(exposure),
      ceiling: n3(ceiling),
      overWhiteBefore,
      overWhiteAfter,
      overCeilingBefore,
      overCeilingAfter,
      maxBefore: n3(maxBefore),
      maxAfter: n3(maxAfter),
      maxAdded: n3(maxAdded),
    };
  }
}

/** How many of the context's flare slots are real this frame (0 while the context carries none). */
function sourceCount(ctx: FxFrameContext): number {
  const f = ctx as FlareContext;
  const lights = f.skyLights;
  if (!lights) return 0;
  return Math.max(0, Math.min(f.skyLightCount ?? 0, lights.length, MAX_FLARE_SOURCES));
}
