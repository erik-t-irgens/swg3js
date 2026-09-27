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
// Run: node --expose-gc tools/swg/tests/shuttleRide.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import * as THREE from 'three';
import { FLYING, flyingRig } from './rigFixtures.ts';
import { Physics } from '../../../src/core/physics.ts';
import { RigHull, assembleRigModel } from '../../../src/vehicles/rigHull.ts';
import type { DriveInput } from '../../../src/vehicles/vehicle';
import { planHop, type PadRef } from '../../../src/world/rideRoute.ts';
import { RIG_PATH_TUNE, noseOntoPath, onPad, pathPose, pathVelocity, poseRigAction, turnOnPad, vehicleAt, vehicleFromJoint, type RigActions } from '../../../src/world/rigPath.ts';
import { RIDE_TUNE, ShuttleRide, type RideHost, type RideHull, type RideRigs } from '../../../src/world/shuttleRide.ts';
import { SHUTTLE_RIG_TUNE, ShuttleRigs, type RigDrive, type RigFx } from '../../../src/world/shuttleRigs.ts';
import { rigPose, type RigClips, type RigPose, type ShuttleState } from '../../../src/world/travelTerminal.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}
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
  readonly def = null;
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
  }
  setGhost(on: boolean): void {
    this.ghosted = on;
  }
  /** What flyShip does between holds, as much as a trip needs: its cruise eased toward the drive's, straight on along its nose. */
  step(dt: number): void {
    if (this.held || this.disposed) return;
    const want = this.autopilot?.drive.cruise;
    if (want !== undefined) this.cruise = this.cruise < want ? Math.min(want, this.cruise + 20 * dt) : Math.max(want, this.cruise - 25 * dt);
    this.speed = this.cruise;
    this.velocity.set(0, 0, 1).applyQuaternion(this.group.quaternion).multiplyScalar(this.cruise);
    this.pos.addScaledVector(this.velocity, dt);
    this.group.position.copy(this.pos);
  }
}

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
  fxFor(): RigFx {
    return this.fx;
  }
  rebranch(_fx: RigFx, mood: string): boolean {
    this.rebranched.push(mood);
    return true;
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
function makeHost(hull: FakeHull | (() => Promise<FakeHull | null>), rigs: RideRigs, camera: THREE.Camera) {
  const clock = { t: 0 };
  const world = new Set<RideHull>();
  const counts = { shown: 0, disposed: 0 };
  const late = new Map<string, number>();
  const host: RideHost = {
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
    inSpace: () => false,
  };
  return { host, clock, world, counts, late };
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
  // No floor under the foot of the ramp: the collector's own place, if its building has one.
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
    ok(ride.alightFrom === from && (!c || ride.alightAt.distanceTo(new THREE.Vector3(c.x, c.y, c.z)) < 1e-9), `with no floor under the ramp, a passenger would be stood ${c ? "at the collector's own place" : 'where the ramp ends, and the report says there was no floor'} (${ride.alightFrom})`);
    ride.abort('test');
  }
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
    ...['update', 'board', 'liftOff', 'skip', 'land', 'parked', 'leave', 'next', 'readRound', 'drive', 'parkAtStart', 'flyClip', 'handOver', 'beginLanding', 'park', 'findAlight', 'parkedOn', 'holdDestNow'].map((n) => [ride, n, true] as [string, string, boolean]),
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
