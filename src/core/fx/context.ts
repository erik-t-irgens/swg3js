// Everything an effect is allowed to know about the frame, gathered once and handed to every pass.
// The game fills an `FxFrameInput` in drawFrame and `updateContext` turns it into the context; no
// pass reaches into the world, the player or the camera for itself, and nothing here allocates.
import * as THREE from 'three';
import { FX_PRODUCTS, type FxPassId, type FxProductId, type FxSettings } from '../fxRegistry.ts';
import type { SkyLighting } from '../../world/sky';
import { UNSET_BLADES, type FxBladeList } from './bladeList';
import { createFxLights, type FxLights } from './lights';
import type { FxCloudLayer, FxSkyLight } from './lensFlare';
import type { RoomAirFrame } from '../../world/roomAir';

/** The sun as the world knows it: which way it lies (towards it), its colour, and how much daylight there is (0 at night, and in space). */
export interface SunInfo {
  dir: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
}

/** The weather as the effects see it (World.weather.fx): 0..1 each. */
export interface FxWeather {
  overcast: number;
  rain: number;
  snow: number;
  dust: number;
  wetness: number;
}

/** What the game tells the effects about the frame; one object the game keeps and refills in drawFrame. */
export interface FxFrameInput {
  camera: THREE.PerspectiveCamera;
  dt: number;
  sun: SunInfo | null;
  /** The camera is inside a portal building: the world shows only through its exits, at stencil 2. */
  portalView: boolean;
  /** The camera is among the rooms of the ship the player is aboard: first person aboard, or inside the rooms' bounds in the hull's frame. */
  cameraInHull: boolean;
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
  /** Metres from the camera to the orbit's centre (cam.orbitDistance): the shooter's plane while aiming over the shoulder; 0 in first person and in a ship's chase. */
  orbitDistance: number;
  /** Water shows on screen this frame: in the frustum within the fog's reach, and not found hidden by the occlusion probe. */
  waterInView: boolean;
  /** The lens flare's sources: a kept array of MAX_FLARE_SOURCES records, refilled in drawFrame; entry i is flare slot i. */
  skyLights: readonly FxSkyLight[];
  /** Slots this sky has (0, 1 or 2); a slot not drawn this frame has alpha 0. */
  skyLightCount: number;
  /** The cloud sheets drawn this frame: a kept array of MAX_CLOUD_LAYERS records. */
  clouds: readonly FxCloudLayer[];
  /** Sheets listed this frame (0..4). */
  cloudCount: number;
  /**
   * The camera *may* have water over it: nothing beyond the water is seen as sky. The conservative
   * verdict, true throughout the margin band -- over the open sea that is up to a metre and a half
   * of air over the mean surface, because a crest could be there. What must not be caught wrong
   * reads this (the lens flare); anything that paints the picture must not.
   */
  cameraUnderwater: boolean;
  /**
   * The camera is really below the surface (`UnderwaterInfo.submerged`, which is `depth > 0`). This
   * is the fact a look is drawn from: `cameraUnderwater` is true while the eye is plainly in the
   * air, and painting the screen there would be a bug rather than a safety.
   */
  cameraSubmerged: boolean;
  /**
   * Metres of water over the camera (0 while it is dry, and 0 right at the surface line, so nothing
   * this drives pops on). `World.cameraUnderwaterAt`'s depth.
   */
  underwaterDepth: number;
  /**
   * The colour of the water the camera is under, in the renderer's working space: the water body's
   * own converted colour, the very colour its material wears. A reference to the world's kept
   * record, never a new object; nothing in the chain may write it.
   */
  underwaterColor: THREE.Color;
  /**
   * That water's own opacity, as the converter read it from the client's own water texture: the one
   * per-body signal there is of how thick the water is, so a silty pond and open sea are not seen
   * exactly as far through. `UnderwaterInfo.opacity`; 0.75 is the record's own resting value.
   */
  underwaterOpacity: number;
  /**
   * How far a crest can lift the surface over the camera, metres (`UnderwaterInfo.reach`): the sea's
   * own measured swell where the surface is the sea, a lake's fixed reach otherwise, 0 where there
   * is no water. The surface the CPU knows is flat and the one drawn is displaced by up to this, and
   * nothing this side knows which way: anything that must not be drawn in the air keeps this clear
   * of the line.
   */
  underwaterReach: number;
  /** The lit blades this frame, world space: the game's kept list, refilled in drawFrame. */
  blades: FxBladeList;
  /** The frame's lights, both passes' sets (src/core/fx/lights.ts): the game's kept record, refilled in drawFrame after the scene is drawn. */
  lights: FxLights;
  /** RoomAir.frame: the room this frame is drawn from inside, or null. */
  room: RoomAirFrame | null;
  /** The view depth (m) of the far side of what the camera follows (App.followFar), 0 when nothing: nothing nearer smears with the camera. */
  followFar: number;
  /** World.weather.fx while the weather is on, else null. */
  weather: FxWeather | null;
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
  /** Last frame's view; this frame's after a cut. */
  readonly prevView: THREE.Matrix4;
  /** This frame's projection times last frame's view: a change of field of view (aiming) is not motion. */
  readonly prevProjView: THREE.Matrix4;
  /** The view depth (m) of the far side of what the camera follows; 0 when nothing. */
  followFar: number;
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
  /** The camera is among the rooms of the ship the player is aboard. */
  cameraInHull: boolean;
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
  /** Metres from the camera to the shooter's plane; 0 in first person and in a chase. */
  orbitDistance: number;
  /** Water shows on screen this frame (`WaterBodies.inView`); the occlusion reads the mask's coverage only then. */
  waterInView: boolean;
  /** The lit blades this frame; a reference to the input's kept list. */
  blades: FxBladeList;
  /** The frame's lights; a reference to the input's kept record. */
  lights: FxLights;
  /** The lens flare's sources; a reference to the input's kept list (entry i is flare slot i). */
  skyLights: readonly FxSkyLight[];
  skyLightCount: number;
  /** The cloud sheets drawn this frame; a reference to the input's kept list. */
  clouds: readonly FxCloudLayer[];
  cloudCount: number;
  /** Water may be over the camera (the margin band included): the safe answer, for what must not be caught wrong. */
  cameraUnderwater: boolean;
  /** The camera is really below the surface: the answer anything that draws must read. */
  cameraSubmerged: boolean;
  /** Metres of water over the camera; 0 dry, and 0 at the surface line itself. */
  underwaterDepth: number;
  /** The colour of the water over the camera, working space: this context's own kept Color, copied each frame. */
  readonly underwaterColor: THREE.Color;
  /** That water's own opacity, the converter's reading of the client's texture: how thick this body is. */
  underwaterOpacity: number;
  /** How far a crest can lift that surface here, metres (`UnderwaterInfo.reach`): 0 where there is no water. */
  underwaterReach: number;
  /** The room this frame is drawn from inside (`RoomAir.frame`), or null. */
  room: RoomAirFrame | null;
  /** The weather now; zeros when it is off (a kept record). */
  readonly weather: FxWeather;
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
    prevView: new THREE.Matrix4(),
    prevProjView: new THREE.Matrix4(),
    followFar: 0,
    cameraPos: new THREE.Vector3(),
    tanHalfFov: new THREE.Vector2(1, 1),
    cameraCut: true,
    sceneColor: sceneTarget.texture,
    // The scene target is always built with one (postfx.ts), and a resize keeps it.
    depth: sceneTarget.depthTexture as THREE.DepthTexture,
    products,
    sun: null,
    portalView: false,
    cameraInHull: false,
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
    orbitDistance: 0,
    waterInView: false,
    // The unset list until the first frame hands the game's own; the glow pass warns if it never does.
    blades: UNSET_BLADES,
    lights: createFxLights(),
    // Empty until the first frame hands the game's own lists; the flare says so rather than drawing.
    skyLights: [],
    skyLightCount: 0,
    clouds: [],
    cloudCount: 0,
    cameraUnderwater: false,
    cameraSubmerged: false,
    underwaterDepth: 0,
    // The neutral water colour waterLookFor falls back to, until a frame hands the body's own.
    underwaterColor: new THREE.Color(0x2e7fbb),
    underwaterOpacity: 0.75,
    underwaterReach: 0,
    room: null,
    weather: { overcast: 0, rain: 0, snow: 0, dust: 0, wetness: 0 },
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
  if (ctx.frame === 0 || ctx.cameraCut) ctx.prevView.copy(ctx.view);
  ctx.prevProjView.multiplyMatrices(ctx.proj, ctx.prevView);
  ctx.followFar = input.followFar;

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
    // Fade out as it leaves the screen, and as it nears the horizon. In space there is no horizon
    // and no ground for the star to set behind, so its height says nothing about it and the fade
    // belongs to a planet's day: applied in orbit it would dim the zone's star for good.
    const off = Math.max(0, Math.abs(sx - 0.5) - 0.5, Math.abs(sy - 0.5) - 0.5);
    const height = input.space ? 1 : clamp(sun.dir.y * 6, 0, 1);
    s.fade = behind ? 0 : Math.max(0, 1 - off / 0.6) * height * Math.min(1, sun.intensity);
    ctx.sun = s;
  }

  ctx.portalView = input.portalView;
  ctx.cameraInHull = input.cameraInHull;
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
  ctx.orbitDistance = input.orbitDistance;
  ctx.waterInView = input.waterInView;
  ctx.blades = input.blades;
  ctx.lights = input.lights;
  ctx.skyLights = input.skyLights;
  ctx.skyLightCount = input.skyLightCount;
  ctx.clouds = input.clouds;
  ctx.cloudCount = input.cloudCount;
  ctx.cameraUnderwater = input.cameraUnderwater;
  ctx.cameraSubmerged = input.cameraSubmerged;
  ctx.underwaterDepth = input.underwaterDepth;
  ctx.underwaterColor.copy(input.underwaterColor);
  ctx.underwaterOpacity = input.underwaterOpacity;
  ctx.underwaterReach = input.underwaterReach;
  ctx.room = input.room;
  const w = input.weather;
  ctx.weather.overcast = w ? w.overcast : 0;
  ctx.weather.rain = w ? w.rain : 0;
  ctx.weather.snow = w ? w.snow : 0;
  ctx.weather.dust = w ? w.dust : 0;
  ctx.weather.wetness = w ? w.wetness : 0;
}
