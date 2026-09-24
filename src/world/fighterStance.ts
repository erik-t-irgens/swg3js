// How a fighter stands, aims and is held up -- the pure half of it, with no three, no physics
// engine and no browser, so a node test drives the very functions the game runs rather than a
// mirror of them.
//
// Four things live here.
//
// **The posture.** How low a body stands -- upright, crouched, kneeling or lying down -- which is
// an axis of its own beside the carry and beside the pace, and the rule that picks between them.
// The four words, what each one lets a body do and which of them may fire are the client's own
// data; when a body goes down is ours and every number of it is in `POSTURE_TUNE`. The collision
// capsule and the aim point move together with it and never apart (`capsuleHalfFor`,
// `aimPointFor`), because a bolt is a ray against the physics world and the capsule *is* the
// hitbox. See `Posture`.
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

/**
 * **How low a body stands**, which is an axis of its own beside the carry and beside the pace: a
 * body can be prone *and* attacking, exactly as it can be running *and* chasing. Four values and no
 * fifth mechanism -- the word is carried on the brain's own `Decision` (`posture`, beside `pace`)
 * so that both consumers read it in one place each and nothing has to invent a state word, which
 * would be a change to the relay's own list before a posture had crossed anything.
 *
 * The four are the client's own, and which of them is which is not a guess. Of the state
 * hierarchy's 147 states twelve are the crouch and **every one of the twelve carries zero
 * actions** -- no fire, no attack, no throw, no heal -- while the kneel's set is an idle, the
 * throws, the heals, a rifle butt-stroke and the twelve kneeling fires. The crouch's own clip set
 * is an idle *and a walk*; the kneel's is an idle and **no walk at all**. So in the game's own data
 * the crouch is how a body **moves** low and the kneel is how it **stands still** low, and that is
 * exactly how they are used here: see `postureFor` for the rule and `paceInPosture` for what each
 * one lets a body do.
 */
export type Posture = 'stand' | 'crouch' | 'kneel' | 'prone';

/** The game's own word for each, which is what its transition and carry clips are named with. */
const POSTURE_WORD: Record<Posture, string> = { stand: 'standing', crouch: 'crouched', kneel: 'kneeling', prone: 'prone' };

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
  /**
   * Half the straight part of the capsule in **any** low posture -- crouched, kneeling or lying
   * down. The player's own `CROUCH_HALF_HEIGHT`, so a low fighter is the player's own 1.0 m body
   * with its feet where they were, and one number serves all three for the same reason the player
   * has one: a real long low body is a support capsule plus hull balls, which is a shape change and
   * a wave of its own.
   *
   * It moves **with the aim point** and never on its own (`aimPointFor`). That is not a choice: a
   * bolt is a ray against the physics world and the struck collider is mapped back to a body, so
   * the capsule **is** the hitbox. Move only the aim point and shots at a body that has gone down
   * miss a body that is still a 1.6 m pillar; move only the capsule and the shooter aims half a
   * metre over its head.
   *
   * The honest arithmetic of taking one capsule for all three, so nobody has to rediscover it: a
   * standing body's shell reaches 1.6 m and a low one's 1.0 m, so going low takes a body out of the
   * band **1.0 to 1.6 m** and out of no other. A shot aimed at a low body's own middle still finds
   * it every time, and a prone body is exactly as hard to hit as a kneeling one. What going low
   * really buys today is the shot already in the air at standing chest height. `lowHalf` is the one
   * number that changes that, and it is live: `__debug.fighters({ body: { lowHalf: 0 } })` is the
   * lowest the player's own radius allows, a 0.7 m shell.
   */
  lowHalf: number;
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
  lowHalf: 0.15,
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
  // Nought is legal here and is not a degenerate shape: a capsule of no straight part is a ball of
  // the radius, which is the lowest a body the player's own width can lie.
  lowHalf: 0,
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
  return capsuleDropFor(tune.standHalf, tune);
}

/**
 * The same, for a capsule of any straight part: where its middle sits relative to the kinematic
 * body, which never moves with the posture. The body's own lift over the feet is the **standing**
 * `halfHeight` for the whole of its life, so that a change of posture is two writes on the collider
 * and nothing at all on the body -- move the body and every place that reads a fighter's position
 * would have to know which posture it was in.
 *
 * `lift` is that body's own lift, and it is a parameter rather than `tune.halfHeight` for one
 * reason: the lift is read **once**, when the body is made, and the tuning is live. A fighter
 * already standing about when `__debug.fighters({ body: { halfHeight: … } })` moves the aim point
 * is still hanging from the old number, so a drop worked out from the new one would sink its
 * capsule's feet below the point it is standing on by exactly the difference. The caller passes
 * the lift it really has (`Npc.bodyLift`); the default is for a body made this instant, where the
 * two are the same number by construction.
 */
export function capsuleDropFor(half: number, tune: FighterBody = FIGHTER_BODY, lift: number = tune.halfHeight): number {
  return tune.radius + half - lift;
}

/** Half the straight part of the collision capsule in a posture: the player's 1.6 m standing, 1.0 m low. */
export function capsuleHalfFor(posture: Posture, tune: FighterBody = FIGHTER_BODY): number {
  return posture === 'stand' ? tune.standHalf : tune.lowHalf;
}

/**
 * Where the rest of the game shoots at a body in a posture, over its feet -- and the **one** number
 * that must move with `capsuleHalfFor` and never without it (see `lowHalf`).
 *
 * Standing it is the fighter's own `halfHeight`, 0.9: half the 1.8 m *drawn* body, which is not the
 * 1.6 m collision capsule and never was. Low it is the middle of the low capsule itself,
 * `radius + lowHalf`, which is derived and not a second invented number: a body that is 1.0 m of
 * shell is aimed at 0.5 m up, so the aim point is inside the shell whatever `lowHalf` is moved to.
 */
export function aimPointFor(posture: Posture, tune: FighterBody = FIGHTER_BODY): number {
  return posture === 'stand' ? tune.halfHeight : tune.radius + tune.lowHalf;
}

/** How tall the collision capsule stands in a posture, feet to crown: what a bolt has to cross to find it. */
export function capsuleTopFor(posture: Posture, tune: FighterBody = FIGHTER_BODY): number {
  return 2 * (tune.radius + capsuleHalfFor(posture, tune));
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

/**
 * How low a body goes, and when. **Every number here is invented** -- the client has the postures,
 * the clips, the transitions and the twelve kneeling fires, and a `Cover` state and a `kneel`,
 * `prone` and `stand` command besides, but nothing anywhere in the archives computes, marks or
 * stores a position worth taking: cover was a server-side state and the server never shipped. So
 * when a body goes down is ours, and it is live through `__debug.fighters({ postures: { ... } })`.
 */
export interface PostureTune {
  /**
   * The least distance, in metres, at which a gunner holding its ground drops to a knee rather than
   * shooting standing. Closer than this it stays up: a body that runs into your face and then
   * kneels at arm's length reads as a bug rather than as cover.
   */
  kneelFrom: number;
  /**
   * The share of its health below which it lies down instead of kneeling, and the least range at
   * which it will. Both matter: below `FIGHTER_TUNE.fleeUnder` (0.25) a fighter's nerve breaks and
   * it runs rather than standing and shooting at all, so anything at or under that would never be
   * reached; and lying down with somebody a few metres away is not cover, it is a body that cannot
   * back off, since a prone body does not move at all (`paceInPosture`).
   */
  proneUnder: number;
  proneFrom: number;
  /**
   * The least seconds a body keeps a posture before it may take another. It is a **rate limit and
   * nothing more**: a fighter standing exactly on one of the numbers above would otherwise bob
   * between two postures a frame at a time, and this holds it to one change every `settle`.
   *
   * What it cannot do -- and a claim that it could is what let the stagger term stand in the rule
   * for a round -- is stop a change the rule *asks* for. Damped, a rule that answered "upright"
   * under fire simply alternated more slowly. If a posture is wrong, it has to be wrong in
   * `postureFor`; this number only says how often the answer may be acted on. A **forced** posture
   * ignores it outright.
   */
  settle: number;
}

export const POSTURE_TUNE: PostureTune = {
  kneelFrom: 6,
  proneUnder: 0.5,
  proneFrom: 10,
  settle: 0.6,
};

const POSTURE_FLOOR: Record<keyof PostureTune, number> = { kneelFrom: 0, proneUnder: 0, proneFrom: 0, settle: 0 };

/** Move the posture's numbers live; returns what is in force. */
export function tunePosture(opts?: Partial<PostureTune> | null): PostureTune {
  if (!opts) return POSTURE_TUNE;
  for (const key of Object.keys(POSTURE_TUNE) as (keyof PostureTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) POSTURE_TUNE[key] = Math.max(POSTURE_FLOOR[key], v);
  }
  return POSTURE_TUNE;
}

/**
 * What the posture is decided from. Every field is something the brain has already answered or the
 * body already knows, so nothing is measured twice and nothing is cast: `shooting` in particular is
 * the brain's own verdict (`state === 'attack'` with `attack === 'ranged'`), which already means
 * "in range, with a line", so the ray that established it is the one ray a thought already casts.
 * Primitives only, and the caller keeps one of these and writes into it.
 */
export interface PostureInput {
  /**
   * On its feet at all: in the air after a knock, thrown by the Force or held by a grip, it is not,
   * and each of those three writes `grounded = false` on the body itself.
   *
   * This is the **only** reason a blow stands a body up, and that is the whole of a lesson that
   * cost this rule its point once already. There used to be a `stunned` term beside it, and
   * `Npc.damage` sets a 0.2 s stagger on *every* hit, a single bolt included -- so a body went
   * upright the instant anybody shot at it, which is precisely and only the moment the cover is
   * for. The settle cannot damp that: it caps how often the posture may change, not whether a
   * forced change happens, so under steady fire a fighter merely alternated more slowly (shot
   * every 1.5 s, upright 36% of a ten-second firefight and a dozen changes of posture; shot five
   * times a second, upright for effectively all of it and never on a knee again). And the term
   * bought nothing the comment claimed for it, because a blow hard enough to stagger a body off
   * its feet -- a real knock, a throw, a grip -- already answers here.
   */
  grounded: boolean;
  /** A gun in hand. Nothing with a blade ever goes low: it has to close to 1.9 m to do anything. */
  gun: boolean;
  /** In a fight, or within the combat carry's own five seconds of one. */
  combat: boolean;
  /** The brain says it is shooting this instant: in range, with a line, and firing. */
  shooting: boolean;
  /** How far the thing it is fighting is, in metres; Infinity with nothing to fight. */
  gap: number;
  /** Its health as a share of what it started with. */
  hpRatio: number;
  /** The pace the brain asked for this frame, before the posture is allowed to cap it. */
  pace: 'stand' | 'walk' | 'run';
  /** Whether something outranks the posture outright: a long walk under orders. */
  held: boolean;
  /**
   * Whether this body can really be **drawn** lying down -- whether its rig holds any of the game's
   * own prone loops at all. It is a capability and not a preference, and the rule reads it because
   * the posture is a physical claim and not a pose: going prone drops the collision capsule to
   * 1.0 m and the point the whole game aims at to 0.5 m, so a body that answers no here and lies
   * down anyway is a figure standing bolt upright playing its standing idle while every shot in the
   * world is aimed at its shins. The kneel needs no such gate: its own fallback row ends in a crouch
   * idle, which is at least a low pose.
   */
  canProne: boolean;
  /** What it is in now, so a body already low moves low rather than standing straight up. */
  was: Posture;
  /**
   * Standing in cover it **cannot shoot out of** -- wave 6's one addition, and the only thing in
   * this rule that is about somewhere rather than about the body itself.
   *
   * It is deliberately narrow. Cover a body can shoot back out of is not here at all, because such
   * a body is shooting and rule 4 already puts it on a knee, which is a firing stance; this is the
   * other kind, where the search found that a bolt aimed at a standing chest *and* one aimed at a
   * crouched chest both stop short, so there is nothing to do from the spot but be behind it. That
   * is the one moment a body should go low with no shot to take, and going low there is a crouch
   * rather than a kneel because the crouch is the game's own low pose for a body that is not
   * fighting from it.
   *
   * Optional, and absent means false: every caller that knows nothing about cover -- the node
   * tests, and anything that ever asks this about the player -- is the body this rule always was.
   */
  covered?: boolean;
}

/**
 * How low it stands this frame. The rule is short on purpose, and every clause of it is either the
 * client's own data or a number named in `POSTURE_TUNE`:
 *
 * 1. Under orders, off its feet, out of a fight or holding anything but a gun: upright.
 *    A body under a long walk never goes down, which is the whole of "a prone body does not path".
 * 2. Asked to **run**: upright. Nobody runs low, and the game has no clip for it either.
 * 3. Not shooting: a body standing in cover it cannot shoot out of **ducks** -- the one place it
 *    goes low with no shot to take. Otherwise one asked to **walk** keeps whatever low posture it
 *    had and crouches, because the crouch is the game's own moving low pose; standing still it
 *    simply keeps what it has, so a fighter whose target has just died holds its firing position
 *    rather than springing up on that very frame and kneeling again a second later. The combat
 *    window ends it either way.
 * 4. Shooting and holding its ground: on a knee past `kneelFrom`, and flat past `proneFrom` once it
 *    is hurt past `proneUnder` and its rig can be drawn lying down. Nearer than `kneelFrom` it
 *    shoots standing.
 *
 * **Being shot at is not in this rule anywhere**, and that is the single most important thing about
 * it: see `PostureInput.grounded`. Only a blow that takes a body off its feet stands it up, because
 * bolts in the air are the whole reason the posture exists and a rule that answered "upright" to
 * one would hand back exactly what it was bought with.
 *
 * What is still **not** here: where to go. This rule says how low a body stands where it already
 * is and never moves one. `covered` is the one thing it has been told about what a body is standing
 * behind, and it is a single boolean the cover search answers rather than any knowledge of the
 * world -- the search, the spot and the walk to it are all `src/world/cover.ts` and
 * `Npc.stepCover`. It is also what the crouch was waiting for: before wave 6 the crouch was
 * reached only when a low body was asked to walk.
 */
export function postureFor(o: PostureInput, tune: PostureTune = POSTURE_TUNE): Posture {
  if (o.held || !o.grounded || !o.gun || !o.combat) return 'stand';
  if (o.pace === 'run') return 'stand';
  if (!o.shooting) return o.covered ? 'crouch' : o.pace === 'walk' ? (o.was === 'stand' ? 'stand' : 'crouch') : o.was;
  if (o.pace === 'walk') return o.was === 'stand' ? 'stand' : 'crouch';
  // Written as a refusal rather than a test so a distance that is not a number stands the body up
  // rather than kneeling it, which is the way round every other gate in this file is written.
  if (!(o.gap >= tune.kneelFrom)) return 'stand';
  if (o.canProne && o.hpRatio <= tune.proneUnder && o.gap >= tune.proneFrom) return 'prone';
  return 'kneel';
}

/**
 * What a posture lets a body do with the pace the brain asked for, which is the **client's own**
 * data and not an invention: the crouch's clip set is an idle and a walk, the kneel's is an idle
 * and no walk at all, and a prone body has no route anywhere in the state hierarchy except back up
 * through standing or kneeling.
 *
 * So a kneeling or prone body is held still rather than given a crawl the navigation could not
 * follow -- and the answer to "what does a prone fighter do when it is asked to go somewhere" is
 * that it **gets up first**: `postureFor` hands back a crouch or a stand the moment the pace is not
 * 'stand', and only then does this let it move. It never crawls, and no path is ever planned for a
 * body lying down, so nothing downstream has to be told that its width changed.
 */
export function paceInPosture(pace: 'stand' | 'walk' | 'run', posture: Posture): 'stand' | 'walk' | 'run' {
  if (posture === 'stand') return pace;
  if (posture === 'crouch') return pace === 'run' ? 'walk' : pace;
  return 'stand';
}

/**
 * The game's one-shot between two postures, in the order to try them: **the player's own
 * arithmetic** (`Player.postureTransition`), lifted here whole so a fighter and the player change
 * posture by the same names and a node test can drive it without a rig.
 *
 * `gun` is the kind of blaster in hand, or null for anything else and for a weapon that is not up;
 * `aimed` is whether the aimed set is wanted. A crouch is refused while moving, as the player
 * refuses it: those clips only play standing still.
 *
 * One of these names is **misspelt in the archives themselves** -- the aimed way down from lying to
 * kneeling spells its destination `kneleing` -- and the converter writes what the archives hold, so
 * the wrong spelling is asked for beside the right one rather than mended in a pack. The right name
 * is first, so a pack that ever carries it wins.
 */
export function postureTransitionNames(from: Posture, to: Posture, gun: 'pistol' | 'rifle' | null, aimed: boolean, moving: boolean): string[] {
  if (from === to) return [];
  if ((from === 'crouch' || to === 'crouch') && moving) return [];
  const f = POSTURE_WORD[from];
  const t = POSTURE_WORD[to];
  const names: string[] = [];
  if (gun && from !== 'crouch' && to !== 'crouch') {
    if (aimed) {
      names.push(`trn_${gun}_combat_${f}_aimed_to_${gun}_combat_${t}_aimed`);
      if (to === 'kneel') names.push(`trn_${gun}_combat_${f}_aimed_to_${gun}_combat_kneleing_aimed`);
    }
    names.push(`trn_${gun}_combat_${f}_to_${gun}_combat_${t}`);
  }
  names.push(`trn_${f}_to_${t}`);
  return names;
}

/**
 * Which of a rig's shots a body in a posture fires, in the order to try them -- again the player's
 * own (`Player.shootClip`), so that a fighter and the player fire the same clips.
 *
 * The kneeling row is the one worth saying out loud, because an earlier reading of the archives had
 * it the other way round and would have made an invention out of the game's own behaviour. The
 * shared body table declares **twelve kneeling fires**, six per weapon, with a ready and an aimed
 * kneel carry each; every one of them resolves and every file is in the retail archives. They were
 * invisible only because a direction selector's tag was read as three characters instead of four,
 * which deleted them from every converted rig. So a kneeling shooter is the game's own behaviour
 * with the game's own whole-body clips, and no additive recoil is wanted where a real clip exists.
 *
 * Prone takes the *aimed* shots for every shot, as the player does: the unaimed prone shots throw
 * the off hand about. It never asks for the additive **by name** either, since that recoil was
 * authored over a standing body -- though the last-resort row will take it, or anything else the
 * rig has, rather than leave a shot silent, which is again exactly what the player does. A crouch
 * has no shots at all and never asks: of the hierarchy's twelve crouch states not one carries a
 * fire, an attack, a throw or a heal, which is why a crouched body here does not shoot.
 */
export function firePatterns(kind: 'pistol' | 'rifle', posture: Posture): RegExp[] {
  if (posture === 'prone') {
    return [new RegExp(`^${kind}_(combat_)?prone_aimed_fire_\\d+$`), new RegExp(`^${kind}_(combat_)?prone(_aimed)?_fire_\\d+$`), new RegExp(`^(add_)?${kind}_(combat_)?(prone_|kneeling_|standing_)?fire_\\d+$`)];
  }
  if (posture === 'kneel') {
    return [new RegExp(`^${kind}_(combat_)?kneeling(_aimed)?_fire_\\d+$`), new RegExp(`^${kind}_kneeling_fire_\\d+$`), new RegExp(`^add_${kind}_fire_\\d+$`), new RegExp(`^(add_)?${kind}_(combat_)?(prone_|kneeling_|standing_)?fire_\\d+$`)];
  }
  return [new RegExp(`^${kind}_(combat_)?standing(_aimed)?_fire_\\d+$`), new RegExp(`^add_${kind}_fire_\\d+$`), new RegExp(`^(add_)?${kind}_(combat_)?(prone_|kneeling_|standing_)?fire_\\d+$`)];
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
