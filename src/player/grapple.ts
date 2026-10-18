// The grappling hook: its one table of numbers, and the hook itself -- the dart, the mark, firing and
// letting go, and the steps of a frame the player's update runs it through (`beforeMove`, `clip`,
// `afterMove`, the design's §3.1, and from wave 2 `look`). The rope's own geometry and its constraint are
// `grappleRope.ts`; the arithmetic that needs nothing but numbers is `grappleMath.ts`; what is drawn is
// `grappleDraw.ts`; what is heard is `grappleSound.ts`.
//
// Wave 2 gave it its danger and its look. A swing into a wall faster than `slamFrom` hurts, measured against what
// was struck, and past `staggerFrom` staggers with a shake through the camera's own register and a daze through
// the player's own vignette; the fast flight after a let-go counts too (`released`). The catch jolts the view, the
// drawn body leans into the rope and the left arm points up it, and the camera pulls back with speed: all of it
// eased in `look`, which moves no body.
//
// The rope is our own constraint on the player's kinematic capsule: no joint (they never move a kinematic
// body), no body added or taken away per shot, and the dart is a ray, never a body and never a bolt. What
// it may hold and bend round is what stands still. The body it works on is a small view of the player
// (`GrappleBody`), so the node harness runs the very same steps in the very same order the player does.
//
// Wave 3 gave it things that move on the rope, the first of them a loose prop (`holding`): a dart that strikes one
// light enough by the mass rule (`whoMoves`) hooks it, the rope's end kept in the prop's own frame and read off its
// mesh, never wrapping; F yanks it to the rope point through the grip's own `holdAt`, and with no F the rope is a
// tether that drags it once walked out past its length. Nothing of a hooked prop touches the body: the rope there
// moves the thing and never the player. And the hook's numbers that progression can change (its range, the reel, the
// haul, the sway and the tether's strength) are read through the stat table (`stats.apply`), which hands back the
// tune's own number while nothing grants them.
//
// Wave 3b gave it the vehicles this browser simulates (§3.18): the rope no longer passes through a hull. It bends round
// one as round a wall, the bend riding the hull's own frame as it moves (`grappleFrames.ts` keeps each hull near the
// rope as a frame, its pose led to the frame's time); the dart bites one, moving or not, aimed true in its frame; and the
// player stays hooked while it moves, dragged behind a speeder, swung under a ship, reeled or hauled up to it. The rope
// pulls on the hull by the reduced mass of the two, told to the hull's own hit tests (`Vehicle.pulled`), never on one
// whose drive writes its velocity, and a parked hull that nothing drives holds against it as though braked (a budget
// carried between physics steps). A rope on anything that moves slips rather than snapping the player about, a tow
// slides on rules of its own (and skims over water), a towed body never stands below the terrain, and a hull the rope
// rides and that moves is met by a test of the rope's own in that hull's frame, not by the character controller, which
// meets it a step stale.
//
// Wave 3c gave it another player's vehicle, which in this browser is a picture and a sensor box: the dart bites the box
// (amber, as any hull), the rope wraps it and tows the player behind it, and while the rope rides it the body is held off
// it as off a hull this browser simulates, all by the rope's own arithmetic against that box (`grappleBox.ts`, the box
// test `HullFrames.peerTest`) in a smooth pose of the rope's own (§3.18), and nothing is ever put on it, since only its
// rider's game can move it. It lets go when that player is no longer shown on that vehicle, or a state of theirs lands further than
// `peerJump` from where the pose expected it; and a slam that came of it, on the rope or in the flight after one, harms
// only where that player could hurt you (`mayHurtPeer`, the server's friendly fire or a duel).
//
// A player who never fires plays exactly as before: every line the player's update adds for this is behind
// `out`, and everything that touches the body behind `attached`. Every number here is in `GRAPPLE_TUNE` and
// moves live through `__debug.grapple({ tune })`.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/physics.ts';
import type { StatId } from '../progress/stats.ts';
import type { HookableProp } from '../world/looseProps.ts';
import type { Vehicle } from '../vehicles/vehicle.ts';
import { JKA, UNIT } from './jkaMove.ts';
import { GrappleRope, RopeConstraint, isTerrainCollider } from './grappleRope.ts';
import { HullFrames, MAX_HULL_CONTACTS, MAX_HULL_FRAMES, newHullHit, type HullFrame, type PeerHull, type PeerHulls, type PeerPicture } from './grappleFrames.ts';
import { SWIM_DEPTH, type SwimIn } from './swimStep.ts';
import type { HarmKind } from './harmRule.ts';
import {
  GRAPPLE_RELEASE_MUTES,
  WALKABLE,
  aimTrue,
  brakeBudgetIn,
  parkedLevelIn,
  reducedShareIn,
  slipCatchIn,
  slipLeftIn,
  slipReelExcessIn,
  slipsTurnIn,
  towingIn,
  turnBy,
  camScaleFor,
  clipInto,
  clipIntoRec,
  type ClipAnswer,
  dazeAt,
  grappleMutes,
  gravityAddBack,
  joltFor,
  kindBites,
  kindHolds,
  leanAngleOf,
  leanIdentity,
  leanOf,
  leanRate,
  leanToward,
  len2,
  len3,
  markShows,
  newRopeModes,
  ratchetDue,
  releasedHolds,
  riseOf,
  ropeModes,
  shakeAt,
  slamCounts,
  slamHarm,
  staggerFor,
  swimLifts,
  teleported,
  THING_RELEASE_MUTES,
  turnByQuat,
  wadeDragOf,
  wallFrictionSpare,
  whoMoves,
  type LeanQuat,
  type LeanStep,
  type MarkKind,
  type MarkReach,
  type RopeModes,
  type WhoMoves,
} from './grappleMath.ts';

export { WALKABLE };

type R = typeof RAPIER_NS;
type Collider = RAPIER_NS.Collider;

/**
 * Every number of the hook, tagged in the design's §7: [owner] the owner's own, the rest ours unless said.
 * Build-only keys (`maxWraps`, `maxGroundWraps`, `dartTrail`, `sagSegments`, `dartSize`) size kept arrays
 * and meshes and take effect at the next load.
 */
export const GRAPPLE_TUNE = {
  // --- the rope and wrapping ---------------------------------------------------------------------------
  /** [owner] The dart's reach and the rope's longest length, metres. */
  range: 100,
  /** Bends on anything but the ground; the 33rd fouls. Build-only. */
  maxWraps: 32,
  /** Bends on the terrain's heightfield, counted apart: a rope over a crest bends at every crease. Build-only. */
  maxGroundWraps: 96,
  startPad: 0.04,
  wrapOffset: 0.04,
  anchorOffset: 0.05,
  searchIters: 18,
  chord: 0.25,
  maxPieces: 24,
  maxWrapsPerPiece: 4,
  minFree: 0.6,
  unwrapMargin: 0.02,
  sweepLean: 0.7,
  /** Opposed faces put a bend off the first face as well as back along the sweep; off, the first rule. */
  opposedLean: true,
  /** The fan test for things thinner than a sweep piece; off, rays only, to compare. */
  fan: true,
  /** Bending at all; off, a straight rope through everything, to compare. */
  wrap: true,
  rebindReach: 0.2,
  /** [owner] The rope and the dart see vehicles' hulls (wave 3); off, they pass through every hull as before the amendment, to compare. */
  vehicles: true,
  /** The tighten pass on bends that ride a hull: one bending the rope by less than `straightDeg` (degrees) whose straightened span is clear comes out. */
  tighten: true,
  straightDeg: 2,
  // --- the body on the rope ----------------------------------------------------------------------------
  /** Where on the body the rope pulls: this far over the feet, a fixed point and never a bone. */
  ropeY: 1.3,
  /** Under this much slack the rope is taut. */
  tautEps: 0.001,
  /** [owner] "Don't ease gravity": 1 is the game's own and adds nothing; any other value scales gravity while swinging, to compare. */
  gravity: 1,
  /** A body on the ground slides (no friction) past this speed across it, latched and taut. */
  slideOver: 7,
  /** How far inside its length the ground may hold a scraping swing and the rope still count as taut for the slide and its latch (m). */
  latchSlack: 0.25,
  /** The teleport guard's margin over what a frame's speed and correction allow. */
  teleportMargin: 1,
  /** The capsule's collider put where the body is before the controller, while attached. */
  syncCollider: true,
  /** The velocity a surface refused taken off, while attached. */
  clipRefused: true,
  /** That clip, and every contact's measure, relative to the touched body's point velocity; off, absolute. */
  clipRelative: true,
  /** The sway's push across the rope (m/s²), and the speed that way past which it pushes no more. */
  swayAccel: 6,
  swayMax: 12,
  /** The swing's drag across the rope in the air, per second. */
  swingDrag: 0.02,
  /** Friction on the speed along a wall while touching one (m/s²), sparing the sway's own direction. */
  wallFriction: 6,
  beta: 1,
  bounce: 0,
  /** The held reel, in or out (m/s). */
  reel: 6,
  /** Space while swinging: this push along the line, then the rope lets go (m/s). */
  boost: 8,
  /** F held: the straight haul toward the rope's first point (m/s). */
  haul: 18,
  /** The haul arrives at rest on the frame it ends at `minFree`; off, it keeps its own speed, to compare. */
  haulArrive: true,
  lipTrigger: 0.05,
  lipSlack: 0.3,
  lipUp: 6,
  lipOver: 4,
  lipClear: 0.05,
  lipMost: 1.0,
  arriveReach: 1.2,
  // --- the water ---------------------------------------------------------------------------------------
  /** Past this rise of the free span (degrees), a reel-in takes the swim's vertical. */
  swimLift: 45,
  /** A band about `swimLift`, should a swell make it hover on the line. */
  swimLiftBand: 0,
  /** The drag on a body hanging in water shallower than the swim, per second at the swim's depth. */
  wadeDrag: 1,
  // --- vehicles (wave 3) -------------------------------------------------------------------------------
  /** A catch on a rope touching a hull is taken whole up to this relative speed (m/s), the rest at `slipDecel` (m/s²), the rope paying out meanwhile. */
  slipKeep: 12,
  slipDecel: 60,
  /** The most centripetal pull (m/s²) a rope touching a hull holds before its turn slips and the rope pays out. */
  slipTurn: 80,
  /** The fastest a hull may shorten the free span by dragging a bend or the anchor away (m/s); past it the rope pays out. */
  slipReel: 15,
  /** The most a slipping rope corrects the hand's place in a frame (m); the rest pays out. */
  slipCorr: 0.25,
  /** A rope on a hull that pulled within this long (s) counts as taut for the slide: the tow. */
  towHold: 0.3,
  /** The ground's (or the water's) drag on a towed body (m/s², against its level speed), in place of Jedi Academy's friction. */
  towFriction: 6,
  /** A tow's swing across its rope, relative to its pivot, damped at this rate (1/s): a skier holding a line. */
  towDamp: 2,
  /** Of a hull's weight, the level pull a hull at rest at the rope's first pull, and that nothing drives, resists (a budget carried between physics steps); 0 turns the brake off. */
  parkHold: 0.6,
  /** Under this level speed (m/s) at the rope's first pull, a hull is at rest and braked. */
  parkRest: 0.5,
  /** A roped hull whose lag over the frame passes this (m) leaves the character controller for the hull test, and comes back under half of it; also what makes a hull still for the haul. */
  hullLag: 0.02,
  /** The most the hull test moves the body out of a hull it starts inside, in a frame (m). */
  hullPush: 0.25,
  /** Off: a roped moving hull stays with the character controller and the capsule's solver pairing, as the amendment first had it, to compare. */
  hullTest: true,
  /** Off: a hull's poses are where the last physics step left them, never led to the frame's time (the prototype's `lead: 'none'`), to compare. */
  hullLead: true,
  /**
   * The pose the rope rides on another player's vehicle (wave 3c): 'smooth', dead-reckoned from the relay's own velocity
   * and held back by the glide's mean lag; 'picture', the glided picture led by the glide's own step, to compare.
   */
  peerPose: 'smooth' as 'smooth' | 'picture',
  /**
   * How fast the smooth pose eases toward the last state heard plus its velocity times the time since, and the velocity
   * it rides toward the relay's own (s). The design's 0.3 handed every state's few milliseconds of jitter in when it was
   * heard on to the pose's speed (a millisecond of it is 4 cm at 40 m/s): with states stamped as they arrive, 5 ms of
   * network jitter swung the pose 39.4 to 40.6 m/s and a tow over the ground dipped 1.1 m/s under the vehicle's speed at
   * 144 and 60 fps, where at 0.5 the pose holds 39.6 to 40.3 and the tow stays within 0.8; with every state stamped only
   * as the next frame starts (a main thread busy all frame) at 60 fps, 0.3 let a tow over the ground go slack past the
   * tow's own hold and drop to 31 m/s, where 0.5 holds it over 38. The price is a pose slower to follow a change of speed
   * [computed, a one-dimensional model]: 1.65 m behind the picture at 8 m/s² against 0.9, and run on past a vehicle that
   * stops by 5.3 m braking at 15 m/s² and 9.4 m stopping dead, against 2.2 and 5.5 at 0.3 (4.3 riding the relay's
   * velocity raw), before it eases back.
   */
  peerCorrect: 0.5,
  /**
   * [computed] The smooth pose held back by the picture's own mean lag behind the states' line (s): the glide's time
   * constant (0.1, `remotePlayers.ts`) plus most of half the tenth of a second between states, 0.143 s at 144 fps, 0.134 at
   * 60 and 0.118 at 30 (`dt(1 - k)/k + (0.1 - dt)/2`). The design took the time constant alone, and at 0.1 the pose stood
   * 0.043 m per m/s ahead of the picture at 144 fps and never crossed it; 0.14 runs it through the middle at the owner's rate.
   */
  peerLag: 0.14,
  /** A state of another player's vehicle landing further than this (m) from where the pose expected it is a teleport, and the rope lets go. */
  peerJump: 10,
  // --- the dart and the mark ---------------------------------------------------------------------------
  /** The dart's own speed (m/s). */
  speed: 150,
  /** 'true': aimed so that the dart carrying the shooter's velocity lands on the mark; 'fired': along the view, to compare. */
  aim: 'true' as 'true' | 'fired',
  /** How far past each frame's step the dart's ray looks. */
  lead: 0.3,
  minRange: 1.5,
  /** The camera ray's length past the range, so a point just past it is found and judged rather than missed. */
  probePad: 2,
  /** How far past the range a dart flies before it misses. */
  missPad: 2,
  /** The hand's kept path while the dart flies, in points. Build-only. */
  dartTrail: 256,
  /** A missed or recalled dart comes home over this long (s). */
  missReturn: 0.3,
  /** A lost mark is held this long (s), drawn at half alpha, and fired at. */
  snapHold: 0.25,
  // --- the look ----------------------------------------------------------------------------------------
  ropeWidth: 0.02,
  /** The ribbon never under this many pixels across. */
  minPx: 1.5,
  /** Inside this much slack the free span is drawn straight. */
  tautBand: 0.1,
  /** Pieces of the free span's sag. Build-only. */
  sagSegments: 24,
  ropeColour: 0x3a3229,
  ropeRoughness: 0.85,
  ropeMetalness: 0,
  /** The dart's length. Build-only. */
  dartSize: 0.12,
  /** The left arm up the rope: eased in over this long (s) as the hook goes out, and out over this long after. */
  armIn: 0.08,
  armOut: 0.15,
  /** The furthest behind straight up (degrees) the arm reaches; a rope further back is reached for along that line. */
  armReach: 45,
  /** The drawn body leans toward the rope by this share of the rope's angle from upright, turning about the rope point. */
  tilt: 0.7,
  /** The largest lean eases back to upright over this long (s) once the body is off the rope, or afloat; never in one frame. */
  leanOut: 0.3,
  /** Under this lean (degrees) the body is level. */
  leanLevel: 0.5,
  /**
   * The whole turn goes on going to other players this long (s) after the lean is level, so the last turn they hear is
   * upright and their own glide (a tenth of a second's time constant) has eased the figure upright before it stops:
   * a receiver built before stands a figure upright in one frame the moment `q` stops (§3.15).
   */
  leanTail: 0.5,
  /** The camera pulls back with speed: from 1 at `camFrom` (m/s) to `camScale` at `camTo`, eased over `camEase` (s), and back to 1 within `camBack` (s) of the feet finding ground. */
  camFrom: 10,
  camTo: 35,
  camScale: 1.3,
  camEase: 0.4,
  camBack: 1.5,
  /** A slack rope's catch past `joltFrom` (m/s) jolts the view by `joltPer` a m/s over it, at most `joltMax`, for `joltTime` (s). The first proposal's 4 and 0.02 carried to full gravity. */
  joltFrom: 5.2,
  joltPer: 0.015,
  joltMax: 0.3,
  joltTime: 0.15,
  // --- the danger --------------------------------------------------------------------------------------
  /** A swing into a wall faster than this (m/s, relative to what was struck) hurts; also where the fast flight after a let-go ends. The first proposal's 13 over the square root of 0.6. */
  slamFrom: 16.8,
  /** Health a m/s over `slamFrom`, rounded. The first proposal's 4 over the square root of 0.6. */
  slamPer: 3.1,
  slamMax: 60,
  /** Past this (m/s) a slam takes the whole of the health, which last stand may still leave a point of. */
  slamKill: 50,
  /** A slam hurts at most once in this long (s). */
  slamGap: 0.4,
  /** Past this (m/s) a slam staggers for `stagger` seconds: no sway, reel, haul or boost. The first proposal's 18 over the square root of 0.6. */
  staggerFrom: 23.2,
  stagger: 0.5,
  /** The stagger's shake at its start through the camera's own register, falling to nought over `shakeTime` (s); 0 turns it off. */
  shake: 0.4,
  shakeTime: 0.3,
  /** [owner: "a little bit of a screen effect"] The vignette's kick at the daze's peak, risen to over `dazeIn` (s) and falling as (1 − u)² to the stagger's end; 0 turns it off. */
  daze: 0.6,
  dazeIn: 0.05,
  // --- the sound ---------------------------------------------------------------------------------------
  /** The ratchet plays once for every this much rope (m) the held reel winds in or pays out, and never more than `tickMax` a second. */
  tickEvery: 0.5,
  tickMax: 12,
  /** The ratchet's pitch (semitones): up reeling in, down paying out. */
  reelPitch: 2,
  /** The haul's rumble fades out over this long (s) as F is let go. */
  haulFade: 0.15,
  /** The speed wind's gain, nothing under `windFrom` (m/s) and this at `windTo`; 0 is off until the owner has heard it. */
  windGain: 0,
  windFrom: 12,
  windTo: 35,
  // --- the mass rule (wave 3) --------------------------------------------------------------------------
  /** The heaviest thing the rope pulls to you (kg), read through the stat table's `tether.strength`. A loose prop weighs 20. */
  strength: 40,
  /** Up to this many times the player's own mass a thing is a tug-of-war (`both`), and past it the rope moves the player; nothing answers `both` this pass. */
  heavyRatio: 2,
  /** F on a hooked prop pulls it toward this far out along the view from the rope point (m). */
  yankAhead: 1,
  /** The yank stops once the prop is within `arriveReach` of the rope point, or after this long (s), and the rope lets go. */
  yankMost: 1.5,
  /** What the yank's end throws the prop along the view at (m/s), stopped first: nought, and it drops where it came to. */
  yankToss: 0,
  /** The rope to a prop lets go once its straight span has been blocked by something still this long (s). */
  tetherBlocked: 0.25,
  /** A prop dragged on the rope lets go this far short of where the pool would put it back on its stand (m). */
  tetherStandMargin: 5,
  // --- others and the item (wave 4) --------------------------------------------------------------------
  // This table holds 127 keys and must stay under 128: the engine makes an object literal of 128 or more with every key
  // out of the object, and the hook's frame then boxed what it read off it (4.2 B a frame where it made 0.09). The
  // watcher's own number is `PEER_ROPE_TUNE` in src/net/peerRope.ts for that reason; a new number goes in a table of
  // its own (remoteRopes.test.ts counts the keys).
  /** The points a rope sends to other players (when it is sent at all): at most the wire's sixteen, cut at the anchor's end. */
  sendPoints: 16,
  /** [owner: "for now"] Every character can fire, owning a rig or not; off, firing asks for the rig in the backpack. */
  everyone: true,
};

export type GrappleTune = typeof GRAPPLE_TUNE;

/** The table as it ships, for `__debug.grapple({ reset: true })`. */
export const GRAPPLE_DEFAULTS: Readonly<GrappleTune> = Object.freeze({ ...GRAPPLE_TUNE });

/** The wire's own cap on a rope's points (`ROPE_POINTS` in server/grappleWire.mjs, `WIRE.ropePoints`): fixed, never a run's. */
export const ROPE_WIRE_POINTS = 16;

/** The game's own gravity (Jedi Academy's 800 u/s², whatever the planet). */
export const GRAPPLE_GRAVITY = JKA.gravity * UNIT;

/** How far out from the capsule's middle a slam strikes: the player's capsule's radius (`player.ts`'s `CAPSULE_RADIUS`). */
const SLAM_REACH = 0.35;

/** A point (x, y, z) in another player's picture's own frame, where that picture is drawn, into `out` at `o` (wave 3c). */
function placeOn(pic: PeerPicture, x: number, y: number, z: number, out: Float64Array, o: number): void {
  const q = pic.quaternion;
  const p = pic.position;
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  out[o] = p.x + x + q.w * tx + (q.y * tz - q.z * ty);
  out[o + 1] = p.y + y + q.w * ty + (q.z * tx - q.x * tz);
  out[o + 2] = p.z + z + q.w * tz + (q.x * ty - q.y * tx);
}

/** What writes the rope's colour, roughness and metalness onto its one material (`grappleDraw.ts` registers it). */
let lookHook: (() => void) | null = null;
export function setGrappleLook(hook: () => void): void {
  lookHook = hook;
  hook();
}

/** Move any of the table's numbers at once, clamped, in place; the look goes onto the one material at once. */
export function tuneGrapple(o: Partial<Record<keyof GrappleTune, unknown>>): GrappleTune {
  const T = GRAPPLE_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (!Object.hasOwn(GRAPPLE_DEFAULTS, k)) continue;
    const was = T[k];
    if (typeof was === 'number' && typeof v === 'number' && Number.isFinite(v)) T[k] = v;
    else if (typeof was === 'boolean' && typeof v === 'boolean') T[k] = v;
    else if (k === 'aim' && (v === 'true' || v === 'fired')) T[k] = v;
    else if (k === 'peerPose' && (v === 'smooth' || v === 'picture')) T[k] = v;
  }
  const G = GRAPPLE_TUNE;
  G.range = Math.max(G.minRange + 0.1, G.range);
  G.minFree = Math.max(0.05, G.minFree);
  G.speed = Math.max(1, G.speed);
  G.chord = Math.max(0.01, G.chord);
  G.maxPieces = Math.max(1, Math.round(G.maxPieces));
  G.searchIters = Math.max(1, Math.round(G.searchIters));
  G.maxWrapsPerPiece = Math.max(1, Math.round(G.maxWrapsPerPiece));
  G.missReturn = Math.max(0.01, G.missReturn);
  G.sendPoints = Math.max(1, Math.min(ROPE_WIRE_POINTS, Math.round(G.sendPoints)));
  G.ropeColour = Math.max(0, Math.min(0xffffff, Math.round(G.ropeColour)));
  G.ropeRoughness = Math.max(0, Math.min(1, G.ropeRoughness));
  G.ropeMetalness = Math.max(0, Math.min(1, G.ropeMetalness));
  G.armIn = Math.max(0.001, G.armIn);
  G.armOut = Math.max(0.001, G.armOut);
  G.armReach = Math.max(0, Math.min(90, G.armReach));
  G.tilt = Math.max(0, Math.min(1, G.tilt));
  G.leanOut = Math.max(0.01, G.leanOut);
  G.leanLevel = Math.max(0, G.leanLevel);
  G.leanTail = Math.max(0, G.leanTail);
  G.camTo = Math.max(G.camFrom + 0.1, G.camTo);
  G.camEase = Math.max(0.001, G.camEase);
  G.camBack = Math.max(0.01, G.camBack);
  G.joltMax = Math.max(0, Math.min(1, G.joltMax));
  G.joltTime = Math.max(0, G.joltTime);
  G.slamFrom = Math.max(0, G.slamFrom);
  G.slamKill = Math.max(G.slamFrom, G.slamKill);
  G.slamMax = Math.max(0, G.slamMax);
  G.slamGap = Math.max(0, G.slamGap);
  G.stagger = Math.max(0, G.stagger);
  G.dazeIn = Math.max(0, Math.min(G.stagger, G.dazeIn));
  G.shake = Math.max(0, Math.min(1, G.shake));
  G.shakeTime = Math.max(0.001, G.shakeTime);
  G.daze = Math.max(0, Math.min(1, G.daze));
  G.tickEvery = Math.max(0.01, G.tickEvery);
  G.tickMax = Math.max(1, G.tickMax);
  G.haulFade = Math.max(0, G.haulFade);
  G.windGain = Math.max(0, Math.min(1, G.windGain));
  G.windTo = Math.max(G.windFrom + 0.1, G.windTo);
  G.strength = Math.max(0, G.strength);
  G.heavyRatio = Math.max(0, G.heavyRatio);
  G.yankAhead = Math.max(0, G.yankAhead);
  G.yankMost = Math.max(0, G.yankMost);
  G.yankToss = Math.max(0, G.yankToss);
  G.tetherBlocked = Math.max(0, G.tetherBlocked);
  G.tetherStandMargin = Math.max(0, G.tetherStandMargin);
  G.straightDeg = Math.max(0, Math.min(45, G.straightDeg));
  G.slipKeep = Math.max(0, G.slipKeep);
  G.slipDecel = Math.max(0, G.slipDecel);
  G.slipTurn = Math.max(1, G.slipTurn);
  G.slipReel = Math.max(0, G.slipReel);
  G.slipCorr = Math.max(0.001, G.slipCorr);
  G.towHold = Math.max(0, G.towHold);
  G.towFriction = Math.max(0, G.towFriction);
  G.towDamp = Math.max(0, G.towDamp);
  G.parkHold = Math.max(0, G.parkHold);
  G.parkRest = Math.max(0, G.parkRest);
  G.hullLag = Math.max(1e-4, G.hullLag);
  G.hullPush = Math.max(0, G.hullPush);
  G.peerCorrect = Math.max(0.001, G.peerCorrect);
  G.peerLag = Math.max(0, G.peerLag);
  G.peerJump = Math.max(0.1, G.peerJump);
  lookHook?.();
  return G;
}

/**
 * The hook's numbers that progression can change, each by the stat it is read through and the tune's key that is its
 * base (§3.16). Every read site hands the stat table the tune's own number, so the tune stays live and an empty record
 * hands back that very number. `grapple.swing` is a factor over the sway's push and cap, its base 1.
 */
export const GRAPPLE_STATS: Readonly<Record<'grapple.range' | 'grapple.reel' | 'grapple.yank' | 'tether.strength', keyof GrappleTune>> = Object.freeze({
  'grapple.range': 'range',
  'grapple.reel': 'reel',
  'grapple.yank': 'haul',
  'tether.strength': 'strength',
});

/** The base the hook hands the stat table for one of its stats, as the tune stands now (1 for the sway's factor); null for any other stat. */
export function grappleStatBase(id: string): number | null {
  if (id === 'grapple.swing') return 1;
  const key = (GRAPPLE_STATS as Record<string, keyof GrappleTune | undefined>)[id];
  if (!key) return null;
  const v = GRAPPLE_TUNE[key];
  return typeof v === 'number' ? v : null;
}

/** What the hook reads its stats through: the player's `PlayerStats`, whose `apply` hands back the very base while nothing grants. */
export interface GrappleStats {
  apply(id: StatId, base: number): number;
}

/** The stats of a body with no progress at all (the node harness's): every number the tune's own. */
const NO_STATS: GrappleStats = { apply: (_id: StatId, base: number): number => base };

/** The player's own mass as the rope weighs it against a thing: the character controller's (`setCharacterMass(80)`). */
export const GRAPPLE_PLAYER_MASS = 80;

/** The table back as it ships. */
export function resetGrappleTune(): GrappleTune {
  Object.assign(GRAPPLE_TUNE, GRAPPLE_DEFAULTS);
  lookHook?.();
  return GRAPPLE_TUNE;
}

/** Off; the dart in flight; the rope fastened to an anchor (`attached`); or fastened to a thing it moves, a loose prop (`holding`, wave 3). */
export type GrappleState = 'off' | 'flying' | 'attached' | 'holding';

/** Why the rope let go, the last time it did: the player's own, a new place, a world swapped, or the rope's. */
export type LetGoReason =
  | 'fire'
  | 'boost'
  | 'arrived'
  | 'reset'
  | 'stand'
  | 'death'
  | 'board'
  | 'leave'
  | 'mount'
  | 'noclip'
  | 'eva'
  | 'inside'
  | 'travel'
  | 'select'
  | 'placing'
  | 'lift'
  | 'doorless'
  | 'loose'
  | 'fouled'
  | 'moved'
  | 'world'
  | 'console'
  // A hooked prop (wave 3): the yank brought it in; the pool put it back on its stand; its span stayed blocked.
  | 'yanked'
  | 'recalled'
  | 'blocked'
  // A vehicle (wave 3): a hull ran the rope out past its range; the hull the anchor is on was refitted; its wing started to swing.
  | 'ranOut'
  | 'refit'
  | 'wing';

/**
 * The ways out that put the body somewhere new, give it to something else or take it out of the world (§3.10): they end
 * the fast flight after a let-go and stand down the stagger, the jolt, the lean, the arm and the camera's pull at once,
 * whether or not a rope was out. Every other let-go is the body flying on from where it was.
 */
function endsFlight(reason: LetGoReason): boolean {
  switch (reason) {
    case 'reset':
    case 'stand':
    case 'death':
    case 'board':
    case 'leave':
    case 'mount':
    case 'noclip':
    case 'eva':
    case 'travel':
    case 'select':
    case 'lift':
    case 'doorless':
    case 'world':
    case 'moved':
      return true;
    default:
      return false;
  }
}

/** What a contact the slam rule judged was: a swing's on the rope, the flight's after a let-go, the haul's own push, a floor's, the console's. */
export type SlamKind = '' | 'swing' | 'released' | 'haul' | 'floor' | 'console';

/**
 * The player as the hook needs it: a small view, so the node harness's body and the game's player answer
 * the same calls. `pos` and `vel` are written in place; the rest is read.
 */
export interface GrappleBody {
  readonly pos: { x: number; y: number; z: number };
  readonly vel: { x: number; y: number; z: number };
  /** The character controller's verdict on the last move. */
  readonly grounded: boolean;
  /** The swim ran this frame. */
  readonly swimming: boolean;
  /** How deep the feet are under the drawn water here (negative out of it). */
  readonly depth: number;
  readonly inside: boolean;
  readonly physics: Physics;
  readonly body: RAPIER_NS.RigidBody;
  readonly collider: RAPIER_NS.Collider;
  readonly controller: RAPIER_NS.KinematicCharacterController;
  /** The capsule collider's height over the feet, as the crouch last wrote it. */
  readonly colliderOffsetY: number;
  /** The collision groups the player's own queries pass (indoors leaves out the ground and the shells). */
  readonly filter: number;
  /** The movement: the fall's memory held, and whether a roll or a special move is writing the velocity of its own. */
  readonly jka: { holdApex(y: number): void; readonly rolling: boolean; readonly inSpecialJump: boolean };
  /** Health now: a slam past `slamKill` takes the whole of it. */
  readonly hp: number;
  /** A loss of health of a kind, as `Player.takeDamage` takes one; false when it was refused (god mode). */
  takeDamage(amount: number, force: boolean, kind: HarmKind): boolean;
  /** The vehicles this browser simulates (`World.vehicles`): what the rope and the dart may meet that moves (wave 3). */
  readonly vehicles: readonly Vehicle[];
  /** The hull test's own character controller (wave 3): the player's offset and slopes, no autostep, no snap. */
  readonly hullController: RAPIER_NS.KinematicCharacterController | null;
  /** The terrain's own height under the body, as the frame already reads it for its floor: a towed body's floor outdoors (wave 3). */
  readonly ground: number;
  /** Other players' vehicles as their boxes and what the relay said of them (`RemoteBodies.hullBoxes()`, wave 3c); null with none. */
  readonly peerHulls?: PeerHulls | null;
}

/** The held keys the hook reads, written by the key block (or the harness) and read by the frame's steps. */
export interface GrappleKeys {
  reelIn: boolean;
  reelOut: boolean;
  haul: boolean;
  /** The move keys' direction on the ground's plane (unit, or nought with none held): the sway. */
  swayX: number;
  swayZ: number;
}

/** The input as the key block reads it: the game's own `Input` answers it, and so does the harness's. */
export interface GrappleKeyInput {
  muteUntilUp(actions: readonly string[]): void;
  mute(actions: readonly string[]): void;
  pressedAction(action: string): boolean;
  held(action: string): boolean;
}

/** Everything that refuses a shot (the design's §3.8), filled by whoever asks. */
export interface GrappleFireState {
  mounted: boolean;
  piloting: boolean;
  noclip: boolean;
  eva: boolean;
  aboard: boolean;
  riding: boolean;
  jump: boolean;
  dead: boolean;
  placing: boolean;
  talking: boolean;
  prone: boolean;
  kneeling: boolean;
  rolling: boolean;
  special: boolean;
  swgProfile: boolean;
  /** The world has stepped since the last reset, so a query can be trusted. */
  stepped: boolean;
  /** The character owns a grapple rig (wave 4): asked only while `everyone` is off. */
  rig: boolean;
}

export function newFireState(): GrappleFireState {
  return { mounted: false, piloting: false, noclip: false, eva: false, aboard: false, riding: false, jump: false, dead: false, placing: false, talking: false, prone: false, kneeling: false, rolling: false, special: false, swgProfile: false, stepped: true, rig: true };
}

/** What a shot refused for want of a rig says, once a press, on the message line: the one refusal said in words. */
export const NO_RIG_WORDS = 'You carry no grapple rig.';

/** Where the dart would bite, worked out each frame after the camera, and kept. */
export interface GrappleMark {
  /** A press fires: the point holds the dart and is in range, or a lost one is still held. */
  shows: boolean;
  /** Shown from the snap hold (half alpha). */
  held: boolean;
  /** Shown while attached: where a release and a fresh fire would bite (muted). */
  next: boolean;
  /** What is under it, and how far it is from the hand. */
  kind: MarkKind;
  distance: number;
  /** The point, and the surface's normal there. */
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  collider: Collider | null;
  /** Seconds the snap hold has left. */
  holdLeft: number;
  /** Seconds the refused press's flash has left. */
  flash: number;
  /**
   * The vehicle under the mark (wave 3), or null: the point is then kept in its hull's own frame (`lx`, `ly`, `lz`), so
   * the next frame's dart aims at it wherever the hull has gone and the diamond is drawn on the drawn hull, and the
   * hull's point velocity there (`tvx`, `tvy`, `tvz`) is what the dart is aimed true against (the intercept).
   */
  vehicle: Vehicle | null;
  /** Another player's vehicle under the mark (wave 3c): their relay id and the picture, the point kept in its own frame as a hull's is; 0 and null otherwise. */
  peer: number;
  peerObj: PeerPicture | null;
  lx: number;
  ly: number;
  lz: number;
  tvx: number;
  tvy: number;
  tvz: number;
}

/**
 * Whether a point is under the drawn water or a lava flow: the world's own test, handed in so this file imports
 * nothing of the world. The point comes as a kept object the test reads and never keeps.
 */
export type WaterTest = (p: { readonly x: number; readonly y: number; readonly z: number }) => boolean;

/**
 * What the mark's probe reads, written in place by whoever asks before each `probeMark`: the camera's place and
 * its unit look, how far out along it the orbit stands (nothing between the camera and the body counts), the rope
 * point (a kept object the caller owns), the collision groups the player's queries pass and the body they never meet.
 */
export interface MarkView {
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  orbit: number;
  hand: { x: number; y: number; z: number };
  filter: number;
  exclude: RAPIER_NS.RigidBody | null;
  /** The vehicles this browser simulates, each cast in its own frame (wave 3); empty for none. */
  vehicles: readonly Vehicle[];
  /** Other players' vehicles, each cast as its box (wave 3c); null for none. */
  peers: PeerHulls | null;
}

/** No vehicles: the mark's view before the game hands it the world's. */
const NO_VEHICLES: readonly Vehicle[] = Object.freeze([]);

/** How many frames of the rope's own cost are kept for the console's median and p99. */
const COST_FRAMES = 600;


export class Grapple {
  private readonly R: R;
  state: GrappleState = 'off';
  readonly rope: GrappleRope;
  readonly con = new RopeConstraint();
  readonly modes: RopeModes = newRopeModes();
  readonly keys: GrappleKeys = { reelIn: false, reelOut: false, haul: false, swayX: 0, swayZ: 0 };
  readonly mark: GrappleMark = { shows: false, held: false, next: false, kind: 'none', distance: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, collider: null, holdLeft: 0, flash: 0, vehicle: null, peer: 0, peerObj: null, lx: 0, ly: 0, lz: 0, tvx: 0, tvy: 0, tvz: 0 };
  /** What the next `probeMark` reads, written by the caller (numbers in fields, never handed to the call). */
  readonly view: MarkView = { eyeX: 0.5, eyeY: 0.5, eyeZ: 0.5, dirX: 0.5, dirY: 0.5, dirZ: 0.5, orbit: 0.5, hand: { x: 0, y: 0, z: 0 }, filter: 0, exclude: null, vehicles: NO_VEHICLES, peers: null };
  /** The slide latch (§3.3): set while hanging, cleared on the ground by slack or slowness and by every let-go. */
  latch = false;
  /** The position correction the constraint asked for this frame, added to the move. */
  readonly corr = { x: 0, y: 0, z: 0 };
  /** Seconds since the rope last bore load. */
  sincePull = Infinity;
  /** The speed into what the controller refused, this frame and the most since it was cleared, relative to what was touched. */
  lastImpact = 0;
  maxImpact = 0;
  /** This frame's largest contact was made by the haul's own push (measured, never a blow). */
  lastImpactHaul = false;
  /** A let-go owes the key block its `muteUntilUp` (made inside the player's update, applied the next frame). */
  muteOwed = false;
  /** What that owed mute takes: every let-go's three, or a loose prop's torch alone (its jump and walk were the player's). */
  private owedMutes: readonly string[] = GRAPPLE_RELEASE_MUTES;
  lastLetGo: LetGoReason | '' = '';
  /** One-shot words for the message line: the game hangs the line here. */
  say: ((text: string) => void) | null = null;
  /**
   * The loose prop a dynamic collider belongs to, for the mark's word and the dart's hook (the game hangs the pool's
   * own `hookablePropAt` here, so this file takes nothing of the world but the prop's type); undefined for anything
   * else, and once the pool has gone with its world.
   */
  propAt: ((handle: number) => HookableProp | undefined) | null = null;
  /** What the hook reads its range, reel, haul, sway and strength through: the player's stats (the game hangs them here). */
  stats: GrappleStats = NO_STATS;
  /**
   * The vehicle a collider belongs to (the game hangs `vehicleOfCollider` here, so this file takes nothing of the vehicles
   * but their type, and node loads it with none); null with none hung, and every hull is then a moving thing it refuses.
   */
  vehicleOf: ((handle: number) => Vehicle | null) | null = null;
  /**
   * Whether the player with this relay id could hurt this one just now (the game hangs `CombatNet.mayHurt` here: the
   * server's friendly fire, or a duel between them). A slam that came of their vehicle -- on a rope riding it, or in the
   * fast flight after one -- harms only where this says yes (§3.11); with none hung, nowhere, which is the game with no
   * server. The stagger, its shake and its daze play either way.
   */
  mayHurtPeer: ((id: number) => boolean) | null = null;
  /** Whose vehicle the rope let go of rode, for the fast flight after it (0 for none): what its slam answers to. */
  private releasedPeer = 0;

  // Vehicles on the rope (wave 3, §3.18).
  /** The hulls the rope rides and is cast against this frame: the rope's own `frames`. */
  readonly hulls: HullFrames;
  /** The rope touches a hull: some point of it rides one (the slip, the pull and the tow are its alone). */
  onHull = false;
  /** The pivot where it stands at the frame's start and its velocity over the frame (nought on anything still). */
  private readonly piv0 = { x: 0, y: 0, z: 0 };
  readonly pivV = { x: 0, y: 0, z: 0 };
  /** What is left of the catch the rope takes whole (m/s), refilled while it does not pull. */
  private catchLeft = 12;
  /** The turn slipped this frame: the carry is skipped and the rope pays out to where the hand went. */
  private slippingTurn = false;
  /** The tow (§3.18): the rope on a hull pulled within `towHold`, so it counts as taut for the slide and the tow's friction applies. */
  towed = false;
  /** The slip's and the pull's tallies, this second as it runs and the last whole second, for the console. */
  readonly slipNow = { paid: 0, catches: 0, turns: 0, reels: 0, impulse: 0, hits: 0, pushed: 0, contacts: 0, calls: 0, contactTests: 0, reads: 0 };
  readonly slipLast = { paid: 0, catches: 0, turns: 0, reels: 0, impulse: 0, hits: 0, pushed: 0, contacts: 0, calls: 0, contactTests: 0, reads: 0 };
  /** All the rope ever paid out to a hull (m), since it was fastened. */
  paidOut = 0;
  private secondLeft = 1;
  /** The box the free span and the dart may sweep this frame (min, then max, three numbers each): what makes a hull near. */
  private readonly nearBox = new Float64Array(2 * 3);
  /** A dart's hit on a hull, the mark's on one, and a hull pull's numbers handed over in kept records. */
  private readonly hullHit = newHullHit();
  private readonly markHit = newHullHit();
  private readonly pullJ = { x: 0, y: 0, z: 0 };
  private readonly pullAt = { x: 0, y: 0, z: 0 };
  private readonly parked = { x: 0, z: 0, budget: 0, held: 0 };
  /**
   * Numbers handed to the hull's rules and back (`grappleMath`'s `…In` forms), and the length `payOut` pays: kept, since a
   * number handed to a call the compiler did not build in, or handed back by one, is a fresh number.
   */
  private readonly nums = new Float64Array(5);
  private readonly segA = new Float64Array(3);
  private readonly segB = new Float64Array(3);
  private readonly segO = new Float64Array(3);
  private readonly segD = new Float64Array(3);
  /** The capsule's middle at the frame's start, for the hull test. */
  private readonly capStart = new Float64Array(3);
  /** The rope pulled a hull this frame: its first pull latched its brake. */
  private pulledHull = false;
  /** The rope's tension this frame (N·s), handed to `pullHulls` in a field. */
  private pullJ0 = 0;

  // A hooked prop (wave 3, §3.14).
  /** The prop the rope holds while `holding`, its collider's handle, and its recall count at the hook. */
  thing: HookableProp | null = null;
  private thingHandle = -1;
  private thingRecalls = 0;
  /** Where on it the rope is fastened, and the face's normal there, in its own frame. */
  private readonly thingLocal = { x: 0, y: 0, z: 0 };
  private readonly thingNormal = { x: 0, y: 1, z: 0 };
  /** F held on it: the yank under way, and how long it has run. */
  yanking = false;
  private yankTime = 0;
  /** How long the straight span has been blocked by something still. */
  thingBlocked = 0;
  /** The prop's middle from the rope point, metres, as last measured (kept after a let-go, for the console). */
  thingDist = 0;
  /** The rope point where the last frame left it, for the guard against a place written without a reset. */
  private readonly thingHand = { x: 0, y: 0, z: 0 };
  /** A point handed to the prop's `holdAt`, a direction to its `release`, and a point turned onto it: kept, written in place. */
  private readonly thingTo = { x: 0, y: 0, z: 0 };
  private readonly thingDir = { x: 0, y: 0, z: 0 };
  private readonly thingAt = { x: 0, y: 0, z: 0 };

  // The dart.
  readonly dart = new Float64Array(3);
  readonly dartVel = new Float64Array(3);
  readonly launch = new Float64Array(3);
  readonly trail: Float64Array;
  trailCount = 0;
  returning = false;
  private returnT = 0;
  private readonly returnFrom = new Float64Array(3);
  private dartPhysics: Physics | null = null;
  private dartFilter = 0;
  private dartExclude: RAPIER_NS.RigidBody | null = null;
  /** The physics world the anchor was made in: never asked while the player's is another, or broken. */
  private anchorPhysics: Physics | null = null;
  /** The anchor's face is walkable: the haul arrives standing on it. */
  anchorWalkable = false;

  // The frame's own records.
  private readonly hand0 = { x: 0, y: 0, z: 0 };
  private readonly hand1 = { x: 0, y: 0, z: 0 };
  private readonly piv = { x: 0, y: 0, z: 0 };
  private speedBefore = 0;
  private corrLen = 0;
  /** The hand's distance from its pivot this frame, handed to the haul in a field (an argument would be a fresh number). */
  private haulDist = 0.5;
  hauling = false;
  private haulEnded = false;
  /** What the haul's last step falls short of its speed by, taken off this frame's move (nought on every other frame). */
  private readonly haulCut = { x: 0, y: 0, z: 0 };
  lipping = false;
  private lipTime = 0;
  private lipBend = 0;
  private lipY = 0;
  private lipToX = 0;
  private lipToZ = 0;
  private lipGaveUp = false;
  private wallTouch = false;
  private readonly wallN = { x: 0, y: 0, z: 0 };
  private swimLiftWas = false;
  /** The rope had the swim's vertical this frame, and the wading drag's rate (for the console). */
  swimLiftNow = false;
  wadeRateNow = 0;

  // The danger (§3.11).
  /**
   * The fast flight after a let-go: set by a let-go from the rope faster than `slamFrom`, and ended when the body is
   * slower than that, a new hook is fired, it swims, a roll or a special move begins, or it is put somewhere new.
   * While it holds the player's update runs the collider sync, the clip and the slam exactly as on the rope, and
   * nothing else of the hook; a player who never fires is never released.
   */
  released = false;
  /** The speed the flight began at, for the console. */
  releasedSpeed = 0;
  /** The body's velocity, kept from the last step that met it, for the speed a let-go is made at. */
  private bodyVel: { x: number; y: number; z: number } | null = null;
  /** The last contact the slam rule judged past `slamFrom`, a slam or not, and where the last slam struck. */
  readonly lastSlam = { speed: 0, harm: 0, at: Number.NEGATIVE_INFINITY, kind: '' as SlamKind, took: false, x: 0, y: 0, z: 0, peer: 0, spared: false };
  /** Seconds since the last slam that cost or staggered: a slam hurts at most once in `slamGap`. */
  sinceSlam = Number.POSITIVE_INFINITY;
  /** Seconds into the stagger, or Infinity with none: the stagger, its shake and its daze all read it. */
  staggerAge = Number.POSITIVE_INFINITY;
  /** The stagger's shake and daze this frame, which the game writes into the camera's register and the vignette. */
  shakeNow = 0;
  dazeNow = 0;
  /** The catch's jolt for the camera, the seconds it has left, and the last catch's speed (m/s). */
  joltNow = 0;
  joltLeft = 0;
  lastCatch = 0;
  /** The catch being summed over its two frames, and which of them this is (0 with no catch under way). */
  private catchRun = 0.5;
  private catchStep = 0;
  /** The hook's own clock (s), stepped by `look`: when a slam was, and the ratchets a second. */
  clock = 0;
  /** The contact the frame's clip found hardest into a wall, and its normal (the slam's point is taken from it). */
  private readonly slamN = { x: 0, y: 0, z: 0 };

  // The look (§3.12): the lean, the arm, the camera's pull, all eased in `look`.
  /** The drawn body's lean toward the rope, a turn in the world's frame about the rope point; the identity when upright. */
  readonly lean: LeanQuat = { x: 0, y: 0, z: 0, w: 1 };
  private readonly leanTarget: LeanQuat = { x: 0, y: 0, z: 0, w: 1 };
  /** The rope's way handed to the lean, and the lean's step and what it left: kept, so the frame's calls take no fresh numbers. */
  private readonly lookDir = { x: 0, y: 1, z: 0 };
  private readonly leanStep: LeanStep = { step: 0.5, left: 0.5 };
  /** How far the lean turns the body from upright now, radians. */
  leanAngle = 0;
  /** Seconds the whole turn still goes to other players since the lean came level (`leanTail`); nought once it has run out. */
  leanTailLeft = 0;
  /** How much of the left arm's pose is the aim up the rope (0 to 1), eased in and out. */
  armWeight = 0;
  /** The way from the rope point to the rope's first point (the dart while it flies), a unit vector in the world. */
  readonly armDir = { x: 0, y: 1, z: 0 };
  /** The camera's orbit scale this frame: the literal 1 whenever the rope is not out and the eased tail has finished. */
  camScaleNow = 1;
  /** Off the ground since the rope was out: the camera's pull eases with the speed until the feet find ground. */
  private camAirborne = false;

  // The sound (§3.13): the ratchet's count is the held reel's alone.
  /** Rope reeled by the held reel since the last ratchet (m), and seconds since it. */
  private reelRun = 0;
  private sinceTick = Number.POSITIVE_INFINITY;
  /** The last ratchet was reeling in (pitched up) rather than paying out. */
  ratchetIn = true;

  // Kept answers and rays.
  private readonly kept: RAPIER_NS.CharacterCollision;
  private readonly ray: RAPIER_NS.Ray;
  private readonly markRay: RAPIER_NS.Ray;
  private readonly t1 = { x: 0, y: 0, z: 0 };
  private readonly t2 = { x: 0, y: 0, z: 0 };
  /** The free span's direction from the pivot to the hand, its length and the step, handed to `sway` (rx, ry, rz, dist, dt). */
  private readonly swayIn = new Float64Array(5);
  /** The sway's direction `sway` worked out this frame, nought when there is none: what the wall friction spares. */
  private readonly swayDir = { x: 0, y: 0, z: 0 };
  /** A still pivot's velocity, for the sway measured against it. */
  private readonly stillV = { x: 0, y: 0, z: 0 };
  private readonly sv = { x: 0, y: 0, z: 0 };
  private readonly n1 = { x: 0, y: 0, z: 0 };
  private readonly aimOut = { x: 0, y: 0, z: 0 };
  private readonly hit = { toi: 0, nx: 0, ny: 0, nz: 0, collider: null as Collider | null };
  /** A segment the probe casts (a, then b, then how far past b), and the next cast's reach, filter and excluded body, kept. */
  private readonly sg = new Float64Array(7);
  private castLen = 0.5;
  /** The mark's distance and the range, handed to its range test in a record (a number handed to a call is a fresh one). */
  private readonly markReach: MarkReach = { dist: 0.5, range: 0.5 };
  private castFilter = 0;
  private castExclude: RAPIER_NS.RigidBody | null = null;
  private passPhysics: Physics | null = null;
  /**
   * What the dart's ray and the mark's pass over in the world's cast: a corpse, a follower, another player, and from wave 3
   * any vehicle's hull (each is cast in its own frame instead, where the world's cast would meet it a physics step stale).
   * A hull the rope marked walk-through is a hull, not a follower. Kept, not made per call.
   */
  private readonly dartPass = (c: Collider): boolean => {
    const p = this.passPhysics;
    if (!p) return true;
    const h = c.handle;
    if (p.isRagdoll(h) || p.isPeer(h)) return false;
    if (this.seenInFrame(h)) return false;
    return !p.isWalkThrough(h) || !!this.vehicleOf?.(h);
  };

  /** The rope's own work, microseconds a frame, the last `COST_FRAMES` of them. */
  private readonly cost = new Float64Array(COST_FRAMES);
  private costAt = 0;
  private costN = 0;
  private costNow = 0;
  /**
   * Whether the rope's own work is timed. Off until the console first asks (`__debug.grapple()`): every clock read
   * hands back a fresh number, and the hook's frame allocates nothing it does not have to.
   */
  timing = false;
  /** What the hook has done, counted: the game plays a sound for each fire, bite, ratchet, boost and slam as its count moves. */
  readonly counts = { fires: 0, bites: 0, misses: 0, recalls: 0, refused: 0, casts: 0, ratchets: 0, boosts: 0, slams: 0 };

  constructor(Rapier: R, physics: Physics) {
    this.R = Rapier;
    this.rope = new GrappleRope(Rapier, physics.world, 0, null, GRAPPLE_TUNE);
    this.hulls = new HullFrames(Rapier, GRAPPLE_TUNE);
    this.rope.frames = this.hulls.slots;
    this.trail = new Float64Array(3 * Math.max(4, Math.round(GRAPPLE_TUNE.dartTrail)));
    this.kept = new Rapier.CharacterCollision();
    this.ray = new Rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    this.markRay = new Rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  }

  /** The dart flies or the rope is attached. */
  get out(): boolean {
    return this.state !== 'off';
  }

  get attached(): boolean {
    return this.state === 'attached';
  }

  get flying(): boolean {
    return this.state === 'flying';
  }

  /** The rope holds a thing it moves (a loose prop): nothing of it touches the body. */
  get holding(): boolean {
    return this.state === 'holding';
  }

  /** What the rope holds: an anchor that stands still, a thing it moves, or nothing. */
  get holds(): 'anchor' | 'thing' | '' {
    return this.state === 'attached' ? 'anchor' : this.state === 'holding' ? 'thing' : '';
  }

  /** The dart's reach and the rope's longest length, as progress makes it: the tune's own number while nothing grants it. */
  get range(): number {
    return this.stats.apply('grapple.range', GRAPPLE_TUNE.range);
  }

  /** Who the rope would move for a thing of this mass (the mass rule), at the tether's strength as progress makes it. */
  whoMovesFor(mass: number): WhoMoves {
    return whoMoves(false, mass, this.stats.apply('tether.strength', GRAPPLE_TUNE.strength), GRAPPLE_PLAYER_MASS, GRAPPLE_TUNE);
  }

  /** The rope is taut: at its length within `tautEps`, or it bore load this frame. */
  get taut(): boolean {
    return this.attached && this.con.taut;
  }

  /** A slam's stagger is running: no sway, reel, haul or boost. */
  get staggered(): boolean {
    return this.staggerAge < GRAPPLE_TUNE.stagger;
  }

  /** The drawn body leans at all: the player's `placeVisual` turns it about the rope point. */
  get leaning(): boolean {
    return this.leanAngle > 0;
  }

  /**
   * The figure's whole turn goes to other players: while the lean is past `leanLevel`, and for `leanTail` after it came
   * level, so the last turn they hear is upright and their glide has brought the figure upright with it (§3.15). Sent
   * only until the lean was level, the last turn a receiver heard leaned by up to the lean's step between two states
   * (about 21 degrees at ten a second), which a receiver built before stood upright in one frame.
   */
  get leanSends(): boolean {
    return this.leanAngle > (GRAPPLE_TUNE.leanLevel * Math.PI) / 180 || this.leanTailLeft > 0;
  }

  /**
   * Anything of the hook still to step this frame (`look`): the rope out, the flight after a let-go, a stagger, a
   * jolt, a lean or its tail on the wire, the arm or the camera's pull not yet eased away, or a slam's gap still
   * running (its clock is `look`'s, so a slam that left nothing else to ease would hold the gap shut for good). False,
   * and the player's update runs nothing of it, for a player who never fires.
   */
  get lively(): boolean {
    return (
      this.state !== 'off' ||
      this.released ||
      this.staggerAge !== Number.POSITIVE_INFINITY ||
      this.joltLeft > 0 ||
      this.armWeight > 0 ||
      this.leanAngle > 0 ||
      this.leanTailLeft > 0 ||
      this.sinceSlam < GRAPPLE_TUNE.slamGap ||
      this.camScaleNow !== 1 ||
      this.camAirborne
    );
  }

  /** The free span's slack: the free length less the hand's distance to the pivot (to a hooked prop, its whole length less it). */
  slack(b: GrappleBody): number {
    if (!this.attached && !this.holding) return 0;
    this.pivot(this.piv);
    const T = GRAPPLE_TUNE;
    return this.rope.free() - len3(b.pos.x - this.piv.x, b.pos.y + T.ropeY - this.piv.y, b.pos.z - this.piv.z);
  }

  /**
   * Whether the free span is no slacker than `latchSlack`: `slack`'s test, answered as a yes or no, because the words are
   * worked out every frame the rope is out and a number handed back by a call not built in is a fresh number (a slack rope
   * dragged behind another player's vehicle made one a frame through `slack`).
   */
  private slackWithin(b: GrappleBody): boolean {
    this.pivot(this.piv);
    const T = GRAPPLE_TUNE;
    const dx = b.pos.x - this.piv.x;
    const dy = b.pos.y + T.ropeY - this.piv.y;
    const dz = b.pos.z - this.piv.z;
    return this.rope.free() - Math.sqrt(dx * dx + dy * dy + dz * dz) <= T.latchSlack;
  }

  /** The rope's first point from the hand: the nearest bend, else the anchor. */
  pivot(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return this.rope.pointAt(this.rope.n, out);
  }

  /** The words of the rope from the body as it stands: once a frame before the movement, and by the key block. */
  refreshModes(b: GrappleBody): RopeModes {
    this.bodyVel = b.vel;
    // A tow's rope is pulled and slack by turns from frame to frame: while it pulled within `towHold` it is held for the slide.
    const held = this.attached && (this.towed || (!this.con.taut && this.slackWithin(b)));
    ropeModes(this.attached, b.grounded, b.swimming, this.con.taut, held, this.latch, len2(b.vel.x, b.vel.z), GRAPPLE_TUNE, this.modes);
    this.latch = this.modes.latch;
    return this.modes;
  }

  /**
   * The movement's command on the rope (§3.1, 1), rewritten here and nowhere else, so the player's update and the
   * node harness hand the movement the very same thing: swinging, the move keys sway and Space boosts (the hook's
   * own), so the movement is handed neither the keys nor the jump, nor the Force jump's hold, a wall move or a
   * flip; sliding on the ground with the rope taut, it is handed no ground (no friction). Answers the grounded to
   * hand `jka.step`. While the rope is not attached nothing is written and the answer is the grounded handed in.
   */
  command(c: { fmove: number; smove: number; jump: boolean; jumpPressed: boolean }, grounded: boolean): boolean {
    if (this.state !== 'attached') return grounded;
    const m = this.modes;
    if (m.swinging) {
      c.fmove = 0;
      c.smove = 0;
      c.jump = false;
      c.jumpPressed = false;
    }
    return m.sliding ? false : grounded;
  }

  /** What the action bar says of the hook: nothing while it is not out, `flying`, attached `air` (swinging) and `ground`, or `light` on a prop. */
  promptWord(): '' | 'flying' | 'ground' | 'air' | 'light' {
    if (this.state === 'off') return '';
    if (this.state === 'flying') return 'flying';
    if (this.state === 'holding') return 'light';
    return this.modes.swinging ? 'air' : 'ground';
  }

  /** Why a shot would be refused just now, or '' when it would be fired (with the mark showing). */
  refusal(s: GrappleFireState): string {
    // Owning one matters only once `everyone` is off (the owner's "for now"): every character fires until then.
    if (!GRAPPLE_TUNE.everyone && !s.rig) return 'no rig';
    if (s.mounted) return 'mounted';
    if (s.piloting) return 'piloting';
    if (s.noclip) return 'noclip';
    if (s.eva) return 'adrift';
    if (s.aboard) return 'aboard';
    if (s.riding) return 'riding';
    if (s.jump) return 'jump';
    if (s.dead) return 'dead';
    if (s.placing) return 'placing';
    if (s.talking) return 'talking';
    if (s.prone) return 'prone';
    if (s.kneeling) return 'kneeling';
    if (s.rolling) return 'rolling';
    if (s.special) return 'special';
    if (s.swgProfile) return 'swg profile';
    if (!s.stepped) return 'not stepped';
    return '';
  }

  /** A press with nothing to fire at: the diamond flashes `bad` for this long, and nothing is said. */
  flashBad(seconds: number): void {
    this.mark.flash = seconds;
    this.counts.refused++;
  }

  /**
   * The mark stood down whole: on a frame it is not worked out (mounted, aboard, adrift, a shuttle's passenger, a
   * ship's view), nothing of it may stay to be drawn, and its clocks (the refused press's flash, the snap hold) only
   * ever run down inside the probe, so they go to nought here or a flash would stand at the crosshair until the
   * player was next on foot.
   */
  markOff(): void {
    const mk = this.mark;
    mk.shows = false;
    mk.held = false;
    mk.next = false;
    mk.kind = 'none';
    mk.distance = 0;
    mk.flash = 0;
    mk.holdLeft = 0;
    mk.collider = null;
    if (mk.vehicle || mk.peer) this.markOffHull();
    this.forgetHullHits();
  }

  /**
   * Fire the dart at a point the mark found: aimed so that, carrying the shooter's velocity, it flies the
   * straight segment from the hand to the point (or along the view, when no such aim exists or the console
   * asks). It flies at `speed`, straight, and bites what it first meets that may hold it. On a moving hull (wave 3)
   * `target` is the hull's point velocity there, and the aim is true in the hull's frame: the same arithmetic with the
   * shooter's velocity less the hull's, which aims where the point will be if the hull keeps its velocity.
   */
  fire(
    atX: number,
    atY: number,
    atZ: number,
    hand: { x: number; y: number; z: number },
    vel: { x: number; y: number; z: number },
    physics: Physics,
    filter: number,
    exclude: RAPIER_NS.RigidBody | null,
    viewX: number,
    viewY: number,
    viewZ: number,
    target: { readonly x: number; readonly y: number; readonly z: number } | null = null,
  ): void {
    const T = GRAPPLE_TUNE;
    let ex = atX - hand.x;
    let ey = atY - hand.y;
    let ez = atZ - hand.z;
    const el = len3(ex, ey, ez) || 1;
    ex /= el;
    ey /= el;
    ez /= el;
    const rvx = target ? vel.x - target.x : vel.x;
    const rvy = target ? vel.y - target.y : vel.y;
    const rvz = target ? vel.z - target.z : vel.z;
    const k = T.aim === 'true' ? aimTrue(ex, ey, ez, rvx, rvy, rvz, T.speed, this.aimOut) : 0;
    if (k > 0) {
      this.dartVel[0] = T.speed * this.aimOut.x + vel.x;
      this.dartVel[1] = T.speed * this.aimOut.y + vel.y;
      this.dartVel[2] = T.speed * this.aimOut.z + vel.z;
    } else {
      // As fired: along the view from the hand, carrying the shooter's velocity.
      this.dartVel[0] = T.speed * viewX + vel.x;
      this.dartVel[1] = T.speed * viewY + vel.y;
      this.dartVel[2] = T.speed * viewZ + vel.z;
    }
    this.launch[0] = this.dart[0] = hand.x;
    this.launch[1] = this.dart[1] = hand.y;
    this.launch[2] = this.dart[2] = hand.z;
    this.trail[0] = hand.x;
    this.trail[1] = hand.y;
    this.trail[2] = hand.z;
    this.trailCount = 1;
    this.dartPhysics = physics;
    this.dartFilter = filter;
    this.dartExclude = exclude;
    this.returning = false;
    this.state = 'flying';
    // A new hook ends the fast flight of the last one: what it meets now is the new rope's business.
    this.released = false;
    this.counts.fires++;
  }

  /**
   * Fasten the rope at a point at once, with no flight: the console's and the node tests' way to stand a rope
   * where they want it (the prototype's own `hook`). The hand end starts where the hand is; `length` (else the
   * reach) is what it lands at, never more than the range.
   */
  attachNow(b: GrappleBody, x: number, y: number, z: number, nx: number, ny: number, nz: number, collider: Collider | null, length = -1): void {
    if (this.out) this.letGo('console');
    this.muteOwed = false;
    const T = GRAPPLE_TUNE;
    this.launch[0] = b.pos.x;
    this.launch[1] = b.pos.y + T.ropeY;
    this.launch[2] = b.pos.z;
    this.trailCount = 1;
    this.trail[0] = this.launch[0];
    this.trail[1] = this.launch[1];
    this.trail[2] = this.launch[2];
    this.dartFilter = b.filter;
    this.dartExclude = b.body;
    this.state = 'flying';
    // A new hook, as a fire is: the fast flight of the last one ends here.
    this.released = false;
    this.bite(b, x, y, z, nx, ny, nz, collider, b.physics);
    if (length > 0 && this.attached) this.rope.length = Math.min(this.range, length);
  }

  /**
   * Fasten the rope on a vehicle's hull at once (wave 3; the console's and the tests'): the point (x, y, z) and its
   * normal are given in the world against the hull's body where the physics has it now, and kept in the hull's own
   * frame from there. False when the hull is gone or no frame is free.
   */
  attachHull(b: GrappleBody, v: Vehicle, x: number, y: number, z: number, nx: number, ny: number, nz: number, collider: Collider | null, length = -1): boolean {
    if (this.out) this.letGo('console');
    this.muteOwed = false;
    const T = GRAPPLE_TUNE;
    const slot = this.hulls.adopt(b.physics, v);
    if (!slot) return false;
    this.rope.framesMoved();
    this.launch[0] = b.pos.x;
    this.launch[1] = b.pos.y + T.ropeY;
    this.launch[2] = b.pos.z;
    this.trailCount = 1;
    this.dartFilter = b.filter;
    this.dartExclude = b.body;
    this.dartPhysics = b.physics;
    this.state = 'flying';
    this.released = false;
    const h = this.hullHit;
    h.slot = slot;
    h.vehicle = v;
    h.collider = collider ?? (v.body.numColliders() > 0 ? v.body.collider(0) : null);
    const w = this.segA;
    w[0] = x;
    w[1] = y;
    w[2] = z;
    this.hulls.castToLocalOf(slot, w, false, h.local);
    w[0] = nx;
    w[1] = ny;
    w[2] = nz;
    this.hulls.castToLocalOf(slot, w, true, h.localN);
    h.world[0] = x;
    h.world[1] = y;
    h.world[2] = z;
    h.worldN[0] = nx;
    h.worldN[1] = ny;
    h.worldN[2] = nz;
    this.biteHull(b, b.physics);
    if (length > 0 && this.attached) this.rope.length = Math.min(this.range, length);
    return this.attached;
  }

  /**
   * Fasten the rope on another player's vehicle at once (wave 3c; the console's and the tests'): the point (x, y, z) and its
   * normal are given in the world against the pose the rope rides on it now, and kept in its own frame from there. False
   * when that player's vehicle is not among the boxes the body sees, or no frame is free.
   */
  attachPeer(b: GrappleBody, id: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, length = -1): boolean {
    if (this.out) this.letGo('console');
    this.muteOwed = false;
    const T = GRAPPLE_TUNE;
    const peers = b.peerHulls ?? null;
    let e: PeerHull | null = null;
    if (peers) for (const h of peers.list) if (h.id === id) e = h;
    if (!peers || !e) return false;
    const slot = this.hulls.adoptPeer(peers, e);
    if (!slot) return false;
    this.rope.framesMoved();
    this.launch[0] = b.pos.x;
    this.launch[1] = b.pos.y + T.ropeY;
    this.launch[2] = b.pos.z;
    this.trailCount = 1;
    this.dartFilter = b.filter;
    this.dartExclude = b.body;
    this.dartPhysics = b.physics;
    this.state = 'flying';
    this.released = false;
    const f = this.hulls.peerFrame(slot);
    const h = this.hullHit;
    h.slot = slot;
    h.vehicle = null;
    h.collider = null;
    h.peer = id;
    h.peerObj = e.obj;
    const io = f.io;
    f.s = 1;
    io[0] = x;
    io[1] = y;
    io[2] = z;
    f.toLocal();
    h.local[0] = io[3];
    h.local[1] = io[4];
    h.local[2] = io[5];
    // The normal into its own coordinates: turned back by the pose's own turn.
    this.segA[0] = nx;
    this.segA[1] = ny;
    this.segA[2] = nz;
    turnBy(f.nq, true, this.segA, 0, h.localN, 0);
    h.world[0] = x;
    h.world[1] = y;
    h.world[2] = z;
    h.worldN[0] = nx;
    h.worldN[1] = ny;
    h.worldN[2] = nz;
    this.biteHull(b, b.physics);
    if (length > 0 && this.attached) this.rope.length = Math.min(this.range, length);
    return this.attached;
  }

  /** The dart comes home: a miss, a refusal, or the fire key pressed while it flies. */
  recall(): void {
    if (this.state !== 'flying' || this.returning) return;
    this.returning = true;
    this.returnT = 0;
    this.returnFrom[0] = this.dart[0];
    this.returnFrom[1] = this.dart[1];
    this.returnFrom[2] = this.dart[2];
  }

  /**
   * Let go, whatever is out: the rope and the dart go, the latch clears, and the walk, the torch and the jump
   * are owed a mute until their keys are up (the next key block applies it, or the key block that let go at
   * once); a loose prop's let-go owes the torch alone, its yank's key. Never the crouch: an X held from reeling
   * out into the landing is Jedi Academy's landing roll.
   *
   * A rope let go of while the body flies faster than `slamFrom` starts the fast flight (`released`), so a wall it then
   * flies into still hurts; a call-back or a miss never does, being no rope. A way out that puts the body somewhere new
   * (`endsFlight`) ends that flight and everything the hook still eases, whether or not anything was out.
   */
  letGo(reason: LetGoReason): void {
    const ends = endsFlight(reason);
    if (this.state === 'off') {
      if (ends) this.calm();
      return;
    }
    const wasAttached = this.state === 'attached';
    // The keys owed a mute: a loose prop's torch alone, unless the whole three are owed already from a let-go not yet
    // applied (one owed list, so the wider wins).
    this.owedMutes = this.state === 'holding' && !(this.muteOwed && this.owedMutes === GRAPPLE_RELEASE_MUTES) ? THING_RELEASE_MUTES : GRAPPLE_RELEASE_MUTES;
    // A hooked prop has its weight back: the yank held it weightless, and nothing else would give it back for a grip's
    // lapse. Only while the pool still answers for it and its world is whole: a prop freed with its world has no body.
    const thing = this.thing;
    if (thing) {
      const p = this.anchorPhysics;
      if (p && !p.broken && this.propAt?.(this.thingHandle) === thing) thing.giveWeightBack();
      this.thing = null;
      this.thingHandle = -1;
    }
    this.yanking = false;
    this.yankTime = 0;
    this.thingBlocked = 0;
    // Whose vehicle the rope rode, for the flight after it (§3.11): read before the rope is let go of.
    const peerWas = wasAttached ? this.ropePeer() : 0;
    this.state = 'off';
    this.returning = false;
    this.rope.release();
    this.con.reset();
    this.latch = false;
    this.hauling = false;
    this.haulEnded = false;
    this.lipping = false;
    this.lipGaveUp = false;
    this.wallTouch = false;
    this.swimLiftWas = false;
    // Every frame the rope rode forgotten, and every hull it marked walk-through put back, through the very colliders
    // it marked (a disposed hull's body is never asked for its colliders). In the physics they were marked in.
    this.hulls.clear(this.anchorPhysics ?? this.dartPhysics);
    this.onHull = false;
    this.onHullFloor = false;
    // Nothing of the last hull met is kept past the rope: a hull disposed with its world is never held by the hook.
    this.forgetHullHits();
    this.towed = false;
    this.slippingTurn = false;
    this.catchLeft = GRAPPLE_TUNE.slipKeep;
    this.pivV.x = 0;
    this.pivV.y = 0;
    this.pivV.z = 0;
    this.anchorPhysics = null;
    this.dartPhysics = null;
    this.muteOwed = true;
    this.lastLetGo = reason;
    // The rope's correction goes with it: the flight after it syncs the collider and adds nothing to the move.
    this.corr.x = 0;
    this.corr.y = 0;
    this.corr.z = 0;
    this.reelRun = 0;
    ropeModes(false, false, false, false, false, false, 0, GRAPPLE_TUNE, this.modes);
    if (ends) this.calm();
    else if (wasAttached) {
      const v = this.bodyVel;
      const speed = v ? len3(v.x, v.y, v.z) : 0;
      if (releasedHolds(speed, GRAPPLE_TUNE)) {
        this.released = true;
        this.releasedSpeed = speed;
        this.releasedPeer = peerWas;
      }
    }
  }

  /** The relay id of another player whose vehicle any point of the rope rides (the anchor's first), or 0. */
  ropePeer(): number {
    const rope = this.rope;
    if (rope.hullPoints === 0) return 0;
    for (let i = 0; i <= rope.n; i++) {
      const fi = rope.pf[i];
      if (fi > MAX_HULL_FRAMES) {
        const f = this.hulls.peerFrame(fi);
        if (f.src) return f.ps.id;
      }
    }
    return 0;
  }

  /**
   * Everything the hook still eases, stood down at once: the fast flight, the stagger and its shake and daze, the jolt,
   * the lean, the arm and the camera's pull. For a body put somewhere new, given to a mount or a ship's rooms, or dead,
   * none of which may carry a stagger or a lean on from where it was.
   */
  private calm(): void {
    this.released = false;
    this.staggerAge = Number.POSITIVE_INFINITY;
    this.shakeNow = 0;
    this.dazeNow = 0;
    this.joltNow = 0;
    this.joltLeft = 0;
    leanIdentity(this.lean);
    this.leanAngle = 0;
    this.leanTailLeft = 0;
    this.armWeight = 0;
    this.camScaleNow = 1;
    this.camAirborne = false;
  }

  /**
   * The key block's own part (§5.3), which the game's `stepGrappleKeys` and the node harness both call: mute
   * first, then act. A let-go owed from the frame before (made inside the player's update) is muted until its
   * keys are up before anything is read; while the hook is out the frame's mutes go on (the walk, the crouch,
   * the torch, the postures, the emotes, and the jump while swinging, so the Space that boosts is already no
   * jump; on a loose prop only the torch and the emotes); then the fire key fires (`fire`, the caller's, which checks the mark and the refusals), calls the dart
   * back or lets go, and Space boosts off while swinging, a let-go made here muting at once; and the held reels
   * and the haul are kept for the frame's steps. `mutes` is the caller's kept list.
   */
  stepKeys(input: GrappleKeyInput, b: GrappleBody, mutes: string[], fire: () => void): void {
    this.bodyVel = b.vel;
    if (this.muteOwed) {
      input.muteUntilUp(this.owedMutes);
      this.muteOwed = false;
    }
    if (this.out) this.refreshModes(b);
    if (grappleMutes(mutes, this.out, this.out && this.modes.swinging, this.holding)) input.mute(mutes);
    if (input.pressedAction('grappleFire')) {
      if (this.attached || this.holding) this.letGo('fire');
      else if (this.flying) {
        this.recall();
        this.counts.recalls++;
      } else fire();
    }
    // A slam's stagger takes the boost, the reels and the haul for its half second (the sway in `beforeMove`).
    const steady = !this.staggered;
    if (this.attached && this.modes.swinging && steady && input.pressedAction('grappleBoost')) this.boost(b);
    if (this.muteOwed) {
      input.muteUntilUp(this.owedMutes);
      this.muteOwed = false;
    }
    // The reels are an anchor's: on a loose prop their keys are the walk's and the crouch's again, and read as no reel.
    const k = this.keys;
    const reels = this.out && steady && !this.holding;
    k.reelIn = reels && input.held('reelIn');
    k.reelOut = reels && input.held('reelOut');
    k.haul = this.out && steady && input.held('grappleHaul');
  }

  /** Space while swinging: a push along the line toward its first point, and the rope lets go. */
  boost(b: GrappleBody): void {
    if (!this.attached) return;
    const T = GRAPPLE_TUNE;
    this.pivot(this.piv);
    let rx = this.piv.x - b.pos.x;
    let ry = this.piv.y - (b.pos.y + T.ropeY);
    let rz = this.piv.z - b.pos.z;
    const rl = len3(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;
    b.vel.x += rx * T.boost;
    b.vel.y += ry * T.boost;
    b.vel.z += rz * T.boost;
    this.bodyVel = b.vel;
    this.counts.boosts++;
    this.letGo('boost');
  }

  /** The physics world the rope was made in is the player's, and not broken: nothing is asked of any other. */
  private worldOk(b: GrappleBody): boolean {
    const p = this.anchorPhysics;
    return !!p && p === b.physics && !p.broken;
  }

  /** Whether a reel-in takes the swim's vertical this frame (§3.17): attached, afloat, reel-in held, the rope rising past `swimLift`. */
  liftsSwimmer(b: GrappleBody): boolean {
    if (!this.attached || !b.swimming || this.keys.haul) {
      this.swimLiftWas = false;
      this.swimLiftNow = false;
      return false;
    }
    this.pivot(this.piv);
    const rise = riseOf(this.piv.x - b.pos.x, this.piv.y - (b.pos.y + GRAPPLE_TUNE.ropeY), this.piv.z - b.pos.z);
    const on = swimLifts(rise, this.keys.reelIn, GRAPPLE_TUNE, this.swimLiftWas);
    this.swimLiftWas = on;
    this.swimLiftNow = on;
    return on;
  }

  /**
   * Whether a tow over water takes the swim's level speed this frame (§3.18): attached, afloat, the rope on a hull that
   * pulled within `towHold`. Writes into the swim's record what the skim needs (the tow's friction and damping, the
   * rope's level way from its pivot and the pivot's velocity), so the water's surface is a ground for a tow and the swim's
   * own ease never drags a towed swimmer off the line.
   */
  towsSwimmer(b: GrappleBody, sw: SwimIn): boolean {
    if (!this.attached || !b.swimming || !this.towed) return false;
    const T = GRAPPLE_TUNE;
    this.pivot(this.piv);
    let rx = b.pos.x - this.piv.x;
    let rz = b.pos.z - this.piv.z;
    const rl = len2(rx, rz);
    if (rl > 1e-6) {
      rx /= rl;
      rz /= rl;
    } else {
      rx = 0;
      rz = 0;
    }
    sw.towFriction = T.towFriction;
    sw.towDamp = T.towDamp;
    sw.towRx = rx;
    sw.towRz = rz;
    sw.towVx = this.pivV.x;
    sw.towVz = this.pivV.z;
    return true;
  }

  /** The rope's rise in degrees from the hand to its pivot, for the console. */
  rise(b: GrappleBody): number {
    if (!this.attached) return 0;
    this.pivot(this.piv);
    return riseOf(this.piv.x - b.pos.x, this.piv.y - (b.pos.y + GRAPPLE_TUNE.ropeY), this.piv.z - b.pos.z);
  }

  // --- vehicles on the rope (wave 3, §3.18) ----------------------------------------------------------------

  /** How many of the rope's points ride slot i: what `HullFrames.begin` asks, kept so no closure is made a frame. */
  private readonly countOn = (i: number): number => this.rope.pointsOn(i);

  /**
   * The frames this frame: with no vehicle about and nothing on a hull, nothing (the rope costs what it always did);
   * otherwise the box the free span and the dart may sweep, every hull near it or carrying a point found and led to the
   * frame's start and end, and the rope told its frames moved.
   */
  private stepFrames(b: GrappleBody, dt: number): void {
    const rope = this.rope;
    const hulls = this.hulls;
    if (!(GRAPPLE_TUNE.vehicles && (b.vehicles.length > 0 || this.peersAbout(b))) && rope.hullPoints === 0 && !hulls.any) {
      this.onHull = false;
      rope.framesMoved();
      return;
    }
    this.fillNearBox(b, dt);
    hulls.begin(b.physics, b.vehicles, b.peerHulls ?? null, dt, this.nearBox, this.countOn);
    rope.framesMoved();
    this.onHull = rope.hullPoints > 0;
    this.slipNow.reads += hulls.reads;
  }

  /** Another player's vehicle is among the boxes the body sees (wave 3c). */
  private peersAbout(b: GrappleBody): boolean {
    const p = b.peerHulls;
    return !!p && p.list.length > 0;
  }

  /** The box the rope's free span and the dart may sweep this frame, a metre and the frame's travel round them: min, then max. */
  private fillNearBox(b: GrappleBody, dt: number): void {
    const box = this.nearBox;
    const v = b.vel;
    const pad = 1 + len3(v.x, v.y, v.z) * dt;
    const hx = b.pos.x;
    const hy = b.pos.y + GRAPPLE_TUNE.ropeY;
    const hz = b.pos.z;
    box[0] = hx - pad;
    box[1] = hy - pad;
    box[2] = hz - pad;
    box[3] = hx + pad;
    box[4] = hy + pad;
    box[5] = hz + pad;
    if (this.state === 'attached') {
      const rope = this.rope;
      this.boxTake(rope.pointAt(rope.n, this.t1));
      if (rope.n > 0) this.boxTake(rope.pointAt(rope.n - 1, this.t1));
    } else if (this.state === 'flying') {
      const t = this.t1;
      t.x = this.dart[0];
      t.y = this.dart[1];
      t.z = this.dart[2];
      this.boxTake(t);
      const k = dt + GRAPPLE_TUNE.lead / Math.max(1, len3(this.dartVel[0], this.dartVel[1], this.dartVel[2]));
      t.x += this.dartVel[0] * k;
      t.y += this.dartVel[1] * k;
      t.z += this.dartVel[2] * k;
      this.boxTake(t);
    }
  }

  private boxTake(p: { x: number; y: number; z: number }): void {
    const box = this.nearBox;
    if (p.x - 1 < box[0]) box[0] = p.x - 1;
    if (p.y - 1 < box[1]) box[1] = p.y - 1;
    if (p.z - 1 < box[2]) box[2] = p.z - 1;
    if (p.x + 1 > box[3]) box[3] = p.x + 1;
    if (p.y + 1 > box[4]) box[4] = p.y + 1;
    if (p.z + 1 > box[5]) box[5] = p.z + 1;
  }

  /**
   * Every hull the rope rides, checked before anything is asked of it (§3.10): one disposed, destroyed or ghosted (read
   * in that order, before any call on its body) lets go of an anchor on it ("The line came loose.") and leaves a bend on
   * it a still bend where it last stood; one moved further than it could have gone lets the anchor go (`moved`); the
   * anchor's hull refitted, or the wing under the anchor starting to swing, lets go. False once the rope let go. A hull
   * whose own hit test fired is counted: the rope's pull must never set one off.
   */
  private hullsHold(): boolean {
    const rope = this.rope;
    const hulls = this.hulls;
    for (let i = 1; i <= MAX_HULL_FRAMES; i++) {
      const h = hulls.hull(i);
      if (!h.src || h.carries === 0) continue;
      const anchor = rope.pf[0] === i;
      if (h.gone) {
        if (anchor) {
          this.letGo('loose');
          this.say?.('The line came loose.');
          return false;
        }
        rope.freeze(i);
        hulls.free(h);
        continue;
      }
      const v = h.vehicle!;
      if (v.justHit > 0) this.slipNow.hits++;
      if (h.jumped) {
        if (anchor) {
          this.letGo('moved');
          return false;
        }
        rope.freeze(i);
        hulls.free(h);
        continue;
      }
      if (!anchor) continue;
      if (v.refits !== h.refitsAt) {
        this.letGo('refit');
        this.say?.('The line came loose.');
        return false;
      }
      const c = rope.cols[0];
      if (c && v.wingStateOf(c.handle) === 'moving') {
        this.letGo('wing');
        this.say?.('The line came loose.');
        return false;
      }
    }
    // Other players' vehicles (wave 3c): one no longer that player's shown ride (they left, got off, onto another vehicle,
    // or went out of sight) lets an anchor on it go in words, and one whose state landed further than `peerJump` from
    // where the pose expected it (a teleport) lets it go as `moved`; a bend on either is kept as a still one.
    for (let i = MAX_HULL_FRAMES + 1; i < hulls.slots.length; i++) {
      const f = hulls.peerFrame(i);
      if (!f.src || f.carries === 0) continue;
      if (!f.gone && !f.jumped) continue;
      if (rope.pf[0] === i) {
        if (f.gone) {
          this.letGo('loose');
          this.say?.('The line came loose.');
        } else this.letGo('moved');
        return false;
      }
      rope.freeze(i);
      hulls.freePeer(i);
    }
    this.onHull = rope.hullPoints > 0;
    if (this.onHull) rope.respan();
    return true;
  }

  /** Whether the pivot stands still: on the world, or on a hull that is held or at rest (its lag under `hullLag`). */
  pivotStill(): boolean {
    const fi = this.rope.pf[this.rope.n];
    if (fi === 0) return true;
    // Another player's vehicle is never still for the haul (wave 3c): its box is a sensor the controller has nothing of, so
    // the body is only ever held off it by the rope's own box test and never stands on it, and the haul there ends hanging
    // at `minFree` with the rope in.
    if (fi > MAX_HULL_FRAMES) return false;
    const h = this.hulls.hull(fi);
    return !h.src || !h.moving;
  }

  /**
   * What the console says of the vehicles on the rope (`__debug.grapple()`, wave 3; allocates, the console's only):
   * each point's frame (`world` or the hull's name), the pivot's speed, the slip's and the pull's tallies over the last
   * whole second, the tow and what is left of its hold, each roped or near hull's brake, the hull test (the hulls
   * marked walk-through, its contacts and the metres it pushed the body out over the last second, and the gap from the
   * capsule to the nearest marked hull's box where the hull stands now), and the hull families cast this frame.
   */
  vehicleReport(b: GrappleBody): Record<string, unknown> {
    const n2 = (v: number) => Number(v.toFixed(2));
    const n3 = (v: number) => Number(v.toFixed(3));
    const rope = this.rope;
    const hulls = this.hulls;
    const name = (v: Vehicle | null): string => (v ? (v.def?.id ?? v.spec.id) : 'gone');
    const frameName = (fi: number): string => (fi === 0 ? 'world' : fi > MAX_HULL_FRAMES ? `peer:${hulls.peerFrame(fi).ps.id}` : name(hulls.hull(fi).vehicle));
    const frames: string[] = [];
    if (this.attached) for (let i = 0; i <= rope.n; i++) frames.push(frameName(rope.pf[i]));
    const brake: Record<string, unknown>[] = [];
    const marked: string[] = [];
    const near: string[] = [];
    for (let i = 1; i <= MAX_HULL_FRAMES; i++) {
      const h = hulls.hull(i);
      if (!h.src) continue;
      if (h.near) near.push(name(h.vehicle));
      if (h.marked) marked.push(name(h.vehicle));
      if (h.carries > 0) brake.push({ vehicle: name(h.vehicle), latched: h.braked, pulled: h.pulledYet, driven: h.vs.driven(), budget: n2(h.budget), moving: h.moving, lag: n3(h.lag) });
    }
    // Other players' vehicles (wave 3c): each slot's pose mode, how far its pose stood off the drawn picture (now, and the
    // most over the last whole second, and that per m/s of the vehicle's speed), and its last jump test.
    const peer: Record<string, unknown>[] = [];
    for (let i = MAX_HULL_FRAMES + 1; i < hulls.slots.length; i++) {
      const f = hulls.peerFrame(i);
      if (!f.src) continue;
      if (f.near) near.push(frameName(i));
      const v = f.hull?.vel;
      const speed = v ? Math.hypot(v[0], v[1], v[2]) : 0;
      peer.push({ id: f.ps.id, mode: GRAPPLE_TUNE.peerPose, carries: f.carries, smoothToPicture: n3(f.gapWorst), now: n3(f.gap), perMs: speed > 0.5 ? n3(f.gapWorst / speed) : null, speed: n2(speed), jump: { miss: n2(f.lastMiss), timing: n2(f.lastSlack), past: n2(GRAPPLE_TUNE.peerJump + f.lastSlack), jumped: f.jumped }, gone: f.gone });
    }
    const rides = this.ropePeer();
    const main = peer.find((p) => p.id === rides) ?? peer[0] ?? null;
    const s = this.slipLast;
    return {
      frames,
      peer: {
        mode: GRAPPLE_TUNE.peerPose,
        rides,
        released: this.released ? this.releasedPeer : 0,
        mayHurt: this.slamPeer() ? this.peerMayHurt(this.slamPeer()) : null,
        smoothToPicture: main ? main.smoothToPicture : null,
        perMs: main ? main.perMs : null,
        jump: main ? main.jump : null,
        slots: peer,
      },
      onHull: this.onHull,
      pivotSpeed: n2(len3(this.pivV.x, this.pivV.y, this.pivV.z)),
      paidOut: n2(this.paidOut),
      slip: { paid: n2(s.paid), catches: s.catches, turns: s.turns, reels: s.reels },
      towed: this.towed,
      towHold: n2(this.onHull && Number.isFinite(this.sincePull) ? Math.max(0, GRAPPLE_TUNE.towHold - this.sincePull) : 0),
      pull: { impulse: n2(s.impulse), hits: s.hits },
      brake,
      hull: { marked, contacts: s.contacts, pushed: n3(s.pushed), calls: s.calls, contactTests: s.contactTests, gap: this.hullGap(b), floor: this.onHullFloor },
      near,
      bodyReads: s.reads + hulls.markReads,
    };
  }

  /**
   * The gap (m) from the capsule to the nearest marked hull's bounds box, the hull where it stands now (its body led by
   * what is left in the accumulator), negative inside; null with no hull marked. The box is not the hull's shape: inside
   * an open or concave hull (an open cockpit) it reads negative where the capsule touches nothing. The console's (allocates).
   */
  hullGap(b: GrappleBody): number | null {
    let best: number | null = null;
    const acc = b.physics.behind;
    for (let i = 1; i <= MAX_HULL_FRAMES; i++) {
      const h = this.hulls.hull(i);
      const v = h.vehicle;
      if (!h.marked || !v || v.disposed || !v.body.isValid()) continue;
      const t = v.body.translation();
      const r = v.body.rotation();
      const l = v.body.linvel();
      const bb = v.spec.bounds;
      const minx = Math.min(bb.min[0], bb.max[0]);
      const maxx = Math.max(bb.min[0], bb.max[0]);
      const miny = Math.min(bb.min[1], bb.max[1]);
      const maxy = Math.max(bb.min[1], bb.max[1]);
      const minz = Math.min(bb.min[2], bb.max[2]);
      const maxz = Math.max(bb.min[2], bb.max[2]);
      const q = Float64Array.of(r.x, r.y, r.z, r.w);
      const p = new Float64Array(3);
      const o = new Float64Array(3);
      for (let k = 0; k <= 8; k++) {
        p[0] = b.pos.x - (t.x + l.x * acc);
        p[1] = b.pos.y + SLAM_REACH + (0.9 * k) / 8 - (t.y + l.y * acc);
        p[2] = b.pos.z - (t.z + l.z * acc);
        turnBy(q, true, p, 0, o, 0);
        const dx = Math.max(minx - o[0], 0, o[0] - maxx);
        const dy = Math.max(miny - o[1], 0, o[1] - maxy);
        const dz = Math.max(minz - o[2], 0, o[2] - maxz);
        const out = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const ins = Math.min(Math.max(minx - o[0], o[0] - maxx, miny - o[1], o[1] - maxy, minz - o[2], o[2] - maxz), 0);
        const gap = out + ins - SLAM_REACH;
        if (best === null || gap < best) best = gap;
      }
    }
    return best === null ? null : Number(best.toFixed(3));
  }

  /** A second of the slip's and the pull's tallies is done: kept for the console, and the next one begun. */
  private rollSecond(): void {
    const a = this.slipNow;
    const z = this.slipLast;
    z.paid = a.paid;
    z.catches = a.catches;
    z.turns = a.turns;
    z.reels = a.reels;
    z.impulse = a.impulse;
    z.hits = a.hits;
    z.pushed = a.pushed;
    z.contacts = a.contacts;
    z.calls = a.calls;
    z.contactTests = a.contactTests;
    z.reads = a.reads;
    a.paid = 0;
    a.catches = 0;
    a.turns = 0;
    a.reels = 0;
    a.impulse = 0;
    a.hits = 0;
    a.pushed = 0;
    a.contacts = 0;
    a.calls = 0;
    a.contactTests = 0;
    a.reads = 0;
    this.secondLeft = 1;
  }

  /** Rope paid out to a hull (the slip's), counted: the length handed over in `nums[4]`. */
  private payOut(): void {
    const m = this.nums[4];
    this.rope.length += m;
    this.paidOut += m;
    this.slipNow.paid += m;
  }

  /**
   * The step before the move on a rope that touches a hull (§3.18): what the still rope does, every move of the body
   * relative to the pivot (whose velocity over the frame comes of the frames' poses), and the catch through the slip and
   * the reduced mass, its tension put on every hull point of the rope. On the ground under such a rope the tow's friction
   * and damping stand in for the ground's. A hull dragging a point away faster than `slipReel` pays the rope out, as does
   * a correction past `slipCorr`; past the range the line runs out.
   */
  private beforeMoveOnHull(b: GrappleBody, dt: number): void {
    const T = GRAPPLE_TUNE;
    const rope = this.rope;
    const vel = b.vel;
    const hand = this.hand0;
    const m = this.modes;
    // The pivot where it stands at the frame's start and end, and its velocity over the frame.
    const piv0 = rope.pointAtStart(rope.n, this.piv0);
    const piv = rope.pointAt(rope.n, this.piv);
    const pv = this.pivV;
    pv.x = (piv.x - piv0.x) / dt;
    pv.y = (piv.y - piv0.y) / dt;
    pv.z = (piv.z - piv0.z) / dt;
    if (T.gravity !== 1 && m.swinging) vel.y += gravityAddBack(T.gravity, GRAPPLE_GRAVITY, dt);
    // The tow: sliding on the ground under a rope on a hull, the tow's friction against the level speed and its swing
    // across the rope damped, relative to the pivot: a skier holding a line. Every length in this method is `Math.sqrt`
    // written out, never `len2`/`len3`: which of this big method's small calls the compiler builds in turns on when it
    // reaches them, and about one process in fifty left a length out and boxed its numbers (16 to 48 B a frame).
    if (m.sliding) {
      const horiz = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (T.towFriction > 0 && horiz > 1e-6) {
        const f = Math.min(horiz, T.towFriction * dt) / horiz;
        vel.x -= vel.x * f;
        vel.z -= vel.z * f;
      }
      if (T.towDamp > 0) {
        let rx = hand.x - piv0.x;
        let rz = hand.z - piv0.z;
        const rl = Math.sqrt(rx * rx + rz * rz);
        if (rl > 1e-6) {
          rx /= rl;
          rz /= rl;
          const ux = vel.x - pv.x;
          const uz = vel.z - pv.z;
          const along = ux * rx + uz * rz;
          const k = Math.min(1, T.towDamp * dt);
          vel.x -= (ux - rx * along) * k;
          vel.z -= (uz - rz * along) * k;
        }
      }
    }
    // The brake's budget, refilled for every hull the rope rides.
    const g = -b.physics.world.gravity.y;
    const nums = this.nums;
    for (let i = 1; i <= MAX_HULL_FRAMES; i++) {
      const h = this.hulls.hull(i);
      if (h.src && h.carries > 0) {
        nums[0] = h.budget;
        nums[1] = h.src.mass();
        nums[2] = g;
        nums[3] = dt;
        brakeBudgetIn(nums, T);
        h.budget = nums[0];
      }
    }
    // The reel, or the haul, changes the length; a hull dragging a bend or the anchor away faster than `slipReel` pays out.
    const spentEnd = rope.spent;
    rope.measureSpentAtStart();
    nums[0] = spentEnd - rope.spentStart;
    nums[1] = dt;
    slipReelExcessIn(nums, T);
    if (nums[0] > 0) {
      nums[4] = nums[0];
      this.payOut();
      this.slipNow.reels++;
    }
    const haulHeld = this.keys.haul;
    let reel = 0;
    if (!haulHeld && (this.keys.reelIn || this.keys.reelOut)) {
      const reelSpeed = this.stats.apply('grapple.reel', T.reel);
      reel = this.keys.reelIn ? -reelSpeed : reelSpeed;
    }
    const minLen = spentEnd + T.minFree;
    if (reel < 0 && rope.length + reel * dt < minLen) reel = Math.min(0, (minLen - rope.length) / dt);
    if (reel > 0) {
      const range = this.range;
      if (rope.length + reel * dt > range) reel = Math.max(0, (range - rope.length) / dt);
    }
    const lengthWas = rope.length;
    rope.length += reel * dt;
    if (rope.length < minLen) {
      // A hull dragging a point away lengthened what is spent: the free span cannot go under its shortest, so the rope
      // pays out; a reel-in simply stops there.
      if (reel >= 0) {
        nums[4] = minLen - rope.length;
        this.payOut();
      }
      rope.length = minLen;
      if (reel > 0) reel = 0;
    }
    this.sinceTick += dt;
    if (reel !== 0) {
      this.reelRun += Math.abs(rope.length - lengthWas);
      this.ratchetIn = reel < 0;
      if (ratchetDue(this.reelRun, this.sinceTick, T)) {
        this.counts.ratchets++;
        this.sinceTick = 0;
        this.reelRun -= T.tickEvery;
      }
      if (this.reelRun > T.tickEvery) this.reelRun = T.tickEvery;
    }
    let rx = hand.x - piv0.x;
    let ry = hand.y - piv0.y;
    let rz = hand.z - piv0.z;
    const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (dist > 1e-6) {
      rx /= dist;
      ry /= dist;
      rz /= dist;
    }
    // The sway, relative to the pivot.
    const si = this.swayIn;
    si[0] = rx;
    si[1] = ry;
    si[2] = rz;
    si[3] = dist;
    si[4] = dt;
    this.sway(vel, pv, m.swinging);
    // The haul, relative to the pivot: on a still hull the still haul whole, on a moving one it ends hanging at `minFree`.
    const wasHauling = this.hauling;
    this.hauling = false;
    const cut = this.haulCut;
    cut.x = 0;
    cut.y = 0;
    cut.z = 0;
    // `haul` reads the pivot where the free span hangs from at the frame's start.
    this.piv.x = piv0.x;
    this.piv.y = piv0.y;
    this.piv.z = piv0.z;
    if (!haulHeld) {
      this.haulEnded = false;
      this.lipping = false;
      this.lipGaveUp = false;
    } else if (dist > 1e-6) {
      this.haulDist = dist;
      this.haul(b, dt);
    }
    if (wasHauling && !this.hauling && this.haulEnded && T.haulArrive) {
      // The haul's own speed taken off on the frame it ends: at rest relative to its pivot, which goes on with the hull.
      vel.x = pv.x;
      vel.y = pv.y;
      vel.z = pv.z;
    }
    // The swing's drag across the rope in the air, and the wall's friction, relative to the pivot.
    if (m.hanging && T.swingDrag > 0 && dist > 1e-6 && !this.hauling) {
      const ux = vel.x - pv.x;
      const uy = vel.y - pv.y;
      const uz = vel.z - pv.z;
      const radial = ux * rx + uy * ry + uz * rz;
      const k = Math.min(1, T.swingDrag * dt);
      vel.x -= (ux - rx * radial) * k;
      vel.y -= (uy - ry * radial) * k;
      vel.z -= (uz - rz * radial) * k;
    }
    if (this.wallTouch && m.swinging && T.wallFriction > 0 && !this.hauling) {
      const n = this.wallN;
      const ux = vel.x - pv.x;
      const uy = vel.y - pv.y;
      const uz = vel.z - pv.z;
      const vn = ux * n.x + uy * n.y + uz * n.z;
      const al = this.t1;
      al.x = ux - n.x * vn;
      al.y = uy - n.y * vn;
      al.z = uz - n.z * vn;
      const sw = this.t2;
      const sd = this.swayDir;
      sw.x = sd.x;
      sw.y = sd.y;
      sw.z = sd.z;
      const sn = sw.x * n.x + sw.y * n.y + sw.z * n.z;
      sw.x -= n.x * sn;
      sw.y -= n.y * sn;
      sw.z -= n.z * sn;
      wallFrictionSpare(al, sw, T.wallFriction, dt, al);
      vel.x = pv.x + al.x + n.x * vn;
      vel.y = pv.y + al.y + n.y * vn;
      vel.z = pv.z + al.z + n.z * vn;
    }
    this.wadeRateNow = 0;
    if (m.hanging && !b.swimming && b.depth > 0) {
      const rate = wadeDragOf(b.depth, T, SWIM_DEPTH);
      if (rate > 0) {
        const f = Math.exp(-rate * dt);
        vel.x *= f;
        vel.y *= f;
        vel.z *= f;
        this.wadeRateNow = rate;
      }
    }
    // The constraint on the velocity relative to the pivot, the catch through the slip and shared by the reduced mass.
    const corr = this.corr;
    corr.x = 0;
    corr.y = 0;
    corr.z = 0;
    const con = this.con;
    const tautBefore = con.taut;
    const free = rope.length - spentEnd;
    const slack = free - dist;
    const ux = vel.x - pv.x;
    const uy = vel.y - pv.y;
    const uz = vel.z - pv.z;
    const vr = ux * rx + uy * ry + uz * rz;
    let allowed = reel;
    if (slack > 0) allowed += slack / dt;
    const pivFi = rope.pf[rope.n];
    // Another player's vehicle takes no pull: the player takes the whole of the catch, as from anything infinitely heavy.
    const src = pivFi !== 0 ? this.hulls.srcOf(pivFi) : null;
    nums[0] = GRAPPLE_PLAYER_MASS;
    nums[1] = src && src.takesPull() ? src.mass() : Infinity;
    reducedShareIn(nums);
    const share = nums[0];
    nums[0] = Math.max(0, ux * ux + uy * uy + uz * uz - vr * vr);
    nums[1] = dist;
    this.slippingTurn = tautBefore && slipsTurnIn(nums, T);
    if (this.slippingTurn) this.slipNow.turns++;
    con.caught = 0;
    this.pulledHull = false;
    if (vr > allowed && dist > 1e-6) {
      const take = vr - allowed;
      nums[0] = take;
      nums[1] = this.catchLeft;
      nums[2] = dt;
      slipCatchIn(nums, T);
      const took = nums[0];
      nums[1] = this.catchLeft;
      nums[2] = dt;
      slipLeftIn(nums, T);
      this.catchLeft = nums[0];
      if (took < take) {
        nums[4] = (take - took) * dt;
        this.payOut();
        this.slipNow.catches++;
      }
      // The player's share of what the rope took, and the hull's as the rope's tension on every hull point of it.
      const mine = took * (1 - share);
      vel.x -= rx * mine;
      vel.y -= ry * mine;
      vel.z -= rz * mine;
      con.caught = took;
      this.pullJ0 = took * GRAPPLE_PLAYER_MASS * (1 - share);
      this.pullHulls();
    } else this.catchLeft = T.slipKeep;
    con.taut = slack <= T.tautEps || con.caught > 0;
    const slackNow = rope.length - spentEnd - dist;
    if (slackNow < 0) {
      let back = -slackNow;
      if (back > T.slipCorr) {
        nums[4] = back - T.slipCorr;
        this.payOut();
        back = T.slipCorr;
      }
      corr.x = -rx * back;
      corr.y = -ry * back;
      corr.z = -rz * back;
    }
    corr.x -= cut.x;
    corr.y -= cut.y;
    corr.z -= cut.z;
    if (rope.length > this.range) {
      this.letGo('ranOut');
      this.say?.('The line ran out.');
      return;
    }
    if (con.caught > 0) {
      this.sincePull = 0;
      if (!tautBefore) {
        this.catchRun = con.caught;
        this.catchStep = 1;
      } else if (this.catchStep === 1) {
        this.catchRun += con.caught;
        this.catchStep = 2;
      } else this.catchStep = 0;
      const jolt = this.catchStep > 0 && this.catchRun > T.joltFrom ? joltFor(this.catchRun, T) : 0;
      if (jolt > 0) {
        this.joltNow = this.joltLeft > 0 ? Math.max(this.joltNow, jolt) : jolt;
        this.joltLeft = T.joltTime;
        this.lastCatch = this.catchRun;
      }
    } else this.catchStep = 0;
    // Resting on a moving hull's floor is not falling either (the hull test's own landing clamp, `onHullFloor`).
    if (con.taut || m.onGround || m.afloat || this.onHullFloor) b.jka.holdApex(b.pos.y);
    // The latch: while hanging, and on a frame the rope on a hull pulls (a body standing when a passing hull's rope catches has never hung).
    if (m.hanging || con.caught > 0) this.latch = true;
    this.speedBefore = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    this.corrLen = Math.sqrt(corr.x * corr.x + corr.y * corr.y + corr.z * corr.z);
  }

  /**
   * The rope's tension `J` (N·s this frame, handed over in `pullJ0`) on every hull point of it that takes a pull: the anchor along its span, a bend
   * along both of its spans, which is a frictionless rope's load on whatever it bends round. A hull at rest at the rope's
   * first pull that nothing drives holds the level part against its kept brake budget first (§3.18); only the rest goes
   * to the hull, at the point where the physics has it, through `Vehicle.pulled`, which tells its hit tests.
   */
  private pullHulls(): void {
    const J = this.pullJ0;
    const T = GRAPPLE_TUNE;
    const rope = this.rope;
    const a = this.t1;
    const c = this.t2;
    for (let i = 0; i <= rope.n; i++) {
      const fi = rope.pf[i];
      // The world, and another player's vehicle (a picture here: nothing is ever put on it), take nothing.
      if (fi === 0 || fi > MAX_HULL_FRAMES) continue;
      const h = this.hulls.hull(fi);
      const src = h.src;
      if (!src || h.gone || !src.takesPull()) continue;
      rope.pointAt(i, a);
      const j = this.pullJ;
      j.x = 0;
      j.y = 0;
      j.z = 0;
      if (i < rope.n) rope.pointAt(i + 1, c);
      else {
        c.x = this.hand0.x;
        c.y = this.hand0.y;
        c.z = this.hand0.z;
      }
      let dx = c.x - a.x;
      let dy = c.y - a.y;
      let dz = c.z - a.z;
      // By `Math.sqrt` here and below rather than `len3`: a call the compiler leaves out of this is handed fresh numbers.
      let l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l > 1e-6) {
        j.x += (dx / l) * J;
        j.y += (dy / l) * J;
        j.z += (dz / l) * J;
      }
      if (i > 0) {
        rope.pointAt(i - 1, c);
        dx = c.x - a.x;
        dy = c.y - a.y;
        dz = c.z - a.z;
        l = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (l > 1e-6) {
          j.x += (dx / l) * J;
          j.y += (dy / l) * J;
          j.z += (dz / l) * J;
        }
      }
      // The parked brake: latched at the rope's first pull on this hull (at rest then, nothing driving it), dropped for
      // good the moment something drives it.
      const driven = h.vs.driven();
      if (!h.pulledYet) {
        h.pulledYet = true;
        h.braked = !driven && Math.sqrt(h.lv[0] * h.lv[0] + h.lv[2] * h.lv[2]) < T.parkRest;
      }
      if (driven) h.braked = false;
      this.parked.budget = h.budget;
      parkedLevelIn(j, h.braked && T.parkHold > 0, this.parked);
      h.budget = this.parked.budget;
      j.x = this.parked.x;
      j.z = this.parked.z;
      // Put on the body where the physics has the point: its place on the hull taken to the hull's cast pose.
      const io = h.io;
      h.s = 1;
      io[0] = a.x;
      io[1] = a.y;
      io[2] = a.z;
      h.toCast();
      const at = this.pullAt;
      at.x = io[3];
      at.y = io[4];
      at.z = io[5];
      src.pull(j, at);
      this.pulledHull = true;
      this.slipNow.impulse += Math.sqrt(j.x * j.x + j.y * j.y + j.z * j.z);
    }
  }

  /**
   * The sway, while swinging: the move keys' direction taken into the plane square to the free span (handed over in
   * `swayIn`), and the body pushed along it, measured against the pivot's velocity `pv` (nought for a still pivot, a
   * hull's point velocity on one). Not while a slam's stagger runs. The direction is left in `swayDir` (nought with no
   * sway), which the wall's friction spares. One place for the still path and the hull's, so the push reads the
   * progress table once.
   */
  private sway(vel: { x: number; y: number; z: number }, pv: { x: number; y: number; z: number }, swinging: boolean): void {
    const T = GRAPPLE_TUNE;
    const si = this.swayIn;
    // The step comes in the kept array too: a number handed to a call that is not inlined is a fresh number.
    const dt = si[4];
    const rx = si[0];
    const ry = si[1];
    const rz = si[2];
    const swx = this.keys.swayX;
    const swz = this.keys.swayZ;
    const sd = this.swayDir;
    sd.x = 0;
    sd.y = 0;
    sd.z = 0;
    if (!(swinging && !this.staggered && (swx !== 0 || swz !== 0) && si[3] > 1e-6)) return;
    const d = swx * rx + swz * rz;
    let tx = swx - rx * d;
    let ty = -ry * d;
    let tz = swz - rz * d;
    // Worked out here rather than through `len3`: a call this method makes that is not inlined is handed fresh numbers.
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (!(tl > 1e-6)) return;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    sd.x = tx;
    sd.y = ty;
    sd.z = tz;
    // The push and its cap times the swing's momentum as progress makes it (Acrobatics' `grapple.swing`), which is
    // exactly 1 while nothing grants it, and a number times 1 is that number to the bit.
    const swing = this.stats.apply('grapple.swing', 1);
    const swayMax = T.swayMax * swing;
    const along = (vel.x - pv.x) * tx + (vel.y - pv.y) * ty + (vel.z - pv.z) * tz;
    if (along < swayMax) {
      const a = Math.min(T.swayAccel * swing * dt, swayMax - along);
      vel.x += tx * a;
      vel.y += ty * a;
      vel.z += tz * a;
    }
  }

  // --- the frame -------------------------------------------------------------------------------------

  /**
   * After the movement's step and the plunge, before the snap switch (§3.1, 2): the dart's flight while it
   * flies (it may bite here, so F held as it bites hauls this very frame); and attached, the gravity knob,
   * the reel or the haul, the sway, the drags, the constraint and its correction, and the fall's memory held.
   */
  beforeMove(b: GrappleBody, dt: number): void {
    const t0 = this.timing ? performance.now() : 0;
    this.costNow = 0;
    // The frames this frame (wave 3): what the rope rides and the hulls near the rope or the dart, led to the frame's time.
    // Asked only with a vehicle about or something on a hull, so a frame with neither calls nothing new at all.
    const framed = (this.state === 'flying' || this.state === 'attached') && (this.onHull || this.rope.hullFamilies || (GRAPPLE_TUNE.vehicles && (b.vehicles.length > 0 || this.peersAbout(b))) || this.hulls.any);
    if (framed) this.stepFrames(b, dt);
    if (this.state === 'flying') this.flyDart(b, dt);
    if (this.state !== 'attached') {
      // A hooked prop's guard against a place written without a reset measures the move against the speed the body
      // has now, before the move: a landing takes the fall's speed off before `afterMove`, and measured after it a hard
      // landing read as a teleport and let the prop go (the anchor's guard keeps its speed here for the same reason).
      if (this.state === 'holding') {
        const v = b.vel;
        this.speedBefore = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      }
      if (this.timing) this.costNow += performance.now() - t0;
      return;
    }
    if (!this.worldOk(b)) {
      this.letGo('world');
      return;
    }
    // A hull the rope rides that went, moved further than it could, was refitted, or whose wing under the anchor began
    // to swing: the anchor lets go, a bend becomes a still one (§3.10).
    if (this.onHull && !this.hullsHold()) return;
    // Which hulls the rope rides and that move: those leave the character controller for the hull test. Asked on every
    // attached frame the frames were stepped, whichever path the step then takes, and in the rope's own world: a hull the
    // rope has just come off (its last bend unwrapped) goes back to the controller at once, not only once it is out of
    // the rope's reach. A frame with no vehicle about and nothing in a slot asks nothing.
    if (framed) this.hulls.mark(b.physics);
    const T = GRAPPLE_TUNE;
    const rope = this.rope;
    const vel = b.vel;
    this.bodyVel = vel;
    const hand = this.hand0;
    hand.x = b.pos.x;
    hand.y = b.pos.y + T.ropeY;
    hand.z = b.pos.z;
    // A place written between frames without a reset (a later path that moves the player itself): the
    // rope lets go before anything is cast from the new place toward the anchor.
    const moved = len3(hand.x - rope.hand[0], hand.y - rope.hand[1], hand.z - rope.hand[2]);
    if (teleported(moved, 0, dt, 0, T)) {
      this.letGo('moved');
      return;
    }
    if (this.onHull) {
      this.beforeMoveOnHull(b, dt);
      if (this.timing) this.costNow += performance.now() - t0;
      return;
    }
    const m = this.modes;
    // The knob's add-back, skipped outright at 1 (a `+= 0` turns −0 into +0): any other value is a plain
    // scale on gravity while swinging, never afloat, never on the ground and never off the rope.
    if (T.gravity !== 1 && m.swinging) vel.y += gravityAddBack(T.gravity, GRAPPLE_GRAVITY, dt);
    // The reel, or the haul, changes the length.
    const haulHeld = this.keys.haul;
    let reel = 0;
    if (!haulHeld && (this.keys.reelIn || this.keys.reelOut)) {
      // The reel's speed as progress makes it (`grapple.reel`): the tune's own while nothing grants it.
      const reelSpeed = this.stats.apply('grapple.reel', T.reel);
      reel = this.keys.reelIn ? -reelSpeed : reelSpeed;
    }
    const minLen = rope.spent + T.minFree;
    if (reel < 0 && rope.length + reel * dt < minLen) reel = Math.min(0, (minLen - rope.length) / dt);
    if (reel > 0) {
      const range = this.range;
      if (rope.length + reel * dt > range) reel = Math.max(0, (range - rope.length) / dt);
    }
    const lengthWas = rope.length;
    rope.length += reel * dt;
    if (rope.length < minLen) {
      rope.length = minLen;
      if (reel > 0) reel = 0;
    }
    // The ratchet: once for every `tickEvery` of rope the held reel wound in or paid out, never more than `tickMax` a
    // second. Only the held reel's: the dart's pay-out has the fire's clank and the haul its own rumble.
    this.sinceTick += dt;
    if (reel !== 0) {
      this.reelRun += Math.abs(rope.length - lengthWas);
      this.ratchetIn = reel < 0;
      if (ratchetDue(this.reelRun, this.sinceTick, T)) {
        this.counts.ratchets++;
        this.sinceTick = 0;
        this.reelRun -= T.tickEvery;
      }
      // A reel past the cap never banks ratchets to play once it slows.
      if (this.reelRun > T.tickEvery) this.reelRun = T.tickEvery;
    }
    const piv = this.pivot(this.piv);
    let rx = hand.x - piv.x;
    let ry = hand.y - piv.y;
    let rz = hand.z - piv.z;
    const dist = len3(rx, ry, rz);
    if (dist > 1e-6) {
      rx /= dist;
      ry /= dist;
      rz /= dist;
    }
    // The sway, while swinging (against a still pivot's nought velocity).
    const si = this.swayIn;
    si[0] = rx;
    si[1] = ry;
    si[2] = rz;
    si[3] = dist;
    si[4] = dt;
    this.sway(vel, this.stillV, m.swinging);
    // The haul (F held): the velocity set along the rope toward its first point, the length following the body
    // down; over a lip it goes up and over; and it arrives at rest.
    const wasHauling = this.hauling;
    this.hauling = false;
    const cut = this.haulCut;
    cut.x = 0;
    cut.y = 0;
    cut.z = 0;
    if (!haulHeld) {
      this.haulEnded = false;
      this.lipping = false;
      this.lipGaveUp = false;
    } else if (dist > 1e-6) {
      this.haulDist = dist;
      this.haul(b, dt);
    }
    if (wasHauling && !this.hauling && this.haulEnded && T.haulArrive) {
      // The haul's own speed, still pointed at the face, taken off on the frame it ends: it arrives at rest
      // relative to its pivot (nought for anything still), and the swing goes on from there.
      vel.x = 0;
      vel.y = 0;
      vel.z = 0;
    }
    // The swing's drag across the rope, in the air.
    if (m.hanging && T.swingDrag > 0 && dist > 1e-6 && !this.hauling) {
      const radial = vel.x * rx + vel.y * ry + vel.z * rz;
      const k = Math.min(1, T.swingDrag * dt);
      vel.x -= (vel.x - rx * radial) * k;
      vel.y -= (vel.y - ry * radial) * k;
      vel.z -= (vel.z - rz * radial) * k;
    }
    // The wall's friction on the speed along it, sparing the sway, while touching one and swinging.
    if (this.wallTouch && m.swinging && T.wallFriction > 0 && !this.hauling) {
      const n = this.wallN;
      const vn = vel.x * n.x + vel.y * n.y + vel.z * n.z;
      const al = this.t1;
      al.x = vel.x - n.x * vn;
      al.y = vel.y - n.y * vn;
      al.z = vel.z - n.z * vn;
      const sw = this.t2;
      const sd = this.swayDir;
      sw.x = sd.x;
      sw.y = sd.y;
      sw.z = sd.z;
      const sn = sw.x * n.x + sw.y * n.y + sw.z * n.z;
      sw.x -= n.x * sn;
      sw.y -= n.y * sn;
      sw.z -= n.z * sn;
      wallFrictionSpare(al, sw, T.wallFriction, dt, al);
      vel.x = al.x + n.x * vn;
      vel.y = al.y + n.y * vn;
      vel.z = al.z + n.z * vn;
    }
    // The wading band: hanging in water shallower than the swim, the swing is dragged by how deep it runs.
    this.wadeRateNow = 0;
    if (m.hanging && !b.swimming && b.depth > 0) {
      const rate = wadeDragOf(b.depth, T, SWIM_DEPTH);
      if (rate > 0) {
        const f = Math.exp(-rate * dt);
        vel.x *= f;
        vel.y *= f;
        vel.z *= f;
        this.wadeRateNow = rate;
      }
    }
    // The constraint: the outward speed capped at the reel's rate plus the slack, the drift put back.
    const corr = this.corr;
    const tautBefore = this.con.taut;
    this.con.free = rope.free();
    this.con.reel = reel;
    this.con.apply(vel, hand, piv, dt, corr, T);
    // The haul's last step stops at the shortest: its shortfall goes on the move, beside the constraint's correction.
    corr.x -= cut.x;
    corr.y -= cut.y;
    corr.z -= cut.z;
    if (this.con.caught > 0) {
      this.sincePull = 0;
      // A slack rope going taut is a catch: it costs nothing, and past `joltFrom` it jolts the view a moment. The
      // constraint takes a catch's speed in two frames (the last of the slack lets some through, the frame after takes
      // the rest), so the catch is the two summed from the frame the rope runs out of slack, which reads the same at any
      // frame rate; a rope already bearing load takes no catch.
      if (!tautBefore) {
        this.catchRun = this.con.caught;
        this.catchStep = 1;
      } else if (this.catchStep === 1) {
        this.catchRun += this.con.caught;
        this.catchStep = 2;
      } else this.catchStep = 0;
      // Asked only past `joltFrom`: a steady rope's per-frame catch never reaches it, and the frame's call takes no number.
      const jolt = this.catchStep > 0 && this.catchRun > T.joltFrom ? joltFor(this.catchRun, T) : 0;
      if (jolt > 0) {
        this.joltNow = this.joltLeft > 0 ? Math.max(this.joltNow, jolt) : jolt;
        this.joltLeft = T.joltTime;
        this.lastCatch = this.catchRun;
      }
    } else this.catchStep = 0;
    // Hanging on a taut rope is not falling, nor is standing or floating: the fall counts from here.
    if (this.con.taut || m.onGround || m.afloat) b.jka.holdApex(b.pos.y);
    if (m.hanging) this.latch = true;
    this.speedBefore = len3(vel.x, vel.y, vel.z);
    this.corrLen = len3(corr.x, corr.y, corr.z);
    if (this.timing) this.costNow += performance.now() - t0;
  }

  /** One frame of the haul, with F held: the lip-over, the straight haul, its end at `minFree`. */
  private haul(b: GrappleBody, dt: number): void {
    const T = GRAPPLE_TUNE;
    const dist = this.haulDist;
    const rope = this.rope;
    const vel = b.vel;
    const hand = this.hand0;
    const piv = this.piv;
    // The haul's speed as progress makes it (`grapple.yank`): the tune's own while nothing grants it.
    const haulSpeed = this.stats.apply('grapple.yank', T.haul);
    // The lip-over is done once its bend has come out and the feet stand over the lip: the haul goes on toward
    // what is now first. The bend comes out while the feet are still a rope point's height under the lip (the
    // rope pulls at the hand), so its coming out alone is not the end: the haul would drive the body into the wall.
    if (this.lipping && rope.n < this.lipBend && b.pos.y >= this.lipY + T.lipClear) this.lipping = false;
    const free = rope.free();
    // The lip-over starts when the next step of the haul would reach the shortest: at 18 m/s a frame at 60 fps is
    // 0.3 m, and a step that ended inside `minFree` drives the body into the lip's wall before the lip-over sees it.
    const lipAt = T.minFree + Math.max(T.lipTrigger, haulSpeed * dt);
    // Never over the lip of a hull that moves (§3.6): the haul there ends hanging at `minFree` with the rope in.
    const still = this.pivotStill();
    if (!this.lipping && !this.lipGaveUp && rope.n > 0 && still && free <= lipAt && piv.y > hand.y && this.bendWalkable(rope.n)) {
      this.lipping = true;
      this.lipTime = 0;
      this.lipBend = rope.n;
      // Where the lip is, and the point the rope ran to before it, kept: the bend may come out on the way over.
      if (rope.hullPoints === 0) {
        const j = 3 * rope.n;
        const k = j - 3;
        this.lipY = rope.contact[j + 1];
        this.lipToX = rope.pts[k];
        this.lipToZ = rope.pts[k + 2];
      } else {
        // On a hull at rest, where the lip and the point before it stand in the world.
        this.lipY = rope.contactAt(rope.n, this.t2).y;
        rope.pointAt(rope.n - 1, this.t2);
        this.lipToX = this.t2.x;
        this.lipToZ = this.t2.z;
      }
    }
    if (this.lipping) {
      this.lipTime += dt;
      if (this.lipTime > T.lipMost) {
        // It never came out: give up, and leave the body hanging under the lip.
        this.lipping = false;
        this.lipGaveUp = true;
      } else {
        this.hauling = true;
        // The rope pays out as the body goes up and over, so it never pins the body into the corner.
        rope.length = Math.max(rope.length, rope.spent + dist + T.lipSlack);
        if (b.pos.y < this.lipY + T.lipClear) {
          vel.x = 0;
          vel.y = T.lipUp;
          vel.z = 0;
        } else {
          // Onto the top, toward the point before the bend, levelled.
          let ox = this.lipToX - hand.x;
          let oz = this.lipToZ - hand.z;
          const ol = len2(ox, oz) || 1;
          ox /= ol;
          oz /= ol;
          vel.x = ox * T.lipOver;
          vel.y = 0;
          vel.z = oz * T.lipOver;
        }
        return;
      }
    }
    // At the shortest the haul has ended, for as long as F stays held: it hangs there. The hand's own distance
    // this frame decides it as well as the free span, which follows the body down a frame behind; the frame it
    // ends the length comes down to where the hand is, so it hangs taut at the shortest rather than dropping onto it.
    if (free <= T.minFree + 0.02 || dist <= T.minFree + 0.02) {
      if (!this.haulEnded) rope.length = Math.max(rope.spent + T.minFree, Math.min(rope.length, rope.spent + dist));
      this.haulEnded = true;
      return;
    }
    this.hauling = true;
    // Toward a walkable anchor with nothing bent between, the rope point is aimed where the hand stands when
    // the feet arrive (the anchor plus `ropeY`), which never drives the body into the ground in its last metre.
    // Only on something still: a body never arrives standing on a hull that moves.
    let gx = piv.x - hand.x;
    let gy = piv.y - hand.y;
    let gz = piv.z - hand.z;
    const lift = rope.n === 0 && this.anchorWalkable && still;
    if (lift) gy += T.ropeY;
    const gl = len3(gx, gy, gz);
    if (gl > 1e-6) {
      const s = Math.min(haulSpeed, gl / dt) / gl;
      vel.x = gx * s;
      vel.y = gy * s;
      vel.z = gz * s;
      // On a hull, relative to it: the pivot's own velocity and the haul toward it.
      if (this.onHull) {
        vel.x += this.pivV.x;
        vel.y += this.pivV.y;
        vel.z += this.pivV.z;
      }
      // Aimed at the pivot itself, the haul's last step stops where the haul ends, `minFree` from it: a step of
      // 0.3 m at 60 fps and 0.6 at 30 that ended inside it drove the body into the face it was hauled to. What the
      // step falls short by is taken off the move (as the constraint's correction is), never off the velocity,
      // which keeps the haul's own speed for the arrival to take off on the frame it ends (§3.6).
      if (!lift) {
        const step = Math.min(haulSpeed * dt, gl);
        const most = Math.max(0, dist - T.minFree);
        if (step > most) {
          const k = (step - most) / gl;
          this.haulCut.x = gx * k;
          this.haulCut.y = gy * k;
          this.haulCut.z = gz * k;
        }
      }
    } else if (this.onHull) {
      vel.x = this.pivV.x;
      vel.y = this.pivV.y;
      vel.z = this.pivV.z;
    } else {
      vel.x = 0;
      vel.y = 0;
      vel.z = 0;
    }
    // The length follows the body down, never above what it was.
    rope.length = Math.max(rope.spent + T.minFree, Math.min(rope.length, rope.spent + dist));
  }

  /** Whether one of bend j's two faces is walkable (a normal at least as level as the controller's climb). */
  private bendWalkable(j: number): boolean {
    if (this.rope.pf[j] !== 0) return this.rope.faceUp(j) >= WALKABLE;
    return this.rope.face1[3 * j + 1] >= WALKABLE || this.rope.face2[3 * j + 1] >= WALKABLE;
  }

  /** The capsule's collider put where the body is, at its own offset, before the controller moves it (the 144 fps fault): on the rope, and in the fast flight after it. */
  private readonly syncAt = { x: 0, y: 0, z: 0 };
  syncCollider(b: GrappleBody): void {
    if (!(this.attached || this.released) || !GRAPPLE_TUNE.syncCollider) return;
    const s = this.syncAt;
    s.x = b.pos.x;
    s.y = b.pos.y + b.colliderOffsetY;
    s.z = b.pos.z;
    b.collider.setTranslation(s);
  }

  /**
   * After the controller has worked out its move (§3.1, 5): each contact's refused speed taken off the
   * velocity, measured relative to what was touched (nought for anything still, whose velocity is never
   * read), and its size kept as the impact. A steep contact says the body is against a wall. On the rope and
   * in the fast flight after it, the hardest contact into a wall is then judged as a slam (§3.11).
   */
  clip(b: GrappleBody, mv: { x: number; y: number; z: number } | null = null): void {
    this.onHullFloor = false;
    if (!this.attached && !this.released) return;
    const vel = b.vel;
    this.bodyVel = vel;
    // The flight ends in water, and as a roll or a special move begins (each writes the velocity of its own).
    if (this.released && (b.swimming || b.jka.rolling || b.jka.inSpecialJump)) {
      this.released = false;
      return;
    }
    const T = GRAPPLE_TUNE;
    const c = b.controller;
    this.lastImpact = 0;
    this.lastImpactHaul = false;
    this.wallTouch = false;
    // The hardest contact into a wall and into a floor this frame, for the slam rule after the loop.
    let wall = 0;
    let floor = 0;
    const n = c.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const hit = c.computedCollision(i, this.kept);
      if (!hit) continue;
      const nn = hit.normal1;
      this.n1.x = nn.x;
      this.n1.y = nn.y;
      this.n1.z = nn.z;
      let sv: { x: number; y: number; z: number } | null = null;
      const body = hit.collider?.parent();
      if (body && !body.isFixed()) {
        // A body that moves: its point velocity at the contact. Never asked of anything still.
        const l = body.linvel();
        const a = body.angvel();
        const t = body.translation();
        const px = b.pos.x - t.x;
        const py = b.pos.y + b.colliderOffsetY - t.y;
        const pz = b.pos.z - t.z;
        this.sv.x = l.x + a.y * pz - a.z * py;
        this.sv.y = l.y + a.z * px - a.x * pz;
        this.sv.z = l.z + a.x * py - a.y * px;
        sv = this.sv;
      }
      // Only a wall or a ceiling is clipped: the ground is the landing clamp's, and the controller hands back a
      // contact under the capsule's hemisphere with a normal tilted off the face it rests on (measured: 35 degrees
      // on a flat cuboid at 30 fps), whose clip kicked a walker on a taut line off the ground at 3 m/s. What such a
      // contact measures is the speed straight down into it, which a walk never has and a haul driven into the
      // ground does.
      const walkable = this.n1.y >= WALKABLE;
      let into: number;
      if (walkable) into = Math.max(0, -(sv ? vel.y - sv.y : vel.y));
      else into = T.clipRefused ? clipInto(vel, this.n1, sv, T.clipRelative, vel) : clipInto(vel, this.n1, sv, T.clipRelative, this.t1);
      if (into > this.lastImpact) {
        this.lastImpact = into;
        this.lastImpactHaul = this.hauling;
      }
      if (into > this.maxImpact) this.maxImpact = into;
      if (walkable) {
        if (into > floor) floor = into;
      } else if (into > wall) {
        wall = into;
        this.slamN.x = this.n1.x;
        this.slamN.y = this.n1.y;
        this.slamN.z = this.n1.z;
      }
      if (this.n1.y < WALKABLE && this.n1.y > -WALKABLE) {
        this.wallTouch = true;
        this.wallN.x = this.n1.x;
        this.wallN.y = this.n1.y;
        this.wallN.z = this.n1.z;
      }
    }
    // The hull test (wave 3, §3.18): every hull the rope rides and that moves, which the controller walked through, met
    // in its own frame; its move written over the controller's, its contacts clipped and measured against the hull's
    // own point velocity there, as every contact is. A method of its own, its hardest wall and floor handed through
    // fields, so what it calls is built into it and no number is boxed on the way. Another player's vehicle the rope rides
    // (wave 3c) is met the same way by the box test of the rope's own arithmetic, moving or not, since nothing else meets it
    // (`hullTest` false leaves the body to pass through it, as the wave first had it, to compare).
    if (mv && this.attached && ((b.hullController && this.hulls.markedCount > 0) || (T.hullTest && this.hulls.peersRidden > 0))) {
      this.clipWall = wall;
      this.clipFloor = floor;
      this.clipOnHulls(b, mv);
      wall = this.clipWall;
      floor = this.clipFloor;
    }
    // The slam rule, on what the clip measured: a wall at a swing's speed hurts and staggers; the haul's own push
    // (F held) and a floor (the fall rule's) are measured for the console and cost nothing.
    const hauling = this.hauling || this.keys.haul;
    if (wall > T.slamFrom && slamCounts(this.slamN.y, hauling)) {
      // Where it struck: the capsule's own side toward the wall (its radius out from its middle), which is what the
      // damage arc points at.
      const r = SLAM_REACH;
      this.slamAt(b, wall, this.attached ? 'swing' : 'released', b.pos.x - this.slamN.x * r, b.pos.y + b.colliderOffsetY - this.slamN.y * r, b.pos.z - this.slamN.z * r);
    } else if (wall > T.slamFrom) this.noteSlam(wall, 0, 'haul', false);
    else if (floor > T.slamFrom) this.noteSlam(floor, 0, 'floor', false);
    // The flight after a let-go ends once the body is slower than a slam.
    if (this.released && !releasedHolds(len3(vel.x, vel.y, vel.z), T)) this.released = false;
  }

  /** The hardest wall and floor the clip has met this frame, handed to and from `clipOnHulls`, and the clip's answer there. */
  private clipWall = 0.5;
  private clipFloor = 0.5;
  /**
   * The hull test met a walkable face of a hull the rope rides on the last clip: the body rests on a moving hull's floor,
   * which no controller grounds it on, so the next frame's step before the move holds the fall's apex there as it does on
   * the ground. Cleared at every clip and every let-go.
   */
  onHullFloor = false;
  private readonly clipRes: ClipAnswer = { into: 0.5 };

  /** The hull test over every marked hull and the box test over every peer's vehicle the rope rides, and their contacts clipped and measured as the controller's are (`clip`'s). */
  private clipOnHulls(b: GrappleBody, mv: { x: number; y: number; z: number }): void {
    const T = GRAPPLE_TUNE;
    const vel = b.vel;
    const hulls = this.hulls;
    hulls.clearContacts();
    const cs = this.capStart;
    cs[0] = b.pos.x;
    cs[1] = b.pos.y + b.colliderOffsetY;
    cs[2] = b.pos.z;
    hulls.testHalf = b.colliderOffsetY - SLAM_REACH;
    hulls.testRadius = SLAM_REACH;
    hulls.testFilter = b.filter;
    if (b.hullController) for (let i = 1; i <= MAX_HULL_FRAMES; i++) if (hulls.hull(i).marked) hulls.hullTest(i, b.collider, b.hullController, cs, mv);
    if (T.hullTest) for (let i = MAX_HULL_FRAMES + 1; i < hulls.slots.length; i++) if (hulls.peerRidden(i)) hulls.peerTest(i, cs, mv);
    const hc = hulls.contacts;
    const sv = this.sv;
    for (let k = 0; k < hc.n; k++) {
      const j = 3 * k;
      this.n1.x = hc.normal[j];
      this.n1.y = hc.normal[j + 1];
      this.n1.z = hc.normal[j + 2];
      sv.x = hc.pv[j];
      sv.y = hc.pv[j + 1];
      sv.z = hc.pv[j + 2];
      const walkable = this.n1.y >= WALKABLE;
      let into: number;
      if (walkable) {
        into = Math.max(0, -(vel.y - sv.y));
        // A hull's floor is this test's own landing clamp: the player's controller walked through the hull, so nothing
        // else takes a fall off a body resting on it, and gravity piled up under one lying on a moving pod's top to
        // 58 m/s in 3 s. The speed down into it, relative to the hull there, is taken off, and the fall's apex is held
        // from it the next frame (`onHullFloor`). The body is not called grounded: on a moving hull it never stands (§3.6),
        // since the ground's friction and keys are the still ground's, and it rides on as it hangs.
        if (into > 0 && T.clipRefused) vel.y = sv.y;
        this.onHullFloor = true;
      } else {
        // A hull's contact comes on few frames, so the call is not built in here: its answer comes back in a kept record.
        clipIntoRec(vel, this.n1, sv, T.clipRelative, T.clipRefused ? vel : this.t1, this.clipRes);
        into = this.clipRes.into;
      }
      if (into > this.lastImpact) {
        this.lastImpact = into;
        this.lastImpactHaul = this.hauling;
      }
      if (into > this.maxImpact) this.maxImpact = into;
      if (walkable) {
        if (into > this.clipFloor) this.clipFloor = into;
      } else if (into > this.clipWall) {
        this.clipWall = into;
        this.slamN.x = this.n1.x;
        this.slamN.y = this.n1.y;
        this.slamN.z = this.n1.z;
      }
      if (this.n1.y < WALKABLE && this.n1.y > -WALKABLE) {
        this.wallTouch = true;
        this.wallN.x = this.n1.x;
        this.wallN.y = this.n1.y;
        this.wallN.z = this.n1.z;
      }
    }
    const s = this.slipNow;
    s.pushed += hc.pushed;
    s.contacts += hc.n;
    s.calls += hc.calls;
    s.contactTests += hc.contactTests;
  }

  /**
   * The slam rule at `v` m/s into what was struck, at (`px`, `py`, `pz`): at most once in `slamGap`, the harm the
   * table says (`slamHarm`, the whole health past `slamKill`) taken as a fall's (`'fall'`: the world hurt the body,
   * so no fight opens and a roll's first instant never dodges it), and past `staggerFrom` the stagger, its shake and
   * its daze. The rope holds through it. Answers the harm. The console's `slam` asks it outright.
   */
  slamAt(b: GrappleBody, v: number, kind: SlamKind, px: number, py: number, pz: number): number {
    const T = GRAPPLE_TUNE;
    if (!(v > T.slamFrom)) {
      this.noteSlam(v, 0, kind, false);
      return 0;
    }
    // Within the gap the last slam stands, and so does the console's record of it.
    if (this.sinceSlam < T.slamGap) return 0;
    // A slam that came of another player's vehicle (the rope rides it, or this is the flight after such a rope) harms only
    // where that player could hurt this one (§3.11): damage between players is the server's switch, and a friend driving
    // through the rope is a blow between players by another road. The stagger, its shake and its daze play either way.
    const peer = this.slamPeer();
    const spared = peer !== 0 && !this.peerMayHurt(peer);
    const harm = spared ? 0 : slamHarm(v, b.hp, T);
    const took = harm > 0 && b.takeDamage(harm, false, 'fall');
    const staggers = staggerFor(v, T) > 0;
    if (staggers) this.staggerAge = 0;
    this.noteSlam(v, harm, kind, took);
    this.lastSlam.peer = peer;
    this.lastSlam.spared = spared;
    if (harm > 0 || staggers) {
      this.sinceSlam = 0;
      this.lastSlam.x = px;
      this.lastSlam.y = py;
      this.lastSlam.z = pz;
      this.counts.slams++;
    }
    return harm;
  }

  /** A contact the slam rule judged, kept for the console whether it cost anything or not. */
  private noteSlam(speed: number, harm: number, kind: SlamKind, took: boolean): void {
    const s = this.lastSlam;
    s.speed = speed;
    s.harm = harm;
    s.kind = kind;
    s.took = took;
    s.at = this.clock;
    s.peer = 0;
    s.spared = false;
  }

  /** Whose vehicle a slam now would have come of: the one the rope rides, or through the flight after it the one it rode; 0 for none. */
  private slamPeer(): number {
    return this.attached ? this.ropePeer() : this.released ? this.releasedPeer : 0;
  }

  /** Whether that player could hurt this one just now (`mayHurtPeer`); none hung, or a hook that throws, is no. */
  private peerMayHurt(id: number): boolean {
    const may = this.mayHurtPeer;
    if (!may) return false;
    try {
      return may(id) === true;
    } catch {
      return false;
    }
  }

  /** A stagger with its shake and daze and no harm: the console's, for judging the screen effect by eye. */
  staggerNow(): void {
    this.staggerAge = 0;
  }

  /**
   * The rest of the hook's frame, after the move (from wave 2): its clocks, the stagger's shake and daze, the catch's
   * jolt running out, the camera's pull eased toward the speed and back to 1 once the feet find ground, the drawn
   * lean eased toward the rope while swinging and back to upright otherwise (and the tail its turn is still sent for
   * once level), and the arm's weight and direction. The player's update calls it while anything of it is `lively`,
   * after `afterMove`; it moves no body.
   */
  look(b: GrappleBody, dt: number): void {
    const T = GRAPPLE_TUNE;
    this.bodyVel = b.vel;
    this.clock += dt;
    this.sinceSlam += dt;
    if (this.staggerAge !== Number.POSITIVE_INFINITY) {
      this.staggerAge += dt;
      if (this.staggerAge >= T.stagger && this.staggerAge >= T.shakeTime) this.staggerAge = Number.POSITIVE_INFINITY;
    }
    this.shakeNow = shakeAt(this.staggerAge, T);
    this.dazeNow = dazeAt(this.staggerAge, T);
    if (this.joltLeft > 0) {
      this.joltLeft -= dt;
      if (this.joltLeft <= 0) {
        this.joltLeft = 0;
        this.joltNow = 0;
      }
    }
    // The camera's pull: with the speed while the rope is out or the body has not come down since, then back to the
    // literal 1 within `camBack` of the feet finding ground.
    const vel = b.vel;
    if (this.state !== 'off' || this.released) this.camAirborne = true;
    else if (b.grounded || b.swimming) this.camAirborne = false;
    let s = this.camScaleNow;
    if (this.camAirborne) {
      const want = camScaleFor(len3(vel.x, vel.y, vel.z), T);
      s += (want - s) * (1 - Math.exp(-dt / T.camEase));
    } else if (s !== 1) {
      const rate = Math.max(0.05, Math.abs(T.camScale - 1)) / T.camBack;
      s = s > 1 ? Math.max(1, s - rate * dt) : Math.min(1, s + rate * dt);
    }
    this.camScaleNow = s;
    // The rope's first point from the rope point: the dart while it flies, the nearest bend or the anchor once in.
    const ropeY = T.ropeY;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (this.state === 'flying') {
      dx = this.dart[0] - b.pos.x;
      dy = this.dart[1] - (b.pos.y + ropeY);
      dz = this.dart[2] - b.pos.z;
    } else if (this.state === 'attached' || this.state === 'holding') {
      // Where `afterMove` left it this frame (`pivNow`).
      const p = this.pivNow;
      dx = p.x - b.pos.x;
      dy = p.y - (b.pos.y + ropeY);
      dz = p.z - b.pos.z;
    }
    const dl = len3(dx, dy, dz);
    if (dl > 1e-6) {
      this.armDir.x = dx / dl;
      this.armDir.y = dy / dl;
      this.armDir.z = dz / dl;
    }
    // The lean: toward the rope while swinging (never afloat, never on its feet), upright otherwise, at a rate that
    // takes the largest lean upright in `leanOut`, so it is never dropped in one frame.
    const tgt = this.leanTarget;
    if (this.state === 'attached' && this.modes.swinging && dl > 1e-6) {
      const d = this.lookDir;
      d.x = dx;
      d.y = dy;
      d.z = dz;
      leanOf(d, T, tgt);
    } else leanIdentity(tgt);
    const io = this.leanStep;
    io.step = leanRate(T) * dt;
    leanToward(this.lean, tgt, io, this.lean);
    this.leanAngle = leanAngleOf(this.lean);
    if (this.leanAngle < 1e-9 && tgt.w === 1) {
      leanIdentity(this.lean);
      this.leanAngle = 0;
    }
    // The tail on the wire: held full while the lean is past level, run down once it is level. Written only while it
    // moves, as the arm's weight is.
    if (this.leanAngle > (T.leanLevel * Math.PI) / 180) {
      if (this.leanTailLeft !== T.leanTail) this.leanTailLeft = T.leanTail;
    } else if (this.leanTailLeft > 0) this.leanTailLeft = this.leanTailLeft > dt ? this.leanTailLeft - dt : 0;
    // The arm: in over `armIn` while the hook is out, out over `armOut` after, keeping the last way it pointed.
    if (this.state !== 'off') {
      if (this.armWeight < 1) this.armWeight = Math.min(1, this.armWeight + dt / T.armIn);
    } else if (this.armWeight > 0) this.armWeight = Math.max(0, this.armWeight - dt / T.armOut);
  }

  /**
   * After the move, the grounded test and the landing clamp (§3.1, 6): the dart's trail while it flies, and
   * attached, the teleport guard, the carry round the rope, the wrapping, the anchor checked, the haul's
   * arrival, and the slide latch.
   */
  afterMove(b: GrappleBody, dt: number): void {
    const t0 = this.timing ? performance.now() : 0;
    const T = GRAPPLE_TUNE;
    this.sincePull += dt;
    // The tow (§3.18): a rope on a hull that pulled within `towHold`, which the next frame's words read as held for the slide.
    this.nums[0] = this.sincePull;
    this.towed = this.onHull && this.attached && towingIn(this.onHull, this.nums, T);
    // The slip's and the pull's tallies, a second at a time, for the console.
    this.secondLeft -= dt;
    if (this.secondLeft <= 0) this.rollSecond();
    if (this.state === 'flying') {
      if (!this.returning) this.keepTrail(b);
      if (this.timing) this.costNow += performance.now() - t0;
      this.noteCost();
      return;
    }
    if (this.state === 'holding') {
      this.stepThing(b, dt);
      if (this.state === 'holding') this.pivot(this.pivNow);
      if (this.timing) this.costNow += performance.now() - t0;
      this.noteCost();
      return;
    }
    if (this.state !== 'attached') {
      this.noteCost();
      return;
    }
    const rope = this.rope;
    const h1 = this.hand1;
    h1.x = b.pos.x;
    h1.y = b.pos.y + T.ropeY;
    h1.z = b.pos.z;
    const h0 = this.hand0;
    const moved = len3(h1.x - h0.x, h1.y - h0.y, h1.z - h0.z);
    if (teleported(moved, this.speedBefore, dt, this.corrLen, T)) {
      this.letGo('moved');
      this.noteCost();
      return;
    }
    // The carry: the velocity rebuilt round the rope from the angular momentum and radial speed the move kept.
    const piv = this.piv;
    // Only while it swings or floats: on its feet the movement owns the velocity and the rope only holds it in, and
    // a carry there turned a walk round the anchor by the rope's tilt, a few hundredths of a metre a second
    // downward, into the ground, which the controller then stepped up out of (measured at 30 fps).
    if (this.onHull) {
      // On a hull, relative to the pivot from where it stood at the frame's start to where it stands at its end, and on
      // the feet too: a hull dragging the rope is no walk round a still anchor, and a body it has just caught standing is
      // carried round it as the prototype measured. A turn the rope could not hold (`slipTurn`) is not carried, and the
      // rope pays out to where the hand went.
      rope.pointAt(rope.n, piv);
      if (this.slippingTurn) {
        const nx = h1.x - piv.x;
        const ny = h1.y - piv.y;
        const nz = h1.z - piv.z;
        const need = rope.spent + Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (rope.length < need) {
          this.nums[4] = need - rope.length;
          this.payOut();
        }
      } else if (this.con.taut && !this.hauling) this.con.follow(b.vel, h0, h1, this.piv0, piv, this.pivV);
    } else if (this.con.taut && !this.hauling && (this.modes.swinging || this.modes.afloat)) this.con.follow(b.vel, h0, h1, piv, piv);
    rope.track(h1);
    if (rope.hullPoints > 0 && !this.onHull) this.onHull = true;
    if (rope.fouled) {
      this.letGo('fouled');
      this.say?.('The line fouled and let go.');
      this.noteCost();
      return;
    }
    // The anchor: a collider that went (streamed out, rebuilt) is looked for again just behind it. (An anchor on a hull
    // goes with its hull, which `hullsHold` asks before anything is asked of the hull.)
    const a = rope.cols[0];
    if (rope.pf[0] === 0 && a && !a.isValid() && !rope.rebindAnchor()) {
      this.letGo('loose');
      this.say?.('The line came loose.');
      this.noteCost();
      return;
    }
    // The haul arriving on a walkable anchor that stands still: standing there, the rope lets go.
    if (this.keys.haul && this.anchorWalkable && rope.n === 0 && b.grounded && this.pivotStill()) {
      rope.pointAt(0, this.t2);
      const dx = b.pos.x - this.t2.x;
      const dz = b.pos.z - this.t2.z;
      if (len2(dx, dz) < T.arriveReach) {
        this.letGo('arrived');
        this.noteCost();
        return;
      }
    }
    // The towed floor (§3.18): the terrain's colliders stream round the player a few chunks out and a towed body crosses
    // a chunk every half second, so outdoors it never stands below the terrain's own height, as a vehicle never does.
    if (this.towed && !b.inside && Number.isFinite(b.ground) && b.pos.y < b.ground) {
      b.pos.y = b.ground;
      if (b.vel.y < 0) b.vel.y = 0;
    }
    // The slide latch: cleared on the ground by slack past `latchSlack` (the ground holding a scrape a few
    // centimetres inside its length is not slack) or by slowness, and afloat. Under a tow the rope is held.
    if (b.swimming) this.latch = false;
    else if (b.grounded) {
      this.pivot(piv);
      const held = this.con.taut || this.towed || rope.free() - len3(h1.x - piv.x, h1.y - piv.y, h1.z - piv.z) <= T.latchSlack;
      if (!held || len2(b.vel.x, b.vel.z) <= T.slideOver) this.latch = false;
    }
    this.pivot(this.pivNow);
    if (this.timing) this.costNow += performance.now() - t0;
    this.noteCost();
  }

  /**
   * Where the free span hangs from at the frame's end, kept by `afterMove` for `look`: worked out in `look` itself, the
   * pivot's way onto a hull (a branch and a call that a still rope never takes) was built into it and the rest of what it
   * builds in boxed the numbers it handed over, 23 B a frame on a still rope (measured in `grappleAllocOwn.ts`).
   */
  private readonly pivNow = { x: 0, y: 0, z: 0 };

  // --- a hooked prop (wave 3, §3.14) -----------------------------------------------------------------------

  /**
   * Hook a loose prop the dart struck at (x, y, z) on a face whose normal is n: the rope's end is kept in the prop's own
   * frame, at the very point struck (the prop is no wall the rope's casts meet, so it needs no offset off its face),
   * read off its mesh from now on; its recall count is noted; and the rope lands at the length it reaches, never more
   * than the range. It never bends, and nothing of the body is touched from here until it lets go.
   */
  attachThing(b: GrappleBody, prop: HookableProp, handle: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, collider: Collider | null, p: Physics): void {
    const T = GRAPPLE_TUNE;
    const rope = this.rope;
    rope.use(p.world, this.dartFilter, this.dartExclude);
    rope.attach(x, y, z, nx, ny, nz, collider, this.launch[0], this.launch[1], this.launch[2]);
    const m = prop.mesh;
    const rel = this.thingTo;
    rel.x = x - m.position.x;
    rel.y = y - m.position.y;
    rel.z = z - m.position.z;
    turnByQuat(m.quaternion, rel, true, this.thingLocal);
    const n = this.thingDir;
    n.x = nx;
    n.y = ny;
    n.z = nz;
    turnByQuat(m.quaternion, n, true, this.thingNormal);
    this.thing = prop;
    this.thingHandle = handle;
    this.thingRecalls = prop.recalls;
    this.state = 'holding';
    this.released = false;
    this.anchorPhysics = p;
    this.anchorWalkable = false;
    this.yanking = false;
    this.yankTime = 0;
    this.thingBlocked = 0;
    this.reelRun = 0;
    this.bodyVel = b.vel;
    this.speedBefore = len3(b.vel.x, b.vel.y, b.vel.z);
    this.con.reset();
    this.latch = false;
    this.hauling = false;
    this.haulEnded = false;
    this.lipping = false;
    this.lipGaveUp = false;
    this.wallTouch = false;
    this.sincePull = Infinity;
    this.counts.bites++;
    this.dart[0] = x;
    this.dart[1] = y;
    this.dart[2] = z;
    this.placeThingEnd();
    const h = this.thingHand;
    h.x = b.pos.x;
    h.y = b.pos.y + T.ropeY;
    h.z = b.pos.z;
    const pts = rope.pts;
    const reach = len3(pts[0] - h.x, pts[1] - h.y, pts[2] - h.z);
    this.thingDist = len3(m.position.x - h.x, m.position.y - h.y, m.position.z - h.z);
    rope.length = Math.min(this.range, Math.max(T.minFree, reach));
    // The rope's words stay the body's own: a hooked prop is never hanging, sliding, afloat or swinging.
    ropeModes(false, false, false, false, false, false, 0, T, this.modes);
  }

  /**
   * The rope's end carried onto the prop as it lies now: its place in the prop's own frame turned by the mesh's turn and
   * set on the mesh's place, and the face's normal turned with it, which the dart is drawn along. The pool writes the
   * mesh from the body for every awake prop and the grip's `holdAt` as it carries one, so nothing here asks the body.
   * The player's `drawGrapple` asks it again as the frame is drawn, so the rope ends on the prop as it is drawn.
   */
  placeThingEnd(): void {
    const thing = this.thing;
    if (!thing) return;
    const m = thing.mesh;
    const a = turnByQuat(m.quaternion, this.thingLocal, false, this.thingAt);
    const p = this.rope.pts;
    p[0] = m.position.x + a.x;
    p[1] = m.position.y + a.y;
    p[2] = m.position.z + a.z;
    const n = turnByQuat(m.quaternion, this.thingNormal, false, this.thingAt);
    const an = this.rope.anchorNormal;
    an[0] = n.x;
    an[1] = n.y;
    an[2] = n.z;
  }

  /**
   * One frame of a hooked prop, after the move: let go if the prop has gone with its pool or its world, was put back on
   * its stand, is past the stand's margin, has had its span blocked too long, or if the rope point moved further than a
   * frame allows; then the rope's end carried onto it, and F's yank toward the rope point or, with no F, the tether
   * dragging it once walked out past the rope's length. A body that never fired never comes here. Its lengths are worked
   * out in line rather than handed to `len3`: this frame holds enough calls that the compiler's budget for building them
   * in may not reach every one, and a number handed to a call that is not built in is a fresh number.
   */
  private stepThing(b: GrappleBody, dt: number): void {
    const T = GRAPPLE_TUNE;
    const thing = this.thing;
    const p = this.anchorPhysics;
    if (!thing || !p || p !== b.physics || p.broken) {
      this.letGo('world');
      return;
    }
    // The pool freed with its world, or the collider now somebody else's: the prop is no longer there to hold.
    if (this.propAt?.(this.thingHandle) !== thing) {
      this.letGo('loose');
      this.say?.('The line came loose.');
      return;
    }
    // Put back on its stand by the pool (thrown off the world, or dragged past `PROPS.lost`): the same body, elsewhere.
    if (thing.recalls !== this.thingRecalls) {
      this.letGo('recalled');
      this.say?.('The line came loose.');
      return;
    }
    const hx = b.pos.x;
    const hy = b.pos.y + T.ropeY;
    const hz = b.pos.z;
    // A place written without a reset (a later path that moves the player itself): let go, rather than drag the prop
    // after the body at the grip's speed from wherever it was left.
    const h0 = this.thingHand;
    const mx = hx - h0.x;
    const my = hy - h0.y;
    const mz = hz - h0.z;
    const moved = Math.sqrt(mx * mx + my * my + mz * mz);
    h0.x = hx;
    h0.y = hy;
    h0.z = hz;
    if (teleported(moved, this.speedBefore, dt, 0, T)) {
      this.letGo('moved');
      return;
    }
    const c = thing.mesh.position;
    // Short of where the pool would put it back: dragged into a recall it would be dragged again, and recalled again.
    const s = thing.stand;
    const sx = c.x - s.x;
    const sy = c.y - s.y;
    const sz = c.z - s.z;
    if (Math.sqrt(sx * sx + sy * sy + sz * sz) >= thing.lost - T.tetherStandMargin) {
      this.letGo('loose');
      this.say?.('The line came loose.');
      return;
    }
    this.placeThingEnd();
    const rope = this.rope;
    const pts = rope.pts;
    rope.hand[0] = hx;
    rope.hand[1] = hy;
    rope.hand[2] = hz;
    // The straight span, blocked by something still for longer than a moment, lets go: the rope to a prop never bends.
    if (rope.anchorSpanClear()) this.thingBlocked = 0;
    else {
      this.thingBlocked += dt;
      if (this.thingBlocked > T.tetherBlocked) {
        this.letGo('blocked');
        this.say?.('The line fouled and let go.');
        return;
      }
    }
    const cx = c.x - hx;
    const cy = c.y - hy;
    const cz = c.z - hz;
    this.thingDist = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const ax = pts[0] - hx;
    const ay = pts[1] - hy;
    const az = pts[2] - hz;
    const reach = Math.sqrt(ax * ax + ay * ay + az * az);
    const at = this.thingTo;
    if (this.keys.haul) {
      // The yank: toward a point `yankAhead` out along the view from the rope point, weightless, at the grip's own
      // speed, until the prop is within `arriveReach` of the rope point or `yankMost` has run.
      if (!this.yanking) {
        this.yanking = true;
        this.yankTime = 0;
      }
      this.yankTime += dt;
      const d = this.thingDir;
      const v = this.view;
      let dx = v.dirX;
      let dy = v.dirY;
      let dz = v.dirZ;
      let dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(dl > 1e-6)) {
        dx = cx;
        dy = cy;
        dz = cz;
        dl = this.thingDist || 1;
      }
      d.x = dx / dl;
      d.y = dy / dl;
      d.z = dz / dl;
      if (this.thingDist <= T.arriveReach || this.yankTime >= T.yankMost) {
        // Come in: stopped where its body stands (never held at its mesh's place, which in the game's frame is a physics
        // step behind the body, so such a hold throws it back out along its last step at the grip's speed), its weight
        // given back and tossed along the view at `yankToss` (nought: it drops where it is) with no lift, and the rope
        // lets go.
        thing.stop();
        thing.release(d, T.yankToss, 0);
        this.letGo('yanked');
        return;
      }
      at.x = hx + d.x * T.yankAhead;
      at.y = hy + d.y * T.yankAhead;
      at.z = hz + d.z * T.yankAhead;
      thing.holdAt(at, dt, true);
      // The length follows the prop in, never above what it was: F let go leaves it tethered where it got to.
      if (reach < rope.length) rope.length = Math.max(T.minFree, reach);
      return;
    }
    if (this.yanking) {
      // F let go mid-yank: the weight back at once, not a grip's lapse later, and the rope a tether again.
      this.yanking = false;
      this.yankTime = 0;
      thing.giveWeightBack();
    }
    // The tether: walked out past the rope's length, the prop is drawn back onto it along the rope, keeping its weight,
    // so the ground and its friction keep it down as it is dragged.
    const l = rope.length;
    if (reach > l && reach > 1e-6) {
      const k = (reach - l) / reach;
      at.x = c.x - ax * k;
      at.y = c.y - ay * k;
      at.z = c.z - az * k;
      thing.holdAt(at, dt, false);
    }
  }

  /** The hand's place kept while the dart flies, each time it has moved a chord; a full trail keeps every other point. */
  private keepTrail(b: GrappleBody): void {
    const T = GRAPPLE_TUNE;
    const tr = this.trail;
    const cap = tr.length / 3;
    const hx = b.pos.x;
    const hy = b.pos.y + T.ropeY;
    const hz = b.pos.z;
    const k = 3 * (this.trailCount - 1);
    if (len3(hx - tr[k], hy - tr[k + 1], hz - tr[k + 2]) <= T.chord) return;
    if (this.trailCount >= cap) {
      let w = 1;
      for (let r = 2; r < this.trailCount; r += 2) {
        tr[3 * w] = tr[3 * r];
        tr[3 * w + 1] = tr[3 * r + 1];
        tr[3 * w + 2] = tr[3 * r + 2];
        w++;
      }
      this.trailCount = w;
    }
    const j = 3 * this.trailCount;
    tr[j] = hx;
    tr[j + 1] = hy;
    tr[j + 2] = hz;
    this.trailCount++;
  }

  /** One frame of the dart's flight: home if it is coming home; else a ray over the step, and a bite, a refusal or on. */
  private flyDart(b: GrappleBody, dt: number): void {
    const T = GRAPPLE_TUNE;
    const hx = b.pos.x;
    const hy = b.pos.y + T.ropeY;
    const hz = b.pos.z;
    if (this.returning) {
      this.returnT += dt / T.missReturn;
      const t = Math.min(1, this.returnT);
      // Slack, it falls a little as it is reeled home.
      this.dart[0] = this.returnFrom[0] + (hx - this.returnFrom[0]) * t;
      this.dart[1] = this.returnFrom[1] + (hy - this.returnFrom[1]) * t - 2 * t * (1 - t);
      this.dart[2] = this.returnFrom[2] + (hz - this.returnFrom[2]) * t;
      if (t >= 1) {
        this.state = 'off';
        this.returning = false;
        this.muteOwed = true;
      }
      return;
    }
    const p = this.dartPhysics;
    if (!p || p !== b.physics || p.broken) {
      this.letGo('world');
      return;
    }
    const sx = this.dartVel[0] * dt;
    const sy = this.dartVel[1] * dt;
    const sz = this.dartVel[2] * dt;
    const step = len3(sx, sy, sz);
    if (step > 1e-9) {
      const r = this.ray;
      r.origin.x = this.dart[0];
      r.origin.y = this.dart[1];
      r.origin.z = this.dart[2];
      r.dir.x = sx / step;
      r.dir.y = sy / step;
      r.dir.z = sz / step;
      this.counts.casts++;
      this.castLen = step + T.lead;
      this.castFilter = this.dartFilter;
      this.castExclude = this.dartExclude;
      const hit = this.castPassing(p, r);
      // The hulls near (wave 3): the dart's path relative to each, from where it is at the frame's start to where it will
      // be at its end, taken into each hull's own frame; the first thing met by its share of the frame bites.
      if (GRAPPLE_TUNE.vehicles && this.hulls.any) {
        const a = this.segA;
        const e = this.segB;
        a[0] = this.dart[0];
        a[1] = this.dart[1];
        a[2] = this.dart[2];
        e[0] = a[0] + sx;
        e[1] = a[1] + sy;
        e[2] = a[2] + sz;
        if (this.hulls.castPath(p.world, a, e, T.lead, this.dartFilter, this.hullHit) && this.hullHit.share * step <= (hit ? hit.timeOfImpact : Infinity)) {
          this.counts.casts++;
          this.biteHull(b, p);
          return;
        }
      }
      if (hit) {
        const t = hit.timeOfImpact;
        const cx = r.origin.x + r.dir.x * t;
        const cy = r.origin.y + r.dir.y * t;
        const cz = r.origin.z + r.dir.z * t;
        const kind = this.classify(hit.collider, p);
        if (kindHolds(kind)) {
          this.bite(b, cx, cy, cz, hit.normal.x, hit.normal.y, hit.normal.z, hit.collider, p);
          return;
        }
        // A loose prop is hooked when the mass rule says the rope moves it (§3.14); one too heavy is refused in words.
        const prop = kind === 'prop' ? this.propAt?.(hit.collider.handle) : undefined;
        if (prop && this.whoMovesFor(prop.mass) === 'thing') {
          this.attachThing(b, prop, hit.collider.handle, cx, cy, cz, hit.normal.x, hit.normal.y, hit.normal.z, hit.collider, p);
          return;
        }
        if (prop) this.say?.('Too heavy to pull.');
        this.dart[0] = cx;
        this.dart[1] = cy;
        this.dart[2] = cz;
        this.counts.misses++;
        this.recall();
        return;
      }
    }
    this.dart[0] += sx;
    this.dart[1] += sy;
    this.dart[2] += sz;
    const flown = len3(this.dart[0] - this.launch[0], this.dart[1] - this.launch[1], this.dart[2] - this.launch[2]);
    const reach = len3(this.dart[0] - hx, this.dart[1] - hy, this.dart[2] - hz);
    const range = this.range;
    if (flown > range + T.missPad || reach > range) {
      this.counts.misses++;
      this.recall();
    }
  }

  /**
   * The dart bit: the rope is fastened with its hand end at the launch point, tracked along the hand's kept
   * path to where the hand is now (so bends swung round meanwhile are made as a swing makes them), and lands
   * at the length it reaches, never more than the range.
   */
  private bite(b: GrappleBody, x: number, y: number, z: number, nx: number, ny: number, nz: number, collider: Collider | null, p: Physics): void {
    const T = GRAPPLE_TUNE;
    const rope = this.rope;
    rope.use(p.world, this.dartFilter, this.dartExclude);
    rope.attach(x, y, z, nx, ny, nz, collider, this.launch[0], this.launch[1], this.launch[2]);
    const hx = b.pos.x;
    const hy = b.pos.y + T.ropeY;
    const hz = b.pos.z;
    const h1 = this.hand1;
    h1.x = hx;
    h1.y = hy;
    h1.z = hz;
    rope.trackPath(this.trail, this.trailCount, h1);
    this.pivot(this.piv);
    rope.length = Math.min(this.range, rope.spent + len3(hx - this.piv.x, hy - this.piv.y, hz - this.piv.z));
    this.fastened(b, x, y, z, ny, p);
  }

  /**
   * The dart bit a vehicle's hull (wave 3, §3.18): the anchor is kept in the hull's own frame, at the point the dart's
   * path relative to the hull met it. The hand's kept path was walked through the world while the hull moved under it,
   * so the span from the anchor to the hand is made clear where it stands now (bent at a plain hit if it is not) rather
   * than tracked along that path. The rope lands at the length it reaches, never more than the range.
   */
  private biteHull(b: GrappleBody, p: Physics): void {
    const T = GRAPPLE_TUNE;
    const rope = this.rope;
    const h = this.hullHit;
    rope.use(p.world, this.dartFilter, this.dartExclude);
    rope.attach(h.local[0], h.local[1], h.local[2], h.localN[0], h.localN[1], h.localN[2], h.collider, this.launch[0], this.launch[1], this.launch[2], h.slot);
    const hx = b.pos.x;
    const hy = b.pos.y + T.ropeY;
    const hz = b.pos.z;
    rope.place(hx, hy, hz);
    this.pivot(this.piv);
    rope.length = Math.min(this.range, rope.spent + len3(hx - this.piv.x, hy - this.piv.y, hz - this.piv.z));
    if (!this.hulls.isPeerSlot(h.slot)) {
      const slot = this.hulls.hull(h.slot);
      slot.refitsAt = slot.vehicle ? slot.vehicle.refits : 0;
    }
    this.fastened(b, h.world[0], h.world[1], h.world[2], h.worldN[1], p);
    // The rope keeps the hull in its slot from here; the hit's own hold on it goes.
    h.vehicle = null;
    h.collider = null;
    h.peer = 0;
    h.peerObj = null;
  }

  /** What every bite shares once the rope is fastened: the rope's words, its world and its clocks. */
  private fastened(b: GrappleBody, x: number, y: number, z: number, ny: number, p: Physics): void {
    const T = GRAPPLE_TUNE;
    const rope = this.rope;
    this.onHull = rope.hullPoints > 0;
    this.paidOut = 0;
    this.catchLeft = T.slipKeep;
    this.slippingTurn = false;
    this.towed = false;
    this.state = 'attached';
    this.released = false;
    this.reelRun = 0;
    this.bodyVel = b.vel;
    this.anchorPhysics = p;
    this.anchorWalkable = ny >= WALKABLE;
    this.con.reset();
    this.latch = false;
    this.hauling = false;
    this.haulEnded = false;
    this.lipping = false;
    this.lipGaveUp = false;
    this.wallTouch = false;
    this.sincePull = Infinity;
    this.counts.bites++;
    this.dart[0] = x;
    this.dart[1] = y;
    this.dart[2] = z;
    ropeModes(true, b.grounded, b.swimming, false, false, false, len2(b.vel.x, b.vel.z), T, this.modes);
    if (rope.fouled) {
      this.letGo('fouled');
      this.say?.('The line fouled and let go.');
    }
  }

  /**
   * What a collider the dart's ray met is, for whether the dart holds (§3.9). The passing kinds never reach here. A
   * vehicle's hull is asked before anything else that moves (a hull the rope marked walk-through is still a hull): a
   * rideable creature is a creature and refused (§15, question 15); any other hull is a `vehicle`, which holds, or with
   * `vehicles` off a moving thing, refused, as before the amendment. (With them on the world's cast never meets a hull:
   * each is cast in its own frame instead, and classed there.)
   */
  classify(c: Collider, p: Physics): MarkKind {
    const h = c.handle;
    if (p.isPane(h)) return 'pane';
    const body = c.parent();
    if (!body || body.isFixed()) return isTerrainCollider(c) ? 'terrain' : 'still';
    const v = this.vehicleOf?.(h) ?? null;
    if (v) return v.spec.animal ? 'creature' : GRAPPLE_TUNE.vehicles ? 'vehicle' : 'moving';
    if (p.isWall(h)) return 'door';
    if (this.propAt?.(h)) return 'prop';
    return 'moving';
  }

  /** Whether the world's cast must step past a hull (the vehicles' families find it in its own frame): any hull but a rideable creature's, with `vehicles` on. */
  private seenInFrame(h: number): boolean {
    if (!GRAPPLE_TUNE.vehicles) return false;
    const v = this.vehicleOf?.(h) ?? null;
    return !!v && !v.spec.animal;
  }

  /**
   * Where the dart would bite, after the camera has been placed (§3.8): a ray from the camera along the view,
   * starting at the orbit's own distance, then the segment from the hand to what it found; what that first
   * meets is the mark, judged by its kind, its distance from the hand and the drawn water. A lost mark is held
   * a moment and checked again from the hand. While attached it is the next anchor.
   *
   * What it reads is the kept `view`, which the caller writes first, and the water test is handed the point as a
   * kept object: this runs every frame on foot for a player who never fires as well, and a number handed to a call
   * that is not built into the caller is a fresh number (measured: 18 to 50 B a frame of the probe's own, its calls
   * and returns, before the numbers went into fields). `dt` passes straight through from the frame's own.
   */
  probeMark(physics: Physics, water: WaterTest | null, dt: number): GrappleMark {
    const T = GRAPPLE_TUNE;
    const mk = this.mark;
    const v = this.view;
    const hand = v.hand;
    mk.flash = Math.max(0, mk.flash - dt);
    mk.next = this.attached || this.holding;
    // The reach as progress makes it (`grapple.range`): the tune's own while nothing grants it.
    const range = this.range;
    this.passPhysics = physics;
    this.castFilter = v.filter;
    this.castExclude = v.exclude;
    const r = this.markRay;
    const start = Math.max(0, v.orbit);
    r.origin.x = v.eyeX + v.dirX * start;
    r.origin.y = v.eyeY + v.dirY * start;
    r.origin.z = v.eyeZ + v.dirZ * start;
    r.dir.x = v.dirX;
    r.dir.y = v.dirY;
    r.dir.z = v.dirZ;
    this.counts.casts++;
    this.castLen = range + T.probePad;
    const first = this.castPassing(physics, r);
    let found = false;
    // The vehicles near the ray (wave 3), each read again now, after the physics step, and led to the frame's end by what
    // is left in the accumulator, the ray cast in its own frame: a hull's point is kept in its own frame (§3.8, step 7).
    // Another player's vehicle (wave 3c) is its box at the pose the rope rides, by the rope's own arithmetic.
    const peersAbout = T.vehicles && !!v.peers && v.peers.list.length > 0;
    const hullsAbout = T.vehicles && (v.vehicles.length > 0 || peersAbout);
    let onHull = false;
    let pt = first ? first.timeOfImpact : Number.POSITIVE_INFINITY;
    let pHull = false;
    const mh = this.markHit;
    if (hullsAbout) {
      const o = this.segO;
      const d = this.segD;
      o[0] = r.origin.x;
      o[1] = r.origin.y;
      o[2] = r.origin.z;
      d[0] = v.dirX;
      d[1] = v.dirY;
      d[2] = v.dirZ;
      this.hulls.markLen = this.castLen;
      this.hulls.markFilter = v.filter;
      let met = this.hulls.markCast(physics, v.vehicles, o, d, mh);
      if (peersAbout && this.hulls.markCastPeers(v.peers, o, d, met, mh)) met = true;
      if (met && mh.toi < pt) {
        pt = mh.toi;
        pHull = true;
      }
    }
    if (pt < Number.POSITIVE_INFINITY) {
      const t = pt;
      const px = r.origin.x + v.dirX * t;
      const py = r.origin.y + v.dirY * t;
      const pz = r.origin.z + v.dirZ * t;
      const fnx = pHull ? mh.worldN[0] : first!.normal.x;
      const fny = pHull ? mh.worldN[1] : first!.normal.y;
      const fnz = pHull ? mh.worldN[2] : first!.normal.z;
      const fc = pHull ? mh.collider : first!.collider;
      // The hand's own line to it: what that meets first is where the dart would bite.
      const sg = this.sg;
      sg[0] = hand.x;
      sg[1] = hand.y;
      sg[2] = hand.z;
      sg[3] = px;
      sg[4] = py;
      sg[5] = pz;
      sg[6] = 0.05;
      const segHit = this.segment(physics);
      if (hullsAbout) {
        // And that line in each hull's own frame, nearer than whatever stands still on it.
        const o = this.segO;
        const d = this.segD;
        const hx = px - hand.x;
        const hy = py - hand.y;
        const hz = pz - hand.z;
        const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
        if (hl > 1e-4) {
          o[0] = hand.x;
          o[1] = hand.y;
          o[2] = hand.z;
          d[0] = hx / hl;
          d[1] = hy / hl;
          d[2] = hz / hl;
          this.hulls.markLen = hl + 0.05;
          this.hulls.markFilter = v.filter;
          let met = this.hulls.markCast(physics, v.vehicles, o, d, mh);
          if (peersAbout && this.hulls.markCastPeers(v.peers, o, d, met, mh)) met = true;
          if (met && (!segHit || mh.toi < this.hit.toi)) onHull = true;
          else if (!segHit && pHull) onHull = true;
        } else if (!segHit && pHull) onHull = true;
      }
      if (onHull) {
        // Where the hull's line (or the camera's, which the hand's line met nothing short of) met the hull.
        this.t1.x = mh.world[0];
        this.t1.y = mh.world[1];
        this.t1.z = mh.world[2];
        this.hit.nx = mh.worldN[0];
        this.hit.ny = mh.worldN[1];
        this.hit.nz = mh.worldN[2];
        this.hit.collider = mh.collider;
        found = true;
      } else if (segHit) {
        found = true;
      } else {
        const hx = px - hand.x;
        const hy = py - hand.y;
        const hz = pz - hand.z;
        this.hit.toi = Math.sqrt(hx * hx + hy * hy + hz * hz);
        this.hit.nx = fnx;
        this.hit.ny = fny;
        this.hit.nz = fnz;
        this.hit.collider = fc;
        this.t1.x = px;
        this.t1.y = py;
        this.t1.z = pz;
        found = true;
      }
    }
    // Another player's vehicle is met as its box, which has no collider.
    const onPeer = onHull && mh.peer !== 0;
    if (found && (this.hit.collider || onPeer)) {
      const bx = this.t1.x;
      const by = this.t1.y;
      const bz = this.t1.z;
      let kind: MarkKind = onHull ? 'vehicle' : this.classify(this.hit.collider!, physics);
      if (kindBites(kind) && water?.(this.t1)) kind = 'water';
      const ex = bx - hand.x;
      const ey = by - hand.y;
      const ez = bz - hand.z;
      const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
      mk.kind = kind;
      mk.distance = dist;
      // Its numbers go to the range test in a kept record, never as arguments (`MarkReach`).
      const reach = this.markReach;
      reach.dist = dist;
      reach.range = range;
      if (markShows(kind, reach, T)) {
        mk.shows = true;
        mk.held = false;
        mk.x = bx;
        mk.y = by;
        mk.z = bz;
        mk.nx = this.hit.nx;
        mk.ny = this.hit.ny;
        mk.nz = this.hit.nz;
        mk.collider = this.hit.collider;
        mk.holdLeft = T.snapHold;
        if (onHull) this.markOnHull(mh);
        else if (mk.vehicle || mk.peer) this.markOffHull();
        this.forgetHullHits();
        return mk;
      }
    } else {
      mk.kind = 'none';
      mk.distance = 0;
    }
    // Nothing shown: the last good mark is held a moment, checked again from the hand. Held on a hull, it is carried
    // with the hull, read again where it stands now; a hull gone takes the hold with it. So on another player's vehicle.
    if (mk.holdLeft > 0 && (mk.vehicle || mk.peer)) {
      const lc = this.segO;
      lc[0] = mk.lx;
      lc[1] = mk.ly;
      lc[2] = mk.lz;
      const held = mk.vehicle ? this.hulls.markPoint(physics, mk.vehicle, lc, this.segA, this.segD) : !!mk.peerObj && this.hulls.markPeerPoint(v.peers, mk.peer, mk.peerObj, lc, this.segA, this.segD);
      if (held) {
        mk.x = this.segA[0];
        mk.y = this.segA[1];
        mk.z = this.segA[2];
        mk.tvx = this.segD[0];
        mk.tvy = this.segD[1];
        mk.tvz = this.segD[2];
      } else mk.holdLeft = 0;
    }
    if (mk.holdLeft > 0 && (mk.peer !== 0 || (mk.collider && mk.collider.isValid()))) {
      mk.holdLeft -= dt;
      const ex = mk.x - hand.x;
      const ey = mk.y - hand.y;
      const ez = mk.z - hand.z;
      const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
      // The hand's line to it meets it (or nothing, short of it by less than a hair).
      const sg = this.sg;
      sg[0] = hand.x;
      sg[1] = hand.y;
      sg[2] = hand.z;
      sg[3] = mk.x;
      sg[4] = mk.y;
      sg[5] = mk.z;
      sg[6] = 0;
      const blocked = this.segment(physics) && this.hit.toi < dist - 0.05;
      if (mk.holdLeft > 0 && !blocked && dist >= T.minRange && dist <= range) {
        mk.shows = true;
        mk.held = true;
        this.forgetHullHits();
        return mk;
      }
    }
    mk.holdLeft = 0;
    mk.shows = false;
    mk.held = false;
    mk.collider = null;
    if (mk.vehicle || mk.peer) this.markOffHull();
    this.forgetHullHits();
    return mk;
  }

  /** The mark rests on a hull (or another player's vehicle): its point in that frame, and the point velocity there, kept. */
  private markOnHull(h: { readonly vehicle: Vehicle | null; readonly peer: number; readonly peerObj: PeerPicture | null; readonly local: Float64Array; readonly pv: Float64Array }): void {
    const mk = this.mark;
    mk.vehicle = h.vehicle;
    mk.peer = h.peer;
    mk.peerObj = h.peerObj;
    mk.lx = h.local[0];
    mk.ly = h.local[1];
    mk.lz = h.local[2];
    mk.tvx = h.pv[0];
    mk.tvy = h.pv[1];
    mk.tvz = h.pv[2];
  }

  private markOffHull(): void {
    const mk = this.mark;
    mk.vehicle = null;
    mk.peer = 0;
    mk.peerObj = null;
    mk.tvx = 0;
    mk.tvy = 0;
    mk.tvz = 0;
    this.forgetHullHits();
  }

  /**
   * The dart's and the mark's last hit on a hull let go of once used: each holds the vehicle and its collider it met,
   * and a travel or the select screen would otherwise keep a disposed hull (its group, its model, its fight) until the
   * next hull was met.
   */
  private forgetHullHits(): void {
    this.hullHit.vehicle = null;
    this.hullHit.collider = null;
    this.hullHit.peerObj = null;
    this.markHit.vehicle = null;
    this.markHit.collider = null;
    this.markHit.peerObj = null;
  }

  /** What the dart is aimed true against: the mark's hull's point velocity, or null on anything still. Kept. */
  private readonly markTargetV = { x: 0, y: 0, z: 0 };
  /** The mark's point placed on another player's picture, kept. */
  private readonly drawnAt = new Float64Array(3);
  markTarget(): { readonly x: number; readonly y: number; readonly z: number } | null {
    const mk = this.mark;
    if (!mk.vehicle && !mk.peer) return null;
    this.markTargetV.x = mk.tvx;
    this.markTargetV.y = mk.tvy;
    this.markTargetV.z = mk.tvz;
    return this.markTargetV;
  }

  /**
   * Point i of the rope where it is drawn (§3.12): a point on a hull at the hull's drawn pose (its group, written from
   * its body before the frame's physics step), so the drawn rope stays on the drawn hull; any other where it is. Into
   * `out` at `o`. The drawn hull jumps by its speed over a physics step every second or third frame at 144 fps against a
   * player drawn where the player is: that is the game's own stutter of every fast vehicle, not the rope's.
   */
  drawnPoint(i: number, out: Float64Array, o: number): void {
    const rope = this.rope;
    const k = 3 * i;
    const fi = rope.pf[i];
    // On another player's vehicle (wave 3c), on their picture as it is drawn: the rope ends on the hull everybody sees, its
    // length breathing against the picture's own jerks, which are every observer's today.
    if (fi > MAX_HULL_FRAMES) {
      const pic = this.hulls.peerFrame(fi).ps.obj;
      if (pic) {
        placeOn(pic, rope.pts[k], rope.pts[k + 1], rope.pts[k + 2], out, o);
        return;
      }
    }
    const v = fi !== 0 && fi <= MAX_HULL_FRAMES ? this.hulls.hull(fi).vehicle : null;
    if (!v) {
      if (fi === 0) {
        out[o] = rope.pts[k];
        out[o + 1] = rope.pts[k + 1];
        out[o + 2] = rope.pts[k + 2];
      } else {
        rope.pointAt(i, this.t1);
        out[o] = this.t1.x;
        out[o + 1] = this.t1.y;
        out[o + 2] = this.t1.z;
      }
      return;
    }
    const g = v.group;
    const q = g.quaternion;
    const x = rope.pts[k];
    const y = rope.pts[k + 1];
    const z = rope.pts[k + 2];
    const tx = 2 * (q.y * z - q.z * y);
    const ty = 2 * (q.z * x - q.x * z);
    const tz = 2 * (q.x * y - q.y * x);
    out[o] = g.position.x + x + q.w * tx + (q.y * tz - q.z * ty);
    out[o + 1] = g.position.y + y + q.w * ty + (q.z * tx - q.x * tz);
    out[o + 2] = g.position.z + z + q.w * tz + (q.x * ty - q.y * tx);
  }

  /** Every point of the rope where it is drawn (`drawnPoint`), into `out`: the anchor first. */
  drawnPoints(out: Float64Array): Float64Array {
    for (let i = 0; i <= this.rope.n; i++) this.drawnPoint(i, out, 3 * i);
    return out;
  }

  /** The anchor's normal where it is drawn: on a hull turned by the hull's drawn turn. Into `out`. */
  anchorNormalDrawn<V extends { x: number; y: number; z: number }>(out: V): V {
    const rope = this.rope;
    const x = rope.anchorNormal[0];
    const y = rope.anchorNormal[1];
    const z = rope.anchorNormal[2];
    const fi = rope.pf[0];
    const pic = fi > MAX_HULL_FRAMES ? this.hulls.peerFrame(fi).ps.obj : null;
    const v = fi !== 0 && fi <= MAX_HULL_FRAMES ? this.hulls.hull(fi).vehicle : null;
    if (!v && !pic) {
      out.x = x;
      out.y = y;
      out.z = z;
      return out;
    }
    const q = pic ? pic.quaternion : v!.group.quaternion;
    const tx = 2 * (q.y * z - q.z * y);
    const ty = 2 * (q.z * x - q.x * z);
    const tz = 2 * (q.x * y - q.y * x);
    out.x = x + q.w * tx + (q.y * tz - q.z * ty);
    out.y = y + q.w * ty + (q.z * tx - q.x * tz);
    out.z = z + q.w * tz + (q.x * ty - q.y * tx);
    return out;
  }

  /**
   * The rope as it goes to other players (§3.15), worked out at the moment of sending, ten times a second at most, so it
   * makes its two lists freely: null with nothing out. The dart flying is `[0, x, y, z, vx, vy, vz]` (coming home, its
   * velocity is the way home over what is left of `missReturn`); a loose prop on the line is sent as the dart coming
   * home, its end on the prop with `thingVel`, the end's own velocity as the caller measured it between states, since
   * the others have no such prop. A rope held is `[1, slack, anchor, bends...]`, every point a world point where it is
   * drawn (a point on a hull at the hull's drawn pose, on another player's vehicle at this browser's picture of it), cut
   * to `most` at the anchor's end: the anchor and the bends nearest the hand are kept, and the far side draws straight
   * from the last kept bend to the anchor. Beside it, `grf` gives every kept point that rides another player's vehicle
   * as `[1, their relay id, its index in gr, its place in that vehicle's own frame]`, so each watcher puts it on its own
   * picture of the hull; a point on a vehicle nobody else has (this browser's own) goes as the world point alone.
   */
  wireRope(b: GrappleBody, most: number, thingVel: { readonly x: number; readonly y: number; readonly z: number }): { gr: number[]; grf: number[] | null } | null {
    // To the centimetre, as the rest of the state is (written without the bare number the stat table's test looks for).
    const n2 = (n: number) => Number(n.toFixed(2));
    if (this.state === 'flying') {
      let vx = this.dartVel[0];
      let vy = this.dartVel[1];
      let vz = this.dartVel[2];
      if (this.returning) {
        const left = Math.max(0.01, (1 - Math.min(1, this.returnT)) * GRAPPLE_TUNE.missReturn);
        vx = (b.pos.x - this.dart[0]) / left;
        vy = (b.pos.y + GRAPPLE_TUNE.ropeY - this.dart[1]) / left;
        vz = (b.pos.z - this.dart[2]) / left;
      }
      return { gr: [0, n2(this.dart[0]), n2(this.dart[1]), n2(this.dart[2]), n2(vx), n2(vy), n2(vz)], grf: null };
    }
    if (this.state === 'holding') {
      const p = this.rope.pts;
      return { gr: [0, n2(p[0]), n2(p[1]), n2(p[2]), n2(thingVel.x), n2(thingVel.y), n2(thingVel.z)], grf: null };
    }
    if (this.state !== 'attached') return null;
    const rope = this.rope;
    const points = rope.n + 1;
    const keep = Math.max(1, Math.min(Math.round(most), points));
    // The anchor, then the bends nearest the hand: a rope past the cap loses the bends next to its anchor.
    const firstBend = points - keep + 1;
    const gr: number[] = [1, n2(Math.max(0, this.slack(b)))];
    let grf: number[] | null = null;
    const at = this.drawnAt;
    for (let i = 0, k = 0; i < points; i++) {
      if (i > 0 && i < firstBend) continue;
      this.drawnPoint(i, at, 0);
      gr.push(n2(at[0]), n2(at[1]), n2(at[2]));
      const fi = rope.pf[i];
      if (fi > MAX_HULL_FRAMES) {
        const id = this.hulls.peerFrame(fi).ps.id;
        if (id > 0) (grf ??= []).push(1, id, k, n2(rope.pts[3 * i]), n2(rope.pts[3 * i + 1]), n2(rope.pts[3 * i + 2]));
      }
      k++;
    }
    return { gr, grf };
  }

  /** The mark's point where it is drawn: on a hull at the hull's drawn pose, else where it is. Into `out`. */
  markDrawn(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const mk = this.mark;
    // On another player's vehicle (wave 3c), on their picture as it is drawn.
    if (mk.peer && mk.peerObj) {
      placeOn(mk.peerObj, mk.lx, mk.ly, mk.lz, this.drawnAt, 0);
      out.x = this.drawnAt[0];
      out.y = this.drawnAt[1];
      out.z = this.drawnAt[2];
      return out;
    }
    const v = mk.vehicle;
    if (!v) {
      out.x = mk.x;
      out.y = mk.y;
      out.z = mk.z;
      return out;
    }
    const g = v.group;
    const q = g.quaternion;
    const x = mk.lx;
    const y = mk.ly;
    const z = mk.lz;
    const tx = 2 * (q.y * z - q.z * y);
    const ty = 2 * (q.z * x - q.x * z);
    const tz = 2 * (q.x * y - q.y * x);
    out.x = g.position.x + x + q.w * tx + (q.y * tz - q.z * ty);
    out.y = g.position.y + y + q.w * ty + (q.z * tx - q.x * tz);
    out.z = g.position.z + z + q.w * tz + (q.x * ty - q.y * tx);
    return out;
  }

  /**
   * The first thing on the segment in the kept `sg` (from a toward b, and `sg[6]` past b), passing what the dart
   * passes, with the filter and the body the probe set: into `hit` and `t1`.
   */
  private segment(physics: Physics): boolean {
    const sg = this.sg;
    const ax = sg[0];
    const ay = sg[1];
    const az = sg[2];
    const dx = sg[3] - ax;
    const dy = sg[4] - ay;
    const dz = sg[5] - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 1e-4)) return false;
    const r = this.ray;
    r.origin.x = ax;
    r.origin.y = ay;
    r.origin.z = az;
    r.dir.x = dx / len;
    r.dir.y = dy / len;
    r.dir.z = dz / len;
    this.counts.casts++;
    this.castLen = len + sg[6];
    const h = this.castPassing(physics, r);
    if (!h) return false;
    const t = h.timeOfImpact;
    this.hit.toi = t;
    this.hit.nx = h.normal.x;
    this.hit.ny = h.normal.y;
    this.hit.nz = h.normal.z;
    this.hit.collider = h.collider;
    this.t1.x = ax + r.dir.x * t;
    this.t1.y = ay + r.dir.y * t;
    this.t1.z = az + r.dir.z * t;
    return true;
  }

  /**
   * The dart's and the mark's ray, its reach, filter and the body it never meets in the kept `castLen`, `castFilter`
   * and `castExclude`: cast with no predicate, and again with the pass-through one only when what it met first is a
   * thing they pass over (a corpse, a walk-through, another player). The answer is the one a single cast with the
   * predicate gives (the nearest of all that passes the predicate is the nearest of all), and a frame whose ray meets
   * nothing to pass over calls back into script for none of the colliders its ray's box goes by.
   */
  private castPassing(physics: Physics, r: RAPIER_NS.Ray): RAPIER_NS.RayColliderIntersection | null {
    this.passPhysics = physics;
    const w = physics.world;
    const flags = this.R.QueryFilterFlags.EXCLUDE_SENSORS;
    const ex = this.castExclude ?? undefined;
    const h = w.castRayAndGetNormal(r, this.castLen, true, flags, this.castFilter, undefined, ex);
    if (!h || this.dartPass(h.collider)) return h;
    return w.castRayAndGetNormal(r, this.castLen, true, flags, this.castFilter, undefined, ex, this.dartPass);
  }

  /** How many of the rope's spans are blocked right now, cast on request: it must be nought. */
  blocked(b: GrappleBody): number {
    if ((!this.attached && !this.holding) || !this.worldOk(b)) return 0;
    return this.rope.blockedNow(b.pos.x, b.pos.y + GRAPPLE_TUNE.ropeY, b.pos.z);
  }

  private noteCost(): void {
    if (!this.timing) return;
    const us = this.costNow * 1000;
    this.cost[this.costAt] = us;
    this.costAt = (this.costAt + 1) % COST_FRAMES;
    if (this.costN < COST_FRAMES) this.costN++;
    this.costNow = 0;
  }

  /** The median and p99 of the rope's own work over the last frames it was out, in µs (for the console: it sorts a copy). */
  costReport(): { median: number; p99: number; frames: number } {
    const n = this.costN;
    if (!n) return { median: 0, p99: 0, frames: 0 };
    const a = Array.from(this.cost.subarray(0, n)).sort((x, y) => x - y);
    return { median: Number(a[Math.floor(n / 2)].toFixed(2)), p99: Number(a[Math.min(n - 1, Math.floor(n * 0.99))].toFixed(2)), frames: n };
  }
}
