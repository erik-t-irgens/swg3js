// What the travellers at a starport are doing, from the shuttle's own round and nothing else.
//
// The shuttle keeps a round every browser agrees on with nothing sent between them (`shuttleAt`, off
// the shared wall clock and the port's own name), and so does everybody here: which people come to a
// port for a round, when each of them walks in, which terminal each buys a ticket at, how long they
// stand at it, where by the collector they wait, and which of the round's arrivals step off where, are
// all drawn from the port's clock name and the round's number. So two players at one starport see the
// same people come in through the door at the same moment, queue at the same terminal, stand by the
// collector until the shuttle is really there and walk up its ramp as it waits, and see the ones it
// brought step off as its landing ends. Only the walking between is each browser's own, as every body's
// walking is.
//
// A departure's day is four places and one clock. It comes in through a door of the starport some two
// minutes before the landing, walks to a terminal in the terminal's own room and faces it for a while,
// walks out to the collector and waits there until the shuttle has landed, then walks to the foot of
// its ramp (or its side, for a shuttle with no door) and is gone as it boards. Anybody who has not
// boarded when the shuttle lifts off is let go then. An arrival steps off at the ramp as the landing
// ends, walks through the starport (whose pads are walled in behind it) and on to the door of a cantina
// or a hotel, or off into town, and is gone once it gets there.
//
// **Every number here is ours.** Nothing in the archives or the emulator says that anybody at a port
// did any of this: the server stood no travellers at all. The owner asked for the idea to be tried.
//
// Pure: the round comes in as numbers, the clock as a number, and whether a body has got where it was
// going as a boolean, so the node test walks a traveller through a whole round with its own clock. The
// rules the runner keeps every one of ours by, travellers and fillers alike, are here for the same
// reason: when a walk is stuck (`stalled`) and which of them give model memory back (`giveBack`).
// Rule for this file (node runs it with type stripping): relative imports only as `import type` or
// with their `.ts`, no enum, no namespace, no constructor parameter properties.
import type { Building } from '../layoutStream.ts';
import type { Decision } from '../mobiles/brain.ts';
import { restDecision } from '../patrols.ts';
import { roll } from '../spawnSeed.ts';
import { slotHash, type ShuttleRound } from '../travelTerminal.ts';

/** Every number of the travellers, all of them ours; live through `__debug.ours({ tune })`. */
export const ROUTINE_TUNE = {
  /** How many leave on each round's shuttle, least and most (the design's number). */
  departures: [1, 3] as [number, number],
  /** How many each round's shuttle brings, least and most (the design's number). */
  arrivals: [0, 3] as [number, number],
  /** Seconds before the landing the first of a round's departures comes in (the design's number). */
  appear: 120,
  /** Seconds over which a round's departures come in, one after another. */
  stagger: 30,
  /** Seconds a departure stands at its terminal, least and most (the design's number). */
  stand: [6, 12] as [number, number],
  /**
   * Seconds after the landing ends before the first arrival steps off, and between one and the next:
   * the people waiting at the collector board first, and nobody meets anybody on the ramp.
   */
  offAfter: 10,
  stepOff: 3,
  /**
   * Seconds before the lift-off by which the last of a round's arrivals has stepped off, whatever
   * `offAfter` and `stepOff` are moved to: nobody steps off a shuttle that has gone.
   */
  offBefore: 5,
  /**
   * Seconds after stepping off within which an arrival first met is still stood at the ramp: one met
   * later has walked off into town already, and is not stood at all rather than stood where it began.
   */
  late: 20,
  /**
   * The pace a traveller first met part way through its errand is taken to have walked at, metres a
   * second, and how much longer than the straight line its way was: together they say which of its
   * places it has got to, so somebody arriving at a starport finds the queue where it would be.
   */
  pace: 1.3,
  winding: 1.4,
  /** How near a place counts as reached, metres. */
  reach: 1.2,
  /** How near the foot of the ramp a traveller is when it boards and is gone, metres. */
  board: 2.5,
  /**
   * How far out from the foot of the ramp, away from the hull, a traveller boards from and an arrival
   * steps off at, metres: the foot is the ramp's own far edge, and the parked hull is solid.
   */
  clear: 1.2,
  /**
   * Seconds a traveller may stand pressed against something without moving a metre before it is quietly
   * let go: a way it cannot walk, a door it cannot find, a crowd it cannot get round. Time it cannot move
   * at all (too far off to be walked) is not counted.
   */
  giveUp: 25,
  /** Seconds it may go on moving without getting a metre nearer where it is going: a detour longer than this is a walker lost. */
  lost: 90,
  /** How far from the collector the people waiting for the shuttle stand, metres, least and most. */
  ring: [2, 4] as [number, number],
  /** How far to either side of the line to the pad they spread, radians. */
  spread: 1.1,
  /** How far in front of a terminal somebody using it stands, metres, and how far apart two using one. */
  front: 0.9,
  beside: 0.8,
  /** How far outside a door a departure is first seen, metres. */
  outside: 2.5,
  /**
   * Where a departure to a port whose terminal stands in the open (a shuttleport) comes from: this far
   * off the terminal, metres, least and most, on walkable ground.
   */
  approach: [25, 45] as [number, number],
  /** How far off the pad an arrival looks for a cantina or a hotel to walk to, metres. */
  town: 300,
  /** The share of arrivals who make for a cantina's or a hotel's door rather than a spot in town. */
  toDoor: 0.7,
  /** How far off the pad an arrival bound for town walks, metres, least and most. */
  townWalk: [40, 90] as [number, number],
  /**
   * Seconds an arrival walks at most before it is let go, wherever it has got to: a starport is a long
   * walk through (Mos Eisley's, pad to front door, measured at about two and a half minutes).
   */
  walkMax: 420,
};

export type RoutineTune = typeof ROUTINE_TUNE;

/** Who comes to a port for one round, and when: all of it drawn, nothing decided by anybody. */
export interface TravellerPlan {
  /** A departure buys a ticket and boards; an arrival steps off and walks into town. */
  kind: 'depart' | 'arrive';
  round: number;
  /** Its place among the round's departures, or among its arrivals. */
  index: number;
  /** The one number the rest of what it draws comes from: its look, its spot. */
  seed: number;
  /** When it is first seen, on the shared clock. */
  appearAt: number;
  /** A departure's seconds at its terminal. */
  stand: number;
  /** A departure's terminal, as an index into the port's, taken modulo; -1 at a port with none. */
  terminal: number;
  /** A draw from 0 to 1: a departure's way in, an arrival's choice of door or town. */
  door: number;
  /** A draw from 0 to 1: where by the collector a departure waits, which way into town an arrival walks. */
  spot: number;
  /** A second draw: how far off the collector, or how far into town. */
  far: number;
  /** Its round's own moments, carried so that nothing asks the round again. */
  wait: number;
  leave: number;
}

/** A plan with nothing in it, to be written over. */
export function blankPlan(): TravellerPlan {
  return { kind: 'depart', round: 0, index: 0, seed: 0, appearAt: 0, stand: 0, terminal: -1, door: 0, spot: 0, far: 0, wait: 0, leave: 0 };
}

/** The streams one round's draws come out of, so no draw moves another. */
const STREAM = { departures: 1, arrivals: 2, each: 16 } as const;

/** A round's own seed: the port's clock name and the round, as every browser has them. */
export function roundSeed(clock: string, round: number): number {
  return Math.floor(slotHash(`${clock}|ours`, round) * 4294967296) >>> 0;
}

/** A whole number from `lo` to `hi` inclusive by a draw. */
function between(pair: readonly [number, number], u: number): number {
  const lo = Math.min(pair[0], pair[1]);
  const hi = Math.max(pair[0], pair[1]);
  return Math.min(hi, lo + Math.floor(u * (hi - lo + 1)));
}

/**
 * The travellers of one round of a port's shuttle, written into `out` from `at` on (its entries kept
 * and written over), departures first: how many, and each one's moment, terminal, door and spot, all
 * drawn from the port's clock name and the round. `terminals` is how many the port has. Answers how
 * far `out` is filled. The same clock, round and tune give the same people in every browser.
 */
export function travellersOf(clock: string, round: ShuttleRound, terminals: number, out: TravellerPlan[], at: number, tune: RoutineTune = ROUTINE_TUNE): number {
  const seed = roundSeed(clock, round.slot);
  const leave = between(tune.departures, roll(seed, STREAM.departures));
  const come = between(tune.arrivals, roll(seed, STREAM.arrivals));
  let n = at;
  // The round's first terminal is drawn, and each departure after the first takes the next one along.
  const firstTerminal = terminals > 0 ? Math.floor(roll(seed, 3) * terminals) : -1;
  for (let i = 0; i < leave; i++) {
    const p = (out[n] ??= blankPlan());
    const s = 100 + i * STREAM.each;
    p.kind = 'depart';
    p.round = round.slot;
    p.index = i;
    p.seed = Math.floor(roll(seed, s) * 4294967296) >>> 0;
    // In order, each somewhere in its own share of the stagger: the first of a round is always the
    // first through the door.
    p.appearAt = round.land - tune.appear + (tune.stagger * (i + roll(seed, s + 1))) / Math.max(1, leave);
    p.stand = tune.stand[0] + roll(seed, s + 2) * Math.max(0, tune.stand[1] - tune.stand[0]);
    // A terminal apiece where the port has enough, starting from the round's drawn one.
    p.terminal = terminals > 0 ? (firstTerminal + i) % terminals : -1;
    p.door = roll(seed, s + 4);
    p.spot = roll(seed, s + 5);
    p.far = roll(seed, s + 6);
    p.wait = round.wait;
    p.leave = round.leave;
    n++;
  }
  // The arrivals step off one after another once the landing is over, and always while their shuttle
  // still waits: the last moment is `offBefore` ahead of the lift-off.
  const offRoom = Math.max(0, round.leave - round.wait - Math.max(0, tune.offBefore));
  for (let j = 0; j < come; j++) {
    const p = (out[n] ??= blankPlan());
    const s = 500 + j * STREAM.each;
    p.kind = 'arrive';
    p.round = round.slot;
    p.index = j;
    p.seed = Math.floor(roll(seed, s) * 4294967296) >>> 0;
    p.appearAt = round.wait + Math.min(offRoom, Math.max(0, tune.offAfter + j * tune.stepOff + roll(seed, s + 1)));
    p.stand = 0;
    p.terminal = -1;
    p.door = roll(seed, s + 4);
    p.spot = roll(seed, s + 5);
    p.far = roll(seed, s + 6);
    p.wait = round.wait;
    p.leave = round.leave;
    n++;
  }
  return n;
}

/**
 * Where a departure is in its day by the clock alone: not come yet, on its way (in, at the terminal,
 * out to the collector, waiting), boarding (the shuttle has landed and waits), or gone (it has lifted
 * off, and whoever did not board is let go). The boarding window is exactly the one `shuttleAt` calls
 * `waiting` for the same round, which the node test holds it to.
 */
export type TravelPhase = 'before' | 'come' | 'board' | 'gone';

export function departurePhase(p: Pick<TravellerPlan, 'appearAt' | 'wait' | 'leave'>, seconds: number): TravelPhase {
  if (seconds < p.appearAt) return 'before';
  if (seconds >= p.leave) return 'gone';
  if (seconds >= p.wait) return 'board';
  return 'come';
}

/** Where an arrival is by the clock alone: not stepped off yet, walking into town, or let go. */
export function arrivalPhase(p: Pick<TravellerPlan, 'appearAt'>, seconds: number, tune: RoutineTune = ROUTINE_TUNE): 'before' | 'walk' | 'gone' {
  if (seconds < p.appearAt) return 'before';
  if (seconds >= p.appearAt + tune.walkMax) return 'gone';
  return 'walk';
}

/**
 * A departure's places, in the order it goes to them: walking in to a terminal (`enter`), standing at
 * it (`terminal`), walking out to the collector (`out`), waiting there (`waiting`), walking to the ramp
 * (`board`), and then out of the world: boarded, or let go when its shuttle lifted off without it.
 */
export type DepartureStage = 'enter' | 'terminal' | 'out' | 'waiting' | 'board' | 'boarded' | 'gone';

/** A departure's own progress, kept by whatever walks it. */
export interface DepartureState {
  stage: DepartureStage;
  /** When it leaves its terminal, on the shared clock. */
  standUntil: number;
}

/**
 * The stage a departure is stood in when it is first met, which is not always when it came: somebody
 * arriving at a starport ninety seconds before the landing finds the queue at the terminals and the
 * collector, not everybody at the door. Its day is laid out at an ordinary walking pace over the two
 * walks' straight lengths (`legs`), and it is stood where that day has got to: at the door, at its
 * terminal with what is left of its time there, or at the collector. Null for one not to be stood at
 * all (not come yet, or its shuttle has gone). `out.standUntil` is written for one met at its terminal.
 */
export function departureStart(p: TravellerPlan, seconds: number, legs: { toTerminal: number; toCollector: number }, out: DepartureState, tune: RoutineTune = ROUTINE_TUNE): DepartureStage | null {
  const phase = departurePhase(p, seconds);
  if (phase === 'before' || phase === 'gone') return null;
  const pace = Math.max(0.1, tune.pace);
  const atTerminal = p.appearAt + (legs.toTerminal * tune.winding) / pace;
  const leaves = atTerminal + p.stand;
  let stage: DepartureStage;
  if (p.terminal < 0) stage = seconds < p.appearAt + (legs.toCollector * tune.winding) / pace ? 'out' : 'waiting';
  else if (seconds < atTerminal) stage = 'enter';
  else if (seconds < leaves) stage = 'terminal';
  else stage = 'waiting';
  // Met with its shuttle already down, wherever its day would have had it, it makes for the ramp.
  if (phase === 'board') stage = 'board';
  out.stage = stage;
  out.standUntil = stage === 'terminal' ? leaves : 0;
  return stage;
}

/**
 * One step of a departure's day: `arrived` says whether it has got where its stage sends it. At its
 * terminal it stands out its time; at the collector it waits for the shuttle to land; on the ramp it
 * boards; and whatever it is doing, the shuttle lifting off ends it -- boarded, or let go. Answers the
 * stage it is in now.
 */
export function stepDeparture(s: DepartureState, p: TravellerPlan, seconds: number, arrived: boolean): DepartureStage {
  if (s.stage === 'boarded' || s.stage === 'gone') return s.stage;
  if (seconds >= p.leave) {
    s.stage = 'gone';
    return s.stage;
  }
  switch (s.stage) {
    case 'enter':
      // Not at its terminal yet with its shuttle already down: it has its ticket, and makes for the shuttle.
      if (seconds >= p.wait) s.stage = 'out';
      else if (arrived) {
        s.stage = 'terminal';
        s.standUntil = seconds + p.stand;
      }
      break;
    case 'terminal':
      if (seconds >= s.standUntil || seconds >= p.wait) s.stage = 'out';
      break;
    case 'out':
      // Out at the collector with the shuttle already down, it goes straight on to the ramp.
      if (arrived) s.stage = seconds >= p.wait ? 'board' : 'waiting';
      break;
    case 'waiting':
      if (seconds >= p.wait) s.stage = 'board';
      break;
    case 'board':
      if (arrived) s.stage = 'boarded';
      break;
  }
  return s.stage;
}

/**
 * How a walk is going, on two clocks: the nearest it has got to its goal and when, and where the body
 * last stood a metre from and when. A body pressed against a wall is caught by the second; one walking
 * round and round, or the long way round a building its goal is behind, is caught by the first, which
 * is given longer for that reason: a detour takes a walker away from its goal before it brings it nearer.
 */
export interface Headway {
  best: number;
  at: number;
  x: number;
  z: number;
  movedAt: number;
}

/** A walk begun afresh at `now`. */
export function restartHeadway(h: Headway, now: number): void {
  h.best = Infinity;
  h.at = now;
  h.x = NaN;
  h.z = NaN;
  h.movedAt = now;
}

/** A fresh account of a walk, begun at `now`. */
export function newHeadway(now: number): Headway {
  return { best: Infinity, at: now, x: NaN, z: NaN, movedAt: now };
}

/**
 * Whether a walk is stuck, which is when the one walking it is quietly let go rather than left there:
 * `giveUp` seconds without the body moving a metre, or `lost` seconds without its getting a metre nearer
 * its goal (`d`) however much it moves. `still` is a body that cannot move just now (too far off to be
 * walked, or its model still loading): neither clock runs.
 */
export function stalled(h: Headway, d: number, x: number, z: number, now: number, still: boolean, giveUp: number, lost: number): boolean {
  if (still) {
    h.at = now;
    h.movedAt = now;
    h.x = x;
    h.z = z;
    return false;
  }
  if (!(Math.hypot(x - h.x, z - h.z) < 1)) {
    h.x = x;
    h.z = z;
    h.movedAt = now;
  }
  if (d < h.best - 1) {
    h.best = d;
    h.at = now;
  }
  return (giveUp > 0 && now - h.movedAt >= giveUp) || (lost > 0 && now - h.at >= lost);
}

/**
 * What one of ours is doing, as the body reads it (`Mobile.routine`): walking to a point, or standing
 * facing one, and where the point is -- in which room of which building, or out in the open -- so the
 * doorway join walks it in and out of doors. Written in place by whatever walks it; nothing is made.
 */
export interface RoutineWalk {
  /** Whether it walks to `goal`; standing otherwise. */
  going: boolean;
  goal: { x: number; z: number };
  /** Whether it faces `face` while it stands. */
  facing: boolean;
  face: { x: number; z: number };
  /** The building the goal stands in, null out in the open; and its room there (0 outside). */
  building: Building | null;
  room: number;
  pace: 'walk' | 'run';
}

export function newWalk(): RoutineWalk {
  return { going: false, goal: { x: 0, z: 0 }, facing: false, face: { x: 0, z: 0 }, building: null, room: 0, pace: 'walk' };
}

/** Send a walk to a point: in a building's room, or out in the open with `building` null. */
export function walkTo(w: RoutineWalk, x: number, z: number, building: Building | null, room: number): void {
  w.going = true;
  w.goal.x = x;
  w.goal.z = z;
  w.building = building;
  w.room = building ? room : 0;
}

/** Stand, facing a point (or as it is, with none). */
export function standFacing(w: RoutineWalk, x: number | null, z: number | null): void {
  w.going = false;
  w.facing = x !== null && z !== null;
  if (w.facing) {
    w.face.x = x!;
    w.face.z = z!;
  }
}

/**
 * Which of the people of ours to put down to give the data's own people back model memory: a list in the
 * order they are to go (the farthest first), taken one by one until together they give back `want`
 * bytes -- `start` begins a set and `add` puts one in it and answers what the whole set gives back so far,
 * never a sum of each alone, since a body two of them wear goes only with both -- and then anybody the
 * rest cover without is let stay, the last taken tried first. Their places in the list are written into
 * `chosen`, and how many is the answer; nought, with nobody chosen, when the whole list together would
 * not give back enough, so a shortfall no amount of ours could cover costs none of them their place.
 * The rule the data's own people make room among themselves by (`StandingPeople.makeMemory`).
 */
export function giveBack<T>(list: readonly T[], n: number, want: number, start: () => void, add: (x: T) => number, chosen: number[]): number {
  chosen.length = 0;
  if (!(want > 0)) return 0;
  start();
  let got = 0;
  for (let i = 0; i < n && got < want; i++) {
    chosen.push(i);
    got = add(list[i]);
  }
  if (got < want) {
    chosen.length = 0;
    return 0;
  }
  for (let j = chosen.length - 1; j >= 0; j--) {
    start();
    let without = 0;
    for (let t = 0; t < chosen.length; t++) if (t !== j) without = add(list[chosen[t]]);
    if (without < want) continue;
    for (let t = j; t < chosen.length - 1; t++) chosen[t] = chosen[t + 1];
    chosen.length--;
  }
  return chosen.length;
}

/**
 * The thought of a body one of ours walks: no brain, no target, nothing on its mind but the walk it has
 * been given. `kept` is the decision the body keeps for its life, written over in place (one is made the
 * first time), as a town's walker's is (`thinkWalking`).
 */
export function walkDecision(kept: Decision | null, w: RoutineWalk): Decision {
  const d = kept ?? restDecision();
  d.targetKey = null;
  d.posture = 'stand';
  d.cover = false;
  d.attack = null;
  d.emote = null;
  d.clearMemory = false;
  if (w.going) {
    d.state = 'wander';
    d.goal = w.goal;
    d.moveTo = w.goal;
    d.face = w.goal;
    d.pace = w.pace;
  } else {
    d.state = 'idle';
    d.goal = null;
    d.moveTo = null;
    d.face = w.facing ? w.face : null;
    d.pace = 'stand';
  }
  return d;
}
