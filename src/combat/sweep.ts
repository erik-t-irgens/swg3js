// A capsule swept through the world: whatever it touches that can be hurt is, once per `already`.
// The blades, the kicks, the thrown saber and the fists all hit this way.
//
// A blade also keeps the path it covered since the last frame (`BladePath`) and is cast in steps
// along it, because the two ends of a frame are not the swing: at a run, on a low frame, the tip
// crosses more than a metre and a thin body standing in the middle of that metre was never asked
// about. The rules, every number and the loop itself are `saberHit.ts`; the shape is never made
// fatter to cover the gap, since this is an overlap query with no line of sight and a fat capsule
// reaches through a thin wall and still tunnels at the next speed up.
//
// Who is swinging is a `Striker`, which is everything the cast needs and nothing else: the player's
// kit fills one out of its context, a fighter and a bladed creature fill their own, so everybody's
// blade lands by one piece of machinery rather than by a rule apiece.
import * as THREE from 'three';
import { RAPIER, type Physics } from '../core/physics.ts';
import { PathMemory, type HitLedger, type SweepCast, type Vec3Like } from './saberHit.ts';
import type { Effects } from './effects';
import type { BoltFrame } from './bolts';
import type { Hittable, KitContext, Living } from './kit';

const mid = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const quat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
/**
 * The one capsule every sweep is cast with, made on the first cast (rapier is loaded long before
 * any of this runs, but not before this module is parsed) and written to rather than made again:
 * the engine builds its own shape from it at each call and keeps nothing between them.
 */
let shape: RAPIER.Capsule | null = null;

/** The blade's own reach: the capsule a lit blade cuts with, and never a fatter one to cover a gap. */
export const BLADE_RADIUS = 0.16;

/**
 * Who is swinging, and with what. One struct, written to each frame rather than made, because a
 * swing is a thing that happens inside a step: a fresh object a frame is exactly what the rule
 * against allocating in a step is about.
 */
export interface Striker {
  /** The world the query runs in: the planet's, or a ship's rooms' own while the fight is aboard. */
  physics: Physics;
  /**
   * What a collider belongs to, if anything that can be hurt does. It must answer for **the world
   * the query runs in** and no other: a collider handle is a small integer a physics world hands
   * out from zero, so one world's map asked about another world's handle answers with whatever
   * happens to be living at that number. A room's own physics has no such map today, so what is
   * handed in there is `NOTHING_AT`.
   */
  hittableAt: (handle: number) => Hittable | undefined;
  /** Where the burst and the borrowed flash are placed; null when nobody is watching. */
  effects: Effects | null;
  /** Who struck, so what is hurt can turn on them. */
  source: Living | null;
  /** Where the blow came from, in the same frame as the capsule: the shove, and the way a body turns. */
  from: THREE.Vector3;
  /** The swinger's own body, never hurt by its own blade. */
  exclude: RAPIER.RigidBody | undefined;
  /** One thing the sweep must never hurt: aboard, the hull the rooms are inside. */
  spare: Hittable | null;
  radius: number;
  damage: number;
  push: number;
  color: number;
  /** The simulated second this frame is at (`World.simTime`), which is the path's own clock. */
  now: number;
  /**
   * Aboard a ship's rooms: the hull's live world matrix. The capsule, `from` and the path are all
   * in the hull's frame and the query runs in the room's own physics, exactly as a bolt fired
   * aboard does, so the ship's own motion is no part of the swing -- and the effects are carried
   * out to the world with this. Absent out in the world.
   */
  matrix?: THREE.Matrix4 | null;
}

/**
 * The answer for a world whose colliders belong to nobody: a ship's rooms, where the walls and the
 * deck are the hull's and nothing alive stands today. A bolt fired aboard says the same thing by
 * never asking at all ("nothing else is in there"); a sweep has to say it out loud, because the
 * handle it would otherwise carry to the planet's maps names something alive out in the zone.
 */
export const NOTHING_AT = (): Hittable | undefined => undefined;

/** The player's own striker: one for the module, since nothing nests a sweep inside a sweep. */
const mine: Striker = {
  physics: null as unknown as Physics,
  hittableAt: NOTHING_AT,
  effects: null,
  source: null,
  from: new THREE.Vector3(),
  exclude: undefined,
  spare: null,
  radius: BLADE_RADIUS,
  damage: 0,
  push: 5,
  color: 0x9fd4ff,
  now: 0,
  matrix: null,
};
/** Whose `hittableAt` the kept striker is asking: one closure for the module rather than a bound method a frame. */
let asking: { hittableAt(handle: number): Hittable | undefined } | null = null;
const askWorld = (handle: number): Hittable | undefined => asking?.hittableAt(handle);

/**
 * The player as the sweep sees them, in whichever frame the blow is being measured in: the kit's
 * own context is where all of it comes from, so nothing about the player is written down twice.
 *
 * With a `frame` the query runs in that room's physics, so the world's collider map is the wrong
 * book to look a handle up in and `NOTHING_AT` is handed over instead. Whatever one day puts a body
 * a blade can cut into a room's own physics is what gives that case a real lookup; until then a
 * blade swung aboard cuts the ship's walls, which is to say nothing.
 */
export function playerStrike(ctx: KitContext, frame: BoltFrame | null, radius: number, damage: number, push: number, color: number, now: number): Striker {
  const { player, world, physics, effects } = ctx;
  asking = world;
  mine.physics = frame ? frame.physics : physics;
  mine.hittableAt = frame ? NOTHING_AT : askWorld;
  mine.effects = effects;
  mine.source = world.playerTarget;
  mine.from = player.pos;
  mine.exclude = player.body;
  mine.spare = (player.aboard?.vehicle ?? null) as Hittable | null;
  mine.radius = radius;
  mine.damage = damage;
  mine.push = push;
  mine.color = color;
  mine.now = now;
  mine.matrix = frame ? frame.matrix : null;
  return mine;
}

/**
 * The one cast's state, at module scope so that the callback rapier is handed is a kept closure
 * rather than one made per cast: a blade is cast up to `maxSteps` times a frame, twice over for the
 * staff and the dual style, and nothing nests a sweep inside a sweep.
 */
let castWho: Striker | null = null;
let castLedger: HitLedger | null = null;
let castHits = 0;

const onTouch = (collider: RAPIER.Collider): boolean => {
  const who = castWho;
  const already = castLedger;
  if (!who || !already) return true;
  const c = who.hittableAt(collider.handle);
  // Aboard, the hull around the rooms is not a target: a fight inside must not cut the ship down.
  if (c && !already.has(c) && c !== who.spare) {
    already.add(c);
    c.damage(who.damage, who.from, who.push, who.source);
    const fx = who.effects;
    if (fx) {
      tmp2.copy(c.pos).y += c.halfHeight;
      // The effects are the world's, wherever the blow itself was measured.
      if (who.matrix) tmp2.applyMatrix4(who.matrix);
      fx.burst(tmp2, who.color, 1.2, 0.2);
      fx.flash(tmp2, who.color, 10, 8, 0.15);
    }
    castHits++;
  }
  return true;
};

/**
 * One cast: hurt every creature the capsule between two points touches, each once per `already`.
 * Returns how many were hit this call.
 */
export function strikeSweep(who: Striker, from: Vec3Like, to: Vec3Like, already: HitLedger): number {
  mid.set((from.x + to.x) * 0.5, (from.y + to.y) * 0.5, (from.z + to.z) * 0.5);
  tmp.set(to.x - from.x, to.y - from.y, to.z - from.z);
  const len = Math.max(0.01, tmp.length());
  quat.setFromUnitVectors(UP, tmp.normalize());
  if (!shape) shape = new RAPIER.Capsule(len / 2, who.radius);
  else {
    shape.halfHeight = len / 2;
    shape.radius = who.radius;
  }
  castWho = who;
  castLedger = already;
  castHits = 0;
  try {
    who.physics.world.intersectionsWithShape(mid, quat, shape, onTouch, undefined, undefined, undefined, who.exclude);
  } finally {
    castWho = null;
    castLedger = null;
  }
  return castHits;
}

/** Hurt every creature a capsule between two points touches, each once per `already`; returns how many were hit this call. */
export function sweepCapsule(ctx: KitContext, from: THREE.Vector3, to: THREE.Vector3, radius: number, damage: number, already: HitLedger, push = 5, color = 0x9fd4ff): number {
  return strikeSweep(playerStrike(ctx, null, radius, damage * ctx.player.damageBoost, push, color, 0), from, to, already);
}

/**
 * Where one blade was when it was last swept, and the cast that steps from there to where it is
 * now. One per blade, and it belongs to whoever holds that blade -- the kit for the player's two,
 * the fighter for its own -- never to this module: a path at module scope would be every blade's
 * path at once, which is the mistake the fighters' blade ends were already made to stop making.
 *
 * The loop and every rule in it are `PathMemory` in `saberHit.ts`, which a node test drives with a
 * counter in place of the cast below; this is the rapier half of it and nothing more.
 */
export class BladePath {
  private readonly mem = new PathMemory();

  /** Forget it: the blade went out, was thrown, the body was put somewhere, or a new world began. */
  reset(): void {
    this.mem.reset();
  }

  /** Write this frame's ends down without casting: a blade that is lit but idle still gives the next swing somewhere to step from. */
  mark(a: Vec3Like, b: Vec3Like, now: number): void {
    this.mem.mark(a, b, now);
  }

  /**
   * Cast the blade along everything it has covered since last frame and hurt what any of it
   * touches, each body once per `already` however many of the sub-steps caught it -- which is what
   * keeps one swing to one bite out of one body.
   */
  sweep(who: Striker, a: Vec3Like, b: Vec3Like, already: HitLedger): number {
    pathWho = who;
    try {
      return this.mem.step(who.now, a, b, already, castStep);
    } finally {
      pathWho = null;
    }
  }
}

/** The striker the path's sub-steps are being cast for, so the cast below is one kept closure. */
let pathWho: Striker | null = null;
const castStep: SweepCast = (a, b, already) => (pathWho ? strikeSweep(pathWho, a, b, already) : 0);
