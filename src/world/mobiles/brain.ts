// A mobile's mind: idle, wander, alert, chase, attack, flee, return. It picks from the shared list
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
   * **Nothing in `decide` writes it.** It leaves here as 'stand' on every decision, for the
   * wildlife and for a fighter alike, and the fighters then write their own answer onto it before
   * acting on it (`Npc.stepPosture`), exactly as the indoor wander clamp rewrites `goal` after the
   * brain has answered. That is deliberate: the rule that would belong in here is a cover rule,
   * which needs a flag only a fighter sets so that a spitting creature never crouches behind a
   * rock, and that is a wave of its own. When it is written it goes here and no consumer changes.
   */
  posture: Posture;
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
 *    fresh one that is far, else chase it.
 * 6. Nothing to do: wander when the clock is up, else stand, now and then with an idle emote.
 */
export function decide(self: BrainSelf, targets: readonly BrainTarget[], tune: BrainTune = BRAIN_TUNE, rand: () => number = Math.random): Decision {
  const now = self.now;
  const d: Decision = {
    state: 'idle',
    targetKey: null,
    moveTo: null,
    pace: 'stand',
    posture: 'stand',
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
    // 5. Shoot, strike, stare, or run at it.
    // The line is only ever looked for along the current target (a ray a think, not one per
    // candidate), so a fresh target is chased or stared at for one tick before it is shot.
    if (self.ranged > 0 && dist <= self.ranged && target.hasLine) {
      d.state = 'attack';
      d.attack = 'ranged';
      d.pace = 'stand';
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
    d.state = 'chase';
    d.moveTo = at;
    d.pace = 'run';
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
  if (self.state === 'wander' || self.state === 'return' || self.state === 'chase' || self.state === 'attack' || self.state === 'alert' || self.state === 'flee') {
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
