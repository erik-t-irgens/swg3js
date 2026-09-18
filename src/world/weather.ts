// The weather: rain, dust storms and snow as the planet's own environment rows name them, in the
// area the player stands in, at the level the shared schedule (weatherSchedule.ts) says is falling.
//
// It runs in two halves a frame. `update`, before the sky's, decides what the sky needs: the area
// (the terrain's environment family under the player), the level, the blend of rows the sky draws,
// the wind, what falls and how wet it is. `updateView`, after the camera has moved and physics has
// stepped, decides what follows the camera: where the falling effect plays, the ship whose box keeps
// rain out of the canopy, the roof grid, and the particles themselves.
//
// The falling effects live in a scene of their own, with no light and no fog, drawn in one render
// after the portal renderer (through the exits only, from inside a building), and compiled against
// that same scene so nothing compiles when rain starts. Nothing here adds a light, toggles a shadow
// or changes a program: shadows fade through their intensity, and the shaders read shared uniforms.
import * as THREE from 'three';
import type { Physics, RAPIER } from '../core/physics';
import type { PlanetDef } from '../data/planets';
import type { Vehicle } from '../vehicles/vehicle';
import type { AssetPack } from './assetPack';
import { KILL_SLACK, ParticleEffects, type EffectHandle, type ParticleKill, type ParticleShader } from './particles';
import { RoofGrid, type RoofSources } from './roofGrid';
import type { SkyBlock, SkyLighting, SwgSky } from './sky';
import type { Terrain } from './terrain';
import {
  JUMP_METRES,
  SNAP_WAIT_SECONDS,
  FAMILY_FADE_SECONDS,
  climateFor,
  createMixOut,
  effectFor,
  lifeDayOn,
  mixBlocks,
  rowFor,
  scheduledLevel,
  seedOf,
  seedWet,
  stepLevel,
  stepWet,
  windAt,
  type EffectChoice,
  type FamilyRows,
  type ForcedKind,
  type ScheduledLevel,
  type WeatherKind,
  type WetState,
  type WindNow,
} from './weatherSchedule';
import { OPEN_ROOF_GRID, OPEN_ROOF_MAP, WEATHER_UNIFORMS } from './wetness';

export interface WeatherSettings {
  weather: boolean;
  weatherDensity: number;
  rainOpacity: number;
  wetSurfaces: boolean;
  weatherShadows: boolean;
  weatherForce: number;
  weatherKind: number;
  lifeDay: number;
}

export interface WeatherForce {
  /** 0..4, clamped to the planet's levels; null keeps the schedule's. */
  level?: number | null;
  /** Swap the falling effect for another kind at the level. */
  kind?: ForcedKind | null;
  /** Hold a family instead of the one under the player. */
  family?: string | null;
  /** Life Day's areas on or off regardless of the date and the setting. */
  lifeDay?: boolean | null;
  /** Jump to the level at once instead of easing. Not kept. */
  snap?: boolean;
}

/** What the effects chain and the console read (a kept object). */
export interface WeatherState {
  enabled: boolean;
  /** Why it is off: 'space', 'gallery', 'no sky', 'no weather data', 'setting off'. */
  reason: string | null;
  family: string;
  familyId: number;
  /** Seasonal areas on now. */
  lifeDay: boolean;
  /** Continuous. */
  level: number;
  /** The whole level the continuous one heads for. */
  target: number;
  levels: number;
  /** What the schedule says now. */
  scheduled: number;
  nextChangeSeconds: number | null;
  forced: WeatherForce | null;
  /** The heaviest effect's kind. */
  kind: WeatherKind | 'clear';
  /** 0..1 falling now, mix-weighted strengths. */
  rain: number;
  snow: number;
  dust: number;
  /** 0..1: max(1 - shadowScale, rain, snow, dust). */
  overcast: number;
  wetness: number;
  puddles: number;
  snowCover: number;
  windHeading: number;
  windSpeed: number;
  /** 0..1 how much the camera effect plays. */
  outside: number;
  underwater: boolean;
  /** The ship whose box kills rain, with ' (first person)' when the CPU kill is on. */
  hull: string | null;
}

export interface WeatherWorldContext {
  daylight: number;
  groundAt: (x: number, z: number) => number | null;
}

export interface WeatherViewContext {
  inside: boolean;
  aboard: boolean;
  underground: boolean;
  fog: THREE.FogExp2 | null;
  groundAt: (x: number, z: number) => number | null;
  waterAt: (x: number, z: number) => number;
  vehicles: readonly Vehicle[];
  /** The ship the player rides (mounted, spec.ship), or null. */
  hull: Vehicle | null;
  /** Whatever the player rides (a speeder, a mount, a ship), or null: never a roof, since it moves under the rain. */
  ridden: Vehicle | null;
}

/** A vehicle slower than this (m/s) and not ridden or flying is a roof for the grid (a parked ship, a landed hull). */
const PARKED_SPEED = 1;

/** The shared uniforms of the weather particles' own shader: the roof map and the hull box. */
const PARTICLE_UNIFORMS = {
  uRoofMap: WEATHER_UNIFORMS.uRoofMap,
  uRoofGrid: WEATHER_UNIFORMS.uRoofGrid,
  uKillSlack: { value: KILL_SLACK },
  uHullOn: { value: 0 },
  uHullToLocal: { value: new THREE.Matrix4() },
  uHullMin: { value: new THREE.Vector3() },
  uHullMax: { value: new THREE.Vector3() },
};

/** The weather's particle shader: the stock one (particles.ts) plus a world position, the roof-grid discard and the hull discard. */
export const WEATHER_PARTICLE_SHADER: ParticleShader = {
  vertex: /* glsl */ `
    attribute vec4 aColor;
    varying vec2 vUv;
    varying vec4 vColor;
    varying float vFog;
    varying vec3 vWeatherPos;
    uniform float uFogDensity;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWeatherPos = wp.xyz;
      vec4 mv = viewMatrix * wp;
      gl_Position = projectionMatrix * mv;
      vUv = uv;
      vColor = aColor;
      float d = length(mv.xyz);
      vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
    }
  `,
  fragment: /* glsl */ `
    uniform sampler2D map;
    uniform vec3 uFogColor;
    uniform float uAdditive;
    uniform highp sampler2D uRoofMap;
    uniform vec4 uRoofGrid;
    uniform float uKillSlack;
    uniform float uHullOn;
    uniform mat4 uHullToLocal;
    uniform vec3 uHullMin;
    uniform vec3 uHullMax;
    varying vec2 vUv;
    varying vec4 vColor;
    varying float vFog;
    varying vec3 vWeatherPos;
    void main() {
      // Below its column's top (a roof, an eave, the ground, a lake's surface): gone. Nearest cell, as RoofGrid.topAt.
      vec2 g = floor((vWeatherPos.xz - uRoofGrid.xy) / uRoofGrid.z);
      if (g.x >= 0.0 && g.y >= 0.0 && g.x < uRoofGrid.w && g.y < uRoofGrid.w
          && vWeatherPos.y < texelFetch(uRoofMap, ivec2(g), 0).r - uKillSlack) discard;
      // Inside the ship being flown: gone.
      if (uHullOn > 0.5) {
        vec3 h = (uHullToLocal * vec4(vWeatherPos, 1.0)).xyz;
        if (all(greaterThan(h, uHullMin)) && all(lessThan(h, uHullMax))) discard;
      }
      vec4 t = texture2D(map, vUv);
      vec4 c = t * vColor;
      c.rgb = mix(mix(c.rgb, uFogColor, vFog), c.rgb * (1.0 - vFog), uAdditive);
      if (c.a <= 0.002) discard;
      gl_FragColor = c;
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
  uniforms: PARTICLE_UNIFORMS,
};

/**
 * The storms' emitters (dust, and the snow storm built the same way) blow sideways: each is turned
 * -0.25 turns about Z and shoots along its own +Y at 1.5 m/s with no spread, which after the game's
 * X mirror is the effect's -X, from 15 m out on +X. Yawed by the wind's heading plus a quarter turn,
 * that -X is the heading (RotY(h + π/2) takes (-1, 0, 0) to (sin h, 0, cos h)), so the sand comes from
 * upwind and blows past downwind. Worked from the converted description; `__debug.weather({ windHeading:
 * 0, emitters: true })` twice shows a particle moving along +Z if it is right.
 */
export const DUST_YAW_OFFSET = Math.PI / 2;
/** Kinds that fall and lean with the wind, and how far at most (radians). */
const RAIN_TILT_MAX = THREE.MathUtils.degToRad(25);
const SNOW_TILT_MAX = THREE.MathUtils.degToRad(35);
/** Seconds a channel may sit unwanted before its effect is removed. */
const CHANNEL_IDLE = 8;
/** Rays the roof grid casts a frame. */
const ROOF_BUDGET = 48;
/** Above this height over the ground the effect fades out, and the grid rests. */
const HIGH_FROM = 300;
const HIGH_TO = 600;
const FORCED_KINDS: (ForcedKind | null)[] = [null, 'rain', 'dust', 'snow'];
const LEVEL_NAMES = ['Clear', 'Light', 'Moderate', 'Heavy', 'Storm'];

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQYaw = new THREE.Quaternion();
const tmpQTilt = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const ONE = new THREE.Vector3(1, 1, 1);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** One falling effect around the camera: its file, what it is, and the share of the mix that wants it. */
interface Channel {
  file: string;
  kind: WeatherKind;
  /** A storm that blows past sideways rather than falling (its emitters are turned about Z). */
  sideways: boolean;
  handle: EffectHandle;
  weight: number;
  idle: number;
  readonly matrix: THREE.Matrix4;
}

export class Weather {
  readonly state: WeatherState = {
    enabled: false,
    reason: 'no sky',
    family: '',
    familyId: 0,
    lifeDay: false,
    level: 0,
    target: 0,
    levels: 1,
    scheduled: 0,
    nextChangeSeconds: null,
    forced: null,
    kind: 'clear',
    rain: 0,
    snow: 0,
    dust: 0,
    overcast: 0,
    wetness: 0,
    puddles: 0,
    snowCover: 0,
    windHeading: 0,
    windSpeed: 0,
    outside: 1,
    underwater: false,
    hull: null,
  };
  /** The falling effects' own scene: never a light, never fog, never in the world's scene. */
  readonly scene = new THREE.Scene();
  readonly roofs: RoofGrid;
  /** The effects chain's view of the state (a kept object). */
  readonly fx = { overcast: 0, rain: 0, snow: 0, dust: 0, wetness: 0 };
  /** Console: false skips the weather pass (to time it). */
  drawPass = true;

  private settings: WeatherSettings = { weather: true, weatherDensity: 1, rainOpacity: 0.55, wetSurfaces: true, weatherShadows: true, weatherForce: -1, weatherKind: 0, lifeDay: -1 };
  private forced: WeatherForce | null = null;
  /** A force asked to jump there at once; used on the next update. */
  private forceSnap = false;
  /** The level is heading back to the schedule after a hold or a force: fast until it gets there. */
  private releasing = false;
  private heldText = '';

  // What the world handed over at attach.
  private sky: SwgSky | null = null;
  private terrain: Terrain | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private packId = '';
  private token = 0;
  private reason: string | null = 'no sky';
  private hasWeatherData = false;
  private fxEffects: ParticleEffects | null = null;
  /** Effect files that did not load: never placed. */
  private readonly failedFiles = new Set<string>();

  // The table: each family's rows, and the schedule.
  private readonly rowsByName = new Map<string, FamilyRows>();
  private firstRows: FamilyRows | null = null;
  private readonly warnedNames = new Set<string>();
  private seed = 0;
  private weights: number[] = [1];
  private levels = 1;
  private readonly sched: ScheduledLevel = { level: 0, step: 0, nextChangeSeconds: null };
  private scheduleTimer = 0;
  private level = 0;
  private target = 0;

  // The area and the blend.
  private current: FamilyRows | null = null;
  private previous: FamilyRows | null = null;
  private fade = 1;
  /** A snap to another family waiting for that family's textures, and how long it has waited. */
  private pendingRows: FamilyRows | null = null;
  private pendingWait = 0;
  private familyTimer = 0;
  private familyName = '';
  private familyId = 0;
  private lifeDayNow = false;
  private month = 0;
  private dayOfMonth = 1;
  private dateTimer = 0;
  private readonly mixOut = createMixOut();
  private readonly mixList: SkyBlock[] = [];
  private mixCount = 0;
  /** Blocks whose textures have been asked for (so a frame never asks twice). */
  private requested = new WeakSet<SkyBlock>();

  // Wind, what falls, how wet.
  private readonly wind: WindNow = { heading: 0, gust: 1 };
  private heldHeading: number | null = null;
  private windHeading = 0;
  private windSpeed = 0;
  private rain = 0;
  private snow = 0;
  private dust = 0;
  private overcast = 0;
  private kind: WeatherKind | 'clear' = 'clear';
  private readonly choice: EffectChoice = { file: '', kind: 'other', strength: 0 };
  private readonly wantFile: string[] = [];
  private readonly wantKind: WeatherKind[] = [];
  private readonly wantWeight = new Float32Array(4);
  private wantCount = 0;
  private readonly wet: WetState = { wetness: 0, puddles: 0, snowCover: 0 };

  // Snaps.
  private snapPending = false;
  private seedWetPending = false;
  private replaceChannels = false;
  private readonly lastPos = new THREE.Vector3(Number.NaN, 0, 0);

  // The schedule's clock: the wall clock, run faster or skipped ahead from the console.
  private timeScale = 1;
  private clockBase = 0;
  private realBase = 0;
  private offsetSeconds = 0;

  // What follows the camera.
  private readonly channels: Channel[] = [];
  private outside = 1;
  private underwater = false;
  private hullLabel: string | null = null;
  private hullFor: Vehicle | null = null;
  private hullFirst = false;
  private readonly killHull = { toLocal: PARTICLE_UNIFORMS.uHullToLocal.value, min: PARTICLE_UNIFORMS.uHullMin.value, max: PARTICLE_UNIFORMS.uHullMax.value };
  private readonly kill: ParticleKill;
  private readonly parkedHulls = new Set<number>();
  private parkedTimer = 0;
  private camY = 0;
  private readonly lastCam = new THREE.Vector3();
  private groundFn: ((x: number, z: number) => number | null) | null = null;
  private waterFn: ((x: number, z: number) => number) | null = null;
  /** Particles that bounce or snap: the ground where it is known, else just under the camera. */
  private readonly heightAtFn = (x: number, z: number): number => this.groundFn?.(x, z) ?? this.camY - 2;
  private readonly sources: RoofSources;
  private readonly cpu = { update: 0, view: 0 };

  constructor(physics: Physics) {
    this.roofs = new RoofGrid(physics);
    this.kill = { topAt: (x, z) => this.roofs.topAt(x, z), slack: KILL_SLACK, hull: null };
    this.sources = {
      groundAt: (x, z) => (this.groundFn ? this.groundFn(x, z) : null),
      waterAt: (x, z) => (this.waterFn ? this.waterFn(x, z) : -Infinity),
      // Fixed things (the ground, shells, placed objects) and ships standing on the ground; never
      // anything that moves on its own. Rooms are left out by the grid's collision groups.
      include: (c: RAPIER.Collider) => {
        const b = c.parent();
        return !b || b.isFixed() || this.parkedHulls.has(c.handle);
      },
    };
  }

  /**
   * A world with a sky arrived. Index the blocks by family; prepare every effect file the blocks and
   * the forceable list name (fetch the descriptions and textures, make the batches, upload the
   * textures); find the family at `at` and wait for its rows' gradient and cloud textures; point the
   * roof uniforms at the grid; and snap on the next update (no fades, wetness seeded from the
   * schedule). Resolves when all of that is done. Off in space and in the gallery.
   */
  async attach(opts: { pack: AssetPack; sky: SwgSky; terrain: Terrain; planet: PlanetDef; packId: string; renderer: THREE.WebGLRenderer | null; at: THREE.Vector3 }): Promise<void> {
    this.detach();
    const token = ++this.token;
    const { sky, planet, pack, renderer } = opts;
    this.sky = sky;
    this.terrain = opts.terrain;
    this.renderer = renderer;
    this.packId = opts.packId;
    this.reason = planet.space ? 'space' : planet.id === 'gallery' ? 'gallery' : null;
    if (this.reason) return;
    const data = sky.data;
    this.hasWeatherData = !!data.weather;
    let top = 1;
    for (const b of data.blocks) top = Math.max(top, b.weatherIndex + 1);
    this.levels = Math.max(1, data.weather?.levels ?? top);
    sky.families.forEach((blocks, name) => {
      const byLevel = new Int16Array(this.levels).fill(-1);
      for (const b of blocks) if (b.weatherIndex >= 0 && b.weatherIndex < this.levels && byLevel[b.weatherIndex] < 0) byLevel[b.weatherIndex] = data.blocks.indexOf(b);
      const rows: FamilyRows = { name, byLevel };
      this.rowsByName.set(name, rows);
      this.firstRows ??= rows;
    });
    this.seed = seedOf(opts.packId);
    this.weights = climateFor(opts.packId, this.levels);
    if (!data.weather) console.info('weather: sky.json has no camera effects; run: npm run swg -- sky @SWG all assets-private --retail-only');
    else {
      // Every effect any row or any forced kind may play, made and uploaded now, so a storm that
      // arrives in play finds its batches, textures and (after the warm-up) programs ready.
      const fx = new ParticleEffects(this.scene, pack.url(''), { actorLayer: false, shader: WEATHER_PARTICLE_SHADER });
      fx.heightAt = this.heightAtFn;
      this.fxEffects = fx;
      const files = new Set<string>();
      for (const b of data.blocks) if (b.cameraEffect?.file) files.add(b.cameraEffect.file);
      for (const list of Object.values(data.weather.effects)) for (const f of list) if (f) files.add(f);
      const results = await Promise.all([...files].map(async (f) => ({ f, ok: await fx.prepare(f, renderer) })));
      if (token !== this.token) return;
      for (const r of results) if (!r.ok) this.failedFiles.add(r.f);
    }
    // The arrival area's rows at the level falling now, with their textures, before the first frame.
    this.refreshDate(true);
    this.lifeDayNow = this.forced?.lifeDay ?? lifeDayOn(this.settings.lifeDay, this.month, this.dayOfMonth);
    const rows = this.rowsAt(opts.at.x, opts.at.z, this.lifeDayNow, true) ?? this.rowsFor('');
    this.current = rows;
    this.previous = null;
    this.fade = 1;
    scheduledLevel(this.seed, this.weights, this.clockSeconds(), this.sched);
    this.target = this.targetLevel();
    this.level = this.target;
    if (rows) {
      const loads: Promise<void>[] = [];
      for (let l = 0; l < this.levels; l++) {
        const i = rowFor(rows, l);
        const b = i >= 0 ? data.blocks[i] : null;
        if (b && !this.requested.has(b)) {
          this.requested.add(b);
          loads.push(sky.ensureTextures(b, renderer));
        }
      }
      await Promise.all(loads);
      if (token !== this.token) return;
    }
    this.applyMix();
    this.snapPending = true;
    this.seedWetPending = true;
    WEATHER_UNIFORMS.uRoofMap.value = this.roofs.texture;
    WEATHER_UNIFORMS.uRoofGrid.value = this.roofs.grid;
    this.copyState(this.hasWeatherData && this.settings.weather);
    console.info(`weather: ${this.rowsByName.size} areas, ${this.levels} levels, ${this.fxEffects ? `effects ready${this.failedFiles.size ? ` (${this.failedFiles.size} failed to load)` : ''}` : 'no effects'}; arriving in ${this.familyName || rows?.name || 'no area'} at level ${this.target}`);
  }

  /** The world is going: drop the channels and the effects, reset the grid, and point the roof uniforms back at the open map. */
  detach(): void {
    this.token++;
    for (const ch of this.channels) this.fxEffects?.remove(ch.handle);
    this.channels.length = 0;
    this.fxEffects?.dispose();
    this.fxEffects = null;
    this.sky = null;
    this.terrain = null;
    this.reason = 'no sky';
    this.hasWeatherData = false;
    this.failedFiles.clear();
    this.rowsByName.clear();
    this.firstRows = null;
    this.current = this.previous = this.pendingRows = null;
    this.mixCount = 0;
    this.requested = new WeakSet<SkyBlock>();
    this.roofs.reset();
    this.wet.wetness = this.wet.puddles = this.wet.snowCover = 0;
    this.rain = this.snow = this.dust = this.overcast = 0;
    this.kind = 'clear';
    this.wantCount = 0;
    this.lastPos.set(Number.NaN, 0, 0);
    this.kill.hull = null;
    PARTICLE_UNIFORMS.uHullOn.value = 0;
    WEATHER_UNIFORMS.uRoofMap.value = OPEN_ROOF_MAP;
    WEATHER_UNIFORMS.uRoofGrid.value = OPEN_ROOF_GRID;
    WEATHER_UNIFORMS.uWetness.value = WEATHER_UNIFORMS.uPuddles.value = WEATHER_UNIFORMS.uSnowCover.value = WEATHER_UNIFORMS.uRain.value = 0;
    this.copyState(false);
  }

  /** The camera jumped (a teleport): snap on the next update, and start the grid again. */
  reset(): void {
    this.snapPending = true;
    this.roofs.reset();
  }

  configure(settings: WeatherSettings): void {
    // Back to the schedule from a hold: the way back is as quick as the way there.
    if (this.settings.weatherForce >= 0 && settings.weatherForce < 0) this.releasing = true;
    // Weather switched back on: the schedule's level arrives as quickly as a release, not over minutes.
    if (!this.settings.weather && settings.weather) this.releasing = true;
    if (settings.lifeDay !== this.settings.lifeDay) this.familyTimer = 0;
    this.settings = { weather: settings.weather, weatherDensity: settings.weatherDensity, rainOpacity: settings.rainOpacity, wetSurfaces: settings.wetSurfaces, weatherShadows: settings.weatherShadows, weatherForce: settings.weatherForce, weatherKind: settings.weatherKind, lifeDay: settings.lifeDay };
    this.updateHeldNote();
  }

  /** The console's force over the settings, or null for none (what it is now, for merging). */
  get forcedNow(): WeatherForce | null {
    return this.forced;
  }

  /** Console forcing over the settings; null returns to them. Not saved. */
  force(f: WeatherForce | null): void {
    const before = this.forced;
    if (before?.level != null && (f?.level == null)) this.releasing = true;
    const familyChanged = (before?.family ?? null) !== (f?.family ?? null);
    const lifeDayChanged = (before?.lifeDay ?? null) !== (f?.lifeDay ?? null);
    // A force with nothing left in it is no force (the HUD would otherwise say "forced").
    const g = f ? { level: f.level ?? null, kind: f.kind ?? null, family: f.family ?? null, lifeDay: f.lifeDay ?? null } : null;
    this.forced = g && (g.level !== null || g.kind !== null || g.family !== null || g.lifeDay !== null) ? g : null;
    if (f?.snap || familyChanged) this.forceSnap = true;
    if (familyChanged || lifeDayChanged) this.familyTimer = 0;
    this.updateHeldNote();
  }

  /** Console: set wet values at once. */
  setWet(values: Partial<WetState>): void {
    if (values.wetness !== undefined) this.wet.wetness = clamp01(values.wetness);
    if (values.puddles !== undefined) this.wet.puddles = clamp01(values.puddles);
    if (values.snowCover !== undefined) this.wet.snowCover = clamp01(values.snowCover);
  }

  /** Console: run the schedule's clock faster, or skip minutes ahead. */
  setClock(opts: { timeScale?: number; skipMinutes?: number }): void {
    if (opts.timeScale === 1) {
      // Back on the wall clock, the one every player shares (only a skip, which the note reports, stays).
      this.clockBase = 0;
      this.realBase = 0;
      this.timeScale = 1;
      this.releasing = true;
    } else if (opts.timeScale !== undefined && Number.isFinite(opts.timeScale) && opts.timeScale >= 0) {
      this.clockBase = this.clockSeconds() - this.offsetSeconds;
      this.realBase = Date.now() / 1000;
      this.timeScale = opts.timeScale;
    }
    if (opts.skipMinutes !== undefined && Number.isFinite(opts.skipMinutes)) this.offsetSeconds += opts.skipMinutes * 60;
    this.scheduleTimer = 0;
    this.updateHeldNote();
  }

  /** Console: hold the wind's heading (radians), or null to follow the schedule. */
  holdWind(heading: number | null): void {
    this.heldHeading = heading === null || !Number.isFinite(heading) ? null : heading;
  }

  /** The shadow factor the world applies to the cascades: the mix's, or 1 with storms not dimming shadows. */
  shadowFactor(L: SkyLighting): number {
    return this.settings.weatherShadows ? clamp01(L.shadowScale) : 1;
  }

  /** One line for the heads-up display when the weather is not the shared schedule's; '' otherwise. Kept: cheap to ask every frame. */
  heldNote(): string {
    return this.heldText;
  }

  private updateHeldNote(): void {
    const parts: string[] = [];
    const s = this.settings;
    if (s.weather) {
      if (s.weatherForce >= 0) parts.push(`Weather held: ${LEVEL_NAMES[Math.min(LEVEL_NAMES.length - 1, Math.max(0, Math.round(s.weatherForce)))]}`);
      const kind = FORCED_KINDS[s.weatherKind] ?? null;
      if (kind) parts.push(`${kind === 'rain' ? 'Rain' : kind === 'dust' ? 'Dust storms' : 'Snow'} in place of the area's own`);
      if (s.lifeDay === 1) parts.push('Life Day always on');
      else if (s.lifeDay === 0) parts.push('Life Day off');
      if (this.forced) parts.push('Weather forced from the console');
      if (this.timeScale !== 1 || this.offsetSeconds !== 0) parts.push('Weather clock moved from the console');
    }
    this.heldText = parts.join(' · ');
  }

  /** The schedule's clock, seconds: the wall clock unless the console has moved it. */
  private clockSeconds(): number {
    const now = Date.now() / 1000;
    if (this.timeScale === 1 && this.clockBase === 0) return now + this.offsetSeconds;
    return this.clockBase + (now - this.realBase) * this.timeScale + this.offsetSeconds;
  }

  /** The whole level wanted now: the console's, the held setting's, or the schedule's. */
  private targetLevel(): number {
    const raw = this.forced?.level ?? (this.settings.weatherForce >= 0 ? this.settings.weatherForce : this.sched.level);
    return Math.min(this.levels - 1, Math.max(0, Math.round(raw)));
  }

  /** Today's month and day, read once a minute (the season changes by the day, and a Date is an object). */
  private refreshDate(now = false): void {
    if (!now && this.dateTimer > 0) return;
    const d = new Date();
    this.month = d.getMonth();
    this.dayOfMonth = d.getDate();
    this.dateTimer = 60;
  }

  /** A family's rows by name: the table's own (case aside), else its unnamed rows, else its first family. */
  private rowsFor(name: string): FamilyRows | null {
    const key = name.toLowerCase();
    const rows = this.rowsByName.get(key);
    if (rows) return rows;
    if (key && !this.warnedNames.has(key)) {
      this.warnedNames.add(key);
      console.warn(`weather: the environment table has no rows for the area "${name}"; drawing ${this.rowsByName.has('') ? 'its unnamed rows' : `"${this.firstRows?.name ?? 'nothing'}"`} there`);
    }
    return this.rowsByName.get('') ?? this.firstRows;
  }

  /** The rows of the area at a point (a held family wins), or undefined when the terrain there is not generated yet. */
  private rowsAt(x: number, z: number, season: boolean, sync: boolean): FamilyRows | null | undefined {
    if (this.forced?.family) {
      this.familyName = this.forced.family;
      this.familyId = -1;
      return this.rowsFor(this.forced.family);
    }
    const swg = this.terrain?.swg;
    if (!swg) {
      this.familyName = '';
      this.familyId = 0;
      return this.rowsFor('');
    }
    const id = sync ? swg.environmentAt(x, z, season) : swg.environmentIfCached(x, z, season);
    if (id === null) return undefined;
    if (id !== this.familyId || !this.familyName) {
      this.familyId = id;
      this.familyName = swg.environmentFamilies.get(id)?.name ?? '';
    }
    return this.rowsFor(this.familyName);
  }

  /** Ask for a block's textures once. */
  private request(b: SkyBlock): void {
    if (this.requested.has(b) || !this.sky) return;
    this.requested.add(b);
    void this.sky.ensureTextures(b, this.renderer);
  }

  /** Whether a family's rows for the level heading to are ready to draw (asking for them if not). */
  private rowsReady(rows: FamilyRows, level: number): boolean {
    const a = this.rowReady(rows, Math.floor(level));
    const b = this.rowReady(rows, Math.ceil(level));
    return a && b;
  }

  private rowReady(rows: FamilyRows, level: number): boolean {
    const sky = this.sky;
    const i = sky ? rowFor(rows, level) : -1;
    if (!sky || i < 0) return true;
    const b = sky.data.blocks[i];
    if (sky.texturesReady(b)) return true;
    this.request(b);
    return false;
  }

  /** Blend the rows for this frame and hand them to the sky. */
  private applyMix(): void {
    const sky = this.sky;
    if (!sky || !this.current) return;
    const n = mixBlocks(this.mixOut, this.current, this.previous, this.fade, this.level);
    const blocks = sky.data.blocks;
    for (let i = 0; i < n; i++) {
      const b = blocks[this.mixOut.index[i]];
      this.mixList[i] = b;
      // A block still loading shows its layers at nothing until they arrive.
      if (!this.requested.has(b) && !sky.texturesReady(b)) this.request(b);
    }
    this.mixCount = n;
    sky.setMix(this.mixList, this.mixOut.weight, n);
  }

  /** Every half second: the area under the player, and a crossfade when it changes. */
  private refreshFamily(pos: THREE.Vector3, snap: boolean): void {
    this.lifeDayNow = this.forced?.lifeDay ?? lifeDayOn(this.settings.lifeDay, this.month, this.dayOfMonth);
    const rows = this.rowsAt(pos.x, pos.z, this.lifeDayNow, snap);
    if (!rows) return;
    if (snap || this.pendingRows) {
      // A snap switches outright, once the new area's textures are in (or it has waited long enough).
      this.pendingRows = rows === this.current ? null : rows;
      return;
    }
    if (rows === this.current) return;
    if (rows === this.previous && this.previous) {
      // Turned back part way over a boundary: fade back from where the fade had got to.
      this.previous = this.current;
      this.current = rows;
      this.fade = 1 - this.fade;
    } else {
      this.previous = this.current;
      this.current = rows;
      this.fade = 0;
    }
  }

  /** Phase 1, once per frame before the sky's update: the area, the level, the sky's blend, the wind, what falls, how wet. */
  update(dtIn: number, playerPos: THREE.Vector3, ctx: WeatherWorldContext): void {
    const t0 = performance.now();
    const dt = Math.min(0.05, Math.max(0, dtIn));
    this.groundFn = ctx.groundAt;
    const sky = this.sky;
    if (!sky || this.reason || !this.current) {
      this.rain = this.snow = this.dust = this.overcast = 0;
      sky?.setOvercast(0);
      this.wantCount = 0;
      this.kind = 'clear';
      this.copyState(false);
      this.cpu.update += (performance.now() - t0 - this.cpu.update) / 60;
      return;
    }
    const active = this.hasWeatherData && this.settings.weather;
    // A teleport the world was not told of (the console's, a spawn moved clear): snap.
    if (!Number.isNaN(this.lastPos.x) && this.lastPos.distanceToSquared(playerPos) > JUMP_METRES * JUMP_METRES) this.reset();
    this.lastPos.copy(playerPos);
    const snap = this.snapPending || this.forceSnap;
    this.dateTimer -= dt;
    this.refreshDate();

    // The level.
    const clock = this.clockSeconds();
    this.scheduleTimer -= dt;
    if (this.scheduleTimer <= 0 || snap) {
      scheduledLevel(this.seed, this.weights, clock, this.sched);
      this.scheduleTimer = 1;
    }
    const target = active ? this.targetLevel() : 0;
    const held = active && (this.forced?.level != null || this.settings.weatherForce >= 0);
    this.level = snap ? target : stepLevel(this.level, target, dt, held || this.releasing || !active);
    if (this.releasing && this.level === target) this.releasing = false;
    this.target = target;

    // The area, twice a second (or at once on a snap), and the fade between two.
    this.familyTimer -= dt;
    if (this.familyTimer <= 0 || snap) {
      this.familyTimer = 0.5;
      this.refreshFamily(playerPos, snap);
    }
    if (this.pendingRows) {
      this.pendingWait += dt;
      if (this.rowsReady(this.pendingRows, target) || this.pendingWait >= SNAP_WAIT_SECONDS) {
        this.current = this.pendingRows;
        this.previous = null;
        this.fade = 1;
        this.pendingRows = null;
        this.pendingWait = 0;
      }
    } else this.pendingWait = 0;
    if (this.previous) {
      this.fade += dt / FAMILY_FADE_SECONDS;
      if (this.fade >= 1) {
        this.fade = 1;
        this.previous = null;
      }
    }
    this.applyMix();

    // The wind: its heading drifts over twenty minutes, it gusts over half a minute, and its
    // strength is the rows' own scale (last frame's, which changes slowly).
    windAt(this.seed, clock, this.wind);
    this.windHeading = this.heldHeading ?? this.wind.heading;
    this.windSpeed = sky.lighting.windSpeedScale * this.wind.gust;
    sky.setWind(this.windHeading);

    // What falls.
    this.collect(active);
    this.overcast = clamp01(Math.max(1 - sky.lighting.shadowScale, this.rain, this.snow, this.dust));
    sky.setOvercast(this.overcast);

    // How wet: arriving, as the last twenty minutes of the schedule would have left it.
    if (snap && this.seedWetPending) {
      this.seedWetPending = false;
      if (active) seedWet(this.wet, this.seed, this.weights, clock, (l) => this.fallingAt(l, 'rain'), (l) => this.fallingAt(l, 'snow'));
    }
    stepWet(this.wet, dt, this.rain, this.snow, ctx.daylight, this.windSpeed);
    const wetOn = this.settings.wetSurfaces && active ? 1 : 0;
    const U = WEATHER_UNIFORMS;
    U.uWetness.value = this.wet.wetness * wetOn;
    U.uPuddles.value = this.wet.puddles * wetOn;
    U.uSnowCover.value = this.wet.snowCover * wetOn;
    U.uRain.value = this.rain * wetOn;
    U.uWeatherTime.value += dt;

    if (snap) {
      this.replaceChannels = true;
      this.roofs.reset();
      this.snapPending = false;
      this.forceSnap = false;
    }
    this.copyState(active);
    this.cpu.update += (performance.now() - t0 - this.cpu.update) / 60;
  }

  /** The kind forced now (the console's, else the setting's), or null for the area's own. */
  private forcedKind(): ForcedKind | null {
    return this.forced?.kind ?? FORCED_KINDS[this.settings.weatherKind] ?? null;
  }

  /** How hard rain (or snow) falls at a level in the current area: the replay's view of the past. */
  private fallingAt(level: number, kind: 'rain' | 'snow'): number {
    const rows = this.current;
    const sky = this.sky;
    if (!rows || !sky) return 0;
    const i = rowFor(rows, level);
    if (i < 0) return 0;
    const c = effectFor(sky.data.blocks[i], this.forcedKind(), level, sky.data.weather?.effects, this.choice);
    return c && c.kind === kind && !this.failedFiles.has(c.file) ? c.strength : 0;
  }

  /** What the mix wants to fall: the strengths by kind and the effects to play, weighted. */
  private collect(active: boolean): void {
    this.rain = this.snow = this.dust = 0;
    this.wantCount = 0;
    this.kind = 'clear';
    const sky = this.sky;
    if (!active || !sky) return;
    const forced = this.forcedKind();
    const level = Math.round(this.level);
    const effects = sky.data.weather?.effects;
    let heaviest = 0;
    for (let i = 0; i < this.mixCount; i++) {
      const w = this.mixOut.weight[i];
      const c = effectFor(this.mixList[i], forced, level, effects, this.choice);
      if (!c || this.failedFiles.has(c.file)) continue;
      const s = w * c.strength;
      if (c.kind === 'rain') this.rain += s;
      else if (c.kind === 'snow') this.snow += s;
      else if (c.kind === 'dust') this.dust += s;
      if (w > heaviest) {
        heaviest = w;
        this.kind = c.kind;
      }
      let k = 0;
      while (k < this.wantCount && this.wantFile[k] !== c.file) k++;
      if (k === this.wantCount) {
        if (k >= this.wantWeight.length) continue;
        this.wantFile[k] = c.file;
        this.wantKind[k] = c.kind;
        this.wantWeight[k] = 0;
        this.wantCount++;
      }
      this.wantWeight[k] += w;
    }
    this.rain = clamp01(this.rain);
    this.snow = clamp01(this.snow);
    this.dust = clamp01(this.dust);
  }

  /** Phase 2, once per frame after the camera has moved and physics has stepped: where the effect plays, the hull, the roof grid, the particles. */
  updateView(dtIn: number, camera: THREE.PerspectiveCamera, ctx: WeatherViewContext): void {
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, dtIn));
    const fx = this.fxEffects;
    this.groundFn = ctx.groundAt;
    this.waterFn = ctx.waterAt;
    const cam = camera.position;
    this.camY = cam.y;
    this.lastCam.copy(cam);
    if (!fx || !this.sky || this.reason) {
      this.cpu.view += (performance.now() - t0 - this.cpu.view) / 60;
      return;
    }
    const active = this.hasWeatherData && this.settings.weather;

    // Where the effect plays: not aboard, not underground in a building, not under water, and
    // fading out high above the ground.
    this.underwater = cam.y < ctx.waterAt(cam.x, cam.z);
    const ground = ctx.groundAt(cam.x, cam.z);
    const want = ctx.aboard || (ctx.inside && ctx.underground) || this.underwater ? 0 : ground === null ? 1 : 1 - smoothstep(HIGH_FROM, HIGH_TO, cam.y - ground);
    const step = dt * 2;
    this.outside = this.outside < want ? Math.min(want, this.outside + step) : Math.max(want, this.outside - step);

    // The ship being ridden: its box drops rain per fragment always, and on the CPU only with the
    // camera inside it (first person in the canopy), where a chase view would see the hole.
    const hull = ctx.hull;
    if (hull) {
      hull.group.updateWorldMatrix(true, false);
      const toLocal = PARTICLE_UNIFORMS.uHullToLocal.value.copy(hull.group.matrixWorld).invert();
      const b = hull.spec.bounds;
      const lo = PARTICLE_UNIFORMS.uHullMin.value.set(Math.min(b.min[0], b.max[0]), Math.min(b.min[1], b.max[1]), Math.min(b.min[2], b.max[2]));
      const hi = PARTICLE_UNIFORMS.uHullMax.value.set(Math.max(b.min[0], b.max[0]), Math.max(b.min[1], b.max[1]), Math.max(b.min[2], b.max[2]));
      PARTICLE_UNIFORMS.uHullOn.value = 1;
      tmpV.copy(cam).applyMatrix4(toLocal);
      const g = 0.5;
      const first = tmpV.x > lo.x - g && tmpV.x < hi.x + g && tmpV.y > lo.y - g && tmpV.y < hi.y + g && tmpV.z > lo.z - g && tmpV.z < hi.z + g;
      this.kill.hull = first ? this.killHull : null;
      if (hull !== this.hullFor || first !== this.hullFirst || this.hullLabel === null) {
        this.hullFor = hull;
        this.hullFirst = first;
        this.hullLabel = `${hull.spec.label}${first ? ' (first person)' : ''}`;
      }
    } else {
      PARTICLE_UNIFORMS.uHullOn.value = 0;
      this.kill.hull = null;
      this.hullFor = null;
      this.hullLabel = null;
    }

    // The channels: one placed effect per file the mix wants, at its share of the mix.
    if (this.replaceChannels) {
      for (const ch of this.channels) fx.remove(ch.handle);
      this.channels.length = 0;
      this.replaceChannels = false;
    }
    for (const ch of this.channels) ch.weight = 0;
    for (let i = 0; i < this.wantCount; i++) {
      const file = this.wantFile[i];
      let ch: Channel | null = null;
      for (const c of this.channels) if (c.file === file) ch = c;
      if (!ch) {
        const matrix = new THREE.Matrix4();
        const kind = this.wantKind[i];
        const sideways = kind === 'dust' || /storm/i.test(file);
        this.placement(kind, sideways, cam, matrix);
        ch = { file, kind, sideways, handle: fx.place(file, matrix, false, false), weight: 0, idle: 0, matrix };
        this.channels.push(ch);
      }
      ch.weight = this.wantWeight[i];
    }
    const density = Math.max(0, this.settings.weatherDensity);
    let falling = false;
    for (let i = this.channels.length - 1; i >= 0; i--) {
      const ch = this.channels[i];
      ch.handle.rateScale = active ? ch.weight * density * this.outside : 0;
      // The game's rain sheets are near solid; the setting thins rain alone, never dust or snow.
      ch.handle.alphaScale = ch.kind === 'rain' ? THREE.MathUtils.clamp(this.settings.rainOpacity, 0, 1) : 1;
      // Only an effect with particles of its own: the attachment-only ones (the light dust storm,
      // falling leaves, Mustafar's lightning) draw nothing yet and need no roofs.
      if (ch.handle.rateScale > 0 && fx.particlesOf(ch.handle) > 0) falling = true;
      if (ch.weight > 0) ch.idle = 0;
      else if ((ch.idle += dt) > CHANNEL_IDLE) {
        fx.remove(ch.handle);
        this.channels[i] = this.channels[this.channels.length - 1];
        this.channels.pop();
        continue;
      }
      this.placement(ch.kind, ch.sideways, cam, ch.matrix);
      fx.move(ch.handle, ch.matrix);
    }

    // The roofs: while anything falls, or while the ground is wet and the wet shading can read
    // them (the weather on and "Wet ground" on), and not high above the ground.
    const wetOn = active && this.settings.wetSurfaces;
    const wet = wetOn && (this.wet.wetness > 0.005 || this.wet.puddles > 0.005 || this.wet.snowCover > 0.005);
    const high = ground !== null && cam.y - ground > HIGH_FROM;
    if ((falling || fx.quads > 0 || wet) && !high) {
      this.parkedTimer -= dt;
      if (this.parkedTimer <= 0) {
        this.parkedTimer = 0.5;
        this.parkedHulls.clear();
        // Never what the player rides, nor anything moving: a speeder cast as a roof leaves a dry trail.
        for (const v of ctx.vehicles) if (!v.airborne && v !== ctx.ridden && Math.abs(v.speed) < PARKED_SPEED) for (const h of v.colliderHandles) this.parkedHulls.add(h);
      }
      this.roofs.update(cam, ROOF_BUDGET, this.sources);
    } else this.roofs.rays = 0;

    fx.kill = this.kill;
    fx.update(dt, camera, ctx.fog);
    this.state.outside = this.outside;
    this.state.underwater = this.underwater;
    this.state.hull = this.hullLabel;
    this.cpu.view += (performance.now() - t0 - this.cpu.view) / 60;
  }

  /**
   * Where a channel's effect hangs: at the camera, yawed to the wind, and for falling rain and snow
   * leaned so it falls downwind (the tilt grows with the wind's speed). The storms that blow sideways
   * (dust, the snow storm) turn a quarter more and do not lean; fog, smoke and lightning yaw only.
   */
  private placement(kind: WeatherKind, sideways: boolean, at: THREE.Vector3, out: THREE.Matrix4): void {
    let yaw = this.windHeading;
    let tilt = 0;
    if (sideways) yaw += DUST_YAW_OFFSET;
    else if (kind === 'rain' || kind === 'snow') tilt = Math.min(Math.atan((Math.min(this.windSpeed, 15) * 0.5) / 8), kind === 'rain' ? RAIN_TILT_MAX : SNOW_TILT_MAX);
    tmpQYaw.setFromAxisAngle(Y_AXIS, yaw);
    // Turning -tilt about X leans the effect's down toward +Z, which the yaw turns to the heading.
    tmpQTilt.setFromAxisAngle(X_AXIS, -tilt);
    tmpQ.multiplyQuaternions(tmpQYaw, tmpQTilt);
    out.compose(at, tmpQ, ONE);
  }

  /** Compile the falling effects' programs against their own scene (never the world's: its lights and fog are in the key). */
  compile(renderer: THREE.WebGLRenderer, camera: THREE.Camera, waitReady: boolean): Promise<void> | void {
    if (!this.scene.children.length) return;
    if (waitReady) return renderer.compileAsync(this.scene, camera, this.scene).then(() => undefined, () => undefined);
    renderer.compile(this.scene, camera, this.scene);
  }

  /** The weather pass: after the portal renderer, into whatever it drew into. From inside a building, only through its exits (stencil 2). */
  draw(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, portalView: boolean): void {
    const fx = this.fxEffects;
    if (!this.drawPass || !fx || fx.quads === 0) return;
    const mats = fx.batchMaterials;
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      // Outside no stencil test at all: rain may fall in front of a doorway.
      m.stencilWrite = portalView;
      if (portalView) {
        m.stencilFunc = THREE.EqualStencilFunc;
        m.stencilRef = 2;
        m.stencilFuncMask = 0xff;
        m.stencilWriteMask = 0x00;
        m.stencilFail = THREE.KeepStencilOp;
        m.stencilZFail = THREE.KeepStencilOp;
        m.stencilZPass = THREE.KeepStencilOp;
      }
    }
    const mask = camera.layers.mask;
    camera.layers.set(0);
    renderer.render(this.scene, camera);
    camera.layers.mask = mask;
  }

  private copyState(active: boolean): void {
    const s = this.state;
    s.enabled = !this.reason && active;
    s.reason = this.reason ?? (!this.hasWeatherData ? 'no weather data' : !this.settings.weather ? 'setting off' : null);
    s.family = this.forced?.family ?? (this.familyName || this.current?.name || '');
    s.familyId = this.familyId;
    s.lifeDay = this.lifeDayNow;
    s.level = this.level;
    s.target = this.target;
    s.levels = this.levels;
    s.scheduled = this.sched.level;
    s.nextChangeSeconds = this.sched.nextChangeSeconds;
    s.forced = this.forced;
    s.kind = this.kind;
    s.rain = this.rain;
    s.snow = this.snow;
    s.dust = this.dust;
    s.overcast = this.overcast;
    s.wetness = this.wet.wetness;
    s.puddles = this.wet.puddles;
    s.snowCover = this.wet.snowCover;
    s.windHeading = this.windHeading;
    s.windSpeed = this.windSpeed;
    const f = this.fx;
    f.overcast = this.overcast;
    f.rain = this.rain;
    f.snow = this.snow;
    f.dust = this.dust;
    f.wetness = this.settings.wetSurfaces ? this.wet.wetness : 0;
  }

  /** The state for the console; with `emitters`, the weather effects' emitter rows within 30 m of the camera too. */
  describe(opts: { emitters?: boolean } = {}): Record<string, unknown> {
    const s = this.state;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const fx = this.fxEffects;
    const next = s.nextChangeSeconds;
    const deg = ((THREE.MathUtils.radToDeg(s.windHeading) % 360) + 360) % 360;
    const out: Record<string, unknown> = {
      enabled: s.enabled,
      reason: s.reason,
      planet: this.packId,
      family: s.family,
      rows: this.current?.name ?? null,
      familyId: s.familyId,
      lifeDay: s.lifeDay,
      level: r2(s.level),
      target: s.target,
      levels: s.levels,
      scheduled: s.scheduled,
      nextChange: next === null ? 'not within four hours' : next < 60 ? `in ${Math.round(next)} s` : `in ${Math.round(next / 60)} min`,
      forced: s.forced,
      kind: s.kind,
      rain: r2(s.rain),
      snow: r2(s.snow),
      dust: r2(s.dust),
      overcast: r2(s.overcast),
      wetness: r2(s.wetness),
      puddles: r2(s.puddles),
      snowCover: r2(s.snowCover),
      wind: { heading: Math.round(deg), speed: r2(s.windSpeed), held: this.heldHeading !== null },
      outside: r2(s.outside),
      underwater: s.underwater,
      hull: s.hull,
      mix: Array.from({ length: this.mixCount }, (_, i) => `${this.mixList[i].name} w${this.mixList[i].weatherIndex} ${this.mixOut.weight[i].toFixed(2)}`),
      fading: this.previous ? { from: this.previous.name, fade: r2(this.fade) } : null,
      waitingFor: this.pendingRows?.name ?? null,
      shadows: r2(this.sky?.lighting.shadowScale ?? 1),
      channels: this.channels.map((c) => ({ file: c.file, kind: c.kind, rate: r2(c.handle.rateScale), particles: fx?.particlesOf(c.handle) ?? 0 })),
      failed: [...this.failedFiles],
      quads: fx?.quads ?? 0,
      roofs: this.roofs.describe(),
      programs: this.renderer?.info.programs?.length ?? null,
      cpuMs: { update: Math.round(this.cpu.update * 1000) / 1000, view: Math.round(this.cpu.view * 1000) / 1000 },
      clock: { timeScale: this.timeScale, offsetMinutes: Math.round(this.offsetSeconds / 6) / 10 },
      draw: this.drawPass,
      held: this.heldText,
    };
    if (opts.emitters && fx) {
      out.camera = [r2(this.lastCam.x), r2(this.lastCam.y), r2(this.lastCam.z)];
      out.emitters = fx.describeEmitters(this.lastCam.x, this.lastCam.z, 30);
    }
    return out;
  }

  dispose(): void {
    this.detach();
    this.roofs.dispose();
  }
}
