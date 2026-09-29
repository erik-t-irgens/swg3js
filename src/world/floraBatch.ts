// The planet's flora drawn per 256 m region rather than per 64 m chunk, at the client's own detail levels
// (step 7 of the frame-time wave).
//
// A chunk used to be one instanced mesh per model per piece, so the thirteen-by-thirteen window was 574 to
// 4,161 draws of plants at their finest out to 400 m. Now each chunk keeps what it planted as data (a matrix,
// a place, a model a planting) beside the meshes it always built, and the field draws them per region, per
// model, per level: at the Theed starport that is 253 batches where there were 1,716 meshes, and far plants
// are the client's own lower levels -- the sprite cards on the 58 plants whose lowest level is one. The
// chunk's own meshes stay built and hidden while the field draws, so the old way is one flip of `shown`.
//
// What decides whether a chunk's plants and trees are drawn at all is still the plant reach's (step 5,
// `floraReach.ts`): its sweep writes each chunk's `plants` and `trees` groups visible or not, with its own
// hysteresis, and the field reads those two flags. A chunk whose ground is hidden (a basement under a
// building) draws none of its flora here either. The level of each planting is picked by `levelOf` from its
// own distance to the eye.
//
// A region is rebuilt when a chunk in it came or went or any planting in it changed level, at most
// `regionsPerFrame` a frame, and whole behind a loading screen. A batch's capacity grows by doubling: its
// meshes are then made again (and the old ones disposed, which frees their instance buffer), which makes no
// program, since a program belongs to the material. Nothing is allocated by a sweep, and a rebuild allocates
// only when a region meets a model or a level it has not drawn before, or a batch outgrows its store: the
// chunks, the regions and each region's batches are walked through kept arrays rather than a map's iterator,
// and a planting's matrix is copied number by number rather than through a view.
//
// The shadow rule (`levelCasts`: the lowest level casts nothing once its switch is past the second cascade)
// is applied again to every batch whenever where that cascade ends or the level scale moves, not only when a
// region happens to be rebuilt, so shadows switched on or a shadow distance moved never leave a batch casting
// by the old answer.
import * as THREE from 'three';
import type { LoadedModel, Primitive } from './assetPack.ts';
import { keepUploadRange, type UploadRange } from './uploadRange.ts';
import { LOD_LEVEL_DEFAULTS, LOD_LEVEL_TUNE, levelCasts, levelOf, type LodLevelTune } from './lodLevels.ts';
import { fitInstanceSphere } from './levelGroup.ts';
import { CHUNK_SIZE } from './terrain.ts';

/** A flora model's radius times its scale under which it never casts a shadow: `flora.ts`'s own rule. */
const SHADOW_MIN_RADIUS = 1.2;

/** The side of a flora region, metres: four chunks by four, the placed objects' own region. */
export const FLORA_REGION = 256;

/** The switch: the region batches draw the plantings (true), or every chunk draws its own as before (false). */
export const FLORA_BATCH = { on: true };

/** What one chunk planted, as data: a model, a world matrix and a place a planting, and whether it is a tree. */
export interface FloraChunkData {
  n: number;
  models: LoadedModel[];
  /** `n × 16`, column-major, as three writes an instance matrix. */
  mats: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  scale: Float32Array;
  /** 1 for collidable flora (a tree), 0 for the rest (a plant). */
  collidable: Uint8Array;
}

/** The part of a chunk the field reads each sweep: whether its plants and its trees are shown (the reach's), and its ground. */
export interface FloraChunkFlags {
  readonly group: { readonly visible: boolean };
  readonly trees: { readonly visible: boolean } | null;
  readonly plants: { readonly visible: boolean } | null;
}

/** A model's levels as the pick reads them: switch distances, how many, and its chain's last far. */
interface ModelLevels {
  count: number;
  nears: Float32Array;
  beyond: number;
  /** Each level's pieces: the finest's are the model's own. */
  prims: readonly (readonly Primitive[])[];
  /** Level 0's switch distance to the next, for the shadow rule; per level. */
  nearOf: Float32Array;
}

interface ChunkRec {
  key: string;
  data: FloraChunkData;
  flags: FloraChunkFlags;
  /** Per planting: its level, or its model's level count for "not drawn". -1 before the first sweep. */
  level: Int8Array;
  /** Per planting, its model's levels, looked up once when the chunk is added so a sweep makes no lookup. */
  ml: ModelLevels[];
  region: Region;
  /** Where it stands in the field's kept list of chunks. */
  at: number;
}

/** One model at one level in one region: a mesh a piece, all sharing one instance store. */
interface Batch {
  model: LoadedModel;
  /** The model's levels, as the pick reads them. */
  levels: ModelLevels;
  /** The level's position among the model's carried levels. */
  level: number;
  meshes: THREE.InstancedMesh[];
  attr: THREE.InstancedBufferAttribute | null;
  cap: number;
  count: number;
  /** Written by a rebuild's counting pass, then its fill. */
  want: number;
  fill: number;
  maxScale: number;
  /** Whether the finest rule would have it cast (its model's radius at its biggest planting's scale), as last rebuilt. */
  base: boolean;
  range: UploadRange;
}

interface Region {
  key: string;
  rx: number;
  rz: number;
  chunks: ChunkRec[];
  /** Per model, a batch per level (index = level position), made as the region first meets it. */
  batches: Map<LoadedModel, (Batch | null)[]>;
  /** The same batches in one kept list, walked by index. */
  list: Batch[];
  dirty: boolean;
  /** Where it stands in the field's kept list of regions. */
  at: number;
}

/** What the field came to, for the console and the frame report. */
export interface FloraFieldStats {
  chunks: number;
  regions: number;
  batches: number;
  meshes: number;
  /** Batch meshes drawing something now. */
  drawing: number;
  /** Plantings drawn at each level position (0 the finest), and those not drawn. */
  byLevel: number[];
  hidden: number;
  rebuilds: number;
  dirty: number;
  sweeps: number;
}

export class FloraField {
  private readonly regions = new Map<string, Region>();
  private readonly chunks = new Map<string, ChunkRec>();
  /** The chunks and the regions again, in kept lists a sweep walks by index (a map's iterator is an object a walk). */
  private readonly chunkList: ChunkRec[] = [];
  private readonly regionList: Region[] = [];
  /**
   * The regions waiting for a rebuild, oldest first, in the first `dirtyCount` slots. The list's own length is
   * never cut back, since a cut frees its store and the next region marked would make a new one.
   */
  private readonly dirtyList: (Region | null)[] = [];
  private dirtyCount = 0;
  private readonly levelsOf = new Map<LoadedModel, ModelLevels>();
  /** Whether the batches are what is drawn (the switch); the chunks' own meshes are the other way. */
  shown = true;
  readonly stats: FloraFieldStats = { chunks: 0, regions: 0, batches: 0, meshes: 0, drawing: 0, byLevel: [0, 0, 0, 0], hidden: 0, rebuilds: 0, dirty: 0, sweeps: 0 };
  /** Where the second shadow cascade ends, metres (Infinity with none known): the lowest level past it casts nothing. */
  private far2 = Number.POSITIVE_INFINITY;
  /** The level scale the last sweep used, for the shadow rule, and the rule's reach it applied. */
  private scale = 1;
  private shadowReach = LOD_LEVEL_DEFAULTS.shadowLevelMax;

  /**
   * `root` is what the batches hang under (the ground's root, so the exit narrowing sees them); `onMesh` is
   * handed every batch mesh the moment it is made, before it is ever drawn (the world adopts its materials
   * and offers it to the narrowing with its sphere).
   */
  private readonly root: THREE.Object3D;
  private readonly onMesh: (mesh: THREE.InstancedMesh) => void;
  private readonly tune: LodLevelTune;

  constructor(root: THREE.Object3D, onMesh: (mesh: THREE.InstancedMesh) => void = () => {}, tune: LodLevelTune = LOD_LEVEL_TUNE) {
    this.root = root;
    this.onMesh = onMesh;
    this.tune = tune;
  }

  /** Where the second shadow cascade ends, metres (Infinity with none known). */
  get cascadeFar(): number {
    return this.far2;
  }

  /**
   * Where the second shadow cascade ends now: when it moved (shadows switched on or off, a shadow distance
   * changed), every batch's shadow is worked out again at once, rebuilt or not. Nothing allocated.
   */
  set cascadeFar(v: number) {
    if (v === this.far2 || (v !== v && this.far2 !== this.far2)) return;
    this.far2 = v;
    this.applyShadows();
  }

  /** A model's levels as the pick reads them, worked out once. */
  private levels(m: LoadedModel): ModelLevels {
    let lv = this.levelsOf.get(m);
    if (lv) return lv;
    const levels = m.levels && m.levels.length > 1 ? m.levels : null;
    const count = levels ? levels.length : 1;
    const nears = new Float32Array(count);
    const nearOf = new Float32Array(count);
    const prims: (readonly Primitive[])[] = [];
    for (let k = 0; k < count; k++) {
      nears[k] = levels ? levels[k].near : 0;
      nearOf[k] = nears[k];
      prims.push(k === 0 ? m.primitives : (levels as NonNullable<typeof levels>)[k].primitives);
    }
    const beyond = levels ? levels[count - 1].far : Number.POSITIVE_INFINITY;
    lv = { count, nears, beyond: beyond > 0 && beyond < 1e8 ? beyond : Number.POSITIVE_INFINITY, prims, nearOf };
    this.levelsOf.set(m, lv);
    return lv;
  }

  private regionAt(cx: number, cz: number): Region {
    const per = FLORA_REGION / CHUNK_SIZE;
    const rx = Math.floor(cx / per);
    const rz = Math.floor(cz / per);
    const key = `${rx},${rz}`;
    let r = this.regions.get(key);
    if (!r) {
      r = { key, rx, rz, chunks: [], batches: new Map(), list: [], dirty: false, at: this.regionList.length };
      this.regions.set(key, r);
      this.regionList.push(r);
    }
    return r;
  }

  private markDirty(r: Region): void {
    if (r.dirty) return;
    r.dirty = true;
    this.dirtyList[this.dirtyCount++] = r;
  }

  /** A chunk's plantings, as it is made. Its levels are picked at the next sweep; its region is rebuilt after. */
  add(key: string, cx: number, cz: number, data: FloraChunkData, flags: FloraChunkFlags): void {
    this.remove(key);
    const region = this.regionAt(cx, cz);
    const ml: ModelLevels[] = new Array(data.n);
    for (let i = 0; i < data.n; i++) ml[i] = this.levels(data.models[i]);
    const rec: ChunkRec = { key, data, flags, level: new Int8Array(data.n).fill(-1), ml, region, at: this.chunkList.length };
    this.chunks.set(key, rec);
    this.chunkList.push(rec);
    region.chunks.push(rec);
    this.markDirty(region);
  }

  /** A chunk dropped: its region is rebuilt without it. */
  remove(key: string): void {
    const rec = this.chunks.get(key);
    if (!rec) return;
    this.chunks.delete(key);
    // Out of the kept list: the last one takes its place.
    const cl = this.chunkList;
    const last = cl[cl.length - 1];
    cl[rec.at] = last;
    last.at = rec.at;
    cl.length--;
    const list = rec.region.chunks;
    const i = list.indexOf(rec);
    if (i >= 0) {
      list[i] = list[list.length - 1];
      list.length--;
    }
    this.markDirty(rec.region);
  }

  /**
   * Pick every planting's level from the eye (`scale` multiplies the client's switch distances: the tune's
   * bias over the ride's), and mark each region where anything changed. A planting whose chunk's plants (or
   * trees) the reach has hidden, or whose ground is hidden, is not drawn. Nothing allocated.
   */
  sweep(ex: number, ey: number, ez: number, scale: number): void {
    const tune = this.tune;
    const h = tune.hysteresis;
    if (scale !== this.scale || tune.shadowLevelMax !== this.shadowReach) {
      this.scale = scale;
      this.shadowReach = tune.shadowLevelMax;
      // Every batch's shadow by the new scale or the rule's new reach, rebuilt or not.
      this.applyShadows();
    }
    this.stats.sweeps++;
    const cl = this.chunkList;
    for (let c = 0; c < cl.length; c++) {
      const rec = cl[c];
      const f = rec.flags;
      const ground = f.group.visible;
      const plantsOn = ground && (f.plants ? f.plants.visible : true);
      const treesOn = ground && (f.trees ? f.trees.visible : true);
      const d = rec.data;
      const lv = rec.level;
      const ml = rec.ml;
      let changed = false;
      for (let i = 0; i < d.n; i++) {
        const m = ml[i];
        let want: number;
        if (!(d.collidable[i] ? treesOn : plantsOn)) want = m.count;
        else if (!tune.on || m.count <= 1) want = 0;
        else {
          const dx = d.x[i] - ex;
          const dy = d.y[i] - ey;
          const dz = d.z[i] - ez;
          want = levelOf(Math.sqrt(dx * dx + dy * dy + dz * dz), m.nears, m.count, scale, h, lv[i] >= m.count ? -1 : lv[i], tune.hideBeyond ? m.beyond : Number.POSITIVE_INFINITY);
        }
        if (want !== lv[i]) {
          lv[i] = want;
          changed = true;
        }
      }
      if (changed) this.markDirty(rec.region);
    }
  }

  /** Every region whose batches are out of date, rebuilt: all of them with `Infinity`, else at most `budget` (oldest first). Answers how many. */
  rebuild(budget: number = this.tune.regionsPerFrame): number {
    let done = 0;
    let at = 0;
    const list = this.dirtyList;
    const n = this.dirtyCount;
    while (at < n && done < budget) {
      const r = list[at++] as Region;
      if (!r.dirty) continue;
      this.rebuildRegion(r);
      done++;
    }
    // What was taken off the front, dropped by moving the rest down: the list's length stays as it is.
    if (at > 0) {
      let k = 0;
      for (let i = at; i < n; i++) list[k++] = list[i];
      for (let i = k; i < n; i++) list[i] = null;
      this.dirtyCount = k;
    }
    this.stats.rebuilds += done;
    return done;
  }

  /** How many regions wait for a rebuild. */
  get pending(): number {
    return this.dirtyCount;
  }

  private batchFor(r: Region, m: LoadedModel, level: number, levels: ModelLevels): Batch {
    let row = r.batches.get(m);
    if (!row) {
      row = new Array<Batch | null>(levels.count).fill(null);
      r.batches.set(m, row);
    }
    let b = row[level];
    if (!b) {
      b = { model: m, levels, level, meshes: [], attr: null, cap: 0, count: 0, want: 0, fill: 0, maxScale: 0, base: false, range: { start: 0, count: 0 } };
      row[level] = b;
      r.list.push(b);
    }
    return b;
  }

  /** Make a batch's meshes again for at least `need` copies, doubling; the old ones are disposed (their instance store freed). */
  private grow(b: Batch, need: number): void {
    let cap = Math.max(8, b.cap);
    while (cap < need) cap *= 2;
    for (const mesh of b.meshes) {
      this.root.remove(mesh);
      mesh.dispose();
    }
    b.meshes.length = 0;
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
    attr.setUsage(THREE.DynamicDrawUsage);
    b.attr = attr;
    b.cap = cap;
    b.range.start = 0;
    b.range.count = 0;
    for (const prim of b.levels.prims[b.level]) {
      const mesh = new THREE.InstancedMesh(prim.geometry, prim.material, cap);
      mesh.instanceMatrix = attr;
      mesh.count = 0;
      mesh.visible = false;
      mesh.receiveShadow = true;
      mesh.name = 'flora batch';
      fitInstanceSphere(mesh);
      this.root.add(mesh);
      b.meshes.push(mesh);
      this.onMesh(mesh);
    }
  }

  /** Whether a batch casts now: the finest rule (`base`), less the lowest level once its switch is past the second cascade. */
  private casts(b: Batch): boolean {
    return levelCasts(b.base, b.level, b.levels.count, b.levels.nearOf[b.level] * this.scale, this.far2, this.tune);
  }

  /** Every batch's shadow worked out again (the cascade's end or the scale moved). Nothing allocated. */
  private applyShadows(): void {
    const rl = this.regionList;
    for (let r = 0; r < rl.length; r++) {
      const list = rl[r].list;
      for (let k = 0; k < list.length; k++) {
        const b = list[k];
        const cast = this.casts(b);
        const meshes = b.meshes;
        for (let m = 0; m < meshes.length; m++) if (meshes[m].castShadow !== cast) meshes[m].castShadow = cast;
      }
    }
  }

  /** One region's batches written again from its chunks' plantings and their levels. */
  private rebuildRegion(r: Region): void {
    r.dirty = false;
    // A region every chunk has left is let go whole, or a long flight would leave a trail of empty batches.
    if (!r.chunks.length) {
      this.dropRegion(r);
      return;
    }
    const list = r.list;
    // Count.
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      b.want = 0;
      b.fill = 0;
      b.maxScale = 0;
    }
    const chunks = r.chunks;
    for (let c = 0; c < chunks.length; c++) {
      const rec = chunks[c];
      const d = rec.data;
      for (let i = 0; i < d.n; i++) {
        const lv = rec.level[i];
        if (lv < 0) continue;
        const levels = rec.ml[i];
        if (lv >= levels.count) continue;
        const b = this.batchFor(r, d.models[i], lv, levels);
        b.want++;
        if (d.scale[i] > b.maxScale) b.maxScale = d.scale[i];
      }
    }
    // Room.
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      if (b.want > b.cap) this.grow(b, b.want);
    }
    // Fill: sixteen numbers a planting, by hand (a `subarray` to copy from is a new view object a planting).
    for (let c = 0; c < chunks.length; c++) {
      const rec = chunks[c];
      const d = rec.data;
      const mats = d.mats;
      for (let i = 0; i < d.n; i++) {
        const lv = rec.level[i];
        if (lv < 0) continue;
        const row = r.batches.get(d.models[i]);
        const b = row ? row[lv] : null;
        if (!b || !b.attr) continue;
        const out = b.attr.array as Float32Array;
        const s = i * 16;
        const o = b.fill * 16;
        for (let e = 0; e < 16; e++) out[o + e] = mats[s + e];
        b.fill++;
      }
    }
    // Hand over.
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      b.count = b.want;
      b.base = b.model.radius * b.maxScale >= SHADOW_MIN_RADIUS;
      const cast = this.casts(b);
      if (b.attr && b.count > 0) {
        keepUploadRange(b.attr.updateRanges as UploadRange[], b.range, 0, b.count * 16);
        b.attr.needsUpdate = true;
      }
      const meshes = b.meshes;
      for (let m = 0; m < meshes.length; m++) {
        const mesh = meshes[m];
        mesh.count = b.count;
        mesh.castShadow = cast;
        mesh.visible = this.shown && b.count > 0;
        if (b.count > 0) fitInstanceSphere(mesh);
      }
    }
  }

  /** The batches drawn or not (the switch): the chunks' own meshes are the world's to show the other way. */
  setShown(on: boolean): void {
    this.shown = on;
    const rl = this.regionList;
    for (let r = 0; r < rl.length; r++) {
      const list = rl[r].list;
      for (let k = 0; k < list.length; k++) {
        const b = list[k];
        for (const mesh of b.meshes) mesh.visible = on && b.count > 0;
      }
    }
  }

  /** Every region marked out of date, so the next rebuilds write each again (a switch or a tune moved). */
  invalidate(): void {
    const rl = this.regionList;
    for (let r = 0; r < rl.length; r++) this.markDirty(rl[r]);
  }

  /** What the field holds now, into `stats` (not a frame's work: the console and the frame report ask). */
  measure(): FloraFieldStats {
    const s = this.stats;
    s.chunks = this.chunks.size;
    s.regions = this.regions.size;
    s.batches = 0;
    s.meshes = 0;
    s.drawing = 0;
    s.byLevel.fill(0);
    s.hidden = 0;
    s.dirty = this.dirtyCount;
    for (const r of this.regionList) {
      for (const b of r.list) {
        s.batches++;
        s.meshes += b.meshes.length;
        if (b.count > 0) s.drawing += b.meshes.length;
      }
    }
    for (const rec of this.chunkList) {
      for (let i = 0; i < rec.data.n; i++) {
        const lv = rec.level[i];
        const count = rec.ml[i].count;
        if (lv < 0 || lv >= count) s.hidden++;
        else s.byLevel[Math.min(lv, s.byLevel.length - 1)]++;
      }
    }
    return s;
  }

  /**
   * For the node test: each region's batches as (model, level) -> the matrices they draw, in order. What a
   * from-scratch pack of the same plantings at the same levels must equal.
   */
  snapshot(): Map<string, Map<LoadedModel, Float32Array[]>> {
    const out = new Map<string, Map<LoadedModel, Float32Array[]>>();
    for (const r of this.regions.values()) {
      const byModel = new Map<LoadedModel, Float32Array[]>();
      for (const [m, row] of r.batches) {
        byModel.set(m, row.map((b) => (b && b.attr ? (b.attr.array as Float32Array).slice(0, b.count * 16) : new Float32Array(0))));
      }
      out.set(r.key, byModel);
    }
    return out;
  }

  /** For the node test: every batch's meshes, with its region, the model, the level position, the copies it draws and its store. */
  batches(): { region: string; model: LoadedModel; level: number; count: number; meshes: readonly THREE.InstancedMesh[]; attr: THREE.InstancedBufferAttribute | null }[] {
    const out: { region: string; model: LoadedModel; level: number; count: number; meshes: readonly THREE.InstancedMesh[]; attr: THREE.InstancedBufferAttribute | null }[] = [];
    for (const r of this.regionList) for (const b of r.list) out.push({ region: r.key, model: b.model, level: b.level, count: b.count, meshes: b.meshes, attr: b.attr });
    return out;
  }

  /** The levels a chunk's plantings stand at now (for the node test). */
  levelsOfChunk(key: string): Int8Array | null {
    return this.chunks.get(key)?.level ?? null;
  }

  /** One region's batches out of the scene and their instance stores freed, and the region forgotten. */
  private dropRegion(r: Region): void {
    for (const b of r.list) {
      for (const mesh of b.meshes) {
        this.root.remove(mesh);
        mesh.dispose();
      }
      b.meshes.length = 0;
    }
    r.list.length = 0;
    r.batches.clear();
    this.regions.delete(r.key);
    // Out of the kept list: the last one takes its place.
    const rl = this.regionList;
    const last = rl[rl.length - 1];
    rl[r.at] = last;
    last.at = r.at;
    rl.length--;
  }

  /** Everything let go: the batches' meshes out of the scene and their instance stores freed. The pack owns the geometry and materials. */
  dispose(): void {
    while (this.regionList.length) this.dropRegion(this.regionList[this.regionList.length - 1]);
    this.regions.clear();
    this.chunks.clear();
    this.chunkList.length = 0;
    this.dirtyList.length = 0;
    this.dirtyCount = 0;
    this.levelsOf.clear();
  }
}

/**
 * The plantings of every chunk in a list as a from-scratch pack: per region key, per model, per level position,
 * the matrices in chunk-list order. What the field's own batches must equal once every region is rebuilt; the
 * node test's reference.
 */
export function packFromScratch(chunks: readonly { cx: number; cz: number; data: FloraChunkData; level: ArrayLike<number> }[], levelCount: (m: LoadedModel) => number): Map<string, Map<LoadedModel, number[][]>> {
  const per = FLORA_REGION / CHUNK_SIZE;
  const out = new Map<string, Map<LoadedModel, number[][]>>();
  for (const c of chunks) {
    const key = `${Math.floor(c.cx / per)},${Math.floor(c.cz / per)}`;
    let byModel = out.get(key);
    if (!byModel) out.set(key, (byModel = new Map()));
    for (let i = 0; i < c.data.n; i++) {
      const lv = c.level[i];
      const m = c.data.models[i];
      const count = levelCount(m);
      if (lv < 0 || lv >= count) continue;
      let row = byModel.get(m);
      if (!row) byModel.set(m, (row = Array.from({ length: count }, () => [])));
      for (let k = 0; k < 16; k++) row[lv].push(c.data.mats[i * 16 + k]);
    }
  }
  return out;
}
