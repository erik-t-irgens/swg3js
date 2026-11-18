// The grapple tests' body: the player's own kinematic capsule and character controller, Jedi Academy's movement
// and the game's own swim (`swimStep`), stepped in exactly the order `Player.update` steps them, calling the very
// grapple steps the player calls (`beforeMove`, `syncCollider`, `clip`, `afterMove`) and the very key block the
// game's `stepGrappleKeys` calls (`Grapple.stepKeys`), against the game's own `Input` class over a stand-in page.
// `grappleWiring.test.ts` holds this file's order to `player.ts`'s, so the two cannot drift apart unseen.
//
// The physics is `src/core/physics.ts` itself, stepped after each frame as the game's loop steps it (the 60 Hz
// accumulator). The scenes are made the way the game makes them: placed objects as cleaned, flagged trimeshes
// with no body in the exterior group, trunks as fixed cylinders with no body, terrain as heightfields in the
// terrain group. Nothing is read from the game's files. Not a test itself.
import * as THREE from 'three';
import { Group, PLAYER_SOLVER, Physics, RAPIER, TRIMESH_FLAGS, cleanTrimesh, groups } from '../../../src/core/physics.ts';
import { JkaMovement, type MoveCommand } from '../../../src/player/jkaMove.ts';
import { GRAPPLE_TUNE, Grapple, newFireState, type GrappleBody, type GrappleFireState, type GrappleMark, type WaterTest } from '../../../src/player/grapple.ts';
import { newSwimIn, newSwimOut, swimStep, SWIM_DEPTH } from '../../../src/player/swimStep.ts';
import { newHarm, newHarmAsk, takeHarm, type HarmKind } from '../../../src/player/harmRule.ts';
import { vehicleOfCollider, type Vehicle } from '../../../src/vehicles/vehicle.ts';
import { makeHullController, type PeerHulls } from '../../../src/player/grappleFrames.ts';
import { SlopeRule } from '../../../src/player/slopeRule.ts';
import { StepUp } from '../../../src/player/stepUp.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import { ClimbAsk, LedgeHang, LedgeIn, type LedgeWorld } from '../../../src/player/ledge.ts';
import { driveDropClip } from '../../../src/player/hangClips.ts';
import type { CharacterRig } from '../../../src/player/rig.ts';
import { Stamina } from '../../../src/anim/locoClass.ts';
import { CLIMB_TUNE } from '../../../src/anim/climbTune.ts';
import { WallClimb } from '../../../src/player/wallClimb.ts';
import { MOVE_TUNE, shapeRulesOn } from '../../../src/anim/moveTune.ts';
import { BodyShape, CROUCH_TALL, LYING, STAND_TALL, ShapeIn, type ShapeWorld } from '../../../src/player/bodyShape.ts';
import { DuckPace, lieOn, paceOn } from '../../../src/player/duckPace.ts';
import { JKA, UNIT } from '../../../src/player/jkaMove.ts';

/** `DIVE_DEPTH` in player.ts: the head is under and looking down dives (the wiring test reads the two equal). */
export const DIVE_DEPTH_FOR_TESTS = 1.9;

// --- a stand-in page for the game's own Input ---------------------------------------------------------------
// Only while an Input is being made: the physics engine's own glue reads `window` when it finds one (a stand-in
// with nothing of a page's in it panics the first step), so the page is put up and taken down again round it.
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
const { Input } = await import('../../../src/core/input.ts');
export type TestInput = InstanceType<typeof Input>;
function newInput(): TestInput {
  const had = { window: g.window, document: g.document, localStorage: g.localStorage };
  g.localStorage ??= {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  g.window ??= { addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout: () => {} };
  g.document ??= { addEventListener() {}, removeEventListener() {}, pointerLockElement: null, exitPointerLock() {} };
  try {
    return new Input({} as HTMLCanvasElement);
  } finally {
    if (had.window === undefined) delete g.window;
    if (had.document === undefined) delete g.document;
    if (had.localStorage === undefined) delete g.localStorage;
  }
}

export const CAPSULE_RADIUS = 0.35;
export const STAND_HALF_HEIGHT = 0.45;
export const CROUCH_HALF_HEIGHT = 0.15;
const RUN_SPEED = 5.5;
const WALK_SPEED = 2.0;

export { GRAPPLE_TUNE, Physics, RAPIER, THREE };

/** A world made the way the game makes one. */
export async function makePhysics(): Promise<Physics> {
  return Physics.create();
}

/** A box with no body: a cuboid, or (as every placed building is) a cleaned trimesh of its twelve triangles. */
export function box(physics: Physics, min: number[], max: number[], trimesh = true): RAPIER.Collider {
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const hx = (max[0] - min[0]) / 2;
  const hy = (max[1] - min[1]) / 2;
  const hz = (max[2] - min[2]) / 2;
  if (!trimesh) return physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(0.8));
  const v: number[] = [];
  const idx: number[] = [];
  const face = (o: number[], u: number[], w: number[]) => {
    const base = v.length / 3;
    v.push(o[0], o[1], o[2], o[0] + u[0], o[1] + u[1], o[2] + u[2], o[0] + w[0], o[1] + w[1], o[2] + w[2], o[0] + u[0] + w[0], o[1] + u[1] + w[1], o[2] + u[2] + w[2]);
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  face([-hx, -hy, -hz], [2 * hx, 0, 0], [0, 2 * hy, 0]);
  face([-hx, -hy, hz], [0, 2 * hy, 0], [2 * hx, 0, 0]);
  face([-hx, -hy, -hz], [0, 2 * hy, 0], [0, 0, 2 * hz]);
  face([hx, -hy, -hz], [0, 0, 2 * hz], [0, 2 * hy, 0]);
  face([-hx, -hy, -hz], [0, 0, 2 * hz], [2 * hx, 0, 0]);
  face([-hx, hy, -hz], [2 * hx, 0, 0], [0, 0, 2 * hz]);
  const clean = cleanTrimesh(new Float32Array(v), new Uint32Array(idx))!;
  const desc = RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS).setTranslation(cx, cy, cz).setFriction(0.8);
  desc.setCollisionGroups(groups(Group.exterior, Group.all));
  return physics.world.createCollider(desc);
}

/** A trunk: an upright fixed cylinder with no body, its base on y0, as the flora's own shapes stand. */
export function trunk(physics: Physics, x: number, z: number, r: number, y0: number, y1: number): RAPIER.Collider {
  return physics.createStaticCylinder(x, (y0 + y1) / 2, z, r, (y1 - y0) / 2)!;
}

/** Flat ground: a big cuboid whose top is at y, in the terrain group. */
export function ground(physics: Physics, y = 0, half = 400): RAPIER.Collider {
  const c = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(half, 1, half).setTranslation(0, y - 1, 0).setFriction(0.9));
  c.setCollisionGroups(groups(Group.terrain, Group.all));
  return c;
}

/** A terrain chunk the game's way: 64 m, 32 cells, heights column-major. */
export function heightChunk(physics: Physics, ox: number, oz: number, h: (x: number, z: number) => number): RAPIER.Collider {
  const size = 64;
  const res = 32;
  const heights = new Float32Array((res + 1) * (res + 1));
  for (let xi = 0; xi <= res; xi++) for (let zi = 0; zi <= res; zi++) heights[xi * (res + 1) + zi] = h(ox + (xi * size) / res, oz + (zi * size) / res);
  return physics.createHeightfield(ox, oz, size, res, heights);
}

/**
 * The mark worked out from an eye along a unit look, as the game's `stepGrappleMark` asks it: the hook's kept view
 * written, then the probe. For the tests, which care nothing for a number made here.
 */
export function probeFrom(
  g: Grapple,
  physics: Physics,
  eye: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  orbit: number,
  hand: { x: number; y: number; z: number },
  filter: number,
  exclude: RAPIER.RigidBody | null,
  water: WaterTest | null,
  dt = 0,
  vehicles: readonly Vehicle[] = [],
  peers: PeerHulls | null = null,
): GrappleMark {
  const v = g.view;
  v.vehicles = vehicles;
  v.peers = peers;
  v.eyeX = eye.x;
  v.eyeY = eye.y;
  v.eyeZ = eye.z;
  v.dirX = dir.x;
  v.dirY = dir.y;
  v.dirZ = dir.z;
  v.orbit = orbit;
  v.hand = hand;
  v.filter = filter;
  v.exclude = exclude;
  return g.probeMark(physics, water, dt);
}

/** What the drawn water is at a point and a time; -Infinity is no water. */
export type Surface = (x: number, z: number, t: number) => number;

/**
 * The player, on foot, as `Player.update` steps it under Jedi Academy's movement: the keys block (the grapple's
 * own `stepKeys` first), the water decision, the rope's words, the swim or the movement's step, the plunge, the
 * grapple's step before the move, the snap switch, the collider sync and the correction, the controller, the
 * clip, the place, the grounded test and the landing clamp, the grapple's step after the move, the next place
 * for the kinematic body, and the physics' own step after it all.
 */
export class TestBody implements GrappleBody {
  readonly physics: Physics;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  grounded = true;
  swimming = false;
  /** Smoothness II: a rig a test poses, handed to the drop's call as the player hands its own (null: the clocks alone). */
  dropRig: CharacterRig | null = null;
  submerged = false;
  depth = Number.NEGATIVE_INFINITY;
  inside = false;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  colliderOffsetY = CAPSULE_RADIUS + STAND_HALF_HEIGHT;
  readonly jka = new JkaMovement();
  readonly grapple: Grapple;
  readonly input: TestInput;
  readonly cmd: MoveCommand;
  readonly force = { value: 100, spend: (n: number) => { this.force.value = Math.max(0, this.force.value - n); } };
  /** Off: the grapple's hooks are never called at all (the day-one comparison). */
  hooks = true;
  /** The drawn water's surface; none by default. */
  surface: Surface = () => Number.NEGATIVE_INFINITY;
  /** The camera's flattened forward and right, which the move keys and the swim read. */
  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly right = new THREE.Vector3(1, 0, 0);
  /** The camera's look's upward share, for the swim's dive. */
  lookY = 0;
  t = 0;
  /** Crouched whatever the keys say (the hook mutes the crouch key while it is out): the collider sync's test. */
  crouchHeld = false;
  /** Force Speed's scale on the movement's speed. */
  speedScale = 1;
  /** The slide's airborne word handed to the movement on the ground whenever the rope is attached, slack or not: the apex rule's ground half on its own. */
  forceSlide = false;
  /** The swim holds the fall's apex every frame (the day-one change); off, the water's control case, the old game. */
  swimHoldsApex = true;
  /** The slope limit (wave 2b): the very rule the player's update steps, in the same places (`LOCO_TUNE.slopeRule`). */
  readonly slope = new SlopeRule();
  /** Stairs II (A): the step-up's mend, the very one the player's update steps, in the same places (`LOCO_TUNE.step.rule`). */
  readonly stepUp = new StepUp((h, r) => new RAPIER.Capsule(h, r));
  /** Wave 4: the ledges (`climb.ledges`), stepped in the player's own places: the hang in place of the movement, the grab after the move, the haul's hand-over after the rope's step. */
  readonly ledge = new LedgeHang({ ray: () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), capsule: (h, r) => new RAPIER.Capsule(h, r), cuboid: (x, y, z) => new RAPIER.Cuboid(x, y, z) });
  readonly ledgeIn = new LedgeIn();
  /** Climbing II: the use key handed to the climb, as the game's one dispatch hands it (nothing else in the harness takes the key). */
  readonly climbAsk = new ClimbAsk();
  /** Wave 2a's stamina pool (100 points) as the player's `loco.stamina` keeps it. */
  readonly stamina = new Stamina(100);
  /** The body's heading, radians (the ledges turn it to face the wall). */
  heading = 0;
  /** What the ledges said on the message line. */
  readonly ledgeWords: string[] = [];
  /** The figure's size the ledges are handed (the player's `ledgeScale`). */
  ledgeScale = 1;
  /** The frames the ledges held the body for (each one's place written by the hang). */
  hangFrames = 0;
  /** Wave 4, item B: the wall climb (`climb.wall`), stepped in the player's own places: the climb in place of the movement, the start after the ledges' grab. */
  readonly wall = new WallClimb({ ray: () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), capsule: (h, r) => new RAPIER.Capsule(h, r) });
  /** The frames the climb held the body for. */
  wallFrames = 0;
  /** The move was cut short across the ground (the player's `wallBlocked`). */
  private wallBlocked = false;
  private colliderCrouched: boolean | null = false;
  /**
   * The feedback round, items 3 and 4: the body's shape (`src/player/bodyShape.ts`), stepped in the player's own places under
   * `MOVE_TUNE`: the prone key and its asks, the capsule lying along a prone body and ducked under what stands over it, the
   * lying turn after the heading. With both switches at their other setting none of it runs and the frame is as it was.
   */
  readonly shape = new BodyShape({ capsule: (h, r) => new RAPIER.Capsule(h, r), ball: (r) => new RAPIER.Ball(r), cuboid: (x, y, z) => new RAPIER.Cuboid(x, y, z) });
  /** (Readable: Smoothness II's item 4 tests hand it the posed figure's top, as the player's `duckFigure` does.) */
  readonly shapeIn = new ShapeIn();
  /** Climbing II's smoothness round, item 4 (`MOVE_TUNE.duckPace`): the player's own `duck`, stepped in its places (the pace without the speed classes, as this body has none). */
  readonly duck = new DuckPace();
  /** The prone key's jump latch (the player's `jumpLatched`): getting up on the jump key does not also jump. */
  private jumpLatched = false;
  /**
   * Where a lying body turns to (a test's, as the player's own heading rule turns it toward the view or the travel); null
   * turns it toward its travel while it crawls, as the player's does with no fight and no gun up.
   */
  headingWanted: number | null = null;
  /** The placing hand holds something (the player's `handPlacing`): the duck waits. */
  placingHand = false;
  private readonly swimIn = newSwimIn();
  private readonly swimOut = newSwimOut();
  readonly swimProbe = { dt: 0, surface: 0, want: 0, from: 0, gap: 0, ride: 0, riding: false, asked: 0, capped: 0, moved: Number.NaN, rope: false };
  private readonly mutes: string[] = [];
  private readonly move = new THREE.Vector3();
  private readonly walkPast = (c: RAPIER.Collider): boolean => !this.physics.isRagdoll(c.handle) && !this.physics.isPeer(c.handle) && !this.physics.isWalkThrough(c.handle);
  /** The mark a press fires at, as the game's `fireGrapple` reads the hook's own mark; set by the test. */
  fireAt: { x: number; y: number; z: number } | null = null;
  /**
   * What the game's world steps between the player's update and the physics' step (`world.update`, where the loose
   * props' pool writes each awake prop's mesh from its body), called there in every frame: so a mesh read in the next
   * frame's update is a physics step behind its body, as it is in the game. None by default.
   */
  beforeStep: ((dt: number) => void) | null = null;
  /**
   * What happens before the frame's own work begins: the messages the page handled since the last frame, and the
   * moment the game reads at its top (`App`'s `reckonAt`, which the peers' pictures are reckoned to later in the same
   * frame). None by default.
   */
  frameStart: ((dt: number) => void) | null = null;
  /** What refuses a shot, as `Player.grappleFireState` fills it. */
  prone = false;
  kneeling = false;
  moveProfile: 'jka' | 'swg' = 'jka';
  private readonly fireState: GrappleFireState = newFireState();
  stepsAtReset = 0;
  lastFireRefusal = '';
  // Measurements.
  fallDamage = 0;
  rollSaved = 0;
  rolled = false;
  impacts: number[] = [];
  swimToggles = 0;
  jumped = 0;
  specials: string[] = [];
  // Health, as the player's own harm rule keeps it (`harmRule.ts`'s `takeHarm`, the very glue `Player.takeDamage`
  // runs past god mode): what the slam takes off, with last stand.
  hp = 100;
  lastStand = false;
  god = false;
  readonly damageTaken = 1;
  readonly stats = { rollIframes: 0 };
  onHarm: ((lost: number, kind: HarmKind) => void) | null = null;
  onDodge: ((source: unknown) => void) | null = null;
  /** Every loss the hook asked for, with its kind. */
  readonly harms: { amount: number; kind: HarmKind }[] = [];
  private readonly harmAsk = newHarmAsk();
  private readonly harmAnswer = newHarm();
  /** Wave 3: the vehicles the rope may meet (stepped by the test in `beforeStep`, as the game's loop steps them after the player), the hull test's own controller, and the terrain's height (`groundAt`) as the frame reads it. */
  vehicles: Vehicle[] = [];
  readonly hullController: RAPIER.KinematicCharacterController;
  groundAt: ((x: number, z: number) => number) | null = null;
  ground = Number.NEGATIVE_INFINITY;
  /** Wave 3c: other players' vehicles as their boxes (a real `RemoteBodies.hullBoxes()`, or a test's own stand-in), refilled by the test in `beforeStep` as the game's peers are after the player. */
  peerHulls: PeerHulls | null = null;

  constructor(physics: Physics) {
    this.physics = physics;
    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(STAND_HALF_HEIGHT, CAPSULE_RADIUS).setTranslation(0, CAPSULE_RADIUS + STAND_HALF_HEIGHT, 0).setSolverGroups(PLAYER_SOLVER), this.body);
    const controller = world.createCharacterController(0.04);
    controller.enableAutostep(0.5, 0.2, true);
    controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    controller.enableSnapToGround(0.35);
    controller.setApplyImpulsesToDynamicBodies(false);
    controller.setCharacterMass(80);
    this.controller = controller;
    // Stairs II (A): the capsule's radius and the controller's offset, for the step's casts (the player's own lines).
    this.stepUp.at.r = CAPSULE_RADIUS;
    this.stepUp.at.off = 0.04;
    // The hull test's controller, by the very maker the player calls.
    this.hullController = makeHullController(world);
    this.grapple = new Grapple(RAPIER, physics);
    this.grapple.vehicleOf = vehicleOfCollider;
    this.input = newInput();
    this.cmd = { forward: new THREE.Vector3(), right: new THREE.Vector3(), fmove: 0, smove: 0, walk: false, crouch: false, roll: false, jump: false, jumpPressed: false, attack: false, speedScale: 1 };
    this.cmd.probe = (dir, dist) => this.probeWall(dir, dist);
    this.cmd.groundDistance = (max) => {
      const d = this.physics.groundDistance(this.pos.x, this.pos.y + 0.1, this.pos.z, max * 0.0254 + 0.1, this.body);
      return d === null ? null : Math.max(0, (d - 0.1) / 0.0254);
    };
  }

  get filter(): number {
    return this.inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : groups(Group.all, Group.all);
  }

  /** A loss of health as the player takes one: god mode first, then the harm rule itself. */
  takeDamage(amount: number, force: boolean, kind: HarmKind): boolean {
    if (this.god && !force) return false;
    this.harms.push({ amount, kind });
    return takeHarm(this, amount, force, kind, null, this.harmAsk, this.harmAnswer);
  }

  /** The game's wall probe for the Jedi's wall moves (`Player.probeWall`). */
  private probeWall(dir: THREE.Vector3, dist: number): THREE.Vector3 | null {
    const len = CAPSULE_RADIUS + dist * 0.0254;
    const ray = new RAPIER.Ray({ x: this.pos.x, y: this.pos.y + 0.9, z: this.pos.z }, { x: dir.x, y: 0, z: dir.z });
    const hit = this.physics.world.castRayAndGetNormal(ray, len, true, undefined, this.filter, undefined, this.body, (c) => {
      const b = c.parent();
      return !b || b.isFixed();
    });
    return hit ? new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) : null;
  }

  /** Stand the body somewhere, as `Player.reset` does as far as the movement and the rope go. */
  place(x: number, y: number, z: number): void {
    this.grapple.letGo('reset');
    this.stepsAtReset = this.physics.steps;
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.swimming = false;
    this.submerged = false;
    this.jka.reset();
    this.slope.reset();
    this.ledge.reset('stood elsewhere');
    this.wall.reset('stood elsewhere');
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    // The feedback round, items 3 and 4: stood up fresh, standing (the player's `reset`).
    if (shapeRulesOn()) {
      if (MOVE_TUNE.proneShape === 'lying') this.prone = false;
      if (this.shape.kind === LYING || this.shape.tall !== STAND_TALL) this.shape.writeUpright(this.collider, x, y, z, STAND_TALL);
      this.shape.reset();
      this.colliderOffsetY = this.shape.offsetY;
      this.colliderCrouched = null;
    }
    // Climbing II's smoothness round, item 4 (the player's `reset`): nothing of the duck's pace carried to the new place.
    this.duck.reset();
    this.collider.setTranslation({ x, y: y + this.colliderOffsetY, z });
  }

  /** The rope point: over the feet by `ropeY`. */
  hand(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + GRAPPLE_TUNE.ropeY, this.pos.z);
  }

  /** Fasten the rope at once (the console's and the prototype's `hook`). */
  hook(x: number, y: number, z: number, nx: number, ny: number, nz: number, col: RAPIER.Collider | null, length = -1): void {
    this.grapple.attachNow(this, x, y, z, nx, ny, nz, col, length);
  }

  /** Everything that refuses a shot, as the player fills it. */
  fireStateNow(): GrappleFireState {
    const s = this.fireState;
    s.prone = this.prone;
    s.kneeling = this.kneeling;
    s.rolling = this.jka.rolling;
    s.special = this.jka.inSpecialJump;
    s.swgProfile = this.moveProfile === 'swg';
    s.stepped = this.physics.steps > this.stepsAtReset;
    return s;
  }

  /** The game's `fireGrapple`, over the hook's own mark worked out from the hand toward `fireAt`. */
  private readonly fireNow = (): void => {
    const g = this.grapple;
    const why = g.refusal(this.fireStateNow());
    const at = this.fireAt;
    if (!at) {
      this.lastFireRefusal = 'nothing to fire at';
      return;
    }
    const h = this.hand();
    const d = new THREE.Vector3(at.x, at.y, at.z).sub(h).normalize();
    probeFrom(g, this.physics, h, d, 0, h, this.filter, this.body, null, 0, this.vehicles, this.peerHulls);
    if (why || !g.mark.shows) {
      this.lastFireRefusal = why || `the mark is on ${g.mark.kind}`;
      return;
    }
    this.lastFireRefusal = '';
    g.fire(g.mark.x, g.mark.y, g.mark.z, h, this.vel, this.physics, this.filter, this.body, d.x, d.y, d.z, g.markTarget());
  };

  /** Crouched or standing: the capsule's half height and its offset, written as `Player.setCrouchCollider` writes them. */
  setCrouchCollider(crouched: boolean): void {
    if (crouched === this.colliderCrouched) return;
    // The body's shape left it lying (the feedback round, item 3): upright again before today's rule writes it.
    if (this.shape.kind === LYING) this.shape.writeUpright(this.collider, this.pos.x, this.pos.y, this.pos.z, STAND_TALL);
    this.shape.followCrouch(crouched);
    this.colliderCrouched = crouched;
    const half = crouched ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.collider.setHalfHeight(half);
    this.collider.setTranslationWrtParent({ x: 0, y: CAPSULE_RADIUS + half, z: 0 });
    this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + CAPSULE_RADIUS + half, z: this.pos.z });
    this.colliderOffsetY = CAPSULE_RADIUS + half;
  }

  /** The player's `proneAsk`: lying down refused with the rope out, too deep, or with no room; getting up refused with no room to stand. */
  private proneAsk(want: boolean, input: TestInput): boolean {
    const w = this.physics.world as unknown as ShapeWorld;
    const S = this.shape;
    if (want === this.prone) return want;
    if (want) {
      if (this.grapple.out || this.grapple.released) S.said = S.last = 'Not with the grappling rope out.';
      else if (this.depth > 2 * MOVE_TUNE.lyingRadius) S.said = S.last = 'Too deep to lie down here.';
      else if (S.mayLie(w, this.pos.x, this.pos.y, this.pos.z, this.heading, this.ledgeScale, this.filter)) return true;
      if (S.said) this.ledgeWords.push(S.said);
      S.said = '';
      return false;
    }
    const tall = MOVE_TUNE.duck === 'on' || input.held('crouch') || this.kneeling ? CROUCH_TALL : STAND_TALL;
    if (S.mayRise(w, this.pos.x, this.pos.y, this.pos.z, tall, this.filter)) return false;
    if (S.said) this.ledgeWords.push(S.said);
    S.said = '';
    return true;
  }

  /** The player's `stepShape`: lying while prone under 'lying', else upright (ducked on its feet with the duck on, crouched, standing). */
  private stepShape(dt: number, moving: boolean, move: THREE.Vector3, crouching: boolean): void {
    const S = this.shape;
    const w = this.physics.world as unknown as ShapeWorld;
    const lying = this.prone && MOVE_TUNE.proneShape === 'lying';
    const f = this.shapeIn;
    f.dt = dt;
    f.x = this.pos.x;
    f.y = this.pos.y;
    f.z = this.pos.z;
    f.heading = this.heading;
    f.scale = this.ledgeScale;
    f.filter = this.filter;
    this.groundPlaneInto(f);
    if (lying) S.holdLying(f, this.collider);
    else {
      f.vx = this.vel.x;
      f.vz = this.vel.z;
      f.moveX = moving ? move.x : 0;
      f.moveZ = moving ? move.z : 0;
      const g = this.grapple;
      f.feet = this.grounded && !this.swimming && !this.prone && !this.kneeling && !(this.hooks && (g.attached || g.released)) && !this.slope.sliding && !this.placingHand;
      f.crouch = (crouching || this.prone || this.kneeling) && this.grounded;
      f.lying = false;
      // The slope under the feet (the slope rule's plane, last judged): how far the floor rises under the capsule's rim.
      const pny = this.slope.planeNy;
      const pt = pny > 0.1 ? Math.sqrt(this.slope.planeNx * this.slope.planeNx + this.slope.planeNz * this.slope.planeNz) / pny : 0;
      f.rise = pt > 0 ? (pt < 1 ? pt : 1) * 0.35 : 0;
      S.stepUpright(w, f, this.collider);
      // Climbing II's smoothness round, item 4 (the player's own lines): a roof ahead too low for the deepest duck and a lying
      // body fits here: the duck lays the body down, never where Z would refuse it (the rope out, water deeper than it lies).
      if (S.lieAhead && !this.prone && !this.grapple.out && !this.grapple.released && !(this.depth > 2 * MOVE_TUNE.lyingRadius)) {
        this.prone = true;
        this.kneeling = false;
        this.duck.lying = true;
        this.duck.laid++;
        S.holdLying(f, this.collider);
      }
    }
    this.colliderOffsetY = S.offsetY;
    this.colliderCrouched = null;
  }

  /** The player's `riseFromDuck`: a body the duck laid down gets up into a crouch where `riseClear` finds the room. */
  private riseFromDuck(moving: boolean, move: THREE.Vector3): void {
    const S = this.shape;
    const f = this.shapeIn;
    f.x = this.pos.x;
    f.y = this.pos.y;
    f.z = this.pos.z;
    f.heading = this.heading;
    f.scale = this.ledgeScale;
    f.filter = this.filter;
    f.vx = this.vel.x;
    f.vz = this.vel.z;
    f.moveX = moving ? move.x : 0;
    f.moveZ = moving ? move.z : 0;
    if (!S.riseClear(this.physics.world as unknown as ShapeWorld, f)) return;
    this.prone = false;
    this.duck.lying = false;
    this.duck.rose++;
    S.writeUpright(this.collider, this.pos.x, this.pos.y, this.pos.z, MOVE_TUNE.riseAt);
    this.colliderOffsetY = S.offsetY;
  }

  /** The player's `groundPlaneInto`: the slope rule's last plane into the shape's frame. */
  private groundPlaneInto(f: ShapeIn): void {
    f.nx = this.slope.planeNx;
    f.ny = this.slope.planeNy;
    f.nz = this.slope.planeNz;
  }

  /** The player's `turnLying`: the lying capsule turned with the heading where it fits, slid out where that clears it, else the turn refused. */
  private turnLying(): void {
    const S = this.shape;
    if (S.kind !== LYING || !this.prone) return;
    const w = this.physics.world as unknown as ShapeWorld;
    const f = this.shapeIn;
    f.x = this.pos.x;
    f.y = this.pos.y;
    f.z = this.pos.z;
    f.heading = this.heading;
    f.scale = this.ledgeScale;
    f.filter = this.filter;
    this.groundPlaneInto(f);
    S.turnLyingIn(w, f, this.collider);
    if (S.slideX !== 0 || S.slideZ !== 0) {
      this.pos.x += S.slideX;
      this.pos.z += S.slideZ;
    }
    this.heading = S.lyingYaw;
  }

  /** Hold a key (KeyboardEvent code or Mouse<n>) down, or let it go, as `__debug.advance` does. */
  key(code: string, down: boolean): void {
    this.input.force(code, down);
  }

  /** One frame of the game's loop for this body, `Player.update`'s on-foot order, then the physics' step. */
  frame(dt: number): void {
    this.frameStart?.(dt);
    const input = this.input;
    const g = this.grapple;
    this.t += dt;
    // The key block: the grapple's own part, as `stepGrappleKeys` calls it.
    if (this.hooks) g.stepKeys(input, this, this.mutes, this.fireNow);
    // Climbing II: the use key, as the game's dispatch hands it (here nothing else takes it, so every press is the climb's),
    // held while it is held, and let go while the hands already hold something (the game mutes the key then).
    const climbHolds = this.ledge.holding || this.wall.holding;
    if (!climbHolds && input.pressedAction('mount')) this.climbAsk.press();
    this.climbAsk.hold(!climbHolds && input.held('mount'));
    // Wave 4: hanging, the ledge has the body in place of the movement (the player's `hangFrame`).
    if (this.ledge.holding) {
      this.hangFrame(dt);
      return;
    }
    // Wave 4, item B: on a wall, the climb has the body in place of the movement (the player's `wallFrame`).
    if (this.wall.holding) {
      this.wallFrame(dt);
      return;
    }
    let mx = 0;
    let mz = 0;
    if (input.held('forward')) mz += 1;
    if (input.held('back')) mz -= 1;
    if (input.held('left')) mx -= 1;
    if (input.held('right')) mx += 1;
    const move = this.move.set(0, 0, 0).addScaledVector(this.forward, mz).addScaledVector(this.right, mx);
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();
    // The speed keys as the player's record answers them for a body without the speed classes (this one has no rig, so
    // none): Shift walks, as it did before them, and so does the walk key held (`BodyLoco.keys`).
    const walking = input.held('speedUp') || input.held('walk');
    // The feedback round, items 3 and 4 (the player's own posture lines, under `MOVE_TUNE`): Z toggles prone on the ground,
    // under 'lying' asking for room to lie and to get up; the jump key gets up and is latched until let go.
    const rules = shapeRulesOn();
    let wasProne = false;
    if (rules) {
      const lyingRule = MOVE_TUNE.proneShape === 'lying';
      if (input.pressedAction('prone') && !this.swimming) this.prone = lyingRule ? this.proneAsk(!this.prone, input) : !this.prone;
      if (this.prone && input.pressedAction('jump')) this.jumpLatched = true;
      if (!input.held('jump')) this.jumpLatched = false;
      wasProne = this.jumpLatched;
      const lyingDrowns = lyingRule && this.prone && this.depth > 2 * MOVE_TUNE.lyingRadius;
      if (this.prone && (this.swimming || input.pressedAction('jump') || lyingDrowns)) this.prone = lyingRule && !this.swimming ? this.proneAsk(false, input) : false;
      // Climbing II's smoothness round, item 4 (the player's own lines): a body the duck laid down gets up on its own where the room comes back.
      if (!this.prone) this.duck.lying = false;
      else if (this.duck.lying && this.grounded && lieOn()) this.riseFromDuck(moving, move);
    }
    let crouching = !this.swimming && !(rules && this.prone) && (input.held('crouch') || this.crouchHeld || (this.ledge.keepCrouched && !this.ledge.standRoom(this.physics.world as unknown as LedgeWorld, this, this.filter)));
    if (rules) this.stepShape(dt, moving, move, crouching);
    else this.setCrouchCollider(crouching && this.grounded);
    // Item 4 (the player's `stepDuckPace`): a body the duck laid down crouches no more; the pace and the clips from the height.
    if (paceOn()) {
      if (this.prone) crouching = false;
      this.duck.step(this.shape.tall, !this.prone && this.shape.kind !== LYING && this.shapeIn.feet, crouching, this.shape.duckCls);
    } else if (this.duck.active) this.duck.step(STAND_TALL, false, false);
    let speed = (walking ? WALK_SPEED : RUN_SPEED) * (crouching && this.grounded ? 0.5 : 1);
    // Item 4, as the player's without the speed classes (this body has none).
    if (this.duck.active) speed *= (this.duck.crouch && !crouching && this.grounded ? 0.5 : 1) * this.duck.share;
    // The water.
    const surface = this.surface(this.pos.x, this.pos.z, this.t);
    const depth = surface - this.pos.y;
    const wasSwimming = this.swimming;
    this.swimming = !this.inside && depth > (this.swimming ? SWIM_DEPTH - 0.3 : SWIM_DEPTH);
    this.submerged = this.swimming && depth > DIVE_DEPTH_FOR_TESTS;
    if (wasSwimming !== this.swimming) this.swimToggles++;
    this.depth = depth;
    if (this.hooks && g.out) {
      g.refreshModes(this);
      g.keys.swayX = moving ? move.x : 0;
      g.keys.swayZ = moving ? move.z : 0;
    }
    if (this.swimming) {
      const sw = this.swimIn;
      sw.vel = this.vel;
      sw.posY = this.pos.y;
      sw.surface = surface;
      sw.depth = depth;
      sw.submerged = this.submerged;
      sw.jump = input.held('jump');
      sw.crouch = input.held('crouch');
      sw.moving = moving;
      sw.moveX = move.x;
      sw.moveZ = move.z;
      if (moving) sw.diveY = this.lookY;
      sw.forward = mz >= 0;
      sw.speed = speed;
      sw.dt = dt;
      sw.ropeLift = this.hooks && g.out && g.liftsSwimmer(this);
      sw.towed = this.hooks && g.out && g.towsSwimmer(this, sw);
      const swum = swimStep(sw, this.swimProbe, this.swimOut);
      speed = swum.speed;
      this.grounded = swum.grounded;
      if (this.swimHoldsApex) this.jka.holdApex(this.pos.y);
    } else {
      const c = this.cmd;
      c.forward.copy(this.forward);
      c.right.copy(this.right);
      c.fmove = mz;
      c.smove = mx;
      c.walk = walking;
      // Item 4 (the player's line): ducked to `crouchAt` the body moves crouched.
      c.crouch = crouching || this.duck.crouch;
      // Prone (the feedback round's postures): no roll and no jump, and the crawl's pace (the speed classes' own prone crawl,
      // `LOCO_TUNE.prone`, walked or not, on Jedi Academy's own run or walk, as the player's classes put it on the movement).
      const lies = rules && this.prone;
      c.roll = input.pressedAction('crouch') && moving && !lies;
      c.jump = input.held('jump') && !lies && !wasProne;
      c.jumpPressed = input.pressedAction('jump') && !lies && !wasProne;
      c.attack = false;
      c.speedScale = lies ? (this.speedScale * (walking ? LOCO_TUNE.prone.forward.slow : LOCO_TUNE.prone.forward.normal)) / (JKA.speed * UNIT * (walking ? JKA.walkScale : 1)) : this.speedScale;
      // Item 4 (the player's line without the speed classes): the duck's pace as a share of the posture's own.
      if (!lies && this.duck.active) c.speedScale *= this.duck.share;
      // The rope's rewrite of the command is the hook's own `command`, the very call the player's update makes.
      let stepGrounded = this.hooks ? g.command(c, this.grounded) : this.grounded;
      if (this.hooks && g.attached && this.forceSlide) stepGrounded = false;
      // A jump off a face too steep to stand on, where the tune allows one (the player's own two lines).
      const slopeJumped = this.slope.jumpOff(this.vel, c.jumpPressed);
      if (slopeJumped) this.jka.markJumpStart(this.pos.y);
      const ev = this.jka.step(dt, this.vel, this.pos, stepGrounded, c, this.force);
      if (slopeJumped) ev.jumped = true;
      if (ev.jumped) {
        this.grounded = false;
        this.jumped++;
      }
      if (ev.special) {
        this.grounded = false;
        this.specials.push(ev.special);
      }
      if (ev.rolled) this.rolled = true;
      if (ev.damage > 0) this.fallDamage += ev.damage;
      this.rollSaved += ev.rollSaved;
    }
    // Falling into deep water: the plunge slows quickly.
    if (depth > 0 && !this.swimming && this.vel.y < -4) this.vel.y += (-4 - this.vel.y) * (1 - Math.exp(-dt * 8));
    if (this.slope.sliding) this.slope.share(this.vel, dt, this.jka.gravity);
    if (this.hooks && g.out) g.beforeMove(this, dt);
    if (this.vel.y > 0.5 || this.swimming || this.slope.sliding || (this.hooks && g.attached && g.modes.swinging)) this.controller.disableSnapToGround();
    else this.controller.enableSnapToGround(0.35);
    this.slope.controllerFor(this.controller);
    let moveX = this.vel.x * dt;
    let moveY = this.vel.y * dt;
    let moveZ = this.vel.z * dt;
    // Stairs II (A): where the body stands before the move, for the collider's sync and the step (the player's own lines).
    const su = this.stepUp.at;
    su.x = this.pos.x;
    su.y = this.pos.y;
    su.z = this.pos.z;
    su.localY = this.colliderOffsetY;
    su.half = this.colliderOffsetY - CAPSULE_RADIUS;
    // On real ground only (the player's own line: the slope rule's last verdict found something under the body).
    su.ruled = this.grounded && !this.swimming && !(this.hooks && (g.attached || g.released)) && !this.slope.sliding;
    // The feedback round, item 3: a lying capsule is no upright one the step casts for (the player's own lines), but its
    // collider is still put where the body is before the move where the step would reach it.
    const lyingSync = this.shape.kind === LYING && su.ruled;
    if (this.shape.kind === LYING) su.ruled = false;
    su.supported = this.slope.supported;
    su.filter = this.filter;
    this.stepUp.reach(this.physics.world, this.body, this.collider, this.walkPast);
    if (this.hooks && (g.attached || g.released)) {
      g.syncCollider(this);
      moveX += g.corr.x;
      moveY += g.corr.y;
      moveZ += g.corr.z;
    } else if (this.slope.settling) this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + this.colliderOffsetY, z: this.pos.z });
    else this.stepUp.sync(this.collider);
    if (lyingSync) this.shape.syncLying(this.collider, su);
    // Wave 3's crease: how fast a frame that began in the air falls into its move, and the frame's seconds (the player's own lines).
    this.slope.at.fall = !this.grounded && this.vel.y < 0 ? -this.vel.y : 0;
    this.slope.at.dt = dt;
    this.controller.computeColliderMovement(this.collider, { x: moveX, y: moveY, z: moveZ }, undefined, this.filter, this.walkPast);
    const mv = this.controller.computedMovement();
    // Stairs II (A): where the move fell short across the ground at a riser the controller could not lift the capsule over, the step (the player's own lines).
    su.ax = moveX;
    su.ay = moveY;
    su.az = moveZ;
    su.filter = this.filter;
    su.climb = LOCO_TUNE.slope.climb;
    this.stepUp.after(this.physics.world, this.controller, mv, this.body, this.collider, this.walkPast);
    if (this.hooks && (g.attached || g.released)) g.clip(this, mv);
    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.stepUp.stands) this.grounded = true;
    // The slope limit's verdict and slide, the player's own lines (its swim and its rope are the harness's `swimming`
    // and `g`); the movement's gravity is Jedi Academy's here, the only profile the harness steps.
    const slopeAt = this.slope.at;
    slopeAt.x = this.pos.x;
    slopeAt.y = this.pos.y;
    slopeAt.z = this.pos.z;
    slopeAt.offsetY = this.colliderOffsetY;
    // The feedback round, item 3: lying, the rule's sphere is the lying capsule's middle ball (the player's own line).
    slopeAt.r = CAPSULE_RADIUS;
    if (this.shape.kind === LYING) slopeAt.r = this.shape.radius;
    slopeAt.filter = this.filter;
    this.grounded = this.slope.judge(this.physics.world, this.grounded, !this.swimming && !(this.hooks && (g.attached || g.released)), this.body, this.walkPast);
    if (this.slope.sliding) this.jka.holdApex(this.slope.slide(this.vel, this.pos.y, this.jka.gravity));
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    if (!wasGrounded && this.grounded && Math.abs(mv.y) < 1e-4 && this.vel.y > 0) this.grounded = false;
    // Wave 4: a let-go's clocks, then a lip grabbed or lowered into (the player's `ledgeClocks` and `senseLedge`).
    if (this.ledge.tick(dt)) this.heading = this.ledge.turnNow;
    // (Smoothness II, item 1: the drop's clocks, the player's own call; a test that poses a rig hands it in as `dropRig`.)
    driveDropClip(this.dropRig, this.ledge, dt, this.grounded, !this.swimming && !(this.hooks && (g.attached || g.released)));
    if (this.wall.tick(dt)) this.heading = this.wall.turnNow;
    // Wave 4, item B: the move cut short across the ground (the player's own lines).
    const askH = moveX * moveX + moveZ * moveZ;
    this.wallBlocked = askH > 1e-8 && mv.x * mv.x + mv.z * mv.z < askH * 0.36;
    if (CLIMB_TUNE.ledges === 'on') {
      const li = this.fillLedgeIn(dt, move, wasGrounded);
      li.busy = this.swimming || (this.hooks && (g.out || g.released)) || this.jka.inSpecialJump || (this.jka.isForceJumping && this.vel.y > 0) || this.prone;
      if (this.ledge.sense(this.physics.world as unknown as LedgeWorld, this, li, this.stamina)) {
        this.takenByLedge();
        this.hangFrame(dt, true);
        return;
      }
    }
    // Wave 4, item B: onto a wall after the move (the player's `senseWall`).
    if (CLIMB_TUNE.wall === 'on') {
      const li = this.fillLedgeIn(dt, move, wasGrounded);
      li.busy = this.swimming || (this.hooks && (g.out || g.released)) || this.jka.inSpecialJump || (this.jka.isForceJumping && this.vel.y > 0) || this.prone || this.kneeling;
      li.airWallMove = !this.grounded && this.jka.airWallMoveOpen(this.pos, this.vel);
      if (this.wall.sense(this.physics.world as unknown as LedgeWorld, this, li, this.stamina)) {
        this.takenByWall();
        this.wallFrame(dt);
        return;
      }
    }
    this.ground = this.groundAt ? this.groundAt(this.pos.x, this.pos.z) : Number.NEGATIVE_INFINITY;
    if (this.hooks && g.out) g.afterMove(this, dt);
    if (this.hooks && g.lively) g.look(this, dt);
    // Wave 4: the haul ended under a lip it could not go over: a braced hang there (the player's `ledgeFromHaul`).
    if (this.hooks && g.haulStuck && CLIMB_TUNE.ledges === 'on') {
      const piv = g.pivot(new THREE.Vector3());
      if (this.ledge.fromHaul(this.physics.world as unknown as LedgeWorld, this, this.fillLedgeIn(0, null, false), piv.x - this.pos.x, piv.z - this.pos.z)) {
        g.letGo('ledge');
        this.takenByLedge();
        this.hangFrame(dt, true);
        return;
      }
    }
    if (g.attached && g.lastImpact > 0.5) this.impacts.push(g.lastImpact);
    // The feedback round, item 3: a lying body's heading (a test's, else toward its crawl, the player's own rule with no
    // fight and no gun up), then the lying capsule's turn, slid or refused (the player's `turnLying`, after its heading).
    if (rules && this.shape.kind === LYING) {
      const want = this.headingWanted ?? (moving ? Math.atan2(move.x, move.z) : this.heading);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 14);
      this.turnLying();
    }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    input.endFrame();
    this.beforeStep?.(dt);
    this.physics.step(dt);
  }

  /** The ledges' frame record, as the player's `fillLedgeIn` writes it. */
  private fillLedgeIn(dt: number, move: THREE.Vector3 | null, wasGrounded: boolean): LedgeIn {
    const li = this.ledgeIn;
    const input = this.input;
    li.dt = dt;
    li.heading = this.heading;
    li.grounded = this.grounded;
    li.wasGrounded = wasGrounded;
    li.jumped = this.vel.y > 0.5;
    li.crouchHeld = input.held('crouch');
    li.crouchPressed = input.pressedAction('crouch');
    li.jumpPressed = input.pressedAction('jump');
    li.forwardHeld = input.held('forward');
    li.forwardPressed = input.pressedAction('forward');
    li.backHeld = input.held('back');
    li.leftHeld = input.held('left');
    li.rightHeld = input.held('right');
    li.moveX = move ? move.x : 0;
    li.moveZ = move ? move.z : 0;
    li.scale = this.ledgeScale;
    li.filter = this.filter;
    li.pool = 100;
    li.busy = false;
    li.blocked = this.wallBlocked;
    li.airWallMove = false;
    li.use = this.climbAsk.on;
    // Climbing II, item 7: where the view looks (the camera's flattened forward), as the player's `hangFrame` hands it.
    li.viewYaw = Math.atan2(this.forward.x, this.forward.z);
    return li;
  }

  /** Onto a wall, as the player's `takenByWall`: the fall ends with no harm and the slope's memory is put down. */
  private takenByWall(): void {
    this.jka.reset();
    this.jka.holdApex(this.pos.y);
    this.slope.reset();
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.heading = this.wall.heading;
  }

  /** A frame on the wall (the player's `wallFrame`): the climb's step in place of the movement, then the physics. */
  private wallFrame(dt: number): void {
    this.wallFrames++;
    this.setCrouchCollider(false);
    const W = this.wall;
    W.step(this.physics.world as unknown as LedgeWorld, this, this.fillLedgeIn(dt, null, false), this.stamina, this.ledge);
    if (W.said) {
      this.ledgeWords.push(W.said);
      W.said = '';
    }
    this.jka.holdApex(this.pos.y);
    if (W.holding) {
      this.grounded = false;
      this.heading = W.heading;
    } else if (this.ledge.holding) {
      this.grounded = false;
      this.heading = this.ledge.heading;
    } else this.grounded = W.stood;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.input.endFrame();
    this.beforeStep?.(dt);
    this.physics.step(dt);
  }

  /** A grab, as the player's `takenByLedge`: the fall ends with no harm and the slope's memory is put down. */
  private takenByLedge(): void {
    this.jka.reset();
    this.jka.holdApex(this.pos.y);
    this.slope.reset();
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.heading = this.ledge.heading;
  }

  /** A frame of the hang (the player's `hangFrame`): the ledge's step in place of the movement, then the physics. `mid` the grab's own frame, whose move already ran. */
  private hangFrame(dt: number, mid = false): void {
    void mid;
    this.hangFrames++;
    this.ledge.step(this.physics.world as unknown as LedgeWorld, this, this.fillLedgeIn(dt, null, false), this.stamina);
    // The capsule the ledge's step has the body in: standing, but crouched over the top on a climb's last leg.
    this.setCrouchCollider(this.ledge.crouchedNow);
    if (this.ledge.said) {
      this.ledgeWords.push(this.ledge.said);
      this.ledge.said = '';
    }
    this.jka.holdApex(this.pos.y);
    if (this.ledge.holding) {
      this.grounded = false;
      this.heading = this.ledge.heading;
    } else this.grounded = this.ledge.stood;
    // Wave 4, item B: a hang a wall climb handed over eases the climb's lean out (the player's `hangFrame` too).
    this.wall.tick(dt);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.input.endFrame();
    this.beforeStep?.(dt);
    this.physics.step(dt);
  }

  /** Frames for `seconds` at `fps`, with `each` after every one. */
  run(fps: number, seconds: number, each?: (t: number) => void): void {
    const dt = 1 / fps;
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) {
      this.frame(dt);
      each?.((i + 1) * dt);
    }
  }

  /** The pivot the free span hangs from (the last bend, else the anchor). */
  pivot(out = new THREE.Vector3()): THREE.Vector3 {
    this.grapple.pivot(out);
    return out;
  }

  /** The capsule's deepest reach into an axis-aligned box, metres (for the tests' known shapes). */
  penetrationInBox(min: number[], max: number[]): number {
    const ax = this.pos.x;
    const az = this.pos.z;
    const y0 = this.pos.y + CAPSULE_RADIUS;
    const y1 = this.pos.y + 1.6 - CAPSULE_RADIUS;
    let best = Infinity;
    for (let i = 0; i <= 16; i++) {
      const y = y0 + ((y1 - y0) * i) / 16;
      const cx = Math.max(min[0], Math.min(max[0], ax));
      const cy = Math.max(min[1], Math.min(max[1], y));
      const cz = Math.max(min[2], Math.min(max[2], az));
      const inside = ax > min[0] && ax < max[0] && y > min[1] && y < max[1] && az > min[2] && az < max[2];
      const d = inside ? -Math.min(ax - min[0], max[0] - ax, y - min[1], max[1] - y, az - min[2], max[2] - az) : Math.hypot(ax - cx, y - cy, az - cz);
      best = Math.min(best, d);
    }
    return Math.max(0, CAPSULE_RADIUS - best);
  }
}
