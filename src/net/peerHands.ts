// The weapons in another player's hands, hung on their hand bones as their hello names them. Kept out of
// `RemotePlayers` so the node tests run the very loop the peers do (that module cannot be loaded in node:
// it pulls in the rig and the loader and carries a parameter property). Type-only imports.
import type * as THREE from 'three';
import type { WeaponDef } from '../player/weapons';

/** One weapon hung on a hand: the holder in the scene, what the rack says it is, and which hand. */
export interface HungWeapon {
  node: THREE.Object3D;
  def: WeaponDef;
  hand: 'right' | 'left';
}

/** What hanging a peer's weapons needs from the peers, the rack and the rig. */
export interface HangDeps {
  /** The rack's weapon of an id, or undefined for one this build has not got. */
  find(id: string): WeaponDef | undefined;
  /** The rig's bone for a hand, or null when it has none. */
  bone(role: 'rightHand' | 'leftHand'): THREE.Bone | null;
  /** A model of the weapon, a fresh copy for every ask: one object can hang on only one bone. */
  model(def: WeaponDef): Promise<THREE.Object3D>;
  /** The model held in a hand (`weaponHolder`). */
  holder(bone: THREE.Bone, def: WeaponDef, model: THREE.Object3D): THREE.Object3D;
  /** Compiled before it is shown, every time, as the player's own are. */
  prepare(holder: THREE.Object3D): Promise<void>;
  /** Asked after every await: false when the peer, their rig or what they hold has changed meanwhile. */
  alive(): boolean;
  /** Hang it: on the bone, marked an actor, and on the peer's list. */
  hang(w: HungWeapon, bone: THREE.Bone): void;
  warn(id: string, err: unknown): void;
}

/**
 * Hang what a peer's hello says is in their hands (`held`, `r` and `l`), right then left, each hand on
 * its own: a model of its own, made ready, then hung on that hand's bone. Each hand is its own whatever
 * the other holds -- two copies of one hilt, the same id in both hands, are two models on two bones and
 * two blades, because two of one saber are two things a player may hold one in each hand. A hand whose
 * weapon the rack lacks, or whose bone the rig lacks, stays empty; one that fails to load is said and
 * left empty. Stops as soon as `alive` says no.
 */
export async function hangHeld(held: { r?: string; l?: string } | null | undefined, deps: HangDeps): Promise<void> {
  const hands: ['rightHand' | 'leftHand', 'right' | 'left', string | undefined][] = [
    ['rightHand', 'right', held?.r],
    ['leftHand', 'left', held?.l],
  ];
  for (const [role, hand, id] of hands) {
    if (!id) continue;
    const def = deps.find(id);
    const bone = deps.bone(role);
    if (!def || !bone) continue;
    try {
      const model = await deps.model(def);
      const holder = deps.holder(bone, def, model);
      await deps.prepare(holder);
      if (!deps.alive()) return;
      deps.hang({ node: holder, def, hand }, bone);
    } catch (err) {
      deps.warn(id, err);
    }
  }
}
