import * as THREE from 'three';
import { RAPIER, type Physics } from '../core/physics';

export interface DriveInput {
  throttle: number;
  steer: number;
  boost: boolean;
  hop: boolean;
}

const HOVER_HEIGHT = 1.0;
const MASS = 320;
const HOVER_POINTS = [
  new THREE.Vector3(-0.5, 0, 1.2),
  new THREE.Vector3(0.5, 0, 1.2),
  new THREE.Vector3(-0.5, 0, -1.2),
  new THREE.Vector3(0.5, 0, -1.2),
];
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const q = new THREE.Quaternion();
const up = new THREE.Vector3();
const fwd = new THREE.Vector3();
const p = new THREE.Vector3();
const rel = new THREE.Vector3();
const av = new THREE.Vector3();
const lv = new THREE.Vector3();
const tmp = new THREE.Vector3();
const torque = new THREE.Vector3();

/** A hover speeder bike: a dynamic body kept aloft by four spring ray casts. */
export class Speeder {
  readonly group = new THREE.Group();
  readonly seat = new THREE.Object3D();
  readonly body: RAPIER.RigidBody;
  readonly pos = new THREE.Vector3();
  groundedPoints = 0;
  speed = 0;
  private hopCd = 0;
  private readonly glows: THREE.Mesh[] = [];

  constructor(physics: Physics, scene: THREE.Scene, x: number, y: number, z: number, heading: number) {
    const hull = new THREE.MeshStandardMaterial({ color: 0xb35a2a, roughness: 0.6, metalness: 0.3, flatShading: true });
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.5, metalness: 0.7, flatShading: true });
    const glow = new THREE.MeshBasicMaterial({ color: 0x4fd0ff, toneMapped: false });

    const main = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 2.6), hull);
    main.position.y = 0.5;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 6).rotateX(Math.PI / 2), hull);
    nose.position.set(0, 0.5, 1.9);
    const seatMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.9), metal);
    seatMesh.position.set(0, 0.8, -0.4);
    const bars = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.06), metal);
    bars.position.set(0, 0.95, 0.5);
    this.group.add(main, nose, seatMesh, bars);
    for (const sx of [-1, 1]) {
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.07, 0.5), hull);
      vane.position.set(sx * 0.75, 0.42, 1.4);
      vane.rotation.z = sx * 0.15;
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.9, 8).rotateX(Math.PI / 2), metal);
      engine.position.set(sx * 0.38, 0.45, -1.55);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.17, 12), glow);
      disc.position.set(sx * 0.38, 0.45, -2.01);
      disc.rotation.y = Math.PI;
      this.group.add(vane, engine, disc);
      this.glows.push(disc);
    }
    this.group.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    this.seat.position.set(0, 0.86, -0.35);
    this.group.add(this.seat);
    scene.add(this.group);

    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) })
        .setLinearDamping(0.12)
        .setAngularDamping(1.5)
        .setCcdEnabled(true),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.55, 0.35, 1.5).setTranslation(0, 0.45, 0).setMass(MASS).setFriction(0.4).setRestitution(0.1), this.body);
    this.pos.set(x, y, z);
  }

  quaternion(out: THREE.Quaternion): THREE.Quaternion {
    const r = this.body.rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }

  update(dt: number, physics: Physics, drive: DriveInput | null): void {
    const body = this.body;
    body.resetForces(true);
    body.resetTorques(true);
    this.hopCd = Math.max(0, this.hopCd - dt);

    const t = body.translation();
    this.pos.set(t.x, t.y, t.z);
    this.quaternion(q);
    const l = body.linvel();
    const a = body.angvel();
    lv.set(l.x, l.y, l.z);
    av.set(a.x, a.y, a.z);
    up.copy(WORLD_UP).applyQuaternion(q);
    fwd.set(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    const m = body.mass();
    const g = -physics.world.gravity.y;
    const k = (m * g) / (4 * 0.35);
    const c = 2 * Math.sqrt(k * (m / 4)) * 0.55;

    this.groundedPoints = 0;
    for (const hp of HOVER_POINTS) {
      p.copy(hp).applyQuaternion(q).add(this.pos);
      const dist = physics.groundDistance(p.x, p.y, p.z, HOVER_HEIGHT * 2.2, body);
      if (dist === null || dist > HOVER_HEIGHT * 1.6) continue;
      this.groundedPoints++;
      rel.copy(p).sub(this.pos);
      const vPointY = lv.y + tmp.crossVectors(av, rel).y;
      const f = Math.max(0, k * (HOVER_HEIGHT - dist) - c * vPointY);
      body.addForceAtPoint({ x: 0, y: f, z: 0 }, { x: p.x, y: p.y, z: p.z }, true);
    }

    // Keep upright, damp roll and pitch, damp yaw.
    torque.crossVectors(up, WORLD_UP).multiplyScalar(m * 45);
    torque.x -= av.x * m * 6;
    torque.z -= av.z * m * 6;
    torque.y -= av.y * m * 2.2;

    const speedFwd = lv.dot(fwd);
    this.speed = speedFwd;
    const grounded = this.groundedPoints >= 2;
    let boost = false;
    if (drive) {
      boost = drive.boost && drive.throttle > 0;
      if (drive.throttle > 0) {
        tmp.copy(fwd).multiplyScalar(m * 15 * drive.throttle * (boost ? 1.8 : 1) * (grounded ? 1 : 0.5));
        body.addForce({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
      } else if (drive.throttle < 0) {
        const brake = speedFwd > 1 ? -22 : 7 * drive.throttle;
        tmp.copy(fwd).multiplyScalar(m * brake);
        body.addForce({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
      }
      if (drive.steer !== 0) {
        const authority = THREE.MathUtils.clamp(Math.abs(speedFwd) / 6, 0.3, 1) * (speedFwd < -0.5 ? -1 : 1);
        torque.y -= drive.steer * m * 8 * authority;
      }
      if (drive.hop && grounded && this.hopCd <= 0) {
        body.applyImpulse({ x: 0, y: m * 7.5, z: 0 }, true);
        this.hopCd = 0.9;
      }
    }
    body.addTorque({ x: torque.x, y: torque.y, z: torque.z }, true);

    // Lateral grip: bleed off sideways velocity so it steers instead of skating.
    tmp.copy(lv).addScaledVector(fwd, -speedFwd).setY(0).multiplyScalar(-m * (grounded ? 3.2 : 0.4));
    body.addForce({ x: tmp.x, y: tmp.y, z: tmp.z }, true);

    // Engine drag: coast to a stop within a few seconds when the throttle is released.
    if (!drive || drive.throttle === 0) {
      tmp.copy(fwd).multiplyScalar(-speedFwd * m * (grounded ? 0.9 : 0.15));
      body.addForce({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
    }

    const hSpeed = Math.hypot(lv.x, lv.z);
    const maxSpeed = boost ? 44 : 30;
    if (hSpeed > maxSpeed) {
      const s = maxSpeed / hSpeed;
      body.setLinvel({ x: lv.x * s, y: lv.y, z: lv.z * s }, true);
    }

    this.group.position.copy(this.pos);
    this.group.quaternion.copy(q);
    const glowScale = 0.6 + Math.min(1, Math.abs(speedFwd) / 20) * 0.8 + (boost ? 0.4 : 0);
    for (const gl of this.glows) gl.scale.setScalar(glowScale);
  }

  dispose(physics: Physics, scene: THREE.Scene): void {
    physics.world.removeRigidBody(this.body);
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
