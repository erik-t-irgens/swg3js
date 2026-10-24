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
import { airFrameNumbersIn, dustDecayFrame, fixedStepsIn, lightStep, lightTransmittance, newAirFrameNumbers, tickClockIn, type AirFrameNumbers, type FixedClock, type TickClock } from './airMath.ts';
import { AirForces, DUST_BATCH, SPLAT_BATCH, type ForceCounts } from './airForces.ts';
import { pushEngines, type AirHull } from './airEngines.ts';
import { AirRaster, MEDIUM_BYTE, type GroundSampler } from './airRaster.ts';
import { AirObstacles, type SolidBoxSource } from './airObstacles.ts';
import { newWindow, PLACE, placeWindowIn, type WindowPlace } from './fluidWindow.ts';
import { ADVECT_FRAGMENT, AIR_VERTEX, DIV_FRAGMENT, DUST_FRAGMENT, FILL_FRAGMENT, GRAD_FRAGMENT, JACOBI_FRAGMENT, LIGHT_FRAGMENT, OFFSETS_FRAGMENT, SPLAT_FRAGMENT, VORT_FRAGMENT } from './airShaders.ts';
import { AirDents, DENT_KIND, placeDentSquareIn, type DentCounts } from './airDents.ts';
import { copyAirGround, type AirGroundUniforms } from './airGround.ts';
import { fillLayerResponse } from './groundResponse.ts';
import { PRINT_TUNE } from '../footprints.ts';
import type { FootStep } from '../../audio/footsteps.ts';
import type { VolTune } from './volSettings.ts';

/**
 * Everything the volume reads of the air, by reference (§2.8): the kept uniform objects whose `value` is each field's
 * current texture (rewritten in place when a target is swapped), the window, the band of air, the storm, the ridden
 * hull's box. The one interface the Light and shadow pass's volume will read too.
 */
export interface AirSource {
  readonly dust: { value: THREE.Texture | null };
  readonly light: { value: THREE.Texture | null };
  readonly height: { value: THREE.Texture | null };
  readonly obstacles: { value: THREE.Texture | null };
  /** ox, oz, size, cell. */
  readonly window: { value: THREE.Vector4 };
  /** What the light texture still owes of the window's moves, in window uv. */
  readonly lightShift: { value: THREE.Vector2 };
  /** The window's lowest and highest known ground, and its mean, metres. */
  readonly band: { value: THREE.Vector3 };
  /** The storm's dust outside the window (a density), and the dust's height scale at this storm, metres. */
  readonly inflow: { value: THREE.Vector2 };
  /** The storm's dust colour, linear. */
  readonly stormColour: { value: THREE.Color };
  /** The light pass is on (1) or the volume reads a transmittance of one (0). */
  readonly lightOn: { value: number };
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
  /** One of the fields by name, as it stands now, for the debug view (`__debug.air({ view })`); null for none. */
  debugTexture(name: string): THREE.Texture | null;
}

/** What measure reads of the ground's marks (the second wave). */
export interface GroundMeasure {
  offsets: { peak: number; moved: number; peakAt: [number, number] | null } | null;
  dents: { peak: number; total: number; pressed: number; peakAt: [number, number] | null } | null;
  ground: { x: number; z: number; offset: number | null; dent: number | null }[];
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
}

export function newAirFrameInput(): AirFrameInput {
  return { dt: 0, simulate: true, camX: 0, camY: 0, camZ: 0, windHeading: 0, windSpeed: 0, storm: 0, sunX: 0, sunY: 1, sunZ: 0, time: 0, reading: false, ground: false, where: null };
}

/** What the world gives the field to read: the ground, the solid boxes and the hulls. */
export interface AirWorld {
  ground: GroundSampler;
  boxes: SolidBoxSource | null;
  hulls: readonly AirHull[];
}

type Pair = [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];

const NOISE_SIZE = 128;

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

function fieldTarget(w: number, h: number, format: THREE.PixelFormat, type: THREE.TextureDataType, name: string): THREE.WebGLRenderTarget {
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
  });
  t.texture.name = name;
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

function material(name: string, fragment: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    vertexShader: AIR_VERTEX,
    fragmentShader: fragment,
    uniforms,
    blending: THREE.NoBlending,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
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
  readonly light = { value: null as THREE.Texture | null };
  readonly height = { value: null as THREE.Texture | null };
  readonly obstacles = { value: null as THREE.Texture | null };
  readonly window = { value: new THREE.Vector4(0, 0, 192, 1.5) };
  readonly lightShift = { value: new THREE.Vector2() };
  readonly band = { value: new THREE.Vector3() };
  readonly inflow = { value: new THREE.Vector2(0, AIR_TUNE.dust.height) };
  readonly stormColour = { value: new THREE.Color(0.6, 0.45, 0.3) };
  readonly lightOn = { value: 1 };
  readonly hullInverse = { value: new THREE.Matrix4() };
  readonly hullBox = { value: new THREE.Vector4() };
  volumeDrew = false;
  /** Set by `update` once the dust pass has drawn this frame, cleared at the top of every update (`AirSource.dustLive`). */
  dustLive = false;

  /** The force API (§2.10): every caller writes here. */
  readonly forces = new AirForces();
  /**
   * The console's movable engine (`__debug.air({ engine })`, the demos' own): a nozzle standing where it was put, read
   * into the engines' table every frame like a hull's until it is taken away. Null for none.
   */
  testEngine: { x: number; y: number; z: number; dx: number; dy: number; dz: number; exit: number } | null = null;
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
  /** The response raster's and the colour raster's textures as kept uniform objects, which the dents' fade reads. */
  private readonly responseU = { value: null as THREE.Texture | null };
  private readonly colourU = { value: null as THREE.Texture | null };
  private readonly mats: Record<'splat' | 'vort' | 'div' | 'jacobi' | 'grad' | 'advect' | 'dust' | 'light' | 'fill' | 'offsets', THREE.ShaderMaterial>;
  private readonly quad: THREE.Mesh;
  /** Each field's size now, so a dial that moves one is a resize and nothing else. */
  private sized = { cells: 0, dust: 0, light: 0, sand: 0 };
  private needsFill = true;
  /** The offsets alone were made again at a new size and start at rest at the next frame that steps (`fillOffsets`). */
  private sandFill = false;
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
  /** The numbers the offsets pass takes each frame, in vectors (no number written into a uniform object). */
  private readonly sandP = new THREE.Vector4(1 / 60, 3.5, AIR_TUNE.ground.liftSpan, AIR_TUNE.ground.lift);
  private readonly sandQ = new THREE.Vector4(0, AIR_TUNE.ground.ageReset, AIR_TUNE.ground.hold, AIR_TUNE.ground.heal);
  private readonly sandR = new THREE.Vector4(AIR_TUNE.ground.ageCap, 0, 0, 0);
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
  private readonly wind = { x: 0.5, z: 0.5 };
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
  private readonly dustQ = new THREE.Vector4(0.5, 0, 0, 0);
  private readonly lightP = new THREE.Vector4(1, AIR_TUNE.light.dust, AIR_TUNE.light.k, 0.5);
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
  private readonly counts: ForceCounts = { engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0 };

  constructor(renderer: THREE.WebGLRenderer, tune: VolTune, world: AirWorld) {
    this.renderer = renderer;
    this.tune = tune;
    this.world = world;
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
    const common = {
      uWindow: this.window,
      uTiles: { value: this.tiles },
      uTileSlab: { value: this.tileSlab },
      uTileCount: { value: 1 },
      uAtlasSize: { value: new THREE.Vector2(1, 1) },
      uObstacles: this.obstacles,
      uWind: { value: new THREE.Vector2() },
      uObstacleOver: this.obstacleOver,
    };
    const gust = { uNoise: { value: this.noise }, uNoiseTexel: { value: 1 / NOISE_SIZE }, uGustTime: { value: this.gustTime } };
    this.mats = {
      splat: material('air.splat', SPLAT_FRAGMENT, { ...common, uVel: { value: null }, uShift: { value: new THREE.Vector2() }, uSplatA: { value: this.forces.splatA }, uSplatB: { value: this.forces.splatB }, uSplatCount: { value: 0 }, uReachScale: this.reachScale }),
      vort: material('air.vort', VORT_FRAGMENT, { ...common, uVel: { value: null }, uVortP: { value: this.vortP } }),
      div: material('air.div', DIV_FRAGMENT, { ...common, uVel: { value: null } }),
      jacobi: material('air.jacobi', JACOBI_FRAGMENT, { ...common, uPrs: { value: null }, uDiv: { value: null }, uJacobiP: { value: this.jacobiP }, uShift: { value: new THREE.Vector2() } }),
      grad: material('air.grad', GRAD_FRAGMENT, { ...common, uPrs: { value: null }, uVel: { value: null } }),
      advect: material('air.advect', ADVECT_FRAGMENT, { ...common, ...gust, uVel: { value: null }, uAdvectP: { value: this.advectP } }),
      dust: material('air.dust', DUST_FRAGMENT, {
        uWindow: this.window,
        uWind: common.uWind,
        ...gust,
        uDust: { value: null },
        uVel: { value: null },
        uObstacles: this.obstacles,
        uResponse: { value: null },
        uColour: { value: null },
        uGround: this.height,
        uVelShift: { value: new THREE.Vector2() },
        uDustShift: { value: new THREE.Vector2() },
        uGroundTexel: { value: new THREE.Vector2(1, 1) },
        uObstacleOver: common.uObstacleOver,
        uDustP: { value: this.dustP },
        uDustQ: { value: this.dustQ },
        uStormColour: this.stormColour,
        uSlopeGate: { value: new THREE.Vector2(AIR_TUNE.dust.slopeFrom, AIR_TUNE.dust.slopeTo) },
        uDustBatch: { value: this.forces.dustBatch },
        uDustCount: { value: 0 },
        uWindShare: this.windShare,
      }),
      light: material('air.light', LIGHT_FRAGMENT, { uWindow: this.window, uDust: { value: null }, uSunDir: { value: new THREE.Vector2(0, 1) }, uSteps: { value: 26 }, uLightP: { value: this.lightP } }),
      fill: material('air.fill', FILL_FRAGMENT, { uValue: { value: new THREE.Vector4() } }),
      offsets: material('air.offsets', OFFSETS_FRAGMENT, {
        uWindow: this.window,
        uWind: common.uWind,
        uWindShare: this.windShare,
        uOffsets: { value: null },
        uVel: { value: null },
        uResponse: this.responseU,
        uColour: this.colourU,
        uObstacles: this.obstacles,
        uObstacleOver: common.uObstacleOver,
        uVelShift: { value: new THREE.Vector2() },
        uSandShift: { value: new THREE.Vector2() },
        uSandP: { value: this.sandP },
        uSandQ: { value: this.sandQ },
        uSandR: { value: this.sandR },
      }),
    };
    this.quad = createFxQuad(this.mats.fill);
    // The dents only where a float target can be blended into: a stamp adds and the fade multiplies.
    const gl = renderer.getContext() as WebGL2RenderingContext | null;
    this.floatBlend = !!gl && typeof gl.getExtension === 'function' && !!gl.getExtension('EXT_float_blend');
    this.dents = this.floatBlend ? new AirDents(this.responseU, this.colourU, this.window) : null;
    if (this.dents) {
      this.dents.window = this.win;
      this.dents.raster = this.raster;
    }
    this.ground = {
      uAirOffsets: { value: null },
      uAirDents: { value: null },
      uAirLayers: { value: null },
      uAirLight: this.light,
      uAirWindow: this.window,
      uAirArt: { value: new THREE.Vector4(0, 0, 0, 0) },
      uAirDentP: { value: new THREE.Vector4(0, 0, AIR_TUNE.prints.square, AIR_TUNE.prints.squareEdge) },
      uAirDentQ: { value: new THREE.Vector4(1 / 2048, AIR_TUNE.prints.square / 2048, 0, 0) },
      uAirShift: { value: new THREE.Vector4() },
      uAirMisc: { value: new THREE.Vector4(AIR_TUNE.window.edge, AIR_TUNE.ground.darkenScale, AIR_TUNE.ground.darkening, AIR_TUNE.ground.shade) },
    };
    this.setLayerResponse(new Map(), new Uint8Array(4));
  }

  /**
   * The per-layer response lookup the ground's variant reads (each picture layer its family's moves, heals, gives and
   * dust), from the world's tile set and its response table, made at a world's load (`fillLayerResponse`'s bytes): a
   * texture upload and nothing more, so a family overridden from the console takes effect at once. A world with no
   * tile set hands an empty map, and every layer stands still.
   */
  setLayerResponse(childLayers: ReadonlyMap<number, readonly number[]>, response: Uint8Array, layers = 1): void {
    const n = Math.max(1, Math.floor(layers));
    if (!this.layerTex || this.layerBytes.length !== n * 4) {
      this.layerTex?.dispose();
      this.layerBytes = new Uint8Array(n * 4);
      const t = new THREE.DataTexture(this.layerBytes, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.name = 'air.layers';
      this.layerTex = t;
      this.ground.uAirLayers.value = t;
    }
    fillLayerResponse(childLayers, response, this.layerBytes);
    this.layerTex.needsUpdate = true;
  }

  /** The per-layer response as it stands, for the console: each layer's four bytes. */
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
    const list = [this.mats.splat, this.mats.vort, this.mats.div, this.mats.jacobi, this.mats.grad, this.mats.advect, this.mats.dust, this.mats.light, this.mats.fill, this.obs.material, this.mats.offsets];
    if (this.dents) list.push(this.dents.stampMaterial, this.dents.fadeMaterial);
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
    pairs.push([m.dust, quad(m.dust), this.dustPair![0]], [m.light, quad(m.light), this.lightTarget!], [m.fill, quad(m.fill), this.vel![0]], [this.obs.material, this.obs.mesh, this.obstacleMap]);
    pairs.push([m.offsets, quad(m.offsets), this.offsetsPair![0]]);
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

  /** Make or resize the targets for the tune's detail (class T): materials are never touched. Answers whether anything was resized. */
  private ensureTargets(): boolean {
    const t = this.tune;
    const cells = t.airDetail;
    const dust = cells * t.dustDetail;
    const light = cells * t.lightDetail;
    // The carried offsets and the dents hold their storage only while their own switch is on: off, each is a texel
    // across (its programs kept, since a program's key hangs on no target's size), so what the page's memory estimate
    // leaves out for a switch that is off is really given back -- the dents at 4096 are 64 MB.
    const sand = t.sand ? cells * t.sandDetail : 1;
    const s = this.sized;
    // The dents' own size is their own field's (world-anchored, a square of their own): a new detail is a new field of
    // dents, cleared at its next placing, and nothing of the air starts again for it.
    const d = this.dents;
    if (d !== null) d.ensure(t.prints ? t.printDetail : 1);
    if (s.cells === cells && s.dust === dust && s.light === light && this.vel) {
      // The offsets alone resized (the sand switched, or its detail moved): they start again at rest at the next frame
      // that steps, and nothing else of the air does.
      if (s.sand !== sand) {
        for (const tg of this.offsetsPair!) tg.setSize(sand, sand);
        s.sand = sand;
        this.sandShift.set(0, 0);
        this.sandFill = true;
      }
      return false;
    }
    const layout = atlasLayout(cells, 1, 0);
    if (!this.vel) {
      this.vel = [fieldTarget(layout.width, layout.height, THREE.RGFormat, THREE.HalfFloatType, 'air.vel.a'), fieldTarget(layout.width, layout.height, THREE.RGFormat, THREE.HalfFloatType, 'air.vel.b')];
      this.prs = [fieldTarget(layout.width, layout.height, THREE.RedFormat, THREE.HalfFloatType, 'air.prs.a'), fieldTarget(layout.width, layout.height, THREE.RedFormat, THREE.HalfFloatType, 'air.prs.b')];
      this.div = fieldTarget(layout.width, layout.height, THREE.RedFormat, THREE.HalfFloatType, 'air.div');
      this.dustPair = [fieldTarget(dust, dust, THREE.RGBAFormat, THREE.FloatType, 'air.dust.a'), fieldTarget(dust, dust, THREE.RGBAFormat, THREE.FloatType, 'air.dust.b')];
      this.lightTarget = fieldTarget(light, light, THREE.RedFormat, THREE.UnsignedByteType, 'air.light');
      // Offsets round nought heal both ways under a half float's truncation, and still air copies a texel exactly.
      this.offsetsPair = [fieldTarget(sand, sand, THREE.RGBAFormat, THREE.FloatType, 'air.offsets.a'), fieldTarget(sand, sand, THREE.RGBAFormat, THREE.FloatType, 'air.offsets.b')];
    } else {
      for (const p of [this.vel, this.prs!]) for (const tg of p) tg.setSize(layout.width, layout.height);
      this.div!.setSize(layout.width, layout.height);
      for (const tg of this.dustPair!) tg.setSize(dust, dust);
      this.lightTarget!.setSize(light, light);
      for (const tg of this.offsetsPair!) tg.setSize(sand, sand);
    }
    this.obstacleMap.setSize(cells, cells);
    this.raster.resize(cells);
    // The rasters' textures are made again at the new size; the uniform objects keep their place in every material.
    this.heightTex?.dispose();
    this.responseTex?.dispose();
    this.colourTex?.dispose();
    this.heightTex = dataTexture(this.raster.height, cells, THREE.RedFormat, THREE.FloatType, 'air.height');
    this.responseTex = dataTexture(this.raster.response, cells, THREE.RGBAFormat, THREE.UnsignedByteType, 'air.response');
    this.colourTex = dataTexture(this.raster.colour, cells, THREE.RGBAFormat, THREE.UnsignedByteType, 'air.colour');
    this.height.value = this.heightTex;
    this.mats.dust.uniforms.uResponse.value = this.responseTex;
    this.mats.dust.uniforms.uColour.value = this.colourTex;
    this.responseU.value = this.responseTex;
    this.colourU.value = this.colourTex;
    (this.mats.dust.uniforms.uGroundTexel.value as THREE.Vector2).set(1 / cells, 1 / cells);
    tileRects(layout, this.tiles);
    this.tileSlab.fill(0);
    this.syncTune();
    for (const k of ['splat', 'vort', 'div', 'jacobi', 'grad', 'advect'] as const) (this.mats[k].uniforms.uAtlasSize.value as THREE.Vector2).set(layout.width, layout.height);
    s.cells = cells;
    s.dust = dust;
    s.light = light;
    s.sand = sand;
    this.dust.value = this.dustPair![0].texture;
    this.light.value = this.lightTarget!.texture;
    this.ground.uAirOffsets.value = this.offsetsPair![0].texture;
    this.needsFill = true;
    return true;
  }

  /**
   * The tune's numbers the programs take outside the frame's own vectors, from `AIR_TUNE` as it stands: slab 0's floor,
   * middle and share of the wind into the atlas's tile table (a typed array, written in place), and the reach, the
   * solid's height and the share into their uniforms only when they moved (a double written into a uniform object is a
   * number made). Called at every step and when the targets are made, so every number of the table moves live.
   */
  private syncTune(): void {
    const sl = AIR_TUNE.slabs;
    const ts = this.tileSlab;
    ts[0] = sl.floor;
    ts[1] = sl.centre;
    ts[2] = sl.windShare;
    if (this.reachScale.value !== sl.reach) this.reachScale.value = sl.reach;
    if (this.windShare.value !== sl.windShare) this.windShare.value = sl.windShare;
    const over = AIR_TUNE.obstacles.over;
    if (this.obstacleOver.value !== over) this.obstacleOver.value = over;
  }

  /** Whether anything is airborne: a source lifted dust in the last `airborneFor` seconds, or the storm is up. */
  hasAir(): boolean {
    return this.input.storm > 0 || this.worldTime - this.lastLift < AIR_TUNE.volume.airborneFor;
  }

  /**
   * A blast at a point (the force API, §2.10): its ring of shoves, its dust and its grains, by its own radius and push.
   * `smoke` is the third wave's. A queue write and nothing else; answers at once with the field off or indoors.
   */
  blast(x: number, y: number, z: number, radius: number, push: number, smoke: number): void {
    this.forces.blast(x, y, z, radius, push, smoke);
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
      default:
        return null;
    }
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
    this.stats.stepped = false;
    this.dustLive = false;
    const dt = inp.dt > 0 && Number.isFinite(inp.dt) ? (inp.dt < 0.1 ? inp.dt : 0.1) : 0;
    this.worldTime += dt;
    f.fromEngines = t.fromEngines;
    f.fromForce = t.fromForce;
    f.fromBlasts = t.fromBlasts;
    f.dust = t.dust;
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
    this.window.value.set(w.ox, w.oz, w.size, w.cell);
    if (code === PLACE.first || code === PLACE.jump || resized) {
      this.raster.clear();
      this.obs.forget();
      f.clear();
      // A jump starts the dent field clean as well (the window's rule, §2.2): its square is placed afresh and cleared.
      this.dents?.clear();
      this.needsFill = true;
      this.solverShift.set(0, 0);
      this.dustShift.set(0, 0);
      this.sandShift.set(0, 0);
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
      this.lightShift.value.x += sx;
      this.lightShift.value.y += sz;
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
    this.band.value.set(this.raster.lowest, this.raster.highest, this.raster.mean);
    if (this.raster.dirty) {
      this.heightTex!.needsUpdate = true;
      this.responseTex!.needsUpdate = true;
      this.colourTex!.needsUpdate = true;
      this.raster.dirty = false;
    }
    let drawObstacles = code !== PLACE.still;
    this.obs.time = this.worldTime;
    if (this.world.boxes && this.obs.due(w)) {
      this.obs.gather(this.world.boxes, w);
      drawObstacles = true;
    }
    // The engines of this frame, into the forces' table.
    pushEngines(this.world.hulls, f);
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
      a[7] = 0;
      a[8] = 0;
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
    this.wind.x = nu.windX;
    this.wind.z = nu.windZ;
    this.inflow.value.set(nu.inflowDust, nu.dustHeight);
    this.lightOn.value = t.light ? 1 : 0;
    if (!inp.reading) {
      this.why = 'nothing reads the air: the dust is off, or Effects are, and the ground keeps nothing';
      // The rasters are kept for the grains; what the blasts and pushes queued is dropped, since no step will take it
      // (the footprints already owed are pressed, as above).
      f.dropOwed();
      f.dents = null;
      this.layOwed();
      this.dents?.dropOwed();
      this.writeGround(true);
      return;
    }
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
    const r = this.renderer;
    const sv = this.saved;
    sv.target = r.getRenderTarget();
    sv.autoClear = r.autoClear;
    sv.alpha = r.getClearAlpha();
    r.getClearColor(sv.colour);
    r.autoClear = false;
    this.drawer.mode = AIR_DRAW.mode;
    this.frameDt = dt;
    this.frameStorm = inp.storm > 0 && Number.isFinite(inp.storm) ? inp.storm : 0;
    this.frameInflow = nu.inflowDust;
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
    this.why = this.drawer.broken ? `the step failed: ${this.drawer.broken}` : null;
    this.stats.frames++;
    this.stats.draws = this.drawer.count();
    this.writeGround(true);
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
   * effect is off -- the drift with the sand off, the prints with no dents kept, the shade unless the volume drew the
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
    // Into the session's record the variant reads, while this is the world's field.
    if (this.bound) copyAirGround(g, this.bound);
  }

  private frameDt = 0.5;
  private frameStorm = 0.5;
  private frameInflow = 0.5;

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
    (this.mats.splat.uniforms.uWind.value as THREE.Vector2).set(this.wind.x, this.wind.z);
    this.syncTune();
    if (this.needsFill) {
      this.fillFields();
      this.needsFill = false;
    } else if (this.sandFill) this.fillOffsets();
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
      this.gustTime.x = AIR_TUNE.wind.gust;
      this.gustTime.y = this.worldTime;
      d.draw(m.advect, vel[1]);
      swap(vel);
      if (first) this.solverShift.set(0, 0);
      this.stats.steps++;
      this.lightDue = true;
    }
    // The dust, every frame, carried by the air as it stands (its pending scroll not yet carried if no step ran).
    if (t.dust) {
      f.frameDt = dt;
      const n = f.buildDustBatch();
      if (n > 0) this.lastLift = this.worldTime;
      const u = m.dust.uniforms;
      const dust = this.dustPair!;
      u.uDust.value = dust[0].texture;
      u.uVel.value = vel[0].texture;
      (u.uVelShift.value as THREE.Vector2).copy(this.solverShift);
      (u.uDustShift.value as THREE.Vector2).copy(this.dustShift);
      const dp = this.dustP;
      dp.x = dt;
      dp.y = nu.decay;
      dp.z = this.frameStorm;
      dp.w = AIR_TUNE.dust.stormShed;
      this.dustQ.x = this.frameInflow;
      u.uDustCount.value = n;
      this.gustTime.x = AIR_TUNE.wind.gust;
      this.gustTime.y = this.worldTime;
      (u.uSlopeGate.value as THREE.Vector2).set(AIR_TUNE.dust.slopeFrom, AIR_TUNE.dust.slopeTo);
      d.draw(m.dust, dust[1]);
      swap(dust);
      this.dust.value = dust[0].texture;
      this.dustShift.set(0, 0);
      this.dustLive = true;
    }
    // The ground's carried offsets, every frame by the frame's own dt, while the ground wears the air's variant and the
    // drifting sand is on: carried by slab 0's air past the lift threshold, aged on the 10 Hz clock, healed after the hold.
    if (t.sand && this.input.ground) {
      const u = m.offsets.uniforms;
      const pair = this.offsetsPair!;
      const G = AIR_TUNE.ground;
      u.uOffsets.value = pair[0].texture;
      u.uVel.value = vel[0].texture;
      (u.uVelShift.value as THREE.Vector2).copy(this.solverShift);
      (u.uSandShift.value as THREE.Vector2).copy(this.sandShift);
      const uw = u.uWind.value as THREE.Vector2;
      uw.x = this.wind.x;
      uw.y = this.wind.z;
      const sp = this.sandP;
      sp.x = dt;
      // The lift threshold over the weather's own wind before any slab's share [demo `land.html:1895`].
      const ws = nu.windX * nu.windX + nu.windZ * nu.windZ;
      const lift = Math.sqrt(ws) * G.liftOver + G.liftAdd;
      sp.y = lift < G.liftCap ? lift : G.liftCap;
      sp.z = G.liftSpan;
      sp.w = G.lift;
      const sq = this.sandQ;
      sq.x = this.frameTicks;
      sq.y = G.ageReset;
      sq.z = G.hold;
      sq.w = G.heal;
      this.sandR.x = G.ageCap;
      d.draw(m.offsets, pair[1]);
      swap(pair);
      this.ground.uAirOffsets.value = pair[0].texture;
      this.sandShift.set(0, 0);
    }
    // The light toward the sun, once a frame that stepped.
    if (t.light && this.lightDue) {
      const lu = m.light.uniforms;
      (lu.uSunDir.value as THREE.Vector2).set(nu.sunAcrossX, nu.sunAcrossZ);
      lu.uSteps.value = t.lightSteps;
      const lp = this.lightP;
      lp.x = nu.lightStep;
      lp.y = AIR_TUNE.light.dust;
      lp.z = AIR_TUNE.light.k;
      lp.w = this.frameInflow;
      lu.uDust.value = this.dustPair![0].texture;
      d.draw(m.light, this.lightTarget!);
      this.lightShift.value.set(0, 0);
      this.lightDue = false;
    }
  };

  /** Every field to its inflow: the air to the wind's share, the pressure to nought, the dust to the storm's, the light to one. */
  private fillFields(): void {
    const d = this.drawer;
    const v = this.mats.fill.uniforms.uValue.value as THREE.Vector4;
    const share = AIR_TUNE.slabs.windShare;
    v.set(this.wind.x * share, this.wind.z * share, 0, 1);
    for (const tg of this.vel!) d.draw(this.mats.fill, tg);
    v.set(0, 0, 0, 1);
    for (const tg of this.prs!) d.draw(this.mats.fill, tg);
    d.draw(this.mats.fill, this.div!);
    const c = this.stormColour.value;
    const inflow = this.frameInflow;
    v.set(c.r * inflow, c.g * inflow, c.b * inflow, inflow);
    for (const tg of this.dustPair!) d.draw(this.mats.fill, tg);
    v.set(1, 0, 0, 1);
    d.draw(this.mats.fill, this.lightTarget!);
    this.dust.value = this.dustPair![0].texture;
    this.fillOffsets();
  }

  /** The ground at rest: nothing carried, every texel long healed (with every field, or the offsets alone after a resize). */
  private fillOffsets(): void {
    const v = this.mats.fill.uniforms.uValue.value as THREE.Vector4;
    v.set(0, 0, AIR_TUNE.ground.ageCap, 0);
    for (const tg of this.offsetsPair!) this.drawer.draw(this.mats.fill, tg);
    this.ground.uAirOffsets.value = this.offsetsPair![0].texture;
    this.sandShift.set(0, 0);
    this.sandFill = false;
  }

  /** Free the targets (the master turned off in play): the materials are kept for a later on, which makes them again (class T). */
  releaseTargets(): void {
    this.targetGen++;
    for (const p of [this.vel, this.prs, this.dustPair, this.offsetsPair]) if (p) for (const tg of p) tg.dispose();
    this.div?.dispose();
    this.lightTarget?.dispose();
    this.vel = null;
    this.prs = null;
    this.dustPair = null;
    this.offsetsPair = null;
    this.div = null;
    this.lightTarget = null;
    this.sized = { cells: 0, dust: 0, light: 0, sand: 0 };
    this.dust.value = null;
    this.light.value = null;
    this.dustLive = false;
    this.win.placed = false;
    this.forces.clear();
    // The dents' target too: a later on makes it again at its size (class T), and the ground reads nothing meanwhile.
    if (this.dents) {
      this.dents.clear();
      this.dents.target?.dispose();
      this.dents.target = null;
    }
    this.ground.uAirOffsets.value = null;
    this.ground.uAirDents.value = null;
    this.dentsLive = false;
    this.writeGround(false);
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
    this.volumeDrew = false;
    this.dustLive = false;
    this.dentsLive = false;
    this.why = 'not yet stepped';
    this.writeGround(false);
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
      grids: { air: `${t.airDetail}² RG16F pair, R16F pressure pair`, dust: `${t.airDetail * t.dustDetail}² RGBA32F pair`, light: `${t.airDetail * t.lightDetail}² R8`, obstacles: `${t.airDetail}² RG16F (red the walls, green the walls and a compound's rooms)`, rasters: `${t.airDetail}² R32F height, RGBA8 response and colour` },
      raster: { unknown: this.raster.unknown, asked: this.raster.asked, lowest: r2(this.raster.lowest), highest: r2(this.raster.highest), mean: r2(this.raster.mean) },
      obstacles: { boxes: this.obs.count, dropped: this.obs.dropped, gathers: this.obs.gathers, tooWide: this.obs.tooWide, rooms: this.obs.rooms, widest: { half: round4(this.obs.largest), at: [Math.round(this.obs.largestX), Math.round(this.obs.largestZ)], top: round4(this.obs.largestTop) } },
      sources: { ...this.counts, queuedOneShots: this.forces.oneCount, enginesThisFrame: this.forces.engineCount },
      batch: { splats: this.forces.splatCount, of: SPLAT_BATCH, dust: this.forces.dustBatchCount, ofDust: DUST_BATCH },
      steps: this.stats.steps,
      draws: this.stats.draws,
      // The frame's own milliseconds are the frame report's `air` line (`__debug.perf()`, CPU and GPU): reading a clock
      // in the step made a number every frame.
      timing: 'see __debug.perf(): the air line',
      hasAir: this.hasAir(),
      wind: { x: r2(this.wind.x), z: r2(this.wind.z) },
      storm: r2(this.input.storm),
      motes: this.stats.motes,
      grains: { flying: this.stats.grainsFlying, lying: this.stats.grainsLying },
      stormSheets: r2(this.stats.sheets),
      ground: this.groundReport(),
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
  measure(points: readonly (readonly [number, number])[] = [], radius = 4): ({ dustTotal: number; dustPeak: number; peakAt: [number, number] | null; speedPeak: number; speed: { mean: number; peakAt: [number, number] | null; liftAt: number; overLift: number; overFourWinds: number }; samples: number; at: { x: number; z: number; dust: number | null; light: number | null; shed: number; medium: string }[]; solid: number | null; roomsOnly: number | null; tallest: number; upwind: { velocity: [number, number]; inflow: [number, number]; off: number } | null } & GroundMeasure) | null {
    if (!this.dustPair || !this.vel) return null;
    const r = this.renderer;
    const dt = this.dustPair[0];
    const buf = readFloat(r, dt);
    if (!buf) return null;
    const w0 = this.win;
    const lt = this.lightTarget;
    const lr = lt ? readByte(r, lt) : null;
    const at0: { x: number; z: number; dust: number | null; light: number | null; shed: number; medium: string }[] = [];
    for (const [x, z] of points) {
      let most: number | null = null;
      const span = Math.ceil(radius / (w0.size / dt.width));
      const ci = Math.floor(((x - w0.ox) / w0.size) * dt.width);
      const cj = Math.floor(((z - w0.oz) / w0.size) * dt.height);
      for (let j = cj - span; j <= cj + span; j++) {
        for (let i = ci - span; i <= ci + span; i++) {
          if (i < 0 || j < 0 || i >= dt.width || j >= dt.height) continue;
          const a = buf[(j * dt.width + i) * 4 + 3];
          if (Number.isFinite(a) && (most === null || a > most)) most = a;
        }
      }
      let light: number | null = null;
      if (lt && lr) {
        const li = Math.floor(((x - w0.ox) / w0.size) * lt.width);
        const lj = Math.floor(((z - w0.oz) / w0.size) * lt.height);
        if (li >= 0 && lj >= 0 && li < lt.width && lj < lt.height) light = Math.round((lr.data[(lj * lt.width + li) * lr.comps] / 255) * 1000) / 1000;
      }
      const medium = this.raster.mediumAt(w0.ox, w0.oz, w0.cell, x, z);
      at0.push({ x, z, dust: most === null ? null : Math.round(most * 10000) / 10000, light, shed: Math.round(this.raster.dustAt(w0.ox, w0.oz, w0.cell, x, z) * 1000) / 1000, medium: medium === 85 ? 'land' : medium === 170 ? 'water' : medium === 255 ? 'lava' : 'unknown' });
    }
    let total = 0;
    let peak = 0;
    let at = -1;
    for (let i = 0; i < dt.width * dt.height; i++) {
      const a = buf[i * 4 + 3];
      if (!Number.isFinite(a)) continue;
      total += a;
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
    const ws = Math.sqrt(this.wind.x * this.wind.x + this.wind.z * this.wind.z);
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
      const ix = this.wind.x * share;
      const iz = this.wind.z * share;
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
    return { dustTotal: Math.round(total * 1000) / 1000, dustPeak: Math.round(peak * 10000) / 10000, peakAt, speedPeak: Math.round(speedPeak * 100) / 100, speed: { mean: Math.round((speedSum / Math.max(1, v.width * v.height)) * 100) / 100, peakAt: speedAt >= 0 ? [Math.round((w0.ox + ((speedAt % v.width) + 0.5) * (w0.size / v.width)) * 10) / 10, Math.round((w0.oz + (Math.floor(speedAt / v.width) + 0.5) * (w0.size / v.height)) * 10) / 10] : null, liftAt: round4(liftAt), overLift: round4(overLift / Math.max(1, v.width * v.height)), overFourWinds: round4(overWind / Math.max(1, v.width * v.height)) }, samples: dt.width * dt.height, at: at0, solid, roomsOnly, tallest: round4(tallest), upwind, ...this.measureGround(points, radius) };
  }

  /**
   * The ground's marks read back (console only, a GPU sync): the carried offsets' largest and how many texels carry one
   * past a centimetre, and the dents' deepest and their sum over the square; at each point the largest offset and the
   * deepest dent within `radius`. Never on a frame path.
   */
  private measureGround(points: readonly (readonly [number, number])[], radius: number): GroundMeasure {
    const r = this.renderer;
    const w = this.win;
    let offsets: { peak: number; moved: number; peakAt: [number, number] | null } | null = null;
    const op = this.offsetsPair;
    const oread = op ? readFloat(r, op[0]) : null;
    if (op && oread) {
      const n = op[0].width;
      let peak = 0;
      let moved = 0;
      let at = -1;
      for (let i = 0; i < n * n; i++) {
        const x = oread[i * 4];
        const z = oread[i * 4 + 1];
        const m = Math.sqrt(x * x + z * z);
        if (!Number.isFinite(m)) continue;
        if (m > 0.01) moved++;
        if (m > peak) {
          peak = m;
          at = i;
        }
      }
      offsets = { peak: round4(peak), moved, peakAt: at >= 0 ? [Math.round((w.ox + ((at % n) + 0.5) * (w.size / n)) * 10) / 10, Math.round((w.oz + (Math.floor(at / n) + 0.5) * (w.size / n)) * 10) / 10] : null };
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
            const ox = oread[(j * n + i) * 4];
            const oz = oread[(j * n + i) * 4 + 1];
            const m = Math.sqrt(ox * ox + oz * oz);
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
   * the fill, the dust settling over one tenth of a second of still air with nothing lifting it, and the light pass over
   * even dust toward a sun 35 degrees up. Each answer says what it expected and what it read; every material's link log
   * is listed. The fields are filled again from their inflow afterwards, so the air starts again from the wind.
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
      // The dust settling over 0.1 s in still air, nothing solid, nothing lifting it.
      value.set(0, 0, 0, 1);
      d.draw(fill, this.vel![0]);
      r.setClearColor(0x000000, 0);
      d.clear(this.obstacleMap);
      const dust = this.dustPair!;
      value.set(0.2, 0.1, 0.05, 0.5);
      d.draw(fill, dust[0]);
      const u = this.mats.dust.uniforms;
      u.uDust.value = dust[0].texture;
      u.uVel.value = this.vel![0].texture;
      (u.uVelShift.value as THREE.Vector2).set(0, 0);
      (u.uDustShift.value as THREE.Vector2).set(0, 0);
      this.dustP.set(0.1, dustDecayFrame(0.1, AIR_TUNE.dust.settle), 0, AIR_TUNE.dust.stormShed);
      this.dustQ.x = 0;
      u.uDustCount.value = 0;
      d.draw(this.mats.dust, dust[1]);
      const dr = readFloat(r, dust[1]);
      const dmid = ((dust[1].height >> 1) * dust[1].width + (dust[1].width >> 1)) * 4 + 3;
      note('dust: settles as (1 + h / settle)^(-dt / h)', 0.5 * dustDecayFrame(0.1, AIR_TUNE.dust.settle), dr ? dr[dmid] : null, 1e-4);
      // The frame's dust batch, one splat on the middle texel of nothing: first over a ground of known dust (white land,
      // all dust, flat), so the batch and the shader are held apart from the rasters; then over the window's own ground,
      // held to what the CPU raster says that cell gives. Settling is turned off for both (decay 1).
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
        const known = this.knownGround();
        const keepGround = this.height.value;
        value.set(0, 0, 0, 0);
        try {
          d.draw(fill, dust[0]);
          u.uDust.value = dust[0].texture;
          this.dustP.set(1 / 60, 1, 0, 0);
          u.uDustCount.value = 1;
          (u.uSlopeGate.value as THREE.Vector2).set(AIR_TUNE.dust.slopeFrom, AIR_TUNE.dust.slopeTo);
          u.uResponse.value = known.response;
          u.uColour.value = known.colour;
          this.height.value = known.height;
          d.draw(this.mats.dust, D);
          const kr = readFloat(r, D);
          note('dust: a batch splat lays its amount over ground that gives all its dust', amount, kr ? kr[dmid] : null, 1e-3);
          u.uResponse.value = this.responseTex;
          u.uColour.value = this.colourTex;
          this.height.value = keepGround;
          d.draw(fill, dust[0]);
          d.draw(this.mats.dust, D);
          const gr = readFloat(r, D);
          const n = this.raster.n;
          const ci = Math.min(n - 1, Math.floor(cx * n));
          const cj = Math.min(n - 1, Math.floor(cz * n));
          const k = (cj * n + ci) * 4;
          const land = this.raster.colour[k + 3] === MEDIUM_BYTE.land ? 1 : 0;
          const give = (this.raster.response[k + 3] / 255) * land;
          note(`dust: over the window's own ground, the raster's dust there (${round4(give)}, ${land ? 'land' : 'not land'})`, amount * give, gr ? gr[dmid] : null, 0.15 * amount * give + 2e-3);
        } finally {
          u.uResponse.value = this.responseTex;
          u.uColour.value = this.colourTex;
          this.height.value = keepGround;
          u.uDustCount.value = 0;
        }
      }
      // The light pass over even dust of 0.5, the sun 35 degrees up, toward +X.
      value.set(0.2, 0.1, 0.05, 0.5);
      d.draw(fill, dust[0]);
      const el = (35 * Math.PI) / 180;
      const steps = this.tune.lightSteps;
      const lu = this.mats.light.uniforms;
      (lu.uSunDir.value as THREE.Vector2).set(1, 0);
      lu.uSteps.value = steps;
      this.lightP.set(lightStep(el, steps), AIR_TUNE.light.dust, AIR_TUNE.light.k, 0);
      lu.uDust.value = dust[0].texture;
      d.draw(this.mats.light, this.lightTarget!);
      const lt = this.lightTarget!;
      const lr = readByte(r, lt);
      const lmid = (lt.height >> 1) * lt.width + (lt.width >> 1);
      note('light: exp(-k · steps · dust · share)', lightTransmittance(steps * 0.5 * AIR_TUNE.light.dust), lr ? lr.data[lmid * lr.comps] / 255 : null, 1.5 / 255);
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

  private known: { response: THREE.DataTexture; colour: THREE.DataTexture; height: THREE.DataTexture } | null = null;

  /** One texel each of white land that gives all its dust, flat at nought: the self test's ground (made the first time it runs). */
  private knownGround(): { response: THREE.DataTexture; colour: THREE.DataTexture; height: THREE.DataTexture } {
    if (!this.known) {
      this.known = {
        response: dataTexture(new Uint8Array([255, 255, 255, 255]), 1, THREE.RGBAFormat, THREE.UnsignedByteType, 'air.selfTest.response'),
        colour: dataTexture(new Uint8Array([255, 255, 255, MEDIUM_BYTE.land]), 1, THREE.RGBAFormat, THREE.UnsignedByteType, 'air.selfTest.colour'),
        height: dataTexture(new Float32Array([0]), 1, THREE.RedFormat, THREE.FloatType, 'air.selfTest.height'),
      };
    }
    return this.known;
  }

  dispose(): void {
    this.releaseTargets();
    if (this.known) for (const t of [this.known.response, this.known.colour, this.known.height]) t.dispose();
    this.known = null;
    this.obstacleMap.dispose();
    this.home.dispose();
    this.noise.dispose();
    this.heightTex?.dispose();
    this.responseTex?.dispose();
    this.colourTex?.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.obs.dispose();
    this.dents?.dispose();
    this.layerTex?.dispose();
    this.layerTex = null;
    this.drawer.dispose();
    void this.quad;
  }
}

const ZERO2 = new THREE.Vector2();
const hullShift = new THREE.Matrix4();
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

/** An RGBA float target read back whole (console only), or null. */
function readFloat(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): Float32Array | null {
  try {
    const data = new Float32Array(target.width * target.height * 4);
    r.readRenderTargetPixels(target, 0, 0, target.width, target.height, data);
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

/** A byte target read back whole (console only), or null. */
function readByte(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): { data: Uint8Array; comps: number } | null {
  try {
    const comps = readComps(r, target);
    const data = new Uint8Array(target.width * target.height * comps);
    r.readRenderTargetPixels(target, 0, 0, target.width, target.height, data);
    return { data, comps };
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
