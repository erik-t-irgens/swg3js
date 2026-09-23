// Vehicles: one body kept up by hover springs or feet, driven by a spec that says how it handles.
// Four kinds, after what the game's models are: podracers and speeder bikes handle like Star
// Wars: Racer (fast, drifting, banking, a boost that heats or burns out), ground vehicles (walkers,
// animal mounts) turn in place and stay on their feet, flyers (landspeeders as flying cars, gunships
// and airspeeders as aircraft) climb and sink on Space and Ctrl and hold their height over the ground.
import * as THREE from 'three';
import { cleanTrimesh, Group, groups, RAPIER, TRIMESH_FLAGS, type Physics } from '../core/physics';
import { WING_RULE, WingSet, easeWing, pilotWings, wingTopFactor, wingsWanted } from './wings';
import { hardpointName, ownHardpoint, partOf, underPivot } from './shipAssembly';
import { partnerLoss } from '../space/shipDamage';
import { LANDING, SHIP_GROUND, SHIP_ROOM, SPACE_LANDING, catchDistance, fitFloor, floorUnder, heldPose, landingFoot, poseInFrame, restPose, settleEase, surfacePose, surfaceUp, withFilter, type FloorPlane } from './landing';

/**
 * A vehicle's hull meets everything but the ground: the springs hold it off the terrain from
 * their own rays, and a hull that also collided with the heightfield dug its underside or its
 * feet into every slope the springs did not pitch it to, snagging and jolting there.
 */
const HULL_GROUPS = groups(Group.all, Group.all & ~Group.terrain);
/**
 * A hull standing in a building's rooms, the filter the mobiles use inside: the shells go too, since
 * a room is often larger than the hull around it and a ship in a hangar would wedge on the shell
 * wherever the room pokes through it.
 */
const HULL_INSIDE = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));
/** What a floor ray may find: everything outside, and neither the terrain nor a building's shell inside. */
const FLOOR_OUTSIDE = groups(Group.all, Group.all);
const FLOOR_INSIDE = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));
/**
 * The floor under a body is only what stands still: cast from inside a hull, a ray that took moving
 * bodies would find the hull itself, or another ship, and call it the ground.
 */
const standsStill = (c: RAPIER.Collider): boolean => {
  const b = c.parent();
  return !b || b.isFixed();
};
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
  /** A hovering ship: sideways, -1 left to 1 right, as a VTOL slides. */
  strafe?: number;
  /**
   * A ship in flight: the stick, held where it is put for as long as it is given (-1..1): x turns right, y pushes the nose
   * down. The player's mouse cursor gives it (space/mouseFlight.ts), an NPC pilot's hand; absent, it comes back to the middle.
   */
  stickX?: number;
  stickY?: number;
  /** An autopilot's wanted cruise (m/s): the cruise eases toward it rather than following W and S. */
  cruise?: number;
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
  /** The vehicle's own half-size for the chase camera and the boarding range when its bounds are wider than it (a ship framed on its hull, whose bounds reach its farthest wing either side). */
  reach?: number;
}

/** A ship's gun: where it fires from and which way in the vehicle's frame at spawn, and the muzzle node it is read from live (a wing that turned carries it). */
export interface ShipGun {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  node?: THREE.Object3D;
  /** The hardpoint the gun's part hangs on (weapon1_pos1), else its muzzle's own name. */
  hardpoint?: string;
  /** A turret's muzzle (fired along the nose, as the turrets do not turn). */
  turret?: boolean;
  /** The chassis slot whose component the gun belongs to (weapon_0), or null for a gun on the hull itself. */
  slot?: string | null;
  /** What this gun fires, from its slot's component (a fitted ship); absent: the ship's `weapon`. */
  weapon?: { name: string; projectile: number; speed: number; range: number } | null;
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
/** No motion, for a held hull's velocities (Rapier reads it and keeps nothing). */
const STILL = { x: 0, y: 0, z: 0 } as const;
const torque = new THREE.Vector3();
/** Scratch for the wings' colliders and the live muzzles: nothing is allocated per frame. */
const noseTmp = new THREE.Vector3();
const muzzleQ = new THREE.Quaternion();
const wingInv = new THREE.Matrix4();
const wingRel = new THREE.Matrix4();
const wingP = new THREE.Vector3();
const wingQ = new THREE.Quaternion();
const wingS = new THREE.Vector3();
const wantUp = new THREE.Vector3();
const right = new THREE.Vector3();
/** Scratch for the landing: the floor samples, the plane fitted to them, and the pose it gives. */
const floorSamples = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const floorTaken: THREE.Vector3[] = [];
const floorPlane: FloorPlane = { a: 0, b: 0, c: 0 };
const footWorld = new THREE.Vector3();
const holdWorld = new THREE.Vector3();
const holdTurn = new THREE.Quaternion();
/**
 * Scratch for a set-down in space, where the surface has an up of its own: the one ray every look re-uses,
 * the points it found under the hull, and the vectors the pose is built from. Nothing is allocated per step.
 */
const spaceRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const spaceSamples = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const spaceTaken: THREE.Vector3[] = [];
const spaceDown = new THREE.Vector3();
const spaceNose = new THREE.Vector3();
const spaceAcross = new THREE.Vector3();
const spaceUp = new THREE.Vector3();
const spacePoint = new THREE.Vector3();
const spaceFrom = new THREE.Vector3();
const spaceHit = new THREE.Vector3();
const spaceNormal = new THREE.Vector3();
const ONE_SCALE = new THREE.Vector3(1, 1, 1);
/** Velocity lost in one step past which a vehicle has hit something (m/s), and the hull taken per m/s beyond it. */
const HIT_THRESHOLD = 6;
const HIT_DAMAGE = 4;
/** Speed (m/s) a step may take off a flying hull before it counts as having hit something, and how long the contacts then have it. */
/** A hover machine in the air: the share of its weight the repulsor still carries, the fall (m/s) it settles to, and how high over the ground it still does so. */
const GLIDE_LIFT = 0.5;
const GLIDE_FALL = 5;
const GLIDE_CEILING = 30;
const SHIP_HIT_LOSS = 5;
/**
 * The fastest the physics engine moves a body: Rapier cuts every linear velocity to 400 m/s (times its
 * integrationParameters.lengthUnit, 1 here; measured). A velocity asked past it is cut each step, which the hit test
 * reads as a crash. 399 keeps an invented metre a second under it.
 */
const BODY_SPEED_CAP = 399;
const SHIP_HIT_FREE = 0.4;
/** How much of the ground's slope a hover kind takes on: 1 lies flat on it, 0 stays level. */
const SLOPE_FOLLOW = 0.85;
/** Every vehicle's colliders by handle, so a hull that hit something can tell another ship from a station. Filled by the constructor, emptied by dispose. */
const HULLS = new Map<number, Vehicle>();

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
  /**
   * A flow cannot hurt this hull: the client's own terrain table names its template. Joined once,
   * when the vehicle is spawned (`lavaImmuneTemplate` in `src/world/lavaImmunity.ts`), never looked
   * up in a frame; false for anything with no garage entry behind it (the placeholder, a stand-in
   * for a hull another player flies), which is right, since none of those stands in a flow.
   */
  lavaImmune = false;
  /** The speed lost in a hard hit this step (m/s), read once by the game for the sparks and the damage shown; 0 otherwise. */
  justHit = 0;
  /** In flight, the velocity the last step was told to fly at; what the step took off it is a hit. */
  private readonly commanded = new THREE.Vector3();
  private commandedValid = false;
  /** Seconds left in which the contacts, not the throttle, have the hull after a hit. */
  private hitCooldown = 0;
  /** A collision another ship found first and worked out for this one (m/s lost), shown as this hull's `justHit` on its next step when it had not stepped yet this frame. */
  private keptHit = 0;
  /** `Physics.steps` when this vehicle last stepped: whether it has stepped in the frame another ship's collision is found. */
  private steppedAt = -1;
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
  /**
   * The share of `cockpitOffset` the view takes (COCKPIT_OFFSET_SHARE: the B-wing's half, 1 elsewhere). The seated body
   * follows it: Player.syncMount hangs the body from cockpitEye() less the whole offset plus the file's own 1OFF, which is
   * this same point while `cockpitOffset` is the whole 1OFF.
   */
  cockpitShare = 1;
  /** A ship from the ships pack: the pilot's eyes go to the cockpit eye (cockpitEye()) and the body sits on the seat under it. */
  eyeSeat = false;
  /** Where the cockpit eye came from, for the console: 'hp:camera', 'frame middle', 'bridge', 'hardpoint <name>' or 'hull'. */
  eyeSource = 'hull';
  /** How far under the cockpit eye the frame's seat cushion is (metres) as the body is placed by it: null under SEAT_RULE's 'eyes' (the eyes on the eye), or with no cushion found. */
  seatDrop: number | null = null;
  /** The cushion measured under the cockpit eye (metres), whatever the rule; null when none was found. For the console and a switch of SEAT_RULE. */
  cushionDrop: number | null = null;
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
  /** A ship's guns: each one's muzzle node (read live by `muzzle`), and where it fired from and the way it pointed at spawn, in the vehicle's frame. */
  guns: ShipGun[] = [];
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
  /** The wings that open, each on its own clock (the garage fills it). */
  wings = new WingSet();
  /** How open the wings are on average, for the console. */
  get wingsOpen(): number {
    return this.wings.progress;
  }
  /** The chassis's wing_open_speed_factor (0.95 on the X-wing, advanced X-wing, B-wing, V-wing; 1 elsewhere). */
  wingOpenFactor = 1;
  /** Metres the open wings reach below the closed belly (0 when under WING_DROP_MIN). */
  wingDrop = 0;
  /** Metres of air a planet must leave under the closed belly before the wings open: wingDrop + WING_TIP_ROOM, or 0. */
  wingClearance = 0;
  /** Metres from the closed belly to the ground this step (ships; set by flyShip every step). */
  aboveGround = Infinity;
  /** How far the wings hang below the closed belly now (their drop times how far they have swung). */
  get wingBelow(): number {
    return this.wingDrop * this.wings.reach;
  }
  /** Appearances shown only while boosting (a booster's ONOF). */
  boosterParts: THREE.Object3D[] = [];
  /** What the garage could not hang, for the console. */
  unhung: string[] = [];
  /** A ship's fitted components, droid and paint, resolved against its chassis; null for anything else (and a pack without fits). */
  fit: import('./shipFit').ResolvedFit | null = null;
  /** The model and the fitted parts hung on it per slot, for a refit; null for anything else. */
  build: import('./shipMounts').ShipBuild | null = null;
  /** The ship's paint (its own copies of the paint materials once it is given custom paint), or null. */
  paint: import('./shipPaint').ShipPaint | null = null;
  /** The engine glow sprites (a refit re-hangs them; the ones past the live spots are parked, hidden, under the group), their shared material, base size and colour. */
  glows: THREE.Sprite[] = [];
  glowMaterial: THREE.SpriteMaterial | null = null;
  glowSize = 1;
  glowColor = 0x9fd8ff;
  /** Hull colliders under a wing's pivot, moved with it. Must stay a field initialiser: hullColliders fills it from the constructor. */
  private readonly movingPieces: { collider: RAPIER.Collider; mesh: THREE.Object3D }[] = [];
  /** The model the constructor was given (the hull, with its parts hung on it), for the wings' report. */
  private readonly hull: THREE.Object3D;
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
  /** The jump holds the hull where it is: no motion, no flight. */
  held = false;
  /** A ship set down: held at its rest pose on the ground, springs off, until the throttle or Space lifts it. */
  landed = false;
  /** A ship's engines: cut, nothing holds it up and it comes down. The throttle or Space starts them again. */
  powered = true;
  /** Why the last put-down was refused (too steep), for the prompt; cleared when the ship lifts off or lands. */
  landNote = '';
  /** Metres from the foot to the floor under it, as the last step read it (Infinity with no floor found). */
  footGap = Infinity;
  /** The settle onto the rest pose: seconds left of it, and where it is going. */
  private settleLeft = 0;
  private readonly restAt = new THREE.Vector3();
  private readonly restTurn = new THREE.Quaternion();
  private readonly settleFrom = new THREE.Vector3();
  private readonly settleFromTurn = new THREE.Quaternion();
  /** Seconds the pilot has held the ship down at the bottom of its hover band. */
  private downFor = 0;
  /** Where the hull rests on the ground, in the hull's frame (a ship's landing point, or its underside); null for anything else. */
  readonly foot: THREE.Vector3 | null = null;
  /** Whether that foot is the model's own landing point rather than the middle of its underside (for the report). */
  private footFromPoint = false;
  /**
   * In space: something under the hull to set down on, as the last look saw it, for the prompt. Out there
   * "under" is the hull's own down, so any face of a rock will do, and the hull lands on whichever it is over.
   */
  setDownNear = false;
  /** A set-down asked for out in space, taken on the next step that finds a surface; a second ask while down lifts off. */
  private setDownAsked = false;
  /** What a hull set down in space stands on: its live frame, so a surface that moves carries the hull with it. */
  private landedOn: RAPIER.RigidBody | null = null;
  private readonly landedFrame = new THREE.Matrix4();
  private readonly landedAt = new THREE.Vector3();
  private readonly landedTurn = new THREE.Quaternion();
  /** In a building's rooms: the floor is a ray among what stands still, and the hull ignores the shells. */
  inRoom = false;
  /** The physics and the terrain of the step now running, so a floor ray can be cast from the ground functions. */
  private stepPhysics: Physics | null = null;
  private stepGround: ((x: number, z: number) => number) | null = null;
  /** The floor under a point while the vehicle stands in a room: a ray among what stands still. A field, so no closure is made per step. */
  private readonly roomFloorAt = (x: number, z: number): number => this.floorRay(x, z);
  /** A hold on the hull: it is written to this pose before every step, in a frame (a live matrix) or in the world. */
  private holdOn = false;
  private holdFrame: THREE.Matrix4 | null = null;
  private readonly holdPos = new THREE.Vector3();
  private readonly holdQuat = new THREE.Quaternion();
  /** Whether something holds the hull at a pose of its own (a landing, and later a dock or a carrier). */
  get holding(): boolean {
    return this.holdOn;
  }

  /**
   * Fix the hull at a pose, in `frame` (another object's live matrix, read every step) or in the world when it is
   * null. Call it again to move it: the pose is written before the physics step, so nothing lags a frame. The hull
   * keeps its colliders, so a body may still walk on it; `setGhost` is the separate question of what may hit it.
   */
  hold(frame: THREE.Matrix4 | null, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.holdFrame = frame;
    this.holdPos.copy(pos);
    this.holdQuat.copy(quat);
    if (!this.holdOn) {
      this.holdOn = true;
      if (this.body.isValid()) this.body.setGravityScale(0, true);
    }
    this.writeHold();
  }

  /** Let go of a held hull, flying on at `velocity` (nothing given: standing still). */
  release(velocity?: THREE.Vector3 | null): void {
    if (!this.holdOn) return;
    this.holdOn = false;
    this.holdFrame = null;
    if (!this.body.isValid()) return;
    this.body.setGravityScale(1, true);
    this.body.setLinvel(velocity ? { x: velocity.x, y: velocity.y, z: velocity.z } : STILL, true);
    this.body.setAngvel(STILL, true);
    this.commandedValid = false;
    this.skipHitCheck = true;
  }

  /** Write the held pose onto the body and the drawn group: the frame's matrix now, times the pose. */
  private writeHold(): void {
    const body = this.body;
    if (!body.isValid()) return;
    heldPose(this.holdFrame, this.holdPos, this.holdQuat, holdWorld, holdTurn);
    body.setTranslation({ x: holdWorld.x, y: holdWorld.y, z: holdWorld.z }, true);
    body.setRotation({ x: holdTurn.x, y: holdTurn.y, z: holdTurn.z, w: holdTurn.w }, true);
    body.setLinvel(STILL, true);
    body.setAngvel(STILL, true);
    this.pos.copy(holdWorld);
    this.group.position.copy(holdWorld);
    this.group.quaternion.copy(holdTurn);
    this.speed = 0;
    this.commandedValid = false;
  }

  /**
   * In a building's rooms or out of them: the hull's colliders take the inside filter (no terrain, no shells)
   * or the outside one, and its floor becomes a ray in the room rather than the terrain. Nothing is rebuilt.
   */
  setInRoom(inside: boolean): void {
    if (inside === this.inRoom) return;
    this.inRoom = inside;
    // Only the filter half is written: each collider keeps the memberships it was made with, which is
    // what `setGhost` promises to put back and what a part with groups of its own would rely on.
    const want = inside ? HULL_INSIDE : HULL_GROUPS;
    if (!this.body.isValid()) return;
    const n = this.body.numColliders();
    // Ghosted (a jump): the colliders are in no group at all, so the new filter goes into what is restored.
    if (this.ghost) {
      for (let i = 0; i < this.groupsBeforeGhost.length; i++) this.groupsBeforeGhost[i] = withFilter(this.groupsBeforeGhost[i], want);
      return;
    }
    for (let i = 0; i < n; i++) {
      const c = this.body.collider(i);
      c.setCollisionGroups(withFilter(c.collisionGroups(), want));
    }
  }

  /** Cut a ship's engines: nothing holds it up, and it comes down under its own weight (the crash rules apply to what follows). */
  cutEngines(): void {
    if (!this.spec.ship || this.landed) return;
    this.powered = false;
    this.jumpCruise = null;
  }

  /** The engines again (the throttle, Space, or a lift-off). */
  enginesOn(): void {
    this.powered = true;
  }

  /** Off the ground again: the hold goes, the springs take the hull back, and it flies as before. */
  liftOff(): void {
    if (!this.landed && this.settleLeft <= 0) {
      this.powered = true;
      return;
    }
    this.landed = false;
    this.settleLeft = 0;
    this.downFor = 0;
    this.powered = true;
    this.landNote = '';
    this.release(null);
    if (this.spec.fly) this.altitude = this.spec.fly.floor;
    this.skipHitCheck = true;
  }

  /** How the ship stands on the ground now, for the console and the prompt. */
  landReport(): Record<string, unknown> {
    const n2 = (n: number) => Number(n.toFixed(2));
    return {
      ship: this.spec.id,
      rule: SHIP_GROUND.rule,
      landed: this.landed,
      settling: n2(this.settleLeft),
      powered: this.powered,
      holding: this.holdOn,
      inRoom: this.inRoom,
      foot: this.foot ? this.foot.toArray().map(n2) : null,
      footFrom: this.foot ? (this.footFromPoint ? 'its landing point' : 'its underside') : null,
      standsOff: this.foot ? n2(Math.min(this.spec.bounds.min[1], this.spec.bounds.max[1]) - this.foot.y) : null,
      gap: Number.isFinite(this.footGap) ? n2(this.footGap) : null,
      airborne: this.airborne,
      note: this.landNote,
      // What it is standing on, not what the last look happened to find: every probe writes `landedOn`,
      // including the one a merely-slow hull runs each step, so it means nothing until the hull is down.
      space: this.space ? { near: this.setDownNear, asked: this.settingDown, on: !this.landed && this.settleLeft <= 0 ? null : this.landedOn ? 'something that can move' : 'the world' } : null,
      tune: { ...LANDING, room: { ...SHIP_ROOM }, space: { ...SPACE_LANDING } },
    };
  }
  /** The cruise a jump commands (m/s), over the throttle; null when no jump is flying the hull. */
  jumpCruise: number | null = null;
  /** The hull's colliders are in no group while a jump flies it (`setGhost`). */
  private ghost = false;
  /** Each collider's groups as they were when the hull was ghosted, restored exactly. */
  private readonly groupsBeforeGhost: number[] = [];
  /** Ghosted by a jump: not there for bolts, targets or the hit test. */
  get ghosted(): boolean {
    return this.ghost;
  }
  /** A ship's fight (shields, armour, parts, chassis), once the world's ship contacts adopt it; null for anything else. */
  combat: import('../space/shipCombat').ShipCombat | null = null;
  /** What flies it when nobody does (an NPC ship's brain): its drive is read in place of a pilot's. Null for any other vehicle. */
  autopilot: { readonly drive: DriveInput } | null = null;
  /** Set first thing in `dispose`: whoever holds the vehicle drops it. */
  disposed = false;
  /** Materials made for this vehicle alone (its glow sprite's, each trail's, each clear pane's): World.disposeVehicle forgets and disposes them. */
  readonly ownedMaterials: THREE.Material[] = [];

  constructor(readonly spec: VehicleSpec, model: THREE.Object3D, physics: Physics, scene: THREE.Scene, x: number, y: number, z: number, heading: number) {
    this.hull = model;
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
    this.radius = spec.reach ?? Math.max(w, l) / 2;
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
    for (const h of this.colliderHandles) HULLS.set(h, this);
    this.pos.set(x, y, z);
    // Where the hull will rest on the ground: the game's own point under it (its own, never a part's),
    // read in the hull's frame once, since nothing on the hull moves it afterwards.
    if (spec.ship) {
      const node = ownHardpoint(model, 'landing1');
      let point: THREE.Vector3 | null = null;
      if (node) {
        this.group.updateMatrixWorld(true);
        point = node.getWorldPosition(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(this.group.matrixWorld).invert());
      }
      this.foot = landingFoot(point, b, new THREE.Vector3());
      this.footFromPoint = !!node;
    }
  }

  /**
   * The floor straight down from a point, for a hull standing in a building's rooms: the nearest surface
   * that stands still, the room's own and not the terrain under the building. -Infinity when nothing is
   * under it, which reads as "no ground" everywhere the height is used.
   */
  private floorRay(x: number, z: number): number {
    const ph = this.stepPhysics;
    if (!ph) return -Infinity;
    const from = this.pos.y + this.centre.y;
    const hit = ph.topSurface(x, z, from, LANDING.floorReach, this.inRoom ? FLOOR_INSIDE : FLOOR_OUTSIDE, standsStill);
    return hit ?? -Infinity;
  }

  /**
   * The floor under the foot now, for the put-down: a ray among what stands still, and the terrain under
   * it outside (a hull outside a room may stand on the open ground, where there is no collider to find
   * until the terrain's own chunk is in).
   */
  private floorUnder(x: number, z: number): number {
    return floorUnder(this.inRoom, this.floorRay(x, z), this.stepGround?.(x, z) ?? -Infinity);
  }

  /** The foot's place in the world now (the hull's pose times the foot), with the hull's turn `q`. */
  private footAt(turn: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.foot!).applyQuaternion(turn).add(this.pos);
  }

  /**
   * Put the ship down where it stands: five floor samples round the foot fitted to a plane, the hull turned
   * onto it with its heading kept, and an ease onto that pose. A slope past `LANDING.tilt` is refused
   * (`clamp` for a hull with its engines cut, which has nowhere else to go). Returns whether it is coming down.
   */
  private beginLanding(clamp: boolean, impact: number): boolean {
    const s = this.spec;
    if (!this.foot) return false;
    this.quaternion(q);
    this.footAt(q, footWorld);
    const w = Math.max(1, (s.bounds.max[0] - s.bounds.min[0]) * LANDING.spread);
    const l = Math.max(1, (s.bounds.max[2] - s.bounds.min[2]) * LANDING.spread);
    fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    right.crossVectors(WORLD_UP, fwd);
    floorTaken.length = 0;
    // Five samples: the foot and one out each way. Invented, and the fit takes however many find a floor.
    for (let i = 0; i < floorSamples.length; i++) {
      const along = i === 1 ? l : i === 2 ? -l : 0;
      const across = i === 3 ? w : i === 4 ? -w : 0;
      const x = footWorld.x + fwd.x * along + right.x * across;
      const z = footWorld.z + fwd.z * along + right.z * across;
      const y = this.floorUnder(x, z);
      if (!Number.isFinite(y)) continue;
      floorTaken.push(floorSamples[i].set(x, y, z));
    }
    if (!floorTaken.length) return false;
    fitFloor(floorTaken, floorPlane);
    const tilt = restPose(floorPlane, this.foot, this.pos.x, this.pos.z, this.heading, THREE.MathUtils.degToRad(LANDING.tilt), this.restAt, this.restTurn, clamp);
    if (tilt === null) {
      this.landNote = 'too steep to set down here';
      this.downFor = 0;
      return false;
    }
    this.landNote = '';
    this.settleFrom.copy(this.pos);
    this.settleFromTurn.copy(q);
    this.settleLeft = LANDING.settle;
    this.airborne = false;
    this.cruise = 0;
    this.speed = 0;
    this.commandedValid = false;
    // Down hard: the hull takes it as a crash, as flying into the ground does.
    if (impact > LANDING.hard) {
      this.crashed = Math.max(this.crashed, impact);
      this.justHit = Math.max(this.justHit, impact);
      this.hurtHull((impact - LANDING.hard) * HIT_DAMAGE);
      this.landNote = 'a hard landing';
    }
    return true;
  }

  /** One step of the settle onto the rest pose; the hull is held there from the moment it arrives. */
  private stepSettle(dt: number): void {
    this.settleLeft = Math.max(0, this.settleLeft - dt);
    const k = settleEase(1 - this.settleLeft / Math.max(0.001, LANDING.settle));
    tmp.copy(this.settleFrom).lerp(this.restAt, k);
    qTmp.copy(this.settleFromTurn).slerp(this.restTurn, k);
    this.hold(null, tmp, qTmp);
    if (this.settleLeft <= 0) {
      this.landed = true;
      this.powered = false;
      this.wings.snap(false);
      this.followWings();
    }
  }

  /**
   * A ship meeting the ground on a planet, under the landing rule: the hold while it is down, the ease while
   * it comes down, the fall with the engines cut, and the put-down itself. Returns whether it took this step;
   * false leaves the hull hovering on its springs, as it always did.
   */
  private groundShip(dt: number, drive: DriveInput | null): boolean {
    const s = this.spec;
    // The older springs rule put back under a ship that is already down: let go of the hull at once.
    // Nothing else would, and it would be held at its rest pose with no way off the ground.
    if (SHIP_GROUND.rule !== 'landing') {
      if (this.landed || this.settleLeft > 0) this.liftOff();
      return false;
    }
    // Out in space there is no ground and no up: the surface under the hull is whatever it is over.
    if (this.space) return this.groundSpace(dt, drive);
    if (!this.foot) return false;
    const wantsUp = !!drive && (drive.throttle > 0 || drive.up);
    if (this.landed) {
      if (wantsUp) {
        this.liftOff();
        return false;
      }
      this.writeHold();
      this.groundedPoints = 4;
      this.airborne = false;
      return true;
    }
    if (this.settleLeft > 0) {
      // Called off: the pilot opened up again before it was down.
      if (wantsUp) {
        this.settleLeft = 0;
        this.release(null);
        this.powered = true;
        return false;
      }
      this.stepSettle(dt);
      return true;
    }
    if (wantsUp) this.powered = true;
    const t = this.body.translation();
    this.pos.set(t.x, t.y, t.z);
    this.quaternion(q);
    this.footAt(q, footWorld);
    const floor = this.floorUnder(footWorld.x, footWorld.z);
    this.footGap = Number.isFinite(floor) ? footWorld.y - floor : Infinity;
    const lv = this.body.linvel();
    if (!this.powered) {
      // The engines are cut: gravity and the contacts have the hull, and it is caught as the floor comes up.
      this.airborne = false;
      this.body.setGravityScale(1, true);
      // What it arrives with is its whole speed, not only its fall. Nothing flies a hull with its
      // engines out and nothing bleeds its speed off, and the flight model's own crash test is not
      // running, so a hull still travelling fast is flying into the ground: that is a crash.
      const impact = Math.hypot(lv.x, lv.y, lv.z);
      if (this.footGap <= catchDistance(-lv.y) && this.beginLanding(true, impact)) {
        // Held from this step on, so no step passes with neither the springs nor the hold under it.
        this.stepSettle(0);
        return true;
      }
      this.groundedPoints = 0;
      this.cruise = 0;
      this.speed = 0;
      // The drawn hull follows the body down (nothing after this writes it this step).
      this.group.position.copy(this.pos);
      this.group.quaternion.copy(q);
      return true;
    }
    // Powered: the pilot holds it down at the bottom of its band until it sets down.
    const atBottom = !!s.fly && this.altitude <= s.fly.floor + LANDING.bandSlack;
    const down = !!drive?.down && atBottom && !this.airborne;
    this.downFor = down ? this.downFor + dt : 0;
    // A refusal is the answer to one attempt: it goes as soon as the pilot stops asking for down,
    // or "too steep to set down here" would follow the ship about until it next landed somewhere.
    if (!drive?.down && this.landNote) this.landNote = '';
    if (this.downFor >= LANDING.hold && this.footGap <= LANDING.reach && this.beginLanding(false, 0)) {
      this.stepSettle(0);
      return true;
    }
    return false;
  }

  /**
   * The pilot's ask, out in space: set the hull down on whatever is under it, or, once it is down, lift it
   * off again along the surface's own up. It is taken on a step that finds something within reach; the ask
   * is dropped if nothing is found, so a press over empty space does not wait about.
   */
  askSetDown(): void {
    if (!this.spec.ship || !this.space) return;
    if (this.landed || this.settleLeft > 0) {
      this.liftFromSurface();
      return;
    }
    this.setDownAsked = true;
  }

  /** Whether a set-down is being asked for now, for the prompt. */
  get settingDown(): boolean {
    return this.setDownAsked || this.settleLeft > 0;
  }

  /**
   * What lies along a direction from a point, for a set-down in space: the first thing that is neither this
   * hull nor a corpse. The hit's place goes in `spacePoint` and its normal in `spaceUp`; the answer is the
   * distance, or -1 for nothing within reach. One ray, re-used, so nothing is allocated per step.
   */
  private lookAlong(physics: Physics, from: THREE.Vector3, dir: THREE.Vector3, reach: number): number {
    spaceRay.origin.x = from.x;
    spaceRay.origin.y = from.y;
    spaceRay.origin.z = from.z;
    spaceRay.dir.x = dir.x;
    spaceRay.dir.y = dir.y;
    spaceRay.dir.z = dir.z;
    const hit = physics.world.castRayAndGetNormal(spaceRay, reach, true, undefined, groups(Group.all, Group.all), undefined, this.body, (c) => !physics.isRagdoll(c.handle));
    if (!hit) return -1;
    const t = hit.timeOfImpact;
    spacePoint.set(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t);
    spaceUp.set(hit.normal.x, hit.normal.y, hit.normal.z);
    if (spaceUp.lengthSq() < 1e-6) spaceUp.copy(dir).negate();
    if (spaceUp.dot(dir) > 0) spaceUp.negate();
    this.landedOn = hit.collider.parent();
    return t;
  }

  /**
   * A ship meeting a surface in space: the hold while it is down, the ease onto it, and the put-down itself.
   * Nothing is under it unless the hull is over something within reach, and nothing happens until the pilot
   * asks. Returns whether it took this step; false leaves the hull to the flight model as before.
   */
  private groundSpace(dt: number, drive: DriveInput | null): boolean {
    if (!this.foot) return false;
    const physics = this.stepPhysics;
    const wantsUp = !!drive && drive.throttle > 0;
    if (this.landed) {
      this.setDownNear = false;
      if (wantsUp) {
        this.liftFromSurface();
        return false;
      }
      this.holdOnSurface();
      this.airborne = false;
      this.groundedPoints = 4;
      return true;
    }
    if (this.settleLeft > 0) {
      if (wantsUp) {
        this.settleLeft = 0;
        this.landedOn = null;
        this.release(null);
        return false;
      }
      this.stepSettle(dt);
      // Down: from here the hull is held in the surface's own frame, so one that moves carries it.
      if (this.landed) this.keepSurfacePose();
      return true;
    }
    // A set-down is only ever offered to a hull that has nearly stopped; NPC ships never slow down this far.
    this.setDownNear = false;
    if (!physics || Math.abs(this.speed) > SPACE_LANDING.speed) {
      this.setDownAsked = false;
      return false;
    }
    // Read the hull where the body has it, as the planet's own path does above: this runs before the flight
    // model writes `pos`, so without it the looks would start from where the hull was a step ago.
    const t = this.body.translation();
    this.pos.set(t.x, t.y, t.z);
    this.quaternion(q);
    spaceDown.set(0, -1, 0).applyQuaternion(q);
    this.footAt(q, footWorld);
    const found = this.lookAlong(physics, footWorld, spaceDown, SPACE_LANDING.reach);
    this.footGap = found < 0 ? Infinity : found;
    this.setDownNear = found >= 0;
    if (found < 0) {
      this.setDownAsked = false;
      this.landNote = '';
      this.landedOn = null;
      return false;
    }
    // Nothing is being stood on until something is: the look above writes what it found, and a hull merely
    // hovering near a rock would otherwise go on reporting it as the thing it is resting on.
    if (!this.setDownAsked) {
      this.landedOn = null;
      return false;
    }
    this.setDownAsked = false;
    if (!this.beginSpaceLanding(physics, found)) return false;
    // Held from this step on, so no step passes with nothing under the hull.
    this.stepSettle(0);
    return true;
  }

  /**
   * Put the ship down on the face under it: five looks along the hull's own down, fitted to a surface the way
   * a floor is fitted on the ground, the hull turned so its up is that face's, and an ease onto the pose. The
   * hit's own normal stands in when too few looks find anything. Returns whether it is coming down.
   */
  private beginSpaceLanding(physics: Physics, centre: number): boolean {
    const s = this.spec;
    // The first look's own place and normal, kept: every look after this one writes over them.
    spaceHit.copy(spacePoint);
    spaceNormal.copy(spaceUp);
    const stoodOn = this.landedOn;
    const w = Math.max(1, (s.bounds.max[0] - s.bounds.min[0]) * SPACE_LANDING.spread);
    const l = Math.max(1, (s.bounds.max[2] - s.bounds.min[2]) * SPACE_LANDING.spread);
    spaceNose.set(0, 0, 1).applyQuaternion(q);
    spaceAcross.set(1, 0, 0).applyQuaternion(q);
    spaceTaken.length = 0;
    spaceTaken.push(spaceSamples[0].copy(spaceHit));
    // Four more looks round the foot, each along the hull's own down; the fit takes whichever found a face.
    for (let i = 1; i < spaceSamples.length; i++) {
      const along = i === 1 ? l : i === 2 ? -l : 0;
      const across = i === 3 ? w : i === 4 ? -w : 0;
      spaceFrom.copy(footWorld).addScaledVector(spaceNose, along).addScaledVector(spaceAcross, across);
      const d = this.lookAlong(physics, spaceFrom, spaceDown, SPACE_LANDING.reach + Math.abs(along) + Math.abs(across));
      if (d < 0) continue;
      spaceTaken.push(spaceSamples[i].copy(spacePoint));
    }
    // The face the hull will stand on: fitted to what the looks found, or the first one's own normal.
    this.landedOn = stoodOn;
    if (!surfaceUp(spaceTaken, q, spaceUp)) spaceUp.copy(spaceNormal);
    if (spaceUp.dot(spaceNormal) < 0) spaceUp.negate();
    if (!surfacePose(spaceHit, spaceUp, spaceNose, this.foot!, this.restAt, this.restTurn)) return false;
    this.landNote = '';
    this.settleFrom.copy(this.pos);
    this.settleFromTurn.copy(q);
    this.settleLeft = LANDING.settle;
    this.airborne = false;
    this.cruise = 0;
    this.speed = 0;
    this.footGap = centre;
    this.commandedValid = false;
    return true;
  }

  /** The pose a hull set down in space keeps, in the frame of what it stands on, so a surface that moves carries it. */
  private keepSurfacePose(): void {
    const on = this.landedOn;
    if (!on || !on.isValid()) {
      this.landedOn = null;
      this.landedAt.copy(this.restAt);
      this.landedTurn.copy(this.restTurn);
      return;
    }
    const t = on.translation();
    const r = on.rotation();
    this.landedFrame.compose(tmp.set(t.x, t.y, t.z), qTmp.set(r.x, r.y, r.z, r.w), ONE_SCALE);
    poseInFrame(this.landedFrame, this.restAt, this.restTurn, this.landedAt, this.landedTurn);
  }

  /** One step of the hold on a surface: the frame is read again, so the hull rides whatever it is standing on. */
  private holdOnSurface(): void {
    const on = this.landedOn;
    if (!on || !on.isValid()) {
      this.writeHold();
      return;
    }
    const t = on.translation();
    const r = on.rotation();
    this.landedFrame.compose(tmp.set(t.x, t.y, t.z), qTmp.set(r.x, r.y, r.z, r.w), ONE_SCALE);
    this.hold(this.landedFrame, this.landedAt, this.landedTurn);
  }

  /** Off a surface in space: the hold goes and the hull leaves along the face's own up, so it clears what it stood on. */
  private liftFromSurface(): void {
    if (!this.landed && this.settleLeft <= 0) return;
    this.quaternion(q);
    up.copy(WORLD_UP).applyQuaternion(q);
    const on = this.landedOn;
    this.landedOn = null;
    this.liftOff();
    // Whatever it stood on was doing, plus the push off it: a hull leaving something that moves keeps up with it.
    tmp.copy(up).multiplyScalar(SPACE_LANDING.clear);
    if (on && on.isValid()) {
      const lv = on.linvel();
      tmp.x += lv.x;
      tmp.y += lv.y;
      tmp.z += lv.z;
    }
    if (this.body.isValid()) this.body.setLinvel({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
    this.airborne = true;
    this.setDownNear = false;
  }

  /** Half the hull's height, as a bolt's target (the Hittable contract). */
  get halfHeight(): number {
    return (this.spec.bounds.max[1] - this.spec.bounds.min[1]) / 2;
  }

  get dead(): boolean {
    return this.destroyed;
  }

  /**
   * A blow (a saber, a blast, a bolt the plain way): the hull takes it, through its shields and armour when
   * it has a fight (`combat`), and `source` is remembered there; a vehicle is too heavy for it to shove.
   */
  damage(amount: number, from?: THREE.Vector3, _push?: number, source?: import('../combat/kit').Living | null): void {
    if (this.destroyed) return;
    this.struck += amount;
    if (this.combat) this.combat.take(amount, from, source ?? null);
    else this.hp = Math.max(0, this.hp - amount);
  }

  /** A bolt struck the hull at `point` (the Hittable contract): a ship with a fight takes it whole ('shown' when its layer's hit effect played, 'taken' when the bolt's own should); false lets the bolt hurt it the plain way. */
  takeBolt(bolt: import('../combat/bolts').Bolt, point: THREE.Vector3, normal: THREE.Vector3): false | 'taken' | 'shown' {
    if (!this.combat) return false;
    if (this.destroyed) return 'taken';
    this.struck += bolt.damage;
    return this.combat.takeBolt(bolt, point, normal);
  }

  /** A collision's damage: onto the armour of a ship with a fight (with `other`, the ship it met, if it met one: only that is capped), else straight off the hull. */
  private hurtHull(amount: number, other: Vehicle | null = null): void {
    if (amount <= 0) return;
    if (this.combat) this.combat.collide(amount, other ? other.body.handle : null);
    else this.hp = Math.max(0, this.hp - amount);
  }

  /**
   * The ship whose hull this one's touched in the last step (a contact with points between their colliders), or
   * null: a station, an asteroid or anything else is not a ship, and a ghosted or disposed hull is left out. Asked
   * only on a hit, so the closures it makes are not per frame.
   */
  private shipTouched(world: RAPIER.World): Vehicle | null {
    const body = this.body;
    let found: Vehicle | null = null;
    for (let i = 0, n = body.numColliders(); i < n && !found; i++) {
      const mine = body.collider(i);
      world.contactPairsWith(mine, (other) => {
        if (found) return;
        const v = HULLS.get(other.handle);
        if (!v || v === this || !v.spec.ship || v.ghost || v.disposed || !v.body.isValid() || other.parent()?.handle !== v.body.handle) return;
        let touching = false;
        world.contactPair(mine, other, (m) => {
          if (m.numContacts() > 0) touching = true;
        });
        if (touching) found = v;
      });
    }
    return found;
  }

  /**
   * A collision another ship found first, in which this hull lost `lost` m/s (worked out by the one that found it):
   * hurt as by its own hit test, given the contacts' moment, and not measured again by its own test this frame.
   * `steps` is `Physics.steps` now: a hull that has stepped this frame shows the hit at once, one that has not on its
   * step. A ghosted, disposed or destroyed hull takes nothing.
   */
  private rammed(by: Vehicle, lost: number, steps: number): void {
    if (lost <= SHIP_HIT_LOSS || this.ghost || this.disposed || this.destroyed) return;
    this.commandedValid = false;
    this.hitCooldown = SHIP_HIT_FREE;
    if (this.airborne) this.cruise = Math.min(this.cruise, Math.max(4, this.cruise * 0.3));
    this.hurtHull((lost - SHIP_HIT_LOSS) * HIT_DAMAGE, by);
    if (this.steppedAt === steps) this.justHit = Math.max(this.justHit, lost);
    else this.keptHit = Math.max(this.keptHit, lost);
  }

  /**
   * The wings open in flight with room under them and close on the ground (the flight rule,
   * `wingsWanted`, on last step's height), each turned about its own Z over its own time, the way
   * the client turns the wing objects it hangs on the hull. Positional, nothing allocated.
   */
  private updateWings(dt: number): void {
    if (!this.wings.length) return;
    const w = this.wings;
    // The pilot's choice from the wings key, while there is one; else the flight rule.
    w.want =
      w.pilot !== null
        ? pilotWings(w.pilot, this.airborne, this.space, this.aboveGround, this.wingClearance, w.want)
        : wingsWanted(this.airborne, this.space, this.aboveGround, this.wingClearance, Math.abs(this.speed), this.spec.maxSpeed * (this.space ? 2 : 1), this.wingOpenFactor, w.want);
    if (w.step(dt)) this.followWings();
  }

  /** The hull colliders under a wing's pivot, moved to where their meshes now stand in the vehicle's frame. */
  private followWings(): void {
    if (!this.movingPieces.length) return;
    this.group.updateMatrixWorld(true);
    wingInv.copy(this.group.matrixWorld).invert();
    for (const p of this.movingPieces) {
      wingRel.multiplyMatrices(wingInv, p.mesh.matrixWorld).decompose(wingP, wingQ, wingS);
      p.collider.setTranslationWrtParent(wingP);
      p.collider.setRotationWrtParent(wingQ);
    }
  }

  /**
   * Where a gun fires from and which way, in the world, now: its node's place and +Z (a wing that turned carries it),
   * else its place from the spawn; a gun pointing away from the nose fires along it. Allocation-free; call after
   * `group.updateMatrixWorld(true)`.
   */
  muzzle(g: ShipGun, outPos: THREE.Vector3, outDir: THREE.Vector3): THREE.Vector3 {
    noseTmp.set(0, 0, 1).applyQuaternion(this.group.quaternion);
    if (g.node) {
      g.node.getWorldPosition(outPos);
      outDir.set(0, 0, 1).applyQuaternion(g.node.getWorldQuaternion(muzzleQ));
    } else {
      outPos.copy(g.pos).applyMatrix4(this.group.matrixWorld);
      outDir.copy(g.dir).applyQuaternion(this.group.quaternion);
    }
    outDir.normalize();
    if (outDir.dot(noseTmp) < 0.5) outDir.copy(noseTmp);
    return outPos;
  }

  /**
   * The wings, their rule and their colliders, for the console (__debug.wings; allocates, console only): each wing's
   * share open and angle now (the client's degrees) and the hull hardpoint its mount stands nearest; each moving
   * collider's distance from its mesh, in the body's frame (`off`, 0.00 once followWings has run) and in the world
   * (`world`: 0.00 parked; in flight the body leads the drawn group by up to a step); the guns and where each fires from now.
   */
  wingReport(): Record<string, unknown> {
    const n2 = (n: number) => Number(n.toFixed(2));
    const s = this.spec;
    const model = this.hull;
    this.group.updateMatrixWorld(true);
    const hullPoints: { name: string; at: THREE.Vector3 }[] = [];
    model.traverse((o) => {
      const name = hardpointName(o);
      if (name !== null && !partOf(o, model)) hullPoints.push({ name, at: o.getWorldPosition(new THREE.Vector3()) });
    });
    const wings = this.wings.list.map((w) => {
      const mount = w.pivot.parent ?? w.pivot;
      const at = mount.getWorldPosition(new THREE.Vector3());
      let best: { name: string; d: number } | null = null;
      for (const h of hullPoints) {
        const d = h.at.distanceTo(at);
        if (!best || d < best.d) best = { name: h.name, d };
      }
      return { file: w.label, open: n2(w.open), deg: n2(-THREE.MathUtils.radToDeg(w.angle) * easeWing(w.open)), stands: best ? `${best.name} (${best.d.toFixed(2)} m)` : 'no hull hardpoint' };
    });
    wingInv.copy(this.group.matrixWorld).invert();
    const colliders = this.movingPieces.map((p) => {
      wingRel.multiplyMatrices(wingInv, p.mesh.matrixWorld).decompose(wingP, wingQ, wingS);
      const t = p.collider.translationWrtParent();
      const off = t ? Math.hypot(t.x - wingP.x, t.y - wingP.y, t.z - wingP.z) : NaN;
      // In the world as well: the collider where the body puts it against the mesh where the group draws it, which
      // also catches a body and a group that disagree (`off` is only the last pose followWings gave it).
      const w = p.collider.translation();
      const mw = p.mesh.getWorldPosition(new THREE.Vector3());
      return { mesh: p.mesh.name || p.mesh.parent?.name || 'unnamed', off: n2(off), world: n2(Math.hypot(w.x - mw.x, w.y - mw.y, w.z - mw.z)) };
    });
    const from = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const guns = this.guns.map((g) => ({ hardpoint: g.hardpoint ?? null, turret: !!g.turret, at: this.muzzle(g, from, dir).toArray().map(n2) }));
    const top = s.maxSpeed * (this.space ? 2 : 1);
    return {
      ship: s.id,
      rule: WING_RULE.speed,
      factor: this.wingOpenFactor,
      topNow: n2(top * wingTopFactor(this.wingOpenFactor, this.wings.progress)),
      drop: n2(this.wingDrop),
      clearance: n2(this.wingClearance),
      aboveGround: Number.isFinite(this.aboveGround) ? n2(this.aboveGround) : null,
      below: n2(this.wingBelow),
      speed: n2(Math.abs(this.speed)),
      airborne: this.airborne,
      want: this.wings.want,
      target: this.wings.target,
      forced: this.wings.force,
      pilot: this.wings.pilot,
      wings,
      colliders,
      guns,
      unhung: this.unhung,
    };
  }

  /**
   * Trimesh colliders on the body from the model's meshes in the vehicle's frame: every mesh of a
   * plain model, and of a portal building only the shell's (cell 0), less those marked
   * `noCollider` (the parts of a hull with more than PART_LIMIT). Built in the closed pose; a mesh
   * under a wing's pivot is a moving piece that `followWings` moves with it, and the mass goes on
   * the first piece that never moves. Returns how many were made.
   */
  private hullColliders(model: THREE.Object3D, world: RAPIER.World, mass: { m: number; inertia: THREE.Vector3; centre: { x: number; y: number; z: number } }): number {
    this.group.updateMatrixWorld(true);
    const groupInverse = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    let pieces = 0;
    let triangles = 0;
    const meshes: { mesh: THREE.Mesh; moving: boolean }[] = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || cellIndexOf(o) > 0 || mesh.userData.noCollider) return;
      meshes.push({ mesh, moving: underPivot(o, model) });
    });
    // Still pieces first (a stable sort), so the mass lands on one that never moves.
    meshes.sort((a, b) => Number(a.moving) - Number(b.moving));
    for (const { mesh, moving } of meshes) {
      const posAttr = mesh.geometry.getAttribute('position');
      if (!posAttr || posAttr.count < 3 || posAttr.itemSize !== 3 || (posAttr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
      const idx = mesh.geometry.getIndex();
      const raw = idx ? new Uint32Array(idx.array as ArrayLike<number>) : Uint32Array.from({ length: posAttr.count - (posAttr.count % 3) }, (_, i) => i);
      const clean = cleanTrimesh(new Float32Array(posAttr.array as ArrayLike<number>), raw);
      if (!clean) continue;
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
      // Only a hull made of nothing but wings would put them on a piece that moves.
      if (pieces === 0) {
        const c = new THREE.Vector3(mass.centre.x, mass.centre.y, mass.centre.z).sub(p).applyQuaternion(q.clone().invert());
        desc.setMassProperties(mass.m, { x: c.x, y: c.y, z: c.z }, { x: mass.inertia.x, y: mass.inertia.y, z: mass.inertia.z }, { x: 0, y: 0, z: 0, w: 1 });
      } else desc.setDensity(0);
      const collider = world.createCollider(desc, this.body);
      this.colliderHandles.push(collider.handle);
      if (moving) this.movingPieces.push({ collider, mesh });
      pieces++;
      triangles += indices.length / 3;
    }
    if (pieces) console.info(`${this.spec.id}: hull collision from ${pieces} meshes${this.movingPieces.length ? ` (${this.movingPieces.length} riding the wings)` : ''}, ${triangles} triangles`);
    return pieces;
  }

  /** Put a ship straight into flight at `speed` metres a second, on its present heading: arriving from another world in the air. */
  launch(speed: number): void {
    if (!this.spec.ship) return;
    // Off the ground it goes: nothing holds a hull that is launched into flight.
    if (this.landed || this.settleLeft > 0) this.liftOff();
    this.cruise = speed;
    this.speed = speed;
    this.airborne = true;
    // Arriving in flight, the wings already stand as the pilot's choice or the flight rule has them (the ground is not read yet: all the room in the world).
    const w = this.wings;
    w.snap(w.pilot !== null ? pilotWings(w.pilot, true, this.space, Infinity, this.wingClearance, false) : wingsWanted(true, this.space, Infinity, this.wingClearance, speed, this.spec.maxSpeed * (this.space ? 2 : 1), this.wingOpenFactor, false));
    this.followWings();
    this.body.setGravityScale(0, true);
    this.quaternion(this.attitude);
    this.stick.set(0, 0);
    this.spin.set(0, 0, 0);
    this.skipHitCheck = true;
    fwd.set(0, 0, 1).applyQuaternion(this.attitude).multiplyScalar(speed);
    this.body.setLinvel({ x: fwd.x, y: fwd.y, z: fwd.z }, true);
  }

  /**
   * The hull's colliders in no group (the jump flies through what is ahead, as the client's did), or
   * back in exactly the groups each had before (parts hung on the hull keep their own). Trails muted
   * meanwhile. A collider added while ghosted keeps whatever groups it was made with.
   */
  setGhost(on: boolean): void {
    if (on === this.ghost) return;
    const body = this.body;
    if (!body.isValid()) {
      // The body was removed (the hull disposed): its colliders are gone, and asking for them throws.
      this.ghost = on;
      this.groupsBeforeGhost.length = 0;
      return;
    }
    const n = body.numColliders();
    if (on) {
      this.groupsBeforeGhost.length = 0;
      for (let i = 0; i < n; i++) {
        const c = body.collider(i);
        this.groupsBeforeGhost.push(c.collisionGroups());
        c.setCollisionGroups(0);
      }
    } else {
      const kept = Math.min(n, this.groupsBeforeGhost.length);
      for (let i = 0; i < kept; i++) body.collider(i).setCollisionGroups(this.groupsBeforeGhost[i]);
      this.groupsBeforeGhost.length = 0;
    }
    this.ghost = on;
    for (const t of this.trails) t.muted = on;
  }

  /** Put the hull somewhere else at once, facing `quaternion`, flying at `speed` along its nose; trails and hit memory cleared. Nothing allocated. */
  teleport(pos: THREE.Vector3, quaternion: THREE.Quaternion, speed: number): void {
    // Moved somewhere else: whatever held it on the ground lets go, or the hold would put it back.
    if (this.landed || this.settleLeft > 0) this.liftOff();
    else if (this.holdOn) this.release(null);
    const body = this.body;
    body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    body.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.attitude.copy(quaternion);
    this.pos.copy(pos);
    // The drawn hull, its rooms and anything framed on it follow at once, not on the next update.
    this.group.position.copy(pos);
    this.group.quaternion.copy(quaternion);
    this.group.updateMatrixWorld(true);
    this.stick.set(0, 0);
    this.spin.set(0, 0, 0);
    this.commandedValid = false;
    this.skipHitCheck = true;
    this.hitCooldown = 0;
    this.prevVelValid = false;
    fwd.set(0, 0, 1).applyQuaternion(quaternion).multiplyScalar(speed);
    body.setLinvel({ x: fwd.x, y: fwd.y, z: fwd.z }, true);
    this.cruise = speed;
    this.speed = speed;
    for (const t of this.trails) t.clear();
  }

  /** Back from a pause (`held`): flight goes on at the cruise it had, and the first step is not taken for a collision. */
  resumeFlight(): void {
    this.held = false;
    this.commandedValid = false;
  }

  /**
   * Where the first-person view sits, in the model's frame: the cockpit point with the cockpit file's offset. For a ship
   * from the ships pack with a cockpit frame this is the frame's own camera point plus 1OFF (the hull's share of it,
   * `cockpitShare`), the one eye used hovering and flying alike (the seated pilot's eyes are placed on it, and the body under them).
   */
  cockpitEye(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.cockpit) return null;
    const k = this.cockpitShare;
    return out.set(this.cockpit[0] + this.cockpitOffset[0] * k, this.cockpit[1] + this.cockpitOffset[1] * k, this.cockpit[2] + this.cockpitOffset[2] * k);
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

  /**
   * Turn a standing hull to face a heading, upright: the body, the flight attitude and the drawn group
   * together. For the moment a vehicle is stood (a ship turned along the room it was spawned in); it is
   * not for a hull in flight, which turns through its own controls.
   */
  faceHeading(heading: number): void {
    e.set(0, heading, 0, 'YXZ');
    q.setFromEuler(e);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setAngvel(STILL, true);
    this.attitude.copy(q);
    this.group.quaternion.copy(q);
    this.group.updateMatrixWorld(true);
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
    // A collision another ship found before this one stepped is shown as this step's hit.
    const kept = this.keptHit;
    this.keptHit = 0;
    this.steppedAt = physics.steps;
    // The floor this step: the terrain outside, the room's own surfaces while the vehicle stands in a
    // building (a room overhangs its shell, so the terrain under it is not its floor, and the terrain's
    // own reset must not fire there). The room's is a bound field, so no closure is made per step.
    this.stepPhysics = physics;
    this.stepGround = groundAt ?? null;
    const ground = this.inRoom ? this.roomFloorAt : groundAt;
    const water = this.inRoom ? undefined : waterAt;
    // A ship that is down, or coming down, is the landing rule's before anything else reads the hull;
    // it gives the hull back (false) when the pilot opens up again.
    if (s.ship && (this.landed || this.settleLeft > 0) && this.groundShip(dt, drive)) {
      this.justHit = kept;
      this.onUpdate?.(dt, this, drive);
      return;
    }
    if (this.holdOn) {
      // Something else holds the hull at a pose of its own: written before the step, so nothing lags a frame.
      this.writeHold();
      this.justHit = kept;
      this.onUpdate?.(dt, this, drive);
      return;
    }
    if (this.held) {
      // A jump holds the hull still where it is (in the tunnel, or waiting for the world ahead): no flight, no wings.
      body.setLinvel(STILL, true);
      body.setAngvel(STILL, true);
      const t = body.translation();
      this.pos.set(t.x, t.y, t.z);
      this.quaternion(q);
      this.justHit = kept;
      this.commandedValid = false;
      this.group.position.copy(this.pos);
      this.group.quaternion.copy(q);
      this.onUpdate?.(dt, this, null);
      return;
    }
    this.hopCd = Math.max(0, this.hopCd - dt);
    this.updateWings(dt);
    // With its engines cut there is nothing to fly it with: gravity and the contacts have the hull.
    const cutOut = !!s.ship && !this.powered && !this.space && SHIP_GROUND.rule === 'landing';
    // Out in space a ship once flying stays flying however slow, so the set-down is asked before the flight
    // model runs; it says no to everything except a hull that has nearly stopped over something within reach.
    if (s.ship && this.space && SHIP_GROUND.rule === 'landing' && this.groundShip(dt, drive)) {
      this.justHit = kept;
      this.onUpdate?.(dt, this, drive);
      return;
    }
    if (s.ship && !cutOut && this.flyShip(dt, drive, physics, ground, water)) {
      if (kept > this.justHit) this.justHit = kept;
      this.group.position.copy(this.pos);
      this.group.quaternion.copy(q);
      this.onUpdate?.(dt, this, drive);
      return;
    }
    // Not flying: the landing rule puts it down when the pilot asks, and catches a hull coming down
    // with its engines cut. It gives the hull back (false) to hover on its springs as it always did.
    if (s.ship && this.groundShip(dt, drive)) {
      this.justHit = kept;
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
    this.justHit = kept;
    if (this.prevVelValid && !this.skipHitCheck && !s.ship) {
      const lost = this.prevVel.distanceTo(lv);
      if (lost > HIT_THRESHOLD) {
        this.justHit = lost;
        this.hurtHull((lost - HIT_THRESHOLD) * HIT_DAMAGE);
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
    //
    // `waterAt` here is the terrain's own height, lava tables and all, and that is **deliberate**:
    // a flow holds a speeder up exactly as a lake does, and what a flow costs is taken off the hull
    // instead (the world's hazard tick, which the client's own immunity list can excuse -- see
    // `lavaImmune` above). Filtering lava out here -- as the feet, the ripples and the swim line all
    // do -- would drop the hull through the flow onto the bed, which is not what riding over one
    // looks like.
    const height = s.bounds.max[1] - s.bounds.min[1];
    const floorAt = (x: number, z: number) => {
      const solid = ground ? ground(x, z) : -Infinity;
      const wet = water ? water(x, z) : -Infinity;
      return Math.max(solid, s.animal ? wet - height * 0.55 : wet);
    };
    this.onWater = !!water && !!ground && water(this.pos.x, this.pos.z) > ground(this.pos.x, this.pos.z) + 0.05 && this.pos.y - s.bounds.min[1] < water(this.pos.x, this.pos.z) + ride * 1.6 + 0.3;
    if (!flying) {
      for (const hp of this.hoverPoints) {
        p.copy(hp).applyQuaternion(q).add(this.pos);
        // The ray starts at the collider's centre height over the corner, so a corner pushed
        // into the ground still reads a (negative) distance and is lifted out.
        // Inside a building the shells and the terrain are not its floor, as they are not the mobiles'.
        const hit = physics.groundDistance(p.x, p.y + drop, p.z, drop + ride * 2.2 + 0.5, body, this.inRoom ? FLOOR_INSIDE : undefined);
        let dist = hit === null ? null : hit - drop;
        if (water) {
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
      if (ground && !s.animal) {
        let under = 0;
        for (const hp of this.hoverPoints) {
          p.copy(hp).applyQuaternion(q).add(this.pos);
          const floor = ground(p.x, p.z);
          if (Number.isFinite(floor)) under = Math.max(under, floor - p.y);
        }
        if (under > 0.08) {
          this.pos.y += under + 0.02;
          body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
          if (lv.y < -HIT_THRESHOLD) {
            this.justHit = Math.max(this.justHit, -lv.y);
            this.hurtHull((-lv.y - HIT_THRESHOLD) * HIT_DAMAGE);
          }
          if (lv.y < 0) {
            lv.y = 0;
            body.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
            this.skipHitCheck = true;
          }
        }
      }
    } else if (ground) {
      const floor = floorAt(this.pos.x, this.pos.z);
      const h = this.pos.y - s.bounds.min[1] - floor;
      const f = m * (g + 6 * (this.altitude - h) - 3.5 * lv.y);
      if (Number.isFinite(f)) body.addForce({ x: 0, y: f, z: 0 }, true);
      this.groundedPoints = 4;
    }
    // The terrain's own height is a floor under everything: a fast vehicle can outrun the physics
    // ground being streamed in, and a spawn can land a hair inside a slope. Near or below that
    // height with nothing under the corners, hold the ride height off the terrain instead of falling.
    if (ground && this.groundedPoints < 2) {
      const floor = floorAt(this.pos.x, this.pos.z);
      const h = this.pos.y - s.bounds.min[1] - floor;
      if (h < ride * 1.6 + 0.3) {
        const f = m * THREE.MathUtils.clamp(g + 6 * (ride - h) - 3.5 * lv.y, 0, g * 3.5);
        body.addForce({ x: 0, y: f, z: 0 }, true);
        this.groundedPoints = 4;
      }
    }
    // Off the ground, a repulsor still fights gravity: past its cushion the machine sinks at a
    // walking pace rather than dropping, so a ramp gives a glide. Never more than its weight,
    // and only near the ground, so it is not a flyer.
    if (ground && !flying && !s.animal && s.hover >= 0.3 && this.groundedPoints < 2) {
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
    if (ground && grounded && !flying && !s.animal && s.kind !== 'ground') {
      const L = Math.max(1.2, (s.bounds.max[2] - s.bounds.min[2]) * 0.6);
      const W = Math.max(0.8, (s.bounds.max[0] - s.bounds.min[0]) * 0.6);
      right.crossVectors(fwd, WORLD_UP).normalize();
      const ahead = ground(this.pos.x + fwd.x * L, this.pos.z + fwd.z * L);
      const behind = ground(this.pos.x - fwd.x * L, this.pos.z - fwd.z * L);
      const toRight = ground(this.pos.x + right.x * W, this.pos.z + right.z * W);
      const toLeft = ground(this.pos.x - right.x * W, this.pos.z - right.z * W);
      const pitch = THREE.MathUtils.clamp((ahead - behind) / (2 * L), -0.7, 0.7);
      const roll = THREE.MathUtils.clamp((toRight - toLeft) / (2 * W), -0.7, 0.7);
      // The surface normal, tilted back from level by the slopes (a room's floor may answer with nothing).
      if (Number.isFinite(pitch) && Number.isFinite(roll)) wantUp.addScaledVector(fwd, -pitch * SLOPE_FOLLOW).addScaledVector(right, -roll * SLOPE_FOLLOW).normalize();
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
   * A ship's flight, a first model: W builds speed and S bleeds it, the stick (the mouse's cursor)
   * turns and pitches the ship, A/D roll; the body is flown by hand (no gravity, its velocity
   * and attitude set each step) and stays above the ground. Below a few metres a second with the
   * gear near the ground it lands and is a flyer on its springs again. Returns whether it flew.
   */
  private flyShip(dt: number, drive: DriveInput | null, physics: Physics, groundAt?: (x: number, z: number) => number, waterAt?: (x: number, z: number) => number): boolean {
    const s = this.spec;
    const body = this.body;
    const t = body.translation();
    this.pos.set(t.x, t.y, t.z);
    this.quaternion(q);
    const floor = Math.max(groundAt ? groundAt(this.pos.x, this.pos.z) : -Infinity, waterAt ? waterAt(this.pos.x, this.pos.z) : -Infinity);
    const h = this.pos.y - s.bounds.min[1] - floor;
    // The wings' rule reads the closed belly's height; the ground easing and the slow hold read the
    // lowest point of the wings as they hang now (`hw`). The crash and the landing stay on the belly.
    this.aboveGround = h;
    const hw = h - this.wingBelow;
    const throttle = drive?.throttle ?? 0;
    // Something solid was hit: the step took speed off the hull that the last frame commanded
    // (a building, an asteroid, a station). The hull bounces off with most of its speed gone
    // and is hurt by what it lost, and for a moment nothing is commanded, so the contacts can
    // push it clear rather than the throttle driving it deeper in, which wedged it there.
    this.justHit = 0;
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    // A hull in a jump (ghosted) is not tested: at jump speed a slow frame's damping alone reads as a crash.
    if (this.airborne && this.commandedValid && this.hitCooldown <= 0 && !this.ghost) {
      const lv = body.linvel();
      const lost = Math.hypot(this.commanded.x - lv.x, this.commanded.y - lv.y, this.commanded.z - lv.z);
      if (lost > SHIP_HIT_LOSS) {
        this.justHit = lost;
        // Another ship's hull, if that is what it met: that one is hurt too, by what it lost, which the momentum the
        // contact moved gives from this hull's loss (times this mass over that one's), whether or not it can measure
        // its own (held by a pause, in its own hit's moment, hovering on its springs). Anything else (a station, an
        // asteroid, the Star Destroyer) hurts only this hull, uncapped. A collision between two ships is capped by each ship's own stats.
        const other = this.shipTouched(physics.world);
        this.hurtHull((lost - SHIP_HIT_LOSS) * HIT_DAMAGE, other);
        this.cruise = Math.min(this.cruise, Math.max(4, this.cruise * 0.3));
        this.hitCooldown = SHIP_HIT_FREE;
        if (other) other.rammed(this, partnerLoss(lost, body.mass(), other.body.mass()), physics.steps);
      }
    }
    this.commandedValid = false;
    // Space has the room for twice the speed the ground shows.
    // With the wings open, a chassis with a wing_open_speed_factor pays it off the top (eased in as they open).
    const top = (drive?.boost ? s.boostSpeed : s.maxSpeed) * (this.space ? 2 : 1) * wingTopFactor(this.wingOpenFactor, this.wings.progress);
    this.boosting = !!drive?.boost && throttle > 0;
    if (drive?.cruise !== undefined) {
      // An autopilot asks for a speed: the cruise eases toward it at the engines' own rates, within the top speed.
      const want = Math.max(0, Math.min(top, drive.cruise));
      this.cruise = this.cruise < want ? Math.min(want, this.cruise + s.accel * dt) : Math.max(want, this.cruise - s.brake * dt);
    } else if (throttle > 0) this.cruise = Math.min(top, this.cruise + s.accel * dt);
    else if (throttle < 0) this.cruise = Math.max(0, this.cruise - s.brake * dt);
    else if (!drive) this.cruise = Math.max(0, this.cruise - s.brake * 0.5 * dt);
    // Open wings cost their share of the top speed with W up as well (a ship launched at full speed, its wings then
    // opening): a cruise between the open top and the closed one eases down at the brake. A coast above the closed
    // top after a boost is left as it always was.
    if (throttle === 0 && drive && !drive.boost && this.wingOpenFactor < 1 && this.cruise > top && this.cruise <= s.maxSpeed * (this.space ? 2 : 1)) this.cruise = Math.max(top, this.cruise - s.brake * dt);
    // A jump's cruise over all of that: not clamped to the ship's top speed, not bled by the idle brake.
    if (this.jumpCruise !== null) this.cruise = this.jumpCruise;
    this.speed = this.cruise;
    const wasAirborne = this.airborne;
    // In space a ship once flying stays in flight however slow (nothing to land on: see the floor below).
    this.airborne = this.cruise > 4 || (wasAirborne && (this.space || h > s.fly!.floor + 1));
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
    // Flown like a flight sim: the stick asks for turning rates about the ship's own axes, and the
    // ship's inertia lets those rates build up and die away over a moment, so a turn carries on a
    // little after the stick comes back and a freighter takes longer to answer than a fighter. The
    // stick is held where the drive puts it (the player's mouse cursor, an NPC pilot's hand) for as
    // long as it is given; with none given it comes back to the middle. A and D roll, Space and X
    // pitch, and nothing levels it out: it can fly on its back and loop.
    const rate = s.turnRate;
    const stick = this.stick;
    if (drive?.stickX !== undefined) {
      stick.set(THREE.MathUtils.clamp(drive.stickX, -1, 1), THREE.MathUtils.clamp(drive.stickY ?? 0, -1, 1));
    } else {
      const centre = Math.min(1, 2.5 * dt);
      stick.x -= stick.x * centre;
      stick.y -= stick.y * centre;
    }
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
    let toGround = fwd.y < -0.02 ? hw / (-fwd.y * Math.max(this.cruise, 1)) : Infinity;
    // The ground ahead as well as below: a slope or a cliff on the course, within a couple of
    // seconds' flying, counts as ground coming up, so the nose is eased over it.
    if (!this.space && groundAt && this.cruise > 4) {
      const ahead = Math.min(2.5 * this.cruise, 200);
      const gAhead = groundAt(this.pos.x + fwd.x * ahead, this.pos.z + fwd.z * ahead);
      const belly = this.pos.y + s.bounds.min[1] - this.wingBelow + fwd.y * ahead;
      if (gAhead + minH > belly) toGround = Math.min(toGround, THREE.MathUtils.clamp(((belly - gAhead) / minH) * 2.5, 0, 2.5));
    }
    const tooLow = !this.space && (hw < minH || toGround < 2.5);
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
    // Space has no ground: its procedural ground is a plane at the zone's base, 3 km down, never built but still what
    // `groundAt` answers, and holding a slow ship over it or stopping a sinking one there made an invisible floor with
    // half the stations under it. There a slow or stopped ship hangs where it is.
    // Stopped with the engines running, a ship holds the height it is at rather than sinking (the landing
    // rule), but the pilot still flies it up and down by hand at the rate it always sank at: Ctrl sinks
    // it, which is what brings it down to where it can be set down, and Space lifts it. With the engines
    // out, and under the older springs rule, it sinks as it always did.
    const vtol = SHIP_GROUND.rule === 'landing' && this.powered ? (drive?.down ? -1.5 : drive?.up ? 1.5 : 0) : -1.5;
    if (this.cruise < 8 && !this.space) tmp.y += this.cruise < 2 ? vtol : THREE.MathUtils.clamp((minH - hw) * 1.5, -2, 4);
    if (!this.space && h < s.fly!.floor + 0.5 && tmp.y < 0) tmp.y = 0;
    // Never ask the engine for more than it will move a body (a boost in space asks 440): the cut would read as a hit.
    if (tmp.lengthSq() > BODY_SPEED_CAP * BODY_SPEED_CAP) tmp.setLength(BODY_SPEED_CAP);
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
    // First, so whoever holds the vehicle (an NPC ship's manager, the ship contacts) drops it.
    this.disposed = true;
    // The step's physics and terrain are kept only for the length of a step: held on a disposed hull
    // they would keep a whole world and its terrain alive behind it.
    this.stepPhysics = null;
    this.stepGround = null;
    this.holdFrame = null;
    for (const h of this.colliderHandles) if (HULLS.get(h) === this) HULLS.delete(h);
    this.combat?.dispose();
    this.combat = null;
    this.interior?.dispose();
    this.interior = null;
    // A parked glow's trail (a refit left it spare) is disposed with the live ones.
    for (const g of this.glows) {
      const t = g.userData.trail as import('./trail').EngineTrail | undefined;
      if (t && !this.trails.includes(t)) t.dispose(scene);
    }
    for (const t of this.trails) t.dispose(scene);
    this.trails = [];
    this.glows = [];
    // The paint's own copies leave the world's material sets (its `forget`) and are disposed; the GLB's materials stay.
    this.paint?.dispose();
    this.paint = null;
    physics.world.removeRigidBody(this.body);
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !(m.userData.shared as boolean | undefined)) m.geometry.dispose();
    });
  }
}
