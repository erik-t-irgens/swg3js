import type { ThirdPersonCamera } from '../core/camera';
import type { Input } from '../core/input';
import type { Physics } from '../core/physics';
import type { Player } from '../player/player';
import type { World } from '../world/world';
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
  readonly resource: Resource;
  slotActive(index: number): boolean;
  /** 0 = ready, 1 = just used. */
  slotCooldown(index: number): number;
  update(ctx: KitContext): void;
  dispose(): void;
}
