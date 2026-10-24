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
import { airFrameNumbersIn, dustDecayFrame, fixedStepsIn, lightStep, lightTransmittance, newAirFrameNumbers, type AirFrameNumbers, type FixedClock } from './airMath.ts';
import { AirForces, DUST_BATCH, SPLAT_BATCH, type ForceCounts } from './airForces.ts';
import { pushEngines, type AirHull } from './airEngines.ts';
import { AirRaster, MEDIUM_BYTE, type GroundSampler } from './airRaster.ts';
import { AirObstacles, type SolidBoxSource } from './airObstacles.ts';
import { newWindow, PLACE, placeWindowIn, type WindowPlace } from './fluidWindow.ts';
import { ADVECT_FRAGMENT, AIR_VERTEX, DIV_FRAGMENT, DUST_FRAGMENT, FILL_FRAGMENT, GRAD_FRAGMENT, JACOBI_FRAGMENT, LIGHT_FRAGMENT, SPLAT_FRAGMENT, VORT_FRAGMENT } from './airShaders.ts';
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
  /** Something reads the air this frame (the volume with Effects on): with nothing reading it, the rasters are kept and nothing is stepped. */
  reading: boolean;
  /** Why the air does nothing here (in space, in the world of copies, indoors), or null. */
  where: string | null;
}

export function newAirFrameInput(): AirFrameInput {
  return { dt: 0, simulate: true, camX: 0, camY: 0, camZ: 0, windHeading: 0, windSpeed: 0, storm: 0, sunX: 0, sunY: 1, sunZ: 0, time: 0, reading: false, where: null };
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
  private heightTex: THREE.DataTexture | null = null;
  private responseTex: THREE.DataTexture | null = null;
  private colourTex: THREE.DataTexture | null = null;
  private readonly mats: Record<'splat' | 'vort' | 'div' | 'jacobi' | 'grad' | 'advect' | 'dust' | 'light' | 'fill', THREE.ShaderMaterial>;
  private readonly quad: THREE.Mesh;
  /** Each field's size now, so a dial that moves one is a resize and nothing else. */
  private sized = { cells: 0, dust: 0, light: 0 };
  private needsFill = true;
  private readonly solverShift = new THREE.Vector2();
  private readonly dustShift = new THREE.Vector2();
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
  private readonly vortP = new THREE.Vector4(22, 1 / 60, AIR_TUNE.solver.cap, 0);
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
    };
    this.quad = createFxQuad(this.mats.fill);
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
    return [this.mats.splat, this.mats.vort, this.mats.div, this.mats.jacobi, this.mats.grad, this.mats.advect, this.mats.dust, this.mats.light, this.mats.fill, this.obs.material];
  }

  /**
   * Compile every material for the target it draws into, behind the arrival's loading screen, and finish their links
   * (`compileAsync` then the uniforms asked, `resolveLinks`' rule), so the first step builds nothing.
   */
  async warm(): Promise<number> {
    if (this.refused) return 0;
    const r = this.renderer;
    this.ensureTargets();
    const before = r.info.programs?.length ?? 0;
    const pairs: [THREE.Material, THREE.Object3D, THREE.WebGLRenderTarget][] = [];
    const quad = (m: THREE.Material): THREE.Mesh => createFxQuad(m);
    const m = this.mats;
    pairs.push([m.splat, quad(m.splat), this.vel![0]], [m.vort, quad(m.vort), this.vel![0]], [m.div, quad(m.div), this.div!], [m.jacobi, quad(m.jacobi), this.prs![0]], [m.grad, quad(m.grad), this.vel![0]], [m.advect, quad(m.advect), this.vel![0]]);
    pairs.push([m.dust, quad(m.dust), this.dustPair![0]], [m.light, quad(m.light), this.lightTarget!], [m.fill, quad(m.fill), this.vel![0]], [this.obs.material, this.obs.mesh, this.obstacleMap]);
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
    const s = this.sized;
    if (s.cells === cells && s.dust === dust && s.light === light && this.vel) return false;
    const layout = atlasLayout(cells, 1, 0);
    if (!this.vel) {
      this.vel = [fieldTarget(layout.width, layout.height, THREE.RGFormat, THREE.HalfFloatType, 'air.vel.a'), fieldTarget(layout.width, layout.height, THREE.RGFormat, THREE.HalfFloatType, 'air.vel.b')];
      this.prs = [fieldTarget(layout.width, layout.height, THREE.RedFormat, THREE.HalfFloatType, 'air.prs.a'), fieldTarget(layout.width, layout.height, THREE.RedFormat, THREE.HalfFloatType, 'air.prs.b')];
      this.div = fieldTarget(layout.width, layout.height, THREE.RedFormat, THREE.HalfFloatType, 'air.div');
      this.dustPair = [fieldTarget(dust, dust, THREE.RGBAFormat, THREE.FloatType, 'air.dust.a'), fieldTarget(dust, dust, THREE.RGBAFormat, THREE.FloatType, 'air.dust.b')];
      this.lightTarget = fieldTarget(light, light, THREE.RedFormat, THREE.UnsignedByteType, 'air.light');
    } else {
      for (const p of [this.vel, this.prs!]) for (const tg of p) tg.setSize(layout.width, layout.height);
      this.div!.setSize(layout.width, layout.height);
      for (const tg of this.dustPair!) tg.setSize(dust, dust);
      this.lightTarget!.setSize(light, light);
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
    (this.mats.dust.uniforms.uGroundTexel.value as THREE.Vector2).set(1 / cells, 1 / cells);
    tileRects(layout, this.tiles);
    this.tileSlab.fill(0);
    this.syncTune();
    for (const k of ['splat', 'vort', 'div', 'jacobi', 'grad', 'advect'] as const) (this.mats[k].uniforms.uAtlasSize.value as THREE.Vector2).set(layout.width, layout.height);
    s.cells = cells;
    s.dust = dust;
    s.light = light;
    this.dust.value = this.dustPair![0].texture;
    this.light.value = this.lightTarget!.texture;
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
    if (why) {
      this.why = why;
      f.active = false;
      f.beginFrame();
      // Nothing steps here, so nothing owed may wait for a step that could come minutes on (a walk out of a cantina),
      // where a shove queued before the door would land long after the blast that made it.
      f.dropOwed();
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
      this.needsFill = true;
      this.solverShift.set(0, 0);
      this.dustShift.set(0, 0);
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
      this.why = 'nothing reads the air: the dust is off, or Effects are';
      // The rasters are kept for the grains; what the blasts and pushes queued is dropped, since no step will take it.
      f.dropOwed();
      return;
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
    } finally {
      r.setRenderTarget(sv.target);
      r.autoClear = sv.autoClear;
      r.setClearColor(sv.colour, sv.alpha);
    }
    if (this.drawer.broken) this.dustLive = false;
    this.stats.stepped = this.drawer.broken === null;
    this.why = this.drawer.broken ? `the step failed: ${this.drawer.broken}` : null;
    this.stats.frames++;
    this.stats.draws = this.drawer.count();
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
  }

  /** Free the targets (the master turned off in play): the materials are kept for a later on, which makes them again (class T). */
  releaseTargets(): void {
    for (const p of [this.vel, this.prs, this.dustPair]) if (p) for (const tg of p) tg.dispose();
    this.div?.dispose();
    this.lightTarget?.dispose();
    this.vel = null;
    this.prs = null;
    this.dustPair = null;
    this.div = null;
    this.lightTarget = null;
    this.sized = { cells: 0, dust: 0, light: 0 };
    this.dust.value = null;
    this.light.value = null;
    this.dustLive = false;
    this.win.placed = false;
    this.forces.clear();
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
    this.testEngine = null;
    this.lastLift = -Infinity;
    this.volumeDrew = false;
    this.dustLive = false;
    this.why = 'not yet stepped';
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
    };
  }

  /**
   * Read the fields back off the card (console only, a GPU sync): the dust's total and peak and where the peak is,
   * and the air's fastest; with `points`, the most dust within `radius` metres of each and the light pass's
   * transmittance toward the sun there. Never on a frame path.
   */
  measure(points: readonly (readonly [number, number])[] = [], radius = 4): { dustTotal: number; dustPeak: number; peakAt: [number, number] | null; speedPeak: number; samples: number; at: { x: number; z: number; dust: number | null; light: number | null; shed: number; medium: string }[]; solid: number | null; roomsOnly: number | null; tallest: number; upwind: { velocity: [number, number]; inflow: [number, number]; off: number } | null } | null {
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
    const read = readHalf(r, v);
    if (read) {
      const { data, comps } = read;
      for (let i = 0; i < v.width * v.height; i++) {
        const x = THREE.DataUtils.fromHalfFloat(data[i * comps]);
        const z = THREE.DataUtils.fromHalfFloat(data[i * comps + 1]);
        const s = Math.sqrt(x * x + z * z);
        if (Number.isFinite(s) && s > speedPeak) speedPeak = s;
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
    return { dustTotal: Math.round(total * 1000) / 1000, dustPeak: Math.round(peak * 10000) / 10000, peakAt, speedPeak: Math.round(speedPeak * 100) / 100, samples: dt.width * dt.height, at: at0, solid, roomsOnly, tallest: round4(tallest), upwind };
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
