// A shuttle trip flown: one hull, built from the rig of the shuttle it takes the place of, carried
// through the legs of a route (`rideRoute.ts`) from one pad to another.
//
// Up to the take-off's cut the hull is exactly the shuttle everybody else sees: it is held where the
// pad's own round has its rig, on the clock every browser shares, its limbs posed from the same clip,
// its sounds and flames the very ones the stood rig was playing (`ShuttleRigs.lend`). At the cut it is
// let go into flight at the clip's own speed with its nose already brought round onto its path, so it
// flies on without a jolt; from the landing's join on it is the landing clip again, settled onto from
// wherever the flight left it, and then it is parked on the pad and solid. Only parked is it solid:
// in every other leg it is ghosted, as the clock rigs pass through everything, because a dynamic hull
// flown into a tower at speed is stopped dead by the contacts and strands whoever is aboard. Empty
// again, it lifts off on its own clock, flies on and is taken away the first second nobody can see it
// (the take-off clip of the plain shuttle ends 67 m up, and a hull vanishing there is a visible pop).
//
// Both pads' own shuttles are held out of the picture for as long as the hull stands in for them
// (`ShuttleRigs.hold`), and every way a trip ends -- landed and gone, aborted, its hull disposed under
// it by a world going -- gives both holds back, lets go of its sounds and flames and takes its hull
// away, so nothing of it is left behind.
//
// A trip somebody rides seats them in the hull in the same step it is swapped in, out of sight as the
// game drew nobody in a shuttle, and they watch it from outside. Between the clips its own pilot flies
// it (`shuttleCourse.ts`): along a course planned at the cut, over the ground and anything solid seen
// ahead, and over any ship in the way, in real time and never faster, to the landing's join. Parked on
// the pad it arrived at they are let off at the foot of its ramp, by their own E or on their own after
// a moment. Until it lifts off they may step off again and keep their ticket; a shuttle that has gone
// without them, or a hull that cannot be built or flown, gives the ticket back too. Nothing anybody
// else sees of it changes: their own clock's shuttles go on, and the rider is simply not drawn.
//
// It talks to the game only through `RideHost` and a hull only through `RideHull`, so a node test flies
// a whole trip against fakes (`shuttleRide.test.ts`). Nothing in an update allocates. Every number of
// ours is `RIDE_TUNE`, live through `__debug.ride({ tune })` and `__debug.rigHull({ ride })`.

import * as THREE from 'three';
import { CHASE_RISE } from '../core/camera.ts';
import { AVOID_TUNE, type V3 } from '../space/pilot.ts';
import { settleEase } from '../vehicles/landing.ts';
import type { RigHull, RigPaths } from '../vehicles/rigHull.ts';
import type { DriveInput } from '../vehicles/vehicle';
import type { RideRoute, PadRef, RideLeg } from './rideRoute.ts';
import { alignShare, inSight, landingTarget, makeLandingTarget, noseOntoPath, onPad, pathPose, pathVelocity, settleOnto, settleSeconds, turnOnPad, vehicleAt, vehicleFromJoint, vehicleVelocity, type RigPath } from './rigPath.ts';
import { RIDE_PILOT, ShuttlePilot, planCourse, planRadius, type RideState } from './shuttleCourse.ts';
import { SHUTTLE_RIG_TUNE, type RigDrive, type RigFx } from './shuttleRigs.ts';
import { rigPose, type RigPose, type ShuttleState, type TravelRig } from './travelTerminal.ts';

/** Every number of ours about a shuttle trip. Live through `__debug.ride({ tune })` and `__debug.rigHull({ ride })`. */
export const RIDE_TUNE = {
  /** A ticket about this world is flown there; false puts back the old way, a loading screen and a step to the port. */
  enabled: true,
  /** Seconds before the take-off's cut past which a hull built too late is not swapped in: the shuttle has gone without you. */
  lateCut: 2,
  /** Seconds the console's own hop flies on after the take-off's cut before it is put onto the landing's join, in the same world. */
  hopSeconds: 3,
  /** Seconds a passenger stays seated once it has landed, if they do not step off themselves. */
  alightAfter: 4,
  /** Seconds a hull stands parked where it landed, once nobody is left in it, before it lifts off again, empty. */
  dwell: 10,
  /** Metres off the foot of the ramp (or the hull's side, for one with none) a passenger is stood when they step off. */
  alight: 1.5,
  /** Metres down from there a floor may be found before the collector's own place is used instead. */
  alightDrop: 3,
  /** Seconds a hull flying off empty must be out of anybody's sight before it is taken away. */
  vanishUnseen: 1,
  /**
   * The event of the rig's own data whose flames burn while a hull flies between its clips: the engines'
   * start, which is what the transport's take-off and landing light them with. The event is the data's;
   * burning it all the way through the flight is ours.
   */
  flightEvent: 'start',
  /** The nearest a passenger's view comes to the hull they ride (the orbit's own rest): never inside it. */
  minZoom: 7,
  /**
   * The passenger's view of a hull standing on a pad, or within `viewLow` metres of it lifting off or
   * coming down: this share of the distance back the flight's view stands, and this rise over each metre
   * of it (the flight's is `CHASE_RISE`, 0.32). A pad stands inside walls and under roofs, and the flight's
   * framing -- 53 m behind and 17 m over a transport -- put the view on the roof of Bestine's starport with
   * the hull 16 m below behind its walls, and behind a shuttleport's screen wall; at 0.6 and 0.12 it stands
   * 32 m back and 4 m over the hull's middle, which is inside the walls of every pad and level with a
   * transport's back, and what is still in the way pulls the view in rather than being looked through.
   */
  parkedReach: 0.6,
  parkedRise: 0.12,
  /** Metres over its pad under which a hull lifting off or coming down is framed as parked: the height of a starport's walls and a little more. */
  viewLow: 25,
  /** Seconds the view takes to go from the parked framing to the flight's or back, eased at both ends: never a jump. */
  viewEase: 2,
};

/** How the passenger's view frames the hull, eased between parked (`share` 1) and flying (0): the share of the flight's distance back, and the rise over each metre of it. */
export interface RideFraming {
  share: number;
  reach: number;
  rise: number;
}

/** A framing, parked or not. */
export function rideFraming(parked: boolean): RideFraming {
  return settleFraming({ share: parked ? 1 : 0, reach: 1, rise: CHASE_RISE });
}

/**
 * One frame of the passenger's framing, eased toward parked (`low`) or flying at no more than one
 * `viewEase` a second, and the distance and rise worked out from where it has got to (smoothstepped, so
 * it leaves one and arrives at the other gently). Written in place; allocates nothing.
 */
export function stepFraming(f: RideFraming, low: boolean, dt: number, tune = RIDE_TUNE): RideFraming {
  const step = tune.viewEase > 0 ? Math.max(0, dt) / tune.viewEase : 1;
  f.share = low ? Math.min(1, f.share + step) : Math.max(0, f.share - step);
  return settleFraming(f, tune);
}

function settleFraming(f: RideFraming, tune = RIDE_TUNE): RideFraming {
  const s = f.share;
  const k = s * s * (3 - 2 * s);
  f.reach = 1 + (tune.parkedReach - 1) * k;
  f.rise = CHASE_RISE + (tune.parkedRise - CHASE_RISE) * k;
  return f;
}

/** A hull a trip flies, as much of a `Vehicle` as it uses. */
export interface RideHull {
  readonly pos: THREE.Vector3;
  readonly group: THREE.Object3D;
  readonly radius: number;
  readonly spec: { maxSpeed: number; turnRate: number; bounds: { min: readonly number[]; max: readonly number[] } };
  readonly def: { rig?: { rig: TravelRig } | null } | null;
  cruise: number;
  speed: number;
  airborne: boolean;
  readonly disposed: boolean;
  readonly ghosted: boolean;
  autopilot: { readonly drive: DriveInput; readonly unpaused?: boolean } | null;
  readonly rig: RigHull | null;
  hold(frame: THREE.Matrix4 | null, pos: THREE.Vector3, quat: THREE.Quaternion, speed?: number): void;
  release(velocity?: THREE.Vector3 | null): void;
  launch(speed: number): void;
  setGhost(on: boolean): void;
}

/** The drawn shuttles, as much of `ShuttleRigs` as a trip uses. */
export interface RideRigs {
  hold(key: string, now?: boolean): void;
  release(key: string, now?: boolean): void;
  lend(key: string, joints: THREE.Object3D): RigFx | null;
  fxFor(rig: TravelRig, mood: string, joints: THREE.Object3D, inside: boolean): RigFx;
  /** A set's marks bound again from another branch of its rig, its lit flames carried across; false for a branch the rig has not got. */
  rebranch(fx: RigFx, mood: string): boolean;
  drive(fx: RigFx, pose: () => RigDrive | null): void;
  undrive(fx: RigFx): void;
}

/** What a trip needs of the game. */
export interface RideHost {
  /** The hull, built out of sight for the route's rig and branch at a pad: prepared, hidden, held, ghosted and not yet in the world's list. Null or a throw when it cannot be. */
  buildHull(route: RideRoute, pad: PadRef): Promise<RideHull | null>;
  /** Put a built hull into the world in this same step: shown, let go of by whatever held it for its building, and in the world's list. */
  showHull(h: RideHull): void;
  /** Take a hull out of the world for good. */
  disposeHull(h: RideHull): void;
  /** Whether a hull is still in the world's list. */
  alive(h: RideHull): boolean;
  /** Seconds of the clock the shuttles' rounds run on. */
  now(): number;
  /** Where a pad's own shuttle is in its round now, written into `out`. */
  round(pad: PadRef, out: ShuttleState): ShuttleState;
  readonly rigs: RideRigs;
  /** The view whoever plays is looking through. */
  camera(): THREE.Camera;
  /** The floor straight down from a point within `reach` metres, among what stands still, or null. */
  floorAt(x: number, y: number, z: number, reach: number): number | null;
  /** Whether the world is a space zone. */
  inSpace(): boolean;
  /**
   * Take away, in this step, any hull of an earlier trip still standing about a pad another trip is
   * about to swap its hull in on (an empty one about to leave the pad a passenger boards at).
   */
  clearPad(pad: PadRef): void;
  /** Seat the passenger in a hull, in this step; false when they cannot be (on something else, gone, dead). */
  seat(h: RideHull): boolean;
  /** Put the passenger down off a hull, on their feet at `at`. */
  unseat(h: RideHull, at: THREE.Vector3): void;
  /** The ground's height where the world already holds it, or null: never made on the spot. */
  groundCached(x: number, z: number): number | null;
  /**
   * Metres along a ray from a point to the first thing that stands still, within `reach`, else Infinity.
   * The hull itself is never it, and nor is the ground: the pilot's own height law keeps the hull over
   * that, and a ray that saw it too held the hull up over rising ground on its way down to a join, high
   * enough to send it round again.
   */
  castAhead(h: RideHull, x: number, y: number, z: number, dx: number, dy: number, dz: number, reach: number): number;
  /** Every other ship flying in the world, handed to `visit` with where it is, how it moves (its nose times its speed) and its radius. */
  eachShip(h: RideHull, visit: (pos: V3, vel: V3, radius: number) => void): void;
  /** Something the trip says once, where it can be read. */
  say(text: string): void;
  /** A ticket not flown on, by its id, back in the passenger's hand. */
  giveBack(ticket: string): void;
  /**
   * Put the passenger down at a port on foot, the old way: where no pad is there to land on, and where a
   * trip already paid for is stopped in the air with nothing else about to move them.
   */
  walkOff(pack: string, port: string): void;
  /** The trip is over, however it ended: said exactly once, after its passenger is off and any ticket has gone back. */
  ended(ride: ShuttleRide): void;
}

/** How a trip that was begun went: flying, missed (its shuttle was not there to swap), failed (no hull, or clips that give no hand-over), or aborted while its hull was built. */
export type RideOutcome = 'flying' | 'missed' | 'failed' | 'aborted';

/** Scratch for the per-frame arithmetic: one trip is updated at a time, so every trip shares it. */
const jP = new THREE.Vector3();
const jQ = new THREE.Quaternion();
const vP = new THREE.Vector3();
const vQ = new THREE.Quaternion();
const vel = new THREE.Vector3();
const camAt = new THREE.Vector3();
const local = new THREE.Vector3();
const toLocal = new THREE.Matrix4();
const nose = new THREE.Vector3();
/** The flown hull's own velocity, its nose times its speed, as every other ship's is read. */
const selfVel = new THREE.Vector3();

export class ShuttleRide {
  readonly route: RideRoute;
  private readonly host: RideHost;
  /** Whether somebody boards it: a trip on a ticket, or the console's ride; the console's empty trips have nobody. */
  readonly passenger: boolean;
  /** The pilot that flies it between its clips (`shuttleCourse.ts`), made once for the trip. */
  readonly pilot = new ShuttlePilot();
  /** What flies the hull between its clips, handed to it as its autopilot and flown on with a panel open. The drive is the pilot's, kept and written in place. */
  readonly autopilot: { readonly drive: DriveInput; readonly unpaused: true };
  /** The hull a jump leg flies, for the length of that leg (none are flown yet). */
  jumpHull: RideHull | null = null;
  /** The hull, from the swap until it has gone. */
  hull: RideHull | null = null;
  /** Which leg is flown now. */
  index = 0;
  /** True from `begin` until the trip's hull has gone. */
  running = false;
  /** How it ended ('' while it has not): 'gone' once it flew off out of sight, else why it stopped. */
  ended = '';
  /** Why a trip that did not fly did not, or what stopped it, in words. */
  why = '';
  /** The clip and the moment of it the hull was swapped in at, for the console's measure of the swap. */
  readonly swapAt: { role: RigPose['role']; seconds: number } = { role: 'ground', seconds: 0 };
  /** Where a passenger would step off once it has landed, and what that was found from. */
  readonly alightAt = new THREE.Vector3();
  alightFrom = '';
  /** The hull's sounds and flames, stepped by the drawn shuttles from `drawn`, and the branch of the rig's clips whose marks they play. */
  private fx: RigFx | null = null;
  private fxMood = '';
  private readonly drawn: RigDrive = { role: 'ground', seconds: 0, shown: true, carry: true, flight: '' };
  private readonly posing = (): RigDrive | null => (this.hull && !this.hull.disposed ? this.drawn : null);
  /** The pads held out of the picture for the hull, by key ('' for none), and whether the destination's is held at once yet. */
  private origin = '';
  private dest = '';
  private destNow = false;
  /** Moved on by every end, so a hull built for a trip that has since ended is thrown away when it arrives. */
  private token = 0;
  /** Seconds into the trip, into the leg flown now, and into the clip it plays. */
  private elapsed = 0;
  private legClock = 0;
  private clip = 0;
  /** When each leg began, seconds into the trip (NaN for one not reached). */
  private readonly started: Float64Array;
  /** Its take-off and landing flown as paths, and its lift-off again from where it lands. */
  private paths: RigPaths | null = null;
  private again: RigPaths | null = null;
  /** The empty hull's own take-off is past its cut. */
  private away = false;
  /** Seconds it has been out of sight, flying off. */
  private unseen = 0;
  private readonly round: ShuttleState = { phase: 'away', until: 0, left: 0, glide: 0 };
  private readonly roundPose: RigPose = { role: 'sky', seconds: 0, shown: false };
  /** The landing's hand-over: where the hull was, where the clip had it then, how long the settle takes, and the parked height it lands at. */
  private readonly fromP = new THREE.Vector3();
  private readonly fromQ = new THREE.Quaternion();
  private readonly baseP = new THREE.Vector3();
  private readonly baseQ = new THREE.Quaternion();
  private settle = 1;
  private parkedY = 0;
  /** Metres the hull stands over the pad it is lifting off or coming down on, as its clip last had it; 0 parked. */
  private overPad = 0;
  private readonly target = makeLandingTarget();
  private readonly frustum = new THREE.Frustum();
  private readonly view = new THREE.Matrix4();
  /** The passenger is seated in the hull, from the swap until they are let off; and whether their ticket has gone back. */
  private seated = false;
  private refunded = false;
  /** When the pilot next looks ahead for anything solid, seconds into the trip. */
  private nextRay = 0;
  /** Where a course is planned from and to, kept and written. */
  private readonly fromState: RideState = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
  private readonly joinState: RideState = { x: 0, y: 0, z: 0, heading: 0, speed: 0, descent: 0 };
  /** The prompt's line, made again only when what it says changes. */
  private line: string | null = null;
  private linePhase = '';
  private lineN = -1;
  /** Where a passenger saved mid-trip is put down, kept and written. */
  private readonly kept = { pack: '', x: 0, y: 0, z: 0 };
  /** The two things the pilot is handed every frame, made once here rather than a closure a frame. */
  private readonly groundAt: (x: number, z: number) => number | null;
  private readonly visitShip: (pos: V3, vel: V3, radius: number) => void;

  constructor(route: RideRoute, host: RideHost, passenger = false) {
    this.route = route;
    this.host = host;
    this.passenger = passenger;
    this.autopilot = { drive: this.pilot.drive, unpaused: true };
    this.started = new Float64Array(route.legs.length).fill(Number.NaN);
    this.groundAt = (x, z) => host.groundCached(x, z);
    this.visitShip = (pos, vel, radius) => {
      const h = this.hull;
      if (h) this.pilot.noteShip(pos, vel, radius, h.pos, selfVel, h.radius);
    };
  }

  /** Whether somebody is seated in it: from the swap until they are let off, however the trip ends. */
  get riding(): boolean {
    return this.seated;
  }

  /** Whether the others should not see the rider: while they are seated in it, since nobody is drawn in a shuttle and the hull is this browser's alone. */
  get hidden(): boolean {
    return this.seated;
  }

  /**
   * Whether the passenger's view frames the hull as it stands on a pad (`RIDE_TUNE.parkedReach`): while
   * it boards and once it is parked where it landed, and while it lifts off or comes down within
   * `viewLow` metres of the pad, where the pad's walls still stand round it. Flying, it is framed as a
   * ship in flight is.
   */
  get lowView(): boolean {
    const k = this.leg?.kind;
    if (k === 'board' || k === 'off') return true;
    if (k === 'lift' || k === 'land') return this.overPad < RIDE_TUNE.viewLow;
    return false;
  }

  /** The leg flown now, or null once it has ended. */
  get leg(): RideLeg | null {
    return this.running ? (this.route.legs[this.index] ?? null) : null;
  }

  /**
   * Build the hull and swap it in for the shuttle on the first pad, in one synchronous step once it is
   * ready: the pad's own shuttle held out of the picture at once, the hull held where that shuttle's
   * round has it, shown, given the shuttle's own sounds and flames, the passenger seated in it, and the
   * destination's shuttle held softly. Only a shuttle parked, or lifting off at least `lateCut` short of
   * its cut, can be swapped for: one later than that, coming down or gone is `missed`, and nothing is
   * held. A passenger's ticket goes back whenever the trip ends before its hull has lifted off.
   */
  async begin(): Promise<RideOutcome> {
    if (this.running) return 'failed';
    const token = ++this.token;
    this.running = true;
    const from = this.route.from;
    const to = this.route.to.port || 'the far pad';
    if (this.passenger) this.host.say(`boarding the shuttle to ${to}…`);
    let hull: RideHull | null = null;
    try {
      hull = await this.host.buildHull(this.route, from);
    } catch (err) {
      this.why = `the hull was not built: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (token !== this.token) {
      // Ended while it was built: the hull that arrives late is thrown away rather than shown.
      if (hull && !hull.disposed) this.host.disposeHull(hull);
      return 'aborted';
    }
    const rig = hull?.rig ?? null;
    const paths = rig ? rig.paths(this.route.mood) : null;
    const again = rig && paths ? rig.paths(paths.landMood) : null;
    if (!hull || !rig || !paths || !paths.cut || !paths.join || !again?.cut) {
      if (hull && !hull.disposed) this.host.disposeHull(hull);
      this.finish('failed', this.why || (hull ? "its clips give no moment to hand the hull over at, so it cannot be flown" : 'the hull was not built'));
      if (this.passenger) this.host.say(`the shuttle to ${to} cannot be flown (${this.why})${this.ticketBack()}`);
      return 'failed';
    }
    this.readRound(from);
    const role = this.roundPose.role;
    if (!(role === 'ground' || (role === 'lift' && this.roundPose.seconds < paths.cut.t - RIDE_TUNE.lateCut))) {
      this.host.disposeHull(hull);
      this.finish('missed', `its shuttle is not there to take the place of (${this.round.phase})`);
      if (this.passenger) this.host.say(`the shuttle to ${to} has gone without you${this.ticketBack()}`);
      return 'missed';
    }
    // The passenger first: somebody who is no longer there to board (on something else, dead, gone)
    // misses it, and nothing of the swap has happened yet to be undone.
    if (this.passenger && !this.host.seat(hull)) {
      this.host.disposeHull(hull);
      this.finish('missed', 'the passenger was not there to board it');
      this.host.say(`you were not there to board the shuttle to ${to}${this.ticketBack()}`);
      return 'missed';
    }
    this.seated = this.passenger;
    this.hull = hull;
    this.paths = paths;
    this.again = again;
    const drive = this.autopilot.drive;
    drive.cruise = hull.spec.maxSpeed;
    // The swap, with nothing awaited from here to the end: an empty hull of an earlier trip still about
    // the pad taken away, its own shuttle out of the picture and out of the physics this same call, the
    // hull where that shuttle stood, and then shown.
    const rigs = this.host.rigs;
    this.host.clearPad(from);
    rigs.hold(from.key, true);
    this.origin = from.key;
    hull.autopilot = this.autopilot;
    const lift = this.route.legs.findIndex((l) => l.kind === 'lift');
    this.index = role === 'ground' || lift < 0 ? 0 : lift;
    this.started[this.index] = 0;
    this.swapAt.role = role;
    this.swapAt.seconds = role === 'ground' ? 0 : this.roundPose.seconds;
    if (role === 'ground') this.parkAtStart(from);
    else {
      this.clip = this.roundPose.seconds;
      this.flyClip(paths.lift, this.clip, paths.cut.t, from, paths.liftMood);
    }
    this.host.showHull(hull);
    this.fx = rigs.lend(from.key, rig.joints) ?? (hull.def?.rig ? rigs.fxFor(hull.def.rig.rig, this.route.mood, rig.joints, from.cell > 0) : null);
    this.fxMood = this.route.mood;
    if (this.fx) rigs.drive(this.fx, this.posing);
    const dest = this.route.to.pad;
    if (dest) {
      rigs.hold(dest.key);
      this.dest = dest.key;
    }
    return 'flying';
  }

  /** One frame of the trip: the leg flown now, and on to the next when it is done. Allocates nothing. */
  update(dt: number): void {
    const hull = this.hull;
    if (!this.running || !hull) return;
    // Taken away under it (a world gone, a clear): the trip is over, and gives back what it held.
    if (hull.disposed || !this.host.alive(hull)) {
      this.finish('lost', 'its hull was taken out of the world');
      return;
    }
    this.elapsed += dt;
    const leg = this.route.legs[this.index];
    if (!leg) {
      this.finish('arrived', '');
      return;
    }
    switch (leg.kind) {
      case 'board':
        this.board(leg);
        return;
      case 'lift':
        this.liftOff(leg);
        return;
      case 'skip':
        this.skip(leg, dt);
        return;
      case 'fly':
        this.fly(dt);
        return;
      case 'walkOff':
        this.walkOff(leg);
        return;
      case 'land':
        this.land(leg, dt);
        return;
      case 'off':
        this.parked(dt);
        return;
      case 'leave':
        this.leave(leg, dt);
        return;
      default:
        this.unflown(leg);
    }
  }

  /** A leg this runner does not fly yet: the trip ends there, saying which. */
  private unflown(leg: RideLeg): void {
    this.finish('failed', `a ${leg.kind} leg is not flown yet`);
  }

  /**
   * Stop the trip where it is: its passenger put down, its hull taken away, its pads given back, its
   * sounds let go of. Nothing when it is not running. A passenger stopped before it lifts off is stood
   * at the foot of its ramp with the ticket back; one stopped after it has lifted off has paid and is
   * kept at the far end already (`keepPlace`), so they are set down at the port it was flying to, as a
   * trip with no pad there sets them down, and never left in the air where the hull was. `moved` is a
   * caller that moves or ends the body itself the moment after (a travel, a teleport, a death, a
   * respawn, the select screen), which is then left to do so.
   */
  abort(why: string, moved = false): void {
    if (!this.running) return;
    this.finish('aborted', why, moved);
  }

  /**
   * E from the passenger's seat. Parked on the pad it leaves, before its round lifts off: stepped off at
   * the foot of the ramp with the ticket back in hand, and the pad's own shuttle stands again where the
   * hull stood. Parked where it landed: let off now rather than in a moment. In the air there is nowhere
   * to step to, which is said. False when nobody is seated.
   */
  pressE(): boolean {
    if (!this.seated || !this.hull) return false;
    const leg = this.leg;
    if (leg?.kind === 'board') {
      const hull = this.hull;
      this.findAlight(leg.pad ?? this.route.from);
      this.host.unseat(hull, this.alightAt);
      this.seated = false;
      this.refunded = true;
      this.host.giveBack(this.route.ticket);
      this.host.say(`you step off the shuttle${this.ticketBack()}`);
      this.finish('stepped off', 'stepped off before it lifted off');
      return true;
    }
    if (leg?.kind === 'off') {
      this.letOff();
      return true;
    }
    this.host.say('the shuttle is in the air: you step off once it has landed');
    return true;
  }

  /** What is said of a ticket given back, for a trip boarded on one (the console's rides are not). */
  private ticketBack(): string {
    return this.route.ticket ? '; your ticket is back in hand' : '';
  }

  /** What the bar offers the passenger: nothing unseated, stepping off while it boards and once it has landed, and nothing while it flies. */
  promptPhase(): '' | 'board' | 'flying' | 'arrived' {
    if (!this.seated) return '';
    const k = this.leg?.kind;
    return k === 'board' ? 'board' : k === 'off' ? 'arrived' : 'flying';
  }

  /**
   * The long line for the passenger, over whatever else it would say, or null unseated: how long before
   * it lifts off while it boards, where it goes while it flies, and where it has landed. Made again only
   * when the phase or the second shown changes; the same string otherwise.
   */
  promptLine(): string | null {
    const phase = this.promptPhase();
    if (!phase) return null;
    const n = phase === 'board' ? Math.max(0, Math.ceil(this.round.left)) : 0;
    if (phase === this.linePhase && n === this.lineN) return this.line;
    this.linePhase = phase;
    this.lineN = n;
    const to = this.route.to.port || 'the far pad';
    this.line = phase === 'board' ? `on the shuttle to ${to} · it lifts off in ${n}s · <b>E</b> steps off` : phase === 'arrived' ? `the shuttle has landed at ${to} · <b>E</b> steps off` : `on the shuttle to ${to}`;
    return this.line;
  }

  /**
   * Where a passenger saved in the middle of the trip is put down again. While it still waits on the pad
   * it leaves, where they boarded it: that pad's collector, else the foot of the hull's ramp, since a trip
   * ended there gives the ticket back and a place kept at the far end would be a trip for nothing. From
   * the lift-off on, where the ticket goes: the far pad's collector, else the port itself (whose height
   * the caller finds, `y` NaN), else the far pad. Null unseated, where they stand is where they are. The
   * record is kept and written, not made.
   */
  keepPlace(): { pack: string; x: number; y: number; z: number } | null {
    if (!this.seated) return null;
    const k = this.kept;
    const leg = this.leg;
    if (leg?.kind === 'board') {
      const from = leg.pad ?? this.route.from;
      k.pack = from.pack;
      if (from.collector) {
        k.x = from.collector.x;
        k.y = from.collector.y;
        k.z = from.collector.z;
      } else {
        this.findAlight(from);
        k.x = this.alightAt.x;
        k.y = this.alightAt.y;
        k.z = this.alightAt.z;
      }
      return k;
    }
    const to = this.route.to;
    k.pack = to.pack;
    const pad = to.pad;
    if (pad?.collector) {
      k.x = pad.collector.x;
      k.y = pad.collector.y;
      k.z = pad.collector.z;
    } else if (to.at) {
      k.x = to.at.x;
      k.y = Number.NaN;
      k.z = to.at.z;
    } else if (pad) {
      k.x = pad.x;
      k.y = pad.y;
      k.z = pad.z;
    } else return null;
    return k;
  }

  /**
   * Whether its hull stands on the pad `key` names, or is still on its way up from it short of its cut:
   * parked there after letting somebody off, or lifting off it empty. What a trip about to swap its own
   * hull in on that pad takes away in the same step; a hull anywhere else, a nearby pad's included, is
   * left to fly on and go once nobody can see it.
   */
  standsAt(key: string): boolean {
    const leg = this.running && this.hull ? this.route.legs[this.index] : undefined;
    if (!leg || !(leg.kind === 'off' || (leg.kind === 'leave' && !this.away))) return false;
    return (leg.pad ?? this.route.to.pad)?.key === key;
  }

  /** Where the trip is, for the console. */
  report(): Record<string, unknown> {
    const n2 = (n: number) => Number(n.toFixed(2));
    const hull = this.hull;
    const p = this.paths;
    const moment = (m: { t: number; speed: number; height: number } | null | undefined) => (m ? { t: n2(m.t), speed: n2(m.speed), height: n2(m.height) } : null);
    return {
      from: this.route.from.key,
      to: this.route.to.pad?.key ?? null,
      port: this.route.to.port || null,
      passenger: this.passenger,
      riding: this.seated,
      ticketBack: this.refunded,
      running: this.running,
      ended: this.ended || null,
      why: this.why || null,
      leg: this.leg?.kind ?? null,
      legs: this.route.legs.map((l, i) => ({ kind: l.kind, began: Number.isFinite(this.started[i]) ? n2(this.started[i]) : null })),
      seconds: n2(this.elapsed),
      legSeconds: n2(this.legClock),
      clip: n2(this.clip),
      hull: hull
        ? { at: hull.pos.toArray().map(n2), speed: n2(hull.speed), airborne: hull.airborne, ghosted: hull.ghosted, disposed: hull.disposed }
        : null,
      holds: { origin: this.origin || null, destination: this.dest || null },
      cut: moment(p?.cut),
      join: moment(p?.join),
      landsWith: p?.landMood ?? null,
      alight: this.alightFrom ? { at: this.alightAt.toArray().map(n2), from: this.alightFrom } : null,
      unseen: n2(this.unseen),
      pilot: this.route.legs.some((l) => l.kind === 'fly') ? this.pilot.report() : null,
      tune: { ...RIDE_TUNE },
    };
  }

  // ---------------------------------------------------------------- the legs

  /** Parked at the first pad until its round lifts off, then the take-off on the same frame. */
  private board(leg: RideLeg): void {
    const pad = leg.pad ?? this.route.from;
    this.readRound(pad);
    if (this.roundPose.role === 'ground') {
      this.drive('ground', 0);
      return;
    }
    this.next();
    const now = this.route.legs[this.index];
    if (now?.kind === 'lift') this.liftOff(now);
  }

  /**
   * The take-off, on the clock: where the pad's round has its clip (never going back, however the clock
   * is corrected), and at its cut -- or the first frame that finds the round already past it, a tab away
   * for minutes -- let go into flight at the cut's own pose and speed, its pad given back softly.
   */
  private liftOff(leg: RideLeg): void {
    const pad = leg.pad ?? this.route.from;
    const paths = this.paths!;
    const cut = paths.cut!;
    this.readRound(pad);
    const r = this.roundPose;
    const s = r.role === 'lift' ? Math.max(this.clip, r.seconds) : r.role === 'ground' ? this.clip : Infinity;
    if (s >= cut.t) {
      this.handOver(paths.lift, cut.t, pad, paths.liftMood);
      if (this.origin) {
        this.host.rigs.release(this.origin);
        this.origin = '';
      }
      this.next();
      return;
    }
    this.clip = s;
    this.flyClip(paths.lift, s, cut.t, pad, paths.liftMood);
  }

  /**
   * The console's hop: flown on for a few seconds past the cut, then put straight onto the landing at
   * its join on the destination pad, whose own shuttle goes out of the picture that same step.
   */
  private skip(leg: RideLeg, dt: number): void {
    const hull = this.hull!;
    this.legClock += dt;
    hull.setGhost(true);
    this.drive('sky', 0);
    if (this.legClock < RIDE_TUNE.hopSeconds) return;
    const pad = leg.pad ?? this.route.to.pad;
    const paths = this.paths!;
    if (!pad || !paths.join) {
      this.finish('failed', 'nowhere to land');
      return;
    }
    landingTarget(pad, paths.land, paths.join, hull.rig!.offset, this.target);
    this.holdDestNow(pad.key);
    hull.hold(null, this.target.pos, this.target.quat, this.target.speed);
    hull.rig!.pose('land', paths.join.t, paths.landMood);
    hull.airborne = true;
    this.next();
  }

  /**
   * Flown by its pilot from the cut to the landing's join, ghosted as every leg but a parked one is: a
   * look ahead for anything solid every `rayEvery`, every other ship flying weighed against it, and a
   * step of the pilot. A pass too far off the join is planned again from where the hull is, once; at
   * the join the far pad's own shuttle goes out of the picture and the landing begins, held that same
   * step exactly where the flight left the hull.
   */
  private fly(dt: number): void {
    const hull = this.hull!;
    const pilot = this.pilot;
    hull.setGhost(true);
    this.drive('sky', 0);
    const q = hull.group.quaternion;
    nose.set(0, 0, 1).applyQuaternion(q);
    if (this.elapsed >= this.nextRay) {
      this.nextRay = this.elapsed + AVOID_TUNE.rayEvery;
      // Never further than the course goes: past the join the landing clip has the hull, down the game's
      // own path in, and what stands round the far pad is that path's to clear, not the pilot's to climb.
      const c = pilot.course;
      const left = c ? c.total - c.ss[pilot.progress] : Infinity;
      const reach = Math.min(Math.max(AVOID_TUNE.rayMin, Math.abs(hull.speed) * AVOID_TUNE.rayAhead), left);
      if (reach > 1) {
        const d = this.host.castAhead(hull, hull.pos.x, hull.pos.y, hull.pos.z, nose.x, nose.y, nose.z, reach);
        if (d < reach) pilot.noteObstacle(hull.pos.y + nose.y * d, this.elapsed);
      }
    }
    selfVel.copy(nose).multiplyScalar(hull.speed);
    this.host.eachShip(hull, this.visitShip);
    const said = pilot.step(dt, this.elapsed, hull.pos, q, hull.cruise, this.groundAt);
    if (said === 'replan') {
      this.plan(false);
      return;
    }
    if (said !== 'join') return;
    this.next();
    const leg = this.route.legs[this.index];
    if (leg?.kind === 'land') this.land(leg, 0);
  }

  /**
   * A course for the pilot from where the hull is now to the landing's join on the far pad (`landingTarget`):
   * the hull's own heading and speed at one end, the clip's path and speed at the join at the other, at
   * the radius the hull turns at the ride's own cruise. `atCut` gives the course the pad it leaves as the
   * ground under its start; a go-around starts where nothing about the ground is known yet.
   */
  private plan(atCut: boolean): void {
    const hull = this.hull!;
    const paths = this.paths!;
    const pad = this.route.to.pad;
    if (!pad || !paths.join) {
      this.finish('failed', 'nowhere to land');
      return;
    }
    landingTarget(pad, paths.land, paths.join, hull.rig!.offset, this.target);
    nose.set(0, 0, 1).applyQuaternion(hull.group.quaternion);
    const f = this.fromState;
    f.x = hull.pos.x;
    f.y = hull.pos.y;
    f.z = hull.pos.z;
    f.heading = Math.atan2(nose.x, nose.z);
    f.speed = hull.speed;
    f.ground = atCut ? this.route.from.y : undefined;
    const j = this.joinState;
    j.x = this.target.pos.x;
    j.y = this.target.pos.y;
    j.z = this.target.pos.z;
    j.heading = this.target.heading;
    j.speed = this.target.speed;
    j.descent = -this.target.climb;
    j.ground = pad.y;
    const top = Math.min(RIDE_PILOT.cruise, hull.spec.maxSpeed);
    this.pilot.setCourse(planCourse(f, j, planRadius(top, hull.spec.turnRate), RIDE_PILOT), top);
    this.nextRay = this.elapsed;
  }

  /**
   * No pad at the far end: the passenger is put down at the port the old way, once the take-off has
   * shown the shuttle leave, and the trip is over.
   */
  private walkOff(leg: RideLeg): void {
    const hull = this.hull!;
    const port = leg.port ?? this.route.to.port;
    if (this.seated) {
      this.host.unseat(hull, hull.pos);
      this.seated = false;
    }
    this.finish('walked', '');
    if (this.passenger) {
      this.host.say(`the shuttle to ${port} has no pad to land on there, so you are set down at the port`);
      this.host.walkOff(leg.world, port);
    }
  }

  /**
   * The landing clip from its join to the ground, on the trip's own clock: settled onto from wherever
   * the hull was handed over (`settleOnto`, eased from nought so it carries on at the clip's own speed),
   * over a time that grows with how far off the clip it arrived.
   */
  private land(leg: RideLeg, dt: number): void {
    const hull = this.hull!;
    const paths = this.paths!;
    const pad = leg.pad ?? this.route.to.pad!;
    const t0 = paths.join!.t;
    this.clip = Math.min(paths.land.seconds, this.clip + dt);
    const t = this.clip;
    const offset = hull.rig!.offset;
    vehicleAt(pad, paths.land, t, offset, jP, jQ);
    settleOnto(this.fromP, this.fromQ, this.baseP, this.baseQ, jP, jQ, settleEase((t - t0) / this.settle), vP, vQ);
    vehicleVelocity(pad, paths.land, t, offset, vel);
    hull.hold(null, vP, vQ, vel.length());
    hull.rig!.pose('land', t, paths.landMood);
    hull.setGhost(true);
    this.overPad = vP.y - this.parkedY;
    hull.airborne = this.overPad > 0.5;
    this.drive('land', t);
    if (t >= paths.land.seconds) this.next();
  }

  /**
   * Parked where it landed, solid: a passenger let off after `alightAfter` seconds unless they step off
   * first, and then `dwell` seconds more with nobody in it before it goes.
   */
  private parked(dt: number): void {
    this.legClock += dt;
    this.hull!.setGhost(false);
    this.drive('ground', 0);
    if (this.seated) {
      if (this.legClock >= RIDE_TUNE.alightAfter) this.letOff();
      return;
    }
    if (this.legClock >= RIDE_TUNE.dwell) this.next();
  }

  /** The passenger let off at the foot of the ramp where it landed, and the parked hull's own wait begun. */
  private letOff(): void {
    const hull = this.hull;
    if (!this.seated || !hull) return;
    this.host.unseat(hull, this.alightAt);
    this.seated = false;
    this.legClock = 0;
    this.host.say(`you arrive at ${this.route.to.port || 'the far pad'}`);
  }

  /**
   * Empty, it lifts off from where it landed on its own clock, is let go at the cut as the first
   * take-off was, and flies on until nobody has been able to see it for `vanishUnseen` seconds; then the
   * trip is over and everything it held is given back.
   */
  private leave(leg: RideLeg, dt: number): void {
    const hull = this.hull!;
    const pad = leg.pad ?? this.route.to.pad!;
    const again = this.again!;
    if (!this.away) {
      this.clip += dt;
      const cut = again.cut!;
      if (this.clip >= cut.t) {
        this.handOver(again.lift, cut.t, pad, again.liftMood);
        this.away = true;
      } else this.flyClip(again.lift, this.clip, cut.t, pad, again.liftMood);
      return;
    }
    hull.setGhost(true);
    this.drive('sky', 0);
    const cam = this.host.camera();
    camAt.setFromMatrixPosition(cam.matrixWorld);
    this.frustum.setFromProjectionMatrix(this.view.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const seen = inSight(this.frustum, camAt, hull.pos, hull.radius, SHUTTLE_RIG_TUNE.seenFar, SHUTTLE_RIG_TUNE.releaseNear);
    this.unseen = seen ? 0 : this.unseen + dt;
    if (this.unseen >= RIDE_TUNE.vanishUnseen) this.finish('gone', '');
  }

  /** On to the next leg, starting whatever it starts. */
  private next(): void {
    this.index++;
    this.legClock = 0;
    if (this.index < this.started.length) this.started[this.index] = this.elapsed;
    const leg = this.route.legs[this.index];
    if (!leg) return;
    if (leg.kind === 'land') this.beginLanding(leg);
    else if (leg.kind === 'off') this.park(leg);
    else if (leg.kind === 'fly') this.plan(true);
    else if (leg.kind === 'leave') {
      this.clip = 0;
      this.away = false;
      this.unseen = 0;
      // Empty, it flies on straight from its cut: whatever its pilot last held is let go of.
      const d = this.pilot.drive;
      d.stickX = 0;
      d.stickY = 0;
      d.steer = 0;
      d.throttle = 0;
      d.cruise = this.hull ? this.hull.spec.maxSpeed : d.cruise;
    }
  }

  // ---------------------------------------------------------------- poses

  /** The pad's round now, and the clip and moment of it that round has. */
  private readRound(pad: PadRef): void {
    this.host.round(pad, this.round);
    rigPose(this.round, pad.times, this.roundPose);
  }

  /** What the hull's sounds and flames play this frame. */
  private drive(role: RigPose['role'], seconds: number): void {
    const d = this.drawn;
    d.role = role;
    d.seconds = seconds;
    d.shown = true;
    d.carry = true;
    d.flight = RIDE_TUNE.flightEvent;
  }

  /** Parked on the first pad as its own shuttle parks, solid. */
  private parkAtStart(pad: PadRef): void {
    const hull = this.hull!;
    const rig = hull.rig!;
    jP.copy(rig.ground.pos);
    jQ.copy(rig.ground.quat);
    onPad(pad, jP, jQ);
    vehicleFromJoint(jP, jQ, rig.offset, vP);
    hull.hold(null, vP, jQ, 0);
    rig.pose('ground', 0, this.route.mood);
    hull.setGhost(false);
    hull.airborne = false;
    this.overPad = 0;
    this.drive('ground', 0);
  }

  /**
   * The hull where a take-off clip has it at `s` on a pad (`P = Pad × J × T(offset)`), its nose brought
   * round onto its path over the last `align` seconds before the cut, held there at the clip's speed,
   * its limbs posed from the same clip, ghosted and airborne once it is off the pad. Leaves the clip's
   * velocity in the world in `vel`.
   */
  private flyClip(path: RigPath, s: number, cutT: number, pad: PadRef, mood: string): void {
    const hull = this.hull!;
    const rig = hull.rig!;
    pathPose(path, s, jP, jQ);
    onPad(pad, jP, jQ);
    turnOnPad(pad, pathVelocity(path, s, vel));
    const k = alignShare(s, cutT);
    if (k > 0) noseOntoPath(jQ, vel, k, jQ);
    vehicleFromJoint(jP, jQ, rig.offset, vP);
    hull.hold(null, vP, jQ, vel.length());
    rig.pose('lift', s, mood);
    hull.setGhost(true);
    this.overPad = jP.y - (pad.y + rig.ground.pos.y);
    hull.airborne = this.overPad > 0.5;
    this.drive('lift', s);
  }

  /**
   * Let go at a cut: held once more at the cut's own pose, its nose on its path, then released and put
   * into flight along that nose at the clip's speed there, so neither where it points nor how fast it
   * goes changes across the hand-over; from here its autopilot's drive flies it.
   */
  private handOver(path: RigPath, cutT: number, pad: PadRef, mood: string): void {
    const hull = this.hull!;
    this.flyClip(path, cutT, cutT, pad, mood);
    const speed = vel.length();
    hull.release(null);
    hull.launch(speed);
    this.drive('sky', 0);
  }

  /**
   * The landing begun: the hull's pose now is where it is settled from, and the clip's at its join what
   * that is measured against. A hull landing with another branch than it took off on (out of Theed, it
   * comes down as the calm transport does) has its sounds and flames bound to that branch's marks here,
   * its engines carried across, so what it sounds and burns is timed by the clip it is seen playing.
   */
  private beginLanding(leg: RideLeg): void {
    const hull = this.hull!;
    const paths = this.paths!;
    const pad = leg.pad ?? this.route.to.pad!;
    const t0 = paths.join!.t;
    this.holdDestNow(pad.key);
    if (this.fx && paths.landMood !== this.fxMood && this.host.rigs.rebranch(this.fx, paths.landMood)) this.fxMood = paths.landMood;
    this.fromP.copy(hull.group.position);
    this.fromQ.copy(hull.group.quaternion);
    vehicleAt(pad, paths.land, t0, hull.rig!.offset, this.baseP, this.baseQ);
    this.settle = settleSeconds(this.fromP.distanceTo(this.baseP));
    vehicleAt(pad, paths.land, paths.land.seconds, hull.rig!.offset, jP, jQ);
    this.parkedY = jP.y;
    this.clip = t0;
  }

  /** Parked where the landing ends, solid, and where a passenger would step off worked out. */
  private park(leg: RideLeg): void {
    const hull = this.hull!;
    const paths = this.paths!;
    const pad = leg.pad ?? this.route.to.pad!;
    vehicleAt(pad, paths.land, paths.land.seconds, hull.rig!.offset, vP, vQ);
    hull.hold(null, vP, vQ, 0);
    hull.rig!.pose('ground', 0, paths.landMood);
    hull.setGhost(false);
    hull.airborne = false;
    this.overPad = 0;
    this.drive('ground', 0);
    this.findAlight(pad);
  }

  /**
   * Where a passenger steps off a parked hull: off the foot of its ramp, `alight` metres further out the
   * way the ramp runs; for a hull with no ramp, off the side of its box that faces the pad's collector
   * (its right with no collector). Put on the floor found there within `alightDrop`, else at the collector.
   */
  private findAlight(pad: PadRef): void {
    const hull = this.hull!;
    const rig = hull.rig!;
    hull.group.updateMatrixWorld(true);
    const foot = rig.rampFoot;
    if (foot) {
      local.copy(foot);
      local.x += (foot.x < 0 ? -1 : 1) * RIDE_TUNE.alight;
      this.alightFrom = 'ramp';
    } else {
      const b = hull.spec.bounds;
      const halfW = Math.abs(b.max[0] - b.min[0]) / 2;
      const halfL = Math.abs(b.max[2] - b.min[2]) / 2;
      let sx = 1;
      let sz = 0;
      if (pad.collector) {
        local.set(pad.collector.x, pad.collector.y, pad.collector.z).applyMatrix4(toLocal.copy(hull.group.matrixWorld).invert());
        if (Math.abs(local.x) / Math.max(halfW, 1e-3) >= Math.abs(local.z) / Math.max(halfL, 1e-3)) sx = local.x < 0 ? -1 : 1;
        else {
          sx = 0;
          sz = local.z < 0 ? -1 : 1;
        }
      }
      local.set(sx * (halfW + RIDE_TUNE.alight), 0, sz * (halfL + RIDE_TUNE.alight));
      this.alightFrom = 'side';
    }
    local.applyMatrix4(hull.group.matrixWorld);
    const floor = this.host.floorAt(local.x, local.y + 2, local.z, 2 + RIDE_TUNE.alightDrop);
    if (floor !== null) this.alightAt.set(local.x, floor, local.z);
    else if (pad.collector) {
      this.alightAt.set(pad.collector.x, pad.collector.y, pad.collector.z);
      this.alightFrom = 'collector';
    } else {
      this.alightAt.copy(local);
      this.alightFrom = foot ? 'ramp, no floor under it' : 'side, no floor under it';
    }
  }

  /**
   * The pad the hull stands parked on where that pad's own shuttle stands parked too, or '' for none: the
   * first pad while it boards (it leaves that leg the frame the round lifts off), and the second while it
   * stands there landed, if that pad's round has its shuttle waiting on the ground just now.
   */
  private parkedOn(): string {
    const leg = this.running && this.hull ? this.route.legs[this.index] : undefined;
    if (!leg) return '';
    if (leg.kind === 'board') return this.origin;
    if (leg.kind !== 'off' || !this.dest) return '';
    const pad = leg.pad ?? this.route.to.pad;
    if (!pad || pad.key !== this.dest) return '';
    this.readRound(pad);
    return this.roundPose.role === 'ground' ? this.dest : '';
  }

  /** The destination's own shuttle out of the picture at once, however it was held until now. */
  private holdDestNow(key: string): void {
    if (this.destNow && this.dest === key) return;
    const rigs = this.host.rigs;
    // A soft hold made firm: let go of and taken again at once in the same step, so its count is one.
    if (this.dest) rigs.release(this.dest);
    rigs.hold(key, true);
    this.dest = key;
    this.destNow = true;
  }

  /**
   * The end of the trip, however it came: its sounds and flames let go of, both pads given back, and its
   * hull taken out of the world. A pad whose own shuttle stands parked exactly where the hull stands now
   * (the first pad while it boards, the second once it is parked there and that pad's round has its
   * shuttle parked too) is given back at once, so the one is swapped for the other in this same step and
   * nobody sees a pad empty; every other hold goes softly, so no shuttle pops into anybody's view. The
   * holds are counted, and only the release that takes a pad's count to nought gives it back, so the
   * soft ones go first and the one at once last: a hop back to the pad it left holds that pad twice.
   */
  private finish(ended: string, why: string, moved = false): void {
    const parked = this.parkedOn();
    const leg = this.running ? this.route.legs[this.index] : undefined;
    this.token++;
    this.running = false;
    this.ended = ended;
    if (why) this.why = why;
    // Whoever is still seated is put down before anything of the hull goes: at the foot of its ramp where
    // it stands parked, and where it is otherwise, to be moved on at once -- by whoever stopped the trip
    // when they move or end the body themselves (a world going, a death, leaving for the select screen),
    // and otherwise, since it has lifted off and the trip is paid, to the port it was flying to below.
    const seatedIn = this.hull;
    let setDown = false;
    if (this.seated && seatedIn) {
      if (leg?.kind === 'board') this.findAlight(leg.pad ?? this.route.from);
      else if (leg?.kind !== 'off' || !this.alightFrom) this.alightAt.copy(seatedIn.pos);
      this.host.unseat(seatedIn, this.alightAt);
      setDown = !moved && !!leg && leg.kind !== 'board' && leg.kind !== 'off';
    }
    this.seated = false;
    // A ticket not flown on goes back: the trip ended before its hull lifted off, however it ended.
    if (this.passenger && !this.refunded && leg?.kind === 'board') {
      this.refunded = true;
      this.host.giveBack(this.route.ticket);
    }
    const rigs = this.host.rigs;
    if (this.fx) {
      rigs.undrive(this.fx);
      this.fx = null;
    }
    let atOnce = 0;
    if (this.origin) {
      if (this.origin === parked) atOnce++;
      else rigs.release(this.origin);
      this.origin = '';
    }
    if (this.dest) {
      if (this.dest === parked) atOnce++;
      else rigs.release(this.dest);
      this.dest = '';
    }
    for (let i = 0; i < atOnce; i++) rigs.release(parked, i === atOnce - 1);
    this.destNow = false;
    const hull = this.hull;
    this.hull = null;
    if (hull) {
      if (hull.autopilot === this.autopilot) hull.autopilot = null;
      if (!hull.disposed) this.host.disposeHull(hull);
    }
    if (setDown) {
      const port = this.route.to.port;
      this.host.say(`the shuttle to ${port || 'the far pad'} could not fly on, so you are set down at the port`);
      this.host.walkOff(this.route.to.pack, port);
    }
    this.host.ended(this);
  }
}
