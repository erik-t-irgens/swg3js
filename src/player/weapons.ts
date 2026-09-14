// The weapons rack: the converted weapon models (assets-private/weapons/manifest.json) and what each
// kind fights like, so a weapon put in a hand picks the carries, the style and the blade's reach.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type WeaponClass = 'pistol' | 'carbine' | 'rifle' | 'heavy' | 'sword1h' | 'knife' | 'sword2h' | 'polearm' | 'lightsaber';
/** How a class fights: a blaster, a single-blade style (fast, medium, strong), the staff, or the lightsaber itself. */
export type Fights = 'gun' | 'single' | 'staff' | 'lightsaber';

export interface WeaponDef {
  id: string;
  template: string;
  class: WeaponClass;
  model: string;
  file: string;
  bounds?: { min: number[]; max: number[] };
  length: number;
}

export interface WeaponsManifest {
  classes: Record<WeaponClass, { fights: Fights; hands: 'right' | 'either'; label: string }>;
  weapons: WeaponDef[];
  skipped: { template: string; why: string }[];
}

/** What each class fights like, when the manifest does not say. */
export const FIGHTS: Record<WeaponClass, Fights> = { pistol: 'gun', carbine: 'gun', rifle: 'gun', heavy: 'gun', sword1h: 'single', knife: 'single', sword2h: 'single', polearm: 'staff', lightsaber: 'lightsaber' };
export const CLASS_LABELS: Record<WeaponClass, string> = { pistol: 'Pistols', carbine: 'Carbines', rifle: 'Rifles', heavy: 'Heavy weapons', sword1h: 'One-hand swords', knife: 'Knives', sword2h: 'Two-hand swords', polearm: 'Polearms and lances', lightsaber: 'Lightsabers' };
/** Classes a left hand may hold (the dual style needs one of these in each hand). */
export const ONE_HANDED = new Set<WeaponClass>(['sword1h', 'knife']);
/** The blaster carries a class plays: the pistol's, or the rifle's (carbines and heavy weapons use the rifle set). */
export function gunKindOf(cls: WeaponClass): 'pistol' | 'rifle' {
  return cls === 'pistol' ? 'pistol' : 'rifle';
}

export class WeaponCatalogue {
  readonly weapons: WeaponDef[];
  readonly skipped: { template: string; why: string }[];
  private readonly loader = new GLTFLoader();
  private readonly models = new Map<string, Promise<THREE.Group>>();

  private constructor(readonly manifest: WeaponsManifest, private readonly baseUrl: string) {
    this.weapons = manifest.weapons;
    this.skipped = manifest.skipped ?? [];
  }

  static async load(baseUrl: string): Promise<WeaponCatalogue | null> {
    const url = `${baseUrl}assets-private/weapons/`;
    try {
      const res = await fetch(`${url}manifest.json`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      return new WeaponCatalogue((await res.json()) as WeaponsManifest, url);
    } catch {
      return null;
    }
  }

  find(id: string): WeaponDef | undefined {
    const lower = id.toLowerCase();
    return this.weapons.find((w) => w.id.toLowerCase() === lower) ?? this.weapons.find((w) => w.id.toLowerCase().includes(lower));
  }

  byClass(): Map<WeaponClass, WeaponDef[]> {
    const out = new Map<WeaponClass, WeaponDef[]>();
    for (const w of this.weapons) (out.get(w.class) ?? out.set(w.class, []).get(w.class)!).push(w);
    for (const list of out.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  /** The model for a weapon, a fresh copy each time (materials shared). */
  async model(def: WeaponDef): Promise<THREE.Group> {
    let p = this.models.get(def.file);
    if (!p) {
      p = this.loader.loadAsync(`${this.baseUrl}${def.file}`).then((gltf) => {
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.frustumCulled = false;
          }
        });
        return gltf.scene;
      });
      this.models.set(def.file, p);
    }
    return (await p).clone();
  }
}
