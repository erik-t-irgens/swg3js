// A ship's interior as its own still room: the meshes ride inside the hull in the world, but the
// physics lives in a world of the interior's own, in the hull's local frame, never rotated,
// with gravity straight down. Whoever is aboard walks, jumps and stands in that still room, and
// is drawn each frame where the hull's transform puts them. The hull can bank, loop or be thrown
// about and nobody inside feels it, which is how Garry's Mod's Gravity Hull Designator did it.
//
// The rooms come one of two ways: a separate interior model the ship's template names (the
// YT-1300s), or the hull model itself when it is a portal building, its rooms converted as
// cell:<index>:<name> nodes beside the shell, cell 0 (the yacht, the Sorosuub cruisers).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Group, groups, Physics, RAPIER } from '../core/physics';
import { ACTOR_LAYER, markActor } from '../world/portalRender';
import type { Vehicle } from './vehicle';

/** What the ships manifest says of an interior model: its cells and bounds, as a pack model carries them. */
export interface InteriorDef {
  bounds?: { min: number[]; max: number[] };
  cells?: { index: number; name: string; bounds: { min: number[]; max: number[] } }[];
}

/**
 * Which portal cell a node belongs to, from its own or an ancestor's name: the converter names
 * them cell:<index>:<name>, and GLTFLoader strips the colons, so "cell:2:hall" arrives as
 * "cell2hall". -1 for a node of a plain model.
 */
export function cellIndexOf(o: THREE.Object3D | null): number {
  for (let n = o; n; n = n.parent) {
    const m = /^cell[:_]?(\d+)/.exec(n.name);
    if (m) return Number(m[1]);
  }
  return -1;
}

/** The cell's name from its node, "cell:2:hall" arriving as "cell2hall". */
export function cellNameOf(o: THREE.Object3D | null): string {
  for (let n = o; n; n = n.parent) {
    const m = /^cell[:_]?\d+[:_]?(.*)$/.exec(n.name);
    if (m) return m[1];
  }
  return '';
}

/** How much of a hull's window is seen through while someone is aboard. */
const CLEAR_PANE = 0.45;
/** A "glass" covering more of the shell's triangles than this is its skin under a glassy name, not a window. */
const PANE_SHARE = 0.35;

const inverse = new THREE.Matrix4();
const localA = new THREE.Vector3();
const localB = new THREE.Vector3();

export class ShipInterior {
  /** The interior's own physics world, in the hull's frame. */
  readonly physics: Physics;
  /** The rooms' meshes, whether a model of their own or the hull's cell nodes. */
  readonly group: THREE.Object3D;
  /** Where someone boarding stands, in the hull's frame. */
  readonly entry = new THREE.Vector3(0, 0.5, 0);
  /** The room's extent in the hull's frame, a little widened: outside it, whoever was aboard has fallen out. */
  readonly bounds = new THREE.Box3();
  /** How many rooms, when the model told them apart. */
  readonly cells: number;
  private colliders: RAPIER.Collider[] = [];
  /** The room nodes, to show only from inside when they are part of the hull model (a room drawn through the hull's skin looks wrong from outside). */
  private readonly rooms: THREE.Object3D[] = [];
  /**
   * The shell's window panes, each with its solid material (the game's own, for a hull with
   * nobody aboard and its rooms hidden) and a clear one to show the rooms through while
   * someone is aboard. The clear ones ride on hidden stand-in meshes so the background compile
   * has them ready before the first boarding.
   */
  private readonly panes: { mesh: THREE.Mesh; index: number; solid: THREE.Material; clear: THREE.Material }[] = [];
  private readonly standIns: THREE.Mesh[] = [];

  /**
   * @param frame the object whose frame the room's physics is in: the hull's group.
   * @param meshes the room's meshes, each with its matrixWorld current.
   * @param owned whether the meshes are the interior's own model (removed and disposed with it) or the hull's.
   */
  private constructor(readonly vehicle: Vehicle, group: THREE.Object3D, frame: THREE.Object3D, meshes: THREE.Mesh[], def: InteriorDef, gravity: number, private readonly owned: boolean) {
    this.physics = Physics.local(gravity);
    this.group = group;
    const w = this.physics.world;
    let triangles = 0;
    frame.updateMatrixWorld(true);
    const frameInverse = new THREE.Matrix4().copy(frame.matrixWorld).invert();
    const measured = new THREE.Box3();
    const cellBoxes = new Map<number, THREE.Box3>();
    const corner = new THREE.Vector3();
    for (const m of meshes) {
      const posAttr = m.geometry.getAttribute('position');
      if (!posAttr || posAttr.count < 3) continue;
      const idx = m.geometry.getIndex();
      const indices = idx ? new Uint32Array(idx.array as ArrayLike<number>) : Uint32Array.from({ length: posAttr.count - (posAttr.count % 3) }, (_, i) => i);
      // The mesh's own place within the hull, since the colliders are in the hull's frame.
      const local = new THREE.Matrix4().copy(frameInverse).multiply(m.matrixWorld);
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      local.decompose(p, q, s);
      const desc = RAPIER.ColliderDesc.trimesh(new Float32Array(posAttr.array as ArrayLike<number>), indices)
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.8)
        .setCollisionGroups(groups(Group.interior, Group.all));
      this.colliders.push(w.createCollider(desc));
      triangles += indices.length / 3;
      m.castShadow = true;
      m.receiveShadow = true;
      // The mesh's box in the hull's frame, and its cell's.
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      const box = new THREE.Box3();
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(local);
        box.expandByPoint(corner);
      }
      measured.union(box);
      const cell = cellIndexOf(m);
      if (cell > 0) (cellBoxes.get(cell) ?? cellBoxes.set(cell, new THREE.Box3()).get(cell)!).union(box);
    }
    const b = def.bounds;
    if (b) this.bounds.set(new THREE.Vector3(b.min[0], b.min[1], b.min[2]), new THREE.Vector3(b.max[0], b.max[1], b.max[2]));
    else this.bounds.copy(measured);
    this.bounds.expandByScalar(1.5);
    this.cells = Math.max(cellBoxes.size, (def.cells ?? []).filter((c) => c.index > 0).length);
    // The entry: a spot on the floor of the first room (an entry, lobby or airlock by name when
    // there is one, else the lowest-numbered), found in the room's own physics.
    const named = /entry|entrance|lobby|airlock|ramp|hall|corridor|foyer/i;
    const cellNames = new Map<number, string>();
    for (const m of meshes) {
      const c = cellIndexOf(m);
      if (c > 0 && !cellNames.has(c)) cellNames.set(c, cellNameOf(m));
    }
    const ordered = [...cellBoxes.keys()].sort((a, c) => a - c);
    const preferred = ordered.find((c) => named.test(cellNames.get(c) ?? '')) ?? ordered[0];
    const first = (def.cells ?? []).find((c) => c.index === preferred);
    const box = first ? new THREE.Box3(new THREE.Vector3(...(first.bounds.min as [number, number, number])), new THREE.Vector3(...(first.bounds.max as [number, number, number]))) : (preferred !== undefined ? cellBoxes.get(preferred) : undefined) ?? this.bounds.clone().expandByScalar(-1.5);
    this.findEntry(box);
    console.info(`ship interior (${owned ? 'its own model' : 'rooms of the hull model'}): ${this.colliders.length} colliders, ${triangles} triangles, ${this.cells} cells; entry at ${this.entry.toArray().map((v) => v.toFixed(1)).join(',')}`);
  }

  /**
   * A standing spot in a room: floors are sought under a grid of points across the room's box,
   * each needing head room above and elbow room around, and the one nearest the room's middle
   * wins. The box's middle alone stood the boarder in a pit, a wall or an open stairwell.
   */
  private findEntry(box: THREE.Box3): void {
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const steps = 7;
    let best: { x: number; y: number; z: number; d: number } | null = null;
    const w = this.physics.world;
    const clear = (x: number, y: number, z: number, dx: number, dz: number, reach: number) => w.castRay(new RAPIER.Ray({ x, y, z }, { x: dx, y: 0, z: dz }), reach, true) === null;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const x = box.min.x + ((i + 0.5) / steps) * size.x;
        const z = box.min.z + ((j + 0.5) / steps) * size.z;
        const d = Math.hypot(x - centre.x, z - centre.z);
        if (best && d >= best.d) continue;
        for (const y of this.physics.floorsAt(x, z, box.max.y + 0.5, box.min.y - 0.5)) {
          // Head room: nothing within 1.9 m above the floor; elbow room: nothing within 0.5 m around the waist.
          const up = w.castRay(new RAPIER.Ray({ x, y: y + 0.1, z }, { x: 0, y: 1, z: 0 }), 1.9, true);
          if (up) continue;
          const waist = y + 0.9;
          if (!clear(x, waist, z, 1, 0, 0.5) || !clear(x, waist, z, -1, 0, 0.5) || !clear(x, waist, z, 0, 1, 0.5) || !clear(x, waist, z, 0, -1, 0.5)) continue;
          best = { x, y, z, d };
          break;
        }
      }
    }
    if (best) this.entry.set(best.x, best.y + 0.15, best.z);
    else {
      // No floor with room found: the middle, on whatever is under it.
      this.entry.copy(centre);
      const down = this.physics.groundDistance(centre.x, box.max.y - 0.05, centre.z, size.y + 1);
      this.entry.y = down !== null ? box.max.y - 0.05 - down + 0.15 : box.min.y + 0.3;
      console.warn('ship interior: no clear floor found in the entry room; standing the boarder at its middle');
    }
  }

  /** Load an interior model and hang it inside a hull, with its own physics world at the planet's gravity. */
  static async load(vehicle: Vehicle, url: string, def: InteriorDef, gravity: number): Promise<ShipInterior> {
    const gltf = await new GLTFLoader().loadAsync(url);
    // Inside the hull: the model's frame is the hull's, so the room moves, banks and rolls with it.
    vehicle.group.add(gltf.scene);
    markActor(gltf.scene);
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    return new ShipInterior(vehicle, gltf.scene, vehicle.group, meshes, def, gravity, true);
  }

  /**
   * The rooms the hull model itself carries, when it is a portal building: every cell but the
   * shell becomes the room, in the hull's frame, so the ship needs no interior file of its own.
   * Null when the hull has no rooms.
   */
  static fromHull(vehicle: Vehicle, gravity: number, def: InteriorDef = {}): ShipInterior | null {
    const meshes: THREE.Mesh[] = [];
    const rooms: THREE.Object3D[] = [];
    const panes: ShipInterior['panes'] = [];
    // How much of the shell each material covers: a glassy name on most of a hull is its skin.
    const shellTris = new Map<THREE.Material, number>();
    let shellTotal = 0;
    vehicle.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (cellIndexOf(o) !== 0 || !m.isMesh) return;
      const tris = (m.geometry.getIndex()?.count ?? m.geometry.getAttribute('position')?.count ?? 0) / 3;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) shellTris.set(mat, (shellTris.get(mat) ?? 0) + tris / mats.length);
      shellTotal += tris;
    });
    vehicle.group.traverse((o) => {
      const cell = cellIndexOf(o);
      const m = o as THREE.Mesh;
      if (cell === 0 && m.isMesh) {
        // The shell's glass (marked by the converter): a clear copy of each pane's material to
        // show the rooms through it while someone is aboard.
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat, i) => {
          if (mat.userData.invisible || !(mat.userData.glass || (mat.transparent && mat.opacity < 1))) return;
          if (shellTotal && (shellTris.get(mat) ?? 0) / shellTotal > PANE_SHARE) {
            console.info(`${vehicle.spec.id}: "${mat.name}" covers ${Math.round(((shellTris.get(mat) ?? 0) / shellTotal) * 100)}% of the shell, kept solid`);
            return;
          }
          const clear = mat.clone();
          clear.userData = { ...mat.userData };
          clear.transparent = true;
          clear.opacity = Math.min(mat.transparent ? mat.opacity : 1, CLEAR_PANE);
          clear.depthWrite = false;
          panes.push({ mesh: m, index: i, solid: mat, clear });
        });
        return;
      }
      if (cell <= 0) return;
      if (/^cell[:_]?\d+/.test(o.name)) rooms.push(o);
      if (m.isMesh) meshes.push(m);
    });
    if (!meshes.length) return null;
    const interior = new ShipInterior(vehicle, vehicle.group, vehicle.group, meshes, def, gravity, false);
    interior.rooms.push(...rooms);
    interior.panes.push(...panes);
    // Hidden stand-ins carrying the clear materials: the world's material scan compiles every
    // mesh in the scene, seen or not, so the clear panes are ready before the first boarding.
    for (const p of panes) {
      const standIn = new THREE.Mesh(p.mesh.geometry, p.clear);
      standIn.visible = false;
      standIn.castShadow = false;
      standIn.layers.enable(ACTOR_LAYER);
      vehicle.group.add(standIn);
      interior.standIns.push(standIn);
    }
    interior.reveal(false);
    return interior;
  }

  /**
   * Show or hide the rooms that are part of the hull model. The game's rooms are often larger
   * than the hull that holds them and are only ever seen through its portals, so until the
   * windows are portals they show only to whoever is aboard. A separate interior model stays as
   * it is: it fits its hull.
   */
  reveal(aboard: boolean): void {
    for (const r of this.rooms) r.visible = aboard;
    // The hull's glass is the game's own solid pane while the rooms are hidden (nothing behind it
    // to see) and clear while someone is aboard, so those outside see them in.
    for (const p of this.panes) {
      const want = aboard ? p.clear : p.solid;
      if (Array.isArray(p.mesh.material)) p.mesh.material[p.index] = want;
      else p.mesh.material = want;
    }
  }

  /** Whether a point in the hull's frame is still within the room. */
  contains(local: THREE.Vector3): boolean {
    return this.bounds.containsPoint(local);
  }

  /** A world-space point in the hull's frame. */
  toLocal(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.vehicle.group.updateMatrixWorld(true);
    inverse.copy(this.vehicle.group.matrixWorld).invert();
    return out.copy(world).applyMatrix4(inverse);
  }

  /** A point in the hull's frame, in the world. */
  toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.vehicle.group.updateMatrixWorld(true);
    return out.copy(local).applyMatrix4(this.vehicle.group.matrixWorld);
  }

  /** The camera's block test, run in the room: world points in, the distance along from->to where the room blocks, or null. */
  cameraBlock(from: THREE.Vector3, to: THREE.Vector3): number | null {
    this.toLocal(from, localA);
    this.toLocal(to, localB);
    return this.physics.cameraBlock(localA, localB, null, true);
  }

  dispose(): void {
    if (this.owned) {
      this.vehicle.group.remove(this.group);
      this.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    } else {
      this.reveal(true);
      for (const s of this.standIns) this.vehicle.group.remove(s);
    }
    this.physics.world.free();
    this.colliders = [];
  }
}
