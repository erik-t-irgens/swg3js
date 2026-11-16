// Another player's legs. Nothing new crosses the wire for the speed classes: a figure's state, heading and speed are
// what they always were, and its velocity is worked out from the places it was heard at. From those the table gives
// the very clip the sender's own game plays (`peerPickIn`, locoTable.ts): how the travel lies against the heading sent
// says which way the clip's feet go, and the speed which class.
//
// One of these is kept a figure. It holds the pick steady for a moment before changing class, since a body gathering
// speed passes through the slower classes' speeds for a message or two; keeps the legs' way until the travel lies
// clearly nearer another clip's (a slope or a wall turns a body's travel a few degrees from its heading); and works
// out the rate the clip plays at.
//
// Pure: `RemotePlayers` calls `resolve` each frame for each figure on foot, and the node test calls the same. Nothing
// is made on a frame and no number crosses a call: what a frame hands in rides one kept record (`PeerIn`), and the
// rate is read off this record (locoAlloc.test.ts measures it).

import { CARRY_ORIGINAL, carryOf, type LocoRig } from './bodyLoco.ts';
import { CROUCH, MADE_CROUCHED, MADE_CROUCH_BACK, MADE_INJURED, MADE_STAIRS_DOWN, MADE_STAIRS_RUN_DOWN, MADE_STAIRS_RUN_UP, MADE_STAIRS_UP, PRONE, PeerAsk, SPEED_SLOTS, STAND, fillSpeeds, peerLocoState, peerPickIn, posturePick, sideMode, stairPick, stairWay, type LocoPick } from './locoTable.ts';
import type { LocoTune } from './locoTune.ts';
import { cycleKindOf, isStairPick, stairCyclePick } from './locoTable.ts';
import type { StairCycleFacts } from './stairCycle.ts';
import { StairStep, StairStepIn } from './stairStep.ts';

const DEG = 180 / Math.PI;

/** A frame of a figure as its legs need it: one kept record, written by the caller before `resolve`. (Declared as fractions.) */
export class PeerIn {
  /** The figure's velocity as it was heard, m/s. */
  vx = 0.5;
  vz = 0.5;
  /** The heading its game sent, radians, and how fast it says it goes, m/s. */
  heading = 0.5;
  speed = 0.5;
  /** The frame's seconds. */
  dt = 0.5;
  /** Their gait as their hello says it (`GAITS`' place; 0 the standard, and anything a hello from before says nothing of). */
  gait = 0;
  /** The share of their health pool they have, where this side hears it (1 whole, and wherever it does not). */
  hpShare = 1.5;
  /** The figure's own scale (its rig's root): what a game clip's `made` speed is scaled by. */
  scale = 1.5;
  /** Wave 3: the stairs their figure stands on, as this side's own stairs rule holds them from where it stands (+1 up its travel, -1 down, 0 none). */
  stairs = 0;
  /**
   * The stairs wave: this side's measure of the stairs under them (src/player/stairSense.ts), how far their figure went
   * along them since last frame, metres (their own distance, as drawn here), and their legs' clip's time now (NaN: not
   * playing it yet): one step a stair driven by their own distance, as this side drives its own.
   */
  stairKnown = false;
  stairTread = 0.5;
  stairRiser = 0.5;
  stairNext = 0.5;
  stairMoved = 0.5;
  legTime = 0.5;
  /** The clip `legTime` is the time of ('' for none): a pick of another clip this frame starts its own (its time NaN). */
  legClip = '';
  /** How far behind their middle the last riser stands (NaN: none), metres. */
  stairPrev = 0.5;
  /** The foot their feet had planted furthest along the travel last frame (0 left, 1 right, -1 none) and its ankle's place along it from their middle, metres: what a stair clip taken on keeps where it stands. */
  stairLead = -1;
  stairLeadAt = 0.5;
}

/** The tune's class speeds, read by name once a call and by a pick's own place from there (one array for every figure: a call fills it before it reads it). */
const SPEEDS = new Float64Array(SPEED_SLOTS);

export class PeerLoco {
  /** The clip the figure's legs play, or null for the state's own. */
  pick: LocoPick | null = null;
  /** The rate it plays at. (Declared as a fraction.) */
  rate = 0.5;
  /** How the figure's travel lay against its heading at the last frame it moved, degrees (+ left): what a rig without the table's clips reads for a figure going backward. */
  rel = 0.5;
  /** A pick that would replace the one playing, and how long it has stood. */
  private next: LocoPick | null = null;
  private nextFor = 0.5;
  private readonly ask = new PeerAsk();
  /** The stairs wave: their one step a stair (`stairs.stepRule` 'stairs'), the facts it is driven by (null: none), and a time to start their legs' clip at (NaN: none). */
  readonly step = new StairStep();
  stepFacts: StairCycleFacts | null = null;
  snap = 0.5;
  private readonly stepIn = new StairStepIn();

  constructor() {
    this.rate = 1;
    this.rel = 0;
    this.nextFor = 0;
    this.snap = Number.NaN;
  }

  /**
   * The frame's answer: `state` as the peer's game sent it, and in `f` the figure's velocity as it was heard, the
   * heading and the speed sent and the frame's seconds. Null (and nothing kept) for a state that is no walk or run
   * on foot, with the classes off, or on a rig without the clip: the caller plays the state's own clip, as before.
   */
  resolve(tune: LocoTune, rig: LocoRig, state: string, f: PeerIn): LocoPick | null {
    // Crouched or prone (wave 2b): the states every build sends there, worked out under this side's own rules.
    const posture = state === 'crouchWalk' || state === 'crouchWalkBack' ? CROUCH : state === 'proneMove' ? PRONE : STAND;
    const postureOn = posture === CROUCH ? tune.crouchRule === 'classes' : posture === PRONE && tune.proneRule === 'classes';
    if ((!postureOn && !peerLocoState(state)) || !(f.speed > 0.05)) {
      this.rel = 0;
      return this.drop();
    }
    // The travel against the heading, degrees (+ left); a figure heard at only one place yet is taken to go forward,
    // and one that says it moves while it is heard standing (pressed to a wall it went into) keeps the way its legs
    // last went, as its own game plays it.
    const moving = f.vx * f.vx + f.vz * f.vz > 0.09;
    let rel = 0;
    if (moving) {
      const a = (Math.atan2(f.vx, f.vz) - f.heading) * DEG;
      rel = ((((a + 180) % 360) + 360) % 360) - 180;
    } else if (this.pick) rel = this.pick.heading;
    this.rel = rel;
    if (!tune.on) return this.drop();
    if (posture !== STAND) return this.postureLegs(tune, rig, posture, state === 'crouchWalkBack', f);
    if (moving) {
      // The legs keep the way they go until the travel lies clearly nearer another clip's: ground that deflects a body
      // (a slope climbed across, a wall slid along) turns its travel a few degrees, and must not flick the legs.
      if (this.pick) {
        const off = ((((rel - this.pick.heading + 180) % 360) + 360) % 360) - 180;
        if ((off < 0 ? -off : off) < 22.5 + tune.peer.hold) rel = this.pick.heading;
      }
    }
    fillSpeeds(tune, SPEEDS);
    this.ask.rel = rel;
    this.ask.speed = f.speed;
    // The sideways walk as this player's own tune has it: their game sends nothing of the choice (a figure walking
    // sideways is drawn by the clip this side would play for the travel against the heading it sent).
    this.ask.side = sideMode(tune);
    // Their gait out of their hello, and walking hurt where this side hears their health (wave 2b); a rig without the
    // clip for either shows the standard walk.
    this.ask.gait = f.gait;
    this.ask.injured = tune.injured.rule === 'walk' && f.hpShare < tune.injured.below;
    let found = peerPickIn(SPEEDS, state, this.ask);
    if (found && !rig.has(found.clip) && (this.ask.gait > 0 || this.ask.injured)) {
      this.ask.gait = 0;
      this.ask.injured = false;
      found = peerPickIn(SPEEDS, state, this.ask);
    }
    if (!found || !rig.has(found.clip)) return this.drop();
    // Wave 3, stairs: their figure on stairs this side's rule finds under it, going forward, takes the stair clip of its
    // pace (their state carries no stairs: derived here, as their class is).
    if (f.stairs !== 0 && tune.stairs.rule === 'stairs' && found.posture === STAND && stairWay(found.dir, tune.stairs.ways)) {
      const up = stairPick(found, f.stairs);
      if (rig.has(up.clip)) found = up;
      // The stairs wave: the same cycle this side plays its own on (`stairs.cycle`, `stairs.mirror`).
      const kind = cycleKindOf(up, tune.stairs.cycle, tune.stairs.mirror);
      if (kind !== null && found === up) {
        const twin = stairCyclePick(up, kind);
        if (rig.has(twin.clip)) found = twin;
      }
    }
    if (!this.pick || found === this.pick) {
      this.pick = found;
      this.next = null;
    } else if (found.heading !== this.pick.heading || found.state !== this.pick.state) {
      // Another way, or the other side of the walk: taken at once.
      this.pick = found;
      this.next = null;
    } else {
      // Another class the same way: only once it has stood a moment.
      if (found !== this.next) {
        this.next = found;
        this.nextFor = 0;
      }
      this.nextFor += f.dt;
      if (this.nextFor >= tune.peer.settle) {
        this.pick = found;
        this.next = null;
      }
    }
    this.setRate(tune, rig, this.pick, f);
    return this.pick;
  }

  /**
   * The rate: the speed sent over the speed the clip's feet were made for (a game clip the tune has measured, at the
   * figure's own scale, else the rig's), inside the tune's band with its top doubled (`rateFor`'s own lines, written
   * out): a peer under Force Speed says so only by how fast it goes. Backwards for a crawl backing up. Into `rate`, so no number crosses the call.
   */
  private setRate(tune: LocoTune, rig: LocoRig, pick: LocoPick, f: PeerIn): void {
    let rate = 1;
    // The stairs wave: on stairs this side has measured under them, their stair clip driven by their own distance along
    // them, one step every n treads chosen from those stairs and their speed (this side's own `StairStep`).
    this.snap = Number.NaN;
    this.stepFacts = null;
    if (f.stairs !== 0 && tune.stairs.stepRule === 'stairs' && isStairPick(pick) && rig.stairFacts) {
      const facts = rig.stairFacts(pick.clip);
      if (facts !== null) {
        const s = this.stepIn;
        s.dt = f.dt;
        s.known = f.stairKnown;
        s.way = f.stairs;
        s.tread = f.stairTread;
        s.riser = f.stairRiser;
        s.next = f.stairNext;
        s.prev = f.stairPrev;
        s.scale = f.scale;
        s.moved = f.stairMoved;
        s.time = f.legClip === pick.clip ? f.legTime : Number.NaN;
        s.lead = f.stairLead;
        s.leadAt = f.stairLeadAt;
        s.asked = f.speed;
        this.step.plan(s, facts, tune.stairs);
        this.step.step(s, facts, tune.stairs);
        this.stepFacts = facts;
        this.snap = this.step.snap;
        this.rate = this.step.rate;
        return;
      }
    } else if (f.stairs === 0) this.step.reset();
    let natural = 0;
    if (pick.made >= 0) {
      const m = tune.made;
      const c = pick.made;
      natural = (c === MADE_CROUCHED ? m.crouched : c === MADE_CROUCH_BACK ? m.crouchBack : c === MADE_INJURED ? m.injuredWalk : c === MADE_STAIRS_UP ? m.stairsUp : c === MADE_STAIRS_RUN_UP ? m.stairsRunUp : c === MADE_STAIRS_DOWN ? m.stairsDown : c === MADE_STAIRS_RUN_DOWN ? m.stairsRunDown : m.gameWalk) * f.scale;
    } else if (rig.readSpeed(pick.clip)) natural = rig.speedOut;
    if (natural > 0) {
      const band = tune.rate;
      const top = band.max * 2;
      // The class's share of the feet-locked rate (`rate.byClass`), written out as the player's own is.
      const by = band.byClass;
      const c = pick.cls;
      const share = c === 1 ? by.walk : c === 2 ? by.jog : c === 3 ? by.run : by.sprint;
      const r = (f.speed / (natural * band.feet)) * share;
      rate = r < band.min ? band.min : r > top ? top : r;
    }
    this.rate = pick.reverse ? -rate : rate;
  }

  /**
   * A figure crouched or prone under this side's classes (wave 2b): the class whose speed is nearest the one sent (each
   * change of class standing a moment, as standing's do), its forward clip, or crouched backing up (`crouchWalkBack`)
   * Jedi Academy's walk back. A crawl heard going backward against its heading (their own game kept the body to the view,
   * under its 'reverse') is played backwards. Their figure faces the heading they sent, which is the way their own game
   * turned it, so the clip's turn is theirs already.
   */
  private postureLegs(tune: LocoTune, rig: LocoRig, posture: number, back: boolean, f: PeerIn): LocoPick | null {
    const g = posture === PRONE ? tune.prone.forward : back ? tune.crouch.back : tune.crouch.forward;
    const s = f.speed;
    let cls = 1;
    let gap = g.slow > s ? g.slow - s : s - g.slow;
    const d2 = g.normal > s ? g.normal - s : s - g.normal;
    if (d2 < gap) {
      cls = 2;
      gap = d2;
    }
    const d3 = g.fast > s ? g.fast - s : s - g.fast;
    if (d3 < gap) cls = 3;
    const reverse = posture === PRONE && (this.rel > 112.5 || this.rel < -112.5);
    const found = posturePick(posture, back || reverse ? 4 : 0, cls, reverse);
    if (!found || !rig.has(found.clip)) return this.drop();
    if (!this.pick || found === this.pick || found.state !== this.pick.state || found.reverse !== this.pick.reverse) {
      this.pick = found;
      this.next = null;
    } else {
      if (found !== this.next) {
        this.next = found;
        this.nextFor = 0;
      }
      this.nextFor += f.dt;
      if (this.nextFor >= tune.peer.settle) {
        this.pick = found;
        this.next = null;
      }
    }
    this.setRate(tune, rig, this.pick, f);
    return this.pick;
  }

  private drop(): null {
    this.pick = null;
    this.next = null;
    return null;
  }
}

/** The little of a rig a figure's pistol carry asks of: its states' preferences (`CharacterRig.prefer`). */
export interface PreferRig {
  prefer(state: string, clip: RegExp | null, repick?: boolean): void;
}

/** A pistol's own carry walk and run (the player's own `gunWalk` and `gunRun` preferences for a pistol). */
export const PISTOL_WALK = /^loop_pistol_standing:speed1/;
export const PISTOL_RUN = /^loop_pistol_standing:speed2/;

/**
 * Another player's relaxed pistol under this side's `gunCarry.pistol` 'original': the rig's own list for the relaxed
 * carry's walk and run names the rifle's first, so their figure's `gunWalk` and `gunRun` are asked for the pistol's.
 * Those preferences outlast the frame that set them, so they are taken off (and the state in force picks again) the
 * moment their reason is gone: the gun in their right hand is no pistol any more, or the choice for a pistol is no
 * longer 'original'. Never merely because a frame had no legs (a figure heard still a message), which would flick the
 * clip back and forth. One a figure; nothing made a frame.
 */
export class PeerPistolCarry {
  /** Whether the pistol's carry walk and run are the figure's `gunWalk` and `gunRun` preferences now. */
  held = false;

  /** The frame's step: `relaxedGun` the carry its kind of gun takes this frame (`CARRY_*`, -1 where none applies). */
  step(rig: PreferRig, tune: LocoTune, state: string, gunClass: number, relaxedGun: number): void {
    if (relaxedGun === CARRY_ORIGINAL && gunClass === 0) {
      rig.prefer(state, state === 'gunWalk' ? PISTOL_WALK : PISTOL_RUN);
      this.held = true;
    } else if (this.held && !(gunClass === 0 && carryOf(tune, 0) === CARRY_ORIGINAL)) {
      rig.prefer('gunWalk', null, true);
      rig.prefer('gunRun', null, true);
      this.held = false;
    }
  }
}
