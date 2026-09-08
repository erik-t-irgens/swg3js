// Portal rendering, the way the original client draws buildings: only the cell the camera is
// in is drawn in full; every other cell (and the outside world) is drawn only through the
// door portals that lead to it, clipped by a stencil mask and with depth reset behind the
// door. Exterior shells never intersect interiors and rooms bigger than their shells work.
//
// Layers: 0 = the world (terrain, shells, props), 1 = interior cell meshes (each building owns
// its own, kept hidden except for the one cell being drawn), 31 = actors (player, creatures,
// vehicles, effects, lights) which are drawn in every pass.

import * as THREE from 'three';
import type { Building, CellState } from './layoutStream';

export const ACTOR_LAYER = 31;
export const INTERIOR_LAYER = 1;
const PORTAL_RANGE = 90;
const MAX_PORTALS = 8;
const MAX_SECOND_LEVEL = 3;

/** Actors are visible from inside and outside alike. */
export function markActor(o: THREE.Object3D): void {
  o.traverse((x) => x.layers.enable(ACTOR_LAYER));
}

interface PortalDraw {
  building: Building;
  index: number;
  mesh: THREE.Mesh;
  dist: number;
}

const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();

export class PortalRenderer {
  readonly worldMaterials = new Set<THREE.Material>();
  readonly interiorMaterials = new Set<THREE.Material>();
  private readonly portalMat: THREE.MeshBasicMaterial;
  private readonly resetMat: THREE.ShaderMaterial;
  private readonly resetQuad: THREE.Mesh;
  private readonly portalMeshes = new WeakMap<Building, THREE.Mesh[]>();
  /** Passes drawn last frame, for the stats overlay. */
  passes = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
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
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
  }

  /** Every lit material must take part in the stencil test; interior materials are tracked apart. */
  registerMaterial(m: THREE.Material, interior: boolean): void {
    if (this.worldMaterials.has(m) || this.interiorMaterials.has(m)) return;
    m.stencilWrite = true;
    m.stencilFunc = THREE.EqualStencilFunc;
    m.stencilRef = 1;
    m.stencilFuncMask = 0xff;
    m.stencilFail = THREE.KeepStencilOp;
    m.stencilZFail = THREE.KeepStencilOp;
    m.stencilZPass = THREE.KeepStencilOp;
    (interior ? this.interiorMaterials : this.worldMaterials).add(m);
  }

  forget(m: THREE.Material): void {
    this.worldMaterials.delete(m);
    this.interiorMaterials.delete(m);
  }

  private setRef(set: Set<THREE.Material>, ref: number): void {
    for (const m of set) m.stencilRef = ref;
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
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(b.matrix);
        mesh.frustumCulled = false;
        return mesh;
      });
      this.portalMeshes.set(b, list);
    }
    return list;
  }

  /**
   * Stencil a portal polygon: where the region value equals `from` (and the polygon is visible),
   * increment it. `restore` instead writes 1 everywhere the polygon covers, undoing a pass.
   */
  private drawPortal(mesh: THREE.Mesh, camera: THREE.Camera, from: number, depthTest: boolean, restore = false): void {
    const m = this.portalMat;
    if (restore) {
      m.stencilFunc = THREE.AlwaysStencilFunc;
      m.stencilRef = 1;
      m.stencilZPass = THREE.ReplaceStencilOp;
    } else {
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilRef = from;
      m.stencilZPass = THREE.IncrementStencilOp;
    }
    m.stencilFuncMask = 0xff;
    m.depthTest = depthTest;
    this.renderer.render(mesh, camera);
    this.passes++;
  }

  private resetDepth(ref: number, camera: THREE.Camera): void {
    this.resetMat.stencilRef = ref;
    this.renderer.render(this.resetQuad, camera);
  }

  private renderLayer(scene: THREE.Scene, camera: THREE.Camera, layer: number): void {
    camera.layers.set(layer);
    camera.layers.enable(ACTOR_LAYER);
    this.renderer.render(scene, camera);
    this.passes++;
  }

  /** Draw one cell of one building (plus actors): only its meshes are shown for the pass. */
  private renderCell(scene: THREE.Scene, camera: THREE.Camera, b: Building, cell: number): void {
    const meshes = b.interior.get(cell) ?? [];
    for (const m of meshes) m.visible = true;
    this.renderLayer(scene, camera, INTERIOR_LAYER);
    for (const m of meshes) m.visible = false;
  }

  /** Portals of a cell that could be on screen, nearest first. */
  private visiblePortals(b: Building, cell: number, camera: THREE.Camera, exclude = -1): PortalDraw[] {
    const meshes = this.meshesFor(b);
    const out: PortalDraw[] = [];
    b.model.portals.forEach((p, index) => {
      if (index === exclude || !p.passable) return;
      if (!p.links.some((l) => l.from === cell || l.to === cell)) return;
      tmpV.set(0, 0, 0);
      for (const v of p.verts) tmpV.add(v);
      tmpV.multiplyScalar(1 / p.verts.length).applyMatrix4(b.matrix);
      const dist = tmpV.distanceTo(camera.position);
      if (dist > PORTAL_RANGE || !frustum.containsPoint(tmpV)) {
        // Also accept portals whose polygon straddles the frustum edge: cheap sphere test.
        let r = 0;
        for (const v of p.verts) r = Math.max(r, tmpA.copy(v).applyMatrix4(b.matrix).distanceTo(tmpV));
        if (dist > PORTAL_RANGE || !frustum.intersectsSphere(new THREE.Sphere(tmpV.clone(), r))) return;
      }
      out.push({ building: b, index, mesh: meshes[index], dist });
    });
    out.sort((a, c) => a.dist - c.dist);
    return out;
  }

  private otherSide(b: Building, index: number, cell: number): number {
    const p = b.model.portals[index];
    const link = p.links.find((l) => l.from === cell) ?? p.links.find((l) => l.to === cell);
    if (!link) return -1;
    return link.from === cell ? link.to : link.from;
  }

  /**
   * Draw the frame. `view` is the cell the camera is in (null = outside); `buildings` are the
   * loaded portal buildings.
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, view: CellState | null, buildings: Iterable<Building>): void {
    const r = this.renderer;
    this.passes = 0;
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    r.shadowMap.needsUpdate = true;
    r.state.buffers.stencil.setClear(1);
    r.clear(true, true, true);
    // Every material starts the frame in the base region, whatever pass touched it last frame.
    this.setRef(this.worldMaterials, 1);
    this.setRef(this.interiorMaterials, 1);

    if (!view) {
      this.renderLayer(scene, camera, 0);
      const doors: PortalDraw[] = [];
      for (const b of buildings) {
        if (Math.abs(b.x - camera.position.x) > b.radius + PORTAL_RANGE || Math.abs(b.z - camera.position.z) > b.radius + PORTAL_RANGE) continue;
        doors.push(...this.visiblePortals(b, 0, camera));
      }
      doors.sort((a, c) => a.dist - c.dist);
      for (const d of doors.slice(0, MAX_PORTALS)) {
        const cell = this.otherSide(d.building, d.index, 0);
        if (cell <= 0) continue;
        this.throughPortal(scene, camera, d, cell, 2);
        this.drawPortal(d.mesh, camera, 1, false, true);
      }
      return;
    }

    // Inside: the camera's cell fills the screen; everything else only through its portals.
    this.renderCell(scene, camera, view.building, view.cell);
    for (const d of this.visiblePortals(view.building, view.cell, camera).slice(0, MAX_PORTALS)) {
      const target = this.otherSide(d.building, d.index, view.cell);
      if (target < 0) continue;
      this.throughPortal(scene, camera, d, target, 2);
      this.drawPortal(d.mesh, camera, 1, false, true);
    }
  }

  /** Stencil a portal seen from region `ref - 1`, reset depth behind it and draw `cell` (0 = world), one level deeper too. */
  private throughPortal(scene: THREE.Scene, camera: THREE.PerspectiveCamera, d: PortalDraw, cell: number, ref: number): void {
    this.drawPortal(d.mesh, camera, ref - 1, true);
    this.resetDepth(ref, camera);
    if (cell === 0) {
      this.setRef(this.worldMaterials, ref);
      this.renderLayer(scene, camera, 0);
      return;
    }
    this.setRef(this.interiorMaterials, ref);
    this.renderCell(scene, camera, d.building, cell);
    if (ref >= 3) return;
    for (const next of this.visiblePortals(d.building, cell, camera, d.index).slice(0, MAX_SECOND_LEVEL)) {
      const target = this.otherSide(d.building, next.index, cell);
      if (target < 0) continue;
      this.throughPortal(scene, camera, next, target, ref + 1);
    }
  }

  /**
   * The cell the camera is in, walking portals from the player's cell along the line to the
   * camera (the camera never passes through walls, only doorways).
   */
  cameraCell(player: CellState | null, eye: THREE.Vector3, cam: THREE.Vector3, buildings: Iterable<Building>): CellState | null {
    let state = player;
    const candidates: Building[] = [];
    if (state) candidates.push(state.building);
    else for (const b of buildings) if (Math.abs(b.x - cam.x) < b.radius + 30 && Math.abs(b.z - cam.z) < b.radius + 30) candidates.push(b);
    for (let hop = 0; hop < 4; hop++) {
      let best: { b: Building; index: number; t: number } | null = null;
      for (const b of candidates) {
        const cell = state && state.building === b ? state.cell : 0;
        if (state && state.building !== b) continue;
        tmpA.copy(eye).applyMatrix4(b.inverse);
        tmpB.copy(cam).applyMatrix4(b.inverse);
        b.model.portals.forEach((p, index) => {
          if (!p.passable || !p.links.some((l) => l.from === cell || l.to === cell)) return;
          const t = crossing(p, tmpA, tmpB);
          if (t !== null && (!best || t < best.t)) best = { b, index, t };
        });
      }
      if (!best) return state;
      const hit = best as { b: Building; index: number; t: number };
      const cell = state && state.building === hit.b ? state.cell : 0;
      const other = this.otherSide(hit.b, hit.index, cell);
      state = other > 0 ? { building: hit.b, cell: other } : null;
      eye = eye.clone().lerp(cam, Math.min(1, hit.t + 1e-3));
      if (!state) return null;
    }
    return state;
  }
}

/** Parameter along a-b where the segment crosses one of the portal's triangles, or null. */
export function crossing(portal: import('./assetPack').Portal, a: THREE.Vector3, b: THREE.Vector3): number | null {
  const da = portal.normal.dot(a) - portal.d;
  const db = portal.normal.dot(b) - portal.d;
  if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) return null;
  const t = da / (da - db);
  const hit = tmpV.copy(a).lerp(b, t);
  const idx = portal.indices;
  const v = portal.verts;
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
