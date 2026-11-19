// The rope chain round (the owner's ask of 2026-11-18: "the rope in our climbing pass right now is quite lackluster and is just
// a straight pipe on a pendulum with no physics or bend"), items 1 and 2, under `climb.ropeLook` 'chain'.
//
// Each rope's drawn shape is a chain of points (`climb.ropePoints`) stepped on the physics' own steps (the caller hands it the
// steps the frame's physics step takes, `Physics.stepsAhead`, as the climb steps), each step cut into `climb.ropeSubsteps` and
// solved by position-based dynamics (Verlet, then the links, a gentle bend and the pins projected `CHAIN_ITERS` times):
//  - pinned at its anchor; each link held to the rope's drawn length over the count (its length and the stretch the rope's give
//    puts in it, `HangingRope.len + e`, as phase 4 drew it); a gentle bend (`climb.ropeBend`: two links folding are pushed apart
//    by that share); gravity (`climb.swingGravity`, the rope's own swing's); a damping (`climb.ropeChainDamp`); and the wind as a
//    drag toward its velocity (`climb.ropeWind`: the very wind the trees and the rain take, which the caller writes into `wind`);
//  - never under the ground nor in what stands still: each point held over the terrain's cached height (`ground`, never a read
//    that makes a block) and, where something still is near (one box round the whole chain asked once a frame, its top held under
//    the anchor so what the rope hangs from never counts), stopped where a short ray from where it began the step to where it
//    ended meets something; a point so held lies (its speed across taken down, none into the surface), so a tail lying on the
//    ground lies.
//  - With a body on it (item 2): the gameplay's grip (the hands `gripS` and the stretch down the swing's line, phase 4's) is a
//    pin moving along the chain at its own place, so the span above the hands is the pendulum's length (it may ripple as a swing
//    reverses or the climb jerks it, but its ends are the anchor and the hands) and the tail below swings after the body with its
//    own inertia, trails the swing, settles when the body is still and whips a little at a let-go (the pin let go, the points keep
//    the speed it gave them). Climbing moves the pin along the chain. Each step the swing took is pinned on that very step
//    (src/player/ropeSwing.ts records the swing before the frame's steps and after each in `HangingRope.swingRec`): from the
//    swing's grip before it to its grip after it (the angle by the cubic through the two angles and speeds), so the chain is the
//    same to the bit whichever frame rate grouped the steps into frames; a grab's pin begins, and a let-go's ends, only between
//    steps (the fixer: the first cut pinned each step on a curve through the frame's two ends, and with a grab noticed between
//    steps, at 30 and 240 frames a second one swing's chains parted by up to 1.3 m).
//  - Laid for drawing at the frame's own time (`lay`): each point between where the last two steps left it, by how far the frame
//    stands past the last step (`behind`, taken only on a frame whose update ran, so a frame drawn with play stood still lays the
//    very points the last did), and on a held rope the drawn hands (the caller's rig's, each hand's grip;
//    with none, the grip on the rope's line for both) put into the line as points of their own, the span above eased onto the
//    upper hand from the anchor and the tail carried with the lower, so the drawn rope meets both hands every frame.
// Nothing of it feeds back into the body or the gameplay's rope (the grab still finds the rope where phase 4's swing has it):
// every older digest holds under both settings. Under 'straight' nothing here runs and the rope is drawn as phase 4 drew it.
//
// Pure: no three.js and no engine of its own (the world, its ray and its box are handed in, made once by the caller), so node
// runs it. Nothing made a frame: kept arrays and fields only (the engine's own answers, a query's, are the only things made).

import type { RAPIER } from '../core/physics.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { SWING_REC, SWING_STEPS_MOST, type HangingRope } from './hangingRope.ts';

/** The most points a chain keeps (the `ropePoints` slider's top): the arrays are made this long once. */
export const CHAIN_MOST = 64;
/** The fewest (the slider's bottom). */
export const CHAIN_LEAST = 4;
/** The physics' own step (`FIXED_DT`; climbRopeChain.test.ts holds the two equal). */
export const CHAIN_STEP = 1 / 60;
/** The points' radius against what they lie on, metres (a mechanic: the course's rope's own, 0.02). */
export const CHAIN_RADIUS = 0.02;
/** The constraints are projected this many times a substep (a mechanic: two sweeps, one each way, so neither end lags the other). */
export const CHAIN_ITERS = 2;
/** The engine's query flags for what stands still (src/player/stairSense.ts's `STILL_FLAGS`: no sensor, nothing kinematic or dynamic). */
export const CHAIN_FLAGS = 8 | 2 | 4;
/** The near box's pad past the chain and its frame's travel, metres (a mechanic: a hand's width, so a point never meets what the box missed). */
const NEAR_PAD = 0.3;
/** And its top held this far under the anchor (a mechanic: what the rope hangs from is never something it is pushed out of). */
const NEAR_TOP = 0.02;
/** A point put back off a surface stands this much past its radius (a mechanic: clear of the engine's own tolerance about a touch). */
const SKIN = 0.003;
/** A hand put into the drawn line drops the chain's own points within this share of a link of it (a mechanic: no two points nearly one). */
const HAND_GAP = 0.15;
/** Two hands nearer than this along the rope are drawn as one point (a mechanic: a millimetre). */
const HAND_ONE = 0.001;
/**
 * The share of its give a rope nobody holds keeps a step (src/player/hangingRope.ts's `stepFree`: `this.e *= 0.9`, which
 * climbRopeChain.test.ts holds equal): the chain lets its own give back by it on each step no swing records, on the physics' own
 * steps, so its length after a let-go is the same at every frame rate (the rope's own `e` is let back on a clock of its own).
 */
export const ROPE_FREE_GIVE = 0.9;
/** What a step of the chain is pinned by: nothing, the swing's own step (the body's), the body's pin held where it stands, another player's hands. */
const STEP_FREE = 0;
const STEP_SWING = 1;
const STEP_HOLD = 2;
const STEP_PEER = 3;

/** The little of a physics world the chain asks (rapier's `World`). */
export interface ChainWorld {
  intersectionWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): RAPIER.Collider | null;
  castRayAndGetNormal(ray: RAPIER.Ray, maxToi: number, solid: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): { timeOfImpact: number; normal: { x: number; y: number; z: number } } | null;
}

/** A kept ask of the ground: the place in, the height out. */
export class ChainAsk {
  x = 0.5;
  z = 0.5;
  h = 0.5;
}

/** The ground the chain lies on, from cached heights only (never a read that makes a block): `h` written, false where none is known. */
export interface ChainGround {
  at(q: ChainAsk): boolean;
}

/** The wind the chain is dragged by: its way across the ground (unit) and its speed, m/s (the caller's: the trees' and the rain's). */
export class ChainWind {
  x = 0.5;
  z = 0.5;
  speed = 0.5;
  constructor() {
    this.x = 0;
    this.z = 1;
    this.speed = 0;
  }
}

/** A kept turn of nought (the near box stands level). */
const ROT0 = { x: 0, y: 0, z: 0, w: 1 };

/** Who pins a chain: nobody (it hangs free), the body (the player holding the rope), another player (item 4, maker B). */
export const PIN_NONE = 0;
export const PIN_BODY = 1;
export const PIN_PEER = 2;
/** Item 4 (maker B): the most other players hanging on ropes a frame bends ropes to (a mechanic: eight, a group's worth). */
export const PEER_HANGS = 8;
/** Item 4: a rope here is the one another player hangs on when its anchor stands within this of the anchor their state sends, metres (a mechanic: five times the wire's centimetre, `n2`). */
export const PEER_ANCHOR_NEAR = 0.05;

/**
 * Item 4 (maker B): the other players hanging on a rope this frame, as the wire already says it (a hanging rope's mark,
 * src/net/peerRope.ts's `hung`: the anchor it hangs from) and as their figures are drawn here (each one's two hands, read off their
 * rig posed this frame), written by the game before the chains' frame (src/net/remoteRopes.ts's `hungInto`); the frame takes a rope
 * of its own whose anchor is theirs (`taken`), and their game's straight line to the anchor (remoteRopes' ribbon) is then not drawn.
 * Nothing is sent: what bends a rope here is what their state already carried. Kept arrays; made once.
 */
export class PeerHangs {
  count = 0;
  /** Written this frame (the chains' frame takes it once and puts it back). */
  filled = false;
  readonly id = new Int32Array(PEER_HANGS);
  readonly anchor = new Float64Array(3 * PEER_HANGS);
  /** Each one's two hands (the left's grip, then the right's: wrist and index knuckle's middle each), six numbers. */
  readonly hand = new Float64Array(6 * PEER_HANGS);
  /** Taken by a rope here and drawn bent to their hands this frame. */
  readonly taken = new Uint8Array(PEER_HANGS);

  /** Emptied for the frame's writing. */
  clear(): void {
    for (let i = 0; i < this.count; i++) this.taken[i] = 0;
    this.count = 0;
    this.filled = false;
  }

  /** Whether the player with relay id `id` hangs on a rope here drawn bent to their hands this frame (their own straight line then hidden). */
  drawnFor(id: number): boolean {
    for (let i = 0; i < this.count; i++) if (this.id[i] === id) return this.taken[i] === 1;
    return false;
  }
}

/** One rope's chain: its points, their last positions (the Verlet speed), and what is laid for drawing. */
export class RopeChain {
  /** The points now (the step's state), and their positions a substep before (the Verlet speed). */
  readonly px = new Float64Array(CHAIN_MOST);
  readonly py = new Float64Array(CHAIN_MOST);
  readonly pz = new Float64Array(CHAIN_MOST);
  readonly qx = new Float64Array(CHAIN_MOST);
  readonly qy = new Float64Array(CHAIN_MOST);
  readonly qz = new Float64Array(CHAIN_MOST);
  /** Where each point began the step (its ray's start). */
  private readonly sx = new Float64Array(CHAIN_MOST);
  private readonly sy = new Float64Array(CHAIN_MOST);
  private readonly sz = new Float64Array(CHAIN_MOST);
  /** The ground's height under each point this step (NaN: none known), and each point's touch this step and its surface's normal. */
  private readonly hg = new Float64Array(CHAIN_MOST);
  readonly touch = new Uint8Array(CHAIN_MOST);
  /** Each point's touch at the last step's end: such a point's contact is held every substep (substep), not only at the step's end. */
  private readonly lie = new Uint8Array(CHAIN_MOST);
  readonly nx = new Float64Array(CHAIN_MOST);
  readonly ny = new Float64Array(CHAIN_MOST);
  readonly nz = new Float64Array(CHAIN_MOST);
  /** How many points (`ropePoints` at the last lay of it), and whether it has been laid at all (else the next step lays it on the rope's line). */
  n = 0;
  live = false;
  /** The drawn length now (the rope's length and its stretch), metres, as the last step left it. */
  len = 0.5;
  /** The pin (the gameplay's grip while a body holds the rope): on, its place along the chain from the anchor (metres), and where it stood at the last step. */
  pinOn = false;
  /** The pin begins on the step being solved, from where the chain stood (a fresh grab), and has not reached the swing's grip yet. */
  pinFresh = false;
  /** What pins the step being solved (`STEP_FREE`, `STEP_SWING`, `STEP_HOLD`, `STEP_PEER`). */
  private stepPin = 0;
  /** This frame's record of the swing's steps (`HangingRope.swingSteps` as read: -1 none) and how many of the chain's steps it pins (the frame's last). */
  private recTop = 0;
  private recM = 0;
  /** The chain's own give (the stretch a body put in the rope): the swing's step by step while it records, let back by `ROPE_FREE_GIVE` a step otherwise. */
  give = 0.5;
  /** Who pins it (`PIN_NONE`, `PIN_BODY`, `PIN_PEER`); a change of who is a fresh grab. */
  pinWho = PIN_NONE;
  /** Item 4: this frame's other player on it (their index in the chains' `peers`), -1 none; their hands' middle and its place along the chain. */
  peerIx = -1;
  private peerS = 0.5;
  private peerX = 0.5;
  private peerY = 0.5;
  private peerZ = 0.5;
  pinS = 0.5;
  pinX = 0.5;
  pinY = 0.5;
  pinZ = 0.5;
  /** The swing as the last frame left it (its angle and speed, its plane) and as this frame's swing ended it: the pin's way over the frame's steps. */
  private pinTh = 0.5;
  private pinOm = 0.5;
  private pinFx = 0.5;
  private pinFz = 0.5;
  private toS = 0.5;
  private toX = 0.5;
  private toY = 0.5;
  private toZ = 0.5;
  private toTh = 0.5;
  private toOm = 0.5;
  private toFx = 0.5;
  private toFz = 0.5;
  /** The frame's step being solved, of how many (the pin's share along the frame's line). */
  private k = 0;
  /**
   * Numbers the private steps read rather than are handed (a number handed across a call the compiler does not build in is made
   * anew each call): the pin's share of the frame's way and the swing's, the substep's time, a link's length and the bend's share,
   * and a place along the chain asked of the drawn line.
   */
  private w = 0.5;
  private sw = 0.5;
  private hs = 0.5;
  private l = 0.5;
  private bendK = 0.5;
  private atS = 0.5;
  /** The share of a lying point's slide across what it lies on kept a substep (`climb.ropeGrip` over the substep's time). */
  private lieK = 0.5;
  /** Whether the terrain's height counts for this rope this frame (not where the anchor stands under it: a rope in a room under the ground). */
  private terrainOn = true;
  /** Whether something still is near this frame (the near box's answer), so the points' rays are cast. */
  near = false;
  /** Counts for the console and the tests: steps taken, near boxes asked and met, rays cast and met, points held on the ground. */
  steps = 0;
  boxes = 0;
  nears = 0;
  rays = 0;
  hits = 0;
  grounds = 0;
  /** And the steps pinned on the swing's own (the fixer: the console's and the tests' word that the swing's record is read). */
  swung = 0;

  /** Laid for drawing (`lay`): the points (three numbers each) and how many, each one's surface normal (nought where it touches none), and the hands' places in the list (-1 none). */
  readonly draw = new Float64Array(3 * (CHAIN_MOST + 2));
  readonly drawN = new Float64Array(3 * (CHAIN_MOST + 2));
  drawCount = 0;
  gripA = -1;
  gripB = -1;
  /** The drawn hands (each hand's grip as drawn: the rig's, or the grip on the line) and their places along the rope, metres. */
  readonly handA = new Float64Array(3);
  readonly handB = new Float64Array(3);
  handSA = 0.5;
  handSB = 0.5;
  /** Whether the last lay of a held rope took the caller's drawn hands (the rig's), else the grip on the rope's line for both. */
  handsRig = false;

  constructor() {
    this.len = 0;
    this.pinS = 0;
    this.pinX = 0;
    this.pinY = 0;
    this.pinZ = 0;
    this.toS = 0;
    this.toX = 0;
    this.toY = 0;
    this.toZ = 0;
    this.pinTh = 0;
    this.pinOm = 0;
    this.pinFx = 0;
    this.pinFz = 1;
    this.toTh = 0;
    this.toOm = 0;
    this.toFx = 0;
    this.toFz = 1;
    this.handSA = 0;
    this.handSB = 0;
    this.w = 0;
    this.sw = 0;
    this.hs = 0;
    this.l = 0;
    this.bendK = 0;
    this.atS = 0;
    this.lieK = 0;
    this.peerS = 0;
    this.peerX = 0;
    this.peerY = 0;
    this.peerZ = 0;
    this.give = 0;
  }

  /** The chain's points laid along the rope's line now (phase 4's straight lay: its angle, its plane), moving as the swing moves it. */
  layOn(r: HangingRope, n: number): void {
    const s = Math.sin(r.th);
    const c = Math.cos(r.th);
    const ux = s * r.fx;
    const uy = -c;
    const uz = s * r.fz;
    // The swing's own speed across the line at each point (its angular speed times the reach), a substep back.
    const hs = CHAIN_STEP / Math.max(1, Math.round(CLIMB_TUNE.ropeSubsteps));
    const wx = c * r.fx;
    const wy = s;
    const wz = c * r.fz;
    const L = r.len + r.e;
    this.n = n;
    for (let i = 0; i < n; i++) {
      const d = (L * i) / (n - 1);
      const x = r.ax + ux * d;
      const y = r.ay + uy * d;
      const z = r.az + uz * d;
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      const v = r.om * d * hs;
      this.qx[i] = x - wx * v;
      this.qy[i] = y - wy * v;
      this.qz[i] = z - wz * v;
      this.sx[i] = x;
      this.sy[i] = y;
      this.sz[i] = z;
      this.touch[i] = 0;
    }
    this.len = L;
    this.give = r.e;
    this.pinOn = false;
    this.pinFresh = false;
    this.pinWho = PIN_NONE;
    this.live = true;
  }

  /** Laid again at `n` points along its own line as it stands (the slider moved: an event), standing still. */
  resample(n: number): void {
    const m = this.n;
    const L = this.len;
    const P = SCRATCH;
    // Each new point at its share of the old line's own length (the old points' links, walked).
    let at = 0;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const want = (L * i) / (n - 1);
      while (at < m - 2) {
        const dx = this.px[at + 1] - this.px[at];
        const dy = this.py[at + 1] - this.py[at];
        const dz = this.pz[at + 1] - this.pz[at];
        const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (acc + seg >= want) break;
        acc += seg;
        at++;
      }
      const dx = this.px[at + 1] - this.px[at];
      const dy = this.py[at + 1] - this.py[at];
      const dz = this.pz[at + 1] - this.pz[at];
      const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let f = seg > 1e-9 ? (want - acc) / seg : 0;
      if (f < 0) f = 0;
      if (f > 1) f = 1;
      P[3 * i] = this.px[at] + dx * f;
      P[3 * i + 1] = this.py[at] + dy * f;
      P[3 * i + 2] = this.pz[at] + dz * f;
    }
    for (let i = 0; i < n; i++) {
      this.px[i] = this.qx[i] = this.sx[i] = P[3 * i];
      this.py[i] = this.qy[i] = this.sy[i] = P[3 * i + 1];
      this.pz[i] = this.qz[i] = this.sz[i] = P[3 * i + 2];
      this.touch[i] = 0;
    }
    this.n = n;
  }

  /** The chain's point at `s` metres from its anchor (its links in a straight line between their points), into `at` (the console's and the tests'). */
  pointAt(s: number, at: Float64Array): void {
    this.atS = s;
    this.chainAt(at);
  }

  /** `pointAt` at `atS` (a field: no number crosses the call). */
  private chainAt(at: Float64Array): void {
    const s = this.atS;
    const n = this.n;
    const l = this.len / (n - 1);
    let t = l > 1e-9 ? s / l : 0;
    if (t < 0) t = 0;
    if (t > n - 1) t = n - 1;
    let j = Math.floor(t);
    if (j > n - 2) j = n - 2;
    const f = t - j;
    at[0] = this.px[j] + (this.px[j + 1] - this.px[j]) * f;
    at[1] = this.py[j] + (this.py[j + 1] - this.py[j]) * f;
    at[2] = this.pz[j] + (this.pz[j + 1] - this.pz[j]) * f;
  }

  /**
   * The frame: the chain stepped over the frame's physics steps (`C.steps`). While a body holds the rope each step the swing took
   * this frame (its record, `HangingRope.swingRec`, the frame's last steps) is pinned on that very step of the swing's, from where
   * the swing stood before it to where it stood after, so the chain is the same to the bit whichever frame rate grouped the steps;
   * the pin begins (a grab) and ends (a let-go) only between steps. Writes kept arrays and fields only.
   */
  stepFrame(r: HangingRope, C: RopeChains): void {
    const want = pointsWanted();
    if (!this.live) {
      this.layOn(r, want);
      this.layOut(C);
    } else if (want !== this.n) this.resample(want);
    // Where the chain stands at the hands' place, worked out every frame (a grab's own frame then runs code the frames before ran:
    // a step taken only now and then runs unoptimised, and makes every number it works out).
    this.atS = r.gripS + r.e;
    this.chainAt(PIN_AT);
    // The swing's own steps this frame (its record, read once and put back), and how many of the chain's steps they pin: the
    // frame's last (on a grab's frame the movement had the frame's steps and the swing records none).
    let top = r.swingSteps;
    r.swingSteps = -1;
    if (top > SWING_STEPS_MOST) top = SWING_STEPS_MOST;
    const n = C.steps;
    let m = top > 0 ? top : 0;
    if (m > n) m = n;
    this.recTop = top;
    this.recM = m;
    if (r.held || m > 0) {
      // The body. Its pin begins on the first step the swing records (from where the chain stands then), never between steps.
      // (Maker B: a change of who pins it begins it afresh: a rope another player hung on, taken by the body.)
      if (this.pinWho !== PIN_BODY) {
        this.pinOn = false;
        this.pinFresh = false;
        this.pinWho = PIN_BODY;
      }
    } else if (this.peerIx >= 0) this.peerPin(r, C);
    else {
      this.pinOn = false;
      this.pinFresh = false;
      this.pinWho = PIN_NONE;
    }
    if (n <= 0) {
      this.letGoIfFree(r);
      return;
    }
    if (this.pinOn && this.pinWho === PIN_PEER) {
      // Item 4: the other player's hands' middle now, reached straight over the frame's steps.
      this.toS = this.peerS;
      this.toX = this.peerX;
      this.toY = this.peerY;
      this.toZ = this.peerZ;
    }
    // The terrain counts unless the anchor stands under it (a rope in a room below the ground).
    this.terrainOn = true;
    const G = C.ground;
    if (G) {
      const q = C.ask;
      q.x = r.ax;
      q.z = r.az;
      if (G.at(q) && q.h > r.ay) this.terrainOn = false;
    }
    this.nearAsk(r, C);
    const peer = this.pinOn && this.pinWho === PIN_PEER;
    // (The rope's own length read once a frame: a getter asked every step, where the compiler left it out of the loop, handed its
    // number back made anew each step: 14 bytes a frame on the peer's measure, twelve processes at once.)
    const own = r.len;
    for (let k = 1; k <= n; k++) {
      this.k = k;
      const j = k - (n - m);
      if (j >= 1) this.swingStep(r, top - m + j);
      else {
        // A step no swing records: the give let back as a free rope lets its own back, and the pin (where there is one) held where
        // it stands, or another player's hands followed.
        this.give *= ROPE_FREE_GIVE;
        this.stepPin = peer ? STEP_PEER : this.pinOn && this.pinWho === PIN_BODY ? STEP_HOLD : STEP_FREE;
      }
      // The length the step is solved at: the rope's and its give at the step's end (phase 4's lay: the stretch above the hands).
      this.len = own + this.give;
      this.stepOne(r, C, n);
      if (this.stepPin === STEP_SWING) {
        // The pin stands at the swing's grip at the step's end, where the next step begins.
        this.pinFresh = false;
        this.pinS = this.toS;
        this.pinX = this.toX;
        this.pinY = this.toY;
        this.pinZ = this.toZ;
        this.pinTh = this.toTh;
        this.pinOm = this.toOm;
        this.pinFx = this.toFx;
        this.pinFz = this.toFz;
      }
    }
    if (peer) {
      this.pinS = this.toS;
      this.pinX = this.toX;
      this.pinY = this.toY;
      this.pinZ = this.toZ;
    }
    this.letGoIfFree(r);
  }

  /** The body's pin let go once the body no longer holds the rope (after the steps the swing recorded before it let go, if any). */
  private letGoIfFree(r: HangingRope): void {
    if (r.held || this.pinWho !== PIN_BODY) return;
    this.pinOn = false;
    this.pinFresh = false;
    this.pinWho = PIN_NONE;
  }

  /**
   * One of the swing's own steps (`r.swingRec`'s slot `b`, from slot `b - 1`'s): the pin's way over it (the swing's grip from
   * where it stood to where it stood after the step, or on a grab's first step from where the chain stood at the hands' place),
   * and the give it ended with.
   */
  private swingStep(r: HangingRope, b: number): void {
    const R = r.swingRec;
    const o = SWING_REC * b;
    const p = o - SWING_REC;
    const th = R[o];
    const g = R[o + 2] + R[o + 3];
    const s = Math.sin(th);
    this.toS = g;
    this.toTh = th;
    this.toOm = R[o + 1];
    this.toFx = R[o + 4];
    this.toFz = R[o + 5];
    this.toX = r.ax + g * s * this.toFx;
    this.toY = r.ay - g * Math.cos(th);
    this.toZ = r.az + g * s * this.toFz;
    this.give = R[o + 3];
    if (!this.pinOn) {
      // A fresh grab: the pin begins where the chain stands at the hands' place the swing began the step at.
      this.pinOn = true;
      this.pinFresh = true;
      this.atS = R[p + 2] + R[p + 3];
      this.chainAt(PIN_AT);
      this.pinS = this.atS;
      this.pinX = PIN_AT[0];
      this.pinY = PIN_AT[1];
      this.pinZ = PIN_AT[2];
    } else {
      this.pinFresh = false;
      this.pinS = R[p + 2] + R[p + 3];
      this.pinTh = R[p];
      this.pinOm = R[p + 1];
      this.pinFx = R[p + 4];
      this.pinFz = R[p + 5];
    }
    this.stepPin = STEP_SWING;
    this.swung++;
  }

  /**
   * Item 4 (maker B): another player hangs on this rope (`peerIx`, their entry in `C.peers`): the pin at their drawn hands' middle,
   * its place along the chain the straight way from the anchor to it (the span above a hanging body is taut), no further than the
   * rope; a pin newly theirs begins where the chain stands there, as a grab's does, and runs to their hands over the frame's steps.
   */
  private peerPin(r: HangingRope, C: RopeChains): void {
    const H = C.peers.hand;
    const k = 6 * this.peerIx;
    const mx = (H[k] + H[k + 3]) / 2;
    const my = (H[k + 1] + H[k + 4]) / 2;
    const mz = (H[k + 2] + H[k + 5]) / 2;
    const dx = mx - r.ax;
    const dy = my - r.ay;
    const dz = mz - r.az;
    let s = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (s > this.len) s = this.len;
    this.peerS = s;
    this.peerX = mx;
    this.peerY = my;
    this.peerZ = mz;
    if (!this.pinOn || this.pinWho !== PIN_PEER) {
      this.atS = s;
      this.chainAt(PIN_AT);
      this.pinOn = true;
      this.pinFresh = true;
      this.pinWho = PIN_PEER;
      this.pinS = s;
      this.pinX = PIN_AT[0];
      this.pinY = PIN_AT[1];
      this.pinZ = PIN_AT[2];
    }
  }

  /**
   * Whether anything still stands near the chain this frame: one box round its points (past the anchor), grown by the frame's
   * travel and a pad, its top held just under the anchor, asked once.
   */
  private nearAsk(r: HangingRope, C: RopeChains): void {
    this.near = false;
    const W = C.world;
    const box = C.box;
    if (!W || !box || !C.ray) return;
    const n = this.n;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    let most = 0;
    for (let i = 1; i < n; i++) {
      const x = this.px[i];
      const y = this.py[i];
      const z = this.pz[i];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
      const dx = x - this.qx[i];
      const dy = y - this.qy[i];
      const dz = z - this.qz[i];
      const d = dx * dx + dy * dy + dz * dz;
      if (d > most) most = d;
    }
    // The frame's travel: each point's speed (a substep's) over every substep of the frame's steps, twice over, and the pin's own move.
    const sub = Math.max(1, Math.round(CLIMB_TUNE.ropeSubsteps));
    let pad = 2 * Math.sqrt(most) * sub * C.steps + NEAR_PAD + CHAIN_RADIUS;
    const m = this.recM;
    if (m > 0) {
      // The body's pin over the swing's recorded steps: from where it stands (or, a grab's, the chain at the hands' place it begins
      // from) through the swing's grip after each step, the chords' lengths summed.
      const R = r.swingRec;
      const first = this.recTop - m;
      let ax = this.pinX;
      let ay = this.pinY;
      let az = this.pinZ;
      if (!this.pinOn) {
        const o = SWING_REC * first;
        this.atS = R[o + 2] + R[o + 3];
        this.chainAt(SLOT_AT);
        ax = SLOT_AT[0];
        ay = SLOT_AT[1];
        az = SLOT_AT[2];
      }
      for (let b = first + 1; b <= this.recTop; b++) {
        const o = SWING_REC * b;
        const th = R[o];
        const g = R[o + 2] + R[o + 3];
        const s = Math.sin(th);
        const bx = r.ax + g * s * R[o + 4];
        const by = r.ay - g * Math.cos(th);
        const bz = r.az + g * s * R[o + 5];
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        pad += Math.sqrt(dx * dx + dy * dy + dz * dz);
        ax = bx;
        ay = by;
        az = bz;
      }
    } else if (this.pinOn && this.pinWho === PIN_PEER) {
      const dx = this.toX - this.pinX;
      const dy = this.toY - this.pinY;
      const dz = this.toZ - this.pinZ;
      pad += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    x0 -= pad;
    y0 -= pad;
    z0 -= pad;
    x1 += pad;
    y1 += pad;
    z1 += pad;
    const top = r.ay - NEAR_TOP;
    if (y1 > top) y1 = top;
    if (y1 <= y0) return;
    const he = box.halfExtents;
    he.x = (x1 - x0) / 2;
    he.y = (y1 - y0) / 2;
    he.z = (z1 - z0) / 2;
    const at = C.at;
    at.x = (x0 + x1) / 2;
    at.y = (y0 + y1) / 2;
    at.z = (z0 + z1) / 2;
    this.boxes++;
    this.near = W.intersectionWithShape(at, ROT0, box, CHAIN_FLAGS, C.filter) !== null;
    if (this.near) this.nears++;
  }

  /** One of the physics' steps: the ground read, the substeps, and where something is near, each point's ray. */
  private stepOne(r: HangingRope, C: RopeChains, n: number): void {
    const N = this.n;
    this.steps++;
    // Where each point begins the step (its ray's start), the ground under it, and no touch yet.
    const G = this.terrainOn ? C.ground : null;
    const q = C.ask;
    for (let i = 0; i < N; i++) {
      this.sx[i] = this.px[i];
      this.sy[i] = this.py[i];
      this.sz[i] = this.pz[i];
      this.lie[i] = this.touch[i];
      this.touch[i] = 0;
      if (G) {
        q.x = this.px[i];
        q.z = this.pz[i];
        this.hg[i] = G.at(q) ? q.h : Number.NaN;
      } else this.hg[i] = Number.NaN;
    }
    const sub = Math.max(1, Math.round(CLIMB_TUNE.ropeSubsteps));
    const hs = CHAIN_STEP / sub;
    // Each substep's share of the step (the swing's pin's) and of the frame's way (another player's), and the pin's place there.
    const share0 = (this.k - 1) / n;
    const share1 = this.k / n;
    const pinned = this.stepPin !== STEP_FREE;
    for (let u = 1; u <= sub; u++) {
      this.w = share0 + ((share1 - share0) * u) / sub;
      this.sw = u / sub;
      if (pinned) this.pinAt(r);
      this.hs = hs;
      this.substep(r, C);
    }
    if (this.near) {
      this.rayStep(C);
      // (The ground has the last word: a link put off a surface never leaves a point under the ground.)
      this.onGround();
    }
  }

  /**
   * The pin's place on the substep being solved (`PIN_NOW`: its place along the chain, then x, y, z). On the swing's own step
   * (`sw`, the substep's share of it), its angle by the cubic through the swing's angle and speed before the step and after it,
   * its way down and its plane taken straight; a fresh grab's first step from where the chain stood to the swing's place at that
   * step's end, straight; held, where it stands; another player's, from where it stood to their hands now over the frame's way (`w`).
   */
  private pinAt(r: HangingRope): void {
    const mode = this.stepPin;
    if (mode === STEP_PEER) {
      // Item 4 (maker B): another player's hands, from where the pin stood to where they are now, straight over the frame.
      const w = this.w;
      PIN_NOW[0] = this.pinS + (this.toS - this.pinS) * w;
      PIN_NOW[1] = this.pinX + (this.toX - this.pinX) * w;
      PIN_NOW[2] = this.pinY + (this.toY - this.pinY) * w;
      PIN_NOW[3] = this.pinZ + (this.toZ - this.pinZ) * w;
      return;
    }
    if (mode === STEP_HOLD) {
      PIN_NOW[0] = this.pinS;
      PIN_NOW[1] = this.pinX;
      PIN_NOW[2] = this.pinY;
      PIN_NOW[3] = this.pinZ;
      return;
    }
    if (this.pinFresh) {
      // A fresh grab, its first step: from where the chain stood to the swing's place at that step's end.
      const u = this.sw;
      PIN_NOW[0] = this.pinS + (this.toS - this.pinS) * u;
      PIN_NOW[1] = this.pinX + (this.toX - this.pinX) * u;
      PIN_NOW[2] = this.pinY + (this.toY - this.pinY) * u;
      PIN_NOW[3] = this.pinZ + (this.toZ - this.pinZ) * u;
      return;
    }
    this.swingPin(r);
  }

  /** The swing's grip at share `sw` of its step, into `PIN_NOW` (see `pinAt`). */
  private swingPin(r: HangingRope): void {
    const w = this.sw;
    const g = this.pinS + (this.toS - this.pinS) * w;
    PIN_NOW[0] = g;
    const T = CHAIN_STEP;
    const w2 = w * w;
    const w3 = w2 * w;
    const th = (2 * w3 - 3 * w2 + 1) * this.pinTh + (w3 - 2 * w2 + w) * T * this.pinOm + (3 * w2 - 2 * w3) * this.toTh + (w3 - w2) * T * this.toOm;
    let fx = this.pinFx + (this.toFx - this.pinFx) * w;
    let fz = this.pinFz + (this.toFz - this.pinFz) * w;
    const fl = Math.sqrt(fx * fx + fz * fz);
    if (fl > 1e-9) {
      fx /= fl;
      fz /= fl;
    }
    const s = Math.sin(th);
    PIN_NOW[1] = r.ax + g * s * fx;
    PIN_NOW[2] = r.ay - g * Math.cos(th);
    PIN_NOW[3] = r.az + g * s * fz;
  }

  /** One substep: Verlet under gravity, the damping and the wind's drag, then the links, the bend and the pins, then the ground. */
  private substep(r: HangingRope, C: RopeChains): void {
    const hs = this.hs;
    const N = this.n;
    const T = CLIMB_TUNE;
    const keep = 1 - T.ropeChainDamp * hs;
    const fd = keep > 0 ? keep : 0;
    const k = T.ropeWind * hs;
    const W = C.wind;
    const wx = W.x * W.speed * hs;
    const wz = W.z * W.speed * hs;
    const drop = T.swingGravity * hs * hs;
    // (A lying point's slide kept this share a substep: `ropeGrip` a second.)
    this.lieK = Math.exp(-T.ropeGrip * hs);
    const px = this.px;
    const py = this.py;
    const pz = this.pz;
    const qx = this.qx;
    const qy = this.qy;
    const qz = this.qz;
    for (let i = 1; i < N; i++) {
      let dx = (px[i] - qx[i]) * fd;
      let dy = (py[i] - qy[i]) * fd;
      let dz = (pz[i] - qz[i]) * fd;
      // The wind's drag: the point's speed pulled toward the wind's, at `ropeWind` a second (a displacement's form of it).
      dx += k * (wx - dx);
      dy -= k * dy;
      dz += k * (wz - dz);
      dy -= drop;
      qx[i] = px[i];
      qy[i] = py[i];
      qz[i] = pz[i];
      px[i] += dx;
      py[i] += dy;
      pz[i] += dz;
    }
    px[0] = qx[0] = r.ax;
    py[0] = qy[0] = r.ay;
    pz[0] = qz[0] = r.az;
    this.l = this.len / (N - 1);
    const bend = T.ropeBend;
    this.bendK = bend;
    for (let it = 0; it < CHAIN_ITERS; it++) {
      // The links, one sweep down the chain and the next up it.
      if ((it & 1) === 0) for (let i = 0; i < N - 1; i++) this.link(i);
      else for (let i = N - 2; i >= 0; i--) this.link(i);
      // The bend: two links folding (their ends nearer than two links) pushed apart by its share.
      if (bend > 0) for (let i = 1; i < N - 1; i++) this.fold(i);
      if (this.stepPin !== STEP_FREE) this.pin();
      px[0] = r.ax;
      py[0] = r.ay;
      pz[0] = r.az;
    }
    this.onGround();
    // A point lying on something (at the last step's end, or this step) held on it every substep, from where the substep began it
    // (outside, where the last substep left it): so the links never pull a lying or dragging point into what it lies on for a
    // whole step and the step's ray never has to pull it a long way back out.
    if (this.near) {
      for (let i = 1; i < N; i++) {
        if (this.lie[i] !== 1 && this.touch[i] !== 1) continue;
        RAY_FROM[0] = qx[i];
        RAY_FROM[1] = qy[i];
        RAY_FROM[2] = qz[i];
        this.castOut(C, i);
      }
    }
  }

  /** The ground: a point under its height plus the radius stood on it, lying (its speed across it taken down, none into it). */
  private onGround(): void {
    const N = this.n;
    const hg = this.hg;
    const R = CHAIN_RADIUS;
    const px = this.px;
    const py = this.py;
    const pz = this.pz;
    const qx = this.qx;
    const qy = this.qy;
    const qz = this.qz;
    for (let i = 1; i < N; i++) {
      const h = hg[i];
      if (!(h === h)) continue;
      const floor = h + R;
      if (py[i] < floor) {
        py[i] = floor;
        qy[i] = floor;
        qx[i] = px[i] - (px[i] - qx[i]) * this.lieK;
        qz[i] = pz[i] - (pz[i] - qz[i]) * this.lieK;
        if (this.touch[i] === 0) {
          // (2: on the ground, which no ray asks; 1: on something a ray met.)
          this.touch[i] = 2;
          this.nx[i] = 0;
          this.ny[i] = 1;
          this.nz[i] = 0;
          this.grounds++;
        }
      }
    }
  }

  /** A link held to its length: both ends moved, the anchor never. */
  private link(i: number): void {
    const l = this.l;
    const px = this.px;
    const py = this.py;
    const pz = this.pz;
    const j = i + 1;
    const dx = px[j] - px[i];
    const dy = py[j] - py[i];
    const dz = pz[j] - pz[i];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9) return;
    const wi = i === 0 ? 0 : 1;
    const c = (d - l) / (d * (wi + 1));
    px[i] += wi * c * dx;
    py[i] += wi * c * dy;
    pz[i] += wi * c * dz;
    px[j] -= c * dx;
    py[j] -= c * dy;
    pz[j] -= c * dz;
  }

  /** The bend at point `i`: its two neighbours, folded nearer than two links, pushed apart by the bend's share. */
  private fold(i: number): void {
    const l = this.l;
    const bend = this.bendK;
    const px = this.px;
    const py = this.py;
    const pz = this.pz;
    const a = i - 1;
    const b = i + 1;
    const dx = px[b] - px[a];
    const dy = py[b] - py[a];
    const dz = pz[b] - pz[a];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rest = 2 * l;
    if (d >= rest || d < 1e-9) return;
    const wa = a === 0 ? 0 : 1;
    const c = (bend * (d - rest)) / (d * (wa + 1));
    px[a] += wa * c * dx;
    py[a] += wa * c * dy;
    pz[a] += wa * c * dz;
    px[b] -= c * dx;
    py[b] -= c * dy;
    pz[b] -= c * dz;
  }

  /** The grip's pin at its place along the chain (`PIN_NOW`): the two points either side of it moved so the chain passes through it there. */
  private pin(): void {
    const l = this.l;
    const N = this.n;
    let t = PIN_NOW[0] / l;
    if (t < 0) t = 0;
    if (t > N - 1) t = N - 1;
    let j = Math.floor(t);
    if (j > N - 2) j = N - 2;
    const f = t - j;
    const wj = j === 0 ? 0 : 1;
    const den = wj * (1 - f) * (1 - f) + f * f;
    if (den < 1e-12) return;
    const px = this.px;
    const py = this.py;
    const pz = this.pz;
    const cx = PIN_NOW[1] - (px[j] + (px[j + 1] - px[j]) * f);
    const cy = PIN_NOW[2] - (py[j] + (py[j + 1] - py[j]) * f);
    const cz = PIN_NOW[3] - (pz[j] + (pz[j + 1] - pz[j]) * f);
    const a = (wj * (1 - f)) / den;
    const b = f / den;
    px[j] += a * cx;
    py[j] += a * cy;
    pz[j] += a * cz;
    px[j + 1] += b * cx;
    py[j + 1] += b * cy;
    pz[j + 1] += b * cz;
  }

  /**
   * Something still is near: each point's step (from where it began it to where it ended) met by a ray and a radius past it; a
   * point whose step met something is put out along the met surface's normal to a radius off its plane (it slides on along the
   * surface, never drawn back up its step), lying there (its speed into it taken out, across it its slide dying away by `climb.ropeGrip`). A step begun
   * inside something (a chain laid through it) is let be, so it comes out as it will.
   */
  private rayStep(C: RopeChains): void {
    const N = this.n;
    const O = RAY_FROM;
    for (let i = 1; i < N; i++) {
      O[0] = this.sx[i];
      O[1] = this.sy[i];
      O[2] = this.sz[i];
      this.castOut(C, i);
    }
  }

  /**
   * As the chain is first laid on its rope's line (which may run through something: a rope longer than the drop under it, or one
   * swinging through a wall before it was drawn as a chain), each link from the anchor down met by a ray from its upper point
   * (already where it belongs), so the whole chain is laid on its anchor's side of whatever its line meets. An event.
   */
  private layOut(C: RopeChains): void {
    if (!C.world || !C.ray) return;
    this.lieK = Math.exp((-CLIMB_TUNE.ropeGrip * CHAIN_STEP) / Math.max(1, Math.round(CLIMB_TUNE.ropeSubsteps)));
    const N = this.n;
    for (let i = 1; i < N; i++) {
      RAY_FROM[0] = this.px[i - 1];
      RAY_FROM[1] = this.py[i - 1];
      RAY_FROM[2] = this.pz[i - 1];
      this.castOut(C, i);
      this.qx[i] = this.sx[i] = this.px[i];
      this.qy[i] = this.sy[i] = this.py[i];
      this.qz[i] = this.sz[i] = this.pz[i];
    }
  }

  /** Point `i` met by a ray from `RAY_FROM` to it and a radius past it, and put out of what it met (see `rayStep`). The ray's start in a kept array: no number crosses the call. */
  private castOut(C: RopeChains, i: number): void {
    const ox = RAY_FROM[0];
    const oy = RAY_FROM[1];
    const oz = RAY_FROM[2];
    const W = C.world;
    const ray = C.ray;
    if (!W || !ray) return;
    const R = CHAIN_RADIUS;
    const px = this.px;
    const py = this.py;
    const pz = this.pz;
    let dx = px[i] - ox;
    let dy = py[i] - oy;
    let dz = pz[i] - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) return;
    dx /= d;
    dy /= d;
    dz /= d;
    // (Begun a hair along: the anchor stands on what it hangs from, and a point lying stands a skin off its surface; neither is a hit.)
    const lead = d < 2 * SKIN ? d / 2 : SKIN;
    ray.origin.x = ox + dx * lead;
    ray.origin.y = oy + dy * lead;
    ray.origin.z = oz + dz * lead;
    ray.dir.x = dx;
    ray.dir.y = dy;
    ray.dir.z = dz;
    this.rays++;
    const hit = W.castRayAndGetNormal(ray, d - lead + R, true, CHAIN_FLAGS, C.filter);
    if (!hit) return;
    const t = hit.timeOfImpact;
    if (t <= 0) return;
    this.hits++;
    const nx = hit.normal.x;
    const ny = hit.normal.y;
    const nz = hit.normal.z;
    const tt = t + lead;
    const hx = ox + dx * tt;
    const hy = oy + dy * tt;
    const hz = oz + dz * tt;
    const up = R + SKIN - ((px[i] - hx) * nx + (py[i] - hy) * ny + (pz[i] - hz) * nz);
    if (up <= 0) return;
    const x = px[i] + nx * up;
    const y = py[i] + ny * up;
    const z = pz[i] + nz * up;
    // Its speed into the surface taken out, across it kept by the lie's share.
    const vx = px[i] - this.qx[i];
    const vy = py[i] - this.qy[i];
    const vz = pz[i] - this.qz[i];
    const into = vx * nx + vy * ny + vz * nz;
    const keep = this.lieK;
    const ax = (into < 0 ? vx - into * nx : vx) * keep;
    const ay = (into < 0 ? vy - into * ny : vy) * keep;
    const az = (into < 0 ? vz - into * nz : vz) * keep;
    px[i] = x;
    py[i] = y;
    pz[i] = z;
    this.qx[i] = x - ax;
    this.qy[i] = y - ay;
    this.qz[i] = z - az;
    this.touch[i] = 1;
    this.nx[i] = nx;
    this.ny[i] = ny;
    this.nz[i] = nz;
  }

  /**
   * Laid for drawing (`C.behind` past the last step): each point between where the last two steps left it, by how far the frame
   * stands past the last (a step behind the frame's own time, and so smooth between steps at any frame rate, and never led into
   * what it lies on: both ends of the way stand out of everything); and on a held rope the drawn hands (the frame's own) put into
   * the line, the span above eased onto the upper hand from the anchor and the tail carried with the lower, so the drawn rope
   * meets both hands. Writes `draw`, `drawN`, `drawCount`, `gripA`, `gripB`.
   */
  lay(r: HangingRope, C: RopeChains): void {
    const N = this.n;
    // (`drawnBehind`: the frame's own time past the last step as the last frame that stepped anything saw it, so a frame drawn with
    // play stood still lays the very points the last one did.)
    let a = C.drawnBehind / CHAIN_STEP;
    if (!(a > 0)) a = 0;
    if (a > 1) a = 1;
    const L = LED;
    for (let i = 0; i < N; i++) {
      L[3 * i] = this.sx[i] + (this.px[i] - this.sx[i]) * a;
      L[3 * i + 1] = this.sy[i] + (this.py[i] - this.sy[i]) * a;
      L[3 * i + 2] = this.sz[i] + (this.pz[i] - this.sz[i]) * a;
    }
    L[0] = r.ax;
    L[1] = r.ay;
    L[2] = r.az;
    const D = this.draw;
    const DN = this.drawN;
    const l = this.len / (N - 1);
    let m = 0;
    this.gripA = -1;
    this.gripB = -1;
    // (Maker B, item 4: another player hanging on it is drawn as a body holding it is, through their own two hands.)
    const peer = this.pinOn && this.pinWho === PIN_PEER && this.peerIx >= 0;
    // (A rope the body holds is drawn through its hands from the grab's own frame on, before the pin has begun on the swing's first
    // step: the drawn line's eases need no pin.)
    if (!peer && !r.held) {
      for (let i = 0; i < N; i++) {
        D[3 * m] = L[3 * i];
        D[3 * m + 1] = L[3 * i + 1];
        D[3 * m + 2] = L[3 * i + 2];
        this.normalOf(i, m);
        m++;
      }
      this.drawCount = m;
      return;
    }
    const A = this.handA;
    const B = this.handB;
    let gx: number;
    let gy: number;
    let gz: number;
    if (peer) {
      // Their hands' middle is the grip; their two hands the drawn line's points.
      const H = C.peers.hand;
      const k = 6 * this.peerIx;
      A[0] = H[k];
      A[1] = H[k + 1];
      A[2] = H[k + 2];
      B[0] = H[k + 3];
      B[1] = H[k + 4];
      B[2] = H[k + 5];
      gx = (A[0] + B[0]) / 2;
      gy = (A[1] + B[1]) / 2;
      gz = (A[2] + B[2]) / 2;
      this.handsRig = true;
    } else {
      // The grip on the rope's line at the frame's own time (phase 4's: the hands `gripS` and the stretch down the swing drawn now).
      const sn = Math.sin(r.thDraw);
      const cs = Math.cos(r.thDraw);
      const g = r.gripS + r.e;
      gx = r.ax + g * sn * r.fx;
      gy = r.ay - g * cs;
      gz = r.az + g * sn * r.fz;
      this.handsRig = C.hands > 0 && C.handsRope === r;
      if (this.handsRig) {
        A[0] = C.hand[0];
        A[1] = C.hand[1];
        A[2] = C.hand[2];
        B[0] = C.hand[3];
        B[1] = C.hand[4];
        B[2] = C.hand[5];
      } else {
        A[0] = B[0] = gx;
        A[1] = B[1] = gy;
        A[2] = B[2] = gz;
      }
    }
    // Each hand's place along the rope: along the line from the anchor to the grip.
    let ux = gx - r.ax;
    let uy = gy - r.ay;
    let uz = gz - r.az;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (ul > 1e-6) {
      ux /= ul;
      uy /= ul;
      uz /= ul;
    } else {
      ux = 0;
      uy = -1;
      uz = 0;
    }
    let sa = (A[0] - r.ax) * ux + (A[1] - r.ay) * uy + (A[2] - r.az) * uz;
    let sb = (B[0] - r.ax) * ux + (B[1] - r.ay) * uy + (B[2] - r.az) * uz;
    if (sb < sa) {
      // The upper hand first.
      const t = sa;
      sa = sb;
      sb = t;
      for (let k = 0; k < 3; k++) {
        const v = A[k];
        A[k] = B[k];
        B[k] = v;
      }
    }
    const most = this.len;
    if (sa < 0) sa = 0;
    if (sb > most) sb = most;
    if (sa > sb) sa = sb;
    this.handSA = sa;
    this.handSB = sb;
    // How far each hand stands off the led chain at its place (the eases the drawn line takes).
    this.l = l;
    this.atS = sa;
    this.ledAt(CHAIN_AT);
    const dax = A[0] - CHAIN_AT[0];
    const day = A[1] - CHAIN_AT[1];
    const daz = A[2] - CHAIN_AT[2];
    this.atS = sb;
    this.ledAt(CHAIN_AT);
    const dbx = B[0] - CHAIN_AT[0];
    const dby = B[1] - CHAIN_AT[1];
    const dbz = B[2] - CHAIN_AT[2];
    const gap = HAND_GAP * l;
    for (let i = 0; i < N; i++) {
      const s = l * i;
      // (The anchor always: a hand never stands above what the rope hangs from.)
      if (i > 0 && s >= sa - gap) break;
      const w = sa > 1e-9 ? s / sa : 0;
      D[3 * m] = L[3 * i] + dax * w;
      D[3 * m + 1] = L[3 * i + 1] + day * w;
      D[3 * m + 2] = L[3 * i + 2] + daz * w;
      this.normalOf(i, m);
      m++;
    }
    D[3 * m] = A[0];
    D[3 * m + 1] = A[1];
    D[3 * m + 2] = A[2];
    DN[3 * m] = 0;
    DN[3 * m + 1] = 0;
    DN[3 * m + 2] = 0;
    this.gripA = m;
    m++;
    const bx = B[0] - A[0];
    const by = B[1] - A[1];
    const bz = B[2] - A[2];
    if (bx * bx + by * by + bz * bz > HAND_ONE * HAND_ONE) {
      D[3 * m] = B[0];
      D[3 * m + 1] = B[1];
      D[3 * m + 2] = B[2];
      DN[3 * m] = 0;
      DN[3 * m + 1] = 0;
      DN[3 * m + 2] = 0;
      this.gripB = m;
      m++;
    } else this.gripB = this.gripA;
    for (let i = 0; i < N; i++) {
      const s = l * i;
      if (s <= sb + gap) continue;
      D[3 * m] = L[3 * i] + dbx;
      D[3 * m + 1] = L[3 * i + 1] + dby;
      D[3 * m + 2] = L[3 * i + 2] + dbz;
      this.normalOf(i, m);
      m++;
    }
    this.drawCount = m;
  }

  /** The led chain's point at `s` metres from its anchor (`LED`, links straight), into `at`. */
  private ledAt(at: Float64Array): void {
    const s = this.atS;
    const l = this.l;
    const N = this.n;
    let t = l > 1e-9 ? s / l : 0;
    if (t < 0) t = 0;
    if (t > N - 1) t = N - 1;
    let j = Math.floor(t);
    if (j > N - 2) j = N - 2;
    const f = t - j;
    at[0] = LED[3 * j] + (LED[3 * j + 3] - LED[3 * j]) * f;
    at[1] = LED[3 * j + 1] + (LED[3 * j + 4] - LED[3 * j + 1]) * f;
    at[2] = LED[3 * j + 2] + (LED[3 * j + 5] - LED[3 * j + 2]) * f;
  }

  /** The drawn point `m`'s surface normal: the chain's point `i`'s where it touches something this step, else nought. */
  private normalOf(i: number, m: number): void {
    const DN = this.drawN;
    if (this.touch[i] !== 0) {
      DN[3 * m] = this.nx[i];
      DN[3 * m + 1] = this.ny[i];
      DN[3 * m + 2] = this.nz[i];
    } else {
      DN[3 * m] = 0;
      DN[3 * m + 1] = 0;
      DN[3 * m + 2] = 0;
    }
  }

  /** The longest a link stands now over its length, metres (the console's and the tests' word on how inextensible it is). */
  stretchMost(): number {
    const N = this.n;
    const l = this.len / (N - 1);
    let most = 0;
    for (let i = 0; i < N - 1; i++) {
      const dx = this.px[i + 1] - this.px[i];
      const dy = this.py[i + 1] - this.py[i];
      const dz = this.pz[i + 1] - this.pz[i];
      const e = Math.sqrt(dx * dx + dy * dy + dz * dz) - l;
      if (e > most) most = e;
    }
    return most;
  }
}

/** The points a chain is laid with: the slider's, held to the arrays' length. */
export function pointsWanted(): number {
  const v = Math.round(CLIMB_TUNE.ropePoints);
  return v < CHAIN_LEAST ? CHAIN_LEAST : v > CHAIN_MOST ? CHAIN_MOST : v;
}

/** Kept scratch: a resample's points, the pin's place now (its place along, then x, y, z), a point of the chain, and the led chain. */
const SCRATCH = new Float64Array(3 * CHAIN_MOST);
const PIN_NOW = new Float64Array(4);
const PIN_AT = new Float64Array(3);
const CHAIN_AT = new Float64Array(3);
const SLOT_AT = new Float64Array(3);
const LED = new Float64Array(3 * CHAIN_MOST);
const RAY_FROM = new Float64Array(3);

/**
 * The ropes' chains, one frame at a time, for whatever holds the ropes (the player; the node harness): its caller writes `steps`
 * at the top of its update (the physics' steps the frame's step takes, `Physics.stepsAhead`, before anything has the body), and
 * once the update and the physics have run, `behind` (`Physics.behind`), the wind and, for the rope the body holds, the drawn
 * hands; then `frame` steps every rope's chain over those steps and lays it for drawing. Under `climb.ropeLook` 'straight', or
 * with `climb.ropes` 'off', nothing is stepped and every chain is let go (laid again on its rope's line when the chain is next on).
 */
export class RopeChains {
  /** The physics' steps the frame's step takes (written at the top of the caller's update; put back to nought by `frame`). */
  private stepsNow = 0;
  /** Whether the caller's update has written `steps` since the last `frame` (a frame drawn with play stood still writes none). */
  private updated = false;
  get steps(): number {
    return this.stepsNow;
  }
  /** Written at the top of the caller's update: which is also its word that an update ran this frame. */
  set steps(n: number) {
    this.stepsNow = n;
    this.updated = true;
  }
  /** How far the frame stands past the last step, seconds (`Physics.behind`, read after the step; the caller writes it every frame). */
  behind = 0.5;
  /**
   * The `behind` the chains are laid at: taken by `frame` only on a frame whose update ran (wrote `steps`), and held otherwise. The
   * frame loop steps the physics and draws the ropes whether or not play stands still (a panel, the map, the menu, death), but runs
   * the update only while it does not: taken every frame, a still chain was laid at a remainder that moved every frame with nothing
   * stepped, between the last two steps' points, and jittered up to 30 mm a frame at 144 frames a second (the review's find).
   */
  drawnBehind = 0.5;
  /** The engine's group filter for the chain's queries (the caller's: every group but the terrain's, whose height `ground` answers). */
  filter = 0;
  /** The world, its ray and its near box (the caller's, made once); null: no query, the terrain alone. */
  world: ChainWorld | null = null;
  ray: RAPIER.Ray | null = null;
  box: RAPIER.Cuboid | null = null;
  /** The ground from cached heights (the caller's), null for none; its kept ask. */
  ground: ChainGround | null = null;
  readonly ask = new ChainAsk();
  /** The wind (the caller's: the trees' and the rain's), written each frame. */
  readonly wind = new ChainWind();
  /** The drawn hands of the rope the body holds (`handsRope`), each hand's grip, six numbers; `hands` 0 where the caller has none (the grip on the line stands for both). Put back by `frame`. */
  hands = 0;
  handsRope: HangingRope | null = null;
  readonly hand = new Float64Array(6);
  /** The near box's middle (a kept record handed to the engine). */
  readonly at = { x: 0, y: 0, z: 0 };
  /** Frames stepped (the console's). */
  frames = 0;
  /** Item 4 (maker B): the other players hanging on a rope this frame (the game's, written before `frame`: src/net/remoteRopes.ts's `hungInto`). */
  readonly peers = new PeerHangs();

  constructor() {
    this.behind = 0;
    this.drawnBehind = 0;
  }

  /** The frame (see the class): every rope's chain stepped and laid; nothing under 'straight'. */
  frame(ropes: readonly HangingRope[]): void {
    const on = CLIMB_TUNE.ropeLook === 'chain' && CLIMB_TUNE.ropes === 'on';
    const P = this.peers;
    if (this.updated) this.drawnBehind = this.behind;
    this.updated = false;
    if (!on) {
      for (let i = 0; i < ropes.length; i++) {
        const r = ropes[i];
        const c = r.chain;
        if (c) c.live = false;
        // (The swing's record read by nobody: put back, so a chain made later never takes an old frame's steps.)
        r.swingSteps = -1;
      }
      this.stepsNow = 0;
      this.hands = 0;
      this.handsRope = null;
      // (Nobody's rope taken: their own straight line to the anchor drawn as it always was.)
      for (let k = 0; k < P.count; k++) P.taken[k] = 0;
      P.filled = false;
      return;
    }
    this.frames++;
    for (let i = 0; i < ropes.length; i++) {
      const r = ropes[i];
      let c = r.chain;
      // (Made the first frame a rope is drawn as a chain: an event, once a rope.)
      if (!c) c = r.chain = new RopeChain();
      // Item 4: another player on it, where the body does not hold it (the body's own hands win, its last steps' too).
      c.peerIx = P.filled && !r.held && r.swingSteps <= 0 ? this.peerOn(r) : -1;
      c.stepFrame(r, this);
      c.lay(r, this);
    }
    this.stepsNow = 0;
    this.hands = 0;
    this.handsRope = null;
    // (Taken once: a frame the game writes no peers, as `__debug.advance`'s, finds none.)
    P.filled = false;
  }

  /** Item 4: the first other player not yet taken whose rope's anchor is `r`'s, marked taken; -1 none. */
  private peerOn(r: HangingRope): number {
    const P = this.peers;
    const near2 = PEER_ANCHOR_NEAR * PEER_ANCHOR_NEAR;
    for (let k = 0; k < P.count; k++) {
      if (P.taken[k] !== 0) continue;
      const dx = P.anchor[3 * k] - r.ax;
      const dy = P.anchor[3 * k + 1] - r.ay;
      const dz = P.anchor[3 * k + 2] - r.az;
      if (dx * dx + dy * dy + dz * dz > near2) continue;
      P.taken[k] = 1;
      return k;
    }
    return -1;
  }

  /** The console's word on the chains (`__debug.climb()`'s `rope.chain`). */
  report(ropes: readonly HangingRope[]): Record<string, unknown> {
    const n3 = (v: number) => +v.toFixed(3);
    return {
      look: CLIMB_TUNE.ropeLook,
      points: pointsWanted(),
      substeps: Math.max(1, Math.round(CLIMB_TUNE.ropeSubsteps)),
      frames: this.frames,
      wind: { x: n3(this.wind.x), z: n3(this.wind.z), speed: n3(this.wind.speed) },
      ropes: ropes.map((r) => {
        const c = r.chain;
        if (!c || !c.live) return { name: r.name, live: false };
        let lying = 0;
        for (let i = 0; i < c.n; i++) if (c.touch[i]) lying++;
        const e = c.n - 1;
        return {
          name: r.name,
          live: true,
          held: c.pinOn,
          pin: c.pinOn ? n3(c.pinS) : null,
          // (Maker B, item 4: who pins it: the body, or another player hanging on it, by their relay id.)
          by: !c.pinOn ? null : c.pinWho === PIN_PEER && c.peerIx >= 0 ? `player ${this.peers.id[c.peerIx]}` : 'you',
          hands: c.gripA >= 0 ? { from: c.pinWho === PIN_PEER ? 'their rig' : c.handsRig ? 'rig' : 'grip', along: [n3(c.handSA), n3(c.handSB)], at: [n3(c.handA[0]), n3(c.handA[1]), n3(c.handA[2]), n3(c.handB[0]), n3(c.handB[1]), n3(c.handB[2])] } : null,
          end: [n3(c.px[e]), n3(c.py[e]), n3(c.pz[e])],
          length: n3(c.len),
          stretchMost: n3(c.stretchMost()),
          lying,
          near: c.near,
          steps: c.steps,
          // (The fixer: of them, pinned on the swing's own steps.)
          swung: c.swung,
          boxes: c.boxes,
          nears: c.nears,
          rays: c.rays,
          hits: c.hits,
          drawn: c.drawCount,
        };
      }),
    };
  }
}
