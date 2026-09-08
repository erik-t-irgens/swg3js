// Streams a planet's world-snapshot objects around the player: the layout is bucketed into
// 256 m regions, each region loads its models and instances in size tiers (big buildings from
// far away, small props up close), and exact trimesh collision follows the player.

import * as THREE from 'three';
import { Group, groups, RAPIER as R, type Physics } from '../core/physics';
import type { AssetPack, Layout, LoadedModel } from './assetPack';
import { CHUNK_SIZE } from './terrain';
import type { Exclusion } from './props';

export const REGION = 256;

/** Objects at least this big load out to this range (metres). */
const TIERS = [
  { minRadius: 12, range: 1700 },
  { minRadius: 3, range: 750 },
  { minRadius: 0, range: 320 },
];
const UNLOAD_SLACK = 1.15;
const COLLIDER_RANGE = 170;
const COLLIDER_MIN_RADIUS = 1.5;
const MAX_CONCURRENT_LOADS = 3;

export interface PlacedObject {
  model: string;
  x: number;
  y: number;
  z: number;
  q: THREE.Quaternion;
  radius: number;
  contained: boolean;
  tier: number;
}

/** A placed portal building; the player's cell inside it is tracked by crossing its portals. */
export interface Building {
  model: LoadedModel;
  x: number;
  z: number;
  radius: number;
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  /** Instances of the exterior shell, collapsed while the player is inside. */
  exterior: { mesh: THREE.InstancedMesh; index: number }[];
}

interface LoadedTier {
  meshes: THREE.InstancedMesh[];
  buildings: Building[];
  objects: PlacedObject[];
}

interface Region {
  rx: number;
  rz: number;
  cx: number;
  cz: number;
  objects: PlacedObject[][];
  tiers: (LoadedTier | 'loading' | null)[];
}

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const localA = new THREE.Vector3();
const localB = new THREE.Vector3();
const hitP = new THREE.Vector3();

/** Where the player is: outside (cell 0 of no building) or in a cell of a building. */
export interface CellState {
  building: Building;
  cell: number;
}

/** Does the segment a-b cross the portal polygon (model space)? */
function crossesPortal(portal: import('./assetPack').Portal, a: THREE.Vector3, b: THREE.Vector3): boolean {
  const da = portal.normal.dot(a) - portal.d;
  const db = portal.normal.dot(b) - portal.d;
  if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) return false;
  const t = da / (da - db);
  hitP.copy(a).lerp(b, t);
  // Point in polygon on the plane's dominant axis.
  const n = portal.normal;
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  const u = ax >= ay && ax >= az ? 'y' : ay >= az ? 'x' : 'x';
  const v = ax >= ay && ax >= az ? 'z' : ay >= az ? 'z' : 'y';
  let inside = false;
  const pts = portal.verts;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i];
    const pj = pts[j];
    if (pi[v] > hitP[v] !== pj[v] > hitP[v] && hitP[u] < ((pj[u] - pi[u]) * (hitP[v] - pi[v])) / (pj[v] - pi[v]) + pi[u]) inside = !inside;
  }
  return inside;
}

export class LayoutStreamer {
  readonly buildings = new Set<Building>();
  readonly objects: PlacedObject[] = [];
  private readonly regions = new Map<string, Region>();
  private readonly exclusionCells = new Map<string, Exclusion[]>();
  private readonly colliders = new Map<PlacedObject, R.Collider[]>();
  private loads = 0;
  private lastColliderX = Number.NaN;
  private lastColliderZ = Number.NaN;
  private disposed = false;
  loadedModels = 0;
  loadedInstances = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: Physics,
    private readonly pack: AssetPack,
    layout: Layout,
  ) {
    for (const o of layout.objects) {
      // Snapshot space is mirrored in X and centred on the layout centre.
      const gx = -(o.x - layout.center.x);
      const gz = o.z - layout.center.z;
      const tier = TIERS.findIndex((t) => o.radius >= t.minRadius);
      const p: PlacedObject = { model: o.model, x: gx, y: o.y, z: gz, q: new THREE.Quaternion(o.q[1], -o.q[2], -o.q[3], o.q[0]), radius: o.radius, contained: !!o.contained, tier: tier < 0 ? TIERS.length - 1 : tier };
      this.objects.push(p);
      const rx = Math.floor(gx / REGION);
      const rz = Math.floor(gz / REGION);
      const key = `${rx},${rz}`;
      let region = this.regions.get(key);
      if (!region) {
        region = { rx, rz, cx: (rx + 0.5) * REGION, cz: (rz + 0.5) * REGION, objects: TIERS.map(() => []), tiers: TIERS.map(() => null) };
        this.regions.set(key, region);
      }
      region.objects[p.tier].push(p);
      if (p.radius >= 1 && !p.contained) this.addExclusion({ x: gx, z: gz, r: p.radius + 2 });
    }
  }

  private addExclusion(e: Exclusion): void {
    const x0 = Math.floor((e.x - e.r) / CHUNK_SIZE);
    const x1 = Math.floor((e.x + e.r) / CHUNK_SIZE);
    const z0 = Math.floor((e.z - e.r) / CHUNK_SIZE);
    const z1 = Math.floor((e.z + e.r) / CHUNK_SIZE);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cz}`;
        const list = this.exclusionCells.get(key);
        if (list) list.push(e);
        else this.exclusionCells.set(key, [e]);
      }
    }
  }

  /** Scatter exclusions touching a terrain chunk. */
  exclusionsFor(cx: number, cz: number): Exclusion[] {
    return this.exclusionCells.get(`${cx},${cz}`) ?? [];
  }

  /** Open ground near a point that no object's footprint covers, or null. */
  clearSpawn(spawn: THREE.Vector3, heightAt: (x: number, z: number) => number): THREE.Vector3 | null {
    const blockers = this.objects.filter((p) => !p.contained && p.radius >= 1 && Math.hypot(p.x - spawn.x, p.z - spawn.z) < 200);
    const clear = (x: number, z: number) => blockers.every((p) => Math.hypot(p.x - x, p.z - z) > p.radius + 1.5);
    for (let r = 0; r < 120; r += 4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = spawn.x + Math.sin(a) * r;
        const z = spawn.z + Math.cos(a) * r;
        if (clear(x, z)) return new THREE.Vector3(x, heightAt(x, z), z);
        if (r === 0) break;
      }
    }
    return null;
  }

  /** Load what is in range, drop what is not, keep collision around the player. */
  update(playerPos: THREE.Vector3): void {
    if (this.disposed) return;
    const px = playerPos.x;
    const pz = playerPos.z;
    // Nearest regions first so the player's surroundings fill in before the horizon.
    const candidates: { region: Region; tier: number; d: number }[] = [];
    for (const region of this.regions.values()) {
      const dx = Math.max(0, Math.abs(px - region.cx) - REGION / 2);
      const dz = Math.max(0, Math.abs(pz - region.cz) - REGION / 2);
      const d = Math.hypot(dx, dz);
      for (let t = 0; t < TIERS.length; t++) {
        const state = region.tiers[t];
        if (!region.objects[t].length) continue;
        if (d <= TIERS[t].range) {
          if (state === null) candidates.push({ region, tier: t, d });
        } else if (state && state !== 'loading' && d > TIERS[t].range * UNLOAD_SLACK) {
          this.unloadTier(region, t);
        }
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const c of candidates) {
      if (this.loads >= MAX_CONCURRENT_LOADS) break;
      void this.loadTier(c.region, c.tier);
    }
    if (Number.isNaN(this.lastColliderX) || Math.hypot(px - this.lastColliderX, pz - this.lastColliderZ) > 12) {
      this.lastColliderX = px;
      this.lastColliderZ = pz;
      this.updateColliders(px, pz);
    }
  }

  private async loadTier(region: Region, tier: number): Promise<void> {
    region.tiers[tier] = 'loading';
    this.loads++;
    try {
      const objects = region.objects[tier];
      const ids = [...new Set(objects.map((o) => o.model))];
      const models = new Map<string, LoadedModel>();
      for (const id of ids) {
        try {
          models.set(id, await this.pack.model(id));
        } catch {
          // Missing or broken model: its instances are skipped.
        }
        if (this.disposed) return;
      }
      if (region.tiers[tier] !== 'loading') return;
      region.tiers[tier] = this.instance(objects, models);
    } finally {
      this.loads--;
      if (region.tiers[tier] === 'loading') region.tiers[tier] = null;
    }
  }

  private instance(objects: PlacedObject[], models: Map<string, LoadedModel>): LoadedTier {
    const byModel = new Map<LoadedModel, PlacedObject[]>();
    for (const o of objects) {
      const m = models.get(o.model);
      if (m) (byModel.get(m) ?? byModel.set(m, []).get(m)!).push(o);
    }
    const meshes: THREE.InstancedMesh[] = [];
    const buildings: Building[] = [];
    for (const [model, list] of byModel) {
      const isBuilding = model.interiorBoxes.length > 0;
      const built: (Building | null)[] = list.map((p) => {
        if (!isBuilding || p.contained) return null;
        const matrix = new THREE.Matrix4().compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
        const b: Building = { model, x: p.x, z: p.z, radius: model.radius, matrix, inverse: matrix.clone().invert(), exterior: [] };
        buildings.push(b);
        this.buildings.add(b);
        return b;
      });
      for (const prim of model.primitives) {
        const mesh = new THREE.InstancedMesh(prim.geometry, prim.material, list.length);
        list.forEach((p, i) => {
          tmpM.compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
          mesh.setMatrixAt(i, tmpM);
          const b = built[i];
          if (b && prim.cell === 0) b.exterior.push({ mesh, index: i });
        });
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.scene.add(mesh);
        meshes.push(mesh);
      }
    }
    this.loadedModels += byModel.size;
    this.loadedInstances += objects.length;
    return { meshes, buildings, objects };
  }

  private unloadTier(region: Region, tier: number): void {
    const t = region.tiers[tier];
    if (!t || t === 'loading') return;
    for (const mesh of t.meshes) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    for (const b of t.buildings) this.buildings.delete(b);
    for (const o of t.objects) this.removeColliders(o);
    this.loadedInstances -= t.objects.length;
    region.tiers[tier] = null;
  }

  /** Exact collision for the larger objects near the player; created and dropped as they move. */
  private updateColliders(px: number, pz: number): void {
    for (const [o] of this.colliders) {
      if (Math.hypot(o.x - px, o.z - pz) > COLLIDER_RANGE * UNLOAD_SLACK) this.removeColliders(o);
    }
    const rx0 = Math.floor((px - COLLIDER_RANGE) / REGION);
    const rx1 = Math.floor((px + COLLIDER_RANGE) / REGION);
    const rz0 = Math.floor((pz - COLLIDER_RANGE) / REGION);
    const rz1 = Math.floor((pz + COLLIDER_RANGE) / REGION);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const region = this.regions.get(`${rx},${rz}`);
        if (!region) continue;
        for (const t of region.tiers) {
          if (!t || t === 'loading') continue;
          for (const o of t.objects) {
            if (o.contained || o.radius < COLLIDER_MIN_RADIUS || this.colliders.has(o)) continue;
            if (Math.hypot(o.x - px, o.z - pz) > COLLIDER_RANGE) continue;
            this.addColliders(o);
          }
        }
      }
    }
  }

  private addColliders(o: PlacedObject): void {
    const model = this.pack.loaded(o.model);
    if (!model) return;
    const cols: R.Collider[] = [];
    for (const prim of model.primitives) {
      const posAttr = prim.geometry.getAttribute('position');
      const idx = prim.geometry.getIndex();
      if (!posAttr || !idx) continue;
      const desc = R.ColliderDesc.trimesh(new Float32Array(posAttr.array as ArrayLike<number>), new Uint32Array(idx.array as ArrayLike<number>))
        .setTranslation(o.x, o.y, o.z)
        .setRotation({ x: o.q.x, y: o.q.y, z: o.q.z, w: o.q.w })
        .setFriction(0.8);
      // Building shells and interiors get their own collision groups so someone inside ignores the shell.
      if (prim.cell === 0) desc.setCollisionGroups(groups(Group.exterior, Group.all));
      else if (prim.cell > 0) desc.setCollisionGroups(groups(Group.interior, Group.all));
      cols.push(this.physics.world.createCollider(desc));
    }
    this.colliders.set(o, cols);
  }

  private removeColliders(o: PlacedObject): void {
    const cols = this.colliders.get(o);
    if (!cols) return;
    for (const c of cols) this.physics.removeCollider(c);
    this.colliders.delete(o);
  }

  get colliderCount(): number {
    return this.colliders.size;
  }

  /**
   * Follow the player through building portals, as the original client does: you are in the
   * world until your path crosses a portal into a cell, and in that cell until you cross one out.
   * `prev` and `pos` are the player's feet positions this frame and last.
   */
  trackCell(state: CellState | null, prev: THREE.Vector3, pos: THREE.Vector3): CellState | null {
    const jump = prev.distanceToSquared(pos);
    if (jump > 25) return null; // teleport (noclip, travel): start over outside
    if (state) {
      const b = state.building;
      localA.copy(prev).setY(prev.y + 0.9).applyMatrix4(b.inverse);
      localB.copy(pos).setY(pos.y + 0.9).applyMatrix4(b.inverse);
      // Left the building entirely (fell out of a window, no-clipped): back outside.
      if (!b.model.bounds.clone().expandByScalar(3).containsPoint(localB)) return null;
      for (const portal of b.model.portals) {
        const link = portal.links.find((l) => l.from === state.cell) ?? portal.links.find((l) => l.to === state.cell);
        if (!link || !portal.passable) continue;
        if (crossesPortal(portal, localA, localB)) {
          const target = link.from === state.cell ? link.to : link.from;
          return target === 0 ? null : { building: b, cell: target };
        }
      }
      return state;
    }
    for (const b of this.buildings) {
      if (Math.abs(b.x - pos.x) > b.radius + 4 || Math.abs(b.z - pos.z) > b.radius + 4) continue;
      localA.copy(prev).setY(prev.y + 0.9).applyMatrix4(b.inverse);
      localB.copy(pos).setY(pos.y + 0.9).applyMatrix4(b.inverse);
      for (const portal of b.model.portals) {
        const link = portal.links.find((l) => l.from === 0) ?? portal.links.find((l) => l.to === 0);
        if (!link || !portal.passable) continue;
        if (crossesPortal(portal, localA, localB)) {
          const target = link.from === 0 ? link.to : link.from;
          if (target > 0) return { building: b, cell: target };
        }
      }
    }
    return null;
  }

  get status(): string {
    return `${this.loadedInstances}/${this.objects.length} snapshot objects in view, ${this.loadedModels} models, ${this.colliders.size} exact colliders`;
  }

  dispose(): void {
    this.disposed = true;
    for (const region of this.regions.values()) for (let t = 0; t < TIERS.length; t++) this.unloadTier(region, t);
    for (const o of [...this.colliders.keys()]) this.removeColliders(o);
    this.buildings.clear();
  }
}
