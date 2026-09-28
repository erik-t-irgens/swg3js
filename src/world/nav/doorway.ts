// The way between the street and a room.
//
// The indoor pathing walks a body across a building's own floors and the outdoor grid walks it across
// the world's ground, and until this file nothing joined the two: a body outside chasing somebody who
// had stepped into a cantina steered straight at them, which is into the cantina's wall, and started
// pathing only if it happened to blunder through a doorway. This is the join, and it is small, because
// both halves already exist and each is right about its own side:
//
//   - **From outside in**, a building's ways in are its doorways to cell 0, each turned once into two
//     points in the world -- a step outside its plane and a step inside it (`exitsOf`). A body is sent
//     at the outside point of the best of them by the outdoor grid (or straight, where it has none),
//     then walked through to the inside point, and the moment the room it is in is followed through
//     that doorway the building's own floors take it from there. That moment is the hand-over.
//   - **From inside out**, the floors already walk a body to a door out: all this adds is telling them
//     that the goal is outside (`goalRoom` 0 in `WorldNav.corner`), so the door picked is the one
//     nearest where the goal really is rather than whichever room box happens to overhang it.
//
// Which door is best is the walk inside plus the walk outside: from the goal's own room to each way
// out over the building's room graph (`doorCosts`), and the straight line from the body to that door's
// outside point. A doorway whose sill stands well over or under the ground outside it -- a station's
// door up in the air, a dungeon's opening deep under the sand -- is not a way in on foot and is passed
// over.
//
// Where the goal **is** is the caller's to say, because only the caller knows it: the room the player
// is followed through the portals into, a body's own followed room, the room a patroller's next point
// names. A goal nobody can place is left to the old rules exactly, so a body chasing something whose
// room is not known steers as it did before any of this.
//
// Everything a body keeps is on its own `DoorLegs`; the exits are worked out once per placed building
// and kept against it, so a building is measured once whoever walks into it. Nothing on a frame that
// is only walking a leg it already has allocates anything.
import * as THREE from 'three';
import type { Building, CellState } from '../layoutStream.ts';
import type { NavAgent } from './navAgent.ts';
import { worldNav } from './nav.ts';
import { outdoorNav } from './outdoorNav.ts';
import { doorCosts, isExit, throughPoint, type PortalDef, type RoomGraph } from './navRooms.ts';

/** Every invented number of the join, live through `__debug.nav({ door: { … } })`. */
export interface DoorTune {
  /**
   * The switch. Off, a body outside walks at its goal as it did before there was a join, and a body
   * inside works out where its goal is from the rooms' boxes as it did; it is the comparison, and
   * nothing else reads it.
   */
  legs: boolean;
  /** How far off the doorway's plane the points either side of it stand, metres. */
  step: number;
  /** How near the outside point counts as at the door, where the walk through begins, metres. */
  handover: number;
  /**
   * How far ahead of the body, along the doorway's own axis, the walk through aims, metres: small,
   * so a body that reached the door from the side is brought square to it before it reaches the jambs.
   */
  lead: number;
  /** A body in its walk through pushed this far off the outside point goes back to approaching, metres. */
  lost: number;
  /** The longest a walk through may take before the door is given up as not a way in, seconds. */
  through: number;
  /** How long a door given up is not chosen again by that body, seconds. */
  refuse: number;
  /** How often the door is chosen again while a body approaches, seconds: the goal moves about inside. */
  every: number;
  /**
   * A doorway whose lowest corner stands more than this over or under the ground at its outside point
   * is not a way in on foot, metres: a station's door up in the air, or a dungeon's opening far down
   * under the sand, whose outside point is in the rock.
   */
  sill: number;
  /**
   * How far past its own reach a body still asks whether a wall stands between it and something it
   * could strike (`wallBetween`), metres: the blow's own reach plus the ground a running body covers
   * between two thoughts, so the answer is already there when it arrives. Past it nothing is asked
   * and no ray is cast.
   */
  wallLook: number;
}

export const DOOR_TUNE: DoorTune = {
  legs: true,
  step: 0.8,
  handover: 1.5,
  lead: 0.5,
  lost: 6,
  through: 4,
  refuse: 12,
  every: 1,
  sill: 2.5,
  wallLook: 3,
};

/** One way in, in the world's frame. */
export interface DoorExit {
  /** Its index among the building's room-graph doors. */
  door: number;
  /** The room on its inside. */
  room: number;
  /** The doorway's middle. */
  x: number;
  y: number;
  z: number;
  /** The height of its lowest corner, which is where its floor is. */
  sill: number;
  /** A step outside its plane, and a step inside it. */
  outX: number;
  outZ: number;
  inX: number;
  inZ: number;
}

/**
 * Where a body's goal is, as far as the caller knows: in a building's room, in a building but in a
 * room nobody can say (`room` -1), or outside (`building` null). A goal nobody can place at all is
 * passed as null rather than as any of these, and then the old rules decide.
 */
export interface GoalPlace {
  building: Building | null;
  room: number;
}

const scratch = { x: 0, y: 0, z: 0 };
const v = new THREE.Vector3();

/**
 * Which room a living thing is followed in, as the world answers it for the join (`World.livingCell`):
 * the player's own followed room for the player's record, a catalogue body's `navCell`, a fighter's
 * `cell`; null for open ground; undefined for anything that carries neither (another player's body, a
 * turret, a ship), which is a thing nobody follows and whose place nobody can say.
 */
export function cellOfLiving(t: object, player: object, playerCell: CellState | null): CellState | null | undefined {
  if (t === player) return playerCell;
  const b = t as { navCell?: CellState | null; cell?: CellState | null };
  if (b.navCell !== undefined) return b.navCell;
  if (b.cell !== undefined) return b.cell;
  return undefined;
}

/**
 * Where something followed in `at` is, as a goal the join can walk to, written into `out`: that room
 * of that building, open ground (`building` null, room 0) for null, and null -- nobody can say, the old
 * rules decide -- for undefined.
 */
export function placeOfCell(at: CellState | null | undefined, out: GoalPlace): GoalPlace | null {
  if (at === undefined) return null;
  out.building = at ? at.building : null;
  out.room = at ? at.cell : 0;
  return out;
}

/**
 * Where the goal of a walk that is not a chase is, for a catalogue body, written into `out`.
 *
 *   - **On its round** (`onRound`: walking to a point of it, or home to that point after a fight):
 *     the point's own room, in the building the body was stood in (`home`, else the one it is in); a
 *     point with no room is open ground; an indoor point with no building to name is nobody's to say.
 *   - **Home**: the room it was stood in, or open ground for a body stood outside.
 *   - **A wander** about home: home's building but not its room (-1), since a wander's goal is any
 *     spot near home and a box decides which room holds it.
 *   - Anything else (a flight) nobody can place, and the old rules decide.
 */
export function placeOfWalk(out: GoalPlace, state: string, onRound: boolean, roundRoom: number | null | undefined, home: CellState | null, here: CellState | null): GoalPlace | null {
  if (onRound) {
    if (roundRoom === undefined || roundRoom === null) {
      out.building = null;
      out.room = 0;
      return out;
    }
    const b = home?.building ?? here?.building ?? null;
    if (!b) return null;
    out.building = b;
    out.room = roundRoom;
    return out;
  }
  if (state !== 'return' && state !== 'wander') return null;
  out.building = home ? home.building : null;
  out.room = home ? (state === 'return' ? home.cell : -1) : 0;
  return out;
}

/** The physics' own segment test (`Physics.segmentBlocked`): whether anything that stands still lies between two points. */
export interface WallProbe {
  segmentBlocked(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, inside: boolean): boolean;
}

const wallFrom = { x: 0, y: 0, z: 0 };
const wallTo = { x: 0, y: 0, z: 0 };

/**
 * Whether a wall stands between a body followed in `here` and something followed in `there`, so a
 * blow from one cannot land on the other and the body must go round to the door instead.
 *
 * Only ever asked of two things in **different places** -- one in a building and the other out, or
 * the two in different buildings -- since that is the only time the rooms say a wall could be there;
 * anything nobody follows (`there` undefined) and two things in one place are never apart, which is
 * every pair there was before any of this. And which place each is in is only half the answer: a
 * doorway is a place where two things in different places stand an arm's length apart with nothing
 * between them, and a creature on the step outside a cantina must be able to bite somebody standing
 * just inside it. So the last word is the physics', a line between the two middles against what stands
 * still (`probe`, the walls, never another body), with `inside` the body's own filter: indoors a
 * building's shells are left out, as every other indoor ray leaves them. With no probe it is the rooms'
 * word alone.
 *
 * The line goes into two points kept here and is never made.
 */
export function wallBetween(
  probe: WallProbe | null,
  here: CellState | null,
  there: CellState | null | undefined,
  inside: boolean,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  if (there === undefined) return false;
  if ((here ? here.building : null) === (there ? there.building : null)) return false;
  if (!probe) return true;
  wallFrom.x = ax;
  wallFrom.y = ay;
  wallFrom.z = az;
  wallTo.x = bx;
  wallTo.y = by;
  wallTo.z = bz;
  return probe.segmentBlocked(wallFrom, wallTo, inside);
}

/**
 * Every way into a building from outside, in the world's frame: each passable doorway between cell 0
 * and a room (never a lift shaft), with a point `step` outside its plane and one `step` inside.
 * Which side is outside is the doorway's own normal turned away from the middle of the room it opens
 * into (`throughPoint`); a doorway lying flat, or one whose room's middle sits on its own plane, has
 * no side that can be told apart and is left out rather than guessed at.
 *
 * Pure: the graph, the polygons and the matrix in, the list out, so the node test draws a building by
 * hand.
 */
export function exitsFrom(graph: RoomGraph, portals: readonly PortalDef[] | undefined, matrix: THREE.Matrix4, step: number): DoorExit[] {
  const out: DoorExit[] = [];
  for (let i = 0; i < graph.doors.length; i++) {
    const d = graph.doors[i];
    if (!isExit(d)) continue;
    const room = d.a === 0 ? d.b : d.a;
    if (graph.shafts.has(room)) continue;
    throughPoint(graph, d, room, 1, scratch);
    const ox = scratch.x - d.x;
    const oz = scratch.z - d.z;
    if (Math.abs(ox) + Math.abs(oz) < 1e-6) continue;
    v.set(d.x, d.y, d.z).applyMatrix4(matrix);
    const x = v.x;
    const y = v.y;
    const z = v.z;
    v.set(d.x + ox * step, d.y, d.z + oz * step).applyMatrix4(matrix);
    const outX = v.x;
    const outZ = v.z;
    v.set(d.x - ox * step, d.y, d.z - oz * step).applyMatrix4(matrix);
    const inX = v.x;
    const inZ = v.z;
    // The floor at the door is the polygon's own lowest corner. A doorway with no polygon to read
    // (none in a pack is, but a stand-in could be) takes its middle, which only ever makes it look
    // higher off the ground and so is the careful way to be wrong.
    let sill = y;
    const poly = portals?.[d.geometry];
    if (poly?.v?.length) {
      sill = Infinity;
      for (const p of poly.v) sill = Math.min(sill, v.set(p[0], p[1], p[2]).applyMatrix4(matrix).y);
    }
    out.push({ door: i, room, x, y, z, sill, outX, outZ, inX, inZ });
  }
  return out;
}

/**
 * Which way in to take from a point outside to a goal inside: the one whose walk inside, from the
 * goal's own room over the room graph, and walk outside, the straight line from the body to its
 * outside point, add up least. A goal whose room is not known is measured from the goal to each
 * doorway in a straight line. `skip` is a door this body has given up on (-1 for none), and `ground`,
 * where given, refuses a doorway up in the air. The index into `exits`, or -1 for none that can be
 * walked in by.
 *
 * `inverse` is the building's own, which puts the goal into the frame the room graph is drawn in.
 */
export function chooseExit(
  exits: readonly DoorExit[],
  graph: RoomGraph,
  inverse: THREE.Matrix4,
  goalRoom: number,
  goalX: number,
  goalY: number,
  goalZ: number,
  fromX: number,
  fromZ: number,
  skip = -1,
  ground: ((x: number, z: number) => number) | null = null,
  tune: DoorTune = DOOR_TUNE,
): number {
  if (!exits.length) return -1;
  const byRoom = goalRoom > 0;
  if (byRoom) {
    v.set(goalX, goalY, goalZ).applyMatrix4(inverse);
    doorCosts(graph, goalRoom, v.x, v.z);
  }
  const cost = graph.work.cost;
  let best = -1;
  let bestCost = Infinity;
  for (let k = 0; k < exits.length; k++) {
    if (k === skip) continue;
    const e = exits[k];
    if (ground && Math.abs(e.sill - ground(e.outX, e.outZ)) > tune.sill) continue;
    const inner = byRoom ? cost[e.door] : Math.hypot(goalX - e.x, goalZ - e.z);
    if (!(inner < Infinity)) continue;
    const total = inner + Math.hypot(fromX - e.outX, fromZ - e.outZ);
    if (total < bestCost) {
      bestCost = total;
      best = k;
    }
  }
  return best;
}

/** One body's walk between the street and a room: which door it is making for, and how far it has got. */
export class DoorLegs {
  /** Who is walking, for the console's account of the last hand-over. */
  who = '';
  /** The placed building the walk leads into, the room it is making for and the way in chosen. */
  building: object | null = null;
  room = -1;
  exit = -1;
  /** 0 not walking in; 1 approaching the outside point; 2 walking through to the inside point. */
  phase: 0 | 1 | 2 = 0;
  chosenAt = -Infinity;
  /** When the walk toward this building began, and when the walk through did. */
  startedAt = 0;
  throughAt = 0;
  /** A door given up on: which, of which building, and until when. */
  refused = -1;
  refusedIn: object | null = null;
  refusedUntil = 0;
  /** The building and room it was in when last asked, which is what says the room has flipped. */
  wasIn: Building | null = null;
  wasRoom = 0;
  /** The point handed back while walking a leg, written and never made. */
  readonly out = { x: 0, z: 0 };

  /** The walk in dropped; what was given up stays given up. */
  clear(): void {
    this.building = null;
    this.room = -1;
    this.exit = -1;
    this.phase = 0;
    this.chosenAt = -Infinity;
  }

  /** Everything, as a body stood somewhere else carries none of it. */
  reset(): void {
    this.clear();
    this.refused = -1;
    this.refusedIn = null;
    this.refusedUntil = 0;
    this.wasIn = null;
    this.wasRoom = 0;
  }
}

/** The last time a body's room flipped under the join, for `__debug.nav({ door: true })`. */
export interface HandOver {
  who: string;
  /** In from the street through a chosen door, or out of a building. */
  way: 'in' | 'out';
  building: string;
  room: number;
  /** The door walked through, when the join chose one; -1 on the way out, which the floors chose. */
  door: number;
  /** Seconds from the join choosing the door to the room flipping, on the way in. */
  took: number;
  at: number;
}

export interface DoorStatus {
  tune: DoorTune;
  /** Buildings whose ways in have been worked out, and how many ways that came to. */
  buildings: number;
  exits: number;
  /** Doors chosen, walks through begun, doors given up, goals in a building with no way in on foot. */
  chosen: number;
  throughs: number;
  gaveUp: number;
  noWayIn: number;
  /** Rooms flipped under a walk in, and bodies walked out of a building. */
  handIns: number;
  handOuts: number;
  last: HandOver | null;
}

/**
 * The join. One for the session, like `worldNav` and `outdoorNav`: it holds a cache keyed on the
 * placed buildings themselves and some counters, and every body's own state is on its `DoorLegs`.
 */
export class DoorwayNav {
  /** Each placed building's ways in, measured at the `step` of the moment; dropped whole when `step` moves. */
  private cache = new WeakMap<object, DoorExit[]>();
  /** The ground under a point, so a door up in the air is not a way in; the world hands it over. */
  ground: ((x: number, z: number) => number) | null = null;
  readonly tune: DoorTune = DOOR_TUNE;
  private buildings = 0;
  private exitCount = 0;
  private chosen = 0;
  private throughs = 0;
  private gaveUp = 0;
  private noWayIn = 0;
  private handIns = 0;
  private handOuts = 0;
  private last: HandOver | null = null;

  /** A placed building's ways in, worked out the first time anybody makes for it and then kept. */
  exits(b: Building): DoorExit[] {
    const key = b as unknown as object;
    const had = this.cache.get(key);
    if (had) return had;
    const rooms = worldNav.forBuilding(b).rooms;
    const def = b.model.def as unknown as { portals?: PortalDef[] };
    const list = exitsFrom(rooms, def.portals, b.matrix, this.tune.step);
    this.cache.set(key, list);
    this.buildings++;
    this.exitCount += list.length;
    return list;
  }

  /**
   * The next point a body should walk at on its way to a goal, or null for nothing to add to walking
   * straight at the goal itself -- exactly the answer the two halves give on their own.
   *
   * `here` is the room the body is followed in (null outside), `goal` where the goal is, as far as
   * the caller knows (null for not at all), and `grid` whether this body may be handed the outdoor
   * grid's corners. Only where it **walks** is answered: the goal it is measured as having reached is
   * still the caller's own, or a body would stop a stride short of every door.
   */
  corner(
    agent: NavAgent,
    legs: DoorLegs,
    here: CellState | null,
    x: number,
    y: number,
    z: number,
    goalX: number,
    goalY: number,
    goalZ: number,
    goal: GoalPlace | null,
    radius: number,
    now: number,
    grid: boolean,
  ): { x: number; z: number } | null {
    const tune = this.tune;
    this.noteRoom(legs, here, now);
    if (here) {
      // Inside, the floors walk it. All that is added is where the goal is, when that is known: in
      // this building, its room (or -1, which is the boxes' guess, the old rule); anywhere else, out.
      legs.clear();
      let room = -1;
      if (goal && tune.legs) room = goal.building === here.building ? goal.room : 0;
      return worldNav.corner(agent, here, x, y, z, goalX, goalY, goalZ, radius, now, room);
    }
    // A body the rooms have lost track of while it still stands on a building's own footprint is not
    // on the ground the grid describes: the nearest open cell to it is outside a wall, and a route from
    // there would walk it into that wall. It steers as it would with no grid until it is really out.
    const onGround = grid && !outdoorNav.indoors(x, z);
    const into = tune.legs && goal ? goal.building : null;
    if (into) {
      const at = this.walkIn(agent, legs, into, goal!.room, x, y, z, goalX, goalY, goalZ, radius, now, onGround);
      if (at) return at;
    } else legs.clear();
    return onGround ? outdoorNav.corner(agent, x, y, z, goalX, goalY, goalZ, radius, now) : null;
  }

  /** The walk from outside to a goal in a building's room: a door chosen, approached, and walked through. */
  private walkIn(agent: NavAgent, legs: DoorLegs, b: Building, room: number, x: number, y: number, z: number, goalX: number, goalY: number, goalZ: number, radius: number, now: number, grid: boolean): { x: number; z: number } | null {
    const tune = this.tune;
    const exits = this.exits(b);
    const key = b as unknown as object;
    if (legs.building !== key || legs.room !== room) {
      legs.clear();
      legs.building = key;
      legs.room = room;
      legs.startedAt = now;
    }
    // Chosen again now and then while it approaches, since what it is after moves about inside; never
    // once it is walking through, which is a door it has committed to.
    if (legs.phase !== 2 && (legs.exit < 0 || now - legs.chosenAt >= tune.every)) {
      const skip = legs.refusedIn === key && now < legs.refusedUntil ? legs.refused : -1;
      const k = chooseExit(exits, worldNav.forBuilding(b).rooms, b.inverse, room, goalX, goalY, goalZ, x, z, skip, this.ground, tune);
      const first = legs.chosenAt === -Infinity;
      legs.chosenAt = now;
      if (k < 0) {
        // Counted once a walk, not once a choice: it is asked again every `every` seconds.
        if (first || legs.exit >= 0) this.noWayIn++;
        legs.exit = -1;
        legs.phase = 0;
        return null;
      }
      if (k !== legs.exit) {
        legs.exit = k;
        legs.phase = 1;
        this.chosen++;
      }
    }
    if (legs.exit < 0) return null;
    const e = exits[legs.exit];
    const off = Math.hypot(x - e.outX, z - e.outZ);
    if (legs.phase === 1 && off <= tune.handover) {
      legs.phase = 2;
      legs.throughAt = now;
      this.throughs++;
    } else if (legs.phase === 2 && (off > tune.lost || now - legs.throughAt > tune.through)) {
      // Pushed off it, or through it for longer than any doorway takes without the room flipping:
      // this is not a way in for this body just now, and another is chosen.
      if (off <= tune.lost) {
        legs.refused = legs.exit;
        legs.refusedIn = key;
        legs.refusedUntil = now + tune.refuse;
        this.gaveUp++;
      }
      legs.exit = -1;
      legs.phase = 0;
      legs.chosenAt = -Infinity;
      return null;
    }
    if (legs.phase === 2) {
      // Through the doorway along its own axis, aiming `lead` ahead of where the body stands on it:
      // a body that came to the door from the side and walked straight at the inside point cut the
      // corner toward the jamb, where the axis brings it square to the opening first.
      const ax = e.inX - e.outX;
      const az = e.inZ - e.outZ;
      const len = Math.hypot(ax, az);
      if (len < 1e-6) {
        legs.out.x = e.inX;
        legs.out.z = e.inZ;
        return legs.out;
      }
      const s = ((x - e.outX) * ax + (z - e.outZ) * az) / len;
      const t = Math.min(len, Math.max(0, s) + tune.lead);
      legs.out.x = e.outX + (ax / len) * t;
      legs.out.z = e.outZ + (az / len) * t;
      return legs.out;
    }
    // The approach: the grid's corners to the outside point where it has them, and the outside point
    // itself when it has none left to hand over (the last stretch, or a body it is not given to).
    const c = grid ? outdoorNav.corner(agent, x, y, z, e.outX, goalY, e.outZ, radius, now) : null;
    if (c) return c;
    legs.out.x = e.outX;
    legs.out.z = e.outZ;
    return legs.out;
  }

  /** The room under the body, against the last one asked about it: a flip is a hand-over. */
  private noteRoom(legs: DoorLegs, here: CellState | null, now: number): void {
    const inB = here ? here.building : null;
    if (inB === legs.wasIn) {
      if (here) legs.wasRoom = here.cell;
      return;
    }
    if (inB && legs.phase !== 0 && legs.building === (inB as unknown as object)) {
      this.handIns++;
      this.last = { who: legs.who, way: 'in', building: modelName(inB), room: here!.cell, door: legs.exit, took: Number((now - legs.startedAt).toFixed(2)), at: Number(now.toFixed(2)) };
    } else if (!inB && legs.wasIn) {
      this.handOuts++;
      this.last = { who: legs.who, way: 'out', building: modelName(legs.wasIn), room: legs.wasRoom, door: -1, took: 0, at: Number(now.toFixed(2)) };
    }
    legs.wasIn = inB;
    legs.wasRoom = here ? here.cell : 0;
  }

  status(): DoorStatus {
    return {
      tune: this.tune,
      buildings: this.buildings,
      exits: this.exitCount,
      chosen: this.chosen,
      throughs: this.throughs,
      gaveUp: this.gaveUp,
      noWayIn: this.noWayIn,
      handIns: this.handIns,
      handOuts: this.handOuts,
      last: this.last,
    };
  }

  /**
   * Move any number of the join live; a switch only ever by a switch, a number by a number. A new
   * `step` drops every building's measured ways in, since the points either side of each doorway were
   * worked out at the old one and are kept: each is measured again the next time a body makes for it.
   */
  set(values: Partial<DoorTune>): DoorTune {
    const step = this.tune.step;
    for (const k of Object.keys(values) as (keyof DoorTune)[]) {
      const val = values[k];
      const had = this.tune[k];
      if (typeof had === 'boolean' && typeof val === 'boolean') (this.tune as unknown as Record<string, unknown>)[k] = val;
      else if (typeof had === 'number' && typeof val === 'number' && Number.isFinite(val)) (this.tune as unknown as Record<string, unknown>)[k] = val;
    }
    if (this.tune.step !== step) {
      this.cache = new WeakMap();
      this.buildings = 0;
      this.exitCount = 0;
    }
    return this.tune;
  }
}

function modelName(b: Building): string {
  const id = (b.model?.def as unknown as { id?: string } | undefined)?.id;
  return typeof id === 'string' ? id : b.template;
}

/** The one for the session. */
export const doorwayNav = new DoorwayNav();
