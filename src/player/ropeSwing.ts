// Climbing II, phase 4: hanging from a rope, climbing it and swinging on it (the owner's "rope climbing and swinging", 2026-11-16),
// under `climb.ropes` 'on'.
//
// A rope is src/player/hangingRope.ts's: an anchor, a length and a swing of its own, no collider at all. One class, `RopeSwing`,
// holds a body on one, stepped by the player's update and by the node harness alike (tools/swg/tests/grappleBody.ts), at the
// places the bars are (src/player/barSwing.ts):
//  - `sense`, after the move (after the bars'): with the use key handed to the climb (`LedgeIn.use`, the game's one use-key
//    dispatch), a rope whose line passes through the hands' reach band over the feet (the ledges' `climb.reachLow` to
//    `reachHigh`, as far out as `reachAhead`, scaled by the figure, swept over the frame's rise or fall) is grabbed at the height
//    met: where the hanging clip's hands are over its feet (`ROPE_FACTS.grip`), held to the rope; standing by it, jumping or
//    falling past it (no faster than `climb.grabFall`), where the hanging body has room. The body is carried onto it over
//    `climb.ropeGrab`, the body's speed along the swing carried into it (`climb.ropeCarry`, held to the largest swing).
//  - `step`, in place of the movement while it holds the body: the body hangs on the rope as a pendulum from the anchor at the
//    body's place along it (the hands `s` down the rope, the rope's stretch `e`, the body's middle `ROPE_FACTS.hang` under the
//    hands), its angle and its angular momentum integrated on the physics' own steps (the caller hands it the steps the coming
//    physics step takes, `Physics.stepsAhead`), so it swings alike at every frame rate. W and S climb (`climb.ropeClimb`), the
//    radius changing with the climb and the angular momentum kept (a pendulum's own: shorter, it swings faster), stopping at the
//    top (`ROPE_TOP` under the anchor) and the bottom (`ROPE_END` from its end, or where the body meets something, the ground);
//    the pump keys (`climb.ropeKeys`: 'ad' A toward the view's way and D away from it; 'ws' W and S as well while it swings)
//    push it on at the swing's own phase by `climb.ropePush`, up to `climb.ropeMost`, and it dies away by `climb.ropeDamp`; the
//    swing's plane turns toward the view at `climb.ropeTurn`; the rope gives under the body (`climb.ropeGive` at its whole
//    length, a spring of the rope's own frequency); a swing into something still stops there. Space and the crouch let go (the
//    plain let-go: the swing's own velocity, and straight down), which phase 4's item 4 builds on.
// What the figure plays is the rope's three clips (src/anim/ropeClips.ts): `hanging` still, `climbing_a_rope` while it climbs
// (its phase driven by the way climbed, forward up and backward down), and `start_swinging`'s swing from 1.07 s while it swings
// (past `climb.ropeSwingFrom`), its time by the pendulum's angle as the bar's is (the largest swing either way the run's two
// ends); `placeFigure` puts the clip's grip on the rope's and turns the figure about its own left so its hips stand on the
// rope's line. `mode` and its changes say which, for the caller's rig (src/player/hangClips.ts's `driveRopeClips`).
//
// Nothing here makes an object on a frame: every ask and answer is a kept record, and the engine's own answers (a shape test's)
// are the only things made.

import type { RAPIER } from '../core/physics.ts';
import { STILL_FLAGS } from './stairSense.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { ROPE_CLIP_NAMES, ROPE_FACTS, ROPE_MODE_CLIMB, ROPE_MODE_HANG, ROPE_MODE_SWING, ROPE_SWING, ROPE_SWING_TWIN, RopePose, type RopeTables } from '../anim/ropeClips.ts';
import { ROPE_BAND_BETWEEN, ROPE_BAND_CLIPS, ROPE_BAND_FROM, ROPE_BAND_KNEE, ROPE_BAND_LEVEL, ROPE_BAND_NAMES, ROPE_BAND_WAIST, ROPE_FLIGHT_CLIP, ROPE_LAND_FACTS, ROPE_TIMES, RopeLandPose, type RopeLandTables } from '../anim/ropeClips.ts';
import { LEDGE_CAPSULE, type LedgeBody, type LedgeIn } from './ledge.ts';
import { LEDGE_FACTS, LEDGE_REST, LEDGE_ROLES } from '../anim/ledgeClips.ts';
import { HangingRope, ROPE_STEP } from './hangingRope.ts';

export { ROPE_STEP };
/** How high the body's middle stands over its feet (the standing capsule's: what the hanging capsule is placed by). */
const ROPE_MID = LEDGE_CAPSULE.r + LEDGE_CAPSULE.stand;
/** The hands go no nearer the anchor than this, metres (a mechanic: a hand's width under what the rope hangs from). */
export const ROPE_TOP = 0.25;
/** Nor nearer the rope's end than this, metres (a mechanic: a fist round its last few centimetres). */
export const ROPE_END = 0.1;
/** How far past the fastest frame's fall or rise the reach band is swept (a mechanic: the frame's own, no more). */
const SWEEP_MOST = 0.6;
/** The rope's stretch is a spring this much short of critical damping (a mechanic: a catch bounces once or twice and settles). */
const GIVE_DAMP = 0.3;
/** The least stretch the spring is worked out for, metres (a mechanic: stiffer than this the step could not follow it). */
const GIVE_LEAST = 0.01;
/** How far the hands may climb, or the rope give, before the swing's room is asked again, metres (a mechanic: a hand's width). */
const OPEN_SLIP = 0.25;
/** How far the swing's plane may turn before its room is asked again, radians (a mechanic: three degrees). */
const OPEN_TURN = (3 * Math.PI) / 180;
/** The swing is held under this much of a swing, radians (a mechanic: past the rope's side it would go slack, which is not built), and its cosine. */
const ROPE_SLACK = (85 * Math.PI) / 180;
const COS_SLACK = Math.cos(ROPE_SLACK);
/** The hanging body's capsule is asked this much wider than it stands, metres (a mechanic: the engine's own answers flicker within a centimetre of a touch). */
const ROOM_SKIN = 0.02;
/** A climb down stops this far short of something under the body, metres (a mechanic: clear of that same touch, which reads near a centimetre either way, and of a climb's step). */
const ROOM_BACK = 0.06;
/** A swing falls back to the still hang under this share of `climb.ropeSwingFrom` (a mechanic: a band, so it never flickers). */
const SWING_BACK = 0.5;
/** Moving across the ground faster than this at the grab, the swing's plane is the body's way, not the view's (a mechanic). */
const GRAB_MOVING = 0.5;

/** Maker B, item 4: a let-go slower than this across the ground has nowhere it is flying to, m/s: the plain let-go (a mechanic). */
const LAND_MOVING = 1;
/** Maker B: a let-go flying more against the body's facing than this share of its way lands nowhere: the plain let-go (the clips land facing their way; a mechanic, cos 60 degrees). */
const LAND_ALONG = 0.5;
/** Maker B: how far short of what the flying capsule meets it is stood, metres (the bars' `FLY_SKIN`: the character controller's own skin). */
const FLY_SKIN = 0.01;
/** Maker B: a contact whose normal stands up at least this much is a top met from above (the bars' `FLY_GROUND`: cos 55 degrees, the climb's walkable). */
const FLY_GROUND = 0.57;
/** Maker B: a flight is looked along, and flown, at most this long, seconds (the bars' backstop, no number of feel). */
const FLY_MOST = 3;
/** Maker B: a top met from above whose normal leans back toward the body more than this (its level part) is the top's edge, landed on as a face whose top is under the feet (a mechanic: a flat top's normal stands straight up; sin 11 degrees). */
const EDGE_LEAN = 0.2;
/** Maker B: the top of a face met is looked for this far in past its face, metres (a mechanic: a hand's width over the edge). */
const PROBE_IN = 0.12;
/** Maker B: and from this far over the highest landing a face may have (a mechanic: clear of the band, under a low beam's reach). */
const PROBE_OVER = 0.3;
/** Maker B: a landing's carry onto the top is at least this long, seconds (a mechanic: a step's own time, so a landing whose clip stands at once never snaps). */
const LAND_LEAST = 0.2;
/** Maker B: of a landing's carry, the rise up the face takes this share and the move in over the top the rest (a mechanic: the body clears the lip before it goes in over it). */
const LAND_RISE = 0.7;
/**
 * The fixer: a landing's carry (`carryClear`) is asked for room every this much of its way, metres (the ledges' own `PATH_EVERY`:
 * under half the capsule's radius, so nothing as thick as a lintel passes between two asks).
 */
const CARRY_EVERY = 0.15;
/** The fixer: the carry's capsule is asked this much thinner than the body's, metres (the wall climb's own skin: it rises beside the face it lands on, and touching that is no want of room). */
const CARRY_SKIN = 0.02;
/** The fixer: and its feet this far over the top on the way in over it, metres (a hair, as the stand's own ask). */
const CARRY_LIFT = 0.01;
/**
 * The fixer: a top met from above is stood on where the feet came down only where the top is under the body's middle: a ball
 * dropped from this far over the feet, metres, meets it no further than `OVER_TOP_DOWN` under them (mechanics: a hand's width each
 * way). Else the feet came down on its edge with the middle out past its face, and the landing is the face's, in past it.
 */
const OVER_TOP_UP = 0.1;
const OVER_TOP_DOWN = 0.15;
/** Maker B: the free hang's idle (what another player's game is told a rope's hang is: the nearest pose the wire has), its grip over its feet, as the bars'. */
const PEER_IDLE = LEDGE_FACTS[LEDGE_ROLES.free.idle];
const PEER_OVER = PEER_IDLE ? PEER_IDLE.g0[1] - (PEER_IDLE.a0 - LEDGE_REST.ankle) : 1.9;

/** The phase: holding nothing, carried onto the rope (a grab), or on it; maker B's two after a let-go: flying to a lip, and landing on it. */
export const ROPE_NONE = 0;
export const ROPE_GRAB = 1;
export const ROPE_HANG = 2;
export const ROPE_FLY = 3;
export const ROPE_LAND = 4;

/** Maker B: why a flight off a rope ended ('' while it flies, and for a let-go that flew nowhere): landed, met a wall, in the water, held too long. */
export type RopeFlyEnd = '' | 'landed' | 'wall' | 'water' | 'long';

/** What the figure plays on the rope: the still hang, the climb, or the swing (src/anim/ropeClips.ts's, which the rig's hand-over reads too). */
export const MODE_HANG = ROPE_MODE_HANG;
export const MODE_CLIMB = ROPE_MODE_CLIMB;
export const MODE_SWING = ROPE_MODE_SWING;

/** The little of a physics world the ropes ask (rapier's `World`). */
export interface RopeWorld {
  intersectionWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider): RAPIER.Collider | null;
  /**
   * Maker B: a shape swept along a step (the engine's shape cast): the flying capsule, and the ball that looks for a face's top.
   * Its normal1 is the met surface's own, out toward what was cast (measured: a capsule flown into a wall facing -x answers
   * normal1 -x), its witness1 the point met on that surface, the world's frame.
   */
  castShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shapeVel: { x: number; y: number; z: number }, shape: RAPIER.Shape, targetDistance: number, maxToi: number, stopAtPenetration: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): { time_of_impact: number; normal1: { x: number; y: number; z: number }; witness1: { x: number; y: number; z: number } } | null;
}

/** The engine's two shapes the ropes ask with, handed in once (so this file loads under node with no engine of its own). */
export interface RopeMakers {
  cuboid(hx: number, hy: number, hz: number): RAPIER.Cuboid;
  capsule(halfHeight: number, radius: number): RAPIER.Shape;
}

/** A smooth step, nought to one. */
const ease = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export class RopeSwing {
  phase = ROPE_NONE;
  /** The ropes this body may grab (the caller's: the course's, the console's), and the one held. */
  ropes: HangingRope[] = [];
  rope: HangingRope | null = null;
  /** The hands down the rope from the anchor (its rest length), metres; the rope's stretch now and its speed. */
  s = 0.5;
  e = 0.5;
  ev = 0.5;
  /** The swing's plane (level, unit) and the heading the body faces along it. */
  fx = 0.5;
  fz = 0.5;
  heading = 0.5;
  /** The pendulum: its angle (radians, nought straight down, positive along the plane) and speed. */
  th = 0.5;
  om = 0.5;
  /** The angle at the frame's own time (the steps' state led by the physics' remainder): what the figure and the rope are drawn at. */
  thDraw = 0.5;
  /** The body's middle under the hands, metres (`ROPE_FACTS.hang`, scaled at the grab). */
  hang = 0.5;
  /** A grab's carry: its clock on the steps and its length, the body's middle at the grab, and its frame clock (the drawn ease). */
  grabT = 0.5;
  grabDur = 0.5;
  fromX = 0.5;
  fromY = 0.5;
  fromZ = 0.5;
  reachT = 0.5;
  /** Written by the caller before `step`: how many of the physics' steps the coming one takes, and how far the bodies stand behind the frame now. */
  steps = 0;
  behind = 0.5;
  /** The way climbed up the rope since the grab, metres (the climb clip's phase: `placeFigure`), and this frame's share of it. */
  climbed = 0.5;
  climbNow = 0.5;
  /** What the figure plays, and what it played the frame before (the rig's hand-over reads the change). */
  mode = MODE_HANG;
  lastMode = MODE_HANG;
  /** The swing's clip now (the clip or its twin, taken in turn so a swing begun again crossfades from the last), by its rig name. */
  swingName: string;
  /** The swing's clip's time to hold it at, and the loop's (the hang's or the climb's, whichever plays: NaN none). */
  poseT = 0.5;
  loopT = 0.5;
  /** The still hang's own clock, seconds into its clip (the figure's pose and the rig's clip put at one time). */
  private hangT = 0.5;
  /** The drawn figure against the body (the world's frame), and its turn about its own left. */
  offX = 0.5;
  offY = 0.5;
  offZ = 0.5;
  tilt = 0.5;
  /** A mode's change: the placement it eases from over `climb.ease`, and how far it is. */
  private fromOffX = 0.5;
  private fromOffY = 0.5;
  private fromOffZ = 0.5;
  private fromTilt = 0.5;
  private modeT = 0.5;
  /** The grab's own frame (the caller's rig takes up the rope's clips), and the let-go's (it lets go of them). */
  startClip = false;
  ended = false;
  private fresh = false;
  /** After a let-go: the drawn offset eased out over this long more (seconds left, and the whole), and the rope not grabbed again for `regrab`. */
  outT = 0.5;
  outDur = 0.5;
  private regrabT = 0.5;
  private regrabRope: HangingRope | null = null;
  /** Said on the message line (a refusal in words), '' for nothing; the caller hands it on. */
  said = '';
  private saidRope: HangingRope | null = null;
  /** The frames held, the shape tests asked (the engine's own answers: what a frame makes), the grabs and the climb's stops. */
  frames = 0;
  casts = 0;
  grabs = 0;
  /** Where the climb last stopped ('' climbing or not, 'top', 'end', 'met': the ground or something still under the body). */
  stop = '';
  /** The frame's own time step (handed to `placeFigure`'s eases). */
  private dtNow = 0.5;

  // ---- maker B, item 4: the let-go into a landing, and item 5's ---------------------------------------------------------------

  /** The let-go's tables measured off the caller's rig (the flight's and each landing's): set by the caller; null, drawn on the body. */
  landTables: RopeLandTables | null = null;
  /** The flight's velocity, its time flown on the steps and the frame's own time past them, the feet's highest (the fall's memory). */
  vx = 0.5;
  vy = 0.5;
  vz = 0.5;
  flyT = 0.5;
  private flyRem = 0.5;
  flyTop = 0.5;
  /** Where the caller holds the fall's memory this frame: the flight's top while flying (and the frame it ends), else the body's feet. */
  apexY = 0.5;
  /** The feet at the let-go, and the flight's time to its arrival as the let-go foresaw it (what the flight's clip is fitted to). */
  private relY = 0.5;
  fT = 0.5;
  /** The landing foreseen at the let-go, then the one met (-1 none): its band, whether it is a face (else a top met from above), the face's place and its way out, the top, and where the body stands up on it. */
  band = -1;
  private face = false;
  private fpx = 0.5;
  private fpz = 0.5;
  private fnx = 0.5;
  private fnz = 0.5;
  top = 0.5;
  standX = 0.5;
  standY = 0.5;
  standZ = 0.5;
  /** The landing: its time on the steps and its whole, the feet where it began, and the figure's placement it eases from. */
  landT = 0.5;
  landDur = 0.5;
  /** Of it, the rise up the face (its band's clip's own share, `LAND_RISE`); the rest is the move in over the top, no faster than `climb.ropeLandWalk`. */
  riseDur = 0.5;
  private cx = 0.5;
  private cy = 0.5;
  private cz = 0.5;
  private landFrame = 0.5;
  /** Why the last flight ended, and the counts of flights, of each band's landings and of plain let-goes (the console's and the tests'). */
  flyEnd: RopeFlyEnd = '';
  flights = 0;
  readonly landings = [0, 0, 0, 0];
  plains = 0;
  /**
   * The clip the flight and the landing play, by its rig name (made once: the level clip's in the flight, a band's after), and its
   * time to put it at (NaN: none); the frames the caller's rig begins the flight's clip, begins a landing's, and lets go of them.
   */
  airClip: string;
  airT = 0.5;
  startFly = false;
  startLand = false;
  landedNow = false;
  /** The feet's height under which the body swims (the water's surface less the swim's depth; -Infinity for none): set by the caller before `step`. */
  swimLine = 0.5;
  /**
   * After a landing, while the drawn offset eases out over the rig's own fade of the landing's clip into the crouch: the height
   * the drawn lower ankle is held at no lower than (the top, and the ankle's own rest over it, scaled), NaN otherwise. The rig's
   * crossfade of a clip authored hanging over a ground of its own into one stood on the root's moves the feet by more than the
   * offset's ease does, and in node they reached 0.18 m into the top for the fade's length; the caller lifts the drawn figure by
   * what the ankle stands under it (src/player/player.ts's `applyRopeRoot`).
   */
  plantY = 0.5;
  /** The drawn lower ankle's height over the rig's root (the root's frame, scaled), written by the caller before `plantFeet`. */
  ankleLow = 0.5;
  /** A blow hard enough was taken (`knock`): the body comes off, straight down, at the next step. */
  private knocked = false;
  /** The flying capsule, the ball the top is looked for with, and the swept step's way (a kept record). */
  private flyCap: RAPIER.Shape | null = null;
  private probe: RAPIER.Shape | null = null;
  /** The fixer: the carry's capsule (`carryClear`, the standing one a skin thinner), made once. */
  private carryCap: RAPIER.Shape | null = null;
  private readonly castVel = { x: 0, y: 0, z: 0 };
  private readonly landPose = new RopeLandPose();

  private readonly makers: RopeMakers;
  private cap: RAPIER.Shape | null = null;
  /** The swing's room (`openAt`): its box, the half sizes it was made at, its turn, the radius and plane it was asked at, whether clear. */
  private openBox: RAPIER.Cuboid | null = null;
  private openMid = 0.5;
  private openR = 0.5;
  private openYaw = 0.5;
  private openMost = 0.5;
  private open = false;
  private readonly openRot = { x: 0, y: 0, z: 0, w: 1 };
  private readonly at = { x: 0, y: 0, z: 0 };
  private readonly still = { x: 0, y: 0, z: 0, w: 1 };
  private readonly pose = new RopePose();
  /** The search's best so far. */
  private bestRope: HangingRope | null = null;
  private bestS = 0.5;
  private bestD = 0.5;

  constructor(makers: RopeMakers) {
    this.makers = makers;
    this.swingName = ROPE_CLIP_NAMES[ROPE_SWING];
    this.s = 0;
    this.e = 0;
    this.ev = 0;
    this.fx = 0;
    this.fz = 1;
    this.heading = 0;
    this.th = 0;
    this.om = 0;
    this.thDraw = 0;
    this.hang = ROPE_FACTS.hang;
    this.grabT = 0;
    this.grabDur = 0;
    this.fromX = 0;
    this.fromY = 0;
    this.fromZ = 0;
    this.reachT = 0;
    this.behind = 0;
    this.climbed = 0;
    this.climbNow = 0;
    this.poseT = Number.NaN;
    this.loopT = Number.NaN;
    this.hangT = 0;
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.tilt = 0;
    this.fromOffX = 0;
    this.fromOffY = 0;
    this.fromOffZ = 0;
    this.fromTilt = 0;
    this.modeT = 0;
    this.outT = 0;
    this.outDur = 0;
    this.regrabT = 0;
    this.dtNow = 0;
    this.openMid = 0;
    this.openR = 0;
    this.openYaw = 0;
    this.openMost = 0;
    this.bestS = 0;
    this.bestD = 0;
    this.airClip = ROPE_FLIGHT_CLIP;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.flyT = 0;
    this.flyRem = 0;
    this.flyTop = 0;
    this.apexY = 0;
    this.relY = 0;
    this.fT = 0;
    this.fpx = 0;
    this.fpz = 0;
    this.fnx = 0;
    this.fnz = 0;
    this.top = 0;
    this.standX = 0;
    this.standY = 0;
    this.standZ = 0;
    this.landT = 0;
    this.landDur = 0;
    this.riseDur = 0;
    this.cx = 0;
    this.cy = 0;
    this.cz = 0;
    this.landFrame = 0;
    this.airT = Number.NaN;
    this.swimLine = Number.NEGATIVE_INFINITY;
    this.plantY = Number.NaN;
  }

  /** Maker B: the hands on the rope (carried onto it, or on it), not flying off it or landing. */
  get onRope(): boolean {
    return this.phase === ROPE_GRAB || this.phase === ROPE_HANG;
  }

  /** Maker B: in the flight off the rope to a lip, or landing on it. */
  get flying(): boolean {
    return this.phase === ROPE_FLY || this.phase === ROPE_LAND;
  }

  /**
   * Maker B: a blow of `amount` health taken (what the player's and the harness's frame find lost since the last frame on the
   * rope): one of `climb.barKnock` or more knocks the body off at the next step, straight down, as off a bar.
   */
  knock(amount: number): void {
    if (this.onRope && amount >= CLIMB_TUNE.barKnock) this.knocked = true;
  }

  /**
   * Maker B: where another player's game is told the body is while it hangs on the rope (the wire carries a rig state and a
   * place, not a rope's swing): the place a free hang whose idle has its hands on the grip stands at, as the bars' (that game's
   * own `PeerHang` lines its free hang's hands up there), into `out`. The rope itself goes as a held rope from its anchor to
   * their hand (src/main.ts's `ropeForWire`).
   */
  peerPlace<V extends { x: number; y: number; z: number }>(out: V): V {
    const r = this.rope;
    const k = this.hang / ROPE_FACTS.hang;
    const g = this.s + this.e;
    const sn = Math.sin(this.thDraw);
    const gx = r ? r.ax + g * sn * this.fx : out.x;
    const gy = r ? r.ay - g * Math.cos(this.thDraw) : out.y;
    const gz = r ? r.az + g * sn * this.fz : out.z;
    const lx = PEER_IDLE ? k * PEER_IDLE.g0[0] : 0;
    const lz = PEER_IDLE ? k * PEER_IDLE.g0[2] : 0;
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    out.x = gx - (lx * ch + lz * sh);
    out.y = gy - k * PEER_OVER;
    out.z = gz - (-lx * sh + lz * ch);
    return out;
  }

  /** Holding the body (carried onto the rope, or on it). */
  get holding(): boolean {
    return this.phase !== ROPE_NONE;
  }

  /** The drawn figure is still off the body's place (holding, or easing out after a let-go). */
  get offset(): boolean {
    return this.offX !== 0 || this.offY !== 0 || this.offZ !== 0 || this.tilt !== 0;
  }

  /** The action bar's word for the rope ('hang' on it: Space lets go, the crouch drops; maker B's 'fly' flying off it or landing: nothing to press; '' not). */
  promptWord(): '' | 'hang' | 'fly' {
    return this.flying ? 'fly' : this.phase !== ROPE_NONE ? 'hang' : '';
  }

  /** A rope stood (the course's, the console's): one this body may grab. */
  add(r: HangingRope): void {
    if (this.ropes.indexOf(r) < 0) this.ropes.push(r);
  }

  /** A rope taken down: let go of first where it is the one held. */
  remove(r: HangingRope): void {
    if (this.rope === r) this.reset('the rope came down');
    const i = this.ropes.indexOf(r);
    if (i >= 0) this.ropes.splice(i, 1);
  }

  /** Let go outright (stood elsewhere, off the feet, a world unloaded, the rope taken down): nothing held, nothing drawn off the body. */
  reset(why: string): void {
    void why;
    if (this.phase !== ROPE_NONE) this.ended = true;
    if (this.rope) {
      this.rope.held = false;
      this.rope = null;
    }
    this.phase = ROPE_NONE;
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.tilt = 0;
    this.poseT = Number.NaN;
    this.loopT = Number.NaN;
    this.outT = 0;
    this.om = 0;
    // (Maker B: and a flight or a landing, with nothing of it left for the rig but the let-go.)
    this.knocked = false;
    this.airT = Number.NaN;
    this.startFly = false;
    this.startLand = false;
    this.landedNow = false;
    this.plantY = Number.NaN;
  }

  // ---- finding a rope ---------------------------------------------------------------------------------------------------

  /**
   * The nearest rope whose line passes through the hands' reach band of a body with its feet at `pos` into `bestRope` (its
   * hands `bestS` down it); false for none. A rope's line is its swing's now (it may be swinging by itself); the hands are taken
   * where the hanging clip has them over the feet, held to the rope's top and end and to the band.
   */
  private search(pos: { x: number; y: number; z: number }, vy: number, li: LedgeIn): boolean {
    const sc = li.scale;
    const sweep = Math.min(SWEEP_MOST, Math.abs(vy) * li.dt);
    const lo = pos.y + CLIMB_TUNE.reachLow * sc - (vy > 0 ? sweep : 0);
    const hi = pos.y + CLIMB_TUNE.reachHigh * sc + (vy < 0 ? sweep : 0);
    const want = pos.y + ROPE_FACTS.grip * sc;
    const ahead = CLIMB_TUNE.reachAhead * sc;
    this.bestRope = null;
    this.bestD = Infinity;
    const list = this.ropes;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r === this.regrabRope && this.regrabT > 0) continue;
      const c = Math.cos(r.th);
      if (c < 0.2) continue;
      const sn = Math.sin(r.th);
      const top = ROPE_TOP * sc;
      const end = r.len - ROPE_END * sc;
      if (end <= top) continue;
      let t = (r.ay - want) / c;
      if (t < top) t = top;
      if (t > end) t = end;
      const px = r.ax + sn * r.fx * t;
      const py = r.ay - c * t;
      const pz = r.az + sn * r.fz * t;
      if (py < lo || py > hi) continue;
      const dx = px - pos.x;
      const dz = pz - pos.z;
      const l2 = dx * dx + dz * dz;
      if (l2 > ahead * ahead) continue;
      const d = l2 + (py - want) * (py - want);
      if (d < this.bestD) {
        this.bestD = d;
        this.bestRope = r;
        this.bestS = t;
      }
    }
    return this.bestRope !== null;
  }

  /** The hanging capsule (its middle `R` down the line at `th`, in the plane) clear of everything still. */
  private room(world: RopeWorld, r: HangingRope, R: number, th: number, li: LedgeIn): boolean {
    let cap = this.cap;
    if (!cap) cap = this.cap = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r + ROOM_SKIN);
    const sn = Math.sin(th);
    this.at.x = r.ax + R * sn * this.fx;
    this.at.y = r.ay - R * Math.cos(th);
    this.at.z = r.az + R * sn * this.fz;
    this.casts++;
    return world.intersectionWithShape(this.at, this.still, cap, STILL_FLAGS, li.filter) === null;
  }

  /**
   * Whether the whole of the swing's room is clear at the radius now: one box round every place the hanging body may swing to
   * (its capsule at the largest swing either way, at the radius and a hand's width more or less), asked at the grab and again
   * only as the radius or the plane moves on (an event). Open, the swing's steps ask nothing; shut (something near), each step
   * asks for its own capsule.
   */
  private openAt(world: RopeWorld, li: LedgeIn): void {
    const r = this.rope;
    if (!r) return;
    const R = this.s + this.e + this.hang;
    const most = (CLIMB_TUNE.ropeMost * Math.PI) / 180;
    const cr = LEDGE_CAPSULE.r;
    const ch = LEDGE_CAPSULE.stand + cr;
    const far = R + OPEN_SLIP;
    const near = Math.max(0, R - OPEN_SLIP);
    // (The step's own capsule's skin, and under it the hand's breadth a way down the rope keeps clear: the box holds what the steps would ask.)
    const hf = far * Math.sin(most) + cr + ROOM_SKIN;
    const bottom = -far - ch - ROOM_SKIN - ROOM_BACK;
    const top = -near * Math.cos(most) + ch + ROOM_SKIN;
    const hy = (top - bottom) / 2;
    const hu = cr + ROOM_SKIN;
    // Made once and sized in place after (the engine reads the box's half extents at each ask): a climb makes no shape.
    if (this.openBox === null) this.openBox = this.makers.cuboid(hu, hy, hf);
    else {
      const x = this.openBox.halfExtents;
      x.x = hu;
      x.y = hy;
      x.z = hf;
    }
    this.openMid = (top + bottom) / 2;
    this.openR = R;
    this.openMost = CLIMB_TUNE.ropeMost;
    const yaw = Math.atan2(this.fx, this.fz);
    this.openYaw = yaw;
    this.at.x = r.ax;
    this.at.y = r.ay + this.openMid;
    this.at.z = r.az;
    // Turned so its own z lies along the swing's plane (a turn about up).
    this.openRot.x = 0;
    this.openRot.y = Math.sin(yaw / 2);
    this.openRot.z = 0;
    this.openRot.w = Math.cos(yaw / 2);
    this.casts++;
    this.open = world.intersectionWithShape(this.at, this.openRot, this.openBox, STILL_FLAGS, li.filter) === null;
  }

  /** Whether the use key would grab a rope here (the action bar's: in reach, with room under it). */
  canGrab(world: RopeWorld, body: LedgeBody, li: LedgeIn): boolean {
    if (CLIMB_TUNE.ropes !== 'on' || this.holding || li.busy) return false;
    if (!this.search(body.pos, body.vel.y, li)) return false;
    return this.roomFor(world, body, li);
  }

  /** The found rope taken as the one to hold (its plane by the body's way, or the view's), and whether the hang has room. */
  private roomFor(world: RopeWorld, body: LedgeBody, li: LedgeIn): boolean {
    const r = this.bestRope as HangingRope;
    const vx = body.vel.x;
    const vz = body.vel.z;
    const lv = Math.sqrt(vx * vx + vz * vz);
    let fx = 0;
    let fz = 1;
    if (lv > GRAB_MOVING) {
      fx = vx / lv;
      fz = vz / lv;
    } else {
      const yaw = li.viewYaw === li.viewYaw ? li.viewYaw : li.heading;
      fx = Math.sin(yaw);
      fz = Math.cos(yaw);
    }
    this.fx = fx;
    this.fz = fz;
    this.hang = ROPE_FACTS.hang * li.scale;
    this.s = this.bestS;
    const th = this.angleOf(r, body);
    return this.room(world, r, this.s + this.hang, th, li);
  }

  /** The body's middle's angle about the rope's anchor in the swing's plane, held to the largest swing. */
  private angleOf(r: HangingRope, body: LedgeBody): number {
    const mx = body.pos.x;
    const my = body.pos.y + ROPE_MID;
    const mz = body.pos.z;
    const along = (mx - r.ax) * this.fx + (mz - r.az) * this.fz;
    const down = r.ay - my;
    const most = (CLIMB_TUNE.ropeMost * Math.PI) / 180;
    let th = Math.atan2(along, Math.max(1e-3, down));
    if (th > most) th = most;
    if (th < -most) th = -most;
    return th;
  }

  /**
   * After the move: a rope grabbed with the use key (see the header). True where the rope took the body (its place and heading
   * are written; the caller zeroes the movement's memories and hands its rig the rope's clips).
   */
  sense(world: RopeWorld, body: LedgeBody, li: LedgeIn): boolean {
    if (CLIMB_TUNE.ropes !== 'on' || this.holding) return false;
    if (!li.use) this.saidRope = null;
    if (!li.use || li.busy) return false;
    const vy = body.vel.y;
    if (vy < -CLIMB_TUNE.grabFall) return false;
    if (!this.search(body.pos, vy, li)) return false;
    if (!this.roomFor(world, body, li)) {
      // Said once a rope while the key is held.
      if (this.saidRope !== this.bestRope) this.said = 'No room to hang from the rope here.';
      this.saidRope = this.bestRope;
      return false;
    }
    this.saidRope = null;
    this.take(world, body, li);
    return true;
  }

  /** The grab: the pendulum started where the body is about the anchor, its speed carried; the carry begun; the swing's room asked. */
  private take(world: RopeWorld, body: LedgeBody, li: LedgeIn): void {
    const r = this.bestRope as HangingRope;
    this.rope = r;
    r.held = true;
    const th = this.angleOf(r, body);
    const R = this.s + this.hang;
    const vx = body.vel.x;
    const vy = body.vel.y;
    const vz = body.vel.z;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const most = (CLIMB_TUNE.ropeMost * Math.PI) / 180;
    // The swing's speed: the body's along the pendulum's own way at that angle, a share carried, held to the largest swing.
    let om = (CLIMB_TUNE.ropeCarry * ((vx * this.fx + vz * this.fz) * c + vy * sn)) / R;
    const g = CLIMB_TUNE.swingGravity;
    const room = Math.cos(th) - Math.cos(most);
    const omMost = room > 0 ? Math.sqrt((2 * g * room) / R) : 0;
    if (om > omMost) om = omMost;
    if (om < -omMost) om = -omMost;
    // And its speed out along the rope, the rope's stretch's: a fall caught gives.
    const out = (vx * this.fx + vz * this.fz) * sn - vy * c;
    this.th = th;
    this.om = om;
    this.thDraw = th;
    this.e = 0;
    this.ev = out > 0 ? out : 0;
    this.fromX = body.pos.x;
    this.fromY = body.pos.y + ROPE_MID;
    this.fromZ = body.pos.z;
    this.grabT = 0;
    this.reachT = 0;
    this.grabDur = CLIMB_TUNE.ropeGrab;
    this.heading = Math.atan2(this.fx, this.fz);
    this.phase = ROPE_GRAB;
    this.frames = 0;
    this.outT = 0;
    this.ended = false;
    this.climbed = 0;
    this.climbNow = 0;
    this.stop = '';
    this.mode = MODE_HANG;
    this.lastMode = MODE_HANG;
    this.modeT = 0;
    this.fromOffX = 0;
    this.fromOffY = 0;
    this.fromOffZ = 0;
    this.fromTilt = 0;
    this.startClip = true;
    this.fresh = true;
    this.poseT = Number.NaN;
    this.loopT = Number.NaN;
    this.grabs++;
    body.vel.x = 0;
    body.vel.y = 0;
    body.vel.z = 0;
    this.openAt(world, li);
    this.place(body);
    this.writeRope();
  }

  // ---- on the rope ------------------------------------------------------------------------------------------------------

  /**
   * The cosine of the largest angle the swing's energy now reaches at the radius now (below -1 where it would go over the anchor),
   * into `ac`: a frame compares it with a limit's cosine (a swing past an angle is one whose `ac` is under its cosine), so no
   * number crosses a call and no angle is worked out.
   */
  reach(): void {
    const R = this.s + this.e + this.hang;
    this.ac = Math.cos(this.th) - (R * this.om * this.om) / (2 * CLIMB_TUNE.swingGravity);
  }

  /** `reach`'s answer. */
  ac = 0.5;

  /** The swing's largest angle its energy now reaches at the radius now, radians (pi where it would go over the anchor): the console's and the tests'. */
  amplitude(): number {
    const R = this.s + this.e + this.hang;
    const c = Math.cos(this.th) - (R * this.om * this.om) / (2 * CLIMB_TUNE.swingGravity);
    return c <= -1 ? Math.PI : c >= 1 ? 0 : Math.acos(c);
  }

  /** The body's place for the pendulum now (and, carried, between where it was and there). */
  private place(body: LedgeBody): void {
    const r = this.rope;
    if (!r) return;
    const R = this.s + this.e + this.hang;
    const sn = Math.sin(this.th);
    let mx = r.ax + R * sn * this.fx;
    let my = r.ay - R * Math.cos(this.th);
    let mz = r.az + R * sn * this.fz;
    if (this.phase === ROPE_GRAB) {
      const w = ease(this.grabDur > 0 ? this.grabT / this.grabDur : 1);
      mx = this.fromX + (mx - this.fromX) * w;
      my = this.fromY + (my - this.fromY) * w;
      mz = this.fromZ + (mz - this.fromZ) * w;
    }
    body.pos.x = mx;
    body.pos.y = my - ROPE_MID;
    body.pos.z = mz;
  }

  /** The held rope told the swing as it is drawn this frame (its angle, plane, stretch and where the hands are), and laid. */
  private writeRope(): void {
    const r = this.rope;
    if (!r) return;
    r.fx = this.fx;
    r.fz = this.fz;
    r.th = this.th;
    r.om = this.om;
    r.e = this.e;
    r.gripS = this.s;
    r.thDraw = this.thDraw;
    r.lay();
  }

  /** A frame in place of the movement (the keys of `li`, the steps the caller wrote in `steps`). */
  step(world: RopeWorld, body: LedgeBody, li: LedgeIn): void {
    // (The grab's own frame keeps its start for the caller's rig, as the bars' do: 'fresh'.)
    if (!this.fresh) this.startClip = false;
    this.fresh = false;
    // (Maker B: the flight's and the landing's one-frame words for the caller's rig, put down every step.)
    this.startFly = false;
    this.startLand = false;
    this.landedNow = false;
    if (!this.holding) return;
    // Maker B, item 4: flying off the rope to a lip, or landing on it: no rope in the hands.
    // (Nothing worked out here: the flight's frames reach this method only along this branch, too little of it for the optimising
    // compiler to take it up again after the let-go's own path threw its code away, and run as it stands every number read made
    // one. `airFrame` reads the frame's time itself.)
    if (this.phase === ROPE_FLY || this.phase === ROPE_LAND) {
      this.frames++;
      this.airFrame(world, body, li);
      return;
    }
    const r = this.rope;
    if (!r) {
      this.reset('no rope');
      return;
    }
    this.frames++;
    this.dtNow = li.dt;
    // Maker B, item 5: a hard blow (`knock`) takes the hands off, straight down, as off a bar.
    if (this.knocked) {
      this.knocked = false;
      this.letGo(body, false);
      return;
    }
    // Let go: the crouch straight down, Space on the swing's own velocity (the plain let-go); maker B's 'lips' (item 4) first
    // looks along the flight for a lip to land on, and where there is one flies there held here (`release`).
    if (li.jumpPressed || li.crouchPressed) {
      if (li.jumpPressed && !li.crouchPressed && CLIMB_TUNE.ropeLand === 'lips' && this.release(world, body, li)) return;
      this.letGo(body, li.jumpPressed);
      return;
    }
    const h = ROPE_STEP;
    const n = this.steps;
    const g = CLIMB_TUNE.swingGravity;
    const most = (CLIMB_TUNE.ropeMost * Math.PI) / 180;
    const push = CLIMB_TUNE.ropePush;
    const damp = CLIMB_TUNE.ropeDamp;
    const sc = this.hang / ROPE_FACTS.hang;
    const top = ROPE_TOP * sc;
    const end = r.len - ROPE_END * sc;
    const climbSpeed = CLIMB_TUNE.ropeClimb;
    const give = CLIMB_TUNE.ropeGive;
    const turn = (CLIMB_TUNE.ropeTurn * Math.PI) / 180;
    const viewYaw = li.viewYaw;
    // The keys: which pump, which climb (`climb.ropeKeys`).
    const fromRad = (CLIMB_TUNE.ropeSwingFrom * Math.PI) / 180;
    const cosBack = Math.cos(fromRad * SWING_BACK);
    const cosMost = Math.cos(most);
    this.reach();
    const swinging = this.ac <= cosBack;
    const wsPump = CLIMB_TUNE.ropeKeys === 'ws' && swinging;
    const toward = li.leftHeld || (wsPump && li.forwardHeld);
    const away = li.rightHeld || (wsPump && li.backHeld);
    const climbDir = wsPump ? 0 : li.forwardHeld && !li.backHeld ? -1 : li.backHeld && !li.forwardHeld ? 1 : 0;
    // (The largest swing's slider moved while on the rope: the swing's room sized and asked again for it, an event.)
    if (this.openMost !== CLIMB_TUNE.ropeMost) this.openAt(world, li);
    let climbedNow = 0;
    // (Where the climb stopped is said again only on a frame that steps: a frame with no step at 144 a second keeps the last.)
    if (n > 0) this.stop = '';
    // (The ropes nobody holds swing on by themselves meanwhile: `tickRopes`, once a frame at the top of the caller's update.)
    for (let k = 0; k < n; k++) {
      // The swing's plane turned toward the view (the shorter way), at most `ropeTurn` a second.
      if (viewYaw === viewYaw) {
        const yaw = Math.atan2(this.fx, this.fz);
        let d = viewYaw - yaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const m = turn * h;
        if (d > m) d = m;
        if (d < -m) d = -m;
        if (d !== 0) {
          const ny = yaw + d;
          this.fx = Math.sin(ny);
          this.fz = Math.cos(ny);
        }
      }
      const R0 = this.s + this.e + this.hang;
      // The pump, at the swing's own phase, never past the largest swing.
      let a = 0;
      if (toward && this.om >= 0) a += push;
      if (away && this.om <= 0) a -= push;
      if (a !== 0) {
        this.reach();
        if (this.ac <= cosMost) a = 0;
      }
      // The climb, to the top and the end.
      let s1 = this.s + climbDir * climbSpeed * h;
      if (s1 < top) {
        s1 = top;
        if (climbDir < 0) this.stop = 'top';
      }
      if (s1 > end) {
        s1 = end;
        if (climbDir > 0) this.stop = 'end';
      }
      // The rope's give: a spring of its own frequency round the stretch the body's weight makes at the hands' place.
      const here = give * (s1 / Math.max(1e-3, r.len));
      const rest = here > GIVE_LEAST ? here : GIVE_LEAST;
      const w = Math.sqrt(g / rest);
      let ev = this.ev + (-w * w * (this.e - here) - 2 * GIVE_DAMP * w * this.ev) * h;
      let e1 = this.e + ev * h;
      if (e1 < 0) {
        e1 = 0;
        if (ev < 0) ev = 0;
      }
      // The pendulum on its angular momentum about the anchor (kept through a change of radius: shorter, it swings faster).
      let L = R0 * R0 * this.om;
      L += (-g * R0 * Math.sin(this.th) + a * R0 - damp * L) * h;
      let R1 = s1 + e1 + this.hang;
      let om1 = L / (R1 * R1);
      let th1 = this.th + om1 * h;
      if (!this.open) {
        // Something near. Going down the rope (a climb down, or the rope giving) stops a hand's breadth short of what is under the
        // body (the ground), clear of the engine's own tolerance about a touch, so the swing from there is never held by what it
        // only grazes: the climb taken back and the give held where it was. Asked where the body is and straight under the anchor,
        // where a swing over level ground brings it lowest.
        if (R1 > R0 && (!this.room(world, r, R1 + ROOM_BACK, th1, li) || !this.room(world, r, R1 + ROOM_BACK, 0, li))) {
          if (climbDir > 0 && s1 > this.s) this.stop = 'met';
          s1 = this.s;
          if (e1 > this.e) {
            e1 = this.e;
            if (ev > 0) ev = 0;
          }
          R1 = s1 + e1 + this.hang;
          om1 = L / (R1 * R1);
          th1 = this.th + om1 * h;
        }
        // The step's own capsule asked; met (a wall, a beam over the hands), the step is not taken and the swing stops there.
        if (!this.room(world, r, R1, th1, li)) {
          if (climbDir !== 0 && s1 !== this.s) this.stop = 'met';
          s1 = this.s;
          e1 = this.e;
          ev = 0;
          om1 = 0;
          th1 = this.th;
        }
      }
      climbedNow += this.s - s1;
      this.s = s1;
      this.e = e1;
      this.ev = ev;
      this.om = om1;
      this.th = th1;
      // Held short of going slack past the rope's side (not built): the swing's energy taken down to it.
      this.reach();
      if (this.ac < COS_SLACK) {
        const Rn = this.s + this.e + this.hang;
        const room = Math.cos(this.th) - Math.cos(ROPE_SLACK);
        const omMost = room > 0 ? Math.sqrt((2 * g * room) / Rn) : 0;
        if (this.om > omMost) this.om = omMost;
        if (this.om < -omMost) this.om = -omMost;
      }
      // The room asked again once the radius or the plane has moved on (an event).
      const Rn = this.s + this.e + this.hang;
      const yawNow = Math.atan2(this.fx, this.fz);
      let dy = yawNow - this.openYaw;
      if (dy > Math.PI) dy -= 2 * Math.PI;
      if (dy < -Math.PI) dy += 2 * Math.PI;
      if (Rn - this.openR > OPEN_SLIP || this.openR - Rn > OPEN_SLIP || dy > OPEN_TURN || dy < -OPEN_TURN) this.openAt(world, li);
      if (this.phase === ROPE_GRAB) {
        this.grabT += h;
        if (this.grabT >= this.grabDur) this.phase = ROPE_HANG;
      }
    }
    this.climbNow = climbedNow;
    this.climbed += climbedNow;
    if (this.phase === ROPE_GRAB) this.reachT += li.dt;
    // The frame's own time stands this far past the last step's (what the figure and the rope are drawn at).
    const rem = n >= 4 ? 0 : Math.min(h, Math.max(0, this.behind + li.dt - n * h));
    this.thDraw = this.th + this.om * rem;
    this.heading = Math.atan2(this.fx, this.fz);
    // What the figure plays: climbing, else a swing past `ropeSwingFrom` (back to the hang under half of it).
    this.lastMode = this.mode;
    this.reach();
    const ac = this.ac;
    if (climbedNow !== 0 || (climbDir !== 0 && this.mode === MODE_CLIMB && this.stop === '')) this.mode = MODE_CLIMB;
    else if (this.mode === MODE_SWING ? ac <= cosBack : ac <= Math.cos(fromRad)) this.mode = MODE_SWING;
    else this.mode = MODE_HANG;
    if (this.mode !== this.lastMode) {
      // The placement eased from where it is over the hang's ease; a swing begun again on the clip's other twin.
      this.fromOffX = this.offX;
      this.fromOffY = this.offY;
      this.fromOffZ = this.offZ;
      this.fromTilt = this.tilt;
      this.modeT = 0;
      if (this.mode === MODE_SWING) this.swingName = this.swingName === ROPE_SWING_TWIN ? ROPE_CLIP_NAMES[ROPE_SWING] : ROPE_SWING_TWIN;
    }
    body.vel.x = 0;
    body.vel.y = 0;
    body.vel.z = 0;
    this.place(body);
    this.writeRope();
    this.apexY = body.pos.y;
    // Maker B, item 5: the feet in the water (a rope hanging into it, climbed down or swung low) let go, straight down, into the swim.
    if (body.pos.y < this.swimLine) {
      this.letGo(body, false);
      this.flyEnd = 'water';
    }
  }

  /** Let go: the body handed the swing's own velocity (and the rope's give's), or none, straight down; the rope swings on by itself. */
  letGo(body: LedgeBody, swing: boolean): void {
    // (Maker B: flying off the rope or landing, the console's let-go hands the movement the flight as it is.)
    if (this.flying) {
      this.endAir(body, 'long');
      return;
    }
    this.plains++;
    this.apexY = body.pos.y;
    const r = this.rope;
    const R = this.s + this.e + this.hang;
    const v = swing ? R * this.om : 0;
    const c = Math.cos(this.th);
    const sn = Math.sin(this.th);
    const out = swing ? this.ev : 0;
    body.vel.x = (v * c + out * sn) * this.fx;
    body.vel.y = v * sn - out * c;
    body.vel.z = (v * c + out * sn) * this.fz;
    if (r) {
      // The rope swings on from where the body left it, at the swing's own angle and speed.
      r.held = false;
      r.th = this.th;
      r.om = this.om;
      r.fx = this.fx;
      r.fz = this.fz;
      r.e = this.e;
      r.thDraw = this.th;
      r.lay();
    }
    this.regrabRope = r;
    this.regrabT = CLIMB_TUNE.regrab;
    this.rope = null;
    this.phase = ROPE_NONE;
    this.ended = true;
    this.outDur = CLIMB_TUNE.ease;
    this.outT = this.outDur;
    this.poseT = Number.NaN;
    this.loopT = Number.NaN;
  }

  // ---- maker B, item 4: letting go into a landing -------------------------------------------------------------------------

  /**
   * Space with the hands on the rope (`climb.ropeLand` 'lips'): the swing's own velocity at this instant (the plain let-go's) and,
   * where the flight it begins meets a lip at a landing's height (`predict`), the flight begun, held here on the physics' own
   * steps, the rope swinging on by itself from where the body left it. False where the flight meets none (too slow across the
   * ground, flying against the body's facing, nothing met, a wall, a top too far down, no room on the top): the caller lets go
   * the plain way, so the fall and the landing are today's.
   */
  private release(world: RopeWorld, body: LedgeBody, li: LedgeIn): boolean {
    const R = this.s + this.e + this.hang;
    const v = R * this.om;
    const c = Math.cos(this.th);
    const sn = Math.sin(this.th);
    const out = this.ev;
    const vx = (v * c + out * sn) * this.fx;
    const vy = v * sn - out * c;
    const vz = (v * c + out * sn) * this.fz;
    const lv = Math.sqrt(vx * vx + vz * vz);
    if (lv < LAND_MOVING || vx * this.fx + vz * this.fz < LAND_ALONG * lv) return false;
    this.vx = vx;
    this.vy = vy;
    this.vz = vz;
    this.relY = body.pos.y;
    if (!this.predict(world, body, li)) return false;
    // The flight begins: the rope swings on by itself; the figure eased from the swing's placement into the flight's.
    this.flights++;
    this.freeHeld();
    this.phase = ROPE_FLY;
    this.flyT = 0;
    this.flyRem = 0;
    this.flyTop = body.pos.y;
    this.apexY = body.pos.y;
    this.flyEnd = '';
    this.airClip = ROPE_FLIGHT_CLIP;
    this.airT = ROPE_TIMES.landLevel;
    this.startFly = true;
    this.ended = false;
    this.fromOffX = this.offX;
    this.fromOffY = this.offY;
    this.fromOffZ = this.offZ;
    this.fromTilt = this.tilt;
    this.outDur = CLIMB_TUNE.ease;
    this.outT = this.outDur;
    this.poseT = Number.NaN;
    this.loopT = Number.NaN;
    body.vel.x = vx;
    body.vel.y = vy;
    body.vel.z = vz;
    return true;
  }

  /** The held rope let go of: it swings on from where the body left it, not grabbed again at once. */
  private freeHeld(): void {
    const r = this.rope;
    if (r) {
      r.held = false;
      r.th = this.th;
      r.om = this.om;
      r.fx = this.fx;
      r.fz = this.fz;
      r.e = this.e;
      r.thDraw = this.th;
      r.lay();
    }
    this.regrabRope = r;
    this.regrabT = CLIMB_TUNE.regrab;
    this.rope = null;
  }

  /**
   * The flight foreseen from the body's feet with the flight's velocity (`vx`, `vy`, `vz`): the standing capsule swept along the
   * very steps `flyStep` takes (a parabola under the swing's gravity on the physics' own step), to the first thing it meets,
   * no further than `FLY_MOST` and no lower than a landing could be (`climb.ropeLandBelow` and `ropeLandTop` under the feet at
   * the let-go), nor into the water. True where what it meets is a landing (`classify`), the band, the face, the top and the
   * stand written, and the time to the arrival (`fT`). Asks the engine a cast a step (a let-go's event, never a frame's).
   */
  private predict(world: RopeWorld, body: LedgeBody, li: LedgeIn): boolean {
    const sc = this.hang / ROPE_FACTS.hang;
    const g = CLIMB_TUNE.swingGravity;
    const h = ROPE_STEP;
    let px = body.pos.x;
    let py = body.pos.y;
    let pz = body.pos.z;
    const vx = this.vx;
    let vy = this.vy;
    const vz = this.vz;
    const floor = this.relY - (CLIMB_TUNE.ropeLandBelow + CLIMB_TUNE.ropeLandTop) * sc;
    let cap = this.flyCap;
    if (!cap) cap = this.flyCap = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r);
    const most = Math.ceil(FLY_MOST / h);
    for (let k = 1; k <= most; k++) {
      const dx = vx * h;
      const dy = vy * h - 0.5 * g * h * h;
      const dz = vz * h;
      this.at.x = px;
      this.at.y = py + ROPE_MID;
      this.at.z = pz;
      this.castVel.x = dx;
      this.castVel.y = dy;
      this.castVel.z = dz;
      this.casts++;
      const hit = world.castShape(this.at, this.still, this.castVel, cap, 0, 1, false, STILL_FLAGS, li.filter);
      if (hit !== null) {
        const u = this.shareOf(hit.time_of_impact, dx, dy, dz);
        this.fT = (k - 1 + u) * h;
        const hx = px + dx * u;
        const hy = py + dy * u;
        const hz = pz + dz * u;
        if (!this.classify(world, hit, hx, hy, hz, vx, vz, li)) return false;
        // The fixer: the carry from where the landing will begin, up the face and in over the top, must have room all the way
        // (a lintel or a low window over the lip, which the stand's own ask cannot see), else the plain let-go.
        this.beginOf(body, k, hx, hy, hz);
        if (this.carryClear(world, this.cx, this.cy, this.cz, li)) return true;
        this.band = -1;
        return false;
      }
      px += dx;
      py += dy;
      pz += dz;
      vy -= g * h;
      if (py < floor || py < this.swimLine) return false;
    }
    return false;
  }

  /**
   * The fixer: where the landing foreseen will begin (into `cx`, `cy`, `cz`), its flight met at step `k` at (`hx`, `hy`, `hz`):
   * the very steps `flyStep` takes replayed from the let-go (the same arithmetic, so the same numbers), the landing on a face of a
   * band over the level one begun at the first step whose start has the hips within the clip's reach of the face, as `flyStep`
   * begins it; else where the flight meets it. Numbers alone, no ask.
   */
  private beginOf(body: LedgeBody, k: number, hx: number, hy: number, hz: number): void {
    this.cx = hx;
    this.cy = hy;
    this.cz = hz;
    if (!this.face || this.band <= ROPE_BAND_LEVEL) return;
    const g = CLIMB_TUNE.swingGravity;
    const h = ROPE_STEP;
    const reach = this.reachOf(this.band);
    let px = body.pos.x;
    let py = body.pos.y;
    let pz = body.pos.z;
    let vy = this.vy;
    for (let j = 1; j <= k; j++) {
      if ((px - this.fpx) * this.fnx + (pz - this.fpz) * this.fnz <= reach) {
        this.cx = px;
        this.cy = py;
        this.cz = pz;
        return;
      }
      if (j === k) return;
      px += this.vx * h;
      py += vy * h - 0.5 * g * h * h;
      pz += this.vz * h;
      vy -= g * h;
    }
  }

  /**
   * The fixer: whether a landing's carry from (`fx`, `fy`, `fz`) has room all the way to the stand: the very way `landStep` carries
   * the body, straight up (or down) the face to the top first and then in over it at the top's height to the stand, the standing
   * capsule (a skin thinner, its feet a hair over the top on the way in) asked every `CARRY_EVERY`, the start, where the body
   * already is, left out. The ledges' climb up asks its path the same way. A let-go's event: shape tests, never a frame's.
   */
  private carryClear(world: RopeWorld, fx: number, fy: number, fz: number, li: LedgeIn): boolean {
    let cap = this.carryCap;
    if (!cap) cap = this.carryCap = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r - CARRY_SKIN);
    const rise = this.standY - fy;
    const ix = this.standX - fx;
    const iz = this.standZ - fz;
    const way = Math.sqrt(ix * ix + iz * iz);
    const up = Math.abs(rise);
    const n1 = up > 1e-6 ? Math.ceil(up / CARRY_EVERY) : 0;
    const n2 = way > 1e-6 ? Math.ceil(way / CARRY_EVERY) : 0;
    for (let k = 1; k <= n1 + n2; k++) {
      if (k <= n1) {
        this.at.x = fx;
        this.at.y = fy + (rise * k) / n1 + ROPE_MID;
        this.at.z = fz;
      } else {
        const u = (k - n1) / n2;
        this.at.x = fx + ix * u;
        this.at.y = this.standY + CARRY_LIFT + ROPE_MID;
        this.at.z = fz + iz * u;
      }
      this.casts++;
      if (world.intersectionWithShape(this.at, this.still, cap, STILL_FLAGS, li.filter) !== null) return false;
    }
    return true;
  }

  /** A swept step's share up to what it met, less the controller's skin (the bars' arithmetic). */
  private shareOf(toi: number, dx: number, dy: number, dz: number): number {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let u = toi;
    if (len > 1e-9) u -= FLY_SKIN / len;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    return u;
  }

  /**
   * What a flight met, with the feet at (`px`, `py`, `pz`) and flying along (`vx`, `vz`), into the band (`band`, -1 none), the
   * face, the top and the stand: a top met from above is a level landing no further down than `climb.ropeLandBelow` under the
   * feet at the let-go, where the feet came down; a face met head on (flying into it) has its top found by a ball dropped just
   * in past it, and the top's height over the feet (scaled by the figure) is the band: level under `ropeLandKnee`, knee under
   * `ropeLandBetween`, between knee and waist under `ropeLandWaist`, waist up to `ropeLandTop`, past it a wall; the body stands
   * up `ropeLandIn` in past the face, where its standing capsule must fit. True where it is a landing.
   */
  private classify(world: RopeWorld, hit: { normal1: { x: number; y: number; z: number }; witness1: { x: number; y: number; z: number } }, px: number, py: number, pz: number, vx: number, vz: number, li: LedgeIn): boolean {
    const sc = this.hang / ROPE_FACTS.hang;
    const T = CLIMB_TUNE;
    this.band = -1;
    const n = hit.normal1;
    let nx = n.x;
    let nz = n.z;
    const nl = Math.sqrt(nx * nx + nz * nz);
    // A flat top met from above: stood on where the feet came down (no further down than `ropeLandBelow` under the let-go's).
    // (A top's edge met from above, its normal leaning back toward the body, is a face whose top is under the feet: below.)
    if (n.y >= FLY_GROUND && nl < EDGE_LEAN) {
      if (py < this.relY - T.ropeLandBelow * sc) return false;
      // (The fixer: only where the top is under the body's middle. A capsule's foot met on the top's very edge, its middle out
      // past the face, leans its normal by less than `EDGE_LEAN` and was stood there, resting on the corner outside the face;
      // it is landed on as the face below is, its outward way the contact's lean, the stand in past it.)
      if (this.overTop(world, px, py, pz, li)) {
        this.face = false;
        this.top = py;
        this.standX = px;
        this.standY = py;
        this.standZ = pz;
        this.band = ROPE_BAND_LEVEL;
        return true;
      }
      if (nl > 1e-6) {
        nx /= nl;
        nz /= nl;
      } else {
        const lv = Math.sqrt(vx * vx + vz * vz);
        if (lv < 1e-6) return false;
        nx = -vx / lv;
        nz = -vz / lv;
      }
    } else {
      // (The fixer: a top's edge met from above leans at least `EDGE_LEAN` and is the face's whatever its lean; the 0.3 keeps out
      // only what is met from below, an overhang's underside. Asked of every contact, a top's edge leaning 0.2 to 0.3 fell
      // between the two branches and was let go the plain way: the human male at 0.85 his size, at 30 frames a second.)
      if (n.y < FLY_GROUND && nl < 0.3) return false;
      nx /= nl;
      nz /= nl;
    }
    if (nx * vx + nz * vz >= 0) return false;
    const ex = hit.witness1.x;
    const ez = hit.witness1.z;
    let probe = this.probe;
    if (!probe) probe = this.probe = this.makers.capsule(0.005, 0.03);
    const fromY = py + T.ropeLandTop * sc + PROBE_OVER;
    this.at.x = ex - nx * PROBE_IN * sc;
    this.at.y = fromY;
    this.at.z = ez - nz * PROBE_IN * sc;
    this.castVel.x = 0;
    this.castVel.y = py - 0.05 - fromY;
    this.castVel.z = 0;
    this.casts++;
    const q = world.castShape(this.at, this.still, this.castVel, probe, 0, 1, false, STILL_FLAGS, li.filter);
    if (q === null || q.normal1.y < FLY_GROUND || !(q.time_of_impact > 0)) return false;
    const top = q.witness1.y;
    const lip = top - py;
    const band = lip < T.ropeLandKnee * sc ? ROPE_BAND_LEVEL : lip < T.ropeLandBetween * sc ? ROPE_BAND_KNEE : lip < T.ropeLandWaist * sc ? ROPE_BAND_BETWEEN : lip <= T.ropeLandTop * sc ? ROPE_BAND_WAIST : -1;
    if (band < 0) return false;
    // (A level landing is one with the body, as a top met from above: no further down than `ropeLandBelow` under the let-go's feet.)
    if (band === ROPE_BAND_LEVEL && top < this.relY - T.ropeLandBelow * sc) return false;
    const inn = LEDGE_CAPSULE.r + T.ropeLandIn * sc;
    const sx = ex - nx * inn;
    const sz = ez - nz * inn;
    // The standing capsule on the top there, a hair over it.
    let cap = this.cap;
    if (!cap) cap = this.cap = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r + ROOM_SKIN);
    this.at.x = sx;
    this.at.y = top + ROPE_MID + ROOM_SKIN + 0.01;
    this.at.z = sz;
    this.casts++;
    if (world.intersectionWithShape(this.at, this.still, cap, STILL_FLAGS, li.filter) !== null) return false;
    // (The fixer: and with the top under it there. A top too thin to stand on in past its face, a wall's or a lintel's met face
    // on, had the body stood in the air beyond it.)
    if (!this.overTop(world, sx, top, sz, li)) return false;
    this.face = true;
    this.fpx = ex;
    this.fpz = ez;
    this.fnx = nx;
    this.fnz = nz;
    this.top = top;
    this.standX = sx;
    this.standY = top;
    this.standZ = sz;
    this.band = band;
    return true;
  }

  /**
   * The fixer: whether there is a top under feet at (`px`, `py`, `pz`), the body's middle over it: the small ball dropped from
   * `OVER_TOP_UP` over the feet meets one no further than `OVER_TOP_DOWN` under them (a flight's feet met on a top from above, and
   * a face's stand in past its face). A let-go's event: one shape test, the probe's.
   */
  private overTop(world: RopeWorld, px: number, py: number, pz: number, li: LedgeIn): boolean {
    let probe = this.probe;
    if (!probe) probe = this.probe = this.makers.capsule(0.005, 0.03);
    this.at.x = px;
    this.at.y = py + OVER_TOP_UP;
    this.at.z = pz;
    this.castVel.x = 0;
    this.castVel.y = -(OVER_TOP_UP + OVER_TOP_DOWN);
    this.castVel.z = 0;
    this.casts++;
    const q = world.castShape(this.at, this.still, this.castVel, probe, 0, 1, false, STILL_FLAGS, li.filter);
    return q !== null && q.normal1.y >= FLY_GROUND;
  }

  /** How far ahead of its hips a band's braced foot reaches at its landing's start, metres (the human male's, scaled): where the landing begins, that far from the face. */
  private reachOf(band: number): number {
    const r = ROPE_LAND_FACTS.reach[band] * (this.hang / ROPE_FACTS.hang);
    return r > LEDGE_CAPSULE.r ? r : LEDGE_CAPSULE.r;
  }

  /**
   * A frame of the flight or the landing (the steps the caller wrote in `steps`): each step of the flight (`flyStep`, which may
   * begin the landing or end the flight) or of the landing's carry (`landStep`, which may end it), and the frame's own time past
   * the last step kept for the drawn figure.
   */
  private airFrame(world: RopeWorld, body: LedgeBody, li: LedgeIn): void {
    this.dtNow = li.dt;
    const h = ROPE_STEP;
    const n = this.steps;
    for (let k = 0; k < n; k++) {
      if (this.phase === ROPE_FLY) this.flyStep(world, body, li);
      else if (this.phase === ROPE_LAND) this.landStep(body);
      else break;
    }
    const rem = n >= 4 ? 0 : Math.min(h, Math.max(0, this.behind + li.dt - n * h));
    this.flyRem = rem;
    if (this.phase === ROPE_FLY) {
      this.apexY = this.flyTop;
      body.vel.x = this.vx;
      body.vel.y = this.vy;
      body.vel.z = this.vz;
    } else if (this.phase === ROPE_LAND) {
      this.apexY = body.pos.y;
      body.vel.x = 0;
      body.vel.y = 0;
      body.vel.z = 0;
    } else this.apexY = this.flyEnd === 'landed' ? body.pos.y : this.flyTop;
  }

  /**
   * One of the physics' steps of the flight: a landing on a face begins once the hips are within its clip's own reach of the face
   * (the braced foot then on it); else the capsule is swept along the step's parabola, and what it meets is landed on where it is
   * a landing (`classify` again, as at the let-go), else the flight ends there (a wall, or ground under the feet), handed to the
   * movement with its velocity; in the water, or held too long, it ends too.
   */
  private flyStep(world: RopeWorld, body: LedgeBody, li: LedgeIn): void {
    const g = CLIMB_TUNE.swingGravity;
    const h = ROPE_STEP;
    if (this.face && this.band > ROPE_BAND_LEVEL) {
      const dist = (body.pos.x - this.fpx) * this.fnx + (body.pos.z - this.fpz) * this.fnz;
      if (dist <= this.reachOf(this.band)) {
        this.beginLand(body);
        return;
      }
    }
    const dx = this.vx * h;
    const dy = this.vy * h - 0.5 * g * h * h;
    const dz = this.vz * h;
    let cap = this.flyCap;
    if (!cap) cap = this.flyCap = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r);
    this.at.x = body.pos.x;
    this.at.y = body.pos.y + ROPE_MID;
    this.at.z = body.pos.z;
    this.castVel.x = dx;
    this.castVel.y = dy;
    this.castVel.z = dz;
    this.casts++;
    const hit = world.castShape(this.at, this.still, this.castVel, cap, 0, 1, false, STILL_FLAGS, li.filter);
    if (hit !== null) {
      const u = this.shareOf(hit.time_of_impact, dx, dy, dz);
      body.pos.x += dx * u;
      body.pos.y += dy * u;
      body.pos.z += dz * u;
      this.vy -= g * h * u;
      this.flyT += h * u;
      // (The fixer: and the carry from here has room all the way, as at the let-go.)
      if (this.classify(world, hit, body.pos.x, body.pos.y, body.pos.z, this.vx, this.vz, li) && this.carryClear(world, body.pos.x, body.pos.y, body.pos.z, li)) this.beginLand(body);
      else this.endAir(body, 'wall');
      return;
    }
    body.pos.x += dx;
    body.pos.y += dy;
    body.pos.z += dz;
    this.vy -= g * h;
    this.flyT += h;
    if (body.pos.y > this.flyTop) this.flyTop = body.pos.y;
    if (body.pos.y < this.swimLine) this.endAir(body, 'water');
    else if (this.flyT > FLY_MOST) this.endAir(body, 'long');
  }

  /**
   * The landing begun where the body is: its band's clip from the second the owner named (the level one goes on from the flight's
   * own clip at its foot's touch), the body carried from here onto the top over the clip's own time to its feet stood (the human
   * male's, `ROPE_LAND_FACTS.stand`, at least `LAND_LEAST`), the figure eased from the flight's placement.
   */
  private beginLand(body: LedgeBody): void {
    const b = this.band;
    this.phase = ROPE_LAND;
    this.landT = 0;
    this.landFrame = 0;
    let d = ROPE_LAND_FACTS.stand[b] - ROPE_BAND_FROM[b];
    if (d < LAND_LEAST) d = LAND_LEAST;
    this.cx = body.pos.x;
    this.cy = body.pos.y;
    this.cz = body.pos.z;
    // The rise takes its share of the clip's own time; the move in over the top the rest, or longer where the way in is longer
    // than `climb.ropeLandWalk` covers in it (the level landing's clip stands at once, and its way in is most of a metre).
    const ix = this.standX - this.cx;
    const iz = this.standZ - this.cz;
    const way = Math.sqrt(ix * ix + iz * iz);
    const walk = CLIMB_TUNE.ropeLandWalk;
    const least = walk > 0 ? way / walk : 0;
    const along = d * (1 - LAND_RISE);
    this.riseDur = d * LAND_RISE;
    this.landDur = this.riseDur + (along > least ? along : least);
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.airClip = ROPE_BAND_CLIPS[b];
    this.airT = ROPE_BAND_FROM[b];
    this.startLand = b !== ROPE_BAND_LEVEL;
    this.fromOffX = this.offX;
    this.fromOffY = this.offY;
    this.fromOffZ = this.offZ;
    this.fromTilt = this.tilt;
  }

  /** One step of the landing's carry: up the face first (`riseDur`), then in over the top to the stand; at its end, stood. */
  private landStep(body: LedgeBody): void {
    this.landT += ROPE_STEP;
    const t = this.landT;
    const r = this.riseDur;
    const rest = this.landDur - r;
    const up = r > 0 ? ease(t / r) : 1;
    const along = rest > 0 ? ease((t - r) / rest) : 1;
    const u = this.landDur > 0 ? t / this.landDur : 1;
    body.pos.x = this.cx + (this.standX - this.cx) * along;
    body.pos.y = this.cy + (this.standY - this.cy) * up;
    body.pos.z = this.cz + (this.standZ - this.cz) * along;
    if (u >= 1) {
      this.landings[this.band]++;
      this.endAir(body, 'landed');
    }
  }

  /**
   * The flight or the landing ended (`why`): the body handed to the movement, with the flight's velocity (stood on the top, still,
   * after a landing), its drawn offset eased onto it over the rig's own fade of the clip (so the two meet), the rope not grabbed
   * again at once; the caller's rig lets go of the clip (`ended`), into a crouch after a landing (`landedNow`), else the falling loop.
   */
  private endAir(body: LedgeBody, why: RopeFlyEnd): void {
    this.flyEnd = why;
    const landed = why === 'landed';
    body.vel.x = landed ? 0 : this.vx;
    body.vel.y = landed ? 0 : this.vy;
    body.vel.z = landed ? 0 : this.vz;
    this.phase = ROPE_NONE;
    this.ended = true;
    this.landedNow = landed;
    this.outDur = CLIMB_TUNE.transitions === 'blend' ? CLIMB_TUNE.transitionBlend : CLIMB_TUNE.ease;
    this.outT = this.outDur;
    this.regrabT = CLIMB_TUNE.regrab;
    this.airT = Number.NaN;
    this.poseT = Number.NaN;
    this.loopT = Number.NaN;
    this.plantY = landed ? this.standY + LEDGE_REST.ankle * (this.hang / ROPE_FACTS.hang) : Number.NaN;
  }

  /**
   * The flight's figure: the level clip from its let-go (`ROPE_TIMES.landLevel`) toward its foot's touch at its own rate, its
   * frame just before the touch held while the flight lasts longer (the Smoothness III rule), sped up no more than
   * `climb.flightRateMax` where the flight is shorter than that stretch; its hips drawn where the flying body's middle is (led to
   * the frame's own time), eased from the let-go's placement over `climb.ease`. No table: on the body.
   */
  private placeFlight(k: number): void {
    const L = this.landTables;
    const stretch = ROPE_TIMES.levelTouch - ROPE_TIMES.landLevel;
    const el = this.flyT + this.flyRem;
    let t: number;
    if (this.fT >= stretch) t = ROPE_TIMES.landLevel + (el < ROPE_TIMES.levelHold - ROPE_TIMES.landLevel ? el : ROPE_TIMES.levelHold - ROPE_TIMES.landLevel);
    else {
      // (Worked out in numbers alone: a choice between a number worked out here and one read off the tune is kept boxed, a number made a call.)
      const most = CLIMB_TUNE.flightRateMax + 0;
      const f = this.fT > 1e-3 ? this.fT : 1e-3;
      let rate = stretch / f;
      if (rate > most) rate = most;
      const go = el * rate;
      t = ROPE_TIMES.landLevel + (go < stretch ? go : stretch);
    }
    this.airT = t;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    if (L) {
      const F = L.fly;
      F.ask = t;
      F.atAsk(this.landPose);
      const P = this.landPose;
      const lx = k * P.hx;
      const lz = k * P.hz;
      const ch = Math.cos(this.heading);
      const sh = Math.sin(this.heading);
      const rem = this.flyRem;
      tx = this.vx * rem - (lx * ch + lz * sh);
      ty = this.vy * rem - 0.5 * CLIMB_TUNE.swingGravity * rem * rem + ROPE_MID - k * P.hy;
      tz = this.vz * rem - (-lx * sh + lz * ch);
    }
    if (this.outT > 0 && this.outDur > 0) {
      this.outT = this.outT > this.dtNow ? this.outT - this.dtNow : 0;
      // (Linear, as the rig's own crossfade of the swing's clip into the flight's is, so the drawn hips stay where the two put them.)
      const v = 1 - this.outT / this.outDur;
      tx = this.fromOffX + (tx - this.fromOffX) * v;
      ty = this.fromOffY + (ty - this.fromOffY) * v;
      tz = this.fromOffZ + (tz - this.fromOffZ) * v;
      this.tilt = this.fromTilt * (1 - v);
    } else this.tilt = 0;
    this.offX = tx;
    this.offY = ty;
    this.offZ = tz;
  }

  /**
   * The landing's figure: its band's clip at its own rate from its start, the figure's origin eased from where its hips stood on
   * the body's middle as the landing began to where its lower ankle stands on the top as its feet are stood, over the carry; and
   * from the flight's placement over the rig's own crossfade into the clip (`climb.transitionBlend`), so the two meet. No table:
   * on the body.
   */
  private placeLand(k: number, pos: { x: number; y: number; z: number }): void {
    const b = this.band;
    const L = this.landTables ? this.landTables.land[b] : null;
    const t = ROPE_BAND_FROM[b] + this.landT + this.flyRem;
    this.airT = t;
    this.landFrame += this.dtNow;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    if (L) {
      const P = this.landPose;
      const ch = Math.cos(this.heading);
      const sh = Math.sin(this.heading);
      // Where the landing began: the clip's hips at its start on the body's middle.
      L.ask = ROPE_BAND_FROM[b];
      L.atAsk(P);
      const o0x = this.cx - (k * P.hx * ch + k * P.hz * sh);
      const o0y = this.cy + ROPE_MID - k * P.hy;
      const o0z = this.cz - (-k * P.hx * sh + k * P.hz * ch);
      // Where it ends: the clip's lower ankle, its feet stood, on the stand.
      L.ask = ROPE_LAND_FACTS.stand[b];
      L.atAsk(P);
      const o1x = this.standX - (k * P.ax * ch + k * P.az * sh);
      const o1y = this.standY + LEDGE_REST.ankle * k - k * P.ay;
      const o1z = this.standZ - (-k * P.ax * sh + k * P.az * ch);
      let u = this.landDur > 0 ? (this.landT + this.flyRem) / this.landDur : 1;
      if (u > 1) u = 1;
      const w = ease(u);
      tx = o0x + (o1x - o0x) * w - pos.x;
      ty = o0y + (o1y - o0y) * w - pos.y;
      tz = o0z + (o1z - o0z) * w - pos.z;
    }
    const blend = CLIMB_TUNE.transitions === 'blend' ? CLIMB_TUNE.transitionBlend : CLIMB_TUNE.ease;
    if (this.landFrame < blend) {
      // (Linear, as the rig's own crossfade of the flight's clip into the landing's is.)
      const v = this.landFrame / blend;
      tx = this.fromOffX + (tx - this.fromOffX) * v;
      ty = this.fromOffY + (ty - this.fromOffY) * v;
      tz = this.fromOffZ + (tz - this.fromOffZ) * v;
      this.tilt = this.fromTilt * (1 - v);
    } else this.tilt = 0;
    this.offX = tx;
    this.offY = ty;
    this.offZ = tz;
  }

  /**
   * After a landing, while its drawn offset eases out (`plantY` set): the offset lifted by what the drawn lower ankle (`ankleLow`,
   * written by the caller off the posed rig) stands under the top, never lowered. The body's place handed in; nothing else crosses.
   */
  plantFeet(pos: { y: number }): void {
    if (this.plantY !== this.plantY) return;
    const lift = this.plantY - (pos.y + this.offY + this.ankleLow);
    if (lift > 0) this.offY += lift;
  }

  /** Every rope's column switched as `climb.ropes` says, and the ropes nobody holds swung by themselves over the frame's time (`dtNow`, a field: no number crosses the call). */
  freeRopes(): void {
    const list = this.ropes;
    const on = CLIMB_TUNE.ropes === 'on';
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      r.sync();
      if (on && !r.held) {
        r.dt = this.dtNow;
        r.stepFree();
      }
    }
  }

  /**
   * The fixer: once a frame, at the very top of the caller's update, before anything has the body (so on a frame the rope's own
   * flight or landing has it, and a bar's, a ledge's, a wall's, a ride's, as on a frame of the movement): every rope's column
   * switched as `climb.ropes` says and the ropes nobody holds swung by themselves over the frame's time. It was stepped from the
   * hang's own frame and from `tick` (the movement's) alone, so a rope let go of into a landing hung still at its let-go angle for
   * the whole flight and landing, and every rope stood still while the body was on a bar or a ledge; a grab's frame stepped the
   * others twice.
   */
  tickRopes(dt: number): void {
    this.dtNow = dt;
    this.freeRopes();
  }

  /**
   * Every frame of the movement: off the rope the drawn offset eased out after a let-go and the let-go's one frame put down (the
   * ropes nobody holds are swung once a frame by `tickRopes`).
   */
  tick(dt: number): void {
    this.dtNow = dt;
    this.startClip = false;
    if (this.holding) return;
    this.ended = false;
    if (this.regrabT > 0) this.regrabT = Math.max(0, this.regrabT - dt);
    if (!this.offset) {
      // (Maker B: the landing's plant held only while its offset eases out.)
      this.plantY = Number.NaN;
      return;
    }
    if (this.outT <= 0 || this.outDur <= 0) {
      this.offX = 0;
      this.offY = 0;
      this.offZ = 0;
      this.tilt = 0;
      this.plantY = Number.NaN;
      return;
    }
    const was = this.outT;
    this.outT = Math.max(0, this.outT - dt);
    const k = this.outT / was;
    this.offX *= k;
    this.offY *= k;
    this.offZ *= k;
    this.tilt *= k;
  }

  /**
   * Where the figure is drawn this frame (after `step`, with the rig's own tables of the clips and the rig's scale `k`): the clip
   * the mode plays at its time (the swing's by the pendulum's angle, the climb's by the way climbed, the hang's own), and the
   * figure's origin and turn so its grip stands on the rope's and its hips on the rope's line; a change of mode eased over
   * `climb.ease`, the grab's carry from the body. No tables: drawn on the body, nothing held.
   */
  placeFigure(T: RopeTables | null, k: number, pos: { x: number; y: number; z: number }): void {
    if (!this.holding) return;
    // (Maker B: flying off the rope, or landing: the let-go's clips, by the flight's and the landing's own clocks.)
    if (this.phase === ROPE_FLY) {
      this.placeFlight(k);
      return;
    }
    if (this.phase === ROPE_LAND) {
      this.placeLand(k, pos);
      return;
    }
    const r = this.rope;
    if (!T || !r) {
      this.offX = 0;
      this.offY = 0;
      this.offZ = 0;
      this.tilt = 0;
      this.poseT = Number.NaN;
      this.loopT = Number.NaN;
      return;
    }
    const P = this.pose;
    const most = (CLIMB_TUNE.ropeMost * Math.PI) / 180;
    if (this.mode === MODE_SWING) {
      // The swing's run (its lowest angle to its end) laid over the largest swing either way: back at its back, forward at its front.
      const S = T.swing;
      let q = most > 0 ? this.thDraw / most : 0;
      if (q > 1) q = 1;
      if (q < -1) q = -1;
      // (Through the table's own field: no number crosses a call on a frame.)
      S.ask = S.from + ((q + 1) / 2) * (S.to - S.from);
      S.timeOfAsk();
      this.poseT = S.ask;
      S.atAsk(P);
      this.loopT = Number.NaN;
    } else if (this.mode === MODE_CLIMB) {
      // The climb's clip at its share of a round by the way climbed; drawn by its own pose at that time but at its grip's mean
      // height, so the body rises steadily with the climb while its hands stay on the rope's line, riding up and down along it
      // as the clip has them reach and pull.
      const C = T.climb;
      const round = C.rise * k;
      let u = round > 1e-6 ? this.climbed / round : 0;
      u -= Math.floor(u);
      this.loopT = u * C.duration;
      C.ask = this.loopT;
      C.atAsk(P);
      P.gy = C.meanPose.gy;
      this.poseT = Number.NaN;
    } else {
      // The still hang's clip at its own clock (put on the rig there: `driveRopeClips`), drawn by its own pose at that time.
      const H = T.hang;
      this.hangT += this.dtNow;
      if (this.hangT >= H.duration) this.hangT -= H.duration * Math.floor(this.hangT / H.duration);
      H.ask = this.hangT;
      H.atAsk(P);
      this.loopT = this.hangT;
      this.poseT = Number.NaN;
    }
    // The figure turned about its own left by `-d`: its hips then stand at the pendulum's angle about the grip, on the rope's line.
    const d = this.thDraw - P.angle;
    const cd = Math.cos(d);
    const sd = Math.sin(d);
    const lx = k * P.gx;
    const ly = k * (P.gy * cd + P.gz * sd);
    const lz = k * (-P.gy * sd + P.gz * cd);
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    const g = this.s + this.e;
    const sn = Math.sin(this.thDraw);
    const gx = r.ax + g * sn * this.fx;
    const gy = r.ay - g * Math.cos(this.thDraw);
    const gz = r.az + g * sn * this.fz;
    let ox = gx - pos.x - (lx * ch + lz * sh);
    let oy = gy - pos.y - ly;
    let oz = gz - pos.z - (-lx * sh + lz * ch);
    let tl = -d;
    // A change of mode eased from the last placement over the hang's ease.
    const dur = CLIMB_TUNE.ease;
    if (this.modeT < dur) {
      this.modeT += this.dtNow;
      const v = ease(dur > 0 ? this.modeT / dur : 1);
      ox = this.fromOffX + (ox - this.fromOffX) * v;
      oy = this.fromOffY + (oy - this.fromOffY) * v;
      oz = this.fromOffZ + (oz - this.fromOffZ) * v;
      tl = this.fromTilt + (tl - this.fromTilt) * v;
    }
    // The grab's carry: the figure eased onto the rope from the body.
    if (this.phase === ROPE_GRAB) {
      const w = ease(this.grabDur > 0 ? Math.min(1, this.reachT / this.grabDur) : 1);
      ox *= w;
      oy *= w;
      oz *= w;
      tl *= w;
    }
    this.offX = ox;
    this.offY = oy;
    this.offZ = oz;
    this.tilt = tl;
  }

  /** The console's report (`__debug.climb()`'s `rope`): the phase, the swing, the rope and the drawn pose. */
  report(): Record<string, unknown> {
    const deg = 180 / Math.PI;
    const r = this.rope;
    return {
      on: CLIMB_TUNE.ropes,
      keys: CLIMB_TUNE.ropeKeys,
      phase: this.phase === ROPE_NONE ? 'none' : this.phase === ROPE_GRAB ? 'grab' : this.phase === ROPE_FLY ? 'fly' : this.phase === ROPE_LAND ? 'land' : 'hang',
      // Maker B, item 4: the let-go's flight and landing (the band foreseen or met, the top over the feet, the stand, why the last flight ended).
      land: CLIMB_TUNE.ropeLand,
      band: this.band >= 0 ? ROPE_BAND_NAMES[this.band] : null,
      top: +this.top.toFixed(3),
      stand: [+this.standX.toFixed(2), +this.standY.toFixed(2), +this.standZ.toFixed(2)],
      flyT: +this.flyT.toFixed(3),
      foreseen: +this.fT.toFixed(3),
      landT: +this.landT.toFixed(3),
      airClip: this.flying ? this.airClip : null,
      airT: this.airT === this.airT ? +this.airT.toFixed(3) : null,
      flyEnd: this.flyEnd,
      flights: this.flights,
      landings: { level: this.landings[ROPE_BAND_LEVEL], knee: this.landings[ROPE_BAND_KNEE], between: this.landings[ROPE_BAND_BETWEEN], waist: this.landings[ROPE_BAND_WAIST] },
      plains: this.plains,
      swimLine: this.swimLine === this.swimLine && this.swimLine > -1e9 ? +this.swimLine.toFixed(2) : null,
      mode: this.mode === MODE_SWING ? 'swing' : this.mode === MODE_CLIMB ? 'climb' : 'hang',
      rope: r ? r.name : null,
      ropes: this.ropes.map((q) => ({ name: q.name, anchor: [+q.ax.toFixed(2), +q.ay.toFixed(2), +q.az.toFixed(2)], length: +q.len.toFixed(2), angle: +(q.th * deg).toFixed(1), held: q.held, column: q.columnStands })),
      along: +this.s.toFixed(3),
      stretch: +this.e.toFixed(3),
      radius: +(this.s + this.e + this.hang).toFixed(3),
      angle: +(this.th * deg).toFixed(2),
      speed: +(this.om * deg).toFixed(2),
      amplitude: +(this.amplitude() * deg).toFixed(2),
      plane: +(Math.atan2(this.fx, this.fz) * deg).toFixed(1),
      climbed: +this.climbed.toFixed(3),
      stop: this.stop,
      poseT: this.poseT === this.poseT ? +this.poseT.toFixed(3) : null,
      loopT: this.loopT === this.loopT ? +this.loopT.toFixed(3) : null,
      tilt: +(this.tilt * deg).toFixed(2),
      grabs: this.grabs,
      frames: this.frames,
      casts: this.casts,
    };
  }
}
