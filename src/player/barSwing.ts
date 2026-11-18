// Climbing II, phase 3: hanging from a bar and swinging on it (the owner's "a pole for swinging - swinging between perpendicular
// poles across a chasm like tomb raider", 2026-11-16), under `climb.bars` 'on'.
//
// A bar is src/player/barShape.ts's: a still collider long, level and thin. One class, `BarSwing`, holds the whole of it and is
// stepped by the player's update and by the node harness alike (tools/swg/tests/grappleBody.ts), at the same two places the
// ledges are (src/player/ledge.ts):
//  - `sense`, after the move (before the ledges'): with the use key handed to the climb (`LedgeIn.use`, the game's one use-key
//    dispatch: E pressed or held), a bar whose grip stands within the hands' reach band over the feet (the ledges' own
//    `climb.reachLow` to `reachHigh`, as far out as `reachAhead`, scaled by the figure) with room under it for the hanging body
//    is grabbed: from the ground under it, in a jump, or falling past it (no faster than `climb.grabFall`). A running jump
//    (moving across the bar faster than `BAR_RUN`) plays the clip's own reach (src/anim/barClips.ts: the owner's 0.70 to 0.83 s)
//    as the hands come onto the bar; every other grab carries the body onto it over `climb.barGrab`. The body's speed at the
//    grab is carried into the swing (`climb.swingCarry`, held to the largest swing).
//  - `step`, in place of the movement while it holds the body: the body hangs from its hands as a pendulum of the clip's own
//    radius (`BAR_FACTS.radius`, scaled), its angle and speed integrated on the physics' own steps (the caller hands it the
//    steps the coming physics step takes, `Physics.stepsAhead`), so it swings alike at every frame rate. W and S held push it on
//    at the swing's own phase (W while it swings forward or hangs still, S while it swings back), as on a swing, by
//    `climb.swingPump`, up to the largest swing `climb.swingMost`; it dies away by `climb.swingDamp` (nothing held, to a still
//    hang); A and D move the hands along the bar at `climb.barShimmy`, to its ends; a swing into something still stops there.
//    Space lets go on the swing's own velocity and the crouch key lets go straight down (the plain let-goes, `climb.barFlight`
//    'plain').
//  - the flight (maker B, `climb.barFlight` 'fly'): Space flies off on the swing's own velocity at that instant and
//    `climb.barBoost` more along the swing's own way, held by the bar on the physics' own steps (`flyStep`: a parabola under the
//    swing's gravity, the body's capsule swept along each step), playing `run_and_swing`'s flight (the release on, its twin:
//    `BAR_FLIGHT_NAME`). A bar within the band ahead of the hands along the flight (`climb.catchReach`, `climb.catchSlack`) is
//    caught: the clip's reach into the hands on it (`take`), the flight's speed carried into the new swing. Else the flight ends
//    where the capsule meets something (the clip's landing, 2.10 s on, where it is ground under the feet; the falling clips
//    where it is a wall), in the water, or falling past `climb.grabFall`, the body handed to the movement with its velocity. A
//    blow of `climb.barKnock` or more knocks the body off, straight down.
// What the figure plays is `run_and_swing`'s swing window by the pendulum's own angle (`placeFigure`, through the clip's table
// measured off the rig, `BarSwingTable`): `poseT` the time to put the held clip at, `offX/offY/offZ` where the figure's origin
// is drawn against the body's (the world's frame), `tilt` the figure turned about its own left so its hips stand at the
// pendulum's angle wherever the clip's own do not (past the window's ends). `startClip` and `ended` say when the clip begins and
// is let go of, for the caller's rig (src/player/hangClips.ts's `driveBarClips`).
//
// Nothing here makes an object on a frame: every ask and answer is a kept record, and the engine's own answers (a shape test's)
// are the only things made.

import type { RAPIER } from '../core/physics.ts';
import { STILL_FLAGS } from './stairSense.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { BAR_CLIP, BAR_CLIP_NAMES, BAR_FACTS, BAR_FLIGHT_NAME, BAR_TIMES, BarPose, type BarFlightTable, type BarSwingTable } from '../anim/barClips.ts';
import { BAR_HALF_SPAN, BarAxis, BarRoomAsk, barAxisOf, roomUnderBar, type BarCollider, type BarRoomWorld } from './barShape.ts';
import { LEDGE_CAPSULE, type LedgeBody, type LedgeIn } from './ledge.ts';
import { LEDGE_FACTS, LEDGE_REST, LEDGE_ROLES } from '../anim/ledgeClips.ts';

/** The physics' own step (`FIXED_DT` in src/core/physics.ts; climbBars.test.ts holds the two equal): the swing is integrated on it. */
export const BAR_STEP = 1 / 60;
/** Moving across the bar faster than this at the grab is a running jump: the clip's own reach plays (a mechanic: a jog's 3 m/s less a little). */
export const BAR_RUN = 2.5;
/** The hands' half span on the bar (src/player/barShape.ts's, which the ledges' word on a bar reads too). */
export { BAR_HALF_SPAN };
/** How high the body's middle stands over its feet (the standing capsule's: what the hanging capsule is placed by). */
const BAR_MID = LEDGE_CAPSULE.r + LEDGE_CAPSULE.stand;
/** How far the hands may move along the bar before the swing's room is asked again, metres (a mechanic: a few hand widths). */
const BAR_OPEN_SLIP = 0.25;
/** How far past the fastest frame's fall or rise the reach band is swept (a mechanic: the frame's own, no more). */
const SWEEP_MOST = 0.6;

/** The phase: holding nothing, carried onto the bar (a grab), swinging, or (maker B) in the flight off it. */
export const BAR_NONE = 0;
export const BAR_GRAB = 1;
export const BAR_SWING = 2;
export const BAR_FLY = 3;

/** Maker B: how far short of what the flying capsule meets it is stood, metres (a mechanic: the character controller's own skin). */
const FLY_SKIN = 0.01;
/** Maker B: a contact whose normal stands up at least this much is ground under the feet (a mechanic: cos 55 degrees, the climb's walkable). */
const FLY_GROUND = 0.57;
/** Maker B: a flight held longer than this is handed to the movement whatever it is doing, seconds (a backstop, no number of feel). */
const FLY_MOST = 3;
/** Maker B: a bar is caught only lying across the flight, its axis within this of square to the flight's level way (cos 60 degrees: a mechanic). */
const CATCH_ACROSS = 0.5;
/** Maker B: a flight slower than this across the ground has no way ahead to catch along, m/s (a mechanic). */
const CATCH_LEVEL = 0.5;
/** Maker B: the free hang's idle (what another player's game is told a bar's hang is: the nearest pose the wire has), its grip over its feet. */
const PEER_IDLE = LEDGE_FACTS[LEDGE_ROLES.free.idle];
const PEER_OVER = PEER_IDLE ? PEER_IDLE.g0[1] - (PEER_IDLE.a0 - LEDGE_REST.ankle) : 1.9;

/** Why a flight off a bar ended (the console's and the tests' word): caught, landed, met a wall, in the water, falling past a grab, or held too long. */
export type BarFlyEnd = '' | 'caught' | 'land' | 'wall' | 'water' | 'fall' | 'long';

/** The little of a physics world the bars ask (rapier's `World`). */
export interface BarWorld {
  intersectionWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider): RAPIER.Collider | null;
  intersectionsWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, callback: (c: RAPIER.Collider) => boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): void;
  /** Maker B: the flying capsule swept along a step (the engine's shape cast), the bar let go of left out. */
  castShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shapeVel: { x: number; y: number; z: number }, shape: RAPIER.Shape, targetDistance: number, maxToi: number, stopAtPenetration: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider): { collider: RAPIER.Collider; time_of_impact: number; normal1: { x: number; y: number; z: number } } | null;
}

/** The engine's two shapes the bars ask with, handed in once (so this file loads under node with no engine of its own). */
export interface BarMakers {
  /** The reach's box (half extents). */
  cuboid(hx: number, hy: number, hz: number): RAPIER.Shape;
  /** The hanging body's standing capsule (half height, radius). */
  capsule(halfHeight: number, radius: number): RAPIER.Shape;
}

/** A smooth step, nought to one. */
const ease = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export class BarSwing {
  phase = BAR_NONE;
  /** The bar held. */
  readonly bar = new BarAxis();
  /** The hands along the bar from its first end, metres. */
  s = 0.5;
  /** The way the body faces across the bar (level, unit), and its heading. */
  fx = 0.5;
  fz = 0.5;
  heading = 0.5;
  /** The pendulum: its angle (radians, nought straight down, positive the way the body faces), its speed, and its radius. */
  th = 0.5;
  om = 0.5;
  r = 0.5;
  /** The angle at the frame's own time (the steps' state led by the physics' remainder): what the figure is drawn at. */
  thDraw = 0.5;
  /** A grab's carry: its clock on the steps and its length; the body's middle at the grab; whether it is a running jump's reach; and the grab's frame clock (the drawn figure's ease and the reach's time). */
  grabT = 0.5;
  grabDur = 0.5;
  fromX = 0.5;
  fromY = 0.5;
  fromZ = 0.5;
  reach = false;
  reachT = 0.5;
  /** Written by the caller before `step`: how many of the physics' steps the coming one takes, and how far the bodies stand behind the frame now. */
  steps = 0;
  behind = 0.5;
  /** The drawn figure against the body (the world's frame), its turn about its own left, and the clip's time to hold it at (NaN: none). */
  offX = 0.5;
  offY = 0.5;
  offZ = 0.5;
  tilt = 0.5;
  poseT = 0.5;
  /** A one-off for the caller's rig this frame ('' none): the bar's clip begun from `startFrom` over `startFade`; and the let-go of it. */
  startClip = '';
  startFrom = 0.5;
  startFade = 0.5;
  ended = false;
  /** The grab's own frame (its start kept through the first step for the caller's rig). */
  private fresh = false;
  /**
   * The clip the bar plays now, by its rig name (made once): the bar's clip on it, its twin in the flight off it (maker B,
   * `BAR_FLIGHT_NAME`), which a catch crossfades back into the bar's own.
   */
  clipName: string;
  /** Maker B, the flight: its velocity, its time flown on the steps, the feet's highest (the fall's memory), and why it ended ('' while it flies). */
  vx = 0.5;
  vy = 0.5;
  vz = 0.5;
  flyT = 0.5;
  flyTop = 0.5;
  flyEnd: BarFlyEnd = '';
  /** Where the caller holds the fall's memory this frame: the flight's top in a flight (and the frame it ends), else the body's feet. */
  apexY = 0.5;
  /** The bar let go of (never caught again in the same flight). */
  private flyCol: BarCollider | null = null;
  /** The let-go's drawn offsets and turn, what the flight's placement eases from over `outDur`. */
  private fromOffX = 0.5;
  private fromOffY = 0.5;
  private fromOffZ = 0.5;
  private fromTilt = 0.5;
  /** The drawn flight's lead past the steps' state (the frame's own time), metres. */
  private leadX = 0.5;
  private leadY = 0.5;
  private leadZ = 0.5;
  /** Handed to the movement at the frame's end (falling past a grab, or held too long). */
  private flyHand = false;
  /** The frame's own time past the flight's last step, seconds (what the flight's pose is drawn at). */
  private flyRem = 0.5;
  /** The grab now is a catch from the flight: the figure eased from the flight's placement over the reach. */
  private caughtFrom = false;
  /** The flight's own table (the clip's hips from the release on, measured off the caller's rig): set by the caller. */
  flight: BarFlightTable | null = null;
  /** A flight landed this frame: the caller's rig plays the clip's landing (2.10 s on) as a one-off. */
  landNow = false;
  /** The feet's height under which the body swims (the water's surface less the swim's depth; -Infinity for none): set by the caller before a flight's step. */
  swimLine = 0.5;
  /** A blow hard enough was taken (`knock`): the body comes off, straight down, at the next step. */
  private knocked = false;
  /** A catch from the flight is taking the bar (the clip's reach whatever the speed across it). */
  private catching = false;
  /** Flights flown, bars caught from them, and landings: the console's and the tests' counts. */
  flights = 0;
  catches = 0;
  landings = 0;
  /** The flight's swept capsule's way (one step's, the cast's velocity over one unit of time). */
  private readonly castVel = { x: 0, y: 0, z: 0 };
  /** The catch's ask (fields: the engine's callback reads them): the hands' place, the flight's level way, the band. */
  private cpx = 0.5;
  private cpy = 0.5;
  private cpz = 0.5;
  private cdx = 0.5;
  private cdz = 0.5;
  private creach = 0.5;
  private cslack = 0.5;
  /** The band's lowest under the hands (negative), and whether the catch is asked where the flying capsule met something. */
  private cbelow = 0.5;
  private contact = false;
  private readonly visitCatch: (c: RAPIER.Collider) => boolean;
  /** After a let-go: the drawn offset eased out over this long more (seconds left, and the whole), and the bar not grabbed again for `regrab`. */
  outT = 0.5;
  outDur = 0.5;
  private regrabT = 0.5;
  private regrabCol: BarCollider | null = null;
  /** Said on the message line (a refusal in words), '' for nothing; the caller hands it on. */
  said = '';
  /** The frames held, and the shape tests asked (the engine's own answers: what a frame makes). */
  frames = 0;
  casts = 0;

  private readonly makers: BarMakers;
  private box: RAPIER.Shape | null = null;
  private boxH = 0.5;
  private cap: RAPIER.Shape | null = null;
  /** The room straight under the grip's ask (src/player/barShape.ts's `roomUnderBar`). */
  private readonly roomAsk = new BarRoomAsk();
  /**
   * The swing's room (`openAt`): its box, the half sizes it was made at (made again only where they move: a grab's figure,
   * radius or largest swing of its own, never a shift along the bar), its turn, whether it is clear, and the hands' place along
   * the bar it was asked at.
   */
  private openBox: RAPIER.Shape | null = null;
  private openHu = 0.5;
  private openHy = 0.5;
  private openHf = 0.5;
  /** The box's middle over the grip, and the largest swing (degrees) it was sized for (a slider moved on the bar sizes it again). */
  private openMid = 0.5;
  private openMost = 0.5;
  /**
   * The query's groups as the shimmy's ask hands them on (begun as no number, so the field keeps whatever number it holds boxed),
   * and the same as a number (what the frame compares the move's groups with).
   */
  private groups: unknown = null;
  private groupsNum = 0.5;
  private readonly openRot = { x: 0, y: 0, z: 0, w: 1 };
  private open = false;
  private openS = 0.5;
  /** The bar a refusal was said for while the key is held (said once). */
  private saidCol: BarCollider | null = null;
  private readonly at = { x: 0, y: 0, z: 0 };
  private readonly still = { x: 0, y: 0, z: 0, w: 1 };
  private readonly found = new BarAxis();
  private readonly best = new BarAxis();
  private readonly pose = new BarPose();
  /** The search's ask and best answer so far (fields: the engine's callback reads them). */
  private qpx = 0.5;
  private qpy = 0.5;
  private qpz = 0.5;
  private qlo = 0.5;
  private qhi = 0.5;
  private qahead = 0.5;
  private qmargin = 0.5;
  private bestD = 0.5;
  private bestS = 0.5;
  private readonly visit: (c: RAPIER.Collider) => boolean;

  constructor(makers: BarMakers) {
    this.makers = makers;
    this.clipName = BAR_CLIP_NAMES[BAR_CLIP];
    this.visit = (c) => this.consider(c as unknown as BarCollider);
    this.visitCatch = (c) => this.considerCatch(c as unknown as BarCollider);
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.flyT = 0;
    this.flyTop = 0;
    this.apexY = 0;
    this.fromOffX = 0;
    this.fromOffY = 0;
    this.fromOffZ = 0;
    this.fromTilt = 0;
    this.leadX = 0;
    this.leadY = 0;
    this.leadZ = 0;
    this.swimLine = Number.NEGATIVE_INFINITY;
    this.flyRem = 0;
    this.cpx = 0;
    this.cpy = 0;
    this.cpz = 0;
    this.cdx = 0;
    this.cdz = 1;
    this.creach = 0;
    this.cslack = 0;
    this.s = 0;
    this.fx = 0;
    this.fz = 1;
    this.heading = 0;
    this.th = 0;
    this.om = 0;
    this.r = BAR_FACTS.radius;
    this.thDraw = 0;
    this.grabT = 0;
    this.grabDur = 0;
    this.fromX = 0;
    this.fromY = 0;
    this.fromZ = 0;
    this.reachT = 0;
    this.behind = 0;
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.tilt = 0;
    this.poseT = Number.NaN;
    this.startFrom = 0;
    this.startFade = 0;
    this.outT = 0;
    this.outDur = 0;
    this.regrabT = 0;
  }

  /** Holding the body (carried onto the bar, swinging on it, or in the flight off it). */
  get holding(): boolean {
    return this.phase !== BAR_NONE;
  }

  /** Maker B: the hands on a bar (carried onto it or swinging), not in the flight. */
  get onBar(): boolean {
    return this.phase === BAR_GRAB || this.phase === BAR_SWING;
  }

  /** Maker B: in the flight off a bar (`climb.barFlight` 'fly'). */
  get flying(): boolean {
    return this.phase === BAR_FLY;
  }

  /** Maker B: the action bar's word for the bar ('hang' on it: Space lets go, the crouch drops; 'fly' in the flight: nothing to press; '' neither). */
  promptWord(): '' | 'hang' | 'fly' {
    return this.phase === BAR_FLY ? 'fly' : this.phase !== BAR_NONE ? 'hang' : '';
  }

  /**
   * Maker B: a blow of `amount` health taken (the health the player's and the harness's `barFrame` find lost since the last frame
   * on the bar): one of `climb.barKnock` or more knocks the body off at the next step.
   */
  knock(amount: number): void {
    if (this.onBar && amount >= CLIMB_TUNE.barKnock) this.knocked = true;
  }

  /**
   * Maker B: where another player's game is told the body is while it hangs from a bar (the wire carries a rig state and a
   * place, not a bar's swing): the place a free hang whose idle has its hands on the grip stands at (that game's own
   * `PeerHang` lines its free hang's hands up there), into `out`. The swing is not on the wire; they see a still free hang that
   * moves along the bar with the hands.
   */
  peerPlace<V extends { x: number; y: number; z: number }>(out: V): V {
    const B = this.bar;
    const k = this.r / BAR_FACTS.radius;
    const gx = B.ax + B.ux * this.s;
    const gy = B.ay + B.uy * this.s;
    const gz = B.az + B.uz * this.s;
    const lx = PEER_IDLE ? k * PEER_IDLE.g0[0] : 0;
    const lz = PEER_IDLE ? k * PEER_IDLE.g0[2] : 0;
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    out.x = gx - (lx * ch + lz * sh);
    out.y = gy - k * PEER_OVER;
    out.z = gz - (-lx * sh + lz * ch);
    return out;
  }

  /** The drawn figure is still off the body's place (holding, or easing out after a let-go). */
  get offset(): boolean {
    return this.offX !== 0 || this.offY !== 0 || this.offZ !== 0 || this.tilt !== 0;
  }

  /** Let go outright (stood elsewhere, off the feet, a world unloaded): nothing held, nothing drawn off the body. */
  reset(why: string): void {
    void why;
    if (this.phase !== BAR_NONE) this.ended = true;
    this.phase = BAR_NONE;
    this.knocked = false;
    this.landNow = false;
    this.flyHand = false;
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.tilt = 0;
    this.poseT = Number.NaN;
    this.outT = 0;
    this.om = 0;
  }

  // ---- finding a bar ----------------------------------------------------------------------------------------------------

  /** One collider the reach's box met: a bar whose grip stands in the band, kept where it is the nearest yet. */
  private consider(c: BarCollider): boolean {
    if (c === this.regrabCol && this.regrabT > 0) return true;
    const B = this.found;
    if (!barAxisOf(c, B)) return true;
    const m = this.qmargin;
    if (B.len < 2 * m) return true;
    let s = (this.qpx - B.ax) * B.ux + (this.qpy - B.ay) * B.uy + (this.qpz - B.az) * B.uz;
    if (s < m) s = m;
    if (s > B.len - m) s = B.len - m;
    const gx = B.ax + B.ux * s;
    const gy = B.ay + B.uy * s;
    const gz = B.az + B.uz * s;
    const h = gy - this.qpy;
    if (h < this.qlo || h > this.qhi) return true;
    const dx = gx - this.qpx;
    const dz = gz - this.qpz;
    if (dx * dx + dz * dz > this.qahead * this.qahead) return true;
    const d = dx * dx + dz * dz + (h - (this.qlo + this.qhi) / 2) * (h - (this.qlo + this.qhi) / 2);
    if (d < this.bestD) {
      this.bestD = d;
      this.bestS = s;
      this.best.copy(B);
    }
    return true;
  }

  /** The nearest bar in reach of a body with its feet at `pos` into `best` (its grip `bestS` along it); false for none. */
  private search(world: BarWorld, pos: { x: number; y: number; z: number }, vy: number, li: LedgeIn): boolean {
    const sc = li.scale;
    const sweep = Math.min(SWEEP_MOST, Math.abs(vy) * li.dt);
    this.qpx = pos.x;
    this.qpy = pos.y;
    this.qpz = pos.z;
    this.qlo = CLIMB_TUNE.reachLow * sc - (vy > 0 ? sweep : 0);
    this.qhi = CLIMB_TUNE.reachHigh * sc + (vy < 0 ? sweep : 0);
    this.qahead = CLIMB_TUNE.reachAhead * sc;
    this.qmargin = BAR_HALF_SPAN * sc;
    this.bestD = Infinity;
    this.best.col = null;
    const hy = (this.qhi - this.qlo) / 2 + 0.05;
    const hx = this.qahead + 0.05;
    const need = Math.max(hy, hx);
    // (The box is made once, as large as asked yet: a larger figure or reach than before makes it once more.)
    if (!this.box || need > this.boxH) {
      this.boxH = Math.max(need, 1.2);
      this.box = this.makers.cuboid(this.boxH, this.boxH, this.boxH);
    }
    this.at.x = pos.x;
    this.at.y = pos.y + (this.qlo + this.qhi) / 2;
    this.at.z = pos.z;
    this.casts++;
    world.intersectionsWithShape(this.at, this.still, this.box, this.visit, STILL_FLAGS, li.filter);
    return this.best.col !== null;
  }

  /** Whether the hanging body (its standing capsule with its middle `r` under the grip) is clear of everything still but the bar. */
  private room(world: BarWorld, gx: number, gy: number, gz: number, th: number, li: LedgeIn): boolean {
    let cap = this.cap;
    if (!cap) cap = this.cap = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r);
    const r = this.r;
    this.at.x = gx + r * Math.sin(th) * this.fx;
    this.at.y = gy - r * Math.cos(th);
    this.at.z = gz + r * Math.sin(th) * this.fz;
    this.casts++;
    return world.intersectionWithShape(this.at, this.still, cap, STILL_FLAGS, li.filter, this.bar.col as unknown as RAPIER.Collider) === null;
  }

  /**
   * Maker B: one collider the catch's box met in the flight: a bar lying across the flight whose grip (its nearest point to the
   * hands, held a half span in from its ends) stands within the band ahead of the hands (`catchReach` along the flight's level
   * way, `catchSlack` behind, above, below and to either side), kept where it is the nearest yet. The bar let go of is never one.
   */
  private considerCatch(c: BarCollider): boolean {
    if (c === this.flyCol) return true;
    const B = this.found;
    if (!barAxisOf(c, B)) return true;
    const m = this.qmargin;
    if (B.len < 2 * m) return true;
    const along = B.ux * this.cdx + B.uz * this.cdz;
    if (along > CATCH_ACROSS || along < -CATCH_ACROSS) return true;
    let s = (this.cpx - B.ax) * B.ux + (this.cpy - B.ay) * B.uy + (this.cpz - B.az) * B.uz;
    if (s < m) s = m;
    if (s > B.len - m) s = B.len - m;
    const ox = B.ax + B.ux * s - this.cpx;
    const oy = B.ay + B.uy * s - this.cpy;
    const oz = B.az + B.uz * s - this.cpz;
    const sl = this.cslack;
    const ahead = ox * this.cdx + oz * this.cdz;
    if (ahead < -sl || ahead > this.creach) return true;
    const side = oz * this.cdx - ox * this.cdz;
    if (side < -sl || side > sl || oy < this.cbelow || oy > sl) return true;
    const d = ahead * ahead + side * side + oy * oy;
    if (d < this.bestD) {
      this.bestD = d;
      this.bestS = s;
      this.best.copy(B);
    }
    return true;
  }

  /**
   * Maker B: in the flight, a bar within the band ahead of the hands (the hands over the flying body's middle by the swing's
   * radius, the way the flight goes across the ground) into `best`, its grip `bestS` along it; false for none.
   */
  private catchFind(world: BarWorld, body: LedgeBody, li: LedgeIn): boolean {
    const lv = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (lv < CATCH_LEVEL) return false;
    const sc = li.scale;
    this.cdx = this.vx / lv;
    this.cdz = this.vz / lv;
    this.cpx = body.pos.x;
    this.cpy = body.pos.y + BAR_MID + this.r;
    this.cpz = body.pos.z;
    this.creach = CLIMB_TUNE.catchReach * sc;
    this.cslack = CLIMB_TUNE.catchSlack * sc;
    // (The band's lowest under the hands: the slack; at a contact (`contact`), down to the capsule's upper end where that is lower.)
    const arms = this.r - LEDGE_CAPSULE.stand;
    this.cbelow = this.contact && arms > this.cslack ? -arms : -this.cslack;
    this.qmargin = BAR_HALF_SPAN * sc;
    this.bestD = Infinity;
    this.best.col = null;
    const half = (this.creach + this.cslack) / 2;
    const need = (half > this.cslack ? half : this.cslack) + 0.05;
    if (!this.box || need > this.boxH) {
      this.boxH = need > 1.2 ? need : 1.2;
      this.box = this.makers.cuboid(this.boxH, this.boxH, this.boxH);
    }
    const mid = (this.creach - this.cslack) / 2;
    this.at.x = this.cpx + this.cdx * mid;
    this.at.y = this.cpy;
    this.at.z = this.cpz + this.cdz * mid;
    this.casts++;
    world.intersectionsWithShape(this.at, this.still, this.box, this.visitCatch, STILL_FLAGS, li.filter);
    return this.best.col !== null;
  }

  /**
   * Whether the whole of the swing's room is clear of everything still but the bar, at the hands' place along it now: one box
   * round every place the hanging body may swing to (its capsule at the largest swing either way, and a shift of the hands along
   * the bar), asked once at the grab and again only as the hands move on along the bar (an event). Open, the swing's steps ask
   * nothing; shut (a wall near), each step asks for its own capsule.
   */
  private openAt(world: BarWorld, li: LedgeIn): void {
    const B = this.bar;
    const r = this.r;
    const most = (CLIMB_TUNE.swingMost * Math.PI) / 180;
    const cr = LEDGE_CAPSULE.r;
    const ch = LEDGE_CAPSULE.stand + cr;
    const hf = r * Math.sin(most) + cr + 0.02;
    const bottom = -r - ch - 0.02;
    const top = -r * Math.cos(most) + ch + 0.02;
    const hy = (top - bottom) / 2;
    const hu = cr + BAR_OPEN_SLIP + 0.02;
    // (A box made again only where its sizes move: a figure, a radius or a largest swing of their own; a shift along the bar
    // moves the one it has, which nothing is made for: `step` asks it there itself, with the middle and the turn kept here.)
    if (this.openBox === null || hu !== this.openHu || hy !== this.openHy || hf !== this.openHf) {
      this.openBox = this.makers.cuboid(hu, hy, hf);
      this.openHu = hu;
      this.openHy = hy;
      this.openHf = hf;
    }
    this.openMid = (top + bottom) / 2;
    this.openMost = CLIMB_TUNE.swingMost;
    const gx = B.ax + B.ux * this.s;
    const gy = B.ay + B.uy * this.s;
    const gz = B.az + B.uz * this.s;
    this.at.x = gx;
    this.at.y = gy + this.openMid;
    this.at.z = gz;
    // Turned so its own x lies along the bar and its z across it (a turn about up).
    const psi = Math.atan2(-B.uz, B.ux);
    this.openRot.x = 0;
    this.openRot.y = Math.sin(psi / 2);
    this.openRot.z = 0;
    this.openRot.w = Math.cos(psi / 2);
    this.casts++;
    this.open = world.intersectionWithShape(this.at, this.openRot, this.openBox, STILL_FLAGS, li.filter, B.col as unknown as RAPIER.Collider) === null;
    this.openS = this.s;
  }

  /** Whether the use key would grab a bar here (the action bar's "climb": in reach, with room under it). */
  canGrab(world: BarWorld, body: LedgeBody, li: LedgeIn): boolean {
    if (CLIMB_TUNE.bars !== 'on' || this.holding || li.busy) return false;
    if (!this.search(world, body.pos, body.vel.y, li)) return false;
    return this.roomFor(world, body, li);
  }

  /** The found bar taken as the one held (its facing by the body's way), and whether the hang under it has room. */
  private roomFor(world: BarWorld, body: LedgeBody, li: LedgeIn): boolean {
    const B = this.best;
    this.bar.copy(B);
    this.s = this.bestS;
    // Across the bar, the side the body moves toward (or faces, standing still).
    let fx = B.uz;
    let fz = -B.ux;
    const fl = Math.sqrt(fx * fx + fz * fz) || 1;
    fx /= fl;
    fz /= fl;
    const vx = body.vel.x;
    const vz = body.vel.z;
    const toward = vx * vx + vz * vz > 0.25 ? vx * fx + vz * fz : Math.sin(li.heading) * fx + Math.cos(li.heading) * fz;
    if (toward < 0) {
      fx = -fx;
      fz = -fz;
    }
    this.fx = fx;
    this.fz = fz;
    this.r = BAR_FACTS.radius * li.scale;
    // The hanging body straight under the grip: the one test of a bar's room under it (src/player/barShape.ts's, which the
    // ledges ask too, so a bar-shaped collider with no room under it is theirs).
    let cap = this.cap;
    if (!cap) cap = this.cap = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r);
    const A = this.roomAsk;
    A.s = this.s;
    A.scale = li.scale;
    A.flags = STILL_FLAGS;
    A.filter = li.filter;
    this.casts++;
    return roomUnderBar(world as unknown as BarRoomWorld, this.bar, A, cap);
  }

  /**
   * After the move: a bar grabbed with the use key (see the header). True where the bar took the body (its place, heading and
   * the clip's start are written; the caller zeroes the movement's memories and hands its rig the start).
   */
  sense(world: BarWorld, body: LedgeBody, li: LedgeIn): boolean {
    if (CLIMB_TUNE.bars !== 'on' || this.holding) return false;
    // (Maker B: the refusal said again for a bar once the key has been let go of; it was never put down.)
    if (!li.use) this.saidCol = null;
    if (!li.use || li.busy) return false;
    const vy = body.vel.y;
    if (vy < -CLIMB_TUNE.grabFall) return false;
    if (!this.search(world, body.pos, vy, li)) return false;
    if (!this.roomFor(world, body, li)) {
      // Said once a bar while the key is held (a key held under it asks every frame).
      if (this.saidCol !== this.bar.col) this.said = 'No room to hang from the bar here.';
      this.saidCol = this.bar.col;
      return false;
    }
    this.saidCol = null;
    this.take(world, body, li);
    return true;
  }

  /** The grab: the pendulum started where the body is about the grip, its speed carried; the carry begun; the swing's room asked. */
  private take(world: BarWorld, body: LedgeBody, li: LedgeIn): void {
    const B = this.bar;
    const gx = B.ax + B.ux * this.s;
    const gy = B.ay + B.uy * this.s;
    const gz = B.az + B.uz * this.s;
    const mx = body.pos.x;
    const my = body.pos.y + BAR_MID;
    const mz = body.pos.z;
    const along = (mx - gx) * this.fx + (mz - gz) * this.fz;
    const down = gy - my;
    const most = (CLIMB_TUNE.swingMost * Math.PI) / 180;
    let th = Math.atan2(along, Math.max(1e-3, down));
    if (th > most) th = most;
    if (th < -most) th = -most;
    const r = this.r;
    const vx = body.vel.x;
    const vy = body.vel.y;
    const vz = body.vel.z;
    // The swing's speed: the body's along the pendulum's own way at that angle, a share carried, held to the largest swing.
    let om = (CLIMB_TUNE.swingCarry * ((vx * this.fx + vz * this.fz) * Math.cos(th) + vy * Math.sin(th))) / r;
    const g = CLIMB_TUNE.swingGravity;
    const room = Math.cos(th) - Math.cos(most);
    const omMost = room > 0 ? Math.sqrt((2 * g * room) / r) : 0;
    if (om > omMost) om = omMost;
    if (om < -omMost) om = -omMost;
    this.th = th;
    this.om = om;
    this.thDraw = th;
    this.fromX = mx;
    this.fromY = my;
    this.fromZ = mz;
    const across = Math.abs(vx * this.fx + vz * this.fz);
    // (Maker B: a catch from the flight off a bar plays the clip's reach whatever its speed across the bar.)
    this.reach = across > BAR_RUN || this.catching;
    this.caughtFrom = false;
    this.grabT = 0;
    this.reachT = 0;
    this.grabDur = this.reach ? BAR_TIMES.touch - BAR_TIMES.reach : CLIMB_TUNE.barGrab;
    this.heading = Math.atan2(this.fx, this.fz);
    this.phase = BAR_GRAB;
    this.frames = 0;
    this.outT = 0;
    this.ended = false;
    this.landNow = false;
    this.knocked = false;
    // (Maker B: the bar's own clip, by its rig name; a catch takes it back from the flight's twin.)
    this.clipName = BAR_CLIP_NAMES[BAR_CLIP];
    this.startClip = this.clipName;
    this.fresh = true;
    this.startFrom = this.reach ? BAR_TIMES.reach : BAR_FACTS.still;
    this.startFade = this.reach ? 0.1 : CLIMB_TUNE.ease;
    this.poseT = Number.NaN;
    body.vel.x = 0;
    body.vel.y = 0;
    body.vel.z = 0;
    this.openAt(world, li);
    this.place(body);
  }

  // ---- the swing --------------------------------------------------------------------------------------------------------

  /** The swing's largest angle its energy now reaches, radians (pi where it would go over the bar). */
  private amplitude(): number {
    const c = Math.cos(this.th) - (this.r * this.om * this.om) / (2 * CLIMB_TUNE.swingGravity);
    return c <= -1 ? Math.PI : c >= 1 ? 0 : Math.acos(c);
  }

  /** The body's place for the pendulum now (and, carried, between where it was and there). */
  private place(body: LedgeBody): void {
    const B = this.bar;
    const r = this.r;
    const gx = B.ax + B.ux * this.s;
    const gy = B.ay + B.uy * this.s;
    const gz = B.az + B.uz * this.s;
    let mx = gx + r * Math.sin(this.th) * this.fx;
    let my = gy - r * Math.cos(this.th);
    let mz = gz + r * Math.sin(this.th) * this.fz;
    if (this.phase === BAR_GRAB) {
      const w = ease(this.grabDur > 0 ? this.grabT / this.grabDur : 1);
      mx = this.fromX + (mx - this.fromX) * w;
      my = this.fromY + (my - this.fromY) * w;
      mz = this.fromZ + (mz - this.fromZ) * w;
    }
    body.pos.x = mx;
    body.pos.y = my - BAR_MID;
    body.pos.z = mz;
  }

  /** A frame in place of the movement (the keys of `li`, the steps the caller wrote in `steps`). */
  step(world: BarWorld, body: LedgeBody, li: LedgeIn): void {
    // (The grab's own frame keeps its start for the caller's rig, as the ledges' do: 'fresh'.)
    if (!this.fresh) this.startClip = '';
    this.fresh = false;
    if (!this.holding) return;
    this.frames++;
    this.landNow = false;
    const h = BAR_STEP;
    const n = this.steps;
    if (this.phase !== BAR_FLY) {
      // Maker B: a hard blow (`knock`) takes the hands off, straight down.
      if (this.knocked) {
        this.knocked = false;
        this.letGo(body, false);
        this.apexY = body.pos.y;
        return;
      }
      // Let go: the crouch key straight down; Space on the swing's own velocity, under `climb.barFlight` 'fly' into the flight
      // held here (and caught, or landed, on the steps below), under 'plain' handed to the movement as it is.
      if (li.jumpPressed && CLIMB_TUNE.barFlight === 'fly' && !li.crouchPressed) this.launch(body);
      else if (li.jumpPressed || li.crouchPressed) {
        this.letGo(body, li.jumpPressed);
        this.apexY = body.pos.y;
        return;
      }
    }
    this.flyHand = false;
    // (The largest swing's slider moved while on the bar: the swing's room sized and asked again for it, an event.)
    if (this.phase !== BAR_FLY && this.openMost !== CLIMB_TUNE.swingMost) this.openAt(world, li);
    const g = CLIMB_TUNE.swingGravity;
    const most = (CLIMB_TUNE.swingMost * Math.PI) / 180;
    const pump = CLIMB_TUNE.swingPump;
    const damp = CLIMB_TUNE.swingDamp;
    const lx = this.fz;
    const lz = -this.fx;
    const leftOnBar = this.bar.ux * lx + this.bar.uz * lz >= 0 ? 1 : -1;
    const side = li.leftHeld === li.rightHeld ? 0 : li.leftHeld ? leftOnBar : -leftOnBar;
    const margin = BAR_HALF_SPAN * li.scale;
    const r = this.r;
    for (let k = 0; k < n; k++) {
      // Maker B: a step of the flight (which may catch a bar, the steps after it the new swing's, or end it).
      if (this.phase === BAR_FLY) {
        this.flyStep(world, body, li);
        // (The step may have ended the flight: the phase read again, not the narrowed one.)
        if ((this.phase as number) === BAR_NONE) break;
        continue;
      }
      let a = 0;
      if (li.forwardHeld && this.om >= 0) a += pump;
      if (li.backHeld && this.om <= 0) a -= pump;
      if (a !== 0 && this.amplitude() >= most) a = 0;
      this.om += (-(g / r) * Math.sin(this.th) - damp * this.om + a) * h;
      const th = this.th + this.om * h;
      let s = this.s + side * CLIMB_TUNE.barShimmy * h;
      if (s < margin) s = margin;
      if (s > this.bar.len - margin) s = this.bar.len - margin;
      const B = this.bar;
      if (s - this.openS > BAR_OPEN_SLIP || this.openS - s > BAR_OPEN_SLIP) {
        // The hands have moved on along the bar: the swing's room asked again where they are now, its box, middle and turn the
        // grab's (`openAt`). Written out here, in the frame's own code: what a frame runs only now and then runs unoptimised and
        // makes every number it works out.
        this.s = s;
        this.at.x = B.ax + B.ux * s;
        this.at.y = B.ay + B.uy * s + this.openMid;
        this.at.z = B.az + B.uz * s;
        this.casts++;
        // (The query's groups handed on from a field kept boxed, written only when they move, which a number field beside it says:
        // a number read off a field of fractions and handed across a call, or set against one that is not a number, is boxed
        // afresh each time, 16 bytes each 0.25 m of a shimmy.)
        if (this.groupsNum !== li.filter) {
          this.groupsNum = li.filter;
          this.groups = li.filter;
        }
        this.open = world.intersectionWithShape(this.at, this.openRot, this.openBox as RAPIER.Shape, STILL_FLAGS, this.groups as number, B.col as unknown as RAPIER.Collider) === null;
        this.openS = s;
      }
      if (this.open || this.room(world, B.ax + B.ux * s, B.ay + B.uy * s, B.az + B.uz * s, th, li)) {
        this.th = th;
        this.s = s;
      } else this.om = 0;
      if (this.phase === BAR_GRAB) {
        this.grabT += h;
        if (this.grabT >= this.grabDur) this.phase = BAR_SWING;
      }
    }
    // Maker B: a flight falling past a grab (or held too long) handed to the movement at the frame's end, its steps flown.
    if (this.phase === BAR_FLY && this.flyHand) this.endFlight(body, this.flyEnd);
    if (this.phase === BAR_NONE) {
      // (A flight ended this frame: the body is the movement's from the next, with the fall's memory at the flight's top.)
      this.apexY = this.flyTop;
      return;
    }
    // (The grab's frame clock: what the drawn figure eases onto the bar by, every frame, where the body moves on the steps.)
    if (this.phase === BAR_GRAB) this.reachT += li.dt;
    // The frame's own time stands this far past the last step's (what the figure is drawn at).
    const rem = n >= 4 ? 0 : Math.min(h, Math.max(0, this.behind + li.dt - n * h));
    if (this.phase === BAR_FLY) {
      // Maker B: in the flight the body stands where the steps left it, and the figure is drawn led to the frame's own time.
      this.leadX = this.vx * rem;
      this.leadY = this.vy * rem - 0.5 * g * rem * rem;
      this.leadZ = this.vz * rem;
      this.flyRem = rem;
      this.outT = this.outT > li.dt ? this.outT - li.dt : 0;
      this.apexY = this.flyTop;
      body.vel.x = this.vx;
      body.vel.y = this.vy;
      body.vel.z = this.vz;
      return;
    }
    this.apexY = body.pos.y;
    this.thDraw = this.th + this.om * rem;
    this.heading = Math.atan2(this.fx, this.fz);
    body.vel.x = 0;
    body.vel.y = 0;
    body.vel.z = 0;
    this.place(body);
    this.apexY = body.pos.y;
  }

  /**
   * Maker B: Space with the hands on a bar (`climb.barFlight` 'fly'): the flight begun on the swing's own velocity at this
   * instant (the steps' state: the pendulum's way at its angle, `r` times its speed) and `climb.barBoost` more along that way
   * (forward at a standstill), the body where the swing has it; the flight's clip begun from the release (frame 52), the twin
   * of the bar's clip crossfaded from the swing's pose, and the figure's placement eased from the swing's over `climb.ease`.
   */
  private launch(body: LedgeBody): void {
    const sign = this.om < 0 ? -1 : 1;
    const speed = Math.abs(this.r * this.om) + CLIMB_TUNE.barBoost;
    const c = Math.cos(this.th);
    const sn = Math.sin(this.th);
    this.vx = sign * speed * c * this.fx;
    this.vy = sign * speed * sn;
    this.vz = sign * speed * c * this.fz;
    this.phase = BAR_FLY;
    this.flyT = 0;
    this.flyTop = body.pos.y;
    this.flyEnd = '';
    this.flyHand = false;
    this.flyCol = this.bar.col;
    this.flights++;
    this.fromOffX = this.offX;
    this.fromOffY = this.offY;
    this.fromOffZ = this.offZ;
    this.fromTilt = this.tilt;
    this.outDur = CLIMB_TUNE.ease;
    this.outT = this.outDur;
    this.leadX = 0;
    this.leadY = 0;
    this.leadZ = 0;
    this.clipName = BAR_FLIGHT_NAME;
    this.startClip = this.clipName;
    this.startFrom = BAR_TIMES.release;
    this.startFade = CLIMB_TUNE.ease;
    this.poseT = Number.NaN;
  }

  /**
   * Maker B: one of the physics' steps of the flight: the body's capsule swept along the step's parabola (the engine's shape
   * cast, the step's way as its velocity over one unit of time, so the time of impact is a share of the step). Meeting anything
   * still but the bar let go of (another bar the hands have not caught is as solid as a wall: a rail, a lower bar), the flight
   * ends there: ground under the feet a landing, else a wall. Clear, the body moves on, and a bar within the band ahead of the
   * hands is caught (the steps after it the new swing's); in the water the flight ends; falling past a grab, or held too long,
   * it is handed to the movement at the frame's end.
   */
  private flyStep(world: BarWorld, body: LedgeBody, li: LedgeIn): void {
    const g = CLIMB_TUNE.swingGravity;
    const h = BAR_STEP;
    const dx = this.vx * h;
    const dy = this.vy * h - 0.5 * g * h * h;
    const dz = this.vz * h;
    let cap = this.cap;
    if (!cap) cap = this.cap = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r);
    const at = this.at;
    at.x = body.pos.x;
    at.y = body.pos.y + BAR_MID;
    at.z = body.pos.z;
    const cv = this.castVel;
    cv.x = dx;
    cv.y = dy;
    cv.z = dz;
    this.casts++;
    const hit = world.castShape(at, this.still, cv, cap, 0, 1, false, STILL_FLAGS, li.filter, (this.flyCol ?? undefined) as unknown as RAPIER.Collider | undefined);
    if (hit !== null) {
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let u = hit.time_of_impact;
      if (len > 1e-9) u -= FLY_SKIN / len;
      if (u < 0) u = 0;
      if (u > 1) u = 1;
      body.pos.x += dx * u;
      body.pos.y += dy * u;
      body.pos.z += dz * u;
      this.vy -= g * h * u;
      this.flyT += h * u;
      // (The fix round's: a bar the body has flown into with the hands over it, at the head's and the arms' height above the
      // capsule's upper end, is caught where it was met, as the hands would come down onto it: a bar met lower is a wall.)
      this.contact = true;
      const took = this.tryCatch(world, body, li);
      this.contact = false;
      if (took) return;
      this.endFlight(body, hit.normal1.y >= FLY_GROUND ? 'land' : 'wall');
      return;
    }
    body.pos.x += dx;
    body.pos.y += dy;
    body.pos.z += dz;
    this.vy -= g * h;
    this.flyT += h;
    if (body.pos.y > this.flyTop) this.flyTop = body.pos.y;
    if (this.tryCatch(world, body, li)) return;
    if (body.pos.y < this.swimLine) {
      this.endFlight(body, 'water');
      return;
    }
    if (this.vy < -CLIMB_TUNE.grabFall) {
      this.flyHand = true;
      this.flyEnd = 'fall';
    } else if (this.flyT > FLY_MOST) {
      this.flyHand = true;
      this.flyEnd = 'long';
    }
  }

  /**
   * Maker B: in the flight, not falling past a grab, a bar in the band ahead of the hands with room under it taken (`take`): the
   * flight's velocity carried into the new swing (`take` reads the body's), the reach played, the figure eased from the flight's.
   * True where it took one. (`contact`: asked where the capsule met something, the band reaching down to the capsule's upper end.)
   */
  private tryCatch(world: BarWorld, body: LedgeBody, li: LedgeIn): boolean {
    if (this.vy < -CLIMB_TUNE.grabFall || !this.catchFind(world, body, li)) return false;
    body.vel.x = this.vx;
    body.vel.y = this.vy;
    body.vel.z = this.vz;
    if (this.roomFor(world, body, li)) {
      this.fromOffX = this.offX;
      this.fromOffY = this.offY;
      this.fromOffZ = this.offZ;
      this.fromTilt = this.tilt;
      this.catching = true;
      this.take(world, body, li);
      this.catching = false;
      this.caughtFrom = true;
      // (Inside the frame's step: its start is this frame's alone, as the let-go's is.)
      this.fresh = false;
      this.flyEnd = 'caught';
      this.catches++;
      return true;
    }
    body.vel.x = 0;
    body.vel.y = 0;
    body.vel.z = 0;
    return false;
  }

  /**
   * Maker B: the flight ended (`why`): the body handed to the movement with the flight's velocity, its drawn offset eased onto
   * it, the bar let go of not grabbed again at once; a landing's clip (2.10 s on) begun by the caller's rig (`landNow`), every
   * other end's flight crossfaded into the falling loop (`ended`).
   */
  private endFlight(body: LedgeBody, why: BarFlyEnd): void {
    this.flyEnd = why;
    body.vel.x = this.vx;
    body.vel.y = this.vy;
    body.vel.z = this.vz;
    this.phase = BAR_NONE;
    this.flyHand = false;
    if (why === 'land') {
      this.landNow = true;
      this.landings++;
    } else this.ended = true;
    this.outDur = CLIMB_TUNE.ease;
    this.outT = this.outDur;
    this.regrabT = CLIMB_TUNE.regrab;
    this.regrabCol = this.flyCol;
    this.poseT = Number.NaN;
  }

  /** Let go: the body handed the swing's own velocity (or none, straight down), the drawn offset eased out, the bar not grabbed again at once. */
  letGo(body: LedgeBody, swing: boolean): void {
    // (Maker B: in the flight, the console's let-go hands the movement the flight as it is.)
    if (this.phase === BAR_FLY) {
      this.endFlight(body, 'long');
      return;
    }
    const v = swing ? this.r * this.om : 0;
    const c = Math.cos(this.th);
    const sn = Math.sin(this.th);
    body.vel.x = v * c * this.fx;
    body.vel.y = v * sn;
    body.vel.z = v * c * this.fz;
    this.phase = BAR_NONE;
    this.ended = true;
    this.outDur = CLIMB_TUNE.ease;
    this.outT = this.outDur;
    this.regrabT = CLIMB_TUNE.regrab;
    this.regrabCol = this.bar.col;
    this.poseT = Number.NaN;
  }

  /** Off the bar, every frame: the drawn offset eased out after a let-go, and the let-go's one frame put down. */
  tick(dt: number): void {
    this.startClip = '';
    if (this.holding) return;
    this.ended = false;
    this.landNow = false;
    if (this.regrabT > 0) this.regrabT = Math.max(0, this.regrabT - dt);
    if (!this.offset) return;
    if (this.outT <= 0 || this.outDur <= 0) {
      this.offX = 0;
      this.offY = 0;
      this.offZ = 0;
      this.tilt = 0;
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
   * Where the figure is drawn this frame (after `step`, with the rig's own table of the clip and the rig's scale `k`): the clip's
   * time for the pendulum's angle (the reach's own time while a running jump's reach plays), and the figure's origin and turn so
   * its grip stands on the bar and its hips at the pendulum's angle. No table: drawn on the body, nothing held.
   */
  placeFigure(T: BarSwingTable | null, k: number, pos: { x: number; y: number; z: number }): void {
    if (!this.holding) return;
    if (this.phase === BAR_FLY) {
      this.placeFlight(k);
      return;
    }
    if (!T) {
      this.offX = 0;
      this.offY = 0;
      this.offZ = 0;
      this.tilt = 0;
      this.poseT = Number.NaN;
      return;
    }
    let t = T.timeAt(this.thDraw);
    let w = 1;
    if (this.phase === BAR_GRAB) {
      const u = this.grabDur > 0 ? Math.min(1, this.reachT / this.grabDur) : 1;
      if (this.reach) t = BAR_TIMES.reach + (t - BAR_TIMES.reach) * u;
      else w = ease(u);
    }
    const P = this.pose;
    T.at(t, P);
    // The figure turned about its own left by `-d` (a turn of a about +x takes a point at an angle th about the anchor, measured
    // from straight down toward +z, to th - a): its hips then stand at the pendulum's angle.
    const d = this.thDraw - P.angle;
    const cd = Math.cos(d);
    const sd = Math.sin(d);
    const lx = k * P.ax;
    const ly = k * (P.ay * cd + P.az * sd);
    const lz = k * (-P.ay * sd + P.az * cd);
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    const B = this.bar;
    const gx = B.ax + B.ux * this.s;
    const gy = B.ay + B.uy * this.s;
    const gz = B.az + B.uz * this.s;
    this.offX = (gx - pos.x - (lx * ch + lz * sh)) * w;
    this.offY = (gy - pos.y - ly) * w;
    this.offZ = (gz - pos.z - (-lx * sh + lz * ch)) * w;
    this.tilt = -d * w;
    this.poseT = t;
    // Maker B: a catch from the flight eased from the flight's placement onto the bar's over the clip's own reach.
    if (this.phase === BAR_GRAB && this.caughtFrom) {
      const v = ease(this.grabDur > 0 ? Math.min(1, this.reachT / this.grabDur) : 1);
      this.offX = this.fromOffX + (this.offX - this.fromOffX) * v;
      this.offY = this.fromOffY + (this.offY - this.fromOffY) * v;
      this.offZ = this.fromOffZ + (this.offZ - this.fromOffZ) * v;
      this.tilt = this.fromTilt + (this.tilt - this.fromTilt) * v;
    }
  }

  /**
   * Maker B: the flight's figure: the clip's flight (the release, frame 52, to the flight's end, frame 62, at its own rate, held
   * there while the body still flies) at the frame's own time, its hips drawn where the flying body's middle is (led to the
   * frame's time), eased from the let-go's placement over `climb.ease`; no flight table (no rig, or no clip yet): on the body.
   */
  private placeFlight(k: number): void {
    const F = this.flight;
    let t = BAR_TIMES.release + this.flyT + this.flyRem;
    if (t > BAR_TIMES.flightEnd) t = BAR_TIMES.flightEnd;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    if (F) {
      F.hipsAt(t);
      const lx = k * F.x;
      const lz = k * F.z;
      const ch = Math.cos(this.heading);
      const sh = Math.sin(this.heading);
      tx = this.leadX - (lx * ch + lz * sh);
      ty = this.leadY + BAR_MID - k * F.y;
      tz = this.leadZ - (-lx * sh + lz * ch);
      this.poseT = t;
    } else this.poseT = Number.NaN;
    const w = this.outDur > 0 ? this.outT / this.outDur : 0;
    this.offX = tx + (this.fromOffX - tx) * w;
    this.offY = ty + (this.fromOffY - ty) * w;
    this.offZ = tz + (this.fromOffZ - tz) * w;
    this.tilt = this.fromTilt * w;
  }

  /** The console's report (`__debug.climb()`'s `bar`): the phase, the swing, the bar and the drawn pose. */
  report(): Record<string, unknown> {
    const deg = 180 / Math.PI;
    return {
      on: CLIMB_TUNE.bars,
      phase: this.phase === BAR_NONE ? 'none' : this.phase === BAR_GRAB ? (this.reach ? 'reach' : 'grab') : this.phase === BAR_FLY ? 'fly' : 'swing',
      // Maker B: the flight off a bar (`climb.barFlight`), its last end, and its counts.
      flight: CLIMB_TUNE.barFlight,
      fly: this.phase === BAR_FLY ? { v: [+this.vx.toFixed(2), +this.vy.toFixed(2), +this.vz.toFixed(2)], t: +this.flyT.toFixed(3), top: +this.flyTop.toFixed(3) } : null,
      lastEnd: this.flyEnd,
      flights: this.flights,
      catches: this.catches,
      landings: this.landings,
      angle: +(this.th * deg).toFixed(2),
      speed: +(this.om * deg).toFixed(2),
      amplitude: +(this.amplitude() * deg).toFixed(2),
      radius: +this.r.toFixed(3),
      along: +this.s.toFixed(3),
      bar: this.holding ? { a: [+this.bar.ax.toFixed(3), +this.bar.ay.toFixed(3), +this.bar.az.toFixed(3)], u: [+this.bar.ux.toFixed(3), +this.bar.uy.toFixed(3), +this.bar.uz.toFixed(3)], length: +this.bar.len.toFixed(3), thick: +this.bar.thick.toFixed(3) } : null,
      poseT: this.poseT === this.poseT ? +this.poseT.toFixed(3) : null,
      tilt: +(this.tilt * deg).toFixed(2),
      frames: this.frames,
      casts: this.casts,
    };
  }
}
