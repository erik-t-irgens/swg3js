import type * as THREE from 'three';
import type { ThirdPersonCamera } from '../core/camera';
import type { Input } from '../core/input';
import type { Physics } from '../core/physics';
import type { Player } from '../player/player';
import type { World } from '../world/world';
import type { Bolts } from './bolts';
import type { WeaponCatalogue } from '../player/weapons';
import type { Effects } from './effects';

export type ClassId = 'jedi' | 'bounty_hunter';

export interface KitSlot {
  key: string;
  name: string;
  cost: string;
}

export interface KitContext {
  dt: number;
  input: Input;
  player: Player;
  world: World;
  cam: ThirdPersonCamera;
  physics: Physics;
  effects: Effects;
  /** Blaster bolts in the air, for the kits that fire them. */
  bolts: Bolts;
  /** The weapons rack, for a gun's own effects (null before it loads). */
  weapons: WeaponCatalogue | null;
}

/** Something a blade, a bolt or a blast can hurt: the creatures and the turrets. */
export interface Hittable {
  readonly pos: THREE.Vector3;
  readonly halfHeight: number;
  dead: boolean;
  /** Hurt it; with `from` and `push`, shove it away from there; `source` is who struck, so it can fight back. */
  damage(amount: number, from?: THREE.Vector3, push?: number, source?: Living | null): void;
  /**
   * A bolt struck it at `point`: take it whole and return 'shown' when it placed its own hit effect, or
   * 'taken' when it placed none and the bolt's own hit effect should play; false to be hurt the plain way.
   */
  takeBolt?(bolt: import('./bolts').Bolt, point: THREE.Vector3, normal: THREE.Vector3): false | 'taken' | 'shown';
  /** Burn or corrode it for a while (a creature), stagger it, or slow it; the turrets and vehicles do without. */
  afflict?(dps: number, seconds: number): void;
  stun?(seconds: number): void;
  slow?(seconds: number): void;
}

/** Whose side a living thing is on; who picks a fight with whom is `hostileSides` in targets.ts. */
export type Side = 'player' | 'fighter' | 'wild' | 'hostile' | 'imperial' | 'rebel' | 'civilian' | 'neutral';
/** How readily it starts one, and what it does when it is hurt. */
export type Aggression = 'aggressive' | 'defensive' | 'skittish' | 'passive';

/** No living thing: never a key, so `targetKey || NOBODY` and `if (key)` both read correctly. */
export const NOBODY = 0;
/**
 * The player's key. The one key that is a named constant, because the player is the only Living
 * the game makes exactly one of; every other key comes from `nextLivingKey`, which starts at 2,
 * so no key is ever 0 and a plain truthiness test on a key is still correct.
 */
export const PLAYER_KEY = 1;

let livingKeys = PLAYER_KEY;
/** The next key. Keys start at 2 and are never reused while the page lives. */
export function nextLivingKey(): number {
  return ++livingKeys;
}

/**
 * Something alive that can be fought: the player, a creature, a fighter, a mobile. One list, one
 * key each, one way to be hurt that carries where the blow came from, so a Force power reaches
 * every kind of body and everything it touches knows who touched it.
 */
export interface Living extends Hittable {
  /** Unique while it lives, for remembering a target or an attacker without holding the object. Always 1 or more. */
  readonly key: number;
  readonly label: string;
  readonly side: Side;
  readonly aggression: Aggression;
  /** How far its body reaches toward a point, across the ground (a long body is not a circle). */
  radiusToward(from: THREE.Vector3): number;
  /** Whether it stands on something: a knock only throws what the ground can push back against. */
  grounded?: boolean;
  /** Shove it away along `dir` at `power` metres a second (a push, a repulse, a blast). */
  knock?(dir: THREE.Vector3, power: number): void;
  /** Hold it at a point in the air this frame (the Force grip); `dt` is the frame it is held for. */
  holdAt?(point: THREE.Vector3, dt: number): void;
  /** Let a held body go, thrown along `dir`. */
  release?(dir: THREE.Vector3, power: number): void;
}

export interface Resource {
  label: string;
  value: number;
  max: number;
}

/** A playable class: its weapon, its abilities and the resource that fuels them. */
export interface Kit {
  readonly id: ClassId;
  readonly name: string;
  readonly slots: KitSlot[];
  readonly help: string[];
  /** The pool the abilities draw on, shown as the second bar; a kit without one shows none. */
  readonly resource: Resource | null;
  slotActive(index: number): boolean;
  /** 0 = ready, 1 = just used. */
  slotCooldown(index: number): number;
  /** How charged a held shot or power is, 0 to 1, for the HUD's ring under the crosshair. */
  charge?(): number;
  update(ctx: KitContext): void;
  /** Put the kit's own visuals in the scene, hidden, so their shaders compile behind the loading screen. */
  warmUp?(): void;
  dispose(): void;
}
