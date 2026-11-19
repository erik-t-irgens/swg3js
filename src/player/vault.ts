// Climbing II, phase 6: vaults and clambers (the owner's "great for when sprinting to automatically clamber over obstacles that
// are appropriate", 2026-11-16), under `move.vault` 'sprint' (the default), 'run' (any run) or 'off' (today: a run meets an
// obstacle as it always did).
//
// One class, `Vault`, takes the body over an obstacle met on the run, stepped by the player's update and by the node harness alike
// (tools/swg/tests/grappleBody.ts), at the places a pole's grab is (src/player/poleClimb.ts):
//  - `sense`, after the move (after the use key's grabs and the wall climb, which a press of the key takes first): running at the
//    switch's pace on the ground, a still face met squarely ahead along the travel (within `vaultAngle`), its top read straight
//    down just past it and followed along the travel (`march`): a top between `vaultLow` and `vaultHigh` over the feet that ends
//    within `vaultFar` with ground beyond (no deeper than `vaultDrop` under the feet), room over it (`vaultRoom`) and room to
//    stand where the feet come down, is vaulted (`VAULT_OVER`: the clip whose hand's own height is nearest the top), or past
//    `vaultDeep` dived over (`VAULT_DIVE`, a top no higher than `diveHigh`); a top between `clamberLow` and `clamberHigh` that
//    goes on past `vaultFar`, with room to stand on it, is clambered onto (`VAULT_CLAMBER`). Each is begun at the place its clip
//    asks: its hand on the top `vaultHandIn` past the face (a clamber's `clamberHandIn`), a dive's highest point over the
//    obstacle's middle; a frame that sees the face late starts the clip that much further in, so the path over the obstacle is
//    the same whatever the frame rate.
//  - `step`, in place of the movement while it holds the body: the clip's clock run at a rate fitted to the speed the body came
//    with over the clip's own run-in (held to `vaultRateLeast` .. `vaultRateMost`), the body carried along the clip's own travel
//    (its hips at the clip's moments, src/anim/vaultClips.ts), a vault's flight stretched where the obstacle is deeper than its
//    clip's own (between its hands leaving the top and its feet coming down) so the feet land `vaultLand` past the far side; the
//    figure lifted or lowered by the top's difference from the clip's own hand while the hand is on it, and onto the ground
//    beyond as it lands; a clamber's figure onto the top as its feet come up onto it. At its end the body is handed back to the
//    movement on the ground beyond (or the top) running on at the speed it came with; a clamber is cut at its second foot on the
//    top (the owner's 1.07 s) while the sprint is held, and played whole to standing when it is not.
// Maker B's items 3 and 4: never while the placing hand holds something, swimming, crouched (by the key or the duck), prone,
// kneeling, on a vehicle or at a ship's controls (the caller's `busy`), nor into something that moves (`moverIn`: the reads a vault
// the still world takes asked again of what moves, `VAULT_MOVER_FLAGS`, refused as 'moves'); a face too high is the wall as today.
// While a vault holds the body its hands are full (the player's `climbHolds`: the fight's keys muted, the hook refused, no emote),
// the chase follows the body as a run's does (never the climbing's eased follow, which trails a body running on by its ease times
// its speed), the first-person eye follows the drawn head, and another player's game is shown the nearest pose the wire has
// (`wireState`, `peerPlace`).
// The review's round (the fixer's):
//  - the way clear for the body's own capsule, not only over the top (`corridor`): from the body to the face (the run-in, its
//    breadth the capsule's, from over a step's height to the standing height) and, a vault's and a dive's, from the far side down
//    to where the feet come down (from a step over the higher of the two grounds up to the room over the top), each asked of what
//    stands still and again of what moves; anything there is no vault ('way'), so a second wall, a bench or a post beside the run
//    is never passed through;
//  - the capsule kept out of the obstacle (`rideY`, `holdBack`): a vault's and a dive's raised onto the top (its feet a skin over
//    it) from the clip's take-off until it is over the face, and let down past the far side, a clamber's held at the face while it
//    rises onto the top; crouched while it is so (`crouchedNow`, the caller's collider), so the room over the top holds it. The
//    figure is drawn exactly where it always was (the offsets take the difference back), and the chase camera follows the figure's
//    own way (`unride`), so only what is aimed at and what collides moves;
//  - the obstacle passed by the camera's block while the vault holds the body and as its offset eases out (`cameraCollider`, under
//    `climb.barCamera` 'pass', the bar's and the pole's own rule), so a landing on lower ground just past its top never pulls the
//    chase in for a frame.
// Everything is ours but the clips' own moments and places (measured, the owner's for the clamber); every number of feel is a
// slider of `MOVE_TUNE` (src/anim/moveTune.ts, the debug menu's `move`).
//
// Nothing here makes an object on a frame: every ask and answer is a kept record, and the engine's own answers (a ray's, a shape
// test's) are the only things made.
import type { RAPIER } from '../core/physics.ts';
import { STILL_FLAGS } from './stairSense.ts';
import { MOVE_TUNE } from '../anim/moveTune.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { VAULT_CLAMBER, VAULT_CLIP_NAMES, VAULT_DIVE, VAULT_FACTS, VAULT_OVER, vaultPathAt, vaultRampAt, vaultTimeAt, type VaultClipFacts, type VaultKind } from '../anim/vaultClips.ts';
import { LEDGE_CAPSULE, type LedgeBody } from './ledge.ts';
import { LEDGE_REST } from '../anim/ledgeClips.ts';

/** The phase: holding nothing, or carried over (or onto) an obstacle. */
export const VAULT_NONE = 0;
export const VAULT_ON = 1;

/** The speed classes' paces the switch reads (src/anim/locoClass.ts's `RUN` and `SPRINT`; held equal by climbVaults.test.ts). */
export const VAULT_PACE_RUN = 3;
export const VAULT_PACE_SPRINT = 4;

/** A body slower than this across the ground has no travel to vault along, m/s (a mechanic: a walk's own least). */
export const VAULT_SLOW = 1;
/** The face rays' heights over the feet, metres (mechanics: under the lowest top anything takes (`vaultLow` 0.5, `clamberLow` 0.8), and over a low rail's). */
export const VAULT_PROBE_LOW = 0.3;
export const VAULT_PROBE_HIGH = 0.75;
/** A face is no steeper than this upright share (the hit's normal's upward part): a slope is run up, not vaulted (a mechanic: cos 60 degrees). */
const FACE_STEEP = 0.5;
/** How far in past the face the top is first read, and the step it is followed by along the travel, metres (mechanics). */
const TOP_IN = 0.05;
const TOP_STEP = 0.1;
/** A top is level within this, metres: higher, it is no top to go over (stairs, a step up on it); lower, its far side (a mechanic: a stair's least riser, 0.12 m, and a little). */
const TOP_SLACK = 0.12;
/** How far over the highest top anything takes the top is read down from, metres (a mechanic: a read begun inside something answers nothing). */
const TOP_OVER = 0.6;
/**
 * A start no later than this before a vault's (a clamber's) hand comes onto the top, a dive's feet off the ground (seconds of clip; a
 * mechanic: a frame at the slowest step the game takes is a twentieth, and a frame that first sees the face past a short run-in's
 * take-off starts the clip just after it, under its crossfade from the run).
 */
const START_LATE = 0.05;
/** The highest the dive's own figure stands over its take-off ground (its feet at its flight's top), metres, measured on the human male. */
const DIVE_RISE = 2.53;
/** The room box's half extents, metres (a mechanic: about a body's width across, a hand's breadth along). */
const ROOM_HALF_X = 0.2;
const ROOM_HALF_Y = 0.25;
const ROOM_HALF_Z = 0.2;
/** How far apart along the travel the room box is asked, metres (a mechanic: twice its half, so the boxes touch). */
const ROOM_STEP = 0.4;
/** The skin a standing capsule is asked clear of a top or the ground, metres (the character controller's own offset). */
const STAND_SKIN = 0.04;
/**
 * How far over the ground beyond a vault the standing capsule is asked clear, metres: a step the landing takes in its stride (a
 * kerb, the edge of a slab the obstacle stands on), well under the character controller's own autostep, which takes the body onto
 * it as it runs on. Not a number of feel: under it a landing beside the edge of the very slab the course stands on was refused.
 */
const LAND_STEP = 0.15;
/**
 * How much further a vault comes down where the body standing at its own landing would be in an edge it passed (the body's breadth
 * and the controller's skin), metres: once, never more. Not a number of feel: the game's course stands each obstacle on a slab
 * reaching 0.75 m past it, over ground that falls away, and a landing 0.87 m past it stood a body half inside the slab's edge.
 */
const LAND_PUSH = 0.4;
/**
 * The review's round: the body's own capsule, the player's, never scaled with the figure (its breadth, and the standing capsule's
 * height), metres: the corridor is asked at it, and it is kept out of the obstacle by it.
 */
const BODY_R = LEDGE_CAPSULE.r;
const BODY_TALL = 2 * (LEDGE_CAPSULE.r + LEDGE_CAPSULE.stand);
/** The least of the clip's seconds the capsule takes to rise onto the top or come down off it, so it never steps (a mechanic). */
const RIDE_LEAST = 0.1;
/** Kept off by no more than this is not kept off at all, metres (a rounding's, a mechanic). */
const RIDE_NONE = 1e-9;
/** The least share of the travel a face may stand square to it, for how far the capsule's breadth reaches it slantwise (a mechanic: under it, 78 degrees off square). */
const SLANT_LEAST = 0.2;
/** The clip's moments are read from the path's anchors; a vault's flight and landing are eased by a smooth step. */
// (The review's round: both ends asked and the step worked out on every call, then picked between, so nothing in it is first run part
// way through a vault, which throws the frame's compiled code away; the same numbers as before to the bit.)
const ease = (u: number): number => {
  const lo = u <= 0;
  const hi = u >= 1;
  const s = u * u * (3 - 2 * u);
  return lo ? 0 : hi ? 1 : s;
};
/** A share of the way from `a` to `b` at `t` (nought before, one after; one where they coincide and `t` is past). */
const span = (t: number, a: number, b: number): number => (b > a ? ease((t - a) / (b - a)) : t >= a ? 1 : 0);

/** The little of a physics world the vaults ask (rapier's `World`). */
export interface VaultWorld {
  castRayAndGetNormal(ray: RAPIER.Ray, maxToi: number, solid: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider, filterExcludeRigidBody?: RAPIER.RigidBody): RAPIER.RayColliderIntersection | null;
  intersectionWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider, filterExcludeRigidBody?: RAPIER.RigidBody): RAPIER.Collider | null;
}

/**
 * Item 3 (maker B): what moves, as the engine's own filter names it (QueryFilterFlags: 1 leaves out what is fixed or has no body,
 * 8 the sensors): a body the physics carries, a door's leaf, a crate, a creature, a ragdoll's piece, a vehicle; never another
 * player (a sensor) and never the body's own capsule (left out by its body, `VaultIn.self`). Not a number of feel.
 */
export const VAULT_MOVER_FLAGS = 1 | 8;

/** The engine's ray and the shapes the vaults ask with, handed in once (so this file loads under node with no engine of its own). */
export interface VaultMakers {
  ray(): RAPIER.Ray;
  capsule(halfHeight: number, radius: number): RAPIER.Shape;
  cuboid(hx: number, hy: number, hz: number): RAPIER.Shape;
}

/** A frame of the body as the vaults need it, written by the caller (fields, so no number crosses a call). */
export class VaultIn {
  /** The frame's seconds. */
  dt = 0.5;
  /** The body's velocity across the ground (the travel is read from it). */
  vx = 0.5;
  vz = 0.5;
  grounded = false;
  /** Something else has the body, or the switch's own refusals hold (the caller's). */
  busy = false;
  /** The speed class the body runs at this frame (the speed classes' own: 0 none, 3 the run, 4 the sprint). */
  pace = 0;
  /** The sprint still asked (the class Shift asks, and forward held): a clamber's cut reads it. */
  sprintHeld = false;
  /** The figure's size against the human male (the ledges' own). */
  scale = 0.5;
  /** The move's own collision groups. */
  filter = 0.5;
  /** Item 3 (maker B): the body's own (its capsule), left out where what moves is asked (`VAULT_MOVER_FLAGS`); null for none. */
  self: RAPIER.RigidBody | null = null;
  constructor() {
    this.dt = 0;
    this.vx = 0;
    this.vz = 0;
    this.scale = 1;
    this.filter = 0;
  }
}

/** What the last obstacle met came to (the console's and the tests'). */
export type VaultVerdict = '' | 'vault' | 'dive' | 'clamber' | 'waiting' | 'late' | 'low' | 'high' | 'deep' | 'rises' | 'room' | 'ground' | 'drop' | 'stand' | 'glance' | 'moves' | 'way';

export class Vault {
  phase = VAULT_NONE;
  /** The clip under way (its id, its rig name, its kind and its facts). */
  clip = '';
  clipName = '';
  kind: VaultKind = 'vault';
  private f: VaultClipFacts = VAULT_FACTS.jumping;
  /** The clip's clock (seconds into it), where it began and ends, and the rate it runs at. */
  t = 0.5;
  t0 = 0.5;
  tEnd = 0.5;
  rate = 0.5;
  /** The speed the body came with (and runs on at), and the travel's way across the ground (unit). */
  speed = 0.5;
  ux = 0.5;
  uz = 0.5;
  /** Where the path is anchored: the body's place at `t0` across the ground, and the path's own place there (clip metres). */
  x0 = 0.5;
  z0 = 0.5;
  private p0 = 0.5;
  /** The ground under the feet at the start, and beyond the obstacle where they come down (a clamber's: its top). */
  y0 = 0.5;
  y1 = 0.5;
  /** The top over the ground at the start, the obstacle's depth along the travel, and its face's distance from the start. */
  top = 0.5;
  depth = 0.5;
  face = 0.5;
  /** The figure's lift while the hand (a clamber's feet) is on the top: the top less the clip's own, metres. */
  shift = 0.5;
  /** A vault's flight stretched by this along the travel, metres (nought where its clip's own reaches past the far side). */
  stretch = 0.5;
  /** The figure's size the path is scaled by. */
  k = 0.5;
  /** The heading the figure faces (the travel's). */
  heading = 0.5;
  /** The drawn figure against the body, in its heading's frame: along its front, and up. */
  offFwd = 0.5;
  offY = 0.5;
  /** The frame a clip begins (the caller's rig takes it up), and the frame it ends (the rig lets go of it), and whether it ends running on. */
  startClip = false;
  ended = false;
  runOn = false;
  /** Let go of under way by something else (stood elsewhere, off the feet): its held clip still on the rig until the caller lets go of it. */
  dropped = false;
  /** After the end: the drawn offset eased out over this long more (seconds left, the whole, and where it eases out from). */
  outT = 0.5;
  outDur = 0.5;
  private fromFwd = 0.5;
  private fromY = 0.5;
  /** Why the last obstacle came to what it did (`VaultVerdict`), and its numbers (the console's). */
  verdict: VaultVerdict = '';
  seenTop = 0.5;
  seenDepth = 0.5;
  seenFace = 0.5;
  /** Where the last vault put the body down, at its clip's end (before the frame's overrun): the console's and the tests'. */
  endX = 0.5;
  endY = 0.5;
  endZ = 0.5;
  /**
   * The review's round: the capsule's own way against the figure's, this frame: raised over it (metres up), held back along the
   * travel (metres: a clamber's, at the face while it rises onto the top), and crouched while either is so (the caller's collider).
   * Nought, nought and false outside a vault, and at each one's ends.
   */
  rideY = 0.5;
  holdBack = 0.5;
  crouchedNow = false;
  /** The height the capsule's feet ride at over the top (the world's), the clip's times it rises from and is up by, comes down from and is down by, and (a clamber's) where it is held and how far by its first foot on the top. */
  private rideTop = 0.5;
  private tR0 = 0.5;
  private tIn = 0.5;
  private tOut = 0.5;
  private tD = 0.5;
  private aIn = 0.5;
  private holdLift = 0.5;
  /** The obstacle's face as the engine answered it (its collider), kept for the camera's block (`cameraCollider`); null for none. */
  private faceCol: RAPIER.Collider | null = null;
  /** Counts: vaults, dives and clambers begun, a clamber's cuts, frames held, the rays and shape tests asked (the engine's answers: what a frame makes). */
  vaults = 0;
  dives = 0;
  clambers = 0;
  cuts = 0;
  frames = 0;
  casts = 0;

  private readonly makers: VaultMakers;
  private ray: RAPIER.Ray | null = null;
  private cap: RAPIER.Shape | null = null;
  private box: RAPIER.Shape | null = null;
  private readonly at = { x: 0, y: 0, z: 0 };
  private readonly still = { x: 0, y: 0, z: 0, w: 1 };
  /** The last face read (its collider's handle and where it was met), kept so a body running straight at it reads its top once. */
  private seenHandle = -1;
  private seenX = 0.5;
  private seenZ = 0.5;
  private seenUx = 0.5;
  private seenUz = 0.5;
  private seenTopY = 0.5;
  private seenDeep = false;
  private seenRises = false;
  /** A read's answer (kept). */
  private hitToi = 0.5;
  private hitNy = 0.5;
  private hitNx = 0.5;
  private hitNz = 0.5;
  private hitHandle = -1;

  constructor(makers: VaultMakers) {
    this.makers = makers;
    this.t = 0;
    this.t0 = 0;
    this.tEnd = 0;
    this.rate = 1;
    this.speed = 0;
    this.ux = 0;
    this.uz = 1;
    this.x0 = 0;
    this.z0 = 0;
    this.p0 = 0;
    this.y0 = 0;
    this.y1 = 0;
    this.top = 0;
    this.depth = 0;
    this.face = 0;
    this.shift = 0;
    this.stretch = 0;
    this.k = 1;
    this.heading = 0;
    this.offFwd = 0;
    this.offY = 0;
    this.outT = 0;
    this.outDur = 0;
    this.fromFwd = 0;
    this.fromY = 0;
    this.seenTop = Number.NaN;
    this.seenDepth = Number.NaN;
    this.seenFace = Number.NaN;
    this.endX = Number.NaN;
    this.endY = Number.NaN;
    this.endZ = Number.NaN;
    this.landX = Number.NaN;
    this.landY = Number.NaN;
    this.landZ = Number.NaN;
    this.seenX = 0;
    this.seenZ = 0;
    this.seenUx = 0;
    this.seenUz = 0;
    this.seenTopY = 0;
    this.hitToi = 0;
    this.hitNy = 0;
    this.hitNx = 0;
    this.hitNz = 0;
    this.rideY = 0;
    this.holdBack = 0;
    this.rideTop = 0;
    this.tR0 = 0;
    this.tIn = 0;
    this.tOut = 0;
    this.tD = 0;
    this.aIn = 0;
    this.holdLift = 0;
    this.cosA = 1;
    this.cdf = 0;
    this.cD = 0;
    this.cy0 = 0;
    this.cFloor = 0;
    this.cTop = 0;
    this.cLand = 0;
    this.wa0 = 0;
    this.wa1 = 0;
    this.wy0 = 0;
    this.wy1 = 0;
    this.kAlong = 0;
    this.kLine = 0;
  }

  /** Whether the vault has the body (in place of the movement). */
  get holding(): boolean {
    return this.phase !== VAULT_NONE;
  }

  /** Whether the figure is drawn against the body by the vault (while it holds it, and while its offset eases out after). */
  get offset(): boolean {
    return this.phase !== VAULT_NONE || this.outT > 0;
  }

  /** Stood somewhere new, or taken off the feet: nothing vaults, and nothing is drawn against the body. */
  reset(why: string): void {
    void why;
    // (A vault let go of under way leaves its held clip on the rig, which the caller lets go of: `releaseVaultClip`.)
    if (this.phase !== VAULT_NONE) this.dropped = true;
    this.phase = VAULT_NONE;
    this.startClip = false;
    this.ended = false;
    this.outT = 0;
    this.offFwd = 0;
    this.offY = 0;
    this.rideY = 0;
    this.holdBack = 0;
    this.crouchedNow = false;
    this.seenHandle = -1;
  }

  /**
   * The review's round: the figure's own way where the capsule is kept off the obstacle (`rideY`, `holdBack`): the place `out` (the
   * body's) taken back to it, which the chase camera follows, so it moves as it would with no capsule kept off at all. Written into
   * `out`.
   */
  unride<V extends { x: number; y: number; z: number }>(out: V): V {
    out.x += this.ux * this.holdBack;
    out.y -= this.rideY;
    out.z += this.uz * this.holdBack;
    return out;
  }

  /**
   * The review's round (`climb.barCamera` 'pass', the bar's and the pole's own rule): the obstacle the camera's block leaves out (the
   * engine's ray handed it as its excluded collider) while the vault holds the body and as its offset eases out after: a landing on
   * lower ground just past its top put the chase's line through the top's edge for a frame and pulled it in six metres and out
   * again. Null otherwise, and always under 'block'.
   */
  cameraCollider(): RAPIER.Collider | null {
    if (CLIMB_TUNE.barCamera !== 'pass') return null;
    return this.phase !== VAULT_NONE || this.outT > 0 ? this.faceCol : null;
  }

  /** Off the vault: a let-go's offset eased out (the caller's every frame of the movement). */
  tick(dt: number): void {
    this.startClip = false;
    this.ended = false;
    if (this.phase !== VAULT_NONE || this.outT <= 0) return;
    this.outT = Math.max(0, this.outT - dt);
    const u = this.outDur > 0 ? this.outT / this.outDur : 0;
    this.offFwd = this.fromFwd * u;
    this.offY = this.fromY * u;
  }

  // ---- the reads -----------------------------------------------------------------------------------------------------------------
  // (Each asked through the kept fields `qx` .. `qlen` and `qflt`, its answer in kept fields: no number crosses a call, which would
  // box it wherever the call is not built in.)

  /** A read's ask: a ray's start and way and length (or a shape's place), and the collision groups. */
  private qx = 0.5;
  private qy = 0.5;
  private qz = 0.5;
  private qdx = 0.5;
  private qdy = 0.5;
  private qdz = 0.5;
  private qlen = 0.5;
  private qflt = 0.5;
  /**
   * Item 3 (maker B): the reads ask what moves (`VAULT_MOVER_FLAGS`, the body's own left out by `qself`) in place of what stands
   * still: the second pass over a vault the still world takes (`moverIn`). False everywhere else, so every other read is the one
   * maker A wrote, call for call.
   */
  private movers = false;
  private qself: RAPIER.RigidBody | null = null;
  /** A read down's answer: the height met, NaN for nothing, -Infinity for a read begun inside something. */
  private yDown = 0.5;
  /** How far over the feet' place (`qy`) the standing capsule is asked clear: `STAND_SKIN` on a top, `LAND_STEP` on the ground beyond. */
  private standLift = 0.5;
  /** The last landing asked to stand on (the ground found beyond, the world's frame): the console's. */
  private landX = 0.5;
  private landY = 0.5;
  private landZ = 0.5;

  /** The ray asked (`qx` .. `qlen`), the still world only: its answer in the kept fields; false for none. */
  private cast(w: VaultWorld): boolean {
    let r = this.ray;
    if (!r) {
      r = this.makers.ray();
      this.ray = r;
    }
    r.origin.x = this.qx;
    r.origin.y = this.qy;
    r.origin.z = this.qz;
    r.dir.x = this.qdx;
    r.dir.y = this.qdy;
    r.dir.z = this.qdz;
    this.casts++;
    const h = this.movers ? w.castRayAndGetNormal(r, this.qlen, true, VAULT_MOVER_FLAGS, this.qflt, undefined, this.qself ?? undefined) : w.castRayAndGetNormal(r, this.qlen, true, STILL_FLAGS, this.qflt);
    if (!h) return false;
    this.hitToi = h.timeOfImpact;
    this.hitNx = h.normal.x;
    this.hitNy = h.normal.y;
    this.hitNz = h.normal.z;
    this.hitHandle = h.collider.handle;
    this.hitCol = h.collider;
    return true;
  }
  /** The last ray's collider (the engine's own answer, kept, never made). */
  private hitCol: RAPIER.Collider | null = null;

  /** The height of what stands under (`qx`, `qz`), read down from `qy` for `qlen`, into `yDown`. */
  private down(w: VaultWorld): void {
    this.qdx = 0;
    this.qdy = -1;
    this.qdz = 0;
    const from = this.qy;
    if (!this.cast(w)) this.yDown = Number.NaN;
    else this.yDown = this.hitToi <= 1e-4 ? Number.NEGATIVE_INFINITY : from - this.hitToi;
  }

  /** Whether the kept room box stands clear at (`qx`, `qy`, `qz`). */
  private room(w: VaultWorld): boolean {
    let b = this.box;
    if (!b) {
      b = this.makers.cuboid(ROOM_HALF_X, ROOM_HALF_Y, ROOM_HALF_Z);
      this.box = b;
    }
    this.at.x = this.qx;
    this.at.y = this.qy;
    this.at.z = this.qz;
    this.casts++;
    if (this.movers) return w.intersectionWithShape(this.at, this.still, b, VAULT_MOVER_FLAGS, this.qflt, undefined, this.qself ?? undefined) === null;
    return w.intersectionWithShape(this.at, this.still, b, STILL_FLAGS, this.qflt) === null;
  }

  /** Whether the standing capsule stands clear with its feet at (`qx`, `qy`, `qz`). */
  private stands(w: VaultWorld): boolean {
    let c = this.cap;
    if (!c) {
      c = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r);
      this.cap = c;
    }
    this.at.x = this.qx;
    this.at.y = this.qy + this.standLift + LEDGE_CAPSULE.r + LEDGE_CAPSULE.stand;
    this.at.z = this.qz;
    this.casts++;
    if (this.movers) return w.intersectionWithShape(this.at, this.still, c, VAULT_MOVER_FLAGS, this.qflt, undefined, this.qself ?? undefined) === null;
    return w.intersectionWithShape(this.at, this.still, c, STILL_FLAGS, this.qflt) === null;
  }

  /** A vault's (a dive's) room: its span along the travel from the face (`ra0` .. `ra1`) and its heights (`ry0` .. `ry1`). */
  private ra0 = 0.5;
  private ra1 = 0.5;
  private ry0 = 0.5;
  private ry1 = 0.5;

  /** The room box asked along a vault's way over the top (the span in `ra0` .. `ry1`, from the face `fx`, `fz` along the travel); false where something stands in it. */
  private roomAlong(w: VaultWorld): boolean {
    for (let a = this.ra0; a <= this.ra1; a += ROOM_STEP) {
      for (let y = this.ry0 + ROOM_HALF_Y; y - ROOM_HALF_Y < this.ry1; y += 2 * ROOM_HALF_Y) {
        this.qx = this.fx + this.ux * a;
        this.qy = y;
        this.qz = this.fz + this.uz * a;
        if (!this.room(w)) return false;
      }
    }
    return true;
  }

  /**
   * The review's round: the corridor's ask (`corridor`): the face's share of the travel square to it (`cosA`, its cosine), the face's
   * distance from the body, the obstacle's depth, the ground the body leaves, the floor past the far side (a step over the higher of
   * the two grounds), the top, and where the feet come down (from the face); and a run of the wide box's (`wideAlong`): its span
   * along the travel from the face and its heights.
   */
  private cosA = 0.5;
  private cdf = 0.5;
  private cD = 0.5;
  private cy0 = 0.5;
  private cFloor = 0.5;
  private cTop = 0.5;
  private cLand = 0.5;
  private wa0 = 0.5;
  private wa1 = 0.5;
  private wy0 = 0.5;
  private wy1 = 0.5;
  /** The wide box (the capsule's breadth across, a hand's breadth along), turned to the travel. */
  private wide: RAPIER.Shape | null = null;
  private readonly turn = { x: 0, y: 0, z: 0, w: 1 };

  /** Whether the wide box stands clear at (`qx`, `qy`, `qz`), turned to the travel. */
  private wideRoom(w: VaultWorld): boolean {
    let b = this.wide;
    if (!b) {
      b = this.makers.cuboid(BODY_R, ROOM_HALF_Y, ROOM_HALF_Z);
      this.wide = b;
    }
    this.at.x = this.qx;
    this.at.y = this.qy;
    this.at.z = this.qz;
    this.casts++;
    if (this.movers) return w.intersectionWithShape(this.at, this.turn, b, VAULT_MOVER_FLAGS, this.qflt, undefined, this.qself ?? undefined) === null;
    return w.intersectionWithShape(this.at, this.turn, b, STILL_FLAGS, this.qflt) === null;
  }

  /** The wide box asked along the travel from the face (`wa0` .. `wa1`, both ends taken) and up (`wy0` .. `wy1`); false where something stands in it. */
  private wideAlong(w: VaultWorld): boolean {
    if (this.wa1 < this.wa0) return true;
    const n = Math.ceil((this.wa1 - this.wa0) / ROOM_STEP);
    for (let i = 0; i <= n; i++) {
      const a = n > 0 ? this.wa0 + ((this.wa1 - this.wa0) * i) / n : this.wa0;
      for (let y = this.wy0 + ROOM_HALF_Y; y - ROOM_HALF_Y < this.wy1; y += 2 * ROOM_HALF_Y) {
        this.qx = this.fx + this.ux * a;
        this.qy = y;
        this.qz = this.fz + this.uz * a;
        if (!this.wideRoom(w)) return false;
      }
    }
    return true;
  }

  /**
   * The review's round (finding 1): the way clear for the body's own capsule where the room over the top does not reach. The run-in,
   * from the body to the face (held off it by the capsule's breadth slantwise, a face met off square reaching it sooner on one side),
   * from over a step's height (the face's own low ray's) up to the standing height; and (a vault's and a dive's) from the far side to
   * where the feet come down, from a step over the higher of the two grounds (the slab it leapt from, the ground beyond) up to the
   * room over the top. False where anything stands there: a post beside the run, a second wall or a bench past the far side.
   */
  private corridor(w: VaultWorld, kind: VaultKind): boolean {
    const c = this.cosA;
    const slant = (BODY_R * Math.sqrt(Math.max(0, 1 - c * c))) / Math.max(c, SLANT_LEAST);
    this.wa0 = ROOM_HALF_Z - this.cdf;
    this.wa1 = -(STAND_SKIN + ROOM_HALF_Z + slant);
    this.wy0 = this.cy0 + VAULT_PROBE_LOW;
    this.wy1 = this.cy0 + BODY_TALL;
    if (!this.wideAlong(w)) return false;
    if (kind === 'clamber') return true;
    this.wa0 = this.cD + STAND_SKIN + ROOM_HALF_Z + slant;
    this.wa1 = this.cLand;
    this.wy0 = this.cFloor;
    this.wy1 = this.cTop + 0.1;
    return this.wideAlong(w);
  }

  /** Item 3 (maker B): the body's place across the ground, the face's distance from it, and the clip's kind: `moverIn`'s ask. */
  private mbx = 0.5;
  private mbz = 0.5;
  private mdf = 0.5;
  private mkind: VaultKind = 'vault';

  /**
   * Item 3 (maker B): whether something that moves stands where a vault the still world takes would go: between the body and the
   * face (its two rays), over the top along the way (the very room boxes, a vault's and a dive's), or where the feet come down (a
   * clamber's on the top), every read asked of what moves alone (`movers`).
   */
  private moverIn(w: VaultWorld): boolean {
    this.movers = true;
    let hit = false;
    for (let i = 0; i < 2 && !hit; i++) {
      this.qx = this.mbx;
      this.qy = this.py + (i === 0 ? VAULT_PROBE_LOW : VAULT_PROBE_HIGH);
      this.qz = this.mbz;
      this.qdx = this.ux;
      this.qdy = 0;
      this.qdz = this.uz;
      this.qlen = this.mdf;
      if (this.cast(w)) hit = true;
    }
    if (!hit && this.mkind !== 'clamber') hit = !this.roomAlong(w);
    // (The review's round: and the capsule's own corridor, the run-in and the way down past the far side.)
    if (!hit) hit = !this.corridor(w, this.mkind);
    if (!hit) {
      this.qx = this.landX;
      this.qy = this.landY;
      this.qz = this.landZ;
      this.standLift = this.mkind === 'clamber' ? STAND_SKIN : LAND_STEP;
      hit = !this.stands(w);
    }
    this.movers = false;
    return hit;
  }

  /** The face met (`fx`, `fz`, across the ground) and the feet's height (`py`): `readTop`'s ask. */
  private fx = 0.5;
  private fz = 0.5;
  private py = 0.5;

  /**
   * The obstacle ahead read (kept while the same face is met at the same place on the same way): the top over the face, whether it
   * rises (no top to go over), its depth along the travel (Infinity past `vaultFar`: a ledge), from the face's own place.
   */
  private readTop(w: VaultWorld): void {
    const T = MOVE_TUNE;
    const ux = this.ux;
    const uz = this.uz;
    const fx = this.fx;
    const fz = this.fz;
    if (this.hitHandle === this.seenHandle && Math.abs(fx - this.seenX) + Math.abs(fz - this.seenZ) < 0.1 && ux * this.seenUx + uz * this.seenUz > 0.9998) return;
    this.seenHandle = this.hitHandle;
    this.seenX = fx;
    this.seenZ = fz;
    this.seenUx = ux;
    this.seenUz = uz;
    this.seenRises = false;
    this.seenDeep = false;
    const highest = Math.max(T.vaultHigh, T.clamberHigh);
    const from = this.py + highest + TOP_OVER;
    const len = highest + TOP_OVER + 0.2;
    this.qx = fx + ux * TOP_IN;
    this.qy = from;
    this.qz = fz + uz * TOP_IN;
    this.qlen = len;
    this.down(w);
    const top = this.yDown;
    this.seenTopY = top;
    if (!(top === top) || top === Number.NEGATIVE_INFINITY) {
      this.seenDepth = 0;
      return;
    }
    // Along the travel over the top: level within `TOP_SLACK`; higher, it rises (no box); lower, the far side, found between the
    // last read on the top and this one by a ray back along the travel just under the top.
    const far = T.vaultFar + TOP_STEP;
    let d = TOP_IN;
    for (;;) {
      const nd = d + TOP_STEP;
      if (nd > far) {
        this.seenDeep = true;
        this.seenDepth = Number.POSITIVE_INFINITY;
        return;
      }
      this.qx = fx + ux * nd;
      this.qy = from;
      this.qz = fz + uz * nd;
      this.qlen = len;
      this.down(w);
      const y = this.yDown;
      if (y === Number.NEGATIVE_INFINITY || (y === y && y > top + TOP_SLACK)) {
        this.seenRises = true;
        this.seenDepth = nd;
        return;
      }
      if (!(y === y) || y < top - TOP_SLACK) {
        this.qx = fx + ux * (nd + 0.05);
        this.qy = top - 0.05;
        this.qz = fz + uz * (nd + 0.05);
        this.qdx = -ux;
        this.qdy = 0;
        this.qdz = -uz;
        this.qlen = TOP_STEP + 0.05;
        this.seenDepth = this.cast(w) ? nd + 0.05 - this.hitToi : nd - TOP_STEP / 2;
        return;
      }
      d = nd;
    }
  }
  /**
   * After the move: running at the switch's pace on the ground into an obstacle the rules take, the body taken over it (or onto
   * it) from this very frame (its clock starts at the place this frame finds it at; the next frame runs it). True where it took
   * the body. The verdict and its numbers are kept for the console either way.
   */
  sense(w: VaultWorld, b: LedgeBody, vi: VaultIn): boolean {
    const T = MOVE_TUNE;
    if (T.vault === 'off' || this.phase !== VAULT_NONE || !vi.grounded || vi.busy) return false;
    if (vi.pace < (T.vault === 'sprint' ? VAULT_PACE_SPRINT : VAULT_PACE_RUN)) return false;
    const v = Math.sqrt(vi.vx * vi.vx + vi.vz * vi.vz);
    if (v < VAULT_SLOW) return false;
    const ux = vi.vx / v;
    const uz = vi.vz / v;
    this.ux = ux;
    this.uz = uz;
    const s = vi.scale;
    const p = b.pos;
    // The face: the nearest of the two rays along the travel, as far as the furthest start any clip asks and a frame's travel more.
    const reach = s * VAULT_REACH + v * vi.dt + 0.3;
    let df = Number.POSITIVE_INFINITY;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    let handle = -1;
    let col: RAPIER.Collider | null = null;
    this.qflt = vi.filter;
    for (let i = 0; i < 2; i++) {
      this.qx = p.x;
      this.qy = p.y + (i === 0 ? VAULT_PROBE_LOW : VAULT_PROBE_HIGH);
      this.qz = p.z;
      this.qdx = ux;
      this.qdy = 0;
      this.qdz = uz;
      this.qlen = reach;
      if (this.cast(w) && this.hitToi < df) {
        df = this.hitToi;
        nx = this.hitNx;
        ny = this.hitNy;
        nz = this.hitNz;
        handle = this.hitHandle;
        col = this.hitCol;
      }
    }
    if (!(df < reach)) return false;
    if (Math.abs(ny) > FACE_STEEP) return false;
    // Met squarely enough (the face's normal against the travel, across the ground).
    const nh = Math.sqrt(nx * nx + nz * nz);
    if (nh < 1e-6 || -(nx * ux + nz * uz) / nh < Math.cos((T.vaultAngle * Math.PI) / 180)) {
      this.verdict = 'glance';
      return false;
    }
    // (The review's round: how square the face stands to the travel, for the capsule's breadth reaching it slantwise.)
    this.cosA = -(nx * ux + nz * uz) / nh;
    this.hitHandle = handle;
    const fx = p.x + ux * df;
    const fz = p.z + uz * df;
    this.fx = fx;
    this.fz = fz;
    this.py = p.y;
    this.readTop(w);
    const topY = this.seenTopY;
    const H = topY - p.y;
    this.seenFace = df;
    this.seenTop = H;
    this.seenDepth = this.seenDeep ? Number.POSITIVE_INFINITY : this.seenDepth;
    if (!(topY === topY) || topY === Number.NEGATIVE_INFINITY) {
      this.verdict = 'high';
      return false;
    }
    if (this.seenRises) {
      this.verdict = 'rises';
      return false;
    }
    const D = this.seenDepth;
    // What it is: a ledge (deeper than `vaultFar`) to clamber onto, else a vault over it (or past `vaultDeep` a dive).
    let id = '';
    if (this.seenDeep) {
      if (H < T.clamberLow) {
        this.verdict = 'low';
        return false;
      }
      if (H > T.clamberHigh) {
        this.verdict = 'high';
        return false;
      }
      id = VAULT_CLAMBER;
    } else {
      if (H < T.vaultLow) {
        this.verdict = 'low';
        return false;
      }
      if (H > T.vaultHigh) {
        this.verdict = 'high';
        return false;
      }
      if (D > T.vaultDeep && H <= T.diveHigh) id = VAULT_DIVE;
      else {
        // The vault whose hand's own height (scaled to the figure) is nearest the top; the first of equals.
        let best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < VAULT_OVER.length; i++) {
          const e = Math.abs(s * VAULT_FACTS[VAULT_OVER[i]].hand - H);
          if (e < best) {
            best = e;
            id = VAULT_OVER[i];
          }
        }
      }
    }
    const f = VAULT_FACTS[id];
    // Where the clip starts: its anchor (a vault's and a clamber's hand on the top, a dive's apex over the middle) put at its place
    // ahead, read back along its own path to the clip time the body stands at now. Too far: not yet. Too late: no vault.
    let at = 0;
    let handIn = 0;
    if (f.kind === 'dive') at = f.apexZ - (df + D / 2) / s;
    else {
      handIn = f.kind === 'clamber' ? T.clamberHandIn : Math.min(T.vaultHandIn, D / 2);
      at = f.handZ - (df + handIn) / s;
    }
    if (at < f.pathZ[0]) {
      this.verdict = 'waiting';
      return false;
    }
    const t0 = vaultTimeAt(f, at);
    if (t0 > (f.kind === 'dive' ? f.leave : f.touch) - START_LATE) {
      this.verdict = 'late';
      return false;
    }
    // The flight's stretch (a vault's): its feet down `vaultLand` past the far side, or its own place where that is further.
    let stretch = 0;
    let landAt = 0;
    if (f.kind === 'vault') {
      const own = handIn + s * (f.landZ - f.handZ);
      stretch = Math.max(0, D + T.vaultLand - own);
      landAt = df + own + stretch;
    } else if (f.kind === 'dive') landAt = df + D / 2 + s * (f.landZ - f.apexZ);
    // Room: over the top along the way (a vault's `vaultRoom` over it, a dive's own figure over the take-off ground), or to stand
    // on the top (a clamber's); ground to come down on beyond, with room to stand there.
    let y1 = topY;
    if (f.kind === 'clamber') {
      // Where the body stands on the top at the clip's end (its hand `handIn` past the face, its hips its own path from there).
      const inTop = Math.max(LEDGE_CAPSULE.r + 0.05, s * (f.pathZ[f.pathZ.length - 1] - f.handZ) + handIn);
      this.qx = fx + ux * inTop;
      this.qy = topY;
      this.qz = fz + uz * inTop;
      // (Kept for the ask of what moves, `moverIn`.)
      this.landX = this.qx;
      this.landY = this.qy;
      this.landZ = this.qz;
      this.standLift = STAND_SKIN;
      if (!this.stands(w)) {
        this.verdict = 'stand';
        return false;
      }
    } else {
      // (The room's span kept in fields, so the ask of what moves (`moverIn`) asks the very boxes: `roomAlong`.)
      this.ra0 = -ROOM_STEP / 2;
      this.ra1 = landAt + LAND_PUSH - df + ROOM_STEP / 2;
      this.ry0 = topY + 0.1;
      this.ry1 = f.kind === 'dive' ? p.y + s * DIVE_RISE : topY + T.vaultRoom;
      if (!this.roomAlong(w)) {
        this.verdict = 'room';
        return false;
      }
      // The ground it comes down on, with room to stand there; where the body standing there would be in an edge it comes down
      // past (the slab or the step it leapt from, a kerb's lip), it comes down the body's own breadth further on instead.
      const over = Math.max(topY, p.y) + 0.5;
      let g = 0;
      let push = 0;
      for (let k = 0; k < 2; k++) {
        push = k === 0 ? 0 : LAND_PUSH;
        const lx = p.x + ux * (landAt + push);
        const lz = p.z + uz * (landAt + push);
        this.qx = lx;
        this.qy = over;
        this.qz = lz;
        this.qlen = over + 0.1 - (p.y - T.vaultDrop);
        this.down(w);
        g = this.yDown;
        if (!(g === g) || g === Number.NEGATIVE_INFINITY) {
          this.verdict = 'ground';
          return false;
        }
        if (g < p.y - T.vaultDrop || g > p.y + T.vaultLow) {
          this.verdict = 'drop';
          return false;
        }
        this.qx = lx;
        this.qy = g;
        this.qz = lz;
        this.landX = lx;
        this.landY = g;
        this.landZ = lz;
        this.standLift = LAND_STEP;
        if (this.stands(w)) break;
        if (k === 1) {
          this.verdict = 'stand';
          return false;
        }
      }
      stretch += push;
      y1 = g;
      // (Where the feet come down, from the face: the corridor's far end.)
      this.cLand = landAt + push - df;
    }
    // The review's round (finding 1): the way clear for the body's own capsule, the run-in and the way down past the far side.
    this.cdf = df;
    this.cD = D;
    this.cy0 = p.y;
    this.cFloor = Math.max(p.y, y1) + LAND_STEP;
    this.cTop = topY;
    if (!this.corridor(w, f.kind)) {
      this.verdict = 'way';
      return false;
    }
    // Item 3 (maker B): never into something that moves. The still world takes it; the same reads asked again of what moves (in the
    // way between the body and the face, over the top along the way, where the feet come down or stand on the top) refuse it.
    this.qself = vi.self;
    this.mbx = p.x;
    this.mbz = p.z;
    this.mdf = df;
    this.mkind = f.kind;
    if (this.moverIn(w)) {
      this.verdict = 'moves';
      return false;
    }
    // Begun: the clip from `t0`, the body's speed kept, the clip's rate fitted to it over its own run-in.
    this.clip = id;
    this.clipName = VAULT_CLIP_NAMES[id];
    this.kind = f.kind;
    this.f = f;
    this.k = s;
    this.t0 = t0;
    this.t = t0;
    this.tEnd = f.kind === 'clamber' ? f.land : f.dur;
    this.speed = v;
    const runTo = f.kind === 'dive' ? f.leave : f.touch;
    const runIn = (vaultPathAt(f, runTo) - f.pathZ[0]) / Math.max(1e-3, runTo - f.pathT[0]);
    this.rate = Math.min(T.vaultRateMost, Math.max(T.vaultRateLeast, v / Math.max(1e-3, s * runIn)));
    this.x0 = p.x;
    this.z0 = p.z;
    this.p0 = vaultPathAt(f, t0);
    this.y0 = p.y;
    this.y1 = y1;
    this.top = H;
    this.depth = D;
    this.face = df;
    this.stretch = stretch;
    this.shift = f.kind === 'dive' ? 0 : H - s * (f.kind === 'clamber' ? f.top : f.hand);
    this.heading = Math.atan2(ux, uz);
    // The review's round (finding 3): the capsule's own way over, out of the obstacle: up onto the top (its feet a skin over it) from
    // the take-off until it is over the face, and down past the far side by the feet's landing (a dive's hands' down beyond it); a
    // clamber's held at the face (its breadth slantwise off it) while it rises onto the top by its first foot on it. Turned to the
    // travel, the wide box the corridor asked with.
    this.turn.y = Math.sin(this.heading / 2);
    this.turn.w = Math.cos(this.heading / 2);
    const rr = BODY_R / Math.max(this.cosA, SLANT_LEAST) + STAND_SKIN;
    this.rideTop = topY + STAND_SKIN;
    this.aIn = df - rr;
    this.holdLift = 0;
    if (f.kind === 'clamber') this.holdLift = Math.max(0, this.alongAt(f.lift) - this.aIn);
    else {
      this.tR0 = Math.max(t0, f.leave);
      this.tIn = Math.max(this.timeAlong(this.aIn), this.tR0 + RIDE_LEAST);
      this.tD = Math.min(this.tEnd, Math.max(f.kind === 'dive' ? f.touch : f.land, this.timeAlong(df + D + rr) + RIDE_LEAST));
      this.tOut = Math.min(this.timeAlong(df + D + rr), this.tD - RIDE_LEAST);
    }
    this.faceCol = col;
    this.phase = VAULT_ON;
    this.startClip = true;
    this.ended = false;
    this.runOn = true;
    this.outT = 0;
    this.verdict = f.kind;
    if (f.kind === 'vault') this.vaults++;
    else if (f.kind === 'dive') this.dives++;
    else this.clambers++;
    this.place(b);
    return true;
  }

  /**
   * A frame of the vault in place of the movement: the clock run at its rate (`advance` false: the frame it began, whose move
   * the movement already made), the body placed on the path, and at the clip's end (a clamber's cut while the sprint is held) the
   * body handed back: on the ground beyond running on at the speed it came with, or (a clamber played whole) standing.
   */
  step(b: LedgeBody, vi: VaultIn, advance: boolean): void {
    // (The frame it began, its clip is still to be started on the rig after this step: `driveVaultClips` reads `startClip` then.)
    if (advance) this.startClip = false;
    this.ended = false;
    if (this.phase === VAULT_NONE) return;
    this.frames++;
    const f = this.f;
    if (advance) this.t += this.rate * vi.dt;
    // A clamber goes on past its cut, to its end standing, once the sprint is let go before it.
    if (f.kind === 'clamber' && this.tEnd < f.dur && this.t >= this.tEnd && !vi.sprintHeld) this.tEnd = f.dur;
    if (this.t < this.tEnd) {
      this.place(b);
      return;
    }
    // The end: placed at its end, and on along the travel for whatever of the frame the clip overran.
    const over = (this.t - this.tEnd) / this.rate;
    this.t = this.tEnd;
    this.place(b);
    this.endX = b.pos.x;
    this.endY = b.pos.y;
    this.endZ = b.pos.z;
    this.runOn = f.kind !== 'clamber' || this.tEnd < f.dur;
    const v = this.runOn ? this.speed : 0;
    b.pos.x += this.ux * v * over;
    b.pos.z += this.uz * v * over;
    b.vel.x = this.ux * v;
    b.vel.y = 0;
    b.vel.z = this.uz * v;
    if (f.kind === 'clamber' && this.runOn) this.cuts++;
    this.phase = VAULT_NONE;
    // (The capsule is down on the figure's own way by the end: nothing of it carried on.)
    this.rideY = 0;
    this.holdBack = 0;
    this.crouchedNow = false;
    this.ended = true;
    this.fromFwd = this.offFwd;
    this.fromY = this.offY;
    this.outDur = MOVE_TUNE.vaultBlend;
    this.outT = this.outDur;
  }

  /** The figure's way along the travel from the start at clip time `t` (its path scaled, a vault's flight stretched): `place`'s own arithmetic. */
  private alongAt(t: number): number {
    const f = this.f;
    let along = this.k * (vaultPathAt(f, t) - this.p0);
    if (this.stretch > 0) along += this.stretch * span(t, f.lift, f.land);
    return along;
  }

  /** The clip time the figure's way first reaches `a` along the travel (between the start and the end; once a vault, never on a frame). */
  private timeAlong(a: number): number {
    let lo = this.t0;
    let hi = this.tEnd;
    if (this.alongAt(lo) >= a) return lo;
    if (this.alongAt(hi) < a) return hi;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (this.alongAt(m) >= a) hi = m;
      else lo = m;
    }
    return hi;
  }

  /** `keepOff`'s ask: the figure's way along the travel from the start, and its height (the world's), at the clock. */
  private kAlong = 0.5;
  private kLine = 0.5;

  /**
   * The review's round (finding 3): how far the capsule is kept off the obstacle at the clock (`t`), against the figure's way
   * (`kAlong`, `kLine`): `rideY` raised, `holdBack` held back, `crouchedNow` while either is so. Written straight into the kept
   * fields, never a local turned from a whole number to a fraction in a branch, which boxes it; each share worked out in line.
   */
  private keepOff(): void {
    // (Every sum worked out on every frame from the clock, a fraction from the vault's first frame, and only picked between: a sum
    // first run, or first handed a fraction, part way through a vault throws the frame's compiled code away, and what runs until it
    // is compiled again boxes its numbers. Each share is the smooth step of its span, nought before it and one after.)
    const f = this.f;
    const t = this.t;
    if (f.kind === 'clamber') {
      // (A clamber's moments always rise, touch before lift before land.)
      const a = (t - f.touch) / (f.lift - f.touch);
      const b = (t - f.lift) / (f.land - f.lift);
      const aS = a * a * (3 - 2 * a);
      const bRest = 1 - b * b * (3 - 2 * b);
      const aLo = a <= 0;
      const aHi = a >= 1;
      const bLo = b <= 0;
      const bHi = b >= 1;
      const up = aLo ? 0 : aHi ? 1 : aS;
      const restOn = bLo ? 1 : bHi ? 0 : bRest;
      const held = this.kAlong - this.aIn;
      const easing = this.holdLift * restOn;
      this.rideY = this.y0 - this.kLine + this.top * up;
      this.holdBack = t > f.lift ? easing : held > 0 ? held : 0;
    } else {
      // (Up from the take-off by the face, down past the far side by the landing; each span at least `RIDE_LEAST`.)
      const a = (t - this.tR0) / (this.tIn - this.tR0);
      const b = (t - this.tOut) / (this.tD - this.tOut);
      const aS = a * a * (3 - 2 * a);
      const bRest = 1 - b * b * (3 - 2 * b);
      const need = this.rideTop - this.kLine;
      const aLo = a <= 0;
      const aHi = a >= 1;
      const bLo = b <= 0;
      const bHi = b >= 1;
      const up = aLo ? 0 : aHi ? 1 : aS;
      const rest = bLo ? 1 : bHi ? 0 : bRest;
      this.rideY = need > 0 ? need * rest * up : 0;
      this.holdBack = 0;
    }
    // (A clamber's rise less the figure's own comes back to nought only to within a rounding: a nanometre is nothing kept off.)
    this.crouchedNow = this.rideY > RIDE_NONE || this.holdBack > RIDE_NONE;
  }

  /** The body on the path at the clock (`t`), the figure's offset against it, and the heading. */
  private place(b: LedgeBody): void {
    const f = this.f;
    const t = this.t;
    const s = this.k;
    const P = vaultPathAt(f, t);
    let along = s * (P - this.p0);
    if (this.stretch > 0) along += this.stretch * span(t, f.lift, f.land);
    // The figure's ground: lifted by the top's difference while the hand is on it (a clamber's as its feet come onto it), and onto
    // the ground beyond as it comes down.
    let w = 0;
    let land = 0;
    if (f.kind === 'vault') {
      // (The review's round: both of the hand's shares worked out on every frame and picked between, as `ease` does.)
      const onTop = span(t, f.leave, f.touch);
      const off = 1 - span(t, f.lift, f.land);
      w = t < f.lift ? onTop : off;
      land = span(t, f.lift, f.land);
    } else if (f.kind === 'dive') land = span(t, f.apex, f.touch);
    else w = span(t, f.leave, f.lift);
    const lift = this.shift * w;
    // The figure's own way: never under the line from the ground it left to the ground it comes down on (a top lower than the
    // clip's own lowers the figure alone, against the body); a clamber's up by the top's own height as its second foot comes onto
    // it, so it ends standing on the top whatever the figure's size.
    const yl = f.kind === 'clamber' ? this.y0 + this.top * span(t, f.touch, f.land) : this.y0 + (lift > 0 ? lift : 0) + (this.y1 - this.y0) * land;
    // The review's round (finding 3): the capsule kept out of the obstacle, against that way: a vault's and a dive's raised onto the
    // top while over it (eased up from the take-off, down past the far side); a clamber's onto the top by its first foot on it, held
    // at the face until then and let catch the figure up by its second.
    // (Its ask handed in kept fields and its answer read from them (`keepOff`): no number crosses the call, and `place` stays small
    // enough that the clip's own reads above are built into it.)
    this.kAlong = along;
    this.kLine = yl;
    this.keepOff();
    const ry = this.rideY;
    const hb = this.holdBack;
    b.pos.x = this.x0 + this.ux * (along - hb);
    b.pos.z = this.z0 + this.uz * (along - hb);
    b.pos.y = yl + ry;
    b.vel.x = 0;
    b.vel.y = 0;
    b.vel.z = 0;
    // The pack strips the clip's level travel as a straight ramp; the body is on the clip's own path, so the figure is drawn that
    // much against it along its front; and up or down by what of the figure's own place the body does not take: a clamber's figure
    // stands at the take-off ground and its lift, its clip's own climb carrying it up onto the top; a vault's by a top lower than
    // the clip's own. (And by what the capsule is kept off the obstacle: the figure where it always was.)
    this.offFwd = s * (vaultRampAt(f, t) - P) + hb;
    this.offY = f.kind === 'clamber' ? this.y0 + lift - b.pos.y : (lift < 0 ? lift : 0) - ry;
    this.heading = Math.atan2(this.ux, this.uz);
  }

  /**
   * Item 4 (maker B): what another player's game is shown of a vault. The wire carries the rig's state and no clip (an emote's would
   * play from its start at its own pace, never at this vault's clock), so the nearest pose it has, as the bars, ropes and poles do:
   * a vault's flight and a dive's (its feet off the ground until its hands are down beyond) the falling loop, `'air'`, its place the
   * figure's hips (`peerPlace`); a dive's roll and a clamber's climb onto the top `'crouch'` at the body's place; a clamber played
   * whole, from its second foot on the top, `'idle'` (standing up on it); the run-in and the landing run on the rig's own state (null:
   * the run the speed classes left). Null outside a vault.
   */
  wireState(): 'air' | 'crouch' | 'idle' | null {
    if (this.phase === VAULT_NONE) return null;
    const f = this.f;
    const t = this.t;
    if (f.kind === 'vault') return t >= f.leave && t < f.land ? 'air' : null;
    if (f.kind === 'dive') return t >= f.leave && t < f.touch ? 'air' : t >= f.touch && t < f.land ? 'crouch' : null;
    if (t >= f.touch && t < f.land) return 'crouch';
    return t >= f.land ? 'idle' : null;
  }

  /**
   * Item 4 (maker B): where another player's game stands the figure while the wire says `'air'`: its feet under this figure's hips (at
   * `hx`, `hy`, `hz` in the world) by the hips' rest height scaled to the figure (`LEDGE_REST.hips`, the human male's 1.002 m), so the
   * falling loop's figure goes over the obstacle where this one does; never lower than the obstacle's top while the hips are over it
   * (a body's breadth either side of its span along the travel: the falling loop's legs hang straight, where this figure's swing
   * over the top), nor than the ground on either side of it. Written into `out`.
   */
  peerPlace<V extends { x: number; y: number; z: number }>(out: V, hx: number, hy: number, hz: number): V {
    const feet = hy - this.k * LEDGE_REST.hips;
    const along = (hx - this.x0) * this.ux + (hz - this.z0) * this.uz;
    const r = this.k * LEDGE_CAPSULE.r;
    const floor = along >= this.face - r && along <= this.face + this.depth + r ? this.y0 + this.top : along < this.face ? this.y0 : this.y1;
    out.x = hx;
    out.y = feet > floor ? feet : floor;
    out.z = hz;
    return out;
  }

  /** The console's record of the vault (numbers rounded). */
  report(): Record<string, unknown> {
    const n = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);
    return {
      on: this.holding,
      clip: this.holding ? this.clip : null,
      kind: this.holding ? this.kind : null,
      t: this.holding ? n(this.t) : null,
      rate: this.holding ? n(this.rate) : null,
      last: { verdict: this.verdict || null, top: n(this.seenTop), depth: n(this.seenDepth), face: n(this.seenFace), land: [n(this.landX), n(this.landY), n(this.landZ)] },
      under: this.vaults + this.dives + this.clambers > 0 ? { clip: this.clip, top: n(this.top), depth: n(this.depth), shift: n(this.shift), stretch: n(this.stretch), speed: n(this.speed), rate: n(this.rate), from: n(this.t0) } : null,
      counts: { vaults: this.vaults, dives: this.dives, clambers: this.clambers, cuts: this.cuts, frames: this.frames, casts: this.casts },
      // The review's round: the capsule kept off the obstacle this frame (raised, held back, crouched), and whether the camera passes it.
      capsule: { up: n(this.rideY), back: n(this.holdBack), crouched: this.crouchedNow },
      camera: this.cameraCollider() !== null ? 'passes the obstacle' : 'blocked by it',
    };
  }
}

/**
 * The furthest ahead of the body (human male metres, from its middle to the face) any clip asks to start at its own start: a
 * vault's hand, a clamber's (`clamberHandIn`'s start, ahead of the face), a dive's apex over a shallow obstacle's middle.
 */
export const VAULT_REACH = Math.max(...Object.values(VAULT_FACTS).map((f) => (f.kind === 'dive' ? f.apexZ : f.handZ) - f.pathZ[0]));
