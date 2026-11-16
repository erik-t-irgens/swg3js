// The hands put on what they hold and the feet on a wall (wave 4 of the animations): a two-bone solve of each arm
// (src/anim/twoBone.ts, wave 3's, its elbow bent the way the clip bends it) so its grip point (between the wrist and the
// index knuckle) meets a target, and of each leg so its foot's ball meets a wall's face. The ledges (src/player/ledge.ts)
// hand it the lip's line; maker B's wall climb and the hands' bracing hand it their own targets through `setHand`. One
// object a figure, its own hook on the rig (`limbPose`), so what it turned after the mixer is put back before the mixer
// runs again (the mixer writes a joint only when its clip's value moved: wave 1's lesson).
//
// Every turn is worked out in one frame the caller chooses (the world's, or a ship's rooms' physics frame): `toPhys` takes
// the world into it, null for the world's own. Nothing is made on a frame: every scratch is kept; the feet's rays are the
// engine's own answers, cast only where a foot moved more than `SAME_PLACE` since its last.

import * as THREE from 'three';
import type { RAPIER } from '../core/physics.ts';
import { TwoBoneAsk, TwoBoneOut, solveTwoBone } from '../anim/twoBone.ts';
import { TurnAsk, setBoneWorld, turnBetweenIn, turnBone } from './limbIk.ts';
import { STILL_FLAGS } from './stairSense.ts';
import { WALL_PLANT } from '../anim/wallClips.ts';

/** The little of a rig this asks: its root, its bones by name, and the hook its update calls before the mixer. */
export interface LimbRig {
  readonly root: THREE.Object3D;
  boneNamed(name: string): THREE.Bone | null;
  limbPose: { restore(): void } | null;
}

/** The little of a physics world the feet ask. */
export interface LimbWorld {
  castRayAndGetNormal(ray: RAPIER.Ray, maxToi: number, solid: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): RAPIER.RayColliderIntersection | null;
}

/** An arm's bones (the shoulder's, the elbow's, the wrist and what it hangs from, the index knuckle) and its clean turns. */
class Arm {
  readonly upper: THREE.Bone;
  readonly fore: THREE.Bone;
  readonly wrist: THREE.Bone;
  readonly index: THREE.Bone | null;
  /** The thumb's first joint (the palm's other side), or null: what the palm's turn reads (maker B's bracing). */
  readonly thumb: THREE.Bone | null;
  readonly upperQ = new THREE.Quaternion();
  readonly foreQ = new THREE.Quaternion();
  readonly wristQ = new THREE.Quaternion();
  constructor(upper: THREE.Bone, fore: THREE.Bone, wrist: THREE.Bone, index: THREE.Bone | null, thumb: THREE.Bone | null) {
    this.upper = upper;
    this.fore = fore;
    this.wrist = wrist;
    this.index = index;
    this.thumb = thumb;
  }
}

/** A leg's bones for the wall and its clean turns, and its kept ray. */
class WallLeg {
  readonly thigh: THREE.Bone;
  readonly shin: THREE.Bone;
  readonly ankle: THREE.Bone;
  readonly toe: THREE.Bone | null;
  readonly thighQ = new THREE.Quaternion();
  readonly shinQ = new THREE.Quaternion();
  readonly ankleQ = new THREE.Quaternion();
  /** The last ray's origin and how far along it the face stood (NaN for none). */
  rx = Number.NaN;
  ry = Number.NaN;
  rz = Number.NaN;
  toi = Number.NaN;
  /**
   * The ledges' braced feet (the fix round's): this foot's own share on the wall, eased toward whether its own ray meets the
   * face (a foot past a wall's end comes off it rather than standing on nothing), and the last face its ray met.
   */
  w = 0.5;
  last = Number.NaN;
  constructor(thigh: THREE.Bone, shin: THREE.Bone, ankle: THREE.Bone, toe: THREE.Bone | null) {
    this.thigh = thigh;
    this.shin = shin;
    this.ankle = ankle;
    this.toe = toe;
    this.w = 0;
  }
}

/** A foot moved by less than this is in the same place (no ray), metres. */
const SAME_PLACE = 0.005;
/** How far the foot's ball stands off the face once placed, metres on the human male (the shoe's toe past the ball). */
export const BALL_OFF = 0.04;

// Scratch: kept, written in place.
const m4 = new THREE.Matrix4();
const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const pC = new THREE.Vector3();
const pG = new THREE.Vector3();
const pT = new THREE.Vector3();
const sv = new THREE.Vector3();
const vScale = new THREE.Vector3();
const qP = new THREE.Quaternion();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();
const qM = new THREE.Quaternion();
const qD1 = new THREE.Quaternion();
const qD2 = new THREE.Quaternion();
const qW = new THREE.Quaternion();
const qX = new THREE.Quaternion();
const qR = new THREE.Quaternion();
const qI = new THREE.Quaternion();
/** The palm's turn (maker B's bracing), the hand's new world turn with it, a foot's own share of the wall's turn, and the thumb's place. */
const qPalm = new THREE.Quaternion();
const qE = new THREE.Quaternion();
const qY = new THREE.Quaternion();
const pTh = new THREE.Vector3();
const pN = new THREE.Vector3();
const TA = new TurnAsk();

/** Where a bone stands and how it is turned, in the physics frame (`toPhys` null: the world's). */
function boneIn(bone: THREE.Object3D, toPhys: THREE.Matrix4 | null, p: THREE.Vector3, q: THREE.Quaternion): void {
  if (toPhys) m4.multiplyMatrices(toPhys, bone.matrixWorld);
  else m4.copy(bone.matrixWorld);
  m4.decompose(p, q, vScale);
}

export class LimbPlace {
  /** Each hand's grip target in the physics frame (left 0..2, right 3..5) and how much of it (0 to 1). Written by the caller. */
  readonly hand = new Float64Array(6);
  readonly handW = new Float64Array(2);
  /** A wall for the feet: a point on its face and its outward normal (unit), in the physics frame, and how much (0 to 1). */
  wallW = 0.5;
  readonly wall = new Float64Array(6);
  /** The move's own collision groups (the feet's rays). */
  filter = 0.5;
  /**
   * Maker B's wall climb: each foot placed on the wall by how near the clip has it to the face as well (wholly within
   * `WALL_PLANT.near`, let go of from `far`), so a foot the clip lifts for its next hold is the clip's own. The ledges'
   * braced feet leave it false (both feet wholly on the wall, as they were).
   */
  footFade = false;
  /**
   * The ledges' braced feet (the fix round's): how far a foot's own share moves toward on or off the wall this frame (the
   * frame's seconds over `climb.ease`; 1 at once). Written by the caller; maker B's climb (`footFade`) never reads it.
   */
  footStep = 0.5;
  /**
   * Maker B's bracing: each hand's palm turned flat against a face (its outward normal, left 0..2, right 3..5, in the
   * physics frame) by this much (0 to 1), the wrist moved so the grip still lands on its target. Nought: the clip's own
   * hand, as the ledges and the climb leave it.
   */
  readonly palm = new Float64Array(6);
  readonly palmW = new Float64Array(2);
  /** Rays cast for the feet, and read back with none (the console's and the tests'). */
  casts = 0;
  reused = 0;
  /** Feet placed on a face found (each foot a frame): what tells a wall met from one missed (the console's and the tests'). */
  feetOn = 0;
  readonly ask = new TwoBoneAsk();
  readonly out = new TwoBoneOut();
  private rig: LimbRig | null = null;
  private arms: Arm[] | null = null;
  private legs: WallLeg[] | null = null;
  private written = false;
  private ray: RAPIER.Ray | null = null;
  private readonly makeRay: (() => RAPIER.Ray) | null;

  constructor(makeRay: (() => RAPIER.Ray) | null = null) {
    this.makeRay = makeRay;
    this.wallW = 0;
    this.filter = 0;
    this.past = 0;
    this.footFade = false;
    this.footStep = 1;
  }

  /** A foot's own share on the wall (0 left, 1 right): the tests' read-back of the ledges' braced feet. */
  footW(side: number): number {
    return this.legs ? this.legs[side].w : 0;
  }

  /** Whether `setHand` or the wall asks anything this frame. */
  get busy(): boolean {
    return this.handW[0] > 0 || this.handW[1] > 0 || this.wallW > 0;
  }

  /** A hand's target (0 left, 1 right) in the physics frame and its weight: maker B's bracing asks through this. */
  setHand(side: number, x: number, y: number, z: number, w: number): void {
    this.hand[side * 3] = x;
    this.hand[side * 3 + 1] = y;
    this.hand[side * 3 + 2] = z;
    this.handW[side] = w;
  }

  /** The limbs of a rig, found once a rig (its `limbPose` hook set to this). */
  private limbsOf(rig: LimbRig): boolean {
    if (rig === this.rig) return this.arms !== null;
    if (this.rig && this.rig.limbPose === this) this.rig.limbPose = null;
    this.rig = rig;
    this.arms = null;
    this.legs = null;
    this.written = false;
    const arms: Arm[] = [];
    const legs: WallLeg[] = [];
    for (const s of ['l', 'r']) {
      const upper = rig.boneNamed(`${s}Arm`);
      const fore = rig.boneNamed(`${s}ForeArm`);
      const wrist = rig.boneNamed(`${s}Wrist`);
      if (!upper || !fore || !wrist || fore.parent !== upper || !wrist.parent) return false;
      // The wrist hangs from the forearm or from a twist bone under it (the game's ulna): either rides the forearm.
      if (wrist.parent !== fore && wrist.parent.parent !== fore) return false;
      const index = rig.boneNamed(`${s}Index01`);
      const thumb = rig.boneNamed(`${s}Thumb01`);
      arms.push(new Arm(upper, fore, wrist, index && index.parent === wrist ? index : null, thumb && thumb.parent === wrist ? thumb : null));
      const thigh = rig.boneNamed(`${s}Thigh`);
      const shin = rig.boneNamed(`${s}Shin`);
      const ankle = rig.boneNamed(`${s}Ankle`);
      const toe = rig.boneNamed(`${s}Toe`);
      if (thigh && shin && ankle && shin.parent === thigh && ankle.parent === shin) legs.push(new WallLeg(thigh, shin, ankle, toe && toe.parent === ankle ? toe : null));
    }
    this.arms = arms;
    this.legs = legs.length === 2 ? legs : null;
    rig.limbPose = this;
    return true;
  }

  /** The clean pose back on the bones (the rig calls this at the top of its update, before the mixer). */
  restore(): void {
    if (!this.written) return;
    if (this.arms) for (const a of this.arms) {
      a.upper.quaternion.copy(a.upperQ);
      a.fore.quaternion.copy(a.foreQ);
      a.wrist.quaternion.copy(a.wristQ);
    }
    if (this.legs) for (const l of this.legs) {
      l.thigh.quaternion.copy(l.thighQ);
      l.shin.quaternion.copy(l.shinQ);
      l.ankle.quaternion.copy(l.ankleQ);
    }
    this.written = false;
  }

  /**
   * One frame, the figure posed and placed with its world matrices fresh: each hand with a weight put on its target, and
   * with a wall's weight each foot's ball on the wall. `world` for the feet's rays (null: no feet).
   */
  place(rig: LimbRig, world: LimbWorld | null, toPhys: THREE.Matrix4 | null): void {
    if (!this.busy) return;
    if (!this.limbsOf(rig)) return;
    const arms = this.arms!;
    // The figure's own left, up and forward in the physics frame (the arms' pole where a posed arm is straight).
    boneIn(rig.root, toPhys, pA, qR);
    for (let s = 0; s < 2; s++) {
      const w = this.handW[s];
      const a = arms[s];
      a.upperQ.copy(a.upper.quaternion);
      a.foreQ.copy(a.fore.quaternion);
      a.wristQ.copy(a.wrist.quaternion);
      if (!(w > 0)) continue;
      boneIn(a.upper.parent!, toPhys, sv, qP);
      boneIn(a.upper, toPhys, pA, qA);
      boneIn(a.fore, toPhys, pB, qB);
      boneIn(a.wrist, toPhys, pC, qC);
      boneIn(a.wrist.parent!, toPhys, sv, qM);
      // The grip point as posed: between the wrist and the index knuckle, else the wrist.
      if (a.index) {
        boneIn(a.index, toPhys, pG, qW);
        // The palm's own turn first (maker B's bracing): from the palm as posed (the cross of the index and the thumb off the
        // wrist, the left hand's the other way round) to flat against the face, by its share.
        const pw = this.palmW[s];
        if (pw > 0 && a.thumb) this.palmTurn(a.thumb, s, pw, toPhys);
        else qPalm.set(0, 0, 0, 1);
        pG.add(pC).multiplyScalar(0.5);
      } else {
        pG.copy(pC);
        qPalm.set(0, 0, 0, 1);
      }
      const w1 = w > 1 ? 1 : w;
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
      // The wrist goes where the grip has to go, the hand turned as the clip turns it (and by the palm's turn, about the
      // wrist: the grip's offset from the wrist turned with it, so the grip still lands on its target).
      if (qPalm.w < 1) {
        pT.x = pG.x - pC.x;
        pT.y = pG.y - pC.y;
        pT.z = pG.z - pC.z;
        pT.applyQuaternion(qPalm);
        q.tx = pC.x + (this.hand[s * 3] - pC.x - pT.x) * w1;
        q.ty = pC.y + (this.hand[s * 3 + 1] - pC.y - pT.y) * w1;
        q.tz = pC.z + (this.hand[s * 3 + 2] - pC.z - pT.z) * w1;
      } else {
        q.tx = pC.x + (this.hand[s * 3] - pG.x) * w1;
        q.ty = pC.y + (this.hand[s * 3 + 1] - pG.y) * w1;
        q.tz = pC.z + (this.hand[s * 3 + 2] - pG.z) * w1;
      }
      // A straight arm's elbow: out to its side and down and back (the figure's left is +x of its root's turn).
      const side = s === 0 ? 1 : -1;
      sv.set(side, -0.5, -0.4).applyQuaternion(qR);
      q.px = sv.x;
      q.py = sv.y;
      q.pz = sv.z;
      const o = this.out;
      solveTwoBone(q, o);
      // The hand's world turn kept as the clip had it, or turned flat against the face by the palm's turn.
      if (qPalm.w < 1) qE.copy(qPalm).multiply(qC);
      this.turnLimb(a.upper, a.fore, a.wrist, qP, qA, qB, qC, qM, o, true, qPalm.w < 1 ? qE : qC);
    }
    // The feet on the wall.
    if (this.wallW > 0 && world && this.legs) this.placeFeet(world, toPhys);
    this.written = true;
  }

  /**
   * The upper bone onto the new middle joint, the lower onto the new end (from where the upper's turn carried it), and the
   * end's own world turn kept as the clip had it (its parent `qM` the end's parent's old world turn, which rides the lower).
   */
  private turnLimb(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Bone, qPar: THREE.Quaternion, qUp: THREE.Quaternion, qLo: THREE.Quaternion, qEndWas: THREE.Quaternion, qEndPar: THREE.Quaternion, o: TwoBoneOut, keepEnd: boolean, qEnd: THREE.Quaternion = qEndWas): void {
    TA.fx = pB.x - pA.x;
    TA.fy = pB.y - pA.y;
    TA.fz = pB.z - pA.z;
    TA.tx = o.kx - pA.x;
    TA.ty = o.ky - pA.y;
    TA.tz = o.kz - pA.z;
    turnBetweenIn(qD1, TA);
    turnBone(upper, qD1, qPar);
    qW.copy(qD1).multiply(qUp);
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
    turnBone(lower, qD2, qW);
    if (!keepEnd) return;
    // The end's parent (the lower bone or a twist bone under it) turned by both: its new world turn.
    qI.copy(qD2).multiply(qD1).multiply(qEndPar);
    setBoneWorld(end, qEnd, qI);
    void qLo;
  }

  /**
   * The palm's turn into `qPalm` (maker B's bracing): from the palm as posed to flat against the face (`palm`, its outward
   * normal: the palm faces into it), by `w`. The palm's normal is the cross of the index knuckle's and the thumb's offsets
   * from the wrist, index by thumb for the left hand and thumb by index for the right (read off the human male's rest pose,
   * whose hands hang palm in), so a figure's own hand says which way its palm faces. `pC` the wrist and `pG` the index
   * knuckle as posed, in the physics frame.
   */
  private palmTurn(thumb: THREE.Bone, s: number, w: number, toPhys: THREE.Matrix4 | null): void {
    boneIn(thumb, toPhys, pTh, qW);
    const ix = pG.x - pC.x;
    const iy = pG.y - pC.y;
    const iz = pG.z - pC.z;
    const tx = pTh.x - pC.x;
    const ty = pTh.y - pC.y;
    const tz = pTh.z - pC.z;
    const k = s === 0 ? 1 : -1;
    pN.x = (iy * tz - iz * ty) * k;
    pN.y = (iz * tx - ix * tz) * k;
    pN.z = (ix * ty - iy * tx) * k;
    TA.fx = pN.x;
    TA.fy = pN.y;
    TA.fz = pN.z;
    TA.tx = -this.palm[s * 3];
    TA.ty = -this.palm[s * 3 + 1];
    TA.tz = -this.palm[s * 3 + 2];
    turnBetweenIn(qPalm, TA);
    if (w < 1) qPalm.slerp(qI.set(0, 0, 0, 1), 1 - w);
  }

  /** Each foot's ball onto the wall's face along its normal, the foot turned from the clip's own wall (square to the figure's front) to the face's. */
  private placeFeet(world: LimbWorld, toPhys: THREE.Matrix4 | null): void {
    const legs = this.legs!;
    const w = this.wallW > 1 ? 1 : this.wallW;
    const nx = this.wall[3];
    const ny = this.wall[4];
    const nz = this.wall[5];
    // The clip's own wall: square to the figure's front (its normal the figure's back, level).
    sv.set(0, 0, -1).applyQuaternion(qR);
    // (A figure leant into a climbed face by its root (maker B's wall climb, `footFade`): its own wall leans with it.)
    const fade = this.footFade;
    TA.fx = sv.x;
    TA.fy = fade ? sv.y : 0;
    TA.fz = sv.z;
    TA.tx = nx;
    TA.ty = ny;
    TA.tz = nz;
    turnBetweenIn(qX, TA);
    if (!fade) qX.slerp(qI.set(0, 0, 0, 1), 1 - w);
    for (const l of legs) {
      l.thighQ.copy(l.thigh.quaternion);
      l.shinQ.copy(l.shin.quaternion);
      l.ankleQ.copy(l.ankle.quaternion);
      boneIn(l.thigh.parent!, toPhys, sv, qP);
      boneIn(l.thigh, toPhys, pA, qA);
      boneIn(l.shin, toPhys, pB, qB);
      boneIn(l.ankle, toPhys, pC, qC);
      // The ball (the toe's joint), else the ankle: how far off the face it stands, by a ray into the wall from it.
      if (l.toe) boneIn(l.toe, toPhys, pT, qW);
      else pT.copy(pC);
      // The ball (pT) into the face along its normal: the answer is the leg's own (`toi`).
      this.faceAhead(world, l);
      let d = l.toi;
      if (!fade) {
        // The ledges' feet: each on the wall only where its own ray meets the face, eased on and off (a foot past the
        // wall's end comes off it from the last face it met).
        const goal = d === d ? 1 : 0;
        const st = this.footStep;
        const lw = l.w;
        l.w = lw < goal ? (lw + st < goal ? lw + st : goal) : lw - st > goal ? lw - st : goal;
        if (d === d) l.last = d;
        else d = l.last;
        if (!(l.w > 0) || !(d === d)) continue;
      } else if (!(d === d)) continue;
      // Each foot by how near the clip has it to the face, where the climb asks (a foot lifted for its next hold is the clip's).
      const off = d - BALL_OFF;
      const wf = fade ? w * (off <= WALL_PLANT.near ? 1 : off >= WALL_PLANT.far ? 0 : 1 - (off - WALL_PLANT.near) / (WALL_PLANT.far - WALL_PLANT.near)) : w * l.w;
      if (!(wf > 0)) continue;
      this.feetOn++;
      const move = off * wf;
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
      q.tx = pC.x - nx * move;
      q.ty = pC.y - ny * move;
      q.tz = pC.z - nz * move;
      // A straight leg's knee: toward the wall.
      q.px = -nx;
      q.py = 0;
      q.pz = -nz;
      const o = this.out;
      solveTwoBone(q, o);
      this.turnLimb(l.thigh, l.shin, l.ankle, qP, qA, qB, qC, qB, o, false);
      // The ankle: the clip's own turn, turned from its wall to the face's.
      qW.copy(qD2).multiply(qD1).multiply(qB);
      if (fade) qM.copy(qY.copy(qX).slerp(qI.set(0, 0, 0, 1), 1 - wf)).multiply(qC);
      else qM.copy(qX).multiply(qC);
      setBoneWorld(l.ankle, qM, qW);
    }
  }

  /**
   * How far into the wall (against its normal) from the ball (`pT`) a face stands within 0.6 m, or NaN, into the leg's `toi`:
   * one ray, or the last one's answer where the foot has not moved. Read off kept fields, so no number crosses a call.
   */
  private faceAhead(world: LimbWorld, l: WallLeg): void {
    const x = pT.x;
    const y = pT.y;
    const z = pT.z;
    const dx = -this.wall[3];
    const dy = -this.wall[4];
    const dz = -this.wall[5];
    const ex = x - l.rx;
    const ey = y - l.ry;
    const ez = z - l.rz;
    if (ex <= SAME_PLACE && ex >= -SAME_PLACE && ey <= SAME_PLACE && ey >= -SAME_PLACE && ez <= SAME_PLACE && ez >= -SAME_PLACE) {
      this.reused++;
      return;
    }
    if (!this.makeRay) {
      l.toi = Number.NaN;
      return;
    }
    let ray = this.ray;
    if (!ray) ray = this.ray = this.makeRay();
    // From a little behind the ball, so a ball already against the face still finds it.
    ray.origin.x = x - dx * 0.15;
    ray.origin.y = y - dy * 0.15;
    ray.origin.z = z - dz * 0.15;
    ray.dir.x = dx;
    ray.dir.y = dy;
    ray.dir.z = dz;
    this.casts++;
    const h = world.castRayAndGetNormal(ray, 0.75, true, STILL_FLAGS, this.filter);
    l.rx = x;
    l.ry = y;
    l.rz = z;
    l.toi = h ? h.timeOfImpact - 0.15 : Number.NaN;
  }

  /** Each hand's grip point now (0 left, 1 right) in the physics frame, from the bones as they stand: the tests' read-back. */
  gripNow(rig: LimbRig, side: number, toPhys: THREE.Matrix4 | null, out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.limbsOf(rig)) return null;
    const a = this.arms![side];
    boneIn(a.wrist, toPhys, pC, qC);
    if (a.index) {
      boneIn(a.index, toPhys, pG, qW);
      return out.copy(pG).add(pC).multiplyScalar(0.5);
    }
    return out.copy(pC);
  }

  /**
   * How far a hand's grip point would have to reach past the arm's whole length to stand at (x, y, z) in the physics frame
   * from the pose as it stands (nought within reach), and the way from the shoulder to it into `dir`: what the ledges move a
   * hanging body by so no arm is asked to stretch.
   */
  reachPastIn(rig: LimbRig, side: number, toPhys: THREE.Matrix4 | null, dir: THREE.Vector3): void {
    this.past = 0;
    if (!this.limbsOf(rig)) return;
    const a = this.arms![side];
    boneIn(a.upper, toPhys, pA, qA);
    boneIn(a.fore, toPhys, pB, qB);
    boneIn(a.wrist, toPhys, pC, qC);
    if (a.index) {
      boneIn(a.index, toPhys, pG, qW);
      pG.x = (pG.x + pC.x) * 0.5;
      pG.y = (pG.y + pC.y) * 0.5;
      pG.z = (pG.z + pC.z) * 0.5;
    } else pG.copy(pC);
    const ux = pB.x - pA.x;
    const uy = pB.y - pA.y;
    const uz = pB.z - pA.z;
    const lx = pC.x - pB.x;
    const ly = pC.y - pB.y;
    const lz = pC.z - pB.z;
    const reach = Math.sqrt(ux * ux + uy * uy + uz * uz) + Math.sqrt(lx * lx + ly * ly + lz * lz);
    const at = this.reachAt;
    const x = pC.x + at[0] - pG.x - pA.x;
    const y = pC.y + at[1] - pG.y - pA.y;
    const z = pC.z + at[2] - pG.z - pA.z;
    const d = Math.sqrt(x * x + y * y + z * z);
    if (!(d > reach) || !(d > 1e-9)) return;
    dir.x = x / d;
    dir.y = y / d;
    dir.z = z / d;
    this.past = d - reach;
  }

  /** `reachPastIn`'s ask, the place in the physics frame (written by the caller), and its answer, metres. */
  readonly reachAt = new Float64Array(3);
  past = 0.5;

  /** Let go of everything placed: the next frame asks afresh (the feet's kept rays forgotten). */
  reset(): void {
    this.handW[0] = 0;
    this.handW[1] = 0;
    this.wallW = 0;
    this.palmW[0] = 0;
    this.palmW[1] = 0;
    this.footFade = false;
    if (this.legs) for (const l of this.legs) l.toi = Number.NaN, (l.rx = Number.NaN), (l.w = 0), (l.last = Number.NaN);
  }

  /** What the console says. */
  report(): Record<string, unknown> {
    const n = (v: number) => Math.round(v * 1000) / 1000;
    return { hands: [n(this.handW[0]), n(this.handW[1])], wall: n(this.wallW), casts: this.casts, reused: this.reused, feetOn: this.feetOn };
  }
}
