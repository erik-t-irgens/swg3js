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
// A trip to another world that skips the flight through space leaves at the take-off's cut all the
// same, and there the passenger is carried across under the loading screen (`RideHost.cross`): the
// world left goes and the hull with it, and in the world arrived at a hull of the same rig stands on the
// far pad's landing, held where the trip comes out, which the trip takes up and lands as it would have
// from its own flight. For as long as that takes the trip has no hull and a frame of it does nothing, so
// the hull going with its world is not a hull lost. The far pad's own shuttle is held out of the picture
// across the world going (a hold outlives it), and the new hull's sounds and flames are its own.
//
// A trip that flies through space goes on from the take-off's cut. Its pilot climbs on along the way
// the clip left it, past the height a ship is offered space at; there the passenger is carried up into
// the orbit their world is reached through, as a ship flown up is, and comes out where the game puts
// that world in it. A jump to another system is the jump every ship makes -- its countdown, its tunnel,
// its view -- with this hull as the ship it flies (`jumpHull`, for the length of that leg alone) and a
// stick let go of while it does; within one system (Corellia and Talus, Naboo and Rori) the pilot flies
// across instead. In the far world's sky it turns toward that world's disc, and is carried down to a
// point high over the far pad's own approach, flown in to the landing's join and landed as any other trip
// is. Nothing on the way may strand anybody in space: a crossing up that fails, and a jump refused or
// failed twice, become a skip straight onto the far pad from wherever the trip is (`replanSkip`), a skip
// or a crossing down that fails sets the passenger down at the port, and a hull lost anywhere does the
// same, once.
//
// It talks to the game only through `RideHost` and a hull only through `RideHull`, so a node test flies
// a whole trip against fakes (`shuttleRide.test.ts`). Nothing in an update allocates; a leg's start may,
// once. Every number of ours is `RIDE_TUNE`, live through `__debug.ride({ tune })` and
// `__debug.rigHull({ ride })`.

import * as THREE from 'three';
import { CHASE_RISE } from '../core/camera.ts';
import { lookRotation } from '../space/hyperspaceMath.ts';
import { AVOID_TUNE, type V3 } from '../space/pilot.ts';
import { settleEase } from '../vehicles/landing.ts';
import type { RigHull, RigPaths } from '../vehicles/rigHull.ts';
import type { DriveInput } from '../vehicles/vehicle';
import { downArrival, replanSkip, type RideRoute, type PadRef, type RideLeg } from './rideRoute.ts';
import { RIG_PATH_TUNE, alignShare, inSight, landingTarget, makeLandingTarget, noseOntoPath, onPad, pathPose, pathVelocity, settleOnto, settleSeconds, turnOnPad, vehicleAt, vehicleFromJoint, vehicleVelocity, type RigPath } from './rigPath.ts';
import { RIDE_PILOT, ShuttlePilot, planClimb, planCourse, planRadius, type RideClimb, type RideState } from './shuttleCourse.ts';
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
  /**
   * The switch for landing in a room (step 9, ours): a transport's trip to Theed Starport lands in the
   * royal hangar on the hangar's own branch, through its door, and its passenger steps off on the deck.
   * False is the old way, set down at the port. Taken by the next trip planned.
   */
  roomPads: true,
  /**
   * While a hull comes down into a room and stands there, the passenger's view keeps the heading the hull
   * had as it came through the door, rather than swinging round with it as it turns on the spot to face
   * back out (Theed's transport turns half round in the hangar): swung, the view went through the walls.
   */
  roomHeadingHold: true,
  /** Seconds the view takes to go from the parked framing to the flight's or back, eased at both ends: never a jump. */
  viewEase: 2,
  /**
   * Metres over the ground a hull carried across to another world must stand where it comes out: at the
   * landing's join where it stands that high, and otherwise further along the landing, where it first does.
   */
  joinClear: 5,
  /**
   * Metres over the height a ship is offered space at (the game's own 1100 over the ground) the climb
   * goes on to before the crossing up: past it, and under the 1500 m where a ship's own flight eases a
   * slack nose back down.
   */
  gateMargin: 150,
  /** Degrees the climb out of the sky is flown at: the calm transport's own take-off climbs at 19 to 20 near its cut. */
  climbDeg: 20,
  /** Seconds a climb is flown before the crossing up is made whatever the height: the height is the pilot's gate, not the crossing's. */
  climbMaxSeconds: 60,
  /** Metres a second in space: the ship's own flight allows twice its top speed there, and this stays under the 399 a body can be moved at. */
  spaceCruise: 300,
  /** Metres from where a world is reached in its zone within which a flight across a system is there. */
  arriveWithin: 300,
  /**
   * Seconds a flight across a system is flown before the rest of the trip goes on from wherever it has got
   * to (the crossing down comes out over the far pad from anywhere in the zone): a point never reached --
   * circled for ever, or never worked out -- must not keep anybody in space. The longest flown rather than
   * jumped, `jumpBeyond` at the space cruise, takes under a minute.
   */
  acrossMaxSeconds: 120,
  /** Metres across one system past which the flight between two of its worlds is jumped rather than flown (the game's own two are 8.4 and 6.9 km). */
  jumpBeyond: 15000,
  /** How many times a jump that ends without arriving is begun again before the rest of the trip is skipped instead. */
  jumpRetries: 1,
  /** Seconds a hull out of a jump turns toward its world's disc and flies on at it before the crossing down. */
  discSeconds: 8,
  /**
   * Metres from the far pad over the ground the crossing down comes out at: under the range a starport's
   * buildings load out to (the streamer's nearest tier), less `downReachMargin`, so it has loaded and been
   * compiled under the crossing's own loading screen, and never nearer than `downReachMin`.
   */
  downReach: 1500,
  downReachMin: 800,
  downReachMargin: 150,
  /**
   * Degrees: the glide the crossing down comes out on, back along the landing's own line from its join
   * (`downArrival`), and flown straight down to it: under the least the pilot ever comes in on
   * (`RIDE_PILOT.glideMin`) and far inside its steepest (`descentMax`), about 130 m over the join at the
   * usual reach. Held no steeper than the landing's own glide at its join, whatever it is set to.
   */
  downGlide: 6,
  /** Metres over the ground under it, where the world arrived at knows its ground, the crossing down comes out at the least. */
  downClear: 100,
  /** Metres a passenger kept at, or put down by, a ticket collector is stood clear of it, toward the pad it serves. */
  collectorClear: 1.5,
};

/**
 * How far from the far pad the crossing down comes out: `downReach`, but inside the range a ground world's
 * starports load out to (`nearRange`), less `downReachMargin`, and never nearer than `downReachMin`.
 */
export function downReachOf(nearRange: number, tune = RIDE_TUNE): number {
  return Math.max(tune.downReachMin, Math.min(tune.downReach, nearRange - tune.downReachMargin));
}

/** The glide the crossing down comes out on, in degrees: `downGlide`, never steeper than the landing's own at its join (`descent`, radians). */
export function downGlideOf(descent: number, tune = RIDE_TUNE, pilot = RIDE_PILOT): number {
  const landing = Math.max((Math.max(0, descent) * 180) / Math.PI, pilot.glideMin);
  return Math.max(0, Math.min(tune.downGlide, landing));
}

/**
 * A place a small step clear of a ticket collector, on its own floor: `collectorClear` metres from its
 * spot toward the pad it serves (along +X where the two stand on one spot), at the collector's own height.
 * Whoever is kept at a collector, or put down by one, is stood there rather than inside the droid.
 * Written into `out`; allocates nothing.
 */
export function besideCollector(collector: { readonly x: number; readonly y: number; readonly z: number }, pad: { readonly x: number; readonly z: number }, out: { x: number; y: number; z: number }, clear = RIDE_TUNE.collectorClear): { x: number; y: number; z: number } {
  const dx = pad.x - collector.x;
  const dz = pad.z - collector.z;
  const l = Math.hypot(dx, dz);
  out.x = collector.x + (l > 1e-6 ? dx / l : 1) * clear;
  out.y = collector.y;
  out.z = collector.z + (l > 1e-6 ? dz / l : 0) * clear;
  return out;
}

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

/**
 * The heading the passenger's view holds while a hull comes down into a room and stands there
 * (`RIDE_TUNE.roomHeadingHold`): the trip it was taken for (null while none is held), the heading and
 * the level turn about the vertical that goes with it. Kept by the game between frames.
 */
export interface HeldHeading {
  ride: object | null;
  heading: number;
  readonly turn: THREE.Quaternion;
}

export function heldHeading(): HeldHeading {
  return { ride: null, heading: 0, turn: new THREE.Quaternion() };
}

const HOLD_UP = new THREE.Vector3(0, 1, 0);
const holdNose = new THREE.Vector3();

/**
 * One frame of the passenger's held heading: `holding` is whether the view is to hold one now -- the
 * switch on, the trip coming down onto a pad in a room or standing there (`ShuttleRide.roomLanding`), and
 * the hull already followed into that room -- and `hullTurn` the hull's own turn. The first frame it holds
 * for a trip, the heading the hull's nose has then (the one it came through the door with) is taken and
 * kept, level, for as long as it holds for that trip, however the hull turns on the spot; a frame that does
 * not hold lets it go, so the next landing takes its own. Answers whether the view is to take `held.turn`
 * and `held.heading` rather than the hull's own. Allocates nothing.
 */
export function holdRoomHeading(held: HeldHeading, ride: object, holding: boolean, hullTurn: THREE.Quaternion): boolean {
  if (!holding) {
    held.ride = null;
    return false;
  }
  if (held.ride !== ride) {
    held.ride = ride;
    const nose = holdNose.set(0, 0, 1).applyQuaternion(hullTurn);
    held.heading = Math.atan2(nose.x, nose.z);
    held.turn.setFromAxisAngle(HOLD_UP, held.heading);
  }
  return true;
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
  /** Every particle file and sound a rig's branches can play, made ready and waited for (`ShuttleRigs.ready`): what is done before a hull is shown. */
  ready(rig: TravelRig, moods: readonly string[], joints: THREE.Object3D): Promise<unknown>;
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
  /**
   * Seat the passenger in a hull, in this step; false when they cannot be (on something else, gone, dead).
   * `room` is the room of the pad's building the hull stands in (Theed's hangar), 0 out in the open: the
   * passenger is carried a dozen metres to their seat, which would otherwise lose the room they are in.
   */
  seat(h: RideHull, room?: number): boolean;
  /**
   * Put the passenger down off a hull, on their feet at `at`: in room `room` of the building the pad stands
   * in where it stands in one (Theed's hangar), which a step of a dozen metres off the seat would otherwise
   * lose, and out in the open with it 0 or left out.
   */
  unseat(h: RideHull, at: THREE.Vector3, room?: number): void;
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
  /** The pack of the world the game stands in now. */
  world(): string;
  /**
   * Carry the passenger across to the world `leg` names, under the loading screen. The world left goes,
   * and `h` with it; in the world arrived at a hull of the same rig is built, held at `arrival` moving at
   * `speed`, ghosted, with the passenger seated in it and nothing else done to it, and that hull is what
   * it resolves with -- or null where no crossing could be made, the passenger then on foot in whichever
   * world it got as far as (off `h`, if `h` went with its world; still in it, if it did not). `ready` is
   * handed the hull that came out as soon as it exists, while the loading screen is still up and before the
   * world arrived at is compiled behind it, and is waited for: whatever the trip will show of that hull is
   * made there, so the screen compiles it rather than the first frames after it lifts.
   */
  cross(h: RideHull, leg: RideLeg, arrival: { readonly pos: THREE.Vector3; readonly quaternion: THREE.Quaternion }, speed: number, ready: (h: RideHull) => Promise<unknown>): Promise<RideHull | null>;
  /**
   * The game's own height for space: how high over the ground a ship is offered it. (How high a ship coming
   * down out of it arrives is not the trip's: a crossing down comes out on a glide of its own, `downArrival`.)
   */
  readonly heights: { readonly gate: number };
  /** Start reading what a flight through space will want (the zones' packs), not waited on. */
  prefetchSpace(): void;
  /**
   * Where `aim`'s world is reached in `aim`'s zone (`zonePlace`), facing `towards`'s where that is given
   * (else out into the open, the other way from a jump's arrival there, which faces the nearest thing
   * standing), written into `out`; false where the zone's pack or the place in it cannot be had. Waits for
   * the zones' packs the first time.
   */
  spacePlace(aim: { zone: string; world: string }, towards: { zone: string; world: string } | null, out: { pos: THREE.Vector3; quaternion: THREE.Quaternion }): Promise<boolean>;
  /** The way to `world`'s disc in the sky of the zone the game stands in now, written into `out`; false where that sky hangs none. */
  discDirection(world: string, out: THREE.Vector3): boolean;
  /** Begin a jump to where `world` is reached in `zone`, flown by the hull a jump leg names (`ShuttleRide.jumpHull`): null once it is counting down, else why not. */
  jump(zone: string, world: string): string | null;
  /** Where the jump is. */
  jumpPhase(): 'idle' | 'countdown' | 'enter' | 'transit' | 'exit';
  /** Whether the jump flies `h` this frame, so its stick is nobody else's. */
  jumpDrives(h: RideHull): boolean;
  /** Stop the jump, wherever it is. */
  jumpAbort(why: string): void;
  /** Metres out to which a ground world's biggest buildings load around whoever plays: the reach a crossing down must come out inside. */
  nearRange(): number;
}

/** What `onLeg` is until something hangs on it. */
const NO_LEG = (_leg: RideLeg, _i: number, _phase: 'start' | 'end'): void => {};

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
/** Where a flight in space flies to or along this step. */
const spaceAt = new THREE.Vector3();

export class ShuttleRide {
  /** The trip's legs: its own, and replaced (never altered in place) where the flight through space is given up for a skip. */
  route: RideRoute;
  private readonly host: RideHost;
  /** Called as each leg starts and ends, in pairs, with its index: where a quest or a next stop hangs on a trip. */
  onLeg: (leg: RideLeg, i: number, phase: 'start' | 'end') => void = NO_LEG;
  /** Whether somebody boards it: a trip on a ticket, or the console's ride; the console's empty trips have nobody. */
  readonly passenger: boolean;
  /** The pilot that flies it between its clips (`shuttleCourse.ts`), made once for the trip. */
  readonly pilot = new ShuttlePilot();
  /** What flies the hull between its clips, handed to it as its autopilot and flown on with a panel open. The drive is the pilot's, kept and written in place. */
  readonly autopilot: { readonly drive: DriveInput; readonly unpaused: true };
  /** The hull a jump leg flies, for the length of that leg and no longer: the one hull the jump may take that its passenger does not fly. */
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
  /** When each leg began, seconds into the trip (NaN for one not reached); made again when the legs are. */
  private started: Float64Array;
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
  /** The token of the crossing under way, 0 for none: one that comes back under another token belongs to a trip that has since ended. */
  private crossToken = 0;
  /** The hull a crossing left, until it is over: gone with its world by then, or, for a crossing that never got going, still here to be taken away. */
  private crossFrom: RideHull | null = null;
  /** Where a crossing comes out, and which way the hull faces there; kept and written. */
  private readonly arrival = { pos: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  /** Whether whoever stopped the trip moves the passenger themselves, for a hull that comes out of a crossing after it stopped. */
  private endMoved = false;
  /** The moment of its clip a landing about to begin starts at, NaN for its join; and the moment the landing now flown began at. */
  private landStart = Number.NaN;
  private landFrom = 0;
  /** The things the pilot is handed every frame, made once here rather than a closure a frame. */
  private readonly groundAt: (x: number, z: number) => number | null;
  private readonly visitShip: (pos: V3, vel: V3, radius: number) => void;
  private readonly visitShipInSpace: (pos: V3, vel: V3, radius: number) => void;
  /** The climb out of the sky: its line, kept and written, the height over the ground it goes on to, and the ground last read under it. */
  private readonly climbPlan: RideClimb = { heading: 0, pitch: 0, toY: 0, run: 0 };
  private climbOver = 0;
  private climbGround = 0;
  /** Where a place in space is being worked out (a crossing up's arrival, a flight's point), which a frame waits on; and whether the flight's point is in hand. */
  private placing = false;
  private aimReady = false;
  private readonly aimAt = new THREE.Vector3();
  private readonly placeOut = { pos: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  /** The speed a crossing was asked to come out at, taken up when it is over. */
  private crossSpeed = 0;
  /** The jump: how many were begun for this leg, and the zone the last one came out in ('' while none has). */
  private jumpTries = 0;
  private jumpedTo = '';
  /** How many times a passenger was set down at the port because the trip could go no further. */
  private rescues = 0;

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
    this.visitShipInSpace = (pos, vel, radius) => {
      const h = this.hull;
      if (h) this.pilot.noteShipInSpace(pos, vel, radius, h.pos, selfVel, h.radius);
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
   * Whether the passenger is being carried across to another world just now: from the step the crossing
   * is asked for until the hull that comes out of it is taken up, which is when the trip has no hull of
   * its own and the passenger sits in whichever one the crossing has them in.
   */
  get crossing(): boolean {
    return this.crossToken !== 0 && this.running;
  }

  /** Whether something the trip waits on is under way: a crossing, or a place in space being worked out before one. */
  get busy(): boolean {
    return this.running && (this.placing || this.crossToken !== 0);
  }

  /**
   * The jump this trip began has come out in `zone`, and has let go of the hull (the jump's own
   * `onArrived`): the jump leg is over on the next frame the jump no longer flies it.
   */
  jumped(zone: string): void {
    if (this.running && this.route.legs[this.index]?.kind === 'jump') this.jumpedTo = zone;
  }

  /**
   * More legs put into the trip at `at`, which must be after the leg flown now: what a stop on the way or
   * a quest's errand is hung on. False, and nothing changed, at or before the running leg, or once the
   * trip has ended. The legs are the trip's own from here on.
   */
  insert(at: number, legs: readonly RideLeg[]): boolean {
    if (!this.running || at <= this.index || at > this.route.legs.length || !legs.length) return false;
    const all = this.route.legs.slice();
    all.splice(at, 0, ...legs);
    this.setLegs({ ...this.route, legs: all });
    return true;
  }

  /** The trip's legs replaced, what each already flown began at kept. */
  private setLegs(route: RideRoute): void {
    const was = this.started;
    this.route = route;
    this.started = new Float64Array(route.legs.length).fill(Number.NaN);
    this.started.set(was.subarray(0, Math.min(was.length, this.index + 1)));
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

  /** The branch the pad it lands on asks it to land with (a pad in a room's own), or null for the hull's own rule. */
  private landWith(): string | null {
    return this.route.landMood ?? null;
  }

  /**
   * Whether either end of the trip is a pad in a room (Theed's hangar): its sounds then follow the rooms
   * the hull flies through (`RigFx.inside`), since it lifts off out of one or lands in one.
   */
  private inRooms(): boolean {
    return this.route.from.cell > 0 || (this.route.to.pad?.cell ?? 0) > 0;
  }

  /**
   * The pad in a room it is landing on, parked on or lifting off again from empty, or null: while its
   * landing, its wait and its leaving are flown there, what looks in on that room from outside is lit by
   * the room's own lights (`World.hintRoomLight`), and the passenger's view holds its heading once the hull
   * is through the door (`RIDE_TUNE.roomHeadingHold`). Null for a pad in the open, and once it has ended.
   */
  roomPad(): PadRef | null {
    const leg = this.leg;
    if (!leg || !(leg.kind === 'land' || leg.kind === 'off' || leg.kind === 'leave')) return null;
    const pad = leg.pad ?? this.route.to.pad;
    return pad && pad.cell > 0 ? pad : null;
  }

  /** Whether it is coming down onto a pad in a room, or stands landed there: what the passenger's held heading is for. */
  get roomLanding(): boolean {
    const k = this.leg?.kind;
    return (k === 'land' || k === 'off') && this.roomPad() !== null;
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
    const paths = rig ? rig.paths(this.route.mood, this.landWith()) : null;
    // Empty again, it lifts off on the branch it landed with: out of Theed's hangar, through its door.
    const again = rig && paths ? rig.paths(paths.landMood) : null;
    if (!hull || !rig || !paths || !paths.cut || !paths.join || !again?.cut) {
      if (hull && !hull.disposed) this.host.disposeHull(hull);
      this.finish('failed', this.why || (hull ? "its clips give no moment to hand the hull over at, so it cannot be flown" : 'the hull was not built'));
      if (this.passenger) this.host.say(`the shuttle to ${to} cannot be flown (${this.why})${this.ticketBack()}`);
      return 'failed';
    }
    // Everything its flames and sounds can play, on the branch it takes off on and the one it lands with,
    // made ready while it is still out of sight (its hull was compiled as it was built): the swap below shows
    // a hull whose every effect batch already exists, however its set comes to it. A trip ended meanwhile
    // throws the hull away as one ended while it was built does.
    const block = hull.def?.rig?.rig ?? null;
    if (block) {
      try {
        await this.host.rigs.ready(block, paths.landMood === this.route.mood ? [this.route.mood] : [this.route.mood, paths.landMood], rig.joints);
      } catch {
        // Only the effects: a hull whose flames could not be made ready flies without them, as it always could.
      }
      if (token !== this.token) {
        if (!hull.disposed) this.host.disposeHull(hull);
        return 'aborted';
      }
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
    if (this.passenger && !this.host.seat(hull, from.cell)) {
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
    this.fx = rigs.lend(from.key, rig.joints) ?? (hull.def?.rig ? rigs.fxFor(hull.def.rig.rig, this.route.mood, rig.joints, this.inRooms()) : null);
    // A set lent from a shuttle standing in the open follows the rooms too when the trip lands in one, so
    // the hangar's landing is heard in the hangar.
    if (this.fx && this.inRooms()) this.fx.inside = true;
    this.fxMood = this.route.mood;
    if (this.fx) rigs.drive(this.fx, this.posing);
    const dest = this.route.to.pad;
    if (dest) {
      rigs.hold(dest.key);
      this.dest = dest.key;
    }
    // A trip through space reads the zones' packs at its crossing up: asked for now, a minute before.
    if (this.route.legs.some((l) => l.kind === 'up' || l.kind === 'jump')) this.host.prefetchSpace();
    this.onLeg(this.route.legs[this.index], this.index, 'start');
    return 'flying';
  }

  /**
   * One frame of the trip: the leg flown now, and on to the next when it is done. Nothing while a
   * crossing is made, when the trip has no hull. Allocates nothing.
   */
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
        if (leg.aim?.to === 'zonePlace' || leg.aim?.to === 'disc') this.flySpace(leg, dt);
        else this.fly(dt);
        return;
      case 'climb':
        this.climb(dt);
        return;
      case 'up':
        this.upWait(dt);
        return;
      case 'jump':
        this.jumpLeg(dt);
        return;
      case 'down':
        this.downLeg(leg, dt);
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
      const pad = leg.pad ?? this.route.from;
      this.findAlight(pad);
      this.host.unseat(hull, this.alightAt, pad.cell);
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
    this.host.say(this.host.inSpace() ? 'the shuttle is out in space: you step off once it has landed' : 'the shuttle is in the air: you step off once it has landed');
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
   * it leaves, where they boarded it: beside that pad's collector, else the foot of the hull's ramp, since a
   * trip ended there gives the ticket back and a place kept at the far end would be a trip for nothing. From
   * the lift-off on, where the ticket goes: beside the far pad's collector, else the port itself (whose
   * height the caller finds, `y` NaN), else the far pad. Beside a collector is a step clear of it toward its
   * pad (`besideCollector`), never its own spot, which is inside the droid. Null unseated, where they stand
   * is where they are. The record is kept and written, not made.
   */
  keepPlace(): { pack: string; x: number; y: number; z: number } | null {
    if (!this.seated) return null;
    const k = this.kept;
    const leg = this.leg;
    if (leg?.kind === 'board') {
      const from = leg.pad ?? this.route.from;
      k.pack = from.pack;
      if (from.collector) besideCollector(from.collector, from, k);
      else {
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
    if (pad?.collector) besideCollector(pad.collector, pad, k);
    else if (to.at) {
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
    const moment = (m: { t: number; speed: number; height: number; out?: number } | null | undefined) => (m ? { t: n2(m.t), speed: n2(m.speed), height: n2(m.height), out: n2(m.out ?? 0) } : null);
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
      trip: this.route.trip,
      world: this.route.to.pack,
      crossing: this.crossToken !== 0,
      cut: moment(p?.cut),
      join: moment(p?.join),
      landSeconds: p ? n2(p.land.seconds) : null,
      landedFrom: this.started.some((s, i) => this.route.legs[i].kind === 'land' && Number.isFinite(s)) ? n2(this.landFrom) : null,
      landsWith: p?.landMood ?? null,
      // The room its landing pad stands in (Theed's hangar's deck is 5), or 0 for a pad in the open.
      landsInRoom: this.route.to.pad?.cell ?? 0,
      alight: this.alightFrom ? { at: this.alightAt.toArray().map(n2), from: this.alightFrom } : null,
      unseen: n2(this.unseen),
      pilot: this.route.legs.some((l) => l.kind === 'fly') ? this.pilot.report() : null,
      space: this.route.legs.some((l) => l.kind === 'up' || l.kind === 'climb')
        ? {
            busy: this.busy,
            climbTo: n2(this.climbOver),
            jumpTries: this.jumpTries,
            jumpedTo: this.jumpedTo || null,
            jumping: !!this.jumpHull,
            aimReady: this.aimReady,
            aim: this.aimReady ? this.aimAt.toArray().map(n2) : null,
          }
        : null,
      forced: this.route.forced,
      rescues: this.rescues,
      tune: { ...RIDE_TUNE },
    };
  }

  /**
   * The trip's legs as a table, for the console: what each is and where, what it flies toward, when it
   * began and how long it has taken (to the next one's start, or to now for the one flown now).
   */
  legTimes(): { kind: string; world: string; aim: string | null; began: number | null; seconds: number | null }[] {
    const n1 = (n: number) => Number(n.toFixed(1));
    const legs = this.route.legs;
    return legs.map((l, i) => {
      const began = this.started[i];
      const next = i + 1 < legs.length ? this.started[i + 1] : Number.NaN;
      const end = Number.isFinite(next) ? next : i === this.index && this.running ? this.elapsed : Number.NaN;
      const aim = l.aim ? (l.aim.to === 'zonePlace' || l.aim.to === 'disc' ? `${l.aim.to} ${l.aim.world} in ${l.aim.zone}` : l.aim.to === 'height' ? `${l.aim.over} m over the ground` : `${l.aim.to} ${l.aim.port}`) : null;
      return { kind: l.kind, world: l.world, aim, began: Number.isFinite(began) ? n1(began) : null, seconds: Number.isFinite(began) && Number.isFinite(end) ? n1(end - began) : null };
    });
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
   * The flight skipped. Into another world, a crossing is begun on the first frame (`crossTo`). In the
   * same world, the console's hop: flown on for a few seconds past the cut, then put straight onto the
   * landing at its join on the destination pad, whose own shuttle goes out of the picture that same step.
   */
  private skip(leg: RideLeg, dt: number): void {
    if (leg.world !== this.host.world()) {
      this.crossTo(leg);
      return;
    }
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
   * A skip into another world, begun, once: the far pad's own shuttle held out of the picture for good (a
   * hold outlives the world going, and one there when that pad's shuttle is stood starts it hidden), and
   * the passenger carried across to the landing's join over the far pad at the clip's own speed there
   * (`crossWith`). `from` is the hull the crossing carries the passenger out of: the trip's own, or, after a
   * crossing up that failed once its world had gone, the hull that went with it, which is still what the
   * new one is built as.
   */
  private crossTo(leg: RideLeg, from: RideHull | null = this.hull): void {
    const pad = leg.pad ?? this.route.to.pad;
    const paths = this.paths;
    // A crossing carries the player across, so a trip with nobody aboard has nothing to cross with.
    if (!this.passenger) {
      this.finish('failed', 'a trip with nobody aboard is not carried to another world');
      return;
    }
    if (!from || !pad || !paths?.join || !from.rig) {
      this.finish('failed', 'nowhere to land on the far world');
      return;
    }
    landingTarget(pad, paths.land, paths.join, from.rig.offset, this.target);
    this.holdDestNow(pad.key);
    this.arrival.pos.copy(this.target.pos);
    this.arrival.quaternion.copy(this.target.quat);
    this.crossWith(leg, from, this.target.speed);
  }

  /**
   * The crossing down onto the far world, once the jump has quite let go of the hull: the far pad's own
   * shuttle held out of the picture for good, and the passenger carried down to a point on the landing's
   * own line, `downReach` out from that pad and on a straight glide of `downGlide` down to the join, facing
   * along it, at the pilot's own cruise over a planet (`downArrival`): a straight run in, with nothing to
   * turn and nothing to dive. The reach is kept inside the range the far world's starports load out to, so
   * the pad is in and compiled under the crossing's loading screen.
   */
  private crossDown(leg: RideLeg): void {
    const hull = this.hull!;
    const pad = leg.pad ?? this.route.to.pad;
    const paths = this.paths;
    if (!pad || !paths?.join || !hull.rig) {
      this.finish('failed', 'nowhere to land on the far world');
      return;
    }
    landingTarget(pad, paths.land, paths.join, hull.rig.offset, this.target);
    this.holdDestNow(pad.key);
    const t = this.target;
    const a = downArrival([pad.x, pad.y, pad.z], { at: [t.pos.x, t.pos.y, t.pos.z], dirX: Math.sin(t.heading), dirZ: Math.cos(t.heading) }, downReachOf(this.host.nearRange()), downGlideOf(-t.climb));
    const q = lookRotation(a.forward);
    this.arrival.pos.set(a.at[0], a.at[1], a.at[2]);
    this.arrival.quaternion.set(q[0], q[1], q[2], q[3]);
    this.crossWith(leg, hull, Math.min(RIDE_PILOT.cruise, hull.spec.maxSpeed));
  }

  /**
   * A crossing begun, once, to where `arrival` says, coming out at `speed`: the hull's sounds and flames
   * let go of, since the world going takes them anyway, and the passenger carried across in `from`. Until
   * the crossing is over the trip has no hull: the one it leaves goes with its world, which is not the hull
   * lost. Allocates the crossing's own promise and its two answers, once a crossing.
   */
  private crossWith(leg: RideLeg, from: RideHull, speed: number): void {
    if (!this.passenger) {
      this.finish('failed', 'a trip with nobody aboard is not carried to another world');
      return;
    }
    if (this.fx) {
      this.host.rigs.undrive(this.fx);
      this.fx = null;
    }
    const token = this.token;
    this.crossToken = token;
    this.crossFrom = from;
    this.crossSpeed = speed;
    this.hull = null;
    this.legClock = 0;
    let made: Promise<RideHull | null>;
    try {
      made = this.host.cross(from, leg, this.arrival, speed, (h) => this.readyAcross(token, h));
    } catch (err) {
      made = Promise.reject(err);
    }
    made.then(
      (h) => this.crossed(token, h, ''),
      (err: unknown) => this.crossed(token, null, err instanceof Error ? err.message : String(err)),
    );
  }

  /**
   * The hull a crossing has just brought out, while its loading screen is still up and before the world
   * arrived at is compiled behind it: everything its flames and sounds can play made ready -- the branch it
   * flew on and the one it lands with -- so their batches are that screen's to compile, and the set made for
   * it once the crossing is over (`crossed`) finds them there. Nothing for a trip that has since ended.
   */
  private readyAcross(token: number, h: RideHull): Promise<unknown> {
    const rig = h.rig;
    const block = h.def?.rig?.rig ?? null;
    if (token !== this.token || !this.running || !rig || !block) return Promise.resolve();
    const land = rig.paths(this.route.mood, this.landWith())?.landMood ?? this.route.mood;
    return this.host.rigs.ready(block, land === this.route.mood ? [this.route.mood] : [this.route.mood, land], rig.joints);
  }

  /**
   * The crossing over. A trip that ended while it was made lets go of whatever came out of it: that hull
   * taken away with the passenger off it, and set down at the far port unless whoever stopped the trip
   * moves them. A crossing up that got nowhere gives the flight through space up for a skip from wherever
   * the passenger was left (`skipFrom`); any other that got nowhere takes away the hull it left, if its
   * world did not go with it, and sets the passenger down at the far port as a ticket always did.
   * Otherwise the hull that came out is taken up where the other was let go of -- flown by the trip,
   * ghosted, with sounds and flames of its own. Out of a skip it is moved along its landing to where it
   * stands clear of the ground (`clearOfGround`) and landed; out of a crossing up or down it is let go
   * into flight at the speed the crossing was asked for, along the way it faces, and flown on.
   */
  private crossed(token: number, h: RideHull | null, err: string): void {
    if (this.crossToken === token) this.crossToken = 0;
    const to = this.route.to;
    if (token !== this.token || !this.running) {
      if (h && !h.disposed) {
        if (this.passenger) this.host.unseat(h, h.pos);
        if (h.autopilot === this.autopilot) h.autopilot = null;
        this.host.disposeHull(h);
        if (this.passenger && !this.endMoved) this.rescue(to.pack, to.port);
      }
      return;
    }
    const from = this.crossFrom;
    this.crossFrom = null;
    const leg = this.route.legs[this.index];
    const landing = leg?.kind === 'skip';
    const pad = leg?.pad ?? to.pad;
    const rig = h && !h.disposed ? h.rig : null;
    const paths = rig ? rig.paths(this.route.mood, this.landWith()) : null;
    if (!h || h.disposed || !rig || !paths || (landing && (!paths.join || !pad))) {
      // Whatever did come out, with no clips to fly, is taken away with the passenger off it.
      if (h && !h.disposed) {
        if (this.passenger) this.host.unseat(h, h.pos);
        if (h.autopilot === this.autopilot) h.autopilot = null;
        this.host.disposeHull(h);
      }
      if (leg?.kind === 'up') {
        this.skipFrom(from, h ? 'the hull that came up has no clips to fly' : `the crossing up was not made${err ? ` (${err})` : ''}`);
        return;
      }
      if (from && from !== h && !from.disposed) {
        if (this.seated) this.host.unseat(from, from.pos);
        if (from.autopilot === this.autopilot) from.autopilot = null;
        this.host.disposeHull(from);
      }
      // Nothing to fly on in: the passenger set down at the far port.
      this.seated = false;
      this.finish('walked', h ? 'the hull that came across has no landing to fly' : `the crossing was not made${err ? ` (${err})` : ''}`);
      if (this.passenger) {
        this.host.say(`the shuttle to ${to.port || 'the far pad'} could not be flown across, so you are set down at the port`);
        this.rescue(to.pack, to.port);
      }
      return;
    }
    if (from && from !== h && !from.disposed) {
      if (this.seated) this.host.unseat(from, from.pos);
      if (from.autopilot === this.autopilot) from.autopilot = null;
      this.host.disposeHull(from);
    }
    this.hull = h;
    this.paths = paths;
    this.again = rig.paths(paths.landMood) ?? this.again;
    h.autopilot = this.autopilot;
    h.setGhost(true);
    const rigs = this.host.rigs;
    const block = h.def?.rig?.rig ?? null;
    if (!landing) {
      // Out in space, or high over the far world: flown on from here, with the branch it took off on.
      this.fx = block ? rigs.fxFor(block, this.route.mood, rig.joints, this.inRooms()) : null;
      this.fxMood = this.route.mood;
      if (this.fx) rigs.drive(this.fx, this.posing);
      // Over the far world, never under its ground: the glide was worked out from the pad and its join
      // alone, before that world was there to ask, and the settle behind the screen has brought in the
      // ground about where it came out. Raised straight up, before any frame has shown it anywhere.
      if (leg?.kind === 'down') {
        const ground = this.host.groundCached(h.pos.x, h.pos.z);
        if (ground !== null && Number.isFinite(ground) && h.pos.y < ground + RIDE_TUNE.downClear) {
          vP.set(h.pos.x, ground + RIDE_TUNE.downClear, h.pos.z);
          vQ.copy(h.group.quaternion);
          h.hold(null, vP, vQ, this.crossSpeed);
        }
      }
      h.release(null);
      h.launch(this.crossSpeed);
      h.airborne = true;
      this.drive('sky', 0);
      this.next();
      return;
    }
    this.fx = block ? rigs.fxFor(block, paths.landMood, rig.joints, this.inRooms()) : null;
    this.fxMood = paths.landMood;
    if (this.fx) rigs.drive(this.fx, this.posing);
    this.holdDestNow(pad!.key);
    const t = this.clearOfGround(pad!, paths, rig.offset);
    vehicleAt(pad!, paths.land, t, rig.offset, vP, vQ);
    vehicleVelocity(pad!, paths.land, t, rig.offset, vel);
    h.hold(null, vP, vQ, vel.length());
    rig.pose('land', t, paths.landMood);
    h.airborne = true;
    this.drive('land', t);
    this.landStart = t;
    this.next();
  }

  /**
   * The flight through space given up for a skip at the leg flown now (`giveUpSpace`), from a crossing up
   * that got nowhere. Refused before it began, the hull it left is still here with the passenger in it,
   * and the trip takes it up again and flies the skip from it on the next frame; once its world had gone,
   * the passenger is wherever the crossing left them, and the skip is carried out of that hull as it was,
   * whose rig and clips it still names.
   */
  private skipFrom(from: RideHull | null, why: string): void {
    this.giveUpSpace(why);
    const leg = this.route.legs[this.index];
    if (!this.running || !leg) return;
    if (from && !from.disposed && this.host.alive(from)) {
      this.hull = from;
      from.autopilot = this.autopilot;
      from.setGhost(true);
      const block = from.def?.rig?.rig ?? null;
      this.fx = block && from.rig ? this.host.rigs.fxFor(block, this.route.mood, from.rig.joints, this.inRooms()) : null;
      this.fxMood = this.route.mood;
      if (this.fx) this.host.rigs.drive(this.fx, this.posing);
      return;
    }
    if (leg.kind === 'skip') this.crossTo(leg, from);
    else {
      this.seated = false;
      this.finish('walked', why);
      if (this.passenger) this.rescue(this.route.to.pack, this.route.to.port);
    }
  }

  /**
   * The rest of the trip from the leg flown now made a skip straight onto the far pad (`replanSkip`), or a
   * walk from the port where there is no pad or a skip has already failed: what a crossing up that got
   * nowhere and a jump refused or failed twice come to. The leg flown now is ended and the one put in its
   * place begun; the next frame flies it. Said to the passenger.
   */
  private giveUpSpace(why: string): void {
    const was = this.route.legs[this.index];
    this.jumpHull = null;
    this.placing = false;
    this.why = why;
    if (was) this.onLeg(was, this.index, 'end');
    this.setLegs(replanSkip(this.route, this.index, why));
    this.started[this.index] = this.elapsed;
    this.legClock = 0;
    const now = this.route.legs[this.index];
    if (now) this.onLeg(now, this.index, 'start');
    if (this.passenger) this.host.say(`the flight through space could not go on (${why}): the shuttle ${now?.kind === 'skip' ? 'skips the rest of it' : 'sets you down at the port'}`);
  }

  /** The passenger set down at the far port because the trip could go no further: counted, and done once a trip. */
  private rescue(pack: string, port: string): void {
    this.rescues++;
    this.host.walkOff(pack, port);
  }

  /**
   * The moment of the landing a hull carried across comes out at: its join, where it stands `joinClear`
   * metres or more over the ground there, else the first moment after it that it does -- the game's own
   * clips come in through the hills round a few pads, and a hull put down inside one is the first thing
   * its passenger would see. Only ground the world already holds is asked; where it holds none, the join
   * stands, and so it does where the whole landing is buried, which no retail pad is.
   */
  private clearOfGround(pad: PadRef, paths: RigPaths, offset: THREE.Vector3): number {
    const t0 = paths.join!.t;
    const step = 1 / RIG_PATH_TUNE.fps;
    for (let t = t0; t < paths.land.seconds; t += step) {
      vehicleAt(pad, paths.land, t, offset, jP, jQ);
      const ground = this.host.groundCached(jP.x, jP.z);
      if (ground === null || jP.y - ground >= RIDE_TUNE.joinClear) return t;
    }
    return t0;
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

  // ---------------------------------------------------------------- the flight through space

  /** Metres a second the pilot flies at over a planet, and in space: the ride's own, never more than the hull's own flight allows there. */
  private planetTop(): number {
    return Math.min(RIDE_PILOT.cruise, this.hull ? this.hull.spec.maxSpeed : RIDE_PILOT.cruise);
  }

  private spaceTop(): number {
    return Math.min(RIDE_TUNE.spaceCruise, this.hull ? this.hull.spec.maxSpeed * 2 : RIDE_TUNE.spaceCruise);
  }

  /**
   * The climb out of the sky, begun as the take-off lets go: on along the heading the hull left its clip
   * on, at `climbDeg`, to `gateMargin` over the height a ship is offered space at, measured from the
   * ground under the hull (the ground the world holds there, else the pad's). Allocates nothing.
   */
  private startClimb(leg: RideLeg): void {
    const hull = this.hull;
    if (!hull) return;
    nose.set(0, 0, 1).applyQuaternion(hull.group.quaternion);
    const f = this.fromState;
    f.x = hull.pos.x;
    f.y = hull.pos.y;
    f.z = hull.pos.z;
    f.heading = Math.atan2(nose.x, nose.z);
    f.speed = hull.speed;
    const over = leg.aim?.to === 'height' ? leg.aim.over : this.host.heights.gate;
    this.climbOver = over + RIDE_TUNE.gateMargin;
    this.climbGround = this.host.groundCached(hull.pos.x, hull.pos.z) ?? this.route.from.y;
    planClimb(f, f.heading, this.climbGround + this.climbOver, RIDE_TUNE.climbDeg, this.climbPlan);
    this.pilot.resetHand();
  }

  /**
   * A frame of the climb: flown on by the pilot, and over once the hull stands `gateMargin` past the
   * space gate over the ground under it, or has climbed `climbMaxSeconds` whatever the height.
   */
  private climb(dt: number): void {
    const hull = this.hull!;
    this.legClock += dt;
    const g = this.host.groundCached(hull.pos.x, hull.pos.z);
    if (g !== null && Number.isFinite(g)) this.climbGround = g;
    if (hull.pos.y - this.climbGround >= this.climbOver || this.legClock >= RIDE_TUNE.climbMaxSeconds) {
      this.next();
      return;
    }
    this.climbOn(dt);
  }

  /** One step of the climb's own flying, ghosted and burning its engines. */
  private climbOn(dt: number): void {
    const hull = this.hull!;
    hull.setGhost(true);
    this.drive('sky', 0);
    this.pilot.climbStep(dt, this.elapsed, hull.pos, hull.group.quaternion, hull.cruise, this.climbPlan, this.planetTop(), this.groundAt);
  }

  /**
   * The crossing up, begun: where the passenger's world is reached in its orbit worked out from the zones'
   * packs (facing where the flight across the system goes next, for a trip within one, and otherwise out
   * into the open the jump's countdown is flown into, never at a station), and the crossing
   * made once that is in hand, at the speed the hull has then (never under the 60 m/s a ship flown up
   * comes out at). Allocates the answer's promise, once.
   */
  private startUp(leg: RideLeg): void {
    const aim = leg.aim?.to === 'zonePlace' ? leg.aim : null;
    if (!aim) {
      this.giveUpSpace('nowhere to come out in space');
      return;
    }
    const after = this.route.legs[this.index + 1];
    const towards = after?.kind === 'fly' && after.aim?.to === 'zonePlace' ? after.aim : null;
    const token = this.token;
    this.placing = true;
    let asked: Promise<boolean>;
    try {
      asked = this.host.spacePlace(aim, towards, this.arrival);
    } catch (err) {
      asked = Promise.reject(err);
    }
    asked.then(
      (ok) => this.placedUp(token, ok),
      () => this.placedUp(token, false),
    );
  }

  /** The crossing up's place in hand, or not: crossed now, or the flight through space given up for a skip. */
  private placedUp(token: number, ok: boolean): void {
    if (token !== this.token || !this.running) return;
    this.placing = false;
    const hull = this.hull;
    const leg = this.route.legs[this.index];
    if (!hull || leg?.kind !== 'up') return;
    if (!ok) {
      this.giveUpSpace('nowhere to come out in space');
      return;
    }
    this.crossWith(leg, hull, Math.max(60, hull.speed));
  }

  /** A frame of the crossing up while its place is worked out: the climb flown on. */
  private upWait(dt: number): void {
    this.climbOn(dt);
  }

  /** A jump leg begun: none tried yet. */
  private startJump(leg: RideLeg): void {
    this.jumpTries = 0;
    this.beginJump(leg);
  }

  /**
   * The jump the leg names, begun with this hull as the ship it flies (`jumpHull`): refused, the rest of
   * the trip is a skip from here.
   */
  private beginJump(leg: RideLeg): void {
    const aim = leg.aim?.to === 'zonePlace' ? leg.aim : null;
    this.jumpTries++;
    this.jumpedTo = '';
    this.jumpHull = this.hull;
    const why = aim ? this.host.jump(aim.zone, aim.world) : 'nowhere to jump to';
    if (why === null) return;
    this.jumpHull = null;
    this.giveUpSpace(`the jump was refused: ${why}`);
  }

  /**
   * A frame of the jump. While the jump flies the hull its stick is let go of, since the jump owns it and
   * this drive is still handed to it; counting down, it flies straight on at the cruise it will leave at.
   * Once it has come out and let go, the leg is over. A jump that went idle without coming out is begun
   * again, `jumpRetries` times, and then given up for a skip. Ghosted on every frame, whoever flies it:
   * the jump's own release un-ghosts the hull it lets go of in the very frame it says it has come out, and
   * a hull left solid for the one physics step before the next leg ghosts it again is a hull a bolt stops
   * on and another ship can be hurt by.
   */
  private jumpLeg(dt: number): void {
    const hull = this.hull!;
    const host = this.host;
    this.legClock += dt;
    this.drive('sky', 0);
    hull.setGhost(true);
    if (host.jumpDrives(hull)) {
      this.pilot.coast(hull.cruise);
      return;
    }
    if (this.jumpedTo) {
      this.jumpHull = null;
      this.next();
      return;
    }
    if (host.jumpPhase() === 'idle') {
      this.jumpAgain();
      return;
    }
    this.pilot.coast(this.spaceTop());
  }

  /** The jump went idle without coming out: once more, or a skip. */
  private jumpAgain(): void {
    const leg = this.route.legs[this.index];
    if (leg && this.jumpTries <= RIDE_TUNE.jumpRetries) {
      this.beginJump(leg);
      return;
    }
    this.giveUpSpace('the jump could not be made');
  }

  /**
   * A flight in space begun: to where a world is reached in the zone (worked out from the zones' packs,
   * flown straight on meanwhile), or toward a world's disc in its sky (straight on where it hangs none).
   */
  private startSpaceFly(leg: RideLeg): void {
    this.aimReady = false;
    this.pilot.resetHand();
    const aim = leg.aim;
    if (aim?.to === 'disc') {
      this.aimReady = this.host.discDirection(aim.world, this.aimAt);
      return;
    }
    if (aim?.to !== 'zonePlace') return;
    const token = this.token;
    const index = this.index;
    this.placing = true;
    let asked: Promise<boolean>;
    try {
      asked = this.host.spacePlace(aim, null, this.placeOut);
    } catch (err) {
      asked = Promise.reject(err);
    }
    asked.then(
      (ok) => this.placedAim(token, index, ok),
      () => this.placedAim(token, index, false),
    );
  }

  /**
   * A flight across a system's point in hand, or not: flown to, or, where nowhere could be found, left for
   * what comes after it (the disc, the crossing down). Across more than `jumpBeyond` it is jumped instead,
   * the leg made a jump to the same place.
   */
  private placedAim(token: number, index: number, ok: boolean): void {
    if (token !== this.token || !this.running) return;
    this.placing = false;
    if (this.index !== index) return;
    const leg = this.route.legs[index];
    const hull = this.hull;
    if (!ok || !hull || !leg) {
      if (leg && hull) this.next();
      return;
    }
    this.aimAt.copy(this.placeOut.pos);
    if (hull.pos.distanceTo(this.aimAt) > RIDE_TUNE.jumpBeyond) {
      this.onLeg(leg, index, 'end');
      const legs = this.route.legs.slice();
      legs[index] = { ...leg, kind: 'jump' };
      this.setLegs({ ...this.route, legs });
      this.onLeg(legs[index], index, 'start');
      this.startJump(legs[index]);
      return;
    }
    this.aimReady = true;
  }

  /**
   * A frame of a flight in space: the nose onto the point or along the disc's way, bent by any ship too
   * near or on a course to meet it, at the space cruise; over within `arriveWithin` of the point, or once
   * the disc has been turned toward for its seconds, and a flight to a point over after `acrossMaxSeconds`
   * wherever it is. Straight on while the point is still worked out.
   */
  private flySpace(leg: RideLeg, dt: number): void {
    const hull = this.hull!;
    const pilot = this.pilot;
    this.legClock += dt;
    hull.setGhost(true);
    this.drive('sky', 0);
    const q = hull.group.quaternion;
    nose.set(0, 0, 1).applyQuaternion(q);
    const aim = leg.aim;
    if (aim?.to === 'disc') {
      if (this.legClock >= aim.seconds) {
        this.next();
        return;
      }
      pilot.along(this.aimReady ? this.aimAt : nose);
    } else if (this.legClock >= RIDE_TUNE.acrossMaxSeconds) {
      // A place still being worked out is no longer waited on: its answer finds the leg gone (`placedAim`).
      this.placing = false;
      this.next();
      return;
    } else if (this.aimReady) {
      if (pilot.toward(hull.pos, this.aimAt) <= RIDE_TUNE.arriveWithin) {
        this.next();
        return;
      }
    } else pilot.along(nose);
    selfVel.copy(nose).multiplyScalar(hull.speed);
    this.host.eachShip(hull, this.visitShipInSpace);
    pilot.spaceStep(dt, this.elapsed, q, hull.cruise, this.spaceTop());
  }

  /**
   * A frame before the crossing down: flown on as it was while a jump is still letting go of the hull (a
   * crossing now would stop the jump half way out), and then the crossing, once.
   */
  private downLeg(leg: RideLeg, dt: number): void {
    const hull = this.hull!;
    hull.setGhost(true);
    this.drive('sky', 0);
    if (this.host.jumpPhase() === 'idle') {
      this.crossDown(leg);
      return;
    }
    spaceAt.set(0, 0, 1).applyQuaternion(hull.group.quaternion);
    this.pilot.along(spaceAt);
    this.pilot.spaceStep(dt, this.elapsed, hull.group.quaternion, hull.cruise, this.spaceTop());
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
    this.clip = Math.min(paths.land.seconds, this.clip + dt);
    const t = this.clip;
    const offset = hull.rig!.offset;
    vehicleAt(pad, paths.land, t, offset, jP, jQ);
    settleOnto(this.fromP, this.fromQ, this.baseP, this.baseQ, jP, jQ, settleEase((t - this.landFrom) / this.settle), vP, vQ);
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
    const leg = this.leg;
    this.host.unseat(hull, this.alightAt, (leg?.pad ?? this.route.to.pad)?.cell ?? 0);
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

  /** On to the next leg, starting whatever it starts; the one left ended and the next begun, in `onLeg`'s pairs. */
  private next(): void {
    const was = this.route.legs[this.index];
    if (was) this.onLeg(was, this.index, 'end');
    this.index++;
    this.legClock = 0;
    if (this.index < this.started.length) this.started[this.index] = this.elapsed;
    const leg = this.route.legs[this.index];
    if (!leg) return;
    this.onLeg(leg, this.index, 'start');
    if (leg.kind === 'land') this.beginLanding(leg);
    else if (leg.kind === 'off') this.park(leg);
    else if (leg.kind === 'fly') {
      // To a landing's join, a course planned from here (the take-off's pad under its start, where it is
      // straight off the take-off); anywhere else, a flight in space.
      if (leg.aim?.to === 'zonePlace' || leg.aim?.to === 'disc') this.startSpaceFly(leg);
      else this.plan(was?.kind === 'lift');
    } else if (leg.kind === 'climb') this.startClimb(leg);
    else if (leg.kind === 'up') this.startUp(leg);
    else if (leg.kind === 'jump') this.startJump(leg);
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
   * that is measured against -- or at the later moment a hull carried across came out at (`landStart`).
   * A hull landing with another branch than it took off on (out of Theed, it comes down as the calm
   * transport does) has its sounds and flames bound to that branch's marks here, its engines carried
   * across, so what it sounds and burns is timed by the clip it is seen playing.
   */
  private beginLanding(leg: RideLeg): void {
    const hull = this.hull!;
    const paths = this.paths!;
    const pad = leg.pad ?? this.route.to.pad!;
    const t0 = Number.isFinite(this.landStart) ? this.landStart : paths.join!.t;
    this.landStart = Number.NaN;
    this.landFrom = t0;
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
   * (its right with no collector). Put on the floor found there within `alightDrop`, else beside the
   * collector (`besideCollector`, on the floor there where one is found), never on its own spot.
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
      const a = besideCollector(pad.collector, pad, this.alightAt);
      const there = this.host.floorAt(a.x, a.y + 2, a.z, 2 + RIDE_TUNE.alightDrop);
      if (there !== null) a.y = there;
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
    this.endMoved = moved;
    if (why) this.why = why;
    this.placing = false;
    // A jump this trip began is stopped before its hull goes, so the jump lets go of a hull still there.
    if (this.jumpHull) {
      this.jumpHull = null;
      if (this.host.jumpPhase() !== 'idle') this.host.jumpAbort(why || ended);
    }
    // Only a leg that was begun is ended: a trip missed before its swap never began one.
    if (leg && Number.isFinite(this.started[this.index])) this.onLeg(leg, this.index, 'end');
    // Stopped while a crossing is made: the hull it left is still here only if its world has not gone
    // yet, with the passenger still in it, and whatever comes out of the crossing is let go of when it
    // does (`crossed`), which is also where the passenger is set down at the far port.
    const crossing = this.crossToken !== 0;
    const left = crossing && this.crossFrom && !this.crossFrom.disposed ? this.crossFrom : null;
    this.crossFrom = null;
    // Whoever is still seated is put down before anything of the hull goes: at the foot of its ramp where
    // it stands parked, and where it is otherwise, to be moved on at once -- by whoever stopped the trip
    // when they move or end the body themselves (a world going, a death, leaving for the select screen),
    // and otherwise, since it has lifted off and the trip is paid, to the port it was flying to below.
    const seatedIn = this.hull ?? left;
    let setDown = false;
    if (this.seated && seatedIn) {
      // Stood at the foot of its ramp where it stands on a pad, in that pad's room where it has one.
      let room = 0;
      if (leg?.kind === 'board') {
        const pad = leg.pad ?? this.route.from;
        this.findAlight(pad);
        room = pad.cell;
      } else if (leg?.kind !== 'off' || !this.alightFrom) this.alightAt.copy(seatedIn.pos);
      else room = (leg.pad ?? this.route.to.pad)?.cell ?? 0;
      this.host.unseat(seatedIn, this.alightAt, room);
      setDown = !moved && !crossing && !!leg && leg.kind !== 'board' && leg.kind !== 'off';
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
    const hull = this.hull ?? left;
    this.hull = null;
    if (hull) {
      if (hull.autopilot === this.autopilot) hull.autopilot = null;
      if (!hull.disposed) this.host.disposeHull(hull);
    }
    if (setDown) {
      const port = this.route.to.port;
      this.host.say(`the shuttle to ${port || 'the far pad'} could not fly on, so you are set down at the port`);
      this.rescue(this.route.to.pack, port);
    }
    this.host.ended(this);
  }
}
