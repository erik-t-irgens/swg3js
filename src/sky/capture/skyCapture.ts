// Reflections of the real sky on WebGPU (the GPU port's pass 2, wave 2, maker B; the design's 2.3). The capture keeps the
// dome's one 128 px cube and its one filtered target for the session (`DomeCapture`, `src/world/envmap.ts`) and gains what
// the sky really draws: the dome itself (our air's, `airSky.ts`, with its sun discs spread and capped there; or SWG's), the
// moons and pictures SWG's sky hangs as they are drawn today, a skybox where the sky has one, and in space the planets and the
// nebula sheets where WebGPU draws them. It is taken again every `CAPTURE_TUNE.every` seconds, or sooner when the light has
// turned `sunMoveDeg` since the last refresh, one face a frame by its own draws (never `CubeCamera.update`, which draws all
// six at once) and filtered on a seventh frame, so no frame carries the whole refresh and nothing a surface reflects is ever a
// half-drawn cube: the filtered target, the one every surface samples, changes only on the seventh frame. An ask (a sky just
// hung, the reflections readied behind a loading screen, the source switched, an hour moved by hand) takes all six and the
// filter at once, as the four-second capture always did.
//
// What is drawn is the sky's own capture scene (`SwgSky.domeScene`), holding a mesh of its own for each live drawable, over
// the live mesh's very geometry and material (`place`): its place is written at each refresh as the live mesh's world matrix
// less its centre's place (the group that rides the camera, or the camera for what is fixed in the world), so the capture is
// made about the origin, where the cube's cameras stand, and nothing measured from the world's middle reaches the card. The
// scene keeps two lights of its own for its life (a directional and a hemisphere, the world's sun and sky light copied at each
// refresh), so a lit planet in space is lit in its reflection too and the number of lights in any scene never changes.
//
// Nothing here is allocated in a frame (the numbers live in kept fields; `skyCaptureAlloc.test.ts`), and nothing builds a
// pipeline in play: every copy is made, and built with the dome by the world's warm-up, as its live mesh is hung
// (`World.gpuSkyReady`, `gpuCaptureMore`), the refreshes held until those pipelines have landed (`hold`). Reached on WebGPU
// alone, through the runtime's environment (`gpuEnv.ts`); pure but for three's core classes, so a node test runs it whole
// over a stand-in renderer and filter.
import * as THREE from 'three';
import type { DomeCapture } from '../../world/envmap.ts';
import { CAPTURE_TUNE } from './captureTune.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What a frame of the capture does (`CaptureClock.next`): nothing, a face (0 to 5), the filter, or everything at once. */
export const STEP_NONE = -1;
export const STEP_FILTER = 6;
export const STEP_ALL = 7;

/** The kinds of what the capture draws beside the dome, each placed and let go as a whole. */
export const KIND_SKY = 0;
export const KIND_PLANETS = 1;
export const KIND_NEBULAE = 2;
const KIND_NAMES = ['the sky', 'the planets', 'the nebulae'] as const;

const DEG = Math.PI / 180;

/** A direction, read by its fields. */
export interface Dir3 {
  x: number;
  y: number;
  z: number;
}

/**
 * When the sky is taken again: a refresh every `CAPTURE_TUNE.every` seconds, or as soon as the light (`next`'s direction,
 * the sun by day and the moon by night) has turned `sunMoveDeg` from where it stood at the last refresh's start; a face a
 * frame and the filter on a seventh (`pace` 'faces'), or all at once. An ask takes everything at the next frame; a hold
 * (pipelines still landing) takes nothing until it is let go.
 *
 * The frame's seconds are written into `dt` before `next` (a number handed across a call is a number made), and every
 * field that holds a fraction is begun as one.
 */
export class CaptureClock {
  /** This frame's seconds, written by the caller before `next`. */
  dt = 0.5;
  /** Seconds since the last refresh began. */
  timer = 0.5;
  /** The face the refresh under way draws next (0 to 5), the filter (6), or -1 between refreshes. */
  phase = -1;
  /** Take everything at the next frame. */
  asked = false;
  /** Holds in force: nothing is taken while any stands (pipelines the capture draws still landing). */
  held = 0;
  /** The light's direction as the last refresh began. */
  readonly at = { x: 0.5, y: 0.5, z: 0.5 };
  /** The dial `cosMove` was worked from, and the cosine itself (worked again only when the dial moves). */
  private moveDeg = 0.5;
  private cosMove = 0.5;
  /** Why each refresh began, for the console. */
  readonly why = { clock: 0, light: 0, asked: 0 };

  constructor() {
    this.dt = 0;
    this.timer = 0;
    this.at.x = 0;
    this.at.y = 1;
    this.at.z = 0;
    this.moveDeg = -1;
    this.cosMove = 1;
  }

  /** What this frame does: `STEP_NONE`, a face (0 to 5), `STEP_FILTER` or `STEP_ALL`. */
  next(dir: Dir3): number {
    if (this.held > 0) return STEP_NONE;
    if (this.asked) {
      this.asked = false;
      this.why.asked++;
      this.begin(dir);
      return STEP_ALL;
    }
    // From one refresh's start to the next's: the clock runs through the refresh's own frames too.
    this.timer += this.dt;
    if (this.phase >= 0) {
      const p = this.phase;
      this.phase = p >= STEP_FILTER ? -1 : p + 1;
      return p;
    }
    if (CAPTURE_TUNE.sunMoveDeg !== this.moveDeg) {
      this.moveDeg = CAPTURE_TUNE.sunMoveDeg;
      this.cosMove = Math.cos(this.moveDeg * DEG);
    }
    const at = this.at;
    const turned = dir.x * at.x + dir.y * at.y + dir.z * at.z < this.cosMove;
    if (!turned && this.timer < CAPTURE_TUNE.every) return STEP_NONE;
    if (turned) this.why.light++;
    else this.why.clock++;
    this.begin(dir);
    if (CAPTURE_TUNE.pace === 'once') return STEP_ALL;
    this.phase = 1;
    return 0;
  }

  /** A refresh begins: the clock from nought and the light's direction kept. */
  private begin(dir: Dir3): void {
    this.timer = 0;
    this.phase = -1;
    this.at.x = dir.x;
    this.at.y = dir.y;
    this.at.z = dir.z;
  }
}

/** The renderer's part the capture's draws use; a node test hands in a recording stand-in. */
export interface CaptureRenderer {
  getRenderTarget(): unknown;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  setRenderTarget(target: unknown, face?: number, mip?: number): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): unknown;
  clearDepth(): unknown;
  autoClear: boolean;
  readonly reversedDepthBuffer?: boolean;
  readonly coordinateSystem: number;
}

/** A live drawable drawn in the capture: a mesh of its own over the live one's geometry and material, placed about `centre`. */
interface Copy {
  live: THREE.Mesh;
  mesh: THREE.Mesh;
  centre: THREE.Object3D;
  kind: number;
}

/**
 * Whether a live mesh is drawn into the capture: one material, which writes colour, which WebGPU draws (a classic material
 * three copies into a node material, a node material, or a shader material with a stand-in registered; any other shader
 * material WebGPU steps over unbuilt, `fallback.ts`), and a plain mesh (an instanced, batched or skinned one would need a
 * copy of its kind).
 */
export function capturable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as Any;
  if (m.isMesh !== true || m.isInstancedMesh === true || m.isBatchedMesh === true || m.isSkinnedMesh === true) return false;
  const mat = m.material as Any;
  if (!mat || Array.isArray(mat) || mat.colorWrite === false) return false;
  if (mat.isShaderMaterial === true && typeof mat.userData?.gpuStandIn !== 'function') return false;
  return true;
}

/** Whether a live mesh is drawn now: it and every parent shown, up to a scene. */
function shownInScene(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  let top: THREE.Object3D = o;
  while (p) {
    if (!p.visible) return false;
    top = p;
    p = p.parent;
  }
  return (top as Any).isScene === true;
}

/**
 * The capture of the real sky, made once a session with the dome (`gpuEnv.ts`'s `makeDome`): the clock, the copies in the
 * hung sky's capture scene and its two lights, the face draws and the filter.
 */
export class SkyCapture {
  readonly clock = new CaptureClock();
  readonly dome: DomeCapture;
  /** The hung sky's capture scene (`SwgSky.domeScene`), null before the first sky and after one goes. */
  scene: THREE.Scene | null = null;
  /** What everything fixed in the world is placed about: the hung sky's group, which rides the camera. */
  private eye: THREE.Object3D | null = null;
  /** The world's own sun and sky light, copied into the scene's own at each refresh. */
  private worldSun: THREE.DirectionalLight | null = null;
  private worldHemi: THREE.HemisphereLight | null = null;
  /** The capture scene's own two lights, made with it and kept for its life. */
  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private readonly copies: Copy[] = [];
  /** The distinct centres the copies are placed about, each walked once a refresh. */
  private readonly centres: THREE.Object3D[] = [];
  /** Kept for a compile's walk: every copy shown, then put back. */
  private readonly shownWas: boolean[] = [];
  /** For the console and the tests. */
  readonly stats = { scenes: 0, refreshes: 0, outright: 0, faces: 0, filters: 0, holds: 0, lastPhase: -1, copiesMade: 0 };

  // Written out, not as a parameter property: node's type stripping runs this file in its tests.
  constructor(dome: DomeCapture) {
    this.dome = dome;
  }

  /**
   * A sky hung (`World.gpuSkyReady`): its capture scene, the group that rides the camera, the world's sun and sky light, and
   * the sky's own drawables beside the dome (its moons and pictures and its skybox, `SwgSky.captureSources`). The last sky's
   * copies go with its scene; a refresh under way is dropped. The live dome's mesh in the scene is drawn first, as the live
   * dome is (`domeOrder`). Answers how many copies stand.
   */
  attach(scene: THREE.Scene, eye: THREE.Object3D, worldSun: THREE.DirectionalLight, worldHemi: THREE.HemisphereLight, domeMaterial: THREE.Material, domeOrder: number, sky: readonly THREE.Object3D[]): number {
    if (this.scene !== scene) {
      this.copies.length = 0;
      this.centres.length = 0;
      this.scene = scene;
      this.stats.scenes++;
      // Named, so the pipeline census (`__debug.gpu({ keys })`) files what it draws as the capture's.
      if (!scene.name) scene.name = 'the sky capture';
      // The scene's two lights, made once for its life: a scene keeps one light set, so the key of everything it draws stands.
      const sun = new THREE.DirectionalLight(0xffffff, 0);
      sun.name = 'capture: sun';
      const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
      hemi.name = 'capture: sky light';
      scene.add(sun, hemi);
      this.sun = sun;
      this.hemi = hemi;
      for (const o of scene.children) if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === domeMaterial) o.renderOrder = domeOrder;
    }
    this.eye = eye;
    this.worldSun = worldSun;
    this.worldHemi = worldHemi;
    this.clock.phase = -1;
    return this.place(KIND_SKY, sky, eye);
  }

  /** The hung sky went (`World.dropSky`): nothing is drawn until the next is attached. */
  detach(): void {
    this.copies.length = 0;
    this.centres.length = 0;
    this.scene = null;
    this.eye = null;
    this.sun = null;
    this.hemi = null;
    this.clock.phase = -1;
  }

  /**
   * One kind's drawables in the capture (the sky's, the planets', the nebulae's), made afresh: the kind's old copies leave the
   * scene and a copy is made for every capturable mesh under `roots`, placed about `centre` (the group the roots ride with
   * the camera, or the eye for what is fixed in the world; null: the eye). Answers how many copies of the kind stand.
   */
  place(kind: number, roots: readonly (THREE.Object3D | null)[], centre: THREE.Object3D | null = null): number {
    const scene = this.scene;
    if (!scene) return 0;
    this.drop(kind);
    const about = centre ?? this.eye;
    if (!about) return 0;
    let n = 0;
    for (const root of roots) {
      if (!root) continue;
      root.traverse((o) => {
        if (!capturable(o)) return;
        const mesh = new THREE.Mesh(o.geometry, o.material);
        mesh.name = `capture: ${o.name || o.type}`;
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldAutoUpdate = false;
        mesh.renderOrder = o.renderOrder;
        // Never culled: three's warm-up walk culls a scene's objects against the face camera, and a copy not yet placed (its
        // matrix the origin's, inside the cube's near plane) was left out of it and built at its first draw in play (a moon's
        // first night); a handful of sky pieces drawn in every face costs nothing.
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.userData.swgCaptureCopy = true;
        scene.add(mesh);
        this.copies.push({ live: o, mesh, centre: about, kind });
        n++;
      });
    }
    this.stats.copiesMade += n;
    this.centres.length = 0;
    for (const c of this.copies) if (!this.centres.includes(c.centre)) this.centres.push(c.centre);
    return n;
  }

  /** A space zone's planets and moons (`World.spaceBodies`, a group riding the camera), placed about that group; null lets them go. */
  placePlanets(group: THREE.Object3D | null): number {
    return group ? this.place(KIND_PLANETS, [group], group) : (this.drop(KIND_PLANETS), 0);
  }

  /** A space zone's nebula sheets where WebGPU draws them (`Nebulae.group`, fixed in the world), placed about the eye; null lets them go. */
  placeNebulae(group: THREE.Object3D | null): number {
    return group ? this.place(KIND_NEBULAE, [group], null) : (this.drop(KIND_NEBULAE), 0);
  }

  /** One kind's copies out of the scene (a set of planets let go, the nebulae dropped). */
  drop(kind: number): void {
    const scene = this.scene;
    let w = 0;
    for (let i = 0; i < this.copies.length; i++) {
      const c = this.copies[i];
      if (c.kind === kind) {
        scene?.remove(c.mesh);
        continue;
      }
      this.copies[w++] = c;
    }
    this.copies.length = w;
  }

  /** How many copies of each kind stand. */
  counts(): number[] {
    const out = [0, 0, 0];
    for (const c of this.copies) out[c.kind]++;
    return out;
  }

  /**
   * A walk of the capture scene by the warm-up with every copy shown (three's walk steps over anything hidden, and a copy is
   * hidden while its live mesh is: a moon by day, the sun's pictures under our sky), so every copy's pipeline is built whether
   * or not it shows now; each is put back after.
   */
  compileWith(fn: () => void): void {
    const was = this.shownWas;
    was.length = 0;
    for (const c of this.copies) {
      was.push(c.mesh.visible);
      c.mesh.visible = true;
    }
    try {
      fn();
    } finally {
      for (let i = 0; i < this.copies.length && i < was.length; i++) this.copies[i].mesh.visible = was[i];
      was.length = 0;
    }
  }

  /** A hold while pipelines the capture draws land (`World.gpuCaptureMore`); its release asks for everything at once. */
  hold(): void {
    this.clock.held++;
    this.stats.holds++;
  }

  release(): void {
    if (this.clock.held > 0) this.clock.held--;
    this.clock.asked = true;
  }

  /**
   * One frame of the capture, after the world's light for the frame is written (`World.refreshEnvironmentGpu`): `clock.dt`
   * written first. Draws what the clock says (a face, the filter, or everything) and answers the filtered texture on the frame
   * it is filtered (the kept target's, the same object every time), else null.
   */
  step(r: CaptureRenderer, dir: Dir3): THREE.Texture | null {
    // No sky attached (between two worlds, or a sky hung whose capture scene is not yet given its copies): the clock waits,
    // an ask with it, so the first capture is the attached sky's.
    if (!this.scene) return null;
    const s = this.clock.next(dir);
    this.stats.lastPhase = s;
    if (s === STEP_NONE) return null;
    // One place a refresh begins, whichever way it was asked for.
    if (s === 0 || s === STEP_ALL) this.begin(r);
    if (s === STEP_ALL) {
      this.stats.outright++;
      for (let f = 0; f < 6; f++) this.face(r, f);
      return this.filter();
    }
    if (s < STEP_FILTER) {
      this.face(r, s);
      return null;
    }
    return this.filter();
  }

  /**
   * A refresh begins: the cube's cameras in the renderer's coordinate system (three's own `CubeCamera.update` does this; once,
   * at the session's first capture: the cube's camera stands at the origin for good, so its cameras' world matrices are
   * worked out then and never again, a camera's `updateMatrixWorld` making numbers in three's `decompose`), each centre's world
   * matrix worked out from where it stands now, every copy placed and shown as its live mesh is, and the world's sun and sky
   * light copied into the scene's own.
   */
  private begin(r: CaptureRenderer): void {
    this.stats.refreshes++;
    const cc = this.dome.camera;
    if (cc.coordinateSystem !== r.coordinateSystem) {
      cc.coordinateSystem = r.coordinateSystem as THREE.CoordinateSystem;
      cc.updateCoordinateSystem();
      if (cc.parent === null) cc.updateMatrixWorld();
    }
    for (let i = 0; i < this.centres.length; i++) this.centres[i].updateMatrixWorld(true);
    for (let i = 0; i < this.copies.length; i++) {
      const c = this.copies[i];
      const live = c.live;
      // A live mesh given another material since its copy was made is not drawn: the copy's pipeline is the old material's.
      if (!shownInScene(live) || live.material !== c.mesh.material) {
        c.mesh.visible = false;
        continue;
      }
      c.mesh.visible = true;
      const s = live.matrixWorld.elements;
      const d = c.mesh.matrixWorld.elements;
      const o = c.centre.matrixWorld.elements;
      for (let k = 0; k < 16; k++) d[k] = s[k];
      d[12] -= o[12];
      d[13] -= o[13];
      d[14] -= o[14];
    }
    const sun = this.sun;
    const ws = this.worldSun;
    if (sun && ws) {
      sun.color.copy(ws.color);
      sun.intensity = ws.intensity;
      // Its direction as the world's: from its target toward it.
      sun.position.x = ws.position.x - ws.target.position.x;
      sun.position.y = ws.position.y - ws.target.position.y;
      sun.position.z = ws.position.z - ws.target.position.z;
    }
    const hemi = this.hemi;
    const wh = this.worldHemi;
    if (hemi && wh) {
      hemi.color.copy(wh.color);
      hemi.groundColor.copy(wh.groundColor);
      hemi.intensity = wh.intensity;
    }
  }

  /** One face of the cube drawn into by its own camera, as `CubeCamera.update` draws each, the renderer's target put back. */
  private face(r: CaptureRenderer, f: number): void {
    const prev = r.getRenderTarget();
    const prevFace = r.getActiveCubeFace();
    const prevMip = r.getActiveMipmapLevel();
    r.setRenderTarget(this.dome.cube, f, 0);
    if (r.reversedDepthBuffer === true && r.autoClear === false) r.clearDepth();
    r.render(this.scene!, this.dome.camera.children[f] as THREE.Camera);
    r.setRenderTarget(prev, prevFace, prevMip);
    this.stats.faces++;
  }

  /** The cube filtered into the kept target (`DomeCapture.filterCube`), counted as a capture. */
  private filter(): THREE.Texture | null {
    const t = this.dome.filterCube(this.dome.cube.texture);
    this.dome.stats.captures++;
    this.stats.filters++;
    return t;
  }

  /** What the console says of it (`__debug.reflections().capture.steps`). */
  report(): Record<string, unknown> {
    const counts = this.counts();
    const shown = [0, 0, 0];
    for (const c of this.copies) if (c.mesh.visible) shown[c.kind]++;
    return {
      pace: CAPTURE_TUNE.pace === 'faces' ? 'a face a frame, the filter on a seventh' : 'all at once on one frame',
      every: CAPTURE_TUNE.every,
      sunMoveDeg: CAPTURE_TUNE.sunMoveDeg,
      phase: this.clock.phase,
      held: this.clock.held,
      sinceRefresh: Number(this.clock.timer.toFixed(2)),
      began: { ...this.clock.why },
      refreshes: this.stats.refreshes,
      outright: this.stats.outright,
      faces: this.stats.faces,
      filters: this.stats.filters,
      holds: this.stats.holds,
      scenes: this.stats.scenes,
      draws: KIND_NAMES.map((name, k) => `${name}: ${counts[k]} (${shown[k]} shown at the last refresh)`),
      lights: this.sun ? { sun: `#${this.sun.color.getHexString()} x${this.sun.intensity.toFixed(2)}`, sky: this.hemi ? `#${this.hemi.color.getHexString()} x${this.hemi.intensity.toFixed(2)}` : null } : null,
      sun: { leastDeg: CAPTURE_TUNE.sunDeg, cap: CAPTURE_TUNE.sunCap },
    };
  }
}
