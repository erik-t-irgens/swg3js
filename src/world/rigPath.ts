// The arithmetic of a shuttle's rig flown as a hull rather than drawn from the clock.
//
// A shuttle's rig is a skeleton whose hull joint (the joint carrying its biggest piece: the shuttle's
// `root`, the transport's `hold_transport`) is what moves the whole ship; every other joint only
// folds a strut or opens a door relative to it. A hull flown in the world pins that joint at its
// model's origin and lets the clips pose the rest, so where the vehicle stands is the hull joint's
// pose in the rig's frame, carried onto the pad the clock rig stands on, with the framing offset
// the garage measured turned along with it:
//
//     P(t) = Pad × J(t) × T(offset)
//
// which is exactly where the clock rig draws the same hull at the same moment of the same clip, so
// the one can be swapped for the other and nobody sees it happen. Everything here is pure three, so
// node runs it (`rigHull.test.ts`, `rigPath.test.ts`), and nothing allocates per call but what says it does.
//
// A clip is also where a hull flown in the world lets go of the game's own flight and where it takes
// it back. The take-off is followed on the clock up to its **cut**, the latest moment a pilot could be
// handed the hull at a speed and an attitude the physics can fly, and the landing is joined at its
// **join**, the earliest moment after which the clip never again does anything the physics could not:
// between the two the hull is flown, and on either side it is the game's own clip, shown whole. Both
// are worked out here from the clips themselves (`takeoffCut`, `landingJoin`), so a reconversion that
// moves a clip moves them with it. Every number that decides them is ours, in `RIG_PATH_TUNE`.

import * as THREE from 'three';
import { settleEase } from '../vehicles/landing.ts';
import type { RigPose } from './travelTerminal.ts';

/**
 * Every number of ours about a rig's clips flown as a path. Live through `__debug.rigHull({ path })`,
 * taken by the next hull built.
 */
export const RIG_PATH_TUNE = {
  /** Samples a second: the converter's own clip rate, so every sample sits on a key. */
  fps: 30,
  /** Seconds either side over which a clip's acceleration and turn are measured: one frame reads the transport root's two degrees of jitter a frame as a turn. */
  window: 0.23,
  /** Metres a second past which a clip is doing what no body can: the physics' own cap (`BODY_SPEED_CAP`). */
  cinematicSpeed: 399,
  /** Metres a second squared past which it is: the physical stretches of every clip peak at about 116, the cinematic ones run for seconds at 125 to 465. */
  cinematicAccel: 150,
  /** The cut: metres over the pad (above the pad's own roofs) and the least speed a pilot can steer with. */
  cutHeight: 30,
  cutSpeedMin: 30,
  /** Degrees the nose may stand off the path at the cut (Theed climbs out 23 degrees under its nose), the turn in radians a second and the acceleration: no spin and no lurch at the hand-over. */
  cutNose: 25,
  cutTurn: 0.35,
  cutAccel: 60,
  /** The join: metres over the pad (over a town's roofs) and the least speed. */
  joinHeight: 40,
  joinSpeedMin: 30,
  /** Degrees off the path (the calm transport glides in 30 degrees down with its nose level), radians a second, metres a second squared. */
  joinNose: 35,
  joinTurn: 0.35,
  joinAccel: 40,
  /** Seconds before the cut over which the hull's nose is brought round onto its path. */
  align: 1.0,
  /** The settle onto the landing clip after the join: `clamp(error / settleRate, settleMin, settleMax)` seconds; the least is docking's own settle. */
  settleMin: 1.5,
  settleRate: 10,
  settleMax: 4,
};

/** One joint of the chain from the top of a rig's skeleton down to its hull joint, with its rest pose. */
export interface ChainLink {
  name: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Where a shuttle's pad is: its place and its turn about the vertical, as `ShuttleRigs.stand` stands one. */
export interface Pad {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const NOSE = new THREE.Vector3(0, 0, 1);
const IDENTITY = new THREE.Quaternion();
const padTurn = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const linkPos = new THREE.Vector3();
const linkQuat = new THREE.Quaternion();
/** Scratch for the per-call arithmetic below, none of it kept past a call. */
const sA = new THREE.Vector3();
const sB = new THREE.Vector3();
const sC = new THREE.Vector3();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();
const seenSphere = new THREE.Sphere();

/**
 * A pose in a rig's own frame carried onto its pad, in place: turned by the pad's yaw and moved to its
 * place, which is what the clock rig's root group does to everything under it.
 */
export function onPad(pad: Pad, pos: THREE.Vector3, quat: THREE.Quaternion): void {
  padTurn.setFromAxisAngle(AXIS_Y, pad.yaw);
  pos.applyQuaternion(padTurn);
  pos.x += pad.x;
  pos.y += pad.y;
  pos.z += pad.z;
  quat.premultiply(padTurn);
}

/** A direction or a velocity in a rig's own frame turned onto its pad, in place: the turn of `onPad` with no move. */
export function turnOnPad(pad: Pad, v: THREE.Vector3): THREE.Vector3 {
  padTurn.setFromAxisAngle(AXIS_Y, pad.yaw);
  return v.applyQuaternion(padTurn);
}

/**
 * Where the vehicle stands, from where its hull joint stands: the joint's place plus the framing offset
 * turned with the joint. Its turn is the joint's own, since the joint is pinned at the model's origin
 * with no turn of its own. `outPos` may be `jPos`.
 */
export function vehicleFromJoint(jPos: THREE.Vector3, jQuat: THREE.Quaternion, offset: THREE.Vector3, outPos: THREE.Vector3): THREE.Vector3 {
  tmpV.copy(offset).applyQuaternion(jQuat).add(jPos);
  return outPos.copy(tmpV);
}

/**
 * Where a chain's last joint stands in the rig's frame at a moment of a clip: each link's own tracks
 * sampled with the interpolants the mixer itself uses, and its rest pose where the clip has none,
 * composed from the top down. With no clip, the chain at rest. Build-time arithmetic: every
 * interpolant it makes is made for the one call.
 */
export function chainPose(chain: readonly ChainLink[], clip: THREE.AnimationClip | null, seconds: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  outPos.set(0, 0, 0);
  outQuat.identity();
  for (const link of chain) {
    linkPos.copy(link.position);
    linkQuat.copy(link.quaternion);
    if (clip) {
      for (const track of clip.tracks) {
        const dot = track.name.lastIndexOf('.');
        if (track.name.slice(0, dot) !== link.name) continue;
        // The interpolant the mixer would bind for this track (three sets it up; its typings leave it out).
        const value = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant().evaluate(Math.min(Math.max(0, seconds), clip.duration));
        const property = track.name.slice(dot + 1);
        if (property === 'position') linkPos.fromArray(value);
        else if (property === 'quaternion') linkQuat.fromArray(value).normalize();
      }
    }
    outPos.add(linkPos.applyQuaternion(outQuat));
    outQuat.multiply(linkQuat);
  }
}

/** What poses one rig: its mixer, its action for each role, and the one playing now. */
export interface RigActions {
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<RigPose['role'], THREE.AnimationAction>>;
  current: THREE.AnimationAction | null;
}

/**
 * Put a role's clip on a rig's joints at `seconds`, held there: the clock rig's pose and the flown
 * hull's limbs, one way for both, so the struts and the door of the one are where they are on the
 * other. A role with no clip of its own for parking on the ground takes the landing's last instant,
 * which is the same pose.
 */
export function poseRigAction(state: RigActions, role: RigPose['role'], seconds: number): void {
  // Parked on the ground with no clip of its own for it: the landing's last instant is the same pose.
  let action = state.actions[role];
  if (!action && role === 'ground') {
    action = state.actions.land;
    if (action) seconds = action.getClip().duration;
  }
  if (!action) return;
  if (state.current !== action) {
    state.current?.stop();
    action.reset();
    action.play();
    state.current = action;
  }
  action.paused = true;
  action.time = Math.min(seconds, action.getClip().duration);
  state.mixer.update(0);
}

/**
 * The foot of a hull's ramp in the model's frame, as it stands now: the lowest point of the piece on a
 * door joint, and of the points within five centimetres of that the one farthest out from the hull's
 * long axis, which is the ramp's far edge on the ground. Null for a rig with no door. The hull a trip is
 * flown in and the shuttle stood on its pad both find their ramps with it, so a passenger boarding the
 * one and a traveller boarding the other walk to the same place.
 */
export function rampFootOf(model: THREE.Object3D, pieces: readonly { joint: string; model: THREE.Object3D }[]): THREE.Vector3 | null {
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const points: THREE.Vector3[] = [];
  for (const p of pieces) {
    if (!/door/i.test(p.joint)) continue;
    p.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined;
      if (!pos) return;
      m.multiplyMatrices(toModel, mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) points.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
    });
  }
  if (!points.length) return null;
  let low = Infinity;
  for (const p of points) low = Math.min(low, p.y);
  let best: THREE.Vector3 | null = null;
  for (const p of points) if (p.y - low < 0.05 && (!best || Math.abs(p.x) > Math.abs(best.x))) best = p;
  return best;
}

// ---------------------------------------------------------------- a clip as a path

/**
 * A chain's last joint through a whole clip, sampled once a frame in the rig's own frame: `times[i]`
 * is `i / fps` (the last one the clip's own end), and each sample's place and turn are three and four
 * numbers of `pos` and `quat`. Double precision, since a landing starts kilometres out.
 */
export interface RigPath {
  fps: number;
  frames: number;
  seconds: number;
  times: Float64Array;
  pos: Float64Array;
  quat: Float64Array;
}

/** Every path made, by clip and then by chain and rate: a clip is the garage's for the session, so this is once per rig file and branch. */
const paths = new WeakMap<THREE.AnimationClip, Map<string, RigPath>>();

/**
 * A clip as its hull joint's path: the chain's own tracks sampled with the interpolants the mixer itself
 * binds, each made once, and composed from the top down as `chainPose` composes them. Build-time: it
 * allocates the path and its interpolants, and hands back the same path for the same clip and chain.
 */
export function rigPathOf(clip: THREE.AnimationClip, chain: readonly ChainLink[], fps = RIG_PATH_TUNE.fps): RigPath {
  const key = `${chain.map((c) => c.name).join('/')}@${fps}`;
  let byChain = paths.get(clip);
  const kept = byChain?.get(key);
  if (kept) return kept;
  const links = chain.map((link) => {
    let pos: THREE.Interpolant | null = null;
    let quat: THREE.Interpolant | null = null;
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.');
      if (track.name.slice(0, dot) !== link.name) continue;
      const property = track.name.slice(dot + 1);
      // The interpolant the mixer would bind for this track (three sets it up; its typings leave it out).
      const made = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
      if (property === 'position') pos = made;
      else if (property === 'quaternion') quat = made;
    }
    return { link, pos, quat };
  });
  const seconds = Math.max(0, clip.duration);
  // The last sample is the clip's own end: a clip a hair short of a whole frame is not given a frame past it.
  const frames = Math.max(2, Math.ceil(seconds * fps - 1e-3) + 1);
  const times = new Float64Array(frames);
  const pos = new Float64Array(frames * 3);
  const quat = new Float64Array(frames * 4);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let i = 0; i < frames; i++) {
    const t = Math.min(seconds, i / fps);
    times[i] = t;
    p.set(0, 0, 0);
    q.identity();
    for (const l of links) {
      if (l.pos) linkPos.fromArray(l.pos.evaluate(t));
      else linkPos.copy(l.link.position);
      if (l.quat) linkQuat.fromArray(l.quat.evaluate(t)).normalize();
      else linkQuat.copy(l.link.quaternion);
      p.add(linkPos.applyQuaternion(q));
      q.multiply(linkQuat);
    }
    p.toArray(pos, i * 3);
    q.toArray(quat, i * 4);
  }
  const path: RigPath = { fps, frames, seconds, times, pos, quat };
  if (!byChain) {
    byChain = new Map();
    paths.set(clip, byChain);
  }
  byChain.set(key, path);
  return path;
}

/** The sample at or before `t` and how far on toward the next, for the interpolation below. */
function bracket(path: RigPath, t: number): number {
  const last = path.frames - 2;
  let i = Math.min(last, Math.max(0, Math.floor(t * path.fps)));
  while (i > 0 && path.times[i] > t) i--;
  while (i < last && path.times[i + 1] <= t) i++;
  return i;
}

/**
 * Where a path's joint stands at `t` seconds, in the rig's frame: its place straight between two
 * samples and its turn slerped between them, which is the mixer's own interpolation, so on a sample it
 * is the sample and between two it is what the clip itself would pose. Allocates nothing.
 *
 * The slerp is `Quaternion.slerpFlat`'s own arithmetic written out here rather than called: that one is
 * handed every kind of array there is by the mixer, so the engine reads its elements through a generic
 * path that boxes each number it reads, and a trip reads a path three times a frame.
 */
export function pathPose(path: RigPath, t: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  const tc = Math.min(path.seconds, Math.max(0, t));
  const i = bracket(path, tc);
  const span = path.times[i + 1] - path.times[i];
  const k = span > 0 ? Math.min(1, Math.max(0, (tc - path.times[i]) / span)) : 0;
  const a = i * 3;
  const b = a + 3;
  const P = path.pos;
  outPos.set(P[a] + (P[b] - P[a]) * k, P[a + 1] + (P[b + 1] - P[a + 1]) * k, P[a + 2] + (P[b + 2] - P[a + 2]) * k);
  const Q = path.quat;
  const q = i * 4;
  let x0 = Q[q];
  let y0 = Q[q + 1];
  let z0 = Q[q + 2];
  let w0 = Q[q + 3];
  let x1 = Q[q + 4];
  let y1 = Q[q + 5];
  let z1 = Q[q + 6];
  let w1 = Q[q + 7];
  if (w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1) {
    let dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
    if (dot < 0) {
      x1 = -x1;
      y1 = -y1;
      z1 = -z1;
      w1 = -w1;
      dot = -dot;
    }
    let s = 1 - k;
    let u = k;
    if (dot < 0.9995) {
      const theta = Math.acos(dot);
      const sin = Math.sin(theta);
      s = Math.sin(s * theta) / sin;
      u = Math.sin(u * theta) / sin;
      x0 = x0 * s + x1 * u;
      y0 = y0 * s + y1 * u;
      z0 = z0 * s + z1 * u;
      w0 = w0 * s + w1 * u;
    } else {
      x0 = x0 * s + x1 * u;
      y0 = y0 * s + y1 * u;
      z0 = z0 * s + z1 * u;
      w0 = w0 * s + w1 * u;
      const f = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);
      x0 *= f;
      y0 *= f;
      z0 *= f;
      w0 *= f;
    }
  }
  outQuat.set(x0, y0, z0, w0);
}

/** How fast a path's joint moves at `t`, in the rig's frame: a central difference a frame either side, clamped to the clip. Allocates nothing. */
export function pathVelocity(path: RigPath, t: number, out: THREE.Vector3): THREE.Vector3 {
  const h = 1 / path.fps;
  const t0 = Math.max(0, t - h);
  const t1 = Math.min(path.seconds, t + h);
  if (!(t1 > t0)) return out.set(0, 0, 0);
  pathPose(path, t0, sA, qA);
  pathPose(path, t1, sB, qA);
  return out.copy(sB).sub(sA).divideScalar(t1 - t0);
}

/**
 * Where a vehicle flown from a rig stands at a moment of a clip on a pad: `P = Pad × J(t) × T(offset)`.
 * `outPos` and `outQuat` are written; nothing is allocated.
 */
export function vehicleAt(pad: Pad, path: RigPath, t: number, offset: THREE.Vector3, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
  pathPose(path, t, outPos, outQuat);
  onPad(pad, outPos, outQuat);
  vehicleFromJoint(outPos, outQuat, offset, outPos);
}

/** How fast that vehicle moves at `t`, in the world: a central difference of `vehicleAt` a frame either side. Allocates nothing. */
export function vehicleVelocity(pad: Pad, path: RigPath, t: number, offset: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const h = 1 / path.fps;
  const t0 = Math.max(0, t - h);
  const t1 = Math.min(path.seconds, t + h);
  if (!(t1 > t0)) return out.set(0, 0, 0);
  vehicleAt(pad, path, t0, offset, sC, qB);
  vehicleAt(pad, path, t1, offset, out, qB);
  return out.sub(sC).divideScalar(t1 - t0);
}

// ---------------------------------------------------------------- the cut and the join

/**
 * One frame of a clip as a moment a hull could be handed over at: its time and frame, and (in the
 * pad's frame, measured from the pad's own parked joint) its speed, height, distance out, climb in
 * degrees, how many degrees the nose stands off the path, its turn in radians a second and its
 * acceleration.
 */
export interface RigMoment {
  t: number;
  frame: number;
  speed: number;
  height: number;
  out: number;
  climb: number;
  noseOff: number;
  turn: number;
  accel: number;
}

/** A sample's velocity, the central difference of its neighbours as the take-off and landing are measured. */
function sampleVelocity(path: RigPath, i: number, out: THREE.Vector3): THREE.Vector3 {
  const a = Math.max(0, i - 1);
  const b = Math.min(path.frames - 1, i + 1);
  const dt = path.times[b] - path.times[a];
  const P = path.pos;
  if (!(dt > 0)) return out.set(0, 0, 0);
  return out.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]).divideScalar(dt);
}

/** One sample measured into `out`, against the parked joint at `ref`; whether it is cinematic comes back. */
function measure(path: RigPath, i: number, ref: number, tune: typeof RIG_PATH_TUNE, out: RigMoment): boolean {
  const W = Math.max(1, Math.round(tune.window * path.fps));
  const n = path.frames;
  const P = path.pos;
  const v = sampleVelocity(path, i, sA);
  const speed = v.length();
  const a0 = Math.max(0, i - W);
  const a1 = Math.min(n - 1, i + W);
  const span = path.times[a1] - path.times[a0];
  sampleVelocity(path, a1, sB).sub(sampleVelocity(path, a0, sC));
  const accel = span > 0 ? sB.length() / span : 0;
  qA.fromArray(path.quat, a0 * 4);
  qB.fromArray(path.quat, a1 * 4);
  const turn = span > 0 ? qA.angleTo(qB) / span : 0;
  qC.fromArray(path.quat, i * 4);
  const nose = sB.copy(NOSE).applyQuaternion(qC);
  const cos = speed > 0.5 ? v.dot(nose) / speed : 0;
  out.t = path.times[i];
  out.frame = i;
  out.speed = speed;
  out.height = P[i * 3 + 1] - P[ref * 3 + 1];
  out.out = Math.hypot(P[i * 3] - P[ref * 3], P[i * 3 + 2] - P[ref * 3 + 2]);
  out.climb = speed > 0.5 ? THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(v.y / speed, -1, 1))) : 0;
  out.noseOff = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(cos, -1, 1)));
  out.turn = turn;
  out.accel = accel;
  return speed > tune.cinematicSpeed || accel > tune.cinematicAccel;
}

const blankMoment = (): RigMoment => ({ t: 0, frame: 0, speed: 0, height: 0, out: 0, climb: 0, noseOff: 0, turn: 0, accel: 0 });

/**
 * Where a take-off lets go of the hull: scanning from its start and stopping at the first frame the
 * clip goes cinematic, the **latest** frame high enough, fast enough to steer and no faster than
 * `topSpeed`, with the nose near its path, no spin and no lurch. That shows as much of the game's own
 * take-off as a hull can be flown out of. Null when no frame will do, and the caller keeps the old way.
 * The height is over the clip's first frame, which is where the take-off stands parked.
 */
export function takeoffCut(path: RigPath, topSpeed: number, tune = RIG_PATH_TUNE): RigMoment | null {
  const m = blankMoment();
  let best: RigMoment | null = null;
  for (let i = 0; i < path.frames; i++) {
    if (measure(path, i, 0, tune, m)) break;
    if (m.height >= tune.cutHeight && m.speed >= tune.cutSpeedMin && m.speed <= topSpeed && m.noseOff <= tune.cutNose && m.turn <= tune.cutTurn && m.accel <= tune.cutAccel) best = { ...m };
  }
  return best;
}

/**
 * Where a landing takes the hull back: scanning back from its end and stopping at the last frame the
 * clip is cinematic, the **earliest** frame after it high enough, fast enough and no faster than
 * `cruise`, with the nose near its path, no spin and no lurch, so a pilot arriving at a steady speed
 * can meet it and everything after it is flyable. Null when none will do. The height is over the
 * clip's last frame, where the landing stands parked.
 */
export function landingJoin(path: RigPath, cruise: number, tune = RIG_PATH_TUNE): RigMoment | null {
  const m = blankMoment();
  const end = path.frames - 1;
  let best: RigMoment | null = null;
  for (let i = end; i >= 0; i--) {
    if (measure(path, i, end, tune, m)) break;
    if (m.height >= tune.joinHeight && m.speed >= tune.joinSpeedMin && m.speed <= cruise && m.noseOff <= tune.joinNose && m.turn <= tune.joinTurn && m.accel <= tune.joinAccel) best = { ...m };
  }
  return best;
}

// ---------------------------------------------------------------- blends at the hand-overs

/**
 * A joint's turn with its nose brought `k` of the way round onto a path: `slerp(I, fromTo(nose, v̂), k) × jQuat`.
 * At 0 it is the clip's own turn and at 1 the nose points exactly along `vel`; between, it turns the
 * short way round and never back. `out` may be `jQuat`. Allocates nothing.
 */
export function noseOntoPath(jQuat: THREE.Quaternion, vel: THREE.Vector3, k: number, out: THREE.Quaternion): THREE.Quaternion {
  const speed = vel.length();
  if (!(speed > 1e-6) || k <= 0) return out.copy(jQuat);
  const nose = sA.copy(NOSE).applyQuaternion(jQuat);
  const dir = sB.copy(vel).divideScalar(speed);
  qA.setFromUnitVectors(nose, dir);
  qB.slerpQuaternions(IDENTITY, qA, Math.min(1, k));
  qC.copy(jQuat);
  return out.copy(qB).multiply(qC);
}

/**
 * A pose settling from where a flown hull was handed over onto a clip playing on from there: the
 * hand-over's difference from the clip's own pose at that moment (`from` against `base`), faded out
 * as `k` goes from 0 to 1 and laid over where the clip is now. `outP = now + (from − base)(1 − k)`,
 * `outQ = slerp(from × base⁻¹, I, k) × now`. At 0 it is `from`, at 1 the clip; with `k` eased from
 * nought (`settleEase`) the hull goes on at the clip's own speed from its first frame. Any out may be
 * any in. Allocates nothing.
 */
export function settleOnto(
  fromP: THREE.Vector3,
  fromQ: THREE.Quaternion,
  baseP: THREE.Vector3,
  baseQ: THREE.Quaternion,
  nowP: THREE.Vector3,
  nowQ: THREE.Quaternion,
  k: number,
  outP: THREE.Vector3,
  outQ: THREE.Quaternion,
): void {
  const keep = 1 - Math.min(1, Math.max(0, k));
  sA.copy(fromP).sub(baseP).multiplyScalar(keep);
  outP.copy(nowP).add(sA);
  qA.copy(baseQ).invert().premultiply(fromQ);
  qB.slerpQuaternions(qA, IDENTITY, 1 - keep);
  qC.copy(nowQ);
  outQ.copy(qB).multiply(qC);
}

/** How long a settle takes for a hand-over that far off the clip: `clamp(error / settleRate, settleMin, settleMax)`. */
export function settleSeconds(error: number, tune = RIG_PATH_TUNE): number {
  return Math.min(tune.settleMax, Math.max(tune.settleMin, error / tune.settleRate));
}

/** How far a pose is brought onto its path `seconds` before a cut, eased: 0 before `align`, 1 at the cut. */
export function alignShare(seconds: number, cut: number, tune = RIG_PATH_TUNE): number {
  return tune.align > 0 ? settleEase((seconds - (cut - tune.align)) / tune.align) : seconds >= cut ? 1 : 0;
}

/**
 * Where a hull flown to a pad is to meet its landing clip, in the world: the vehicle's pose at the join,
 * its velocity, speed, the bearing of its path over the ground (radians, `atan2(x, z)` as a heading is)
 * and its climb (radians, negative coming down), the clip's time there, and whether there is a join at all.
 */
export interface LandingTarget {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  speed: number;
  heading: number;
  climb: number;
  t: number;
  valid: boolean;
}

/** A landing target to be filled, made once by whoever keeps one. */
export function makeLandingTarget(): LandingTarget {
  return { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), speed: 0, heading: 0, climb: 0, t: 0, valid: false };
}

/**
 * The landing target of a pad for a hull whose landing clip is `path`, joined at `join`: the vehicle
 * pose there (`vehicleAt`) and the velocity that pose is moving at (`vehicleVelocity`), so a pilot that
 * meets it meets the clip at the clip's own speed. Invalid with no join. Allocates nothing.
 */
export function landingTarget(pad: Pad, path: RigPath, join: RigMoment | null, offset: THREE.Vector3, out: LandingTarget): LandingTarget {
  out.valid = !!join;
  if (!join) return out;
  out.t = join.t;
  vehicleAt(pad, path, join.t, offset, out.pos, out.quat);
  vehicleVelocity(pad, path, join.t, offset, out.vel);
  out.speed = out.vel.length();
  out.heading = Math.atan2(out.vel.x, out.vel.z);
  out.climb = out.speed > 1e-6 ? Math.asin(THREE.MathUtils.clamp(out.vel.y / out.speed, -1, 1)) : 0;
  return out;
}

/**
 * Whether somebody at `camPos` looking through `frustum` would see a thing of `radius` at `point`:
 * nearer than `near` it is seen whichever way the view faces, at `far` or past it it is a speck nobody
 * sees, and between the two it is seen when its sphere is in the view. What a held shuttle and a hull
 * flying off are both judged by. Allocates nothing.
 */
export function inSight(frustum: THREE.Frustum, camPos: THREE.Vector3, point: THREE.Vector3, radius: number, far: number, near: number): boolean {
  const d = point.distanceTo(camPos);
  if (d < near) return true;
  if (d >= far) return false;
  seenSphere.center.copy(point);
  seenSphere.radius = radius;
  return frustum.intersectsSphere(seenSphere);
}
