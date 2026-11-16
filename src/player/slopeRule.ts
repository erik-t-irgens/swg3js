// The slope limit (wave 2b of the animations, the owner's brief's line 11 and his note of 2026-11-15: "sliding never
// happens. I'm always just anchored to the ground"). A face steeper than the climb limit is never ground: the body
// cannot stand, walk or rest on it, and slides down it under gravity.
//
// What held the body, measured on the real Rapier with the game's own movement (`tools/swg/tests/slopeLimit.test.ts`):
// the character controller calls a contact ground whenever its normal points up at all (the engine's own test is the
// normal's upward share over a thousandth, about 89.94 degrees), so on every face from flat to sheer the movement was
// handed "grounded"; on the ground the movement applies no gravity and the update zeroes any fall, so nothing ever asked
// the controller to move the body down the face. The snap to the ground (0.35 m) held a body walking across such a face
// onto it, and, asked of a body falling down one, drags it down a share of its reach every frame whatever the frame rate.
//
// The mend is four steps the player's update and the grapple's harness both call, in the same places:
//  - `controllerFor` before the move: the controller's climb angle the tune's limit; and while the body slides the snap
//    to the ground is off (the caller reads `sliding`);
//  - `judge` after the move: the controller's "grounded" stands where a walkable face is under the body (one ray down
//    from the capsule's lower sphere, which also finds the next stair under a stair's edge), or where any face the
//    controller could have called ground (a fan of rays from that sphere, FAN) is walkable, or where two steep faces
//    together hold the body up (a wedge); where the fan meets no face at all the body rests on an edge or a point, and
//    the faces that meet at it decide (`edgeProbe`: the nearest point of the world under the sphere, and one short ray
//    each side of it): a walkable face there is a lip, and stands; steep ones only are a peak or a knife edge, and slide;
//    none (a sheer wall's top, whose sides no rule reads) leaves the controller its word. Otherwise the body is on a face
//    too steep to stand on, and it is not ground;
//  - `slide` after that: the velocity is clipped onto the face (what pressed into it taken off, as Jedi Academy's
//    PM_SlideMove clips it), and the fall's memory held at the height the body's speed down into the ground is worth,
//    so a long slide pays at its end only for that speed, as a landing does;
//  - `share` before the next move: gravity's share along the face kept by the `slide` dial (nothing at its start, 1).
// Under the tune's 'before' none of it runs: `judge` answers the controller's word and nothing is asked of the engine.
//
// Nothing here makes an object on a frame but what the engine's own calls make (their answers, about 800 bytes a ray that
// meets something), and those are asked as seldom as the verdict allows: a verdict that the body stands is kept, with no
// ray, while the body stays on the plane the floor ray found (its height over that plane where it stood, within
// PLANE_HOLD, out to PLANE_REACH), or, for a stand found any other way (a lip, a wedge, a stair's edge), while it has not
// moved at all. So a body standing or walking on open ground casts once and then once every PLANE_REACH metres, or as it
// crosses onto another plane. The place is handed over in a kept record (`at`), never as numbers, which a call the
// compiler does not build in would box.

import { RAPIER } from '../core/physics.ts';
import { LOCO_TUNE } from '../anim/locoTune.ts';
import { JKA, UNIT } from './jkaMove.ts';

/** The controller's own numbers when it is made (`Player.makeBody`): what it is put back to whenever the rule says nothing. */
export const MADE_CLIMB = (55 * Math.PI) / 180;
/**
 * How far below the capsule's lower sphere the floor ray looks for a walkable face, metres: the snap's 0.35 and the
 * controller's 0.04 offset. A walkable ramp at the limit (55 degrees) lies 0.68 m under the sphere's middle, inside
 * the sphere's 0.35 and this; a stair under a step's edge lies within it too, up to the autostep's 0.5.
 */
export const FLOOR_REACH = 0.4;
/**
 * How far off the floor ray's walkable face (along that face's normal, past the sphere's radius) a body that was sliding
 * may sit for that face alone to make it ground, metres. Further off, it is still held up by the steep face it slides
 * down, and what it touches decides (the fan, then the edge). Without this a slide ended where the floor first came
 * within the ray's reach and the body hung there, up to 0.4 m over it (the controller calls the steep face ground, so it
 * does not snap): measured, 6 of 144 slides down faces of 58 to 89 degrees at 30, 60 and 144 frames a second ended 0.2 to
 * 0.29 m up. Only after a slide: a standing body is held up the floor ray's whole reach as ever (measured up to 0.07 m
 * off a flat floor at 30 frames a second, 0.18 at a landing's first frame, 0.30 at a stair's edge; and asked of it, the
 * autostep onto a bevelled curb of 62 to 80 degrees failed, the body leaning on the bevel and the floor ray on the street).
 * Nor after a fall: asked of any body not standing the frame before, it changed two curb walks at 144 frames a second (the
 * autostep leaves the body ungrounded for a frame), so a body that falls straight into the crease where a steep face meets
 * the floor can still come to rest leaning on the face over the floor (measured: 42 of 192 such drops ended 0.08 to 0.32 m
 * up, against 165 of the 192 under the rule before).
 */
export const FLOOR_TOUCH = 0.12;
/**
 * How far past the capsule's radius the fan of rays looks, metres. A face the capsule rests on lies the radius and the
 * controller's offset (0.04) away along its own normal, and the controller's own grounded test reaches 0.05 further
 * (0.09); a ray of the fan leaves at most about 27 degrees off that normal, which meets the face (0.35 + 0.09) / cos 27 =
 * 0.49 m out, the radius and 0.14, and 0.2 holds it with a little to spare.
 */
export const FAN_REACH = 0.2;
/** The most faces kept for a frame's clip. */
const MOST = 4;
/**
 * How far the body's height over the kept plane may part from where it stood when the floor ray found that plane, metres,
 * before the verdict is asked of the engine again. On the plane itself the controller keeps it to the micron; stepping
 * onto another face moves it by that face's difference in slope times the way gone onto it, and off a lip onto a steep
 * face by the drop (the sphere rolling over the edge lowers it by dx²/2R, a hundredth by 9 cm past the edge, where the edge
 * still holds it up and a fresh look says the same).
 */
export const PLANE_HOLD = 0.01;
/** How far across the kept plane the verdict is held before the floor ray is cast again, metres (a backstop: the height is the guard). */
export const PLANE_REACH = 16;
/** A stand found by anything but the floor ray (a lip, a wedge, a stair's edge) is kept only while the body moves no more than this, metres. */
export const STILL_HOLD = 1e-5;
/**
 * The edge probe's numbers, metres. The nearest point of the world is looked for from `EDGE_LOWER` under the lower
 * sphere's middle, so the support under the sphere wins over a wall beside it (a wall touching the capsule's side is as
 * near the sphere's middle as the ground under it, and further from a point under it); it is a support only below the
 * sphere's middle by `EDGE_UNDER` and within the fan's reach of it. Then one ray each side of it: from `EDGE_SIDE` out and
 * `EDGE_LIFT` up, aimed at `EDGE_AIM` out and `EDGE_LIFT` down, so it meets the face that side just under the edge
 * whatever its angle (a straight ray down passes a near-sheer face by metres).
 */
export const EDGE_LOWER = 0.1;
export const EDGE_UNDER = 0.05;
export const EDGE_SIDE = 0.06;
export const EDGE_LIFT = 0.06;
export const EDGE_AIM = 0.002;
/**
 * How far the probe's two rays are turned off the line across the edge, radians: never parallel to an axis, because
 * rapier's heightfield misses a ray parallel to a grid axis that starts within a float32 step on the low side of a grid
 * line (measured: a ray straight down at z = -1e-12 or -1e-9 on a grid line misses, at -1e-6 or 0 meets the ground).
 */
export const EDGE_SKEW = 1e-3;
/** What the last verdict was held on: nothing, the floor ray's plane, or the body's place. */
const HELD_NONE = 0;
const HELD_PLANE = 1;
const HELD_STILL = 2;
/**
 * The fan's directions, unit vectors three at a time: eight round the compass 10 degrees under the level and eight 35
 * under it, the second ring turned half a step (a face between the climb limit, 55 degrees, and sheer has its nearest
 * point 35 to 0 degrees under the level from the sphere's middle: its normal's elevation turned round).
 */
const FAN: Float64Array = (() => {
  const out: number[] = [];
  for (const el of [10, 35]) {
    const c = Math.cos((el * Math.PI) / 180);
    const s = Math.sin((el * Math.PI) / 180);
    for (let k = 0; k < 8; k++) {
      const az = (k * Math.PI) / 4 + (el === 35 ? Math.PI / 8 : 0);
      out.push(c * Math.cos(az), -s, c * Math.sin(az));
    }
  }
  return new Float64Array(out);
})();

/** The little of rapier's character controller this asks for. */
export interface SlopeController {
  setMaxSlopeClimbAngle(angle: number): void;
}

/** The little of a physics world this asks for (rapier's own `World`). */
export interface SlopeWorld {
  castRayAndGetNormal(ray: RAPIER.Ray, maxToi: number, solid: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider, filterExcludeRigidBody?: RAPIER.RigidBody, filterPredicate?: (c: RAPIER.Collider) => boolean): RAPIER.RayColliderIntersection | null;
  projectPoint(point: RAPIER.Vector, solid: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider, filterExcludeRigidBody?: RAPIER.RigidBody, filterPredicate?: (c: RAPIER.Collider) => boolean): RAPIER.PointColliderProjection | null;
}

/** A velocity the slide writes into (a three `Vector3` is one). */
export interface SlopeVel { x: number; y: number; z: number }

/**
 * Where the body stands after the move, written by the caller into the rule's own record before `judge` (`x`, `y`, `z` its
 * feet, `offsetY` the capsule's middle over them, `r` its radius, `filter` the move's own groups). Fields, not arguments:
 * a number handed across a call the compiler does not build in is boxed, every frame. Each starts as a fraction, so a
 * fraction written into it never boxes one either (wave 2a's lesson).
 */
export class SlopeAt {
  x = 0.5;
  y = 0.5;
  z = 0.5;
  offsetY = 0.5;
  r = 0.5;
  filter = 0.5;
  /** Wave 3's crease: on a frame that began in the air, how fast the body was falling into the move, m/s (nought on any other). */
  fall = 0.5;
  /** The frame's seconds (the crease's settling counts down by them). */
  dt = 0.5;
}

/**
 * Wave 3, the crease (wave 2b's leftover): a body dropped straight into the crease where a face too steep to stand on
 * meets the floor could come to rest leaning on the face over the floor, 0.08 to 0.32 m up (42 of 192 such drops). Two
 * causes, measured: the floor ray found the floor under the body, within its reach, and called it ground while the body
 * was held up by the face (the slide's own `FLOOR_TOUCH`, asked only after a slide); and at 144 frames a second, beside a
 * face the controller pressed the body off, the capsule's collider, which the physics moves only at its own 60 Hz step,
 * stood a frame or two behind the body, and the controller's every move was worked out from where it stood then, so the
 * body bounced on the floor for good (as the grappling rope found, `Grapple.syncCollider`).
 *
 * The mend: a landing from a fall faster than `CREASE_FALL` asks the fan whether a steep face touches the body; one that
 * does is a crease, and for `CREASE_SETTLE` seconds after it the floor counts as ground only once the body sits on it
 * (`FLOOR_TOUCH`, as after a slide), and the caller puts the capsule's collider where the body is before each move
 * (`settling`). A landing on open ground, a landing beside a wall, a kerb and the autostep (whose one frame in the air is
 * never a fall that fast) meet none of it.
 */
export const CREASE_FALL = 2.5;
/** How long a crease's settling lasts, seconds: a slide down to the floor and the bounce the stale collider makes there. */
export const CREASE_SETTLE = 0.6;
/**
 * How far off the floor a body settling in a crease may sit for the floor alone to make it ground, metres: the
 * controller's own offset (0.04) and a few centimetres. `FLOOR_TOUCH`'s 0.12 lets a body leaning on a sheer face rest
 * 0.08 m up (measured: a slide down an 89 degree face at 60 frames a second ended so).
 */
export const CREASE_TOUCH = 0.07;

/**
 * The edge probe's verdict from what the two rays each side of the support met (pure, for the tests): a walkable face
 * there is a lip, and stands; a steep face only is a peak or a knife edge, and does not; neither leaves the controller
 * its word (a sheer wall's top, whose sides are no faces to the rule).
 */
export function edgeGround(walkable: boolean, steep: boolean): boolean {
  return walkable || !steep;
}

/**
 * The verdict from normals alone (pure, for the tests): `rayNy` the upward share of the face the floor ray met (NaN for
 * none), `ny` each contact's, `nx`/`nz` beside them, `n` how many; `cosLimit` the cosine of the climb limit. True is
 * ground. The ray's walkable face, any walkable contact, or two steep faces whose normals together point walkably up.
 */
export function slopeGround(rayNy: number, nx: ArrayLike<number>, ny: ArrayLike<number>, nz: ArrayLike<number>, n: number, cosLimit: number): boolean {
  if (rayNy >= cosLimit) return true;
  if (n === 0) return true;
  let best = -2;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    if (ny[i] > best) best = ny[i];
    sx += nx[i];
    sy += ny[i];
    sz += nz[i];
  }
  if (best >= cosLimit) return true;
  if (n < 2) return false;
  const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
  return len > 1e-9 && sy / len >= cosLimit;
}

export class SlopeRule {
  /** This frame's verdict: on a face too steep to stand on, and so not ground. Read before the next move. */
  sliding = false;
  /** The steep faces met this frame (their normals), steepest-held first, for the clip. */
  readonly nx = new Float64Array(MOST);
  readonly ny = new Float64Array(MOST);
  readonly nz = new Float64Array(MOST);
  count = 0;
  /** The floor ray's face's upward share this frame, NaN for none (for the tests and the console). */
  rayNy = 0.5;
  /** Frames the body has slid in a row, and the number of verdicts the rule overturned (the console's). */
  slid = 0;
  overturned = 0;
  /** Rays and projections asked of the engine, verdicts held with none asked, and edges the probe judged (the console's and the tests'). */
  casts = 0;
  kept = 0;
  edges = 0;
  /** Where the caller says the body stands, written before every `judge`. */
  readonly at = new SlopeAt();
  /** Wave 3's crease: seconds of settling left after a landing into one (the caller syncs the collider meanwhile: `settling`), and how many creases were met. */
  settle = 0.5;
  creases = 0;
  /**
   * Wave 3: the walkable plane the body stands on this frame (its normal), NaN for none known: the floor ray's face where
   * it was walkable, or the plane a kept verdict stands on. What the drawn body's height tells a step's pop from the
   * ground's own slope by (src/anim/drawnHeight.ts).
   */
  planeNx = 0.5;
  planeNy = 0.5;
  planeNz = 0.5;
  private controller: SlopeController | null = null;
  private climbSet = MADE_CLIMB;
  private ray: RAPIER.Ray | null = null;
  private probe: { x: number; y: number; z: number } | null = null;
  /** The last stand verdict, kept: what it was held on, in which world, under which limit, and the plane or place. */
  private held = HELD_NONE;
  private heldWorld: SlopeWorld | null = null;
  private heldCos = 0.5;
  private hx = 0.5;
  private hy = 0.5;
  private hz = 0.5;
  private htoi = 0.5;
  private hnx = 0.5;
  private hny = 0.5;
  private hnz = 0.5;
  /** The floor ray's face's lean this frame (its normal's level part), and the frame's numbers the edge probe reads. */
  private fnx = 0.5;
  private fnz = 0.5;
  private lowNow = 0.5;
  private cosNow = 0.5;

  constructor() {
    // Starts as a fraction so a frame writing fractions into it never boxes one (wave 2a's lesson).
    this.rayNy = Number.NaN;
    this.settle = 0;
    this.planeNx = Number.NaN;
    this.planeNy = Number.NaN;
    this.planeNz = Number.NaN;
  }

  /** Whether the crease's settling is on this frame: the caller puts the capsule's collider where the body is before the move. */
  get settling(): boolean {
    return this.settle > 0 && this.on && LOCO_TUNE.slopeCrease === 'floor';
  }

  /** A face met this frame, kept once (a face two rays meet is one face) while there is room. */
  private keep(x: number, y: number, z: number): void {
    const n = this.count;
    for (let i = 0; i < n; i++) if (x * this.nx[i] + y * this.ny[i] + z * this.nz[i] > 0.9995) return;
    if (n >= MOST) return;
    this.nx[n] = x;
    this.ny[n] = y;
    this.nz[n] = z;
    this.count = n + 1;
  }

  /** Whether the rule is in force (the tune's switch). */
  get on(): boolean {
    return LOCO_TUNE.slopeRule === 'limit';
  }

  /**
   * Before the move: the controller's climb angle the tune's limit, so it will not walk a body up the faces the verdict
   * will not let it stand on. Written only when it changes; under 'before' the controller is the one it was made (55).
   * (Its slide angle is left as it was made: the clip below keeps the velocity along the face, which the controller
   * slides at any angle, measured the same to the bit with the slide angle at the limit or at its own 60.)
   */
  controllerFor(c: SlopeController): void {
    if (c !== this.controller) {
      this.controller = c;
      this.climbSet = MADE_CLIMB;
    }
    // Two branches and no ternary: a ternary of a worked number and a constant boxes the number, every frame.
    if (this.on) {
      const climb = (LOCO_TUNE.slope.climb * Math.PI) / 180;
      if (climb !== this.climbSet) {
        c.setMaxSlopeClimbAngle(climb);
        this.climbSet = climb;
      }
    } else if (this.climbSet !== MADE_CLIMB) {
      c.setMaxSlopeClimbAngle(MADE_CLIMB);
      this.climbSet = MADE_CLIMB;
    }
  }

  /** Let go of everything held (the body stood somewhere new, a ride, the water): the next verdict is fresh. */
  reset(): void {
    this.sliding = false;
    this.count = 0;
    this.slid = 0;
    this.held = HELD_NONE;
    this.heldWorld = null;
    this.settle = 0;
    this.planeNx = Number.NaN;
    this.planeNy = Number.NaN;
    this.planeNz = Number.NaN;
  }

  /**
   * Before the movement's step, a fresh press of jump (`pressed`) while the body slides: under `slopeJump` 'allowed', the
   * plain jump off the face, as from the ground (its speed straight up, what it had along the face kept). True when it
   * jumped; the caller marks the jump's start and plays it as one. Refused by default, and never under 'before'.
   */
  jumpOff(vel: SlopeVel, pressed: boolean): boolean {
    if (!pressed || !this.sliding || !this.on || LOCO_TUNE.slopeJump !== 'allowed') return false;
    const up = JKA.jumpVelocity * UNIT;
    if (vel.y < up) vel.y = up;
    return true;
  }

  /**
   * After the move, with the controller's own verdict `grounded`: whether it stands. `ruled` is whether the rule reaches
   * this body this frame (not on the grappling rope, attached or in its fast flight, and not swimming). The capsule's
   * place is the body's after the move, which the caller has written into `at` (its feet, the capsule's middle over them,
   * its radius and the move's own groups); `body` and `pass` are the move's own. Under 'before', not ruled, or not
   * grounded, the word stands and nothing is asked of the engine; a stand kept from the frames before (the body still on
   * the plane the floor ray found, or not moved at all) asks nothing either.
   */
  judge(world: SlopeWorld, grounded: boolean, ruled: boolean, body: RAPIER.RigidBody, pass: (c: RAPIER.Collider) => boolean): boolean {
    this.sliding = false;
    // Wave 3's crease: its settling counts down on every frame, and the plane under the body is this frame's to say.
    if (this.settle > 0) {
      this.settle -= this.at.dt;
      if (this.settle < 0) this.settle = 0;
    }
    this.planeNx = Number.NaN;
    this.planeNy = Number.NaN;
    this.planeNz = Number.NaN;
    if (!grounded || !ruled || !this.on) {
      this.count = 0;
      this.rayNy = Number.NaN;
      this.slid = 0;
      this.held = HELD_NONE;
      return grounded;
    }
    const at = this.at;
    const x = at.x;
    const z = at.z;
    const r = at.r;
    const half = at.offsetY - r;
    const cosLimit = Math.cos((LOCO_TUNE.slope.climb * Math.PI) / 180);
    // The floor ray's origin: the lower sphere's middle.
    const low = at.y + at.offsetY - half;
    // A stand kept from the frames before, nothing asked of the engine: the body still on the plane the floor ray found
    // (its height over that plane where it is now the height it had over it there), or, for a stand found any other way,
    // not moved at all. Never across a world, a limit or a reset.
    if (this.held !== HELD_NONE && world === this.heldWorld && cosLimit === this.heldCos) {
      if (this.held === HELD_PLANE) {
        const dx = x - this.hx;
        const dz = z - this.hz;
        if (dx * dx + dz * dz <= PLANE_REACH * PLANE_REACH) {
          const d = low - (this.hy - (this.hnx * dx + this.hnz * dz) / this.hny) - this.htoi;
          if (d <= PLANE_HOLD && d >= -PLANE_HOLD) {
            this.count = 0;
            this.rayNy = this.hny;
            this.slid = 0;
            this.kept++;
            this.planeNx = this.hnx;
            this.planeNy = this.hny;
            this.planeNz = this.hnz;
            return true;
          }
        }
      } else {
        const dx = x - this.hx;
        const dy = low - this.hy;
        const dz = z - this.hz;
        if (dx <= STILL_HOLD && dx >= -STILL_HOLD && dy <= STILL_HOLD && dy >= -STILL_HOLD && dz <= STILL_HOLD && dz >= -STILL_HOLD) {
          this.slid = 0;
          this.kept++;
          return true;
        }
      }
    }
    this.held = HELD_NONE;
    this.count = 0;
    this.rayNy = Number.NaN;
    this.fnx = 0;
    this.fnz = 0;
    // The floor ray: straight down from the lower sphere's middle.
    let ray = this.ray;
    if (!ray) ray = this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    ray.origin.x = x;
    ray.origin.y = low;
    ray.origin.z = z;
    this.casts++;
    const hit = world.castRayAndGetNormal(ray, r + FLOOR_REACH, true, undefined, at.filter, undefined, body, pass);
    if (hit) {
      this.rayNy = hit.normal.y;
      this.fnx = hit.normal.x;
      this.fnz = hit.normal.z;
    }
    // A walkable face under the body is ground; but a body sliding down a steep face onto it is ground only once it sits on
    // it (`FLOOR_TOUCH`): until then what it touches decides below, the floor's face no longer counting for the fan. So is
    // a body settling in a crease (wave 3), and it sits on it only nearer (`CREASE_TOUCH`).
    this.lowNow = low;
    let floorNy = this.rayNy;
    if (floorNy >= cosLimit && this.slid > 0 && hit!.timeOfImpact * floorNy - r > FLOOR_TOUCH) floorNy = Number.NaN;
    if (floorNy >= cosLimit && this.settle > 0 && LOCO_TUNE.slopeCrease === 'floor' && hit!.timeOfImpact * floorNy - r > CREASE_TOUCH) floorNy = Number.NaN;
    if (floorNy >= cosLimit) {
      this.slid = 0;
      // Kept on that plane until the body leaves it (`PLANE_HOLD`, `PLANE_REACH`).
      const n = hit!.normal;
      this.planeNx = n.x;
      this.planeNy = n.y;
      this.planeNz = n.z;
      this.held = HELD_PLANE;
      this.heldWorld = world;
      this.heldCos = cosLimit;
      this.hx = x;
      this.hz = z;
      this.htoi = hit!.timeOfImpact;
      this.hy = low - this.htoi;
      this.hnx = n.x;
      this.hny = n.y;
      this.hnz = n.z;
      this.armCrease(world, body, pass, cosLimit);
      return true;
    }
    // The faces the controller could have called ground, at the capsule's place after the move: a fan of rays out of the
    // lower sphere's middle, down and out all round (a heightfield answers no shape's overlap, so the engine's own contact
    // queries cannot be asked of the terrain; a ray is answered by every shape, with the face's own normal). A face the
    // capsule rests on lies its radius and the controller's offset away along that face's own normal, which some ray of
    // the fan meets within `FAN_REACH`.
    for (let i = 0; i < FAN.length; i += 3) {
      ray.dir.x = FAN[i];
      ray.dir.y = FAN[i + 1];
      ray.dir.z = FAN[i + 2];
      this.casts++;
      const h = world.castRayAndGetNormal(ray, r + FAN_REACH, true, undefined, at.filter, undefined, body, pass);
      if (!h) continue;
      const n = h.normal;
      // The controller's own ground test: a face whose normal points up at all.
      if (n.y <= 1e-3) continue;
      this.keep(n.x, n.y, n.z);
    }
    ray.dir.x = 0;
    ray.dir.y = -1;
    ray.dir.z = 0;
    // No face the controller could have called ground lies where the capsule rests: it rests on an edge or a point,
    // and the faces that meet there decide (a lip stands, a peak does not). Otherwise the faces the fan met decide.
    this.lowNow = low;
    this.cosNow = cosLimit;
    if (this.count === 0 ? this.edgeProbe(world, body, pass) : slopeGround(floorNy, this.nx, this.ny, this.nz, this.count, cosLimit)) {
      this.slid = 0;
      // Kept while the body does not move.
      this.held = HELD_STILL;
      this.heldWorld = world;
      this.heldCos = cosLimit;
      this.hx = x;
      this.hy = low;
      this.hz = z;
      this.armCrease(world, body, pass, cosLimit);
      return true;
    }
    this.sliding = true;
    this.slid++;
    this.overturned++;
    return false;
  }

  /**
   * Wave 3's crease, on a verdict that the body stands: a landing (a frame that began in the air, falling faster than
   * `CREASE_FALL`) beside a face too steep to stand on that touches the body is a crease. It settles for `CREASE_SETTLE`
   * seconds, and the stand just found is not kept, so the next frame asks again (sitting on the floor within
   * `CREASE_TOUCH`, else held up by the face, and so sliding).
   */
  private armCrease(world: SlopeWorld, body: RAPIER.RigidBody, pass: (c: RAPIER.Collider) => boolean, cosLimit: number): void {
    if (LOCO_TUNE.slopeCrease !== 'floor' || !(this.at.fall > CREASE_FALL)) return;
    if (!this.creaseFan(world, body, pass, cosLimit)) return;
    this.settle = CREASE_SETTLE;
    this.creases++;
    this.held = HELD_NONE;
  }

  /**
   * Wave 3's crease: whether a face too steep to stand on touches the body as it lands (the fan's rays, out of the lower
   * sphere's middle, that the floor ray's own origin stands at). Its own loop: nothing it finds is kept for the slide.
   */
  private creaseFan(world: SlopeWorld, body: RAPIER.RigidBody, pass: (c: RAPIER.Collider) => boolean, cosLimit: number): boolean {
    const ray = this.ray!;
    const r = this.at.r;
    ray.origin.x = this.at.x;
    ray.origin.y = this.lowNow;
    ray.origin.z = this.at.z;
    let steep = false;
    for (let i = 0; i < FAN.length && !steep; i += 3) {
      ray.dir.x = FAN[i];
      ray.dir.y = FAN[i + 1];
      ray.dir.z = FAN[i + 2];
      this.casts++;
      const h = world.castRayAndGetNormal(ray, r + FAN_REACH, true, undefined, this.at.filter, undefined, body, pass);
      if (h && h.normal.y > 1e-3 && h.normal.y < cosLimit) steep = true;
    }
    ray.dir.x = 0;
    ray.dir.y = -1;
    ray.dir.z = 0;
    return steep;
  }

  /**
   * The body rests on an edge or a point no ray of the fan meets as a face (the controller calls it ground: the edge's
   * own normal points up). The nearest point of the world under the lower sphere is that support; one short ray each side
   * of it, aimed just under it, meets the face that side whatever its angle. A walkable face there (a lip: the top the
   * edge bounds) stands; steep faces only (a peak, a knife edge) do not, and the face on the body's side is kept for the
   * clip, so the body leaves the edge down that face (the far one is not touched: clipped against both, a ridge would
   * hold the body still); nothing at all (no support found, or only sheer sides, which are no faces to the rule) leaves
   * the controller its word. Asked only where the fan met nothing, never on open ground.
   */
  private edgeProbe(world: SlopeWorld, body: RAPIER.RigidBody, pass: (c: RAPIER.Collider) => boolean): boolean {
    const at = this.at;
    const x = at.x;
    const z = at.z;
    const low = this.lowNow;
    const cosLimit = this.cosNow;
    let p = this.probe;
    if (!p) p = this.probe = { x: 0.5, y: 0.5, z: 0.5 };
    p.x = x;
    p.y = low - EDGE_LOWER;
    p.z = z;
    this.casts++;
    const proj = world.projectPoint(p, false, undefined, at.filter, undefined, body, pass);
    if (!proj) return true;
    const cx = proj.point.x;
    const cy = proj.point.y;
    const cz = proj.point.z;
    const ux = x - cx;
    const uy = low - cy;
    const uz = z - cz;
    const reach = at.r + FAN_REACH;
    // A support is under the sphere's middle and within the fan's reach of it (not a wall beside it).
    if (uy < EDGE_UNDER || ux * ux + uy * uy + uz * uz > reach * reach) return true;
    this.edges++;
    // Across the edge: from it toward the body, level. Straight over it (a ridge's very top), the way the floor ray's
    // face leans, else along x.
    let hx = ux;
    let hz = uz;
    let hl = Math.sqrt(hx * hx + hz * hz);
    if (hl < 1e-4) {
      hx = this.fnx;
      hz = this.fnz;
      hl = Math.sqrt(hx * hx + hz * hz);
      if (hl < 1e-4) {
        hx = 1;
        hz = 0;
        hl = 1;
      }
    }
    hx /= hl;
    hz /= hl;
    // Turned a hair off the line across (`EDGE_SKEW`), so neither ray is ever parallel to an axis.
    {
      const c = Math.cos(EDGE_SKEW);
      const s = Math.sin(EDGE_SKEW);
      const tx = hx * c - hz * s;
      hz = hx * s + hz * c;
      hx = tx;
    }
    let walkable = false;
    let steep = false;
    const ray = this.ray!;
    // The body's side first, then the far side.
    for (let s = 1; s >= -1; s -= 2) {
      const ox = cx + s * hx * EDGE_SIDE;
      const oy = cy + EDGE_LIFT;
      const oz = cz + s * hz * EDGE_SIDE;
      let dx = s * hx * (EDGE_AIM - EDGE_SIDE);
      let dy = -2 * EDGE_LIFT;
      let dz = s * hz * (EDGE_AIM - EDGE_SIDE);
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx /= len;
      dy /= len;
      dz /= len;
      ray.origin.x = ox;
      ray.origin.y = oy;
      ray.origin.z = oz;
      ray.dir.x = dx;
      ray.dir.y = dy;
      ray.dir.z = dz;
      this.casts++;
      const h = world.castRayAndGetNormal(ray, 2 * len, true, undefined, at.filter, undefined, body, pass);
      if (!h) continue;
      const n = h.normal;
      if (n.y >= cosLimit) walkable = true;
      else if (n.y > 1e-3) {
        // The first steep face met (the body's side, where it has one) is the one the body slides down.
        if (!steep) this.keep(n.x, n.y, n.z);
        steep = true;
      }
    }
    ray.dir.x = 0;
    ray.dir.y = -1;
    ray.dir.z = 0;
    if (edgeGround(walkable, steep)) {
      this.count = 0;
      return true;
    }
    return false;
  }

  /**
   * Before the move, while the body slides (the last verdict): gravity's share down the face kept by the tune's
   * `slide`. The movement has just added the whole of the world's `g` for the frame; one less the share of its pull
   * along the steepest face met is taken back off the speed down that face, never past standing still along it. Taken
   * here, before the move and not after it, so the body moves by the speed it keeps and the slide is the same at every
   * frame rate. At a share of 1 (the start) nothing is touched.
   */
  share(vel: SlopeVel, dt: number, g: number): void {
    const n = this.count;
    const keep = LOCO_TUNE.slope.slide;
    if (!this.sliding || n < 1 || keep >= 1) return;
    let k = 0;
    for (let i = 1; i < n; i++) if (this.ny[i] < this.ny[k]) k = i;
    const fy = this.ny[k];
    const sin = Math.sqrt(Math.max(0, 1 - fy * fy));
    if (sin <= 1e-6) return;
    // Downhill along the face: (n.x·ny, ny² − 1, n.z·ny) / sin.
    const tx = (this.nx[k] * fy) / sin;
    const ty = (fy * fy - 1) / sin;
    const tz = (this.nz[k] * fy) / sin;
    const down = vel.x * tx + vel.y * ty + vel.z * tz;
    if (down <= 0) return;
    const take = Math.min(down, (1 - keep) * g * sin * dt);
    vel.x -= tx * take;
    vel.y -= ty * take;
    vel.z -= tz * take;
  }

  /**
   * After the move, once `judge` said the body slides: `vel` clipped onto each steep face met (what pressed into it taken
   * off, as Jedi Academy's PM_SlideMove clips it), then onto the line two faces meet in where the second's clip still
   * pressed into the first. Answers the height to hold the fall's memory at: the feet's `y` and what the speed down into
   * the ground is worth (`v² / 2g`), so the fall a slide ends in is paid for that speed alone, as a landing is.
   */
  slide(vel: SlopeVel, y: number, g: number): number {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const d = vel.x * this.nx[i] + vel.y * this.ny[i] + vel.z * this.nz[i];
      if (d < 0) {
        vel.x -= this.nx[i] * d;
        vel.y -= this.ny[i] * d;
        vel.z -= this.nz[i] * d;
      }
    }
    if (n >= 2) {
      // Still pressing into the first after the second's clip: along the line the two meet in.
      const d0 = vel.x * this.nx[0] + vel.y * this.ny[0] + vel.z * this.nz[0];
      if (d0 < -1e-6) {
        let cx = this.ny[0] * this.nz[1] - this.nz[0] * this.ny[1];
        let cy = this.nz[0] * this.nx[1] - this.nx[0] * this.nz[1];
        let cz = this.nx[0] * this.ny[1] - this.ny[0] * this.nx[1];
        const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (len > 1e-9) {
          cx /= len;
          cy /= len;
          cz /= len;
          const along = vel.x * cx + vel.y * cy + vel.z * cz;
          vel.x = cx * along;
          vel.y = cy * along;
          vel.z = cz * along;
        } else {
          vel.x = 0;
          vel.y = 0;
          vel.z = 0;
        }
      }
    }
    const fall = vel.y < 0 ? -vel.y : 0;
    return y + (fall * fall) / (2 * g);
  }
}
