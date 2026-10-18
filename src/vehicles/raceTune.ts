// Every number of the race drive, in three tables: `RACE_TUNE` the rules, `RACE_BASE` the handling of a pod and of a
// racing bike (the bike made from the pod), `RACE_UPGRADES` what full upgrades do. All of it is ours, each number
// chosen for how it feels and said so beside it; the shapes it is used in (the speed curve, the boost, the lag) are
// Star Wars: Racer's pods', described in our own words in `raceMath.ts`. Everything moves live through
// `__debug.race`, but for the two ring sizes, which are read when a drive is made, and `CEILING_MOST`, which is the
// physics engine's limit and not a knob.
//
// Pure, so node loads it (`tools/swg/tests/raceMath.test.ts`).
import { bikeFromPod, copyBase, newBase, scaleSpeeds, type BikeSizes, type RaceBase, type RaceNumber, type RaceUpgrades } from './raceMath.ts';

/**
 * The most the pod's ceiling may be raised to, km/h: 380 m/s. The physics engine cuts every body at 400 m/s, the
 * drive holds the whole velocity under 399 keeping the vertical part first, and at 380 the height line still finds
 * the vertical room it needs on all but a few steps in a thousand. Past it is a wave of its own (a body's length
 * unit, or a hull moved by position).
 */
export const CEILING_MOST = 1368;
/**
 * The least the ceiling may be set to, km/h: a third of the owner's, as it always was, where a racing bike's own ceiling
 * (117 km/h there) still stands well over its traversal top, so racing is never slower than the traversal it leaves.
 */
export const CEILING_LEAST = 200;
/**
 * The owner's two ceilings, 350 km/h for a bike against 600 for a pod (he halved both after his first ride, keeping
 * the bike at the share of the pod it had): a constant, never worked out from the live ceilings.
 */
export const BIKE_SCALE = 350 / 600;
/** The pod's ceiling the base is written at, km/h (the owner's): the ceiling knob scales from it. */
export const CEILING_OWNER = 600;

export type RaceDriveRule = 'racer' | 'springs';
/**
 * How the hull is held to its line: 'loose' (the owner's after his first ride) never pulls it down harder than the
 * cushion's grip, and over its band only the world's gravity has it, so crests are jumps and dips are carried over;
 * 'firm' is the first ride's rule, held hard and falling fifteen times our gravity, kept to compare.
 */
export type RaceHoldRule = 'loose' | 'firm';

export const RACE_TUNE = {
  /** The pass's one switch: off, every vehicle drives, shows, sorts and is followed by the camera exactly as before. */
  on: true,
  /** 'racer' the race drive; 'springs' every pod and racing bike back on its springs, to compare. */
  drive: 'racer' as RaceDriveRule,
  /** 'table' the gallery's vehicles sorted by our table; 'names' by their names, as before (at the next spawn). */
  kinds: 'table' as 'table' | 'names',
  /** 'box' a racing vehicle collides as a box while it races; 'mesh' as its own hull always (at the next spawn). */
  hull: 'box' as 'box' | 'mesh',
  /** Every pod on one shared box, or each its own (at the next spawn). */
  podBox: 'shared' as 'shared' | 'own',
  /** Every bike-sized racing bike on one shared box, or each its own (at the next spawn). */
  bikeBox: 'class' as 'class' | 'own',
  /** A racing bike handles as the pod at bike speed ('pod'), or with a set of its own that bites and darts ('own'). */
  bike: 'pod' as 'pod' | 'own',
  /** A racing bike rides at its own heights, or at the pod's (smoother, and higher). */
  bikeHeights: 'own' as 'own' | 'pod',
  /** The race view and the mouse's heading target, or the orbit as it was (widened with speed). */
  view: 'race' as 'race' | 'orbit',
  /** The ground under the hull bridged over pits, or read as it is. */
  bridge: 'on' as 'on' | 'off',
  /** The hull held to its line loosely (crests jumped, dips carried over), or as firmly as the first ride held it. */
  hold: 'loose' as RaceHoldRule,
  /**
   * The loose hold: over its band the hull falls at the world's own gravity, so a jump off a crest lands where anything
   * thrown would (m/s²); and within its band the cushion settles it onto its ride but never pulls it down harder than
   * that same gravity (m/s²), so it rides gently rolling ground and a long descent close and with no bobbing, while
   * anything that falls away under it faster than a thrown thing would fall -- a crest, a lip, a hollow -- is flown over
   * rather than followed down and back up. Raised, the cushion grips harder and more of the ground is followed.
   */
  looseFall: 20,
  looseGrip: 20,
  /**
   * The upward speed the loose hold keeps (what a slope gave it, which only gravity takes back) is fed the rate of the
   * ground under the hull, taken up no faster than this (m/s²): four times the world's gravity, so a slope's rise is
   * kept within a fifth of a second and a crest after it is a jump, while a step's whole height read as one instant's
   * rise (a kerb, the far rim of a pit) is kept as a nudge rather than a launch.
   */
  looseFeed: 80,
  /** A terrain face outside a run: a wall that can crash, or a hard scrape that stops the vehicle. */
  offCourse: 'crash' as 'crash' | 'stop',
  /** Nose up and down from the view's tilt, built and off: a player looking up would lose speed for no reason they can see. */
  pitchFrom: 'off' as 'off' | 'view',
  /** The ground's own grip and speed: none yet, as the owner answered. */
  surfaces: 'none' as const,
  /**
   * Building rooms' sweep held above this speed, if the perf flight ever shows it costing frames (m/s). Not halved with
   * the pods' speeds: it is how fast the world streams past, which is the world's and not the drive's.
   */
  roomsBelow: 60,
  /** Nothing new stood or put away near the player racing faster than this (m/s): each new body is a clone and a compile. The world's, as above, so not halved. */
  livingAbove: 60,
  /** 'speed' the hold by `livingAbove`; 'always' and 'never' for measuring. */
  holdLiving: 'speed' as 'speed' | 'always' | 'never',
  /** The pod's ceiling in km/h (the owner's 600), held between `CEILING_LEAST` and `CEILING_MOST`; the bike's is it × 350/600. */
  ceiling: 600,
  /** 'cap' only the ceiling moves; 'all' every speed of both kinds scales with it. */
  ceilingMoves: 'cap' as 'cap' | 'all',
  /** The widest and the longest a vehicle may be to race on the shared bike box (m): the largest one-seat bikes, rounded up. */
  bikeSized: [1.5, 4.6] as [number, number],
  /** The most of the plain top the throttle reaches, so the air brake does not take for ever after a long straight. */
  thrustCap: 0.98,
  /** The thrust builds three times as fast while boosting: the boost is felt at once, not as a slow swell. */
  boostRate: 3,
  /** Under this speed S reverses rather than braking (m/s): a crawl, so the brake never throws it backwards. Halved with every speed. */
  reverseBelow: 1.5,
  /** The boost charges once past three-fifths of the plain top: a racing tool, not a launch (a share, so it follows the halved top by itself). */
  boostGate: 0.6,
  /** Half the boost's thrust in a quarter of a second, four-fifths in a second. */
  boostHalf: 0.25,
  /** Let go and the boost is under a tenth within half a second, so letting go is felt at once. */
  boostDecay: 0.1,
  /** After an overheat the boost is refused until the engines are back to this much cool (of 100). */
  readyAt: 40,
  /** A hull nobody drives brakes: down to walking pace within about four seconds and half a kilometre. */
  idleBrake: 0.4,
  /** The mouse's heading steers full past a fifth of a right angle off the nose, as every vehicle does today. */
  aimLock: 0.35,
  /** A stick this near the middle asks for no turn, so a resting mouse never weaves. */
  deadBand: 0.04,
  /** The yaw rate unwinds four times as fast as it builds while it is still turning the other way. */
  reverseFactor: 4,
  /** The travel's lag times these: a slide on Space, off the throttle, in the air, over water, and a scrape's kick for a moment. */
  slide: 4,
  offThrottle: 1.4,
  air: 6,
  water: 1.5,
  kick: 3,
  kickTime: 0.3,
  /** Those multipliers come on and off over about a second. */
  slideEase: 0.3,
  /** A lean is nine-tenths over in half a second. */
  leanEase: 0.22,
  /** Half a second of warning of a rise, the line raised halfway toward it, and its rate read a tenth of a second on. */
  lookAhead: 0.5,
  lookShare: 0.5,
  feedAhead: 0.1,
  /** The one ray ahead: within the colliders' reach, cast from this far over the hull, and taken only this near the cached ground. */
  rayReach: 140,
  rayAccept: 3,
  rayAbove: 60,
  /** The far grid's lattice points the walk keeps (read when a drive is made). */
  latticeRing: 16,
  /**
   * A pit crossed in under half a second is glided over: as wide in metres as a quarter of a second spanned at the
   * first ride's speeds (83 m at a full pod's ceiling), since the owner asked for more gliding and halving the speeds
   * would have halved the span; the ground sampled on the terrain's own pole spacing.
   */
  bridgeTime: 0.5,
  bridgeStep: 2,
  /** Samples kept behind the hull (read when a drive is made): enough for the widest span at the highest ceiling, both sides and a pod's length. */
  bridgeRing: 256,
  /** A lip up to half again the gap the hull keeps is popped over, never a wall. */
  lipShare: 1.5,
  /**
   * Speed a step may lose before it is a hit (m/s): half today's, so a glance is a hit at the same share of the speed
   * as before the speeds were halved.
   */
  hitLoss: 3,
  /** Three hard glances at full speed leave the hull at its floor: twice the first ride's a m/s, so the same share of speed costs the same hull. */
  scrapeHull: 0.3,
  /** A scrape is a felt stumble: the throttle cut for a moment, the command kept off the wall for as long. */
  scrapeCut: 0.2,
  scrapeHold: 0.2,
  /** Scrapes and strikes wear the hull to a quarter and no further: only a crash destroys. */
  wearFloor: 25,
  /** A crash throws the rider no harder than coming off a speeder today (m/s). */
  flingMost: 25,
  /** The race box takes nothing off the speed along a wall. */
  wallFriction: 0,
  /** Downhill strong (a tenth of the speed on a 10-degree descent held a second and a half), uphill gentle, nothing on ground near level, built over about a second and a half. */
  slopeDown: 3.5,
  slopeUp: 1.0,
  slopeFloor: 4,
  slopeEase: 0.65,
  /** The race view: a flick sets the heading at most this far ahead of the nose (rad), the ship cockpit's own. */
  steerLead: 0.6,
  /** The camera trails the hull by under five degrees in a turn at the cap and leans half the lead into it. */
  camLag: 0.15,
  camLook: 0.5,
  /** Thirty per cent further out at the ceiling, from three-tenths of it, falling back behind the widening. */
  camPull: 0.3,
  camPullEase: 0.6,
  pullFrom: 0.3,
  /** What blocks the view pulls it in at once and lets it out over half a second: today's chase's. */
  camOut: 0.5,
  /** The camera never stands closer behind the seat than the hull's own length behind it and this (m). */
  raceClear: 3,
  /** The third person's focus eases its height over most of a second while the pods' cockpits stand up and sit down. */
  eyeEase: 0.3,
  /** First person rolls with the pod's whole bank and lean, as the pilot's eyes do. */
  fpRoll: 1,
  /** The view widens sixteen degrees from three-tenths of the ceiling to the ceiling, over four-tenths of a second; the cascades refit every two degrees. */
  fovAdd: 16,
  fovFrom: 0.3,
  fovEase: 0.4,
  fovRefit: 2,
  /** The nose settles onto a rise in a sixth of a second and into a dip in a quarter, the roll in four-tenths. */
  pitchUp: 0.065,
  pitchDown: 0.11,
  roll: 0.17,
  /** In the air the roll levels over most of a second and the nose tips gently, never into a dive. */
  airRoll: 0.35,
  airNose: 12,
  airNoseMost: -20,
  /** Nose trims (off unless `pitchFrom` is 'view'): a noticeable trade, never a second boost. */
  trimThrottle: 1.2,
  trimTurn: 0.8,
  trimGlide: 0.5,
  trimDead: 0.15,
  trimFull: 0.6,
  /**
   * Another player's pod near yours: a nudge of the turn away from where it is drawn, never a collision (their hull is a
   * picture here, and passes through yours). 'off' leaves the turn as the stick asks.
   */
  nudge: 'on' as 'on' | 'off',
  /** How near another player's ride must be drawn before the turn is nudged from it (m): about a pod's length and a half. */
  nudgeReach: 20,
  /**
   * The most of the stick a ride drawn right beside yours takes, falling to nothing at the reach: a third, so a pilot
   * holding a line beside another feels it lean them off and can hold it with a little more stick.
   */
  nudgeStick: 0.35,
};

export type RaceTune = typeof RACE_TUNE;

/**
 * The pod: what a full pod handles by, stock where the upgrades start (§4, §5 of the design, every number ours). The
 * owner asked for both kinds' tops halved after his first ride (1,200 km/h for a full pod became 600), so every speed below is half
 * what the first ride had and says so; the times, rates, angles, shares, accelerations and heights are as they were,
 * so the pod reaches its top in the same seconds, turns at the same rate and rides at the same height; the hull a m/s
 * costs is doubled, so a scrape or a strike at the same share of the speed costs the same; and the lengths the ground
 * is judged over are as they were, so the same ground is a face or a rise too tall at the same share of the speed.
 */
const POD: RaceBase = {
  // A full pod's plain top is 486 km/h (halved), stock three-quarters of it; the boost adds a fifth of the ceiling on its own (halved).
  V: 135,
  BT: 37.5,
  cap: 600 / 3.6,
  stockTop: 0.75,
  // A stock pod reaches three-quarters of its top in about the time a straight gives you; let go at the top and it still carries half its speed ten seconds on.
  t75: 2.4,
  coast: 2.5,
  // From the top a stock air brake halves the speed in under five seconds.
  brake: 1.2,
  // The fastest it reverses, halved.
  reverseTop: 7.5,
  chargeTime: 0.8,
  // Six seconds of boost from cold, fifteen to cool when stock.
  boostSeconds: 6,
  coolSeconds: 15,
  // A stock pod visibly slides wide through a fast bend.
  tau: 0.3,
  // A quarter circle in about a second at full speed: the owner's maximum turn velocity, which nothing the mouse does
  // passes. Kept in degrees a second at the halved speeds, so the turn's radius halves with them; the steering's own
  // checks (a flick, a sweep, the trail) read the same.
  maxTurn: 95,
  // Its steering whole from a crawl on (halved).
  turnFullAt: 5,
  // A stock pod takes a third of a second to come fully into a turn.
  turnResponse: 280,
  // A heavy pod rolls into its turn over most of a second; a lean takes it two-thirds of the way onto its side, once it
  // is really moving (90 km/h, halved).
  bankMax: 60,
  bankEase: 0.35,
  leanMax: 65,
  leanFrom: 25,
  ride: 1.2,
  // The look-ahead walks the ground in four-metre steps to at most 80 m: half a second at a full pod's ceiling, as many
  // samples of the half-as-long reach as it took before (both halved with the speeds they are reached at).
  lookMax: 80,
  lookStep: 4,
  // Nine-tenths of a shortfall gone in under a third of a second; settles onto its height in a third with no overshoot.
  // The most it rises at, halved: a face is climbed in time at the same share of the speed as before.
  riseRate: 8,
  riseMax: 75,
  band: 3,
  bandRate: 7,
  // Held hard under the firm rule (`RACE_TUNE.hold`): a pod comes down fifteen times as hard as our gravity, so a crest
  // is a jump and it drops back fast. Its most, halved with the speeds.
  fall: 300,
  fallMax: 75,
  airborneAt: 6,
  sweepStep: 4,
  // A face is judged over eight metres, a rise ahead as it passes 24 m off the nose, the slope over the pod's own
  // length: lengths of the ground, not of the speed, so the same ground is judged alike at the halved speeds.
  faceLen: 8,
  climbLen: 24,
  climbGrade: 1.0,
  slopeLen: 16,
  // A bad landing is felt in the hull, and never costs more than a tenth of it: sparks and hurt from half the closing
  // speeds, the hull a m/s doubled.
  strikeSpark: 2,
  strikeHurt: 12.5,
  strikeHull: 1,
  strikeMost: 10,
  // Head on, any wall above 162 km/h destroys; at full speed a glance up to about 35 degrees is a scrape (halved, so a
  // wall is as dangerous at the same share of the speed).
  crashImpact: 45,
  crashDrop: 32.5,
  crashFrom: 45,
  // A stock pod mends a burnt-out engine part in about twelve seconds of holding the repair key, a full one in under three.
  repairRate: 0.08,
  // About the middle of the seven pods, which run from 5 to 11.4 m wide.
  box: [7, 3, 15],
};

/** A racing bike's own: its ride is today's bike's, and its box the one-seat bikes' middle sizes rounded up. */
export const RACE_BIKE_SIZES: BikeSizes = { ride: 0.65, band: 2, airborneAt: 3.5, sweepStep: 2, box: [1.0, 1.3, 3.6] };

/** `bike: 'own'`: a bike that bites and darts where the pod drifts, as today's bike against today's pod. */
export const RACE_BIKE_OWN: Partial<Record<RaceNumber, number>> = { tau: 0.14, maxTurn: 130, turnResponse: 400, bankMax: 50, bankEase: 0.14, leanMax: 55 };

/** The two bases. The bike is always the pod with every speed scaled by 350/600 and its own sizes laid over (`rebuildBikeBase`). */
export const RACE_BASE: { podracer: RaceBase; speederbike: RaceBase } = { podracer: POD, speederbike: bikeFromPod(POD, BIKE_SCALE, RACE_BIKE_SIZES, null, newBase()) };

/** The bike's base made again from the pod's, after the pod's moved. */
export function rebuildBikeBase(): void {
  bikeFromPod(RACE_BASE.podracer, BIKE_SCALE, RACE_BIKE_SIZES, null, RACE_BASE.speederbike);
}

/** What full upgrades do: traction on the lag, turning on the response, accel on the time to speed, top the share of `V`, airbrake, cooling and repair. */
export const RACE_UPGRADES: RaceUpgrades = { traction: 0.4, turning: 2.4, accel: 1 / 3, top: 1, airbrake: 0.6, cooling: 0.5, repair: 5 };

/** Raised whenever a number moves, so a drive builds its handling again on the next step and on no other. */
export const RACE_GEN = { n: 0 };

const scratch = newBase();

/**
 * The base a drive of a kind resolves its upgrades against, as the tune stands now: the bike's own set laid over
 * when `bike` is 'own', every speed of it scaled with the ceiling when `ceilingMoves` is 'all' (the vertical speeds
 * left) or only its ceiling when 'cap', and with `bikeHeights` 'pod' the pod's ride and band. At the owner's 600
 * every number is the base's own.
 */
export function baseFor(drive: 'pod' | 'bike', out: RaceBase): RaceBase {
  const k = RACE_TUNE.ceiling / CEILING_OWNER;
  copyBase(drive === 'pod' ? RACE_BASE.podracer : RACE_BASE.speederbike, scratch);
  if (drive === 'bike' && RACE_TUNE.bike === 'own') for (const key of Object.keys(RACE_BIKE_OWN) as RaceNumber[]) scratch[key] = RACE_BIKE_OWN[key]!;
  if (RACE_TUNE.ceilingMoves === 'all') scaleSpeeds(scratch, k, false, out);
  else {
    copyBase(scratch, out);
    out.cap = scratch.cap * k;
  }
  if (drive === 'bike' && RACE_TUNE.bikeHeights === 'pod') {
    out.ride = RACE_BASE.podracer.ride;
    out.band = RACE_BASE.podracer.band;
  }
  return out;
}

/** The choices each switch takes. */
const CHOICES: Partial<Record<keyof RaceTune, readonly (string | boolean)[]>> = {
  on: [true, false],
  drive: ['racer', 'springs'],
  kinds: ['table', 'names'],
  hull: ['box', 'mesh'],
  podBox: ['shared', 'own'],
  bikeBox: ['class', 'own'],
  bike: ['pod', 'own'],
  bikeHeights: ['own', 'pod'],
  view: ['race', 'orbit'],
  bridge: ['on', 'off'],
  hold: ['loose', 'firm'],
  offCourse: ['crash', 'stop'],
  pitchFrom: ['off', 'view'],
  surfaces: ['none'],
  holdLiving: ['speed', 'always', 'never'],
  ceilingMoves: ['cap', 'all'],
  nudge: ['on', 'off'],
};

/** The numbers kept within a range of their own; every other number is held finite and not below nought. */
const RANGES: Partial<Record<keyof RaceTune, [number, number]>> = {
  ceiling: [CEILING_LEAST, CEILING_MOST],
  thrustCap: [0.5, 0.995],
  boostGate: [0, 1],
  readyAt: [0, 100],
  lookShare: [0, 1],
  camLook: [0, 1],
  fpRoll: [0, 1],
  pullFrom: [0, 0.99],
  fovFrom: [0, 0.99],
  fovAdd: [0, 40],
  steerLead: [0.05, Math.PI],
  aimLock: [0.05, Math.PI],
  latticeRing: [4, 256],
  bridgeRing: [16, 1024],
  airNoseMost: [-89, 0],
  // A loose hull always comes down, and the cushion never pulls it toward the line harder than the firm fall would.
  looseFall: [1, 300],
  looseGrip: [0, 300],
  looseFeed: [0, 1000],
  nudgeReach: [0, 200],
  nudgeStick: [0, 1],
};

/** The switches read only when a vehicle is spawned or its drive made: the knob says so. */
const AT_SPAWN: readonly (keyof RaceTune)[] = ['kinds', 'hull', 'podBox', 'bikeBox', 'latticeRing', 'bridgeRing'];

/**
 * Move any of the rules live, each clamped to what makes sense; words for anything refused or held, and for what
 * waits for the next spawn. Every accepted change moves `RACE_GEN`, so every drive builds its handling again.
 */
export function tuneRace(patch: Partial<Record<keyof RaceTune, unknown>>): string[] {
  const words: string[] = [];
  const t = RACE_TUNE as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(RACE_TUNE, key)) {
      words.push(`no rule called ${key}`);
      continue;
    }
    const k = key as keyof RaceTune;
    const choices = CHOICES[k];
    if (choices) {
      if (!choices.includes(value as string | boolean)) {
        words.push(`${key} takes ${choices.join(' or ')}`);
        continue;
      }
      t[key] = value;
    } else if (k === 'bikeSized') {
      const v = value as unknown[];
      if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) {
        words.push('bikeSized takes [width, length] in metres');
        continue;
      }
      RACE_TUNE.bikeSized[0] = v[0] as number;
      RACE_TUNE.bikeSized[1] = v[1] as number;
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        words.push(`${key} takes a number`);
        continue;
      }
      const range = RANGES[k];
      let n = value;
      if (range) {
        if (k === 'ceiling' && n > CEILING_MOST) words.push(`past ${CEILING_MOST.toLocaleString('en')} km/h the physics engine's 400 m/s cut on a body and the hit test need a wave of their own: held at ${CEILING_MOST}`);
        if (k === 'ceiling' && n < CEILING_LEAST) words.push(`under ${CEILING_LEAST} km/h, a third of the owner's, a racing bike's ceiling sinks toward its traversal top: held at ${CEILING_LEAST}`);
        n = Math.min(range[1], Math.max(range[0], n));
      } else n = Math.max(0, n);
      t[key] = n;
    }
    if (AT_SPAWN.includes(k)) words.push(`${key} takes effect at the next spawn`);
  }
  RACE_GEN.n++;
  return words;
}

/** Any number of a base moved live: `race({ base: { podracer: { maxTurn: 80 } } })`. The bike follows the pod unless it is moved itself. */
export function tuneBase(patch: { podracer?: Partial<Record<RaceNumber, number>>; speederbike?: Partial<Record<RaceNumber, number>> }): string[] {
  const words: string[] = [];
  const apply = (base: RaceBase, p: Partial<Record<RaceNumber, number>> | undefined, name: string) => {
    for (const [key, value] of Object.entries(p ?? {})) {
      if (!Object.hasOwn(base, key) || key === 'box') {
        words.push(`${name} has no number called ${key}`);
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        words.push(`${name}.${key} takes a number not below nought`);
        continue;
      }
      base[key as RaceNumber] = value;
    }
  };
  apply(RACE_BASE.podracer, patch.podracer, 'podracer');
  // The bike is made from the pod again, then its own moves laid over.
  rebuildBikeBase();
  apply(RACE_BASE.speederbike, patch.speederbike, 'speederbike');
  RACE_GEN.n++;
  return words;
}

/** Any factor of the upgrades moved live. */
export function tuneUpgrades(patch: Partial<RaceUpgrades>): string[] {
  const words: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(RACE_UPGRADES, key)) {
      words.push(`no upgrade called ${key}`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      words.push(`${key} takes a number over nought`);
      continue;
    }
    RACE_UPGRADES[key as keyof RaceUpgrades] = value;
  }
  RACE_GEN.n++;
  return words;
}

/**
 * The hatch at load: `localStorage['swg.race'] = '0'` starts the session with the switch off, so nothing is built
 * differently. The storage is handed in and read in a try (a private window can refuse it); true when it turned off.
 */
export function readRaceHatch(get: () => string | null): boolean {
  let value: string | null = null;
  try {
    value = get();
  } catch {
    return false;
  }
  if (value !== '0') return false;
  RACE_TUNE.on = false;
  RACE_GEN.n++;
  return true;
}
