// What the shuttle course's tests share: every directed pair of rigged pads on the converted worlds,
// with the pose the take-off lets the hull go at and the join its landing takes it back at, both worked
// out exactly as the ride works them out (the game's own clips, `RigHull.paths`, `landingTarget`); and
// a flight of the shuttle's pilot through flyShip's own integration at the rig hull's own handling.
//
// Not a test itself: `shuttleCourse.test.ts` (flat ground) and `shuttleCourseTerrain.ts` (the real
// ground, by hand) import it.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { loadGlb, packRigs } from './rigFixtures.ts';
import { RIG_HULL_TUNE, RigHull, assembleRigModel, hullJointOf } from '../../../src/vehicles/rigHull.ts';
import { padOfPort, type PadRef } from '../../../src/world/rideRoute.ts';
import { landingTarget, makeLandingTarget, noseOntoPath, onPad, pathPose, pathVelocity, turnOnPad, vehicleFromJoint } from '../../../src/world/rigPath.ts';
import { RIDE_PILOT, ShuttlePilot, planCourse, planRadius, type RideCourse, type RideState } from '../../../src/world/shuttleCourse.ts';
import { portsOf, ridesFrom, type PoiRow } from '../../../src/world/shuttle.ts';
import { travelThingsOf, type TravelRig, type TravelRow } from '../../../src/world/travelTerminal.ts';

/** One directed pair: the pads, where the hull is let go (its place, its turn, its speed) and the join it is flown to. */
export interface RigPair {
  pack: string;
  from: PadRef;
  to: PadRef;
  label: string;
  cut: { pos: THREE.Vector3; quat: THREE.Quaternion; speed: number };
  join: RideState;
}

/** A hull of each rig and branch, framed as the garage frames it, made once. */
function hullsOf(packs: string): (rigName: string, rig: TravelRig, mood: string) => RigHull | null {
  const made = new Map<string, RigHull | null>();
  const loaded = new Map<string, { skeleton: ReturnType<typeof loadGlb>; pieces: { joint: string; model: THREE.Object3D }[] } | null>();
  return (rigName, rig, mood) => {
    const key = `${rigName}/${mood}`;
    if (made.has(key)) return made.get(key) ?? null;
    let files = loaded.get(rigName);
    if (files === undefined) {
      files = existsSync(join(packs, rig.file)) && rig.parts.every((p) => existsSync(join(packs, p.file))) ? { skeleton: loadGlb(join(packs, rig.file)), pieces: rig.parts.map((p) => ({ joint: p.joint, model: loadGlb(join(packs, p.file)).scene as THREE.Object3D })) } : null;
      loaded.set(rigName, files);
    }
    const clips = rig.moods[mood] ?? Object.values(rig.moods)[0];
    if (!files || !clips) {
      made.set(key, null);
      return null;
    }
    const assembled = assembleRigModel({ scene: files.skeleton.scene.clone(true), animations: files.skeleton.animations }, files.pieces.map((p) => ({ joint: p.joint, model: p.model.clone(true) })), hullJointOf(rig), clips);
    const hull = new RigHull(assembled, clips, rig.moods);
    hull.frame();
    made.set(key, hull);
    return hull;
  };
}

/**
 * Every directed pair of rigged pads over the converted worlds, as a ticket names them (a port's pad is
 * the rigged shuttle nearest it, `padOfPort`; the pairs are the local rides the port offers), with the
 * hand-over at the cut and the join as the ride flies them. Empty with no converted worlds.
 */
export function rigPairs(packs = join(process.cwd(), 'assets-private')): RigPair[] {
  const out: RigPair[] = [];
  if (!existsSync(packs)) return out;
  const rigsAll = packRigs(packs, readdirSync, existsSync, join);
  const hullOf = hullsOf(packs);
  const jP = new THREE.Vector3();
  const jQ = new THREE.Quaternion();
  const vel = new THREE.Vector3();
  const target = makeLandingTarget();
  for (const pack of readdirSync(packs).sort()) {
    const tp = join(packs, pack, 'travel.json');
    const pp = join(packs, pack, 'pois.json');
    if (pack.startsWith('space_') || !existsSync(tp) || !existsSync(pp)) continue;
    const travel = JSON.parse(readFileSync(tp, 'utf8')) as { rows?: TravelRow[]; rigs?: Record<string, TravelRig> };
    const pois = JSON.parse(readFileSync(pp, 'utf8')) as { center?: { x: number; z: number }; pois?: PoiRow[] };
    if (!pois.center || !Array.isArray(travel.rows)) continue;
    const rigs = { ...rigsAll, ...(travel.rigs ?? {}) };
    const things = travelThingsOf(travel.rows, pois.center);
    const ports = portsOf(pois.pois ?? [], pois.center);
    for (const a of ports) {
      const from = padOfPort(things, ports, a.name, pack, rigs);
      if (!from?.rig) continue;
      for (const r of ridesFrom(a, ports, pack, { routes: [], local: {} }, () => null)) {
        const to = padOfPort(things, ports, r.name, pack, rigs);
        if (!to) continue;
        const hull = hullOf(from.rig, rigs[from.rig], from.mood);
        const paths = hull?.paths(from.mood);
        if (!hull || !paths?.cut || !paths.join) continue;
        // The cut as the ride lets go there: the clip's pose on the pad, its nose brought wholly onto its path.
        const t = paths.cut.t;
        pathPose(paths.lift, t, jP, jQ);
        onPad(from, jP, jQ);
        turnOnPad(from, pathVelocity(paths.lift, t, vel));
        noseOntoPath(jQ, vel, 1, jQ);
        const pos = new THREE.Vector3();
        vehicleFromJoint(jP, jQ, hull.offset, pos);
        landingTarget(to, paths.land, paths.join, hull.offset, target);
        out.push({
          pack,
          from,
          to,
          label: `${pack}: ${a.name} -> ${r.name} (${from.rig}${from.mood ? `/${from.mood}` : ''} landing ${paths.landMood || 'its own'})`,
          cut: { pos, quat: jQ.clone(), speed: vel.length() },
          join: { x: target.pos.x, y: target.pos.y, z: target.pos.z, heading: target.heading, speed: target.speed, descent: -target.climb, ground: to.y },
        });
      }
    }
  }
  return out;
}

/** How a flight went: whether and where it met the join, how long it took, and what it flew over. */
export interface Flight {
  joined: boolean;
  error: { across: number; up: number; heading: number; speed: number };
  seconds: number;
  goArounds: number;
  course: number;
  straight: number;
  word: string;
  /** The least height over the ground beyond `padNear` of either pad, how long it was under the ground there, and how far under at worst. */
  minClear: number;
  under: number;
  deepest: number;
  /** The highest it flew over the higher pad, and the furthest it strayed off its course across the ground. */
  highest: number;
  offCourse: number;
}

const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);

/**
 * The pilot flown from a pair's cut to its join over `ground`, through flyShip's own integration at the
 * rig hull's handling (`RIG_HULL_TUNE`): the cruise eased toward the pilot's at the engines' rates and
 * never past the top speed, the turn rates eased toward the stick's over the hull's inertia and the
 * attitude turned by them in the hull's own axes, and the hull moved along its nose. A pass too far off
 * is planned again from where it is, as the ride does. `padNear` is how far from either pad a flight is
 * held to the ground at all: the game's own clips pass under the raw ground near some pads.
 */
export function flyCourse(p: RigPair, ground: (x: number, z: number) => number, opts: { dt?: number; maxSeconds?: number; padNear?: number } = {}): Flight {
  const dt = opts.dt ?? 1 / 30;
  const maxSeconds = opts.maxSeconds ?? 900;
  const padNear = opts.padNear ?? 600;
  const spec = RIG_HULL_TUNE;
  const top = Math.min(RIDE_PILOT.cruise, spec.maxSpeed);
  const radius = planRadius(top, spec.turnRate);
  const pilot = new ShuttlePilot();
  const pos = p.cut.pos.clone();
  const q = p.cut.quat.clone();
  const nose = new THREE.Vector3();
  const spin = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  let cruise = p.cut.speed;
  const plan = (known: number | undefined): RideCourse => {
    nose.set(0, 0, 1).applyQuaternion(q);
    const from: RideState = { x: pos.x, y: pos.y, z: pos.z, heading: Math.atan2(nose.x, nose.z), speed: cruise, ground: known };
    const course = planCourse(from, p.join, radius, RIDE_PILOT);
    pilot.setCourse(course, top);
    return course;
  };
  let course = plan(p.from.y);
  const first = course;
  const groundCached = (x: number, z: number): number => ground(x, z);
  let t = 0;
  let joined = false;
  let minClear = Infinity;
  let under = 0;
  let deepest = 0;
  let highest = -Infinity;
  let offCourse = 0;
  const highPad = Math.max(p.from.y, p.to.y);
  for (let step = 0; t < maxSeconds; step++) {
    const said = pilot.step(dt, t, pos, q, cruise, groundCached);
    if (said === 'join') {
      joined = true;
      break;
    }
    if (said === 'replan') course = plan(undefined);
    const d = pilot.drive;
    const want = Math.max(0, Math.min(spec.maxSpeed, d.cruise));
    cruise = cruise < want ? Math.min(want, cruise + spec.accel * dt) : Math.max(want, cruise - spec.brake * dt);
    const rate = spec.turnRate;
    const ease = Math.min(1, dt / Math.max(0.05, spec.inertia));
    const easeRoll = Math.min(1, (2 * dt) / Math.max(0.05, spec.inertia));
    spin.y += (-d.stickX * rate * 1.5 - spin.y) * ease;
    spin.x += (d.stickY * rate * 1.5 - spin.x) * ease;
    spin.z += (d.steer * rate * 1.6 - spin.z) * easeRoll;
    q.multiply(qa.setFromAxisAngle(AX_Y, spin.y * dt));
    q.multiply(qa.setFromAxisAngle(AX_X, spin.x * dt));
    q.multiply(qa.setFromAxisAngle(AX_Z, spin.z * dt));
    q.normalize();
    nose.set(0, 0, 1).applyQuaternion(q);
    pos.addScaledVector(nose, cruise * dt);
    t += dt;
    highest = Math.max(highest, pos.y - highPad);
    const c = pilot.course!;
    const i = pilot.progress;
    offCourse = Math.max(offCourse, Math.hypot(c.xs[i] - pos.x, c.zs[i] - pos.z));
    if (step % 15 === 0) {
      const dPad = Math.min(Math.hypot(pos.x - p.from.x, pos.z - p.from.z), Math.hypot(pos.x - p.to.x, pos.z - p.to.z));
      if (dPad > padNear) {
        const clear = pos.y - ground(pos.x, pos.z);
        minClear = Math.min(minClear, clear);
        if (clear < 0) {
          under += 15 * dt;
          deepest = Math.min(deepest, clear);
        }
      }
    }
  }
  const e = pilot.joinError;
  return {
    joined,
    error: { across: e.across, up: e.up, heading: e.heading, speed: e.speed },
    seconds: t,
    goArounds: pilot.goArounds,
    course: first.total,
    straight: Math.hypot(p.join.x - p.cut.pos.x, p.join.z - p.cut.pos.z),
    word: first.word,
    minClear,
    under,
    deepest,
    highest,
    offCourse,
  };
}

/** A value `f` of the way up a sorted copy of `xs`. */
export function quantile(xs: readonly number[], f: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] : Number.NaN;
}
