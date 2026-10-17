// The frames the grapple's rope rides besides the world (the design's §4.11 and §3.18): a vehicle this browser
// simulates, its hull a frame the anchor and the bends may stand in while it moves.
//
// Three clocks meet in a frame of the game. Rapier's bodies and query pipeline stand where the last 60 Hz step left
// them; the player's update runs at the frame's own time, which is ahead of that by the accumulator's remainder at its
// start and by that plus the frame at its end. So once a frame, at the top of the hook's step before the move, every
// hull near the rope (and every hull carrying a point of it) is read -- its place, its turn, its velocity and its turn
// rate -- and led forward to the frame's start and end (`acc` and `acc + dt`; a flown ship's turn, which its drive writes
// in frame time, by `dt` alone; a held hull by nought): the arithmetic of the clamp's own `leadPose`. The rope's points
// on it are carried by those poses, and every cast against it is made in its own frame and taken to where the query
// pipeline has it. The mark, worked out after the frame's physics step, reads each hull again and leads it by the
// accumulator alone.
//
// What the rope rides that moves is met by a test of its own (`hullTest`), not by the character controller, which sweeps
// against a hull where the last step left it: such a hull is marked walk-through for as long as the rope rides it and it
// moves (`Physics.markWalkThrough`, which the player's controller already reads and which takes the capsule out of the
// hull's solver pairing), and a second controller of the player's meets it in its own frame, after the capsule's start is
// pushed out of it (a lead cannot know what the frame's own drive, springs and pull did to the hull's speed).
//
// The vehicle side is `Vehicle`'s own (its pull is `Vehicle.pulled`, nothing else); this file reads its fields and its
// body and imports nothing of it but its type. Every number of ours is `GRAPPLE_TUNE`'s, handed in.
//
// Wave 3c added another player's vehicle (`PeerFrame`, `PeerHullSource`), which in this browser is a picture glided
// toward their states and a sensor box every query passes. The engine is never asked about it: the rope's casts meet its
// box by arithmetic (`grappleBox.ts`), in a pose of the rope's own (`peerPose` 'smooth', dead-reckoned by the relay's
// smoothed velocity eased again, and held back by the glide's mean lag), since riding the picture's sawtooth swings a tow
// by twenty metres a second, and riding the relay's velocity raw hands every state's jitter in when it was heard on to
// the tow; the rope is drawn on the picture all the same, so it ends on the hull everybody sees. While the rope rides it,
// the body is held off its box by the same arithmetic (`peerTest`), as off a hull by the hull test. Nothing is ever put
// on the picture: only its rider's game can move it. What it reads is `RemoteBodies.hullBoxes()`, as the game hands it in
// (`GrappleBody.peerHulls`), never the peers' own records, and its clock is the list's stamp: nothing here reads one.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/physics.ts';
import type { Vehicle } from '../vehicles/vehicle.ts';
import type { FrameSource, RopeFrame } from './grappleRope.ts';
import { worldFrame } from './grappleRope.ts';
import { hullStillIn, leadPose, peerMissIn, peerPoseIn, slerpTurn, turnBy, turnRateIn } from './grappleMath.ts';
import { newBoxHit, rayBoxIn } from './grappleBox.ts';

type R = typeof RAPIER_NS;
type Collider = RAPIER_NS.Collider;

/** How many hulls the rope may ride or be cast against at once: past it a hull near the rope is not seen this frame. */
export const MAX_HULL_FRAMES = 8;
/** How many contacts the hull test hands back a frame. */
export const MAX_HULL_CONTACTS = 8;
/** The physics' own step (`FIXED_DT` in physics.ts): the most a body moves between two reads is its speed times this times the steps between. */
const STEP = 1 / 60;

/**
 * The hull test's own character controller (§3.18), the one maker the player and the node harness both call: the player's
 * own controller's offset, slopes and mass (`Player.makeBody`'s, which `grappleWiring.test.ts` holds these to), no
 * autostep (a hull's face is no stair), no snap and no pushing. It meets a hull the rope rides and that moves, in that
 * hull's own frame, which the player's controller walks through. No body and no collider: made once, in the world.
 */
export function makeHullController(world: RAPIER_NS.World): RAPIER_NS.KinematicCharacterController {
  const hc = world.createCharacterController(0.04);
  hc.disableAutostep();
  hc.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
  hc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
  hc.disableSnapToGround();
  hc.setApplyImpulsesToDynamicBodies(false);
  hc.setCharacterMass(80);
  return hc;
}

/** The numbers of ours this file reads, every one `GRAPPLE_TUNE`'s. */
export interface HullTune {
  vehicles: boolean;
  hullLag: number;
  hullPush: number;
  hullTest: boolean;
  /** Off: the poses where the last step left them, never led, to compare. */
  hullLead: boolean;
  teleportMargin: number;
  /** Another player's vehicle (wave 3c): the pose the rope rides, how fast it eases, its lag and its jump. */
  peerPose: 'smooth' | 'picture';
  peerCorrect: number;
  peerLag: number;
  peerJump: number;
}

/**
 * A vehicle this browser simulates as a frame the rope can lie on (research4's `hulls.ts`): how it moves as its own
 * drive moves it (a held hull not at all, a flown ship's turn from its stick's spin turned by its attitude, else its
 * body's), whether a pull may be put on it, its mass, and the pull itself through `Vehicle.pulled`. One per slot,
 * pointed at whichever vehicle the slot holds.
 */
export class VehicleSource implements FrameSource {
  v: Vehicle | null = null;
  /** The vehicle's body while the slot holds one; none once let go of, so a hull gone with its world is never held here. */
  body: RAPIER_NS.RigidBody | null = null;
  radius = 0;
  /** Its mass, read once when the slot takes it (a vehicle's mass never changes). */
  kg = 0;

  use(v: Vehicle | null): void {
    this.v = v;
    if (!v) {
      this.body = null;
      return;
    }
    this.body = v.body;
    // The sphere round its own bounds, from the body's origin: half the box's diagonal and how far its middle stands off the origin.
    const b = v.spec.bounds;
    const hx = (b.max[0] - b.min[0]) / 2;
    const hy = (b.max[1] - b.min[1]) / 2;
    const hz = (b.max[2] - b.min[2]) / 2;
    const cx = (b.max[0] + b.min[0]) / 2;
    const cy = (b.max[1] + b.min[1]) / 2;
    const cz = (b.max[2] + b.min[2]) / 2;
    this.radius = Math.sqrt(hx * hx + hy * hy + hz * hz) + Math.sqrt(cx * cx + cy * cy + cz * cz);
    this.kg = v.disposed || !v.body.isValid() ? 0 : v.body.mass();
  }

  motion(vo: { x: number; y: number; z: number }, wo: { x: number; y: number; z: number }): void {
    const v = this.v!;
    if (v.holding || v.held) {
      vo.x = 0;
      vo.y = 0;
      vo.z = 0;
      wo.x = 0;
      wo.y = 0;
      wo.z = 0;
      return;
    }
    const body = this.body!;
    const l = body.linvel();
    vo.x = l.x;
    vo.y = l.y;
    vo.z = l.z;
    const race = v.race;
    if (race && race.active) {
      // A race-driven hull's drive writes its turn into the body itself, about the world's up, and its turn rate to
      // nought every step: the turn is the drive's yaw rate (degrees a second).
      wo.x = 0;
      wo.y = (race.w * Math.PI) / 180;
      wo.z = 0;
      return;
    }
    if (v.spec.ship && v.airborne) {
      // flyShip writes the turn into the attitude itself and the body's turn rate to nought every step: the turn is the
      // stick's spin, about the hull's own axes.
      const q = v.attitude;
      const x = v.spin.x;
      const y = v.spin.y;
      const z = v.spin.z;
      const tx = 2 * (q.y * z - q.z * y);
      const ty = 2 * (q.z * x - q.x * z);
      const tz = 2 * (q.x * y - q.y * x);
      wo.x = x + q.w * tx + (q.y * tz - q.z * ty);
      wo.y = y + q.w * ty + (q.z * tx - q.x * tz);
      wo.z = z + q.w * tz + (q.x * ty - q.y * tx);
      return;
    }
    const a = body.angvel();
    wo.x = a.x;
    wo.y = a.y;
    wo.z = a.z;
  }

  turnInFrameTime(): boolean {
    const v = this.v!;
    if (v.holding || v.held) return false;
    return (!!v.spec.ship && v.airborne) || v.raceDriven;
  }

  /**
   * Never a flown, race-driven, held, landed, jump-held, ghosted, disposed or destroyed hull: its drive writes its
   * velocity, or it is not there. A race-driven hull's drive commands its velocity every step and its command wins, so
   * a share of a catch handed to it would be lost at its next step and the catch only partly taken: the player takes
   * the whole of it, as from a flown ship.
   */
  takesPull(): boolean {
    const v = this.v;
    if (!v || v.disposed) return false;
    return !v.ghosted && !v.destroyed && !v.holding && !v.held && !v.landed && !(v.spec.ship && v.airborne) && !v.raceDriven;
  }

  mass(): number {
    return this.kg;
  }

  /** Something drives it: an autopilot (an NPC ship's brain, a shuttle's run, the console's `drive`). A rider cannot be roped: mounting lets go. */
  driven(): boolean {
    return !!this.v?.autopilot;
  }

  pull(j: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }): void {
    this.v?.pulled(j, at);
  }
}

/** One frame slot: a hull's poses this frame, its family's predicate, its walk-through marks and its parked brake. */
export class HullFrame implements RopeFrame {
  src: VehicleSource | null = null;
  readonly vs = new VehicleSource();
  near = false;
  /** The hull's body's handle, for the family's predicate. */
  private handle = -1;
  readonly only = (c: Collider): boolean => {
    const b = c.parent();
    return b !== null && b.handle === this.handle;
  };
  /** A hull has colliders, never a box of the rope's own (that is another player's vehicle's). */
  readonly boxMid: Float64Array | null = null;
  readonly boxHalf: Float64Array | null = null;
  readonly cp = new Float64Array(3);
  readonly cq = Float64Array.of(0, 0, 0, 1);
  readonly bp = new Float64Array(3);
  readonly bq = Float64Array.of(0, 0, 0, 1);
  readonly np = new Float64Array(3);
  readonly nq = Float64Array.of(0, 0, 0, 1);
  /** Its velocity and turn rate as its drive moves it this frame. */
  readonly lv = new Float64Array(3);
  readonly lw = new Float64Array(3);
  /** Rope points on it this frame. */
  carries = 0;
  /** Its lag over the frame, `(|v| + |ω|·r)·(acc + dt)`, and whether that takes it for moving (`hullStill`). */
  lag = 0;
  moving = false;
  /** Marked walk-through, and the very colliders marked, unmarked through these objects and never through its body. */
  marked = false;
  readonly markedColliders: Collider[] = [];
  /** Gone from under the rope since the last frame: disposed, destroyed or ghosted, in the order they are read. */
  gone: '' | 'disposed' | 'destroyed' | 'ghosted' = '';
  /** Moved further between two reads than its speed allows (a teleport, a launch, a dock standing it at its dock). */
  jumped = false;
  /** Its refit count when the rope first rode it. */
  refitsAt = 0;
  /** The parked brake (§3.18): latched at the rope's first pull (at rest then, and nothing driving it), and its kept budget. */
  pulledYet = false;
  braked = false;
  budget = 0;
  /** What the guard compares: the cast pose's place and speed at the last read, and the physics' step count then. */
  readonly lastCp = new Float64Array(3);
  lastSpeed = 0;
  lastSteps = -1;
  /** The moment the next mapping is made at, and its in and out (three each), kept: `toCast`, `localToWorld` and the rest. */
  s = 1;
  readonly io = new Float64Array(6);
  private readonly sp = new Float64Array(3);
  private readonly sq = new Float64Array(4);
  private readonly share = new Float64Array(1);
  private readonly t3 = new Float64Array(3);
  private poseS = -1;

  /** Taken for a vehicle (or let go of, null): everything of the last one forgotten. */
  take(v: Vehicle | null): void {
    this.vs.use(v);
    this.src = v ? this.vs : null;
    this.handle = v && !v.disposed && v.body.isValid() ? v.body.handle : -1;
    this.near = false;
    this.carries = 0;
    this.lag = 0;
    this.moving = false;
    this.gone = '';
    this.jumped = false;
    this.refitsAt = v ? v.refits : 0;
    this.pulledYet = false;
    this.braked = false;
    this.budget = 0;
    this.lastSteps = -1;
    this.lastSpeed = 0;
    this.poseS = -1;
  }

  /** The vehicle in the slot. */
  get vehicle(): Vehicle | null {
    return this.vs.v;
  }

  /** The poses were worked out again: what was cached of them goes. */
  moved(): void {
    this.poseS = -1;
  }

  private pose(): void {
    if (this.s === this.poseS) return;
    const s = this.s;
    this.sp[0] = this.bp[0] + (this.np[0] - this.bp[0]) * s;
    this.sp[1] = this.bp[1] + (this.np[1] - this.bp[1]) * s;
    this.sp[2] = this.bp[2] + (this.np[2] - this.bp[2]) * s;
    this.share[0] = s;
    slerpTurn(this.bq, this.nq, this.share, this.sq);
    this.poseS = s;
  }

  /** `io[0..2]`, a place in the world at `s`, to where the query pipeline has the hull: into `io[3..5]`. */
  toCast(): void {
    this.toLocal();
    const io = this.io;
    this.t3[0] = io[3];
    this.t3[1] = io[4];
    this.t3[2] = io[5];
    turnBy(this.cq, false, this.t3, 0, io, 3);
    io[3] += this.cp[0];
    io[4] += this.cp[1];
    io[5] += this.cp[2];
  }

  /** `io[0..2]`, a place in the world at `s`, into the hull's own coordinates: `io[3..5]`. */
  toLocal(): void {
    this.pose();
    const io = this.io;
    this.t3[0] = io[0] - this.sp[0];
    this.t3[1] = io[1] - this.sp[1];
    this.t3[2] = io[2] - this.sp[2];
    turnBy(this.sq, true, this.t3, 0, io, 3);
  }

  /** `io[0..2]`, a place where the query pipeline has the hull, into its own coordinates: `io[3..5]`. */
  castToLocal(): void {
    const io = this.io;
    this.t3[0] = io[0] - this.cp[0];
    this.t3[1] = io[1] - this.cp[1];
    this.t3[2] = io[2] - this.cp[2];
    turnBy(this.cq, true, this.t3, 0, io, 3);
  }

  /** `io[0..2]`, a place in the hull's own coordinates, into the world at `s`: `io[3..5]`. */
  localToWorld(): void {
    this.pose();
    const io = this.io;
    turnBy(this.sq, false, io, 0, io, 3);
    io[3] += this.sp[0];
    io[4] += this.sp[1];
    io[5] += this.sp[2];
  }

  /** `io[0..2]`, a direction in the cast pose, into the world at `s` (`toWorld` true) or into the hull's own coordinates: `io[3..5]`. */
  castDir(toWorld: boolean): void {
    const io = this.io;
    turnBy(this.cq, true, io, 0, this.t3, 0);
    if (!toWorld) {
      io[3] = this.t3[0];
      io[4] = this.t3[1];
      io[5] = this.t3[2];
      return;
    }
    this.pose();
    turnBy(this.sq, false, this.t3, 0, io, 3);
  }

  /** The hull's point velocity at `io[0..2]` (a place in the world at the frame's end), into `io[3..5]`: `v + ω × (p − origin)`. */
  pointVelocity(): void {
    const io = this.io;
    const rx = io[0] - this.np[0];
    const ry = io[1] - this.np[1];
    const rz = io[2] - this.np[2];
    const w = this.lw;
    io[3] = this.lv[0] + w[1] * rz - w[2] * ry;
    io[4] = this.lv[1] + w[2] * rx - w[0] * rz;
    io[5] = this.lv[2] + w[0] * ry - w[1] * rx;
  }
}

// --- another player's vehicle (wave 3c, §3.18) ------------------------------------------------------------------

/** How many other players' vehicles the rope may ride or be cast against at once: past it one near the rope is not seen this frame. */
export const MAX_PEER_FRAMES = 4;

/**
 * The glide every peer's picture is eased by toward the last state heard, as its time constant (s): `RemotePlayers.update`'s
 * own `1 - Math.exp(-dt / 0.1)`, which `grappleWiring.test.ts` reads equal. The 'picture' pose leads the picture by this
 * glide's step, and in both poses the turn is the picture's own led by the same step toward the turn heard.
 */
export const PEER_GLIDE = 0.1;

/**
 * The gap every player's states are sent at (s): `App.stepNet` sends one at most every 100 ms, which `grappleWiring.test.ts`
 * reads equal. The jump test judges a state against it, since what it measures by is when each state was heard here.
 */
export const PEER_SEND = 0.1;

/** A slot not stepped for longer than this (s, on the list's clock: a panel was open) starts its pose afresh where the states put it. */
const PEER_STALE = 0.25;

/** A peer's box is cast in its own coordinates, where it stands unturned. */
const BOX_TURN = Float64Array.of(0, 0, 0, 1);

/** The controller's own offset (`makeHullController`'s and the player's 0.04 m): the box test keeps the capsule this far off a peer's box, as the controller keeps it off everything else. */
const PEER_SKIN = 0.04;
/** A stop on a face of the grown box is put this hair outside it, so the slide along that face never enters it again. */
const PEER_HAIR = 1e-4;
/** The world's up, which the capsule stands along. */
const UP = Float64Array.of(0, 1, 0);

/** Where a picture is drawn: its place and its turn (three's `Object3D` answers it). */
export interface PeerPicture {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly quaternion: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
}

/**
 * Another player's vehicle as `RemoteBodies.hullBoxes()` hands it on (§3.18): their relay id, the picture drawn here, its
 * own box in the picture's frame (`mid`, `half`: the measured box a bolt stops against, without its pad), and what the
 * relay last said of it: the place and turn heard, the relay's own smoothed velocity, and when (`heardAt`, seconds on the
 * list's clock). Refilled once a frame after the pictures are placed, so the rope reads at each player's update what the
 * frame before left; a mount and a hull docked onto another are never on the list.
 */
export interface PeerHull {
  readonly id: number;
  readonly obj: PeerPicture;
  readonly mid: Float64Array;
  readonly half: Float64Array;
  readonly target: Float64Array;
  readonly turn: Float64Array;
  readonly vel: Float64Array;
  readonly heardAt: number;
}

/**
 * Every peer's vehicle the rope may see, and when the list was last refilled (`stamp`, seconds on the clock `heardAt` is
 * read on): the frame before's own clock, which the game reads once at every frame's start and hands the peers before they
 * are glided (`RemoteBodies.stampHulls`), so the frame's own end is that and the frame. Nothing on the peers' or the rope's
 * path reads a clock of its own: a clock read hands back a fresh number, every frame, for every player who never fires.
 */
export interface PeerHulls {
  readonly list: readonly PeerHull[];
  readonly stamp: number;
}

/**
 * Another player's vehicle as a frame the rope can lie on: its motion is the pose's own over the frame (there is no body),
 * it never takes a pull (it is a picture here, and only its rider's game can move it), and it is infinitely heavy, so the
 * player takes the whole of every catch.
 */
export class PeerHullSource implements FrameSource {
  readonly body: RAPIER_NS.RigidBody | null = null;
  radius = 0;
  /** Their relay id and their picture while the slot holds them. */
  id = 0;
  obj: PeerPicture | null = null;
  /** Its velocity and turn rate over the frame, as its pose moved. */
  readonly lv = new Float64Array(3);
  readonly lw = new Float64Array(3);

  motion(vo: { x: number; y: number; z: number }, wo: { x: number; y: number; z: number }): void {
    vo.x = this.lv[0];
    vo.y = this.lv[1];
    vo.z = this.lv[2];
    wo.x = this.lw[0];
    wo.y = this.lw[1];
    wo.z = this.lw[2];
  }

  takesPull(): boolean {
    return false;
  }

  mass(): number {
    return Infinity;
  }

  /** Nothing: a friend's vehicle tows you and feels nothing (pulling on it is a word on the wire, later). */
  pull(_j: { x: number; y: number; z: number }, _at: { x: number; y: number; z: number }): void {}

  turnInFrameTime(): boolean {
    return false;
  }
}

/** One peer slot: the pose the rope rides on that player's vehicle this frame, its box, and its let-gos' tests. */
export class PeerFrame implements RopeFrame {
  src: PeerHullSource | null = null;
  readonly ps = new PeerHullSource();
  near = false;
  /** No colliders: its family is its box. */
  readonly only = null;
  readonly boxMid = new Float64Array(3);
  readonly boxHalf = new Float64Array(3);
  /** Its cast pose is its own coordinates. */
  readonly cp = new Float64Array(3);
  readonly cq = Float64Array.of(0, 0, 0, 1);
  readonly bp = new Float64Array(3);
  readonly bq = Float64Array.of(0, 0, 0, 1);
  readonly np = new Float64Array(3);
  readonly nq = Float64Array.of(0, 0, 0, 1);
  /** Rope points on it this frame. */
  carries = 0;
  /** No longer that player's shown ride (they left, got off, onto another, or are hidden); or a state landed past `peerJump`. */
  gone: '' | 'gone' = '';
  jumped = false;
  /** The entry it was read from this frame. */
  hull: PeerHull | null = null;
  /** The smooth pose's place before its lag and the velocity it rides (the relay's, eased), kept between frames. */
  readonly smooth = new Float64Array(3);
  readonly smoothVel = new Float64Array(3);
  /** The pose it was last stepped in: a change of `peerPose` starts the smooth one afresh. */
  modeWas = '';
  /** When it was last stepped (on the list's clock), and the last state it heard and what that said, which the next is judged against. */
  steppedAt = -1;
  heardWas = -1;
  readonly lastTarget = new Float64Array(3);
  readonly lastVel = new Float64Array(3);
  /** The last jump test: how far the newest state landed from where the pose expected it (m), and how much of that its timing may account for. */
  lastMiss = 0;
  lastSlack = 0;
  /** The pose against the drawn picture at the frame's start (m), and the most of it over the last whole second and the one running. */
  gap = 0;
  gapMax = 0;
  private gapRun = 0;
  private gapClock = 0;
  /** The mapping's moment and its in and out (three each), as a hull's: `toLocal`, `localToWorld`. */
  s = 1;
  readonly io = new Float64Array(6);
  private readonly sp = new Float64Array(3);
  private readonly sq = new Float64Array(4);
  private readonly share = new Float64Array(1);
  private readonly t3 = new Float64Array(3);

  /** Taken for a peer's vehicle (or let go of, null): everything of the last one forgotten. */
  take(e: PeerHull | null): void {
    this.src = e ? this.ps : null;
    this.ps.id = e ? e.id : 0;
    this.ps.obj = e ? e.obj : null;
    this.hull = e;
    this.near = false;
    this.carries = 0;
    this.gone = '';
    this.jumped = false;
    this.steppedAt = -1;
    this.heardWas = -1;
    this.lastMiss = 0;
    this.lastSlack = 0;
    this.modeWas = '';
    this.gap = 0;
    this.gapMax = 0;
    this.gapRun = 0;
    this.gapClock = 0;
    if (!e) return;
    this.boxOf(e);
  }

  /**
   * Its box, from the entry, written every frame it is stepped: their game measures the picture again when its wings settle
   * and after a refit, and a box taken once at the bite would have the rope wrap foils that had since opened as though they
   * were shut. A point kept in the vehicle's own frame needs nothing more.
   */
  boxOf(e: PeerHull): void {
    const h = e.half;
    const m = e.mid;
    const bm = this.boxMid;
    const bh = this.boxHalf;
    bm[0] = m[0];
    bm[1] = m[1];
    bm[2] = m[2];
    bh[0] = h[0];
    bh[1] = h[1];
    bh[2] = h[2];
    this.ps.radius = Math.sqrt(h[0] * h[0] + h[1] * h[1] + h[2] * h[2]) + Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
  }

  /** This peer's picture: their relay id and the very object, so a ride swapped for another is another frame. */
  is(e: PeerHull): boolean {
    return this.src !== null && this.ps.id === e.id && this.ps.obj === e.obj;
  }

  /** The gap the console reads (`gap`, written first), kept a second at a time over the frame in `gapStep`: numbers in fields, never handed to the call. */
  gapStep = 0;
  noteGap(): void {
    const gap = this.gap;
    if (gap > this.gapRun) this.gapRun = gap;
    this.gapClock += this.gapStep;
    if (this.gapClock >= 1) {
      this.gapMax = this.gapRun;
      this.gapRun = 0;
      this.gapClock = 0;
    }
  }

  /** The most the pose stood off the drawn picture over the last whole second, or this one so far. */
  get gapWorst(): number {
    return Math.max(this.gapMax, this.gapRun);
  }

  private pose(): void {
    const s = this.s;
    this.sp[0] = this.bp[0] + (this.np[0] - this.bp[0]) * s;
    this.sp[1] = this.bp[1] + (this.np[1] - this.bp[1]) * s;
    this.sp[2] = this.bp[2] + (this.np[2] - this.bp[2]) * s;
    this.share[0] = s;
    slerpTurn(this.bq, this.nq, this.share, this.sq);
  }

  /** `io[0..2]`, a place in the world at `s`, into its own coordinates (which are its cast pose): `io[3..5]`. */
  toLocal(): void {
    this.pose();
    const io = this.io;
    this.t3[0] = io[0] - this.sp[0];
    this.t3[1] = io[1] - this.sp[1];
    this.t3[2] = io[2] - this.sp[2];
    turnBy(this.sq, true, this.t3, 0, io, 3);
  }

  /** `io[0..2]`, a place in its own coordinates, into the world at `s`: `io[3..5]`. */
  localToWorld(): void {
    this.pose();
    const io = this.io;
    turnBy(this.sq, false, io, 0, io, 3);
    io[3] += this.sp[0];
    io[4] += this.sp[1];
    io[5] += this.sp[2];
  }

  /** `io[0..2]`, a direction in its own coordinates, into the world at `s`: `io[3..5]`. */
  dirToWorld(): void {
    this.pose();
    turnBy(this.sq, false, this.io, 0, this.io, 3);
  }

  /** The pose's point velocity at `io[0..2]` (a place in the world at the frame's end), into `io[3..5]`. */
  pointVelocity(): void {
    const io = this.io;
    const rx = io[0] - this.np[0];
    const ry = io[1] - this.np[1];
    const rz = io[2] - this.np[2];
    const v = this.ps.lv;
    const w = this.ps.lw;
    io[3] = v[0] + w[1] * rz - w[2] * ry;
    io[4] = v[1] + w[2] * rx - w[0] * rz;
    io[5] = v[2] + w[0] * ry - w[1] * rx;
  }
}

/** A hit of a hull family: which slot, the point and normal in the hull's own coordinates and in the world, and when in the cast. */
export interface HullHit {
  slot: number;
  /** Of the cast's length, the share before the hit (to compare with the still family's). */
  share: number;
  /** The hit's toi along the ray in the hull's cast pose. */
  toi: number;
  readonly local: Float64Array;
  readonly localN: Float64Array;
  readonly world: Float64Array;
  readonly worldN: Float64Array;
  collider: Collider | null;
  vehicle: Vehicle | null;
  /** Another player's vehicle met (wave 3c): their relay id and the picture, else 0 and null. */
  peer: number;
  peerObj: PeerPicture | null;
  /** The hull's point velocity at the hit, in the world. */
  readonly pv: Float64Array;
}

export function newHullHit(): HullHit {
  return { slot: 0, share: 0, toi: 0, local: new Float64Array(3), localN: new Float64Array(3), world: new Float64Array(3), worldN: new Float64Array(3), collider: null, vehicle: null, peer: 0, peerObj: null, pv: new Float64Array(3) };
}

/** What the hull test hands the grapple: each contact's normal in the world and the hull's point velocity there. */
export interface HullContacts {
  n: number;
  readonly normal: Float64Array;
  readonly pv: Float64Array;
  /** Metres it pushed the capsule out of a hull it started inside, this frame. */
  pushed: number;
  /** Calls made into the hull's controller and contact tests made, this frame. */
  calls: number;
  contactTests: number;
}

/**
 * Every frame the rope rides besides the world, and the hulls near it: slot 0 is the world, 1 to `MAX_HULL_FRAMES` are
 * hulls this browser simulates, and the `MAX_PEER_FRAMES` after them other players' vehicles, each assigned as it comes
 * near or takes a point and freed once neither. The rope's `frames` is this very list.
 */
export class HullFrames {
  readonly slots: RopeFrame[];
  private readonly hulls: HullFrame[] = [];
  private readonly peers: PeerFrame[] = [];
  private readonly R: R;
  private readonly tune: HullTune;
  /** The accumulator's remainder and the frame this frame's poses were led by. */
  acc = 0;
  dt = 1 / 60;
  /** Body reads made this frame (four a hull led), for the console and the allocation test. */
  reads = 0;
  /** The capsule as the hull test asks a hull for its contact with it, and its answer, kept. */
  private readonly capsule: RAPIER_NS.Capsule;
  private readonly contact: RAPIER_NS.ShapeContact;
  private readonly kept: RAPIER_NS.CharacterCollision;
  private readonly moveOut = { x: 0, y: 0, z: 0 };
  private readonly at3 = { x: 0, y: 0, z: 0 };
  private readonly rot4 = { x: 0, y: 0, z: 0, w: 1 };
  private readonly d3 = { x: 0, y: 0, z: 0 };
  private readonly put3 = { x: 0, y: 0, z: 0 };
  private readonly noTurn = { x: 0, y: 0, z: 0, w: 1 };
  private readonly vel3 = { x: 0, y: 0, z: 0 };
  private readonly turn3 = { x: 0, y: 0, z: 0 };
  private readonly lead = new Float64Array(1);
  /** The hull's lag handed to the still test. */
  private readonly still = new Float64Array(1);
  private readonly p3 = new Float64Array(3);
  private readonly ray: RAPIER_NS.Ray;
  /** The hull test's numbers: the capsule's start and end in the hull's cast pose, its turn there, the move. */
  private readonly P0 = new Float64Array(3);
  private readonly P1 = new Float64Array(3);
  private readonly Rq = new Float64Array(4);
  private readonly stop = new Float64Array(3);
  /** The hull test's contacts, handed back. */
  readonly contacts: HullContacts = { n: 0, normal: new Float64Array(3 * MAX_HULL_CONTACTS), pv: new Float64Array(3 * MAX_HULL_CONTACTS), pushed: 0, calls: 0, contactTests: 0 };

  constructor(Rapier: R, tune: HullTune) {
    this.R = Rapier;
    this.tune = tune;
    const slots: RopeFrame[] = [worldFrame()];
    for (let i = 0; i < MAX_HULL_FRAMES; i++) {
      const h = new HullFrame();
      this.hulls.push(h);
      slots.push(h);
    }
    for (let i = 0; i < MAX_PEER_FRAMES; i++) {
      const f = new PeerFrame();
      this.peers.push(f);
      slots.push(f);
    }
    this.slots = slots;
    this.capsule = new Rapier.Capsule(0.45, 0.35);
    this.contact = new Rapier.ShapeContact(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    this.kept = new Rapier.CharacterCollision();
    this.ray = new Rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  }

  /** Slot i (1 to `MAX_HULL_FRAMES`) as the hull it is. */
  hull(i: number): HullFrame {
    return this.hulls[i - 1];
  }

  /** Whether slot i is another player's vehicle's (past the hulls'). */
  isPeerSlot(i: number): boolean {
    return i > MAX_HULL_FRAMES;
  }

  /** Slot i (past the hulls') as the peer's vehicle it is. */
  peerFrame(i: number): PeerFrame {
    return this.peers[i - MAX_HULL_FRAMES - 1];
  }

  /** What rides slot i: a hull's source, a peer's, or none. */
  srcOf(i: number): FrameSource | null {
    return i > MAX_HULL_FRAMES ? this.peers[i - MAX_HULL_FRAMES - 1].src : this.hulls[i - 1].src;
  }

  /** The slot a vehicle is in, or 0. */
  slotOf(v: Vehicle): number {
    for (let i = 0; i < this.hulls.length; i++) if (this.hulls[i].vehicle === v) return i + 1;
    return 0;
  }

  /** The slot a peer's vehicle is in (their relay id and their very picture), or 0. */
  peerSlotOf(e: PeerHull): number {
    for (let i = 0; i < this.peers.length; i++) if (this.peers[i].is(e)) return MAX_HULL_FRAMES + 1 + i;
    return 0;
  }

  /** Any slot holds a hull, or a peer's vehicle. */
  get any(): boolean {
    for (let i = 0; i < this.hulls.length; i++) if (this.hulls[i].src) return true;
    for (let i = 0; i < this.peers.length; i++) if (this.peers[i].src) return true;
    return false;
  }

  /**
   * A frame's start (the hook's step before the move): what the rope rides, the hulls gone from under it, the hulls near
   * it (any whose sphere, grown by its speed over the lag, reaches the box `near` holds, min then max), and every slot's
   * poses led to the frame's start and end. `carried` is the rope's own count per slot, which the caller fills.
   */
  begin(physics: Physics, vehicles: readonly Vehicle[], peers: PeerHulls | null, dt: number, near: Float64Array, carried: (i: number) => number): void {
    const acc = physics.behind;
    this.acc = acc;
    this.dt = dt;
    this.reads = 0;
    this.beginPeers(peers, near, carried);
    const hulls = this.hulls;
    for (let i = 0; i < hulls.length; i++) {
      const h = hulls[i];
      h.near = false;
      if (!h.src) continue;
      h.carries = carried(i + 1);
      const v = h.vehicle!;
      h.gone = v.disposed ? 'disposed' : v.destroyed ? 'destroyed' : v.ghosted ? 'ghosted' : '';
      if (h.gone && h.carries === 0) this.free(h);
    }
    if (this.tune.vehicles) {
      // Read off what each vehicle's last update wrote (`pos`, `speed`), never its body: most are nowhere near the rope.
      const lag = acc + dt + 2 * STEP;
      for (let k = 0; k < vehicles.length; k++) {
        const v = vehicles[k];
        if (v.disposed || v.ghosted || v.destroyed || v.spec.animal) continue;
        const b = v.spec.bounds;
        const bx = (b.max[0] - b.min[0]) / 2;
        const by = (b.max[1] - b.min[1]) / 2;
        const bz = (b.max[2] - b.min[2]) / 2;
        const ox = (b.max[0] + b.min[0]) / 2;
        const oy = (b.max[1] + b.min[1]) / 2;
        const oz = (b.max[2] + b.min[2]) / 2;
        const r = Math.sqrt(bx * bx + by * by + bz * bz) + Math.sqrt(ox * ox + oy * oy + oz * oz) + (Math.abs(v.speed) + 2) * lag + 0.5;
        const p = v.pos;
        const dx = p.x < near[0] ? near[0] - p.x : p.x > near[3] ? p.x - near[3] : 0;
        const dy = p.y < near[1] ? near[1] - p.y : p.y > near[4] ? p.y - near[4] : 0;
        const dz = p.z < near[2] ? near[2] - p.z : p.z > near[5] ? p.z - near[5] : 0;
        if (dx * dx + dy * dy + dz * dz > r * r) continue;
        let slot = this.slotOf(v);
        if (!slot) slot = this.claim(v);
        if (slot) this.hulls[slot - 1].near = true;
      }
    }
    for (let i = 0; i < hulls.length; i++) {
      const h = hulls[i];
      if (!h.src) continue;
      if (!h.near && h.carries === 0) {
        this.free(h);
        continue;
      }
      if (h.gone) {
        h.near = false;
        continue;
      }
      this.leadSlot(h, physics);
    }
  }

  /**
   * A vehicle taken into a slot between frames (the console's and the tests' rope fastened on a hull at once): its poses
   * read now and led by the accumulator alone, the frame's start and end both now. The slot, or 0 with none free.
   */
  adopt(physics: Physics, v: Vehicle): number {
    if (v.disposed || !v.body.isValid()) return 0;
    let slot = this.slotOf(v);
    if (!slot) slot = this.claim(v);
    if (!slot) return 0;
    const h = this.hulls[slot - 1];
    h.near = true;
    h.gone = '';
    this.acc = physics.behind;
    this.dt = 0;
    this.leadSlot(h, physics);
    return slot;
  }

  // --- other players' vehicles (wave 3c) ---------------------------------------------------------------------

  /** The list's clock this frame (s), read once and only while a peer is about, and the frame a slot is stepped by. */
  private peerNow = 0;
  private peerDt = 0;
  /** The pose a mark reads off a peer's vehicle no slot holds, kept. */
  private readonly markPeer = new PeerFrame();

  /**
   * The peer slots at a frame's start: each held one checked against the list (gone when its player is no longer shown on
   * that very picture), every peer's vehicle near the rope given a slot, and each slot's pose stepped to the frame's end
   * (`stepPeer`). With no peer about it asks nothing, not even the clock.
   */
  private beginPeers(peers: PeerHulls | null, near: Float64Array, carried: (i: number) => number): void {
    // The frame comes in a field (dt, which `begin` wrote): a number handed to a call not built in is a fresh number.
    const dt = this.dt;
    const slots = this.peers;
    const list = peers && this.tune.vehicles ? peers.list : null;
    let any = false;
    for (let i = 0; i < slots.length; i++) {
      const f = slots[i];
      f.near = false;
      if (!f.src) continue;
      any = true;
      f.carries = carried(MAX_HULL_FRAMES + 1 + i);
      // Still that player's shown ride, this very picture? Their leaving, getting off, onto another or out of sight (another
      // world, a jump) takes it off the list, and a vehicle swapped for another is another picture.
      f.hull = null;
      if (list) for (let k = 0; k < list.length; k++) if (f.is(list[k])) f.hull = list[k];
      f.gone = f.hull ? '' : 'gone';
      if (f.gone && f.carries === 0) f.take(null);
    }
    if (!list || !(list.length > 0 || any)) return;
    // The frame's end on the list's clock: its refill (the frame before's end) and this frame.
    this.peerNow = peers!.stamp + dt;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      // Its sphere round its box, grown by its speed over a few frames, against the box the rope and the dart may sweep.
      const h = e.half;
      const m = e.mid;
      const v = e.vel;
      const r = Math.sqrt(h[0] * h[0] + h[1] * h[1] + h[2] * h[2]) + Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]) + (Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) + 2) * (dt + 2 * STEP + PEER_GLIDE) + 0.5;
      const p = e.obj.position;
      const dx = p.x < near[0] ? near[0] - p.x : p.x > near[3] ? p.x - near[3] : 0;
      const dy = p.y < near[1] ? near[1] - p.y : p.y > near[4] ? p.y - near[4] : 0;
      const dz = p.z < near[2] ? near[2] - p.z : p.z > near[5] ? p.z - near[5] : 0;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      let slot = this.peerSlotOf(e);
      if (!slot) slot = this.claimPeer(e);
      if (slot) this.peerFrame(slot).near = true;
    }
    for (let i = 0; i < slots.length; i++) {
      const f = slots[i];
      if (!f.src) continue;
      if (!f.near && f.carries === 0) {
        f.take(null);
        continue;
      }
      if (f.gone) {
        f.near = false;
        continue;
      }
      this.peerDt = dt;
      this.stepPeer(f);
    }
  }

  private claimPeer(e: PeerHull): number {
    for (let i = 0; i < this.peers.length; i++) {
      const f = this.peers[i];
      if (f.src) continue;
      f.take(e);
      return MAX_HULL_FRAMES + 1 + i;
    }
    return 0;
  }

  /** A peer's vehicle taken into a slot between frames (the console's and the tests' rope fastened on it at once): its pose stepped now, by no time. The slot, or 0. */
  adoptPeer(peers: PeerHulls, e: PeerHull): number {
    let slot = this.peerSlotOf(e);
    if (!slot) slot = this.claimPeer(e);
    if (!slot) return 0;
    const f = this.peerFrame(slot);
    f.near = true;
    f.gone = '';
    f.hull = e;
    this.peerNow = peers.stamp;
    this.peerDt = 0;
    this.stepPeer(f);
    return slot;
  }

  /** A slot's numbers for one step, handed over in a kept record: the seconds since the state was heard, the frame, and the jump test's moments and the gap states are sent at. */
  private readonly pn = new Float64Array(3);
  private readonly pq = new Float64Array(1);

  /**
   * One frame of a peer slot's pose (§3.18), from what the list says and the clock: the box as their game measures it now,
   * the jump test on a state heard since the last frame (where the last state, carried on by its velocity, expected it,
   * less what the moments it was heard at may account for), then the pose the rope rides at the frame's start and end.
   * 'smooth' dead-reckons it (`peerPoseIn`), its start where the last frame's end left it, begun afresh where the states put
   * it on its first frame, after a pause (a panel open) or a change of pose; 'picture' rides the glided picture, its end led
   * by the glide's own step. The turn in both is the picture's own, led by the glide's step toward the turn heard. Its
   * velocity and turn rate over the frame are kept for the pivot's and the mark's motion, and the gap the console reads (the
   * pose at the frame's start against the picture where the last frame drew it).
   */
  private stepPeer(f: PeerFrame): void {
    const e = f.hull!;
    const dt = this.peerDt;
    const T = this.tune;
    const now = this.peerNow;
    const pn = this.pn;
    f.boxOf(e);
    // The jump test, on a state heard since the last step.
    f.jumped = false;
    if (e.heardAt !== f.heardWas) {
      if (f.heardWas >= 0) {
        pn[0] = f.heardWas;
        pn[1] = e.heardAt;
        pn[2] = PEER_SEND;
        peerMissIn(f.lastTarget, f.lastVel, e.target, pn);
        f.lastMiss = pn[0];
        f.lastSlack = pn[1];
        if (pn[0] > T.peerJump + pn[1]) f.jumped = true;
      }
      f.heardWas = e.heardAt;
      f.lastTarget.set(e.target);
      f.lastVel.set(e.vel);
    }
    const o = e.obj.position;
    const oq = e.obj.quaternion;
    const fresh = f.steppedAt < 0 || now - f.steppedAt > PEER_STALE || f.modeWas !== T.peerPose;
    f.modeWas = T.peerPose;
    if (!fresh) {
      const gx = f.np[0] - o.x;
      const gy = f.np[1] - o.y;
      const gz = f.np[2] - o.z;
      f.gap = Math.sqrt(gx * gx + gy * gy + gz * gz);
      f.gapStep = dt;
      f.noteGap();
    }
    f.steppedAt = now;
    // The picture's own glide step this frame.
    const k = dt > 0 ? 1 - Math.exp(-dt / PEER_GLIDE) : 0;
    f.bq[0] = oq.x;
    f.bq[1] = oq.y;
    f.bq[2] = oq.z;
    f.bq[3] = oq.w;
    this.pq[0] = k;
    slerpTurn(f.bq, e.turn, this.pq, f.nq);
    const v = e.vel;
    if (T.peerPose === 'picture') {
      f.bp[0] = o.x;
      f.bp[1] = o.y;
      f.bp[2] = o.z;
      f.np[0] = o.x + (e.target[0] - o.x) * k;
      f.np[1] = o.y + (e.target[1] - o.y) * k;
      f.np[2] = o.z + (e.target[2] - o.z) * k;
    } else {
      const since = now - e.heardAt;
      const s = f.smooth;
      const sv = f.smoothVel;
      if (fresh) {
        // Begun where the states put it: the last heard carried on to now, held back by the glide's lag, and its start a
        // frame back along its way; the velocity it rides begun at the relay's own.
        for (let i = 0; i < 3; i++) {
          sv[i] = v[i];
          s[i] = e.target[i] + v[i] * since;
          f.np[i] = s[i] - v[i] * T.peerLag;
          f.bp[i] = f.np[i] - v[i] * dt;
        }
      } else {
        f.bp[0] = f.np[0];
        f.bp[1] = f.np[1];
        f.bp[2] = f.np[2];
        pn[0] = since;
        pn[1] = dt;
        peerPoseIn(s, sv, e.target, v, pn, T, f.np);
      }
    }
    // Its motion over the frame: the pivot's and the mark's.
    const ps = f.ps;
    if (dt > 0) {
      ps.lv[0] = (f.np[0] - f.bp[0]) / dt;
      ps.lv[1] = (f.np[1] - f.bp[1]) / dt;
      ps.lv[2] = (f.np[2] - f.bp[2]) / dt;
      pn[0] = dt;
      turnRateIn(f.bq, f.nq, pn, ps.lw);
    } else {
      ps.lv[0] = v[0];
      ps.lv[1] = v[1];
      ps.lv[2] = v[2];
      ps.lw[0] = 0;
      ps.lw[1] = 0;
      ps.lw[2] = 0;
    }
  }

  /** A peer slot, by its relay id, for the console: the slot index or 0. */
  peerSlotById(id: number): number {
    for (let i = 0; i < this.peers.length; i++) if (this.peers[i].src && this.peers[i].ps.id === id) return MAX_HULL_FRAMES + 1 + i;
    return 0;
  }

  /** A world point (or with `dir` a direction) against a slot's body as the physics has it now, into the hull's own coordinates. */
  castToLocalOf(slot: number, p: Float64Array, dir: boolean, out: Float64Array): void {
    const h = this.hulls[slot - 1];
    const io = h.io;
    io[0] = p[0];
    io[1] = p[1];
    io[2] = p[2];
    if (dir) h.castDir(false);
    else h.castToLocal();
    out[0] = io[3];
    out[1] = io[4];
    out[2] = io[5];
  }

  private claim(v: Vehicle): number {
    for (let i = 0; i < this.hulls.length; i++) {
      const h = this.hulls[i];
      if (h.src) continue;
      h.take(v);
      return i + 1;
    }
    return 0;
  }

  /** A slot let go of: its walk-through marks taken off first, through the very colliders marked. */
  free(h: HullFrame, physics: Physics | null = null): void {
    if (h.marked) this.unmark(h, physics);
    h.take(null);
  }

  /** Every slot let go of (the rope let go, the world went), the peers' with the hulls'. */
  clear(physics: Physics | null = null): void {
    for (let i = 0; i < this.hulls.length; i++) if (this.hulls[i].src || this.hulls[i].marked) this.free(this.hulls[i], physics);
    for (let i = 0; i < this.peers.length; i++) if (this.peers[i].src) this.peers[i].take(null);
  }

  /** A peer slot let go of (its vehicle went from under a bend, which stays as a still one). */
  freePeer(i: number): void {
    this.peerFrame(i).take(null);
  }

  /** The physics a slot's marks were made in, so an unmark asks nobody else's. */
  private markedIn: Physics | null = null;

  /** One slot's poses this frame: four reads of its body, led to the frame's start and end, and its lag. */
  private leadSlot(h: HullFrame, physics: Physics): void {
    const body = h.vs.body;
    if (!body || !body.isValid()) {
      h.gone = 'disposed';
      h.near = false;
      return;
    }
    // The guard below judges this read against the last alone: a hull that jumped while it was merely near (carrying
    // nothing of the rope) is forgotten here, so a later bite or bend on it is not let go of for it.
    h.jumped = false;
    const t = body.translation();
    const r = body.rotation();
    this.reads += 2;
    h.cp[0] = t.x;
    h.cp[1] = t.y;
    h.cp[2] = t.z;
    h.cq[0] = r.x;
    h.cq[1] = r.y;
    h.cq[2] = r.z;
    h.cq[3] = r.w;
    h.vs.motion(this.vel3, this.turn3);
    const v = h.vehicle!;
    this.reads += v.holding || v.held ? 0 : 2;
    h.lv[0] = this.vel3.x;
    h.lv[1] = this.vel3.y;
    h.lv[2] = this.vel3.z;
    h.lw[0] = this.turn3.x;
    h.lw[1] = this.turn3.y;
    h.lw[2] = this.turn3.z;
    const acc = this.acc;
    const dt = this.dt;
    const led = this.tune.hullLead;
    this.lead[0] = led ? acc : 0;
    leadPose(h.cp, h.cq, h.lv, h.lw, this.lead, h.bp, h.bq);
    this.lead[0] = led ? acc + dt : 0;
    leadPose(h.cp, h.cq, h.lv, h.lw, this.lead, h.np, h.nq);
    if (led && h.vs.turnInFrameTime()) {
      // The turn is already at the frame's start: led by the frame alone.
      h.bq[0] = h.cq[0];
      h.bq[1] = h.cq[1];
      h.bq[2] = h.cq[2];
      h.bq[3] = h.cq[3];
      this.lead[0] = dt;
      leadPose(h.cp, h.cq, h.lv, h.lw, this.lead, this.p3, h.nq);
    }
    h.moved();
    // Lengths by `Math.sqrt` and the still test over a kept record: a call the compiler leaves out of this is handed fresh numbers.
    const lv = h.lv;
    const lw = h.lw;
    const speed = Math.sqrt(lv[0] * lv[0] + lv[1] * lv[1] + lv[2] * lv[2]);
    h.lag = (speed + Math.sqrt(lw[0] * lw[0] + lw[1] * lw[1] + lw[2] * lw[2]) * h.vs.radius) * (acc + dt);
    const still = this.still;
    still[0] = h.lag;
    h.moving = !hullStillIn(still, h.marked, this.tune);
    // The guard: moved further since the last read than its speed over the steps between allows.
    const steps = physics.steps;
    if (h.lastSteps >= 0) {
      const mx = h.cp[0] - h.lastCp[0];
      const my = h.cp[1] - h.lastCp[1];
      const mz = h.cp[2] - h.lastCp[2];
      const moved = Math.sqrt(mx * mx + my * my + mz * mz);
      const most = Math.max(speed, h.lastSpeed) * (steps - h.lastSteps) * STEP + this.tune.teleportMargin;
      if (moved > most) h.jumped = true;
    }
    h.lastCp[0] = h.cp[0];
    h.lastCp[1] = h.cp[1];
    h.lastCp[2] = h.cp[2];
    h.lastSpeed = speed;
    h.lastSteps = steps;
  }

  /**
   * The walk-through marks for this frame (§3.18): a hull the rope rides and that moves leaves the player's character
   * controller and the capsule's solver pairing; one that is still, or no longer ridden, comes back. Marked through the
   * physics' own `markWalkThrough`, the very collider objects kept for the unmark.
   */
  mark(physics: Physics): void {
    for (let i = 0; i < this.hulls.length; i++) {
      const h = this.hulls[i];
      const want = !!h.src && !h.gone && h.carries > 0 && h.moving && this.tune.hullTest;
      if (want === h.marked) continue;
      if (want) {
        const body = h.vs.body;
        if (!body || !body.isValid()) continue;
        h.markedColliders.length = 0;
        for (let k = 0, n = body.numColliders(); k < n; k++) {
          const c = body.collider(k);
          physics.markWalkThrough(c, true);
          h.markedColliders.push(c);
        }
        h.marked = true;
        this.markedIn = physics;
      } else this.unmark(h, physics);
    }
  }

  private unmark(h: HullFrame, physics: Physics | null): void {
    const p = physics ?? this.markedIn;
    if (p) for (let k = 0; k < h.markedColliders.length; k++) p.markWalkThrough(h.markedColliders[k], false);
    h.markedColliders.length = 0;
    h.marked = false;
    h.moving = false;
  }

  /** How many hulls are marked walk-through now. */
  get markedCount(): number {
    let n = 0;
    for (let i = 0; i < this.hulls.length; i++) if (this.hulls[i].marked) n++;
    return n;
  }

  /**
   * The segment from `a` (in the world at the frame's start) to `b` (at its end) cast against every hull near, relative to
   * each (both ends taken into its own frame at their own moments and out through its cast pose), `extra` metres past `b`:
   * the dart's path relative to a hull. The nearest hit by share of the segment goes into `out`; false for none.
   */
  castPath(world: RAPIER_NS.World, a: Float64Array, b: Float64Array, extra: number, filter: number, out: HullHit): boolean {
    let found = false;
    const hulls = this.hulls;
    for (let i = 0; i < hulls.length; i++) {
      const h = hulls[i];
      if (!h.src || !h.near || h.gone) continue;
      const io = h.io;
      h.s = 0;
      io[0] = a[0];
      io[1] = a[1];
      io[2] = a[2];
      h.toCast();
      const ax = io[3];
      const ay = io[4];
      const az = io[5];
      h.s = 1;
      io[0] = b[0];
      io[1] = b[1];
      io[2] = b[2];
      h.toCast();
      const dx = io[3] - ax;
      const dy = io[4] - ay;
      const dz = io[5] - az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(len > 1e-9)) continue;
      const r = this.ray;
      r.origin.x = ax;
      r.origin.y = ay;
      r.origin.z = az;
      r.dir.x = dx / len;
      r.dir.y = dy / len;
      r.dir.z = dz / len;
      const hit = world.castRayAndGetNormal(r, len + extra, true, 8 | 1 | 2, filter, undefined, undefined, h.only);
      if (!hit) continue;
      const share = hit.timeOfImpact / len;
      if (found && share >= out.share) continue;
      found = true;
      out.slot = i + 1;
      out.share = share;
      out.toi = hit.timeOfImpact;
      out.collider = hit.collider;
      out.vehicle = h.vehicle;
      out.peer = 0;
      out.peerObj = null;
      // The point and its normal in the hull's own coordinates, then in the world at the moment struck.
      io[0] = ax + r.dir.x * hit.timeOfImpact;
      io[1] = ay + r.dir.y * hit.timeOfImpact;
      io[2] = az + r.dir.z * hit.timeOfImpact;
      h.castToLocal();
      out.local[0] = io[3];
      out.local[1] = io[4];
      out.local[2] = io[5];
      io[0] = hit.normal.x;
      io[1] = hit.normal.y;
      io[2] = hit.normal.z;
      h.castDir(false);
      out.localN[0] = io[3];
      out.localN[1] = io[4];
      out.localN[2] = io[5];
      h.s = Math.min(1, share);
      io[0] = out.local[0];
      io[1] = out.local[1];
      io[2] = out.local[2];
      h.localToWorld();
      out.world[0] = io[3];
      out.world[1] = io[4];
      out.world[2] = io[5];
      io[0] = hit.normal.x;
      io[1] = hit.normal.y;
      io[2] = hit.normal.z;
      h.castDir(true);
      out.worldN[0] = io[3];
      out.worldN[1] = io[4];
      out.worldN[2] = io[5];
    }
    // Other players' vehicles near: the same path relative to each, against its box by arithmetic in its own coordinates.
    const peers = this.peers;
    for (let i = 0; i < peers.length; i++) {
      const f = peers[i];
      if (!f.src || !f.near || f.gone) continue;
      const io = f.io;
      f.s = 0;
      io[0] = a[0];
      io[1] = a[1];
      io[2] = a[2];
      f.toLocal();
      const bo = this.boxO;
      bo[0] = io[3];
      bo[1] = io[4];
      bo[2] = io[5];
      f.s = 1;
      io[0] = b[0];
      io[1] = b[1];
      io[2] = b[2];
      f.toLocal();
      const bd = this.boxD;
      bd[0] = io[3] - bo[0];
      bd[1] = io[4] - bo[1];
      bd[2] = io[5] - bo[2];
      const len = Math.sqrt(bd[0] * bd[0] + bd[1] * bd[1] + bd[2] * bd[2]);
      if (!(len > 1e-9)) continue;
      bd[0] /= len;
      bd[1] /= len;
      bd[2] /= len;
      const bh = this.boxHit;
      bh.toi = len + extra;
      if (!rayBoxIn(bo, bd, f.boxMid, BOX_TURN, f.boxHalf, bh)) continue;
      const share = bh.toi / len;
      if (found && share >= out.share) continue;
      found = true;
      this.hitShare = share;
      this.peerHitOut(f, MAX_HULL_FRAMES + 1 + i, bo, bd, out);
    }
    return found;
  }

  /** The share of the frame a peer's box was struck at, handed to `peerHitOut` in a field (its time of impact is `boxHit`'s). */
  private hitShare = 0;

  /** The box ray's start and way in a peer's own coordinates, and its answer, kept. */
  private readonly boxO = new Float64Array(3);
  private readonly boxD = new Float64Array(3);
  private readonly boxHit = newBoxHit();

  /**
   * A hit on a peer's box into `out`: the point (`o + d·toi`, in its own coordinates, `toi` the kept `boxHit`'s) and the
   * box's face normal kept there, then both in the world at the share of the frame struck (`hitShare`, a field: the mark
   * asks this on every frame it rests on a friend's vehicle, and numbers handed to a call not built in are fresh numbers),
   * and the pose's point velocity there.
   */
  private peerHitOut(f: PeerFrame, slot: number, o: Float64Array, d: Float64Array, out: HullHit): void {
    const bh = this.boxHit;
    const toi = bh.toi;
    const share = this.hitShare;
    out.slot = slot;
    out.share = share;
    out.toi = toi;
    out.collider = null;
    out.vehicle = null;
    out.peer = f.ps.id;
    out.peerObj = f.ps.obj;
    out.local[0] = o[0] + d[0] * toi;
    out.local[1] = o[1] + d[1] * toi;
    out.local[2] = o[2] + d[2] * toi;
    out.localN[0] = bh.nx;
    out.localN[1] = bh.ny;
    out.localN[2] = bh.nz;
    const io = f.io;
    f.s = Math.min(1, Math.max(0, share));
    io[0] = out.local[0];
    io[1] = out.local[1];
    io[2] = out.local[2];
    f.localToWorld();
    out.world[0] = io[3];
    out.world[1] = io[4];
    out.world[2] = io[5];
    io[0] = bh.nx;
    io[1] = bh.ny;
    io[2] = bh.nz;
    f.dirToWorld();
    out.worldN[0] = io[3];
    out.worldN[1] = io[4];
    out.worldN[2] = io[5];
    io[0] = out.world[0];
    io[1] = out.world[1];
    io[2] = out.world[2];
    f.pointVelocity();
    out.pv[0] = io[3];
    out.pv[1] = io[4];
    out.pv[2] = io[5];
  }

  /** The mark's cast's length and the player's query filter, written by the caller before `markCast` (numbers in fields, never arguments). */
  markLen = 0;
  markFilter = 0;

  /**
   * The mark's casts (§3.8, step 7), after the frame's physics step: every vehicle near the ray read again and led by the
   * accumulator alone, the ray from `o` along unit `d` for `markLen` taken into its cast pose. The nearest hit (by its toi)
   * goes into `out`, with the point kept in the hull's own frame and its point velocity; false for none. Reads its own
   * poses and touches no slot. Its length and filter are read from fields the caller writes: it runs every frame on foot
   * with a vehicle about and is never built into its caller, and a number handed to it was a fresh one (16 B a frame).
   */
  markCast(physics: Physics, vehicles: readonly Vehicle[], o: Float64Array, d: Float64Array, out: HullHit): boolean {
    if (!this.tune.vehicles) return false;
    const len = this.markLen;
    const filter = this.markFilter;
    const acc = physics.behind;
    let found = false;
    // The ray's box, grown for each vehicle by its own sphere.
    const ex = o[0] + d[0] * len;
    const ey = o[1] + d[1] * len;
    const ez = o[2] + d[2] * len;
    const minx = Math.min(o[0], ex);
    const maxx = Math.max(o[0], ex);
    const miny = Math.min(o[1], ey);
    const maxy = Math.max(o[1], ey);
    const minz = Math.min(o[2], ez);
    const maxz = Math.max(o[2], ez);
    const mh = this.markHull;
    for (let k = 0; k < vehicles.length; k++) {
      const v = vehicles[k];
      if (v.disposed || v.ghosted || v.destroyed || v.spec.animal || !v.body.isValid()) continue;
      const b = v.spec.bounds;
      const bx = (b.max[0] - b.min[0]) / 2;
      const by = (b.max[1] - b.min[1]) / 2;
      const bz = (b.max[2] - b.min[2]) / 2;
      const ox = (b.max[0] + b.min[0]) / 2;
      const oy = (b.max[1] + b.min[1]) / 2;
      const oz = (b.max[2] + b.min[2]) / 2;
      const r = Math.sqrt(bx * bx + by * by + bz * bz) + Math.sqrt(ox * ox + oy * oy + oz * oz) + (Math.abs(v.speed) + 2) * (acc + 2 * STEP) + 0.5;
      const p = v.pos;
      const dx = p.x < minx ? minx - p.x : p.x > maxx ? p.x - maxx : 0;
      const dy = p.y < miny ? miny - p.y : p.y > maxy ? p.y - maxy : 0;
      const dz = p.z < minz ? minz - p.z : p.z > maxz ? p.z - maxz : 0;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      // Read again now, after the step, and led by what is left in the accumulator: the hull at the frame's end.
      mh.take(v);
      this.markAcc = acc;
      this.leadMark(mh);
      this.markReads += 4;
      const io = mh.io;
      mh.s = 0;
      io[0] = o[0];
      io[1] = o[1];
      io[2] = o[2];
      mh.toCast();
      const r0 = this.ray;
      r0.origin.x = io[3];
      r0.origin.y = io[4];
      r0.origin.z = io[5];
      io[0] = o[0] + d[0];
      io[1] = o[1] + d[1];
      io[2] = o[2] + d[2];
      mh.toCast();
      r0.dir.x = io[3] - r0.origin.x;
      r0.dir.y = io[4] - r0.origin.y;
      r0.dir.z = io[5] - r0.origin.z;
      const hit = physics.world.castRayAndGetNormal(r0, len, true, 8 | 1 | 2, filter, undefined, undefined, mh.only);
      if (!hit || (found && hit.timeOfImpact >= out.toi)) continue;
      found = true;
      out.slot = 0;
      out.toi = hit.timeOfImpact;
      out.share = hit.timeOfImpact / len;
      out.collider = hit.collider;
      out.vehicle = v;
      out.peer = 0;
      out.peerObj = null;
      io[0] = r0.origin.x + r0.dir.x * hit.timeOfImpact;
      io[1] = r0.origin.y + r0.dir.y * hit.timeOfImpact;
      io[2] = r0.origin.z + r0.dir.z * hit.timeOfImpact;
      mh.castToLocal();
      out.local[0] = io[3];
      out.local[1] = io[4];
      out.local[2] = io[5];
      out.world[0] = o[0] + d[0] * hit.timeOfImpact;
      out.world[1] = o[1] + d[1] * hit.timeOfImpact;
      out.world[2] = o[2] + d[2] * hit.timeOfImpact;
      io[0] = hit.normal.x;
      io[1] = hit.normal.y;
      io[2] = hit.normal.z;
      mh.castDir(false);
      out.localN[0] = io[3];
      out.localN[1] = io[4];
      out.localN[2] = io[5];
      mh.castDir(true);
      out.worldN[0] = io[3];
      out.worldN[1] = io[4];
      out.worldN[2] = io[5];
      io[0] = out.world[0];
      io[1] = out.world[1];
      io[2] = out.world[2];
      mh.pointVelocity();
      out.pv[0] = io[3];
      out.pv[1] = io[4];
      out.pv[2] = io[5];
    }
    mh.take(null);
    return found;
  }

  /**
   * Where a point kept in a vehicle's own frame stands at the frame's end, read again after the step and led by the
   * accumulator (the mark's snap hold, which follows the hull it was held on), and the hull's point velocity there.
   * False when the vehicle is gone from under it.
   */
  markPoint(physics: Physics, v: Vehicle, local: Float64Array, world: Float64Array, pv: Float64Array): boolean {
    if (v.disposed || v.ghosted || v.destroyed || !v.body.isValid()) return false;
    const mh = this.markHull;
    mh.take(v);
    this.markAcc = physics.behind;
    this.leadMark(mh);
    this.markReads += 4;
    const io = mh.io;
    mh.s = 1;
    io[0] = local[0];
    io[1] = local[1];
    io[2] = local[2];
    mh.localToWorld();
    world[0] = io[3];
    world[1] = io[4];
    world[2] = io[5];
    io[0] = world[0];
    io[1] = world[1];
    io[2] = world[2];
    mh.pointVelocity();
    pv[0] = io[3];
    pv[1] = io[4];
    pv[2] = io[5];
    mh.take(null);
    return true;
  }

  /**
   * The mark's casts against other players' vehicles (§3.8, step 7, wave 3c): the ray from `o` along unit `d` for
   * `markLen` against each one's box, at the pose the rope rides at the frame's end -- a slot's own where one holds it,
   * else the pose a slot would start at (`peerMarkPose`). Nearer than `out.toi` when `found` (a hull's), into `out`, the
   * point kept in that player's vehicle's own frame; true when it went in.
   */
  markCastPeers(peers: PeerHulls | null, o: Float64Array, d: Float64Array, found: boolean, out: HullHit): boolean {
    const list = peers && this.tune.vehicles ? peers.list : null;
    if (!list || list.length === 0) return false;
    const len = this.markLen;
    // After the frame's peers have refilled the list: its stamp is this frame's end.
    this.peerNow = peers!.stamp;
    const ex = o[0] + d[0] * len;
    const ey = o[1] + d[1] * len;
    const ez = o[2] + d[2] * len;
    const minx = Math.min(o[0], ex);
    const maxx = Math.max(o[0], ex);
    const miny = Math.min(o[1], ey);
    const maxy = Math.max(o[1], ey);
    const minz = Math.min(o[2], ez);
    const maxz = Math.max(o[2], ez);
    let met = false;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      const h = e.half;
      const m = e.mid;
      const v = e.vel;
      const r = Math.sqrt(h[0] * h[0] + h[1] * h[1] + h[2] * h[2]) + Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]) + (Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) + 2) * PEER_GLIDE + 0.5;
      const p = e.obj.position;
      const dx = p.x < minx ? minx - p.x : p.x > maxx ? p.x - maxx : 0;
      const dy = p.y < miny ? miny - p.y : p.y > maxy ? p.y - maxy : 0;
      const dz = p.z < minz ? minz - p.z : p.z > maxz ? p.z - maxz : 0;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      const slot = this.peerSlotOf(e);
      const f = slot && !this.peerFrame(slot).gone ? this.peerFrame(slot) : this.peerMarkPose(e);
      // The ray in its own coordinates at the frame's end.
      const io = f.io;
      f.s = 1;
      io[0] = o[0];
      io[1] = o[1];
      io[2] = o[2];
      f.toLocal();
      const bo = this.boxO;
      bo[0] = io[3];
      bo[1] = io[4];
      bo[2] = io[5];
      turnBy(f.nq, true, d, 0, this.boxD, 0);
      this.boxHit.toi = len;
      if (!rayBoxIn(bo, this.boxD, f.boxMid, BOX_TURN, f.boxHalf, this.boxHit)) continue;
      const toi = this.boxHit.toi;
      if ((found || met) && toi >= out.toi) continue;
      met = true;
      this.hitShare = 1;
      this.peerHitOut(f, slot, bo, this.boxD, out);
      // The mark's point is the ray's own, where it met the box at the frame's end.
      out.share = toi / len;
      out.world[0] = o[0] + d[0] * toi;
      out.world[1] = o[1] + d[1] * toi;
      out.world[2] = o[2] + d[2] * toi;
    }
    return met;
  }

  /**
   * Where a point kept in a peer's vehicle's own frame stands at the frame's end, and the pose's point velocity there (the
   * mark's snap hold on that vehicle). False when that player's vehicle is no longer on the list.
   */
  markPeerPoint(peers: PeerHulls | null, id: number, obj: PeerPicture, local: Float64Array, world: Float64Array, pv: Float64Array): boolean {
    const list = peers ? peers.list : null;
    if (!list) return false;
    let e: PeerHull | null = null;
    for (let k = 0; k < list.length; k++) if (list[k].id === id && list[k].obj === obj) e = list[k];
    if (!e) return false;
    this.peerNow = peers!.stamp;
    const slot = this.peerSlotOf(e);
    const f = slot && !this.peerFrame(slot).gone ? this.peerFrame(slot) : this.peerMarkPose(e);
    const io = f.io;
    f.s = 1;
    io[0] = local[0];
    io[1] = local[1];
    io[2] = local[2];
    f.localToWorld();
    world[0] = io[3];
    world[1] = io[4];
    world[2] = io[5];
    io[0] = world[0];
    io[1] = world[1];
    io[2] = world[2];
    f.pointVelocity();
    pv[0] = io[3];
    pv[1] = io[4];
    pv[2] = io[5];
    return true;
  }

  /**
   * A pose for the mark on a peer's vehicle no slot holds, at the frame's end: where a slot would start it ('smooth': the
   * last state heard carried on to now and held back by the glide's lag; 'picture': the picture, which the frame's glide has
   * already placed), turned as the picture is, moving at the relay's velocity. The mark's own scratch frame.
   */
  private peerMarkPose(e: PeerHull): PeerFrame {
    const f = this.markPeer;
    f.boxMid.set(e.mid);
    f.boxHalf.set(e.half);
    const o = e.obj.position;
    const oq = e.obj.quaternion;
    const v = e.vel;
    if (this.tune.peerPose === 'picture') {
      f.np[0] = o.x;
      f.np[1] = o.y;
      f.np[2] = o.z;
    } else {
      const since = this.peerNow - e.heardAt;
      for (let i = 0; i < 3; i++) f.np[i] = e.target[i] + v[i] * (since - this.tune.peerLag);
    }
    f.bp.set(f.np);
    f.nq[0] = oq.x;
    f.nq[1] = oq.y;
    f.nq[2] = oq.z;
    f.nq[3] = oq.w;
    f.bq.set(f.nq);
    f.ps.lv.set(v);
    f.ps.lw[0] = 0;
    f.ps.lw[1] = 0;
    f.ps.lw[2] = 0;
    f.ps.id = e.id;
    f.ps.obj = e.obj;
    return f;
  }

  /** The mark's own slot, never one of the rope's, the accumulator it leads by, and the body reads it made (four a hull). */
  private readonly markHull = new HullFrame();
  private markAcc = 0;
  markReads = 0;

  /** The mark's read of a hull: its body led by what is left in the accumulator (`markAcc`), its start and end both the frame's end. */
  private leadMark(h: HullFrame): void {
    const body = h.vs.body!;
    const t = body.translation();
    const r = body.rotation();
    h.cp[0] = t.x;
    h.cp[1] = t.y;
    h.cp[2] = t.z;
    h.cq[0] = r.x;
    h.cq[1] = r.y;
    h.cq[2] = r.z;
    h.cq[3] = r.w;
    h.vs.motion(this.vel3, this.turn3);
    h.lv[0] = this.vel3.x;
    h.lv[1] = this.vel3.y;
    h.lv[2] = this.vel3.z;
    h.lw[0] = this.turn3.x;
    h.lw[1] = this.turn3.y;
    h.lw[2] = this.turn3.z;
    const led = this.tune.hullLead;
    this.lead[0] = led ? this.markAcc : 0;
    leadPose(h.cp, h.cq, h.lv, h.lw, this.lead, h.np, h.nq);
    // A flown ship's turn is written in frame time already.
    if (led && h.vs.turnInFrameTime()) {
      h.nq[0] = h.cq[0];
      h.nq[1] = h.cq[1];
      h.nq[2] = h.cq[2];
      h.nq[3] = h.cq[3];
    }
    h.bp[0] = h.np[0];
    h.bp[1] = h.np[1];
    h.bp[2] = h.np[2];
    h.bq[0] = h.nq[0];
    h.bq[1] = h.nq[1];
    h.bq[2] = h.nq[2];
    h.bq[3] = h.nq[3];
    h.moved();
  }

  /**
   * The hull test (§3.18), after the character controller, for one marked hull: the capsule's collider put for one call
   * at its start in the hull's cast pose (the rope's own mapping: the start taken into the hull's frame at the frame's
   * start and out through its cast pose), pushed out of the hull first along each of its colliders' own contact (at most
   * `hullPush`), and the second controller asked for the move relative to the hull with a predicate taking that hull's
   * colliders alone. What it allows is mapped back to the world at the frame's end and written over `mv`; each contact's
   * normal and the hull's led point velocity there go into `contacts`. The collider is put straight back.
   */
  hullTest(i: number, collider: Collider, controller: RAPIER_NS.KinematicCharacterController, start: Float64Array, mv: { x: number; y: number; z: number }): void {
    const halfHeight = this.testHalf;
    const filter = this.testFilter;
    const h = this.hulls[i - 1];
    const c = this.contacts;
    const io = h.io;
    // The start in the hull's cast pose, and the capsule's turn there (upright in the world).
    h.s = 0;
    io[0] = start[0];
    io[1] = start[1];
    io[2] = start[2];
    h.toCast();
    const P0 = this.P0;
    P0[0] = io[3];
    P0[1] = io[4];
    P0[2] = io[5];
    // The turn that takes the world at the frame's start into the cast pose: cq · sq0⁻¹.
    this.turnInto(h);
    h.s = 1;
    io[0] = start[0] + mv.x;
    io[1] = start[1] + mv.y;
    io[2] = start[2] + mv.z;
    h.toCast();
    const P1 = this.P1;
    P1[0] = io[3];
    P1[1] = io[4];
    P1[2] = io[5];
    const cap = this.capsule;
    cap.halfHeight = halfHeight;
    const rot = this.rot4;
    rot.x = this.Rq[0];
    rot.y = this.Rq[1];
    rot.z = this.Rq[2];
    rot.w = this.Rq[3];
    // Out first: the lead never knows what the frame's own drive, springs and pull did to the hull's speed, so the
    // capsule may start a frame a hair inside the face it rested on, and the controller only refuses going deeper.
    const offset = 0.04;
    const most = this.tune.hullPush;
    const at = this.at3;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < h.markedColliders.length; k++) {
        const hc = h.markedColliders[k];
        // A disabled collider is no surface (a race-driven hull's own colliders while its race box stands in for them,
        // and the race box at every other moment): the controller never meets it, so nothing pushes out of it either.
        if (!hc.isValid() || !hc.isEnabled()) continue;
        at.x = P0[0];
        at.y = P0[1];
        at.z = P0[2];
        c.contactTests++;
        const ct = hc.contactShape(cap, at, rot, offset, this.contact);
        if (ct && ct.distance < offset) {
          const push = Math.min(offset - ct.distance, most);
          P0[0] += ct.normal1.x * push;
          P0[1] += ct.normal1.y * push;
          P0[2] += ct.normal1.z * push;
          c.pushed += push;
        }
      }
    }
    const put = this.put3;
    put.x = P0[0];
    put.y = P0[1];
    put.z = P0[2];
    collider.setTranslation(put);
    collider.setRotation(rot);
    const d = this.d3;
    d.x = P1[0] - P0[0];
    d.y = P1[1] - P0[1];
    d.z = P1[2] - P0[2];
    c.calls++;
    controller.computeColliderMovement(collider, d, undefined, filter, h.only);
    const m = controller.computedMovement(this.moveOut);
    // Back to the world at the frame's end.
    io[0] = P0[0] + m.x;
    io[1] = P0[1] + m.y;
    io[2] = P0[2] + m.z;
    h.castToLocal();
    io[0] = io[3];
    io[1] = io[4];
    io[2] = io[5];
    h.s = 1;
    h.localToWorld();
    const stop = this.stop;
    stop[0] = io[3];
    stop[1] = io[4];
    stop[2] = io[5];
    const n = controller.numComputedCollisions();
    for (let k = 0; k < n && c.n < MAX_HULL_CONTACTS; k++) {
      const hit = controller.computedCollision(k, this.kept);
      if (!hit) continue;
      io[0] = hit.normal1.x;
      io[1] = hit.normal1.y;
      io[2] = hit.normal1.z;
      h.castDir(true);
      const j = 3 * c.n;
      c.normal[j] = io[3];
      c.normal[j + 1] = io[4];
      c.normal[j + 2] = io[5];
      io[0] = stop[0];
      io[1] = stop[1];
      io[2] = stop[2];
      h.pointVelocity();
      c.pv[j] = io[3];
      c.pv[j + 1] = io[4];
      c.pv[j + 2] = io[5];
      c.n++;
    }
    mv.x = stop[0] - start[0];
    mv.y = stop[1] - start[1];
    mv.z = stop[2] - start[2];
    put.x = start[0];
    put.y = start[1];
    put.z = start[2];
    collider.setTranslation(put);
    collider.setRotation(this.noTurn);
  }

  /** The capsule's half height and the player's query filter for the hull test, written by the caller before it (numbers in fields, never arguments). */
  testHalf = 0.45;
  testFilter = 0;
  /** The capsule's radius, for the box test on another player's vehicle (`peerTest`), written with `testHalf`. */
  testRadius = 0.35;

  /** How many other players' vehicles carry a point of the rope this frame: the box test runs for those alone. */
  get peersRidden(): number {
    let n = 0;
    for (let i = 0; i < this.peers.length; i++) {
      const f = this.peers[i];
      if (f.src && !f.gone && f.carries > 0) n++;
    }
    return n;
  }

  /** Whether peer slot i carries a point of the rope this frame and is that player's shown ride still. */
  peerRidden(i: number): boolean {
    const f = this.peerFrame(i);
    return f.src !== null && !f.gone && f.carries > 0;
  }

  /** The box test's kept scratch, in the vehicle's own frame about its box's middle: the move's two ends, the box grown by the capsule, the capsule's axis. */
  private readonly pa = new Float64Array(3);
  private readonly pb = new Float64Array(3);
  private readonly pg = new Float64Array(3);
  private readonly pu = new Float64Array(3);

  /**
   * The body against another player's vehicle the rope rides (§3.18, wave 3c): their vehicle is a sensor here, which the
   * character controller never meets, rope or no rope, and the body would pass through it as it always has -- but a rope
   * wrapped on its box with the hand inside that box bends round it from inside: reeled or hauled up to its tail, or towed
   * into it as it stopped, the rope stacked bend on bend there (fourteen at 144 fps under Shift, thirty-two and fouled as
   * it stopped dead). So while the rope rides it the body is kept out of its box by the rope's own arithmetic, as a hull
   * this browser simulates is kept out by the hull test, and the controller is told nothing: in the vehicle's own frame
   * (the pose the rope rides), the capsule (upright in the world, half height `testHalf`, radius `testRadius`) is met as the
   * box grown by the capsule's reach along each of the box's axes and the controller's own offset, the start at the
   * frame's start and the end at its end taken there; the start pushed out along the axis it lies least deep on (at most
   * `hullPush`, as the hull test pushes), the move cut where it enters a face and slid along it, three faces at most, and
   * mapped back to the world at the frame's end over `mv`. Each face met goes into `contacts` with the pose's point
   * velocity there, which the clip measures, slams and holds the fall on exactly as a hull's. Nothing is put on their
   * vehicle. A box grown by the capsule's reach is a square-shouldered capsule: at an edge it stops the body a little sooner
   * than the capsule would, which is the safe side.
   */
  peerTest(i: number, start: Float64Array, mv: { x: number; y: number; z: number }): void {
    const f = this.peerFrame(i);
    const c = this.contacts;
    const io = f.io;
    const m = f.boxMid;
    const h = f.boxHalf;
    const a = this.pa;
    const b = this.pb;
    const g = this.pg;
    const u = this.pu;
    f.s = 0;
    io[0] = start[0];
    io[1] = start[1];
    io[2] = start[2];
    f.toLocal();
    a[0] = io[3] - m[0];
    a[1] = io[4] - m[1];
    a[2] = io[5] - m[2];
    f.s = 1;
    io[0] = start[0] + mv.x;
    io[1] = start[1] + mv.y;
    io[2] = start[2] + mv.z;
    f.toLocal();
    b[0] = io[3] - m[0];
    b[1] = io[4] - m[1];
    b[2] = io[5] - m[2];
    // The capsule's axis in the vehicle's frame at the frame's end, and the box grown by the capsule's reach along each axis.
    turnBy(f.nq, true, UP, 0, u, 0);
    const hh = this.testHalf;
    const r = this.testRadius + PEER_SKIN;
    g[0] = h[0] + (u[0] < 0 ? -u[0] : u[0]) * hh + r;
    g[1] = h[1] + (u[1] < 0 ? -u[1] : u[1]) * hh + r;
    g[2] = h[2] + (u[2] < 0 ? -u[2] : u[2]) * hh + r;
    // Out first: the pose moved in ways the frame before never knew, so a body resting on a face may start a hair inside.
    let met = 0;
    if (a[0] > -g[0] && a[0] < g[0] && a[1] > -g[1] && a[1] < g[1] && a[2] > -g[2] && a[2] < g[2]) {
      let k = 0;
      let depth = g[0] - (a[0] < 0 ? -a[0] : a[0]);
      for (let j = 1; j < 3; j++) {
        const dj = g[j] - (a[j] < 0 ? -a[j] : a[j]);
        if (dj < depth) {
          depth = dj;
          k = j;
        }
      }
      const sign = a[k] < 0 ? -1 : 1;
      const want = depth + PEER_HAIR;
      const most = this.tune.hullPush;
      const push = want < most ? want : most;
      a[k] += sign * push;
      c.pushed += push;
      if (want > most) {
        // Still inside after the most a frame may push: the move may take it no deeper along that axis, and it is a contact.
        if ((b[k] - a[k]) * sign < 0) b[k] = a[k];
        this.peerContact(f, k, sign, b);
        met = 3;
      }
    }
    // The move, cut at the first face it enters and slid along it, face by face.
    for (; met < 3; met++) {
      const d0 = b[0] - a[0];
      const d1 = b[1] - a[1];
      const d2 = b[2] - a[2];
      let tmin = 0;
      let tmax = 1;
      let axis = -1;
      let sign = 0;
      let miss = false;
      for (let k = 0; k < 3 && !miss; k++) {
        const o = a[k];
        const dk = k === 0 ? d0 : k === 1 ? d1 : d2;
        const gk = g[k];
        if (dk > -1e-12 && dk < 1e-12) {
          if (o <= -gk || o >= gk) miss = true;
          continue;
        }
        let t1 = (-gk - o) / dk;
        let t2 = (gk - o) / dk;
        let s = -1;
        if (t1 > t2) {
          const t = t1;
          t1 = t2;
          t2 = t;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = k;
          sign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin >= tmax) miss = true;
      }
      if (miss || axis < 0) break;
      // Stopped on the face, a hair outside it; the rest of the move goes on along the face.
      a[0] += d0 * tmin;
      a[1] += d1 * tmin;
      a[2] += d2 * tmin;
      a[axis] = sign * (g[axis] + PEER_HAIR);
      b[axis] = a[axis];
      this.peerContact(f, axis, sign, a);
    }
    // Back to the world at the frame's end.
    io[0] = b[0] + m[0];
    io[1] = b[1] + m[1];
    io[2] = b[2] + m[2];
    f.s = 1;
    f.localToWorld();
    mv.x = io[3] - start[0];
    mv.y = io[4] - start[1];
    mv.z = io[5] - start[2];
  }

  /** A face of a peer's box met (its axis and side, at `at` about the box's middle in its own frame) into `contacts`: the normal in the world and the pose's point velocity there. */
  private peerContact(f: PeerFrame, axis: number, sign: number, at: Float64Array): void {
    const c = this.contacts;
    if (c.n >= MAX_HULL_CONTACTS) return;
    const io = f.io;
    const j = 3 * c.n;
    f.s = 1;
    io[0] = axis === 0 ? sign : 0;
    io[1] = axis === 1 ? sign : 0;
    io[2] = axis === 2 ? sign : 0;
    f.dirToWorld();
    c.normal[j] = io[3];
    c.normal[j + 1] = io[4];
    c.normal[j + 2] = io[5];
    io[0] = at[0] + f.boxMid[0];
    io[1] = at[1] + f.boxMid[1];
    io[2] = at[2] + f.boxMid[2];
    f.localToWorld();
    io[0] = io[3];
    io[1] = io[4];
    io[2] = io[5];
    f.pointVelocity();
    c.pv[j] = io[3];
    c.pv[j + 1] = io[4];
    c.pv[j + 2] = io[5];
    c.n++;
  }

  /** `Rq`, the turn of the world at the frame's start in the hull's cast pose: `cq · bq⁻¹`. */
  private turnInto(h: HullFrame): void {
    const a = h.cq;
    const b = h.bq;
    // a * conj(b)
    const bx = -b[0];
    const by = -b[1];
    const bz = -b[2];
    const bw = b[3];
    const q = this.Rq;
    q[0] = a[3] * bx + a[0] * bw + a[1] * bz - a[2] * by;
    q[1] = a[3] * by - a[0] * bz + a[1] * bw + a[2] * bx;
    q[2] = a[3] * bz + a[0] * by - a[1] * bx + a[2] * bw;
    q[3] = a[3] * bw - a[0] * bx - a[1] * by - a[2] * bz;
  }

  /** The hull test's tallies for the frame, cleared before the controller's call. */
  clearContacts(): void {
    const c = this.contacts;
    c.n = 0;
    c.pushed = 0;
    c.calls = 0;
    c.contactTests = 0;
  }
}
