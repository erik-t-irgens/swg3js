// Everything from the catalogue that is out on this planet: the spawns (a cap on how many, and on
// the bytes their models hold), the ambient wildlife, the lookup from a collider to its body, and
// the one loop that steps them all with the level of detail each has earned.
//
// A mobile is culled as a whole, against one sphere of its own, by setting its group's
// visibility: an invisible group is skipped by the renderer outright, so none of its meshes is
// drawn, none of its skeletons updated and none of its bone textures uploaded, in any of the
// portal renderer's passes. Its meshes keep `frustumCulled` false, so no per-mesh test runs and a
// skinned mesh never walks its vertices for a sphere of its own. The manager owns three flags on
// every mesh from the moment it is attached: the group's visibility, the shadow casting (at
// 2 Hz, by size and screen), and `frustumCulled` left false.
import * as THREE from 'three';
import type { Physics } from '../../core/physics';
import type { Terrain } from '../terrain';
import type { Bolts } from '../../combat/bolts';
import type { Effects } from '../../combat/effects';
import type { Living } from '../../combat/kit';
import { Mobile, type MobileContext, type MobileSpawn } from './mobile';
import { MOBILE_CACHE, type MobileAssets, type ModelAsset, type PackAsset } from './assets';
import { CATALOGUE_COMMAND, type MobileCatalogue } from './catalogue';
import { BRAIN_TUNE, type BrainTune } from './brain';
import { GAIT_LIMITS, moveSpeeds, type GaitLimits } from './gait';
import { LOD_TUNE, lodTier, type LodInput, type LodTier, type LodTune } from './lod';
import { describeRoles, rolesFor } from './packClips';
import type { BodyInput } from './shape';
import type { MobileEntry } from './types';
import type { CellState } from '../layoutStream';

export interface SpawnOpts {
  origin?: 'spawned' | 'ambient';
  scale?: number;
  inside?: boolean;
  overrides?: MobileSpawn['overrides'];
  heading?: number;
}

export interface MobileManagerDeps {
  physics: Physics;
  terrain: Terrain;
  bolts: Bolts;
  assets: MobileAssets;
  /** The effects, once they exist. */
  effects(): Effects | null;
  /**
   * The catalogue, or null while its fetch is still in flight. A getter, never a value: a manager
   * that captured null at a cold first load would be dead for the life of that planet.
   */
  catalogue(): MobileCatalogue | null;
  /** The list to fight over. */
  targets(): readonly Living[];
  /** The ground under a point, through the physics when inside a building. */
  groundAt(x: number, y: number, z: number, inside: boolean): number | null;
  /**
   * The room a mobile put down inside a building starts in (it walked through no portal to get
   * there): the smallest room box holding the point, else the player's room, or null.
   */
  cellAt(p: THREE.Vector3): CellState | null;
  /**
   * Follow a body through a building's portals, as the player is followed (`trackCell`): outside
   * until its path crosses a portal into a room, in that room until it crosses one out. Not by
   * the rooms' bounds: rooms are often larger than the hull, and a body on the street beside one
   * would be taken to be inside it and lose the terrain from its colliders.
   */
  followCell(state: CellState | null, prev: THREE.Vector3, pos: THREE.Vector3): CellState | null;
  /** A clear standing spot `distance` ahead of a point, or null. */
  spawnSpot(from: THREE.Vector3, forward: THREE.Vector3, distance: number, inside: boolean): THREE.Vector3 | null;
  /** A sentence when nothing may be stood here at all (space), else null. */
  refuse(): string | null;
  /** Whether shadows are on at all. */
  shadows(): boolean;
}

/** What a group-wide or console spawn reports. */
export interface SpawnResult {
  spawned: number;
  note: string;
  mobiles: Mobile[];
}

const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const tmp = new THREE.Vector3();
const ZERO = new THREE.Vector3();
/** The tier's input, filled per mobile every frame rather than made anew. */
const lodInput: LodInput = { dist: 0, onScreen: true, nearScreen: true, busy: false, sizeClass: 'small', shadows: false, playerDist: 0, animRange: LOD_TUNE.animRange };
/** Ambient wildlife this far from the player comes back somewhere nearer. */
const AMBIENT_RANGE = 260;
/** How often (seconds) a mobile's inside-or-out is asked again, and its shadow flag set. */
const INSIDE_EVERY = 0.25;
/** A body that has gone this far since its room was last followed is followed now, whatever the clock (the tracker takes a jump over 5 m as a teleport). */
const FOLLOW_STEP = 2;
const SHADOW_EVERY = 0.5;

interface Held {
  model: ModelAsset | null;
  pack: PackAsset | null;
  loading: boolean;
  error: string | null;
  lastInside: number;
  lastShadow: number;
  cast: boolean | null;
  visible: boolean | null;
  loaded: Promise<void>;
  /** Its tier, refilled every frame (the mobile keeps a reference to it for the console). */
  tier: LodTier;
  /** The building room it is in, followed through the portals, or null outside. */
  cell: CellState | null;
  /** Where its feet were when the room was last followed. */
  readonly cellFrom: THREE.Vector3;
}

export class MobileManager {
  readonly group = new THREE.Group();
  readonly live: Mobile[] = [];
  readonly byCollider = new Map<number, Mobile>();
  /** Bumped on every spawn and removal, so the world's target list knows when to rebuild. */
  version = 0;
  /** How many spawned mobiles may be out (the `mobileCap` setting). */
  cap = 40;
  /** Past this the mixers hold still (the `mobileAnimRange` setting). */
  animRange = LOD_TUNE.animRange;
  /** The last refusal or failure, for the spawner's count line. */
  lastNote = '';
  private readonly held = new Map<Mobile, Held>();
  private readonly ragdollQueue: Mobile[] = [];
  private readonly warned = new Set<string>();
  private frame = 0;
  private disposed = false;
  private readonly camPos = new THREE.Vector3();

  constructor(private readonly deps: MobileManagerDeps) {
    this.group.name = 'mobiles';
  }

  get assets(): MobileAssets {
    return this.deps.assets;
  }

  /** The catalogue, when it has landed. */
  catalogue(): MobileCatalogue | null {
    return this.deps.catalogue();
  }

  /** Why an entry cannot be stood now, in a sentence, or null when it can. */
  whyNot(entry: MobileEntry, cat: MobileCatalogue, origin: 'spawned' | 'ambient' = 'spawned'): string | null {
    const where = this.deps.refuse();
    if (where) return where;
    const ready = cat.ready(entry);
    if (!ready.ok) return `${entry.name} (${entry.id}) is not ready: ${ready.why}`;
    const app = cat.appearanceOf(entry);
    if (entry.kind === 'dressed') return `${entry.name} (${entry.id}) is a dressed NPC, stood through the fighters, which this spawner does not do yet`;
    if (app?.form === 'parts') return `${entry.name} (${entry.id}) is a person on a parts body, whose clothes this spawner cannot put on yet`;
    if (!app) return `${entry.name} (${entry.id}) names no appearance in the catalogue`;
    if (!cat.modelFile(entry)) return `${entry.name} (${entry.id}) has no model file`;
    const failed = this.deps.assets.failure(cat.modelFile(entry)!);
    if (failed) return `${entry.name}: ${failed}`;
    if (origin === 'spawned' && this.spawnedCount() >= this.cap) return `${this.cap} are out already (Graphics, Distance and detail)`;
    const cost = this.deps.assets.wouldCost(entry, cat);
    if (cost > 0) {
      const room = MOBILE_CACHE.budget - this.deps.assets.referencedBytes();
      if (cost > room) {
        const mb = (n: number) => Math.round(n / 1e6);
        return `the creature and NPC models already out fill their memory budget (${mb(this.deps.assets.referencedBytes())} of ${mb(MOBILE_CACHE.budget)} MB); clear some, or raise it with __debug.mobileTune({ budget: ${Math.round((MOBILE_CACHE.budget * 1.5) / 1e7) * 1e7} })`;
      }
    }
    return null;
  }

  private spawnedCount(): number {
    let n = 0;
    for (const m of this.live) if (m.origin === 'spawned') n++;
    return n;
  }

  /**
   * Stand one entry at a point (on the ground under it, or on the floor when inside). Returns the
   * mobile, whose model then loads behind it, or a sentence saying why not. The body exists at
   * once, so the cap and the counts are right before anything has downloaded.
   */
  spawn(entry: MobileEntry, at: { x: number; z: number; y?: number; heading?: number }, opts: SpawnOpts = {}): Mobile | string {
    if (this.disposed) return 'the world has gone';
    const cat = this.deps.catalogue();
    if (!cat) return `the creature and NPC catalogue has not loaded yet (or is not converted: ${CATALOGUE_COMMAND})`;
    const origin = opts.origin ?? 'spawned';
    const why = this.whyNot(entry, cat, origin);
    if (why) {
      this.lastNote = why;
      return why;
    }
    const app = cat.appearanceOf(entry)!;
    const pack = cat.packOf(entry);
    const inside = opts.inside ?? false;
    let y = at.y;
    if (y === undefined) {
      const ground = this.deps.groundAt(at.x, this.deps.terrain.heightAt(at.x, at.z) + 3, at.z, inside);
      if (ground === null) {
        if (inside) return (this.lastNote = 'there is no floor under that spot');
        y = this.deps.terrain.heightAt(at.x, at.z);
      } else y = ground;
    }
    const hierarchy: BodyInput['hierarchy'] = pack?.hierarchy === 'creature_base' || pack?.hierarchy === 'all_b' ? pack.hierarchy : 'other';
    const spawn: MobileSpawn = {
      entry,
      x: at.x,
      y,
      z: at.z,
      heading: at.heading ?? opts.heading ?? Math.random() * Math.PI * 2,
      origin,
      inside,
      bounds: app.bounds,
      hierarchy,
      scale: opts.scale,
      overrides: opts.overrides,
    };
    const m = new Mobile(spawn, {
      physics: this.deps.physics,
      terrain: this.deps.terrain,
      bolts: this.deps.bolts,
      effects: () => this.deps.effects(),
      alert: (self, attacker) => this.assist(self, attacker),
      groundAt: (x, gy, z, ins) => this.deps.groundAt(x, gy, z, ins),
      wantRagdoll: (self) => this.queueRagdoll(self),
    });
    this.live.push(m);
    for (const c of m.colliders) this.byCollider.set(c.handle, m);
    this.group.add(m.group);
    this.version++;
    const held: Held = {
      model: null,
      pack: null,
      loading: true,
      error: null,
      lastInside: -1,
      lastShadow: -1,
      cast: null,
      visible: null,
      loaded: Promise.resolve(),
      tier: { name: 'near', animEvery: 1, visible: true, castShadow: false, think: LOD_TUNE.think[0], move: true },
      cell: null,
      cellFrom: m.pos.clone(),
    };
    if (inside) {
      held.cell = this.deps.cellAt(m.pos);
      m.room = held.cell?.cell ?? 0;
    }
    this.held.set(m, held);
    held.loaded = this.load(m, held, entry, cat);
    return m;
  }

  /** The model and the pack for a mobile, then the model hung on the body, unless it has gone meanwhile. */
  private async load(m: Mobile, held: Held, entry: MobileEntry, cat: MobileCatalogue): Promise<void> {
    const assets = this.deps.assets;
    const file = cat.modelFile(entry)!;
    const app = cat.appearanceOf(entry)!;
    const packInfo = cat.packOf(entry);
    const hologram = (entry.flags ?? []).includes('hologram');
    const before = assets.stats().models.length + assets.stats().packs.length;
    // Taken before the first await: a load in flight counts against the budget at its estimate from
    // this moment, so the next spawn in the same tick sees it (`referencedBytes`).
    const guess = assets.estimate(entry, cat);
    const [model, pack] = await Promise.allSettled([
      assets.acquireModel(file, { hologram, bounds: app.bounds, estimate: guess.model }),
      packInfo ? assets.acquirePack(packInfo.id, packInfo.file, packInfo.json, guess.pack) : Promise.resolve(null),
    ]);
    held.loading = false;
    const gotModel = model.status === 'fulfilled' ? model.value : null;
    const gotPack = pack.status === 'fulfilled' ? pack.value : null;
    const failure = model.status === 'rejected' ? model.reason : pack.status === 'rejected' ? pack.reason : null;
    if (failure || !gotModel) {
      if (gotModel) assets.release(gotModel);
      if (gotPack) assets.release(gotPack);
      held.error = String((failure as Error)?.message ?? failure);
      this.lastNote = `${entry.name}: ${held.error}`;
      console.warn(`mobiles: ${entry.id} could not be stood: ${held.error}`);
      if (!m.removed) this.remove(m);
      return;
    }
    if (m.removed || m.dead) {
      // Gone while it loaded (killed, cleared, the world unloaded): nothing is hung, everything goes back.
      assets.release(gotModel);
      if (gotPack) assets.release(gotPack);
      return;
    }
    const r = m.attach(gotModel, gotPack);
    if (!r.ok) {
      assets.release(gotModel);
      if (gotPack) assets.release(gotPack);
      return;
    }
    held.model = gotModel;
    held.pack = gotPack;
    // It is ready now: it joins the list of the living (a mobile still loading is left out of it).
    this.version++;
    if (r.warning && !this.warned.has(r.warning)) {
      this.warned.add(r.warning);
      console.warn(`mobiles: ${r.warning}; it plays what it can`);
    }
    // Something new came in: the cache may be over its budget with things nobody holds.
    const after = assets.stats().models.length + assets.stats().packs.length;
    if (after > before) assets.trim();
  }

  /**
   * Stand `n` of an entry `distance` ahead of a point, on a ring when several, each facing back
   * at the point. Awaiting `loaded` on each says when they are up.
   */
  spawnAhead(entry: MobileEntry, from: THREE.Vector3, forward: THREE.Vector3, n = 1, distance = 10, inside = false): SpawnResult {
    const mobiles: Mobile[] = [];
    let note = '';
    const fwd = tmp.set(forward.x, 0, forward.z);
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1);
    fwd.normalize();
    const centre = new THREE.Vector3(from.x + fwd.x * distance, from.y, from.z + fwd.z * distance);
    const cat = this.deps.catalogue();
    const app = cat?.appearanceOf(entry);
    const size = app ? Math.max(Math.abs(app.bounds.max[0] - app.bounds.min[0]), Math.abs(app.bounds.max[2] - app.bounds.min[2])) : 1;
    const ring = n > 1 ? Math.max(1.5, (size * n) / (2 * Math.PI) + size * 0.3) : 0;
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const p = new THREE.Vector3(centre.x + Math.sin(a) * ring, from.y, centre.z + Math.cos(a) * ring);
      const spot = this.deps.spawnSpot(p, ZERO, 0, inside);
      if (!spot) {
        note = inside ? 'there is no floor under that spot' : 'no ground there';
        continue;
      }
      const heading = Math.atan2(from.x - spot.x, from.z - spot.z);
      const got = this.spawn(entry, { x: spot.x, y: spot.y, z: spot.z, heading }, { inside });
      if (typeof got === 'string') {
        note = got;
        break;
      }
      mobiles.push(got);
    }
    if (!note) note = mobiles.length ? `${mobiles.length} ${entry.name} stood` : 'nothing stood';
    else if (mobiles.length) note = `${mobiles.length} stood; ${note}`;
    return { spawned: mobiles.length, note, mobiles };
  }

  /** The planet's own wildlife: `count` of an entry about a point, respawned rather than removed. Returns how many stood. */
  spawnAmbient(entry: MobileEntry, count: number, centre: THREE.Vector3, overrides?: MobileSpawn['overrides']): number {
    let n = 0;
    for (let i = 0; i < count; i++) {
      const p = this.pickSpot(centre);
      const got = this.spawn(entry, { x: p.x, y: p.y, z: p.z }, { origin: 'ambient', overrides });
      if (typeof got === 'string') break;
      n++;
    }
    return n;
  }

  private pickSpot(centre: THREE.Vector3): THREE.Vector3 {
    const terrain = this.deps.terrain;
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = 35 + Math.random() * 90;
      const x = centre.x + Math.sin(a) * r;
      const z = centre.z + Math.cos(a) * r;
      const h = terrain.heightAt(x, z);
      if (h > terrain.waterHeightAt(x, z) + 0.5) return new THREE.Vector3(x, h, z);
    }
    return new THREE.Vector3(centre.x, terrain.heightAt(centre.x, centre.z), centre.z);
  }

  /** Take one away now: its colliders' handles go at the moment the body does, and its assets are released. */
  remove(m: Mobile): void {
    const i = this.live.indexOf(m);
    if (i >= 0) this.live.splice(i, 1);
    for (const c of m.colliders) if (this.byCollider.get(c.handle) === m) this.byCollider.delete(c.handle);
    this.group.remove(m.group);
    const q = this.ragdollQueue.indexOf(m);
    if (q >= 0) this.ragdollQueue.splice(q, 1);
    m.dispose();
    const held = this.held.get(m);
    if (held) {
      if (held.model) this.deps.assets.release(held.model);
      if (held.pack) this.deps.assets.release(held.pack);
      held.model = null;
      held.pack = null;
      this.held.delete(m);
    }
    this.version++;
  }

  /** Take away every spawned mobile the filter picks (all spawned ones without one); the wildlife stays. Returns how many. */
  clear(filter?: (m: Mobile) => boolean): number {
    let n = 0;
    for (const m of [...this.live]) {
      if (m.origin !== 'spawned') continue;
      if (filter && !filter(m)) continue;
      this.remove(m);
      n++;
    }
    return n;
  }

  /** Out and loading, by entry id. */
  counts(): Map<string, { out: number; loading: number }> {
    const out = new Map<string, { out: number; loading: number }>();
    for (const m of this.live) {
      const c = out.get(m.entry.id) ?? out.set(m.entry.id, { out: 0, loading: 0 }).get(m.entry.id)!;
      c.out++;
      if (!m.ready) c.loading++;
    }
    return out;
  }

  /** How many are out, of one entry or of all. */
  count(entryId?: string): number {
    if (!entryId) return this.live.length;
    let n = 0;
    for (const m of this.live) if (m.entry.id === entryId) n++;
    return n;
  }

  /** When a mobile's model is up (or failed). */
  loaded(m: Mobile): Promise<void> {
    return this.held.get(m)?.loaded ?? Promise.resolve();
  }

  /** Why a mobile's load failed, if it did. */
  loadError(m: Mobile): string | null {
    return this.held.get(m)?.error ?? null;
  }

  /** The pack turns together: everything of the same catalogue group within `assist` and not passive remembers the attacker too. */
  assist(self: Mobile, attacker: Living): void {
    for (const m of this.live) {
      if (m === self || m.dead || m.aggression === 'passive' || m.entry.group !== self.entry.group) continue;
      if (m.pos.distanceTo(self.pos) > BRAIN_TUNE.assist) continue;
      m.provoke(attacker);
    }
  }

  private queueRagdoll(m: Mobile): void {
    if (m.queued || m.ragdoll || m.removed) return;
    m.queued = true;
    this.ragdollQueue.push(m);
  }

  /** Step every mobile with the detail its distance and the screen allow; start a couple of queued ragdolls, nearest first. */
  update(dt: number, ctx: MobileContext): void {
    if (this.disposed) return;
    this.frame++;
    const camera = ctx.camera;
    if (camera) {
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      camera.getWorldPosition(this.camPos);
    } else this.camPos.copy(ctx.playerPos);
    const shadows = this.deps.shadows();
    const tune = LOD_TUNE;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const m = this.live[i];
      const held = this.held.get(m);
      if (!held) continue;
      // Spent: a spawned one is taken away, the wildlife comes back somewhere else.
      // The fallen-out-of-the-world floor never applies inside a building: dungeon rooms go far below it.
      const spent = (m.dead && m.deadTimer <= 0) || (!m.inside && m.pos.y < this.deps.terrain.floor - 20);
      if (m.origin === 'spawned') {
        if (spent) {
          this.remove(m);
          continue;
        }
      } else if (spent || m.pos.distanceTo(ctx.playerPos) > AMBIENT_RANGE) {
        const p = this.pickSpot(ctx.playerPos);
        m.respawn(p.x, p.y, p.z);
        // Back on open ground, in no room.
        held.cell = null;
        held.cellFrom.copy(m.pos);
        m.room = 0;
        m.setInside(false);
        this.version++;
      }
      // Its room, followed through the portals four times a second (staggered), and sooner when it has gone a couple of metres.
      if (!m.dead && (ctx.now - held.lastInside >= INSIDE_EVERY || held.cellFrom.distanceToSquared(m.pos) > FOLLOW_STEP * FOLLOW_STEP)) {
        held.lastInside = ctx.now + ((m.key % 7) / 7) * INSIDE_EVERY * 0.5;
        held.cell = this.deps.followCell(held.cell, held.cellFrom, m.pos);
        held.cellFrom.copy(m.pos);
        m.room = held.cell?.cell ?? 0;
        m.setInside(held.cell !== null);
      }
      const tier = this.tierOf(m, camera, ctx.playerPos, shadows, tune, held.tier);
      // The whole cull: a group that is not visible is in no pass at all.
      const visible = tier.visible || !!m.ragdoll;
      if (held.visible !== visible) {
        m.group.visible = visible;
        held.visible = visible;
      }
      if (ctx.now - held.lastShadow >= SHADOW_EVERY || held.cast === null) {
        held.lastShadow = ctx.now;
        const cast = tier.castShadow && !m.hologram;
        if (held.cast !== cast || m.meshes.some((x) => x.castShadow !== cast)) {
          for (const mesh of m.meshes) mesh.castShadow = cast;
          held.cast = cast;
        }
      }
      m.update(dt, ctx, tier);
    }
    // The queue: a couple of ragdolls a frame, nearest the camera first; the rest hold their death pose.
    if (this.ragdollQueue.length) {
      this.ragdollQueue.sort((a, b) => a.pos.distanceToSquared(this.camPos) - b.pos.distanceToSquared(this.camPos));
      const n = Math.min(this.ragdollQueue.length, Math.max(1, tune.ragdollsPerFrame));
      for (const m of this.ragdollQueue.splice(0, n)) m.startRagdoll();
    }
  }

  /** The tier for one mobile: its world sphere against the frustum as it is and grown by the shadow slack. */
  private tierOf(m: Mobile, camera: THREE.Camera | null, playerPos: THREE.Vector3, shadows: boolean, tune: LodTune, out: LodTier): LodTier {
    const cull = m.plan.cull;
    const radius = (m.ragdoll ? 2 : 1) * cull.radius;
    sphere.center.set(m.pos.x, m.pos.y + cull.y, m.pos.z);
    sphere.radius = radius;
    const dist = sphere.center.distanceTo(this.camPos);
    let onScreen = true;
    let nearScreen = true;
    if (camera) {
      onScreen = frustum.intersectsSphere(sphere);
      if (!onScreen) {
        sphere.radius = radius + tune.shadowSlack;
        nearScreen = frustum.intersectsSphere(sphere);
      }
    }
    const i = lodInput;
    i.dist = dist;
    i.onScreen = onScreen;
    i.nearScreen = nearScreen;
    i.busy = m.busy;
    i.sizeClass = m.entry.stats?.sizeClass ?? 'small';
    i.shadows = shadows;
    i.playerDist = m.pos.distanceTo(playerPos);
    i.animRange = this.animRange;
    return lodTier(i, tune, out);
  }

  /** For `__debug.mobileCull`: every mobile's world sphere, whether it is on and near the screen, drawn, casting, and its tier. */
  cullReport(camera: THREE.Camera | null, playerPos: THREE.Vector3): Record<string, unknown>[] {
    if (camera) {
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      camera.getWorldPosition(this.camPos);
    }
    return this.live.map((m) => {
      const cull = m.plan.cull;
      const radius = (m.ragdoll ? 2 : 1) * cull.radius;
      sphere.center.set(m.pos.x, m.pos.y + cull.y, m.pos.z);
      sphere.radius = radius;
      const onScreen = camera ? frustum.intersectsSphere(sphere) : true;
      sphere.radius = radius + LOD_TUNE.shadowSlack;
      const nearScreen = camera ? frustum.intersectsSphere(sphere) : true;
      return {
        key: m.key,
        id: m.entry.id,
        centre: [m.pos.x, m.pos.y + cull.y, m.pos.z].map((n) => Number(n.toFixed(1))),
        radius: Number(radius.toFixed(2)),
        dist: Number(m.pos.distanceTo(this.camPos).toFixed(1)),
        playerDist: Number(m.pos.distanceTo(playerPos).toFixed(1)),
        onScreen,
        nearScreen,
        visible: m.group.visible,
        castShadow: m.meshes.some((x) => x.castShadow),
        tier: m.tier?.name ?? null,
      };
    });
  }

  /** For `__debug.mobileRoles`: an entry's pack, its roles, the gait speeds, the template's, and what the game will move at. */
  async rolesReport(entry: MobileEntry): Promise<Record<string, unknown>> {
    const cat = this.deps.catalogue();
    if (!cat) return { error: `the catalogue has not loaded (or is not converted: ${CATALOGUE_COMMAND})` };
    const info = cat.packOf(entry);
    if (!info) return { entry: entry.id, error: 'no animation pack' };
    const json = await this.deps.assets.packJson(info.id, info.json);
    const roles = rolesFor(json, entry.gender);
    const app = cat.appearanceOf(entry);
    const [lo, hi] = entry.size?.scale ?? [1, 1];
    const scale = (lo + hi) / 2 || 1;
    const speeds = moveSpeeds(roles, scale, entry.move, GAIT_LIMITS);
    return {
      entry: entry.id,
      name: entry.name,
      pack: info.id,
      hierarchy: info.hierarchy,
      appearance: app?.id ?? null,
      joints: app?.joints ?? null,
      summary: describeRoles(roles),
      roles,
      gaits: roles.gaits,
      template: { walk: entry.move.walk, run: entry.move.run },
      scale,
      walk: Number(speeds.walk.toFixed(2)),
      run: Number(speeds.run.toFixed(2)),
      aggression: entry.stats?.aggression,
      ranged: roles.ranged && entry.stats?.ranged ? entry.stats.ranged.range : 0,
    };
  }

  /**
   * For `__debug.mobileTune`: read, or change live, the brain's, the tiers' and the gaits' numbers
   * and the cache's budget; `cap` and `animRange` are this planet's settings. Returns them all.
   */
  tune(t?: { brain?: Partial<BrainTune>; lod?: Partial<Omit<LodTune, 'shadow'>> & { shadow?: Partial<LodTune['shadow']> }; gait?: Partial<GaitLimits>; budget?: number; concurrency?: number; failFor?: number; cap?: number; animRange?: number }): Record<string, unknown> {
    if (t) {
      if (t.brain) Object.assign(BRAIN_TUNE, t.brain);
      if (t.lod) {
        const { shadow, ...rest } = t.lod;
        Object.assign(LOD_TUNE, rest);
        if (shadow) Object.assign(LOD_TUNE.shadow, shadow);
      }
      if (t.gait) Object.assign(GAIT_LIMITS, t.gait);
      if (t.budget !== undefined) MOBILE_CACHE.budget = t.budget;
      if (t.concurrency !== undefined) MOBILE_CACHE.concurrency = Math.max(1, Math.floor(t.concurrency));
      if (t.failFor !== undefined) MOBILE_CACHE.failFor = t.failFor;
      if (t.cap !== undefined) this.cap = t.cap;
      if (t.animRange !== undefined) this.animRange = t.animRange;
      if (t.budget !== undefined) this.deps.assets.trim();
    }
    return { brain: { ...BRAIN_TUNE }, lod: { ...LOD_TUNE, shadow: { ...LOD_TUNE.shadow } }, gait: { ...GAIT_LIMITS }, cache: { ...MOBILE_CACHE }, cap: this.cap, animRange: this.animRange };
  }

  /** Every mobile and every queued load goes (the world is unloading). The assets are released, not disposed: the cache outlives the planet. */
  dispose(): void {
    this.disposed = true;
    for (const m of [...this.live]) this.remove(m);
    this.live.length = 0;
    this.byCollider.clear();
    this.ragdollQueue.length = 0;
    this.held.clear();
    this.version++;
  }
}
