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
import { lookRotation } from '../../../src/space/hyperspaceMath.ts';
import { RIG_HULL_TUNE, RigHull, assembleRigModel, hullJointOf } from '../../../src/vehicles/rigHull.ts';
import { downArrival, padOfPort, type PadRef } from '../../../src/world/rideRoute.ts';
import { landingTarget, makeLandingTarget, noseOntoPath, onPad, pathPose, pathVelocity, turnOnPad, vehicleFromJoint } from '../../../src/world/rigPath.ts';
import { RIDE_PILOT, ShuttlePilot, planCourse, planRadius, type RideCourse, type RideState } from '../../../src/world/shuttleCourse.ts';
import { RIDE_TUNE, downGlideOf } from '../../../src/world/shuttleRide.ts';
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

/**
 * Every rigged pad a ticket can land on (a port's pad, `padOfPort`) with each landing a hull can bring to
 * it -- every rig, landing with the branch its take-off branches land with, once each -- and where the
 * crossing down onto that pad comes out, worked out exactly as the ride works it out (`landingTarget`,
 * `downArrival` at `reach`, `downGlideOf`), as a pair whose "cut" is that arrival: the hull there, facing
 * along its glide, at the pilot's cruise. The pad is both ends of the pair, which is what flat ground and
 * the clearance a flight is held to beyond it are measured about. `byTicket` is whether any ticket flies
 * that rig down there: only a starport leaves its world and a trip's hull is its boarding pad's own rig, so
 * a crossing down is only ever flown by a rig that stands on some world's starport (on the converted worlds
 * every one is the transport), and an arrival of any other rig is flown here for its numbers alone. Empty
 * with no converted worlds.
 */
export function rigArrivals(packs = join(process.cwd(), 'assets-private'), reach = RIDE_TUNE.downReach): (RigPair & { run: number; glide: number; byTicket: boolean })[] {
  const out: (RigPair & { run: number; glide: number; byTicket: boolean })[] = [];
  if (!existsSync(packs)) return out;
  const rigsAll = packRigs(packs, readdirSync, existsSync, join);
  const hullOf = hullsOf(packs);
  const target = makeLandingTarget();
  const speed = Math.min(RIDE_PILOT.cruise, RIG_HULL_TUNE.maxSpeed);
  // Every world's rigged pads first, and which rigs stand on a starport's pad on any of them.
  const worlds: { pack: string; rigs: Record<string, TravelRig>; pads: Map<string, PadRef> }[] = [];
  const leaving = new Set<string>();
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
    const pads = new Map<string, PadRef>();
    for (const port of ports) {
      const pad = padOfPort(things, ports, port.name, pack, rigs);
      if (!pad?.rig) continue;
      pads.set(pad.key, pad);
      if (port.kind === 'starport') leaving.add(pad.rig);
    }
    worlds.push({ pack, rigs, pads });
  }
  for (const { pack, rigs, pads } of worlds) {
    for (const to of pads.values()) {
      for (const [rigName, rig] of Object.entries(rigs)) {
        const landings = new Set<string>();
        for (const mood of Object.keys(rig.moods)) {
          const hull = hullOf(rigName, rig, mood);
          const paths = hull?.paths(mood);
          if (!hull || !paths?.join || landings.has(paths.landMood)) continue;
          landings.add(paths.landMood);
          landingTarget(to, paths.land, paths.join, hull.offset, target);
          const glide = downGlideOf(-target.climb);
          const a = downArrival([to.x, to.y, to.z], { at: [target.pos.x, target.pos.y, target.pos.z], dirX: Math.sin(target.heading), dirZ: Math.cos(target.heading) }, reach, glide);
          const q = lookRotation(a.forward);
          out.push({
            pack,
            from: to,
            to,
            label: `${pack}: down onto ${to.port || to.key} (${rigName} landing ${paths.landMood || 'its own'})`,
            cut: { pos: new THREE.Vector3(a.at[0], a.at[1], a.at[2]), quat: new THREE.Quaternion(q[0], q[1], q[2], q[3]), speed },
            join: { x: target.pos.x, y: target.pos.y, z: target.pos.z, heading: target.heading, speed: target.speed, descent: -target.climb, ground: to.y },
            run: a.run,
            glide,
            byTicket: leaving.has(rigName),
          });
        }
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
  /**
   * How it swayed over the last `swayWindow` seconds before the join: how many times the stick changed
   * sides on each axis (past `stickDead` either way), and how many times the hull went from climbing to
   * sinking or back (past `climbDead` metres a second either way).
   */
  flipsX: number;
  flipsY: number;
  heightTurns: number;
  /** Degrees: the most the hull ever dived past the steepest the pilot may ask for (the join's own glide and five, or `descentMax`). */
  diveOver: number;
  /** Degrees: how much the first course planned turns in all (every bend's own angle added up), and how much the hull really turned, flown. */
  courseTurn: number;
  flownTurn: number;
  /** Degrees: the steepest the hull's nose ever pointed down. */
  steepest: number;
}

/** The stretch before the join the sway is counted over, in seconds, and what counts as a side and as a climb. */
export const SWAY = { window: 30, stickDead: 0.05, climbDead: 0.5 };

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
export function flyCourse(p: RigPair, ground: (x: number, z: number) => number, opts: { dt?: number; maxSeconds?: number; padNear?: number; startGround?: number | undefined } = {}): Flight {
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
  // The ground under where it is let go: the pad it leaves, straight off a take-off, and nothing known for
  // a start that is not (a crossing down plans its course knowing nothing of the ground yet).
  let course = plan('startGround' in opts ? opts.startGround : p.from.y);
  const first = course;
  let courseTurn = 0;
  for (let i = 1; i < first.n; i++) courseTurn += Math.abs(Math.atan2(Math.sin(first.hs[i] - first.hs[i - 1]), Math.cos(first.hs[i] - first.hs[i - 1])));
  let flownTurn = 0;
  let steepest = 0;
  nose.set(0, 0, 1).applyQuaternion(q);
  let lastHeading = Math.atan2(nose.x, nose.z);
  const groundCached = (x: number, z: number): number => ground(x, z);
  let t = 0;
  let joined = false;
  let minClear = Infinity;
  let under = 0;
  let deepest = 0;
  let highest = -Infinity;
  let offCourse = 0;
  const highPad = Math.max(p.from.y, p.to.y);
  // The stick and the climb every step, for the sway before the join; and the steepest dive allowed.
  const steps = Math.ceil(maxSeconds / dt) + 1;
  const sx = new Float32Array(steps);
  const sy = new Float32Array(steps);
  const climb = new Float32Array(steps);
  let recorded = 0;
  let diveOver = -Infinity;
  const allowed = Math.max((p.join.descent ?? 0) + (5 * Math.PI) / 180, (RIDE_PILOT.descentMax * Math.PI) / 180);
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
    const heading = Math.atan2(nose.x, nose.z);
    flownTurn += Math.abs(Math.atan2(Math.sin(heading - lastHeading), Math.cos(heading - lastHeading)));
    lastHeading = heading;
    steepest = Math.max(steepest, -Math.asin(Math.max(-1, Math.min(1, nose.y))));
    if (recorded < steps) {
      sx[recorded] = d.stickX;
      sy[recorded] = d.stickY;
      climb[recorded] = nose.y * cruise;
      recorded++;
    }
    diveOver = Math.max(diveOver, ((-Math.asin(Math.max(-1, Math.min(1, nose.y))) - allowed) * 180) / Math.PI);
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
  const from = Math.max(0, recorded - Math.round(SWAY.window / dt));
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
    flipsX: sideChanges(sx, from, recorded, SWAY.stickDead),
    flipsY: sideChanges(sy, from, recorded, SWAY.stickDead),
    heightTurns: sideChanges(climb, from, recorded, SWAY.climbDead),
    diveOver,
    courseTurn: (courseTurn * 180) / Math.PI,
    flownTurn: (flownTurn * 180) / Math.PI,
    steepest: (steepest * 180) / Math.PI,
  };
}

/** How many times the values from `from` to `to` change sides, a value within `dead` of nought counting as neither. */
export function sideChanges(xs: Float32Array, from: number, to: number, dead: number): number {
  let n = 0;
  let side = 0;
  for (let i = from; i < to; i++) {
    const s = xs[i] > dead ? 1 : xs[i] < -dead ? -1 : 0;
    if (!s) continue;
    if (side && s !== side) n++;
    side = s;
  }
  return n;
}

/** A value `f` of the way up a sorted copy of `xs`. */
export function quantile(xs: readonly number[], f: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] : Number.NaN;
}
