// Wall climbing (wave 4 of the animations, item B; the owner's brief's line 159: "I am thinking we can use Climbing Up
// Wall.fbx and Climbing Down Wall.fbx for a Breath of the Wild-like wall climbing system that takes stamina").
//
// A face is climbable when it is steeper than wave 2b's climb limit (`LOCO_TUNE.slope.climb`: a walkable face is never
// climbed) and no steeper than upright (an overhang is refused), of what stands still only (the engine's own query flags:
// terrain and fixed or bodiless colliders; never a door, a vehicle, a loose prop, a creature or another player), and it
// goes on up past the hands (a wall lower than that is jumped and grabbed, item A's, never climbed). One class,
// `WallClimb`, holds the whole of it, stepped by the player's update and by the node harness alike
// (tools/swg/tests/grappleBody.ts), each at the very same two places beside the ledges':
//  - `sense`, after the move: W held into such a face, the move cut short by it (`LedgeIn.blocked`: only a body pressed
//    into something feels for a face, so walking free costs nothing), for `climb.wallStart` seconds, on the ground or in
//    the air, with stamina not tired and no crouch held: the body goes onto the wall, held off it by its capsule's skin,
//    turned to face it;
//  - `step`, in place of the movement while it is on the wall: W climbs up, S down, A and D sideways (no clip of its own:
//    the up clip slowed to the sideways speed's share of its stride; src/anim/wallClips.ts says how), each at
//    `climb.wallSpeed` along the face, the body held off the face at every place by two rays (its capsule's two spheres)
//    and moved only where a standing capsule is clear; reaching a lip it hands the body to the ledges as a braced hang
//    there (`LedgeHang.fromWall`), from which W still held climbs on up (the top-out); climbing down onto ground it stands;
//    the crouch key lets go, Space jumps off backward (`jump_from_wall`); stamina drains while on the wall
//    (`climb.wallStamina`), and an empty pool lets go.
// The figure is drawn against the body so its clip's own wall (src/anim/wallClips.ts) lies on the face: leant forward by
// the face's own lean (a 70-degree face leans the figure 20 degrees into it, about its feet), its origin moved along the
// face's normal, and its hands and feet put on the face by the two-bone solves (src/player/limbPlace.ts), each by how
// near the clip has it to its wall (a hand reaching for the next hold is the clip's own).
//
// Nothing here makes an object on a frame: every ask and answer is a kept record, and the engine's own answers (a ray's,
// a shape's) are the only things made, counted in `casts`.

import * as THREE from 'three';
import type { RAPIER } from '../core/physics.ts';
import { STILL_FLAGS } from './stairSense.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { LOCO_TUNE } from '../anim/locoTune.ts';
import { PALM_OFF, WALL_CLIPS, WALL_FACTS, WALL_PLANT, WALL_SIDE } from '../anim/wallClips.ts';
import { LEDGE_FACTS, LEDGE_JUMP_OFF, LEDGE_PUSH_OFF } from '../anim/ledgeClips.ts';
import { JKA, UNIT } from './jkaMove.ts';
import { LEDGE_CAPSULE, Lip, type LedgeBody, type LedgeHang, type LedgeIn, type LedgeMakers, type LedgeStamina, type LedgeWorld } from './ledge.ts';
import type { LimbPlace, LimbRig } from './limbPlace.ts';
import { ClimbHolds } from './climbHolds.ts';
import { isPoleCollider, type BarCollider } from './barShape.ts';

/** Off the wall, and on it. */
export const WALL_NONE = 0;
export const WALL_ON = 1;

/** The rig states the climb plays (and the wire carries): still, up, down, and the two sideways (the up clip, slowed). */
export const WALL_STATES = ['wallStill', 'wallUp', 'wallDown', 'wallLeft', 'wallRight'] as const;
export type WallState = (typeof WALL_STATES)[number];

/** Whether a rig state is the climb's (every one the peers' lists must know). */
export function isWallState(state: string): boolean {
  return (WALL_STATES as readonly string[]).includes(state);
}

/**
 * The clip a climb state plays, by the clip's id (still keeps whichever was playing, for a peer the up clip): sideways the
 * up clip, or under `climb.wallSide` 'shimmy' (Climbing II, item 6) the braced shimmy clip of that way.
 */
export function wallClipOf(state: string): string {
  if (CLIMB_TUNE.wallSide === 'shimmy') {
    if (state === 'wallLeft') return WALL_SIDE.left;
    if (state === 'wallRight') return WALL_SIDE.right;
  }
  return state === 'wallDown' ? WALL_CLIPS.down : WALL_CLIPS.up;
}

/**
 * The rate a climb state plays its clip at for a figure of size `s`: the climb's speed along the face over the clip's own
 * stride (src/anim/wallClips.ts), so the planted hands stay where they are on the face; nought held still.
 */
export function wallRateOf(state: string, s: number): number {
  const T = CLIMB_TUNE.wallSpeed;
  const k = s > 1e-6 ? s : 1;
  switch (state) {
    case 'wallUp':
      return T.up / (WALL_FACTS[WALL_CLIPS.up].stride * k);
    case 'wallDown':
      return T.down / (WALL_FACTS[WALL_CLIPS.down].stride * k);
    case 'wallLeft':
    case 'wallRight':
      // Climbing II, item 6: the braced shimmy clips at the sideways speed over their own pace.
      if (CLIMB_TUNE.wallSide === 'shimmy') return T.side / (SIDE_PACE * k);
      return T.side / (WALL_FACTS[WALL_CLIPS.up].stride * k);
    default:
      return 0;
  }
}

/** The bottom sphere's middle over the feet, and the top's (the standing capsule's, metres). */
const LOW = LEDGE_CAPSULE.r;
const HIGH = LEDGE_CAPSULE.r + 2 * LEDGE_CAPSULE.stand;
/** Where the start feels for a face (the chest) and for the wall going on (the clip's hands' middle height), over the feet on the human male. */
const CHEST = 1.0;
const HANDS_UP = 1.8;
/** How far over the feet the room test stands its capsule, metres: a body at the foot of a face touches its floor. */
const LIFT = 0.05;
/** How far beyond the capsule's skin the start feels ahead for a face, metres. */
const FEEL = 0.45;
/** The capsule held this far off the face beyond its radius, metres: a skin, so the controller never starts a move inside it. */
const GAP = 0.02;
/** A face leaning out past upright by this (its normal's downward share) is still upright: a trimesh's upright face reads a hair either way. */
const UPRIGHT_SLACK = 0.035;
/** A hand moved less than this since its last ray reads the same face, metres. */
const SAME = 0.005;
/** Smoothness II, item 5: the seek's step down, across and in, metres (mechanics: 3 cm, a finger's width under the 2 cm the hands are held to). */
const GRIP_STEP = 0.03;
/** Smoothness II, item 5: how much nearer a grip in over the top is taken to be than its distance (mechanics: 5 cm, so a top within reach wins over a face just as near, the owner's "deeper in"). */
const GRIP_TOP_FAVOUR = 0.05;
/** Ground under the feet within this much more than a frame's climb down ends the climb standing, metres. */
const FOOT_GROUND = 0.06;
/**
 * How quickly the face the figure is drawn against follows the face the rays find, seconds (an exponential's time): a
 * terrain face's triangles turn the normal in steps, which drawn at once would twitch the figure.
 */
const FACE_EASE = 0.1;
/** How far over the braced hang's own grip a lip ahead is looked for, metres on the human male (a little more than a frame's climb at any speed). */
const LOOK_UP = 0.3;
const TAU = Math.PI * 2;
/** The up clip's hips, and the two clips' strides, read once (src/anim/wallClips.ts). */
const UP_HIPS = WALL_FACTS[WALL_CLIPS.up].hips;
const UP_STRIDE = WALL_FACTS[WALL_CLIPS.up].stride;
const DOWN_STRIDE = WALL_FACTS[WALL_CLIPS.down].stride;
/**
 * Climbing II, item 6: the braced shimmy clips' own pace (their hands' travel along the lip a second, the human male's), their
 * grip points at their start (lined up a palm off the face, at the up clip's hands' mean height: src/anim/wallClips.ts).
 */
const SIDE_PACE = Math.abs(LEDGE_FACTS[WALL_SIDE.right].net[0]) / LEDGE_FACTS[WALL_SIDE.right].dur;
const SIDE_L_G = LEDGE_FACTS[WALL_SIDE.left].g0;
const SIDE_R_G = LEDGE_FACTS[WALL_SIDE.right].g0;
const UP_HANDS = WALL_FACTS[WALL_CLIPS.up].hands;

export class WallClimb {
  /** `WALL_NONE` or `WALL_ON`. */
  phase = WALL_NONE;
  /** Seconds W has been held into a climbable face (the start's clock). */
  press = 0.5;
  /** The heading the figure faces the face at, radians. */
  heading = 0.5;
  /** The face: a point on it (at the top sphere's height) and its outward normal (unit), its level part's unit and length. */
  px = 0.5;
  py = 0.5;
  pz = 0.5;
  nx = 0.5;
  ny = 0.5;
  nz = 0.5;
  lx = 0.5;
  lz = 0.5;
  hl = 0.5;
  /** The face the figure is drawn against, eased toward the one found (`FACE_EASE`). */
  dnx = 0.5;
  dny = 0.5;
  dnz = 0.5;
  /** The climb's loop for the rig (and the wire), its clip id and its rate: '' while off the wall. */
  rigState = '';
  rigClip = '';
  rate = 0.5;
  /** A one-off to begin this frame (the jump off), from this far in, faded in over `startFade`: consumed by the caller. */
  startClip = '';
  startFrom = 0.5;
  startFade = 0.5;
  /** Where the figure's own origin is drawn against the body's, in the world's frame (metres), and how far it leans into the face (radians). */
  offX = 0.5;
  offY = 0.5;
  offZ = 0.5;
  lean = 0.5;
  /** How much the hands and feet are placed on the face (0 to 1, eased over `climb.ease`). */
  hands = 0.5;
  /** Words for the message line, or '' (consumed by the caller). */
  said = '';
  /** A heading the caller turns the body to once `turnIn` runs out (the jump off's own turn round), NaN for none; and the turn this frame (`tick`). */
  turnTo = Number.NaN;
  turnIn = 0.5;
  turnNow = 0.5;
  /** The climb down ended on the ground this frame (the body stands), or the ledge took the body at a lip. */
  stood = false;
  toLedge = false;
  /** Metres the body moved along the face this frame (the tests'). */
  moved = 0.5;
  /** Rays and shape tests asked of the engine, climbs begun, and why the last ended (the console's and the tests'). */
  casts = 0;
  climbs = 0;
  lastLetGo = '';
  /** The lip a climb up looks out for (the ledges' own). */
  readonly lip = new Lip();
  /** Climbing II, item 6 (`climb.wallLimbs` 'held'): each hand's and foot's hold on the face until its next reach (src/player/climbHolds.ts). */
  readonly holds = new ClimbHolds();
  private readonly makers: LedgeMakers;
  private ray: RAPIER.Ray | null = null;
  private shape: RAPIER.Shape | null = null;
  private readonly shapeAt = { x: 0, y: 0, z: 0 };
  private readonly shapeRot = { x: 0, y: 0, z: 0, w: 1 };
  /** The probe's place, direction, length and groups (fields, so nothing crosses a call), and its answer. */
  private qx = 0.5;
  private qy = 0.5;
  private qz = 0.5;
  private qdx = 0.5;
  private qdy = 0.5;
  private qdz = 0.5;
  private qlen = 0.5;
  private qflt = 0.5;
  private hx = 0.5;
  private hy = 0.5;
  private hz = 0.5;
  private hnx = 0.5;
  private hny = 0.5;
  private hnz = 0.5;
  private htoi = 0.5;
  /** The last look for a lip up the face: whether one was found, its height and the hang's place under it, and whether the hang there was refused (no room). */
  lipFound = false;
  lipY = 0.5;
  lipHang = 0.5;
  lipRefused = false;
  /** Held against the face with a way asked that it cannot go (said once until it moves or the keys let go). */
  private stalled = false;
  /** Why the last move asked was refused (the console's): no climbable face at the new place, or no room for the body there. */
  stallWhy = '';
  /** The place, the groups and the reach `standOff` and `groundUnder` are asked about (fields, so no number crosses a call). */
  private ax = 0.5;
  private ay = 0.5;
  private az = 0.5;
  private af = 0.5;
  private areach = 0.5;
  /** The held-off place worked out last (`standOff`), the ground found under the feet (`groundUnder`). */
  private bx = 0.5;
  private bz = 0.5;
  private gy = 0.5;
  /** The drawn offset's fade between two clips' line-ups: where it was, how far the fade has got. */
  private ofX = 0.5;
  private ofY = 0.5;
  private ofZ = 0.5;
  private fadeT = 0.5;
  /** After a let-go, the offset and the lean eased out over this long more (seconds left, the whole, the lean it began at). */
  private outT = 0.5;
  private outDur = 0.5;
  private leanFrom = 0.5;
  /** The figure's size, kept from the start. */
  private s = 0.5;
  /** Each hand's kept ray: its origin, the face it found (point and normal), whether it found one. */
  private readonly handRay = new Float64Array(14);
  private readonly handOk = [false, false];
  /** Each hand's face normal under it (left 0..2, right 3..5), kept with its ray. */
  private readonly handN = new Float64Array(6);

  constructor(makers: LedgeMakers) {
    this.makers = makers;
    // Fields that will hold fractions start as one (wave 2a's lesson) and are put to nought here.
    this.press = 0;
    this.heading = 0;
    this.px = 0;
    this.py = 0;
    this.pz = 0;
    this.nx = 0;
    this.ny = 0;
    this.nz = 1;
    this.lx = 0;
    this.lz = 1;
    this.hl = 1;
    this.dnx = 0;
    this.dny = 0;
    this.dnz = 1;
    this.rate = 0;
    this.startFrom = 0;
    this.startFade = 0;
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.lean = 0;
    this.hands = 0;
    this.turnIn = 0;
    this.turnNow = 0;
    this.moved = 0;
    this.hx = 0;
    this.hy = 0;
    this.hz = 0;
    this.hnx = 0;
    this.hny = 0;
    this.hnz = 0;
    this.htoi = 0;
    this.lipY = Number.NaN;
    this.lipHang = Number.NaN;
    this.ax = 0;
    this.ay = 0;
    this.az = 0;
    this.af = 0;
    this.areach = 0;
    this.bx = 0;
    this.bz = 0;
    this.gy = 0;
    this.lifted = 0;
    this.ofX = 0;
    this.ofY = 0;
    this.ofZ = 0;
    this.fadeT = 1;
    this.outT = 0;
    this.outDur = 0;
    this.leanFrom = 0;
    this.s = 1;
    this.handRay.fill(Number.NaN);
  }

  /** On the wall: the climb has the body in place of the movement. */
  get holding(): boolean {
    return this.phase !== WALL_NONE;
  }

  /** The figure is drawn off the body's place (on the wall, or easing back after a let-go). */
  get drawn(): boolean {
    return this.offX !== 0 || this.offY !== 0 || this.offZ !== 0 || this.lean !== 0;
  }

  /** Let go of everything at once, with no fall of its own and no ease (a reset, a travel, a death): `why` for the console. */
  reset(why = 'reset'): void {
    if (this.phase !== WALL_NONE) this.lastLetGo = why;
    this.phase = WALL_NONE;
    this.press = 0;
    this.rigState = '';
    this.rigClip = '';
    this.startClip = '';
    this.hands = 0;
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.lean = 0;
    this.outT = 0;
    this.turnTo = Number.NaN;
    this.stood = false;
    this.toLedge = false;
    this.handRay.fill(Number.NaN);
    this.holds.reset();
  }

  // ---- the engine's two questions ------------------------------------------------------------------------------------------

  /** One ray from (q) along (qd) for `qlen` into `h*` (the still family only). */
  private cast(world: LedgeWorld): boolean {
    let ray = this.ray;
    if (!ray) ray = this.ray = this.makers.ray();
    ray.origin.x = this.qx;
    ray.origin.y = this.qy;
    ray.origin.z = this.qz;
    ray.dir.x = this.qdx;
    ray.dir.y = this.qdy;
    ray.dir.z = this.qdz;
    this.casts++;
    const h = world.castRayAndGetNormal(ray, this.qlen, true, STILL_FLAGS, this.qflt);
    if (!h) return false;
    // (Climbing II, phase 5: a pole, `climb.poles` 'on', is grabbed and climbed as a pole, never as a face. Under 'off' not asked.)
    if (CLIMB_TUNE.poles === 'on' && isPoleCollider(h.collider as unknown as BarCollider)) return false;
    const t = h.timeOfImpact;
    this.htoi = t;
    this.hx = this.qx + this.qdx * t;
    this.hy = this.qy + this.qdy * t;
    this.hz = this.qz + this.qdz * t;
    this.hnx = h.normal.x;
    this.hny = h.normal.y;
    this.hnz = h.normal.z;
    return true;
  }

  /** Smoothness II, item 5: whether each hand's hold is one `seekGrip` found (1), and the seeks made (the console's). */
  private readonly handSeek = new Uint8Array(2);
  seeks = 0;
  /** The best grip a seek has found so far (its place, its surface's normal, how far it is from the hand). */
  private sgx = 0.5;
  private sgy = 0.5;
  private sgz = 0.5;
  private sgnx = 0.5;
  private sgny = 0.5;
  private sgnz = 0.5;
  private sgd = 0.5;

  /** A ray's hit (`cast`) taken as the seek's grip where it is nearer the hand at (x, y, z) than the best so far. */
  private takeGrip(x: number, y: number, z: number, top: boolean): void {
    const dx = this.hx - x;
    const dy = this.hy - y;
    const dz = this.hz - z;
    // A grip in over the top is the nearest wherever the top is within reach (the owner's "grab ... deeper in").
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - (top ? GRIP_TOP_FAVOUR : 0);
    if (!(d < this.sgd)) return;
    this.sgd = d;
    this.sgx = this.hx;
    this.sgy = this.hy;
    this.sgz = this.hz;
    this.sgnx = this.hnx;
    this.sgny = this.hny;
    this.sgnz = this.hnz;
  }

  /**
   * Smoothness II, item 5 (`climb.wallHands` 'grip'): a hand at (x, y, z) with no face under it: the nearest real grip within
   * `gripSeek` (scaled with the figure): down the face (a ray into it every `GRIP_STEP` lower), sideways along it either way,
   * and in over the top (a ray down onto it a little in from the face, every step higher than the hand's own): a face's grip
   * where the ray meets one turned toward the hand, the top's where a walkable top is met. Into `hx..`, `hnx..` as `cast`'s
   * answer; false where none is.
   */
  private seekGrip(world: LedgeWorld, x: number, y: number, z: number, flt: number, s: number): boolean {
    const most = CLIMB_TUNE.gripSeek * (s > 0.2 ? s : 1);
    if (!(most > 0)) return false;
    const nx = this.nx;
    const ny = this.ny;
    const nz = this.nz;
    // The face's own up (the world's up less its share along the face's normal) and its across.
    let ux = -nx * ny;
    let uy = 1 - ny * ny;
    let uz = -nz * ny;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (!(ul > 1e-6)) return false;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const ax = ny * uz - nz * uy;
    const ay = nz * ux - nx * uz;
    const az = nx * uy - ny * ux;
    this.sgd = Infinity;
    this.qflt = flt;
    const n = Math.ceil(most / GRIP_STEP);
    for (let i = 1; i <= n; i++) {
      const k = (most * i) / n;
      // Down the face, and sideways either way: a ray into the face from in front of the hand moved there.
      for (let w = 0; w < 3; w++) {
        const ex = w === 0 ? -ux : w === 1 ? ax : -ax;
        const ey = w === 0 ? -uy : w === 1 ? ay : -ay;
        const ez = w === 0 ? -uz : w === 1 ? az : -az;
        this.qx = x + ex * k + nx * 0.3;
        this.qy = y + ey * k + ny * 0.3;
        this.qz = z + ez * k + nz * 0.3;
        this.qdx = -nx;
        this.qdy = -ny;
        this.qdz = -nz;
        this.qlen = 0.6;
        if (this.cast(world) && this.hnx * nx + this.hny * ny + this.hnz * nz > 0.5) this.takeGrip(x, y, z, false);
      }
      // In over the top: a ray down onto it, a step in from the face and from over the hand's own height.
      this.qx = x - nx * k;
      this.qy = y + 0.3;
      this.qz = z - nz * k;
      this.qdx = 0;
      this.qdy = -1;
      this.qdz = 0;
      this.qlen = 0.3 + most;
      if (this.cast(world) && this.hny > 0.7) this.takeGrip(x, y, z, true);
      if (this.sgd < k) break;
    }
    if (!(this.sgd < Infinity)) return false;
    this.hx = this.sgx;
    this.hy = this.sgy;
    this.hz = this.sgz;
    this.hnx = this.sgnx;
    this.hny = this.sgny;
    this.hnz = this.sgnz;
    return true;
  }

  /** Whether a standing capsule with its feet at (q) is clear of what stands still. */
  private clear(world: LedgeWorld): boolean {
    let shape = this.shape;
    if (!shape) shape = this.shape = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r);
    const at = this.shapeAt;
    at.x = this.qx;
    // A hair over the feet: a body standing at the foot of the face touches its floor.
    at.y = this.qy + LIFT + LEDGE_CAPSULE.r + LEDGE_CAPSULE.stand;
    at.z = this.qz;
    this.casts++;
    return world.intersectionWithShape(at, this.shapeRot, shape, STILL_FLAGS, this.qflt) === null;
  }

  /**
   * The last hit is a climbable face (steeper than walkable, not overhanging) facing back along the ray's own level way
   * (`qdx`, `qdz`, unit) by at least half (read from the fields: a number handed across a call is a number made).
   */
  private climbable(): boolean {
    const dx = this.qdx;
    const dz = this.qdz;
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    const ny = this.hny;
    if (!(ny < walk) || ny < -UPRIGHT_SLACK) return false;
    const hl = Math.sqrt(this.hnx * this.hnx + this.hnz * this.hnz);
    if (!(hl > 1e-6)) return false;
    return -(this.hnx * dx + this.hnz * dz) / hl >= 0.5;
  }

  /** The last hit taken as the face: its point and normal kept, its level part made unit. */
  private takeFace(): void {
    let ny = this.hny;
    if (ny < 0) ny = 0;
    const hl = Math.sqrt(this.hnx * this.hnx + this.hnz * this.hnz);
    this.px = this.hx;
    this.py = this.hy;
    this.pz = this.hz;
    this.nx = this.hnx;
    this.ny = this.hny;
    this.nz = this.hnz;
    this.lx = this.hnx / hl;
    this.lz = this.hnz / hl;
    this.hl = hl;
    void ny;
  }

  /**
   * The body's place held off the face at (x, y, z): its capsule's two spheres each felt for along the face's level normal
   * (two rays), the place moved along it until the nearer stands `GAP` beyond its radius off the face, into `bx/bz`; the
   * face taken from the upper sphere's ray (else the lower's). False where neither finds a climbable face (its edge, or its
   * top with nothing over it).
   */
  private standOff(world: LedgeWorld): boolean {
    const x = this.ax;
    const y = this.ay;
    const z = this.az;
    const s = this.s;
    const flt = this.af;
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    const lx = this.lx;
    const lz = this.lz;
    const need = LEDGE_CAPSULE.r + GAP;
    this.qflt = flt;
    this.qdx = -lx;
    this.qdy = 0;
    this.qdz = -lz;
    this.qlen = 1.5 * s + 0.5;
    let m = Number.NEGATIVE_INFINITY;
    let any = false;
    // The top sphere first: its face is the one the figure is drawn against.
    this.qx = x;
    this.qy = y + HIGH;
    this.qz = z;
    if (this.cast(world) && this.hny < walk && this.hny >= -UPRIGHT_SLACK) {
      const c = this.hnx * lx + this.hnz * lz;
      if (c > 0.3) {
        m = need / c - this.htoi;
        this.takeFace();
        any = true;
      }
    }
    this.qx = x;
    this.qy = y + LOW;
    this.qz = z;
    if (this.cast(world) && this.hny < walk) {
      const c = this.hnx * lx + this.hnz * lz;
      if (c > 0.3) {
        const mb = need / c - this.htoi;
        if (mb > m) m = mb;
        if (!any) this.takeFace();
        any = true;
      }
    }
    if (!any) return false;
    this.bx = x + lx * m;
    this.bz = z + lz * m;
    return true;
  }

  /** Walkable ground under feet at (x, y, z) within `reach`, its height into `gy`. One ray. */
  private groundUnder(world: LedgeWorld): boolean {
    const x = this.ax;
    const y = this.ay;
    const z = this.az;
    const reach = this.areach;
    const flt = this.af;
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    this.qflt = flt;
    this.qx = x;
    this.qy = y + 0.05;
    this.qz = z;
    this.qdx = 0;
    this.qdy = -1;
    this.qdz = 0;
    this.qlen = reach + 0.05;
    if (!this.cast(world) || this.hny < walk) return false;
    this.gy = this.hy;
    return true;
  }

  // ---- the start ---------------------------------------------------------------------------------------------------------

  /**
   * After the move (beside the ledges' grab): whether the body goes onto a wall this frame. On the start the body is held
   * from here (`holding`), its velocity put down, turned to the face. False otherwise.
   */
  sense(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina): boolean {
    const T = CLIMB_TUNE;
    if (T.wall !== 'on' || this.phase !== WALL_NONE) {
      this.press = 0;
      return false;
    }
    // Climbing II, item 1: under 'use' the climb starts on the use key handed to the climb (held), at once and with no W or
    // pressing into the face; rising it waits (a lip may yet come into the hands' reach, which the ledges take first: the
    // jump's own first frames still read grounded); 'auto' is today's (W held into a face the move was cut short by, for
    // `climb.wallStart`).
    const use = T.grab === 'use';
    if (use) {
      if (i.busy || stam.tired || i.crouchHeld || !i.use || b.vel.y > 0) {
        this.press = 0;
        return false;
      }
    } else if (i.busy || stam.tired || i.crouchHeld || !i.forwardHeld || !i.blocked) {
      this.press = 0;
      return false;
    }
    // In the air with Jedi Academy's own wall move open to the body, the wall is the Force's (its rebound keeps its trigger).
    if (!i.grounded && i.airWallMove) {
      this.press = 0;
      return false;
    }
    let dx = i.moveX;
    let dz = i.moveZ;
    let dl = Math.sqrt(dx * dx + dz * dz);
    if (!(dl > 1e-6)) {
      if (!use) {
        this.press = 0;
        return false;
      }
      // On the use key with no way pushed: the way the body faces.
      dx = Math.sin(i.heading);
      dz = Math.cos(i.heading);
      dl = 1;
    }
    dx /= dl;
    dz /= dl;
    const s = i.scale;
    this.qflt = i.filter;
    this.qdx = dx;
    this.qdy = 0;
    this.qdz = dz;
    // The face at the chest, and the wall going on up past the hands (a low wall is jumped and grabbed, never climbed). A
    // face leaning back stands further off the higher it is looked for: the chest's ray reaches as far as a face at the climb
    // limit stands there behind the capsule's foot (the fix round's: a 58-degree face stood past its old reach), and the
    // hands' ray as far as the face the chest found stands at their height by its own lean, and a little more.
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    const lean = Math.sqrt(1 - walk * walk);
    const chestReach = LEDGE_CAPSULE.r / lean + ((CHEST * s - LEDGE_CAPSULE.r) * walk) / lean + 0.05;
    this.qx = b.pos.x;
    this.qy = b.pos.y + CHEST * s;
    this.qz = b.pos.z;
    this.qlen = chestReach > LEDGE_CAPSULE.r + FEEL ? chestReach : LEDGE_CAPSULE.r + FEEL;
    if (!this.cast(world) || !this.climbable()) {
      this.press = 0;
      return false;
    }
    this.takeFace();
    // The chest's face's own run back a metre up (its normal's rise over its level part: nought upright).
    const run = this.hl > 1e-6 && this.ny > 0 ? this.ny / this.hl : 0;
    const handsReach = this.htoi + (HANDS_UP - CHEST) * s * run + 0.5;
    this.qy = b.pos.y + HANDS_UP * s;
    this.qlen = handsReach > LEDGE_CAPSULE.r + FEEL + 0.5 ? handsReach : LEDGE_CAPSULE.r + FEEL + 0.5;
    if (!this.cast(world) || !this.climbable()) {
      this.press = 0;
      return false;
    }
    if (!use) {
      this.press += i.dt;
      if (this.press < T.wallStart) return false;
    }
    this.press = 0;
    // Onto the wall: held off the face, where a standing capsule fits.
    this.s = s;
    this.ax = b.pos.x;
    this.ay = b.pos.y;
    this.az = b.pos.z;
    this.af = i.filter;
    if (!this.standOff(world)) return false;
    this.qx = this.bx;
    this.qy = b.pos.y;
    this.qz = this.bz;
    if (!this.clear(world)) return false;
    // On the use key from a step off the face: the figure drawn on from where it stood, eased onto the wall.
    if (use) {
      this.offX = b.pos.x - this.bx;
      this.offZ = b.pos.z - this.bz;
    }
    b.pos.x = this.bx;
    b.pos.z = this.bz;
    b.vel.x = 0;
    b.vel.y = 0;
    b.vel.z = 0;
    this.s = s;
    this.phase = WALL_ON;
    this.heading = Math.atan2(-this.lx, -this.lz);
    this.dnx = this.nx;
    this.dny = this.ny;
    this.dnz = this.nz;
    this.rigClip = WALL_CLIPS.up;
    this.rigState = 'wallStill';
    this.rate = 0;
    this.hands = 0;
    this.outT = 0;
    this.turnTo = Number.NaN;
    this.stood = false;
    this.toLedge = false;
    this.handRay.fill(Number.NaN);
    this.holds.reset();
    // The drawn figure from where it stands (its offset nought, upright) into the climb's line-up over `climb.ease`.
    this.beginFade();
    this.climbs++;
    return true;
  }

  /**
   * Climbing II, item 1: whether the use key would start the climb now (the action bar's "climb", gathered a few times a
   * second): a climbable face at the chest the way the keys push or the body faces, going on up past the hands, as the start
   * asks; nothing begun. Two rays.
   */
  canClimb(world: LedgeWorld, b: LedgeBody, i: LedgeIn): boolean {
    if (CLIMB_TUNE.wall !== 'on' || this.phase !== WALL_NONE || i.busy) return false;
    let dx = i.moveX;
    let dz = i.moveZ;
    let dl = Math.sqrt(dx * dx + dz * dz);
    if (!(dl > 1e-6)) {
      dx = Math.sin(i.heading);
      dz = Math.cos(i.heading);
      dl = 1;
    }
    const s = i.scale;
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    const lean = Math.sqrt(1 - walk * walk);
    const chestReach = LEDGE_CAPSULE.r / lean + ((CHEST * s - LEDGE_CAPSULE.r) * walk) / lean + 0.05;
    this.qflt = i.filter;
    this.qdx = dx / dl;
    this.qdy = 0;
    this.qdz = dz / dl;
    this.qx = b.pos.x;
    this.qy = b.pos.y + CHEST * s;
    this.qz = b.pos.z;
    this.qlen = chestReach > LEDGE_CAPSULE.r + FEEL ? chestReach : LEDGE_CAPSULE.r + FEEL;
    if (!this.cast(world) || !this.climbable()) return false;
    const run = this.hny > 0 ? this.hny / Math.sqrt(this.hnx * this.hnx + this.hnz * this.hnz) : 0;
    const handsReach = this.htoi + (HANDS_UP - CHEST) * s * run + 0.5;
    this.qy = b.pos.y + HANDS_UP * s;
    this.qlen = handsReach > LEDGE_CAPSULE.r + FEEL + 0.5 ? handsReach : LEDGE_CAPSULE.r + FEEL + 0.5;
    return this.cast(world) && this.climbable();
  }

  // ---- a frame on the wall -------------------------------------------------------------------------------------------------

  /**
   * In place of the movement while `holding`: the keys, the stamina, the climb along the face, a lip handed to the ledges,
   * the ground at the foot, and the body's place written into `b.pos`. Answers false the frame the body leaves the wall
   * (let go, jumped off, stood on the ground, or taken by the ledges: `toLedge`).
   */
  step(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina, ledge: LedgeHang | null): boolean {
    const T = CLIMB_TUNE;
    const dt = i.dt;
    this.startClip = '';
    this.stood = false;
    this.toLedge = false;
    this.moved = 0;
    if (T.wall !== 'on') {
      this.letGo(b, 'switched off', 0, 0, 0);
      return false;
    }
    const up = (i.forwardHeld ? 1 : 0) - (i.backHeld ? 1 : 0);
    const side = (i.leftHeld ? 1 : 0) - (i.rightHeld ? 1 : 0);
    const want = up !== 0 || side !== 0;
    stam.step(dt, -(want ? T.wallStamina.climb : T.wallStamina.still), i.pool, LOCO_TUNE);
    b.vel.x = 0;
    b.vel.y = 0;
    b.vel.z = 0;
    if (stam.tired) {
      this.said = 'Too tired to hold on.';
      this.letGo(b, 'tired', this.lx * 0.3, 0, this.lz * 0.3);
      return false;
    }
    if (i.crouchPressed) {
      this.letGo(b, 'let go', this.lx * 0.3, 0, this.lz * 0.3);
      return false;
    }
    if (i.jumpPressed) {
      this.jumpOff(b);
      return false;
    }
    const s = this.s;
    let state: WallState = 'wallStill';
    if (want) {
      const vy = up > 0 ? T.wallSpeed.up : up < 0 ? -T.wallSpeed.down : 0;
      const vs = side * T.wallSpeed.side;
      const y1 = b.pos.y + vy * this.hl * dt;
      // Sideways along the face's level line (the figure's left is (-lz, lx) as it faces the face).
      const x1 = b.pos.x - this.lz * vs * dt;
      const z1 = b.pos.z + this.lx * vs * dt;
      // Climbing down onto walkable ground: the body stands there.
      this.ax = b.pos.x;
      this.ay = b.pos.y;
      this.az = b.pos.z;
      this.af = i.filter;
      this.areach = -vy * this.hl * dt + FOOT_GROUND;
      if (up < 0 && this.groundUnder(world)) {
        b.pos.y = this.gy;
        this.letGo(b, 'stood', 0, 0, 0);
        this.stood = true;
        return false;
      }
      // Climbing up to a lip within the hands' reach: at the braced hang's own place under it the ledges take the body.
      if (up > 0 && ledge && T.ledges === 'on') {
        const G = ledge.hangGrip(s);
        const L = this.lip;
        const found = ledge.lipAhead(world, b.pos.x, b.pos.y, b.pos.z, -this.lx, -this.lz, G - 0.1 * s, G + LOOK_UP * s, T.reachAhead * s + 0.3, i.filter, L);
        // What the last look for a lip found (the console's: where the climb hands over, or why it went on past).
        this.lipFound = found;
        if (found) {
          this.lipY = L.ey;
          this.lipHang = L.ey - G;
        }
        if (found && L.ey - G <= y1 + 1e-9) {
          // The ledge draws the figure on from where the climb drew it, so the offset goes with it; the lean eases out here.
          const ox = this.offX;
          const oy = this.offY;
          const oz = this.offZ;
          this.lipRefused = true;
          if (ledge.fromWall(world, b, i, L, ox, oy, oz)) {
            this.lipRefused = false;
            this.leave('to a ledge');
            this.offX = 0;
            this.offY = 0;
            this.offZ = 0;
            this.ofX = 0;
            this.ofY = 0;
            this.ofZ = 0;
            this.toLedge = true;
            return false;
          }
        }
      }
      // The new place held off the face, and moved to only where a standing capsule fits.
      this.ax = x1;
      this.ay = y1;
      this.az = z1;
      this.af = i.filter;
      this.stallWhy = 'no face there';
      if (this.standOff(world)) {
        // Room for the standing capsule there, else as much again out from the face as a bump in it stands proud (two more
        // tries, `BUMP_OUT` and twice it): the figure is still drawn against the face, the body only held further off.
        this.qy = y1;
        let fits = false;
        for (let k = 0; k < 3 && !fits; k++) {
          const out = k * BUMP_OUT * s;
          this.qx = this.bx + this.lx * out;
          this.qz = this.bz + this.lz * out;
          fits = this.clear(world);
        }
        this.stallWhy = 'no room there';
        if (fits) {
          const ddx = this.qx - b.pos.x;
          const ddy = y1 - b.pos.y;
          const ddz = this.qz - b.pos.z;
          this.moved = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          b.pos.x = this.qx;
          b.pos.y = y1;
          b.pos.z = this.qz;
          state = up > 0 ? 'wallUp' : up < 0 ? 'wallDown' : side > 0 ? 'wallLeft' : 'wallRight';
          this.stallWhy = '';
        }
      }
      // Held against a face it cannot go on along (an overhang over it, a corner, no room): said once a stall, in words.
      if (state === 'wallStill' && !this.stalled) {
        this.stalled = true;
        this.said = up > 0 ? 'No way on up here.' : 'No way on that way.';
      }
    }
    if (state !== 'wallStill' || !want) this.stalled = false;
    // The clip: up or down while moving that way, the up clip sideways; held still, whichever was playing stops where it is.
    // Climbing II, item 6: sideways alone, under `climb.wallSide` 'shimmy', the braced shimmy clip of that way.
    const clipWas = this.rigClip;
    const shimmy = T.wallSide === 'shimmy';
    if (state === 'wallDown') this.rigClip = WALL_CLIPS.down;
    else if (shimmy && state === 'wallLeft') this.rigClip = WALL_SIDE.left;
    else if (shimmy && state === 'wallRight') this.rigClip = WALL_SIDE.right;
    else if (state !== 'wallStill') this.rigClip = WALL_CLIPS.up;
    const was = this.rigState;
    this.rigState = state;
    this.rateFor(state);
    if ((was !== state && (state === 'wallDown' || was === 'wallDown')) || (shimmy && clipWas !== this.rigClip)) this.beginFade();
    this.dtNow = dt;
    this.drawOffset(b);
    // The hands and feet onto the face over the ease.
    const e = T.ease;
    this.hands = e > 0 ? Math.min(1, this.hands + dt / e) : 1;
    return true;
  }

  /** The clip's rate for a state into ate (wallRateOf's, written into the field: no number crosses a call). */
  private rateFor(state: string): void {
    const T = CLIMB_TUNE.wallSpeed;
    const s = this.s;
    const k = s > 1e-6 ? s : 1;
    if (state === 'wallUp') this.rate = T.up / (UP_STRIDE * k);
    else if (state === 'wallDown') this.rate = T.down / (DOWN_STRIDE * k);
    else if (state === 'wallLeft' || state === 'wallRight') this.rate = CLIMB_TUNE.wallSide === 'shimmy' ? T.side / (SIDE_PACE * k) : T.side / (UP_STRIDE * k);
    else this.rate = 0;
  }

  /** The frame's seconds (what the eases read), a field so no number crosses a call. */
  private dtNow = 0.5;

  /** The figure's offset fades from where it stands to the next line-up over `climb.ease`. */
  private beginFade(): void {
    this.ofX = this.offX;
    this.ofY = this.offY;
    this.ofZ = this.offZ;
    this.fadeT = 0;
  }

  /**
   * Where the figure is drawn against the body: leant into the face by its lean, and its origin moved along the face's
   * normal (and up by the clip's lift) until its clip's own wall lies on the face (the face eased toward the one found).
   */
  private drawOffset(b: LedgeBody): void {
    const dt = this.dtNow;
    const k = FACE_EASE > 0 ? 1 - Math.exp(-dt / FACE_EASE) : 1;
    let nx = this.dnx + (this.nx - this.dnx) * k;
    let ny = this.dny + (this.ny - this.dny) * k;
    let nz = this.dnz + (this.nz - this.dnz) * k;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    this.dnx = nx;
    this.dny = ny;
    this.dnz = nz;
    const lean = ny > 0 ? Math.asin(ny < 1 ? ny : 1) : 0;
    const hl = Math.sqrt(nx * nx + nz * nz);
    const lx = nx / hl;
    const lz = nz / hl;
    const cy = ny > 0 ? ny : 0;
    const ch = Math.sqrt(1 - cy * cy);
    this.heading = Math.atan2(-lx, -lz);
    const f = WALL_FACTS[this.rigClip] ?? WALL_FACTS[WALL_CLIPS.up];
    const s = this.s;
    // clipWall and clipLift written out (a number handed back across a call the compiler leaves out is a number made).
    let w = (f.hand + PALM_OFF) * s;
    let lift = (UP_HIPS - f.hips) * s;
    // Climbing II, item 6: a braced shimmy clip lined up by its hands, as the hang lines it up on a lip: its grip a palm off
    // the face, at the up clip's hands' mean height.
    if (this.rigClip === WALL_SIDE.left || this.rigClip === WALL_SIDE.right) {
      const g = this.rigClip === WALL_SIDE.left ? SIDE_L_G : SIDE_R_G;
      w = (g[2] + PALM_OFF) * s;
      lift = (UP_HANDS - g[1]) * s;
    }
    // The origin O = body + lift up + forward by kk: its clip's wall (w ahead of O, turned by the lean) on the face's plane.
    const d = (b.pos.x - this.px) * nx + (b.pos.y - this.py) * ny + (b.pos.z - this.pz) * nz;
    const kk = (d + lift * cy - w) / ch;
    const tx = -lx * kk;
    const ty = lift;
    const tz = -lz * kk;
    this.fadeT += dt;
    const e = CLIMB_TUNE.ease;
    const u = e > 0 ? Math.min(1, this.fadeT / e) : 1;
    this.offX = this.ofX + (tx - this.ofX) * u;
    this.offY = this.ofY + (ty - this.ofY) * u;
    this.offZ = this.ofZ + (tz - this.ofZ) * u;
    // The lean comes in with the hands from the start (a change of clip fades the offset alone).
    this.lean = lean * this.hands;
  }

  /** Off the wall with no fall of its own: the drawn offset and the lean eased out from where they stand over `climb.ease`. */
  private leave(why: string): void {
    this.lastLetGo = why;
    this.phase = WALL_NONE;
    this.stalled = false;
    this.rigState = '';
    this.press = 0;
    this.hands = 0;
    this.ofX = this.offX;
    this.ofY = this.offY;
    this.ofZ = this.offZ;
    this.leanFrom = this.lean;
    this.outDur = Math.max(CLIMB_TUNE.ease, 1e-3);
    this.outT = this.outDur;
    this.handRay.fill(Number.NaN);
    this.holds.reset();
  }

  /** Let the body go, its velocity what it is thrown at. */
  letGo(b: LedgeBody, why: string, vx: number, vy: number, vz: number): void {
    this.leave(why);
    b.vel.x = vx;
    b.vel.y = vy;
    b.vel.z = vz;
  }

  /** Space: off the wall backward (the ledges' own jump off, its clip turning the figure round, which the caller takes up once it has played). */
  private jumpOff(b: LedgeBody): void {
    const T = CLIMB_TUNE;
    const h = this.heading;
    // Climbing II, Smoothness II, item 6 (`climb.pushOff` 'jka'): Jedi Academy's rebound back off a wall, at its own speeds
    // (`JKA.jumpOffWallSpeed` back, `JKA.wallJumpStrength` up, src/player/jkaMove.ts), facing the wall as it flies.
    if (T.pushOff === 'jka') {
      this.letGo(b, 'pushed off', this.lx * JKA.jumpOffWallSpeed * UNIT * T.pushBack, JKA.wallJumpStrength * UNIT * T.pushUp, this.lz * JKA.jumpOffWallSpeed * UNIT * T.pushBack);
      this.startClip = LEDGE_PUSH_OFF;
      this.startFrom = 0;
      this.startFade = 0.06;
      return;
    }
    this.letGo(b, 'jumped off', this.lx * T.jumpBack, T.jumpUp, this.lz * T.jumpBack);
    this.startClip = LEDGE_JUMP_OFF;
    this.startFrom = 0;
    this.startFade = 0.06;
    this.turnTo = (h + Math.PI) % TAU;
    this.turnIn = LEDGE_FACTS[LEDGE_JUMP_OFF].dur;
  }

  /**
   * Every frame off the wall: the drawn offset and the lean eased out, and the jump off's turn (true where the body turns
   * to `turnNow` this frame). Nothing at all while none of them runs.
   */
  tick(dt: number): boolean {
    if (this.outT > 0) {
      this.outT -= dt;
      if (this.outT <= 0) {
        this.outT = 0;
        this.offX = 0;
        this.offY = 0;
        this.offZ = 0;
        this.lean = 0;
      } else {
        const k = this.outT / this.outDur;
        this.offX = this.ofX * k;
        this.offY = this.ofY * k;
        this.offZ = this.ofZ * k;
        this.lean = this.leanFrom * k;
      }
    }
    if (this.turnTo === this.turnTo) {
      this.turnIn -= dt;
      if (this.turnIn <= 0) {
        this.turnNow = this.turnTo;
        this.turnTo = Number.NaN;
        return true;
      }
    }
    return false;
  }

  // ---- the hands and feet --------------------------------------------------------------------------------------------------

  /**
   * The hands and feet handed to the limbs' solve (src/player/limbPlace.ts), the figure posed and placed: each hand's grip
   * point put on the face under it (one ray a hand into the face, kept while the hand stays within `SAME`), its palm
   * `PALM_OFF` off it, by the placement's share and by how near the clip has it to the face (a hand reaching for its next
   * hold is the clip's own); the feet on the face, each by how near the clip has it (`footFade`).
   */
  limbsFor(lp: LimbPlace, rig: LimbRig, world: LedgeWorld, toPhys: THREE.Matrix4 | null): void {
    // The hands' rays cast in the limbs' own groups (the caller writes `lp.filter` first: a number handed across a call is made).
    const flt = lp.filter;
    // (Smoothness III, item 0: a wall keeps its spheres' push whole; only a climb up's crossfade into the stand lets it go.)
    lp.pushKeep = 1;
    const s = this.s;
    const near = WALL_PLANT.near * s;
    const far = WALL_PLANT.far * s;
    const palm = PALM_OFF * s;
    const hr = this.handRay;
    const handN = this.handN;
    // Climbing II, item 6: under `climb.wallLimbs` 'held' each hand (and, through the limbs' solve, each foot) on its hold.
    const H = CLIMB_TUNE.wallLimbs === 'held' ? this.holds : null;
    if (H) {
      H.dt = this.dtNow;
      H.ease = CLIMB_TUNE.ease;
      H.most = CLIMB_TUNE.holdMost * s;
      // The hands take no reach test (the figure is drawn toward them); the feet's solve writes its own.
      H.reach = 0;
    }
    lp.holds = H;
    for (let side = 0; side < 2; side++) {
      const g = this.hands > 0 ? lp.gripNow(rig, side, toPhys, gripV) : null;
      if (!g) {
        lp.handW[side] = 0;
        if (H) H.drop(side);
        continue;
      }
      const o = side * 7;
      const ex = g.x - hr[o];
      const ey = g.y - hr[o + 1];
      const ez = g.z - hr[o + 2];
      if (!(ex <= SAME && ex >= -SAME && ey <= SAME && ey >= -SAME && ez <= SAME && ez >= -SAME)) {
        // From in front of the grip into the face along its normal.
        this.qflt = flt;
        this.qx = g.x + this.nx * 0.3;
        this.qy = g.y + this.ny * 0.3;
        this.qz = g.z + this.nz * 0.3;
        this.qdx = -this.nx;
        this.qdy = -this.ny;
        this.qdz = -this.nz;
        this.qlen = 0.3 + far + 0.3;
        hr[o] = g.x;
        hr[o + 1] = g.y;
        hr[o + 2] = g.z;
        this.handOk[side] = this.cast(world);
        this.handSeek[side] = 0;
        // Climbing II, Smoothness II, item 5 (`climb.wallHands` 'grip'): a hand with no face under it (over the top, past a side,
        // over a hole) takes the nearest real grip within `gripSeek`: down the face, sideways along it, or in over the top.
        if (!this.handOk[side] && CLIMB_TUNE.wallHands === 'grip' && this.seekGrip(world, g.x, g.y, g.z, flt, s)) {
          this.handOk[side] = true;
          this.handSeek[side] = 1;
          this.seeks++;
        }
        if (this.handOk[side]) {
          hr[o + 3] = this.hx;
          hr[o + 4] = this.hy;
          hr[o + 5] = this.hz;
          hr[o + 6] = 0;
          handN[side * 3] = this.hnx;
          handN[side * 3 + 1] = this.hny;
          handN[side * 3 + 2] = this.hnz;
        }
      }
      if (!this.handOk[side]) {
        lp.handW[side] = 0;
        if (H) {
          H.px = g.x;
          H.py = g.y;
          H.pz = g.z;
          H.drop(side);
        }
        continue;
      }
      const fnx = handN[side * 3];
      const fny = handN[side * 3 + 1];
      const fnz = handN[side * 3 + 2];
      // How far the grip stands off the face beyond a flat palm's, along the face's normal (a grip the seek found is gripped:
      // the hand onto it, the palm off it).
      const seek = this.handSeek[side] === 1;
      const d = (g.x - hr[o + 3]) * fnx + (g.y - hr[o + 4]) * fny + (g.z - hr[o + 5]) * fnz - palm;
      const plant = seek ? 1 : d <= near ? 1 : d >= far ? 0 : 1 - (d - near) / (far - near);
      // Where the hand goes: onto the face under it (the grip moved along the face's normal), or a sought grip's own place.
      const tx = seek ? hr[o + 3] + fnx * palm : g.x - fnx * d;
      const ty = seek ? hr[o + 4] + fny * palm : g.y - fny * d;
      const tz = seek ? hr[o + 5] + fnz * palm : g.z - fnz * d;
      if (H) {
        // On its hold until its next reach (where the clip has it on the face handed over, the hold's target and weight taken).
        H.px = tx;
        H.py = ty;
        H.pz = tz;
        H.plant = plant;
        H.step(side);
        lp.hand[side * 3] = H.tx;
        lp.hand[side * 3 + 1] = H.ty;
        lp.hand[side * 3 + 2] = H.tz;
        lp.handW[side] = this.hands * H.w;
      } else {
        lp.hand[side * 3] = tx;
        lp.hand[side * 3 + 1] = ty;
        lp.hand[side * 3 + 2] = tz;
        lp.handW[side] = this.hands * plant;
      }
      lp.palmW[side] = 0;
    }
    // A hand the clip has at the top of its reach for its next hold may stand a few centimetres short of the face: the
    // figure is drawn toward each hand's target by whatever its arm would still have to stretch (the ledges' own anchor),
    // and the feet's solve takes the legs up.
    this.anchor(lp, rig, toPhys);
    lp.wallW = this.hands;
    lp.footFade = true;
    lp.wall[0] = this.px;
    lp.wall[1] = this.py;
    lp.wall[2] = this.pz;
    lp.wall[3] = this.nx;
    lp.wall[4] = this.ny;
    lp.wall[5] = this.nz;
  }

  /** How far `anchor` moved the rig's root up in its parent's frame this frame (a caller that takes its own offset back off adds it). */
  lifted = 0.5;

  /**
   * The figure moved toward its placed hands' targets by whatever an arm would still have to stretch to reach one (two
   * passes over both hands, each by its share), as the ledges' anchor moves a hanging figure: read off the pose as it
   * stands (`LimbPlace.reachPastIn`), written by components (no number crosses a call).
   */
  private anchor(lp: LimbPlace, rig: LimbRig, toPhys: THREE.Matrix4 | null): void {
    this.lifted = 0;
    const v = anchorV;
    v.x = 0;
    v.y = 0;
    v.z = 0;
    const at = lp.reachAt;
    const dir = anchorD;
    for (let pass = 0; pass < 2; pass++) {
      for (let s = 0; s < 2; s++) {
        const w = lp.handW[s];
        if (!(w > 0)) continue;
        at[0] = lp.hand[s * 3] - v.x;
        at[1] = lp.hand[s * 3 + 1] - v.y;
        at[2] = lp.hand[s * 3 + 2] - v.z;
        lp.reachPastIn(rig, s, toPhys, dir);
        const e = lp.past;
        if (!(e > 0)) continue;
        const k = (e + REACH_SPARE) * (w > 1 ? 1 : w);
        v.x += dir.x * k;
        v.y += dir.y * k;
        v.z += dir.z * k;
      }
    }
    if (v.x === 0 && v.y === 0 && v.z === 0) return;
    const root = rig.root;
    const parent = root.parent;
    if (!parent) return;
    // Into the world's frame from the physics frame (aboard a ship's rooms), into the root's parent's.
    if (toPhys) {
      const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      v.transformDirection(anchorM.copy(toPhys).invert());
      v.x *= len;
      v.y *= len;
      v.z *= len;
    }
    root.getWorldPosition(anchorP);
    anchorP.x += v.x;
    anchorP.y += v.y;
    anchorP.z += v.z;
    parent.worldToLocal(anchorP);
    this.lifted = anchorP.y - root.position.y;
    root.position.x = anchorP.x;
    root.position.y = anchorP.y;
    root.position.z = anchorP.z;
    root.updateMatrixWorld(true);
  }

  /**
   * Another player's figure on a wall (their rig state says so; their game holds the face): the face in front of where their
   * figure is drawn, found here (one ray from their chest along their heading, cast again only once they have moved a
   * centimetre or turned), into this climb's own face, so `drawOffset` and `limbsFor` serve their figure as they serve the
   * player's. False where none is in front of them (their figure then hangs as the clip has it).
   */
  peerFace(world: LedgeWorld, x: number, y: number, z: number, heading: number, s: number, flt: number, state: string, dt: number, b: LedgeBody): boolean {
    const ex = x - this.peerX;
    const ey = y - this.peerY;
    const ez = z - this.peerZ;
    if (!(ex * ex + ey * ey + ez * ez < 1e-4 && this.peerH === heading)) {
      this.peerX = x;
      this.peerY = y;
      this.peerZ = z;
      this.peerH = heading;
      this.qflt = flt;
      this.qx = x;
      this.qy = y + HIGH;
      this.qz = z;
      this.qdx = Math.sin(heading);
      this.qdy = 0;
      this.qdz = Math.cos(heading);
      this.qlen = LEDGE_CAPSULE.r + 0.8;
      const fresh = this.phase === WALL_NONE;
      this.peerOk = this.cast(world) && this.climbable();
      if (this.peerOk) {
        this.takeFace();
        if (fresh) {
          this.dnx = this.nx;
          this.dny = this.ny;
          this.dnz = this.nz;
        }
      }
    }
    if (!this.peerOk) {
      this.phase = WALL_NONE;
      return false;
    }
    if (this.phase === WALL_NONE) {
      this.phase = WALL_ON;
      this.beginFade();
      this.handRay.fill(Number.NaN);
    }
    this.s = s;
    const clip = state === 'wallStill' ? this.rigClip || WALL_CLIPS.up : wallClipOf(state);
    if (clip !== this.rigClip && (clip === WALL_CLIPS.down || this.rigClip === WALL_CLIPS.down)) this.beginFade();
    this.rigClip = clip;
    this.rigState = state;
    this.dtNow = dt;
    this.drawOffset(b);
    const e = CLIMB_TUNE.ease;
    this.hands = e > 0 ? Math.min(1, this.hands + dt / e) : 1;
    return true;
  }

  /** Their figure off the wall: the hands eased off (a peer's). */
  peerOff(dt: number): void {
    this.phase = WALL_NONE;
    this.rigState = '';
    const e = CLIMB_TUNE.ease;
    this.hands = e > 0 ? Math.max(0, this.hands - dt / e) : 0;
    if (this.hands === 0) {
      this.offX = 0;
      this.offY = 0;
      this.offZ = 0;
      this.lean = 0;
    }
  }

  private peerX = Number.NaN;
  private peerY = Number.NaN;
  private peerZ = Number.NaN;
  private peerH = Number.NaN;
  private peerOk = false;

  /** What the console says. */
  report(): Record<string, unknown> {
    const n = (v: number) => Math.round(v * 1000) / 1000;
    return {
      wall: CLIMB_TUNE.wall,
      on: this.phase === WALL_ON,
      // Smoothness II, item 5: the grips a hand over air was moved to (`wallHands` 'grip').
      seeks: this.seeks,
      state: this.rigState || 'none',
      clip: this.rigClip || 'none',
      rate: n(this.rate),
      press: n(this.press),
      face: this.phase === WALL_ON ? { at: [n(this.px), n(this.py), n(this.pz)], normal: [n(this.nx), n(this.ny), n(this.nz)], steep: n((Math.acos(Math.max(-1, Math.min(1, this.ny))) * 180) / Math.PI) } : null,
      offset: [n(this.offX), n(this.offY), n(this.offZ)],
      lean: n((this.lean * 180) / Math.PI),
      hands: n(this.hands),
      climbs: this.climbs,
      // Climbing II, item 6: the limbs' holds (each on its hold or not, whose turn it is to reach, and the counts).
      holds: { on: Array.from(this.holds.on), mover: this.holds.mover, taken: this.holds.taken, reaches: this.holds.reaches, forced: this.holds.forced, beyond: this.holds.beyond, waited: this.holds.waited },
      casts: this.casts,
      // The last look for a lip while climbing up: where the climb would hand the body over, or that it found none.
      stall: this.stallWhy || null,
      lip: this.lipFound ? { at: n(this.lipY), hangAt: n(this.lipHang), refused: this.lipRefused } : 'none on the last look',
      lastLetGo: this.lastLetGo || null,
    };
  }
}

const gripV = new THREE.Vector3();
const anchorV = new THREE.Vector3();
const anchorD = new THREE.Vector3();
const anchorP = new THREE.Vector3();
const anchorM = new THREE.Matrix4();
/** What the anchor moves the figure past an arm's whole length, metres: a millimetre, so the solve meets its target. */
const REACH_SPARE = 0.001;
/** How far out from the face the body is tried again where a bump in the face leaves no room at its held-off place, metres (ours). */
const BUMP_OUT = 0.1;
