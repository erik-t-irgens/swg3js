// Where to aim at a moving target: the lead a gunner takes so a bolt fired now and the target
// arrive at the same point together. Everything is relative to the shooter, since a bolt carries
// the shooter's own velocity: the target's place and velocity relative to the shooter, and the
// bolt's speed over the shooter's.

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Seconds until a bolt at `speed` (relative to the shooter) meets a target at `rel` moving at
 * `relVel` (both relative to the shooter), or null when it never can (the target outruns the bolt).
 * The bolt must reach |rel + relVel t| = speed t: a quadratic in t, the earliest positive root.
 */
export function interceptTime(rel: Vec3, relVel: Vec3, speed: number): number | null {
  const a = relVel.x * relVel.x + relVel.y * relVel.y + relVel.z * relVel.z - speed * speed;
  const b = 2 * (rel.x * relVel.x + rel.y * relVel.y + rel.z * relVel.z);
  const c = rel.x * rel.x + rel.y * rel.y + rel.z * rel.z;
  if (c === 0) return 0;
  if (Math.abs(a) < 1e-9) {
    // The target moves as fast as the bolt: a single crossing, if it is ahead of the bolt.
    if (b >= 0) return null;
    return -c / b;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  if (lo > 0) return lo;
  if (hi > 0) return hi;
  return null;
}

/** The point to aim at, relative to the shooter, for a meeting after `t` seconds: where the target will be then. */
export function leadPoint(rel: Vec3, relVel: Vec3, t: number, out: Vec3): Vec3 {
  out.x = rel.x + relVel.x * t;
  out.y = rel.y + relVel.y * t;
  out.z = rel.z + relVel.z * t;
  return out;
}
