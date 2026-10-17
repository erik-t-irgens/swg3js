// A race drive stepped over stand-ins for the body and the physics, for the tests that need the drive's own turn and
// speed without a physics world (raceView.test.ts). Not a test itself. The stand-in body moves by its own velocity over
// the fixed steps the stand-in physics takes, as Rapier's would; the ground is flat at nought and nothing stands on it.
import * as THREE from 'three';
import { RaceDrive, type RaceGround } from '../../../src/vehicles/raceDrive.ts';
import type { DriveInput, Vehicle } from '../../../src/vehicles/vehicle.ts';
import type { Physics } from '../../../src/core/physics.ts';

const FIXED = 1 / 60;
const flat = (): number => 0;
const reader: RaceGround = { near: flat, far: () => 0, farStep: 16, farX: () => 0, farZ: () => 0, water: () => -Infinity };

export interface StandInRun {
  race: RaceDrive;
  vehicle: Vehicle;
  drive: DriveInput;
  /** One frame of play: the drive's step, then the stand-in physics. */
  frame(dt: number): void;
}

/** The liquid a run is stepped over, where a test hands one: its surface's height and whether that liquid is a flow. */
export interface StandInLiquid {
  water?: ((x: number, z: number) => number) | null;
  lava?: ((x: number, z: number) => boolean) | null;
}

/** A pod (or a bike in racing mode) at `speed` along +z on flat ground, its drive at `levels`. */
export function standInRun(kind: 'pod' | 'bike', levels: 'max' | 'stock', speed: number, liquid: StandInLiquid = {}): StandInRun {
  const t = { x: 0, y: 1.2, z: 0 };
  const lv = { x: 0, y: 0, z: speed };
  const av = { x: 0, y: 0, z: 0 };
  const rot = { x: 0, y: 0, z: 0, w: 1 };
  let gravity = 1;
  let damping = 0.12;
  const body = {
    isValid: () => true,
    gravityScale: () => gravity,
    setGravityScale: (g: number) => {
      gravity = g;
    },
    linearDamping: () => damping,
    setLinearDamping: (d: number) => {
      damping = d;
    },
    translation: () => t,
    linvel: () => lv,
    angvel: () => av,
    setTranslation: (p: { x: number; y: number; z: number }) => {
      t.x = p.x;
      t.y = p.y;
      t.z = p.z;
    },
    setRotation: (q: { x: number; y: number; z: number; w: number }) => {
      rot.x = q.x;
      rot.y = q.y;
      rot.z = q.z;
      rot.w = q.w;
    },
    setLinvel: (v: { x: number; y: number; z: number }) => {
      lv.x = v.x;
      lv.y = v.y;
      lv.z = v.z;
    },
    setAngvel: () => {},
  };
  const bounds = kind === 'pod' ? { min: [-3, 0, -6], max: [3, 2.5, 6] } : { min: [-0.45, 0, -2.05], max: [0.45, 1.16, 2.05] };
  const vehicle = {
    body,
    pos: new THREE.Vector3(t.x, t.y, t.z),
    group: new THREE.Group(),
    heading: 0,
    spec: { bounds, raceBox: kind === 'pod' ? [7, 3, 15] : [1, 1.3, 3.6], maxSpeed: 85, boostSpeed: 125, ship: false },
    quaternion: (out: THREE.Quaternion) => out.set(rot.x, rot.y, rot.z, rot.w),
    setRaceHull: () => {},
    handBack: () => {},
    inRoom: false,
    held: false,
    holding: false,
    ghosted: false,
    destroyed: false,
    disposed: false,
    drift: false,
    speed: 0,
    steer: 0,
    boosting: false,
    meter: 0,
    overheated: 0,
    groundedPoints: 4,
    onWater: false,
    upsideDown: false,
    flipped: false,
    lean: 0,
    justHit: 0,
    hp: 100,
    raceHurt: () => {},
    raceWreck: () => {},
  } as unknown as Vehicle;
  const clock = { acc: 0, steps: 0 };
  const physics = {
    get steps() {
      return clock.steps;
    },
    stepsAhead(dt: number): number {
      let a = clock.acc + dt;
      let n = 0;
      while (a >= FIXED && n < 4) {
        a -= FIXED;
        n++;
      }
      return n;
    },
    step(dt: number): void {
      clock.acc += dt;
      let n = 0;
      while (clock.acc >= FIXED && n < 4) {
        t.x += lv.x * FIXED;
        t.y += lv.y * FIXED;
        t.z += lv.z * FIXED;
        clock.acc -= FIXED;
        n++;
        clock.steps++;
      }
      if (n === 4) clock.acc = 0;
    },
    topSurface: () => null,
  } as unknown as Physics;
  const water = liquid.water ?? null;
  const lava = liquid.lava ?? null;
  const race = new RaceDrive(kind, { ground: water ? { ...reader, water } : reader });
  race.setLevels(levels, vehicle);
  if (race.modes) race.setMode(vehicle, 'racing');
  const drive: DriveInput = { throttle: 1, steer: 0, heading: null, boost: false, hop: false, up: false, down: false, vertical: 0 };
  return {
    race,
    vehicle,
    drive,
    frame(dt: number): void {
      race.step(vehicle, dt, drive, flat, water, lava, physics);
      physics.step(dt);
    },
  };
}
