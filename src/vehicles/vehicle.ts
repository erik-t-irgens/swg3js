// Vehicles: one body kept up by hover springs or feet, driven by a spec that says how it handles.
// Four kinds, after what the game's models are: podracers and speeder bikes handle like Star
// Wars: Racer (fast, drifting, banking, a boost that heats or burns out), ground vehicles (walkers,
// animal mounts) turn in place and stay on their feet, flyers (landspeeders as flying cars, gunships
// and airspeeders as aircraft) climb and sink on Space and Ctrl and hold their height over the ground.
import * as THREE from 'three';
import { RAPIER, type Physics } from '../core/physics';

export type VehicleKind = 'podracer' | 'speederbike' | 'ground' | 'flyer';

export interface DriveInput {
  throttle: number;
  steer: number;
  boost: boolean;
  hop: boolean;
  /** Flyers: climb and sink. */
  up: boolean;
  down: boolean;
}

export interface VehicleSpec {
  id: string;
  label: string;
  kind: VehicleKind;
  /** The model's extent: half sizes and centre, in metres, as it stands. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  mass: number;
  /** Ride height above the ground, from the model's underside. */
  hover: number;
  maxSpeed: number;
  boostSpeed: number;
  reverseSpeed: number;
  accel: number;
  brake: number;
  /** Turn rate at full authority (rad/s), and the speed at which authority is full (0: turns in place). */
  turnRate: number;
  turnAuthorityAt: number;
  /** How fast sideways velocity bleeds off (1/s): low drifts, high grips. */
  grip: number;
  /** Roll into a turn at full steer and speed (rad). */
  bank: number;
  boost: 'none' | 'burst' | 'heat';
  hop: boolean;
  /** Flyers: vertical speed, the most height above the ground, and the least. */
  fly: { climb: number; ceiling: number; floor: number } | null;
  /** Where the rider sits, in the model's frame. */
  seat: [number, number, number];
}

/** The kind a vehicle is, from its name (the game's template or model name). Null when nothing fits. */
export function vehicleKindOf(name: string): VehicleKind | null {
  const n = name.toLowerCase();
  if (/pod_?racer|podracer/.test(n)) return 'podracer';
  if (/speederbike|speeder_bike|swoop|stap|barc|flash_speeder|speeder_ric|ric_920/.test(n)) return 'speederbike';
  if (/at_st|at_rt|at_pt|at_xt|at_at|walker|mech|wheel_bike|droideka|tank|hailfire|atst/.test(n)) return 'ground';
  if (/jetpack|gunship|airspeeder|xj6|xj_6|starfighter|air_?speeder|flying/.test(n)) return 'flyer';
  if (/landspeeder|speeder|hover|skiff|levitator|koro|organa|tantive|usv5|v35|x31|x34|xp38|ab1|av21|sorob|lars|luke|bail/.test(n)) return 'flyer';
  return null;
}

/** Whether a flyer is a hover car (a landspeeder, a skiff) rather than an aircraft. */
export function isHoverCar(name: string): boolean {
  return !/jetpack|gunship|airspeeder|xj6|xj_6|starfighter|air_?speeder|flying/.test(name.toLowerCase());
}

/** The handling for a kind, sized to a model's bounds; `animal` marks a ground vehicle that is a mount rather than a machine. */
export function specFor(kind: VehicleKind, id: string, label: string, bounds: VehicleSpec['bounds'], { animal = false } = {}): VehicleSpec {
  const length = bounds.max[2] - bounds.min[2];
  const height = bounds.max[1] - bounds.min[1];
  const seat: [number, number, number] = [0, bounds.min[1] + height * 0.62, -length * 0.08];
  const base = { id, label, kind, bounds, seat, fly: null as VehicleSpec['fly'] };
  switch (kind) {
    case 'podracer':
      return { ...base, mass: 900, hover: 1.2, maxSpeed: 85, boostSpeed: 125, reverseSpeed: 6, accel: 30, brake: 45, turnRate: 1.7, turnAuthorityAt: 10, grip: 1.3, bank: 0.55, boost: 'heat', hop: false };
    case 'speederbike':
      return { ...base, mass: 320, hover: 0.9, maxSpeed: 42, boostSpeed: 60, reverseSpeed: 8, accel: 20, brake: 28, turnRate: 2.3, turnAuthorityAt: 5, grip: 2.8, bank: 0.45, boost: 'burst', hop: true };
    case 'ground':
      return animal
        ? { ...base, mass: 700, hover: 0.15, maxSpeed: 14, boostSpeed: 20, reverseSpeed: 3, accel: 8, brake: 14, turnRate: 1.6, turnAuthorityAt: 0, grip: 9, bank: 0, boost: 'burst', hop: true }
        : { ...base, mass: 2600, hover: 0.2, maxSpeed: 9, boostSpeed: 9, reverseSpeed: 3, accel: 5, brake: 10, turnRate: 1.1, turnAuthorityAt: 0, grip: 10, bank: 0, boost: 'none', hop: false };
    case 'flyer': {
      const hoverCar = isHoverCar(id);
      return {
        ...base,
        mass: 800,
        hover: 0.9,
        maxSpeed: hoverCar ? 45 : 70,
        boostSpeed: hoverCar ? 60 : 95,
        reverseSpeed: 8,
        accel: hoverCar ? 16 : 22,
        brake: 22,
        turnRate: 1.5,
        turnAuthorityAt: 4,
        grip: hoverCar ? 2.2 : 1.6,
        bank: 0.35,
        boost: 'burst',
        hop: false,
        // A flying car climbs slowly and not far; a gunship or an airspeeder is an aircraft.
        fly: hoverCar ? { climb: 6, ceiling: 60, floor: 0.9 } : { climb: 14, ceiling: 260, floor: 0.9 },
      };
    }
  }
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();
const up = new THREE.Vector3();
const fwd = new THREE.Vector3();
const p = new THREE.Vector3();
const rel = new THREE.Vector3();
const av = new THREE.Vector3();
const lv = new THREE.Vector3();
const tmp = new THREE.Vector3();
const lat = new THREE.Vector3();
const alpha = new THREE.Vector3();
const qInv = new THREE.Quaternion();
const torque = new THREE.Vector3();
const wantUp = new THREE.Vector3();

export class Vehicle {
  readonly group = new THREE.Group();
  readonly seat = new THREE.Object3D();
  readonly body: RAPIER.RigidBody;
  readonly pos = new THREE.Vector3();
  groundedPoints = 0;
  speed = 0;
  /** The boost meter: a burst's charge left, or a heat boost's heat, 0 to 1. */
  meter = 0;
  /** A heat boost that has burnt out: seconds until the engine comes back. */
  overheated = 0;
  boosting = false;
  /** Flyers: the height above the ground held, within the spec's floor and ceiling. */
  altitude = 0;
  private hopCd = 0;
  private readonly hoverPoints: THREE.Vector3[];
  /** The collider's centre in the model's frame, where the ground rays start (inside the body, so a buried corner still finds the ground). */
  private readonly centre: THREE.Vector3;
  /** The body's angular inertia about its own axes, so a torque can be asked for as a turning acceleration whatever the size. */
  private readonly inertia: THREE.Vector3;
  /** Half the footprint's longer side: the distance from the centre to the side, for mounting and placing. */
  readonly radius: number;
  /** Something to move with the vehicle (an animal's mixer, an engine glow). */
  onUpdate: ((dt: number, v: Vehicle, drive: DriveInput | null) => void) | null = null;

  constructor(readonly spec: VehicleSpec, model: THREE.Object3D, physics: Physics, scene: THREE.Scene, x: number, y: number, z: number, heading: number) {
    this.group.add(model);
    const b = spec.bounds;
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const l = b.max[2] - b.min[2];
    this.seat.position.set(spec.seat[0], spec.seat[1], spec.seat[2]);
    this.group.add(this.seat);
    scene.add(this.group);
    // Springs at the corners of the footprint, on the underside. The footprint is no smaller than a
    // bike's, so a tiny or mis-measured model still stands on a base wide enough to right it.
    const fw = Math.max(0.8, w);
    const fl = Math.max(1.6, l);
    this.hoverPoints = [
      new THREE.Vector3(-fw * 0.4, b.min[1], fl * 0.4),
      new THREE.Vector3(fw * 0.4, b.min[1], fl * 0.4),
      new THREE.Vector3(-fw * 0.4, b.min[1], -fl * 0.4),
      new THREE.Vector3(fw * 0.4, b.min[1], -fl * 0.4),
    ];
    this.meter = spec.boost === 'burst' ? 1 : 0;
    this.altitude = spec.fly ? spec.fly.floor : 0;
    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) })
        .setLinearDamping(0.12)
        .setAngularDamping(1.5)
        .setCcdEnabled(true),
    );
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    this.centre = new THREE.Vector3(cx, cy, cz);
    this.radius = Math.max(w, l) / 2;
    // A box's inertia, on extents no smaller than a bike's, so a tiny or a mis-measured model
    // still turns like a vehicle rather than a top.
    const ew = fw;
    const eh = Math.max(0.6, h);
    const el = fl;
    const m = spec.mass;
    this.inertia = new THREE.Vector3((m / 12) * (eh * eh + el * el), (m / 12) * (ew * ew + el * el), (m / 12) * (ew * ew + eh * eh));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(Math.max(0.2, w / 2), Math.max(0.15, h / 2), Math.max(0.3, l / 2))
        .setTranslation(cx, cy, cz)
        // The mass properties are in the collider's own frame, so the centre of mass is its centre.
        .setMassProperties(m, { x: 0, y: 0, z: 0 }, { x: this.inertia.x, y: this.inertia.y, z: this.inertia.z }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.4)
        .setRestitution(0.1),
      this.body,
    );
    this.pos.set(x, y, z);
  }

  quaternion(out: THREE.Quaternion): THREE.Quaternion {
    const r = this.body.rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }

  /** The speed as a share of the boosted top speed, for the HUD and the camera. */
  get speedShare(): number {
    return Math.min(1, Math.abs(this.speed) / this.spec.boostSpeed);
  }

  update(dt: number, physics: Physics, drive: DriveInput | null, groundAt?: (x: number, z: number) => number): void {
    const s = this.spec;
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
    const ride = s.hover + (s.fly ? this.altitude - s.fly.floor : 0);
    const k = (m * g) / (4 * Math.max(0.2, ride * 0.35));
    const c = 2 * Math.sqrt(k * (m / 4)) * 0.55;

    // Height: springs off the ground at the corners (hover kinds and feet alike), or, for a flyer
    // above its floor, a hold on the height over the terrain.
    this.groundedPoints = 0;
    const flying = !!s.fly && this.altitude > s.fly.floor + 0.05;
    const drop = this.centre.y - s.bounds.min[1];
    if (!flying) {
      for (const hp of this.hoverPoints) {
        p.copy(hp).applyQuaternion(q).add(this.pos);
        // The ray starts at the collider's centre height over the corner, so a corner pushed
        // into the ground still reads a (negative) distance and is lifted out.
        const hit = physics.groundDistance(p.x, p.y + drop, p.z, drop + ride * 2.2 + 0.5, body);
        const dist = hit === null ? null : hit - drop;
        if (dist === null || dist > ride * 1.6 + 0.3) continue;
        this.groundedPoints++;
        rel.copy(p).sub(this.pos);
        const vPointY = lv.y + tmp.crossVectors(av, rel).y;
        const f = Math.max(0, k * (ride - dist) - c * vPointY);
        body.addForceAtPoint({ x: 0, y: f, z: 0 }, { x: p.x, y: p.y, z: p.z }, true);
      }
    } else if (groundAt) {
      const ground = groundAt(this.pos.x, this.pos.z);
      const h = this.pos.y - s.bounds.min[1] - ground;
      const f = m * (g + 6 * (this.altitude - h) - 3.5 * lv.y);
      body.addForce({ x: 0, y: f, z: 0 }, true);
      this.groundedPoints = 4;
    }
    // The terrain's own height is a floor under everything: a fast vehicle can outrun the physics
    // ground being streamed in, and a spawn can land a hair inside a slope. Near or below that
    // height with nothing under the corners, hold the ride height off the terrain instead of falling.
    if (groundAt && this.groundedPoints < 2) {
      const ground = groundAt(this.pos.x, this.pos.z);
      const h = this.pos.y - s.bounds.min[1] - ground;
      if (h < ride * 1.6 + 0.3) {
        const f = m * Math.max(0, g + 6 * (ride - h) - 3.5 * lv.y);
        body.addForce({ x: 0, y: f, z: 0 }, true);
        this.groundedPoints = 4;
      }
    }
    const grounded = this.groundedPoints >= 2;

    // Attitude: upright, banked into the turn for the kinds that lean; damp the rest.
    const speedFwd = lv.dot(fwd);
    this.speed = speedFwd;
    const share = Math.min(1, Math.abs(speedFwd) / Math.max(1, s.maxSpeed));
    const steer = drive?.steer ?? 0;
    wantUp.copy(WORLD_UP);
    if (s.bank > 0 && steer !== 0) wantUp.applyAxisAngle(fwd, -steer * s.bank * share);
    // Torques are asked for as turning accelerations (rad/s²) and scaled by the inertia below, so
    // a barge and a bike right themselves alike; the rates stay well under the step's stability limit.
    alpha.crossVectors(up, wantUp).multiplyScalar(40);
    alpha.x -= av.x * 8;
    alpha.z -= av.z * 8;
    alpha.y = -av.y * 3;

    // The boost: a burst that recharges, or heat that builds while boosting (about four seconds'
    // worth) and, at the top, burns the engine out: a few seconds limping at a third of the power
    // with no boost, as a Racer pod does, and the heat has to fall before it can boost again.
    this.boosting = false;
    if (this.overheated > 0) this.overheated = Math.max(0, this.overheated - dt);
    const wantsBoost = !!drive && drive.boost && drive.throttle > 0 && this.overheated <= 0;
    if (s.boost === 'burst') {
      if (wantsBoost && this.meter > 0.02) {
        this.boosting = true;
        this.meter = Math.max(0, this.meter - dt * 0.45);
      } else this.meter = Math.min(1, this.meter + dt * 0.22);
    } else if (s.boost === 'heat') {
      if (wantsBoost && this.meter < 1) {
        this.boosting = true;
        this.meter = Math.min(1, this.meter + dt * 0.25);
        if (this.meter >= 1) {
          this.overheated = 3;
          this.boosting = false;
        }
      } else this.meter = Math.max(0, this.meter - dt * (this.overheated > 0 ? 0.2 : 0.35));
    }
    const power = this.overheated > 0 ? 0.35 : 1;

    if (drive) {
      if (drive.throttle > 0) {
        tmp.copy(fwd).multiplyScalar(m * s.accel * power * drive.throttle * (this.boosting ? 1.7 : 1) * (grounded ? 1 : 0.5));
        body.addForce({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
      } else if (drive.throttle < 0) {
        // Brake while rolling forward; reverse, slowly, once stopped.
        const wantsReverse = speedFwd < 1;
        const push = wantsReverse ? -s.accel * 0.4 * (Math.abs(speedFwd) < s.reverseSpeed ? 1 : 0) : -s.brake;
        tmp.copy(fwd).multiplyScalar(m * push);
        body.addForce({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
      }
      if (steer !== 0) {
        // Steer toward a yaw rate: the spec's turn rate, with less authority below the speed the
        // control surfaces bite at, and a wider turn again once boosting past the top speed.
        const authority = s.turnAuthorityAt <= 0 ? 1 : THREE.MathUtils.clamp(Math.abs(speedFwd) / s.turnAuthorityAt, 0.3, 1);
        const wide = 1 - 0.3 * THREE.MathUtils.clamp((Math.abs(speedFwd) - s.maxSpeed) / Math.max(1, s.boostSpeed - s.maxSpeed), 0, 1);
        const sign = speedFwd < -0.5 ? -1 : 1;
        const want = -steer * s.turnRate * authority * wide * sign;
        alpha.y = (want - av.y) * 8;
      }
      if (drive.hop && s.hop && grounded && this.hopCd <= 0) {
        body.applyImpulse({ x: 0, y: m * 7.5, z: 0 }, true);
        this.hopCd = 0.9;
      }
      if (s.fly) {
        if (drive.up) this.altitude = Math.min(s.fly.ceiling, this.altitude + s.fly.climb * dt);
        if (drive.down) this.altitude = Math.max(s.fly.floor, this.altitude - s.fly.climb * dt);
      }
    } else if (s.fly && !drive) this.altitude = Math.max(s.fly.floor, this.altitude - s.fly.climb * 0.5 * dt);
    // Torque = inertia × acceleration, about the body's own axes.
    torque.copy(alpha).applyQuaternion(qInv.copy(q).invert()).multiply(this.inertia).applyQuaternion(q);
    body.addTorque({ x: torque.x, y: torque.y, z: torque.z }, true);

    // Grip: sideways speed is turned back into forward speed at the spec's rate (a turn redirects
    // the vehicle rather than scrubbing its speed off), with a little of it lost to the slide. A pod
    // drifts wide, a bike bites, a walker does not slide at all; in the air there is little to grip.
    lat.copy(lv).addScaledVector(fwd, -speedFwd).setY(0);
    const gripRate = Math.min(1 / dt, grounded ? s.grip : s.grip * 0.15);
    tmp.copy(lat).multiplyScalar(-m * gripRate).addScaledVector(fwd, lat.length() * m * gripRate * 0.85 * Math.sign(speedFwd || 1));
    body.addForce({ x: tmp.x, y: tmp.y, z: tmp.z }, true);

    // Drag when coasting.
    if (!drive || drive.throttle === 0) {
      tmp.copy(fwd).multiplyScalar(-speedFwd * m * (grounded ? 0.9 : 0.15));
      body.addForce({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
    }

    const hSpeed = Math.hypot(lv.x, lv.z);
    const maxSpeed = (this.boosting ? s.boostSpeed : s.maxSpeed) * (this.overheated > 0 ? 0.6 : 1);
    if (hSpeed > maxSpeed) {
      const sc = maxSpeed / hSpeed;
      body.setLinvel({ x: lv.x * sc, y: lv.y, z: lv.z * sc }, true);
    }

    this.group.position.copy(this.pos);
    this.group.quaternion.copy(q);
    this.onUpdate?.(dt, this, drive);
  }

  dispose(physics: Physics, scene: THREE.Scene): void {
    physics.world.removeRigidBody(this.body);
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !(m.userData.shared as boolean | undefined)) m.geometry.dispose();
    });
  }
}
