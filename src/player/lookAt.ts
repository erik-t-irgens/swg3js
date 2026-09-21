// The head that looks where you look, as numbers. A body whose head never moves reads as a shop
// dummy carrying a sword, and the one thing anybody notices first is a head that will not look up.
//
// Three rules hold the whole of it, and two of them are older than this file:
//
// - Jedi Academy's torso does **not** face the view while moving: the legs take the movement offset
//   and the torso a quarter of it (`player.ts`'s `torsoTwist`, `CG_PlayerAngles`). The head is a
//   third thing beside that, never a replacement for it, so what is asked for here is measured from
//   **where the spine has already been left** -- the twist the rig applied this frame is taken off
//   before the cone is applied. Turn the body and the head does not first fling itself round.
// - A rider's spine takes no torso twist while mounted, and a riding clip is authored with the head
//   where the pose wants it. `ride` is the switch: 0 (the default) keeps the head still on anything
//   ridden, 1 lets it follow at a ship's controls, which is the one the owner can be asked about in
//   a keypress.
// - A special move -- a kata, a kick, a death, an emote, a dance -- poses the whole body, and a head
//   that goes on tracking the camera through one reads as a doll. Anything whole-body hands
//   `allowed` false and the turn eases back to nothing at the same rate it eased out.
//
// The turn is shared between the two joints the game's skeletons really have above the chest,
// `neck` and `Head`: a third to the neck and two thirds to the head, which is what stops a head
// swivelling on a neck that never moved.
//
// Nothing here imports anything at all (`saberHit.ts`, `bladeGlowMath.ts` and `gradeMath.ts` are
// the same arrangement), so `tools/swg/tests/lookAt.test.ts` drives the very state machine the game
// runs rather than a copy of the rule written out again. The quaternions are `rig.ts`'s, and it is
// the only caller that turns these numbers into a pose.
//
// Angles: `yaw` positive turns the head to the character's left and `pitch` positive looks **down**,
// which is the camera's own pitch and the same sense `twistTorso` already takes. Degrees where a
// number is a cone or a step on the wire, radians everywhere a frame does arithmetic. Every function
// is allocation-free.

export interface LookTune {
  /** How far the head may turn from the chest, degrees either way. */
  yaw: number;
  /** How far it may tilt from the chest, degrees either way (positive is down). */
  pitch: number;
  /** The share of the turn the neck takes; the head takes the rest. */
  neckShare: number;
  /** How fast the turn eases toward what is wanted, radians a second, out and back alike. */
  rate: number;
  /**
   * Whether the head follows the view while the body is on something it rides. 0: it does not, which
   * is the rule a riding clip is authored for; above 0: it does, which is what to try at a ship's
   * controls. A switch rather than a fraction, so it is one keypress either way.
   */
  ride: number;
}

/**
 * Every number the head's look has. All of them are ours: nothing in the archives says how far a
 * head may turn, and the skeleton that would have to answer stops at `Head` with no face in it.
 * Live through `__debug.headLook({ ... })`.
 */
export const LOOK: LookTune = {
  yaw: 55,
  pitch: 30,
  neckShare: 1 / 3,
  rate: 6,
  ride: 0,
};

/**
 * The wire's own format for the head's pitch, and deliberately **not** in `LOOK`: what a step of the
 * byte is worth is an agreement between two browsers, and a number one of them can move on its own
 * is not an agreement. The receiver decodes with its own copy of this, so a knob that widened the
 * step here alone would misread every peer's head by that ratio -- a peer looking thirty degrees
 * down would read as four -- with nothing anywhere saying why. Nothing tunes it and nothing should.
 *
 * `reach` is a little past the furthest the camera can be pitched at all (±1.4 rad, 80.2 degrees),
 * so nothing anybody can look at is ever cut off, and `steps` is the whole byte spent on that reach:
 * 127 steps either side of level, which is 0.709 of a degree and every one of the 255 values used.
 */
export const PITCH_WIRE = Object.freeze({ reach: 90, steps: 127 });

const DEG = Math.PI / 180;

/** An angle brought back inside (-pi, pi], so "the view is 350 degrees round" is ten degrees the other way. */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** An angle held inside a cone given in degrees. */
export function coneClampDegrees(angle: number, degrees: number): number {
  const limit = Math.max(0, degrees) * DEG;
  if (!Number.isFinite(angle)) return 0;
  return angle > limit ? limit : angle < -limit ? -limit : angle;
}

/**
 * What the head is really asked for, in the chest's own frame: the view's angle from the body's
 * heading, less whatever turn the spine has already been given this frame, held inside the cone.
 * This is the whole of "the clamp is relative to the chest": with the spine turned 40 degrees toward
 * the crosshair and the view 60 off the body, the head is asked for 20 and not for 55.
 */
export function chestRelative(wanted: number, twist: number, degrees: number): number {
  return coneClampDegrees(wrapAngle(wrapAngle(wanted) - (Number.isFinite(twist) ? twist : 0)), degrees);
}

/**
 * One frame of the ease: `current` toward `wanted` at `rate` radians a second, and never past it.
 * A frame long enough to cover the whole gap lands exactly on the wanted angle rather than
 * overshooting and easing back, which would read as a wobble on a hidden tab's first frame back.
 */
export function easeAngle(current: number, wanted: number, rate: number, dt: number): number {
  if (!Number.isFinite(current)) return 0;
  if (!Number.isFinite(wanted)) return current;
  const step = Math.max(0, rate) * Math.max(0, dt);
  const gap = wanted - current;
  if (Math.abs(gap) <= step) return wanted;
  return current + Math.sign(gap) * step;
}

/** The most a pitch can be said on the wire, in degrees: the format's own reach and nobody's knob. */
export function pitchReach(): number {
  return PITCH_WIRE.reach;
}

/** What one step of the byte is worth, in degrees: the reach spread over the whole byte. */
export function pitchStep(): number {
  return PITCH_WIRE.reach / PITCH_WIRE.steps;
}

/**
 * The head's pitch as the one byte it crosses on: the middle of the byte is level and a step is
 * `pitchStep()` degrees. This and the heading the wire already carries are the whole of the head on
 * the wire -- a head that turns left and right but never looks up is the thing you would notice, and
 * the heading gives the left and right for free.
 */
export function packPitch(radians: number): number {
  if (!Number.isFinite(radians)) return 128;
  const reach = PITCH_WIRE.reach;
  const degrees = Math.min(reach, Math.max(-reach, radians / DEG));
  const byte = Math.round(degrees / pitchStep()) + 128;
  return byte < 0 ? 0 : byte > 255 ? 255 : byte;
}

/** The angle back out of that byte, in radians. Anything that is not a byte reads as level. */
export function unpackPitch(byte: number): number {
  if (!Number.isFinite(byte)) return 0;
  const b = byte < 0 ? 0 : byte > 255 ? 255 : Math.round(byte);
  return (b - 128) * pitchStep() * DEG;
}

/**
 * Where one body's head is looking, and the ease that takes it there. One per rig -- the player's,
 * and one for every peer drawn -- never one at module scope: a look at module scope would be every
 * head's look at once, which is the mistake the fighters' blade ends were already made to stop
 * making.
 *
 * `step` is the whole state machine and is what the node test drives. It allocates nothing and does
 * no trigonometry beyond one wrap per axis.
 */
export class HeadLook {
  /**
   * What the view asked for this frame, before the chest's own turn and before the cone: the angle
   * from the body's heading, and the tilt. The pitch of this is what goes on the wire, so a peer is
   * sent where the player is looking rather than where this browser's ease has got to -- their own
   * browser eases it, and easing an eased number would lag the head twice over.
   */
  wantedYaw = 0;
  wantedPitch = 0;
  /** Where the head has got to, in the chest's frame, eased and inside the cone. */
  yaw = 0;
  pitch = 0;
  /** Whether the last step was allowed to look at all. */
  on = false;
  /**
   * The numbers this head is held to. It is the one shared tuning object for the player and every
   * peer, and it is a field rather than an argument to `step` so that the cone, the rate and the
   * share can never come from two different places: a caller that wants a head of its own (the
   * fighters, whenever their wave comes) writes its own tune here once and every one of the four
   * shares below reads the same one.
   */
  tune: LookTune = LOOK;

  /** The neck's share of the turn, and the head's, which is the rest. */
  get neckYaw(): number {
    return this.yaw * share(this.tune.neckShare);
  }

  get headYaw(): number {
    return this.yaw - this.neckYaw;
  }

  get neckPitch(): number {
    return this.pitch * share(this.tune.neckShare);
  }

  get headPitch(): number {
    return this.pitch - this.neckPitch;
  }

  /**
   * One frame. `wantedYaw` and `wantedPitch` are where the view looks, measured from the body's own
   * heading; `twistYaw` and `twistPitch` are what the spine was already turned by this frame, so the
   * cone is applied to what is left; `allowed` false (a special move, a death, a ride) eases the
   * whole thing back to nothing at the same rate.
   */
  step(wantedYaw: number, wantedPitch: number, twistYaw: number, twistPitch: number, dt: number, allowed: boolean): void {
    const tune = this.tune;
    this.on = allowed;
    this.wantedYaw = allowed ? wrapAngle(wantedYaw) : 0;
    this.wantedPitch = allowed ? wrapAngle(wantedPitch) : 0;
    const yaw = allowed ? chestRelative(wantedYaw, twistYaw, tune.yaw) : 0;
    const pitch = allowed ? chestRelative(wantedPitch, twistPitch, tune.pitch) : 0;
    this.yaw = easeAngle(this.yaw, yaw, tune.rate, dt);
    this.pitch = easeAngle(this.pitch, pitch, tune.rate, dt);
  }

  /** Forget it outright: the body was put somewhere, respawned, or the figure was dressed again. */
  reset(): void {
    this.wantedYaw = 0;
    this.wantedPitch = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.on = false;
  }

  /** What it is doing, in degrees, for the console. */
  describe(): { on: boolean; yaw: number; pitch: number; neck: number; head: number; wantedPitch: number } {
    return {
      on: this.on,
      yaw: deg(this.yaw),
      pitch: deg(this.pitch),
      neck: deg(this.neckYaw),
      head: deg(this.headYaw),
      wantedPitch: deg(this.wantedPitch),
    };
  }
}

/** A share is a share: anything else would put more turn on the two joints than was asked for. */
function share(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

const deg = (radians: number): number => Number((radians / DEG).toFixed(1));

/** The floors that keep the rules finite: nothing here may go negative and turn a cone inside out. */
const FLOOR: Record<keyof LookTune, number> = {
  yaw: 0,
  pitch: 0,
  neckShare: 0,
  rate: 0,
  ride: 0,
};

/**
 * The readout: where the head being asked about has got to, and the tuning. Passing any of the
 * tuning's numbers moves them first, which is how the owner tries a wider cone, a slower ease or
 * the head at a ship's controls (`ride: 1`) without reloading. Console only, so it may allocate.
 * The wire's own two numbers are reported beside the tuning and cannot be moved from here.
 */
export function lookReport(opts?: Partial<LookTune> | null, head?: HeadLook | null): {
  tune: LookTune;
  wire: { reach: number; step: number };
  head: ReturnType<HeadLook['describe']> | string;
} {
  if (opts) tuneLook(opts);
  return {
    tune: { ...LOOK },
    /** What the byte can say, in degrees, and what one of its steps is worth. Both sides agree on these. */
    wire: { reach: pitchReach(), step: Number(pitchStep().toFixed(3)) },
    head: head ? head.describe() : 'no rig',
  };
}

/** Move the tuning live, as `__debug.headLook({ yaw: 70 })` does; returns what is in force. */
export function tuneLook(opts?: Partial<LookTune> | null): LookTune {
  if (!opts) return LOOK;
  for (const key of Object.keys(LOOK) as (keyof LookTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) LOOK[key] = Math.max(FLOOR[key], v);
  }
  LOOK.neckShare = share(LOOK.neckShare);
  return LOOK;
}
