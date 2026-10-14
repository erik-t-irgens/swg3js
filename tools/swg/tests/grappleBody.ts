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
): GrappleMark {
  const v = g.view;
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
  private colliderCrouched = false;
  private readonly swimIn = newSwimIn();
  private readonly swimOut = newSwimOut();
  readonly swimProbe = { dt: 0, surface: 0, want: 0, from: 0, gap: 0, ride: 0, riding: false, asked: 0, capped: 0, moved: Number.NaN, rope: false };
  private readonly mutes: string[] = [];
  private readonly move = new THREE.Vector3();
  private readonly walkPast = (c: RAPIER.Collider): boolean => !this.physics.isRagdoll(c.handle) && !this.physics.isPeer(c.handle) && !this.physics.isWalkThrough(c.handle);
  /** The mark a press fires at, as the game's `fireGrapple` reads the hook's own mark; set by the test. */
  fireAt: { x: number; y: number; z: number } | null = null;
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
    this.grapple = new Grapple(RAPIER, physics);
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
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
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
    probeFrom(g, this.physics, h, d, 0, h, this.filter, this.body, null);
    if (why || !g.mark.shows) {
      this.lastFireRefusal = why || `the mark is on ${g.mark.kind}`;
      return;
    }
    this.lastFireRefusal = '';
    g.fire(g.mark.x, g.mark.y, g.mark.z, h, this.vel, this.physics, this.filter, this.body, d.x, d.y, d.z);
  };

  /** Crouched or standing: the capsule's half height and its offset, written as `Player.setCrouchCollider` writes them. */
  setCrouchCollider(crouched: boolean): void {
    if (crouched === this.colliderCrouched) return;
    this.colliderCrouched = crouched;
    const half = crouched ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.collider.setHalfHeight(half);
    this.collider.setTranslationWrtParent({ x: 0, y: CAPSULE_RADIUS + half, z: 0 });
    this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + CAPSULE_RADIUS + half, z: this.pos.z });
    this.colliderOffsetY = CAPSULE_RADIUS + half;
  }

  /** Hold a key (KeyboardEvent code or Mouse<n>) down, or let it go, as `__debug.advance` does. */
  key(code: string, down: boolean): void {
    this.input.force(code, down);
  }

  /** One frame of the game's loop for this body, `Player.update`'s on-foot order, then the physics' step. */
  frame(dt: number): void {
    const input = this.input;
    const g = this.grapple;
    this.t += dt;
    // The key block: the grapple's own part, as `stepGrappleKeys` calls it.
    if (this.hooks) g.stepKeys(input, this, this.mutes, this.fireNow);
    let mx = 0;
    let mz = 0;
    if (input.held('forward')) mz += 1;
    if (input.held('back')) mz -= 1;
    if (input.held('left')) mx -= 1;
    if (input.held('right')) mx += 1;
    const move = this.move.set(0, 0, 0).addScaledVector(this.forward, mz).addScaledVector(this.right, mx);
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();
    const walking = input.held('walk');
    const crouching = !this.swimming && (input.held('crouch') || this.crouchHeld);
    this.setCrouchCollider(crouching && this.grounded);
    let speed = (walking ? WALK_SPEED : RUN_SPEED) * (crouching && this.grounded ? 0.5 : 1);
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
      c.crouch = crouching;
      c.roll = input.pressedAction('crouch') && moving;
      c.jump = input.held('jump');
      c.jumpPressed = input.pressedAction('jump');
      c.attack = false;
      c.speedScale = this.speedScale;
      // The rope's rewrite of the command is the hook's own `command`, the very call the player's update makes.
      let stepGrounded = this.hooks ? g.command(c, this.grounded) : this.grounded;
      if (this.hooks && g.attached && this.forceSlide) stepGrounded = false;
      const ev = this.jka.step(dt, this.vel, this.pos, stepGrounded, c, this.force);
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
    if (this.hooks && g.out) g.beforeMove(this, dt);
    if (this.vel.y > 0.5 || this.swimming || (this.hooks && g.attached && g.modes.swinging)) this.controller.disableSnapToGround();
    else this.controller.enableSnapToGround(0.35);
    let moveX = this.vel.x * dt;
    let moveY = this.vel.y * dt;
    let moveZ = this.vel.z * dt;
    if (this.hooks && g.attached) {
      g.syncCollider(this);
      moveX += g.corr.x;
      moveY += g.corr.y;
      moveZ += g.corr.z;
    }
    this.controller.computeColliderMovement(this.collider, { x: moveX, y: moveY, z: moveZ }, undefined, this.filter, this.walkPast);
    const mv = this.controller.computedMovement();
    if (this.hooks && g.attached) g.clip(this);
    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    if (!wasGrounded && this.grounded && Math.abs(mv.y) < 1e-4 && this.vel.y > 0) this.grounded = false;
    if (this.hooks && g.out) g.afterMove(this, dt);
    if (g.attached && g.lastImpact > 0.5) this.impacts.push(g.lastImpact);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    input.endFrame();
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
