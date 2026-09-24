// The outdoor pathing: the grid the converter bakes, the two-pass search over it, the string-pull
// that turns a path into corners, and the game's side that hands a body one corner at a time.
//
// Every world here is drawn by hand in this file, a character a cell, and packed by the converter's
// **own** `packGrid` -- the same arithmetic that runs over a real planet -- so the bytes the runtime
// reads in this test are the bytes the converter writes. Nothing is read from the owner's archives
// and nothing needs a pack.
//
// The shapes are chosen so the answers can be written down rather than computed: a clear line has
// no corners at all, a U-shaped wall has exactly one way round, a sealed pocket has none, and two
// coarse cells with a wall on their shared border must not be offered as a hop however much of
// each of them is open -- which is the bug that made four cross-country routes stop dead.
import assert from 'node:assert/strict';
import {
  COARSE,
  INDOOR,
  INDOOR_ABOVE,
  INDOOR_BELOW,
  NAV_GRID_VERSION,
  OTHER_REGION,
  RANKS,
  indoorFootprint,
  isBuildingDef,
  packGrid,
  readGlbTriangles,
} from '../navgrid.mjs';
import {
  NAV_GRID_VERSION as RUNTIME_VERSION,
  NAV_INDOOR,
  NAV_OTHER,
  NAV_RANKS,
  OUTDOOR_TUNE,
  OutdoorWork,
  cellOf,
  cellX,
  cellZ,
  coarseJoins,
  coarseSearch,
  decodeGrid,
  isIndoor,
  isOpen,
  lineClear,
  nearestOpen,
  nibbleAt,
  planRoute,
  regionAt,
  unwindCoarse,
  type OutdoorGrid,
  type OutdoorHeader,
  type OutdoorTune,
} from '../../../src/world/nav/outdoorGrid.ts';
import { OutdoorNav } from '../../../src/world/nav/outdoorNav.ts';
import { NavAgent } from '../../../src/world/nav/navAgent.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const CELL = 2;

interface Drawn {
  grid: OutdoorGrid;
  work: OutdoorWork;
  header: OutdoorHeader;
  bytes: Uint8Array;
  nx: number;
  nz: number;
}

/** A world from rows of characters: `#` blocked, `B` a building's footprint, anything else open. */
function draw(rows: string[], coarseStep = COARSE): Drawn {
  const nz = rows.length;
  const nx = rows[0].length;
  for (const r of rows) assert.equal(r.length, nx, 'every row is the same length');
  const solid = new Uint8Array(nx * nz);
  const flags = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = rows[j][i];
      if (c === '#') solid[j * nx + i] = 1;
      else if (c === 'B') flags[j * nx + i] = 1;
    }
  }
  const p = packGrid(nx, nz, solid, flags, 1, coarseStep) as {
    nibbles: Uint8Array;
    coarse: Uint8Array;
    edges: Uint8Array;
    regions: { seed: number; cells: number }[];
    cnx: number;
    cnz: number;
  };
  const header: OutdoorHeader = {
    version: NAV_GRID_VERSION,
    planet: 'drawn',
    cell: CELL,
    coarse: coarseStep,
    nx,
    nz,
    cnx: p.cnx,
    cnz: p.cnz,
    x0: 0,
    z0: 0,
    fineBytes: p.nibbles.length,
    coarseBytes: p.coarse.length,
    edgeBytes: p.edges.length,
  };
  const bytes = new Uint8Array(p.nibbles.length + p.coarse.length + p.edges.length);
  bytes.set(p.nibbles, 0);
  bytes.set(p.coarse, p.nibbles.length);
  bytes.set(p.edges, p.nibbles.length + p.coarse.length);
  const grid = decodeGrid(header, bytes);
  assert.ok(grid, 'the drawn world decodes');
  return { grid: grid as OutdoorGrid, work: new OutdoorWork(header, 4096), header, bytes, nx, nz };
}

/** The middle of cell (i, j) in the world's own coordinates. */
const at = (i: number, j: number): [number, number] => [(i + 0.5) * CELL, (j + 0.5) * CELL];

// ---- the two sides agree about what a nibble means --------------------------------------------

ok(NAV_GRID_VERSION === RUNTIME_VERSION, `the converter and the game read the same grid version (${NAV_GRID_VERSION})`);
ok(RANKS === NAV_RANKS && OTHER_REGION === NAV_OTHER && INDOOR === NAV_INDOOR, 'the nibble values are the same table on both sides');

// ---- the packing ------------------------------------------------------------------------------
{
  // A room off a corridor, sealed by its own wall, and a building's footprint beside them.
  const w = draw([
    '................',
    '................',
    '....########....',
    '....#......#....',
    '....#......#....',
    '....########....',
    '................',
    '......BBBB......',
    '......BBBB......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]);
  const outside = nibbleAt(w.grid, 0);
  ok(outside === 1, `the ground round everything is the largest region, rank ${outside}`);
  const pocket = nibbleAt(w.grid, 4 * w.nx + 6);
  ok(pocket === 2, `the sealed room is a region of its own, rank ${pocket}`);
  ok(nibbleAt(w.grid, 2 * w.nx + 4) === 0, 'a wall cell is blocked');
  ok(nibbleAt(w.grid, 7 * w.nx + 7) === INDOOR, "a building's footprint is marked indoor, not blocked");
  ok(isIndoor(w.grid, 7 * w.nx + 7) && !isOpen(w.grid, 7 * w.nx + 7), 'and the search will not walk it');
  ok(regionAt(w.grid, ...at(0, 0)) === 1 && regionAt(w.grid, ...at(6, 4)) === 2, 'regionAt reads a world point');
  ok(cellOf(w.grid, -5, 0) === -1 && cellOf(w.grid, 0, 1e6) === -1, 'a point off the world has no cell');
  const k = cellOf(w.grid, ...at(3, 9));
  ok(Math.abs(cellX(w.grid, k) - at(3, 9)[0]) < 1e-9 && Math.abs(cellZ(w.grid, k) - at(3, 9)[1]) < 1e-9, 'a cell index turns back into its own middle');
}

// ---- the sight test ---------------------------------------------------------------------------
{
  const w = draw([
    '................',
    '................',
    '.......#........',
    '.......#........',
    '................',
    '..#.............',
    '...#............',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]);
  ok(lineClear(w.grid, ...at(1, 1), ...at(14, 1)), 'a clear line across open ground');
  ok(!lineClear(w.grid, ...at(7, 1), ...at(7, 6)), 'a line straight through a wall is refused');
  // (2,5) and (3,6) are blocked and touch only at a corner: a body cannot slip between them.
  ok(!lineClear(w.grid, ...at(3, 5), ...at(2, 6)), 'a line exactly through the corner between two blocked cells is refused');
  ok(!lineClear(w.grid, ...at(1, 1), -50, -50), 'a line that leaves the world is refused');
  ok(!lineClear(w.grid, ...at(7, 2), ...at(1, 1)), 'a line that starts on a blocked cell is refused');
}

// ---- the coarse plane tells the truth about its borders ----------------------------------------
{
  // Two coarse cells (COARSE wide) each more than a third open, with a solid wall on the border
  // between them. The share test alone offers both and the route through them is a lie; the baked
  // edge is what refuses it. This is the shape that stopped four cross-country routes dead.
  const side = COARSE;
  const rows: string[] = [];
  for (let j = 0; j < side * 2; j++) {
    let line = '';
    for (let i = 0; i < side * 3; i++) line += i === side || i === side * 2 - 1 ? '#' : '.';
    rows.push(line);
  }
  const w = draw(rows, side);
  const c0 = 0;
  const c1 = 1;
  ok(w.grid.coarse[c0] > 0 && w.grid.coarse[c1] > 0, 'both coarse cells are more than a third open, so the share test offers both');
  // The eastward bit is index (0+1)*3 + (1+1) = 5, which is bit 4 once the middle is left out.
  ok(!(w.grid.edges[c0] & (1 << 4)), 'and the baked edge between them is clear, because no open fine cells touch across it');
  const end = coarseSearch(w.grid, w.work, c0, c1);
  ok(end < 0, 'so the coarse search refuses that hop');
}

{
  // The same two coarse cells with one gap in the wall: now they do join.
  const side = COARSE;
  const rows: string[] = [];
  for (let j = 0; j < side * 2; j++) {
    let line = '';
    for (let i = 0; i < side * 3; i++) line += (i === side || i === side * 2 - 1) && j !== 1 ? '#' : '.';
    rows.push(line);
  }
  const w = draw(rows, side);
  ok(!!(w.grid.edges[0] & (1 << 4)), 'one gap in the wall sets the edge');
  const end = coarseSearch(w.grid, w.work, 0, 1);
  ok(end === 1, 'and the coarse search takes the hop');
  ok(unwindCoarse(w.work, end) === 2, 'the chain it unwinds is the two cells');
}

// ---- the plan ----------------------------------------------------------------------------------
{
  const w = draw([
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '........................########',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
  ]);
  const out = planRoute(w.grid, w.work, ...at(1, 1), ...at(8, 1));
  ok(out === 'straight', `a clear goal fourteen metres off answers '${out}' and runs no search at all`);
  ok(w.work.opened === 0, 'nothing was opened for it');
}

{
  // A wall with one gap, far enough apart that the plain sight test cannot answer.
  const nx = 120;
  const nz = 40;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) line += i === 60 && j !== 35 ? '#' : '.';
    rows.push(line);
  }
  const w = draw(rows);
  const out = planRoute(w.grid, w.work, ...at(5, 5), ...at(110, 5));
  ok(out === 'found', `a goal two hundred metres off behind a wall answers '${out}'`);
  const n = w.work.pulledCount;
  ok(n >= 2, `and hands back ${n} corners rather than one straight line`);
  let allClear = true;
  let px = at(5, 5)[0];
  let pz = at(5, 5)[1];
  for (let i = 0; i < n; i++) {
    if (!lineClear(w.grid, px, pz, w.work.pulled[i * 2], w.work.pulled[i * 2 + 1])) allClear = false;
    px = w.work.pulled[i * 2];
    pz = w.work.pulled[i * 2 + 1];
  }
  ok(allClear, 'every leg between consecutive corners is one the body can walk in a straight line');
  // It went through the gap, which is the only way round.
  let through = false;
  for (let i = 0; i < n; i++) if (Math.abs(w.work.pulled[i * 2 + 1] - at(0, 35)[1]) < CELL * 2) through = true;
  ok(through, 'and it goes through the one gap in the wall');
}

{
  // A sealed pocket, with the rest of the world far enough away that the plain sight test cannot
  // answer for either of them. The bake knows a body inside it can walk nowhere, and says so,
  // rather than sending it at a wall all evening.
  const nx = 200;
  const nz = 60;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) {
      const onWall = (j === 20 || j === 30) && i >= 20 && i <= 30;
      const onSide = (i === 20 || i === 30) && j >= 20 && j <= 30;
      line += onWall || onSide ? '#' : '.';
    }
    rows.push(line);
  }
  const w = draw(rows);
  ok(nibbleAt(w.grid, 25 * w.nx + 25) === 2, 'the sealed room is a region of its own');
  const inward = planRoute(w.grid, w.work, ...at(180, 50), ...at(25, 25));
  ok(inward === 'found', `a goal inside a sealed room, three hundred metres off, answers '${inward}'`);
  const n = w.work.pulledCount;
  const lastX = w.work.pulled[(n - 1) * 2];
  const lastZ = w.work.pulled[(n - 1) * 2 + 1];
  const k = cellOf(w.grid, lastX, lastZ);
  ok(nibbleAt(w.grid, k) === 1, 'and the last corner stands on the bodyâ€™s own ground, not inside the room');

  const out = planRoute(w.grid, w.work, ...at(25, 25), ...at(180, 50));
  ok(out === 'unreachable', `and the way out of the room answers '${out}'`);
  const off = planRoute(w.grid, w.work, ...at(180, 50), 10000, 10000);
  ok(off === 'nowhere', `a goal off the world answers '${off}'`);
}

{
  // The horizon: a long clear run is planned as far as `horizon` and no further, and the body asks
  // again when it has walked that. The corners must still be corners of the real route.
  const nx = 400;
  const nz = 16;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) rows.push('.'.repeat(nx));
  const w = draw(rows);
  const start = at(2, 8);
  const out = planRoute(w.grid, w.work, ...start, ...at(395, 8));
  ok(out === 'found', `a clear eight-hundred-metre run answers '${out}'`);
  const n = w.work.pulledCount;
  const lastX = w.work.pulled[(n - 1) * 2];
  const reach = Math.hypot(lastX - start[0], w.work.pulled[(n - 1) * 2 + 1] - start[1]);
  ok(reach < OUTDOOR_TUNE.horizon * 2, `the last corner is ${reach.toFixed(0)} m off, inside the ${OUTDOOR_TUNE.horizon} m horizon's own reach`);
  ok(reach > OUTDOOR_TUNE.straight, 'and further than the plain sight test would have answered');
}

// ---- the plane's own blindness is its own word, and is paid for once --------------------------
// Two rooms joined by a corridor two cells wide. On the ground that is one walkable region and a
// body really can walk from one to the other; on the sixteen-metre plane the corridor's coarse
// cells are only sixteen cells open out of sixty-four, which is under the share the bake offers, so
// the two rooms are two components of the plane with nothing between them.
//
// That is not a rare shape. On the shipped grid for the largest world the plane holds 8,726
// components over 938,434 offered cells, and 1.44% of the largest region's own ground -- about one
// goal in seventy on the open desert -- stands in one of the small ones. Before this, the search
// from the body's end opened its whole component looking for a cell that was never in it: 200,001
// expansions and 44.5 ms, against 6.7 ms for the longest route the world really has, reported as
// 'unreachable' (which says something false about the ground), and then done again every `retry`
// seconds for as long as the body stood there.
{
  const nx = 96;
  const nz = 24;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) {
      const roomA = i < 24;
      const roomB = i >= 72;
      const corridor = i >= 24 && i < 72 && (j === 11 || j === 12);
      line += roomA || roomB || corridor ? '.' : '#';
    }
    rows.push(line);
  }
  const w = draw(rows);
  ok(nibbleAt(w.grid, 4 * w.nx + 4) === 1 && nibbleAt(w.grid, 12 * w.nx + 91) === 1, 'both rooms are the same walkable region: the ground joins them');
  const coarseOf = (i: number, j: number): number => Math.floor(j / COARSE) * w.header.cnx + Math.floor(i / COARSE);
  ok(!w.grid.coarse[coarseOf(40, 12)], 'and the corridor is too thin for the coarse plane to offer its cells at all');
  const out = planRoute(w.grid, w.work, ...at(4, 4), ...at(91, 12));
  ok(out === 'unjoined', `so the plan answers '${out}' -- the plane's own blindness -- and not 'unreachable', which would be a lie about the ground`);
  ok(w.work.floodOpened > 0 && w.work.flood === 0, `the first ask really looked (${w.work.floodOpened} coarse cells walked from the goal's end) and settled it there`);
  const again = planRoute(w.grid, w.work, ...at(4, 4), ...at(91, 12));
  ok(again === 'unjoined' && w.work.opened === 0 && w.work.floodOpened === 0 && w.work.remembered === 1, 'and the second ask is answered out of the refusal ring with neither search nor flood');
  // The other way round is the same fact and is asked afresh, since the ring is keyed on the pair.
  ok(planRoute(w.grid, w.work, ...at(91, 12), ...at(4, 4)) === 'unjoined', 'the way back is refused too');

  // The goal-side flood on its own: it settles the question from the end the ordinary search cannot.
  w.work.forget();
  const gc = coarseOf(91, 12);
  const sc = coarseOf(4, 4);
  ok(coarseJoins(w.grid, w.work, gc, sc, 10000) === 0, 'the goal-side flood walks the goal\'s whole component and does not find the body in it');
  ok(coarseJoins(w.grid, w.work, gc, gc, 10000) === 1, 'a cell joins itself');
  ok(coarseJoins(w.grid, w.work, gc, sc, 1) === -1, 'and a flood with no room to walk settles nothing rather than guessing');

  // With the flood turned off and a budget too small to answer, the same ask is 'spent' -- which
  // says nothing about the world at all and must not go into the ring. That is the shape the flood
  // exists to avoid, and the two words must stay apart.
  w.work.forget();
  const tight: OutdoorTune = { ...OUTDOOR_TUNE, coarseExpand: 1, componentCap: 0 };
  ok(planRoute(w.grid, w.work, ...at(4, 4), ...at(91, 12), tight) === 'spent', 'with the flood off, a search that simply ran out answers \'spent\'');
  ok(w.work.refusedA.every((v) => v < 0), 'and nothing went into the ring for it');
  const gated: OutdoorTune = { ...OUTDOOR_TUNE, coarseExpand: 1, componentCap: 10000 };
  ok(planRoute(w.grid, w.work, ...at(4, 4), ...at(91, 12), gated) === 'unjoined', 'while with the flood the same ask is settled before the search runs at all');
  ok(w.work.opened === 0 && w.work.floodOpened > 0, 'by the flood alone, with the coarse search never reached');
  w.work.forget();
}

// ---- nothing is allocated by a plan -------------------------------------------------------------
{
  const nx = 120;
  const nz = 40;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) line += i === 60 && j !== 35 ? '#' : '.';
    rows.push(line);
  }
  const w = draw(rows);
  planRoute(w.grid, w.work, ...at(5, 5), ...at(110, 5));
  const raw = w.work.raw;
  const pulled = w.work.pulled;
  const heap = w.work.fHeapK;
  const chain = w.work.chain;
  for (let i = 0; i < 20; i++) planRoute(w.grid, w.work, ...at(5, 5 + (i % 3)), ...at(110, 5));
  ok(w.work.raw === raw && w.work.pulled === pulled && w.work.fHeapK === heap && w.work.chain === chain, 'twenty more plans made no new array: the scratch is the scratch');
}

// ---- snapping ------------------------------------------------------------------------------------
{
  const w = draw([
    '################',
    '#..............#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#..............#',
    '################',
    '################',
    '################',
    '################',
    '################',
    '################',
    '################',
    '################',
  ]);
  const k = nearestOpen(w.grid, ...at(0, 0), 8);
  ok(k >= 0 && isOpen(w.grid, k), 'a body standing on a blocked cell is pulled onto the nearest open one');
  ok(Math.hypot(cellX(w.grid, k) - at(0, 0)[0], cellZ(w.grid, k) - at(0, 0)[1]) <= 8, 'and it really is the nearest, within the snap');
  ok(nearestOpen(w.grid, ...at(8, 14), 4) < 0, 'and a body walled in past the snap is pulled nowhere');
}

// ---- the game's side -------------------------------------------------------------------------------
{
  const nav = new OutdoorNav();
  const agent = new NavAgent();
  ok(!nav.ready && !nav.status().ready, 'a world with no grid is not ready');
  ok(nav.corner(agent, 0, 0, 0, 500, 0, 500, 0.35, 1) === null, 'and every body in it steers exactly as it did before there was any of this');
  ok(nav.reachable(0, 0, 5000, 5000), 'and nothing is ever refused for being unreachable');

  const nx = 120;
  const nz = 40;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) line += i === 60 && j !== 35 ? '#' : '.';
    rows.push(line);
  }
  const w = draw(rows);
  ok(nav.adopt('drawn', w.header, w.bytes), 'the bytes the converter wrote are adopted');
  ok(nav.ready && nav.status().nx === nx, 'and the world is ready');

  const from = at(5, 5);
  const to = at(110, 5);
  const c1 = nav.corner(agent, from[0], 0, from[1], to[0], 0, to[1], 0.35, 1);
  ok(c1 !== null, 'a body two hundred metres from its goal is handed a corner');
  ok(nav.status().found === 1 && nav.status().asked === 1, 'and the search is counted once');
  const same = nav.corner(agent, from[0], 0, from[1], to[0], 0, to[1], 0.35, 1.05);
  ok(same !== null && same.x === c1?.x && same.z === c1?.z, 'standing still it is handed the same corner and searches again for nothing');
  ok(nav.status().asked === 1, 'the body asked for no second search');

  // Walk the corners, asking for the next one each time it arrives.
  let x = from[0];
  let z = from[1];
  let now = 2;
  let legs = 0;
  for (; legs < 200; legs++) {
    const c = nav.corner(agent, x, 0, z, to[0], 0, to[1], 0.35, now);
    now += 1;
    if (!c) break;
    x = c.x;
    z = c.z;
  }
  ok(legs > 1 && legs < 200, `the body walked ${legs} corners and then was told there was nothing to add`);
  ok(Math.hypot(x - to[0], z - to[1]) < OUTDOOR_TUNE.straight, `and finished ${Math.hypot(x - to[0], z - to[1]).toFixed(0)} m from the goal, inside the range the plain sight test answers`);

  const status = nav.status();
  ok(status.found > 0 && status.spent === 0 && status.nowhere === 0, `the whole walk was ${status.found} routes and ${status.straight} straight answers, with nothing spent`);
  ok(status.worstMs >= 0, 'and it reports what its worst search cost');

  // The knob.
  const moved = nav.set({ horizon: 123, reach: 9, notANumber: Number.NaN } as never);
  ok(moved.tune.horizon === 123 && moved.agent.reach === 9, 'the knob moves a number on either table');
  ok(nav.set({ horizon: OUTDOOR_TUNE.horizon, reach: 3 } as never).tune.horizon === OUTDOOR_TUNE.horizon, 'and moves it back');

  nav.unload();
  ok(!nav.ready && nav.corner(agent, 0, 0, 0, 5, 0, 5, 0.35, 99) === null, 'and letting the world go leaves nothing behind');
}

// ---- a body that has stopped getting anywhere asks again ---------------------------------------
// The grid is a two-metre picture taken at conversion and the world the body walks in is not: a
// placement whose model the pack has not got, geometry too thin to rasterise, anything the engine
// disagrees with. A body leaning on one of those reaches no corner, so its corner list never runs
// out, and with a goal standing still `NavAgent.wants` has no rule that would ever ask again -- it
// would push at that corner for the rest of the evening. Nothing else in the game can see this: the
// body's own stuck check side-steps, which is a different job from asking the grid a new question.
{
  const nx = 120;
  const nz = 40;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) line += i === 60 && j !== 35 ? '#' : '.';
    rows.push(line);
  }
  const w = draw(rows);
  const nav = new OutdoorNav();
  const agent = new NavAgent();
  nav.adopt('drawn', w.header, w.bytes);
  const from = at(5, 5);
  const to = at(110, 5);
  // Stand still, never reaching a corner, and let the clock run.
  let last: { x: number; z: number } | null = null;
  for (let now = 1; now <= 4; now++) last = nav.corner(agent, from[0], 0, from[1], to[0], 0, to[1], 0.35, now);
  ok(last !== null && nav.status().unstuck === 0, 'three seconds of standing still is not yet stuck');
  last = nav.corner(agent, from[0], 0, from[1], to[0], 0, to[1], 0.35, 5);
  ok(nav.status().unstuck === 1, 'but a body that has covered no ground for `stuck` seconds throws its corners away');
  ok(nav.status().asked === 2 && last !== null, 'and asks for a fresh route there and then, rather than in `retry` seconds');

  // A body that is getting somewhere is left alone, however long it walks.
  const nav2 = new OutdoorNav();
  const agent2 = new NavAgent();
  nav2.adopt('drawn', w.header, w.bytes);
  let x = from[0];
  for (let now = 1; now <= 30; now++) {
    nav2.corner(agent2, x, 0, from[1], to[0], 0, to[1], 0.35, now);
    x += 3;
  }
  ok(nav2.status().unstuck === 0, 'a body making headway is never unstuck, however long the walk');

  // And the watch is a knob like everything else.
  const nav3 = new OutdoorNav();
  const agent3 = new NavAgent();
  nav3.adopt('drawn', w.header, w.bytes);
  nav3.set({ stuck: 0 } as never);
  for (let now = 1; now <= 30; now++) nav3.corner(agent3, from[0], 0, from[1], to[0], 0, to[1], 0.35, now);
  ok(nav3.status().unstuck === 0 && nav3.status().agent.stuck === 0, 'with the watch turned off the body holds its corners for ever, which is what it did before');
}

// ---- 'the line is clear' is not a failure -------------------------------------------------------
// A failed agent is held for `retry` and stops watching its goal while it waits. 'straight' means
// there was nothing to add, not that a search came to nothing: recorded as a failure, a thirty-metre
// chase whose quarry then ran three hundred metres would stand still for five seconds before asking
// for its first route.
{
  const nx = 120;
  const nz = 40;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) rows.push('.'.repeat(nx));
  const w = draw(rows);
  const nav = new OutdoorNav();
  const agent = new NavAgent();
  nav.adopt('drawn', w.header, w.bytes);
  const here = at(5, 20);
  ok(nav.corner(agent, here[0], 0, here[1], ...[at(15, 20)[0], 0, at(15, 20)[1]] as [number, number, number], 0.35, 1) === null, 'a goal twenty metres off is answered with nothing to add');
  ok(nav.status().straight === 1 && !agent.failed, 'and the body is not set back as though a search had failed');
  const far = at(115, 20);
  nav.corner(agent, here[0], 0, here[1], far[0], 0, far[1], 0.35, 2.5);
  ok(nav.status().asked === 2, 'so a goal that walks away is planned for at the next `every`, not in `retry` seconds');
}

// ---- the bake's own rules, apart from the rasteriser --------------------------------------------
// Both of these decide something no census would notice afterwards. A manifest whose entries carry
// no `cells` bakes with not one indoor cell: every building's inside is open ground and a string
// pull walks a body through a cantina, with nothing saying so. That is why the bake counts what
// this answered and warns, and `status` says it again off nav.json's own numbers.
{
  ok(isBuildingDef({ cells: [{}, {}] }) === true, 'an entry with cells is a portal building');
  ok(isBuildingDef({ cells: [] }) === false && isBuildingDef({}) === false && isBuildingDef(null) === false, 'and one with none, or none at all, is not');
  ok(indoorFootprint(10, 10) && indoorFootprint(10 - INDOOR_BELOW, 10) && indoorFootprint(10 + INDOOR_ABOVE, 10), 'a room near the ground is its building\'s footprint');
  ok(!indoorFootprint(10 - INDOOR_BELOW - 0.01, 10), 'a dungeon room under the desert is not a footprint on it');
  ok(!indoorFootprint(10 + INDOOR_ABOVE + 0.01, 10), 'and an upper storey is not one either: the ground floor covers the same ground');
}

// ---- the converter's GLB reader ------------------------------------------------------------------
{
  // A GLB with two triangles under two nodes, one of them a portal cell, built here byte for byte.
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 5, 2, 5, 6, 2, 5, 5, 2, 6]);
  const bin = Buffer.from(positions.buffer);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'cell:0:shell', mesh: 0 },
      { name: 'cell:3:room', mesh: 1, translation: [10, 0, 0] },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 } }] },
      { primitives: [{ attributes: { POSITION: 1 } }] },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const jsonChunk = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.concat([jsonChunk, Buffer.alloc((4 - (jsonChunk.length % 4)) % 4, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsonPad.length + 8 + binPad.length, 8);
  const j = Buffer.alloc(8);
  j.writeUInt32LE(jsonPad.length, 0);
  j.writeUInt32LE(0x4e4f534a, 4);
  const b = Buffer.alloc(8);
  b.writeUInt32LE(binPad.length, 0);
  b.writeUInt32LE(0x004e4942, 4);
  // In a temp folder and not beside this file: a test must not leave anything in the tree, and a
  // run cut short halfway must not either.
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = join(tmpdir(), `outdoorNav-${process.pid}.glb`);
  const { writeFileSync, rmSync } = await import('node:fs');
  writeFileSync(file, Buffer.concat([head, j, jsonPad, b, binPad]));
  try {
    const tri = readGlbTriangles(file) as { positions: Float32Array; cells: Int32Array };
    ok(tri.cells.length === 2, 'the reader finds both triangles');
    ok(tri.cells[0] === 0 && tri.cells[1] === 3, "and reads each one's portal cell from the node it hangs under");
    ok(Math.abs(tri.positions[9] - 15) < 1e-5, "and puts the second one where its node's own translation puts it");
  } finally {
    rmSync(file, { force: true });
  }
}

// ---- the tune is one table --------------------------------------------------------------------
{
  const t: OutdoorTune = OUTDOOR_TUNE;
  ok(t.straight > 0 && t.horizon > t.straight, 'a plan looks further ahead than the plain sight test does');
  ok(t.corridorAgain > t.corridor, 'and the second try at a corridor is wider than the first');
  ok(t.pullCap > 0 && t.perStep >= 1, 'the string-pull has a cap and a step has a budget');
  // A budget in expansions is this machine's arithmetic; the clock is the promise a frame needs.
  ok(t.planMs > 0, 'a plan has a budget in milliseconds and not only in cells opened');
  // The corridor holds at most `maxSlots` x `coarse`^2 fine cells (2,048 x 64 = 131,072), so a
  // fine budget above that could never bind on anything and would be a knob that does nothing.
  ok(t.fineExpand < 2048 * COARSE * COARSE, 'and the fine budget is under the corridor\'s own ceiling, so it can really bind');
  // The longest route the largest world really holds opened 22,518 coarse cells in 6.7 ms. A budget
  // far above that is not caution: it is how long a search that is not going to answer runs for.
  ok(t.coarseExpand >= 25000 && t.coarseExpand <= 60000, `the coarse budget (${t.coarseExpand}) covers the longest real route with room to spare and not a great deal more`);
  ok(t.componentCap > 0, 'and the goal-side flood has a budget of its own');
}

console.log(`\n${checks} checks passed`);
