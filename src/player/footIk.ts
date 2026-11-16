// The feet placed on what is under them (wave 3 of the animations, the owner's brief's line 19: "inverse kinematics for
// both feet ... walking up stairs, steep surfaces, and being at a cliff edge should have feet angle appropriately and legs
// be at the right height to match whatever surface is beneath them").
//
// Once a frame, after the figure is posed by its clips and placed (`Player.update`'s end, `RemotePlayers.update`'s for
// another player's figure), for each foot:
//  - how planted the clip has it: by the foot's height over its own resting height in the clip (`ik.plantLow` to
//    `ik.plantHigh`), whole where the clip has it down and none while it swings, so a walk's swing is the clip's own; a
//    stair clip's planted foot climbs a tread a step in the clip (its height says nothing), so there it is by how fast the
//    ankle goes back under the body in the figure's own frame (`ik.stairBack` back, none by `ik.stairAhead` ahead);
//  - its ground: one ray down under the ankle (the heel) and one under the toe's tip, from over the body's head height
//    down past the sole, against what stands still only (the engine's own query flags: never another player, a
//    creature, a vehicle, a loose prop or a corpse);
//  - the foot turned to its slope (`ik.pitchMost`, `ik.rollMost`), or, where the toe is over air or on a step's other
//    side, left as its clip turns it and each of its points (heel, ball, toe's tip) set on its own ground (one more ray,
//    under the ball), its toe then bent toward its own ground (`ik.toeMost`); and lifted or lowered so its sole meets the
//    ground (the lower of its sole points on it, none under it);
//  - over nothing within reach: drawn in toward (and on past) the body's middle until it stands on the edge (`ik.edgePull` at most),
//    else left where the clip has it.
// Then the pelvis is lowered by as much as the lower foot needs (`ik.pelvisMost` at most under the capsule's own feet, so a drawn body the stairs' ease holds over the capsule comes back down to it too; never raised above where the
// clip has it: the drawn figure's root, `rig.root`, so the whole body goes down and the higher foot's leg bends), and
// each leg is bent by the two-bone solve (src/anim/twoBone.ts, its knee on the clip's own side and in the clip's own
// plane) so its ankle stands where its sole meets the ground; a foot not planted keeps the clip's own leg, carried down
// with the pelvis. Everything is eased over `ik.ease` so nothing pops: the placement in and out, each foot's own share
// (in, and a stair clip's out), and a sudden change of what a planted foot stands on (a riser's edge crossed under it, an
// edge pull, a turn to a new slope), which is held back and let in (what the clip itself moves the foot by is followed
// as it stands, `FOLLOW_*`); the pelvis goes down with the eased need and comes back up over the ease.
//
// The legs' bones are turned after the mixer, and the mixer writes a joint only when its clip's value moved since the
// last frame (wave 1's lesson): so the clean pose the clip left is kept and put back on the bones before the mixer runs
// again (`restore`, which the rig calls at the top of its update).
//
// Rays are cast only where a foot is placed and its place on the ground moved (or the world's colliders changed), and
// each slot keeps its last `KEPT` answers: a figure standing still, its idle swaying its feet over a few places, and a
// walking figure's planted foot, cast nothing once each place has been asked. Each ray's answer is the engine's own
// object (about 900 bytes); nothing else is made on a frame.

import * as THREE from 'three';
import type { RAPIER } from '../core/physics.ts';
import { TwoBoneAsk, TwoBoneOut, solveTwoBone } from '../anim/twoBone.ts';
import type { LocoTune } from '../anim/locoTune.ts';
import { restWorld as restPlaces, type TargetSkeleton } from '../anim/fit.ts';
import { TurnAsk, setBoneWorld, turnBetweenIn, turnBone } from './limbIk.ts';
import { STILL_FLAGS } from './stairSense.ts';

/** The little of a physics world the feet ask (rapier's `World`). */
export interface FootWorld {
  castRayAndGetNormal(ray: RAPIER.Ray, maxToi: number, solid: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): RAPIER.RayColliderIntersection | null;
  colliders: { len(): number };
}

/** The little of a rig the feet ask: its root and its bones by name, and the hook its update calls before the mixer. */
export interface FootRig {
  readonly root: THREE.Object3D;
  boneNamed(name: string): THREE.Bone | null;
  restSkeleton(): TargetSkeleton;
  legPose: { restore(): void } | null;
}

/** A ray's maker, handed in once (the engine's `Ray`), so this file needs no engine of its own to load under node's tests. */
export type RayMaker = () => RAPIER.Ray;

/** A frame of the figure as the feet need it, written by the caller before `step` (fields, so no number crosses a call). */
export class FootIn {
  dt = 0.5;
  /** The feet are placed this frame: on its feet on the ground (the caller's rule). */
  on = false;
  /** The legs play a stair clip (planted by speed). */
  stairClip = false;
  /** The capsule's feet, in the physics frame. */
  px = 0.5;
  py = 0.5;
  pz = 0.5;
  /** The figure's heading in the physics frame, radians (its front is (sin h, 0, cos h)). */
  heading = 0.5;
  /** The move's own collision groups. */
  filter = 0.5;
}

/** One ray's kept answer: where it was cast from, and what it met. */
class Probe {
  x = Number.NaN;
  z = Number.NaN;
  start = Number.NaN;
  len = Number.NaN;
  hit = false;
  y = 0.5;
  nx = 0.5;
  ny = 0.5;
  nz = 0.5;
}

/** How far the drawn figure is from being on the ground below which a ray looks, metres: down past the sole by the pelvis's reach and this. */
const PROBE_UNDER = 0.15;
/** How far over the drawn figure's ground (or the capsule's feet, the higher) the rays start, metres: over the most a foot is lifted. */
const PROBE_OVER = 0.8;
/**
 * The most a foot is lifted to its ground, metres: a riser over the drawn body's most lag (the autostep's 0.5 and a
 * quarter). Ground higher than that under a foot is no step it stands on (the top of a crate a stride ahead): the foot
 * keeps the clip's place there.
 */
export const LIFT_MOST = 0.75;
/**
 * A foot's place on the ground moved by less than this is the same place (no ray), metres: half the placement's own
 * centimetre, so a planted foot the clip lets creep a few millimetres a frame is read back, not cast again.
 */
const SAME_PLACE = 0.005;
/**
 * How many answers each probe slot keeps: a standing figure's idle sways its feet back and forth over a few places a
 * centimetre or two apart, so with this many kept it reads every one back after its first sway and casts nothing more.
 */
const KEPT = 4;
/** How far apart the edge pull's rays stand, metres. */
const PULL_STEP = 0.05;
/** The most rays one foot's edge pull casts. */
const PULL_MOST = 10;
/**
 * Past the body's middle the edge pull takes only the ground the capsule itself stands on, within this, metres: a capsule
 * resting with its middle on a cliff's edge has its own ground just beyond it, while mid-climb a lower tread just beyond
 * the middle is one the leg cannot reach by straightening.
 */
const EDGE_LEVEL = 0.05;
/** The toe's ground counts as on the heel's plane within this, metres (a stair's tread is level within 0.03). */
const ON_PLANE = 0.03;

const DEG = Math.PI / 180;

/** One leg's bones, its rest numbers and its frame's answers. (Declared as fractions where they hold one.) */
class Leg {
  thigh: THREE.Bone;
  shin: THREE.Bone;
  ankle: THREE.Bone;
  toe: THREE.Bone | null;
  /** The sole's two points in the ankle's own frame: under the ankle (the heel) and under the toe's joint (the ball), unscaled. */
  readonly heel = new THREE.Vector3();
  readonly ball = new THREE.Vector3();
  /** The toe's tip in the toe's own frame (as far ahead of its joint as half the foot), unscaled; and the toe's own height. */
  readonly tip = new THREE.Vector3();
  /** The ankle's height over the sole at rest, unscaled; the foot's length heel to toe tip and the toe's own, unscaled. */
  ankleH = 0.5;
  footLen = 0.5;
  toeLen = 0.5;
  // Clean local turns, for `restore`.
  readonly thighQ = new THREE.Quaternion();
  readonly shinQ = new THREE.Quaternion();
  readonly ankleQ = new THREE.Quaternion();
  readonly toeQ = new THREE.Quaternion();
  // The frame's own answers, before the foot's ease: the clip's planted share, and what the probes found (`grounded`)
  // and made of it.
  clip = 0.5;
  lift = 0.5;
  pull = 0.5;
  pullX = 0.5;
  pullZ = 0.5;
  grounded = false;
  pitch = 0.5;
  roll = 0.5;
  toeBend = 0.5;
  // What the leg is bent by: the share it is planted by (`planted`, taken from the ramp `shareE`, `ik.ease` from none to
  // whole), and its placement (`app`: the lift, the pull's x and z, the pitch, the roll and the toe's bend), followed from
  // this frame's own answers (`raw`) through `off`, the part of a sudden change (a riser's edge crossed under the foot)
  // not yet let in, eased out over `ik.ease`; `prev` the last frame's raw, and whether it stands (`had`).
  planted = 0.5;
  shareE = 0.5;
  readonly raw = new Float64Array(6);
  readonly prev = new Float64Array(6);
  readonly off = new Float64Array(6);
  readonly app = new Float64Array(6);
  had = false;
  /** The clip's own sole points last frame the foot stood on its ground or eased out off it, untouched by the placement (the heel's x, y, z, the ball's y, the toe tip's y; NaN for none). */
  readonly sole = Float64Array.of(Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN);
  /** What of a change is the clip's own since last frame: the lift's allowance and the pull's (metres), and the seconds gone. */
  readonly acc = new Float64Array(3);
  /** The ankle's target height in the physics frame when the foot last stood on its ground (kept while it eases out). */
  ty = Number.NaN;
  /** How steep the ground under the heel was when it last stood, its rise a metre across. */
  slope = 0.5;
  /** The ankle's last place over the ground (the physics frame), for the stair clips' planted measure. */
  lastX = Number.NaN;
  lastZ = Number.NaN;
  /** Each probe slot's answer this frame (read by the step), and the answers each slot has kept (`KEPT` a slot, the oldest given up). */
  readonly probes: Probe[] = [];
  readonly kept: Probe[] = [];
  readonly next: Int32Array;
  constructor(thigh: THREE.Bone, shin: THREE.Bone, ankle: THREE.Bone, toe: THREE.Bone | null) {
    this.thigh = thigh;
    this.shin = shin;
    this.ankle = ankle;
    this.toe = toe;
    for (let i = 0; i < 4 + PULL_MOST; i++) this.probes.push(new Probe());
    for (let i = 0; i < (4 + PULL_MOST) * KEPT; i++) this.kept.push(new Probe());
    this.next = new Int32Array(4 + PULL_MOST);
    this.clip = 0;
    this.lift = 0;
    this.pull = 0;
    this.pullX = 0;
    this.pullZ = 0;
    this.pitch = 0;
    this.roll = 0;
    this.toeBend = 0;
    letGo(this);
  }
}

/** A leg's eased placement let go: unplanted, its ground forgotten (written in place: nothing is made). */
function letGo(leg: Leg): void {
  leg.planted = 0;
  leg.shareE = 0;
  leg.had = false;
  for (let i = 0; i < 5; i++) leg.sole[i] = Number.NaN;
  for (let i = 0; i < 3; i++) leg.acc[i] = 0;
  leg.ty = Number.NaN;
  leg.slope = 0;
  for (let i = 0; i < 6; i++) {
    leg.raw[i] = 0;
    leg.prev[i] = 0;
    leg.off[i] = 0;
    leg.app[i] = 0;
  }
}

/**
 * What of a frame's change of a leg's placement is the clip's own and followed as it stands, and what is the ground
 * jumping under the foot (a riser's edge crossed, an edge pull taken, a toe come over a step's nose) and let in over
 * `ik.ease`. The lift may change by as much as the clip itself moved the foot's sole points up or down (a heel rolling up
 * off the ground at toe-off, a stair clip's foot climbing its tread, the drawn body easing over a step, a clip's own seam),
 * and by as much again as the ground's own slope under the heel gives over how far the heel went across it (the steeper
 * of where it stood and where it stands, held to `SLOPE_FOLLOW`, about 60 degrees; nothing on level ground, so a heel
 * sliding fast over a step's edge is still a jump), and `FOLLOW_SLACK` more; the pull by how far the heel went across and the slack; the pitch and roll (the
 * ground's own turn) by `FOLLOW_TURN` a second, and the toe's bend (the clip's toe and the ground) by `FOLLOW_TOE` a
 * second; each over the frame since the foot last stood or eased out. Not feel: the line between what the clip does and
 * what the world does.
 */
const SLOPE_FOLLOW = 1.8;
const FOLLOW_SLACK = 0.005;
const FOLLOW_TURN = 2;
const FOLLOW_TOE = 10;

// Scratch: kept, written in place.
const m4 = new THREE.Matrix4();
const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const pC = new THREE.Vector3();
const pT = new THREE.Vector3();
const qP = new THREE.Quaternion();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();
const qT = new THREE.Quaternion();
const qTilt = new THREE.Quaternion();
const qD1 = new THREE.Quaternion();
const qD2 = new THREE.Quaternion();
const qW = new THREE.Quaternion();
const qX = new THREE.Quaternion();
const sv = new THREE.Vector3();
const vH = new THREE.Vector3();
const vB = new THREE.Vector3();
const vTip = new THREE.Vector3();
const vAxis = new THREE.Vector3();
const vScale = new THREE.Vector3();
const tipV = new THREE.Vector3();
const jointV = new THREE.Vector3();
const cH = new THREE.Vector3();
const cB = new THREE.Vector3();
const cT = new THREE.Vector3();
const cTq = new THREE.Quaternion();
const TA = new TurnAsk();
/**
 * A turn's four numbers on their way into a quaternion: three's `set` takes them as numbers across a call, and in a
 * method this long the later calls are not built in, so a number handed to one is made (as `scale` is multiplied out
 * by hand below, never handed to `multiplyScalar`).
 */
const QB = new Float64Array(4);

/** Where a bone stands and how it is turned, in the physics frame (`toPhys` null: the world's). */
function boneIn(bone: THREE.Object3D, toPhys: THREE.Matrix4 | null, p: THREE.Vector3, q: THREE.Quaternion): void {
  if (toPhys) m4.multiplyMatrices(toPhys, bone.matrixWorld);
  else m4.copy(bone.matrixWorld);
  m4.decompose(p, q, vScale);
}

export class FootIk {
  /** The frame's knobs, kept by the caller's tune (the player's `LOCO_TUNE.ik`). */
  private readonly tune: LocoTune['ik'];
  private readonly makeRay: RayMaker;
  private ray: RAPIER.Ray | null = null;
  private legs: Leg[] | null = null;
  private rig: FootRig | null = null;
  /** The skeleton has no legs this can bend (no thigh, shin and ankle each side): nothing is ever placed. */
  private none = false;
  private world: FootWorld | null = null;
  private count = -1;
  /** How much of the placement is in (eased), and the pelvis's drop, metres. (Declared as fractions.) */
  weight = 0.5;
  drop = 0.5;
  /** One ray's ask (`probe`'s): where, from how high and how far. Fields, so no number crosses a call. (Fractions.) */
  private qx = 0.5;
  private qz = 0.5;
  private qs = 0.5;
  private ql = 0.5;
  /** The drop last put on the rig's root, for `undrop` (another player's figure, whose root nobody else writes each frame). */
  private applied = 0.5;
  /**
   * The pelvis's most, eased over `ik.ease` (NaN: taken outright next frame): the most is measured under the capsule's
   * feet, which the autostep and the snap move a riser in one step, so taken as it stands it would let the drop go a riser
   * further in one frame.
   */
  private mostE = Number.NaN;
  /** The figure's scale last frame (the report's, to put the feet's lengths in metres). */
  private scaleNow = 0.5;
  /** The bones were turned this frame (so `restore` has something to put back). */
  private written = false;
  /** Rays cast, and rays read back with none (the console's and the tests'). */
  casts = 0;
  reused = 0;
  readonly ask = new TwoBoneAsk();
  readonly out = new TwoBoneOut();
  readonly in = new FootIn();

  constructor(tune: LocoTune['ik'], makeRay: RayMaker) {
    this.tune = tune;
    this.makeRay = makeRay;
    this.weight = 0;
    this.drop = 0;
    this.applied = 0;
  }

  /** The legs of a rig, found once a rig (the rig's `legPose` hook set to this). */
  private legsOf(rig: FootRig): Leg[] | null {
    return rig === this.rig ? this.legs : this.buildLegs(rig);
  }

  /** The legs of a new rig (a method of its own: its closure's context would otherwise be made on every call of `legsOf`). */
  private buildLegs(rig: FootRig): Leg[] | null {
    if (this.rig && this.rig.legPose === this) this.rig.legPose = null;
    this.rig = rig;
    this.legs = null;
    this.none = false;
    this.written = false;
    const out: Leg[] = [];
    const skel = rig.restSkeleton();
    const rest = restPlaces(skel);
    const at = (n: string) => skel.joints.findIndex((j) => j.name === n);
    for (const s of ['l', 'r']) {
      const thigh = rig.boneNamed(`${s}Thigh`);
      const shin = rig.boneNamed(`${s}Shin`);
      const ankle = rig.boneNamed(`${s}Ankle`);
      const toe = rig.boneNamed(`${s}Toe`);
      const ia = at(`${s}Ankle`);
      if (!thigh || !shin || !ankle || shin.parent !== thigh || ankle.parent !== shin || ia < 0) {
        this.none = true;
        return null;
      }
      const leg = new Leg(thigh, shin, ankle, toe && toe.parent === ankle ? toe : null);
      // The sole at rest: the ground (y = 0 in the rig's own frame) under the ankle and under the toe's joint, taken into
      // the ankle's own frame by its rest turn.
      const ax = rest.p[ia * 3], ay = rest.p[ia * 3 + 1], az = rest.p[ia * 3 + 2];
      qX.set(rest.q[ia * 4], rest.q[ia * 4 + 1], rest.q[ia * 4 + 2], rest.q[ia * 4 + 3]).invert();
      leg.ankleH = ay;
      leg.heel.set(0, -ay, 0).applyQuaternion(qX);
      const it = leg.toe ? at(`${s}Toe`) : -1;
      if (it >= 0) {
        const tx = rest.p[it * 3], ty = rest.p[it * 3 + 1], tz = rest.p[it * 3 + 2];
        leg.ball.set(tx - ax, -ay, tz - az).applyQuaternion(qX);
        // The toe's tip: half the foot's length again ahead of the toe's joint, at the sole, in the toe's own frame.
        const fx = tx - ax, fz = tz - az;
        qT.set(rest.q[it * 4], rest.q[it * 4 + 1], rest.q[it * 4 + 2], rest.q[it * 4 + 3]).invert();
        leg.tip.set(fx * 0.5, -ty, fz * 0.5).applyQuaternion(qT);
        leg.toeLen = Math.sqrt(fx * fx + fz * fz) * 0.5;
        leg.footLen = leg.toeLen * 3;
      } else {
        leg.ball.copy(leg.heel);
        leg.toeLen = 0;
        leg.footLen = 0;
      }
      out.push(leg);
    }
    this.legs = out;
    rig.legPose = this;
    return out;
  }

  /** The legs' clean pose back on the bones (the rig calls this at the top of its update, before the mixer). */
  restore(): void {
    if (!this.written || !this.legs) return;
    for (const leg of this.legs) {
      leg.thigh.quaternion.copy(leg.thighQ);
      leg.shin.quaternion.copy(leg.shinQ);
      leg.ankle.quaternion.copy(leg.ankleQ);
      if (leg.toe) leg.toe.quaternion.copy(leg.toeQ);
    }
    this.written = false;
  }

  /** Take the drop last put on the rig's root back off it (another player's figure, before anything writes its root this frame). */
  undrop(rig: FootRig): void {
    if (this.applied !== 0 && rig === this.rig) rig.root.position.y += this.applied;
    this.applied = 0;
  }

  /** Let go of everything eased: the body stood somewhere new. */
  reset(): void {
    this.weight = 0;
    this.drop = 0;
    this.mostE = Number.NaN;
    if (this.legs) for (const leg of this.legs) {
      leg.lastX = Number.NaN;
      leg.lastZ = Number.NaN;
      letGo(leg);
    }
  }

  /** One ray down at (x, z) from `start` for `len`, or a kept answer: into the leg's probe `slot`. True where it met ground. */
  private probe(world: FootWorld, leg: Leg, slot: number): boolean {
    const x = this.qx;
    const z = this.qz;
    const start = this.qs;
    const len = this.ql;
    const a = leg.probes[slot];
    const base = slot * KEPT;
    for (let k = 0; k < KEPT; k++) {
      const q = leg.kept[base + k];
      const dx = x - q.x;
      const dz = z - q.z;
      // The same place: a kept answer stands while the new ray's reach holds it (ground within it, or nothing in a reach no longer than the old).
      if (dx <= SAME_PLACE && dx >= -SAME_PLACE && dz <= SAME_PLACE && dz >= -SAME_PLACE && (q.hit ? q.y <= start && q.y >= start - len : start <= q.start && start - len >= q.start - q.len)) {
        this.reused++;
        a.x = q.x;
        a.z = q.z;
        a.start = q.start;
        a.len = q.len;
        a.hit = q.hit;
        a.y = q.y;
        a.nx = q.nx;
        a.ny = q.ny;
        a.nz = q.nz;
        return a.hit;
      }
    }
    const k = leg.next[slot];
    leg.next[slot] = k + 1 === KEPT ? 0 : k + 1;
    const p = leg.kept[base + k];
    let ray = this.ray;
    if (!ray) ray = this.ray = this.makeRay();
    ray.origin.x = x;
    ray.origin.y = start;
    ray.origin.z = z;
    ray.dir.x = 0;
    ray.dir.y = -1;
    ray.dir.z = 0;
    this.casts++;
    const h = world.castRayAndGetNormal(ray, len, true, STILL_FLAGS, this.in.filter);
    p.x = x;
    p.z = z;
    p.start = start;
    p.len = len;
    if (h) {
      p.hit = true;
      p.y = start - h.timeOfImpact;
      p.nx = h.normal.x;
      p.ny = h.normal.y;
      p.nz = h.normal.z;
    } else p.hit = false;
    a.x = p.x;
    a.z = p.z;
    a.start = p.start;
    a.len = p.len;
    a.hit = p.hit;
    a.y = p.y;
    a.nx = p.nx;
    a.ny = p.ny;
    a.nz = p.nz;
    return a.hit;
  }

  /**
   * One frame: the figure posed and placed (its world matrices fresh), `in` written. `toPhys` takes the world into the
   * physics frame the rays are cast in (a ship's rooms'), null for the world's own. The rig's root's height is read as the
   * drawn figure's ground (the stairs' lag, the swim's sink) and the drop goes on it.
   */
  step(rig: FootRig, world: FootWorld | null, toPhys: THREE.Matrix4 | null): void {
    const f = this.in;
    const tune = this.tune;
    const legs = this.legsOf(rig);
    const want = f.on && tune.rule === 'placed' && legs !== null && world !== null ? 1 : 0;
    const ease = tune.ease;
    const k = ease > 0 ? 1 - Math.exp(-f.dt / ease) : 1;
    this.weight += (want - this.weight) * k;
    if (want === 0 && this.weight < 1e-3) this.weight = 0;
    if (!legs || !world || (this.weight === 0 && this.drop === 0)) {
      this.drop = 0;
      this.mostE = Number.NaN;
      if (legs) for (const leg of legs) {
        leg.clip = 0;
        leg.lift = 0;
        leg.pull = 0;
        leg.grounded = false;
        leg.lastX = Number.NaN;
        letGo(leg);
      }
      return;
    }
    // The world's colliders came or went: every kept ray is cast again.
    const n = world.colliders.len();
    if (world !== this.world || n !== this.count) {
      this.world = world;
      this.count = n;
      for (const leg of legs) for (const p of leg.kept) p.x = Number.NaN;
    }
    const W = this.weight;
    // The figure's front, and the line across it (`rx`, `rz`: its left hand's side), in the physics frame.
    const fx = Math.sin(f.heading);
    const fz = Math.cos(f.heading);
    const rx = fz;
    const rz = -fx;
    // The drawn figure's ground: the rig's root, where its clips stand the feet.
    boneIn(rig.root, toPhys, pA, qP);
    const groundClip = pA.y;
    const scale = vScale.y;
    this.scaleNow = scale;
    const top = (f.py > groundClip ? f.py : groundClip) + PROBE_OVER;
    // The most the pelvis goes down: `pelvisMost` under the capsule's own feet, so a drawn body the stairs' ease holds
    // over the capsule (going down a flight) may come back down to it as well (src/anim/drawnHeight.ts).
    const over = groundClip - f.py;
    const most = tune.pelvisMost + (over > 0 ? over : 0);
    const reach = top - (groundClip - most - PROBE_UNDER);
    let need = 0;
    // Each foot's own ease (`ik.ease`): its share moves at most `rate` a frame (none to whole in `ease`), and the part of a
    // sudden change of its placement it has not yet let in decays by `decay` a frame.
    const rate = ease > 0 ? f.dt / ease : 2;
    const decay = 1 - k;
    for (let s = 0; s < legs.length; s++) {
      const leg = legs[s];
      boneIn(leg.ankle, toPhys, pC, qC);
      // How planted the clip has it: by its height over its resting height; a stair clip's by how its ankle goes along
      // the figure's front under the body (back in stance, ahead in the swing), in the figure's own frame.
      const along = (pC.x - pA.x) * fx + (pC.z - pA.z) * fz;
      let want = 0;
      if (f.stairClip) {
        const v = leg.lastX === leg.lastX && f.dt > 0 ? (along - leg.lastX) / f.dt : 0;
        const lo = -tune.stairBack;
        const hi = tune.stairAhead;
        const u = hi > lo ? (v - lo) / (hi - lo) : v >= hi ? 1 : 0;
        want = u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
      } else {
        const h = pC.y - groundClip - leg.ankleH * scale;
        const lo = tune.plantLow;
        const hi = tune.plantHigh;
        const u = hi > lo ? (h - lo) / (hi - lo) : h >= hi ? 1 : 0;
        want = u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
      }
      leg.clip = want;
      leg.lastX = along;
      // The clip's own sole points (heel, ball, the toe's tip), as the clip and the drawn body put them this frame.
      cH.x = leg.heel.x * scale;
      cH.y = leg.heel.y * scale;
      cH.z = leg.heel.z * scale;
      cH.applyQuaternion(qC).add(pC);
      cB.x = leg.ball.x * scale;
      cB.y = leg.ball.y * scale;
      cB.z = leg.ball.z * scale;
      cB.applyQuaternion(qC).add(pC);
      let tipY = cB.y;
      if (leg.toe) {
        boneIn(leg.toe, toPhys, cT, cTq);
        sv.x = leg.tip.x * scale;
        sv.y = leg.tip.y * scale;
        sv.z = leg.tip.z * scale;
        sv.applyQuaternion(cTq).add(cT);
        tipY = sv.y;
      }
      leg.pull = 0;
      leg.pullX = 0;
      leg.pullZ = 0;
      leg.lift = 0;
      leg.pitch = 0;
      leg.roll = 0;
      leg.toeBend = 0;
      leg.grounded = false;
      let slopeTan = 0;
      probe: if (want > 0) {
      // The heel's ground (under the heel as the clip turns the foot: on a step's edge the ankle and the heel can stand
      // either side of it), else the edge's: drawn in toward the body's middle a step at a time.
      vH.x = leg.heel.x * scale;
      vH.y = leg.heel.y * scale;
      vH.z = leg.heel.z * scale;
      vH.applyQuaternion(qC).add(pC);
      const hx = vH.x;
      const hz = vH.z;
      let gx = hx;
      let gz = hz;
      let slot = 0;
      this.qx = gx;
      this.qz = gz;
      this.qs = top;
      this.ql = reach;
      let found = this.probe(world, leg, 0);
      if (!found) {
        let ix = f.px - hx;
        let iz = f.pz - hz;
        const il = Math.sqrt(ix * ix + iz * iz);
        if (il > 1e-6) {
          ix /= il;
          iz /= il;
          const most = Math.min(PULL_MOST, Math.floor(tune.edgePull / PULL_STEP + 1e-9));
          for (let i = 1; i <= most && !found; i++) {
            // On past the body's middle where it must (a capsule comes to rest with its middle on the very edge, and a ray
            // there meets nothing), but past it only onto the capsule's own ground (`EDGE_LEVEL`).
            const d = i * PULL_STEP;
            slot = 3 + i;
            this.qx = hx + ix * d;
            this.qz = hz + iz * d;
            if (this.probe(world, leg, slot) && (d <= il || Math.abs(leg.probes[slot].y - f.py) <= EDGE_LEVEL)) {
              found = true;
              gx = hx + ix * d;
              gz = hz + iz * d;
              leg.pull = d;
              leg.pullX = gx - hx;
              leg.pullZ = gz - hz;
            }
          }
        }
      }
      if (!found) {
        // Nothing within reach: the clip's place (the leg as the clip has it, carried with the pelvis), never reached down.
        want = 0;
        break probe;
      }
      leg.grounded = true;
      const hp = leg.probes[slot];
      const gH = hp.y;
      let nx = hp.nx;
      let ny = hp.ny;
      let nz = hp.nz;
      if (!(ny > 0.05)) {
        nx = 0;
        ny = 1;
        nz = 0;
      }
      // How steep the ground under the heel is (its rise a metre across), for what of a change is the slope's own.
      slopeTan = Math.sqrt(nx * nx + nz * nz) / ny;
      // The toe's tip and its ground: on the heel's plane (turn the foot to it), else a step's other side or air (level).
      let onPlane = !leg.toe;
      let gT = Number.NaN;
      if (leg.toe) {
        boneIn(leg.toe, toPhys, pT, qT);
        vTip.x = leg.tip.x * scale;
        vTip.y = leg.tip.y * scale;
        vTip.z = leg.tip.z * scale;
        vTip.applyQuaternion(qT).add(pT);
        const tx = vTip.x + leg.pullX;
        const tz = vTip.z + leg.pullZ;
        this.qx = tx;
        this.qz = tz;
        if (this.probe(world, leg, 1)) {
          gT = leg.probes[1].y;
          const plane = gH - (nx * (tx - gx) + nz * (tz - gz)) / ny;
          onPlane = gT - plane <= ON_PLANE && gT - plane >= -ON_PLANE;
        }
      }
      // The turn to the slope: pitch about the figure's right, roll about its front, each held to its dial.
      if (onPlane) {
        const nf = nx * fx + nz * fz;
        const nr = nx * rx + nz * rz;
        const pm = tune.pitchMost * DEG;
        const rm = tune.rollMost * DEG;
        let pitch = Math.atan2(nf, ny);
        let roll = Math.atan2(nr, ny);
        if (pitch > pm) pitch = pm;
        else if (pitch < -pm) pitch = -pm;
        if (roll > rm) roll = rm;
        else if (roll < -rm) roll = -rm;
        leg.pitch = pitch;
        leg.roll = roll;
        const tp = Math.tan(pitch);
        const tr = Math.tan(roll);
        TA.fx = 0;
        TA.fy = 1;
        TA.fz = 0;
        TA.tx = rx * tr + fx * tp;
        TA.ty = 1;
        TA.tz = rz * tr + fz * tp;
        turnBetweenIn(qTilt, TA);
      } else qTilt.set(0, 0, 0, 1);
      // The sole's points with the foot so turned (about its ankle), and how far the foot must go up for the highest of
      // their grounds to meet its point, none left under its own. On the plane: the plane under each. Off it (a step's
      // edge under the foot): each on its own ground: the heel's, the ball's (a riser under the ball: the foot stands on
      // the upper tread, its heel over the lower). And the toe's tip, on either, less what its bend can lift it
      // (`toeMost`): a slope steeper than `pitchMost` under it, or the next riser.
      qW.copy(qTilt).multiply(qC);
      vH.x = leg.heel.x * scale;
      vH.y = leg.heel.y * scale;
      vH.z = leg.heel.z * scale;
      vH.applyQuaternion(qW).add(pC);
      vB.x = leg.ball.x * scale;
      vB.y = leg.ball.y * scale;
      vB.z = leg.ball.z * scale;
      vB.applyQuaternion(qW).add(pC);
      let lift = gH - (nx * (vH.x + leg.pullX - gx) + nz * (vH.z + leg.pullZ - gz)) / ny - vH.y;
      let tipGround = Number.NaN;
      let tipY0 = 0;
      let reachT = 1e-6;
      if (onPlane) {
        const lb = gH - (nx * (vB.x + leg.pullX - gx) + nz * (vB.z + leg.pullZ - gz)) / ny - vB.y;
        if (lb > lift) lift = lb;
        if (leg.toe) {
          // The tip and the toe's joint turned with the foot about the ankle.
          sv.copy(vTip).sub(pC).applyQuaternion(qTilt).add(pC);
          pB.copy(pT).sub(pC).applyQuaternion(qTilt).add(pC);
          tipGround = gH - (nx * (sv.x + leg.pullX - gx) + nz * (sv.z + leg.pullZ - gz)) / ny;
          tipY0 = sv.y;
          reachT = Math.sqrt((sv.x - pB.x) * (sv.x - pB.x) + (sv.z - pB.z) * (sv.z - pB.z)) + 1e-6;
          tipV.copy(sv);
          jointV.copy(pB);
        }
      } else {
        lift = gH - vH.y;
        this.qx = vB.x + leg.pullX;
        this.qz = vB.z + leg.pullZ;
        if (this.probe(world, leg, 2)) {
          const lb = leg.probes[2].y - vB.y;
          if (lb > lift) lift = lb;
        }
        if (leg.toe && gT === gT) {
          tipGround = gT;
          tipY0 = vTip.y;
          reachT = Math.sqrt((vTip.x - pT.x) * (vTip.x - pT.x) + (vTip.z - pT.z) * (vTip.z - pT.z)) + 1e-6;
          tipV.copy(vTip);
          jointV.copy(pT);
        }
      }
      const tm = tune.toeMost * DEG;
      if (tipGround === tipGround) {
        const lt = tipGround - tipY0 - reachT * Math.tan(tm);
        if (lt > lift) lift = lt;
      }
      // The toe bent toward its own ground (up onto a riser, up out of a slope; never down over a step's edge: a toe turns
      // about its own joint, so bent down toward the tread below its tip it swings back over the edge and into the step's
      // nose, and over an edge it is laid level with the tread it hangs from): the turn about its joint, across the
      // figure, that brings its tip to that height, held to `toeMost`. A toe the clip points down swings its tip forward
      // as it bends up; where that carries the tip over higher ground (the next riser), it is not bent and the foot is
      // lifted by what the tip lacks instead, so no tip is ever bent into a step.
      let bend = 0;
      if (tipGround === tipGround) {
        const aim = !onPlane && tipGround < gH ? gH : tipGround;
        const ta = (tipV.x - jointV.x) * fx + (tipV.z - jointV.z) * fz;
        const tv = tipV.y - jointV.y;
        const len = Math.sqrt(ta * ta + tv * tv);
        if (len > 1e-6) {
          let want = (aim - (jointV.y + lift)) / len;
          if (want > 1) want = 1;
          else if (want < -1) want = -1;
          const was = Math.atan2(tv, ta);
          bend = Math.asin(want) - was;
          if (onPlane && bend < 0) bend = 0;
          if (bend > tm) bend = tm;
          else if (bend < -tm) bend = -tm;
          if (bend > 0) {
            const ahead = len * Math.cos(was + bend) - ta;
            if (ahead > 1e-3) {
              this.qx = tipV.x + fx * ahead + leg.pullX;
              this.qz = tipV.z + fz * ahead + leg.pullZ;
              if (this.probe(world, leg, 3) && leg.probes[3].y > aim + ON_PLANE) {
                bend = 0;
                const short = aim - (tipY0 + lift);
                if (short > 0) lift += short;
              }
            }
          }
        }
      }
      if (lift > LIFT_MOST) {
        // No step a foot stands on: the clip's place.
        want = 0;
        leg.grounded = false;
        leg.pitch = 0;
        leg.roll = 0;
        leg.pull = 0;
        leg.pullX = 0;
        leg.pullZ = 0;
        break probe;
      }
      leg.lift = lift;
      leg.toeBend = bend;
      }
      // The foot's own ease. Its share: toward what the clip and the probes say at `rate` a frame; a flat clip's own fall
      // is taken as the clip has it (its height band is smooth), so a walk's foot leaves the ground as its clip lifts it.
      const wantAll = leg.grounded ? want : 0;
      const sp = leg.planted;
      if (leg.shareE < wantAll) {
        leg.shareE += rate;
        if (leg.shareE > wantAll) leg.shareE = wantAll;
      } else if (leg.shareE > wantAll) {
        leg.shareE -= rate;
        if (leg.shareE < wantAll) leg.shareE = wantAll;
      }
      leg.planted = f.stairClip || leg.shareE < leg.clip ? leg.shareE : leg.clip;
      // Its placement: this frame's own answers followed as they stand as far as they change by what the clip itself moved
      // the foot since last frame (`FOLLOW_*`); what changes beyond that (the ground jumping under the foot) is held back
      // and let in over the ease. A foot come fresh to the ground (no share yet) takes its answers whole, its share ramping
      // it in; a foot easing out off the ground keeps its ankle's height in the world and the rest of what it had.
      const raw = leg.raw;
      const prev = leg.prev;
      const off = leg.off;
      const app = leg.app;
      const so = leg.sole;
      const acc = leg.acc;
      acc[2] += f.dt;
      if (leg.grounded) {
        if (so[0] === so[0]) {
          // What the clip has moved the sole's points since last frame (the foot stood, or eased out off its ground, then;
          // a foot wholly off it last frame comes back fresh): up or down, and across.
          const a0 = cH.y - so[1];
          const a1 = cB.y - so[3];
          const a2 = tipY - so[4];
          let dp = a0 < 0 ? -a0 : a0;
          if (a1 > dp) dp = a1;
          else if (-a1 > dp) dp = -a1;
          if (a2 > dp) dp = a2;
          else if (-a2 > dp) dp = -a2;
          const hx = cH.x - so[0];
          const hz = cH.z - so[2];
          const dxz = Math.sqrt(hx * hx + hz * hz);
          // Across a slope the ground under the heel rises or falls as the heel goes over it: by the steeper of where it
          // stood and where it stands (never past `SLOPE_FOLLOW`), and on level ground not at all, so a step's edge crossed
          // by a heel sliding fast is still a jump.
          let st = slopeTan > leg.slope ? slopeTan : leg.slope;
          if (st > SLOPE_FOLLOW) st = SLOPE_FOLLOW;
          acc[0] = dp + dxz * st;
          acc[1] = dxz;
        }
        leg.slope = slopeTan;
        raw[0] = leg.lift;
        raw[1] = leg.pullX;
        raw[2] = leg.pullZ;
        raw[3] = leg.pitch;
        raw[4] = leg.roll;
        raw[5] = leg.toeBend;
        if (!leg.had || sp <= 0 || so[0] !== so[0]) {
          for (let i = 0; i < 6; i++) {
            off[i] = 0;
            app[i] = raw[i];
            prev[i] = raw[i];
          }
        } else {
          for (let i = 0; i < 6; i++) {
            const lim = (i === 0 ? acc[0] : i < 3 ? acc[1] : acc[2] * (i < 5 ? FOLLOW_TURN : FOLLOW_TOE)) + FOLLOW_SLACK;
            const d = raw[i] - prev[i];
            const pass = d > lim ? lim : d < -lim ? -lim : d;
            off[i] = (off[i] - (d - pass)) * decay;
            app[i] = raw[i] + off[i];
            prev[i] = raw[i];
          }
        }
        leg.had = true;
        acc[0] = 0;
        acc[1] = 0;
        acc[2] = 0;
        so[0] = cH.x;
        so[1] = cH.y;
        so[2] = cH.z;
        so[3] = cB.y;
        so[4] = tipY;
        leg.ty = pC.y + app[0];
      } else if (leg.planted > 0) {
        // Easing out off its ground: the ankle's target kept at the height it stood at in the world (so the clip lifting
        // the foot, or its own seam, moves it only by the share let go), the rest held; and the next ground found is a
        // change from that alone.
        if (leg.ty === leg.ty) app[0] = leg.ty - pC.y;
        for (let i = 0; i < 6; i++) {
          prev[i] = app[i];
          off[i] = 0;
        }
        acc[0] = 0;
        acc[1] = 0;
        acc[2] = 0;
        so[0] = cH.x;
        so[1] = cH.y;
        so[2] = cH.z;
        so[3] = cB.y;
        so[4] = tipY;
      } else {
        leg.had = false;
        acc[2] = 0;
        so[0] = Number.NaN;
      }
      // The pelvis lowered for a foot on its ground this frame, by no more of it than the clip still has planted (a foot
      // leaving the ground asks less as it goes, and nothing once off: the pelvis is not held down to keep it there).
      if (wantAll > 0) {
        const down = -app[0] * (leg.planted < wantAll ? leg.planted : wantAll) * W;
        if (down > need) need = down;
      }
    }
    // The pelvis: down to what the lower foot needs (which eases, each foot's own ease), back up over `ik.ease`, never
    // above the clip, never past its most (itself eased: the capsule's step moves it a riser at once).
    this.mostE = this.mostE === this.mostE ? this.mostE + (most - this.mostE) * k : most;
    if (need > this.mostE) need = this.mostE;
    // Back up as the drop itself decays (never below what is needed), not as a chase of the need: a need that falls as the
    // placement eases out would be chased differently at every frame rate, where a decay is the same at all of them.
    if (need > this.drop) this.drop = need;
    else {
      this.drop -= this.drop * k;
      if (this.drop < need) this.drop = need;
    }
    if (this.drop < 1e-5 && need === 0) this.drop = 0;
    const drop = this.drop;
    if (drop !== 0) {
      rig.root.position.y -= drop;
      this.applied = drop;
    }
    // Each leg bent (every turn below is in the physics frame, which `turnBone` and `setBoneWorld` take as they are given): its hip, knee and ankle as the clip has them, lowered by the drop, and its ankle's target.
    for (let s = 0; s < legs.length; s++) {
      const leg = legs[s];
      const w = leg.planted * W;
      leg.thighQ.copy(leg.thigh.quaternion);
      leg.shinQ.copy(leg.shin.quaternion);
      leg.ankleQ.copy(leg.ankle.quaternion);
      if (leg.toe) leg.toeQ.copy(leg.toe.quaternion);
      boneIn(leg.thigh.parent!, toPhys, sv, qP);
      boneIn(leg.thigh, toPhys, pA, qA);
      boneIn(leg.shin, toPhys, pB, qB);
      boneIn(leg.ankle, toPhys, pC, qC);
      pA.y -= drop;
      pB.y -= drop;
      pC.y -= drop;
      const q = this.ask;
      q.ax = pA.x;
      q.ay = pA.y;
      q.az = pA.z;
      q.bx = pB.x;
      q.by = pB.y;
      q.bz = pB.z;
      q.cx = pC.x;
      q.cy = pC.y;
      q.cz = pC.z;
      // The ankle's target: the clip's ankle lowered with the pelvis (so a swinging foot keeps the clip's own leg, riding
      // down with the body, and never folds up under a dropped hip), moved by its share onto its ground.
      const app = leg.app;
      q.tx = pC.x + app[1] * w;
      q.ty = pC.y + w * (drop + app[0]);
      q.tz = pC.z + app[2] * w;
      q.px = fx;
      q.py = 0;
      q.pz = fz;
      const o = this.out;
      solveTwoBone(q, o);
      // The thigh onto the new knee.
      TA.fx = pB.x - pA.x;
      TA.fy = pB.y - pA.y;
      TA.fz = pB.z - pA.z;
      TA.tx = o.kx - pA.x;
      TA.ty = o.ky - pA.y;
      TA.tz = o.kz - pA.z;
      turnBetweenIn(qD1, TA);
      turnBone(leg.thigh, qD1, qP);
      // The shin onto the new ankle, from where the thigh's turn carried it.
      qW.copy(qD1).multiply(qA);
      sv.x = pC.x - pA.x;
      sv.y = pC.y - pA.y;
      sv.z = pC.z - pA.z;
      sv.applyQuaternion(qD1);
      TA.fx = pA.x + sv.x - o.kx;
      TA.fy = pA.y + sv.y - o.ky;
      TA.fz = pA.z + sv.z - o.kz;
      TA.tx = o.ex - o.kx;
      TA.ty = o.ey - o.ky;
      TA.tz = o.ez - o.kz;
      turnBetweenIn(qD2, TA);
      turnBone(leg.shin, qD2, qW);
      // The ankle: the clip's own turn in the world, turned to the slope by the placement's share (its pitch and roll
      // taken by that share, so a placement easing in turns the foot in with it).
      qX.set(0, 0, 0, 1);
      if (app[3] !== 0 || app[4] !== 0) {
        const tp = Math.tan(app[3] * w);
        const tr = Math.tan(app[4] * w);
        TA.fx = 0;
        TA.fy = 1;
        TA.fz = 0;
        TA.tx = rx * tr + fx * tp;
        TA.ty = 1;
        TA.tz = rz * tr + fz * tp;
        turnBetweenIn(qX, TA);
      }
      qT.copy(qX).multiply(qC);
      qW.copy(qD2).multiply(qD1).multiply(qB);
      setBoneWorld(leg.ankle, qT, qW);
      // The toe, bent about the foot's own right by its share.
      if (leg.toe && app[5] !== 0) {
        vAxis.x = rx;
        vAxis.y = 0;
        vAxis.z = rz;
        vAxis.applyQuaternion(qX);
        // A bend up (+) turns the toe's tip up: about the figure's right, which is minus (rx, rz). Three's
        // `setFromAxisAngle`, written out so no number crosses a call.
        const half = -app[5] * w * 0.5;
        const sh = Math.sin(half);
        QB[0] = vAxis.x * sh;
        QB[1] = vAxis.y * sh;
        QB[2] = vAxis.z * sh;
        QB[3] = Math.cos(half);
        qD1.fromArray(QB);
        turnBone(leg.toe, qD1, qT);
      }
    }
    this.written = true;
  }

  /**
   * A leg's sole point now in the physics frame (`which` 0 the heel, 1 the ball, 2 the toe's tip), from the bones as they stand: what the
   * tests and the console measure against the ground. Needs the figure's matrices worked out after `step`.
   */
  solePoint(side: number, which: number, toPhys: THREE.Matrix4 | null, out: THREE.Vector3): THREE.Vector3 | null {
    const leg = this.legs?.[side];
    if (!leg || !this.rig) return null;
    boneIn(this.rig.root, toPhys, pA, qP);
    const scale = vScale.y;
    if (which === 2) {
      if (!leg.toe) return null;
      boneIn(leg.toe, toPhys, pT, qT);
      return out.copy(leg.tip).multiplyScalar(scale).applyQuaternion(qT).add(pT);
    }
    boneIn(leg.ankle, toPhys, pC, qC);
    return out.copy(which === 0 ? leg.heel : leg.ball).multiplyScalar(scale).applyQuaternion(qC).add(pC);
  }

  /** How planted each leg is, and its lift and pull: the console's. Makes an object. */
  report(): Record<string, unknown> {
    const n = (v: number, d = 3) => Number(v.toFixed(d));
    return {
      rule: this.tune.rule,
      eye: this.tune.eye,
      weight: n(this.weight),
      dropM: n(this.drop),
      legs: this.none ? 'this skeleton has no legs to place' : (this.legs ?? []).map((l, i) => ({ side: i === 0 ? 'left' : 'right', planted: n(l.planted), clip: n(l.clip), grounded: l.grounded, liftM: n(l.app[0]), easingM: n(Math.abs(l.off[0]) + this.scaleNow * (l.footLen * (Math.abs(l.off[3]) + Math.abs(l.off[4])) + l.toeLen * Math.abs(l.off[5])), 4), pullM: n(Math.sqrt(l.app[1] * l.app[1] + l.app[2] * l.app[2])), pitchDeg: n(l.app[3] / DEG, 1), rollDeg: n(l.app[4] / DEG, 1), toeDeg: n(l.app[5] / DEG, 1) })),
      casts: this.casts,
      reused: this.reused,
    };
  }
}
