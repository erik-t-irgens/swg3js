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
// A player who never fires plays exactly as before: every line the player's update adds for this is behind
// `out`, and everything that touches the body behind `attached`. Every number here is in `GRAPPLE_TUNE` and
// moves live through `__debug.grapple({ tune })`.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/physics.ts';
import { JKA, UNIT } from './jkaMove.ts';
import { GrappleRope, RopeConstraint, isTerrainCollider } from './grappleRope.ts';
import { SWIM_DEPTH } from './swimStep.ts';
import type { HarmKind } from './harmRule.ts';
import {
  GRAPPLE_RELEASE_MUTES,
  WALKABLE,
  aimTrue,
  camScaleFor,
  clipInto,
  dazeAt,
  grappleMutes,
  gravityAddBack,
  joltFor,
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
  wadeDragOf,
  wallFrictionSpare,
  type LeanQuat,
  type LeanStep,
  type MarkKind,
  type RopeModes,
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
  // --- others and the item -----------------------------------------------------------------------------
  /** The points a rope sends to other players (when it is sent at all): at most the wire's sixteen. */
  sendPoints: 16,
  /** [owner: "for now"] Every character can fire, owning a rig or not. */
  everyone: true,
};

export type GrappleTune = typeof GRAPPLE_TUNE;

/** The table as it ships, for `__debug.grapple({ reset: true })`. */
export const GRAPPLE_DEFAULTS: Readonly<GrappleTune> = Object.freeze({ ...GRAPPLE_TUNE });

/** The wire's own cap on a rope's points (`WIRE.ropePoints` on the server, when it carries ropes). */
export const ROPE_WIRE_POINTS = 16;

/** The game's own gravity (Jedi Academy's 800 u/s², whatever the planet). */
export const GRAPPLE_GRAVITY = JKA.gravity * UNIT;

/** How far out from the capsule's middle a slam strikes: the player's capsule's radius (`player.ts`'s `CAPSULE_RADIUS`). */
const SLAM_REACH = 0.35;

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
  lookHook?.();
  return G;
}

/** The table back as it ships. */
export function resetGrappleTune(): GrappleTune {
  Object.assign(GRAPPLE_TUNE, GRAPPLE_DEFAULTS);
  lookHook?.();
  return GRAPPLE_TUNE;
}

export type GrappleState = 'off' | 'flying' | 'attached';

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
  | 'console';

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
}

export function newFireState(): GrappleFireState {
  return { mounted: false, piloting: false, noclip: false, eva: false, aboard: false, riding: false, jump: false, dead: false, placing: false, talking: false, prone: false, kneeling: false, rolling: false, special: false, swgProfile: false, stepped: true };
}

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
}

/** How many frames of the rope's own cost are kept for the console's median and p99. */
const COST_FRAMES = 600;


export class Grapple {
  private readonly R: R;
  state: GrappleState = 'off';
  readonly rope: GrappleRope;
  readonly con = new RopeConstraint();
  readonly modes: RopeModes = newRopeModes();
  readonly keys: GrappleKeys = { reelIn: false, reelOut: false, haul: false, swayX: 0, swayZ: 0 };
  readonly mark: GrappleMark = { shows: false, held: false, next: false, kind: 'none', distance: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, collider: null, holdLeft: 0, flash: 0 };
  /** What the next `probeMark` reads, written by the caller (numbers in fields, never handed to the call). */
  readonly view: MarkView = { eyeX: 0.5, eyeY: 0.5, eyeZ: 0.5, dirX: 0.5, dirY: 0.5, dirZ: 0.5, orbit: 0.5, hand: { x: 0, y: 0, z: 0 }, filter: 0, exclude: null };
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
  lastLetGo: LetGoReason | '' = '';
  /** One-shot words for the message line: the game hangs the line here. */
  say: ((text: string) => void) | null = null;
  /** Whether a dynamic collider is a loose prop, for the mark's word (the game hangs the props' lookup here). */
  isProp: ((handle: number) => boolean) | null = null;

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
  readonly lastSlam = { speed: 0, harm: 0, at: Number.NEGATIVE_INFINITY, kind: '' as SlamKind, took: false, x: 0, y: 0, z: 0 };
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
  private readonly sv = { x: 0, y: 0, z: 0 };
  private readonly n1 = { x: 0, y: 0, z: 0 };
  private readonly aimOut = { x: 0, y: 0, z: 0 };
  private readonly hit = { toi: 0, nx: 0, ny: 0, nz: 0, collider: null as Collider | null };
  /** A segment the probe casts (a, then b, then how far past b), and the next cast's reach, filter and excluded body, kept. */
  private readonly sg = new Float64Array(7);
  private castLen = 0.5;
  private castFilter = 0;
  private castExclude: RAPIER_NS.RigidBody | null = null;
  private passPhysics: Physics | null = null;
  /** What the dart's ray and the mark's pass over: a corpse, a follower, another player. Kept, not made per call. */
  private readonly dartPass = (c: Collider): boolean => {
    const p = this.passPhysics;
    if (!p) return true;
    const h = c.handle;
    return !p.isRagdoll(h) && !p.isWalkThrough(h) && !p.isPeer(h);
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

  /** The free span's slack: the free length less the hand's distance to the pivot. */
  slack(b: GrappleBody): number {
    if (!this.attached) return 0;
    this.pivot(this.piv);
    const T = GRAPPLE_TUNE;
    return this.rope.free() - len3(b.pos.x - this.piv.x, b.pos.y + T.ropeY - this.piv.y, b.pos.z - this.piv.z);
  }

  /** The rope's first point from the hand: the nearest bend, else the anchor. */
  pivot(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return this.rope.pointAt(this.rope.n, out);
  }

  /** The words of the rope from the body as it stands: once a frame before the movement, and by the key block. */
  refreshModes(b: GrappleBody): RopeModes {
    this.bodyVel = b.vel;
    const held = this.attached && !this.con.taut && this.slack(b) <= GRAPPLE_TUNE.latchSlack;
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

  /** What the action bar says of the hook: nothing while it is not out, `flying`, or attached `air` (swinging) and `ground`. */
  promptWord(): '' | 'flying' | 'ground' | 'air' {
    if (this.state === 'off') return '';
    if (this.state === 'flying') return 'flying';
    return this.modes.swinging ? 'air' : 'ground';
  }

  /** Why a shot would be refused just now, or '' when it would be fired (with the mark showing). */
  refusal(s: GrappleFireState): string {
    if (!GRAPPLE_TUNE.everyone) return 'no rig';
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
  }

  /**
   * Fire the dart at a point the mark found: aimed so that, carrying the shooter's velocity, it flies the
   * straight segment from the hand to the point (or along the view, when no such aim exists or the console
   * asks). It flies at `speed`, straight, and bites what it first meets that may hold it.
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
  ): void {
    const T = GRAPPLE_TUNE;
    let ex = atX - hand.x;
    let ey = atY - hand.y;
    let ez = atZ - hand.z;
    const el = len3(ex, ey, ez) || 1;
    ex /= el;
    ey /= el;
    ez /= el;
    const k = T.aim === 'true' ? aimTrue(ex, ey, ez, vel.x, vel.y, vel.z, T.speed, this.aimOut) : 0;
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
    if (length > 0 && this.attached) this.rope.length = Math.min(T.range, length);
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
   * once). Never the crouch: an X held from reeling out into the landing is Jedi Academy's landing roll.
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
      }
    }
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
   * jump); then the fire key fires (`fire`, the caller's, which checks the mark and the refusals), calls the dart
   * back or lets go, and Space boosts off while swinging, a let-go made here muting at once; and the held reels
   * and the haul are kept for the frame's steps. `mutes` is the caller's kept list.
   */
  stepKeys(input: GrappleKeyInput, b: GrappleBody, mutes: string[], fire: () => void): void {
    this.bodyVel = b.vel;
    if (this.muteOwed) {
      input.muteUntilUp(GRAPPLE_RELEASE_MUTES);
      this.muteOwed = false;
    }
    if (this.out) this.refreshModes(b);
    if (grappleMutes(mutes, this.out, this.out && this.modes.swinging)) input.mute(mutes);
    if (input.pressedAction('grappleFire')) {
      if (this.attached) this.letGo('fire');
      else if (this.flying) {
        this.recall();
        this.counts.recalls++;
      } else fire();
    }
    // A slam's stagger takes the boost, the reels and the haul for its half second (the sway in `beforeMove`).
    const steady = !this.staggered;
    if (this.attached && this.modes.swinging && steady && input.pressedAction('grappleBoost')) this.boost(b);
    if (this.muteOwed) {
      input.muteUntilUp(GRAPPLE_RELEASE_MUTES);
      this.muteOwed = false;
    }
    const k = this.keys;
    k.reelIn = this.out && steady && input.held('reelIn');
    k.reelOut = this.out && steady && input.held('reelOut');
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

  /** The rope's rise in degrees from the hand to its pivot, for the console. */
  rise(b: GrappleBody): number {
    if (!this.attached) return 0;
    this.pivot(this.piv);
    return riseOf(this.piv.x - b.pos.x, this.piv.y - (b.pos.y + GRAPPLE_TUNE.ropeY), this.piv.z - b.pos.z);
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
    if (this.state === 'flying') this.flyDart(b, dt);
    if (this.state !== 'attached') {
      if (this.timing) this.costNow += performance.now() - t0;
      return;
    }
    if (!this.worldOk(b)) {
      this.letGo('world');
      return;
    }
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
    const m = this.modes;
    // The knob's add-back, skipped outright at 1 (a `+= 0` turns −0 into +0): any other value is a plain
    // scale on gravity while swinging, never afloat, never on the ground and never off the rope.
    if (T.gravity !== 1 && m.swinging) vel.y += gravityAddBack(T.gravity, GRAPPLE_GRAVITY, dt);
    // The reel, or the haul, changes the length.
    const haulHeld = this.keys.haul;
    let reel = 0;
    if (!haulHeld) {
      if (this.keys.reelIn) reel = -T.reel;
      else if (this.keys.reelOut) reel = T.reel;
    }
    const minLen = rope.spent + T.minFree;
    if (reel < 0 && rope.length + reel * dt < minLen) reel = Math.min(0, (minLen - rope.length) / dt);
    if (reel > 0 && rope.length + reel * dt > T.range) reel = Math.max(0, (T.range - rope.length) / dt);
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
    // The sway, while swinging: the move keys' direction taken into the plane square to the free span. Not while a
    // slam's stagger runs.
    const swx = this.keys.swayX;
    const swz = this.keys.swayZ;
    const swaying = m.swinging && !this.staggered && (swx !== 0 || swz !== 0) && dist > 1e-6;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    if (swaying) {
      const d = swx * rx + swz * rz;
      tx = swx - rx * d;
      ty = -ry * d;
      tz = swz - rz * d;
      const tl = len3(tx, ty, tz);
      if (tl > 1e-6) {
        tx /= tl;
        ty /= tl;
        tz /= tl;
        const along = vel.x * tx + vel.y * ty + vel.z * tz;
        if (along < T.swayMax) {
          const a = Math.min(T.swayAccel * dt, T.swayMax - along);
          vel.x += tx * a;
          vel.y += ty * a;
          vel.z += tz * a;
        }
      } else {
        tx = 0;
        ty = 0;
        tz = 0;
      }
    }
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
      sw.x = tx;
      sw.y = ty;
      sw.z = tz;
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
    // The lip-over is done once its bend has come out and the feet stand over the lip: the haul goes on toward
    // what is now first. The bend comes out while the feet are still a rope point's height under the lip (the
    // rope pulls at the hand), so its coming out alone is not the end: the haul would drive the body into the wall.
    if (this.lipping && rope.n < this.lipBend && b.pos.y >= this.lipY + T.lipClear) this.lipping = false;
    const free = rope.free();
    // The lip-over starts when the next step of the haul would reach the shortest: at 18 m/s a frame at 60 fps is
    // 0.3 m, and a step that ended inside `minFree` drives the body into the lip's wall before the lip-over sees it.
    const lipAt = T.minFree + Math.max(T.lipTrigger, T.haul * dt);
    if (!this.lipping && !this.lipGaveUp && rope.n > 0 && free <= lipAt && piv.y > hand.y && this.bendWalkable(rope.n)) {
      this.lipping = true;
      this.lipTime = 0;
      this.lipBend = rope.n;
      // Where the lip is, and the point the rope ran to before it, kept: the bend may come out on the way over.
      const j = 3 * rope.n;
      const k = j - 3;
      this.lipY = rope.contact[j + 1];
      this.lipToX = rope.pts[k];
      this.lipToZ = rope.pts[k + 2];
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
    let gx = piv.x - hand.x;
    let gy = piv.y - hand.y;
    let gz = piv.z - hand.z;
    const lift = rope.n === 0 && this.anchorWalkable;
    if (lift) gy += T.ropeY;
    const gl = len3(gx, gy, gz);
    if (gl > 1e-6) {
      const s = Math.min(T.haul, gl / dt) / gl;
      vel.x = gx * s;
      vel.y = gy * s;
      vel.z = gz * s;
      // Aimed at the pivot itself, the haul's last step stops where the haul ends, `minFree` from it: a step of
      // 0.3 m at 60 fps and 0.6 at 30 that ended inside it drove the body into the face it was hauled to. What the
      // step falls short by is taken off the move (as the constraint's correction is), never off the velocity,
      // which keeps the haul's own speed for the arrival to take off on the frame it ends (§3.6).
      if (!lift) {
        const step = Math.min(T.haul * dt, gl);
        const most = Math.max(0, dist - T.minFree);
        if (step > most) {
          const k = (step - most) / gl;
          this.haulCut.x = gx * k;
          this.haulCut.y = gy * k;
          this.haulCut.z = gz * k;
        }
      }
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
  clip(b: GrappleBody): void {
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
    const harm = slamHarm(v, b.hp, T);
    const took = harm > 0 && b.takeDamage(harm, false, 'fall');
    const staggers = staggerFor(v, T) > 0;
    if (staggers) this.staggerAge = 0;
    this.noteSlam(v, harm, kind, took);
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
    } else if (this.state === 'attached') {
      this.pivot(this.piv);
      dx = this.piv.x - b.pos.x;
      dy = this.piv.y - (b.pos.y + ropeY);
      dz = this.piv.z - b.pos.z;
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
    if (this.state === 'flying') {
      if (!this.returning) this.keepTrail(b);
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
    if (this.con.taut && !this.hauling && (this.modes.swinging || this.modes.afloat)) this.con.follow(b.vel, h0, h1, piv, piv);
    rope.track(h1);
    if (rope.fouled) {
      this.letGo('fouled');
      this.say?.('The line fouled and let go.');
      this.noteCost();
      return;
    }
    // The anchor: a collider that went (streamed out, rebuilt) is looked for again just behind it.
    const a = rope.cols[0];
    if (a && !a.isValid() && !rope.rebindAnchor()) {
      this.letGo('loose');
      this.say?.('The line came loose.');
      this.noteCost();
      return;
    }
    // The haul arriving on a walkable anchor: standing there, the rope lets go.
    if (this.keys.haul && this.anchorWalkable && rope.n === 0 && b.grounded) {
      const dx = b.pos.x - rope.pts[0];
      const dz = b.pos.z - rope.pts[2];
      if (len2(dx, dz) < T.arriveReach) {
        this.letGo('arrived');
        this.noteCost();
        return;
      }
    }
    // The slide latch: cleared on the ground by slack past `latchSlack` (the ground holding a scrape a few
    // centimetres inside its length is not slack) or by slowness, and afloat.
    if (b.swimming) this.latch = false;
    else if (b.grounded) {
      this.pivot(piv);
      const held = this.con.taut || rope.free() - len3(h1.x - piv.x, h1.y - piv.y, h1.z - piv.z) <= T.latchSlack;
      if (!held || len2(b.vel.x, b.vel.z) <= T.slideOver) this.latch = false;
    }
    if (this.timing) this.costNow += performance.now() - t0;
    this.noteCost();
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
      if (hit) {
        const t = hit.timeOfImpact;
        const cx = r.origin.x + r.dir.x * t;
        const cy = r.origin.y + r.dir.y * t;
        const cz = r.origin.z + r.dir.z * t;
        const kind = this.classify(hit.collider, p);
        if (kindHolds(kind)) this.bite(b, cx, cy, cz, hit.normal.x, hit.normal.y, hit.normal.z, hit.collider, p);
        else {
          this.dart[0] = cx;
          this.dart[1] = cy;
          this.dart[2] = cz;
          this.counts.misses++;
          this.recall();
        }
        return;
      }
    }
    this.dart[0] += sx;
    this.dart[1] += sy;
    this.dart[2] += sz;
    const flown = len3(this.dart[0] - this.launch[0], this.dart[1] - this.launch[1], this.dart[2] - this.launch[2]);
    const reach = len3(this.dart[0] - hx, this.dart[1] - hy, this.dart[2] - hz);
    if (flown > T.range + T.missPad || reach > T.range) {
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
    rope.length = Math.min(T.range, rope.spent + len3(hx - this.piv.x, hy - this.piv.y, hz - this.piv.z));
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

  /** What a collider the dart's ray met is, for whether the dart holds (§3.9). The passing kinds never reach here. */
  classify(c: Collider, p: Physics): MarkKind {
    const h = c.handle;
    if (p.isPane(h)) return 'pane';
    const body = c.parent();
    if (!body || body.isFixed()) return isTerrainCollider(c) ? 'terrain' : 'still';
    if (p.isWall(h)) return 'door';
    if (this.isProp?.(h)) return 'prop';
    return 'moving';
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
    mk.next = this.attached;
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
    this.castLen = T.range + T.probePad;
    const first = this.castPassing(physics, r);
    let found = false;
    if (first) {
      const t = first.timeOfImpact;
      const px = r.origin.x + v.dirX * t;
      const py = r.origin.y + v.dirY * t;
      const pz = r.origin.z + v.dirZ * t;
      const fnx = first.normal.x;
      const fny = first.normal.y;
      const fnz = first.normal.z;
      const fc = first.collider;
      // The hand's own line to it: what that meets first is where the dart would bite.
      const sg = this.sg;
      sg[0] = hand.x;
      sg[1] = hand.y;
      sg[2] = hand.z;
      sg[3] = px;
      sg[4] = py;
      sg[5] = pz;
      sg[6] = 0.05;
      if (this.segment(physics)) {
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
    if (found && this.hit.collider) {
      const bx = this.t1.x;
      const by = this.t1.y;
      const bz = this.t1.z;
      let kind = this.classify(this.hit.collider, physics);
      if (kindHolds(kind) && water?.(this.t1)) kind = 'water';
      const ex = bx - hand.x;
      const ey = by - hand.y;
      const ez = bz - hand.z;
      const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
      mk.kind = kind;
      mk.distance = dist;
      if (markShows(dist, kind, T)) {
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
        return mk;
      }
    } else {
      mk.kind = 'none';
      mk.distance = 0;
    }
    // Nothing shown: the last good mark is held a moment, checked again from the hand.
    if (mk.holdLeft > 0 && mk.collider && mk.collider.isValid()) {
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
      if (mk.holdLeft > 0 && !blocked && dist >= T.minRange && dist <= T.range) {
        mk.shows = true;
        mk.held = true;
        return mk;
      }
    }
    mk.holdLeft = 0;
    mk.shows = false;
    mk.held = false;
    mk.collider = null;
    return mk;
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
    if (!this.attached || !this.worldOk(b)) return 0;
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
