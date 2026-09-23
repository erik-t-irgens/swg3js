// How a fighter stands, aims and is held up -- the pure half of it, with no three, no physics
// engine and no browser, so a node test drives the very functions the game runs rather than a
// mirror of them.
//
// Three things live here.
//
// **The stance.** Whether a fighter is in its relaxed carry, its combat carry or its aimed one.
// That is the player's own three-way state (`Player.gunReady`, `Player.aiming` in
// `src/player/player.ts`) read off what a fighter has to fight instead of off a mouse button and a
// shot clock, which is the whole of the owner's "a combat/non combat state like players have so
// their aiming works": the rig states are the player's (`gunIdle`/`gunReady*`/`gunAim*`,
// `stance`, `runSaber`/`walkSaber`), and what picks between them is here.
//
// **The aim's correction.** The arithmetic `Player.correctAim` does: measure the barrel against
// where the shot is really going, fold the difference into an eased turn, let the spine take what
// it can and the body's own facing take the rest. It is the player's numbers to the digit -- the
// gain, the decay, the two caps and the spine's share are lifted from `player.ts` unchanged -- and
// the only thing a fighter changes is what it is measured against: a fighter has no camera and no
// crosshair, so "where the camera looks" becomes "the point the next bolt is going to".
//
// It is the player's numbers *and* the player's three modes: the correction is chased while there
// is something to point at, **held** where it stands through the recoil and through a stagger
// (`Player.correctAim` returns early out of the recoil without touching it), and eased away only
// when the weapon comes down. See `aimMode`, which is where getting that wrong costs a fighter its
// aim between every shot and the next.
//
// **The body's footing.** What the vertical is once the character controller has moved: whether it
// is on the ground, whether it is falling, and the two floors it may never go below -- the
// planet's own outdoors, and, indoors, the height it last really had, for a room whose collision
// the streamer has dropped out from under it.
//
// Ours rather than the game's, every one of them, and named where each came from below.

/** Which carry a fighter stands in: its weapon down, its weapon up, or aimed at something. */
export type Stance = 'relaxed' | 'ready' | 'aim';

export interface StanceTune {
  /**
   * How long the combat carry lasts after a fighter last had something alive to fight, in seconds.
   * The player's own `GUN_READY_SECONDS`, which is how long a blaster stays up after a shot.
   */
  ready: number;
  /**
   * How far off its nose a target may be, in radians, and how much of the gun's own range it may
   * be out to, before a fighter raises to the aimed pose rather than the combat carry. **Ours**:
   * the player aims when the button is held and a fighter has no button. The cone is deliberately
   * wider than the one a shot is gated on (`FIGHTER_TUNE.aimCone`), so the gun is already up by
   * the time the fighter has turned far enough to fire; the share is over one for the same reason.
   */
  aimCone: number;
  aimShare: number;
  /** How fast the measured correction is taken, as the share of the error a second. The player's. */
  gain: number;
  /** How fast it eases away again once nothing is being aimed at. The player's. */
  decay: number;
  /** The caps on the whole correction, in radians. The player's. */
  maxYaw: number;
  maxPitch: number;
  /** How much of the yaw the spine takes before the body's own facing takes the rest. The player's `AIM_SPINE_MAX`. */
  spineMax: number;
  /** How fast the drawn body turns onto the share the spine could not take, as the share a second. The player's. */
  bodyTurn: number;
  /**
   * Seconds after a shot in which the recoil is not chased. The player's -- and, like the
   * player's, this window **holds** the correction where it stands rather than letting it go
   * (`Player.correctAim`'s `if (this.sinceShot < 0.35) return;` is an early return past the
   * ease, not a way into it). See `aimMode`, which is where that distinction lives.
   */
  afterShot: number;
}

export const STANCE_TUNE: StanceTune = {
  ready: 5,
  aimCone: 0.9,
  aimShare: 1.25,
  gain: 12,
  decay: 8,
  maxYaw: 2.2,
  maxPitch: 0.8,
  spineMax: 0.6,
  bodyTurn: 16,
  afterShot: 0.35,
};

/** Nothing here may go negative: a cone of nought is a fighter that never raises its gun, which is legible. */
const STANCE_FLOOR: Record<keyof StanceTune, number> = {
  ready: 0,
  aimCone: 0,
  aimShare: 0,
  gain: 0,
  decay: 0,
  maxYaw: 0,
  maxPitch: 0,
  spineMax: 0,
  bodyTurn: 0,
  afterShot: 0,
};

/** Move the stance's tuning live, as `__debug.fighters({ stance: { aimCone: 0.4 } })` does; returns what is in force. */
export function tuneStance(opts?: Partial<StanceTune> | null): StanceTune {
  if (!opts) return STANCE_TUNE;
  for (const key of Object.keys(STANCE_TUNE) as (keyof StanceTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) STANCE_TUNE[key] = Math.max(STANCE_FLOOR[key], v);
  }
  return STANCE_TUNE;
}

/**
 * The capsule a fighter is and the character controller that carries it. **The controller's
 * numbers are the player's own** (`Player.makeBody` in `src/player/player.ts`): the same autostep,
 * the same slopes, the same snap and the same skin, so a fighter is stopped by exactly what stops
 * the player and climbs exactly what the player climbs. The capsule is the fighter's own, and has
 * been since fighters existed: the player's radius (which is what a doorway and a corner care
 * about) and a body 0.2 m taller than the player's.
 *
 * `gravity` is the one that is neither: the 18 m/s² a fighter has always fallen at, moved here out
 * of the middle of `update`. It is also what holds a standing body onto the floor, one frame of it
 * at a time, exactly as the player's is -- which matters more than it sounds, because a *constant*
 * downward speed was tried there first and the character controller reads a step as a wall when
 * the movement it is given is mostly downward. Walking down is the snap's work, not gravity's.
 */
export interface FighterBody {
  radius: number;
  /**
   * Half the fighter's drawn height: the aim point the whole game reads to shoot at its middle,
   * and where its kinematic body sits over its feet. **Not** the collision capsule, which is
   * `standHalf` below.
   */
  halfHeight: number;
  /**
   * Half the straight part of the collision capsule -- the player's own `STAND_HALF_HEIGHT`, so
   * the shape that meets a lintel, a pipe or a low doorway is the player's 1.6 m and not the
   * 1.8 m the aim point implies. They were one number until this was found: a clearance between
   * 1.6 and 1.8 m was open for the player and a wall for a fighter, which is exactly the "stuck
   * where it used to walk through" the body was given to avoid.
   */
  standHalf: number;
  /** The controller's skin: how far off a surface it is held. */
  offset: number;
  /** The tallest step it climbs and the least tread it needs on top of one. */
  autostep: number;
  autostepWidth: number;
  /** The steepest slope it walks up, and the one it starts sliding down, in radians. */
  slopeClimb: number;
  slopeSlide: number;
  /** How far down it keeps hold of the ground rather than leaving it. */
  snap: number;
  /** Metres a second squared, downward: what it falls at, and what holds it on the floor standing. */
  gravity: number;
  /** What the controller weighs when it shoulders something, in kilograms. The player's 80. */
  mass: number;
}

export const FIGHTER_BODY: FighterBody = {
  radius: 0.35,
  halfHeight: 0.9,
  standHalf: 0.45,
  offset: 0.04,
  autostep: 0.5,
  autostepWidth: 0.2,
  slopeClimb: (55 * Math.PI) / 180,
  slopeSlide: (60 * Math.PI) / 180,
  snap: 0.35,
  gravity: 18,
  mass: 80,
};

const BODY_FLOOR: Record<keyof FighterBody, number> = {
  // A capsule of nought is not a capsule at all: the engine hands back a handle that is not a
  // handle for one, which is the lesson the peers' own bodies were floored for.
  radius: 0.05,
  halfHeight: 0.1,
  standHalf: 0.05,
  offset: 0.001,
  autostep: 0,
  autostepWidth: 0.01,
  slopeClimb: 0,
  slopeSlide: 0,
  snap: 0,
  gravity: 0,
  mass: 1,
};

/**
 * Where the collision capsule's middle sits relative to the kinematic body, which is itself
 * `halfHeight` over the feet: the capsule's own middle is `radius + standHalf` over them, exactly
 * as the player's is, so the feet of both are the point they stand on.
 */
export function capsuleDrop(tune: FighterBody = FIGHTER_BODY): number {
  return tune.radius + tune.standHalf - tune.halfHeight;
}

/**
 * Whether a fighter's controller pushes the dynamic bodies it walks into. Off, for the player's own
 * reason: the engine works the push against the other body's shape and panics on a hull's
 * triangles, after which every call into it fails. Kept here rather than read off `Player`, which
 * this module may not import; `__debug.pushBodies` moves both.
 */
let pushDynamic = false;

/** Read it, or set it and read back what is in force. */
export function fighterPush(on?: boolean): boolean {
  if (on !== undefined) pushDynamic = on;
  return pushDynamic;
}

/** Move the body's tuning live; returns what is in force. The capsule is read when a fighter is made. */
export function tuneFighterBody(opts?: Partial<FighterBody> | null): FighterBody {
  if (!opts) return FIGHTER_BODY;
  for (const key of Object.keys(FIGHTER_BODY) as (keyof FighterBody)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) FIGHTER_BODY[key] = Math.max(BODY_FLOOR[key], v);
  }
  return FIGHTER_BODY;
}

/**
 * What a character controller answers to, named structurally so this module needs no physics
 * engine to say what a fighter's is set to. The game passes rapier's own; the node test passes
 * rapier's own as well, which is the point of it being a shape rather than an import.
 */
export interface ControllerLike {
  enableAutostep(maxHeight: number, minWidth: number, includeDynamicBodies: boolean): void;
  setMaxSlopeClimbAngle(angle: number): void;
  setMinSlopeSlideAngle(angle: number): void;
  enableSnapToGround(distance: number): void;
  setApplyImpulsesToDynamicBodies(enabled: boolean): void;
  setCharacterMass(mass: number | null): void;
}

/**
 * Set a controller to the fighters' numbers, which are all six of the player's. Called when one is
 * made and again whenever the knob moves. The last two were once left at the engine's own defaults
 * -- which happen to be these values today, so nothing was wrong -- but "set to the player's own
 * numbers" was then only true of four of them, and a default is not a decision.
 */
export function applyBody(c: ControllerLike, tune: FighterBody = FIGHTER_BODY): void {
  c.enableAutostep(tune.autostep, tune.autostepWidth, true);
  c.setMaxSlopeClimbAngle(tune.slopeClimb);
  c.setMinSlopeSlideAngle(tune.slopeSlide);
  c.enableSnapToGround(tune.snap);
  c.setApplyImpulsesToDynamicBodies(pushDynamic);
  c.setCharacterMass(tune.mass);
}

/** An angle folded into -pi..pi, which is how every difference of two headings here is read. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** `from` eased toward `to` by `rate` of the difference a second, the way every turn in this game eases. */
export function easeAngle(from: number, to: number, rate: number, dt: number): number {
  return from + wrapAngle(to - from) * Math.min(1, Math.max(0, dt * rate));
}

/**
 * What the fighter's stance is decided from. Every field is a primitive, and the caller asks
 * through one struct it keeps and writes into rather than a literal built each frame -- a literal
 * per fighter per frame is an allocation per fighter per frame, whatever a shape like this looks
 * like at the call site. `npcs.ts` keeps `stanceAsk` for it.
 */
export interface StanceInput {
  /** Whether it is carrying a gun rather than a blade or a club. */
  gun: boolean;
  /** Whether it is fighting, or was within the last `ready` seconds. */
  combat: boolean;
  /** Whether it has something alive in hand to aim at this instant. */
  hasTarget: boolean;
  /** How far that target is, in metres, and how far the gun shoots. */
  gap: number;
  range: number;
  /** How far off its nose the target is, in radians (the sign does not matter). */
  offNose: number;
}

/**
 * Which carry a fighter stands in. Nothing with a blade ever reaches `aim`: the player's aimed
 * poses are a blaster's, and a lit blade's own stance is what `ready` plays for one.
 */
export function stanceFor(o: StanceInput, tune: StanceTune = STANCE_TUNE): Stance {
  if (!o.combat) return 'relaxed';
  if (!o.gun || !o.hasTarget) return 'ready';
  if (!(o.gap <= o.range * tune.aimShare)) return 'ready';
  if (!(Math.abs(o.offNose) <= tune.aimCone)) return 'ready';
  return 'aim';
}

/** The aim's measured correction: one of these per fighter, written and never made. */
export interface AimFix {
  yaw: number;
  pitch: number;
}

/**
 * What a frame does to the correction. The player has all three and they are **not** two:
 *
 * - `chase`: measure the barrel and fold the difference in (`Player.correctAim`'s body).
 * - `hold`: leave it exactly where it stands. The recoil window is this, and so is a stagger:
 *   `Player.correctAim` returns early out of the recoil (`if (this.sinceShot < 0.35) return;`)
 *   without touching `fix`.
 * - `ease`: let it go back to nothing at the decay rate, which is what the player does with the
 *   gun down or with nothing under the crosshair (`!gunUp || this.mounted || !fix.on`).
 *
 * Reading the recoil as `ease` rather than `hold` is the one mistake here that looks like a skip
 * and is the opposite of one: at 60 fps the decay keeps 0.8667 of the correction a frame, so the
 * 0.35 s window throws away 95 per cent of a settled aim (0.8667^21) and the 12-a-second gain
 * needs another 0.23 s to win it back -- which is the whole of a fighter's own 0.35-0.65 s gun
 * cooldown, so the barrel would swing off the target and back on again for every shot, for ever.
 */
export type AimMode = 'chase' | 'hold' | 'ease';

/** What the aim's mode is decided from: primitives only, so nothing is allocated to ask. */
export interface AimWhen {
  /** Whether it has a barrel in hand, its weapon up and something alive to point it at. */
  aiming: boolean;
  /** Seconds since its last shot. */
  sinceShot: number;
  /** Whether a blow has it staggered: it is not moving its own body, so nothing is measured through it. */
  stunned: boolean;
}

/** Which of the three a frame is. The player's rule, in the player's own order. */
export function aimMode(o: AimWhen, tune: StanceTune = STANCE_TUNE): AimMode {
  if (!o.aiming) return 'ease';
  if (o.sinceShot < tune.afterShot || o.stunned) return 'hold';
  return 'chase';
}

/**
 * One frame of the correction, exactly as `Player.correctAim` takes it. `want` is where the shot is
 * going and `have` is where the barrel is pointing, both as a yaw about the vertical and a pitch
 * (positive up). A turn to the fighter's left is positive and a tilt forward and down is positive,
 * so the pitch runs the other way round from the angle it is measured against -- which is the one
 * sign in all of this that is easy to get backwards, and is why the node test pins it.
 */
export function stepAimFix(fix: AimFix, wantYaw: number, wantPitch: number, haveYaw: number, havePitch: number, dt: number, mode: AimMode, tune: StanceTune = STANCE_TUNE): void {
  if (mode === 'hold') return;
  if (mode === 'ease') {
    const back = Math.min(1, Math.max(0, dt * tune.decay));
    fix.yaw += (0 - fix.yaw) * back;
    fix.pitch += (0 - fix.pitch) * back;
    return;
  }
  const gain = Math.min(1, Math.max(0, dt * tune.gain));
  const dYaw = wrapAngle(wantYaw - haveYaw);
  const dPitch = wantPitch - havePitch;
  fix.yaw = Math.max(-tune.maxYaw, Math.min(tune.maxYaw, fix.yaw + dYaw * gain));
  fix.pitch = Math.max(-tune.maxPitch, Math.min(tune.maxPitch, fix.pitch - dPitch * gain));
}

/** How much of the correction's yaw the spine takes. */
export function spineShare(yaw: number, tune: StanceTune = STANCE_TUNE): number {
  return Math.max(-tune.spineMax, Math.min(tune.spineMax, yaw));
}

/** And what is left of it for the body's own facing, which is the player's `aimBodyTurn`. */
export function bodyShare(yaw: number, tune: StanceTune = STANCE_TUNE): number {
  return yaw - spineShare(yaw, tune);
}

/** A body's vertical after the controller has moved it: read and written in place, never made. */
export interface Footing {
  y: number;
  /** Its speed upward while it is in the air; NaN while it is standing on something. */
  fallVy: number;
  /** What the controller said: whether it is resting on anything at all. */
  grounded: boolean;
}

/**
 * One frame of gravity: the speed is written onto the footing and the distance to ask the
 * controller for is returned. Standing, `fallVy` is NaN and this is one frame's worth from a
 * standstill -- a few millimetres, which is all it takes to hold a body on the floor. A *constant*
 * downward speed was tried there instead and the controller read a half-metre step as a wall,
 * because the movement it was handed was mostly downward; walking down a step is the snap's work.
 */
export function fallSpeed(f: Footing, dt: number, tune: FighterBody = FIGHTER_BODY): number {
  const vy = (Number.isNaN(f.fallVy) ? 0 : f.fallVy) - tune.gravity * dt;
  f.fallVy = vy;
  return vy * dt;
}

/**
 * The vertical, settled; returns how far the floor of last resort had to lift the body, which is 0
 * on every ordinary frame and is what the readout counts.
 *
 * `terrainY` is the ground the planet's own heightfield generator answers with, or null where
 * there is no such thing (inside a building, where the rooms of a dungeon go far below the terrain
 * and a clamp to it would drag a body up through the floor).
 *
 * Outdoors that height is a floor the body may **never** go below, and it is not the controller's
 * to give: the physics colliders only exist within a few chunks of the player, so a fighter that
 * has wandered any distance has no heightfield under it at all and the controller would let it
 * fall for ever. Above that floor the controller's answer stands, which is what lets a fighter
 * climb a ramp, a step or a rock rather than being pinned to the ground under them.
 *
 * `holdAt` is the indoor answer to the same problem, and the reason it is not the terrain. A
 * building's collision is built only within a couple of hundred metres of the player and dropped
 * again beyond it, while the room a body is in is model data and goes on answering: so a fighter
 * left in a building the player has walked away from is inside a room with **nothing under it at
 * all**, and gravity alone would drop it until it left the building's own box, at which point its
 * room would go null and the terrain clamp above would fire in one frame -- the very drag-up
 * through the floor this branch exists to prevent, hundreds of metres of it in a dungeon. Given a
 * height here the body simply keeps it: it neither falls nor is lifted, and it is standing on its
 * own floor again the moment the room's colliders come back.
 */
export function settleFooting(f: Footing, terrainY: number | null, holdAt: number | null = null): number {
  if (holdAt !== null) {
    f.y = holdAt;
    f.grounded = true;
    f.fallVy = Number.NaN;
    return 0;
  }
  let lifted = 0;
  if (terrainY !== null && f.y < terrainY) {
    lifted = terrainY - f.y;
    f.y = terrainY;
    f.grounded = true;
  }
  // Rising out of a knock keeps its arc even while the controller still calls it grounded: the
  // first frame of a blow that lifts a body is exactly such a frame.
  if (f.grounded && !(f.fallVy > 0)) f.fallVy = Number.NaN;
  else if (!f.grounded && Number.isNaN(f.fallVy)) f.fallVy = 0;
  return lifted;
}
