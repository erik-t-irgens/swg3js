// Vehicles: one body kept up by hover springs or feet, driven by a spec that says how it handles.
// Four kinds, after what the game's models are: podracers and speeder bikes handle like Star
// Wars: Racer (fast, drifting, banking, a boost that heats or burns out), ground vehicles (walkers,
// animal mounts) turn in place and stay on their feet, flyers (landspeeders as flying cars, gunships
// and airspeeders as aircraft) climb and sink on Space and Ctrl and hold their height over the ground.
import * as THREE from 'three';
import { cleanTrimesh, Group, groups, RAPIER, TRIMESH_FLAGS, type Physics } from '../core/physics';

/**
 * A vehicle's hull meets everything but the ground: the springs hold it off the terrain from
 * their own rays, and a hull that also collided with the heightfield dug its underside or its
 * feet into every slope the springs did not pitch it to, snagging and jolting there.
 */
const HULL_GROUPS = groups(Group.all, Group.all & ~Group.terrain);
import { cellIndexOf } from './interior';

export type VehicleKind = 'podracer' | 'speederbike' | 'ground' | 'flyer' | 'ship';

/** One engine's glow, for the effects that follow the exhaust (the heat haze). */
export interface EngineSpot {
  /** The glow, a child of the vehicle's group at the nozzle: its world matrix is where the exhaust leaves. */
  readonly object: THREE.Object3D;
  /** The glow's base size in metres, the one its sprite is scaled from. */
  readonly size: number;
  /** A fixed 0..1 offset of this engine's noise phase, so side-by-side engines do not shimmer alike. */
  readonly seed: number;
}

export interface DriveInput {
  throttle: number;
  /** Steering from the keys, -1 left to 1 right; added to any steering toward `heading`. */
  steer: number;
  /** A heading (rad, the vehicle's own convention) to turn toward: the camera's, so the mouse steers. */
  heading?: number | null;
  boost: boolean;
  hop: boolean;
  /** Flyers: climb and sink from the keys, and a rate from the mouse's pitch (-1 sink to 1 climb). */
  up: boolean;
  down: boolean;
  vertical?: number;
  /** Ships: the mouse's movement this step (pixels), which pitches and turns the ship directly. */
  lookDX?: number;
  lookDY?: number;
  /** A hovering ship: sideways, -1 left to 1 right, as a VTOL slides. */
  strafe?: number;
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
  /** A living mount: it swims chest-deep rather than floating, and kicks up no dust. */
  animal: boolean;
  /** A starship: flies free of the ground once it has speed (a first flight model), lands as a flyer. */
  ship?: boolean;
  /** A ship's turning inertia: seconds for a turn to build up or die away after the stick moves. */
  inertia?: number;
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
  const base = { id, label, kind, bounds, seat, fly: null as VehicleSpec['fly'], animal };
  switch (kind) {
    case 'podracer':
      return { ...base, mass: 900, hover: 1.2, maxSpeed: 85, boostSpeed: 125, reverseSpeed: 6, accel: 30, brake: 45, turnRate: 1.7, turnAuthorityAt: 10, grip: 1.3, bank: 0.55, boost: 'heat', hop: false };
    case 'speederbike':
      // A bike past 75 km/h is unruly on this ground: 65 flat out, 75 on the boost.
      return { ...base, mass: 320, hover: 0.65, maxSpeed: 18, boostSpeed: 21, reverseSpeed: 6, accel: 14, brake: 24, turnRate: 2.3, turnAuthorityAt: 4, grip: 2.8, bank: 0.45, boost: 'burst', hop: true };
    case 'ground':
      return animal
        ? { ...base, mass: 700, hover: 0.15, maxSpeed: 14, boostSpeed: 20, reverseSpeed: 3, accel: 8, brake: 14, turnRate: 1.6, turnAuthorityAt: 0, grip: 9, bank: 0, boost: 'burst', hop: true }
        : { ...base, mass: 2600, hover: 0.2, maxSpeed: 9, boostSpeed: 9, reverseSpeed: 3, accel: 5, brake: 10, turnRate: 1.1, turnAuthorityAt: 0, grip: 10, bank: 0, boost: 'none', hop: false };
    case 'flyer': {
      const hoverCar = isHoverCar(id);
      return {
        ...base,
        mass: 800,
        hover: 0.5,
        // A landspeeder keeps to the bikes' pace; an aircraft flies.
        maxSpeed: hoverCar ? 17 : 70,
        boostSpeed: hoverCar ? 21 : 95,
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
        fly: hoverCar ? { climb: 6, ceiling: 60, floor: 0.5 } : { climb: 14, ceiling: 260, floor: 0.5 },
      };
    }
    case 'ship': {
      // Sized by length: a fighter is nimble, a freighter ponderous. Speeds are what the ground can
      // show; space flight is for later.
      const big = length > 18;
      return {
        ...base,
        ship: true,
        inertia: big ? 1.4 : 0.55,
        mass: big ? 40000 : 9000,
        hover: 1.5,
        maxSpeed: big ? 90 : 140,
        boostSpeed: big ? 130 : 220,
        reverseSpeed: 6,
        accel: big ? 14 : 30,
        brake: big ? 18 : 40,
        turnRate: big ? 0.5 : 1.1,
        turnAuthorityAt: 0,
        grip: 1,
        bank: big ? 0.5 : 1.0,
        boost: 'burst',
        hop: false,
        // Hovering, the ship rises and sinks on the keys at a VTOL's pace; in flight the stick has it.
        fly: { climb: big ? 6 : 10, ceiling: 1500, floor: 1.5 },
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
const e = new THREE.Euler();
const qTmp = new THREE.Quaternion();
const axis = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const torque = new THREE.Vector3();
const wingTurn = new THREE.Matrix4();
const wantUp = new THREE.Vector3();
const right = new THREE.Vector3();
/** Velocity lost in one step past which a vehicle has hit something (m/s), and the hull taken per m/s beyond it. */
const HIT_THRESHOLD = 6;
const HIT_DAMAGE = 4;
/** Speed (m/s) a step may take off a flying hull before it counts as having hit something, and how long the contacts then have it. */
/** A hover machine in the air: the share of its weight the repulsor still carries, the fall (m/s) it settles to, and how high over the ground it still does so. */
const GLIDE_LIFT = 0.5;
const GLIDE_FALL = 5;
const GLIDE_CEILING = 30;
const SHIP_HIT_LOSS = 5;
const SHIP_HIT_FREE = 0.4;
/** How much of the ground's slope a hover kind takes on: 1 lies flat on it, 0 stays level. */
const SLOPE_FOLLOW = 0.85;

export class Vehicle {
  readonly group = new THREE.Group();
  readonly seat = new THREE.Object3D();
  readonly body: RAPIER.RigidBody;
  readonly pos = new THREE.Vector3();
  groundedPoints = 0;
  speed = 0;
  /** The steering in effect this step, -1 left to 1 right, keys and mouse together. */
  steer = 0;
  /** Over water rather than ground this step. */
  onWater = false;
  /** A ship: the speed the throttle has built (m/s), and its attitude in flight (free to roll and loop). */
  cruise = 0;
  readonly attitude = new THREE.Quaternion();
  /** The virtual stick the mouse moves (-1 to 1, self-centring) and the turning rates it has built (rad/s). */
  readonly stick = new THREE.Vector2();
  readonly spin = new THREE.Vector3();
  /** A ship in free flight this step (not on its landing gear). */
  airborne = false;
  /** A ship that just flew into the ground: the speed it hit at, read once by the game for the damage. */
  crashed = 0;
  /** A pod racer's cockpit as guessed from its mesh, where the pilot's pelvis goes when the game's own seat lands outside the pod. */
  podSeat: [number, number, number] | null = null;
  /** Whether the seat has been checked against the box once (the rider logs what it found). */
  seatChecked = false;
  /** On its back now, and for long enough that the rider is thrown. */
  upsideDown = false;
  flipped = false;
  private overFor = 0;

  /** Turn a machine on its back the right way up where it lies (E on it), as a Halo warthog is flipped. */
  rightSelf(): void {
    const s = this.spec;
    e.set(0, this.heading, 0, 'YXZ');
    q.setFromEuler(e);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    const height = s.bounds.max[1] - s.bounds.min[1];
    this.pos.y += height * 0.5 + s.hover;
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.overFor = 0;
    this.flipped = false;
    this.upsideDown = false;
    this.skipHitCheck = true;
  }
  /** The cockpit, in the model's frame, for the first-person view: a hardpoint's place or the front of the hull. */
  cockpit: [number, number, number] | null = null;
  /** The boost meter: a burst's charge left, or a heat boost's heat, 0 to 1. */
  meter = 0;
  /** A heat boost that has burnt out: seconds until the engine comes back. */
  overheated = 0;
  boosting = false;
  /** Flyers: the height above the ground held, within the spec's floor and ceiling. */
  altitude = 0;
  /** The hull's condition: hard hits take from it, and at nothing the vehicle is done for. */
  hp = 100;
  readonly maxHp = 100;
  /** The speed lost in a hard hit this step (m/s), read once by the game for the sparks and the damage shown; 0 otherwise. */
  justHit = 0;
  /** In flight, the velocity the last step was told to fly at; what the step took off it is a hit. */
  private readonly commanded = new THREE.Vector3();
  private commandedValid = false;
  /** Seconds left in which the contacts, not the throttle, have the hull after a hit. */
  private hitCooldown = 0;
  /** At no hull left: the game blows it up and takes the rider off. */
  get destroyed(): boolean {
    return this.hp <= 0;
  }
  private readonly prevVel = new THREE.Vector3();
  private prevVelValid = false;
  /** A step whose own impulse (a hop, a spawn) must not read as a hit. */
  private skipHitCheck = true;
  private hopCd = 0;
  private readonly hoverPoints: THREE.Vector3[];
  /** The collider's centre in the model's frame, where the ground rays start (inside the body, so a buried corner still finds the ground). */
  private readonly centre: THREE.Vector3;
  /** The body's angular inertia about its own axes, so a torque can be asked for as a turning acceleration whatever the size. */
  private readonly inertia: THREE.Vector3;
  /** Half the footprint's longer side: the distance from the centre to the side, for mounting and placing. */
  readonly radius: number;
  /** The game's hardpoint names the model carries (hp:<name> nodes), for finding seats and engines. */
  hardpoints: string[] = [];
  /** Something to move with the vehicle (an animal's mixer, an engine glow). */
  onUpdate: ((dt: number, v: Vehicle, drive: DriveInput | null) => void) | null = null;
  /** A ship's interior, a room of its own inside the hull, once loaded. */
  interior: import('./interior').ShipInterior | null = null;
  /** The cockpit frame drawn around the pilot (the game's cockpit file), hung in the hull at the cockpit point; shown while someone is at the controls. */
  cockpitFrame: THREE.Object3D | null = null;
  /** The first-person view's offset from the cockpit point, from the cockpit file (its 1OFF, X mirrored as the converter mirrors the model). */
  cockpitOffset: [number, number, number] = [0, 0, 0];
  /** A ship from the ships pack: the pilot's eyes go to the cockpit eye (cockpitEye()) and the body sits on the seat under it. */
  eyeSeat = false;
  /** Where the cockpit eye came from, for the console: 'hp:camera', 'frame middle', 'bridge', 'hardpoint <name>' or 'hull'. */
  eyeSource = 'hull';
  /** How far under the cockpit eye (with 1OFF) the frame's seat cushion is, metres; null: none found, the body hangs from the eye. */
  seatDrop: number | null = null;
  /** A seated rider not drawn: a ship without a cockpit frame, where the game never drew a pilot. */
  riderHidden = false;
  /** A correction of the body under the eye, in the hull's frame: the frame's COCKPIT_BODY_NUDGE, then __debug.seat's. The eye stays put. Lost when the hull is spawned again (travel, respawn). */
  readonly bodyNudge: [number, number, number] = [0, 0, 0];
  /** Appearances shown only while the drive runs (the game's "engine on" attachments). */
  engineParts: THREE.Object3D[] = [];
  /** The exhaust ribbons behind a ship in flight, in the world. */
  trails: import('./trail').EngineTrail[] = [];
  /** The engines' glow spots (empty for an animal), for the heat haze. The exhaust leaves along the group's -Z, the nose being +Z. */
  readonly engines: EngineSpot[] = [];
  /** How hard the engines run this step: 0 off, 1 flat out, up to 1.6 boosting; halved while overheated. Set by the glow's update. */
  engineHeat = 0;
  /** The exhaust noise's flow phase, advanced with the plume's own flow (0..1). */
  enginePhase = Math.random();
  /** A ship's guns: where each fires from and the way it points, in the model's frame, from the weapon hardpoints. */
  guns: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  /** Seconds until the guns can fire again, and which gun fires next. */
  gunCooldown = 0;
  gunNext = 0;
  /** The colour of the ship's bolts: green for the Empire's, red for everyone else's. */
  boltColor = 0xff4a2a;
  /** How the rider sits, the game's rider pose (vehicle_speeder_bike, saddle_body2_wide, space_sitting): the riding clip's selector value. */
  riderPose: string | null = null;
  /** The garage entry this was spawned from, so it can be spawned again elsewhere (a ship carried into space). */
  def: import('./garage').VehicleDef | null = null;
  /** In a space zone: no ceiling, no landing, twice the speed. */
  space = false;
  /**
   * The seat is where the rider's pelvis goes rather than the rider's origin: the riding clip's
   * own root offset is taken off, so a pose authored for a chair whose origin is under the seat
   * (space_sitting, half a metre below the pelvis) still lands the pelvis on the seat. A vehicle
   * from the game keeps the game's own convention: the rider at the vehicle's origin, the clip's
   * root offset placing the pelvis (a speeder bike's rider hardpoint is exactly its clip's root).
   */
  seatPelvis = false;
  /** The seat rides a bone of the model's skeleton (an animal's back), so the rider moves with its gait; its world turn is then the rider's. */
  seatFollows = false;
  /** A mount's saddle model, hung on the creature (hidden by the world until its shaders are ready). */
  saddle: THREE.Object3D | null = null;
  /** How the rider's seat was found (a creature's): its saddle hardpoint, its own rider point, a guessed saddle, or the back alone. */
  seatFrom: import('./saddle').SeatFrom | null = null;
  /** The gun a ship fires, from the game's weapon table: its projectile (an index into the projectile table), speed and range in metres. */
  weapon: { name: string; projectile: number; speed: number; range: number } | null = null;
  /** The handles of the body's colliders, so a bolt's hit can be traced back to the vehicle. */
  readonly colliderHandles: number[] = [];
  /** Damage taken from bolts since the game last looked (read once by the game, for the pilot's jolt). */
  struck = 0;
  /**
   * Wings that open: the game's fighters carry them as separate objects modelled in the hull's
   * frame, turned about a hinge by an angle when the ship flies. Each keeps its node's resting
   * matrix, the hinge's frame and its inverse, and how far and how fast it opens.
   */
  readonly wings: { node: THREE.Object3D; base: THREE.Matrix4; hinge: THREE.Matrix4; hingeInverse: THREE.Matrix4; angle: number; time: number }[] = [];
  /** How far the wings are open, 0 closed to 1 open; open in flight, closed on the ground. */
  wingsOpen = 0;
  /** Whether someone is in the hull's rooms; with a pilot at the controls, what clears the glass. */
  occupied = false;
  /**
   * The hull's window panes (glass marked by the converter): each with its solid material, the
   * game's own for a hull with nobody in it, and a clear copy shown while someone is aboard or
   * at the controls, so those outside see in. The clear copies ride on hidden stand-in meshes
   * so the background compile has their shaders ready before the first boarding.
   */
  readonly panes: { mesh: THREE.Mesh; index: number; solid: THREE.Material; clear: THREE.Material }[] = [];
  private glassClear = false;
  /** Let go: no springs, no righting, no gravity; the body keeps whatever motion it was given (for testing the room inside). */
  drift = false;

  constructor(readonly spec: VehicleSpec, model: THREE.Object3D, physics: Physics, scene: THREE.Scene, x: number, y: number, z: number, heading: number) {
    this.group.add(model);
    // Whether it weathers is not marked here: the spawn kind can differ from the model's (the
    // garage's "as…"), and the material scan judges a shared material once for every copy, so the
    // garage marks a ship's own materials dry when it loads the model, and a ground vehicle's stay wettable.
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
    if (spec.ship) this.cockpit = [0, b.min[1] + h * 0.7, b.min[2] + l * 0.72];
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
    // The collision is the model's own triangles (a machine's hull, a portal building's shell:
    // the rooms inside it have a world of their own), so a figure walking up to a ship meets its
    // skin, not a box around it. The mass is the box's, on the first piece; the rest weigh nothing.
    // An animal keeps the box: its mesh is skinned and moves with its clips.
    const mass = { m, inertia: this.inertia, centre: { x: cx, y: cy, z: cz } };
    const pieces = spec.animal ? 0 : this.hullColliders(model, world, mass);
    if (!pieces) {
      const box = world.createCollider(
        RAPIER.ColliderDesc.cuboid(Math.max(0.2, w / 2), Math.max(0.15, h / 2), Math.max(0.3, l / 2))
          .setTranslation(cx, cy, cz)
          // The mass properties are in the collider's own frame, so the centre of mass is its centre.
          .setMassProperties(m, { x: 0, y: 0, z: 0 }, { x: this.inertia.x, y: this.inertia.y, z: this.inertia.z }, { x: 0, y: 0, z: 0, w: 1 })
          .setFriction(0.4)
          .setRestitution(0.1)
          .setCollisionGroups(HULL_GROUPS),
        this.body,
      );
      this.colliderHandles.push(box.handle);
    }
    this.pos.set(x, y, z);
  }

  /** Half the hull's height, as a bolt's target (the Hittable contract). */
  get halfHeight(): number {
    return (this.spec.bounds.max[1] - this.spec.bounds.min[1]) / 2;
  }

  get dead(): boolean {
    return this.destroyed;
  }

  /** A bolt's hit: the hull takes it (a vehicle is too heavy for a bolt to shove). */
  damage(amount: number): void {
    if (this.destroyed) return;
    this.hp = Math.max(0, this.hp - amount);
    this.struck += amount;
  }

  /**
   * The wings open in flight and close on the ground, each turned about its hinge's Z by its
   * angle over its time, the way the client turns the wing objects it hangs on the hull.
   */
  private updateWings(dt: number): void {
    if (!this.wings.length) return;
    const want = this.airborne ? 1 : 0;
    if (this.wingsOpen === want && this.wingsSettled) return;
    for (const w of this.wings) {
      const rate = dt / Math.max(0.1, w.time);
      this.wingsOpen += THREE.MathUtils.clamp(want - this.wingsOpen, -rate, rate);
      wingTurn.makeRotationZ(w.angle * this.wingsOpen);
      w.node.matrix.copy(w.hinge).multiply(wingTurn).multiply(w.hingeInverse).multiply(w.base);
      w.node.matrixWorldNeedsUpdate = true;
    }
    this.wingsSettled = this.wingsOpen === want;
  }
  private wingsSettled = false;

  /**
   * Trimesh colliders on the body from the model's meshes in the vehicle's frame: every mesh of a
   * plain model, and of a portal building only the shell's (cell 0). Returns how many were made.
   */
  private hullColliders(model: THREE.Object3D, world: RAPIER.World, mass: { m: number; inertia: THREE.Vector3; centre: { x: number; y: number; z: number } }): number {
    this.group.updateMatrixWorld(true);
    const groupInverse = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    let pieces = 0;
    let triangles = 0;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || cellIndexOf(o) > 0) return;
      const posAttr = mesh.geometry.getAttribute('position');
      if (!posAttr || posAttr.count < 3 || posAttr.itemSize !== 3 || (posAttr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return;
      const idx = mesh.geometry.getIndex();
      const raw = idx ? new Uint32Array(idx.array as ArrayLike<number>) : Uint32Array.from({ length: posAttr.count - (posAttr.count % 3) }, (_, i) => i);
      const clean = cleanTrimesh(new Float32Array(posAttr.array as ArrayLike<number>), raw);
      if (!clean) return;
      const indices = clean.indices;
      new THREE.Matrix4().copy(groupInverse).multiply(mesh.matrixWorld).decompose(p, q, sc);
      let vertices = clean.vertices;
      if (Math.abs(sc.x - 1) > 1e-4 || Math.abs(sc.y - 1) > 1e-4 || Math.abs(sc.z - 1) > 1e-4) {
        // A scaled node: the scale goes into the vertices, since a collider has none.
        vertices = vertices.slice();
        for (let i = 0; i < vertices.length; i += 3) {
          vertices[i] *= sc.x;
          vertices[i + 1] *= sc.y;
          vertices[i + 2] *= sc.z;
        }
      }
      const desc = RAPIER.ColliderDesc.trimesh(vertices, indices, TRIMESH_FLAGS).setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.4).setRestitution(0.1).setCollisionGroups(HULL_GROUPS);
      // The mass properties are in the collider's own frame: the box's centre, moved back into it.
      if (pieces === 0) {
        const c = new THREE.Vector3(mass.centre.x, mass.centre.y, mass.centre.z).sub(p).applyQuaternion(q.clone().invert());
        desc.setMassProperties(mass.m, { x: c.x, y: c.y, z: c.z }, { x: mass.inertia.x, y: mass.inertia.y, z: mass.inertia.z }, { x: 0, y: 0, z: 0, w: 1 });
      } else desc.setDensity(0);
      this.colliderHandles.push(world.createCollider(desc, this.body).handle);
      pieces++;
      triangles += indices.length / 3;
    });
    if (pieces) console.info(`${this.spec.id}: hull collision from ${pieces} meshes, ${triangles} triangles`);
    return pieces;
  }

  /** Put a ship straight into flight at `speed` metres a second, on its present heading: arriving from another world in the air. */
  launch(speed: number): void {
    if (!this.spec.ship) return;
    this.cruise = speed;
    this.speed = speed;
    this.airborne = true;
    this.body.setGravityScale(0, true);
    this.quaternion(this.attitude);
    this.stick.set(0, 0);
    this.spin.set(0, 0, 0);
    this.skipHitCheck = true;
    fwd.set(0, 0, 1).applyQuaternion(this.attitude).multiplyScalar(speed);
    this.body.setLinvel({ x: fwd.x, y: fwd.y, z: fwd.z }, true);
  }

  /**
   * Where the first-person view sits, in the model's frame: the cockpit point with the cockpit file's offset. For a ship
   * from the ships pack with a cockpit frame this is the frame's own camera point plus 1OFF, the one eye used hovering
   * and flying alike (the seated pilot's eyes are placed on it, and the body under them).
   */
  cockpitEye(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.cockpit) return null;
    return out.set(this.cockpit[0] + this.cockpitOffset[0], this.cockpit[1] + this.cockpitOffset[1], this.cockpit[2] + this.cockpitOffset[2]);
  }

  /** Swap the hull's glass between the game's solid pane and the clear copy (a material swap, nothing to compile). */
  setGlassClear(on: boolean): void {
    if (on === this.glassClear) return;
    this.glassClear = on;
    for (const p of this.panes) {
      const want = on ? p.clear : p.solid;
      if (Array.isArray(p.mesh.material)) p.mesh.material[p.index] = want;
      else p.mesh.material = want;
    }
  }

  quaternion(out: THREE.Quaternion): THREE.Quaternion {
    const r = this.body.rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }

  /** The way the vehicle faces (rad): 0 along +z, growing toward +x, as the player's heading; a ship's is its nose's bearing whatever its bank. */
  get heading(): number {
    const r = this.body.rotation();
    if (this.spec.ship) {
      qTmp.set(r.x, r.y, r.z, r.w);
      const f = tmp2.set(0, 0, 1).applyQuaternion(qTmp);
      if (Math.hypot(f.x, f.z) > 1e-3) return Math.atan2(f.x, f.z);
    }
    return 2 * Math.atan2(r.y, r.w);
  }

  /** The speed as a share of the boosted top speed, for the HUD and the camera. */
  get speedShare(): number {
    return Math.min(1, Math.abs(this.speed) / this.spec.boostSpeed);
  }

  /**
   * One step. `groundAt` is the terrain's height and `waterAt` the water surface's (or -Infinity):
   * a machine floats on water at its ride height, an animal swims with its body chest-deep.
   */
  update(dt: number, physics: Physics, drive: DriveInput | null, groundAt?: (x: number, z: number) => number, waterAt?: (x: number, z: number) => number): void {
    const s = this.spec;
    const body = this.body;
    body.resetForces(true);
    body.resetTorques(true);
    this.hopCd = Math.max(0, this.hopCd - dt);
    this.updateWings(dt);
    if (s.ship && this.flyShip(dt, drive, groundAt, waterAt)) {
      this.group.position.copy(this.pos);
      this.group.quaternion.copy(q);
      this.onUpdate?.(dt, this, drive);
      return;
    }

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
    // A hard hit: the velocity lost since the last step beyond what braking or a slope can take
    // off in one, read as damage by the speed lost. A step that started an impulse of its own
    // (a hop, the first after a spawn) is let by.
    this.justHit = 0;
    if (this.prevVelValid && !this.skipHitCheck && !s.ship) {
      const lost = this.prevVel.distanceTo(lv);
      if (lost > HIT_THRESHOLD) {
        this.justHit = lost;
        this.hp = Math.max(0, this.hp - (lost - HIT_THRESHOLD) * HIT_DAMAGE);
      }
    }
    this.skipHitCheck = false;
    const ride = s.hover + (s.fly ? this.altitude - s.fly.floor : 0);
    // Stiff springs, well damped: a corner pressed to the ground pushes back with the whole
    // weight, so the hull is held off the ground rather than wallowing in it.
    const k = (m * g) / (4 * Math.max(0.15, ride * 0.25));
    const c = 2 * Math.sqrt(k * (m / 4)) * 0.75;

    // Height: springs off the ground at the corners (hover kinds and feet alike), or, for a flyer
    // above its floor, a hold on the height over the terrain.
    this.groundedPoints = 0;
    const flying = !!s.fly && this.altitude > s.fly.floor + 0.05;
    const drop = this.centre.y - s.bounds.min[1];
    // The water is a floor too: a machine rides on it, an animal sinks in to its chest.
    const height = s.bounds.max[1] - s.bounds.min[1];
    const floorAt = (x: number, z: number) => {
      const ground = groundAt ? groundAt(x, z) : -Infinity;
      const water = waterAt ? waterAt(x, z) : -Infinity;
      return Math.max(ground, s.animal ? water - height * 0.55 : water);
    };
    this.onWater = !!waterAt && !!groundAt && waterAt(this.pos.x, this.pos.z) > groundAt(this.pos.x, this.pos.z) + 0.05 && this.pos.y - s.bounds.min[1] < waterAt(this.pos.x, this.pos.z) + ride * 1.6 + 0.3;
    if (!flying) {
      for (const hp of this.hoverPoints) {
        p.copy(hp).applyQuaternion(q).add(this.pos);
        // The ray starts at the collider's centre height over the corner, so a corner pushed
        // into the ground still reads a (negative) distance and is lifted out.
        const hit = physics.groundDistance(p.x, p.y + drop, p.z, drop + ride * 2.2 + 0.5, body);
        let dist = hit === null ? null : hit - drop;
        if (waterAt) {
          const toWater = p.y - floorAt(p.x, p.z);
          if (dist === null || toWater < dist) dist = toWater;
        }
        if (dist === null || dist > ride * 1.6 + 0.3) continue;
        this.groundedPoints++;
        rel.copy(p).sub(this.pos);
        const vPointY = lv.y + tmp.crossVectors(av, rel).y;
        // No more than a few g per corner: a corner well under the floor (a spawn under the
        // water, a slope streamed in late) rises out rather than being launched skyward.
        const f = THREE.MathUtils.clamp(k * (ride - dist) - c * vPointY, 0, m * g * 1.5);
        body.addForceAtPoint({ x: 0, y: f, z: 0 }, { x: p.x, y: p.y, z: p.z }, true);
      }
      // The ground is a hard floor: a corner that has got under it is lifted out at once, and
      // the speed it went in at is a hit, so a hull cannot sink into a slope as into water.
      if (groundAt && !s.animal) {
        let under = 0;
        for (const hp of this.hoverPoints) {
          p.copy(hp).applyQuaternion(q).add(this.pos);
          under = Math.max(under, groundAt(p.x, p.z) - p.y);
        }
        if (under > 0.08) {
          this.pos.y += under + 0.02;
          body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
          if (lv.y < -HIT_THRESHOLD) {
            this.justHit = Math.max(this.justHit, -lv.y);
            this.hp = Math.max(0, this.hp - (-lv.y - HIT_THRESHOLD) * HIT_DAMAGE);
          }
          if (lv.y < 0) {
            lv.y = 0;
            body.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
            this.skipHitCheck = true;
          }
        }
      }
    } else if (groundAt) {
      const ground = floorAt(this.pos.x, this.pos.z);
      const h = this.pos.y - s.bounds.min[1] - ground;
      const f = m * (g + 6 * (this.altitude - h) - 3.5 * lv.y);
      body.addForce({ x: 0, y: f, z: 0 }, true);
      this.groundedPoints = 4;
    }
    // The terrain's own height is a floor under everything: a fast vehicle can outrun the physics
    // ground being streamed in, and a spawn can land a hair inside a slope. Near or below that
    // height with nothing under the corners, hold the ride height off the terrain instead of falling.
    if (groundAt && this.groundedPoints < 2) {
      const ground = floorAt(this.pos.x, this.pos.z);
      const h = this.pos.y - s.bounds.min[1] - ground;
      if (h < ride * 1.6 + 0.3) {
        const f = m * THREE.MathUtils.clamp(g + 6 * (ride - h) - 3.5 * lv.y, 0, g * 3.5);
        body.addForce({ x: 0, y: f, z: 0 }, true);
        this.groundedPoints = 4;
      }
    }
    // Off the ground, a repulsor still fights gravity: past its cushion the machine sinks at a
    // walking pace rather than dropping, so a ramp gives a glide. Never more than its weight,
    // and only near the ground, so it is not a flyer.
    if (groundAt && !flying && !s.animal && s.hover >= 0.3 && this.groundedPoints < 2) {
      const h = this.pos.y - s.bounds.min[1] - floorAt(this.pos.x, this.pos.z);
      if (h < GLIDE_CEILING) {
        let f = m * g * GLIDE_LIFT;
        if (lv.y < -GLIDE_FALL) f += m * (-GLIDE_FALL - lv.y) * 2.5;
        body.addForce({ x: 0, y: Math.min(f, m * g * 0.95), z: 0 }, true);
      }
    }
    const grounded = this.groundedPoints >= 2;
    this.prevVel.copy(lv);
    this.prevVelValid = true;
    // On its back (a machine, not a mount) for more than a moment: the rider comes off, and E
    // on it turns it back over rather than climbing on.
    this.overFor = up.y < -0.2 && !s.animal ? this.overFor + dt : 0;
    this.upsideDown = up.y < -0.2 && !s.animal;
    this.flipped = this.overFor > 0.6;

    // Attitude: upright, banked into the turn for the kinds that lean; damp the rest.
    const speedFwd = lv.dot(fwd);
    this.speed = speedFwd;
    const share = Math.min(1, Math.abs(speedFwd) / Math.max(1, s.maxSpeed));
    // Steering: the keys when held, else a turn toward the heading asked for (the camera's, so
    // the mouse steers): full lock beyond 20 degrees off, easing in under it.
    let steer = drive?.steer ?? 0;
    if (steer === 0 && drive?.heading !== undefined && drive.heading !== null) {
      let diff = drive.heading - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      steer = THREE.MathUtils.clamp(steer - diff / 0.35, -1, 1);
    }
    this.steer = steer;
    wantUp.copy(WORLD_UP);
    // A hover kind pitches and rolls to the ground under it, as its cushion does: the ground a
    // length ahead and behind, and a width either side, give the slope, so a rise ahead lifts the
    // nose before the hull meets it rather than the nose ploughing in.
    if (groundAt && grounded && !flying && !s.animal && s.kind !== 'ground') {
      const L = Math.max(1.2, (s.bounds.max[2] - s.bounds.min[2]) * 0.6);
      const W = Math.max(0.8, (s.bounds.max[0] - s.bounds.min[0]) * 0.6);
      right.crossVectors(fwd, WORLD_UP).normalize();
      const ahead = groundAt(this.pos.x + fwd.x * L, this.pos.z + fwd.z * L);
      const behind = groundAt(this.pos.x - fwd.x * L, this.pos.z - fwd.z * L);
      const toRight = groundAt(this.pos.x + right.x * W, this.pos.z + right.z * W);
      const toLeft = groundAt(this.pos.x - right.x * W, this.pos.z - right.z * W);
      const pitch = THREE.MathUtils.clamp((ahead - behind) / (2 * L), -0.7, 0.7);
      const roll = THREE.MathUtils.clamp((toRight - toLeft) / (2 * W), -0.7, 0.7);
      // The surface normal, tilted back from level by the slopes.
      wantUp.addScaledVector(fwd, -pitch * SLOPE_FOLLOW).addScaledVector(right, -roll * SLOPE_FOLLOW).normalize();
    }
    // A pod racer on the keys yaws hard, its nose swinging round the way a Racer pod's does
    // under the air brakes, banking further and sliding wide while it does; the mouse steers it
    // as it steers everything else.
    const podYaw = s.kind === 'podracer' && (drive?.steer ?? 0) !== 0;
    // Lean into the turn, as a rider does.
    if (s.bank > 0 && steer !== 0) wantUp.applyAxisAngle(fwd, steer * s.bank * share * (podYaw ? 1.6 : 1));
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
    // A battered hull drives worse: sluggish at two thirds, limping at a third.
    const condition = this.hp / this.maxHp;
    const power = (this.overheated > 0 ? 0.35 : 1) * (condition < 0.34 ? 0.55 : condition < 0.67 ? 0.8 : 1);

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
        const want = -steer * s.turnRate * (podYaw ? 1.9 : authority) * wide * sign;
        alpha.y = (want - av.y) * (podYaw ? 12 : 8);
      }
      // A hovering ship slides sideways on its keys, as a VTOL does, at a share of its thrust.
      if (drive.strafe && s.ship) {
        right.crossVectors(fwd, WORLD_UP).normalize();
        tmp.copy(right).multiplyScalar(m * s.accel * 0.6 * power * drive.strafe);
        body.addForce({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
      }
      if (drive.hop && s.hop && grounded && this.hopCd <= 0) {
        body.applyImpulse({ x: 0, y: m * 7.5, z: 0 }, true);
        this.hopCd = 0.9;
        this.skipHitCheck = true;
      }
      if (s.fly) {
        const rate = (drive.up ? 1 : 0) - (drive.down ? 1 : 0) + (drive.vertical ?? 0);
        this.altitude = THREE.MathUtils.clamp(this.altitude + s.fly.climb * THREE.MathUtils.clamp(rate, -1, 1) * dt, s.fly.floor, s.fly.ceiling);
      }
    } else if (s.fly && !drive) this.altitude = Math.max(s.fly.floor, this.altitude - s.fly.climb * 0.5 * dt);
    // Torque = inertia × acceleration, about the body's own axes.
    torque.copy(alpha).applyQuaternion(qInv.copy(q).invert()).multiply(this.inertia).applyQuaternion(q);
    body.addTorque({ x: torque.x, y: torque.y, z: torque.z }, true);

    // Grip: sideways speed is turned back into forward speed at the spec's rate (a turn redirects
    // the vehicle rather than scrubbing its speed off), with a little of it lost to the slide. A pod
    // drifts wide, a bike bites, a walker does not slide at all; in the air there is little to grip.
    lat.copy(lv).addScaledVector(fwd, -speedFwd).setY(0);
    const gripRate = Math.min(1 / dt, grounded ? s.grip * (podYaw ? 0.3 : 1) : s.grip * 0.15);
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

  /**
   * A ship's flight, a first model: W builds speed and S bleeds it, the mouse's heading turns the
   * ship and its tilt pitches it, A/D roll; the body is flown by hand (no gravity, its velocity
   * and attitude set each step) and stays above the ground. Below a few metres a second with the
   * gear near the ground it lands and is a flyer on its springs again. Returns whether it flew.
   */
  private flyShip(dt: number, drive: DriveInput | null, groundAt?: (x: number, z: number) => number, waterAt?: (x: number, z: number) => number): boolean {
    const s = this.spec;
    const body = this.body;
    const t = body.translation();
    this.pos.set(t.x, t.y, t.z);
    this.quaternion(q);
    const floor = Math.max(groundAt ? groundAt(this.pos.x, this.pos.z) : -Infinity, waterAt ? waterAt(this.pos.x, this.pos.z) : -Infinity);
    const h = this.pos.y - s.bounds.min[1] - floor;
    const throttle = drive?.throttle ?? 0;
    // Something solid was hit: the step took speed off the hull that the last frame commanded
    // (a building, an asteroid, a station). The hull bounces off with most of its speed gone
    // and is hurt by what it lost, and for a moment nothing is commanded, so the contacts can
    // push it clear rather than the throttle driving it deeper in, which wedged it there.
    this.justHit = 0;
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    if (this.airborne && this.commandedValid && this.hitCooldown <= 0) {
      const lv = body.linvel();
      const lost = Math.hypot(this.commanded.x - lv.x, this.commanded.y - lv.y, this.commanded.z - lv.z);
      if (lost > SHIP_HIT_LOSS) {
        this.justHit = lost;
        this.hp = Math.max(0, this.hp - (lost - SHIP_HIT_LOSS) * HIT_DAMAGE);
        this.cruise = Math.min(this.cruise, Math.max(4, this.cruise * 0.3));
        this.hitCooldown = SHIP_HIT_FREE;
      }
    }
    this.commandedValid = false;
    // Space has the room for twice the speed the ground shows.
    const top = (drive?.boost ? s.boostSpeed : s.maxSpeed) * (this.space ? 2 : 1);
    this.boosting = !!drive?.boost && throttle > 0;
    if (throttle > 0) this.cruise = Math.min(top, this.cruise + s.accel * dt);
    else if (throttle < 0) this.cruise = Math.max(0, this.cruise - s.brake * dt);
    else if (!drive) this.cruise = Math.max(0, this.cruise - s.brake * 0.5 * dt);
    this.speed = this.cruise;
    const wasAirborne = this.airborne;
    this.airborne = this.cruise > 4 || (wasAirborne && h > s.fly!.floor + 1);
    if (!this.airborne) {
      if (wasAirborne) {
        // Down on the gear: level, keeping the heading, and back on the springs.
        body.setGravityScale(1, true);
        e.set(0, this.heading, 0, 'YXZ');
        q.setFromEuler(e);
        body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        this.altitude = s.fly!.floor;
      }
      return false;
    }
    if (!wasAirborne) {
      body.setGravityScale(0, true);
      this.attitude.copy(q);
      this.stick.set(0, 0);
      this.spin.set(0, 0, 0);
    }
    // Flown like a flight sim: the mouse moves a virtual stick that centres itself when it stops,
    // the stick asks for turning rates about the ship's own axes, and the ship's inertia lets those
    // rates build up and die away over a moment, so a turn carries on a little after the mouse
    // stops and a freighter takes longer to answer than a fighter. A and D roll, Space and X
    // pitch, and nothing levels it out: it can fly on its back and loop.
    const rate = s.turnRate;
    const stick = this.stick;
    const dx = drive?.lookDX ?? 0;
    const dy = drive?.lookDY ?? 0;
    stick.x = THREE.MathUtils.clamp(stick.x + dx * 0.004, -1, 1);
    stick.y = THREE.MathUtils.clamp(stick.y + dy * 0.004, -1, 1);
    const centre = Math.min(1, 2.5 * dt);
    if (!dx) stick.x -= stick.x * centre;
    if (!dy) stick.y -= stick.y * centre;
    const wantYaw = -stick.x * rate * 1.5;
    const wantPitch = stick.y * rate * 1.5 - ((drive?.up ? 1 : 0) - (drive?.down ? 1 : 0)) * rate;
    const wantRoll = (drive?.steer ?? 0) * rate * 1.6;
    const ease = Math.min(1, dt / Math.max(0.05, s.inertia ?? 0.5));
    // A roll answers twice as quickly as a turn: the hull spins about its long axis more readily than it swings.
    const easeRoll = Math.min(1, (2 * dt) / Math.max(0.05, s.inertia ?? 0.5));
    const spin = this.spin;
    spin.y += (wantYaw - spin.y) * ease;
    spin.x += (wantPitch - spin.x) * ease;
    spin.z += (wantRoll - spin.z) * easeRoll;
    const yawDelta = spin.y * dt;
    const pitchDelta = spin.x * dt;
    const rollDelta = spin.z * dt;
    const a = this.attitude;
    if (yawDelta) a.multiply(qTmp.setFromAxisAngle(AXIS_Y, yawDelta));
    if (pitchDelta) a.multiply(qTmp.setFromAxisAngle(AXIS_X, pitchDelta));
    if (rollDelta) a.multiply(qTmp.setFromAxisAngle(AXIS_Z, rollDelta));
    fwd.set(0, 0, 1).applyQuaternion(a);
    // A light hand near the ground and the ceiling: within a few seconds of the ground on the
    // present course the nose is eased toward the horizon, gently and only while the stick is
    // slack, so a pilot who keeps pushing can fly into it; the ceiling is eased the same way.
    const minH = s.fly!.floor + 2;
    let toGround = fwd.y < -0.02 ? h / (-fwd.y * Math.max(this.cruise, 1)) : Infinity;
    // The ground ahead as well as below: a slope or a cliff on the course, within a couple of
    // seconds' flying, counts as ground coming up, so the nose is eased over it.
    if (!this.space && groundAt && this.cruise > 4) {
      const ahead = Math.min(2.5 * this.cruise, 200);
      const gAhead = groundAt(this.pos.x + fwd.x * ahead, this.pos.z + fwd.z * ahead);
      const belly = this.pos.y + s.bounds.min[1] + fwd.y * ahead;
      if (gAhead + minH > belly) toGround = Math.min(toGround, THREE.MathUtils.clamp(((belly - gAhead) / minH) * 2.5, 0, 2.5));
    }
    const tooLow = !this.space && (h < minH || toGround < 2.5);
    const tooHigh = !this.space && h > s.fly!.ceiling;
    const slack = Math.abs(stick.y) < 0.15;
    if (((tooLow && fwd.y < 0.1) || (tooHigh && fwd.y > 0)) && slack) {
      const want = tooLow ? 0.1 : -0.05;
      axis.crossVectors(fwd, WORLD_UP);
      if (axis.lengthSq() > 1e-6) {
        const pull = tooLow ? THREE.MathUtils.clamp(1 - toGround / 2.5, 0.25, 1) : 0.5;
        const angle = THREE.MathUtils.clamp((want - fwd.y) * 1.5 * dt, -rate * 0.5 * dt, rate * 0.5 * dt) * pull;
        qTmp.setFromAxisAngle(axis.normalize(), angle);
        a.premultiply(qTmp);
        fwd.set(0, 0, 1).applyQuaternion(a);
      }
    }
    // Into the ground: a crash. The ship stops dead where it hit and drops onto its gear, and
    // the rider is thrown about by the speed (the game reports it as damage). Flown into a
    // slope sideways (the hull ignores the ground's own collider) it is inside the ground with
    // the nose level: that is a crash too, and the hull is lifted back onto the surface.
    const inGround = !this.space && h < 0;
    if (inGround || (!this.space && h < s.fly!.floor * 0.5 && fwd.y < -0.05 && this.cruise > 8)) {
      this.crashed = Math.max(this.cruise, inGround ? 8 : 0);
      this.cruise = 0;
      this.airborne = false;
      body.setGravityScale(1, true);
      e.set(0, this.heading, 0, 'YXZ');
      q.setFromEuler(e);
      body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      if (inGround) {
        this.pos.y = floor - s.bounds.min[1] + 0.3;
        body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
      }
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.altitude = s.fly!.floor;
      return false;
    }
    a.normalize();
    tmp.copy(fwd).multiplyScalar(this.cruise);
    // Slow, the ship holds a few metres up; with the throttle off it settles down and lands.
    if (this.cruise < 8) tmp.y += this.cruise < 2 ? -1.5 : THREE.MathUtils.clamp((minH - h) * 1.5, -2, 4);
    if (h < s.fly!.floor + 0.5 && tmp.y < 0) tmp.y = 0;
    if (this.hitCooldown > 0) {
      // Just hit: the contacts have the hull for a moment; the attitude follows where they leave it.
      this.quaternion(q);
      a.copy(q);
    } else {
      body.setRotation({ x: a.x, y: a.y, z: a.z, w: a.w }, true);
      q.copy(a);
      body.setLinvel({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
      this.commanded.copy(tmp);
      this.commandedValid = true;
    }
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.groundedPoints = 0;
    this.onWater = false;
    this.meter = Math.min(1, this.meter + dt * 0.2);
    return true;
  }

  dispose(physics: Physics, scene: THREE.Scene): void {
    this.interior?.dispose();
    this.interior = null;
    for (const t of this.trails) t.dispose(scene);
    this.trails = [];
    physics.world.removeRigidBody(this.body);
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !(m.userData.shared as boolean | undefined)) m.geometry.dispose();
    });
  }
}
