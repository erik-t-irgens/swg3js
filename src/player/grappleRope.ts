// The grapple's rope: wrapping round what stands still, and the constraint that holds the player's
// kinematic capsule to it.
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
// **Shaped for things that move** (the design's §4.11): every point carries the frame it rides (0, the
// world, is the only one yet) and its place in that frame's own coordinates; every bend keeps its hinge and
// the sign of its side, and the side is worked out again from them each frame, which on one still frame is
// exactly the side it was made with; every cast goes through a list of families (the still family alone
// yet); the fan is the quad the free span swept, whose second triangle has no area while the pivot stands
// still; and the constraint works on the hand's velocity relative to its pivot, whose velocity is nought
// yet. A moving hull then joins as a frame and a family without the core being written again.
//
// Written the way the prototype that measured every number of it was (A:\swg3js\grapple\proto\rope.ts):
// kept arrays, one kept ray and one kept triangle, kept answer records, and the engine's own query flags where
// the prototype passed a predicate (a predicate is called back into script for every collider a ray's box
// passes); its every-frame calls hand their numbers over in kept arrays, and nothing is allocated of its own.
// It imports only types from Rapier (and its lengths from `grappleMath.ts`) and is handed the module and the world.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { len3 } from './grappleMath.ts';

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
}

/**
 * A moving body the rope can lie on: the world is frame 0 and needs none. Every rope of this wave rides
 * the world alone; a vehicle joins as one of these, with its pose led to frame time, a pull it can take
 * and its own drive's motion (the design's §4.11 and §3.18).
 */
export interface FrameSource {
  readonly body: RAPIER_NS.RigidBody;
  /** Its linear velocity and world turn rate as its own drive moves it. */
  motion(v: { x: number; y: number; z: number }, w: { x: number; y: number; z: number }): void;
  takesPull(): boolean;
  mass(): number;
  pull(jx: number, jy: number, jz: number, ax: number, ay: number, az: number): void;
  readonly radius: number;
  turnInFrameTime(): boolean;
}

/** A set of colliders the rope is cast against, in one frame's own coordinates: the still family alone yet. */
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
  /** A predicate on top of the flags, for a family the flags cannot say (a hull's); null for the still family. */
  pred: ((c: Collider) => boolean) | null;
}

/** The engine's query flags for the still family: no sensor, nothing kinematic, nothing dynamic (`QueryFilterFlags`: 8 | 2 | 4). */
export const STILL_FLAGS = 8 | 2 | 4;

/** One ray's answer, kept and refilled. */
interface RopeHit {
  toi: number;
  nx: number;
  ny: number;
  nz: number;
  collider: Collider | null;
}

const newHit = (): RopeHit => ({ toi: 0, nx: 0, ny: 0, nz: 0, collider: null });

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
   * out); kept for a family that casts through moving bodies, which must pass it by name.
   */
  exclude: RAPIER_NS.RigidBody | null;
  private readonly tune: RopeTune;
  private readonly ray: RAPIER_NS.Ray;
  /** The fan test's shape, kept: one triangle written in place, at the origin with no turn. */
  private readonly tri: RAPIER_NS.Triangle;
  private readonly origin = { x: 0, y: 0, z: 0 };
  private readonly noTurn = { x: 0, y: 0, z: 0, w: 1 };
  /** Frame 0 is the world (null); a moving body joins as a source. Only the world yet. */
  readonly frames: (FrameSource | null)[] = [null];
  /** Every family a cast goes through: the still family alone yet. */
  readonly families: RopeFamily[];

  /** Points kept, the anchor and every bend, and so every array's length. */
  readonly capacity: number;
  /** Per point: its frame (0, the world) and its place in that frame (anchor at 0, bends 1..n). */
  readonly pf: Uint8Array;
  readonly pts: Float64Array;
  /** Per bend: the edge's line, and which side of the plane through it and the incoming span the hand must stay on. */
  readonly hinge: Float64Array;
  readonly sideSign: Float64Array;
  /** Per bend: the side it was made with, kept for the tests that hold the side worked out again to it. */
  readonly sideMade: Float64Array;
  /** Per bend: where the span first touched (before the offset), and its two faces, for the lip-over. */
  readonly contact: Float64Array;
  readonly face1: Float64Array;
  readonly face2: Float64Array;
  /** Per point: whether it is a bend on the terrain (counted against its own cap). */
  readonly ground: Uint8Array;
  /** Per point: the collider it sits on (the anchor's is checked every frame). */
  readonly cols: (Collider | null)[];
  /** The surface normal the anchor was struck with, for finding it again if its collider is rebuilt. */
  readonly anchorNormal = new Float64Array(3);
  n = 0;
  /** Bends on things, and bends on the terrain. */
  thingBends = 0;
  groundBends = 0;
  /** The whole rope's length, metres. */
  length = 0;
  /** Every fixed span, the anchor to the last bend. */
  spent = 0;
  attached = false;
  /** A bend was refused at either cap: the grapple lets go ("The line fouled and let go."). */
  fouled = false;
  /** The hand where the rope last saw it. */
  readonly hand = new Float64Array(3);

  readonly stats: RopeStats = { wraps: 0, groundWraps: 0, unwraps: 0, fanHits: 0, fans: 0, fallbacks: 0, capped: 0, unwrapRefused: 0, casts: 0, castHits: 0, fanMet: 0 };
  /** Tests only: told of every bend a sweep makes. */
  onBend: ((info: { kind: string; contact?: number[]; n1?: number[]; n2?: number[] }) => void) | null = null;
  /** Where a sweep carries on from after a bend. */
  private readonly cont = new Float64Array(3);
  /**
   * The numbers the every-frame calls hand each other, kept: a span to cast (`cs`), a sweep piece (`sw`), a fan
   * (`fw`) and a trail point (`tp`). A number handed as an argument to a call that is not inlined is a fresh
   * number, which is a few bytes a frame each.
   */
  private readonly cs = new Float64Array(6);
  private readonly sw = new Float64Array(6);
  private readonly fw = new Float64Array(12);
  private readonly tp = { x: 0.5, y: 0.5, z: 0.5 };
  /** Where the last bend's span first touched (before the offset). */
  readonly lastContact = new Float64Array(3);
  private readonly hitA = newHit();
  private readonly hitB = newHit();
  private readonly hitC = newHit();
  private readonly hitF = newHit();
  /** What `bendOffsetDir` reads (the two faces, the sweep, the far plane's distance) and the way it answers, kept. */
  private readonly bo = new Float64Array(10);
  private readonly od = { x: 0.5, y: 0.5, z: 0.5 };

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

  /** Point i's place in the world (its frame's pose times its own place; the world's is the place itself). */
  pointAt(i: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    out.x = this.pts[3 * i];
    out.y = this.pts[3 * i + 1];
    out.z = this.pts[3 * i + 2];
    // A point on a moving frame would be carried through its led pose here; every point is the world's yet.
    return out;
  }

  /**
   * Bend j's side worked out again from its hinge and the incoming span as they stand: `sign · normalize(hinge ×
   * incoming)`. On one still frame it is the side the bend was made with; on a frame that turns under the point
   * before it, it is what keeps the bend right.
   */
  sideNow(j: number, out: { x: number; y: number; z: number }): boolean {
    const p = this.pts;
    const hx = this.hinge[3 * j];
    const hy = this.hinge[3 * j + 1];
    const hz = this.hinge[3 * j + 2];
    const ix = p[3 * j] - p[3 * j - 3];
    const iy = p[3 * j + 1] - p[3 * j - 2];
    const iz = p[3 * j + 2] - p[3 * j - 1];
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
   * construction), and a length to the launch point that the attach's own tracking then replaces.
   */
  attach(hx: number, hy: number, hz: number, nx: number, ny: number, nz: number, collider: Collider | null, handX: number, handY: number, handZ: number): void {
    const o = this.tune.anchorOffset;
    this.pf[0] = 0;
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
    this.spent = 0;
    this.fouled = false;
    this.hand[0] = handX;
    this.hand[1] = handY;
    this.hand[2] = handZ;
    this.length = len3(handX - this.pts[0], handY - this.pts[1], handZ - this.pts[2]);
    this.attached = true;
  }

  /**
   * Track the hand from the launch point along its kept path while the dart flew (`count` points of
   * `trail`, the launch point first), then to where it is now: bends the player swung round meanwhile are
   * made exactly as a swing would make them. The length is unbounded while it does.
   */
  trackPath(trail: Float64Array, count: number, h: { x: number; y: number; z: number }): void {
    const tp = this.tp;
    for (let i = 1; i < count; i++) {
      tp.x = trail[3 * i];
      tp.y = trail[3 * i + 1];
      tp.z = trail[3 * i + 2];
      this.track(tp);
    }
    this.track(h);
  }

  release(): void {
    this.attached = false;
    this.n = 0;
    this.thingBends = 0;
    this.groundBends = 0;
    this.spent = 0;
    this.fouled = false;
    for (let i = 0; i < this.cols.length; i++) this.cols[i] = null;
  }

  /** The first thing on the span from a toward b among every family, starting `startPad` along it. */
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

  /** `cast` over the span in the kept `cs` (a, then b): the every-frame cast hands its numbers over this way. */
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
      // The still family is cast in the world as it stands; a hull's family would be cast through its own pose.
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
      found = true;
    }
    return found;
  }

  /** Whether the span between two points is clear. */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    return !this.cast(ax, ay, az, bx, by, bz, this.hitC);
  }

  /** Every fixed span worked out again from the points (after a bend is added or taken out). */
  respan(): void {
    let s = 0;
    const p = this.pts;
    for (let i = 1; i <= this.n; i++) s += len3(p[3 * i] - p[3 * i - 3], p[3 * i + 1] - p[3 * i - 2], p[3 * i + 2] - p[3 * i - 1]);
    this.spent = s;
  }

  /** A blocked last span bent at its hit point, with no sweep to search (a hand put somewhere). */
  private ensureClear(hx: number, hy: number, hz: number): void {
    for (let guard = 0; guard < 4; guard++) {
      const k = 3 * this.n;
      const p = this.pts;
      if (!this.cast(p[k], p[k + 1], p[k + 2], hx, hy, hz, this.hitA)) return;
      const len = len3(hx - p[k], hy - p[k + 1], hz - p[k + 2]);
      const t = this.hitA.toi / len;
      const cx = p[k] + (hx - p[k]) * t;
      const cy = p[k + 1] + (hy - p[k + 1]) * t;
      const cz = p[k + 2] + (hz - p[k + 2]) * t;
      const o = this.tune.wrapOffset;
      const h = this.hitA;
      if (!this.push(cx + h.nx * o, cy + h.ny * o, cz + h.nz * o, h.nx, h.ny, h.nz, h.nx, h.ny, h.nz, hx, hy, hz, 0, 0, 0, h.collider, cx, cy, cz)) return;
      this.stats.fallbacks++;
    }
  }

  /**
   * Add a bend at (wx, wy, wz). The hinge is the edge's line (the cross of the two face normals) where the
   * faces differ, else the bend's own plane normal; the side is the direction, across the plane through the
   * previous point and that hinge, on which the hand must stay for the bend to hold. False at either cap,
   * which fouls the rope.
   */
  private push(wx: number, wy: number, wz: number, n1x: number, n1y: number, n1z: number, n2x: number, n2y: number, n2z: number, hx: number, hy: number, hz: number, sx: number, sy: number, sz: number, col: Collider | null, cx: number, cy: number, cz: number): boolean {
    const isGround = onGround(col);
    const T = this.tune;
    if ((isGround ? this.groundBends >= T.maxGroundWraps : this.thingBends >= T.maxWraps) || this.n + 2 > this.capacity) {
      this.stats.capped++;
      this.fouled = true;
      return false;
    }
    const p = this.pts;
    const k = 3 * this.n;
    // Incoming span direction.
    let ix = wx - p[k];
    let iy = wy - p[k + 1];
    let iz = wz - p[k + 2];
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
    this.pf[n] = 0;
    p[j] = wx;
    p[j + 1] = wy;
    p[j + 2] = wz;
    this.hinge[j] = hxn;
    this.hinge[j + 1] = hyn;
    this.hinge[j + 2] = hzn;
    this.sideSign[n] = s;
    this.sideMade[j] = mx * s;
    this.sideMade[j + 1] = my * s;
    this.sideMade[j + 2] = mz * s;
    this.contact[j] = cx;
    this.contact[j + 1] = cy;
    this.contact[j + 2] = cz;
    this.face1[j] = n1x;
    this.face1[j + 1] = n1y;
    this.face1[j + 2] = n1z;
    this.face2[j] = n2x;
    this.face2[j + 1] = n2y;
    this.face2[j + 2] = n2z;
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

  private readonly side = { x: 0, y: 0, z: 0 };

  /**
   * Take bends out from the last one back, while the hand has crossed back over a bend's plane (its side
   * worked out again from its hinge) and the straightened span is clear.
   */
  private unwrap(hx: number, hy: number, hz: number): number {
    const p = this.pts;
    let taken = 0;
    while (this.n > 0) {
      const j = 3 * this.n;
      const k = j - 3;
      if (!this.sideNow(this.n, this.side)) return taken;
      const sd = this.side;
      // Still on the far side of the bend: it holds.
      const d = sd.x * (hx - p[j]) + sd.y * (hy - p[j + 1]) + sd.z * (hz - p[j + 2]);
      if (d > -this.tune.unwrapMargin) return taken;
      if (!this.clear(p[k], p[k + 1], p[k + 2], hx, hy, hz)) {
        this.stats.unwrapRefused++;
        return taken;
      }
      if (this.ground[this.n]) this.groundBends--;
      else this.thingBends--;
      this.cols[this.n] = null;
      this.n--;
      this.respan();
      this.stats.unwraps++;
      taken++;
    }
    return taken;
  }

  /**
   * The hand has moved from where the rope last saw it to `h`: unbend what straightened, then bend the last span
   * round whatever it swept into, piece by piece. The point comes as an object and each piece goes to the sweep in
   * a kept array: a number handed to a call that is not inlined is a fresh number, and this runs every frame.
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
    const dist = len3(hx - ax, hy - ay, hz - az);
    let pieces = Math.ceil(dist / this.tune.chord);
    if (pieces < 1) pieces = 1;
    if (pieces > this.tune.maxPieces) pieces = this.tune.maxPieces;
    let p0x = ax;
    let p0y = ay;
    let p0z = az;
    for (let i = 1; i <= pieces; i++) {
      const t = i / pieces;
      const p1x = ax + (hx - ax) * t;
      const p1y = ay + (hy - ay) * t;
      const p1z = az + (hz - az) * t;
      // A bend taken out at the piece's end leaves a span already shown clear to it; the piece's start belonged
      // to the bent rope, so sweeping it from the straightened pivot would start from a blocked span.
      if (this.unwrap(p1x, p1y, p1z) === 0) {
        const sw = this.sw;
        sw[0] = p0x;
        sw[1] = p0y;
        sw[2] = p0z;
        sw[3] = p1x;
        sw[4] = p1y;
        sw[5] = p1z;
        this.sweep();
      }
      if (this.fouled) break;
      p0x = p1x;
      p0y = p1y;
      p0z = p1z;
    }
    this.hand[0] = hx;
    this.hand[1] = hy;
    this.hand[2] = hz;
  }

  /** Put the hand somewhere without sweeping: a blocked span is bent at its hit point. */
  place(hx: number, hy: number, hz: number): void {
    this.hand[0] = hx;
    this.hand[1] = hy;
    this.hand[2] = hz;
    if (this.attached && this.tune.wrap) this.ensureClear(hx, hy, hz);
  }

  /**
   * Whether anything the rope may bend round meets the fan the free span swept: the quad between the span at
   * the piece's start (pivot w0, hand p0) and at its end (pivot w1, hand p1), as two triangles, each pivot end
   * pulled `startPad` toward the sweep so the bend it sits on is never found. With a still pivot the second
   * triangle has no area and is not asked, and the fan is the triangle (pivot, p0, p1) exactly. The twelve numbers
   * come in the kept `fw` (w0, w1, p0, p1), since this is asked every frame.
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
    const t = this.tri;
    t.a.x = w0x + mx * k;
    t.a.y = w0y + my * k;
    t.a.z = w0z + mz * k;
    t.b.x = p0x;
    t.b.y = p0y;
    t.b.z = p0z;
    t.c.x = p1x;
    t.c.y = p1y;
    t.c.z = p1z;
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
    t.b.x = p1x;
    t.b.y = p1y;
    t.b.z = p1z;
    t.c.x = w1x + mx * k;
    t.c.y = w1y + my * k;
    t.c.z = w1z + mz * k;
    return this.triHit();
  }

  /**
   * The fan of a still pivot w from the hand at p0 to the hand a share `t` of the way to p1, into the kept `fw`:
   * the pivot stands at both ends, so the second triangle has no area.
   */
  private fanOf(wx: number, wy: number, wz: number, p0x: number, p0y: number, p0z: number, p1x: number, p1y: number, p1z: number, t: number): void {
    const fw = this.fw;
    fw[0] = wx;
    fw[1] = wy;
    fw[2] = wz;
    fw[3] = wx;
    fw[4] = wy;
    fw[5] = wz;
    fw[6] = p0x;
    fw[7] = p0y;
    fw[8] = p0z;
    fw[9] = p0x + (p1x - p0x) * t;
    fw[10] = p0y + (p1y - p0y) * t;
    fw[11] = p0z + (p1z - p0z) * t;
  }

  private triHit(): boolean {
    for (let f = 0; f < this.families.length; f++) {
      this.stats.fans++;
      const fam = this.families[f];
      if (this.world.intersectionWithShape(this.origin, this.noTurn, this.tri, fam.flags, this.filter, undefined, undefined, fam.pred ?? undefined) != null) {
        this.stats.fanMet++;
        return true;
      }
    }
    return false;
  }

  /** One sweep piece of the hand, p0 to p1 (the kept `sw`), with the last span pivoting on the last point. */
  private sweep(): void {
    const sw = this.sw;
    let p0x = sw[0];
    let p0y = sw[1];
    let p0z = sw[2];
    const p1x = sw[3];
    const p1y = sw[4];
    const p1z = sw[5];
    const p = this.pts;
    const T = this.tune;
    const iters = T.searchIters;
    for (let w = 0; w < T.maxWrapsPerPiece; w++) {
      const k = 3 * this.n;
      const wx = p[k];
      const wy = p[k + 1];
      const wz = p[k + 2];
      const cs = this.cs;
      cs[0] = wx;
      cs[1] = wy;
      cs[2] = wz;
      cs[3] = p1x;
      cs[4] = p1y;
      cs[5] = p1z;
      if (!this.castCs(this.hitA)) {
        // The span's end is clear: ask whether anything lies inside the swept fan (a post thinner than the
        // sweep, passed in one step), and if so find the first span that meets it.
        if (!T.fan) return;
        // Written in place rather than through `fanOf`: this is every frame's, and its numbers must not be handed over.
        const fw = this.fw;
        fw[0] = wx;
        fw[1] = wy;
        fw[2] = wz;
        fw[3] = wx;
        fw[4] = wy;
        fw[5] = wz;
        fw[6] = p0x;
        fw[7] = p0y;
        fw[8] = p0z;
        fw[9] = p1x;
        fw[10] = p1y;
        fw[11] = p1z;
        if (!this.fanHit()) return;
        // The fan only means something from a clear start.
        if (!this.clear(wx, wy, wz, p0x, p0y, p0z)) return;
        let lo = 0;
        let hi = 1;
        for (let it = 0; it < iters; it++) {
          const mid = (lo + hi) * 0.5;
          this.fanOf(wx, wy, wz, p0x, p0y, p0z, p1x, p1y, p1z, mid);
          if (this.fanHit()) hi = mid;
          else lo = mid;
        }
        // The span a hair past the first contact meets it; search the sweep up to there as usual.
        let found = false;
        let t = hi;
        for (let s = 0; s < FAN_STEPS.length; s++) {
          t = Math.min(1, hi + FAN_STEPS[s]);
          if (this.cast(wx, wy, wz, p0x + (p1x - p0x) * t, p0y + (p1y - p0y) * t, p0z + (p1z - p0z) * t, this.hitA)) {
            found = true;
            break;
          }
        }
        this.stats.fanHits++;
        if (!found) return;
        const qx = p0x + (p1x - p0x) * t;
        const qy = p0y + (p1y - p0y) * t;
        const qz = p0z + (p1z - p0z) * t;
        if (!this.bendOnSweep(wx, wy, wz, p0x, p0y, p0z, qx, qy, qz, qx, qy, qz)) return;
        p0x = this.cont[0];
        p0y = this.cont[1];
        p0z = this.cont[2];
        continue;
      }
      if (this.cast(wx, wy, wz, p0x, p0y, p0z, this.hitB)) {
        // No clear start to search from: bend once at the plain hit, off its own face, and stop for this
        // piece. Chained, plain-hit bends crawl along a face a few centimetres at a time instead of finding its edge.
        const len = len3(p1x - wx, p1y - wy, p1z - wz);
        const t = this.hitA.toi / len;
        const o = T.wrapOffset;
        const h = this.hitA;
        const cx = wx + (p1x - wx) * t;
        const cy = wy + (p1y - wy) * t;
        const cz = wz + (p1z - wz) * t;
        this.onBend?.({ kind: 'fallback', contact: [cx, cy, cz], n1: [h.nx, h.ny, h.nz] });
        if (this.push(cx + h.nx * o, cy + h.ny * o, cz + h.nz * o, h.nx, h.ny, h.nz, h.nx, h.ny, h.nz, p1x, p1y, p1z, p1x - p0x, p1y - p0y, p1z - p0z, h.collider, cx, cy, cz)) this.stats.fallbacks++;
        return;
      }
      if (!this.bendOnSweep(wx, wy, wz, p0x, p0y, p0z, p1x, p1y, p1z, p1x, p1y, p1z)) return;
      p0x = this.cont[0];
      p0y = this.cont[1];
      p0z = this.cont[2];
    }
  }

  /**
   * One bend from a sweep piece: the hand went from p0 (its span clear) to q (its span blocked); bisect for
   * the first contact, put the bend off the edge, and leave in `cont` where the sweep carries on from. The
   * far face is cast from the piece's end f. False when the bend could not be made (a cap).
   */
  private bendOnSweep(wx: number, wy: number, wz: number, p0x: number, p0y: number, p0z: number, qx: number, qy: number, qz: number, fx: number, fy: number, fz: number): boolean {
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
    for (let it = 0; it < iters; it++) {
      const mid = (lo + hi) * 0.5;
      const mx = p0x + (qx - p0x) * mid;
      const my = p0y + (qy - p0y) * mid;
      const mz = p0z + (qz - p0z) * mid;
      if (this.cast(wx, wy, wz, mx, my, mz, this.hitB)) {
        hi = mid;
        h.toi = this.hitB.toi;
        h.nx = this.hitB.nx;
        h.ny = this.hitB.ny;
        h.nz = this.hitB.nz;
        h.collider = this.hitB.collider;
      } else lo = mid;
    }
    // The contact: where the span at hi first meets the obstacle.
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
    // The other face: the span from the end of the piece (well past the contact, so not grazing) cast back
    // toward the pivot meets the obstacle on its far side; from the contact itself it would graze the edge
    // and could come back with either face.
    let n2x = h.nx;
    let n2y = h.ny;
    let n2z = h.nz;
    const far = hi < 0.98;
    // How far the far face's plane stands from the contact along its own normal: a slab's bottom stands its
    // thickness off the top edge, while a face met from behind (a heightfield's cliff, which a ray grazing the
    // ridge from the plateau reports with its normal turned to the ray) is the contact's own plane, nought off.
    let farPlane = 0;
    const sfx = far ? fx : ex;
    const sfy = far ? fy : ey;
    const sfz = far ? fz : ez;
    if (this.cast(sfx, sfy, sfz, wx, wy, wz, this.hitB)) {
      n2x = this.hitB.nx;
      n2y = this.hitB.ny;
      n2z = this.hitB.nz;
      const fl = len3(wx - sfx, wy - sfy, wz - sfz) || 1;
      const t = this.hitB.toi / fl;
      farPlane = Math.abs((sfx + (wx - sfx) * t - cx) * n2x + (sfy + (wy - sfy) * t - cy) * n2y + (sfz + (wz - sfz) * t - cz) * n2z);
    }
    // The sweep's own direction across the span: the obstacle lies ahead of it, so back along it is always clear.
    let sx = fx - p0x;
    let sy = fy - p0y;
    let sz = fz - p0z;
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
    // The bend must leave both of its spans clear; if the bisector does not, step back along the sweep instead.
    if (!this.clear(wx, wy, wz, bx, by, bz) || !this.clear(bx, by, bz, fx, fy, fz)) {
      if (ss > 1e-9) {
        bx = cx - (sx / ss) * off + ox * off * 0.5;
        by = cy - (sy / ss) * off + oy * off * 0.5;
        bz = cz - (sz / ss) * off + oz * off * 0.5;
      }
    }
    if (!this.push(bx, by, bz, h.nx, h.ny, h.nz, n2x, n2y, n2z, fx, fy, fz, fx - p0x, fy - p0y, fz - p0z, h.collider, cx, cy, cz)) return false;
    this.lastContact[0] = cx;
    this.lastContact[1] = cy;
    this.lastContact[2] = cz;
    this.onBend?.({ kind: 'sweep', contact: [cx, cy, cz], n1: [h.nx, h.ny, h.nz], n2: [n2x, n2y, n2z] });
    this.cont[0] = ex;
    this.cont[1] = ey;
    this.cont[2] = ez;
    return true;
  }

  /**
   * The anchor's collider went (streamed out, rebuilt): find the surface again a little behind the anchor
   * along the normal it was struck with. True when it holds or was rebound; false when the rope must let go.
   */
  rebindAnchor(): boolean {
    const c = this.cols[0];
    if (c && c.isValid()) return true;
    const p = this.pts;
    const nx = this.anchorNormal[0];
    const ny = this.anchorNormal[1];
    const nz = this.anchorNormal[2];
    const reach = this.tune.rebindReach;
    const pad = this.tune.startPad;
    // From the anchor (which stands `anchorOffset` off the surface) back into it: the surface it was on, rebuilt.
    if (this.cast(p[0] + nx * pad, p[1] + ny * pad, p[2] + nz * pad, p[0] - nx * reach, p[1] - ny * reach, p[2] - nz * reach, this.hitA)) {
      this.cols[0] = this.hitA.collider;
      return true;
    }
    return false;
  }

  /** How many of the rope's spans are blocked right now, the free span to the hand included: it must be nought. */
  blockedNow(hx: number, hy: number, hz: number): number {
    let blocked = 0;
    const p = this.pts;
    for (let i = 1; i <= this.n; i++) if (!this.clear(p[3 * i - 3], p[3 * i - 2], p[3 * i - 1], p[3 * i], p[3 * i + 1], p[3 * i + 2])) blocked++;
    const k = 3 * this.n;
    if (!this.clear(p[k], p[k + 1], p[k + 2], hx, hy, hz)) blocked++;
    return blocked;
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
 * after, and while it is nought, which is every pivot of this wave, nothing is subtracted or added at all.
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
