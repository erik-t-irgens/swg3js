// Stairs II (A): the step-up at every frame rate. The owner, of his stadium stairs: "walking, my feet get caught on the
// edge of the steps" and "it seems to work better on my mac now ... than at home on the PC" (the PC draws at 144 frames
// a second). Measured on the real Rapier with the game's own movement (the stairs wave's harness, twelve risers up), two
// causes, one under the other:
//
//  - The collider stood where it was at the last physics step. Rapier moves a kinematic body's collider only at its own
//    60 Hz step, and the character controller works every move out from the collider. At 144 frames a second two frames
//    in three see no step, so each such frame's move was worked out from where the body stood a frame or two before and
//    then added to where it stands now: at a riser the controller's step-up, its slide back off the nosing and the snap
//    were worked out twice over and the body jittered on the riser's face (riser 0.316 m: the walk stopped 6 treads in, the
//    jog took 22 s with stalls of 4.3 s; at 60 frames a second, where every frame sees a step, both climbed). The
//    grappling rope (`Grapple.syncCollider`) and the crease (`SlopeRule.settling`) had met the same fault and mended it
//    for themselves only. `sync` puts the collider where the body is before every move, in the engine's own single
//    precision sums, so a frame whose collider already stood there moves by no bit (measured at 30 and 60 frames a second).
//
//  - Rapier's own step-up cannot lift the capsule over a riser taller than its lower sphere's middle (the radius and the
//    offset, 0.39 m). It measures the step at its `minWidth` (0.2 m and the offset) ahead of the sphere, where the sphere
//    would rest on the nosing a share of the riser up (0.12 to 0.18 m of a 0.42 m riser), lifts by that, nudges the body on
//    by the frame's own sliver of travel, and then asks the rest of the move to come back down by what it lifted (its
//    remaining translation less the step), so the sphere slides back off the nosing's curve. Whether a frame gains on the
//    riser hangs on its sliver: at the stairs' walking pace of 0.65 m/s, 0.011 m a frame at 60 and 0.005 at 144, and with
//    the collider in its place the walk still stopped at every riser of 0.42 m or more at every frame rate (the jog, with
//    more travel a frame, at 30 only). The engine's code is the published package's and is not changed here. `after`
//    steps the body itself where the controller met a face it calls a wall and its move fell short across the ground: Jedi
//    Academy's own PM_StepSlideMove with the capsule's casts (up, across, down), taken only onto a walkable top within the
//    step's height (the engine's own check that a step is not onto a ramp too steep) and only where it goes further than the
//    controller did. Each frame the sphere comes down onto the nosing a frame's travel nearer it and rides its curve up,
//    so a riser up to the step's height is climbed at the walk's own pace whatever the frame rate.
//
//  - And the other way: the engine's step-up reaches its height and its offset together (0.54 m), so a riser of 0.52 m was
//    climbed by a jog at 30 frames a second and was a wall to a walk at 60. Under the mend a riser taller than the step (its
//    top over the floor under the body's middle) is a wall at every rate: the controller's own lift onto it is undone by
//    asking the move again with its step-up off (put back at once, its own numbers read off it).
//
// Under `LOCO_TUNE.step.rule` 'before' none of it runs and the movement is 33d3e67's to the bit. Fighters have the
// player's own controller and stall the same way; `walk` is the whole mend in one call for them (not yet taken: NPCs on
// stairs come later). Pure of the page: the engine's calls come in through small shapes, the numbers through kept records.
import { RAPIER } from '../core/physics.ts';
import { LOCO_TUNE } from '../anim/locoTune.ts';

/**
 * The controller's own step-up height, metres (`Player.makeBody`'s `enableAutostep(0.5, ...)`, and the fighters'
 * `FIGHTER_BODY.autostep`): the tallest riser stepped. Held equal to that call by `playerStepUp.test.ts`.
 */
export const STEP_HEIGHT = 0.5;
/** A move that went less than this share of the way asked across the ground was cut short (by a riser, or a wall). */
export const CUT = 0.95;
/** The capsule is lifted this much past the riser and the offset before it goes across, metres: its sphere clears the nosing. */
export const LIFT_SPARE = 0.02;
/** The top ahead is looked for this far past where the capsule touched the face in its way, metres: just onto the riser's top. */
export const PROBE_PAST = 0.03;
/** A face stands in the way of the move when its normal, across the ground, faces the travel by more than this (cosine): a wall slid along beside the travel does not. */
export const IN_THE_WAY = 0.3;
/** And from this far over the step's height (so a riser taller than the step is measured, and called a wall), metres. */
export const PROBE_OVER = 0.5;
/** A top under this over the floor is no step (the floor itself, found past a post), metres. */
export const RISE_MIN = 0.02;
/**
 * The floor under the body's middle is looked for this far under its feet past the controller's offset, metres: a capsule
 * pressed into a face can stand a few centimetres higher than the offset over its floor (measured: 0.036 to 0.060 m over
 * the floor at a 0.51 m face met at 30 degrees), and its floor must still be found there. Under a riser's height (`riserMin`
 * 0.08), so a capsule riding a nosing never finds the tread below it through its middle.
 */
export const FLOOR_DROP = 0.06;
/**
 * A face the controller calls a wall is a riser only where it touched the capsule at least this share of its radius out
 * from its middle, across the ground. A wall-like face meets the sphere no lower than the climb limit's angle up its side, so
 * at least 0.82 of the radius and the offset out (0.32 m); one reported nearer is no face in the way.
 */
export const WITNESS_OUT = 0.75;
/** A contact whose normal points up less than this is a face the controller calls a wall (a riser's face, a nosing's edge): the cosine of the climb limit, read from the tune. */
const WALL_MARGIN = 1e-6;

/** Where a body is and what its move asked, written by the caller before `sync` and `after` (fields, so no number crosses a call). */
export class StepAt {
  /** The feet before the move (the player's `pos`, a fighter's feet). */
  x = 0.5;
  y = 0.5;
  z = 0.5;
  /** How far over the feet the rigid body stands (the player's nought, a fighter's `bodyLift`), metres. */
  lift = 0.5;
  /** The collider's place over its body (the player's `colliderOffsetY`), the capsule's half height and radius, metres. */
  localY = 0.5;
  half = 0.5;
  r = 0.5;
  /** The controller's offset, metres (0.04). */
  off = 0.5;
  /** The move asked of the controller this frame. */
  ax = 0.5;
  ay = 0.5;
  az = 0.5;
  /** The move's own groups. */
  filter = 0.5;
  /** The climb limit, degrees (`LOCO_TUNE.slope.climb`): a step's top steeper than it is no step. */
  climb = 0.5;
  /** Whether a step is the body's to take this frame: on its feet, on the ground before the move, under its own legs (not swimming, on the rope or sliding). Narrowed by `reach`. */
  ruled = false;
  /** The slope rule's last verdict found a face under the body to stand on (`SlopeRule.supported`): where it did not, `reach` looks for a floor within the step's height under the feet. */
  supported = true;
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.lift = 0;
    this.localY = 0;
    this.half = 0;
    this.r = 0;
    this.off = 0;
    this.ax = 0;
    this.ay = 0;
    this.az = 0;
    this.filter = 0;
    this.climb = 55;
  }
}

/** The little of a collider this asks: where it is put. */
export interface StepCollider {
  setTranslation(t: { x: number; y: number; z: number }): void;
}
/** The little of a physics world this asks (rapier's own `World`). */
export interface StepWorld {
  castRayAndGetNormal(ray: RAPIER.Ray, maxToi: number, solid: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider, filterExcludeRigidBody?: RAPIER.RigidBody, filterPredicate?: (c: RAPIER.Collider) => boolean): RAPIER.RayColliderIntersection | null;
  castShape(shapePos: RAPIER.Vector, shapeRot: RAPIER.Rotation, shapeVel: RAPIER.Vector, shape: RAPIER.Shape, targetDistance: number, maxToi: number, stopAtPenetration: boolean, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider, filterExcludeRigidBody?: RAPIER.RigidBody, filterPredicate?: (c: RAPIER.Collider) => boolean): RAPIER.ColliderShapeCastHit | null;
}
/** A move a controller handed back (rapier's `Vector`), written into in place when the step is taken. */
export interface StepMove {
  x: number;
  y: number;
  z: number;
}
/** The little of a character controller this asks (rapier's own). */
export interface StepController {
  computeColliderMovement(collider: RAPIER.Collider, desired: RAPIER.Vector, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterPredicate?: (c: RAPIER.Collider) => boolean): void;
  computedMovement(target?: RAPIER.Vector): RAPIER.Vector;
  computedGrounded(): boolean;
  numComputedCollisions(): number;
  computedCollision(i: number, out?: RAPIER.CharacterCollision): RAPIER.CharacterCollision | null;
  autostepMaxHeight(): number | null;
  autostepMinWidth(): number | null;
  autostepIncludesDynamicBodies(): boolean | null;
  disableAutostep(): void;
  enableAutostep(maxHeight: number, minWidth: number, includeDynamicBodies: boolean): void;
}

export class StepUp {
  readonly at = new StepAt();
  /** This frame: whether the controller met a wall and the riser ahead was measured, whether the step was taken, and whether the controller's own lift onto a riser taller than the step was undone. */
  looked = false;
  took = false;
  walled = false;
  /** This frame: the body stands after the move, whatever the controller says (a step taken, or a lift undone against a wall with the body kept on its floor: the controller's own answer is of the move asked again, which rose before it was held down). */
  stands = false;
  /** Why the last look took no step ('' when it did, or nothing was looked for): the console's. */
  why = '';
  /** Counts, the console's and the tests': moves synced, risers measured, steps taken, lifts undone, and the engine's casts. */
  synced = 0;
  looks = 0;
  steps = 0;
  walls = 0;
  casts = 0;
  /** The last riser measured (its top over the floor under the body's middle), metres, NaN for none. */
  riser = 0.5;
  /**
   * The floor the body last stood on, metres (NaN for none known): the floor found under its middle at a look, or the top
   * of a step taken; let go whenever the rule does not reach the body (in the air, on the rope, swimming, sliding). Where
   * no floor is under the middle (a capsule riding a nosing's curve, or pressed up a face), the riser is measured from it
   * while it is one the capsule could still be resting on (`floorOf`), else from the lowest the capsule's support can be.
   */
  floor = 0.5;
  private readonly put = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly from = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly dir = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly rot = { x: 0, y: 0, z: 0, w: 1 };
  private ray: RAPIER.Ray | null = null;
  private shape: RAPIER.Shape | null = null;
  private shapeHalf = 0.5;
  private shapeR = 0.5;
  private hit: RAPIER.CharacterCollision | null = null;
  private readonly desired = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly got = { x: 0.5, y: 0.5, z: 0.5 };
  /** The one-call `walk`'s answer: the move made and whether the body stands after it. */
  readonly moved = { x: 0.5, y: 0.5, z: 0.5 };
  grounded = false;
  /** How a capsule shape is made (rapier's own, or a stand-in's). */
  private readonly capsule: (half: number, r: number) => RAPIER.Shape;

  constructor(capsule?: (half: number, r: number) => RAPIER.Shape) {
    this.capsule = capsule ?? ((h, r) => new RAPIER.Capsule(h, r));
    this.riser = Number.NaN;
    this.floor = Number.NaN;
    this.shapeHalf = -1;
    this.shapeR = -1;
  }

  /**
   * Before the move, under 'mended', where the rule reaches the body and the slope rule found nothing under it to stand on
   * (`at.supported` false: the controller calls a body grounded that touches a face whose normal is level, which is how a
   * body pressed against a sheer wall in the air reads): a floor looked for straight down from the feet, within the step's
   * height and the controller's offset. None, and the rule does not reach the body this frame (`at.ruled` false): its
   * collider is left where the last physics step put it and nothing is stepped, so a Jedi falling against a wall keeps the
   * wall moves it had at every frame rate (the review of Stairs II: synced there, the controller called the fall grounded on
   * every frame at 144 and 240 as it always had at 30 and 60, and the Force wall rebound no longer fired). A capsule wedged on
   * a nosing's side over the tread below has that tread within reach and stays ruled.
   */
  reach(world: StepWorld, body: RAPIER.RigidBody | undefined, collider: RAPIER.Collider | undefined, pass?: (c: RAPIER.Collider) => boolean): void {
    const a = this.at;
    if (LOCO_TUNE.step.rule !== 'mended' || !a.ruled || a.supported) return;
    // The capsule itself cast straight down from where the body stands: a floor anywhere under it (a tread under its side,
    // wedged on the next nosing) is met, and a wall it is pressed against in the air, passed alongside, is not.
    let shape = this.shape;
    if (!shape || this.shapeHalf !== a.half || this.shapeR !== a.r) {
      shape = this.shape = this.capsule(a.half, a.r);
      this.shapeHalf = a.half;
      this.shapeR = a.r;
    }
    const f = this.from;
    const d = this.dir;
    f.x = a.x;
    f.y = a.y + a.lift + a.localY;
    f.z = a.z;
    d.x = 0;
    d.y = -1;
    d.z = 0;
    this.casts++;
    if (world.castShape(f, this.rot, d, shape, 0, a.off + STEP_HEIGHT, false, undefined, a.filter, collider, body, pass) === null) a.ruled = false;
  }

  /**
   * Before the move: under 'mended', where the rule reaches the body (on its feet on the ground: `at.ruled`, written before
   * this), the collider put where the body is, by the engine's own single-precision sums (the body's place, then the
   * collider's own place over it), so a collider the physics' step already put there moves by no bit. In the air it is left
   * where it was: a fall, a jump and a Jedi's wall moves are as they were (see the lesson in CLAUDE.md on the wall rebound).
   */
  sync(collider: StepCollider): void {
    const a = this.at;
    if (LOCO_TUNE.step.rule !== 'mended' || !a.ruled) return;
    const p = this.put;
    p.x = Math.fround(a.x);
    p.y = Math.fround(Math.fround(a.y + a.lift) + Math.fround(a.localY));
    p.z = Math.fround(a.z);
    collider.setTranslation(p);
    this.synced++;
  }

  /**
   * After the controller's move `mv` from the feet in `at`, under 'mended', where the rule reaches the body and the
   * controller met a face it calls a wall: the riser ahead measured (its top over the floor under the body's middle). One
   * taller than the step is a wall: a lift the controller gave the body onto it is undone (the move asked again with its
   * step-up off). One within it, where the move fell short across the ground, is stepped: the capsule cast up past its top,
   * across by the move asked and down onto it, taken (`mv` written over) only where it goes further across than the
   * controller did. True when the step was taken: the body stands after it. The controller's own answers (`computedGrounded`)
   * are its last move's: the one asked again where a lift was undone.
   */
  after(world: StepWorld, controller: StepController, mv: StepMove, body: RAPIER.RigidBody | undefined, collider: RAPIER.Collider | undefined, pass?: (c: RAPIER.Collider) => boolean): boolean {
    this.looked = false;
    this.took = false;
    this.walled = false;
    this.stands = false;
    if (LOCO_TUNE.step.rule !== 'mended') return false;
    const a = this.at;
    if (!a.ruled) {
      this.floor = Number.NaN;
      return false;
    }
    const h2 = a.ax * a.ax + a.az * a.az;
    if (h2 < 1e-12) return false;
    const h = Math.sqrt(h2);
    const ux = a.ax / h;
    const uz = a.az / h;
    // Two faces, each touched on the capsule's side (where the collision came, the move applied before it added, at least
    // `WITNESS_OUT` of the radius out from the middle: the controller reports a level normal at the capsule's very bottom on
    // a frame its own step-up lifts the body, measured 0.04 m from the middle, which probed the floor and read a 0.51 m riser
    // as nothing to step onto). The step's: a face the controller calls a wall (its normal under the climb limit's) standing
    // most squarely in the way of the move, never one slid along beside the travel; where it touched (a riser's face, or its
    // nosing's edge) is where the riser is. The lift's, only where the controller lifted the body: the highest face meeting
    // the travel at all that it touched at or over the step's height less its offset over the feet, whatever its normal
    // (the edge it lifted the capsule onto reads walkable from the sphere, measured: 0.61 up at a 0.51 m riser met at 30
    // degrees, and at 75 degrees a riser faced the travel too little to be in the way): what its own step-up may have climbed.
    const cosClimb = Math.cos((a.climb * Math.PI) / 180);
    const n = controller.numComputedCollisions();
    const lifted = mv.y > a.ay + 1e-4;
    const out2 = WITNESS_OUT * WITNESS_OUT * a.r * a.r;
    let facing = -IN_THE_WAY;
    let wx = 0;
    let wz = 0;
    let px = 0;
    let pz = 0;
    let liftY = a.y + STEP_HEIGHT - a.off - RISE_MIN;
    let lifting = false;
    let lx = 0;
    let lz = 0;
    let lpx = 0;
    let lpz = 0;
    for (let i = 0; i < n; i++) {
      let c = this.hit;
      if (c === null) c = this.hit = controller.computedCollision(i);
      else c = controller.computedCollision(i, c);
      if (c === null) continue;
      const nx = c.normal1.x;
      const nz = c.normal1.z;
      const nl = Math.sqrt(nx * nx + nz * nz);
      if (nl < 1e-6) continue;
      const ox = c.witness1.x - a.x - c.translationDeltaApplied.x;
      const oz = c.witness1.z - a.z - c.translationDeltaApplied.z;
      const face = (nx * ux + nz * uz) / nl;
      if (c.normal1.y < cosClimb - WALL_MARGIN && face < facing && ox * ox + oz * oz >= out2) {
        facing = face;
        wx = c.witness1.x;
        wz = c.witness1.z;
        px = -nx / nl;
        pz = -nz / nl;
      }
      if (lifted && face < 0 && c.witness1.y > liftY) {
        liftY = c.witness1.y;
        lifting = true;
        lx = c.witness1.x;
        lz = c.witness1.z;
        lpx = -nx / nl;
        lpz = -nz / nl;
      }
    }
    const stepping = facing < -IN_THE_WAY;
    // Nothing is asked of the engine where the controller neither fell short across the ground at a face in the way nor
    // lifted the body against a face as tall as the step: it went on by itself (the review of Stairs II: every frame
    // touching a riser had paid both rays).
    const plain = mv.x * ux + mv.z * uz;
    const cut = stepping && plain < h * CUT;
    if (!lifting && !cut) {
      this.why = '';
      return false;
    }
    this.looked = true;
    this.looks++;
    this.riser = Number.NaN;
    const off = a.off;
    const r = a.r;
    let ray = this.ray;
    if (!ray) ray = this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    // The floor the feet stand on: under the body's middle where it is within the controller's offset and `FLOOR_DROP` of
    // the feet; where none is (a capsule riding a nosing's curve, whose middle is over the tread below, or pressed up a
    // face), the floor just this side of the face (the step's, else the lift's), found from the sphere's middle's height
    // down (the tread the capsule rests on the nosing of, or the ground at a wall's foot); else the floor it last stood on
    // while the capsule could still be resting on it (its support lies between the offset under the feet and the sphere's
    // middle); else the lowest the support can be, the offset under the feet. Never the feet themselves: a capsule perched
    // up a face measured from its feet reads a riser short, and a 0.51 m riser met at an angle was climbed that way (the
    // review of Stairs II).
    ray.origin.x = a.x;
    ray.origin.y = a.y + RISE_MIN;
    ray.origin.z = a.z;
    ray.dir.x = 0;
    ray.dir.y = -1;
    ray.dir.z = 0;
    this.casts++;
    const under = world.castRayAndGetNormal(ray, RISE_MIN + off + FLOOR_DROP, true, undefined, a.filter, collider, body, pass);
    let floor = a.y - off;
    if (under !== null) {
      floor = a.y + RISE_MIN - under.timeOfImpact;
      this.floor = floor;
    } else {
      ray.origin.x = cut ? wx - px * PROBE_PAST : lx - lpx * PROBE_PAST;
      ray.origin.y = a.y + r;
      ray.origin.z = cut ? wz - pz * PROBE_PAST : lz - lpz * PROBE_PAST;
      this.casts++;
      const before = world.castRayAndGetNormal(ray, r + off + STEP_HEIGHT, true, undefined, a.filter, collider, body, pass);
      if (before !== null) {
        floor = a.y + r - before.timeOfImpact;
        this.floor = floor;
      } else {
        const known = this.floor;
        if (known >= a.y - off - STEP_HEIGHT && known <= a.y + r) floor = known;
      }
    }
    // The top: straight down just past where a face was touched (into it, along its own normal), from over the step's
    // height. Its height over the floor is the riser. The lift's first: one taller than the step is a wall, and the
    // controller's own lift onto it (its step-up reaches its height and its offset) is undone from its first frame, so the
    // feet never start up such a face.
    const topFrom = a.y + STEP_HEIGHT + PROBE_OVER;
    if (lifting) {
      ray.origin.x = lx + lpx * PROBE_PAST;
      ray.origin.y = topFrom;
      ray.origin.z = lz + lpz * PROBE_PAST;
      this.casts++;
      const lt = world.castRayAndGetNormal(ray, topFrom - floor + RISE_MIN, true, undefined, a.filter, collider, body, pass);
      if (lt !== null && topFrom - lt.timeOfImpact - floor > STEP_HEIGHT + 1e-6) {
        this.riser = topFrom - lt.timeOfImpact - floor;
        this.why = 'a wall: the riser is taller than the step';
        this.unlift(controller, mv, collider, pass);
        return false;
      }
      if (!cut) {
        if (lt !== null) this.riser = topFrom - lt.timeOfImpact - floor;
        this.why = '';
        return false;
      }
    }
    ray.origin.x = wx + px * PROBE_PAST;
    ray.origin.y = topFrom;
    ray.origin.z = wz + pz * PROBE_PAST;
    this.casts++;
    const top = world.castRayAndGetNormal(ray, topFrom - floor + RISE_MIN, true, undefined, a.filter, collider, body, pass);
    if (top === null) {
      this.why = 'no top ahead';
      return false;
    }
    const topY = topFrom - top.timeOfImpact;
    const riser = topY - floor;
    this.riser = riser;
    if (riser > STEP_HEIGHT + 1e-6) {
      this.why = 'a wall: the riser is taller than the step';
      if (lifted) this.unlift(controller, mv, collider, pass);
      return false;
    }
    if (riser < RISE_MIN) {
      this.why = 'nothing to step onto';
      return false;
    }
    if (top.normal.y < cosClimb) {
      this.why = 'the top ahead is too steep';
      return false;
    }
    // The capsule, as the collider is now (standing or crouched).
    let shape = this.shape;
    if (!shape || this.shapeHalf !== a.half || this.shapeR !== r) {
      shape = this.shape = this.capsule(a.half, r);
      this.shapeHalf = a.half;
      this.shapeR = r;
    }
    const f = this.from;
    const d = this.dir;
    const cy = a.y + a.lift + a.localY;
    // Up past the top and the offset (no further than a ceiling lets it).
    const rise = topY - a.y;
    const lift = rise + off + LIFT_SPARE;
    f.x = a.x;
    f.y = cy;
    f.z = a.z;
    d.x = 0;
    d.y = 1;
    d.z = 0;
    this.casts++;
    const upHit = world.castShape(f, this.rot, d, shape, off, lift, false, undefined, a.filter, collider, body, pass);
    const up = upHit !== null ? upHit.time_of_impact : lift;
    if (up < rise + off * 0.5) {
      this.why = 'no room over the step';
      return false;
    }
    // Across by the move asked.
    f.y = cy + up;
    d.x = ux;
    d.y = 0;
    d.z = uz;
    this.casts++;
    const acrossHit = world.castShape(f, this.rot, d, shape, off, h, false, undefined, a.filter, collider, body, pass);
    const across = acrossHit !== null ? acrossHit.time_of_impact : h;
    if (across <= plain + 1e-5) {
      this.why = 'no further across than the controller went';
      return false;
    }
    // Down onto the top.
    f.x = a.x + ux * across;
    f.z = a.z + uz * across;
    d.x = 0;
    d.y = -1;
    d.z = 0;
    this.casts++;
    const downHit = world.castShape(f, this.rot, d, shape, off, up + off, false, undefined, a.filter, collider, body, pass);
    if (downHit === null) {
      this.why = 'nothing under the step';
      return false;
    }
    mv.x = ux * across;
    mv.y = up - downHit.time_of_impact;
    mv.z = uz * across;
    this.took = true;
    this.stands = true;
    this.why = '';
    this.steps++;
    return true;
  }

  /** The controller's lift onto a riser taller than the step undone: the move asked again with its step-up off, then put back as it was. */
  private unlift(controller: StepController, mv: StepMove, collider: RAPIER.Collider | undefined, pass?: (c: RAPIER.Collider) => boolean): void {
    if (!collider) return;
    const mh = controller.autostepMaxHeight();
    const mw = controller.autostepMinWidth();
    const dyn = controller.autostepIncludesDynamicBodies();
    if (mh === null || mw === null) return;
    const a = this.at;
    const dsr = this.desired;
    dsr.x = a.ax;
    dsr.y = a.ay;
    dsr.z = a.az;
    controller.disableAutostep();
    controller.computeColliderMovement(collider, dsr as RAPIER.Vector, undefined, a.filter, pass);
    controller.enableAutostep(mh, mw, dyn === true);
    const got = controller.computedMovement(this.got as RAPIER.Vector);
    mv.x = got.x;
    // With its step-up off the controller still climbs the riser's top edge as a slope (its normal from the sphere reads
    // walkable: measured, 0.098 m up at a 0.51 m riser met at 60 degrees, running at 30 frames a second, which then rode the
    // edge onto the top): no rise is kept against a wall, only what the move asked of it (a fall or nothing).
    const keep = a.ay > 0 ? a.ay : 0;
    mv.y = got.y > keep ? keep : got.y;
    // Held on its floor, it stands (asked again, the controller called the rise it made the air).
    if (got.y >= keep) this.stands = true;
    mv.z = got.z;
    this.walled = true;
    this.walls++;
  }

  /**
   * The whole mend in one call, for a body that has no more of its frame between the controller's move and its answer (the
   * fighters, when they take it): the collider synced, the controller's move of (`at.ax`, `at.ay`, `at.az`), and the step
   * or the wall after it, into `moved` and `grounded`.
   */
  walk(controller: StepController, collider: RAPIER.Collider, world: StepWorld, body: RAPIER.RigidBody | undefined, pass?: (c: RAPIER.Collider) => boolean): void {
    this.sync(collider);
    const a = this.at;
    const dsr = this.desired;
    dsr.x = a.ax;
    dsr.y = a.ay;
    dsr.z = a.az;
    controller.computeColliderMovement(collider, dsr as RAPIER.Vector, undefined, a.filter, pass);
    const mv = controller.computedMovement(this.moved as RAPIER.Vector);
    this.after(world, controller, mv, body, collider, pass);
    this.grounded = this.stands || controller.computedGrounded();
  }
}
