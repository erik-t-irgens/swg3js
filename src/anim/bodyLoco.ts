// What a body remembers from frame to frame for the speed classes, and the hand-over of each rule's answer to the
// body's update: the class Shift asks for and whether the walk key is down (locoClass.ts), the stamina that pays, the
// way the keys go and the table's clip for it (locoTable.ts), what the class moves the body at, how far the clip turns
// the body from the view and how far it has come round, the rate the clip plays at so its feet match the ground
// (locoPhase.ts), how long a change of the legs' clip fades, and which state the clip was last asked for.
//
// The player's update calls one method here at each of those moments and decides none of it itself, so the node test
// drives this very class over stand-in frames (locoBody.test.ts) and over the game's own rig (locoRig.test.ts). With
// the classes switched off, or on a rig without the imported clips, every method answers "as before" and the caller
// moves and animates the body by the rules it always had.
//
// Pure: no three.js and nothing of the page. Nothing here makes an object on a frame, and no number crosses a call
// on a frame's path: what a frame hands in rides its one kept record (`LocoIn`), and what it is handed back it reads
// off this record's fields (locoAlloc.test.ts measures it).

import { JOG, RUN, ShiftClass, SPRINT, Stamina } from './locoClass.ts';
import { CLASS_NAMES, CROUCH, DIRS, GAITS, GUN_UP, JOG_SLOT, MADE_CROUCHED, MADE_CROUCH_BACK, MADE_INJURED, PLAIN, POSTURE_KEYS, PRONE, SPEED_SLOTS, STAND, dirOf, fillSpeeds, gaitIndex, injuredPick, locoPick, posturePick, posturePicks, sideMode, tableClips, topClass, type LocoGait, type LocoPick } from './locoTable.ts';
import type { LocoTune } from './locoTune.ts';

/** The little of a rig this asks for: the game's `CharacterRig` is one. */
export interface LocoRig {
  has(clip: string): boolean;
  /**
   * The ground speed a clip's feet were made for on this figure: written into `speedOut`, m/s, with the answer
   * whether it is known. (A field and not an answer: a number handed back across a call is a number made.)
   */
  readSpeed(clip: string): boolean;
  speedOut: number;
}

/**
 * A frame of the body as the classes need it: one kept record the body writes before `plan`, and `ground` before
 * `legs`. A class, and every number that will hold a fraction declared as one: a record's numbers are then written
 * in place, frame after frame.
 */
export class LocoIn {
  dt = 0.5;
  /** The move keys: forward (+1) or back, right (+1) or left. */
  mz = 0;
  mx = 0;
  /** On its feet: not crouched, kneeling or prone (those keep their own rules until their own wave). */
  standing = true;
  grounded = true;
  swimming = false;
  /** Blocking, attacking or a swing under way: capped at the run. */
  fighting = false;
  /** A blaster aimed: capped at the jog. */
  aiming = false;
  /** One of the fight's keys (`SPRINT_ENDERS`) pressed or held this frame: under the tune's 'ends' it ends a sprint. */
  fightKeys = false;
  /** A blaster up, ready or aimed: with the tune's `gunSquare` the body stays square to the view (a diagonal plays its own jog clip at every class). */
  gunUp = false;
  /**
   * The kind of gun in hand, where the body carries one it has clips for (`GUN_CLASSES`' place: 0 pistol, 1 carbine,
   * 2 rifle, 3 heavy), or -1 for none: with no blaster up, what the tune's `gunCarry` says that kind plays.
   */
  gunClass = -1;
  /** The sprint's speed and the pool's size as the body's stats have them (the tune's own until something is earned). */
  sprint = 0.5;
  pool = 0.5;
  /** What Force Speed makes of the body's speed (1 without it): widens the top of the playback band. */
  boost = 1.5;
  /** How fast the body really moves over the ground, m/s: what the legs' clip is played against. */
  ground = 0.5;
  /** Crouched (the crouch key held) and prone, of the postures that are not standing (wave 2b): what the tune's `crouchRule` and `proneRule` take under the classes. */
  crouched = false;
  prone = false;
  /** The share of its health pool the body has (1 whole): under the tune's `injured.below` the walk is the injured walk. */
  hpShare = 1.5;
  /** The figure's own scale (its rig's root): what a game clip's `made` speed is scaled by. */
  scale = 1.5;
}

export function newLocoIn(): LocoIn {
  const f = new LocoIn();
  f.boost = 1;
  f.ground = 0;
  f.hpShare = 1;
  f.scale = 1;
  return f;
}

/** The rate and the fade a state is handed with the classes' clip, and the fade alone for a state whose clip keeps its own rate: kept records, written before each use. */
export class LegOpts {
  rate = 0.5;
  fade = 0.5;
}
export class FadeOpts {
  fade = 0.5;
}

/**
 * Under the tune's 'muted' (the rule before the owner's word of 2026-11-15), the actions that do nothing while the body
 * sprints: the attack, a gun's other trigger and the saber's throw (his first rule: sprinting, "you can't shoot or
 * attack, that way it always takes that animation"). Muted by action for the rest of each frame the sprint lasts
 * (`Input.mute`), before anything reads a key (`BodyLoco.mutes`). Left alone on purpose: the block, which caps the
 * sprint at the run while held; the other attack, which is a blaster's aim and caps it at the jog while held, so bare
 * hands' kick, on the same key, is refused by the brawl itself while the body sprints (src/combat/unarmed.ts); the
 * six ability keys; the jump. Under 'ends' nothing is muted.
 */
export const SPRINT_MUTES: readonly string[] = ['attack', 'altFire', 'saberThrow'];

/**
 * Under the tune's 'ends' (the default), the fight's keys that end a sprint, pressed or held: the attack, the other
 * attack (a blaster's aim, bare hands' kick), a gun's other trigger, the saber's throw and the block. The body drops
 * to the run on that frame, the press goes through, and only a fresh double tap of Shift sprints again. Never the six
 * ability keys or the jump.
 */
export const SPRINT_ENDERS: readonly string[] = ['attack', 'altAttack', 'altFire', 'saberThrow', 'block'];

/** The little of the input this asks: whether an action is held, and whether it went down this frame. */
export interface FightKeys {
  held(action: string): boolean;
  pressedAction(action: string): boolean;
}

/** Whether one of the fight's keys that end a sprint (`SPRINT_ENDERS`) is pressed or held this frame. */
export function fightKeysDown(input: FightKeys): boolean {
  for (let i = 0; i < SPRINT_ENDERS.length; i++) if (input.held(SPRINT_ENDERS[i]) || input.pressedAction(SPRINT_ENDERS[i])) return true;
  return false;
}

/** The kinds of gun `LocoIn.gunClass` numbers, in order. */
export const GUN_CLASSES = ['pistol', 'carbine', 'rifle', 'heavy'] as const;
/** A gun's kind as `LocoIn.gunClass` numbers it, -1 for anything else. */
export function gunClassIndex(cls: string): number {
  return cls === 'pistol' ? 0 : cls === 'carbine' ? 1 : cls === 'rifle' ? 2 : cls === 'heavy' ? 3 : -1;
}
/**
 * What a pace plays with a gun in hand out of combat (`BodyLoco.carry`): no gun, or one up (the ready or aimed pose
 * rides the imported legs as ever), and the tune's three choices (`LocoTune.gunCarry`).
 */
export const CARRY_NONE = -1, CARRY_SPLIT = 0, CARRY_FULL = 1, CARRY_ORIGINAL = 2;
/** A kind of gun's choice under a tune, as a number (`CARRY_*`). */
export function carryOf(tune: LocoTune, gunClass: number): number {
  const c = gunClass === 0 ? tune.gunCarry.pistol : gunClass === 1 ? tune.gunCarry.carbine : gunClass === 2 ? tune.gunCarry.rifle : gunClass === 3 ? tune.gunCarry.heavy : null;
  return c === 'full' ? CARRY_FULL : c === 'original' ? CARRY_ORIGINAL : c === 'split' ? CARRY_SPLIT : CARRY_NONE;
}
/** The share of the feet-locked rate a class's clip plays at (`LocoTune.rate.byClass`): the jog's for the tired jog. */
export function classShare(tune: LocoTune, cls: number): number {
  const b = tune.rate.byClass;
  return cls === 1 ? b.walk : cls === 2 ? b.jog : cls === 3 ? b.run : b.sprint;
}

/** The game's names for every clip the table can ask for: a rig has the classes only with all of them. */
const TABLE_CLIPS: readonly string[] = tableClips().map((id) => `mx_${id}`);
/**
 * Wave 2b's rows' clips, by what takes them: crouched, prone, each gait (by `GAITS`' place; the standard's none of its own),
 * and the injured walk. A rig without every clip of one walks as before there (crouched or prone as 7424bad did, the
 * standard gait, no injured walk), never a row with a clip missing.
 */
const unique = (list: string[]): readonly string[] => [...new Set(list)];
const CROUCH_NAMES = unique(posturePicks().filter((p) => p.posture === CROUCH).map((p) => p.clip));
const PRONE_NAMES = unique(posturePicks().filter((p) => p.posture === PRONE).map((p) => p.clip));
const GAIT_NAMES: readonly (readonly string[])[] = GAITS.map((_, g) => unique(g === 0 ? [] : DIRS.flatMap((_d, dir) => [0, 1, 2].map((side) => locoPick(dir, 1, false, PLAIN, GAITS[g], side)?.clip ?? '')).filter((c) => c && !TABLE_CLIPS.includes(c))));
const INJURED_NAME = injuredPick(0)!.clip;
function hasAll(rig: LocoRig, names: readonly string[]): boolean {
  for (let i = 0; i < names.length; i++) if (!rig.has(names[i])) return false;
  return true;
}

const RAD = Math.PI / 180;
/** What had the legs last frame, for the fade between that and what has them now. */
const LEGS_OTHER = 0, LEGS_LOCO = 1, LEGS_JKA = 2, LEGS_IDLE = 3;

export class BodyLoco {
  private readonly tune: LocoTune;
  private readonly shift = new ShiftClass();
  /** The tune's class speeds, read once a frame by name (`fillSpeeds`) and by a pick's own place from then on. */
  private readonly speeds = new Float64Array(SPEED_SLOTS);
  readonly stamina: Stamina;

  /** The classes are in force for this body this frame: the switch is on and its rig has every clip of the table. */
  on = false;
  /** The walk key is down. */
  walkOn = false;
  /** The class Shift asks for (2 to 4), and the class the body really moves at (1 to 4). */
  asked = JOG;
  cls = JOG;
  /** Why the class asked was not given, in words, or ''. */
  refused = '';
  /** The way the keys go (`DIRS`' index, -1 for none) and the table's clip for it at this class. */
  dir = -1;
  pick: LocoPick | null = null;
  /** The class's speed this frame, m/s, before Force Speed and the like. (Declared as a fraction, as every number below that a frame counts.) */
  speed = 0.5;
  /** The class speeds move the body this frame (on its feet, not swimming). */
  rules = false;
  /** A way is asked and the class's speed is the body's this frame: without one (standing, braking to a stop) the movement keeps the pace it always had. */
  moves = false;
  /** The imported clip has the legs this frame, and the body faces by it. */
  legsOn = false;
  /** How far the clip turns the body from the view, radians (+ left). */
  turn = 0.5;
  /** How far the body has come round to that, eased (first person takes it as it stands), and this frame's share of the way left (`face`). */
  turnNow = 0.5;
  turnStep = 0.5;
  /** The rate the clip plays at. */
  rate = 0.5;
  /** How long a change of the legs' clip fades this frame, seconds (`fadeFor`). */
  fadeNow = 0.5;
  /** Sprinting, on the ground or through a jump: under the tune's 'muted' the fight's keys do nothing meanwhile (`mutes`). */
  sprinting = false;
  /**
   * With a gun in hand and none up, what the tune's `gunCarry` has the pace play (`CARRY_*`); `CARRY_NONE` with no gun
   * or one up. Under `CARRY_ORIGINAL` the table's clip leaves the legs and the facing to the caller's old rules (the
   * game's own carry walk and run, the body turned the way it runs); under `CARRY_FULL` the caller hands the legs' clip
   * no upper body of its own.
   */
  carry = CARRY_NONE;
  /** The posture the classes rule this frame (`STAND`, or under the tune's `crouchRule` and `proneRule` 'classes', `CROUCH` or `PRONE`). */
  posture = STAND;
  /** The character's gait, as `GAITS`' place (`setGait`): the walk class's clips in it. */
  gait = 0;
  /** The walk this frame is the injured walk (`LocoTune.injured`). */
  injured = false;
  /** The rig has every clip of the crouched set, the prone set, the character's gait and the injured walk (`keys`). */
  crouchOn = false;
  proneOn = false;
  gaitOn = false;
  injuredOn = false;
  private boost = 1.5;
  private dt = 0.5;
  private legsWere = LEGS_OTHER;
  /** The state the classes' clip was last asked for, so the rig is told when they let go of it (`prefers`). */
  private preferred: string | null = null;

  constructor(tune: LocoTune) {
    this.tune = tune;
    this.stamina = new Stamina(tune.stamina.pool);
    fillSpeeds(tune, this.speeds);
    this.speed = tune.speed.forward.jog;
    this.turn = 0;
    this.turnNow = 0;
    this.turnStep = 1;
    this.rate = 1;
    this.fadeNow = tune.fade.idle;
    this.boost = 1;
    this.dt = 0;
  }

  /** Whether a rig has the classes: the switch on, and every clip the table can ask for on the rig. */
  enabled(rig: LocoRig | null): boolean {
    if (!this.tune.on || !rig) return false;
    for (let i = 0; i < TABLE_CLIPS.length; i++) if (!rig.has(TABLE_CLIPS[i])) return false;
    return true;
  }

  /**
   * The speed keys, first thing in the body's frame: Shift (held, and whether it went down this frame) and the walk
   * key (held). Answers whether the body walks by the rules it always had: with the classes off, either key held
   * (Shift walked before them); with them on, the walk key alone, which is all a crouch or a crawl reads of it.
   */
  keys(dt: number, shiftHeld: boolean, shiftPressed: boolean, walkHeld: boolean, rig: LocoRig | null): boolean {
    this.on = this.enabled(rig);
    // Which of wave 2b's rows this rig can play: each needs every clip of its own.
    this.crouchOn = this.on && hasAll(rig!, CROUCH_NAMES);
    this.proneOn = this.on && hasAll(rig!, PRONE_NAMES);
    this.gaitOn = this.on && hasAll(rig!, GAIT_NAMES[this.gait] ?? GAIT_NAMES[0]);
    this.injuredOn = this.on && rig!.has(INJURED_NAME);
    if (!this.on) {
      this.shift.reset();
      this.walkOn = false;
      this.asked = JOG;
      return shiftHeld || walkHeld;
    }
    this.asked = this.shift.advance(dt, shiftHeld, shiftPressed, this.tune);
    this.walkOn = walkHeld;
    return walkHeld;
  }

  /**
   * The frame's class, clip and speed, and the stamina's step. True when the classes rule the body this frame
   * (`speed`, to be multiplied by whatever multiplies the body's speed; `moves` says whether a way is asked); false
   * leaves the caller its own rule (the classes off, a crouch, a crawl, a kneel, the water).
   */
  plan(f: LocoIn): boolean {
    this.rules = false;
    this.moves = false;
    this.legsOn = false;
    this.sprinting = false;
    this.pick = null;
    this.refused = '';
    this.carry = CARRY_NONE;
    this.posture = STAND;
    this.injured = false;
    this.boost = f.boost;
    this.dt = f.dt;
    const tune = this.tune;
    if (!this.on) {
      // Off: the pool is simply full, and its bar down.
      this.stamina.fill(f.pool);
      this.dir = -1;
      this.turn = 0;
      return false;
    }
    const dir = dirOf(f.mz, f.mx);
    this.dir = dir;
    const afloat = !f.grounded || f.swimming;
    if (!f.standing || f.swimming) {
      // Crouched or prone under the classes (wave 2b): three classes of their own (`posture`).
      if (!f.swimming && (f.prone ? this.proneOn && tune.proneRule === 'classes' : f.crouched && this.crouchOn && tune.crouchRule === 'classes')) return this.posturePlan(f, dir, afloat);
      // Crouched, kneeling, prone or swimming: the body moves by its own rules, and the pool regains as a walk does.
      this.cls = 1;
      this.turn = 0;
      this.stamina.stepFor(f, tune, dir, 1, afloat);
      return false;
    }
    let cls = this.asked;
    if (this.walkOn) {
      cls = 1;
      this.refused = this.asked > JOG ? 'the walk key holds the walk' : '';
    } else {
      if (f.fightKeys && cls > RUN && tune.sprintFight === 'ends') {
        // A fight's key ends the sprint asked for, on this very frame (the press goes through: nothing is muted), and
        // the sprint does not come back by itself: Shift, still held, gives the run, and a fresh double tap sprints. A
        // let-go of Shift from before the key is forgotten, so one press just after it is no double tap.
        cls = RUN;
        this.asked = RUN;
        this.shift.cap(RUN);
        this.shift.forgetLetGo();
        this.refused = 'a fight key ended the sprint: Shift held runs, a fresh double tap sprints again';
      }
      if (this.stamina.tired && cls > JOG) {
        cls = JOG;
        this.refused = 'tired: no run until the stamina is back';
        // The sprint does not come back by itself once the body has rested: Shift, still held, gives the run.
        this.shift.cap(RUN);
      }
      if (f.aiming && cls > JOG) {
        cls = JOG;
        this.refused = 'a blaster aimed: no faster than the jog';
      }
      if (f.fighting && cls > RUN) {
        cls = RUN;
        this.refused = 'blocking or attacking: no faster than the run';
      }
      if (dir >= 0 && cls > topClass(dir)) {
        cls = topClass(dir);
        this.refused = 'only forward sprints: the run';
      }
    }
    const gun = (f.aiming || f.gunUp) && tune.gunSquare ? GUN_UP : PLAIN;
    let pick = locoPick(dir, cls, this.stamina.tired, gun, this.gaitOn ? GAITS[this.gait] : 'standard', sideMode(tune));
    // Walking hurt (`LocoTune.injured`): the walk class forward and to the sides, with no blaster up, is the injured walk.
    const hurt = pick !== null && pick.cls === 1 && this.injuredOn && tune.injured.rule === 'walk' && f.hpShare < tune.injured.below && !f.aiming && !f.gunUp ? injuredPick(dir) : null;
    if (hurt) {
      pick = hurt;
      this.injured = true;
    }
    this.pick = pick;
    // A gun in hand with none up: what its kind's pace plays (none up means out of combat: no aim, no shot).
    if (f.gunClass >= 0 && !f.gunUp && !f.aiming) this.carry = carryOf(tune, f.gunClass);
    this.cls = pick ? pick.cls : cls;
    // The class's speed by its dial; the sprint's is the stats' (the tune's own until something is earned); standing still, the jog's.
    fillSpeeds(tune, this.speeds);
    this.speed = pick ? (pick.cls === SPRINT ? f.sprint : hurt ? tune.injured.speed : this.speeds[pick.slot]) : this.speeds[JOG_SLOT];
    this.turn = pick ? pick.turn * RAD : 0;
    // In the air too: a jump out of a sprint is still the sprint, and the fight's keys stay down through it.
    this.sprinting = pick !== null && pick.cls === SPRINT;
    this.stamina.stepFor(f, tune, dir, this.cls, afloat);
    this.rules = true;
    this.moves = pick !== null;
    return true;
  }

  /**
   * Crouched or prone under the classes (wave 2b): Alt held the slowest class, nothing held the middle, Shift held (or a
   * double tap) the quickest, and no sprint. The class's clip for the way (`posturePick`), its speed by the tune's dials
   * (crouched backing up its own), the turn the clip asks of the body, and the pool's step by the class.
   */
  private posturePlan(f: LocoIn, dir: number, afloat: boolean): boolean {
    const tune = this.tune;
    const prone = f.prone;
    const posture = prone ? PRONE : CROUCH;
    this.posture = posture;
    let cls = this.walkOn ? 1 : this.asked >= RUN ? 3 : 2;
    if (this.asked > RUN && !this.walkOn) this.refused = prone ? 'no sprint prone: the quickest crawl' : 'no sprint crouched: the quickest crouch';
    if (this.walkOn && this.asked > JOG) this.refused = 'the walk key holds the slowest';
    if (this.stamina.tired && cls > 2) {
      cls = 2;
      this.refused = 'tired: not the quickest until the stamina is back';
      this.shift.cap(RUN);
    }
    // Backing up prone under 'reverse', the forward crawl backwards; with a gun in hand its own carries crawl, as ever.
    const pick = posturePick(posture, dir, cls, prone && tune.proneBack === 'reverse' && f.gunClass < 0);
    this.pick = pick;
    this.cls = cls;
    const g = prone ? tune.prone.forward : dir >= 3 && dir <= 5 ? tune.crouch.back : tune.crouch.forward;
    this.speed = cls === 1 ? g.slow : cls === 2 ? g.normal : g.fast;
    this.turn = pick ? pick.turn * RAD : 0;
    this.stamina.stepPosture(f, tune, prone, cls, afloat);
    this.rules = true;
    this.moves = pick !== null;
    return true;
  }

  /** The character's gait (`GAITS`' word; anything else is the standard): the walk class's clips from the next frame. */
  setGait(gait: LocoGait | string | null | undefined): void {
    this.gait = gaitIndex(gait);
  }

  /**
   * A frame in which the body is not on its feet under the classes at all: riding or piloting from a seat, flying in
   * noclip or the world editor, adrift in space, dead. Nothing sprints (so the fight's keys are never left muted by a
   * sprint the body was in as it sat down), no clip of the classes has the legs, the class Shift had asked for is
   * forgotten, and the pool regains as it does standing. `dt` nought only puts the record down.
   */
  idle(dt: number, pool: number): void {
    this.rules = false;
    this.moves = false;
    this.legsOn = false;
    this.sprinting = false;
    this.pick = null;
    this.refused = '';
    this.carry = CARRY_NONE;
    this.posture = STAND;
    this.injured = false;
    this.dir = -1;
    this.turn = 0;
    this.turnNow = 0;
    this.walkOn = false;
    this.asked = JOG;
    this.cls = JOG;
    this.shift.reset();
    if (!this.tune.on) this.stamina.fill(pool);
    else if (dt > 0) this.stamina.rest(dt, pool, this.tune);
  }

  /**
   * The legs' clip for this frame, or null for the caller's own: asked where the body's update picks what the rig
   * plays, with `f.ground` how fast the body really moves and `jka` Jedi Academy's animations in charge (its legs
   * stay under a block or a swing). Sets the rate the clip plays at: the ground speed over the speed the clip's feet
   * were made for, held inside the tune's band (`rateFor`'s own lines, written out).
   */
  legs(rig: LocoRig | null, f: LocoIn, jka: boolean): LocoPick | null {
    const pick = this.pick;
    this.legsOn = false;
    // A gun's 'original' carry: the game's own carry walk and run have the legs, by the caller's old rule.
    if (!this.rules || !pick || jka || !rig || this.carry === CARRY_ORIGINAL || !rig.has(pick.clip)) return null;
    // Prone with a gun in hand: the gun's own prone carries keep the legs, at the class's speed (the imported crawls hold no gun).
    if (pick.posture === PRONE && f.gunClass >= 0) return null;
    let rate = 1;
    // The speed the clip's feet were made for: a game clip the tune has measured (`made`) at the figure's own scale, else the rig's.
    let natural = 0;
    if (pick.made >= 0) {
      const m = this.tune.made;
      natural = (pick.made === MADE_CROUCHED ? m.crouched : pick.made === MADE_CROUCH_BACK ? m.crouchBack : pick.made === MADE_INJURED ? m.injuredWalk : m.gameWalk) * f.scale;
    } else if (rig.readSpeed(pick.clip)) natural = rig.speedOut;
    if (natural > 0) {
      const band = this.tune.rate;
      const top = band.max * (this.boost > 1 ? this.boost : 1);
      // The class's share of the feet-locked rate (`rate.byClass`, 1 locked): written out, so no number crosses a call.
      const by = band.byClass;
      const c = pick.cls;
      const share = c === 1 ? by.walk : c === 2 ? by.jog : c === 3 ? by.run : by.sprint;
      const r = (f.ground / (natural * band.feet)) * share;
      rate = r < band.min ? band.min : r > top ? top : r;
    }
    // The prone crawl backing up under 'reverse': the forward crawl played backwards.
    this.rate = pick.reverse ? -rate : rate;
    this.legsOn = true;
    return pick;
  }

  /**
   * Whether the body faces by the table this frame (the view's way plus the clip's turn), rather than the way it runs.
   * Prone it never does (no strafing crawl: the body turns the way it crawls), but backing up under 'reverse'.
   */
  faces(jka: boolean): boolean {
    if (this.posture === PRONE) return this.rules && this.pick !== null && this.pick.reverse && !jka;
    return this.rules && this.pick !== null && !jka && this.carry !== CARRY_ORIGINAL;
  }

  /**
   * The body's turn eased toward the clip's (`faces`: the body faces by the table this frame; else toward none):
   * `turnNow` is where it has got to, and `turnStep` the share of whatever is left that this frame takes, which is
   * what the caller turns the body's heading by. An exponential of the frame's own seconds, so the body comes round
   * alike at any frame rate.
   */
  face(faces: boolean): void {
    const k = 1 - Math.exp(-this.dt * this.tune.turn.rate);
    this.turnStep = k;
    this.turnNow += ((faces ? this.turn : 0) - this.turnNow) * k;
  }

  /**
   * How long this frame's change of the legs' clip fades, into `fadeNow`: between two of the classes' clips the
   * tune's `loco` (in step), into and out of Jedi Academy's legs its `jka`, and to and from standing (or anything
   * else) its `idle`. `legs`: the classes' clip has them; `jka`: that game's animations are in charge; `moving`.
   */
  fadeFor(legs: boolean, jka: boolean, moving: boolean): void {
    const are = legs ? LEGS_LOCO : jka ? LEGS_JKA : !moving ? LEGS_IDLE : LEGS_OTHER;
    const fades = this.tune.fade;
    this.fadeNow = are === LEGS_JKA || this.legsWere === LEGS_JKA ? fades.jka : are === LEGS_LOCO && this.legsWere === LEGS_LOCO ? fades.loco : fades.idle;
    this.legsWere = are;
  }

  /**
   * The state the classes' clip is asked for this frame (null: none). Answers the state it was last asked for when
   * that is another, which the caller then takes the clip off (and has the rig pick that state's own clip again).
   */
  prefers(state: string | null): string | null {
    const was = this.preferred;
    this.preferred = state;
    return was !== null && was !== state ? was : null;
  }

  /**
   * The actions to mute for the rest of this frame, before anything reads a key (main.ts's `stepSprintKeys`, from the
   * frame loop and `__debug.advance` alike): under the tune's 'muted' the sprint's own (`SPRINT_MUTES`) while the body
   * sprints, as the rule before; under 'ends' none, ever (a fight's key ends the sprint in `plan` instead), so null.
   */
  mutes(): readonly string[] | null {
    return this.tune.sprintFight === 'muted' && this.sprinting ? SPRINT_MUTES : null;
  }

  /** The pool full again and the class asked forgotten: a respawn, an arrival. */
  refill(pool: number): void {
    this.stamina.fill(pool);
    this.shift.reset();
    this.asked = JOG;
    this.sprinting = false;
  }

  /** `__debug.loco()`'s account of the body. Console only: it makes an object. */
  report(pool: number): Record<string, unknown> {
    const n = (v: number, d = 2) => Number(v.toFixed(d));
    return {
      on: this.on,
      rules: this.rules,
      legs: this.legsOn,
      // Crouched and prone the classes are named as the dials name them (slow, normal, fast).
      class: this.posture !== STAND ? POSTURE_KEYS[this.cls] : (CLASS_NAMES[this.cls] ?? this.cls),
      asked: CLASS_NAMES[this.asked] ?? this.asked,
      walkKey: this.walkOn,
      refused: this.refused || null,
      direction: this.dir >= 0 ? DIRS[this.dir] : null,
      clip: this.pick?.clip ?? null,
      state: this.pick?.state ?? null,
      speed: n(this.speed),
      rate: n(this.rate, 3),
      bodyTurnDeg: n(this.turn / RAD, 1),
      bodyTurnNowDeg: n(this.turnNow / RAD, 1),
      fade: n(this.fadeNow, 3),
      sprinting: this.sprinting,
      sprintFight: this.tune.sprintFight,
      sideWalkClip: this.tune.sideWalkClip,
      gunCarry: this.carry === CARRY_FULL ? 'full' : this.carry === CARRY_ORIGINAL ? 'original' : this.carry === CARRY_SPLIT ? 'split' : null,
      share: this.pick ? n(classShare(this.tune, this.pick.cls), 3) : null,
      posture: this.posture === CROUCH ? 'crouched' : this.posture === PRONE ? 'prone' : 'standing',
      crouchRule: this.tune.crouchRule,
      proneRule: this.tune.proneRule,
      proneBack: this.tune.proneBack,
      reverse: this.pick?.reverse ?? false,
      gait: GAITS[this.gait],
      injured: this.injured,
      injuredRule: this.tune.injured.rule,
      stamina: { value: n(this.stamina.value, 1), pool: n(pool, 1), tired: this.stamina.tired, shown: this.stamina.shown(pool, this.tune) },
    };
  }
}
