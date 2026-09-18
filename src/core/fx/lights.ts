// The frame's lights as the effects read them: every light that drew a pixel, split by which of the
// portal renderer's passes saw it. The world pass (layer 0) lights with the sky's set: the
// hemisphere, the fill, the sun through its cascades, and the torch. The interior pass (layer 1)
// lights with the rooms' set: the lit cell's ambient, its parallel light and its lamps. The flash
// pool is on the actor layer, so both passes see it.
//
// One kept object in the game, refilled after the scene is drawn (the shadow matrices are then this
// frame's), read by any effect that has to know how a surface was lit: the ambient occlusion takes
// only the ambient share of each pixel's light, and the light shafts take the rooms' lamps from here
// rather than reaching into the world. Nothing here allocates once the object is made; the helpers
// share module-level temporaries.
import * as THREE from 'three';

/** The flash pool's size (`FLASH_POOL` in effects.ts). */
export const FX_MAX_FLASH_LIGHTS = 4;
/** The room lamps lit at once (`INTERIOR_LIGHT_CAP` in world.ts). */
export const FX_MAX_ROOM_LIGHTS = 8;
/** The sun's shadow cascades (the CSM the world builds). */
export const FX_MAX_CASCADES = 3;

/** A point light as three's shading sees it this frame. Kept object, refilled in place. */
export interface FxPointLight {
  /** World. */
  readonly position: THREE.Vector3;
  /** Colour times intensity (linear). */
  readonly color: THREE.Color;
  /** Rec. 709 luminance of `color`. */
  luminance: number;
  /** Three's cutoff distance; 0 is none. */
  distance: number;
  decay: number;
  /** The building cell a room lamp belongs to; -1 for anything else (a flash light, the torch). */
  cell: number;
}

export interface FxDirectionalLight {
  /** World, unit, towards the light (position minus target). */
  readonly direction: THREE.Vector3;
  /** Colour times intensity; black when hidden or off. */
  readonly color: THREE.Color;
  luminance: number;
}

export interface FxSpotLight extends FxPointLight {
  /** Position minus target, unit: towards the light, as three's spot direction. */
  readonly direction: THREE.Vector3;
  /** cos(angle): outside it, nothing. */
  coneCos: number;
  /** cos(angle x (1 - penumbra)): inside it, full. */
  penumbraCos: number;
}

export interface FxCascades {
  /** 0 when the sun's shadows are off, not drawn yet, or not a PCF depth map; then every entry of `maps` is null. */
  count: number;
  /** FX_MAX_CASCADES entries: each light's `shadow.map.depthTexture`, a compare-mode depth texture. */
  readonly maps: (THREE.Texture | null)[];
  /** FX_MAX_CASCADES entries: each light's `shadow.matrix`, world to shadow uv and depth. */
  readonly matrices: THREE.Matrix4[];
  /** 4 per cascade: shadow.bias, shadow.normalBias (metres along the world normal), shadow.intensity, 0. */
  readonly params: Float32Array;
  /** 2 per cascade: where it starts and ends, as shares of `range` (CSM's breaks). */
  readonly ranges: Float32Array;
  /** min(camera.far, csm.maxFar) - camera.near: a view depth divided by this is the cascade shader's linear depth. */
  range: number;
  /** CSM's `fade`: the materials blend between cascades and fade the last one out over its far margin. */
  fade: boolean;
}

/** The world pass's lights (layer 0). */
export interface FxSkyLights {
  /** The hemisphere's sky colour times its intensity. */
  readonly hemiSky: THREE.Color;
  /** The hemisphere's ground colour times its intensity. */
  readonly hemiGround: THREE.Color;
  hemiSkyLuminance: number;
  hemiGroundLuminance: number;
  /** The client's unshadowed fill light. */
  readonly fill: FxDirectionalLight;
  /** The cascades' light (or the plain sun when there are no cascades). */
  readonly sun: FxDirectionalLight;
  readonly cascades: FxCascades;
  /** The hand torch; luminance 0 while it is off. */
  readonly torch: FxSpotLight;
}

/** The interior pass's lights (layer 1): the cell the player stands in lights every building's rooms drawn that frame. */
export interface FxRoomLights {
  /** A cell's lights are on (World.updateInteriorLights); everything below is zero otherwise. */
  lit: boolean;
  /** Which building (the world's Building object, compared by identity) and cell lit them; null and -1 when not lit. */
  building: object | null;
  cell: number;
  /** The summed ambient (with its floor) times its intensity. */
  readonly ambient: THREE.Color;
  ambientLuminance: number;
  /** The cell's parallel light; luminance 0 when the cell has none. */
  readonly parallel: FxDirectionalLight;
  /** FX_MAX_ROOM_LIGHTS kept entries; the first `pointCount` are lit, each with the cell it came from. */
  readonly points: FxPointLight[];
  pointCount: number;
}

/** The frame's lights as the effects need them. One kept object in the game, refilled in drawFrame after the scene is drawn. */
export interface FxLights {
  readonly sky: FxSkyLights;
  readonly rooms: FxRoomLights;
  /** The flash pool (effects.ts): layers 0 and 31, so both the world pass and the interior pass see them. */
  readonly flash: FxPointLight[];
  flashCount: number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function createPoint(): FxPointLight {
  return { position: new THREE.Vector3(), color: new THREE.Color(0, 0, 0), luminance: 0, distance: 0, decay: 2, cell: -1 };
}

function createDirectional(): FxDirectionalLight {
  return { direction: new THREE.Vector3(0, 1, 0), color: new THREE.Color(0, 0, 0), luminance: 0 };
}

function createSpot(): FxSpotLight {
  return { ...createPoint(), direction: new THREE.Vector3(0, 1, 0), coneCos: 1, penumbraCos: 1 };
}

function clearPoint(p: FxPointLight): void {
  p.position.set(0, 0, 0);
  p.color.setRGB(0, 0, 0);
  p.luminance = 0;
  p.distance = 0;
  p.decay = 2;
  p.cell = -1;
}

function clearDirectional(d: FxDirectionalLight): void {
  d.direction.copy(UP);
  d.color.setRGB(0, 0, 0);
  d.luminance = 0;
}

export function createFxLights(): FxLights {
  const cascades: FxCascades = {
    count: 0,
    maps: [],
    matrices: [],
    params: new Float32Array(FX_MAX_CASCADES * 4),
    ranges: new Float32Array(FX_MAX_CASCADES * 2),
    range: 1,
    fade: false,
  };
  for (let i = 0; i < FX_MAX_CASCADES; i++) {
    cascades.maps.push(null);
    cascades.matrices.push(new THREE.Matrix4());
  }
  const points: FxPointLight[] = [];
  for (let i = 0; i < FX_MAX_ROOM_LIGHTS; i++) points.push(createPoint());
  const flash: FxPointLight[] = [];
  for (let i = 0; i < FX_MAX_FLASH_LIGHTS; i++) flash.push(createPoint());
  return {
    sky: {
      hemiSky: new THREE.Color(0, 0, 0),
      hemiGround: new THREE.Color(0, 0, 0),
      hemiSkyLuminance: 0,
      hemiGroundLuminance: 0,
      fill: createDirectional(),
      sun: createDirectional(),
      cascades,
      torch: createSpot(),
    },
    rooms: {
      lit: false,
      building: null,
      cell: -1,
      ambient: new THREE.Color(0, 0, 0),
      ambientLuminance: 0,
      parallel: createDirectional(),
      points,
      pointCount: 0,
    },
    flash,
    flashCount: 0,
  };
}

/** Zero every colour, luminance and count; directions to (0, 1, 0); cascades count 0 and maps null; rooms lit false, building null, cell -1. */
export function resetFxLights(out: FxLights): void {
  const sky = out.sky;
  sky.hemiSky.setRGB(0, 0, 0);
  sky.hemiGround.setRGB(0, 0, 0);
  sky.hemiSkyLuminance = 0;
  sky.hemiGroundLuminance = 0;
  clearDirectional(sky.fill);
  clearDirectional(sky.sun);
  const c = sky.cascades;
  c.count = 0;
  for (let i = 0; i < c.maps.length; i++) c.maps[i] = null;
  c.params.fill(0);
  c.ranges.fill(0);
  c.range = 1;
  c.fade = false;
  clearPoint(sky.torch);
  sky.torch.direction.copy(UP);
  sky.torch.coneCos = 1;
  sky.torch.penumbraCos = 1;
  const rooms = out.rooms;
  rooms.lit = false;
  rooms.building = null;
  rooms.cell = -1;
  rooms.ambient.setRGB(0, 0, 0);
  rooms.ambientLuminance = 0;
  clearDirectional(rooms.parallel);
  for (let i = 0; i < rooms.points.length; i++) clearPoint(rooms.points[i]);
  rooms.pointCount = 0;
  for (let i = 0; i < out.flash.length; i++) clearPoint(out.flash[i]);
  out.flashCount = 0;
}

/** Rec. 709 luminance of a colour times an intensity. */
export function luminanceOf(color: THREE.Color, intensity: number): number {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) * intensity;
}

/** A directional light's world direction towards it, from the world positions of the light and its target; (0, 1, 0) if degenerate. */
export function towardsLight(out: THREE.Vector3, light: THREE.DirectionalLight | THREE.SpotLight): THREE.Vector3 {
  tmpA.setFromMatrixPosition(light.matrixWorld);
  tmpB.setFromMatrixPosition(light.target.matrixWorld);
  out.subVectors(tmpA, tmpB);
  if (out.lengthSq() < 1e-12) return out.copy(UP);
  return out.normalize();
}

/** Take a directional light: its direction towards it, colour times intensity, luminance; black and 0 when not visible or dark. */
export function setDirectional(out: FxDirectionalLight, light: THREE.DirectionalLight): void {
  towardsLight(out.direction, light);
  const on = light.visible && light.intensity > 0;
  out.color.copy(light.color).multiplyScalar(on ? light.intensity : 0);
  out.luminance = on ? luminanceOf(light.color, light.intensity) : 0;
}

/**
 * Append a point light to `list` at `count` when it shines (visible, intensity above 0) and there is
 * room; its position from its world matrix. Returns the new count. `cell` is the building cell a
 * room lamp belongs to, -1 otherwise.
 */
export function addPointLight(list: FxPointLight[], count: number, light: THREE.PointLight, cell = -1): number {
  if (count >= list.length || !light.visible || !(light.intensity > 0)) return count;
  const p = list[count];
  p.position.setFromMatrixPosition(light.matrixWorld);
  p.color.copy(light.color).multiplyScalar(light.intensity);
  p.luminance = luminanceOf(light.color, light.intensity);
  p.distance = light.distance;
  p.decay = light.decay;
  p.cell = cell;
  return count + 1;
}

/** Take a spot light, or clear the slot (luminance 0) for null, hidden or dark. coneCos = cos(angle), penumbraCos = cos(angle x (1 - penumbra)). */
export function setSpotLight(out: FxSpotLight, light: THREE.SpotLight | null): void {
  if (!light || !light.visible || !(light.intensity > 0)) {
    clearPoint(out);
    out.direction.copy(UP);
    out.coneCos = 1;
    out.penumbraCos = 1;
    return;
  }
  out.position.setFromMatrixPosition(light.matrixWorld);
  towardsLight(out.direction, light);
  out.color.copy(light.color).multiplyScalar(light.intensity);
  out.luminance = luminanceOf(light.color, light.intensity);
  out.distance = light.distance;
  out.decay = light.decay;
  out.cell = -1;
  out.coneCos = Math.cos(light.angle);
  out.penumbraCos = Math.cos(light.angle * (1 - light.penumbra));
}

/** What `fillCascades` needs of a shadow map: its depth texture, compare-mode under PCF. */
interface ShadowMapLike {
  depthTexture?: { compareFunction?: THREE.DepthTexture['compareFunction'] | null } | null;
}

/**
 * Take the cascades' shadow maps. `count` is FX_MAX_CASCADES only when the renderer's shadow map is
 * enabled and every light casts and has `shadow.map.depthTexture` with a compare function (PCF);
 * otherwise count 0 and every map null, so a disposed or non-compare texture is never handed on.
 * `breaks` are CSM's: cascade i covers [breaks[i-1] ?? 0, breaks[i]) of `range`. `fade` is CSM's own.
 */
export function fillCascades(out: FxCascades, renderer: { shadowMap: { enabled: boolean } }, lights: readonly THREE.DirectionalLight[], breaks: readonly number[], range: number, fade = false): void {
  out.count = 0;
  for (let i = 0; i < out.maps.length; i++) out.maps[i] = null;
  out.range = range > 0 ? range : 1;
  out.fade = fade;
  let ok = renderer.shadowMap.enabled && lights.length >= FX_MAX_CASCADES && breaks.length >= FX_MAX_CASCADES;
  for (let i = 0; ok && i < FX_MAX_CASCADES; i++) {
    const l = lights[i];
    const map = l.shadow.map as ShadowMapLike | null;
    if (!l.castShadow || !map || !map.depthTexture || !map.depthTexture.compareFunction) ok = false;
  }
  if (!ok) return;
  for (let i = 0; i < FX_MAX_CASCADES; i++) {
    const l = lights[i];
    const s = l.shadow;
    out.maps[i] = (s.map as unknown as { depthTexture: THREE.Texture }).depthTexture;
    out.matrices[i].copy(s.matrix);
    out.params[i * 4] = s.bias;
    out.params[i * 4 + 1] = s.normalBias;
    out.params[i * 4 + 2] = s.intensity;
    out.params[i * 4 + 3] = 0;
    out.ranges[i * 2] = i > 0 ? breaks[i - 1] : 0;
    out.ranges[i * 2 + 1] = breaks[i];
  }
  out.count = FX_MAX_CASCADES;
}
