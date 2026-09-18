// The models and animation packs the mobiles stand on, loaded once and shared: a model by file, a
// pack by id. One cache per base URL at module level, so it outlives a planet (a travel must not
// throw away a model about to be used again). Every asset counts who holds it; one nobody holds
// stays until the bytes run over the budget, oldest first. The budget is enforced where it can
// be, at the spawn (`wouldCost` against `referencedBytes`), because a trim can only free what
// nothing points at.
//
// Every model is made ready once, before the first mobile wearing it is shown (the world's
// `prepareActor`: the portal stencil, the shadow cascades, its textures uploaded and its programs
// compiled a mesh at a time), so only the first of a species ever waits and no first sight stalls.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimPack, MobileEntry, Vec3 } from './types';
import type { MobileCatalogue } from './catalogue';
import { makeAdditiveOnce, missingRoles, rolesFor, type PackClipSource } from './packClips';

/** The cache's numbers: the bytes it may hold, loads at once, and how long a failed file is not asked for again (ms). */
export const MOBILE_CACHE = { budget: 180e6, concurrency: 2, failFor: 30_000 };

/** GPU bytes a model takes, over its bytes on disk, until it has been loaded and measured (PNG to RGBA with mips). */
const DISK_TO_GPU = 3.5;
/** A model or pack the catalogue gives no size for is taken to be this big. */
const UNKNOWN_BYTES = 4e6;
/** What a hologram asset weighs of its own: one material (its geometry and textures are its plain asset's). */
const HOLOGRAM_BYTES = 1024;

export interface ModelAsset {
  kind: 'model';
  key: string;
  file: string;
  scene: THREE.Group;
  joints: number;
  meshes: THREE.Mesh[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  bounds: { min: Vec3; max: Vec3 };
  bytes: number;
  refs: number;
  lastUsed: number;
  prepared: Promise<void> | null;
  hologram: boolean;
  /** A hologram's plain asset, held for its life: its geometry and textures are that one's. */
  base: ModelAsset | null;
}

export interface PackAsset extends PackClipSource {
  kind: 'pack';
  key: string;
  id: string;
  json: AnimPack;
  bytes: number;
  refs: number;
  lastUsed: number;
}

export interface AssetStat {
  key: string;
  refs: number;
  bytes: number;
  /** Seconds since something last took it. */
  age: number;
}

/**
 * The look of a hologram, never put on a mesh itself: every hologram asset takes a clone, since
 * a material on an asset is disposed with that asset and a shared one disposed once would take
 * every hologram with it. Unlit (`userData.unlit`), so it is kept out of the shadow cascades and
 * compiles one small program.
 */
const HOLOGRAM_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0x6fc8ff,
  transparent: true,
  opacity: 0.42,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  side: THREE.DoubleSide,
  name: 'hologram',
});
HOLOGRAM_TEMPLATE.userData.unlit = true;

/** One fresh hologram material for this asset on every mesh of `scene`, casting nothing. Returns it as the asset's materials. */
export function makeHologram(scene: THREE.Object3D): THREE.Material[] {
  const m = HOLOGRAM_TEMPLATE.clone();
  m.userData.unlit = true;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = m;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
  return [m];
}

/** Every texture a material holds. */
function texturesOf(m: THREE.Material, out: Set<THREE.Texture>): void {
  for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v && (v as THREE.Texture).isTexture) out.add(v as THREE.Texture);
}

/** GPU bytes of a texture, with its mips. */
function textureBytes(t: THREE.Texture): number {
  const img = t.image as { width?: number; height?: number } | null;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  return w * h * 4 * 1.34;
}

function geometryBytes(g: THREE.BufferGeometry): number {
  let n = g.index ? g.index.array.byteLength : 0;
  for (const a of Object.values(g.attributes)) n += (a as THREE.BufferAttribute).array.byteLength;
  for (const list of Object.values(g.morphAttributes)) for (const a of list) n += (a as THREE.BufferAttribute).array.byteLength;
  return n;
}

function clipBytes(c: THREE.AnimationClip): number {
  let n = 0;
  for (const t of c.tracks) n += t.times.byteLength + (t.values as Float32Array).byteLength;
  return n;
}

const caches = new Map<string, MobileAssets>();

export class MobileAssets {
  /** The one cache for a base URL. */
  static for(baseUrl: string): MobileAssets {
    let c = caches.get(baseUrl);
    if (!c) {
      c = new MobileAssets(baseUrl);
      caches.set(baseUrl, c);
    }
    return c;
  }

  /**
   * Set by the world on every load (to `World.prepareActor`): register, upload and compile an
   * actor before it is shown. This is the hook anything else that must see a new mobile prototype
   * chains onto (the motion blur's own preparation among them), not the fighters' compile hook.
   */
  prepare: ((root: THREE.Object3D) => Promise<void>) | null = null;
  /** Set by the world: take disposed materials out of the portal set and the cascades' map. */
  forget: ((materials: readonly THREE.Material[]) => void) | null = null;

  private readonly models = new Map<string, ModelAsset>();
  private readonly packs = new Map<string, PackAsset>();
  /**
   * Loads in flight, each with who has asked for it and what it is expected to weigh: a load with
   * claims counts as referenced from the moment it starts, so several spawns in one tick cannot
   * all pass the budget before any of them has landed.
   */
  private readonly modelJobs = new Map<string, { promise: Promise<ModelAsset>; claims: number; estimate: number }>();
  private readonly packJobs = new Map<string, { promise: Promise<PackAsset>; claims: number; estimate: number }>();
  private readonly jsons = new Map<string, Promise<AnimPack>>();
  private readonly failures = new Map<string, { at: number; message: string }>();
  private readonly loader = new GLTFLoader();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  /** Packs whose roles name clips the GLB lacks, reported once each. */
  private readonly reported = new Set<string>();

  private constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl}assets-private/${path}`;
  }

  /** The failure remembered for a file, if it is recent: the same message, not another fetch. */
  failure(file: string): string | null {
    const f = this.failures.get(file);
    if (!f) return null;
    if (performance.now() - f.at > MOBILE_CACHE.failFor) {
      this.failures.delete(file);
      return null;
    }
    return f.message;
  }

  private fail(file: string, err: unknown): Error {
    const message = `${file} would not load: ${String((err as Error)?.message ?? err)}`;
    this.failures.set(file, { at: performance.now(), message });
    console.warn(`mobiles: ${message}`);
    return new Error(message);
  }

  /** One of `concurrency` loading slots; a load waits for a free one. */
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= MOBILE_CACHE.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  /** How many loads are in flight or queued. */
  get loading(): number {
    return this.modelJobs.size + this.packJobs.size;
  }

  /**
   * A model, loaded and prepared, with a reference taken for the caller (one `release` each).
   * A hologram is its own asset, `<file>#holo`, made from the plain one's parsed scene and never
   * fetched twice.
   */
  acquireModel(file: string, opts: { hologram: boolean; bounds?: { min: Vec3; max: Vec3 }; estimate?: number }): Promise<ModelAsset> {
    const key = opts.hologram ? `${file}#holo` : file;
    const have = this.models.get(key);
    if (have) {
      have.refs++;
      have.lastUsed = performance.now();
      return (have.prepared ?? Promise.resolve()).then(() => have);
    }
    const failed = this.failure(file);
    if (failed) return Promise.reject(new Error(failed));
    let job = this.modelJobs.get(key);
    if (!job) {
      // A hologram's own weight is its material; the plain asset it holds is a job of its own, with the model's estimate.
      const j = { promise: null as unknown as Promise<ModelAsset>, claims: 0, estimate: opts.hologram ? HOLOGRAM_BYTES : (opts.estimate ?? UNKNOWN_BYTES) };
      j.promise = (opts.hologram ? this.loadHologram(file, opts.bounds, opts.estimate) : this.loadModel(file, opts.bounds)).then(
        (asset) => {
          // Everyone who asked while it loaded holds it from the moment it lands, before any
          // continuation runs, so a trim in between can never take it.
          asset.refs = j.claims;
          asset.lastUsed = performance.now();
          this.models.set(key, asset);
          this.modelJobs.delete(key);
          return asset;
        },
        (err) => {
          this.modelJobs.delete(key);
          throw err;
        },
      );
      job = j;
      this.modelJobs.set(key, job);
    }
    job.claims++;
    return job.promise;
  }

  private async loadModel(file: string, bounds?: { min: Vec3; max: Vec3 }): Promise<ModelAsset> {
    let gltf;
    try {
      gltf = await this.slot(() => this.loader.loadAsync(this.url(file)));
    } catch (err) {
      throw this.fail(file, err);
    }
    const scene = gltf.scene;
    const meshes: THREE.Mesh[] = [];
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    let joints = 0;
    let bytes = 0;
    const geometries = new Set<THREE.BufferGeometry>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes.push(m);
      geometries.add(m.geometry);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        materials.add(mat);
        texturesOf(mat, textures);
      }
      const s = o as THREE.SkinnedMesh;
      if (s.isSkinnedMesh && s.skeleton) joints = Math.max(joints, s.skeleton.bones.length);
    });
    for (const g of geometries) bytes += geometryBytes(g);
    for (const t of textures) bytes += textureBytes(t);
    const asset: ModelAsset = {
      kind: 'model',
      key: file,
      file,
      scene,
      joints,
      meshes,
      materials: [...materials],
      textures: [...textures],
      bounds: bounds ?? { min: [0, 0, 0], max: [0, 0, 0] },
      bytes,
      refs: 0,
      lastUsed: performance.now(),
      prepared: null,
      hologram: false,
      base: null,
    };
    asset.prepared = this.prepareRoot(scene);
    await asset.prepared;
    return asset;
  }

  private async loadHologram(file: string, bounds?: { min: Vec3; max: Vec3 }, estimate?: number): Promise<ModelAsset> {
    // The plain asset first, held for the hologram's life.
    const base = await this.acquireModel(file, { hologram: false, bounds, estimate });
    const scene = cloneSkeleton(base.scene) as THREE.Group;
    const materials = makeHologram(scene);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const asset: ModelAsset = {
      kind: 'model',
      key: `${file}#holo`,
      file,
      scene,
      joints: base.joints,
      meshes,
      materials,
      textures: [],
      bounds: base.bounds,
      // Only its own material: the geometry and textures are the plain asset's, counted there.
      bytes: HOLOGRAM_BYTES,
      refs: 0,
      lastUsed: performance.now(),
      prepared: null,
      hologram: true,
      base,
    };
    asset.prepared = this.prepareRoot(scene);
    await asset.prepared;
    return asset;
  }

  private prepareRoot(root: THREE.Object3D): Promise<void> {
    const prepare = this.prepare;
    if (!prepare) return Promise.resolve();
    return prepare(root).catch((err) => console.warn('mobiles: preparing a model failed', err));
  }

  /** A pack's JSON alone (roles, gaits, clip list), fetched once: what `mobileRoles` reads without loading the clips. */
  packJson(id: string, jsonPath: string): Promise<AnimPack> {
    let p = this.jsons.get(id);
    if (!p) {
      p = fetch(this.url(jsonPath)).then(async (res) => {
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`${jsonPath}: ${res.status}`);
        return (await res.json()) as AnimPack;
      });
      p.catch(() => this.jsons.delete(id));
      this.jsons.set(id, p);
    }
    return p;
  }

  /** An animation pack, parsed once and shared by every mobile on it, with a reference taken for the caller. */
  acquirePack(id: string, file: string, json: string, estimate = UNKNOWN_BYTES): Promise<PackAsset> {
    const have = this.packs.get(id);
    if (have) {
      have.refs++;
      have.lastUsed = performance.now();
      return Promise.resolve(have);
    }
    const failed = this.failure(file);
    if (failed) return Promise.reject(new Error(failed));
    let job = this.packJobs.get(id);
    if (!job) {
      const j = { promise: null as unknown as Promise<PackAsset>, claims: 0, estimate };
      j.promise = this.loadPack(id, file, json).then(
        (asset) => {
          asset.refs = j.claims;
          asset.lastUsed = performance.now();
          this.packs.set(id, asset);
          this.packJobs.delete(id);
          return asset;
        },
        (err) => {
          this.packJobs.delete(id);
          throw err;
        },
      );
      job = j;
      this.packJobs.set(id, job);
    }
    job.claims++;
    return job.promise;
  }

  private async loadPack(id: string, file: string, jsonPath: string): Promise<PackAsset> {
    let json: AnimPack;
    let clips: THREE.AnimationClip[];
    try {
      const [j, gltf] = await Promise.all([this.packJson(id, jsonPath), this.slot(() => this.loader.loadAsync(this.url(file)))]);
      json = j;
      clips = gltf.animations;
    } catch (err) {
      throw this.fail(file, err);
    }
    const byName = new Map(clips.map((c) => [c.name, c]));
    const additive = new Set(json.clips.filter((c) => c.additive).map((c) => c.name));
    const asset: PackAsset = { kind: 'pack', key: id, id, json, clips: byName, additive, rigClips: new Map(), bytes: 0, refs: 0, lastUsed: performance.now() };
    for (const c of clips) asset.bytes += clipBytes(c);
    makeAdditiveOnce(asset);
    if (!this.reported.has(id)) {
      this.reported.add(id);
      const missing = missingRoles(rolesFor(json, null), byName);
      if (missing.length) console.warn(`mobiles: pack ${id} names clips its GLB has not got, for ${missing.join(', ')}; those roles count as missing`);
    }
    return asset;
  }

  /** Let go of one reference. At none the asset stays, unreferenced, until a trim needs the room. */
  release(a: ModelAsset | PackAsset): void {
    a.refs = Math.max(0, a.refs - 1);
    a.lastUsed = performance.now();
  }

  private total(): number {
    let n = 0;
    for (const a of this.models.values()) n += a.bytes;
    for (const a of this.packs.values()) n += a.bytes;
    return n;
  }

  /** Dispose unreferenced assets, oldest first, while the bytes held are over the budget. */
  trim(budget = MOBILE_CACHE.budget): { disposed: number; bytes: number } {
    let total = this.total();
    let disposed = 0;
    let freed = 0;
    // A hologram goes before its plain asset: it holds a reference on it.
    const idle = [...this.models.values(), ...this.packs.values()].filter((a) => a.refs === 0).sort((a, b) => Number(b.kind === 'model' && (b as ModelAsset).hologram) - Number(a.kind === 'model' && (a as ModelAsset).hologram) || a.lastUsed - b.lastUsed);
    // (A plain asset a disposed hologram was the last to hold joins the end of the list, so it can
    // go in the same pass; `for...of` over an array sees what is pushed while it runs.)
    for (const a of idle) {
      if (total <= budget) break;
      if (a.refs > 0) continue;
      total -= a.bytes;
      freed += a.bytes;
      disposed++;
      if (a.kind === 'model') {
        const base = a.hologram ? a.base : null;
        this.disposeModel(a);
        if (base && base.refs === 0 && this.models.get(base.key) === base && !idle.includes(base)) idle.push(base);
      } else this.packs.delete(a.key);
    }
    return { disposed, bytes: freed };
  }

  private disposeModel(a: ModelAsset): void {
    this.models.delete(a.key);
    this.forget?.(a.materials);
    for (const m of a.materials) m.dispose();
    if (a.hologram) {
      // Its geometry and textures are the plain asset's; only the reference goes back.
      if (a.base) this.release(a.base);
      a.base = null;
      return;
    }
    const geometries = new Set<THREE.BufferGeometry>();
    for (const m of a.meshes) geometries.add(m.geometry);
    for (const g of geometries) g.dispose();
    for (const t of a.textures) t.dispose();
  }

  /**
   * Bytes held by assets something still points at: what a trim can never free, and what the spawn
   * cap must respect. A load in flight that someone has asked for counts at its estimate.
   */
  referencedBytes(): number {
    let n = 0;
    for (const a of this.models.values()) if (a.refs > 0) n += a.bytes;
    for (const a of this.packs.values()) if (a.refs > 0) n += a.bytes;
    for (const j of this.modelJobs.values()) if (j.claims > 0) n += j.estimate;
    for (const j of this.packJobs.values()) if (j.claims > 0) n += j.estimate;
    return n;
  }

  /**
   * What an entry's model and pack are expected to weigh before they have been loaded and measured:
   * the model's share of its appearance's bytes on disk, as GPU bytes, and the pack's bytes.
   */
  estimate(entry: MobileEntry, cat: MobileCatalogue): { model: number; pack: number } {
    const app = cat.appearanceOf(entry);
    const files = 1 + Object.values(app?.variants ?? {}).filter((v) => v.file && !v.same).length;
    const model = app?.bytes ? (app.bytes / files) * DISK_TO_GPU : UNKNOWN_BYTES;
    const info = cat.packOf(entry);
    return { model, pack: info ? (info.bytes ?? UNKNOWN_BYTES) : 0 };
  }

  /**
   * What one more spawn of this entry would add to `referencedBytes`: 0 when everything it needs is
   * already held, or already loading for someone (that load counts at its estimate already).
   */
  wouldCost(entry: MobileEntry, cat: MobileCatalogue): number {
    let bytes = 0;
    const file = cat.modelFile(entry);
    const guess = this.estimate(entry, cat);
    if (file) {
      const plain = this.models.get(file);
      if (!plain) {
        if (!this.modelJobs.has(file)) bytes += guess.model;
      } else if (plain.refs === 0) bytes += plain.bytes;
    }
    const pack = cat.packOf(entry);
    if (pack) {
      const have = this.packs.get(pack.id);
      if (!have) {
        if (!this.packJobs.has(pack.id)) bytes += guess.pack;
      } else if (have.refs === 0) bytes += have.bytes;
    }
    return bytes;
  }

  stats(): { models: AssetStat[]; packs: AssetStat[]; bytes: number; referenced: number; budget: number; loading: number; failed: string[] } {
    const now = performance.now();
    const stat = (a: ModelAsset | PackAsset): AssetStat => ({ key: a.key, refs: a.refs, bytes: Math.round(a.bytes), age: Number(((now - a.lastUsed) / 1000).toFixed(1)) });
    const failed: string[] = [];
    for (const [file, f] of this.failures) if (now - f.at <= MOBILE_CACHE.failFor) failed.push(file);
    return {
      models: [...this.models.values()].map(stat),
      packs: [...this.packs.values()].map(stat),
      bytes: Math.round(this.total()),
      referenced: Math.round(this.referencedBytes()),
      budget: MOBILE_CACHE.budget,
      loading: this.loading,
      failed,
    };
  }

  /** Everything, held or not (the page going away). */
  dispose(): void {
    for (const a of [...this.models.values()].sort((x, y) => Number(y.hologram) - Number(x.hologram))) this.disposeModel(a);
    this.models.clear();
    this.packs.clear();
    this.jsons.clear();
  }
}
