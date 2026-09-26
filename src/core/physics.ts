import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Collision group bits. Everything is in `all` by default; terrain and building shells get
 * their own bits so a character standing inside a building can ignore both (the game only
 * collides with a building's interior cells while you are in them, and never with the ground).
 *
 * `peer` is another player's body, which is in a group of its own and collides with nothing: its
 * colliders are made with membership `peer` and a filter of zero, so every query that passes an
 * interaction group misses them (the character controller, a ship's set-down probe, the weather's
 * roof grid, the camera's block ray) while a query that passes none is not group-tested at all and
 * finds them (a bolt's ray, a blade's sweep, an aiming ray). See src/net/remoteBodies.ts.
 */
export const Group = { terrain: 0x0001, exterior: 0x0002, interior: 0x0004, peer: 0x0008, all: 0xffff } as const;

/** Rapier interaction groups: membership in the high half, filter in the low half. */
export const groups = (membership: number, filter: number): number => ((membership << 16) | filter) >>> 0;

/**
 * A mesh's triangles made safe for a trimesh collider: indices past the vertices, triangles with
 * a repeated corner or no area, and non-finite vertices are dropped (a bad triangle in a
 * trimesh the character controller meets is a panic inside the engine, after which every call
 * into it fails as "recursive use"), and the engine merges duplicates and doubles on top.
 */
export const TRIMESH_FLAGS = RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES | RAPIER.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES | RAPIER.TriMeshFlags.DELETE_DUPLICATE_TRIANGLES;

export function cleanTrimesh(vertices: Float32Array, indices: Uint32Array): { vertices: Float32Array; indices: Uint32Array; dropped: number } | null {
  const count = Math.floor(vertices.length / 3);
  const out: number[] = [];
  let dropped = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    if (a >= count || b >= count || c >= count || a === b || b === c || a === c) {
      dropped++;
      continue;
    }
    const ax = vertices[a * 3];
    const ay = vertices[a * 3 + 1];
    const az = vertices[a * 3 + 2];
    const ux = vertices[b * 3] - ax;
    const uy = vertices[b * 3 + 1] - ay;
    const uz = vertices[b * 3 + 2] - az;
    const vx = vertices[c * 3] - ax;
    const vy = vertices[c * 3 + 1] - ay;
    const vz = vertices[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area2 = nx * nx + ny * ny + nz * nz;
    if (!Number.isFinite(area2) || area2 < 1e-12) {
      dropped++;
      continue;
    }
    out.push(a, b, c);
  }
  if (out.length < 3) return null;
  return { vertices, indices: Uint32Array.from(out), dropped };
}

export { RAPIER };

export const FIXED_DT = 1 / 60;

/**
 * The one rule about the ragdolls that the contact filter enforces and that can be changed while
 * the game runs. It is kept here, where the filter reads it, so the engine's own module knows
 * nothing of the combat code; the knob the owner turns is `RAGDOLL.selfCollide` in
 * src/combat/ragdoll.ts (`__debug.ragdoll({ selfCollide: true })`), which is an accessor over this.
 *
 * Off is what the game has always done: a corpse's pieces pass through one another. On, the pieces
 * of one body meet -- but never the pieces of two different bodies, and never two pieces a joint
 * holds together or that already lay inside each other in the pose the body died in, which is what
 * the pairs each piece is told to ignore are for.
 */
export const RAGDOLL_RULES = { selfCollide: false };

/** One piece of a ragdoll as the contact filter knows it. */
interface RagdollPiece {
  /** Which corpse it belongs to: two pieces of two different corpses never meet, switch or no. */
  group: number;
  /** The pieces it must never meet whatever the switch says: what a joint holds it to, and what it already lies inside. */
  ignore: Set<number>;
}

/** Thin wrapper around a Rapier world with a fixed-step accumulator. */
export class Physics {
  readonly world: RAPIER.World;
  private acc = 0;
  /** The ragdolls' colliders: they touch only what stands still, and one another only by the rule in `hooks`. */
  private readonly ragdolls = new Map<number, RagdollPiece>();
  /** Group numbers handed out one to a corpse, so no two corpses ever share one. */
  private ragdollGroups = 0;
  /**
   * The contact filter the ragdolls ask for: a ragdoll piece meets the ground, a building, a
   * room (colliders with no body, or a fixed one) and nothing that moves on its own: no player,
   * creature, vehicle or other corpse, so a corpse never trips the living or stacks on another.
   * Its own body's other pieces it meets only while `RAGDOLL_RULES.selfCollide` is on, and then
   * only the ones it was not told to ignore.
   */
  /** How often the hook ran, how many pairs it dropped, and how many of one body's own pieces it let meet, for the console. */
  readonly hookStats = { calls: 0, dropped: 0, self: 0 };
  /** Nothing reads it, but the engine runs the contact hooks only on a step given a queue. */
  private readonly events = new RAPIER.EventQueue(false);
  private readonly hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (c1, c2, b1, b2) => {
      this.hookStats.calls++;
      const p1 = this.ragdolls.get(c1);
      const p2 = this.ragdolls.get(c2);
      if (!p1 && !p2) return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      if (p1 && p2) {
        // Two pieces of a corpse. With the switch off they pass through each other as they always
        // have; with it on, the pieces of one body meet, and a pair either of them was told to
        // ignore (a joint holds them, or they already lay inside each other) never does.
        if (RAGDOLL_RULES.selfCollide && p1.group === p2.group && !p1.ignore.has(c2) && !p2.ignore.has(c1)) {
          this.hookStats.self++;
          return RAPIER.SolverFlags.COMPUTE_IMPULSE;
        }
        this.hookStats.dropped++;
        return null;
      }
      // One piece against something else. It meets whatever stands still -- a collider with no body
      // of its own (the ground, a building, a room) or a fixed one -- and nothing that moves on its
      // own. Which of the two the other body is was worked out before the step began: nothing here
      // may call into the engine, because the world is mid-step and a call back into it is a
      // recursive borrow that throws out of the step's own callback (see `movers`).
      const other = p1 ? b2 : b1;
      if (other === undefined || other === null || !this.movers.has(other)) return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      this.hookStats.dropped++;
      return null;
    },
    filterIntersectionPair: () => true,
  };

  /**
   * The bodies that move on their own, by handle. The contact filter has one question it cannot ask
   * the engine -- whether the body a corpse's piece has met is fixed -- because a call into the
   * world from inside `world.step` throws "recursive use of an object detected", which unwinds out
   * of the filter itself. So the answer is worked out here, before the step, and only while
   * something is actually dead: with no corpse in the world the filter never reaches this branch
   * and the pass is never made.
   */
  private readonly movers = new Set<number>();

  /** Kept, not made per call: this runs once a frame for every body in the streamed world while anything is dead. */
  private readonly noteMover = (b: RAPIER.RigidBody): void => {
    if (!b.isFixed()) this.movers.add(b.handle);
  };

  private refreshMovers(): void {
    this.movers.clear();
    this.world.forEachRigidBody(this.noteMover);
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.world.timestep = FIXED_DT;
    // More solver passes than the default four: a ragdoll is a chain of twenty jointed pieces
    // against the ground, and with four they shiver where they lie.
    this.world.integrationParameters.numSolverIterations = 8;
  }

  /** A group number of its own for one corpse: every piece of it is marked with this and no other body ever takes it. */
  nextRagdollGroup(): number {
    this.ragdollGroups++;
    return this.ragdollGroups;
  }

  /** A piece of a corpse, with the body it belongs to and the handles of the pieces it must never meet. */
  markRagdoll(c: RAPIER.Collider, group: number, ignore: number[] = []): void {
    this.ragdolls.set(c.handle, { group, ignore: new Set(ignore) });
  }

  unmarkRagdoll(c: RAPIER.Collider): void {
    this.ragdolls.delete(c.handle);
  }

  /** Whether a collider is a ragdoll's, for the character controller and the sweeps to pass over. */
  isRagdoll(handle: number): boolean {
    return this.ragdolls.has(handle);
  }

  /** What a piece was told to ignore, for the console and the tests; nothing in play reads it. */
  ragdollPiece(handle: number): { group: number; ignore: number[] } | null {
    const piece = this.ragdolls.get(handle);
    return piece ? { group: piece.group, ignore: [...piece.ignore] } : null;
  }

  /**
   * The other players' bodies (src/net/remoteBodies.ts). Their collision groups already keep them
   * out of everything that passes one, so this is what the few calls that pass none use to pass over
   * them all the same: the character controller (belt and braces, and it stays right if a filter is
   * ever widened) and `groundDistance`, which casts with no filter at all and would otherwise make a
   * peer standing under a speeder into its road.
   */
  private readonly peers = new Set<number>();

  markPeer(c: RAPIER.Collider): void {
    this.peers.add(c.handle);
  }

  unmarkPeer(c: RAPIER.Collider): void {
    this.peers.delete(c.handle);
  }

  /** Whether a collider is another player's body. */
  isPeer(handle: number): boolean {
    return this.peers.has(handle);
  }

  /**
   * What the one ray that filters nothing at all passes over: another player's body, and a corpse.
   * Neither is a surface to stand on -- a peer standing under a speeder would be its road, and so
   * would a dead body lying under one -- and the two other rays that ask for a floor among things
   * that move already pass over corpses by hand (a ship's set-down probe, the boots' patch).
   * Kept, not made per call: a vehicle casts one of these per wheel per step.
   */
  private readonly notPeerOrCorpse = (c: RAPIER.Collider): boolean => !this.peers.has(c.handle) && !this.ragdolls.has(c.handle);

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  /** Another world, for a room that has physics of its own (a ship's interior), after the first has initialised the engine. */
  static local(gravity = 20): Physics {
    const p = new Physics();
    p.setGravity(gravity);
    return p;
  }

  setGravity(g: number): void {
    this.world.gravity = { x: 0, y: -g, z: 0 };
  }

  /**
   * Steps taken through `step` (not the raw `world.step` calls elsewhere): a scene query is only
   * trusted after the world has stepped since its colliders were added, and this says when it has.
   */
  steps = 0;

  step(dt: number): void {
    this.acc += dt;
    // Which bodies move on their own, for the contact filter, which cannot ask once the step has
    // begun. Only while there is a corpse in the world: nothing else reaches that branch.
    if (this.ragdolls.size) this.refreshMovers();
    let n = 0;
    while (this.acc >= FIXED_DT && n < 4) {
      // The hooks run only on the step that takes an event queue; without one they are silently left out.
      this.world.step(this.events, this.hooks);
      this.steps++;
      this.acc -= FIXED_DT;
      n++;
    }
    if (n === 4) this.acc = 0;
  }

  /**
   * One step outside the accumulator, for the few places that must advance the world at once so a
   * scene query can see what was just built or moved (a ship launched, a lift taken, a vehicle
   * righted, a world warmed up). It exists because `world.step()` with no event queue runs no hooks
   * at all: on such a step a corpse lying anywhere near meets everything, its own jointed and
   * overlapping pairs included, and each of those gets one unfiltered shove out of the engine's
   * penetration recovery. So every deliberate step goes through here or through `step`, and the
   * raw call is not used anywhere a body can be dead.
   */
  stepOnce(): void {
    if (this.ragdolls.size) this.refreshMovers();
    this.world.step(this.events, this.hooks);
    this.steps++;
  }

  /**
   * Static heightfield for one terrain chunk. `heights` is column-major with
   * (subdivs + 1)² entries: index = xi * (subdivs + 1) + zi.
   */
  createHeightfield(originX: number, originZ: number, size: number, subdivs: number, heights: Float32Array): RAPIER.Collider {
    const c = this.createHeightfieldRaw(originX, originZ, size, subdivs, heights);
    c.setCollisionGroups(groups(Group.terrain, Group.all));
    return c;
  }

  private createHeightfieldRaw(originX: number, originZ: number, size: number, subdivs: number, heights: Float32Array): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.heightfield(subdivs, subdivs, heights, { x: size, y: 1, z: size })
      .setTranslation(originX + size / 2, 0, originZ + size / 2)
      .setFriction(0.9);
    return this.world.createCollider(desc);
  }

  /**
   * Distance from `from` toward `to` at which static geometry blocks a camera, or null when
   * clear. Moving bodies (creatures, vehicles, the player) never block it; inside a building
   * the ground and the building's shell are ignored, as they are for the player.
   */
  /**
   * Heights of every upward-facing interior surface on the vertical line through a point,
   * highest first, between `top` and `bottom` (the floors an elevator can reach).
   */
  floorsAt(x: number, z: number, top: number, bottom: number): number[] {
    const floors: number[] = [];
    const filter = groups(Group.all, Group.interior);
    let y = top;
    for (let i = 0; i < 24 && y > bottom; i++) {
      const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
      const hit = this.world.castRayAndGetNormal(ray, y - bottom, true, undefined, filter);
      if (!hit) break;
      const hy = y - hit.timeOfImpact;
      if (hit.normal.y > 0.5) floors.push(hy);
      y = hy - 0.05;
    }
    return floors;
  }

  cameraBlock(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, excludeBody: RAPIER.RigidBody | null, inside: boolean): number | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return null;
    const ray = new RAPIER.Ray(from, { x: dx / len, y: dy / len, z: dz / len });
    const filter = groups(Group.all, inside ? Group.all & ~(Group.terrain | Group.exterior) : Group.all);
    const hit = this.world.castRay(ray, len, true, undefined, filter, undefined, excludeBody ?? undefined, (c) => {
      const body = c.parent();
      return !body || body.isFixed();
    });
    return hit ? hit.timeOfImpact : null;
  }

  /**
   * The first fixed surface a segment from `from` to `to` meets (the world, a building's shell or rooms,
   * never a moving body): where, and its normal. Null when the segment is clear.
   */
  surfaceHit(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, excludeBody: RAPIER.RigidBody | null, inside: boolean, skip?: (colliderHandle: number) => boolean): { point: [number, number, number]; normal: [number, number, number] } | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return null;
    const ray = new RAPIER.Ray(from, { x: dx / len, y: dy / len, z: dz / len });
    const filter = groups(Group.all, inside ? Group.all & ~(Group.terrain | Group.exterior) : Group.all);
    // Any surface but the ones the caller skips (creatures): walls, the ground, props, hulls.
    const hit = this.world.castRayAndGetNormal(ray, len, true, undefined, filter, undefined, excludeBody ?? undefined, (c) => !skip?.(c.handle));
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return { point: [from.x + ray.dir.x * t, from.y + ray.dir.y * t, from.z + ray.dir.z * t], normal: [hit.normal.x, hit.normal.y, hit.normal.z] };
  }

  /** The rays the room's air casts every frame, kept rather than made per call, and the one predicate both use. */
  private readonly outdoorRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  private readonly segmentRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  private readonly fixedOnly = (c: RAPIER.Collider): boolean => {
    const b = c.parent();
    return !b || b.isFixed();
  };

  /**
   * Whether something fixed outdoors (the ground, a building's shell, a placed object) lies along a
   * ray, for whether a doorway is in the sun: rooms (Group.interior) are left out, since a room can
   * reach outside its shell. Hits closer than `minToi` are ignored, so a ray starting on a wall's
   * face does not count the wall. Nothing that moves ever shades. The engine still wraps the ray's
   * vectors on every cast; this makes no objects of its own.
   */
  outdoorBlocked(from: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, len: number, minToi = 0.05): boolean {
    const r = this.outdoorRay;
    r.origin.x = from.x + dir.x * minToi;
    r.origin.y = from.y + dir.y * minToi;
    r.origin.z = from.z + dir.z * minToi;
    r.dir.x = dir.x;
    r.dir.y = dir.y;
    r.dir.z = dir.z;
    return this.world.castRay(r, len, true, undefined, groups(Group.all, Group.terrain | Group.exterior), undefined, undefined, this.fixedOnly) !== null;
  }

  /**
   * Whether a fixed collider lies on the segment between two points (never a moving body), for
   * whether a lamp is in sight. With `inside`, the ground and building shells are ignored, as
   * cameraBlock does for a camera inside a building. Makes no objects of its own.
   */
  segmentBlocked(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, inside: boolean): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return false;
    const r = this.segmentRay;
    r.origin.x = from.x;
    r.origin.y = from.y;
    r.origin.z = from.z;
    r.dir.x = dx / len;
    r.dir.y = dy / len;
    r.dir.z = dz / len;
    const filter = inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : groups(Group.all, Group.all);
    return this.world.castRay(r, len, true, undefined, filter, undefined, undefined, this.fixedOnly) !== null;
  }

  /** The cover search's own ray, kept: a search casts a dozen and a half of these and must make nothing. */
  private readonly blockRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });

  /**
   * How far along the segment from a to b the first thing that **stands still** is, or `Infinity`
   * when the segment is clear.
   *
   * It is `cameraBlock`'s own question -- the same fixed-or-bodiless predicate, the same indoor
   * filter -- asked with primitives and answered with a number. Two differences, and both are the
   * reason it exists rather than being a call into that one. `cameraBlock` makes a `RAPIER.Ray` on
   * every call, which is one object a frame for a camera and sixteen per body per search for the
   * cover code; and it takes two point objects, which a caller with nothing but numbers would have
   * to build. Nothing that moves on its own may answer either way, or a body takes cover behind the
   * very creature it is fighting, behind the player, or behind a speeder that is about to drive off.
   */
  blockDistance(ax: number, ay: number, az: number, bx: number, by: number, bz: number, inside = false): number {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 1e-4)) return Infinity;
    const r = this.blockRay;
    r.origin.x = ax;
    r.origin.y = ay;
    r.origin.z = az;
    r.dir.x = dx / len;
    r.dir.y = dy / len;
    r.dir.z = dz / len;
    const filter = inside ? groups(Group.all, Group.all & ~(Group.terrain | Group.exterior)) : groups(Group.all, Group.all);
    const hit = this.world.castRay(r, len, true, undefined, filter, undefined, undefined, this.fixedOnly);
    return hit ? hit.timeOfImpact : Infinity;
  }

  /** A static cylinder, or null for a degenerate one (the physics engine aborts on non-positive or NaN sizes). */
  createStaticCylinder(x: number, y: number, z: number, radius: number, halfHeight: number): RAPIER.Collider | null {
    if (![x, y, z, radius, halfHeight].every(Number.isFinite) || radius <= 0.01 || halfHeight <= 0.01) return null;
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(x, y, z).setFriction(0.6);
    return this.world.createCollider(desc);
  }

  removeCollider(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }

  /**
   * Distance straight down to the nearest surface, or null if nothing within maxDist.
   * `filterGroups` narrows what counts (a body inside a building looks for the floor, not the
   * ground under the building): pass `groups(Group.all, Group.all & ~(Group.terrain | Group.exterior))`.
   */
  /**
   * Most callers pass no groups at all, and with none the engine does no group test, so another
   * player's body would be found here however its own groups are set, and so would a corpse, whose
   * colliders are kept out of the living by a contact filter that a ray never reaches. Nobody
   * stands on either: both are passed over (`notPeerOrCorpse`; a node test pins this call site by
   * its exact text, so the name and the test move together).
   */
  groundDistance(x: number, y: number, z: number, maxDist: number, exclude?: RAPIER.RigidBody, filterGroups?: number): number | null {
    const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true, undefined, filterGroups, undefined, exclude, this.notPeerOrCorpse);
    return hit ? hit.timeOfImpact : null;
  }

  private readonly downRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  /**
   * Whether a point is inside something that stands still: a wall, a floor, a rock, a crate.
   *
   * Rapier answers which colliders contain a point, and the first one that is fixed or bodiless is
   * the answer. What moves is stepped over on purpose -- a prop may be put down where somebody is
   * standing, because they will walk away and a wall will not -- and so are the peers and the
   * corpses, for the reason every other query here skips them.
   *
   * The point is a `Vector3` made once and written into: this is asked nine times a frame while a
   * prop is in hand, and nine objects a frame is nine thousand a minute.
   */
  pointInSolid(x: number, y: number, z: number): boolean {
    const p = this.solidPoint;
    p.x = x;
    p.y = y;
    p.z = z;
    let hit = false;
    this.world.intersectionsWithPoint(p, (c) => {
      if (this.peers.has(c.handle) || this.ragdolls.has(c.handle)) return true;
      const body = c.parent();
      if (body && !body.isFixed()) return true;
      hit = true;
      // False stops the walk: the first solid thing is the whole answer.
      return false;
    });
    return hit;
  }

  private readonly solidPoint = { x: 0, y: 0, z: 0 };

  /**
   * Height of the first surface straight down from (x, fromY, z) within maxDist, among colliders the
   * groups and `include` accept, or null. Reuses one ray (the weather's roof grid casts dozens a frame).
   */
  topSurface(x: number, z: number, fromY: number, maxDist: number, filterGroups: number, include: (c: RAPIER.Collider) => boolean): number | null {
    const o = this.downRay.origin;
    o.x = x;
    o.y = fromY;
    o.z = z;
    const hit = this.world.castRay(this.downRay, maxDist, true, undefined, filterGroups, undefined, undefined, include);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  /** The one answer `topHit` hands back, refilled each call: the caller reads it and does not keep it. */
  private readonly downHit = { y: 0, handle: -1 };

  /**
   * The same ray as `topSurface`, but it also says which collider it found, so the caller can ask
   * what that thing is made of (a foot landing on a metal catwalk rather than the sand under it).
   * Null when nothing is within `maxDist`.
   *
   * The result object is reused: read `y` and `handle` at once. Cast with a fixed-or-bodiless
   * predicate for a floor -- from inside a capsule an unfiltered ray finds that capsule and calls
   * its middle the ground.
   */
  topHit(x: number, z: number, fromY: number, maxDist: number, filterGroups: number | undefined, include: (c: RAPIER.Collider) => boolean): { y: number; handle: number } | null {
    const o = this.downRay.origin;
    o.x = x;
    o.y = fromY;
    o.z = z;
    const hit = this.world.castRay(this.downRay, maxDist, true, undefined, filterGroups, undefined, undefined, include);
    if (!hit) return null;
    this.downHit.y = fromY - hit.timeOfImpact;
    this.downHit.handle = hit.collider.handle;
    return this.downHit;
  }
}
