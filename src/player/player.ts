import * as THREE from 'three';
import type { ThirdPersonCamera } from '../core/camera';
import type { Input } from '../core/input';
import type { World } from '../world/world';

const RUN_SPEED = 7.5;
const WALK_SPEED = 2.8;
const JUMP_HEIGHT = 1.7;
const RADIUS = 0.45;

const fwd = new THREE.Vector3();
const rgt = new THREE.Vector3();
const move = new THREE.Vector3();

interface Parts {
  hips: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  saber: THREE.Group;
  blade: THREE.Mesh;
  saberLight: THREE.PointLight;
}

function buildCharacter(): { group: THREE.Group; parts: Parts } {
  const robe = new THREE.MeshStandardMaterial({ color: 0xc9b58a, roughness: 0.9, flatShading: true });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a77a, roughness: 0.8, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.8 });

  const group = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  group.add(hips);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), robe);
  torso.position.y = 0.45;
  torso.castShadow = true;
  hips.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin);
  head.position.y = 0.98;
  head.castShadow = true;
  hips.add(head);

  const mkLimb = (len: number, r: number, mat: THREE.Material) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - r * 2, 3, 6), mat);
    m.position.y = -len / 2;
    m.castShadow = true;
    g.add(m);
    return g;
  };

  const leftLeg = mkLimb(0.95, 0.11, cloth);
  leftLeg.position.set(-0.14, 0, 0);
  const rightLeg = mkLimb(0.95, 0.11, cloth);
  rightLeg.position.set(0.14, 0, 0);
  hips.add(leftLeg, rightLeg);

  const leftArm = mkLimb(0.7, 0.08, robe);
  leftArm.position.set(-0.34, 0.72, 0);
  const rightArm = mkLimb(0.7, 0.08, robe);
  rightArm.position.set(0.34, 0.72, 0);
  hips.add(leftArm, rightArm);

  const saber = new THREE.Group();
  saber.position.set(0, -0.7, 0.05);
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.26, 8), metal);
  const blade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8).translate(0, 0.68, 0),
    new THREE.MeshBasicMaterial({ color: 0x8fd6ff, toneMapped: false }),
  );
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.009, 1.1, 6).translate(0, 0.68, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  );
  blade.add(core);
  const saberLight = new THREE.PointLight(0x66c8ff, 0, 7);
  saberLight.position.y = 0.6;
  saber.add(hilt, blade, saberLight);
  blade.visible = false;
  rightArm.add(saber);

  return { group, parts: { hips, torso, head, leftLeg, rightLeg, leftArm, rightArm, saber, blade, saberLight } };
}

export class Player {
  readonly group: THREE.Group;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  grounded = true;
  swimming = false;
  heading = 0;
  speedMultiplier = 1;
  saberOn = false;
  private phase = 0;
  private moveAmount = 0;
  private readonly parts: Parts;

  constructor(scene: THREE.Scene) {
    const { group, parts } = buildCharacter();
    this.group = group;
    this.parts = parts;
    scene.add(group);
  }

  reset(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.group.position.copy(p);
  }

  /** Launch the player into the air (used by Force Jump). */
  launch(vy: number, forwardBoost: number, cam: ThirdPersonCamera): void {
    this.vel.y = vy;
    cam.forward(fwd);
    this.vel.x += fwd.x * forwardBoost;
    this.vel.z += fwd.z * forwardBoost;
    this.grounded = false;
    this.pos.y += 0.05;
  }

  toggleSaber(): void {
    this.saberOn = !this.saberOn;
    this.parts.blade.visible = this.saberOn;
    this.parts.saberLight.intensity = this.saberOn ? 6 : 0;
  }

  update(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {
    const g = world.planet.gravity;
    const terrain = world.terrain;

    let mx = 0;
    let mz = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) mz += 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) mz -= 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) mx -= 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) mx += 1;

    cam.forward(fwd);
    cam.right(rgt);
    move.set(0, 0, 0).addScaledVector(fwd, mz).addScaledVector(rgt, mx);
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();

    const walking = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    let speed = (walking ? WALK_SPEED : RUN_SPEED) * this.speedMultiplier;
    if (this.swimming) speed *= 0.45;

    if (this.grounded) {
      this.vel.x = move.x * speed;
      this.vel.z = move.z * speed;
      if (input.isDown('Space') && !this.swimming) {
        this.vel.y = Math.sqrt(2 * g * JUMP_HEIGHT);
        this.grounded = false;
      }
    } else {
      const k = 1 - Math.exp(-dt * 2.5);
      this.vel.x += (move.x * speed - this.vel.x) * k;
      this.vel.z += (move.z * speed - this.vel.z) * k;
    }

    this.vel.y -= g * dt;
    this.pos.addScaledVector(this.vel, dt);

    for (const c of world.collidersNear(this.pos.x, this.pos.z, RADIUS)) {
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const minD = c.r + RADIUS;
      if (d < minD && d > 1e-4) {
        const push = (minD - d) / d;
        this.pos.x += dx * push;
        this.pos.z += dz * push;
      }
    }

    const ground = terrain.heightAt(this.pos.x, this.pos.z);
    const wade = terrain.waterLevel - 1.1;
    this.swimming = ground < wade;
    const floor = Math.max(ground, wade);
    if (this.pos.y <= floor) {
      this.pos.y = floor;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > floor + 0.02) {
      this.grounded = false;
    }

    if (moving) {
      const desired = Math.atan2(move.x, move.z);
      let diff = desired - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 14);
    }

    this.moveAmount += ((moving ? Math.min(1, speed / RUN_SPEED) : 0) - this.moveAmount) * Math.min(1, dt * 10);
    this.phase += dt * speed * (moving ? 1.9 : 0);
    this.animate(dt);

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
  }

  private animate(dt: number): void {
    const p = this.parts;
    const swing = Math.sin(this.phase) * 0.75 * this.moveAmount;
    if (this.grounded) {
      p.leftLeg.rotation.x = swing;
      p.rightLeg.rotation.x = -swing;
      p.leftArm.rotation.x = -swing * 0.8;
      p.rightArm.rotation.x = this.saberOn ? -0.9 : swing * 0.8;
      p.hips.position.y = 0.95 + Math.abs(Math.sin(this.phase)) * 0.05 * this.moveAmount;
      p.torso.rotation.x = 0.08 * this.moveAmount;
    } else {
      const k = Math.min(1, dt * 8);
      p.leftLeg.rotation.x += (0.5 - p.leftLeg.rotation.x) * k;
      p.rightLeg.rotation.x += (-0.35 - p.rightLeg.rotation.x) * k;
      p.leftArm.rotation.x += (-2.4 - p.leftArm.rotation.x) * k;
      p.rightArm.rotation.x += ((this.saberOn ? -1.4 : -2.4) - p.rightArm.rotation.x) * k;
      p.hips.position.y = 1.0;
    }
    p.rightArm.rotation.z = this.saberOn ? -0.25 : 0;
  }
}
