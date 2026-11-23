// A space zone's gas drawn as true volumes on WebGPU (the GPU port's pass 2, wave 4b, maker C; the design's 2.9, the brief's
// part C): the space body viewer's volumes (`src/sky/look/volume.js`, a ray march through its baked noise) hung in the zone's
// sky, marched at half the scene's resolution into a picture of their own and laid over the scene by a sphere that stands
// where each one does, so a ship or a station in front hides it by depth. WebGPU only: the runtime makes it
// (`GpuRuntime.spaceVolumes`), nothing here is loaded on the WebGL path.
//
// **Where and which**: `nebulaForm.ts`'s `volumePlacesOf` (the owner's Save to game, else the viewer's own start: Kessel's
// Maelstrom round the Maw). The look's gas is the file's generated look's, or the viewer's preset (`presetLook`).
// **What it sees**: the march is drawn as the viewer's stage draws it, the eye at the origin of a scene of its own (a camera
// with the frame camera's turn and projection, standing nowhere), so no place measured from the world's middle reaches the
// card; the zone's planets stand in it as the viewer's stage stands them, so the gas ends at one in front of it as there.
// **Lit and read as the zone is**: the zone's star from its direction in its colour, the gas's own glow painted for an
// exposure of 1 read through the eye (`withGlow`), the scene stored pre-exposed as every node material's is.
// **Built behind the screen whatever the Nebulae row says** (the noise baked, the march's pipeline compiled against its own
// half-size picture, the lay-over's built with the zone's sky by the world's warm-up), so the row moves only what is shown.
// **A frame allocates nothing**: kept records and fields; the half-size picture is made again only when the scene's size moves.
import * as THREE from 'three';
import { MeshBasicNodeMaterial, RenderTarget } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { VolumeSet, buildVolume, disposeVolume, setVolumeQuality, updateVolume, volumeOccluders } from '../sky/look/volume.js';
// The viewer's presets (`presetLook`, typed in the game's declaration of the module since the wave's fixer).
import { presetLook } from '../sky/look/generate.js';
import { withGlow } from '../sky/exposure/eyeBuffer.ts';
import { markMotion } from '../core/gpu/motion.ts';
import { turnSkyBody } from '../world/skyBodies.ts';
import { VOLUME_FIXED, nebulaFormOf, stageDistance, volumeHang, volumePlacesOf, type NebulaForm, type VolumePlace, type ZonePlanet } from './nebulaForm.ts';
import { skyDirection } from './loreStarts.js';
import { SKY_BODIES } from '../sky/look/bodiesFile.ts';
import { tierIndexOf } from '../sky/night/nightTier.ts';
import { liveSettings } from '../core/settings.ts';
import { lookDrawnPlaces } from '../sky/bodies/lookBody.ts';
import { STORM_TAPE } from '../sky/look/weather.js';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { screenUV, texture, vec4 } = TSL as Any;

/** The frame's star (direction and colour) and clocks, written into its fields by the world before `frame`. */
export const SPACE_VOLUME_IN = {
  sunX: 0,
  sunY: 1,
  sunZ: 0,
  /** The star's colour times its strength, as the viewer's `sunPower` and `sunColour` take it (the gas is painted for 1). */
  sunR: 1,
  sunG: 1,
  sunB: 1,
  /** Seconds of play the gas drifts by, and of the wall the storms flash by. */
  dt: 0,
};

/** The zone's planets as the gas sees them (drawn place, angle), handed in at `make` and read each frame. */
export interface SpaceVolumePlanet {
  readonly mesh: THREE.Mesh;
  readonly radius: number;
  /** Its distance in the zone's file (which planet stands in front of the gas). */
  readonly distance: number;
}

interface Hung {
  place: VolumePlace;
  /** The game's reach over the viewer's stage distance of its place (`occluderOf`'s scale), worked at the screen. */
  stageK: number;
  gen: Any;
  set: Any;
  vol: Any;
  /** The ball's holder in the march's scene, and its lay-over in the world's. */
  holder: THREE.Object3D;
  over: THREE.Mesh;
  hang: { x: number; y: number; z: number; w: number };
}

export type SpaceVolumesReport = Record<string, unknown>;

const tmpDir = { x: 0, y: 0, z: 0 };

export class SpaceVolumes {
  /** The lay-overs, hung by the world in its scene (riding the camera, as the sky does). */
  readonly group = new THREE.Group();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 20000);
  private readonly hung: Hung[] = [];
  private readonly planets: SpaceVolumePlanet[] = [];
  private readonly occ: THREE.Vector4[] = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  /** Each planet's stage distance (`stageDistance` of its file distance), worked at the screen. */
  private planetStage = new Float64Array(0);
  private readonly lightWorld = new THREE.Vector3(0, 1, 0);
  private readonly sunColour = new THREE.Vector3(1, 1, 1);
  private readonly size = new THREE.Vector2(2, 2);
  private target: Any;
  private readonly renderer: Any;
  private motion = 0;
  private wall = 0;
  private drawn = 0;
  private warmed = false;
  /** Whether the volumes are shown (the Nebulae row's Volumes); the march is drawn only then. */
  shown = false;
  /** The viewer's volume tier the march runs at: its Medium (40 baked steps) or its Low (16). */
  private tier: 'medium' | 'low' = 'medium';

  private constructor(renderer: Any) {
    this.renderer = renderer;
    this.group.name = 'space volumes';
    this.group.frustumCulled = false;
    // Its matrices are worked out by `draw` alone: three's own walk of a camera's would decompose (numbers made a frame).
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.target = new RenderTarget(2, 2, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.target.texture.name = 'space volumes';
  }

  /**
   * A zone's volumes made ready behind its loading screen: each place's gas built from its look, its noise baked on the card,
   * its lay-over made, and the march's pipeline compiled against its picture. The owner's Save to game as the last screen read
   * it (`SKY_BODIES`); `planets` the zone's planets as the world hung them.
   */
  static async make(renderer: Any, zone: string, zonePlanets: readonly ZonePlanet[], planets: readonly SpaceVolumePlanet[]): Promise<SpaceVolumes> {
    const s = new SpaceVolumes(renderer);
    installSpaceVolumesDebug();
    CURRENT = s;
    for (const p of planets) s.planets.push(p);
    s.planetStage = new Float64Array(planets.length);
    for (let i = 0; i < planets.length; i++) s.planetStage[i] = stageDistance(planets[i].distance);
    const file = SKY_BODIES.file;
    const lookOf = (id: string): { generated: Record<string, unknown> | null } | null => file?.looks[id] ?? null;
    // Pass 2, wave 5 (maker L): a planet drawn whole in its look (`lookBody.ts`) carries its own gas round it; none hung here for it.
    const whole = lookDrawnPlaces();
    const places = volumePlacesOf(zone, zonePlanets, file ? file.uses : null, (id) => !!(lookOf(id)?.generated as Any)?.volume).filter((p) => !whole.has(p.place));
    // The prover's volumes for this zone (`__debug.spaceVolumes({ test })`), hung at the next zone's screen beside the file's.
    for (const t of TEST_VOLUMES) if (t.zone === zone) places.push({ place: `test:${zone}:${t.look}`, look: t.look, fromFile: false, dir: skyDirection(t.yaw, t.pitch), sizeDeg: t.size, distance: t.distance });
    if (!places.length) return s;
    // The viewer's tiers are module state: the game never draws its live High.
    setVolumeQuality(s.tier);
    // Pass 2, wave 5 (maker L): the gas's lightning recorded ahead and played back in the frames (`weather.js`' `STORM_TAPE`).
    STORM_TAPE.on = true;
    for (const place of places) {
      const gen = place.fromFile ? (lookOf(place.look)?.generated as Any) : (presetLook(place.look).generated as Any);
      if (!gen?.volume) continue;
      const set = new VolumeSet();
      await set.bake(renderer, gen);
      const holder = new THREE.Object3D();
      s.scene.add(holder);
      const vol = buildVolume(gen, set, holder, null, { body: false });
      const hang = { x: 0, y: 0, z: 0, w: 1 };
      volumeHang(place, VOLUME_FIXED.reach, hang);
      holder.position.set(hang.x, hang.y, hang.z);
      holder.scale.setScalar(hang.w);
      tmpDir.x = place.dir.x;
      tmpDir.y = place.dir.y;
      tmpDir.z = place.dir.z;
      turnSkyBody(tmpDir as THREE.Vector3, holder.quaternion);
      holder.updateMatrixWorld(true);
      // The march's mesh takes the baked tier's material before anything compiles it.
      updateVolume(vol, { motion: 0, wall: 0, lightWorld: s.lightWorld, sunPower: 1, sunColour: s.sunColour, gain: 1 });
      const over = new THREE.Mesh(vol.mesh.geometry, s.overMaterial());
      over.name = `space volume (${place.place})`;
      over.position.set(hang.x, hang.y, hang.z);
      over.scale.setScalar(hang.w);
      over.renderOrder = -2.5;
      over.frustumCulled = false;
      over.userData.unlit = true;
      over.visible = false;
      s.group.add(over);
      s.hung.push({ place, stageK: VOLUME_FIXED.reach / stageDistance(place.distance), gen, set, vol, holder, over, hang });
    }
    await s.warm();
    return s;
  }

  /** The lay-over's material: the half-size picture read at the pixel, premultiplied over what is behind, read through the eye. */
  private overMat: THREE.Material | null = null;
  private overMaterial(): THREE.Material {
    if (this.overMat) return this.overMat;
    const m = new MeshBasicNodeMaterial();
    m.name = 'gpu: space volume (lay-over)';
    m.fog = false;
    m.transparent = true;
    m.depthWrite = false;
    m.depthTest = true;
    m.side = THREE.BackSide;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.colorNode = withGlow(vec4(texture(this.target.texture, screenUV)));
    this.overMat = markMotion(m, 'sky');
    return this.overMat;
  }

  /** The march's pipeline compiled against its own picture (its format and attachments), behind the loading screen. */
  private async warm(): Promise<void> {
    if (!this.hung.length) return;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.target);
    let p: Promise<unknown>;
    try {
      p = r.compileAsync(this.scene, this.camera) as Promise<unknown>;
    } finally {
      r.setRenderTarget(prev);
    }
    await p;
    this.warmed = true;
  }

  get count(): number {
    return this.hung.length;
  }

  /**
   * Once a game frame (the sky group's frame, after the planets are placed): the lay-overs on the camera, each gas's drift, star
   * and planets in its way. Allocates nothing. `tierIndex` the quality tier (`tierIndexOf`), read by the world every 30 frames.
   */
  frame(camPos: THREE.Vector3, tierIndex: number): void {
    if (!this.hung.length) return;
    this.group.position.copy(camPos);
    const want = tierIndex === 0 || tierIndex === 1 ? 'low' : 'medium';
    if (want !== this.tier) {
      this.tier = want;
      setVolumeQuality(want);
    }
    const I = SPACE_VOLUME_IN;
    this.motion += I.dt;
    this.wall += I.dt;
    const lw = this.lightWorld;
    lw.x = I.sunX;
    lw.y = I.sunY;
    lw.z = I.sunZ;
    const sc = this.sunColour;
    sc.x = I.sunR;
    sc.y = I.sunG;
    sc.z = I.sunB;
    for (let i = 0; i < this.hung.length; i++) {
      const h = this.hung[i];
      h.over.visible = this.shown;
      if (!this.shown) continue;
      const opts = FRAME_OPTS;
      opts.motion = this.motion;
      opts.wall = this.wall;
      opts.lightWorld = lw;
      opts.sunColour = sc;
      updateVolume(h.vol, opts);
      // The zone's planets the gas may end at, as the viewer's stage stands them about the eye (`occluderOf`'s rule written out
      // with its stage distances worked at the screen: a number handed across a call is a number made).
      let n = 0;
      for (let k = 0; k < this.planets.length && n < 4; k++) {
        const p = this.planets[k];
        const mp = p.mesh.position;
        const d = Math.sqrt(mp.x * mp.x + mp.y * mp.y + mp.z * mp.z);
        if (!(d > 1e-6)) continue;
        const rr = p.radius * p.mesh.scale.x;
        const sin = rr / d;
        const s = this.planetStage[k] * h.stageK;
        const o = this.occ[n++];
        o.x = (mp.x / d) * s;
        o.y = (mp.y / d) * s;
        o.z = (mp.z / d) * s;
        o.w = s * (sin < 0.9999 ? (sin > 0 ? sin : 0) : 0.9999);
      }
      volumeOccluders(h.vol, this.occ, n);
    }
  }

  /**
   * Before the scene's passes, with the frame's camera (the world's `airFrame`): the march drawn into the half-size picture by a
   * camera at the origin with the frame camera's turn and projection. Nothing drawn while hidden, before the warm has landed,
   * or with no volume.
   */
  draw(frameCamera: THREE.PerspectiveCamera, sceneSize: THREE.Vector2): void {
    if (!this.shown || !this.warmed || !this.hung.length) return;
    const w = Math.max(2, Math.round(sceneSize.x * VOLUME_FIXED.scale));
    const hh = Math.max(2, Math.round(sceneSize.y * VOLUME_FIXED.scale));
    if (this.size.x !== w || this.size.y !== hh) {
      this.size.x = w;
      this.size.y = hh;
      this.target.setSize(w, hh);
    }
    const cam = this.camera;
    cam.projectionMatrix.copy(frameCamera.projectionMatrix);
    cam.projectionMatrixInverse.copy(frameCamera.projectionMatrixInverse);
    // The frame camera's turn alone, standing at the origin of the march's scene.
    cam.quaternion.copy(frameCamera.quaternion);
    cam.position.x = 0;
    cam.position.y = 0;
    cam.position.z = 0;
    cam.matrixWorld.compose(cam.position, cam.quaternion, cam.scale);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const clear = r.getClearAlpha();
    r.getClearColor(CLEAR);
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    try {
      r.clear(true, false, false);
      r.render(this.scene, cam);
    } finally {
      r.setClearColor(CLEAR, clear);
      r.setRenderTarget(prev);
    }
    this.drawn++;
  }

  report(): SpaceVolumesReport {
    return {
      shown: this.shown,
      warmed: this.warmed,
      tier: this.tier,
      picture: [this.size.x, this.size.y],
      drawn: this.drawn,
      volumes: this.hung.map((h) => ({
        place: h.place.place,
        look: h.place.look,
        fromFile: h.place.fromFile,
        sizeDeg: Number(h.place.sizeDeg.toFixed(1)),
        hangs: [Math.round(h.hang.x), Math.round(h.hang.y), Math.round(h.hang.z)],
        radius: Math.round(h.hang.w),
        bakeMs: Number((h.set.lastMs ?? 0).toFixed(1)),
      })),
    };
  }

  /** Everything let go: the lay-overs out of the world's group (the world takes the group out), the gas, its noise, the picture. */
  dispose(forget: (materials: Iterable<THREE.Material>) => void): void {
    const mats: THREE.Material[] = [];
    for (const h of this.hung) {
      h.over.removeFromParent();
      disposeVolume(h.vol);
      h.set.dispose();
      mats.push(h.vol.live, h.vol.baked);
    }
    if (this.overMat) mats.push(this.overMat);
    forget(mats);
    for (const m of mats) m.dispose();
    this.overMat = null;
    this.hung.length = 0;
    this.target.dispose();
    if (CURRENT === this) CURRENT = null;
  }
}

/**
 * The Nebulae row's form and the quality tier as they stand (`nebulaForm.ts`' rule), read once every 30 calls (a read walks the
 * tier table); the world asks once a game frame in space. Allocates nothing.
 */
export const NEBULA_NOW: { form: NebulaForm; tier: number; calls: number } = { form: 'sheets', tier: 2, calls: 0 };
export function nebulaFormNow(): NebulaForm {
  if (NEBULA_NOW.calls++ % 30 === 0) {
    const s = liveSettings();
    NEBULA_NOW.tier = tierIndexOf(s);
    NEBULA_NOW.form = nebulaFormOf(s.nebulaForm, NEBULA_NOW.tier);
  }
  return NEBULA_NOW.form;
}

// ---------------------------------------------------------------- the console

/** The zone's volumes while a space zone stands (the console's). */
let CURRENT: SpaceVolumes | null = null;
/** The prover's volumes: a viewer preset hung in a zone at a yaw, pitch, size across and distance, from the next zone's screen. */
const TEST_VOLUMES: { zone: string; look: string; yaw: number; pitch: number; size: number; distance: number }[] = [];

/**
 * `__debug.spaceVolumes()` says the Nebulae row's form and tier and each volume of the zone (its place, its look, where it hangs,
 * its noise's bake); `({ row: -1 | 0 | 1 | 2 })` moves the row for this session (the Graphics page's own control saves it),
 * read at the next frame.
 */
const spaceVolumesHook = (o?: { row?: number; test?: { zone: string; look: string; yaw: number; pitch: number; size: number; distance: number }[] }): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (o && Array.isArray(o.test)) {
    TEST_VOLUMES.length = 0;
    for (const t of o.test) if (t && typeof t.zone === 'string' && typeof t.look === 'string' && [t.yaw, t.pitch, t.size, t.distance].every((v) => typeof v === 'number' && Number.isFinite(v))) TEST_VOLUMES.push({ ...t });
    out.test = `${TEST_VOLUMES.length} volume${TEST_VOLUMES.length === 1 ? '' : 's'} of the prover's, hung from the next loading screen of their zone`;
  }
  if (o && typeof o.row === 'number' && [-1, 0, 1, 2].includes(o.row)) {
    liveSettings().nebulaForm = o.row;
    NEBULA_NOW.calls = 0;
    out.row = o.row;
  }
  out.form = NEBULA_NOW.form;
  out.tier = NEBULA_NOW.tier;
  out.zone = CURRENT ? CURRENT.report() : 'no space zone here (WebGPU in a space zone draws its volumes)';
  return out;
};

/** Put the hook on `__debug` (called at every zone's make: the game builds its `__debug` in one go at startup). */
export function installSpaceVolumesDebug(): void {
  if (typeof window === 'undefined') return;
  const holder = window as unknown as { __debug?: Record<string, unknown> };
  const debug = (holder.__debug ??= {});
  if (debug.spaceVolumes !== spaceVolumesHook) debug.spaceVolumes = spaceVolumesHook;
}

const CLEAR = new THREE.Color();
/** The options `updateVolume` reads, one record for every frame. */
// `noStorms`: the gas's lightning is left out in the game. Wave 4b left it out because the storms' step (`weather.js`, the viewer's)
// took its numbers across its call; pass 2, wave 5 (maker L) gave the step a kept record and a recording played back
// (`Storms.stepWith`, `record`), which a cloud deck's storms run allocating nothing (`lookBodyAlloc.test.ts`), but the
// Maelstrom's played back through `updateVolume` still made 8 bytes a frame in `spaceAlloc.test.ts` (cause not found), so it stays out.
const FRAME_OPTS: { motion: number; wall: number; lightWorld: THREE.Vector3 | null; sunPower: number; sunColour: THREE.Vector3 | null; gain: number; noStorms: boolean } = { motion: 0, wall: 0, lightWorld: null, sunPower: 1, sunColour: null, gain: 1, noStorms: true };
