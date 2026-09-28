// Portal rendering, reduced to the one thing that matters: keeping a building's inside and
// outside apart. Interiors are drawn whole (rooms occlude each other by depth, so doorways
// between rooms need no special handling); the boundary between a building and the world is
// the set of its exit portals, and whatever lies on the far side of that boundary is drawn only
// through those polygons, clipped by a stencil mask with depth reset behind the doorway.
// Exterior shells never intersect interiors, rooms bigger than their shells work, and the
// scene is shaded once for every pass so lighting is the same in and out.
//
// Layers: 0 = the world (terrain, shells, props), 1 = interior meshes (each building owns its
// own, hidden except while that building is being drawn), 31 = actors (player, creatures,
// vehicles, effects, lights, objects inside buildings) which are drawn in every pass.
//
// What is drawn at all is cut by the frame's visible set (`portalVis.ts`, worked out once a frame
// before any pass): from inside with no exit reachable the world, its shadows and the weather are
// not drawn; only the rooms the flood reached are shown, inside and through doors; and the world
// seen from inside through its exits leaves out the ground and placed objects outside the exits'
// rectangle. `PORTAL_CULL.mode = 'all'` puts the old behaviour back whole, and each cut has its own
// switch in the frame report (`__debug.perf({ switches: true })`).
//
// What moves on its own is routed by the room it stands in (`portalCull.ts`): drawn in the passes of
// its own rooms and nowhere else. The furniture standing in a building's rooms is drawn with those rooms
// in that building's pass (`furnitureHost.ts`, `Building.furniture`), and no room of the building the
// camera is in is drawn into the sun's shadows, which no room receives.

import * as THREE from 'three';
import type { Building, CellState } from './layoutStream';
import { isShadowOnly } from '../core/fxRegistry.ts';
import { CNT, PASS, PERF, perf } from '../core/perf.ts';
import { cullOn, ExitNarrowing, exitFrustum, isQuarantined, markQuarantined, MAX_BUILDINGS, PORTAL_CULL, PortalVisibility, walkCameraCell, type CameraCell } from './portalVis.ts';
import { ActorRoutes, ROUTE_PASS } from './portalCull.ts';
import { furnitureOn, maskSeen } from './furnitureHost.ts';
import { beginSkeletonFrame, endSkeletonFrame, installSkeletonOnce } from '../core/skeletonOnce.ts';

export { crossing } from './portalVis.ts';

export const ACTOR_LAYER = 31;
export const INTERIOR_LAYER = 1;

/** The shadow pass's stray draws: whether they are made, and what the last pass met. */
export interface ShadowStrays {
  /** True draws them, which is the old behaviour and the baseline this was measured against. */
  keep: boolean;
  /** Stray draws the last shadow pass met, whether or not they were made. 0 when it met none. */
  seen: number;
  /** Direct draws made during that pass by something other than its own render list; see `hookDraws`. */
  foreign: number;
}

/**
 * Whether the old behaviour was asked for, which is how a baseline is taken.
 *
 * It is asked for on the address (`?shadowStrays=1`) and deliberately never remembered. An earlier
 * turn of this read a stored key instead, and a browser given that key once ran the old behaviour
 * on that address for ever after with none of the cut in it -- which is exactly how a measurement
 * becomes a lie, and it happened: the key was left set on the dev server's own address and the game
 * was quietly shipped there with its own cut switched off. The key is cleared here, so a browser
 * that still carries it is mended by loading the game once.
 */
function baselineAsked(): boolean {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem('swg.shadowStrays');
  } catch {
    // Storage throws outright in a private window, where there was never anything to clear.
  }
  try {
    if (typeof location === 'undefined' || !location.search) return false;
    return new URLSearchParams(location.search).get('shadowStrays') === '1';
  } catch {
    return false;
  }
}

/**
 * The one stray record, read and written through `__debug.shaders()` and `__debug.passLog()`.
 *
 * Fields rather than constants, so the baseline can be taken back and forth in one session without
 * a reload (`__debug.shaders({ keepStrays: true })`), and a plain module-level object because the
 * game reaches it by importing this file, which is the one thing that cannot hand back a second
 * copy. It hung on `globalThis` for a while, so that a console `import()` of this file could find
 * it: a dev server stamps its imports with a version, so such an import evaluates the file a
 * *second* time and hands back a second set of module-level values, and a knob turned on that copy
 * moved nothing at all while the counter beside it read 0. There is nothing to import now -- the
 * game's own hook is the way in -- so the field is gone and with it the second name in the console.
 *
 * Nothing about the picture changes either way: the pass's colour is cleared on the next line of
 * `render`. What changes is the number of programs -- see `hookDraws`.
 */
export const SHADOW_STRAYS: ShadowStrays = { keep: baselineAsked(), seen: 0, foreign: 0 };
// Said out loud, because a session that reads the baseline as the game's ordinary behaviour
// concludes the cut does nothing.
if (SHADOW_STRAYS.keep) console.warn('shaders: ?shadowStrays=1 is set, so the shadow pass keeps its stray draws — the old behaviour, one light set more. Take it off the address for the cut.');

/**
 * Actors are visible from inside and outside alike; what first person has put on the shadow-only
 * layer stays there, so nothing that prepares or marks the player brings the hidden head back into view.
 */
export function markActor(o: THREE.Object3D): void {
  o.traverse((x) => {
    if (!isShadowOnly(x.layers.mask)) x.layers.enable(ACTOR_LAYER);
  });
}

const tmpS = new THREE.Sphere();
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();

export class PortalRenderer {
  readonly materials = new Set<THREE.Material>();
  /** The frame's visible set: which rooms, and whether the world, can be seen (`portalVis.ts`). */
  readonly vis = new PortalVisibility();
  /** The camera's building and room, as `cameraCell` last found them. Kept and refilled. */
  readonly camCell: CameraCell<Building> = { building: null, cell: 0 };
  private readonly camNear: (Building | null)[] = [];
  /** Whether `computeVisibility` ran since the last `render`: a set from an older frame is never read. */
  private visFresh = false;
  /** The buildings drawn through their doors from outside, nearest first, and their distances; kept. */
  private readonly near: (Building | null)[] = new Array<Building | null>(MAX_BUILDINGS).fill(null);
  private readonly nearD = new Float64Array(MAX_BUILDINGS);
  /** The doors `exitPortals` found, as many as it answers: written by index and never shortened (emptying an array frees its store). */
  private readonly exitList: THREE.Mesh[] = [];
  private readonly bufferSize = new THREE.Vector2();
  /** The last frame skipped the world, its shadows and the weather from inside: no exit could be seen. */
  worldSkipped = false;
  /** Room meshes shown in the last frame's views (not its shadow pass). */
  roomMeshes = 0;
  /** Furniture groups shown in the last frame's views, with the rooms they can be seen in. */
  furnitureShown = 0;
  /** What moves on its own, routed by its room: filled by the game before each frame (`portalCull.ts`). */
  readonly actors = new ActorRoutes();
  /** The frustum through the exits' rectangle, for what the world pass from inside may show of the routed. */
  private readonly routeFrustum = new THREE.Frustum();
  /** The world pass from inside narrowed to the exits' rectangle (commit 1d, `portalVis.ts`). */
  private readonly narrowing = new ExitNarrowing();
  /** The containers whose children the exit narrowing may hide for the world pass: the scene and the ground's root. */
  readonly narrowParents: THREE.Object3D[] = this.narrowing.parents;
  /** What the last frame's exit narrowing tested and left out. */
  readonly narrowStats = this.narrowing.stats;
  /**
   * Shadow maps are shaded through this camera: it sees every layer (so every caster counts)
   * but its frustum holds nothing, so the render that carries the shadow pass draws nothing.
   */
  private readonly shadowProbe = new THREE.PerspectiveCamera(1, 1, 0.001, 0.002);
  private readonly portalMat: THREE.MeshBasicMaterial;
  private readonly resetMat: THREE.ShaderMaterial;
  private readonly resetQuad: THREE.Mesh;
  private readonly portalStandIn: THREE.Mesh;
  private readonly portalMeshes = new WeakMap<Building, THREE.Mesh[]>();
  /** Passes drawn last frame, for the stats overlay. */
  passes = 0;
  /**
   * Whether the shadow maps are worth drawing this frame: false while the weather has faded the
   * cascades' intensity to nothing. Never the renderer's own shadowMap.enabled, which is in every
   * program's key.
   */
  shadowsWanted = true;
  /** What each pass of the last frame drew, for the console hook. */
  readonly passLog: { label: string; calls: number; triangles: number }[] = [];

  /** Objects hidden because they failed to draw, with why, for the console and the stats. */
  readonly broken: { name: string; type: string; why: string }[] = [];

  /**
   * Run one renderer.render() and record what it cost. When the draw throws, the object that
   * throws is found by drawing the candidates one at a time, hidden, and named in the console,
   * so one bad mesh costs its own pixels rather than the rest of the frame (which left the
   * water and the doorways half drawn whenever it came into view).
   */
  private pass(label: string, target: THREE.Object3D, camera: THREE.Camera, kind: number): void {
    const info = this.renderer.info.render;
    const c0 = info.calls;
    const t0 = info.triangles;
    // The frame report counts every draw from here against this kind of pass (`__debug.perf()`).
    perf.passBegin(kind);
    try {
      this.renderer.render(target as THREE.Scene, camera);
    } catch (err) {
      this.quarantine(target, camera, err);
    }
    perf.passEnd(kind, info.triangles - t0);
    this.passLog.push({ label, calls: info.calls - c0, triangles: info.triangles - t0 });
    this.passes++;
  }

  /** The object the renderer is drawing right now, noted by the hook on renderBufferDirect. */
  private drawing: THREE.Object3D | null = null;

  /** True only while the shadow maps are being shaded (see `renderShadows`). */
  private shadingShadows = false;

  /**
   * Stray draws this frame's shadow pass met, whether or not they were made. Zeroed at the top of
   * every `render` and copied into `SHADOW_STRAYS.seen` once the pass is over, which is where the
   * console reads it (`__shadowStrays`) with no import and no hook in `main.ts`.
   */
  strays = 0;

  /**
   * Hook the renderer's draw call so the object being drawn is always known: a draw that throws
   * is then named at once. Finding it by drawing every candidate alone as its own scene, as
   * this used to, compiled a lightless shader for each and cost seconds per failure.
   *
   * The hook is also where the shadow pass's stray draws are dropped. That pass is made through a
   * camera that sees every layer (so every caster counts) and holds nothing in its frustum (so it
   * draws nothing) -- but a mesh with `frustumCulled` false is never tested against a frustum, so
   * three puts it in that pass's render list and draws it anyway, under a camera that sees the
   * world's lights and a building's rooms' lights at once. That is a third light set, and three
   * keys a program on the light counts whether or not the shader reads a light, so every actor,
   * vehicle, glow and trail was paying for a whole extra program that no frame ever shows: the
   * pass's own colour is cleared on the next line of `render`.
   *
   * What counts as the stray is asked precisely, by *whose* draw it is and not by a convention: it
   * is a draw of the probe's own render list, so the camera is the probe itself. The shadow maps'
   * own draws come through here with the light's camera and no scene at all (WebGLShadowMap passes
   * null), so casters were never in question; but a direct draw made by something else while this
   * pass is running -- a geometry product drawn out of an `onAfterRender`, say (nothing does that
   * today: the velocity pass's direct draws run inside `PostFX.end`, after `render` has returned)
   * -- would have been swallowed by a scene-is-null test with no error and no counter anyone reads,
   * and the fault would have looked like a missing effect rather than a dropped draw. Such a draw
   * is made as it asks and counted in `SHADOW_STRAYS.foreign`, which should stay at nought.
   *
   * Measured on one world, booted both ways (`?shadowStrays=1` and a reload, with
   * `__debug.passLog()` for the rest): the world pass, the interiors, the portals and the depth
   * reset draw the same number of calls and the same number of triangles to the last one, and only
   * the shadow pass differs, by exactly the strays. On a planet it was nine whole programs and four
   * of the twenty-one a ship spawned in play used to build; in a space zone, eighteen.
   */
  private hookDraws(): void {
    const r = this.renderer;
    const direct = r.renderBufferDirect.bind(r);
    r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      if (this.shadingShadows && scene !== null) {
        if (camera === this.shadowProbe) {
          this.strays++;
          if (!SHADOW_STRAYS.keep) return;
        } else SHADOW_STRAYS.foreign++;
      }
      // Counted for the frame report: a shadow pass's draw with no scene is a real caster, and the
      // light's camera says which cascade it went into.
      if (PERF.timing) perf.draw(object, this.shadingShadows && scene === null ? camera : null);
      this.drawing = object;
      direct(camera, scene, geometry, material, object, group);
    };
  }

  private quarantine(target: THREE.Object3D, _camera: THREE.Camera, err: unknown): void {
    const culprit: THREE.Object3D | null = this.drawing;
    const why = String((err as Error)?.message ?? err);
    if (culprit) {
      culprit.visible = false;
      // For good: a room's meshes and its furniture are shown pass by pass, and would be shown again.
      markQuarantined(culprit);
      const m = culprit as THREE.Mesh;
      const geo = m.geometry as THREE.BufferGeometry | undefined;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined;
      // The renderer's own record of the material: the uniforms its program will read, and which of them have no value.
      const props = mat ? (this.renderer.properties.get(mat) as { uniforms?: Record<string, { value: unknown }> }) : null;
      const valueless = Object.entries(props?.uniforms ?? {}).filter(([, u]) => u && u.value === undefined).map(([k]) => k);
      const detail = { name: culprit.name || '(unnamed)', type: culprit.type, parent: culprit.parent?.name || culprit.parent?.type, layers: culprit.layers.mask, attributes: geo ? Object.keys(geo.attributes) : [], index: geo ? !!geo.index : false, groups: geo?.groups?.length ?? 0, drawRange: geo ? [geo.drawRange.start, geo.drawRange.count] : null, material: mat?.type, materialName: mat?.name, defines: mat?.defines ? Object.keys(mat.defines) : [], ownHook: !!mat && mat.onBeforeCompile.toString().length > 40 ? 'yes' : 'no', uniforms: (mat as THREE.ShaderMaterial | undefined)?.uniforms ? Object.keys((mat as THREE.ShaderMaterial).uniforms) : undefined, valueless, userData: culprit.userData };
      this.broken.push({ name: detail.name, type: detail.type, why });
      console.error(`render: hid an object that fails to draw (${why}): ${JSON.stringify(detail)}`, err);
    } else {
      this.broken.push({ name: '(not found)', type: target.type, why });
      console.error(`render: a pass failed (${why}) and no single object reproduces it:`, err);
    }
  }

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.hookDraws();
    // A skeleton is worked out once a frame inside `render`, not once a pass (commit 3b, `skeletonOnce.ts`).
    installSkeletonOnce();
    this.portalMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: true, side: THREE.DoubleSide });
    this.portalMat.stencilWrite = true;
    this.portalMat.stencilZPass = THREE.ReplaceStencilOp;
    this.portalMat.stencilFail = THREE.KeepStencilOp;
    this.portalMat.stencilZFail = THREE.KeepStencilOp;
    // Full-screen triangle at the far plane: resets depth inside the current stencil region.
    this.resetMat = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
      colorWrite: false,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
    });
    this.resetMat.stencilWrite = true;
    this.resetMat.stencilFunc = THREE.EqualStencilFunc;
    this.resetMat.stencilFail = THREE.KeepStencilOp;
    this.resetMat.stencilZFail = THREE.KeepStencilOp;
    this.resetMat.stencilZPass = THREE.KeepStencilOp;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.resetQuad = new THREE.Mesh(g, this.resetMat);
    this.resetQuad.frustumCulled = false;
    // Drawn on its own whatever layer the camera is set to for the current pass.
    this.resetQuad.layers.enableAll();
    // A doorway's polygon stood in for, to warm its program by: a building's own are made as it is first
    // drawn, and each is a position-only mesh of the one material, which is all its program is keyed on.
    this.portalStandIn = new THREE.Mesh(g, this.portalMat);
    this.portalStandIn.frustumCulled = false;
    this.portalStandIn.layers.enableAll();
    this.shadowProbe.layers.enableAll();
    this.shadowProbe.position.set(0, -1e6, 0);
    this.shadowProbe.updateMatrixWorld();
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
  }

  /**
   * What this renderer draws of its own, each as a scene of its own with no lights and no fog: a doorway's
   * stencil polygon (stood in for) and the depth reset behind the doorways. Neither is in any scene a
   * loading screen compiles, so their two programs were built on the first live frame that drew a doorway
   * -- the first time a view looked at a building's doors from outside or stood inside one, which on a
   * shuttle's first lift-off of a session is the view rising over its own starport. Compiled exactly as
   * they are drawn, by the world's own sweep behind every loading screen (`World.compileEverything`).
   */
  ownDraws(): THREE.Object3D[] {
    return [this.portalStandIn, this.resetQuad];
  }

  /** Every material must take part in the stencil test (the second argument is kept for callers). */
  registerMaterial(m: THREE.Material, _interior = false): void {
    if (this.materials.has(m)) return;
    m.stencilWrite = true;
    m.stencilFunc = THREE.EqualStencilFunc;
    m.stencilRef = 1;
    m.stencilFuncMask = 0xff;
    m.stencilFail = THREE.KeepStencilOp;
    m.stencilZFail = THREE.KeepStencilOp;
    m.stencilZPass = THREE.KeepStencilOp;
    this.materials.add(m);
  }

  forget(m: THREE.Material): void {
    this.materials.delete(m);
  }

  private setRef(ref: number): void {
    for (const m of this.materials) m.stencilRef = ref;
  }

  private meshesFor(b: Building): THREE.Mesh[] {
    let list = this.portalMeshes.get(b);
    if (!list) {
      list = b.model.portals.map((p) => {
        const verts: number[] = [];
        for (const v of p.verts) verts.push(v.x, v.y, v.z);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        g.setIndex(p.indices);
        const mesh = new THREE.Mesh(g, this.portalMat);
        // Rendered standalone (no scene), so the world matrix is set by hand and never recomputed.
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(b.matrix);
        mesh.matrixWorld.copy(b.matrix);
        mesh.frustumCulled = false;
        mesh.layers.enableAll();
        return mesh;
      });
      this.portalMeshes.set(b, list);
    }
    return list;
  }

  /**
   * Stencil portal polygons: where the region value equals `from` (and the polygon is visible),
   * increment it. `restore` instead moves the region these polygons opened (2) on to 3, undoing a
   * pass while marking where rooms were drawn.
   */
  private drawPortals(meshes: THREE.Mesh[], n: number, camera: THREE.Camera, from: number, depthTest: boolean, restore = false): void {
    const m = this.portalMat;
    if (restore) {
      // Leave the doors' rooms region at 3 instead of writing 1 back: a later building's doors
      // (which need 1) and its depth reset and rooms (which need 2) still skip it, and the effects
      // can tell rooms seen through a door from the world around them (the ambient occlusion lights
      // them with the rooms' lights). The Equal 2 test increments each pixel once however many
      // polygons cover it.
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilRef = 2;
      m.stencilZPass = THREE.IncrementStencilOp;
    } else {
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilRef = from;
      m.stencilZPass = THREE.IncrementStencilOp;
    }
    m.stencilFuncMask = 0xff;
    m.depthTest = depthTest;
    for (let i = 0; i < n; i++) this.pass('portal', meshes[i], camera, PASS.doorways);
  }

  private resetDepth(ref: number, camera: THREE.Camera): void {
    this.resetMat.stencilRef = ref;
    this.pass('depth reset', this.resetQuad, camera, PASS.doorways);
  }

  private renderLayer(scene: THREE.Scene, camera: THREE.Camera, layer: number): void {
    camera.layers.set(layer);
    camera.layers.enable(ACTOR_LAYER);
    const interior = layer === INTERIOR_LAYER;
    this.pass(interior ? 'interior' : 'world', scene, camera, interior ? PASS.interior : PASS.world);
  }

  /**
   * Show a building's rooms, or hide them. With `seen` (the frame's set, commit 1c) only the rooms it
   * marks seen are shown; a room it knows nothing of is shown. Answers how many meshes it showed.
   */
  private showInterior(b: Building, on: boolean, seen: Uint8Array | null = null): number {
    const list = b.interior;
    const cells = seen ? b.interiorCell : undefined;
    let shown = 0;
    for (let i = 0; i < list.length; i++) {
      let show = on;
      if (show && seen && cells && i < cells.length) {
        const c = cells[i];
        show = c < 0 || c >= seen.length || seen[c] === 1;
      }
      // A mesh hidden for failing to draw stays hidden: shown again, it would throw on every frame.
      if (show && isQuarantined(list[i])) show = false;
      list[i].visible = show;
      if (show) shown++;
    }
    // Its furniture, drawn per building (commit 2b): a group is shown with the rooms when one of the rooms
    // its copies can be in is seen, and only once its programs exist. A group not routed is the streamer's.
    const f = b.furniture;
    if (f) {
      for (let i = 0; i < f.length; i++) {
        const g = f[i];
        if (!g.routed) continue;
        const show = on && g.ready && (seen === null || maskSeen(g.lo, g.hi, g.any, seen)) && !isQuarantined(g.mesh);
        g.mesh.visible = show;
        if (show && on) this.furnitureShown++;
      }
    }
    return shown;
  }

  /**
   * The building's exit portals (doors and windows onto the world) that could be on screen: within
   * their range of the camera (`doorRangeOf`, the old fixed 120 m while the door range is off) and with
   * their sphere in the frustum. Fills the kept `exitList` and answers how many.
   */
  private exitPortals(b: Building, camera: THREE.Camera): number {
    const out = this.exitList;
    let n = 0;
    if (this.vis.withinReach(b, camera.position, true)) {
      const meshes = this.meshesFor(b);
      const np = b.model.portals.length;
      for (let k = 0; k < np; k++) {
        if (!this.vis.isExit(b, k) || !this.vis.doorInRange(b, k, camera.position)) continue;
        if (!frustum.intersectsSphere(this.vis.portalSphere(b, k, tmpS))) continue;
        out[n++] = meshes[k];
      }
    }
    return n;
  }

  /**
   * The buildings drawn through their doors from outside: those whose middle is within their radius and
   * their widest door's range of the camera, nearest first, at most `MAX_BUILDINGS`. Kept arrays, and
   * the same answer a stable sort by distance gave; answers how many.
   */
  private selectNear(camera: THREE.Camera, buildings: Iterable<Building>): number {
    const near = this.near;
    const nd = this.nearD;
    const measured = this.vis.measured;
    let n = 0;
    for (const b of buildings) {
      if (!this.vis.withinReach(b, camera.position, false)) continue;
      const d = measured[0];
      if (n === MAX_BUILDINGS && d >= nd[n - 1]) continue;
      let i = n < MAX_BUILDINGS ? n++ : n - 1;
      while (i > 0 && nd[i - 1] > d) {
        near[i] = near[i - 1];
        nd[i] = nd[i - 1];
        i--;
      }
      near[i] = b;
      nd[i] = d;
    }
    for (let i = n; i < MAX_BUILDINGS; i++) near[i] = null;
    return n;
  }

  /**
   * The camera's building and room, walked from the player's room along the line from the eye to the
   * camera (`walkCameraCell`). Answers the kept `camCell`.
   */
  cameraCell(player: CellState | null, eye: THREE.Vector3, cam: THREE.Vector3, buildings: Iterable<Building>): CameraCell<Building> {
    return walkCameraCell(player?.building ?? null, player?.cell ?? 0, eye, cam, buildings, this.camCell, this.camNear);
  }

  /**
   * Work out the frame's visible set, once, after `cameraCell` and before `render`, with the camera's
   * final pose (commit 1a). With the set switched off nothing is known and nothing is cut.
   */
  computeVisibility(camera: THREE.PerspectiveCamera, buildings: Iterable<Building>): void {
    if (!PORTAL_CULL.on) {
      this.vis.invalidate();
      this.visFresh = false;
      return;
    }
    this.renderer.getDrawingBufferSize(this.bufferSize);
    const inside = this.camCell.building;
    const n = inside ? 0 : this.selectNear(camera, buildings);
    this.vis.compute(camera, inside, this.camCell.cell, this.near as Building[], n, this.bufferSize.x, this.bufferSize.y);
    this.visFresh = true;
    perf.count(CNT.cullVisits, this.vis.result.visits);
  }

  /**
   * Shade the shadow maps once, with everything that will appear this frame (the world, the
   * building the camera is in), so every pass shares the same lighting.
   */
  private renderShadows(scene: THREE.Scene, view: Building | null): void {
    const r = this.renderer;
    // Off, or faded to nothing by a storm (the cascades' intensity is 0, so the stale maps cannot show).
    if (!r.shadowMap.enabled || !this.shadowsWanted) {
      SHADOW_STRAYS.seen = 0;
      return;
    }
    // The rooms of the building the camera is in cast into the sun's shadows only with furniture drawn
    // everywhere, as before (commit 2b): no room is lit by the sun, and the shell outside casts the same shadow.
    if (furnitureOn()) view = null;
    if (view) this.showInterior(view, true);
    r.shadowMap.needsUpdate = true;
    this.shadingShadows = true;
    try {
      this.pass('shadows', scene, this.shadowProbe, PASS.shadows);
    } finally {
      this.shadingShadows = false;
      // Once for the pass, not once for each stray: read as its own sentence ("what the last
      // shadow pass met"), a count written only where there was something to count says N for ever
      // after the frame that last met one.
      SHADOW_STRAYS.seen = this.strays;
      perf.count(CNT.strays, this.strays);
    }
    if (view) this.showInterior(view, false);
  }

  /**
   * Walk the scene's matrices once a frame rather than once a pass. `renderer.render` begins by
   * recomposing every node of the scene it is given, and a frame here is up to eight calls that
   * take the whole scene (the shadows, the world, one interior per near building; three inside).
   * Nothing moves between the passes of one frame, so after the first the scene's
   * `matrixWorldAutoUpdate` is turned off, and put back when the frame is drawn. With a crowd out
   * that was the largest thing it added. False draws the old way, for measuring the difference
   * (`__debug.mobileTune({ passMatrices: 'every' })`).
   */
  matrixOnce = true;

  /**
   * Draw the frame. `view` is the building the camera is in (null = outside); `buildings` are
   * the loaded portal buildings.
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, view: Building | null, buildings: Iterable<Building>): void {
    const r = this.renderer;
    const auto = scene.matrixWorldAutoUpdate;
    // The frame's visible set, read only when it was worked out for this very frame and this view.
    const vis = this.visFresh && this.vis.result.valid && this.vis.result.inside === view ? this.vis : null;
    this.visFresh = false;
    const rooms = vis !== null && PORTAL_CULL.mode === 'rooms';
    // Inside with no exit reachable: no world pass, no shadow pass (sunlight reaches no pixel of a room,
    // and only world pixels read the cascades), and main skips the weather (commit 1b).
    const skipWorld = rooms && view !== null && PORTAL_CULL.insideSkip && !this.vis.result.worldSeen;
    const seenRooms = rooms && PORTAL_CULL.seenRooms;
    const narrow = rooms && PORTAL_CULL.exitNarrow;
    // What moves on its own, drawn in its own rooms' passes only (commit 2a): the game collected this
    // frame's records and hid the unseen before the frame; each pass below chooses from the rest.
    const routes = rooms && cullOn('actorRoutes') && this.actors.active ? this.actors : null;
    this.worldSkipped = skipWorld;
    this.roomMeshes = 0;
    this.furnitureShown = 0;
    this.narrowStats.tested = 0;
    this.narrowStats.hidden = 0;
    // Once a pass has taken the whole scene its matrices are fresh for the rest of the frame
    // (turned off inline at each such pass, so no closure is made per frame).
    // And so are the bones: every skeleton is worked out on its first draw of the frame and skipped on
    // every later one, in every pass and cascade, until the `finally` below closes the frame (commit 3b).
    beginSkeletonFrame();
    try {
      this.passes = 0;
      this.strays = 0;
      this.passLog.length = 0;
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      // The frame an exit comes into view the shadows are drawn here, before the world pass, so nothing pops.
      if (skipWorld) {
        SHADOW_STRAYS.seen = 0;
        perf.count(CNT.cullSkips, 1);
      } else {
        // Only what stands outdoors casts into the sun's shadows.
        routes?.route(ROUTE_PASS.shadows, null, null);
        this.renderShadows(scene, view);
      }
      // The shadow pass, when there is one, walked the scene.
      if (this.passes > 0 && this.matrixOnce) scene.matrixWorldAutoUpdate = false;
      r.state.buffers.stencil.setClear(1);
      r.clear(true, true, true);
      this.setRef(1);

      if (view) {
        // Inside: the whole building fills the screen; the world only through its exits.
        routes?.route(ROUTE_PASS.building, view, null);
        this.roomMeshes += this.showInterior(view, true, seenRooms ? this.vis.seenOf(view) : null);
        this.renderLayer(scene, camera, INTERIOR_LAYER);
        if (this.matrixOnce) scene.matrixWorldAutoUpdate = false;
        this.showInterior(view, false);
        if (skipWorld) return;
        const exits = this.exitPortals(view, camera);
        if (!exits) return;
        this.drawPortals(this.exitList, exits, camera, 1, true);
        this.resetDepth(2, camera);
        this.setRef(2);
        // Hide, for this pass only, every ground chunk, far tile and placed object whose sphere misses the
        // frustum through the exits' rectangle; the shadows were drawn already and the projection is untouched.
        if (narrow && this.vis.result.worldSeen) this.narrowing.hide(this.vis.result.exitRect, projView);
        // What stands outdoors, and of that only what the exits' rectangle can show.
        if (routes) routes.route(ROUTE_PASS.world, null, this.vis.result.worldSeen && exitFrustum(this.vis.result.exitRect, projView, this.routeFrustum) ? this.routeFrustum : null);
        try {
          this.renderLayer(scene, camera, 0);
        } finally {
          this.narrowing.restore();
        }
        return;
      }

      // Outside: the world, then each nearby building's interior through its doors.
      routes?.route(ROUTE_PASS.world, null, null);
      this.renderLayer(scene, camera, 0);
      if (this.matrixOnce) scene.matrixWorldAutoUpdate = false;
      const n = this.selectNear(camera, buildings);
      for (let i = 0; i < n; i++) {
        const b = this.near[i] as Building;
        // No room of it can be seen through any door on screen: nothing to draw (commit 1c).
        if (seenRooms && !this.vis.anySeen(b)) continue;
        const doors = this.exitPortals(b, camera);
        if (!doors) continue;
        this.drawPortals(this.exitList, doors, camera, 1, true);
        this.resetDepth(2, camera);
        this.setRef(2);
        // What stands in this building's rooms, and nothing else.
        routes?.route(ROUTE_PASS.building, b, null);
        this.roomMeshes += this.showInterior(b, true, seenRooms ? this.vis.seenOf(b) : null);
        this.renderLayer(scene, camera, INTERIOR_LAYER);
        this.showInterior(b, false);
        this.setRef(1);
        this.drawPortals(this.exitList, doors, camera, 1, false, true);
      }
    } finally {
      scene.matrixWorldAutoUpdate = auto;
      endSkeletonFrame();
      // Every routed thing back as the frame left it; what no view pass drew stays hidden through the effects.
      routes?.endPasses();
      perf.count(CNT.cullRooms, this.roomMeshes);
      perf.count(CNT.cullNarrowed, this.narrowStats.hidden);
      perf.count(CNT.furnitureShown, this.furnitureShown);
      if (routes) {
        const st = routes.stats;
        perf.count(CNT.routeRecords, st.records);
        perf.count(CNT.routeHidden, st.hidden);
        perf.count(CNT.routeUndrawn, st.undrawn);
      }
    }
  }
}
