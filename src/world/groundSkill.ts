// How well a body on the ground fights, by tier -- the ground half of what `PILOT_SKILL`
// (`src/space/pilot.ts`) already is for a hand on a ship's stick, and written to be read beside it.
//
// **Every number here is invented.** The server fought the game's NPCs and none of it shipped: the
// archives carry the postures, the clips, a `Cover` state word and 139 commands gated on it, and
// nothing anywhere that says how fast a body reacts, how straight it shoots or when it stops
// pulling the trigger. So this is ours from end to end, it is one table so that it can be tuned in
// one place, and it is live through one knob -- `tuneGroundSkill`, which the game hangs on
// `__debug.fighters({ skill: { 1: { strafe: 0 } } })`.
//
// The knob **mutates each tier's object in place and never replaces it**, exactly as the pilots'
// does, because a body holds its tier's object from the moment it is made: replace the object and a
// change would reach only the bodies stood up afterwards.
//
// Five things a tier governs, which are the five the owner asked for:
//
//   - **whether it strafes at all** (`strafe`): the share of its speed a body will put sideways
//     while keeping its gun on you. Nought at the bottom two tiers, which is deliberate -- a body
//     that cannot strafe is the body this game has always had, so tier 1 and tier 2 are what a
//     fighter is today and the new movement is something the higher tiers earn.
//   - **how well it uses cover** (`coverEvery`, `coverWalk`, `hardCost`): how often it looks, how
//     far it will walk for a spot, and how much further it will walk to reach one it can shoot
//     back out of rather than one it can only hide behind.
//   - **its reaction time** (`reaction`).
//   - **its accuracy** (`scatterDeg`, `lead`).
//   - **its firing discipline** (`aimConeDeg`, `burst`, `burstGap`, `burstRest`).
//
// Pure: no three, no rapier, no browser, nothing allocated by any function here. Node's tests
// import it straight from source and drive the very functions the game runs.
//
// Where the numbers stand against the fighter this game already has (`FIGHTER_TUNE` in
// `src/world/npcs.ts`, which every fighter shares): its `think` is 0.4 s, its `aimCone` 0.5 rad
// (28.6 degrees), its `aimSpread` 0.03 rad (1.7 degrees) and its shot clock `gunEvery` 0.35 s with
// a 0.3 s spread and **no burst and no rest at all**, which is about two shots a second for ever
// and is exactly why a fighter reads as a machine. Today's body therefore sits at roughly tier 4
// for its reaction and tier 5 for its scatter and its rate of fire, and at no tier at all for its
// discipline, because it has none. The ladder is built around that so the middle of it is
// recognisably the game as it stands.

/** How well one tier of a ground fighter fights. Read beside `PilotSkill` in `src/space/pilot.ts`. */
export interface GroundSkill {
  /**
   * Seconds between thoughts: how long a body takes to notice that the world has changed. The
   * fighter's own `FIGHTER_TUNE.think` is 0.4, which is tier 4.
   */
  reaction: number;
  /**
   * The scatter on a shot, in degrees: the radius of the disc its aim is thrown about within. The
   * fighter's own `aimSpread` is 0.03 rad, 1.7 degrees, which is tier 5.
   */
  scatterDeg: number;
  /**
   * How far off its facing it will pull the trigger, in degrees. This is **discipline and not
   * accuracy**: a body with a narrow cone waits until it is really on you before it fires, and one
   * with a wide cone lets fly while it is still turning. The fighter's own `aimCone` is 0.5 rad,
   * 28.6 degrees, which is tier 3.
   */
  aimConeDeg: number;
  /**
   * The share of the full lead it takes on something that is moving, 0 to 1: nought is a body that
   * shoots at where you are and 1 is one that shoots at where you will be. The same field, and the
   * same meaning, as a pilot's.
   */
  lead: number;
  /** How many shots go in one burst; rounded, and never less than one. */
  burst: number;
  /** Seconds between the shots inside one burst, and seconds of quiet after the burst has run. */
  burstGap: number;
  burstRest: number;
  /**
   * The most of its own speed it will put **sideways** while keeping its gun on you, 0 to 1.
   *
   * It is a share of speed and the movement reads it as one: a body travelling at an angle `a` off
   * its own facing puts `sin a` of its speed sideways, so the slide's lean is held to `asin(strafe)`
   * (about 20, 37 and 58 degrees at the three tiers that have one), under the ceiling every body
   * shares (`GROUND_STEP.legMax`). It is worth saying because it was nearly a number that meant
   * nothing: the ring's own travel vector is normalised before the body walks it, so a tier written
   * only into that vector's length was divided straight back out and every sliding tier circled at
   * the same speed in the same direction, differing only in how often it did it.
   *
   * Nought means it never strafes, which is every body in this game today: facing and movement are
   * one number for a fighter and for a creature alike, so the only sidestep either has ever had is
   * a twist of the whole body. The two bottom tiers keep that on purpose -- they are the bodies the
   * owner already knows -- and only the top three earn the split.
   */
  strafe: number;
  /** Seconds between one look for cover and the next. A body that hardly ever looks uses cover badly. */
  coverEvery: number;
  /**
   * How far it will walk for a spot, in metres. It is also what the search is told to **reach**, so
   * a low tier is cheaper to think for as well as worse at it: it looks at less ground, finds fewer
   * blockers and casts fewer rays.
   */
  coverWalk: number;
  /**
   * How many extra metres of walk a spot it can shoot back out of is worth to it, against one it can
   * only hide behind.
   *
   * It is the one number in the table that reads backwards at first glance: it **rises** with the
   * tier, because knowing the difference between a firing position and a hole to cower in is the
   * skill. Nought is a body that takes the nearest thing to stand behind and cannot tell.
   */
  hardCost: number;
}

/**
 * Every tier's skill. **All invented**, and kept together to be tuned, exactly as `PILOT_SKILL` is.
 *
 * The ladder is monotone in every field -- there is no tier that is better at one thing and worse at
 * another, which is a deliberate simplicity and is what the node test pins. A body that is good at
 * one of these is good at all of them, and if the owner ever wants a wild shot who nevertheless
 * flanks well, that is a second axis and not a row of this table.
 */
export const GROUND_SKILL: Record<number, GroundSkill> = {
  1: { reaction: 1.0, scatterDeg: 6.0, aimConeDeg: 34, lead: 0, burst: 1, burstGap: 0.5, burstRest: 2.4, strafe: 0, coverEvery: 8, coverWalk: 3, hardCost: 0 },
  2: { reaction: 0.75, scatterDeg: 4.5, aimConeDeg: 32, lead: 0.25, burst: 2, burstGap: 0.42, burstRest: 2.0, strafe: 0, coverEvery: 5, coverWalk: 5, hardCost: 1.5 },
  3: { reaction: 0.55, scatterDeg: 3.2, aimConeDeg: 28.6, lead: 0.5, burst: 2, burstGap: 0.35, burstRest: 1.6, strafe: 0.35, coverEvery: 3, coverWalk: 8, hardCost: 3 },
  4: { reaction: 0.4, scatterDeg: 2.2, aimConeDeg: 22, lead: 0.75, burst: 3, burstGap: 0.3, burstRest: 1.3, strafe: 0.6, coverEvery: 2, coverWalk: 11, hardCost: 5 },
  5: { reaction: 0.28, scatterDeg: 1.2, aimConeDeg: 16, lead: 0.95, burst: 3, burstGap: 0.24, burstRest: 1.0, strafe: 0.85, coverEvery: 1.2, coverWalk: 14, hardCost: 8 },
};

/** How many tiers there are. A tier outside 1..`GROUND_TIERS` is clamped, never refused. */
export const GROUND_TIERS = 5;

/** Nothing in the table may go negative, and a burst of nought shots is not a burst. */
const SKILL_FLOOR: Record<keyof GroundSkill, number> = {
  reaction: 0,
  scatterDeg: 0,
  aimConeDeg: 0,
  lead: 0,
  burst: 1,
  burstGap: 0,
  burstRest: 0,
  strafe: 0,
  coverEvery: 0,
  coverWalk: 0,
  hardCost: 0,
};

/** And the two shares are shares: past one they mean nothing. */
const SKILL_CEILING: Partial<Record<keyof GroundSkill, number>> = { lead: 1, strafe: 1 };

/**
 * The numbers that are the *rule's* and not a tier's: when a strafe is worth taking at all, and how
 * much a thought's spacing is jittered so a line of bodies does not think as one. The jitter is the
 * fighter's own `FIGHTER_TUNE.thinkJitter` by value, kept here rather than imported so that this
 * module pulls in nothing.
 */
export interface GroundTune {
  /** Closer than this a body has nowhere to slide to and simply backs off; further than this a slide reads as a wobble. */
  strafeFrom: number;
  strafeTo: number;
  /** The share either way a thought's spacing is thrown about by. */
  jitter: number;
}

export const GROUND_TUNE: GroundTune = { strafeFrom: 3, strafeTo: 30, jitter: 0.25 };

const TUNE_FLOOR: Record<keyof GroundTune, number> = { strafeFrom: 0, strafeTo: 0, jitter: 0 };

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** A tier's skill, clamped to 1..`GROUND_TIERS` and rounded, as `skillOfTier` does for a pilot. */
export function skillOfGroundTier(tier: number): GroundSkill {
  const t = Number.isFinite(tier) ? Math.min(GROUND_TIERS, Math.max(1, Math.round(tier))) : 1;
  return GROUND_SKILL[t] ?? GROUND_SKILL[1];
}

/**
 * Move the tiers live, and read back the whole table. The one knob.
 *
 * `opts` is a tier number to the fields to change on it, which is the shape the pilots' knob already
 * takes (`__debug.flight({ npc: { 1: { stickMax: 0.8 } } })`). Each tier's **object is written in
 * place**: a body holds its own tier's object from the moment it is made, so a replacement would
 * reach nothing already standing. Anything that is not a finite number is left alone, so a typo in
 * the console cannot empty a row.
 *
 * `tune` moves the two rule numbers beside the table in the same call.
 */
export function tuneGroundSkill(opts?: (Partial<Record<number, Partial<GroundSkill>>> & { tune?: Partial<GroundTune> }) | null): Record<number, GroundSkill> {
  if (!opts) return GROUND_SKILL;
  const t = opts.tune;
  if (t) {
    for (const key of Object.keys(GROUND_TUNE) as (keyof GroundTune)[]) {
      const v = t[key];
      if (typeof v === 'number' && Number.isFinite(v)) GROUND_TUNE[key] = Math.max(TUNE_FLOOR[key], v);
    }
  }
  for (let tier = 1; tier <= GROUND_TIERS; tier++) {
    const row = (opts as Record<number, Partial<GroundSkill> | undefined>)[tier];
    const have = GROUND_SKILL[tier];
    if (!row || !have) continue;
    for (const key of Object.keys(have) as (keyof GroundSkill)[]) {
      const v = row[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const ceiling = SKILL_CEILING[key];
      have[key] = Math.min(ceiling ?? Infinity, Math.max(SKILL_FLOOR[key], v));
    }
  }
  return GROUND_SKILL;
}

/**
 * Seconds until this body's next thought: its tier's `reaction`, thrown about by `GROUND_TUNE.jitter`
 * either way so that a squad stood up on one frame does not go on thinking on one frame for ever.
 * `r01` is a number in 0..1 the caller draws; nothing here holds a generator.
 */
export function thinkEvery(skill: GroundSkill, r01: number): number {
  const r = Number.isFinite(r01) ? Math.min(1, Math.max(0, r01)) : 0.5;
  return Math.max(0, skill.reaction * (1 + (r * 2 - 1) * GROUND_TUNE.jitter));
}

/** Whether it will pull the trigger with the target this far off its facing, in radians. */
export function willFire(skill: GroundSkill, offNose: number): boolean {
  return Math.abs(offNose) <= skill.aimConeDeg * DEG;
}

/** The scatter thrown on one shot: a yaw and a pitch, in radians. Written into `out`, never made. */
export interface AimScatter {
  yaw: number;
  pitch: number;
}

/**
 * Throw one shot off by the tier's scatter. `r1` and `r2` are two numbers in 0..1 the caller draws.
 *
 * The scatter is **round and even over its disc**, which is why the magnitude is the square root of
 * `r2`: drawn straight, a shot would land near the middle far more often than the cone's area says
 * it should, and a tier's cone would mean something narrower than its number. Over a whole tier the
 * mean miss is two thirds of `scatterDeg` and the worst is exactly it, which the node test measures.
 */
export function aimScatter(skill: GroundSkill, r1: number, r2: number, out: AimScatter): AimScatter {
  const a = (Number.isFinite(r1) ? r1 : 0) * TAU;
  const mag = Math.sqrt(Math.min(1, Math.max(0, Number.isFinite(r2) ? r2 : 0))) * skill.scatterDeg * DEG;
  out.yaw = Math.cos(a) * mag;
  out.pitch = Math.sin(a) * mag;
  return out;
}

/**
 * A body's trigger, as the caller keeps it: one of these per body, written and never made.
 *
 * It is the mobiles' own shape rather than the fighters' -- a creature already fires one to three
 * shots a fifth of a second apart and then waits more than a second, while a fighter fires single
 * shots every 0.35 to 0.65 s for ever with no gap at all, which is the whole of why a fighter reads
 * as a machine and a creature does not.
 */
export interface FireClock {
  /** Seconds still to wait before the next pull. */
  wait: number;
  /** How many shots have gone in the burst now running. */
  shots: number;
}

/**
 * One step of the trigger: returns whether to fire **this step**, and moves the clock on. Call it
 * only on a step the body would shoot at all (in range, with a line, its nose on the target); a
 * body that has nothing to shoot at calls `fireReset` instead, or its burst would run down while it
 * stood there with nobody in front of it.
 *
 * The rhythm is `burst` shots `burstGap` apart, then `burstRest` of quiet, so a tier's rate of fire
 * out of this module is `burst / (burstGap * (burst - 1) + burstRest)` -- about 0.4 a second at
 * tier 1, 1.0 at tier 3 and 2.0 at tier 5, which is where today's flat 2-a-second fighter sits.
 *
 * That is an **upper bound and not what the game does**, and the difference is the slide. A body
 * sliding is walking, a walking body that was low is crouched (`postureFor`), and a crouched body
 * carries no action at all in the client's own data -- so the caller does not step this clock at
 * all while it slides, which is right (the burst is paused rather than run down) but costs the top
 * of the ladder more than the bottom, since the top slides oftener. Driven at 1/60 over twenty
 * minutes a tier with the duty cycle laid over it, the five rungs come to 0.41, 0.82, 0.85, 1.11
 * and 1.16 shots a second: still a ladder, but a much flatter one, and tiers 2 and 3 level with
 * each other. `GROUND_STEP.slideFor` and `flipEvery` are the two numbers that move it.
 */
export function fireStep(c: FireClock, skill: GroundSkill, dt: number): boolean {
  c.wait -= dt;
  if (c.wait > 0) return false;
  const n = Math.max(1, Math.round(skill.burst));
  c.shots++;
  if (c.shots >= n) {
    c.shots = 0;
    c.wait = skill.burstRest;
  } else {
    c.wait = skill.burstGap;
  }
  return true;
}

/**
 * Put the trigger back to the start of a burst, with `wait` seconds before the first pull. A body
 * that has just found something to shoot at should be given its tier's `reaction` here, so a slow
 * body is slow on the trigger as well as slow to think; a body that has lost its target should be
 * given nought, so it is ready the moment it finds another.
 */
export function fireReset(c: FireClock, wait = 0): void {
  c.shots = 0;
  c.wait = Math.max(0, wait);
}

/**
 * How much of its speed a body puts sideways this frame, 0 to 1: its tier's `strafe`, and nought
 * whenever a strafe would be pointless -- with nothing to keep the gun on, nearer than
 * `GROUND_TUNE.strafeFrom` (where there is nowhere to slide to and the body should be backing off
 * instead) or further than `GROUND_TUNE.strafeTo` (where sliding reads as a wobble rather than as
 * a move).
 *
 * The caller lays it across its travel as the sideways term, which while a body is still closing on
 * its ring makes a diagonal of `atan(share)`; on the ring the radial term is nought and the angle
 * would be a right angle, so the lean is capped at `asin(share)` there. Either way the share of the
 * speed that really goes sideways is this number, which is what it says it is.
 */
export function strafeShare(skill: GroundSkill, hasTarget: boolean, gap: number): number {
  if (!hasTarget || !(skill.strafe > 0)) return 0;
  if (!(gap >= GROUND_TUNE.strafeFrom) || !(gap <= GROUND_TUNE.strafeTo)) return 0;
  return Math.min(1, skill.strafe);
}

/** Whether it is time for this body to look for cover again. */
export function coverDue(skill: GroundSkill, since: number): boolean {
  return since >= skill.coverEvery;
}
