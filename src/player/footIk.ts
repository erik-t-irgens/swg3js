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
  /**
   * The stairs wave: the stairs measured under the body (src/player/stairSense.ts, `StairSense.known` and the rest):
   * whether they stand, their way along the travel (+1 up), their tread and riser, how far ahead the next riser and how far
   * behind the last one stand from the body's middle (NaN for none), the tread's height the body stands on, and the
   * travel's way across the ground (a unit). What the hips' line on stairs and a swinging foot's clearance read.
   */
  stairKnown = false;
  stairWay = 0;
  stairTread = 0.5;
  stairRiser = 0.5;
  stairNext = 0.5;
  stairPrev = 0.5;
  stairFloor = 0.5;
  ux = 0.5;
  uz = 0.5;
  /**
   * One step a stair (src/anim/stairStep.ts): the stride's scale along the travel (each foot moved along it about the
   * body's middle by this less one of its place there, so a planted foot stays where it landed: 1 none), and how far a
   * swinging foot passes over a nosing at least (0 none).
   */
  stride = 1.5;
  clear = 0.5;
  /**
   * The point along the travel from the body's middle each foot is moved about by the stride (its stance's middle: `StairStep`'s
   * `pivotL` and `pivotR`), metres: 0 the body's middle.
   */
  pivotL = 0.5;
  pivotR = 0.5;
  /**
   * One step a stair: a foot planted whole is held where it was planted across the ground (its place along and across
   * kept from the frame its share reached whole, let go by its share as it lifts), so the clip's own uneven stance never
   * slides it along its tread. False none.
   */
  pin = false;

  constructor() {
    this.stride = 1;
    this.clear = 0;
    this.pivotL = 0;
    this.pivotR = 0;
  }
}

/** The little of the stairs' sampler the feet read (src/player/stairSense.ts's `StairSense`). */
export interface StairMeasure {
  readonly known: boolean;
  readonly way: number;
  readonly tread: number;
  readonly riser: number;
  readonly next: number;
  readonly prev: number;
  readonly floor: number;
  readonly ux: number;
  readonly uz: number;
}

/** The stairs wave: a frame's stairs from the sampler's measure, field by field (the stride and the clearance are the caller's). */
export function stairFeetOf(s: StairMeasure, fi: FootIn): void {
  fi.stairKnown = s.known;
  fi.stairWay = s.way;
  fi.stairTread = s.tread;
  fi.stairRiser = s.riser;
  fi.stairNext = s.next;
  fi.stairPrev = s.prev;
  fi.stairFloor = s.floor;
  fi.ux = s.ux;
  fi.uz = s.uz;
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
  /** The stairs wave: this frame's stride shift along the travel (x, z, metres), and the toe's point (radians: the heel up so the ball and toe meet a ground the stretched leg falls short of). */
  sx = 0.5;
  sz = 0.5;
  point = 0.5;
  /**
   * How far the clip's foot (turned to its ground) already stands on its ball: 0 on its heel or level, 1 with its ball
   * lower than its heel by `PIN_FLAT` or more. The share of `ik.toeReach` the hips' ask and the toe's point may take: a
   * foot striking with its heel cannot point its toe to reach, so its whole shortfall is the hips'.
   */
  lean = 0.5;
  /** The ankle to the ball as the clip turns the foot to its ground: its length, and its height (under nought: the ball under the ankle), metres. */
  ballR = 0.5;
  ballB = 0.5;
  /** How far the foot is drawn back along the travel to keep its toe short of an up flight's first riser (held while planted), and how far this frame would draw it, metres. */
  back = 0.5;
  backWant = 0.5;
  /** A stair clip's foot under the steady hips: the lowest its lower sole point has stood over the clip's ground this stance, metres (NaN: none yet). */
  low = 0.5;
  /** Where a planted foot is held across the ground (`FootIn.pin`), NaN for none; and the hold's offset from the clip's place, eased out once let go. */
  pinX = 0.5;
  pinZ = 0.5;
  pinOX = 0.5;
  pinOZ = 0.5;
  /** Which sole point the hold is on: 0 the middle (level), 1 the heel, 2 the ball. */
  pinOn = 0;
  constructor(thigh: THREE.Bone, shin: THREE.Bone, ankle: THREE.Bone, toe: THREE.Bone | null) {
    this.thigh = thigh;
    this.shin = shin;
    this.ankle = ankle;
    this.toe = toe;
    this.sx = 0;
    this.sz = 0;
    this.point = 0;
    this.lean = 0;
    this.ballR = 0;
    this.ballB = 0;
    this.back = 0;
    this.backWant = 0;
    this.low = Number.NaN;
    this.pinX = Number.NaN;
    this.pinZ = Number.NaN;
    this.pinOX = 0;
    this.pinOZ = 0;
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

/** Where the feet's rays are kept: a leg, or the body's middle (the stairs wave's hips). */
interface Probed {
  readonly probes: Probe[];
  readonly kept: Probe[];
  readonly next: Int32Array;
}

/** The body's middle's one ray (the ground the hips stand over), kept as a leg's are. */
class MidProbe implements Probed {
  readonly probes: Probe[] = [new Probe()];
  readonly kept: Probe[] = [];
  readonly next = new Int32Array(1);
  constructor() {
    for (let i = 0; i < KEPT; i++) this.kept.push(new Probe());
  }
}

/** How long a ring of the legs' asks the hips' hold keeps, frames (two seconds at 240 a second: `ik.hipHold`'s most). */
const HOLD_RING = 512;
/** A riser's own width along the travel, over which a swinging foot's clearance comes in before it (up) or goes after it (down), metres. */
const RISER_EASE = 0.06;
/** How many treads either way a swinging foot's ground is read over. */
const CLEAR_TREADS = 4;

/** A planted foot is held where it was planted from this share (whole), and held no further than this from the clip's place, metres. */
const PIN_FROM = 0.99;
const PIN_MOST = 0.12;
/** A foot stands on its middle while its heel and ball stand level in the clip within this, else on the lower, metres. */
const PIN_FLAT = 0.02;
/** A foot before an up flight is drawn back to stand this short of its first riser with its toe's tip, metres. */
const TOE_GAP = 0.02;
/** The hips held steady keep their line on measured stairs while the drawn root stands within a riser and this of it, metres. */
const HOP_SLACK = 0.1;

/** A leg's eased placement let go: unplanted, its ground forgotten (written in place: nothing is made). */
function letGo(leg: Leg): void {
  leg.planted = 0;
  leg.back = 0;
  leg.pinX = Number.NaN;
  leg.pinOX = 0;
  leg.pinOZ = 0;
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
  /**
   * The stairs wave, the hips held steady (`ik.hips` 'steady'): the ground the hips stand over (`line`, this frame's: the
   * ground under the body's middle, or on stairs the line through their treads' middles), followed as far as its own slope
   * gives and eased past that (`lineE`, NaN: taken outright next frame), with where it was last frame and how steep; the
   * drop the legs asked for this frame (`ask`), held (`held`, the most over `hipHold`) and eased (`legDrop`); and the
   * root's drop to the line (`base`). The console's and the tests'. (Declared as fractions.)
   */
  line = 0.5;
  lineE = 0.5;
  /** How far the root is put on the line (0 to 1), weighed in and out over `hipEase` as the feet are. */
  hipW = 0.5;
  legAsk = 0.5;
  held = 0.5;
  legDrop = 0.5;
  base = 0.5;
  private lineWas = 0.5;
  private lineSlope = 0.5;
  private lineX = 0.5;
  private lineZ = 0.5;
  private clock = 0.5;
  private readonly askT = new Float64Array(HOLD_RING);
  private readonly askV = new Float64Array(HOLD_RING);
  private askHead = 0;
  private askLen = 0;
  private readonly mid = new MidProbe();
  /** A swinging foot's clearance's question and answer (`clearAt`): the place along the travel from the body's middle, and the stairs' height there. */
  private envS = 0.5;
  private envOut = 0.5;
  /**
   * The foot planted furthest along the travel (`in.ux`, `in.uz`) this frame (0 left, 1 right, -1 none) and its ankle's
   * place along it from the body's middle, metres: what one step a stair keeps where it stands when it takes a stair clip on.
   */
  leadSide = -1;
  leadAt = 0.5;
  /** How far a swinging foot's ankle is lifted to clear the stairs this frame (`swingClear`'s and `planeLift`'s answer), metres. */
  private clearOut = 0.5;
  /** Whether last frame's legs were measured as a stair clip's (held through a hop of the capsule's under the steady hips). */
  private stairClipWas = false;
  /** Off measured stairs, the ground under the body's middle's plane (its normal), found this frame (`stepLine`). */
  private planeOk = false;
  private pnx = 0.5;
  private pny = 0.5;
  private pnz = 0.5;

  constructor(tune: LocoTune['ik'], makeRay: RayMaker) {
    this.tune = tune;
    this.makeRay = makeRay;
    this.weight = 0;
    this.drop = 0;
    this.applied = 0;
    this.line = Number.NaN;
    this.lineE = Number.NaN;
    this.lineWas = Number.NaN;
    this.lineSlope = 0;
    this.lineX = Number.NaN;
    this.lineZ = Number.NaN;
    this.legAsk = 0;
    this.held = 0;
    this.legDrop = 0;
    this.base = 0;
    this.hipW = 0;
    this.clock = 0;
    this.clearOut = 0;
    this.leadAt = 0;
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

  /** The hips' line and their held drop let go (`ik.hips` 'steady'): taken afresh next frame. */
  private letGoHips(): void {
    this.lineE = Number.NaN;
    this.lineWas = Number.NaN;
    this.lineX = Number.NaN;
    this.lineZ = Number.NaN;
    this.legAsk = 0;
    this.held = 0;
    this.legDrop = 0;
    this.base = 0;
    this.hipW = 0;
    this.askLen = 0;
  }

  /** Let go of everything eased: the body stood somewhere new. */
  reset(): void {
    this.weight = 0;
    this.drop = 0;
    this.mostE = Number.NaN;
    this.letGoHips();
    this.stairClipWas = false;
    if (this.legs) for (const leg of this.legs) {
      leg.lastX = Number.NaN;
      leg.lastZ = Number.NaN;
      letGo(leg);
    }
  }

  /**
   * The stairs wave (`ik.hips` 'steady'): the ground the hips stand over this frame (`line`): on stairs the sampler has
   * measured, the line through their treads' middles (the tread under the body, raised or lowered by the riser's share
   * of how near the next riser ahead or the last behind stands, within half a tread: so it meets each tread's own height at
   * the tread's middle and the floor beyond the flight); elsewhere the ground under the body's middle (one ray, kept as a
   * foot's are), else the capsule's feet. It is followed (`lineE`) as far as its own slope gives over how far the body went,
   * and whatever it changes by past that (a kerb's edge crossed, the stairs come onto) is eased in over `hipEase`. Never
   * the ground ahead. Reads `in` and the rays' reach in `qs` and `ql`.
   */
  private stepLine(world: FootWorld): void {
    const f = this.in;
    let g = Number.NaN;
    let slope = 0;
    const T = f.stairTread;
    if (f.stairKnown && f.stairWay !== 0 && T > 0) {
      const R = f.stairRiser;
      const half = T * 0.5;
      const a = f.stairNext === f.stairNext && f.stairNext < half ? half - f.stairNext : 0;
      const b = f.stairPrev === f.stairPrev && f.stairPrev < half ? half - f.stairPrev : 0;
      g = f.stairFloor + (f.stairWay * R * (a - b)) / T;
      slope = R / T;
      this.planeOk = false;
    } else {
      this.qx = f.px;
      this.qz = f.pz;
      this.planeOk = false;
      if (this.probe(world, this.mid, 0)) {
        const p = this.mid.probes[0];
        g = p.y;
        slope = p.ny > 0.05 ? Math.sqrt(p.nx * p.nx + p.nz * p.nz) / p.ny : 0;
        if (p.ny > 0.05) {
          this.planeOk = true;
          this.pnx = p.nx;
          this.pny = p.ny;
          this.pnz = p.nz;
        }
      } else g = f.py;
    }
    this.line = g;
    if (this.lineE !== this.lineE) this.lineE = g;
    else {
      const dx = f.px - this.lineX;
      const dz = f.pz - this.lineZ;
      let st = slope > this.lineSlope ? slope : this.lineSlope;
      if (st > SLOPE_FOLLOW) st = SLOPE_FOLLOW;
      const allow = Math.sqrt(dx * dx + dz * dz) * st + FOLLOW_SLACK;
      const d = g - this.lineWas;
      if (d <= allow && d >= -allow) this.lineE += d;
      const e = this.tune.hipEase;
      this.lineE += (g - this.lineE) * (e > 0 ? 1 - Math.exp(-f.dt / e) : 1);
    }
    this.lineWas = g;
    this.lineSlope = slope;
    this.lineX = f.px;
    this.lineZ = f.pz;
  }

  /**
   * The stairs wave (`ik.hips` 'steady'): the legs' ask held, the most of it over `hipHold` (a running most kept in a ring,
   * each ask by its moment), eased in over `hipEase` and out over `hipRelease`, never past `pelvisMost`; and the drop
   * (the root put on the line, and that).
   */
  private holdHips(): void {
    const tune = this.tune;
    const dt = this.in.dt;
    this.clock += dt;
    const now = this.clock;
    // Out of the ring's front what is older than the hold, off its back what the new ask outdoes, then the new ask in.
    while (this.askLen > 0 && this.askT[this.askHead] < now - tune.hipHold) {
      this.askHead = this.askHead + 1 === HOLD_RING ? 0 : this.askHead + 1;
      this.askLen--;
    }
    const v = this.legAsk > 0 ? this.legAsk : 0;
    while (this.askLen > 0) {
      let last = this.askHead + this.askLen - 1;
      if (last >= HOLD_RING) last -= HOLD_RING;
      if (this.askV[last] > v) break;
      this.askLen--;
    }
    if (this.askLen === HOLD_RING) {
      this.askHead = this.askHead + 1 === HOLD_RING ? 0 : this.askHead + 1;
      this.askLen--;
    }
    let at = this.askHead + this.askLen;
    if (at >= HOLD_RING) at -= HOLD_RING;
    this.askT[at] = now;
    this.askV[at] = v;
    this.askLen++;
    let held = this.askV[this.askHead];
    if (held > tune.pelvisMost) held = tune.pelvisMost;
    this.held = held;
    const e = held > this.legDrop ? tune.hipEase : tune.hipRelease;
    this.legDrop += (held - this.legDrop) * (e > 0 ? 1 - Math.exp(-dt / e) : 1);
    if (this.legDrop < 1e-6 && held === 0) this.legDrop = 0;
    this.drop = this.base + this.legDrop;
  }

  /**
   * The stairs wave: how far a swinging foot's ankle must rise for its heel and its toe's tip to pass over the stairs by
   * `clear` (`clearOut`), from the bend's ankle as the clip and the drop put it (`pC`, `qC`), moved by the stride.
   */
  private swingClear(leg: Leg, toPhys: THREE.Matrix4 | null): void {
    const f = this.in;
    const scale = this.scaleNow;
    let need = 0;
    vB.x = leg.heel.x * scale;
    vB.y = leg.heel.y * scale;
    vB.z = leg.heel.z * scale;
    vB.applyQuaternion(qC).add(pC);
    this.envS = (vB.x + leg.sx - f.px) * f.ux + (vB.z + leg.sz - f.pz) * f.uz;
    this.clearAt();
    let d = this.envOut + f.clear - vB.y;
    if (d > need) need = d;
    if (leg.toe) {
      boneIn(leg.toe, toPhys, cT, cTq);
      tipV.x = leg.tip.x * scale;
      tipV.y = leg.tip.y * scale;
      tipV.z = leg.tip.z * scale;
      tipV.applyQuaternion(cTq).add(cT);
      tipV.y -= this.drop;
      this.envS = (tipV.x + leg.sx - f.px) * f.ux + (tipV.z + leg.sz - f.pz) * f.uz;
      this.clearAt();
      d = this.envOut + f.clear - tipV.y;
      if (d > need) need = d;
    }
    this.clearOut = need;
  }

  /**
   * The hips held steady, off measured stairs: how far the ground under a swinging foot's heel and its toe's tip stands
   * over the ground under the body's middle, on that ground's plane (`clearOut`, never under nought; nought where no plane
   * was found). From the bend's ankle as the clip and the drop put it (`pC`, `qC`).
   */
  private planeLift(leg: Leg, toPhys: THREE.Matrix4 | null): void {
    let need = 0;
    if (this.planeOk) {
      const f = this.in;
      const scale = this.scaleNow;
      vB.x = leg.heel.x * scale;
      vB.y = leg.heel.y * scale;
      vB.z = leg.heel.z * scale;
      vB.applyQuaternion(qC).add(pC);
      let d = -(this.pnx * (vB.x - f.px) + this.pnz * (vB.z - f.pz)) / this.pny;
      if (d > need) need = d;
      if (leg.toe) {
        boneIn(leg.toe, toPhys, cT, cTq);
        tipV.x = leg.tip.x * scale;
        tipV.y = leg.tip.y * scale;
        tipV.z = leg.tip.z * scale;
        tipV.applyQuaternion(cTq).add(cT);
        d = -(this.pnx * (tipV.x - f.px) + this.pnz * (tipV.z - f.pz)) / this.pny;
        if (d > need) need = d;
      }
    }
    this.clearOut = need;
  }

  /**
   * The stairs' height at `envS` along the travel from the body's middle (`envOut`): the tread under the body, and each
   * riser within `CLEAR_TREADS` either way taking its rise in over `RISER_EASE` (before it going up, after it going down,
   * so the nosing is cleared and no height steps). Reads `in`'s measure of the stairs.
   */
  private clearAt(): void {
    const f = this.in;
    const s = this.envS;
    const T = f.stairTread;
    const R = f.stairRiser * f.stairWay;
    const up = f.stairWay > 0;
    let h = f.stairFloor;
    if (f.stairNext === f.stairNext) {
      for (let j = 0; j < CLEAR_TREADS; j++) {
        const r = f.stairNext + j * T;
        let c = up ? (s - r + RISER_EASE) / RISER_EASE : (s - r) / RISER_EASE;
        if (c <= 0) break;
        if (c > 1) c = 1;
        h += R * c;
      }
    }
    if (f.stairPrev === f.stairPrev) {
      for (let j = 0; j < CLEAR_TREADS; j++) {
        const r = -f.stairPrev - j * T;
        let c = up ? (r - s) / RISER_EASE : (r + RISER_EASE - s) / RISER_EASE;
        if (c <= 0) break;
        if (c > 1) c = 1;
        h -= R * c;
      }
    }
    this.envOut = h;
  }

  /** One ray down at (x, z) from `start` for `len`, or a kept answer: into the leg's probe `slot`. True where it met ground. */
  private probe(world: FootWorld, leg: Probed, slot: number): boolean {
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
    const wWas = this.weight;
    this.weight += (want - this.weight) * k;
    if (want === 0 && this.weight < 1e-3) this.weight = 0;
    this.leadSide = -1;
    if (!legs || !world || (this.weight === 0 && this.drop === 0)) {
      this.drop = 0;
      this.mostE = Number.NaN;
      if (this.lineE === this.lineE || this.legDrop !== 0) this.letGoHips();
      this.stairClipWas = false;
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
      for (const p of this.mid.kept) p.x = Number.NaN;
    }
    let W = this.weight;
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
    // The stairs wave: the hips held steady stand on the ground under the body's middle, or the stairs' line (`stepLine`),
    // which may put the root under the drawn one: the rays reach that much further (none under 'before').
    const steady = tune.hips === 'steady';
    let low = groundClip;
    // Whether the capsule is off the ground within a riser of the stairs' line this frame (a hop, held: below).
    let hop = false;
    if (steady) {
      this.qs = top;
      this.ql = top - (groundClip - most - PROBE_UNDER);
      this.stepLine(world);
      if (this.lineE < low) low = this.lineE;
      // Weighed as the feet are, but held on measured stairs while the capsule stays within a riser of their line, grounded
      // or not: climbing a tall riser at a high frame rate the capsule hops off the ground for a tenth of a second, and
      // weighed by the feet the root took the hop's share and rose 16 cm and fell back in a frame. A jump leaves the line
      // in a few frames and lets go as ever.
      const onStairs = f.stairKnown && f.stairWay !== 0;
      const hipWant = want === 1 || (tune.rule === 'placed' && onStairs && groundClip - this.lineE < f.stairRiser + HOP_SLACK) ? 1 : 0;
      // And let go over `hipEase` on measured stairs (the capsule's hop at a high frame rate can carry the drawn root past a
      // riser for a frame or two), the feet's own ease elsewhere (a jump off level ground lets go as ever).
      const hk = onStairs && hipWant < this.hipW && tune.hipEase > 0 ? 1 - Math.exp(-f.dt / tune.hipEase) : k;
      this.hipW += (hipWant - this.hipW) * hk;
      if (hipWant === 0 && this.hipW < 1e-3) this.hipW = 0;
      this.base = this.hipW * (groundClip - this.lineE);
      // And the feet keep their weight through such a hop as well, or they let go of the treads and sink into them by the
      // share let go while the hips stay on the line (8 cm, measured at 144 fps).
      hop = hipWant === 1 && want === 0 && tune.rule === 'placed';
      if (hop) {
        this.weight = wWas;
        W = wWas;
      }
      this.legAsk = 0;
    }
    const reach = top - (low - most - PROBE_UNDER);
    let need = 0;
    // Each foot's own ease (`ik.ease`): its share moves at most `rate` a frame (none to whole in `ease`), and the part of a
    // sudden change of its placement it has not yet let in decays by `decay` a frame.
    const rate = ease > 0 ? f.dt / ease : 2;
    const decay = 1 - k;
    // The stairs wave, the hips held steady: a stair clip's legs keep their measure through a frame or two the capsule is
    // off the ground (climbing a tall riser at a high frame rate it hops, and the caller's legs are not handed the clip
    // then): measured as a level clip for that frame, a foot planted whole read as swinging and let go in one frame.
    const stairClip = f.stairClip || (hop && this.stairClipWas);
    this.stairClipWas = stairClip;
    for (let s = 0; s < legs.length; s++) {
      const leg = legs[s];
      boneIn(leg.ankle, toPhys, pC, qC);
      // How planted the clip has it: by its height over its resting height; a stair clip's by how its ankle goes along
      // the figure's front under the body (back in stance, ahead in the swing), in the figure's own frame.
      const along = (pC.x - pA.x) * fx + (pC.z - pA.z) * fz;
      let want = 0;
      if (stairClip) {
        const v = leg.lastX === leg.lastX && f.dt > 0 ? (along - leg.lastX) / f.dt : 0;
        const lo = -tune.stairBack;
        const hi = tune.stairAhead;
        const u = hi > lo ? (v - lo) / (hi - lo) : v >= hi ? 1 : 0;
        want = u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
        if (steady) {
          // The hips held steady: and only while the clip keeps the foot down. A stair clip's foot still going back under
          // the body as the clip lifts it at the end of its stance (walking up two treads a step) was held planted and
          // drawn down to the tread it was leaving, 13 cm off it: its share goes as its lower sole point rises over the
          // lowest it stood at this stance by `soleLow` to `soleHigh`.
          sv.x = leg.heel.x * scale;
          sv.y = leg.heel.y * scale;
          sv.z = leg.heel.z * scale;
          sv.applyQuaternion(qC);
          const hy = sv.y;
          sv.x = leg.ball.x * scale;
          sv.y = leg.ball.y * scale;
          sv.z = leg.ball.z * scale;
          sv.applyQuaternion(qC);
          const h = pC.y + (hy < sv.y ? hy : sv.y) - groundClip;
          if (leg.planted < 0.01 || leg.low !== leg.low) leg.low = h;
          else if (h < leg.low) leg.low = h;
          const lo2 = tune.soleLow * scale;
          const hi2 = tune.soleHigh * scale;
          const u2 = hi2 > lo2 ? (h - leg.low - lo2) / (hi2 - lo2) : 0;
          const w2 = u2 <= 0 ? 1 : u2 >= 1 ? 0 : 1 - u2 * u2 * (3 - 2 * u2);
          if (w2 < want) want = w2;
        }
      } else if (steady) {
        // The stairs wave, the hips held steady: by the clip's lower sole point (its heel or its ball) over the clip's own
        // ground, within `soleLow` to `soleHigh`: a foot is planted as its clip puts it down. (The ankle's band below plants
        // a walk's foot from 4 cm up, and its middle swing too, both of which the steady hips could reach only by dropping
        // for good: a 9 cm crouch on flat ground, measured on the human male.)
        sv.x = leg.heel.x * scale;
        sv.y = leg.heel.y * scale;
        sv.z = leg.heel.z * scale;
        sv.applyQuaternion(qC);
        const hy = sv.y;
        sv.x = leg.ball.x * scale;
        sv.y = leg.ball.y * scale;
        sv.z = leg.ball.z * scale;
        sv.applyQuaternion(qC);
        const h = pC.y + (hy < sv.y ? hy : sv.y) - groundClip;
        // At the figure's size: the clip's own heights scale with it.
        const lo = tune.soleLow * scale;
        const hi = tune.soleHigh * scale;
        const u = hi > lo ? (h - lo) / (hi - lo) : h >= hi ? 1 : 0;
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
      // The stairs wave, one step a stair (`stride`): the foot moved along the travel about its stance's middle (`pivotL`,
      // `pivotR`) by the stride less one of its place there, so a planted foot stays where it landed while the body goes n
      // treads a step. Every point of the foot below (and its target in the bend) is the moved one; its planted measure
      // above is the clip's own.
      if (f.stride !== 1) {
        const at = (pC.x - pA.x) * f.ux + (pC.z - pA.z) * f.uz - (s === 0 ? f.pivotL : f.pivotR);
        const sh = (f.stride - 1) * at;
        leg.sx = sh * f.ux;
        leg.sz = sh * f.uz;
        pC.x += leg.sx;
        pC.z += leg.sz;
      } else {
        leg.sx = 0;
        leg.sz = 0;
      }
      // The stairs wave: before an up flight the sampler has measured, a foot whose toe's tip would stand over the first
      // riser (its heel on the floor short of it) is drawn back along the travel to stand `TOE_GAP` short of it, its share
      // of that kept while it stays planted and let go as it lifts: the walk puts its last foot down wherever its stride
      // falls, and standing with its tip on the first nosing it was lifted whole off the floor (12 cm for most of a second).
      // (Only a walk's foot: a stair clip's footfalls are put on the treads by the step, and its stance foot going back over
      // the riser line must not be taken for one short of it.)
      if (!stairClip && f.stairKnown && f.stairWay > 0 && f.stairNext === f.stairNext && f.stairPrev !== f.stairPrev && leg.toe) {
        sv.x = leg.heel.x * scale;
        sv.y = leg.heel.y * scale;
        sv.z = leg.heel.z * scale;
        sv.applyQuaternion(qC);
        const heelA = (pC.x + sv.x - f.px) * f.ux + (pC.z + sv.z - f.pz) * f.uz;
        boneIn(leg.toe, toPhys, cT, cTq);
        sv.x = leg.tip.x * scale;
        sv.y = leg.tip.y * scale;
        sv.z = leg.tip.z * scale;
        sv.applyQuaternion(cTq);
        const tipA = (cT.x + leg.sx + sv.x - f.px) * f.ux + (cT.z + leg.sz + sv.z - f.pz) * f.uz;
        const over = heelA < f.stairNext ? tipA + TOE_GAP - f.stairNext : 0;
        leg.backWant = over > 0 ? over : 0;
      } else leg.backWant = 0;
      if (leg.back !== 0 || leg.backWant !== 0) {
        if (leg.planted < PIN_FROM) {
          leg.back = leg.backWant > leg.back ? leg.backWant : leg.back * decay;
          if (leg.back < 1e-5) leg.back = 0;
        }
        const bx = leg.back * f.ux;
        const bz = leg.back * f.uz;
        leg.sx -= bx;
        leg.sz -= bz;
        pC.x -= bx;
        pC.z -= bz;
      }
      // And a foot planted whole held where its sole stands on its ground (`pin`): the point it stands on (its heel or its
      // ball, whichever the clip has lower, their middle while level) kept where it was when the foot came onto it, so the
      // clip's own uneven stance never slides it; as it lifts, the hold is eased out over `ik.ease` (last frame's share). A
      // hold already made goes on while the foot stays planted after the step lets go of the stairs (a flight's end, a
      // landing: the clip handed over under it), and only a step on the stairs makes a new one.
      if (f.pin || leg.pinX === leg.pinX || leg.pinOX !== 0 || leg.pinOZ !== 0) {
        sv.x = leg.heel.x * scale;
        sv.y = leg.heel.y * scale;
        sv.z = leg.heel.z * scale;
        sv.applyQuaternion(qC);
        const hx = sv.x;
        const hy = sv.y;
        const hz = sv.z;
        sv.x = leg.ball.x * scale;
        sv.y = leg.ball.y * scale;
        sv.z = leg.ball.z * scale;
        sv.applyQuaternion(qC);
        const on = hy - sv.y > PIN_FLAT ? 2 : sv.y - hy > PIN_FLAT ? 1 : 0;
        const px = pC.x + (on === 2 ? sv.x : on === 1 ? hx : (hx + sv.x) * 0.5);
        const pz = pC.z + (on === 2 ? sv.z : on === 1 ? hz : (hz + sv.z) * 0.5);
        if (leg.planted >= PIN_FROM && (f.pin || leg.pinX === leg.pinX)) {
          if (leg.pinX !== leg.pinX || on !== leg.pinOn) {
            // Held from here on (a foot rolling onto another point keeps the hold it had, from the new point).
            leg.pinX = px + leg.pinOX;
            leg.pinZ = pz + leg.pinOZ;
            leg.pinOn = on;
          }
          let ox = leg.pinX - px;
          let oz = leg.pinZ - pz;
          const ol = Math.sqrt(ox * ox + oz * oz);
          if (ol > PIN_MOST) {
            // Held no further than this from where the clip has it: past it the hold goes with the clip.
            ox *= PIN_MOST / ol;
            oz *= PIN_MOST / ol;
            leg.pinX = px + ox;
            leg.pinZ = pz + oz;
          }
          leg.pinOX = ox;
          leg.pinOZ = oz;
        } else {
          leg.pinX = Number.NaN;
          leg.pinOX *= decay;
          leg.pinOZ *= decay;
          if (leg.pinOX < 1e-5 && leg.pinOX > -1e-5 && leg.pinOZ < 1e-5 && leg.pinOZ > -1e-5) {
            leg.pinOX = 0;
            leg.pinOZ = 0;
          }
        }
        leg.sx += leg.pinOX;
        leg.sz += leg.pinOZ;
        pC.x += leg.pinOX;
        pC.z += leg.pinOZ;
      } else {
        leg.pinX = Number.NaN;
        leg.pinOX = 0;
        leg.pinOZ = 0;
      }
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
        if (leg.sx !== 0 || leg.sz !== 0) {
          cT.x += leg.sx;
          cT.z += leg.sz;
        }
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
      leg.lean = 0;
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
        if (leg.sx !== 0 || leg.sz !== 0) {
          pT.x += leg.sx;
          pT.z += leg.sz;
        }
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
      // How far the foot so turned already stands on its ball (the toe's reach is only for a foot off its heel).
      const lean = (vH.y - vB.y) / PIN_FLAT;
      leg.lean = lean <= 0 ? 0 : lean >= 1 ? 1 : lean;
      // And the ankle to the ball across the figure's front (how far it already hangs under the ankle, and its reach): how
      // much lower pointing the toe can still put the ball (nothing past straight under the ankle).
      const ba = (vB.x - pC.x) * fx + (vB.z - pC.z) * fz;
      const bb = vB.y - pC.y;
      leg.ballR = Math.sqrt(ba * ba + bb * bb);
      leg.ballB = bb;
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
      leg.planted = stairClip || leg.shareE < leg.clip ? leg.shareE : leg.clip;
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
        if (steady) {
          // The stairs wave (`ik.hips` 'steady'): how far the hips must drop for this leg, its hip put on the line, to reach
          // its ground stretched to `stretch` of its length with its toe pointed (`toeReach` of its foot made up, by the share
          // the clip's foot already stands on its ball: a heel striking asks its whole shortfall).
          boneIn(leg.thigh, toPhys, pB, qB);
          boneIn(leg.shin, toPhys, vH, qD1);
          const ax = pC.x - leg.sx;
          const az = pC.z - leg.sz;
          const l1 = Math.sqrt((vH.x - pB.x) * (vH.x - pB.x) + (vH.y - pB.y) * (vH.y - pB.y) + (vH.z - pB.z) * (vH.z - pB.z));
          const l2 = Math.sqrt((ax - vH.x) * (ax - vH.x) + (pC.y - vH.y) * (pC.y - vH.y) + (az - vH.z) * (az - vH.z));
          const hx = pC.x + app[1] - pB.x;
          const hz = pC.z + app[2] - pB.z;
          const h = Math.sqrt(hx * hx + hz * hz);
          let toeR = tune.toeReach * leg.footLen * scale;
          const left = leg.ballR + leg.ballB;
          if (left < toeR) toeR = left;
          const v = pB.y - this.base - (pC.y + app[0] + toeR * leg.lean);
          const sL = tune.stretch * (l1 + l2);
          const ask = (h >= sL ? v : v - Math.sqrt(sL * sL - h * h)) * (leg.planted < wantAll ? leg.planted : wantAll) * W;
          if (ask > this.legAsk) this.legAsk = ask;
        } else {
          const down = -app[0] * (leg.planted < wantAll ? leg.planted : wantAll) * W;
          if (down > need) need = down;
        }
      }
    }
    if (steady) this.holdHips();
    else {
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
    }
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
      // The stairs wave: moved along the stairs by the stride (`stride`), whatever its share planted.
      q.tx = leg.sx !== 0 || leg.sz !== 0 ? pC.x + leg.sx + app[1] * w : pC.x + app[1] * w;
      q.ty = pC.y + w * (drop + app[0]);
      q.tz = leg.sx !== 0 || leg.sz !== 0 ? pC.z + leg.sz + app[2] * w : pC.z + app[2] * w;
      // And a swinging foot lifted over the nosing it passes (`clear`), by its share not planted.
      if (f.clear > 0 && f.stairKnown && f.stairTread > 0 && w < 1) {
        this.swingClear(leg, toPhys);
        // The hips held steady: their held drop is a planted leg's, so a swinging foot is lifted by it as well (the higher).
        const rise = steady && this.legDrop > this.clearOut ? this.legDrop : this.clearOut;
        if (rise > 0) q.ty += rise * (1 - w);
      } else if (steady && w < 1) {
        // The hips held steady, off measured stairs: a swinging foot keeps the clip's own height over its ground, never
        // carried down by the drop a planted leg asked for, and lifted by as far as the ground under it stands over the
        // ground under the body's middle (that ground's plane: up a hill ahead, up behind going down one; never lowered).
        this.planeLift(leg, toPhys);
        const rise = this.legDrop + this.clearOut;
        if (rise > 0) q.ty += rise * (1 - w);
      }
      q.px = fx;
      q.py = 0;
      q.pz = fz;
      const o = this.out;
      solveTwoBone(q, o);
      // The foot planted furthest along the travel (the stairs' step keeps it where it stands when it takes a clip on).
      if (leg.planted >= PIN_FROM && leg.grounded) {
        const a = (o.ex - f.px) * f.ux + (o.ez - f.pz) * f.uz;
        if (this.leadSide < 0 || a > this.leadAt) {
          this.leadSide = s;
          this.leadAt = a;
        }
      }
      // The hips held steady: a planted foot the stretched leg falls short of points its toe (the heel up) so its ball meets
      // the ground, by as much as `toeReach` of the foot makes up: only a foot the clip already has on its ball (`lean`), since
      // pointing a heel-striking foot lifts its heel off the ground and leaves its ball over it.
      leg.point = 0;
      if (steady && w > 0 && o.short > 1e-4 && leg.lean > 0) {
        let gap = o.ey - q.ty;
        let allow = tune.toeReach * leg.footLen * scale;
        const left = leg.ballR + leg.ballB;
        if (left < allow) allow = left;
        allow *= leg.lean;
        if (gap > allow) gap = allow;
        // The turn that puts the ball `gap` lower about the ankle, from where the clip already has it (a foot already up on
        // its toes turns further for the same drop).
        const R = leg.ballR;
        if (gap > 0 && R > 1e-6) {
          const was = -leg.ballB / R;
          const now = was + gap / R;
          leg.point = (Math.asin(now >= 1 ? 1 : now) - Math.asin(was <= -1 ? -1 : was >= 1 ? 1 : was)) * w;
        }
      }
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
      if (app[3] !== 0 || app[4] !== 0 || leg.point !== 0) {
        const tp = leg.point !== 0 ? Math.tan(app[3] * w + leg.point) : Math.tan(app[3] * w);
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
      if (leg.toe && (app[5] !== 0 || leg.point !== 0)) {
        vAxis.x = rx;
        vAxis.y = 0;
        vAxis.z = rz;
        vAxis.applyQuaternion(qX);
        // A bend up (+) turns the toe's tip up: about the figure's right, which is minus (rx, rz). Three's
        // `setFromAxisAngle`, written out so no number crosses a call.
        // A foot pointed for the steady hips (`point`, the heel up) bends its toe back up by as much, so the toes keep their
      // place on the ground as the heel rises off it (held to `toeMost` in all).
      let tb = app[5] * w;
      if (leg.point !== 0) {
        tb += leg.point;
        const tm = tune.toeMost * DEG;
        if (tb > tm) tb = tm;
      }
      const half = -tb * 0.5;
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
      // The stairs wave: the hips held steady (the ground they stand over, eased; the root's drop onto it; the legs' ask, held and eased).
      hips: this.tune.hips,
      hipsLine: this.tune.hips === 'steady' ? { groundM: n(this.line), easedM: n(this.lineE), rootToLineM: n(this.base), legsAskM: n(this.legAsk), heldM: n(this.held), legsDropM: n(this.legDrop) } : null,
      stride: n(this.in.stride),
      legs: this.none ? 'this skeleton has no legs to place' : (this.legs ?? []).map((l, i) => ({ side: i === 0 ? 'left' : 'right', planted: n(l.planted), clip: n(l.clip), grounded: l.grounded, liftM: n(l.app[0]), easingM: n(Math.abs(l.off[0]) + this.scaleNow * (l.footLen * (Math.abs(l.off[3]) + Math.abs(l.off[4])) + l.toeLen * Math.abs(l.off[5])), 4), pullM: n(Math.sqrt(l.app[1] * l.app[1] + l.app[2] * l.app[2])), pitchDeg: n(l.app[3] / DEG, 1), rollDeg: n(l.app[4] / DEG, 1), toeDeg: n(l.app[5] / DEG, 1), pointDeg: n(l.point / DEG, 1), strideM: n(Math.sqrt(l.sx * l.sx + l.sz * l.sz)) })),
      casts: this.casts,
      reused: this.reused,
    };
  }
}
