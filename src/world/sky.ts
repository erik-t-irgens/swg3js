import * as THREE from 'three';
import type { AssetPack } from './assetPack';
import type { DayCycle } from './daycycle';
import { angularRadius, isFlareBody, rankStarGroups, tintScale, DISC_FILL, GLOW_FILL, MAX_FLARE_SOURCES, STAR_DISC_FILL, STAR_GLOW_FILL } from '../core/fx/flareMath';
import type { FxCloudLayer, FxSkyLight } from '../core/fx/lensFlare';
import { blockShadow, driftScroll, heaviestTwo, type ForcedKind, type WeatherKind } from './weatherSchedule';

// The planet's sky as the original client draws it (see tools/swg/sky.mjs for the export):
// a gradient sky texture whose columns are the time of day and rows run from the horizon up
// to the zenith (or a skybox), sun and moon quads that ride the main light's direction, extra
// celestial bodies, a star field, cloud layers, and a 256-entry colour ramp per environment
// block giving every light, the fog and the clear colour for each moment of the day.

interface CelestialImage {
  file: string;
  alphaMode: string;
  hasAlpha: boolean;
}
interface Celestial {
  shader: string;
  size: number;
  glowShader: string;
  glowSize: number;
  image: CelestialImage | null;
  glowImage: CelestialImage | null;
  yaw?: number;
  pitch?: number;
  pitchDirection?: number;
  cycleTime?: number;
}
export interface CloudLayer {
  file: string;
  size: number;
  speed: number;
}
export interface CubeFaces {
  faces: string[];
  size: number;
}
/** One row of the planet's environment table: an area (family) at one weather level. */
export interface SkyBlock {
  name: string;
  weatherIndex: number;
  gradientSky: string | null;
  cloudBottom: CloudLayer | null;
  cloudTop: CloudLayer | null;
  ramp: { rows: number; rgba: string } | null;
  shadows: boolean;
  fog: { enabled: boolean; min: number; max: number };
  dayEnvironment: CubeFaces | null;
  nightEnvironment: CubeFaces | null;
  windSpeedScale: number;
  /** The particle effect the row hangs on the camera (rain, a dust storm, snow), as the converter wrote it; absent in packs converted before. */
  cameraEffect?: { source: string; file: string | null; kind: WeatherKind; strength: number } | null;
  /** The row's ambient sounds and music (nothing plays them yet). */
  sounds?: { day: (string | null)[]; night: (string | null)[]; music: Record<'first' | 'sunrise' | 'sunset', string | null> };
}

/** A block and its share of this frame's sky. */
export interface SkyMixEntry {
  block: SkyBlock;
  weight: number;
}
export interface SkyData {
  planet: string;
  dayNightSplit: number;
  sunElevationDegrees: number;
  sun: Celestial | null;
  supplementalSun: (Celestial & { yaw: number; pitch: number }) | null;
  moon: Celestial | null;
  supplementalMoon: (Celestial & { yaw: number; pitch: number }) | null;
  celestials: Celestial[];
  stars: { count: number; colors: { width: number; height: number; rgba: string } | null } | null;
  nightSky: { shader: string; image: CelestialImage | null } | null;
  skybox: { cube?: CubeFaces | null; sides?: Record<string, string | null> } | null;
  /** A space zone's own environment, from its terrain file (see tools/swg/space.mjs). */
  space?: SpaceEnvironment | null;
  blocks: SkyBlock[];
  /** How many weather levels the table has, and the effects any kind can be forced to (lightest first); absent in space and in packs converted before. */
  weather?: { levels: number; effects: Record<ForcedKind, (string | null)[]> } | null;
}

/** A parallel light of a space zone: colours as the client stores them, and the frame it shines down. */
interface SpaceLight {
  shadows: boolean;
  diffuse: number[];
  specular: number[];
  yaw: number;
  pitch: number;
  roll: number;
}
interface SpaceEnvironment {
  clear: number[] | null;
  ambient: number[] | null;
  lights: SpaceLight[];
  dust: { count: number; radius: number } | null;
  celestials: { shader: string; size: number; yaw: number; pitch: number; roll: number; image: CelestialImage | null }[];
  environmentMap: CubeFaces | null;
}

/** What the sky decides for the rest of the scene at one moment. */
export interface SkyLighting {
  ambient: THREE.Color;
  /** Scale from the ambient row's alpha, as the client stores every light scale. */
  ambientScale: number;
  /** The client's shadow colour for this hour (ramp row 7): what a shadowed surface tends to. */
  shadow: THREE.Color;
  main: THREE.Color;
  mainScale: number;
  fill: THREE.Color;
  fillScale: number;
  bounce: THREE.Color;
  bounceScale: number;
  fog: THREE.Color;
  fogDensity: number;
  clear: THREE.Color;
  sunMoonAlpha: number;
  starAlpha: number;
  isDay: boolean;
  /** 0..1: how much the blocks in the mix want shadows (a clear row always does; a storm row as the table says), weighted. */
  shadowScale: number;
  /** The mix's wind speed scale (clouds drift by it; the weather tilts rain by it). */
  windSpeedScale: number;
}

/** Colour ramp rows, in the order the client reads them. */
/**
 * Rows of the client's 256 x 10 colour ramp, indexed by time of day.
 *
 * Rows 0..7 are the names the engine's own light terms suggest, but rows 0 (Ambient), 3 (Fill)
 * and 4 (Bounce) read #000000 at every hour on every planet, which cannot be what the client
 * lit with -- a scene with no ambient renders everything out of the sun's reach pure black.
 * Rows 8 and 9 are the two that actually carry per-planet light colours (alpha ~164, the
 * client's 4 * (a - 128) / 128 scale encoding), and row 8 is consistently the darker of the
 * pair. That is the shape of a hemisphere term: 9 the sky above, 8 the ground bounce below.
 * They are used as such here; `__debug.ambient(row)` switches rows to compare.
 */
const enum Row {
  Ambient = 0,
  MainDiffuse = 1,
  MainSpecular = 2,
  Fill = 3,
  Bounce = 4,
  Clear = 5,
  Fog = 6,
  /** The client's own shadow colour for this hour: dark and tinted, never black. */
  Shadow = 7,
  /** Light bounced off the ground; the darker half of the hemisphere. */
  GroundBounce = 8,
  /** Light from the sky; the ambient that keeps shadowed surfaces readable. */
  SkyAmbient = 9,
}
/** The client's light scale constant: main, fill and bounce scales are 4 * (alpha - 128) / 128. */
const LIGHT_SCALE = 4;
/** Radius the sky bodies are drawn at (inside the camera's far plane, beyond any terrain). */
const SKY_RADIUS = 3500;
/** The client draws celestial quads 3 m in front of the camera, so a quad's size is a half-width at that distance. */
const CELESTIAL_DISTANCE = 3;
/** The client's far plane, which sets where between the block's minimum and maximum fog density it sits. */
const CLIENT_FAR_PLANE = 1024;
/**
 * The client draws each cloud layer as a sheet 10 m above the camera in its sky pass, so a
 * layer's shader size is metres per repeat at that height. Here the sheets sit at real
 * altitudes so they can be flown through, with the repeat and drift scaled to look the same.
 */
const CLIENT_CLOUD_HEIGHT = 10;
const CLOUD_ALTITUDES = [1500, 2300];
const CLOUD_EXTENT = 24000;
const CLOUD_FADE = [5500, 8600];
/** Clouds a touch smaller than the straight scaling gives, and a floor on how slowly they drift (repeats per second). */
const CLOUD_SIZE_TRIM = 0.7;
const CLOUD_MIN_DRIFT = 1 / 240;
/** Seconds in the client's day, which its celestial cycle times count in. */
const CLIENT_DAY_SECONDS = 86400;

const CLOUD_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const CLOUD_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uRepeat;
  uniform vec2 uScroll;
  uniform vec3 uCamera;
  uniform vec2 uFade;
  varying vec3 vWorld;
  void main() {
    vec2 uv = vWorld.xz / uRepeat + uScroll;
    vec4 c = texture2D(uMap, uv);
    float dist = distance(vWorld.xz, uCamera.xz);
    float a = c.a * uOpacity * (1.0 - smoothstep(uFade.x, uFade.y, dist));
    gl_FragColor = vec4(c.rgb * uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const DOME_FRAG = /* glsl */ `
  uniform sampler2D uGradient;
  uniform sampler2D uGradient2;
  uniform float uTime;
  uniform float uHasGradient;
  uniform float uHasGradient2;
  uniform float uGradientMix;
  uniform vec3 uClear;
  uniform vec3 uHorizonFog;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 0.999);
    // Two gradients at most, crossfaded as the weather or the area changes; none is the ramp's clear colour.
    vec3 g1 = uHasGradient > 0.5 ? texture2D(uGradient, vec2(uTime, up)).rgb : uClear;
    vec3 g2 = uHasGradient2 > 0.5 ? texture2D(uGradient2, vec2(uTime, up)).rgb : uClear;
    vec3 col = mix(g1, g2, uGradientMix);
    // Below the horizon the ground normally hides the dome; fade the last strip into the fog.
    col = mix(uHorizonFog, col, smoothstep(-0.03, 0.0, d.y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
/** Scratch for reading a ramp byte triple as a linear colour. */
const tmpRampColor = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
/**
 * What a sampler holds while its texture is not there (a gradient or a cloud image still loading):
 * never null, so a program's sampler bindings never change. Shared by every sky and never disposed.
 */
const WHITE_TEX = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();
/** A block for a sky whose table has none. */
const EMPTY_BLOCK: SkyBlock = { name: '_default', weatherIndex: 0, gradientSky: null, cloudBottom: null, cloudTop: null, ramp: null, shadows: true, fog: { enabled: false, min: 0, max: 0 }, dayEnvironment: null, nightEnvironment: null, windSpeedScale: 1 };
/** What a texture is for, which decides how it wraps. */
type TextureUse = 'gradient' | 'cloud' | 'plain';
/** Most cloud images one altitude blends at once, and most gradient groups the dome weighs. */
const MIX_MAX = 4;
/**
 * The procedural dome's sun, as the lens flare sees it (world.ts's dome shader): its disc edge runs
 * from about 2.3 to 4 degrees and its glow, pow(c, 32), halves at about 12. Angular radii, radians.
 */
const PROCEDURAL_DISC = 0.06;
const PROCEDURAL_GLOW = 0.2;

/** A glowing body the lens flare follows: its sprites, as place() (or, in space, the constructor) left them. */
interface FlareBody {
  /** The glow and disc sprites of a sun, or every sprite of a star group. */
  readonly sprites: readonly THREE.Sprite[];
  readonly discRadius: number;
  readonly glowRadius: number;
  readonly weight: number;
  readonly star: boolean;
  /** Fixed tint (space stars); null: this frame's main light colour. */
  readonly color: THREE.Color | null;
  /** The moon slot carrying a sun (Mustafar): a night sun. */
  readonly night: boolean;
}

export class SwgSky {
  readonly group = new THREE.Group();
  /** A scene holding only the dome, for filtering it into an environment map. */
  readonly domeScene = new THREE.Scene();
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly skybox: THREE.Object3D | null = null;
  private readonly sun: THREE.Sprite[] = [];
  private readonly supplementalSun: THREE.Sprite[] = [];
  private readonly moon: THREE.Sprite[] = [];
  private readonly supplementalMoon: THREE.Sprite[] = [];
  private readonly celestials: { sprites: THREE.Sprite[]; data: Celestial }[] = [];
  /** What the lens flare follows: at most MAX_FLARE_SOURCES, index = flare slot, fixed for the life of the sky. */
  private readonly flareBodies: FlareBody[] = [];
  private readonly stars: THREE.Points | null = null;
  /** Cloud sheets live outside the camera-following group: their altitude is fixed in the world. */
  readonly cloudGroup = new THREE.Group();
  /**
   * A fixed pool of four sheets, bottom 0, bottom 1, top 0, top 1: each altitude blends the two
   * heaviest cloud images of the blocks in the mix. `file` is the image a sheet shows this frame.
   * Every sheet is built at load with the same program, so a new image never makes a material.
   */
  private readonly clouds: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; altitude: number; file: string | null }[] = [];
  /** Scroll of each cloud image, in texture repeats, integrated frame by frame and wrapped to [0, 1); `at` is the frame it last moved. */
  private readonly cloudScroll = new Map<string, { s: THREE.Vector2; at: number }>();
  /** Where the clouds drift toward (radians, 0 = +Z, turning toward +X). */
  private windHeading = 0;
  private readonly ramps = new Map<SkyBlock, Uint8Array>();
  /** The table's weather-0 row (or first row): the sky before anyone sets a mix. */
  private readonly defaultBlock: SkyBlock;
  /** The blocks to blend this frame: `mixCount` of four kept entries, weights summing to 1. */
  private readonly mix: SkyMixEntry[] = [];
  private mixCount = 1;
  /** Blocks of the table grouped by family name, lower-cased, in table order. */
  readonly families = new Map<string, SkyBlock[]>();
  /** Loads in flight by file, and files that failed (never asked for again). */
  private readonly textureLoads = new Map<string, Promise<void>>();
  private readonly failedTextures: Set<string>;
  /** Uploads a texture as it arrives, when the weather has handed one over. */
  private renderer: THREE.WebGLRenderer | null = null;
  private disposed = false;
  /** Frames drawn, so a cloud image shown at both altitudes drifts once a frame. */
  private frameNo = 0;
  /** Kept scratch for grouping the mix by gradient and by cloud image. */
  private readonly groupFiles: (string | null)[] = [null, null, null, null];
  private readonly groupWeights = new Float32Array(MIX_MAX);
  private readonly groupLayers: (CloudLayer | null)[] = [null, null, null, null];
  private readonly groupLayerWeights = new Float32Array(MIX_MAX);
  /** The heaviest two groups (heaviestTwo's kept output). */
  private readonly topTwo = new Int32Array(2);
  private readonly cloudOrder = [0, 1, 2, 3];
  private time = 0;
  /** In space, the direction the main light comes from, fixed: the day cycle follows it instead of the sun's arc. */
  readonly spaceLightDir: THREE.Vector3 | null = null;
  /** Space dust: points fixed in the world within a radius of the camera, wrapped round as it moves, so speed can be seen against nothing. */
  private readonly dust: { points: THREE.Points; radius: number; last: THREE.Vector3 | null } | null = null;
  readonly lighting: SkyLighting = {
    ambient: new THREE.Color(0.3, 0.3, 0.3),
    ambientScale: 1,
    shadow: new THREE.Color(0, 0, 0),
    main: new THREE.Color(1, 1, 1),
    mainScale: 1,
    fill: new THREE.Color(0, 0, 0),
    fillScale: 1,
    bounce: new THREE.Color(0, 0, 0),
    bounceScale: 1,
    fog: new THREE.Color(0.5, 0.5, 0.5),
    fogDensity: 0,
    clear: new THREE.Color(0.5, 0.5, 0.6),
    sunMoonAlpha: 1,
    starAlpha: 1,
    isDay: true,
    shadowScale: 1,
    windSpeedScale: 1,
  };
  /** The cube map faces (already in this engine's handedness) the heaviest block names for reflections, by day and night; rewritten every frame. */
  readonly environment: { day: CubeFaces | null; night: CubeFaces | null };

  /** Whether the heaviest block's gradient is up (a skybox planet, or one still loading, draws the clear colour). */
  get hasGradient(): boolean {
    const f = this.heaviest.gradientSky;
    return !!f && this.textures.has(f);
  }

  private constructor(
    readonly data: SkyData,
    private readonly textures: Map<string, THREE.Texture>,
    private readonly pack: AssetPack,
    failed: Set<string>,
  ) {
    this.failedTextures = failed;
    this.defaultBlock = data.blocks.find((b) => b.weatherIndex === 0) ?? data.blocks[0] ?? EMPTY_BLOCK;
    for (let i = 0; i < MIX_MAX; i++) this.mix.push({ block: this.defaultBlock, weight: i === 0 ? 1 : 0 });
    for (const b of data.blocks) {
      const key = b.name.toLowerCase();
      const list = this.families.get(key);
      if (list) list.push(b);
      else this.families.set(key, [b]);
    }
    this.environment = { day: this.defaultBlock.dayEnvironment, night: this.defaultBlock.nightEnvironment };
    // What load() fetched for the default block wraps as its use asks.
    const gradient = this.defaultBlock.gradientSky ? textures.get(this.defaultBlock.gradientSky) ?? null : null;
    if (gradient) SwgSky.applyUse(gradient, 'gradient');
    for (const layer of [this.defaultBlock.cloudBottom, this.defaultBlock.cloudTop]) {
      const t = layer?.file ? textures.get(layer.file) : undefined;
      if (t) SwgSky.applyUse(t, 'cloud');
    }

    // The dome: the gradient sky, or the ramp's clear colour when the planet has a skybox instead.
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS * 1.6, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        uniforms: {
          uGradient: { value: gradient ?? WHITE_TEX },
          uGradient2: { value: WHITE_TEX },
          uTime: { value: 0 },
          uHasGradient: { value: gradient ? 1 : 0 },
          uHasGradient2: { value: 0 },
          uGradientMix: { value: 0 },
          uClear: { value: new THREE.Color(0.5, 0.5, 0.6) },
          uHorizonFog: { value: new THREE.Color(0.5, 0.5, 0.5) },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);
    this.domeScene.add(new THREE.Mesh(this.dome.geometry, this.dome.material));

    // A six-sided skybox: the client's quads, mirrored in X like every converted mesh.
    if (data.skybox?.sides) {
      const sides = data.skybox.sides;
      const order: [string, number[][]][] = [
        ['front', [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]]],
        ['right', [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]]],
        ['back', [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]]],
        ['left', [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]]],
        ['top', [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]],
        ['bottom', [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]]],
      ];
      const box = new THREE.Group();
      for (const [side, quad] of order) {
        const file = sides[side];
        const tex = file ? textures.get(file) : null;
        if (!tex) continue;
        const g = new THREE.BufferGeometry();
        const pos: number[] = [];
        const uv: number[] = [];
        const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
        for (let i = 0; i < 4; i++) {
          pos.push(-quad[i][0] * SKY_RADIUS * 1.5, quad[i][1] * SKY_RADIUS * 1.5, quad[i][2] * SKY_RADIUS * 1.5);
          uv.push(uvs[i][0], uvs[i][1]);
        }
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, depthWrite: false, depthTest: false, fog: false }));
        m.renderOrder = -9;
        m.frustumCulled = false;
        box.add(m);
      }
      this.skybox = box;
      this.group.add(box);
    }

    // A cube-map skybox (a space zone's nebula): the converter wrote its six faces in the game's
    // order (+X -X +Y -Y +Z -Z), already mirrored for the game's X axis, drawn on the same box.
    if (data.skybox?.cube?.faces?.length === 6) {
      const faces = data.skybox.cube.faces;
      const quads: number[][][] = [
        [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]], // +X
        [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]], // -X
        [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], // +Y
        [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]], // -Y
        [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]], // +Z
        [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]], // -Z
      ];
      const box = new THREE.Group();
      faces.forEach((file, i) => {
        const tex = textures.get(file);
        if (!tex) return;
        const g = new THREE.BufferGeometry();
        const pos: number[] = [];
        const uv: number[] = [];
        const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
        for (let k = 0; k < 4; k++) {
          pos.push(quads[i][k][0] * SKY_RADIUS * 1.5, quads[i][k][1] * SKY_RADIUS * 1.5, quads[i][k][2] * SKY_RADIUS * 1.5);
          uv.push(uvs[k][0], uvs[k][1]);
        }
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, depthWrite: false, depthTest: false, fog: false }));
        m.renderOrder = -9;
        m.frustumCulled = false;
        box.add(m);
      });
      this.skybox = box;
      this.group.add(box);
    }

    const sprite = (image: CelestialImage | null, size: number, additive: boolean): THREE.Sprite | null => {
      const tex = image ? textures.get(image.file) : null;
      if (!tex || size <= 0) return null;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      const s = new THREE.Sprite(mat);
      const width = (2 * size * SKY_RADIUS) / CELESTIAL_DISTANCE;
      s.scale.set(width, width, 1);
      s.renderOrder = -5;
      this.group.add(s);
      return s;
    };
    const body = (c: Celestial | null): THREE.Sprite[] => {
      if (!c) return [];
      const out: THREE.Sprite[] = [];
      // The glow sits behind the body, blended additively; the body itself keeps its own alpha.
      const glow = sprite(c.glowImage, c.glowSize, true);
      if (glow) out.push(glow);
      const disc = sprite(c.image, c.size, c.image?.alphaMode === 'BLEND' ? false : true);
      if (disc) out.push(disc);
      return out;
    };
    this.sun.push(...body(data.sun));
    this.supplementalSun.push(...body(data.supplementalSun));
    this.moon.push(...body(data.moon));
    this.supplementalMoon.push(...body(data.supplementalMoon));
    for (const c of data.celestials) this.celestials.push({ sprites: body(c), data: c });

    // The lens flare's sources over a planet: every sun-shaded body with a glow whose two sprites
    // both loaded (not Yavin 4's gas giant, not a moon; Mustafar's moon slot is a second sun), the
    // heaviest glow first, each in a slot it keeps for the life of the sky.
    if (!data.space) {
      const slots: [Celestial | null, THREE.Sprite[], boolean][] = [
        [data.sun, this.sun, false],
        [data.supplementalSun, this.supplementalSun, false],
        [data.moon, this.moon, true],
        [data.supplementalMoon, this.supplementalMoon, true],
      ];
      let glowMax = 0;
      for (const [c] of slots) if (c && isFlareBody(c)) glowMax = Math.max(glowMax, c.glowSize);
      for (const [c, sprites, night] of slots) {
        if (!c || !isFlareBody(c) || sprites.length < 2) continue;
        this.flareBodies.push({ sprites, discRadius: angularRadius(c.size, DISC_FILL), glowRadius: angularRadius(c.glowSize, GLOW_FILL), weight: c.glowSize / glowMax, star: false, color: null, night });
      }
      // Stable: sun, second sun, moon slot, second moon slot among equals.
      this.flareBodies.sort((a, b) => b.weight - a.weight);
      if (this.flareBodies.length > MAX_FLARE_SOURCES) this.flareBodies.length = MAX_FLARE_SOURCES;
    }

    // A space zone: its star sprites hang where its terrain file turns them, for good; its main
    // light comes from a fixed direction; and dust drifts past the camera.
    const space = data.space;
    if (space) {
      const made: { c: SpaceEnvironment['celestials'][number]; s: THREE.Sprite }[] = [];
      for (const c of space.celestials) {
        const additive = c.image?.alphaMode !== 'BLEND';
        const s = sprite(c.image, c.size, additive);
        if (!s) continue;
        s.position.copy(SwgSky.direction(c.yaw, THREE.MathUtils.degToRad(c.pitch), tmpVec)).multiplyScalar(SKY_RADIUS);
        s.material.rotation = THREE.MathUtils.degToRad(c.roll);
        made.push({ c, s });
      }
      const main = space.lights[0];
      if (main) this.spaceLightDir = SwgSky.direction(main.yaw, THREE.MathUtils.degToRad(main.pitch), new THREE.Vector3());
      // The lens flare's sources in space: the brightest star sprite groups (the sprites are what
      // the eye sees; the zone's lights mostly point elsewhere), tinted halfway to white by the main light.
      for (const g of rankStarGroups(made.map((m) => m.c))) {
        const color = new THREE.Color(1, 1, 1);
        if (main) {
          color.setRGB(main.diffuse[0], main.diffuse[1], main.diffuse[2], THREE.SRGBColorSpace).lerp(WHITE, 0.5);
          color.multiplyScalar(tintScale(color.r, color.g, color.b));
        }
        const sprites = made.filter((m) => m.c.yaw === g.yaw && m.c.pitch === g.pitch).map((m) => m.s);
        this.flareBodies.push({ sprites, discRadius: angularRadius(Math.max(g.backSize, g.glowSize), STAR_DISC_FILL), glowRadius: angularRadius(g.glowSize, STAR_GLOW_FILL), weight: g.weight, star: true, color, night: false });
      }
      if (space.dust && space.dust.count > 0) {
        const n = Math.min(space.dust.count, 4000);
        const r = Math.max(8, space.dust.radius);
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() * 2 - 1) * r;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        // A soft round mote, drawn from a small canvas: a bare point is a hard square.
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
          grad.addColorStop(0, 'rgba(255,255,255,1)');
          grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 32, 32);
        }
        const mote = new THREE.CanvasTexture(canvas);
        const mat = new THREE.PointsMaterial({ color: 0xc8d4e6, map: mote, size: 0.16, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
        const points = new THREE.Points(g, mat);
        points.frustumCulled = false;
        points.renderOrder = 5;
        this.group.add(points);
        this.dust = { points, radius: r, last: null };
      }
    }

    // Stars: the client scatters `count` points and colours them from a small ramp image (more of them in space, where they are the view).
    if (data.stars && data.stars.count > 0) {
      const n = Math.min(data.stars.count, space ? 30000 : 6000);
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const palette = data.stars.colors ? Uint8Array.from(atob(data.stars.colors.rgba), (ch) => ch.charCodeAt(0)) : null;
      let seed = 1234567;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < n; i++) {
        // Over a planet the stars stay above the horizon; in space they are all around.
        const y = space ? rnd() * 2 - 1 : rnd() * 0.98 + 0.02;
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(1 - y * y);
        pos[i * 3] = Math.cos(a) * r * SKY_RADIUS * 1.2;
        pos[i * 3 + 1] = y * SKY_RADIUS * 1.2;
        pos[i * 3 + 2] = Math.sin(a) * r * SKY_RADIUS * 1.2;
        let cr = 1;
        let cg = 1;
        let cb = 1;
        if (palette && palette.length >= 4) {
          const k = Math.floor(rnd() * (palette.length / 4)) * 4;
          cr = palette[k] / 255;
          cg = palette[k + 1] / 255;
          cb = palette[k + 2] / 255;
        }
        const bright = 0.5 + rnd() * 0.5;
        col[i * 3] = cr * bright;
        col[i * 3 + 1] = cg * bright;
        col[i * 3 + 2] = cb * bright;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
      this.stars = new THREE.Points(g, mat);
      this.stars.renderOrder = -6;
      this.stars.frustumCulled = false;
      this.group.add(this.stars);
    }

    // Cloud layers: wide sheets at fixed altitudes, fading out long before their edges. Four of
    // them, two at each altitude, whatever the table holds: which image each shows, and how
    // strongly, is the mix's business frame by frame (update), so none is ever made later.
    const cloud = (altitude: number) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uMap: { value: WHITE_TEX },
          uColor: { value: new THREE.Color(1, 1, 1) },
          uOpacity: { value: 0 },
          uRepeat: { value: 1000 },
          uScroll: { value: new THREE.Vector2() },
          uCamera: { value: new THREE.Vector3() },
          uFade: { value: new THREE.Vector2(CLOUD_FADE[0], CLOUD_FADE[1]) },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const geo = new THREE.PlaneGeometry(CLOUD_EXTENT, CLOUD_EXTENT, 1, 1).rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = altitude;
      mesh.renderOrder = -4;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.cloudGroup.add(mesh);
      this.clouds.push({ mesh, altitude, file: null });
    };
    cloud(CLOUD_ALTITUDES[0]);
    cloud(CLOUD_ALTITUDES[0]);
    cloud(CLOUD_ALTITUDES[1]);
    cloud(CLOUD_ALTITUDES[1]);
  }

  /** How a texture wraps for its use: a gradient's columns wrap with the day and its rows must not; clouds tile. */
  private static applyUse(t: THREE.Texture, use: TextureUse): void {
    if (use === 'gradient') {
      // Rows must not wrap, or the zenith would wrap round to the horizon colour.
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
    } else if (use === 'cloud') t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
  }

  /** One of the sky's images, or null when it failed. */
  private static async fetchTexture(loader: THREE.TextureLoader, pack: AssetPack, file: string): Promise<THREE.Texture | null> {
    try {
      const t = await loader.loadAsync(pack.url(file));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    } catch {
      return null;
    }
  }

  private readonly loader = new THREE.TextureLoader();

  /** Fetch one image into the sky's set (once, however often asked); a failure is remembered and not asked for again. */
  private loadTexture(file: string, use: TextureUse): Promise<void> {
    if (this.textures.has(file) || this.failedTextures.has(file)) return Promise.resolve();
    let p = this.textureLoads.get(file);
    if (!p) {
      p = SwgSky.fetchTexture(this.loader, this.pack, file).then((t) => {
        this.textureLoads.delete(file);
        if (!t) {
          this.failedTextures.add(file);
          console.warn(`sky: ${file} failed to load`);
          return;
        }
        if (this.disposed) {
          t.dispose();
          return;
        }
        SwgSky.applyUse(t, use);
        // Uploaded now, so no frame that draws it pays for it.
        this.renderer?.initTexture(t);
        this.textures.set(file, t);
      });
      this.textureLoads.set(file, p);
    }
    return p;
  }

  /** Whether a block's gradient and cloud images are loaded or have failed (a block without them is always ready). */
  texturesReady(block: SkyBlock): boolean {
    const done = (f: string | null | undefined) => !f || this.textures.has(f) || this.failedTextures.has(f);
    return done(block.gradientSky) && done(block.cloudBottom?.file) && done(block.cloudTop?.file);
  }

  /** Load a block's gradient and clouds; resolves when each has loaded or failed. Each is uploaded as it arrives when a renderer is given. */
  ensureTextures(block: SkyBlock, renderer: THREE.WebGLRenderer | null): Promise<void> {
    if (renderer) this.renderer = renderer;
    const jobs: Promise<void>[] = [];
    if (block.gradientSky) jobs.push(this.loadTexture(block.gradientSky, 'gradient'));
    if (block.cloudBottom?.file) jobs.push(this.loadTexture(block.cloudBottom.file, 'cloud'));
    if (block.cloudTop?.file) jobs.push(this.loadTexture(block.cloudTop.file, 'cloud'));
    return Promise.all(jobs).then(() => undefined);
  }

  /** The blocks to blend this frame (count <= 4, weights summing to 1). Copies; allocates nothing. None at all keeps the default block. */
  setMix(blocks: readonly SkyBlock[], weights: ArrayLike<number>, count: number): void {
    const n = Math.min(MIX_MAX, count);
    if (n <= 0) {
      this.mix[0].block = this.defaultBlock;
      this.mix[0].weight = 1;
      this.mixCount = 1;
      return;
    }
    for (let i = 0; i < n; i++) {
      this.mix[i].block = blocks[i];
      this.mix[i].weight = weights[i];
    }
    this.mixCount = n;
  }

  /** Where the clouds drift toward (radians, 0 = +Z, turning toward +X). */
  setWind(heading: number): void {
    this.windHeading = heading;
  }

  /** Forget every cloud image's drift. */
  resetClouds(): void {
    this.cloudScroll.clear();
  }

  /** The heaviest block now, for the console, the environment map and the water's peak. */
  get heaviest(): SkyBlock {
    let best = this.mix[0];
    for (let i = 1; i < this.mixCount; i++) if (this.mix[i].weight > best.weight) best = this.mix[i];
    return best.block;
  }

  /** Load the pack's sky, or null when it has none. */
  static async load(pack: AssetPack): Promise<SwgSky | null> {
    const bytes = await pack.bytes('sky.json');
    if (!bytes) return null;
    let data: SkyData;
    try {
      data = JSON.parse(new TextDecoder().decode(bytes)) as SkyData;
    } catch {
      return null;
    }
    const files = new Set<string>();
    const block = data.blocks.find((b) => b.weatherIndex === 0) ?? data.blocks[0];
    if (block?.gradientSky) files.add(block.gradientSky);
    if (block?.cloudBottom?.file) files.add(block.cloudBottom.file);
    if (block?.cloudTop?.file) files.add(block.cloudTop.file);
    for (const c of [data.sun, data.supplementalSun, data.moon, data.supplementalMoon, ...data.celestials]) {
      if (c?.image?.file) files.add(c.image.file);
      if (c?.glowImage?.file) files.add(c.glowImage.file);
    }
    for (const f of Object.values(data.skybox?.sides ?? {})) if (f) files.add(f);
    for (const c of data.space?.celestials ?? []) if (c.image?.file) files.add(c.image.file);
    for (const f of data.skybox?.cube?.faces ?? []) if (f) files.add(f);
    const loader = new THREE.TextureLoader();
    const textures = new Map<string, THREE.Texture>();
    const failed = new Set<string>();
    await Promise.all(
      [...files].map(async (f) => {
        const t = await SwgSky.fetchTexture(loader, pack, f);
        if (t) textures.set(f, t);
        else {
          failed.add(f);
          console.warn(`sky: ${f} failed to load`);
        }
      }),
    );
    return new SwgSky(data, textures, pack, failed);
  }

  private rampBytes(block: SkyBlock): Uint8Array | null {
    if (!block.ramp) return null;
    let r = this.ramps.get(block);
    if (!r) {
      r = Uint8Array.from(atob(block.ramp.rgba), (ch) => ch.charCodeAt(0));
      this.ramps.set(block, r);
    }
    return r;
  }

  /** A ramp colour, weighted over the mix in linear light: each block reads its own bytes (the fallback where it has no such row). */
  private rampColor(row: number, index: number, out: THREE.Color, fallback: number): THREE.Color {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < this.mixCount; i++) {
      const e = this.mix[i];
      const bytes = this.rampBytes(e.block);
      if (!bytes || row >= e.block.ramp!.rows) tmpRampColor.setScalar(fallback);
      else {
        const o = (row * 256 + index) * 4;
        tmpRampColor.setRGB(bytes[o] / 255, bytes[o + 1] / 255, bytes[o + 2] / 255, THREE.SRGBColorSpace);
      }
      r += tmpRampColor.r * e.weight;
      g += tmpRampColor.g * e.weight;
      b += tmpRampColor.b * e.weight;
    }
    return out.setRGB(r, g, b);
  }

  /**
   * The brightest the clear colour gets over the whole day (the heaviest block's clear row), as
   * linear luminance; 0 without a ramp. A static reflection cube is dimmed against it at night, so
   * it cannot go on glowing with a daytime sheen. Computed once per block.
   */
  clearPeakLuminance(): number {
    const block = this.heaviest;
    const cached = this.clearPeaks.get(block);
    if (cached !== undefined) return cached;
    const r = this.rampBytes(block);
    let peak = 0;
    if (r && block.ramp!.rows > Row.Clear) {
      for (let i = 0; i < 256; i++) {
        const o = (Row.Clear * 256 + i) * 4;
        tmpRampColor.setRGB(r[o] / 255, r[o + 1] / 255, r[o + 2] / 255, THREE.SRGBColorSpace);
        peak = Math.max(peak, 0.2126 * tmpRampColor.r + 0.7152 * tmpRampColor.g + 0.0722 * tmpRampColor.b);
      }
    }
    this.clearPeaks.set(block, peak);
    return peak;
  }
  private readonly clearPeaks = new Map<SkyBlock, number>();

  private rampAlpha(row: number, index: number, fallback = 1): number {
    let a = 0;
    for (let i = 0; i < this.mixCount; i++) {
      const e = this.mix[i];
      const r = this.rampBytes(e.block);
      a += (!r || row >= e.block.ramp!.rows ? fallback : r[(row * 256 + index) * 4 + 3] / 255) * e.weight;
    }
    return a;
  }

  /** Light scale stored in a ramp row's alpha: 4 * (alpha - 128) / 128, weighted over the mix. */
  private rampScale(row: number, index: number): number {
    let s = 0;
    for (let i = 0; i < this.mixCount; i++) {
      const e = this.mix[i];
      const r = this.rampBytes(e.block);
      s += (!r || row >= e.block.ramp!.rows ? 1 : Math.max(0, (LIGHT_SCALE * (r[(row * 256 + index) * 4 + 3] - 128)) / 128)) * e.weight;
    }
    return s;
  }

  /** Place a sky body's sprites along a direction from the camera. */
  private place(sprites: THREE.Sprite[], dir: THREE.Vector3, alpha: number): void {
    for (const s of sprites) {
      s.position.copy(dir).multiplyScalar(SKY_RADIUS);
      s.material.opacity = alpha;
      // Below the horizon a body is behind the ground; in space there is no ground to be behind.
      s.visible = alpha > 0.002 && (dir.y > -0.3 || !!this.data.space);
    }
  }

  /**
   * Direction of a body the client places by yawing then pitching a frame and looking down its
   * -Z axis (pitch in radians, already including any cycle), in this engine's mirrored axes.
   */
  private static direction(yawDeg: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    return out.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw));
  }

  /** A direction turned by the client's yaw and pitch offsets (degrees), used for the supplemental bodies. */
  private static offset(dir: THREE.Vector3, yawDeg: number, pitchDeg: number, out: THREE.Vector3): THREE.Vector3 {
    const az = Math.atan2(dir.x, -dir.z) + THREE.MathUtils.degToRad(yawDeg);
    const el = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) + THREE.MathUtils.degToRad(pitchDeg), -Math.PI / 2, Math.PI / 2);
    return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }

  /**
   * Which ramp row feeds the ambient term. Row 0 is black at every hour on every planet, which
   * leaves everything in shadow unlit; rows 8 and 9 carry plausible per-planet light colours.
   * `__debug.ambient(row)` switches it so the rows can be compared against the original game.
   */
  ambientRow: number = Row.SkyAmbient;
  /** Which ramp row feeds the ground bounce (the hemisphere's lower half). */
  bounceRow: number = Row.GroundBounce;

  /** Advance the sky to the day cycle's moment and read this moment's lighting. */
  update(day: DayCycle, camPos: THREE.Vector3, dt: number): SkyLighting {
    this.time += dt;
    this.group.position.copy(camPos);
    const index = day.colorIndex;
    const t = day.normalized;
    const L = this.lighting;
    L.isDay = day.isDay;
    this.rampColor(this.ambientRow, index, L.ambient, 0.3);
    L.ambientScale = this.rampScale(this.ambientRow, index);
    this.rampColor(Row.MainDiffuse, index, L.main, 1);
    L.mainScale = this.rampScale(Row.MainDiffuse, index);
    this.rampColor(Row.Fill, index, L.fill, 0);
    L.fillScale = this.rampScale(Row.Fill, index);
    this.rampColor(this.bounceRow, index, L.bounce, 0);
    L.bounceScale = this.rampScale(this.bounceRow, index);
    this.rampColor(Row.Shadow, index, L.shadow, 0);
    this.rampColor(Row.Clear, index, L.clear, 0.5);
    this.rampColor(Row.Fog, index, L.fog, 0.5);
    L.sunMoonAlpha = this.rampAlpha(Row.Clear, index, 1);
    L.starAlpha = this.rampAlpha(Row.Fog, index, day.isDay ? 0 : 1);
    // Fog, shadows and wind blend over the mix like the colours.
    const farT = THREE.MathUtils.clamp((CLIENT_FAR_PLANE - 512) / (2048 - 512), 0, 1);
    let fogDensity = 0;
    let shadowScale = 0;
    let wind = 0;
    for (let i = 0; i < this.mixCount; i++) {
      const e = this.mix[i];
      const b = e.block;
      if (b.fog.enabled) fogDensity += THREE.MathUtils.lerp(b.fog.min, b.fog.max, farT) * e.weight;
      shadowScale += blockShadow(b.weatherIndex, b.shadows) * e.weight;
      wind += b.windSpeedScale * e.weight;
    }
    L.fogDensity = fogDensity;
    L.shadowScale = shadowScale;
    L.windSpeedScale = wind;
    // Reflections follow the heaviest block (World loads a cube by its first face).
    const heavy = this.heaviest;
    this.environment.day = heavy.dayEnvironment;
    this.environment.night = heavy.nightEnvironment;
    const space = this.data.space;
    if (space) {
      // The zone's own lights, as its terrain file gives them, at every hour: no day here.
      const main = space.lights[0];
      const second = space.lights[1];
      if (main) L.main.setRGB(main.diffuse[0], main.diffuse[1], main.diffuse[2], THREE.SRGBColorSpace);
      L.mainScale = 1;
      if (space.ambient) L.ambient.setRGB(space.ambient[0], space.ambient[1], space.ambient[2], THREE.SRGBColorSpace);
      L.ambientScale = 1;
      if (second) L.fill.setRGB(second.diffuse[0], second.diffuse[1], second.diffuse[2], THREE.SRGBColorSpace);
      L.fillScale = second ? 1 : 0;
      L.bounce.copy(L.ambient).multiplyScalar(0.6);
      L.bounceScale = 1;
      if (space.clear) L.clear.setRGB(space.clear[0], space.clear[1], space.clear[2], THREE.SRGBColorSpace);
      L.fog.copy(L.clear);
      L.fogDensity = 0;
      L.sunMoonAlpha = 0;
      L.starAlpha = 1;
      L.isDay = true;
      L.shadowScale = 1;
      L.windSpeedScale = 0;
    }

    const u = this.dome.material.uniforms;
    u.uTime.value = t;
    (u.uClear.value as THREE.Color).copy(L.clear);
    (u.uHorizonFog.value as THREE.Color).copy(L.fog);
    this.updateGradients();
    this.frameNo++;

    // The sun rides the main light by day, the moon by night; the other one waits below the horizon.
    const lightDir = day.lightDir;
    // The ramp's alpha fades the body around its rise and set; the disc itself stays until it
    // actually meets the horizon, then goes over the last few degrees.
    const alpha = Math.max(L.sunMoonAlpha, THREE.MathUtils.clamp(lightDir.y / 0.08, 0, 1));
    if (space) {
      // The environment file's sun and moon stay away: the zone's own star sprites are the suns here.
      this.place(this.sun, tmpVec2.set(0, -1, 0), 0);
      this.place(this.supplementalSun, tmpVec2, 0);
      this.place(this.moon, tmpVec2, 0);
      this.place(this.supplementalMoon, tmpVec2, 0);
    } else if (day.isDay) {
      this.place(this.sun, lightDir, alpha);
      if (this.data.supplementalSun) this.place(this.supplementalSun, SwgSky.offset(lightDir, this.data.supplementalSun.yaw, this.data.supplementalSun.pitch, tmpVec), alpha);
      this.place(this.moon, tmpVec2.set(0, -1, 0), 0);
      this.place(this.supplementalMoon, tmpVec2, 0);
    } else {
      this.place(this.moon, lightDir, alpha);
      if (this.data.supplementalMoon) this.place(this.supplementalMoon, SwgSky.offset(lightDir, this.data.supplementalMoon.yaw, this.data.supplementalMoon.pitch, tmpVec), alpha);
      this.place(this.sun, tmpVec2.set(0, -1, 0), 0);
      this.place(this.supplementalSun, tmpVec2, 0);
    }
    // Extra bodies: fixed in the sky, or circling once per cycle time (in the client's day seconds).
    const clientTime = day.ratio * CLIENT_DAY_SECONDS;
    for (const c of this.celestials) {
      const d = c.data;
      let pitch = THREE.MathUtils.degToRad(d.pitch ?? 45);
      if (d.cycleTime && d.cycleTime > 0) pitch += (d.pitchDirection ?? 1) * Math.PI * 2 * ((clientTime % d.cycleTime) / d.cycleTime);
      this.place(c.sprites, SwgSky.direction(d.yaw ?? 0, pitch, tmpVec), this.rampAlpha(Row.Ambient, index, 1));
    }
    if (this.stars) {
      (this.stars.material as THREE.PointsMaterial).opacity = L.starAlpha;
      this.stars.visible = L.starAlpha > 0.01;
    }
    // The dust stays where it is in the world as the camera (and the group) moves: each mote is
    // shifted back by the move, and one that falls out of the radius comes in on the far side.
    const dust = this.dust;
    if (dust) {
      if (dust.last) {
        const dx = camPos.x - dust.last.x;
        const dy = camPos.y - dust.last.y;
        const dz = camPos.z - dust.last.z;
        if (dx || dy || dz) {
          const a = dust.points.geometry.getAttribute('position') as THREE.BufferAttribute;
          const arr = a.array as Float32Array;
          const r = dust.radius;
          for (let i = 0; i < arr.length; i += 3) {
            arr[i] -= dx;
            arr[i + 1] -= dy;
            arr[i + 2] -= dz;
            if (Math.abs(arr[i]) > r) arr[i] -= Math.sign(arr[i]) * 2 * r;
            if (Math.abs(arr[i + 1]) > r) arr[i + 1] -= Math.sign(arr[i + 1]) * 2 * r;
            if (Math.abs(arr[i + 2]) > r) arr[i + 2] -= Math.sign(arr[i + 2]) * 2 * r;
          }
          a.needsUpdate = true;
        }
        dust.last.copy(camPos);
      } else dust.last = camPos.clone();
    }
    this.cloudGroup.position.set(camPos.x, 0, camPos.z);
    this.updateClouds(0, L, day.isDay, camPos, dt);
    this.updateClouds(1, L, day.isDay, camPos, dt);
    return L;
  }

  /**
   * The dome's two gradients: the mix grouped by gradient file (no gradient is a group of its own,
   * drawn as the clear colour), the two heaviest groups crossfaded. A gradient still loading counts
   * as the clear colour until it arrives, and its load is asked for.
   */
  private updateGradients(): void {
    const files = this.groupFiles;
    const w = this.groupWeights;
    let n = 0;
    for (let i = 0; i < this.mixCount; i++) {
      const e = this.mix[i];
      const f = e.block.gradientSky;
      let k = 0;
      while (k < n && files[k] !== f) k++;
      if (k === n) {
        files[n] = f;
        w[n] = 0;
        n++;
      }
      w[k] += e.weight;
    }
    const top = heaviestTwo(w, n, this.topTwo);
    const a = top[0];
    const b = top[1];
    const u = this.dome.material.uniforms;
    const ta = this.gradientTexture(a >= 0 ? files[a] : null);
    const tb = this.gradientTexture(b >= 0 ? files[b] : null);
    u.uGradient.value = ta ?? WHITE_TEX;
    u.uHasGradient.value = ta ? 1 : 0;
    u.uGradient2.value = tb ?? WHITE_TEX;
    u.uHasGradient2.value = tb ? 1 : 0;
    u.uGradientMix.value = b >= 0 && w[a] + w[b] > 0 ? w[b] / (w[a] + w[b]) : 0;
  }

  /** A gradient's texture when it is up; one still to come is asked for. */
  private gradientTexture(f: string | null): THREE.Texture | null {
    if (!f) return null;
    const t = this.textures.get(f);
    if (!t && !this.failedTextures.has(f) && !this.textureLoads.has(f)) void this.loadTexture(f, 'gradient');
    return t ?? null;
  }

  /**
   * One altitude's two sheets (slot 0 the lower, 1 the upper): the mix's cloud images there summed
   * by weight, the heaviest on the first sheet and the next on the second, each at its summed
   * weight. A block with no layer at this altitude adds nothing, so the clouds thin as a storm
   * without clouds comes in. Each image drifts by its own integrated scroll, so a wind that
   * strengthens speeds the clouds up without a jump, and two sheets swapping images keep theirs.
   */
  private updateClouds(slot: 0 | 1, L: SkyLighting, isDay: boolean, camPos: THREE.Vector3, dt: number): void {
    const files = this.groupFiles;
    const w = this.groupWeights;
    const layers = this.groupLayers;
    const lw = this.groupLayerWeights;
    let n = 0;
    for (let i = 0; i < this.mixCount; i++) {
      const e = this.mix[i];
      const layer = slot === 0 ? e.block.cloudBottom : e.block.cloudTop;
      if (!layer?.file || !(e.weight > 0)) continue;
      let k = 0;
      while (k < n && files[k] !== layer.file) k++;
      if (k === n) {
        files[n] = layer.file;
        w[n] = 0;
        layers[n] = layer;
        lw[n] = -1;
        n++;
      }
      w[k] += e.weight;
      // The image's repeat and speed come from the heaviest block that names it.
      if (e.weight > lw[k]) {
        lw[k] = e.weight;
        layers[k] = layer;
      }
    }
    const top = heaviestTwo(w, n, this.topTwo);
    const a = top[0];
    const b = top[1];
    for (let m = 0; m < 2; m++) {
      const c = this.clouds[slot * 2 + m];
      const u = c.mesh.material.uniforms;
      const k = m === 0 ? a : b;
      if (k < 0) {
        c.file = null;
        c.mesh.visible = false;
        u.uOpacity.value = 0;
        u.uMap.value = WHITE_TEX;
        continue;
      }
      const file = files[k]!;
      const layer = layers[k]!;
      c.file = file;
      const tex = this.textures.get(file);
      if (!tex) {
        // Still coming: nothing shows until it has arrived.
        if (!this.failedTextures.has(file) && !this.textureLoads.has(file)) void this.loadTexture(file, 'cloud');
        c.mesh.visible = false;
        u.uOpacity.value = 0;
        u.uMap.value = WHITE_TEX;
        continue;
      }
      const size = Math.max(1, layer.size || 8);
      let scroll = this.cloudScroll.get(file);
      if (!scroll) {
        scroll = { s: new THREE.Vector2(), at: -1 };
        this.cloudScroll.set(file, scroll);
      }
      if (scroll.at !== this.frameNo) {
        // Drift in texture repeats per second: the client's wind, but never quite still.
        scroll.at = this.frameNo;
        const perSecond = Math.max((layer.speed * L.windSpeedScale) / size, CLOUD_MIN_DRIFT);
        // Toward the wind's heading, as the rain leans and the dust blows.
        driftScroll(scroll.s, this.windHeading, perSecond, dt);
      }
      u.uMap.value = tex;
      u.uOpacity.value = w[k];
      u.uRepeat.value = size * (c.altitude / CLIENT_CLOUD_HEIGHT) * CLOUD_SIZE_TRIM;
      (u.uScroll.value as THREE.Vector2).copy(scroll.s);
      (u.uCamera.value as THREE.Vector3).copy(camPos);
      // White by day and grey by night in the client, lit by the main light's colour.
      (u.uColor.value as THREE.Color).copy(L.main).multiplyScalar(isDay ? 1 : 0.5);
      c.mesh.visible = w[k] > 0.002;
    }
  }

  /**
   * The glowing suns (in space, the brightest stars) as this frame's sky shows them, one fixed slot
   * each; fills `out` and returns the number of slots. A body not drawn this frame (below, hidden, a
   * night sun with nightSuns false) has alpha 0 and keeps its last direction. Reads the sprites as
   * place() (or, in space, the constructor) left them; allocates nothing.
   */
  flareLights(out: readonly FxSkyLight[], nightSuns = true): number {
    const n = Math.min(out.length, this.flareBodies.length);
    // Linear: the ramp's bytes are read as sRGB (rampColor).
    const main = this.lighting.main;
    const k = tintScale(main.r, main.g, main.b);
    for (let i = 0; i < n; i++) {
      const b = this.flareBodies[i];
      const o = out[i];
      let lit: THREE.Sprite | null = null;
      for (let j = 0; j < b.sprites.length; j++) {
        if (b.sprites[j].visible) {
          lit = b.sprites[j];
          break;
        }
      }
      // place() put it at dir x SKY_RADIUS in the camera-following group.
      if (lit) o.dir.copy(lit.position).multiplyScalar(1 / SKY_RADIUS);
      o.alpha = lit && this.group.visible && !(b.night && !nightSuns) ? lit.material.opacity : 0;
      o.discRadius = b.discRadius;
      o.glowRadius = b.glowRadius;
      o.weight = b.weight;
      o.star = b.star;
      o.skyDistance = SKY_RADIUS;
      if (b.color) o.color.copy(b.color);
      else o.color.copy(main).multiplyScalar(k);
    }
    return n;
  }

  /**
   * The procedural dome's suns for the lens flare, when a world has no converted sky: the dome
   * shader draws the sun at `sunDir` and, with two suns, a second one turned 0.12 rad about Y with
   * its height scaled by 0.8. The dome is drawn first and writes no depth, so anything drawn covers
   * it (skyDistance Infinity). Returns the number of slots; they stay, dark, at night.
   */
  static proceduralFlareLights(out: readonly FxSkyLight[], sunDir: THREE.Vector3, sunColor: THREE.Color, suns: number): number {
    const k = tintScale(sunColor.r, sunColor.g, sunColor.b);
    const n = Math.min(out.length, suns >= 2 ? 2 : 1);
    const alpha = THREE.MathUtils.smoothstep(sunDir.y, 0, 0.06);
    const c = Math.cos(0.12);
    const s = Math.sin(0.12);
    for (let i = 0; i < n; i++) {
      const o = out[i];
      // A turn about Y keeps the length, and the height scaled by 0.8 leaves a non-zero vector to normalise.
      if (i === 0) o.dir.copy(sunDir);
      else o.dir.set(sunDir.x * c + sunDir.z * s, sunDir.y * 0.8, -sunDir.x * s + sunDir.z * c).normalize();
      o.color.copy(sunColor).multiplyScalar(k);
      o.alpha = alpha;
      o.discRadius = PROCEDURAL_DISC;
      o.glowRadius = PROCEDURAL_GLOW;
      o.weight = i === 0 ? 1 : 0.9;
      o.star = false;
      o.skyDistance = Infinity;
    }
    return n;
  }

  private cloudOpacity(i: number): number {
    return this.clouds[i].mesh.material.uniforms.uOpacity.value as number;
  }

  /** The cloud sheets drawn this frame, heaviest first (hidden or empty ones skipped), up to out.length; returns how many. Allocates nothing. */
  cloudLayers(out: readonly FxCloudLayer[]): number {
    if (!this.cloudGroup.visible) return 0;
    // The pool's sheets by opacity, heaviest first (an insertion sort of four kept indices).
    const order = this.cloudOrder;
    for (let i = 0; i < order.length; i++) order[i] = i;
    for (let i = 1; i < order.length; i++) {
      const k = order[i];
      const ok = this.cloudOpacity(k);
      let j = i - 1;
      while (j >= 0 && this.cloudOpacity(order[j]) < ok) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = k;
    }
    let n = 0;
    for (let i = 0; i < order.length && n < out.length; i++) {
      const mesh = this.clouds[order[i]].mesh;
      const u = mesh.material.uniforms;
      const tex = u.uMap.value as THREE.Texture | null;
      const opacity = u.uOpacity.value as number;
      if (!mesh.visible || !tex || !(opacity > 0.002)) continue;
      const o = out[n++];
      o.texture = tex;
      // The cloud group sits at y 0, so a sheet's own height is its altitude.
      o.altitude = mesh.position.y;
      o.repeat = u.uRepeat.value as number;
      o.scroll.copy(u.uScroll.value as THREE.Vector2);
      o.opacity = Math.min(1, opacity);
      o.fade.copy(u.uFade.value as THREE.Vector2);
      o.texels = (tex.image as { width?: number } | null)?.width ?? 256;
    }
    return n;
  }

  /** What the sky is made of, for the console; naming a part toggles it, to see what each contributes. */
  describe(toggle?: 'dome' | 'skybox' | 'stars' | 'dust' | 'sprites'): Record<string, unknown> {
    const sprites = [...this.sun, ...this.supplementalSun, ...this.moon, ...this.supplementalMoon, ...this.celestials.flatMap((c) => c.sprites)];
    if (toggle === 'dome') this.dome.visible = !this.dome.visible;
    if (toggle === 'skybox' && this.skybox) this.skybox.visible = !this.skybox.visible;
    if (toggle === 'stars' && this.stars) this.stars.visible = !this.stars.visible;
    if (toggle === 'dust' && this.dust) this.dust.points.visible = !this.dust.points.visible;
    if (toggle === 'sprites') for (const s of this.group.children) if (s instanceof THREE.Sprite) s.visible = !s.visible;
    const faces = this.skybox ? this.skybox.children.map((m) => {
      const map = ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).map;
      const img = map?.image as { width?: number; height?: number } | undefined;
      return `${img?.width ?? '?'}x${img?.height ?? '?'}${m.visible ? '' : ' hidden'}`;
    }) : [];
    const du = this.dome.material.uniforms;
    const gradientName = (tex: unknown, on: number) => {
      if (!on) return null;
      for (const [f, t] of this.textures) if (t === tex) return f;
      return null;
    };
    const mix: string[] = [];
    for (let i = 0; i < this.mixCount; i++) mix.push(`${this.mix[i].block.name} w${this.mix[i].block.weatherIndex} ${this.mix[i].weight.toFixed(2)}`);
    const clouds = this.clouds.filter((c) => c.mesh.visible && c.file).map((c) => `${c.altitude === CLOUD_ALTITUDES[0] ? 'bottom' : 'top'} ${c.file!.replace(/^.*\//, '').replace(/\.\w+$/, '')} ${(c.mesh.material.uniforms.uOpacity.value as number).toFixed(2)}`);
    return {
      mix,
      gradients: [gradientName(du.uGradient.value, du.uHasGradient.value as number), gradientName(du.uGradient2.value, du.uHasGradient2.value as number), Number((du.uGradientMix.value as number).toFixed(2))],
      clouds,
      shadows: Number(this.lighting.shadowScale.toFixed(2)),
      wind: Number(this.lighting.windSpeedScale.toFixed(2)),
      dome: this.dome.visible,
      skybox: this.skybox ? `${faces.length} faces: ${faces.join(', ')}${this.skybox.visible ? '' : ' (hidden)'}` : 'none',
      stars: this.stars ? `${(this.stars.geometry.getAttribute('position') as THREE.BufferAttribute).count}${this.stars.visible ? '' : ' hidden'}` : 'none',
      dust: this.dust ? `${(this.dust.points.geometry.getAttribute('position') as THREE.BufferAttribute).count} within ${this.dust.radius} m${this.dust.points.visible ? '' : ' hidden'}` : 'none',
      sprites: `${sprites.length}, ${this.group.children.filter((s) => s instanceof THREE.Sprite && s.visible).length} visible`,
      spaceLight: this.spaceLightDir ? this.spaceLightDir.toArray().map((v) => Number(v.toFixed(2))) : null,
      flare: this.flareBodies.map((b, slot) => ({ slot, star: b.star, night: b.night, weight: Number(b.weight.toFixed(2)), sprites: b.sprites.length, visible: b.sprites.some((s) => s.visible), discDeg: Number(THREE.MathUtils.radToDeg(b.discRadius).toFixed(2)), glowDeg: Number(THREE.MathUtils.radToDeg(b.glowRadius).toFixed(2)) })),
      lighting: { main: `#${this.lighting.main.getHexString()} x${this.lighting.mainScale.toFixed(2)}`, ambient: `#${this.lighting.ambient.getHexString()} x${this.lighting.ambientScale.toFixed(2)}`, clear: `#${this.lighting.clear.getHexString()}`, fog: this.lighting.fogDensity },
    };
  }

  dispose(scene: THREE.Scene): void {
    // A texture still loading is thrown away when it lands.
    this.disposed = true;
    scene.remove(this.group, this.cloudGroup);
    for (const c of this.clouds) {
      c.mesh.geometry.dispose();
      c.mesh.material.dispose();
    }
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
      if (o instanceof THREE.Sprite) o.material.dispose();
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) (o.material as THREE.Material).dispose();
    });
    for (const t of this.textures.values()) t.dispose();
  }
}
