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
import type { ClimbHolds } from './climbHolds.ts';

/** The little of a rig this asks: its root, its bones by name, and the hook its update calls before the mixer. */
export interface LimbRig {
  readonly root: THREE.Object3D;
  boneNamed(name: string): THREE.Bone | null;
  limbPose: { restore(): void } | null;
  /**
   * Climbing II, the feedback round II (maker B, the legs laid over the pose: `legClip`): each named bone's own turn at a time
   * of a clip, four numbers a bone into `out` (src/player/rig.ts's `turnsAt`). Optional: a rig without it lays no clip's legs.
   */
  turnsAt?(clip: string, names: readonly string[], when: Float64Array, out: Float64Array): boolean;
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
/**
 * A foot's hold is out of the leg's reach past this share of the thigh's and shin's length from the hip (Climbing II's
 * fixer): a mechanic, not feel, a touch short of straight so the knee's solve never meets a leg locked out.
 */
export const HOLD_REACH = 0.98;

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
/** The legs laid over the pose (the feedback round II, maker B): the waist, the feet's middle, the turns. Kept, written in place. */
const pW = new THREE.Vector3();
const pM = new THREE.Vector3();
const pR = new THREE.Vector3();
const pR2 = new THREE.Vector3();
const qL = new THREE.Quaternion();
const qL2 = new THREE.Quaternion();
const qPar = new THREE.Quaternion();
const qParI = new THREE.Quaternion();
const qOld = new THREE.Quaternion();
const qT1 = new THREE.Quaternion();
const qT2 = new THREE.Quaternion();
/** The root where the legs were laid and where it stands as the feet are placed (the push between carries the kept feet). */
const pRootLaid = new THREE.Vector3();
const pRootNow = new THREE.Vector3();

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
   * Smoothness III, item 0: the share of the climb's sphere push (`clearClimb`, `settleClimb`) the figure keeps: 1, but while a
   * climb up crossfades into the crouch it ends in, the crossfade's own share left (the ledge's `standKeep`), so the push goes
   * out with the climb's own line-up and nothing of it is dropped in one frame at the hand-back. Written by the ledge and the
   * wall each frame they place the limbs.
   */
  pushKeep = 0.5;
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
   * Climbing II, item 6 (`climb.wallLimbs` 'held'): the wall climb's holds, the feet's half of them (limbs 2 and 3): each foot
   * the clip plants is put on its hold until its next reach (src/player/climbHolds.ts). Written by the wall climb each frame
   * (null under 'before', and by everything else); read only with `footFade`.
   */
  holds: ClimbHolds | null = null;
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
  /**
   * Climbing II, the feedback round II (maker B, items 0e and 0f): the legs laid over the pose, below the spine. `legClip` a clip
   * of the rig's (its own name, '' none) whose pelvis and legs are laid at `legAt` seconds by `legW` (0 to 1), the pelvis turned
   * about the waist and the torso kept as it stands (a free hop's leg kick, a free ladder's shimmy legs); `swayX`, `swayZ` the
   * world's horizontal way the hips' lag carries the feet, metres, the pelvis and legs turned about the waist by it (the sway's
   * damped pendulum, `LedgeHang.swayStep`). A braced figure's feet (the ledges' `wallW`) are put where they stood before either,
   * so a braced ladder's feet stay on the rungs. Written by the caller each frame; `place` takes them and puts them back to none.
   */
  legClip = '';
  legAt = 0.5;
  legW = 0.5;
  swayX = 0.5;
  swayZ = 0.5;
  /**
   * Item 0d: a clip's torso laid over the pose (the spine from the waist to the shoulders and each shoulder, never the arms the
   * hands' solve has, nor the neck and head the look has): `torsoClip` a clip of the rig's ('' none) at `torsoAt` seconds by
   * `torsoW` (0 to 1): the free hang's small pull-up's own look, its arms then bent onto the grip by the hands' solve. Taken by
   * `place` as the legs are.
   */
  torsoClip = '';
  torsoAt = 0.5;
  torsoW = 0.5;
  /** The legs laid this frame (the tests' read-back): whether, and the feet's middle carried from where the pose had it, metres. */
  legsLaid = false;
  legsMoved = 0.5;
  readonly ask = new TwoBoneAsk();
  readonly out = new TwoBoneOut();
  private rig: LimbRig | null = null;
  private arms: Arm[] | null = null;
  private legs: WallLeg[] | null = null;
  private written = false;
  private ray: RAPIER.Ray | null = null;
  private readonly makeRay: (() => RAPIER.Ray) | null;
  /** The legs laid over the pose (the feedback round II): the pelvis, the lowest spine bone, the names `turnsAt` is asked for and their bones (the pelvis first), and their clean pose. */
  private pelvis: THREE.Bone | null = null;
  private spineBase: THREE.Bone | null = null;
  private legNames: string[] = [];
  private legBones: THREE.Bone[] = [];
  private readonly legBuf = new Float64Array(40);
  private readonly legClean = new Float64Array(40);
  private torsoNames: string[] = [];
  private torsoBones: THREE.Bone[] = [];
  private readonly torsoBuf = new Float64Array(40);
  private readonly torsoClean = new Float64Array(40);
  private readonly pelvisPos = new THREE.Vector3();
  private readonly spineQ = new THREE.Quaternion();
  private legsWritten = false;
  /** Each braced foot's ball and ankle where the pose had them before the legs were laid (the physics frame), and whether kept this frame. */
  private readonly preFeet = new Float64Array(12);
  private preKept = false;

  constructor(makeRay: (() => RAPIER.Ray) | null = null) {
    this.makeRay = makeRay;
    this.wallW = 0;
    this.filter = 0;
    this.pushKeep = 1;
    this.past = 0;
    this.footFade = false;
    this.footStep = 1;
    this.legAt = 0;
    this.legW = 0;
    this.swayX = 0;
    this.swayZ = 0;
    this.legsMoved = 0;
    this.torsoAt = 0;
    this.torsoW = 0;
  }

  /** A foot's own share on the wall (0 left, 1 right): the tests' read-back of the ledges' braced feet. */
  footW(side: number): number {
    return this.legs ? this.legs[side].w : 0;
  }

  /**
   * Climbing II, phase 5 (the pole's feet, src/player/poleClimb.ts's `limbsFor`): each foot's ball target in the physics frame
   * (left 0..2, right 3..5) and how much of it (0 to 1), the ankle moved by the ball's way to it and turned as the clip turns it.
   * Nought: no foot asked so (every caller before the poles).
   */
  readonly foot = new Float64Array(6);
  readonly footTW = new Float64Array(2);

  /** Whether `setHand` or the wall asks anything this frame (or, phase 5, a foot's own target). */
  get busy(): boolean {
    return this.handW[0] > 0 || this.handW[1] > 0 || this.wallW > 0 || this.footTW[0] > 0 || this.footTW[1] > 0;
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
    // The feedback round II: the pelvis both thighs hang from, the lowest spine bone over it (the arms' way up to it), and the
    // names of the pelvis and every leg bone (what a clip's legs are laid by); none where the skeleton is not so.
    this.pelvis = null;
    this.spineBase = null;
    this.legNames = [];
    this.legBones = [];
    const P = this.legs ? this.legs[0].thigh.parent : null;
    if (P instanceof THREE.Bone && this.legs && this.legs[1].thigh.parent === P) {
      let sp: THREE.Object3D | null = arms[0].upper;
      while (sp && sp.parent !== P) sp = sp.parent;
      if (sp instanceof THREE.Bone) {
        this.pelvis = P;
        this.spineBase = sp;
        const bones: THREE.Bone[] = [P];
        for (const l of this.legs) {
          bones.push(l.thigh, l.shin, l.ankle);
          if (l.toe) bones.push(l.toe);
        }
        this.legBones = bones;
        this.legNames = bones.map((b) => b.name);
        // The torso's own bones (item 0d's pose laid over it): the spine from the waist up to the shoulders' own bone, and each
        // shoulder (what each arm hangs from), never the arms (the hands' solve has them) nor the neck and head (the look's).
        const torso: THREE.Bone[] = [];
        const c0 = arms[0].upper.parent;
        const c1 = arms[1].upper.parent;
        if (c0 instanceof THREE.Bone && c1 instanceof THREE.Bone && c0 !== sp && c1 !== sp) {
          const chain: THREE.Bone[] = [];
          for (let o: THREE.Object3D | null = c0.parent; o && o !== P; o = o.parent) if (o instanceof THREE.Bone) chain.push(o);
          if (chain[chain.length - 1] === sp) {
            chain.reverse();
            torso.push(...chain, c0);
            if (c1 !== c0) torso.push(c1);
          }
        }
        this.torsoBones = torso;
        this.torsoNames = torso.map((b) => b.name);
      }
    }
    this.legsWritten = false;
    rig.limbPose = this;
    return true;
  }

  /** The clean pose back on the bones (the rig calls this at the top of its update, before the mixer). */
  restore(): void {
    if (this.written) {
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
    // The feedback round II: the legs laid over the pose put back as the pose had them (after the feet's, which kept the laid ones).
    if (this.legsWritten) this.unlayLegs();
    this.preKept = false;
    this.legsLaid = false;
    this.legsMoved = 0;
  }

  /** The pelvis, the lowest spine bone and every leg bone back as the pose had them before `layLegs`. */
  private unlayLegs(): void {
    this.legsWritten = false;
    const P = this.pelvis;
    const S = this.spineBase;
    if (!P || !S) return;
    P.position.copy(this.pelvisPos);
    S.quaternion.copy(this.spineQ);
    const tb = this.torsoBones;
    const tc = this.torsoClean;
    for (let i = 0; i < tb.length; i++) tb[i].quaternion.fromArray(tc, i * 4);
    const bones = this.legBones;
    const c = this.legClean;
    for (let i = 0; i < bones.length; i++) bones[i].quaternion.fromArray(c, i * 4);
  }

  /**
   * The feedback round II (maker B, items 0e and 0f): the legs laid over the pose (`legClip` by `legW`, then the sway's carry of
   * the feet, `swayX`, `swayZ`), the pelvis and the legs turned about the waist (the lowest spine bone's place) and the torso kept
   * as it stood, so the arms and the hands are as they were. The clean pose kept for `restore`; a braced figure's feet first kept
   * where they stood (`preFeet`). False where nothing was laid.
   */
  private layLegs(rig: LimbRig, toPhys: THREE.Matrix4 | null): boolean {
    // (What is asked is read off the fields, never handed over: a number across a call is a number made.)
    const clip = this.legClip;
    const w = this.legW;
    const sx = this.swayX;
    const sz = this.swayZ;
    const tClip = this.torsoClip;
    const tW = this.torsoW;
    const P = this.pelvis;
    const S = this.spineBase;
    if (!P || !S || !P.parent) return false;
    const bones = this.legBones;
    const n = bones.length;
    // The braced feet where the pose has them, before anything is laid (the ledges' feet put back there by `placeFeet`).
    this.preKept = false;
    if (this.wallW > 0 && this.legs) {
      for (let li = 0; li < 2; li++) {
        const l = this.legs[li];
        boneIn(l.ankle, toPhys, pC, qC);
        if (l.toe) boneIn(l.toe, toPhys, pT, qW);
        else pT.copy(pC);
        const f = this.preFeet;
        f[li * 6] = pT.x;
        f[li * 6 + 1] = pT.y;
        f[li * 6 + 2] = pT.z;
        f[li * 6 + 3] = pC.x;
        f[li * 6 + 4] = pC.y;
        f[li * 6 + 5] = pC.z;
      }
      boneIn(rig.root, toPhys, pRootLaid, qC);
      this.preKept = true;
    }
    // The clean pose kept.
    this.pelvisPos.copy(P.position);
    this.spineQ.copy(S.quaternion);
    const c = this.legClean;
    for (let i = 0; i < n; i++) bones[i].quaternion.toArray(c, i * 4);
    const tb = this.torsoBones;
    const tc = this.torsoClean;
    for (let i = 0; i < tb.length; i++) tb[i].quaternion.toArray(tc, i * 4);
    this.legsWritten = true;
    let laid = false;
    // Item 0d: a clip's torso by `tW` (the spine and the shoulders' own turns), first, so the legs below keep it as it then stands.
    const when = this.turnWhen;
    when[0] = this.torsoAt;
    if (tClip && tW > 0 && tb.length > 0 && rig.turnsAt && rig.turnsAt(tClip, this.torsoNames, when, this.torsoBuf)) {
      const b = this.torsoBuf;
      this.layK = tW;
      if (this.layK > 1) this.layK = 1;
      for (let i = 0; i < tb.length; i++) this.slerpBone(tb[i].quaternion, b, i * 4);
      S.updateMatrixWorld(true);
      laid = true;
    }
    // The feet's middle before (what the sway and the read-back measure from).
    this.feetMiddle(pR2);
    // A clip's pelvis and legs, by `w`: the pelvis turned about the waist, the legs' own turns.
    when[0] = this.legAt;
    if (clip && w > 0 && rig.turnsAt && rig.turnsAt(clip, this.legNames, when, this.legBuf)) {
      const b = this.legBuf;
      this.layK = w;
      if (this.layK > 1) this.layK = 1;
      qL2.copy(P.quaternion);
      this.slerpBone(qL2, b, 0);
      this.turnPelvis(qL2);
      for (let i = 1; i < n; i++) this.slerpBone(bones[i].quaternion, b, i * 4);
      P.updateMatrixWorld(true);
      laid = true;
    }
    // The sway: the pelvis and the legs turned about the waist so the feet's middle is carried by (sx, sz) in the world.
    if (sx !== 0 || sz !== 0) {
      S.getWorldPosition(pW);
      this.feetMiddle(pM);
      pR.copy(pM).sub(pW);
      // (Lengths and the turn between two ways written out: three's hand their numbers across calls.)
      const len = Math.sqrt(pR.x * pR.x + pR.y * pR.y + pR.z * pR.z);
      pM.x += sx;
      pM.z += sz;
      pM.sub(pW);
      const len2 = Math.sqrt(pM.x * pM.x + pM.y * pM.y + pM.z * pM.z);
      if (len > 1e-4 && len2 > 1e-4) {
        const i1 = 1 / len;
        const i2 = 1 / len2;
        pR.x *= i1;
        pR.y *= i1;
        pR.z *= i1;
        pM.x *= i2;
        pM.y *= i2;
        pM.z *= i2;
        // The shortest turn taking pR to pM (both unit; the feet's two ways are never opposite here).
        const r = pR.x * pM.x + pR.y * pM.y + pR.z * pM.z + 1;
        const qx = pR.y * pM.z - pR.z * pM.y;
        const qy = pR.z * pM.x - pR.x * pM.z;
        const qz = pR.x * pM.y - pR.y * pM.x;
        const ql = Math.sqrt(qx * qx + qy * qy + qz * qz + r * r);
        const B = this.qBuf;
        B[0] = qx / ql;
        B[1] = qy / ql;
        B[2] = qz / ql;
        B[3] = r / ql;
        qL.fromArray(B, 0);
        // Into the pelvis's parent's frame, and laid on the pelvis's own turn.
        P.parent.getWorldQuaternion(qPar);
        qParI.copy(qPar).invert();
        qL2.copy(qParI).multiply(qL).multiply(qPar).multiply(P.quaternion);
        this.turnPelvis(qL2);
        P.updateMatrixWorld(true);
        laid = true;
      }
    }
    this.feetMiddle(pM);
    const mx = pM.x - pR2.x;
    const my = pM.y - pR2.y;
    const mz = pM.z - pR2.z;
    this.legsMoved = Math.sqrt(mx * mx + my * my + mz * mz);
    this.legsLaid = laid;
    if (!laid) this.unlayLegs();
    return laid;
  }

  /** The pelvis turned to `q` (its parent's frame) about the waist (the lowest spine bone's place), the spine's own turn kept in the world. */
  private turnPelvis(q: THREE.Quaternion): void {
    const P = this.pelvis!;
    const S = this.spineBase!;
    // The waist in the pelvis's parent's frame (the spine's place under the pelvis's turn and scale).
    pW.copy(S.position).multiply(P.scale).applyQuaternion(P.quaternion).add(P.position);
    qOld.copy(P.quaternion);
    // The turn from the old to the new, about the waist.
    qT1.copy(q).multiply(qT2.copy(qOld).invert());
    P.position.sub(pW).applyQuaternion(qT1).add(pW);
    P.quaternion.copy(q);
    // The spine's world turn kept: new^-1 old spine.
    S.quaternion.premultiply(qOld).premultiply(qT2.copy(q).invert());
  }

  /** The feet's middle (the two ankles') in the world, into `out`. */
  private feetMiddle(out: THREE.Vector3): void {
    if (!this.legs) {
      out.set(0, 0, 0);
      return;
    }
    this.legs[0].ankle.getWorldPosition(out);
    this.legs[1].ankle.getWorldPosition(pC);
    out.add(pC).multiplyScalar(0.5);
  }

  /**
   * One frame, the figure posed and placed with its world matrices fresh: each hand with a weight put on its target, and
   * with a wall's weight each foot's ball on the wall. `world` for the feet's rays (null: no feet).
   */
  /**
   * The feedback round II: the torso and the legs laid over the pose that were asked this frame (`torsoClip`, `legClip`, `swayX`,
   * `swayZ`), taken and put back to none, laid now. The ledge lays them as it hands them over (`limbsFor`), so the climb's sphere
   * clearing between it and `place` sees the figure as it is drawn; `place` lays whatever another caller asked. With none asked
   * this does nothing at all.
   */
  lay(rig: LimbRig, toPhys: THREE.Matrix4 | null): void {
    const lClip = this.legClip;
    const lW = this.legW;
    const sx = this.swayX;
    const sz = this.swayZ;
    const tClip = this.torsoClip;
    const tW = this.torsoW;
    const legsAsked = (lW > 0 && lClip !== '') || sx !== 0 || sz !== 0 || (tW > 0 && tClip !== '');
    if (!legsAsked) return;
    // (Laid once a frame: what a second call would lay is on bones already laid. `layLegs` reads the fields, then they go.)
    if (this.limbsOf(rig) && !this.legsWritten) this.layLegs(rig, toPhys);
    this.legClip = '';
    this.legW = 0;
    this.swayX = 0;
    this.swayZ = 0;
    this.torsoClip = '';
    this.torsoW = 0;
  }
  /** `turnsAt`'s time, handed over in a kept array. */
  private readonly turnWhen = new Float64Array(1);
  /** `slerpBone`'s share (a field: no number crosses the call). */
  private layK = 0.5;
  /** `slerpBone`'s and the sway's scratch, four numbers a turn. */
  private readonly qBuf = new Float64Array(4);

  /**
   * `q` turned toward the turn at `src[off..off + 3]` by `layK` (three's own `Quaternion.slerp`'s arithmetic, written out and
   * handed through a kept array: three's hands its share across calls, and in a frame a number across a call is a number made).
   */
  private slerpBone(q: THREE.Quaternion, src: Float64Array, off: number): void {
    const B = this.qBuf;
    q.toArray(B, 0);
    let x = src[off];
    let y = src[off + 1];
    let z = src[off + 2];
    let w = src[off + 3];
    let dot = B[0] * x + B[1] * y + B[2] * z + B[3] * w;
    if (dot < 0) {
      x = -x;
      y = -y;
      z = -z;
      w = -w;
      dot = -dot;
    }
    const k = this.layK;
    let s = 1 - k;
    let t = k;
    if (dot < 0.9995) {
      const theta = Math.acos(dot);
      const sin = Math.sin(theta);
      s = Math.sin(s * theta) / sin;
      t = Math.sin(t * theta) / sin;
      B[0] = B[0] * s + x * t;
      B[1] = B[1] * s + y * t;
      B[2] = B[2] * s + z * t;
      B[3] = B[3] * s + w * t;
    } else {
      B[0] = B[0] * s + x * t;
      B[1] = B[1] * s + y * t;
      B[2] = B[2] * s + z * t;
      B[3] = B[3] * s + w * t;
      const l = Math.sqrt(B[0] * B[0] + B[1] * B[1] + B[2] * B[2] + B[3] * B[3]);
      if (l === 0) {
        B[0] = 0;
        B[1] = 0;
        B[2] = 0;
        B[3] = 1;
      } else {
        const il = 1 / l;
        B[0] *= il;
        B[1] *= il;
        B[2] *= il;
        B[3] *= il;
      }
    }
    q.fromArray(B, 0);
  }

  place(rig: LimbRig, world: LimbWorld | null, toPhys: THREE.Matrix4 | null): void {
    // The feedback round II: whatever is still asked to be laid over the pose (with none asked this is the round before's to the
    // letter).
    this.lay(rig, toPhys);
    if (!this.busy && !this.legsWritten) {
      this.preKept = false;
      return;
    }
    if (!this.limbsOf(rig)) return;
    const arms = this.arms!;
    // The figure's own left, up and forward in the physics frame (the arms' pole where a posed arm is straight).
    boneIn(rig.root, toPhys, pA, qR);
    // (The feedback round II: where the root stands now, against where it stood as the legs were laid: the climb's push between.)
    pRootNow.copy(pA);
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
    // (Climbing II, phase 5: or each foot on a target of its own, the pole's.)
    else if ((this.footTW[0] > 0 || this.footTW[1] > 0) && this.legs) this.placeFeetAt(toPhys);
    this.written = true;
    // (The feedback round II: the braced feet's places before the legs were laid serve this frame's solve alone.)
    this.preKept = false;
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
    // Climbing II, item 6: the wall climb's holds (the feet are limbs 2 and 3), only with the wall's own fade.
    const holds = fade ? this.holds : null;
    for (let li = 0; li < 2; li++) {
      const l = legs[li];
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
      // The feedback round II: with the legs laid over the pose, a braced foot is put where it stood before (its ball and its
      // ankle as the pose had them), so a braced ladder's feet stay on the rungs while the hips and legs sway.
      const pre = this.preKept && !fade;
      let preFree = false;
      if (pre) {
        // (Carried by whatever moved the whole figure since they were kept: the climb's sphere push, which moves the feet with it.)
        const f = this.preFeet;
        const ex = pRootNow.x - pRootLaid.x;
        const ey = pRootNow.y - pRootLaid.y;
        const ez = pRootNow.z - pRootLaid.z;
        pT.set(f[li * 6] + ex, f[li * 6 + 1] + ey, f[li * 6 + 2] + ez);
        pN.set(f[li * 6 + 3] + ex - pC.x, f[li * 6 + 4] + ey - pC.y, f[li * 6 + 5] + ez - pC.z);
      }
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
        if (!(l.w > 0) || !(d === d)) {
          // (The feedback round II: with the legs laid over the pose, a braced foot no face is under is held where the pose had
          // it all the same, its ankle put back there and turned as the clip turns it.)
          if (!pre) continue;
          d = BALL_OFF;
          preFree = true;
        }
      } else if (!(d === d)) {
        // No face under the foot: its hold (item 6) let go of at once.
        if (holds) {
          holds.px = pT.x;
          holds.py = pT.y;
          holds.pz = pT.z;
          holds.drop(2 + li);
        }
        continue;
      }
      // Each foot by how near the clip has it to the face, where the climb asks (a foot lifted for its next hold is the clip's).
      const off = d - BALL_OFF;
      let wf = preFree ? 1 : fade ? w * (off <= WALL_PLANT.near ? 1 : off >= WALL_PLANT.far ? 0 : 1 - (off - WALL_PLANT.near) / (WALL_PLANT.far - WALL_PLANT.near)) : w * l.w;
      // Item 6: on its hold until its next reach (its ball's place on the face as the clip has it handed over, and the target and
      // weight the hold answers taken in its place).
      if (holds) {
        holds.px = pT.x - nx * off;
        holds.py = pT.y - ny * off;
        holds.pz = pT.z - nz * off;
        holds.plant = w > 0 ? wf / w : 0;
        // The leg's reach (the fixer): a hold past the thigh's and shin's length from the hip, the hip moved by the ball's
        // offset from the ankle, is let go of, so no leg is stretched past its length to stand on it.
        const ux = pB.x - pA.x;
        const uy = pB.y - pA.y;
        const uz = pB.z - pA.z;
        const vx = pC.x - pB.x;
        const vy = pC.y - pB.y;
        const vz = pC.z - pB.z;
        holds.reach = (Math.sqrt(ux * ux + uy * uy + uz * uz) + Math.sqrt(vx * vx + vy * vy + vz * vz)) * HOLD_REACH;
        holds.rx = pA.x + pT.x - pC.x;
        holds.ry = pA.y + pT.y - pC.y;
        holds.rz = pA.z + pT.z - pC.z;
        holds.step(2 + li);
        holds.reach = 0;
        wf = w * holds.w;
      }
      if (!(wf > 0)) continue;
      if (!preFree) this.feetOn++;
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
      if (holds) {
        // The ankle moved by the ball's way to its target (on the face: its hold, or where the clip has it), by its weight.
        q.tx = pC.x + (holds.tx - pT.x) * wf;
        q.ty = pC.y + (holds.ty - pT.y) * wf;
        q.tz = pC.z + (holds.tz - pT.z) * wf;
      } else if (pre) {
        // (Where the ankle stood before the legs were laid, onto the face as ever.)
        q.tx = pC.x + pN.x - nx * move;
        q.ty = pC.y + pN.y - ny * move;
        q.tz = pC.z + pN.z - nz * move;
      } else {
        q.tx = pC.x - nx * move;
        q.ty = pC.y - ny * move;
        q.tz = pC.z - nz * move;
      }
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
      else if (preFree) qM.copy(qC);
      else qM.copy(qX).multiply(qC);
      setBoneWorld(l.ankle, qM, qW);
    }
  }

  /**
   * Climbing II, phase 5: each foot with a target of its own (`foot`, `footTW`) put there: the ankle moved by the ball's way (the
   * toe's joint, else the ankle) to its target by its weight, the knee bent forward and out to its own side (a foot pinching a pole
   * from beside it), the ankle's world turn kept as the clip has it. The legs' clean pose kept for `restore`, as `placeFeet` keeps it.
   */
  private placeFeetAt(toPhys: THREE.Matrix4 | null): void {
    const legs = this.legs!;
    // The figure's own turn (its left +x, its front +z).
    boneIn(this.rig!.root, toPhys, pA, qR);
    for (let li = 0; li < 2; li++) {
      const l = legs[li];
      l.thighQ.copy(l.thigh.quaternion);
      l.shinQ.copy(l.shin.quaternion);
      l.ankleQ.copy(l.ankle.quaternion);
      const w = this.footTW[li];
      if (!(w > 0)) continue;
      boneIn(l.thigh.parent!, toPhys, sv, qP);
      boneIn(l.thigh, toPhys, pA, qA);
      boneIn(l.shin, toPhys, pB, qB);
      boneIn(l.ankle, toPhys, pC, qC);
      if (l.toe) boneIn(l.toe, toPhys, pT, qW);
      else pT.copy(pC);
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
      q.tx = pC.x + (this.foot[li * 3] - pT.x) * w1;
      q.ty = pC.y + (this.foot[li * 3 + 1] - pT.y) * w1;
      q.tz = pC.z + (this.foot[li * 3 + 2] - pT.z) * w1;
      // A straight leg's knee: forward and out to its own side (the left foot's +x). (Maker B: written into the vector's own fields,
      // never handed to `set`: a double chosen between two numbers and handed across a call the compiler left out is a number made,
      // 32 bytes a frame for the two legs, which a measure under load caught in every one of twelve processes.)
      sv.x = li === 0 ? 0.5 : -0.5;
      sv.y = 0;
      sv.z = 1;
      sv.applyQuaternion(qR);
      q.px = sv.x;
      q.py = sv.y;
      q.pz = sv.z;
      const o = this.out;
      solveTwoBone(q, o);
      this.turnLimb(l.thigh, l.shin, l.ankle, qP, qA, qB, qC, qB, o, false);
      // The ankle's world turn as the clip had it, under the shin's new one.
      qW.copy(qD2).multiply(qD1).multiply(qB);
      setBoneWorld(l.ankle, qC, qW);
    }
  }

  /** Climbing II, phase 5: each foot's ball now (0 left, 1 right; the toe's joint, else the ankle) in the physics frame, from the bones as they stand. */
  ballNow(rig: LimbRig, side: number, toPhys: THREE.Matrix4 | null, out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.limbsOf(rig) || !this.legs) return null;
    const l = this.legs[side];
    if (l.toe) boneIn(l.toe, toPhys, pT, qW);
    else boneIn(l.ankle, toPhys, pT, qW);
    return out.copy(pT);
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
    this.footTW[0] = 0;
    this.footTW[1] = 0;
    this.footFade = false;
    this.holds = null;
    this.pushKeep = 1;
    if (this.legs) for (const l of this.legs) l.toi = Number.NaN, (l.rx = Number.NaN), (l.w = 0), (l.last = Number.NaN);
  }

  /** What the console says. */
  report(): Record<string, unknown> {
    const n = (v: number) => Math.round(v * 1000) / 1000;
    // (Smoothness II, item 8: each hand's grip as drawn now against its place on the lip, metres; null for a hand not on one.)
    const grip: (number | null)[] = [null, null];
    if (this.rig) for (let s = 0; s < 2; s++) {
      const g = this.handW[s] > 0 ? this.gripNow(this.rig, s, null, new THREE.Vector3()) : null;
      if (g) grip[s] = n(Math.hypot(g.x - this.hand[s * 3], g.y - this.hand[s * 3 + 1], g.z - this.hand[s * 3 + 2]));
    }
    return { hands: [n(this.handW[0]), n(this.handW[1])], grip, wall: n(this.wallW), casts: this.casts, reused: this.reused, feetOn: this.feetOn };
  }
}
