import * as THREE from 'three';
import { isReflective, registerReflective } from './envmap';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { surfaces } from './surfaces';
import { drawnLevels } from './lodLevels.ts';
import { mergeFloraCollision, type FloraCollision } from './floraCollision.ts';

export interface CellLight {
  type: number;
  color: number[];
  position: number[];
  direction: number[];
  attenuation: number[];
}

/**
 * One cell's walkable floor, as the converter read it out of the cell's own floor file and mirrored
 * into the model's frame with the meshes. Flat arrays of plain numbers: nothing is allocated to
 * read one, and a reader indexes rather than walks.
 *
 *   v   three numbers a vertex: x, y, z
 *   t   ten numbers a triangle, in this order:
 *         0..2  the three corner indices into `v`, wound so (b - a) x (c - a) points up
 *         3..5  the triangle across edge k, or -1 where the mesh ends. Edge k runs from corner k
 *               to corner k + 1 (mod 3).
 *         6..8  the cell's own portal link index behind edge k (an index into `cells[i].portals`),
 *               or -1. Only ever set on an edge with no neighbour.
 *         9     a three-bit mask: bit k is set when edge k may be walked over. Every edge with a
 *               neighbour is set; a set edge with no neighbour is a doorway or a step across to
 *               another piece of the same floor.
 */
export interface CellFloor {
  v: number[];
  t: number[];
}

/**
 * The node graph the client walked that floor by.
 *   n   five numbers a node: x, y, z, then its type (1 an ordinary node, 0 one standing in a
 *       doorway) and, for a doorway node, the cell's own portal link index; -1 otherwise.
 *   e   two node indices an edge. Every edge is listed both ways round, as the file stores it.
 */
export interface CellGraph {
  n: number[];
  e: number[];
}

/** The floors.json shape this game reads; a file that says anything else is passed over. */
export const FLOOR_PACK_VERSION = 1;

/** An effect a model or a placed object carries: the particle file, and where it hangs in the model's own (unflipped) space. */
export interface PackEffect {
  file: string;
  id: string;
  transform?: number[];
  cell?: number;
}

/** The shape of `objeffects.json` this build reads; the converter's `OBJECT_EFFECTS_VERSION` (`tools/swg/clientfx.mjs`), which a node test holds equal. */
export const OBJECT_EFFECTS_VERSION = 1;

export interface PackModelDef {
  id: string;
  file: string;
  bounds: { min: number[]; max: number[] };
  triangles: number;
  /** Portal buildings: one entry per cell, index 0 being the exterior shell. */
  cells?: {
    index: number;
    name: string;
    bounds: { min: number[]; max: number[] };
    portals?: { geometry: number; target: number; passable: boolean }[];
    /** The cell's own lights from the portal file: 0 ambient, 1 parallel, 2 point; Direct3D attenuation constants. */
    lights?: CellLight[];
    /** The walkable floor the cell names, from the pack's floors.json. Absent on a pack converted before floors. */
    floor?: CellFloor;
    /** The path graph beside that floor. Absent where the cell's floor file carries none. */
    graph?: CellGraph;
  }[];
  /** Portal polygons in model space (vertices and triangle indices), indexed by the cells' `geometry` field. */
  portals?: { v: number[][]; i: number[] }[];
  /** Flora models: the appearance file the terrain's flora families name (e.g. appearance/tree_x.apt). */
  appearance?: string;
  /**
   * Flora models: the collision shapes the client authored for the appearance, from the pack's
   * flora-collision.json (src/world/floraCollision.ts); an empty list is walked through. Absent on a
   * pack converted before the pass, whose plantings stand on the guessed cylinder they always did.
   */
  collision?: FloraCollision;
  /** A particle effect (particles/<id>.json) rather than a mesh; placed like any other object. */
  particle?: boolean;
  /** Particle effects attached to this model (a lamp's flame), transforms in the converter's unflipped model space. */
  effects?: PackEffect[];
  /**
   * The client's own detail levels the pack carries (step 7), finest first: the client's level number, where
   * it takes over and where the next carried level does (metres from the eye), and what it draws. The finest
   * is the model's own nodes; the others are the `lod:<n>` nodes of the GLB's `lods` scene. Absent on a model
   * with one level and on every model of a pack converted before levels were carried.
   */
  lods?: PackLevel[];
}

/** One carried detail level, as the manifest lists it. */
export interface PackLevel {
  level: number;
  near: number;
  far: number;
  tris: number;
  prims: number;
}

/**
 * One of a model's detail levels once loaded: where it takes over, where the next does, and what it draws
 * of the exterior (a portal building's rooms are drawn by their building at every distance). A level the
 * artists left empty has no primitives: nothing is drawn there.
 */
export interface ModelLevel {
  near: number;
  far: number;
  /** The client's level number. */
  level: number;
  primitives: Primitive[];
}

export interface PackManifest {
  planet: string;
  categories: Record<string, PackModelDef[]>;
}

/** An object from the game's world snapshot, in SWG coordinates. */
export interface LayoutObject {
  template: string;
  model: string;
  x: number;
  y: number;
  z: number;
  /** Quaternion as w, x, y, z. */
  q: number[];
  radius: number;
  /** Inside a building's cell; positioned relative to it by the converter. */
  contained?: boolean;
  /**
   * For a contained object, the room it stands in (the cell object holding it) and its building's own index in
   * `objects`, as the snapshot says (step 7). Absent in a pack converted before, and `in` wherever the building
   * itself was not placed.
   */
  cell?: number;
  in?: number;
  /** Pack-relative terrain modification layer (.lay) flattening the ground under a building. */
  layer?: string;
}

export interface Layout {
  planet: string;
  center: { x: number; z: number };
  radius: number;
  /** Pack-relative terrain template (.trn) copied from the game, when the converter found one. */
  terrain?: string;
  objects: LayoutObject[];
}

export interface Primitive {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Portal cell this primitive belongs to (0 = exterior shell), or -1 for plain models. */
  cell: number;
}

export interface LoadedModel {
  def: PackModelDef;
  scene: THREE.Group;
  primitives: Primitive[];
  /** Horizontal radius from the bounds, for collision approximations. */
  radius: number;
  height: number;
  /** Interior cell boxes in model space (buildings only), used to tell when someone is inside. */
  interiorBoxes: THREE.Box3[];
  /** Overall model-space box. */
  bounds: THREE.Box3;
  /** Portal polygons (model space) with the cells on either side, for tracking which cell someone is in. */
  portals: Portal[];
  /**
   * The detail levels its exterior switches between (step 7), finest first: `levels[0]` is `primitives` less
   * any room's, the others the GLB's `lods` scene. Null for a model with one level, or out of an older pack.
   * Never part of `scene`, so whatever draws the model whole draws it exactly as before.
   */
  levels: ModelLevel[] | null;
}

export interface Portal {
  verts: THREE.Vector3[];
  /** Triangle indices into verts. */
  indices: number[];
  normal: THREE.Vector3;
  /** Plane offset: normal . p = d on the polygon. */
  d: number;
  /** Cells joined by this portal ([from, to] pairs as the cells list them). */
  links: { from: number; to: number }[];
  passable: boolean;
}

/** The client's level number a node's glTF name carries (`lod:<n>`, read through `userData.name`, since GLTFLoader strips the colon), walking up to its scene; -1 for none. */
function lodLevelOf(o: THREE.Object3D): number {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) {
    const m = /^lod:(\d+)$/.exec(String(x.userData?.name ?? ''));
    if (m) return Number(m[1]);
  }
  return -1;
}

/**
 * A model's detail levels out of its manifest entry and the GLB's `lods` scene (step 7): the finest is the
 * exterior of what the model's own nodes draw, each lower level the meshes of its `lod:<n>` node, set up as
 * the model's own are. Null -- the model drawn at its finest everywhere, as before -- for a model with one
 * level, and for any mismatch between the entry and the file (a level the entry says draws something with no
 * node for it), since a half-read chain would draw a hole where a building stands.
 */
function modelLevels(def: PackModelDef, scenes: THREE.Group[], primitives: Primitive[]): ModelLevel[] | null {
  const lods = def.lods;
  if (!lods || lods.length < 2) return null;
  // Only the levels the pick can ever draw: a chain whose switches do not rise (a pack converted before the
  // converter dropped such levels: one gallery hull had every switch at 0 and drew its heaviest "lowest" level at
  // every distance) keeps the coarser of two that clash, and one that comes to its finest alone is drawn so.
  const kept = drawnLevels(lods.map((l) => l.near));
  if (kept.length < 2) return null;
  const wanted = new Set<number>();
  for (let j = 1; j < kept.length; j++) wanted.add(lods[kept[j]].level);
  const scene = scenes.find((s) => /^lods(_\d+)?$/.test(s.name));
  const byLevel = new Map<number, { mesh: THREE.Mesh; material: THREE.Material }[]>();
  scene?.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const level = lodLevelOf(o);
    if (!wanted.has(level)) return;
    let list = byLevel.get(level);
    if (!list) byLevel.set(level, (list = []));
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) list.push({ mesh: o, material: m });
  });
  for (let j = 1; j < kept.length; j++) {
    const row = lods[kept[j]];
    if (row.prims > 0 && !byLevel.get(row.level)?.length) return null;
  }
  // Set up as the model's own meshes are, and only once the chain is known to be whole: a level never drawn
  // registers nothing that the pack's dispose would not reach.
  const prims = new Map<number, Primitive[]>();
  for (const [level, list] of byLevel) {
    const out: Primitive[] = [];
    for (const { mesh, material } of list) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (isReflective(material)) registerReflective(material);
      if (Object.keys(mesh.geometry.morphAttributes).length) {
        mesh.geometry.morphAttributes = {};
        mesh.geometry.morphTargetsRelative = false;
      }
      out.push({ geometry: mesh.geometry, material, cell: -1 });
    }
    prims.set(level, out);
  }
  const out: ModelLevel[] = [];
  for (let j = 0; j < kept.length; j++) {
    const row = lods[kept[j]];
    const next = kept[j + 1];
    const far = next !== undefined ? lods[next].near : row.far;
    out.push({ near: j === 0 ? 0 : row.near, far, level: row.level, primitives: j === 0 ? primitives.filter((p) => p.cell <= 0) : (prims.get(row.level) ?? []) });
  }
  return out;
}

/** A loaded model's levels past the finest, whose meshes are its own (the finest's are `primitives`). */
export function lowerLevels(m: LoadedModel): readonly ModelLevel[] {
  return m.levels && m.levels.length > 1 ? m.levels.slice(1) : NO_LEVELS;
}
const NO_LEVELS: readonly ModelLevel[] = [];

/** Converted SWG content for one planet, loaded from the private assets folder. */
export class AssetPack {
  private readonly loader = surfaces.withPlugin(new GLTFLoader());
  private readonly cache = new Map<string, Promise<LoadedModel>>();
  private readonly ready = new Map<string, LoadedModel>();
  private readonly bytesCache = new Map<string, Promise<ArrayBuffer | null>>();

  layout: Layout | null = null;

  /**
   * The effects each kind of placed object's client data hangs on it -- a brazier's fire, a fountain's
   * spray, a tiki torch's flame, a streetlamp's glow -- keyed by object template, from the pack's
   * `objeffects.json` (the converter's `objeffects` pass). Keyed by template rather than by model,
   * because templates sharing one model hang different things on it. Null for a pack converted before
   * the pass existed, which places what it always did.
   */
  objectEffects: Record<string, PackEffect[]> | null = null;

  private effectsLoad: Promise<void> | null = null;

  /**
   * Reads `objeffects.json`, once: every caller gets the one fetch, so a placement can wait on it for
   * nothing once it has landed. A pack that has no table keeps `objectEffects` null.
   */
  loadObjectEffects(): Promise<void> {
    this.effectsLoad ??= this.fetchObjectEffects();
    return this.effectsLoad;
  }

  private async fetchObjectEffects(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}objeffects.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
      const table = (await res.json()) as { version?: number; templates?: Record<string, PackEffect[]> };
      if (table.version === OBJECT_EFFECTS_VERSION && table.templates) this.objectEffects = table.templates;
    } catch {
      /* no table: the objects stand as they always did */
    }
  }

  private constructor(readonly manifest: PackManifest, private readonly baseUrl: string) {}

  /** The folder this pack is served from, which a pack standing behind another's needs to be named relative to. */
  get root(): string {
    return this.baseUrl;
  }

  /**
   * A pack over a folder whose manifest is already in hand and is not a planet's.
   *
   * The props pack is the one of these: it is a catalogue of things first and a bag of models
   * second, so its file lists eight and a half thousand props over three thousand models and is
   * read by the panel rather than by the streamer. Building a pack from that list here, instead of
   * writing the whole manifest twice in the converter, is the difference between a change of file
   * shape (a nine-hundred-megabyte reconversion) and no change at all.
   *
   * Nothing is fetched: there is no layout to place and no floors to read, because nobody walks
   * inside a chair.
   */
  static from(manifest: PackManifest, baseUrl: string): AssetPack {
    return new AssetPack(manifest, baseUrl);
  }

  static async load(planetId: string): Promise<AssetPack | null> {
    const baseUrl = `${import.meta.env.BASE_URL}assets-private/${planetId}/`;
    try {
      const res = await fetch(`${baseUrl}manifest.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const manifest = (await res.json()) as PackManifest;
      const pack = new AssetPack(manifest, baseUrl);
      try {
        const lr = await fetch(`${baseUrl}layout.json`);
        if (lr.ok && (lr.headers.get('content-type') ?? '').includes('json')) pack.layout = (await lr.json()) as Layout;
      } catch {
        pack.layout = null;
      }
      // The cells' walkable floors, written beside the manifest rather than in it (the manifests
      // are written indented and a floor is thousands of plain numbers). A pack converted before
      // they were read has no such file: the cells keep no floor and everything that walks indoors
      // steers straight at its goal, which is what it did before this existed.
      try {
        const fr = await fetch(`${baseUrl}floors.json`);
        if (fr.ok && (fr.headers.get('content-type') ?? '').includes('json')) {
          const floors = (await fr.json()) as { version?: number; models?: Record<string, Record<string, { floor?: CellFloor; graph?: CellGraph }>> };
          if (floors.version === FLOOR_PACK_VERSION && floors.models) {
            for (const list of Object.values(manifest.categories)) {
              for (const def of list) {
                const byCell = floors.models[def.id];
                if (!byCell || !def.cells) continue;
                for (const cell of def.cells) {
                  const block = byCell[String(cell.index)];
                  if (!block) continue;
                  if (block.floor) cell.floor = block.floor;
                  if (block.graph) cell.graph = block.graph;
                }
              }
            }
          }
        }
      } catch {
        /* no floors in this pack: the game steers, as it always has */
      }
      // The trees' and rocks' own collision shapes, beside the manifest as the floors are. A pack
      // converted before the pass has none, and its plantings stand on the guessed cylinders.
      if (manifest.categories.flora?.length) {
        try {
          const cr = await fetch(`${baseUrl}flora-collision.json`);
          if (cr.ok && (cr.headers.get('content-type') ?? '').includes('json')) mergeFloraCollision(manifest.categories.flora, await cr.json());
        } catch {
          /* no collision shapes in this pack: the trees are guessed, as they always were */
        }
      }
      await pack.loadObjectEffects();
      return pack;
    } catch {
      return null;
    }
  }

  category(name: string): PackModelDef[] {
    return this.manifest.categories[name] ?? [];
  }

  find(id: string): PackModelDef | undefined {
    for (const list of Object.values(this.manifest.categories)) {
      const hit = list.find((m) => m.id === id);
      if (hit) return hit;
    }
    return undefined;
  }

  model(id: string): Promise<LoadedModel> {
    let p = this.cache.get(id);
    if (!p) {
      const def = this.find(id);
      if (!def) return Promise.reject(new Error(`model ${id} is not in the ${this.manifest.planet} pack`));
      p = this.loader.loadAsync(this.baseUrl + def.file).then((gltf) => {
        const primitives: Primitive[] = [];
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            // GLTFLoader strips ':' from node names, so "cell:0:exterior" arrives as "cell0exterior".
            const cellMatch = /^cell[:_]?(\d+)/.exec(o.name) ?? /^cell[:_]?(\d+)/.exec(o.parent?.name ?? '');
            const cell = cellMatch ? Number(cellMatch[1]) : -1;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (let i = 0; i < mats.length; i++) {
              let m = mats[i];
              if (isReflective(m)) registerReflective(m);
              // Interior cells get their own material instances: the portal renderer stencils them apart from the shell.
              if (cell > 0 && !m.userData.interior) {
                m = m.clone();
                m.userData.interior = true;
                // The copy joins the registry as the original did. Left out, it kept whatever reflection
                // map the original had when it was cloned -- none at all when the sky had not been
                // captured yet, and a freed one once an old capture is let go of.
                if (isReflective(m)) registerReflective(m);
                mats[i] = m;
                if (Array.isArray(o.material)) o.material[i] = m;
                else o.material = m;
              }
              primitives.push({ geometry: o.geometry, material: m, cell });
            }
            // A placed object never morphs: it stands at its default shape. A geometry that came
            // with blend targets (an NPC's clothing carries the body's) would leave the instanced
            // mesh drawn from it without morph influences, and the renderer's morph update
            // throws on that, so the targets are dropped here.
            if (Object.keys(o.geometry.morphAttributes).length) {
              o.geometry.morphAttributes = {};
              o.geometry.morphTargetsRelative = false;
            }
          }
        });
        const levels = modelLevels(def, gltf.scenes ?? [], primitives);
        const { min, max } = def.bounds;
        const interiorBoxes = (def.cells ?? [])
          .filter((c) => c.index > 0)
          .map((c) => new THREE.Box3(new THREE.Vector3(...(c.bounds.min as [number, number, number])), new THREE.Vector3(...(c.bounds.max as [number, number, number]))));
        const portals: Portal[] = (def.portals ?? []).map((poly) => {
          const verts = poly.v.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
          const indices = poly.i.filter((k) => k >= 0 && k < verts.length);
          const normal = new THREE.Vector3(0, 0, 1);
          if (indices.length >= 3) {
            const a = verts[indices[0]];
            const b = verts[indices[1]];
            const c = verts[indices[2]];
            normal.copy(b).sub(a).cross(new THREE.Vector3().copy(c).sub(a)).normalize();
          }
          return { verts, indices, normal, d: verts.length ? normal.dot(verts[indices[0] ?? 0]) : 0, links: [], passable: true };
        });
        for (const c of def.cells ?? []) {
          for (const link of c.portals ?? []) {
            const portal = portals[link.geometry];
            if (!portal) continue;
            portal.links.push({ from: c.index, to: link.target });
            if (!link.passable) portal.passable = false;
          }
        }
        return {
          def,
          scene: gltf.scene,
          primitives,
          radius: Math.max(max[0] - min[0], max[2] - min[2]) / 2,
          height: max[1] - Math.min(0, min[1]),
          interiorBoxes,
          bounds: new THREE.Box3(new THREE.Vector3(min[0], min[1], min[2]), new THREE.Vector3(max[0], max[1], max[2])),
          portals,
          levels,
        };
      });
      this.cache.set(id, p);
      void p.then((m) => this.ready.set(id, m)).catch(() => undefined);
    }
    return p;
  }

  /** A model that has already finished loading, or null. */
  loaded(id: string): LoadedModel | null {
    return this.ready.get(id) ?? null;
  }

  /** Absolute URL of a pack-relative file. */
  url(file: string): string {
    return this.baseUrl + file;
  }

  /** Raw bytes of a pack file (terrain templates, layer files); null when missing. */
  bytes(file: string): Promise<ArrayBuffer | null> {
    let p = this.bytesCache.get(file);
    if (!p) {
      p = fetch(this.baseUrl + file)
        .then(async (res) => {
          if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
          return res.arrayBuffer();
        })
        .catch(() => null);
      this.bytesCache.set(file, p);
    }
    return p;
  }

  /** The planet's terrain template bytes, if the pack carries one. */
  terrain(): Promise<ArrayBuffer | null> {
    return this.layout?.terrain ? this.bytes(this.layout.terrain) : Promise.resolve(null);
  }

  async models(ids: string[]): Promise<LoadedModel[]> {
    const out: LoadedModel[] = [];
    for (const id of ids) {
      try {
        out.push(await this.model(id));
      } catch (err) {
        console.warn(`asset pack: ${id} failed to load`, err);
      }
    }
    return out;
  }

  /**
   * Every material of every model this pack has finished loading: what a world must take out of the portal
   * renderer's set and the cascades' map before the pack disposes them, since both hold what they are given.
   */
  loadedMaterials(): THREE.Material[] {
    const out: THREE.Material[] = [];
    for (const m of this.ready.values()) {
      for (const prim of m.primitives) out.push(prim.material);
      // A lower level's own materials (an atlas, a sprite card): joined to the same sets when its meshes were prepared.
      for (const lv of lowerLevels(m)) for (const prim of lv.primitives) out.push(prim.material);
    }
    return out;
  }

  dispose(): void {
    for (const p of this.cache.values()) {
      void p.then((m) => {
        for (const prim of m.primitives) {
          prim.geometry.dispose();
          prim.material.dispose();
        }
        for (const lv of lowerLevels(m)) {
          for (const prim of lv.primitives) {
            prim.geometry.dispose();
            prim.material.dispose();
          }
        }
      }).catch(() => undefined);
    }
    this.cache.clear();
    this.ready.clear();
  }
}
