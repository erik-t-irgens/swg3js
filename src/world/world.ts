import * as THREE from 'three';
import { packIdOf, type PlanetDef } from '../data/planets';
import type { Physics, RAPIER } from '../core/physics';
import { CreatureManager } from './creatures';
import { NpcManager, type NpcDeps } from './npcs';
import { MobileManager } from './mobiles/manager';
import { MobileAssets } from './mobiles/assets';
import { MobileCatalogue } from './mobiles/catalogue';
import { ambientOverrides } from './mobiles/spawning';
import { DayCycle } from './daycycle';
import { SwgSky, type SkyLighting } from './sky';
import { Weather, type WeatherViewContext, type WeatherWorldContext } from './weather';
import { WEATHER_UNIFORMS, WET_WRAP, wetWrap } from './wetness';
import { emitRipple, Splashes, updateWaterDepth, type WaterMaterial } from './water';
import { WaterBodies, type WaterBody } from './waterBodies';
import { envLightFrom, isLavaWater, shaderKey, type WaterLook } from './waterLook';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createLavaMaterial, LAVA_LOOK, lavaGeometry, lavaHeatTable, loadLavaTextures, refreshLavaFar, standInLavaTextures, type LavaMaterial, type LavaTextures } from './lava';
import { FALLBACK_LAVA_STYLE, groupLava, lavaStyleFor, type LavaStyle } from './lavaStyle';
import type { HeatSources, LavaHeatTable } from './heatSources';
import { setEnvironment } from './envmap';
import { PropFactory, type Collider, type Exclusion, type ScatterItem } from './props';
import { FloraPlanter } from './flora';
import { TerrainTextures } from './terrainTextures';
import { AssetPack, type LoadedModel } from './assetPack';
import { OUTPOSTS } from '../data/outposts';
import { Group, groups, RAPIER as R } from '../core/physics';
import { CHUNK_RES, CHUNK_SIZE, Terrain } from './terrain';
import { SwgTerrain, type BuildingLayerSource, type SwgWaterTable } from './swgTerrain';
import { LayoutStreamer, type Building, type CellState, type PlacedObject } from './layoutStream';
import { isLiftCell, liftStops, stopAt, type LiftStop } from './lifts';
import type { SunInfo } from '../core/postfx';
import { luminance, pointIrradiance } from '../core/fx/bladeGlowMath.ts';
import { isShadowOnly } from '../core/fxRegistry.ts';
import { addPointLight, fillCascades, luminanceOf, resetFxLights, setDirectional, type FxLights } from '../core/fx/lights';
import { ParticleEffects, type EffectHandle } from './particles';
import { loadSpacePack, type SpacePack } from '../space/spaceData.ts';
import { ShipContacts } from '../space/contacts';
import { NpcShipManager } from '../space/npcShips';
import { ZONE_TIER } from '../space/roster';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { ACTOR_LAYER, INTERIOR_LAYER, markActor, type PortalRenderer } from './portalRender';
import { createPlaceholderSpeeder } from '../vehicles/speeder';
import { Dust } from '../vehicles/dust';
import { Garage, SpawnCancelled, type RefitReport, type VehicleDef } from '../vehicles/garage';
import { fitKey, type ResolvedFit } from '../vehicles/shipFit';
import { inTurn } from '../vehicles/shipMounts';
import { Vehicle, type VehicleKind, type VehicleSpec } from '../vehicles/vehicle';
import { Bolts } from '../combat/bolts';
import { ShipInterior } from '../vehicles/interior';
import { Gallery } from './gallery';
import { surfaces } from './surfaces';
import { TurretManager, type TurretTarget } from '../combat/turrets';
import { PLAYER_KEY, type Aggression, type Hittable, type Living, type Side } from '../combat/kit';

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const lumOf = (c: THREE.Color): number => luminance(c.r, c.g, c.b);
const tmpM = new THREE.Matrix4();
/** How far out a space zone's planets hang, and the radius (metres) a planet of size 1 has there. */
const SPACE_REACH = 3;
const SPACE_BODY_DISTANCE = 2600;
const SPACE_BODY_SIZE = 240;
/** Detailed ground chunks each way, by default; the settings move it (World.viewRadius). */
const VIEW_RADIUS = 6;
const STREAM_BUDGET = 3;
/** Coarse distant terrain: tile size, vertex resolution and radius in tiles. */
const FAR_TILE = 512;
const FAR_RES = 32;
const FAR_RADIUS = 6;
/** Fog is authored for a short view; scale it for the long one. */
/** The sea plane around the player that swells, its subdivision, and the sky-driven light strengths. */
const WATER_NEAR = 3000;
const WATER_SEGMENTS = 200;
const SWG_MAIN_LIGHT = 2.4;
const SWG_AMBIENT = 1.3;
const SWG_FILL = 1.0;
/** The client's fog densities read far thicker here than in the game; planets can override this. */
const DEFAULT_SWG_FOG_SCALE = 0.08;
/** Interior lights: how many point lights may be live at once, and how the client's colours map to three's intensities. */
/** Point lights a room may have at once. Every one lengthens every interior shader (and on some drivers each costs a second of compile time), so no more than a room needs. */
const INTERIOR_LIGHT_CAP = 8;
const INTERIOR_LIGHT_SCALE = 3;
const INTERIOR_AMBIENT_SCALE = 1.2;
const INTERIOR_AMBIENT_FLOOR = 0.18;
/** Seconds between ripple passes: dense enough that a swimmer's rings overlap into a wake. */
const RIPPLE_INTERVAL = 0.12;
const FOG_SCALE = 0.18;
/** Physics colliders only exist this many chunks out; nothing dynamic lives farther away. */
const PHYSICS_RADIUS = 3;
/**
 * How far the shadow cascades reach. The shadow pass is by far the most expensive thing in the
 * frame -- casters are culled against the light's frustum, not the camera's, so a long reach
 * draws the whole disc around the player in every cascade. A shorter reach is also *sharper*:
 * the same shadow map covers less ground, so every texel is smaller. Raise it for longer
 * shadows at a steep cost, lower it for crisper ones.
 */
const SHADOW_DISTANCE = 320;
/**
 * Placed objects smaller than this (metres of model radius) never cast. A shrub's shadow is a
 * smudge under the shrub; paying a draw call per cascade for it is the single biggest waste in
 * the frame. Objects keep receiving shadows either way.
 */
const SHADOW_MIN_RADIUS = 1.2;
/**
 * Shadow look. The client's own ambient keeps shadowed surfaces readable; this scales it, and
 * below 1 the world sits darker than retail did. Radius is the blur in shadow-map texels --
 * three's PCF path is a 20-tap Vogel disk, so 1 is a crisp contact edge and 2-3 is soft.
 * Normal bias pushes the lookup along the surface normal to hide acne; large values detach a
 * shadow from whatever casts it, so it stays small and the depth bias does the work.
 */
const AMBIENT_SCALE = 0.8;
const SHADOW_RADIUS = 1.4;
/**
 * Both biases are measured in shadow-map texels of the cascade they belong to, not in fixed
 * numbers, because a texel is 5 cm in the near cascade and 30 cm in the far one -- a single
 * value is either acne up close or a detached shadow far away.
 *
 * The depth bias especially: three stores it normalised over the shadow camera's depth range,
 * so its meaning in metres is (bias x range). CSM defaults that range to 1..2000, which turned
 * a -0.0004 bias into 0.8 m of offset and erased every contact shadow -- a standing character
 * lost its legs, and the shadow only reappeared once they jumped clear of it.
 */
const SHADOW_NORMAL_BIAS_TEXELS = 1;
const SHADOW_BIAS_TEXELS = 0.5;
/**
 * The shadow camera's depth range. The light sits LIGHT_MARGIN behind the cascade's bounding
 * box, so the range only has to cover that plus the cascade's own reach; keeping it tight is
 * what makes the depth bias mean centimetres instead of metres.
 */
const LIGHT_MARGIN = 150;
const LIGHT_NEAR = 1;
/** How dark a shadow goes, 0..1. The ambient decides what light still reaches it. */
const SHADOW_INTENSITY = 1;
/**
 * Shadow map edge, per cascade. Crispness is texel density, not filtering: the near cascade
 * covers about 55 m, so 2048 puts a texel at 2.7 cm and 4096 at 1.3 cm. Each step doubles the
 * memory (three cascades at 4096 is roughly 200 MB of depth) without costing draw calls.
 */
const SHADOW_MAP_SIZE = 2048;

interface Chunk {
  key: string;
  cx: number;
  cz: number;
  group: THREE.Group;
  colliders: Collider[];
  heights: Float32Array;
  physics: RAPIER.Collider[] | null;
}


const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uNightTop;
  uniform vec3 uNightHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSun1;
  uniform vec3 uSun2;
  uniform vec3 uMoon;
  uniform float uSuns;
  uniform float uDay;
  uniform float uSunset;
  varying vec3 vDir;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  vec3 sunDisc(vec3 d, vec3 s, float strength) {
    float c = dot(d, s);
    return uSunColor * strength * (smoothstep(0.9975, 0.9992, c) * 1.6 + pow(max(c, 0.0), 32.0) * 0.28 + pow(max(c, 0.0), 4.0) * 0.06);
  }
  void main() {
    vec3 d = normalize(vDir);
    float t = clamp(d.y, 0.0, 1.0);
    vec3 top = mix(uNightTop, uTop, uDay);
    vec3 horizon = mix(uNightHorizon, uHorizon, uDay);
    vec3 flatD = normalize(vec3(d.x, 0.0, d.z));
    vec3 flatS = normalize(vec3(uSun1.x, 0.0, uSun1.z));
    horizon += vec3(0.6, 0.22, 0.02) * uSunset * pow(max(dot(flatD, flatS), 0.0), 3.0);
    vec3 col = mix(horizon, top, pow(t, 0.5));
    float sunVis = smoothstep(-0.12, 0.0, uSun1.y);
    col += sunDisc(d, uSun1, sunVis);
    if (uSuns > 1.5) col += sunDisc(d, uSun2, sunVis);
    float moon = smoothstep(0.9988, 0.9996, dot(d, uMoon));
    col += vec3(0.85, 0.88, 0.95) * moon * (1.0 - uDay * 0.8);
    float star = smoothstep(0.988, 1.0, hash(floor(d * 140.0))) * (1.0 - uDay) * smoothstep(0.0, 0.15, d.y);
    col += vec3(star);
    col = mix(col, horizon * 0.85, clamp(-d.y * 3.0, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** The standing "nobody has said what a blow does yet" callback, so `update` can tell. */
const NO_HURT = (): void => {};

/** How many of an actor's textures are uploaded before the frame is given a turn (`prepareActor`). */
const TEXTURES_PER_YIELD = 4;

/**
 * The player as one of the living: the only one the game makes exactly one of, so its key is a
 * named constant. `main` fills in where it stands, whether it may be attacked at all (noclip,
 * aboard, dead: not) and what a blow does, once a frame before everything alive is stepped.
 */
class PlayerTarget implements Living {
  readonly key = PLAYER_KEY;
  readonly label = 'you';
  readonly side: Side = 'player';
  readonly aggression: Aggression = 'aggressive';
  readonly pos = new THREE.Vector3();
  readonly halfHeight = 0.9;
  /**
   * False while the player may be attacked; true while noclipping, aboard, dead or not
   * simulating. It starts true, so nothing can pick on a player at the origin before the loop
   * has said where they are.
   */
  dead = true;
  /** What the loop does with a blow: it filters mounted, noclip and aboard itself. */
  hurt: (damage: number) => void = NO_HURT;
  radiusToward(): number {
    return 0.35;
  }
  damage(amount: number): void {
    this.hurt(amount);
  }
}

export class World {
  planet!: PlanetDef;
  terrain!: Terrain;
  creatures!: CreatureManager;
  /** The fighters stood to fight the player and each other, on this planet. */
  npcs!: NpcManager;
  /** Everything stood from the creature and NPC catalogue on this planet (the `mobiles` pack). */
  mobiles!: MobileManager;
  /** How many may be spawned and how far their clips run: the settings, kept for the managers later loads make. */
  private mobileDetail = { cap: 40, animRange: 160 };
  /** The mobiles' version the target list was last built at. */
  private mobilesAt = -1;
  /**
   * Set by the game: a sentence when the player is somewhere nothing may be stood (aboard a
   * ship's rooms), else null. Asked by the mobiles' manager on every spawn, whoever calls it.
   */
  refuseMobiles: (() => string | null) | null = null;
  /** What the fighters need from the game, kept across planets and given to each new manager. */
  npcDeps: Partial<NpcDeps> = {};
  /** The player as something that can be hurt and fought: its place and state are set each frame. */
  readonly playerTarget = new PlayerTarget();
  /**
   * Seconds of simulated play since the world loaded: advanced by `stepLiving`, by dt, never from
   * a wall clock, so `__debug.advance` exercises everything that runs on a timer.
   */
  simTime = 0;
  /** Whether the caller has said where the player stands since the last `update`; see `update`. */
  private playerTargetSet = false;
  /** The one list handed round each frame, rebuilt only when a manager has gained or lost a body. */
  private readonly livingList: Living[] = [];
  private livingAt = { creatures: -1, npcs: -1, player: false };
  /** Blaster turrets standing near where the player arrived. */
  turrets!: TurretManager;
  /** The gallery world's labels and animated mannequins, on that planet only. */
  gallery: Gallery | null = null;
  /** Every blaster bolt in the air, whoever fired it. */
  readonly bolts: Bolts;
  readonly day = new DayCycle(0, 1);
  /** Every vehicle on the world: the placeholder bike and whatever the garage (B) spawned. */
  readonly vehicles: Vehicle[] = [];
  garage: Garage | null = null;
  /**
   * The ships that fight (NPC ships, the player's, idle garage ships), beside the living list and not in it.
   * Assigned in the constructor right after `bolts.visuals` (it reads `shipFx` and `bolts`, both made there).
   */
  readonly ships: ShipContacts;
  /** This world's NPC ships (patrols and the NPC tab's), made by `load`; null before the first load. */
  npcShips: NpcShipManager | null = null;
  /** The ship the player flies or is aboard, and whether play is simulated: both set by the game's `stepVehicles` every step. */
  playerShip: Vehicle | null = null;
  simulating = true;
  private props!: PropFactory;
  private readonly chunks = new Map<string, Chunk>();
  private readonly farTiles = new Map<string, THREE.Mesh>();
  private readonly chunkRoot = new THREE.Group();
  private lastTx = Number.NaN;
  private lastTz = Number.NaN;
  private readonly terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private water: THREE.Mesh | null = null;
  private localWater: THREE.Mesh[] = [];
  /** Real flora from the planet's terrain, replacing procedural props when a pack provides the models. */
  private flora: FloraPlanter | null = null;
  /** The planet's ground textures, when the pack carries them; the ground material comes from here. */
  private groundTextures: TerrainTextures | null = null;
  /** Texture anisotropy the renderer supports, set once by main. */
  static anisotropy = 4;
  /** Detailed ground chunks each way around the player, and coarse far tiles; the settings move them. */
  viewRadius = VIEW_RADIUS;
  farRadius = FAR_RADIUS;
  /** How far placed objects load, over the game's ranges; the settings move it. */
  objectReach = 1;
  private readonly dayFog = new THREE.Color();
  private readonly nightFog = new THREE.Color();
  private readonly sunColor = new THREE.Color();
  private readonly moonColor = new THREE.Color(0x8fa8d8);
  private lastCx = Number.NaN;
  private lastCz = Number.NaN;
  private exclusions: Exclusion[] = [];
  pack: AssetPack | null = null;
  packStatus = 'no pack';
  /** How far the pack's own loading has got, 0 to 1, by stage; the loading screen reads it. */
  packProgress = 1;
  private packBase = '';
  private readonly structures: THREE.Object3D[] = [];
  private structureColliders: RAPIER.Collider[] = [];
  private layoutStream: LayoutStreamer | null = null;
  /** Particle effects from the pack (campfires, smoke, sparks), placed by the streamer. */
  private particles: ParticleEffects | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  /** The building cell the player is in, or null outside. */
  cellState: CellState | null = null;
  private readonly prevPlayerPos = new THREE.Vector3(Number.NaN, 0, 0);
  private readonly hiddenGround: THREE.Object3D[] = [];
  private groundHiddenFor: Building | null = null;
  private csm: CSM | null = null;
  /** How far the cascades reach; `__debug.shadows(m)` rebuilds them at a new distance. */
  shadowDistance = SHADOW_DISTANCE;
  /** Model radius below which a placed object does not cast; `__debug.shadows(m, r)` changes it. */
  shadowMinRadius = SHADOW_MIN_RADIUS;
  /** Multiplier on the sky's ambient: below 1 is darker than retail. */
  ambientScale = AMBIENT_SCALE;
  private shadowRadius = SHADOW_RADIUS;
  private shadowIntensity = SHADOW_INTENSITY;
  private shadowMapSize = SHADOW_MAP_SIZE;

  /** Which ramp row feeds ambient, and how hard. Reports the colour it lands on. */
  setAmbient(row?: number, scale?: number): { row: number; scale: number; color: string; intensity: number; ground: string; shadowRow: string | null } {
    if (row !== undefined && this.swgSky) this.swgSky.ambientRow = row;
    if (scale !== undefined) this.ambientScale = scale;
    return { row: this.swgSky?.ambientRow ?? -1, scale: this.ambientScale, color: this.hemi.color.getHexString(), intensity: this.hemi.intensity, ground: this.hemi.groundColor.getHexString(), shadowRow: this.swgSky?.lighting.shadow.getHexString() ?? null };
  }
  /** The planet's own sky when its pack carries one; the procedural dome is hidden while it is up. */
  swgSky: SwgSky | null = null;
  /** Rain, dust storms and snow, and which area's rows the sky draws (weather.ts). Made in the constructor. */
  readonly weather: Weather;
  /** Set by main before update: the player is aboard a ship's rooms. */
  aboard = false;
  /** Set by main before update: the ship the player rides (its box keeps rain out of the canopy), or null. */
  weatherHull: Vehicle | null = null;
  /** Set by main before update: whatever the player rides (never a roof for the rain), or null. */
  weatherRidden: Vehicle | null = null;
  /** How far the weather has faded the cascades' shadows: 1 none, 0 a storm row that turns them off. */
  private weatherShadowScale = 1;
  private readonly groundAtCached = (x: number, z: number): number | null => this.terrain.heightIfCached(x, z, FAR_TILE, FAR_RES);
  private readonly waterAtFn = (x: number, z: number): number => this.terrain.waterHeightAt(x, z);
  /** Set by main: needed to filter the sky into an environment map for reflective surfaces. */
  renderer: THREE.WebGLRenderer | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTexture: THREE.Texture | null = null;
  /** The first face of the reflection cube wanted (loading or loaded), or null while the dome is filtered instead. */
  private envWant: string | null = null;
  /** First faces of cubes that failed to load: never asked for again on this sky. */
  private readonly envFailed = new Set<string>();
  private envTimer = 99;
  private readonly fill = new THREE.DirectionalLight(0xffffff, 0);
  private waterFar: THREE.Mesh | null = null;
  private waterTime = 0;
  private readonly waterMaterials: WaterMaterial[] = [];
  /** Every water surface with the look its own terrain shader asks for, and what it reflects. */
  readonly waterBodies = new WaterBodies();
  private waterNear: WaterBody | null = null;
  private waterFarBody: WaterBody | null = null;
  /** Heat sources the effects read: the lava tables are handed over here (App sets it). */
  heat: HeatSources | null = null;
  /** Lava where the terrain puts it: one merged mesh per look (loadLava). */
  private readonly localLava: THREE.Mesh[] = [];
  private readonly lavaMaterials: LavaMaterial[] = [];
  /** Per table (shared with the heat haze) and merged. */
  private readonly lavaGeometries: THREE.BufferGeometry[] = [];
  /** Owned by this planet: never the runtime noise or the stand-in ramp, which live for the app. */
  private readonly lavaTextures: THREE.Texture[] = [];
  private readonly lavaTables = new Set<SwgWaterTable>();
  private lavaLooks: { style: string; tables: number; textures: LavaTextures['source'] }[] = [];
  /** Multiplier on the sky's fog density, for tuning from the console. */
  fogScale = 1;
  /** The player's own fog setting, over the planet's: 1 as the planet has it. */
  userFog = 1;
  private rippleClock = 0;
  /** Where each mover was at the last ripple pass, for its velocity through the water. */
  private readonly lastSeen = new WeakMap<object, THREE.Vector3>();
  private readonly splashes = new Splashes();
  private readonly dust = new Dust();
  private dustDue = 0;
  private readonly dustColor = new THREE.Color();
  /**
   * A fixed pool of lights for building interiors, on the interior layer only: the cell the
   * player is in borrows them. A fixed count keeps the shader variants stable, so entering a new
   * room never recompiles every material in the scene.
   */
  private readonly interiorPoints: THREE.PointLight[] = [];
  private readonly interiorParallel = new THREE.DirectionalLight(0xffffff, 0);
  private readonly interiorAmbient = new THREE.AmbientLight(0xffffff, 0);
  private interiorLightsFor: { building: Building; cell: number } | null = null;
  private portals: PortalRenderer | null = null;
  private readonly csmMaterials = new WeakSet<THREE.Material>();
  private csmScanAt = 0;
  private loadToken = 0;

  /** The ships pack's particle effects (bolts in flight, their hits), played wherever the ships go, on every planet. */
  readonly shipFx: ParticleEffects;
  /** The weapons pack's particle effects: the guns' own bolts, muzzle flashes, hits and beams. */
  readonly weaponFx: ParticleEffects;
  private readonly warmedFx = new Set<string>();

  constructor(readonly scene: THREE.Scene, readonly physics: Physics) {
    // First: nothing below reads it, but main configures it right after constructing the world.
    this.weather = new Weather(physics);
    this.bolts = new Bolts(scene);
    this.shipFx = new ParticleEffects(scene, `${import.meta.env.BASE_URL}assets-private/ships/`);
    this.weaponFx = new ParticleEffects(scene, `${import.meta.env.BASE_URL}assets-private/weapons/`);
    this.bolts.weaponVisuals = this.weaponFx;
    this.bolts.visuals = this.shipFx;
    // The ships that fight: here, since shipFx and bolts are made just above. npcDeps is a field initialiser (so
    // it exists), and the garage is read when a combat is made, not now.
    this.ships = new ShipContacts(this.shipFx, this.bolts, () => this.npcDeps.effects ?? null, () => this.garage ?? null);
    this.ships.onShipDown = (v) => this.npcShips?.destroyed(v, this.simTime);
    void this.ships.load(import.meta.env.BASE_URL);
    scene.add(this.chunkRoot, this.sun, this.sun.target, this.hemi, this.fill, this.fill.target, this.splashes.points, this.dust.points);
    markActor(this.splashes.points);
    markActor(this.dust.points);
    for (let i = 0; i < INTERIOR_LIGHT_CAP; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.layers.set(INTERIOR_LAYER);
      this.interiorPoints.push(l);
      scene.add(l);
    }
    this.interiorParallel.layers.set(INTERIOR_LAYER);
    this.interiorAmbient.layers.set(INTERIOR_LAYER);
    scene.add(this.interiorParallel, this.interiorParallel.target, this.interiorAmbient);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(7000, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uNightTop: { value: new THREE.Color(0x04060e) },
          uNightHorizon: { value: new THREE.Color(0x0e1424) },
          uSunColor: { value: new THREE.Color() },
          uSun1: { value: new THREE.Vector3() },
          uSun2: { value: new THREE.Vector3() },
          uMoon: { value: new THREE.Vector3() },
          uSuns: { value: 1 },
          uDay: { value: 1 },
          uSunset: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
    markActor(this.sky);
  }

  /** The pack directory this planet (or zone) loads from. */
  packId = '';

  load(planet: PlanetDef, packId = packIdOf(planet)): void {
    this.unload();
    this.planet = planet;
    this.packId = packId;
    this.terrain?.detachSwg();
    this.terrain = new Terrain(planet);
    this.props = new PropFactory(planet);
    this.creatures = new CreatureManager(planet, this.terrain, this.physics);
    this.scene.add(this.creatures.group);
    this.turrets = new TurretManager(this.physics, this.terrain);
    this.scene.add(this.turrets.group);
    this.npcs = new NpcManager(this.scene, this.physics, this.terrain, import.meta.env.BASE_URL);
    this.npcs.attach(this.npcDeps);
    // The catalogue's mobiles. The asset cache outlives the planet; the catalogue is a getter,
    // not a value, because on a cold first load it is usually still in flight here.
    const mobileAssets = MobileAssets.for(import.meta.env.BASE_URL);
    mobileAssets.prepare = (root) => this.prepareActor(root);
    mobileAssets.forget = (mats) => this.forgetMaterials(mats);
    this.mobiles = new MobileManager({
      physics: this.physics,
      terrain: this.terrain,
      bolts: this.bolts,
      assets: mobileAssets,
      effects: () => this.npcDeps.effects ?? null,
      catalogue: () => MobileCatalogue.loaded(import.meta.env.BASE_URL),
      targets: () => this.targets(),
      groundAt: (x, y, z, inside) => this.groundAt(x, y, z, inside),
      // A mobile put down inside starts in the room whose box holds it (else the player's, who is
      // inside when anything is), then is followed through the portals as the player is.
      cellAt: (p) => this.layoutStream?.buildingAt(p) ?? this.cellState,
      followCell: (state, prev, pos) => (this.layoutStream ? this.layoutStream.trackCell(state, prev, pos) : null),
      spawnSpot: (from, forward, distance, inside) => this.spawnSpot(from, forward, distance, inside),
      refuse: () => (this.planet?.space ? 'nothing can be stood in space' : (this.refuseMobiles?.() ?? null)),
      shadows: () => this.renderer?.shadowMap.enabled ?? false,
      // A getter: the rack arrives after the world is made, and a person spawned before it is unarmed.
      weapons: () => this.npcDeps.weapons ?? null,
    });
    // The fighters stand on a building's floor as the mobiles do: their room followed through the
    // portals (the floor under them is then found by a ray, the terrain outside).
    this.npcs.attach({
      cellAt: (p) => this.layoutStream?.buildingAt(p) ?? this.cellState,
      followCell: (state, prev, pos) => (this.layoutStream ? this.layoutStream.trackCell(state, prev, pos) : null),
    });
    // The NPC ships of this world (unload disposed the last one's). `this.terrain` is assigned above and
    // `this.playerTarget` is a field initialiser; everything else is an arrow read when it is called.
    this.npcShips = new NpcShipManager({
      bolts: this.bolts,
      ships: this.ships,
      vehicles: this.vehicles,
      garage: async () => (this.garage ??= await Garage.load(import.meta.env.BASE_URL)),
      spawnHull: (def, fit, at, heading) => this.spawnHull(def, fit, at, heading),
      prepareExtras: (objects) => this.prepareExtras(objects),
      dispose: (v) => this.disposeVehicle(v),
      effects: () => this.npcDeps.effects ?? null,
      physics: this.physics,
      groundAt: planet.space ? null : (x, z) => this.terrain.heightAt(x, z),
      space: !!planet.space,
      zoneTier: ZONE_TIER[planet.id] ?? 3,
      playerPos: this.playerTarget.pos,
    });
    this.mobiles.cap = this.mobileDetail.cap;
    this.mobiles.animRange = this.mobileDetail.animRange;
    this.scene.add(this.mobiles.group);
    this.mobilesAt = -1;
    // A fresh planet, a fresh clock and a fresh list of the living.
    this.simTime = 0;
    this.livingAt.creatures = -1;
    this.livingAt.npcs = -1;
    this.physics.setGravity(planet.gravity);

    const s = planet.sky;
    this.day.configure(s.sunAzimuth, s.sunElevation);
    const u = this.sky.material.uniforms;
    u.uTop.value.set(s.top);
    u.uHorizon.value.set(s.horizon);
    u.uSunColor.value.set(s.sunColor);
    u.uSuns.value = s.suns;

    this.dayFog.set(planet.fog.color);
    this.nightFog.set(planet.fog.color).multiplyScalar(0.08).lerp(new THREE.Color(0x0a0f1c), 0.5);
    this.scene.fog = new THREE.FogExp2(planet.fog.color, planet.fog.density * FOG_SCALE);
    this.sunColor.set(s.sunColor);
    this.hemi.color.set(planet.light.ambientSky);
    this.hemi.groundColor.set(planet.light.ambientGround);

    if (planet.water) this.createGlobalWater(this.waterBodies.lookFor(null, planet), planet.water.level);

    this.lastCx = Number.NaN;
    this.lastCz = Number.NaN;
    this.lastTx = Number.NaN;
    this.lastTz = Number.NaN;
    this.exclusions = [];
    this.loadToken++;
    this.day.update(0, false);
    this.applyLighting();
  }

  /** Load converted SWG content for this planet, if the private pack exists. */
  async loadPack(spawn: THREE.Vector3): Promise<THREE.Vector3 | null> {
    const token = this.loadToken;
    const planet = this.planet;
    this.packStatus = 'loading';
    this.packProgress = 0;
    const pack = await AssetPack.load(this.packId);
    if (token !== this.loadToken) return null;
    if (!pack) {
      this.packStatus = 'no pack';
      this.packProgress = 1;
      return null;
    }
    this.pack = pack;
    this.packProgress = 0.12;

    const scatter: ScatterItem[] = [];
    const addScatter = async (category: string, density: number, minScale: number, maxScale: number) => {
      const models = await pack.models(pack.category(category).map((m) => m.id));
      for (const model of models) scatter.push({ model, density: density / Math.max(1, models.length), minScale, maxScale });
    };
    await addScatter('rocks', planet.props.rockDensity * 1.2, 0.8, 1.6);
    await addScatter('debris', 0.35, 0.9, 1.1);
    await addScatter('vaporators', 0.25, 1, 1);
    await addScatter('flora', 0.9, 0.8, 1.2);
    if (token !== this.loadToken) return null;
    this.packProgress = 0.3;

    const layout = pack.layout;
    const placements = layout ? [] : (OUTPOSTS[planet.id] ?? []);
    const structures: { model: LoadedModel; x: number; z: number; rot: number; flatten: number }[] = [];
    for (const p of placements) {
      try {
        const model = await pack.model(p.model);
        structures.push({ model, x: spawn.x + p.x, z: spawn.z + p.z, rot: p.rot, flatten: p.flatten ?? model.radius + 6 });
      } catch {
        console.warn(`outpost: ${p.model} not in pack, skipped`);
      }
    }
    if (token !== this.loadToken) return null;

    // Level the ground under each structure, keep procedural props off it, then rebuild.
    for (const st of structures) {
      this.terrain.flattenZones.push({ x: st.x, z: st.z, r: st.flatten, h: this.terrain.rawHeightAt(st.x, st.z) });
      this.exclusions.push({ x: st.x, z: st.z, r: st.model.radius + 4 });
    }

    // The planet's real terrain, with every building's ground modification applied where the snapshot puts it.
    if (layout?.terrain) {
      const trn = await pack.terrain();
      if (token !== this.loadToken) return null;
      if (trn) {
        const layers: BuildingLayerSource[] = [];
        for (const o of layout.objects) {
          if (!o.layer || o.contained) continue;
          const bytes = await pack.bytes(o.layer);
          if (!bytes) continue;
          layers.push({ bytes, x: o.x, z: o.z, yaw: yawOf(o.q) });
        }
        if (token !== this.loadToken) return null;
        try {
          const t0 = performance.now();
          const swg = await SwgTerrain.create(trn, layers, layout.center.x, layout.center.z, (file) => pack.bytes(file));
          if (token !== this.loadToken) return null;
          this.terrain.attachSwg(swg);
          await this.waterBodies.load(pack, planet.id);
          if (token !== this.loadToken) return null;
          this.applySwgWater(swg);
          await this.loadLava(pack, swg); // never rejects; drops its own work if another load began meanwhile
          if (token !== this.loadToken) return null;
          this.packProgress = 0.55;
          console.info(`terrain: ${this.terrain.swg!.template.name} with ${layers.length} building layers loaded in ${(performance.now() - t0).toFixed(0)} ms`);
          await this.loadFlora(pack, swg);
          if (token !== this.loadToken) return null;
          this.packProgress = 0.7;
          await this.loadGroundTextures(pack);
          if (token !== this.loadToken) return null;
          this.packProgress = 0.85;
          await this.loadSky(pack, spawn);
          if (token !== this.loadToken) return null;
          this.packProgress = 0.92;
        } catch (err) {
          console.warn('terrain: failed to load the planet terrain, keeping procedural ground', err);
        }
      }
    }

    // A pack with a sky but no terrain (the gallery, a space zone) still gets its sky, and a space zone its planets.
    if (!layout?.terrain) {
      try {
        await this.loadSky(pack, spawn);
        if (planet.space) await this.loadSpaceBodies(pack);
      } catch (err) {
        console.warn('sky: failed to load', err);
      }
      if (token !== this.loadToken) return null;
    }
    if (planet.id === 'gallery' && layout) {
      this.gallery?.dispose();
      this.gallery = new Gallery(this.scene, pack.url(''), layout.center, (x, z) => this.terrain.heightAt(x, z));
      void this.gallery.load();
    }

    // Snapshot objects stream in around the player from here on (see LayoutStreamer).
    if (layout) {
      this.layoutStream?.dispose();
      this.particles?.dispose();
      this.particles = new ParticleEffects(this.scene, pack.url(''));
      this.particles.heightAt = (x, z) => this.terrain.heightAt(x, z);
      // The gallery is one long walk of exhibits with nothing else to draw: everything loads from anywhere on it.
      this.layoutStream = new LayoutStreamer(this.scene, this.physics, pack, layout, this.particles, { reach: planet.id === 'gallery' ? 4 : this.streamReach(), hugeColliders: !!planet.space });
      // A space zone's hyperspace effects are made ready now (their textured batches hidden in the scene, their
      // textures uploaded), so settle() compiles them behind the loading screen and no jump builds a program on a
      // live frame. Not `solid`: the jump places them without it (placeZoneEffect). `spaceData` was set by
      // loadSpaceBodies above.
      if (planet.space) {
        const fx = this.particles;
        for (const f of Object.values(this.hyperspaceEffects())) if (f) await fx.prepare(f, this.renderer);
        if (token !== this.loadToken) return null;
      }
      // Placed objects pull the procedural ground up to their feet, so buildings stand on it;
      // in space nothing stands on anything, and an anchor would raise a needle of ground three
      // kilometres tall under every asteroid.
      if (!this.terrain.swg && !planet.space) {
        for (const p of this.layoutStream.objects) if (p.radius >= 2 && !p.contained) this.terrain.addAnchor({ x: p.x, z: p.z, y: p.y, r: p.radius });
      }
    }
    this.props.dispose();
    this.props = new PropFactory(planet, this.flora ? [] : scatter);
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    for (const [key, t] of this.farTiles) {
      this.chunkRoot.remove(t);
      t.geometry.dispose();
      const [tx, tz] = key.split(',').map(Number);
      this.terrain.releaseFarTile(tx, tz, FAR_TILE, FAR_RES);
    }
    this.farTiles.clear();
    this.lastCx = Number.NaN;
    this.lastCz = Number.NaN;
    this.lastTx = Number.NaN;
    this.lastTz = Number.NaN;
    this.stream(spawn, Infinity);
    this.streamFar(spawn, Infinity);

    for (const st of structures) this.placeStructure(st.model, st.x, st.z, st.rot);
    this.packBase = `${scatter.length} scatter models, ${structures.length} structures${this.terrain.swg ? ', SWG terrain' : ''}`;
    this.packStatus = this.packBase;
    this.packProgress = 1;
    if (!this.layoutStream) return this.terrain.swg ? new THREE.Vector3(spawn.x, this.terrain.heightAt(spawn.x, spawn.z), spawn.z) : null;
    this.layoutStream.update(spawn);
    return this.layoutStream.clearSpawn(spawn, (x, z) => this.terrain.heightAt(x, z)) ?? new THREE.Vector3(spawn.x, this.terrain.heightAt(spawn.x, spawn.z), spawn.z);
  }

  private placeStructure(model: LoadedModel, x: number, z: number, rot: number): void {
    const y = this.terrain.heightAt(x, z);
    const obj = model.scene.clone();
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    obj.updateMatrixWorld(true);
    this.scene.add(obj);
    this.structures.push(obj);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0));
    for (const prim of model.primitives) {
      const pos = prim.geometry.getAttribute('position');
      const idx = prim.geometry.getIndex();
      if (!pos || !idx) continue;
      const vertices = new Float32Array(pos.array as ArrayLike<number>);
      const indices = new Uint32Array(idx.array as ArrayLike<number>);
      const desc = R.ColliderDesc.trimesh(vertices, indices).setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.8);
      this.structureColliders.push(this.physics.world.createCollider(desc));
    }
  }

  /** Leave the planet: everything it streamed goes, for the select screen to show over nothing. */
  leave(): void {
    // No new load follows, so a lava (or sky) load still in flight must see its token go stale, or
    // it would add to an empty scene behind the select screen.
    this.loadToken++;
    this.unload();
  }

  /** Moved on by every unload: a vehicle being prepared for the world that went is not made (spawnVehicle's `alive`). */
  private loadGeneration = 0;

  private unload(): void {
    this.loadGeneration++;
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    for (const t of this.farTiles.values()) {
      this.chunkRoot.remove(t);
      t.geometry.dispose();
    }
    this.farTiles.clear();
    this.lastTx = Number.NaN;
    this.lastTz = Number.NaN;
    for (const o of this.structures) this.scene.remove(o);
    this.structures.length = 0;
    this.layoutStream?.dispose();
    this.layoutStream = null;
    this.particles?.dispose();
    this.particles = null;
    if (this.spaceBodies) {
      this.scene.remove(this.spaceBodies);
      this.spaceBodies = null;
    }
    this.flora = null;
    this.groundTextures?.dispose();
    this.groundTextures = null;
    this.dropSky();
    this.waterBodies.clear();
    this.waterNear = this.waterFarBody = null;
    for (const m of this.localWater) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.localWater.length = 0;
    this.dropLava();
    this.cellState = null;
    this.groundHiddenFor = null;
    this.prevPlayerPos.x = Number.NaN;
    this.hiddenGround.length = 0;
    for (const c of this.structureColliders) this.physics.removeCollider(c);
    this.structureColliders = [];
    this.pack?.dispose();
    surfaces.sweep();
    this.pack = null;
    this.packStatus = 'no pack';
    if (this.creatures) {
      this.scene.remove(this.creatures.group);
      this.creatures.dispose();
    }
    this.npcs?.dispose();
    // The spawned and ambient mobiles go with the planet (their ragdolls with them); their models
    // stay in the cache, released, and anything held by nothing is trimmed to the budget.
    if (this.mobiles) {
      this.scene.remove(this.mobiles.group);
      this.mobiles.dispose();
    }
    this.mobilesAt = -1;
    MobileAssets.for(import.meta.env.BASE_URL).trim();
    // Nothing may hand out a body from the world that has just gone.
    this.livingList.length = 0;
    this.livingAt.creatures = -1;
    this.livingAt.npcs = -1;
    if (this.turrets) {
      this.scene.remove(this.turrets.group);
      this.turrets.dispose();
    }
    this.bolts.clear();
    this.gallery?.dispose();
    this.gallery = null;
    this.spaceStations = [];
    this.spaceData = null;
    // The NPC ships go with the world: the manager forgets them (its spawns still being built throw theirs
    // away), the contacts are dropped, and the loop below disposes their vehicles with every other one.
    this.npcShips?.dispose();
    this.npcShips = null;
    this.ships.clear();
    for (const sp of [...this.vehicles]) this.disposeVehicle(sp);
    this.vehicles.length = 0;
    this.props?.dispose();
    if (this.water) {
      this.scene.remove(this.water);
      this.water.geometry.dispose();
      this.water = null;
    }
    if (this.waterFar) {
      this.scene.remove(this.waterFar);
      this.waterFar.geometry.dispose();
      this.waterFar = null;
    }
    // One lit material per body now, so a planet leaves a couple of dozen behind rather than three:
    // both the portal renderer's set and the cascades' map are strong, and the first is walked on
    // every stencil change.
    this.forgetMaterials(this.waterMaterials);
    for (const m of this.waterMaterials) m.dispose();
    this.waterMaterials.length = 0;
  }

  /**
   * The sea: a finely divided plane around the player that swells, and a flat ring beyond it
   * out to the horizon. Both follow the player, the near plane snapping to its own cell size.
   */
  private createGlobalWater(look: WaterLook, level: number): void {
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(WATER_NEAR, WATER_NEAR, WATER_SEGMENTS, WATER_SEGMENTS).rotateX(-Math.PI / 2));
    this.water.name = 'water:sea';
    this.water.position.y = level;
    this.water.receiveShadow = true;
    this.water.frustumCulled = false;
    this.waterNear = this.waterBodies.add(this.water, true, look, 'seaNear');
    this.scene.add(this.water);
    this.waterFar = new THREE.Mesh(new THREE.RingGeometry(WATER_NEAR * 0.48, 9000, 96, 1).rotateX(-Math.PI / 2));
    this.waterFar.name = 'water:sea-far';
    this.waterFar.position.y = level - 0.05;
    this.waterFar.frustumCulled = false;
    this.waterFarBody = this.waterBodies.add(this.waterFar, false, look, 'seaFar');
    this.scene.add(this.waterFar);
    this.waterMaterials.push(this.waterNear.lit, this.waterFarBody.lit);
  }

  /** The planet's sky from its pack: replaces the procedural dome and drives the lights, fog and reflections. */
  /** A space zone's planets and moons: textured spheres hung far out in the directions the zone's terrain file gives, riding with the camera like the sky. */
  private spaceBodies: THREE.Group | null = null;

  /** The zone's stations by name (the game's title when the pack has one), in the game's coordinates, for the map. */
  private spaceStations: { name: string; title: string | null; x: number; z: number }[] = [];

  /** The space zone's whole pack (space.json), null on a ground planet and before it loads. Public, read-only by convention. */
  spaceData: SpacePack | null = null;

  /** The name of the station standing at a point (the nearest within a kilometre): its title from the game's strings, else one made from its name, else a plain word. */
  stationNameAt(x: number, z: number): string {
    let best: { name: string; title: string | null } | null = null;
    let bestD = 1000;
    for (const s of this.spaceStations) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) return 'station';
    return best.title ?? `station ${best.name.replace(/^station_/, '').replace(/_/g, ' ')}`;
  }

  /** The name of the scenery at a point (the Star Destroyer): the nearest whose radius plus a kilometre covers it, or null. Game frame. */
  sceneryNameAt(x: number, z: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const s of this.spaceData?.scenery ?? []) {
      const d = Math.hypot(-s.x - x, s.z - z);
      if (d < s.radius + 1000 && d < bestD) {
        bestD = d;
        best = s.name;
      }
    }
    return best;
  }

  /** The jump's two converted warp effects (pack-relative particle JSON), from the zone's pack; null where there is none. */
  hyperspaceEffects(): { enter: string | null; exit: string | null } {
    const fx = this.spaceData?.hyperspace?.effects;
    return { enter: fx?.enter ?? null, exit: fx?.exit ?? null };
  }

  /**
   * Place one of the jump's effects framed on a hull (`frame`, its live matrixWorld, `local` in that frame):
   * transient, and not `solid`, so only its textured streaks and stars draw. Its untextured quads (the enter's
   * 90 m black drop, the exit's white-to-blue backdrop) were made for the client's camera fixed behind the ship
   * and showed as flat boxes in space from ours; the jump's own tunnel covers the move. Null outside a pack.
   */
  placeZoneEffect(file: string, local: THREE.Matrix4, frame: THREE.Matrix4): EffectHandle | null {
    return this.particles?.place(file, local, false, true, frame, false) ?? null;
  }

  /** Take one of the jump's effects away (nothing happens if the world it was placed in has gone). */
  removeZoneEffect(h: EffectHandle): void {
    this.particles?.remove(h);
  }

  private async loadSpaceBodies(pack: AssetPack): Promise<void> {
    const token = this.loadToken;
    // This zone's NPC ship manager, captured before the wait: a zone left meanwhile is not given anchors.
    const mgr = this.npcShips;
    // The whole pack, fetched once per zone and shared with the System Map's catalogue (the same promise).
    const data = await loadSpacePack(import.meta.env.BASE_URL, this.packId);
    if (token !== this.loadToken) return;
    this.spaceData = data;
    // The patrols' anchors (stations, hyperspace points, the arrival lane); they never stop the sky loading.
    try {
      if (mgr && mgr === this.npcShips) mgr.setAnchors(data);
    } catch (err) {
      console.warn('npc ships: no anchors', err);
    }
    if (!data) return;
    // The stations' names (and the game's titles), at the game's mirrored X.
    // A pack converted before titles were written has none, and `normalise` fills the title with the raw name: that is no title.
    this.spaceStations = (data.stations ?? []).map((s) => ({ name: s.name, title: s.title && s.title !== s.name ? s.title : null, x: -s.x, z: s.z }));
    const group = new THREE.Group();
    const loader = new THREE.TextureLoader();
    const discs: { dir: THREE.Vector3; cos: number }[] = [];
    for (const p of data.planets) {
      // The direction is in the game's own coordinates, mirrored in X like everything converted.
      const dir = new THREE.Vector3(-p.direction[0], p.direction[1], p.direction[2]);
      if (dir.lengthSq() < 1) continue;
      dir.normalize();
      const tex = p.texture ? await loader.loadAsync(pack.url(p.texture)).catch(() => null) : null;
      if (tex) tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(SPACE_BODY_SIZE * p.size, 48, 32), new THREE.MeshLambertMaterial({ map: tex ?? undefined, color: tex ? 0xffffff : 0x8a97a6, fog: false, depthWrite: false }));
      mesh.position.copy(dir).multiplyScalar(SPACE_BODY_DISTANCE);
      mesh.renderOrder = -4;
      mesh.frustumCulled = false;
      group.add(mesh);
      // The disc it covers on the sky, for the lens flare (SwgSky.setSpaceOccluders).
      const sin = Math.min(1, (SPACE_BODY_SIZE * p.size) / SPACE_BODY_DISTANCE);
      discs.push({ dir: dir.clone(), cos: Math.sqrt(1 - sin * sin) });
    }
    this.spaceBodies = group;
    this.scene.add(group);
    markActor(group);
    // A star behind a planet must not flare through it: the bodies write no depth for the flare to see.
    this.swgSky?.setSpaceOccluders(discs);
    console.info(`space: ${group.children.length} planets and moons in the sky`);
  }

  /** `spawn` is where the player arrives: the weather reads the area there, and its sky's textures load before the loading screen lifts. */
  private async loadSky(pack: AssetPack, spawn: THREE.Vector3): Promise<void> {
    const token = this.loadToken;
    const sky = await SwgSky.load(pack);
    if (!sky) return;
    // Another world was loaded while the textures came: this sky is not wanted any more.
    if (token !== this.loadToken) {
      sky.dispose(this.scene);
      return;
    }
    this.dropSky();
    this.swgSky = sky;
    this.scene.add(sky.group, sky.cloudGroup);
    markActor(sky.group);
    markActor(sky.cloudGroup);
    this.sky.visible = false;
    this.day.swg = true;
    this.day.fixed = sky.spaceLightDir;
    this.fogScale = this.planet.swgFogScale ?? DEFAULT_SWG_FOG_SCALE;
    this.envTimer = 99;
    this.envWant = null;
    // The weather's effects are made and its arrival area's sky loaded inside the awaited loadPack,
    // so the warm-up that follows compiles them and the first frame shows the area's own sky.
    await this.weather.attach({ pack, sky, terrain: this.terrain, planet: this.planet, packId: this.packId, renderer: this.renderer, at: spawn });
    if (token !== this.loadToken) return;
    console.info(`sky: ${sky.data.blocks.length} environment blocks, ${sky.hasGradient ? 'gradient sky' : sky.data.skybox ? 'skybox' : 'clear colour'}, ${sky.data.sun ? 'sun' : 'no sun'}, ${sky.data.moon ? 'moon' : 'no moon'}, ${sky.data.stars?.count ?? 0} stars, reflections from ${sky.environment.day ? 'the planet cube maps' : 'the sky'}`);
  }

  private dropSky(): void {
    if (this.swgSky) {
      this.swgSky.dispose(this.scene);
      this.swgSky = null;
    }
    this.sky.visible = true;
    this.day.swg = false;
    this.day.fixed = null;
    this.fill.intensity = 0;
    this.envTexture?.dispose();
    this.envTexture = null;
    this.envWant = null;
    this.envFailed.clear();
    this.weather.detach();
    // No sky, no storm: the shadows come back whole.
    this.weatherShadowScale = 1;
    for (const l of this.csm?.lights ?? []) l.shadow.intensity = this.shadowIntensity;
    if (this.portals) this.portals.shadowsWanted = true;
    setEnvironment(null);
  }

  /**
   * The environment reflective surfaces see: the block's day or night cube map when the pack
   * has one, otherwise the sky dome itself, filtered again every few seconds as it changes.
   */
  private refreshEnvironment(dt: number): void {
    const sky = this.swgSky;
    if (!sky || !this.renderer) return;
    this.pmrem ??= new THREE.PMREMGenerator(this.renderer);
    // The heaviest block's cube for the hour (the weather's mix picks the block), by its first face:
    // a new area or level with another cube loads that one; a cube that failed is never asked again.
    const cube = this.day.isDay ? sky.environment.day : sky.environment.night;
    const usable = cube && cube.faces.length && !this.envFailed.has(cube.faces[0]) ? cube : null;
    if (usable) {
      const want = usable.faces[0];
      if (this.envWant === want) return;
      this.envWant = want;
      const pmrem = this.pmrem;
      new THREE.CubeTextureLoader().load(
        usable.faces.map((f) => this.pack!.url(f)),
        (tex) => {
          // Another cube was asked for (or the sky went) while this one came: not wanted any more.
          if (this.swgSky !== sky || this.envWant !== want) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          const env = pmrem.fromCubemap(tex).texture;
          tex.dispose();
          this.envTexture?.dispose();
          this.envTexture = env;
          setEnvironment(env, 1);
        },
        undefined,
        () => {
          console.warn(`sky: reflection cube map ${want} failed to load; reflecting the sky instead`);
          this.envFailed.add(want);
          if (this.envWant === want) this.envWant = null;
        },
      );
      return;
    }
    this.envWant = null;
    this.envTimer += dt;
    if (this.envTimer < 4) return;
    this.envTimer = 0;
    // Filtered from a 128 px cube like every other environment water may see, so swapping to it
    // never changes a water material's program key (envMapCubeUVHeight is in that key).
    const env = this.pmrem.fromScene(sky.domeScene, 0.04, 1, 20000, { size: 128 }).texture;
    this.envTexture?.dispose();
    this.envTexture = env;
    setEnvironment(env, 1);
  }

  /**
   * Rings, wakes and splashes from whatever wades or swims: the player, everything alive (the
   * creatures and the fighters both) and the speeders. Each mover's velocity through the water
   * shapes its wake and throws spray when fast.
   */
  private emitRipples(dt: number, playerPos: THREE.Vector3): void {
    this.splashes.update(dt, (x, z) => this.terrain.waterHeightAt(x, z));
    if (!this.waterMaterials.length) return;
    this.rippleClock += dt;
    if (this.rippleClock < RIPPLE_INTERVAL) return;
    const interval = this.rippleClock;
    this.rippleClock = 0;
    const touch = (key: object, p: THREE.Vector3, strength: number) => {
      // Lava takes no rings and throws no spray.
      if (this.lavaTables.size && this.lavaTables.has(this.terrain.swg?.waterTableAt(p.x, p.z) as SwgWaterTable)) return;
      const surface = this.terrain.waterHeightAt(p.x, p.z);
      const depth = surface - p.y;
      let last = this.lastSeen.get(key);
      if (!last) {
        last = new THREE.Vector3(Number.NaN, 0, 0);
        this.lastSeen.set(key, last);
      }
      const known = !Number.isNaN(last.x);
      const vx = known ? (p.x - last.x) / interval : 0;
      const vz = known ? (p.z - last.z) / interval : 0;
      last.copy(p);
      if (depth < -0.3 || depth > 2.5) return;
      const speed = Math.hypot(vx, vz);
      // Standing still barely stirs the water; moving through it leaves a wake.
      if (speed < 0.15) {
        if (Math.random() < 0.25) emitRipple(p.x, p.z, strength * 0.25, this.waterTime);
        return;
      }
      emitRipple(p.x, p.z, strength * Math.min(1, 0.4 + speed / 4), this.waterTime, vx, vz);
      // Spray past a brisk walk, more the faster the mover and the shallower it sits.
      if (speed > 1.6 && depth < 1.6) this.splashes.spawn(p.x, surface, p.z, Math.round(1 + Math.min(speed, 8) * 0.9 * strength), vx, vz);
    };
    touch(this, playerPos, 1);
    // Everything alive that wades or swims, whatever kind of body it is; the player's own ring
    // was drawn above, so its entry in the list is passed over.
    for (const t of this.targets()) if (!t.dead && t !== this.playerTarget) touch(t, t.pos, 0.9);
    // A vehicle stirs the water from its bow and its stern, harder the bigger it is, each point
    // wandering a little so the rings overlap unevenly rather than as one neat wake.
    for (const v of this.vehicles) {
      // Only one riding on the water (a machine floats above it, so its underside is no guide):
      // the touch points sit just under the surface, a flyer overhead stirs nothing.
      if (!v.onWater) continue;
      const strength = 1.6 + v.radius * 0.5;
      v.quaternion(tmpQ);
      const reach = Math.max(0.5, v.radius * 0.6);
      for (const [key, along] of [[v, reach], [v.seat, -reach]] as const) {
        tmpV.set((Math.random() - 0.5) * v.radius * 0.6, 0, along + (Math.random() - 0.5) * 0.4).applyQuaternion(tmpQ).add(v.pos);
        tmpV.y = this.terrain.waterHeightAt(tmpV.x, tmpV.z) - 0.3;
        touch(key, tmpV, strength * (0.8 + Math.random() * 0.4));
      }
    }
  }

  /**
   * Dust behind every machine (not the animals) running over ground: more the faster it goes,
   * in the colour of the ground there, none over water, none in the air.
   */
  private emitDust(dt: number): void {
    this.dust.update(dt);
    this.dustDue += dt;
    if (this.dustDue < 0.05) return;
    const interval = this.dustDue;
    this.dustDue = 0;
    for (const v of this.vehicles) {
      const speed = Math.abs(v.speed);
      if (v.spec.animal || v.groundedPoints < 2 || v.onWater || speed < 2.5) continue;
      const ground = this.terrain.heightAt(v.pos.x, v.pos.z);
      const height = v.pos.y + v.spec.bounds.min[1] - ground;
      if (height > v.spec.hover * 2 + 1) continue;
      v.quaternion(tmpQ);
      const l = v.spec.bounds.max[2] - v.spec.bounds.min[2];
      const w = v.spec.bounds.max[0] - v.spec.bounds.min[0];
      tmpV.set(0, 0, -l * 0.35).applyQuaternion(tmpQ).add(v.pos);
      const vel = v.body.linvel();
      const count = Math.round(interval * (12 + 70 * Math.min(1, speed / 35)) * (0.6 + Math.min(1.4, w * 0.35)));
      this.dust.spawn(tmpV.x, ground, tmpV.z, count, vel.x, vel.z, Math.max(0.6, w * 0.9), this.groundColorAt(tmpV.x, tmpV.z, this.dustColor));
    }
  }

  /** The colour of the ground at a point: its texture family's mean on a real planet, the palette's elsewhere. */
  groundColorAt(x: number, z: number, out: THREE.Color): THREE.Color {
    if (this.terrain.swg && this.groundTextures) {
      const c = this.groundTextures.averageColor(this.terrain.swg.shaderAt(x, z));
      if (c) return out.copy(c);
    }
    return this.terrain.groundColorAt(x, z, out);
  }

  /** Lights, fog and clear colour straight from the sky's colour ramps for this moment. */
  private applySwgLighting(L: SkyLighting, playerPos: THREE.Vector3): void {
    this.sun.color.copy(L.main);
    this.sun.intensity = SWG_MAIN_LIGHT * L.mainScale;
    // A storm row that turns shadows off fades them through the cascades' intensity (never a light,
    // castShadow or shadowMap.enabled, all of which recompile), and the shadow pass is skipped at zero.
    this.weatherShadowScale = this.weather.shadowFactor(L);
    if (this.csm) {
      for (const l of this.csm.lights) {
        l.color.copy(this.sun.color);
        l.intensity = this.sun.intensity;
        l.shadow.intensity = this.shadowIntensity * this.weatherShadowScale;
      }
    }
    if (this.portals) this.portals.shadowsWanted = this.weatherShadowScale > 0.001;
    // What a wet surface reflects at a low angle: the sky's fog colour, a little dimmed.
    WEATHER_UNIFORMS.uWetSky.value.copy(L.fog).multiplyScalar(0.9);
    // Sky above, ground bounce below: the two halves of the client's ambient. Both carry their
    // own scale in the ramp's alpha, so the colours go in as they are and the scales set the
    // light's strength; the bounce is the darker half, mixed toward the sky so it never blackens.
    this.hemi.color.copy(L.ambient).multiplyScalar(L.ambientScale);
    this.hemi.groundColor.copy(L.bounce).multiplyScalar(L.bounceScale).lerp(this.hemi.color, 0.35);
    this.hemi.intensity = SWG_AMBIENT * this.ambientScale;
    this.fill.color.copy(L.fill);
    this.fill.intensity = SWG_FILL * L.fillScale;
    // The client's fill light sits 45 degrees up on the far side from the main light.
    const d = this.day.lightDir;
    const h = Math.hypot(d.x, d.z) || 1;
    this.fill.position.set(playerPos.x - (d.x / h) * 140, playerPos.y + 140, playerPos.z - (d.z / h) * 140);
    this.fill.target.position.copy(playerPos);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(L.fog);
    // The client's fog is Direct3D's EXP2, the same curve as three's, so the density carries over as is.
    fog.density = L.fogDensity * this.fogScale * this.userFog;
  }

  private disposeChunk(c: Chunk): void {
    this.chunkRoot.remove(c.group);
    c.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    this.removeChunkPhysics(c);
  }

  private removeChunkPhysics(c: Chunk): void {
    if (!c.physics) return;
    for (const col of c.physics) this.physics.removeCollider(col);
    c.physics = null;
  }

  private addChunkPhysics(c: Chunk): void {
    if (c.physics) return;
    const cols: RAPIER.Collider[] = [];
    cols.push(this.physics.createHeightfield(c.cx * CHUNK_SIZE, c.cz * CHUNK_SIZE, CHUNK_SIZE, CHUNK_RES, c.heights));
    for (const p of c.colliders) {
      const ground = this.terrain.heightAt(p.x, p.z) - 0.5;
      const halfH = (p.top - ground) / 2;
      const col = this.physics.createStaticCylinder(p.x, ground + halfH, p.z, p.r, halfH);
      if (col) cols.push(col);
    }
    c.physics = cols;
  }

  /** The converted flora models, keyed by the appearance file the terrain names. */
  /** The pack's ground textures; existing chunks and far tiles switch to them when they arrive. */
  private async loadGroundTextures(pack: AssetPack): Promise<void> {
    try {
      const swg = this.terrain.swg;
      const planet = new Map<number, string>();
      if (swg) for (const f of swg.template.generator.shaderGroup.families.values()) planet.set(f.id, f.name);
      const textures = await TerrainTextures.load(pack, World.anisotropy, planet);
      if (!textures) return;
      this.groundTextures?.dispose();
      this.groundTextures = textures;
      const mat = textures.groundMaterial(this.csm);
      this.csmMaterials.add(mat);
      for (const c of this.chunks.values()) c.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === this.terrainMat) (o as THREE.Mesh).material = mat; });
      for (const t of this.farTiles.values()) if (t.material === this.terrainMat) t.material = mat;
      console.info(`terrain: ${textures.families.length} ground textures (${textures.texture.image.width} px)`);
    } catch (err) {
      console.warn('terrain: ground textures failed to load', err);
    }
  }

  /** The material for new ground meshes: textured when the planet has textures, tinted otherwise. */
  private get groundMaterial(): THREE.Material {
    return this.groundTextures && this.terrain.swg ? this.groundTextures.groundMaterial(this.csm) : this.terrainMat;
  }

  private async loadFlora(pack: AssetPack, swg: SwgTerrain): Promise<void> {
    const defs = pack.category('flora').filter((d) => d.appearance);
    if (!defs.length) return;
    const models = await pack.models(defs.map((d) => d.id));
    const byAppearance = new Map<string, LoadedModel>();
    defs.forEach((d, i) => {
      const m = models[i];
      if (m) byAppearance.set(d.appearance!.replace(/\\/g, '/').toLowerCase(), m);
    });
    const families = swg.template.generator.floraGroup.families.size;
    this.flora = new FloraPlanter(swg, byAppearance);
    console.info(`flora: ${byAppearance.size} models for ${families} families`);
  }

  /**
   * Water where the terrain says it is: the global table's height, plus every lake and pool, each
   * drawn with the look of the water shader its own table names.
   */
  private applySwgWater(swg: SwgTerrain): void {
    const planet = this.planet;
    const bodies = this.waterBodies;
    if (swg.template.useGlobalWaterTable) {
      const look = bodies.lookFor(shaderKey(swg.template.globalWaterTableShaderTemplateName) || null, planet);
      if (!this.water) this.createGlobalWater(look, swg.template.globalWaterTableHeight);
      else {
        if (this.waterNear) bodies.restyle(this.waterNear, look);
        if (this.waterFarBody) bodies.restyle(this.waterFarBody, look);
      }
      this.water!.visible = true;
      this.water!.position.y = swg.template.globalWaterTableHeight;
      if (this.waterFar) {
        this.waterFar.visible = true;
        this.waterFar.position.y = swg.template.globalWaterTableHeight - 0.05;
      }
    } else if (this.water) {
      this.water.visible = false;
      if (this.waterFar) this.waterFar.visible = false;
    }
    for (const m of this.localWater) {
      bodies.remove(m);
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.localWater.length = 0;
    const shaders = new Set<string>();
    let lava = 0;
    for (const w of swg.waterTables) {
      // Lava is never water: loadLava draws it with its own material, and it gets no body, no
      // reflections, rings or splashes.
      if (isLavaWater(w.shader, w.waterType, bodies.data?.shaders[w.shader])) {
        lava++;
        continue;
      }
      const pts = w.points.map((p) => new THREE.Vector2(p.x, p.z));
      const tris = THREE.ShapeUtils.triangulateShape(pts, []);
      if (!tris.length) continue;
      const g = new THREE.BufferGeometry();
      const pos: number[] = [];
      for (const p of pts) pos.push(p.x, w.height, p.y);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(tris.flat());
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g);
      mesh.receiveShadow = true;
      mesh.name = `water:${w.name}`;
      // Lakes are triangulated outlines with no interior vertices, so they ripple but do not swell.
      const body = bodies.add(mesh, false, bodies.lookFor(w.shader || null, planet), 'lake');
      this.waterMaterials.push(body.lit);
      if (w.shader) shaders.add(w.shader);
      this.localWater.push(mesh);
      this.scene.add(mesh);
    }
    bodies.lavaTables = lava;
    if (swg.waterTables.length) console.info(`water: ${swg.waterTables.length} local tables (${this.localWater.length} water in ${shaders.size} shaders, ${lava} lava)${swg.template.useGlobalWaterTable ? `, global at ${swg.template.globalWaterTableHeight.toFixed(1)} m` : ', no global table'}`);
  }

  /** Lava where the terrain puts it: one merged mesh per look, the client's textures when the pack has them, the tables handed to the heat haze. */
  private async loadLava(pack: AssetPack, swg: SwgTerrain): Promise<void> {
    const token = this.loadToken;
    const data = this.waterBodies.data;
    const tables = swg.waterTables.filter((w) => isLavaWater(w.shader, w.waterType, data?.shaders[w.shader]));
    if (!tables.length) {
      this.heat?.setLava([]);
      return;
    }
    if (!data) console.warn('lava: no water.json in this pack, drawn in the stand-in look (npm run swg -- water @SWG all assets-private --retail-only)');
    else {
      // An entry written before the lava look has no `lava` block (null is an unreadable MATL, which a reconversion does not mend).
      const stale = [...new Set(tables.map((t) => t.shader))].filter((s) => { const e = data.shaders[s]; return e?.kind === 'lava' && !e.missing && e.lava === undefined && /lava/i.test(e.effect ?? ''); });
      if (stale.length) console.warn(`lava: water.json has no lava look for ${stale.join(', ')}, drawn in the stand-in look (npm run swg -- water @SWG all assets-private --retail-only)`);
    }
    const owned: THREE.Texture[] = [];
    const cache = new Map<string, THREE.Texture>();
    const materials: LavaMaterial[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const meshes: THREE.Mesh[] = [];
    const heatTables: LavaHeatTable[] = [];
    const looks: { style: string; tables: number; textures: LavaTextures['source'] }[] = [];
    const discard = () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of owned) t.dispose();
    };
    for (const group of groupLava(tables).values()) {
      const { shader, shaderSize } = group[0];
      let style = lavaStyleFor(shader, data?.shaders[shader]);
      let textures: LavaTextures;
      try {
        textures = await loadLavaTextures(pack, style, World.anisotropy, cache, owned);
      } catch (err) {
        // loadLavaTextures guards each piece; this is the last line.
        console.warn(`lava: ${shader} textures failed, stand-in look`, err);
        style = { ...FALLBACK_LAVA_STYLE, key: `stand-in:${shader}` };
        textures = standInLavaTextures();
      }
      // Travelled while the textures came: touch nothing.
      if (token !== this.loadToken) return discard();
      this.buildLavaLook(group, style, shaderSize, textures, { materials, geometries, meshes, heatTables, looks });
    }
    if (token !== this.loadToken) return discard();
    this.commitLava(tables, { materials, geometries, meshes, heatTables, looks, owned });
  }

  /** One look's tables as one merged mesh; a look that fails is left out on its own and never stops the rest. */
  private buildLavaLook(group: SwgWaterTable[], style: LavaStyle, shaderSize: number, textures: LavaTextures, out: { materials: LavaMaterial[]; geometries: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; heatTables: LavaHeatTable[]; looks: { style: string; tables: number; textures: LavaTextures['source'] }[] }): void {
    const shader = group[0].shader;
    try {
      const material = createLavaMaterial(style, shaderSize, textures);
      out.materials.push(material);
      const parts = group.map((t) => lavaGeometry(t));
      out.geometries.push(...parts);
      const drawn = parts.filter((p) => p.index !== null);
      if (!drawn.length) throw new Error('no table triangulates');
      const merged = mergeGeometries(drawn);
      if (!merged) throw new Error('geometries do not merge');
      out.geometries.push(merged);
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `lava:${shader}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // Planet-wide bounds: never frustum-tested, and each draw is under a few thousand vertices.
      mesh.frustumCulled = false;
      out.meshes.push(mesh);
      // Only what is drawn shimmers: a table that does not triangulate has nothing for the haze to trace.
      group.forEach((t, i) => { if (parts[i].index) out.heatTables.push(lavaHeatTable(t, parts[i])); });
      out.looks.push({ style: style.key, tables: group.length, textures: textures.source });
    } catch (err) {
      console.warn(`lava: ${shader} (${group.length} tables) not drawn`, err);
    }
  }

  /** Put a finished lava load in the world. Nothing here awaits, so a load that got this far is whole. */
  private commitLava(tables: SwgWaterTable[], built: { materials: LavaMaterial[]; geometries: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; heatTables: LavaHeatTable[]; looks: { style: string; tables: number; textures: LavaTextures['source'] }[]; owned: THREE.Texture[] }): void {
    this.dropLava();
    for (const m of built.meshes) this.scene.add(m);
    this.localLava.push(...built.meshes);
    this.lavaMaterials.push(...built.materials);
    this.lavaGeometries.push(...built.geometries);
    this.lavaTextures.push(...built.owned);
    for (const t of tables) this.lavaTables.add(t);
    this.lavaLooks = built.looks;
    this.heat?.setLava(built.heatTables);
    console.info(`lava: ${tables.length} tables in ${built.looks.length} looks (${built.looks.map((l) => `${l.style} ×${l.tables}`).join(', ')})`);
  }

  /** Every lava piece this planet owns, gone; the heat haze lets go of the tables first, since their geometries go with them. */
  private dropLava(): void {
    this.heat?.setLava([]);
    for (const m of this.localLava) this.scene.remove(m);
    this.localLava.length = 0;
    this.forgetMaterials(this.lavaMaterials);
    for (const m of this.lavaMaterials) m.dispose();
    this.lavaMaterials.length = 0;
    for (const g of this.lavaGeometries) g.dispose();
    this.lavaGeometries.length = 0;
    // The runtime noise and the stand-in ramp are never in this list: they live for the app.
    for (const t of this.lavaTextures) t.dispose();
    this.lavaTextures.length = 0;
    this.lavaTables.clear();
    this.lavaLooks = [];
  }

  /** The lava drawn now and the look every lava material shares (`__debug.lava`). */
  get lavaStatus(): { tables: number; looks: { style: string; tables: number; textures: LavaTextures['source'] }[]; intensity: number; glow: number; glowFrom: number; glowTo: number; axes: 'xyz' | 'xzy' } {
    const e = LAVA_LOOK.axes.value.elements;
    return {
      tables: this.lavaTables.size,
      looks: this.lavaLooks.map((l) => ({ ...l })),
      intensity: LAVA_LOOK.intensity.value,
      glow: LAVA_LOOK.glow.value,
      glowFrom: LAVA_LOOK.glowFrom.value,
      glowTo: LAVA_LOOK.glowTo.value,
      axes: e[4] === 1 ? 'xyz' : 'xzy',
    };
  }

  /** Writes LAVA_LOOK; a threshold change recomputes every lava material's far values. */
  setLavaLook(look: { intensity?: number; glow?: number; glowFrom?: number; glowTo?: number; axes?: 'xyz' | 'xzy' }): void {
    const num = (v: number | undefined) => v !== undefined && Number.isFinite(v);
    if (num(look.intensity)) LAVA_LOOK.intensity.value = look.intensity!;
    if (num(look.glow)) LAVA_LOOK.glow.value = look.glow!;
    const thresholds = num(look.glowFrom) || num(look.glowTo);
    if (num(look.glowFrom)) LAVA_LOOK.glowFrom.value = look.glowFrom!;
    if (num(look.glowTo)) LAVA_LOOK.glowTo.value = look.glowTo!;
    // Rows of the matrix: 'xzy' feeds the world's z to the noise's y and y to its z.
    if (look.axes === 'xyz') LAVA_LOOK.axes.value.identity();
    else if (look.axes === 'xzy') LAVA_LOOK.axes.value.set(1, 0, 0, 0, 0, 1, 0, 1, 0);
    if (thresholds) for (const m of this.lavaMaterials) refreshLavaFar(m);
  }

  /** Find a comfortable spot near the origin: dry, gentle slope. */
  spawnPoint(): THREE.Vector3 {
    // A space zone has no ground to stand on: its arrival point is the zone's origin, in a ship.
    if (this.planet.space) return new THREE.Vector3(0, 0, 0);
    const n = new THREE.Vector3();
    let best = new THREE.Vector3(0, this.terrain.heightAt(0, 0), 0);
    let bestScore = -Infinity;
    for (let r = 0; r < 200; r += 8) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        const h = this.terrain.heightAt(x, z);
        if (h < this.terrain.waterLevel + 1.5) continue;
        const ny = this.terrain.normalAt(x, z, n).y;
        const score = ny * 10 - r * 0.02;
        if (score > bestScore) {
          bestScore = score;
          best = new THREE.Vector3(x, h, z);
        }
        if (ny > 0.97) return best;
      }
    }
    return best;
  }

  /**
   * Cascaded shadow maps: three cascades that follow the camera out to SHADOW_DISTANCE instead
   * of one 280 m box around the player. Every lit material must be set up for it, so materials
   * are scanned as objects appear.
   */
  attachCamera(camera: THREE.PerspectiveCamera, shadows: boolean, portals: PortalRenderer): void {
    this.portals = portals;
    this.camera = camera;
    // The sun, sky light and their shadows stay on the world layer: rooms are lit by their own
    // lights, as in the client, and never by sunlight through the walls.
    if (!shadows || this.csm) return;
    this.csm = new CSM({ camera, parent: this.scene, cascades: 3, maxFar: this.shadowDistance, mode: 'practical', shadowMapSize: this.shadowMapSize, lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 2, lightMargin: LIGHT_MARGIN, lightNear: LIGHT_NEAR, lightFar: LIGHT_MARGIN + this.shadowDistance });
    this.csm.fade = true;
    this.applyShadowQuality();
    this.sun.castShadow = false;
    this.sun.visible = false;
    this.setupShadowMaterials();
  }

  /**
   * Retune the shadows and report what they cost. `distance` rebuilds the cascades at a new
   * reach (shorter is cheaper *and* sharper); `minRadius` re-gates which placed objects cast.
   */
  setShadows(distance?: number, minRadius?: number): { distance: number; minRadius: number; casters: number; notCasting: number } {
    // Retune in place. CSM.dispose() deletes every patched material's onBeforeCompile, which
    // would take the ground's texture blending with it, and it leaves its lights in the scene;
    // updateFrustums() re-splits the cascades and refreshes their uniforms without either.
    if (distance !== undefined && distance !== this.shadowDistance) {
      this.shadowDistance = distance;
      if (this.csm) {
        this.csm.maxFar = distance;
        this.csm.lightFar = LIGHT_MARGIN + distance;
        this.csm.updateFrustums();
        // The cascade boxes just changed size, so the texel-relative biases have to follow.
        this.applyShadowQuality();
      }
    }
    if (minRadius !== undefined) {
      this.shadowMinRadius = minRadius;
      this.scene.traverse((o) => {
        const m = o as THREE.InstancedMesh;
        if (!m.isInstancedMesh) return;
        if (!m.boundingSphere) m.computeBoundingSphere();
        const g = m.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        m.castShadow = (g.boundingSphere?.radius ?? 0) >= minRadius;
      });
    }
    let casters = 0;
    let notCasting = 0;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) return;
      if (m.castShadow) casters++;
      else notCasting++;
    });
    return { distance: this.shadowDistance, minRadius: this.shadowMinRadius, casters, notCasting };
  }

  /**
   * The cascades are fitted to the camera's frustum, so a new aspect ratio resizes every
   * cascade box -- and with it the texel size the biases are derived from.
   */
  onCameraResized(): void {
    if (!this.csm) return;
    this.csm.updateFrustums();
    this.applyShadowQuality();
  }

  /** Push the current bias, blur and darkness onto every cascade. */
  private applyShadowQuality(): void {
    const size = this.shadowMapSize;
    for (const l of this.csm?.lights ?? []) {
      const cam = l.shadow.camera;
      cam.near = LIGHT_NEAR;
      cam.far = LIGHT_MARGIN + this.shadowDistance;
      cam.updateProjectionMatrix();
      // One texel of this cascade, in metres: its map covers the whole cascade box.
      const texel = (cam.right - cam.left) / size;
      l.shadow.normalBias = SHADOW_NORMAL_BIAS_TEXELS * texel;
      // Back to normalised depth, which is the unit three stores this one in.
      l.shadow.bias = -(SHADOW_BIAS_TEXELS * texel) / (cam.far - cam.near);
      l.shadow.radius = this.shadowRadius;
      // A retune keeps the weather's fade.
      l.shadow.intensity = this.shadowIntensity * this.weatherShadowScale;
      if (l.shadow.mapSize.width !== size) {
        l.shadow.mapSize.set(size, size);
        // The render target is sized on creation, so drop it and let three make a new one.
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    }
  }

  /**
   * Shadow look, live. `radius` is the blur in shadow-map texels (1 crisp, 3 soft) and
   * `intensity` how dark a shadow goes (1 full). Reports the cascade split distances, which
   * are what actually decide how crisp a near shadow can be.
   */
  setShadowLook(radius?: number, intensity?: number, mapSize?: number): { radius: number; intensity: number; mapSize: number; cascades: { range: string; boxMetres: string; metresPerTexel: string; normalBiasCm: string; depthBiasCm: string }[] } {
    if (radius !== undefined) this.shadowRadius = radius;
    if (intensity !== undefined) this.shadowIntensity = intensity;
    if (mapSize !== undefined) this.shadowMapSize = mapSize;
    this.applyShadowQuality();
    const csm = this.csm;
    const size = this.shadowMapSize;
    const cascades: { range: string; boxMetres: string; metresPerTexel: string; normalBiasCm: string; depthBiasCm: string }[] = [];
    if (csm) {
      const near = this.camera?.near ?? 0.1;
      let from = near;
      csm.breaks.forEach((b, i) => {
        const to = near + (this.shadowDistance - near) * b;
        const l = csm.lights[i];
        const cam = l?.shadow.camera;
        // The map covers the cascade's bounding box, which is wider than the slice it is fitted
        // to -- that box over the map's edge is the real texel size, and what decides aliasing.
        const box = cam ? cam.right - cam.left : 0;
        cascades.push({
          range: `${from.toFixed(0)}-${to.toFixed(0)}m`,
          boxMetres: box.toFixed(0),
          metresPerTexel: (box / size).toFixed(4),
          normalBiasCm: ((l?.shadow.normalBias ?? 0) * 100).toFixed(1),
          depthBiasCm: cam ? (Math.abs(l.shadow.bias) * (cam.far - cam.near) * 100).toFixed(1) : '0',
        });
        from = to;
      });
    }
    return { radius: this.shadowRadius, intensity: this.shadowIntensity, mapSize: size, cascades };
  }

  get buildings(): Iterable<Building> {
    return this.layoutStream?.buildings ?? [];
  }

  /** Materials whose shaders have been asked for ahead of their first draw. */
  private readonly compiledMaterials = new WeakSet<THREE.Material>();

  /**
   * New materials join the shadow cascades and the portal stencil scheme, and then have their
   * shaders compiled in the background: a building that streams in would otherwise compile on
   * the first frame it is looked at, a stall of a good fraction of a second.
   */
  private setupShadowMaterials(): void {
    const fresh = this.adoptMaterials(this.scene);
    if (fresh.length) this.compileObjects(fresh);
  }

  /**
   * Everything a material must join before it is drawn: the portal stencil scheme, the normal-map
   * convention and the shadow cascades. Called over the whole scene by the quarter-second scan
   * and over one root by `prepareActor`, so an actor made at run time is ready at once rather
   * than at the next scan. Returns the objects whose materials were new, for the compile queue.
   *
   * The order is fixed and the cascades must come before any compile: `CSM.setupMaterial` sets
   * `defines.USE_CSM` and an `onBeforeCompile`, both part of the program key, so compiling first
   * builds a program that is never drawn. A material flagged `userData.unlit` is kept out of the
   * cascades altogether, for the same reason in reverse.
   */
  private adoptMaterials(root: THREE.Object3D): THREE.Object3D[] {
    const csm = this.csm;
    const fresh: THREE.Object3D[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!(mesh.isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      let isNew = false;
      for (const m of mats) {
        this.portals?.registerMaterial(m, m.userData.interior === true);
        if (!this.compiledMaterials.has(m)) {
          this.compiledMaterials.add(m);
          isNew = true;
          const std = m as THREE.MeshStandardMaterial;
          if (std.normalMap && std.normalScale) std.normalScale.copy(this.normalScale);
          // The only place an animated surface is joined: this material is in the scene now.
          if (m.userData.swgTrack || m.userData.swgScroll) surfaces.adopt(m);
        }
        if (csm && !this.csmMaterials.has(m) && !(m as THREE.ShaderMaterial).isShaderMaterial && m.userData.unlit !== true) {
          csm.setupMaterial(m);
          this.csmMaterials.add(m);
        }
        // The wet-surface wrap, in this same iteration and after the cascades' own hook
        // (CSM.setupMaterial overwrites onBeforeCompile, so nothing may come before it), and so
        // before the program is ever asked for: rain then moves uniforms and compiles nothing.
        // Every material reaches this point; none is wrapped before `csm` exists.
        if (csm && WET_WRAP) wetWrap(m, o);
      }
      if (isNew) fresh.push(o);
    });
    return fresh;
  }

  /**
   * Make an actor ready to be shown without a stall: its materials join the portal stencil and
   * the shadow cascades now rather than at the next quarter-second scan, its textures are
   * uploaded a few a frame, and its programs are compiled for every pass that draws it.
   *
   * Every mesh under `root` is left casting and receiving, and never frustum-culled on its own:
   * a converted actor's meshes sit wherever their GLB put them under the model root, so three's
   * per-mesh sphere is not what anyone wants; the whole actor is culled as one group instead.
   */
  async prepareActor(root: THREE.Object3D): Promise<void> {
    markActor(root);
    this.adoptMaterials(root);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });
    await this.uploadTextures([root]);
    await this.compileReady([root]);
  }

  /**
   * Upload every texture the drawables under some roots use, a few per breath: an upload is cheap
   * next to a program compile, so a body with a dozen textures is ready in a few short steps, and
   * a hidden tab (a scripted check) is not held to one chained timer a minute (`breath`).
   */
  private async uploadTextures(roots: THREE.Object3D[]): Promise<void> {
    const r = this.renderer;
    if (!r) return;
    const textures = new Set<THREE.Texture>();
    for (const root of roots) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!(mesh.isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) || !mesh.material) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const v of Object.values(m as unknown as Record<string, unknown>)) {
            if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
          }
        }
      });
    }
    let n = 0;
    for (const t of textures) {
      r.initTexture(t);
      if (++n % TEXTURES_PER_YIELD === 0) await this.breath();
    }
  }

  /**
   * Make a vehicle ready to be shown without a stall (the garage calls it through `vehiclePrepare` before the vehicle
   * exists): its materials join the portal stencil scheme and the shadow cascades, its textures are uploaded, and its
   * programs are compiled a drawable at a time (the model with its parts and cockpit frame, the engine glows, the
   * trails). Unlike `prepareActor` it leaves `castShadow`, `receiveShadow` and `frustumCulled` as the garage set them
   * (a vehicle's glass casts no shadow, invisible panes stay hidden, the Star Destroyer's parts are culled), and it does
   * not mark a root flagged `userData.worldPass` (a trail, which sets its own layers).
   */
  async prepareVehicle(roots: THREE.Object3D[]): Promise<void> {
    for (const root of roots) {
      if (!root.userData.worldPass) markActor(root);
      this.adoptMaterials(root);
    }
    await this.uploadTextures(roots);
    await this.compileReady(roots);
  }

  /** How a vehicle is prepared before it is shown: `prepareVehicle`, which the game may widen (the motion blur's own variants). Read at call time. */
  vehiclePrepare: (roots: THREE.Object3D[]) => Promise<void> = (roots) => this.prepareVehicle(roots);

  /**
   * Wait for the next drawn frame. A tab in the background gets no animation frames, and its timers
   * are throttled to one a minute after a while; a message to itself is neither, so loading goes on
   * unlooked-at. Unlike `breath` (a yield between compile steps), this waits for a frame when one can come.
   */
  private nextFrame(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!document.hidden) {
        requestAnimationFrame(() => resolve());
        return;
      }
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    });
  }

  /** A yield between compile steps: a message to itself when the tab is hidden (never throttled), else a zero timer. */
  private breath(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (typeof document === 'undefined' || !document.hidden) {
        setTimeout(resolve, 0);
        return;
      }
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    });
  }

  /**
   * Show a mount's saddle once prepareActor has built it, and say how ready it was: how many of its
   * materials had programs beforehand, and the program count across the first frame drawn with it
   * (two nested animation frames, so at least one whole frame; a hidden tab draws none and logs nothing).
   */
  private revealSaddle(id: string, saddle: THREE.Object3D): void {
    const r = this.renderer;
    let ready = 0;
    let total = 0;
    saddle.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        total++;
        const programs = r && r.properties.has(m) ? (r.properties.get(m) as { programs?: Map<unknown, unknown> }).programs : undefined;
        if ((programs?.size ?? 0) > 0) ready++;
      }
    });
    const before = r?.info.programs?.length ?? 0;
    saddle.visible = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const now = this.renderer?.info.programs?.length ?? 0;
        console.info(`garage: ${id}: the saddle is shown, ${ready}/${total} of its materials built beforehand; programs ${before} -> ${now} over its first frame`);
      }),
    );
  }

  /**
   * A disposed material leaves the portal renderer's set and the cascades' map, both of which
   * are strong: the portal set is walked once per stencil change, about a dozen times a frame,
   * and the cascades' map is a leak that shows as a stutter when the shadow distance moves.
   */
  forgetMaterials(materials: Iterable<THREE.Material>): void {
    for (const m of materials) {
      this.portals?.forget(m);
      this.csm?.shaders.delete(m);
      this.csmMaterials.delete(m);
      this.compiledMaterials.delete(m);
      surfaces.forget(m);
    }
  }

  /** Objects whose shaders are still to be asked for, a few per frame. */
  private readonly compileQueue: THREE.Object3D[] = [];

  /** Queue some objects' shaders for the background: a batch of new buildings must not all land in one frame. */
  private compileObjects(objects: THREE.Object3D[]): void {
    this.compileQueue.push(...objects);
  }

  /** The renderer walks a root; a stand-in root walks just these, so the rest of the scene is not re-examined. */
  private static rootOf(objects: THREE.Object3D[]): THREE.Object3D {
    const root = new THREE.Object3D();
    root.traverse = (cb: (o: THREE.Object3D) => void) => {
      for (const o of objects) cb(o);
    };
    root.traverseVisible = () => {};
    return root;
  }

  /**
   * Compile with the camera seeing one pass's layers, whatever pass it was last on: the lights a
   * pass sees are baked into the program, so the world pass (the sun and its cascades) and an
   * interior pass (a room's lights) each need their own, and an actor drawn in both needs both.
   */
  private withLayers<T>(camera: THREE.Camera, layer: number, fn: () => T): T {
    const mask = camera.layers.mask;
    camera.layers.set(layer);
    camera.layers.enable(ACTOR_LAYER);
    try {
      return fn();
    } finally {
      camera.layers.mask = mask;
    }
  }

  /** Which passes draw an object: the world's, an interior's, or both for an actor. */
  private static passesOf(o: THREE.Object3D): number[] {
    const interior = o.layers.isEnabled(INTERIOR_LAYER);
    // What first person hides of the player is drawn in every pass once it is shown again: warmed for both.
    const actor = o.layers.isEnabled(ACTOR_LAYER) || isShadowOnly(o.layers.mask);
    const world = o.layers.isEnabled(0);
    if (actor) return [0, INTERIOR_LAYER];
    if (interior && !world) return [INTERIOR_LAYER];
    return [0];
  }

  /**
   * The target frames are drawn into (the effects' scene target, or null for the canvas). A
   * program's key carries the tone mapping and the colour space, and both depend on whether a
   * target is bound, so a warm-up with the wrong one builds the variant that is never drawn and
   * every first draw compiles again on the frame it is needed. The game points this at the
   * effects' target.
   */
  compileTarget: () => THREE.WebGLRenderTarget | null = () => null;

  private withTarget<T>(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, fn: () => T): T {
    const prev = r.getRenderTarget();
    if (prev === target) return fn();
    const face = r.getActiveCubeFace();
    const mip = r.getActiveMipmapLevel();
    r.setRenderTarget(target);
    try {
      return fn();
    } finally {
      r.setRenderTarget(prev, face, mip);
    }
  }

  /** Compile some objects for every pass that draws them, for the target they will be drawn into. */
  private compileFor(r: THREE.WebGLRenderer, camera: THREE.Camera, objects: THREE.Object3D[], async: boolean, target: THREE.WebGLRenderTarget | null = this.compileTarget()): Promise<unknown>[] {
    const jobs: Promise<unknown>[] = [];
    const byPass = new Map<number, THREE.Object3D[]>();
    for (const o of objects) for (const p of World.passesOf(o)) (byPass.get(p) ?? byPass.set(p, []).get(p)!).push(o);
    for (const [layer, list] of byPass) {
      const root = World.rootOf(list);
      this.withLayers(camera, layer, () =>
        this.withTarget(r, target, () => {
          // compileAsync builds the programs now and only waits on the driver's linking, so the
          // target can go back as soon as the call returns.
          if (async) jobs.push(r.compileAsync(root, camera, this.scene).catch(() => {}));
          else r.compile(root, camera, this.scene);
        }),
      );
    }
    return jobs;
  }

  /**
   * Compile some objects' shaders for every pass that draws them, one drawable at a time with a
   * breath between, and resolve when they are ready to draw (a fighter dressed at run time, a
   * vehicle with its glows and trails). Making a program is work on the main thread even when its
   * linking is left to the driver: a whole outfit at once was a four-second frame, a mesh at a
   * time a few short ones. Every drawable with a material counts (meshes, sprites, points,
   * lines), as `compileAllAsync` walks them.
   */
  async compileReady(objects: THREE.Object3D[]): Promise<void> {
    const r = this.renderer;
    const camera = this.camera;
    if (!r || !camera) return;
    const meshes: THREE.Object3D[] = [];
    for (const o of objects) {
      o.traverse((m) => {
        if (((m as THREE.Mesh).isMesh || (m as THREE.Sprite).isSprite || (m as THREE.Points).isPoints || (m as THREE.Line).isLine) && (m as THREE.Mesh).material) meshes.push(m);
      });
    }
    for (const m of meshes) {
      // The target is read for every mesh, so a switch part way through compiles the rest for the
      // path the game will actually draw.
      const target = this.compileTarget();
      // A hidden tab compiles at once: compileAsync waits on the linking with a chained timer, which a
      // hidden tab holds to one a second, then one a minute, and a hidden tab draws nothing to stall.
      const hidden = typeof document !== 'undefined' && document.hidden;
      for (const layer of World.passesOf(m)) {
        const root = World.rootOf([m]);
        if (hidden) this.withLayers(camera, layer, () => this.withTarget(r, target, () => r.compile(root, camera, this.scene)));
        else await this.withLayers(camera, layer, () => this.withTarget(r, target, () => r.compileAsync(root, camera, this.scene).catch(() => {})));
      }
      await this.breath();
    }
  }

  /** A few queued objects a frame, asked for in the background; called once per frame. */
  private drainCompiles(): void {
    if (!this.compileQueue.length) return;
    const r = this.renderer;
    const camera = this.camera;
    if (!r || !camera) {
      this.compileQueue.length = 0;
      return;
    }
    const batch = this.compileQueue.splice(0, 2);
    const before = r.info.programs?.length ?? 0;
    const t0 = performance.now();
    this.compileFor(r, camera, batch, true);
    const made = (r.info.programs?.length ?? 0) - before;
    const ms = performance.now() - t0;
    if (made && ms > 30) console.info(`shaders: ${made} started in the background (${ms.toFixed(0)} ms), ${this.compileQueue.length} objects still queued`);
  }

  /**
   * Compile every material in the scene, seen or not, in batches with a frame between them so
   * a loading screen can show the count going up; the stall is spent behind the screen rather
   * than on the first shot or the first look at a building. Returns how many programs were made.
   */
  async compileAllAsync(
    onProgress: (done: number, total: number) => void = () => {},
    opts: { target?: THREE.WebGLRenderTarget | null; waitReady?: boolean; keepQueue?: boolean } = {},
  ): Promise<number> {
    const r = this.renderer;
    const camera = this.camera;
    if (!r || !camera) return 0;
    this.setupShadowMaterials();
    // Switching the effects compiles for the other path while the frames still draw the old one,
    // so the queue it would otherwise be feeding is left alone.
    const target = opts.target !== undefined ? opts.target : this.compileTarget();
    if (!opts.keepQueue) this.compileQueue.length = 0;
    const objects: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m.isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) && m.material) objects.push(o);
    });
    const before = r.info.programs?.length ?? 0;
    const BATCH = 8;
    for (let i = 0; i < objects.length; i += BATCH) {
      const jobs = this.compileFor(r, camera, objects.slice(i, i + BATCH), !!opts.waitReady, target);
      // Waiting means the programs are linked when this returns, so the picture can change over.
      if (opts.waitReady) await Promise.all(jobs);
      onProgress(Math.min(objects.length, i + BATCH), objects.length);
      await this.nextFrame();
    }
    // The weather's falling effects draw in their own scene, with no lights and no fog: compiled
    // against that scene (never this one, whose lights and fog are in the program key), for the
    // same target, so the first rain compiles nothing.
    const weatherDone = this.withTarget(r, target, () => this.weather.compile(r, camera, !!opts.waitReady));
    if (opts.waitReady && weatherDone) await weatherDone;
    return (r.info.programs?.length ?? 0) - before;
  }

  /** Call once per frame after the camera has moved. */
  updateShadows(now: number): void {
    const csm = this.csm;
    if (csm) {
      csm.lightDirection.copy(this.day.lightDir).negate().normalize();
      csm.update();
    }
    if (now - this.csmScanAt > 250) {
      this.csmScanAt = now;
      this.setupShadowMaterials();
    }
    this.drainCompiles();
  }

  /** Generate every chunk in view immediately (used when arriving on a planet). */
  warmUp(center: THREE.Vector3): void {
    this.exclusions = [{ x: center.x, z: center.z, r: 14 }];
    this.stream(center, Infinity);
    this.streamFar(center, Infinity);
    // The planet's own wildlife: through the catalogue (its own model, clips and brain) when it has
    // landed and has the species, else the old creatures, which is also what a cold first load gets.
    if (!this.ambientFromCatalogue(center)) this.creatures.spawnAround(center);
    markActor(this.creatures.group);
    // Turrets are spawned from the NPC tab (B) now, not stood around the arrival point.
    markActor(this.turrets.group);
    // No bike is stood in space: there is no ground for it, and the player arrives in a ship.
    if (this.planet.space) return;
    const sx = center.x + 5;
    const sz = center.z + 4;
    const speeder = createPlaceholderSpeeder(this.physics, this.scene, sx, this.terrain.heightAt(sx, sz) + 1.2, sz, Math.PI * 0.75);
    markActor(speeder.group);
    this.vehicles.push(speeder);
  }

  /**
   * The planet's species stood as the catalogue's mobiles, `count` of them about the arrival point,
   * with the planet's own health, blow and temper. Never waits: the catalogue is read only if it has
   * already landed (this runs at arrival, in a frame), and the spot is the terrain's own height,
   * which needs no stepped physics. False when anything is missing, leaving it to the old path.
   */
  private ambientFromCatalogue(center: THREE.Vector3): boolean {
    const def = this.planet.creatures;
    if (!def.count || this.planet.space || !this.mobiles) return false;
    const cat = MobileCatalogue.loaded(import.meta.env.BASE_URL);
    const entry = cat?.resolve(def.name);
    if (!cat || !entry || !cat.ready(entry).ok) return false;
    const n = this.mobiles.spawnAmbient(entry, def.count, center, ambientOverrides(def));
    if (n) console.info(`creatures: ${def.name} stood from the catalogue (${entry.id}), ${n} about`);
    return n > 0;
  }

  /** Stand a vehicle from the garage on the ground in front of a point, facing away from it. */
  async spawnVehicle(def: VehicleDef, at: THREE.Vector3, heading: number, kind?: VehicleKind, airborne = false, fit: ResolvedFit | null = null): Promise<Vehicle> {
    // The world it was asked for: `unload` moves the generation on (and `load` makes a new Terrain for every
    // planet or zone), so a travel during the model loads, the preparation or the paint is seen before the
    // vehicle is made, and nothing is left in the next world.
    const gen = this.loadGeneration;
    const terrain = this.terrain;
    this.garage ??= await Garage.load(import.meta.env.BASE_URL);
    // In space, or arriving in the air, the vehicle stands exactly where it is asked to.
    const space = !!this.planet.space;
    const place = airborne || space ? (b: VehicleSpec['bounds']) => [at.x, at.y + b.min[1], at.z] as [number, number, number] : (b: VehicleSpec['bounds']) => this.clearGround(b, at, heading, def.source === 'creature');
    let v: Vehicle;
    try {
      v = await this.garage.spawn(def, this.physics, this.scene, at.x, at.y, at.z, heading, kind, place, {
        fit,
        prepare: (r) => this.vehiclePrepare(r),
        forget: (m) => this.forgetMaterials(m),
        alive: () => gen === this.loadGeneration && this.terrain === terrain,
      });
    } catch (err) {
      if (err instanceof SpawnCancelled) throw new Error('the world changed while the vehicle was being prepared');
      throw err;
    }
    v.space = space;
    markActor(v.group);
    // A mount's saddle is shown once its programs exist: prepareActor joins it to the portal scheme and
    // the cascades before any compile, uploads its textures and builds its programs a mesh at a time.
    // Nothing else is needed: a static, unskinned, unmorphed mesh's motion-blur variant is one of the
    // warm ones compiled at startup (velocityMath.ts WARM_VARIANTS), so npcDeps.compile is not called.
    if (v.saddle) {
      const saddle = v.saddle;
      const id = v.spec.id;
      saddle.visible = false;
      void this.prepareActor(saddle).catch((err) => console.warn(`garage: ${id}: its saddle's warm-up failed; shown anyway`, err)).finally(() => this.revealSaddle(id, saddle));
    }
    this.vehicles.push(v);
    // A player's ship fights too: its combat from its fit (neutral until someone flies it; sync marks the player's).
    if (v.spec.ship) this.ships.adopt(v, { faction: 'neutral' });
    // The ship's bolt and hit effects, every one its guns fire, played once far below the world.
    this.warmShipFx(v);
    const gravity = -this.physics.world.gravity.y;
    if (def.interior) {
      try {
        v.interior = await ShipInterior.load(v, `${import.meta.env.BASE_URL}${def.interior.file}`, def.interior.def, gravity);
      } catch (err) {
        console.warn(`${def.id}: its interior did not load`, err);
      }
    }
    // A hull that is itself a portal building (the yacht) has its rooms inside the hull model.
    if (!v.interior) v.interior = ShipInterior.fromHull(v, gravity, { cells: def.cells, portals: def.portals });
    return v;
  }

  /**
   * An NPC ship's hull: built through the garage with its fit and prepared as a player's ship is (`vehiclePrepare`,
   * the motion blur's variants included), stood exactly at `at` facing `heading`, then at once, with nothing awaited
   * in between (so no frame sees it), marked, hidden, held, weightless and ghosted (`setGhost`: its colliders in no
   * group until the manager shows it). It is NOT put in `vehicles`: the NPC ship manager puts
   * it there once its contact, combat and brain exist. A world left while it was being prepared throws
   * (SpawnCancelled) before the vehicle is made, so nothing is left in the next world.
   */
  async spawnHull(def: VehicleDef, fit: ResolvedFit | null, at: THREE.Vector3, heading: number): Promise<Vehicle> {
    const gen = this.loadGeneration;
    const terrain = this.terrain;
    const g = (this.garage ??= await Garage.load(import.meta.env.BASE_URL));
    if (gen !== this.loadGeneration || this.terrain !== terrain) throw new SpawnCancelled(def.id);
    const v = await g.spawn(def, this.physics, this.scene, at.x, at.y, at.z, heading, 'ship', (b) => [at.x, at.y + b.min[1], at.z], {
      fit,
      prepare: (roots) => this.vehiclePrepare(roots),
      forget: (m) => this.forgetMaterials(m),
      alive: () => gen === this.loadGeneration && this.terrain === terrain,
    });
    v.space = !!this.planet.space;
    markActor(v.group);
    v.group.visible = false;
    for (const t of v.trails) t.mesh.visible = false;
    v.held = true;
    // Not in the list, nothing steps it: until it is shown its body must neither fall nor be met (its colliders
    // in no group, as a jump's hull), or it drops through the frames its extras take to compile.
    v.body.setGravityScale(0, true);
    v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    v.setGhost(true);
    // Its bolt and hit effects, as a player's ship's: a session with no ship spawned yet has warmed none of them.
    this.warmShipFx(v);
    return v;
  }

  /**
   * What a vehicle makes after it exists (an NPC ship's clear glass stand-ins; its glows and trails were compiled
   * with the hull and cost a key lookup): the materials join the portal stencil and the cascades before any compile,
   * then the programs are built a drawable at a time. No shadow flag is changed (a trail must not cast), unlike
   * `prepareActor`.
   */
  async prepareExtras(objects: THREE.Object3D[]): Promise<void> {
    for (const o of objects) this.adoptMaterials(o);
    await this.compileReady(objects);
  }

  /** The portal renderer's material set and the shadow cascades' shader records, by size: a ship that leaks its materials shows as growth. Read-only. */
  materialCounts(): { portal: number; cascades: number } {
    return { portal: this.portals?.materials.size ?? 0, cascades: this.csm?.shaders.size ?? 0 };
  }

  /** Stand a ready-made model as a vehicle on clear ground ahead of a point (the garage's placement, for a model that is not in it). */
  addVehicle(spec: VehicleSpec, model: THREE.Object3D, at: THREE.Vector3, heading: number): Vehicle {
    const [x, y, z] = this.clearGround(spec.bounds, at, heading);
    const v = new Vehicle(spec, model, this.physics, this.scene, x, y - spec.bounds.min[1] + spec.hover, z, heading);
    markActor(v.group);
    this.vehicles.push(v);
    return v;
  }

  /**
   * Ground ahead of a point that a box of these bounds can stand on: ahead by the box's half
   * length plus a gap, and further on while anything else stands there, since a box spawned
   * inside an exhibit, a house or another vehicle is thrown out of it by the physics.
   */
  private clearGround(b: VehicleSpec['bounds'], at: THREE.Vector3, heading: number, animal = false): [number, number, number] {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const l = b.max[2] - b.min[2];
    // On the water rather than under it: a machine floats on the surface, an animal swims chest-deep.
    const floorAt = (x: number, z: number) => Math.max(this.terrain.heightAt(x, z), this.terrain.waterHeightAt(x, z) - (animal ? h * 0.55 : 0));
    const shape = new R.Cuboid(w / 2 + 0.3, h / 2, l / 2 + 0.3);
    const rot = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
    const first = l / 2 + 3;
    // Not far: past 24 m the spot is out of sight, so the vehicle lands at the first spot anyway.
    for (let d = first; d <= first + 24; d += 2) {
      const x = at.x + Math.sin(heading) * d;
      const z = at.z + Math.cos(heading) * d;
      const y = floorAt(x, z);
      // A vehicle spawned this same frame is not in the physics queries yet, so those are checked by distance.
      let blocked = this.vehicles.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < v.radius + Math.max(w, l) / 2 + 0.5);
      if (!blocked) {
        this.physics.world.intersectionsWithShape({ x, y: y - b.min[1] + h / 2 + 0.5, z }, rot, shape, () => {
          blocked = true;
          return false;
        });
      }
      if (!blocked) return [x, y, z];
    }
    return [at.x + Math.sin(heading) * first, floorAt(at.x, at.z), at.z + Math.cos(heading) * first];
  }

  /**
   * Warm a ship's bolt and hit effects: every distinct projectile its guns fire (a fitted ship's guns may fire
   * several) and its own weapon's, each played once far below the world, so the first shot finds their shaders
   * compiled rather than stalling the frame. An effect already warmed is not played again.
   */
  warmShipFx(v: Vehicle): void {
    if (!this.garage) return;
    const projectiles = new Set<number>();
    for (const g of v.guns) if (g.weapon) projectiles.add(g.weapon.projectile);
    if (v.weapon) projectiles.add(v.weapon.projectile);
    for (const index of projectiles) {
      const p = this.garage.projectileFor(index);
      if (!p) continue;
      for (const file of [p.effect, p.hit]) {
        if (!file || this.warmedFx.has(file)) continue;
        this.warmedFx.add(file);
        const h = this.shipFx.place(file, tmpM.makeTranslation(v.pos.x, -900, v.pos.z), false, true);
        window.setTimeout(() => this.shipFx.remove(h), 4000);
      }
    }
  }

  /**
   * Take a vehicle out of the world: its body, its model, its trails and its paint's own copies (out of the material
   * sets, through the paint's `forget`), and the materials made for it alone (`ownedMaterials`: its glow sprite's,
   * each trail's, each clear pane's) forgotten by the portal renderer and the cascades, then disposed. Every way a
   * vehicle goes comes here. A hull still being prepared (an NPC ship, not yet in the list) is disposed all the same.
   */
  disposeVehicle(v: Vehicle): void {
    // Once: a second removal of its body would be a use after free (a destroyed NPC ship the manager also clears).
    if (!v.disposed) {
      v.dispose(this.physics, this.scene);
      this.forgetMaterials(v.ownedMaterials);
      // A trail's material is disposed twice (with its trail too): harmless.
      for (const m of v.ownedMaterials) m.dispose();
      v.ownedMaterials.length = 0;
    }
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  /** The refit of each vehicle under way, so the next waits for it (inTurn). */
  private readonly refits = new WeakMap<Vehicle, Promise<unknown>>();

  /**
   * Refit a spawned ship in place (Garage.refit, its new parts prepared as a vehicle is), then warm the bolts its
   * guns now fire. One vehicle's refits run one after another, each checked and started from the fit the last
   * one left (`Garage.refit` reads `v.fit` when its turn comes): two staged from the same fit would leave the
   * model showing one part while `v.fit` names another. A fit the ship already wears changes nothing.
   */
  refitVehicle(v: Vehicle, next: ResolvedFit): Promise<RefitReport> {
    return inTurn(this.refits, v, async () => {
      if (!this.garage) throw new Error('garage: not loaded');
      if (!this.vehicles.includes(v)) throw new Error(`garage: ${v.spec.id} is not in the world`);
      if (v.fit && fitKey(v.fit) === fitKey(next)) return { slots: [], parts: 0, waiting: [], repainted: false, weaponsChanged: false, ms: 0 };
      let report: RefitReport;
      try {
        report = await this.garage.refit(v, next, (r) => this.vehiclePrepare(r));
      } finally {
        // The ship went while its parts were staged: the spare trails' materials were put on its list after
        // disposeVehicle had emptied it, and were adopted by the preparation, so they leave the sets here.
        if (v.disposed && v.ownedMaterials.length) {
          this.forgetMaterials(v.ownedMaterials);
          for (const m of v.ownedMaterials) m.dispose();
          v.ownedMaterials.length = 0;
        }
      }
      if (report.weaponsChanged && this.vehicles.includes(v)) this.warmShipFx(v);
      // Its combat's stats from the new fit (the condition keeps its shares).
      if (this.vehicles.includes(v)) this.ships.refit(v);
      return report;
    });
  }

  /**
   * Keep the shadow cascades' records of some materials across a compile in another WebGL context (the ship
   * edit page's preview). CSM keeps one shader record per material, the last compiled in any context, and
   * moves the cascades' uniforms in that one only, so a second renderer compiling a material the world set
   * up would take them from the world's program. Returns the function that puts the records back.
   */
  keepShadowRecords(materials: THREE.Material[]): () => void {
    const csm = this.csm;
    if (!csm) return () => {};
    const kept: [THREE.Material, string][] = [];
    for (const m of materials) if (csm.shaders.has(m)) kept.push([m, csm.shaders.get(m) as string]);
    return () => {
      for (const [m, s] of kept) if (csm.shaders.has(m)) csm.shaders.set(m, s);
    };
  }

  /** Take every spawned vehicle away but the one ridden, and the NPC ships (the NPC tab's clear takes those). */
  removeVehicles(keep: Vehicle | null): number {
    let n = 0;
    for (const v of [...this.vehicles]) {
      if (v === keep || v.autopilot) continue;
      this.disposeVehicle(v);
      n++;
    }
    return n;
  }

  /** Interior-mesh accounting, for the console hook. */
  interiorStats(force = false): { buildings: number; built: number; meshes: number; eagerMeshes: number } | null {
    return this.layoutStream?.interiorStats(force) ?? null;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /**
   * A player put down somewhere without walking there (a teleport): stand them in whatever room
   * holds the point, since no portal was crossed to get in. Returns the cell, or 0 outside.
   */
  enterCellAt(pos: THREE.Vector3): number {
    if (!this.layoutStream) return 0;
    const state = this.layoutStream.buildingAt(pos);
    this.cellState = state;
    this.prevPlayerPos.copy(pos);
    return state?.cell ?? 0;
  }

  /** Elevator terminals near the player, nearest first (empty outside buildings). */
  elevatorsNear(pos: THREE.Vector3, range: number): { kind: 'up' | 'down' | 'both'; d: number }[] {
    return this.cellState && this.layoutStream ? this.layoutStream.elevatorsNear(pos, range) : [];
  }

  /**
   * Ride an elevator the way the original game does: the player is moved straight up or down
   * to the next floor surface on their vertical line, staying in the building. Returns the new
   * position, or null when there is no floor that way.
   */
  useElevator(pos: THREE.Vector3, up: boolean): THREE.Vector3 | null {
    const b = this.cellState?.building;
    if (!b || !this.layoutStream) return null;
    const floors = this.physics.floorsAt(pos.x, pos.z, pos.y + 80, pos.y - 80);
    let i = floors.findIndex((f) => Math.abs(f - pos.y) < 1);
    if (i < 0) i = floors.findIndex((f) => f < pos.y);
    const target = up ? floors[i - 1] : floors[i + 1];
    if (target === undefined) return null;
    const next = new THREE.Vector3(pos.x, target + 0.1, pos.z);
    const cell = this.layoutStream.cellAt(b, next);
    this.cellState = { building: b, cell: cell || this.cellState!.cell };
    this.prevPlayerPos.copy(next);
    return next;
  }

  /**
   * The lift shaft the player stands in: the stops it reaches (its doorways and those of the
   * shafts it opens into, lifts.ts), which one the player is at, and a title; null outside a shaft.
   */
  liftHere(pos: THREE.Vector3): { stops: LiftStop[]; current: number; title: string } | null {
    const b = this.cellState?.building;
    if (!b || !this.cellState || !isLiftCell(b.model.def, this.cellState.cell)) return null;
    const stops = liftStops(b.model.def, this.cellState.cell);
    if (stops.length < 2) return null;
    tmpV.copy(pos).applyMatrix4(b.inverse);
    const name = b.model.def.cells?.find((c) => c.index === this.cellState!.cell)?.name ?? 'lift';
    return { stops, current: stopAt(stops, tmpV.y), title: `${b.model.def.id} · ${name.replace(/_/g, ' ')}` };
  }

  /** Ride the lift the player stands in to one of its stops: the spot through that doorway, in the world, and the room beyond becomes the cell. */
  rideLift(stop: LiftStop): THREE.Vector3 | null {
    const b = this.cellState?.building;
    if (!b) return null;
    const next = stop.at.clone().applyMatrix4(b.matrix);
    this.cellState = { building: b, cell: stop.cell };
    this.prevPlayerPos.copy(next);
    return next;
  }

  /**
   * A building beside the player whose rooms cannot be walked into (a dungeon whose way in was
   * a server object, a station whose doors are up in the air): its name, so E can put the
   * player inside; null when there is none, or the player is already in one.
   */
  doorlessNear(pos: THREE.Vector3): { label: string } | null {
    if (this.cellState || !this.layoutStream) return null;
    const b = this.layoutStream.doorlessNear(pos);
    return b ? { label: b.model.def.id.replace(/_/g, ' ') } : null;
  }

  describeDoorless(pos: THREE.Vector3): ReturnType<LayoutStreamer['describeDoorless']> {
    return this.layoutStream?.describeDoorless(pos) ?? [];
  }

  /** Put the player inside the doorless building beside them: a standing spot in its entry room, and the cell. */
  enterDoorless(pos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.layoutStream) return null;
    const b = this.layoutStream.doorlessNear(pos);
    if (!b) return null;
    const entry = this.layoutStream.entryOf(b);
    if (!entry) return null;
    this.cellState = { building: b, cell: entry.cell };
    this.prevPlayerPos.copy(entry.at);
    return entry.at;
  }

  /** Flora planted so far and the appearances the pack lacked (diagnostics). */
  get floraStatus(): { planted: number; models: number; missing: string[] } | null {
    return this.flora ? { planted: this.flora.planted, models: this.flora.modelCount, missing: [...this.flora.missing] } : null;
  }

  /** The snapshot's centre in SWG coordinates (the game's origin), when a converted pack is loaded. */
  /** Placed objects around a point with their streaming state, for the console. */
  objectsNear(x: number, z: number, r: number): ReturnType<LayoutStreamer['describeNear']> {
    return this.layoutStream?.describeNear(x, z, r) ?? [];
  }

  particlesNear(x: number, z: number, r: number): ReturnType<ParticleEffects['describeNear']> {
    return this.particles?.describeNear(x, z, r) ?? [];
  }

  emittersNear(x: number, z: number, r: number): ReturnType<ParticleEffects['describeEmitters']> {
    return this.particles?.describeEmitters(x, z, r) ?? [];
  }

  get particleStatus(): string {
    return this.particles?.status ?? 'no particle effects';
  }

  get layoutCenter(): { x: number; z: number } | null {
    return this.pack?.layout?.center ?? null;
  }

  /** Everything the pack places on this world, loaded or not, in the game's coordinates (a map's worth, not the scene's). */
  get placedObjects(): readonly PlacedObject[] {
    return this.layoutStream?.objects ?? [];
  }

  /**
   * How far along the world around a point is, 0 to 1: the pack's stages, the ground chunks
   * around the point, and the placed objects within working range, weighted by how long each
   * tends to take. What the loading screen fills its picture by.
   */
  progress(pos: THREE.Vector3): { total: number; stage: string } {
    const pcx = Math.floor(pos.x / CHUNK_SIZE);
    const pcz = Math.floor(pos.z / CHUNK_SIZE);
    const R = Math.min(2, this.viewRadius);
    let need = 0;
    let have = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      need++;
      if (this.chunks.has(`${pcx + dx},${pcz + dz}`)) have++;
    }
    const ground = need && !this.planet.space ? have / need : 1;
    // In space every tier within its own range counts (a zone is a few hundred objects, and a landmark 2 km off must not stream in after the screen lifts).
    const objects = this.layoutStream ? this.layoutStream.progress(pos.x, pos.z, this.planet.space ? Infinity : undefined) : this.packProgress < 1 ? 0 : 1;
    const total = this.packProgress * 0.45 + ground * 0.2 + objects * 0.35;
    const stage = this.packProgress < 0.12 ? 'the planet\'s pack' : this.packProgress < 0.55 ? 'the terrain' : this.packProgress < 0.92 ? 'the flora, the ground and the sky' : ground < 1 ? 'the ground underfoot' : objects < 1 ? 'the buildings and the props' : 'the last of it';
    return { total, stage };
  }

  /** How far placed objects load, live: the streamer re-ranges, and the ground radii re-stream on the next move. */
  /** How far placed objects load: the setting, and in space (no ground, no buildings, only a few hundred rocks and a station) three times as far. */
  private streamReach(): number {
    return this.objectReach * (this.planet?.space ? SPACE_REACH : 1);
  }

  setReach(objects: number, terrain: number, far: number): void {
    this.objectReach = objects;
    if (this.layoutStream && this.planet?.id !== 'gallery') this.layoutStream.setReach(this.streamReach());
    this.viewRadius = Math.round(terrain);
    this.farRadius = Math.round(far);
    this.lastCx = Number.NaN;
    this.lastTx = Number.NaN;
  }

  /** The normal maps' scale for every material in the scene, now and as they arrive: strength, with the green flipped (the game's maps are Direct3D's). */
  normalScale = new THREE.Vector2(1, -1);

  /** The strength and way up of every normal map in the scene, live, for checking the convention by eye. */
  setNormalScale(x: number, y: number): number {
    this.normalScale.set(x, y);
    let n = 0;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        const std = mat as THREE.MeshStandardMaterial;
        if (std.normalMap && std.normalScale) {
          std.normalScale.set(x, y);
          n++;
        }
      }
    });
    return n;
  }

  /**
   * Turn the sun's shadows on or off, live: every material takes the change on its next draw. Only
   * the renderer's switch flips: the cascade lights keep castShadow, because with no shadow-casting
   * directional light the cascade shader lights every surface with all three cascade lights
   * unshadowed (three suns). With castShadow kept and the map off it takes its one-light branch.
   */
  setShadowsEnabled(on: boolean): void {
    const r = this.renderer;
    if (!r || r.shadowMap.enabled === on) return;
    r.shadowMap.enabled = on;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }

  /**
   * Whether the world around a point is in: the pack loaded, the ground chunks around it made
   * (with the terrain's grids from the worker), and the placed objects within working range
   * loaded. A loading screen holds the player until this says so.
   */
  settled(pos: THREE.Vector3): boolean {
    if (this.packStatus === 'loading') return false;
    const pcx = Math.floor(pos.x / CHUNK_SIZE);
    const pcz = Math.floor(pos.z / CHUNK_SIZE);
    if (!this.planet.space) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(`${pcx + dx},${pcz + dz}`)) return false;
    // In space, every tier within its own range (not 220 m round the point); anywhere, a huge object's collider pieces.
    if (this.layoutStream && !this.layoutStream.settled(pos.x, pos.z, this.planet.space ? Infinity : undefined)) return false;
    if (this.layoutStream && this.layoutStream.collidersPending > 0) {
      // Hidden, no frame runs `update`, which is what builds the pieces: the loading screen's poll builds them instead.
      if (document.hidden) this.layoutStream.buildHuge();
      return false;
    }
    return true;
  }

  /** Move the streamed world to a far-away point at once (teleporting), forgetting any building state. */
  jumpTo(center: THREE.Vector3): void {
    this.stream(center, Infinity);
    this.streamFar(center, Infinity);
    this.layoutStream?.update(center);
    // The weather snaps to the new place: its area at once, and the roof grid from scratch.
    this.weather.reset();
    this.cellState = null;
    this.prevPlayerPos.x = Number.NaN;
    for (const o of this.hiddenGround) o.visible = true;
    this.hiddenGround.length = 0;
    this.groundHiddenFor = null;
  }

  /**
   * Resolve when the world around a point is ready to be seen: every region tier within its load range
   * loaded, the huge objects' collider pieces built, the materials that came with them adopted
   * (cascades before compile), and every queued or fresh object's programs made and linked
   * (compileReady, a mesh at a time). Polls once a drawn frame (a message to itself when the tab is
   * hidden). False after `timeoutMs`. Runs only inside the jump's closed tunnel or under a loading screen,
   * so what it allocates is no frame's cost.
   */
  async readyAround(pos: THREE.Vector3, timeoutMs: number): Promise<boolean> {
    const t0 = performance.now();
    for (;;) {
      const ls = this.layoutStream;
      if (this.packStatus !== 'loading' && (!ls || (ls.loadedAround(pos.x, pos.z) && ls.collidersPending === 0))) {
        // Cascades and the wet wrap first, then the programs: the queue drainCompiles would have fired without waiting, and anything new.
        const fresh = this.adoptMaterials(this.scene);
        const pending = this.compileQueue.splice(0);
        if (!fresh.length && !pending.length) return true;
        await this.compileReady([...pending, ...fresh]);
        continue;
      }
      if (performance.now() - t0 > timeoutMs) return false;
      // Hidden, no frame comes and `update` (which streams) does not run: poll on a timer rather than spin on
      // messages to itself (throttled timers only make this slower, and it runs in the tunnel or under a loading screen).
      if (document.hidden) {
        // Nor are a huge object's collider pieces built by `update` there: build them here.
        ls?.buildHuge();
        await new Promise<void>((r) => setTimeout(r, 50));
      } else await this.nextFrame();
    }
  }

  /**
   * Load another world with one vehicle carried across it untouched (a hyperspace jump to another system): its body stays
   * in the one physics world the session has, its rooms in their own with whoever stands in them, its model, trails and
   * materials in the scene and the material sets, none of which the unload touches. The unload does two things to a
   * vehicle, dispose every one in `vehicles` and drop every ship's fight (`ships.clear`), so the vehicle is taken out of
   * the list first, its fight's shares read, and afterwards it is put back and adopted again with those shares. The
   * caller keeps the player aboard or seated (CLAUDE.md's unload rule is set aside on purpose here: the rooms are carried)
   * and moves the vehicle to where it arrives. Synchronous: no frame sees the world without it. If the load throws, the
   * vehicle is put back first (still ghosted and held, with the player aboard), so the jump's abort can release it.
   */
  loadCarrying(v: Vehicle, planet: PlanetDef, packId: string): void {
    const condition = v.combat ? v.combat.shares() : null;
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    try {
      this.load(planet, packId);
    } finally {
      if (!v.disposed && !this.vehicles.includes(v)) this.vehicles.push(v);
    }
    if (v.disposed) return;
    v.space = !!planet.space;
    if (v.spec.ship) {
      const combat = this.ships.adopt(v, { faction: 'neutral' });
      if (condition) combat.restore(condition);
      this.warmShipFx(v);
    }
  }

  /**
   * After a jump to another system is ready round `pos`, still under the closed tunnel: what a loading screen's settle did
   * for a crossing. The zone's reflections arrive after its first compiles (their cube loads on its own), and a reflective
   * material compiled before them is rebuilt when they land, which with the tunnel open would be on a frame in view; so
   * they are waited for (at most `envMs`), the ship effects made ready, every material in the scene compiled once more
   * (eight objects a frame, the tunnel drawing between), and anything streamed in meanwhile readied. False when that last
   * wait ran out.
   */
  async settleCarried(pos: THREE.Vector3, envMs: number, timeoutMs: number): Promise<boolean> {
    const t0 = performance.now();
    await this.environmentReady(envMs);
    if (this.renderer) await this.ships.prepareEffects(this.renderer);
    // Hidden, the programs are compiled at once rather than waited on: compileAsync polls the linking on a chained
    // timer, which a hidden tab holds to one a minute, and the tunnel would stay shut for half an hour.
    await this.compileAllAsync(() => {}, { waitReady: !document.hidden, keepQueue: true });
    return this.readyAround(pos, Math.max(1000, timeoutMs - (performance.now() - t0)));
  }

  /** Resolve once the sky's reflections are in (or there is no sky to give any), or after `ms`. */
  private async environmentReady(ms: number): Promise<void> {
    const t0 = performance.now();
    while (this.swgSky && !this.envTexture && performance.now() - t0 < ms) {
      // Hidden, no frame runs `update` (which loads them): a timer, not messages to itself.
      if (document.hidden) await new Promise<void>((r) => setTimeout(r, 50));
      else await this.nextFrame();
    }
  }

  get inside(): boolean {
    return this.cellState !== null;
  }

  /** The ground is hidden under the building the player is below the terrain in (a basement or a dungeon). */
  get underground(): boolean {
    return this.groundHiddenFor !== null;
  }

  /**
   * The camera-following half of the weather, after the camera has moved and physics has stepped
   * (main calls it just before updateShadows): where the falling effect plays, the ridden ship's
   * box, the roof grid's rays, and the particles.
   */
  updateWeatherView(dt: number): void {
    if (!this.swgSky || !this.camera) return;
    const v = this.weatherView;
    v.inside = this.inside;
    v.aboard = this.aboard;
    v.underground = this.underground;
    v.fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : null;
    v.hull = this.weatherHull;
    v.ridden = this.weatherRidden;
    this.weather.updateView(dt, this.camera, v);
  }
  /** What the weather's first half is told, kept and refilled. */
  private readonly weatherWorld: WeatherWorldContext = { daylight: 1, groundAt: this.groundAtCached };
  /** What the weather's second half is told, kept and refilled so a frame makes nothing. */
  private readonly weatherView: WeatherViewContext = { inside: false, aboard: false, underground: false, fog: null, groundAt: this.groundAtCached, waterAt: this.waterAtFn, vehicles: this.vehicles, hull: null, ridden: null };

  /**
   * Follow the player through building portals, as the original client does. Inside a cell the
   * character ignores the shell and the ground; the ground is also hidden under the building
   * whenever the player is below it (basements), so no sand fills the lower floors.
   */
  private updateInterior(playerPos: THREE.Vector3): void {
    if (!this.layoutStream) return;
    if (Number.isNaN(this.prevPlayerPos.x)) this.prevPlayerPos.copy(playerPos);
    this.cellState = this.layoutStream.trackCell(this.cellState, this.prevPlayerPos, playerPos);
    this.prevPlayerPos.copy(playerPos);
    this.updateInteriorLights();
    const b = this.cellState?.building ?? null;
    const underground = b !== null && this.terrain.heightAt(playerPos.x, playerPos.z) > playerPos.y + 1.2;
    const want = underground ? b : null;
    if (want === this.groundHiddenFor) return;
    for (const o of this.hiddenGround) o.visible = true;
    this.hiddenGround.length = 0;
    this.groundHiddenFor = want;
    if (want) this.hideGroundUnder(want);
  }

  /**
   * Light the cell the player stands in the way the client does: each cell of a portal building
   * carries its own lights, placed by the building's artists. The current cell's lights and
   * those of the cells its portals open onto are live, up to a cap; the rest wait.
   */
  private updateInteriorLights(): void {
    const state = this.cellState;
    const want = state && state.cell > 0 ? { building: state.building, cell: state.cell } : null;
    const have = this.interiorLightsFor;
    if ((want?.building ?? null) === (have?.building ?? null) && (want?.cell ?? -1) === (have?.cell ?? -1)) return;
    this.interiorLightsFor = want;
    for (const l of this.interiorPoints) l.intensity = 0;
    this.fxLampCells.fill(-1);
    this.interiorParallel.intensity = 0;
    this.interiorAmbient.intensity = 0;
    if (!want) return;
    const cells = want.building.model.def.cells ?? [];
    const current = cells.find((c) => c.index === want.cell);
    if (!current) return;
    const order = [want.cell, ...(current.portals ?? []).map((p) => p.target).filter((t) => t > 0 && t !== want.cell)];
    const matrix = want.building.matrix;
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    // Rooms are never pitch black: a floor under the cell's own ambient light.
    const ambient = new THREE.Color(INTERIOR_AMBIENT_FLOOR, INTERIOR_AMBIENT_FLOOR, INTERIOR_AMBIENT_FLOOR);
    let points = 0;
    let parallel = false;
    for (const index of order) {
      const cell = cells.find((c) => c.index === index);
      for (const l of cell?.lights ?? []) {
        const color = new THREE.Color(l.color[0], l.color[1], l.color[2]);
        if (l.type === 0) {
          ambient.add(color);
          continue;
        }
        pos.set(l.position[0], l.position[1], l.position[2]).applyMatrix4(matrix);
        if (l.type === 1) {
          if (parallel) continue;
          parallel = true;
          dir.set(l.direction[0], l.direction[1], l.direction[2]).transformDirection(matrix);
          this.interiorParallel.color.copy(color);
          this.interiorParallel.intensity = 1.2;
          this.interiorParallel.position.copy(pos).addScaledVector(dir, -20);
          this.interiorParallel.target.position.copy(pos);
          continue;
        }
        if (points >= INTERIOR_LIGHT_CAP) continue;
        // Direct3D falloff 1 / (c + l d + q d^2) matched at 3 m to three's I / d^2, cut where it fades below 5%.
        const [c, li, q] = l.attenuation;
        const at3 = 1 / Math.max(0.05, c + 3 * li + 9 * q);
        let range = 40;
        for (let d = 1; d <= 40; d++) {
          if (1 / (c + li * d + q * d * d) < at3 * 0.05) {
            range = d;
            break;
          }
        }
        this.fxLampCells[points] = index;
        const light = this.interiorPoints[points++];
        light.color.copy(color);
        light.intensity = 9 * at3 * INTERIOR_LIGHT_SCALE;
        light.distance = range;
        light.position.copy(pos);
      }
    }
    this.interiorAmbient.color.copy(ambient);
    this.interiorAmbient.intensity = INTERIOR_AMBIENT_SCALE;
  }

  private hideGroundUnder(b: Building): void {
    const r = b.radius + 2;
    const overlaps = (ox: number, oz: number, size: number) => b.x + r > ox && b.x - r < ox + size && b.z + r > oz && b.z - r < oz + size;
    for (const c of this.chunks.values()) {
      if (overlaps(c.cx * CHUNK_SIZE, c.cz * CHUNK_SIZE, CHUNK_SIZE)) {
        c.group.visible = false;
        this.hiddenGround.push(c.group);
      }
    }
    for (const [key, t] of this.farTiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (overlaps(tx * FAR_TILE, tz * FAR_TILE, FAR_TILE)) {
        t.visible = false;
        this.hiddenGround.push(t);
      }
    }
  }

  collidersNear(x: number, z: number, radius: number): Collider[] {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const out: Collider[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(`${cx + dx},${cz + dz}`);
        if (!c) continue;
        for (const col of c.colliders) {
          if (Math.abs(col.x - x) < radius + col.r && Math.abs(col.z - z) < radius + col.r) out.push(col);
        }
      }
    }
    return out;
  }

  /** The mobile, creature, fighter, turret or vehicle a physics collider belongs to (every collider of a long body is its own). */
  hittableAt(handle: number): Hittable | undefined {
    return this.mobiles?.byCollider.get(handle) ?? this.creatures.byCollider.get(handle) ?? this.npcs.byCollider.get(handle) ?? this.turrets.byCollider.get(handle) ?? this.vehicles.find((v) => v.colliderHandles.includes(handle));
  }

  /** `target` is whom the turrets shoot at, or null while nothing should be shot (noclip, riding). */
  update(dt: number, playerPos: THREE.Vector3, camPos: THREE.Vector3, fastTime: boolean, onAttack: (damage: number) => void, target: TurretTarget | null = null): void {
    this.stream(playerPos, STREAM_BUDGET);
    this.streamFar(playerPos, 1);
    if (this.layoutStream) {
      // The building the player is in keeps its interior however far its wings reach.
      this.layoutStream.update(playerPos, this.cellState?.building ?? null);
      this.packStatus = `${this.packBase}; ${this.layoutStream.status}${this.particles ? `; ${this.particles.status}` : ''}`;
    }
    if (this.particles && this.camera) this.particles.update(dt, this.camera, this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : null);
    if (this.camera) {
      const fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : null;
      this.shipFx.update(dt, this.camera, fog);
      this.weaponFx.update(dt, this.camera, fog);
    }
    this.updateInterior(playerPos);
    this.day.update(dt, fastTime);
    if (this.swgSky) {
      // What the sky needs from the weather (the area, the level, the blend, the wind) comes first.
      this.weatherWorld.daylight = this.day.daylight;
      this.weather.update(dt, playerPos, this.weatherWorld);
      this.applySwgLighting(this.swgSky.update(this.day, camPos, dt), playerPos);
      this.refreshEnvironment(dt);
    } else this.applyLighting();
    this.waterBodies.envLight = this.waterEnvLight();
    this.sky.position.copy(camPos);
    this.spaceBodies?.position.copy(camPos);
    this.waterTime += dt;
    for (const m of this.waterMaterials) m.userData.uniforms.uTime.value = this.waterTime;
    // Modulo the shader's own loop, whose flow × loopTime is whole: the noise wraps without a seam.
    for (const m of this.lavaMaterials) m.uniforms.uFlowTime.value = this.waterTime % m.userData.loopTime;
    this.emitRipples(dt, playerPos);
    this.emitDust(dt);
    if (this.waterMaterials.length) updateWaterDepth(playerPos.x, playerPos.z, (x, z) => this.terrain.heightIfCached(x, z, FAR_TILE, FAR_RES));
    if (this.water) {
      const cell = WATER_NEAR / WATER_SEGMENTS;
      this.water.position.x = Math.round(playerPos.x / cell) * cell;
      this.water.position.z = Math.round(playerPos.z / cell) * cell;
    }
    if (this.waterFar) {
      this.waterFar.position.x = playerPos.x;
      this.waterFar.position.z = playerPos.z;
    }
    this.sun.target.position.copy(playerPos);
    this.sun.position.copy(playerPos).addScaledVector(this.day.lightDir, 220);
    // The loop has already said where the player stands and what a blow does; `onAttack` is kept
    // as the fallback for a caller that has not (a test, an old call site), and the flag is asked
    // every frame rather than once: a fallback that looked at `hurt` alone would fill the target
    // in on the first frame and then leave the player standing wherever they were on it.
    if (!this.playerTargetSet) this.setPlayerTarget(playerPos, true, onAttack);
    this.playerTargetSet = false;
    this.stepLiving(dt, playerPos, this.camera);
    if (target) this.turrets.update(dt, target, this.bolts);
    this.gallery?.update(dt, playerPos);
  }

  /**
   * Everything alive, stepped once over one shared list of targets: the creatures, the fighters,
   * and whatever else comes to live on it. The loop and `__debug.advance` both call this, and it
   * is the only place the simulated clock moves -- not `performance.now()`, because `advance`
   * runs ten simulated seconds in a fraction of one real one and every timer keys off `now`.
   */
  stepLiving(dt: number, playerPos: THREE.Vector3, camera: THREE.Camera | null): void {
    this.simTime += dt;
    surfaces.update(this.simTime, this.renderer);
    const targets = this.targets(true);
    this.creatures.update(dt, playerPos, this.hurtPlayer);
    this.mobiles?.update(dt, { now: this.simTime, dt, camera, playerPos, targets });
    this.npcs.update(dt, targets, this.bolts, camera, this.simTime);
    // The ships that fight: the contacts in step with the vehicles (the player's ship marked), the NPC ships'
    // brains (held, thinking nothing, while play is paused), then every combat's shields, boost and damage bands.
    this.ships.sync(this.vehicles, this.playerShip, this.playerTarget, this.simTime);
    this.npcShips?.update(dt, this.simTime, this.simulating);
    this.ships.update(dt, this.simTime, this.simulating);
  }

  /** The spawner's cap and the mobiles' animation range (the settings), kept for the managers later planets make. */
  setMobileDetail(cap: number, animRange: number): void {
    this.mobileDetail.cap = cap;
    this.mobileDetail.animRange = animRange;
    if (this.mobiles) {
      this.mobiles.cap = cap;
      this.mobiles.animRange = animRange;
    }
  }

  /** Start the creature and NPC catalogue's one fetch (at boot, beside the species index); it resolves to the catalogue, or null. */
  loadMobileCatalogue(): Promise<MobileCatalogue | null> {
    return MobileCatalogue.load(import.meta.env.BASE_URL);
  }

  /** The catalogue if it has landed, else null: nothing in a frame may wait on it. */
  get mobileCatalogue(): MobileCatalogue | null {
    return MobileCatalogue.loaded(import.meta.env.BASE_URL);
  }

  /** One kept callback rather than a fresh closure a frame; what it does is set by the loop. */
  private readonly hurtPlayer = (damage: number): void => {
    this.playerTarget.hurt(damage);
  };

  /**
   * Everything alive right now: the player when it may be attacked, the creatures, the mobiles, the fighters.
   * One kept array, rebuilt only when a manager has gained or lost a body (or when `stepLiving`
   * asks for a fresh one), so a disposed body can never be handed out.
   */
  targets(fresh = false): readonly Living[] {
    const at = this.livingAt;
    const cv = this.creatures?.version ?? -1;
    const nv = this.npcs?.version ?? -1;
    const mv = this.mobiles?.version ?? -1;
    const alive = !this.playerTarget.dead;
    if (!fresh && cv === at.creatures && nv === at.npcs && mv === this.mobilesAt && alive === at.player) return this.livingList;
    at.creatures = cv;
    at.npcs = nv;
    this.mobilesAt = mv;
    at.player = alive;
    this.livingList.length = 0;
    if (!this.playerTarget.dead) this.livingList.push(this.playerTarget);
    if (this.creatures) for (const c of this.creatures.creatures) this.livingList.push(c);
    // A mobile whose model is still loading neither thinks nor is fought over (the manager bumps its version when one is up).
    if (this.mobiles) for (const m of this.mobiles.live) if (m.ready) this.livingList.push(m);
    if (this.npcs) for (const n of this.npcs.npcs) this.livingList.push(n);
    return this.livingList;
  }

  /** Where the player stands, whether it may be attacked at all, and what a blow does to it. */
  setPlayerTarget(pos: THREE.Vector3, targetable: boolean, hurt: (damage: number) => void): void {
    this.playerTarget.pos.copy(pos);
    this.playerTarget.dead = !targetable;
    this.playerTarget.hurt = hurt;
    this.playerTargetSet = true;
  }

  /**
   * The ground under a point: through the physics when the body is inside a building (the floor,
   * not the terrain under the building), and the terrain's own height outside. Null when nothing
   * is under an indoor point.
   */
  groundAt(x: number, y: number, z: number, inside: boolean): number | null {
    if (!inside) return this.terrain.heightAt(x, z);
    const filter = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));
    // What stands still only: a ray from inside a body (the player's capsule, a fighter's, a
    // creature's) would otherwise find that body and call its middle the floor.
    return this.physics.topSurface(x, z, y + 0.2, 40, filter, World.staticOnly);
  }

  /** A collider that is part of the world rather than of something that moves. */
  private static readonly staticOnly = (c: R.Collider): boolean => {
    const body = c.parent();
    return !body || body.isFixed();
  };

  /**
   * A clear spot `distance` metres ahead of a point, or null. The ray starts three metres up and
   * reaches thirty down, keeping only fixed or bodiless colliders, with the interior filter when
   * inside; outside it falls back to the terrain's own height, which is arithmetic and needs no
   * stepped physics (rapier's scene queries see nothing until the world has stepped once, and
   * the arrival spawn runs before the loop's first step).
   */
  spawnSpot(from: THREE.Vector3, forward: THREE.Vector3, distance: number, inside: boolean): THREE.Vector3 | null {
    const x = from.x + forward.x * distance;
    const z = from.z + forward.z * distance;
    const top = from.y + 3;
    const filter = groups(Group.all, inside ? Group.all & ~(Group.terrain | Group.exterior) : Group.all);
    const ray = new R.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.world.castRay(ray, 30, true, undefined, filter, undefined, undefined, (c) => {
      const body = c.parent();
      return !body || body.isFixed();
    });
    if (hit) return new THREE.Vector3(x, top - hit.timeOfImpact, z);
    if (inside) return null;
    return new THREE.Vector3(x, this.terrain.heightAt(x, z), z);
  }

  /**
   * Irradiance luminance at a point from the world's lights: the sun or moon, the sky half of the
   * hemisphere, the fill, and a building's room set while it is live (its points taken no nearer
   * than `reach` short of the point). The blade glow's ceiling for a lit surface; an estimate that
   * errs high. With the cascaded shadows on the sun is hidden, but its cascades carry its colour and
   * intensity, so reading the sun is right either way.
   */
  litIrradianceNear(p: THREE.Vector3, reach: number): number {
    let e = lumOf(this.sun.color) * this.sun.intensity + lumOf(this.hemi.color) * this.hemi.intensity + lumOf(this.fill.color) * this.fill.intensity;
    if (this.interiorLightsFor) {
      e += lumOf(this.interiorAmbient.color) * this.interiorAmbient.intensity + lumOf(this.interiorParallel.color) * this.interiorParallel.intensity;
      for (const l of this.interiorPoints) if (l.intensity > 0) e += pointIrradiance(lumOf(l.color), l.intensity, l.position.distanceTo(p), reach, l.decay);
    }
    return e;
  }

  /**
   * The sun as the effects want it: which way it lies, its colour, and how much daylight there is
   * (0 at night, and in space). Filled into a record the caller keeps, so a frame allocates nothing.
   */
  sunInfo(out: SunInfo): SunInfo | null {
    if (!this.planet || this.planet.space) return null;
    tmpV.copy(this.sun.position).sub(this.sun.target.position);
    if (tmpV.lengthSq() < 1e-6 || this.day.sunDir.y <= 0.02) return null;
    out.dir.copy(tmpV).normalize();
    out.color.copy(this.sun.color);
    out.intensity = this.day.daylight;
    return out;
  }

  /** What the lens flare follows this frame, one fixed slot per body: the sky's glowing suns (a space zone's brightest stars). Allocates nothing. */
  skyLights(out: readonly import('../core/fx/lensFlare').FxSkyLight[], nightSuns = true): number {
    if (!this.planet) return 0;
    if (this.swgSky) return this.swgSky.flareLights(out, nightSuns);
    if (this.planet.space) return 0;
    // The procedural dome's sun (and Tatooine's second); dark at night, the slots kept.
    return SwgSky.proceduralFlareLights(out, this.day.sunDir, this.sun.color, this.planet.sky.suns);
  }

  /** The converted sky's cloud sheets for the flare's occlusion; none on a procedural sky. */
  cloudLayers(out: readonly import('../core/fx/lensFlare').FxCloudLayer[]): number {
    return this.swgSky ? this.swgSky.cloudLayers(out) : 0;
  }

  /**
   * The camera is under a water surface (lakes included): the sky is not seen through it. The water
   * bodies' own test this frame (beginWaterFrame, with the swell's reach over the sea), or the plain
   * one of the surface plus 0.3 m, so the flare and the reflections agree and neither shows through a lake.
   */
  cameraUnderwater(p: THREE.Vector3): boolean {
    if (!this.planet || this.planet.space || this.inside) return false;
    return this.waterBodies.underwater || p.y < this.terrain.waterHeightAt(p.x, p.z) + 0.3;
  }

  /**
   * The lights the frame was drawn with, as the effects read them: the world pass's (the sky's set)
   * and the interior pass's (the rooms'), each room lamp with the cell it came from. Call it after
   * the scene is drawn, so the shadow matrices are this frame's. The caller adds the flash pool and
   * the torch. Allocates nothing.
   */
  fillFxLights(out: FxLights): void {
    resetFxLights(out);
    const sky = out.sky;
    sky.hemiSky.copy(this.hemi.color).multiplyScalar(this.hemi.intensity);
    sky.hemiGround.copy(this.hemi.groundColor).multiplyScalar(this.hemi.intensity);
    sky.hemiSkyLuminance = luminanceOf(this.hemi.color, this.hemi.intensity);
    sky.hemiGroundLuminance = luminanceOf(this.hemi.groundColor, this.hemi.intensity);
    setDirectional(sky.fill, this.fill);
    const csm = this.csm;
    if (csm && csm.lights.length) {
      // The plain sun is hidden once the cascades exist; they carry its colour and intensity.
      const l = csm.lights[0];
      const on = l.visible && l.intensity > 0;
      sky.sun.direction.copy(csm.lightDirection).negate().normalize();
      sky.sun.color.copy(l.color).multiplyScalar(on ? l.intensity : 0);
      sky.sun.luminance = on ? luminanceOf(l.color, l.intensity) : 0;
      const cam = this.camera;
      if (this.renderer && cam) fillCascades(sky.cascades, this.renderer, csm.lights, csm.breaks, Math.min(cam.far, csm.maxFar) - cam.near, csm.fade);
    } else {
      setDirectional(sky.sun, this.sun);
    }
    const lit = this.interiorLightsFor;
    if (!lit || !(this.interiorAmbient.intensity > 0)) return;
    const rooms = out.rooms;
    rooms.lit = true;
    rooms.building = lit.building;
    rooms.cell = lit.cell;
    rooms.ambient.copy(this.interiorAmbient.color).multiplyScalar(this.interiorAmbient.intensity);
    rooms.ambientLuminance = luminanceOf(this.interiorAmbient.color, this.interiorAmbient.intensity);
    setDirectional(rooms.parallel, this.interiorParallel);
    for (let i = 0; i < this.interiorPoints.length; i++) rooms.pointCount = addPointLight(rooms.points, rooms.pointCount, this.interiorPoints[i], this.fxLampCells[i]);
  }

  /** The cell each pooled room lamp was lit from (-1 unlit), written by updateInteriorLights as it hands the lamps out; read by fillFxLights. */
  private readonly fxLampCells: number[] = new Array(INTERIOR_LIGHT_CAP).fill(-1);

  /**
   * Before the frame is drawn: which water is worth drawing, whether the camera is inside the
   * swell, and whether the effects' reflections take the water's environment term over this frame.
   * The lit water and the reflections pass must agree, so the one decision is taken here.
   */
  beginWaterFrame(camera: THREE.PerspectiveCamera, reflectionsWanted: boolean): void {
    const dry = !this.planet || !!this.planet.space;
    const surface = dry ? -Infinity : this.terrain.waterHeightAt(camera.position.x, camera.position.z);
    const onSea = !dry && !!this.water?.visible && surface === this.terrain.waterLevel;
    const fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog.density : 0;
    this.waterBodies.beginFrame(camera, surface, onSea, fog, reflectionsWanted);
  }

  /**
   * How bright a static per-shader reflection cube may be at this hour: the sky's clear colour
   * against the brightest it ever gets. Only matters while the water reflects its own cubes.
   */
  private waterEnvLight(): number {
    if (this.planet?.space) return 1;
    const sky = this.swgSky;
    if (sky) {
      const c = sky.lighting.clear;
      return envLightFrom(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, sky.clearPeakLuminance());
    }
    return 0.15 + 0.85 * this.day.daylight;
  }

  private applyLighting(): void {
    const d = this.day.daylight;
    const u = this.sky.material.uniforms;
    u.uSun1.value.copy(this.day.sunDir);
    u.uSun2.value.copy(this.day.sunDir).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.12).setY(this.day.sunDir.y * 0.8).normalize();
    u.uMoon.value.copy(this.day.moonDir);
    u.uDay.value = d;
    u.uSunset.value = this.day.sunset;

    const night = this.day.sunDir.y <= 0.02;
    this.sun.color.copy(night ? this.moonColor : this.sunColor);
    if (!night) this.sun.color.lerp(new THREE.Color(0xff9a4a), Math.min(1, this.day.sunset * 0.8));
    this.sun.intensity = night ? 0.4 : this.planet.light.sunIntensity * (0.1 + 0.9 * d);
    if (this.csm) {
      for (const l of this.csm.lights) {
        l.color.copy(this.sun.color);
        l.intensity = this.sun.intensity;
      }
    }
    this.hemi.intensity = this.planet.light.ambientIntensity * (0.2 + 0.8 * d);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.nightFog).lerp(this.dayFog, d);
    fog.color.lerp(new THREE.Color(0xd08a5a), this.day.sunset * 0.35 * d);
  }

  private stream(center: THREE.Vector3, budget: number): void {
    // Space has no ground: none is built, and none fills the lower half of the view from three kilometres down.
    if (this.planet.space) return;
    const pcx = Math.floor(center.x / CHUNK_SIZE);
    const pcz = Math.floor(center.z / CHUNK_SIZE);
    if (pcx === this.lastCx && pcz === this.lastCz && budget !== Infinity) return;

    const wanted: { cx: number; cz: number; d: number }[] = [];
    const R = this.viewRadius;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const key = `${pcx + dx},${pcz + dz}`;
        if (!this.chunks.has(key)) wanted.push({ cx: pcx + dx, cz: pcz + dz, d: dx * dx + dz * dz });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    let made = 0;
    const sync = budget === Infinity;
    for (const w of wanted) {
      if (made >= budget) break;
      // With SWG terrain the pole grids come from a worker; skip until they arrive.
      if (!this.terrain.prepareChunk(w.cx, w.cz, sync)) continue;
      this.createChunk(w.cx, w.cz);
      made++;
    }
    if (wanted.length <= made) {
      this.lastCx = pcx;
      this.lastCz = pcz;
    }
    this.terrain.evict(center, this.viewRadius + 2);
    let changed = made > 0;

    for (const [key, c] of this.chunks) {
      const far = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (far > this.viewRadius + 1) {
        this.disposeChunk(c);
        this.chunks.delete(key);
        changed = true;
      } else if (far <= PHYSICS_RADIUS) {
        this.addChunkPhysics(c);
      } else {
        this.removeChunkPhysics(c);
      }
    }
    if (changed) for (const t of this.farTiles.values()) this.refreshFarTile(t);
  }

  /**
   * Coarse far tiles overlap the detailed chunks and, on cliffs, poke through them. Drop the
   * quads of a far tile that lie under loaded chunks so only one ground ever shows.
   */
  private refreshFarTile(tile: THREE.Mesh): void {
    const u = tile.geometry.userData as { fullIndex?: ArrayLike<number>; n: number; ox: number; oz: number; step: number };
    if (!u.fullIndex) return;
    const { fullIndex, n, ox, oz, step } = u;
    const out: number[] = [];
    for (let j = 0; j < n; j++) {
      const cz = Math.floor((oz + (j + 0.5) * step) / CHUNK_SIZE);
      for (let i = 0; i < n; i++) {
        const cx = Math.floor((ox + (i + 0.5) * step) / CHUNK_SIZE);
        if (this.chunks.has(`${cx},${cz}`)) continue;
        const q = (j * n + i) * 6;
        for (let k = 0; k < 6; k++) out.push(fullIndex[q + k]);
      }
    }
    tile.geometry.setIndex(out);
  }

  private streamFar(center: THREE.Vector3, budget: number): void {
    if (this.planet.space) return;
    const ptx = Math.floor(center.x / FAR_TILE);
    const ptz = Math.floor(center.z / FAR_TILE);
    if (ptx === this.lastTx && ptz === this.lastTz && budget !== Infinity) return;
    const wanted: { tx: number; tz: number; d: number }[] = [];
    const R = this.farRadius;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (!this.farTiles.has(`${ptx + dx},${ptz + dz}`)) wanted.push({ tx: ptx + dx, tz: ptz + dz, d: dx * dx + dz * dz });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    let made = 0;
    for (const w of wanted) {
      if (made >= budget) break;
      const geometry = this.terrain.buildFarTile(w.tx, w.tz, FAR_TILE, FAR_RES, budget === Infinity);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.groundMaterial);
      mesh.receiveShadow = true;
      this.chunkRoot.add(mesh);
      this.farTiles.set(`${w.tx},${w.tz}`, mesh);
      this.refreshFarTile(mesh);
      made++;
    }
    if (wanted.length <= made) {
      this.lastTx = ptx;
      this.lastTz = ptz;
    }
    for (const [key, t] of this.farTiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (Math.max(Math.abs(tx - ptx), Math.abs(tz - ptz)) > this.farRadius + 1) {
        this.chunkRoot.remove(t);
        t.geometry.dispose();
        this.farTiles.delete(key);
        this.terrain.releaseFarTile(tx, tz, FAR_TILE, FAR_RES);
      }
    }
  }

  private createChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const group = new THREE.Group();
    const { geometry, heights } = this.terrain.buildChunk(cx, cz);
    const mesh = new THREE.Mesh(geometry, this.groundMaterial);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
    const exclude = this.layoutStream ? [...this.exclusions, ...this.layoutStream.exclusionsFor(cx, cz)] : this.exclusions;
    // The planet's own flora replaces the procedural props once its models are loaded.
    const { group: propGroup, colliders } = this.flora ? this.flora.buildForChunk(cx, cz, (x, z) => this.terrain.heightAt(x, z), exclude) : this.props.buildForChunk(cx, cz, this.terrain, exclude);
    propGroup.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.computeBoundingSphere();
    });
    group.add(propGroup);
    this.chunkRoot.add(group);
    this.chunks.set(key, { key, cx, cz, group, colliders, heights, physics: null });
    const b = this.groundHiddenFor;
    if (b) {
      const r = b.radius + 2;
      if (b.x + r > cx * CHUNK_SIZE && b.x - r < (cx + 1) * CHUNK_SIZE && b.z + r > cz * CHUNK_SIZE && b.z - r < (cz + 1) * CHUNK_SIZE) {
        group.visible = false;
        this.hiddenGround.push(group);
      }
    }
  }
}

/** Yaw of a w,x,y,z quaternion: the heading of its forward vector, as the client uses for terrain layers. */
function yawOf(q: number[]): number {
  const [w, x, y, z] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}
