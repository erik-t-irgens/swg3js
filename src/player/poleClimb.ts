// Climbing II, phase 5: climbing a pole (the owner's "Pole climbing as well would be nice", 2026-11-16), under `climb.poles` 'on'.
//
// A pole is a still collider long, upright and thin (src/player/barShape.ts's `poleAxisOf`: its cross-section under
// `climb.poleThin` over a length of at least `climb.poleLength`, its axis within `POLE_UPRIGHT` of upright): the course's `poles`,
// and any box, cylinder, capsule or mesh of that shape. One class, `PoleClimb`, holds a body on one, stepped by the player's
// update and by the node harness alike (tools/swg/tests/grappleBody.ts), at the places the ropes are (src/player/ropeSwing.ts):
//  - `sense`, after the move (after the ropes', before the ledges'): with the use key handed to the climb (`LedgeIn.use`, the
//    game's one use-key dispatch), a pole whose axis passes within the hands' reach of the body across the ground (the ledges'
//    `climb.reachAhead`, scaled by the figure) and through their reach band over the feet (`reachLow` to `reachHigh`, swept over
//    the frame's rise or fall) is grabbed facing it, the hands where the climb's clip has its grip over its feet (`POLE_FACTS.grip`)
//    held to the pole's ends, where the hanging body has room (standing by it, jumping or falling past it, no faster than
//    `climb.grabFall`). The body is carried onto it over `climb.poleGrab`.
//  - `step`, in place of the movement while it holds the body: the body hangs on the pole, its middle `POLE_FACTS.hang` under the
//    hands and `POLE_FACTS.out` off the axis toward where it stands round the pole; on the physics' own steps (the caller hands it
//    the steps the coming physics step takes, `Physics.stepsAhead`), so it climbs alike at every frame rate, W and S move the hands
//    up and down the pole (`climb.poleClimb`), stopping at its top (`POLE_TOP` under it) and its bottom (`POLE_TOP` over its foot,
//    or where the body meets something, the ground), and A and D carry the body round it (`climb.poleTurn`), stopping where it
//    would meet something; the body always faces the pole, the view free. Space and the crouch let go, straight down (the plain
//    let-go, which item 3 of the round builds on).
// Maker B, items 3 and 4 (off the pole), each its own switch whose other setting is that plain let-go or the stop at the top:
//  - Space (`climb.poleJump` 'fly'): a jump off along the view, its share toward the pole turned away from it (`jumpOff`: the body
//    pushes off, never through the pole) (`polePush` across the ground, `poleJumpUp` up), flown here on the
//    physics' own steps (`POLE_FLY`, the bars' own flight: the standing capsule swept along each step's parabola, the pole let go
//    of left out), and on each step of it another pole in reach taken as a grab takes one (the steps after it on the new pole), else
//    a bar or a lip in reach taken by the caller's own bars and ledges (`catcher`, the use key handed to them: a hop's catch, never a
//    key), the steps left of the frame handed to the bar (`stepsLeft`); met ground lands it, a wall ends it, the water ends it, and
//    falling past a grab or flying too long hands it to the movement at the frame's end, as a bar's flight is.
//  - The crouch (`climb.poleCrouch` 'slide'): a slide down at `poleSlide`, the clip held still and the hands and feet sliding with
//    the body, to the bottom (the ground under the body: let go onto it; the pole's foot with nothing under: dropped off it); the
//    crouch again lets go at once, W stops the slide.
//  - W at the top (`climb.poleTop` 'climb'): a lip or a floor's edge in reach (behind the body first, then ahead, then its sides)
//    climbed onto by the ledges' own climb up (src/player/ledge.ts's `climbFrom`, through `catcher.top`), the pole left out of its
//    room tests.
//  - Everything else, as the bars': a hard blow knocks the body off (`knock`, `climb.barKnock`), the feet in the water let go into
//    the swim (`swimLine`), the camera passes the pole held and the one jumped off while the jump flies (`cameraCollider`), another
//    player's game is told a free hang's place on the pole (`peerPlace`), and the action bar's words (`promptWord`).
// What the figure plays is the pole's clip (src/anim/poleClips.ts): `climbing_a_rope_1` held at its phase by the way climbed (its
// time the climb's share of a round, forward up and backward down), drawn with its mean grip on the pole's axis at the height the
// hands are; `limbsFor` hands the limbs' solve each hand's grip onto the axis at its own height and each foot's ball onto the
// pole's side at its own height, so the hands and feet stay on it.
//
// Nothing here makes an object on a frame: every ask and answer is a kept record, and the engine's own answers (a shape test's)
// are the only things made.

import * as THREE from 'three';
import type { RAPIER } from '../core/physics.ts';
import { STILL_FLAGS } from './stairSense.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { POLE_FACTS } from '../anim/poleClips.ts';
import { RopePose, type RopeTable } from '../anim/ropeClips.ts';
import { LEDGE_CAPSULE, type LedgeBody, type LedgeIn } from './ledge.ts';
import { BarAxis, poleAxisOf, type BarCollider } from './barShape.ts';
import type { LimbPlace, LimbRig } from './limbPlace.ts';
import { LEDGE_FACTS, LEDGE_REST, LEDGE_ROLES } from '../anim/ledgeClips.ts';

/** The physics' own step, the pole's (`FIXED_DT`; climbPoles.test.ts holds the two equal). */
export const POLE_STEP = 1 / 60;
/** How high the body's middle stands over its feet (the standing capsule's: what the hanging capsule is placed by). */
const POLE_MID = LEDGE_CAPSULE.r + LEDGE_CAPSULE.stand;
/** The hands go no nearer the pole's top, nor its foot, than this, metres (a mechanic: a fist's width). */
export const POLE_TOP = 0.1;
/** How far past the fastest frame's fall or rise the reach band is swept (a mechanic: the frame's own, no more; the ropes' own). */
const SWEEP_MOST = 0.6;
/** The hanging body's capsule is asked this much wider than it stands, metres (a mechanic: the engine's own answers flicker within a centimetre of a touch; the ropes' own). */
const ROOM_SKIN = 0.02;
/** A climb down stops this far short of something under the body, metres (a mechanic: clear of that same touch; the ropes' own). */
const ROOM_BACK = 0.06;
/** Standing nearer the axis than this across the ground, the body's side of the pole is the way it faces (a mechanic: a point on the axis has no side). */
const ON_AXIS = 1e-3;

/** The phase: holding nothing, carried onto the pole (a grab), or on it; (maker B) or in the flight of a jump off it. */
export const POLE_NONE = 0;
export const POLE_GRAB = 1;
export const POLE_ON = 2;
export const POLE_FLY = 3;

/** Maker B: what took the body off the pole this frame, for the caller to hand it on to (nothing; a bar or a lip caught in a jump's flight; the climb onto a lip from the top). */
export const HAND_NONE = 0;
export const HAND_BAR = 1;
export const HAND_LIP = 2;
export const HAND_TOP = 3;

/** Maker B: how far short of what the flying capsule meets it is stood, metres (a mechanic: the bars' own, the character controller's skin). */
const FLY_SKIN = 0.01;
/** Maker B: a contact whose normal stands up at least this much is ground under the feet (a mechanic: cos 55 degrees, the climb's walkable; the bars' own). */
const FLY_GROUND = 0.57;
/** Maker B: a flight held longer than this is handed to the movement whatever it is doing, seconds (a backstop, no number of feel; the bars' own). */
const FLY_MOST = 3;
/** Maker B: a flight slower than this across the ground has no way of its own to catch along, m/s (a mechanic: the bars' own). */
const FLY_LEVEL = 0.5;
/** Maker B: the free hang's idle (what another player's game is told a hang on the pole is: the nearest pose the wire has), its grip over its feet (the bars' own). */
const PEER_IDLE = LEDGE_FACTS[LEDGE_ROLES.free.idle];
const PEER_OVER = PEER_IDLE ? PEER_IDLE.g0[1] - (PEER_IDLE.a0 - LEDGE_REST.ankle) : 1.9;

/** Maker B: why the last flight off a pole ended, or the last let-go: caught by a pole, a bar or a lip; landed; a wall; the water; falling past a grab; held too long; (a let-go) knocked off, slid to the bottom, into the water, plainly. */
export type PoleEnd = '' | 'caught' | 'bar' | 'lip' | 'land' | 'wall' | 'water' | 'fall' | 'long' | 'knocked' | 'slid' | 'swim' | 'let go' | 'top';

/**
 * Maker B: the caller's own bars and ledges, asked on each step of a jump's flight with the body where the step left it and its
 * velocity the flight's (`bar`, `lip`: a bar or a lip in reach taken, the use key handed to them as a hop's catch is), and at the
 * pole's top with W held (`top`: a lip in reach climbed onto, the ledges' climb up), each the way `wayX`, `wayZ` look (fields: no
 * number crosses a call). True where it took the body.
 */
export interface PoleCatcher {
  bar(): boolean;
  lip(): boolean;
  top(): boolean;
}

/** The little of a physics world the poles ask (rapier's `World`). */
export interface PoleWorld {
  intersectionWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider): RAPIER.Collider | null;
  intersectionsWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, callback: (c: RAPIER.Collider) => boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): void;
  /** Maker B: the flying capsule swept along a step (the engine's shape cast), the pole jumped off left out. */
  castShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shapeVel: { x: number; y: number; z: number }, shape: RAPIER.Shape, targetDistance: number, maxToi: number, stopAtPenetration: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider): { collider: RAPIER.Collider; time_of_impact: number; normal1: { x: number; y: number; z: number } } | null;
}

/** The engine's two shapes the poles ask with, handed in once (so this file loads under node with no engine of its own). */
export interface PoleMakers {
  cuboid(hx: number, hy: number, hz: number): RAPIER.Cuboid;
  capsule(halfHeight: number, radius: number): RAPIER.Shape;
}

/** A smooth step, nought to one. */
const ease = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** A turn held to (-pi, pi]. */
const wrap = (a: number): number => {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v <= -Math.PI) v += 2 * Math.PI;
  return v;
};


export class PoleClimb {
  phase = POLE_NONE;
  /** The pole held (its axis from its foot up, its length, its thickness and its collider). */
  readonly pole = new BarAxis();
  /** The grip (the hands' mean) up the pole from its foot, metres; and at the frame's own time (what the figure is drawn at). */
  s = 0.5;
  sDraw = 0.5;
  /** Where the body stands round the pole: its middle at the axis plus `out` along (sin phi, 0, cos phi); and at the frame's own time. */
  phi = 0.5;
  phiDraw = 0.5;
  /** The heading the figure is drawn facing (the pole: the way opposite where it stands round it, at the frame's own time). */
  heading = 0.5;
  /** The body's middle under the hands, and off the axis, metres (`POLE_FACTS`, scaled at the grab). */
  hang = 0.5;
  out = 0.5;
  /** The figure's scale against the human male at the grab. */
  k = 0.5;
  /** Written by the caller before `step`: how many of the physics' steps the coming one takes, and how far the bodies stand behind the frame now. */
  steps = 0;
  behind = 0.5;
  /** The way climbed up the pole since the grab, metres (the clip's phase), this frame's share of it, and the speeds of the last step (up, and round in radians a second). */
  climbed = 0.5;
  climbNow = 0.5;
  climbV = 0.5;
  turnV = 0.5;
  /** How far round the pole the body has turned since the grab, radians (the console's and the tests'). */
  turned = 0.5;
  /** A grab's carry: its clock on the steps and its length, the body's middle at the grab, and its frame clock (the drawn ease). */
  grabT = 0.5;
  grabDur = 0.5;
  fromX = 0.5;
  fromY = 0.5;
  fromZ = 0.5;
  reachT = 0.5;
  /** The clip's time to put it at (its loop's, by the way climbed; NaN none). */
  loopT = 0.5;
  /** The drawn figure against the body (the world's frame). */
  offX = 0.5;
  offY = 0.5;
  offZ = 0.5;
  /** The grab's own frame (the caller's rig takes up the pole's clip), and the let-go's (it lets go of it). */
  startClip = false;
  ended = false;
  private fresh = false;
  /** After a let-go: the drawn offset eased out over this long more (seconds left, and the whole), and the pole not grabbed again for `regrab`. */
  outT = 0.5;
  outDur = 0.5;
  private regrabT = 0.5;
  private regrabCol: BarCollider | null = null;
  /** Said on the message line (a refusal in words), '' for nothing; the caller hands it on. */
  said = '';
  private saidCol: BarCollider | null = null;
  /** The frames held, the shape tests asked (the engine's own answers: what a frame makes), the grabs. */
  frames = 0;
  casts = 0;
  grabs = 0;
  /** Where the climb last stopped ('' moving or not, 'top', 'bottom' (its foot or the ground under the body), 'met' (something in the way up, down or round)). */
  stop = '';
  /** The frame's own time step (handed to `placeFigure`'s eases). */
  private dtNow = 0.5;

  private readonly makers: PoleMakers;
  private cap: RAPIER.Shape | null = null;
  private box: RAPIER.Cuboid | null = null;
  private boxH = 0.5;
  /** A room ask's grip up the pole, side round it and drop (fields, read by `middleAt` and `room`). */
  private rs = 0.5;
  private rphi = 0.5;
  private rdrop = 0.5;
  private readonly at = { x: 0, y: 0, z: 0 };
  private readonly still = { x: 0, y: 0, z: 0, w: 1 };
  private readonly pose = new RopePose();
  /** The search: its ask (the feet, the band, the reach, the grip wanted) and its best so far. */
  private readonly found = new BarAxis();
  private readonly best = new BarAxis();
  private bestS = 0.5;
  private bestD = 0.5;
  private qpx = 0.5;
  private qpy = 0.5;
  private qpz = 0.5;
  private qlo = 0.5;
  private qhi = 0.5;
  private qwant = 0.5;
  private qahead = 0.5;
  private qend = 0.5;
  private readonly visit: (c: RAPIER.Collider) => boolean;
  /** The limbs' scratch (`limbsFor`: a hand's grip and a foot's ball as posed), kept. */
  private readonly grip = new THREE.Vector3();

  // ---- maker B: off the pole -------------------------------------------------------------------------------------------------
  /** The caller's own bars and ledges, asked in a jump's flight and at the top (null: nothing but poles caught, nothing climbed onto). */
  catcher: PoleCatcher | null = null;
  /** The way a catcher looks (unit, across the ground: the flight's own, or the way tried at the top). */
  wayX = 0.5;
  wayZ = 0.5;
  /** What took the body off the pole this frame (`HAND_*`) and, for a bar, the physics' steps of the frame left for it. */
  handed = 0;
  stepsLeft = 0;
  /** The flight: its velocity, its time flown on the steps, the feet's highest (the fall's memory), its end's word, handed to the movement at the frame's end, the pole jumped off. */
  vx = 0.5;
  vy = 0.5;
  vz = 0.5;
  flyT = 0.5;
  flyTop = 0.5;
  private flyHand = false;
  flyCol: BarCollider | null = null;
  /** Why the last flight or let-go ended (`PoleEnd`), and the counts of jumps, catches (a pole, a bar, a lip), landings, slides and climbs off the top. */
  end: PoleEnd = '';
  flights = 0;
  catches = 0;
  barCatches = 0;
  lipCatches = 0;
  landings = 0;
  slides = 0;
  tops = 0;
  /** Where the caller holds the fall's memory this frame: the flight's top while flying and the frame it ends, else the feet. */
  apexY = 0.5;
  /** The feet's height under which the body swims (the water's surface less the swim's depth; -Infinity for none): set by the caller before `step`. */
  swimLine = 0.5;
  /** The slide down under way (the crouch, `climb.poleCrouch` 'slide'). */
  sliding = false;
  /** A blow hard enough was taken (`knock`): the body comes off, straight down, at the next step. */
  private knocked = false;
  /** W at the top asked the catcher once since it was held there (asked again once W is let go). */
  private topAsked = false;
  /** The flight's drawn lead to the frame's own time, the let-go's offset it eases out from, and the heading it turns to (its way). */
  private leadX = 0.5;
  private leadY = 0.5;
  private leadZ = 0.5;
  private fromOffX = 0.5;
  private fromOffY = 0.5;
  private fromOffZ = 0.5;
  private headTo = 0.5;
  /** The step of the frame a flight is on (a catch's `stepsLeft`), the reach band's sweep time (the frame's, or a flight step's), the flying capsule and its sweep. */
  private stepK = 0;
  private qdt = 0.5;
  private qvy = 0.5;
  private flyCap: RAPIER.Shape | null = null;
  private readonly castVel = { x: 0, y: 0, z: 0 };

  constructor(makers: PoleMakers) {
    this.makers = makers;
    this.s = 0;
    this.sDraw = 0;
    this.phi = 0;
    this.phiDraw = 0;
    this.heading = 0;
    this.hang = POLE_FACTS.hang;
    this.out = POLE_FACTS.out;
    this.k = 1;
    this.behind = 0;
    this.climbed = 0;
    this.climbNow = 0;
    this.climbV = 0;
    this.turnV = 0;
    this.turned = 0;
    this.grabT = 0;
    this.grabDur = 0;
    this.fromX = 0;
    this.fromY = 0;
    this.fromZ = 0;
    this.reachT = 0;
    this.loopT = Number.NaN;
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.outT = 0;
    this.outDur = 0;
    this.regrabT = 0;
    this.dtNow = 0;
    this.boxH = 0;
    this.rs = 0;
    this.rphi = 0;
    this.rdrop = 0;
    this.bestS = 0;
    this.bestD = 0;
    this.qpx = 0;
    this.qpy = 0;
    this.qpz = 0;
    this.qlo = 0;
    this.qhi = 0;
    this.qwant = 0;
    this.qahead = 0;
    this.qend = 0;
    this.wayX = 0;
    this.wayZ = 1;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.flyT = 0;
    this.flyTop = 0;
    this.apexY = 0;
    this.swimLine = Number.NEGATIVE_INFINITY;
    this.leadX = 0;
    this.leadY = 0;
    this.leadZ = 0;
    this.fromOffX = 0;
    this.fromOffY = 0;
    this.fromOffZ = 0;
    this.headTo = 0;
    this.qdt = 0;
    this.qvy = 0;
    this.visit = (c) => this.consider(c as unknown as BarCollider);
  }

  /** Holding the body (carried onto the pole, or on it). */
  get holding(): boolean {
    return this.phase !== POLE_NONE;
  }

  /** The hands on the pole (carried onto it, or on it): the same as `holding` until the round's let-go flights come. */
  get onPole(): boolean {
    return this.phase === POLE_GRAB || this.phase === POLE_ON;
  }

  /** The drawn figure is still off the body's place (holding, or easing out after a let-go). */
  get offset(): boolean {
    return this.offX !== 0 || this.offY !== 0 || this.offZ !== 0;
  }

  /**
   * Feedback round II, item 0a's rule for the pole (`climb.barCamera` 'pass'): the pole the hands hold or are carried onto, which
   * the camera's block leaves out (the engine's ray handed it as its excluded collider); null otherwise, and always under 'block'.
   */
  cameraCollider(): BarCollider | null {
    if (CLIMB_TUNE.barCamera !== 'pass') return null;
    // (Maker B: and the pole jumped off, for the length of the jump's flight, as the bar let go of is.)
    if (this.phase === POLE_FLY) return this.flyCol;
    return this.onPole ? this.pole.col : null;
  }

  /** Maker B: the hands' height on the pole (the grip's), metres: what a climb onto a lip from the top reaches about. */
  get gripY(): number {
    return this.pole.ay + this.pole.uy * this.s;
  }

  /** Maker B: in the flight of a jump off the pole. */
  get flying(): boolean {
    return this.phase === POLE_FLY;
  }

  /**
   * Maker B: the action bar's word ('' off the pole): in the flight 'fly' (nothing to press: what is in reach is caught by itself);
   * on the pole by its switches, 'pole' (Space jumps off, the crouch slides down), 'poleDrop' (Space jumps off, the crouch drops),
   * 'poleSlide' (Space lets go, the crouch slides down), or the bar's own 'hang' (Space lets go, the crouch drops).
   */
  promptWord(): '' | 'hang' | 'fly' | 'pole' | 'poleDrop' | 'poleSlide' {
    if (this.phase === POLE_NONE) return '';
    if (this.phase === POLE_FLY) return 'fly';
    const jump = CLIMB_TUNE.poleJump === 'fly';
    const slide = CLIMB_TUNE.poleCrouch === 'slide';
    return jump ? (slide ? 'pole' : 'poleDrop') : slide ? 'poleSlide' : 'hang';
  }

  /** Maker B: a blow of `amount` health taken since the last frame on the pole (the caller measures it): one of `climb.barKnock` or more knocks the body off at the next step, as off a bar. */
  knock(amount: number): void {
    if (this.onPole && amount >= CLIMB_TUNE.barKnock) this.knocked = true;
  }

  /**
   * Maker B: where another player's game is told the body is while it holds the pole (the wire carries a rig state and a place,
   * not a pole's climb): the place a free hang whose idle has its hands on the grip stands at, the grip on the pole's axis where the
   * hands are, facing it (that game's own `PeerHang` lines its free hang's hands up there), into `out`; the bars' own rule.
   */
  peerPlace<V extends { x: number; y: number; z: number }>(out: V): V {
    const A = this.pole;
    const k = this.k;
    const gx = A.ax + A.ux * this.sDraw;
    const gy = A.ay + A.uy * this.sDraw;
    const gz = A.az + A.uz * this.sDraw;
    const lx = PEER_IDLE ? k * PEER_IDLE.g0[0] : 0;
    const lz = PEER_IDLE ? k * PEER_IDLE.g0[2] : 0;
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    out.x = gx - (lx * ch + lz * sh);
    out.y = gy - k * PEER_OVER;
    out.z = gz - (-lx * sh + lz * ch);
    return out;
  }

  /** Let go outright (stood elsewhere, off the feet, a world unloaded): nothing held, nothing drawn off the body. */
  reset(why: string): void {
    void why;
    if (this.phase !== POLE_NONE) this.ended = true;
    this.phase = POLE_NONE;
    this.sliding = false;
    this.knocked = false;
    this.flyHand = false;
    this.handed = HAND_NONE;
    this.topAsked = false;
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.loopT = Number.NaN;
    this.outT = 0;
    this.climbV = 0;
    this.turnV = 0;
  }

  // ---- finding a pole ---------------------------------------------------------------------------------------------------

  /** One collider the reach's box met: a pole whose axis passes through the band within reach, kept where it is the nearest yet. */
  private consider(c: BarCollider): boolean {
    if (c === this.regrabCol && this.regrabT > 0) return true;
    // (Maker B: in a jump's flight, the pole jumped off is never caught again.)
    if (c === this.flyCol && this.phase === POLE_FLY) return true;
    const P = this.found;
    if (!poleAxisOf(c, P)) return true;
    // The grip where the clip has it over the feet, held to the pole's ends (a fist's width in from each).
    const end = this.qend;
    if (P.len < 2 * end) return true;
    let s = P.uy > 1e-6 ? (this.qwant - P.ay) / P.uy : 0;
    if (s < end) s = end;
    if (s > P.len - end) s = P.len - end;
    const gx = P.ax + P.ux * s;
    const gy = P.ay + P.uy * s;
    const gz = P.az + P.uz * s;
    const h = gy - this.qpy;
    if (h < this.qlo || h > this.qhi) return true;
    const dx = gx - this.qpx;
    const dz = gz - this.qpz;
    const reach = this.qahead + P.thick / 2;
    const l2 = dx * dx + dz * dz;
    if (l2 > reach * reach) return true;
    const dw = gy - this.qwant;
    const d = l2 + dw * dw;
    if (d < this.bestD) {
      this.bestD = d;
      this.bestS = s;
      this.best.copy(P);
    }
    return true;
  }

  /** The nearest pole in reach of a body with its feet at `pos` into `best` (its grip `bestS` up it); false for none. */
  private search(world: PoleWorld, pos: { x: number; y: number; z: number }, li: LedgeIn): boolean {
    // (Maker B: the vertical speed read off a field, `qvy`: a number handed across a call the compiler leaves out is a number made.)
    const vy = this.qvy;
    const sc = li.scale;
    // (Maker B: swept over the frame's own time, or a flight's step's: `qdt`, written by the caller of the search.)
    const sweep = Math.min(SWEEP_MOST, Math.abs(vy) * this.qdt);
    this.qpx = pos.x;
    this.qpy = pos.y;
    this.qpz = pos.z;
    this.qlo = CLIMB_TUNE.reachLow * sc - (vy > 0 ? sweep : 0);
    this.qhi = CLIMB_TUNE.reachHigh * sc + (vy < 0 ? sweep : 0);
    this.qwant = pos.y + POLE_FACTS.grip * sc;
    this.qahead = CLIMB_TUNE.reachAhead * sc;
    this.qend = POLE_TOP * sc;
    this.bestD = Infinity;
    this.best.col = null;
    const hy = (this.qhi - this.qlo) / 2 + 0.05;
    const hx = this.qahead + CLIMB_TUNE.poleThin + 0.05;
    const need = hy > hx ? hy : hx;
    // (The box is made once, as large as asked yet: a larger figure or reach than before makes it once more.)
    if (!this.box || need > this.boxH) {
      this.boxH = need > 1.2 ? need : 1.2;
      this.box = this.makers.cuboid(this.boxH, this.boxH, this.boxH);
    }
    this.at.x = pos.x;
    this.at.y = pos.y + (this.qlo + this.qhi) / 2;
    this.at.z = pos.z;
    this.casts++;
    world.intersectionsWithShape(this.at, this.still, this.box, this.visit, STILL_FLAGS, li.filter);
    return this.best.col !== null;
  }

  /** The body's middle for the grip `rs` up the held pole and the side `rphi` round it, into `at` (fields: no number crosses a call). */
  private middleAt(): void {
    const P = this.pole;
    const s = this.rs;
    const phi = this.rphi;
    this.at.x = P.ax + P.ux * s + this.out * Math.sin(phi);
    this.at.y = P.ay + P.uy * s - this.hang;
    this.at.z = P.az + P.uz * s + this.out * Math.cos(phi);
  }

  /** Whether the hanging body (its standing capsule, a skin wider) at the grip `rs` and the side `rphi`, `rdrop` lower, is clear of everything still but the pole. */
  private room(world: PoleWorld, li: LedgeIn): boolean {
    let cap = this.cap;
    if (!cap) cap = this.cap = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r + ROOM_SKIN);
    this.middleAt();
    this.at.y -= this.rdrop;
    this.casts++;
    return world.intersectionWithShape(this.at, this.still, cap, STILL_FLAGS, li.filter, this.pole.col as unknown as RAPIER.Collider) === null;
  }

  /** The found pole taken as the one to hold (the body's side of it where it stands), and whether the hang there has room. */
  private roomFor(world: PoleWorld, body: LedgeBody, li: LedgeIn): boolean {
    const P = this.pole.copy(this.best);
    this.k = li.scale;
    this.hang = POLE_FACTS.hang * li.scale;
    this.out = POLE_FACTS.out * li.scale;
    this.s = this.bestS;
    const gx = P.ax + P.ux * this.s;
    const gz = P.az + P.uz * this.s;
    const vx = body.pos.x - gx;
    const vz = body.pos.z - gz;
    this.phi = vx * vx + vz * vz > ON_AXIS * ON_AXIS ? Math.atan2(vx, vz) : li.heading + Math.PI;
    this.rs = this.s;
    this.rphi = this.phi;
    this.rdrop = 0;
    return this.room(world, li);
  }

  /** Whether the use key would grab a pole here (the action bar's "climb": in reach, with room on it). */
  canGrab(world: PoleWorld, body: LedgeBody, li: LedgeIn): boolean {
    if (CLIMB_TUNE.poles !== 'on' || this.holding || li.busy) return false;
    this.qdt = li.dt;
    this.qvy = body.vel.y;
    if (!this.search(world, body.pos, li)) return false;
    return this.roomFor(world, body, li);
  }

  /**
   * After the move: a pole grabbed with the use key (see the header). True where the pole took the body (its place and heading
   * are written; the caller zeroes the movement's memories and hands its rig the pole's clip).
   */
  sense(world: PoleWorld, body: LedgeBody, li: LedgeIn): boolean {
    if (CLIMB_TUNE.poles !== 'on' || this.holding) return false;
    if (!li.use) this.saidCol = null;
    if (!li.use || li.busy) return false;
    const vy = body.vel.y;
    if (vy < -CLIMB_TUNE.grabFall) return false;
    this.qdt = li.dt;
    this.qvy = vy;
    if (!this.search(world, body.pos, li)) return false;
    if (!this.roomFor(world, body, li)) {
      // Said once a pole while the key is held.
      if (this.saidCol !== this.best.col) this.said = 'No room to climb the pole here.';
      this.saidCol = this.best.col;
      return false;
    }
    this.saidCol = null;
    this.take(body);
    return true;
  }

  /** The grab: the body's place on the pole begun, carried over `climb.poleGrab` from where it is; facing the pole. */
  private take(body: LedgeBody): void {
    this.phase = POLE_GRAB;
    this.fromX = body.pos.x;
    this.fromY = body.pos.y + POLE_MID;
    this.fromZ = body.pos.z;
    this.grabT = 0;
    this.reachT = 0;
    this.grabDur = CLIMB_TUNE.poleGrab;
    this.sDraw = this.s;
    this.phiDraw = this.phi;
    this.heading = wrap(this.phi + Math.PI);
    this.frames = 0;
    this.outT = 0;
    this.ended = false;
    this.climbed = 0;
    this.climbNow = 0;
    this.climbV = 0;
    this.turnV = 0;
    this.turned = 0;
    this.stop = '';
    this.startClip = true;
    this.fresh = true;
    this.loopT = Number.NaN;
    this.grabs++;
    // (Maker B: nothing of a slide, a blow or the top carried onto a pole newly held.)
    this.sliding = false;
    this.knocked = false;
    this.topAsked = false;
    body.vel.x = 0;
    body.vel.y = 0;
    body.vel.z = 0;
    this.place(body);
  }

  // ---- on the pole ------------------------------------------------------------------------------------------------------

  /** The body's place for the grip and the side now (and, carried, between where it was and there). */
  private place(body: LedgeBody): void {
    this.rs = this.s;
    this.rphi = this.phi;
    this.middleAt();
    let mx = this.at.x;
    let my = this.at.y;
    let mz = this.at.z;
    if (this.phase === POLE_GRAB) {
      const w = ease(this.grabDur > 0 ? this.grabT / this.grabDur : 1);
      mx = this.fromX + (mx - this.fromX) * w;
      my = this.fromY + (my - this.fromY) * w;
      mz = this.fromZ + (mz - this.fromZ) * w;
    }
    body.pos.x = mx;
    body.pos.y = my - POLE_MID;
    body.pos.z = mz;
  }

  /** A frame in place of the movement (the keys of `li`, the steps the caller wrote in `steps`). */
  step(world: PoleWorld, body: LedgeBody, li: LedgeIn): void {
    // (The grab's own frame keeps its start for the caller's rig, as the ropes' do: 'fresh'.)
    if (!this.fresh) this.startClip = false;
    this.fresh = false;
    // (Maker B: what took the body off the pole is this frame's alone.)
    this.handed = HAND_NONE;
    if (!this.holding) return;
    this.frames++;
    // (The frame's own step and W held, read here and only here: a jump's flight asks the caller's catcher, whose own frame record
    // may be the one `li` is (the player's kept `LedgeIn`, written with a physics step's time and no keys), so after the steps below
    // `li` is never read again; the frame's step is `dtNow`.)
    this.dtNow = li.dt;
    const fwdHeld = li.forwardHeld;
    const T = CLIMB_TUNE;
    if (this.phase === POLE_FLY) {
      // (Maker B: the jump's own frame told the caller's rig of the let-go; the flight's frames after it tell it nothing.)
      this.ended = false;
    } else {
      // Maker B: a hard blow (`knock`) takes the hands off, straight down.
      if (this.knocked) {
        this.knocked = false;
        this.letGo(body);
        this.end = 'knocked';
        return;
      }
      // Space: under `climb.poleJump` 'fly' the jump off (on the pole, never while still carried onto it), its flight held here on
      // the steps below; else (and the crouch under `climb.poleCrouch` 'drop', or the crouch again while sliding) let go straight
      // down, the plain let-go. The crouch under 'slide' begins the slide down, and W stops it.
      if (li.jumpPressed && T.poleJump === 'fly' && this.phase === POLE_ON) this.jumpOff(body, li);
      else if (li.jumpPressed || (li.crouchPressed && (T.poleCrouch !== 'slide' || this.sliding || this.phase !== POLE_ON))) {
        this.letGo(body);
        return;
      } else if (li.crouchPressed) {
        this.sliding = true;
        this.slides++;
      } else if (this.sliding && li.forwardPressed) this.sliding = false;
    }
    const h = POLE_STEP;
    const n = this.steps;
    const P = this.pole;
    const end = POLE_TOP * this.k;
    const top = P.len - end;
    const sliding = this.sliding;
    // (Sliding, the crouch takes the body down whatever is held, and nothing turns it round.)
    const climbDir = sliding ? -1 : li.forwardHeld && !li.backHeld ? 1 : li.backHeld && !li.forwardHeld ? -1 : 0;
    // D carries the body to its right round the pole (phi rises), A to its left.
    const turnDir = sliding ? 0 : li.rightHeld && !li.leftHeld ? 1 : li.leftHeld && !li.rightHeld ? -1 : 0;
    const climb = sliding ? T.poleSlide : T.poleClimb;
    const turn = (T.poleTurn * Math.PI) / 180;
    let climbedNow = 0;
    let movedNow = 0;
    let turnedNow = 0;
    // (Where the climb stopped is said again only on a frame that steps: a frame with no step at 144 a second keeps the last.)
    if (n > 0 && this.phase !== POLE_FLY) this.stop = '';
    for (let k = 0; k < n; k++) {
      // Maker B: a step of the jump's flight (which may catch another pole, its steps after it the climb's; or hand the body on to a
      // bar or a lip, or end the flight).
      if (this.phase === POLE_FLY) {
        this.stepK = k;
        this.flyStep(world, body, li);
        // (The step may have ended the flight: the phase read again, not the narrowed one.)
        if ((this.phase as number) === POLE_NONE) break;
        // (A pole caught: the stop is said afresh for its steps.)
        if ((this.phase as number) !== POLE_FLY) this.stop = '';
        continue;
      }
      let s1 = this.s + climbDir * climb * h;
      if (s1 > top) {
        s1 = top;
        if (climbDir > 0) this.stop = 'top';
      }
      if (s1 < end) {
        s1 = end;
        if (climbDir < 0) this.stop = 'bottom';
      }
      let phi1 = this.phi + turnDir * turn * h;
      // (Each room ask's numbers go in fields: a number handed across a call the compiler leaves out is a number made.)
      this.rs = s1;
      this.rphi = phi1;
      this.rdrop = ROOM_BACK;
      // Down: a hand's breadth short of what is under the body (the ground), clear of the engine's own tolerance about a touch.
      if (s1 < this.s && !this.room(world, li)) {
        s1 = this.s;
        this.stop = 'bottom';
      }
      // The step's own place asked; met (a beam over the head, a wall beside the pole), the step is not taken.
      this.rs = s1;
      this.rdrop = 0;
      if ((s1 !== this.s || phi1 !== this.phi) && !this.room(world, li)) {
        // (A climb and a turn at once: the turn alone tried before both are given up.)
        this.rs = this.s;
        if (s1 !== this.s && phi1 !== this.phi && this.room(world, li)) s1 = this.s;
        else {
          s1 = this.s;
          phi1 = this.phi;
        }
        this.stop = 'met';
      }
      // (Maker B: a slide moves the hands and the body down and the clip not at all: held still, the hands sliding on the pole.)
      if (!sliding) climbedNow += s1 - this.s;
      movedNow += s1 - this.s;
      turnedNow += phi1 - this.phi;
      this.s = s1;
      // (Held to (-pi, pi] in line: a step turns it less than a whole turn, so one correction is `wrap`'s answer.)
      if (phi1 > Math.PI) phi1 -= 2 * Math.PI;
      else if (phi1 <= -Math.PI) phi1 += 2 * Math.PI;
      this.phi = phi1;
      if (this.phase === POLE_GRAB) {
        this.grabT += h;
        if (this.grabT >= this.grabDur) this.phase = POLE_ON;
      }
    }
    // Maker B: the flight's end, and what took the body on (a pole caught goes on below as any grab).
    if (this.phase === POLE_FLY && this.flyHand) this.endFlight(body, this.end);
    if (this.phase === POLE_NONE) {
      // (A flight ended or handed on this frame: the body is the movement's or the catcher's from here, the fall's memory at the flight's top.)
      this.apexY = this.flyTop;
      return;
    }
    if (this.phase === POLE_FLY) {
      this.flyFrame(body);
      return;
    }
    this.climbNow = climbedNow;
    this.climbed += climbedNow;
    this.turned += turnedNow;
    // The speeds of the last steps (what the frame's own time past them draws: none while stopped). (Maker B: the hands' own way,
    // a slide's included; on a climb it is the clip's way too.)
    this.climbV = n > 0 ? movedNow / (n * h) : this.climbV;
    this.turnV = n > 0 ? turnedNow / (n * h) : this.turnV;
    if (this.phase === POLE_GRAB) this.reachT += this.dtNow;
    // The frame's own time stands this far past the last step's (what the figure is drawn at).
    const rem = n >= 4 ? 0 : Math.min(h, Math.max(0, this.behind + this.dtNow - n * h));
    let sd = this.s + this.climbV * rem;
    if (sd > top) sd = top;
    if (sd < end) sd = end;
    this.sDraw = sd;
    // (Both held to (-pi, pi] in line, as the steps' own: each is less than a whole turn out of it.)
    let pd = this.phi + this.turnV * rem;
    if (pd > Math.PI) pd -= 2 * Math.PI;
    else if (pd <= -Math.PI) pd += 2 * Math.PI;
    this.phiDraw = pd;
    let hd = pd + Math.PI;
    if (hd > Math.PI) hd -= 2 * Math.PI;
    else if (hd <= -Math.PI) hd += 2 * Math.PI;
    this.heading = hd;
    body.vel.x = 0;
    body.vel.y = 0;
    body.vel.z = 0;
    this.place(body);
    this.apexY = body.pos.y;
    // Maker B: a slide at the bottom lets go (onto the ground under the body, or off the pole's foot); the feet in the water let go
    // into the swim; W at the top climbs onto a lip in reach (asked once while it is held there).
    if (sliding && this.stop === 'bottom') {
      this.letGo(body);
      this.end = 'slid';
      return;
    }
    if (body.pos.y < this.swimLine) {
      this.letGo(body);
      this.end = 'swim';
      return;
    }
    if (!fwdHeld || this.stop !== 'top') this.topAsked = false;
    else if (!this.topAsked && this.phase === POLE_ON && T.poleTop === 'climb' && this.catcher) {
      this.topAsked = true;
      this.climbTop(body);
    }
  }

  /** Let go, straight down (the plain let-go): nothing held, the drawn offset eased out, the pole not grabbed again at once. */
  letGo(body: LedgeBody): void {
    // (Maker B: in a jump's flight, the console's let-go hands the movement the flight as it is.)
    if (this.phase === POLE_FLY) {
      this.endFlight(body, 'long');
      return;
    }
    body.vel.x = 0;
    body.vel.y = 0;
    body.vel.z = 0;
    this.regrabCol = this.pole.col;
    this.regrabT = CLIMB_TUNE.regrab;
    this.phase = POLE_NONE;
    this.ended = true;
    this.outDur = CLIMB_TUNE.ease;
    this.outT = this.outDur;
    this.loopT = Number.NaN;
    this.climbV = 0;
    this.turnV = 0;
    this.sliding = false;
    this.end = 'let go';
  }

  // ---- maker B: off the pole -------------------------------------------------------------------------------------------------

  /**
   * Space with the hands on the pole (`climb.poleJump` 'fly'): the flight begun from where the body hangs, along the view across the
   * ground (`li.viewYaw`; with none, away from the pole) at `climb.polePush`, rising `climb.poleJumpUp` under the flight's own
   * gravity (the bars', `climb.swingGravity`); the figure's placement eased from the pole's over `climb.ease`, its heading turned
   * to the flight's way, the pole let go of (the rig's falling loop, the clip's preference taken off). The body only pushes off the
   * pole: a view toward the pole (as the chase view behind the body most often is) would carry it through the pole it holds, which
   * the flight's sweep leaves out, so the way's share toward the pole is turned away from it (the way mirrored across the plane
   * through the axis square to the body's side: unchanged for a view square to that side or away from the pole, and straight off
   * the pole for a view straight at it, with nothing sudden between).
   */
  private jumpOff(body: LedgeBody, li: LedgeIn): void {
    const T = CLIMB_TUNE;
    const v = li.viewYaw;
    // (The body's side of the pole, away from it: where its middle stands off the axis.)
    const ax = Math.sin(this.phi);
    const az = Math.cos(this.phi);
    let wx = ax;
    let wz = az;
    if (v === v) {
      wx = Math.sin(v);
      wz = Math.cos(v);
      const d = wx * ax + wz * az;
      if (d < 0) {
        wx -= 2 * d * ax;
        wz -= 2 * d * az;
      }
    }
    const up = T.poleJumpUp > 0 ? Math.sqrt(2 * T.swingGravity * T.poleJumpUp) : 0;
    this.vx = wx * T.polePush;
    this.vy = up;
    this.vz = wz * T.polePush;
    this.phase = POLE_FLY;
    this.flyT = 0;
    this.flyTop = body.pos.y;
    this.flyHand = false;
    this.flyCol = this.pole.col;
    this.end = '';
    this.flights++;
    this.fromOffX = this.offX;
    this.fromOffY = this.offY;
    this.fromOffZ = this.offZ;
    this.leadX = 0;
    this.leadY = 0;
    this.leadZ = 0;
    this.outDur = T.ease;
    this.outT = this.outDur;
    this.headTo = T.polePush > FLY_LEVEL ? Math.atan2(wx, wz) : this.heading;
    this.ended = true;
    this.loopT = Number.NaN;
    this.climbV = 0;
    this.turnV = 0;
    this.sliding = false;
    this.topAsked = false;
    body.vel.x = this.vx;
    body.vel.y = this.vy;
    body.vel.z = this.vz;
  }

  /**
   * One of the physics' steps of the jump's flight: the body's standing capsule swept along the step's parabola (the engine's shape
   * cast, the step's way as its velocity over one unit of time, the pole jumped off left out). Meeting anything still, the body
   * stands where it met it and whatever is in reach there is caught, else the flight ends (ground under the feet a landing, else a
   * wall); clear, the body moves on and whatever is in reach is caught; in the water the flight ends; falling past a grab, or held
   * too long, it is handed to the movement at the frame's end. The bars' own flight's step.
   */
  private flyStep(world: PoleWorld, body: LedgeBody, li: LedgeIn): void {
    const g = CLIMB_TUNE.swingGravity;
    const h = POLE_STEP;
    const dx = this.vx * h;
    const dy = this.vy * h - 0.5 * g * h * h;
    const dz = this.vz * h;
    let cap = this.flyCap;
    if (!cap) cap = this.flyCap = this.makers.capsule(LEDGE_CAPSULE.stand, LEDGE_CAPSULE.r);
    const at = this.at;
    at.x = body.pos.x;
    at.y = body.pos.y + POLE_MID;
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
      if (this.catchOn(world, body, li)) return;
      this.endFlight(body, hit.normal1.y >= FLY_GROUND ? 'land' : 'wall');
      return;
    }
    body.pos.x += dx;
    body.pos.y += dy;
    body.pos.z += dz;
    this.vy -= g * h;
    this.flyT += h;
    if (body.pos.y > this.flyTop) this.flyTop = body.pos.y;
    if (this.catchOn(world, body, li)) return;
    if (body.pos.y < this.swimLine) {
      this.endFlight(body, 'water');
      return;
    }
    if (this.vy < -CLIMB_TUNE.grabFall) {
      this.flyHand = true;
      this.end = 'fall';
    } else if (this.flyT > FLY_MOST) {
      this.flyHand = true;
      this.end = 'long';
    }
  }

  /**
   * In the flight, not falling past a grab: another pole in reach with room on it taken as a grab takes one (`take`: its carry, its
   * steps after this one the climb's); else the caller's bar or lip in reach (`catcher`, looking along the flight's way, the body's
   * velocity the flight's), the body handed on to it. True where something took it.
   */
  private catchOn(world: PoleWorld, body: LedgeBody, li: LedgeIn): boolean {
    if (this.vy < -CLIMB_TUNE.grabFall) return false;
    this.qdt = POLE_STEP;
    this.qvy = this.vy;
    if (this.search(world, body.pos, li) && this.roomFor(world, body, li)) {
      this.catches++;
      this.end = 'caught';
      this.take(body);
      // (Inside the frame's step: the grab's start is this frame's alone.)
      this.fresh = false;
      return true;
    }
    const C = this.catcher;
    if (!C) return false;
    const hl = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (hl > FLY_LEVEL) {
      this.wayX = this.vx / hl;
      this.wayZ = this.vz / hl;
    } else {
      this.wayX = Math.sin(this.heading);
      this.wayZ = Math.cos(this.heading);
    }
    body.vel.x = this.vx;
    body.vel.y = this.vy;
    body.vel.z = this.vz;
    if (C.bar()) {
      this.barCatches++;
      this.handOff(HAND_BAR, 'bar', this.steps - this.stepK - 1);
      return true;
    }
    if (C.lip()) {
      this.lipCatches++;
      this.handOff(HAND_LIP, 'lip', 0);
      return true;
    }
    return false;
  }

  /**
   * W held at the pole's top (`climb.poleTop` 'climb'): a lip in reach climbed onto by the caller's ledges (`catcher.top`), looked for
   * behind the body first (away from the pole: a pole beside a wall or up through a floor's hole has room behind), then ahead, then
   * its left and its right. The body handed on where one took it.
   */
  private climbTop(body: LedgeBody): void {
    const C = this.catcher;
    if (!C) return;
    const bx = Math.sin(this.phi);
    const bz = Math.cos(this.phi);
    body.vel.x = 0;
    body.vel.y = 0;
    body.vel.z = 0;
    for (let k = 0; k < 4; k++) {
      // Behind, ahead, the body's left (its heading's +x: the way opposite phi turned a quarter), its right.
      this.wayX = k === 0 ? bx : k === 1 ? -bx : k === 2 ? -bz : bz;
      this.wayZ = k === 0 ? bz : k === 1 ? -bz : k === 2 ? bx : -bx;
      if (C.top()) {
        this.tops++;
        this.handOff(HAND_TOP, 'top', 0);
        return;
      }
    }
  }

  /** The body handed on to a bar or a lip (`kind`) this frame: nothing held or drawn off the body here, the pole not grabbed again at once. */
  private handOff(kind: number, why: PoleEnd, left: number): void {
    this.regrabCol = this.phase === POLE_FLY ? this.flyCol : this.pole.col;
    this.regrabT = CLIMB_TUNE.regrab;
    this.handed = kind;
    this.stepsLeft = left > 0 ? left : 0;
    this.end = why;
    this.phase = POLE_NONE;
    this.flyHand = false;
    this.ended = true;
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.outT = 0;
    this.loopT = Number.NaN;
    this.climbV = 0;
    this.turnV = 0;
    this.sliding = false;
  }

  /**
   * The flight ended (`why`): the body handed to the movement with the flight's velocity, its drawn offset eased onto it, the pole
   * jumped off not grabbed again at once; the rig is the movement's (the falling loop the jump began, a landing the movement's own).
   */
  private endFlight(body: LedgeBody, why: PoleEnd): void {
    body.vel.x = this.vx;
    body.vel.y = this.vy;
    body.vel.z = this.vz;
    this.end = why;
    if (why === 'land') this.landings++;
    this.phase = POLE_NONE;
    this.flyHand = false;
    this.ended = true;
    this.outDur = CLIMB_TUNE.ease;
    this.outT = this.outDur;
    this.regrabT = CLIMB_TUNE.regrab;
    this.regrabCol = this.flyCol;
    this.loopT = Number.NaN;
  }

  /**
   * A frame of the flight past its steps: the figure led to the frame's own time along the parabola (the body stands where the steps
   * left it), the let-go's offset eased out, the heading turned toward the flight's way over `climb.ease`, the body's velocity the
   * flight's (what the caller's fall and the next frame's movement read). The frame's own step is `dtNow` (never the frame record's:
   * a catcher asked on the steps may have written it a physics step's time), so the turn and the ease run alike at every rate.
   */
  private flyFrame(body: LedgeBody): void {
    const h = POLE_STEP;
    const n = this.steps;
    const g = CLIMB_TUNE.swingGravity;
    const dt = this.dtNow;
    const rem = n >= 4 ? 0 : Math.min(h, Math.max(0, this.behind + dt - n * h));
    this.leadX = this.vx * rem;
    this.leadY = this.vy * rem - 0.5 * g * rem * rem;
    this.leadZ = this.vz * rem;
    this.outT = this.outT > dt ? this.outT - dt : 0;
    const e = CLIMB_TUNE.ease;
    const a = e > 0 ? 1 - Math.exp(-dt / e) : 1;
    let d = this.headTo - this.heading;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d <= -Math.PI) d += 2 * Math.PI;
    let hd = this.heading + d * a;
    if (hd > Math.PI) hd -= 2 * Math.PI;
    else if (hd <= -Math.PI) hd += 2 * Math.PI;
    this.heading = hd;
    this.apexY = this.flyTop;
    body.vel.x = this.vx;
    body.vel.y = this.vy;
    body.vel.z = this.vz;
  }

  /** Every frame of the movement: off the pole the drawn offset eased out after a let-go and the let-go's one frame put down. */
  tick(dt: number): void {
    this.dtNow = dt;
    this.startClip = false;
    if (this.holding) return;
    this.ended = false;
    if (this.regrabT > 0) this.regrabT = Math.max(0, this.regrabT - dt);
    if (!this.offset) return;
    if (this.outT <= 0 || this.outDur <= 0) {
      this.offX = 0;
      this.offY = 0;
      this.offZ = 0;
      return;
    }
    const was = this.outT;
    this.outT = Math.max(0, this.outT - dt);
    const k = this.outT / was;
    this.offX *= k;
    this.offY *= k;
    this.offZ *= k;
  }

  /**
   * Where the figure is drawn this frame (after `step`, with the rig's own table of the clip and the rig's scale `k`): the clip at
   * its share of a round by the way climbed, drawn with its mean grip on the pole's axis at the height the hands are drawn at (so
   * the body rises steadily with the climb while the hands ride up and down as the clip has them reach and pull), facing the pole;
   * the grab's carry from the body. No table: drawn on the body, nothing held.
   */
  placeFigure(T: RopeTable | null, k: number, pos: { x: number; y: number; z: number }): void {
    if (!this.holding) return;
    // Maker B: in the jump's flight, the figure on the body led to the frame's own time, the let-go's offset eased out.
    if (this.phase === POLE_FLY) {
      const w = ease(this.outDur > 0 ? this.outT / this.outDur : 0);
      this.offX = this.fromOffX * w + this.leadX;
      this.offY = this.fromOffY * w + this.leadY;
      this.offZ = this.fromOffZ * w + this.leadZ;
      this.loopT = Number.NaN;
      return;
    }
    if (!T) {
      this.offX = 0;
      this.offY = 0;
      this.offZ = 0;
      this.loopT = Number.NaN;
      return;
    }
    const P = this.pose;
    const round = T.rise * k;
    let u = round > 1e-6 ? this.climbed / round : 0;
    u -= Math.floor(u);
    this.loopT = u * T.duration;
    // (The clip's mean grip, every sample's own motion about it kept: the hands' own reach and pull are the solve's to keep on the pole.)
    const M = T.meanPose;
    P.gx = M.gx;
    P.gy = M.gy;
    P.gz = M.gz;
    const lx = k * P.gx;
    const ly = k * P.gy;
    const lz = k * P.gz;
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    const A = this.pole;
    const gx = A.ax + A.ux * this.sDraw;
    const gy = A.ay + A.uy * this.sDraw;
    const gz = A.az + A.uz * this.sDraw;
    let ox = gx - pos.x - (lx * ch + lz * sh);
    let oy = gy - pos.y - ly;
    let oz = gz - pos.z - (-lx * sh + lz * ch);
    // The grab's carry: the figure eased onto the pole from the body.
    if (this.phase === POLE_GRAB) {
      const w = ease(this.grabDur > 0 ? Math.min(1, this.reachT / this.grabDur) : 1);
      ox *= w;
      oy *= w;
      oz *= w;
    }
    this.offX = ox;
    this.offY = oy;
    this.offZ = oz;
  }

  /**
   * The hands and feet on the pole while the hands hold it: each hand's grip put on the axis at the height the posed hand has it
   * (held to the pole's ends), and each foot's ball on the pole's own side of it at its own height (`climb.poleFootSide` out from
   * its surface, the feet pinching it), wholly once the grab's carry is done (eased in over it), through the ledges' own limb solve
   * (src/player/limbPlace.ts); nothing otherwise. The figure posed and placed, its world matrices fresh (`toPhys` the physics
   * frame, null the world's).
   */
  limbsFor(lp: LimbPlace, rig: LimbRig, toPhys: THREE.Matrix4 | null): void {
    const on = this.onPole;
    const A = this.pole;
    const w = !on ? 0 : this.phase === POLE_ON ? 1 : ease(this.grabDur > 0 ? Math.min(1, this.reachT / this.grabDur) : 1);
    // The figure's own left across the ground (its root turned by the heading: local +x).
    const lx = Math.cos(this.heading);
    const lz = -Math.sin(this.heading);
    const side = A.thick / 2 + CLIMB_TUNE.poleFootSide * this.k;
    for (let s = 0; s < 2; s++) {
      const g = w > 0 ? lp.gripNow(rig, s, toPhys, this.grip) : null;
      if (!g) lp.handW[s] = 0;
      else {
        let a = A.uy > 1e-6 ? (g.y - A.ay) / A.uy : 0;
        if (a < 0) a = 0;
        if (a > A.len) a = A.len;
        lp.hand[s * 3] = A.ax + A.ux * a;
        lp.hand[s * 3 + 1] = A.ay + A.uy * a;
        lp.hand[s * 3 + 2] = A.az + A.uz * a;
        lp.handW[s] = w;
      }
      const f = w > 0 ? lp.ballNow(rig, s, toPhys, this.grip) : null;
      if (!f) lp.footTW[s] = 0;
      else {
        let a = A.uy > 1e-6 ? (f.y - A.ay) / A.uy : 0;
        if (a < 0) a = 0;
        if (a > A.len) a = A.len;
        // (The left foot, side 0, on the pole's left; the right on its right.)
        const sd = s === 0 ? side : -side;
        lp.foot[s * 3] = A.ax + A.ux * a + lx * sd;
        lp.foot[s * 3 + 1] = A.ay + A.uy * a;
        lp.foot[s * 3 + 2] = A.az + A.uz * a + lz * sd;
        lp.footTW[s] = w;
      }
    }
    lp.palmW[0] = 0;
    lp.palmW[1] = 0;
    lp.wallW = 0;
    lp.footFade = false;
  }

  /** The console's report (`__debug.climb()`'s `pole`): the phase, the pole, where the hands are and the clip's time. */
  report(): Record<string, unknown> {
    const deg = 180 / Math.PI;
    const A = this.pole;
    return {
      on: CLIMB_TUNE.poles,
      phase: this.phase === POLE_NONE ? 'none' : this.phase === POLE_GRAB ? 'grab' : this.phase === POLE_FLY ? 'fly' : this.sliding ? 'slide' : 'on',
      // Maker B: off the pole (the switches, the flight, why the last flight or let-go ended, and the counts).
      jump: CLIMB_TUNE.poleJump,
      crouch: CLIMB_TUNE.poleCrouch,
      top: CLIMB_TUNE.poleTop,
      fly: this.phase === POLE_FLY ? { v: [+this.vx.toFixed(2), +this.vy.toFixed(2), +this.vz.toFixed(2)], t: +this.flyT.toFixed(3), top: +this.flyTop.toFixed(3) } : null,
      end: this.end,
      flights: this.flights,
      catches: { pole: this.catches, bar: this.barCatches, lip: this.lipCatches },
      landings: this.landings,
      slides: this.slides,
      tops: this.tops,
      pole: this.holding ? { foot: [+A.ax.toFixed(2), +A.ay.toFixed(2), +A.az.toFixed(2)], length: +A.len.toFixed(2), thick: +A.thick.toFixed(3) } : null,
      along: +this.s.toFixed(3),
      round: +(this.phi * deg).toFixed(1),
      heading: +(this.heading * deg).toFixed(1),
      climbed: +this.climbed.toFixed(3),
      turned: +(this.turned * deg).toFixed(1),
      stop: this.stop,
      loopT: this.loopT === this.loopT ? +this.loopT.toFixed(3) : null,
      camera: this.cameraCollider() !== null ? 'passes the pole' : 'blocked by it',
      grabs: this.grabs,
      frames: this.frames,
      casts: this.casts,
    };
  }
}
