// The grapple's rope: wrapping round what stands still and, from wave 3, round the hulls of vehicles, and the constraint
// that holds the player's kinematic capsule to it.
//
// The rope is a polyline: the anchor, then up to `maxWraps` bends on things and `maxGroundWraps` on the
// terrain (counted apart, since ground bends a rope at every crease of a crest where a trunk winds it),
// then the player's rope point, the hand. Only the last span moves. Every frame the hand's movement from
// where the rope last saw it to where it is now is swept in pieces against what the rope may bend round:
// where the free span would pass through something, the sweep is searched for the first moment it touches
// (a bisection on the sweep's own parameter, which converges on the edge -- or the tangent of a round
// thing -- rather than on wherever the span happened to strike), and the rope is bent there, a few
// centimetres off along the bisector of the two faces the span meets on its two sides. A bend comes out
// again when the hand crosses back over the plane that holds the span before it and the edge's own line,
// and only once the straightened span is clear. The rope's whole length is spent along the bent path: what
// is free to swing is the length less every fixed span.
//
// **On things that move** (the design's §4.11, shaped in wave 1 and filled in wave 3): every point carries the frame it
// rides -- 0, the world, or a vehicle's hull -- and its place in that frame's own coordinates, and a bend keeps its hinge,
// its contact and its two faces there too. A frame (`RopeFrame`, filled by `grappleFrames.ts`) holds three poses of its
// body: where the query pipeline has it (the last physics step's, the "cast" pose) and where it stands at the frame's
// start and end (that pose led forward by the accumulator's remainder and the frame). Every point's world place is its
// frame's pose at the moment asked times its own place, so `spent` is worked out again every frame a point rides a hull.
// Every cast goes through the families: the still family in the world as it stands, and one family per hull near the
// rope, whose casts take the span's ends into the hull's own frame at their own moments and out again through its cast
// pose (a ray at frame time against a hull a step stale is off by its speed times the lag). The sweep is cut by the
// hand's motion relative to every family, the fan is the quad the free span swept (its second triangle has area once the
// pivot moves), a bend's side is worked out again from its hinge each frame, and a bend on a hull that bends the rope by
// less than `straightDeg` and whose straightened span is clear comes out (`tighten`). A bend whose hull goes away is kept
// as a still bend where it last stood (`freeze`). With every point on the world and no hull near, every step here is the
// still rope's arithmetic exactly: the world's mapping is a copy. Another player's vehicle (wave 3c) is a frame like any
// hull's whose family is a box (`boxMid`, `boxHalf`): its casts, its fan and its depth are the rope's own arithmetic
// (`grappleBox.ts`) in its own coordinates, and nothing of it is ever asked of the engine.
//
// Written the way the prototype that measured every number of it was (A:\swg3js\grapple\proto\rope.ts and r4\mrope.ts):
// kept arrays, one kept ray and one kept triangle, kept answer records, and the engine's own query flags where the
// prototype passed a predicate for the still family (a predicate is called back into script for every collider a ray's
// box passes); its every-frame calls hand their numbers over in kept arrays and fields, and nothing is allocated of its
// own. It imports only types from Rapier (and its lengths and turns from `grappleMath.ts`) and is handed the module and
// the world.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { len3, slerpTurn, turnBy } from './grappleMath.ts';
import { newBoxHit, pointInBox, rayBoxIn, spanMeetsBox, triangleMeetsBox } from './grappleBox.ts';

type R = typeof RAPIER_NS;
type Collider = RAPIER_NS.Collider;

/** `Group.terrain` (src/core/physics.ts), the heightfields' membership bit: a test holds the two equal. */
export const TERRAIN_GROUP = 0x0001;

/** The rope's numbers it reads live, every one of them `GRAPPLE_TUNE`'s (src/player/grapple.ts). */
export interface RopeTune {
  maxWraps: number;
  maxGroundWraps: number;
  startPad: number;
  wrapOffset: number;
  anchorOffset: number;
  searchIters: number;
  chord: number;
  maxPieces: number;
  maxWrapsPerPiece: number;
  unwrapMargin: number;
  sweepLean: number;
  opposedLean: boolean;
  fan: boolean;
  wrap: boolean;
  rebindReach: number;
  tighten: boolean;
  straightDeg: number;
}

/**
 * A moving body the rope can lie on: the world is frame 0 and needs none. A vehicle's hull is one of these
 * (`VehicleSource` in `grappleFrames.ts`), with its pose led to frame time, a pull it can take and its own drive's
 * motion (the design's §4.11 and §3.18). A creature, a mobile, a fighter and another player each become one later.
 */
export interface FrameSource {
  /** Its body while it is something; none once its slot has let go of it. */
  readonly body: RAPIER_NS.RigidBody | null;
  /** Its linear velocity and world turn rate as its own drive moves it, into the kept records. */
  motion(v: { x: number; y: number; z: number }, w: { x: number; y: number; z: number }): void;
  takesPull(): boolean;
  mass(): number;
  /** The rope's tension on it: the impulse `j` at the world point `at`, both kept records (the brake already taken off). */
  pull(j: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }): void;
  readonly radius: number;
  turnInFrameTime(): boolean;
}

/**
 * One frame the rope's points may ride: the world (index 0, with no source), or a moving body's. Its poses are worked
 * out once a frame (`grappleFrames.ts`) and only read here: where the query pipeline has the body (`cp`, `cq`: the last
 * physics step's), and where it stands at the frame's start (`bp`, `bq`) and end (`np`, `nq`). Turns are x, y, z, w.
 *
 * Another player's vehicle (wave 3c) is a frame with a box and no colliders (`boxMid`, `boxHalf`, in its own coordinates):
 * the engine has nothing of it but a sensor every query passes, so its family's casts are the rope's own arithmetic
 * against that box (`grappleBox.ts`), and its cast pose is its own coordinates (`cp` nought, `cq` the identity).
 */
export interface RopeFrame {
  src: FrameSource | null;
  /** Its colliders are cast this frame: a family of the rope's. */
  near: boolean;
  /** This frame's own colliders and nothing else: the family's predicate (null for the world, and for a box). */
  readonly only: ((c: Collider) => boolean) | null;
  readonly cp: Float64Array;
  readonly cq: Float64Array;
  readonly bp: Float64Array;
  readonly bq: Float64Array;
  readonly np: Float64Array;
  readonly nq: Float64Array;
  /** A box in the frame's own coordinates, its middle and half-size, cast by arithmetic in place of colliders; null for any other. */
  readonly boxMid: Float64Array | null;
  readonly boxHalf: Float64Array | null;
}

/** The world as a frame: no body, no poses that move, never a family of its own (the still family is the world's). */
export function worldFrame(): RopeFrame {
  return { src: null, near: false, only: null, cp: new Float64Array(3), cq: Float64Array.of(0, 0, 0, 1), bp: new Float64Array(3), bq: Float64Array.of(0, 0, 0, 1), np: new Float64Array(3), nq: Float64Array.of(0, 0, 0, 1), boxMid: null, boxHalf: null };
}

/** A box frame's turn in its own coordinates, which is where it is cast: none. */
const BOX_TURN = Float64Array.of(0, 0, 0, 1);

/** A set of colliders the rope is cast against, in one frame's own coordinates: the still family alone. */
export interface RopeFamily {
  /** The frame it is cast in (0, the world). */
  frame: number;
  /**
   * Which colliders it is, as the engine's own query flags: for the still family, what is fixed or has no body
   * (the engine counts a collider with no body as fixed), and never a sensor. Flags rather than a predicate: the
   * engine calls a predicate back into script for every collider a ray's box passes, a few hundred bytes each
   * (measured), and a town is many.
   */
  flags: number;
  /** A predicate on top of the flags, for a family the flags cannot say; null for the still family. */
  pred: ((c: Collider) => boolean) | null;
}

/** The engine's query flags for the still family: no sensor, nothing kinematic, nothing dynamic (`QueryFilterFlags`: 8 | 2 | 4). */
export const STILL_FLAGS = 8 | 2 | 4;
/** The engine's query flags for a hull's family: no sensor, nothing fixed, nothing kinematic (8 | 1 | 2); its predicate takes its own colliders. */
export const HULL_FLAGS = 8 | 1 | 2;

/** One ray's answer, kept and refilled: which frame's family met it (0 the world's still family). */
interface RopeHit {
  toi: number;
  nx: number;
  ny: number;
  nz: number;
  collider: Collider | null;
  frame: number;
}

const newHit = (): RopeHit => ({ toi: 0, nx: 0, ny: 0, nz: 0, collider: null, frame: 0 });

/** How far past the fan's first contact a span is tried, in shares of the piece: the contact is a graze, so a hair past it. */
const FAN_STEPS = [0, 1e-5, 1e-4, 1e-3, 3e-3, 1e-2, 3e-2];

/** What the rope did since it was fastened, for the console and the tests. */
export interface RopeStats {
  wraps: number;
  groundWraps: number;
  unwraps: number;
  /** Sweeps whose end was clear but whose fan held something (a thin thing passed in one step). */
  fanHits: number;
  fans: number;
  /** A bend made from the plain hit because no clear start for the bisection existed. */
  fallbacks: number;
  /** A bend refused at either cap (the rope then fouls). */
  capped: number;
  /** An unwrap the geometry asked for and the straightened span refused. */
  unwrapRefused: number;
  casts: number;
  /** Of those, the casts that met something (each costs the engine's wrapper more than a miss). */
  castHits: number;
  /** Of the fans asked, those that met something. */
  fanMet: number;
  /** Casts and fans made in a hull's family (wave 3). */
  hullCasts: number;
  /** Bends on a hull taken out because they bent the rope by less than `straightDeg` (wave 3). */
  tightened: number;
  /** Bends whose hull went, kept as still bends where they last stood (wave 3). */
  frozen: number;
}

/**
 * Whether a collider is the terrain's: its membership is the terrain bit and nothing else. A collider made with
 * no groups of its own (every flora trunk, `createStaticCylinder`) belongs to every group, the terrain's bit
 * among them, and is not the ground.
 */
export function isTerrainCollider(c: Collider | null): boolean {
  if (!c) return false;
  return ((c.collisionGroups() >>> 16) & 0xffff) === TERRAIN_GROUP;
}
const onGround = isTerrainCollider;

/**
 * Which way a bend stands off the contact it is made at (§4.4), as a unit vector into `out`. `io` holds the first
 * face's normal (0-2), the far face's (3-5), the sweep's direction across the span, not unit (6-8), and how far the
 * far face's plane stands from the contact along its own normal (9).
 * - Off the edge along the bisector of the two faces.
 * - Where they agree (a round thing, or both rays on one face): the one normal, leaned back `sweepLean` along the
 *   sweep, which is the side known to be clear.
 * - Where they oppose and are two planes (the far plane past `wrapOffset`: a slab's top and bottom, the hand
 *   straight under a slab the rope is draped over), with `opposedLean`: off the first face and back along the sweep.
 *   Back along the sweep alone left the bend at the edge's own height with its span to the pivot grazing the face.
 * - Where they oppose otherwise (a thin sheet seen edge on; one face met from both sides, which is a graze, and off
 *   whose back face is into the thing the ridge tops), or with `opposedLean` off: back along the sweep alone.
 * Pure: the rope hands it kept numbers, and test 28 holds each branch.
 */
export function bendOffsetDir(io: Float64Array, tune: { sweepLean: number; opposedLean: boolean; wrapOffset: number }, out: { x: number; y: number; z: number }): void {
  const n1x = io[0];
  const n1y = io[1];
  const n1z = io[2];
  const n2x = io[3];
  const n2y = io[4];
  const n2z = io[5];
  const sx = io[6];
  const sy = io[7];
  const sz = io[8];
  const farPlane = io[9];
  const ss = len3(sx, sy, sz);
  const agree = n1x * n2x + n1y * n2y + n1z * n2z;
  let ox = n1x + n2x;
  let oy = n1y + n2y;
  let oz = n1z + n2z;
  if (agree > 0.9 && ss > 1e-9) {
    const lean = tune.sweepLean / ss;
    ox -= sx * lean;
    oy -= sy * lean;
    oz -= sz * lean;
  }
  if (tune.opposedLean && agree < -0.9 && ss > 1e-9 && farPlane > tune.wrapOffset) {
    ox = n1x - sx / ss;
    oy = n1y - sy / ss;
    oz = n1z - sz / ss;
  }
  let ol = len3(ox, oy, oz);
  if (ol < 1e-6) {
    // Faces exactly opposed (a thin sheet seen edge on): back along the sweep.
    ox = -sx;
    oy = -sy;
    oz = -sz;
    ol = ss || 1;
  }
  out.x = ox / ol;
  out.y = oy / ol;
  out.z = oz / ol;
}

export class GrappleRope {
  private readonly R: R;
  private world: RAPIER_NS.World;
  /** Collision groups the rope's rays pass (the player's own filter at the shot). */
  filter: number;
  /**
   * The player's own body. No ray of the still family meets it (it is kinematic, which the family's flags leave
   * out), nor a hull's (which takes its hull's colliders alone); kept for a family that casts through moving bodies.
   */
  exclude: RAPIER_NS.RigidBody | null;
  private readonly tune: RopeTune;
  private readonly ray: RAPIER_NS.Ray;
  /** The fan test's shape, kept: one triangle written in place, at the origin with no turn. */
  private readonly tri: RAPIER_NS.Triangle;
  private readonly origin = { x: 0, y: 0, z: 0 };
  private readonly noTurn = { x: 0, y: 0, z: 0, w: 1 };
  /** Frame 0 is the world; a moving body's frames follow it, filled by whoever keeps them (`grappleFrames.ts`). */
  frames: RopeFrame[] = [worldFrame()];
  /** Every family a cast goes through besides the hulls' own: the still family. */
  readonly families: RopeFamily[];
  /** Some frame's colliders are cast this frame (any frame `near`): worked out by `framesMoved`. */
  hullFamilies = false;

  /** Points kept, the anchor and every bend, and so every array's length. */
  readonly capacity: number;
  /** Per point: its frame (0, the world) and its place in that frame (anchor at 0, bends 1..n). */
  readonly pf: Uint8Array;
  readonly pts: Float64Array;
  /** Per bend: the edge's line, and which side of the plane through it and the incoming span the hand must stay on; in the bend's frame. */
  readonly hinge: Float64Array;
  readonly sideSign: Float64Array;
  /** Per bend: the side it was made with, in the world as it stood then, kept for the tests that hold the side worked out again to it. */
  readonly sideMade: Float64Array;
  /** Per bend: where the span first touched (before the offset), and its two faces, for the lip-over; in the bend's frame. */
  readonly contact: Float64Array;
  readonly face1: Float64Array;
  readonly face2: Float64Array;
  /** Per point: whether it is a bend on the terrain (counted against its own cap). */
  readonly ground: Uint8Array;
  /** Per point: the collider it sits on (the anchor's is checked every frame). */
  readonly cols: (Collider | null)[];
  /** The surface normal the anchor was struck with (in the anchor's frame), for finding it again if its collider is rebuilt. */
  readonly anchorNormal = new Float64Array(3);
  n = 0;
  /** Bends on things, and bends on the terrain. */
  thingBends = 0;
  groundBends = 0;
  /** Points (the anchor and bends) that ride a frame other than the world: the rope touches something that moves. */
  hullPoints = 0;
  /** The whole rope's length, metres. */
  length = 0;
  /** Every fixed span, the anchor to the last bend, at the frame's end. */
  spent = 0;
  attached = false;
  /** A bend was refused at either cap: the grapple lets go ("The line fouled and let go."). */
  fouled = false;
  /** The hand where the rope last saw it. */
  readonly hand = new Float64Array(3);

  readonly stats: RopeStats = { wraps: 0, groundWraps: 0, unwraps: 0, fanHits: 0, fans: 0, fallbacks: 0, capped: 0, unwrapRefused: 0, casts: 0, castHits: 0, fanMet: 0, hullCasts: 0, tightened: 0, frozen: 0 };
  /** Tests only: told of every bend a sweep makes. */
  onBend: ((info: { kind: string; contact?: number[]; n1?: number[]; n2?: number[]; frame?: number }) => void) | null = null;
  /** Where a sweep carries on from after a bend, and at what moment of the frame. */
  private readonly cont = new Float64Array(3);
  private contS = 0.5;
  /**
   * The numbers the every-frame calls hand each other, kept: a span to cast (`cs`) and the moment it is cast at
   * (`cst`), a sweep piece (`sw`: its two ends, then their moments), a fan (`fw`, with its two moments in `fws`) and a
   * trail point (`tp`). A number handed as an argument to a call that is not inlined is a fresh number, which is a few
   * bytes a frame each.
   */
  private readonly cs = new Float64Array(6);
  private cst = 1;
  private readonly sw = new Float64Array(8);
  private readonly fw = new Float64Array(12);
  private readonly fws = new Float64Array(2);
  /** The fan's triangle as asked: its three corners in the world and the moment each stands at. */
  private readonly tv = new Float64Array(9);
  private readonly tt = new Float64Array(3);
  private readonly tp = { x: 0.5, y: 0.5, z: 0.5 };
  /** Where the last bend's span first touched (before the offset), in the world as it stood then. */
  readonly lastContact = new Float64Array(3);
  private readonly hitA = newHit();
  private readonly hitB = newHit();
  private readonly hitC = newHit();
  private readonly hitF = newHit();
  /** What `bendOffsetDir` reads (the two faces, the sweep, the far plane's distance) and the way it answers, kept. */
  private readonly bo = new Float64Array(10);
  private readonly od = { x: 0.5, y: 0.5, z: 0.5 };

  // The frames' mapping, all in kept arrays and fields: the moment it is made at (`st`, 0 the frame's start and 1 its
  // end), the pose of the frame last asked at that moment, and a place in and out.
  private st = 1;
  private poseFi = -1;
  private poseS = 0.5;
  private readonly sp = new Float64Array(3);
  private readonly sq = new Float64Array(4);
  private readonly share = new Float64Array(1);
  private readonly mi = new Float64Array(3);
  private readonly mo = new Float64Array(3);
  private readonly mt = new Float64Array(3);
  /** A span's two ends taken into a hull's cast pose, kept. */
  private readonly ca = new Float64Array(3);
  private readonly cb = new Float64Array(3);
  /** A box frame's cast (wave 3c): the ray's origin and way in its own coordinates, its answer, the fan's triangle and a span's ends there, and the box shrunk by the offset. */
  private readonly bxO = new Float64Array(3);
  private readonly bxD = new Float64Array(3);
  private readonly bxHit = newBoxHit();
  private readonly bxTri = new Float64Array(9);
  private readonly bxA = new Float64Array(3);
  private readonly bxB = new Float64Array(3);
  private readonly bxIn = new Float64Array(3);
  /** The tracking: the hand at the frame's start and end, and the moments the sweep runs between (`fixedS` holds every moment at one, for the attach's trail). */
  private readonly h0 = new Float64Array(3);
  private fixedS = -1;
  /** The sweep's bend hand-over: the piece's start, the blocked point, the far point (each three) and their moments. */
  private readonly bw = new Float64Array(12);
  /** A point's world place, kept: the pivot and its neighbours as a sweep, an unwrap and the tighten read them. */
  private readonly wa = new Float64Array(3);
  private readonly wb = new Float64Array(3);
  private readonly wc = new Float64Array(3);
  private readonly side = { x: 0, y: 0, z: 0 };

  constructor(Rapier: R, world: RAPIER_NS.World, filter: number, exclude: RAPIER_NS.RigidBody | null, tune: RopeTune) {
    this.R = Rapier;
    this.world = world;
    this.filter = filter;
    this.exclude = exclude;
    this.tune = tune;
    this.ray = new Rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    this.tri = new Rapier.Triangle({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    this.families = [{ frame: 0, flags: STILL_FLAGS, pred: null }];
    const max = Math.max(4, Math.round(tune.maxWraps) + Math.round(tune.maxGroundWraps) + 2);
    this.capacity = max;
    this.pf = new Uint8Array(max);
    this.pts = new Float64Array(3 * max);
    this.hinge = new Float64Array(3 * max);
    this.sideSign = new Float64Array(max);
    this.sideMade = new Float64Array(3 * max);
    this.contact = new Float64Array(3 * max);
    this.face1 = new Float64Array(3 * max);
    this.face2 = new Float64Array(3 * max);
    this.ground = new Uint8Array(max);
    this.cols = new Array<Collider | null>(max).fill(null);
  }

  /** The world the rope is cast in, the filter and the body it never meets: set at every attach. */
  use(world: RAPIER_NS.World, filter: number, exclude: RAPIER_NS.RigidBody | null): void {
    this.world = world;
    this.filter = filter;
    this.exclude = exclude;
  }

  /** What is free to swing: the whole length less every fixed span. */
  free(): number {
    return this.length - this.spent;
  }

  // --- the frames' mapping ---------------------------------------------------------------------------------

  /** The frames' poses were worked out again (a new frame of the game): nothing cached of them is kept, and whether any is a family is asked again. */
  framesMoved(): void {
    this.poseFi = -1;
    let any = false;
    const f = this.frames;
    for (let i = 1; i < f.length; i++) if (f[i].near && f[i].src) any = true;
    this.hullFamilies = any;
  }

  /** Frame fi's pose at the moment `st`, into `sp`, `sq`: kept until another frame or moment is asked. */
  private pose(fi: number): void {
    if (fi === this.poseFi && this.st === this.poseS) return;
    const f = this.frames[fi];
    const s = this.st;
    this.sp[0] = f.bp[0] + (f.np[0] - f.bp[0]) * s;
    this.sp[1] = f.bp[1] + (f.np[1] - f.bp[1]) * s;
    this.sp[2] = f.bp[2] + (f.np[2] - f.bp[2]) * s;
    this.share[0] = s;
    slerpTurn(f.bq, f.nq, this.share, this.sq);
    this.poseFi = fi;
    this.poseS = s;
  }

  /** `mi`, a place in frame fi's coordinates, into the world at `st`, in `mo`. The world's is a copy. */
  private toWorld(fi: number): void {
    const o = this.mo;
    const i = this.mi;
    if (fi === 0) {
      o[0] = i[0];
      o[1] = i[1];
      o[2] = i[2];
      return;
    }
    this.pose(fi);
    turnBy(this.sq, false, i, 0, o, 0);
    o[0] += this.sp[0];
    o[1] += this.sp[1];
    o[2] += this.sp[2];
  }

  /** `mi`, a place in the world at `st`, into frame fi's coordinates, in `mo`. */
  private toLocal(fi: number): void {
    const o = this.mo;
    const i = this.mi;
    if (fi === 0) {
      o[0] = i[0];
      o[1] = i[1];
      o[2] = i[2];
      return;
    }
    this.pose(fi);
    const t = this.mt;
    t[0] = i[0] - this.sp[0];
    t[1] = i[1] - this.sp[1];
    t[2] = i[2] - this.sp[2];
    turnBy(this.sq, true, t, 0, o, 0);
  }

  /** `mi`, a direction in frame fi's coordinates, into the world at `st` (or back, `back`), in `mo`. */
  private turnDir(fi: number, back: boolean): void {
    const o = this.mo;
    const i = this.mi;
    if (fi === 0) {
      o[0] = i[0];
      o[1] = i[1];
      o[2] = i[2];
      return;
    }
    this.pose(fi);
    turnBy(this.sq, back, i, 0, o, 0);
  }

  /** `mi`, a place in the world at `st`, to where the query pipeline has frame fi (its cast pose), in `mo`. */
  private toCast(fi: number): void {
    this.toLocal(fi);
    const f = this.frames[fi];
    const o = this.mo;
    turnBy(f.cq, false, o, 0, this.mt, 0);
    o[0] = this.mt[0] + f.cp[0];
    o[1] = this.mt[1] + f.cp[1];
    o[2] = this.mt[2] + f.cp[2];
  }

  /** `mi`, a place where the query pipeline has frame fi, into its own coordinates, in `mo`. */
  private castToLocal(fi: number): void {
    const f = this.frames[fi];
    const t = this.mt;
    t[0] = this.mi[0] - f.cp[0];
    t[1] = this.mi[1] - f.cp[1];
    t[2] = this.mi[2] - f.cp[2];
    turnBy(f.cq, true, t, 0, this.mo, 0);
  }

  /** `mi`, a direction in frame fi's cast pose, into the world at `st`, in `mo`. */
  private castDirToWorld(fi: number): void {
    const f = this.frames[fi];
    turnBy(f.cq, true, this.mi, 0, this.mt, 0);
    this.mi[0] = this.mt[0];
    this.mi[1] = this.mt[1];
    this.mi[2] = this.mt[2];
    this.turnDir(fi, false);
  }

  /** Point i's world place at the moment `st`, into `out` at `o`. */
  private worldOf(i: number, out: Float64Array, o: number): void {
    const k = 3 * i;
    const fi = this.pf[i];
    if (fi === 0) {
      out[o] = this.pts[k];
      out[o + 1] = this.pts[k + 1];
      out[o + 2] = this.pts[k + 2];
      return;
    }
    this.mi[0] = this.pts[k];
    this.mi[1] = this.pts[k + 1];
    this.mi[2] = this.pts[k + 2];
    this.toWorld(fi);
    out[o] = this.mo[0];
    out[o + 1] = this.mo[1];
    out[o + 2] = this.mo[2];
  }

  /** Point i's place in the world at the frame's end (its frame's pose times its own place; the world's is the place itself). */
  pointAt(i: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    if (this.pf[i] === 0) {
      out.x = this.pts[3 * i];
      out.y = this.pts[3 * i + 1];
      out.z = this.pts[3 * i + 2];
      return out;
    }
    return this.pointOnFrame(i, out);
  }

  /**
   * `pointAt` for a point on a hull: a method of its own, so a still rope's `pointAt` stays as small as it ever was and is
   * built into its callers (the hook's every-frame look among them) without spending what they may build in besides,
   * where a number handed back by a call left out would be a fresh one.
   */
  private pointOnFrame(i: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    this.st = 1;
    this.worldOf(i, this.wa, 0);
    out.x = this.wa[0];
    out.y = this.wa[1];
    out.z = this.wa[2];
    return out;
  }

  /** Point i's place in the world at the frame's start. */
  pointAtStart(i: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    if (this.pf[i] === 0) return this.pointAt(i, out);
    this.st = 0;
    this.worldOf(i, this.wa, 0);
    out.x = this.wa[0];
    out.y = this.wa[1];
    out.z = this.wa[2];
    return out;
  }

  /** Bend j's contact in the world at the frame's end, into `out` (the lip-over reads where the lip is). */
  contactAt(j: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const k = 3 * j;
    this.mi[0] = this.contact[k];
    this.mi[1] = this.contact[k + 1];
    this.mi[2] = this.contact[k + 2];
    this.st = 1;
    this.toWorld(this.pf[j]);
    out.x = this.mo[0];
    out.y = this.mo[1];
    out.z = this.mo[2];
    return out;
  }

  /** How far up bend j's two faces point in the world now: the larger of their normals' upward shares (the lip-over's walkable test). */
  faceUp(j: number): number {
    const k = 3 * j;
    const fi = this.pf[j];
    if (fi === 0) return Math.max(this.face1[k + 1], this.face2[k + 1]);
    this.st = 1;
    this.mi[0] = this.face1[k];
    this.mi[1] = this.face1[k + 1];
    this.mi[2] = this.face1[k + 2];
    this.turnDir(fi, false);
    const a = this.mo[1];
    this.mi[0] = this.face2[k];
    this.mi[1] = this.face2[k + 1];
    this.mi[2] = this.face2[k + 2];
    this.turnDir(fi, false);
    return Math.max(a, this.mo[1]);
  }

  /** The anchor's normal in the world at the frame's end, into `out`. */
  anchorNormalAt(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    this.mi[0] = this.anchorNormal[0];
    this.mi[1] = this.anchorNormal[1];
    this.mi[2] = this.anchorNormal[2];
    this.st = 1;
    this.turnDir(this.pf[0], false);
    out.x = this.mo[0];
    out.y = this.mo[1];
    out.z = this.mo[2];
    return out;
  }

  /**
   * Bend j's side worked out again from its hinge and the incoming span as they stand at the frame's end:
   * `sign · normalize(hinge × incoming)`. On one still frame it is the side the bend was made with; on a frame that
   * turns under the point before it, it is what keeps the bend right.
   */
  sideNow(j: number, out: { x: number; y: number; z: number }): boolean {
    this.st = 1;
    return this.sideAt(j, out);
  }

  /** `sideNow` at the moment `st`: the bend and the point before it, and its hinge, all where they stand then. */
  private sideAt(j: number, out: { x: number; y: number; z: number }): boolean {
    const a = this.wa;
    const b = this.wb;
    this.worldOf(j, a, 0);
    this.worldOf(j - 1, b, 0);
    let hx = this.hinge[3 * j];
    let hy = this.hinge[3 * j + 1];
    let hz = this.hinge[3 * j + 2];
    const fi = this.pf[j];
    if (fi !== 0) {
      this.mi[0] = hx;
      this.mi[1] = hy;
      this.mi[2] = hz;
      this.turnDir(fi, false);
      hx = this.mo[0];
      hy = this.mo[1];
      hz = this.mo[2];
    }
    const ix = a[0] - b[0];
    const iy = a[1] - b[1];
    const iz = a[2] - b[2];
    let ex = hy * iz - hz * iy;
    let ey = hz * ix - hx * iz;
    let ez = hx * iy - hy * ix;
    const el = len3(ex, ey, ez);
    if (el < 1e-12) return false;
    const s = this.sideSign[j] / el;
    ex *= s;
    ey *= s;
    ez *= s;
    out.x = ex;
    out.y = ey;
    out.z = ez;
    return true;
  }

  /**
   * Fasten the rope: the anchor where the dart struck, pushed off the surface along its normal, the hand at
   * the launch point (the dart flew the straight launch-to-anchor segment, so the first span is clear by
   * construction), and a length to the launch point that the attach's own tracking then replaces. On frame 0 the
   * point and normal are the world's; on a hull's frame (`fi`) they are already in that hull's own coordinates.
   */
  attach(hx: number, hy: number, hz: number, nx: number, ny: number, nz: number, collider: Collider | null, handX: number, handY: number, handZ: number, fi = 0): void {
    const o = this.tune.anchorOffset;
    this.pf[0] = fi;
    this.pts[0] = hx + nx * o;
    this.pts[1] = hy + ny * o;
    this.pts[2] = hz + nz * o;
    this.anchorNormal[0] = nx;
    this.anchorNormal[1] = ny;
    this.anchorNormal[2] = nz;
    this.cols[0] = collider;
    this.ground[0] = onGround(collider) ? 1 : 0;
    this.n = 0;
    this.thingBends = 0;
    this.groundBends = 0;
    this.hullPoints = fi !== 0 ? 1 : 0;
    this.spent = 0;
    this.fouled = false;
    this.hand[0] = handX;
    this.hand[1] = handY;
    this.hand[2] = handZ;
    this.st = 1;
    this.worldOf(0, this.wa, 0);
    this.length = len3(handX - this.wa[0], handY - this.wa[1], handZ - this.wa[2]);
    this.attached = true;
  }

  /**
   * Track the hand from the launch point along its kept path while the dart flew (`count` points of
   * `trail`, the launch point first), then to where it is now: bends the player swung round meanwhile are
   * made exactly as a swing would make them. The length is unbounded while it does. Any hull near is taken as it
   * stands at the frame's end for every point of the path, which was walked before this frame's poses.
   */
  trackPath(trail: Float64Array, count: number, h: { x: number; y: number; z: number }): void {
    const tp = this.tp;
    this.fixedS = 1;
    for (let i = 1; i < count; i++) {
      tp.x = trail[3 * i];
      tp.y = trail[3 * i + 1];
      tp.z = trail[3 * i + 2];
      this.track(tp);
    }
    this.track(h);
    this.fixedS = -1;
  }

  release(): void {
    this.attached = false;
    this.n = 0;
    this.thingBends = 0;
    this.groundBends = 0;
    this.hullPoints = 0;
    this.spent = 0;
    this.fouled = false;
    for (let i = 0; i < this.cols.length; i++) this.cols[i] = null;
    for (let i = 0; i < this.pf.length; i++) this.pf[i] = 0;
  }

  /** The first thing on the span from a toward b among every family, starting `startPad` along it, at the frame's end. */
  private cast(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: RopeHit): boolean {
    const cs = this.cs;
    cs[0] = ax;
    cs[1] = ay;
    cs[2] = az;
    cs[3] = bx;
    cs[4] = by;
    cs[5] = bz;
    return this.castCs(out);
  }

  /**
   * `cast` over the span in the kept `cs` (a, then b), at the moment in `cst`: the every-frame cast hands its numbers
   * over this way. The still family is cast in the world as it stands; each hull near the rope is cast with the span's
   * two ends taken into its own frame at that moment and out through where the query pipeline has it, its normal
   * brought back into the world.
   */
  private castCs(out: RopeHit): boolean {
    const cs = this.cs;
    const ax = cs[0];
    const ay = cs[1];
    const az = cs[2];
    const bx = cs[3];
    const by = cs[4];
    const bz = cs[5];
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = len3(dx, dy, dz);
    const pad = this.tune.startPad;
    if (!(len > pad + 1e-4)) return false;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    const r = this.ray;
    r.origin.x = ax + ux * pad;
    r.origin.y = ay + uy * pad;
    r.origin.z = az + uz * pad;
    r.dir.x = ux;
    r.dir.y = uy;
    r.dir.z = uz;
    let found = false;
    for (let f = 0; f < this.families.length; f++) {
      // The still family is cast in the world as it stands; a hull's family, through its own pose, below.
      this.stats.casts++;
      const fam = this.families[f];
      const hit = this.world.castRayAndGetNormal(r, len - pad, true, fam.flags, this.filter, undefined, undefined, fam.pred ?? undefined);
      if (!hit) continue;
      this.stats.castHits++;
      const toi = hit.timeOfImpact + pad;
      if (found && toi >= out.toi) continue;
      out.toi = toi;
      out.nx = hit.normal.x;
      out.ny = hit.normal.y;
      out.nz = hit.normal.z;
      out.collider = hit.collider;
      out.frame = 0;
      found = true;
    }
    if (this.hullFamilies) {
      this.csLen = len;
      found = this.castHulls(out, found) || found;
    }
    return found;
  }

  /** The span's length, handed to `castHulls` in a field (a number handed to a call that is not inlined is a fresh number). */
  private csLen = 0;
  /** A box is not met by a span that ends inside it (`castHulls`): off only while `blockedNow` counts. */
  private fromInside = true;

  /** The span in `cs` (its length in `csLen`) against each hull near the rope, at the moment `cst`: better than `out` (if `found`) or nothing. */
  private castHulls(out: RopeHit, found: boolean): boolean {
    const cs = this.cs;
    const len = this.csLen;
    const pad = this.tune.startPad;
    const frames = this.frames;
    const r = this.ray;
    this.st = this.cst;
    let met = false;
    for (let fi = 1; fi < frames.length; fi++) {
      const f = frames[fi];
      if (!f.near || !f.src) continue;
      this.mi[0] = cs[0];
      this.mi[1] = cs[1];
      this.mi[2] = cs[2];
      this.toCast(fi);
      const ca = this.ca;
      ca[0] = this.mo[0];
      ca[1] = this.mo[1];
      ca[2] = this.mo[2];
      this.mi[0] = cs[3];
      this.mi[1] = cs[4];
      this.mi[2] = cs[5];
      this.toCast(fi);
      const ux = (this.mo[0] - ca[0]) / len;
      const uy = (this.mo[1] - ca[1]) / len;
      const uz = (this.mo[2] - ca[2]) / len;
      if (f.boxMid && f.boxHalf) {
        // Another player's vehicle: its box, by the rope's own arithmetic in its own coordinates (which are its cast
        // pose), never asked of the engine, which has nothing of it but a sensor every query passes. A span that ends
        // inside the box is not met by it: that is the hand inside their vehicle, whose sensor the body passes, where the
        // box test (`HullFrames.peerTest`) could not keep it out in one frame, and no bend is ever made on a box from inside.
        // The console's count of blocked spans (`blockedNow`) asks without it, so a rope through their vehicle is counted.
        if (this.fromInside && pointInBox(this.mo, f.boxMid, BOX_TURN, f.boxHalf)) continue;
        const bo = this.bxO;
        const bd = this.bxD;
        bo[0] = ca[0] + ux * pad;
        bo[1] = ca[1] + uy * pad;
        bo[2] = ca[2] + uz * pad;
        bd[0] = ux;
        bd[1] = uy;
        bd[2] = uz;
        this.stats.casts++;
        this.stats.hullCasts++;
        const bh = this.bxHit;
        bh.toi = len - pad;
        if (!rayBoxIn(bo, bd, f.boxMid, BOX_TURN, f.boxHalf, bh)) continue;
        this.stats.castHits++;
        const btoi = bh.toi + pad;
        if ((found || met) && btoi >= out.toi) continue;
        out.toi = btoi;
        this.mi[0] = bh.nx;
        this.mi[1] = bh.ny;
        this.mi[2] = bh.nz;
        this.castDirToWorld(fi);
        out.nx = this.mo[0];
        out.ny = this.mo[1];
        out.nz = this.mo[2];
        out.collider = null;
        out.frame = fi;
        met = true;
        continue;
      }
      r.origin.x = ca[0] + ux * pad;
      r.origin.y = ca[1] + uy * pad;
      r.origin.z = ca[2] + uz * pad;
      r.dir.x = ux;
      r.dir.y = uy;
      r.dir.z = uz;
      this.stats.casts++;
      this.stats.hullCasts++;
      const hit = this.world.castRayAndGetNormal(r, len - pad, true, HULL_FLAGS, this.filter, undefined, undefined, f.only ?? undefined);
      if (!hit) continue;
      this.stats.castHits++;
      const toi = hit.timeOfImpact + pad;
      if ((found || met) && toi >= out.toi) continue;
      out.toi = toi;
      this.mi[0] = hit.normal.x;
      this.mi[1] = hit.normal.y;
      this.mi[2] = hit.normal.z;
      this.castDirToWorld(fi);
      out.nx = this.mo[0];
      out.ny = this.mo[1];
      out.nz = this.mo[2];
      out.collider = hit.collider;
      out.frame = fi;
      met = true;
    }
    return met;
  }

  /** Whether the span between two points is clear, at the frame's end. */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    this.cst = 1;
    return !this.cast(ax, ay, az, bx, by, bz, this.hitC);
  }

  /** `clear` at the moment `cst` the caller set. */
  private clearAt(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    return !this.cast(ax, ay, az, bx, by, bz, this.hitC);
  }

  /** `clearAt` over the span the caller wrote into the kept `cs` (a, then b): what the every-frame passes ask. */
  private clearCs(): boolean {
    return !this.castCs(this.hitC);
  }

  /** Every fixed span worked out again from the points' world places at the frame's end (after a bend is added or taken out, and every frame a point rides a hull). */
  respan(): void {
    let s = 0;
    const p = this.pts;
    if (this.hullPoints === 0) {
      for (let i = 1; i <= this.n; i++) s += len3(p[3 * i] - p[3 * i - 3], p[3 * i + 1] - p[3 * i - 2], p[3 * i + 2] - p[3 * i - 1]);
      this.spent = s;
      return;
    }
    this.st = 1;
    this.spentNow();
    this.spent = this.spentSum;
  }

  /**
   * Every fixed span at the frame's start, for how much a hull dragging a point away lengthened them over the frame, into
   * `spentStart`: a number in a field, never handed back, since the hook asks it every frame a point rides a hull and a
   * number handed back by a call not built in is a fresh one (a rope hung at another player's vehicle made one a frame).
   */
  measureSpentAtStart(): void {
    if (this.hullPoints === 0) {
      this.spentStart = this.spent;
      return;
    }
    this.st = 0;
    this.spentNow();
    this.spentStart = this.spentSum;
  }

  /** What `measureSpentAtStart` worked out, and what `spentNow` last summed. */
  spentStart = 0;
  private spentSum = 0;

  /** Every fixed span at the moment `st`, into `spentSum`. */
  private spentNow(): void {
    let s = 0;
    const a = this.wa;
    const b = this.wb;
    this.worldOf(0, a, 0);
    for (let i = 1; i <= this.n; i++) {
      this.worldOf(i, b, 0);
      s += len3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      a[0] = b[0];
      a[1] = b[1];
      a[2] = b[2];
    }
    this.spentSum = s;
  }

  /** A blocked last span bent at its hit point, with no sweep to search (a hand put somewhere). */
  private ensureClear(hx: number, hy: number, hz: number): void {
    for (let guard = 0; guard < 4; guard++) {
      this.st = 1;
      this.worldOf(this.n, this.wc, 0);
      const px = this.wc[0];
      const py = this.wc[1];
      const pz = this.wc[2];
      this.cst = 1;
      if (!this.cast(px, py, pz, hx, hy, hz, this.hitA)) return;
      const len = len3(hx - px, hy - py, hz - pz);
      const t = this.hitA.toi / len;
      const cx = px + (hx - px) * t;
      const cy = py + (hy - py) * t;
      const cz = pz + (hz - pz) * t;
      const o = this.tune.wrapOffset;
      const h = this.hitA;
      this.st = 1;
      if (!this.push(h.frame, cx + h.nx * o, cy + h.ny * o, cz + h.nz * o, h.nx, h.ny, h.nz, h.nx, h.ny, h.nz, hx, hy, hz, 0, 0, 0, h.collider, cx, cy, cz)) return;
      this.stats.fallbacks++;
    }
  }

  /**
   * Add a bend on frame `fi` at (wx, wy, wz), every number here in the world at the moment `st`. The hinge is the edge's
   * line (the cross of the two face normals) where the faces differ, else the bend's own plane normal; the side is the
   * direction, across the plane through the previous point and that hinge, on which the hand must stay for the bend to
   * hold. What is kept goes into the frame's own coordinates. False at either cap, which fouls the rope.
   */
  private push(fi: number, wx: number, wy: number, wz: number, n1x: number, n1y: number, n1z: number, n2x: number, n2y: number, n2z: number, hx: number, hy: number, hz: number, sx: number, sy: number, sz: number, col: Collider | null, cx: number, cy: number, cz: number): boolean {
    const isGround = onGround(col);
    const T = this.tune;
    if ((isGround ? this.groundBends >= T.maxGroundWraps : this.thingBends >= T.maxWraps) || this.n + 2 > this.capacity) {
      this.stats.capped++;
      this.fouled = true;
      return false;
    }
    // The point before it, in the world at this moment.
    this.worldOf(this.n, this.wb, 0);
    const p = this.wb;
    // Incoming span direction.
    let ix = wx - p[0];
    let iy = wy - p[1];
    let iz = wz - p[2];
    const il = len3(ix, iy, iz) || 1;
    ix /= il;
    iy /= il;
    iz /= il;
    // The hinge: the edge's own line where the two faces differ (an edge, a corner) ...
    let hxn = n1y * n2z - n1z * n2y;
    let hyn = n1z * n2x - n1x * n2z;
    let hzn = n1x * n2y - n1y * n2x;
    let hl = len3(hxn, hyn, hzn);
    // ... unless the edge runs nearly along the span (then it hinges nothing) or the faces agree (a round
    // thing): there the bend's own plane normal, incoming x outgoing (the sweep where the hand is in line).
    const alongEdge = hl > 0 ? Math.abs(hxn * ix + hyn * iy + hzn * iz) / hl : 1;
    if (hl < 0.3 || alongEdge > 0.9) {
      let ox = hx - wx;
      let oy = hy - wy;
      let oz = hz - wz;
      hxn = iy * oz - iz * oy;
      hyn = iz * ox - ix * oz;
      hzn = ix * oy - iy * ox;
      hl = len3(hxn, hyn, hzn);
      if (hl < 1e-6 * (len3(ox, oy, oz) + 1e-9)) {
        ox = sx;
        oy = sy;
        oz = sz;
        hxn = iy * oz - iz * oy;
        hyn = iz * ox - ix * oz;
        hzn = ix * oy - iy * ox;
        hl = len3(hxn, hyn, hzn);
      }
    }
    if (hl < 1e-12) return false;
    hxn /= hl;
    hyn /= hl;
    hzn /= hl;
    // Across the plane that holds the incoming span and the hinge: the side the hand is bent toward.
    let mx = hyn * iz - hzn * iy;
    let my = hzn * ix - hxn * iz;
    let mz = hxn * iy - hyn * ix;
    const ml = len3(mx, my, mz) || 1;
    mx /= ml;
    my /= ml;
    mz /= ml;
    // Oriented by the sweep (the hand carries on the way it was going), else toward the hand.
    const bySweep = sx !== 0 || sy !== 0 || sz !== 0;
    const sign = bySweep ? mx * sx + my * sy + mz * sz : mx * (hx - wx) + my * (hy - wy) + mz * (hz - wz);
    const s = sign < 0 ? -1 : 1;
    this.n++;
    const n = this.n;
    const j = 3 * n;
    this.pf[n] = fi;
    if (fi !== 0) this.hullPoints++;
    this.keepLocal(fi, this.pts, j, wx, wy, wz, false);
    this.keepLocal(fi, this.hinge, j, hxn, hyn, hzn, true);
    this.sideSign[n] = s;
    this.sideMade[j] = mx * s;
    this.sideMade[j + 1] = my * s;
    this.sideMade[j + 2] = mz * s;
    this.keepLocal(fi, this.contact, j, cx, cy, cz, false);
    this.keepLocal(fi, this.face1, j, n1x, n1y, n1z, true);
    this.keepLocal(fi, this.face2, j, n2x, n2y, n2z, true);
    this.cols[n] = col;
    this.ground[n] = isGround ? 1 : 0;
    if (isGround) {
      this.groundBends++;
      this.stats.groundWraps++;
    } else this.thingBends++;
    this.respan();
    this.stats.wraps++;
    return true;
  }

  /** A world place (or with `dir`, a direction) at the moment `st` kept in frame fi's own coordinates at `k` of `arr`. */
  private keepLocal(fi: number, arr: Float64Array, k: number, x: number, y: number, z: number, dir: boolean): void {
    if (fi === 0) {
      arr[k] = x;
      arr[k + 1] = y;
      arr[k + 2] = z;
      return;
    }
    this.mi[0] = x;
    this.mi[1] = y;
    this.mi[2] = z;
    if (dir) this.turnDir(fi, true);
    else this.toLocal(fi);
    arr[k] = this.mo[0];
    arr[k + 1] = this.mo[1];
    arr[k + 2] = this.mo[2];
  }

  /** Bend j taken out, the ones after it moved down a place (the tighten pass; the unwrap takes only the last). */
  private removeBend(j: number): void {
    if (this.ground[j]) this.groundBends--;
    else this.thingBends--;
    if (this.pf[j] !== 0) this.hullPoints--;
    for (let k = j; k < this.n; k++) {
      this.pf[k] = this.pf[k + 1];
      this.sideSign[k] = this.sideSign[k + 1];
      this.ground[k] = this.ground[k + 1];
      this.cols[k] = this.cols[k + 1];
      for (let q = 0; q < 3; q++) {
        const a = 3 * k + q;
        const b = a + 3;
        this.pts[a] = this.pts[b];
        this.hinge[a] = this.hinge[b];
        this.sideMade[a] = this.sideMade[b];
        this.contact[a] = this.contact[b];
        this.face1[a] = this.face1[b];
        this.face2[a] = this.face2[b];
      }
    }
    this.cols[this.n] = null;
    this.pf[this.n] = 0;
    this.n--;
  }

  /**
   * Take bends out from the last one back, while the hand has crossed back over a bend's plane (its side
   * worked out again from its hinge, where both stand at the moment `st`) and the straightened span is clear.
   */
  private unwrap(): number {
    let taken = 0;
    // The hand, handed over in the kept `uw` (a number handed to a call that is not inlined is a fresh number).
    const hx = this.uw[0];
    const hy = this.uw[1];
    const hz = this.uw[2];
    while (this.n > 0) {
      if (!this.sideAt(this.n, this.side)) return taken;
      const sd = this.side;
      // Still on the far side of the bend: it holds. (`sideAt` left the bend in `wa` and the point before it in `wb`.)
      const a = this.wa;
      const d = sd.x * (hx - a[0]) + sd.y * (hy - a[1]) + sd.z * (hz - a[2]);
      if (d > -this.tune.unwrapMargin) return taken;
      const b = this.wb;
      this.cst = this.st;
      const cs = this.cs;
      cs[0] = b[0];
      cs[1] = b[1];
      cs[2] = b[2];
      cs[3] = hx;
      cs[4] = hy;
      cs[5] = hz;
      if (!this.clearCs()) {
        this.stats.unwrapRefused++;
        return taken;
      }
      if (this.ground[this.n]) this.groundBends--;
      else this.thingBends--;
      if (this.pf[this.n] !== 0) this.hullPoints--;
      this.cols[this.n] = null;
      this.pf[this.n] = 0;
      this.n--;
      this.respan();
      this.stats.unwraps++;
      taken++;
    }
    return taken;
  }

  /**
   * The hand has moved from where the rope last saw it to `h`, over the frame (its start to its end): unbend what
   * straightened, then bend the last span round whatever it swept into, piece by piece. The point comes as an object
   * and each piece goes to the sweep in a kept array: a number handed to a call that is not inlined is a fresh number,
   * and this runs every frame. A piece is at most `chord` of the hand's motion relative to every family, and of the
   * pivot's when the pivot rides another frame than the family's.
   */
  track(h: { x: number; y: number; z: number }): void {
    const hx = h.x;
    const hy = h.y;
    const hz = h.z;
    if (!this.attached) return;
    if (!this.tune.wrap) {
      this.hand[0] = hx;
      this.hand[1] = hy;
      this.hand[2] = hz;
      return;
    }
    const ax = this.hand[0];
    const ay = this.hand[1];
    const az = this.hand[2];
    let dist = len3(hx - ax, hy - ay, hz - az);
    if ((this.hullFamilies || this.hullPoints > 0) && this.fixedS < 0) {
      // Handed over in kept records, and the answer back in one: see `uw`.
      const h0 = this.h0;
      h0[0] = ax;
      h0[1] = ay;
      h0[2] = az;
      const h1 = this.h1;
      h1[0] = hx;
      h1[1] = hy;
      h1[2] = hz;
      this.most = dist;
      this.relativeMost();
      dist = this.most;
    }
    let pieces = Math.ceil(dist / this.tune.chord);
    if (pieces < 1) pieces = 1;
    if (pieces > this.tune.maxPieces) pieces = this.tune.maxPieces;
    let p0x = ax;
    let p0y = ay;
    let p0z = az;
    let s0 = this.fixedS < 0 ? 0 : 1;
    for (let i = 1; i <= pieces; i++) {
      const t = i / pieces;
      const p1x = ax + (hx - ax) * t;
      const p1y = ay + (hy - ay) * t;
      const p1z = az + (hz - az) * t;
      const s1 = this.fixedS < 0 ? t : 1;
      // A bend taken out at the piece's end leaves a span already shown clear to it; the piece's start belonged
      // to the bent rope, so sweeping it from the straightened pivot would start from a blocked span.
      this.st = s1;
      const uw = this.uw;
      uw[0] = p1x;
      uw[1] = p1y;
      uw[2] = p1z;
      if (this.unwrap() === 0) {
        const sw = this.sw;
        sw[0] = p0x;
        sw[1] = p0y;
        sw[2] = p0z;
        sw[3] = p1x;
        sw[4] = p1y;
        sw[5] = p1z;
        sw[6] = s0;
        sw[7] = s1;
        this.sweep();
      }
      if (this.fouled) break;
      p0x = p1x;
      p0y = p1y;
      p0z = p1z;
      s0 = s1;
    }
    this.hand[0] = hx;
    this.hand[1] = hy;
    this.hand[2] = hz;
    if (this.hullPoints > 0 && this.tune.tighten) this.tighten();
  }

  /** The hand's place handed to `unwrap`, and the hand's two places and the answer of `relativeMost`, kept. */
  private readonly uw = new Float64Array(3);
  private readonly h1 = new Float64Array(3);
  private most = 0;

  /**
   * The most the hand moved this frame (from `h0` to `h1`) relative to any frame cast or carrying a point, and the pivot
   * relative to every other one, written over `most` where it is more.
   */
  private relativeMost(): void {
    const frames = this.frames;
    const h0 = this.h0;
    const hx = this.h1[0];
    const hy = this.h1[1];
    const hz = this.h1[2];
    let most = this.most;
    const pivFrame = this.pf[this.n];
    // The pivot's own motion through the world, which the still family sees when it rides a hull.
    if (pivFrame !== 0) {
      this.st = 0;
      this.worldOf(this.n, this.wa, 0);
      this.st = 1;
      this.worldOf(this.n, this.wb, 0);
      const d = len3(this.wb[0] - this.wa[0], this.wb[1] - this.wa[1], this.wb[2] - this.wa[2]);
      if (d > most) most = d;
    }
    for (let fi = 1; fi < frames.length; fi++) {
      const f = frames[fi];
      if (!f.src || !f.near) continue;
      this.st = 0;
      this.mi[0] = h0[0];
      this.mi[1] = h0[1];
      this.mi[2] = h0[2];
      this.toLocal(fi);
      const lx = this.mo[0];
      const ly = this.mo[1];
      const lz = this.mo[2];
      this.st = 1;
      this.mi[0] = hx;
      this.mi[1] = hy;
      this.mi[2] = hz;
      this.toLocal(fi);
      let d = len3(this.mo[0] - lx, this.mo[1] - ly, this.mo[2] - lz);
      if (d > most) most = d;
      if (pivFrame !== fi) {
        this.st = 0;
        this.worldOf(this.n, this.mi, 0);
        this.toLocal(fi);
        const qx = this.mo[0];
        const qy = this.mo[1];
        const qz = this.mo[2];
        this.st = 1;
        this.worldOf(this.n, this.mi, 0);
        this.toLocal(fi);
        d = len3(this.mo[0] - qx, this.mo[1] - qy, this.mo[2] - qz);
        if (d > most) most = d;
      }
    }
    this.most = most;
  }

  /**
   * The tighten pass (§4.11), after tracking: a bend on a moving frame that bends the rope by less than `straightDeg`
   * and whose straightened span is clear comes out, whatever its side says. On a hull that turns under the rope (a
   * speeder pitching as it is pulled) a rope lying along a face is lifted into it a hair a frame, and each frame's sweep
   * finds the face and bends there: five bends crawled along a bike's top in two seconds without it. A still bend is
   * never touched.
   */
  private tighten(): void {
    const cosMax = Math.cos((this.tune.straightDeg * Math.PI) / 180);
    this.st = 1;
    for (let j = this.n; j >= 1; j--) {
      if (this.pf[j] === 0) continue;
      const a = this.wa;
      const b = this.wb;
      const c = this.wc;
      this.worldOf(j - 1, a, 0);
      this.worldOf(j, b, 0);
      if (j < this.n) this.worldOf(j + 1, c, 0);
      else {
        // The hand, where `track` has just put it.
        c[0] = this.hand[0];
        c[1] = this.hand[1];
        c[2] = this.hand[2];
      }
      const ix = b[0] - a[0];
      const iy = b[1] - a[1];
      const iz = b[2] - a[2];
      const ox = c[0] - b[0];
      const oy = c[1] - b[1];
      const oz = c[2] - b[2];
      const il = len3(ix, iy, iz);
      const ol = len3(ox, oy, oz);
      if (!(il > 1e-9) || !(ol > 1e-9)) continue;
      if ((ix * ox + iy * oy + iz * oz) / (il * ol) < cosMax) continue;
      this.cst = 1;
      const cs = this.cs;
      cs[0] = a[0];
      cs[1] = a[1];
      cs[2] = a[2];
      cs[3] = c[0];
      cs[4] = c[1];
      cs[5] = c[2];
      if (!this.clearCs()) continue;
      this.removeBend(j);
      this.stats.unwraps++;
      this.stats.tightened++;
      this.st = 1;
    }
    this.respan();
  }

  /** Put the hand somewhere without sweeping: a blocked span is bent at its hit point. */
  place(hx: number, hy: number, hz: number): void {
    this.hand[0] = hx;
    this.hand[1] = hy;
    this.hand[2] = hz;
    if (this.attached && this.tune.wrap) this.ensureClear(hx, hy, hz);
  }

  /**
   * Every point on frame fi made a still point where it last stood (the frame's end pose as last worked out): a hull
   * that went (disposed, destroyed, ghosted for a jump) leaves its bends as still bends, which hold until the hand
   * straightens past them, as a bend whose collider went does. The anchor is the grapple's to let go of first.
   */
  freeze(fi: number): void {
    if (fi === 0) return;
    this.st = 1;
    for (let i = 0; i <= this.n; i++) {
      if (this.pf[i] !== fi) continue;
      const k = 3 * i;
      this.toWorldIn(fi, this.pts, k, false);
      if (i > 0) {
        this.toWorldIn(fi, this.hinge, k, true);
        this.toWorldIn(fi, this.contact, k, false);
        this.toWorldIn(fi, this.face1, k, true);
        this.toWorldIn(fi, this.face2, k, true);
      } else this.toWorldIn(fi, this.anchorNormal, 0, true);
      this.pf[i] = 0;
      this.cols[i] = null;
      this.hullPoints--;
      this.stats.frozen++;
    }
    this.respan();
  }

  /** Three numbers at `k` of `arr` in frame fi's coordinates (a place, or with `dir` a direction) written over with the world's at `st`. */
  private toWorldIn(fi: number, arr: Float64Array, k: number, dir: boolean): void {
    this.mi[0] = arr[k];
    this.mi[1] = arr[k + 1];
    this.mi[2] = arr[k + 2];
    if (dir) this.turnDir(fi, false);
    else this.toWorld(fi);
    arr[k] = this.mo[0];
    arr[k + 1] = this.mo[1];
    arr[k + 2] = this.mo[2];
  }

  /** Every point on frame `from` moved to frame `to` (a slot renumbered), its coordinates unchanged. */
  renumber(from: number, to: number): void {
    for (let i = 0; i <= this.n; i++) if (this.pf[i] === from) this.pf[i] = to;
  }

  /** How many points ride frame fi. */
  pointsOn(fi: number): number {
    let c = 0;
    for (let i = 0; i <= this.n; i++) if (this.pf[i] === fi) c++;
    return c;
  }

  /**
   * Whether anything the rope may bend round meets the fan the free span swept: the quad between the span at
   * the piece's start (pivot w0, hand p0) and at its end (pivot w1, hand p1), as two triangles, each pivot end
   * pulled `startPad` toward the sweep so the bend it sits on is never found. With a still pivot the second
   * triangle has no area and is not asked, and the fan is the triangle (pivot, p0, p1) exactly. The twelve numbers
   * come in the kept `fw` (w0, w1, p0, p1), and the moments of the start and the end in `fws`, since this is asked
   * every frame.
   */
  private fanHit(): boolean {
    const fw = this.fw;
    const w0x = fw[0];
    const w0y = fw[1];
    const w0z = fw[2];
    const w1x = fw[3];
    const w1y = fw[4];
    const w1z = fw[5];
    const p0x = fw[6];
    const p0y = fw[7];
    const p0z = fw[8];
    const p1x = fw[9];
    const p1y = fw[10];
    const p1z = fw[11];
    const sx = p1x - p0x;
    const sy = p1y - p0y;
    const sz = p1z - p0z;
    if (sx * sx + sy * sy + sz * sz < 1e-12) return false;
    const pad = this.tune.startPad;
    const midx = (p0x + p1x) * 0.5;
    const midy = (p0y + p1y) * 0.5;
    const midz = (p0z + p1z) * 0.5;
    // The first triangle: the pivot at the start, the hand at the start and at the end.
    let mx = midx - w0x;
    let my = midy - w0y;
    let mz = midz - w0z;
    let ml = len3(mx, my, mz);
    if (!(ml > pad * 2)) return false;
    let k = pad / ml;
    const tv = this.tv;
    const tt = this.tt;
    tv[0] = w0x + mx * k;
    tv[1] = w0y + my * k;
    tv[2] = w0z + mz * k;
    tv[3] = p0x;
    tv[4] = p0y;
    tv[5] = p0z;
    tv[6] = p1x;
    tv[7] = p1y;
    tv[8] = p1z;
    tt[0] = this.fws[0];
    tt[1] = this.fws[0];
    tt[2] = this.fws[1];
    if (this.triHit()) return true;
    // The second, the pivot at the end, only while it moved.
    const wm = (w1x - w0x) ** 2 + (w1y - w0y) ** 2 + (w1z - w0z) ** 2;
    if (wm <= 1e-10) return false;
    mx = midx - w1x;
    my = midy - w1y;
    mz = midz - w1z;
    ml = len3(mx, my, mz);
    if (!(ml > pad * 2)) return false;
    k = pad / ml;
    tv[3] = p1x;
    tv[4] = p1y;
    tv[5] = p1z;
    tv[6] = w1x + mx * k;
    tv[7] = w1y + my * k;
    tv[8] = w1z + mz * k;
    tt[1] = this.fws[1];
    tt[2] = this.fws[1];
    return this.triHit();
  }

  /**
   * The fan search's numbers, kept (the hand at p0 and at p1, their moments, and the share `t` of the way): `fanOf` reads
   * them from here. Handed over as arguments they were boxed whenever the compiler left `fanOf` out of `sweep`, about a
   * kilobyte a frame on a rope hung at another player's reckoned vehicle, where the fan met its box on every frame.
   */
  private readonly fq = new Float64Array(9);

  /**
   * The fan of the pivot from the hand at p0 to the hand a share `t` of the way to p1 (all in the kept `fq`), into the
   * kept `fw`, the pivot at each end where it stands at that end's moment (a still pivot stands at both, so the second
   * triangle has no area).
   */
  private fanOf(): void {
    const q = this.fq;
    const p0x = q[0];
    const p0y = q[1];
    const p0z = q[2];
    const p1x = q[3];
    const p1y = q[4];
    const p1z = q[5];
    const s0 = q[6];
    const s1 = q[7];
    const t = q[8];
    const fw = this.fw;
    this.st = s0;
    this.worldOf(this.n, fw, 0);
    const st = s0 + (s1 - s0) * t;
    this.st = st;
    this.worldOf(this.n, fw, 3);
    fw[6] = p0x;
    fw[7] = p0y;
    fw[8] = p0z;
    fw[9] = p0x + (p1x - p0x) * t;
    fw[10] = p0y + (p1y - p0y) * t;
    fw[11] = p0z + (p1z - p0z) * t;
    this.fws[0] = s0;
    this.fws[1] = st;
  }

  /** The kept triangle (`tv`, its corners' moments in `tt`) against the still family, then each hull near the rope in its own cast pose. */
  private triHit(): boolean {
    const t = this.tri;
    const tv = this.tv;
    t.a.x = tv[0];
    t.a.y = tv[1];
    t.a.z = tv[2];
    t.b.x = tv[3];
    t.b.y = tv[4];
    t.b.z = tv[5];
    t.c.x = tv[6];
    t.c.y = tv[7];
    t.c.z = tv[8];
    for (let f = 0; f < this.families.length; f++) {
      this.stats.fans++;
      const fam = this.families[f];
      if (this.world.intersectionWithShape(this.origin, this.noTurn, this.tri, fam.flags, this.filter, undefined, undefined, fam.pred ?? undefined) != null) {
        this.stats.fanMet++;
        return true;
      }
    }
    if (!this.hullFamilies) return false;
    const frames = this.frames;
    for (let fi = 1; fi < frames.length; fi++) {
      const fr = frames[fi];
      if (!fr.near || !fr.src) continue;
      if (fr.boxMid && fr.boxHalf) {
        // Another player's vehicle: the triangle in its own coordinates against its box, by arithmetic.
        const bt = this.bxTri;
        for (let c = 0; c < 3; c++) {
          this.st = this.tt[c];
          this.mi[0] = tv[3 * c];
          this.mi[1] = tv[3 * c + 1];
          this.mi[2] = tv[3 * c + 2];
          this.toCast(fi);
          bt[3 * c] = this.mo[0];
          bt[3 * c + 1] = this.mo[1];
          bt[3 * c + 2] = this.mo[2];
        }
        // A hand inside the box (corners one and two are the hand's, or the hand's and the pivot's, which stands outside):
        // the box is not met from inside, as a cast that ends there is not (`castHulls`).
        const hp = this.bxA;
        hp[0] = bt[3];
        hp[1] = bt[4];
        hp[2] = bt[5];
        if (pointInBox(hp, fr.boxMid, BOX_TURN, fr.boxHalf)) continue;
        hp[0] = bt[6];
        hp[1] = bt[7];
        hp[2] = bt[8];
        if (pointInBox(hp, fr.boxMid, BOX_TURN, fr.boxHalf)) continue;
        this.stats.fans++;
        this.stats.hullCasts++;
        if (triangleMeetsBox(bt, fr.boxMid, BOX_TURN, fr.boxHalf)) {
          this.stats.fanMet++;
          return true;
        }
        continue;
      }
      for (let c = 0; c < 3; c++) {
        this.st = this.tt[c];
        this.mi[0] = tv[3 * c];
        this.mi[1] = tv[3 * c + 1];
        this.mi[2] = tv[3 * c + 2];
        this.toCast(fi);
        const v = c === 0 ? t.a : c === 1 ? t.b : t.c;
        v.x = this.mo[0];
        v.y = this.mo[1];
        v.z = this.mo[2];
      }
      this.stats.fans++;
      this.stats.hullCasts++;
      if (this.world.intersectionWithShape(this.origin, this.noTurn, this.tri, HULL_FLAGS, this.filter, undefined, undefined, fr.only ?? undefined) != null) {
        this.stats.fanMet++;
        return true;
      }
    }
    return false;
  }

  /** One sweep piece of the hand, p0 to p1 (the kept `sw`, with their moments), with the last span pivoting on the last point. */
  private sweep(): void {
    const sw = this.sw;
    let p0x = sw[0];
    let p0y = sw[1];
    let p0z = sw[2];
    const p1x = sw[3];
    const p1y = sw[4];
    const p1z = sw[5];
    let s0 = sw[6];
    const s1 = sw[7];
    const T = this.tune;
    const iters = T.searchIters;
    for (let w = 0; w < T.maxWrapsPerPiece; w++) {
      // The pivot where it stands at the piece's end.
      this.st = s1;
      this.worldOf(this.n, this.wc, 0);
      const wx = this.wc[0];
      const wy = this.wc[1];
      const wz = this.wc[2];
      const cs = this.cs;
      cs[0] = wx;
      cs[1] = wy;
      cs[2] = wz;
      cs[3] = p1x;
      cs[4] = p1y;
      cs[5] = p1z;
      this.cst = s1;
      if (!this.castCs(this.hitA)) {
        // The span's end is clear: ask whether anything lies inside the swept fan (a post thinner than the
        // sweep, passed in one step), and if so find the first span that meets it.
        if (!T.fan) return;
        // Written in place rather than through `fanOf`: this is every frame's, and its numbers must not be handed over.
        const fw = this.fw;
        if (this.pf[this.n] === 0) {
          fw[0] = wx;
          fw[1] = wy;
          fw[2] = wz;
        } else {
          this.st = s0;
          this.worldOf(this.n, fw, 0);
        }
        fw[3] = wx;
        fw[4] = wy;
        fw[5] = wz;
        fw[6] = p0x;
        fw[7] = p0y;
        fw[8] = p0z;
        fw[9] = p1x;
        fw[10] = p1y;
        fw[11] = p1z;
        this.fws[0] = s0;
        this.fws[1] = s1;
        if (!this.fanHit()) return;
        // The fan only means something from a clear start: the pivot and the hand where both stood at the piece's start.
        // Every number below goes to its call in a kept record (`cs`, `fq`), never as an argument.
        cs[0] = fw[0];
        cs[1] = fw[1];
        cs[2] = fw[2];
        cs[3] = p0x;
        cs[4] = p0y;
        cs[5] = p0z;
        this.cst = s0;
        if (!this.clearCs()) return;
        const fq = this.fq;
        fq[0] = p0x;
        fq[1] = p0y;
        fq[2] = p0z;
        fq[3] = p1x;
        fq[4] = p1y;
        fq[5] = p1z;
        fq[6] = s0;
        fq[7] = s1;
        let lo = 0;
        let hi = 1;
        for (let it = 0; it < iters; it++) {
          const mid = (lo + hi) * 0.5;
          fq[8] = mid;
          this.fanOf();
          if (this.fanHit()) hi = mid;
          else lo = mid;
        }
        // The span a hair past the first contact meets it; search the sweep up to there as usual.
        let found = false;
        let t = hi;
        for (let s = 0; s < FAN_STEPS.length; s++) {
          t = Math.min(1, hi + FAN_STEPS[s]);
          const sT = s0 + (s1 - s0) * t;
          this.st = sT;
          this.worldOf(this.n, this.wc, 0);
          this.cst = sT;
          cs[0] = this.wc[0];
          cs[1] = this.wc[1];
          cs[2] = this.wc[2];
          cs[3] = p0x + (p1x - p0x) * t;
          cs[4] = p0y + (p1y - p0y) * t;
          cs[5] = p0z + (p1z - p0z) * t;
          if (this.castCs(this.hitA)) {
            found = true;
            break;
          }
        }
        this.stats.fanHits++;
        if (!found) return;
        const qx = p0x + (p1x - p0x) * t;
        const qy = p0y + (p1y - p0y) * t;
        const qz = p0z + (p1z - p0z) * t;
        const sq = s0 + (s1 - s0) * t;
        if (!this.bendFrom(p0x, p0y, p0z, qx, qy, qz, qx, qy, qz, s0, sq, sq)) return;
        p0x = this.cont[0];
        p0y = this.cont[1];
        p0z = this.cont[2];
        s0 = this.contS;
        continue;
      }
      // The pivot and the hand where both stood at the piece's start.
      this.st = s0;
      this.worldOf(this.n, this.wb, 0);
      this.cst = s0;
      cs[0] = this.wb[0];
      cs[1] = this.wb[1];
      cs[2] = this.wb[2];
      cs[3] = p0x;
      cs[4] = p0y;
      cs[5] = p0z;
      if (this.castCs(this.hitB)) {
        // No clear start to search from: bend once at the plain hit, off its own face, and stop for this
        // piece. Chained, plain-hit bends crawl along a face a few centimetres at a time instead of finding its edge.
        const len = len3(p1x - wx, p1y - wy, p1z - wz);
        const t = this.hitA.toi / len;
        const o = T.wrapOffset;
        const h = this.hitA;
        const cx = wx + (p1x - wx) * t;
        const cy = wy + (p1y - wy) * t;
        const cz = wz + (p1z - wz) * t;
        this.onBend?.({ kind: 'fallback', contact: [cx, cy, cz], n1: [h.nx, h.ny, h.nz], frame: h.frame });
        this.st = s1;
        if (this.push(h.frame, cx + h.nx * o, cy + h.ny * o, cz + h.nz * o, h.nx, h.ny, h.nz, h.nx, h.ny, h.nz, p1x, p1y, p1z, p1x - p0x, p1y - p0y, p1z - p0z, h.collider, cx, cy, cz)) this.stats.fallbacks++;
        return;
      }
      if (!this.bendFrom(p0x, p0y, p0z, p1x, p1y, p1z, p1x, p1y, p1z, s0, s1, s1)) return;
      p0x = this.cont[0];
      p0y = this.cont[1];
      p0z = this.cont[2];
      s0 = this.contS;
    }
  }

  /** `bendOnSweep`'s hand-over, its numbers into the kept `bw` (a bend is made seldom, but the sweep that asks is every frame's). */
  private bendFrom(p0x: number, p0y: number, p0z: number, qx: number, qy: number, qz: number, fx: number, fy: number, fz: number, sLo: number, sHi: number, sFar: number): boolean {
    const bw = this.bw;
    bw[0] = p0x;
    bw[1] = p0y;
    bw[2] = p0z;
    bw[3] = qx;
    bw[4] = qy;
    bw[5] = qz;
    bw[6] = fx;
    bw[7] = fy;
    bw[8] = fz;
    bw[9] = sLo;
    bw[10] = sHi;
    bw[11] = sFar;
    return this.bendOnSweep();
  }

  /**
   * One bend from a sweep piece (the kept `bw`): the hand went from p0 (its span clear, at the moment sLo) to q (its span
   * blocked, at sHi); bisect for the first contact, put the bend off the edge, and leave in `cont` (and `contS`) where
   * the sweep carries on from. The far face is cast from the piece's end f (at sFar), in the frame the contact is on
   * and taken to where that frame stood at the contact. False when the bend could not be made (a cap).
   */
  private bendOnSweep(): boolean {
    const bw = this.bw;
    const p0x = bw[0];
    const p0y = bw[1];
    const p0z = bw[2];
    const qx = bw[3];
    const qy = bw[4];
    const qz = bw[5];
    let fx = bw[6];
    let fy = bw[7];
    let fz = bw[8];
    const sLo = bw[9];
    const sHi = bw[10];
    const sFar = bw[11];
    const T = this.tune;
    const iters = T.searchIters;
    // Bisection on the sweep: lo always clear, hi always blocked; the hit at hi converges on the edge.
    let lo = 0;
    let hi = 1;
    const h = this.hitF;
    h.toi = this.hitA.toi;
    h.nx = this.hitA.nx;
    h.ny = this.hitA.ny;
    h.nz = this.hitA.nz;
    h.collider = this.hitA.collider;
    h.frame = this.hitA.frame;
    const moving = this.pf[this.n] !== 0;
    for (let it = 0; it < iters; it++) {
      const mid = (lo + hi) * 0.5;
      const mx = p0x + (qx - p0x) * mid;
      const my = p0y + (qy - p0y) * mid;
      const mz = p0z + (qz - p0z) * mid;
      const sm = sLo + (sHi - sLo) * mid;
      this.st = sm;
      this.worldOf(this.n, this.wc, 0);
      this.cst = sm;
      if (this.cast(this.wc[0], this.wc[1], this.wc[2], mx, my, mz, this.hitB)) {
        hi = mid;
        h.toi = this.hitB.toi;
        h.nx = this.hitB.nx;
        h.ny = this.hitB.ny;
        h.nz = this.hitB.nz;
        h.collider = this.hitB.collider;
        h.frame = this.hitB.frame;
      } else lo = mid;
    }
    // The contact: where the span at hi first meets the obstacle, all of it where it stands at that moment.
    const sh = sLo + (sHi - sLo) * hi;
    this.st = sh;
    this.worldOf(this.n, this.wc, 0);
    const wx = this.wc[0];
    const wy = this.wc[1];
    const wz = this.wc[2];
    const ex = p0x + (qx - p0x) * hi;
    const ey = p0y + (qy - p0y) * hi;
    const ez = p0z + (qz - p0z) * hi;
    const sl = len3(ex - wx, ey - wy, ez - wz);
    const dx = (ex - wx) / sl;
    const dy = (ey - wy) / sl;
    const dz = (ez - wz) / sl;
    const cx = wx + dx * h.toi;
    const cy = wy + dy * h.toi;
    const cz = wz + dz * h.toi;
    const fi = h.frame;
    // The other face: the span from the end of the piece (well past the contact, so not grazing) cast back
    // toward the pivot meets the obstacle on its far side; from the contact itself it would graze the edge
    // and could come back with either face. On a hull the far end is taken to where it stands against the hull at
    // the contact's moment, so the cast is the far point relative to the hull.
    const far = hi < 0.98;
    if (fi !== 0 && far) {
      this.st = sFar;
      this.mi[0] = fx;
      this.mi[1] = fy;
      this.mi[2] = fz;
      this.toLocal(fi);
      this.st = sh;
      this.mi[0] = this.mo[0];
      this.mi[1] = this.mo[1];
      this.mi[2] = this.mo[2];
      this.toWorld(fi);
      fx = this.mo[0];
      fy = this.mo[1];
      fz = this.mo[2];
    }
    let n2x = h.nx;
    let n2y = h.ny;
    let n2z = h.nz;
    // How far the far face's plane stands from the contact along its own normal: a slab's bottom stands its
    // thickness off the top edge, while a face met from behind (a heightfield's cliff, which a ray grazing the
    // ridge from the plateau reports with its normal turned to the ray) is the contact's own plane, nought off.
    let farPlane = 0;
    const sfx = far ? fx : ex;
    const sfy = far ? fy : ey;
    const sfz = far ? fz : ez;
    this.cst = sh;
    if (this.cast(sfx, sfy, sfz, wx, wy, wz, this.hitB)) {
      n2x = this.hitB.nx;
      n2y = this.hitB.ny;
      n2z = this.hitB.nz;
      const fl = len3(wx - sfx, wy - sfy, wz - sfz) || 1;
      const t = this.hitB.toi / fl;
      farPlane = Math.abs((sfx + (wx - sfx) * t - cx) * n2x + (sfy + (wy - sfy) * t - cy) * n2y + (sfz + (wz - sfz) * t - cz) * n2z);
    }
    // The sweep's own direction across the span: the obstacle lies ahead of it, so back along it is always clear. On a
    // hull it is the sweep relative to the hull, where the obstacle is.
    let sx: number;
    let sy: number;
    let sz: number;
    if (fi === 0) {
      sx = fx - p0x;
      sy = fy - p0y;
      sz = fz - p0z;
    } else {
      // f is already where it stands against the hull at sh; p0 is taken there from its own moment.
      this.st = sLo;
      this.mi[0] = p0x;
      this.mi[1] = p0y;
      this.mi[2] = p0z;
      this.toLocal(fi);
      this.st = sh;
      this.mi[0] = this.mo[0];
      this.mi[1] = this.mo[1];
      this.mi[2] = this.mo[2];
      this.toWorld(fi);
      sx = fx - this.mo[0];
      sy = fy - this.mo[1];
      sz = fz - this.mo[2];
    }
    const sweepX = sx;
    const sweepY = sy;
    const sweepZ = sz;
    const sd = sx * dx + sy * dy + sz * dz;
    sx -= dx * sd;
    sy -= dy * sd;
    sz -= dz * sd;
    const ss = len3(sx, sy, sz);
    // Which way off the edge the bend stands: `bendOffsetDir`, over the kept `bo`.
    const bo = this.bo;
    bo[0] = h.nx;
    bo[1] = h.ny;
    bo[2] = h.nz;
    bo[3] = n2x;
    bo[4] = n2y;
    bo[5] = n2z;
    bo[6] = sx;
    bo[7] = sy;
    bo[8] = sz;
    bo[9] = farPlane;
    const od = this.od;
    bendOffsetDir(bo, T, od);
    const ox = od.x;
    const oy = od.y;
    const oz = od.z;
    const off = T.wrapOffset;
    let bx = cx + ox * off;
    let by = cy + oy * off;
    let bz = cz + oz * off;
    // The bend must leave both of its spans clear; if the bisector does not, step back along the sweep instead. The far
    // span is asked at the far end's moment, the bend carried there with its frame.
    this.cst = sh;
    let clearBoth = this.clearAt(wx, wy, wz, bx, by, bz);
    if (clearBoth) {
      if (fi === 0 && !moving) {
        this.cst = sh;
        clearBoth = this.clearAt(bx, by, bz, fx, fy, fz);
      } else {
        this.st = sh;
        this.mi[0] = bx;
        this.mi[1] = by;
        this.mi[2] = bz;
        this.toLocal(fi);
        this.st = sFar;
        this.mi[0] = this.mo[0];
        this.mi[1] = this.mo[1];
        this.mi[2] = this.mo[2];
        this.toWorld(fi);
        this.cst = sFar;
        clearBoth = this.clearAt(this.mo[0], this.mo[1], this.mo[2], bw[6], bw[7], bw[8]);
      }
    }
    if (!clearBoth) {
      if (ss > 1e-9) {
        bx = cx - (sx / ss) * off + ox * off * 0.5;
        by = cy - (sy / ss) * off + oy * off * 0.5;
        bz = cz - (sz / ss) * off + oz * off * 0.5;
      }
    }
    this.st = sh;
    if (!this.push(fi, bx, by, bz, h.nx, h.ny, h.nz, n2x, n2y, n2z, fx, fy, fz, sweepX, sweepY, sweepZ, h.collider, cx, cy, cz)) return false;
    this.lastContact[0] = cx;
    this.lastContact[1] = cy;
    this.lastContact[2] = cz;
    this.onBend?.({ kind: 'sweep', contact: [cx, cy, cz], n1: [h.nx, h.ny, h.nz], n2: [n2x, n2y, n2z], frame: fi });
    this.cont[0] = ex;
    this.cont[1] = ey;
    this.cont[2] = ez;
    this.contS = sh;
    return true;
  }

  /**
   * The anchor's collider went (streamed out, rebuilt): find the surface again a little behind the anchor
   * along the normal it was struck with. True when it holds or was rebound; false when the rope must let go.
   * A still anchor's only: an anchor on a hull goes with its hull (the grapple asks that first).
   */
  rebindAnchor(): boolean {
    const c = this.cols[0];
    if (c && c.isValid()) return true;
    if (this.pf[0] !== 0) return false;
    const p = this.pts;
    const nx = this.anchorNormal[0];
    const ny = this.anchorNormal[1];
    const nz = this.anchorNormal[2];
    const reach = this.tune.rebindReach;
    const pad = this.tune.startPad;
    // From the anchor (which stands `anchorOffset` off the surface) back into it: the surface it was on, rebuilt.
    this.cst = 1;
    if (this.cast(p[0] + nx * pad, p[1] + ny * pad, p[2] + nz * pad, p[0] - nx * reach, p[1] - ny * reach, p[2] - nz * reach, this.hitA) && this.hitA.frame === 0) {
      this.cols[0] = this.hitA.collider;
      return true;
    }
    return false;
  }

  /**
   * Whether the straight span from the anchor to the hand where the caller last wrote it (`hand`) is clear of what
   * stands still: the rope to a loose prop, which never bends, asks this every frame (wave 3). Its numbers go to the
   * cast in the kept arrays, never as arguments.
   */
  anchorSpanClear(): boolean {
    const cs = this.cs;
    cs[0] = this.pts[0];
    cs[1] = this.pts[1];
    cs[2] = this.pts[2];
    cs[3] = this.hand[0];
    cs[4] = this.hand[1];
    cs[5] = this.hand[2];
    this.cst = 1;
    return !this.castCs(this.hitC);
  }

  /**
   * How many of the rope's spans are blocked right now, the free span to the hand included: it must be nought. A span a
   * hull's family meets counts only when it goes into that hull deeper than `wrapOffset` (§4.8): near a moving hull what
   * the clear test meets is a graze within a bend's own few centimetres of its edges, and never a rope through the hull.
   * The console's and the tests' (it allocates on a hull's answer).
   */
  blockedNow(hx: number, hy: number, hz: number): number {
    let blocked = 0;
    this.st = 1;
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    this.fromInside = false;
    try {
      for (let i = 1; i <= this.n + 1; i++) {
        this.worldOf(i - 1, a, 0);
        if (i <= this.n) this.worldOf(i, b, 0);
        else {
          b[0] = hx;
          b[1] = hy;
          b[2] = hz;
        }
        this.cst = 1;
        if (!this.cast(a[0], a[1], a[2], b[0], b[1], b[2], this.hitC)) continue;
        if (this.hitC.frame === 0 || this.deepInHull(this.hitC.frame, a, b)) blocked++;
      }
    } finally {
      this.fromInside = true;
    }
    return blocked;
  }

  /** Whether the span a to b (in the world at the frame's end) goes deeper than `wrapOffset` into frame fi's colliders, sampled. */
  private deepInHull(fi: number, a: Float64Array, b: Float64Array): boolean {
    const f = this.frames[fi];
    const depth = this.tune.wrapOffset;
    if (f.src && f.boxMid && f.boxHalf) {
      // Another player's vehicle: whether the span meets its box shrunk by the offset, exactly, in its own coordinates.
      this.st = 1;
      this.mi[0] = a[0];
      this.mi[1] = a[1];
      this.mi[2] = a[2];
      this.toCast(fi);
      this.bxA.set(this.mo);
      this.mi[0] = b[0];
      this.mi[1] = b[1];
      this.mi[2] = b[2];
      this.toCast(fi);
      this.bxB.set(this.mo);
      const h = this.bxIn;
      for (let k = 0; k < 3; k++) h[k] = f.boxHalf[k] - depth;
      return spanMeetsBox(this.bxA, this.bxB, f.boxMid, BOX_TURN, h);
    }
    if (!f.src || !f.only) return false;
    this.st = 1;
    for (let k = 1; k < 32; k++) {
      const t = k / 32;
      this.mi[0] = a[0] + (b[0] - a[0]) * t;
      this.mi[1] = a[1] + (b[1] - a[1]) * t;
      this.mi[2] = a[2] + (b[2] - a[2]) * t;
      this.toCast(fi);
      const p = { x: this.mo[0], y: this.mo[1], z: this.mo[2] };
      const hit = this.world.projectPoint(p, true, HULL_FLAGS, this.filter, undefined, undefined, f.only);
      if (hit && hit.isInside) {
        const q = hit.point;
        if (Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) > depth) return true;
      }
    }
    return false;
  }
}

/**
 * The constraint on a kinematic body: given the body's velocity (already carrying gravity and whatever else
 * the frame decided), the rope point's place, the pivot and the free length, hold the rope point inside the
 * sphere. A central impulse caps the outward speed at the reel's rate (a rope pulls and never pushes), which
 * leaves the angular momentum about the pivot as it was, so reeling in on the downswing speeds the swing up
 * as a real pendulum's does. The drift a straight step leaves outside the sphere is put back as a position
 * correction that is never kept in the velocity, where it would be energy; `follow`, after the move, rebuilds
 * the velocity round the rope from what the move kept exactly.
 *
 * Both work on the velocity relative to the pivot: its own velocity (`pv`) is taken off first and given back
 * after, and while it is nought, which is every still pivot, nothing is subtracted or added at all. A rope that
 * touches a hull takes its catches through the grapple's own slip and reduced mass instead of `apply` (§3.18).
 */
export class RopeConstraint {
  taut = false;
  /** The outward speed the catch took off this frame (m/s): how hard the catch was. */
  caught = 0;
  /**
   * The free length and the reel's rate (negative reeling in) the next `apply` holds the rope point to, written by
   * the caller: a number handed as an argument to a call that is not inlined is a fresh number each frame, and a
   * field is not.
   */
  free = 0.5;
  reel = 0.5;

  reset(): void {
    this.taut = false;
    this.caught = 0;
  }

  /**
   * Before the move: cap the outward speed of the rope point `p` from the pivot `w`, and say how far to put it
   * back (`corr`). `bounce` is the catch's restitution, `beta` the share of a drift put back, `tautEps` the
   * slack under which the rope is taut. Answers whether it is taut.
   */
  apply(
    vel: { x: number; y: number; z: number },
    p: { x: number; y: number; z: number },
    w: { x: number; y: number; z: number },
    dt: number,
    corr: { x: number; y: number; z: number },
    tune: { bounce: number; beta: number; tautEps: number },
    pv: { x: number; y: number; z: number } | null = null,
  ): boolean {
    corr.x = 0;
    corr.y = 0;
    corr.z = 0;
    this.caught = 0;
    let rx = p.x - w.x;
    let ry = p.y - w.y;
    let rz = p.z - w.z;
    const dist = len3(rx, ry, rz);
    if (!(dist > 1e-6)) {
      this.taut = false;
      return false;
    }
    rx /= dist;
    ry /= dist;
    rz /= dist;
    // How fast the rope point may move out: the reel's rate, plus whatever slack is left this frame.
    const slack = this.free - dist;
    const vr = pv ? (vel.x - pv.x) * rx + (vel.y - pv.y) * ry + (vel.z - pv.z) * rz : vel.x * rx + vel.y * ry + vel.z * rz;
    let allowed = this.reel;
    if (slack > 0) allowed += slack / dt;
    if (vr > allowed) {
      const take = (vr - allowed) * (1 + (slack <= 0 ? tune.bounce : 0));
      vel.x -= rx * take;
      vel.y -= ry * take;
      vel.z -= rz * take;
      this.caught = take;
    }
    // Taut: at the length (or past it), or caught this frame.
    this.taut = slack <= tune.tautEps || this.caught > 0;
    // The drift past the length, put back in place and not in the velocity.
    if (slack < 0) {
      const back = -slack * tune.beta;
      corr.x = -rx * back;
      corr.y = -ry * back;
      corr.z = -rz * back;
    }
    return this.taut;
  }

  /**
   * After the move: while taut, rebuild the velocity at the new place from what the move kept exactly -- the
   * angular momentum about the pivot `h = r × v` and the radial speed `v_r` the rope allowed, both as they were
   * before the move: `v' = v_r·r̂' + (h × r̂') / |r'|`. At a constant length that is the speed kept; reeling in,
   * the speed across the rope grows as old length over new, which is the pendulum's own pump. (Rotating the
   * whole velocity by the rope's turn instead gained energy, and rotating it as though the radius were fixed
   * threw away a quarter of the angular momentum on a reel: only this rebuild is right on both.) `a` and `b` are
   * the rope point before and after, `w0` and `w1` the pivot before and after.
   */
  follow(
    vel: { x: number; y: number; z: number },
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    w0: { x: number; y: number; z: number },
    w1: { x: number; y: number; z: number },
    pv: { x: number; y: number; z: number } | null = null,
  ): void {
    if (!this.taut) return;
    const rax = a.x - w0.x;
    const ray = a.y - w0.y;
    const raz = a.z - w0.z;
    const ra = len3(rax, ray, raz);
    let rbx = b.x - w1.x;
    let rby = b.y - w1.y;
    let rbz = b.z - w1.z;
    const rb = len3(rbx, rby, rbz);
    if (!(ra > 1e-6) || !(rb > 1e-6)) return;
    rbx /= rb;
    rby /= rb;
    rbz /= rb;
    const vx = pv ? vel.x - pv.x : vel.x;
    const vy = pv ? vel.y - pv.y : vel.y;
    const vz = pv ? vel.z - pv.z : vel.z;
    const vr = (vx * rax + vy * ray + vz * raz) / ra;
    const hx = ray * vz - raz * vy;
    const hy = raz * vx - rax * vz;
    const hz = rax * vy - ray * vx;
    vel.x = vr * rbx + (hy * rbz - hz * rby) / rb;
    vel.y = vr * rby + (hz * rbx - hx * rbz) / rb;
    vel.z = vr * rbz + (hx * rby - hy * rbx) / rb;
    if (pv) {
      vel.x += pv.x;
      vel.y += pv.y;
      vel.z += pv.z;
    }
  }
}
