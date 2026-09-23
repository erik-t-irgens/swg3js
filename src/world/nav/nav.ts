// The game's side of the indoor pathing: it holds one building's floors and its room graph, works
// out which room a goal is in, and hands a body the next corner to walk to. Nothing more -- what
// the body then does with that corner is the body's own steering, unchanged.
//
// It is a cache and nothing else. Everything derived from a building lives in a `WeakMap` keyed by
// the loaded model itself, so it dies with the model and no unload has to remember it; every piece
// of per-body state (the corners, the clock, the counters) lives on that body's own `NavAgent`.
// That is why one instance is shared: two of them would build the same building's floors twice.
//
// It degrades, deliberately and in three steps:
//
//   1. Outdoors, in a building with no rooms at all, and **in every building that names no floor**,
//      it answers null at once and the body steers exactly as it did before there was any of this.
//      That last is the whole of the rule that a pack converted before this must play exactly as it
//      plays today: such a pack has no floors anywhere, so nothing in it ever reaches step 2, and
//      the doorway answer -- which the doorway polygons alone could give in any pack ever
//      converted -- is deliberately not given. It would be an improvement, and it is still a
//      change, and the change is not this wave's to make.
//   2. In a building that has floors, but in a room whose floor the archives do not have or the
//      converter could not read, it answers with the doorway, because the doorway polygons are a
//      room-to-room graph on their own. Within one room it answers null, and the straight line is
//      the straight line.
//   3. With a floor it answers the corners of the real path across the room, funnelled and pulled
//      off the walls by the body's own half-width.
//
// The corners are worked out in the building's model frame and handed back in the world's, once,
// at the moment the path is planned: a building is a placed object and never moves, so nothing is
// transformed on a frame that is only walking a path it already has.
import * as THREE from 'three';
import type { Building, CellState } from '../layoutStream.ts';
import { LIFT_CELL } from '../lifts.ts';
import { NAV_TUNE, buildFloor, pathIn, type FloorSource, type NavFloor, type NavTune } from './navMesh.ts';
import { buildRoomGraph, cellOfPoint, nextDoor, throughPoint, type CellDef, type PortalDef, type RoomGraph } from './navRooms.ts';
import type { NavAgent } from './navAgent.ts';

const local = new THREE.Vector3();
const localGoal = new THREE.Vector3();
const world = new THREE.Vector3();
const doorAt = { x: 0, y: 0, z: 0 };

/** What one building's rooms are, once. Its floors are read one room at a time, as they are wanted. */
export interface BuildingNav {
  /** Every room's own definition, kept so a floor is read only when somebody walks into that room. */
  cells: Map<number, CellDef>;
  /** Cell index to its floor once read: null where the pack has none or it would not parse. */
  floors: Map<number, NavFloor | null>;
  rooms: RoomGraph;
  /** Rooms whose definition carries a floor block at all, and rooms whose floor has been read. */
  named: number;
  built: number;
  cellsWithout: number;
  triangles: number;
  /**
   * Rooms carrying anything the converter reads out of a floor file -- a mesh, a node graph, or
   * both. It is what says this building came out of a pack that has been converted since the floors
   * were read, which is the one thing that may not be assumed: a pack older than that must steer
   * exactly as it always did. A pack written with the graphs alone counts, and gets the doorways.
   */
  converted: number;
}

export interface NavStatus {
  /** Whether any building indexed so far named a floor: false is a pack with no floor meshes. */
  floors: boolean;
  /**
   * Whether any building carried anything at all out of a floor file, mesh or graph. False is a
   * pack converted before this wave, where nothing here answers and every body steers as it did.
   */
  converted: boolean;
  buildings: number;
  /** Rooms that name a floor, rooms that do not, and rooms whose floor has really been read. */
  cellsWithFloor: number;
  cellsConverted: number;
  cellsWithout: number;
  cellsBuilt: number;
  triangles: number;
  /** Searches asked for, paths found, doorway-only answers, and searches that found nothing. */
  asked: number;
  found: number;
  doorOnly: number;
  missed: number;
  /** Searches put off to the next frame because this one had spent its budget. */
  deferred: number;
  /** Triangles opened and corners handed back by the last search that ran a funnel. */
  lastOpened: number;
  lastCorners: number;
  tune: NavTune;
}

const NO_FLOORS = "[nav] this pack's interiors were converted before the floors were read: bodies indoors steer straight at their goal, exactly as they did before there was any pathing. Reconvert a planet to give them floors.";

/**
 * A lift shaft, by the very rule the lift menu uses. Its stops are its doorways and it has no floor
 * above the bottom one, so its doorways join two storeys for somebody who presses a key and for
 * nobody who walks: no route goes through one, and a body standing in one is given no path at all.
 */
const isShaft = (cell: CellDef): boolean => LIFT_CELL.test(cell.name ?? '');

export class WorldNav {
  /** Keyed by the loaded model: it dies with the model, so nothing here outlives a planet. */
  private readonly cache = new WeakMap<object, BuildingNav>();
  /** The corners one search writes, in the building's frame; copied onto the agent in the world's. */
  private readonly scratch = new Float64Array(NAV_TUNE.corners * 2);
  private buildings = 0;
  private cellsWithFloor = 0;
  private cellsConverted = 0;
  private cellsWithout = 0;
  private cellsBuilt = 0;
  private triangles = 0;
  private asked = 0;
  private found = 0;
  private doorOnly = 0;
  private missed = 0;
  private deferred = 0;
  private lastOpened = 0;
  private lastCorners = 0;
  private saidNoFloors = false;
  /** The step the budget below was last counted in, and how much of it is spent. */
  private stepAt = Number.NaN;
  private stepPlans = 0;
  /** The live knob; one table, shared with the pure modules that read it. */
  readonly tune: NavTune = NAV_TUNE;

  /**
   * One building's room graph, built the first time the building is asked about and then kept. The
   * floors themselves are not read here: a room's floor is read the first time a body walks that
   * room, so a palace nobody goes upstairs in costs the ground floor and nothing else.
   */
  forBuilding(building: Building): BuildingNav {
    const model = building.model as unknown as object;
    const had = this.cache.get(model);
    if (had) return had;
    const def = building.model.def as unknown as { cells?: CellDef[]; portals?: PortalDef[] };
    const rooms = buildRoomGraph(def.cells, def.portals, isShaft);
    const cells = new Map<number, CellDef>();
    let named = 0;
    let without = 0;
    let converted = 0;
    for (const c of def.cells ?? []) {
      if (c.index <= 0) continue;
      cells.set(c.index, c);
      const block = c as unknown as { floor?: FloorSource; graph?: unknown };
      if (block.floor) named++;
      else without++;
      if (block.floor || block.graph) converted++;
    }
    const nav: BuildingNav = { cells, floors: new Map(), rooms, named, built: 0, cellsWithout: without, triangles: 0, converted };
    this.cache.set(model, nav);
    this.buildings++;
    this.cellsWithFloor += named;
    this.cellsWithout += without;
    this.cellsConverted += converted;
    if (converted === 0 && without > 0 && !this.saidNoFloors && this.cellsConverted === 0) {
      this.saidNoFloors = true;
      console.info(NO_FLOORS);
    }
    return nav;
  }

  /** One room's floor, read the first time it is wanted; null where there is none or it would not parse. */
  private floorOf(nav: BuildingNav, cell: number): NavFloor | null {
    const had = nav.floors.get(cell);
    if (had !== undefined) return had;
    const def = nav.cells.get(cell);
    const floor = def ? buildFloor((def as unknown as { floor?: FloorSource }).floor) : null;
    nav.floors.set(cell, floor);
    if (floor) {
      nav.built++;
      nav.triangles += floor.count;
      this.cellsBuilt++;
      this.triangles += floor.count;
    }
    return floor;
  }

  /**
   * The next corner a body in `cell` should walk to on its way to a point, in the world's frame, or
   * null when there is nothing to add to walking straight at it.
   *
   * `radius` is the body's own half-width: the mesh is walked at one size (the player's capsule,
   * `tune.agent`) and anything fatter has each corner pulled off the wall by its own width and
   * then checked against the mesh, rather than a second mesh being baked for it.
   */
  corner(agent: NavAgent, cell: CellState, x: number, y: number, z: number, goalX: number, goalY: number, goalZ: number, radius: number, now: number): { x: number; z: number } | null {
    const nav = this.forBuilding(cell.building);
    // A building carrying nothing out of a floor file is a building out of a pack converted before
    // any of this, and such a pack must play exactly as it plays today: the doorways alone would
    // answer, and answering would change what every creature indoors does in a pack nobody
    // reconverted. A pack converted with the graphs and no meshes has been reconverted, so it takes
    // the doorway answer even though no room of it can be funnelled.
    if (nav.converted === 0) return null;
    // Standing in a lift shaft: its doorways are stops on other storeys and there is no floor
    // between them, so there is no path out of one that anything could walk. Today's steering, and
    // the stuck check, are the honest answer.
    if (nav.rooms.shafts.has(cell.cell)) return null;
    // The **placed** building, not the model: two copies of one building stand in two places and
    // the corners are kept in the world's frame, so a body that walked from one into the other must
    // throw its path away. The floors themselves are still cached per model, and shared.
    const building = cell.building as unknown as object;
    if (agent.wants(building, cell.cell, goalX, goalZ, now, this.tune)) {
      // A budget a step, so twenty bodies walking into a building at once cannot all search on the
      // same frame; whoever is turned away keeps the path it has and asks again on the next one.
      if (now !== this.stepAt) {
        this.stepAt = now;
        this.stepPlans = 0;
      }
      if (this.stepPlans >= this.tune.perStep) {
        this.deferred++;
      } else {
        this.stepPlans++;
        this.asked++;
        this.plan(agent, nav, cell, x, y, z, goalX, goalY, goalZ, radius, now);
      }
    }
    if (!agent.advance(x, z, this.tune)) return null;
    return agent.corner();
  }

  private plan(agent: NavAgent, nav: BuildingNav, cell: CellState, x: number, y: number, z: number, goalX: number, goalY: number, goalZ: number, radius: number, now: number): void {
    const b = cell.building;
    const key = b as unknown as object;
    local.set(x, y, z).applyMatrix4(b.inverse);
    localGoal.set(goalX, goalY, goalZ).applyMatrix4(b.inverse);
    const goalCell = cellOfPoint(nav.rooms, localGoal.x, localGoal.y, localGoal.z, 0.5);
    let endX = localGoal.x;
    let endY = localGoal.y;
    let endZ = localGoal.z;
    let crossing = false;
    if (goalCell !== cell.cell) {
      const door = nextDoor(nav.rooms, cell.cell, goalCell);
      if (!door) {
        agent.took(key, cell.cell, goalX, goalZ, now, 0);
        this.missed++;
        return;
      }
      throughPoint(nav.rooms, door, cell.cell, this.tune.through, doorAt);
      endX = doorAt.x;
      endY = doorAt.y;
      endZ = doorAt.z;
      crossing = true;
    }
    // Reading a room's floor is the one expensive thing here -- about a millisecond for the biggest
    // room measured -- and it is paid the first time anybody walks that room. So a step that pays
    // it pays for nothing else: the rest of the step's search budget is spent, and the bodies it
    // turns away keep the paths they have and ask again on the next step.
    const fresh = !nav.floors.has(cell.cell);
    const floor = this.floorOf(nav, cell.cell);
    if (fresh && floor) this.stepPlans = this.tune.perStep;
    if (floor) {
      const n = pathIn(floor, local.x, local.y, local.z, endX, endY, endZ, this.scratch, radius, this.tune);
      this.lastOpened = floor.work.opened;
      if (n > 0) {
        this.lastCorners = n;
        this.write(agent, b, key, cell.cell, goalX, goalZ, now, n, local.y);
        this.found++;
        return;
      }
    }
    // No floor for this room, or the body is standing off it: the doorway is still an answer, and a
    // better one than the wall the straight line was walking into. Within one room it is not.
    if (crossing) {
      this.scratch[0] = endX;
      this.scratch[1] = endZ;
      this.write(agent, b, key, cell.cell, goalX, goalZ, now, 1, endY);
      this.doorOnly++;
      return;
    }
    agent.took(key, cell.cell, goalX, goalZ, now, 0);
    this.missed++;
  }

  /**
   * The corners the search left in the building's frame, put on the agent in the world's. The
   * funnel answers in x and z alone, so each corner is lifted to `y` -- the walker's own height in
   * the building's frame -- before the turn is applied, which matters only for a building that is
   * tilted rather than merely turned, and is exact for the plane the body is walking on.
   */
  private write(agent: NavAgent, b: Building, key: object, cell: number, goalX: number, goalZ: number, now: number, count: number, y: number): void {
    const room = agent.corners;
    const n = Math.min(count, Math.floor(room.length / 2));
    for (let i = 0; i < n; i++) {
      world.set(this.scratch[i * 2], y, this.scratch[i * 2 + 1]).applyMatrix4(b.matrix);
      room[i * 2] = world.x;
      room[i * 2 + 1] = world.z;
    }
    agent.took(key, cell, goalX, goalZ, now, n);
  }

  /**
   * What one building came out as, for the console. This is the one call that reads every room's
   * floor whether anybody has walked it or not, which is what makes it a thing to type rather than
   * something the game does.
   */
  describe(building: Building): { cells: number; withFloor: number; without: number; triangles: number; doors: number; openEdges: number; rebuilt: number } {
    const nav = this.forBuilding(building);
    let openEdges = 0;
    let rebuilt = 0;
    for (const cell of nav.cells.keys()) {
      const floor = this.floorOf(nav, cell);
      if (!floor) continue;
      openEdges += floor.openEdges;
      if (!floor.adjFromFile) rebuilt++;
    }
    return { cells: nav.cells.size, withFloor: nav.built, without: nav.cells.size - nav.built, triangles: nav.triangles, doors: nav.rooms.doors.length, openEdges, rebuilt };
  }

  status(): NavStatus {
    return {
      floors: this.cellsWithFloor > 0,
      converted: this.cellsConverted > 0,
      buildings: this.buildings,
      cellsWithFloor: this.cellsWithFloor,
      cellsConverted: this.cellsConverted,
      cellsWithout: this.cellsWithout,
      cellsBuilt: this.cellsBuilt,
      triangles: this.triangles,
      asked: this.asked,
      found: this.found,
      doorOnly: this.doorOnly,
      missed: this.missed,
      deferred: this.deferred,
      lastOpened: this.lastOpened,
      lastCorners: this.lastCorners,
      tune: this.tune,
    };
  }

  /** Move one of the invented numbers for a run; anything else is left alone. */
  set(values: Partial<NavTune>): NavTune {
    for (const k of Object.keys(values) as (keyof NavTune)[]) {
      const v = values[k];
      if (typeof v === 'number' && Number.isFinite(v)) this.tune[k] = v;
    }
    return this.tune;
  }
}

/**
 * The one instance. It holds nothing but a cache keyed by the models themselves, and both the
 * creatures' manager and the fighters' read it, so a building whose floors one of them built is
 * not built again for the other.
 */
export const worldNav = new WorldNav();
