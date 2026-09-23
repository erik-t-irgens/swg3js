// The specks that drift past the eye under water: a fixed pool of points, built once with the
// chain, moved entirely in the vertex program, tiled in a cube that follows the camera so the cloud
// stays put in the water while you swim through it. They are what tells the eye it is moving when
// everything else down there is a flat wash of colour.
//
// There was no going under water in the game this is built from, so there is nothing to copy and
// nothing to be faithful to: every number in `UNDERWATER_SPECK_TUNE` is ours, invented, and live
// through `__debug.specks`.
//
// **Why they are a pass and not scene geometry**, which is what they were written as first. The
// look under water (`src/core/fx/underwater.ts`) multiplies every pixel by the transmittance of the
// water in front of it, taken from the scene's own depth. A speck writes no depth, so drawn with
// the scene its pixel carries the *background's* distance: a speck a metre from the eye, seen
// against a lake bed a hundred metres off, kept about one part in ninety of its blue and none at
// all of its red and green. They read in a confined pool and vanished in open water, which is the
// one place they exist for. So they are drawn after that grading instead, straight into the chain's
// own buffer, and carry their own attenuation -- `exp(-extinction x distance)` over their own short
// path, from the very numbers the look pass derives -- so a speck at the edge of the tile goes blue
// and dim while one at arm's length stays bright. Being a pass also means the settings reach them
// as typed fields of `FxSettings` rather than as strings that can quietly miss.
//
// **Where in the chain**: after the shutter (`motionBlur`) and before the bloom. Drawn before the
// lens, the aperture and the shutter would soften and smear each speck by the depth and the
// movement of whatever lies behind it -- and in open water, where the depth is the far plane, every
// speck would become a disc the moment the player aimed. The price is that a speck is never
// softened by the lens at all; giving it a depth of its own means an entry in the `dofGlow`
// product, which wants a mask material for a point cloud.
//
// **What it costs**: one draw call on the frames the camera is really under a surface, and nothing
// at all on every other frame -- `enabled` says no and the runner skips the pass entirely. Nothing
// is allocated in `prepare` or `render`, no light is added or taken away, and the one program is
// built by the chain's own warm-up behind the loading screen, out of `materials()`.
//
// **Two rules it keeps to draw where it does.** The chain's buffers carry no depth attachment, so
// sampling the scene's depth texture here is allowed (R2 in `postfx.ts`) and is what hides a speck
// behind a rock; and `render` writes the picture where it stands and answers false, so the runner
// does not swap buffers.
//
// Node runs this module as it stands (tools/swg/tests/underwaterSpecks.test.ts): every value import
// names its `.ts` file, nothing here is a TypeScript parameter property, and the empty `needs` array
// is written out rather than taken from `pass.ts`, whose `ShaderFxPass` declares one and would stop
// node's type stripping dead.
import * as THREE from 'three';
// The smallest a sprite may be drawn and the Gaussian it is drawn with are the room motes' lesson
// and live in one place: below about three and a half pixels a point sprite's brightness swings
// several fold as it crosses pixel boundaries, which reads as twinkling.
import { MOTE_KERNEL, MOTE_MIN_PX, mulberry32 } from './roomAirMath.ts';
import { FX_LINEARIZE } from '../core/fx/glsl.ts';
import {
  createUnderwaterLook,
  deriveUnderwater,
  lightOf,
  UNDERWATER_FALLBACK,
  UNDERWATER_TUNE,
  type UnderwaterLook,
  type Vec3,
} from '../core/fx/underwaterMath.ts';
import type { FxPass, FxWarmItem } from '../core/fx/pass.ts';
import type { FxFrameContext } from '../core/fx/context.ts';
import type { FxPassId, FxProductId, FxSettings } from '../core/fxRegistry.ts';

/** The most specks ever drawn (the amount knob well past 1). */
export const MAX_SPECKS = 2000;
/**
 * The widest a speck is drawn, pixels. Not a knob: it is a `#define`, so moving it would build a
 * second program. A speck nearer than `near` is faded out long before it could ask for more.
 */
export const SPECK_MAX_PX = 8;

/** This pass asks for no product; one kept array, so answering costs nothing. */
const NO_PRODUCTS: readonly FxProductId[] = [];

/**
 * Every number of ours, live through `__debug.specks`; none of it is saved and none of it comes
 * from the game's own files, because the game had no under water at all.
 */
export interface UnderwaterSpeckTuning {
  /** Specks drawn at amount 1. */
  count: number;
  /** Multiplies `count`; 0 draws none at all and costs no draw call. */
  amount: number;
  /** The cube they tile around the camera, metres across. */
  span: number;
  /** A speck's size, metres (each one takes 0.6 to 1.4 of it). */
  size: number;
  /** The spread of each speck's own steady drift, metres a second. */
  drift: number;
  /** How fast they all settle, metres a second downward. */
  sink: number;
  /** How far a speck circles about its drift, metres. */
  swirl: number;
  /** How fast it goes round, radians a second. */
  swirlRate: number;
  /** How bright a speck is against the murk, before its colour. */
  brightness: number;
  /** How much of the water body's own colour a speck takes, 0 white to 1 the body's. */
  tint: number;
  /** Brightness falls as exp(-cameraDepth / lightDepth): deep water is darker. Metres. */
  lightDepth: number;
  /** The share of their daylight brightness the specks keep at midnight, so a night dive is dark rather than black. */
  nightFloor: number;
  /** Specks nearer the eye than this fade out (to nothing at `near`, whole by `nearSpan` x near), metres. */
  near: number;
  /** A speck fades out over this many metres as it comes up to the ceiling. */
  surfaceFade: number;
  /** How long they take to come in after the camera goes under, seconds. Going up is instant. */
  fadeSeconds: number;
}

/**
 * The tuning, live: `__debug.specks({ count: 300 })` writes here and the pass reads it on the next
 * frame it draws. It is module-level rather than per-pass on purpose -- switching Effects builds a
 * second chain, and a tune the player had set would otherwise be thrown away with the old one.
 */
export const UNDERWATER_SPECK_TUNE: UnderwaterSpeckTuning = {
  count: 700,
  amount: 1,
  span: 7,
  size: 0.007,
  drift: 0.045,
  sink: 0.012,
  swirl: 0.05,
  swirlRate: 0.28,
  brightness: 0.55,
  tint: 0.6,
  lightDepth: 22,
  nightFloor: 0.12,
  near: 0.5,
  surfaceFade: 0.25,
  fadeSeconds: 0.8,
};

/**
 * The shapes the vertex program and the rules below share, written once. The shader's source is
 * built with these very numbers, so the two cannot carry different ones.
 */
export const SPECK_RULE = {
  /** A speck is nothing at `near` and whole by this many times it. */
  nearSpan: 2.4,
  /** The tile's own edge, as shares of the span: whole in to here ... */
  tileIn: 0.35,
  /** ... and nothing at all past here, which is what keeps the wrap from popping. */
  tileOut: 0.5,
  /** Under this alpha a speck is thrown off the screen instead of drawn. */
  cull: 0.003,
};

/**
 * The settings the specks read. They are the effects registry's own keys, so a rename there is a
 * compile error here rather than a switch that quietly stops working, and they are read off the
 * frame context as typed fields rather than by name out of a settings object.
 *
 * They are tied to the shimmer's strength because the owner asked for the shimmer and the specks
 * together, and the Graphics page's hint for that row says so in as many words.
 */
export type SpeckSettings = Pick<FxSettings, 'effects' | 'underwater' | 'underwaterShimmerStrength'>;

/** The three keys, so a node test can check each one is really a setting the game has. */
export const SPECK_SETTING_KEYS: readonly (keyof FxSettings)[] = ['effects', 'underwater', 'underwaterShimmerStrength'];

/**
 * Whether the specks are wanted at all. The one line that would make them stand alone: drop
 * `effects` (and `underwaterShimmerStrength`, for a switch entirely of their own) and they are on
 * for everyone -- but they would then need somewhere else to be drawn, since this whole pass exists
 * only while the chain does.
 */
export function wantSpecks(s: SpeckSettings): boolean {
  return s.effects && s.underwater && s.underwaterShimmerStrength > 0;
}

/** The console listing (debug only; allocates freely). */
export interface UnderwaterSpeckDescription {
  /** The settings say yes. */
  wanted: boolean;
  /** The camera was really below a water surface (the strict verdict, not the conservative one). */
  submerged: boolean;
  /** Specks drawn on the last frame the chain asked about; 0 on a frame it said no. */
  drawn: number;
  /** Why nothing is being drawn, as of the last frame the chain asked, or null when something is. */
  reason: string | null;
  /** The frame that answer was given on; -1 before the chain has ever asked. */
  asked: number;
  depth: number;
  /** The flat water surface over the camera, world y. */
  surfaceY: number;
  /** How far a crest can lift that surface here, metres. */
  reach: number;
  /** The highest a speck may be drawn, world y: the surface less that reach, so none is ever in the air. */
  ceiling: number;
  fade: number;
  color: string;
  /** Metres each channel of a speck's own light travels before it has lost 1 - 1/e of itself. */
  channelMetres: number[];
  seconds: number;
  /** The last frame the chain prepared this pass on; -1 before the first. */
  frame: number;
  tuning: UnderwaterSpeckTuning;
}

export type UnderwaterSpeckDebugOptions = Partial<UnderwaterSpeckTuning>;

// ---- The rules, written out so a plain node script checks the sums the shader does ----

/** How many specks are drawn: the count times the amount, never past the pool. */
export function speckDrawCount(count: number, amount: number): number {
  if (!(count > 0) || !(amount > 0)) return 0;
  return Math.round(Math.min(MAX_SPECKS, count * amount));
}

/**
 * The fade in and out. Going under it eases in over `seconds`; coming up it is gone on the very
 * frame the camera surfaces, because a speck hanging in the air reads as a bug at a glance.
 */
export function speckFade(current: number, under: boolean, dt: number, seconds: number): number {
  if (!under) return 0;
  if (!(seconds > 0)) return 1;
  return Math.min(1, current + Math.max(0, dt) / seconds);
}

/**
 * Where a speck's nearest copy is drawn: the pattern repeats every `span` metres, so the copy
 * within half a span of the camera on every axis is the one shown. The shader's `mod`.
 */
export function speckWrap(p: number, cam: number, span: number): number {
  const half = 0.5 * span;
  let r = (p - cam + half) % span;
  if (r < 0) r += span;
  return cam + r - half;
}

/** A speck fades out as it reaches the eye: nothing at `near`, whole by `nearSpan` x near. */
export function speckNearFade(dist: number, near: number): number {
  return smoothstep(near, near * SPECK_RULE.nearSpan, dist);
}

/** And is gone by the edge of the tile, so nothing pops in or out as the wrap moves it. */
export function speckTileFade(dist: number, span: number): number {
  return 1 - smoothstep(SPECK_RULE.tileIn * span, SPECK_RULE.tileOut * span, dist);
}

/**
 * And fades out over the last `fade` metres below the ceiling, so none is ever drawn in the air.
 * The ceiling is not the water surface: see `speckCeiling`.
 */
export function speckSurfaceFade(y: number, ceiling: number, fade: number): number {
  return 1 - smoothstep(ceiling - Math.max(1e-3, fade), ceiling, y);
}

/**
 * The whole alpha of one speck, exactly as the vertex program's `speckAlpha` works it out, and from
 * the same constants: off the lens, inside the tile, under the ceiling, times the cloud's own fade.
 */
export function speckAlpha(dist: number, y: number, span: number, near: number, ceiling: number, fade: number, cloud: number): number {
  return speckNearFade(dist, near) * speckTileFade(dist, span) * speckSurfaceFade(y, ceiling, fade) * cloud;
}

/**
 * The highest a speck may be drawn: the flat water surface, less how far a crest can lift it.
 *
 * The surface this side knows is the water table's own flat height; the sea that is drawn is that
 * height displaced by up to its swell (about 1.2 m for the near sea), and nothing on the CPU knows
 * where in that band the real surface stands over any one speck. Cutting at the flat height drew
 * specks in the air over every trough. Cutting at the lowest the surface can be draws none there
 * ever, at the price of a band under a crest that holds none -- which is the way round to be wrong,
 * since a speck in the air reads as a bug and a speck missing reads as nothing at all.
 */
export function speckCeiling(surfaceY: number, reach: number): number {
  const r = Number.isFinite(reach) && reach > 0 ? reach : 0;
  return surfaceY - r;
}

/** How much light reaches a speck at this depth and this hour: deep water is dark water, and so is night. */
export function speckLightAtDepth(depth: number, lightDepth: number, daylight = 1, nightFloor = 0): number {
  const sank = lightDepth > 0 ? Math.exp(-Math.max(0, depth) / lightDepth) : 1;
  const floor = clamp01(nightFloor);
  const day = floor + (1 - floor) * clamp01(Number.isFinite(daylight) ? daylight : 1);
  return sank * day;
}

/**
 * The size a speck is really drawn at, and the share of its colour that keeps its energy: a sprite
 * spread wider than it should be is dimmed by the square of how much wider, and one drawn narrower
 * is never brightened (the clamp only ever spreads).
 */
export function speckSprite(pxTrue: number, minPx = MOTE_MIN_PX, maxPx = SPECK_MAX_PX): { drawn: number; scale: number } {
  const drawn = Math.min(maxPx, Math.max(minPx, pxTrue));
  const k = Math.min(pxTrue / drawn, 1);
  return { drawn, scale: k * k };
}

/** Each speck's four seeds: its place in the tile (xyz, 0..1) and a spare (w) for its size, drift and swirl. */
export function speckSeeds(count: number, seed = 0x5bec): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(count * 4);
  for (let i = 0; i < out.length; i++) out[i] = rnd();
  return out;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(a: number, b: number, x: number): number {
  if (b <= a) return x >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Write a few of the tuning numbers, ignoring anything that is not a key of its own kind. */
export function tuneSpecks(patch: UnderwaterSpeckDebugOptions | undefined): UnderwaterSpeckTuning {
  if (!patch) return UNDERWATER_SPECK_TUNE;
  const into = UNDERWATER_SPECK_TUNE as unknown as Record<string, number>;
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in UNDERWATER_SPECK_TUNE)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    into[key] = value;
  }
  return UNDERWATER_SPECK_TUNE;
}

// ---- The shaders ----

const R = SPECK_RULE;

export const SPECKS_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uSpan, uSize, uProjScale, uDrift, uSink, uSwirl, uSwirlRate;
uniform float uBright, uTintMix, uNear, uCeiling, uSurfaceFade, uFade, uSurvive;
uniform vec3 uCam, uTint, uExtinction;
varying vec3 vColor;
varying float vViewZ;

// The whole of a speck's alpha, in one place: off the lens, inside the tile, under the ceiling,
// times the cloud's own fade. Mirrored by speckAlpha() in underwaterSpecks.ts, and the three
// numbers in it are written in from SPECK_RULE rather than typed here a second time.
float speckAlpha(float dist, float y, float span, float near, float ceiling, float fade, float cloud) {
  float lens = smoothstep(near, near * ${R.nearSpan.toFixed(2)}, dist);
  float tile = 1.0 - smoothstep(${R.tileIn.toFixed(2)} * span, ${R.tileOut.toFixed(2)} * span, dist);
  float top = 1.0 - smoothstep(ceiling - fade, ceiling, y);
  return lens * tile * top * cloud;
}

void main() {
  // Each speck drifts on its own and circles a little as it goes; the pattern repeats every uSpan
  // metres, so the cloud stays put in the water as the camera swims through it and the copy nearest
  // the camera is the one drawn.
  vec3 vel = (aSeed.yzx - 0.5) * 2.0 * uDrift - vec3(0.0, uSink, 0.0);
  float ph = uTime * uSwirlRate * (0.6 + 0.8 * aSeed.w) + aSeed.x * 37.0;
  vec3 wob = uSwirl * vec3(sin(ph), 0.6 * sin(1.7 * ph + aSeed.y * 11.0), cos(ph));
  vec3 p = aSeed.xyz * uSpan + vel * uTime + wob;
  vec3 rel = mod(p - uCam + 0.5 * uSpan, uSpan) - 0.5 * uSpan;
  vec3 pos = uCam + rel;
  float dist = length(rel);
  float a = speckAlpha(dist, pos.y, uSpan, uNear, uCeiling, uSurfaceFade, uFade);
  if (a < ${R.cull.toFixed(3)}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColor = vec3(0.0); vViewZ = 0.0; return; }

  // The water between the speck and the eye eats its light exactly as it eats everything else's --
  // the look pass's own per-channel extinction, over this speck's own short path -- and the depth
  // veil takes its share of what is left. This is the whole reason the specks are drawn here rather
  // than with the scene: drawn there, the look pass took the *background's* path off them and open
  // water had none at all.
  vec3 c = mix(vec3(1.0), uTint, uTintMix) * uBright * a * uSurvive * exp(-uExtinction * dist);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vViewZ = -mv.z;
  float pxTrue = uSize * (0.6 + 0.8 * aSeed.w) * uProjScale / max(-mv.z, 0.05);
  // Never drawn below MOTE_MIN_PX: a smaller sprite's brightness swings several fold as it crosses
  // pixel boundaries, which reads as twinkling. A sprite spread wider than it is keeps its energy.
  float pxDrawn = clamp(pxTrue, MOTE_MIN_PX, SPECK_MAX_PX);
  float k = min(pxTrue / pxDrawn, 1.0);
  c *= k * k;
  vColor = (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : clamp(c, 0.0, 64.0);
  gl_PointSize = pxDrawn;
  gl_Position = projectionMatrix * mv;
}
`;

export const SPECKS_FRAG = /* glsl */ `
uniform highp sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uNearFar;
varying vec3 vColor;
varying float vViewZ;
${FX_LINEARIZE}

void main() {
  // The chain's buffers carry no depth of their own, so the depth test is made here against the
  // scene's own depth texture -- which this pass may sample precisely because the target it draws
  // into is not the one that texture is attached to. A speck behind a rock is not drawn.
  float sceneZ = fxViewZ(texture2D(tDepth, gl_FragCoord.xy * uTexel).x, uNearFar.x, uNearFar.y);
  if (vViewZ > sceneZ) discard;
  vec2 c = gl_PointCoord - 0.5;
  // The room motes' kernel exactly: a Gaussian with no cut-out, so the sprite has no hard edge.
  float w = exp(-MOTE_KERNEL * dot(c, c));
  // Linear light, brighter than white allowed: the tone curve and the colour space belong to the
  // output pass, further down the chain.
  gl_FragColor = vec4(vColor * w, 1.0);
}
`;

/**
 * The drifting specks, as a pass. One is made per chain (the factory the game hands
 * `installEffects`), its points living in a scene of its own that nothing else ever walks.
 */
export class UnderwaterSpecksPass implements FxPass {
  readonly id: FxPassId = 'underwaterSpecks';
  readonly timerLabel = 'pass:underwaterSpecks';
  readonly points: THREE.Points;

  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly tint = new THREE.Color(1, 1, 1);
  private readonly body: Vec3 = [0, 0, 0];
  private readonly look: UnderwaterLook = createUnderwaterLook();

  /** Seconds under this dive; reset on every fresh one, so the shader's clock stays small. */
  private seconds = 0;
  private fade = 0;
  /** The last frame the chain prepared this pass on; a gap means a fresh dive. */
  private lastFrame = -2;
  private drewCount = 0;
  /** The last frame the chain asked whether to draw, and what it was told; the console reads both. */
  private asked = -1;
  private why: string | null = 'the chain has not asked yet';
  private readonly last = { submerged: false, wanted: false, depth: 0, surfaceY: 0, reach: 0, ceiling: 0, frame: -1 };

  constructor() {
    const T = UNDERWATER_SPECK_TUNE;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SPECKS * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(speckSeeds(MAX_SPECKS), 4));
    geo.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      name: 'water.specks',
      // Floats as strings with a decimal point: a bare 8 would be an int in GLSL, and
      // clamp(float, float, int) does not compile.
      defines: { MOTE_MIN_PX: MOTE_MIN_PX.toFixed(1), SPECK_MAX_PX: SPECK_MAX_PX.toFixed(1), MOTE_KERNEL: MOTE_KERNEL.toFixed(1) },
      uniforms: {
        tDepth: { value: null as THREE.Texture | null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uNearFar: { value: new THREE.Vector2(0.05, 9000) },
        uTime: { value: 0 },
        uSpan: { value: T.span },
        uSize: { value: T.size },
        uProjScale: { value: 1000 },
        uDrift: { value: T.drift },
        uSink: { value: T.sink },
        uSwirl: { value: T.swirl },
        uSwirlRate: { value: T.swirlRate },
        uBright: { value: T.brightness },
        uTintMix: { value: T.tint },
        uNear: { value: T.near },
        uCeiling: { value: 0 },
        uSurfaceFade: { value: T.surfaceFade },
        uFade: { value: 0 },
        uSurvive: { value: 1 },
        uCam: { value: new THREE.Vector3() },
        uTint: { value: this.tint },
        uExtinction: { value: new THREE.Vector3() },
      },
      vertexShader: SPECKS_VERT,
      fragmentShader: SPECKS_FRAG,
      transparent: true,
      // The chain's buffers have no depth attachment at all; the fragment program tests the scene's
      // own depth texture instead.
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      lights: false,
      // Out of the program key altogether: this always draws into a linear buffer, and the tone
      // curve is the output pass's, so the program the warm-up builds is the one every frame uses.
      toneMapped: false,
    });

    const points = new THREE.Points(geo, this.material);
    points.name = 'water.specks';
    // The shader places every speck in world space, so the object itself never moves, and it is
    // never culled: the cloud is always around the camera, and whether it is drawn at all is
    // `enabled`'s answer rather than a frustum's.
    points.matrixAutoUpdate = false;
    points.matrix.identity();
    points.matrixWorld.identity();
    points.frustumCulled = false;
    points.castShadow = false;
    points.receiveShadow = false;
    // Its own scene, drawn by this pass alone: no portal renderer, no stencil, no lights, no fog.
    // Every layer is enabled because the camera's layer mask at that moment in the chain is nobody's
    // contract, and a draw silently dropped by it would be a mystery worth hours.
    points.layers.enableAll();
    this.points = points;
    this.scene.matrixAutoUpdate = false;
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.add(points);
  }

  /**
   * Whether it draws, which is exactly "there is no reason not to": the two are one ladder rather
   * than two that could disagree, and the answer is kept so the console can say why on a frame
   * nothing was drawn instead of reporting the last frame that was.
   */
  enabled(ctx: FxFrameContext): boolean {
    const why = this.reason(ctx);
    this.asked = ctx.frame;
    this.why = why;
    return why === null;
  }

  needs(_ctx: FxFrameContext): readonly FxProductId[] {
    return NO_PRODUCTS;
  }

  /**
   * In the order that names the cause rather than the first switch that happens to be off: where
   * the camera is does not depend on any setting. The strict verdict is what is read, because
   * `cameraUnderwater` is still true for up to a metre and a half of air over the open sea, and
   * specks in the air are the one thing this must never do.
   */
  reason(ctx: FxFrameContext): string | null {
    if (!ctx.cameraSubmerged) return ctx.cameraUnderwater ? 'the camera is at the surface line rather than under it' : 'the camera is not under water';
    if (!ctx.settings.effects) return 'the Effects setting is off';
    if (!ctx.settings.underwater) return 'the underwater look is switched off';
    if (!(ctx.settings.underwaterShimmerStrength > 0)) return 'the shimmer strength is 0, which the specks share';
    if (speckDrawCount(UNDERWATER_SPECK_TUNE.count, UNDERWATER_SPECK_TUNE.amount) <= 0) return 'the amount is 0';
    return null;
  }

  prepare(ctx: FxFrameContext): void {
    const T = UNDERWATER_SPECK_TUNE;
    const u = this.material.uniforms;
    // A gap in the frames this pass drew is a fresh dive (or a new chain, or a teleport): the clock
    // starts again, so nothing on screen jumps, the shader's `sin` never takes a number that has
    // been growing all session, and the cloud eases in rather than appearing whole.
    const fresh = ctx.frame !== this.lastFrame + 1;
    this.lastFrame = ctx.frame;
    if (fresh) {
      this.seconds = 0;
      this.fade = 0;
    }
    const dt = Math.min(Math.max(ctx.dt, 0), 0.1);
    this.seconds += dt;
    this.fade = speckFade(this.fade, true, dt, T.fadeSeconds);

    const drawn = speckDrawCount(T.count, T.amount);
    this.points.geometry.setDrawRange(0, drawn);
    this.drewCount = drawn;

    // The water's own numbers, derived exactly as the look pass derives them, so the specks are
    // eaten by the same water the picture is.
    const depth = Number.isFinite(ctx.underwaterDepth) ? Math.max(0, ctx.underwaterDepth) : UNDERWATER_FALLBACK.depth;
    const opacity = Number.isFinite(ctx.underwaterOpacity) ? ctx.underwaterOpacity : UNDERWATER_FALLBACK.opacity;
    const c = ctx.underwaterColor;
    this.body[0] = c.r;
    this.body[1] = c.g;
    this.body[2] = c.b;
    this.tint.copy(c);
    const S = ctx.settings;
    // The scene's own light, exactly as the look pass reads it (`lightOf`), so the two derivations
    // stay one derivation. Nothing here reads the murk it drives -- only `extinction` and `veil` are
    // used below -- but passing the day's number instead would be the seam a later reader trips on.
    const look = deriveUnderwater(this.body, opacity, depth, lightOf(ctx.lights, UNDERWATER_TUNE), S.underwaterStrength, S.underwaterShimmerStrength, UNDERWATER_TUNE, this.look);
    (u.uExtinction.value as THREE.Vector3).set(look.extinction[0], look.extinction[1], look.extinction[2]);
    u.uSurvive.value = 1 - Math.min(1, Math.max(0, look.veil));

    // Where the surface stands over the eye, and the highest a speck may be drawn under it.
    const surfaceY = ctx.cameraPos.y + depth;
    const reach = Number.isFinite(ctx.underwaterReach) ? Math.max(0, ctx.underwaterReach) : 0;
    const ceiling = speckCeiling(surfaceY, reach);

    u.tDepth.value = ctx.depth;
    (u.uTexel.value as THREE.Vector2).set(1 / Math.max(1, ctx.width), 1 / Math.max(1, ctx.height));
    (u.uNearFar.value as THREE.Vector2).set(ctx.near, ctx.far);
    u.uTime.value = this.seconds;
    u.uSpan.value = T.span;
    u.uSize.value = T.size;
    // A metre at a metre, in pixels: the height of the drawing buffer over twice the tangent of half
    // the vertical field of view, which the context already carries as tanHalfFov.y.
    u.uProjScale.value = Math.max(1, ctx.height) / (2 * Math.max(1e-4, ctx.tanHalfFov.y));
    u.uDrift.value = T.drift;
    u.uSink.value = T.sink;
    u.uSwirl.value = T.swirl;
    u.uSwirlRate.value = T.swirlRate;
    u.uBright.value = T.brightness * speckLightAtDepth(depth, T.lightDepth, ctx.daylight, T.nightFloor);
    u.uTintMix.value = T.tint;
    u.uNear.value = T.near;
    u.uCeiling.value = ceiling;
    u.uSurfaceFade.value = Math.max(1e-3, T.surfaceFade);
    u.uFade.value = this.fade;
    (u.uCam.value as THREE.Vector3).copy(ctx.cameraPos);

    const l = this.last;
    l.submerged = ctx.cameraSubmerged;
    l.wanted = wantSpecks(S);
    l.depth = depth;
    l.surfaceY = surfaceY;
    l.reach = reach;
    l.ceiling = ceiling;
    l.frame = ctx.frame;
  }

  /**
   * Drawn into the picture where it stands, so the runner keeps its buffers as they are. `output` is
   * not written at all: this is a lens pass and the output pass is always on and always after it, so
   * it can never be the last pass and never has the canvas handed to it.
   *
   * `input` is always one of the two chain buffers and never the scene target -- the sanitize pass
   * is required, runs first and swaps -- which is what makes sampling the scene's depth texture in
   * the fragment program legal: the target bound here is not the one it is attached to.
   */
  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, _output: THREE.WebGLRenderTarget | null): boolean {
    const r = ctx.renderer;
    const auto = r.autoClear;
    // Never clear: the picture is already in this buffer and the specks are added to it.
    r.autoClear = false;
    r.setRenderTarget(input);
    try {
      r.render(this.scene, ctx.camera);
    } finally {
      r.autoClear = auto;
    }
    return false;
  }

  setSize(_width: number, _height: number, _settings: FxSettings): void {
    // The texel size and the projection scale are read off the context every frame, so nothing here.
  }

  materials(): FxWarmItem[] {
    // Compiled against a chain buffer, which is where it always draws: one program, built behind the
    // loading screen with every other pass's.
    return [{ material: this.material, object: this.points, where: 'target' }];
  }

  /** Retune from the console, then the listing. No program is ever rebuilt by any of it. */
  debug(opts: UnderwaterSpeckDebugOptions): UnderwaterSpeckDescription {
    tuneSpecks(opts);
    return this.describe();
  }

  describe(): UnderwaterSpeckDescription {
    const r2 = (v: number) => Number(v.toFixed(2));
    const l = this.last;
    // What the chain was told on the last frame it asked, not what the last frame that drew did:
    // "700 specks" on a frame where the camera is standing on a beach would be a lie.
    const drew = this.why === null && this.drewCount > 0;
    return {
      wanted: l.wanted,
      submerged: l.submerged,
      drawn: drew ? this.drewCount : 0,
      reason: this.why,
      asked: this.asked,
      depth: r2(l.depth),
      surfaceY: r2(l.surfaceY),
      reach: r2(l.reach),
      ceiling: r2(l.ceiling),
      fade: r2(this.fade),
      color: this.tint.getHexString(),
      channelMetres: this.look.extinction.map((k) => (k > 1e-9 ? Number((1 / k).toFixed(2)) : Infinity)),
      seconds: r2(this.seconds),
      frame: l.frame,
      tuning: { ...UNDERWATER_SPECK_TUNE },
    };
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
