// The moving air's GPU side (the design's §2.3-§2.8): the window that follows the camera, slab 0's air solved on a
// fixed clock, the dust it carries advected every frame, the light pass toward the sun, the obstacles, the CPU rasters
// uploaded, and the one interface the volume reads it all through (`AirSource`).
//
// **The frame** (§2.4): `update` is called once a frame by the world right after the weather's view half, with this
// frame's camera. It places the window (snapped to whole cells; a jump resets every field to its inflow), fills the
// rasters' strips, gathers and draws the obstacles, reads the engines, and then -- only while something reads the air
// (the volume, with Effects on) -- runs the solver's fixed steps (60 Hz, 30 on Low, at most 3 a frame), the light pass
// after them, and the dust every frame by the frame's own `dt`, so nothing judders at 144 Hz. It saves and puts back
// the render target, `autoClear` and the clear colour and alpha, in a `finally`.
//
// **Nothing here is built in play** (rule 2): every material is made with the field, compiled behind the arrival's
// loading screen (`warm`), and kept; a quality dial resizes targets (class T) and never disposes a material, since
// three releases a program with its last material and the next draw would build it again on a live frame. A setting
// that cannot run (no float targets) refuses with a reason and the game goes on.
//
// It is cosmetic and this screen's own (rule 3): nothing that decides damage or a body's state ever reads it back.
import * as THREE from 'three';
import { createFxQuad, FX_CAMERA } from '../../core/fx/pass.ts';
import { AIR_TUNE } from './airTune.ts';
import { AIR_DRAW, AirDrawer, compileAirMaterial } from './airDraw.ts';
import { atlasLayout, MAX_TILES, tileRects } from './airAtlas.ts';
import { airFrameNumbersIn, dustDecayFrame, dustLawIn, dustShapeStep, fixedStepsIn, smokeStep, newAirFrameNumbers, newDustLaw, newSandPhase, newStormEase, sandJitter, sandPhaseIn, sandStrength, shapeFloor, stormEaseIn, tickClockIn, tintedColourIn, type AirFrameNumbers, type DustLaw, type FixedClock, type SandPhase, type ShapeTexel, type StormEase, type TickClock } from './airMath.ts';
import { AirForces, DUST_BATCH, SMOKE_BATCH, SPLAT_BATCH, type ForceCounts } from './airForces.ts';
import { pushEngines, type AirHull, type ShuttleJets } from './airEngines.ts';
import type { NearRides } from '../../net/nearRides.ts';
import { grassAirOff, grassLeanIn, newGrassLean, type GrassAirUniforms } from './airGrass.ts';
import { AirRaster, MEDIUM_BYTE, type GroundSampler } from './airRaster.ts';
import { AirObstacles, type SolidBoxSource } from './airObstacles.ts';
import { newWindow, PLACE, placeWindowIn, type WindowPlace } from './fluidWindow.ts';
import { ADVECT_FRAGMENT, AIR_VERTEX, BANDS_FRAGMENT, DIV_FRAGMENT, DUST_FRAGMENT, FILL_DUST_FRAGMENT, FILL_FRAGMENT, GRAD_FRAGMENT, JACOBI_FRAGMENT, LIGHT_FRAGMENT, OFFSETS_FRAGMENT, SMOKE_FRAGMENT, SPLAT_FRAGMENT, VORT_FRAGMENT } from './airShaders.ts';
import { AirDents, DENT_KIND, placeDentSquareIn, type DentCounts } from './airDents.ts';
import { copyAirGround, type AirGroundUniforms } from './airGround.ts';
import { fillLayerResponse } from './groundResponse.ts';
import { lightDepthAt, lightMarchFor, lightMarchIn, type LightMarchAsk, type LightSample } from './airLight.ts';
import { newSandPicture, SAND_ROWS_A_FRAME, SAND_SIZE, sandPictureRows, type SandPicture } from './airSand.ts';
import { KEEP_TABLE, NOISE_LAYERS_A_FRAME, NOISE_SIZE as NOISE3_SIZE, keepTable, newNoiseVolume, newWispPhase, noiseLayers, wispPhaseIn, type NoiseVolume, type WispPhase } from './airNoise.ts';
import { KickPool, newKickLight, type KickLight } from './airParticles.ts';
import { RainPool, type RainHull } from './airRain.ts';
import { KICK_KIND, KICK_KINDS, KICK_LOOK, leafyClass, OwedTable, packColour, SpawnTable, WHITE_PACKED } from './airSpawn.ts';
import { srgbDecode, tintGamma } from '../groundMath.ts';
import { WEATHER_UNIFORMS } from '../wetness.ts';
import { PRINT_TUNE } from '../footprints.ts';
import type { FootStep } from '../../audio/footsteps.ts';
import { liquidTileCells, type VolTune } from './volSettings.ts';
import { crustPhaseIn, liquidOff, newCrustPhase, RippleCarryPass, type LiquidUniforms } from './airLiquid.ts';
import { WIND_FRAME, WIND_LOCAL_DEVIL, WIND_STATE, WIND_TUNE, wind7Uniforms, windPattern } from '../wind.ts';
import { DEVIL_W, gustFlat, newGustAt } from '../windMath.ts';

/**
 * Everything the volume reads of the air, by reference (§2.8): the kept uniform objects whose `value` is each field's
 * current texture (rewritten in place when a target is swapped), the window, the band of air, the storm, the ridden
 * hull's box. The one interface the Light and shadow pass's volume will read too.
 */
export interface AirSource {
  readonly dust: { value: THREE.Texture | null };
  /**
   * The shape the dust carries (from wave 2b): the dust pair's second attachment, rewritten in place at every
   * swap, premultiplied by the density -- D·μ, D·(σ² + μ²), D·w, D·age (the design's §2.14).
   */
  readonly shape: { value: THREE.Texture | null };
  /** The light toward the sun: from wave 2b an optical depth at each of four heights over the ground (`lightHeights`). */
  readonly light: { value: THREE.Texture | null };
  readonly height: { value: THREE.Texture | null };
  readonly obstacles: { value: THREE.Texture | null };
  /** ox, oz, size, cell. */
  readonly window: { value: THREE.Vector4 };
  /** What the light texture still owes of the window's moves, in window uv. */
  readonly lightShift: { value: THREE.Vector2 };
  /** The window's lowest and highest known ground, and its mean, metres. */
  readonly band: { value: THREE.Vector3 };
  /** The storm's dust outside the window (a density, laid at the storm's weight from wave 2b), and its spread, metres (its half-normal's σ). */
  readonly inflow: { value: THREE.Vector2 };
  /** The storm's dust colour, linear, eased toward the window's own shedding ground (from wave 2b). */
  readonly stormColour: { value: THREE.Color };
  /** The light pass is on (1) or the volume reads a transmittance of one (0). */
  readonly lightOn: { value: number };
  /** The four heights over the ground the light's four channels were taken at, metres, lowest first. */
  readonly lightHeights: { value: THREE.Vector4 };
  /**
   * The dust's look for the march (from wave 2b): x how bright it is drawn (`volDustBright`), y the debug view
   * (0 none, 1 the carried colour, 2 its height, 3 its spread, 4 its age), z the band's top over the ground (`bandTop`),
   * w the thinnest a patch is (`dust.spreadMin`).
   */
  readonly look: { value: THREE.Vector4 };
  /**
   * The top of the band the march looks in, metres over the ground: the highest any lift queued in the last
   * `airborneFor` seconds will stand and the storm's, never under four of H₀, never over `volume.above` (the design's
   * §2.14).
   */
  readonly bandTop: number;
  /** The box the weather keeps rain out of (the hull the player rides or stands in): world to its frame, and its half sizes; w 0 for none. */
  readonly hullInverse: { value: THREE.Matrix4 };
  readonly hullBox: { value: THREE.Vector4 };
  /** Whether anything is airborne: a source lifted dust in the last `airborneFor` seconds, or the storm is up. */
  hasAir(): boolean;
  /**
   * Whether the field carried its dust this frame (stepping, with the moving air and the dust on). The volume draws
   * nothing from a field that did not: its dust texture would be the last one carried, frozen where the switch was
   * thrown (or sliding with the window), and the storm sheets would be thinned for a picture the air no longer makes.
   */
  readonly dustLive: boolean;
  /** Written by the volume pass each frame it draws (the storm sheets' thinning reads it a frame later). */
  volumeDrew: boolean;
  /** Written by the volume pass each frame it draws: its amount over the picture (the third wave's puffs rule reads it). */
  volumeAmount?: number;
  /** One of the fields by name, as it stands now, for the debug view (`__debug.air({ view })`); null for none. */
  debugTexture(name: string): THREE.Texture | null;
  /**
   * The third wave's, every one by reference. Smoke and fog: a smoke a slab and the fog (RGBA32F), and the smoke's colour
   * premultiplied by its sum; whether the field carried them this frame (`smokeLive`, the volume reads none it did not);
   * the dust's tiles (one, or three with a field a layer) and half a texel of one in its own uv.
   */
  readonly smokeField: { value: THREE.Texture | null };
  readonly smokeTint: { value: THREE.Texture | null };
  readonly smokeLive: boolean;
  readonly dustTiles: { value: THREE.Vector2 };
  /** The velocity atlas as it stands, and how each slab is read out of it (`slabVelAt`'s uniforms), for the wisps. */
  readonly velocity: { value: THREE.Texture | null };
  readonly slabTiles: { value: THREE.Vector4[] };
  readonly slabScale: { value: THREE.Vector4 };
  readonly slabShare: { value: THREE.Vector4 };
  readonly atlasHalf: { value: THREE.Vector2 };
  /** The wind, m/s in world XZ (a velocity read outside the window is it times the slab's share). */
  readonly wind: { value: THREE.Vector2 };
  /** Slab 0's and 1's tops (the slab a height stands in), and the slabs' middles with the band's top (`smokeAt`). */
  readonly slabTop: { value: THREE.Vector2 };
  readonly slabMid: { value: THREE.Vector4 };
  /**
   * The fog: x the hour's top over the ground, metres; y whether the fog is carried (1) or not; z the top's noise scale
   * (noise cells a metre, read from the gust noise, `noise2`); w the hour's level. `fogDrift` is the top noise's drift
   * along the wind, noise cells, kept within the noise's repeat.
   */
  readonly fog: { value: THREE.Vector4 };
  readonly fogDrift: { value: THREE.Vector2 };
  readonly noise2: { value: THREE.Texture | null };
  /**
   * The wisps: the noise volume (null until made whole), the bands (Medium's road; null otherwise), the mode in force (0
   * off, 1 bands, 2 noise, 3 noise ×2: which march material the volume draws with), the flow's numbers (`uWispA` scale,
   * stretch, period, the second octave's share; `uWispB` the two phases and the cross-fade, the age term's seconds; `uWispC`
   * erode, erodeFull, keepColumn, keepFloor), and the expected-keep table.
   */
  readonly noise3: { value: THREE.Texture | null };
  readonly bands: { value: THREE.Texture | null };
  readonly wispMode: number;
  readonly wispA: { value: THREE.Vector4 };
  readonly wispB: { value: THREE.Vector4 };
  readonly wispC: { value: THREE.Vector4 };
  readonly keepTable: { value: Float32Array };
  /** What the march shows in place of the in-scatter for the third wave's views: 0 none, 1 smoke, 2 fog, 3 the wisps' keep. */
  readonly airView: number;
  /**
   * The fourth wave's, by reference: the velocity atlas's pending scroll (window uv) a frame that took no fixed step still
   * owes it, as the dust reads it (`velocity` above is the atlas itself); the ground class raster (R8, the class's index,
   * nought unknown or a liquid); and `live`, true on a frame the field ran its update (the velocity texture current, W1's
   * meaning of stepped), never "a fixed step fell this frame".
   */
  readonly velShift: { value: THREE.Vector2 };
  readonly klass: { value: THREE.Texture | null };
  readonly live: boolean;
}

/**
 * What measure reads of the ground's marks (the second wave): from wave 2b the blowing sand's two phases (the
 * largest offset of either, and the share of the window where the sand blows at all, its strength by the shader's own
 * rule over a twentieth of a metre a second), the dents, and at each point the largest offset and the deepest dent.
 */
export interface GroundMeasure {
  offsets: { peak: number; moved: number; peakAt: [number, number] | null; blowing: number; carried: number } | null;
  dents: { peak: number; total: number; pressed: number; peakAt: [number, number] | null } | null;
  ground: { x: number; z: number; offset: number | null; dent: number | null }[];
}

/**
 * What measure reads at a point: the most dust within the radius and, at that texel (from wave 2b), the mean
 * height, spread and age it carries and its carried colour (`rgb / a`, linear); the light toward the sun at the ground
 * (`exp(−τ(0))`) and its optical depth at the four heights; what the ground there sheds, and its medium.
 */
export interface MeasurePoint {
  x: number;
  z: number;
  dust: number | null;
  mu: number | null;
  sigma: number | null;
  age: number | null;
  colour: [number, number, number] | null;
  light: number | null;
  tau: number[] | null;
  shed: number;
  medium: string;
}

/**
 * Smoke and fog read back (the third wave): each slab's smoke summed over the window and its peak, the fog's sum, peak and
 * the share of the window it stands past a tenth over, and where the smoke and the fog peak.
 */
export interface SmokeMeasure {
  slabs: [number, number, number];
  smokePeak: number;
  smokeAt: [number, number] | null;
  fogTotal: number;
  fogPeak: number;
  fogAt: [number, number] | null;
  fogged: number;
  /** The fog's own middle (the fog-weighted mean place), null with none. */
  fogMiddle: [number, number] | null;
  /**
   * The fog over the window's lowest and highest quarter of known ground (the raster's own cells, each the mean of the fog
   * texels in it): pooling shows as `hollow` over `rise`.
   */
  hollow: number | null;
  rise: number | null;
  /** The fog on a coarse 16 by 16 grid over the window, row by row (+Z rows, +X columns), for comparing two reads. */
  fogGrid: number[];
  /** The fog at each asked point (the most within the radius), and the smoke's three slabs there. */
  at: { x: number; z: number; fog: number | null; smoke: [number, number, number] | null }[];
}

/** The dust's shape read back (from wave 2b): the mass-weighted mean height and spread over the window, the highest mean and where, and the ages. */
export interface ShapeMeasure {
  mu: number;
  sigma: number;
  highest: number;
  highestAt: [number, number] | null;
  youngest: number | null;
  oldest: number | null;
}

/** What the world tells the field each frame, a kept record. */
export interface AirFrameInput {
  dt: number;
  simulate: boolean;
  camX: number;
  camY: number;
  camZ: number;
  windHeading: number;
  windSpeed: number;
  /** The weather's dust, 0 to 1 (0 with the weather off). */
  storm: number;
  /** Toward the sun, unit. */
  sunX: number;
  sunY: number;
  sunZ: number;
  /** Seconds of the world's own clock, for the gusts' drift. */
  time: number;
  /** Something reads the air this frame (the volume with Effects on, or the ground wearing the air's variant): with nothing reading it, the rasters are kept and nothing is stepped. */
  reading: boolean;
  /** The ground wears the air's variant this frame (the second wave): the carried offsets and the dents are kept only then. */
  ground: boolean;
  /** Why the air does nothing here (in space, in the world of copies, indoors), or null. */
  where: string | null;
  /**
   * The fog the hour brings (the third wave, `airFog.ts`): the level `F(t)` the inflow's bank and the ground's emission go
   * by (nought on a day the world's draw says is clear, or a world with no row), how far the morning's fog has burnt off
   * (0 to 1), and the top it fills to over the ground, metres. Worked out by the world from the shared day.
   */
  fogLevel: number;
  fogBurn: number;
  fogTop: number;
}

export function newAirFrameInput(): AirFrameInput {
  // The fog's numbers take a fraction first so each is a double from its first write, then nought: no fog until told.
  const r: AirFrameInput = { dt: 0, simulate: true, camX: 0, camY: 0, camZ: 0, windHeading: 0, windSpeed: 0, storm: 0, sunX: 0, sunY: 1, sunZ: 0, time: 0, reading: false, ground: false, where: null, fogLevel: 0.5, fogBurn: 0.5, fogTop: 0.5 };
  r.fogLevel = 0;
  r.fogBurn = 0;
  r.fogTop = 0;
  return r;
}

/** What the world gives the field to read: the ground, the solid boxes and the hulls. */
export interface AirWorld {
  ground: GroundSampler;
  boxes: SolidBoxSource | null;
  hulls: readonly AirHull[];
  /**
   * The session ground material's own tint uniforms (`groundTileUniforms()`'s `uGroundTint` and `uGroundTintRef`), held
   * by the dust pass by reference so it takes the colour map's tint in the drawn ground's own mode (from wave 2b);
   * a field given none keeps its own at a tint of one (the tests', the console's).
   */
  groundTint?: { uGroundTint: { value: THREE.Vector4 }; uGroundTintRef: { value: THREE.Vector4 } };
  /**
   * The weather's own particle uniforms the rain's draw discards by (its kill slack and the ridden hull's box), by
   * reference (the fourth wave); a field given none keeps its own, which keep nothing out (the tests', the console's).
   */
  rainHull?: RainHull;
  /**
   * The sixth wave's, kept records the world refills before each frame: other players' rides drawn near the camera
   * (`RemotePlayers.nearRides`) and the stood shuttles' engines lit now (`ShuttleRigs.jetsInto`). None for a field
   * given neither (the tests', the console's).
   */
  rides?: NearRides;
  jets?: ShuttleJets;
}

type Pair = [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];

const NOISE_SIZE = 128;
const DEG = Math.PI / 180;

/** A tileable value-noise texture, one lattice cell a texel, read with linear filtering and repeat: the gusts' noise. */
function noiseTexture(): THREE.DataTexture {
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE);
  let s = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    // A small LCG, the same every session, so the gusts do not change from one load to the next.
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = s >>> 24;
  }
  const t = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  t.name = 'air.noise';
  return t;
}

/**
 * A field's target; `count` 2 makes it two textures one draw writes (the dust's colour and its shape, from the third
 * wave), each named `name` and its index, `textures[0]` being `texture` as three has it.
 */
function fieldTarget(w: number, h: number, format: THREE.PixelFormat, type: THREE.TextureDataType, name: string, count = 1): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    format,
    type,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    count,
  });
  t.texture.name = name;
  for (let i = 1; i < t.textures.length; i++) t.textures[i].name = `${name}.${i}`;
  return t;
}

function dataTexture(data: Float32Array | Uint8Array, n: number, format: THREE.PixelFormat, type: THREE.TextureDataType, name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, format, type);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  t.name = name;
  return t;
}

/** A pass's material; `glsl3` for one that writes outputs of its own (`layout(location = n) out`), as the dust pass does from wave 2b. */
function material(name: string, fragment: string, uniforms: Record<string, THREE.IUniform>, glsl3 = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    vertexShader: AIR_VERTEX,
    fragmentShader: fragment,
    uniforms,
    blending: THREE.NoBlending,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    ...(glsl3 ? { glslVersion: THREE.GLSL3 } : {}),
  });
}

/** A one-texel grey picture the sand's lookup reads until its own picture is whole (a texture swap, never a program). */
function sandStandIn(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  t.name = 'air.sand.standIn';
  return t;
}

/** The renderer state the step puts back. */
interface Saved {
  target: THREE.WebGLRenderTarget | null;
  autoClear: boolean;
  alpha: number;
  colour: THREE.Color;
}

export class AirField implements AirSource {
  readonly dust = { value: null as THREE.Texture | null };
  readonly shape = { value: null as THREE.Texture | null };
  readonly light = { value: null as THREE.Texture | null };
  readonly height = { value: null as THREE.Texture | null };
  readonly obstacles = { value: null as THREE.Texture | null };
  readonly window = { value: new THREE.Vector4(0, 0, 192, 1.5) };
  readonly lightShift = { value: new THREE.Vector2() };
  readonly band = { value: new THREE.Vector3() };
  readonly inflow = { value: new THREE.Vector2(0, 2.256) };
  readonly stormColour = { value: new THREE.Color(0.6, 0.45, 0.3) };
  readonly lightOn = { value: 1 };
  readonly lightHeights = { value: new THREE.Vector4(AIR_TUNE.light.h0, AIR_TUNE.light.h1, AIR_TUNE.light.h2, AIR_TUNE.light.h3) };
  readonly look = { value: new THREE.Vector4(0.6, 0, 7.2, AIR_TUNE.dust.spreadMin) };
  /** The band's top (`AirSource.bandTop`), a fraction from the start so it is a double from its first write. */
  bandTop = 7.2;
  /**
   * The debug view the march draws in place of the in-scatter (`air({ view })`): 0 none, 1 the carried colour, 2 its
   * height, 3 its spread, 4 its age; and the blowing sand's own view on the ground (`air({ view: 'sand' })`).
   */
  dustView = 0;
  sandView = false;
  readonly hullInverse = { value: new THREE.Matrix4() };
  readonly hullBox = { value: new THREE.Vector4() };
  volumeDrew = false;
  /** Written by the volume pass each frame it draws: its amount over the picture (the gas cloud's puffs read it). */
  volumeAmount = 0.5;
  /** Whether the volume drew last frame, kept at the top of each update before the world clears `volumeDrew`. */
  private drewLastFrame = false;
  /** Set by `update` once the dust pass has drawn this frame, cleared at the top of every update (`AirSource.dustLive`). */
  dustLive = false;
  // The third wave's (`AirSource`): smoke and fog, the slabs as the field's own passes read them, the fog's top, the wisps.
  readonly smokeField = { value: null as THREE.Texture | null };
  readonly smokeTint = { value: null as THREE.Texture | null };
  smokeLive = false;
  readonly dustTiles = { value: new THREE.Vector2(1, 0.5 / 512) };
  readonly velocity = { value: null as THREE.Texture | null };
  readonly slabTiles = { value: [new THREE.Vector4(0, 0, 1, 1), new THREE.Vector4(0, 0, 1, 1), new THREE.Vector4(0, 0, 1, 1)] };
  readonly slabScale = { value: new THREE.Vector4(1, 1, 1, 1) };
  readonly slabShare = { value: new THREE.Vector4(AIR_TUNE.slabs.windShare, AIR_TUNE.slabs.windShare1, AIR_TUNE.slabs.windShare2, 0) };
  readonly atlasHalf = { value: new THREE.Vector2(0.5 / 128, 0.5 / 128) };
  readonly wind = { value: new THREE.Vector2() };
  readonly slabTop = { value: new THREE.Vector2(AIR_TUNE.slabs.ceiling, AIR_TUNE.slabs.ceiling1) };
  readonly slabMid = { value: new THREE.Vector4(AIR_TUNE.slabs.centre, AIR_TUNE.slabs.centre1, AIR_TUNE.slabs.centre2, AIR_TUNE.slabs.ceiling2 + 2) };
  readonly fog = { value: new THREE.Vector4() };
  readonly fogDrift = { value: new THREE.Vector2() };
  readonly noise2 = { value: null as THREE.Texture | null };
  readonly noise3 = { value: null as THREE.Texture | null };
  readonly bands = { value: null as THREE.Texture | null };
  /** The wisps' mode in force (the march material the volume draws with): the setting's, or off while the noise is not made. */
  wispMode = 0;
  readonly wispA = { value: new THREE.Vector4(AIR_TUNE.wisps.scale, AIR_TUNE.wisps.stretch, AIR_TUNE.wisps.period, AIR_TUNE.wisps.octave) };
  readonly wispB = { value: new THREE.Vector4(0.5, 0.5, 0.5, AIR_TUNE.wisps.ageWisp) };
  readonly wispC = { value: new THREE.Vector4(AIR_TUNE.wisps.erode, AIR_TUNE.wisps.erodeFull, AIR_TUNE.wisps.keepColumn, AIR_TUNE.wisps.keepFloor) };
  readonly keepTable = { value: new Float32Array(KEEP_TABLE).fill(1) };
  /** The third wave's views in the march: 0 none, 1 smoke, 2 fog, 3 the wisps' keep (`air({ view })`). */
  airView = 0;
  // The fourth wave's (`AirSource`): the air's pending scroll, the class raster, whether the field ran its update.
  readonly velShift = { value: new THREE.Vector2() };
  readonly klass = { value: null as THREE.Texture | null };
  live = false;
  /**
   * What the air carries besides dust (the fourth wave, `airParticles.ts`, `airRain.ts`): the kick-up pool and the rain,
   * made with the field (their materials at once, their targets in `ensureTargets`), the frame's spawn records the
   * sources write (`forces.spawns`, while the particles are on), what each continuous source is owed between frames, and
   * the sky's light both read (written by the world each frame).
   */
  readonly kick: KickPool;
  readonly rain: RainPool;
  readonly spawns = new SpawnTable();
  readonly owed = new OwedTable();
  readonly kickLight: KickLight = newKickLight();
  /** The class raster's texture, made with the other rasters' at their size. */
  private klassTex: THREE.DataTexture | null = null;
  /** The kick-up pool's draws' own `draw` (the field's drawer), and the bodies whose running feet kick leaves and spray. */
  private readonly kickDraw = (m: THREE.ShaderMaterial, t: THREE.WebGLRenderTarget): void => this.drawer.draw(m, t);
  /** Each body's last step for the kick-up's feet: its key (NaN none), place and moment, sixty-four bodies at most. */
  private readonly feetKey = new Float64Array(64).fill(Number.NaN);
  private readonly feetX = new Float64Array(64);
  private readonly feetZ = new Float64Array(64);
  private readonly feetT = new Float64Array(64).fill(-Infinity);
  /** The kick-up's feet: steps handed over since the console last asked, and those that kicked anything up. */
  readonly kickFeetCounts = { steps: 0, kicked: 0 };

  /** The force API (§2.10): every caller writes here. */
  readonly forces = new AirForces();
  /**
   * The console's movable engine (`__debug.air({ engine })`, the demos' own): a nozzle standing where it was put, read
   * into the engines' table every frame like a hull's until it is taken away, standing still unless given the velocity
   * of a machine it rides (`vx`, `vz`: the fourth wave's wake and a skim's bite read it). Null for none.
   */
  testEngine: { x: number; y: number; z: number; dx: number; dy: number; dz: number; exit: number; vx?: number; vz?: number } | null = null;
  readonly raster = new AirRaster();
  readonly win = newWindow();
  /** Why the field cannot run on this machine (no float targets), or null. */
  readonly refused: string | null;
  /** Why the field did nothing last frame, or null when it stepped. */
  why: string | null = 'not yet stepped';

  private readonly renderer: THREE.WebGLRenderer;
  private readonly tune: VolTune;
  private readonly drawer: AirDrawer;
  private readonly obstacleMap: THREE.WebGLRenderTarget;
  private readonly obs: AirObstacles;
  private readonly home: THREE.WebGLRenderTarget;
  private readonly noise: THREE.DataTexture;
  private vel: Pair | null = null;
  private prs: Pair | null = null;
  private div: THREE.WebGLRenderTarget | null = null;
  private dustPair: Pair | null = null;
  private lightTarget: THREE.WebGLRenderTarget | null = null;
  /**
   * The ground's carried offsets, an RGBA32F pair (the second wave): made with the field's other targets. Float32, where the
   * design had half floats: in a steady drift an offset grows to the window's own size (the upwind edge's pattern smeared
   * downwind, measured at 141 m on Tatooine's dunes), where a half float's step is 12.5 cm and a frame's carry a few
   * millimetres, so the drift stalled by the frame rate (`airMath.test.ts` shows it).
   */
  private offsetsPair: Pair | null = null;
  private heightTex: THREE.DataTexture | null = null;
  private responseTex: THREE.DataTexture | null = null;
  private colourTex: THREE.DataTexture | null = null;
  /** The colour map's own bytes a cell (wave 2b's tint raster), which the dust pass tints its colour by. */
  private tintTex: THREE.DataTexture | null = null;
  /** The response raster's and the colour raster's textures as kept uniform objects, which the dents' fade reads (and, the colour's and the tint's, the particles' pickups). */
  private readonly responseU = { value: null as THREE.Texture | null };
  private readonly colourU = { value: null as THREE.Texture | null };
  private readonly tintU = { value: null as THREE.Texture | null };
  private readonly mats: Record<'splat' | 'vort' | 'div' | 'jacobi' | 'grad' | 'advect' | 'dust' | 'light' | 'fill' | 'fillDust' | 'offsets' | 'smoke' | 'bands', THREE.ShaderMaterial>;
  /**
   * Smoke and fog (the third wave): an RGBA32F pair of two textures (a smoke a slab and the fog; the smoke's colour
   * premultiplied by its sum), held at a texel across while both are off; the wisps' bands (RGBA8 at the dust's size, only
   * in the bands mode, a texel across otherwise); the noise volume, made once a session with the master on, a slice a frame
   * in play, uploaded only once whole.
   */
  private smokePair: Pair | null = null;
  private bandsTarget: THREE.WebGLRenderTarget | null = null;
  private noiseVol: NoiseVolume | null = null;
  private noiseTex: THREE.Data3DTexture | null = null;
  private readonly wispPhase: WispPhase = newWispPhase();
  /** The erosion's full point the keep table was last worked out for (the table follows `wisps.erodeFull`). */
  private keepFor = -1;
  /** What the smoke still owes of the window's moves, in window uv; when smoke was last laid (`hasAir`). */
  private readonly smokeShift = new THREE.Vector2();
  private lastSmoke = -Infinity;
  /** When the hour last brought fog (`hasAir` holds the march on for `fog.linger` after it, while what came thins away). */
  private lastFog = -Infinity;
  /** The fog patches' drift along the wind, noise cells at `fog.patchScale`, kept within the noise's own repeat. */
  private fogDriftX = 0.5;
  private fogDriftZ = 0.5;
  /** The smoke and fog pass's numbers, in vectors (no number written into a uniform object). */
  private readonly smokeP = new THREE.Vector4(1 / 60, 0.5, 0.5, 0.5);
  private readonly fogP = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  private readonly fogQ = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  private readonly fogR = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /** The densest the drainage piles fog to (`fog.poolMost`). */
  private readonly fogS = new THREE.Vector4(AIR_TUNE.fog.poolMost, 0, 0, 0);
  private readonly slabFloor = new THREE.Vector4(0, AIR_TUNE.slabs.floor1, AIR_TUNE.slabs.floor2, 0);
  /** The dust pass's third-wave numbers: its tiles and half texel, the slabs' tops; the streamers'. */
  private readonly dustR = new THREE.Vector4(1, 0.5 / 512, AIR_TUNE.slabs.ceiling, AIR_TUNE.slabs.ceiling1);
  private readonly streamP = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  private readonly streamQ = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /** The light pass's smoke and fog: their extinctions times the self-shadow, the fog's top, whether either is in the air. */
  private readonly lightR = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /** What the sand in the air keeps over a frame, and its lift's soft step. */
  private readonly sandC = new THREE.Vector4(0.5, 20, 0, 0);
  /** The tile count every solver stage reads (the layers of air solved, and the liquid's tile where there is one). */
  private readonly tileCount: { value: number };
  /** How many of the tiles are the air's slabs (the liquid's tile, where there is one, is the last): the coupling's count. */
  private readonly slabCount = { value: 1 };
  /**
   * The liquid's tile (the fifth wave, the design's §2.9): its cells a side (nought for none: the current and the lava
   * both off), its numbers in vectors the frame writes in place, the flow raster's texture, the session's record this
   * field writes while it is the world's (`bindLiquid`), the console's view, the crust's two phases, and the ripples'
   * carry (`RippleCarryPass`, made once with the field; the world hangs it on the ripples).
   */
  private liquidCells = 0;
  private readonly liquidP = new THREE.Vector4(AIR_TUNE.liquid.waterRelax, AIR_TUNE.liquid.waterDiss, AIR_TUNE.liquid.lavaRelax, AIR_TUNE.liquid.lavaDiss);
  private readonly liquidQ = new THREE.Vector4(AIR_TUNE.liquid.waterWind, 0.5, 0.5, 0.5);
  private readonly liquidR = new THREE.Vector4(AIR_TUNE.liquid.push, AIR_TUNE.liquid.ribbonFlow, AIR_TUNE.solver.liquidCap, 0.5);
  private flowTex: THREE.DataTexture | null = null;
  private readonly flowU = { value: null as THREE.Texture | null };
  private liquidBound: LiquidUniforms | null = null;
  /** The console's view on the liquids (0 none, 1 the current on the water, 2 the crust's carry on the lava). */
  liquidView = 0;
  private readonly crust = newCrustPhase();
  readonly carry = new RippleCarryPass();
  /** The dust's laws worked out once a frame (`dustLawIn`), and the vectors the pass reads them through. */
  private readonly law: DustLaw = newDustLaw();
  private readonly dustLaw = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  private readonly dustLawB = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /** The light pass's numbers beside `lightP` (the k, the storm's spread, one over the sun's sine, the thinnest spread) and its four heights. */
  private readonly lightQ = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  private readonly lightM: LightMarchAsk = { sunX: 0.5, sunZ: 0.5, step: 0.5, slant: 0.5, rise: 0.5, steps: 26, k: 0.5, inflow: 0.5, stormSigma: 0.5, invSin: 0.5, size: 192, heights: [0, 2, 5, 10], elevation: 0.5 };
  /** The blowing sand's two phases (`sandPhaseIn`), and where each phase's picture stands since its restart. */
  private readonly phase: SandPhase = newSandPhase();
  private readonly jitter = { x: 0.5, y: 0.5 };
  /** The blowing sand's picture: made whole behind a loading screen (`warm`) or a slice a frame in play (`sandSlice`), a grey stand-in until then. */
  private sandPic: SandPicture | null = null;
  private sandTex: THREE.DataTexture | null = null;
  private readonly sandStand = sandStandIn();
  /** The storm's colour eased toward the window's own (`stormEaseIn`), when it last read the window, and its scratch. */
  private readonly storm: StormEase = newStormEase();
  private stormReadAt = -1e9;
  private readonly tinted: [number, number, number] = [0.5, 0.5, 0.5];
  /** The highest band top a lift queued, and when (the band the march looks in, `bandTop`). */
  private liftTopKept = 0.5;
  private liftTopAt = -1e9;
  private readonly quad: THREE.Mesh;
  /** Each field's size now, so a dial that moves one is a resize and nothing else. */
  private sized = { cells: 0, dust: 0, light: 0, sand: 0, layers: 0, tiles: 0, smoke: 0, bands: 0, liquid: 0 };
  private needsFill = true;
  /** The offsets alone were made again at a new size and start at rest at the next frame that steps (`fillOffsets`). */
  private sandFill = false;
  /** Smoke and fog alone were made again at a new size and start empty at the next frame that steps. */
  private smokeFill = false;
  private readonly solverShift = new THREE.Vector2();
  private readonly dustShift = new THREE.Vector2();
  /** What the offsets still owe of the window's moves, in window uv (carried by their own pass, as the dust's are). */
  private readonly sandShift = new THREE.Vector2();
  /**
   * The dents (`airDents.ts`): null where this browser cannot blend into a float target (`EXT_float_blend`), and then the
   * prints switch greys and every footprint is today's decal.
   */
  readonly dents: AirDents | null;
  /** Whether this browser blends into float targets: without it there are no dents. */
  readonly floatBlend: boolean;
  /** The 10 Hz clock the offsets' age, the dents' stamps and their fade count on. */
  private readonly tick: TickClock = { acc: 0.05, dt: 0.5, ticks: 0 };
  /** The ticks crossed this frame, and whether the dents keep their marks this frame (`dentsLive`). */
  private frameTicks = 0;
  private dentsLive = false;
  /**
   * Every uniform the ground's air variant reads (`airGround.ts`), the field's own kept objects written in place each
   * frame: the offsets, the dents, the per-layer response lookup, the light, the window, the art dials and the dent
   * square. The variant does not read these: it reads the world's one record for the session, which the field the world
   * has taken copies into (`bindGround`), so a field made and thrown away never leaves the ground reading objects nobody
   * writes any more.
   */
  readonly ground: AirGroundUniforms;
  /** The session's record the variant reads, while this is the world's field (`bindGround`); null for a field not taken. */
  private bound: AirGroundUniforms | null = null;
  /**
   * Moved each time the targets are let go (`releaseTargets`): an in-play warm made before compiles nothing for a target
   * let go since, which three would otherwise make the storage of again where nothing frees it (`warmJob`).
   */
  private targetGen = 0;
  /** The per-layer response lookup's texture, and its bytes (four a layer), made again only when a world's layer count changes. */
  private layerTex: THREE.DataTexture | null = null;
  private layerBytes: Uint8Array = new Uint8Array(4);
  /**
   * The numbers the offsets pass takes each frame, in vectors (no number written into a uniform object): the frame, the
   * threshold, its span and the share; from wave 2b whether each phase restarted and its seconds since (`sandQ`),
   * and the inflow's own phases (`sandR`), in place of the second wave's age and heal.
   */
  private readonly sandP = new THREE.Vector4(1 / 60, 3.5, AIR_TUNE.ground.liftSpan, AIR_TUNE.ground.lift);
  private readonly sandQ = new THREE.Vector4(0, 0.5, 0, 0.5);
  private readonly sandR = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /** The bodies whose feet press dents: which foot is next and where the last print was (`dentStep`). */
  private readonly feet = new Map<number, { left: boolean; x: number; z: number; laid: boolean; seen: number }>();
  private feetSeen = 0;
  /** What the feet did since the console last asked: dents laid, decals left to today's prints and why. */
  readonly feetCounts = { dents: 0, tooSoon: 0, decal: 0, offSquare: 0, noGive: 0, offGround: 0, unknownGround: 0, indoors: 0, off: 0, full: 0 };
  /** The solver's fixed clock (`fixedStepsIn`). */
  private readonly clock: FixedClock = { acc: 0.5, dt: 0.5, rate: 60, most: 3, steps: 0 };
  /** The frame's own numbers, worked out once into a kept record (`airFrameNumbersIn`): no number crosses a call. */
  private readonly nums: AirFrameNumbers = newAirFrameNumbers();
  /** Where the window is asked to stand this frame. */
  private readonly place: WindowPlace = { camX: 0.5, camZ: 0.5, size: 192, cells: 128, jump: 0.5 };
  private readonly windXZ = { x: 0.5, z: 0.5 };
  /**
   * The numbers the passes take each step or frame, in vectors the frame writes a component of: a number written into a
   * three uniform object's `value` is a number made (that field holds textures too, so it is never a plain double),
   * while a vector's components are always numbers and are written in place.
   */
  private readonly vortP = new THREE.Vector4(22, 1 / 60, AIR_TUNE.solver.cap, AIR_TUNE.window.edge);
  private readonly jacobiP = new THREE.Vector4(1, 0, 0, 0);
  private readonly advectP = new THREE.Vector4(1 / 60, AIR_TUNE.solver.dissipation, AIR_TUNE.solver.relax, 0);
  private readonly gustTime = new THREE.Vector2(AIR_TUNE.wind.gust, 0.5);
  private readonly dustP = new THREE.Vector4(1 / 60, 1, 0.5, AIR_TUNE.dust.stormShed);
  /** The storm's dust outside (at its weight), its spread squared, how much of the ground's tint the dust takes, the storm's weight. */
  private readonly dustQ = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /** The light pass's step across, along the slant and up it, and the storm's dust outside. */
  private readonly lightP = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /**
   * The tune's numbers the programs take as plain float uniforms -- how far up and down a push reaches (`slabs.reach`),
   * the height over a slab's floor at which a solid stops it (`obstacles.over`) and slab 0's share of the wind
   * (`slabs.windShare`, which the inflow, the dust's edge and the fill all read) -- each one kept object shared by
   * every material that reads it, written from the tune at every step only when the tune has moved, so a console line
   * or a dial reaches the programs at once and a steady frame writes nothing (`syncTune`).
   */
  private readonly reachScale = { value: AIR_TUNE.slabs.reach };
  private readonly obstacleOver = { value: AIR_TUNE.obstacles.over };
  private readonly windShare = { value: AIR_TUNE.slabs.windShare };
  private readonly saved: Saved = { target: null, autoClear: true, alpha: 1, colour: new THREE.Color() };
  private readonly tiles = new Float32Array(MAX_TILES * 4);
  private readonly tileSlab = new Float32Array(MAX_TILES * 4);
  private lastLift = -Infinity;
  private worldTime = 0;
  private lightDue = true;
  private readonly world: AirWorld;
  private input: AirFrameInput = newAirFrameInput();
  /** The numbers the console reads (`report`). */
  private readonly stats = { frames: 0, steps: 0, draws: 0, cpuMs: 0, resets: 0, lastScrollX: 0, lastScrollZ: 0, stepped: false, motes: 0, grainsFlying: 0, grainsLying: 0, sheets: 1 };
  private readonly counts: ForceCounts = { engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0, fronts: 0, droppedFronts: 0, smoke: 0, droppedSmoke: 0, peers: 0, shuttles: 0, devils: 0, droppedDevils: 0 };

  constructor(renderer: THREE.WebGLRenderer, tune: VolTune, world: AirWorld) {
    this.renderer = renderer;
    this.tune = tune;
    this.world = world;
    this.volumeAmount = 0;
    this.drawer = new AirDrawer(renderer);
    this.refused = AirField.refusal(renderer);
    // Red the walls the solver and the dust stop at; green the walls and a compound's rooms, which the volume keeps its
    // dust out of (`airObstacles.ts`).
    this.obstacleMap = fieldTarget(1, 1, THREE.RGFormat, THREE.HalfFloatType, 'air.obstacles');
    this.obstacles.value = this.obstacleMap.texture;
    this.obs = new AirObstacles(this.window);
    this.home = fieldTarget(1, 1, THREE.RedFormat, THREE.HalfFloatType, 'air.home');
    this.noise = noiseTexture();
    this.forces.window = this.win;
    this.forces.raster = this.raster;
    this.noise2.value = this.noise;
    this.tileCount = { value: 1 };
    const common = {
      uWindow: this.window,
      uTiles: { value: this.tiles },
      uTileSlab: { value: this.tileSlab },
      uTileCount: this.tileCount,
      uAtlasSize: { value: new THREE.Vector2(1, 1) },
      uObstacles: this.obstacles,
      uWind: this.wind,
      uObstacleOver: this.obstacleOver,
      // The fifth wave's: the medium byte the liquid's tile is solid by, and the slabs' count the coupling counts over.
      uMedium: this.colourU,
      uSlabCount: this.slabCount,
    };
    const liquid = { uLiquidP: { value: this.liquidP }, uLiquidQ: { value: this.liquidQ }, uLiquidR: { value: this.liquidR } };
    // The unified wind's one uniform object (the seventh wave), by reference on every program that reads it: made here,
    // with the master on, never with it off; its `on` is nought until the weather's step first writes it.
    const gust = { uNoise: { value: this.noise }, uNoiseTexel: { value: 1 / NOISE_SIZE }, uGustTime: { value: this.gustTime }, uWind7: wind7Uniforms().uWind7 };
    // How the field's own passes read each slab's air out of the atlas (`slabVelAt`), shared by reference (the third wave).
    const slabVel = { uSlabTiles: this.slabTiles, uSlabScale: this.slabScale, uSlabShare: this.slabShare, uAtlasHalf: this.atlasHalf };
    const groundTint = {
      uGroundTint: world.groundTint?.uGroundTint ?? { value: new THREE.Vector4(0, 1.6, 0, 0) },
      uGroundTintRef: world.groundTint?.uGroundTintRef ?? { value: new THREE.Vector4(1, 1, 1, 1) },
    };
    this.mats = {
      splat: material('air.splat', SPLAT_FRAGMENT, { ...common, ...liquid, uVel: { value: null }, uShift: { value: new THREE.Vector2() }, uSplatA: { value: this.forces.splatA }, uSplatB: { value: this.forces.splatB }, uSplatCount: { value: 0 }, uReachScale: this.reachScale }),
      vort: material('air.vort', VORT_FRAGMENT, { ...common, ...liquid, uVel: { value: null }, uVortP: { value: this.vortP } }),
      div: material('air.div', DIV_FRAGMENT, { ...common, uVel: { value: null } }),
      jacobi: material('air.jacobi', JACOBI_FRAGMENT, { ...common, uPrs: { value: null }, uDiv: { value: null }, uJacobiP: { value: this.jacobiP }, uShift: { value: new THREE.Vector2() } }),
      grad: material('air.grad', GRAD_FRAGMENT, { ...common, uPrs: { value: null }, uVel: { value: null } }),
      advect: material('air.advect', ADVECT_FRAGMENT, { ...common, ...gust, ...liquid, uVel: { value: null }, uFlowR: this.flowU, uAdvectP: { value: this.advectP } }),
      // The dust pass (GLSL 3 from wave 2b: two outputs, the colour and its shape), holding the session ground
      // material's own tint uniforms by reference so its colour is tinted in the drawn ground's own mode; from the third
      // wave it reads each slab's air (`slabVel`), a field a layer side by side when the dust has one.
      dust: material(
        'air.dust',
        DUST_FRAGMENT,
        {
          uWindow: this.window,
          uWind: common.uWind,
          ...gust,
          ...slabVel,
          ...groundTint,
          uDust: { value: null },
          uShape: { value: null },
          uVel: { value: null },
          uObstacles: this.obstacles,
          uResponse: { value: null },
          uColour: { value: null },
          uTint: { value: null },
          uGround: this.height,
          uVelShift: { value: new THREE.Vector2() },
          uDustShift: { value: new THREE.Vector2() },
          uGroundTexel: { value: new THREE.Vector2(1, 1) },
          uObstacleOver: common.uObstacleOver,
          uDustP: { value: this.dustP },
          uDustQ: { value: this.dustQ },
          uDustLaw: { value: this.dustLaw },
          uDustLawB: { value: this.dustLawB },
          uDustR: { value: this.dustR },
          uStreamP: { value: this.streamP },
          uStreamQ: { value: this.streamQ },
          uStormColour: this.stormColour,
          uSlopeGate: { value: new THREE.Vector2(AIR_TUNE.dust.slopeFrom, AIR_TUNE.dust.slopeTo) },
          uDustBatch: { value: this.forces.dustBatch },
          uDustShapeBatch: { value: this.forces.dustShapeBatch },
          uDustCount: { value: 0 },
          uShedP: { value: this.shedP },
        },
        true,
      ),
      light: material('air.light', LIGHT_FRAGMENT, {
        uWindow: this.window,
        uDust: { value: null },
        uShape: { value: null },
        uGround: this.height,
        uSmoke: { value: null },
        uSunDir: { value: new THREE.Vector2(0, 1) },
        uSteps: { value: 26 },
        uLightP: { value: this.lightP },
        uLightQ: { value: this.lightQ },
        uLightH: this.lightHeights,
        uLightR: { value: this.lightR },
        uDustTiles: this.dustTiles,
        uSlabMid: this.slabMid,
      }),
      fill: material('air.fill', FILL_FRAGMENT, { uValue: { value: new THREE.Vector4() } }),
      fillDust: material('air.fillDust', FILL_DUST_FRAGMENT, { uValue: { value: new THREE.Vector4() }, uShapeValue: { value: new THREE.Vector4() } }, true),
      // The blowing sand's two phases and (the third wave) the sand carried in the air: two outputs, GLSL 3.
      offsets: material(
        'air.offsets',
        OFFSETS_FRAGMENT,
        {
          uWindow: this.window,
          uWind: common.uWind,
          ...slabVel,
          ...groundTint,
          uOffsets: { value: null },
          uCarry: { value: null },
          uVel: { value: null },
          uColour: this.colourU,
          uResponse: this.responseU,
          uTint: { value: null },
          uObstacles: this.obstacles,
          uObstacleOver: common.uObstacleOver,
          uVelShift: { value: new THREE.Vector2() },
          uSandShift: { value: new THREE.Vector2() },
          uSandP: { value: this.sandP },
          uSandQ: { value: this.sandQ },
          uSandR: { value: this.sandR },
          uSandC: { value: this.sandC },
        },
        true,
      ),
      // Smoke and fog (the third wave): one pass a frame, two outputs.
      smoke: material(
        'air.smoke',
        SMOKE_FRAGMENT,
        {
          uWindow: this.window,
          uWind: common.uWind,
          ...gust,
          ...slabVel,
          uSmoke: { value: null },
          uSmokeTint: { value: null },
          uVel: { value: null },
          uObstacles: this.obstacles,
          uGround: this.height,
          uColour: this.colourU,
          uVelShift: { value: new THREE.Vector2() },
          uSmokeShift: { value: new THREE.Vector2() },
          uGroundTexel: { value: new THREE.Vector2(1, 1) },
          uObstacleOver: common.uObstacleOver,
          uSmokeP: { value: this.smokeP },
          uFogP: { value: this.fogP },
          uFogQ: { value: this.fogQ },
          uFogR: { value: this.fogR },
          uFogS: { value: this.fogS },
          uSlabFloor: { value: this.slabFloor },
          uSmokeBatch: { value: this.forces.smokeBatch },
          uSmokeShare: { value: this.forces.smokeShare },
          uSmokeColour: { value: this.forces.smokeColour },
          uSmokeCount: { value: 0 },
        },
        true,
      ),
      // The wisps' bands (the third wave, the bands mode alone): the flow noise at the light's four heights.
      bands: material('air.bands', BANDS_FRAGMENT, {
        uWindow: this.window,
        uWind: common.uWind,
        ...slabVel,
        uVel: { value: null },
        uDust: { value: null },
        uShape: { value: null },
        uNoise3: this.noise3,
        uVelShift: { value: new THREE.Vector2() },
        uLightH: this.lightHeights,
        uWispA: this.wispA,
        uWispB: this.wispB,
        uDustTiles: this.dustTiles,
        uSlabTop: this.slabTop,
      }),
    };
    this.quad = createFxQuad(this.mats.fill);
    // What the air carries besides dust (the fourth wave): its materials made now, its targets with the rest's.
    this.kick = new KickPool(
      {
        window: this.window,
        wind: this.wind,
        height: this.height,
        obstacles: this.obstacles,
        klass: this.klass,
        colour: this.colourU,
        tint: this.tintU,
        light: this.light,
        lightShift: this.lightShift,
        lightHeights: this.lightHeights,
        slabTiles: this.slabTiles,
        slabScale: this.slabScale,
        slabShare: this.slabShare,
        atlasHalf: this.atlasHalf,
        slabMid: this.slabMid,
        obstacleOver: this.obstacleOver,
        hullInverse: this.hullInverse,
        hullBox: this.hullBox,
        groundTint: groundTint.uGroundTint,
        groundTintRef: groundTint.uGroundTintRef,
      },
      this.kickLight,
    );
    const hull: RainHull = world.rainHull ?? { uKillSlack: { value: 0.15 }, uHullOn: { value: 0 }, uHullToLocal: { value: new THREE.Matrix4() }, uHullMin: { value: new THREE.Vector3() }, uHullMax: { value: new THREE.Vector3() } };
    this.rain = new RainPool(
      { height: this.height, obstacles: this.obstacles, slabTiles: this.slabTiles, slabScale: this.slabScale, slabShare: this.slabShare, atlasHalf: this.atlasHalf, slabMid: this.slabMid, obstacleOver: this.obstacleOver, hullInverse: this.hullInverse, hullBox: this.hullBox, window: this.window },
      hull,
      this.kickLight.sunDir,
    );
    this.forces.owed = this.owed;
    // The dents only where a float target can be blended into: a stamp adds and the fade multiplies.
    const gl = renderer.getContext() as WebGL2RenderingContext | null;
    this.floatBlend = !!gl && typeof gl.getExtension === 'function' && !!gl.getExtension('EXT_float_blend');
    this.dents = this.floatBlend ? new AirDents(this.responseU, this.colourU, this.window) : null;
    if (this.dents) {
      this.dents.window = this.win;
      this.dents.raster = this.raster;
    }
    const S = AIR_TUNE.sand;
    this.ground = {
      uAirOffsets: { value: null },
      uAirCarry: { value: null },
      uAirDents: { value: null },
      uAirLayers: { value: null },
      uAirLight: this.light,
      uAirSand: { value: this.sandStand },
      uAirWindow: this.window,
      uAirArt: { value: new THREE.Vector4(0, 0, 0, 0) },
      uAirDentP: { value: new THREE.Vector4(0, 0, AIR_TUNE.prints.square, AIR_TUNE.prints.squareEdge) },
      uAirDentQ: { value: new THREE.Vector4(1 / 2048, AIR_TUNE.prints.square / 2048, 0, 0) },
      uAirShift: { value: new THREE.Vector4() },
      uAirMisc: { value: new THREE.Vector4(AIR_TUNE.window.edge, AIR_TUNE.ground.darkenScale, AIR_TUNE.ground.darkening, AIR_TUNE.ground.shade) },
      uAirPhase: { value: new THREE.Vector4(0.5, 0.5, 0, 1 / S.cycle) },
      uAirJitter: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
      uAirSandP: { value: new THREE.Vector4(S.opacity, S.bright, S.scale, S.streak) },
      uAirSandQ: { value: new THREE.Vector4(S.from, S.full, S.grains, S.soft) },
      uAirSandR: { value: new THREE.Vector4(S.flatten, S.fadeFrom / SAND_SIZE, S.fadeTo / SAND_SIZE, S.patches) },
    };
    this.setLayerResponse(new Map(), new Uint8Array(4));
  }

  /**
   * The per-layer lookup the ground's variant reads, two rows (from wave 2b): row 0 each picture layer's family's
   * moves, heals, gives and dust, row 1 its lighter tones as sRGB bytes (`colour`, four bytes by family id, the colour
   * raster's own bytes), from the world's tile set, made at a world's load (`fillLayerResponse`): a texture upload and
   * nothing more, so a family overridden from the console takes effect at once. A world with no tile set hands an empty
   * map, and nothing blows over any layer.
   */
  setLayerResponse(childLayers: ReadonlyMap<number, readonly number[]>, response: Uint8Array, layers = 1, colour: Uint8Array = new Uint8Array(0)): void {
    const n = Math.max(1, Math.floor(layers));
    if (!this.layerTex || this.layerBytes.length !== n * 8) {
      this.layerTex?.dispose();
      this.layerBytes = new Uint8Array(n * 8);
      const t = new THREE.DataTexture(this.layerBytes, n, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.name = 'air.layers';
      this.layerTex = t;
      this.ground.uAirLayers.value = t;
    }
    fillLayerResponse(childLayers, response, this.layerBytes, colour);
    this.layerTex.needsUpdate = true;
  }

  /** The per-layer lookup as it stands, for the console: each layer's four bytes of response, then a row of its colour. */
  layerResponse(): Uint8Array {
    return this.layerBytes;
  }

  /**
   * The session's record of the ground variant's uniforms, which this field writes from now on (the world's `takeAir`),
   * or null to stop (another field taken): what it holds is copied in at once and again at the end of every frame and
   * every write outside one (`writeGround`). A field never bound writes nothing the variant reads, so one made and thrown
   * away -- the in-play warm's, a travel or the master off during it -- can neither be what the ground reads nor, as it
   * is disposed, take the textures and the art out from under the field that was taken.
   */
  bindGround(shared: AirGroundUniforms | null): void {
    this.bound = shared;
    if (shared) copyAirGround(this.ground, shared);
  }

  /** The record the ground's variant reads while this is the world's field, or null (the tests' and the console's). */
  get boundGround(): AirGroundUniforms | null {
    return this.bound;
  }

  /** Why this machine cannot run the field, or null: the dust is float32 and must be renderable and filterable. */
  static refusal(renderer: THREE.WebGLRenderer): string | null {
    const gl = renderer.getContext() as WebGL2RenderingContext | null;
    if (!gl || typeof gl.getExtension !== 'function') return 'no WebGL context';
    if (!gl.getExtension('EXT_color_buffer_float')) return 'this browser cannot draw into float targets (EXT_color_buffer_float)';
    if (!gl.getExtension('OES_texture_float_linear')) return 'this browser cannot filter float textures (OES_texture_float_linear)';
    return null;
  }

  /** Every material of the field, with what it draws into: the warm-up's list (R6) and the scanner's. */
  materials(): THREE.ShaderMaterial[] {
    const list = [this.mats.splat, this.mats.vort, this.mats.div, this.mats.jacobi, this.mats.grad, this.mats.advect, this.mats.dust, this.mats.light, this.mats.fill, this.mats.fillDust, this.obs.material, this.mats.offsets, this.mats.smoke, this.mats.bands];
    if (this.dents) list.push(this.dents.stampMaterial, this.dents.fadeMaterial);
    // The fourth wave's: the pools' updates and fills, and their draws (scene materials the sweep's stand-ins and the
    // weather's own compile build).
    list.push(...this.kick.materials(), ...this.rain.materials());
    // The fifth wave's: the ripples' carry (the spray's rings are the kick-up's, above).
    list.push(this.carry.material);
    return list;
  }

  /**
   * Every material of the field as something to compile and the target it draws into: what `warm` compiles behind a
   * loading screen, and what the in-play warm (`warmJob`, class W) hands the world's program queue. Makes the targets
   * first (a quality dial's size, nothing drawn).
   */
  private warmPairs(): [THREE.Material, THREE.Object3D, THREE.WebGLRenderTarget][] {
    this.ensureTargets();
    const pairs: [THREE.Material, THREE.Object3D, THREE.WebGLRenderTarget][] = [];
    const quad = (m: THREE.Material): THREE.Mesh => createFxQuad(m);
    const m = this.mats;
    pairs.push([m.splat, quad(m.splat), this.vel![0]], [m.vort, quad(m.vort), this.vel![0]], [m.div, quad(m.div), this.div!], [m.jacobi, quad(m.jacobi), this.prs![0]], [m.grad, quad(m.grad), this.vel![0]], [m.advect, quad(m.advect), this.vel![0]]);
    pairs.push([m.dust, quad(m.dust), this.dustPair![0]], [m.light, quad(m.light), this.lightTarget!], [m.fill, quad(m.fill), this.vel![0]], [m.fillDust, quad(m.fillDust), this.dustPair![0]], [this.obs.material, this.obs.mesh, this.obstacleMap]);
    pairs.push([m.offsets, quad(m.offsets), this.offsetsPair![0]]);
    // The third wave's: smoke and fog (their pair at its size, or a texel across while both are off: a program's key hangs
    // on no target's size), and the wisps' bands (likewise a texel across outside the bands mode), so every program exists
    // and the switches build nothing.
    pairs.push([m.smoke, quad(m.smoke), this.smokePair![0]], [m.bands, quad(m.bands), this.bandsTarget!]);
    // The fourth wave's pools: their updates and fills for the very targets they draw into (each a texel row across while
    // its switch is off: a program's key hangs on no target's size). Their draws are scene materials, built by the
    // sweep's stand-ins (`World.kickStandIns`) and the weather's own compile.
    const k = this.kick;
    const rn = this.rain;
    pairs.push([k.updateMaterial, quad(k.updateMaterial), k.pair![0]], [k.fillMaterial, quad(k.fillMaterial), k.pair![0]]);
    pairs.push([rn.updateMaterial, quad(rn.updateMaterial), rn.pair![0]], [rn.fillMaterial, quad(rn.fillMaterial), rn.pair![0]]);
    // The fifth wave's: the ripples' carry and the spray's rings, each for a target as the ripples' state is (a target of
    // its own: a program's key hangs on no target's size or format beyond its being one), so the current and the rings
    // build nothing when they are turned on.
    pairs.push([this.carry.material, this.carry.mesh, this.vel![0]], [k.ringMaterial, k.ringMesh, this.vel![0]]);
    const d = this.dents;
    if (d) {
      // The dents' target is made at its own size, or a texel across while the prints are off (a program's key does not
      // hang on a target's size), so both programs exist and nothing of 16 MB is held for a switch that is off.
      if (!d.target) d.ensure(this.tune.prints ? this.tune.printDetail : 1);
      pairs.push([d.stampMaterial, d.stampMesh, d.target!], [d.fadeMaterial, d.fadeQuad, d.target!]);
    }
    return pairs;
  }

  /**
   * The field's materials for the world's program queue (class W, the master turned on in play): an object each and a
   * job of its own that compiles each for the very target it draws into, issuing only when asked (the queue polls the
   * link in `parallel` mode) and finishing it when asked to resolve, as the motion blur's variants do. Nothing drawn.
   */
  warmJob(): { objects: THREE.Object3D[]; compile: (o: THREE.Object3D, resolve: boolean) => number } | null {
    if (this.refused) return null;
    const r = this.renderer;
    const pairs = this.warmPairs();
    const byObject = new Map<THREE.Object3D, [THREE.Material, THREE.WebGLRenderTarget]>();
    for (const [mat, obj, target] of pairs) byObject.set(obj, [mat, target]);
    const gen = this.targetGen;
    return {
      objects: pairs.map((p) => p[1]),
      compile: (o, resolve) => {
        const it = byObject.get(o);
        // The targets let go since the job was made (the master turned off while it waited in the queue): nothing is
        // compiled for them, or binding one would make its storage again on a target nobody holds and nothing frees.
        if (!it || gen !== this.targetGen) return 0;
        const before = r.info.programs?.length ?? 0;
        const prev = r.getRenderTarget();
        r.setRenderTarget(it[1]);
        try {
          r.compile(o, FX_CAMERA);
        } finally {
          r.setRenderTarget(prev);
        }
        if (resolve) {
          const props = r.properties.get(it[0]) as { currentProgram?: { getUniforms(): unknown } };
          try {
            props.currentProgram?.getUniforms();
          } catch {
            // The link log says what failed; the step that draws it then stops the air and says so.
          }
        }
        return (r.info.programs?.length ?? 0) - before;
      },
    };
  }

  /**
   * Compile every material for the target it draws into, behind the arrival's loading screen, and finish their links
   * (`compileAsync` then the uniforms asked, `resolveLinks`' rule), so the first step builds nothing.
   */
  async warm(): Promise<number> {
    if (this.refused) return 0;
    // The blowing sand's picture, made outright behind the screen (about 11 ms) and uploaded with it; and the wisps'
    // noise (the third wave's, about a tenth of a second), likewise.
    while (!this.sandSlice(SAND_SIZE));
    while (!this.noiseSlice(NOISE3_SIZE));
    const r = this.renderer;
    const before = r.info.programs?.length ?? 0;
    const pairs = this.warmPairs();
    const jobs: Promise<unknown>[] = [];
    const prev = r.getRenderTarget();
    for (const [, obj, target] of pairs) {
      r.setRenderTarget(target);
      try {
        jobs.push(r.compileAsync(obj, FX_CAMERA).catch(() => {}));
      } finally {
        r.setRenderTarget(prev);
      }
    }
    await Promise.all(jobs);
    // The question three's own first draw asks, behind the screen: a deferred driver finishes the link here.
    for (const [mat, obj, target] of pairs) compileAirMaterial(r, mat, obj, target);
    return (r.info.programs?.length ?? 0) - before;
  }

  /**
   * A slice of the blowing sand's picture (`rows` rows, `SAND_ROWS_A_FRAME` in the in-play warm): when the last row is
   * made the picture becomes a texture, mipmapped and repeating, and takes the stand-in's place in the ground's lookup --
   * a texture swap, never a program, and never a picture uploaded part made. Answers whether it is whole.
   */
  sandSlice(rows = SAND_ROWS_A_FRAME): boolean {
    if (this.sandTex) return true;
    const pic = this.sandPic ?? (this.sandPic = newSandPicture());
    if (!sandPictureRows(pic, pic.rows, rows)) return false;
    const t = new THREE.DataTexture(pic.bytes, SAND_SIZE, SAND_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    t.name = 'air.sand';
    this.sandTex = t;
    this.ground.uAirSand.value = t;
    if (this.bound) copyAirGround(this.ground, this.bound);
    return true;
  }

  /** Whether the blowing sand's picture is whole (the in-play warm's swap waits for it). */
  get sandWhole(): boolean {
    return this.sandTex !== null;
  }

  /**
   * A slice of the wisps' noise (`layers` layers of its 64, `NOISE_LAYERS_A_FRAME` in the in-play warm, about 2 ms each;
   * the third wave's): when the last is made the volume becomes a repeating, mipmapped 3D texture the march and the bands
   * read, and its expected-keep table is worked out from what it counted -- never uploaded part made, and made once a
   * session. Answers whether it is whole.
   */
  noiseSlice(layers = NOISE_LAYERS_A_FRAME): boolean {
    if (this.noiseTex) return true;
    const v = this.noiseVol ?? (this.noiseVol = newNoiseVolume());
    if (!noiseLayers(v, layers)) return false;
    const t = new THREE.Data3DTexture(v.bytes, NOISE3_SIZE, NOISE3_SIZE, NOISE3_SIZE);
    t.format = THREE.RedFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.wrapR = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    t.name = 'air.noise3';
    this.noiseTex = t;
    this.noise3.value = t;
    this.keepFor = -1;
    this.syncKeepTable();
    return true;
  }

  /** Whether the wisps' noise is whole (the in-play warm's swap waits for it). */
  get noiseWhole(): boolean {
    return this.noiseTex !== null;
  }

  /** The expected-keep table again from the noise's own histogram, when `wisps.erodeFull` has moved (never a texel read again). */
  private syncKeepTable(): void {
    const v = this.noiseVol;
    const ef = AIR_TUNE.wisps.erodeFull;
    if (!v || !this.noiseTex || ef === this.keepFor) return;
    this.keepFor = ef;
    keepTable(v.histogram, ef, this.keepTable.value);
  }

  /** Make or resize the targets for the tune's detail (class T): materials are never touched. Answers whether anything was resized. */
  private ensureTargets(): boolean {
    const t = this.tune;
    const cells = t.airDetail;
    const dust = cells * t.dustDetail;
    const light = cells * t.lightDetail;
    // The third wave's: the layers of air (tiles of the atlas), the dust's tiles (a field a layer, Ultra's), smoke and
    // fog (a texel across while both are off), the bands (a texel across outside the bands mode).
    const layers = t.airLayers > 1 ? (t.airLayers < 3 ? t.airLayers : 3) : 1;
    const tiles = t.dustLayers ? 3 : 1;
    const smoke = t.smoke || t.fog ? cells * t.smokeDetail : 1;
    const bands = t.wisps === 1 ? dust : 1;
    // The carried offsets and the dents hold their storage only while their own switch is on: off, each is a texel
    // across (its programs kept, since a program's key hangs on no target's size), so what the page's memory estimate
    // leaves out for a switch that is off is really given back -- the dents at 4096 are 64 MB.
    const sand = t.sand ? cells * t.sandDetail : 1;
    // The fifth wave's liquid tile, its own size (`volLiquidDetail`), none while the current and the lava are both off.
    const liquid = liquidTileCells(t);
    const s = this.sized;
    // The dents' own size is their own field's (world-anchored, a square of their own): a new detail is a new field of
    // dents, cleared at its next placing, and nothing of the air starts again for it.
    const d = this.dents;
    if (d !== null) d.ensure(t.prints ? t.printDetail : 1);
    // The fourth wave's pools, each its own size (class T), a row a kind (and a row of drops) while its switch is off: a
    // pool made again starts empty, and nothing of the air starts again for it.
    this.kick.ensure(t.particles ? t.particleDetail : 1 / 64);
    this.rain.ensure(t.rain || t.snow ? t.rainDetail : 128);
    if (s.cells === cells && s.dust === dust && s.light === light && s.layers === layers && s.tiles === tiles && s.liquid === liquid && this.vel) {
      // The offsets alone resized (the sand switched, or its detail moved): they start again at rest at the next frame
      // that steps, and nothing else of the air does. Likewise smoke and fog, and the bands.
      if (s.sand !== sand) {
        for (const tg of this.offsetsPair!) tg.setSize(sand, sand);
        s.sand = sand;
        this.sandShift.set(0, 0);
        this.sandFill = true;
      }
      if (s.smoke !== smoke) {
        for (const tg of this.smokePair!) tg.setSize(smoke, smoke);
        s.smoke = smoke;
        this.smokeShift.set(0, 0);
        this.smokeFill = true;
      }
      if (s.bands !== bands) {
        this.bandsTarget!.setSize(bands, bands);
        s.bands = bands;
      }
      return false;
    }
    const layout = atlasLayout(cells, layers, liquid);
    if (!this.vel) {
      this.vel = [fieldTarget(layout.width, layout.height, THREE.RGFormat, THREE.HalfFloatType, 'air.vel.a'), fieldTarget(layout.width, layout.height, THREE.RGFormat, THREE.HalfFloatType, 'air.vel.b')];
      this.prs = [fieldTarget(layout.width, layout.height, THREE.RedFormat, THREE.HalfFloatType, 'air.prs.a'), fieldTarget(layout.width, layout.height, THREE.RedFormat, THREE.HalfFloatType, 'air.prs.b')];
      this.div = fieldTarget(layout.width, layout.height, THREE.RedFormat, THREE.HalfFloatType, 'air.div');
      // The dust and the shape it carries, one draw writing both (wave 2b's two-texture pair), float32 each; a tile a
      // layer side by side with a field a layer (the third wave's).
      this.dustPair = [fieldTarget(dust * tiles, dust, THREE.RGBAFormat, THREE.FloatType, 'air.dust.a', 2), fieldTarget(dust * tiles, dust, THREE.RGBAFormat, THREE.FloatType, 'air.dust.b', 2)];
      // An optical depth toward the sun at each of four heights, half floats (filtered linearly on every browser that
      // runs the field: the dust's own float targets need more than this does).
      this.lightTarget = fieldTarget(light, light, THREE.RGBAFormat, THREE.HalfFloatType, 'air.light');
      // Offsets round nought heal both ways under a half float's truncation, and still air copies a texel exactly; the
      // sand carried in the air beside them (the third wave's second texture), float32 as its fade is slow.
      this.offsetsPair = [fieldTarget(sand, sand, THREE.RGBAFormat, THREE.FloatType, 'air.offsets.a', 2), fieldTarget(sand, sand, THREE.RGBAFormat, THREE.FloatType, 'air.offsets.b', 2)];
      // Smoke and fog: 0.05 and 0.10 a second decays vanish in a half float's truncation, so float32 (the design's §2.3).
      this.smokePair = [fieldTarget(smoke, smoke, THREE.RGBAFormat, THREE.FloatType, 'air.smoke.a', 2), fieldTarget(smoke, smoke, THREE.RGBAFormat, THREE.FloatType, 'air.smoke.b', 2)];
      this.bandsTarget = fieldTarget(bands, bands, THREE.RGBAFormat, THREE.UnsignedByteType, 'air.bands');
    } else {
      for (const p of [this.vel, this.prs!]) for (const tg of p) tg.setSize(layout.width, layout.height);
      this.div!.setSize(layout.width, layout.height);
      for (const tg of this.dustPair!) tg.setSize(dust * tiles, dust);
      this.lightTarget!.setSize(light, light);
      for (const tg of this.offsetsPair!) tg.setSize(sand, sand);
      for (const tg of this.smokePair!) tg.setSize(smoke, smoke);
      this.bandsTarget!.setSize(bands, bands);
    }
    this.obstacleMap.setSize(cells, cells);
    this.raster.resize(cells);
    // The rasters' textures are made again at the new size; the uniform objects keep their place in every material.
    this.heightTex?.dispose();
    this.responseTex?.dispose();
    this.colourTex?.dispose();
    this.tintTex?.dispose();
    this.klassTex?.dispose();
    this.heightTex = dataTexture(this.raster.height, cells, THREE.RedFormat, THREE.FloatType, 'air.height');
    this.responseTex = dataTexture(this.raster.response, cells, THREE.RGBAFormat, THREE.UnsignedByteType, 'air.response');
    this.colourTex = dataTexture(this.raster.colour, cells, THREE.RGBAFormat, THREE.UnsignedByteType, 'air.colour');
    this.tintTex = dataTexture(this.raster.tint, cells, THREE.RGBAFormat, THREE.UnsignedByteType, 'air.tint');
    // The class raster (the fourth wave's), an index a cell: read nearest, never blended between two classes.
    this.klassTex = dataTexture(this.raster.klass, cells, THREE.RedFormat, THREE.UnsignedByteType, 'air.class');
    this.klassTex.minFilter = THREE.NearestFilter;
    this.klassTex.magFilter = THREE.NearestFilter;
    this.klass.value = this.klassTex;
    // The liquid's own flow (the fifth wave's), two floats a cell, read linearly by the liquid's advect.
    this.flowTex?.dispose();
    this.flowTex = dataTexture(this.raster.flow, cells, THREE.RGFormat, THREE.FloatType, 'air.flow');
    this.flowU.value = this.flowTex;
    this.tintU.value = this.tintTex;
    this.height.value = this.heightTex;
    this.mats.dust.uniforms.uResponse.value = this.responseTex;
    this.mats.dust.uniforms.uColour.value = this.colourTex;
    this.mats.dust.uniforms.uTint.value = this.tintTex;
    this.mats.offsets.uniforms.uTint.value = this.tintTex;
    this.responseU.value = this.responseTex;
    this.colourU.value = this.colourTex;
    (this.mats.dust.uniforms.uGroundTexel.value as THREE.Vector2).set(1 / cells, 1 / cells);
    (this.mats.smoke.uniforms.uGroundTexel.value as THREE.Vector2).set(1 / cells, 1 / cells);
    tileRects(layout, this.tiles);
    this.tileSlab.fill(0);
    this.tileCount.value = layout.tiles.length;
    this.slabCount.value = liquid > 0 ? layout.tiles.length - 1 : layout.tiles.length;
    this.liquidCells = liquid;
    s.liquid = liquid;
    this.atlasHalf.value.set(0.5 / layout.width, 0.5 / layout.height);
    this.dustTiles.value.set(tiles, 0.5 / dust);
    this.dustR.x = tiles;
    this.dustR.y = 0.5 / dust;
    this.syncTune();
    for (const k of ['splat', 'vort', 'div', 'jacobi', 'grad', 'advect'] as const) (this.mats[k].uniforms.uAtlasSize.value as THREE.Vector2).set(layout.width, layout.height);
    s.cells = cells;
    s.dust = dust;
    s.light = light;
    s.sand = sand;
    s.layers = layers;
    s.tiles = tiles;
    s.smoke = smoke;
    s.bands = bands;
    this.dust.value = this.dustPair![0].textures[0];
    this.shape.value = this.dustPair![0].textures[1];
    this.light.value = this.lightTarget!.texture;
    this.smokeField.value = this.smokePair![0].textures[0];
    this.smokeTint.value = this.smokePair![0].textures[1];
    this.bands.value = this.bandsTarget!.texture;
    this.velocity.value = this.vel[0].texture;
    this.ground.uAirOffsets.value = this.offsetsPair![0].textures[0];
    this.ground.uAirCarry.value = this.offsetsPair![0].textures[1];
    this.needsFill = true;
    return true;
  }

  /**
   * The tune's numbers the programs take outside the frame's own vectors, from `AIR_TUNE` as it stands: each slab's floor,
   * middle and share of the wind into the atlas's tile table (a typed array, written in place), how each slab is read out
   * of it by the field's other passes (`slabVelAt`: the highest slab solved standing in for one not, its wind times the
   * ratio of the shares), the slabs' tops and middles, and the reach, the solid's height and the share into their uniforms
   * only when they moved (a double written into a uniform object is a number made). Called at every step and when the
   * targets are made, so every number of the table moves live.
   */
  private syncTune(): void {
    const sl = AIR_TUNE.slabs;
    const ts = this.tileSlab;
    const n = this.slabCount.value;
    // The liquid's tile (the fifth wave's), the last: its row says what it is (w one) and its share of the wind outside.
    if (this.liquidCells > 0) this.syncLiquid(n * 4);
    ts[0] = sl.floor;
    ts[1] = sl.centre;
    ts[2] = sl.windShare;
    if (n > 1) {
      ts[4] = sl.floor1;
      ts[5] = sl.centre1;
      ts[6] = sl.windShare1;
    }
    if (n > 2) {
      ts[8] = sl.floor2;
      ts[9] = sl.centre2;
      ts[10] = sl.windShare2;
    }
    const rects = this.tiles;
    const st = this.slabTiles.value;
    const sc = this.slabScale.value;
    const sh = this.slabShare.value;
    sh.x = sl.windShare;
    sh.y = sl.windShare1;
    sh.z = sl.windShare2;
    for (let k = 0; k < 3; k++) {
      const solved = k < n ? k : n - 1;
      const o = solved * 4;
      const r = st[k];
      r.x = rects[o];
      r.y = rects[o + 1];
      r.z = rects[o + 2];
      r.w = rects[o + 3];
      const from = solved === 0 ? sl.windShare : solved === 1 ? sl.windShare1 : sl.windShare2;
      const to = k === 0 ? sl.windShare : k === 1 ? sl.windShare1 : sl.windShare2;
      const ratio = from > 1e-6 ? to / from : 1;
      if (k === 0) sc.x = ratio;
      else if (k === 1) sc.y = ratio;
      else sc.z = ratio;
    }
    const top = this.slabTop.value;
    top.x = sl.ceiling;
    top.y = sl.ceiling1;
    this.dustR.z = sl.ceiling;
    this.dustR.w = sl.ceiling1;
    const mid = this.slabMid.value;
    mid.x = sl.centre;
    mid.y = sl.centre1;
    mid.z = sl.centre2;
    mid.w = sl.ceiling2 + 2;
    const fl = this.slabFloor;
    fl.x = sl.floor;
    fl.y = sl.floor1;
    fl.z = sl.floor2;
    if (this.reachScale.value !== sl.reach) this.reachScale.value = sl.reach;
    if (this.windShare.value !== sl.windShare) this.windShare.value = sl.windShare;
    const over = AIR_TUNE.obstacles.over;
    if (this.obstacleOver.value !== over) this.obstacleOver.value = over;
    this.syncKeepTable();
  }

  /**
   * The liquid's tile's row of the atlas's tile table at `o` and its numbers (the fifth wave), from `AIR_TUNE.liquid` as
   * it stands, component by component: water's and lava's pull and dissipation, each one's share of the wind (the
   * current's switch off, water takes none) and of the swirl, a push's share, a ribbon's flow's share, the liquid's cap.
   * The lava's switch off takes nothing away here: its crust reads nought (`writeLiquid`), and lava held still costs no
   * more than lava moving.
   */
  private syncLiquid(o: number): void {
    const L = AIR_TUNE.liquid;
    const ts = this.tileSlab;
    const water = this.tune.current;
    ts[o] = 0;
    ts[o + 1] = 0;
    ts[o + 2] = water ? L.waterWind : 0;
    ts[o + 3] = 1;
    const p = this.liquidP;
    p.x = L.waterRelax;
    p.y = L.waterDiss;
    p.z = L.lavaRelax;
    p.w = L.lavaDiss;
    const q = this.liquidQ;
    q.x = water ? L.waterWind : 0;
    q.y = L.lavaWind;
    q.z = L.waterSwirl;
    q.w = L.lavaSwirl;
    const r = this.liquidR;
    r.x = L.push;
    r.y = L.ribbonFlow;
    r.z = AIR_TUNE.solver.liquidCap;
    // The swirl is held per metre (`swirlAt`): the frame's swirl is the air's cell's, so the liquid's tile, whose cells
    // are its own size, takes it times the air's cell over its own (one wherever the two details agree, as every preset has them).
    const sized = this.sized;
    r.w = sized.cells > 0 && sized.liquid > 0 ? sized.liquid / sized.cells : 1;
  }

  /** The flow raster uploaded again (it moved: a ribbon's flow asked in, or the window moved over one). */
  private uploadFlow(): void {
    if (this.flowTex) this.flowTex.needsUpdate = true;
    this.raster.flowDirty = false;
  }

  /**
   * The session's record of the liquid's uniforms (`LIQUID_U`, which the water's current variant, its masks, the lava's
   * crust twins and the ripples' carry hold by reference), which this field writes from now on at the end of every frame,
   * or null to stop. A field never bound writes nothing they read, so one made and thrown away never leaves the water
   * reading a texture nobody steps; let go, the record is put to nought (every reader plain by its own branch).
   */
  bindLiquid(shared: LiquidUniforms | null): void {
    if (this.liquidBound && this.liquidBound !== shared) liquidOff(this.liquidBound);
    this.liquidBound = shared;
    if (shared) this.writeLiquid(false);
  }

  /** The record this field writes while it is the world's (the tests' and the console's). */
  get boundLiquid(): LiquidUniforms | null {
    return this.liquidBound;
  }

  /**
   * The session's record of the grass's twin (`GRASS_AIR_U`, which both of the grass's twins hold by reference, the sixth
   * wave), which this field writes from now on at the end of every frame, or null to stop: the liquid's rule, so a field
   * made and thrown away never leaves the grass reading a texture nobody steps; let go, the record's share is put to nought.
   */
  bindGrass(shared: GrassAirUniforms | null): void {
    if (this.grassBound && this.grassBound !== shared) grassAirOff(this.grassBound);
    this.grassBound = shared;
    if (shared) this.writeGrass(false);
  }

  /** The record this field writes while it is the world's (the tests' and the console's). */
  get boundGrass(): GrassAirUniforms | null {
    return this.grassBound;
  }

  private grassBound: GrassAirUniforms | null = null;

  /**
   * What the grass's twin reads this frame, into the bound record (the components of kept vectors): the velocity atlas,
   * the window, slab 0's rectangle and half a texel, and the art share with the lean's own numbers -- the share nought on
   * any frame the field did not step, or with the grass's switch off, so the twin draws the plain grass.
   */
  private writeGrass(stepped: boolean): void {
    const rec = this.grassBound;
    if (!rec) return;
    const t = this.tune;
    const on = stepped && t.on && t.air && t.grass && this.vel !== null && this.win.placed;
    const p = rec.uAirGrassP.value;
    const wd = rec.uAirGrassWind.value;
    const sh = rec.uAirGrassSheen.value;
    if (!on) {
      rec.uAirGrassVel.value = null;
      p.x = 0;
      wd.w = 0;
      sh.x = 0;
      return;
    }
    // The seventh wave's, under the unified wind's arm alone: its mean as a vector (the lean outside the window), a far
    // card's share of that lean, and the sheen of a bent stalk.
    if (WIND_STATE.on) {
      const F = WIND_FRAME;
      const Gw = WIND_TUNE.grass;
      // The mean as slab 0's own air takes it (the inflow's scale and the low layer's share of the wind), so the lean
      // outside the window continues the lean the near tufts take from slab 0 inside it, one wind across the edge band.
      const s0 = F.mean * AIR_TUNE.wind.scale * AIR_TUNE.slabs.windShare;
      wd.x = Math.sin(F.heading) * s0;
      wd.y = Math.cos(F.heading) * s0;
      wd.z = Gw.farLean;
      wd.w = 1;
      sh.x = Gw.sheen * WIND_STATE.art;
      sh.y = Gw.sheenGrey;
      sh.z = Gw.sheenLift;
    } else {
      wd.w = 0;
      sh.x = 0;
    }
    rec.uAirGrassVel.value = this.vel![0].texture;
    const w = this.win;
    const wv = rec.uAirGrassWin.value;
    wv.x = w.ox;
    wv.y = w.oz;
    wv.z = w.size;
    wv.w = AIR_TUNE.window.edge;
    const rect = rec.uAirGrassRect.value;
    rect.x = this.tiles[0];
    rect.y = this.tiles[1];
    rect.z = this.tiles[2];
    rect.w = this.tiles[3];
    const h = rec.uAirGrassHalf.value;
    h.x = this.atlasHalf.value.x;
    h.y = this.atlasHalf.value.y;
    const G = AIR_TUNE.grass;
    p.x = t.artGrass;
    p.y = G.full;
    p.z = G.most;
    p.w = G.sink;
  }

  /** Whether the liquid's tile is stepped (the master and the air on, the field live, the current or the lava on). */
  get liquidLive(): boolean {
    return this.live && this.liquidCells > 0 && this.vel !== null;
  }

  /**
   * What the liquids' readers take this frame, into the bound record (no number into a uniform object: the components
   * of kept vectors): the velocity atlas as it stands, the window, the liquid tile's rectangle and half a texel, the art
   * shares (each nought while its own effect is off or the tile was not stepped this frame, so every reader draws the
   * plain liquid), the detail's share of the current, the view, and the crust's two phases on the field's own clock.
   */
  private writeLiquid(stepped: boolean): void {
    const rec = this.liquidBound;
    if (!rec) return;
    const t = this.tune;
    const on = stepped && t.on && t.air && this.liquidCells > 0 && this.vel !== null && this.win.placed;
    const p = rec.uAirLiquidP.value;
    if (!on) {
      rec.uAirLiquidVel.value = null;
      p.x = 0;
      p.y = 0;
      p.w = 0;
      return;
    }
    rec.uAirLiquidVel.value = this.vel![0].texture;
    const w = this.win;
    const wv = rec.uAirLiquidWin.value;
    wv.x = w.ox;
    wv.y = w.oz;
    wv.z = w.size;
    wv.w = AIR_TUNE.window.edge;
    const o = this.slabCount.value * 4;
    const rect = rec.uAirLiquidRect.value;
    rect.x = this.tiles[o];
    rect.y = this.tiles[o + 1];
    rect.z = this.tiles[o + 2];
    rect.w = this.tiles[o + 3];
    const h = rec.uAirLiquidHalf.value;
    h.x = this.atlasHalf.value.x;
    h.y = this.atlasHalf.value.y;
    p.x = t.current ? t.artWater : 0;
    p.y = t.lava ? t.artLava : 0;
    p.z = AIR_TUNE.liquid.detailFlow;
    p.w = this.liquidView;
    const c = this.crust;
    c.time = this.worldTime;
    c.cycle = AIR_TUNE.liquid.crustCycle;
    crustPhaseIn(c);
    const q = rec.uAirLiquidQ.value;
    q.x = c.tA;
    q.y = c.tB;
    q.z = c.wB;
    q.w = 1 / (AIR_TUNE.liquid.crustCycle > 1e-3 ? AIR_TUNE.liquid.crustCycle : 1e-3);
  }

  /**
   * Whether anything is airborne: a source lifted dust or smoke in the last `airborneFor` seconds, the storm is up, or
   * the hour brings fog (the third wave's).
   */
  hasAir(): boolean {
    const V = AIR_TUNE.volume.airborneFor;
    return this.input.storm > 0 || this.worldTime - this.lastLift < V || (this.tune.smoke && this.worldTime - this.lastSmoke < AIR_TUNE.smoke.linger) || (this.tune.fog && this.worldTime - this.lastFog < AIR_TUNE.fog.linger);
  }

  /**
   * A blast at a point (the force API, §2.10): its ring of shoves, its dust and its grains, by its own radius and push.
   * `smoke` is the third wave's. A queue write and nothing else; answers at once with the field off or indoors.
   */
  blast(x: number, y: number, z: number, radius: number, push: number, smoke: number): void {
    this.forces.blast(x, y, z, radius, push, smoke);
  }

  /**
   * Smoke held at a point this frame (the force API's `smoke`, the third wave): a gas cloud's, a burning part's, at
   * `rate` a second over its sphere in its own colour (`0xRRGGBB`, sRGB). Cosmetic: nothing that stings reads it back. A
   * queue write; answers at once with the field off, the smoke off or the point off the window.
   */
  smoke(x: number, y: number, z: number, radius: number, rate: number, colour: number): void {
    this.forces.smoke(x, y, z, radius, rate, colour);
  }

  /**
   * Whether the volume is drawing a cloud's smoke (the gas cloud's puffs, the third wave): the field carried its smoke
   * last frame, the volume drew last frame (the master, the volume and Effects on, nothing refusing it), its amount is at
   * least `smoke.puffsBelow`, the last batch took every frame source handed to it (a full table drops a danger's smoke,
   * and then every cloud keeps its puffs), and the cloud's whole sphere, `radius` metres about `(x, z)`, is on the window
   * clear of its fading edge band. Otherwise the puffs are drawn, so a danger is always shown. Reads nothing but kept
   * fields.
   */
  drawsSmokeAt(x: number, z: number, radius = 0): boolean {
    const t = this.tune;
    if (!t.on || !t.air || !t.smoke || this.refused || this.drawer.broken) return false;
    if (!this.smokeLive || !this.drewLastFrame || !(this.volumeAmount >= AIR_TUNE.smoke.puffsBelow)) return false;
    if (this.forces.frameSmokeLostLast > 0) return false;
    const w = this.win;
    if (!w.placed) return false;
    const r = radius > 0 && Number.isFinite(radius) ? radius / w.size : 0;
    const u = (x - w.ox) / w.size;
    const v = (z - w.oz) / w.size;
    const e = AIR_TUNE.window.edge;
    return u - r > e && v - r > e && u + r < 1 - e && v + r < 1 - e;
  }

  /** A Force push (`sign` +1) or pull (-1) through a cone along (dx, dz), or a repulse's ring with the direction nought. */
  force(x: number, y: number, z: number, dx: number, dz: number, power: number, sign: number, reach: number): void {
    this.forces.force(x, y, z, dx, dz, power, sign, reach);
  }

  /** A field by name, as it stands now: what the debug view shows (`__debug.air({ view })`). */
  debugTexture(name: string): THREE.Texture | null {
    switch (name) {
      case 'dust':
        return this.dust.value;
      case 'shape':
        return this.shape.value;
      case 'tint':
        return this.tintTex;
      case 'velocity':
        return this.vel ? this.vel[0].texture : null;
      case 'obstacles':
        return this.obstacleMap.texture;
      case 'height':
        return this.heightTex;
      case 'response':
        return this.responseTex;
      case 'colour':
      case 'medium':
        return this.colourTex;
      case 'light':
        return this.light.value;
      case 'offsets':
        return this.ground.uAirOffsets.value;
      case 'dents':
        return this.dents ? this.dents.texture : null;
      // The third wave's: smoke (a slab a channel) and the fog (alpha), the smoke's colour, the wisps' bands, the sand
      // carried in the air.
      case 'smokeField':
      case 'fogField':
        return this.smokeField.value;
      case 'smokeTint':
        return this.smokeTint.value;
      case 'bands':
        return this.bands.value;
      case 'carry':
        return this.ground.uAirCarry.value;
      // The fourth wave's class raster (each ground class's index over the window).
      case 'class':
        return this.klassTex;
      // The fifth wave's: the liquid's own flow (a ribbon's), and the atlas with the liquid's tile beside the slabs.
      case 'flow':
        return this.flowTex;
      case 'liquid':
        return this.vel ? this.vel[0].texture : null;
      // The seventh wave's: the unified wind's gusts over the window, from the pack, on the processor (no program).
      case 'gusts':
        return this.gustView();
      default:
        return null;
    }
  }

  /** The gusts' view's picture, made the first time it is shown and filled again at most four times a second. */
  private gustTex: THREE.DataTexture | null = null;
  private gustAt = -1;
  private readonly gustAsk = newGustAt();

  /**
   * The unified wind's gusts over the window as a picture (`air({ view: 'gusts' })`): each texel's k, patch and veer by
   * `gustFlat` from the pack the frame's readers hold, red k over two, green the patch, blue the veer plus a half. Nothing
   * compiled: a data texture three uploads, the debug view's own program drawing it. Black with the unified wind off.
   */
  private gustView(): THREE.Texture {
    const N = 64;
    if (!this.gustTex) {
      this.gustTex = new THREE.DataTexture(new Uint8Array(N * N * 4), N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      this.gustTex.minFilter = THREE.NearestFilter;
      this.gustTex.magFilter = THREE.NearestFilter;
    }
    if (this.gustAt >= 0 && this.worldTime - this.gustAt < 0.25) return this.gustTex;
    this.gustAt = this.worldTime;
    const px = this.gustTex.image.data as Uint8Array;
    const w = this.win;
    const pack = wind7Uniforms().uWind7.value;
    const on = WIND_STATE.on && pack[27] > 0.5 && w.placed;
    const g = this.gustAsk;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const o = (j * N + i) * 4;
        if (!on) {
          px[o] = 0;
          px[o + 1] = 0;
          px[o + 2] = 0;
          px[o + 3] = 255;
          continue;
        }
        g.x = w.ox + ((i + 0.5) / N) * w.size;
        g.z = w.oz + ((j + 0.5) / N) * w.size;
        gustFlat(g, pack);
        px[o] = Math.max(0, Math.min(255, Math.round((g.k / 2) * 255)));
        px[o + 1] = Math.max(0, Math.min(255, Math.round(g.p * 255)));
        px[o + 2] = Math.max(0, Math.min(255, Math.round((g.a + 0.5) * 255)));
        px[o + 3] = 255;
      }
    }
    this.gustTex.needsUpdate = true;
    return this.gustTex;
  }

  /** Whether the field is stepping (the master and the air on, somewhere it runs, something reading it). */
  get stepping(): boolean {
    return this.stats.stepped;
  }

  /**
   * The frame (§2.4). `inp` is the world's kept record. Nothing is drawn unless something reads the air; the rasters
   * and the forces' window are kept whenever the field is on, since the grains read the ground's dust.
   */
  update(inp: AirFrameInput): void {
    this.input = inp;
    const t = this.tune;
    const f = this.forces;
    this.drewLastFrame = this.volumeDrew;
    this.stats.stepped = false;
    this.dustLive = false;
    this.smokeLive = false;
    this.live = false;
    this.kick.shown = false;
    const dt = inp.dt > 0 && Number.isFinite(inp.dt) ? (inp.dt < 0.1 ? inp.dt : 0.1) : 0;
    this.worldTime += dt;
    f.fromEngines = t.fromEngines;
    f.fromForce = t.fromForce;
    f.fromBlasts = t.fromBlasts;
    f.dust = t.dust;
    // Smoke taken at all (the third wave's `volSmoke`): with it off no source is queued and the gas cloud keeps its puffs.
    f.smokeOn = t.smoke;
    // The fourth wave's spawn records, taken while the particles are on (a blast between frames writes them, on this
    // frame's word); each kind's switch is read where the pool's frame is (`kickCorner`). Nothing more of the wave is
    // written here: every line added to this method costs its calls their place in the compiler's budget, and with one
    // more call of its own a steady frame of the measure made 35 bytes in one process in four (writeLook left out).
    f.spawns = t.on && t.air && t.particles ? this.spawns : null;
    if (t.fog && inp.fogLevel > 0) this.lastFog = this.worldTime;
    f.camX = inp.camX;
    f.camZ = inp.camZ;
    const why = this.refused ?? this.drawer.broken ?? (!t.on ? 'the volumetrics master is off' : !t.air ? 'the moving air is off' : inp.where);
    this.dentsLive = false;
    this.frameTicks = 0;
    if (why) {
      this.why = why;
      f.active = false;
      f.dents = null;
      f.beginFrame();
      // Nothing steps here, so nothing owed may wait for a step that could come minutes on (a walk out of a cantina),
      // where a shove queued before the door would land long after the blast that made it. A footprint the feet already
      // gave the dents (before this frame, last frame's state) is pressed now rather than dropped: no decal was laid for
      // it, so dropped it would be neither (the one-owner rule, §2.7).
      f.dropOwed();
      if (!this.refused && !this.drawer.broken) this.layOwed();
      this.dents?.dropOwed();
      this.writeGround(false);
      // The particles step only where the air does: what was staged for them is spent, their draws hidden.
      this.spawns.clear();
      this.kick.hide(false);
      return;
    }
    f.active = true;
    const W = AIR_TUNE.window;
    const resized = this.ensureTargets();
    const pl = this.place;
    pl.camX = inp.camX;
    pl.camZ = inp.camZ;
    pl.size = W.size;
    pl.cells = t.airDetail;
    pl.jump = W.jump;
    const code = placeWindowIn(this.win, pl);
    const w = this.win;
    // Component by component, never a `set`: a call the compiler leaves out of this method (its budget is full) boxes
    // every number handed to it, which made a steady frame 35 bytes in one process in four once the fourth wave's calls
    // joined the budget.
    const wv = this.window.value;
    wv.x = w.ox;
    wv.y = w.oz;
    wv.z = w.size;
    wv.w = w.cell;
    if (code === PLACE.first || code === PLACE.jump || resized) {
      this.raster.clear();
      this.obs.forget();
      f.clear();
      // A jump starts the dent field clean as well (the window's rule, §2.2): its square is placed afresh and cleared.
      this.dents?.clear();
      // The kick-up pool starts empty with the window, and at a jump the rain fills afresh about its own anchor too (a
      // jump clears both pools, §2.16); its anchor's own jump catches the rest (the moving air off, a pause in a fall).
      this.kick.clear();
      if (code === PLACE.jump) this.rain.clear();
      this.needsFill = true;
      this.solverShift.set(0, 0);
      this.dustShift.set(0, 0);
      this.sandShift.set(0, 0);
      this.smokeShift.set(0, 0);
      this.lightShift.value.set(0, 0);
      this.stats.resets++;
    } else if (code === PLACE.moved) {
      this.raster.shift(w.moveX, w.moveZ);
      const sx = w.moveX / w.cells;
      const sz = w.moveZ / w.cells;
      this.solverShift.x += sx;
      this.solverShift.y += sz;
      this.dustShift.x += sx;
      this.dustShift.y += sz;
      this.sandShift.x += sx;
      this.sandShift.y += sz;
      this.smokeShift.x += sx;
      this.smokeShift.y += sz;
      this.lightShift.value.x += sx;
      this.lightShift.value.y += sz;
      // The kick-up pool's positions are relative to the window's corner: its whole-cell move is owed them, in metres.
      const ks = this.kick.shift;
      ks.x += w.moveX * w.cell;
      ks.z += w.moveZ * w.cell;
    }
    this.stats.lastScrollX = w.moveX;
    this.stats.lastScrollZ = w.moveZ;
    const fillAll = code === PLACE.first || code === PLACE.jump || resized;
    const fa = this.raster.fillArgs;
    fa.ox = w.ox;
    fa.oz = w.oz;
    fa.cell = w.cell;
    fa.dx = fillAll ? 0 : w.moveX;
    fa.dz = fillAll ? 0 : w.moveZ;
    fa.margin = W.stripMargin;
    fa.budgetMs = W.stripBudgetMs * (fillAll ? 10 : 1);
    this.raster.fillIn(this.world.ground, now);
    const bv = this.band.value;
    bv.x = this.raster.lowest;
    bv.y = this.raster.highest;
    bv.z = this.raster.mean;
    if (this.raster.dirty) {
      this.heightTex!.needsUpdate = true;
      this.responseTex!.needsUpdate = true;
      this.colourTex!.needsUpdate = true;
      this.tintTex!.needsUpdate = true;
      this.klassTex!.needsUpdate = true;
      this.raster.dirty = false;
      if (this.raster.flowDirty) this.uploadFlow();
    }
    let drawObstacles = code !== PLACE.still;
    this.obs.time = this.worldTime;
    if (this.world.boxes && this.obs.due(w)) {
      this.obs.gather(this.world.boxes, w);
      drawObstacles = true;
    }
    // The engines of this frame, into the forces' table.
    pushEngines(this.world.hulls, f, this.world.rides ?? null, this.world.jets ?? null);
    const te = this.testEngine;
    if (te && f.fromEngines) {
      const a = f.arg;
      a[0] = te.x;
      a[1] = te.y;
      a[2] = te.z;
      a[3] = te.dx;
      a[4] = te.dy;
      a[5] = te.dz;
      a[6] = te.exit;
      a[7] = te.vx !== undefined && Number.isFinite(te.vx) ? te.vx : 0;
      a[8] = te.vz !== undefined && Number.isFinite(te.vz) ? te.vz : 0;
      a[9] = -1;
      f.engineArgs();
    }
    // The frame's own numbers, at once: the wind, the storm, the dust's settling, the swirl, the light toward the sun.
    const nu = this.nums;
    nu.dt = dt;
    nu.cell = w.cell;
    nu.windHeading = inp.windHeading;
    nu.windSpeed = inp.windSpeed;
    nu.storm = inp.storm;
    nu.sunX = inp.sunX;
    nu.sunY = inp.sunY;
    nu.sunZ = inp.sunZ;
    nu.lightSteps = t.lightSteps;
    airFrameNumbersIn(nu);
    this.windXZ.x = nu.windX;
    this.windXZ.z = nu.windZ;
    // The storm's dust outside, at its weight, and its spread: the half-normal of the storm's own mean height.
    const inflow = this.inflow.value;
    inflow.x = nu.inflowDust;
    inflow.y = nu.stormSigma;
    this.lightOn.value = t.light ? 1 : 0;
    this.raster.tintShare = AIR_TUNE.dust.tint;
    this.frameDt = dt;
    this.frameStorm = inp.storm > 0 && Number.isFinite(inp.storm) ? inp.storm : 0;
    this.frameInflow = nu.inflowDust;
    this.easeStorm();
    this.writeLook();
    this.writeAirLook();
    if (!inp.reading) {
      this.why = 'nothing reads the air: the dust is off, or Effects are, and the ground keeps nothing';
      // The rasters are kept for the grains; what the blasts and pushes queued is dropped, since no step will take it
      // (the footprints already owed are pressed, as above).
      f.dropOwed();
      f.dents = null;
      this.layOwed();
      this.dents?.dropOwed();
      this.writeGround(true);
      this.spawns.clear();
      this.kick.hide(false);
      return;
    }
    // The kick-up pool's corner and this frame's numbers (the fourth wave), before the sources' frame walk stages their
    // records: the corner's height moves only by whole metres, its move owed as a shift.
    this.kickCorner();
    // The ground's marks (the second wave): kept only while the ground wears the air's variant and the prints are on,
    // on a browser that blends floats. The square follows the camera in whole texels, its leaving strips cleared at the
    // draw; the 10 Hz clock the age, the stamps and the fade count on moves on; the engines gather their pits and ruts.
    const dents = this.dents;
    this.dentsLive = dents !== null && dents.target !== null && t.prints && inp.ground;
    f.dents = this.dentsLive ? dents : null;
    if (dents && this.dentsLive) {
      const sq = dents.square;
      sq.atX = inp.camX;
      sq.atZ = inp.camZ;
      sq.wantSize = AIR_TUNE.prints.square;
      sq.wantN = t.printDetail;
      placeDentSquareIn(sq);
    } else if (dents) {
      // The dents not kept this frame (the ground came off the variant, the prints went off): what the feet already gave
      // them is pressed where the field still stands, and the rest dropped.
      this.layOwed();
      dents.dropOwed();
    }
    const tk = this.tick;
    tk.dt = dt;
    tickClockIn(tk);
    this.frameTicks = tk.ticks;
    if (this.dentsLive) {
      f.frameDt = dt;
      f.gatherDents();
    }
    // The unified wind's dust devils (the seventh wave): the nearest within the window, as continuous sources.
    this.pushDevils();
    // The sources' frame walk (the design's §2.4), every frame the field runs, the dust on or off: the fronts' frame
    // ages move on (so a front is let go on time even with the dust off) and the engines' dust is worked out.
    f.frameDt = dt;
    f.dustTexel = w.size / (t.airDetail * t.dustDetail);
    f.frameSources();
    // The blowing sand's two phases, on the frame's own clock.
    if (t.sand && inp.ground) {
      const ph = this.phase;
      ph.dt = dt;
      ph.cycle = AIR_TUNE.sand.cycle;
      sandPhaseIn(ph);
    }
    const r = this.renderer;
    const sv = this.saved;
    sv.target = r.getRenderTarget();
    sv.autoClear = r.autoClear;
    sv.alpha = r.getClearAlpha();
    r.getClearColor(sv.colour);
    r.autoClear = false;
    this.drawer.mode = AIR_DRAW.mode;
    try {
      // The obstacles first, and always a render call of their own (`AirDrawer.drawMesh`): only then does three upload
      // the boxes a gather wrote, whichever way the step's stages are drawn.
      if (drawObstacles) this.drawer.runPlain(this.obstacleDraw);
      this.drawer.run(this.runFrame, this.home);
      // The dents after the step, each a render call of its own (their stamps are a mesh three uploads only so).
      if (this.dentsLive) this.drawer.runPlain(this.dentDraw);
    } finally {
      r.setRenderTarget(sv.target);
      r.autoClear = sv.autoClear;
      r.setClearColor(sv.colour, sv.alpha);
    }
    if (this.drawer.broken) {
      this.dustLive = false;
      this.dentsLive = false;
    }
    this.stats.stepped = this.drawer.broken === null;
    this.live = this.stats.stepped;
    this.why = this.drawer.broken ? `the step failed: ${this.drawer.broken}` : null;
    this.stats.frames++;
    this.stats.draws = this.drawer.count();
    this.writeGround(true);
    // The kick-up pool's draws: shown on a frame its update drew (every frame the field runs with the particles on),
    // hidden on any other, so a pool nobody stepped never hangs in the air.
    this.kickDraws();
  }

  /**
   * The kick-up pool's frame (the fourth wave): each kind's switch into the spawn records and the pool, its numbers for
   * this frame read from the field's own (`frameDt`, the window, the input record), and its corner placed.
   */
  private kickCorner(): void {
    const t = this.tune;
    const sp = this.spawns;
    sp.on[KICK_KIND.leaf] = t.leaves;
    sp.on[KICK_KIND.puff] = t.puffs;
    sp.on[KICK_KIND.spray] = t.spray;
    sp.on[KICK_KIND.streak] = t.streaks;
    for (let k = 0; k < KICK_KINDS; k++) this.kick.on[k] = sp.on[k];
    const kf = this.kick.frame;
    const w = this.win;
    kf.dt = this.frameDt;
    kf.ox = w.ox;
    kf.oz = w.oz;
    kf.camY = this.input.camY;
    kf.storm = this.frameStorm;
    kf.edge = AIR_TUNE.window.edge;
    this.kick.placeCorner();
  }

  /** The frame's records spent and the kick-up's draws written, or hidden where the field did not run its update. */
  private kickDraws(): void {
    this.spawns.clear();
    if (this.live && this.kick.shown) this.kick.writeDraws();
    else this.kick.hide(this.live && this.tune.particles);
  }

  /**
   * The ground's uniforms written again from the tune as it stands, outside a frame (the frame report's compare draws at
   * once with nothing stepped): what the last frame kept, the art dials as they are now.
   */
  groundUniformsNow(): void {
    this.writeGround(this.win.placed);
  }

  /** The dents' draws of this frame (run plain): the strips cleared, the batch, the fade on a tick. */
  private readonly dentDraw = (): void => {
    const d = this.dents;
    if (!d) return;
    this.drawer.draws += d.draw(this.renderer, this.frameTicks);
  };

  /**
   * The one-shots owed to the dents pressed on a frame that keeps no marks (the air does nothing here, nothing reads it,
   * or the ground came off the variant), wherever the field still stands to take them: the feet gave a step to the dents
   * on last frame's word and laid no decal for it, so dropping it would leave that step neither (§2.7). No strip is
   * cleared, no source laid and nothing faded: the square stands where the last frame that kept marks put it, and the
   * mark shows again when the ground next keeps them. A render call of its own (the stamps' mesh), the renderer's state
   * put back.
   */
  private layOwed(): void {
    const d = this.dents;
    if (!d || d.oneCount === 0 || !d.target || !d.square.placed || this.drawer.broken) return;
    const r = this.renderer;
    const sv = this.saved;
    sv.target = r.getRenderTarget();
    sv.autoClear = r.autoClear;
    sv.alpha = r.getClearAlpha();
    r.getClearColor(sv.colour);
    r.autoClear = false;
    try {
      this.drawer.runPlain(this.owedDraw);
    } finally {
      r.setRenderTarget(sv.target);
      r.autoClear = sv.autoClear;
      r.setClearColor(sv.colour, sv.alpha);
    }
  }

  private readonly owedDraw = (): void => {
    const d = this.dents;
    if (!d) return;
    this.drawer.draws += d.draw(this.renderer, 0);
  };

  /**
   * What the ground's variant reads, written in place once a frame (no number into a uniform object: the components of
   * kept vectors). `placed`: the window stands and the field's targets with it. Each art dial is nought while its own
   * effect is off -- the blowing sand with the sand off, the prints with no dents kept, the shade unless the volume drew the
   * dust last frame with the light pass on -- so the variant draws exactly the plain ground for any it does not keep.
   */
  private writeGround(placed: boolean): void {
    const t = this.tune;
    const g = this.ground;
    const on = placed && t.on && this.offsetsPair !== null && this.win.placed;
    const art = g.uAirArt.value;
    art.x = on && t.sand ? t.artSand : 0;
    art.y = on && this.dentsLive ? t.artPrints : 0;
    art.z = on && t.light && this.volumeDrew && this.light.value !== null ? t.artShade : 0;
    art.w = on ? 1 : 0;
    const d = this.dents;
    if (d && d.target) {
      const sq = d.square;
      g.uAirDents.value = d.target.texture;
      // Field by field, as every number written here: `set` would hand its numbers across a call.
      const dp = g.uAirDentP.value;
      dp.x = sq.k0x * sq.t;
      dp.y = sq.k0z * sq.t;
      dp.z = sq.size;
      dp.w = AIR_TUNE.prints.squareEdge;
      g.uAirDentQ.value.x = 1 / (sq.n > 0 ? sq.n : 1);
      g.uAirDentQ.value.y = sq.t;
    }
    const sh = g.uAirShift.value;
    sh.x = this.sandShift.x;
    sh.y = this.sandShift.y;
    sh.z = this.lightShift.value.x;
    sh.w = this.lightShift.value.y;
    const misc = g.uAirMisc.value;
    misc.x = AIR_TUNE.window.edge;
    misc.y = AIR_TUNE.ground.darkenScale;
    misc.z = AIR_TUNE.ground.darkening;
    misc.w = AIR_TUNE.ground.shade;
    // The blowing sand (wave 2b's): its phases and where each phase's picture stands since its restart, and the
    // tune's look, each pair of edges held a little apart (a smoothstep with equal edges is undefined).
    const S = AIR_TUNE.sand;
    const ph = this.phase;
    const cycle = S.cycle > 1e-3 ? S.cycle : 1e-3;
    const pv = g.uAirPhase.value;
    pv.x = ph.tA;
    pv.y = ph.tB;
    pv.z = this.sandView ? 1 : 0;
    pv.w = 1 / cycle;
    const jv = g.uAirJitter.value;
    const jit = this.jitter;
    sandJitter(2 * ph.kA, jit);
    jv.x = jit.x;
    jv.y = jit.y;
    sandJitter(2 * ph.kB + 1, jit);
    jv.z = jit.x;
    jv.w = jit.y;
    // Wet ground does not blow: the opacity times what the weather's wetness leaves of it, on the CPU.
    const wet = WEATHER_UNIFORMS.uWetness.value;
    const wetFull = S.wetFull > 1e-3 ? S.wetFull : 1e-3;
    let wk = wet / wetFull;
    wk = wk < 0 ? 0 : wk > 1 ? 1 : wk;
    const sp = g.uAirSandP.value;
    sp.x = S.opacity * (1 - wk * wk * (3 - 2 * wk));
    sp.y = S.bright;
    sp.z = S.scale > 1e-3 ? S.scale : 1e-3;
    sp.w = S.streak;
    const sq = g.uAirSandQ.value;
    sq.x = S.from;
    sq.y = S.full > S.from + 1e-3 ? S.full : S.from + 1e-3;
    sq.z = S.grains;
    sq.w = S.soft > 1e-3 ? S.soft : 1e-3;
    const sr = g.uAirSandR.value;
    sr.x = S.flatten;
    sr.y = S.fadeFrom / SAND_SIZE;
    sr.z = (S.fadeTo > S.fadeFrom + 1e-3 ? S.fadeTo : S.fadeFrom + 1e-3) / SAND_SIZE;
    sr.w = S.patches > 1e-3 ? S.patches : 1e-3;
    // Into the session's record the variant reads, while this is the world's field.
    if (this.bound) copyAirGround(g, this.bound);
    // The liquids' readers (the fifth wave's), every frame, plain on any frame the tile was not stepped.
    this.writeLiquid(this.live);
    // The grass's twin (the sixth wave's), the same way.
    this.writeGrass(this.live);
  }

  private frameDt = 0.5;
  private frameStorm = 0.5;
  private frameInflow = 0.5;
  /** The seventh wave's gust shed, as the dust pass reads it: its rate (times the art, thinned when wet), the height, spread and rise it is laid with. */
  private readonly shedP = new THREE.Vector4(0.5, 0.5, 0.5, 0.5);
  /** The devils handed this frame (the console's), and the three nearest's places in the pattern's table (-1 the local one). */
  private devilsHanded = 0;
  private readonly devilPick = new Int32Array(3);
  private readonly devilDist = new Float64Array(3);

  /**
   * The unified wind's dust devils into the forces (the seventh wave, the design's §2.17): the world's devils near (the
   * pattern's list, which every browser lists alike) and this browser's own (`__debug.wind({ devil })`), at most
   * `devils.inWindow` (three) of those whose reach touches the window, nearest the camera first, each at its envelope and
   * the wind's art; none with the arm or the devils off. Nothing made: a kept pick of three.
   */
  private pushDevils(): void {
    const camX = this.input.camX;
    const camZ = this.input.camZ;
    const f = this.forces;
    f.devilCount = 0;
    this.devilsHanded = 0;
    if (!WIND_STATE.on || !WIND_STATE.devils) return;
    const D = WIND_TUNE.devils;
    const most = D.inWindow < 3 ? (D.inWindow > 0 ? Math.round(D.inWindow) : 0) : 3;
    if (most <= 0) return;
    f.devilSpin = D.spin;
    f.devilShoves = D.shoves;
    f.devilInflow = D.inflow;
    f.devilSigma = D.sigma;
    f.devilHeights[0] = D.h0;
    f.devilHeights[1] = D.h1;
    f.devilHeights[2] = D.h2;
    f.devilHeights[3] = D.h3;
    const pick = this.devilPick;
    const dist = this.devilDist;
    let n = 0;
    const p = windPattern();
    const count = p ? p.devilCount : 0;
    const half = this.win.size * 0.5;
    // The pattern's devils, then the local one (index -1), each into the kept pick of the nearest.
    for (let i = -1; i < count; i++) {
      let x: number;
      let z: number;
      let core: number;
      if (i < 0) {
        if (!(WIND_LOCAL_DEVIL.until > WIND_FRAME.t)) continue;
        x = WIND_LOCAL_DEVIL.x;
        z = WIND_LOCAL_DEVIL.z;
        core = WIND_LOCAL_DEVIL.core;
      } else {
        const o = i * DEVIL_W;
        x = p!.devils[o];
        z = p!.devils[o + 1];
        core = p!.devils[o + 4];
      }
      const dx = x - camX;
      const dz = z - camZ;
      const reach = half + D.reach * core;
      if (dx < -reach || dx > reach || dz < -reach || dz > reach) continue;
      const d2 = dx * dx + dz * dz;
      let at = n < most ? n : most;
      while (at > 0 && dist[at - 1] > d2) {
        if (at < most) {
          dist[at] = dist[at - 1];
          pick[at] = pick[at - 1];
        }
        at--;
      }
      if (at < most) {
        dist[at] = d2;
        pick[at] = i;
        if (n < most) n++;
      }
    }
    const art = WIND_STATE.art;
    // Each into the forces' kept record and taken with nothing handed (a number handed to a call is boxed).
    const v = f.vq;
    for (let k = 0; k < n; k++) {
      const i = pick[k];
      if (i < 0) {
        const L = WIND_LOCAL_DEVIL;
        v[0] = L.x;
        v[1] = L.z;
        v[2] = L.core;
        v[3] = L.swirl * art;
        v[4] = 1;
        v[5] = D.dust * art;
      } else {
        const o = i * DEVIL_W;
        const T = p!.devils;
        const env = T[o + 13];
        const sw = T[o + 5];
        v[0] = T[o];
        v[1] = T[o + 1];
        v[2] = T[o + 4];
        v[3] = Math.abs(sw) * env * art;
        v[4] = sw < 0 ? -1 : 1;
        v[5] = D.dust * env * art;
      }
      f.vortexNow();
    }
    this.devilsHanded = f.devilCount;
  }

  /** The devils handed this frame and why none can be (the console's). */
  windDevilsReport(): { handed: number; why: string | null } {
    return { handed: this.devilsHanded, why: this.refused ? `the moving air cannot run here: ${this.refused}` : this.why };
  }

  /**
   * The calm day's dirt (the seventh wave, the design's §2.17): the gust shed's rate times the wind's art, thinned on wet
   * ground as the blowing sand is (none past `sand.wetFull`); nought with the unified wind's arm off, where the pass's own
   * branch is not taken either. Written by its components, as every number the frame writes.
   */
  private writeShed(): void {
    const sh = this.shedP;
    const S7 = WIND_TUNE.shed;
    if (WIND_STATE.on) {
      const wet = WEATHER_UNIFORMS.uWetness.value;
      const wetFull = AIR_TUNE.sand.wetFull > 1e-3 ? AIR_TUNE.sand.wetFull : 1e-3;
      let wk = wet / wetFull;
      wk = wk < 0 ? 0 : wk > 1 ? 1 : wk;
      sh.x = S7.rate * WIND_STATE.art * (1 - wk * wk * (3 - 2 * wk));
    } else sh.x = 0;
    sh.y = S7.at;
    sh.z = S7.sigma;
    sh.w = S7.rise;
  }

  /** The obstacle map drawn again: cleared, then the boxes MAX-blended into it (run plain, `AirDrawer.runPlain`). */
  private readonly obstacleDraw = (): void => {
    this.renderer.setClearColor(0x000000, 0);
    this.drawer.clear(this.obstacleMap);
    this.drawer.drawMesh(this.obs.mesh, this.obstacleMap);
  };

  /** The frame's draws, run the drawer's way (inside one render call when direct). */
  private readonly runFrame = (): void => {
    const t = this.tune;
    const d = this.drawer;
    const f = this.forces;
    const dt = this.frameDt;
    (this.mats.splat.uniforms.uWind.value as THREE.Vector2).set(this.windXZ.x, this.windXZ.z);
    this.syncTune();
    if (this.needsFill) {
      this.fillFields();
      this.needsFill = false;
    } else {
      if (this.sandFill) this.fillOffsets();
      if (this.smokeFill) this.fillSmoke();
    }
    // The solver's fixed steps.
    const clock = this.clock;
    clock.dt = dt;
    clock.rate = t.rate;
    clock.most = AIR_TUNE.step.most;
    fixedStepsIn(clock);
    const steps = clock.steps;
    const sdt = 1 / t.rate;
    f.stepDt = sdt;
    const m = this.mats;
    const vel = this.vel!;
    const prs = this.prs!;
    const nu = this.nums;
    for (let s = 0; s < steps; s++) {
      const first = s === 0;
      const count = f.buildStepBatch();
      m.splat.uniforms.uSplatCount.value = count;
      (m.splat.uniforms.uShift.value as THREE.Vector2).copy(first ? this.solverShift : ZERO2);
      m.splat.uniforms.uVel.value = vel[0].texture;
      d.draw(m.splat, vel[1]);
      swap(vel);
      if (first) f.consumeOneShots();
      m.vort.uniforms.uVel.value = vel[0].texture;
      const vp = this.vortP;
      vp.x = nu.swirl;
      vp.y = sdt;
      vp.z = AIR_TUNE.solver.cap;
      vp.w = AIR_TUNE.window.edge;
      d.draw(m.vort, vel[1]);
      swap(vel);
      m.div.uniforms.uVel.value = vel[0].texture;
      d.draw(m.div, this.div!);
      m.jacobi.uniforms.uDiv.value = this.div!.texture;
      for (let j = 0; j < t.solve; j++) {
        m.jacobi.uniforms.uPrs.value = prs[0].texture;
        this.jacobiP.x = j === 0 ? AIR_TUNE.solver.keep : 1;
        (m.jacobi.uniforms.uShift.value as THREE.Vector2).copy(first && j === 0 ? this.solverShift : ZERO2);
        d.draw(m.jacobi, prs[1]);
        swap(prs);
      }
      m.grad.uniforms.uPrs.value = prs[0].texture;
      m.grad.uniforms.uVel.value = vel[0].texture;
      d.draw(m.grad, vel[1]);
      swap(vel);
      m.advect.uniforms.uVel.value = vel[0].texture;
      const ap = this.advectP;
      ap.x = sdt;
      ap.y = AIR_TUNE.solver.dissipation;
      ap.z = AIR_TUNE.solver.relax;
      // The slabs' coupling (the third wave), with more than one layer solved.
      ap.w = this.slabCount.value > 1 ? AIR_TUNE.slabs.couple : 0;
      this.gustTime.x = AIR_TUNE.wind.gust;
      this.gustTime.y = this.worldTime;
      d.draw(m.advect, vel[1]);
      swap(vel);
      if (first) this.solverShift.set(0, 0);
      this.stats.steps++;
      this.lightDue = true;
    }
    // The dust, every frame, carried by the air as it stands (its pending scroll not yet carried if no step ran), the
    // shape it carries with it by the six laws (wave 2b's), both written by one draw.
    if (t.dust) {
      f.frameDt = dt;
      const n = f.buildDustBatch();
      if (n > 0) this.lastLift = this.worldTime;
      this.keepBand();
      const u = m.dust.uniforms;
      const dust = this.dustPair!;
      u.uDust.value = dust[0].textures[0];
      u.uShape.value = dust[0].textures[1];
      u.uVel.value = vel[0].texture;
      (u.uVelShift.value as THREE.Vector2).copy(this.solverShift);
      (u.uDustShift.value as THREE.Vector2).copy(this.dustShift);
      const dp = this.dustP;
      dp.x = dt;
      dp.y = nu.decay;
      dp.z = this.frameStorm;
      dp.w = AIR_TUNE.dust.stormShed;
      const dq = this.dustQ;
      dq.x = this.frameInflow;
      dq.y = nu.stormSigma * nu.stormSigma;
      dq.z = AIR_TUNE.dust.tint;
      dq.w = nu.stormWeight;
      // The streamers (the third wave): the threshold, the crest's and the edge's rates and the edge's reach in window uv;
      // the crest's sharpness and the shape a streamer is laid with.
      const D = AIR_TUNE.dust;
      const stp = this.streamP;
      stp.x = D.streamWind;
      stp.y = D.streamCrest;
      stp.z = D.streamOnEdge;
      stp.w = D.streamEdge / this.win.size;
      const stq = this.streamQ;
      stq.x = D.streamCurve;
      stq.y = D.streamHeight;
      stq.z = D.streamSpread;
      stq.w = D.streamRise;
      this.writeLaw();
      this.writeShed();
      u.uDustCount.value = n;
      this.gustTime.x = AIR_TUNE.wind.gust;
      this.gustTime.y = this.worldTime;
      (u.uSlopeGate.value as THREE.Vector2).set(AIR_TUNE.dust.slopeFrom, AIR_TUNE.dust.slopeTo);
      d.draw(m.dust, dust[1]);
      swap(dust);
      this.dust.value = dust[0].textures[0];
      this.shape.value = dust[0].textures[1];
      this.dustShift.set(0, 0);
      this.dustLive = true;
    }
    // Smoke and fog (the third wave), every frame by the frame's own dt, while either is on.
    if (t.smoke || t.fog) this.stepSmoke(vel[0].texture);
    // What the air carries besides dust (the fourth wave): the kick-up pool, every frame the field runs, after the dust
    // and the smoke (after the solver with them off), reading the air as it stands with its pending scroll.
    if (t.particles) this.stepKick(vel[0].texture);
    // The wisps' bands (the bands mode alone), once the dust of this frame is carried.
    if (this.wispMode === 1 && this.dustLive) this.stepBands(vel[0].texture);
    // The blowing sand's two phases, every frame by the frame's own dt, while the ground wears the air's variant and the
    // sand is on: each carried by slab 0's air past the lift threshold, and restarted every cycle with its overshoot
    // (wave 2b's, in place of the second wave's age and heal).
    if (t.sand && this.input.ground) {
      const u = m.offsets.uniforms;
      const pair = this.offsetsPair!;
      const G = AIR_TUNE.ground;
      u.uOffsets.value = pair[0].textures[0];
      u.uCarry.value = pair[0].textures[1];
      u.uVel.value = vel[0].texture;
      (u.uVelShift.value as THREE.Vector2).copy(this.solverShift);
      (u.uSandShift.value as THREE.Vector2).copy(this.sandShift);
      const uw = u.uWind.value as THREE.Vector2;
      uw.x = this.windXZ.x;
      uw.y = this.windXZ.z;
      const sp = this.sandP;
      sp.x = dt;
      // The lift threshold over the weather's own wind before any slab's share [demo `land.html:1895`].
      const ws = Math.sqrt(nu.windX * nu.windX + nu.windZ * nu.windZ);
      const thr0 = ws * G.liftOver + G.liftAdd;
      const thr = thr0 < G.liftCap ? thr0 : G.liftCap;
      sp.y = thr;
      sp.z = G.liftSpan;
      sp.w = G.lift;
      const ph = this.phase;
      const sq = this.sandQ;
      sq.x = ph.restartA;
      sq.y = ph.tA;
      sq.z = ph.restartB;
      sq.w = ph.tB;
      // A parcel from outside the window carries the inflow's own phases: the window's wind at slab 0's share, lifted by
      // the same rule (nought but in a gale past the threshold's cap, since the threshold sits over the wind).
      const share = AIR_TUNE.slabs.windShare;
      const inSpeed = ws * share;
      // `smoothstep(thr, thr + span, inSpeed)`, written out so no number crosses a call on the frame.
      const span = G.liftSpan > 1e-3 ? G.liftSpan : 1e-3;
      let st = (inSpeed - thr) / span;
      st = st < 0 ? 0 : st > 1 ? 1 : st;
      const inLift = st * st * (3 - 2 * st) * G.lift * share;
      const sr = this.sandR;
      sr.x = -nu.windX * inLift * ph.tA;
      sr.y = -nu.windZ * inLift * ph.tA;
      sr.z = -nu.windX * inLift * ph.tB;
      sr.w = -nu.windZ * inLift * ph.tB;
      // The sand carried in the air (the third wave): what it keeps over the frame (an exact exponential of the frame's
      // dt, so a streak runs as far onto rock at any frame rate) and its lift's soft step.
      const sc = this.sandC;
      sc.x = Math.exp(-AIR_TUNE.sand.carryFade * dt);
      sc.y = 20;
      d.draw(m.offsets, pair[1]);
      swap(pair);
      this.ground.uAirOffsets.value = pair[0].textures[0];
      this.ground.uAirCarry.value = pair[0].textures[1];
      this.sandShift.set(0, 0);
    }
    // The light toward the sun, once a frame that stepped: an optical depth at four heights (wave 2b's).
    if (t.light && this.lightDue) {
      const lu = m.light.uniforms;
      (lu.uSunDir.value as THREE.Vector2).set(nu.sunAcrossX, nu.sunAcrossZ);
      lu.uSteps.value = t.lightSteps;
      const lm = this.lightM;
      lm.elevation = nu.sunElevation;
      lm.steps = t.lightSteps;
      lightMarchIn(lm);
      const lp = this.lightP;
      lp.x = lm.step;
      lp.y = lm.slant;
      lp.z = lm.rise;
      lp.w = this.frameInflow;
      const lq = this.lightQ;
      lq.x = t.dustSelfShadow * AIR_TUNE.dust.extinction * AIR_TUNE.dust.height;
      lq.y = nu.stormSigma;
      lq.z = lm.invSin;
      lq.w = AIR_TUNE.dust.spreadMin;
      this.writeHeights();
      lu.uDust.value = this.dustPair![0].textures[0];
      lu.uShape.value = this.dustPair![0].textures[1];
      // The smoke and the fog on the way to the sun (the third wave): their own extinctions times the self-shadow, the
      // hour's fog top (a level one here: the march varies it), and whether either was carried this frame.
      lu.uSmoke.value = this.smokePair![0].textures[0];
      const lr = this.lightR;
      lr.x = t.dustSelfShadow * AIR_TUNE.smoke.extinction;
      lr.y = t.dustSelfShadow * AIR_TUNE.fog.extinction;
      lr.z = this.input.fogTop;
      lr.w = this.smokeLive ? 1 : 0;
      d.draw(m.light, this.lightTarget!);
      this.lightShift.value.set(0, 0);
      this.lightDue = false;
    }
  };

  /** The laws' numbers for this frame (`dustLawIn`, over the frame's `dt`), into the dust pass's vectors. */
  private writeLaw(): void {
    const law = this.law;
    law.dt = this.frameDt;
    dustLawIn(law);
    const a = this.dustLaw;
    a.x = law.e;
    a.y = law.i;
    a.z = law.fall;
    a.w = law.grow;
    const b = this.dustLawB;
    b.x = law.min2;
    b.y = law.max2;
    b.z = law.ageCap;
  }

  /**
   * Smoke and fog (the third wave, the design's §2.6), one draw a frame by the frame's own dt: the smoke batch laid (none
   * with the smoke off), the decay and the climb as exact exponentials of the frame, the fog's decay with the burn, its
   * emission and its bank by the hour's level (nought on a clear day), its drainage, and the patches' drift along the wind.
   * Every number goes through a kept vector; nothing crosses a call but the velocity texture.
   */
  private stepSmoke(vel: THREE.Texture): void {
    const t = this.tune;
    const f = this.forces;
    const dt = this.frameDt;
    const u = this.mats.smoke.uniforms;
    const pair = this.smokePair!;
    f.frameDt = dt;
    const n = f.buildSmokeBatch();
    if (n > 0) this.lastSmoke = this.worldTime;
    u.uSmoke.value = pair[0].textures[0];
    u.uSmokeTint.value = pair[0].textures[1];
    u.uVel.value = vel;
    (u.uVelShift.value as THREE.Vector2).copy(this.solverShift);
    (u.uSmokeShift.value as THREE.Vector2).copy(this.smokeShift);
    u.uSmokeCount.value = n;
    const S = AIR_TUNE.smoke;
    const F = AIR_TUNE.fog;
    const sp = this.smokeP;
    sp.x = dt;
    sp.y = Math.exp(-S.decay * dt);
    sp.z = 1 - Math.exp(-S.climb0 * dt);
    sp.w = 1 - Math.exp(-S.climb1 * dt);
    const inp = this.input;
    const level = t.fog && inp.fogLevel > 0 ? inp.fogLevel : 0;
    const burn = inp.fogBurn > 0 ? inp.fogBurn : 0;
    const fp = this.fogP;
    fp.x = Math.exp(-(F.decay + F.burn * burn) * dt);
    fp.y = F.emit * level;
    fp.z = F.bank * level;
    fp.w = F.drain;
    const fq = this.fogQ;
    fq.x = Math.tan((F.drainFrom > 0 ? F.drainFrom : 0) * DEG);
    fq.y = F.overWater;
    const cells = 1 / (F.patchScale > 0.5 ? F.patchScale : 0.5);
    fq.z = cells;
    fq.w = F.gaps > 0 ? (F.gaps < 0.99 ? F.gaps : 0.99) : 0;
    // The patches drift along the wind at `patchDrift` m/s, in noise cells, kept within the noise's repeat (exact, so the
    // wrap is never seen).
    const wx = this.windXZ.x;
    const wz = this.windXZ.z;
    const ws = Math.sqrt(wx * wx + wz * wz);
    if (ws > 1e-4) {
      const k = (F.patchDrift * dt * cells) / ws;
      this.fogDriftX = (this.fogDriftX + wx * k) % NOISE_SIZE;
      this.fogDriftZ = (this.fogDriftZ + wz * k) % NOISE_SIZE;
      const tc = 1 / (F.topScale > 0.5 ? F.topScale : 0.5);
      const kt = (F.patchDrift * dt * tc) / ws;
      const td = this.fogDrift.value;
      td.x = (td.x + wx * kt) % NOISE_SIZE;
      td.y = (td.y + wz * kt) % NOISE_SIZE;
    }
    const fr = this.fogR;
    fr.x = this.fogDriftX;
    fr.y = this.fogDriftZ;
    fr.z = t.smoke ? 1 : 0;
    fr.w = t.fog ? 1 : 0;
    this.fogS.x = F.poolMost > 0 ? F.poolMost : 0;
    this.gustTime.x = AIR_TUNE.wind.gust;
    this.gustTime.y = this.worldTime;
    this.drawer.draw(this.mats.smoke, pair[1]);
    swap(pair);
    this.smokeField.value = pair[0].textures[0];
    this.smokeTint.value = pair[0].textures[1];
    this.smokeShift.set(0, 0);
    this.smokeLive = true;
  }

  /**
   * The kick-up pool's update (the fourth wave): the air's pending scroll, the sand's lift threshold over the weather's own
   * wind (the blowing sand's, which leaves and pickups go by), the dust's look and the switches the draws read, then the
   * pool's own step over this frame's records. Every number through the pool's kept record.
   */
  private stepKick(vel: THREE.Texture): void {
    const k = this.kick;
    const kf = k.frame;
    const t = this.tune;
    k.velShift.x = this.solverShift.x;
    k.velShift.y = this.solverShift.y;
    const G = AIR_TUNE.ground;
    const nu = this.nums;
    const ws = Math.sqrt(nu.windX * nu.windX + nu.windZ * nu.windZ);
    const thr0 = ws * G.liftOver + G.liftAdd;
    kf.threshold = thr0 < G.liftCap ? thr0 : G.liftCap;
    kf.bright = t.dustBright;
    kf.lightOn = t.light && this.light.value !== null;
    kf.shadows = t.particleShadows;
    this.renderer.getDrawingBufferSize?.(this.bufSize);
    kf.screen = this.bufSize.y;
    // The fifth wave's ring flag: a drop of spray landing back on the water is kept a frame for the rings' draw.
    k.ring.x = this.ringsWanted ? 1 : 0;
    k.step(this.kickDraw, vel, this.spawns);
  }

  /**
   * Whether a drop of spray landing back on the water presses a ring into the ripples (the fifth wave): written by the
   * world each frame -- the master, the current, the ripples and the spray on, and a ripple state this browser can blend
   * into.
   */
  ringsWanted = false;

  /**
   * The spray's rings of this frame pressed into the ripples' state (`target`, the state the ripples' next step reads;
   * `win` its window), after the frame's update and only on a frame it ran with the spray on. Called by the world after
   * `update`. A render call of its own, the renderer's target put back.
   */
  ringsInto(target: THREE.WebGLRenderTarget | null, win: THREE.Vector4): void {
    if (!target || !this.ringsWanted || !this.live || !this.kick.shown || !this.tune.spray || this.drawer.broken) return;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const auto = r.autoClear;
    r.autoClear = false;
    try {
      this.kick.drawRings(r, target, win);
    } finally {
      r.setRenderTarget(prev);
      r.autoClear = auto;
    }
  }
  private readonly bufSize = new THREE.Vector2(1920, 1080);

  /**
   * The rain's frame (the fourth wave), called by the world after `update` on every path out of it, so the drops read this
   * frame's window and textures and fall past a doorway while the air indoors stands still: the anchor placed on this
   * frame's camera, the drops stepped with the air's velocity where the field ran its update (`live`) and the wind's inflow
   * otherwise (no air raster read then), the draw's numbers written. The world writes `rain.frame` first; a share of
   * nought (no rain or snow falling, space, the world of copies), the master off or the field refused draws nothing.
   */
  stepRain(): void {
    const r = this.rain;
    const t = this.tune;
    const f = r.frame;
    if (this.refused || this.drawer.broken || !t.on || !(t.rain || t.snow) || !(f.share > 0)) {
      r.drawing = false;
      r.mesh.visible = false;
      return;
    }
    r.ensure(t.rainDetail);
    // A step of nothing (a driven frame of no time): the drops hang where they are, drawn as they stood once they have stepped.
    if (!(f.dt > 0)) {
      r.drawing = r.stats.steps > 0 && !r.needsFill;
      r.writeDraws();
      return;
    }
    r.placeAnchor();
    f.live = this.live && this.vel !== null;
    f.winX = this.win.ox;
    f.winZ = this.win.oz;
    f.winSize = this.win.size;
    r.velShift.x = this.solverShift.x;
    r.velShift.y = this.solverShift.y;
    this.rainVel = f.live ? this.vel![0].texture : null;
    const g = this.renderer;
    const sv = this.saved;
    sv.target = g.getRenderTarget();
    sv.autoClear = g.autoClear;
    sv.alpha = g.getClearAlpha();
    g.getClearColor(sv.colour);
    g.autoClear = false;
    try {
      this.drawer.runPlain(this.rainStep);
    } finally {
      g.setRenderTarget(sv.target);
      g.autoClear = sv.autoClear;
      g.setClearColor(sv.colour, sv.alpha);
    }
    r.drawing = this.drawer.broken === null;
    r.writeDraws();
  }
  private rainVel: THREE.Texture | null = null;
  private readonly rainStep = (): void => {
    this.rain.step(this.kickDraw, this.rainVel);
  };

  /**
   * One foot landing, for the kick-up (the feet's chain, beside the dents' `dentStep`, the owner's `volFromFeet`): a running
   * foot -- faster than `feetRun` m/s from the body's last step -- kicks a couple of leaves off grass and forest litter,
   * and spray where it wades. Answers whether it kicked anything; never on a deck or indoors.
   */
  kickFeet(step: FootStep): boolean {
    const t = this.tune;
    const c = this.kickFeetCounts;
    c.steps++;
    if (!t.on || !t.air || !t.particles || !t.fromFeet || !this.forces.active || step.inside || step.deck !== null) return false;
    // Each body's last step in a fixed table of typed arrays (a body seen longest ago gives its place up): a step is on a
    // frame's path, and an object's number fields can be widened to a kind whose every write makes a number.
    const fk = this.feetKey;
    const fx = this.feetX;
    const fz = this.feetZ;
    const ft = this.feetT;
    const now = this.worldTime;
    let at = -1;
    let oldest = 0;
    for (let i = 0; i < fk.length; i++) {
      if (fk[i] === step.key) {
        at = i;
        break;
      }
      if (ft[i] < ft[oldest]) oldest = i;
    }
    if (at < 0) {
      fk[oldest] = step.key;
      fx[oldest] = step.x;
      fz[oldest] = step.z;
      ft[oldest] = now;
      return false;
    }
    const dx = step.x - fx[at];
    const dz = step.z - fz[at];
    const gap = now - ft[at];
    fx[at] = step.x;
    fz[at] = step.z;
    ft[at] = now;
    const P = AIR_TUNE.particles;
    if (!(gap > 1e-3) || !(Math.sqrt(dx * dx + dz * dz) / gap > P.feetRun)) return false;
    const w = this.win;
    const r = this.raster;
    const i = Math.floor((step.x - w.ox) / w.cell);
    const j = Math.floor((step.z - w.oz) / w.cell);
    if (i < 0 || j < 0 || i >= r.n || j >= r.n || r.known[j * r.n + i] !== 1) return false;
    const cell = j * r.n + i;
    const medium = r.colour[cell * 4 + 3];
    const a = this.spawns.arg;
    a[0] = step.x;
    a[1] = r.height[cell] + 0.1;
    a[2] = step.z;
    a[13] = KICK_LOOK.plain;
    a[14] = 0.3;
    a[15] = 3;
    if (step.from === 'water' || medium === MEDIUM_BYTE.water) {
      a[3] = P.feetSpray;
      a[4] = 0;
      a[5] = 2.5;
      a[6] = 0;
      a[7] = 1.2;
      a[8] = WHITE_PACKED;
      a[9] = P.spraySize;
      a[10] = P.sprayLife;
      a[11] = r.height[cell];
      a[12] = KICK_KIND.spray;
    } else if (medium === MEDIUM_BYTE.land && leafyClass(r.klass[cell])) {
      a[3] = P.feetLeaves;
      a[4] = 0;
      a[5] = 1.5;
      a[6] = 0;
      a[7] = 1;
      a[8] = this.packedAt(i, j);
      a[9] = P.leafSize;
      a[10] = P.leafLife;
      a[11] = 0;
      a[12] = KICK_KIND.leaf;
    } else return false;
    const ok = this.spawns.addArgs();
    if (ok) c.kicked++;
    return ok;
  }

  /** A cell's carried colour (`tintedAt`, linear), packed for a record (white where the cell is not known). */
  private packedAt(i: number, j: number): number {
    const out = this.tinted;
    if (!this.raster.tintedAt(i, j, out)) return WHITE_PACKED;
    return packColour(out[0], out[1], out[2]);
  }

  /**
   * A burst of a kind at a world point, for the console (`__debug.air({ particles: { kind, count } })`): its own record, as
   * a blast's would be, in the ground's colour there. Answers whether it was taken (the particles on, the field running,
   * the kind on, a place in the frame's table).
   */
  kickBurst(kind: number, count: number, x: number, y: number, z: number): boolean {
    if (!this.forces.spawns || !(kind >= 0 && kind < KICK_KINDS)) return false;
    const P = AIR_TUNE.particles;
    const w = this.win;
    const i = Math.floor((x - w.ox) / w.cell);
    const j = Math.floor((z - w.oz) / w.cell);
    const a = this.spawns.arg;
    a[0] = x;
    a[1] = y;
    a[2] = z;
    a[3] = count;
    a[4] = 0;
    a[5] = kind === KICK_KIND.spray ? 4 : kind === KICK_KIND.streak ? 3 : 2;
    a[6] = 0;
    a[7] = kind === KICK_KIND.streak ? 4 : 2;
    a[8] = kind === KICK_KIND.spray ? WHITE_PACKED : this.packedAt(i, j);
    a[9] = kind === KICK_KIND.leaf ? P.leafSize : kind === KICK_KIND.puff ? P.puffSize : kind === KICK_KIND.spray ? P.spraySize : P.streakWidth;
    a[10] = kind === KICK_KIND.leaf ? P.leafLife : kind === KICK_KIND.puff ? P.puffLife : kind === KICK_KIND.spray ? P.sprayLife : P.streakLife;
    a[11] = kind === KICK_KIND.spray ? y - 0.5 : 0;
    a[12] = kind;
    a[13] = KICK_LOOK.plain;
    a[14] = 1;
    a[15] = 4;
    return this.spawns.addArgs();
  }

  /** The wisps' bands (the bands mode, the third wave): the flow noise at the light's four heights, a pass at the dust's size. */
  private stepBands(vel: THREE.Texture): void {
    const u = this.mats.bands.uniforms;
    u.uVel.value = vel;
    u.uDust.value = this.dustPair![0].textures[0];
    u.uShape.value = this.dustPair![0].textures[1];
    (u.uVelShift.value as THREE.Vector2).copy(this.solverShift);
    this.drawer.draw(this.mats.bands, this.bandsTarget!);
    this.bands.value = this.bandsTarget!.texture;
  }

  /** Smoke and fog to nothing, both of their textures (with every field, or alone after a resize). */
  private fillSmoke(): void {
    const fd = this.mats.fillDust.uniforms;
    (fd.uValue.value as THREE.Vector4).set(0, 0, 0, 0);
    (fd.uShapeValue.value as THREE.Vector4).set(0, 0, 0, 0);
    for (const tg of this.smokePair!) this.drawer.draw(this.mats.fillDust, tg);
    this.smokeField.value = this.smokePair![0].textures[0];
    this.smokeTint.value = this.smokePair![0].textures[1];
    this.smokeShift.set(0, 0);
    this.smokeFill = false;
  }

  /** The light's four heights from the tune, into the vector the light pass and the march both read (lowest first, never out of order). */
  private writeHeights(): void {
    const L = AIR_TUNE.light;
    const h = this.lightHeights.value;
    h.x = L.h0;
    h.y = L.h1 > h.x ? L.h1 : h.x + 0.01;
    h.z = L.h2 > h.y ? L.h2 : h.y + 0.01;
    h.w = L.h3 > h.z ? L.h3 : h.z + 0.01;
  }

  /**
   * The band the march looks in (the design's §2.14): the highest top of a lift queued this frame is kept for
   * `airborneFor` seconds, beside the storm's `bandSigmas` of its spread; the band is the larger, never under four of H₀
   * and never over `volume.above`.
   */
  private keepBand(): void {
    const V = AIR_TUNE.volume;
    const top = this.forces.liftTop;
    const now = this.worldTime;
    if (now - this.liftTopAt > V.airborneFor) this.liftTopKept = 0;
    if (top > 0 && top >= this.liftTopKept) {
      this.liftTopKept = top;
      this.liftTopAt = now;
    }
  }

  /** The look the march reads (`AirSource.look`) and the band's top, from the tune and the storm as they stand: once a frame. */
  private writeLook(): void {
    const V = AIR_TUNE.volume;
    const H0 = AIR_TUNE.dust.height;
    let top = 4 * H0;
    if (this.worldTime - this.liftTopAt <= V.airborneFor && this.liftTopKept > top) top = this.liftTopKept;
    const storm = this.nums.storm > 0 ? V.bandSigmas * this.nums.stormSigma : 0;
    if (storm > top) top = storm;
    // The third wave's high band: smoke climbs through the slabs, so while any lingers the march looks to the ceiling;
    // the fog to the highest its varied top can stand.
    if (this.tune.smoke && this.worldTime - this.lastSmoke < AIR_TUNE.smoke.linger) top = V.above;
    if (this.tune.fog && this.worldTime - this.lastFog < AIR_TUNE.fog.linger) {
      const F = AIR_TUNE.fog;
      const ft = (this.input.fogTop > 0 ? this.input.fogTop : 0) * (1 + (F.topRise > 0 ? F.topRise : 0));
      if (ft > top) top = ft;
    }
    this.bandTop = top < V.above ? top : V.above;
    const l = this.look.value;
    l.x = this.tune.dustBright;
    l.y = this.dustView;
    l.z = this.bandTop;
    l.w = AIR_TUNE.dust.spreadMin;
    this.writeHeights();
  }

  /**
   * The third wave's look for the march, once a frame: the fog's hour (its top, whether it is carried, the top noise's
   * cells a metre, the level), the wisps' mode in force (the setting's, or off while the noise is not whole, and the bands
   * mode only while its target stands at the dust's size), their flow's two phases on the field's own clock and the
   * tune's numbers, every one written into a kept vector's components.
   */
  private writeAirLook(): void {
    const t = this.tune;
    const F = AIR_TUNE.fog;
    const inp = this.input;
    const fv = this.fog.value;
    fv.x = inp.fogTop > 0 ? inp.fogTop : 0;
    fv.y = t.fog ? 1 : 0;
    fv.z = 1 / (F.topScale > 0.5 ? F.topScale : 0.5);
    fv.w = t.fog && inp.fogLevel > 0 ? inp.fogLevel : 0;
    const mode = t.wisps > 0 && t.wisps < 4 && this.noiseTex !== null ? t.wisps : 0;
    this.wispMode = mode === 1 && (this.bandsTarget === null || this.bandsTarget.width < 2) ? 0 : mode;
    const W = AIR_TUNE.wisps;
    const ph = this.wispPhase;
    ph.time = this.worldTime;
    ph.period = W.period;
    wispPhaseIn(ph);
    const a = this.wispA.value;
    a.x = W.scale;
    a.y = W.stretch;
    a.z = W.period;
    a.w = W.octave;
    const b = this.wispB.value;
    b.x = ph.p0;
    b.y = ph.p1;
    b.z = ph.cross;
    b.w = W.ageWisp;
    const c = this.wispC.value;
    c.x = W.erode;
    c.y = W.erodeFull > 1e-3 ? W.erodeFull : 1e-3;
    c.z = W.keepColumn;
    c.w = W.keepFloor;
  }

  /**
   * The storm's colour eased toward the window's own (the design's §2.14): while a storm blows, at most every
   * `stormEase / 4` seconds, the shedding cells' colour weighted by their dust over every eighth cell each way (through
   * `tintedAt`, as the dust pass works it out), and then eased over `stormEase` (`stormEaseIn`). With no storm it holds.
   */
  private easeStorm(): void {
    if (!(this.frameStorm > 0)) return;
    const D = AIR_TUNE.dust;
    const s = this.storm;
    const ease = D.stormEase > 0.05 ? D.stormEase : 0.05;
    if (this.worldTime - this.stormReadAt >= ease / 4) {
      this.stormReadAt = this.worldTime;
      const r = this.raster;
      const n = r.n;
      const out = this.tinted;
      let wr = 0;
      let wg = 0;
      let wb = 0;
      let wt = 0;
      for (let j = 4; j < n; j += 8) {
        for (let i = 4; i < n; i += 8) {
          const k = (j * n + i) * 4;
          if (r.colour[k + 3] !== MEDIUM_BYTE.land) continue;
          const give = r.response[k + 3] / 255;
          if (!(give > 0)) continue;
          if (!r.tintedAt(i, j, out)) continue;
          wr += out[0] * give;
          wg += out[1] * give;
          wb += out[2] * give;
          wt += give;
        }
      }
      if (wt > 0) {
        s.tr = wr / wt;
        s.tg = wg / wt;
        s.tb = wb / wt;
      }
    }
    const c = this.stormColour.value;
    s.r = c.r;
    s.g = c.g;
    s.b = c.b;
    s.dt = this.frameDt;
    s.ease = ease;
    stormEaseIn(s);
    c.r = s.r;
    c.g = s.g;
    c.b = s.b;
  }

  /**
   * Every field to its inflow: the air to the wind's share, the pressure to nought, the dust to the storm's at its weight
   * with its shape (the half-normal standing on the ground, both outputs in one draw), the light to an optical depth of
   * nought (a transmittance of one, from wave 2b).
   */
  private fillFields(): void {
    const d = this.drawer;
    const v = this.mats.fill.uniforms.uValue.value as THREE.Vector4;
    const share = AIR_TUNE.slabs.windShare;
    v.set(this.windXZ.x * share, this.windXZ.z * share, 0, 1);
    for (const tg of this.vel!) d.draw(this.mats.fill, tg);
    v.set(0, 0, 0, 1);
    for (const tg of this.prs!) d.draw(this.mats.fill, tg);
    d.draw(this.mats.fill, this.div!);
    const c = this.stormColour.value;
    // With a dust field a layer (Ultra's), each tile starts with an even share of the storm's dust, which the inflow
    // then sorts into its slabs' own shares within a crossing of the window: the column's sum is the storm's.
    const inflow = this.frameInflow / (this.dustR.x > 1.5 ? this.dustR.x : 1);
    const fd = this.mats.fillDust.uniforms;
    (fd.uValue.value as THREE.Vector4).set(c.r * inflow, c.g * inflow, c.b * inflow, inflow);
    const sigma = this.nums.stormSigma;
    (fd.uShapeValue.value as THREE.Vector4).set(0, inflow * sigma * sigma, 0, 0);
    for (const tg of this.dustPair!) d.draw(this.mats.fillDust, tg);
    v.set(0, 0, 0, 0);
    d.draw(this.mats.fill, this.lightTarget!);
    this.dust.value = this.dustPair![0].textures[0];
    this.shape.value = this.dustPair![0].textures[1];
    this.fillOffsets();
    this.fillSmoke();
  }

  /**
   * The ground at rest: nothing carried by either phase, and no sand in the air (with every field, or the offsets alone
   * after a resize): both of the pair's textures, so the two-output fill.
   */
  private fillOffsets(): void {
    const fd = this.mats.fillDust.uniforms;
    (fd.uValue.value as THREE.Vector4).set(0, 0, 0, 0);
    (fd.uShapeValue.value as THREE.Vector4).set(0, 0, 0, 0);
    for (const tg of this.offsetsPair!) this.drawer.draw(this.mats.fillDust, tg);
    this.ground.uAirOffsets.value = this.offsetsPair![0].textures[0];
    this.ground.uAirCarry.value = this.offsetsPair![0].textures[1];
    this.sandShift.set(0, 0);
    this.sandFill = false;
  }

  /** Free the targets (the master turned off in play): the materials are kept for a later on, which makes them again (class T). */
  releaseTargets(): void {
    this.targetGen++;
    for (const p of [this.vel, this.prs, this.dustPair, this.offsetsPair, this.smokePair]) if (p) for (const tg of p) tg.dispose();
    this.div?.dispose();
    this.lightTarget?.dispose();
    this.bandsTarget?.dispose();
    this.vel = null;
    this.prs = null;
    this.dustPair = null;
    this.offsetsPair = null;
    this.smokePair = null;
    this.bandsTarget = null;
    this.div = null;
    this.lightTarget = null;
    this.sized = { cells: 0, dust: 0, light: 0, sand: 0, layers: 0, tiles: 0, smoke: 0, bands: 0, liquid: 0 };
    this.liquidCells = 0;
    this.dust.value = null;
    this.shape.value = null;
    this.light.value = null;
    this.smokeField.value = null;
    this.smokeTint.value = null;
    this.bands.value = null;
    this.velocity.value = null;
    this.dustLive = false;
    this.smokeLive = false;
    this.wispMode = 0;
    this.win.placed = false;
    this.forces.clear();
    // The dents' target too: a later on makes it again at its size (class T), and the ground reads nothing meanwhile.
    if (this.dents) {
      this.dents.clear();
      this.dents.target?.dispose();
      this.dents.target = null;
    }
    this.ground.uAirOffsets.value = null;
    this.ground.uAirCarry.value = null;
    this.ground.uAirDents.value = null;
    this.dentsLive = false;
    this.writeGround(false);
    // The fourth wave's pools too: made again at their sizes by a later on, their materials kept.
    this.kick.release();
    this.rain.release();
    this.spawns.clear();
    this.live = false;
  }

  /**
   * The world went (an unload): the next frame places the window afresh, which is the jump rule (every field to its
   * inflow), the rasters' cells are let go, the boxes forgotten and every queue and the console's engine dropped.
   */
  forgetWorld(): void {
    this.win.placed = false;
    this.raster.clear();
    this.obs.forget();
    this.forces.clear();
    this.dents?.clear();
    this.feet.clear();
    this.testEngine = null;
    this.lastLift = -Infinity;
    this.lastSmoke = -Infinity;
    this.lastFog = -Infinity;
    this.volumeDrew = false;
    this.dustLive = false;
    this.smokeLive = false;
    this.dentsLive = false;
    this.why = 'not yet stepped';
    this.writeGround(false);
    // The fourth wave's: the pools start empty in the next world, nothing staged or owed carried across.
    this.kick.clear();
    this.kick.hide(false);
    this.rain.clear();
    this.rain.drawing = false;
    this.rain.mesh.visible = false;
    this.spawns.clear();
    this.owed.clear();
    this.feetKey.fill(Number.NaN);
    this.feetT.fill(-Infinity);
    this.live = false;
  }

  /**
   * One foot landing (the feet's chain, the design's §2.7 "one owner for a footprint"): answers true, and presses a
   * dent, only while the dents are kept (the master, the prints and the feet on, the ground wearing the air's variant,
   * this browser blending floats), the prints' dial is above nought, the step is outdoors and not on a deck, it lands
   * inside the dent square on ground that gives (the response raster's), and the foot is on that ground and not on a
   * crate over it. Otherwise false, and the caller lays today's decal exactly as today. A step is either one or the
   * other, never both: a step that comes too soon after the body's last (a shuffle, a dance) is owned and lays nothing,
   * as today's decal path lays nothing for it. The feet are taken in turn and each print is stepped half a stance to its
   * own side, today's prints' rules (`footprints.ts`), and pressed toe and heel along the way the body faces.
   */
  dentStep(step: FootStep): boolean {
    const c = this.feetCounts;
    const t = this.tune;
    const d = this.dents;
    // `dentsLive` is last frame's word (the feet fire before the air's frame); the settings are this one's, and a switch
    // moved since (between frames, from the page or the console) is read here as the frame will read it, so a step the
    // frame will not keep is the decal's and never neither.
    if (!d || !this.dentsLive || !t.on || !t.air || !t.prints || !t.fromFeet || !(t.artPrints > 0) || !this.forces.active) {
      c.off++;
      c.decal++;
      return false;
    }
    if (step.inside || step.deck !== null || step.surface === null) {
      c.indoors++;
      c.decal++;
      return false;
    }
    // Every number below stays in this method or goes through a kept record (`d.oq`, the square's and the raster's own
    // fields): a footstep is on a frame's path, and a number handed across a call the compiler did not build in is one
    // made (the allocation lessons). The square test is `insideDentSquare`'s, the ground's `AirRaster.heightAt`'s.
    const P = AIR_TUNE.prints;
    const sx = step.x;
    const sz = step.z;
    const sq = d.square;
    const m = P.squareEdge;
    const x0 = sq.k0x * sq.t;
    const z0 = sq.k0z * sq.t;
    if (!sq.placed || !(sx >= x0 + m && sz >= z0 + m && sx <= x0 + sq.size - m && sz <= z0 + sq.size - m)) {
      c.offSquare++;
      c.decal++;
      return false;
    }
    const q = d.oq;
    q[0] = sx;
    q[1] = sz;
    d.giveAt();
    const w = this.win;
    const r = this.raster;
    const rn = r.n;
    if (!(d.give > 0)) {
      // A cell the raster has not read yet is counted apart from ground that gives nothing (the console's `feet`), so a
      // run of flat prints on ground not yet known can be told from rock.
      const ci = Math.floor((sx - w.ox) / w.cell);
      const cj = Math.floor((sz - w.oz) / w.cell);
      if (ci >= 0 && cj >= 0 && ci < rn && cj < rn && r.known[cj * rn + ci] !== 1) c.unknownGround++;
      else c.noGive++;
      c.decal++;
      return false;
    }
    // On the ground, not on a thing over it: the feet found an object under the foot, or the foot stands more than
    // `groundGap` off the raster's ground there -- read between the four cell middles round it, since on a dune's face a
    // cell's own middle stands a third of a metre off the ground under a foot at its edge.
    const fx = (sx - w.ox) / w.cell - 0.5;
    const fz = (sz - w.oz) / w.cell - 0.5;
    const gi = Math.floor(fx);
    const gj = Math.floor(fz);
    const gk = gj * rn + gi;
    let under = Number.NaN;
    if (gi >= 0 && gj >= 0 && gi + 1 < rn && gj + 1 < rn && r.known[gk] === 1 && r.known[gk + 1] === 1 && r.known[gk + rn] === 1 && r.known[gk + rn + 1] === 1) {
      const tx = fx - gi;
      const tz = fz - gj;
      const a = r.height[gk] + (r.height[gk + 1] - r.height[gk]) * tx;
      const b = r.height[gk + rn] + (r.height[gk + rn + 1] - r.height[gk + rn]) * tx;
      under = a + (b - a) * tz;
    }
    if (step.from === 'object' || !(Math.abs(step.y - under) <= P.groundGap)) {
      // Counted apart where the raster does not know the ground there yet, so the console can tell a flat print on a
      // ground not yet read from one on a crate.
      if (under !== under) c.unknownGround++;
      else c.offGround++;
      c.decal++;
      return false;
    }
    const scale = Math.min(PRINT_TUNE.maxScale, Math.max(0.2, step.scale > 0 ? step.scale : 1));
    const feet = this.footOf(step.key);
    const dx = sx - feet.x;
    const dz = sz - feet.z;
    const near = PRINT_TUNE.minStep * scale;
    if (feet.laid && dx * dx + dz * dz < near * near) {
      c.tooSoon++;
      return true;
    }
    const left = !feet.left;
    // `facingOf`'s, `sideOf`'s and `stanceOffset`'s own lines (`footprints.ts`): the way the body faces, its side, and
    // half a stance to the foot's own side. Written out here because the heading handed to them is a number across a
    // call, which the moving frames boxed once a step (`airDents.test.ts` holds the two to each other).
    const h = step.heading;
    const sinH = Math.sin(h);
    const cosH = Math.cos(h);
    const off = PRINT_TUNE.stance * scale * (left ? -1 : 1);
    q[0] = sx + cosH * off;
    q[1] = sz - sinH * off;
    q[2] = (P.footAlong * scale) / 2;
    q[3] = (P.footAcross * scale) / 2;
    q[4] = sinH;
    q[5] = cosH;
    q[6] = P.footDepth * scale;
    q[7] = DENT_KIND.foot;
    if (!d.oneShotArgs()) {
      // The foot itself on rock beside sand, or the queue full: today's decal, never nothing.
      c.full++;
      c.decal++;
      return false;
    }
    feet.left = left;
    feet.laid = true;
    feet.x = step.x;
    feet.z = step.z;
    c.dents++;
    return true;
  }

  /** A body's feet for `dentStep`: which is next and where the last print was. The least recently seen are let go past the prints' own cap. */
  private footOf(key: number): { left: boolean; x: number; z: number; laid: boolean; seen: number } {
    this.feetSeen++;
    const known = this.feet.get(key);
    if (known) {
      known.seen = this.feetSeen;
      return known;
    }
    const f = { left: false, x: 0, z: 0, laid: false, seen: this.feetSeen };
    this.feet.set(key, f);
    if (this.feet.size > PRINT_TUNE.bodies) {
      let oldest = Infinity;
      let oldestKey = key;
      for (const [k, v] of this.feet) {
        if (v.seen < oldest) {
          oldest = v.seen;
          oldestKey = k;
        }
      }
      this.feet.delete(oldestKey);
    }
    return f;
  }

  /** The world's dust as the console reads it: motes thrown while the air's dust was on, grains flying and lying, and the storm sheets' factor. */
  noteDust(motes: number, flying: number, lying: number, sheets: number): void {
    this.stats.motes = motes;
    this.stats.grainsFlying = flying;
    this.stats.grainsLying = lying;
    this.stats.sheets = sheets;
  }

  /**
   * The box kept clear of dust: the hull the player rides or stands in (the weather's own `weatherHull`), its group's
   * world matrix and its model box, or null for none. Written once a frame by the world; nothing is made.
   */
  setHull(matrixWorld: THREE.Matrix4 | null, min: readonly number[] | null, max: readonly number[] | null): void {
    const box = this.hullBox.value;
    if (!matrixWorld || !min || !max) {
      box.w = 0;
      return;
    }
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const inv = this.hullInverse.value;
    inv.copy(matrixWorld).invert();
    // Then into the box's own middle, so the volume tests |p| against the half sizes alone.
    hullShift.makeTranslation(-cx, -cy, -cz);
    inv.premultiply(hullShift);
    box.set(Math.abs(max[0] - min[0]) / 2, Math.abs(max[1] - min[1]) / 2, Math.abs(max[2] - min[2]) / 2, 1);
  }

  /** The field in numbers, for `__debug.air()`. */
  report(): Record<string, unknown> {
    const w = this.win;
    const t = this.tune;
    this.forces.takeCounts(this.counts);
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    return {
      stepping: this.stats.stepped,
      dustCarried: this.dustLive,
      why: this.why,
      refused: this.refused,
      draw: this.drawer.mode,
      window: { origin: [r2(w.ox), r2(w.oz)], size: w.size, cell: r2(w.cell), lastScroll: [this.stats.lastScrollX, this.stats.lastScrollZ], resets: this.stats.resets },
      grids: { air: `${this.tileCount.value} layer${this.tileCount.value > 1 ? 's' : ''} of ${t.airDetail}² RG16F pair, R16F pressure pair`, dust: `${t.dustLayers ? '3 tiles of ' : ''}${t.airDetail * t.dustDetail}² RGBA32F pair of two textures (the colour and density, the shape it carries)`, smoke: this.smokePair ? `${this.smokePair[0].width}² RGBA32F pair of two textures (a smoke a slab and the fog, the smoke's colour)` : 'not made', bands: this.bandsTarget && this.bandsTarget.width > 1 ? `${this.bandsTarget.width}² RGBA8` : 'not made (only in the bands mode)', light: `${t.airDetail * t.lightDetail}² RGBA16F (an optical depth toward the sun at ${AIR_TUNE.light.h0}, ${AIR_TUNE.light.h1}, ${AIR_TUNE.light.h2} and ${AIR_TUNE.light.h3} m)`, obstacles: `${t.airDetail}² RG16F (red the walls, green the walls and a compound's rooms)`, rasters: `${t.airDetail}² R32F height, RGBA8 response, colour and the colour map's tint` },
      shape: { bandTop: r2(this.bandTop), view: ['none', 'carried', 'lift', 'spread', 'age'][this.dustView] ?? 'none', sandView: this.sandView, stormColour: [r2(this.stormColour.value.r), r2(this.stormColour.value.g), r2(this.stormColour.value.b)], stormSigma: r2(this.inflow.value.y) },
      sand: { picture: this.sandTex ? 'whole' : this.sandPic ? `${this.sandPic.rows} of ${SAND_SIZE} rows made` : 'not begun (the grey stand-in)', phases: { tA: r2(this.phase.tA), tB: r2(this.phase.tB), cycles: [this.phase.kA, this.phase.kB] } },
      raster: { unknown: this.raster.unknown, asked: this.raster.asked, lowest: r2(this.raster.lowest), highest: r2(this.raster.highest), mean: r2(this.raster.mean) },
      obstacles: { boxes: this.obs.count, dropped: this.obs.dropped, gathers: this.obs.gathers, tooWide: this.obs.tooWide, rooms: this.obs.rooms, widest: { half: round4(this.obs.largest), at: [Math.round(this.obs.largestX), Math.round(this.obs.largestZ)], top: round4(this.obs.largestTop) } },
      // The sixth wave's among them: `peers` and `shuttles` (the engines since the console last read that were another
      // player's ride or a stood shuttle's), and the rides and the jets the world handed this frame.
      sources: {
        ...this.counts,
        queuedOneShots: this.forces.oneCount,
        enginesThisFrame: this.forces.engineCount,
        frontsAlive: this.forces.frontCount,
        ridesNear: this.world.rides?.n ?? 0,
        ridesAt: Array.from({ length: this.world.rides?.n ?? 0 }, (_, i) => [r2(this.world.rides!.x[i]), r2(this.world.rides!.y[i]), r2(this.world.rides!.z[i])]),
        jetsLit: this.world.jets?.n ?? 0,
        jetsAt: Array.from({ length: this.world.jets?.n ?? 0 }, (_, i) => [r2(this.world.jets!.x[i]), r2(this.world.jets!.y[i]), r2(this.world.jets!.z[i])]),
      },
      grass: { bound: this.grassBound !== null, share: this.grassBound ? r2(this.grassBound.uAirGrassP.value.x) : 0, reading: this.grassBound?.uAirGrassVel.value !== null && this.grassBound !== null },
      batch: { splats: this.forces.splatCount, of: SPLAT_BATCH, dust: this.forces.dustBatchCount, ofDust: DUST_BATCH },
      steps: this.stats.steps,
      draws: this.stats.draws,
      // The frame's own milliseconds are the frame report's `air` line (`__debug.perf()`, CPU and GPU): reading a clock
      // in the step made a number every frame.
      timing: 'see __debug.perf(): the air line',
      hasAir: this.hasAir(),
      wind: { x: r2(this.windXZ.x), z: r2(this.windXZ.z) },
      storm: r2(this.input.storm),
      motes: this.stats.motes,
      grains: { flying: this.stats.grainsFlying, lying: this.stats.grainsLying },
      stormSheets: r2(this.stats.sheets),
      // The third wave's: smoke and fog carried this frame, the smoke batch, the fog's hour, the wisps.
      smoke: { on: t.smoke, carried: this.smokeLive, batch: this.forces.smokeBatchCount, ofBatch: SMOKE_BATCH, held: this.forces.smokeHeldCount },
      fog: { on: t.fog, level: r2(this.input.fogLevel), burn: r2(this.input.fogBurn), top: r2(this.input.fogTop), lingering: this.worldTime - this.lastFog < AIR_TUNE.fog.linger },
      wisps: { setting: ['off', 'bands', 'noise', 'noise ×2'][t.wisps] ?? 'off', inForce: ['off', 'bands', 'noise', 'noise ×2'][this.wispMode] ?? 'off', noise: this.noiseTex ? 'whole' : this.noiseVol ? `${this.noiseVol.layers} of ${NOISE3_SIZE} layers made` : 'not begun', phase: [r2(this.wispPhase.p0), r2(this.wispPhase.p1)], cross: r2(this.wispPhase.cross) },
      layers: { air: this.slabCount.value, dust: t.dustLayers ? 3 : 1, couple: this.slabCount.value > 1 ? AIR_TUNE.slabs.couple : 0 },
      ground: this.groundReport(),
      particles: this.particleReport(),
      liquid: this.liquidReport(),
    };
  }

  /**
   * The fifth wave's in numbers (no readback here; `air({ liquid: { probe } })` reads the tile back): the tile's size and
   * whether it is stepped, what the readers are told (the art shares, the view, the crust's phases), the record bound, the
   * pokes the pushes laid on the water since the console last read, and the rings.
   */
  private liquidReport(): Record<string, unknown> {
    const t = this.tune;
    const rec = this.liquidBound;
    const pokes = this.forces.pokes;
    this.forces.pokes = 0;
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    return {
      current: t.current,
      lava: t.lava,
      tile: this.liquidCells > 0 ? `${this.liquidCells}² beside the slabs in the RG16F atlas` : 'none (the current and the lava both off)',
      stepped: this.liquidLive,
      bound: rec !== null,
      told: rec ? { water: r3(rec.uAirLiquidP.value.x), lava: r3(rec.uAirLiquidP.value.y), detailFlow: r3(rec.uAirLiquidP.value.z), view: ['none', 'current', 'crust'][rec.uAirLiquidP.value.w] ?? 'none', crust: { tA: r3(rec.uAirLiquidQ.value.x), tB: r3(rec.uAirLiquidQ.value.y), wB: r3(rec.uAirLiquidQ.value.z) } } : null,
      flow: { cells: this.raster.n, any: this.raster.flow.some((v) => v !== 0) },
      pokes,
      rings: { wanted: this.ringsWanted, draws: this.kick.ringDraws },
      carry: { runs: this.carry.stats.runs, lastSeconds: r3(this.carry.stats.lastSeconds) },
    };
  }

  /**
   * The liquid's tile read back at a world point (console only, a GPU sync): the current there, m/s, or null outside the
   * window, with no tile or before the field has stepped it. Never on a frame path.
   */
  liquidAt(x: number, z: number): { vx: number; vz: number; speed: number; medium: number } | null {
    if (!this.vel || this.liquidCells <= 0 || !this.win.placed) return null;
    const w = this.win;
    const lx = (x - w.ox) / w.size;
    const lz = (z - w.oz) / w.size;
    if (!(lx >= 0 && lz >= 0 && lx <= 1 && lz <= 1)) return null;
    const o = this.slabCount.value * 4;
    const tgt = this.vel[0];
    const read = readHalf(this.renderer, tgt);
    if (!read) return null;
    const px = Math.min(tgt.width - 1, Math.floor((this.tiles[o] + lx * this.tiles[o + 2]) * tgt.width));
    const py = Math.min(tgt.height - 1, Math.floor((this.tiles[o + 1] + lz * this.tiles[o + 3]) * tgt.height));
    const p = (py * tgt.width + px) * read.comps;
    const vx = THREE.DataUtils.fromHalfFloat(read.data[p]);
    const vz = THREE.DataUtils.fromHalfFloat(read.data[p + 1]);
    return { vx: Math.round(vx * 1000) / 1000, vz: Math.round(vz * 1000) / 1000, speed: Math.round(Math.sqrt(vx * vx + vz * vz) * 1000) / 1000, medium: this.raster.mediumAt(w.ox, w.oz, w.cell, x, z) };
  }

  /**
   * The grass's lean at a world point (console only, a GPU sync; the sixth wave): slab 0's air read back there, the way
   * the twin reads it, and the twin's own lean worked out from it by its CPU mirror (`grassLeanIn`) at the share the
   * record holds now, for the top of a tuft `h` metres tall: how far over along the air and how far down, metres. Null
   * off the window or with no record bound.
   */
  grassLeanAt(x: number, z: number, h = 1): { vx: number; vz: number; speed: number; share: number; over: number; down: number } | null {
    const rec = this.grassBound;
    if (!this.vel || !rec || !this.win.placed) return null;
    const w = this.win;
    const lx = (x - w.ox) / w.size;
    const lz = (z - w.oz) / w.size;
    if (!(lx >= 0 && lz >= 0 && lx <= 1 && lz <= 1)) return null;
    const tgt = this.vel[0];
    const read = readHalf(this.renderer, tgt);
    if (!read) return null;
    const px = Math.min(tgt.width - 1, Math.floor((this.tiles[0] + lx * this.tiles[2]) * tgt.width));
    const py = Math.min(tgt.height - 1, Math.floor((this.tiles[1] + lz * this.tiles[3]) * tgt.height));
    const p = (py * tgt.width + px) * read.comps;
    const vx = THREE.DataUtils.fromHalfFloat(read.data[p]);
    const vz = THREE.DataUtils.fromHalfFloat(read.data[p + 1]);
    const P = rec.uAirGrassP.value;
    const r = newGrassLean();
    r.lx = lx;
    r.ly = lz;
    r.vx = vx;
    r.vz = vz;
    r.lev = 1;
    r.h = h;
    r.share = P.x;
    r.full = P.y;
    r.most = P.z;
    r.sink = P.w;
    r.edgeBand = rec.uAirGrassWin.value.w;
    grassLeanIn(r);
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    return { vx: r3(vx), vz: r3(vz), speed: r3(Math.sqrt(vx * vx + vz * vz)), share: r3(P.x), over: r3(Math.sqrt(r.x * r.x + r.z * r.z)), down: r3(-r.y) };
  }

  /** The most current anywhere on the liquid's tile, m/s (console only, a GPU sync): what the carry is handed at most. */
  liquidPeak(): number | null {
    if (!this.vel || this.liquidCells <= 0) return null;
    const o = this.slabCount.value * 4;
    const tgt = this.vel[0];
    const read = readHalf(this.renderer, tgt);
    if (!read) return null;
    const x0 = Math.round(this.tiles[o] * tgt.width);
    const y0 = Math.round(this.tiles[o + 1] * tgt.height);
    const n = this.liquidCells;
    let peak = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p = ((y0 + j) * tgt.width + x0 + i) * read.comps;
        const vx = THREE.DataUtils.fromHalfFloat(read.data[p]);
        const vz = THREE.DataUtils.fromHalfFloat(read.data[p + 1]);
        const s = Math.sqrt(vx * vx + vz * vz);
        if (Number.isFinite(s) && s > peak) peak = s;
      }
    }
    return Math.round(peak * 1000) / 1000;
  }

  /**
   * The fourth wave's in numbers (no readback: `air({ particles: { count: true } })` reads the pool back): each kind's
   * switch, slots and picture (or why it has none), what the sources asked for since the console last read, the frames the
   * pool stepped and those it was hidden while the field ran (none, or the draw hangs), the rain's drawing and anchor.
   */
  private particleReport(): Record<string, unknown> {
    const t = this.tune;
    const k = this.kick;
    const names = ['leaves', 'puffs', 'spray', 'streaks'];
    const kinds: Record<string, unknown> = {};
    for (let i = 0; i < KICK_KINDS; i++) kinds[names[i]] = { on: k.on[i], slots: k.rows[i] * k.width, drawn: k.meshes[i].visible, picture: i === 3 ? 'ours, drawn in the shader' : k.pictures[i] ? k.pictures[i]!.name || 'borrowed' : null, why: k.why[i], spawned: k.stats.spawned[i] };
    const seen = this.spawns.seen;
    this.spawns.resetSeen();
    for (let i = 0; i < KICK_KINDS; i++) k.stats.spawned[i] = 0;
    const r = this.rain;
    const feet = { ...this.kickFeetCounts };
    this.kickFeetCounts.steps = 0;
    this.kickFeetCounts.kicked = 0;
    return {
      on: t.particles,
      live: this.live,
      kinds,
      asked: seen,
      steps: k.stats.steps,
      hiddenWhileRun: k.stats.hiddenWhileRun,
      fills: k.stats.fills,
      corner: { y: k.cornerY },
      feet,
      // The sky's light the blended kinds and the rain take (linear), as the world wrote it this frame.
      light: { sun: this.kickLight.sunColour.value.toArray().map((v) => Math.round(v * 1000) / 1000), ambient: this.kickLight.ambient.value.toArray().map((v) => Math.round(v * 1000) / 1000), sunDir: this.kickLight.sunDir.value.toArray().map((v) => Math.round(v * 1000) / 1000) },
      blur: 'the particles blur only with the camera: their motion lives in a texture the motion blur cannot read',
      rain: { on: t.rain, snow: t.snow, drawing: r.drawing, drops: r.count, share: Math.round(r.frame.share * 1000) / 1000, live: r.frame.live, anchor: [r.anchor.x, r.anchor.y, r.anchor.z], steps: r.stats.steps, readAir: r.stats.live, inflow: r.stats.inflow, anchorMoves: r.stats.anchorMoves, jumps: r.stats.jumps, fills: r.stats.fills },
    };
  }

  /** The ground's marks in numbers (the second wave): what the variant is told, the dents' square and counts, the feet. */
  private groundReport(): Record<string, unknown> {
    const t = this.tune;
    const a = this.ground.uAirArt.value;
    const d = this.dents;
    const dc: DentCounts = { oneShots: 0, laid: 0, dropped: 0, slots: 0, noGive: 0, offSquare: 0, ticks: 0, cleared: 0 };
    if (d) d.takeCounts(dc);
    const sq = d?.square;
    const feet = { ...this.feetCounts };
    for (const k of Object.keys(this.feetCounts) as (keyof typeof this.feetCounts)[]) this.feetCounts[k] = 0;
    const cells = this.raster.n * this.raster.n;
    return {
      worn: this.input.ground,
      bound: this.bound !== null,
      // The share of the window whose ground the raster has not read yet: no drift, dent or print is laid there (a
      // step there is today's decal, `feet.unknownGround`).
      unknownShare: cells > 0 ? Math.round((this.raster.unknown / cells) * 1000) / 1000 : null,
      art: { sand: a.x, prints: a.y, shade: a.z, standing: a.w === 1 },
      offsets: this.offsetsPair ? `${this.offsetsPair[0].width}² RGBA32F pair` : 'not made',
      dents: !this.floatBlend
        ? "none: this browser cannot blend into a float target (EXT_float_blend), so every footprint is today's decal"
        : d && d.target
          ? { live: this.dentsLive, grid: `${d.target.width}² R32F`, square: sq && sq.placed ? { origin: [Math.round(sq.k0x * sq.t * 100) / 100, Math.round(sq.k0z * sq.t * 100) / 100], size: sq.size, texel: Math.round(sq.t * 10000) / 10000 } : null, ...dc, sources: d.slots }
          : 'not made: the prints are off',
      feet,
      prints: t.prints,
      sand: t.sand,
    };
  }

  /**
   * Read the fields back off the card (console only, a GPU sync): the dust's total and peak and where the peak is,
   * and the air's fastest; with `points`, the most dust within `radius` metres of each and the light pass's
   * transmittance toward the sun there. Never on a frame path.
   */
  measure(points: readonly (readonly [number, number])[] = [], radius = 4): ({ dustTotal: number; dustPeak: number; peakAt: [number, number] | null; dustMiddle: [number, number] | null; speedPeak: number; speed: { mean: number; peakAt: [number, number] | null; liftAt: number; overLift: number; overFourWinds: number }; samples: number; at: MeasurePoint[]; solid: number | null; roomsOnly: number | null; tallest: number; upwind: { velocity: [number, number]; inflow: [number, number]; off: number } | null; shape: ShapeMeasure | null; smokeFog: SmokeMeasure | null } & GroundMeasure) | null {
    if (!this.dustPair || !this.vel) return null;
    const r = this.renderer;
    const dt = this.dustPair[0];
    const buf = readFloat(r, dt);
    if (!buf) return null;
    // The shape the dust carries, the pair's second texture (from wave 2b).
    const sbuf = readFloat(r, dt, 1);
    const w0 = this.win;
    const lt = this.lightTarget;
    const lr = lt ? readHalf(r, lt) : null;
    const at0: MeasurePoint[] = [];
    for (const [x, z] of points) {
      let most: number | null = null;
      let mostAt = -1;
      const span = Math.ceil(radius / (w0.size / dt.width));
      const ci = Math.floor(((x - w0.ox) / w0.size) * dt.width);
      const cj = Math.floor(((z - w0.oz) / w0.size) * dt.height);
      for (let j = cj - span; j <= cj + span; j++) {
        for (let i = ci - span; i <= ci + span; i++) {
          if (i < 0 || j < 0 || i >= dt.width || j >= dt.height) continue;
          const a = buf[(j * dt.width + i) * 4 + 3];
          if (Number.isFinite(a) && (most === null || a > most)) {
            most = a;
            mostAt = j * dt.width + i;
          }
        }
      }
      // The light pass's optical depth toward the sun at its four heights there, and the transmittance at the ground.
      let light: number | null = null;
      let tau: number[] | null = null;
      if (lt && lr) {
        const li = Math.floor(((x - w0.ox) / w0.size) * lt.width);
        const lj = Math.floor(((z - w0.oz) / w0.size) * lt.height);
        if (li >= 0 && lj >= 0 && li < lt.width && lj < lt.height) {
          const p = (lj * lt.width + li) * lr.comps;
          tau = [];
          for (let c = 0; c < Math.min(4, lr.comps); c++) tau.push(round4(THREE.DataUtils.fromHalfFloat(lr.data[p + c])));
          light = round4(Math.exp(-Math.max(0, tau[0])));
        }
      }
      // The densest texel's carried shape: its mean height, spread and age.
      let mu: number | null = null;
      let sigma: number | null = null;
      let age: number | null = null;
      let colour: [number, number, number] | null = null;
      if (most !== null && most >= 1e-5 && mostAt >= 0) {
        const k = mostAt * 4;
        colour = [round4(buf[k] / most), round4(buf[k + 1] / most), round4(buf[k + 2] / most)];
        if (sbuf) {
          const m = sbuf[k] / most;
          mu = round4(m);
          sigma = round4(Math.sqrt(Math.max(sbuf[k + 1] / most - m * m, AIR_TUNE.dust.spreadMin * AIR_TUNE.dust.spreadMin)));
          age = round4(sbuf[k + 3] / most);
        }
      }
      const medium = this.raster.mediumAt(w0.ox, w0.oz, w0.cell, x, z);
      at0.push({ x, z, dust: most === null ? null : Math.round(most * 10000) / 10000, mu, sigma, age, colour, light, tau, shed: Math.round(this.raster.dustAt(w0.ox, w0.oz, w0.cell, x, z) * 1000) / 1000, medium: medium === 85 ? 'land' : medium === 170 ? 'water' : medium === 255 ? 'lava' : 'unknown' });
    }
    const shape = sbuf ? this.shapeOver(buf, sbuf, dt.width, dt.height) : null;
    let total = 0;
    let peak = 0;
    let at = -1;
    // The dust's own middle (density-weighted), in a tile's own texels (the Ultra key's tiles laid side by side are one
    // window each), so a blast's dust and a speeder's can be followed apart by measuring each alone.
    const tw = this.tune.dustLayers ? dt.width / 3 : dt.width;
    let mx = 0;
    let mz = 0;
    for (let i = 0; i < dt.width * dt.height; i++) {
      const a = buf[i * 4 + 3];
      if (!Number.isFinite(a)) continue;
      total += a;
      mx += a * (((i % dt.width) % tw) + 0.5);
      mz += a * (Math.floor(i / dt.width) + 0.5);
      if (a > peak) {
        peak = a;
        at = i;
      }
    }
    const v = this.vel[0];
    let speedPeak = 0;
    let upwind: { velocity: [number, number]; inflow: [number, number]; off: number } | null = null;
    // How the air's speed stands over the window: its mean, where its fastest is, and the share of cells past the sand's lift
    // threshold (the second wave: past it, the ground's pattern drifts) and past four times the wind.
    let speedSum = 0;
    let speedAt = -1;
    let overLift = 0;
    let overWind = 0;
    const ws = Math.sqrt(this.windXZ.x * this.windXZ.x + this.windXZ.z * this.windXZ.z);
    const G = AIR_TUNE.ground;
    const liftAt = Math.min(ws * G.liftOver + G.liftAdd, G.liftCap);
    const read = readHalf(r, v);
    if (read) {
      const { data, comps } = read;
      for (let i = 0; i < v.width * v.height; i++) {
        const x = THREE.DataUtils.fromHalfFloat(data[i * comps]);
        const z = THREE.DataUtils.fromHalfFloat(data[i * comps + 1]);
        const s = Math.sqrt(x * x + z * z);
        if (!Number.isFinite(s)) continue;
        speedSum += s;
        if (s > liftAt) overLift++;
        if (s > 4 * ws + 1) overWind++;
        if (s > speedPeak) {
          speedPeak = s;
          speedAt = i;
        }
      }
      // The edge the wind comes in through (the slab-0 tile is the whole atlas in this wave): its mean velocity one texel
      // in, against the inflow the solver holds outside the window (the wind times slab 0's share).
      const share = AIR_TUNE.slabs.windShare;
      const ix = this.windXZ.x * share;
      const iz = this.windXZ.z * share;
      if (ix * ix + iz * iz > 1e-6) {
        const alongX = Math.abs(ix) >= Math.abs(iz);
        const n = alongX ? v.height : v.width;
        let sx = 0;
        let sz = 0;
        for (let k = 0; k < n; k++) {
          const col = alongX ? (ix > 0 ? 1 : v.width - 2) : k;
          const row = alongX ? k : iz > 0 ? 1 : v.height - 2;
          const p = (row * v.width + col) * comps;
          sx += THREE.DataUtils.fromHalfFloat(data[p]);
          sz += THREE.DataUtils.fromHalfFloat(data[p + 1]);
        }
        sx /= n;
        sz /= n;
        const dx = sx - ix;
        const dz = sz - iz;
        upwind = { velocity: [round4(sx), round4(sz)], inflow: [round4(ix), round4(iz)], off: round4(Math.sqrt(dx * dx + dz * dz) / Math.sqrt(ix * ix + iz * iz)) };
      }
    }
    const w = this.win;
    const peakAt: [number, number] | null = at >= 0 ? [Math.round((w.ox + ((at % dt.width) + 0.5) * (w.size / dt.width)) * 10) / 10, Math.round((w.oz + (Math.floor(at / dt.width) + 0.5) * (w.size / dt.height)) * 10) / 10] : null;
    const dustMiddle: [number, number] | null = total > 1e-6 ? [Math.round((w.ox + (mx / total) * (w.size / tw)) * 10) / 10, Math.round((w.oz + (mz / total) * (w.size / dt.height)) * 10) / 10] : null;
    // How much of the window the obstacle map holds solid to the air and the dust (red, a top over `over`), and its
    // tallest; and how much the volume keeps clear of dust besides (green: the walls and a compound's rooms).
    let solid: number | null = null;
    let roomsOnly: number | null = null;
    let tallest = 0;
    const om = readHalf(r, this.obstacleMap);
    if (om) {
      let n = 0;
      let g = 0;
      const cells = this.obstacleMap.width * this.obstacleMap.height;
      for (let i = 0; i < cells; i++) {
        const top = THREE.DataUtils.fromHalfFloat(om.data[i * om.comps]);
        const mask = om.comps > 1 ? THREE.DataUtils.fromHalfFloat(om.data[i * om.comps + 1]) : top;
        if (top > AIR_TUNE.obstacles.over) n++;
        else if (mask > AIR_TUNE.obstacles.over) g++;
        if (top > tallest) tallest = top;
      }
      solid = round4(n / cells);
      roomsOnly = round4(g / cells);
    }
    return { dustTotal: Math.round(total * 1000) / 1000, dustPeak: Math.round(peak * 10000) / 10000, peakAt, dustMiddle, speedPeak: Math.round(speedPeak * 100) / 100, speed: { mean: Math.round((speedSum / Math.max(1, v.width * v.height)) * 100) / 100, peakAt: speedAt >= 0 ? [Math.round((w0.ox + ((speedAt % v.width) + 0.5) * (w0.size / v.width)) * 10) / 10, Math.round((w0.oz + (Math.floor(speedAt / v.width) + 0.5) * (w0.size / v.height)) * 10) / 10] : null, liftAt: round4(liftAt), overLift: round4(overLift / Math.max(1, v.width * v.height)), overFourWinds: round4(overWind / Math.max(1, v.width * v.height)) }, samples: dt.width * dt.height, at: at0, solid, roomsOnly, tallest: round4(tallest), upwind, shape, smokeFog: this.measureSmoke(points, radius), ...this.measureGround(points, radius) };
  }

  /** Smoke and fog read back (console only, a GPU sync): null while neither is carried or the pair is a texel across. */
  private measureSmoke(points: readonly (readonly [number, number])[], radius: number): SmokeMeasure | null {
    const sp = this.smokePair;
    if (!sp || sp[0].width < 2) return null;
    const t = sp[0];
    const buf = readFloat(this.renderer, t);
    if (!buf) return null;
    const w = this.win;
    const n = t.width;
    const slabs: [number, number, number] = [0, 0, 0];
    let sPeak = 0;
    let sAt = -1;
    let fTotal = 0;
    let fPeak = 0;
    let fAt = -1;
    let fogged = 0;
    let fx = 0;
    let fz = 0;
    const G = 16;
    const grid = new Array<number>(G * G).fill(0);
    const gridN = new Array<number>(G * G).fill(0);
    for (let i = 0; i < n * t.height; i++) {
      const k = i * 4;
      const s = buf[k] + buf[k + 1] + buf[k + 2];
      if (Number.isFinite(s)) {
        slabs[0] += buf[k];
        slabs[1] += buf[k + 1];
        slabs[2] += buf[k + 2];
        if (s > sPeak) {
          sPeak = s;
          sAt = i;
        }
      }
      const f = buf[k + 3];
      if (Number.isFinite(f)) {
        fTotal += f;
        fx += f * ((i % n) + 0.5);
        fz += f * (Math.floor(i / n) + 0.5);
        const g = Math.floor(((Math.floor(i / n) + 0.5) / t.height) * G) * G + Math.floor((((i % n) + 0.5) / n) * G);
        grid[g] += f;
        gridN[g]++;
        if (f > 0.1) fogged++;
        if (f > fPeak) {
          fPeak = f;
          fAt = i;
        }
      }
    }
    const cell = w.size / n;
    const place = (i: number): [number, number] => [Math.round((w.ox + ((i % n) + 0.5) * cell) * 10) / 10, Math.round((w.oz + (Math.floor(i / n) + 0.5) * cell) * 10) / 10];
    // The fog over the lowest and the highest quarter of the known ground, each raster cell the mean of its fog texels.
    let hollow: number | null = null;
    let rise: number | null = null;
    const r = this.raster;
    if (r.n > 1 && n % r.n === 0) {
      const per = n / r.n;
      const cells: [number, number][] = [];
      for (let j = 0; j < r.n; j++) {
        for (let i = 0; i < r.n; i++) {
          if (!r.known[j * r.n + i]) continue;
          let sum = 0;
          let cnt = 0;
          for (let b = 0; b < per; b++) {
            for (let a = 0; a < per; a++) {
              const f = buf[((j * per + b) * n + (i * per + a)) * 4 + 3];
              if (Number.isFinite(f)) {
                sum += f;
                cnt++;
              }
            }
          }
          if (cnt) cells.push([r.height[j * r.n + i], sum / cnt]);
        }
      }
      if (cells.length >= 8) {
        cells.sort((p, q) => p[0] - q[0]);
        const q = Math.max(1, Math.floor(cells.length / 4));
        let lo = 0;
        let hi = 0;
        for (let i = 0; i < q; i++) {
          lo += cells[i][1];
          hi += cells[cells.length - 1 - i][1];
        }
        hollow = round4(lo / q);
        rise = round4(hi / q);
      }
    }
    const area = cell * cell;
    const at: SmokeMeasure['at'] = [];
    for (const [x, z] of points) {
      let fog: number | null = null;
      let smoke: [number, number, number] | null = null;
      let best = -1;
      const span = Math.ceil(radius / cell);
      const ci = Math.floor((x - w.ox) / cell);
      const cj = Math.floor((z - w.oz) / cell);
      for (let j = cj - span; j <= cj + span; j++) {
        for (let i = ci - span; i <= ci + span; i++) {
          if (i < 0 || j < 0 || i >= n || j >= t.height) continue;
          const k = (j * n + i) * 4;
          if (Number.isFinite(buf[k + 3]) && (fog === null || buf[k + 3] > fog)) fog = buf[k + 3];
          const s = buf[k] + buf[k + 1] + buf[k + 2];
          if (Number.isFinite(s) && s > best) {
            best = s;
            smoke = [round4(buf[k]), round4(buf[k + 1]), round4(buf[k + 2])];
          }
        }
      }
      at.push({ x, z, fog: fog === null ? null : round4(fog), smoke });
    }
    return {
      slabs: [round4(slabs[0] * area), round4(slabs[1] * area), round4(slabs[2] * area)],
      smokePeak: round4(sPeak),
      smokeAt: sAt >= 0 ? place(sAt) : null,
      fogTotal: round4(fTotal * area),
      fogPeak: round4(fPeak),
      fogAt: fAt >= 0 ? place(fAt) : null,
      fogged: round4(fogged / (n * t.height)),
      fogMiddle: fTotal > 1e-6 ? [Math.round((w.ox + (fx / fTotal) * cell) * 10) / 10, Math.round((w.oz + (fz / fTotal) * cell) * 10) / 10] : null,
      hollow,
      rise,
      fogGrid: grid.map((v, i) => round4(gridN[i] ? v / gridN[i] : 0)),
      at,
    };
  }

  /**
   * The dust's shape over the window, read back (console only): the mean height and spread weighted by the dust's mass,
   * the highest mean of any texel holding more than a trace and where it is, and the youngest and oldest dust.
   */
  private shapeOver(buf: Float32Array, sbuf: Float32Array, width: number, height: number): ShapeMeasure {
    const w = this.win;
    const trace = 1e-3;
    let mass = 0;
    let m1 = 0;
    let m2 = 0;
    let highest = 0;
    let highestAt = -1;
    let youngest: number | null = null;
    let oldest: number | null = null;
    for (let i = 0; i < width * height; i++) {
      const D = buf[i * 4 + 3];
      if (!(D >= trace) || !Number.isFinite(D)) continue;
      const k = i * 4;
      const mu = sbuf[k] / D;
      const q = sbuf[k + 1] / D;
      const age = sbuf[k + 3] / D;
      if (!Number.isFinite(mu) || !Number.isFinite(q)) continue;
      mass += D;
      m1 += sbuf[k];
      m2 += sbuf[k + 1];
      if (mu > highest) {
        highest = mu;
        highestAt = i;
      }
      if (Number.isFinite(age)) {
        if (youngest === null || age < youngest) youngest = age;
        if (oldest === null || age > oldest) oldest = age;
      }
    }
    const mean = mass > 0 ? m1 / mass : 0;
    const spread = mass > 0 ? Math.sqrt(Math.max(m2 / mass - mean * mean, 0)) : 0;
    const at: [number, number] | null = highestAt >= 0 ? [Math.round((w.ox + ((highestAt % width) + 0.5) * (w.size / width)) * 10) / 10, Math.round((w.oz + (Math.floor(highestAt / width) + 0.5) * (w.size / height)) * 10) / 10] : null;
    return { mu: round4(mean), sigma: round4(spread), highest: round4(highest), highestAt: at, youngest: youngest === null ? null : round4(youngest), oldest: oldest === null ? null : round4(oldest) };
  }

  /**
   * The ground's marks read back (console only, a GPU sync): the carried offsets' largest and how many texels carry one
   * past a centimetre, and the dents' deepest and their sum over the square; at each point the largest offset and the
   * deepest dent within `radius`. Never on a frame path.
   */
  private measureGround(points: readonly (readonly [number, number])[], radius: number): GroundMeasure {
    const r = this.renderer;
    const w = this.win;
    let offsets: { peak: number; moved: number; peakAt: [number, number] | null; blowing: number; carried: number } | null = null;
    const op = this.offsetsPair;
    const oread = op ? readFloat(r, op[0]) : null;
    // The sand carried in the air (the third wave): the share of the window where it stands past a twentieth.
    const cread = op ? readFloat(r, op[0], 1) : null;
    if (op && oread) {
      const n = op[0].width;
      let peak = 0;
      let moved = 0;
      let blowing = 0;
      let carried = 0;
      if (cread) for (let i = 0; i < n * n; i++) if (cread[i * 4 + 3] > 0.05) carried++;
      let at = -1;
      const ph = this.phase;
      const from = AIR_TUNE.sand.from;
      for (let i = 0; i < n * n; i++) {
        const ax = oread[i * 4];
        const az = oread[i * 4 + 1];
        const bx = oread[i * 4 + 2];
        const bz = oread[i * 4 + 3];
        const m = Math.max(Math.sqrt(ax * ax + az * az), Math.sqrt(bx * bx + bz * bz));
        if (!Number.isFinite(m)) continue;
        if (m > 0.01) moved++;
        // Blowing where the shader's strength would lay any sand: the carry read off the two phases past `sand.from`.
        if (sandStrength(ax, az, bx, bz, ph.tA, ph.tB, AIR_TUNE.sand.cycle) > from) blowing++;
        if (m > peak) {
          peak = m;
          at = i;
        }
      }
      offsets = { peak: round4(peak), moved, peakAt: at >= 0 ? [Math.round((w.ox + ((at % n) + 0.5) * (w.size / n)) * 10) / 10, Math.round((w.oz + (Math.floor(at / n) + 0.5) * (w.size / n)) * 10) / 10] : null, blowing: round4(blowing / (n * n)), carried: round4(carried / (n * n)) };
    }
    let dents: { peak: number; total: number; pressed: number; peakAt: [number, number] | null } | null = null;
    const d = this.dents;
    const dread = d && d.target ? readRed(r, d.target) : null;
    if (d && d.target && dread) {
      const sq = d.square;
      const n = d.target.width;
      let peak = 0;
      let total = 0;
      let pressed = 0;
      let at = -1;
      for (let i = 0; i < n * n; i++) {
        const v = dread[i];
        if (!Number.isFinite(v)) continue;
        total += v;
        if (v > 0.002) pressed++;
        if (v > peak) {
          peak = v;
          at = i;
        }
      }
      // A toroidal texel back to the world: the texel of the square that holds it.
      const worldOf = (i: number, k0: number): number => (k0 + ((((i - k0) % n) + n) % n) + 0.5) * sq.t;
      dents = { peak: round4(peak), total: round4(total * sq.t * sq.t), pressed, peakAt: at >= 0 && sq.placed ? [Math.round(worldOf(at % n, sq.k0x) * 10) / 10, Math.round(worldOf(Math.floor(at / n), sq.k0z) * 10) / 10] : null };
    }
    const ground: { x: number; z: number; offset: number | null; dent: number | null }[] = [];
    for (const [x, z] of points) {
      let off: number | null = null;
      if (op && oread) {
        const n = op[0].width;
        const span = Math.ceil(radius / (w.size / n));
        const ci = Math.floor(((x - w.ox) / w.size) * n);
        const cj = Math.floor(((z - w.oz) / w.size) * n);
        for (let j = cj - span; j <= cj + span; j++) {
          for (let i = ci - span; i <= ci + span; i++) {
            if (i < 0 || j < 0 || i >= n || j >= n) continue;
            const p = (j * n + i) * 4;
            const m = Math.max(Math.sqrt(oread[p] * oread[p] + oread[p + 1] * oread[p + 1]), Math.sqrt(oread[p + 2] * oread[p + 2] + oread[p + 3] * oread[p + 3]));
            if (Number.isFinite(m) && (off === null || m > off)) off = m;
          }
        }
      }
      let dent: number | null = null;
      if (d && d.target && dread && d.square.placed) {
        const sq = d.square;
        const n = d.target.width;
        const span = Math.ceil(radius / sq.t);
        const kx = Math.floor(x / sq.t);
        const kz = Math.floor(z / sq.t);
        for (let j = kz - span; j <= kz + span; j++) {
          if (j < sq.k0z || j >= sq.k0z + n) continue;
          for (let i = kx - span; i <= kx + span; i++) {
            if (i < sq.k0x || i >= sq.k0x + n) continue;
            const v = dread[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
            if (Number.isFinite(v) && (dent === null || v > dent)) dent = v;
          }
        }
      }
      ground.push({ x, z, offset: off === null ? null : round4(off), dent: dent === null ? null : round4(dent) });
    }
    return { offsets, dents, ground };
  }

  /**
   * Known inputs through the programs, read back and held to `airMath.ts` (console only, a GPU sync, never in a frame):
   * the fills (the dust's both outputs under both draw ways, the light's optical depth of nought), the dust settling
   * over one tenth of a second of still air with a rising patch's shape and a falling one's stepped by the six laws
   * (`dustShapeStep`, through the floor the pass writes through), a splat's amount and shape, and its colour against
   * `tintedColourIn` over known bytes in the drawn ground's own tint mode, and the light pass's four heights over even
   * dust toward a sun 35 degrees up against `lightDepthAt`. Each answer says what it expected and what it read; every
   * material's link log is listed. The fields are filled again from their inflow afterwards, so the air starts again
   * from the wind.
   */
  selfTest(): Record<string, unknown> {
    if (this.refused) return { refused: this.refused };
    const r = this.renderer;
    const gl = r.getContext() as WebGL2RenderingContext;
    this.ensureTargets();
    const sv = this.saved;
    sv.target = r.getRenderTarget();
    sv.autoClear = r.autoClear;
    sv.alpha = r.getClearAlpha();
    r.getClearColor(sv.colour);
    r.autoClear = false;
    const d = this.drawer;
    const mode = d.mode;
    d.mode = 'calls';
    const checks: { name: string; expected: number; read: number | null; tolerance: number; ok: boolean }[] = [];
    const note = (name: string, expected: number, read: number | null, tolerance: number): void => {
      checks.push({ name, expected: round4(expected), read: read === null ? null : round4(read), tolerance, ok: read !== null && Math.abs(read - expected) <= tolerance });
    };
    try {
      const fill = this.mats.fill;
      const value = fill.uniforms.uValue.value as THREE.Vector4;
      // The fill, read back off the velocity's half floats.
      value.set(3, -2, 0, 1);
      d.draw(fill, this.vel![0]);
      const vr = readHalf(r, this.vel![0]);
      const mid = (this.vel![0].height >> 1) * this.vel![0].width + (this.vel![0].width >> 1);
      note('fill: velocity x', 3, vr ? THREE.DataUtils.fromHalfFloat(vr.data[mid * vr.comps]) : null, 0.01);
      note('fill: velocity z', -2, vr ? THREE.DataUtils.fromHalfFloat(vr.data[mid * vr.comps + 1]) : null, 0.01);
      // Still air, nothing solid.
      value.set(0, 0, 0, 1);
      d.draw(fill, this.vel![0]);
      r.setClearColor(0x000000, 0);
      d.clear(this.obstacleMap);
      const dust = this.dustPair!;
      const fd = this.mats.fillDust.uniforms;
      const fdV = fd.uValue.value as THREE.Vector4;
      const fdS = fd.uShapeValue.value as THREE.Vector4;
      const mid4 = ((dust[0].height >> 1) * dust[0].width + (dust[0].width >> 1)) * 4;
      const dmid = mid4 + 3;
      // The fill writes both of the dust's outputs, under both draw ways (wave 2b's two-texture pair).
      for (const way of ['calls', 'direct'] as const) {
        d.mode = way;
        fdV.set(0.2, 0.1, 0.05, 0.5);
        fdS.set(0.15, 0.08, -0.2, 1);
        d.run(() => d.draw(this.mats.fillDust, dust[0]), this.home);
        const a = readFloat(r, dust[0]);
        const b = readFloat(r, dust[0], 1);
        note(`fill (${way}): the dust's density`, 0.5, a ? a[dmid] : null, 1e-6);
        note(`fill (${way}): the shape's second moment`, 0.08, b ? b[mid4 + 1] : null, 1e-6);
        note(`fill (${way}): the shape's rise, below nought`, -0.2, b ? b[mid4 + 2] : null, 1e-6);
      }
      d.mode = 'calls';
      // The dust settling over 0.1 s in still air, nothing lifting it, and its shape stepped by the six laws, once a
      // rising patch and once a falling one (its rise below nought, which the floor must leave alone), each under one of
      // the two draw ways: held to `dustShapeStep` through the floor the pass writes through (`shapeFloor`).
      const u = this.mats.dust.uniforms;
      u.uVel.value = this.vel![0].texture;
      (u.uVelShift.value as THREE.Vector2).set(0, 0);
      (u.uDustShift.value as THREE.Vector2).set(0, 0);
      const decay = dustDecayFrame(0.1, AIR_TUNE.dust.settle);
      const lawDt = 0.1;
      const patches: { name: string; way: 'calls' | 'direct'; mu: number; s2: number; w: number; age: number }[] = [
        { name: 'a rising patch', way: 'calls', mu: 0.3, s2: 0.0625, w: 2, age: 0.5 },
        { name: 'a falling patch', way: 'direct', mu: 1.5, s2: 0.25, w: -0.4, age: 3 },
      ];
      for (const p of patches) {
        const D0 = 0.5;
        fdV.set(0.2, 0.1, 0.05, D0);
        fdS.set(D0 * p.mu, D0 * (p.s2 + p.mu * p.mu), D0 * p.w, D0 * p.age);
        d.draw(this.mats.fillDust, dust[0]);
        u.uDust.value = dust[0].textures[0];
        u.uShape.value = dust[0].textures[1];
        this.dustP.set(lawDt, decay, 0, AIR_TUNE.dust.stormShed);
        this.dustQ.set(0, 0, AIR_TUNE.dust.tint, 1);
        this.frameDt = lawDt;
        this.writeLaw();
        u.uDustCount.value = 0;
        d.mode = p.way;
        d.run(() => d.draw(this.mats.dust, dust[1]), this.home);
        d.mode = 'calls';
        const dr = readFloat(r, dust[1]);
        const sr = readFloat(r, dust[1], 1);
        const t: ShapeTexel = { d: D0 * decay, r: D0 * p.mu * decay, g: D0 * (p.s2 + p.mu * p.mu) * decay, b: D0 * p.w * decay, a: D0 * p.age * decay };
        dustShapeStep(t, this.law);
        shapeFloor(t);
        note(`dust (${p.way}): ${p.name} settles as (1 + h / settle)^(-dt / h)`, D0 * decay, dr ? dr[dmid] : null, 1e-4);
        note(`dust (${p.way}): ${p.name}, D·μ by the laws`, t.r, sr ? sr[mid4] : null, 1e-4 + 1e-4 * Math.abs(t.r));
        note(`dust (${p.way}): ${p.name}, D·(σ² + μ²) by the laws`, t.g, sr ? sr[mid4 + 1] : null, 1e-4 + 1e-4 * Math.abs(t.g));
        note(`dust (${p.way}): ${p.name}, D·w by the laws (signed)`, t.b, sr ? sr[mid4 + 2] : null, 1e-4 + 1e-4 * Math.abs(t.b));
        note(`dust (${p.way}): ${p.name}, D·age by the laws`, t.a, sr ? sr[mid4 + 3] : null, 1e-4 + 1e-4 * Math.abs(t.a));
      }
      // The frame's dust batch, one splat on the middle texel of nothing: first over a ground of known dust (white land,
      // all dust, flat), so the batch and the shader are held apart from the rasters; then over the window's own ground,
      // held to what the CPU rasters say the ground there gives, read as the pass reads them. Settling is turned off for
      // both (decay 1).
      {
        const D = dust[1];
        const cx = ((D.width >> 1) + 0.5) / D.width;
        const cz = ((D.height >> 1) + 0.5) / D.height;
        const amount = 0.25;
        const batch = this.forces.dustBatch;
        const rr = 2 / this.win.size;
        batch[0] = cx;
        batch[1] = cz;
        batch[2] = 1 / (rr * rr);
        batch[3] = amount;
        const shapeBatch = this.forces.dustShapeBatch;
        shapeBatch[0] = 0.3;
        shapeBatch[1] = 0.25;
        shapeBatch[2] = 3;
        shapeBatch[3] = 0;
        const known = this.knownGround();
        const keepGround = this.height.value;
        fdV.set(0, 0, 0, 0);
        fdS.set(0, 0, 0, 0);
        try {
          d.draw(this.mats.fillDust, dust[0]);
          u.uDust.value = dust[0].textures[0];
          u.uShape.value = dust[0].textures[1];
          this.dustP.set(1 / 60, 1, 0, 0);
          this.frameDt = 1 / 60;
          this.writeLaw();
          u.uDustCount.value = 1;
          (u.uSlopeGate.value as THREE.Vector2).set(AIR_TUNE.dust.slopeFrom, AIR_TUNE.dust.slopeTo);
          u.uResponse.value = known.response;
          u.uColour.value = known.colour;
          u.uTint.value = known.tint;
          this.height.value = known.height;
          d.draw(this.mats.dust, D);
          const kr = readFloat(r, D);
          const ks = readFloat(r, D, 1);
          note('dust: a batch splat lays its amount over ground that gives all its dust', amount, kr ? kr[dmid] : null, 1e-3);
          // The splat lays its own shape beside its dust: D·μ₀ and D·(σ₀² + μ₀²) where nothing was.
          note("dust: the splat's shape, D·μ₀", amount * 0.3, ks ? ks[mid4] : null, 1e-3);
          note("dust: the splat's shape, D·(σ₀² + μ₀²)", amount * (0.25 * 0.25 + 0.3 * 0.3), ks ? ks[mid4 + 1] : null, 1e-3);
          note("dust: the splat's shape, D·w₀", amount * 3, ks ? ks[mid4 + 2] : null, 1e-3);
          // The colour of a splat over a known colour and a known tint, against the dust pass's mirror (`tintedColourIn`)
          // in the drawn ground's own mode, read off the tile program's uniforms the pass holds by reference.
          d.draw(this.mats.fillDust, dust[0]);
          u.uColour.value = known.colourLit;
          u.uTint.value = known.tintLit;
          d.draw(this.mats.dust, D);
          const cr = readFloat(r, D);
          const gt = u.uGroundTint.value as THREE.Vector4;
          const gr0 = u.uGroundTintRef.value as THREE.Vector4;
          const ref = { rgb: [gr0.x, gr0.y, gr0.z] as const, luminance: gr0.w };
          const want = tintedColourIn(KNOWN_COLOUR, 0, KNOWN_TINT, 0, AIR_TUNE.dust.tint, srgbDecode, (c, out) => tintGamma(c, gt.x, ref, gt.y, out), { c: [0, 0, 0], t: [0, 0, 0] }, [0, 0, 0]);
          const got = cr && cr[dmid] > 1e-6 ? [cr[mid4] / cr[dmid], cr[mid4 + 1] / cr[dmid], cr[mid4 + 2] / cr[dmid]] : null;
          for (let ch = 0; ch < 3; ch++) note(`dust: a splat's colour, channel ${ch}, the lighter tones times the ground's tint (mode ${gt.x})`, want[ch], got ? got[ch] : null, 1e-3);
          u.uResponse.value = this.responseTex;
          u.uColour.value = this.colourTex;
          u.uTint.value = this.tintTex;
          this.height.value = keepGround;
          d.draw(this.mats.fillDust, dust[0]);
          d.draw(this.mats.dust, D);
          const gr = readFloat(r, D);
          // What the pass gives there, read as the pass reads it: the rasters filtered linearly at the texel's middle
          // (a texel off its cell's middle takes a share of the cells round it), the land test on the filtered medium
          // byte, and the slope's gate from the filtered heights a cell either way. Read off the one cell alone, the
          // check failed wherever the window's middle stood on a border of two grounds or on a slope (a town's paving).
          const n = this.raster.n;
          const at = (a: ArrayLike<number>, c: number, s: number, u: number, v: number): number => {
            const x = u * n - 0.5;
            const y = v * n - 0.5;
            const i0 = Math.floor(x);
            const j0 = Math.floor(y);
            const fx = x - i0;
            const fy = y - j0;
            const get = (i: number, j: number): number => a[((Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))) * s) + c];
            return (get(i0, j0) * (1 - fx) + get(i0 + 1, j0) * fx) * (1 - fy) + (get(i0, j0 + 1) * (1 - fx) + get(i0 + 1, j0 + 1) * fx) * fy;
          };
          const rv = this.raster;
          const land = Math.abs(at(rv.colour, 3, 4, cx, cz) / 255 - 0.3333) < 0.1 ? 1 : 0;
          const tx = 1 / n;
          const gx = (at(rv.height, 0, 1, cx + tx, cz) - at(rv.height, 0, 1, cx - tx, cz)) / (2 * this.win.cell);
          const gz = (at(rv.height, 0, 1, cx, cz + tx) - at(rv.height, 0, 1, cx, cz - tx)) / (2 * this.win.cell);
          const slope = (Math.atan(Math.sqrt(gx * gx + gz * gz)) * 180) / Math.PI;
          const sf = AIR_TUNE.dust.slopeFrom;
          const st = AIR_TUNE.dust.slopeTo;
          let sg = st > sf ? (slope - sf) / (st - sf) : slope < sf ? 0 : 1;
          sg = sg < 0 ? 0 : sg > 1 ? 1 : sg;
          const gate = 1 - sg * sg * (3 - 2 * sg);
          const give = (at(rv.response, 3, 4, cx, cz) / 255) * land * gate;
          note(`dust: over the window's own ground, the raster's dust there as the pass reads it (${round4(give)}: ${land ? 'land' : 'not land'}, a ${round4(slope)}° slope)`, amount * give, gr ? gr[dmid] : null, 0.15 * amount * give + 2e-3);
        } finally {
          u.uResponse.value = this.responseTex;
          u.uColour.value = this.colourTex;
          u.uTint.value = this.tintTex;
          this.height.value = keepGround;
          u.uDustCount.value = 0;
        }
      }
      // A fill writes the light an optical depth of nought (a transmittance of one), from wave 2b.
      const lt = this.lightTarget!;
      const lmid = (lt.height >> 1) * lt.width + (lt.width >> 1);
      value.set(0, 0, 0, 0);
      d.draw(fill, lt);
      const lf = readHalf(r, lt);
      note('light: a fill writes an optical depth of nought', 0, lf ? THREE.DataUtils.fromHalfFloat(lf.data[lmid * lf.comps]) : null, 1e-6);
      // The light pass at its four heights over even dust of 0.5 at 0.3 ± 0.25 m on flat ground, the sun 35 degrees up
      // toward +X, against the mirror (`lightDepthAt`) of the march's own extinction.
      {
        const known = this.knownGround();
        const keepGround = this.height.value;
        try {
          this.height.value = known.height;
          const D0 = 0.5;
          const mu = 0.3;
          const sigma = 0.25;
          fdV.set(0.2, 0.1, 0.05, D0);
          fdS.set(D0 * mu, D0 * (sigma * sigma + mu * mu), 0, 0);
          d.draw(this.mats.fillDust, dust[0]);
          const el = (35 * Math.PI) / 180;
          const steps = this.tune.lightSteps;
          const lm = this.lightM;
          lightMarchFor(el, steps, lm);
          lm.sunX = 1;
          lm.sunZ = 0;
          lm.k = this.tune.dustSelfShadow * AIR_TUNE.dust.extinction * AIR_TUNE.dust.height;
          lm.inflow = 0;
          lm.stormSigma = 1;
          lm.size = this.win.size;
          this.writeHeights();
          const hv = this.lightHeights.value;
          lm.heights = [hv.x, hv.y, hv.z, hv.w];
          const lu = this.mats.light.uniforms;
          (lu.uSunDir.value as THREE.Vector2).set(1, 0);
          lu.uSteps.value = steps;
          this.lightP.set(lm.step, lm.slant, lm.rise, 0);
          this.lightQ.set(lm.k, 1, lm.invSin, AIR_TUNE.dust.spreadMin);
          // No smoke or fog on the way (the third wave's), so the dust alone is held to its mirror.
          this.lightR.set(0, 0, 0, 0);
          lu.uSmoke.value = this.smokePair![0].textures[0];
          lu.uDust.value = dust[0].textures[0];
          lu.uShape.value = dust[0].textures[1];
          d.draw(this.mats.light, lt);
          const lr = readHalf(r, lt);
          const want = lightDepthAt(
            (_u: number, _v: number, s: LightSample) => {
              s.d = D0;
              s.mu = mu;
              s.sigma = sigma;
              s.ground = 0;
            },
            0.5,
            0.5,
            lm,
            [0, 0, 0, 0],
          );
          for (let c = 0; c < 4; c++) {
            const got = lr ? THREE.DataUtils.fromHalfFloat(lr.data[lmid * lr.comps + c]) : null;
            note(`light: the optical depth toward the sun at ${lm.heights[c]} m`, want[c], got, 2e-3 + 2e-3 * want[c]);
          }
        } finally {
          this.height.value = keepGround;
        }
      }
      // Smoke and fog (the third wave): a known smoke a slab and fog in still air over nothing solid, no source and no
      // emission, stepped over a tenth of a second under each draw way, held to `smokeStep` (the decay, then the climb)
      // and to the fog's own decay; the smoke's colour dies with it.
      {
        const sm = this.smokePair!;
        const smid = ((sm[0].height >> 1) * sm[0].width + (sm[0].width >> 1)) * 4;
        const su = this.mats.smoke.uniforms;
        const S = AIR_TUNE.smoke;
        const F = AIR_TUNE.fog;
        const sdt = 0.1;
        for (const way of ['calls', 'direct'] as const) {
          fdV.set(0.4, 0.2, 0.1, 0.3);
          fdS.set(0.08, 0.06, 0.04, 0.7);
          d.draw(this.mats.fillDust, sm[0]);
          su.uSmoke.value = sm[0].textures[0];
          su.uSmokeTint.value = sm[0].textures[1];
          su.uVel.value = this.vel![0].texture;
          (su.uVelShift.value as THREE.Vector2).set(0, 0);
          (su.uSmokeShift.value as THREE.Vector2).set(0, 0);
          su.uSmokeCount.value = 0;
          this.smokeP.set(sdt, Math.exp(-S.decay * sdt), 1 - Math.exp(-S.climb0 * sdt), 1 - Math.exp(-S.climb1 * sdt));
          this.fogP.set(Math.exp(-F.decay * sdt), 0, 0, 0);
          this.fogQ.set(1, 1, 0.03, 0.5);
          this.fogR.set(0, 0, 1, 1);
          this.fogS.set(AIR_TUNE.fog.poolMost, 0, 0, 0);
          d.mode = way;
          d.run(() => d.draw(this.mats.smoke, sm[1]), this.home);
          d.mode = 'calls';
          const a = readFloat(r, sm[1]);
          const b = readFloat(r, sm[1], 1);
          const want: [number, number, number] = [0.4, 0.2, 0.1];
          smokeStep(want, sdt, S.decay, S.climb0, S.climb1);
          note(`smoke (${way}): slab 0 decays and climbs (smokeStep)`, want[0], a ? a[smid] : null, 1e-5);
          note(`smoke (${way}): slab 1 takes slab 0's climb and gives its own`, want[1], a ? a[smid + 1] : null, 1e-5);
          note(`smoke (${way}): slab 2 takes slab 1's climb`, want[2], a ? a[smid + 2] : null, 1e-5);
          note(`smoke (${way}): the fog decays as exp(-decay dt)`, 0.3 * Math.exp(-F.decay * sdt), a ? a[smid + 3] : null, 1e-5);
          note(`smoke (${way}): the smoke's colour dies with it`, 0.7 * Math.exp(-S.decay * sdt), b ? b[smid + 3] : null, 1e-5);
        }
      }
    } finally {
      d.mode = mode;
      r.setRenderTarget(sv.target);
      r.autoClear = sv.autoClear;
      r.setClearColor(sv.colour, sv.alpha);
      this.needsFill = true;
      this.lightDue = true;
    }
    const logs: Record<string, string> = {};
    for (const m of this.materials()) {
      const props = r.properties.get(m) as { currentProgram?: { program?: WebGLProgram } };
      const program = props.currentProgram?.program;
      logs[m.name] = program ? gl.getProgramInfoLog(program) || 'linked, nothing said' : 'not built';
    }
    return { ok: checks.every((c) => c.ok), checks, logs };
  }

  private known: KnownGround | null = null;

  /**
   * One texel each of white land that gives all its dust, flat at nought, with no colour map (a tint of one); and a
   * coloured land under a known tint (`KNOWN_COLOUR`, `KNOWN_TINT`): the self test's ground (made the first time it runs).
   */
  private knownGround(): KnownGround {
    if (!this.known) {
      const byte = (data: Uint8Array, name: string): THREE.DataTexture => dataTexture(data, 1, THREE.RGBAFormat, THREE.UnsignedByteType, name);
      this.known = {
        response: byte(new Uint8Array([255, 255, 255, 255]), 'air.selfTest.response'),
        colour: byte(new Uint8Array([255, 255, 255, MEDIUM_BYTE.land]), 'air.selfTest.colour'),
        tint: byte(new Uint8Array([255, 255, 255, 0]), 'air.selfTest.tint'),
        colourLit: byte(new Uint8Array(KNOWN_COLOUR), 'air.selfTest.colourLit'),
        tintLit: byte(new Uint8Array(KNOWN_TINT), 'air.selfTest.tintLit'),
        height: dataTexture(new Float32Array([0]), 1, THREE.RedFormat, THREE.FloatType, 'air.selfTest.height'),
      };
    }
    return this.known;
  }

  dispose(): void {
    this.releaseTargets();
    if (this.known) for (const t of [this.known.response, this.known.colour, this.known.tint, this.known.colourLit, this.known.tintLit, this.known.height]) t.dispose();
    this.known = null;
    this.obstacleMap.dispose();
    this.home.dispose();
    this.noise.dispose();
    this.heightTex?.dispose();
    this.responseTex?.dispose();
    this.colourTex?.dispose();
    this.tintTex?.dispose();
    this.sandTex?.dispose();
    this.sandStand.dispose();
    this.noiseTex?.dispose();
    this.noiseTex = null;
    this.noise3.value = null;
    for (const m of Object.values(this.mats)) m.dispose();
    this.obs.dispose();
    this.dents?.dispose();
    this.layerTex?.dispose();
    this.layerTex = null;
    this.klassTex?.dispose();
    this.klassTex = null;
    this.flowTex?.dispose();
    this.flowTex = null;
    this.flowU.value = null;
    this.gustTex?.dispose();
    this.gustTex = null;
    this.carry.dispose();
    this.kick.dispose();
    this.rain.dispose();
    this.drawer.dispose();
    void this.quad;
  }
}

const ZERO2 = new THREE.Vector2();
const hullShift = new THREE.Matrix4();

/** The self test's grounds (`AirField.knownGround`). */
interface KnownGround {
  response: THREE.DataTexture;
  colour: THREE.DataTexture;
  tint: THREE.DataTexture;
  colourLit: THREE.DataTexture;
  tintLit: THREE.DataTexture;
  height: THREE.DataTexture;
}

/** A land's lighter tones (sRGB bytes, the medium byte in alpha) and a pole's colour-map bytes, for the self test's colour. */
const KNOWN_COLOUR: readonly number[] = [200, 150, 100, MEDIUM_BYTE.land];
const KNOWN_TINT: readonly number[] = [180, 120, 90, 255];
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/** How many components the card hands back reading `target` (its own read format: a red target may read as red alone). */
function readComps(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): number {
  const gl = r.getContext() as WebGL2RenderingContext;
  const prev = r.getRenderTarget();
  r.setRenderTarget(target);
  const f = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) as number;
  r.setRenderTarget(prev);
  return f === gl.RED ? 1 : f === gl.RG ? 2 : 4;
}

/** A half-float target read back whole (console only), or null where the card will not read it. */
function readHalf(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): { data: Uint16Array; comps: number } | null {
  try {
    const comps = readComps(r, target);
    const data = new Uint16Array(target.width * target.height * comps);
    r.readRenderTargetPixels(target, 0, 0, target.width, target.height, data);
    return { data, comps };
  } catch {
    return null;
  }
}

/** An RGBA float target read back whole (console only), its `index`th texture for a target of several, or null. */
function readFloat(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, index = 0): Float32Array | null {
  try {
    const data = new Float32Array(target.width * target.height * 4);
    r.readRenderTargetPixels(target, 0, 0, target.width, target.height, data, undefined, index);
    return data;
  } catch {
    return null;
  }
}

/** A one-channel float target read back whole as its red (console only), or null where the card will not read it. */
function readRed(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): Float32Array | null {
  try {
    const comps = readComps(r, target);
    const data = new Float32Array(target.width * target.height * comps);
    r.readRenderTargetPixels(target, 0, 0, target.width, target.height, data);
    if (comps === 1) return data;
    const out = new Float32Array(target.width * target.height);
    for (let i = 0; i < out.length; i++) out[i] = data[i * comps];
    return out;
  } catch {
    return null;
  }
}

function swap(p: Pair): void {
  const a = p[0];
  p[0] = p[1];
  p[1] = a;
}

const now = (): number => performance.now();
