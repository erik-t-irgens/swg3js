// The arithmetic of a thrown grenade, pure, so a node test runs the very lines the Bounty Hunter's throw does.
// A throw leaves the hand along the aim lobbed up a little, at the grenade's speed, with a fixed lift added on
// top and the thrower's own run carried with it. Every number is ours.
//
// The lift being added rather than scaled is why Steady Arm scales the speed and the lift together: scaling the
// speed alone by the square root of 1.25 takes a level throw about 18% further, not the doc's 25%.

/** Where and how a throw leaves the hand [ours]: the aim lobbed up by `lob` before it is made a direction again, from `hand` metres over the feet when the hand cannot be found, `ahead` metres along the throw. */
export const THROW_SHAPE = { lob: 0.3, hand: 1.4, ahead: 0.4 };

/** The ball a thrown charge is, in metres. */
export const THROW_BALL = 0.14;

/** A direction, lobbed in place: made a direction, lifted, and made a direction again. */
export function lobbed<T extends { x: number; y: number; z: number; normalize(): T }>(dir: T): T {
  dir.normalize().y += THROW_SHAPE.lob;
  return dir.normalize();
}

/** A throw's velocity: along the lobbed direction at `speed`, `upward` added, and the thrower's own run carried. */
export function throwVelocity(dir: { x: number; y: number; z: number }, speed: number, upward: number, carryX: number, carryZ: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  out.x = dir.x * speed + carryX;
  out.y = dir.y * speed + upward;
  out.z = dir.z * speed + carryZ;
  return out;
}
