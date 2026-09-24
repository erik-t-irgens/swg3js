// A mobile's mind: idle, wander, alert, chase, attack, cover, flee, return. It picks from the shared list
// of living things, fights back against whoever hurt it, gives up past a leash, checks height as
// well as distance, and wanders home's neighbourhood when there is nothing to do.
//
// Pure: `now` and `rand` come in and a plain decision goes out, so the node tests run it with
// their own clock. `now` is always the world's simulated time (World.simTime), never a wall clock:
// `__debug.advance` simulates ten seconds in a fraction of one real one.
//
// Rule for this file (it is run by node with type stripping): relative imports only as
// `import type` or with their `.ts`, no enum, no namespace, no constructor parameter properties.
import { PLAYER_KEY, hostileSides } from '../../combat/targets.ts';
import type { Aggression, Side } from '../../combat/kit';
import type { MobileState } from './types';
// The posture's four words, beside the pace's three. A type-only import, so nothing of the
// fighters' file is loaded here and node's type stripping erases the line outright.
import type { Posture } from '../fighterStance.ts';

export interface BrainSelf {
  key: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  homeX: number;
  homeZ: number;
  side: Side;
  aggression: Aggression;
  inside: boolean;
  /** A large or huge body: it sees farther (`aggroBig`). */
  big: boolean;
  /** Melee reach beyond both bodies (stats.reach at its scale); only counts with `melee`. */
  reach: number;
  /** Ranged range, 0 without a ranged clip. */
  ranged: number;
  melee: boolean;
  /** Its middle above its feet. */
  halfHeight: number;
  hpRatio: number;
  state: MobileState;
  targetKey: number | null;
  /** How many times in a row it has been found stuck. */
  stuck: number;
  now: number;
  /** When it may next set off wandering. */
  wanderAt: number;
  /** The point it is walking to (a wander) or running to (a flight), or null. */
  goal: { x: number; z: number } | null;
  /** When an alert or a flight ends. */
  until: number;
  /** Since when the target has been out of reach in height, or null. */
  blockedSince: number | null;
  /** A target given up on, and until when it is not taken again. */
  forgetKey: number | null;
  forgetUntil: number;
  /**
   * Whether this body gets behind things at all. **The one flag that lets the cover rule below
   * reach a fighter and never a creature**, and the reason there is one `decide` in this game
   * rather than two.
   *
   * It is deliberately neither of the two things it looks like. It is not "has a ranged attack":
   * 2,550 of the catalogue's 5,140 entries do, most of them creatures that spit, and a spitting
   * creature crouching behind a rock is wrong. And it is not the kind either, since a dressed NPC
   * plays a curated pack with no low clips in it at all. It is set by the body that can really do
   * it -- a tiered fighter, holding a gun, out of doors -- and left out everywhere else, so a
   * bantha is bit for bit what it was.
   */
  seeksCover?: boolean;
  /**
   * Whether it is behind something **now**. Fed back exactly as `state`, `stuck` and `goal` are,
   * and read for one thing only: it is what names the state `cover` rather than `attack` or
   * `chase`.
   *
   * The division is the whole of why the word can be trusted. This file decides *whether a body
   * wants* cover, which is a rule and belongs with the other rules; whether it has any is a fact
   * about the world that only the thing holding the physics can answer, and it comes back in here
   * as one boolean. So the state word is never a guess: a body says `cover` when it is standing
   * behind something and says `chase` while it is still looking.
   */
  inCover?: boolean;
}

export interface BrainTarget {
  key: number;
  x: number;
  y: number;
  z: number;
  halfHeight: number;
  /** Both bodies' reach toward each other along the line between them. */
  radius: number;
  side: Side;
  aggression: Aggression;
  dead: boolean;
  /** When it last hurt this mobile (simulated seconds), or -Infinity. */
  attackedMeAt: number;
  /** Whether a shot from this mobile would reach it (a ray on the think tick). */
  hasLine: boolean;
}

export interface Decision {
  state: MobileState;
  targetKey: number | null;
  moveTo: { x: number; z: number } | null;
  pace: 'stand' | 'walk' | 'run';
  /**
   * How low the body stands, beside the pace rather than folded into the state. The pace is already
   * an axis orthogonal to the state -- a body chases at a walk or at a run -- and a posture is the
   * same shape, since a body can be prone *and* attacking; and the state words are written out in
   * three places that must agree, one of them in the relay, so a new state word would be a server
   * change before a posture had crossed anything.
   *
   * **Nothing in `decide` writes it**, and now that the cover rule is here that is a decision
   * rather than a gap. It leaves as 'stand' on every decision, for the wildlife and for a fighter
   * alike, and the fighters write their own answer onto it before acting on it
   * (`Npc.stepPosture`), exactly as the indoor wander clamp rewrites `goal` after the brain has
   * answered. How low a body goes needs three things this file has not got and should not be given
   * -- whether its rig can be drawn lying down, whether it is on its feet at all, and what it is
   * standing behind -- so it is settled where those are known. What comes back from there is the
   * one boolean the rule above reads, `BrainSelf.inCover`.
   */
  posture: Posture;
  /**
   * Whether to go looking for somewhere to stand where the thing it is fighting cannot see it.
   *
   * It is the **rule** and not the answer: this file has no idea what is standing near the body and
   * never will, so what it says is "a search is worth running now". The search itself, the spot it
   * picks and how long the body believes it are the fighter's (`Npc.stepCover`, over
   * `src/world/cover.ts`), and the one thing that comes back here is `BrainSelf.inCover`.
   *
   * False on every decision of every creature, because `seeksCover` is.
   */
  cover: boolean;
  face: { x: number; z: number } | null;
  attack: 'melee' | 'ranged' | null;
  emote: 'alert' | 'idle' | null;
  wanderAt: number;
  goal: { x: number; z: number } | null;
  until: number;
  blockedSince: number | null;
  forgetKey: number | null;
  forgetUntil: number;
  /** The attackers it no longer holds a grudge against (a return clears the memory). */
  clearMemory: boolean;
}

export interface BrainTune {
  /** How far it sees a foe it will pick on, and how far a big one sees; and within how much height. */
  aggro: number;
  aggroBig: number;
  aggroVertical: number;
  /** Seconds a target given up on is not taken again. */
  forget: number;
  /** Seconds it remembers who hurt it. */
  memory: number;
  /** How near the player a skittish thing bolts, and for how long. */
  fleeRange: number;
  fleeFor: number;
  /** How far from home it chases before going back, outdoors and inside a building. */
  leash: number;
  leashInside: number;
  /** Seconds a target may stay out of reach in height before it is given up. */
  giveUp: number;
  /** Metres beyond the two bodies' middles that still count as level. */
  vertical: number;
  wanderMin: number;
  wanderMax: number;
  wanderEvery: [number, number];
  /** Stuck this many times running, it gives up the target. */
  stuckGiveUp: number;
  /** How far the neighbours of the same group hear that one of them was hurt. */
  assist: number;
  /** Seconds an alert lasts before the chase. */
  alertFor: number;
  /** A fresh target farther than this is stared at first. */
  alertRange: number;
  /** How near home counts as home. */
  home: number;
  /**
   * How far out a body whose shot is blocked will look for cover rather than simply closing, as a
   * share of its own weapon's range.
   *
   * Over one on purpose. A blocked shot at the edge of a gun's reach is still a fight -- the wall
   * is between the two bodies, not past the target -- and the number exists only to keep a body
   * that has noticed somebody half a kilometre off from standing behind a crate about it. Anything
   * further and the brain answers the plain chase it always answered.
   */
  coverRange: number;
}

export const BRAIN_TUNE: BrainTune = {
  aggro: 32,
  aggroBig: 48,
  aggroVertical: 15,
  forget: 20,
  memory: 20,
  fleeRange: 10,
  fleeFor: 4,
  leash: 60,
  leashInside: 25,
  giveUp: 8,
  vertical: 1.2,
  wanderMin: 8,
  wanderMax: 30,
  wanderEvery: [3, 8],
  stuckGiveUp: 3,
  assist: 12,
  alertFor: 0.5,
  alertRange: 8,
  home: 2,
  coverRange: 1.5,
};

/** Whether `me` picks a fight with `them` on sight: the matrix lives in targets.ts, one place for every body. */
export function hostile(me: { side: Side; aggression: Aggression }, them: { side: Side; aggression: Aggression }): boolean {
  return hostileSides(me, them);
}

/** A point between `wanderMin` and `wanderMax` from home, in any direction. */
export function wanderPoint(self: BrainSelf, tune: BrainTune, rand: () => number): { x: number; z: number } {
  const a = rand() * Math.PI * 2;
  const r = tune.wanderMin + rand() * (tune.wanderMax - tune.wanderMin);
  return { x: self.homeX + Math.sin(a) * r, z: self.homeZ + Math.cos(a) * r };
}

function nextWander(now: number, tune: BrainTune, rand: () => number): number {
  const [a, b] = tune.wanderEvery;
  return now + a + rand() * (b - a);
}

/** Whether a target's middle is within reach of level: the two middles no farther apart than both half-heights and `vertical`. */
function level(self: BrainSelf, t: BrainTarget, tune: BrainTune): boolean {
  return Math.abs(t.y + t.halfHeight - (self.y + self.halfHeight)) <= self.halfHeight + t.halfHeight + tune.vertical;
}

/**
 * What to do now. The first rule that applies wins:
 *
 * 1. Past the leash (or already on the way home): run home with no target.
 * 2. Whoever hurt it most recently within `memory`, and still alive: a passive one ignores them,
 *    a skittish one runs from them, anything else takes them as the target whatever their side.
 * 3. Nobody hurt it: an aggressive one takes the nearest it is hostile to within `aggro` (or
 *    `aggroBig`) and `aggroVertical`; a skittish one bolts from the player inside `fleeRange`.
 * 4. A target out of reach in height for `giveUp` seconds, or stuck `stuckGiveUp` times: home,
 *    and that target forgotten for `forget` seconds.
 * 5. With a target: shoot it (in range, with a line), strike it (in reach and level), stare at a
 *    fresh one that is far, else chase it. A body whose `seeksCover` flag is set gets behind
 *    something while it does: see the cover note below.
 * 6. Nothing to do: wander when the clock is up, else stand, now and then with an idle emote.
 *
 * ## Cover
 *
 * Two things, and keeping them apart is what makes the word honest.
 *
 * `d.cover` is **whether to look**. It is set while a flagged body is shooting -- a gunfight is
 * where a body wants something between it and the bolts -- and while its shot is blocked and the
 * target is within `coverRange` of its own reach. That second half is the one line in this game
 * that was always going to be wrong: a gunner whose shot is blocked falls through to a chase and
 * **walks into the open**, because a chase is what this function answers both when the target is
 * too far off and when there is a wall in the way. Note what has *not* changed with it: the chase
 * is still answered, with the target still as `moveTo` at a run. So a body that looks and finds
 * nothing closes exactly as it always did, which is the one failure this rule must not have.
 *
 * `state: 'cover'` is **whether it is behind anything**, and it is the game's own word for it --
 * `Cover` is state 0 in the client's own table, beside Aiming and Alert, with 139 commands gated on
 * it. It is written only where `attack` or `chase` would have been and only when `inCover` comes
 * back true, so nothing else in the ladder changes and the word cannot say a body is in cover
 * while it is walking about in the open. A creature never reaches either, because `seeksCover` is
 * how both are gated and nothing but a fighter sets it.
 */
export function decide(self: BrainSelf, targets: readonly BrainTarget[], tune: BrainTune = BRAIN_TUNE, rand: () => number = Math.random): Decision {
  const now = self.now;
  const d: Decision = {
    state: 'idle',
    targetKey: null,
    moveTo: null,
    pace: 'stand',
    posture: 'stand',
    cover: false,
    face: null,
    attack: null,
    emote: null,
    wanderAt: self.wanderAt,
    goal: null,
    until: self.until,
    blockedSince: null,
    forgetKey: self.forgetUntil > now ? self.forgetKey : null,
    forgetUntil: self.forgetUntil > now ? self.forgetUntil : 0,
    clearMemory: false,
  };
  const home = { x: self.homeX, z: self.homeZ };
  const fromHome = Math.hypot(self.x - self.homeX, self.z - self.homeZ);
  const leash = self.inside ? tune.leashInside : tune.leash;
  const goHome = (): Decision => {
    d.state = 'return';
    d.targetKey = null;
    d.moveTo = home;
    d.face = home;
    d.pace = 'run';
    d.clearMemory = true;
    d.wanderAt = nextWander(now, tune, rand);
    return d;
  };

  // 1. The leash, and a return already under way: it takes no new target until it is home.
  if (fromHome > leash) return goHome();
  if (self.state === 'return' && fromHome > tune.home) return goHome();

  const forgotten = (t: BrainTarget) => d.forgetKey !== null && t.key === d.forgetKey;
  let target: BrainTarget | null = null;

  // 2. The attacker memory outranks everything that follows.
  let attacker: BrainTarget | null = null;
  for (const t of targets) {
    if (t.dead || t.key === self.key || forgotten(t)) continue;
    if (now - t.attackedMeAt > tune.memory) continue;
    if (!attacker || t.attackedMeAt > attacker.attackedMeAt) attacker = t;
  }
  if (attacker && self.aggression !== 'passive') {
    if (self.aggression === 'skittish') return flee(self, attacker, d, tune, now);
    target = attacker;
  }

  // A flight under way runs its course.
  if (!target && self.state === 'flee' && now < self.until && self.goal) {
    d.state = 'flee';
    d.goal = self.goal;
    d.moveTo = self.goal;
    d.face = self.goal;
    d.pace = 'run';
    return d;
  }

  // 3. Nobody hurt it: keep the one it is after while it lives and the leash holds, else look.
  if (!target && self.targetKey !== null && self.aggression === 'aggressive') {
    for (const t of targets) {
      if (t.key !== self.targetKey || t.dead || forgotten(t)) continue;
      if (hostile(self, t)) target = t;
      break;
    }
  }
  if (!target && self.aggression === 'aggressive') {
    const range = self.big ? tune.aggroBig : tune.aggro;
    let best = range;
    for (const t of targets) {
      if (t.dead || t.key === self.key || forgotten(t) || !hostile(self, t)) continue;
      if (Math.abs(t.y + t.halfHeight - (self.y + self.halfHeight)) > tune.aggroVertical) continue;
      const dist = Math.hypot(t.x - self.x, t.z - self.z);
      if (dist < best) {
        best = dist;
        target = t;
      }
    }
  }
  if (!target && self.aggression === 'skittish') {
    for (const t of targets) {
      if (t.key !== PLAYER_KEY || t.dead) continue;
      if (Math.hypot(t.x - self.x, t.z - self.z) < tune.fleeRange) return flee(self, t, d, tune, now);
    }
  }

  if (target) {
    // 4. Out of reach in height too long, or stuck too often: give it up and go home.
    const sameTarget = self.targetKey === target.key;
    const isLevel = level(self, target, tune);
    const blockedSince = isLevel ? null : sameTarget && self.blockedSince !== null ? self.blockedSince : now;
    if ((blockedSince !== null && now - blockedSince >= tune.giveUp) || (sameTarget && self.stuck >= tune.stuckGiveUp)) {
      goHome();
      d.forgetKey = target.key;
      d.forgetUntil = now + tune.forget;
      return d;
    }
    d.blockedSince = blockedSince;
    d.targetKey = target.key;
    const at = { x: target.x, z: target.z };
    d.face = at;
    const dist = Math.hypot(target.x - self.x, target.z - self.z);
    // Whether this body gets behind things at all, and whether it is behind one now. Both are one
    // flag away from false for every creature in the game; see the cover note above.
    const seeks = self.seeksCover === true && self.ranged > 0;
    const covered = seeks && self.inCover === true;
    // 5. Shoot, strike, stare, or run at it.
    // The line is only ever looked for along the current target (a ray a think, not one per
    // candidate), so a fresh target is chased or stared at for one tick before it is shot.
    if (self.ranged > 0 && dist <= self.ranged && target.hasLine) {
      d.state = covered ? 'cover' : 'attack';
      d.attack = 'ranged';
      d.pace = 'stand';
      // In a gunfight it wants something between it and the bolts whether its own shot is clear or
      // not: a body that only looked while it was blocked would take cover and then step out of it
      // the moment it could see, which is a body playing peek-a-boo rather than fighting from
      // behind a crate. What keeps it from searching every step is its own tier's `coverEvery`.
      d.cover = seeks;
      return d;
    }
    if (self.melee && dist - target.radius <= self.reach && isLevel) {
      d.state = 'attack';
      d.attack = 'melee';
      d.pace = 'stand';
      return d;
    }
    if (!sameTarget && dist > tune.alertRange) {
      d.state = 'alert';
      d.until = now + tune.alertFor;
      d.emote = 'alert';
      d.pace = 'stand';
      return d;
    }
    if (self.state === 'alert' && sameTarget && now < self.until) {
      d.state = 'alert';
      d.pace = 'stand';
      return d;
    }
    // A chase, and for a flagged gunner a chase it would rather not take: `cover` is the wall in
    // the way, told apart from "too far off" by the one line-of-sight ray a thought already casts.
    // `moveTo` is the target either way, so a body that finds no spot closes exactly as before.
    d.state = covered ? 'cover' : 'chase';
    d.moveTo = at;
    d.pace = 'run';
    d.cover = seeks && !target.hasLine && dist <= self.ranged * tune.coverRange;
    return d;
  }

  // 6. Nothing to do.
  if (self.state === 'wander' && self.goal && Math.hypot(self.goal.x - self.x, self.goal.z - self.z) > tune.home) {
    d.state = 'wander';
    d.goal = self.goal;
    d.moveTo = self.goal;
    d.face = self.goal;
    d.pace = 'walk';
    return d;
  }
  if (self.state === 'wander' || self.state === 'return' || self.state === 'chase' || self.state === 'attack' || self.state === 'cover' || self.state === 'alert' || self.state === 'flee') {
    // Just arrived or just done: stand a while, one time in eight with an idle emote.
    d.state = 'idle';
    d.wanderAt = nextWander(now, tune, rand);
    if (rand() < 1 / 8) d.emote = 'idle';
    return d;
  }
  if (now >= self.wanderAt) {
    // One time in eight it stays and fidgets instead of setting off.
    if (rand() < 1 / 8) {
      d.state = 'idle';
      d.emote = 'idle';
      d.wanderAt = nextWander(now, tune, rand);
      return d;
    }
    const p = wanderPoint(self, tune, rand);
    d.state = 'wander';
    d.goal = p;
    d.moveTo = p;
    d.face = p;
    d.pace = 'walk';
    d.wanderAt = nextWander(now, tune, rand);
    return d;
  }
  d.state = 'idle';
  return d;
}

/** Run from a threat: to the point `fleeRange * 2` beyond it, for `fleeFor` seconds. */
function flee(self: BrainSelf, threat: BrainTarget, d: Decision, tune: BrainTune, now: number): Decision {
  let dx = self.x - threat.x;
  let dz = self.z - threat.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) {
    dx = Math.sin(self.heading);
    dz = Math.cos(self.heading);
  } else {
    dx /= len;
    dz /= len;
  }
  const goal = { x: self.x + dx * tune.fleeRange * 2, z: self.z + dz * tune.fleeRange * 2 };
  d.state = 'flee';
  d.targetKey = null;
  d.goal = goal;
  d.moveTo = goal;
  d.face = goal;
  d.pace = 'run';
  d.until = now + tune.fleeFor;
  return d;
}
