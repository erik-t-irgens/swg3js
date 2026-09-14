// Blaster bolts, after OpenJK's codemp/game/g_weapon.c (WP_FireBlasterMissile) and g_missile.c:
// a bolt is a thing in flight with a velocity, not a ray. It leaves the muzzle at the weapon's
// speed (the E-11's 2300 units a second, about 58 m/s), flies straight with no drop, and hurts
// the first thing it runs into. A bolt in the air can be sidestepped, and one that strikes a
// lit lightsaber facing it is turned away (see deflect.ts) and flies on as the blocker's own.
//
// This file is derived from OpenJK, copyright (C) 1999-2000 Id Software, Inc., (C) 2000-2013
// Activision, (C) 2013 OpenJK contributors, and is used under the GNU General Public License
// version 2 (see LICENSES/OpenJK-GPL-2.0.txt).
import * as THREE from 'three';
import { RAPIER, type Physics } from '../core/physics';
import { markActor } from '../world/portalRender';
import type { Effects } from './effects';
import type { Hittable } from './kit';

const UNIT = 0.0254;

/** The E-11 blaster rifle's numbers (g_weapon.c, bg_weapons.c). */
export const BLASTER = {
  /** Bolt speed in units a second. */
  velocity: 2300,
  damage: 20,
  /** Seconds between shots on the primary trigger. */
  fireTime: 0.35,
  /** Seconds between shots on the rapid trigger. */
  altFireTime: 0.15,
  /** The rapid trigger's scatter, in degrees each way. */
  altSpread: 1.6,
  /** Seconds a bolt lives before it fades. */
  life: 4,
  /** Push on what it hits, as the creatures' knock scale. */
  push: 2.5,
};

export type BoltOwner = 'player' | 'enemy';

export interface BoltOptions {
  owner: BoltOwner;
  damage?: number;
  /** Units a second. */
  speed?: number;
  color?: number;
  /** The shooter's body, which the bolt flies out through. */
  exclude?: RAPIER.RigidBody;
}

export interface Bolt {
  readonly pos: THREE.Vector3;
  readonly dir: THREE.Vector3;
  /** Metres a second. */
  speed: number;
  damage: number;
  owner: BoltOwner;
  exclude: RAPIER.RigidBody | undefined;
  age: number;
  /** Set once a saber has turned it away, so a second block cannot send it back again at once. */
  reflected: number;
  mesh: THREE.Group;
}

/** What a bolt may strike and what to do about it. */
export interface BoltWorld {
  physics: Physics;
  effects: Effects;
  /** The creature or emplacement a collider belongs to. */
  hittableAt(handle: number): Hittable | undefined;
  /** The player's body and collider, hit by other shooters' bolts. */
  player: { body: RAPIER.RigidBody; collider: RAPIER.Collider; pos: THREE.Vector3 };
  /** A bolt reached the player: return the way it leaves when blocked, or null to let it hurt. */
  block(bolt: Bolt, hit: THREE.Vector3, out: THREE.Vector3): boolean;
  onPlayerHit(damage: number, from: THREE.Vector3): void;
}

const tmp = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const bounce = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
/** Bolt length in metres: JKA's bolt effect is about 32 units long. */
const LENGTH = 32 * UNIT;

export class Bolts {
  readonly bolts: Bolt[] = [];
  private readonly core = new THREE.CylinderGeometry(0.025, 0.025, LENGTH, 6, 1).rotateX(Math.PI / 2);
  private readonly glow = new THREE.CylinderGeometry(0.07, 0.07, LENGTH * 0.9, 8, 1).rotateX(Math.PI / 2);
  private readonly materials = new Map<number, [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial]>();
  /** Bolts fired this session by each side, for the console. */
  readonly fired = { player: 0, enemy: 0 };

  constructor(private readonly scene: THREE.Scene) {}

  /** Fire a bolt from `from` along `dir` (unit length). */
  fire(from: THREE.Vector3, dir: THREE.Vector3, { owner, damage = BLASTER.damage, speed = BLASTER.velocity, color = 0xff4a2a, exclude }: BoltOptions): Bolt {
    const [coreMat, glowMat] = this.materialsFor(color);
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(this.core, coreMat), new THREE.Mesh(this.glow, glowMat));
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(Z, dir);
    this.scene.add(mesh);
    markActor(mesh);
    const bolt: Bolt = { pos: from.clone(), dir: dir.clone().normalize(), speed: speed * UNIT, damage, owner, exclude, age: 0, reflected: 0, mesh };
    this.bolts.push(bolt);
    this.fired[owner]++;
    return bolt;
  }

  /** Fly every bolt on by `dt` and settle what each one struck. */
  update(dt: number, w: BoltWorld): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      if (b.age > BLASTER.life) {
        this.remove(i);
        continue;
      }
      const step = b.speed * dt;
      // The bolt's own length leads the way so it does not visibly poke through what it hits.
      const ray = new RAPIER.Ray(b.pos, b.dir);
      const hit = w.physics.world.castRay(ray, step + LENGTH / 2, true, undefined, undefined, undefined, b.exclude);
      if (!hit) {
        b.pos.addScaledVector(b.dir, step);
        b.mesh.position.copy(b.pos);
        continue;
      }
      const p = ray.pointAt(hit.timeOfImpact);
      hitPoint.set(p.x, p.y, p.z);
      if (hit.collider.handle === w.player.collider.handle) {
        if (b.owner !== 'player' && w.block(b, hitPoint, bounce)) {
          // Turned away by the saber: it now belongs to the player and flies on from the block.
          b.owner = 'player';
          b.exclude = w.player.body;
          b.reflected++;
          b.age = 0;
          b.dir.copy(bounce);
          b.pos.copy(hitPoint).addScaledVector(b.dir, 0.05);
          b.mesh.position.copy(b.pos);
          b.mesh.quaternion.setFromUnitVectors(Z, b.dir);
          w.effects.burst(hitPoint, 0xbfe6ff, 0.6, 0.15);
          w.effects.flash(hitPoint, 0x9fd4ff, 14, 7, 0.12);
          continue;
        }
        if (b.owner !== 'player') {
          w.onPlayerHit(b.damage, b.pos);
          w.effects.burst(hitPoint, 0xff8060, 0.5, 0.15);
        }
        this.remove(i);
        continue;
      }
      const target = w.hittableAt(hit.collider.handle);
      if (target) {
        tmp.copy(b.pos).addScaledVector(b.dir, -1);
        target.damage(b.damage, tmp, BLASTER.push);
        w.effects.burst(hitPoint, 0xffb070, 0.7, 0.15);
        w.effects.flash(hitPoint, 0xff8a50, 10, 6, 0.1);
      } else {
        w.effects.burst(hitPoint, 0xffb070, 0.35, 0.12);
        w.effects.flash(hitPoint, 0xff8a50, 6, 4, 0.08);
      }
      this.remove(i);
    }
  }

  /** Take every bolt out of the air (leaving a planet). */
  clear(): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) this.remove(i);
  }

  private remove(i: number): void {
    const b = this.bolts[i];
    this.scene.remove(b.mesh);
    this.bolts.splice(i, 1);
  }

  private materialsFor(color: number): [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial] {
    let m = this.materials.get(color);
    if (!m) {
      const c = new THREE.Color(color);
      m = [
        new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.55), toneMapped: false }),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      ];
      this.materials.set(color, m);
    }
    return m;
  }

  dispose(): void {
    this.clear();
    this.core.dispose();
    this.glow.dispose();
    for (const [a, b] of this.materials.values()) {
      a.dispose();
      b.dispose();
    }
    this.materials.clear();
  }
}
