// Ledges (wave 4 of the animations, maker A; the owner's brief's "Free climbing" at lines 157 to 159: "various stances
// such as braced (feet against wall while hanging from ledge) and hanging (no feet on wall in front of you, or no wall to
// put feet on) and shimmying for each, as well as jumping, landing on a ledge from a jump or a run jump").
//
// A ledge is a lip whose top is walkable (by wave 2b's climb limit, `LOCO_TUNE.slope.climb`) with a face steeper than that
// limit under it, of what stands still only (the engine's own query flags: terrain and fixed or bodiless colliders; never a
// door, a vehicle, a loose prop, a creature or another player). One class, `LedgeHang`, holds the whole of it and is
// stepped by the player's update and by the node harness alike (tools/swg/tests/grappleBody.ts), each at the very same
// two places:
//  - `sense`, after the move (beside wave 2b's slope verdict): in the air, moving toward a face whose lip stands within the
//    hands' reach band over the feet (`climb.reachLow` to `reachHigh`, scaled by the figure), falling no faster than
//    `climb.grabFall`, with no crouch held, no wall move or Force jump's rise under way and the stamina not tired, the body
//    grabs (the grab's clip from the frame its hands reach the lip, the body carried onto the hang over its rest); crouched,
//    walking off a lip whose drop is deeper than a hang, it turns and lowers into the hang;
//  - `step`, in place of the movement while it holds the body (`holding`): the hang's keys (A and D shimmy along the lip,
//    probed again as the body moves and stopped at its end or a corner; Space with A or D hops to another lip within
//    `climb.hopSide`, with W up to one within `climb.hopUp`; Space or W climbs up where a crouched capsule fits on the top;
//    crouch lets go; S with Space jumps off backward), the stamina (hanging and shimmying drain it, a hop takes a lump, and
//    emptied the body lets go), and a one-off that moves the body (a grab, a hop, a climb, the turn between braced and free,
//    the step down) carried from where it began to where it is aimed, so the hands land on the lip it was aimed at.
// Braced or free is one probe at the feet's height under the lip: a face within reach of the feet is braced.
//
// What the figure plays is said in `rigState` (the hang's loop, which goes to other players as their rig state) and
// `startClip` (a one-off to begin this frame, for the caller to hand its rig), and where the figure's own origin is drawn
// against the body's in `offX/offY/offZ` (the world's frame: each clip was authored at a height of its own, so a clip is
// lined up by its hands or its feet, src/anim/ledgeClips.ts). The hands' line on the lip is `handLine`.
//
// Nothing here makes an object on a frame: every ask and answer is a kept record, and the engine's own answers (a ray's,
// a shape's) are the only things made, counted in `casts`.

import * as THREE from 'three';
import type { RAPIER } from '../core/physics.ts';
import { STILL_FLAGS } from './stairSense.ts';
import type { LimbPlace, LimbRig } from './limbPlace.ts';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { LOCO_TUNE } from '../anim/locoTune.ts';
import { LEDGE_CLIMB_CUT, LEDGE_FACTS, LEDGE_JUMP_OFF, LEDGE_REST, LEDGE_ROLES, LEDGE_STEP_DOWN, type LedgeClipFacts, type LedgeRoles } from '../anim/ledgeClips.ts';

/** The little of a physics world the ledges ask (rapier's `World`). */
export interface LedgeWorld {
  castRayAndGetNormal(ray: RAPIER.Ray, maxToi: number, solid: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): RAPIER.RayColliderIntersection | null;
  intersectionWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number): RAPIER.Collider | null;
}

/** The engine's ray and the two capsules the room checks ask with, handed in once (so this file loads under node with no engine of its own). */
export interface LedgeMakers {
  ray(): RAPIER.Ray;
  /** The standing capsule (half height, radius) and the crouched one. */
  capsule(halfHeight: number, radius: number): RAPIER.Shape;
}

/** The little of a body the ledges move: its feet and its velocity (the player's `pos` and `vel`, the harness's). */
export interface LedgeBody {
  readonly pos: { x: number; y: number; z: number };
  readonly vel: { x: number; y: number; z: number };
}

/** The stamina's pool (wave 2a's `Stamina`): its points, whether it is tired, and a step at a rate. */
export interface LedgeStamina {
  value: number;
  tired: boolean;
  step(dt: number, rate: number, pool: number, tune: typeof LOCO_TUNE): void;
}

/** A frame of the body as the ledges need it, written by the caller (fields, so no number crosses a call). */
export class LedgeIn {
  dt = 0.5;
  /** The body's heading, radians (its front is (sin h, 0, cos h)). */
  heading = 0.5;
  grounded = false;
  wasGrounded = false;
  /** The movement jumped this frame (a step off a lip with a jump is no step down). */
  jumped = false;
  /** Something else has the body: swimming, the rope or its flight after, thrown from a wreck, dead, a wall move or a Force jump's rise. */
  busy = false;
  crouchHeld = false;
  crouchPressed = false;
  jumpPressed = false;
  forwardHeld = false;
  forwardPressed = false;
  backHeld = false;
  leftHeld = false;
  rightHeld = false;
  /** The move keys' direction in the world (horizontal), nought for none. */
  moveX = 0.5;
  moveZ = 0.5;
  /** The figure's size against the human male (its hips' rest height over his, times its own scale). */
  scale = 0.5;
  /** The move's own collision groups. */
  filter = 0.5;
  /** The stamina's pool size (wave 2a: 100). */
  pool = 0.5;
  /**
   * Maker B's wall climb: the frame's move was cut short across the ground by something in its way (the controller kept
   * under 60% of the level move it was asked for): only a body pressed into a face feels for one to climb, so walking
   * free in the open casts nothing.
   */
  blocked = false;
  /**
   * In the air, Jedi Academy's own wall move off a wall is open to the body now (`JkaMovement.airWallMoveOpen`): the wall
   * climb never starts in the air then, so the Force's rebound keeps its own trigger (the fix round's).
   */
  airWallMove = false;
  /**
   * Climbing II, phase 2: the use key handed to the climb by the game's one use-key dispatch and still held (`ClimbAsk.on`):
   * under `climb.grab` 'use' a lip is grabbed and a wall climb started only while it is.
   */
  use = false;
  /**
   * Climbing II, item 7 (maker B): where the view looks, its yaw in the body's own frame (the camera's flattened forward is
   * (sin, 0, cos) of it, as a heading's front), NaN for none: what the braced look-away reads.
   */
  viewYaw = 0.5;
  constructor() {
    this.viewYaw = Number.NaN;
    this.dt = 0;
    this.heading = 0;
    this.moveX = 0;
    this.moveZ = 0;
    this.scale = 1;
    this.filter = 0;
    this.pool = 100;
  }
}

/**
 * Climbing II, phase 2, item 1: the use key handed to the climb. The game's one use-key dispatch (main.ts's E) presses it on
 * a press it gives the climb (falling, before anything else, `climbTakesUseFirst`; otherwise when nothing else in reach took
 * the key), and it holds while the key is held: `hold` lets it go the frame the key is up, or muted (the hands already hold
 * something, `LEDGE_MUTES`), so a let-go never grabs again on a key still down from before. The harness presses it the same
 * way (nothing else in it takes the key).
 */
export class ClimbAsk {
  on = false;
  press(): void {
    this.on = true;
  }
  hold(held: boolean): void {
    if (!held) this.on = false;
  }
}

/**
 * Whether a press of the use key goes to the climb before anything else may take it (the owner's, 2026-11-16: "Things that
 * are interactable, like buttons and people or vehicles etc, should always take priority over wall climbing unless actively
 * falling"): under `climb.grab` 'use', on foot and falling. Otherwise the dispatch asks its own chain first and hands the
 * climb only a press nothing in reach took.
 */
export function climbTakesUseFirst(grab: string, onFoot: boolean, grounded: boolean, vy: number): boolean {
  return grab === 'use' && onFoot && !grounded && vy < 0;
}

/** The game's own gravity, m/s^2 (Jedi Academy's 800 units at 0.0254 m: the small jump off's rise is worked out against it). */
const GRAVITY = 800 * 0.0254;

/** What becomes of the body when a one-off ends. */
const AFTER_HANG = 0;
const AFTER_STAND = 1;
const AFTER_FALL = 2;

/** The phase: holding nothing, hanging (still or shimmying), or carried through a one-off. */
export const LEDGE_NONE = 0;
export const LEDGE_HANG = 1;
export const LEDGE_MOVE = 2;

/** The capsule the player wears: its radius and its two half heights (player.ts's `CAPSULE_RADIUS`, standing and crouched). */
export const LEDGE_CAPSULE = { r: 0.35, stand: 0.45, crouch: 0.15 } as const;

/** One kept ray's answer. */
class Hit {
  hit = false;
  x = 0.5;
  y = 0.5;
  z = 0.5;
  nx = 0.5;
  ny = 0.5;
  nz = 0.5;
  toi = 0.5;
}

/**
 * A lip found: the face's top edge at the body's lateral place, its outward normal (level, unit), the top's own normal's
 * rise, and how it slopes along its length (the rise a metre toward the figure's left, level: the hands grip it at its own
 * height under each).
 */
export class Lip {
  ex = 0.5;
  ey = 0.5;
  ez = 0.5;
  nx = 0.5;
  nz = 0.5;
  topNy = 0.5;
  slope = 0.5;
  constructor() {
    this.slope = 0;
  }
  copy(o: Lip): this {
    this.ex = o.ex;
    this.ey = o.ey;
    this.ez = o.ez;
    this.nx = o.nx;
    this.nz = o.nz;
    this.topNy = o.topNy;
    this.slope = o.slope;
    return this;
  }
}

/** The rail's room: a lip held is sampled this many times at most (the far side let go as the near side grows). */
const RAIL_CAP = 64;
/** Metres of the lip's own edge between two of the rail's samples (ours: fine enough that a corner is found within a hand's width). */
export const RAIL_STEP = 0.1;
/** The steepest a lip may slope and still be followed at all, degrees (past `climb.lipSlope` it is followed, and stopped at). */
const RAIL_STEEPEST = 60;
/** A straight step along the lip takes a face turned at most this much from the last (its cosine): a lip that curves. */
const CURVE_COS = Math.cos((50 * Math.PI) / 180);
/** Rounding an outer corner, the turns tried for the face beyond it, radians: square first, then the gentler polygons'. */
const CORNER_TURNS: readonly number[] = [Math.PI / 2, Math.PI / 3, Math.PI / 4, Math.PI / 6];
/** A face found round an outer corner is taken within this of the turn tried (its cosine). */
const CORNER_COS = Math.cos((25 * Math.PI) / 180);

/**
 * The lip held, sampled along its own edge (the fix round's: the owner's corners, curves and slopes, added while wave 4
 * ran): points at increasing arc (metres along the edge, level, toward the figure's left), each its edge point, its face's
 * outward normal (level, unit) and its top's rise; whether each end is the lip's own end, and the way each end's face looks
 * (what the next step is felt for with: past a corner, the new face's). A sample in between is the two points' line, its
 * normal their mean. Every ask and answer through fields (`q` in, `s*` out): no number crosses a call.
 */
export class Rail {
  readonly a = new Float64Array(RAIL_CAP);
  readonly x = new Float64Array(RAIL_CAP);
  readonly y = new Float64Array(RAIL_CAP);
  readonly z = new Float64Array(RAIL_CAP);
  readonly nx = new Float64Array(RAIL_CAP);
  readonly nz = new Float64Array(RAIL_CAP);
  readonly top = new Float64Array(RAIL_CAP);
  /**
   * Climbing II, item 5: the segment from each point to the next toward the high end is a step along the lip (its rise a
   * jump at one place, level on either side), which a shimmy crosses hand by hand up to `stepUp` (the caller's `stepMax`).
   */
  readonly stp = new Uint8Array(RAIL_CAP);
  /** The point pushed next ends a step (in, put back to nought by every push). */
  pstep = 0;
  /** A step's most a shimmy crosses (in, metres; nought: none, today's). */
  stepUp = 0.5;
  /** How far a segment may rise past the slope limit and still be followed, metres (in: `climb.slopeLimit`'s millimetre, nought today's). */
  slack = 0.5;
  n = 0;
  loEnd = false;
  hiEnd = false;
  loNx = 0.5;
  loNz = 0.5;
  hiNx = 0.5;
  hiNz = 0.5;
  /** A sample's arc (in) and its point, normal and top (out). */
  q = 0.5;
  sx = 0.5;
  sy = 0.5;
  sz = 0.5;
  snx = 0.5;
  snz = 0.5;
  stop = 0.5;
  /** A point to push (in): its arc, place, normal and top. */
  pa = 0.5;
  px = 0.5;
  py = 0.5;
  pz = 0.5;
  pnx = 0.5;
  pnz = 0.5;
  ptop = 0.5;
  constructor() {
    this.sa = 0;
    this.loNx = 0;
    this.loNz = 0;
    this.hiNx = 0;
    this.hiNz = 0;
    this.q = 0;
    this.sx = 0;
    this.sy = 0;
    this.sz = 0;
    this.snx = 0;
    this.snz = 0;
    this.stop = 0;
    this.pa = 0;
    this.px = 0;
    this.py = 0;
    this.pz = 0;
    this.pnx = 0;
    this.pnz = 0;
    this.ptop = 0;
    this.stepUp = 0;
    this.slack = 0;
  }

  /** One point, the lip's middle, both ends open and going on along its own face. */
  start(L: Lip): void {
    this.n = 1;
    this.a[0] = 0;
    this.x[0] = L.ex;
    this.y[0] = L.ey;
    this.z[0] = L.ez;
    this.nx[0] = L.nx;
    this.nz[0] = L.nz;
    this.top[0] = L.topNy;
    this.loEnd = false;
    this.hiEnd = false;
    this.loNx = L.nx;
    this.loNz = L.nz;
    this.hiNx = L.nx;
    this.hiNz = L.nz;
  }

  /** The point in `p*` onto the high end (toward the figure's left), the low end's far point let go where the room is full. */
  pushHi(): void {
    if (this.n === RAIL_CAP) {
      this.shift(1, 0, this.n - 1);
      this.n--;
      this.loEnd = false;
    }
    this.put(this.n);
    if (this.n > 0) this.stp[this.n - 1] = this.pstep;
    this.pstep = 0;
    this.n++;
  }

  /** The point in `p*` onto the low end, the high end's far point let go where the room is full. */
  pushLo(): void {
    if (this.n === RAIL_CAP) {
      this.n--;
      this.hiEnd = false;
    }
    this.shift(0, 1, this.n);
    this.put(0);
    this.stp[0] = this.pstep;
    this.pstep = 0;
    this.n++;
  }

  private put(i: number): void {
    this.a[i] = this.pa;
    this.x[i] = this.px;
    this.y[i] = this.py;
    this.z[i] = this.pz;
    this.nx[i] = this.pnx;
    this.nz[i] = this.pnz;
    this.top[i] = this.ptop;
  }

  /** `count` points from `from` copied to `to` (overlapping either way). */
  private shift(from: number, to: number, count: number): void {
    this.a.copyWithin(to, from, from + count);
    this.x.copyWithin(to, from, from + count);
    this.y.copyWithin(to, from, from + count);
    this.z.copyWithin(to, from, from + count);
    this.nx.copyWithin(to, from, from + count);
    this.nz.copyWithin(to, from, from + count);
    this.top.copyWithin(to, from, from + count);
    this.stp.copyWithin(to, from, from + count);
  }

  /** The lip at arc `q` into `s*` (held to the rail's two ends). */
  sample(): void {
    const n = this.n;
    const a = this.a;
    const q = this.q;
    if (n === 0) return;
    let i = 0;
    if (q <= a[0] || n === 1) i = -1;
    else if (q >= a[n - 1]) i = n - 1;
    else while (i < n - 2 && a[i + 1] < q) i++;
    if (i < 0 || i === n - 1) {
      const k = i < 0 ? 0 : n - 1;
      this.sx = this.x[k];
      this.sy = this.y[k];
      this.sz = this.z[k];
      this.snx = this.nx[k];
      this.snz = this.nz[k];
      this.stop = this.top[k];
      return;
    }
    const span = a[i + 1] - a[i];
    const u = span > 1e-9 ? (q - a[i]) / span : 0;
    this.sx = this.x[i] + (this.x[i + 1] - this.x[i]) * u;
    this.sy = this.y[i] + (this.y[i + 1] - this.y[i]) * u;
    this.sz = this.z[i] + (this.z[i + 1] - this.z[i]) * u;
    let nx = this.nx[i] + (this.nx[i + 1] - this.nx[i]) * u;
    let nz = this.nz[i] + (this.nz[i + 1] - this.nz[i]) * u;
    const l = Math.sqrt(nx * nx + nz * nz);
    if (l > 1e-9) {
      nx /= l;
      nz /= l;
    } else {
      nx = this.nx[i];
      nz = this.nz[i];
    }
    this.snx = nx;
    this.snz = nz;
    this.stop = this.top[i] + (this.top[i + 1] - this.top[i]) * u;
  }

  /**
   * How far along a shimmy may carry a point from arc `q` toward the high end (`hi`) or the low before the lip ends or
   * grows steeper than `tanMax` (rise over level length): the arc of the last point before that, into `sa`.
   */
  sa = 0.5;
  limit(hi: boolean, tanMax: number): void {
    const n = this.n;
    const a = this.a;
    if (n === 0) {
      this.sa = this.q;
      return;
    }
    if (hi) {
      let i = 0;
      while (i < n - 1 && a[i + 1] <= this.q) i++;
      // From the segment the point is on, out to the high end.
      let k = i;
      while (k < n - 1) {
        const dx = this.x[k + 1] - this.x[k];
        const dz = this.z[k + 1] - this.z[k];
        const l = Math.sqrt(dx * dx + dz * dz);
        const dy = this.y[k + 1] - this.y[k];
        // A step along the lip (item 5) no taller than the most is crossed, however steep its own few millimetres.
        if (l > 1e-6 && (dy > tanMax * l + this.slack || -dy > tanMax * l + this.slack) && !(this.stp[k] === 1 && dy <= this.stepUp && -dy <= this.stepUp)) break;
        k++;
      }
      this.sa = a[k];
      return;
    }
    let i = n - 1;
    while (i > 0 && a[i - 1] >= this.q) i--;
    let k = i;
    while (k > 0) {
      const dx = this.x[k] - this.x[k - 1];
      const dz = this.z[k] - this.z[k - 1];
      const l = Math.sqrt(dx * dx + dz * dz);
      const dy = this.y[k] - this.y[k - 1];
      if (l > 1e-6 && (dy > tanMax * l + this.slack || -dy > tanMax * l + this.slack) && !(this.stp[k - 1] === 1 && dy <= this.stepUp && -dy <= this.stepUp)) break;
      k--;
    }
    this.sa = a[k];
  }
}

/** The one-off under way: its clip, the body's path, the figure's offset at each end, its clock, and what follows it. */
class Move {
  id = '';
  /** 'grab', 'hop', 'climb', 'turn', 'stepDown'. */
  kind = '';
  fx = 0.5;
  fy = 0.5;
  fz = 0.5;
  tx = 0.5;
  ty = 0.5;
  tz = 0.5;
  o0x = 0.5;
  o0y = 0.5;
  o0z = 0.5;
  o1x = 0.5;
  o1y = 0.5;
  o1z = 0.5;
  t0 = 0.5;
  T = 0.5;
  time = 0.5;
  after = 0;
  /** The hang's kind once it ends, and its heading (a step down turns the body round at its end). */
  braced = false;
  heading = 0.5;
  /** The heading it began at (a hop turns from it to `heading` as it goes: a lip on another face). */
  h0 = 0.5;
  /** Climbing II, item 7: the way a hop behind turns round (+1 to the left, -1 to the right; nought: the shorter way, today's). */
  spin = 0;
  readonly lip = new Lip();
  /**
   * The body's own path (the capsule's), checked for room before the move begins (the fix round's): `PATH_LINE` straight,
   * `PATH_CURVE` a curve through a middle point `c*` (a hop round what stands in its line), `PATH_LEGS` three legs through
   * `p1*` and `p2*` (a climb up: out clear of the face, up over the lip, in onto the top, the last crouched). The figure
   * drawn on a climb keeps the straight line it always had (the clip's own pose and line-up, so nothing it shows changes).
   */
  path = 0;
  cx = 0.5;
  cy = 0.5;
  cz = 0.5;
  p1x = 0.5;
  p1y = 0.5;
  p1z = 0.5;
  p2x = 0.5;
  p2y = 0.5;
  p2z = 0.5;
  /** The legs' lengths (a climb's), and how far along them the in-leg (crouched) begins. */
  l1 = 0.5;
  l2 = 0.5;
  l3 = 0.5;
  /**
   * The feedback round (`climb.roomRule` 'fit'): a climb up tucked crouched from this share of its path on, where standing
   * would meet something on the way up (more than one: never, today's path).
   */
  crouchFrom = 2;
}

/**
 * The feedback round, item 2: what the last climb up's room tests found (`__debug.climb({ room: true })`): which test failed
 * first (`top`: the crouched body's room on the top at a depth in from the lip; `path`: the climb's own way out from the
 * face, up past the lip and in over the top; `noTop`: no top found behind the lip; `narrow`, `steep`), where, what it met
 * and how far into it, and what the rule made of it (`whole`, `nearer`, `tucked`, `lower`, `brushed`, or `refused`). Written
 * only as a climb up is asked (an event, never a frame).
 */
export class RoomReport {
  asked = 0;
  test = '';
  /** The top test's depth in from the lip, metres (NaN for none). */
  depth = Number.NaN;
  /** The path's leg ('out', 'up', 'in') and the share along it. */
  leg = '';
  along = Number.NaN;
  /** Standing or crouched, and the brush, of the capsule that met something. */
  crouched = false;
  brush = 0;
  /** The capsule's middle there (the world's frame). */
  x = Number.NaN;
  y = Number.NaN;
  z = Number.NaN;
  /** What it met: its handle (-1 none), its name (the game's, else its kind), and how far into it the capsule reached, metres (NaN not measured). */
  handle = -1;
  met = '';
  past = Number.NaN;
  rule = '';
  result = '';
  /** Where a short climb ended: its depth in from the lip, its lift over it, and whether it tucked or was cut. */
  endDepth = Number.NaN;
  lift = Number.NaN;
  cut = false;
  words = '';
}

const PATH_LINE = 0;
const PATH_CURVE = 1;
const PATH_LEGS = 2;
/** The feedback round (`climb.roomRule` 'fit'): how many depth steps nearer the lip than the clip's own end a short climb tries (ours: enough to reach half the capsule's radius in from a large figure's end). */
const SHORT_NEAR = 6;

/**
 * The feedback round, item 2: a collider's kind by its collision groups (`src/core/physics.ts`'s `Group`), where the game
 * knows no name for it: the terrain's heightfield, a building's shell, a building's room or what stands in it, else plain.
 */
function colliderKind(c: RAPIER.Collider): string {
  const m = c.collisionGroups() >>> 16;
  if (m === 0x0001) return 'the ground';
  if (m === 0x0002) return "a building's shell";
  if (m === 0x0004) return "a building's room";
  return 'something standing still';
}
/** The capsule's room along a path is tested this often, metres (ours: under half its radius). */
const PATH_EVERY = 0.15;
/** A climb's capsule rises clear of the top by this before it goes in over it, metres (ours). */
const CLIMB_LIFT = 0.05;
/** And stands this far beyond its radius off the face as it rises (the wall climb's own skin), metres. */
const CLIMB_SKIN = 0.02;
/** A hop's curves tried where its line meets something: the middle pushed out from the faces and up by these, metres (ours). */
const HOP_BENDS: readonly number[] = [0.6, 0, 0, 0.6, 0.6, 0.6, 1.2, 0, 1.2, 0.6];
/**
 * Climbing II, item 4, the band's look: how far apart its columns stand along the way and across it, metres (ours: finer
 * than a hand, so a lip's near end is met within a tenth of a metre); the most columns either side and in front of or
 * behind the face it looks at (the sliders' own ends: `hopSlack` 3 m, `hopDepth` 2 m); and the most lips it keeps to try.
 */
const BAND_STEP = 0.1;
/** Climbing II, item 5: a step measured within this of `stepMax` is crossed (the rays' own rounding), metres. */
const STEP_SLACK = 0.01;
const BAND_SIDES = 30;
/**
 * Climbing II (`climb.corners` 'ramp', maker B): a corner along a lip keeps the old face's way exactly up to the corner (its
 * own point takes the old face's normal, not the two faces' mean) and turns the hands' faces over this span past it, metres
 * (ours: half a rail step), wherever the rail's samples happen to fall; and the corner is found to under a millimetre (eight
 * halvings of a rail step in place of four). Phase 1 found the body turned up to 20 degrees more at a lip's end at one frame
 * rate than another: the turn began as far before the corner as the last sample before it happened to stand.
 */
const CORNER_RAMP = 0.05;
/**
 * Climbing II, item 5 (the fixer): a step down past `stepMax` is the lip's end, never a corner round the step's side, where
 * just past the top's end a lower walkable top stands within the braced hang's own depth (the body hanging round that corner
 * would stand in the lower step). Looked for this far past the corner, metres (ours, a mechanic: half a rail step on).
 */
const STEP_END_PAST = 0.05;
/** `climb.slopeLimit` 'inclusive': a rail step may rise this much past the slope limit (the rays' own rounding), metres. */
const SLOPE_SLACK = 0.001;
/** `climb.grabSweep`: a frame's rise or fall past this is no frame's (the feet were last seen before a hold or a move), metres. */
const SWEEP_MOST = 0.6;
/** Item 7: once looking away, the look ends only a little under its threshold (ours: 5 degrees), so a hand never flutters at it. */
const LOOK_BACK = (5 * Math.PI) / 180;
/** Item 7: the leading hand's reach toward the view, from its place on the lip: out along the view and down from the lip, metres on the human male (ours: about the shoulder's height, an arm out). */
const LOOK_OUT = 0.6;
const LOOK_DOWN = 0.4;
const BAND_DEPTHS = 20;
const BAND_CAP = 256;
/** A hang's place pushed out where it meets something: along the lip's way out, then that way turned by these (cosine, sine pairs). */
const ROOM_TURNS: readonly number[] = [1, 0, Math.cos(0.52), Math.sin(0.52), Math.cos(-0.52), Math.sin(-0.52), Math.cos(1.05), Math.sin(1.05), Math.cos(-1.05), Math.sin(-1.05)];

const TAU = Math.PI * 2;
/** A hand wholly put on the lip within this of it as the clip has it, let go of from this far off (metres). */
const HAND_NEAR = 0.1;
/** How far behind a face's line the ray down onto its top is cast, metres: near enough the edge that a sloped top reads the lip's own height. */
const TOP_IN = 0.05;
const HAND_FAR = 0.3;
/**
 * A hop's hands on a lip by its share done (ours, a share of the clip rather than a measurement of it: the first sixth on
 * the lip it leaves, the last sixth on the one it takes): wholly placed only at the two ends, so the arms are never
 * pulled to a lip they are flying past.
 */
function hopHands(u: number): number {
  return u < 1 / 6 || u > 5 / 6 ? 1 : 0;
}
const gripV = new THREE.Vector3();
/** A body's place handed to a line-up at a one-off's start (an event, never a frame's). */
const gripAt = { x: 0, y: 0, z: 0 };
const anchorV = new THREE.Vector3();
const anchorD = new THREE.Vector3();
/** What the hands' anchor moves the body past an arm's whole length, metres: a millimetre, so the solve meets its target. */
const REACH_SPARE = 0.001;
const anchorP = new THREE.Vector3();
const anchorM = new THREE.Matrix4();

/** A clip's grip over its own feet at its start (its hands' height less how high its ankles stand over its ground), human male metres. */
function hangOver(f: LedgeClipFacts): number {
  return f.g0[1] - (f.a0 - LEDGE_REST.ankle);
}
/** The braced idle's grip over its own feet (`hangOver`), worked out once: a step down's end looks this deep (with `gripDrop`). */
const HANG_OVER_BRACED = hangOver(LEDGE_FACTS[LEDGE_ROLES.braced.idle]);

export class LedgeHang {
  /** `LEDGE_NONE`, `LEDGE_HANG` or `LEDGE_MOVE`. */
  phase = LEDGE_NONE;
  braced = false;
  /** The lip held (or aimed at, through a move). */
  readonly lip = new Lip();
  /** The heading the figure faces the wall at, radians. */
  heading = 0.5;
  /** -1 shimmying right, +1 left, 0 still. */
  shimmy = 0;
  /** The hang's loop for the rig (and the wire): '' while holding nothing. */
  rigState = '';
  /** The loop's clip id, for the rig's `prefer`. */
  rigClip = '';
  /** A one-off to begin this frame ('' for none), from this far in, faded in over `startFade`. Consumed by the caller. */
  startClip = '';
  startFrom = 0.5;
  startFade = 0.5;
  /** Where the figure's own origin is drawn against the body's, in the world's frame (metres). */
  offX = 0.5;
  offY = 0.5;
  offZ = 0.5;
  /** The hands' line on the lip: a point on it (the grip's height, out from the face) and its direction (level, unit, toward the figure's left). */
  lineX = 0.5;
  lineY = 0.5;
  lineZ = 0.5;
  lineTx = 0.5;
  lineTz = 0.5;
  /** How the line rises a metre along it (a sloping lip's: each hand grips the lip at its own height under it). */
  lineSlope = 0.5;
  /** How much the hands are placed on the line, and the feet on the wall (braced), each 0 to 1, eased. */
  hands = 0.5;
  feet = 0.5;
  /** Words for the message line (a refusal), or '' (consumed by the caller). */
  said = '';
  /** A heading the caller turns the body to once `turnIn` runs out (the jump off's own turn round in its clip), NaN for none. */
  turnTo = Number.NaN;
  turnIn = 0.5;
  /** A drop's let-go clip plays this long more before the falling loop takes the body (the caller cuts it). */
  cutIn = 0.5;
  /** After a climb up: kept crouched until a standing capsule fits (`standRoom`). */
  keepCrouched = false;
  /** A one-off ended this frame (the caller fades the rig's held last frame into the loop over `climb.ease`), and the body stands on a top (grounded). */
  ended = false;
  stood = false;
  /** Rays and shape tests asked of the engine, and grabs, refusals and let-goes (the console's and the tests'). */
  casts = 0;
  grabs = 0;
  lastLetGo = '';
  readonly move = new Move();
  private readonly hit = new Hit();
  private readonly cand = new Lip();
  private readonly found = new Lip();
  private ray: RAPIER.Ray | null = null;
  private shapeStand: RAPIER.Shape | null = null;
  private shapeCrouch: RAPIER.Shape | null = null;
  private readonly makers: LedgeMakers;
  private readonly shapeAt = { x: 0, y: 0, z: 0 };
  private readonly shapeRot = { x: 0, y: 0, z: 0, w: 1 };
  /** The last lip let go of (its edge), and how long more it is not grabbed again. */
  private regrabX = 0.5;
  private regrabY = 0.5;
  private regrabZ = 0.5;
  private regrabT = 0.5;
  /** The figure's offset eased between clips: where it was as the clip changed, and how far the fade has got. */
  private ofX = 0.5;
  private ofY = 0.5;
  private ofZ = 0.5;
  private fadeT = 0.5;
  private fadeDur = 0.5;
  /** The hang place's own scale (the figure's), kept from the grab. */
  private s = 0.5;
  /** Reach of the hands' tests this frame, the probes' place and direction (fields, so nothing crosses a call). */
  private qx = 0.5;
  private qy = 0.5;
  private qz = 0.5;
  private qdx = 0.5;
  private qdy = 0.5;
  private qdz = 0.5;
  private qlen = 0.5;
  private qflt = 0.5;
  /** The hang place worked out last (`placeFor`). */
  private bx = 0.5;
  private by = 0.5;
  private bz = 0.5;
  /**
   * The lip held, sampled along its own edge (the fix round's: corners, curves and slopes, `Rail`), and where on it the
   * body hangs (its arc: the two hands' middle at their rest spacing, `bodyOn`). Another kept rail is a hop's look along the
   * lip (`walk`), so a hop that finds nothing leaves the held one as it was.
   */
  readonly rail = new Rail();
  private readonly walk = new Rail();
  barc = 0.5;
  /** The figure's turn about its own front with a sloping lip (radians, its left side up for a positive), eased: `lipTilt` of the slope. */
  tilt = 0.5;
  private tiltGoal = 0.5;
  /** The lip probe's ask (a point on the face's line, a height to look from, the face's way, how far up and down, how near the way) and answer. */
  private fpx = 0.5;
  private fpz = 0.5;
  private fref = 0.5;
  private frise = 0.5;
  private ffall = 0.5;
  private fnx = 0.5;
  private fnz = 0.5;
  private facc = 0.5;
  private fox = 0.5;
  private foy = 0.5;
  private foz = 0.5;
  private fonx = 0.5;
  private fonz = 0.5;
  private fotop = 0.5;
  /** A follower's step rounded a corner: its point (the gap a hop looks across starts there). */
  private cornerX = 0.5;
  private cornerY = 0.5;
  private cornerZ = 0.5;
  private cornered = false;
  /** While a climb carries the body over the top on its last leg, its capsule is the crouched one (the caller wears it). */
  crouchedNow = false;
  /**
   * Climbing II, item 7 (maker B, `climb.lookAway` 'reach'): braced and still, looking away. `lookSide` the leading hand's
   * side (+1 the left, -1 the right, nought none), `look` how far in it has eased (0 to 1), `lookTwistNow` the spine's turn
   * toward the view this frame (radians, positive to the left: the caller's `twistTorso`), `poseClip` the leading side's hop
   * clip held as the reach-back pose (`poseAt` seconds in; '' for none: the caller plays and stops it), and the view's level
   * way in the world (`lookDx`, `lookDz`), which the leading hand reaches along and a hop behind looks along.
   */
  lookSide = 0;
  look = 0.5;
  lookTwistNow = 0.5;
  poseClip = '';
  poseAt = 0.5;
  lookDx = 0.5;
  lookDz = 0.5;
  /** Hops behind begun and refused (the console's and the tests'). */
  behindHops = 0;
  /** `climb.grabSweep`: the feet's height at the last `sense` (NaN while something holds the body): the frame's rise or fall, which the reach band is swept over. */
  private seenY = 0.5;
  /**
   * The feedback round, item 1 (`climb.grabFree` 'share'): the jump, forward and crouch presses made during a grab before it
   * hands the hang the keys, kept for that frame (put down as the grab ends).
   */
  private pendJump = false;
  private pendForward = false;
  private pendCrouch = false;
  /** The move keys held as the kept jump was pressed (its way: a side, W or S with it). */
  private pendLeft = false;
  private pendRight = false;
  private pendFwd = false;
  private pendBack = false;
  /** Grabs that handed the hang the keys before their clip was done (the console's and the tests'). */
  grabsFreed = 0;
  /**
   * The feedback round, item 2: names a collider the climb up's room tests met (the game's: a placed thing's template, the
   * test course's solid, the ground, a planting), or null where it knows none (then its kind by its collision groups). Asked
   * only as a climb up is refused.
   */
  namer: ((c: RAPIER.Collider) => string | null) | null = null;
  /** What the last climb up's room tests found (`RoomReport`). */
  readonly room = new RoomReport();
  /** The collider the last shape test met (null for none): a refusal names it. */
  private met: RAPIER.Collider | null = null;
  /** The room tests' brush (`climb.roomBrush` on a short climb's last tries; nought otherwise) and the capsules shrunk by it. */
  private brushNow = 0.5;
  private brushOf = 0.5;
  private shapeStandB: RAPIER.Shape | null = null;
  private shapeCrouchB: RAPIER.Shape | null = null;
  /** `pathClear` may tuck the climb crouched where standing meets something on the way up (the feedback round's 'fit'). */
  private tuckOk = false;
  /** Climbs up made short by `climb.roomRule` 'fit' (the console's and the tests'). */
  climbsShort = 0;

  constructor(makers: LedgeMakers) {
    this.makers = makers;
    this.barc = 0;
    this.tilt = 0;
    this.tiltGoal = 0;
    this.tiltLift = 0;
    this.fpx = 0;
    this.fpz = 0;
    this.fref = 0;
    this.frise = 0;
    this.ffall = 0;
    this.fnx = 0;
    this.fnz = 0;
    this.facc = 0;
    this.fox = 0;
    this.foy = 0;
    this.foz = 0;
    this.fonx = 0;
    this.fonz = 0;
    this.fotop = 0;
    this.cornerX = 0;
    this.cornerY = 0;
    this.cornerZ = 0;
    this.lineSlope = 0;
    this.look = 0;
    this.lookTwistNow = 0;
    this.poseAt = 0;
    this.lookDx = 0;
    this.lookDz = 0;
    this.seenY = Number.NaN;
    this.brushNow = 0;
    this.brushOf = -1;
    // Fields that will hold fractions start as one (wave 2a's lesson) and are put to nought here.
    this.dtNow = 0;
    this.goalHands = 0;
    this.goalFeet = 0;
    this.lifted = 0;
    this.heading = 0;
    this.startFrom = 0;
    this.startFade = 0;
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.lineX = 0;
    this.lineY = 0;
    this.lineZ = 0;
    this.lineTx = 1;
    this.lineTz = 0;
    this.hands = 0;
    this.feet = 0;
    this.turnIn = 0;
    this.cutIn = 0;
    this.regrabT = 0;
    this.ofX = 0;
    this.ofY = 0;
    this.ofZ = 0;
    this.fadeT = 1;
    this.fadeDur = 0;
    this.s = 1;
  }

  /** Something holds the body (a hang, or a one-off carrying it). */
  get holding(): boolean {
    return this.phase !== LEDGE_NONE;
  }

  /** Let go of everything at once, with no fall of its own (a reset, a travel, a death): `why` for the console. */
  reset(why = 'reset'): void {
    this.release(why);
    this.offX = 0;
    this.offY = 0;
    this.offZ = 0;
    this.tilt = 0;
    this.tiltGoal = 0;
    this.outT = 0;
    this.turnTo = Number.NaN;
    this.cutIn = 0;
    this.keepCrouched = false;
  }

  /** The hold given up, the drawn offset left where it is (a let-go eases it out, `tick`). */
  private release(why: string): void {
    if (this.phase !== LEDGE_NONE) this.lastLetGo = why;
    this.phase = LEDGE_NONE;
    this.crouchedNow = false;
    this.fromClimb = false;
    this.shimmy = 0;
    this.rigState = '';
    this.rigClip = '';
    this.startClip = '';
    this.hands = 0;
    this.feet = 0;
    this.fadeT = 1;
    this.fadeDur = 0;
    // Climbing II, item 7: the look-away let go of with the hold (the spine's turn eased out by `tick`).
    this.lookSide = 0;
    this.look = 0;
    this.poseClip = '';
    this.seenY = Number.NaN;
    this.pendJump = false;
    this.pendForward = false;
    this.pendCrouch = false;
  }

  /** After a let-go the drawn offset eases out over this long more (seconds left, and the whole). */
  private outT = 0.5;
  private outDur = 0.5;

  /** The drawn figure is still off the body's place (holding, or easing out after a let-go). */
  get offset(): boolean {
    return this.offX !== 0 || this.offY !== 0 || this.offZ !== 0;
  }

  // ---- the engine's two questions ------------------------------------------------------------------------------------------

  /** One ray from (q) along (qd) for `qlen`, into `hit` (the still family only). */
  private cast(world: LedgeWorld): boolean {
    let ray = this.ray;
    if (!ray) ray = this.ray = this.makers.ray();
    ray.origin.x = this.qx;
    ray.origin.y = this.qy;
    ray.origin.z = this.qz;
    ray.dir.x = this.qdx;
    ray.dir.y = this.qdy;
    ray.dir.z = this.qdz;
    this.casts++;
    const h = world.castRayAndGetNormal(ray, this.qlen, true, STILL_FLAGS, this.qflt);
    const o = this.hit;
    if (!h) {
      o.hit = false;
      return false;
    }
    o.hit = true;
    o.toi = h.timeOfImpact;
    o.x = this.qx + this.qdx * o.toi;
    o.y = this.qy + this.qdy * o.toi;
    o.z = this.qz + this.qdz * o.toi;
    o.nx = h.normal.x;
    o.ny = h.normal.y;
    o.nz = h.normal.z;
    return true;
  }

  /** Whether a capsule (crouched or standing) with its feet at (q) is clear of what stands still. */
  private clear(world: LedgeWorld, crouched: boolean): boolean {
    const half = crouched ? LEDGE_CAPSULE.crouch : LEDGE_CAPSULE.stand;
    let shape = crouched ? this.shapeCrouch : this.shapeStand;
    if (!shape) {
      shape = this.makers.capsule(half, LEDGE_CAPSULE.r);
      if (crouched) this.shapeCrouch = shape;
      else this.shapeStand = shape;
    }
    // The feedback round's brush (a short climb's last tries only): the capsule a brush thinner all round, about the same middle.
    if (this.brushNow > 0) shape = this.brushShape(crouched);
    const at = this.shapeAt;
    at.x = this.qx;
    at.y = this.qy + LEDGE_CAPSULE.r + half;
    at.z = this.qz;
    this.casts++;
    const c = world.intersectionWithShape(at, this.shapeRot, shape, STILL_FLAGS, this.qflt);
    this.met = c;
    return c === null;
  }

  /** The capsule shrunk all round by `brushNow` (made again only when the brush moves: an event, a climb up's). */
  private brushShape(crouched: boolean): RAPIER.Shape {
    if (this.brushOf !== this.brushNow) {
      this.brushOf = this.brushNow;
      const r = LEDGE_CAPSULE.r - this.brushNow;
      const k = r > 0.05 ? r : 0.05;
      this.shapeStandB = this.makers.capsule(LEDGE_CAPSULE.stand, k);
      this.shapeCrouchB = this.makers.capsule(LEDGE_CAPSULE.crouch, k);
    }
    return (crouched ? this.shapeCrouchB : this.shapeStandB) as RAPIER.Shape;
  }

  // ---- the lip along its own edge (the fix round's) --------------------------------------------------------------------------

  /**
   * A lip at a point on a face's line (`fpx`, `fpz`) with the face looking along (`fnx`, `fnz`): its top found from `frise`
   * over `fref` down to `ffall` under it, a little behind the face's line, and the face just under that top from out in
   * front, turned from the way asked by no more than `facc` (a cosine). Into `fo*`. Two rays. Refused where a ray starts
   * inside what it meets (a taller block: no lip there), or the top is too steep to stand on, or the face is walkable.
   */
  private probeLip(world: LedgeWorld): boolean {
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    const nx = this.fnx;
    const nz = this.fnz;
    this.qx = this.fpx - nx * TOP_IN;
    this.qy = this.fref + this.frise;
    this.qz = this.fpz - nz * TOP_IN;
    this.qdx = 0;
    this.qdy = -1;
    this.qdz = 0;
    this.qlen = this.frise + this.ffall;
    if (!this.cast(world)) return false;
    const h = this.hit;
    if (h.toi < 1e-4 || h.ny < walk) return false;
    const topY = h.y;
    const topNy = h.ny;
    this.qx = this.fpx + nx * 0.5;
    this.qy = topY - 0.06;
    this.qz = this.fpz + nz * 0.5;
    this.qdx = -nx;
    this.qdy = 0;
    this.qdz = -nz;
    this.qlen = 0.85;
    if (!this.cast(world)) return false;
    if (h.toi < 1e-4 || h.ny >= walk) return false;
    let mx = h.nx;
    let mz = h.nz;
    const ml = Math.sqrt(mx * mx + mz * mz);
    if (!(ml > 1e-6)) return false;
    mx /= ml;
    mz /= ml;
    if (mx * nx + mz * nz < this.facc) return false;
    // The face must stand where the top was found over it (the top a little behind its line): a face further out is another
    // thing's (a block standing beyond a wall's end, rising past it), and no lip of this top.
    const back = (h.x - this.fpx + nx * TOP_IN) * mx + (h.z - this.fpz + nz * TOP_IN) * mz;
    if (back < -0.02 || back > TOP_IN + 0.1) return false;
    this.fox = h.x;
    this.foy = topY;
    this.foz = h.z;
    this.fonx = mx;
    this.fonz = mz;
    this.fotop = topNy;
    return true;
  }

  /** The probe's answer pushed onto a rail's end (`hi`), its arc the level length on from that end's point. */
  private pushFound(R: Rail, hi: boolean): void {
    const k = hi ? R.n - 1 : 0;
    const dx = this.fox - R.x[k];
    const dz = this.foz - R.z[k];
    const d = Math.sqrt(dx * dx + dz * dz);
    R.pa = R.a[k] + (hi ? d : -d);
    R.px = this.fox;
    R.py = this.foy;
    R.pz = this.foz;
    R.pnx = this.fonx;
    R.pnz = this.fonz;
    R.ptop = this.fotop;
    if (hi) R.pushHi();
    else R.pushLo();
  }

  /**
   * One step of a rail on along the lip's own edge from its end (`hi`: toward the figure's left, else its right), `RAIL_STEP`
   * on: straight on where the lip goes on (its face turning a little a step where it curves), round an inner corner where a
   * face stands across the way with a lip of its own, round an outer corner where the top ends (the corner itself put on the
   * rail, the face beyond found at the turn that fits). False where none does: that end is the lip's own (`loEnd`/`hiEnd`).
   * Two to a dozen rays; an inner corner three to five, an outer one up to fourteen.
   */
  private followStep(world: LedgeWorld, R: Rail, hi: boolean): boolean {
    if (hi ? R.hiEnd : R.loEnd) return false;
    this.cornered = false;
    const k = hi ? R.n - 1 : 0;
    const px = R.x[k];
    const py = R.y[k];
    const pz = R.z[k];
    const nx = hi ? R.hiNx : R.loNx;
    const nz = hi ? R.hiNz : R.loNz;
    const tau = hi ? 1 : -1;
    const tx = -nz * tau;
    const tz = nx * tau;
    const d = RAIL_STEP;
    const reach = d * Math.tan((RAIL_STEEPEST * Math.PI) / 180) + 0.05;
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    // Climbing II, item 5: a step up or down along the lip within `stepMax`, crossed hand by hand (its two points, the
    // segment between them marked a step). Asked first: a step up is otherwise a face across the way (an inner corner's
    // end) and a step down the top's end (round its side).
    if (CLIMB_TUNE.steps === 'hands') {
      this.skx = px;
      this.sky = py;
      this.skz = pz;
      this.sknx = nx;
      this.sknz = nz;
      this.sktx = tx;
      this.sktz = tz;
      if (this.stepAlong(world, R, hi)) return true;
    }
    // An inner corner: a face standing across the way just under the top, within the step.
    this.qx = px + nx * 0.05;
    this.qy = py - 0.06;
    this.qz = pz + nz * 0.05;
    this.qdx = tx;
    this.qdy = 0;
    this.qdz = tz;
    this.qlen = d + 0.05;
    if (this.cast(world)) {
      const h = this.hit;
      let mx = h.nx;
      let mz = h.nz;
      const ml = Math.sqrt(mx * mx + mz * mz);
      if (h.toi > 1e-4 && h.ny < walk && ml > 1e-6 && (mx * tx + mz * tz) / ml < -0.5) {
        mx /= ml;
        mz /= ml;
        // The corner on the old face's line; the new lip from it along the new face, the old face's own way out.
        const t = h.toi;
        const cx = px + tx * t;
        const cz = pz + tz * t;
        const ntx = -mz * tau;
        const ntz = mx * tau;
        // `climb.corners` 'ramp': the new lip's first point the ramp's span past the corner, wherever the rail's step fell.
        const ramp = CLIMB_TUNE.corners === 'ramp';
        const on = ramp ? CORNER_RAMP : Math.max(d - t, 0.03);
        this.fpx = cx + ntx * on;
        this.fpz = cz + ntz * on;
        this.fref = py;
        this.frise = reach;
        this.ffall = reach;
        this.fnx = mx;
        this.fnz = mz;
        this.facc = CORNER_COS;
        if (!this.probeLip(world)) {
          if (hi) R.hiEnd = true;
          else R.loEnd = true;
          return false;
        }
        this.ckx = cx;
        this.cky = py;
        this.ckz = cz;
        // `climb.corners` 'ramp': the old face's own way held to the corner (the turn begins there and nowhere before it).
        this.cknx = ramp ? nx : nx + mx;
        this.cknz = ramp ? nz : nz + mz;
        this.cktop = R.top[k];
        this.cornerPoint(R, hi);
        this.pushFound(R, hi);
        this.turnEnd(R, hi);
        return true;
      }
    }
    // Straight on along the lip (a curve's face a little turned).
    this.fpx = px + tx * d;
    this.fpz = pz + tz * d;
    this.fref = py;
    this.frise = reach;
    this.ffall = reach;
    this.fnx = nx;
    this.fnz = nz;
    this.facc = CURVE_COS;
    if (this.probeLip(world)) {
      this.pushFound(R, hi);
      this.turnEnd(R, hi);
      return true;
    }
    // An outer corner: where the top stops along the way (halved four times, to 6 mm), and the face beyond it.
    let lo = 0;
    let up = d;
    let had = false;
    // `climb.corners` 'ramp': the corner found to under a millimetre (eight halvings), its ramp the same span either side.
    const ramp = CLIMB_TUNE.corners === 'ramp';
    const halvings = ramp ? 8 : 4;
    for (let i = 0; i < halvings; i++) {
      const u = (lo + up) * 0.5;
      this.qx = px + tx * u - nx * TOP_IN;
      this.qy = py + reach;
      this.qz = pz + tz * u - nz * TOP_IN;
      this.qdx = 0;
      this.qdy = -1;
      this.qdz = 0;
      this.qlen = reach * 2;
      if (this.cast(world) && this.hit.toi > 1e-4 && this.hit.ny >= walk) {
        lo = u;
        had = true;
      } else up = u;
    }
    void had;
    const cx = px + tx * lo;
    const cz = pz + tz * lo;
    // Climbing II, item 5 (the fixer): a step down past `stepMax` is the lip's end. Just past the top's end, behind the old
    // face's line, a walkable top lower than the most and within the braced hang's own depth: the lower step (or whatever
    // stands there that high), where the body hanging round the corner would stand, so no corner is followed (`steps`
    // 'before': round the step's side, as phase 1 found).
    if (CLIMB_TUNE.steps === 'hands') {
      const sc = this.s;
      const most = CLIMB_TUNE.stepMax * sc + STEP_SLACK;
      const deep = (CLIMB_TUNE.gripDrop + HANG_OVER_BRACED) * sc;
      const ux = cx + tx * STEP_END_PAST;
      const uz = cz + tz * STEP_END_PAST;
      this.qx = ux - nx * TOP_IN;
      this.qy = py + 0.02;
      this.qz = uz - nz * TOP_IN;
      this.qdx = 0;
      this.qdy = -1;
      this.qdz = 0;
      this.qlen = deep + 0.02;
      if (this.cast(world) && this.hit.toi > most + 0.02 && this.hit.ny >= walk) {
        if (hi) R.hiEnd = true;
        else R.loEnd = true;
        return false;
      }
    }
    const on = ramp ? CORNER_RAMP : Math.max(d - lo, 0.03);
    const turns = CORNER_TURNS;
    for (let j = 0; j < turns.length; j++) {
      const c = Math.cos(turns[j]);
      const s = Math.sin(turns[j]);
      // The face beyond the corner looks between this one's way and the way along (turned toward it), and its lip goes on
      // from the corner away from this face.
      const qnx = nx * c + tx * s;
      const qnz = nz * c + tz * s;
      const qtx = tx * c - nx * s;
      const qtz = tz * c - nz * s;
      this.fpx = cx + qtx * on;
      this.fpz = cz + qtz * on;
      this.fref = py;
      this.frise = reach;
      this.ffall = reach;
      this.fnx = qnx;
      this.fnz = qnz;
      this.facc = CORNER_COS;
      if (!this.probeLip(world)) continue;
      this.ckx = cx;
      this.cky = py;
      this.ckz = cz;
      this.cknx = ramp ? nx : nx + this.fonx;
      this.cknz = ramp ? nz : nz + this.fonz;
      this.cktop = R.top[k];
      this.cornerPoint(R, hi);
      this.pushFound(R, hi);
      this.turnEnd(R, hi);
      return true;
    }
    if (hi) R.hiEnd = true;
    else R.loEnd = true;
    return false;
  }

  /** A corner's own point (`ck*`: its place, the two faces' normals summed, its top) onto a rail's end, kept for a hop's look (`corner*`). */
  private ckx = 0.5;
  private cky = 0.5;
  private ckz = 0.5;
  private cknx = 0.5;
  private cknz = 0.5;
  private cktop = 0.5;
  private cornerPoint(R: Rail, hi: boolean): void {
    const x = this.ckx;
    const y = this.cky;
    const z = this.ckz;
    const nx = this.cknx;
    const nz = this.cknz;
    const top = this.cktop;
    const l = Math.sqrt(nx * nx + nz * nz);
    const k = hi ? R.n - 1 : 0;
    const dx = x - R.x[k];
    const dz = z - R.z[k];
    const dd = Math.sqrt(dx * dx + dz * dz);
    R.pa = R.a[k] + (hi ? dd : -dd);
    R.px = x;
    R.py = y;
    R.pz = z;
    R.pnx = l > 1e-6 ? nx / l : R.nx[k];
    R.pnz = l > 1e-6 ? nz / l : R.nz[k];
    R.ptop = top;
    if (hi) R.pushHi();
    else R.pushLo();
    this.cornered = true;
    this.cornerX = x;
    this.cornerY = y;
    this.cornerZ = z;
  }

  /** A rail's end goes on along the face it reached (the probe's answer's). */
  private turnEnd(R: Rail, hi: boolean): void {
    if (hi) {
      R.hiNx = this.fonx;
      R.hiNz = this.fonz;
    } else {
      R.loNx = this.fonx;
      R.loNz = this.fonz;
    }
  }

  /** A step's ask (`followStep`'s end point, its face's way out and the way along), fields so no number crosses a call. */
  private skx = 0.5;
  private sky = 0.5;
  private skz = 0.5;
  private sknx = 0.5;
  private sknz = 0.5;
  private sktx = 0.5;
  private sktz = 0.5;

  /**
   * Climbing II, item 5: a step along the lip from a rail's end (`sk*`), up or down by more than the slope limit allows over
   * a rail step and no more than `climb.stepMax`, its face on the same line, and the lip level again a step past it (a step,
   * not a steep slope, which stays the shimmy's stop). Where it is (halved four times, to 6 mm), the near level's last point
   * and the far level's first are pushed, the segment between them marked a step. Two to three probes and four rays.
   */
  private stepAlong(world: LedgeWorld, R: Rail, hi: boolean): boolean {
    const T = CLIMB_TUNE;
    const s = this.s;
    // The most, and a centimetre for the rays' own rounding (a step of exactly the most is crossed).
    const most = T.stepMax * s + STEP_SLACK;
    if (!(most > STEP_SLACK)) return false;
    const px = this.skx;
    const py = this.sky;
    const pz = this.skz;
    const nx = this.sknx;
    const nz = this.sknz;
    const tx = this.sktx;
    const tz = this.sktz;
    const flat = Math.tan((T.lipSlope * Math.PI) / 180) * RAIL_STEP + 0.005;
    // The lip a rail step on, at any height within the step's most.
    this.fpx = px + tx * RAIL_STEP;
    this.fpz = pz + tz * RAIL_STEP;
    this.fref = py;
    this.frise = most + 0.05;
    this.ffall = most + 0.05;
    this.fnx = nx;
    this.fnz = nz;
    this.facc = CURVE_COS;
    if (!this.probeLip(world)) return false;
    const y1 = this.foy;
    const dy = y1 - py;
    if ((dy <= flat && dy >= -flat) || dy > most || -dy > most) return false;
    const fnx1 = this.fonx;
    const fnz1 = this.fonz;
    const top1 = this.fotop;
    // Level again a step past it: a step, not a steep slope.
    this.fpx = px + tx * 2 * RAIL_STEP;
    this.fpz = pz + tz * 2 * RAIL_STEP;
    this.fref = y1;
    this.frise = flat + 0.02;
    this.ffall = flat + 0.02;
    if (!this.probeLip(world)) return false;
    if (this.foy - y1 > flat || y1 - this.foy > flat) return false;
    // Where along the way the top changes height: down onto it from over both levels, halved ten times (a tenth of a
    // millimetre, so no hand's place falls between the two levels on any frame).
    let lo = 0;
    let up = RAIL_STEP;
    const yTop = (py > y1 ? py : y1) + 0.05;
    for (let k = 0; k < 10; k++) {
      const u = (lo + up) * 0.5;
      this.qx = px + tx * u - nx * TOP_IN;
      this.qy = yTop;
      this.qz = pz + tz * u - nz * TOP_IN;
      this.qdx = 0;
      this.qdy = -1;
      this.qdz = 0;
      this.qlen = most + 0.2;
      const near = this.cast(world) && (this.hit.y - py) * (this.hit.y - py) < (this.hit.y - y1) * (this.hit.y - y1);
      if (near) lo = u;
      else up = u;
    }
    const k = hi ? R.n - 1 : 0;
    const a0 = R.a[k];
    const t0 = R.top[k];
    // The near level's last point (left out where the step stands at the rail's end already).
    if (lo > 0.002) {
      R.pa = a0 + (hi ? lo : -lo);
      R.px = px + tx * lo;
      R.py = py;
      R.pz = pz + tz * lo;
      R.pnx = nx;
      R.pnz = nz;
      R.ptop = t0;
      R.pstep = 0;
      if (hi) R.pushHi();
      else R.pushLo();
    }
    // The far level's first, the segment to it a step.
    R.pa = a0 + (hi ? up : -up);
    R.px = px + tx * up;
    R.py = y1;
    R.pz = pz + tz * up;
    R.pnx = fnx1;
    R.pnz = fnz1;
    R.ptop = top1;
    R.pstep = 1;
    if (hi) R.pushHi();
    else R.pushLo();
    this.fonx = fnx1;
    this.fonz = fnz1;
    this.turnEnd(R, hi);
    return true;
  }

  /** The rail on that way (`hi`) until it reaches arc `need` (a field) or its end, a few steps a call at most. */
  private need = 0.5;
  private railReach(world: LedgeWorld, hi: boolean): void {
    const R = this.rail;
    for (let it = 0; it < 8; it++) {
      if (R.n === 0) return;
      if (hi ? R.a[R.n - 1] >= this.need : R.a[0] <= this.need) return;
      if (!this.followStep(world, R, hi)) return;
    }
  }

  /** The hands' rest half span of the hang's kind, metres (the idle's own, scaled), into `hh`. */
  private hh = 0.5;
  private handHalf(braced: boolean): void {
    const f = braced ? LEDGE_FACTS[LEDGE_ROLES.braced.idle] : LEDGE_FACTS[LEDGE_ROLES.free.idle];
    this.hh = Math.abs(f.span0) * 0.5 * this.s;
  }

  /**
   * The lip a body hangs from at arc `bq` of the rail: the two hands' places at their rest spacing either side, their middle
   * the edge, their normals' mean its way, the left's height less the right's over their level distance its slope. Into
   * `out`.
   */
  private bq = 0.5;
  private bodyOn(out: Lip): void {
    const R = this.rail;
    const q = this.bq;
    this.handHalf(this.braced);
    const half = this.hh;
    R.q = q + half;
    R.sample();
    const lx = R.sx;
    const ly = R.sy;
    const lz = R.sz;
    const lnx = R.snx;
    const lnz = R.snz;
    const ltop = R.stop;
    R.q = q - half;
    R.sample();
    let nx = lnx + R.snx;
    let nz = lnz + R.snz;
    const nl = Math.sqrt(nx * nx + nz * nz);
    if (nl > 1e-6) {
      nx /= nl;
      nz /= nl;
    } else {
      nx = lnx;
      nz = lnz;
    }
    out.ex = (lx + R.sx) * 0.5;
    out.ey = (ly + R.sy) * 0.5;
    out.ez = (lz + R.sz) * 0.5;
    out.nx = nx;
    out.nz = nz;
    out.topNy = (ltop + R.stop) * 0.5;
    const dx = lx - R.sx;
    const dz = lz - R.sz;
    const dl = Math.sqrt(dx * dx + dz * dz);
    out.slope = dl > 1e-6 ? (ly - R.sy) / dl : 0;
  }

  /** The rail begun again at the lip held (a hang begun), on far enough both ways that both hands and a hand's width more are on it. */
  private railStart(world: LedgeWorld): void {
    this.rail.start(this.lip);
    this.barc = 0;
    this.handHalf(this.braced);
    const reach = this.hh + (CLIMB_TUNE.edgeAhead + RAIL_STEP) * this.s;
    this.need = reach;
    this.railReach(world, true);
    this.need = -reach;
    this.railReach(world, false);
    this.bq = 0;
    this.bodyOn(this.lip);
    this.tiltGoal = Math.atan(this.lip.slope) * CLIMB_TUNE.lipTilt;
  }

  /** How the lip `L` slopes under the two hands (two probes along it, either side): into its `slope` (nought where either is not found). */
  private measureSlope(world: LedgeWorld, L: Lip, flt: number): void {
    this.handHalf(true);
    const half = this.hh;
    const reach = half * Math.tan((RAIL_STEEPEST * Math.PI) / 180) + 0.05;
    this.qflt = flt;
    this.fnx = L.nx;
    this.fnz = L.nz;
    this.fref = L.ey;
    this.frise = reach;
    this.ffall = reach;
    this.facc = CORNER_COS;
    this.fpx = L.ex - L.nz * half;
    this.fpz = L.ez + L.nx * half;
    L.slope = 0;
    if (!this.probeLip(world)) return;
    const ly = this.foy;
    const lx = this.fox;
    const lz = this.foz;
    this.fpx = L.ex + L.nz * half;
    this.fpz = L.ez - L.nx * half;
    if (!this.probeLip(world)) return;
    const dx = lx - this.fox;
    const dz = lz - this.foz;
    const dl = Math.sqrt(dx * dx + dz * dz);
    L.slope = dl > 1e-6 ? (ly - this.foy) / dl : 0;
  }

  /**
   * Whether the capsule (crouched or standing) is clear of what stands still all along the path from (`f`) through the
   * move's path to (`t`): one shape test every `PATH_EVERY` of it (the start, where the body already stands, left out).
   * The move's own path fields are read (`path`, its middle point, its legs); a climb's last leg asks the crouched one.
   */
  private pathClear(world: LedgeWorld): boolean {
    const m = this.move;
    const len = m.path === PATH_LEGS ? m.l1 + m.l2 + m.l3 : this.pathLength();
    const n = Math.max(1, Math.ceil(len / PATH_EVERY));
    for (let k = 1; k <= n; k++) {
      this.pu = k / n;
      this.pathAt();
      this.qx = this.pqx;
      // A skin over the feet (a climb ends standing on the top: touching it is no want of room).
      this.qy = this.pqy + CLIMB_SKIN;
      this.qz = this.pqz;
      if (this.clear(world, this.pathCrouched)) continue;
      // The feedback round ('fit', a climb up's): standing meets something on the way, so the body tucks crouched from here
      // on (the in-leg is crouched already), where a crouched one is clear.
      if (this.tuckOk && !this.pathCrouched) {
        const met = this.met;
        if (this.clear(world, true)) {
          m.crouchFrom = this.pu;
          continue;
        }
        this.met = met;
      }
      if (m.path === PATH_LEGS) this.notePath(this.pathCrouched);
      return false;
    }
    return true;
  }

  /** The feedback round: a climb up's path met something at `pu` (its first failure only, while a climb up is asked). */
  private notePath(crouched: boolean): void {
    const R = this.room;
    if (R.test !== '' || !this.noting) return;
    const m = this.move;
    const total = m.l1 + m.l2 + m.l3;
    const d = this.pu * total;
    R.test = 'path';
    if (d <= m.l1 && m.l1 > 1e-9) {
      R.leg = 'out';
      R.along = d / m.l1;
    } else if (d <= m.l1 + m.l2 && m.l2 > 1e-9) {
      R.leg = 'up';
      R.along = (d - m.l1) / m.l2;
    } else {
      R.leg = 'in';
      R.along = m.l3 > 1e-9 ? (d - m.l1 - m.l2) / m.l3 : 1;
    }
    this.noteMet(crouched);
  }

  /** The feedback round: the collider the last shape test met, and the capsule that met it, into the room report. */
  private noteMet(crouched: boolean): void {
    const R = this.room;
    const c = this.met;
    R.crouched = crouched;
    R.brush = this.brushNow;
    R.x = this.shapeAt.x;
    R.y = this.shapeAt.y;
    R.z = this.shapeAt.z;
    R.handle = c ? c.handle : -1;
    this.metCollider = c;
  }

  /** The room report's collider (kept until its words are worked out, the same event). */
  private metCollider: RAPIER.Collider | null = null;
  /** A climb up is being asked: its room tests' first failure goes into the report (`room`). */
  private noting = false;

  /** A path's length (a curve's, by eight chords). */
  private pathLength(): number {
    const m = this.move;
    if (m.path === PATH_LINE) {
      const dx = m.tx - m.fx;
      const dy = m.ty - m.fy;
      const dz = m.tz - m.fz;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    let len = 0;
    let x = m.fx;
    let y = m.fy;
    let z = m.fz;
    for (let k = 1; k <= 8; k++) {
      this.pu = k / 8;
      this.pathAt();
      const dx = this.pqx - x;
      const dy = this.pqy - y;
      const dz = this.pqz - z;
      len += Math.sqrt(dx * dx + dy * dy + dz * dz);
      x = this.pqx;
      y = this.pqy;
      z = this.pqz;
    }
    return len;
  }

  /** The body's place a share `pu` along the move's path into `pq*`, and whether the capsule there is the crouched one. */
  private pu = 0.5;
  private pqx = 0.5;
  private pqy = 0.5;
  private pqz = 0.5;
  private pathCrouched = false;
  private pathAt(): void {
    const m = this.move;
    const u = this.pu;
    this.pathCrouched = false;
    if (m.path === PATH_CURVE) {
      const a = (1 - u) * (1 - u);
      const b = 2 * u * (1 - u);
      const c = u * u;
      this.pqx = m.fx * a + m.cx * b + m.tx * c;
      this.pqy = m.fy * a + m.cy * b + m.ty * c;
      this.pqz = m.fz * a + m.cz * b + m.tz * c;
      return;
    }
    if (m.path === PATH_LEGS) {
      const total = m.l1 + m.l2 + m.l3;
      let d = u * total;
      // The feedback round ('fit'): tucked crouched from `crouchFrom` on (never, today's: more than one).
      const tuck = m.crouchFrom <= u;
      if (d <= m.l1 && m.l1 > 1e-9) {
        const k = d / m.l1;
        this.pqx = m.fx + (m.p1x - m.fx) * k;
        this.pqy = m.fy + (m.p1y - m.fy) * k;
        this.pqz = m.fz + (m.p1z - m.fz) * k;
        this.pathCrouched = tuck;
        return;
      }
      d -= m.l1;
      if (d <= m.l2 && m.l2 > 1e-9) {
        const k = d / m.l2;
        this.pqx = m.p1x + (m.p2x - m.p1x) * k;
        this.pqy = m.p1y + (m.p2y - m.p1y) * k;
        this.pqz = m.p1z + (m.p2z - m.p1z) * k;
        this.pathCrouched = tuck;
        return;
      }
      d -= m.l2;
      const k = m.l3 > 1e-9 ? Math.min(1, d / m.l3) : 1;
      this.pqx = m.p2x + (m.tx - m.p2x) * k;
      this.pqy = m.p2y + (m.ty - m.p2y) * k;
      this.pqz = m.p2z + (m.tz - m.p2z) * k;
      this.pathCrouched = d > 1e-9 || m.l2 <= 1e-9 || tuck;
      return;
    }
    this.pqx = m.fx + (m.tx - m.fx) * u;
    this.pqy = m.fy + (m.ty - m.fy) * u;
    this.pqz = m.fz + (m.tz - m.fz) * u;
  }

  // ---- finding a lip -------------------------------------------------------------------------------------------------------

  /**
   * A lip ahead of feet at (fx, fy, fz) along the level direction (dx, dz), whose top stands between `lo` and `hi` over the
   * feet (metres), into `out`. With `steepTop` a top too steep to stand on counts too (the grapple's haul's hand-over).
   * Three to four rays where there is one, one where there is no face at all.
   */
  private findLip(world: LedgeWorld, fx: number, fy: number, fz: number, dx: number, dz: number, lo: number, hi: number, ahead: number, flt: number, steepTop: boolean, out: Lip): boolean {
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    this.qflt = flt;
    // The face at the band's foot: no face there, no lip in the band (the wall ends under the hands, or there is none).
    this.qx = fx;
    this.qy = fy + lo;
    this.qz = fz;
    this.qdx = dx;
    this.qdy = 0;
    this.qdz = dz;
    this.qlen = ahead;
    if (!this.cast(world)) return false;
    const h = this.hit;
    if (h.ny >= walk || -(h.nx * dx + h.nz * dz) < 0.5) return false;
    const faceX = h.x;
    const faceZ = h.z;
    // Open over the band's head: a face there means the wall goes on past the reach.
    this.qy = fy + hi + 0.05;
    this.qlen = ahead + 0.3;
    if (this.cast(world)) return false;
    // The top: down onto it a little behind the face's line.
    this.qx = faceX + dx * TOP_IN;
    this.qy = fy + hi + 0.05;
    this.qz = faceZ + dz * TOP_IN;
    this.qdx = 0;
    this.qdy = -1;
    this.qdz = 0;
    this.qlen = hi - lo + 0.1;
    if (!this.cast(world)) return false;
    if (h.ny < (steepTop ? 0.2 : walk)) return false;
    const topY = h.y;
    const topNy = h.ny;
    // The face just under the top: where the edge stands, and which way it faces.
    this.qx = fx;
    this.qy = topY - 0.06;
    this.qz = fz;
    this.qdx = dx;
    this.qdy = 0;
    this.qdz = dz;
    this.qlen = ahead + 0.3;
    if (!this.cast(world)) return false;
    if (h.ny >= walk) return false;
    let nx = h.nx;
    let nz = h.nz;
    const nl = Math.sqrt(nx * nx + nz * nz);
    if (!(nl > 1e-6)) return false;
    nx /= nl;
    nz /= nl;
    if (-(nx * dx + nz * dz) < 0.5) return false;
    out.ex = h.x;
    out.ey = topY;
    out.ez = h.z;
    out.nx = nx;
    out.nz = nz;
    out.topNy = topNy;
    return true;
  }

  /**
   * The hang place under a lip for the hang's kind into `bx/by/bz`: the body's feet where the idle's own feet hang (so the
   * capsule is the hanging figure, and a let-go falls from where the figure is), out from the face by the idle's grip, and
   * pushed further out until a standing capsule is clear there; false where none is (a drop no deeper than a hang).
   */
  private placeFor(world: LedgeWorld, lip: Lip, braced: boolean, s: number, flt: number): boolean {
    const T = CLIMB_TUNE;
    const f = braced ? LEDGE_FACTS[LEDGE_ROLES.braced.idle] : LEDGE_FACTS[LEDGE_ROLES.free.idle];
    const out = (T.gripOut + f.g0[2]) * s;
    this.qflt = flt;
    for (let k = 0; k < 5; k++) {
      const push = out + k * 0.12;
      this.bx = lip.ex + lip.nx * push;
      this.by = lip.ey - (T.gripDrop + hangOver(f)) * s;
      this.bz = lip.ez + lip.nz * push;
      this.qx = this.bx;
      this.qy = this.by;
      this.qz = this.bz;
      if (this.clear(world, false)) return true;
    }
    return false;
  }

  /** A face within reach of the feet under the lip: the hang is braced. One ray. */
  private bracedAt(world: LedgeWorld, lip: Lip, s: number, flt: number): boolean {
    const T = CLIMB_TUNE;
    const a = LEDGE_FACTS[LEDGE_ROLES.braced.idle];
    // At the braced hang's feet (its ankles), from as far out of the face as the braced hang's body stands and a foot's
    // length more, toward the face.
    const out = (T.gripOut + a.g0[2]) * s;
    this.qflt = flt;
    this.qx = lip.ex + lip.nx * (out + 0.1);
    this.qy = lip.ey - (T.gripDrop + hangOver(a)) * s + LEDGE_REST.ankle * s;
    this.qz = lip.ez + lip.nz * (out + 0.1);
    this.qdx = -lip.nx;
    this.qdy = 0;
    this.qdz = -lip.nz;
    this.qlen = out + 0.1 + 0.3 * s;
    if (!this.cast(world)) return false;
    return this.hit.ny < Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
  }

  // ---- the grab and the step down --------------------------------------------------------------------------------------------

  /**
   * After the move: whether the body grabs a lip (or, crouched off a lip, lowers into a hang) this frame. On a grab the body
   * is held from here (`holding`), its velocity is put down, and a one-off is asked for (`startClip`). False otherwise.
   */
  sense(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina): boolean {
    const T = CLIMB_TUNE;
    // `climb.grabSweep`: where the feet stood at the last look (nothing while something holds the body), for the frame's rise or fall.
    const y0 = this.seenY;
    // (Two writes, never one ternary with NaN in an arm: such a phi can be left tagged and box the height every frame, which
    // the fixer of Climbing II caught one process in fifty under the ledges' allocation measure.)
    if (this.phase === LEDGE_NONE) this.seenY = b.pos.y;
    else this.seenY = Number.NaN;
    if (T.ledges !== 'on' || this.phase !== LEDGE_NONE) return false;
    if (this.regrabT > 0) this.regrabT -= i.dt;
    // Climbing II, item 1: under 'use' a lip is grabbed only on the use key handed to the climb, and on the ground too.
    const use = T.grab === 'use';
    if (i.busy || (i.grounded && !(use && i.use)) || stam.tired) return false;
    const s = i.scale;
    // Crouched off a lip, walking: lower into the hang.
    if (i.crouchHeld) {
      if (i.wasGrounded && !i.jumped && !i.grounded) return this.stepDown(world, b, i);
      return false;
    }
    if (use && !i.use) return false;
    if (-b.vel.y > T.grabFall) return false;
    // Toward a face: the way the keys push, else the way the body travels (on the use key, else the way it faces).
    let dx = i.moveX;
    let dz = i.moveZ;
    let dl = Math.sqrt(dx * dx + dz * dz);
    if (!(dl > 1e-6)) {
      dx = b.vel.x;
      dz = b.vel.z;
      dl = Math.sqrt(dx * dx + dz * dz);
      if (!(dl > 0.5)) {
        if (!use) return false;
        dx = Math.sin(i.heading);
        dz = Math.cos(i.heading);
        dl = 1;
      }
    }
    dx /= dl;
    dz /= dl;
    const lo = (T.reachLow + T.gripDrop) * s;
    const hi = (T.reachHigh + T.gripDrop) * s;
    const L = this.found;
    // On the use key the hands reach as far ahead as the wall climb would start (`useReach`, never less than today's).
    const ahead = (use && T.useReach > T.reachAhead ? T.useReach : T.reachAhead) * s;
    let got = this.findLip(world, b.pos.x, b.pos.y, b.pos.z, dx, dz, lo, hi, ahead, i.filter, false, L);
    // `climb.grabSweep` 'swept': where the frame's own band finds nothing, the band swept over the frame's rise (its low end
    // lowered) or fall (its high end raised) is asked as well, so a lip it passed between two frames is grabbed at any frame
    // rate. Only after the band itself: the swept band's foot ray stands lower, and under a thin lip (a bar, a plate) it
    // passes beneath the face the band itself would meet.
    if (!got && T.grabSweep === 'swept') {
      const dy = b.pos.y - y0;
      if (dy > 0 && dy < SWEEP_MOST) got = this.findLip(world, b.pos.x, b.pos.y, b.pos.z, dx, dz, lo - dy, hi, ahead, i.filter, false, L);
      else if (dy < 0 && -dy < SWEEP_MOST) got = this.findLip(world, b.pos.x, b.pos.y, b.pos.z, dx, dz, lo, hi - dy, ahead, i.filter, false, L);
    }
    if (!got) return false;
    if (this.regrabT > 0) {
      const ex = L.ex - this.regrabX;
      const ey = L.ey - this.regrabY;
      const ez = L.ez - this.regrabZ;
      if (ex * ex + ey * ey + ez * ez < 1) return false;
    }
    const braced = this.bracedAt(world, L, s, i.filter);
    if (!this.placeFor(world, L, braced, s, i.filter)) return false;
    // The grab's clip: falling onto the lip, rising slowly (a standing jump) or quickly (a running one).
    const roles = braced ? LEDGE_ROLES.braced : LEDGE_ROLES.free;
    const vh = Math.sqrt(b.vel.x * b.vel.x + b.vel.z * b.vel.z);
    const id = b.vel.y < 0 ? roles.grabFall : vh < 2 ? roles.grabStand : roles.grabRise;
    this.s = s;
    // How the lip slopes under the hands (each grips it at its own height: the owner's sloping lips).
    this.measureSlope(world, L, i.filter);
    this.lip.copy(L);
    this.braced = braced;
    this.heading = Math.atan2(-L.nx, -L.nz);
    this.startMove(id, 'grab', b.pos.x, b.pos.y, b.pos.z, this.bx, this.by, this.bz, AFTER_HANG, braced, this.heading, 'hands', 'idle', L);
    b.vel.x = 0;
    b.vel.y = 0;
    b.vel.z = 0;
    this.grabs++;
    return true;
  }

  /**
   * Climbing II, item 1: whether the use key would grab a lip now (the action bar's "climb", gathered a few times a second):
   * the grab's own look the way the keys push, else the body travels, else it faces, and nothing begun. A few rays.
   */
  canGrab(world: LedgeWorld, b: LedgeBody, i: LedgeIn): boolean {
    const T = CLIMB_TUNE;
    if (T.ledges !== 'on' || this.phase !== LEDGE_NONE || i.busy || -b.vel.y > T.grabFall) return false;
    const s = i.scale;
    let dx = i.moveX;
    let dz = i.moveZ;
    let dl = Math.sqrt(dx * dx + dz * dz);
    if (!(dl > 1e-6)) {
      dx = b.vel.x;
      dz = b.vel.z;
      dl = Math.sqrt(dx * dx + dz * dz);
      if (!(dl > 0.5)) {
        dx = Math.sin(i.heading);
        dz = Math.cos(i.heading);
        dl = 1;
      }
    }
    const ahead = (T.useReach > T.reachAhead ? T.useReach : T.reachAhead) * s;
    return this.findLip(world, b.pos.x, b.pos.y, b.pos.z, dx / dl, dz / dl, (T.reachLow + T.gripDrop) * s, (T.reachHigh + T.gripDrop) * s, ahead, i.filter, false, this.found);
  }

  /** Crouched off a lip: the lip behind the feet, a drop under it deeper than a hang, and the body lowered into it, turned round. */
  private stepDown(world: LedgeWorld, b: LedgeBody, i: LedgeIn): boolean {
    let dx = b.vel.x;
    let dz = b.vel.z;
    const dl = Math.sqrt(dx * dx + dz * dz);
    if (!(dl > 0.2)) return false;
    dx /= dl;
    dz /= dl;
    const s = i.scale;
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    this.qflt = i.filter;
    // The face under the lip just walked off, facing the way the body went.
    this.qx = b.pos.x + dx * 0.5;
    this.qy = b.pos.y - 0.25 * s;
    this.qz = b.pos.z + dz * 0.5;
    this.qdx = -dx;
    this.qdy = 0;
    this.qdz = -dz;
    this.qlen = 1.5;
    if (!this.cast(world)) return false;
    const h = this.hit;
    if (h.ny >= walk) return false;
    let nx = h.nx;
    let nz = h.nz;
    const nl = Math.sqrt(nx * nx + nz * nz);
    if (!(nl > 1e-6)) return false;
    nx /= nl;
    nz /= nl;
    if (nx * dx + nz * dz < 0.5) return false;
    const faceX = h.x;
    const faceZ = h.z;
    // Its top, just behind the face: where the feet stood.
    this.qx = faceX - nx * TOP_IN;
    this.qy = b.pos.y + 0.4;
    this.qz = faceZ - nz * TOP_IN;
    this.qdx = 0;
    this.qdy = -1;
    this.qdz = 0;
    this.qlen = 1;
    if (!this.cast(world)) return false;
    if (h.ny < walk) return false;
    const L = this.found;
    L.ex = faceX;
    L.ey = h.y;
    L.ez = faceZ;
    L.nx = nx;
    L.nz = nz;
    L.topNy = h.ny;
    // A drop no deeper than a hang: the body would stand on it, not hang.
    if (!this.placeFor(world, L, false, s, i.filter)) return false;
    this.qx = this.bx;
    this.qy = this.by + 0.3;
    this.qz = this.bz;
    this.qdx = 0;
    this.qdy = -1;
    this.qdz = 0;
    this.qlen = 0.5;
    if (this.cast(world)) return false;
    this.s = s;
    this.measureSlope(world, L, i.filter);
    this.lip.copy(L);
    this.braced = false;
    // The clip walks off facing away from the wall and turns round to grab it: the body faces the wall once it is done.
    this.heading = Math.atan2(dx, dz);
    this.startMove(LEDGE_STEP_DOWN, 'stepDown', b.pos.x, b.pos.y, b.pos.z, this.bx, this.by, this.bz, AFTER_HANG, false, Math.atan2(-nx, -nz), 'feet', 'idle', L);
    b.vel.x = 0;
    b.vel.y = 0;
    b.vel.z = 0;
    this.grabs++;
    return true;
  }

  /**
   * The grapple's haul ended under a lip it could not go over (its top too steep to stand on, or no room): a braced hang
   * there if the lip is in reach ahead of the body (a top steeper than walkable counts). True where it took the body.
   */
  fromHaul(world: LedgeWorld, b: LedgeBody, i: LedgeIn, dx: number, dz: number): boolean {
    const T = CLIMB_TUNE;
    if (T.ledges !== 'on' || this.phase !== LEDGE_NONE) return false;
    const s = i.scale;
    const dl = Math.sqrt(dx * dx + dz * dz);
    if (!(dl > 1e-6)) return false;
    // Asked once a place: a haul held where nothing was found asks again only once the body has moved.
    const mx = b.pos.x - this.haulX;
    const my = b.pos.y - this.haulY;
    const mz = b.pos.z - this.haulZ;
    if (mx * mx + my * my + mz * mz < 0.04) return false;
    this.haulX = b.pos.x;
    this.haulY = b.pos.y;
    this.haulZ = b.pos.z;
    const L = this.found;
    if (!this.findLip(world, b.pos.x, b.pos.y, b.pos.z, dx / dl, dz / dl, (T.reachLow + T.gripDrop) * s, (T.reachHigh + T.gripDrop) * s, T.reachAhead * s + 0.3, i.filter, false, L) && !this.edgeUp(world, b.pos.x, b.pos.y, b.pos.z, dx / dl, dz / dl, s, i.filter, L)) return false;
    if (!this.placeFor(world, L, true, s, i.filter)) return false;
    this.s = s;
    this.measureSlope(world, L, i.filter);
    this.lip.copy(L);
    this.braced = this.bracedAt(world, L, s, i.filter);
    if (!this.braced) this.placeFor(world, L, false, s, i.filter);
    this.heading = Math.atan2(-L.nx, -L.nz);
    const roles = this.braced ? LEDGE_ROLES.braced : LEDGE_ROLES.free;
    this.startMove(roles.grabRise, 'grab', b.pos.x, b.pos.y, b.pos.z, this.bx, this.by, this.bz, AFTER_HANG, this.braced, this.heading, 'hands', 'idle', L);
    b.vel.x = 0;
    b.vel.y = 0;
    b.vel.z = 0;
    this.grabs++;
    return true;
  }

  /**
   * Maker B's wall climb asks for a lip ahead of the climbing body with `findLip`'s own rule (a walkable top over a face
   * steeper than the climb limit, its top between `lo` and `hi` over the feet), into `out`: the top-out's look-out.
   */
  lipAhead(world: LedgeWorld, fx: number, fy: number, fz: number, dx: number, dz: number, lo: number, hi: number, ahead: number, flt: number, out: Lip): boolean {
    return this.findLip(world, fx, fy, fz, dx, dz, lo, hi, ahead, flt, false, out);
  }

  /** The braced hang's grip over its own feet for a figure of size `s` (its idle's, and `gripDrop`): where a wall climb hands over (maker B). */
  hangGrip(s: number): number {
    return (CLIMB_TUNE.gripDrop + hangOver(LEDGE_FACTS[LEDGE_ROLES.braced.idle])) * s;
  }

  /**
   * Maker B's wall climb has reached a lip: a hang there (braced where the feet find the wall under it, as a grab's is),
   * the body put at the hang place from where the climb has it, and the figure drawn on from where the climb drew it
   * (`ox, oy, oz`, the climb's own offset in the world's frame) eased into the hang's line-up over `climb.ease`: no clip of
   * its own (the climb's pose and the braced hang's are the same reach on the same wall). W still held climbs straight on
   * up from it (the top-out). False where the ledges are switched off or the body has no room there.
   */
  fromWall(world: LedgeWorld, b: LedgeBody, i: LedgeIn, L: Lip, ox: number, oy: number, oz: number): boolean {
    if (CLIMB_TUNE.ledges !== 'on' || this.phase !== LEDGE_NONE) return false;
    const s = i.scale;
    const braced = this.bracedAt(world, L, s, i.filter);
    if (!this.placeFor(world, L, braced, s, i.filter)) return false;
    this.s = s;
    this.lip.copy(L);
    this.braced = braced;
    this.heading = Math.atan2(-L.nx, -L.nz);
    // The body moves onto the hang place; the figure stays where it was drawn, its offset taking the move back.
    this.offX = ox + (b.pos.x - this.bx);
    this.offY = oy + (b.pos.y - this.by);
    this.offZ = oz + (b.pos.z - this.bz);
    b.pos.x = this.bx;
    b.pos.y = this.by;
    b.pos.z = this.bz;
    b.vel.x = 0;
    b.vel.y = 0;
    b.vel.z = 0;
    this.phase = LEDGE_HANG;
    this.shimmy = 0;
    this.rigState = this.loopState(braced, 0);
    this.rigClip = (braced ? LEDGE_ROLES.braced : LEDGE_ROLES.free).idle;
    this.startClip = '';
    this.outT = 0;
    this.dtNow = 0;
    this.qflt = i.filter;
    this.railStart(world);
    this.beginFade();
    this.idleOffset(LEDGE_FACTS[this.rigClip], b);
    this.lineFor(this.lip);
    this.fromClimb = true;
    this.grabs++;
    return true;
  }

  /** A hang handed over by a wall climb with W held (maker B): the first hang frame climbs on up while W is still held (the top-out). */
  private fromClimb = false;

  /**
   * The edge over a face the body is held against (the grapple's hand-over, where the top is too steep to stand on, so it
   * is no lip by `findLip`'s own rule): rays into the face up the hands' band until the face ends or turns over toward the
   * sky, the edge just under there. One ray a 0.1 m of the band.
   */
  private edgeUp(world: LedgeWorld, fx: number, fy: number, fz: number, dx: number, dz: number, s: number, flt: number, out: Lip): boolean {
    const T = CLIMB_TUNE;
    this.qflt = flt;
    this.qdx = dx;
    this.qdy = 0;
    this.qdz = dz;
    this.qlen = T.reachAhead * s + 0.3;
    let had = false;
    let lastY = 0;
    let lastX = 0;
    let lastZ = 0;
    let nx = 0;
    let nz = 0;
    for (let y = 0.4 * s; y <= (T.reachHigh + T.gripDrop) * s * 1.2; y += 0.1) {
      this.qx = fx;
      this.qy = fy + y;
      this.qz = fz;
      const hit = this.cast(world);
      const h = this.hit;
      if (hit && h.ny < 0.2 && h.ny > -0.2) {
        had = true;
        lastY = fy + y;
        lastX = h.x;
        lastZ = h.z;
        const l = Math.sqrt(h.nx * h.nx + h.nz * h.nz);
        nx = h.nx / l;
        nz = h.nz / l;
        continue;
      }
      if (!had) continue;
      // The face ended in this step: halved four times (to 6 mm), its top the slope over it (or nothing at all).
      const topNy = hit ? h.ny : 1;
      let lo = lastY;
      let up = fy + y;
      for (let k = 0; k < 4; k++) {
        const mid = (lo + up) * 0.5;
        this.qy = mid;
        if (this.cast(world) && h.ny < 0.2 && h.ny > -0.2) {
          lo = mid;
          lastX = h.x;
          lastZ = h.z;
        } else up = mid;
      }
      out.ex = lastX;
      out.ey = (lo + up) * 0.5;
      out.ez = lastZ;
      out.nx = nx;
      out.nz = nz;
      out.topNy = topNy;
      return -(nx * dx + nz * dz) >= 0.5;
    }
    return false;
  }

  // ---- the one-offs ----------------------------------------------------------------------------------------------------

  /**
   * Begin a one-off: the body carried from (f) to (t) over the clip's [t0, end], the figure lined up at its start by its
   * hands on the lip (`hands`), by its feet on the body's (`feet`), or by the idle's hands (`idle`, a hang's own place),
   * and at its end by the idle's hands (`idle`) or its feet (`feet`).
   */
  private startMove(id: string, kind: string, fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, after: number, braced: boolean, endHeading: number, start: 'hands' | 'feet' | 'idle', end: 'idle' | 'feet', lip: Lip): void {
    const m = this.move;
    const f = LEDGE_FACTS[id];
    m.id = id;
    m.kind = kind;
    m.fx = fx;
    m.fy = fy;
    m.fz = fz;
    m.tx = tx;
    m.ty = ty;
    m.tz = tz;
    m.t0 = f.t0;
    m.T = f.dur;
    m.time = f.t0;
    m.after = after;
    m.braced = braced;
    m.heading = endHeading;
    m.h0 = this.heading;
    m.spin = 0;
    m.path = PATH_LINE;
    m.crouchFrom = 2;
    m.lip.copy(lip);
    const s = this.s;
    const h0 = this.heading;
    // The start: where the figure's origin is drawn against the body's. By its feet (standing on the top it walks off),
    // else by its hands at its start put on the grip's line (the lip held, `idle`, or the lip reached for, `hands`).
    if (start === 'feet') {
      m.o0x = 0;
      m.o0y = (LEDGE_REST.ankle - f.a0) * s;
      m.o0z = 0;
    } else {
      gripAt.x = fx;
      gripAt.y = fy;
      gripAt.z = fz;
      this.gripOff(start === 'idle' ? this.lip : lip, gripAt, f.g0);
      m.o0x = this.ax;
      m.o0y = this.ay;
      m.o0z = this.az;
    }
    // The end: by its feet on the body's (standing on the top), else by its hands at its end on the lip it is aimed at,
    // from where the body is carried to (the clip's own frame still the start heading's: a step down turns round in it).
    if (end === 'feet') {
      m.o1x = 0;
      m.o1y = (LEDGE_REST.ankle - f.a1) * s;
      m.o1z = 0;
    } else {
      gripAt.x = tx;
      gripAt.y = ty;
      gripAt.z = tz;
      // A hop ends facing the lip it is aimed at (another face's, round a corner), and turns to it as it goes.
      if (kind === 'hop') this.heading = endHeading;
      this.gripOff(lip, gripAt, f.g1);
      this.heading = h0;
      m.o1x = this.ax;
      m.o1y = this.ay;
      m.o1z = this.az;
    }
    this.phase = LEDGE_MOVE;
    this.shimmy = 0;
    this.startClip = id;
    this.fresh = true;
    this.startFrom = f.t0;
    this.startFade = CLIMB_TUNE.ease;
    this.beginFade();
  }

  /** A point of a clip's own frame (x left, y up, z forward, human male metres) turned into the world by a heading and scaled, into `wx/wy/wz`. */
  private wx = 0.5;
  private wy = 0.5;
  private wz = 0.5;
  private toWorld(p: readonly [number, number, number]): void {
    const h = this.heading;
    const s = this.s;
    const sh = Math.sin(h);
    const ch = Math.cos(h);
    // left = (cos h, 0, -sin h), forward = (sin h, 0, cos h).
    this.wx = (p[0] * ch + p[2] * sh) * s;
    this.wy = p[1] * s;
    this.wz = (-p[0] * sh + p[2] * ch) * s;
  }

  /** The figure's offset fades from where it stands now to its next target over the clip's own fade. */
  private beginFade(): void {
    this.ofX = this.offX;
    this.ofY = this.offY;
    this.ofZ = this.offZ;
    this.fadeT = 0;
    this.fadeDur = Math.max(1e-6, CLIMB_TUNE.ease);
  }

  // ---- a frame while holding ---------------------------------------------------------------------------------------------

  /**
   * In place of the movement while `holding`: the keys, the stamina, a one-off's carry, and the body's place written into
   * `b.pos` (its velocity nought, or what a let-go throws it at). Answers false the frame the body is let go (the caller's
   * movement takes it from the next).
   */
  step(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina): boolean {
    const held = this.stepIn(world, b, i, stam);
    this.fresh = false;
    return held;
  }

  /**
   * A one-off begun this frame before `step` (a grab: `sense`, `fromHaul`), whose clip the step after it must not forget;
   * put down at every step's end.
   */
  private fresh = false;

  private stepIn(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina): boolean {
    const T = CLIMB_TUNE;
    const dt = i.dt;
    if (T.ledges !== 'on') {
      this.letGo(b, 'switched off', 0, 0, 0);
      return false;
    }
    this.dtNow = dt;
    if (!this.fresh) this.startClip = '';
    this.ended = false;
    this.stood = false;
    if (this.phase === LEDGE_MOVE) {
      // The feedback round, item 1 (`climb.grabFree` 'share'): a grab past its share hands the hang the keys asked (the
      // presses made earlier in it kept for then), the body put on the hang place with its drawn figure where it is; the
      // hang below takes the keys this very frame. Nothing asked, the grab goes on as ever.
      if (T.grabFree === 'share' && this.move.kind === 'grab' && this.grabFreed(i)) this.freeGrab(world, b, i);
      else {
        // A climb or a turn takes no stamina of its own; the hang under it drains as hanging does.
        stam.step(dt, -T.stamina.hang, i.pool, LOCO_TUNE);
        // Climbing II, item 7: a look-away eased out through a one-off (the spine's turn back with it).
        this.lookStep(i);
        return this.moveStep(world, b, i, true);
      }
      // Ended into a hang that went straight on into a one-off of its own (a free hang onto the wall): that, carried.
      if ((this.phase as number) !== LEDGE_HANG) return this.begun(world, b, i);
    }
    // Hanging.
    stam.step(dt, -(this.shimmy !== 0 ? T.stamina.shimmy : T.stamina.hang), i.pool, LOCO_TUNE);
    b.vel.x = 0;
    b.vel.y = 0;
    b.vel.z = 0;
    if (stam.tired) {
      this.said = 'Too tired to hold on.';
      this.drop(b, 'tired');
      return false;
    }
    if (i.crouchPressed) {
      this.drop(b, 'let go');
      return false;
    }
    // Climbing II, item 7 (maker B, `climb.lookAway` 'reach'): braced and still, looking away eases in, and Space alone then
    // hops to a lip behind in the view's way, else jumps a little up and off the wall. Under 'before' nothing here moves.
    this.lookStep(i);
    if (this.lookSide !== 0 && this.look > 0 && i.jumpPressed && !i.leftHeld && !i.rightHeld && !i.forwardHeld && !i.backHeld) {
      if (this.hopBehindTo(world, b, i, stam)) return this.begun(world, b, i);
      this.said = '';
      this.jumpOffSmall(b);
      return false;
    }
    // Climbing II, phase 2 (items 2 to 4), each behind its own switch: with all three at 'before' this is today's order to the
    // letter (S with Space jumps off backward, a side with Space hops sideways, W with Space hops up where it can, then Space
    // or W climbs up).
    const band = T.hops === 'band';
    const off = T.spaceOff === 'jump';
    const side = (i.leftHeld || i.rightHeld) && !(i.leftHeld && i.rightHeld);
    if (i.jumpPressed && i.backHeld && !(band && side)) {
      // Item 4: a lower lip under the hang in the band is hopped down to; else today's jump off backward.
      if (band && this.hopBand(world, b, i, stam, 0, -1)) return this.begun(world, b, i);
      if (band) this.said = '';
      this.jumpOff(b);
      return false;
    }
    if (i.jumpPressed && side) {
      const dir = i.leftHeld ? 1 : -1;
      if (band) {
        if (this.hopBand(world, b, i, stam, dir, i.forwardHeld ? 1 : i.backHeld ? -1 : 0)) return this.begun(world, b, i);
      } else this.hop(world, b, i, stam, dir);
      // Item 3: nowhere to hop that way (nothing begun, whatever was said): the small jump up and off the wall.
      if (off && this.phase === LEDGE_HANG) {
        this.said = '';
        this.jumpOffSmall(b);
        return false;
      }
      if (band && this.phase === LEDGE_HANG && !this.said) this.said = 'No ledge to hop to.';
      return this.begun(world, b, i);
    }
    if (i.jumpPressed && i.forwardHeld) {
      const began = band ? this.hopBand(world, b, i, stam, 0, 1) : this.hopUp(world, b, i, stam);
      if (!off) {
        if (began) return this.begun(world, b, i);
      } else {
        if (this.phase === LEDGE_MOVE) return this.begun(world, b, i);
        this.said = '';
        this.jumpOffSmall(b);
        return false;
      }
    }
    // A wall climb handed over with W still held climbs straight on up (the top-out, maker B): asked once.
    const topOut = this.fromClimb && i.forwardHeld;
    this.fromClimb = false;
    // Item 2: W pressed at a ledge hops up to a lip above where there is one; only where there is none does it climb.
    if (T.wUp === 'hop' && i.forwardPressed && !i.jumpPressed && !topOut) {
      if (band) this.hopBand(world, b, i, stam, 0, 1);
      else this.hopUp(world, b, i, stam);
      if (this.phase === LEDGE_MOVE) return this.begun(world, b, i);
      this.said = '';
    }
    // Item 3: Space alone hops up where there is a lip above to hop to, else jumps a little up and off the wall.
    if (off && i.jumpPressed) {
      if (band) this.hopBand(world, b, i, stam, 0, 1);
      else this.hopUp(world, b, i, stam);
      if (this.phase === LEDGE_MOVE) return this.begun(world, b, i);
      this.said = '';
      this.jumpOffSmall(b);
      return false;
    }
    if (i.jumpPressed || i.forwardPressed || topOut) {
      this.climbUp(world, b, i);
      return this.begun(world, b, i);
    }
    // A and D shimmy along the lip.
    const want = i.leftHeld && !i.rightHeld ? 1 : i.rightHeld && !i.leftHeld ? -1 : 0;
    this.shimmyStep(world, b, i, want);
    return this.begun(world, b, i);
  }

  /**
   * A one-off begun in this frame's step is carried its first frame at once: the caller's rig plays it from its start and
   * steps it by the frame in the same frame, so the body, the figure's offset and the hands' line keep to the pose's own
   * time (a grab's first frame is carried the same way, by the step after `sense`).
   */
  private begun(world: LedgeWorld, b: LedgeBody, i: LedgeIn): boolean {
    if (this.phase === LEDGE_MOVE && this.move.time === this.move.t0) return this.moveStep(world, b, i, true);
    return this.phase !== LEDGE_NONE;
  }

  /**
   * The feedback round, item 1 (`climb.grabFree` 'share'): whether the grab under way hands the hang the keys this frame: it
   * is `grabFreeAt` of its length through (its own clock, so alike at every frame rate) and a key the hang answers is asked
   * (A or D alone held, the look-away's view, or a jump, W or crouch pressed since the grab began, which is kept until then:
   * never the grab's own first frame, whose presses are the jump that brought the body here). Fields only.
   */
  private grabFreed(i: LedgeIn): boolean {
    if (!this.fresh) {
      // A jump pressed is kept with the move keys held as it was pressed (a hop's way: a side, W or S with it).
      if (i.jumpPressed) {
        this.pendJump = true;
        this.pendLeft = i.leftHeld;
        this.pendRight = i.rightHeld;
        this.pendFwd = i.forwardHeld;
        this.pendBack = i.backHeld;
      }
      if (i.forwardPressed) this.pendForward = true;
      if (i.crouchPressed) this.pendCrouch = true;
    }
    const m = this.move;
    const span = m.T - m.t0;
    if (span > 1e-6 && (m.time - m.t0) / span < CLIMB_TUNE.grabFreeAt - 1e-9) return false;
    if ((i.leftHeld || i.rightHeld) && !(i.leftHeld && i.rightHeld)) return true;
    return this.pendJump || this.pendForward || this.pendCrouch || this.lookWanted(i);
  }

  /** Item 1: the braced look-away would begin from the hang the grab under way ends in (`lookStep`'s own threshold). */
  private lookWanted(i: LedgeIn): boolean {
    const T = CLIMB_TUNE;
    if (T.lookAway !== 'reach' || !this.move.braced || i.leftHeld || i.rightHeld) return false;
    const v = i.viewYaw;
    if (!(v === v)) return false;
    let off = v - this.move.heading;
    off -= Math.round(off / TAU) * TAU;
    const a = off < 0 ? -off : off;
    return a > (T.lookStart * Math.PI) / 180;
  }

  /**
   * Item 1: the grab under way ended early into its hang. The body goes onto the hang place, its drawn figure left where it
   * is (the offset takes the move back, as a wall climb's hand-over does) and eased into the hang's line-up over `climb.ease`
   * while the rig blends the grab's clip out (`ended`, the caller's); the presses kept handed to the hang's keys this frame.
   */
  private freeGrab(world: LedgeWorld, b: LedgeBody, i: LedgeIn): void {
    const m = this.move;
    this.offX += b.pos.x - m.tx;
    this.offY += b.pos.y - m.ty;
    this.offZ += b.pos.z - m.tz;
    // Asked on its own first frame (a share of nought): no grab clip begun at all, and the frame's own presses are the jump
    // that brought the body here, never the hang's.
    if (this.fresh) {
      this.startClip = '';
      i.jumpPressed = false;
      i.forwardPressed = false;
      i.crouchPressed = false;
    }
    const jump = this.pendJump;
    const forward = this.pendForward;
    const crouch = this.pendCrouch;
    const left = this.pendLeft;
    const right = this.pendRight;
    const fwd = this.pendFwd;
    const back = this.pendBack;
    this.endMove(world, b, i);
    // A jump kept is the hang's with the keys it was pressed with (the frame's own held keys stand in for none of them).
    if (jump) {
      i.jumpPressed = true;
      i.leftHeld = left;
      i.rightHeld = right;
      i.forwardHeld = fwd;
      i.backHeld = back;
    }
    if (forward) i.forwardPressed = true;
    if (crouch) i.crouchPressed = true;
    this.grabsFreed++;
  }

  /** A frame of a one-off: the body carried, the figure's offset and the hands' line along with it; its end at its end. */
  private moveStep(world: LedgeWorld, b: LedgeBody, i: LedgeIn, chain: boolean): boolean {
    const dt = i.dt;
    const m = this.move;
    m.time += dt;
    const span = m.T - m.t0;
    const lin = span > 1e-6 ? Math.min(1, Math.max(0, (m.time - m.t0) / span)) : 1;
    // A hop is carried from rest at one hang to rest at the next (its clip leaves and takes a lip standing still); every
    // other one-off evenly.
    const u = m.kind === 'hop' ? lin * lin * (3 - 2 * lin) : lin;
    // The body along its own path (the room for it checked before the move began).
    this.pu = u;
    this.pathAt();
    b.pos.x = this.pqx;
    b.pos.y = this.pqy;
    b.pos.z = this.pqz;
    this.crouchedNow = this.pathCrouched;
    b.vel.x = 0;
    b.vel.y = 0;
    b.vel.z = 0;
    this.ax = m.o0x + (m.o1x - m.o0x) * u;
    this.ay = m.o0y + (m.o1y - m.o0y) * u;
    this.az = m.o0z + (m.o1z - m.o0z) * u;
    // A hop to another face turns with it as it goes.
    if (m.kind === 'hop') {
      let dh = m.heading - m.h0;
      dh -= Math.round(dh / TAU) * TAU;
      // Climbing II, item 7: a hop behind turns round the leading side's way.
      if (m.spin !== 0 && dh * m.spin < 0) dh += m.spin * TAU;
      this.heading = m.h0 + dh * u;
    }
    this.tiltGoal = 0;
    this.easeTilt();
    this.setOffset();
    // A climb's figure keeps the straight line it always had (its clip's own pose and line-up): its offset takes back,
    // whole and outside the line-up's ease, whatever the capsule's own path stands off that line.
    if (m.path === PATH_LEGS) {
      this.offX += m.fx + (m.tx - m.fx) * u - this.pqx;
      this.offY += m.fy + (m.ty - m.fy) * u - this.pqy;
      this.offZ += m.fz + (m.tz - m.fz) * u - this.pqz;
    }
    // The hands' line: the lip the one-off leaves, then from its middle the lip it is aimed at.
    this.lineFor(u < 0.5 && m.kind === 'hop' ? this.lip : m.lip);
    // A climb's hands push off the top and leave the lip: let go over its first third. A hop's hands leave the lip it
    // leaves and take the one it is aimed at (`hopHands`): wholly on a lip only at its two ends.
    this.goalHands = m.kind === 'climb' ? Math.max(0, 1 - 3 * u) : m.kind === 'hop' ? hopHands(lin) : 1;
    this.goalFeet = 0;
    this.easeLimbs();
    this.rigState = m.kind === 'climb' ? (m.braced ? 'climbUpBraced' : 'climbUpFree') : this.loopState(m.braced, 0);
    this.rigClip = m.kind === 'climb' ? m.id : (m.braced ? LEDGE_ROLES.braced : LEDGE_ROLES.free).idle;
    if (m.time >= m.T - 1e-9) {
      this.endMove(world, b, i);
      // A one-off chained on at the end (a free hang onto the wall) carried its first frame too.
      if (chain && this.phase === LEDGE_MOVE && m.time === m.t0) return this.moveStep(world, b, i, false);
    }
    return (this.phase as number) !== LEDGE_NONE;
  }

  /**
   * The frame's shimmy: along the lip by the clip's own pace, the lip followed along its own edge (`rail`: round a corner,
   * along a curve, up or down a slope), stopped where the leading hand and a hand's width more would leave it or reach a part
   * steeper than `lipSlope`, and where the body's capsule would meet what stands still (a crate at the knees, a wall at an
   * inner corner). The body hangs from its two hands' middle, turned to face their faces' mean.
   */
  private shimmyStep(world: LedgeWorld, b: LedgeBody, i: LedgeIn, want: number): void {
    const T = CLIMB_TUNE;
    const roles = this.braced ? LEDGE_ROLES.braced : LEDGE_ROLES.free;
    const s = this.s;
    const R = this.rail;
    let moved = 0;
    this.qflt = i.filter;
    if (want !== 0 && R.n > 0) {
      const f = LEDGE_FACTS[want > 0 ? roles.shimmyLeft : roles.shimmyRight];
      const speed = (Math.abs(f.net[0]) / f.dur) * s * T.shimmy;
      const step = speed * i.dt;
      const lead = (Math.abs(f.span0) * 0.5 + T.edgeAhead) * s;
      const hi = want > 0;
      this.need = this.barc + want * (lead + step);
      this.railReach(world, hi);
      R.q = this.barc;
      // Climbing II, item 5: a step along the lip up to `stepMax` is crossed (none under 'before', where none is marked).
      R.stepUp = T.steps === 'hands' ? T.stepMax * s + STEP_SLACK : 0;
      // `climb.slopeLimit` 'inclusive': a lip exactly at the limit followed (the rays' own millimetre).
      R.slack = T.slopeLimit === 'inclusive' ? SLOPE_SLACK : 0;
      R.limit(hi, Math.tan((T.lipSlope * Math.PI) / 180));
      const room = hi ? R.sa - (this.barc + lead) : this.barc - lead - R.sa;
      const go = room < step ? room : step;
      if (go > 1e-7) {
        this.bq = this.barc + want * go;
        const C = this.cand;
        this.bodyOn(C);
        if (this.hangRoom(world, C)) {
          moved = want * go;
          this.barc = this.bq;
          this.lip.copy(C);
          this.heading = Math.atan2(-C.nx, -C.nz);
          b.pos.x = this.bx;
          b.pos.y = this.by;
          b.pos.z = this.bz;
        }
      }
    }
    const was = this.shimmy;
    this.shimmy = moved > 0 ? 1 : moved < 0 ? -1 : 0;
    this.tiltGoal = Math.atan(this.lip.slope) * T.lipTilt;
    this.easeTilt();
    if (moved !== 0) {
      const L = this.lip;
      // Braced or free where the body now is: onto or off the wall through the clip between the two.
      const braced = this.bracedAt(world, L, s, i.filter);
      if (braced !== this.braced && this.placeFor(world, L, braced, s, i.filter)) {
        this.startMove(roles.toOther, 'turn', b.pos.x, b.pos.y, b.pos.z, this.bx, this.by, this.bz, AFTER_HANG, braced, this.heading, 'idle', 'idle', L);
        return;
      }
    }
    if (this.shimmy !== was) this.beginFade();
    this.rigState = this.loopState(this.braced, this.shimmy);
    this.rigClip = this.shimmy > 0 ? roles.shimmyLeft : this.shimmy < 0 ? roles.shimmyRight : roles.idle;
    const f = LEDGE_FACTS[this.rigClip];
    this.idleOffset(f, b);
    this.lineFor(this.lip);
    this.goalHands = 1;
    this.goalFeet = this.braced ? 1 : 0;
    this.easeLimbs();
  }

  /**
   * The hang's place under a lip on the rail with room for the standing capsule: out from the face by the idle's grip, and
   * pushed further out (0.12 m at a time, four times, as a grab's place is) where it meets something (an outer corner's
   * edge, an overhang's underside), into `bx/by/bz`. False where none is clear (something at the knees or the side: the
   * shimmy stops). One to five shape tests.
   */
  private hangRoom(world: LedgeWorld, L: Lip): boolean {
    const T = CLIMB_TUNE;
    const s = this.s;
    const f = this.braced ? LEDGE_FACTS[LEDGE_ROLES.braced.idle] : LEDGE_FACTS[LEDGE_ROLES.free.idle];
    const out = (T.gripOut + f.g0[2]) * s;
    const y = L.ey - (T.gripDrop + hangOver(f)) * s;
    const nx = L.nx;
    const nz = L.nz;
    // The place itself, then pushed further out along the lip's way out and, where that alone meets the other face of an
    // inner corner, along that way turned either side by 30 and 60 degrees (`ROOM_TURNS`).
    for (let j = 0; j < ROOM_TURNS.length; j += 2) {
      const c = ROOM_TURNS[j];
      const sn = ROOM_TURNS[j + 1];
      const dx = nx * c - nz * sn;
      const dz = nz * c + nx * sn;
      for (let k = j === 0 ? 0 : 1; k < 5; k++) {
        const push = k * 0.12;
        this.qx = L.ex + nx * out + dx * push;
        this.qy = y;
        this.qz = L.ez + nz * out + dz * push;
        if (this.clear(world, false)) {
          this.bx = this.qx;
          this.by = y;
          this.bz = this.qz;
          return true;
        }
      }
    }
    return false;
  }

  /** The figure's offset for a hang loop: the clip's own hands put on the grip's line from where the body hangs. */
  private idleOffset(f: LedgeClipFacts, b: LedgeBody): void {
    this.gripOff(this.lip, b.pos, f.g0);
    this.setOffset();
  }

  /**
   * Where the figure's origin is drawn against a body standing at (bx, by, bz) so a clip's grip `g` (its own frame, turned
   * by `h`) lands on a lip's grip line, into `ax/ay/az`: only up and out (along the lip the clip's hands are its own).
   */
  private ax = 0.5;
  private ay = 0.5;
  private az = 0.5;
  private gripOff(L: Lip, at: { readonly x: number; readonly y: number; readonly z: number }, g: readonly [number, number, number]): void {
    const bx = at.x;
    const by = at.y;
    const bz = at.z;
    const T = CLIMB_TUNE;
    const s = this.s;
    this.toWorld(g);
    let x = L.ex + L.nx * T.gripOut * s - (bx + this.wx);
    const y = L.ey - T.gripDrop * s - (by + this.wy);
    let z = L.ez + L.nz * T.gripOut * s - (bz + this.wz);
    const tlx = -L.nz;
    const tlz = L.nx;
    const along = x * tlx + z * tlz;
    x -= tlx * along;
    z -= tlz * along;
    this.ax = x;
    this.ay = y;
    this.az = z;
  }

  /** Ease the drawn offset to (x, y, z) over the fade begun last. */
  private setOffset(): void {
    const x = this.ax;
    const y = this.ay;
    const z = this.az;
    this.fadeT += this.dtNow;
    const k = this.fadeDur > 0 ? Math.min(1, this.fadeT / this.fadeDur) : 1;
    this.offX = this.ofX + (x - this.ofX) * k;
    this.offY = this.ofY + (y - this.ofY) * k;
    this.offZ = this.ofZ + (z - this.ofZ) * k;
  }

  /** The hands' line on a lip: the grip's height, out from the face, along the lip. */
  private lineFor(L: Lip): void {
    const T = CLIMB_TUNE;
    const s = this.s;
    this.lineX = L.ex + L.nx * T.gripOut * s;
    this.lineY = L.ey - T.gripDrop * s;
    this.lineZ = L.ez + L.nz * T.gripOut * s;
    this.lineTx = -L.nz;
    this.lineTz = L.nx;
    this.lineSlope = L.slope;
  }

  /** The figure's tilt eased toward its goal over `climb.ease`, by the frame's seconds. */
  private easeTilt(): void {
    const e = CLIMB_TUNE.ease;
    const g = this.tiltGoal;
    if (!(e > 0)) {
      this.tilt = g;
      return;
    }
    const k = Math.min(1, this.dtNow / e);
    this.tilt += (g - this.tilt) * k;
    if (this.tilt < 1e-6 && this.tilt > -1e-6 && g === 0) this.tilt = 0;
  }

  /** The hands' and the feet's shares eased toward their goals (`goalHands`, `goalFeet`) over `climb.ease`, by the frame's seconds. */
  private easeLimbs(): void {
    const e = CLIMB_TUNE.ease;
    const gh = this.goalHands;
    const gf = this.goalFeet;
    if (!(e > 0)) {
      this.hands = gh;
      this.feet = gf;
      return;
    }
    const step = this.dtNow / e;
    const h = this.hands;
    const f = this.feet;
    this.hands = h < gh ? Math.min(gh, h + step) : Math.max(gh, h - step);
    this.feet = f < gf ? Math.min(gf, f + step) : Math.max(gf, f - step);
  }

  /** The frame's seconds, written as a step or a peer's frame begins (fields, so no number crosses a call). */
  private dtNow = 0.5;
  /** The hands' and feet's goals this frame. */
  private goalHands = 0.5;
  private goalFeet = 0.5;

  /** The loop's state word: a hang still or a shimmy, braced or free. */
  loopState(braced: boolean, shimmy: number): string {
    if (shimmy > 0) return braced ? 'shimmyBracedL' : 'shimmyFreeL';
    if (shimmy < 0) return braced ? 'shimmyBracedR' : 'shimmyFreeR';
    return braced ? 'hangBraced' : 'hangFree';
  }

  /** A one-off's end: the hang, standing on the top, or the fall. */
  private endMove(world: LedgeWorld, b: LedgeBody, i: LedgeIn): void {
    const m = this.move;
    // (The feedback round's presses kept through a grab go with it.)
    this.pendJump = false;
    this.pendForward = false;
    this.pendCrouch = false;
    b.pos.x = m.tx;
    b.pos.y = m.ty;
    b.pos.z = m.tz;
    if (m.after === AFTER_STAND) {
      this.phase = LEDGE_NONE;
      // It ends crouched on the top (the on-foot frame keeps it so until a standing capsule fits: `keepCrouched`).
      this.crouchedNow = true;
      this.keepCrouched = true;
      this.ended = true;
      this.stood = true;
      this.rigState = '';
      this.rigClip = '';
      // The climb's held last frame (its feet on the top, lined up with the body's) fades into the crouch: so does the offset.
      this.ofX = this.offX;
      this.ofY = this.offY;
      this.ofZ = this.offZ;
      this.outDur = Math.max(CLIMB_TUNE.ease, 1e-3);
      this.outT = this.outDur;
      this.hands = 0;
      this.feet = 0;
      this.lastLetGo = 'climbed up';
      return;
    }
    this.lip.copy(m.lip);
    this.braced = m.braced;
    this.heading = m.heading;
    this.phase = LEDGE_HANG;
    this.shimmy = 0;
    this.crouchedNow = false;
    // The lip held, followed along its own edge either way from here (its corners, its curve, its slope).
    this.qflt = i.filter;
    this.railStart(world);
    // The one-off's held last frame fades into the hang's loop over the ease (the caller stops it so), and the offset with it.
    this.beginFade();
    this.ended = true;
    this.rigState = this.loopState(this.braced, 0);
    this.rigClip = (this.braced ? LEDGE_ROLES.braced : LEDGE_ROLES.free).idle;
    // Its line-up begun with no time gone (the fade starts here).
    const dtWas = this.dtNow;
    this.dtNow = 0;
    this.idleOffset(LEDGE_FACTS[this.rigClip], b);
    this.dtNow = dtWas;
    // Into a free hang where the feet find the wall: on to braced (a step down's way into a braced hang).
    if (!this.braced && m.kind !== 'turn' && this.bracedAt(world, this.lip, this.s, i.filter) && this.placeFor(world, this.lip, true, this.s, i.filter)) {
      this.startMove(LEDGE_ROLES.free.toOther, 'turn', b.pos.x, b.pos.y, b.pos.z, this.bx, this.by, this.bz, AFTER_HANG, true, this.heading, 'idle', 'idle', this.lip);
    }
  }

  /** Let the body go: its velocity what it is thrown at, the regrab clock begun, why kept. */
  letGo(b: LedgeBody, why: string, vx: number, vy: number, vz: number): void {
    this.regrabX = this.lip.ex;
    this.regrabY = this.lip.ey;
    this.regrabZ = this.lip.ez;
    this.regrabT = CLIMB_TUNE.regrab;
    this.release(why);
    // The drawn offset eases out from where it stands (the let-go's clip lined up by its hands as the body falls away).
    this.ofX = this.offX;
    this.ofY = this.offY;
    this.ofZ = this.offZ;
    this.outDur = Math.max(CLIMB_TUNE.dropCut, CLIMB_TUNE.ease, 1e-3);
    this.outT = this.outDur;
    b.vel.x = vx;
    b.vel.y = vy;
    b.vel.z = vz;
  }

  /** Crouch, or the stamina gone: the drop's let-go clip, then the fall. */
  private drop(b: LedgeBody, why: string): void {
    const roles = this.braced ? LEDGE_ROLES.braced : LEDGE_ROLES.free;
    this.letGo(b, why, this.lip.nx * 0.3, 0, this.lip.nz * 0.3);
    this.startClip = roles.drop;
    this.startFrom = 0;
    this.startFade = 0.08;
    this.cutIn = CLIMB_TUNE.dropCut;
  }

  /** S with Space: braced, the jump off backward (its clip turns the figure round, which the caller takes up once it has played); free, a drop with a push back. */
  private jumpOff(b: LedgeBody): void {
    const T = CLIMB_TUNE;
    const L = this.lip;
    if (this.braced) {
      const h = this.heading;
      this.letGo(b, 'jumped off', L.nx * T.jumpBack, T.jumpUp, L.nz * T.jumpBack);
      this.startClip = LEDGE_JUMP_OFF;
      this.startFrom = 0;
      this.startFade = 0.06;
      this.turnTo = (h + Math.PI) % TAU;
      this.turnIn = LEDGE_FACTS[LEDGE_JUMP_OFF].dur;
      return;
    }
    this.letGo(b, 'pushed off', L.nx * T.freePush, 0, L.nz * T.freePush);
    this.startClip = LEDGE_ROLES.free.drop;
    this.startFrom = 0;
    this.startFade = 0.08;
    this.cutIn = T.dropCut;
  }

  /**
   * Space with A or D: the nearest other lip that way within `hopSide` (the owner's addition: one on another face too).
   * The held lip is looked along its own edge that way (`walk`; going round its corners is the shimmy's, so the look stops
   * where the lip turns past 45 degrees from the held face's way, grows steeper than `lipSlope`, or ends); from there on,
   * across the gap, a lip is felt for straight on (its face within 60 degrees of the last one's way: the next pillar's front,
   * a wall at an angle, a step up or down) and facing back across the way (the near side of a block standing across it:
   * round a corner), at heights from 0.8 m under the held lip to `hopUp` over it, every 0.15 m out to the reach. Where one is
   * found, both hands' places on it, the body's place under it and the room all along the way there are checked before the
   * hop begins (straight, else bent out from the faces and up over what stands in its line); refused in words where there is
   * none. A hop along one lip going on the same way at the same height is refused too: that is the shimmy.
   */
  private hop(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina, dir: number): void {
    const T = CLIMB_TUNE;
    const s = this.s;
    const hi = dir > 0;
    const range = T.hopSide * s;
    const tanMax = Math.tan((T.lipSlope * Math.PI) / 180);
    const hnx = this.lip.nx;
    const hnz = this.lip.nz;
    this.qflt = i.filter;
    // The look along the held lip, from the body's own place on it.
    const R = this.rail;
    const W = this.walk;
    R.q = this.barc;
    R.sample();
    const C = this.cand;
    C.ex = R.sx;
    C.ey = R.sy;
    C.ez = R.sz;
    C.nx = R.snx;
    C.nz = R.snz;
    C.topNy = R.stop;
    W.start(C);
    let ex = R.sx;
    let ey = R.sy;
    let ez = R.sz;
    let enx = R.snx;
    let enz = R.snz;
    let from = 0;
    for (let it = 0; it < 200; it++) {
      const k = hi ? W.n - 1 : 0;
      const at = hi ? W.a[k] : -W.a[k];
      if (at > range) {
        this.said = 'No ledge to hop to.';
        return;
      }
      ex = W.x[k];
      ey = W.y[k];
      ez = W.z[k];
      enx = hi ? W.hiNx : W.loNx;
      enz = hi ? W.hiNz : W.loNz;
      from = at;
      if (!this.followStep(world, W, hi)) break;
      const nk = hi ? W.n - 1 : 0;
      const nnx = hi ? W.hiNx : W.loNx;
      const nnz = hi ? W.hiNz : W.loNz;
      if (nnx * hnx + nnz * hnz < Math.SQRT1_2) {
        // Round a corner: across the way from the corner itself.
        if (this.cornered) {
          const dx = this.cornerX - ex;
          const dz = this.cornerZ - ez;
          from += Math.sqrt(dx * dx + dz * dz);
          ex = this.cornerX;
          ey = this.cornerY;
          ez = this.cornerZ;
        }
        break;
      }
      const dx = W.x[nk] - ex;
      const dz = W.z[nk] - ez;
      const dy = W.y[nk] - ey;
      const dl = Math.sqrt(dx * dx + dz * dz);
      if (dl > 1e-6 && (dy > tanMax * dl || -dy > tanMax * dl)) break;
    }
    const etx = -enz * dir;
    const etz = enx * dir;
    this.handHalf(this.braced);
    const half = this.hh;
    const out = half + T.edgeAhead * s;
    // Facing back across the way: a block's near side, out from the held face's line by the hands' reach and a hand's width
    // (its lip runs out from that line), felt for once low down (a block standing up from below, its top no more than 0.8 m
    // under the held lip): how far along it stands.
    let back = Number.POSITIVE_INFINITY;
    let bx = 0;
    let bz = 0;
    let bnx = 0;
    let bnz = 0;
    if (from < range) {
      this.qx = ex + enx * out;
      this.qy = ey - 0.75;
      this.qz = ez + enz * out;
      this.qdx = etx;
      this.qdy = 0;
      this.qdz = etz;
      this.qlen = range - from + 0.35;
      if (this.cast(world)) {
        const h = this.hit;
        let mx = h.nx;
        let mz = h.nz;
        const ml = Math.sqrt(mx * mx + mz * mz);
        const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
        if (h.toi > 1e-4 && h.ny < walk && ml > 1e-6 && (mx * etx + mz * etz) / ml < -0.5) {
          mx /= ml;
          mz /= ml;
          back = h.toi;
          bx = h.x;
          bz = h.z;
          bnx = mx;
          bnz = mz;
        }
      }
    }
    for (let d = 0.15; from + d <= range + 1e-9 && d < back; d += 0.15) {
      // Straight on across the gap: the near end of a lip whose face looks roughly the held way.
      this.fpx = ex + etx * d;
      this.fpz = ez + etz * d;
      this.fref = ey;
      this.frise = T.hopUp * s + 0.1;
      this.ffall = 0.8;
      this.fnx = enx;
      this.fnz = enz;
      this.facc = 0.5;
      if (this.probeLip(world) && this.hopTo(world, b, i, stam, dir, false)) return;
      if (this.said) return;
    }
    if (back < Number.POSITIVE_INFINITY && from + back <= range + 1e-9) {
      this.fpx = bx;
      this.fpz = bz;
      this.fref = ey;
      this.frise = T.hopUp * s + 0.1;
      this.ffall = 0.8;
      this.fnx = bnx;
      this.fnz = bnz;
      this.facc = CORNER_COS;
      if (this.probeLip(world) && this.hopTo(world, b, i, stam, dir, true)) return;
      if (this.said) return;
    }
    this.said = 'No ledge to hop to.';
  }

  /**
   * A lip found for a hop (the probe's answer: its near end straight on, or a point of a block's near side facing back):
   * the body's middle on it where both hands are on it (half the hands' span on from a near end), each hand's place probed,
   * the hang's kind there, its place clear, and the way there clear (straight, else bent: `HOP_BENDS`). Begins the hop and
   * answers true; false where the lip is too short for both hands (the look goes on); a refusal in words where there is no
   * room (`said`, and true: the look stops).
   */
  private hopTo(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina, dir: number, back: boolean, arc = 0, clip = ''): boolean {
    const T = CLIMB_TUNE;
    const s = this.s;
    this.handHalf(this.braced);
    const half = this.hh;
    const mx = this.fonx;
    const mz = this.fonz;
    const ref = this.foy;
    // The new lip's own way, on from where it was found (away from the gap; a facing-back side's out from the held face).
    const tx = -mz * dir;
    const tz = mx * dir;
    const on = back ? 0 : half + 0.05;
    const cx = this.fox + tx * on;
    const cz = this.foz + tz * on;
    const A = this.cand;
    // The body's middle, and each hand's place either side of it.
    this.fnx = mx;
    this.fnz = mz;
    this.fref = ref;
    this.frise = 0.3;
    this.ffall = 0.3;
    this.facc = CORNER_COS;
    for (let k = -1; k <= 1; k += 2) {
      this.fpx = cx + tx * half * k;
      this.fpz = cz + tz * half * k;
      if (!this.probeLip(world)) return false;
    }
    this.fpx = cx;
    this.fpz = cz;
    if (!this.probeLip(world)) return false;
    A.ex = this.fox;
    A.ey = this.foy;
    A.ez = this.foz;
    A.nx = this.fonx;
    A.nz = this.fonz;
    A.topNy = this.fotop;
    this.measureSlope(world, A, i.filter);
    const braced = this.bracedAt(world, A, s, i.filter);
    if (!this.placeFor(world, A, braced, s, i.filter)) {
      this.said = 'No room to hop there.';
      return true;
    }
    // The way there: straight, else bent out from the faces and up over what stands in its line.
    const m = this.move;
    m.fx = b.pos.x;
    m.fy = b.pos.y;
    m.fz = b.pos.z;
    m.tx = this.bx;
    m.ty = this.by;
    m.tz = this.bz;
    m.path = PATH_LINE;
    // Climbing II, item 4: the way arced up at its middle by `arc` of its length (nought: today's straight line).
    let lift = 0;
    if (arc > 0) {
      const ddx = m.tx - m.fx;
      const ddy = m.ty - m.fy;
      const ddz = m.tz - m.fz;
      // The control point twice the middle's rise (a quadratic passes half way to it at its middle).
      lift = 2 * arc * Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      m.path = PATH_CURVE;
      m.cx = (m.fx + m.tx) * 0.5;
      m.cy = (m.fy + m.ty) * 0.5 + lift;
      m.cz = (m.fz + m.tz) * 0.5;
    }
    let ok = this.pathClear(world);
    if (!ok) {
      let ox = this.lip.nx + A.nx;
      let oz = this.lip.nz + A.nz;
      const ol = Math.sqrt(ox * ox + oz * oz);
      if (ol > 1e-6) {
        ox /= ol;
        oz /= ol;
      } else {
        ox = this.lip.nx;
        oz = this.lip.nz;
      }
      const midX = (m.fx + m.tx) * 0.5;
      const midY = (m.fy + m.ty) * 0.5;
      const midZ = (m.fz + m.tz) * 0.5;
      m.path = PATH_CURVE;
      for (let k = 0; k < HOP_BENDS.length && !ok; k += 2) {
        // The curve's control point twice the middle's bend out (a quadratic passes half way to it at its middle).
        const bo = HOP_BENDS[k] * s * 2;
        const bu = HOP_BENDS[k + 1] * s * 2;
        m.cx = midX + ox * bo;
        m.cy = midY + bu + lift;
        m.cz = midZ + oz * bo;
        ok = this.pathClear(world);
      }
    }
    if (!ok) {
      this.said = 'No room to hop there.';
      return true;
    }
    const path = m.path;
    const cxx = m.cx;
    const cyy = m.cy;
    const czz = m.cz;
    const roles = this.braced ? LEDGE_ROLES.braced : LEDGE_ROLES.free;
    stam.step(1, -T.stamina.hop, i.pool, LOCO_TUNE);
    this.startMove(clip || (dir > 0 ? roles.hopLeft : roles.hopRight), 'hop', b.pos.x, b.pos.y, b.pos.z, this.bx, this.by, this.bz, AFTER_HANG, braced, Math.atan2(-A.nx, -A.nz), 'idle', 'idle', A);
    m.path = path;
    m.cx = cxx;
    m.cy = cyy;
    m.cz = czz;
    return true;
  }

  /** Space with W: a lip above within `hopUp` on the same face (braced only; a free hang has nothing to brace on to hop). */
  private hopUp(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina): boolean {
    const T = CLIMB_TUNE;
    const s = this.s;
    const L = this.lip;
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    // A face over the lip, a little behind its edge: there is wall above to hop up.
    this.qflt = i.filter;
    this.qx = L.ex + L.nx * 0.6;
    this.qy = L.ey + 0.3 * s;
    this.qz = L.ez + L.nz * 0.6;
    this.qdx = -L.nx;
    this.qdy = 0;
    this.qdz = -L.nz;
    this.qlen = 1.2;
    if (!this.cast(world) || this.hit.ny >= walk) return false;
    if (!this.braced) {
      this.said = 'A free hang cannot hop up: nothing to brace the feet on.';
      return true;
    }
    // Up the face until it ends: the upper lip is under the first ray that meets nothing.
    let lastFace = 0.3 * s;
    let faceX = this.hit.x;
    let faceZ = this.hit.z;
    let top = Number.NaN;
    for (let y = 0.45 * s; y <= T.hopUp * s + 0.1; y += 0.15 * s) {
      this.qy = L.ey + y;
      if (this.cast(world) && this.hit.ny < walk) {
        lastFace = y;
        faceX = this.hit.x;
        faceZ = this.hit.z;
        continue;
      }
      // Down onto it from here, behind the face.
      this.qx = faceX - L.nx * TOP_IN;
      this.qy = L.ey + y + 0.05;
      this.qz = faceZ - L.nz * TOP_IN;
      this.qdx = 0;
      this.qdy = -1;
      this.qdz = 0;
      this.qlen = y - lastFace + 0.1;
      if (this.cast(world) && this.hit.ny >= walk) top = this.hit.y;
      break;
    }
    if (!(top === top)) {
      this.said = 'No ledge above to hop to.';
      return true;
    }
    const A = this.cand;
    A.ex = faceX;
    A.ey = top;
    A.ez = faceZ;
    A.nx = L.nx;
    A.nz = L.nz;
    A.topNy = this.hit.ny;
    A.slope = 0;
    if (!this.placeFor(world, A, true, s, i.filter)) {
      this.said = 'No room to hop up there.';
      return true;
    }
    // The way up clear of what stands still (the fix round's).
    const m = this.move;
    m.fx = b.pos.x;
    m.fy = b.pos.y;
    m.fz = b.pos.z;
    m.tx = this.bx;
    m.ty = this.by;
    m.tz = this.bz;
    m.path = PATH_LINE;
    if (!this.pathClear(world)) {
      this.said = 'No room to hop up there.';
      return true;
    }
    this.measureSlope(world, A, i.filter);
    stam.step(1, -T.stamina.hop, i.pool, LOCO_TUNE);
    this.startMove(LEDGE_ROLES.braced.hopUp ?? LEDGE_ROLES.braced.idle, 'hop', b.pos.x, b.pos.y, b.pos.z, this.bx, this.by, this.bz, AFTER_HANG, true, this.heading, 'idle', 'idle', A);
    return true;
  }

  // ---- Climbing II, phase 2: hops in a band (item 4) and the small jump off (item 3) ------------------------------------------

  /** The band search's candidates (up and down hops): each lip found, its place, face, top and how far it stands from the hang. */
  private readonly bandC = new Float64Array(BAND_CAP * 7);
  private bandN = 0;

  /**
   * Item 4: a hop's target searched in a band in the asked way (`sx` +1 the figure's left, -1 its right, 0 neither; `sy` +1
   * up, -1 down, 0 level): sideways, across the gap out to `hopSide` from the held lip's end (the lip looked along to its end
   * that way first, as today's hop does), from `hopDown` under the held lip to `hopUp` over it (only over it with W, only
   * under it with S), the face up to `hopDepth` in front of or behind the held one's line; up or down (no side), straight
   * over or under the hang to `hopUp` or `hopDown`, `hopSlack` either side, the face as far in front or behind. The nearest
   * lip a hop can reach (both hands on it, the hang's room there, the way there clear: `hopTo`) is taken, near and far alike,
   * its way arced by `hopArc`. True where a hop began; false where none was found (nothing said: the caller decides).
   */
  private hopBand(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina, sx: number, sy: number): boolean {
    this.qflt = i.filter;
    this.said = '';
    if (sx !== 0) return this.bandSide(world, b, i, stam, sx > 0, sy);
    return this.bandUpDown(world, b, i, stam, sy);
  }

  /** The band sideways (`hopBand`'s first half): the held lip to its end, then across the gap, nearest first. */
  private bandSide(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina, hi: boolean, sy: number): boolean {
    const T = CLIMB_TUNE;
    const s = this.s;
    const dir = hi ? 1 : -1;
    const range = T.hopSide * s;
    const tanMax = Math.tan((T.lipSlope * Math.PI) / 180);
    const hnx = this.lip.nx;
    const hnz = this.lip.nz;
    // The look along the held lip, from the body's own place on it (today's hop's), to its end that way.
    const R = this.rail;
    const W = this.walk;
    R.q = this.barc;
    R.sample();
    const C = this.cand;
    C.ex = R.sx;
    C.ey = R.sy;
    C.ez = R.sz;
    C.nx = R.snx;
    C.nz = R.snz;
    C.topNy = R.stop;
    W.start(C);
    let ex = R.sx;
    let ey = R.sy;
    let ez = R.sz;
    let enx = R.snx;
    let enz = R.snz;
    for (let it = 0; it < 200; it++) {
      const k = hi ? W.n - 1 : 0;
      const at = hi ? W.a[k] : -W.a[k];
      // The held lip goes on further than a hop reaches: that is the shimmy's.
      if (at > range) return false;
      ex = W.x[k];
      ey = W.y[k];
      ez = W.z[k];
      enx = hi ? W.hiNx : W.loNx;
      enz = hi ? W.hiNz : W.loNz;
      if (!this.followStep(world, W, hi)) break;
      const nk = hi ? W.n - 1 : 0;
      const nnx = hi ? W.hiNx : W.loNx;
      const nnz = hi ? W.hiNz : W.loNz;
      if (nnx * hnx + nnz * hnz < Math.SQRT1_2) {
        if (this.cornered) {
          ex = this.cornerX;
          ey = this.cornerY;
          ez = this.cornerZ;
        }
        break;
      }
      const dx = W.x[nk] - ex;
      const dz = W.z[nk] - ez;
      const dy = W.y[nk] - ey;
      const dl = Math.sqrt(dx * dx + dz * dz);
      if (dl > 1e-6 && (dy > tanMax * dl || -dy > tanMax * dl)) break;
    }
    const etx = -enz * dir;
    const etz = enx * dir;
    this.handHalf(this.braced);
    const out = this.hh + T.edgeAhead * s;
    const up = sy < 0 ? 0.3 : T.hopUp * s + 0.1;
    const down = sy > 0 ? 0.3 : T.hopDown * s + 0.1;
    // A block standing across the way (its near side facing back, as today's hop feels for it), low down.
    let back = Number.POSITIVE_INFINITY;
    let bx = 0;
    let bz = 0;
    let bnx = 0;
    let bnz = 0;
    this.qx = ex + enx * out;
    this.qy = ey - 0.75;
    this.qz = ez + enz * out;
    this.qdx = etx;
    this.qdy = 0;
    this.qdz = etz;
    this.qlen = range + 0.35;
    if (this.cast(world)) {
      const h = this.hit;
      let mx = h.nx;
      let mz = h.nz;
      const ml = Math.sqrt(mx * mx + mz * mz);
      const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
      if (h.toi > 1e-4 && h.ny < walk && ml > 1e-6 && (mx * etx + mz * etz) / ml < -0.5) {
        mx /= ml;
        mz /= ml;
        back = h.toi;
        bx = h.x;
        bz = h.z;
        bnx = mx;
        bnz = mz;
      }
    }
    const depthMost = T.hopDepth * s;
    // Columns every `BAND_STEP` out to a step past the reach (a lip whose near end stands within it is met by the column past it).
    for (let d = BAND_STEP; d <= range + BAND_STEP + 1e-9 && d < back; d += BAND_STEP) {
      // Straight on across the gap, then in front of and behind the held face's line, nearest first.
      for (let j = 0; j < 2 * BAND_DEPTHS + 1; j++) {
        const step = (j + 1) >> 1;
        const dep = (j & 1 ? 1 : -1) * step * BAND_STEP;
        if (step * BAND_STEP > depthMost + 1e-9) break;
        this.fpx = ex + etx * d + enx * dep;
        this.fpz = ez + etz * d + enz * dep;
        this.fref = ey;
        this.frise = up;
        this.ffall = down;
        this.fnx = enx;
        this.fnz = enz;
        this.facc = 0.5;
        if (this.probeLip(world) && this.hopTo(world, b, i, stam, dir, false, T.hopArc)) {
          if (this.phase === LEDGE_MOVE) return true;
          // No room there: further on may have it.
          this.said = '';
        }
      }
    }
    if (back < Number.POSITIVE_INFINITY && back <= range + 1e-9) {
      this.fpx = bx;
      this.fpz = bz;
      this.fref = ey;
      this.frise = up;
      this.ffall = down;
      this.fnx = bnx;
      this.fnz = bnz;
      this.facc = CORNER_COS;
      if (this.probeLip(world) && this.hopTo(world, b, i, stam, dir, true, T.hopArc) && this.phase === LEDGE_MOVE) return true;
      this.said = '';
    }
    return false;
  }

  /**
   * The band up or down (`hopBand`'s second half): columns over or under the hang along the held lip, `hopSlack` either
   * side, each in front of and behind the held face's line by up to `hopDepth`; every lip found kept, and tried nearest
   * first. A free hang hops down and never up (it has nothing to brace the feet on, today's own refusal).
   */
  private bandUpDown(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina, sy: number): boolean {
    const T = CLIMB_TUNE;
    const s = this.s;
    if (sy > 0 && !this.braced) return false;
    const L = this.lip;
    const nx = L.nx;
    const nz = L.nz;
    // The figure's left along the held lip.
    const tlx = -nz;
    const tlz = nx;
    const slack = T.hopSlack * s;
    const depthMost = T.hopDepth * s;
    const reach = sy > 0 ? T.hopUp * s : T.hopDown * s;
    const C = this.bandC;
    this.bandN = 0;
    // Nothing within this of the held lip's own height is a lip above or below it.
    const near = 0.25 * s;
    for (let ju = 0; ju < 2 * BAND_SIDES + 1; ju++) {
      const su = (ju + 1) >> 1;
      const u = (ju & 1 ? 1 : -1) * su * BAND_STEP;
      if (su * BAND_STEP > slack + 1e-9) break;
      for (let j = 0; j < 2 * BAND_DEPTHS + 1; j++) {
        const step = (j + 1) >> 1;
        const dep = (j & 1 ? 1 : -1) * step * BAND_STEP;
        if (step * BAND_STEP > depthMost + 1e-9) break;
        this.fpx = L.ex + tlx * u + nx * dep;
        this.fpz = L.ez + tlz * u + nz * dep;
        if (sy > 0) {
          this.fref = L.ey + near;
          this.frise = reach - near + 0.1;
          this.ffall = 0;
        } else {
          this.fref = L.ey - near;
          this.frise = 0;
          this.ffall = reach - near + 0.1;
        }
        this.fnx = nx;
        this.fnz = nz;
        this.facc = 0.5;
        if (!this.probeLip(world) || this.bandN >= BAND_CAP) continue;
        const dy = this.foy - L.ey;
        const k = this.bandN * 7;
        C[k] = this.fox;
        C[k + 1] = this.foy;
        C[k + 2] = this.foz;
        C[k + 3] = this.fonx;
        C[k + 4] = this.fonz;
        C[k + 5] = this.fotop;
        C[k + 6] = Math.sqrt(u * u + dy * dy + dep * dep);
        this.bandN++;
      }
    }
    // Nearest first: each pick the least distance not tried yet (tried ones marked Infinity).
    const roles = this.braced ? LEDGE_ROLES.braced : LEDGE_ROLES.free;
    for (let tries = 0; tries < this.bandN; tries++) {
      let best = -1;
      let bd = Number.POSITIVE_INFINITY;
      for (let q = 0; q < this.bandN; q++) {
        const dq = C[q * 7 + 6];
        if (dq < bd) {
          bd = dq;
          best = q;
        }
      }
      if (best < 0) break;
      const k = best * 7;
      C[k + 6] = Number.POSITIVE_INFINITY;
      this.fox = C[k];
      this.foy = C[k + 1];
      this.foz = C[k + 2];
      this.fonx = C[k + 3];
      this.fonz = C[k + 4];
      this.fotop = C[k + 5];
      // Up a braced hang plays its own hop up; down (or across more than up) the hop toward the side it lands.
      const along = (this.fox - L.ex) * tlx + (this.foz - L.ez) * tlz;
      const dy = this.foy - L.ey;
      const clip = sy > 0 && dy >= (along < 0 ? -along : along) && roles.hopUp ? roles.hopUp : along > 0 ? roles.hopLeft : roles.hopRight;
      if (this.hopTo(world, b, i, stam, 1, true, T.hopArc, clip)) {
        if (this.phase === LEDGE_MOVE) return true;
        this.said = '';
        continue;
      }
      // The hands do not both fit about the column (the lip ends within a hand of it): the hang slid on along the lip found,
      // the side it lies to first (a lip whose near end is within the slack is within the band, not only one wide enough
      // about the column).
      const first = along < 0 ? -1 : 1;
      for (let w = 0; w < 2; w++) {
        const dir = w === 0 ? first : -first;
        this.fox = C[k];
        this.foy = C[k + 1];
        this.foz = C[k + 2];
        this.fonx = C[k + 3];
        this.fonz = C[k + 4];
        this.fotop = C[k + 5];
        if (this.hopTo(world, b, i, stam, dir, false, T.hopArc, clip)) {
          if (this.phase === LEDGE_MOVE) return true;
          this.said = '';
          break;
        }
      }
    }
    return false;
  }

  /**
   * Climbing II, item 7 (maker B): braced, hanging still, the view (`i.viewYaw`) turned more than `climb.lookStart` from the
   * wall: the side looked to leads (`lookSide`), the look eased in over `climb.ease` (`look`), the spine turned toward the
   * view by `climb.lookTwist` of it (`lookTwistNow`), and the leading side's hop clip named as the pose to hold
   * (`poseClip`, `poseAt`). Anything else eases it out; a change of side lets the old hand back onto the lip first.
   */
  private lookStep(i: LedgeIn): void {
    const T = CLIMB_TUNE;
    let want = 0;
    if (T.lookAway === 'reach' && this.phase === LEDGE_HANG && this.braced && this.shimmy === 0 && !i.leftHeld && !i.rightHeld) {
      const v = i.viewYaw;
      if (v === v) {
        let off = v - this.heading;
        off -= Math.round(off / TAU) * TAU;
        const a = off < 0 ? -off : off;
        const start = (T.lookStart * Math.PI) / 180;
        if (a > (this.lookSide !== 0 ? start - LOOK_BACK : start)) {
          want = off > 0 ? 1 : -1;
          this.lookDx = Math.sin(v);
          this.lookDz = Math.cos(v);
        }
      }
    }
    const goal = want !== 0 && (this.lookSide === 0 || want === this.lookSide) ? 1 : 0;
    if (goal === 1) this.lookSide = want;
    const e = T.ease;
    const st = e > 0 ? i.dt / e : 1;
    let k = this.look;
    if (goal === 1) k = k + st < 1 ? k + st : 1;
    else k = k - st > 0 ? k - st : 0;
    this.look = k;
    if (goal === 0 && k === 0) this.lookSide = 0;
    this.lookTwistNow = this.lookSide * ((T.lookTwist * Math.PI) / 180) * k;
    this.poseClip = goal === 1 ? (this.lookSide > 0 ? LEDGE_ROLES.braced.hopLeft : LEDGE_ROLES.braced.hopRight) : '';
    this.poseAt = T.lookPose;
  }

  /**
   * Item 7: Space while looking away: a lip behind in the view's level way (away from the held wall), its face turned back
   * toward the body, searched as the band searches (columns every `BAND_STEP` out to `climb.hopBehind`, `hopSlack` either
   * side, from `hopDown` under the held lip to `hopUp` over it), the nearest a hop can reach taken (`hopTo`: both hands
   * on it, the hang's room there, the way clear), its way arced by `hopArc`. The hop plays the leading side's hop clip on from
   * the held pose (`lookPose` in) and turns the body round the leading side's way. False where none is found.
   */
  private hopBehindTo(world: LedgeWorld, b: LedgeBody, i: LedgeIn, stam: LedgeStamina): boolean {
    const T = CLIMB_TUNE;
    const s = this.s;
    const L = this.lip;
    const dx = this.lookDx;
    const dz = this.lookDz;
    // Only away from the held wall.
    if (!(dx * L.nx + dz * L.nz > 0.2)) return false;
    this.qflt = i.filter;
    this.said = '';
    const range = T.hopBehind * s;
    const slack = T.hopSlack * s;
    const up = T.hopUp * s + 0.1;
    const down = T.hopDown * s + 0.1;
    const sx = -dz;
    const sz = dx;
    const clip = this.lookSide > 0 ? LEDGE_ROLES.braced.hopLeft : LEDGE_ROLES.braced.hopRight;
    for (let d = BAND_STEP; d <= range + BAND_STEP + 1e-9; d += BAND_STEP) {
      for (let j = 0; j < 2 * BAND_SIDES + 1; j++) {
        const su = (j + 1) >> 1;
        const u = (j & 1 ? 1 : -1) * su * BAND_STEP;
        if (su * BAND_STEP > slack + 1e-9) break;
        this.fpx = b.pos.x + dx * d + sx * u;
        this.fpz = b.pos.z + dz * d + sz * u;
        this.fref = L.ey;
        this.frise = up;
        this.ffall = down;
        this.fnx = -dx;
        this.fnz = -dz;
        this.facc = 0.5;
        if (!this.probeLip(world)) continue;
        if (!this.hopTo(world, b, i, stam, this.lookSide, true, T.hopArc, clip)) continue;
        if (this.phase !== LEDGE_MOVE) {
          // No room there: further on may have it.
          this.said = '';
          continue;
        }
        // On from the held pose, turned round the leading side's way.
        const m = this.move;
        const most = LEDGE_FACTS[clip].dur - 0.05;
        const t0 = T.lookPose < most ? T.lookPose : most;
        m.t0 = t0;
        m.time = t0;
        this.startFrom = t0;
        m.spin = this.lookSide;
        this.behindHops++;
        return true;
      }
    }
    return false;
  }

  /**
   * Item 3: Space with nowhere to hop: a small jump up and off the wall, as a small jump from the ground (`offUp` high,
   * pushed off at `offPush`), the figure going to the air's own pose as its line-up eases out (no clip of its own).
   */
  private jumpOffSmall(b: LedgeBody): void {
    const T = CLIMB_TUNE;
    const L = this.lip;
    const up = T.offUp > 0 ? Math.sqrt(2 * GRAVITY * T.offUp) : 0;
    this.letGo(b, 'jumped off a little', L.nx * T.offPush, up, L.nz * T.offPush);
  }

  /**
   * Space or W: up onto the top where a crouched capsule fits there (and over the lip on the way), else refused in words.
   * Today's climb is asked first, to the letter: the top at three depths in from where the clip's own travel puts the feet,
   * the first that fits, then the capsule's own way up to it. The feedback round: where that refuses, `climb.roomRule` 'fit'
   * tries a shorter climb (`climbShort`) before the refusal, and `climb.roomSay` 'why' names the test that failed first and
   * what it met (`room`, `roomWhy`).
   */
  private climbUp(world: LedgeWorld, b: LedgeBody, i: LedgeIn): void {
    const T = CLIMB_TUNE;
    const s = this.s;
    const L = this.lip;
    const R = this.room;
    this.roomBegin();
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    if (L.topNy < walk) {
      this.said = 'The top is too steep to stand on.';
      R.test = 'steep';
      R.result = 'refused';
      R.words = this.said;
      return;
    }
    const roles = this.braced ? LEDGE_ROLES.braced : LEDGE_ROLES.free;
    const f = LEDGE_FACTS[roles.climb];
    // Where the clip's own travel puts the feet: that far along its forward from the hang place, on the top.
    const fwd = f.net[2] * s;
    let in0 = fwd - (T.gripOut + (this.braced ? LEDGE_FACTS[LEDGE_ROLES.braced.idle] : LEDGE_FACTS[LEDGE_ROLES.free.idle]).g0[2]) * s;
    if (in0 < LEDGE_CAPSULE.r * 0.5) in0 = LEDGE_CAPSULE.r * 0.5;
    this.qflt = i.filter;
    // `climb.thinTop` 'hang': a top shallower than `topMin` behind its lip is no top to stand on.
    const deep = T.thinTop === 'hang' ? T.topMin * s : 0;
    this.narrowSeen = false;
    this.noting = true;
    let ok = false;
    for (let k = 0; k < 3 && !ok; k++) ok = this.topAt(world, L, in0 + k * 0.15, deep, walk);
    const narrow = this.narrowSeen;
    if (!ok && R.test === '') R.test = narrow ? 'narrow' : 'noTop';
    // An end found: a depth nearer it that met something is not why the climb is refused (its way up is asked next).
    if (ok) this.roomUnnote();
    const pathOk = ok && this.climbPath(world, b, L, CLIMB_LIFT, false);
    this.noting = false;
    if (pathOk) {
      // Under 'fit' a climb that ends where no standing body fits ends crouched, its clip cut there (today's: played whole).
      const crouched = T.roomRule === 'fit' && !this.standsAt(world);
      this.climbBegin(b, L, roles.climb, crouched);
      R.result = crouched ? 'whole, crouched' : 'whole';
      R.endDepth = this.endDepth;
      R.lift = CLIMB_LIFT;
      return;
    }
    // The feedback round's shorter climbs, where today's does not fit.
    if (T.roomRule === 'fit' && this.climbShort(world, b, L, roles.climb, in0, deep, walk)) {
      // (The console's report names what today's climb met, as a refusal's words would.)
      this.metWords();
      return;
    }
    R.result = 'refused';
    // Today's words where no end fitted (the narrow top before the room), and at the way up; or which test failed and why
    // (worked out whichever words are said, for the console's report).
    const why = this.roomWhy();
    if (!ok && narrow) this.said = 'The top is too narrow to stand on.';
    else this.said = T.roomSay === 'why' ? why : 'No room to climb up here.';
    R.words = this.said;
  }

  /** A climb up's report begun afresh (an event: a press of W or Space at the hang). */
  private roomBegin(): void {
    const R = this.room;
    R.asked++;
    R.test = '';
    R.depth = Number.NaN;
    R.leg = '';
    R.along = Number.NaN;
    R.crouched = false;
    R.brush = 0;
    R.x = Number.NaN;
    R.y = Number.NaN;
    R.z = Number.NaN;
    R.handle = -1;
    R.met = '';
    R.past = Number.NaN;
    R.rule = CLIMB_TUNE.roomRule;
    R.result = '';
    R.endDepth = Number.NaN;
    R.lift = Number.NaN;
    R.cut = false;
    R.words = '';
    this.metCollider = null;
  }

  /** The report's failure put down again (an end was found: what failed before it is no reason). */
  private roomUnnote(): void {
    const R = this.room;
    R.test = '';
    R.depth = Number.NaN;
    R.crouched = false;
    R.x = Number.NaN;
    R.y = Number.NaN;
    R.z = Number.NaN;
    R.handle = -1;
    this.metCollider = null;
  }

  /** A narrow top was met by the last climb up's depths. */
  private narrowSeen = false;
  /** The depth in from the lip the last top found stands at (`topAt`'s), metres. */
  private endDepth = 0.5;

  /**
   * The top `d` in from the lip (`L`): found by one ray down, deep enough to stand on (`deep`, the thin top's), and room for a
   * crouched body on it (a skin over it), into `bx/by/bz`. Today's test, one depth of it; its first failure noted while a climb
   * up is asked.
   */
  private topAt(world: LedgeWorld, L: Lip, d: number, deep: number, walk: number): boolean {
    // The top there (it may be a narrow wall's).
    this.qx = L.ex - L.nx * d;
    this.qy = L.ey + 0.3;
    this.qz = L.ez - L.nz * d;
    this.qdx = 0;
    this.qdy = -1;
    this.qdz = 0;
    this.qlen = 0.6;
    if (!this.cast(world) || this.hit.ny < walk) return false;
    const topY = this.hit.y;
    if (deep > d) {
      // The top goes on as far behind the lip as a body needs to stand on it, at its own height.
      this.qx = L.ex - L.nx * deep;
      this.qy = L.ey + 0.3;
      this.qz = L.ez - L.nz * deep;
      this.qlen = 0.6;
      if (!this.cast(world) || this.hit.ny < walk || this.hit.y - topY > 0.1 || topY - this.hit.y > 0.1) {
        this.narrowSeen = true;
        return false;
      }
    }
    this.qx = L.ex - L.nx * d;
    this.qy = topY + 0.02;
    this.qz = L.ez - L.nz * d;
    if (this.clear(world, true)) {
      this.bx = this.qx;
      this.by = topY;
      this.bz = this.qz;
      this.endDepth = d;
      return true;
    }
    const R = this.room;
    if (this.noting && R.test === '') {
      R.test = 'top';
      R.depth = d;
      this.noteMet(true);
    }
    return false;
  }

  /**
   * The capsule's own way up to the top found (`bx/by/bz`; the fix round's): out from the face until it stands clear of it,
   * up until its feet are `lift` over the top, then in onto the top crouched; every step of it clear of what stands still.
   * With `tuck` (the feedback round's 'fit') the body tucks crouched from where standing would meet something on the way up.
   * The move's path fields are written for `climbBegin`.
   */
  private climbPath(world: LedgeWorld, b: LedgeBody, L: Lip, lift: number, tuck: boolean): boolean {
    const m = this.move;
    const tx = this.bx;
    const ty = this.by;
    const tz = this.bz;
    const away = (b.pos.x - L.ex) * L.nx + (b.pos.z - L.ez) * L.nz;
    const need = LEDGE_CAPSULE.r + CLIMB_SKIN;
    const push = away < need ? need - away : 0;
    m.fx = b.pos.x;
    m.fy = b.pos.y;
    m.fz = b.pos.z;
    m.tx = tx;
    m.ty = ty;
    m.tz = tz;
    m.p1x = b.pos.x + L.nx * push;
    m.p1y = b.pos.y;
    m.p1z = b.pos.z + L.nz * push;
    m.p2x = m.p1x;
    m.p2y = (L.ey > ty ? L.ey : ty) + lift;
    m.p2z = m.p1z;
    m.l1 = push;
    m.l2 = m.p2y > m.p1y ? m.p2y - m.p1y : 0;
    const dx = tx - m.p2x;
    const dy = ty - m.p2y;
    const dz = tz - m.p2z;
    m.l3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
    m.path = PATH_LEGS;
    m.crouchFrom = 2;
    this.tuckOk = tuck;
    const ok = this.pathClear(world);
    this.tuckOk = false;
    return ok;
  }

  /**
   * The climb's one-off begun along the path `climbPath` worked out; `cut` (a short climb ending nearer the lip or tucked):
   * the clip ends where its figure crouches on the top with both feet down (`LEDGE_CLIMB_CUT`), lined up there by its feet,
   * and the rest of it is blended out as the climb ends (`ended`); a clip with no such row (the braced climb, which ends in its
   * crouch) is played whole.
   */
  private climbBegin(b: LedgeBody, L: Lip, clip: string, cut: boolean): void {
    const m = this.move;
    const tx = this.bx;
    const ty = this.by;
    const tz = this.bz;
    const p1x = m.p1x;
    const p1y = m.p1y;
    const p1z = m.p1z;
    const p2y = m.p2y;
    const l1 = m.l1;
    const l2 = m.l2;
    const l3 = m.l3;
    const tuckAt = m.crouchFrom;
    this.startMove(clip, 'climb', b.pos.x, b.pos.y, b.pos.z, tx, ty, tz, AFTER_STAND, this.braced, this.heading, 'idle', 'feet', L);
    m.path = PATH_LEGS;
    m.p1x = p1x;
    m.p1y = p1y;
    m.p1z = p1z;
    m.p2x = p1x;
    m.p2y = p2y;
    m.p2z = p1z;
    m.l1 = l1;
    m.l2 = l2;
    m.l3 = l3;
    m.crouchFrom = tuckAt;
    const c = cut ? LEDGE_CLIMB_CUT[clip] : undefined;
    if (c && c.t > m.t0 && c.t < m.T) {
      m.T = c.t;
      m.o1y = (LEDGE_REST.ankle - c.ankle) * this.s;
      this.room.cut = true;
    }
  }

  /**
   * The feedback round, item 2 (`climb.roomRule` 'fit'): today's climb up does not fit, so a shorter one is tried. Ends: today's
   * three depths, then nearer the lip (a depth step at a time, down to half the capsule's radius in); for each end found, the
   * way up at today's lift and then at `liftLeast`, the body tucked crouched where standing meets something; then all of them
   * again with a brush of `roomBrush` allowed. The first that fits is begun (cut where it ends nearer or tucked), and the
   * report says what it was. False where none does. Only as a climb up is asked (an event).
   */
  private climbShort(world: LedgeWorld, b: LedgeBody, L: Lip, clip: string, in0: number, deep: number, walk: number): boolean {
    const T = CLIMB_TUNE;
    const R = this.room;
    const least = LEDGE_CAPSULE.r * 0.5;
    const lowest = T.liftLeast < CLIMB_LIFT ? T.liftLeast : CLIMB_LIFT;
    for (let pass = 0; pass < 2; pass++) {
      const brush = pass === 0 ? 0 : T.roomBrush;
      if (pass === 1 && !(brush > 0)) break;
      this.brushNow = brush;
      for (let e = 0; e < 3 + SHORT_NEAR; e++) {
        const d = e < 3 ? in0 + e * 0.15 : in0 - (e - 2) * 0.15;
        if (e >= 3 && d < least - 1e-9) break;
        if (!this.topAt(world, L, d, deep, walk)) continue;
        for (let w = 0; w < 2; w++) {
          const lift = w === 0 ? CLIMB_LIFT : lowest;
          if (w === 1 && lift === CLIMB_LIFT) break;
          if (!this.climbPath(world, b, L, lift, true)) continue;
          this.brushNow = 0;
          const nearer = d < in0 - 1e-9;
          const deeper = d > in0 + 1e-9;
          const tucked = this.move.crouchFrom <= 1;
          const crouched = !this.standsAt(world);
          this.climbBegin(b, L, clip, nearer || tucked || crouched);
          const parts: string[] = [];
          if (nearer) parts.push('nearer');
          if (deeper) parts.push('deeper');
          if (tucked) parts.push('tucked');
          if (lift < CLIMB_LIFT) parts.push('lower');
          if (brush > 0) parts.push('brushed');
          if (crouched) parts.push('crouched');
          R.result = parts.length ? parts.join(', ') : 'another end';
          R.endDepth = d;
          R.lift = lift;
          this.climbsShort++;
          return true;
        }
      }
    }
    this.brushNow = 0;
    return false;
  }

  /** Whether a standing body fits where the top found stands (`bx/by/bz`, a skin over it): else the climb ends crouched. One shape test. */
  private standsAt(world: LedgeWorld): boolean {
    this.qx = this.bx;
    this.qy = this.by + 0.02;
    this.qz = this.bz;
    return this.clear(world, false);
  }

  /** The refusal in words: which test failed first, where, what it met and how far into it (`roomSay` 'why'). */
  private roomWhy(): string {
    const R = this.room;
    // What it met first (the message line cuts a long line at its end): its name, how far it reaches in, then where.
    const what = this.metWords();
    if (R.test === 'top') return `No room to climb up: ${what} in the way of a crouched body ${Math.round(R.depth * 100) / 100} m in from the lip.`;
    if (R.test === 'path') return `No room to climb up: ${what} in the way ${R.leg === 'out' ? 'out from the face' : R.leg === 'up' ? 'up past the lip' : 'in over the top'}.`;
    return 'No room to climb up: no top to stand on behind the lip.';
  }

  /** What the room test met, in words (the game's name, else its kind) and how far into it the capsule reached; into the report. */
  private metWords(): string {
    const R = this.room;
    const c = this.metCollider;
    if (!c) return 'something';
    const name = (this.namer ? this.namer(c) : null) ?? colliderKind(c);
    R.met = name;
    // How far into it: the capsule that met it, where it met it (Rapier's contact: a negative distance is a reach into it).
    const shape = R.crouched ? this.shapeCrouch : this.shapeStand;
    if (shape && R.x === R.x) {
      try {
        const hit = c.contactShape(shape, { x: R.x, y: R.y, z: R.z }, this.shapeRot, 0);
        if (hit) R.past = hit.distance < 0 ? -hit.distance : 0;
      } catch {
        // (A shape the engine has no contact for: said without how far.)
      }
    }
    // A placed thing's template said by its file's own name on the message line (the whole path stays in the report).
    const said = name.includes('/') ? name.replace(/^.*\//, '').replace(/^shared_/, '').replace(/\.iff$/, '') : name;
    return R.past === R.past ? `${said}, ${Math.round(R.past * 100)} cm` : said;
  }

  /** What `__debug.climb({ room: true })` says of the last climb up (`RoomReport`). */
  roomReport(): Record<string, unknown> {
    const R = this.room;
    const n = (v: number) => (v === v ? Math.round(v * 1000) / 1000 : null);
    return {
      asked: R.asked,
      rule: R.rule,
      result: R.result,
      test: R.test || null,
      depth: n(R.depth),
      leg: R.leg || null,
      along: n(R.along),
      crouched: R.crouched,
      brush: n(R.brush),
      at: R.x === R.x ? [n(R.x), n(R.y), n(R.z)] : null,
      met: R.met || null,
      handle: R.handle,
      pastM: n(R.past),
      endDepth: n(R.endDepth),
      lift: n(R.lift),
      cut: R.cut,
      words: R.words || null,
      short: this.climbsShort,
    };
  }

  /** After a climb up: whether a standing capsule now fits at the feet (then it stands, as the crouch key lets it). One shape test while asked. */
  standRoom(world: LedgeWorld, b: LedgeBody, flt: number): boolean {
    this.qflt = flt;
    this.qx = b.pos.x;
    this.qy = b.pos.y + 0.02;
    this.qz = b.pos.z;
    const ok = this.clear(world, false);
    if (ok) this.keepCrouched = false;
    return ok;
  }

  /** The heading the caller turns the body to this frame (`tick` answered true), radians. */
  turnNow = 0.5;
  /** The drop's clip ran out its `dropCut` this frame (the caller hands the body to the falling loop). */
  cutNow = false;

  /**
   * The caller's clocks after a let-go, every frame off the ledge: the drop clip's cut, the jump off's turn (true where the
   * body turns to `turnNow` this frame), and the drawn offset eased out. Nothing at all while none of them runs.
   */
  tick(dt: number): boolean {
    this.cutNow = false;
    // Climbing II, item 7: a look-away's spine turn eased back after a let-go (nothing at all while there is none).
    if (this.lookTwistNow !== 0) {
      const e = CLIMB_TUNE.ease;
      const kk = e > 0 ? Math.min(1, dt / e) : 1;
      this.lookTwistNow -= this.lookTwistNow * kk;
      if (this.lookTwistNow < 1e-6 && this.lookTwistNow > -1e-6) this.lookTwistNow = 0;
    }
    // A let-go's tilt eased back upright with the offset (nothing at all while there is none).
    if (this.tilt !== 0) {
      const e = CLIMB_TUNE.ease;
      const k = e > 0 ? Math.min(1, dt / e) : 1;
      this.tilt -= this.tilt * k;
      if (this.tilt < 1e-6 && this.tilt > -1e-6) this.tilt = 0;
    }
    if (this.cutIn > 0) {
      this.cutIn -= dt;
      if (this.cutIn <= 0) {
        this.cutIn = 0;
        this.cutNow = true;
      }
    }
    if (this.outT > 0) {
      this.outT -= dt;
      if (this.outT <= 0) {
        this.outT = 0;
        this.offX = 0;
        this.offY = 0;
        this.offZ = 0;
      } else {
        const k = this.outT / this.outDur;
        this.offX = this.ofX * k;
        this.offY = this.ofY * k;
        this.offZ = this.ofZ * k;
      }
    }
    if (this.turnTo === this.turnTo) {
      this.turnIn -= dt;
      if (this.turnIn <= 0) {
        this.turnNow = this.turnTo;
        this.turnTo = Number.NaN;
        return true;
      }
    }
    return false;
  }

  /**
   * The hands and the feet handed to the limbs' solve (src/player/limbPlace.ts), the figure posed and placed: each hand put
   * on the grip's line where the clip has it along the lip (so every figure grips at the clip's own spacing), by the
   * placement's share and by how near the clip itself has the hand to the line (a hop's or a climb's hands leave it on
   * their own); the feet on the wall's face while braced.
   */
  limbsFor(lp: LimbPlace, rig: LimbRig, toPhys: THREE.Matrix4 | null): void {
    // Hanging, and through a one-off whose hands stay on a lip (a hop's ends, a grab once caught, a turn onto or off the wall).
    const k = this.move.kind;
    this.lifted = 0;
    // Climbing II, item 7: the leading hand while looking away (-1 none): 0 the left, 1 the right.
    const lead = this.phase === LEDGE_HANG && this.look > 0 ? (this.lookSide > 0 ? 0 : this.lookSide < 0 ? 1 : -1) : -1;
    this.leadNow = lead;
    if (this.phase === LEDGE_HANG || (this.phase === LEDGE_MOVE && (k === 'hop' || k === 'grab' || k === 'turn'))) this.anchor(lp, rig, toPhys);
    for (let s = 0; s < 2; s++) {
      const g = lp.gripNow(rig, s, toPhys, gripV);
      if (!g || !(this.hands > 0)) {
        lp.handW[s] = 0;
        continue;
      }
      // Where the clip has the hand along the lip, and the lip there: its own height and face under that hand.
      this.tgAlong = (g.x - this.lineX) * this.lineTx + (g.z - this.lineZ) * this.lineTz;
      this.targetAt();
      const tx = this.tgx;
      const ty = this.tgy;
      const tz = this.tgz;
      const dx = g.x - tx;
      const dy = g.y - ty;
      const dz = g.z - tz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Wholly placed within a hand's width of the line, let go of by a forearm's length off it.
      const near = d <= HAND_NEAR ? 1 : d >= HAND_FAR ? 0 : 1 - (d - HAND_NEAR) / (HAND_FAR - HAND_NEAR);
      // Written into the limbs' own arrays (`setHand`'s), so no number crosses a call.
      lp.hand[s * 3] = tx;
      lp.hand[s * 3 + 1] = ty;
      lp.hand[s * 3 + 2] = tz;
      const w = this.hands * near;
      lp.handW[s] = w > 0 ? w : 0;
      // Climbing II, item 7: looking away, the leading hand leaves the lip and reaches toward the view (out along it from its
      // place on the lip, down to about the shoulder), by the look's share; `lookArm` of the way, the rest the held pose's own.
      if (s === lead) {
        const k = this.look;
        const sc = this.s;
        const rx = tx + this.lookDx * LOOK_OUT * sc;
        const ry = ty - LOOK_DOWN * sc;
        const rz = tz + this.lookDz * LOOK_OUT * sc;
        lp.hand[s * 3] = tx + (rx - tx) * k;
        lp.hand[s * 3 + 1] = ty + (ry - ty) * k;
        lp.hand[s * 3 + 2] = tz + (rz - tz) * k;
        const wl = (w > 0 ? w : 0) * (1 - k) + k * CLIMB_TUNE.lookArm;
        lp.handW[s] = wl;
      }
    }
    const L = this.lip;
    // The clip's own palms and both feet wholly on the wall (maker B's bracing and wall climb set their own).
    lp.palmW[0] = 0;
    lp.palmW[1] = 0;
    lp.footFade = false;
    // Each braced foot comes on and off the wall over the hands' own ease where its own ray meets the face or stops meeting it.
    lp.footStep = CLIMB_TUNE.ease > 0 ? this.dtNow / CLIMB_TUNE.ease : 1;
    lp.wallW = this.feet;
    lp.wall[0] = L.ex;
    lp.wall[1] = L.ey;
    lp.wall[2] = L.ez;
    lp.wall[3] = L.nx;
    lp.wall[4] = 0;
    lp.wall[5] = L.nz;
  }

  /** How far `limbsFor`'s anchor moved the rig's root up in its parent's frame this frame (a caller that takes its own offset back off adds it). */
  lifted = 0.5;
  /** Climbing II, item 7: the leading hand this frame (0 the left, 1 the right, -1 none), what the anchor leaves out. */
  private leadNow = -1;

  /**
   * The figure turned with a sloping lip (`tilt`) about its own front, pivoting on its hands' grip as its clip has them, so
   * the hands stay where the line-up put them: the root (already placed by the offset, in the figure's own frame: x left,
   * y up, z forward) turned and moved. How far it went up is `tiltLift` (a caller that takes its offset back off takes it
   * too). Nothing while there is no tilt (the caller puts the root's turn back).
   */
  tiltLift = 0.5;
  applyTilt(root: THREE.Object3D): void {
    const t = this.tilt;
    this.tiltLift = 0;
    if (t === 0) return;
    const f = LEDGE_FACTS[this.rigClip] ?? LEDGE_FACTS[this.braced ? LEDGE_ROLES.braced.idle : LEDGE_ROLES.free.idle];
    const gx = f.g0[0] * this.s;
    const gy = f.g0[1] * this.s;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    root.position.x += gx - (gx * c - gy * sn);
    const lift = gy - (gx * sn + gy * c);
    root.position.y += lift;
    this.tiltLift = lift;
    root.quaternion.set(0, 0, Math.sin(t * 0.5), Math.cos(t * 0.5));
  }

  /**
   * A hand's place on the lip for a grip `tgAlong` along the hands' line from its middle (in), into `tg*`: hanging, the lip
   * under it on the rail (its own height, its own face: round a corner, along a curve, up a slope), else the line of the lip
   * a one-off holds or is aimed at, risen by its slope. Out from the face by the grip's own `gripOut`, down by `gripDrop`.
   */
  tgAlong = 0.5;
  tgx = 0.5;
  tgy = 0.5;
  tgz = 0.5;
  targetAt(): void {
    const along = this.tgAlong;
    if (this.phase === LEDGE_HANG && this.rail.n > 0) {
      const T = CLIMB_TUNE;
      const s = this.s;
      const R = this.rail;
      R.q = this.barc + along;
      R.sample();
      this.tgx = R.sx + R.snx * T.gripOut * s;
      this.tgy = R.sy - T.gripDrop * s;
      this.tgz = R.sz + R.snz * T.gripOut * s;
      return;
    }
    this.tgx = this.lineX + this.lineTx * along;
    this.tgy = this.lineY + this.lineSlope * along;
    this.tgz = this.lineZ + this.lineTz * along;
  }

  /**
   * Hanging, the figure moved up so its lower posed hand is on the grip's line (and out from the face by the hands' middle),
   * by the hands' share: the body hangs from its hands, so a clip's own sway, and a crossfade between two clips (whose poses
   * blended are not the lined-up offsets blended), moves the body and never the hands. Lateral is the arms' own. Then
   * whatever an arm would still have to stretch to reach its place on the line, the body is moved toward it by, up and out
   * only. How far the root went up is `lifted`.
   */
  private anchor(lp: LimbPlace, rig: LimbRig, toPhys: THREE.Matrix4 | null): void {
    const w = this.hands;
    if (!(w > 0)) return;
    const l = lp.gripNow(rig, 0, toPhys, gripV);
    if (!l) return;
    const lx = l.x;
    const ly = l.y;
    const lz = l.z;
    const r = lp.gripNow(rig, 1, toPhys, gripV);
    if (!r) return;
    const rx = r.x;
    const ry = r.y;
    const rz = r.z;
    const mx = (lx + rx) * 0.5;
    const mz = (lz + rz) * 0.5;
    const nx = this.lip.nx;
    const nz = this.lip.nz;
    // Each hand's place on the lip under it (a sloping lip's at its own height, a corner's on its own face).
    this.tgAlong = (lx - this.lineX) * this.lineTx + (lz - this.lineZ) * this.lineTz;
    this.targetAt();
    const tlx = this.tgx;
    const tly = this.tgy;
    const tlz = this.tgz;
    this.tgAlong = (rx - this.lineX) * this.lineTx + (rz - this.lineZ) * this.lineTz;
    this.targetAt();
    const trx = this.tgx;
    const try_ = this.tgy;
    const trz = this.tgz;
    // Up by the hand furthest under its place: a hand over its place bends down onto it, one under it would have to stretch.
    const upL = tly - ly;
    const upR = try_ - ry;
    let up = upL > upR ? upL : upR;
    let out = ((tlx + trx) * 0.5 - mx) * nx + ((tlz + trz) * 0.5 - mz) * nz;
    // Climbing II, item 7: looking away, the body hangs by its trailing hand alone, by the look's share.
    const lead = this.leadNow;
    const lk = lead >= 0 ? this.look : 0;
    if (lk > 0) {
      const upT = lead === 0 ? upR : upL;
      const outT = lead === 0 ? (trx - rx) * nx + (trz - rz) * nz : (tlx - lx) * nx + (tlz - lz) * nz;
      up = up + (upT - up) * lk;
      out = out + (outT - out) * lk;
    }
    // Only a pose whose hands are on the lip already near enough (a forearm's length): never one flying past it.
    if (up * up + out * out > HAND_FAR * HAND_FAR) return;
    const root = rig.root;
    const parent = root.parent;
    if (!parent) return;
    // The shift in the physics frame, written by its components (no number crosses a call).
    const v = anchorV;
    v.x = nx * out;
    v.y = up;
    v.z = nz * out;
    const at = lp.reachAt;
    const dir = anchorD;
    for (let pass = 0; pass < 2; pass++) {
      for (let s = 0; s < 2; s++) {
        // (The leading hand while looking away is no anchor, by the look's share.)
        if (s === lead && lk >= 1) continue;
        at[0] = (s === 0 ? tlx : trx) - v.x;
        at[1] = (s === 0 ? tly : try_) - v.y;
        at[2] = (s === 0 ? tlz : trz) - v.z;
        lp.reachPastIn(rig, s, toPhys, dir);
        const e = lp.past;
        if (!(e > 0)) continue;
        // Up and out only (along the lip the hand's place moves with the body): by enough of that to close the gap.
        const tl = dir.x * this.lineTx + dir.z * this.lineTz;
        const dx = dir.x - this.lineTx * tl;
        const dy = dir.y;
        const dz = dir.z - this.lineTz * tl;
        const m2 = dx * dx + dy * dy + dz * dz;
        if (!(m2 > 0.01)) continue;
        const k = s === lead && lk > 0 ? ((e + REACH_SPARE) / m2) * (1 - lk) : (e + REACH_SPARE) / m2;
        v.x += dx * k;
        v.y += dy * k;
        v.z += dz * k;
      }
    }
    v.x *= w;
    v.y *= w;
    v.z *= w;
    // Into the world's frame, into the root's parent's.
    if (toPhys) {
      const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (len > 0) {
        v.transformDirection(anchorM.copy(toPhys).invert());
        v.x *= len;
        v.y *= len;
        v.z *= len;
      }
    }
    root.getWorldPosition(anchorP);
    anchorP.x += v.x;
    anchorP.y += v.y;
    anchorP.z += v.z;
    parent.worldToLocal(anchorP);
    this.lifted = anchorP.y - root.position.y;
    root.position.x = anchorP.x;
    root.position.y = anchorP.y;
    root.position.z = anchorP.z;
    root.updateMatrixWorld(true);
  }

  /**
   * Another player's figure hanging (their rig state says so; their game holds the lip): the lip in front of where their
   * figure hangs, found here from it (a ray into the face just under where their hands are, one down onto the top) and
   * kept while their figure stays within a centimetre, into this ledge's own lip and the hands' line. False where none is
   * near enough to where the hang puts their hands (their hands are then drawn as the clip has them).
   */
  peerLip(world: LedgeWorld, q: { readonly x: number; readonly y: number; readonly z: number; readonly heading: number; readonly scale: number; readonly filter: number }, braced: boolean): boolean {
    const T = CLIMB_TUNE;
    const x = q.x;
    const y = q.y;
    const z = q.z;
    const heading = q.heading;
    const s = q.scale;
    const flt = q.filter;
    const ex = x - this.peerX;
    const ey = y - this.peerY;
    const ez = z - this.peerZ;
    if (ex * ex + ey * ey + ez * ez < 1e-4 && this.peerH === heading && this.peerB === braced) return this.peerOk;
    this.peerX = x;
    this.peerY = y;
    this.peerZ = z;
    this.peerH = heading;
    this.peerB = braced;
    this.peerOk = false;
    // Their figure hangs here, as far as this side's anchor goes (limbsFor), only while a lip is found under its hands.
    this.phase = LEDGE_NONE;
    const f = braced ? LEDGE_FACTS[LEDGE_ROLES.braced.idle] : LEDGE_FACTS[LEDGE_ROLES.free.idle];
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const top = y + (hangOver(f) + T.gripDrop) * s;
    const walk = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    this.qflt = flt;
    this.qx = x;
    this.qy = top - 0.06;
    this.qz = z;
    this.qdx = fx;
    this.qdy = 0;
    this.qdz = fz;
    this.qlen = (T.gripOut + Math.abs(f.g0[2])) * s + 0.6;
    if (!this.cast(world) || this.hit.ny >= walk) return false;
    const faceX = this.hit.x;
    const faceZ = this.hit.z;
    let nx = this.hit.nx;
    let nz = this.hit.nz;
    const nl = Math.sqrt(nx * nx + nz * nz);
    if (!(nl > 1e-6)) return false;
    nx /= nl;
    nz /= nl;
    this.qx = faceX - nx * TOP_IN;
    this.qy = top + 0.3;
    this.qz = faceZ - nz * TOP_IN;
    this.qdx = 0;
    this.qdy = -1;
    this.qdz = 0;
    this.qlen = 0.6;
    if (!this.cast(world) || this.hit.ny < 0.2) return false;
    const L = this.lip;
    L.ex = faceX;
    L.ey = this.hit.y;
    L.ez = faceZ;
    L.nx = nx;
    L.nz = nz;
    L.topNy = this.hit.ny;
    L.slope = 0;
    this.s = s;
    this.braced = braced;
    this.phase = LEDGE_HANG;
    // The lip under each of their hands (round a corner, up a slope) as this side's own hang has it, and their figure's tilt.
    this.railStart(world);
    this.tilt = this.tiltGoal;
    this.lineFor(this.lip);
    this.peerOk = true;
    return true;
  }

  /** Where the haul's hand-over last looked and found nothing. */
  private haulX = Number.NaN;
  private haulY = Number.NaN;
  private haulZ = Number.NaN;

  /** The last place `peerLip` was asked at, and its answer. */
  private peerX = Number.NaN;
  private peerY = Number.NaN;
  private peerZ = Number.NaN;
  private peerH = Number.NaN;
  private peerB = false;
  private peerOk = false;

  /** Another player's figure: its hands and feet placed or not (`hands`, `feet`, each 0 or 1), eased toward over `climb.ease` by `i.dt`. */
  easeShares(hands: number, feet: number, i: { readonly dt: number }): void {
    this.dtNow = i.dt;
    this.goalHands = hands;
    this.goalFeet = feet;
    this.easeLimbs();
  }

  /** What the console says of the ledges. */
  report(): Record<string, unknown> {
    const n = (v: number) => Math.round(v * 1000) / 1000;
    return {
      phase: this.phase === LEDGE_NONE ? 'none' : this.phase === LEDGE_HANG ? 'hang' : `move (${this.move.kind}: ${this.move.id}, ${n(this.move.time)} of ${n(this.move.T)} s)`,
      braced: this.braced,
      shimmy: this.shimmy,
      rigState: this.rigState,
      lip: this.phase === LEDGE_NONE ? null : { edge: [n(this.lip.ex), n(this.lip.ey), n(this.lip.ez)], out: [n(this.lip.nx), n(this.lip.nz)], topUp: n(this.lip.topNy) },
      heading: n(this.heading),
      offset: [n(this.offX), n(this.offY), n(this.offZ)],
      slope: this.phase === LEDGE_NONE ? null : n((Math.atan(this.lip.slope) * 180) / Math.PI),
      tilt: n((this.tilt * 180) / Math.PI),
      rail: this.phase === LEDGE_NONE || this.rail.n === 0 ? null : { points: this.rail.n, from: n(this.rail.a[0] - this.barc), to: n(this.rail.a[this.rail.n - 1] - this.barc), ends: [this.rail.loEnd, this.rail.hiEnd] },
      hands: n(this.hands),
      feet: n(this.feet),
      keepCrouched: this.keepCrouched,
      // Climbing II, item 7: the look-away (the leading side, how far it has eased in, the spine's turn, the pose held).
      look: { side: this.lookSide, share: n(this.look), twist: n((this.lookTwistNow * 180) / Math.PI), pose: this.poseClip || null, behindHops: this.behindHops },
      grabs: this.grabs,
      casts: this.casts,
      lastLetGo: this.lastLetGo,
    };
  }
}
