import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Collision group bits. Everything is in `all` by default; terrain and building shells get
 * their own bits so a character standing inside a building can ignore both (the game only
 * collides with a building's interior cells while you are in them, and never with the ground).
 */
export const Group = { terrain: 0x0001, exterior: 0x0002, interior: 0x0004, all: 0xffff } as const;

/** Rapier interaction groups: membership in the high half, filter in the low half. */
export const groups = (membership: number, filter: number): number => ((membership << 16) | filter) >>> 0;

export { RAPIER };

export const FIXED_DT = 1 / 60;

/** Thin wrapper around a Rapier world with a fixed-step accumulator. */
export class Physics {
  readonly world: RAPIER.World;
  private acc = 0;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.world.timestep = FIXED_DT;
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  setGravity(g: number): void {
    this.world.gravity = { x: 0, y: -g, z: 0 };
  }

  step(dt: number): void {
    this.acc += dt;
    let n = 0;
    while (this.acc >= FIXED_DT && n < 4) {
      this.world.step();
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

  createStaticCylinder(x: number, y: number, z: number, radius: number, halfHeight: number): RAPIER.Collider {
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
