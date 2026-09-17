import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Collision group bits. Everything is in `all` by default; terrain and building shells get
 * their own bits so a character standing inside a building can ignore both (the game only
 * collides with a building's interior cells while you are in them, and never with the ground).
 */
export const Group = { terrain: 0x0001, exterior: 0x0002, interior: 0x0004, all: 0xffff } as const;

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

/** Thin wrapper around a Rapier world with a fixed-step accumulator. */
export class Physics {
  readonly world: RAPIER.World;
  private acc = 0;
  /** The ragdolls' colliders: they touch only what stands still, and never one another (see `hooks`). */
  private readonly ragdolls = new Set<number>();
  /**
   * The contact filter the ragdolls ask for: a ragdoll piece meets the ground, a building, a
   * room (colliders with no body, or a fixed one) and nothing that moves on its own: no player,
   * creature, vehicle or other ragdoll, so a corpse never trips the living or stacks on another.
   */
  private readonly hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (c1, c2, b1, b2) => {
      const r1 = this.ragdolls.has(c1);
      const r2 = this.ragdolls.has(c2);
      if (!r1 && !r2) return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      if (r1 && r2) return null;
      const other = r1 ? b2 : b1;
      const body = other === undefined || other === null ? null : this.world.getRigidBody(other);
      return !body || body.isFixed() ? RAPIER.SolverFlags.COMPUTE_IMPULSE : null;
    },
    filterIntersectionPair: () => true,
  };

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.world.timestep = FIXED_DT;
  }

  markRagdoll(c: RAPIER.Collider): void {
    this.ragdolls.add(c.handle);
  }

  unmarkRagdoll(c: RAPIER.Collider): void {
    this.ragdolls.delete(c.handle);
  }

  /** Whether a collider is a ragdoll's, for the character controller and the sweeps to pass over. */
  isRagdoll(handle: number): boolean {
    return this.ragdolls.has(handle);
  }

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

  step(dt: number): void {
    this.acc += dt;
    let n = 0;
    while (this.acc >= FIXED_DT && n < 4) {
      this.world.step(undefined, this.hooks);
      this.acc -= FIXED_DT;
      n++;
    }
    if (n === 4) this.acc = 0;
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

  /** A static cylinder, or null for a degenerate one (the physics engine aborts on non-positive or NaN sizes). */
  createStaticCylinder(x: number, y: number, z: number, radius: number, halfHeight: number): RAPIER.Collider | null {
    if (![x, y, z, radius, halfHeight].every(Number.isFinite) || radius <= 0.01 || halfHeight <= 0.01) return null;
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(x, y, z).setFriction(0.6);
    return this.world.createCollider(desc);
  }

  removeCollider(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }

  /** Distance straight down to the nearest surface, or null if nothing within maxDist. */
  groundDistance(x: number, y: number, z: number, maxDist: number, exclude?: RAPIER.RigidBody): number | null {
    const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true, undefined, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : null;
  }
}
