// Blaster turrets: emplacements that turn to face whoever comes within range and fire bolts at
// them, so there is something to dodge and something to send a bolt back at. They aim where the
// target is now, not where it will be, so a running target is missed and a standing one is hit.
import * as THREE from 'three';
import { combatSounds, type GunLike } from '../audio/combatSounds';
import { RAPIER, type Physics } from '../core/physics';
import type { Terrain } from '../world/terrain';
import { markActor } from '../world/portalRender';
import { BLASTER, type Bolts } from './bolts';
import type { Hittable } from './kit';

export const TURRET = {
  hp: 120,
  /** Metres within which it wakes and shoots. */
  range: 45,
  /** How fast the head turns, radians a second. */
  turnRate: 2.5,
  /** Seconds between shots. */
  fireTime: 0.8,
  /** Scatter each way, in degrees. */
  spread: 1,
  damage: 15,
  /** Seconds a wreck stays before the turret stands again. */
  respawn: 25,
  /** Muzzle height above the ground. */
  muzzleHeight: 1.1,
  /** Where on the target it aims: chest height above the feet. */
  aimHeight: 1.15,
};

/**
 * INVENTED: an emplacement is no weapon the game's tables name, so it fires as a heavy weapon
 * does -- the heaviest of the four plain rows of `combat_effects_ranged.iff`. One record, so its
 * sounds are worked out once for every turret there is.
 */
const TURRET_GUN: GunLike = { id: 'turret', class: 'heavy' };

/** The player as the turrets see it. */
export interface TurretTarget {
  pos: THREE.Vector3;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

const tmp = new THREE.Vector3();
const aim = new THREE.Vector3();
const from = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Every turret's eye shares one material, so a turret going does not take the eye's shader program with it. */
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0xff3020, toneMapped: false });

export class Turret implements Hittable {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly halfHeight = 0.75;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  hp = TURRET.hp;
  dead = false;
  /** Shots fired, for the console. */
  shots = 0;
  private readonly head: THREE.Group;
  private readonly barrel: THREE.Group;
  private readonly muzzle = new THREE.Object3D();
  private readonly eye: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private yaw = 0;
  private pitch = 0;
  private cooldown = 1;
  private deadFor = 0;

  constructor(private readonly physics: Physics, mats: { body: THREE.Material; dark: THREE.Material }, x: number, y: number, z: number, facing: number) {
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);
    this.yaw = facing;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 12), mats.dark);
    base.position.y = 0.1;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.75, 8), mats.body);
    post.position.y = 0.55;
    this.head = new THREE.Group();
    this.head.position.y = TURRET.muzzleHeight;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.5), mats.body);
    this.barrel = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.8, 8).rotateX(Math.PI / 2), mats.dark);
    tube.position.z = 0.6;
    this.muzzle.position.z = 1.02;
    this.eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), EYE_MAT);
    this.eye.position.set(0, 0.2, 0.1);
    this.barrel.add(housing, tube, this.muzzle, this.eye);
    this.head.add(this.barrel);
    this.group.add(base, post, this.head);
    this.group.name = 'turret';
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.name = 'turret part';
      }
    });
    this.group.rotation.y = this.yaw;

    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + this.halfHeight, z));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.cylinder(this.halfHeight, 0.45), this.body);
  }

  damage(amount: number): void {
    if (this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0) this.die();
  }

  private die(): void {
    this.dead = true;
    this.deadFor = 0;
    this.eye.material.color.set(0x301008);
    this.barrel.rotation.x = 0.7;
  }

  private revive(): void {
    this.dead = false;
    this.hp = TURRET.hp;
    this.eye.material.color.set(0xff3020);
    this.barrel.rotation.x = 0;
    this.cooldown = 1;
  }

  /** Turn towards the target when it is in range and in sight, and fire when lined up. */
  update(dt: number, target: TurretTarget, bolts: Bolts): void {
    if (this.dead) {
      this.deadFor += dt;
      if (this.deadFor >= TURRET.respawn) this.revive();
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    aim.copy(target.pos);
    aim.y += TURRET.aimHeight;
    this.muzzle.getWorldPosition(from);
    tmp.copy(aim).sub(from);
    const dist = tmp.length();
    if (dist > TURRET.range || dist < 0.5) return;
    tmp.divideScalar(dist);
    // Line of sight from the muzzle: anything but the target in the way keeps it quiet.
    const ray = new RAPIER.Ray(from, tmp);
    const hit = this.physics.world.castRay(ray, dist + 0.5, true, undefined, undefined, undefined, this.body);
    if (!hit || hit.collider.handle !== target.collider.handle) return;

    const wantYaw = Math.atan2(tmp.x, tmp.z);
    const wantPitch = Math.asin(Math.max(-1, Math.min(1, tmp.y)));
    let dYaw = Math.atan2(Math.sin(wantYaw - this.yaw), Math.cos(wantYaw - this.yaw));
    const maxTurn = TURRET.turnRate * dt;
    dYaw = Math.max(-maxTurn, Math.min(maxTurn, dYaw));
    this.yaw += dYaw;
    this.pitch += Math.max(-maxTurn, Math.min(maxTurn, wantPitch - this.pitch));
    this.head.rotation.y = this.yaw - this.group.rotation.y;
    this.barrel.rotation.x = -this.pitch;

    const aimed = Math.abs(Math.atan2(Math.sin(wantYaw - this.yaw), Math.cos(wantYaw - this.yaw))) < 0.07 && Math.abs(wantPitch - this.pitch) < 0.07;
    if (!aimed || this.cooldown > 0) return;
    this.cooldown = TURRET.fireTime;
    this.shots++;
    this.group.updateMatrixWorld(true);
    this.muzzle.getWorldPosition(from);
    // Scatter like the NPCs' aim: a little off in yaw and pitch each shot.
    const s = (TURRET.spread * Math.PI) / 180;
    right.crossVectors(tmp, UP).normalize();
    up.crossVectors(right, tmp);
    tmp.addScaledVector(right, Math.tan((Math.random() * 2 - 1) * s)).addScaledVector(up, Math.tan((Math.random() * 2 - 1) * s)).normalize();
    bolts.fire(from, tmp, { owner: 'enemy', damage: TURRET.damage, speed: BLASTER.velocity, color: 0xff3a2a, exclude: this.body, sound: combatSounds.gunOf(TURRET_GUN) });
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });

  }
}

export class TurretManager {
  readonly group = new THREE.Group();
  readonly turrets: Turret[] = [];
  readonly byCollider = new Map<number, Turret>();
  // Little metalness: a mirror-grey turret reflects the sky and ground and vanishes into them.
  private readonly mats = {
    body: new THREE.MeshStandardMaterial({ color: 0x6e7378, roughness: 0.7, metalness: 0.15, flatShading: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.8, metalness: 0.1, flatShading: true }),
  };

  constructor(private readonly physics: Physics, private readonly terrain: Terrain) {}

  /** Stand a turret on the ground at (x, z), facing `facing`. */
  place(x: number, z: number, facing = 0): Turret {
    const y = this.terrain.heightAt(x, z);
    const t = new Turret(this.physics, this.mats, x, y, z, facing);
    this.turrets.push(t);
    this.byCollider.set(t.collider.handle, t);
    this.group.add(t.group);
    markActor(t.group);
    return t;
  }

  /**
   * A few turrets around a point, on open dry ground, each facing it. `clear(x, z)` says whether
   * a spot is free of placed structures.
   */
  spawnAround(center: THREE.Vector3, count: number, clear: (x: number, z: number) => boolean): void {
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const a = ((i + Math.random() * 0.6) / count) * Math.PI * 2;
        const r = 28 + Math.random() * 14;
        const x = center.x + Math.sin(a) * r;
        const z = center.z + Math.cos(a) * r;
        const h = this.terrain.heightAt(x, z);
        if (h < this.terrain.waterLevel + 0.5 || !clear(x, z)) continue;
        // Reasonably level ground: the corners should sit near the centre's height.
        if (Math.abs(this.terrain.heightAt(x + 0.6, z) - h) > 0.35 || Math.abs(this.terrain.heightAt(x, z + 0.6) - h) > 0.35) continue;
        this.place(x, z, Math.atan2(center.x - x, center.z - z));
        break;
      }
    }
  }

  remove(t: Turret): void {
    const i = this.turrets.indexOf(t);
    if (i < 0) return;
    this.turrets.splice(i, 1);
    this.byCollider.delete(t.collider.handle);
    this.group.remove(t.group);
    t.dispose();
  }

  /** Take every turret away. */
  removeAll(): number {
    const n = this.turrets.length;
    for (const t of [...this.turrets]) this.remove(t);
    return n;
  }

  update(dt: number, target: TurretTarget, bolts: Bolts): void {
    for (const t of this.turrets) t.update(dt, target, bolts);
  }

  dispose(): void {
    for (const t of this.turrets) t.dispose();
    this.turrets.length = 0;
    this.byCollider.clear();
    this.mats.body.dispose();
    this.mats.dark.dispose();
  }
}
