// A shuttle trip flown (src/world/shuttleRide.ts), end to end against a hull, a host and a clock of the
// test's own: the made-up flyable rig of `rigFixtures.ts` built into a real RigHull and hung in a fake
// hull that records every hold, release and launch, the drawn shuttles stood in for by a record of the
// holds on each pad and the sounds lent and driven (and once by the real `ShuttleRigs`, where what is
// held is the whole point), and a pad's round that the test moves on itself.
//
// What is held to: the empty hop runs its legs in order to the end; the hull stands where the pad's own
// shuttle would at the swap and follows its clock up to the cut, its limbs posed from the same clip at
// the same moment; its nose comes round onto its path without a snap, and at the cut it is let go along
// the way it was really moving at the speed it was really moving, both read off the hull's own last two
// holds; the landing starts where the flight left it, its limbs posed from the landing's own clip;
// parked it is solid and flying it is not, leaving included; empty it flies off and is taken away only
// once it has been out of sight a whole `vanishUnseen`; a hull landing with another branch than it took
// off on has its sounds and flames bound to that branch; and every way a trip ends -- landed and gone,
// its hull taken away under it, aborted in any leg or while its hull was still being built -- leaves no
// hold on either pad, no sounds driven and no hull, with every pad given back softly except one the hull
// stands parked on exactly where that pad's own shuttle parks, which is given back at once, by the
// release that takes its count to nought. A frame of a trip makes nothing: read in the code itself, and
// measured as what a stretch of frames allocates against the same stretch without the trip's own work.
//
// And a trip somebody rides: seated and hidden in the step the hull is swapped in, counted down to the
// lift-off with the bar offering to step off, flown between its clips by its own pilot through a fake
// flight model that turns as flyShip does (the drive it reads the same object every frame), landed, and
// let off at the foot of the ramp after a moment; kept, if saved on the way, where they boarded until it
// lifts off and where the ticket goes after; stepping off while it waits gives the ticket back, E in the
// air only says why not, a hull ready too late or a passenger no longer there is missed with the ticket
// back, a far pad with no rig sets the passenger down at the port at the cut, and stopping the trip in
// any leg leaves nobody seated, nobody hidden and nothing held -- once it has lifted off, with the
// passenger set down at the port it was flying to rather than left in the air, unless whoever stopped
// it moves the body itself -- and the host is told exactly once that it has ended. A ship coming at it and a wall ahead each
// send the hull up over them, against the same flight with nothing there; its look ahead never reaches
// past the end of its course; and a pass knocked wide of the join is flown round again and still lands.
//
// And a trip through space, with a jump stood in that runs the game's own stages in the game's own frame
// order: every leg flown in order and started and ended in pairs, the crossing up made only past the space
// gate (or after `climbMaxSeconds` over ground that never falls away) and the one down exactly where it
// should come out -- how far from the pad, on which side of it and facing what, clamped to the reach the far
// world loads out to -- the hull ghosted on every frame it flies, the jump's own release included, the
// jump flown with the trip's own hull for that leg alone and its stick let go of while the jump has it; a
// trip within one system faced across and flown to the far world's place, jumped instead past
// `jumpBeyond`, and gone on from after `acrossMaxSeconds` where the place is never worked out; a jump
// refused, or failing twice, and a crossing up that gets nowhere, each given up for a skip that still
// lands on the far pad; no pad over there setting the passenger down at the port after the flight; a
// hull lost in space setting its passenger down at the port exactly once; and legs put in only after the
// one flown now.
//
// And nothing of a trip made where it can be seen: its hull built, then its effects made ready, then shown
// (a trip stopped in between throwing the hull away unshown); a crossing's hull made ready before the
// crossing answers, behind its loading screen; the portal renderer's own draws compiled by the loading
// screen's sweep; the console refusing a shuttle while a world loads, before it builds anything. The
// crossing down comes out on the landing's own line on the ride's own glide and is flown straight in; and
// a passenger kept at, or put down by, a collector is stood beside it and never on its spot.
//
// Run: node --expose-gc tools/swg/tests/shuttleRide.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import * as THREE from 'three';
import { FLYING, flyingRig } from './rigFixtures.ts';
import { Physics } from '../../../src/core/physics.ts';
import { RigHull, assembleRigModel } from '../../../src/vehicles/rigHull.ts';
import type { DriveInput } from '../../../src/vehicles/vehicle';
import { SPACE_LATER, planHop, planRoute, type PadRef, type RideLeg } from '../../../src/world/rideRoute.ts';
import { RIG_PATH_TUNE, landingTarget, makeLandingTarget, noseOntoPath, onPad, pathPose, pathVelocity, poseRigAction, turnOnPad, vehicleAt, vehicleFromJoint, type RigActions } from '../../../src/world/rigPath.ts';
import { RIDE_TUNE, ShuttleRide, besideCollector, downGlideOf, heldHeading, holdRoomHeading, rideFraming, stepFraming, type RideHost, type RideHull, type RideRigs } from '../../../src/world/shuttleRide.ts';
import { RIDE_PILOT, type RideCourse } from '../../../src/world/shuttleCourse.ts';
import { lookRotation } from '../../../src/space/hyperspaceMath.ts';
import { CHASE_RISE } from '../../../src/core/camera.ts';
import { SHUTTLE_RIG_TUNE, ShuttleRigs, type RigDrive, type RigFx } from '../../../src/world/shuttleRigs.ts';
import { rigPose, type RigClips, type RigPose, type ShuttleState, type Ticket } from '../../../src/world/travelTerminal.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const deg = (rad: number) => THREE.MathUtils.radToDeg(rad).toFixed(3);

// ---------------------------------------------------------------- the hull, the drawn shuttles, the host

const fly = flyingRig();

/** A hull as a Vehicle is to a trip, flying straight along its nose at its cruise whenever it is not held. */
class FakeHull implements RideHull {
  readonly pos = new THREE.Vector3();
  readonly group = new THREE.Group();
  readonly radius: number;
  readonly spec: { maxSpeed: number; turnRate: number; bounds: { min: number[]; max: number[] } };
  /** The rig block carried by value on its def, as a garage hull's is: what a set of sounds is made from afresh after a crossing. */
  readonly def = { rig: { rig: fly.block } };
  cruise = 0;
  speed = 0;
  airborne = false;
  disposed = false;
  ghosted = true;
  autopilot: { readonly drive: DriveInput; readonly unpaused?: boolean } | null = null;
  readonly rig: RigHull;
  held = true;
  holds = 0;
  launches = 0;
  releases = 0;
  readonly velocity = new THREE.Vector3();
  /** The pose and speed of the last hold, and of the hold a launch let go of. */
  readonly heldAt = new THREE.Vector3();
  readonly heldTurn = new THREE.Quaternion();
  heldSpeed = 0;
  readonly launchedFrom = new THREE.Vector3();
  readonly launchedTurn = new THREE.Quaternion();
  /** `moods` gives the hull's rig every branch it has; by default the flyable rig's one. */
  constructor(moods: Record<string, RigClips> = fly.block.moods) {
    const assembled = assembleRigModel({ scene: fly.skeleton.scene.clone(true), animations: fly.skeleton.animations }, fly.pieces.map((p) => ({ joint: p.joint, model: p.model.clone(true) })), 'hold', fly.clips);
    this.rig = new RigHull(assembled, fly.clips, moods);
    const f = this.rig.frame()!;
    this.spec = { maxSpeed: 150, turnRate: 0.6, bounds: { min: [-f.halfW, 0, -f.halfL], max: [f.halfW, f.h, f.halfL] } };
    this.radius = Math.max(f.halfW, f.halfL);
    this.group.add(this.rig.model);
  }
  hold(_frame: THREE.Matrix4 | null, pos: THREE.Vector3, quat: THREE.Quaternion, speed = 0): void {
    this.held = true;
    this.holds++;
    this.pos.copy(pos);
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
    this.speed = speed;
    this.heldAt.copy(pos);
    this.heldTurn.copy(quat);
    this.heldSpeed = speed;
  }
  release(): void {
    this.held = false;
    this.releases++;
    this.velocity.set(0, 0, 0);
  }
  launch(speed: number): void {
    this.launches++;
    this.cruise = speed;
    this.speed = speed;
    this.airborne = true;
    this.launchedFrom.copy(this.pos);
    this.launchedTurn.copy(this.group.quaternion);
    this.velocity.set(0, 0, 1).applyQuaternion(this.group.quaternion).multiplyScalar(speed);
    this.spin.set(0, 0, 0);
  }
  setGhost(on: boolean): void {
    this.ghosted = on;
  }
  /** The turn rates flyShip keeps between steps, eased toward the stick's. */
  private readonly spin = new THREE.Vector3();
  private readonly turnBy = new THREE.Quaternion();
  /**
   * What flyShip does between holds, as much as a trip needs: its cruise eased toward the drive's
   * within its top speed, the turn rates eased toward the stick's over the rig hull's inertia and the
   * hull turned by them in its own axes, and straight on along its nose.
   */
  step(dt: number): void {
    if (this.held || this.disposed) return;
    const d = this.autopilot?.drive;
    const want = d?.cruise;
    if (want !== undefined) {
      const top = Math.min(this.spec.maxSpeed, want);
      this.cruise = this.cruise < top ? Math.min(top, this.cruise + 20 * dt) : Math.max(top, this.cruise - 25 * dt);
    }
    if (d && d.stickX !== undefined) {
      const rate = this.spec.turnRate;
      const ease = Math.min(1, dt / 1.2);
      const easeRoll = Math.min(1, (2 * dt) / 1.2);
      this.spin.y += (-(d.stickX ?? 0) * rate * 1.5 - this.spin.y) * ease;
      this.spin.x += ((d.stickY ?? 0) * rate * 1.5 - this.spin.x) * ease;
      this.spin.z += ((d.steer ?? 0) * rate * 1.6 - this.spin.z) * easeRoll;
      const q = this.group.quaternion;
      q.multiply(this.turnBy.setFromAxisAngle(AXIS_Y, this.spin.y * dt));
      q.multiply(this.turnBy.setFromAxisAngle(AXIS_X, this.spin.x * dt));
      q.multiply(this.turnBy.setFromAxisAngle(AXIS_Z, this.spin.z * dt));
      q.normalize();
    }
    this.speed = this.cruise;
    this.velocity.set(0, 0, 1).applyQuaternion(this.group.quaternion).multiplyScalar(this.cruise);
    this.pos.addScaledVector(this.velocity, dt);
    this.group.position.copy(this.pos);
  }
}
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * The drawn shuttles, as a record: each pad's hold count, every hold and release with whether it was at
 * once and the count it left, what was lent, driven and bound again from another branch. The count rule
 * is the real one's: a release gives a pad back, at once or softly, only when it takes the count to nought.
 */
class FakeRigs implements RideRigs {
  readonly counts = new Map<string, number>();
  readonly nowHolds: string[] = [];
  readonly releases: { key: string; now: boolean; left: number }[] = [];
  readonly fx = { lent: true } as unknown as RigFx;
  lentFrom = '';
  driven = new Map<RigFx, () => RigDrive | null>();
  undriven = 0;
  readonly rebranched: string[] = [];
  hold(key: string, now = false): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    if (now) this.nowHolds.push(key);
  }
  release(key: string, now = false): void {
    const n = (this.counts.get(key) ?? 0) - 1;
    assert.ok(n >= 0, `a hold on ${key} let go of more times than it was taken`);
    this.counts.set(key, n);
    this.releases.push({ key, now, left: n });
  }
  lend(key: string): RigFx | null {
    this.lentFrom = key;
    return this.fx;
  }
  /** Every set made afresh (a hull built again after a crossing), with what it was made for. */
  readonly made: { fx: RigFx; mood: string; inside: boolean }[] = [];
  fxFor(_rig: unknown, mood: string, _joints: THREE.Object3D, inside: boolean): RigFx {
    const fx = { made: this.made.length + 1 } as unknown as RigFx;
    this.made.push({ fx, mood, inside });
    return fx;
  }
  rebranch(_fx: RigFx, mood: string): boolean {
    this.rebranched.push(mood);
    return true;
  }
  /** Every time a rig's effects were made ready, with the branches asked for; `onReady` is told as each is asked, and `readyWith` is what each answers with. */
  readonly readied: string[][] = [];
  onReady: () => void = () => {};
  readyWith: () => Promise<unknown> = () => Promise.resolve();
  ready(_rig: unknown, moods: readonly string[]): Promise<unknown> {
    this.readied.push([...moods]);
    this.onReady();
    return this.readyWith();
  }
  drive(fx: RigFx, pose: () => RigDrive | null): void {
    this.driven.set(fx, pose);
  }
  undrive(fx: RigFx): void {
    this.driven.delete(fx);
    this.undriven++;
  }
  held(key: string): number {
    return this.counts.get(key) ?? 0;
  }
  /** The release that gave a pad back (took its count to nought) last, or null. */
  gaveBack(key: string): { now: boolean } | null {
    for (let i = this.releases.length - 1; i >= 0; i--) if (this.releases[i].key === key && this.releases[i].left === 0) return this.releases[i];
    return null;
  }
  /** Every hold let go of and nothing driven: what every end of a trip must leave. */
  tidy(): boolean {
    return [...this.counts.values()].every((n) => n === 0) && this.driven.size === 0;
  }
}

/**
 * Each pad's round, moved on by the test: waiting until `wait`, then lifting off over the rig's lift-off,
 * then away. `late` puts a pad's round that many seconds behind the clock.
 */
const WAIT = 5;
/**
 * The passenger, as the host keeps them: seated in a hull or not, where they were put down, the tickets
 * given back and what was said, and whether they were set down at a port the old way. `canSeat` false is
 * somebody no longer there to board.
 */
interface Passenger {
  canSeat: boolean;
  seatedIn: RideHull | null;
  seats: number;
  offAt: THREE.Vector3[];
  given: string[];
  said: string[];
  walkedTo: string[];
  cleared: string[];
  ships: { pos: THREE.Vector3; vel: THREE.Vector3; radius: number }[];
  rays: number;
  obstacleAt: number;
  /** Every trip the host was told has ended, in order, and what had been given back and said by then. */
  ended: { ride: ShuttleRide; running: boolean; given: number; seated: boolean }[];
}
function makeHost(hull: FakeHull | (() => Promise<FakeHull | null>), rigs: RideRigs, camera: THREE.Camera) {
  const clock = { t: 0 };
  const world = new Set<RideHull>();
  const counts = { shown: 0, disposed: 0 };
  const late = new Map<string, number>();
  const passenger: Passenger = { canSeat: true, seatedIn: null, seats: 0, offAt: [], given: [], said: [], walkedTo: [], cleared: [], ships: [], rays: 0, obstacleAt: Infinity, ended: [] };
  /** The pack of the world the game stands in: every pad of the plain tests is on it, and a crossing moves it. */
  const current = { world: 'test' };
  const host: RideHost = {
    world: () => current.world,
    // No crossing unless a test stands one in (`crossings`): a trip that asks for one here gets none.
    cross: async () => null,
    clearPad: (pad) => void passenger.cleared.push(pad.key),
    seat: (h) => {
      if (!passenger.canSeat) return false;
      passenger.seatedIn = h;
      passenger.seats++;
      return true;
    },
    unseat: (h, at) => {
      assert.ok(passenger.seatedIn === h, 'a passenger is put down off the hull they are seated in');
      passenger.seatedIn = null;
      passenger.offAt.push(at.clone());
    },
    groundCached: () => 0,
    castAhead: () => {
      passenger.rays++;
      return passenger.obstacleAt;
    },
    eachShip: (_h, visit) => {
      for (const s of passenger.ships) visit(s.pos, s.vel, s.radius);
    },
    say: (text) => void passenger.said.push(text),
    giveBack: (id) => void passenger.given.push(id),
    walkOff: (_pack, port) => void passenger.walkedTo.push(port),
    ended: (ride) => void passenger.ended.push({ ride, running: ride.running, given: passenger.given.length, seated: passenger.seatedIn !== null }),
    buildHull: async () => (typeof hull === 'function' ? hull() : hull),
    showHull: (h) => {
      counts.shown++;
      world.add(h);
    },
    disposeHull: (h) => {
      counts.disposed++;
      (h as FakeHull).disposed = true;
      world.delete(h);
    },
    alive: (h) => world.has(h),
    now: () => clock.t,
    round: (pad, out: ShuttleState) => {
      const t = clock.t - (late.get(pad.key) ?? 0);
      if (t < WAIT) {
        out.phase = 'waiting';
        out.left = WAIT - t;
        out.glide = 1;
      } else if (t < WAIT + pad.times.lift) {
        out.phase = 'leaving';
        out.left = 0;
        out.glide = 1 - (t - WAIT) / pad.times.lift;
      } else {
        out.phase = 'away';
        out.glide = 0;
      }
      out.until = 0;
      return out;
    },
    rigs,
    camera: () => camera,
    floorAt: (_x, y) => y - 2.4,
    inSpace: () => current.world.startsWith('space_'),
    // No flight through space unless a test stands one in (`spaceTrips`).
    heights: { gate: 1100 },
    prefetchSpace: () => {},
    spacePlace: async () => false,
    discDirection: () => false,
    jump: () => 'no jumps here',
    jumpPhase: () => 'idle',
    jumpDrives: () => false,
    jumpAbort: () => {},
    nearRange: () => 1700,
  };
  return { host, clock, world, counts, late, passenger, current };
}

/**
 * A crossing as the game makes one (`travel` with a passenger, then `arriveInShip`), stood in for. It
 * waits until the test lets it go; then, in one step, the world left goes -- the hull with it, the
 * passenger off it, and the drawn shuttles' flown sets cleared -- and, unless it is made to fail, a hull
 * of the same rig comes out in the world arrived at, held where the trip asked, moving at the speed it
 * asked, ghosted, with the passenger seated in it. A refusal answers null at once with nothing moved, as a
 * travel that cannot begin does. `moods` gives the hull that comes out every branch its rig has (by default
 * the flyable rig's one), as the garage builds it again from the same rig.
 */
function crossings(env: ReturnType<typeof makeHost>, rigs: FakeRigs, moods?: Record<string, RigClips>) {
  const made: { from: RideHull; leg: RideLeg; at: THREE.Vector3; turn: THREE.Quaternion; speed: number; hull: FakeHull | null }[] = [];
  /** `mode` for every crossing, unless `plan` still holds one for the next crossing made. */
  const state: { mode: 'arrive' | 'fail' | 'refuse'; plan: ('arrive' | 'fail' | 'refuse')[]; go: (() => void) | null } = { mode: 'arrive', plan: [], go: null };
  env.host.cross = (h, leg, arrival, speed, ready) => {
    const rec = { from: h, leg, at: arrival.pos.clone(), turn: arrival.quaternion.clone(), speed, hull: null as FakeHull | null };
    made.push(rec);
    const mode = state.plan.shift() ?? state.mode;
    if (mode === 'refuse') return Promise.resolve(null);
    return new Promise<RideHull | null>((resolve) => {
      state.go = () => {
        state.go = null;
        if (env.passenger.seatedIn === h) env.passenger.seatedIn = null;
        (h as FakeHull).disposed = true;
        env.world.delete(h);
        rigs.driven.clear();
        env.current.world = leg.world;
        if (mode === 'fail') {
          resolve(null);
          return;
        }
        const nh = new FakeHull(moods);
        nh.hold(null, arrival.pos, arrival.quaternion, speed);
        nh.airborne = true;
        env.world.add(nh);
        env.passenger.seatedIn = nh;
        rec.hull = nh;
        // As the game's travel does: the trip is handed the hull that came out and waited for, behind the
        // loading screen, and only then does the crossing answer (and the screen lift).
        void Promise.resolve(ready(nh)).then(() => resolve(nh));
      };
    });
  };
  return {
    made,
    state,
    /** Let the crossing go, and wait for the trip to have taken up whatever came of it. */
    async go(): Promise<void> {
      state.go?.();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const padAt = (index: number, x: number, y: number, z: number, yaw: number, mood = ''): PadRef => ({
  pack: 'test',
  key: `travel:test:${index}`,
  index,
  port: `Port ${index}`,
  clock: `test|Port ${index}`,
  times: { land: FLYING.land, lift: FLYING.lift },
  x,
  y,
  z,
  yaw,
  cell: 0,
  building: 'b',
  rig: 'flying',
  mood,
  collector: { x: x + 25, y, z },
});
const origin = padAt(0, 100, 20, -30, 0.3);
const destination = padAt(1, 2000, 5, 800, 2.0);

/**
 * Whether a place is where a passenger is stood beside a ticket collector: `collectorClear` metres from its
 * spot toward the pad it serves, at its own height -- worked out here from the two places, not through the
 * function under test -- and so a metre and more clear of the droid, never on its spot.
 */
function clearOfCollector(at: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }, pad: { x: number; z: number }, y = c.y): boolean {
  const w = besideSpot(c, pad);
  return Math.hypot(at.x - w.x, at.z - w.z) < 1e-9 && Math.abs(at.y - y) < 1e-9 && Math.hypot(at.x - c.x, at.z - c.z) >= 1;
}

/** Where beside a collector a passenger is stood, over the ground: `collectorClear` from its spot toward its pad, worked out here. */
function besideSpot(c: { x: number; z: number }, pad: { x: number; z: number }): { x: number; z: number } {
  const l = Math.hypot(pad.x - c.x, pad.z - c.z);
  return { x: c.x + ((pad.x - c.x) / l) * RIDE_TUNE.collectorClear, z: c.z + ((pad.z - c.z) / l) * RIDE_TUNE.collectorClear };
}

/** A camera standing by a pad, looking at it. */
function watching(pad: PadRef): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 20000);
  cam.position.set(pad.x + 40, pad.y + 3, pad.z + 40);
  cam.lookAt(pad.x, pad.y, pad.z);
  cam.updateMatrixWorld(true);
  return cam;
}

/** A trip flown frame by frame with the clock moving with it, the hull flying on between its holds; `each` sees every frame's legs before and after. */
function fly60(ride: ShuttleRide, clock: { t: number }, hull: FakeHull, each: (before: string, now: string) => void = () => {}, frames = 60 * 200): void {
  for (let i = 0; i < frames && ride.running; i++) {
    clock.t += DT;
    const before = ride.leg?.kind ?? '';
    ride.update(DT);
    each(before, ride.leg?.kind ?? 'ended');
    hull.step(DT);
  }
}

const DT = 1 / 60;
const expectPos = new THREE.Vector3();
const expectTurn = new THREE.Quaternion();
const vel = new THREE.Vector3();
const NOSE = new THREE.Vector3(0, 0, 1);

/** Each limb's place relative to the hull joint, as a hull's rig stands posed now. */
function limbs(rig: RigHull): THREE.Matrix4[] {
  rig.model.updateMatrixWorld(true);
  const inv = rig.joints.getObjectByName('hold')!.matrixWorld.clone().invert();
  return ['hold_strut', 'hold_door'].map((n) => inv.clone().multiply(rig.joints.getObjectByName(n)!.matrixWorld));
}
/** How far a hull's limbs stand from a reference rig posed at a role's clip at `seconds`: metres and radians, the worst limb. */
const reference = new FakeHull();
function limbGap(rig: RigHull, role: RigPose['role'], seconds: number, mood: string): { m: number; rad: number } {
  const have = limbs(rig);
  reference.rig.pose(role, seconds, mood);
  const want = limbs(reference.rig);
  let m = 0;
  let rad = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (let i = 0; i < have.length; i++) {
    have[i].decompose(a, qa, s);
    want[i].decompose(b, qb, s);
    m = Math.max(m, a.distanceTo(b));
    rad = Math.max(rad, qa.angleTo(qb));
  }
  return { m, rad };
}
/**
 * The shuttle a hull takes the place of, as the drawn shuttles stand it: the rig's skeleton on a group
 * on the pad, posed by a mixer playing the whole clip. Its hull joint is where the flown hull's must be.
 */
function standing(pad: PadRef): { joint: (role: RigPose['role'], seconds: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion) => void } {
  const joints = fly.skeleton.scene.clone(true);
  const root = new THREE.Group();
  root.position.set(pad.x, pad.y, pad.z);
  root.rotation.y = pad.yaw;
  root.add(joints);
  const mixer = new THREE.AnimationMixer(joints);
  const actions: RigActions['actions'] = {};
  for (const role of ['land', 'lift', 'ground', 'sky'] as const) {
    const clip = fly.skeleton.animations.find((a) => a.name === fly.clips[role]);
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    actions[role] = a;
  }
  const state: RigActions = { mixer, actions, current: null };
  const hold = joints.getObjectByName('hold')!;
  return {
    joint: (role, seconds, outPos, outQuat) => {
      poseRigAction(state, role, seconds);
      root.updateMatrixWorld(true);
      hold.matrixWorld.decompose(outPos, outQuat, new THREE.Vector3());
    },
  };
}
/** A flown hull's hull joint in the world, as it is drawn now. */
function flownJoint(hull: FakeHull, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  hull.group.updateMatrixWorld(true);
  hull.rig.joints.getObjectByName('hold')!.matrixWorld.decompose(outPos, outQuat, new THREE.Vector3());
}

/** How far the limbs move over a clip, so a limb check that could not fail is caught. */
function limbTravel(role: RigPose['role'], from: number, to: number): number {
  reference.rig.pose(role, from, '');
  const a = limbs(reference.rig);
  reference.rig.pose(role, to, '');
  const b = limbs(reference.rig);
  return Math.max(...a.map((m, i) => new THREE.Vector3().setFromMatrixPosition(m).distanceTo(new THREE.Vector3().setFromMatrixPosition(b[i]))));
}

// ---------------------------------------------------------------- the empty hop, end to end

{
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock, counts } = makeHost(hull, rigs, watching(destination));
  const ride = new ShuttleRide(planHop(origin, destination), host);
  clock.t = 2;
  const outcome = await ride.begin();
  ok(outcome === 'flying' && ride.running && !ride.riding && ride.leg?.kind === 'board', 'a hop begun while its shuttle waits on its pad flies, boarding, with nobody seated');
  ok(rigs.nowHolds[0] === origin.key && rigs.held(origin.key) === 1 && rigs.held(destination.key) === 1 && rigs.nowHolds.length === 1, 'the shuttle it takes the place of is held out of the picture at once, the one at the far pad softly');
  ok(counts.shown === 1 && hull.autopilot === ride.autopilot && ride.autopilot.unpaused === true, 'the hull is shown, flown by the trip, and flown on with a panel open');
  ok(rigs.lentFrom === origin.key && rigs.driven.get(rigs.fx)?.()?.role === 'ground', "the shuttle's own sounds and flames are lent to it and driven, parked");
  const paths = hull.rig.paths('')!;
  expectPos.copy(hull.rig.ground.pos);
  expectTurn.copy(hull.rig.ground.quat);
  onPad(origin, expectPos, expectTurn);
  vehicleFromJoint(expectPos, expectTurn, hull.rig.offset, expectPos);
  ok(hull.pos.distanceTo(expectPos) < 1e-9 && hull.group.quaternion.angleTo(expectTurn) < 1e-6 && !hull.ghosted && !hull.airborne, 'it stands where the shuttle parks, solid and on the ground');
  // The same read off the shuttle itself: the flown hull's hull joint where the drawn shuttle's is, parked.
  const stood = standing(origin);
  const flownAt = new THREE.Vector3();
  const flownTurn = new THREE.Quaternion();
  const stoodAt = new THREE.Vector3();
  const stoodTurn = new THREE.Quaternion();
  flownJoint(hull, flownAt, flownTurn);
  stood.joint('ground', 0, stoodAt, stoodTurn);
  ok(flownAt.distanceTo(stoodAt) < 1e-4 && flownTurn.angleTo(stoodTurn) < 1e-4, `its hull joint is where the drawn shuttle's is, parked on that pad (${flownAt.distanceTo(stoodAt).toExponential(1)} m, ${flownTurn.angleTo(stoodTurn).toExponential(1)} rad)`);

  const kinds: string[] = [];
  const roles: string[] = [];
  let followErr = 0;
  let followTurn = 0;
  let followN = 0;
  const landed = standing(destination);
  let landErr = 0;
  let landTurn = 0;
  let landN = 0;
  let cutChecked = false;
  let landChecked = false;
  let offGhosted = false;
  let flyingSolid = false;
  let leaveFrames = 0;
  let parkedFor = 0;
  let alightErr = Infinity;
  let allCarried = true;
  let drives = 0;
  const liftLimbs = { m: 0, rad: 0, n: 0 };
  const landLimbs = { m: 0, rad: 0, n: 0 };
  const leaveLimbs = { m: 0, rad: 0, n: 0 };
  let worstNoseStep = 0;
  const cut = paths.cut!;
  const join = paths.join!;
  const again = hull.rig.paths(paths.landMood)!;
  const joinAt = new THREE.Vector3();
  let prevHolds = 0;
  let landT = 0;
  let leaveT = 0;
  // The hull's hold the frame before, and the moment of the take-off it was held at.
  const prevAt = new THREE.Vector3();
  const prevTurn = new THREE.Quaternion();
  let prevS = NaN;
  const gap = (into: { m: number; rad: number; n: number }, g: { m: number; rad: number }) => {
    into.m = Math.max(into.m, g.m);
    into.rad = Math.max(into.rad, g.rad);
    into.n++;
  };
  for (let i = 0; i < 60 * 200 && ride.running; i++) {
    clock.t += DT;
    const before = ride.leg?.kind ?? '';
    const launches = hull.launches;
    prevAt.copy(hull.heldAt);
    prevTurn.copy(hull.heldTurn);
    ride.update(DT);
    const now = ride.leg?.kind ?? 'ended';
    if (kinds.at(-1) !== now) kinds.push(now);
    const drawn = rigs.driven.get(rigs.fx)?.();
    if (drawn) {
      drives++;
      if (!drawn.carry || drawn.flight !== RIDE_TUNE.flightEvent) allCarried = false;
    }
    const role = drawn?.role;
    if (role && roles.at(-1) !== role) roles.push(role);
    if (now === 'lift' && before === 'lift') {
      const s = clock.t - WAIT;
      // Following the clock, before the nose is brought round: its hull joint exactly where the drawn
      // shuttle's is at that moment of the same clip, read off a mixer posing the whole clip on the pad.
      if (s < cut.t - RIG_PATH_TUNE.align - 0.05) {
        flownJoint(hull, flownAt, flownTurn);
        stood.joint('lift', s, stoodAt, stoodTurn);
        followErr = Math.max(followErr, flownAt.distanceTo(stoodAt));
        followTurn = Math.max(followTurn, flownTurn.angleTo(stoodTurn));
        followN++;
      }
      // Its limbs where the same clip has them at the same moment, and its nose never snapping round.
      gap(liftLimbs, limbGap(hull.rig, 'lift', s, ''));
      worstNoseStep = Math.max(worstNoseStep, prevTurn.angleTo(hull.heldTurn));
      prevS = s;
      if (!hull.ghosted) flyingSolid = true;
    }
    if (hull.launches > launches && !cutChecked) {
      // At the cut, read off the hull's own last two holds rather than off the arithmetic that made them:
      // the nose turns by next to nothing from the frame before, and the hull is let go along the way it
      // was really moving over that last stretch, at the speed it was really moving.
      const moved = hull.launchedFrom.clone().sub(prevAt).divideScalar(cut.t - prevS);
      const noseStep = prevTurn.angleTo(hull.launchedTurn);
      const off = hull.velocity.angleTo(moved);
      ok(noseStep < THREE.MathUtils.degToRad(0.05), `at the cut the nose turns by next to nothing from the frame before (${deg(noseStep)}°): it was brought onto its path over the last ${RIG_PATH_TUNE.align} s, not snapped there`);
      ok(off < 2e-3 && Math.abs(hull.velocity.length() / moved.length() - 1) < 0.01, `and it is let go along the way it was moving over its last frame held, at the speed it was moving (${deg(off)}° off, ${f2(hull.velocity.length())} against ${f2(moved.length())} m/s)`);
      // And, as the arithmetic says, along its nose, which points down the clip's own path.
      pathVelocity(paths.lift, cut.t, vel);
      turnOnPad(origin, vel);
      const nose = NOSE.clone().applyQuaternion(hull.launchedTurn);
      ok(nose.angleTo(vel) < 1e-4 && hull.velocity.angleTo(vel) < 1e-4, `that nose points along the clip's own path there (${nose.angleTo(vel).toExponential(1)} rad off)`);
      ok(hull.releases === 1 && rigs.held(origin.key) === 0 && now === 'skip', 'and the pad it left is given back as it flies on');
      ok(rigs.releases.length === 1 && rigs.releases[0].key === origin.key && !rigs.releases[0].now, "softly: a shuttle put back at once would stand mid-take-off beside the hull that took its place");
      cutChecked = true;
    }
    if (before === 'skip' && now === 'land') {
      joinAt.copy(hull.heldAt);
      prevHolds = hull.holds;
      landT = join.t;
      ok(rigs.nowHolds.at(-1) === destination.key && rigs.held(destination.key) === 1, "put onto the landing, the far pad's own shuttle goes out of the picture that same step, held once");
      ok(rigs.rebranched.length === 0, 'and a hull that lands with the branch it took off on keeps the sounds and flames it has');
    } else if (before === 'land' && now === 'land') {
      landT = Math.min(paths.land.seconds, landT + DT);
      gap(landLimbs, limbGap(hull.rig, 'land', landT, paths.landMood));
      // Settled onto the landing, its hull joint is where the far pad's own shuttle's is on the same clip.
      if (landT > join.t + RIG_PATH_TUNE.settleMax + 0.05) {
        flownJoint(hull, flownAt, flownTurn);
        landed.joint('land', landT, stoodAt, stoodTurn);
        landErr = Math.max(landErr, flownAt.distanceTo(stoodAt));
        landTurn = Math.max(landTurn, flownTurn.angleTo(stoodTurn));
        landN++;
      }
      if (!landChecked && hull.holds > prevHolds) {
        ok(hull.heldAt.distanceTo(joinAt) <= join.speed * DT * 1.5, `the landing goes on from where the hull was handed over, not from anywhere else (${f2(hull.heldAt.distanceTo(joinAt))} m in a frame at ${f2(join.speed)} m/s)`);
        landChecked = true;
      }
    }
    if (before === 'leave' && now === 'leave') {
      leaveFrames++;
      leaveT += DT;
      if (leaveT < again.cut!.t - DT) gap(leaveLimbs, limbGap(hull.rig, 'lift', leaveT, again.liftMood));
      if (!hull.ghosted) flyingSolid = true;
    }
    if (now === 'skip' || now === 'land' || now === 'lift') if (!hull.ghosted) flyingSolid = true;
    if (before === 'land' && now === 'off') {
      // Off the foot of its ramp, a step further out the way the ramp runs, on the floor found under it.
      const foot = hull.rig.rampFoot!.clone();
      foot.x += (foot.x < 0 ? -1 : 1) * RIDE_TUNE.alight;
      hull.group.updateMatrixWorld(true);
      foot.applyMatrix4(hull.group.matrixWorld);
      alightErr = Math.hypot(ride.alightAt.x - foot.x, ride.alightAt.z - foot.z) + Math.abs(ride.alightAt.y - (foot.y - 0.4));
    }
    if (now === 'off') {
      parkedFor += DT;
      if (hull.ghosted) offGhosted = true;
    }
    hull.step(DT);
  }
  ok(cutChecked && landChecked, 'the cut and the landing were both reached');
  ok(kinds.join(',') === 'board,lift,skip,land,off,leave,ended', `it boards, lifts off, hops, lands, parks and leaves, in that order (${kinds.join(', ')})`);
  ok(roles.join(',') === 'ground,lift,sky,land,ground,lift,sky', `its sounds and flames play the clip each leg shows (${roles.join(', ')})`);
  ok(drives > 0 && allCarried, `and every frame they are told to carry their flames across a change of clip and to burn the flight's own event (${RIDE_TUNE.flightEvent}) between the clips`);
  ok(followN > 100 && followErr < 1e-4 && followTurn < 1e-4, `lifting off, its hull joint is where the drawn shuttle's is at every moment of the clock (${followErr.toExponential(1)} m, ${followTurn.toExponential(1)} rad at the most over ${followN} frames)`);
  ok(landN > 100 && landErr < 1e-4 && landTurn < 1e-4, `settled onto its landing, its hull joint is where the far pad's own shuttle's is on the same clip (${landErr.toExponential(1)} m, ${landTurn.toExponential(1)} rad at the most over ${landN} frames)`);
  ok(worstNoseStep < THREE.MathUtils.degToRad(0.5), `and its nose never turns more than half a degree in a frame (${deg(worstNoseStep)}° at the most)`);
  const moves = limbTravel('lift', 0, 2);
  const landMoves = limbTravel('land', FLYING.land - 2, FLYING.land);
  ok(moves > 0.5 && landMoves > 0.5, `the flyable rig's struts and door move in its take-off and its landing (${f2(moves)} and ${f2(landMoves)} m), so its limbs are worth checking`);
  ok(liftLimbs.n > 100 && liftLimbs.m < 1e-6 && liftLimbs.rad < 1e-4, `lifting off, its struts and door are where the take-off has them at that moment, every frame (${liftLimbs.m.toExponential(1)} m, ${liftLimbs.rad.toExponential(1)} rad over ${liftLimbs.n})`);
  ok(landLimbs.n > 100 && landLimbs.m < 1e-6 && landLimbs.rad < 1e-4, `landing, where the landing has them (${landLimbs.m.toExponential(1)} m, ${landLimbs.rad.toExponential(1)} rad over ${landLimbs.n})`);
  ok(leaveLimbs.n > 100 && leaveLimbs.m < 1e-6 && leaveLimbs.rad < 1e-4, `and lifting off again empty, where its take-off has them (${leaveLimbs.m.toExponential(1)} m over ${leaveLimbs.n})`);
  ok(!flyingSolid && leaveFrames > 0, 'in flight -- lifting off, hopping, landing and leaving alike -- it is ghosted every frame');
  ok(!offGhosted && Math.abs(parkedFor - RIDE_TUNE.dwell) < 2 * DT, `parked where it landed it is solid, for ${RIDE_TUNE.dwell} s`);
  ok(ride.alightFrom === 'ramp' && alightErr < 1e-6, 'and where a passenger would step off it is worked out off the foot of its ramp, on the floor there');
  ok(!ride.running && ride.ended === 'gone' && hull.launches === 2, 'empty, it lifts off again, flies off and is taken away once nobody can see it');
  ok(hull.disposed && counts.disposed === 1 && rigs.tidy() && rigs.undriven === 1 && hull.autopilot === null, 'and nothing of it is left: no hull, no hold on either pad, nothing driven');
  ok(rigs.releases.every((r) => !r.now), `and neither pad was ever given back at once, since the hull never stood parked on one when it let go (${rigs.releases.map((r) => `${r.key}${r.now ? ' at once' : ''}`).join(', ')})`);
  const report = ride.report() as { legs: { kind: string; began: number | null }[]; ended: string };
  ok(report.ended === 'gone' && report.legs.every((l) => l.began !== null), 'the report says when each leg began and how it ended');
  note(`the hop took ${f2(clock.t - 2)} s of the clock: the landing joined at ${f2(join.t)} s of its clip, the take-off let go at ${f2(cut.t)} s`);
}

// ---------------------------------------------------------------- empty, it goes only once nobody can see it

{
  // Somebody at the far pad watching the way the empty hull will leave: its take-off climbs out along the
  // pad's own +Z, and they look down that line a kilometre and a half out.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const out = turnOnPad(destination, new THREE.Vector3(0, 0.25, 1).normalize());
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 20000);
  cam.position.set(destination.x, destination.y + 5, destination.z).addScaledVector(out.clone().setY(0).normalize(), -80);
  cam.lookAt(new THREE.Vector3(destination.x, destination.y, destination.z).addScaledVector(out, 1500));
  cam.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const { host, clock } = makeHost(hull, rigs, cam);
  const ride = new ShuttleRide(planHop(origin, destination), host);
  clock.t = 2;
  await ride.begin();
  let seenAway = 0;
  let goneInSight = false;
  let unseenFor = 0;
  let unseenAtEnd = -1;
  let farAtEnd = 0;
  for (let i = 0; i < 60 * 200 && ride.running; i++) {
    clock.t += DT;
    const away = ride.leg?.kind === 'leave' && hull.launches === 2;
    const d = hull.pos.distanceTo(cam.position);
    const inView = d < SHUTTLE_RIG_TUNE.releaseNear || (d < SHUTTLE_RIG_TUNE.seenFar && frustum.intersectsSphere(new THREE.Sphere(hull.pos.clone(), hull.radius)));
    ride.update(DT);
    if (away) {
      if (inView) {
        seenAway++;
        unseenFor = 0;
        if (!ride.running) goneInSight = true;
      } else unseenFor += DT;
      if (!ride.running) {
        unseenAtEnd = unseenFor;
        farAtEnd = d;
      }
    }
    hull.step(DT);
  }
  ok(seenAway > 120 && !goneInSight, `flying off empty in plain sight it is not taken away (${seenAway} frames seen after its cut, ${f2(seenAway * DT)} s)`);
  ok(ride.ended === 'gone' && unseenAtEnd >= RIDE_TUNE.vanishUnseen - DT / 2, `it goes only once it has been out of sight a whole ${RIDE_TUNE.vanishUnseen} s (${f2(unseenAtEnd)} s)`);
  ok(farAtEnd >= SHUTTLE_RIG_TUNE.seenFar, `which here, looking straight after it, is once it is past ${SHUTTLE_RIG_TUNE.seenFar} m (${f2(farAtEnd)} m)`);
  ok(rigs.tidy(), 'and it leaves nothing held');
}

// ---------------------------------------------------------------- stepping off where there is no floor

{
  // No floor under the foot of the ramp: beside the collector, if its building has one -- a step clear of
  // it toward its pad, and never its own spot, which is inside the droid.
  for (const [pad, from] of [
    [destination, 'collector'],
    [{ ...destination, collector: null }, 'ramp, no floor under it'],
  ] as const) {
    const hull = new FakeHull();
    const rigs = new FakeRigs();
    const { host, clock } = makeHost(hull, rigs, watching(destination));
    host.floorAt = () => null;
    const ride = new ShuttleRide(planHop(origin, pad), host);
    clock.t = 2;
    await ride.begin();
    while (ride.running && ride.leg?.kind !== 'off') {
      clock.t += DT;
      ride.update(DT);
      hull.step(DT);
    }
    const c = pad.collector;
    ok(ride.alightFrom === from && (!c || clearOfCollector(ride.alightAt, c, pad)), `with no floor under the ramp, a passenger would be stood ${c ? `beside the collector, ${f2(RIDE_TUNE.collectorClear)} m toward its pad (${f2(ride.alightAt.distanceTo(new THREE.Vector3(c.x, c.y, c.z)))} m from its spot)` : 'where the ramp ends, and the report says there was no floor'} (${ride.alightFrom})`);
    ride.abort('test');
  }

  // No floor under the ramp, but a floor beside the collector a little under the droid's own spot (a step
  // down off its plinth): the passenger is stood there on that floor, not at the collector's height.
  const c = destination.collector!;
  const spot = besideSpot(c, destination);
  const lower = c.y - 0.3;
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock } = makeHost(hull, rigs, watching(destination));
  const asked: { x: number; z: number }[] = [];
  host.floorAt = (x, _y, z) => {
    asked.push({ x, z });
    return Math.hypot(x - spot.x, z - spot.z) < 1e-6 ? lower : null;
  };
  const ride = new ShuttleRide(planHop(origin, destination), host);
  clock.t = 2;
  await ride.begin();
  while (ride.running && ride.leg?.kind !== 'off') {
    clock.t += DT;
    ride.update(DT);
    hull.step(DT);
  }
  ok(
    ride.alightFrom === 'collector' && clearOfCollector(ride.alightAt, c, destination, lower) && asked.some((a) => Math.hypot(a.x - spot.x, a.z - spot.z) < 1e-6),
    `with no floor under the ramp and a floor beside the collector, a passenger would be stood there, ${f2(RIDE_TUNE.collectorClear)} m toward its pad and on that floor (${f2(ride.alightAt.y - c.y)} m against the collector's own height)`,
  );
  ride.abort('test');
}

// ---------------------------------------------------------------- a hull that lands with another branch

{
  // A rig with two branches, taking off on one and landing with the other, as a transport out of Theed
  // comes down as the calm one does: its sounds and flames are bound to the landing's branch as the
  // landing begins, once, and never before.
  const moods = { theed: fly.clips, calm: fly.clips };
  const hull = new FakeHull(moods);
  const rigs = new FakeRigs();
  const from = padAt(0, 100, 20, -30, 0.3, 'theed');
  const { host, clock } = makeHost(hull, rigs, watching(destination));
  const ride = new ShuttleRide(planHop(from, destination), host);
  clock.t = 2;
  await ride.begin();
  ok(hull.rig.paths('theed')?.landMood === 'calm', 'a hull of a rig with a calm branch, built on another, lands with the calm one');
  let beforeLanding = -1;
  let atLanding = -1;
  fly60(ride, clock, hull, (before, now) => {
    if (now === 'skip') beforeLanding = rigs.rebranched.length;
    if (before === 'skip' && now === 'land') atLanding = rigs.rebranched.length;
  });
  ok(beforeLanding === 0 && atLanding === 1 && rigs.rebranched.join() === 'calm', `its sounds and flames are bound to the calm branch's marks the moment its landing begins, once (${rigs.rebranched.join(', ') || 'never'})`);
  ok(ride.ended === 'gone' && rigs.tidy(), 'and the trip runs to its end all the same');
}

// ---------------------------------------------------------------- a hull that lands in a room (step 9)

{
  // The same rig flown from a pad in the open on its calm branch -- as a transport from Keren takes off -- to
  // a pad in a room of another branch of its own (Theed's hangar): both branches are made ready before it is
  // shown, it lands with the room's branch and not the calm one it took off on (its sounds and flames bound
  // to that branch's marks as the landing begins, once), its sounds follow the rooms from the start, the room
  // is named for the lights and the held view through its landing, its wait and its leaving, and the
  // passenger is put down in that room.
  const moods = { theed: fly.clips, calm: fly.clips };
  const hull = new FakeHull(moods);
  const rigs = new FakeRigs();
  const from = padAt(0, 100, 20, -30, 0.3, 'calm');
  const room: PadRef = { ...padAt(1, 2000, 5, 800, 2.0, 'theed'), cell: 5 };
  const { host, clock, passenger } = makeHost(hull, rigs, watching(room));
  const rooms: number[] = [];
  const seatRooms: number[] = [];
  const unseat = host.unseat;
  host.unseat = (h, at, r) => {
    rooms.push(r ?? -1);
    unseat(h, at, r);
  };
  const seat = host.seat;
  host.seat = (h, r) => {
    seatRooms.push(r ?? -1);
    return seat(h, r);
  };
  const route = planHop(from, room);
  ok(route.landMood === 'theed' && planHop(from, room, false).landMood === null, "a hop onto a room's pad lands on that pad's own branch, and as before with room pads off");
  const ride = new ShuttleRide(route, host, true);
  clock.t = 2;
  await ride.begin();
  ok((rigs.fx as unknown as { inside?: boolean }).inside === true && seatRooms.join() === '0', 'the sounds and flames lent it follow the rooms, since it lands in one, and the passenger boarding in the open is seated with no room');
  ok(rigs.readied.length === 1 && rigs.readied[0].join() === 'calm,theed', `taking off on the calm branch for the room's, both are made ready before it is shown (${rigs.readied.map((m) => m.join(', ')).join(' / ') || 'nothing'})`);
  const landing: string[] = [];
  let heldIn = 0;
  let named = 0;
  let boundBefore = -1;
  let boundAt = -1;
  fly60(ride, clock, hull, (before, now) => {
    if (now === 'skip') boundBefore = rigs.rebranched.length;
    if (before === 'skip' && now === 'land') boundAt = rigs.rebranched.length;
    if (now === 'land' || now === 'off' || now === 'leave') {
      if (ride.roomPad()?.key === room.key) named++;
      if (ride.roomLanding) heldIn++;
    } else if (ride.roomPad() !== null) landing.push(now);
  });
  const r = ride.report() as { landsWith: string | null; landsInRoom: number };
  ok(r.landsWith === 'theed' && r.landsInRoom === 5, `it lands with the room's own branch (${r.landsWith}), in its room ${r.landsInRoom}`);
  ok(boundBefore === 0 && boundAt === 1 && rigs.rebranched.join() === 'theed', `its sounds and flames are bound to that branch's marks the moment its landing begins, once, and never again as it lifts off out of the room on it (${rigs.rebranched.join(', ') || 'never'})`);
  ok(named > 0 && heldIn > 0 && heldIn < named && landing.length === 0, `the room is named for its lights through its landing, its wait and its leaving (${named} frames), the view held through the first two (${heldIn}), and never before`);
  ok(rooms.join() === '5' && passenger.offAt.length === 1, 'and the passenger is put down in that room once it has landed');
  ok(ride.ended === 'gone' && rigs.tidy(), 'and the trip runs to its end all the same');
}

{
  // Boarded where the hull stands in a room (the hangar a transport leaves Theed from): the passenger is seated
  // with that room -- carried a dozen metres from the collector to the seat, which a walk would take for a
  // teleport and leave the room for -- and is put down in it again stepping off while it waits, or when the
  // trip is stopped before it lifts off; landed on a pad in the open, they are put down in no room at all.
  const inRoom: PadRef = { ...padAt(0, 100, 20, -30, 0.3, 'theed'), cell: 5 };
  const seen: string[] = [];
  for (const how of ['step off', 'stop', 'land'] as const) {
    const hull = new FakeHull({ theed: fly.clips, calm: fly.clips });
    const rigs = new FakeRigs();
    const { host, clock, passenger } = makeHost(hull, rigs, watching(destination));
    const seats: number[] = [];
    const offs: number[] = [];
    const seat = host.seat;
    host.seat = (h, r) => {
      seats.push(r ?? -1);
      return seat(h, r);
    };
    const unseat = host.unseat;
    host.unseat = (h, at, r) => {
      offs.push(r ?? -1);
      unseat(h, at, r);
    };
    const ride = new ShuttleRide(planHop(inRoom, destination), host, true);
    clock.t = 2;
    await ride.begin();
    const boarding = ride.leg?.kind === 'board';
    if (how === 'step off') ride.pressE();
    else if (how === 'stop') ride.abort('test');
    else fly60(ride, clock, hull);
    seen.push(`${how}: seated with ${seats.join()} and put down with ${offs.join()}`);
    ok(
      boarding && seats.join() === '5' && offs.join() === (how === 'land' ? '0' : '5') && passenger.seatedIn === null && passenger.offAt.length === 1 && !ride.running,
      `boarded in a room it is seated with that room, and ${how === 'land' ? 'landed on a pad in the open is put down in none' : how === 'step off' ? 'stepping off while it waits is put down in it again' : 'stopped before it lifts off is put down in it again'} (${seen.at(-1)})`,
    );
  }
}

{
  // The passenger's view coming down into a room (`holdRoomHeading`): from the frame the hull is followed into
  // the room it keeps the heading the hull's nose had then, level, however the hull turns on the spot after;
  // a frame that does not hold lets it go, and the next trip takes its own.
  const held = heldHeading();
  const tripA = {};
  const tripB = {};
  const turn = (deg: number, pitch = 0): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(deg), 0, 'YXZ'));
  const outside = holdRoomHeading(held, tripA, false, turn(30));
  const heldOutside = held.ride;
  const first = holdRoomHeading(held, tripA, true, turn(40, 12));
  const took = held.heading;
  const later = holdRoomHeading(held, tripA, true, turn(215));
  const kept = held.heading;
  const level = new THREE.Vector3(0, 0, 1).applyQuaternion(held.turn);
  ok(!outside && heldOutside === null, 'the view does not hold a heading while the hull is not yet in the room');
  ok(first && later && Math.abs(THREE.MathUtils.radToDeg(took) - 40) < 1e-6 && kept === took, `once it is, it holds the heading the nose had coming in (${THREE.MathUtils.radToDeg(took).toFixed(1)} degrees) while the hull turns half round on the spot`);
  ok(Math.abs(level.y) < 1e-9 && Math.abs(Math.atan2(level.x, level.z) - took) < 1e-9, '... level, whatever the nose was pitched at');
  ok(!holdRoomHeading(held, tripA, false, turn(215)) && held.ride === null && holdRoomHeading(held, tripB, true, turn(90)) && Math.abs(THREE.MathUtils.radToDeg(held.heading) - 90) < 1e-6, 'and a frame that does not hold lets it go, so the next landing takes its own');
  const again = holdRoomHeading(held, tripA, true, turn(10));
  ok(again && Math.abs(THREE.MathUtils.radToDeg(held.heading) - 10) < 1e-6, '... as does another trip taking over the view');
}

// ---------------------------------------------------------------- begun part way through its lift-off

{
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock } = makeHost(hull, rigs, watching(origin));
  const ride = new ShuttleRide(planHop(origin, origin), host);
  clock.t = WAIT + 3;
  ok((await ride.begin()) === 'flying' && ride.leg?.kind === 'lift' && hull.ghosted, 'begun while its shuttle lifts off short of its cut, it starts at the lift-off, ghosted');
  vehicleAt(origin, hull.rig.paths('')!.lift, 3, hull.rig.offset, expectPos, expectTurn);
  ok(hull.pos.distanceTo(expectPos) < 1e-9 && ride.swapAt.role === 'lift' && ride.swapAt.seconds === 3, 'where the shuttle it replaces is at that moment');
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const want = new THREE.Vector3();
  const wantTurn = new THREE.Quaternion();
  flownJoint(hull, at, turn);
  standing(origin).joint('lift', 3, want, wantTurn);
  ok(at.distanceTo(want) < 1e-4 && turn.angleTo(wantTurn) < 1e-4, `its hull joint where that shuttle's is, read off the shuttle itself (${at.distanceTo(want).toExponential(1)} m)`);
  ok(limbGap(hull.rig, 'lift', 3, '').m < 1e-6, 'its limbs posed as that shuttle has them');
  ok(rigs.held(origin.key) === 2, 'and a hop back to the pad it left holds that pad twice, once for each end');
  ride.abort('test');
  ok(!ride.running && ride.ended === 'aborted' && hull.disposed && rigs.tidy(), 'aborted in its lift-off, it lets go of everything it held');
  ok(rigs.releases.every((r) => !r.now), 'softly: the hull is in the air, where no shuttle parks');
}

// ---------------------------------------------------------------- a clock that jumps past the cut

{
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock } = makeHost(hull, rigs, watching(origin));
  const ride = new ShuttleRide(planHop(origin, destination), host);
  clock.t = 1;
  await ride.begin();
  ride.update(DT);
  // A tab away for minutes: the next frame finds the round long gone.
  clock.t = WAIT + FLYING.lift + 90;
  ride.update(DT);
  const paths = hull.rig.paths('')!;
  const cut = paths.cut!;
  pathPose(paths.lift, cut.t, expectPos, expectTurn);
  onPad(origin, expectPos, expectTurn);
  pathVelocity(paths.lift, cut.t, vel);
  turnOnPad(origin, vel);
  noseOntoPath(expectTurn, vel, 1, expectTurn);
  vehicleFromJoint(expectPos, expectTurn, hull.rig.offset, expectPos);
  ok(hull.launches === 1 && hull.launchedFrom.distanceTo(expectPos) < 1e-9 && hull.launchedTurn.angleTo(expectTurn) < 1e-6 && ride.leg?.kind === 'skip', 'a frame that finds the clock past the cut hands the hull over at the cut pose, at once');
  ride.abort('test');
  ok(rigs.tidy() && hull.disposed, 'and aborted in flight it lets go of everything');
}

// ---------------------------------------------------------------- a hull taken away under it

{
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock, world, counts } = makeHost(hull, rigs, watching(origin));
  const ride = new ShuttleRide(planHop(origin, destination), host);
  clock.t = WAIT + 1;
  await ride.begin();
  for (let i = 0; i < 30; i++) {
    clock.t += DT;
    ride.update(DT);
  }
  // A world going: the hull disposed with it and out of the world's list.
  hull.disposed = true;
  world.delete(hull);
  ride.update(DT);
  ok(!ride.running && ride.ended === 'lost' && rigs.tidy() && counts.disposed === 0, 'a hull taken away under it ends the trip, both pads let go of and nothing driven, and it is not taken away twice');
}

// ---------------------------------------------------------------- missed, failed, and aborted while it was built

{
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock, counts } = makeHost(hull, rigs, watching(origin));
  const ride = new ShuttleRide(planHop(origin, destination), host);
  clock.t = WAIT + FLYING.leap;
  ok((await ride.begin()) === 'missed' && !ride.running && hull.disposed && counts.shown === 0 && rigs.tidy() && rigs.nowHolds.length === 0, 'a shuttle already past its cut is missed: the hull is thrown away and nothing is held');
}

{
  const rigs = new FakeRigs();
  let resolve: (h: FakeHull) => void = () => {};
  const late = new FakeHull();
  const { host, clock, counts } = makeHost(() => new Promise<FakeHull>((r) => (resolve = r)), rigs, watching(origin));
  const ride = new ShuttleRide(planHop(origin, destination), host);
  clock.t = 1;
  const begun = ride.begin();
  ride.abort('changed its mind');
  resolve(late);
  ok((await begun) === 'aborted' && late.disposed && counts.shown === 0 && rigs.tidy(), 'aborted while its hull was being built, the hull that arrives late is thrown away and nothing is held');
}

{
  const rigs = new FakeRigs();
  const { host, clock } = makeHost(async () => null, rigs, watching(origin));
  const ride = new ShuttleRide(planHop(origin, destination), host);
  clock.t = 1;
  ok((await ride.begin()) === 'failed' && !ride.running && rigs.tidy(), 'a hull that could not be built fails, holding nothing');
}

// ---------------------------------------------------------------- aborted while it stands parked on a pad

{
  // Aborted parked on the pad it leaves: its own shuttle given back at once, where the hull stood; the
  // far one softly. Given back means the release that takes the pad's count to nought.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock } = makeHost(hull, rigs, watching(origin));
  const ride = new ShuttleRide(planHop(origin, destination), host);
  clock.t = 1;
  await ride.begin();
  ride.update(DT);
  ride.abort('stepped off');
  ok(rigs.gaveBack(origin.key)?.now === true && rigs.gaveBack(destination.key)?.now === false && rigs.tidy(), 'aborted while boarding, the pad it stands on is given back at once and the far one softly');
}

{
  // The same on a hop back to the pad it leaves, which holds that pad twice: the soft release goes
  // first, so the one at once is what takes the count to nought and the pad is not left empty.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock } = makeHost(hull, rigs, watching(origin));
  const ride = new ShuttleRide(planHop(origin, origin), host);
  clock.t = 1;
  await ride.begin();
  ride.update(DT);
  ride.abort('stepped off');
  const gave = rigs.releases.filter((r) => r.key === origin.key);
  ok(gave.length === 2 && !gave[0].now && gave[0].left === 1 && gave[1].now && gave[1].left === 0 && rigs.tidy(), `aborted while boarding for the pad it stands on, both holds go and the last is at once (${gave.map((r) => `${r.now ? 'at once' : 'softly'} leaving ${r.left}`).join(', ')})`);
}

{
  // And against the drawn shuttles themselves: the pad's own shuttle stands again in that same step,
  // drawn and solid, with nothing left holding it.
  const physics = await Physics.create();
  const scene = new THREE.Scene();
  const real = new ShuttleRigs({ scene, physics, base: '', prepare: async () => {}, forget: () => {} });
  (real as unknown as { loader: { loadAsync(url: string): Promise<unknown> } }).loader = {
    loadAsync: async (url: string) => {
      if (url === fly.block.file) return { scene: fly.skeleton.scene.clone(true), animations: fly.skeleton.animations };
      const part = fly.block.parts.find((p) => p.file === url)!;
      return { scene: fly.pieces.find((p) => p.joint === part.joint)!.model.clone(true), animations: [] };
    },
  };
  const hull = new FakeHull();
  const cam = watching(origin);
  const { host, clock } = makeHost(hull, real, cam);
  const kept: ShuttleState = { phase: 'away', until: 0, left: 0, glide: 0 };
  ok(await real.stand(origin.key, fly.block, '', { x: origin.x, y: origin.y, z: origin.z, yaw: origin.yaw }, false, { times: origin.times, state: () => host.round(origin, kept) }), 'the pad it leaves has its own shuttle stood on it');
  clock.t = 1;
  real.update(DT, cam);
  const drawn = () => real.describe().shuttles[0];
  ok(drawn().shown && drawn().solid, 'waiting there, drawn and solid');
  const ride = new ShuttleRide(planHop(origin, origin), host);
  await ride.begin();
  real.update(DT, cam);
  ok(!drawn().shown && !drawn().solid && real.holdState(origin.key) === 'hidden' && real.describe().driven === 1, 'swapped for the hull, it is out of the picture and the physics, and its sounds are the hull\'s');
  clock.t += DT;
  ride.update(DT);
  ride.abort('stepped off');
  ok(real.holdState(origin.key) === null && drawn().shown && drawn().solid && real.describe().driven === 0, 'aborted while boarding for the pad it stands on, the shuttle stands again in that same step, drawn and solid, with nothing holding it and nothing driven');
  real.update(DT, cam);
  ok(drawn().shown && drawn().solid, 'and stays so');
  real.clear();
}

{
  // Aborted parked where it landed. Its landing pad's own shuttle parks exactly there, so if that pad's
  // round has its shuttle waiting on the ground just now, the pad is given back at once; if the round has
  // its shuttle anywhere else, softly.
  for (const waiting of [true, false]) {
    const hull = new FakeHull();
    const rigs = new FakeRigs();
    const { host, clock, late } = makeHost(hull, rigs, watching(destination));
    if (waiting) late.set(destination.key, 30);
    const ride = new ShuttleRide(planHop(origin, destination), host);
    clock.t = 2;
    await ride.begin();
    while (ride.running && ride.leg?.kind !== 'off') {
      clock.t += DT;
      ride.update(DT);
      hull.step(DT);
    }
    const kept: ShuttleState = { phase: 'away', until: 0, left: 0, glide: 0 };
    const pose = rigPose(host.round(destination, kept), destination.times, { role: 'sky', seconds: 0, shown: false } as RigPose);
    ride.update(DT);
    ride.abort('test');
    ok(pose.role === (waiting ? 'ground' : 'sky') && rigs.gaveBack(destination.key)?.now === waiting && rigs.tidy(), `aborted parked where it landed with that pad's own shuttle ${waiting ? 'waiting on the ground, the pad is given back at once' : 'away, the pad is given back softly'}`);
  }
}

// ---------------------------------------------------------------- a passenger's trip, end to end

const ticketTo = (pad: PadRef, id = 't1'): Ticket => ({ id, from: 'test', pack: 'test', to: pad.port, at: { x: pad.x, z: pad.z }, price: 0, bought: 0 });

{
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock, passenger } = makeHost(hull, rigs, watching(destination));
  const route = planRoute(ticketTo(destination), origin, destination, 'test')!;
  ok(route.legs.map((l) => l.kind).join(',') === 'board,lift,fly,land,off,leave', `a ticket to a rigged pad on this world is boarded, lifted off, flown, landed, stepped off and left (${route.legs.map((l) => l.kind).join(', ')})`);
  const ride = new ShuttleRide(route, host, true);
  clock.t = 1;
  const outcome = await ride.begin();
  ok(outcome === 'flying' && ride.riding && ride.hidden && passenger.seatedIn === hull && passenger.seats === 1, 'boarded while its shuttle waits: the passenger is seated in the hull, and hidden from the others');
  ok(passenger.said[0] === `boarding the shuttle to ${destination.port}…`, `and told so, once, in plain words (${passenger.said[0]})`);
  ok(passenger.cleared.join() === origin.key && rigs.nowHolds[0] === origin.key, 'an empty hull of an earlier trip about the pad is cleared in the same step as its own shuttle is held out of the picture');
  ok(hull.autopilot === ride.autopilot && ride.autopilot.drive === ride.pilot.drive, "the hull is flown by the trip's own pilot, its drive the pilot's");
  const kept = ride.keepPlace();
  const oc = origin.collector!;
  ok(
    !!kept && kept.pack === 'test' && clearOfCollector(kept, oc, origin),
    `a passenger saved while it still waits is kept beside the collector of the pad they boarded at, ${f2(RIDE_TUNE.collectorClear)} m clear of it toward the pad and never inside the droid (${kept ? f2(Math.hypot(kept.x - oc.x, kept.z - oc.z)) : '-'} m from its spot): a trip ended there gives the ticket back, so a place kept at the far end would be a trip for nothing`,
  );
  ride.update(DT);
  const line = ride.promptLine();
  ok(ride.promptPhase() === 'board' && !!line && line.includes('lifts off in') && line.includes('<b>E</b> steps off') && line.includes('·'), `while it waits, the bar offers stepping off and the line counts down (${line})`);
  clock.t += DT;
  ride.update(DT);
  ok(ride.promptLine() === line, 'the line is the same string until the second it shows changes');

  const kinds: string[] = [];
  let sameDrive = true;
  let flewGhosted = true;
  let steered = 0;
  let flyFrames = 0;
  let phases = '';
  let seatedAtOff = 0;
  let offAt = -1;
  let arrivedWhileSeated = false;
  // Where a passenger is kept once it has lifted off, and which pad the hull is said to stand on in each leg.
  let keptLifted: { pack: string; x: number; y: number; z: number } | null = null;
  const stands = { off: 0, offFrames: 0, up: 0, upFrames: 0, away: 0, awayFrames: 0, elsewhere: 0 };
  // How far past the end of its course a look ahead ever reached: never, since past the join the clip has it.
  let pastEnd = -Infinity;
  const cast = host.castAhead;
  host.castAhead = (h, x, y, z, dx, dy, dz, reach) => {
    const c = ride.pilot.course;
    if (c) pastEnd = Math.max(pastEnd, reach - (c.total - c.ss[ride.pilot.progress]));
    return cast(h, x, y, z, dx, dy, dz, reach);
  };
  for (let i = 0; i < 60 * 300 && ride.running; i++) {
    clock.t += DT;
    ride.update(DT);
    const k = ride.leg?.kind ?? 'ended';
    if (kinds.at(-1) !== k) kinds.push(k);
    if (k === 'lift' && !keptLifted && ride.riding) keptLifted = { ...ride.keepPlace()! };
    const at = ride.standsAt(destination.key);
    if (ride.standsAt(origin.key)) stands.elsewhere++;
    if (k === 'off') {
      stands.offFrames++;
      if (at) stands.off++;
    } else if (k === 'leave' && hull.launches === 1) {
      stands.upFrames++;
      if (at) stands.up++;
    } else if (k === 'leave') {
      stands.awayFrames++;
      if (at) stands.away++;
    } else if (at) stands.elsewhere++;
    const p = ride.promptPhase();
    if (!phases.endsWith(p || '-')) phases += `${phases ? ',' : ''}${p || '-'}`;
    if (hull.autopilot && hull.autopilot.drive !== ride.pilot.drive) sameDrive = false;
    if (k === 'fly') {
      flyFrames++;
      if (!hull.ghosted) flewGhosted = false;
      steered = Math.max(steered, Math.abs(ride.pilot.drive.stickX) + Math.abs(ride.pilot.drive.stickY));
    }
    if (k === 'off' && ride.riding) {
      seatedAtOff += DT;
      if (ride.promptPhase() === 'arrived') arrivedWhileSeated = true;
    }
    if (k === 'off' && !ride.riding && offAt < 0) offAt = seatedAtOff;
    hull.step(DT);
  }
  ok(kinds.join(',') === 'board,lift,fly,land,off,leave,ended', `it counts down, lifts off, is flown, lands, is stepped off and leaves (${kinds.join(', ')})`);
  ok(flyFrames > 60 && flewGhosted && steered > 0.05, `between its clips its pilot flies it, ghosted, over ${f2(flyFrames * DT)} s, the stick really moved`);
  ok(sameDrive, 'and the drive the hull reads is the same object on every frame');
  ok(passenger.rays > flyFrames * DT * 2 && passenger.rays < flyFrames * DT * 5, `looking ahead for anything solid about four times a second (${passenger.rays} rays over ${f2(flyFrames * DT)} s)`);
  const report = ride.report() as { pilot: { goArounds: number; joinError: { across: number; up: number; heading: number } } | null };
  const e = report.pilot!.joinError;
  ok(Math.abs(e.across) < 20 && Math.abs(e.up) < 20 && e.heading < 12, `it met the landing's join close enough to hand over (${f2(e.across)} m across, ${f2(e.up)} m up, ${f2(e.heading)}°, ${report.pilot!.goArounds} times round again)`);
  ok(phases === 'board,flying,arrived,-', `the bar offers stepping off while it waits and once it has landed, and nothing between (${phases})`);
  ok(arrivedWhileSeated && Math.abs(offAt - RIDE_TUNE.alightAfter) < 2 * DT, `landed, the passenger stays seated ${RIDE_TUNE.alightAfter} s and is then let off on their own (${f2(offAt)} s)`);
  ok(passenger.offAt.length === 1 && passenger.offAt[0].distanceTo(ride.alightAt) < 1e-9 && ride.alightFrom === 'ramp', 'at the foot of its ramp');
  ok(passenger.said.includes(`you arrive at ${destination.port}`), 'and told where they have arrived');
  const dc = destination.collector!;
  ok(!!keptLifted && clearOfCollector(keptLifted, dc, destination), "from the lift-off on, a passenger saved mid-trip is kept beside the far pad's collector, where the ticket goes, clear of the droid");
  ok(
    stands.offFrames > 0 && stands.off === stands.offFrames && stands.upFrames > 0 && stands.up === stands.upFrames && stands.awayFrames > 0 && stands.away === 0 && stands.elsewhere === 0,
    `the hull is said to stand on the far pad while it is parked there and while it lifts off it short of its cut, on no other pad, and on none once it is away (${stands.off}/${stands.offFrames} parked, ${stands.up}/${stands.upFrames} lifting, ${stands.away}/${stands.awayFrames} away, ${stands.elsewhere} elsewhere)`,
  );
  ok(Number.isFinite(pastEnd) && pastEnd <= 1e-9, `no look ahead ever reached past the end of its course, where the landing clip has the hull (${f1(pastEnd)} m at the most)`);
  ok(!ride.running && ride.ended === 'gone' && hull.disposed && rigs.tidy() && !ride.riding && !ride.hidden && ride.keepPlace() === null, 'empty, it flies off and is taken away with nothing held, and nobody is hidden or kept anywhere');
  ok(passenger.given.length === 0, 'a ticket flown on is not given back');
  ok(passenger.ended.length === 1 && passenger.ended[0].ride === ride && !passenger.ended[0].running, `and the host is told the trip has ended once, when it has gone and not before (${passenger.ended.length})`);
}

{
  // The passenger's view, framed as the game frames it (`stepFraming`, fed `lowView` every frame): close
  // and low while the hull stands on a pad or is still near one, as a ship in flight is framed while it
  // flies, and eased between the two so that nothing about the view ever jumps. A pad stands inside walls
  // and under roofs; framed as in flight, the view stood on the roof of Bestine's starport.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock } = makeHost(hull, rigs, watching(destination));
  const ride = new ShuttleRide(planRoute(ticketTo(destination, 'view'), origin, destination, 'test')!, host, true);
  clock.t = 1;
  await ride.begin();
  const f = rideFraming(ride.lowView);
  const low: Record<string, boolean[]> = {};
  let stepShare = 0;
  let stepReach = 0;
  let stepRise = 0;
  const seated = { parked: 0, parkedFrames: 0 };
  for (let i = 0; i < 60 * 300 && ride.running; i++) {
    clock.t += DT;
    ride.update(DT);
    hull.step(DT);
    const k = ride.leg?.kind ?? 'ended';
    const was = { share: f.share, reach: f.reach, rise: f.rise };
    stepFraming(f, ride.lowView, DT);
    stepShare = Math.max(stepShare, Math.abs(f.share - was.share));
    stepReach = Math.max(stepReach, Math.abs(f.reach - was.reach));
    stepRise = Math.max(stepRise, Math.abs(f.rise - was.rise));
    (low[k] ??= []).push(ride.lowView);
    if (ride.riding && k === 'off') {
      seated.parkedFrames++;
      if (f.share === 1) seated.parked++;
    }
  }
  const all = (k: string, v: boolean) => (low[k] ?? []).length > 0 && low[k].every((x) => x === v);
  // Starting as `from` and, once it has changed, never going back.
  const once = (xs: boolean[] | undefined, from: boolean) => !!xs && xs.length > 0 && xs[0] === from && xs.every((x, i) => i === 0 || x === xs[i - 1] || xs[i - 1] === from);
  ok(all('board', true) && all('off', true) && all('fly', false), 'the view is framed as parked while it boards and while it stands where it landed, and as a ship in flight all the way between');
  ok(once(low.lift, true) && once(low.land, false), `lifting off it is framed as parked until it is ${RIDE_TUNE.viewLow} m up, and coming down from ${RIDE_TUNE.viewLow} m over the pad, changing once each way (${low.lift?.filter(Boolean).length ?? 0} of ${low.lift?.length ?? 0} lifting frames, ${low.land?.filter(Boolean).length ?? 0} of ${low.land?.length ?? 0} landing)`);
  const parked = rideFraming(true);
  const flying = rideFraming(false);
  ok(parked.reach === RIDE_TUNE.parkedReach && parked.rise === RIDE_TUNE.parkedRise && parked.reach < flying.reach && parked.rise < flying.rise && flying.reach === 1 && flying.rise === CHASE_RISE, `parked it stands ${RIDE_TUNE.parkedReach} of the flight's distance back and ${RIDE_TUNE.parkedRise} up a metre, against the flight's 1 and ${CHASE_RISE}`);
  ok(stepShare <= DT / RIDE_TUNE.viewEase + 1e-9 && stepReach < 0.01 && stepRise < 0.005, `and it never jumps from one to the other: at the most ${stepShare.toFixed(4)} of the way, ${stepReach.toFixed(4)} of the distance back and ${stepRise.toFixed(4)} of the rise in a frame, over ${RIDE_TUNE.viewEase} s`);
  ok(seated.parkedFrames > 0 && seated.parked > 0, `and by the time the passenger is let off it is framed as parked (${seated.parked} of ${seated.parkedFrames} seated frames on the far pad)`);
}

{
  // What the game passes the passenger's view, read since node cannot load main.ts: the chase and the
  // free look both test what stands between the view and the hull's middle, and the test is only what
  // stands still, so the hull itself, solid on its pad, never stands in the way of its own passenger.
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  // The chase takes the hull's own turn and heading, or, coming down into a room, the heading it held at the door (step 9).
  ok(
    /const held = holdRoomHeading\(this\.rideHeld, ride, RIDE_TUNE\.roomHeadingHold && ride\.roomLanding && !!this\.world\.vehicleRoomOf\(rh\), rh\.group\.quaternion\);\s*const turn: THREE\.Quaternion = held \? this\.rideHeld\.turn : rh\.group\.quaternion;\s*const heading = held \? this\.rideHeld\.heading : rh\.heading;/.test(main) &&
      /this\.cam\.chase\(input, dt, mid, turn, heading, reach, null, this\.rideBlock, f\.rise\)/.test(main) &&
      /this\.cam\.update\(input, mid, this\.rideBlock,/.test(main),
    "the passenger's chase and free look are both given the view's block, at the hull's middle, with the framing's rise, and the chase the heading `holdRoomHeading` holds coming down into a room",
  );
  ok(/private readonly rideBlock[^=]*= \(from, to\) => \{\n\s*const d = this\.physics\.blockDistance\(from\.x, from\.y, from\.z, to\.x, to\.y, to\.z, this\.world\.inside\);/.test(main), 'and the block is the first thing that stands still along the line (`blockDistance`), never a body that moves, the hull among them');
  const physics = readFileSync(new URL('../../../src/core/physics.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = /blockDistance\([^)]*\): number \{[\s\S]*?\n  \}/.exec(physics)?.[0] ?? '';
  ok(/this\.fixedOnly\)/.test(block) && /return !b \|\| b\.isFixed\(\);/.test(physics), 'which is what `blockDistance` asks: fixed or bodiless colliders only');
}

{
  // Stepping off while it still waits: the ticket back in hand, the passenger at the foot of the ramp,
  // and the pad's own shuttle given back at once where the hull stood.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock, passenger } = makeHost(hull, rigs, watching(origin));
  const ride = new ShuttleRide(planRoute(ticketTo(destination, 't7'), origin, destination, 'test')!, host, true);
  clock.t = 1;
  await ride.begin();
  clock.t += DT;
  ride.update(DT);
  const foot = hull.rig.rampFoot!.clone();
  foot.x += (foot.x < 0 ? -1 : 1) * RIDE_TUNE.alight;
  hull.group.updateMatrixWorld(true);
  foot.applyMatrix4(hull.group.matrixWorld);
  ok(ride.pressE() && !ride.running && ride.ended === 'stepped off', 'E during the countdown steps the passenger off');
  ok(passenger.given.join() === 't7' && passenger.seatedIn === null && passenger.offAt[0].distanceTo(new THREE.Vector3(foot.x, foot.y - 0.4, foot.z)) < 1e-6, 'at the foot of the ramp, with the ticket back in hand');
  ok(rigs.gaveBack(origin.key)?.now === true && rigs.tidy() && hull.disposed && !ride.hidden, "and the pad's own shuttle stands again at once, nothing held");
  ok(passenger.said.some((s) => s.includes('back in hand')), 'which is said');
}

{
  // In the air, E does not put anybody down: it says why.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock, passenger } = makeHost(hull, rigs, watching(origin));
  const ride = new ShuttleRide(planRoute(ticketTo(destination), origin, destination, 'test')!, host, true);
  clock.t = WAIT + 2;
  await ride.begin();
  const said = passenger.said.length;
  ok(ride.leg?.kind === 'lift' && ride.pressE() && ride.riding && passenger.seatedIn === hull && passenger.said.length === said + 1, `E in the air leaves the passenger seated and says why (${passenger.said.at(-1)})`);
  ride.abort('test');
}

{
  // A hull ready too late: the shuttle it would take the place of is past `lateCut` short of its cut.
  const cut = new FakeHull().rig.paths('')!.cut!.t;
  for (const [past, want] of [
    [RIDE_TUNE.lateCut + 0.5, 'flying'],
    [RIDE_TUNE.lateCut - 0.5, 'missed'],
  ] as const) {
    const hull = new FakeHull();
    const rigs = new FakeRigs();
    let resolve: (h: FakeHull) => void = () => {};
    const { host, clock, passenger } = makeHost(() => new Promise<FakeHull>((r) => (resolve = r)), rigs, watching(origin));
    const ride = new ShuttleRide(planRoute(ticketTo(destination, 'late'), origin, destination, 'test')!, host, true);
    clock.t = 1;
    const begun = ride.begin();
    clock.t = WAIT + cut - past;
    resolve(hull);
    const outcome = await begun;
    if (want === 'flying') ok(outcome === 'flying' && ride.leg?.kind === 'lift' && ride.riding && passenger.given.length === 0, `a hull ready ${f2(past)} s short of the cut is still swapped in, part way through the lift-off, with the passenger in it`);
    else ok(outcome === 'missed' && !ride.riding && passenger.seats === 0 && passenger.given.join() === 'late' && hull.disposed && rigs.tidy() && passenger.said.some((s) => s.includes('gone without you')), `one ready only ${f2(past)} s short of it is missed: nobody seated, the ticket back, nothing held, and said`);
    ride.abort('test');
  }
}

{
  // Somebody no longer there to board (on something else, dead, gone): missed, the ticket back.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock, passenger } = makeHost(hull, rigs, watching(origin));
  passenger.canSeat = false;
  const ride = new ShuttleRide(planRoute(ticketTo(destination, 'gone'), origin, destination, 'test')!, host, true);
  clock.t = 1;
  ok((await ride.begin()) === 'missed' && passenger.given.join() === 'gone' && hull.disposed && rigs.tidy() && rigs.nowHolds.length === 0 && passenger.cleared.length === 0, 'a passenger who cannot be seated misses it: the ticket back, and the pad never touched');
}

{
  // Stopped in every leg: nobody left seated, the hull gone, nobody hidden, no hold on either pad, and
  // the ticket back only for a trip that never lifted off.
  for (const leg of ['board', 'lift', 'fly', 'land', 'off', 'leave'] as const) {
    const hull = new FakeHull();
    const rigs = new FakeRigs();
    const { host, clock, passenger } = makeHost(hull, rigs, watching(destination));
    const ride = new ShuttleRide(planRoute(ticketTo(destination, leg), origin, destination, 'test')!, host, true);
    clock.t = 1;
    await ride.begin();
    for (let i = 0; i < 60 * 300 && ride.running && ride.leg?.kind !== leg; i++) {
      clock.t += DT;
      ride.update(DT);
      hull.step(DT);
    }
    const reached = ride.leg?.kind === leg;
    const seated = ride.riding;
    ride.abort('test');
    ok(
      reached && passenger.seatedIn === null && hull.disposed && !ride.hidden && !ride.riding && rigs.tidy() && passenger.given.join() === (leg === 'board' ? leg : ''),
      `stopped in its ${leg} leg (${seated ? 'with the passenger in it' : 'empty'}): nobody left seated, the hull gone, nobody hidden, nothing held${leg === 'board' ? ', and the ticket back' : ', and the ticket kept'}`,
    );
    // Where they are put down: at the foot of the ramp on either pad, and -- once it has lifted off and
    // the trip is paid for -- at the port it was flying to, the way a trip with no pad there sets them
    // down, never in the air where the hull was.
    const airborne = leg === 'lift' || leg === 'fly' || leg === 'land';
    ok(
      passenger.walkedTo.join() === (airborne ? destination.port : '') && (!airborne || passenger.said.some((s) => s.includes('set down at the port'))),
      `${airborne ? `stopped in the air (${leg}), the passenger is set down at ${destination.port}, as a trip with no pad there is, and told so` : `stopped in its ${leg} leg, nobody is sent anywhere`} (${passenger.walkedTo.join() || 'nowhere'})`,
    );
    const ends = passenger.ended;
    ok(
      ends.length === 1 && ends[0].ride === ride && !ends[0].running && !ends[0].seated && ends[0].given === passenger.given.length,
      `and the host is told once that the trip has ended, with it no longer running, nobody seated and any ticket already back (${ends.length} time${ends.length === 1 ? '' : 's'})`,
    );
  }
}

{
  // A stop in the air by whoever moves the body the moment after (a travel, a death, the select screen)
  // leaves the moving to them: nobody is sent to the port on top of it. A hull taken away under the trip
  // in the air, with nobody moving the body, sets them down at the port all the same.
  for (const how of ['moved', 'lost'] as const) {
    const hull = new FakeHull();
    const rigs = new FakeRigs();
    const { host, clock, passenger, world } = makeHost(hull, rigs, watching(destination));
    const ride = new ShuttleRide(planRoute(ticketTo(destination, how), origin, destination, 'test')!, host, true);
    clock.t = 1;
    await ride.begin();
    for (let i = 0; i < 60 * 300 && ride.running && ride.leg?.kind !== 'fly'; i++) {
      clock.t += DT;
      ride.update(DT);
      hull.step(DT);
    }
    const flying = ride.leg?.kind === 'fly' && ride.riding;
    if (how === 'moved') ride.abort('travel', true);
    else {
      world.delete(hull);
      clock.t += DT;
      ride.update(DT);
    }
    ok(
      flying && !ride.running && passenger.seatedIn === null && passenger.given.length === 0 && passenger.walkedTo.join() === (how === 'moved' ? '' : destination.port) && passenger.ended.length === 1,
      how === 'moved'
        ? 'stopped in the air by a caller that moves the body itself, the passenger is left for it to move: not sent to the port as well, and the ticket kept'
        : `a hull taken away under the trip in the air sets its passenger down at ${destination.port} (${ride.ended}), the ticket kept`,
    );
  }
}

{
  // What the game does when the host is told: the player's ticket is let go of once that trip is over,
  // and only for the trip it is the ticket of. Node cannot load main.ts, so it is read.
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const hook = /\n\s*ended: \(r\) => \{\s*\n\s*if \(r === this\.ride\) this\.rideTicket = null;\s*\n\s*\},/.test(main);
  ok(hook, "the game's host lets go of the player's ticket the moment that trip ends, and only for that trip");
  const moved = ['leaving for the select screen', 'travel', 'teleport', 'died', 'respawn'].filter((w) => !main.includes(`abort('${w}', true)`));
  ok(moved.length === 0, `and every stop whose caller moves the body itself says so, so a passenger is never sent to the port on top of it (${moved.length ? `missing: ${moved.join(', ')}` : '5 of 5'})`);
}

{
  // The crossing a trip into another world makes is the game's own `travel` with a passenger, and the
  // runner's stand-in (`crossings`) never reaches it, so what that crossing must leave alone is read in
  // main.ts itself. It must not stop the trip it is carrying across (a travel stops any other trip, and
  // stopping this one at its own cut leaves the passenger 190 m up on one world and nobody at all on the
  // other), must not offer the trip to the group, wait on the group's word or tell the group where it came
  // out; and the hull the passenger arrives in is held where the trip comes out, never launched, never
  // the ship the next trip into space is flown in and never where a death respawns.
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const methodOf = (head: string): string => {
    const at = main.indexOf(head);
    if (at < 0) return '';
    const end = main.indexOf('\n  }\n', at);
    return end < 0 ? '' : main.slice(at, end);
  };
  const travel = methodOf('private async travel(planet: PlanetDef');
  const calls: [string, string][] = [
    ['this.ride?.abort(', "if (!passenger) this.ride?.abort('travel', true);"],
    ['this.together.leaving(', 'if (!passenger) this.together.leaving('],
    ['this.together.followPoint(', 'passenger ? null : await this.together.followPoint('],
    ['this.together.arrived(', 'if (!passenger) this.together.arrived('],
  ];
  const count = (text: string, what: string) => text.split(what).length - 1;
  const loose = calls.filter(([call, guarded]) => count(travel, call) !== 1 || count(travel, guarded) !== 1).map(([call]) => call.replace(/\($/, ''));
  ok(
    travel.length > 0 && travel.includes('const passenger = !!ship?.passenger;') && loose.length === 0,
    `a travel carrying a passenger leaves their trip running and says nothing to the group: each of its ${calls.length} calls about the trip and the group is made once, and only for somebody who is not a passenger (${loose.length ? `unguarded or repeated: ${loose.join(', ')}` : `${calls.length} of ${calls.length}`})`,
  );
  ok(/arriveInShip\([^)]*crossing\.condition \?\? null, passenger\)/.test(travel), 'and it arrives in the hull it carries as a passenger');
  const arrive = methodOf('private async arriveInShip(');
  const open = arrive.indexOf('\n    if (passenger) {\n');
  const close = open < 0 ? -1 : arrive.indexOf('\n    }\n', open);
  const branch = close < 0 ? '' : arrive.slice(open, close);
  const before = open < 0 ? '' : arrive.slice(0, open);
  ok(
    branch.includes('\n      return v;') && !/launch\(|lastShipDef|this\.spawn\.copy|p\.board\(|piloting =/.test(branch) && !/launch\(|lastShipDef|this\.spawn\.copy/.test(before),
    "a passenger's hull comes out held and is returned before anything launches it, records it as the ship last flown, moves the respawn to the sky or puts the passenger at its controls",
  );
  ok(/\n\s*cross: \(h, leg, arrival, speed, ready\) => \{\n(?:(?!\n\s*\},\n)[\s\S])*?return this\.travel\([^;]*\bpassenger: true, ready \}\);\n\s*\},\n/.test(main), "and the ride host's crossing is that travel, with the passenger marked and the trip's own `ready` handed on");
  // What the trip makes of the hull it came out in is made behind the loading screen: waited for after the
  // hull is spawned and before the settle that compiles the world arrived at, never after the screen lifts.
  const spawned = travel.indexOf('await this.arriveInShip(');
  const readied = travel.indexOf('await crossing.ready(arrived);');
  const settled = travel.indexOf('await this.settle();');
  const lifted = travel.indexOf('await this.loadingScreen.hide();');
  ok(spawned > 0 && readied > spawned && settled > readied && lifted > settled, `and a crossing's ready is waited for after its hull is spawned and before the settle compiles the world behind the screen (${[spawned, readied, settled, lifted].join(' < ')})`);
}

{
  // The portal renderer's own two draws -- a doorway's stencil polygon and the depth reset behind it -- are
  // drawn as scenes of their own and are in no scene a loading screen compiles: the first lift-off of a
  // session built both on a live frame, rising over its own starport. The world's sweep compiles them, each
  // as its own root (no lights and no fog, as they are drawn) for the same target. Node cannot load either
  // file (the renderer takes its renderer as a parameter property), so both are read.
  const portal = readFileSync(new URL('../../../src/world/portalRender.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const own = /\n  ownDraws\(\): THREE\.Object3D\[\] \{\n\s*return \[this\.portalStandIn, this\.resetQuad\];\n\s*\}/.test(portal);
  const standIn = /this\.portalStandIn = new THREE\.Mesh\(\w+, this\.portalMat\);/.test(portal) && /new THREE\.Mesh\(g, this\.portalMat\)/.test(portal) && /this\.resetQuad = new THREE\.Mesh\(g, this\.resetMat\);/.test(portal);
  const sweep = world.slice(world.indexOf('private async compileEverything('), world.indexOf('/** Call once per frame after the camera has moved. */'));
  const compiled = /for \(const o of this\.portals\?\.ownDraws\(\) \?\? \[\]\) \{\n\s*this\.withTarget\(r, target, \(\) => r\.compile\(o, camera\)\);\n\s*this\.programs\.countLinks\(resolveLinks\(r, o\)\);\n\s*\}/.test(sweep);
  ok(own && standIn && compiled, `the portal renderer hands over its own two draws, the doorway's stood in for with the very material and a position-only mesh, and the world's sweep behind every loading screen compiles both as they are drawn (${[own, standIn, compiled].map((b) => (b ? 'yes' : 'no')).join(', ')})`);
}

{
  // A shuttle asked for from the console while a loading screen is up (or before there is a world) is
  // refused in words that say to wait, before anything is planned or any hull built -- not built and then
  // reported as one its passenger missed. Read, since node cannot load main.ts.
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const bodyAt = (head: string): string => {
    const at = main.indexOf(head);
    return at < 0 ? '' : main.slice(at, main.indexOf('\n  }\n', at));
  };
  const refusal = bodyAt('  private consoleRideRefusal(): string | null {');
  ok(/if \(this\.loadingScreen\.open \|\| this\.traveling\) return '[^']*wait for it to finish loading[^']*';/.test(refusal) && /if \(!this\.started \|\| !this\.inWorld\) return '/.test(refusal), 'the console refuses a shuttle while a loading screen is up or a world is being travelled to, saying to wait for it to finish loading, and before there is a world at all');
  const entries = ['private async debugRide(', 'private async debugTrip(', 'private async flyRigHull(', 'private async spawnRigHull('];
  const late = entries.filter((head) => {
    const body = bodyAt(head);
    const asked = body.indexOf('this.consoleRideRefusal()');
    const built = Math.min(...['beginRide(', 'new ShuttleRide(', 'spawnHull(', 'planRoute('].map((w) => body.indexOf(w)).filter((i) => i >= 0));
    return asked < 0 || !(asked < built);
  });
  ok(late.length === 0, `every one of the console's ${entries.length} ways to a shuttle asks that before it plans a trip or builds a hull (${late.length ? `not: ${late.join(', ')}` : 'all'})`);
  const trip = bodyAt('private async debugTrip(');
  ok(trip.indexOf('this.consoleRideRefusal()', trip.indexOf('await this.padsOf(pack)')) > 0, 'and a trip to another world asks again once the far pads have been read, in case a world began loading meanwhile');
}

{
  // Beside a collector: a step clear of it toward its pad, at its own height, written in place; along +X
  // where the two stand on one spot.
  const out = { x: 0, y: 0, z: 0 };
  const got = besideCollector({ x: 10, y: 4, z: -2 }, { x: 10 + 30, z: -2 - 40 }, out, 2);
  ok(got === out && Math.abs(out.x - (10 + 1.2)) < 1e-9 && out.y === 4 && Math.abs(out.z - (-2 - 1.6)) < 1e-9, `a place beside a collector is ${2} m from its spot toward its pad, at its own height, written into what it is handed`);
  besideCollector({ x: 5, y: 1, z: 5 }, { x: 5, z: 5 }, out, 1.5);
  ok(out.x === 6.5 && out.y === 1 && out.z === 5, 'and along +X where the pad and the collector stand on one spot');
}

{
  // A far pad with no rig to land on: flown as far as the take-off's cut, then the passenger is set
  // down at the port the old way and the trip is over.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock, passenger } = makeHost(hull, rigs, watching(origin));
  const route = planRoute(ticketTo(destination, 'walk'), origin, null, 'test')!;
  ok(route.legs.map((l) => l.kind).join(',') === 'board,lift,walkOff' && route.to.pad === null, `with no rigged pad there, it is boarded, lifted off and walked off at the port (${route.legs.map((l) => l.kind).join(', ')})`);
  const ride = new ShuttleRide(route, host, true);
  clock.t = 1;
  await ride.begin();
  const boarding = { ...ride.keepPlace()! };
  const seen: { lifting: { x: number; y: number; z: number } | null } = { lifting: null };
  fly60(ride, clock, hull, (_before, now) => {
    if (now === 'lift' && !seen.lifting) seen.lifting = { ...ride.keepPlace()! };
  });
  const oc = origin.collector!;
  ok(clearOfCollector(boarding, oc, origin), 'saved while it waits, kept beside the collector of the pad boarded at, clear of the droid');
  const kl = seen.lifting;
  ok(!!kl && kl.x === destination.x && kl.z === destination.z && Number.isNaN(kl.y), "and from the lift-off on, at the port the ticket names with no height of its own (NaN): the ground there is the caller's to find, never the seated body's");
  ok(!ride.running && ride.ended === 'walked' && passenger.walkedTo.join() === destination.port && passenger.seatedIn === null, 'at the cut the passenger is set down at the port');
  ok(hull.launches === 1 && hull.disposed && rigs.tidy() && passenger.given.length === 0, 'once the shuttle has been seen to leave, with nothing held, and the ticket spent');
}

{
  // What else is flying is weighed every frame, and something solid ahead is climbed over: each on its own,
  // against the very same flight with nothing in the way, and read off what the hull does rather than off
  // what the pilot says of itself. A second into the flight a ship comes straight at it from 150 m ahead,
  // or a wall stands 100 m ahead of it, and a second and a half later the flight that met one wants to be
  // well above, and is higher than, the one that met neither.
  const flown = async (what: 'nothing' | 'ship' | 'wall') => {
    const hull = new FakeHull();
    const rigs = new FakeRigs();
    const { host, clock, passenger } = makeHost(hull, rigs, watching(destination));
    const ride = new ShuttleRide(planRoute(ticketTo(destination), origin, destination, 'test')!, host, true);
    clock.t = 1;
    await ride.begin();
    const frame = () => {
      clock.t += DT;
      ride.update(DT);
      hull.step(DT);
    };
    for (let i = 0; i < 60 * 300 && ride.leg?.kind !== 'fly'; i++) frame();
    for (let i = 0; i < 60; i++) frame();
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(hull.group.quaternion);
    if (what === 'ship') passenger.ships.push({ pos: hull.pos.clone().addScaledVector(nose, 150), vel: nose.clone().multiplyScalar(-120), radius: 20 });
    if (what === 'wall') passenger.obstacleAt = 100;
    const y0 = hull.pos.y;
    for (let i = 0; i < 90; i++) frame();
    const out = { leg: ride.leg?.kind, y0, y: hull.pos.y, target: ride.pilot.target, climbing: (ride.pilot.report() as { climbingOver: number | null }).climbingOver };
    ride.abort('test');
    return out;
  };
  const none = await flown('nothing');
  ok(none.leg === 'fly' && none.climbing === null, `with nothing in the way the pilot climbs over nothing (${none.leg}, wanting ${f1(none.target)} m, at ${f1(none.y)} m)`);
  for (const what of ['ship', 'wall'] as const) {
    const f = await flown(what);
    ok(f.leg === 'fly' && f.y0 === none.y0, `the ${what}'s flight is the same flight up to the moment the ${what} is met (${f1(f.y0)} m against ${f1(none.y0)} m)`);
    ok(f.target > none.target + 20, `${what === 'ship' ? 'a ship on a course to meet it' : 'a wall ahead'} has its pilot want to be well above where it wanted to be with nothing there (${f1(f.target)} m against ${f1(none.target)} m)`);
    ok(f.y > none.y + 1, `and the hull really goes up over it (${f1(f.y)} m against ${f1(none.y)} m a second and a half later)`);
  }
}

{
  // A pass too far off the join is flown round again, once, and the trip goes on to land all the same:
  // just short of the join, on its final straight, the hull is knocked 60 m aside, far more than it can
  // take back in the moment left.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const { host, clock, passenger } = makeHost(hull, rigs, watching(destination));
  const ride = new ShuttleRide(planRoute(ticketTo(destination, 'round'), origin, destination, 'test')!, host, true);
  clock.t = 1;
  await ride.begin();
  const kinds: string[] = [];
  let knocked = false;
  let first: unknown = null;
  let replanned = false;
  let roundAt = -1;
  for (let i = 0; i < 60 * 400 && ride.running; i++) {
    clock.t += DT;
    ride.update(DT);
    const k = ride.leg?.kind ?? 'ended';
    if (kinds.at(-1) !== k) kinds.push(k);
    const c = ride.pilot.course;
    if (k === 'fly' && c) {
      first ??= c;
      if (c !== first && !replanned) {
        replanned = true;
        roundAt = ride.pilot.goArounds;
      }
      if (!knocked && ride.pilot.progress >= c.finalFrom && c.total - c.ss[ride.pilot.progress] < 100) {
        knocked = true;
        const across = new THREE.Vector3(Math.cos(c.join.heading), 0, -Math.sin(c.join.heading));
        hull.pos.addScaledVector(across, 60);
        hull.group.position.copy(hull.pos);
      }
    }
    hull.step(DT);
  }
  const e = ride.pilot.joinError;
  ok(knocked && replanned && roundAt === 1 && ride.pilot.goArounds === 1, `knocked wide just short of its join, it is planned again from where it is and flown round once (${ride.pilot.goArounds} time${ride.pilot.goArounds === 1 ? '' : 's'})`);
  ok(kinds.join(',') === 'board,lift,fly,land,off,leave,ended', `and the trip goes on from there to land, let off and leave (${kinds.join(', ')})`);
  ok(Math.abs(e.across) < 20 && Math.abs(e.up) < 20 && e.heading < 12, `the second pass meets the join close enough to hand over (${f2(e.across)} m across, ${f2(e.up)} m up, ${f2(e.heading)}°)`);
  ok(passenger.offAt.length === 1 && passenger.offAt[0].distanceTo(ride.alightAt) < 1e-9 && ride.alightFrom === 'ramp' && passenger.given.length === 0, 'the passenger is let off at the foot of the ramp, the ticket spent');
  ok(ride.ended === 'gone' && rigs.tidy() && hull.disposed, 'and nothing is left held');
}

// ---------------------------------------------------------------- a ticket to another world, carried across

/** A pad on another world, and a ticket there that skips the flight through space. */
const far: PadRef = { ...padAt(2, -2500, 40, 1800, 1.0), pack: 'there', key: 'travel:there:2', clock: 'there|Port 2' };
const ticketThere = (id: string): Ticket => ({ id, from: 'test', pack: 'there', to: far.port, at: { x: far.x, z: far.z }, price: 0, bought: 0, trip: 'skip', skipSpace: true });
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- made ready before it is shown

{
  // The hull is built out of sight, then everything its flames and sounds can play -- on the branch it
  // takes off on and the one it lands with -- is made ready and waited for, and only then is it swapped in
  // and shown: nothing of it is made on a frame anybody sees.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const env = makeHost(hull, rigs, watching(origin));
  const order: string[] = [];
  rigs.onReady = () => void order.push('ready');
  const build = env.host.buildHull;
  env.host.buildHull = async (r, p) => {
    order.push('build');
    return build(r, p);
  };
  const show = env.host.showHull;
  env.host.showHull = (h) => {
    order.push('show');
    show(h);
  };
  const ride = new ShuttleRide(planRoute(ticketTo(destination, 'ready'), origin, destination, 'test')!, env.host, true);
  env.clock.t = 1;
  const outcome = await ride.begin();
  const landMood = hull.rig.paths('')!.landMood;
  ok(
    outcome === 'flying' && order.join(',') === 'build,ready,show' && landMood === '' && rigs.readied.length === 1 && rigs.readied[0].length === 1 && rigs.readied[0][0] === '',
    `built, then its effects made ready -- a rig of one branch, which it takes off on and lands with, asked for once -- and only then shown (${order.join(' → ')})`,
  );
  ride.abort('test');

  // A rig that lands with another branch than it takes off on, as Theed's transport comes down as the calm
  // one does: both are made ready before it is shown, the branch it takes off on and the one it lands with,
  // and nothing else.
  const twoBranches = { theed: fly.clips, calm: fly.clips };
  const hullT = new FakeHull(twoBranches);
  const rigsT = new FakeRigs();
  const envT = makeHost(hullT, rigsT, watching(origin));
  const orderT: string[] = [];
  rigsT.onReady = () => void orderT.push('ready');
  const showT = envT.host.showHull;
  envT.host.showHull = (h) => {
    orderT.push('show');
    showT(h);
  };
  const fromTheed = padAt(0, 100, 20, -30, 0.3, 'theed');
  const rideT = new ShuttleRide(planRoute(ticketTo(destination, 'readyT'), fromTheed, destination, 'test')!, envT.host, true);
  envT.clock.t = 1;
  const outcomeT = await rideT.begin();
  ok(
    outcomeT === 'flying' && hullT.rig.paths('theed')?.landMood === 'calm' && orderT.join(',') === 'ready,show' && rigsT.readied.length === 1 && rigsT.readied[0].join() === 'theed,calm',
    `taking off on Theed's branch and landing with the calm one, both are made ready before it is shown (${rigsT.readied.map((m) => m.join(', ')).join(' / ') || 'nothing'})`,
  );
  rideT.abort('test');

  // A trip stopped while that is waited for throws its hull away unseen, as one stopped while it was built does.
  const hull2 = new FakeHull();
  const rigs2 = new FakeRigs();
  const env2 = makeHost(hull2, rigs2, watching(origin));
  let letGo: () => void = () => {};
  rigs2.readyWith = () => new Promise<void>((r) => (letGo = r));
  const ride2 = new ShuttleRide(planRoute(ticketTo(destination, 'ready2'), origin, destination, 'test')!, env2.host, true);
  env2.clock.t = 1;
  const begun = ride2.begin();
  await flush();
  ride2.abort('test');
  letGo();
  const outcome2 = await begun;
  ok(outcome2 === 'aborted' && env2.counts.shown === 0 && hull2.disposed && !ride2.riding && rigs2.tidy() && env2.passenger.given.join() === 'ready2', 'stopped while its effects were made ready, the hull is thrown away unshown, nothing held, the ticket back in hand');
}


/** A trip to the far pad begun, and flown until it asks to be carried across. */
async function toTheCut(env: ReturnType<typeof makeHost>, ride: ShuttleRide, hull: FakeHull, x: ReturnType<typeof crossings>): Promise<void> {
  env.clock.t = 1;
  await ride.begin();
  for (let i = 0; i < 60 * 300 && ride.running && !x.made.length; i++) {
    env.clock.t += DT;
    ride.update(DT);
    hull.step(DT);
  }
}

{
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const env = makeHost(hull, rigs, watching(far));
  const { host, clock, passenger, world, counts } = env;
  const x = crossings(env, rigs);
  const route = planRoute(ticketThere('w1'), origin, far, 'test', SPACE_LATER)!;
  ok(route.legs.map((l) => `${l.kind}@${l.world}`).join(',') === 'board@test,lift@test,skip@there,land@there,off@there,leave@there', 'a ticket to another world is boarded and lifted off here, then skipped across, landed, stepped off and left there');
  const ride = new ShuttleRide(route, host, true);
  await toTheCut(env, ride, hull, x);
  const paths = hull.rig.paths('')!;
  const target = landingTarget(far, paths.land, paths.join, hull.rig.offset, makeLandingTarget());
  const asked = x.made[0];
  ok(x.made.length === 1 && asked.from === hull && asked.leg.kind === 'skip' && asked.leg.world === 'there' && hull.launches === 1, "at the take-off's cut the passenger is carried across to the far world, once, from the hull that lifted off");
  ok(asked.at.distanceTo(target.pos) < 1e-9 && asked.turn.angleTo(target.quat) < 1e-9 && Math.abs(asked.speed - target.speed) < 1e-9, `to come out on the far pad's landing, at its join, moving at the clip's own speed there (${f2(target.speed)} m/s)`);
  ok(ride.crossing && ride.hull === null && ride.riding && ride.hidden && passenger.seatedIn === hull, 'while it is made the trip holds no hull, and the passenger is still in the one that lifted off, still hidden');
  ok(rigs.held(far.key) === 1 && rigs.nowHolds.includes(far.key) && rigs.held(origin.key) === 0, "the far pad's own shuttle is held out of the picture for good before the world goes, and the pad left is already let go of");
  ok(rigs.driven.size === 0 && rigs.undriven === 1, "the hull's sounds and flames are let go of, since the world going takes them anyway");
  const kept = ride.keepPlace();
  ok(!!kept && kept.pack === 'there' && clearOfCollector(kept, far.collector!, far), "a passenger saved meanwhile is kept beside the far pad's collector, on the far world, clear of the droid");
  // What the trip is asked to make ready of the hull that comes out, and when: before the crossing answers.
  const readyAt: { hull: boolean; made: number }[] = [];
  rigs.onReady = () => void readyAt.push({ hull: ride.hull !== null, made: rigs.made.length });
  // The world goes, and the hull it left with it: frames of the trip meanwhile do nothing, and above all
  // do not take the hull gone with its world for the hull lost.
  x.state.go!();
  for (let i = 0; i < 5; i++) ride.update(DT);
  ok(hull.disposed && !world.has(hull) && ride.running && ride.crossing && ride.ended === '', 'the hull left goes with its world, and the trip does not take that for its hull lost');
  await flush();
  const nh = asked.hull!;
  ok(!ride.crossing && ride.hull === nh && nh.autopilot === ride.autopilot && nh.ghosted && ride.leg?.kind === 'land' && passenger.seatedIn === nh, 'the hull that came out is taken up: flown by the trip, ghosted, landing, with the passenger in it');
  ok(
    readyAt.length === 1 && !readyAt[0].hull && readyAt[0].made === 0 && paths.landMood === '' && rigs.readied.at(-1)?.length === 1 && rigs.readied.at(-1)?.[0] === '',
    `everything its flames can play was made ready while the crossing was still being made -- behind its loading screen, before the trip took the hull up or made its set -- on the one branch its rig has, which it lands with (${rigs.readied.at(-1)?.map((m) => m || 'its only branch').join(', ') ?? 'none'})`,
  );
  ok(rigs.made.length === 1 && rigs.driven.size === 1 && rigs.driven.has(rigs.made[0].fx) && !rigs.driven.has(rigs.fx) && rigs.made[0].mood === paths.landMood && !rigs.made[0].inside, 'with a set of sounds and flames made for it afresh on the far world, bound to the branch it lands with');
  ok(counts.disposed === 0 && passenger.offAt.length === 0, 'the trip took away no hull and put nobody down: the world going did the one, and the passenger never left a seat');
  const landedFrom = (ride.report() as { landedFrom: number | null }).landedFrom;
  ok(landedFrom === Number(paths.join!.t.toFixed(2)), `over open ground it comes out at the landing's join (${landedFrom} s)`);
  // The landing to the end, against the far pad's own shuttle on the same clip: exactly where it is, since
  // it came out exactly on the clip and has nothing to settle.
  const stood = standing(far);
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const want = new THREE.Vector3();
  const wantTurn = new THREE.Quaternion();
  const kinds: string[] = [];
  let landT = paths.join!.t;
  let landErr = 0;
  let landN = 0;
  for (let i = 0; i < 60 * 300 && ride.running; i++) {
    clock.t += DT;
    const before = ride.leg?.kind ?? '';
    ride.update(DT);
    const now = ride.leg?.kind ?? 'ended';
    if (kinds.at(-1) !== now) kinds.push(now);
    if (before === 'land' && now === 'land') {
      landT = Math.min(paths.land.seconds, landT + DT);
      flownJoint(nh, at, turn);
      stood.joint('land', landT, want, wantTurn);
      landErr = Math.max(landErr, at.distanceTo(want), turn.angleTo(wantTurn));
      landN++;
    }
    nh.step(DT);
  }
  ok(kinds.join(',') === 'land,off,leave,ended', `it lands, is stepped off and leaves, on the far world (${kinds.join(', ')})`);
  ok(landN > 100 && landErr < 1e-4, `landing, its hull joint is where the far pad's own shuttle's is on the same clip, every frame (${landErr.toExponential(1)} over ${landN})`);
  ok(passenger.offAt.length === 1 && passenger.offAt[0].distanceTo(ride.alightAt) < 1e-9 && ride.alightFrom === 'ramp' && passenger.said.includes(`you arrive at ${far.port}`), 'landed, the passenger is let off at the foot of its ramp on the far pad, and told where they are');
  ok(ride.ended === 'gone' && nh.disposed && rigs.tidy() && passenger.given.length === 0 && passenger.walkedTo.length === 0 && passenger.ended.length === 1, 'and the empty hull flies off there and is taken away: nothing held, the ticket spent, nobody sent anywhere, the host told once');
}

{
  // The same crossing from a pad whose rig takes off on one branch and lands with another, as a transport
  // out of Theed comes down as the calm one does: the hull that comes out is made ready for both, behind the
  // crossing's loading screen, before the trip takes it up.
  const twoBranches = { theed: fly.clips, calm: fly.clips };
  const hull = new FakeHull(twoBranches);
  const rigs = new FakeRigs();
  const env = makeHost(hull, rigs, watching(far));
  const x = crossings(env, rigs, twoBranches);
  const fromTheed = padAt(0, 100, 20, -30, 0.3, 'theed');
  const ride = new ShuttleRide(planRoute(ticketThere('w-theed'), fromTheed, far, 'test', SPACE_LATER)!, env.host, true);
  await toTheCut(env, ride, hull, x);
  ok(x.made.length === 1 && ride.crossing && rigs.readied.length === 1 && rigs.readied[0].join() === 'theed,calm', `boarded on Theed's branch, both it and the calm one it lands with were made ready before it was shown (${rigs.readied.map((m) => m.join(', ')).join(' / ') || 'nothing'})`);
  const readyAt: { hull: boolean; made: number }[] = [];
  rigs.onReady = () => void readyAt.push({ hull: ride.hull !== null, made: rigs.made.length });
  await x.go();
  const nh = x.made[0].hull!;
  ok(
    !!nh && ride.hull === nh && ride.leg?.kind === 'land' && readyAt.length === 1 && !readyAt[0].hull && readyAt[0].made === 0 && rigs.readied.length === 2 && rigs.readied[1].join() === 'theed,calm' && rigs.made.at(-1)?.mood === 'calm',
    `and the hull that came out was made ready for both before the trip took it up, then given a set bound to the calm branch it lands with (${rigs.readied.at(-1)?.join(', ') ?? 'none'}; set on ${rigs.made.at(-1)?.mood ?? 'none'})`,
  );
  ride.abort('test');
}

{
  // The same crossing from the calm branch to a far pad in a room of the rig's own other branch (a transport
  // flown to Theed from another world): the hull that comes out is made ready for the room's branch it lands
  // with, and given a set bound to it that follows the rooms.
  const twoBranches = { theed: fly.clips, calm: fly.clips };
  const hull = new FakeHull(twoBranches);
  const rigs = new FakeRigs();
  const farRoom: PadRef = { ...far, mood: 'theed', cell: 5 };
  const env = makeHost(hull, rigs, watching(farRoom));
  const x = crossings(env, rigs, twoBranches);
  const fromCalm = padAt(0, 100, 20, -30, 0.3, 'calm');
  const ride = new ShuttleRide(planRoute(ticketThere('w-room'), fromCalm, farRoom, 'test', SPACE_LATER)!, env.host, true);
  await toTheCut(env, ride, hull, x);
  ok(rigs.readied.length === 1 && rigs.readied[0].join() === 'calm,theed', `boarded on the calm branch for a far room's pad, both branches were made ready before it was shown (${rigs.readied.map((m) => m.join(', ')).join(' / ') || 'nothing'})`);
  await x.go();
  const nh = x.made[0].hull!;
  const set = rigs.made.at(-1);
  ok(
    !!nh && ride.hull === nh && ride.leg?.kind === 'land' && rigs.readied.length === 2 && rigs.readied[1].join() === 'calm,theed' && set?.mood === 'theed' && set.inside,
    `and the hull that came out was made ready for the room's branch too, then given a set bound to it that follows the rooms (${rigs.readied.at(-1)?.join(', ') ?? 'none'}; set on ${set?.mood ?? 'none'}${set?.inside ? ', inside' : ''})`,
  );
  ride.abort('test');
}

{
  // A far pad whose landing comes in through a hill: here the ground stands 30 m over the join and falls
  // away to the pad's own some way in. The hull comes out along its landing where it first stands clear
  // of that ground, not inside the hill; with no ground held there at all, at the join.
  const probe = new FakeHull();
  const paths = probe.rig.paths('')!;
  const join = paths.join!;
  vehicleAt(far, paths.land, join.t, probe.rig.offset, expectPos, expectTurn);
  const hillR = Math.hypot(expectPos.x - far.x, expectPos.z - far.z) * 0.6;
  const hillTop = expectPos.y + 30;
  const ground = (gx: number, gz: number) => (Math.hypot(gx - far.x, gz - far.z) > hillR ? hillTop : far.y - 1);
  let wantT = Number.NaN;
  for (let t = join.t; t < paths.land.seconds; t += 1 / RIG_PATH_TUNE.fps) {
    vehicleAt(far, paths.land, t, probe.rig.offset, expectPos, expectTurn);
    if (expectPos.y - ground(expectPos.x, expectPos.z) >= RIDE_TUNE.joinClear) {
      wantT = t;
      break;
    }
  }
  ok(wantT > join.t + 0.5, `the made-up hill buries the join and the landing comes out of it ${f2(wantT - join.t)} s later`);
  for (const held of ['hill', 'none'] as const) {
    const hull = new FakeHull();
    const rigs = new FakeRigs();
    const env = makeHost(hull, rigs, watching(far));
    env.host.groundCached = held === 'hill' ? ground : () => null;
    const x = crossings(env, rigs);
    const ride = new ShuttleRide(planRoute(ticketThere(held), origin, far, 'test', SPACE_LATER)!, env.host, true);
    await toTheCut(env, ride, hull, x);
    await x.go();
    const nh = x.made[0].hull!;
    const t = held === 'hill' ? wantT : join.t;
    vehicleAt(far, paths.land, t, nh.rig.offset, expectPos, expectTurn);
    const from = (ride.report() as { landedFrom: number | null }).landedFrom;
    ok(ride.leg?.kind === 'land' && nh.heldAt.distanceTo(expectPos) < 1e-6 && from === Number(t.toFixed(2)), held === 'hill' ? `over the hill it comes out ${RIDE_TUNE.joinClear} m clear of the ground, along its landing (${from} s against the join's ${f2(join.t)})` : 'with no ground held where it comes out, at the join: nothing is made on the spot to ask');
    let landed = false;
    for (let i = 0; i < 60 * 300 && ride.running; i++) {
      env.clock.t += DT;
      ride.update(DT);
      if (ride.leg?.kind === 'off') landed = true;
      nh.step(DT);
    }
    ok(landed && ride.ended === 'gone' && rigs.tidy() && env.passenger.offAt.length === 1, 'and lands, lets its passenger off and leaves all the same');
  }
}

{
  // A crossing that gets nowhere. Failed after the world went: no hull came out, and the passenger, whom
  // the world going had already taken off the hull, is set down at the far port. Refused before it began:
  // the hull left is still here with the passenger in it, so the trip takes them off it and takes it
  // away, and sets them down at the far port all the same.
  for (const how of ['fail', 'refuse'] as const) {
    const hull = new FakeHull();
    const rigs = new FakeRigs();
    const env = makeHost(hull, rigs, watching(far));
    const x = crossings(env, rigs);
    x.state.mode = how;
    const ride = new ShuttleRide(planRoute(ticketThere(how), origin, far, 'test', SPACE_LATER)!, env.host, true);
    await toTheCut(env, ride, hull, x);
    await x.go();
    const p = env.passenger;
    ok(!ride.running && ride.ended === 'walked' && p.seatedIn === null && p.walkedTo.join() === far.port && p.given.length === 0 && p.ended.length === 1 && rigs.tidy(), `a crossing ${how === 'fail' ? 'that failed' : 'that was refused'} sets the passenger down at the far port as a ticket always did, the ticket spent, nothing held, the host told once`);
    ok(
      how === 'fail' ? hull.disposed && env.counts.disposed === 0 && p.offAt.length === 0 : hull.disposed && env.counts.disposed === 1 && p.offAt.length === 1,
      how === 'fail' ? 'the hull it left went with its world, the passenger off it' : 'the hull it left is taken away by the trip, with the passenger off it first',
    );
  }
}

{
  // Stopped while the crossing is made, before the world goes or after, by a caller that moves the
  // passenger itself or not: the hull that comes out late is let go of, with the passenger off it, and
  // they are set down at the far port unless the caller moves them; the host is told once, at the stop.
  for (const when of ['before', 'after'] as const) {
    for (const moved of [false, true]) {
      const hull = new FakeHull();
      const rigs = new FakeRigs();
      const env = makeHost(hull, rigs, watching(far));
      const x = crossings(env, rigs);
      const ride = new ShuttleRide(planRoute(ticketThere(`${when}${moved}`), origin, far, 'test', SPACE_LATER)!, env.host, true);
      await toTheCut(env, ride, hull, x);
      if (when === 'after') x.state.go!();
      ride.abort('test', moved);
      const p = env.passenger;
      const told = p.ended.length;
      ok(!ride.running && !ride.crossing && !ride.riding && !ride.hidden && hull.disposed && told === 1, `stopped ${when} the world goes, the trip is over at once, with nobody seated and the hull it left gone`);
      await x.go();
      const nh = x.made[0].hull!;
      ok(nh.disposed && p.seatedIn === null && rigs.tidy() && p.ended.length === 1, 'the hull that comes out late is let go of, with the passenger off it, and nothing held');
      ok(p.walkedTo.join() === (moved ? '' : far.port), moved ? 'and the passenger is left for the caller to move' : `and the passenger is set down at ${far.port}`);
      ok(env.counts.disposed === (when === 'before' ? 2 : 1) && p.offAt.length === (when === 'before' ? 2 : 1), when === 'before' ? 'both hulls taken away by the trip, the passenger off each' : 'the one that came out taken away by the trip: its world took the other');
    }
  }
}

// ---------------------------------------------------------------- a trip through space

/** The galaxy as the trips here know it: two worlds, each the one world its own orbit hangs over. */
const spaceFacts = {
  worldOf: (pack: string) => (pack === 'test' ? { planet: 'home' } : pack === 'there' ? { planet: 'yonder' } : null),
  orbitOf: (planet: string) => (planet === 'home' ? 'space_home' : planet === 'yonder' ? 'space_yonder' : null),
  noOrbit: () => '',
  hasDisc: (zone: string, planet: string) => zone === 'space_yonder' && planet === 'yonder',
};
const spacePlan = { facts: spaceFacts, gate: 1100, discSeconds: RIDE_TUNE.discSeconds };
const ticketThrough = (id: string): Ticket => ({ ...ticketThere(id), trip: 'space', skipSpace: false });

/**
 * The jump every ship makes, stood in on the test's own clock with the game's own stage lengths: a
 * countdown, the enter stage and the transit it flies the hull through, and the exit that lets go of the
 * hull and says where it came out, as the game's `onArrived` does. `refuse` turns a jump down before it
 * begins; `stalls` has that many go idle in the transit without coming out, as a jump that could not
 * carry its hull across does.
 */
class FakeJump {
  phase: 'idle' | 'countdown' | 'enter' | 'transit' | 'exit' = 'idle';
  t = 0;
  zone = '';
  hull: RideHull | null = null;
  released = false;
  starts = 0;
  aborts = 0;
  refuse = '';
  stalls = 0;
  ride: ShuttleRide | null = null;
  start(zone: string, hull: RideHull | null): string | null {
    if (this.refuse) return this.refuse;
    if (!hull) return "the pilot's call";
    if (this.phase !== 'idle') return 'already jumping';
    this.starts++;
    this.phase = 'countdown';
    this.t = 0;
    this.zone = zone;
    this.hull = hull;
    this.released = false;
    return null;
  }
  drives(h: RideHull | null): boolean {
    return !!h && h === this.hull && (this.phase === 'enter' || this.phase === 'transit' || (this.phase === 'exit' && !this.released));
  }
  step(dt: number, env: ReturnType<typeof makeHost>): void {
    if (this.phase === 'idle') return;
    this.t += dt;
    if (this.phase === 'countdown' && this.t >= 5) this.go('enter');
    else if (this.phase === 'enter' && this.t >= 3.6) {
      if (this.stalls > 0) {
        this.stalls--;
        this.finish();
        return;
      }
      env.current.world = this.zone;
      this.go('transit');
    } else if (this.phase === 'transit' && this.t >= 4) this.go('exit');
    else if (this.phase === 'exit') {
      if (!this.released && this.t >= 5.011) {
        this.released = true;
        // As the game's `releaseHull` does: the hull let go of is solid again, and then told it came out.
        this.hull?.setGhost(false);
        this.ride?.jumped(this.zone);
      }
      if (this.t >= 5.2) this.finish();
    }
  }
  abort(): void {
    if (this.phase === 'idle') return;
    this.aborts++;
    this.finish();
  }
  private go(phase: FakeJump['phase']): void {
    this.phase = phase;
    this.t = 0;
  }
  private finish(): void {
    this.phase = 'idle';
    this.t = 0;
    this.hull = null;
    this.released = false;
  }
}

/**
 * The flight through space's half of the host, stood in: where a world is reached in its zone (its own
 * orbit's launch point, at the origin, facing +Z; the far zone's four kilometres out), the far world's disc
 * along +X, and the jump. Counts what was asked of it.
 */
function spaceTrips(env: ReturnType<typeof makeHost>, jumper: FakeJump): { prefetched: number; placed: number } {
  const counts = { prefetched: 0, placed: 0 };
  env.host.prefetchSpace = () => void counts.prefetched++;
  env.host.spacePlace = async (aim, _towards, out) => {
    counts.placed++;
    if (aim.zone !== 'space_home' && aim.zone !== 'space_yonder') return false;
    out.pos.set(aim.zone === 'space_home' ? 0 : 4000, 0, 0);
    out.quaternion.identity();
    return true;
  };
  env.host.discDirection = (world, out) => {
    if (world !== 'yonder') return false;
    out.set(1, 0, 0);
    return true;
  };
  env.host.jump = (zone) => jumper.start(zone, jumper.ride?.jumpHull ?? null);
  env.host.jumpPhase = () => jumper.phase;
  env.host.jumpDrives = (h) => jumper.drives(h);
  env.host.jumpAbort = () => jumper.abort();
  return counts;
}

/**
 * A trip flown frame by frame with the clock, the jump and its crossings moving with it, in the game's
 * own order -- the jump (`hyperspace.update`), then the trip (`stepRides`), then the hull (`stepVehicles`):
 * `each` sees every frame after the trip's own update and before the hull is stepped, and a crossing asked
 * for is let go at once. Until `until`.
 */
async function flyThrough(env: ReturnType<typeof makeHost>, ride: ShuttleRide, x: ReturnType<typeof crossings>, jumper: FakeJump, each: (before: string, now: string) => void = () => {}, until: () => boolean = () => false, frames = 60 * 900): Promise<void> {
  for (let i = 0; i < frames && ride.running && !until(); i++) {
    env.clock.t += DT;
    jumper.step(DT, env);
    const before = ride.leg?.kind ?? '';
    ride.update(DT);
    each(before, ride.leg?.kind ?? 'ended');
    if (x.state.go) await x.go();
    else if (ride.busy) await flush();
    (ride.hull as FakeHull | null)?.step(DT);
  }
}

/** The legs a hull flies rather than stands parked in: ghosted, every frame of every one of them. */
const FLOWN_LEGS = new Set(['lift', 'climb', 'up', 'jump', 'fly', 'down', 'land']);

/** A trip through space from the first pad to the far one, with everything it needs stood in. */
function spaceTrip(id: string) {
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const env = makeHost(hull, rigs, watching(far));
  const x = crossings(env, rigs);
  const jumper = new FakeJump();
  const asked = spaceTrips(env, jumper);
  const ride = new ShuttleRide(planRoute(ticketThrough(id), origin, far, 'test', null, spacePlan)!, env.host, true);
  jumper.ride = ride;
  return { hull, rigs, env, x, jumper, asked, ride };
}

{
  const { rigs, env, x, jumper, asked, ride } = spaceTrip('s1');
  const plan = ride.route.legs.map((l) => (l.kind === 'fly' ? `fly(${l.aim?.to})` : l.kind)).join(',');
  ok(plan === 'board,lift,climb,up,jump,fly(disc),down,fly(join),land,off,leave', `a ticket through space: boarded, lifted off, climbed out, up, jumped, turned to the far world, down, flown in and landed (${plan})`);
  const events: string[] = [];
  ride.onLeg = (leg, i, phase) => void events.push(`${phase} ${i} ${leg.kind}`);
  env.clock.t = 1;
  await ride.begin();
  const drive = ride.autopilot.drive;
  const kinds: string[] = [];
  let sameDrive = true;
  let jumpHullAway = 0;
  let jumpHullSeen = 0;
  let driven = 0;
  let neutral = 0;
  let climbTop = -Infinity;
  let spaceAt = 0;
  let flown = 0;
  const solid: string[] = [];
  // The course flown in from the crossing down, and how far the hull turned flying it.
  let downCourse: RideCourse | null = null;
  let downTurned = 0;
  let downHeading = Number.NaN;
  await flyThrough(env, ride, x, jumper, (_before, now) => {
    if (kinds.at(-1) !== now) kinds.push(now);
    if (ride.autopilot.drive !== drive) sameDrive = false;
    if (now === 'fly' && env.current.world === 'there' && ride.hull) {
      downCourse ??= ride.pilot.course;
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(ride.hull.group.quaternion);
      const hd = Math.atan2(n.x, n.z);
      if (Number.isFinite(downHeading)) downTurned += Math.abs(THREE.MathUtils.radToDeg(Math.atan2(Math.sin(hd - downHeading), Math.cos(hd - downHeading))));
      downHeading = hd;
    }
    // Only parked is it solid: on every frame of every other leg the hull is ghosted before it is stepped,
    // the frame a jump lets go of it included.
    if (ride.hull && FLOWN_LEGS.has(now)) {
      flown++;
      if (!ride.hull.ghosted && solid.length < 5) solid.push(`${now} ${f2(env.clock.t)}`);
    }
    if (ride.jumpHull) {
      jumpHullSeen++;
      if (ride.leg?.kind !== 'jump') jumpHullAway++;
    }
    const h = ride.hull;
    if (h && jumper.drives(h)) {
      driven++;
      if (drive.stickX === 0 && drive.stickY === 0 && drive.steer === 0) neutral++;
    }
    if (now === 'climb' && h) climbTop = Math.max(climbTop, h.pos.y);
    if (env.host.inSpace()) spaceAt++;
  });
  ok(kinds.join(',') === 'board,lift,climb,up,jump,fly,down,fly,land,off,leave,ended', `it flies every leg in order (${kinds.join(', ')})`);
  const up = x.made[0];
  const down = x.made[1];
  ok(x.made.length === 2 && up.leg.kind === 'up' && up.leg.world === 'space_home' && down.leg.kind === 'down' && down.leg.world === 'there', 'two crossings: up into the orbit, and down onto the far world');
  ok(up.at.length() < 1e-9 && up.speed >= 60 && up.from.pos.y >= 1100 + RIDE_TUNE.gateMargin - 1, `up once it has climbed ${RIDE_TUNE.gateMargin} m past the space gate (${f1(up.from.pos.y)} m, at ${f1(up.speed)} m/s), to where its world is reached in its orbit`);
  const outFromPad = Math.hypot(down.at.x - far.x, down.at.z - far.z);
  // Where, and which way it faces: on the far pad's landing's own line, back along the way it comes in from
  // its join (measured off the landing's own velocity there, not any heading the trip keeps), on the ride's
  // own glide down to that join, with its nose along the glide.
  const downRig = (down.from as FakeHull).rig;
  const downPaths = downRig.paths('')!;
  const farJoin = landingTarget(far, downPaths.land, downPaths.join, downRig.offset, makeLandingTarget());
  const inFlat = new THREE.Vector3(farJoin.vel.x, 0, farJoin.vel.z).normalize();
  const fromJoin = new THREE.Vector3(down.at.x - farJoin.pos.x, 0, down.at.z - farJoin.pos.z);
  const offLine = Math.abs(fromJoin.x * inFlat.z - fromJoin.z * inFlat.x);
  const glideWanted = downGlideOf(-farJoin.climb);
  const glideGot = THREE.MathUtils.radToDeg(Math.atan2(down.at.y - farJoin.pos.y, fromJoin.length()));
  ok(
    Math.abs(outFromPad - RIDE_TUNE.downReach) < 1e-6 && offLine < 1e-6 && fromJoin.dot(inFlat) < 0 && Math.abs(glideGot - glideWanted) < 1e-6 && Math.abs(down.speed - Math.min(RIDE_PILOT.cruise, 150)) < 1e-9,
    `down ${RIDE_TUNE.downReach} m from the far pad, on its landing's own line (${offLine.toExponential(1)} m off it) behind the join, on a glide of ${f2(glideGot)}° down to it, at the pilot's cruise`,
  );
  const downNose = new THREE.Vector3(0, 0, 1).applyQuaternion(down.turn);
  const toJoin = farJoin.pos.clone().sub(down.at).normalize();
  ok(downNose.angleTo(toJoin) < 1e-6, `facing straight down that glide onto the landing's join (${deg(downNose.angleTo(toJoin))}°)`);
  ok(!!downCourse && downCourse.word === 'S' && downCourse.finalFrom === 0 && downTurned < 1, `and flown straight in from there, one straight and no turn (${downCourse?.word ?? 'no course'}, ${f1(downCourse?.total ?? Number.NaN)} m, turned ${f1(downTurned)}° flying it)`);
  ok(flown > 0 && solid.length === 0, `ghosted on every frame it flies, the jump's own release included, and solid only parked (${flown} frames${solid.length ? `; solid at ${solid.join(', ')}` : ''})`);
  ok(jumper.starts === 1 && jumpHullSeen > 0 && jumpHullAway === 0 && ride.jumpHull === null, `one jump, flown with the trip's own hull for the length of the jump leg and never outside it (${jumpHullSeen} frames)`);
  ok(driven > 0 && neutral === driven, `while the jump flies the hull, the trip's stick is let go of on every frame (${neutral} of ${driven})`);
  ok(sameDrive, 'the drive handed to the hull is the same object on every frame');
  ok(asked.prefetched === 1 && asked.placed >= 1 && spaceAt > 0, 'the zones asked for once as it boards, and flown through in space');
  const paired = events.every((e, i) => {
    const [phase, n] = e.split(' ');
    const want = i % 2 === 0 ? 'start' : 'end';
    return phase === want && Number(n) === Math.floor(i / 2);
  });
  ok(paired && events.length === ride.route.legs.length * 2, `every leg is started and ended in turn, in pairs (${events.length / 2} legs)`);
  ok(env.passenger.offAt.length === 1 && env.passenger.said.includes(`you arrive at ${far.port}`) && ride.ended === 'gone' && rigs.tidy() && env.passenger.walkedTo.length === 0 && env.passenger.ended.length === 1, 'and lands on the far pad, lets its passenger off and leaves, with nothing held, nobody set down elsewhere, the host told once');
  ok((ride.report() as { rescues: number }).rescues === 0 && climbTop > far.y, 'nobody needed rescuing');
}

{
  // A jump turned down: the rest of the trip is a skip straight onto the far pad, from space.
  const { rigs, env, x, jumper, ride } = spaceTrip('refused');
  jumper.refuse = 'not today';
  env.clock.t = 1;
  await ride.begin();
  await flyThrough(env, ride, x, jumper);
  const plan = ride.route.legs.map((l) => l.kind).join(',');
  ok(jumper.starts === 0 && x.made.map((m) => m.leg.kind).join(',') === 'up,skip' && plan === 'board,lift,climb,up,skip,land,off,leave', `a jump refused becomes a skip onto the far pad from where the trip is (${plan})`);
  ok(ride.route.trip === 'skip' && /refused: not today/.test(ride.route.forced ?? '') && env.passenger.said.some((s) => /could not go on/.test(s)), `the trip says why it was skipped (${ride.route.forced})`);
  ok(ride.ended === 'gone' && env.passenger.offAt.length === 1 && rigs.tidy() && env.passenger.walkedTo.length === 0, 'and it lands there all the same');
}

{
  // A jump that goes idle without coming out is begun once more; twice, and the rest is a skip.
  for (const stalls of [1, 2]) {
    const { rigs, env, x, jumper, ride } = spaceTrip(`stall${stalls}`);
    jumper.stalls = stalls;
    env.clock.t = 1;
    await ride.begin();
    await flyThrough(env, ride, x, jumper);
    const crossed = x.made.map((m) => m.leg.kind).join(',');
    ok(
      jumper.starts === 2 && crossed === (stalls === 1 ? 'up,down' : 'up,skip') && ride.ended === 'gone' && rigs.tidy() && env.passenger.offAt.length === 1,
      stalls === 1 ? `a jump that fails once is begun again and the trip goes on (${crossed})` : `one that fails again is given up for a skip onto the far pad (${crossed}), and it lands all the same`,
    );
  }
}

{
  // A hull lost out in space sets its passenger down at the far port: exactly once.
  const { env, x, jumper, ride } = spaceTrip('lost');
  env.clock.t = 1;
  await ride.begin();
  await flyThrough(env, ride, x, jumper, () => {}, () => ride.route.legs[ride.index]?.aim?.to === 'disc' && !!ride.hull);
  const h = ride.hull as FakeHull;
  ok(!!h && env.host.inSpace(), 'out in space, turning toward the far world');
  h.disposed = true;
  env.world.delete(h);
  for (let i = 0; i < 120; i++) ride.update(DT);
  ok(!ride.running && ride.ended === 'lost' && env.passenger.walkedTo.join() === far.port && env.passenger.ended.length === 1 && (ride.report() as { rescues: number }).rescues === 1 && !ride.riding, 'a hull lost in space sets its passenger down at the port it was flying to, once, and the host is told once');
}

{
  // The crossing up that gets nowhere gives the flight through space up for a skip: out of the hull that
  // lifted off where it was refused before it began, and out of whatever the crossing left once its world
  // had gone -- either way onto the far pad, and landed.
  for (const how of ['refuse', 'fail'] as const) {
    const { rigs, env, x, jumper, ride, hull } = spaceTrip(`up-${how}`);
    x.state.plan = [how];
    env.clock.t = 1;
    await ride.begin();
    await flyThrough(env, ride, x, jumper);
    const crossed = x.made.map((m) => m.leg.kind).join(',');
    ok(
      crossed === 'up,skip' && x.made[1].from === hull && ride.ended === 'gone' && rigs.tidy() && env.passenger.offAt.length === 1 && env.passenger.walkedTo.length === 0 && jumper.starts === 0,
      how === 'refuse' ? 'a crossing up refused is given up for a skip out of the same hull, which lands on the far pad' : 'a crossing up that failed once its world had gone is given up for a skip carried out of that hull as it was, and lands on the far pad',
    );
  }
}

{
  // More legs are put in only after the leg flown now.
  const { env, ride } = spaceTrip('insert');
  env.clock.t = 1;
  await ride.begin();
  const n = ride.route.legs.length;
  const extra: RideLeg = { kind: 'fly', world: 'space_home', zone: 'space_home', aim: { to: 'disc', zone: 'space_home', world: 'home', seconds: 1 } };
  ok(!ride.insert(ride.index, [extra]) && !ride.insert(ride.index - 1, [extra]) && ride.route.legs.length === n, 'a leg is not put in at or before the one flown now');
  ok(ride.insert(ride.index + 2, [extra]) && ride.route.legs.length === n + 1 && ride.route.legs[ride.index + 2] === extra, 'and is after it');
  ride.abort('test');
  ok(!ride.insert(ride.index + 1, [extra]), 'nor into a trip that has ended');
}

/** The galaxy with both worlds in one system (Corellia and Talus, Naboo and Rori): one orbit, the far world's disc hung in it. */
const oneSystem = {
  worldOf: (pack: string) => (pack === 'test' ? { planet: 'home' } : pack === 'there' ? { planet: 'yonder' } : null),
  orbitOf: (planet: string) => (planet === 'home' || planet === 'yonder' ? 'space_home' : null),
  noOrbit: () => '',
  hasDisc: (zone: string, planet: string) => zone === 'space_home' && planet === 'yonder',
};

/**
 * A trip within one system, with everything it needs stood in: where each world is reached in the orbit
 * they share (home at the origin, the far world at `there`, or never worked out at all with `there` null),
 * faced toward the place the trip names next as `zonePlace` faces it, and every `towards` asked with.
 */
function acrossTrip(id: string, there: THREE.Vector3 | null) {
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const env = makeHost(hull, rigs, watching(far));
  const x = crossings(env, rigs);
  const jumper = new FakeJump();
  spaceTrips(env, jumper);
  const towards: string[] = [];
  const here = new THREE.Vector3();
  env.host.spacePlace = (aim, next, out) => {
    towards.push(next ? `${next.zone}:${next.world}` : '');
    if (aim.world === 'yonder' && !there) return new Promise<boolean>(() => {});
    const at = aim.world === 'yonder' ? there! : here;
    out.pos.copy(at);
    const to = next ? (next.world === 'yonder' ? there : here) : null;
    if (to && to.distanceTo(at) > 1e-3) {
      const q = lookRotation([to.x - at.x, to.y - at.y, to.z - at.z]);
      out.quaternion.set(q[0], q[1], q[2], q[3]);
    } else out.quaternion.identity();
    return Promise.resolve(true);
  };
  const ride = new ShuttleRide(planRoute(ticketThrough(id), origin, far, 'test', null, { facts: oneSystem, gate: 1100, discSeconds: RIDE_TUNE.discSeconds })!, env.host, true);
  jumper.ride = ride;
  return { hull, rigs, env, x, jumper, ride, towards };
}

{
  // Within one system: up into the orbit both worlds share, faced toward the far world's place and flown
  // across to it, turned to its disc, then down onto it and landed. No jump.
  const there = new THREE.Vector3(7000, 400, 3000);
  const { rigs, env, x, jumper, ride, towards } = acrossTrip('across', there);
  const plan = ride.route.legs.map((l) => (l.kind === 'fly' ? `fly(${l.aim?.to})` : l.kind)).join(',');
  env.clock.t = 1;
  await ride.begin();
  let acrossAt = -1;
  let wasAcross = false;
  await flyThrough(env, ride, x, jumper, () => {
    const across = ride.leg?.aim?.to === 'zonePlace' && ride.leg.kind === 'fly';
    // Where the hull stood as the trip judged the flight over: this frame's update has not moved it.
    if (wasAcross && !across && acrossAt < 0 && ride.hull) acrossAt = ride.hull.pos.distanceTo(there);
    wasAcross = across;
  });
  const times = ride.legTimes();
  const acrossSeconds = times.find((t) => t.kind === 'fly' && t.aim?.startsWith('zonePlace'))?.seconds ?? Infinity;
  ok(plan === 'board,lift,climb,up,fly(zonePlace),fly(disc),down,fly(join),land,off,leave' && jumper.starts === 0 && x.made.map((m) => m.leg.kind).join(',') === 'up,down', `within one system it comes up, flies across, turns to the far world's disc and comes down, with no jump (${plan})`);
  ok(towards[0] === 'space_home:yonder', `the crossing up is faced toward where the far world is reached, the next place the trip flies to (${towards[0] || 'nothing'})`);
  ok(acrossAt >= 0 && acrossAt <= RIDE_TUNE.arriveWithin && acrossSeconds < RIDE_TUNE.acrossMaxSeconds, `the flight across ends within ${RIDE_TUNE.arriveWithin} m of it (${f1(acrossAt)} m, after ${acrossSeconds} s)`);
  ok(ride.ended === 'gone' && env.passenger.offAt.length === 1 && rigs.tidy() && env.passenger.walkedTo.length === 0 && (ride.report() as { rescues: number }).rescues === 0, 'and it lands on the far pad and lets its passenger off, with nobody rescued');
}

{
  // Across more of one system than `jumpBeyond`, the flight is jumped instead: the same leg made a jump
  // to the same place, and the trip lands all the same.
  const there = new THREE.Vector3(RIDE_TUNE.jumpBeyond + 5000, 0, 0);
  const { rigs, env, x, jumper, ride } = acrossTrip('beyond', there);
  env.clock.t = 1;
  await ride.begin();
  await flyThrough(env, ride, x, jumper);
  const at = ride.route.legs.findIndex((l) => l.kind === 'jump');
  const leg = ride.route.legs[at];
  ok(at === 4 && leg.aim?.to === 'zonePlace' && leg.aim.world === 'yonder' && jumper.starts === 1 && jumper.zone === 'space_home', `a flight across ${f1((RIDE_TUNE.jumpBeyond + 5000) / 1000)} km is jumped instead, to the same place (leg ${at}: ${leg?.kind})`);
  ok(ride.ended === 'gone' && env.passenger.offAt.length === 1 && rigs.tidy() && x.made.map((m) => m.leg.kind).join(',') === 'up,down', 'and it comes down and lands on the far pad');
}

{
  // A far world's place never worked out: flown straight on, and after `acrossMaxSeconds` the trip goes on
  // from wherever it is rather than keeping anybody in space.
  const was = RIDE_TUNE.acrossMaxSeconds;
  RIDE_TUNE.acrossMaxSeconds = 20;
  try {
    const { rigs, env, x, jumper, ride } = acrossTrip('never', null);
    env.clock.t = 1;
    await ride.begin();
    await flyThrough(env, ride, x, jumper);
    const acrossSeconds = ride.legTimes().find((t) => t.kind === 'fly' && t.aim?.startsWith('zonePlace'))?.seconds ?? Number.NaN;
    ok(Math.abs(acrossSeconds - RIDE_TUNE.acrossMaxSeconds) < 0.1 && ride.ended === 'gone' && env.passenger.offAt.length === 1 && rigs.tidy() && x.made.map((m) => m.leg.kind).join(',') === 'up,down', `a flight across to a place never worked out goes on after ${RIDE_TUNE.acrossMaxSeconds} s (${acrossSeconds} s), and the trip comes down and lands`);
  } finally {
    RIDE_TUNE.acrossMaxSeconds = was;
  }
}

{
  // A climb that can never reach its height over the ground (ground rising under it all the way): the
  // crossing up is made after `climbMaxSeconds` whatever the height.
  const was = RIDE_TUNE.climbMaxSeconds;
  RIDE_TUNE.climbMaxSeconds = 12;
  try {
    const { rigs, env, x, jumper, ride } = spaceTrip('steep');
    env.host.groundCached = () => (ride.leg?.kind === 'climb' || ride.leg?.kind === 'up' ? (ride.hull?.pos.y ?? 0) - 100 : 0);
    env.clock.t = 1;
    await ride.begin();
    await flyThrough(env, ride, x, jumper);
    const climbSeconds = ride.legTimes().find((t) => t.kind === 'climb')?.seconds ?? Number.NaN;
    ok(Math.abs(climbSeconds - RIDE_TUNE.climbMaxSeconds) < 0.1 && x.made[0]?.leg.kind === 'up' && ride.ended === 'gone' && rigs.tidy(), `a climb whose ground never falls away crosses up after ${RIDE_TUNE.climbMaxSeconds} s (${climbSeconds} s), and the trip goes on and lands`);
  } finally {
    RIDE_TUNE.climbMaxSeconds = was;
  }
}

{
  // The crossing down comes out inside the reach the far world's starports load out to, less a margin,
  // and never nearer than `downReachMin`.
  for (const [range, want] of [
    [1200, 1200 - RIDE_TUNE.downReachMargin],
    [500, RIDE_TUNE.downReachMin],
  ] as const) {
    const { env, x, jumper, ride } = spaceTrip(`near${range}`);
    env.host.nearRange = () => range;
    env.clock.t = 1;
    await ride.begin();
    await flyThrough(env, ride, x, jumper, () => {}, () => x.made.length >= 2);
    const down = x.made[1];
    const out = down ? Math.hypot(down.at.x - far.x, down.at.z - far.z) : Number.NaN;
    ok(down?.leg.kind === 'down' && Math.abs(out - want) < 1e-6, `with starports loading out to ${range} m the crossing down comes out ${f1(out)} m from the pad (${want})`);
    ride.abort('test');
  }
}

{
  // Where the far world's ground stands over where the crossing down comes out (the glide is worked out
  // from the pad and its join alone, before that world is there to ask), the hull that came out is raised
  // straight up to `downClear` over it before it is let go, and flown on from there; over ground under it,
  // it is let go exactly where it came out.
  for (const ground of [far.y + 400, far.y - 50]) {
    const { env, x, jumper, ride } = spaceTrip(`ground${ground}`);
    env.host.groundCached = () => (env.current.world === 'there' ? ground : 0);
    env.clock.t = 1;
    await ride.begin();
    await flyThrough(env, ride, x, jumper, () => {}, () => x.made.length >= 2 && !ride.crossing && !!ride.hull && ride.leg?.kind === 'fly');
    const h = ride.hull as FakeHull | null;
    const asked = x.made[1]?.at.y ?? Number.NaN;
    const want = Math.max(asked, ground + RIDE_TUNE.downClear);
    ok(!!h && h.launches === 1 && Math.abs(h.launchedFrom.y - want) < 1e-6 && Math.abs(h.launchedFrom.x - x.made[1].at.x) < 1e-6 && Math.abs(h.launchedFrom.z - x.made[1].at.z) < 1e-6, ground > asked ? `coming out ${f1(ground + RIDE_TUNE.downClear - asked)} m under ${RIDE_TUNE.downClear} m over the far world's ground, it is raised straight up to it before it is let go` : `over ground well under it, it is let go exactly where it came out (${f1(asked - ground)} m over the ground)`);
    ride.abort('test');
  }
}

{
  // No pad on the far world: the flight through space is flown, and the passenger is set down at the port.
  const hull = new FakeHull();
  const rigs = new FakeRigs();
  const env = makeHost(hull, rigs, watching(far));
  const x = crossings(env, rigs);
  const jumper = new FakeJump();
  spaceTrips(env, jumper);
  const ride = new ShuttleRide(planRoute(ticketThrough('bare'), origin, null, 'test', null, spacePlan)!, env.host, true);
  jumper.ride = ride;
  env.clock.t = 1;
  await ride.begin();
  const kinds: string[] = [];
  await flyThrough(env, ride, x, jumper, (_b, now) => {
    if (kinds.at(-1) !== now) kinds.push(now);
  });
  const p = env.passenger;
  ok(kinds.join(',') === 'board,lift,climb,up,jump,fly,walkOff,ended', `with no pad over there it is flown up, through the jump and toward the far world, and then ends (${kinds.join(', ')})`);
  ok(ride.ended === 'walked' && p.walkedTo.join() === far.port && p.seatedIn === null && !ride.riding && rigs.tidy() && p.ended.length === 1 && jumper.starts === 1 && x.made.length === 1 && env.world.size === 0, 'with the passenger set down at the port it was flying to, off the hull, the hull taken away, nothing held, the host told once');
}

// ---------------------------------------------------------------- a frame makes nothing
//
// Read where it can really fail: in the code of every method a frame of a trip runs and every function
// of the path arithmetic it calls, with the comments taken out. Each pattern is first tried on a line
// that really does the thing, so a pattern that has quietly stopped matching fails here rather than
// passing the code by default. A heap count cannot do this job alone (the scavenger hides short-lived
// garbage, and the engine boxes a number here and there on its own), so it is used only as a coarse
// second line below.

{
  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), 'utf8')
      // A checkout that writes Windows line endings must read the same as one that does not.
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
  /**
   * A function's or a method's body, from the brace after its parameter list to the brace that closes
   * it. A method is a class member whose one-line signature ends in its opening brace, which is what
   * tells it from an interface member of the same name (those end in a semicolon).
   */
  const bodyOf = (src: string, name: string, method: boolean): string | null => {
    let open: number;
    if (method) {
      const at = new RegExp(`\\n  (?:private )?${name}\\([^\\n]*\\{\\n`).exec(src);
      if (!at) return null;
      open = at.index + at[0].length - 2;
    } else {
      const at = new RegExp(`\\n(?:export )?function ${name}\\(`).exec(src);
      if (!at) return null;
      let i = at.index + at[0].length;
      for (let depth = 1; depth > 0 && i < src.length; i++) depth += src[i] === '(' ? 1 : src[i] === ')' ? -1 : 0;
      open = src.indexOf('{', i);
    }
    let end = open + 1;
    for (let depth = 1; depth > 0 && end < src.length; end++) depth += src[end] === '{' ? 1 : src[end] === '}' ? -1 : 0;
    return src.slice(open, end);
  };
  const ride = read('../../../src/world/shuttleRide.ts');
  const path = read('../../../src/world/rigPath.ts');
  const hull = read('../../../src/vehicles/rigHull.ts');
  const frame: [string, string, boolean][] = [
    ...['update', 'board', 'liftOff', 'skip', 'fly', 'land', 'parked', 'leave', 'next', 'readRound', 'drive', 'parkAtStart', 'flyClip', 'handOver', 'beginLanding', 'park', 'findAlight', 'parkedOn', 'holdDestNow', 'promptPhase', 'keepPlace', 'standsAt', 'startClimb', 'climb', 'climbOn', 'upWait', 'jumpLeg', 'flySpace', 'downLeg', 'planetTop', 'spaceTop'].map((n) => [ride, n, true] as [string, string, boolean]),
    ...['onPad', 'turnOnPad', 'vehicleFromJoint', 'poseRigAction', 'bracket', 'pathPose', 'pathVelocity', 'vehicleAt', 'vehicleVelocity', 'noseOntoPath', 'settleOnto', 'settleSeconds', 'alignShare', 'landingTarget', 'inSight'].map((n) => [path, n, false] as [string, string, boolean]),
    [hull, 'pose', true],
  ];
  const makers: [RegExp, string, string][] = [
    [/\bnew\b/, 'a constructor call', 'new Foo()'],
    [/=>/, 'an arrow function, which would be a closure made per call', 'const f = () => 1;'],
    [/function\s*\(/, 'an anonymous function expression', 'const f = function () {};'],
    [/\.\.\./, 'a spread, which copies', 'g(...xs)'],
    [/=\s*\{/, 'an object literal assigned', 'const o = {a: 1};'],
    [/=\s*\[/, 'an array literal assigned', 'const o = [1];'],
    [/return\s*\{/, 'an object literal returned', 'return {a: 1};'],
    [/return\s*\[/, 'an array literal returned', 'return [1];'],
    [/\(\s*\{/, 'an object literal passed', 'g({a: 1})'],
    [/\(\s*\[/, 'an array literal passed', 'g([1])'],
    [/,\s*\{/, 'an object literal in an argument list', 'g(0, {a: 1})'],
    [/,\s*\[/, 'an array literal in an argument list', 'g(0, [1])'],
    [/\.(map|filter|slice|concat|split|join|flat|reduce|sort|from|clone|keys|values|entries)\s*\(/, 'a method that makes an array, a string or a copy', 'v.clone()'],
    [/\.toArray\(\s*\)/, 'a toArray with nothing to write into', 'v.toArray()'],
    [/`/, 'a template literal', 'const s = `a`;'],
    [/\bArray\b|\bObject\s*\.|\bJSON\s*\.|\bString\s*\(/, 'a builtin that makes something', 'Object.keys(o)'],
  ];
  const bodies: string[] = [];
  const missing: string[] = [];
  for (const [src, name, method] of frame) {
    const b = bodyOf(src, name, method);
    if (b && b.length > 2) bodies.push(b);
    else missing.push(name);
  }
  ok(missing.length === 0, `every method a frame of a trip runs, and every function of the arithmetic it calls, is found to be read (${frame.length}; missing: ${missing.join(', ') || 'none'})`);
  for (const [pattern, what, bait] of makers) {
    ok(pattern.test(bait), `the reading can still see ${what} where there is one (${JSON.stringify(bait)})`);
    const hit = bodies.map((b) => b.match(pattern)).find((m) => m);
    ok(!hit, `and none of them has one${hit ? ` (found ${JSON.stringify(hit[0])})` : ''}`);
  }
}

{
  // The coarse second line: what a stretch of frames allocates, read off the young generation straight
  // after it with no collection in between, against the same stretch doing only what a trip cannot help
  // doing (reading the round and posing the limbs, whose mixer boxes numbers of its own). A few hundred
  // bytes a frame either way is the engine's own boxing and is not ours to count; kilobytes a frame is
  // somebody's garbage, and a stretch that makes some is here to show this can fail.
  const g = (globalThis as { gc?: () => void }).gc;
  if (!g) note('what a frame of a trip allocates is not measured: run with node --expose-gc');
  else {
    const hull = new FakeHull();
    const rigs = new FakeRigs();
    const { host, clock } = makeHost(hull, rigs, watching(origin));
    const ride = new ShuttleRide(planHop(origin, destination), host);
    clock.t = WAIT + 0.5;
    await ride.begin();
    const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
    /** The most a frame allocated over five short stretches (short enough that no scavenge falls inside one). */
    const perFrame = (step: () => void): number => {
      let most = -Infinity;
      for (let round = 0; round < 5; round++) {
        g();
        const start = young();
        for (let i = 0; i < 100; i++) step();
        most = Math.max(most, (young() - start) / 100);
      }
      return most;
    };
    const st: ShuttleState = { phase: 'away', until: 0, left: 0, glide: 0 };
    const rp: RigPose = { role: 'sky', seconds: 0, shown: false };
    const sink = { junk: '' };
    // The lift-off, crawling along its clip so every frame measured is lift-off.
    const crawl = () => {
      clock.t += DT / 60;
      ride.update(DT);
    };
    const crawlBare = () => {
      clock.t += DT / 60;
      host.round(origin, st);
      rigPose(st, origin.times, rp);
      hull.rig.pose('lift', rp.seconds, '');
    };
    const crawlJunk = () => {
      crawl();
      sink.junk = JSON.stringify(ride.report());
    };
    for (let i = 0; i < 3000; i++) {
      crawl();
      crawlBare();
      crawlJunk();
    }
    const lift = perFrame(crawl) - perFrame(crawlBare);
    const liftJunk = perFrame(crawlJunk) - perFrame(crawlBare);
    const lifting = ride.leg?.kind === 'lift';
    // On to the landing, a little of it at a time.
    clock.t = WAIT + FLYING.lift + 1;
    for (let i = 0; i < 400 && ride.leg?.kind !== 'land'; i++) {
      ride.update(DT);
      hull.step(DT);
    }
    let bareT = 1;
    const landing = () => ride.update(DT / 100);
    const landingBare = () => {
      bareT += DT / 100;
      hull.rig.pose('land', bareT, '');
    };
    for (let i = 0; i < 1000; i++) {
      landing();
      landingBare();
    }
    const land = perFrame(landing) - perFrame(landingBare);
    // Measured here at under 300 bytes over the stretch without the trip's work (numbers the engine boxes
    // as they cross into a function it did not inline), and the report written out at about 3.5 KB.
    const LIMIT = 1024;
    ok(lifting && ride.leg?.kind === 'land', 'the stretches measured are lift-off and landing');
    ok(lift < LIMIT && land < LIMIT, `a frame of lift-off or of landing allocates next to nothing beyond reading its round and posing its limbs (${Math.round(lift)} and ${Math.round(land)} bytes, under ${LIMIT})`);
    ok(liftJunk > LIMIT, `while a frame that also wrote out the report would show (${Math.round(liftJunk)} bytes)`);
    ride.abort('test');
  }
}

console.log(`\nshuttle ride: ${passed} checks passed`);
