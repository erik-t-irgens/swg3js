// The capsule the body wears on foot (Climbing II's feedback round, items 3 and 4, the owner after playing: "Prone is too
// tall", "Fit under overhangs, without asking"), under `MOVE_TUNE`'s two switches (src/anim/moveTune.ts). With both at their
// other setting nothing here runs and the capsule is today's (`Player.setCrouchCollider`: standing, or the crouch's upright
// shell crouched, kneeling and prone, on the ground).
//
// - Lying (`proneShape` 'lying'): a prone body wears a capsule lying along it, `lyingRadius` round and as long as the body
//   lies (the human male's `LYING_LENGTH` crown to soles, scaled by the figure), its middle over the feet point the body is
//   placed by, turned with the heading and tipped along the ground's plane under the feet (so on a hillside it lies on the
//   slope, not on its uphill end), put where the body is before every move (`syncLying`, the step-up's own sync for it).
//   Going prone where it does not fit is refused in words; a turn that would put it into something still is slid out along
//   what it met, tried by halves where the whole does not fit, else refused for that frame; getting up asks for room for the
//   upright capsule the body gets up into and stays down where there is none.
// - The duck (`duck` 'on'): on its feet, what stands still over the body and along its travel (its own front, `duckAhead`
//   past it, and as far again as the body covers while the capsule shrinks at `duckRate`) sets how tall the capsule may be,
//   from standing down past the crouch to `duckMost`. The capsule eases toward that at `duckRate`, timed so that it is short
//   enough by the time the body is under what is ahead, and is never taller than the room over its own feet, on its feet or
//   off them (off them it never shrinks, and grows only into that room). What it says
//   back is the crouch's share to blend into the pose (`share`: nought standing, one at the crouch's height) and how far past
//   the crouch the spine and neck bend (`bend`, nought to one at `duckMost`).
//
// How the room is found: one test of a box over the body's path (from just under `duckMost` to the standing height) while it
// moves or stands ducked; only where that meets something, a ball of nearly the capsule's radius cast up from just under
// `duckMost` at the body's feet and at steps along its travel, each ball's first hit the underside over that column. A column
// already inside something where its ball starts is a wall or a step in the way, never a roof (an overhang lower than
// `duckMost` is no room to duck into either), and is passed over. Every query takes what stands still by the engine's own
// flags (`STILL_FLAGS`: no sensor, nothing kinematic, nothing dynamic), as the ledges' room checks do, so the body's own
// capsule, other players, a ragdoll and a door are never a roof.
//
// Node-importable: the engine's shapes are made by the caller's makers (as `LedgeHang`'s), the numbers go in a kept record
// and out in fields, and nothing is made in a frame but the engine's own answers.
import type RAPIER from '@dimforge/rapier3d-compat';
import { MOVE_TUNE } from '../anim/moveTune.ts';
import { LOCO_TUNE } from '../anim/locoTune.ts';
import { STILL_FLAGS } from './stairSense.ts';

/** The player's capsule (`src/player/player.ts`): its radius and its straight halves standing and crouched. */
export const BODY_CAPSULE = { r: 0.35, stand: 0.45, crouch: 0.15 } as const;
/** The upright capsule's whole height standing and crouched, metres. */
export const STAND_TALL = 2 * (BODY_CAPSULE.r + BODY_CAPSULE.stand);
export const CROUCH_TALL = 2 * (BODY_CAPSULE.r + BODY_CAPSULE.crouch);
/**
 * The human male's length lying down, crown to soles, metres: his rest pose's height (the hips' 1.002 m stand 0.56 of it,
 * `LEDGE_REST.hips`), what a lying capsule is long, scaled by the figure (`figureScaleOf`). A mechanic, not a slider.
 */
export const LYING_LENGTH = 1.8;
/** How far over the ground a lying capsule is tested before it is taken, metres (the ledges' own skin over a top). */
const LIFT = 0.02;
/** What stays between the top of a ducked capsule and what stands over it, metres (just over the controller's own offset of 0.04, so it never presses the capsule's top into a roof). */
export const DUCK_CLEAR = 0.05;
/** The ball a column is cast with: the capsule's own top (its radius), so where it stops is where the capsule's top would, at a roof's edge as under its middle. */
const BALL_R = BODY_CAPSULE.r;
/** Columns along the travel at most this far apart: the balls overlap (2 x 0.35 over 0.5), so no beam slips between two. */
const COLUMN_STEP = 0.5;
/** A column whose ball is met within this of where it starts is inside something there: a wall or a step, not a roof. */
const COLUMN_SOLID = 0.005;
/** The most the duck looks ahead, metres: a sprint's lead is never longer (the casts stay a dozen at the most). */
const AHEAD_MOST = 5;
/** The least speed the duck times its lead by while the keys ask a way (a body held up at a roof's edge moves at nought and must still shrink to pass), metres a second. */
const DUCK_SLOW = 1;
/** A column this near the feet overlaps the capsule's own space (two radii and the controller's offset): it binds at once. */
const DUCK_BIND = 2 * BODY_CAPSULE.r + 0.04;
/** How far a column's ball is cast up, metres: past the standing height from under the deepest duck and the slope's lift at any setting (a constant: see the sweep's). */
const UP_MOST = 2;
/** How far a lying body is slid out of what a turn met, at the most, metres (a capsule's half width: a nudge, never a step through). */
const SLIDE_MOST = 0.3;
/** How many shares of a frame's turn a lying body tries (the whole, a half, a quarter, an eighth) before it is refused. */
const TURN_TRIES = 4;
/** The least rise along the heading (a tangent) a lying capsule is tipped for: under it the ground is level to the capsule (a twentieth of a degree). */
const TILT_LEAST = 1e-3;
/** How far the ground's tilt under a lying body moves before its capsule is written again, radians (a degree: a crawl over a heightfield's triangles writes it at most once a triangle or so). */
const TILT_STEP = 0.0175;
/** The path box's clear answer stands while the body has come no further than this along its way since it was asked, metres (the box reaches this much further than the look ahead). */
const ZONE_MARGIN = 0.25;
/** ... nor drifted, or its way turned, by more than this across it at the look ahead's end, metres (the box is this much wider than the capsule: under the controller's 0.04 m off a wall beside it, so a wall walked along is never in it). */
const ZONE_SIDE = 0.03;
/** ... nor its feet risen or fallen by more than this, metres (the box reaches this much under its least and over its most). */
const ZONE_UP = 0.05;

/** A collider nothing is written to (the tests' turn with numbers). */
const NO_COLLIDER = { setHalfHeight() {}, setRadius() {}, setRotationWrtParent() {}, setTranslationWrtParent() {}, setTranslation() {}, setRotation() {} };

/** The kinds of capsule the shape writes. */
export const UPRIGHT = 0;
export const LYING = 1;

/** The little of a physics world the shape asks (rapier's own `World`). */
export interface ShapeWorld {
  intersectionWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): RAPIER.Collider | null;
  castShape(shapePos: RAPIER.Vector, shapeRot: RAPIER.Rotation, shapeVel: RAPIER.Vector, shape: RAPIER.Shape, targetDistance: number, maxToi: number, stopAtPenetration: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): RAPIER.ColliderShapeCastHit | null;
}

/** The engine's shapes, made by the caller (so this file loads under node with no engine of its own). */
export interface ShapeMakers {
  capsule(halfHeight: number, radius: number): RAPIER.Shape;
  ball(radius: number): RAPIER.Shape;
  cuboid(hx: number, hy: number, hz: number): RAPIER.Shape;
}

/** The little of the body's collider the shape writes. */
export interface ShapeCollider {
  setHalfHeight(h: number): void;
  setRadius(r: number): void;
  setRotationWrtParent(q: { x: number; y: number; z: number; w: number }): void;
  setTranslationWrtParent(t: { x: number; y: number; z: number }): void;
  setTranslation(t: { x: number; y: number; z: number }): void;
  setRotation(q: { x: number; y: number; z: number; w: number }): void;
}

/** What the contact of a blocker with the lying capsule says (rapier's `ShapeContact`, the part read). */
export interface ShapeContactLike {
  distance: number;
  normal1: { x: number; y: number; z: number };
}

/** A frame of the body as the shape needs it, written by the caller (fields, so no number crosses a call). */
export class ShapeIn {
  dt = 0.5;
  /** The feet. */
  x = 0.5;
  y = 0.5;
  z = 0.5;
  /** The body's heading, radians (its front is (sin h, 0, cos h)). */
  heading = 0.5;
  /** The velocity across the ground (the travel the duck looks along), and the keys' way where it stands still. */
  vx = 0.5;
  vz = 0.5;
  moveX = 0.5;
  moveZ = 0.5;
  /** On its feet on the ground, ducking allowed: not in the air, swimming, climbing, riding, prone, kneeling, nor placing. */
  feet = false;
  /** Crouched by the key (or kept crouched after a climb): never taller than the crouch. */
  crouch = false;
  /** Lying prone under `proneShape` 'lying'. */
  lying = false;
  /** How far the floor under the capsule's rim rises over the feet (the slope the body stands on: its radius times the plane's tangent), metres. */
  rise = 0.5;
  /** The figure's size against the human male's. */
  scale = 0.5;
  /** The move's own collision groups. */
  filter = 0;
  /** The ground's plane under the feet (the slope rule's, last judged; straight up where none is known), which a lying capsule lies along. */
  nx = 0.5;
  ny = 0.5;
  nz = 0.5;
  constructor() {
    this.nx = 0;
    this.ny = 1;
    this.nz = 0;
    this.dt = 0;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.heading = 0;
    this.vx = 0;
    this.vz = 0;
    this.moveX = 0;
    this.moveZ = 0;
    this.rise = 0;
    this.scale = 1;
  }
}

export class BodyShape {
  /** What the collider is now: `UPRIGHT` (standing, crouched or ducked) or `LYING`. */
  kind = UPRIGHT;
  /** The upright capsule's whole height now, metres. */
  tall = 0.5;
  /** The room measured over the body's own feet last frame the duck asked (Infinity for nothing in the way). */
  room = 0.5;
  /** The height the duck wanted last frame, metres. */
  want = 0.5;
  /** The crouch's share of the pose (nought standing, one at the crouch's height and under). */
  share = 0.5;
  /** How far past the crouch the spine and neck bend (nought at the crouch's height, one at `duckMost`). */
  bend = 0.5;
  /** The lying capsule's heading, radians. */
  lyingYaw = 0.5;
  /** How far the lying capsule is tipped up along its heading to lie along the ground there (radians, its front up), as last written. */
  lyingTilt = 0.5;
  /** The collider's numbers as last written: its middle over the feet, its straight half, its radius. */
  offsetY = 0.5;
  half = 0.5;
  radius = 0.5;
  /** The lying capsule's straight half as last made (its length less its two ends, halved). */
  lyingHalf = 0.5;
  /** The console's: what the last frame asked of the engine (boxes, balls, capsules). */
  asks = 0;
  /** The console's and the tests': how many moves a lying collider was put where the body is before (`syncLying`). */
  synced = 0;
  /** The console's: the last refusal or slide in words. */
  last = '';
  /** Words for the message line, taken by the caller. */
  said = '';
  /** A slide the last turn took (metres along x and z), applied by the caller to the feet. */
  slideX = 0.5;
  slideZ = 0.5;

  private readonly makers: ShapeMakers;
  private ball: RAPIER.Shape | null = null;
  private crouchCap: RAPIER.Shape | null = null;
  private standCap: RAPIER.Shape | null = null;
  private lyingCap: RAPIER.Shape | null = null;
  private lyingOf = 0.5;
  private lyingR = 0.5;
  private zone: RAPIER.Shape | null = null;
  private zoneLen = 0.5;
  private zoneH = 0.5;
  private zoneW = 0.5;
  private readonly at = { x: 0, y: 0, z: 0 };
  private readonly up = { x: 0, y: 1, z: 0 };
  private readonly way = { x: 0, y: 0, z: 1 };
  private readonly still = { x: 0, y: 0, z: 0, w: 1 };
  private readonly turn = { x: 0, y: 0, z: 0, w: 1 };
  private readonly lie = { x: 0, y: 0, z: 0, w: 1 };
  private readonly local = { x: 0, y: 0, z: 0 };
  private crouchWas = false;
  /** The height and the heading a write takes (fields, so no number crosses a call), and the record an event's call fills. */
  private tallTo = 0.5;
  private wantNow = 0.5;
  private ownNow = 0.5;
  private openNow = 0.5;
  private dNow = 0.5;
  private liftNow = 0.5;
  private aNow = 0.5;
  /** A lying test's heading, its feet's offset and the figure's size (fields: see 	allTo). */
  private testYaw = 0.5;
  private offX = 0.5;
  private offZ = 0.5;
  private scaleTo = 0.5;
  private yawTo = 0.5;
  /** The ground's plane a lying capsule lies along (the last frame's, kept: a press's test asks it before the frame's step). */
  private pnx = 0.5;
  private pny = 0.5;
  private pnz = 0.5;
  /** A lying capsule's tilt and its middle's height over the feet for the heading in `testYaw` (fields: see `tallTo`). */
  private testTilt = 0.5;
  private testLift = 0.5;
  /** The path box's last clear answer: where it was asked, along which way, how far it reached and for which deepest duck and groups (see `roomAlong`). */
  private zoneClear = false;
  private zoneX = 0.5;
  private zoneY = 0.5;
  private zoneZ = 0.5;
  private zoneUx = 0.5;
  private zoneUz = 0.5;
  private zoneReach = 0.5;
  private zoneMost = 0.5;
  private zoneFilter = 0.5;
  /** The share of a frame's turn a lying body's next turn tries first (0 the whole; past a refusal the smallest). */
  private turnFrom = 0;
  /** The console's and the tests': how many frames the path box's last clear answer stood for, and how many it was asked. */
  boxKept = 0;
  boxAsked = 0;
  private readonly callIn = new ShapeIn();

  constructor(makers: ShapeMakers) {
    this.makers = makers;
    this.tall = STAND_TALL;
    this.room = Infinity;
    this.want = STAND_TALL;
    this.share = 0;
    this.bend = 0;
    this.lyingYaw = 0;
    this.offsetY = BODY_CAPSULE.r + BODY_CAPSULE.stand;
    this.half = BODY_CAPSULE.stand;
    this.radius = BODY_CAPSULE.r;
    this.lyingHalf = 0;
    this.lyingOf = -1;
    this.lyingR = -1;
    this.zoneLen = -1;
    this.zoneH = -1;
    this.zoneW = -1;
    this.slideX = 0;
    this.slideZ = 0;
    this.tallTo = STAND_TALL;
    this.yawTo = 0;
    this.lyingTilt = 0;
    this.pnx = 0;
    this.pny = 1;
    this.pnz = 0;
    this.testTilt = 0;
    this.testLift = BODY_CAPSULE.r;
  }

  /** Whether the capsule is ducked under something (an upright one shorter than standing that the key did not ask for). */
  get ducked(): boolean {
    return this.kind === UPRIGHT && this.tall < STAND_TALL - 1e-6 && !this.crouchWas;
  }

  /** Back to standing at once (the body stood somewhere new, a reset). The collider is the caller's to write. */
  reset(): void {
    this.kind = UPRIGHT;
    this.tall = STAND_TALL;
    this.room = Infinity;
    this.want = STAND_TALL;
    this.share = 0;
    this.bend = 0;
    this.crouchWas = false;
    this.offsetY = BODY_CAPSULE.r + BODY_CAPSULE.stand;
    this.half = BODY_CAPSULE.stand;
    this.radius = BODY_CAPSULE.r;
    this.zoneClear = false;
    this.turnFrom = 0;
    this.pnx = 0;
    this.pny = 1;
    this.pnz = 0;
  }

  /**
   * The ground's plane from a frame's record into the shape's own: kept as it was where the frame knows none (the slope rule
   * says none for a stand it kept without asking), straight up where what it knows is no floor.
   */
  private notePlane(f: ShapeIn): void {
    const ny = f.ny;
    if (ny !== ny) return;
    if (ny > 0.5 && ny <= 1) {
      this.pnx = f.nx;
      this.pny = ny;
      this.pnz = f.nz;
    } else {
      this.pnx = 0;
      this.pny = 1;
      this.pnz = 0;
    }
  }

  /**
   * A lying capsule's tilt and lift for the heading in `testYaw` (into `testTilt`, `testLift`): its axis laid along the ground's
   * plane there (tipped up by the plane's rise along the heading), its middle over the feet by as far as puts its side the
   * radius off that plane (the radius over the plane's up), so its length rests on a hillside rather than on its uphill end.
   * Level ground (and none known) is no tilt and the radius, to the bit.
   */
  private tiltFor(): void {
    const r = MOVE_TUNE.lyingRadius;
    const ny = this.pny;
    const rise = -(this.pnx * Math.sin(this.testYaw) + this.pnz * Math.cos(this.testYaw)) / ny;
    this.testTilt = 0;
    this.testLift = r;
    if (rise > TILT_LEAST || rise < -TILT_LEAST) this.testTilt = Math.atan(rise);
    if (ny < 1 - 1e-9) this.testLift = r / ny;
  }

  /** Today's rule wrote the collider (standing, or the crouch's shell): the shape follows it, so its own next write starts there. */
  followCrouch(crouched: boolean): void {
    this.kind = UPRIGHT;
    this.tall = crouched ? CROUCH_TALL : STAND_TALL;
    this.share = 0;
    this.bend = 0;
    this.offsetY = BODY_CAPSULE.r + (crouched ? BODY_CAPSULE.crouch : BODY_CAPSULE.stand);
    this.half = crouched ? BODY_CAPSULE.crouch : BODY_CAPSULE.stand;
    this.radius = BODY_CAPSULE.r;
  }

  /** The lying capsule's length for a figure this size, metres (the console's). */
  lyingLength(scale: number): number {
    const L = LYING_LENGTH * (scale > 0.2 ? scale : 1);
    const r = MOVE_TUNE.lyingRadius;
    return L > 2 * r ? L : 2 * r;
  }

  /** The lying capsule shape for this figure (`scaleTo`; made again only when its size or radius moves: an event). */
  private lyingShape(): RAPIER.Shape {
    const r = MOVE_TUNE.lyingRadius;
    const s = this.scaleTo;
    const L = LYING_LENGTH * (s > 0.2 ? s : 1);
    this.lyingHalf = L > 2 * r ? L / 2 - r : 0;
    if (this.lyingHalf < 0.01) this.lyingHalf = 0.01;
    if (!this.lyingCap || this.lyingOf !== this.lyingHalf || this.lyingR !== r) {
      this.lyingCap = this.makers.capsule(this.lyingHalf, r);
      this.lyingOf = this.lyingHalf;
      this.lyingR = r;
    }
    return this.lyingCap;
  }

  /**
   * The lying capsule's turn for the heading in `testYaw` and the tilt in `testTilt`, into `lie`: its own axis (up) laid along
   * the heading, tipped up by the tilt.
   */
  private lieAlong(): void {
    // A turn about x of a quarter less the tilt (up onto ahead, tipped up), then the heading about up:
    // (x c2 sx, y s2 cx, z -s2 sx, w c2 cx). With no tilt the quarter's half-angle sine and cosine are both the root of a half.
    let sx = Math.SQRT1_2;
    let cx = Math.SQRT1_2;
    if (this.testTilt !== 0) {
      const b = (Math.PI / 2 - this.testTilt) / 2;
      sx = Math.sin(b);
      cx = Math.cos(b);
    }
    const s2 = Math.sin(this.testYaw / 2);
    const c2 = Math.cos(this.testYaw / 2);
    const q = this.lie;
    q.x = c2 * sx;
    q.y = s2 * cx;
    q.z = -s2 * sx;
    q.w = c2 * cx;
  }

  /** Whether a lying capsule at these feet and this heading is clear of what stands still (an event's call). */
  lyingFits(world: ShapeWorld, x: number, y: number, z: number, yaw: number, scale: number, filter: number): boolean {
    const f = this.callIn;
    f.x = x;
    f.y = y;
    f.z = z;
    f.scale = scale;
    f.filter = filter;
    this.testYaw = yaw;
    this.offX = 0;
    this.offZ = 0;
    return this.lyingMet(world, f) === null;
  }

  /** What still thing a lying capsule at the feet in `f` moved by (`offX`, `offZ`) and turned to `testYaw` meets, if any. */
  private lyingMet(world: ShapeWorld, f: ShapeIn): RAPIER.Collider | null {
    this.scaleTo = f.scale;
    const shape = this.lyingShape();
    this.tiltFor();
    this.lieAlong();
    const at = this.at;
    at.x = f.x + this.offX;
    at.y = f.y + this.testLift + LIFT;
    at.z = f.z + this.offZ;
    this.asks++;
    return world.intersectionWithShape(at, this.lie, shape, STILL_FLAGS, f.filter);
  }
  /** Whether an upright capsule this tall at these feet is clear of what stands still (the stand up's room). */
  uprightFits(world: ShapeWorld, x: number, y: number, z: number, tall: number, filter: number): boolean {
    let shape: RAPIER.Shape;
    const r = BODY_CAPSULE.r;
    const half = tall / 2 - r;
    if (half <= BODY_CAPSULE.crouch + 1e-6) shape = this.crouchCap ??= this.makers.capsule(BODY_CAPSULE.crouch, r);
    else shape = this.standCap ??= this.makers.capsule(BODY_CAPSULE.stand, r);
    const h = half <= BODY_CAPSULE.crouch + 1e-6 ? BODY_CAPSULE.crouch : BODY_CAPSULE.stand;
    const at = this.at;
    at.x = x;
    at.y = y + LIFT + r + h;
    at.z = z;
    this.asks++;
    return world.intersectionWithShape(at, this.still, shape, STILL_FLAGS, filter) === null;
  }

  /**
   * Going prone (the key asked it): true where the lying capsule fits at the feet along the heading. Refused, the words say
   * so (`said`) and the body stays as it was.
   */
  mayLie(world: ShapeWorld, x: number, y: number, z: number, heading: number, scale: number, filter: number): boolean {
    if (this.lyingFits(world, x, y, z, heading, scale, filter)) return true;
    this.said = this.last = 'No room to lie down here.';
    return false;
  }

  /** Getting up from lying into an upright capsule this tall: true where it fits; refused, the words say so and the body stays down. */
  mayRise(world: ShapeWorld, x: number, y: number, z: number, tall: number, filter: number): boolean {
    if (this.uprightFits(world, x, y, z, tall, filter)) return true;
    this.said = this.last = 'No room to stand up here.';
    return false;
  }

  /**
   * A lying body's turn this frame (fields, so no number crosses a call): from its capsule's own heading (`lyingYaw`) to
   * `f.heading` (where the body's own rule turned it). Where the turned capsule meets something still it is slid out along
   * what it met (by at most `SLIDE_MOST`, written into `slideX`/`slideZ` for the caller to put on the feet) if that clears
   * it, else the turn is refused for this frame (the heading it had). The capsule is then written at the heading it takes
   * (`lyingYaw`, for the caller to give the body). No test while the heading holds still.
   */
  turnLyingIn(world: ShapeWorld, f: ShapeIn, col: ShapeCollider): void {
    this.notePlane(f);
    this.slideX = 0;
    this.slideZ = 0;
    const yawWas = this.lyingYaw;
    const yawNow = f.heading;
    let d = yawNow - yawWas;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yawTo = yawNow;
    if (d < 1e-5 && d > -1e-5) {
      this.writeLyingAt(col, f);
      return;
    }
    // The whole turn first, then, refused, half of it and half again (`TURN_TRIES` in all): a frame's turn is as long as the
    // frame, and refused whole a long one never began, where the same turn in short frames went a share of the way and slid
    // (the review's fixing round: a 0.3 m capsule beside a wall turned at 60 frames a second and stood refused at 30).
    // A body whose turn was refused last frame starts from the smallest share, so one held against what refuses it asks the
    // engine a share and its slide a frame and never the whole ladder again (an accepted turn starts from the whole again).
    let tries = this.turnFrom;
    for (let k = 0; k < tries; k++) d /= 2;
    for (; tries < TURN_TRIES; tries++) {
      const yawTry = yawWas + d;
      this.testYaw = yawTry;
      this.offX = 0;
      this.offZ = 0;
      const met = this.lyingMet(world, f);
      if (!met) {
        this.yawTo = yawTry;
        break;
      }
      // Slid out along what it met: the contact's normal on the blocker, across the ground, by the depth and a skin.
      const c = (met as unknown as { contactShape?: (s: RAPIER.Shape, p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }, pred: number) => ShapeContactLike | null }).contactShape?.(this.lyingShape(), this.at, this.lie, LIFT) ?? null;
      // (The intersection test meets a shape a hair before the contact calls it touching: a contact at a hair's distance is a
      // touch too, slid by the skin alone; so the contact is asked with the skin as its reach, or a turn the intersection
      // refused and the contact, asked with none, found no touch for was refused for good: at 144 frames a second a 0.2 m
      // lying capsule turning to face a wall beside it stuck at 58 degrees.)
      if (c && c.distance < LIFT) {
        const nx = c.normal1.x;
        const nz = c.normal1.z;
        const n = Math.sqrt(nx * nx + nz * nz);
        const push = (c.distance < 0 ? -c.distance : 0) + LIFT;
        if (n > 0.2 && push <= SLIDE_MOST) {
          const sx = (nx / n) * push;
          const sz = (nz / n) * push;
          this.offX = sx;
          this.offZ = sz;
          if (this.lyingMet(world, f) === null) {
            this.slideX = sx;
            this.slideZ = sz;
            this.yawTo = yawTry;
            this.last = 'the turn slid out of what it met';
            // The capsule written where the feet are slid to (the caller moves the feet by the same).
            f.x += sx;
            f.z += sz;
            break;
          }
        }
      }
      d /= 2;
    }
    if (tries === TURN_TRIES) {
      this.yawTo = yawWas;
      this.last = 'a turn refused: the lying body would meet something';
      this.turnFrom = TURN_TRIES - 1;
    } else this.turnFrom = 0;
    this.writeLyingAt(col, f);
  }

  /** A lying body's turn as a call with numbers (the tests' and the console's; the frame's is `turnLyingIn`). */
  turnLying(world: ShapeWorld, x: number, y: number, z: number, yawWas: number, yawNow: number, scale: number, filter: number): number {
    const f = this.callIn;
    f.x = x;
    f.y = y;
    f.z = z;
    f.heading = yawNow;
    f.scale = scale;
    f.filter = filter;
    this.lyingYaw = yawWas;
    this.turnLyingIn(world, f, NO_COLLIDER);
    return this.lyingYaw;
  }

  /** The lying capsule held at its own heading, at the feet in `f` (a frame with no turn yet: the top of the player's frame). */
  holdLying(f: ShapeIn, col: ShapeCollider): void {
    this.notePlane(f);
    this.yawTo = this.kind === LYING ? this.lyingYaw : f.heading;
    this.writeLyingAt(col, f);
  }

  /** The lying capsule written onto the collider at a heading (its middle over the feet, `lyingRadius` up): an event's call. */
  writeLying(col: ShapeCollider, x: number, y: number, z: number, yaw: number, scale: number): void {
    const f = this.callIn;
    f.x = x;
    f.y = y;
    f.z = z;
    f.scale = scale;
    this.yawTo = yaw;
    this.writeLyingAt(col, f);
  }

  /**
   * The lying capsule at `yawTo` and the feet in `f`. Its size, its turn and its place over the body are written only when they
   * move (lying down, a turn, the radius moved), never on a frame that holds still: the body carries the collider there.
   */
  private writeLyingAt(col: ShapeCollider, f: ShapeIn): void {
    this.scaleTo = f.scale;
    this.lyingShape();
    const r = MOVE_TUNE.lyingRadius;
    const yaw = this.yawTo;
    const was = this.kind === LYING;
    if (!was || this.half !== this.lyingHalf || this.radius !== r) {
      col.setHalfHeight(this.lyingHalf);
      col.setRadius(r);
    }
    // The tilt along the ground for this heading (the review of the round: a level capsule on a hillside rests on its uphill
    // end and held the body 0.1 to 0.3 m off the ground, facing up or down a slope of 5 to 20 degrees).
    this.testYaw = yaw;
    this.tiltFor();
    const tilt = this.testTilt;
    const moved = tilt - this.lyingTilt;
    if (!was || yaw !== this.lyingYaw || this.radius !== r || moved > TILT_STEP || moved < -TILT_STEP || (tilt === 0) !== (this.lyingTilt === 0)) {
      this.lieAlong();
      col.setRotationWrtParent(this.lie);
      col.setRotation(this.lie);
      const lift = this.testLift;
      const t = this.local;
      t.x = 0;
      t.y = lift;
      t.z = 0;
      col.setTranslationWrtParent(t);
      const at = this.at;
      at.x = f.x;
      at.y = f.y + lift;
      at.z = f.z;
      col.setTranslation(at);
      this.lyingTilt = tilt;
      this.offsetY = lift;
    }
    this.kind = LYING;
    this.lyingYaw = yaw;
    this.half = this.lyingHalf;
    this.radius = r;
    this.share = 0;
    this.bend = 0;
  }

  /** An upright capsule `tall` metres written onto the collider (its feet where they are), turned upright again from lying: an event's call. */
  writeUpright(col: ShapeCollider, x: number, y: number, z: number, tall: number): void {
    const f = this.callIn;
    f.x = x;
    f.y = y;
    f.z = z;
    this.tallTo = tall;
    this.writeUprightAt(col, f);
  }

  /** The upright capsule `tallTo` metres at the feet in `f`. */
  private writeUprightAt(col: ShapeCollider, f: ShapeIn): void {
    const r = BODY_CAPSULE.r;
    const tall = this.tallTo;
    // Standing and the crouch are the player's own halves to the bit (`tall / 2 - r` is 0.45000000000000007 standing, and a
    // collider written again every frame is put where the body is every frame: a sync that moves the physics).
    let half = tall >= STAND_TALL - 1e-9 ? BODY_CAPSULE.stand : tall > CROUCH_TALL - 1e-9 && tall < CROUCH_TALL + 1e-9 ? BODY_CAPSULE.crouch : tall / 2 - r;
    if (half < 0.01) half = 0.01;
    if (this.kind === LYING) {
      col.setRadius(r);
      col.setRotationWrtParent(this.still);
      col.setRotation(this.still);
    }
    if (this.kind === LYING || this.half !== half) {
      col.setHalfHeight(half);
      const t = this.local;
      t.x = 0;
      t.y = r + half;
      t.z = 0;
      col.setTranslationWrtParent(t);
      const at = this.at;
      at.x = f.x;
      at.y = f.y + r + half;
      at.z = f.z;
      col.setTranslation(at);
    }
    this.kind = UPRIGHT;
    this.half = half;
    this.radius = r;
    this.offsetY = r + half;
    this.tall = 2 * (r + half);
  }
  /**
   * One frame of the upright shape (lying is the caller's to write): the height the duck allows (or standing and the crouch
   * by today's rule with the duck off, or off the feet), eased at `duckRate`, held under the room over the feet, and the
   * pose's shares from it. Then written onto the collider.
   */
  stepUpright(world: ShapeWorld, f: ShapeIn, col: ShapeCollider): void {
    this.notePlane(f);
    const crouchKey = f.crouch;
    const rule = MOVE_TUNE.duck === 'on';
    const duck = rule && f.feet;
    this.wantNow = crouchKey ? CROUCH_TALL : STAND_TALL;
    this.ownNow = 1e9;
    // Off its feet with the duck on (a jump, a step off an edge, the placing hand, the water), a capsule shorter than it wants
    // (ducked, or crouched by the key) grows only into the room over its own feet and never shrinks: nothing ducks there, and
    // nothing may stand it up into what is over it (the review of the round: a jump under a slab stood the capsule up inside
    // it and the body sank under the floor). The room is one column over the feet, asked only while it is shorter.
    const held = rule && !f.feet && this.kind === UPRIGHT && this.tall < this.wantNow - 1e-6;
    if (duck) {
      this.roomAlong(world, f);
      this.ownNow = this.room - DUCK_CLEAR;
      const most = MOVE_TUNE.duckMost;
      if (this.want < this.wantNow) this.wantNow = this.want;
      if (this.wantNow < most) this.wantNow = most;
      if (this.ownNow < most) this.ownNow = most;
    } else {
      this.room = Infinity;
      this.want = this.wantNow;
      if (held) {
        this.roomOverFeet(world, f);
        this.ownNow = this.room - DUCK_CLEAR;
      }
    }
    this.tallTo = this.tall;
    if (held) {
      // As tall as it wants where the room over the feet allows it (the crouch key's own snap, today's in the air), else as
      // tall as the room, never shorter than it is.
      this.tallTo = this.wantNow;
      if (this.tallTo > this.ownNow) this.tallTo = this.ownNow;
      if (this.tallTo < this.tall) this.tallTo = this.tall;
      this.ownNow = 1e9;
    } else if (!duck || crouchKey !== this.crouchWas) this.tallTo = this.wantNow;
    else {
      const step = MOVE_TUNE.duckRate * f.dt;
      const w = this.wantNow;
      const t0 = this.tallTo;
      if (w < t0) this.tallTo = t0 - step > w ? t0 - step : w;
      else if (w > t0) this.tallTo = t0 + step < w ? t0 + step : w;
    }
    if (this.tallTo > this.ownNow) this.tallTo = this.ownNow;
    if (this.tallTo > STAND_TALL) this.tallTo = STAND_TALL;
    this.crouchWas = crouchKey;
    this.writeUprightAt(col, f);
    // The pose: the crouch's share between standing and the crouch's height, the bend past it to `duckMost`.
    const t = this.tall;
    let share = crouchKey ? 0 : (STAND_TALL - t) / (STAND_TALL - CROUCH_TALL);
    if (share < 1e-4) share = 0;
    else if (share > 1) share = 1;
    let bend = (CROUCH_TALL - t) / (CROUCH_TALL - MOVE_TUNE.duckMost);
    if (!(bend > 1e-4)) bend = 0;
    else if (bend > 1) bend = 1;
    this.share = share;
    this.bend = bend;
  }

  /**
   * The room over the body's own feet alone (into `room`): one ball cast up from just under `duckMost` at the feet, as the
   * duck's own column there. A ball that starts inside something (the capsule's own space is already in what stands still)
   * leaves no room to grow into (`room` is the height it has, and the clearance).
   */
  private roomOverFeet(world: ShapeWorld, f: ShapeIn): void {
    const ball = (this.ball ??= this.makers.ball(BALL_R));
    const low = MOVE_TUNE.duckMost - 0.02;
    const at = this.at;
    at.x = f.x;
    at.y = f.y + low - BALL_R;
    at.z = f.z;
    this.asks++;
    const hit = world.castShape(at, this.still, this.up, ball, 0, UP_MOST, false, STILL_FLAGS, f.filter);
    this.room = Infinity;
    if (!hit) return;
    const t = hit.time_of_impact;
    if (t < COLUMN_SOLID) {
      this.room = this.tall + DUCK_CLEAR;
      return;
    }
    this.room = low + t;
  }

  /**
   * Before the move, a lying body's collider put where the body is (`a`: the feet and the collider's offset over them), by the
   * engine's own single-precision sums as `StepUp.sync` puts an upright one, under the same rule (`LOCO_TUNE.step.rule`
   * 'mended'): Rapier moves a kinematic body's collider only at its own 60 Hz step, so at 240 frames a second three moves in
   * four were worked out from where the body lay a frame or more before (the review of the round: a lying crawl onto a
   * 0.1 m step sank 14 cm under the floor and crawled on inside the step at 240 alone). The caller asks it only on the ground
   * where the step's own sync would reach an upright body.
   */
  syncLying(col: ShapeCollider, a: { x: number; y: number; z: number; localY: number }): void {
    if (LOCO_TUNE.step.rule !== 'mended' || this.kind !== LYING) return;
    const p = this.at;
    p.x = Math.fround(a.x);
    p.y = Math.fround(Math.fround(a.y) + Math.fround(a.localY));
    p.z = Math.fround(a.z);
    col.setTranslation(p);
    this.synced++;
  }

  /**
   * The room over the body's feet and along its travel (into `room`, and the height the duck allows into `want`). One box
   * over the path first; the columns only where it meets something.
   */
  private roomAlong(world: ShapeWorld, f: ShapeIn): void {
    const r = BODY_CAPSULE.r;
    const most = MOVE_TUNE.duckMost;
    // The way along: the velocity across the ground, else the keys, else nowhere (the feet alone).
    let ux = f.vx;
    let uz = f.vz;
    let v = Math.sqrt(ux * ux + uz * uz);
    if (v > 0.2) {
      ux /= v;
      uz /= v;
      if (v < DUCK_SLOW) v = DUCK_SLOW;
    } else {
      const m = Math.sqrt(f.moveX * f.moveX + f.moveZ * f.moveZ);
      if (m > 0.5) {
        ux = f.moveX / m;
        uz = f.moveZ / m;
        // The keys ask a way the body is not moving along (held up at a roof's edge, or just starting): the lead is timed
        // as for a slow walk, so the capsule shrinks to pass rather than waiting on a speed it cannot have until it has.
        v = DUCK_SLOW;
      } else {
        ux = 0;
        uz = 0;
        v = 0;
      }
    }
    const rate = MOVE_TUNE.duckRate > 0.1 ? MOVE_TUNE.duckRate : 0.1;
    let ahead = ux === 0 && uz === 0 ? 0 : r + MOVE_TUNE.duckAhead + (v * (STAND_TALL - most)) / rate;
    if (ahead > AHEAD_MOST) ahead = AHEAD_MOST;
    // Standing tall with nothing to look along: nothing can come over a still body, so nothing is asked.
    if (ahead === 0 && this.tall >= STAND_TALL - 1e-6 && !f.crouch) {
      this.room = Infinity;
      this.want = STAND_TALL;
      return;
    }
    // The box over the path: from just under `duckMost` to the standing height and the clearance, the capsule's width,
    // from behind the feet by the radius to the far end of the look ahead.
    const low = most - 0.02;
    const high = STAND_TALL + DUCK_CLEAR;
    // The box's last clear answer stands while the body moving along its way is still inside what that box covered: no
    // further on than its margin, no more across than its side, its feet no higher or lower than its reach (the review of the
    // round: asked every frame, walking anywhere asked the engine a box a frame, about 380 bytes a frame of the engine's own
    // answers that today's walk never made). Anything that stands still within the look ahead now was inside it when asked.
    const moving = ux !== 0 || uz !== 0;
    if (moving && this.zoneClear && this.zoneMost === most && this.zoneFilter === f.filter) {
      const dx = f.x - this.zoneX;
      const dz = f.z - this.zoneZ;
      const dy = f.y - this.zoneY;
      const along = dx * this.zoneUx + dz * this.zoneUz;
      let across = dx * this.zoneUz - dz * this.zoneUx;
      if (across < 0) across = -across;
      let turned = ux * this.zoneUz - uz * this.zoneUx;
      if (turned < 0) turned = -turned;
      const cos = ux * this.zoneUx + uz * this.zoneUz;
      if (cos > 0.5 && along >= -1e-3 && along + ahead <= this.zoneReach && across + turned * (ahead + r) <= ZONE_SIDE && dy <= ZONE_UP && dy >= -ZONE_UP) {
        this.boxKept++;
        this.room = Infinity;
        this.want = STAND_TALL;
        return;
      }
    }
    this.zoneClear = false;
    const reach = moving ? ahead + ZONE_MARGIN : ahead;
    const side = moving ? r + ZONE_SIDE : r;
    const len = reach + 2 * r;
    const hy = (high - low) / 2 + ZONE_UP;
    const lenQ = Math.ceil(len * 4) / 4;
    if (!this.zone || this.zoneLen !== lenQ || this.zoneH !== hy || this.zoneW !== side) {
      this.zone = this.makers.cuboid(side, hy, lenQ / 2);
      this.zoneLen = lenQ;
      this.zoneH = hy;
      this.zoneW = side;
    }
    const yaw = moving ? Math.atan2(ux, uz) : 0;
    const q = this.turn;
    q.x = 0;
    q.y = Math.sin(yaw / 2);
    q.z = 0;
    q.w = Math.cos(yaw / 2);
    const at = this.at;
    const mid = lenQ / 2 - r;
    at.x = f.x + ux * mid;
    at.y = f.y + (low + high) / 2;
    at.z = f.z + uz * mid;
    this.asks++;
    this.boxAsked++;
    if (world.intersectionWithShape(at, q, this.zone, STILL_FLAGS, f.filter) === null) {
      if (moving) {
        this.zoneClear = true;
        this.zoneX = f.x;
        this.zoneY = f.y;
        this.zoneZ = f.z;
        this.zoneUx = ux;
        this.zoneUz = uz;
        this.zoneReach = lenQ - 2 * r;
        this.zoneMost = most;
        this.zoneFilter = f.filter;
      }
      this.room = Infinity;
      this.want = STAND_TALL;
      return;
    }
    // The columns: the feet's own, then along the travel every `COLUMN_STEP` to the look ahead's end.
    const ball = (this.ball ??= this.makers.ball(BALL_R));
    const startY = f.y + low - BALL_R;
    // The room over the feet and what the columns allow, kept in fields (a merge of a computed number with a constant one is a
    // number made: the lesson on boxing in CLAUDE.md).
    this.room = Infinity;
    this.want = STAND_TALL;
    let n = ahead > 0 ? Math.ceil(ahead / COLUMN_STEP) : 0;
    // How far along the ball sweeps at knee height before it meets anything: a column ahead is a roof only where the way
    // to it is open under the roof. Past a riser, a ramp's foot, an upslope, a wall or into a solid model's inside (whose
    // surface a cast up meets from beneath) it is no room to duck into, and is passed over.
    this.openNow = 0;
    if (n > 0) {
      const dir = this.way;
      dir.x = ux;
      dir.y = 0;
      dir.z = uz;
      at.x = f.x;
      at.y = startY;
      at.z = f.z;
      this.asks++;
      // (Cast its whole most, AHEAD_MOST, a constant: a number worked out and handed to the engine is a number made.)
      const sweep = world.castShape(at, this.still, dir, ball, 0, AHEAD_MOST, false, STILL_FLAGS, f.filter);
      this.openNow = ahead;
      if (sweep && sweep.time_of_impact < ahead) this.openNow = sweep.time_of_impact;
      if (this.openNow < COLUMN_SOLID) n = 0;
    }
    for (let i = 0; i <= n; i++) {
      this.dNow = 0;
      if (i > 0) this.dNow = (ahead * i) / n;
      const d = this.dNow;
      if (d > this.openNow + 1e-6) break;
      // Over the feet the ball stands as high again as the ground under its rim rises (the slope the body stands on), so
      // a steep floor is never taken for a roof right on top of it.
      this.liftNow = 0;
      if (i === 0) this.liftNow = f.rise;
      const lift = this.liftNow;
      at.x = f.x + ux * d;
      at.y = startY + lift;
      at.z = f.z + uz * d;
      this.asks++;
      const hit = world.castShape(at, this.still, this.up, ball, 0, UP_MOST, false, STILL_FLAGS, f.filter);
      if (!hit) continue;
      const t = hit.time_of_impact;
      // Inside something where the ball starts: a wall, a step or the next stair's riser beside the feet, or a step in the
      // way ahead, which no duck answers (a roof under the deepest duck over the feet cannot be: the capsule is there).
      if (t < COLUMN_SOLID) continue;
      const under = low + lift + t;
      // Over the standing height and its clearance: no roof the duck answers (the cast reaches its constant's most).
      if (under > high) continue;
      if (i === 0) this.room = under;
      // What a column ahead allows now: its room, less the clearance, plus what the shrink at `duckRate` takes off in the
      // time the body needs to bring its capsule over it. A column within `DUCK_BIND` overlaps the capsule's own space and
      // binds at once: a body held up at a roof's edge (the controller keeps its offset off the edge, so the room over its
      // own feet says it fits) is shrunk by the column just ahead, under the roof, and passes.
      this.aNow = under - DUCK_CLEAR;
      if (d > DUCK_BIND && v > 0.01) this.aNow += (rate * (d - DUCK_BIND)) / v;
      if (this.aNow < this.want) this.want = this.aNow;
    }
  }

  /** The eye's height over the feet for an upright capsule this tall (the third person's orbit; first person reads the head). */
  eyeFor(posture: number): number {
    if (this.kind !== UPRIGHT) return posture;
    const t = this.tall;
    // 1.5 standing, the crouch's 1.05 at its height, and down a metre a metre past it.
    const e = t >= CROUCH_TALL ? 1.05 + ((t - CROUCH_TALL) * (1.5 - 1.05)) / (STAND_TALL - CROUCH_TALL) : 1.05 - (CROUCH_TALL - t);
    return e < posture ? e : posture;
  }

  /**
   * How far the body's surface stands from its middle toward a point across the ground (the hit tests' reach), metres: the
   * radius upright, and lying, the radius and the straight half's share along the heading.
   */
  reachToward(px: number, pz: number, fx: number, fz: number): number {
    if (this.kind !== LYING) return BODY_CAPSULE.r;
    const dx = px - fx;
    const dz = pz - fz;
    const n = Math.sqrt(dx * dx + dz * dz);
    if (n < 1e-6) return this.radius;
    const c = (dx * Math.sin(this.lyingYaw) + dz * Math.cos(this.lyingYaw)) / n;
    return this.radius + this.half * (c < 0 ? -c : c);
  }
}
