// The town's walkers: a person the town stood on a round of points, walking it for ever.
//
// **Every rule here is the server's own**, out of the town screenplay every city shares
// (`city.lua`'s `spawnPatrol`, `setupMobilePatrol`, `mobileDestinationReached` and `mobilePatrol`):
//
//   - a walker is stood and set going after a wait -- ten seconds before its walk is set up and forty
//     to sixty more before it takes its first step, so fifty to seventy in all;
//   - it walks to the next point of its round, and when it gets there waits: thirty to sixty seconds
//     at a point the town marked for lingering, five at any other;
//   - after the last point it walks back to the first, and round again.
//
// Two things the server did are not done, each for one line of reason. **The round's own combat
// walkers stand at their posts** (`combatPatrol`, the outposts' commandos and miners): the server's
// `spawnPatrol` sets them an observer and returns before their walk is ever set up, so they never took
// a step of it; `PATROL_TUNE.combat` walks them anyway, for anyone who wants to watch it. And **the
// wait at a point is that point's own**: the server read the linger mark of the point *before* the
// one reached (its `currentLoc` is bumped after the mark is read), so every wait fell one point late
// round the whole loop; the mark was written on the point the town meant to be lingered at, and that
// is where this lingers.
//
// What the server left to its engine is ours: how near a point counts as reached, that a leg a walker
// can make no headway on is given up for the next (`giveUp`: the server's pathing never met a wall a
// round was drawn through, and ours can), and that a walker who is fought leaves the round and comes
// back to it -- to the very point it was making for, or lingering at -- once the fight is done, as a
// post is walked back to. Pure, like the brain: the clock
// and the dice come in, so the node test walks a round with its own.
import type { Decision } from './mobiles/brain.ts';

/** One point of a round, in the world's frame; indoors it names its room. */
export interface PatrolPoint {
  x: number;
  y: number;
  z: number;
  room?: number;
  linger?: boolean;
}

export interface PatrolTune {
  /** Seconds from being stood to the first step: the server's ten of setting up and forty to sixty more. */
  start: [number, number];
  /** Seconds waited at a point the town marked for lingering, least and most. */
  linger: [number, number];
  /** Seconds waited at any other point. */
  pause: number;
  /** How near a point counts as reached, metres. Ours. */
  arrive: number;
  /**
   * How long a leg may go without the walker getting a metre nearer its point before the leg is given
   * up and the next point walked to, seconds. The server's walkers were walked by its own pathing and
   * never met a wall the round was drawn through; ours can -- a point in a yard the ground's grid
   * cannot see into, a kerb a body cannot climb -- and without this one bad leg stops a round for good.
   * Time spent fighting, or standing still because the walker is too far off to be moved, is not
   * counted. Ours.
   */
  giveUp: number;
  /** Whether the round is walked at all: the switch that stands every walker at its first point. */
  walks: boolean;
  /** Whether a combat walker walks its round too, which the server never let one do. */
  combat: boolean;
}

export const PATROL_TUNE: PatrolTune = {
  start: [50, 70],
  linger: [30, 60],
  pause: 5,
  arrive: 1.5,
  giveUp: 30,
  walks: true,
  combat: false,
};

/** One walker's round and where it has got to. Kept on the body; numbers only. */
export class Patrol {
  readonly points: readonly PatrolPoint[];
  /** The point it is at or last reached, as an index into `points`. */
  at = 0;
  /** The point it is walking to, or -1 while it waits at `at`. */
  to = -1;
  /** The simulated second it sets off from `at` again. */
  waitUntil: number;
  /** For the console: legs walked, rounds finished, and how long each of the last few waits was. */
  legs = 0;
  rounds = 0;
  readonly waits: number[] = [];
  /** When the leg under way began, and how long the last one took, seconds. */
  legAt = 0;
  lastLeg = 0;
  /** Legs given up for want of headway (`giveUp`). */
  skipped = 0;
  /** The leg's nearest approach so far and when it was made, and when the round was last stepped. */
  bestD = Infinity;
  bestAt = 0;
  seenAt = -Infinity;
  /** The point handed back as the goal, written and never made. */
  readonly goal = { x: 0, z: 0 };

  constructor(points: readonly PatrolPoint[], now: number, rand: () => number = Math.random, tune: PatrolTune = PATROL_TUNE) {
    this.points = points;
    this.waitUntil = now + between(tune.start, rand);
  }

  /** The point it is making for now: the one it walks to, or the one it waits at. */
  get anchor(): PatrolPoint {
    return this.points[this.to >= 0 ? this.to : this.at];
  }

  get walking(): boolean {
    return this.to >= 0;
  }
}

function between([a, b]: readonly [number, number], rand: () => number): number {
  return a + rand() * Math.max(0, b - a);
}

/**
 * One step of the round for a body standing at (x, z) at `now`: a walk under way that has reached its
 * point stops there and waits that point's wait; a wait that is out sets off for the next point, the
 * first again after the last. A leg that has gone `giveUp` seconds without the walker getting a metre
 * nearer is given up and counts as walked, so the round goes on from the next point. `still` is a
 * walker held still by something that is not the leg (too far off to be moved at all), whose clock
 * does not run; nor does it across a gap in the stepping, which is a fight. Answers whether it is
 * walking.
 */
export function stepPatrol(p: Patrol, x: number, z: number, now: number, rand: () => number = Math.random, tune: PatrolTune = PATROL_TUNE, still = false): boolean {
  const n = p.points.length;
  if (n < 2) return false;
  const gap = now - p.seenAt > 2;
  p.seenAt = now;
  if (p.to >= 0) {
    const q = p.points[p.to];
    const d = Math.hypot(q.x - x, q.z - z);
    if (d > tune.arrive) {
      if (d < p.bestD - 1) {
        p.bestD = d;
        p.bestAt = now;
      } else if (still || gap) p.bestAt = now;
      if (!(tune.giveUp > 0) || now - p.bestAt < tune.giveUp) return true;
      p.skipped++;
    }
    p.at = p.to;
    p.to = -1;
    p.legs++;
    p.lastLeg = now - p.legAt;
    if (p.at === 0) p.rounds++;
    const wait = q.linger ? between(tune.linger, rand) : tune.pause;
    p.waitUntil = now + wait;
    p.waits.push(Number(wait.toFixed(2)));
    if (p.waits.length > 8) p.waits.shift();
    return false;
  }
  if (now < p.waitUntil) return false;
  p.to = (p.at + 1) % n;
  p.legAt = now;
  p.bestD = Infinity;
  p.bestAt = now;
  return true;
}

/** The fight states and the way home, which the brain keeps and the round never takes over. */
const OWN_STATES = new Set(['chase', 'attack', 'cover', 'alert', 'flee', 'return']);

/**
 * A decision kept to a round, in place, as `keepPost` keeps one to a post: when nothing is on the
 * body's mind -- no target, no flight, not on its way home -- it walks to the round's next point or
 * waits at the one it is on, and never wanders off on the brain's own account. A fight is the brain's
 * as it is for anything else; the body's home is kept on the point it is making for (the caller writes
 * `anchor` into it), so the leash and the walk home after a fight both bring it back to its round.
 *
 * Answers whether it is walking. A body the round has no hold on (a round of fewer than two points, or
 * the switch off) is left exactly as the brain decided. `still` is a body held still by its level of
 * detail, whose leg is not counted against `giveUp`.
 */
export function keepPatrol(d: Decision, self: { x: number; z: number; now: number }, p: Patrol, rand: () => number = Math.random, tune: PatrolTune = PATROL_TUNE, still = false): boolean {
  if (!tune.walks || p.points.length < 2) return false;
  if (d.targetKey !== null || OWN_STATES.has(d.state)) return false;
  const walking = stepPatrol(p, self.x, self.z, self.now, rand, tune, still);
  // The brain's own wander clock is pushed out of the way: a walker walks its round and nothing else.
  d.wanderAt = self.now + 3600;
  d.emote = null;
  if (walking) {
    const q = p.anchor;
    p.goal.x = q.x;
    p.goal.z = q.z;
    d.state = 'wander';
    d.goal = p.goal;
    d.moveTo = p.goal;
    d.face = p.goal;
    d.pace = 'walk';
  } else {
    d.state = 'idle';
    d.goal = null;
    d.moveTo = null;
    d.face = null;
    d.pace = 'stand';
  }
  return walking;
}

/** A decision with nothing in it: after nobody, going nowhere, standing. */
export function restDecision(): Decision {
  return {
    state: 'idle',
    targetKey: null,
    moveTo: null,
    pace: 'stand',
    posture: 'stand',
    cover: false,
    face: null,
    attack: null,
    emote: null,
    wanderAt: 0,
    goal: null,
    until: 0,
    blockedSince: null,
    forgetKey: null,
    forgetUntil: 0,
    clearMemory: false,
  };
}

/**
 * One thought of a walker that is part of the furniture (`Mobile.thinkWalker`), which is **every**
 * walker the town sets going: the rows it made unattackable are the only ones that walk by default
 * (`walksRound`), and an unattackable body has no brain at all. So this, and not `keepPatrol` under
 * the brain, is the path a town's walker really takes.
 *
 * `kept` is the decision the body keeps for its life, null the first time (one is made then), and is
 * written over in place: put to rest -- after nobody, going nowhere, standing -- and then kept to the
 * round. Resting it first is what makes the switch honest: a walker whose round is switched off in the
 * middle of a leg stands where it is, rather than walking on at the last leg's point for as long as
 * the decision it was handed then is kept.
 */
export function thinkWalking(kept: Decision | null, self: { x: number; z: number; now: number }, p: Patrol, rand: () => number = Math.random, tune: PatrolTune = PATROL_TUNE, still = false): Decision {
  const d = kept ?? restDecision();
  d.state = 'idle';
  d.targetKey = null;
  d.moveTo = null;
  d.face = null;
  d.goal = null;
  d.pace = 'stand';
  d.posture = 'stand';
  d.cover = false;
  d.attack = null;
  d.emote = null;
  d.clearMemory = false;
  keepPatrol(d, self, p, rand, tune, still);
  return d;
}

/**
 * Whether a row's body walks its round at all: a round of two points or more that it was stood at the
 * start of, and, unless `combat` says otherwise, a walker the town made unattackable -- the server's own
 * split between the walkers it set going and the combat walkers it left at their posts.
 */
export function walksRound(route: readonly PatrolPoint[] | undefined, standsAtFirst: boolean, peaceful: boolean, tune: PatrolTune = PATROL_TUNE): boolean {
  if (!route || route.length < 2 || !standsAtFirst) return false;
  return peaceful || tune.combat;
}
