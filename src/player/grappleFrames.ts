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
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/physics.ts';
import type { Vehicle } from '../vehicles/vehicle.ts';
import type { FrameSource, RopeFrame } from './grappleRope.ts';
import { worldFrame } from './grappleRope.ts';
import { hullStillIn, leadPose, slerpTurn, turnBy } from './grappleMath.ts';

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
    return !!v.spec.ship && v.airborne && !v.holding && !v.held;
  }

  /** Never a flown, held, landed, jump-held, ghosted, disposed or destroyed hull: its drive writes its velocity, or it is not there. */
  takesPull(): boolean {
    const v = this.v;
    if (!v || v.disposed) return false;
    return !v.ghosted && !v.destroyed && !v.holding && !v.held && !v.landed && !(v.spec.ship && v.airborne);
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
  /** The hull's point velocity at the hit, in the world. */
  readonly pv: Float64Array;
}

export function newHullHit(): HullHit {
  return { slot: 0, share: 0, toi: 0, local: new Float64Array(3), localN: new Float64Array(3), world: new Float64Array(3), worldN: new Float64Array(3), collider: null, vehicle: null, pv: new Float64Array(3) };
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
 * Every frame the rope rides besides the world, and the hulls near it: slot 0 is the world, the rest are hulls,
 * assigned as they come near or take a point and freed once neither. The rope's `frames` is this very list.
 */
export class HullFrames {
  readonly slots: RopeFrame[];
  private readonly hulls: HullFrame[] = [];
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
    this.slots = slots;
    this.capsule = new Rapier.Capsule(0.45, 0.35);
    this.contact = new Rapier.ShapeContact(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    this.kept = new Rapier.CharacterCollision();
    this.ray = new Rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  }

  /** Slot i (1 and up) as the hull it is. */
  hull(i: number): HullFrame {
    return this.hulls[i - 1];
  }

  /** The slot a vehicle is in, or 0. */
  slotOf(v: Vehicle): number {
    for (let i = 0; i < this.hulls.length; i++) if (this.hulls[i].vehicle === v) return i + 1;
    return 0;
  }

  /** Any slot holds a hull. */
  get any(): boolean {
    for (let i = 0; i < this.hulls.length; i++) if (this.hulls[i].src) return true;
    return false;
  }

  /**
   * A frame's start (the hook's step before the move): what the rope rides, the hulls gone from under it, the hulls near
   * it (any whose sphere, grown by its speed over the lag, reaches the box `near` holds, min then max), and every slot's
   * poses led to the frame's start and end. `carried` is the rope's own count per slot, which the caller fills.
   */
  begin(physics: Physics, vehicles: readonly Vehicle[], dt: number, near: Float64Array, carried: (i: number) => number): void {
    const acc = physics.behind;
    this.acc = acc;
    this.dt = dt;
    this.reads = 0;
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

  /** Every slot let go of (the rope let go, the world went). */
  clear(physics: Physics | null = null): void {
    for (let i = 0; i < this.hulls.length; i++) if (this.hulls[i].src || this.hulls[i].marked) this.free(this.hulls[i], physics);
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
    return found;
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
        if (!hc.isValid()) continue;
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
