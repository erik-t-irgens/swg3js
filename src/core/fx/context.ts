// Everything an effect is allowed to know about the frame, gathered once and handed to every pass.
// The game fills an `FxFrameInput` in drawFrame and `updateContext` turns it into the context; no
// pass reaches into the world, the player or the camera for itself, and nothing here allocates.
import * as THREE from 'three';
import { FX_PRODUCTS, type FxPassId, type FxProductId, type FxSettings } from '../fxRegistry.ts';
import type { SkyLighting } from '../../world/sky';

/** The sun as the world knows it: which way it lies (towards it), its colour, and how much daylight there is (0 at night, and in space). */
export interface SunInfo {
  dir: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
}

/** What the game tells the effects about the frame; one object the game keeps and refills in drawFrame. */
export interface FxFrameInput {
  camera: THREE.PerspectiveCamera;
  dt: number;
  sun: SunInfo | null;
  /** The camera is inside a portal building: the world shows only through its exits, at stencil 2. */
  portalView: boolean;
  inside: boolean;
  aboard: boolean;
  space: boolean;
  fog: THREE.FogExp2 | null;
  daylight: number;
  dayIndex: number;
  lighting: SkyLighting | null;
  planetId: string;
  aiming: boolean;
  /** How far the aimed camera has eased in, 0 to 1. */
  aimAmount: number;
  firstPerson: boolean;
}

/** The sun as the effects want it, with its place on the screen worked out. */
export interface FxSun {
  readonly dir: THREE.Vector3;
  readonly color: THREE.Color;
  intensity: number;
  /** Where it sits on the screen, in uv. */
  readonly screen: THREE.Vector2;
  behind: boolean;
  /** 0 to 1: how far on screen it is, times how high it stands, times how bright it is. */
  fade: number;
}

export interface FxFrameContext {
  readonly renderer: THREE.WebGLRenderer;
  /** The live settings the effects were configured with; read strengths from here. */
  readonly settings: FxSettings;
  camera: THREE.PerspectiveCamera;
  dt: number;
  /** Seconds of effects time, for anything that moves on its own. */
  time: number;
  frame: number;
  width: number;
  height: number;
  near: number;
  far: number;
  readonly view: THREE.Matrix4;
  readonly proj: THREE.Matrix4;
  readonly invProj: THREE.Matrix4;
  readonly viewProj: THREE.Matrix4;
  readonly invViewProj: THREE.Matrix4;
  /** Last frame's viewProj; the same as this frame's after a cut. */
  readonly prevViewProj: THREE.Matrix4;
  readonly cameraPos: THREE.Vector3;
  /** (tan(fov/2) x aspect, tan(fov/2)): a view position from a screen place and a distance. */
  readonly tanHalfFov: THREE.Vector2;
  /** No history this frame: a reset, a resize, the effects switched in, or the first frame. */
  cameraCut: boolean;
  /** The scene target's colour, for the sanitize pass only. */
  readonly sceneColor: THREE.Texture;
  /** The scene target's depth and stencil. Sample it only while drawing into something else. */
  readonly depth: THREE.DepthTexture;
  /** What was computed this frame; null for anything nothing asked for. */
  readonly products: Record<FxProductId, THREE.Texture | null>;
  sun: FxSun | null;
  portalView: boolean;
  inside: boolean;
  aboard: boolean;
  space: boolean;
  readonly fogColor: THREE.Color;
  fogDensity: number;
  daylight: number;
  dayIndex: number;
  lighting: SkyLighting | null;
  planetId: string;
  aiming: boolean;
  aimAmount: number;
  firstPerson: boolean;
  /** The pass whose own working texture the debug view is showing, so it keeps it this frame. */
  debugViewPass: FxPassId | null;
  /** The sun record `sun` points at, kept so a frame allocates nothing; never read it directly. */
  readonly sunStore: FxSun;
}

/** How far along its direction the sun is projected to find its place on the screen. */
const SUN_DISTANCE = 5000;
const sunClip = new THREE.Vector4();
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function createContext(renderer: THREE.WebGLRenderer, settings: FxSettings, sceneTarget: THREE.WebGLRenderTarget): FxFrameContext {
  const products = {} as Record<FxProductId, THREE.Texture | null>;
  for (const p of FX_PRODUCTS) products[p.id] = null;
  return {
    renderer,
    settings,
    camera: new THREE.PerspectiveCamera(),
    dt: 1 / 60,
    time: 0,
    frame: 0,
    width: sceneTarget.width,
    height: sceneTarget.height,
    near: 0.05,
    far: 9000,
    view: new THREE.Matrix4(),
    proj: new THREE.Matrix4(),
    invProj: new THREE.Matrix4(),
    viewProj: new THREE.Matrix4(),
    invViewProj: new THREE.Matrix4(),
    prevViewProj: new THREE.Matrix4(),
    cameraPos: new THREE.Vector3(),
    tanHalfFov: new THREE.Vector2(1, 1),
    cameraCut: true,
    sceneColor: sceneTarget.texture,
    // The scene target is always built with one (postfx.ts), and a resize keeps it.
    depth: sceneTarget.depthTexture as THREE.DepthTexture,
    products,
    sun: null,
    portalView: false,
    inside: false,
    aboard: false,
    space: false,
    fogColor: new THREE.Color(),
    fogDensity: 0,
    daylight: 1,
    dayIndex: 0,
    lighting: null,
    planetId: '',
    aiming: false,
    aimAmount: 0,
    firstPerson: false,
    debugViewPass: null,
    sunStore: { dir: new THREE.Vector3(), color: new THREE.Color(), intensity: 0, screen: new THREE.Vector2(0.5, 0.5), behind: false, fade: 0 },
  };
}

/** Take the frame as the game has just drawn it. Called once, before anything decides whether it draws. */
export function updateContext(ctx: FxFrameContext, input: FxFrameInput, size: THREE.Vector2): void {
  const cam = input.camera;
  ctx.camera = cam;
  ctx.dt = input.dt;
  ctx.time += input.dt;
  ctx.width = size.x;
  ctx.height = size.y;
  ctx.near = cam.near;
  ctx.far = cam.far;
  ctx.view.copy(cam.matrixWorldInverse);
  ctx.proj.copy(cam.projectionMatrix);
  ctx.invProj.copy(cam.projectionMatrixInverse);
  ctx.viewProj.multiplyMatrices(ctx.proj, ctx.view);
  ctx.invViewProj.copy(ctx.viewProj).invert();
  ctx.cameraPos.setFromMatrixPosition(cam.matrixWorld);
  const e = ctx.proj.elements;
  ctx.tanHalfFov.set(1 / e[0], 1 / e[5]);
  if (ctx.frame === 0 || ctx.cameraCut) ctx.prevViewProj.copy(ctx.viewProj);

  const sun = input.sun;
  if (!sun) ctx.sun = null;
  else {
    const s = ctx.sunStore;
    s.dir.copy(sun.dir);
    s.color.copy(sun.color);
    s.intensity = sun.intensity;
    // A point far along the sun's direction, projected: behind the camera it shows nothing.
    sunClip.set(ctx.cameraPos.x + sun.dir.x * SUN_DISTANCE, ctx.cameraPos.y + sun.dir.y * SUN_DISTANCE, ctx.cameraPos.z + sun.dir.z * SUN_DISTANCE, 1).applyMatrix4(ctx.view).applyMatrix4(ctx.proj);
    const behind = sunClip.w <= 0;
    s.behind = behind;
    const sx = behind ? 0.5 : (sunClip.x / sunClip.w) * 0.5 + 0.5;
    const sy = behind ? 0.5 : (sunClip.y / sunClip.w) * 0.5 + 0.5;
    s.screen.set(sx, sy);
    // Fade out as it leaves the screen, and as it nears the horizon.
    const off = Math.max(0, Math.abs(sx - 0.5) - 0.5, Math.abs(sy - 0.5) - 0.5);
    s.fade = behind ? 0 : Math.max(0, 1 - off / 0.6) * clamp(sun.dir.y * 6, 0, 1) * Math.min(1, sun.intensity);
    ctx.sun = s;
  }

  ctx.portalView = input.portalView;
  ctx.inside = input.inside;
  ctx.aboard = input.aboard;
  ctx.space = input.space;
  if (input.fog) {
    ctx.fogColor.copy(input.fog.color);
    ctx.fogDensity = input.fog.density;
  } else {
    ctx.fogDensity = 0;
  }
  ctx.daylight = input.daylight;
  ctx.dayIndex = input.dayIndex;
  ctx.lighting = input.lighting;
  ctx.planetId = input.planetId;
  ctx.aiming = input.aiming;
  ctx.aimAmount = input.aimAmount;
  ctx.firstPerson = input.firstPerson;
}
