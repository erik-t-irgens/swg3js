import * as THREE from 'three';
import type { AssetPack } from './assetPack';
import type { PlanetDef } from '../data/planets';
import { currentEnvironment, onEnvironment } from './envmap';
import { createWaterMaskMaterial, createWaterMaterial, setWaterEnvSpecular, WATER_FX_FOG, WATER_FX_TRACED, waveReach, type WaterMaterial } from './water';
import { readWaterPack, waterLookFor, type WaterLook, type WaterPackData } from './waterLook';
import { sortByDraw, WaterVisibility, type WaterDrawKey, type WaterVisibilityState } from './waterVisibility';

/**
 * Every water surface in the world, with the look its terrain shader asks for and the environment
 * it reflects, and the one decision each frame about whether the effects' reflections take the
 * water's environment term over.
 *
 * The environment is the awkward part: `envMapCubeUVHeight` is in three's program cache key, so a
 * body whose environment changes height recompiles its shader mid-play. Every environment a body
 * can see is therefore filtered from a 128 px cube (a PMREM 512 high): the planet packs' sky maps,
 * this planet's own water cubes, the procedural dome, and a black stand-in every body carries from
 * the moment it exists, so the first real map to arrive swaps a texture and nothing more.
 */
export type WaterRole = 'seaNear' | 'seaFar' | 'lake';
export type WaterEnvMode = 'sky' | 'shader';

/** The PMREM height every environment a water body may see is filtered to (4 x a 128 px cube). */
export const WATER_ENV_HEIGHT = 512;
const WATER_CUBE_SIZE = 128;
/** The water's authored reflection strength, which `setEnvironment`'s flat 1 used to overwrite. */
const WATER_ENV_INTENSITY = 0.55;
/** FogExp2 hides 99.5 % of a surface where (density x z)^2 = ln 200; nothing beyond that is worth a reflection. */
const FOG_HIDDEN = 2.302;
// A lake's own reach moved to waterLineMath.ts's WATER_LINE_TUNE with the rest of the surface line,
// when "am I under water" became one answer that World gives and this class is told.

export interface WaterBody {
  /** In world.scene, layer 0, drawn with `lit`. */
  readonly mesh: THREE.Mesh;
  readonly lit: WaterMaterial;
  /**
   * The mask twins, back faces then front faces: in `maskScene`, the same geometry drawn with
   * `masks`, placed from `mesh` each frame. Two one-sided twins draw exactly what three draws for
   * the double-sided lit water, back faces then front faces, without flipping a material's side
   * (and looking its program up again) twice every draw.
   */
  readonly twins: readonly [THREE.Mesh, THREE.Mesh];
  readonly masks: readonly [WaterMaterial, WaterMaterial];
  /** Where three's transparent list put `mesh` this frame; `syncTwins` refreshes it and orders the twins by it. */
  readonly key: WaterDrawKey;
  readonly role: WaterRole;
  look: WaterLook;
  /** Local-space bounds: the geometry's box grown by the swell's reach up and down (0 for lakes and the far ring). */
  readonly bounds: THREE.Box3;
  /** In the camera's frustum and within the fog's reach this frame (set by beginFrame). */
  inFrustum: boolean;
}

export interface WaterBodyDescription {
  name: string;
  role: WaterRole;
  shader: string | null;
  source: WaterLook['source'];
  color: string;
  opacity: number;
  ripple: number;
  drift: number;
  env: string;
  envHeight: number | null;
  inFrustum: boolean;
  centre: [number, number] | null;
  height: number;
}

export interface WaterFxDescription {
  planet: string;
  pack: boolean;
  data: boolean;
  envMode: WaterEnvMode;
  envIntensity: number;
  envLight: number;
  swell: number;
  active: boolean;
  inFrustum: boolean;
  inView: boolean;
  visibility: { state: WaterVisibilityState; age: number };
  underwater: boolean;
  wanted: boolean;
  bodies: WaterBodyDescription[];
  lava: number;
  cubes: number;
  /** How many bodies the effects' water mask drew (each as its two twins) in the last whole frame (0 while it did not run). */
  twinsDrawnLastFrame: number;
  notes: string[];
}

const frustum = new THREE.Frustum();
const tmpM = new THREE.Matrix4();
const tmpBox = new THREE.Box3();
const tmpV = new THREE.Vector3();
const tmpV4 = new THREE.Vector4();
const tmpProj = new THREE.Matrix4();

export class WaterBodies {
  private readonly list: WaterBody[] = [];
  /** The pack's water.json, or null (absent, or it did not parse). */
  data: WaterPackData | null = null;
  /** Which map every body reflects: the area's sky map, or each shader's own cube. */
  envMode: WaterEnvMode = 'sky';
  /** The water's authored reflection strength. */
  envIntensity = WATER_ENV_INTENSITY;
  /** 0.12..1: how bright a per-shader cube may be at this hour. Applied only in 'shader' mode. */
  envLight = 1;
  /** How many lava tables the world holds, for the description; World sets it. */
  lavaTables = 0;
  readonly visibility = new WaterVisibility();
  /**
   * The water's twins and nothing else, drawn by the effects' water mask and by the visibility
   * probe: no lights (their count is in every program's key), no fog, no background, and no matrix
   * updates, since each twin takes its mesh's world matrix as the portal renderer left it.
   */
  readonly maskScene = new THREE.Scene();
  /** The probe's material: draws nothing at all (no colour, depth or stencil writes), so only the query sees it. */
  readonly probeMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: true, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide, fog: false });
  /** Decided in beginFrame; read-only outside. */
  inFrustum = false;
  inView = false;
  underwater = false;
  wanted = false;
  active = false;

  private renderer: THREE.WebGLRenderer | null = null;
  /** What the probe draws with, kept in fields so the kept closure below allocates nothing. */
  private probeRenderer: THREE.WebGLRenderer | null = null;
  private probeCamera: THREE.PerspectiveCamera | null = null;
  private probeTarget: THREE.WebGLRenderTarget | null = null;
  private readonly maskList: THREE.Material[] = [];
  /** The bodies in the frustum this frame, in the lit water's draw order (the first `syncTwins` result). */
  private readonly drawList: WaterBody[] = [];
  private twinsThisFrame = 0;
  private twinsLastFrame = 0;
  private standIn: THREE.Texture | null = null;
  private pack: AssetPack | null = null;
  /** Filtered per-shader cubes of the pack in place, keyed by the cube's first face. */
  private readonly cubes = new Map<string, THREE.Texture>();
  private cubesFor: AssetPack | null = null;
  private readonly unsubscribe: () => void;
  private nearSwell = 0;
  private readonly warned = new Set<string>();
  private readonly notes: string[] = [];
  private planetId = '';

  constructor() {
    // A new sky map reaches every body that is not reflecting its own cube.
    this.unsubscribe = onEnvironment(() => {
      for (const b of this.list) this.assignEnvironment(b);
    });
    this.maskScene.name = 'water:mask';
    this.maskScene.matrixAutoUpdate = false;
    this.maskScene.matrixWorldAutoUpdate = false;
  }

  get bodies(): readonly WaterBody[] {
    return this.list;
  }

  /** The near sea's swell reach in metres (0 without a sea). */
  get swell(): number {
    return this.nearSwell;
  }

  /**
   * The renderer that filters environments and owns the GL context. Called by main right after
   * `world.renderer` is set, before any `World.load`.
   */
  attach(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) return;
    this.renderer = renderer;
    const gl = renderer.getContext();
    if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) this.visibility.attach(gl);
    this.standIn?.dispose();
    this.standIn = makeBlackEnvironment(renderer);
    for (const b of this.list) this.assignEnvironment(b);
  }

  /** Read the pack's water.json into `data` (null when absent or unparsable); in 'shader' mode also filter its cubes. */
  async load(pack: AssetPack | null, planetId = ''): Promise<void> {
    this.data = null;
    this.notes.length = 0;
    this.planetId = planetId;
    this.disposeCubes();
    this.pack = pack;
    if (!pack) return;
    const bytes = await pack.bytes('water.json');
    // A travel can start another planet's load while this fetch is in flight, and World.loadPack is
    // written for exactly that. Without this the later planet's look is overwritten by the earlier's.
    if (this.pack !== pack) return;
    if (!bytes) {
      this.warn('water: no water.json in this pack (reconvert: npm run swg -- water @SWG all assets-private --retail-only); the planet\'s colours are used');
      return;
    }
    try {
      this.data = readWaterPack(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      this.data = null;
    }
    if (!this.data) {
      this.warn('water: water.json does not parse; the planet\'s colours are used (reconvert: npm run swg -- water @SWG all assets-private --retail-only)');
      return;
    }
    this.notes.push(...this.data.notes);
    if (this.envMode === 'shader') await this.ensureCubes();
  }

  /** The look of a body drawn with `shader` on this planet. */
  lookFor(shader: string | null, planet: PlanetDef | null): WaterLook {
    return waterLookFor(shader, this.data, planet?.water ?? null);
  }

  /** Make the lit and mask materials for a mesh, assign the lit one, add the twins, and keep the mesh as a body. */
  add(mesh: THREE.Mesh, waves: boolean, look: WaterLook, role: WaterRole): WaterBody {
    const lit = createWaterMaterial(look, waves);
    mesh.material = lit;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = new THREE.Box3().copy(mesh.geometry.boundingBox!);
    if (role === 'seaNear') {
      this.nearSwell = waveReach(lit);
      bounds.min.y -= this.nearSwell;
      bounds.max.y += this.nearSwell;
    }
    const masks = [createWaterMaskMaterial(lit, THREE.BackSide), createWaterMaskMaterial(lit, THREE.FrontSide)] as const;
    const twins = [this.makeTwin(mesh, masks[0], 'back'), this.makeTwin(mesh, masks[1], 'front')] as const;
    this.maskList.push(masks[0], masks[1]);
    const body: WaterBody = { mesh, lit, twins, masks, key: { group: 0, order: 0, z: 0, id: mesh.id }, role, look, bounds, inFrustum: false };
    this.list.push(body);
    this.assignEnvironment(body);
    return body;
  }

  private makeTwin(mesh: THREE.Mesh, mask: WaterMaterial, side: string): THREE.Mesh {
    const twin = new THREE.Mesh(mesh.geometry, mask);
    twin.name = `mask:${side}:${mesh.name}`;
    twin.matrixAutoUpdate = false;
    twin.matrixWorldAutoUpdate = false;
    twin.frustumCulled = mesh.frustumCulled;
    twin.visible = false;
    this.maskScene.add(twin);
    return twin;
  }

  /** Give a body a new look (the pack arrived after the procedural sea was made). Uniforms and textures only. */
  restyle(body: WaterBody, look: WaterLook): void {
    body.look = look;
    for (const m of [body.lit, ...body.masks]) {
      m.color.set(look.color);
      m.opacity = look.opacity;
      m.userData.look = look;
    }
    // The uniform objects are shared by the lit material and its mask.
    body.lit.userData.uniforms.uRipple.value = look.ripple;
    body.lit.userData.uniforms.uDrift.value = look.drift;
    this.assignEnvironment(body);
  }

  /** Forget one mesh's body: its twin out of the mask scene, its materials disposed. No-op for a mesh that has none. */
  remove(mesh: THREE.Mesh): void {
    const i = this.list.findIndex((b) => b.mesh === mesh);
    if (i < 0) return;
    this.forgetBody(this.list[i]);
    this.list.splice(i, 1);
    // Rebuilt by the next syncTwins; emptied now so it holds no forgotten body.
    this.drawList.length = 0;
  }

  /** Forget every body and the pack's cube environments. Meshes and geometry are the world's to remove. */
  clear(): void {
    for (const b of this.list) this.forgetBody(b);
    this.list.length = 0;
    this.drawList.length = 0;
    this.twinsThisFrame = this.twinsLastFrame = 0;
    this.disposeCubes();
    this.pack = null;
    this.data = null;
    this.nearSwell = 0;
    this.lavaTables = 0;
    this.notes.length = 0;
    // The dedupe is per planet, not per app: the next pack without a water.json must say so too,
    // both in the console and in describe().notes.
    this.warned.clear();
    this.inFrustum = this.inView = this.underwater = this.wanted = this.active = false;
    this.visibility.invalidate();
  }

  /** Give every body its environment and intensity again (after `envIntensity` or `envLight` changed). */
  refresh(): void {
    for (const b of this.list) this.assignEnvironment(b);
  }

  /** Switch every body's environment source; 'shader' filters the pack's cubes first. Never recompiles. */
  async setEnvMode(mode: WaterEnvMode): Promise<void> {
    this.envMode = mode;
    if (mode === 'shader') await this.ensureCubes();
    for (const b of this.list) this.assignEnvironment(b);
  }

  /**
   * Once a frame, before the scene is drawn: which bodies are worth drawing, whether any water is
   * really on screen, and therefore whether the effects' reflections take the environment term over
   * this frame. `underwater` is `World.cameraUnderwaterAt`'s conservative answer -- the shared one,
   * with the swell's reach and its hysteresis in it -- rather than a height test of this class's own.
   * Returns `inView`. Allocates nothing.
   */
  beginFrame(camera: THREE.PerspectiveCamera, underwater: boolean, fogDensity: number, wanted: boolean): boolean {
    this.visibility.poll();
    tmpM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(tmpM);
    const reach = fogDensity > 0 ? FOG_HIDDEN / fogDensity : Infinity;
    let any = false;
    for (const b of this.list) {
      tmpBox.copy(b.bounds).translate(b.mesh.position);
      b.inFrustum = b.mesh.visible && frustum.intersectsBox(tmpBox) && tmpBox.distanceToPoint(camera.position) < reach;
      any ||= b.inFrustum;
    }
    // The next water to enter an empty view counts as visible until a query says otherwise.
    if (!any) this.visibility.invalidate();
    this.inFrustum = any;
    this.inView = any && this.visibility.state !== 'hidden';
    // Told, not worked out: within the swell's reach of the surface a crest can pass over the
    // camera, and there are no reflections there.
    this.underwater = underwater;
    this.wanted = wanted;
    this.active = wanted && this.inView && !this.underwater;
    setWaterEnvSpecular(this.active ? 0 : 1);
    // The mask fades what it writes as the lit water is fogged, and gives a traced colour the
    // water's own strength, without the night factor a static cube needs: a traced colour is
    // already the night scene.
    WATER_FX_FOG.value = fogDensity;
    WATER_FX_TRACED.value = this.envIntensity;
    for (const b of this.list) {
      const k = this.intensityFor(b);
      b.lit.envMapIntensity = k;
      b.masks[0].envMapIntensity = k;
      b.masks[1].envMapIntensity = k;
    }
    this.twinsLastFrame = this.twinsThisFrame;
    this.twinsThisFrame = 0;
    return this.inView;
  }

  /**
   * After the scene is drawn with `camera`: every twin takes its mesh's world matrix (the portal
   * renderer has just refreshed them) and is drawn only where its body was found in the frustum,
   * and the drawn ones are given render orders that repeat the lit water's order: body by body as
   * three's transparent list drew the lit meshes, each body's back twin just before its front twin.
   * Returns how many bodies are drawn. Allocates nothing.
   */
  syncTwins(camera: THREE.Camera): number {
    tmpProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const order = this.drawList;
    let n = 0;
    for (const b of this.list) {
      const back = b.twins[0];
      const front = b.twins[1];
      back.matrixWorld.copy(b.mesh.matrixWorld);
      front.matrixWorld.copy(b.mesh.matrixWorld);
      back.visible = front.visible = b.inFrustum;
      if (!b.inFrustum) continue;
      readDrawKey(b.mesh, tmpProj, b.key);
      order[n++] = b;
    }
    sortByDraw(order, n);
    for (let i = 0; i < n; i++) {
      order[i].twins[0].renderOrder = 2 * i;
      order[i].twins[1].renderOrder = 2 * i + 1;
    }
    return n;
  }

  /** The effects' water mask drew `n` twins this frame (for the description). */
  maskDrawn(n: number): void {
    this.twinsThisFrame = n;
  }

  /**
   * Ask whether any water in the frustum shows: the twins drawn flat with `probeMaterial` into
   * `target`, which holds the finished frame's depth and stencil, inside an occlusion query. Nothing
   * is written. Answered a frame or more later, through `beginFrame`. Returns whether it drew.
   */
  probe(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget): boolean {
    if (!this.inFrustum) return false;
    this.syncTwins(camera);
    this.probeRenderer = renderer;
    this.probeCamera = camera;
    this.probeTarget = target;
    try {
      return this.visibility.measure(this.drawProbe);
    } finally {
      this.probeRenderer = null;
      this.probeCamera = null;
      this.probeTarget = null;
    }
  }

  /** Made once, so a probe allocates nothing. */
  private readonly drawProbe = (): void => {
    const r = this.probeRenderer!;
    const cam = this.probeCamera!;
    r.setRenderTarget(this.probeTarget);
    const layers = cam.layers.mask;
    // The portal renderer leaves whichever layer its last pass drew; the water is on layer 0.
    cam.layers.set(0);
    this.maskScene.overrideMaterial = this.probeMaterial;
    // The probe material is double-sided, so one twin a body covers the surface: the back twins
    // sit this one out rather than draw every body's geometry twice.
    for (const b of this.list) b.twins[0].visible = false;
    try {
      r.render(this.maskScene, cam);
    } finally {
      for (const b of this.list) b.twins[0].visible = b.inFrustum;
      this.maskScene.overrideMaterial = null;
      cam.layers.mask = layers;
    }
  };

  /** Every mask material, so the effects can set their stencil for the frame. A kept array. */
  maskMaterials(): readonly THREE.Material[] {
    return this.maskList;
  }

  /**
   * Objects to compile the mask and probe programs with before play: one per program the bodies of
   * this planet will draw (each side of the mask is its own program), on each body's own geometry
   * (its attributes are in the key), visible and outside any scene so a compile finds them. The
   * probe is compiled against the same geometries.
   */
  warmObjects(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const seen = new Set<string>();
    for (const b of this.list) {
      const attrs = Object.keys(b.mesh.geometry.attributes).sort().join(',');
      for (const mask of b.masks) {
        const key = `${mask.customProgramCacheKey()}|${mask.side}|${attrs}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const twin = new THREE.Mesh(b.mesh.geometry, mask);
        twin.frustumCulled = false;
        out.push(twin);
      }
      if (seen.has(`probe|${attrs}`)) continue;
      seen.add(`probe|${attrs}`);
      const probe = new THREE.Mesh(b.mesh.geometry, this.probeMaterial);
      probe.frustumCulled = false;
      out.push(probe);
    }
    return out;
  }

  describe(camera: THREE.Vector3): WaterFxDescription {
    const bodies = this.list.map<WaterBodyDescription>((b) => {
      const own = this.ownCube(b);
      const geo = b.mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const box = geo.boundingBox!;
      return {
        name: b.mesh.name,
        role: b.role,
        shader: b.look.shader,
        source: b.look.source,
        color: b.look.color,
        opacity: b.look.opacity,
        ripple: b.look.ripple,
        drift: b.look.drift,
        env: own ? b.look.cube![0] : this.skyEnvironment() === this.standIn ? 'stand-in' : 'sky',
        envHeight: envHeightOf(b.lit.envMap),
        inFrustum: b.inFrustum,
        centre: b.role === 'lake' ? meanXZ(b.mesh) : null,
        height: b.mesh.position.y + (box.min.y + box.max.y) / 2,
      };
    });
    // Sort a lake list by how near it is, so the one being looked at is at the top.
    bodies.sort((a, z) => distanceTo(camera, a) - distanceTo(camera, z));
    const notes = [...this.notes];
    for (const b of bodies) if (b.envHeight !== null && b.envHeight !== WATER_ENV_HEIGHT) notes.push(`${b.name}: its environment is ${b.envHeight} high, not ${WATER_ENV_HEIGHT}; a swap will recompile it`);
    return {
      planet: this.planetId,
      pack: !!this.pack,
      data: !!this.data,
      envMode: this.envMode,
      envIntensity: this.envIntensity,
      envLight: this.envLight,
      swell: this.nearSwell,
      active: this.active,
      inFrustum: this.inFrustum,
      inView: this.inView,
      visibility: { state: this.visibility.state, age: this.visibility.age },
      underwater: this.underwater,
      wanted: this.wanted,
      bodies,
      lava: this.lavaTables,
      cubes: this.cubes.size,
      twinsDrawnLastFrame: this.twinsLastFrame,
      notes,
    };
  }

  dispose(): void {
    this.clear();
    this.unsubscribe();
    this.visibility.dispose();
    this.probeMaterial.dispose();
    this.standIn?.dispose();
    this.standIn = null;
  }

  /** A body's twin out of the mask scene and both its materials disposed; the geometry is the world's. */
  private forgetBody(body: WaterBody): void {
    for (const twin of body.twins) this.maskScene.remove(twin);
    for (const mask of body.masks) {
      const i = this.maskList.indexOf(mask);
      if (i >= 0) this.maskList.splice(i, 1);
      mask.dispose();
    }
    body.lit.dispose();
  }

  /** Filter this pack's per-shader cubes into PMREMs. Only ever called in 'shader' mode. */
  private async ensureCubes(): Promise<void> {
    const pack = this.pack;
    const renderer = this.renderer;
    if (!pack || !renderer || !this.data) return;
    if (this.cubesFor === pack) return;
    this.disposeCubes();
    this.cubesFor = pack;
    const wanted = new Map<string, string[]>();
    for (const info of Object.values(this.data.shaders)) {
      if (info.kind !== 'water' || !info.cube) continue;
      wanted.set(info.cube.faces[0], info.cube.faces);
    }
    if (!wanted.size) return;
    const gen = new THREE.PMREMGenerator(renderer);
    try {
      for (const [key, faces] of wanted) {
        try {
          const tex = await new THREE.CubeTextureLoader().loadAsync(faces.map((f) => pack.url(f)));
          if (this.pack !== pack) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          const filtered = gen.fromCubemap(tex).texture;
          tex.dispose();
          // The converter never upscales a cube, so one authored under 128 px would filter shorter
          // and change `envMapCubeUVHeight` — a recompile of every water material mid-play.
          const height = envHeightOf(filtered);
          if (height !== WATER_ENV_HEIGHT) {
            this.notes.push(`water: the cube ${key} filters to ${height} high, not ${WATER_ENV_HEIGHT}; the bodies using it reflect the sky instead`);
            filtered.dispose();
          } else this.cubes.set(key, filtered);
        } catch {
          this.notes.push(`water: the cube ${key} failed to load; that body reflects the sky instead`);
        }
      }
    } finally {
      gen.dispose();
    }
    for (const b of this.list) this.assignEnvironment(b);
  }

  private disposeCubes(): void {
    for (const t of this.cubes.values()) t.dispose();
    this.cubes.clear();
    this.cubesFor = null;
  }

  /** This body's own filtered cube, when it has one and 'shader' mode is in force. */
  private ownCube(body: WaterBody): THREE.Texture | null {
    if (this.envMode !== 'shader' || !body.look.cube) return null;
    return this.cubes.get(body.look.cube[0]) ?? null;
  }

  /** The area's sky map when it is the one size water may see, else the black stand-in. */
  private skyEnvironment(): THREE.Texture | null {
    const { texture } = currentEnvironment();
    if (texture && envHeightOf(texture) === WATER_ENV_HEIGHT) return texture;
    return this.standIn;
  }

  private intensityFor(body: WaterBody): number {
    return this.envIntensity * (this.ownCube(body) ? this.envLight : 1);
  }

  private assignEnvironment(body: WaterBody): void {
    const tex = this.ownCube(body) ?? this.skyEnvironment();
    if (!tex) {
      this.warn('water: a body was made before the renderer was attached; its environment is set when the stand-in exists');
      return;
    }
    const k = this.intensityFor(body);
    for (const m of [body.lit, ...body.masks]) {
      m.envMap = tex;
      m.envMapIntensity = k;
    }
  }

  private warn(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.notes.push(message);
    console.info(message);
  }
}

/**
 * A black 128 px cube, filtered. Every body carries it from the moment it exists, so its program
 * key never goes from no environment to one, and a planet with no sky map reflects nothing at all,
 * which is exactly how the water looked before it had an environment.
 */
function makeBlackEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const faces: HTMLCanvasElement[] = [];
  for (let i = 0; i < 6; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = WATER_CUBE_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, WATER_CUBE_SIZE, WATER_CUBE_SIZE);
    faces.push(canvas);
  }
  const cube = new THREE.CubeTexture(faces);
  cube.colorSpace = THREE.SRGBColorSpace;
  cube.needsUpdate = true;
  const gen = new THREE.PMREMGenerator(renderer);
  const env = gen.fromCubemap(cube).texture;
  gen.dispose();
  cube.dispose();
  return env;
}

/**
 * How tall a filtered environment is. It is what three keys a program on (`envMapCubeUVHeight`),
 * so anything other than WATER_ENV_HEIGHT on a water body is a recompile waiting to happen.
 */
function envHeightOf(texture: THREE.Texture | null): number | null {
  const image = texture?.image as { height?: number } | undefined;
  return typeof image?.height === 'number' ? image.height : null;
}

/**
 * The four numbers three's transparent list sorts `mesh` by, read the way `projectObject` reads
 * them: the nearest Group's render order, the mesh's own, the clip-space z (before the divide) of
 * its geometry's bounding sphere centre through `projScreen`, and its id.
 */
function readDrawKey(mesh: THREE.Mesh, projScreen: THREE.Matrix4, key: WaterDrawKey): void {
  let group = 0;
  for (let p = mesh.parent; p; p = p.parent) {
    if ((p as THREE.Group).isGroup) {
      group = p.renderOrder;
      break;
    }
  }
  const geometry = mesh.geometry;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const c = geometry.boundingSphere!.center;
  tmpV4.set(c.x, c.y, c.z, 1).applyMatrix4(mesh.matrixWorld).applyMatrix4(projScreen);
  key.group = group;
  key.order = mesh.renderOrder;
  key.z = tmpV4.z;
  key.id = mesh.id;
}

/** The mean of a lake's own outline points, which is where `__debug.teleport` should go. */
function meanXZ(mesh: THREE.Mesh): [number, number] | null {
  const pos = mesh.geometry.getAttribute('position');
  if (!pos || !pos.count) return null;
  let x = 0;
  let z = 0;
  for (let i = 0; i < pos.count; i++) {
    x += pos.getX(i);
    z += pos.getZ(i);
  }
  return [Number((mesh.position.x + x / pos.count).toFixed(1)), Number((mesh.position.z + z / pos.count).toFixed(1))];
}

function distanceTo(camera: THREE.Vector3, body: WaterBodyDescription): number {
  if (!body.centre) return 0;
  tmpV.set(body.centre[0], body.height, body.centre[1]);
  return tmpV.distanceTo(camera);
}
