// A ship's interior as its own still room: the meshes ride inside the hull in the world, but the
// physics lives in a world of the interior's own, in the hull's local frame, never rotated,
// with gravity straight down. Whoever is aboard walks, jumps and stands in that still room, and
// is drawn each frame where the hull's transform puts them. The hull can bank, loop or be thrown
// about and nobody inside feels it, which is how Garry's Mod's Gravity Hull Designator did it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Group, groups, Physics, RAPIER } from '../core/physics';
import { markActor } from '../world/portalRender';
import type { Vehicle } from './vehicle';

/** What the ships manifest says of an interior model: its cells and bounds, as a pack model carries them. */
export interface InteriorDef {
  bounds?: { min: number[]; max: number[] };
  cells?: { index: number; name: string; bounds: { min: number[]; max: number[] } }[];
}

const inverse = new THREE.Matrix4();
const localA = new THREE.Vector3();
const localB = new THREE.Vector3();

export class ShipInterior {
  /** The interior's own physics world, in the hull's frame. */
  readonly physics: Physics;
  readonly group: THREE.Group;
  /** Where someone boarding stands, in the hull's frame. */
  readonly entry = new THREE.Vector3(0, 0.5, 0);
  /** The room's extent in the hull's frame, a little widened: outside it, whoever was aboard has fallen out. */
  readonly bounds = new THREE.Box3();
  private colliders: RAPIER.Collider[] = [];

  private constructor(readonly vehicle: Vehicle, scene: THREE.Group, def: InteriorDef, gravity: number) {
    this.physics = Physics.local(gravity);
    this.group = scene;
    const w = this.physics.world;
    let triangles = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const posAttr = m.geometry.getAttribute('position');
      if (!posAttr || posAttr.count < 3) return;
      const idx = m.geometry.getIndex();
      const indices = idx ? new Uint32Array(idx.array as ArrayLike<number>) : Uint32Array.from({ length: posAttr.count - (posAttr.count % 3) }, (_, i) => i);
      // The mesh's own place within the model, since the colliders are in the model's frame.
      m.updateMatrixWorld(true);
      const local = new THREE.Matrix4().copy(scene.matrixWorld).invert().multiply(m.matrixWorld);
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
    });
    const b = def.bounds;
    if (b) this.bounds.set(new THREE.Vector3(b.min[0], b.min[1], b.min[2]), new THREE.Vector3(b.max[0], b.max[1], b.max[2]));
    else this.bounds.setFromObject(scene);
    this.bounds.expandByScalar(1.5);
    // The entry: the middle of the first room's floor, or of the whole interior's.
    const cell = (def.cells ?? []).find((c) => c.index > 0);
    const box = cell ? new THREE.Box3(new THREE.Vector3(...(cell.bounds.min as [number, number, number])), new THREE.Vector3(...(cell.bounds.max as [number, number, number]))) : this.bounds.clone().expandByScalar(-1.5);
    box.getCenter(this.entry);
    this.entry.y = box.min.y + 0.3;
    console.info(`ship interior: ${this.colliders.length} colliders, ${triangles} triangles, ${(def.cells ?? []).length} cells; entry at ${this.entry.toArray().map((v) => v.toFixed(1)).join(',')}`);
  }

  /** Load an interior model and hang it inside a hull, with its own physics world at the planet's gravity. */
  static async load(vehicle: Vehicle, url: string, def: InteriorDef, gravity: number): Promise<ShipInterior> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const interior = new ShipInterior(vehicle, gltf.scene, def, gravity);
    // Inside the hull: the model's frame is the hull's, so the room moves, banks and rolls with it.
    vehicle.group.add(gltf.scene);
    markActor(gltf.scene);
    return interior;
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
    this.vehicle.group.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.physics.world.free();
    this.colliders = [];
  }
}
