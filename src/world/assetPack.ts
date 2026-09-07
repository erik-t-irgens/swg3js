import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface PackModelDef {
  id: string;
  file: string;
  bounds: { min: number[]; max: number[] };
  triangles: number;
}

export interface PackManifest {
  planet: string;
  categories: Record<string, PackModelDef[]>;
}

export interface Primitive {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface LoadedModel {
  def: PackModelDef;
  scene: THREE.Group;
  primitives: Primitive[];
  /** Horizontal radius from the bounds, for collision approximations. */
  radius: number;
  height: number;
}

/** Converted SWG content for one planet, loaded from the private assets folder. */
export class AssetPack {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<LoadedModel>>();

  private constructor(readonly manifest: PackManifest, private readonly baseUrl: string) {}

  static async load(planetId: string): Promise<AssetPack | null> {
    const baseUrl = `${import.meta.env.BASE_URL}assets-private/${planetId}/`;
    try {
      const res = await fetch(`${baseUrl}manifest.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const manifest = (await res.json()) as PackManifest;
      return new AssetPack(manifest, baseUrl);
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
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) primitives.push({ geometry: o.geometry, material: m });
          }
        });
        const { min, max } = def.bounds;
        return {
          def,
          scene: gltf.scene,
          primitives,
          radius: Math.max(max[0] - min[0], max[2] - min[2]) / 2,
          height: max[1] - Math.min(0, min[1]),
        };
      });
      this.cache.set(id, p);
    }
    return p;
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
  }
}
