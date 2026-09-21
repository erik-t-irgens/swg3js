// Loose props: two dozen crates and balls of OURS, stood round the arrival point, that a fight can
// knock about. Push one, pull one, grip and throw one, shoot one, blow one up.
//
// Why ours and not the world's own placed crates and barrels, which is the question anyone reading
// this will ask first: a placed object is one instance inside an instanced mesh whose collider is
// built by tier and thrown away by distance, so making one of them dynamic means pulling that
// instance out of its mesh, giving it a draw and a body of its own, and putting it back when its
// tier streams out. That is a streaming change, and it is the same change a player picking up a
// piece of furniture will need, so it belongs with housing and not with a fight. A pool of our own
// is the same shape as a thrown grenade, which already works.
//
// The rules this file lives by, which are the game's and not negotiable:
//   - Nothing is compiled during play. The pool is built into the scene while the loading screen is
//     up (World.warmUp), so `compileAllAsync` behind that screen builds its two programs and the
//     first crate anybody shoots compiles nothing.
//   - No light is ever added or removed. A prop has none; a blast's own flash is the pool's, as
//     everything else's is.
//   - Nothing is allocated in a steady frame. The pool, its meshes, its bodies and every vector
//     here are made once; a prop asleep (which after `sleep` seconds of stillness is all of them)
//     is not read at all, so a world nobody has kicked anything in costs the step one integer
//     compare per prop and nothing else. The engine's own `translation()` and `rotation()` do make
//     an object per call -- that is Rapier's, and the vehicles pay it too -- which is exactly why
//     only a prop that is awake and near is ever asked.
//   - A prop is a `Living` so that the Force's grip, its push and a blast's shove reach it through
//     the hooks those already have, but it is deliberately NOT in `World.targets()`: nothing in the
//     game should ever pick a fight with a crate, and `targets()` is what the brains, the turrets
//     and the auto-aim read. It is found by handle (`loosePropAt`, which `World.hittableAt` asks)
//     and by the two seams below, and by nothing else.
//   - A prop takes no damage at all. There is no damage model for one in this wave; a blow is a
//     shove and nothing more, so `dead` is false for as long as the world lasts.
//
// Every number here is INVENTED -- the count, where they stand, how big they are, what they weigh,
// how long they lie still before they sleep and how far off they are left -- and every one of them
// is in `PROPS` and moves live through `__debug.props({ ... })`.
import * as THREE from 'three';
import { Group, RAPIER, groups, type Physics } from '../core/physics.ts';
import { markActor } from './portalRender.ts';
import { nextLivingKey, type Aggression, type Hittable, type Living, type Side } from '../combat/kit.ts';

/**
 * Every number the loose props have. All INVENTED; nothing about them is in the game's own files.
 * The ones spent when the pool is built are in `BUILD_ONLY_KEYS` and take effect at the next world.
 */
export const PROPS = {
  /** How many stand in a world. Spent when the pool is built. */
  count: 24,
  /** A crate's side and a ball's radius, metres. Spent when the pool is built. */
  box: 0.6,
  ball: 0.4,
  /** What either weighs, kilograms. Spent when the pool is built (the collider carries it). */
  mass: 20,
  /** The first ring's distance from the arrival point, and how much further out each ring after it stands. Metres. Spent when the pool is built. */
  ring: 7,
  ringStep: 3.5,
  /** How many stand in one ring before another is started. Spent when the pool is built. */
  perRing: 8,
  /** How far above the ground one is stood, so it settles onto the ground rather than starting inside it. Metres. Spent when the pool is built. */
  lift: 0.35,
  /** How bouncy and how grippy a prop is, and how fast it sheds speed and spin of its own. Written onto the pool that is standing when one of them moves. */
  restitution: 0.22,
  friction: 0.85,
  linearDamping: 0.12,
  angularDamping: 0.45,
  /** Under this speed and this spin a prop counts as still (m/s, rad/s). */
  restSpeed: 0.14,
  restSpin: 0.3,
  /** Seconds still before it is put to sleep. */
  sleep: 2,
  /** Past this far from the player a prop is put to sleep and left where it lies. Metres. */
  far: 120,
  /** Thrown this far from where it was stood, or this far below it, a prop is put back on its stand. Metres. */
  lost: 400,
  fell: 80,
  /** The Force's shove on a prop: metres a second at the caller's own reach, falling off with distance. */
  shove: 14,
  /** What a shove adds upward, so a crate is lifted off the ground rather than scraped along it. */
  shoveLift: 5,
  /** A bolt's shove where the gun names none, and the little lift one gives. Metres a second. */
  boltShove: 2.5,
  boltLift: 0.8,
  /** The fastest the grip carries one toward the point it is held at, m/s. */
  gripSpeed: 14,
  /** Seconds after the last `holdAt` before a prop that was being gripped has its weight given back. */
  gripLapse: 0.2,
  /**
   * The two colours. OURS: a crate and a ball of ours are not the game's art and are not pretending
   * to be. Written onto the pool that is standing when one of them moves.
   */
  crateColour: 0x8a7350,
  ballColour: 0x6b7280,
};

/**
 * The knobs spent when the pool is built: how many there are, how big they are, what they weigh and
 * where they are stood. Moving one of these takes effect at the next world load, and `propsDebug`
 * says so in `atNextWorld` rather than letting the owner nudge a number that changes nothing.
 */
export const BUILD_ONLY_KEYS: readonly string[] = ['count', 'box', 'ball', 'mass', 'ring', 'ringStep', 'perRing', 'lift'];

/**
 * The knobs that are spent at build time too, but onto something that can simply be written again:
 * the bodies' damping, the colliders' friction and bounce, and the two colours. Moving one of these
 * is answered by pushing it onto the pool that is standing (`LoosePropPool.retune`), so they take
 * effect in the world the owner is in, which is what tuning a prop by eye needs.
 */
export const RETUNE_KEYS: readonly string[] = [
  'restitution',
  'friction',
  'linearDamping',
  'angularDamping',
  'crateColour',
  'ballColour',
];

/**
 * The knobs that would break the placement maths or the pool itself at zero or below: `perRing` is a
 * divisor and a modulus (0 makes every place NaN and stands two dozen bodies at NaN coordinates),
 * and the three sizes and the mass are Rapier's own and must be above zero.
 */
const POSITIVE_KEYS: readonly string[] = ['count', 'box', 'ball', 'mass', 'perRing'];

export type PropsTune = typeof PROPS;

const ZERO = { x: 0, y: 0, z: 0 };
const tmpDir = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpImpulse = { x: 0, y: 0, z: 0 };
const tmpVel = { x: 0, y: 0, z: 0 };
const tmpPoint = { x: 0, y: 0, z: 0 };

/**
 * One loose prop. A `Living` only so that the grip, the push and a blast reach it through the hooks
 * they already have; it is never in `World.targets()` and it is never hurt.
 */
class LooseProp implements Living {
  readonly key = nextLivingKey();
  /** 'crate' or 'ball': half the pool is a ball, and `label` is what the console and anything that names a body reads. */
  readonly label: string;
  readonly side: Side = 'neutral';
  readonly aggression: Aggression = 'passive';
  readonly pos = new THREE.Vector3();
  readonly halfHeight: number;
  /** Never true: there is no damage model for a prop this wave, and a body that can die would need one. */
  readonly dead = false;
  readonly mesh: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Where it was stood, so one thrown off the world can be put back rather than lost. */
  readonly stand = new THREE.Vector3();
  /** Seconds it has been still for. */
  still = 0;
  /** Seconds since the last `holdAt`, so a grip that simply stops asking gives the weight back. */
  sinceHold = Number.POSITIVE_INFINITY;
  /** How wide it is across, for `radiusToward` and for the sleep test. */
  private readonly reach: number;

  constructor(mesh: THREE.Mesh, body: RAPIER.RigidBody, collider: RAPIER.Collider, half: number, label: string) {
    this.mesh = mesh;
    this.body = body;
    this.collider = collider;
    this.halfHeight = half;
    this.reach = half;
    this.label = label;
  }

  radiusToward(): number {
    return this.reach;
  }

  /** Not hurt: a blow is a shove and the number is thrown away. `push` is metres a second. */
  damage(_amount: number, from?: THREE.Vector3, push = 0): void {
    if (!from || push <= 0) {
      this.wake();
      return;
    }
    tmpDir.copy(this.pos).sub(from);
    if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 1, 0);
    this.knock(tmpDir.normalize(), push);
  }

  /**
   * Shove it along `dir` at `power` metres a second, with a little lift so it leaves the ground.
   * With `at` -- a point in the world, which is what a bolt hands over -- the shove goes in there
   * rather than through the middle, so a crate shot in the corner turns as it goes instead of
   * sliding off flat; a push, a pull and a blast have no one point and go through the middle.
   */
  knock(dir: THREE.Vector3, power: number, lift = PROPS.shoveLift, at?: THREE.Vector3): void {
    const m = this.body.mass();
    tmpImpulse.x = dir.x * power * m;
    tmpImpulse.y = (dir.y * power + lift) * m;
    tmpImpulse.z = dir.z * power * m;
    if (at) {
      tmpPoint.x = at.x;
      tmpPoint.y = at.y;
      tmpPoint.z = at.z;
      this.body.applyImpulseAtPoint(tmpImpulse, tmpPoint, true);
    } else this.body.applyImpulse(tmpImpulse, true);
    this.still = 0;
  }

  /**
   * A bolt stopped on it. Taken whole rather than through `damage`, for the sound: a prop handed to
   * the plain path would be heard as a body being hit, and a crate is not a body. 'taken' is "I have
   * placed no hit effect of my own", so the bolt's own burst and the gun's own effect play where it
   * struck, and the shot is heard against metal. It leaves no scar, and that is the marks' own rule
   * and not this file's: a mark is a quad in the world, so only something that holds still takes one
   * (`marksHold`), or a mark on a crate somebody then shoves hangs in the air for its whole life.
   *
   * `point` is where the bolt actually stopped, which the caller has already worked out: the shove
   * goes in there, so a box shot square in a corner spins away rather than sliding off flat.
   */
  takeBolt(bolt: { dir: THREE.Vector3; push: number }, point?: THREE.Vector3): 'taken' {
    tmpDir.copy(bolt.dir);
    if (tmpDir.lengthSq() > 1e-6) {
      this.wake();
      this.knock(tmpDir.normalize(), bolt.push > 0 ? bolt.push : PROPS.boltShove, PROPS.boltLift, point);
    }
    return 'taken';
  }

  /**
   * Held in the air ahead of a Jedi. Carried by velocity rather than written into place, so the
   * solver still keeps it out of the walls, and weightless while it is held, so the hold does not
   * have to fight gravity every step.
   */
  holdAt(point: THREE.Vector3, dt: number): void {
    const step = Math.max(dt, 1 / 60);
    this.readPose();
    tmpTo.copy(point).sub(this.pos).divideScalar(step);
    const speed = tmpTo.length();
    if (speed > PROPS.gripSpeed) tmpTo.multiplyScalar(PROPS.gripSpeed / speed);
    tmpVel.x = tmpTo.x;
    tmpVel.y = tmpTo.y;
    tmpVel.z = tmpTo.z;
    this.body.setGravityScale(0, true);
    this.body.setLinvel(tmpVel, true);
    this.sinceHold = 0;
    this.still = 0;
  }

  /** Let go, thrown along `dir` at `power` metres a second. */
  release(dir: THREE.Vector3, power: number): void {
    this.giveWeightBack();
    this.knock(dir, power);
  }

  giveWeightBack(): void {
    if (this.sinceHold === Number.POSITIVE_INFINITY) return;
    this.sinceHold = Number.POSITIVE_INFINITY;
    this.body.setGravityScale(1, true);
  }

  wake(): void {
    this.body.wakeUp();
    this.still = 0;
  }

  /** The body's pose onto `pos` and onto the mesh. Rapier makes an object per read, so only a prop that is awake is asked. */
  readPose(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.pos.set(t.x, t.y, t.z);
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  /** Back on the stand it was given, still, awake and weighing what it did. */
  recall(): void {
    this.giveWeightBack();
    this.body.setTranslation({ x: this.stand.x, y: this.stand.y, z: this.stand.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel(ZERO, true);
    this.body.setAngvel(ZERO, true);
    this.readPose();
    this.still = 0;
  }
}

/** The pool of a world. Built once, stepped once a frame, freed with the world. */
class LoosePropPool {
  readonly group = new THREE.Group();
  readonly props: LooseProp[] = [];
  /** Which prop a collider belongs to, for `World.hittableAt`. */
  readonly byCollider = new Map<number, LooseProp>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly physics: Physics;
  /** For the console: how many were put back on their stands, and how many are awake now. */
  recalled = 0;

  constructor(physics: Physics, scene: THREE.Scene, at: THREE.Vector3, groundAt: (x: number, z: number) => number) {
    this.physics = physics;
    this.group.name = 'loose-props';
    const crateGeo = new THREE.BoxGeometry(PROPS.box, PROPS.box, PROPS.box);
    const ballGeo = new THREE.SphereGeometry(PROPS.ball, 16, 12);
    // Plain lit materials of ours. Nothing marks them `dry`, `interior` or `unlit`, so they take the
    // shadow cascades and the wet wrap with every other thing standing outdoors, which is what a
    // crate left in the rain should do.
    const crateMat = new THREE.MeshStandardMaterial({ color: PROPS.crateColour, roughness: 0.85, metalness: 0.05 });
    const ballMat = new THREE.MeshStandardMaterial({ color: PROPS.ballColour, roughness: 0.55, metalness: 0.25 });
    this.geometries.push(crateGeo, ballGeo);
    this.materials.push(crateMat, ballMat);

    for (let i = 0; i < PROPS.count; i++) {
      const crate = (i & 1) === 0;
      const half = crate ? PROPS.box / 2 : PROPS.ball;
      // Two rings of eight and however many a third needs: far enough out that nobody arrives inside one.
      const ring = Math.floor(i / PROPS.perRing);
      const step = i % PROPS.perRing;
      const angle = (step / PROPS.perRing) * Math.PI * 2 + ring * 0.4;
      const radius = PROPS.ring + ring * PROPS.ringStep;
      const x = at.x + Math.sin(angle) * radius;
      const z = at.z + Math.cos(angle) * radius;
      const y = groundAt(x, z) + half + PROPS.lift;
      const mesh = new THREE.Mesh(crate ? crateGeo : ballGeo, crate ? crateMat : ballMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, y, z)
          .setLinearDamping(PROPS.linearDamping)
          .setAngularDamping(PROPS.angularDamping)
          .setCcdEnabled(true),
      );
      const desc = (crate ? RAPIER.ColliderDesc.cuboid(half, half, half) : RAPIER.ColliderDesc.ball(half))
        .setMass(PROPS.mass)
        .setRestitution(PROPS.restitution)
        .setFriction(PROPS.friction);
      const collider = physics.world.createCollider(desc, body);
      // Outdoors, and found by everything: a query that passes a group meets it as it meets a wall.
      collider.setCollisionGroups(groups(Group.exterior, Group.all));
      const prop = new LooseProp(mesh, body, collider, half, crate ? 'crate' : 'ball');
      prop.pos.set(x, y, z);
      prop.stand.set(x, y, z);
      this.props.push(prop);
      this.byCollider.set(collider.handle, prop);
    }
    // Drawn in the world pass with everything else that moves.
    markActor(this.group);
    scene.add(this.group);
  }

  /**
   * One frame. A prop asleep is not read at all; one awake has its pose copied onto its mesh, is
   * counted still or not, and is put back on its stand if it has been thrown off the world.
   */
  step(dt: number, playerPos: THREE.Vector3): void {
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      if (p.sinceHold !== Number.POSITIVE_INFINITY) {
        p.sinceHold += dt;
        if (p.sinceHold > PROPS.gripLapse) p.giveWeightBack();
      }
      if (p.body.isSleeping()) continue;
      p.readPose();
      // Thrown off the world, or fallen through it: back where it was stood. The pool never loses one.
      if (p.pos.y < p.stand.y - PROPS.fell || p.pos.distanceToSquared(p.stand) > PROPS.lost * PROPS.lost) {
        p.recall();
        this.recalled++;
        continue;
      }
      const v = p.body.linvel();
      const w = p.body.angvel();
      const moving = v.x * v.x + v.y * v.y + v.z * v.z > PROPS.restSpeed * PROPS.restSpeed || w.x * w.x + w.y * w.y + w.z * w.z > PROPS.restSpin * PROPS.restSpin;
      // Far off, nobody is watching: let it sleep where it lies rather than solving it every step --
      // but only once it has come to rest. Rapier wakes a sleeping body on a contact or on an
      // explicit `wakeUp` and on nothing else, and a prop still in the air has neither, so one slept
      // in mid-flight would hang there, a hundred metres out and well inside the draw distance, for
      // the life of the world; the recall rule below cannot catch it either, since at that moment it
      // is still within `fell` of its stand and within `lost` of it. One still prop far off costs the
      // step nothing; one that is moving costs it a few steps more until it lands, which is the price.
      if (!moving && p.pos.distanceToSquared(playerPos) > PROPS.far * PROPS.far) {
        p.body.sleep();
        continue;
      }
      if (moving) p.still = 0;
      else {
        p.still += dt;
        if (p.still >= PROPS.sleep) p.body.sleep();
      }
    }
  }

  /**
   * Shove every prop within `range` of a point: `sign` 1 away from it and -1 toward it, and with an
   * `aim` only the ones roughly along it (the Force's push and pull are a cone, a blast is not).
   */
  shove(from: THREE.Vector3, range: number, sign: number, aim: THREE.Vector3 | null, power: number): number {
    let moved = 0;
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      tmpDir.copy(p.pos).sub(from);
      const d = tmpDir.length();
      if (d > range) continue;
      if (d < 1e-4) tmpDir.set(0, 1, 0);
      else tmpDir.divideScalar(d);
      // The same cone the powers ask a body for: near at hand anything goes, further off it must be ahead.
      if (aim && d > 3 && tmpDir.dot(aim) < 0.35) continue;
      tmpDir.multiplyScalar(sign);
      p.wake();
      p.knock(tmpDir, power * (1 - d / (range * 1.15)));
      moved++;
    }
    return moved;
  }

  /** The prop under a look, for the grip: the nearest one within `range` and inside the cone. */
  ahead(from: THREE.Vector3, dir: THREE.Vector3, range: number, cone: number): LooseProp | null {
    let best: LooseProp | null = null;
    let bestD = range;
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      tmpDir.copy(p.pos).sub(from);
      const d = tmpDir.length();
      if (d > bestD || d < 1e-4) continue;
      if (tmpDir.divideScalar(d).dot(dir) < cone) continue;
      best = p;
      bestD = d;
    }
    return best;
  }

  report(): Record<string, unknown> {
    let awake = 0;
    let held = 0;
    for (const p of this.props) {
      if (!p.body.isSleeping()) awake++;
      if (p.sinceHold !== Number.POSITIVE_INFINITY) held++;
    }
    return { props: this.props.length, awake, asleep: this.props.length - awake, held, recalled: this.recalled };
  }

  /**
   * The numbers that were written onto the bodies, the colliders and the materials when the pool was
   * built, written again from `PROPS`: what `__debug.props({ friction: 1.2 })` does, so a knob the
   * owner moves is felt in the world they are standing in rather than at the next world load. Called
   * from the console only, never from a frame, and it makes nothing: the two colours are written into
   * the materials' own `Color` objects, which is not in three's program key, so nothing recompiles.
   */
  retune(): void {
    for (const p of this.props) {
      p.body.setLinearDamping(PROPS.linearDamping);
      p.body.setAngularDamping(PROPS.angularDamping);
      p.collider.setRestitution(PROPS.restitution);
      p.collider.setFriction(PROPS.friction);
    }
    (this.materials[0] as THREE.MeshStandardMaterial).color.setHex(PROPS.crateColour);
    (this.materials[1] as THREE.MeshStandardMaterial).color.setHex(PROPS.ballColour);
  }

  /** Every prop back on its stand: what `__debug.props({ reset: true })` does. */
  recallAll(): number {
    for (const p of this.props) p.recall();
    return this.props.length;
  }

  dispose(forget: (materials: Iterable<THREE.Material>) => void): void {
    this.group.removeFromParent();
    for (const p of this.props) this.physics.world.removeRigidBody(p.body);
    this.props.length = 0;
    this.byCollider.clear();
    // Both the portal renderer's set and the shadow cascades' map are strong: a material disposed
    // without being forgotten first is a leak that shows as a stutter when the shadow distance moves.
    forget(this.materials);
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.materials.length = 0;
    this.geometries.length = 0;
  }
}

/** The world's props while a world is loaded. One at a time, as the Force's beams and the nebulae are. */
let current: LoosePropPool | null = null;

/** What the world hands over when it builds the pool: what the pool needs, and nothing of the world's shape. */
export interface LoosePropHost {
  readonly scene: THREE.Scene;
  readonly physics: Physics;
  forgetMaterials(materials: Iterable<THREE.Material>): void;
}

/**
 * Stand the world's props round the arrival point. Called from the world's own warm-up, while the
 * loading screen is up and after the terrain round the arrival has been generated, so the ground
 * under each one is the real ground and the compile behind that screen builds their two programs.
 *
 * Nothing is stood in space: there is no ground to stand on there (a space zone's terrain is a
 * plane three kilometres down that is never built), and a crate falling for ever is not a prop.
 */
export function loadLooseProps(host: LoosePropHost, at: THREE.Vector3, groundAt: (x: number, z: number) => number, space: boolean): void {
  dropLooseProps(host);
  if (space) return;
  current = new LoosePropPool(host.physics, host.scene, at, groundAt);
}

/** The props taken out of the world for good: their bodies removed, their materials forgotten, then freed. */
export function dropLooseProps(host: LoosePropHost): void {
  const pool = current;
  if (!pool) return;
  current = null;
  pool.dispose((m) => host.forgetMaterials(m));
}

/** One frame of every prop: the poses, the sleep rule and anything thrown off the world. Called once a frame by the world. */
export function stepLooseProps(dt: number, playerPos: THREE.Vector3): void {
  current?.step(dt, playerPos);
}

/** The prop a collider belongs to, for `World.hittableAt`: undefined for everything else. */
export function loosePropAt(handle: number): Hittable | undefined {
  return current?.byCollider.get(handle);
}

/**
 * The seam the Force's push, pull and repulse and a blast's shove use. `sign` is 1 away from the
 * point and -1 toward it; `aim` narrows it to a cone (the powers), null takes every direction (a
 * blast). Returns how many were moved. Nothing is allocated.
 */
export function shoveLooseProps(from: THREE.Vector3, range: number, sign: number, aim: THREE.Vector3 | null = null, power = PROPS.shove): number {
  return current?.shove(from, range, sign, aim, power) ?? 0;
}

/**
 * The seam the grip uses: the nearest prop within `range` and inside `cone` of `dir`, as a `Living`
 * with `holdAt` and `release` on it, or null. A prop is never in `World.targets()`, so a power that
 * wants one has to ask here -- which is the point: the brains, the turrets and the auto-aim read
 * `targets()` and must never find a crate in it.
 */
export function loosePropAhead(from: THREE.Vector3, dir: THREE.Vector3, range: number, cone: number): Living | null {
  return current?.ahead(from, dir, range, cone) ?? null;
}

/** The props' group, for the motion blur's list of everything that moves on its own; null with no pool. */
export function loosePropsGroup(): THREE.Object3D | null {
  return current?.group ?? null;
}

/**
 * `__debug.props()` says how many are standing, how many are awake and how many have been put back
 * on their stands; `__debug.props({ sleep: 4 })` (and every other name in `PROPS`) moves a number
 * live, the eight that are spent standing the pool up being answered with `atNextWorld` and the six
 * that live on the bodies, the colliders and the materials being written onto them where they stand;
 * and `__debug.props({ reset: true })` stands the lot back where they began, which is how a world
 * that has been fought through is tidied without reloading it. A name nobody has, a value that is
 * not a finite number and a nought where the placement maths needs more are each said out loud and
 * changed nothing, rather than being dropped in a silence that reads like success.
 *
 * It is written here and named once in the game's own debug block (`props: propsDebug` in
 * `src/main.ts`), rather than installed onto `window` from this file: the game makes its `__debug`
 * in one go at startup, so a hook installed here would be overwritten by it and would need putting
 * back on every world load, and a number with two homes in this project has drifted twice.
 */
export const propsDebug = (opts?: Partial<Record<keyof PropsTune, number>> & { reset?: boolean }): Record<string, unknown> | string => {
  const later: string[] = [];
  const tune = PROPS as unknown as Record<string, unknown>;
  let live = false;
  if (opts) {
    for (const [key, value] of Object.entries(opts)) {
      if (key === 'reset') continue;
      // A name nobody has and a value that is not a number are both said out loud. A hook that drops
      // them in silence reads exactly like one that worked, and this pool has no test and no other
      // instrument: the console is the whole of how it is checked.
      if (!(key in PROPS)) {
        console.warn(`loose props: no number called ${key}; they are ${Object.keys(PROPS).join(', ')}`);
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        console.warn(`loose props: ${key} wants a finite number, not ${String(value)}`);
        continue;
      }
      if (value < 0) {
        console.warn(`loose props: ${key} wants a number of nought or more, not ${value}`);
        continue;
      }
      if (value === 0 && POSITIVE_KEYS.includes(key)) {
        console.warn(`loose props: ${key} wants a number above zero; at nought the pool has no places to stand in`);
        continue;
      }
      tune[key] = value;
      if (BUILD_ONLY_KEYS.includes(key)) later.push(key);
      if (RETUNE_KEYS.includes(key)) live = true;
    }
  }
  const pool = current;
  if (pool && live) pool.retune();
  if (!pool) {
    const answer = 'no loose props here: they are stood with the world, and none is stood in space';
    return later.length ? `${answer} (${later.join(', ')} will be spent when a world stands some)` : answer;
  }
  const report = pool.report();
  if (opts?.reset) report.reset = `${pool.recallAll()} put back where they were stood`;
  report.tune = { ...PROPS };
  if (later.length) report.atNextWorld = later.join(', ');
  return report;
};
