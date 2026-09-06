import * as THREE from 'three';
import type { PlanetDef } from '../data/planets';
import type { Terrain } from './terrain';

const tmp = new THREE.Vector3();

export class Creature {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  heading = Math.random() * Math.PI * 2;
  grounded = true;
  stunned = 0;
  tumble = 0;
  private retarget = 0;
  private phase = Math.random() * 10;
  private readonly legs: THREE.Object3D[] = [];
  private readonly body: THREE.Object3D;

  constructor(readonly def: PlanetDef['creatures'], mat: THREE.Material) {
    const s = def.size;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 0.6 * s, 1.6 * s), mat);
    body.position.y = 0.75 * s;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.45 * s, 0.6 * s), mat);
    head.position.set(0, 0.95 * s, 0.95 * s);
    head.castShadow = true;
    this.body = new THREE.Group();
    this.body.add(body, head);
    this.group.add(this.body);
    const legGeo = new THREE.BoxGeometry(0.2 * s, 0.6 * s, 0.2 * s).translate(0, -0.3 * s, 0);
    for (const [lx, lz] of [[-0.3, 0.55], [0.3, 0.55], [-0.3, -0.55], [0.3, -0.55]]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(lx * s, 0.6 * s, lz * s);
      leg.castShadow = true;
      this.group.add(leg);
      this.legs.push(leg);
    }
  }

  place(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.target.copy(this.pos);
    this.retarget = 0;
  }

  update(dt: number, terrain: Terrain, gravity: number, playerPos: THREE.Vector3): void {
    const ground = Math.max(terrain.heightAt(this.pos.x, this.pos.z), terrain.waterLevel - 0.5);
    this.stunned = Math.max(0, this.stunned - dt);

    if (!this.grounded) {
      this.vel.y -= gravity * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.tumble += dt * 6;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.grounded = true;
        this.vel.set(0, 0, 0);
        this.tumble = 0;
        this.stunned = Math.max(this.stunned, 0.6);
      }
    } else {
      this.pos.y = ground;
      this.retarget -= dt;
      const toPlayer = tmp.copy(this.pos).sub(playerPos);
      const dist = toPlayer.length();
      const flee = dist < 6 * this.def.size && this.def.speed > 3;
      if (this.retarget <= 0 || (flee && this.retarget > 1)) {
        const angle = flee ? Math.atan2(toPlayer.x, toPlayer.z) + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
        const range = flee ? 25 : 12 + Math.random() * 30;
        this.target.set(this.pos.x + Math.sin(angle) * range, 0, this.pos.z + Math.cos(angle) * range);
        this.retarget = 2 + Math.random() * 5;
      }
      if (this.stunned <= 0) {
        const dx = this.target.x - this.pos.x;
        const dz = this.target.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1.5) {
          const desired = Math.atan2(dx, dz);
          let diff = desired - this.heading;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          this.heading += diff * Math.min(1, dt * 3);
          const speed = (flee ? this.def.speed * 1.6 : this.def.speed) * (this.retarget > 1.5 ? 1 : 0.5);
          const nx = this.pos.x + Math.sin(this.heading) * speed * dt;
          const nz = this.pos.z + Math.cos(this.heading) * speed * dt;
          if (terrain.heightAt(nx, nz) > terrain.waterLevel - 0.3) {
            this.pos.x = nx;
            this.pos.z = nz;
          } else {
            this.retarget = 0;
          }
          this.phase += dt * speed * 2.5;
        }
      }
    }

    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.heading, 0);
    if (this.tumble > 0) this.group.rotation.x = this.tumble;
    const swing = Math.sin(this.phase) * 0.55;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.legs[2].rotation.x = -swing;
    this.legs[3].rotation.x = swing;
    this.body.position.y = this.stunned > 0 && this.grounded ? Math.sin(this.stunned * 60) * 0.04 : 0;
  }

  knock(dir: THREE.Vector3, power: number): void {
    const massScale = 1 / Math.sqrt(this.def.size);
    this.vel.copy(dir).multiplyScalar(power * massScale);
    this.vel.y = power * 0.55 * massScale;
    this.grounded = false;
    this.pos.y += 0.05;
  }
}

export class CreatureManager {
  readonly group = new THREE.Group();
  readonly creatures: Creature[] = [];
  private readonly mat: THREE.MeshStandardMaterial;

  constructor(private readonly planet: PlanetDef, private readonly terrain: Terrain) {
    this.mat = new THREE.MeshStandardMaterial({ color: planet.creatures.color, flatShading: true, roughness: 0.9 });
  }

  spawnAround(center: THREE.Vector3): void {
    for (let i = 0; i < this.planet.creatures.count; i++) {
      const c = new Creature(this.planet.creatures, this.mat);
      this.respawn(c, center);
      this.creatures.push(c);
      this.group.add(c.group);
    }
  }

  private respawn(c: Creature, center: THREE.Vector3): void {
    for (let attempt = 0; attempt < 20; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = 35 + Math.random() * 90;
      const x = center.x + Math.sin(a) * r;
      const z = center.z + Math.cos(a) * r;
      const h = this.terrain.heightAt(x, z);
      if (h > this.terrain.waterLevel + 0.5) {
        c.place(x, h, z);
        return;
      }
    }
    c.place(center.x, this.terrain.heightAt(center.x, center.z), center.z);
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    for (const c of this.creatures) {
      if (c.pos.distanceTo(playerPos) > 260) this.respawn(c, playerPos);
      c.update(dt, this.terrain, this.planet.gravity, playerPos);
    }
  }

  dispose(): void {
    this.mat.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
