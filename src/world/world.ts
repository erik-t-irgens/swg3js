import * as THREE from 'three';
import { packIdOf, type PlanetDef } from '../data/planets';
import type { Physics, RAPIER } from '../core/physics';
import { CreatureManager } from './creatures';
import { DayCycle } from './daycycle';
import { SwgSky, type SkyLighting } from './sky';
import { createWaterMaterial, emitRipple, Splashes, updateWaterDepth, type WaterMaterial } from './water';
import { setEnvironment } from './envmap';
import { PropFactory, type Collider, type Exclusion, type ScatterItem } from './props';
import { FloraPlanter } from './flora';
import { TerrainTextures } from './terrainTextures';
import { AssetPack, type LoadedModel } from './assetPack';
import { OUTPOSTS } from '../data/outposts';
import { Group, groups, RAPIER as R } from '../core/physics';
import { CHUNK_RES, CHUNK_SIZE, Terrain } from './terrain';
import { SwgTerrain, type BuildingLayerSource } from './swgTerrain';
import { LayoutStreamer, type Building, type CellState } from './layoutStream';
import { ParticleEffects } from './particles';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { INTERIOR_LAYER, markActor, type PortalRenderer } from './portalRender';
import { createPlaceholderSpeeder } from '../vehicles/speeder';
import { Dust } from '../vehicles/dust';
import { Garage, type VehicleDef } from '../vehicles/garage';
import { Vehicle, type VehicleKind, type VehicleSpec } from '../vehicles/vehicle';
import { Bolts } from '../combat/bolts';
import { Gallery } from './gallery';
import { TurretManager, type TurretTarget } from '../combat/turrets';
import type { Hittable } from '../combat/kit';

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
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
const INTERIOR_LIGHT_CAP = 10;
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

export class World {
  planet!: PlanetDef;
  terrain!: Terrain;
  creatures!: CreatureManager;
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
  /** Set by main: needed to filter the sky into an environment map for reflective surfaces. */
  renderer: THREE.WebGLRenderer | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTexture: THREE.Texture | null = null;
  private envFromCube: 'day' | 'night' | null = null;
  private envTimer = 99;
  private readonly fill = new THREE.DirectionalLight(0xffffff, 0);
  private waterFar: THREE.Mesh | null = null;
  private waterTime = 0;
  private readonly waterMaterials: WaterMaterial[] = [];
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

  constructor(readonly scene: THREE.Scene, readonly physics: Physics) {
    this.bolts = new Bolts(scene);
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

    if (planet.water) this.createGlobalWater(planet.water.color, planet.water.opacity, planet.water.level);

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
          this.applySwgWater(swg);
          this.packProgress = 0.55;
          console.info(`terrain: ${this.terrain.swg!.template.name} with ${layers.length} building layers loaded in ${(performance.now() - t0).toFixed(0)} ms`);
          await this.loadFlora(pack, swg);
          if (token !== this.loadToken) return null;
          this.packProgress = 0.7;
          await this.loadGroundTextures(pack);
          if (token !== this.loadToken) return null;
          this.packProgress = 0.85;
          await this.loadSky(pack);
          if (token !== this.loadToken) return null;
          this.packProgress = 0.92;
        } catch (err) {
          console.warn('terrain: failed to load the planet terrain, keeping procedural ground', err);
        }
      }
    }

    // A pack with a sky but no terrain (the gallery) still gets its sky.
    if (!layout?.terrain) {
      try {
        await this.loadSky(pack);
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
      this.layoutStream = new LayoutStreamer(this.scene, this.physics, pack, layout, this.particles, { reach: planet.id === 'gallery' ? 4 : this.objectReach });
      if (!this.terrain.swg) {
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
    this.unload();
  }

  private unload(): void {
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
    this.flora = null;
    this.groundTextures?.dispose();
    this.groundTextures = null;
    this.dropSky();
    for (const m of this.localWater) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.localWater.length = 0;
    this.cellState = null;
    this.groundHiddenFor = null;
    this.prevPlayerPos.x = Number.NaN;
    this.hiddenGround.length = 0;
    for (const c of this.structureColliders) this.physics.removeCollider(c);
    this.structureColliders = [];
    this.pack?.dispose();
    this.pack = null;
    this.packStatus = 'no pack';
    if (this.creatures) {
      this.scene.remove(this.creatures.group);
      this.creatures.dispose();
    }
    if (this.turrets) {
      this.scene.remove(this.turrets.group);
      this.turrets.dispose();
    }
    this.bolts.clear();
    this.gallery?.dispose();
    this.gallery = null;
    for (const sp of this.vehicles) sp.dispose(this.physics, this.scene);
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
    for (const m of this.waterMaterials) m.dispose();
    this.waterMaterials.length = 0;
  }

  /**
   * The sea: a finely divided plane around the player that swells, and a flat ring beyond it
   * out to the horizon. Both follow the player, the near plane snapping to its own cell size.
   */
  private createGlobalWater(color: number, opacity: number, level: number): void {
    const near = createWaterMaterial(color, opacity, true);
    const far = createWaterMaterial(color, opacity, false);
    this.waterMaterials.push(near, far);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(WATER_NEAR, WATER_NEAR, WATER_SEGMENTS, WATER_SEGMENTS).rotateX(-Math.PI / 2), near);
    this.water.position.y = level;
    this.water.receiveShadow = true;
    this.water.frustumCulled = false;
    this.scene.add(this.water);
    this.waterFar = new THREE.Mesh(new THREE.RingGeometry(WATER_NEAR * 0.48, 9000, 96, 1).rotateX(-Math.PI / 2), far);
    this.waterFar.position.y = level - 0.05;
    this.waterFar.frustumCulled = false;
    this.scene.add(this.waterFar);
  }

  /** The planet's sky from its pack: replaces the procedural dome and drives the lights, fog and reflections. */
  private async loadSky(pack: AssetPack): Promise<void> {
    const sky = await SwgSky.load(pack);
    if (!sky) return;
    this.dropSky();
    this.swgSky = sky;
    this.scene.add(sky.group, sky.cloudGroup);
    markActor(sky.group);
    markActor(sky.cloudGroup);
    this.sky.visible = false;
    this.day.swg = true;
    this.fogScale = this.planet.swgFogScale ?? DEFAULT_SWG_FOG_SCALE;
    this.envTimer = 99;
    this.envFromCube = null;
    console.info(`sky: ${sky.data.blocks.length} environment blocks, ${sky.hasGradient ? 'gradient sky' : sky.data.skybox ? 'skybox' : 'clear colour'}, ${sky.data.sun ? 'sun' : 'no sun'}, ${sky.data.moon ? 'moon' : 'no moon'}, ${sky.data.stars?.count ?? 0} stars, reflections from ${sky.environment.day ? 'the planet cube maps' : 'the sky'}`);
  }

  private dropSky(): void {
    if (this.swgSky) {
      this.swgSky.dispose(this.scene);
      this.swgSky = null;
    }
    this.sky.visible = true;
    this.day.swg = false;
    this.fill.intensity = 0;
    this.envTexture?.dispose();
    this.envTexture = null;
    this.envFromCube = null;
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
    const cube = this.day.isDay ? sky.environment.day : sky.environment.night;
    if (cube) {
      const want = this.day.isDay ? 'day' : 'night';
      if (this.envFromCube === want) return;
      this.envFromCube = want;
      const pmrem = this.pmrem;
      new THREE.CubeTextureLoader().load(
        cube.faces.map((f) => this.pack!.url(f)),
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          const env = pmrem.fromCubemap(tex).texture;
          tex.dispose();
          this.envTexture?.dispose();
          this.envTexture = env;
          setEnvironment(env, 1);
        },
        undefined,
        () => {
          console.warn('sky: reflection cube map failed to load; reflecting the sky instead');
          this.envFromCube = null;
          sky.environment.day = sky.environment.night = null;
        },
      );
      return;
    }
    this.envTimer += dt;
    if (this.envTimer < 4) return;
    this.envTimer = 0;
    const env = this.pmrem.fromScene(sky.domeScene, 0.04, 1, 20000).texture;
    this.envTexture?.dispose();
    this.envTexture = env;
    setEnvironment(env, 1);
  }

  /**
   * Rings, wakes and splashes from whatever wades or swims: the player, the creatures and the
   * speeders. Each mover's velocity through the water shapes its wake and throws spray when fast.
   */
  private emitRipples(dt: number, playerPos: THREE.Vector3): void {
    this.splashes.update(dt, (x, z) => this.terrain.waterHeightAt(x, z));
    if (!this.waterMaterials.length) return;
    this.rippleClock += dt;
    if (this.rippleClock < RIPPLE_INTERVAL) return;
    const interval = this.rippleClock;
    this.rippleClock = 0;
    const touch = (key: object, p: THREE.Vector3, strength: number) => {
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
    for (const c of this.creatures.creatures) if (c.hp > 0) touch(c, c.pos, 0.9);
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
    if (this.csm) {
      for (const l of this.csm.lights) {
        l.color.copy(this.sun.color);
        l.intensity = this.sun.intensity;
      }
    }
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

  /** Water where the terrain says it is: the global table's height, plus every lake and pool. */
  private applySwgWater(swg: SwgTerrain): void {
    const planet = this.planet;
    if (swg.template.useGlobalWaterTable) {
      if (!this.water) this.createGlobalWater(planet.water?.color ?? 0x2e7fbb, planet.water?.opacity ?? 0.75, swg.template.globalWaterTableHeight);
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
    // Lakes are triangulated outlines with no interior vertices, so they ripple but do not swell.
    const material = createWaterMaterial(planet.water?.color ?? 0x2e7fbb, planet.water?.opacity ?? 0.75, false);
    this.waterMaterials.push(material);
    for (const m of this.localWater) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.localWater.length = 0;
    for (const w of swg.waterTables) {
      const pts = w.points.map((p) => new THREE.Vector2(p.x, p.z));
      const tris = THREE.ShapeUtils.triangulateShape(pts, []);
      if (!tris.length) continue;
      const g = new THREE.BufferGeometry();
      const pos: number[] = [];
      for (const p of pts) pos.push(p.x, w.height, p.y);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(tris.flat());
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, material);
      mesh.receiveShadow = true;
      mesh.name = `water:${w.name}`;
      this.scene.add(mesh);
      this.localWater.push(mesh);
    }
    if (swg.waterTables.length) console.info(`water: ${swg.waterTables.length} local tables${swg.template.useGlobalWaterTable ? `, global at ${swg.template.globalWaterTableHeight.toFixed(1)} m` : ', no global table'}`);
  }

  /** Find a comfortable spot near the origin: dry, gentle slope. */
  spawnPoint(): THREE.Vector3 {
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
      l.shadow.intensity = this.shadowIntensity;
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

  /** New materials join the shadow cascades and the portal stencil scheme. */
  private setupShadowMaterials(): void {
    const csm = this.csm;
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!(mesh.isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints) || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        this.portals?.registerMaterial(m, m.userData.interior === true);
        if (this.csmMaterials.has(m) || (m as THREE.ShaderMaterial).isShaderMaterial || !csm) continue;
        csm.setupMaterial(m);
        this.csmMaterials.add(m);
      }
    });
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
  }

  /** Generate every chunk in view immediately (used when arriving on a planet). */
  warmUp(center: THREE.Vector3): void {
    this.exclusions = [{ x: center.x, z: center.z, r: 14 }];
    this.stream(center, Infinity);
    this.streamFar(center, Infinity);
    this.creatures.spawnAround(center);
    markActor(this.creatures.group);
    // Turrets are spawned from the NPC tab (B) now, not stood around the arrival point.
    markActor(this.turrets.group);
    const sx = center.x + 5;
    const sz = center.z + 4;
    const speeder = createPlaceholderSpeeder(this.physics, this.scene, sx, this.terrain.heightAt(sx, sz) + 1.2, sz, Math.PI * 0.75);
    markActor(speeder.group);
    this.vehicles.push(speeder);
  }

  /** Stand a vehicle from the garage on the ground in front of a point, facing away from it. */
  async spawnVehicle(def: VehicleDef, at: THREE.Vector3, heading: number, kind?: VehicleKind): Promise<Vehicle> {
    this.garage ??= await Garage.load(import.meta.env.BASE_URL);
    const place = (b: VehicleSpec['bounds']) => this.clearGround(b, at, heading, def.source === 'creature');
    const v = await this.garage.spawn(def, this.physics, this.scene, at.x, at.y, at.z, heading, kind, place);
    markActor(v.group);
    this.vehicles.push(v);
    return v;
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

  /** Take every spawned vehicle away but the one ridden. */
  removeVehicles(keep: Vehicle | null): number {
    let n = 0;
    for (const v of [...this.vehicles]) {
      if (v === keep) continue;
      v.dispose(this.physics, this.scene);
      this.vehicles.splice(this.vehicles.indexOf(v), 1);
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
    const ground = need ? have / need : 1;
    const objects = this.layoutStream ? this.layoutStream.progress(pos.x, pos.z) : this.packProgress < 1 ? 0 : 1;
    const total = this.packProgress * 0.45 + ground * 0.2 + objects * 0.35;
    const stage = this.packProgress < 0.12 ? 'the planet\'s pack' : this.packProgress < 0.55 ? 'the terrain' : this.packProgress < 0.92 ? 'the flora, the ground and the sky' : ground < 1 ? 'the ground underfoot' : objects < 1 ? 'the buildings and the props' : 'the last of it';
    return { total, stage };
  }

  /** How far placed objects load, live: the streamer re-ranges, and the ground radii re-stream on the next move. */
  setReach(objects: number, terrain: number, far: number): void {
    this.objectReach = objects;
    if (this.layoutStream && this.planet?.id !== 'gallery') this.layoutStream.setReach(objects);
    this.viewRadius = Math.round(terrain);
    this.farRadius = Math.round(far);
    this.lastCx = Number.NaN;
    this.lastTx = Number.NaN;
  }

  /** Turn the sun's shadows on or off, live: every material takes the change on its next draw. */
  setShadowsEnabled(on: boolean): void {
    const r = this.renderer;
    if (!r || r.shadowMap.enabled === on) return;
    r.shadowMap.enabled = on;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
    if (this.csm) for (const l of this.csm.lights) l.castShadow = on;
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
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(`${pcx + dx},${pcz + dz}`)) return false;
    if (this.layoutStream && !this.layoutStream.settled(pos.x, pos.z)) return false;
    return true;
  }

  /** Move the streamed world to a far-away point at once (teleporting), forgetting any building state. */
  jumpTo(center: THREE.Vector3): void {
    this.stream(center, Infinity);
    this.streamFar(center, Infinity);
    this.layoutStream?.update(center);
    this.cellState = null;
    this.prevPlayerPos.x = Number.NaN;
    for (const o of this.hiddenGround) o.visible = true;
    this.hiddenGround.length = 0;
    this.groundHiddenFor = null;
  }

  get inside(): boolean {
    return this.cellState !== null;
  }

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

  /** The creature or turret a physics collider belongs to. */
  hittableAt(handle: number): Hittable | undefined {
    return this.creatures.byCollider.get(handle) ?? this.turrets.byCollider.get(handle);
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
    this.updateInterior(playerPos);
    this.day.update(dt, fastTime);
    if (this.swgSky) {
      this.applySwgLighting(this.swgSky.update(this.day, camPos, dt), playerPos);
      this.refreshEnvironment(dt);
    } else this.applyLighting();
    this.sky.position.copy(camPos);
    this.waterTime += dt;
    for (const m of this.waterMaterials) m.userData.uniforms.uTime.value = this.waterTime;
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
    this.creatures.update(dt, playerPos, onAttack);
    if (target) this.turrets.update(dt, target, this.bolts);
    this.gallery?.update(dt, playerPos);
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
