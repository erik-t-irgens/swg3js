// The thing in the middle of a lair: a nest you walk up to, knock down, and stop the creatures coming
// out of, or a camp -- a point of interest's tents, cots, stools and banners -- that people live in.
//
// A nest is the owner's own account of the game rather than anything the server's data says about how
// it behaves: how many come out when it is struck and how long it stays broken are ours, and live in
// `LAIR_TUNE`. How much it can take is the server's (`nestHealth`: its condition for a lair of its
// building level, on the same curve as every creature's health).
//
// **Neither is a creature and must not be one.** A creature has a brain, a gait, a skeleton and a
// place in the mobiles manager's own cap; a nest is a rock that can be hit. So a nest implements the
// smallest thing the game will shoot at -- `Hittable`, which is four members -- and nothing else.
// `looseProps.ts` is the precedent and was read closely: a prop with a collider that a bolt finds
// through `World.hittableAt`, damaged through the same call every living thing is, and disposed by
// giving its materials back before they are thrown away. A camp is less than that: the server stood it
// as a building no player could attack (`spawnTheater`), so it is scenery with colliders, found by no
// hittable lookup, and a bolt stops on a tent as it stops on a wall.
//
// **A camp stands on the ground as it finds it.** The client flattened a camp's ground with its
// template's terrain layer (`poi_small.lay`), and nothing here can add a layer to a world already
// generated -- the lesson the player houses paid for. So each piece stands on its own ground, at the
// lowest of its footprint's corners and its origin, which buries the uphill edge of a tent a little
// rather than leaving the downhill edge hanging in the air. What its client data hangs on it (a fire on
// a log pile) stands on the ground of the piece under it, at its own height over that, or on the
// ground under its own place where no piece is: one ground for the whole camp would float a fire twenty
// metres out over a slope or bury it.
//
// Three things about the disposal are load-bearing and are the project's own hard rules rather than
// this file's taste. A material that is disposed must first be taken out of the portal renderer's
// set and the shadow cascades' map, or the set walked a dozen times a frame grows with every nest
// that ever stood -- and that holds for one put away while it was still being prepared, since the
// preparing is what put it in those sets. A geometry shared with the cached model must not be disposed
// by a camp at all, which is why the model is cloned and the clone's own materials are the only ones a
// camp owns. And the cached models themselves are let go (`NestModels`): held while anything standing
// uses them, kept a while after for the next camp of the same kind, and thrown away with the world.
//
// Every model is read through `surfaces.withPlugin`, as every converted static model must be: 34 of the
// camp pieces carry the converter's own surface data (72 detail maps, two additive screens), which
// lives in the program's key and is applied as the file is read.
//
// What either hangs on itself by its client data -- a nest's fog or its flies, a camp's fire -- is a
// standing particle effect of the world's own (`NestEffects`), prepared before it is placed and taken
// away with the thing it hangs on.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Hittable, Living } from '../combat/kit.ts';
import type { PlacedPiece } from './mobiles/lairs.ts';
import { rescaleBody, scaledByDifficulty } from './difficulty.ts';
import { castsShadow, drawsAfterWater, surfaces } from './surfaces.ts';

/** The world's particle effects, as a nest or a camp uses them. Files are the spawns pack's own. */
export interface NestEffects {
  /** Load an effect and make its batches before it is placed, so nothing is built on a live frame. */
  prepare(file: string): Promise<unknown>;
  /** Put a standing effect down at a world transform; the answer is what takes it away. */
  place(file: string, matrix: THREE.Matrix4): unknown;
  remove(handle: unknown): void;
}

/** One effect a nest's or a camp's client data hangs on it: the spawns pack's file and a 3x4 in the model's own (unmirrored) frame. */
export interface NestEffect {
  file: string;
  transform?: number[];
}

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
  /** The world's particle effects, for what a nest or a camp hangs on itself; none, and it hangs nothing. */
  effects?: NestEffects | null;
  /** Load one of the pack's models; the module's own loader when absent (a node test hands its own in). */
  loadModel?(file: string): Promise<THREE.Object3D | null>;
  /** The cache the models are held in; the session's own (`nestModels`) when absent. */
  models?: NestModels;
}

// ------------------------------------------------------------------------------------------ models

/** Every invented number of the model cache. Live through `__debug.wild({ tune })`. */
export const NEST_MODEL_TUNE = {
  /**
   * How many megabytes of models that nothing standing uses are kept for the next nest or camp of the
   * same kind, the one let go longest ago leaving first. Ours: about thirty camp pieces' worth, where one
   * world's every camp and nest together come to 70 to 93, and the mobiles' own cache is held to 180.
   */
  idleMegabytes: 32,
};

interface HeldModel {
  promise: Promise<THREE.Object3D | null>;
  model: THREE.Object3D | null;
  settled: boolean;
  /** How many standing (or building) nests and camps hold it. */
  users: number;
  /** What it weighs, textures decoded and mipmapped and its buffers, once it has arrived. */
  bytes: number;
  /** When it was last taken or let go, in takes and releases, for the order the idle ones leave in. */
  lastUsed: number;
  /** Thrown away while it was still loading: disposed the moment it arrives, and nobody is handed it. */
  dropped: boolean;
}

/** What a model weighs on the GPU, near enough: each texture's pixels at four bytes with its mips, and each buffer. */
export function modelBytes(root: THREE.Object3D): number {
  let n = 0;
  const textures = new Set<THREE.Texture>();
  const buffers = new Set<ArrayBufferView>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const arrays: (ArrayBufferView | undefined)[] = [g.index?.array as ArrayBufferView | undefined];
    for (const a of Object.values(g.attributes)) arrays.push(((a as THREE.BufferAttribute).array ?? (a as THREE.InterleavedBufferAttribute).data?.array) as ArrayBufferView | undefined);
    for (const arr of arrays) if (arr) buffers.add(arr);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m) continue;
      for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
    }
  });
  for (const b of buffers) n += b.byteLength;
  for (const t of textures) {
    const img = t.image as { width?: number; height?: number } | null;
    if (img && img.width && img.height) n += img.width * img.height * 4 * (t.generateMipmaps ? 4 / 3 : 1);
  }
  return Math.round(n);
}

/** Everything a cached model owns: its geometry, its textures and its own materials, and its place in the animated surfaces. */
function disposeModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m) continue;
      materials.add(m);
      for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
    }
  });
  // Out of the animated surfaces first, which frees a detail map or a flip-book's frames once the last
  // material naming it has gone.
  for (const m of materials) surfaces.forget(m);
  for (const g of geometries) g.dispose();
  for (const t of textures) t.dispose();
  for (const m of materials) m.dispose();
}

/**
 * A cached model's own materials join the animated surfaces for as long as it is cached. Only its
 * clones are ever drawn, but a detail map's record lives only while a material naming it is joined:
 * with the originals out, the last camp put away would free it, and every camp cloned from the same
 * model afterwards would come out with no detail at all.
 */
function joinSurfaces(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m && (m.userData.swgTrack || m.userData.swgScroll || m.userData.swgDetail)) surfaces.adopt(m);
  });
}

/**
 * The nests' and camps' models, each fetched and parsed once and held while anything standing uses it.
 *
 * A model nothing uses is kept for the next camp of the same kind, since walking away from a camp and
 * back is common, but only up to `NEST_MODEL_TUNE.idleMegabytes`, the one let go longest ago leaving
 * first, and every one nothing uses goes when the world does (`clear`). Before this the cache kept every
 * model of every camp ever met for the session, textures on the GPU and all.
 */
export class NestModels {
  private readonly held = new Map<string, HeldModel>();
  private tick = 0;

  /** Take a hold on a model, loading it with `load` if it is not held already; let it go with `release`. */
  take(file: string, load: () => Promise<THREE.Object3D | null>): Promise<THREE.Object3D | null> {
    let h = this.held.get(file);
    if (!h) {
      const rec: HeldModel = { promise: Promise.resolve(null), model: null, settled: false, users: 0, bytes: 0, lastUsed: 0, dropped: false };
      let loading: Promise<THREE.Object3D | null>;
      try {
        loading = load();
      } catch {
        loading = Promise.resolve(null);
      }
      rec.promise = loading
        .catch(() => null)
        .then((model) => {
          rec.settled = true;
          if (rec.dropped) {
            if (model) disposeModel(model);
            return null;
          }
          rec.model = model;
          if (model) {
            joinSurfaces(model);
            rec.bytes = modelBytes(model);
          }
          if (rec.users === 0) this.trim();
          return model;
        });
      this.held.set(file, (h = rec));
    }
    h.users++;
    h.lastUsed = ++this.tick;
    return h.promise;
  }

  /** Let go of one hold. A model nothing holds stays, idle, until the idle ones weigh too much or the world goes. */
  release(file: string): void {
    const h = this.held.get(file);
    if (!h || h.users <= 0) return;
    h.users--;
    h.lastUsed = ++this.tick;
    if (h.users === 0) this.trim();
  }

  /** Throw away every model nothing holds: the world is going. One still loading is disposed when it lands. */
  clear(): void {
    for (const [file, h] of this.held) {
      if (h.users > 0) continue;
      this.held.delete(file);
      this.drop(h);
    }
  }

  /** For the console and the node test: how many are held, used, idle and loading, and what they weigh. */
  stats(): { models: number; used: number; idle: number; loading: number; megabytes: number; idleMegabytes: number } {
    let used = 0;
    let idle = 0;
    let loading = 0;
    let bytes = 0;
    let idleBytes = 0;
    for (const h of this.held.values()) {
      if (!h.settled) loading++;
      bytes += h.bytes;
      if (h.users > 0) used++;
      else {
        idle++;
        idleBytes += h.bytes;
      }
    }
    const mb = (b: number): number => Math.round(b / 1e5) / 10;
    return { models: this.held.size, used, idle, loading, megabytes: mb(bytes), idleMegabytes: mb(idleBytes) };
  }

  private drop(h: HeldModel): void {
    if (!h.settled) {
      h.dropped = true;
      return;
    }
    if (h.model) disposeModel(h.model);
    h.model = null;
  }

  /** The idle models past the budget go, the one let go longest ago first. */
  private trim(): void {
    const budget = NEST_MODEL_TUNE.idleMegabytes * 1e6;
    let idle = 0;
    const list: [string, HeldModel][] = [];
    for (const e of this.held) {
      if (e[1].users > 0 || !e[1].settled) continue;
      idle += e[1].bytes;
      list.push(e);
    }
    if (idle <= budget) return;
    list.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [file, h] of list) {
      if (idle <= budget) break;
      this.held.delete(file);
      idle -= h.bytes;
      this.drop(h);
    }
  }
}

/** The session's own cache, which the world's nests and camps use. */
export const nestModels = new NestModels();

let gltfLoader: GLTFLoader | null = null;

/** Fetch and parse one of the spawns pack's models, through the surfaces plugin as every converted static model is. */
function loadGltf(url: string): Promise<THREE.Object3D | null> {
  gltfLoader ??= surfaces.withPlugin(new GLTFLoader());
  const loader = gltfLoader;
  return new Promise<THREE.Object3D | null>((resolve) => loader.load(url, (gltf) => resolve(gltf.scene), undefined, () => resolve(null)));
}

/** Take a hold on one model for a nest or a camp, noted in `held` so it is let go with the thing. */
function takeModel(file: string, deps: NestDeps, held: string[]): Promise<THREE.Object3D | null> {
  held.push(file);
  const own = deps.loadModel;
  const load = own ? () => own(file) : () => loadGltf(`${deps.baseUrl}assets-private/spawns/${file}`);
  return (deps.models ?? nestModels).take(file, load);
}

/** Give back what a nest or a camp took: its material copies out of the world's sets and disposed, and its holds on the models. */
function giveBack(owned: THREE.Material[], held: string[], deps: NestDeps): void {
  if (owned.length) {
    deps.forget(owned);
    for (const m of owned) m.dispose();
    owned.length = 0;
  }
  const models = deps.models ?? nestModels;
  for (const f of held) models.release(f);
  held.length = 0;
}

/**
 * After the world has prepared it: each mesh casts a shadow only where its materials would on a placed
 * object (`castsShadow`: a glow, a translucent spray or a basin's water does not), and a translucent
 * surface draws after the terrain water (`drawsAfterWater`), both the streamer's own rules, which the
 * preparing (made for a body, every mesh of which casts) overrode. With `cull`, each mesh is culled on
 * its own again. None of these is in a program's key, so nothing compiles.
 */
function dressPrepared(root: THREE.Object3D, cull: boolean): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (cull) mesh.frustumCulled = true;
    mesh.castShadow = castsShadow(mesh.material);
    if (drawsAfterWater(mesh.material)) mesh.renderOrder = 3;
  });
}

// ------------------------------------------------------------------------------------------ effects

/**
 * An effect's 3x4 carried into the game's X-flipped frame (S M S with S = diag(-1, 1, 1)): the same as
 * `mirroredTransform` in particles.ts, written out here because that module is not one node can load.
 */
function mirroredFx(t: number[] | undefined, out: THREE.Matrix4): THREE.Matrix4 {
  if (!t || t.length < 12) return out.identity();
  return out.set(t[0], -t[1], -t[2], -t[3], -t[4], t[5], t[6], t[7], -t[8], t[9], t[10], t[11], 0, 0, 0, 1);
}

const fxLocal = new THREE.Matrix4();

/**
 * Where one of a thing's effects stands in the world: its place in the thing's own frame, mirrored and
 * turned by `turn` about the middle, at its own height over the ground `groundUnder` answers for that
 * place. `groundUnder` is handed the place's offset from the middle in the world's frame. Exported for
 * the node test.
 */
export function effectMatrix(t: number[] | undefined, turn: number, middle: { x: number; z: number }, groundUnder: (dx: number, dz: number) => number): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY(turn).multiply(mirroredFx(t, fxLocal));
  const e = m.elements;
  const dx = e[12];
  const dz = e[14];
  e[12] = middle.x + dx;
  e[13] += groundUnder(dx, dz);
  e[14] = middle.z + dz;
  return m;
}

/**
 * Hang a thing's effects on it: each prepared, then placed where `at` says, unless the thing went
 * meanwhile. The handles are pushed into `into` as they are placed, which is what `dispose` takes away.
 */
async function hangEffects(list: readonly NestEffect[] | undefined, at: (e: NestEffect) => THREE.Matrix4, fx: NestEffects | null | undefined, into: unknown[], gone: () => boolean): Promise<void> {
  if (!fx || !list?.length) return;
  for (const e of list) {
    if (!e?.file) continue;
    try {
      await fx.prepare(e.file);
    } catch {
      continue;
    }
    if (gone()) return;
    into.push(fx.place(e.file, at(e)));
  }
}

// ------------------------------------------------------------------------------------------ the nest

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
  /** Its whole at the difficulty in force (`src/world/difficulty.ts`), from the health it was built with. */
  maxHp: number;
  private readonly baseHp: number;
  readonly label: string;
  /** The moment it was last struck, on the world's own clock: the reinforcement cooldown reads it. */
  struckAt = -Infinity;
  /** Set when it is struck and cleared by whoever sends the reinforcements. */
  wantsHelp = false;
  private group: THREE.Group | null = null;
  private body: RAPIER.RigidBody | null = null;
  private collider: RAPIER.Collider | null = null;
  private readonly owned: THREE.Material[] = [];
  private readonly held: string[] = [];
  private readonly fxHandles: unknown[] = [];
  private deps: NestDeps | null = null;
  private disposed = false;
  /** Between the start of a build and the end of its preparing: a dispose then leaves its materials and holds for the build to give back. */
  private busy = false;

  constructor(label: string, hp: number) {
    this.label = label;
    this.baseHp = hp;
    this.maxHp = scaledByDifficulty(hp);
    this.hp = this.maxHp;
  }

  /** The difficulty knob moved: its whole set again, keeping the share of it it had. */
  applyDifficulty(scale: number): void {
    rescaleBody(this, this.baseHp, scale);
  }

  /**
   * Stand again on its own clock: whole, and sending its own out when struck. The model and its body
   * stay where they are, so a lair coming back is not a mound vanishing and building again in view.
   */
  revive(): void {
    this.maxHp = scaledByDifficulty(this.baseHp);
    this.hp = this.maxHp;
    this.dead = false;
    this.wantsHelp = false;
    this.struckAt = -Infinity;
  }

  /** The collider's handle, so the world can find this from a bolt. */
  get handle(): number | null {
    return this.collider?.handle ?? null;
  }

  /** Whether it is really standing in the world (its model arrived and its body was made). */
  get up(): boolean {
    return !!this.group && !this.disposed;
  }

  /** How many of the effects its client data hangs on it are placed. */
  get effects(): number {
    return this.fxHandles.length;
  }

  /** The group it hangs in, for the console and the node test; null until it stands. */
  get root(): THREE.Object3D | null {
    return this.group;
  }

  /**
   * Build it: fetch the model, clone it, stand it, and give it a collider, then hang what its client
   * data hangs on it (`effects`), each on its own ground (`ground`, the nest's own where it is over the
   * nest; with none, all of them at the nest's height).
   *
   * Everything is checked against `disposed` after each await, because a site can be put away while
   * its nest is still loading and a body made after that is a body nobody will ever take down. One put
   * away while it was being prepared gives its materials back here, when the preparing is over.
   */
  async build(file: string, at: { x: number; y: number; z: number }, deps: NestDeps, effects?: readonly NestEffect[], ground?: (x: number, z: number) => number): Promise<boolean> {
    this.deps = deps;
    this.busy = true;
    const box = new THREE.Box3();
    try {
      const model = await takeModel(file, deps, this.held);
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
      // Its box about its own origin, before it is stood anywhere.
      box.setFromObject(copy);
      group.position.set(at.x, at.y, at.z);
      this.pos.set(at.x, at.y, at.z);

      const size = new THREE.Vector3();
      box.getSize(size);
      // A box that is sane whatever the model turned out to be: some nests are a metre across and
      // some are a hut, and a zero extent would make a collider the engine refuses.
      const hx = Math.max(0.4, size.x / 2);
      const hy = Math.max(0.4, size.y / 2);
      const hz = Math.max(0.4, size.z / 2);
      this.halfHeight = hy;

      try {
        await deps.prepare(group);
      } catch {
        return false;
      }
      if (this.disposed) return false;
      dressPrepared(group, false);
      deps.markActor(group);
      deps.scene.add(group);
      this.group = group;

      // Fixed, not dynamic: a nest is part of the ground until it is broken.
      const body = deps.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(at.x, at.y + hy, at.z));
      const collider = deps.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
      collider.setCollisionGroups(deps.outdoorGroups());
      this.body = body;
      this.collider = collider;
    } finally {
      this.busy = false;
      if (this.disposed) giveBack(this.owned, this.held, deps);
    }
    // Its fog or its flies, where its client data hangs any: behind the model, so a nest whose
    // effect is still loading is a nest, and one whose model never came has no fog in the air. One
    // over the nest stands at the nest's height and one off it on the ground there.
    const under = (dx: number, dz: number): number => {
      const over = !box.isEmpty() && dx >= box.min.x - 0.25 && dx <= box.max.x + 0.25 && dz >= box.min.z - 0.25 && dz <= box.max.z + 0.25;
      return over || !ground ? at.y : ground(at.x + dx, at.z + dz);
    };
    await hangEffects(effects, (e) => effectMatrix(e.transform, 0, at, under), deps.effects, this.fxHandles, () => this.disposed);
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
    const deps = this.deps;
    for (const h of this.fxHandles) deps?.effects?.remove(h);
    this.fxHandles.length = 0;
    if (this.body) {
      try {
        deps?.physics.world.removeRigidBody(this.body);
      } catch {
        /* the world may already have gone */
      }
    }
    this.body = null;
    this.collider = null;
    this.group?.removeFromParent();
    this.group = null;
    // Given back before they are thrown away: the portal renderer's set and the cascades' map both
    // hold a strong reference, and one walked a dozen times a frame must not grow. Mid-build, the
    // build gives them back itself when its preparing is over, so nothing it is still compiling is
    // disposed under it.
    if (!this.busy && deps) giveBack(this.owned, this.held, deps);
    this.deps = null;
  }
}

// ------------------------------------------------------------------------------------------ the camp

/**
 * The ground a camp piece stands on: the lowest of its origin and its footprint's four corners, turned
 * with it. `ground` answers the world's own height at a point. Exported for the node test.
 */
export function pieceGround(p: PlacedPiece, middle: { x: number; z: number }, box: THREE.Box3 | null, ground: (x: number, z: number) => number): number {
  const ox = middle.x + p.x;
  const oz = middle.z + p.z;
  let low = ground(ox, oz);
  if (!box || box.isEmpty()) return low;
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  for (const bx of [box.min.x, box.max.x]) {
    for (const bz of [box.min.z, box.max.z]) {
      const h = ground(ox + bx * c + bz * s, oz - bx * s + bz * c);
      if (h < low) low = h;
    }
  }
  return low;
}

/** One camp piece as it was stood: its layout, the height its origin stands at, and its model's own box. */
interface StoodPiece {
  p: PlacedPiece;
  y: number;
  box: THREE.Box3;
}

/**
 * The ground under a spot off a camp's middle, for what its client data hangs there: the ground the
 * piece under the spot stands on (the smallest footprint holding it, which is a log pile rather than
 * the mat it lies on), so a fire keeps its height over its pile as the client placed it; else the
 * world's own ground at the spot.
 */
function campGround(dx: number, dz: number, stood: readonly StoodPiece[], middle: { x: number; z: number }, ground: (x: number, z: number) => number): number {
  let best: StoodPiece | null = null;
  let bestRadius = Infinity;
  for (const s of stood) {
    const b = s.box;
    if (b.isEmpty()) continue;
    // The spot in the piece's own frame: three's turn about y undone.
    const wx = dx - s.p.x;
    const wz = dz - s.p.z;
    const c = Math.cos(s.p.yaw);
    const n = Math.sin(s.p.yaw);
    const lx = wx * c - wz * n;
    const lz = wx * n + wz * c;
    if (lx < b.min.x - 0.25 || lx > b.max.x + 0.25 || lz < b.min.z - 0.25 || lz > b.max.z + 0.25) continue;
    if (s.p.radius < bestRadius) {
      bestRadius = s.p.radius;
      best = s;
    }
  }
  return best ? best.y - best.p.lift : ground(middle.x + dx, middle.z + dz);
}

/**
 * A camp standing in the world: its pieces, each on its own ground with a fixed box round it, and
 * whatever its client data hangs on it. It is not `Hittable` and is in no collider map a bolt or a
 * blade looks things up in, because the server stood a camp as a building no player could attack.
 */
export class WildCamp {
  readonly label: string;
  private group: THREE.Group | null = null;
  private body: RAPIER.RigidBody | null = null;
  private readonly colliders: RAPIER.Collider[] = [];
  private readonly owned: THREE.Material[] = [];
  private readonly held: string[] = [];
  private readonly fxHandles: unknown[] = [];
  private deps: NestDeps | null = null;
  private disposed = false;
  /** Between the start of a build and the end of its preparing: a dispose then leaves its materials and holds for the build to give back. */
  private busy = false;
  /** How many of its pieces stood (a piece whose model would not load is left out). */
  pieces = 0;

  constructor(label: string) {
    this.label = label;
  }

  /** Whether it is really standing in the world. */
  get up(): boolean {
    return !!this.group && !this.disposed;
  }

  /** Every collider of its pieces, for a check that none of them is anything a bolt could hurt. */
  get handles(): number[] {
    return this.colliders.map((c) => c.handle);
  }

  /** How many of the effects its client data hangs on it are placed. */
  get effects(): number {
    return this.fxHandles.length;
  }

  /** The group its pieces hang in, for the console and the node test; null until it stands. */
  get root(): THREE.Object3D | null {
    return this.group;
  }

  /**
   * Build it: every piece's model held once (`NestModels`), cloned per piece with one set of material
   * copies per model, each stood on its own ground (`pieceGround`) at its own lift, turned, and given a
   * fixed box the size of its model. The whole camp is prepared before it is added to the scene, so
   * nothing it wears is compiled in front of anybody, and its pieces are culled one by one after that,
   * since a camp is thirty metres of static things and not one actor. What its client data hangs on it
   * stands on the ground of the piece under it (`campGround`).
   */
  async build(pieces: readonly PlacedPiece[], middle: { x: number; z: number }, turn: number, ground: (x: number, z: number) => number, deps: NestDeps, effects?: readonly NestEffect[]): Promise<boolean> {
    this.deps = deps;
    this.busy = true;
    const stood: StoodPiece[] = [];
    try {
      const files = [...new Set(pieces.map((p) => p.model))];
      const loaded = await Promise.all(files.map((f) => takeModel(f, deps, this.held)));
      if (this.disposed) return false;
      const byFile = new Map<string, { model: THREE.Object3D; box: THREE.Box3; mats: Map<THREE.Material, THREE.Material> }>();
      files.forEach((f, i) => {
        const model = loaded[i];
        if (!model) return;
        model.updateWorldMatrix(true, true);
        byFile.set(f, { model, box: new THREE.Box3().setFromObject(model), mats: new Map() });
      });
      const group = new THREE.Group();
      group.position.set(middle.x, 0, middle.z);
      for (const p of pieces) {
        const held = byFile.get(p.model);
        if (!held) continue;
        const copy = held.model.clone(true);
        copy.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          // One set of copies per model for the whole camp: its pieces share them, and they are the
          // only materials this owns.
          const swap = (m: THREE.Material): THREE.Material => {
            let mine = held.mats.get(m);
            if (!mine) {
              mine = m.clone();
              held.mats.set(m, mine);
              this.owned.push(mine);
            }
            return mine;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
        });
        const y = pieceGround(p, middle, held.box, ground) + p.lift;
        copy.position.set(p.x, y, p.z);
        copy.rotation.set(0, p.yaw, 0);
        group.add(copy);
        stood.push({ p, y, box: held.box });
      }
      this.pieces = stood.length;
      if (!stood.length) return false;

      // Prepared out of sight: it joins the scene only once every program it needs is built.
      try {
        await deps.prepare(group);
      } catch {
        return false;
      }
      if (this.disposed) return false;
      // Static things, culled as three culls any mesh once they are ready, `prepare` having treated
      // what it was handed as one actor; and shadows and draw order by the streamer's rules.
      dressPrepared(group, true);
      deps.markActor(group);
      deps.scene.add(group);
      this.group = group;

      // One fixed body at the camp's middle and a box a piece, turned with it.
      const body = deps.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(middle.x, 0, middle.z));
      this.body = body;
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const centre = new THREE.Vector3();
      for (const { p, y, box } of stood) {
        if (box.isEmpty()) continue;
        box.getCenter(centre);
        const hx = Math.max(0.05, (box.max.x - box.min.x) / 2);
        const hy = Math.max(0.05, (box.max.y - box.min.y) / 2);
        const hz = Math.max(0.05, (box.max.z - box.min.z) / 2);
        q.setFromAxisAngle(up, p.yaw);
        centre.applyQuaternion(q);
        const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
          .setTranslation(p.x + centre.x, y + centre.y, p.z + centre.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        const collider = deps.physics.world.createCollider(desc, body);
        collider.setCollisionGroups(deps.outdoorGroups());
        this.colliders.push(collider);
      }
    } finally {
      this.busy = false;
      if (this.disposed) giveBack(this.owned, this.held, deps);
    }
    // Its fire, where its client data hangs one, turned with it and stood on the ground of what it
    // hangs over.
    await hangEffects(effects, (e) => effectMatrix(e.transform, turn, middle, (dx, dz) => campGround(dx, dz, stood, middle, ground)), deps.effects, this.fxHandles, () => this.disposed);
    return true;
  }

  /** Take it out of the world, colliders, materials and effects. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const deps = this.deps;
    for (const h of this.fxHandles) deps?.effects?.remove(h);
    this.fxHandles.length = 0;
    if (this.body) {
      try {
        deps?.physics.world.removeRigidBody(this.body);
      } catch {
        /* the world may already have gone */
      }
    }
    this.body = null;
    this.colliders.length = 0;
    this.group?.removeFromParent();
    this.group = null;
    // As a nest's: given back now, or by the build when its preparing is over.
    if (!this.busy && deps) giveBack(this.owned, this.held, deps);
    this.deps = null;
  }
}
