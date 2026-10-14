// The swim's arithmetic, moved out of `Player.update` unchanged so that the game's own swim is what the
// grapple's tests run rather than a copy that could drift (the design's §3.17). Everything that is
// arithmetic is here -- the swim's share of the speed, the ease toward the keys, the float chase, Space,
// crouch and the dive, the buoyancy stop, the probe `__debug.afloat` reads, and the swimmer being off the
// ground -- and everything that is not (the rig's override let go, the saber put away) is left where it was.
//
// The speed goes in and the swum speed comes out with `grounded`, because the frame reads the speed after
// the swim for the clips' pace (`moveAmount`, the step phase and `groundSpeed`), and a step that scaled it
// inside and handed nothing back would play every swimmer's clips at land pace.
//
// One branch is the rope's, behind a flag the caller hands in only while the grapple is attached: reeling in
// toward a pivot rising past `swimLift`, the rope takes the vertical from the float chase (`ropeLift`). A
// second is a tow over water (`towed`, wave 3): the tow's own friction and damping take the level speed in place
// of the swim's ease, so a swimmer towed behind a hull skims. With both down this is the old block to the bit,
// which `grappleWater.test.ts` holds against a copy of it over ten thousand random states.
import { afloatVelocity } from '../world/afloat.ts';

/** The original game's run (m/s), as `player.ts` keeps it. */
export const SWIM_RUN_SPEED = 5.5;
/** Depth of the feet below the surface at which walking becomes swimming (the chest is under). */
export const SWIM_DEPTH = 1.1;
/** Swimming speed as a fraction of running. */
export const SWIM_SPEED = 0.45;

/** What the swim reads, filled in place by the caller: one kept record, nothing made a frame. */
export interface SwimIn {
  /** The body's velocity, written by the step. */
  vel: { x: number; y: number; z: number };
  posY: number;
  /** The drawn surface over the body, and how deep its feet are under it. */
  surface: number;
  depth: number;
  submerged: boolean;
  /** The jump and crouch actions held this frame. */
  jump: boolean;
  crouch: boolean;
  /** A move key held, and the unit direction the keys and the camera make of it. */
  moving: boolean;
  moveX: number;
  moveZ: number;
  /** The camera's look, read only while moving: its upward share, and whether the forward key is the one held (mz >= 0). */
  diveY: number;
  forward: boolean;
  /** The speed the frame worked out before the water: the swim's share is taken of it. */
  speed: number;
  dt: number;
  /** The grapple has the vertical this frame (attached, afloat, reeling in past `swimLift`). */
  ropeLift: boolean;
  /**
   * A tow over water (the grapple's rope on a hull that pulled lately): the tow's own friction (m/s², against the level
   * speed) and its damping across the rope relative to the pivot (1/s) in place of the swim's level ease, the rope's level
   * way from its pivot (unit) and the pivot's level velocity. The float chase keeps the vertical: the surface is a ground.
   */
  towed: boolean;
  towFriction: number;
  towDamp: number;
  towRx: number;
  towRz: number;
  towVx: number;
  towVz: number;
}

/** What `__debug.afloat` reads of the last swimming frame, written in place. */
export interface SwimProbe {
  dt: number;
  surface: number;
  want: number;
  from: number;
  gap: number;
  ride: number;
  riding: boolean;
  asked: number;
  capped: number;
  moved: number;
  /** The rope had the vertical this frame, so the float chase never ran. */
  rope: boolean;
}

/** What the step hands back: the swum speed and whether the body stands on anything (never, swimming). */
export interface SwimOut {
  speed: number;
  grounded: boolean;
}

export function newSwimIn(): SwimIn {
  return { vel: { x: 0, y: 0, z: 0 }, posY: 0, surface: 0, depth: 0, submerged: false, jump: false, crouch: false, moving: false, moveX: 0, moveZ: 0, diveY: 0, forward: true, speed: 0, dt: 0, ropeLift: false, towed: false, towFriction: 0, towDamp: 0, towRx: 0, towRz: 0, towVx: 0, towVz: 0 };
}

export function newSwimOut(): SwimOut {
  return { speed: 0, grounded: false };
}

/**
 * One swimming frame: slow, no gravity, free up and down; looking down while submerged dives. (Untouched by
 * the movement profile: the water keeps its own rules.)
 */
export function swimStep(s: SwimIn, probe: SwimProbe, out: SwimOut): SwimOut {
  const vel = s.vel;
  const dt = s.dt;
  const surface = s.surface;
  const depth = s.depth;
  let speed = s.speed;
  speed *= SWIM_SPEED;
  const k = 1 - Math.exp(-dt * 4);
  if (s.towed) {
    // Towed over water the swimmer skims: the tow's friction against the level speed, and its swing across the rope
    // (relative to the pivot) damped, as on the ground. The swim's own ease toward the keys is a drag of 160 m/s² at
    // 40 m/s, which the rope's slip would pay out at well over a metre a frame.
    const horiz = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (s.towFriction > 0 && horiz > 1e-6) {
      const f = Math.min(horiz, s.towFriction * dt) / horiz;
      vel.x -= vel.x * f;
      vel.z -= vel.z * f;
    }
    if (s.towDamp > 0 && (s.towRx !== 0 || s.towRz !== 0)) {
      const rx = vel.x - s.towVx;
      const rz = vel.z - s.towVz;
      const along = rx * s.towRx + rz * s.towRz;
      const d = Math.min(1, s.towDamp * dt);
      vel.x -= (rx - s.towRx * along) * d;
      vel.z -= (rz - s.towRz * along) * d;
    }
  } else {
    // With no tow the swim eases toward the keys as it always has.
    vel.x += (s.moveX * speed - vel.x) * k;
    vel.z += (s.moveZ * speed - vel.z) * k;
  }
  // Lying on the surface is not standing still in y any more. With the swell in `surface` the float line
  // moves, so the body has to ride it, and that is the same spring a swimming creature has always held its
  // own line with (`src/world/afloat.ts`). On flat water it asks for nothing, since the line it is chasing is
  // exactly where the body already is.
  const ride = afloatVelocity(surface - SWIM_DEPTH, s.posY, vel.y, dt);
  let vy = 0;
  let riding = false;
  let asked: number;
  if (s.ropeLift) {
    // The rope has the vertical: the float chase, Space, the dive and the buoyancy stop give way, the water
    // drags the vertical as it drags every other axis, and the constraint's pull decides where the body goes,
    // which is up the rope and out.
    vel.y += (0 - vel.y) * k;
    asked = vel.y;
  } else {
    if (s.jump) vy = SWIM_SPEED * SWIM_RUN_SPEED;
    else if (s.crouch) vy = -SWIM_SPEED * SWIM_RUN_SPEED;
    else if (s.moving) {
      // Under water the camera steers: swim where you look. At the surface only a steep look downwards
      // dives, so ordinary forward swimming keeps the head up.
      vy = s.diveY * speed * (s.forward ? 1 : -1);
      if (!s.submerged && (vy > 0 || s.diveY > -0.5)) {
        vy = ride;
        riding = true;
      }
    } else if (!s.submerged) {
      vy = ride;
      riding = true;
    } else vy = -0.3; // a slow sink when idle under water
    // The other branches are a speed the body is *asked* for and eased onto; the spring's answer is a
    // considered speed already, with its own damping in it, so it goes on as it stands. Easing that as well is
    // a second lag on top of the first, and the two together left the body a quarter of a metre out of step
    // with a swell it should have been riding.
    if (riding) vel.y = vy;
    else vel.y += (vy - vel.y) * (1 - Math.exp(-dt * 6));
    // Buoyancy: rising past the float line stops at it.
    asked = vel.y;
    if (vel.y > 0 && depth - vel.y * dt < SWIM_DEPTH) vel.y = Math.max(0, (depth - SWIM_DEPTH) / dt);
  }
  // What this frame really decided, for `__debug.afloat`. One kept object, written only while swimming, so
  // it costs a handful of stores and allocates nothing: a body that will not hold its line can be told apart
  // from one that is never asked to, and both from one that asks and is refused by the character controller.
  probe.dt = dt;
  probe.surface = surface;
  probe.want = surface - SWIM_DEPTH;
  probe.from = s.posY;
  probe.gap = surface - SWIM_DEPTH - s.posY;
  probe.ride = ride;
  probe.riding = riding;
  probe.asked = asked;
  probe.capped = vel.y;
  probe.moved = Number.NaN;
  probe.rope = s.ropeLift;
  out.speed = speed;
  out.grounded = false;
  return out;
}
