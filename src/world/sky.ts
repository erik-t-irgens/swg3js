import * as THREE from 'three';
import type { AssetPack } from './assetPack';
import type { DayCycle } from './daycycle';

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
interface CloudLayer {
  file: string;
  size: number;
  speed: number;
}
interface CubeFaces {
  faces: string[];
  size: number;
}
interface SkyBlock {
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
  blocks: SkyBlock[];
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
  uniform float uTime;
  uniform float uHasGradient;
  uniform vec3 uClear;
  uniform vec3 uHorizonFog;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 0.999);
    vec3 col = uHasGradient > 0.5 ? texture2D(uGradient, vec2(uTime, up)).rgb : uClear;
    // Below the horizon the ground normally hides the dome; fade the last strip into the fog.
    col = mix(uHorizonFog, col, smoothstep(-0.03, 0.0, d.y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

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
  private readonly stars: THREE.Points | null = null;
  /** Cloud sheets live outside the camera-following group: their altitude is fixed in the world. */
  readonly cloudGroup = new THREE.Group();
  private readonly clouds: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; layer: CloudLayer; altitude: number }[] = [];
  private readonly ramps = new Map<SkyBlock, Uint8Array>();
  private block: SkyBlock;
  private time = 0;
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
  };
  /** The cube map faces (already in this engine's handedness) the block names for reflections, by day and night. */
  readonly environment: { day: CubeFaces | null; night: CubeFaces | null };
  readonly hasGradient: boolean;

  private constructor(
    readonly data: SkyData,
    private readonly textures: Map<string, THREE.Texture>,
  ) {
    this.block = data.blocks.find((b) => b.weatherIndex === 0) ?? data.blocks[0] ?? { name: '_default', weatherIndex: 0, gradientSky: null, cloudBottom: null, cloudTop: null, ramp: null, shadows: true, fog: { enabled: false, min: 0, max: 0 }, dayEnvironment: null, nightEnvironment: null, windSpeedScale: 1 };
    this.environment = { day: this.block.dayEnvironment, night: this.block.nightEnvironment };
    const gradient = this.block.gradientSky ? textures.get(this.block.gradientSky) ?? null : null;
    this.hasGradient = !!gradient;
    if (gradient) {
      // Columns wrap with the day; rows must not, or the zenith would wrap round to the horizon colour.
      gradient.wrapS = THREE.RepeatWrapping;
      gradient.wrapT = THREE.ClampToEdgeWrapping;
      gradient.needsUpdate = true;
    }

    // The dome: the gradient sky, or the ramp's clear colour when the planet has a skybox instead.
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS * 1.6, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        uniforms: {
          uGradient: { value: gradient },
          uTime: { value: 0 },
          uHasGradient: { value: gradient ? 1 : 0 },
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

    // Stars: the client scatters `count` points and colours them from a small ramp image.
    if (data.stars && data.stars.count > 0) {
      const n = Math.min(data.stars.count, 6000);
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const palette = data.stars.colors ? Uint8Array.from(atob(data.stars.colors.rgba), (ch) => ch.charCodeAt(0)) : null;
      let seed = 1234567;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < n; i++) {
        const y = rnd() * 0.98 + 0.02;
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

    // Cloud layers: wide sheets at fixed altitudes, fading out long before their edges.
    const cloud = (layer: CloudLayer | null, altitude: number) => {
      const tex = layer ? textures.get(layer.file) : null;
      if (!layer || !tex) return;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const mat = new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uMap: { value: tex },
          uColor: { value: new THREE.Color(1, 1, 1) },
          uOpacity: { value: 1 },
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
      this.cloudGroup.add(mesh);
      this.clouds.push({ mesh, layer, altitude });
    };
    cloud(this.block.cloudBottom, CLOUD_ALTITUDES[0]);
    cloud(this.block.cloudTop, CLOUD_ALTITUDES[1]);
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
    const loader = new THREE.TextureLoader();
    const textures = new Map<string, THREE.Texture>();
    await Promise.all(
      [...files].map(async (f) => {
        try {
          const t = await loader.loadAsync(pack.url(f));
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          textures.set(f, t);
        } catch {
          console.warn(`sky: ${f} failed to load`);
        }
      }),
    );
    return new SwgSky(data, textures);
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

  private rampColor(row: number, index: number, out: THREE.Color, fallback: number): THREE.Color {
    const r = this.rampBytes(this.block);
    if (!r || row >= this.block.ramp!.rows) return out.setScalar(fallback);
    const o = (row * 256 + index) * 4;
    return out.setRGB(r[o] / 255, r[o + 1] / 255, r[o + 2] / 255, THREE.SRGBColorSpace);
  }

  private rampAlpha(row: number, index: number, fallback = 1): number {
    const r = this.rampBytes(this.block);
    if (!r || row >= this.block.ramp!.rows) return fallback;
    return r[(row * 256 + index) * 4 + 3] / 255;
  }

  /** Light scale stored in a ramp row's alpha: 4 * (alpha - 128) / 128. */
  private rampScale(row: number, index: number): number {
    const r = this.rampBytes(this.block);
    if (!r || row >= this.block.ramp!.rows) return 1;
    return Math.max(0, (LIGHT_SCALE * (r[(row * 256 + index) * 4 + 3] - 128)) / 128);
  }

  /** Place a sky body's sprites along a direction from the camera. */
  private place(sprites: THREE.Sprite[], dir: THREE.Vector3, alpha: number): void {
    for (const s of sprites) {
      s.position.copy(dir).multiplyScalar(SKY_RADIUS);
      s.material.opacity = alpha;
      s.visible = alpha > 0.002 && dir.y > -0.3;
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
    const fog = this.block.fog;
    L.fogDensity = fog.enabled ? THREE.MathUtils.lerp(fog.min, fog.max, THREE.MathUtils.clamp((CLIENT_FAR_PLANE - 512) / (2048 - 512), 0, 1)) : 0;

    const u = this.dome.material.uniforms;
    u.uTime.value = t;
    (u.uClear.value as THREE.Color).copy(L.clear);
    (u.uHorizonFog.value as THREE.Color).copy(L.fog);

    // The sun rides the main light by day, the moon by night; the other one waits below the horizon.
    const lightDir = day.lightDir;
    // The ramp's alpha fades the body around its rise and set; the disc itself stays until it
    // actually meets the horizon, then goes over the last few degrees.
    const alpha = Math.max(L.sunMoonAlpha, THREE.MathUtils.clamp(lightDir.y / 0.08, 0, 1));
    if (day.isDay) {
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
    this.cloudGroup.position.set(camPos.x, 0, camPos.z);
    for (const c of this.clouds) {
      const u = c.mesh.material.uniforms;
      const scale = (c.altitude / CLIENT_CLOUD_HEIGHT) * CLOUD_SIZE_TRIM;
      const repeat = Math.max(1, c.layer.size || 8) * scale;
      u.uRepeat.value = repeat;
      // Drift in texture repeats per second: the client's wind, but never quite still.
      const perSecond = Math.max((c.layer.speed * this.block.windSpeedScale) / Math.max(1, c.layer.size || 8), CLOUD_MIN_DRIFT);
      const drift = this.time * perSecond;
      (u.uScroll.value as THREE.Vector2).set(drift, drift * 0.35);
      (u.uCamera.value as THREE.Vector3).copy(camPos);
      // White by day and grey by night in the client, lit by the main light's colour.
      (u.uColor.value as THREE.Color).copy(L.main).multiplyScalar(day.isDay ? 1 : 0.5);
      u.uOpacity.value = 1;
    }
    return L;
  }

  dispose(scene: THREE.Scene): void {
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
