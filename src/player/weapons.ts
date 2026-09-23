// The weapons rack: the converted weapon models (assets-private/weapons/manifest.json) and what each
// kind fights like, so a weapon put in a hand picks the carries, the style and the blade's reach.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { surfaces } from '../world/surfaces';
import { OFF_HAND_CLASSES } from '../core/inventory.ts';
import { fireLookLine, pickFireLook, type FireLook } from './fireLook.ts';

export type WeaponClass = 'pistol' | 'carbine' | 'rifle' | 'heavy' | 'sword1h' | 'knife' | 'sword2h' | 'polearm' | 'fist' | 'lightsaber' | 'lightsaber2h' | 'lightsaberStaff' | 'thrown';

/**
 * A gun's client effect: the family and index its template names into the client's weapon table
 * (bolt 21 is a fireball, rocket 3 the lightning beam, projectile_rifle a slug), and the effects
 * that row named, converted into the pack: the shot (with how far ahead of its point it reaches),
 * the muzzle flash, the hit on a creature and the miss.
 */
export interface GunFx {
  id: string;
  index: number;
  shot?: string | null;
  reach?: number;
  fire?: string | null;
  hit?: string | null;
  miss?: string | null;
}

/** A lightsaber's blade, from the client's blade file: metres, and seconds to ignite and retract. */
export interface BladeDef {
  length: number;
  width: number;
  open: number;
  close: number;
  light?: { color?: number[]; range?: number[]; time?: number[] };
}

/** Whether a class is a lightsaber of any grip (one hand, two, or the double-bladed staff). */
export function isSaber(cls: WeaponClass | undefined | null): boolean {
  return cls === 'lightsaber' || cls === 'lightsaber2h' || cls === 'lightsaberStaff';
}
/** How a class fights: a blaster, a single-blade style (fast, medium, strong), the staff, the lightsaber itself, or thrown (the grenades the gadget slots throw; not held). */
export type Fights = 'gun' | 'single' | 'staff' | 'lightsaber' | 'thrown';

export interface WeaponDef {
  id: string;
  template: string;
  class: WeaponClass;
  model: string;
  file: string;
  bounds?: { min: number[]; max: number[] };
  length: number;
  blade?: BladeDef;
  fx?: GunFx;
  /** The game's name and description (null when its string tables lack them); absent on a pack converted before they were read. */
  name?: string | null;
  description?: string | null;
  /** The hands it takes (the game's arrangement: `[['hold_r']]`, `[['hold_r', 'hold_l']]`). */
  slots?: string[][] | null;
  /** Its picture, relative to the weapons folder. */
  icon?: string | null;
}

export interface WeaponsManifest {
  classes: Record<WeaponClass, { fights: Fights; hands: 'right' | 'either'; label: string }>;
  weapons: WeaponDef[];
  skipped: { template: string; why: string }[];
  /** The blade colours the game offers, as hex. */
  saberColors?: string[];
  /**
   * Effects beyond the guns' own rows: the flame thrower's and the lightning rifle's beams, the acid
   * and ice beams, and the burn a body wears once it has been set alight (`onfire`, which a pack
   * converted before it has not got, and for which nothing else in the pack can stand in — see
   * `fireLook.ts` for why).
   */
  effects?: Partial<Record<ExtraEffect, string>>;
}

/** The effects a pack carries beyond the guns' own rows, by the name the game asks for them by. */
export type ExtraEffect = 'flame' | 'lightning' | 'lightningMuzzle' | 'acid' | 'ice' | 'onfire';

/** What each class fights like, when the manifest does not say. */
export const FIGHTS: Record<WeaponClass, Fights> = { pistol: 'gun', carbine: 'gun', rifle: 'gun', heavy: 'gun', sword1h: 'single', knife: 'single', sword2h: 'single', polearm: 'staff', fist: 'single', lightsaber: 'lightsaber', lightsaber2h: 'lightsaber', lightsaberStaff: 'lightsaber', thrown: 'thrown' };
export const CLASS_LABELS: Record<WeaponClass, string> = { pistol: 'Pistols', carbine: 'Carbines', rifle: 'Rifles', heavy: 'Heavy weapons', sword1h: 'One-hand swords and clubs', knife: 'Knives', sword2h: 'Two-hand swords and axes', polearm: 'Polearms and lances', fist: 'Fist weapons', lightsaber: 'Lightsabers', lightsaber2h: 'Two-hand lightsabers', lightsaberStaff: 'Double-bladed lightsabers', thrown: 'Grenades and thrown weapons' };
/** Classes a left hand may hold too: every blade but the double-bladed staff; one in each hand fights as the dual style (the backpack's rules own the list). */
export const OFF_HAND = OFF_HAND_CLASSES as ReadonlySet<WeaponClass>;
/** The blaster carries a class plays: the pistol's, or the rifle's (carbines and heavy weapons use the rifle set). */
export function gunKindOf(cls: WeaponClass): 'pistol' | 'rifle' {
  return cls === 'pistol' ? 'pistol' : 'rifle';
}

export class WeaponCatalogue {
  readonly weapons: WeaponDef[];
  readonly skipped: { template: string; why: string }[];
  private readonly loader = surfaces.withPlugin(new GLTFLoader());
  private readonly models = new Map<string, Promise<THREE.Group>>();
  /** The fire chosen for a burning body: undefined until it is first asked for, then kept. */
  private fireChosen: FireLook | null | undefined;

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

  /** The blade colours the game offers, as hex, when the pack has them. */
  get saberColors(): string[] {
    return this.manifest.saberColors ?? [];
  }

  /** The pack's extra effects (beams for the flame thrower and the like), by name. */
  effect(name: ExtraEffect): string | null {
    return this.manifest.effects?.[name] ?? null;
  }

  /**
   * The fire a burning body is drawn with: the client's own burn where the pack has it, and null
   * where the pack was converted before it, since nothing else the pack carries can be worn by a
   * body (`fireLook.ts`). Worked out once and said once, so the console makes plain what this
   * session is drawing and what to run if it is nothing.
   */
  fireLook(): FireLook | null {
    if (this.fireChosen === undefined) {
      this.fireChosen = pickFireLook(this.manifest);
      console.log(fireLookLine(this.fireChosen));
    }
    return this.fireChosen;
  }

  /** A weapon's picture as a full URL, or null when the pack drew none. */
  iconUrl(def: WeaponDef): string | null {
    return def.icon ? `${this.baseUrl}${def.icon}` : null;
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

const holdScale = new THREE.Vector3();
const holdDir = new THREE.Vector3();
const holdQ = new THREE.Quaternion();
const HOLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * A weapon hung on another figure's hand bone, as the fighters hang theirs: the holder undoes the
 * bone's world scale, and a lightsaber's hilt is turned along the character's forward, as the game's
 * clips hold it. The caller adds it to the bone once its programs are ready.
 */
export function weaponHolder(rigRoot: THREE.Object3D, hand: THREE.Bone, def: WeaponDef, model: THREE.Object3D): THREE.Group {
  const holder = new THREE.Group();
  holder.name = `weapon:${def.id}`;
  holder.add(model);
  holder.scale.setScalar(1 / Math.max(hand.getWorldScale(holdScale).x, 1e-6));
  if (isSaber(def.class)) {
    rigRoot.updateWorldMatrix(true, true);
    holdDir.set(0, 0, 1).applyQuaternion(rigRoot.getWorldQuaternion(holdQ));
    holdDir.applyQuaternion(hand.getWorldQuaternion(holdQ).invert()).normalize();
    holder.quaternion.setFromUnitVectors(HOLD_UP, holdDir);
  }
  return holder;
}
