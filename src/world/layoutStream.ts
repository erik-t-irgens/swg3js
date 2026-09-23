// Streams a planet's world-snapshot objects around the player: the layout is bucketed into
// 256 m regions, each region loads its models and instances in size tiers (big buildings from
// far away, small props up close), and exact trimesh collision follows the player.

import * as THREE from 'three';
import { cleanTrimesh, Group, groups, RAPIER as R, TRIMESH_FLAGS, type Physics } from '../core/physics';
import { splitTrimesh } from './trimeshPieces.ts';
import type { AssetPack, Layout, LoadedModel } from './assetPack';
import { CHUNK_SIZE } from './terrain';
import type { Exclusion } from './props';
import { ACTOR_LAYER, INTERIOR_LAYER, crossing } from './portalRender';
import { mirroredTransform, type EffectHandle, type ParticleEffects } from './particles';
import { castsShadow, drawsAfterWater } from './surfaces';
import { marks } from './marks.ts';

export const REGION = 256;

/** Objects at least this big load out to this range (metres). */
const TIERS = [
  { minRadius: 12, range: 1700 },
  { minRadius: 3, range: 750 },
  { minRadius: 0, range: 320 },
];
const UNLOAD_SLACK = 1.15;
/**
 * Interiors exist only this far from the building's edge. The portal renderer draws a room
 * only through a doorway within PORTAL_RANGE (120 m) that is actually on screen, so anything
 * past this is scene-graph weight that can never be seen. Dropped a little farther out than
 * it is built so walking a threshold does not build and drop it every frame.
 */
const INTERIOR_RANGE = 160;
const INTERIOR_DROP = 220;
const COLLIDER_RANGE = 170;
const COLLIDER_MIN_RADIUS = 1.5;
/**
 * The widest radius the collider sweep reaches for. An object wider than this (the Star Destroyer,
 * whose radius counts from a model origin that is not its middle) is "huge": its collision is built
 * with its tier, whatever the player's distance, a piece at a time.
 */
const COLLIDER_RADIUS_CAP = 600;
/** A huge object's collision is built in pieces of at most this many triangles (about 2 ms each with TRIMESH_FLAGS). */
const HUGE_PIECE_TRIANGLES = 4000;
/** Milliseconds of huge-object pieces built per update (at least one piece a call). */
const HUGE_BUILD_MS = 3;

/** A huge object's collision being built: which primitive, its pieces once split, and the next piece. */
interface HugeJob {
  o: PlacedObject;
  prim: number;
  pieces: { vertices: Float32Array; indices: Uint32Array }[] | null;
  next: number;
}
/**
 * Model radius below which a placed object does not cast a shadow. Shadow casters are culled
 * against the light's frustum rather than the camera's, so every small prop in the cascades'
 * reach costs a draw call per cascade for a shadow the size of its own footprint.
 */
const SHADOW_MIN_RADIUS = 1.2;
const MAX_CONCURRENT_LOADS = 3;

export interface PlacedObject {
  model: string;
  template: string;
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
  /**
   * This building's own interior meshes, hidden until the portal renderer draws the building.
   * Empty until the player is close enough for a doorway to show anything: a building's inside
   * is the bulk of its geometry and is never visible from across the valley.
   */
  interior: THREE.Mesh[];
  /** Whether `interior` is currently built, so the sweep can tell "not yet" from "has none". */
  interiorBuilt: boolean;
}

interface LoadedTier {
  meshes: THREE.Object3D[];
  buildings: Building[];
  objects: PlacedObject[];
  /** Particle effects placed with this tier: effects of their own, and those attached to its models. */
  effects: EffectHandle[];
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
/** The padded box a cell-follow tests a point against: one scratch, since a ship is followed as often as the player. */
const tmpBox = new THREE.Box3();

/** Where the player is: outside (cell 0 of no building) or in a cell of a building. */
export interface CellState {
  building: Building;
  cell: number;
}

export class LayoutStreamer {
  readonly buildings = new Set<Building>();
  readonly objects: PlacedObject[] = [];
  private readonly regions = new Map<string, Region>();
  private readonly exclusionCells = new Map<string, Exclusion[]>();
  private readonly colliders = new Map<PlacedObject, R.Collider[]>();
  /**
   * Which object template each collider belongs to, so a ray that hits something can say what it is
   * made of (every template carries a surface type, and the planet's sound pack keeps the ones that
   * are not the default). Filled and emptied in the same two places the colliders themselves are.
   */
  private readonly colliderTemplate = new Map<number, string>();
  /** Objects wider than COLLIDER_RADIUS_CAP. Must stay a field initialiser: the constructor's loop fills it. */
  private readonly huge = new Set<PlacedObject>();
  /** Huge objects whose collision is still being built, a few pieces an update. A field initialiser, as `huge`. */
  private readonly hugeQueue: HugeJob[] = [];
  private loads = 0;
  private readonly failed = new Set<string>();
  /** The widest object's radius, which widens the region sweep for colliders. */
  private largestRadius = 0;
  private lastColliderX = Number.NaN;
  private lastColliderZ = Number.NaN;
  /** Where the last interior sweep ran, so a region loading in knows what is near. */
  private lastInteriorX = Number.NaN;
  private lastInteriorZ = Number.NaN;
  private lastInside: Building | null = null;
  private disposed = false;
  loadedModels = 0;
  loadedInstances = 0;
  /** How far each size tier loads, in metres; a world can reach farther than a planet does. */
  private ranges: number[];
  /**
   * Build a tier's programs before it is drawn (the world sets it to its own paced queue). A tier
   * used to be added to the scene the moment its models had loaded, and whatever materials it
   * brought that nothing had built yet were built on the frame that first drew them: standing still
   * on a planet while this ran made thirteen programs and two frames of over a second. So with this
   * set the meshes go in hidden and are shown once their programs exist, which costs a moment's
   * more pop-in on a fast machine and takes a freeze off a slow one. Null puts the old behaviour
   * back exactly.
   */
  prepare: ((objects: THREE.Object3D[]) => Promise<void>) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: Physics,
    private readonly pack: AssetPack,
    layout: Layout,
    private readonly effects: ParticleEffects | null = null,
    options: { reach?: number; hugeColliders?: boolean } = {},
  ) {
    this.ranges = TIERS.map((t) => t.range * (options.reach ?? 1));
    // Only a space pack's radii are the models' own (the space command measures them): a planet's
    // snapshot gives thousands of ordinary objects a radius of 1024 m or more, which must not all be
    // built tier-wide as huge.
    const hugeColliders = options.hugeColliders ?? false;
    for (const o of layout.objects) {
      // Snapshot space is mirrored in X and centred on the layout centre.
      const gx = -(o.x - layout.center.x);
      const gz = o.z - layout.center.z;
      const tier = TIERS.findIndex((t) => o.radius >= t.minRadius);
      const p: PlacedObject = { model: o.model, template: o.template, x: gx, y: o.y, z: gz, q: new THREE.Quaternion(o.q[1], -o.q[2], -o.q[3], o.q[0]), radius: o.radius, contained: !!o.contained, tier: tier < 0 ? TIERS.length - 1 : tier };
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
      if (!p.contained) this.largestRadius = Math.max(this.largestRadius, Math.min(p.radius, COLLIDER_RADIUS_CAP));
      if (hugeColliders && !p.contained && p.radius > COLLIDER_RADIUS_CAP) this.huge.add(p);
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
  /** What the layout places within `r` metres of a point, and whether each is drawable right now. */
  describeNear(x: number, z: number, r: number): { template: string; model: string; d: number; radius: number; size: string; tier: number; contained: boolean; inManifest: boolean; loaded: boolean; region: string; regionState: string }[] {
    const out = [];
    for (const o of this.objects) {
      const d = Math.hypot(o.x - x, o.z - z);
      if (d > r) continue;
      const rx = Math.floor(o.x / REGION);
      const rz = Math.floor(o.z / REGION);
      const region = this.regions.get(`${rx},${rz}`);
      const state = region?.tiers[o.tier];
      // The loaded model's real extent, from its geometry, beside the manifest's radius.
      const loaded = this.pack.loaded(o.model);
      let size = '';
      if (loaded) {
        const box = new THREE.Box3();
        for (const p of loaded.primitives) {
          if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
          box.union(p.geometry.boundingBox!);
        }
        const v = box.getSize(new THREE.Vector3());
        size = `${v.x.toFixed(2)}x${v.y.toFixed(2)}x${v.z.toFixed(2)} (${loaded.primitives.length} prims)`;
      }
      out.push({ template: o.template, model: o.model, d: Math.round(d), radius: o.radius, size, tier: o.tier, contained: o.contained, inManifest: !!this.pack.find(o.model), loaded: !!this.pack.loaded(o.model), region: `${rx},${rz}`, regionState: state === null ? 'not loaded' : state === 'loading' ? 'loading' : state ? 'loaded' : 'no region' });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  update(playerPos: THREE.Vector3, inside: Building | null = null): void {
    if (this.disposed) return;
    const px = playerPos.x;
    const pz = playerPos.z;
    // 60 m of hysteresis between building and dropping, so this only needs to run as the
    // player moves, not every frame.
    if (Number.isNaN(this.lastInteriorX) || Math.hypot(px - this.lastInteriorX, pz - this.lastInteriorZ) > 8 || inside !== this.lastInside) {
      this.lastInside = inside;
      this.updateInteriors(px, pz, inside);
    }
    // Nearest regions first so the player's surroundings fill in before the horizon.
    const candidates: { region: Region; tier: number; d: number }[] = [];
    for (const region of this.regions.values()) {
      const dx = Math.max(0, Math.abs(px - region.cx) - REGION / 2);
      const dz = Math.max(0, Math.abs(pz - region.cz) - REGION / 2);
      const d = Math.hypot(dx, dz);
      for (let t = 0; t < TIERS.length; t++) {
        const state = region.tiers[t];
        if (!region.objects[t].length) continue;
        if (d <= this.ranges[t]) {
          if (state === null) candidates.push({ region, tier: t, d });
        } else if (state && state !== 'loading' && d > this.ranges[t] * UNLOAD_SLACK) {
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
    this.buildHuge();
  }

  /** Scale the ranges the tiers load out to; what is now out of range drops on the next update, what is in loads. */
  setReach(scale: number): void {
    this.ranges = TIERS.map((t) => t.range * scale);
  }

  /**
   * Whether every tier that loads at a point (its region within the tier's own range) is loaded:
   * `update`'s own range test, with nothing loading or still to load. What a hyperspace arrival
   * waits for. Nothing allocated.
   */
  loadedAround(px: number, pz: number): boolean {
    if (this.disposed) return true;
    for (const region of this.regions.values()) {
      const dx = Math.max(0, Math.abs(px - region.cx) - REGION / 2);
      const dz = Math.max(0, Math.abs(pz - region.cz) - REGION / 2);
      const d = Math.hypot(dx, dz);
      for (let t = 0; t < TIERS.length; t++) {
        if (!region.objects[t].length || d > this.ranges[t]) continue;
        const state = region.tiers[t];
        if (state === null || state === 'loading') return false;
      }
    }
    return true;
  }

  /** Huge objects' collider pieces still to build (what the loading screen and a jump wait for). */
  get collidersPending(): number {
    return this.hugeQueue.length;
  }

  /** A huge object's collision, to be built a piece at a time; marked as having colliders so nothing builds it twice. */
  private queueHuge(o: PlacedObject): void {
    this.colliders.set(o, []);
    this.hugeQueue.push({ o, prim: 0, pieces: null, next: 0 });
  }

  /**
   * Build huge objects' collision for up to HUGE_BUILD_MS (at least one piece a call): each primitive
   * split once into pieces of HUGE_PIECE_TRIANGLES, each piece cleaned and built with TRIMESH_FLAGS
   * where the object stands, in the exterior group as `addColliders` does. An object whose model is
   * no longer loaded, or whose tier went (its colliders removed), is dropped from the queue. Called from
   * `update`; the world also calls it while it waits in a hidden tab, where no frame runs `update`.
   */
  buildHuge(): void {
    const queue = this.hugeQueue;
    if (!queue.length) return;
    const t0 = performance.now();
    let built = 0;
    while (queue.length && (built === 0 || performance.now() - t0 < HUGE_BUILD_MS)) {
      const job = queue[0];
      const o = job.o;
      const model = this.pack.loaded(o.model);
      const cols = this.colliders.get(o);
      if (!model || !cols || job.prim >= model.primitives.length) {
        queue.shift();
        continue;
      }
      const prim = model.primitives[job.prim];
      if (!job.pieces) {
        const posAttr = prim.geometry.getAttribute('position');
        if (!posAttr || posAttr.count < 3 || posAttr.itemSize !== 3 || (posAttr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
          job.prim++;
          continue;
        }
        const idx = prim.geometry.getIndex();
        const indices = idx ? new Uint32Array(idx.array as ArrayLike<number>) : Uint32Array.from({ length: posAttr.count - (posAttr.count % 3) }, (_, i) => i);
        job.pieces = splitTrimesh(new Float32Array(posAttr.array as ArrayLike<number>), indices, HUGE_PIECE_TRIANGLES);
        job.next = 0;
        built++;
        continue;
      }
      if (job.next >= job.pieces.length) {
        job.prim++;
        job.pieces = null;
        continue;
      }
      const piece = job.pieces[job.next++];
      const clean = cleanTrimesh(piece.vertices, piece.indices);
      if (clean) {
        const desc = R.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS)
          .setTranslation(o.x, o.y, o.z)
          .setRotation({ x: o.q.x, y: o.q.y, z: o.q.z, w: o.q.w })
          .setFriction(0.8);
        if (prim.cell === 0) desc.setCollisionGroups(groups(Group.exterior, Group.all));
        else if (prim.cell > 0) desc.setCollisionGroups(groups(Group.interior, Group.all));
        const col = this.physics.world.createCollider(desc);
        cols.push(col);
        this.colliderTemplate.set(col.handle, o.template);
      }
      built++;
    }
  }

  /** How much of what `settled` waits for is in, 0 to 1 (1 with nothing to wait for). */
  progress(px: number, pz: number, within = 220): number {
    if (this.disposed) return 1;
    let need = 0;
    let have = 0;
    for (const region of this.regions.values()) {
      const dx = Math.max(0, Math.abs(px - region.cx) - REGION / 2);
      const dz = Math.max(0, Math.abs(pz - region.cz) - REGION / 2);
      const d = Math.hypot(dx, dz);
      for (let t = 0; t < TIERS.length; t++) {
        if (!region.objects[t].length) continue;
        if (d > Math.min(this.ranges[t], within)) continue;
        need++;
        const state = region.tiers[t];
        if (state !== null && state !== 'loading') have++;
      }
    }
    return need ? have / need : 1;
  }

  /**
   * Whether every region a point can see out to `within` metres has its objects in: what a
   * loading screen waits for before the player is let go, so the ground and the buildings are
   * there to stand on and walk into rather than arriving under the feet.
   */
  settled(px: number, pz: number, within = 220): boolean {
    if (this.disposed) return true;
    for (const region of this.regions.values()) {
      const dx = Math.max(0, Math.abs(px - region.cx) - REGION / 2);
      const dz = Math.max(0, Math.abs(pz - region.cz) - REGION / 2);
      const d = Math.hypot(dx, dz);
      for (let t = 0; t < TIERS.length; t++) {
        if (!region.objects[t].length) continue;
        if (d > Math.min(this.ranges[t], within)) continue;
        const state = region.tiers[t];
        if (state === null || state === 'loading') return false;
      }
    }
    return true;
  }

  /**
   * One region's tier: its models loaded, its instances made, and then -- with the loading slot
   * already given back -- its programs built before the meshes are shown.
   *
   * The slot is given back the moment the models are in and instanced, which is where it was given
   * back before there was anything to compile. Held across the compile as well, three tiers whose
   * materials were new would hold all three of `MAX_CONCURRENT_LOADS` for as many frames as they
   * had programs, and no fourth tier would start: a town would fill in behind the player's walk
   * because of a shader queue, which is the opposite of the point.
   */
  private async loadTier(region: Region, tier: number): Promise<void> {
    const loaded = await this.buildTier(region, tier);
    if (!loaded || !this.prepare || !loaded.meshes.length) return;
    // The meshes went in hidden: they are shown once their programs exist, so no frame is ever the
    // first to draw a material nothing had built. The tier is already recorded, so an unload while
    // this waits takes them out in the ordinary way and the guard below drops the reveal.
    try {
      await this.prepare(loaded.meshes);
    } catch (err) {
      console.warn('snapshot: a tier could not be compiled ahead of its first draw; shown anyway', err);
    }
    if (this.disposed || region.tiers[tier] !== loaded) return;
    for (const mesh of loaded.meshes) mesh.visible = true;
  }

  /** The loading half of a tier, holding one of the streamer's slots for exactly as long as it loads. */
  private async buildTier(region: Region, tier: number): Promise<LoadedTier | null> {
    region.tiers[tier] = 'loading';
    this.loads++;
    try {
      const objects = region.objects[tier];
      const ids = [...new Set(objects.map((o) => o.model))];
      const models = new Map<string, LoadedModel>();
      for (const id of ids) {
        // Particle effects have no mesh to load; the effect player fetches their descriptions.
        if (this.pack.find(id)?.particle) continue;
        try {
          models.set(id, await this.pack.model(id));
        } catch (err) {
          // Missing or broken model: its instances are skipped, once noted.
          if (!this.failed.has(id)) {
            this.failed.add(id);
            console.warn(`snapshot model ${id} failed to load: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (this.disposed) return null;
      }
      if (region.tiers[tier] !== 'loading') return null;
      const loaded = this.instance(objects, models);
      region.tiers[tier] = loaded;
      // A huge object's collision comes with its tier, a few pieces an update, never keyed on the player's distance.
      for (const o of objects) if (this.huge.has(o) && !this.colliders.has(o)) this.queueHuge(o);
      // A region that arrives already under the player's nose needs its interiors now.
      for (const b of loaded.buildings) {
        if (Math.hypot(b.x - this.lastInteriorX, b.z - this.lastInteriorZ) - b.radius <= INTERIOR_RANGE) this.buildInterior(b);
      }
      // Models that finished loading after the last collider pass get their collision next update.
      this.lastColliderX = Number.NaN;
      return loaded;
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
    const meshes: THREE.Object3D[] = [];
    const buildings: Building[] = [];
    const effects: EffectHandle[] = [];
    const localFx = new THREE.Matrix4();
    if (this.effects) {
      for (const o of objects) {
        const def = this.pack.find(o.model);
        if (def?.particle) effects.push(this.effects.place(def.file, tmpM.compose(tmpV.set(o.x, o.y, o.z), o.q, ONE), o.contained));
      }
    }
    for (const [model, list] of byModel) {
      // A model's attached effects (lamps, fountains, chimneys) play at every placed copy.
      if (this.effects && model.def.effects?.length) {
        for (const p of list) {
          tmpM.compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
          for (const fx of model.def.effects) effects.push(this.effects.place(fx.file, localFx.multiplyMatrices(tmpM, mirroredTransform(fx.transform, localFx)), p.contained || (fx.cell ?? 0) > 0));
        }
      }
      const isBuilding = model.interiorBoxes.length > 0;
      const built: (Building | null)[] = list.map((p) => {
        if (!isBuilding || p.contained) return null;
        const matrix = new THREE.Matrix4().compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
        const b: Building = { model, x: p.x, z: p.z, radius: model.radius, matrix, inverse: matrix.clone().invert(), interior: [], interiorBuilt: false };
        buildings.push(b);
        this.buildings.add(b);
        return b;
      });
      for (const prim of model.primitives) {
        // Interiors of portal buildings are drawn per building and per cell by the portal renderer,
        // so each placed building gets its own meshes; a building without portal data draws normally.
        // Those meshes are made only once the player is near (see buildInterior).
        const perBuilding = prim.cell > 0 && model.portals.length > 0;
        const instanced = perBuilding ? list.filter((_, i) => !built[i]) : list;
        if (!instanced.length) continue;
        const mesh = new THREE.InstancedMesh(prim.geometry, prim.material, instanced.length);
        instanced.forEach((p, i) => {
          tmpM.compose(tmpV.set(p.x, p.y, p.z), p.q, ONE);
          mesh.setMatrixAt(i, tmpM);
        });
        // Objects placed inside buildings draw in every pass, like actors, so they show with the room.
        if (instanced.some((p) => p.contained)) mesh.layers.enable(ACTOR_LAYER);
        mesh.castShadow = model.radius >= SHADOW_MIN_RADIUS && castsShadow(prim.material);
        // A translucent fall or screen draws after the terrain water, which follows the player and
        // so always sorts nearer than this mesh's centre of all its placements.
        if (drawsAfterWater(prim.material)) mesh.renderOrder = 3;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        // Hidden until its programs exist (loadTier shows it); with no `prepare` set it is shown at once, as it always was.
        if (this.prepare) mesh.visible = false;
        this.scene.add(mesh);
        meshes.push(mesh);
      }
    }
    this.loadedModels += byModel.size;
    this.loadedInstances += objects.length;
    return { meshes, buildings, objects, effects };
  }

  /**
   * Make a building's interior meshes. Geometry and materials are shared with the model, so
   * this is a handful of Object3Ds, not a copy of the mesh; the portal renderer shows them.
   */
  private buildInterior(b: Building): void {
    if (b.interiorBuilt) return;
    b.interiorBuilt = true;
    if (!b.model.portals.length) return;
    const made: THREE.Mesh[] = [];
    for (const prim of b.model.primitives) {
      if (prim.cell <= 0) continue;
      const mesh = new THREE.Mesh(prim.geometry, prim.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(b.matrix);
      mesh.matrixWorld.copy(b.matrix);
      mesh.castShadow = castsShadow(prim.material);
      if (drawsAfterWater(prim.material)) mesh.renderOrder = 3;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.layers.set(INTERIOR_LAYER);
      b.interior.push(mesh);
      made.push(mesh);
    }
    if (!made.length) return;
    // Into the scene now, hidden, as they always have been: the portal renderer writes `visible`
    // itself for the cells it draws.
    //
    // They were held out of the scene until their programs existed, and that was a hole rather than
    // a late reveal. A tier held back is a thing not yet drawn; a cell held back is a room that is
    // not there -- the colliders are built elsewhere and are already in, so a player who walked in
    // before the queue reached the cells walked into an invisible interior and looked out through
    // the doorway at the world. A tier's reveal is the streamer's to hold and a cell's is not.
    //
    // A room's own materials are its own (the pack clones them so the portal renderer can stencil
    // them apart), so the first building of a kind does bring new programs with it. The compile is
    // asked for anyway, and it has the walk to the door to finish in; if the player beats it, the
    // frame that draws the cell builds the program exactly as it did before any of this, and the
    // frame loop's shader line says so.
    for (const mesh of made) this.scene.add(mesh);
    if (!this.prepare) return;
    void this.prepare(made).catch((err) => {
      console.warn('snapshot: a building’s rooms could not be compiled ahead of being drawn', err);
    });
  }

  /** Drop a building's interior meshes. Shared geometry and materials are left alone. */
  private dropInterior(b: Building): void {
    if (!b.interiorBuilt) return;
    for (const mesh of b.interior) this.scene.remove(mesh);
    b.interior.length = 0;
    b.interiorBuilt = false;
  }

  /**
   * Keep interiors around the player. The building the player is inside always keeps its own,
   * however far its far wings reach, so walking a long hall never empties the room ahead.
   */
  private updateInteriors(px: number, pz: number, inside: Building | null): void {
    this.lastInteriorX = px;
    this.lastInteriorZ = pz;
    for (const b of this.buildings) {
      if (b === inside) {
        this.buildInterior(b);
        continue;
      }
      const edge = Math.hypot(b.x - px, b.z - pz) - b.radius;
      if (edge <= INTERIOR_RANGE) this.buildInterior(b);
      else if (edge > INTERIOR_DROP) this.dropInterior(b);
    }
  }

  /** Buildings whose interiors are built right now, for the stats line. */
  get interiorCount(): number {
    let n = 0;
    for (const b of this.buildings) if (b.interiorBuilt) n++;
    return n;
  }

  /**
   * What lazy interiors save: meshes built now against the meshes every loaded building would
   * hold if each kept its interior the moment it streamed in. `force` builds them all, to see
   * the cost directly; the next sweep drops them again.
   */
  interiorStats(force = false): { buildings: number; built: number; meshes: number; eagerMeshes: number } {
    let buildings = 0;
    let built = 0;
    let meshes = 0;
    let eagerMeshes = 0;
    for (const b of this.buildings) {
      buildings++;
      if (force) this.buildInterior(b);
      if (b.interiorBuilt) {
        built++;
        meshes += b.interior.length;
      }
      eagerMeshes += b.model.portals.length ? b.model.primitives.filter((pr) => pr.cell > 0).length : 0;
    }
    return { buildings, built, meshes, eagerMeshes };
  }

  private unloadTier(region: Region, tier: number): void {
    const t = region.tiers[tier];
    if (!t || t === 'loading') return;
    for (const b of t.buildings) this.dropInterior(b);
    for (const mesh of t.meshes) {
      this.scene.remove(mesh);
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
    }
    for (const b of t.buildings) this.buildings.delete(b);
    for (const o of t.objects) this.removeColliders(o);
    // A huge object whose pieces were still being built stops being built.
    if (this.hugeQueue.length) {
      let keep = 0;
      for (const job of this.hugeQueue) if (!t.objects.includes(job.o)) this.hugeQueue[keep++] = job;
      this.hugeQueue.length = keep;
    }
    if (this.effects) for (const h of t.effects) this.effects.remove(h);
    this.loadedInstances -= t.objects.length;
    region.tiers[tier] = null;
  }

  /** Exact collision for the larger objects near the player; created and dropped as they move. */
  private updateColliders(px: number, pz: number): void {
    // Distances count from an object's edge, not its centre: a palace is wider than the range,
    // and its collision must stay while the player walks its far wings.
    for (const [o] of this.colliders) {
      // A huge object's collision comes and goes with its tier, not with the player's distance.
      if (this.huge.has(o)) continue;
      if (Math.hypot(o.x - px, o.z - pz) - o.radius > COLLIDER_RANGE * UNLOAD_SLACK) this.removeColliders(o);
    }
    const reach = COLLIDER_RANGE + this.largestRadius;
    const rx0 = Math.floor((px - reach) / REGION);
    const rx1 = Math.floor((px + reach) / REGION);
    const rz0 = Math.floor((pz - reach) / REGION);
    const rz1 = Math.floor((pz + reach) / REGION);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const region = this.regions.get(`${rx},${rz}`);
        if (!region) continue;
        for (const t of region.tiers) {
          if (!t || t === 'loading') continue;
          for (const o of t.objects) {
            if (o.contained || o.radius < COLLIDER_MIN_RADIUS || this.colliders.has(o) || this.huge.has(o)) continue;
            if (Math.hypot(o.x - px, o.z - pz) - o.radius > COLLIDER_RANGE) continue;
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
      if (!posAttr || posAttr.count < 3) continue;
      const idx = prim.geometry.getIndex();
      const indices = idx ? new Uint32Array(idx.array as ArrayLike<number>) : Uint32Array.from({ length: posAttr.count - (posAttr.count % 3) }, (_, i) => i);
      const desc = R.ColliderDesc.trimesh(new Float32Array(posAttr.array as ArrayLike<number>), indices)
        .setTranslation(o.x, o.y, o.z)
        .setRotation({ x: o.q.x, y: o.q.y, z: o.q.z, w: o.q.w })
        .setFriction(0.8);
      // Building shells and interiors get their own collision groups so someone inside ignores the shell.
      if (prim.cell === 0) desc.setCollisionGroups(groups(Group.exterior, Group.all));
      else if (prim.cell > 0) desc.setCollisionGroups(groups(Group.interior, Group.all));
      const col = this.physics.world.createCollider(desc);
      cols.push(col);
      this.colliderTemplate.set(col.handle, o.template);
    }
    this.colliders.set(o, cols);
  }

  private removeColliders(o: PlacedObject): void {
    const cols = this.colliders.get(o);
    if (!cols) return;
    for (const c of cols) {
      this.colliderTemplate.delete(c.handle);
      // Anything burnt, scarred or trodden on this thing goes with it: the marks are in the world's
      // frame and a mark left behind would hang in the air where the prop was. It is free when
      // nothing is owned, which is every pass in which nobody has shot a crate.
      marks.forget(c.handle);
      this.physics.removeCollider(c);
    }
    this.colliders.delete(o);
  }

  /**
   * The object template a collider belongs to, or null for anything else the ray can find (the
   * ground, a building's interior shell, a body). The handle is the physics engine's own.
   */
  templateOfCollider(handle: number): string | null {
    return this.colliderTemplate.get(handle) ?? null;
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
    return this.followThrough(state, prev, pos, 0.9, 25);
  }

  /**
   * The same for a vehicle, from a point taken as it is given (a hull's middle, not a walker's chest):
   * a ship flies in and out of a hangar through the same doorways. It is followed on its own clock, so
   * the step between two samples can be longer than a walker's; `maxJump` is how far it may have gone
   * before the path is taken for a teleport.
   */
  trackVehicleCell(state: CellState | null, prev: THREE.Vector3, pos: THREE.Vector3, maxJump: number): CellState | null {
    return this.followThrough(state, prev, pos, 0, maxJump * maxJump);
  }

  private followThrough(state: CellState | null, prev: THREE.Vector3, pos: THREE.Vector3, lift: number, maxJumpSq: number): CellState | null {
    const jump = prev.distanceToSquared(pos);
    if (jump > maxJumpSq) return null; // teleport (noclip, travel): start over outside
    if (state) {
      const b = state.building;
      localA.copy(prev).setY(prev.y + lift).applyMatrix4(b.inverse);
      localB.copy(pos).setY(pos.y + lift).applyMatrix4(b.inverse);
      // Left the building entirely (fell out of a window, no-clipped): back outside.
      if (!tmpBox.copy(b.model.bounds).expandByScalar(3).containsPoint(localB)) return null;
      for (const portal of b.model.portals) {
        const link = portal.links.find((l) => l.from === state.cell) ?? portal.links.find((l) => l.to === state.cell);
        if (!link || !portal.passable) continue;
        if (crossing(portal, localA, localB) !== null) {
          const target = link.from === state.cell ? link.to : link.from;
          return target === 0 ? null : { building: b, cell: target };
        }
      }
      // Out of every room's box (a balcony past an outside door whose crossing was missed, a
      // window): outside, or the outside stays hidden while the player walks on it.
      if (!b.model.interiorBoxes.some((box) => tmpBox.copy(box).expandByScalar(1).containsPoint(localB))) return null;
      return state;
    }
    for (const b of this.buildings) {
      if (Math.abs(b.x - pos.x) > b.radius + 4 || Math.abs(b.z - pos.z) > b.radius + 4) continue;
      localA.copy(prev).setY(prev.y + lift).applyMatrix4(b.inverse);
      localB.copy(pos).setY(pos.y + lift).applyMatrix4(b.inverse);
      for (const portal of b.model.portals) {
        const link = portal.links.find((l) => l.from === 0) ?? portal.links.find((l) => l.to === 0);
        if (!link || !portal.passable) continue;
        if (crossing(portal, localA, localB) !== null) {
          const target = link.from === 0 ? link.to : link.from;
          if (target > 0) return { building: b, cell: target };
        }
      }
    }
    return null;
  }

  /** Elevator terminals within `range` of a point: 'up', 'down' or 'both' (plain elevator terminals). The lift shafts themselves are lifts.ts. */
  elevatorsNear(pos: THREE.Vector3, range: number): { kind: 'up' | 'down' | 'both'; d: number }[] {
    const out: { kind: 'up' | 'down' | 'both'; d: number }[] = [];
    for (const o of this.objects) {
      if (!o.template.includes('terminal_elevator')) continue;
      const d = Math.hypot(o.x - pos.x, o.z - pos.z);
      if (d > range || Math.abs(o.y - pos.y) > 3) continue;
      out.push({ kind: o.template.includes('_up') ? 'up' : o.template.includes('_down') ? 'down' : 'both', d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /**
   * A building with rooms beside a point (within its radius and a few metres) that has no way in
   * on foot at all: not one passable doorway between outside and any of its rooms. The dungeons
   * whose way in was a server object, the stations whose doors are up in the air. The nearest
   * such, or null.
   *
   * It used to ask a narrower question -- whether a passable outside doorway stood within a dozen
   * metres of the player and near their height -- which made the offer of a way in a thing that
   * came and went as you walked round a building that has perfectly good doors, at the back, on
   * the far side, or up its steps. A building with a door is now never offered one, wherever the
   * player is standing, and the owner keeps a list of the doors the game cannot find rather than
   * the game papering over them.
   */
  doorlessNear(pos: THREE.Vector3): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      const d = Math.hypot(b.x - pos.x, b.z - pos.z);
      if (d > b.radius + 6 || !(b.model.def.cells?.length) || d >= bestD) continue;
      if (b.model.portals.some((p) => p.passable && p.links.some((l) => l.from === 0 || l.to === 0))) continue;
      bestD = d;
      best = b;
    }
    return best;
  }

  /**
   * The buildings around a point and why each does or does not count as doorless, for the console.
   * `outsideDoors` is the whole of the rule now: nought is a building the game offers a way into,
   * and any other number is one it expects you to walk into, so a building listed here with doors
   * that you cannot find on the ground is one for the owner's list.
   */
  describeDoorless(pos: THREE.Vector3): { model: string; d: number; radius: number; built: boolean; cells: number; portals: number; outsideDoors: number; doorless: boolean }[] {
    const out: { model: string; d: number; radius: number; built: boolean; cells: number; portals: number; outsideDoors: number; doorless: boolean }[] = [];
    for (const b of this.buildings) {
      const d = Math.hypot(b.x - pos.x, b.z - pos.z);
      if (d > b.radius + 30) continue;
      const outsideDoors = b.model.portals.filter((p) => p.passable && p.links.some((l) => l.from === 0 || l.to === 0)).length;
      out.push({ model: b.model.def.id, d: Math.round(d), radius: Math.round(b.radius), built: b.interiorBuilt, cells: b.model.def.cells?.length ?? 0, portals: b.model.portals.length, outsideDoors, doorless: outsideDoors === 0 && !!b.model.def.cells?.length });
    }
    return out;
  }

  /**
   * A way into a building for a player who cannot walk in: the room its outside doors open into
   * (even shut ones), else the lowest-numbered room, and a standing spot on that room's floor.
   */
  entryOf(b: Building): { cell: number; at: THREE.Vector3 } | null {
    this.buildInterior(b);
    const cells = (b.model.def.cells ?? []).filter((c) => c.index > 0);
    if (!cells.length) return null;
    const doorway = b.model.portals.find((p) => p.links.some((l) => l.from === 0 || l.to === 0));
    const link = doorway?.links.find((l) => l.from === 0 || l.to === 0);
    const index = link ? (link.from === 0 ? link.to : link.from) : cells[0].index;
    const cell = cells.find((c) => c.index === index) ?? cells[0];
    const [x0, y0, z0] = cell.bounds.min;
    const [x1, y1, z1] = cell.bounds.max;
    localA.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).applyMatrix4(b.matrix);
    // The room's lowest floor under its middle, in the world (the building may be turned, so the extent is the box's diagonal).
    const half = Math.hypot(y1 - y0) / 2 + 0.5;
    const floors = this.physics.floorsAt(localA.x, localA.z, localA.y + half, localA.y - half);
    const y = floors.length ? floors[floors.length - 1] + 0.15 : localA.y - half + 0.5;
    return { cell: cell.index, at: new THREE.Vector3(localA.x, y, localA.z) };
  }

  /** The building and cell holding a world point, for a player put there without walking in (a teleport), or null. */
  buildingAt(pos: THREE.Vector3): CellState | null {
    for (const b of this.buildings) {
      if (Math.abs(b.x - pos.x) > b.radius + 4 || Math.abs(b.z - pos.z) > b.radius + 4) continue;
      const cell = this.cellAt(b, pos);
      if (cell > 0) return { building: b, cell };
    }
    return null;
  }

  /**
   * Whether a world point stands in any streamed building's room: the same walk `buildingAt` makes,
   * asked as a yes or no. It is a method of its own and not a `!== null` on that one because
   * **`buildingAt` allocates** -- `{ building, cell }` is a fresh object on every hit -- and the
   * water rule in `World.footSurfaces.waterTop` is asked wherever a foot lands, a blade is lit or a
   * bolt stops. `cellAt` hands back a number and allocates nothing, so this walk is the prefilter's
   * two compares per streamed portal building, the cell boxes of whichever one holds the point, and
   * no garbage at all.
   */
  indoorsAt(pos: THREE.Vector3): boolean {
    for (const b of this.buildings) {
      if (Math.abs(b.x - pos.x) > b.radius + 4 || Math.abs(b.z - pos.z) > b.radius + 4) continue;
      if (this.cellAt(b, pos) > 0) return true;
    }
    return false;
  }

  /** The cell of a building whose bounds hold a world point (smallest first), or 0 for none. */
  cellAt(b: Building, pos: THREE.Vector3): number {
    localA.copy(pos).applyMatrix4(b.inverse);
    let best = 0;
    let bestVolume = Infinity;
    for (const c of b.model.def.cells ?? []) {
      if (c.index === 0) continue;
      const [x0, y0, z0] = c.bounds.min;
      const [x1, y1, z1] = c.bounds.max;
      if (localA.x < x0 - 0.5 || localA.x > x1 + 0.5 || localA.y < y0 - 0.5 || localA.y > y1 + 0.5 || localA.z < z0 - 0.5 || localA.z > z1 + 0.5) continue;
      const v = (x1 - x0) * (y1 - y0) * (z1 - z0);
      if (v < bestVolume) {
        bestVolume = v;
        best = c.index;
      }
    }
    return best;
  }

  get status(): string {
    return `${this.loadedInstances}/${this.objects.length} snapshot objects in view, ${this.loadedModels} models, ${this.colliders.size} exact colliders, ${this.interiorCount} interiors built`;
  }

  dispose(): void {
    this.disposed = true;
    for (const b of this.buildings) this.dropInterior(b);
    for (const region of this.regions.values()) for (let t = 0; t < TIERS.length; t++) this.unloadTier(region, t);
    for (const o of [...this.colliders.keys()]) this.removeColliders(o);
    this.hugeQueue.length = 0;
    this.buildings.clear();
  }
}
