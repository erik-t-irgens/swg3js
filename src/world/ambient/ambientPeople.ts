// The people of ours: travellers at the ports and fillers in the buildings the data leaves empty,
// stood, walked and let go.
//
// Two kinds and one runner. **Travellers** belong to a port with a shuttle and a collector: each round
// of its shuttle has its departures, who come in through the starport's door, buy a ticket at a
// terminal in the terminal's own room, walk out to the collector and wait there until the shuttle has
// really landed, then walk to its ramp and are gone as they board -- and its arrivals, who step off as
// the landing ends and walk into town. Who comes and when is the port's own round and nothing else
// (`routines.ts`), so two browsers see the same people at the same moments with nothing sent. **Fillers**
// belong to a building the data has left empty (`fillers.ts`): a few people in its seats and on its open
// floor, each staying a while, then leaving through a door, and somebody new coming in a little later.
//
// **Every one of them is local, unattackable and part of the furniture.** They are stood under
// `ours:` names, which the server has never heard and never will (`sharesOnWire`), they take no damage
// and pick no fight (`Mobile.essential`), and they count against the cap on such people only after the
// data's own rows have taken their places (`StandingPeople.essentialUp`): when the data wants a place one
// of ours holds, the farthest of ours is put away, and when the data's own are short of model memory the
// fewest of ours, farthest first, who together give back what they were short of go -- and nobody, when
// all of ours together would not (`giveBack`). Their looks are drawn from the town's own stationary
// lists as the town's crowd is, and none is stood that would take the model memory past `OURS_TUNE.memory`
// of its budget: past that they wear the bodies already built, which cost nothing (`drawFitting`).
//
// **None of them is ever left stuck.** A walk that goes `ROUTINE_TUNE.giveUp` seconds without the body
// moving a metre, or `ROUTINE_TUNE.lost` without its getting a metre nearer, lets the walker go quietly, and a traveller whose shuttle leaves without it is let go
// then. A traveller met part way through its day -- somebody walking up to a starport in the middle of a
// round -- is stood where its day has got to (`departureStart`), not at the door.
//
// No Core3 data stands anywhere on Kashyyyk or Mustafar, and neither does anybody of ours (D13).
import * as THREE from 'three';
import type { Building, PlacedObject } from '../layoutStream.ts';
import type { DoorExit } from '../nav/doorway.ts';
import { DOOR_TUNE } from '../nav/doorway.ts';
import { locate, type NavFloor } from '../nav/navMesh.ts';
import type { Mobile } from '../mobiles/mobile.ts';
import type { MobileCatalogue } from '../mobiles/catalogue.ts';
import type { MobileEntry } from '../mobiles/types.ts';
import { PEOPLE_TUNE, overridesOf, weaponsOf, type PeopleDeps, type PersonOverrides, type PersonPlan, type StandingPeople } from '../standingPeople.ts';
import { TRAVEL_TUNE, shuttleAt, shuttleEvery, shuttleRound, type ShuttleRound, type ShuttleTimes } from '../travelTerminal.ts';
import { tuneTable } from '../wildLife.ts';
import { LIFT_CELL } from '../lifts.ts';
import {
  ROUTINE_TUNE,
  arrivalPhase,
  departurePhase,
  departureStart,
  firstOpenOut,
  giveBack,
  nearestRanked,
  newWalk,
  newHeadway,
  openRegion,
  rankedRegion,
  restartHeadway,
  sameRankedRegion,
  stalled,
  standFacing,
  stepDeparture,
  travellersOf,
  walkTo,
  type DepartureState,
  type Headway,
  type OpenOut,
  type RoutineWalk,
  type TravellerPlan,
} from './routines.ts';
import {
  FILLER_TUNE,
  buildingSeed,
  fillCount,
  fillKindOf,
  furnish,
  leaveSlot,
  leftEmpty,
  oursAllowedOn,
  openSlot,
  planSpots,
  slotDraw,
  stepSlot,
  type FillKind,
  type FillSlot,
  type FillSpot,
  type FloorRoom,
  type SeatCandidate,
} from './fillers.ts';

/** Every number of the runner, all of them ours; live through `__debug.ours({ tune })`. */
export const OURS_TUNE = {
  /** The switch: off, nobody of ours stands anywhere and those standing are put away. */
  on: true,
  /** How often the people of ours are looked after, seconds of the world's own clock. */
  every: 0.5,
  /** Metres from a port's pad within which its travellers are stood, and past which each is put away. */
  build: 160,
  drop: 220,
  /** Most stood in one pass in play; a loading screen's pass stands everybody due. */
  perPass: 2,
  /** The share of the model memory budget past which nobody more of ours is stood: the rest is the data's own people's. */
  memory: 0.85,
};

/**
 * The three tables of numbers the people of ours run on, each under the name `__debug.ours({ tune })`
 * moves it by: this runner's, the travellers' and the fillers'. Named apart because two of them share
 * key names that mean different things (`build`, `drop`, `reach`, `front`).
 */
export const TUNE_TABLES = { ours: OURS_TUNE, routine: ROUTINE_TUNE, fillers: FILLER_TUNE };
type TuneName = keyof typeof TUNE_TABLES;
const TUNE_NAMES = Object.keys(TUNE_TABLES) as TuneName[];

/** A port with a shuttle, as the game hands it over once its travel things are stood (`main.ts`). */
export interface AmbientPort {
  /** What it is called, for the console. */
  name: string;
  /** The name its shuttle's round runs under: the one the stood shuttle is posed by. */
  clock: string;
  /** Its shuttle's landing and lift-off, or null for the old glide. */
  times: ShuttleTimes | null;
  /** Where its shuttle stands, and in which room of its building (0 out in the open). */
  pad: { x: number; y: number; z: number; yaw: number; cell: number };
  collector: { x: number; y: number; z: number; yaw: number; cell: number } | null;
  terminals: { x: number; y: number; z: number; yaw: number; cell: number }[];
  /** Where the building the three belong to stands. */
  bx: number;
  bz: number;
  /** Where somebody boarding walks to, from a point: the ramp's foot or the hull's side; null while no shuttle stands. */
  boarding(towards: { x: number; z: number }, out: THREE.Vector3): THREE.Vector3 | null;
}

/** How one of ours is stood, beyond its body and its place. */
export interface OursSpawn {
  /** Its own name, which no other of ours has; the world stands it as `ours:<id>`. */
  id: string;
  seed: number;
  inside: boolean;
  room?: number;
  mood?: string;
  overrides?: PersonOverrides;
  weapons?: readonly string[];
  weaponGroups?: Readonly<Record<string, readonly string[]>> | null;
}

/** What the people of ours need of the game. */
export interface AmbientDeps {
  catalogue(): MobileCatalogue | null;
  spawn(entry: MobileEntry, at: { x: number; z: number; y?: number; heading?: number }, how: OursSpawn): Mobile | string;
  remove(m: Mobile): void;
  held(): boolean;
  /** The world these stand on, as its pack names it. */
  world(): string;
  /** The shared wall clock, seconds: the one every shuttle's round runs on. */
  seconds(): number;
  /** The streamed buildings with rooms. */
  buildings(): Iterable<Building>;
  /** The streamed building placed at a point, within a metre, or null. */
  buildingAt(x: number, z: number): Building | null;
  /** The placed objects inside buildings within `reach` of a point (`LayoutStreamer.containedNear`). */
  containedNear(x: number, z: number, reach: number, out: PlacedObject[]): number;
  /** The room of a building whose box holds a point, smallest first, or 0. */
  cellAt(b: Building, x: number, y: number, z: number): number;
  /** A building's ways in from the street (`DoorwayNav.exits`). */
  exits(b: Building): readonly DoorExit[];
  /** A room's walkable floor in the building's own frame, or null. */
  floor(b: Building, cell: number): NavFloor | null;
  /** The ground under a point. */
  groundAt(x: number, z: number): number;
  /** Whether the outdoor walk grid calls a point open ground; null with no grid, which takes every point. */
  walkable(x: number, z: number): boolean | null;
  /** Whether the walk grid can say a body at one point could walk to another at all; true where it cannot say. */
  reachable(x: number, z: number, goalX: number, goalZ: number): boolean;
  /**
   * The walk grid's region at a point: 0 blocked, 1 to 13 a ranked region, 14 a smaller one, 15 a
   * building's own footprint; -1 with no grid, which leaves every rule of ours as it was before.
   */
  region(x: number, z: number): number;
  /** Whether a room's floor is really there at a point (its collision built). */
  cellReady(x: number, y: number, z: number): boolean;
  /**
   * Heights of every upward-facing surface indoors on a vertical line, highest first, of what stands
   * still alone (fixed or bodiless colliders): a body walking over a spot is not furniture on it.
   */
  floorsAt(x: number, z: number, top: number, bottom: number): number[];
  /** Model memory in use and its budget, bytes. */
  memory(): { used: number; budget: number };
  /** What standing one more of an entry would add to that memory: nought for a body already built. */
  cost(entry: MobileEntry): number;
  /** The data's own people: their places, their towns' lists and how many of the cap they hold. */
  people: StandingPeople;
  peopleDeps(): PeopleDeps;
}

/** A place a traveller stands or walks to, in the world, and the room it is in. */
interface Place {
  x: number;
  y: number;
  z: number;
  building: Building | null;
  room: number;
}

/**
 * Where an arrival walks into town to, and what it does there. `x`, `z` the point it walks to, out on
 * open ground. A cantina's or a hotel's has its doorstep in `stepX`, `stepZ`, which it walks on to from
 * there, straight along the door's own line, and goes in at: made for at the open ground outside the door
 * (the doorstep is the building's own footprint on the walk grid, which plans no way to it), it would
 * otherwise vanish in the open street several metres short of the door, in plain view. NaN for none: a
 * spot in town is where it is finished, as it always was. `hold` is a goal that is neither -- the open
 * ground outside the starport's door, when nowhere was sure to be reachable from there, or the nearest
 * ground it could reach after a stall -- where it is finished only while nobody sees it go
 * (`letGoOffScreen`, at most `letGoWait` held in view).
 */
interface ArrivalGoal {
  x: number;
  z: number;
  stepX: number;
  stepZ: number;
  hold: boolean;
}

/** A way into a building from outside: the point a step outside it, and the way out through it. */
interface Door {
  outX: number;
  outZ: number;
  dirX: number;
  dirZ: number;
}

/** One port as the travellers use it, worked out once its buildings have streamed in. */
interface PortPlan {
  index: number;
  port: AmbientPort;
  ready: boolean;
  /** Why it is not ready, for the console; tried again at most every two seconds. */
  why: string;
  triedAt: number;
  /** The building its terminals stand in, where they stand in one. */
  building: Building | null;
  doors: Door[];
  /**
   * Of its building's ways in, the one onto its pads (the nearest the collector) and the one from the
   * street (the nearest its terminals of the others): a departure comes in by the second and goes out
   * to the collector by the first, where the pads are walled in behind the building.
   */
  padDoor: Door | null;
  streetDoor: Door | null;
  /**
   * The first open ground of the walk grid out along its street door's line (`firstOpenOut`; on every
   * Tatooine starport a ranked region), or null with no grid, no street door, or `clearOut` off: where an
   * arrival steps out to before it makes for town, where its walk into town is measured from, and where
   * one with nowhere it can reach is finished. Worked out for the `clearOut` in force (`streetFor`, NaN
   * before it has been), and again whenever that moves, so the switch is one flip either way
   * (`streetOf`).
   */
  street: OpenOut | null;
  streetFor: number;
  /**
   * Its terminals as their users see them: `x`, `z` the spot somebody using one stands on, in front of
   * it; `faceX`, `faceZ` the terminal itself, which that somebody faces; `yaw` the way from the one to the
   * other, which the second and third of a round stand either side of.
   */
  terminals: { x: number; y: number; z: number; faceX: number; faceZ: number; yaw: number; building: Building | null; room: number }[];
  collector: Place & { yaw: number };
  pad: Place;
  board: Place | null;
  /**
   * Cantina and hotel doors near the pad, nearest first, when they were last looked for, and the
   * `clearOut` they were found with (they are looked for again when it moves): each one as an arrival
   * makes for it (`ArrivalGoal`), and the walk grid's region of the ground it makes for (-1 with no grid
   * or none found), which is what an arrival's reach to it is judged by.
   */
  towns: (ArrivalGoal & { region: number })[];
  townsAt: number;
  townsFor: number;
  draw: [string, number][] | null;
  /** The straight lengths of a departure's two walks, which place one met part way through its day. */
  legs: { toTerminal: number; toCollector: number };
  /** Its rounds about now and the travellers of them, kept and written over every pass. */
  rounds: ShuttleRound[];
  plans: TravellerPlan[];
  count: number;
}

/** A building of ours to fill, worked out once. */
interface FillPlan {
  building: Building;
  kind: FillKind | null;
  seed: number;
  /** Whether the data leaves it empty: only then is anybody of ours stood in it. */
  empty: boolean;
  spots: FillSpot[];
  doors: Door[];
  draw: [string, number][] | null;
  slots: FillSlot[];
  bodies: (OursRecord | null)[];
  /** Spots found blocked by what stands on them (a table's top over a floor spot), for this visit. */
  blocked: boolean[];
  active: boolean;
  why: string;
}

/** One of ours standing, and what it is doing. */
interface OursRecord {
  id: string;
  /** A traveller's number (`travellerNum`), which a pass looks it up by without making a string; -1 for a filler. */
  num: number;
  kind: 'depart' | 'arrive' | 'filler';
  body: Mobile;
  walk: RoutineWalk;
  track: Headway;
  who: string;
  port: PortPlan | null;
  plan: TravellerPlan | null;
  state: DepartureState;
  terminal: PortPlan['terminals'][number] | null;
  wait: Place | null;
  dest: ArrivalGoal | null;
  fill: FillPlan | null;
  slot: number;
  /** An arrival on the last leg from the open ground outside a cantina or a hotel to its doorstep (`ArrivalGoal.stepX`). */
  doorstep: boolean;
  /** An arrival still to pass through its starport's building on the way into town. */
  through: boolean;
  /**
   * A door to go by first: a departure's way out to the collector through the door onto the pads while it
   * is still inside, and an arrival's way from the ramp to that same door before it goes in.
   */
  via: Door | null;
  /**
   * An arrival still to step out of the starport's street door onto the open ground of the walk grid past
   * its doorstep (`PortPlan.street`) before it makes for town: from the doorstep, which is the building's own
   * footprint on the grid, the grid could plan it no way anywhere, and it steered straight at a cantina round
   * the corner of the starport's own front.
   */
  out: boolean;
  /** Whether its walk has been sent once to the nearest spot it can reach, after it stalled (`ROUTINE_TUNE.replanOnce`). */
  replanned: boolean;
  /**
   * Where a walk stalled off the walk grid's open ground (pressed into the clutter round a prop, whose cells
   * the grid calls blocked) is sent first by its one try more: the nearest ranked ground about it, of its
   * goal's region where that is one, from which the grid can plan it a way round; null otherwise.
   */
  detour: { x: number; z: number } | null;
  /**
   * When a stalled walk was first held from being let go because it was on screen, or an arrival from being
   * finished at a goal that is not a door (`ArrivalGoal.hold`), NaN while it is not (`letGoOffScreen`).
   */
  heldSince: number;
  /** Its account for `__debug.ours({ trace: true })`, while tracing; null otherwise. */
  trace: OursTrace | null;
}

/**
 * One of ours as the console's trace keeps it (`__debug.ours({ trace: true })`): the seconds it spent in
 * each room (keyed by the room's number, 0 outside), the step-up lifts its body made, the tier it was
 * last drawn at, how it ended, and for a let-go where it stood and where it was going, with the walk
 * grid's regions of both.
 */
export interface OursTrace {
  id: string;
  kind: 'depart' | 'arrive' | 'filler';
  port: string;
  since: number;
  seconds: number;
  rooms: Record<string, number>;
  lifts: number;
  /**
   * The step-up lifts by the room the body was in when a pass counted them (the same keys as `rooms`): the
   * one measure that says how a walk through a hall with a flight of steps in it (Mos Eisley's arrivals hall,
   * cell 7) was spent, since the whole walk's lifts take in every porch and doorstep on the way.
   */
  liftsByRoom: Record<string, number>;
  liftsAt: number;
  tier: string;
  replanned: boolean;
  ended: string;
  letGo: { at: [number, number]; goal: [number, number] | null; atRegion: number; goalRegion: number; onScreen: boolean } | null;
  /** When the account was last passed, whether the body was in a building then, and the seconds at which it first came out of one (NaN for not yet). */
  at: number;
  wasInside: boolean;
  doorAfter: number;
}

/** What a pass stands, nearest first: a traveller of a port, or a filler's place in a building. */
interface Candidate {
  d: number;
  port: PortPlan | null;
  plan: TravellerPlan | null;
  stage: DepartureState['stage'];
  standUntil: number;
  fill: FillPlan | null;
  slot: number;
}

const tmpV = new THREE.Vector3();
const tmpBoard = new THREE.Vector3();

/** A seat's mood: the chair's idle, lent from a species rig as a town's seated people are (`moodIdle.ts`). */
export const SEATED = 'npc_sitting_chair';

/** How many finished accounts the console's trace keeps (`__debug.ours({ trace: true })`). */
const TRACE_KEPT = 80;

/** `ROUTINE_TUNE.clearOut` as it is used: its metres, or 0 for off (a negative number or none at all). */
function clearOutNow(): number {
  const c = ROUTINE_TUNE.clearOut;
  return c > 0 ? c : 0;
}

/** Whether a body is drawn on the screen as its tier last had it: near, mid or far are on it; hidden, frozen or none yet are not. */
function onScreen(m: Mobile): boolean {
  const t = m.tier?.name;
  return t === 'near' || t === 'mid' || t === 'far';
}

export class AmbientPeople {
  private ports: PortPlan[] = [];
  private portsFor = '';
  private readonly records = new Map<string, OursRecord>();
  /** The travellers standing, by their numbers. */
  private readonly travelling = new Map<number, OursRecord>();
  /** Travellers whose day is over for their round (boarded, left behind, let go), by number, with the round. */
  private readonly done = new Map<number, number>();
  private fills = new WeakMap<Building, FillPlan>();
  private readonly active = new Set<FillPlan>();
  private since = 0;
  private scannedAt = -Infinity;
  private readonly scannedFrom = new THREE.Vector3(NaN, NaN, NaN);
  private readonly candidates: Candidate[] = [];
  private candidateCount = 0;
  private readonly scratchState: DepartureState = { stage: 'enter', standUntil: 0 };
  private readonly contained: PlacedObject[] = [];
  /** Kept for giving model memory back (`shedForMemory`): the people of ours farthest first, how far each is, and which go. */
  private readonly shedList: OursRecord[] = [];
  private readonly shedAway: number[] = [];
  private readonly shedChosen: number[] = [];
  /** The data's pass (`StandingPeople.last.pass`) whose shortfall ours last answered: one shortfall, one answer. */
  private yieldedFor = -1;
  /** The data's own deps while a set is counted, and the two kept calls `giveBack` counts it with. */
  private yieldDeps: PeopleDeps | null = null;
  private readonly yieldStart = (): void => {
    this.yieldDeps?.freeStart?.();
  };
  private readonly yieldAdd = (r: OursRecord): number => this.yieldDeps?.frees?.(r.body) ?? 0;
  /** What has happened since the world loaded, for the console. */
  readonly tally = { stood: 0, boarded: 0, missed: 0, arrived: 0, outwalked: 0, letGo: 0, left: 0, shed: 0, replanned: 0, heldInView: 0, refused: '' };
  /** Whether the console's trace is kept (`__debug.ours({ trace: true })`), and the accounts of those whose day is over, the latest last. */
  private tracing = false;
  private readonly traced: OursTrace[] = [];

  /**
   * The ports of the world just stood, with their shuttles' clocks; handed over again whenever the
   * world's travel things are stood again. Anybody walking for a port that is gone is put away.
   */
  usePorts(pack: string, ports: readonly AmbientPort[], deps?: AmbientDeps | null): void {
    for (const r of [...this.travelling.values()]) {
      if (deps && !r.body.removed) deps.remove(r.body);
      this.drop(r);
    }
    this.portsFor = pack;
    this.done.clear();
    this.forgetCandidates();
    this.ports = ports.map((port, index) => ({
      index,
      port,
      ready: false,
      why: 'not planned yet',
      triedAt: -Infinity,
      building: null,
      doors: [],
      padDoor: null,
      streetDoor: null,
      street: null,
      streetFor: Number.NaN,
      terminals: [],
      collector: { x: 0, y: 0, z: 0, building: null, room: 0, yaw: 0 },
      pad: { x: port.pad.x, y: port.pad.y, z: port.pad.z, building: null, room: 0 },
      board: null,
      towns: [],
      townsAt: -Infinity,
      townsFor: Number.NaN,
      draw: null,
      legs: { toTerminal: 20, toCollector: 40 },
      rounds: [0, 1, 2].map(() => ({ slot: 0, land: 0, wait: 0, leave: 0, gone: 0 })),
      plans: [],
      count: 0,
    }));
  }

  /**
   * The kept pool of candidates let go of whatever the last pass put in it: a pass writes over only the
   * entries it fills, so the rest would go on holding the ports, the buildings and the bodies of a world
   * that has gone.
   */
  private forgetCandidates(): void {
    for (const c of this.candidates) {
      c.port = null;
      c.plan = null;
      c.fill = null;
    }
    this.candidateCount = 0;
    this.shedList.length = 0;
    this.shedAway.length = 0;
    this.shedChosen.length = 0;
  }

  /** One of ours taken off the books: out of the records, and out of the travellers when it is one; its trace kept as done. */
  private drop(r: OursRecord): void {
    this.records.delete(r.id);
    if (r.num >= 0 && this.travelling.get(r.num) === r) this.travelling.delete(r.num);
    const t = r.trace;
    if (t) {
      if (!t.ended) t.ended = 'put away';
      this.traced.push(t);
      if (this.traced.length > TRACE_KEPT) this.traced.shift();
      r.trace = null;
    }
  }

  /** The world going: everything of ours is forgotten (the manager takes the bodies with it). */
  unload(): void {
    this.records.clear();
    this.travelling.clear();
    this.done.clear();
    this.ports = [];
    this.portsFor = '';
    this.fills = new WeakMap();
    this.active.clear();
    this.forgetCandidates();
    this.contained.length = 0;
    this.yieldedFor = -1;
    this.since = 0;
    this.scannedAt = -Infinity;
    this.scannedFrom.set(NaN, NaN, NaN);
    this.tally.stood = 0;
    this.tally.boarded = 0;
    this.tally.missed = 0;
    this.tally.arrived = 0;
    this.tally.outwalked = 0;
    this.tally.letGo = 0;
    this.tally.left = 0;
    this.tally.shed = 0;
    this.tally.replanned = 0;
    this.tally.heldInView = 0;
    this.tally.refused = '';
    this.traced.length = 0;
  }

  /** Everybody of ours put away now; the buildings are met afresh, and the travellers stood again where their day has got to. */
  clear(deps: AmbientDeps): void {
    for (const r of this.records.values()) if (!r.body.removed) deps.remove(r.body);
    this.records.clear();
    this.travelling.clear();
    for (const f of this.active) this.deactivate(f, deps);
    this.active.clear();
    this.forgetCandidates();
    this.scannedAt = -Infinity;
  }

  /** How many of ours stand. */
  get count(): number {
    return this.records.size;
  }

  /**
   * One pass. `now` is the world's own clock (what a stay and a stall are timed on); the shuttles' rounds
   * run on the shared wall clock (`deps.seconds`). `force` stands everybody due at once, for a loading
   * screen.
   */
  step(dt: number, now: number, at: THREE.Vector3, deps: AmbientDeps, force = false): void {
    if (!OURS_TUNE.on || !oursAllowedOn(deps.world())) {
      if (this.records.size || this.active.size) this.clear(deps);
      return;
    }
    if (deps.held() && !force) return;
    if (!deps.catalogue() || !deps.people.inWorld) return;
    this.since += dt;
    if (!force && this.since < OURS_TUNE.every) return;
    this.since = 0;
    const seconds = deps.seconds();
    // Everybody standing first: a place somebody left fills on this same pass.
    for (const r of this.records.values()) this.walkOne(r, now, seconds, at, deps);
    this.forgetOldRounds(seconds);
    this.scanBuildings(now, at, deps);
    // The cap on part-of-the-furniture people, after the data's own have taken their places.
    const allowance = Math.max(0, PEOPLE_TUNE.mostEssential - deps.people.essentialUp);
    if (this.records.size > allowance) this.shed(this.records.size - allowance, at, deps);
    // The data's own people short of model memory with nobody of their own farther off to give it back:
    // the farthest of ours who together give back what they are short of go, whatever the cap has left
    // ours, and before a full share of it stops this pass. One wearing a body the data's own wear too
    // gives nothing back and stays, and so may more of those come: they cost nothing (`fits`).
    this.shedForMemory(at, deps);
    if (this.records.size >= allowance) return;
    this.gather(now, seconds, at, deps);
    const list = this.candidates;
    const n = this.candidateCount;
    // Nearest first, over the filled part of the kept pool alone, in place: an insertion sort, since a
    // pass has a few dozen at most and a library sort may make a working copy.
    for (let i = 1; i < n; i++) {
      const c = list[i];
      let j = i - 1;
      while (j >= 0 && list[j].d > c.d) {
        list[j + 1] = list[j];
        j--;
      }
      list[j + 1] = c;
    }
    let stood = 0;
    for (let i = 0; i < n && this.records.size < allowance; i++) {
      if (!force && stood >= OURS_TUNE.perPass) break;
      if (this.standOne(list[i], now, seconds, deps)) stood++;
    }
  }

  // ---------------------------------------------------------------- who is due

  private candidate(): Candidate {
    let c = this.candidates[this.candidateCount];
    if (!c) {
      c = { d: 0, port: null, plan: null, stage: 'enter', standUntil: 0, fill: null, slot: 0 };
      this.candidates.push(c);
    }
    this.candidateCount++;
    c.port = null;
    c.plan = null;
    c.fill = null;
    c.slot = 0;
    c.standUntil = 0;
    return c;
  }

  /** Every traveller and every place in a building due to be stood this pass, with how far each is. */
  private gather(now: number, seconds: number, at: THREE.Vector3, deps: AmbientDeps): void {
    this.candidateCount = 0;
    for (const pp of this.ports) {
      const away = Math.hypot(pp.port.pad.x - at.x, pp.port.pad.z - at.z);
      if (away > OURS_TUNE.build) continue;
      if (!pp.ready && now - pp.triedAt >= 2) this.planPort(pp, now, deps);
      if (!pp.ready) continue;
      // The cantinas and hotels an arrival walks to stream in on their own time: looked for again while there
      // are none, and at once when `clearOut` moves, since where each is made for is worked out with it.
      if ((!pp.towns.length && now - pp.townsAt >= 5) || pp.townsFor !== clearOutNow()) {
        pp.townsAt = now;
        pp.townsFor = clearOutNow();
        pp.towns = townDoors(pp.port.pad.x, pp.port.pad.z, pp.building, deps);
      }
      this.roundsOf(pp, seconds);
      for (let i = 0; i < pp.count; i++) {
        const p = pp.plans[i];
        const num = travellerNum(pp, p);
        if (this.travelling.has(num) || this.done.has(num)) continue;
        let stage: DepartureState['stage'] = 'enter';
        if (p.kind === 'depart') {
          const s = departureStart(p, seconds, pp.legs, this.scratchState);
          if (!s) continue;
          stage = s;
        } else if (arrivalPhase(p, seconds) !== 'walk' || seconds - p.appearAt > ROUTINE_TUNE.late) continue;
        const c = this.candidate();
        c.d = away;
        c.port = pp;
        c.plan = p;
        c.stage = stage;
        c.standUntil = this.scratchState.standUntil;
      }
    }
    for (const f of this.active) {
      if (!f.empty || !f.draw) continue;
      const away = Math.max(0, Math.hypot(f.building.x - at.x, f.building.z - at.z) - f.building.radius);
      for (let i = 0; i < f.slots.length; i++) {
        if (f.bodies[i] || f.blocked[i]) continue;
        const slot = f.slots[i];
        // Nobody stood for a place whose stay ran out meanwhile (the cap was full, the memory short): it
        // left unseen, and the place waits for the next.
        if (slot.state === 'leaving' || (slot.state === 'staying' && now >= slot.leaveAt)) {
          leaveSlot(slot, now, f.seed, i);
          continue;
        }
        if (slot.state === 'empty') stepSlot(slot, now, false, false, f.seed, i);
        if (slot.state === 'empty') continue;
        // A newcomer comes in by a door; a building with none keeps the people it began with.
        if (slot.state === 'entering' && !f.doors.length) continue;
        const c = this.candidate();
        c.d = away;
        c.fill = f;
        c.slot = i;
      }
    }
  }

  /** A port's rounds about now -- the last, this one and the next -- and the travellers of each. */
  private roundsOf(pp: PortPlan, seconds: number): void {
    const every = shuttleEvery(TRAVEL_TUNE, pp.port.times);
    const slot = Math.floor(seconds / every);
    let n = 0;
    for (let k = 0; k < 3; k++) {
      const r = shuttleRound(pp.port.clock, slot - 1 + k, TRAVEL_TUNE, pp.port.times, pp.rounds[k]);
      n = travellersOf(pp.port.clock, r, pp.terminals.length, pp.plans, n);
    }
    pp.count = n;
  }

  /** A day that is over is remembered while its round is about, so its traveller is not stood again. */
  private forgetOldRounds(seconds: number): void {
    if (!this.done.size) return;
    // The longest round of any port here, which is every port's but a slow rig's: a day is forgotten
    // two of those after its round, when no port can still be in it.
    let every = shuttleEvery(TRAVEL_TUNE, null);
    for (const pp of this.ports) every = Math.max(every, shuttleEvery(TRAVEL_TUNE, pp.port.times));
    const oldest = Math.floor(seconds / every) - 2;
    for (const [key, round] of this.done) if (round < oldest) this.done.delete(key);
  }

  // ---------------------------------------------------------------- standing

  /**
   * Whether a body fits in the share of the model memory budget the people of ours may use: what it
   * would add, which is nought for a body already built -- and most of ours are, since a crowd drawn from
   * a town's lists leans on the bodies standing (`reuseLook`) -- on top of what is held. The rest of the
   * budget is left to the data's own people, who make room among themselves and never among ours.
   */
  private fits(entry: MobileEntry, deps: AmbientDeps): boolean {
    const mem = deps.memory();
    const cost = deps.cost(entry);
    // A body already built costs nothing, whatever the data's own people have made of the budget.
    if (cost <= 0 || !(mem.budget > 0) || mem.used + cost <= mem.budget * OURS_TUNE.memory) return true;
    this.tally.refused = `model memory: ${entry.id} would take it past ${Math.round(OURS_TUNE.memory * 100)}% of its budget`;
    return false;
  }

  /**
   * Somebody out of a town's lists whose body fits the memory left to ours (`fits`): first the body the
   * draw names, whatever is built, so a room of ours is as varied as the lists are while the memory has
   * room for it -- leaning on the bodies standing as the town's crowd does put the first body drawn in a
   * room on all ten of an empty cantina's people -- then, where that body would cost memory, the same
   * person on a body already built, then a few more people of the same lists on bodies already built. So
   * in a town whose own people have filled the budget ours still stand, wearing the looks already
   * standing, and only where nobody of the lists has a body built is nobody stood. Null then.
   */
  private drawFitting(draw: readonly [string, number][], seed: number, life: number, cat: MobileCatalogue, deps: AmbientDeps): { person: PersonPlan; entry: MobileEntry } | null {
    const pd = deps.peopleDeps();
    for (let k = 0; k < 6; k++) {
      const s = k < 2 ? seed : (seed ^ Math.imul(k, 0x9e3779b1)) >>> 0;
      const person = deps.people.drawPerson(draw, s, life, pd, k === 0 ? 0 : 1);
      const entry = person ? cat.byId(person.id) : null;
      if (person && entry && this.fits(entry, deps)) return { person, entry };
    }
    return null;
  }

  /** Stand one candidate. False when it could not be stood this pass (it is asked again on the next). */
  private standOne(c: Candidate, now: number, seconds: number, deps: AmbientDeps): boolean {
    const cat = deps.catalogue();
    if (!cat) return false;
    if (c.port && c.plan) return this.standTraveller(c.port, c.plan, c.stage, c.standUntil, now, seconds, cat, deps);
    if (c.fill) return this.standFiller(c.fill, c.slot, now, cat, deps);
    return false;
  }

  private standTraveller(pp: PortPlan, p: TravellerPlan, stage: DepartureState['stage'], standUntil: number, now: number, seconds: number, cat: MobileCatalogue, deps: AmbientDeps): boolean {
    const key = travellerKey(pp, p);
    const num = travellerNum(pp, p);
    const drawn = pp.draw ? this.drawFitting(pp.draw, p.seed, 1, cat, deps) : null;
    if (!drawn) return false;
    const { person, entry } = drawn;
    // Where it stands: where its day has got to.
    const plan = { ...p };
    let where: Place | null = null;
    let heading = 0;
    let terminal: PortPlan['terminals'][number] | null = null;
    let wait: Place | null = null;
    let dest: ArrivalGoal | null = null;
    if (p.kind === 'depart') {
      terminal = p.terminal >= 0 && pp.terminals.length ? pp.terminals[p.terminal % pp.terminals.length] : null;
      wait = this.waitSpot(pp, p, deps);
      // Faced toward the terminal itself (`faceX`, `faceZ`), never the spot in front of it that it walks
      // to: one stood on that spot would face a point under its own feet.
      if (stage === 'enter') {
        where = this.comeFrom(pp, p, deps);
        if (terminal && where) heading = Math.atan2(terminal.faceX - where.x, terminal.faceZ - where.z);
      } else if (stage === 'terminal' && terminal) {
        where = this.terminalSpot(terminal, p);
        heading = Math.atan2(terminal.faceX - where.x, terminal.faceZ - where.z);
      } else {
        where = stage === 'out' ? (this.comeFrom(pp, p, deps) ?? wait) : wait;
        heading = Math.atan2(pp.pad.x - wait.x, pp.pad.z - wait.z);
      }
    } else {
      if (!pp.board) return false;
      // Stepping off a little way out from where the departures board, each of a round's arrivals to one side.
      const b = pp.board;
      const ox = b.x - pp.pad.x;
      const oz = b.z - pp.pad.z;
      const ol = Math.hypot(ox, oz) || 1;
      const side = ((p.index % 3) - 1) * ROUTINE_TUNE.beside;
      where = { x: b.x + (ox / ol) * ROUTINE_TUNE.clear - (oz / ol) * side, y: b.y, z: b.z + (oz / ol) * ROUTINE_TUNE.clear + (ox / ol) * side, building: b.building, room: b.room };
      dest = this.destination(pp, p, deps);
      if (!dest) {
        this.done.set(num, p.round);
        return false;
      }
      heading = Math.atan2(dest.x - where.x, dest.z - where.z);
    }
    if (!where) {
      this.tally.refused = `nowhere to stand ${key} at its ${stage}`;
      return false;
    }
    const inside = !!where.building && where.room > 0;
    if (inside && !deps.cellReady(where.x, where.y, where.z)) {
      this.tally.refused = `the room ${key} stands in at its ${stage} is not built yet`;
      return false;
    }
    const m = deps.spawn(entry, inside ? { x: where.x, y: where.y, z: where.z, heading } : { x: where.x, z: where.z, heading }, {
      id: key,
      seed: p.seed,
      inside,
      room: inside ? where.room : undefined,
      overrides: overridesOf(person.creature),
      weapons: weaponsOf(person.creature),
      weaponGroups: null,
    });
    if (typeof m === 'string') {
      this.tally.refused = m;
      return false;
    }
    const r: OursRecord = {
      id: key,
      num,
      kind: p.kind,
      body: m,
      walk: newWalk(),
      track: newHeadway(now),
      who: person.who,
      port: pp,
      plan,
      state: { stage: p.kind === 'depart' ? stage : 'enter', standUntil },
      terminal,
      wait,
      dest,
      fill: null,
      slot: 0,
      doorstep: false,
      through: p.kind === 'arrive' && !pp.pad.building && !!this.throughSpot(pp),
      via: p.kind === 'arrive' && !pp.pad.building && !!this.throughSpot(pp) ? pp.padDoor : null,
      out: p.kind === 'arrive' && !!pp.building && !!this.streetOf(pp, deps),
      replanned: false,
      detour: null,
      heldSince: Number.NaN,
      trace: null,
    };
    m.routine = r.walk;
    this.traceStart(r, now);
    this.aim(r);
    this.records.set(key, r);
    this.travelling.set(num, r);
    this.tally.stood++;
    return true;
  }

  private standFiller(f: FillPlan, i: number, now: number, cat: MobileCatalogue, deps: AmbientDeps): boolean {
    const slot = f.slots[i];
    const spot = f.spots[i];
    const seed = (f.seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
    const drawn = f.draw ? this.drawFitting(f.draw, seed, slot.life + 1, cat, deps) : null;
    if (!drawn) return false;
    const { person, entry } = drawn;
    const b = f.building;
    let where: Place;
    let heading = spot.heading;
    if (slot.state === 'entering') {
      const door = f.doors[Math.floor(slotDraw(f.seed, i, slot.life, 3) * f.doors.length) % f.doors.length];
      // First seen on the open ground outside the door, where the walk grid can say it walks in from.
      const along = this.openAlong(door, deps);
      where = { x: door.outX + door.dirX * along, y: 0, z: door.outZ + door.dirZ * along, building: null, room: 0 };
      heading = Math.atan2(-door.dirX, -door.dirZ);
    } else {
      where = { x: spot.x, y: spot.y, z: spot.z, building: b, room: spot.cell };
      if (!deps.cellReady(spot.x, spot.y, spot.z)) return false;
      // Open floor must be open: a table's top or a counter over the spot, which the floor mesh does not
      // know about, sends it to another visit.
      if (!spot.seat) {
        const floors = deps.floorsAt(spot.x, spot.z, spot.y + 1.9, spot.y - 0.5);
        if (!floors.length) return false;
        if (floors[0] > spot.y + 0.35) {
          f.blocked[i] = true;
          return false;
        }
      }
    }
    const inside = where.building !== null;
    const id = `f:${Math.round(b.x)},${Math.round(b.z)}:${i}:${slot.life}`;
    const m = deps.spawn(entry, inside ? { x: where.x, y: where.y, z: where.z, heading } : { x: where.x, z: where.z, heading }, {
      id,
      seed,
      inside,
      room: inside ? where.room : undefined,
      mood: spot.seat ? SEATED : undefined,
      overrides: overridesOf(person.creature),
      weapons: weaponsOf(person.creature),
      weaponGroups: null,
    });
    if (typeof m === 'string') {
      this.tally.refused = m;
      return false;
    }
    m.seatedIdleOnly = spot.seat;
    const r: OursRecord = {
      id,
      num: -1,
      kind: 'filler',
      body: m,
      walk: newWalk(),
      track: newHeadway(now),
      who: person.who,
      port: null,
      plan: null,
      state: { stage: 'enter', standUntil: 0 },
      terminal: null,
      wait: null,
      dest: null,
      fill: f,
      slot: i,
      doorstep: false,
      through: false,
      via: null,
      out: false,
      replanned: false,
      detour: null,
      heldSince: Number.NaN,
      trace: null,
    };
    m.routine = r.walk;
    this.traceStart(r, now);
    this.aimFiller(r);
    f.bodies[i] = r;
    this.records.set(id, r);
    this.tally.stood++;
    return true;
  }

  /** A filler at its place: sat on its seat, or standing on the floor facing the way it was given. */
  private settle(r: OursRecord): void {
    const f = r.fill!;
    const spot = f.spots[r.slot];
    if (spot.seat) r.body.sit(spot.x, spot.y, spot.z, spot.heading);
    standFacing(r.walk, spot.x + Math.sin(spot.heading) * 2, spot.z + Math.cos(spot.heading) * 2);
  }

  // ---------------------------------------------------------------- walking

  /**
   * Where a filler walks, or how it stands, for the state of its place: in to its spot (the front of its
   * seat), settled there, or out through the door its leaving draws. Where it is first sent, and where it
   * is sent on from anything that took it aside (a stalled walk's detour, `replan`).
   */
  private aimFiller(r: OursRecord): void {
    const f = r.fill;
    if (!f) return;
    const i = r.slot;
    const slot = f.slots[i];
    const spot = f.spots[i];
    if (slot.state === 'staying') {
      this.settle(r);
      return;
    }
    if (slot.state === 'leaving' && f.doors.length) {
      const door = f.doors[Math.floor(slotDraw(f.seed, i, slot.life, 4) * f.doors.length) % f.doors.length];
      walkTo(r.walk, door.outX + door.dirX * 1.5, door.outZ + door.dirZ * 1.5, null, 0);
      return;
    }
    walkTo(r.walk, spot.seat ? spot.frontX : spot.x, spot.seat ? spot.frontZ : spot.z, f.building, spot.cell);
  }

  /** Where a traveller walks, or what it faces, for the stage it is in; a filler's is `aimFiller`. */
  private aim(r: OursRecord): void {
    if (r.kind === 'filler') {
      this.aimFiller(r);
      return;
    }
    const pp = r.port;
    if (!pp) return;
    const w = r.walk;
    if (r.kind === 'arrive') {
      // Through the starport first, where its pads are walled in behind it, and then out into town.
      // By the door onto its pads, then into the building, then out of it into town: the way in from the
      // pads is not one a straight line from the ramp finds, since a wing of the building stands between.
      const via = r.through ? this.throughSpot(pp) : null;
      if (r.via) walkTo(w, r.via.outX + r.via.dirX * 0.5, r.via.outZ + r.via.dirZ * 0.5, null, 0);
      else if (via) walkTo(w, via.x, via.z, via.building, via.room);
      // Out of the street door onto the open ground past its doorstep, where the walk grid plans from.
      else if (r.out && pp.street) walkTo(w, pp.street.x, pp.street.z, null, 0);
      // On from the open ground outside a cantina's or a hotel's door to the doorstep it goes in at.
      else if (r.doorstep && r.dest && Number.isFinite(r.dest.stepX)) walkTo(w, r.dest.stepX, r.dest.stepZ, null, 0);
      else walkTo(w, r.dest!.x, r.dest!.z, null, 0);
      return;
    }
    switch (r.state.stage) {
      case 'enter': {
        const t = r.terminal;
        if (t) {
          const s = this.terminalSpot(t, r.plan!);
          walkTo(w, s.x, s.z, s.building, s.room);
        } else standFacing(w, pp.pad.x, pp.pad.z);
        break;
      }
      case 'terminal':
        // The terminal itself, not the spot it stands on in front of it (`faceX`, `faceZ`).
        if (r.terminal) standFacing(w, r.terminal.faceX, r.terminal.faceZ);
        break;
      case 'out':
        if (r.via) walkTo(w, r.via.outX + r.via.dirX * 1.5, r.via.outZ + r.via.dirZ * 1.5, null, 0);
        else walkTo(w, r.wait!.x, r.wait!.z, r.wait!.building, r.wait!.room);
        break;
      case 'waiting':
        standFacing(w, pp.pad.x, pp.pad.z);
        break;
      case 'board':
        if (pp.board) walkTo(w, pp.board.x, pp.board.z, pp.board.building, pp.board.room);
        break;
    }
  }

  /** One of ours looked after for one pass. */
  private walkOne(r: OursRecord, now: number, seconds: number, at: THREE.Vector3, deps: AmbientDeps): void {
    const m = r.body;
    if (m.removed || m.dead) {
      this.lose(r, now, deps, false);
      return;
    }
    if (r.trace) this.tracePass(r, now);
    const away = Math.hypot(m.pos.x - at.x, m.pos.z - at.z);
    // Out of range, a traveller is put away and stood again where its day has got to when the player
    // comes back; a filler goes with its building (`scanBuildings`).
    if (r.kind !== 'filler' && away > OURS_TUNE.drop) {
      deps.remove(m);
      this.drop(r);
      return;
    }
    const w = r.walk;
    const d = w.going ? Math.hypot(w.goal.x - m.pos.x, w.goal.z - m.pos.z) : 0;
    const still = !m.ready || !(m.tier?.move ?? true) || m.seated;
    // Off the clutter it was stalled in (`replan`'s detour) and on open ground again: back to where it was going.
    if (r.detour && d <= ROUTINE_TUNE.reach * 1.5) {
      r.detour = null;
      restartHeadway(r.track, now);
      this.aim(r);
      return;
    }
    if (r.kind === 'depart') {
      // Late -- its shuttle down and waiting -- it hurries.
      w.pace = seconds >= r.plan!.wait ? 'run' : 'walk';
      // A door still to go by first is passed, and the walk sent on to the collector, before anything is
      // taken for having got there: the goal is the point outside the door until then, and reaching it
      // before the manager has followed the body out of its room would have it wait by the door.
      if (r.via && !r.detour && (!m.inside || d <= ROUTINE_TUNE.reach)) {
        r.via = null;
        restartHeadway(r.track, now);
        this.aim(r);
        return;
      }
      const was = r.state.stage;
      const reach = was === 'board' ? ROUTINE_TUNE.board : ROUTINE_TUNE.reach;
      const stage = stepDeparture(r.state, r.plan!, seconds, !r.detour && !r.via && w.going && d <= reach);
      if (stage === 'boarded' || stage === 'gone') {
        if (stage === 'boarded') this.tally.boarded++;
        else this.tally.missed++;
        this.finish(r, deps, stage === 'boarded' ? 'boarded' : 'missed its shuttle');
        return;
      }
      if (stage !== was) {
        // Out to the collector through the door onto the pads, while it is still inside the building.
        r.via = stage === 'out' && m.inside && !r.wait?.building ? (r.port?.padDoor ?? null) : null;
        restartHeadway(r.track, now);
        this.aim(r);
        return;
      }
    } else if (r.kind === 'arrive') {
      if (arrivalPhase(r.plan!, seconds) === 'gone') {
        this.tally.outwalked++;
        this.finish(r, deps, 'outwalked');
        return;
      }
      if (r.via && !r.detour && d <= ROUTINE_TUNE.reach * 2) {
        r.via = null;
        restartHeadway(r.track, now);
        this.aim(r);
        return;
      }
      // Into the building and on to its terminals, whose room is by the street door, before making for town.
      if (r.through && !r.via && !r.detour && m.inside && d <= ROUTINE_TUNE.reach * 3) {
        r.through = false;
        restartHeadway(r.track, now);
        this.aim(r);
        return;
      }
      // Out of the street door and onto the open ground past its doorstep, then on to town.
      if (r.out && !r.through && !r.via && !r.detour && !m.inside && d <= ROUTINE_TUNE.reach * 2) {
        r.out = false;
        restartHeadway(r.track, now);
        this.aim(r);
        return;
      }
      if (!r.through && !r.via && !r.out && !r.detour && d <= ROUTINE_TUNE.reach) {
        const g = r.dest;
        // At the open ground outside a cantina's or a hotel's door: on to its doorstep, straight along the
        // door's own line, and in there -- never gone in the open street short of the door.
        if (g && !r.doorstep && Number.isFinite(g.stepX)) {
          r.doorstep = true;
          restartHeadway(r.track, now);
          this.aim(r);
          return;
        }
        // Finished at a goal that is no door (`ArrivalGoal.hold`): only while nobody sees it go, at most
        // `letGoWait` held there in view.
        if (g && g.hold && ROUTINE_TUNE.letGoOffScreen && onScreen(m)) {
          if (Number.isNaN(r.heldSince)) r.heldSince = now;
          if (now - r.heldSince < ROUTINE_TUNE.letGoWait) return;
        }
        this.tally.arrived++;
        this.finish(r, deps, 'arrived');
        return;
      }
    } else if (this.walkFiller(r, now, d, deps)) return;
    if (w.going && stalled(r.track, d, m.pos.x, m.pos.z, now, still, ROUTINE_TUNE.giveUp, ROUTINE_TUNE.lost)) {
      // Once, sent to the nearest spot it can surely reach, on a fresh route and a fresh account of its walk.
      if (ROUTINE_TUNE.replanOnce && !r.replanned) {
        this.replan(r, now, deps);
        this.tally.replanned++;
        return;
      }
      // Let go only where nobody sees it vanish: held while it is on screen, at most `letGoWait`.
      const seen = onScreen(m);
      if (ROUTINE_TUNE.letGoOffScreen && seen) {
        if (Number.isNaN(r.heldSince)) {
          r.heldSince = now;
          this.tally.heldInView++;
        }
        if (now - r.heldSince < ROUTINE_TUNE.letGoWait) return;
      }
      this.tally.letGo++;
      if (r.trace) this.traceLetGo(r, deps, seen);
      this.lose(r, now, deps, true);
    } else if (!Number.isNaN(r.heldSince)) r.heldSince = Number.NaN;
  }

  /**
   * A stalled walk sent once more before it is let go (`ROUTINE_TUNE.replanOnce`): its route thrown away so
   * the grid or the floors are asked afresh from where it stands, its headway begun again, and one walking
   * out in the open to a spot of its own in town (an arrival past its building) sent instead to the nearest
   * ground to that spot in the ranked region it is standing in (`nearestRanked`), which it can surely reach.
   */
  private replan(r: OursRecord, now: number, deps: AmbientDeps): void {
    r.replanned = true;
    if (r.trace) r.trace.replanned = true;
    const m = r.body;
    const w = r.walk;
    m.navAgent.clear();
    restartHeadway(r.track, now);
    if (m.inside || !(ROUTINE_TUNE.clearOut > 0)) return;
    const here = deps.region(m.pos.x, m.pos.z);
    const goal = deps.region(w.goal.x, w.goal.z);
    // Stalled off open ground, out in the open (pressed into the clutter round a prop): first to the nearest
    // ranked ground about it -- of its goal's region where that is one -- from which the grid can plan it a
    // way round, and then on to where it was going.
    if (here >= 0 && !openRegion(here)) {
      const o = this.openNear(m.pos.x, m.pos.z, deps, rankedRegion(goal) ? goal : 0);
      if (o) {
        r.detour = { x: o.x, z: o.z };
        walkTo(w, o.x, o.z, null, 0);
      }
      return;
    }
    if (r.kind !== 'arrive' || r.via || r.through || r.out) return;
    if (!rankedRegion(here) || goal === here) return;
    const o = this.openNear(w.goal.x, w.goal.z, deps, here);
    if (!o) return;
    // No door there: finished only while nobody sees it go (`ArrivalGoal.hold`).
    r.dest = { x: o.x, z: o.z, stepX: Number.NaN, stepZ: Number.NaN, hold: true };
    r.doorstep = false;
    walkTo(w, o.x, o.z, null, 0);
  }

  // ---------------------------------------------------------------- the console's trace

  /** Whether the console's trace is being kept. */
  get tracingOn(): boolean {
    return this.tracing;
  }

  /** The trace switched on or off (`__debug.ours({ trace })`): on, everybody stood from now on keeps an account; off, the accounts are dropped. */
  setTracing(on: boolean): void {
    this.tracing = on;
    if (on) return;
    for (const r of this.records.values()) r.trace = null;
    this.traced.length = 0;
  }

  /** A fresh account for one of ours just stood, while tracing. */
  private traceStart(r: OursRecord, now: number): void {
    if (!this.tracing) return;
    r.trace = {
      id: `ours:${r.id}`,
      kind: r.kind,
      port: r.port?.port.name ?? '',
      since: now,
      seconds: 0,
      rooms: {},
      lifts: 0,
      liftsByRoom: {},
      liftsAt: r.body.stepLifts,
      tier: r.body.tier?.name ?? '',
      replanned: false,
      ended: '',
      letGo: null,
      at: now,
      wasInside: r.body.inside,
      doorAfter: Number.NaN,
    };
  }

  /** One pass of an account: the seconds since the last spent in the room the body is in now, its lifts, its tier, and when it first came out of a building it was in. */
  private tracePass(r: OursRecord, now: number): void {
    const t = r.trace!;
    const m = r.body;
    const key = m.inside ? String(m.room) : '0';
    t.rooms[key] = (t.rooms[key] ?? 0) + Math.max(0, now - t.at);
    t.at = now;
    t.seconds = now - t.since;
    const lifts = m.stepLifts - t.liftsAt;
    if (lifts > t.lifts) t.liftsByRoom[key] = (t.liftsByRoom[key] ?? 0) + (lifts - t.lifts);
    t.lifts = lifts;
    t.tier = m.tier?.name ?? '';
    if (t.wasInside && !m.inside && Number.isNaN(t.doorAfter)) t.doorAfter = t.seconds;
    t.wasInside = m.inside;
  }

  /** A let-go written into its account: where it stood and where it was going, with the walk grid's regions of both, and whether it was on screen. */
  private traceLetGo(r: OursRecord, deps: AmbientDeps, seen: boolean): void {
    const t = r.trace!;
    const m = r.body;
    const w = r.walk;
    const round = (n: number): number => Math.round(n * 10) / 10;
    t.letGo = {
      at: [round(m.pos.x), round(m.pos.z)],
      goal: w.going ? [round(w.goal.x), round(w.goal.z)] : null,
      atRegion: deps.region(m.pos.x, m.pos.z),
      goalRegion: w.going ? deps.region(w.goal.x, w.goal.z) : -1,
      onScreen: seen,
    };
    t.ended = 'let go';
  }

  /**
   * The console's trace: every account still running and the last `TRACE_KEPT` finished, each with its
   * seconds by room, its lifts, its tier and how it ended; and for the arrivals, the mean seconds spent in
   * each room and how long it took them from the ramp to come out of the building's front door.
   */
  traceReport(): Record<string, unknown> {
    const live = [...this.records.values()].map((r) => r.trace).filter((t): t is OursTrace => !!t);
    const all = [...this.traced, ...live];
    const round = (n: number): number => Math.round(n * 10) / 10;
    const show = (t: OursTrace) => ({ id: t.id, kind: t.kind, port: t.port, seconds: round(t.seconds), rooms: Object.fromEntries(Object.entries(t.rooms).map(([k, v]) => [k, round(v)])), lifts: t.lifts, liftsByRoom: { ...t.liftsByRoom }, tier: t.tier, replanned: t.replanned, ended: t.ended || 'walking', out: Number.isNaN(t.doorAfter) ? null : round(t.doorAfter), letGo: t.letGo });
    const arrivals = all.filter((t) => t.kind === 'arrive');
    const rooms: Record<string, number> = {};
    for (const t of arrivals) for (const [k, v] of Object.entries(t.rooms)) rooms[k] = (rooms[k] ?? 0) + v;
    const liftsIn: Record<string, number> = {};
    for (const t of arrivals) for (const [k, v] of Object.entries(t.liftsByRoom)) liftsIn[k] = (liftsIn[k] ?? 0) + v;
    const outs = arrivals.map((t) => t.doorAfter).filter((v) => !Number.isNaN(v));
    return {
      on: this.tracing,
      tally: { ...this.tally },
      arrivals: {
        count: arrivals.length,
        meanSecondsByRoom: Object.fromEntries(Object.entries(rooms).map(([k, v]) => [k, round(v / Math.max(1, arrivals.length))])),
        outOfTheBuilding: outs.length ? { n: outs.length, mean: round(outs.reduce((a, b) => a + b, 0) / outs.length), max: round(Math.max(...outs)) } : null,
        liftsEach: arrivals.length ? round(arrivals.reduce((a, t) => a + t.lifts, 0) / arrivals.length) : null,
        // The lifts each arrival made in each room: Mos Eisley's arrivals hall is cell 7.
        meanLiftsByRoom: Object.fromEntries(Object.entries(liftsIn).map(([k, v]) => [k, round(v / Math.max(1, arrivals.length))])),
      },
      letGo: all.filter((t) => t.letGo).map(show),
      live: live.map(show),
      done: this.traced.map(show),
    };
  }

  /** A filler's pass: in to its place, its stay, and out through a door. Answers whether it is done with. */
  private walkFiller(r: OursRecord, now: number, d: number, deps: AmbientDeps): boolean {
    const f = r.fill!;
    const i = r.slot;
    const slot = f.slots[i];
    const m = r.body;
    const was = slot.state;
    const arrived = was === 'entering' && m.inside && d <= FILLER_TUNE.reach;
    const out = was === 'leaving' && (!m.inside || d <= ROUTINE_TUNE.reach);
    const state = stepSlot(slot, now, arrived, out, f.seed, i);
    if (state === was) return false;
    if (state === 'staying') {
      this.settle(r);
      restartHeadway(r.track, now);
      return false;
    }
    if (state === 'leaving') {
      if (!f.doors.length) {
        // Nowhere to leave by: it stays, and the place with it.
        slot.state = 'staying';
        slot.leaveAt = Infinity;
        return false;
      }
      const spot = f.spots[i];
      if (m.seated) m.rise(spot.frontX, spot.frontZ);
      // Out through the door its leaving draws.
      this.aimFiller(r);
      restartHeadway(r.track, now);
      return false;
    }
    // Out of the building, or gone: the place waits for the next.
    this.tally.left++;
    if (r.trace) r.trace.ended = 'left';
    deps.remove(m);
    this.drop(r);
    f.bodies[i] = null;
    return true;
  }

  /** A traveller whose day is over: gone from the world and remembered for its round. */
  private finish(r: OursRecord, deps: AmbientDeps, why = 'done'): void {
    if (r.trace) r.trace.ended = why;
    if (!r.body.removed) deps.remove(r.body);
    this.drop(r);
    if (r.plan) this.done.set(r.num, r.plan.round);
  }

  /**
   * One of ours gone by some other way: taken by the game, or let go for want of headway (`letGo`). A
   * traveller let go is remembered for its round; one the game took is stood again. A filler's place
   * waits for somebody new.
   */
  private lose(r: OursRecord, now: number, deps: AmbientDeps, letGo: boolean): void {
    if (r.trace && !r.trace.ended) r.trace.ended = letGo ? 'let go' : 'taken by the game';
    if (!r.body.removed) deps.remove(r.body);
    this.drop(r);
    if (r.fill) {
      r.fill.bodies[r.slot] = null;
      leaveSlot(r.fill.slots[r.slot], now, r.fill.seed, r.slot);
    } else if (letGo && r.plan) this.done.set(r.num, r.plan.round);
  }

  /** The farthest of ours put away to leave the cap's places to the data's own people. */
  private shed(n: number, at: THREE.Vector3, deps: AmbientDeps): void {
    const list = [...this.records.values()].sort((a, b) => Math.hypot(b.body.pos.x - at.x, b.body.pos.z - at.z) - Math.hypot(a.body.pos.x - at.x, a.body.pos.z - at.z));
    for (let k = 0; k < n && k < list.length; k++) {
      const r = list[k];
      if (!r.body.removed) deps.remove(r.body);
      this.drop(r);
      if (r.fill) r.fill.bodies[r.slot] = null;
      this.tally.shed++;
    }
  }

  /**
   * The people of ours who give the data's own people back the model memory they were short of, put
   * away: the fewest of ours, farthest first, who together give back what the data's last pass could not
   * find among its own (`StandingPeople.last.shortBytes`, the least any of its rows was short by), and
   * nobody at all when all of ours together would not (`giveBack`), so a row no amount of ours could make
   * room for costs none of them their place. Once for each pass of the data's that was short
   * (`last.pass`), however many times this runner looks in between.
   */
  private shedForMemory(at: THREE.Vector3, deps: AmbientDeps): void {
    const last = deps.people.last;
    if (!(last.shortBytes > 0) || last.pass === this.yieldedFor || !this.records.size) return;
    this.yieldedFor = last.pass;
    const pd = deps.peopleDeps();
    if (!pd.freeStart || !pd.frees) return;
    // Farthest first, over kept lists: an insertion sort, as the pass's own.
    const list = this.shedList;
    const away = this.shedAway;
    list.length = 0;
    away.length = 0;
    for (const r of this.records.values()) {
      if (r.body.removed) continue;
      const d = Math.hypot(r.body.pos.x - at.x, r.body.pos.z - at.z);
      let j = list.length;
      list.push(r);
      away.push(d);
      while (j > 0 && away[j - 1] < d) {
        list[j] = list[j - 1];
        away[j] = away[j - 1];
        j--;
      }
      list[j] = r;
      away[j] = d;
    }
    this.yieldDeps = pd;
    const n = giveBack(list, list.length, last.shortBytes, this.yieldStart, this.yieldAdd, this.shedChosen);
    this.yieldDeps = null;
    for (let k = 0; k < n; k++) {
      const r = list[this.shedChosen[k]];
      if (!r.body.removed) deps.remove(r.body);
      this.drop(r);
      if (r.fill) r.fill.bodies[r.slot] = null;
      // A traveller put away for memory is done with for its round, rather than stood again where its day
      // has got to on the next pass in a body that costs nothing, which would be seen as a jump.
      else if (r.plan) this.done.set(r.num, r.plan.round);
      this.tally.shed++;
    }
    list.length = 0;
    away.length = 0;
    this.shedChosen.length = 0;
  }

  // ---------------------------------------------------------------- a port's places

  /**
   * A port's places, once its buildings have streamed in: its terminals' standing spots in their own
   * rooms, its collector, its pad and the foot of its shuttle's ramp, its building's ways in, the
   * cantinas and hotels near it an arrival walks to, and the town's lists its travellers are drawn from.
   */
  private planPort(pp: PortPlan, now: number, deps: AmbientDeps): void {
    pp.triedAt = now;
    const port = pp.port;
    if (!port.collector) {
      pp.why = 'no ticket collector';
      return;
    }
    pp.draw = deps.people.townDraw(port.bx, port.bz);
    if (!pp.draw) {
      pp.why = 'no town on this world has a stationary list to draw a traveller from';
      return;
    }
    const indoors = port.terminals.some((t) => t.cell > 0) || port.collector.cell > 0 || port.pad.cell > 0;
    const b = indoors ? deps.buildingAt(port.bx, port.bz) : null;
    if (indoors && !b) {
      pp.why = "the port's building has not streamed in";
      return;
    }
    pp.building = b;
    pp.doors = b ? doorsOf(b, deps) : [];
    pp.padDoor = null;
    pp.streetDoor = null;
    if (pp.doors.length) {
      const c0 = port.collector;
      const t0 = port.terminals.find((t) => t.cell > 0) ?? null;
      let padD = Infinity;
      for (const d of pp.doors) {
        const dd = Math.hypot(d.outX - c0.x, d.outZ - c0.z);
        if (dd < padD) {
          padD = dd;
          pp.padDoor = d;
        }
      }
      let streetD = Infinity;
      for (const d of pp.doors) {
        if (d === pp.padDoor && pp.doors.length > 1) continue;
        const dd = t0 ? Math.hypot(d.outX - t0.x, d.outZ - t0.z) : 0;
        if (dd < streetD) {
          streetD = dd;
          pp.streetDoor = d;
        }
      }
    }
    // The open ground outside the street door, which the walk grid can say where from is reachable.
    pp.streetFor = Number.NaN;
    this.streetOf(pp, deps);
    pp.terminals = port.terminals.map((t) => {
      const room = t.cell > 0 && b ? t.cell : 0;
      const fx = Math.sin(t.yaw);
      const fz = Math.cos(t.yaw);
      // In front of it, or behind where the front is not floor: which way a terminal faces is its own
      // turn, and a terminal set against a wall faces away from the wall.
      let sx = t.x + fx * ROUTINE_TUNE.front;
      let sz = t.z + fz * ROUTINE_TUNE.front;
      if (room && b && !onFloor(b, room, sx, t.y, sz, deps) && onFloor(b, room, t.x - fx * ROUTINE_TUNE.front, t.y, t.z - fz * ROUTINE_TUNE.front, deps)) {
        sx = t.x - fx * ROUTINE_TUNE.front;
        sz = t.z - fz * ROUTINE_TUNE.front;
      }
      return { x: sx, y: t.y, z: sz, faceX: t.x, faceZ: t.z, yaw: Math.atan2(t.x - sx, t.z - sz), building: room ? b : null, room };
    });
    const c = port.collector;
    pp.collector = { x: c.x, y: c.y, z: c.z, yaw: c.yaw, building: c.cell > 0 ? b : null, room: c.cell > 0 ? c.cell : 0 };
    pp.pad = { x: port.pad.x, y: port.pad.y, z: port.pad.z, building: port.pad.cell > 0 ? b : null, room: port.pad.cell > 0 ? port.pad.cell : 0 };
    const foot = port.boarding({ x: c.x, z: c.z }, tmpBoard);
    if (!foot) {
      pp.why = 'its shuttle is not stood yet';
      return;
    }
    // A step off the hull: the ramp's foot is the far edge of the ramp itself, and the hull is solid.
    const ox = foot.x - port.pad.x;
    const oz = foot.z - port.pad.z;
    const ol = Math.hypot(ox, oz) || 1;
    pp.board = { x: foot.x + (ox / ol) * ROUTINE_TUNE.clear, y: foot.y, z: foot.z + (oz / ol) * ROUTINE_TUNE.clear, building: pp.pad.building, room: pp.pad.room };
    pp.towns = townDoors(port.pad.x, port.pad.z, b, deps);
    pp.townsAt = now;
    pp.townsFor = clearOutNow();
    const t0 = pp.terminals[0];
    const d0 = pp.doors[0];
    pp.legs.toTerminal = t0 && d0 ? Math.hypot(t0.x - d0.outX, t0.z - d0.outZ) : t0 ? ROUTINE_TUNE.approach[0] : 0;
    pp.legs.toCollector = t0 ? Math.hypot(t0.x - c.x, t0.z - c.z) : ROUTINE_TUNE.approach[0];
    pp.ready = true;
    pp.why = '';
  }

  /** Where an arrival passes through its starport: at the first terminal indoors, or null for a port with none. */
  private throughSpot(pp: PortPlan): Place | null {
    for (const t of pp.terminals) if (t.room > 0) return { x: t.x, y: t.y, z: t.z, building: t.building, room: t.room };
    return null;
  }

  /** Where a departure stands at its terminal: in front of it, and a little to one side for the second and third of a round. */
  private terminalSpot(t: PortPlan['terminals'][number], p: TravellerPlan): Place {
    const side = (p.index % 3) - (p.index % 3 === 2 ? 3 : 0);
    const rx = Math.cos(t.yaw);
    const rz = -Math.sin(t.yaw);
    return { x: t.x + rx * side * ROUTINE_TUNE.beside, y: t.y, z: t.z + rz * side * ROUTINE_TUNE.beside, building: t.building, room: t.room };
  }

  /** Where by the collector a departure waits: on the pad's side of it, spread either side of the line to the pad. */
  private waitSpot(pp: PortPlan, p: TravellerPlan, deps: AmbientDeps): Place {
    const c = pp.collector;
    const base = Math.atan2(pp.pad.x - c.x, pp.pad.z - c.z);
    const ring = ROUTINE_TUNE.ring;
    for (let k = 0; k < 2; k++) {
      const a = k === 0 ? base + (p.spot - 0.5) * 2 * ROUTINE_TUNE.spread : base;
      const r = k === 0 ? ring[0] + p.far * Math.max(0, ring[1] - ring[0]) : ring[0];
      const x = c.x + Math.sin(a) * r;
      const z = c.z + Math.cos(a) * r;
      if (c.building || k === 1 || deps.walkable(x, z) !== false) return { x, y: c.y, z, building: c.building, room: c.room };
    }
    return { x: c.x, y: c.y, z: c.z, building: c.building, room: c.room };
  }

  /**
   * Where a departure is first seen: a step outside a door of the building its terminal stands in, or,
   * for a terminal out in the open (a shuttleport's), some way off it on open ground.
   */
  private comeFrom(pp: PortPlan, p: TravellerPlan, deps: AmbientDeps): Place | null {
    const door = pp.streetDoor;
    if (pp.building && door && p.terminal >= 0 && pp.terminals.some((t) => t.room > 0)) {
      // In from the street, by the door nearest the terminals that is not the one onto the pads; a little
      // to one side of it for each of a round's departures, so two coming in together are not one on the other.
      // Out on the open ground of the walk grid (`openAlong`), and a step to one side only where that is too.
      const along = this.openAlong(door, deps);
      let side = ((p.index % 3) - 1) * ROUTINE_TUNE.beside;
      if (side !== 0 && ROUTINE_TUNE.clearOut > 0) {
        const r = deps.region(door.outX + door.dirX * along - door.dirZ * side, door.outZ + door.dirZ * along + door.dirX * side);
        if (r >= 0 && !openRegion(r)) side = 0;
      }
      return { x: door.outX + door.dirX * along - door.dirZ * side, y: 0, z: door.outZ + door.dirZ * along + door.dirX * side, building: null, room: 0 };
    }
    const from = p.terminal >= 0 && pp.terminals.length ? pp.terminals[p.terminal % pp.terminals.length] : pp.collector;
    const span = ROUTINE_TUNE.approach;
    const r = span[0] + p.far * Math.max(0, span[1] - span[0]);
    for (let k = 0; k < 8; k++) {
      const a = (p.door + k / 8) * Math.PI * 2;
      const x = from.x + Math.sin(a) * r;
      const z = from.z + Math.cos(a) * r;
      if (deps.walkable(x, z) !== false) return { x, y: 0, z, building: null, room: 0 };
    }
    return null;
  }

  /** Where an arrival walks to: a cantina's or a hotel's door near the pad, most of the time, and otherwise off into town. */
  private destination(pp: PortPlan, p: TravellerPlan, deps: AmbientDeps): ArrivalGoal | null {
    // Out into the street in front of the starport's street door, where it has one: a spot out from the
    // pad itself may be round the back of a building whose pads are walled in, which no walk reaches.
    // And only somewhere the walk grid says can be walked to from there.
    const door = pp.building ? pp.streetDoor : null;
    // Measured from open ground the arrival really stands on on its way (`originOf`): the first open ground
    // outside that door, not the doorstep, which is the building's own footprint on the grid; or, at a pad
    // out in the open, the ranked ground nearest the foot of its ramp, since a shuttleport's pad is blocked
    // ground for metres round. Where that ground is ranked, reachable is the strict answer, both ends in
    // that one region (`sameRankedRegion`), which the general one never refuses when either end is
    // unranked. Where there is no such ground -- no grid, `clearOut` off, or none near enough to say -- the
    // general answer from where it always was measured, and the nearest cantina as the last resort, as it
    // always was: a strict rule with nothing to be strict from would refuse every arrival at the port.
    const from = this.originOf(pp, door, deps);
    const strict = !!from && rankedRegion(from.region);
    const ox = from ? from.x : door ? door.outX : pp.pad.x;
    const oz = from ? from.z : door ? door.outZ : pp.pad.z;
    const reach = (x: number, z: number, region = deps.region(x, z)): boolean => (strict ? sameRankedRegion(from!.region, region) : deps.reachable(ox, oz, x, z));
    if (pp.towns.length && p.door < ROUTINE_TUNE.toDoor) {
      const k = Math.min(pp.towns.length - 1, Math.floor(p.spot * Math.min(3, pp.towns.length)));
      for (let j = 0; j < pp.towns.length; j++) {
        const t = pp.towns[(k + j) % pp.towns.length];
        if (reach(t.x, t.z, t.region)) return t;
      }
    }
    const span = ROUTINE_TUNE.townWalk;
    const r = span[0] + p.far * Math.max(0, span[1] - span[0]);
    const base = door ? Math.atan2(door.dirX, door.dirZ) : p.spot * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      const a = door ? base + (((p.spot + k / 8) % 1) - 0.5) * 2 * ROUTINE_TUNE.spread : base + (k / 8) * Math.PI * 2;
      const x = ox + Math.sin(a) * r;
      const z = oz + Math.cos(a) * r;
      if (deps.walkable(x, z) === true && reach(x, z)) return { x, z, stepX: Number.NaN, stepZ: Number.NaN, hold: false };
    }
    // Nowhere it can be sure of reaching: it is finished on that open ground, and only while nobody sees it
    // go, rather than sent at a cantina whose region nobody asked.
    if (strict) return { x: from!.x, z: from!.z, stepX: Number.NaN, stepZ: Number.NaN, hold: true };
    return pp.towns[0] ?? null;
  }

  /**
   * The open ground an arrival's walk into town is judged from (`destination`): past its starport's street
   * door, the first open ground out along the door's line (`streetOf`); at a pad out in the open, the
   * ranked ground nearest the foot of its ramp (the pad itself where there is none yet), within twice
   * `clearOut` -- measured over every converted world, a shuttleport's pad is blocked ground for fourteen
   * to seventeen metres round its middle, and ranked ground is found within that reach of the ramp at every
   * one but four, whose pads stand in blocked ground for tens of metres and which keep the general rule
   * (`oursStreet.test.ts`). Null with no grid, `clearOut` off, or nothing found.
   */
  private originOf(pp: PortPlan, door: Door | null, deps: AmbientDeps): OpenOut | null {
    const out = clearOutNow();
    if (!(out > 0)) return null;
    if (door) return this.streetOf(pp, deps);
    const at = pp.board ?? pp.pad;
    return this.openNear(at.x, at.z, deps, 0, 2 * out);
  }

  /**
   * A port's `street` for the `clearOut` in force: worked out the first time it is asked for and again
   * whenever `clearOut` has moved since (`streetFor`), so flipping the switch in play takes effect for the
   * next traveller stood, both ways. Allocates only when it is worked out.
   */
  private streetOf(pp: PortPlan, deps: AmbientDeps): OpenOut | null {
    const out = clearOutNow();
    if (pp.streetFor === out) return pp.street;
    pp.streetFor = out;
    pp.street = null;
    if (pp.streetDoor && out > 0) {
      const o: OpenOut = { x: 0, z: 0, d: 0, region: -1 };
      if (firstOpenOut(pp.streetDoor, deps.region, o, out)) pp.street = o;
    }
    return pp.street;
  }

  /** The kept answer `openAlong` and `openNear` write into. */
  private readonly openScratch: OpenOut = { x: 0, z: 0, d: 0, region: -1 };

  /**
   * How far out along a door's line one of ours is stood or sent to the street by (`firstOpenOut`): the
   * first open ground of the walk grid, or the old `outside` where that is already on the same
   * ground (a step clear of the doorway), or where there is no grid or `clearOut` is off.
   */
  private openAlong(door: Door, deps: AmbientDeps): number {
    const old = ROUTINE_TUNE.outside;
    if (!(ROUTINE_TUNE.clearOut > 0)) return old;
    const o = this.openScratch;
    if (!firstOpenOut(door, deps.region, o)) return old;
    if (o.d < old && deps.region(door.outX + door.dirX * old, door.outZ + door.dirZ * old) === o.region) return old;
    return o.d;
  }

  /** The nearest open, ranked ground about a point (`nearestRanked`), within `max` (`clearOut` by default), as a record of its own; null with none or no grid. */
  private openNear(x: number, z: number, deps: AmbientDeps, want = 0, max = ROUTINE_TUNE.clearOut): OpenOut | null {
    const o: OpenOut = { x: 0, z: 0, d: 0, region: -1 };
    return nearestRanked(x, z, deps.region, want, Math.max(1, max), o) ? o : null;
  }

  // ---------------------------------------------------------------- the buildings

  /** The buildings near the player met, and the ones left behind put away; at most twice a second, or on a move. */
  private scanBuildings(now: number, at: THREE.Vector3, deps: AmbientDeps): void {
    const moved = !Number.isFinite(this.scannedFrom.x) || this.scannedFrom.distanceTo(at) > 5;
    if (!moved && now - this.scannedAt < 2) return;
    this.scannedAt = now;
    this.scannedFrom.copy(at);
    for (const f of this.active) {
      const away = Math.hypot(f.building.x - at.x, f.building.z - at.z) - f.building.radius;
      if (away > FILLER_TUNE.drop) {
        this.deactivate(f, deps);
        this.active.delete(f);
      }
    }
    for (const b of deps.buildings()) {
      const away = Math.hypot(b.x - at.x, b.z - at.z) - b.radius;
      if (away > FILLER_TUNE.build) continue;
      let f = this.fills.get(b);
      if (!f) {
        f = this.planBuilding(b, deps);
        this.fills.set(b, f);
      }
      if (f.active || !f.empty || !f.spots.length || !f.draw) continue;
      f.active = true;
      for (let i = 0; i < f.slots.length; i++) {
        openSlot(f.slots[i], now, f.seed, i);
        f.bodies[i] = null;
        f.blocked[i] = false;
      }
      this.active.add(f);
    }
  }

  /** A building left behind: its people put away, and its places met afresh when it is come back to. */
  private deactivate(f: FillPlan, deps: AmbientDeps): void {
    for (let i = 0; i < f.bodies.length; i++) {
      const r = f.bodies[i];
      if (!r) continue;
      if (!r.body.removed) deps.remove(r.body);
      this.drop(r);
      f.bodies[i] = null;
    }
    f.active = false;
  }

  /**
   * A building's people of ours, worked out once: what kind of place it is, whether the data leaves it
   * empty, how many of ours it holds, where each stands (its seats first, then open floor), its ways in,
   * and the town's lists they are drawn from.
   */
  private planBuilding(b: Building, deps: AmbientDeps): FillPlan {
    const kind = fillKindOf(b.template);
    const seed = buildingSeed(b.template, b.x, b.z);
    const f: FillPlan = { building: b, kind, seed, empty: false, spots: [], doors: [], draw: null, slots: [], bodies: [], blocked: [], active: false, why: '' };
    if (!kind) {
      f.why = 'not a kind of building anybody of ours stands in';
      return f;
    }
    // The data's own people standing in it make it the data's (`leftEmpty`, which the node test holds).
    const frame = { x: b.x, z: b.z, radius: b.radius, bounds: { min: b.model.bounds.min.toArray(), max: b.model.bounds.max.toArray() }, inverse: b.inverse.elements };
    if (!leftEmpty(frame, deps.people)) {
      f.why = "the data's own people stand in it";
      return f;
    }
    f.empty = true;
    f.draw = deps.people.townDraw(b.x, b.z);
    if (!f.draw) {
      f.why = 'no town on this world has a stationary list to draw anybody from';
      return f;
    }
    const count = fillCount(kind, seed);
    if (!count) {
      f.why = 'its draw came to nobody';
      return f;
    }
    // Its furniture, found in its rooms by where each piece stands.
    const shafts = new Set((b.model.def.cells ?? []).filter((c) => LIFT_CELL.test(c.name ?? '')).map((c) => c.index));
    deps.containedNear(b.x, b.z, b.radius + 2, this.contained);
    const seats: SeatCandidate[] = [];
    const avoid: { x: number; z: number }[] = [];
    furnish(this.contained, (o) => deps.cellAt(b, o.x, o.y, o.z), shafts, FILLER_TUNE.seatTurn, seats, avoid);
    this.contained.length = 0;
    const rooms: FloorRoom[] = [];
    for (const c of b.model.def.cells ?? []) {
      if (c.index <= 0 || shafts.has(c.index)) continue;
      const floor = deps.floor(b, c.index);
      if (!floor) continue;
      rooms.push({
        cell: c.index,
        floor,
        toWorld: (x, y, z, out) => {
          tmpV.set(x, y, z).applyMatrix4(b.matrix);
          out.x = tmpV.x;
          out.y = tmpV.y;
          out.z = tmpV.z;
        },
      });
    }
    f.spots = planSpots(seats, rooms, avoid, count, seed);
    f.doors = doorsOf(b, deps);
    f.slots = f.spots.map(() => ({ state: 'empty' as const, life: 0, nextAt: 0, leaveAt: 0 }));
    f.bodies = f.spots.map(() => null);
    f.blocked = f.spots.map(() => false);
    if (!f.spots.length) f.why = 'no seat and no open floor found in it';
    return f;
  }

  // ---------------------------------------------------------------- the console

  /** Everything of ours standing, nearest first, each marked as ours. */
  list(at: THREE.Vector3): Record<string, unknown>[] {
    return [...this.records.values()]
      .map((r) => {
        const m = r.body;
        const stage = r.kind === 'filler' ? (r.fill?.slots[r.slot].state ?? '') : r.kind === 'arrive' ? 'walking into town' : r.state.stage;
        return {
          ours: true,
          id: `ours:${r.id}`,
          kind: r.kind,
          stage,
          who: r.who,
          body: m.entry.id,
          away: Math.round(Math.hypot(m.pos.x - at.x, m.pos.z - at.z)),
          room: m.room,
          at: [Math.round(m.pos.x * 10) / 10, Math.round(m.pos.z * 10) / 10],
          inside: m.inside,
          door: m.legs.phase === 0 ? null : m.legs.phase === 1 ? 'approaching' : 'walking through',
          via: r.via ? 'a door first' : r.through ? 'through the building' : r.out ? 'out onto the street' : r.doorstep ? 'in at the door' : null,
          seated: m.seated,
          going: r.walk.going ? Math.round(Math.hypot(r.walk.goal.x - m.pos.x, r.walk.goal.z - m.pos.z) * 10) / 10 : null,
          port: r.port?.port.name ?? null,
          building: r.fill ? String((r.fill.building.model.def as { id?: string }).id ?? r.fill.building.template) : null,
          stuck: m.stuckEvents,
        };
      })
      .sort((a, b) => a.away - b.away);
  }

  /** The counts by kind and stage, the cap left, and what has happened. */
  report(deps: AmbientDeps | null): Record<string, unknown> {
    const stages: Record<string, number> = {};
    for (const r of this.records.values()) {
      const k = r.kind === 'filler' ? `filler ${r.fill?.slots[r.slot].state ?? ''}${r.body.seated ? ' (seated)' : ''}` : r.kind === 'arrive' ? 'arrival walking' : `departure ${r.state.stage}`;
      stages[k] = (stages[k] ?? 0) + 1;
    }
    const mem = deps?.memory();
    return {
      on: OURS_TUNE.on,
      world: deps?.world() ?? null,
      allowed: deps ? oursAllowedOn(deps.world()) : null,
      ours: this.records.size,
      stages,
      cap: deps ? { essential: PEOPLE_TUNE.mostEssential, data: deps.people.essentialUp, leftForOurs: Math.max(0, PEOPLE_TUNE.mostEssential - deps.people.essentialUp) } : null,
      memory: mem ? { usedMB: Math.round(mem.used / 1e6), budgetMB: Math.round(mem.budget / 1e6), share: mem.budget ? Number((mem.used / mem.budget).toFixed(2)) : null } : null,
      ports: this.ports.length,
      portsFor: this.portsFor,
      buildings: this.active.size,
      tally: { ...this.tally },
    };
  }

  /**
   * The nearest port (or the one named) as its travellers see it: its shuttle's phase now, its rounds
   * about now with each traveller's moment, phase and whether it stands, and why it is not ready.
   */
  portReport(at: THREE.Vector3, seconds: number, name?: string): Record<string, unknown> | null {
    const pick = name ? this.ports.find((p) => p.port.name.toLowerCase().includes(name.toLowerCase())) : [...this.ports].sort((a, b) => Math.hypot(a.port.pad.x - at.x, a.port.pad.z - at.z) - Math.hypot(b.port.pad.x - at.x, b.port.pad.z - at.z))[0];
    if (!pick) return null;
    const pp = pick;
    const shuttle = shuttleAt(pp.port.clock, seconds, TRAVEL_TUNE, pp.port.times);
    if (pp.ready) this.roundsOf(pp, seconds);
    const n = (x: number): number => Math.round(x * 10) / 10;
    const travellers = [];
    for (let i = 0; i < (pp.ready ? pp.count : 0); i++) {
      const p = pp.plans[i];
      const key = travellerKey(pp, p);
      const num = travellerNum(pp, p);
      const r = this.travelling.get(num);
      travellers.push({
        key,
        kind: p.kind,
        round: p.round,
        appearsIn: n(p.appearAt - seconds),
        phase: p.kind === 'depart' ? departurePhase(p, seconds) : arrivalPhase(p, seconds),
        terminal: p.terminal,
        standing: r ? (r.kind === 'depart' ? r.state.stage : 'walking') : this.done.has(num) ? 'done' : null,
        away: r ? Math.round(Math.hypot(r.body.pos.x - at.x, r.body.pos.z - at.z)) : null,
      });
    }
    return {
      name: pp.port.name,
      clock: pp.port.clock,
      away: Math.round(Math.hypot(pp.port.pad.x - at.x, pp.port.pad.z - at.z)),
      ready: pp.ready,
      why: pp.why || null,
      shuttle: { phase: shuttle.phase, until: n(shuttle.until), left: n(shuttle.left) },
      rounds: pp.rounds.map((r) => ({ round: r.slot, landsIn: n(r.land - seconds), waitsIn: n(r.wait - seconds), leavesIn: n(r.leave - seconds) })),
      terminals: pp.terminals.length,
      doors: pp.doors.length,
      streetDoor: pp.streetDoor ? [n(pp.streetDoor.outX), n(pp.streetDoor.outZ)] : null,
      padDoor: pp.padDoor ? [n(pp.padDoor.outX), n(pp.padDoor.outZ)] : null,
      towns: pp.towns.length,
      board: pp.board ? { x: n(pp.board.x), y: n(pp.board.y), z: n(pp.board.z), room: pp.board.room } : null,
      // The port's own collector, which is where it is whether or not the port has been planned yet.
      collector: pp.port.collector ? { x: n(pp.port.collector.x), z: n(pp.port.collector.z), room: pp.port.collector.cell } : null,
      travellers,
    };
  }

  /** The ports as a list, for picking one to go to: each one's name, its pad and whether it is ready. */
  portList(at: THREE.Vector3): { name: string; x: number; y: number; z: number; away: number; ready: boolean; why: string }[] {
    return this.ports
      .map((p) => ({ name: p.port.name, x: p.port.pad.x, y: p.port.pad.y, z: p.port.pad.z, away: Math.round(Math.hypot(p.port.pad.x - at.x, p.port.pad.z - at.z)), ready: p.ready, why: p.why }))
      .sort((a, b) => a.away - b.away);
  }

  /** The buildings met so far near a point: each one's kind, whether it is empty, and its places and who is in them. */
  buildingReport(at: THREE.Vector3, deps: AmbientDeps, reach = 150): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const b of deps.buildings()) {
      const away = Math.hypot(b.x - at.x, b.z - at.z);
      if (away > reach) continue;
      const kind = fillKindOf(b.template);
      if (!kind) continue;
      const f = this.fills.get(b);
      out.push({
        model: String((b.model.def as { id?: string }).id ?? b.template),
        kind,
        away: Math.round(away),
        met: !!f,
        empty: f ? f.empty : null,
        why: f?.why || null,
        places: f ? f.spots.length : null,
        seats: f ? f.spots.filter((s) => s.seat).length : null,
        doors: f ? f.doors.length : null,
        slots: f ? f.slots.map((s, i) => `${s.state}${f.bodies[i] ? '' : ' (nobody)'}${f.blocked[i] ? ' blocked' : ''}`) : null,
      });
    }
    return out.sort((a, b) => (a.away as number) - (b.away as number));
  }

  /** The empty building of a kind (any kind with none given) nearest a point, for the console to go to. */
  emptyNear(at: THREE.Vector3, deps: AmbientDeps, kind?: string): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of deps.buildings()) {
      const k = fillKindOf(b.template);
      if (!k || (kind && k !== kind)) continue;
      const d = Math.hypot(b.x - at.x, b.z - at.z);
      if (d >= bestD) continue;
      let f = this.fills.get(b);
      if (!f) {
        f = this.planBuilding(b, deps);
        this.fills.set(b, f);
      }
      if (!f.empty || !f.spots.length) continue;
      bestD = d;
      best = b;
    }
    return best;
  }

  /**
   * Move any of the numbers of ours, live, and answer which moved (each as `table.key`) and which were
   * refused as ambiguous. Each table has a name of its own to be moved under -- `{ ours: {...}, routine:
   * {...}, fillers: {...} }` -- and a key only one table has may be given bare; a bare key two tables
   * have (`build` and `drop`, a port's reach and a building's; `reach` and `front`, a terminal's and a
   * seat's) moves neither and is named back, since one number would otherwise move two things.
   */
  retune(t: Record<string, unknown>): { moved: string[]; ambiguous: string[] } {
    const moved: string[] = [];
    const ambiguous: string[] = [];
    if (!t || typeof t !== 'object') return { moved, ambiguous };
    for (const [key, value] of Object.entries(t)) {
      if (Object.prototype.hasOwnProperty.call(TUNE_TABLES, key)) {
        const name = key as TuneName;
        if (value && typeof value === 'object' && !Array.isArray(value)) for (const k of tuneTable(TUNE_TABLES[name], value as Record<string, unknown>)) moved.push(`${name}.${k}`);
        continue;
      }
      const owners = TUNE_NAMES.filter((name) => Object.prototype.hasOwnProperty.call(TUNE_TABLES[name], key));
      if (owners.length > 1) {
        ambiguous.push(`${key}: ${owners.map((name) => `${name}.${key}`).join(' or ')}`);
        continue;
      }
      if (owners.length === 1) for (const k of tuneTable(TUNE_TABLES[owners[0]], { [key]: value })) moved.push(`${owners[0]}.${k}`);
    }
    return { moved, ambiguous };
  }
}

/** A traveller's own name: its port, its round, whether it leaves or comes, and its place among them. */
function travellerKey(pp: PortPlan, p: TravellerPlan): string {
  return `t:${pp.index}:${p.round}:${p.kind === 'depart' ? 'd' : 'a'}${p.index}`;
}

/**
 * A traveller's number: its port, its round, whether it leaves or comes and its place among them, as one
 * number a pass can look it up by without making a string. Exact for any round of the clock's first
 * million, which at five minutes a round is nine and a half years; after that they come round again.
 */
function travellerNum(pp: PortPlan, p: TravellerPlan): number {
  return pp.index * 1e8 + (((p.round % 1e6) + 1e6) % 1e6) * 32 + (p.kind === 'depart' ? 0 : 16) + Math.min(15, p.index);
}

/** A building's ways in that can be walked in by: a doorway whose sill is near the ground outside it. */
function doorsOf(b: Building, deps: AmbientDeps): Door[] {
  const out: Door[] = [];
  for (const e of deps.exits(b)) {
    if (Math.abs(e.sill - deps.groundAt(e.outX, e.outZ)) > DOOR_TUNE.sill) continue;
    const dx = e.outX - e.inX;
    const dz = e.outZ - e.inZ;
    const len = Math.hypot(dx, dz) || 1;
    out.push({ outX: e.outX, outZ: e.outZ, dirX: dx / len, dirZ: dz / len });
  }
  return out;
}

/** Whether a point stands on a room's own walkable floor; true where the room has none, which cannot say. */
function onFloor(b: Building, room: number, x: number, y: number, z: number, deps: AmbientDeps): boolean {
  const floor = deps.floor(b, room);
  if (!floor) return true;
  tmpV.set(x, y, z).applyMatrix4(b.inverse);
  return locate(floor, tmpV.x, tmpV.y, tmpV.z, 1.5, 0.2) >= 0;
}

/**
 * The doors of the cantinas and hotels near a point, nearest first, each the door of its building nearest
 * the point, as an arrival makes for it: where the walk grid has open ground outside it (`firstOpenOut`),
 * that ground and its region, which is where an arrival bound for it is sent and its reach judged -- the
 * doorstep itself is the building's footprint on the grid, which the grid plans no way to, and an arrival
 * sent at it was steered straight and stuck on whatever stood between -- and then the doorstep, half a
 * metre off its outside step, which it walks on to from there and goes in at (`ArrivalGoal`); and
 * otherwise, with no grid or `clearOut` off, the doorstep itself as before, with a region of -1.
 */
function townDoors(x: number, z: number, not: Building | null, deps: AmbientDeps): (ArrivalGoal & { region: number })[] {
  const found: (ArrivalGoal & { d: number; region: number })[] = [];
  const open: OpenOut = { x: 0, z: 0, d: 0, region: -1 };
  const out = clearOutNow();
  for (const b of deps.buildings()) {
    if (b === not || !/cantina|hotel/i.test(b.template)) continue;
    if (Math.hypot(b.x - x, b.z - z) > ROUTINE_TUNE.town) continue;
    let best: (ArrivalGoal & { d: number; region: number }) | null = null;
    for (const door of doorsOf(b, deps)) {
      const d = Math.hypot(door.outX - x, door.outZ - z);
      if (best && d >= best.d) continue;
      const stepX = door.outX + door.dirX * 0.5;
      const stepZ = door.outZ + door.dirZ * 0.5;
      best =
        out > 0 && firstOpenOut(door, deps.region, open, out)
          ? { x: open.x, z: open.z, stepX, stepZ, hold: false, d, region: open.region }
          : { x: stepX, z: stepZ, stepX: Number.NaN, stepZ: Number.NaN, hold: false, d, region: -1 };
    }
    if (best) found.push(best);
  }
  return found.sort((a, b) => a.d - b.d).map((f) => ({ x: f.x, z: f.z, stepX: f.stepX, stepZ: f.stepZ, hold: false, region: f.region }));
}

/** The one for the session. */
export const ambientPeople = new AmbientPeople();
