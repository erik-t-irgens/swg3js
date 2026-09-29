// The join between the street and a room (src/world/nav/doorway.ts): a building's ways in worked out
// in the world's frame, the door chosen for a goal inside, the walk from outside -- round the building
// on the world's own grid, to the door, through it -- and the moment the room flips under the body and
// the building's own floors take over; and the other way, a body inside sent out by the door nearest
// the goal rather than the door nearest itself.
//
// Every building and every world here is drawn by hand in this file: two rooms one behind the other,
// a front door and (in the second building) a back door, a U-shaped house whose two front rooms are
// joined only round the back, on a grid packed by the converter's own `packGrid`, and a wall with a
// doorway in it built in a real physics world. Nothing is read from the owner's archives and nothing
// needs a pack.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CLEARANCE_MAX, COARSE, NAV_GRID_VERSION, SLOPE_CLIMB_DEGREES, packGrid } from '../navgrid.mjs';
import { decodeGrid, type OutdoorHeader } from '../../../src/world/nav/outdoorGrid.ts';
import { MOBILE_CLIMB_DEGREES, outdoorNav } from '../../../src/world/nav/outdoorNav.ts';
import { NavAgent } from '../../../src/world/nav/navAgent.ts';
import { buildRoomGraph, doorCosts, exitToward, nextDoor, type CellDef, type PortalDef } from '../../../src/world/nav/navRooms.ts';
import { worldNav } from '../../../src/world/nav/nav.ts';
import {
  DOOR_TUNE,
  DoorLegs,
  cellOfLiving,
  chooseExit,
  doorwayNav,
  exitsFrom,
  placeOfCell,
  placeOfWalk,
  wallBetween,
  type DoorTune,
  type GoalPlace,
} from '../../../src/world/nav/doorway.ts';
import { decide, BRAIN_TUNE, type BrainSelf, type BrainTarget } from '../../../src/world/mobiles/brain.ts';
import { Physics, RAPIER } from '../../../src/core/physics.ts';
import type { Building, CellState } from '../../../src/world/layoutStream.ts';

await Physics.create();

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

// ---- the buildings ---------------------------------------------------------------------------------
//
// Ten metres wide and twenty deep in its own frame: room 1 the front half (z 0..10), room 2 the back
// (z 10..20). A doorway is an upright two-metre square polygon across the wall it stands in.
const door = (x: number, z: number, y0 = 0): number[][] => [
  [x - 1, y0, z],
  [x + 1, y0, z],
  [x + 1, y0 + 2.5, z],
  [x - 1, y0 + 2.5, z],
];

function drawHouse(opts: { back?: boolean; frontSill?: number }): { cells: CellDef[]; portals: PortalDef[] } {
  const portals: PortalDef[] = [
    { v: door(5, 0, opts.frontSill ?? 0), i: [0, 1, 2, 0, 2, 3] }, // 0: street to room 1, the front door
    { v: door(5, 10), i: [0, 1, 2, 0, 2, 3] }, // 1: room 1 to room 2
  ];
  if (opts.back) portals.push({ v: door(5, 20), i: [0, 1, 2, 0, 2, 3] }); // 2: room 2 to the street, the back door
  const cells = [
    { index: 0, name: 'r0', bounds: { min: [-2, -1, -2], max: [12, 5, 22] }, portals: [{ geometry: 0, target: 1, passable: true }, ...(opts.back ? [{ geometry: 2, target: 2, passable: true }] : [])] },
    { index: 1, name: 'hall', bounds: { min: [0, 0, 0], max: [10, 4, 10] }, portals: [{ geometry: 0, target: 0, passable: true }, { geometry: 1, target: 2, passable: true }], graph: {} },
    { index: 2, name: 'back', bounds: { min: [0, 0, 10], max: [10, 4, 20] }, portals: [{ geometry: 1, target: 1, passable: true }, ...(opts.back ? [{ geometry: 2, target: 0, passable: true }] : [])], graph: {} },
  ] as unknown as CellDef[];
  return { cells, portals };
}

/**
 * A U-shaped house, where the walk inside and the straight line part company: two front rooms side by
 * side, each with its own door to the street (A into room 1 at x 5, B into room 2 at x 12.5), and no
 * door between them -- the only way from one to the other is out of the back of the first, along a
 * corridor behind both (room 3) and in at the back of the second. `shaft` names the corridor as a lift
 * shaft instead.
 */
function drawU(shaft = false): { cells: CellDef[]; portals: PortalDef[] } {
  const portals: PortalDef[] = [
    { v: door(5, 0), i: [0, 1, 2, 0, 2, 3] }, // 0: A, street to room 1
    { v: door(12.5, 0), i: [0, 1, 2, 0, 2, 3] }, // 1: B, street to room 2
    { v: door(5, 10), i: [0, 1, 2, 0, 2, 3] }, // 2: room 1 to the corridor
    { v: door(15, 10), i: [0, 1, 2, 0, 2, 3] }, // 3: the corridor to room 2
  ];
  const cells = [
    { index: 0, name: 'r0', bounds: { min: [-2, -1, -2], max: [22, 5, 16] }, portals: [{ geometry: 0, target: 1, passable: true }, { geometry: 1, target: 2, passable: true }] },
    { index: 1, name: 'left', bounds: { min: [0, 0, 0], max: [10, 4, 10] }, portals: [{ geometry: 0, target: 0, passable: true }, { geometry: 2, target: 3, passable: true }], graph: {} },
    { index: 2, name: 'right', bounds: { min: [10, 0, 0], max: [20, 4, 10] }, portals: [{ geometry: 1, target: 0, passable: true }, { geometry: 3, target: 3, passable: true }], graph: {} },
    { index: 3, name: shaft ? 'elevator1' : 'corridor', bounds: { min: [0, 0, 10], max: [20, 4, 14] }, portals: [{ geometry: 2, target: 1, passable: true }, { geometry: 3, target: 2, passable: true }], graph: {} },
  ] as unknown as CellDef[];
  return { cells, portals };
}

/** A placed building at `(x, z)` turned `yaw` about the upright, as the streamer holds one. */
function place(id: string, def: { cells: CellDef[]; portals: PortalDef[] }, x: number, z: number, yaw = 0): Building {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  return {
    model: { def: { id, cells: def.cells, portals: def.portals } },
    template: id,
    x,
    z,
    radius: 15,
    matrix,
    inverse: matrix.clone().invert(),
    interior: [],
    interiorBuilt: false,
  } as unknown as Building;
}

const toWorld = (b: Building, x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, 0, z).applyMatrix4(b.matrix);
const toLocal = (b: Building, p: { x: number; z: number }): THREE.Vector3 => new THREE.Vector3(p.x, 0, p.z).applyMatrix4(b.inverse);

// ---- 1: the ways in ------------------------------------------------------------------------------
{
  const house = place('one_door', drawHouse({}), 20, 20, 0);
  const exits = doorwayNav.exits(house);
  ok(exits.length === 1, 'a building with one door to the street has one way in');
  const e = exits[0];
  ok(e.room === 1, '... and it opens into the front room');
  ok(near(e.x, 25) && near(e.z, 20), '... its middle in the world where the doorway stands');
  ok(near(e.outZ, 20 - DOOR_TUNE.step) && near(e.inZ, 20 + DOOR_TUNE.step), `the point outside stands ${DOOR_TUNE.step} m off the wall on the street side and the point inside as far in: which side is out is the doorway's own normal turned away from its room`);
  ok(near(e.sill, 0), 'the sill is the doorway polygon’s own lowest corner');
  ok(doorwayNav.exits(house) === exits, 'worked out once a placed building and then kept');

  // Turned a quarter, the same building's door faces another way in the world, and the points go with it.
  const turned = place('one_door_turned', drawHouse({}), 20, 20, Math.PI / 2);
  const t = doorwayNav.exits(turned)[0];
  const outL = toLocal(turned, { x: t.outX, z: t.outZ });
  ok(near(outL.z, -DOOR_TUNE.step, 1e-6) && near(outL.x, 5, 1e-6), '... and turned with the building, the outside point is still outside that door');

  // A lift shaft is never a way in, however its doors are drawn: its stops are doorways with nothing
  // between them, and a body walked into one from the street walks into the air.
  const shaftDef = drawHouse({});
  (shaftDef.cells[1] as unknown as { name: string }).name = 'elevator1';
  const shaftGraph = buildRoomGraph(shaftDef.cells, shaftDef.portals, (c) => /^(?!.*room)(?=.*(elev|lift))/i.test(c.name ?? ''));
  ok(exitsFrom(shaftGraph, shaftDef.portals, new THREE.Matrix4(), DOOR_TUNE.step).length === 0, 'a door from the street into a lift shaft is not a way in');
  ok(exitsFrom(buildRoomGraph(drawHouse({}).cells, drawHouse({}).portals), drawHouse({}).portals, new THREE.Matrix4(), DOOR_TUNE.step).length === 1, '... where the same door into a hall is');
}

// ---- 2: the door chosen -----------------------------------------------------------------------------
{
  const house = place('two_doors', drawHouse({ back: true }), 20, 20, 0);
  const exits = doorwayNav.exits(house);
  ok(exits.length === 2, 'a building with a front and a back door has two ways in');
  const front = exits.findIndex((e) => e.room === 1);
  const back = exits.findIndex((e) => e.room === 2);
  const rooms = worldNav.forBuilding(house).rooms;
  const goal = toWorld(house, 5, 15); // somebody in the back room
  const inFront = toWorld(house, 5, -15);
  const behind = toWorld(house, 5, 35);
  ok(chooseExit(exits, rooms, house.inverse, 2, goal.x, 0, goal.z, inFront.x, inFront.z) === front, 'from the street in front, somebody in the back room is reached by the front door and through the house');
  ok(chooseExit(exits, rooms, house.inverse, 2, goal.x, 0, goal.z, behind.x, behind.z) === back, '... and from behind, by the back door rather than round the whole building');
  const hall = toWorld(house, 5, 5);
  ok(chooseExit(exits, rooms, house.inverse, 1, hall.x, 0, hall.z, behind.x, behind.z) === back, 'the walk inside counts: from behind, to the front room, the back door and one room is still nearer than round the outside');
  ok(chooseExit(exits, rooms, house.inverse, 2, goal.x, 0, goal.z, inFront.x, inFront.z, front) === back, 'a door given up on is passed over for the next best');
  ok(chooseExit([], rooms, house.inverse, 2, goal.x, 0, goal.z, inFront.x, inFront.z) === -1, 'a building with no way in answers none, and the old rules decide');

  // A doorway up in the air -- its sill well over the ground outside -- is not a way in on foot.
  const tall = place('door_in_the_air', drawHouse({ frontSill: 6 }), 60, 20, 0);
  const tallExits = doorwayNav.exits(tall);
  const flatGround = () => 0;
  const g2 = toWorld(tall, 5, 5);
  ok(chooseExit(tallExits, worldNav.forBuilding(tall).rooms, tall.inverse, 1, g2.x, 0, g2.z, 65, 0, -1, flatGround) === -1, `a door whose sill stands ${6} m over the ground outside it is refused (past ${DOOR_TUNE.sill} m)`);
  ok(chooseExit(tallExits, worldNav.forBuilding(tall).rooms, tall.inverse, 1, g2.x, 0, g2.z, 65, 0, -1, null) === 0, '... and only when the ground is known: without it nothing is refused for its height');
  const deepGround = () => 30;
  ok(chooseExit(doorwayNav.exits(house), rooms, house.inverse, 2, goal.x, 0, goal.z, inFront.x, inFront.z, -1, deepGround) === -1, '... and a door opening thirty metres under the ground outside it (a dungeon’s way in under the sand) is not one either');

  // The same, from the inside: the floors told the goal is outside go out by the door nearest the goal.
  const graph = rooms;
  const inHall = toLocal(house, hall);
  const outBack = toLocal(house, behind);
  const via = exitToward(graph, 1, inHall.x, inHall.z, outBack.x, outBack.z);
  ok(!!via && via.geometry === 1, 'a body in the front room sent after somebody behind the house makes for the back room first, to leave by the back door');
  ok(nextDoor(graph, 1, 0)?.geometry === 0, '... where the old rule, which knew only that the goal was outside, walked it out of the front door and round');
  const outFront = toLocal(house, inFront);
  ok(exitToward(graph, 1, inHall.x, inHall.z, outFront.x, outFront.z)?.geometry === 0, '... and after somebody in front, straight out of the front door');
  doorCosts(graph, 2, 5, 15);
  ok(near(graph.work.cost[1], 5) && near(graph.work.cost[0], 15), 'the walk inside is measured from the point, door to door');
}

// ---- 2b: the walk inside, where it is not the straight line --------------------------------------
//
// In the two-room house above every door stands on one line, so the walk inside and the straight
// line are the same number and a door chosen by either is the same door. The U-shaped house is where
// they part: somebody in room 1 standing by its right-hand wall is nearer door B in a straight line,
// and door B is the far end of the whole building from them on foot.
{
  const house = place('u_house', drawU(), 200, 20, 0);
  const exits = doorwayNav.exits(house);
  const a = exits.findIndex((e) => e.room === 1);
  const b = exits.findIndex((e) => e.room === 2);
  ok(exits.length === 2 && a >= 0 && b >= 0, 'the U-shaped house has its two ways in, one into each front room');
  const rooms = worldNav.forBuilding(house).rooms;
  const goal = toWorld(house, 9, 5); // in room 1, by the wall it shares with room 2
  const from = toWorld(house, 10, -10); // in the street, between the two doors
  ok(chooseExit(exits, rooms, house.inverse, -1, goal.x, 0, goal.z, from.x, from.z) === b, 'measured in a straight line from somebody whose room is not known, door B looks nearer');
  ok(chooseExit(exits, rooms, house.inverse, 1, goal.x, 0, goal.z, from.x, from.z) === a, '... but told they are in room 1, the walk inside counts and door A is the way in: B is a corridor and a room away');

  // The walk inside never goes out into the street and back in, which here would be the shorter way.
  const graph = rooms;
  const doorB = graph.doors.findIndex((d) => d.geometry === 1);
  const doorA = graph.doors.findIndex((d) => d.geometry === 0);
  doorCosts(graph, 1, 9, 5);
  const inside = Math.hypot(9 - 5, 5 - 10) + 10 + Math.hypot(15 - 12.5, 10 - 0);
  const street = Math.hypot(9 - 5, 5 - 0) + 7.5;
  ok(near(graph.work.cost[doorA], Math.hypot(4, 5), 1e-6), 'from room 1 door A is the walk across the room');
  ok(near(graph.work.cost[doorB], inside, 1e-6) && inside > street, `... and door B is round the back, ${inside.toFixed(1)} m, never out of A and in at B for ${street.toFixed(1)}: that would be two ways, not one`);

  // Nor through a lift shaft: with the corridor a shaft, room 2 cannot be walked to from room 1 at all.
  const shaftDef = drawU(true);
  const shaftGraph = buildRoomGraph(shaftDef.cells, shaftDef.portals, (c) => /^(?!.*room)(?=.*(elev|lift))/i.test(c.name ?? ''));
  doorCosts(shaftGraph, 1, 9, 5);
  ok(shaftGraph.work.cost[shaftGraph.doors.findIndex((d) => d.geometry === 1)] === Infinity, '... nor through a lift shaft, whose stops are doorways with nothing between them');
}

// ---- 3: the walk in, round the building on the grid ----------------------------------------------
//
// A 64 m world with the two-room building's footprint in it (B, the indoor mark). The body starts
// behind the building with the goal in its front room, whose only door faces the other way: the
// straight line runs through the building, so the grid routes it round, the join walks it to the
// door and through it, and the room flips.
{
  const nx = 32;
  const rows: string[] = [];
  for (let j = 0; j < nx; j++) {
    let row = '';
    for (let i = 0; i < nx; i++) row += i >= 10 && i < 15 && j >= 10 && j < 20 ? 'B' : '.';
    rows.push(row);
  }
  const solid = new Uint8Array(nx * nx);
  const flags = new Uint8Array(nx * nx);
  for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) if (rows[j][i] === 'B') flags[j * nx + i] = 1;
  const p = packGrid(nx, nx, solid, flags, 1, COARSE, undefined, CLEARANCE_MAX) as { nibbles: Uint8Array; coarse: Uint8Array; edges: Uint8Array; clear: Uint8Array; cnx: number; cnz: number };
  const header: OutdoorHeader = {
    version: NAV_GRID_VERSION,
    planet: 'drawn',
    cell: 2,
    coarse: COARSE,
    nx,
    nz: nx,
    cnx: p.cnx,
    cnz: p.cnz,
    x0: 0,
    z0: 0,
    fineBytes: p.nibbles.length,
    coarseBytes: p.coarse.length,
    edgeBytes: p.edges.length,
    clearBytes: p.clear.length,
    clearMax: CLEARANCE_MAX,
    slopeDegrees: SLOPE_CLIMB_DEGREES,
  };
  const bytes = new Uint8Array(p.nibbles.length + p.coarse.length + p.edges.length + p.clear.length);
  bytes.set(p.nibbles, 0);
  bytes.set(p.coarse, p.nibbles.length);
  bytes.set(p.edges, p.nibbles.length + p.coarse.length);
  bytes.set(p.clear, p.nibbles.length + p.coarse.length + p.edges.length);
  ok(!!decodeGrid(header, bytes) && outdoorNav.adopt('drawn', header, bytes), 'the drawn world loads as a real grid would');
  ok(outdoorNav.forMobiles, `baked at ${SLOPE_CLIMB_DEGREES} degrees it is handed to the world’s people and creatures as well as its fighters`);

  const house = place('grid_house', drawHouse({}), 20, 20, 0);
  const goal = toWorld(house, 5, 5);
  const target: GoalPlace = { building: house, room: 1 };
  const agent = new NavAgent();
  const legs = new DoorLegs();
  legs.who = 'test walker';
  const at = new THREE.Vector3(25, 0, 55);
  let here: CellState | null = null;
  let now = 0;
  let crossedAt: THREE.Vector3 | null = null;
  let throughWall = false;
  let wentRound = false;
  let reached = false;
  const before = doorwayNav.status();
  for (let step = 0; step < 400 && !reached; step++) {
    now += 0.25;
    const c = doorwayNav.corner(agent, legs, here, at.x, 0, at.z, goal.x, 0, goal.z, target, 0.35, now, true);
    const to = c ?? { x: goal.x, z: goal.z };
    const dx = to.x - at.x;
    const dz = to.z - at.z;
    const len = Math.hypot(dx, dz);
    const prev = at.clone();
    if (len > 1e-6) at.set(at.x + (dx / len) * Math.min(1, len), 0, at.z + (dz / len) * Math.min(1, len));
    // The footprint may only be crossed at the doorway: anywhere else is a body through a wall.
    const inside = at.x > 20 && at.x < 30 && at.z > 20 && at.z < 40;
    const wasInside = prev.x > 20 && prev.x < 30 && prev.z > 20 && prev.z < 40;
    if (at.z > 20 && at.z < 40 && (at.x < 20 || at.x > 30)) wentRound = true;
    if (inside && !wasInside) {
      if (Math.abs(at.x - 25) > 1 || at.z > 22) throughWall = true;
    }
    // The tracker: the room flips when the path crosses the doorway's plane between its posts, as
    // `LayoutStreamer.trackCell` has it.
    if (!here && prev.z <= 20 && at.z > 20 && Math.abs(at.x - 25) <= 1) {
      here = { building: house, cell: 1 };
      crossedAt = at.clone();
    }
    if (here && at.distanceTo(new THREE.Vector3(goal.x, 0, goal.z)) < 0.5) reached = true;
  }
  const after = doorwayNav.status();
  ok(!throughWall, 'the body never walks through the building’s wall');
  ok(wentRound, '... it goes round beside it, on the grid’s own corners');
  ok(!!crossedAt, 'it comes in through the one door there is');
  ok(reached, '... and reaches somebody standing in the front room');
  ok(after.chosen > before.chosen && after.throughs > before.throughs, 'a door was chosen and walked through');
  ok(after.handIns === before.handIns + 1 && after.last?.way === 'in' && after.last.room === 1 && after.last.building === 'grid_house' && after.last.who === 'test walker', 'and the room flipping under it is the hand-over, recorded with who, which building and which room');
  ok(legs.phase === 0, 'once inside, the walk in is over and the floors have it');

  // A body the rooms have lost track of while it still stands on the building's own footprint is not
  // on the ground the grid describes: the nearest open cell is outside a wall, and a route from there
  // walks it into that wall. It gets nothing from the grid until it is really out.
  const lost = new THREE.Vector3(25, 0, 30);
  const street = new THREE.Vector3(25, 0, 55);
  ok(outdoorNav.indoors(lost.x, lost.z), 'the middle of the drawn house is its footprint on the grid');
  ok(doorwayNav.corner(new NavAgent(), new DoorLegs(), null, lost.x, 0, lost.z, street.x, 0, street.z, null, 0.35, now + 1, true) === null, 'a body standing there with no room to its name is handed no grid corner');
  ok(doorwayNav.corner(new NavAgent(), new DoorLegs(), null, 25, 0, 5, street.x, 0, street.z, null, 0.35, now + 1, true) !== null, '... where one out on the ground, sent round the same house, is');
}

// ---- 4: the walk out, and nothing told -----------------------------------------------------------
{
  const house = place('out_house', drawHouse({ back: true }), 100, 100, 0);
  const legs = new DoorLegs();
  const agent = new NavAgent();
  const inBack = toWorld(house, 5, 15);
  const street = toWorld(house, 5, -20);
  const here: CellState = { building: house, cell: 2 };
  const c = doorwayNav.corner(agent, legs, here, inBack.x, 0, inBack.z, street.x, 0, street.z, { building: null, room: 0 }, 0.35, 1, false);
  const cl = c ? toLocal(house, c) : null;
  ok(!!cl && near(cl.z, 10 - worldNav.tune.through, 1e-6), 'a body in the back room sent after somebody in the street out front walks to the door into the front room first (the doorway alone, in a room with no floor mesh)');
  const behind = toWorld(house, 5, 40);
  const agent2 = new NavAgent();
  const c2 = doorwayNav.corner(agent2, legs, here, inBack.x, 0, inBack.z, behind.x, 0, behind.z, { building: null, room: 0 }, 0.35, 1, false);
  const cl2 = c2 ? toLocal(house, c2) : null;
  ok(!!cl2 && cl2.z > 20, '... and after somebody behind, straight out of the back door');

  // A body outside with nothing told about where its goal is steers exactly as it did before.
  const legs3 = new DoorLegs();
  const outside = toWorld(house, 5, -30);
  ok(doorwayNav.corner(new NavAgent(), legs3, null, outside.x, 0, outside.z, inBack.x, 0, inBack.z, null, 0.35, 1, false) === null, 'with the goal’s place not known, a body outside off the grid walks straight at it, as before');
  const was = DOOR_TUNE.legs;
  doorwayNav.set({ legs: false });
  ok(doorwayNav.corner(new NavAgent(), legs3, null, outside.x, 0, outside.z, inBack.x, 0, inBack.z, { building: house, room: 2 }, 0.35, 1, false) === null, 'and with the join switched off, even told, which is the comparison `__debug.nav({ door: { legs: false } })` makes');
  doorwayNav.set({ legs: was });
  const told = doorwayNav.corner(new NavAgent(), legs3, null, outside.x, 0, outside.z, inBack.x, 0, inBack.z, { building: house, room: 2 }, 0.35, 1, false);
  const exits = doorwayNav.exits(house);
  ok(!!told && exits.some((e) => near(told.x, e.outX) && near(told.z, e.outZ)), 'switched on and told, it makes for a door’s outside point');

  // A walk through that never flips the room gives the door up and chooses another.
  const stuckLegs = new DoorLegs();
  const e0 = exits[stuckLegs.exit < 0 ? 0 : stuckLegs.exit];
  const standOut = { x: e0.outX, z: e0.outZ };
  const goalIn = toWorld(house, 5, 5);
  doorwayNav.corner(new NavAgent(), stuckLegs, null, standOut.x, 0, standOut.z, goalIn.x, 0, goalIn.z, { building: house, room: 1 }, 0.35, 10, false);
  ok(stuckLegs.phase === 2, 'at a door’s outside point the walk through begins');
  // Come to the door from the side, the walk through aims along the doorway's own axis a little ahead
  // of the body rather than straight at the inside point, or it cuts the corner into the jamb.
  const sideLegs = new DoorLegs();
  const e1 = exits.find((q) => q.room === 1)!;
  const side = toWorld(house, 5 + 1.2, -DOOR_TUNE.step);
  const aim = doorwayNav.corner(new NavAgent(), sideLegs, null, side.x, 0, side.z, goalIn.x, 0, goalIn.z, { building: house, room: 1 }, 0.35, 20, false);
  const aimL = aim ? toLocal(house, aim) : null;
  ok(sideLegs.phase === 2 && sideLegs.exit === exits.indexOf(e1) && !!aimL && near(aimL.x, 5, 1e-6) && near(aimL.z, -DOOR_TUNE.step + DOOR_TUNE.lead, 1e-6), `a body 1.2 m to the side of the door is aimed at the doorway's axis ${DOOR_TUNE.lead} m ahead of it, not at the jamb`);
  const gaveUp = doorwayNav.status().gaveUp;
  const given = 10 + DOOR_TUNE.through + 0.1;
  const stuckExit = stuckLegs.exit;
  doorwayNav.corner(new NavAgent(), stuckLegs, null, standOut.x, 0, standOut.z, goalIn.x, 0, goalIn.z, { building: house, room: 1 }, 0.35, given, false);
  ok(doorwayNav.status().gaveUp === gaveUp + 1 && stuckLegs.refused === stuckExit, `a walk through that has not flipped the room in ${DOOR_TUNE.through} s gives that door up`);
  // And the door given up is really passed over by the walk, not only counted: asked again from the
  // same spot before the refusal is out, the body is sent to the other door -- although the one it
  // gave up is the one it is standing at and is by far the nearer way to the front room.
  const other = exits.findIndex((q, k) => k !== stuckExit);
  doorwayNav.corner(new NavAgent(), stuckLegs, null, standOut.x, 0, standOut.z, goalIn.x, 0, goalIn.z, { building: house, room: 1 }, 0.35, given + 0.1, false);
  ok(stuckLegs.exit === other && stuckLegs.phase === 1, 'asked again before the refusal is out, it makes for the other door instead');
  doorwayNav.corner(new NavAgent(), stuckLegs, null, standOut.x, 0, standOut.z, goalIn.x, 0, goalIn.z, { building: house, room: 1 }, 0.35, given + DOOR_TUNE.refuse + 1, false);
  ok(stuckLegs.exit === stuckExit, `... and once the ${DOOR_TUNE.refuse} s are out the door it gave up is chosen again on its merits`);
}

// ---- 4b: told the goal's room, the floors take the word over their boxes -------------------------
{
  const house = place('told_room', drawHouse({}), 140, 100, 0);
  const here: CellState = { building: house, cell: 1 };
  const body = toWorld(house, 5, 2);
  // A point that room 1's box holds, and that the caller says is in room 2: a room overhanging the
  // next is the ordinary case in a real building, and the room the world follows somebody into is
  // the better word on where they are.
  const goal = toWorld(house, 5, 5);
  const told = doorwayNav.corner(new NavAgent(), new DoorLegs(), here, body.x, 0, body.z, goal.x, 0, goal.z, { building: house, room: 2 }, 0.35, 1, false);
  const tl = told ? toLocal(house, told) : null;
  ok(!!tl && tl.z > 10 && near(tl.x, 5, 1e-6), 'told the goal is in room 2, a body in room 1 walks through the door between them, whatever room 1’s box says about the point');
  ok(doorwayNav.corner(new NavAgent(), new DoorLegs(), here, body.x, 0, body.z, goal.x, 0, goal.z, null, 0.35, 1, false) === null, '... where untold, the box puts the goal in its own room and it walks straight at it, as before');
}

// ---- 5: a wall between is not a doorway -------------------------------------------------------------
{
  const self: BrainSelf = {
    key: 9, x: 0, y: 0, z: 0, heading: 0, homeX: 0, homeZ: 0, side: 'wild', aggression: 'aggressive', inside: false,
    big: false, reach: 1.5, ranged: 0, melee: true, halfHeight: 0.9, hpRatio: 1, state: 'chase', targetKey: 1, stuck: 0, now: 10,
    wanderAt: 0, goal: null, until: 0, blockedSince: null, forgetKey: null, forgetUntil: 0,
  };
  const foe: BrainTarget = { key: 1, x: 1.5, y: 0, z: 0, halfHeight: 0.9, radius: 0.8, side: 'player', aggression: 'defensive', dead: false, attackedMeAt: 9.5, hasLine: false };
  ok(decide(self, [foe]).state === 'attack', 'a body in reach of what it is fighting strikes');
  ok(decide(self, [{ ...foe, apart: true }]).state === 'chase', '... but with a wall between them it chases instead, round to the door');

  // Where the wall is, which the rooms alone cannot say: two things in different places may be an
  // arm's length apart across an open doorway -- a creature on the step, somebody just inside -- and
  // the blow must land there, or a player standing on a threshold cannot be touched and the chaser,
  // walking through the very doorway they fill, is stuck until it gives the fight up. So the last word
  // is the physics': a real world, a wall along z = 0 with a two-metre doorway in it at x -1..1.
  const physics = Physics.local();
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(4.5, 1.5, 0.1).setTranslation(-5.5, 1.5, 0));
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(4.5, 1.5, 0.1).setTranslation(5.5, 1.5, 0));
  physics.stepOnce();
  const house = place('wall_house', drawHouse({}), 0, 0, 0);
  const inRoom: CellState = { building: house, cell: 1 };
  // The body on the street side (z -0.6), what it fights on the room side (z 0.6), at chest height.
  const across = (x: number, there: CellState | null | undefined, here: CellState | null, probe: typeof physics | null): boolean => wallBetween(probe, here, there, here !== null, x, 0.9, -0.6, x, 0.9, 0.6);
  ok(!across(0, inRoom, null, physics), 'a body on the street and somebody just inside, across the doorway: no wall between, the blow lands');
  ok(across(5, inRoom, null, physics), '... the same two a few metres along, either side of the wall itself: a wall between');
  ok(across(-5, inRoom, { building: place('other_house', drawHouse({}), 0, 0, 0), cell: 1 }, physics), '... and in two different buildings, the same');
  ok(!across(5, null, null, physics), 'two things both out on the street are never apart, however much wall the line crosses: the rooms say no wall could be there and nothing is cast');
  ok(!across(5, undefined, null, physics), '... nor is anything nobody follows, which is every pair there was before any of this');
  ok(!across(5, inRoom, inRoom, physics), '... nor two in the same building');
  ok(across(0, inRoom, null, null), 'with no physics to ask, the rooms’ word stands alone: different places are apart');
  const onStep: BrainTarget = { ...foe, x: 0, z: 0.6, apart: across(0, inRoom, null, physics) };
  const behindWall: BrainTarget = { ...foe, x: 5, z: 0.6, apart: across(5, inRoom, null, physics) };
  ok(decide({ ...self, x: 0, z: -0.6 }, [onStep]).state === 'attack', 'fed to the brain, a body strikes across the doorway');
  ok(decide({ ...self, x: 5, z: -0.6 }, [behindWall]).state === 'chase', '... and goes round to the door from behind the wall');

  // The leash follows home, not the room it has walked into.
  const far = { ...self, x: 40, inside: true, targetKey: 1 };
  const kept = decide(far, [{ ...foe, x: 42 }]);
  ok(decide({ ...far, homeInside: false }, [{ ...foe, x: 42 }]).state !== 'return', `a creature from the street that has followed somebody indoors keeps the street’s ${BRAIN_TUNE.leash} m leash`);
  ok(kept.state === 'return', `... where one that belongs indoors keeps the room’s ${BRAIN_TUNE.leashInside} m, as it always did (and as any body does that says nothing about its home)`);
}

// ---- 5b: where a goal is, as the bodies tell the join ---------------------------------------------
//
// The whole wave rests on these three answers reaching the join: which room a living thing is followed
// in, where that puts it as a goal, and where a walk that is not a chase is going. Each is a pure
// function the bodies and the world call by name (pinned in section 7), tried here on rooms drawn by
// hand.
{
  const house = place('places_house', drawHouse({ back: true }), 400, 0, 0);
  const inFront: CellState = { building: house, cell: 1 };
  const inBack: CellState = { building: house, cell: 2 };
  const player = { key: 1 };
  ok(cellOfLiving(player, player, inBack) === inBack, 'the player is where the world follows the player: indoors, that room');
  ok(cellOfLiving(player, player, null) === null, '... out on the street, open ground');
  ok(cellOfLiving({ navCell: inFront }, player, inBack) === inFront && cellOfLiving({ navCell: null }, player, inBack) === null, 'a catalogue body is where its own followed room says, open ground included');
  ok(cellOfLiving({ cell: inBack }, player, null) === inBack && cellOfLiving({ cell: null }, player, inBack) === null, 'a fighter is where its room says');
  ok(cellOfLiving({ key: 7 }, player, inBack) === undefined, 'and anything nobody follows (another player, a turret) is nowhere anybody can say');

  const out: GoalPlace = { building: null, room: -5 };
  const inRoom = placeOfCell(inBack, out);
  ok(inRoom === out && out.building === house && out.room === 2, 'somebody followed into the back room is a goal in that room of that building, written into the kept place');
  const onGround = placeOfCell(null, out);
  ok(onGround === out && out.building === null && out.room === 0, '... somebody on open ground is a goal outside');
  ok(placeOfCell(undefined, out) === null, '... and somebody nobody follows is no place at all, and the old rules decide');

  // A walker's round: its point's room in the building it was stood in; a point outdoors is outside.
  ok(placeOfWalk(out, 'wander', true, 2, inFront, null) === out && out.building === house && out.room === 2, 'a walker making for an indoor point of its round is making for that room of the building it was stood in');
  ok(placeOfWalk(out, 'wander', true, 2, null, inBack) === out && out.building === house && out.room === 2, '... or, stood outside, of the building it is in');
  ok(placeOfWalk(out, 'wander', true, 2, null, null) === null, '... and an indoor point with no building to name is nobody’s to say');
  ok(placeOfWalk(out, 'return', true, undefined, inFront, inFront) === out && out.building === null && out.room === 0, '... while a point with no room is open ground, even walked home to from a room after a fight');
  // Home and a wander about it.
  ok(placeOfWalk(out, 'return', false, undefined, inFront, null) === out && out.building === house && out.room === 1, 'a body walking home is making for the room it was stood in');
  ok(placeOfWalk(out, 'wander', false, undefined, inFront, null) === out && out.building === house && out.room === -1, '... a wander about home, for that building but no room in particular');
  ok(placeOfWalk(out, 'return', false, undefined, null, inBack) === out && out.building === null && out.room === 0, '... and home on the sand is open ground, wherever the chase left it');
  ok(placeOfWalk(out, 'flee', false, undefined, inFront, inFront) === null, 'a flight nobody can place');
}

// ---- 5c: a body walked through a doorway measures its arrival against its goal ---------------------
//
// The walk through hands back a point a little ahead of the body along the doorway's axis, and a body
// that takes that point as its **goal** stops `arrive` short of it: with the join's own knob turned a
// little (a nearer point, a shorter lead) that is short of the doorway's plane, the room never flips,
// and the door is given up. The fighters walked that way; they now walk at the point and measure their
// arrival against where they are really going, as the mobiles always have. Walked here at the
// fighters' own `arrive`, read out of npcs.ts, with the room flipping as `trackCell` flips it.
{
  const npcs = readFileSync(new URL('../../../src/world/npcs.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const arrive = Number(/export const FIGHTER_TUNE[\s\S]*?\n {2}arrive: ([\d.]+),/.exec(npcs)?.[1]);
  ok(arrive > 0 && arrive < 1, `a fighter counts itself arrived within ${arrive} m`);
  let n = 0;
  const walk = (rule: 'goal' | 'corner', tune: Partial<DoorTune>): boolean => {
    const keep = { ...DOOR_TUNE };
    doorwayNav.set(tune);
    try {
      const house = place(`arrive_${n++}`, drawHouse({}), 300, 300, 0);
      const goal = toWorld(house, 5, 5);
      const at = toWorld(house, 5, -3);
      const legs = new DoorLegs();
      const agent = new NavAgent();
      const target: GoalPlace = { building: house, room: 1 };
      const gaveUp = doorwayNav.status().gaveUp;
      let now = 0;
      for (let i = 0; i < 400; i++) {
        now += 0.05;
        const c = doorwayNav.corner(agent, legs, null, at.x, 0, at.z, goal.x, 0, goal.z, target, 0.35, now, false);
        if (doorwayNav.status().gaveUp !== gaveUp) return false;
        const via = c ?? goal;
        const to = rule === 'goal' ? goal : via;
        const away = Math.hypot(to.x - at.x, to.z - at.z);
        if (away <= arrive) continue;
        const len = Math.hypot(via.x - at.x, via.z - at.z);
        if (len < 1e-9) continue;
        const step = Math.min(away, 3 * 0.05);
        const was = toLocal(house, at);
        at.set(at.x + ((via.x - at.x) / len) * step, 0, at.z + ((via.z - at.z) / len) * step);
        const is = toLocal(house, at);
        if (was.z <= 0 && is.z > 0 && Math.abs(is.x - 5) <= 1) return true;
      }
      return false;
    } finally {
      doorwayNav.set(keep);
    }
  };
  ok(walk('goal', {}), 'walking at the point and measuring against the goal, a fighter goes through the doorway at the join’s own numbers');
  ok(walk('goal', { step: 0.4, lead: 0.3 }), '... and with the doorway’s points brought in to 0.4 m and the lead to 0.3, which is the knob the console moves');
  ok(!walk('corner', { step: 0.4, lead: 0.3 }), `... where a body measured against the point stops ${arrive} m short of it, short of the plane, and gives the door up`);
  ok(DOOR_TUNE.step === 0.8 && DOOR_TUNE.lead === 0.5, 'and the knob is put back');
}

// ---- 6: the grid's angle and the bodies it is handed to ------------------------------------------
{
  ok(SLOPE_CLIMB_DEGREES <= MOBILE_CLIMB_DEGREES, `the converter bakes at ${SLOPE_CLIMB_DEGREES} degrees, no steeper than the ${MOBILE_CLIMB_DEGREES} a mobile climbs at a walk, so a fresh bake is handed to them`);
}

// ---- 7: the wiring, read as text ----------------------------------------------------------------------
//
// `mobile.ts`, `npcs.ts` and `world.ts` pull in three and half the world, so what can be pinned is the
// shape of the seam.
{
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mobile = src('world/mobiles/mobile.ts');
  const npcs = src('world/npcs.ts');
  const world = src('world/world.ts');
  const manager = src('world/mobiles/manager.ts');
  // What a mobile hands the join: its room, where the goal is -- the thing it is fighting, or the goal
  // of any other walk -- and whether it walks the grid. Each argument is named, not skipped over.
  ok(mobile.includes('const place = fighting && target ? this.placeOf(ctx, target) : this.placeOfGoal(d);'), 'a mobile works out where its goal is: the room of the thing it is fighting, or the goal of its walk');
  ok(mobile.includes('doorwayNav.corner(this.navAgent, this.legs, this.navCell, this.pos.x, this.pos.y, this.pos.z, moveTo.x, goalY, moveTo.z, place, this.plan.across, this.now, this.walksGrid())'), '... and asks the join for its corner, indoors and out, with its room, that place and whether it walks the grid');
  ok(/private placeOf\(ctx: MobileContext, t: Living\): GoalPlace \| null \{\s*return placeOfCell\(ctx\.cellOf \? ctx\.cellOf\(t\) : undefined, this\.goalPlace\);/.test(mobile), '... the place of what it fights being the room the world follows that in (`placeOfCell`)');
  ok(/const onRound = !!p && \(d\.goal === p\.goal \|\| d\.state === 'return'\);\s*return placeOfWalk\(this\.goalPlace, d\.state, onRound, p \? p\.anchor\.room : undefined, this\.homeCell, this\.navCell\);/.test(mobile), '... and the place of any other walk its round’s point or its home (`placeOfWalk`)');
  ok(/outdoorNav\.forMobiles && !this\.flyer && !this\.swimming && this\.plan\.across <= MOBILE_GRID_ACROSS/.test(mobile), '... and it walks the grid only where the bake is gentle enough, it is on its feet and it fits');
  ok(/private apartFrom\(ctx: MobileContext, t: Living\): boolean \{\s*return wallBetween\(\s*this\.deps\.physics,\s*this\.navCell,\s*ctx\.cellOf \? ctx\.cellOf\(t\) : undefined,\s*this\.inside,/.test(mobile), 'a mobile asks `wallBetween` whether a wall stands between it and what it fights, with the physics, both rooms and its own filter');
  ok(mobile.includes('b.apart = this.melee && !t.dead && Math.hypot(dx, dz) - b.radius <= reach + DOOR_TUNE.wallLook ? this.apartFrom(ctx, t) : undefined;'), '... of what a blow could nearly reach, for the brain');
  ok(mobile.includes('this.apart = asked ?? this.apartFrom(ctx, this.targetRef);'), '... and of what it chose to fight, for the frames between thoughts');
  ok(/if \(this\.melee && !this\.apart && gap/.test(mobile), 'and a body with a wall between it and its foe does not stop to swing at the plaster');

  // A fighter, the same.
  ok(npcs.includes('const place = t && moveTo === this.faceAt ? this.placeOf(t) : null;'), 'a fighter chasing its foe works out where the foe is');
  ok(/doorwayNav\.corner\(this\.navAgent, this\.legs, this\.cell, this\.pos\.x, this\.pos\.y, this\.pos\.z, moveTo\.x, goalY, moveTo\.z, place, /.test(npcs), '... and asks the same join with it');
  ok(/private placeOf\(t: Living\): GoalPlace \| null \{\s*return placeOfCell\(this\.cellOf \? this\.cellOf\(t\) : undefined, this\.goalPlace\);/.test(npcs), '... the foe’s place being the room the world follows it in');
  ok(npcs.includes('npc.cellOf = this.deps.cellOf ?? null;'), '... which the manager hands every fighter it steps');
  ok(/private apartFrom\(t: Living\): boolean \{\s*return wallBetween\(\s*this\.physics,\s*this\.cell,\s*this\.cellOf \? this\.cellOf\(t\) : undefined,\s*!!this\.cell,/.test(npcs), 'a fighter asks `wallBetween` too');
  ok(npcs.includes('b.apart = melee && !t.dead && Math.hypot(dx, dz) - b.radius <= FIGHTER_TUNE.reach + DOOR_TUNE.wallLook ? this.apartFrom(t) : undefined;') && npcs.includes('this.apart = asked ?? this.apartFrom(next);'), '... for the brain and for the frames between thoughts');
  // The reach it stops at is the old swings' own, or where arm and blade really reach for a blade swung
  // through the move machine (`npcSaber.ts`): either way the wall between is asked first.
  ok(/if \(this\.arm !== 'gun' && !this\.apart && gap - t\.radiusToward\(this\.pos\) - this\.radiusToward\(\) <= \(this\.bladesOn \? NPC_SABER_TUNE\.closeTo : FIGHTER_TUNE\.reach\)\) pace = 'stand';/.test(npcs), '... so a blade with a wall between it and its foe goes round to the door rather than stopping at the plaster');
  ok(npcs.includes('homeInside: this.homeInside,') && npcs.includes('npc.homeInside = npc.cell !== null;'), 'a fighter keeps the leash of where it was stood, not of the room a chase has taken it into');
  ok(/const e = new Errand\([^;]*;\s*e\.begin\(w\);[\s\S]{0,300}?npc\.homeInside = false;/.test(npcs), '... and a long walk, which moves its home onto the ground, gives it the ground’s');
  // Where it walks and whether it has arrived are two points (section 5c walks why).
  ok(npcs.includes('if (corner) via = corner;') && !npcs.includes('if (corner) moveTo = corner;'), 'a fighter walks at the path’s point and never takes it as its goal');
  ok(npcs.includes('const wantTravel = goTo && via ? Math.atan2(via.x - this.pos.x, via.z - this.pos.z) : Number.NaN;'), '... its travel is along the path');
  ok(/const goTo = pace === 'stand' \? null : moveTo;[\s\S]*?const away = Math\.hypot\(goTo\.x - this\.pos\.x, goTo\.z - this\.pos\.z\);\s*if \(away > FIGHTER_TUNE\.arrive\)/.test(npcs), '... and its arrival is measured against where it is really going');

  // The world: which room each living thing is in, handed to both.
  ok(world.includes('private readonly livingCell = (t: Living): CellState | null | undefined => cellOfLiving(t, this.playerTarget, this.cellState);'), 'the world answers which room a living thing is in with `cellOfLiving`, the player by the player’s own followed room');
  ok(/cellOf: this\.livingCell/.test(world) && (world.match(/cellOf: this\.livingCell/g) ?? []).length === 2, 'the world tells the mobiles on every step and the fighters once which room each living thing is in');
  ok(/m\.homeCell = held\.cell;/.test(manager), 'a body stood in a room keeps that room as home');
  ok(/homeInside: this\.homeCell !== null/.test(mobile), '... which is what says which leash it keeps');
  ok(/doorwayNav\.ground = \(x, z\) => this\.terrain\.heightAt\(x, z\)/.test(world), 'the join is handed the ground, so a door up in the air is never a way in');
}

console.log(`\n${checks} checks passed`);
