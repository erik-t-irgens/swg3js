import type * as THREE from 'three';
import type { ThirdPersonCamera } from '../core/camera';
import type { Input } from '../core/input';
import type { Physics } from '../core/physics';
import type { Player } from '../player/player';
import type { World } from '../world/world';
import type { Bolts } from './bolts';
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
}

/** Something a blade, a bolt or a blast can hurt: the creatures and the turrets. */
export interface Hittable {
  readonly pos: THREE.Vector3;
  readonly halfHeight: number;
  dead: boolean;
  /** Hurt it; with `from` and `push`, shove it away from there. */
  damage(amount: number, from?: THREE.Vector3, push?: number): void;
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
  update(ctx: KitContext): void;
  dispose(): void;
}
