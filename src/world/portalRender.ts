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

import * as THREE from 'three';
import type { Building, CellState } from './layoutStream';
import { isShadowOnly } from '../core/fxRegistry.ts';

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
const PORTAL_RANGE = 120;
const MAX_BUILDINGS = 6;
/** Doorways count as reaching this far above their polygon when deciding which side the camera is on. */
const DOOR_HEADROOM = 4;

/**
 * Actors are visible from inside and outside alike; what first person has put on the shadow-only
 * layer stays there, so nothing that prepares or marks the player brings the hidden head back into view.
 */
export function markActor(o: THREE.Object3D): void {
  o.traverse((x) => {
    if (!isShadowOnly(x.layers.mask)) x.layers.enable(ACTOR_LAYER);
  });
}

const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpS = new THREE.Sphere();
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();

export class PortalRenderer {
  readonly materials = new Set<THREE.Material>();
  /**
   * Shadow maps are shaded through this camera: it sees every layer (so every caster counts)
   * but its frustum holds nothing, so the render that carries the shadow pass draws nothing.
   */
  private readonly shadowProbe = new THREE.PerspectiveCamera(1, 1, 0.001, 0.002);
  private readonly portalMat: THREE.MeshBasicMaterial;
  private readonly resetMat: THREE.ShaderMaterial;
  private readonly resetQuad: THREE.Mesh;
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
  private pass(label: string, target: THREE.Object3D, camera: THREE.Camera): void {
    const info = this.renderer.info.render;
    const c0 = info.calls;
    const t0 = info.triangles;
    try {
      this.renderer.render(target as THREE.Scene, camera);
    } catch (err) {
      this.quarantine(target, camera, err);
    }
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
      this.drawing = object;
      direct(camera, scene, geometry, material, object, group);
    };
  }

  private quarantine(target: THREE.Object3D, _camera: THREE.Camera, err: unknown): void {
    const culprit: THREE.Object3D | null = this.drawing;
    const why = String((err as Error)?.message ?? err);
    if (culprit) {
      culprit.visible = false;
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
    this.shadowProbe.layers.enableAll();
    this.shadowProbe.position.set(0, -1e6, 0);
    this.shadowProbe.updateMatrixWorld();
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
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
  private drawPortals(meshes: THREE.Mesh[], camera: THREE.Camera, from: number, depthTest: boolean, restore = false): void {
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
    for (const mesh of meshes) this.pass('portal', mesh, camera);
  }

  private resetDepth(ref: number, camera: THREE.Camera): void {
    this.resetMat.stencilRef = ref;
    this.pass('depth reset', this.resetQuad, camera);
  }

  private renderLayer(scene: THREE.Scene, camera: THREE.Camera, layer: number): void {
    camera.layers.set(layer);
    camera.layers.enable(ACTOR_LAYER);
    this.pass(layer === INTERIOR_LAYER ? 'interior' : 'world', scene, camera);
  }

  private showInterior(b: Building, on: boolean): void {
    for (const m of b.interior) m.visible = on;
  }

  /** The building's exit portals (doors and windows onto the world) that could be on screen. */
  private exitPortals(b: Building, camera: THREE.Camera): THREE.Mesh[] {
    if (Math.abs(b.x - camera.position.x) > b.radius + PORTAL_RANGE || Math.abs(b.z - camera.position.z) > b.radius + PORTAL_RANGE) return [];
    const meshes = this.meshesFor(b);
    const out: THREE.Mesh[] = [];
    b.model.portals.forEach((p, index) => {
      if (!p.links.some((l) => l.from === 0 || l.to === 0)) return;
      tmpV.set(0, 0, 0);
      for (const v of p.verts) tmpV.add(v);
      tmpV.multiplyScalar(1 / p.verts.length).applyMatrix4(b.matrix);
      if (tmpV.distanceTo(camera.position) > PORTAL_RANGE) return;
      let r = 0;
      for (const v of p.verts) r = Math.max(r, tmpA.copy(v).applyMatrix4(b.matrix).distanceTo(tmpV));
      tmpS.set(tmpV, r);
      if (!frustum.intersectsSphere(tmpS)) return;
      out.push(meshes[index]);
    });
    return out;
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
    if (view) this.showInterior(view, true);
    r.shadowMap.needsUpdate = true;
    this.shadingShadows = true;
    try {
      this.pass('shadows', scene, this.shadowProbe);
    } finally {
      this.shadingShadows = false;
      // Once for the pass, not once for each stray: read as its own sentence ("what the last
      // shadow pass met"), a count written only where there was something to count says N for ever
      // after the frame that last met one.
      SHADOW_STRAYS.seen = this.strays;
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
    // Once a pass has taken the whole scene its matrices are fresh for the rest of the frame
    // (turned off inline at each such pass, so no closure is made per frame).
    try {
      this.passes = 0;
      this.strays = 0;
      this.passLog.length = 0;
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      this.renderShadows(scene, view);
      // The shadow pass, when there is one, walked the scene.
      if (this.passes > 0 && this.matrixOnce) scene.matrixWorldAutoUpdate = false;
      r.state.buffers.stencil.setClear(1);
      r.clear(true, true, true);
      this.setRef(1);

      if (view) {
        // Inside: the whole building fills the screen; the world only through its exits.
        this.showInterior(view, true);
        this.renderLayer(scene, camera, INTERIOR_LAYER);
        if (this.matrixOnce) scene.matrixWorldAutoUpdate = false;
        this.showInterior(view, false);
        const exits = this.exitPortals(view, camera);
        if (!exits.length) return;
        this.drawPortals(exits, camera, 1, true);
        this.resetDepth(2, camera);
        this.setRef(2);
        this.renderLayer(scene, camera, 0);
        return;
      }

      // Outside: the world, then each nearby building's interior through its doors.
      this.renderLayer(scene, camera, 0);
      if (this.matrixOnce) scene.matrixWorldAutoUpdate = false;
      const near: { b: Building; d: number }[] = [];
      for (const b of buildings) {
        const d = Math.hypot(b.x - camera.position.x, b.z - camera.position.z);
        if (d < b.radius + PORTAL_RANGE) near.push({ b, d });
      }
      near.sort((a, c) => a.d - c.d);
      for (const { b } of near.slice(0, MAX_BUILDINGS)) {
        const doors = this.exitPortals(b, camera);
        if (!doors.length) continue;
        this.drawPortals(doors, camera, 1, true);
        this.resetDepth(2, camera);
        this.setRef(2);
        this.showInterior(b, true);
        this.renderLayer(scene, camera, INTERIOR_LAYER);
        this.showInterior(b, false);
        this.setRef(1);
        this.drawPortals(doors, camera, 1, false, true);
      }
    } finally {
      scene.matrixWorldAutoUpdate = auto;
    }
  }

  /**
   * The building the camera is in, if any: starting from the player's side of things, walk the
   * line from the eye to the camera through whichever exit portals it crosses. Doorways are
   * taken to reach up to the ceiling, since a camera above the lintel got there through the door.
   */
  cameraBuilding(player: CellState | null, eye: THREE.Vector3, cam: THREE.Vector3, buildings: Iterable<Building>): Building | null {
    let inside: Building | null = player?.building ?? null;
    const near: Building[] = [];
    for (const b of buildings) if (Math.abs(b.x - cam.x) < b.radius + 30 && Math.abs(b.z - cam.z) < b.radius + 30) near.push(b);
    let from = eye;
    for (let hop = 0; hop < 4; hop++) {
      let best: { b: Building; t: number } | null = null;
      for (const b of inside ? [inside] : near) {
        tmpA.copy(from).applyMatrix4(b.inverse);
        tmpB.copy(cam).applyMatrix4(b.inverse);
        for (const p of b.model.portals) {
          if (!p.links.some((l) => l.from === 0 || l.to === 0)) continue;
          const t = crossing(p, tmpA, tmpB, DOOR_HEADROOM);
          if (t !== null && (!best || t < best.t)) best = { b, t };
        }
      }
      if (!best) return inside;
      const hit = best as { b: Building; t: number };
      inside = inside ? null : hit.b;
      from = from.clone().lerp(cam, Math.min(1, hit.t + 1e-3));
    }
    return inside;
  }
}

/**
 * Parameter along a-b where the segment crosses one of the portal's triangles, or null. With
 * `headroom`, a crossing up to that far above the polygon still counts (the doorway is taken to
 * continue upward).
 */
export function crossing(portal: import('./assetPack').Portal, a: THREE.Vector3, b: THREE.Vector3, headroom = 0): number | null {
  const da = portal.normal.dot(a) - portal.d;
  const db = portal.normal.dot(b) - portal.d;
  if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) return null;
  const t = da / (da - db);
  const hit = tmpV.copy(a).lerp(b, t);
  const idx = portal.indices;
  const v = portal.verts;
  if (headroom > 0) {
    let top = -Infinity;
    for (const p of v) top = Math.max(top, p.y);
    if (hit.y > top && hit.y < top + headroom) hit.y = top - 1e-3;
  }
  for (let k = 0; k + 2 < idx.length; k += 3) {
    if (pointInTriangle(hit, v[idx[k]], v[idx[k + 1]], v[idx[k + 2]])) return t;
  }
  return null;
}

const e0 = new THREE.Vector3();
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();

function pointInTriangle(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): boolean {
  e0.subVectors(c, a);
  e1.subVectors(b, a);
  e2.subVectors(p, a);
  const dot00 = e0.dot(e0);
  const dot01 = e0.dot(e1);
  const dot02 = e0.dot(e2);
  const dot11 = e1.dot(e1);
  const dot12 = e1.dot(e2);
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-12) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const w = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= -1e-4 && w >= -1e-4 && u + w <= 1 + 1e-4;
}
