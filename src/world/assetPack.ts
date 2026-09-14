import * as THREE from 'three';
import { isReflective, registerReflective } from './envmap';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface CellLight {
  type: number;
  color: number[];
  position: number[];
  direction: number[];
  attenuation: number[];
}

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
  }[];
  /** Portal polygons in model space (vertices and triangle indices), indexed by the cells' `geometry` field. */
  portals?: { v: number[][]; i: number[] }[];
  /** Flora models: the appearance file the terrain's flora families name (e.g. appearance/tree_x.apt). */
  appearance?: string;
  /** A particle effect (particles/<id>.json) rather than a mesh; placed like any other object. */
  particle?: boolean;
  /** Particle effects attached to this model (a lamp's flame), transforms in the converter's unflipped model space. */
  effects?: { file: string; id: string; transform?: number[]; cell?: number }[];
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

/** Converted SWG content for one planet, loaded from the private assets folder. */
export class AssetPack {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<LoadedModel>>();
  private readonly ready = new Map<string, LoadedModel>();
  private readonly bytesCache = new Map<string, Promise<ArrayBuffer | null>>();

  layout: Layout | null = null;

  private constructor(readonly manifest: PackManifest, private readonly baseUrl: string) {}

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

  dispose(): void {
    for (const p of this.cache.values()) {
      void p.then((m) => {
        for (const prim of m.primitives) {
          prim.geometry.dispose();
          prim.material.dispose();
        }
      }).catch(() => undefined);
    }
    this.cache.clear();
    this.ready.clear();
  }
}
