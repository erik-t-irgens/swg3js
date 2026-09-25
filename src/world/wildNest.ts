// The nest at a lair: the thing you walk up to, knock down, and stop the creatures coming out of.
//
// It is the owner's own account of the game rather than anything the server's data says. The data
// gives a lair a `buildings*` column and nothing else about it: how much health it has, how many
// come out when it is struck and how long it stays broken are all ours, and they live in
// `LAIR_TUNE` with every other invented number.
//
// **It is not a creature and must not be one.** A creature has a brain, a gait, a skeleton and a
// place in the mobiles manager's own cap; a nest is a rock that can be hit. So this implements the
// smallest thing the game will shoot at -- `Hittable`, which is four members -- and nothing else.
// `looseProps.ts` is the precedent and was read closely: a prop with a collider that a bolt finds
// through `World.hittableAt`, damaged through the same call every living thing is, and disposed by
// giving its materials back before they are thrown away.
//
// Two things about the disposal are load-bearing and are the project's own hard rules rather than
// this file's taste. A material that is disposed must first be taken out of the portal renderer's
// set and the shadow cascades' map, or the set walked a dozen times a frame grows with every nest
// that ever stood. And a geometry shared with the cached model must not be disposed at all, which
// is why the model is cloned and the clone's own materials are the only ones this owns.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Hittable, Living } from '../combat/kit.ts';

/** What a nest needs of the world. Narrow, so a node test can be the world. */
export interface NestDeps {
  scene: THREE.Object3D;
  physics: { world: RAPIER.World };
  /** The collision groups a thing standing outdoors takes. */
  outdoorGroups(): number;
  /** Give a material back before it is disposed: the portal set and the cascades both hold them. */
  forget(materials: readonly THREE.Material[]): void;
  /** Compile a drawable at a time, so nothing builds a program on a live frame. */
  prepare(root: THREE.Object3D): Promise<void> | void;
  /** Mark it as an actor, so the portal renderer draws it in the right pass. */
  markActor(o: THREE.Object3D): void;
  /** Where the nest models live. */
  baseUrl: string;
}

/** One model, parsed once and cloned per nest. */
const models = new Map<string, Promise<THREE.Object3D | null>>();

/**
 * Fetch and parse one nest model, once per file for the session.
 *
 * `surfaces.withPlugin` is not used here: a nest is a rock or a hut and carries no flip-book, and
 * the plugin only registers animated surfaces. If a nest ever needs one this is the line to change.
 */
function loadModel(file: string, baseUrl: string): Promise<THREE.Object3D | null> {
  let held = models.get(file);
  if (!held) {
    held = new Promise<THREE.Object3D | null>((resolve) => {
      new GLTFLoader().load(
        `${baseUrl}assets-private/spawns/${file}`,
        (gltf) => resolve(gltf.scene),
        undefined,
        () => resolve(null),
      );
    });
    models.set(file, held);
  }
  return held;
}

/**
 * A nest standing in the world.
 *
 * `Hittable` is all of it: a place, a height, whether it is dead, and a way to be hurt. It is not in
 * `World.targets()` -- nothing should pick a fight with a mound of earth, and the aim ray and the
 * bolts reach it through the collider map instead, exactly as a crate is reached.
 */
export class WildNest implements Hittable {
  readonly pos = new THREE.Vector3();
  halfHeight = 1;
  dead = false;
  hp: number;
  readonly maxHp: number;
  readonly label: string;
  /** The moment it was last struck, on the world's own clock: the reinforcement cooldown reads it. */
  struckAt = -Infinity;
  /** Set when it is struck and cleared by whoever sends the reinforcements. */
  wantsHelp = false;
  private group: THREE.Group | null = null;
  private body: RAPIER.RigidBody | null = null;
  private collider: RAPIER.Collider | null = null;
  private readonly owned: THREE.Material[] = [];
  private deps: NestDeps | null = null;
  private disposed = false;

  constructor(label: string, hp: number) {
    this.label = label;
    this.hp = hp;
    this.maxHp = hp;
  }

  /** The collider's handle, so the world can find this from a bolt. */
  get handle(): number | null {
    return this.collider?.handle ?? null;
  }

  /** Whether it is really standing in the world (its model arrived and its body was made). */
  get up(): boolean {
    return !!this.group && !this.disposed;
  }

  /**
   * Build it: fetch the model, clone it, stand it, and give it a collider.
   *
   * Everything is checked against `disposed` after each await, because a site can be put away while
   * its nest is still loading and a body made after that is a body nobody will ever take down.
   */
  async build(file: string, at: { x: number; y: number; z: number }, deps: NestDeps): Promise<boolean> {
    this.deps = deps;
    const model = await loadModel(file, deps.baseUrl);
    if (!model || this.disposed) return false;
    const group = new THREE.Group();
    // A clone of its own, so nothing here ever disposes the geometry the cache holds. The materials
    // are cloned with it and are the only things this owns.
    const copy = model.clone(true);
    copy.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mine = mats.map((m) => m.clone());
      mesh.material = Array.isArray(mesh.material) ? mine : mine[0];
      for (const m of mine) this.owned.push(m);
    });
    group.add(copy);
    group.position.set(at.x, at.y, at.z);
    this.pos.set(at.x, at.y, at.z);

    const box = new THREE.Box3().setFromObject(copy);
    const size = new THREE.Vector3();
    box.getSize(size);
    // A box that is sane whatever the model turned out to be: some nests are a metre across and
    // some are a hut, and a zero extent would make a collider the engine refuses.
    const hx = Math.max(0.4, size.x / 2);
    const hy = Math.max(0.4, size.y / 2);
    const hz = Math.max(0.4, size.z / 2);
    this.halfHeight = hy;

    await deps.prepare(group);
    if (this.disposed) {
      for (const m of this.owned) m.dispose();
      this.owned.length = 0;
      return false;
    }
    deps.markActor(group);
    deps.scene.add(group);
    this.group = group;

    // Fixed, not dynamic: a nest is part of the ground until it is broken.
    const body = deps.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(at.x, at.y + hy, at.z));
    const collider = deps.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
    collider.setCollisionGroups(deps.outdoorGroups());
    this.body = body;
    this.collider = collider;
    return true;
  }

  /**
   * Hurt it.
   *
   * It does not push and it does not flinch: the whole of what a blow does to a nest is take health
   * off it and bring more of its own out, which is the second half of what makes walking up to one
   * a decision rather than a chore.
   */
  damage(amount: number, _from?: THREE.Vector3, _push?: number, _source?: Living | null): void {
    if (this.dead || !(amount > 0)) return;
    this.hp -= amount;
    this.wantsHelp = true;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
    }
  }

  /** A bolt that reached it: 'taken' means the bolt plays its own burst, which is what a rock wants. */
  takeBolt(): 'taken' {
    return 'taken';
  }

  /** Take it out of the world. Idempotent: a site put away twice must not free a body twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.body) {
      try {
        this.deps?.physics.world.removeRigidBody(this.body);
      } catch {
        /* the world may already have gone */
      }
    }
    this.body = null;
    this.collider = null;
    if (this.group) {
      this.group.removeFromParent();
      // Given back before they are thrown away: the portal renderer's set and the cascades' map
      // both hold a strong reference, and one walked a dozen times a frame must not grow.
      this.deps?.forget(this.owned);
      for (const m of this.owned) m.dispose();
      this.group = null;
    }
    this.owned.length = 0;
    this.deps = null;
  }
}
