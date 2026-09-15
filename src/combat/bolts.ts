// Blaster bolts, after OpenJK's codemp/game/g_weapon.c (WP_FireBlasterMissile) and g_missile.c:
// a bolt is a thing in flight with a velocity, not a ray. It leaves the muzzle at the weapon's
// speed (the E-11's 2300 units a second, about 58 m/s), flies straight with no drop, and hurts
// the first thing it runs into. A bolt in the air can be sidestepped, and one that strikes a
// lit lightsaber facing it is turned away (see deflect.ts) and flies on as the blocker's own.
//
// A ship's bolt is the game's own: its speed and range from the weapon table, the shooter's
// velocity added so a bolt never lags the ship that fired it, and its look a particle effect
// from the projectile table (a long red, green or blue streak) carried along with it, with the
// table's hit effect where it strikes.
//
// This file is derived from OpenJK, copyright (C) 1999-2000 Id Software, Inc., (C) 2000-2013
// Activision, (C) 2013 OpenJK contributors, and is used under the GNU General Public License
// version 2 (see LICENSES/OpenJK-GPL-2.0.txt).
import * as THREE from 'three';
import { RAPIER, type Physics } from '../core/physics';
import { markActor } from '../world/portalRender';
import type { EffectHandle, ParticleEffects } from '../world/particles';
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

/** How a ship's bolt looks: the projectile table's effect for it, and the one for where it strikes. */
export interface ProjectileVisual {
  /** The bolt's particle effect, relative to the ships pack. */
  effect: string;
  /** How far ahead of the projectile's own point the effect reaches (metres): the bolt's tip. */
  reach: number;
  /** The effect played where the bolt strikes, when the table names one. */
  hit?: string | null;
}

export interface BoltOptions {
  owner: BoltOwner;
  damage?: number;
  /** Units a second. */
  speed?: number;
  /** Metres a second, in place of `speed`, for the game's own guns. */
  metresPerSecond?: number;
  /** The shooter's own velocity (metres a second), carried by the bolt on top of its muzzle speed. */
  inherit?: THREE.Vector3;
  /** Seconds the bolt flies before it fades (the blaster's four, or a ship gun's range over its speed). */
  life?: number;
  color?: number;
  /** The shooter's body, which the bolt flies out through. */
  exclude?: RAPIER.RigidBody;
  /** A ship's bolt: drawn as the game's projectile effect, when the effects are loaded. */
  projectile?: ProjectileVisual | null;
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
  life: number;
  /** How far ahead of `pos` the bolt's tip is: what leads the way into whatever it hits. */
  lead: number;
  /** Set once a saber has turned it away, so a second block cannot send it back again at once. */
  reflected: number;
  mesh: THREE.Group;
  /** The projectile effect carried along, in place of the mesh, for a ship's bolt. */
  fx: EffectHandle | null;
  hitFx: string | null;
}

/** What a bolt may strike and what to do about it. */
export interface BoltWorld {
  physics: Physics;
  effects: Effects;
  /** The creature, emplacement or vehicle a collider belongs to. */
  hittableAt(handle: number): Hittable | undefined;
  /** The player's body and collider, hit by other shooters' bolts. */
  player: { body: RAPIER.RigidBody; collider: RAPIER.Collider; pos: THREE.Vector3 };
  /** A bolt reached the player: return the way it leaves when blocked, or null to let it hurt. */
  block(bolt: Bolt, hit: THREE.Vector3, out: THREE.Vector3): boolean;
  onPlayerHit(damage: number, from: THREE.Vector3): void;
}

const tmp = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const hitNormal = new THREE.Vector3();
const bounce = new THREE.Vector3();
const placeQ = new THREE.Quaternion();
const placeM = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
/** Bolt length in metres: JKA's bolt effect is about 32 units long. */
const LENGTH = 32 * UNIT;

export class Bolts {
  readonly bolts: Bolt[] = [];
  private readonly core = new THREE.CylinderGeometry(0.025, 0.025, LENGTH, 6, 1).rotateX(Math.PI / 2);
  private readonly glow = new THREE.CylinderGeometry(0.07, 0.07, LENGTH * 0.9, 8, 1).rotateX(Math.PI / 2);
  private readonly materials = new Map<number, [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial]>();
  /** Bolts fired this session by each side, for the console. */
  readonly fired = { player: 0, enemy: 0 };
  /** The player of the ships pack's particle effects, once there is one: a ship's bolt is drawn through it. */
  visuals: ParticleEffects | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** Fire a bolt from `from` along `dir` (unit length). */
  fire(from: THREE.Vector3, dir: THREE.Vector3, { owner, damage = BLASTER.damage, speed = BLASTER.velocity, metresPerSecond, inherit, life = BLASTER.life, color = 0xff4a2a, exclude, projectile }: BoltOptions): Bolt {
    const [coreMat, glowMat] = this.materialsFor(color);
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(this.core, coreMat), new THREE.Mesh(this.glow, glowMat));
    mesh.position.copy(from);
    // The bolt's velocity: its muzzle speed along the barrel, plus whatever the shooter itself
    // was doing, so a fighter at full throttle sees its bolts pull away as they should.
    const vel = dir.clone().normalize().multiplyScalar(metresPerSecond ?? speed * UNIT);
    if (inherit) vel.add(inherit);
    const s = vel.length();
    const heading = s > 1e-6 ? vel.divideScalar(s) : dir.clone().normalize();
    mesh.quaternion.setFromUnitVectors(Z, heading);
    const fx = projectile && this.visuals ? this.visuals.place(projectile.effect, placeM.compose(from, mesh.quaternion, ONE), false, true) : null;
    if (fx) mesh.visible = false;
    this.scene.add(mesh);
    markActor(mesh);
    const bolt: Bolt = { pos: from.clone(), dir: heading, speed: s, damage, owner, exclude, age: 0, life, lead: fx && projectile ? projectile.reach : LENGTH / 2, reflected: 0, mesh, fx, hitFx: fx ? (projectile?.hit ?? null) : null };
    this.bolts.push(bolt);
    this.fired[owner]++;
    return bolt;
  }

  /** A bolt of each colour far below the world, gone on the next update, so the first real shot finds its shaders compiled. */
  warmUp(colors: number[] = [0xff4a2a, 0x3af06a]): void {
    for (const color of colors) {
      const b = this.fire(new THREE.Vector3(0, -900, 0), new THREE.Vector3(0, -1, 0), { owner: 'enemy', color, speed: 0 });
      b.age = BLASTER.life;
      this.fired.enemy--;
    }
  }

  /** Fly every bolt on by `dt` and settle what each one struck. */
  update(dt: number, w: BoltWorld): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      if (b.age > b.life) {
        this.remove(i);
        continue;
      }
      const step = b.speed * dt;
      // The bolt's own length leads the way so it does not visibly poke through what it hits.
      const ray = new RAPIER.Ray(b.pos, b.dir);
      const hit = w.physics.world.castRayAndGetNormal(ray, step + b.lead, true, undefined, undefined, undefined, b.exclude);
      if (!hit) {
        b.pos.addScaledVector(b.dir, step);
        this.settle(b);
        continue;
      }
      const p = ray.pointAt(hit.timeOfImpact);
      hitPoint.set(p.x, p.y, p.z);
      hitNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
      if (hit.collider.handle === w.player.collider.handle) {
        if (b.owner !== 'player' && w.block(b, hitPoint, bounce)) {
          // Turned away by the saber: it now belongs to the player and flies on from the block.
          b.owner = 'player';
          b.exclude = w.player.body;
          b.reflected++;
          b.age = 0;
          b.dir.copy(bounce);
          b.pos.copy(hitPoint).addScaledVector(b.dir, 0.05);
          this.settle(b);
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
      // The game's own hit effect for a ship's bolt, stood on the surface it struck.
      if (b.hitFx && this.visuals) {
        if (hitNormal.lengthSq() < 1e-6) hitNormal.copy(b.dir).negate();
        placeQ.setFromUnitVectors(Y, hitNormal.normalize());
        this.visuals.place(b.hitFx, placeM.compose(hitPoint, placeQ, ONE), false, true);
      }
      this.remove(i);
    }
  }

  /** Put the bolt's mesh, or the effect carried in its place, where the bolt now is. */
  private settle(b: Bolt): void {
    b.mesh.position.copy(b.pos);
    b.mesh.quaternion.setFromUnitVectors(Z, b.dir);
    if (b.fx && this.visuals) this.visuals.move(b.fx, placeM.compose(b.pos, b.mesh.quaternion, ONE));
  }

  /** Take every bolt out of the air (leaving a planet). */
  clear(): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) this.remove(i);
  }

  private remove(i: number): void {
    const b = this.bolts[i];
    this.scene.remove(b.mesh);
    if (b.fx && this.visuals) this.visuals.remove(b.fx);
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
