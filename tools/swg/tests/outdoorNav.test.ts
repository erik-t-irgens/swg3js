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
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLEARANCE_MAX,
  COARSE,
  GOAL_SNAP,
  INDOOR,
  INDOOR_ABOVE,
  INDOOR_BELOW,
  INDOOR_RISE,
  EDGE,
  NAV_BAKE_RULES,
  NAV_FLAGS,
  NAV_GRID_VERSION,
  OTHER_REGION,
  SAMPLES_PER_CELL,
  RANKS,
  SLOPE_CLIMB_DEGREES,
  TOWN_LOOK,
  TOWN_RING,
  AGENT_RADIUS,
  IDENTITY_FRAME,
  bakeRules,
  clearanceNibbles,
  edgesNear,
  growMargin,
  indoorFootprint,
  isBuildingDef,
  isFootprint,
  packGrid,
  placementFrame,
  rasterPlacement,
  readGlbTriangles,
  townStanding,
} from '../navgrid.mjs';
import {
  GRID_SIDE_MARGIN,
  NAV_GRID_VERSION as RUNTIME_VERSION,
  NAV_INDOOR,
  NAV_OTHER,
  NAV_RANKS,
  OUTDOOR_TUNE,
  OutdoorWork,
  berthAt,
  berthOf,
  berthPenalty,
  cellOf,
  cellX,
  cellZ,
  clearAt,
  coarseJoins,
  coarseSearch,
  decodeGrid,
  gridMargin,
  isIndoor,
  isOpen,
  legInset,
  lineClear,
  lineClearance,
  lineThick,
  nearestOpen,
  nibbleAt,
  planRoute,
  regionAt,
  stringPull,
  unwindCoarse,
  type OutdoorGrid,
  type OutdoorHeader,
  type OutdoorTune,
} from '../../../src/world/nav/outdoorGrid.ts';
import { MOBILE_CLIMB_DEGREES, MOBILE_GRID_ACROSS, OutdoorNav } from '../../../src/world/nav/outdoorNav.ts';
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
  const p = packGrid(nx, nz, solid, flags, 1, coarseStep, undefined, CLEARANCE_MAX) as {
    nibbles: Uint8Array;
    coarse: Uint8Array;
    edges: Uint8Array;
    clear: Uint8Array;
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
    clearBytes: p.clear.length,
    clearMax: CLEARANCE_MAX,
  };
  const bytes = new Uint8Array(p.nibbles.length + p.coarse.length + p.edges.length + p.clear.length);
  bytes.set(p.nibbles, 0);
  bytes.set(p.coarse, p.nibbles.length);
  bytes.set(p.edges, p.nibbles.length + p.coarse.length);
  bytes.set(p.clear, p.nibbles.length + p.coarse.length + p.edges.length);
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

// ---- the berth ----------------------------------------------------------------------------------
// A cell near something a body cannot walk on costs the fine search more than a cell in the open,
// so a route stands off a mountain or a wall instead of scraping it. Everything about it is
// invented, so what is pinned here is the two things it must never do -- reach past its own berth,
// and close a way through -- and the one thing the owner asked for, which is that a route along a
// long face really does move off it.

/** The least room, in cells, the walked route keeps: every leg of the pull measured end to end. */
function roomAlong(w: Drawn, from: [number, number]): number {
  let px = from[0];
  let pz = from[1];
  let worst = Infinity;
  for (let i = 0; i < w.work.pulledCount; i++) {
    const r = lineClearance(w.grid, px, pz, w.work.pulled[i * 2], w.work.pulled[i * 2 + 1]);
    if (r < worst) worst = r;
    px = w.work.pulled[i * 2];
    pz = w.work.pulled[i * 2 + 1];
  }
  return worst;
}

/** The tune with the berth switched off entirely: the search exactly as it was before there was one. */
const NO_BERTH: OutdoorTune = { ...OUTDOOR_TUNE, berthCost: 0, berthPull: 0 };

{
  // The clearance plane itself, on a world with one blocked cell in the middle of it. The chamfer is
  // checked cell by cell rather than by eye, because everything else here rests on it.
  const nx = 32;
  const nz = 32;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) line += i === 16 && j === 16 ? '#' : '.';
    rows.push(line);
  }
  const w = draw(rows);
  const cell = (i: number, j: number): number => clearAt(w.grid, j * nx + i);
  ok(cell(16, 16) === 0, 'a cell nothing may stand on has no clearance at all');
  ok(cell(17, 16) === 1 && cell(16, 17) === 1, 'its neighbours stand one cell off it');
  ok(cell(17, 17) === 1, 'and so does the one on the diagonal, which is 1.41 cells away and rounds to one');
  ok(cell(18, 16) === 2 && cell(19, 16) === 3, 'the next cells out are two and three');
  ok(cell(16, 0) === 1 && cell(0, 16) === 1, 'the edge of the world counts as something too, so the rim keeps no room');
  ok(cell(8, 8) === CLEARANCE_MAX, `and open ground reads the cap (${CLEARANCE_MAX} cells), which is what makes the plane compress`);
  // The chamfer is its own function and is driven directly, since the bake calls it over sixty-seven
  // million cells and a mistake in it is silent everywhere.
  const bare = clearanceNibbles(8, 8, () => true, 3) as Uint8Array;
  ok((bare[0] & 0x0f) === 1, 'a world with nothing in it still has a rim');
  ok(((bare[(3 * 8 + 3) >> 1] >> (((3 * 8 + 3) & 1) * 4)) & 0x0f) === 3, 'and its middle reads the cap it was given');
}

{
  // A long face with open ground under it. The straight run along it scrapes the wall; the berth is
  // what makes the route step off it and run parallel a few metres out, which is the whole of what
  // the owner asked for.
  const nx = 120;
  const nz = 40;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) line += j <= 20 && i >= 20 && i <= 100 ? '#' : '.';
    rows.push(line);
  }
  const w = draw(rows);
  const from = at(5, 22);
  const to = at(115, 22);

  ok(planRoute(w.grid, w.work, ...from, ...to, NO_BERTH) === 'found', 'with the berth off, a run along a long face is found');
  const hugged = roomAlong(w, from);
  const huggedOpened = w.work.fineOpened;
  const huggedCorners = w.work.pulledCount;

  ok(planRoute(w.grid, w.work, ...from, ...to) === 'found', 'and with it on it is found too');
  const wide = roomAlong(w, from);
  ok(wide > hugged, `the route stands ${wide} cells off the face where before it kept ${hugged}`);
  ok(wide * CELL >= OUTDOOR_TUNE.berthPull, `and it keeps at least the ${OUTDOOR_TUNE.berthPull} m the string-pull asks of a leg`);
  ok(w.work.pulledCount <= huggedCorners + 4, `it costs ${w.work.pulledCount - huggedCorners} more corners, not a list of them`);
  ok(w.work.fineOpened < huggedOpened * 4, `and ${w.work.fineOpened} fine cells against ${huggedOpened}: a berth is searched for, not searched around`);
}

{
  // Open country is not touched at all. Every cell along this corridor is further from anything than
  // the berth reaches, so the term is exactly nought and the search opens the very cells it did
  // before there were berths -- which is the promise that the commonest case pays nothing.
  const nx = 120;
  const nz = 40;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) rows.push('.'.repeat(nx));
  const w = draw(rows);
  const from = at(5, 20);
  const to = at(115, 20);
  planRoute(w.grid, w.work, ...from, ...to, NO_BERTH);
  const plainOpened = w.work.fineOpened;
  const plainCorners = w.work.pulledCount;
  const plainFirst = w.work.pulled[0];
  planRoute(w.grid, w.work, ...from, ...to);
  ok(w.work.fineOpened === plainOpened, `open ground opens the same ${plainOpened} fine cells either way`);
  ok(w.work.pulledCount === plainCorners && w.work.pulled[0] === plainFirst, 'and hands back the very same corners');
}

{
  // The one thing a berth must never do. A wall five cells thick with a single open cell through it:
  // the way through is one cell wide, so every step of it is as dear as a step can be, and it is
  // still the route -- because the surcharge is added and bounded, and no finite surcharge can beat
  // a way round that does not exist.
  const nx = 120;
  const nz = 40;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) line += i >= 58 && i <= 62 && j !== 20 ? '#' : '.';
    rows.push(line);
  }
  const w = draw(rows);
  const from = at(5, 20);
  const to = at(115, 20);
  const out = planRoute(w.grid, w.work, ...from, ...to);
  ok(out === 'found', `a gap one cell wide that is the only way through answers '${out}' with the berth on`);
  let through = false;
  for (let i = 0; i < w.work.rawCount; i++) {
    if (Math.abs(w.work.raw[i * 2] - at(60, 20)[0]) < CELL && Math.abs(w.work.raw[i * 2 + 1] - at(60, 20)[1]) < CELL) through = true;
  }
  ok(through, 'and the path really goes through it rather than somewhere the grid does not have');
  ok(clearAt(w.grid, 20 * nx + 60) === 1, 'even though every cell of it keeps one cell of room, which is the dearest ground there is');
}

{
  // The curve itself, swept. It is the whole of the invented part, so what it may not do is pinned
  // here rather than inferred from a route.
  const cellM = 2;
  const maxCells = CLEARANCE_MAX;
  const reach = OUTDOOR_TUNE.berth / cellM;
  ok(Math.abs(berthPenalty(0, cellM, maxCells) - OUTDOOR_TUNE.berthCost) < 1e-9, `nought room costs the full ${OUTDOOR_TUNE.berthCost} share`);
  ok(berthPenalty(reach, cellM, maxCells) === 0 && berthPenalty(reach + 3, cellM, maxCells) === 0, 'at the berth and past it the term is exactly nought, not merely small');
  let falling = true;
  let last = Infinity;
  for (let c = 0; c <= reach; c += 0.25) {
    const p = berthPenalty(c, cellM, maxCells);
    if (p > last + 1e-12) falling = false;
    last = p;
  }
  ok(falling, 'and it only ever falls as the room grows');
  // The relation that is not arbitrary, and the reason the ramp is straight. The fine search is a
  // weighted A*: it buys its speed by accepting any route within `fineWeight` of the cheapest, so a
  // surcharge moves a route only as far out as its own slope beats that greed. Below this the berth
  // is arithmetic that changes no route at all, which is exactly what a square at 1.5 did.
  const slope = (berthPenalty(0, cellM, maxCells) - berthPenalty(1, cellM, maxCells)) / 1;
  ok(slope > OUTDOOR_TUNE.fineWeight - 1, `a cell of room is worth ${slope.toFixed(2)} against the search's own greed of ${(OUTDOOR_TUNE.fineWeight - 1).toFixed(2)}, so the berth really reaches`);
  ok(OUTDOOR_TUNE.berthCurve === 1, 'which is what a straight ramp gives and a square does not: its slope dies where the greed does');
  ok(berthPenalty(0, cellM, maxCells, { ...OUTDOOR_TUNE, berthCost: 0 }) === 0, 'a `berthCost` of nought is the search with no berth in it at all');
  ok(berthPenalty(2, cellM, maxCells, { ...OUTDOOR_TUNE, berthCurve: 2 }) < berthPenalty(2, cellM, maxCells), 'and a square is the gentler of the two shapes everywhere between');
  // A berth raised past what the bake counted cannot reach further, because every cell out there
  // carries the same number; the curve is clamped to that rather than flattening over a lie.
  const greedy: OutdoorTune = { ...OUTDOOR_TUNE, berth: (maxCells + 6) * cellM };
  ok(berthPenalty(maxCells, cellM, maxCells, greedy) === 0, 'and one raised past the cap the bake stored still reaches exactly the cap');
  // The curve swept above is worth nothing if the search runs its own copy of it, which is what it
  // did: four lines inlined in `corridorSearch` and four here, agreeing today and free to drift.
  // They are one function now, and this is what says so -- `berthPenalty` **is** what the search
  // adds to a step, hoisted, so a sweep of it is a sweep of the search.
  let worst = 0;
  for (const t of [OUTDOOR_TUNE, { ...OUTDOOR_TUNE, berthCurve: 2 }, { ...OUTDOOR_TUNE, berthCost: 1.5 }, { ...OUTDOOR_TUNE, berthCost: 0 }, { ...OUTDOOR_TUNE, berth: 0 }, greedy]) {
    const b = berthOf(cellM, maxCells, t as OutdoorTune);
    for (let c = 0; c <= maxCells; c++) worst = Math.max(worst, Math.abs(berthAt(b, c) - berthPenalty(c, cellM, maxCells, t as OutdoorTune)));
  }
  ok(worst === 0, 'the hoisted form the search runs and the one-call form this sweeps are the same arithmetic, exactly');
  ok(berthOf(cellM, maxCells, { ...OUTDOOR_TUNE, berth: 0 }).share === 0, 'a berth of nought metres is switched off at the top of the search rather than tested per cell');
}

// ---- the named towns, which is the one thing only the bake can see ------------------------------
{
  // A world cut in two by a wall, with three towns on it: one out on the big half, one out on the
  // small half, and one on the small half hard against the wall. Each town's own centre stands in a
  // walled yard, which is the shape that matters here -- a town centre lands in one often enough
  // that measuring a town by the single cell its centre snaps to says nothing about the town at
  // all, and that is exactly how a rebake that cut two Corellian towns off their world came to be
  // reported as cutting none.
  //
  // The ring is the test's own 40 m rather than the shipped `TOWN_RING`, because the drawn world is
  // smaller than 120 m across; the shipped numbers are pinned as numbers below.
  const nx = 200;
  const nz = 60;
  const towns: [number, number][] = [[60, 30], [170, 30], [140, 30]];
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) {
      const wall = i >= 130 && i <= 134;
      // A 5x5 ring of wall with a 3x3 open yard inside it: the centre is open, and it is its own
      // little walkable region with nothing to do with the ground round the town.
      const yard = towns.some(([ti, tj]) => Math.max(Math.abs(i - ti), Math.abs(j - tj)) === 2);
      line += wall || yard ? '#' : '.';
    }
    rows.push(line);
  }
  const w = draw(rows);
  const nibble = (k: number): number => nibbleAt(w.grid, k);
  const ring = 20;
  const look = 200;
  type Standing = { region: number; share: number; open: number; rank1Cells: number };
  const big = townStanding(nibble, nx, nz, 60, 30, ring, look) as Standing;
  const far = townStanding(nibble, nx, nz, 170, 30, ring, look) as Standing;
  const near = townStanding(nibble, nx, nz, 140, 30, ring, look) as Standing;
  ok(big.region === 1 && big.rank1Cells * CELL <= GOAL_SNAP, 'the town out on the big half reads the largest walkable region, right under it');
  ok(far.region === 2, `the town out on the small half reads region ${far.region}, which is not the largest`);
  ok(far.rank1Cells * CELL > GOAL_SNAP, `and the largest region is ${(far.rank1Cells * CELL).toFixed(0)} m off, past the ${GOAL_SNAP} m a goal is pulled: every errand to it is answered 'unreachable'`);
  ok(near.region === 2 && near.rank1Cells * CELL <= GOAL_SNAP, `the town against the wall also stands on region ${near.region}, but the largest region is ${(near.rank1Cells * CELL).toFixed(0)} m off, so a route is still planned to its doorstep and the body steers the rest`);
  ok(big.share > 0.8 && far.share > 0.8 && near.share > 0.5, 'each answer is the ground round its town and not one cell of it');
  // And the reason it is measured that way rather than from the town's own point.
  const snapped = towns.map(([i, j]) => nibble(j * nx + i));
  ok(snapped.every((v) => v > 2), `each town centre itself snaps into its own walled yard (regions ${snapped.join(', ')}), so one point would have called all three of them apart and said nothing about any of them`);
  ok(GOAL_SNAP === OUTDOOR_TUNE.goalSnap, `the bake's idea of how far a goal is pulled (${GOAL_SNAP} m) is the game's own \`goalSnap\``);
  ok(TOWN_RING > 0 && TOWN_LOOK > TOWN_RING, `and the shipped ring (${TOWN_RING} m) is inside the shipped look (${TOWN_LOOK} m)`);

  // The distance it reports is a distance and the rings it walks are square, so the first ring
  // holding a rank-1 cell is not the answer: that cell can sit in the ring's corner at r * sqrt(2)
  // while a nearer one sits in the middle of an edge three rings further out. Here the corner cell
  // is met at ring 10 and 14.14 cells away, and the true nearest is at ring 13 and 13.00. A reading
  // that stopped at the first ring would report the number 9% over, and the number goes into a
  // warning the owner is meant to compare between two bakes.
  const sparse = (k: number): number => (k === 30 * 41 + 30 || k === 20 * 41 + 33 ? 1 : 2);
  const corner = townStanding(sparse, 41, 41, 20, 20, 5, 30) as Standing;
  ok(Math.abs(corner.rank1Cells - 13) < 1e-9, `the nearest rank-1 cell is reported at ${corner.rank1Cells.toFixed(2)} cells, not the ${Math.hypot(10, 10).toFixed(2)} of the first ring that held one`);
  ok(corner.region === 2, 'and the town still reads the ground it is standing on');
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

// ---- a short plan the plane refuses is searched on the fine cells ---------------------------------
// The same shape at a town's scale: two yards joined by a gap two cells wide in a wall, so near each
// other that a body is sent from one to the other every few seconds by a patrol's round. The plane
// offers neither the gap's coarse cell nor, here, the second yard's, so the coarse answer is
// 'unjoined'; the fine cells hold the way through, and a plan this short searches them directly.
{
  const nx = 40;
  const nz = 24;
  const rows: string[] = [];
  for (let j = 0; j < nz; j++) {
    let line = '';
    for (let i = 0; i < nx; i++) {
      const wall = i >= 16 && i < 24 && !(j === 11 || j === 12);
      const shutB = i >= 24 && (j < 8 || j >= 16);
      line += wall || shutB ? '#' : '.';
    }
    rows.push(line);
  }
  const w = draw(rows);
  const off: OutdoorTune = { ...OUTDOOR_TUNE, nearFine: 0, planMs: 0 };
  const on: OutdoorTune = { ...OUTDOOR_TUNE, planMs: 0 };
  const plain = planRoute(w.grid, w.work, ...at(4, 4), ...at(34, 12), off);
  w.work.forget();
  const fine = planRoute(w.grid, w.work, ...at(4, 4), ...at(34, 12), on);
  ok(plain !== 'found' && plain !== 'straight', `without it the plane cannot join two yards ${Math.round(Math.hypot(30, 8) * CELL)} m apart (${plain})`);
  ok(fine === 'found' && w.work.nearFound === 1 && w.work.pulledCount > 0, `with it the same short plan is found on the fine cells (${fine})`);
  let through = false;
  for (let n = 0; n < w.work.pulledCount; n++) {
    const x = w.work.pulled[n * 2] / CELL;
    const z = w.work.pulled[n * 2 + 1] / CELL;
    if (x >= 15 && x <= 25 && z >= 10 && z <= 14) through = true;
  }
  ok(through, '... and its corners go through the gap in the wall');
  ok(planRoute(w.grid, w.work, ...at(4, 4), ...at(34, 12), on) === 'found' && w.work.remembered > 0, 'asked again, the refusal ring sends it straight to the fine cells');
  const far = { ...on, nearFine: 10 };
  w.work.forget();
  ok(planRoute(w.grid, w.work, ...at(4, 4), ...at(34, 12), far) === plain, 'a plan longer than `nearFine` answers what the plane says, as it always did');
}

// And a coarse search that runs out of its budget before it answers is no more reason than a refusal
// for a plan this short to go without: the fine cells are searched the same way. A wall with its way
// round below it, and a coarse search allowed no expansions at all, which is a spent budget on demand.
{
  const rows: string[] = [];
  for (let j = 0; j < 24; j++) {
    let line = '';
    for (let i = 0; i < 24; i++) line += i === 12 && j < 16 ? '#' : '.';
    rows.push(line);
  }
  const w = draw(rows);
  const spend: OutdoorTune = { ...OUTDOOR_TUNE, planMs: 0, coarseExpand: 0 };
  ok(planRoute(w.grid, w.work, ...at(4, 4), ...at(20, 4), { ...spend, nearFine: 0 }) === 'spent', 'a coarse search with no budget left says so, with the fine search off');
  w.work.forget();
  const before = w.work.nearFound;
  const fine = planRoute(w.grid, w.work, ...at(4, 4), ...at(20, 4), spend);
  let under = false;
  for (let n = 0; n < w.work.pulledCount; n++) if (w.work.pulled[n * 2 + 1] / CELL >= 16) under = true;
  ok(fine === 'found' && w.work.nearFound === before + 1 && under, `with it on, the same short plan is found on the fine cells, round the end of the wall (${fine})`);
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

  // The knob. Its tables are the module's own, so what it moves is put back from a copy taken first:
  // put back from `OUTDOOR_TUNE` itself, it would put back the number it had just moved, and every
  // search after this block would run on a 123 m horizon.
  const horizonWas = OUTDOOR_TUNE.horizon;
  const reachWas = nav.status().agent.reach;
  const moved = nav.set({ horizon: 123, reach: 9, notANumber: Number.NaN } as never);
  ok(moved.tune.horizon === 123 && moved.agent.reach === 9, 'the knob moves a number on either table');
  const back = nav.set({ horizon: horizonWas, reach: reachWas } as never);
  ok(back.tune.horizon === horizonWas && horizonWas !== 123 && back.agent.reach === reachWas, 'and moves it back');

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

// ---- a wide body's legs keep its own width ------------------------------------------------------
// On a grid grown by the side an object's geometry can stand the player's half-width off the side of
// the open cell beside it and no more, and a string-pulled leg may run right along that side. So a body
// wider than that is handed only legs that keep the rest of its width off every cell not open
// (`legInset`, `lineThick`), and the path's own steps where none does.
{
  // One blocked cell, and a line from the middle of (0, 1) to the middle of (8, 2) that passes 0.12 m
  // under its corner: a line the plain sight test takes, and a wide body would scrape.
  const w = draw([
    '..........',
    '..........',
    '...#......',
    '..........',
    '..........',
  ]);
  const g2: OutdoorGrid = { ...w.grid, header: { ...w.grid.header, rules: 2 } };
  const g1: OutdoorGrid = { ...w.grid, header: { ...w.grid.header } };
  ok(GRID_SIDE_MARGIN === AGENT_RADIUS, `the room the runtime reads a side-grown grid as keeping is the bake's own half-width, ${AGENT_RADIUS} m`);
  ok(gridMargin(g2.header) === AGENT_RADIUS && gridMargin(g1.header) === CELL, '... and a grid grown a whole cell, or saying nothing, keeps a whole cell');
  ok(Math.abs(legInset(g2.header, 0.38) - 0.03) < 1e-9 && Math.abs(legInset(g2.header, 1) - 0.65) < 1e-9 && legInset(g2.header, 0.3) === 0, 'a person 0.38 m round is kept 0.03 m more off, a body a metre round 0.65, and one inside the half-width nothing');
  ok(legInset(g1.header, 1) === 0 && legInset(g2.header, 5) === 0.45 * CELL, '... on a grid grown a whole cell nothing more for anything a grid route is handed to, and never more than 0.45 of a cell');
  ok(lineClear(g2, ...at(0, 1), ...at(8, 2)) && lineThick(g2, ...at(0, 1), ...at(8, 2), 0), 'the line under the corner is clear, and clear with no width');
  ok(lineThick(g2, ...at(0, 1), ...at(8, 2), 0.1) && !lineThick(g2, ...at(0, 1), ...at(8, 2), 0.2), '... and clear for 0.1 m either side of it but not 0.2, since it passes 0.12 m from the cell');
  ok(!lineThick(g2, ...at(0, 1), ...at(8, 2), 0.65), '... so it is no leg for a body a metre round');
  // A path that bends round that corner, cell by cell, and the pull over it.
  const raw = new Float64Array(64);
  const path: [number, number][] = [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 2], [7, 2], [8, 2]];
  path.forEach(([i, j], n) => {
    raw[n * 2] = at(i, j)[0];
    raw[n * 2 + 1] = at(i, j)[1];
  });
  const out = new Float64Array(64);
  const legs = (count: number): [number, number, number, number][] => {
    const list: [number, number, number, number][] = [];
    let ax = raw[0];
    let az = raw[1];
    for (let n = 0; n < count; n++) {
      list.push([ax, az, out[n * 2], out[n * 2 + 1]]);
      ax = out[n * 2];
      az = out[n * 2 + 1];
    }
    return list;
  };
  const thin = legs(stringPull(g2, raw, path.length, out, NO_BERTH, 0));
  ok(thin.length === 1 && !lineThick(g2, ...thin[0], 0.65), `with no width the pull takes the one straight leg, which passes under the corner (${thin.length} leg)`);
  const wide = legs(stringPull(g2, raw, path.length, out, NO_BERTH, 0.65));
  const step = (l: [number, number, number, number]): boolean => Math.hypot(l[2] - l[0], l[3] - l[1]) <= CELL * Math.SQRT2 + 1e-9;
  ok(wide.length > 1 && wide.every((l) => lineThick(g2, ...l, 0.65) || step(l)), `with a metre's width every leg keeps 0.65 m off the corner, or is one of the path's own steps (${wide.length} legs)`);
  ok(Math.hypot(wide[wide.length - 1][2] - at(8, 2)[0], wide[wide.length - 1][3] - at(8, 2)[1]) < 1e-9, '... and it still ends where the path does');
  // A whole plan: two hundred metres through a one-cell gap in a wall. Every leg a wide body is handed
  // keeps its width off the gap's sides or is one of the path's own steps, and it needs more corners
  // for it; and the game's side hands the body's own width to the plan.
  const rows: string[] = [];
  for (let j = 0; j < 40; j++) {
    let line = '';
    for (let i = 0; i < 120; i++) line += i === 60 && j !== 35 ? '#' : '.';
    rows.push(line);
  }
  const gap = draw(rows);
  const gapHeader = { ...gap.header, rules: 2 };
  const gapGrid: OutdoorGrid = { ...gap.grid, header: gapHeader };
  const legsOf = (work: OutdoorWork, from: [number, number]): [number, number, number, number][] => {
    const list: [number, number, number, number][] = [];
    let ax = from[0];
    let az = from[1];
    for (let n = 0; n < work.pulledCount; n++) {
      list.push([ax, az, work.pulled[n * 2], work.pulled[n * 2 + 1]]);
      ax = work.pulled[n * 2];
      az = work.pulled[n * 2 + 1];
    }
    return list;
  };
  const from = at(5, 5);
  const to = at(110, 5);
  const workNarrow = new OutdoorWork(gapHeader, 4096);
  ok(planRoute(gapGrid, workNarrow, ...from, ...to, OUTDOOR_TUNE, 0) === 'found', 'a route through the gap is found with no width');
  const narrowLegs = legsOf(workNarrow, from);
  const workBroad = new OutdoorWork(gapHeader, 4096);
  ok(planRoute(gapGrid, workBroad, ...from, ...to, OUTDOOR_TUNE, legInset(gapHeader, 1)) === 'found', '... and with a metre\'s width');
  const broadLegs = legsOf(workBroad, from);
  ok(narrowLegs.some((l) => !lineThick(gapGrid, ...l, 0.65)), `with no width a leg is handed that runs through the gap closer than a body a metre round fits (${narrowLegs.length} corners)`);
  ok(broadLegs.every((l) => lineThick(gapGrid, ...l, 0.65) || step(l)) && broadLegs.length > narrowLegs.length, `with a metre's width every leg keeps 0.65 m off the gap's sides or is one of the path's own steps, for ${broadLegs.length} corners`);
  const handed = (radius: number): number => {
    const n = new OutdoorNav();
    n.adopt('drawn', gapHeader, gap.bytes);
    n.corner(new NavAgent(), from[0], 0, from[1], to[0], 0, to[1], radius, 1);
    return n.status().lastCorners;
  };
  ok(handed(1) === broadLegs.length && handed(0.35) === narrowLegs.length, `\`OutdoorNav.corner\` plans at the body's own width: ${handed(1)} corners for a body a metre round, ${handed(0.35)} for one the player's size`);
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

  // The rise (`INDOOR_RISE`), with Fort Tusken's own numbers: the ninth room's ceiling is 2.45 m under
  // the courtyard and the eleventh's 1.28, both inside the band, and nothing of the fort rises over
  // the courtyard there.
  ok(!isFootprint(true, -2.45) && !isFootprint(true, -1.28), 'ground over a cellar whose ceiling is under it is not a footprint, however near the band calls it');
  ok(isFootprint(true, 4.0) && isFootprint(true, 8.0), 'a room with walls or a ceiling over the ground is one, and so is a tall hall whose ceiling is past the band');
  ok(!isFootprint(true, INDOOR_RISE) && isFootprint(true, INDOOR_RISE + 0.01), `the line is the autostep, ${INDOOR_RISE} m: what rises no higher than a body walks over is walked over`);
  ok(!isFootprint(false, 8.0), 'and nothing is a footprint where no room comes near the ground at all, which is the band\'s own rule unchanged');
}

// ---- the margin, by the side ---------------------------------------------------------------------
// `growMargin` over worlds drawn by hand, with the converter's own flag bits: the slope and water grow
// by the whole margin as they always did, an object's cell only across the sides its geometry hugs, and
// `byEdge` false is the whole-cell margin exactly.
{
  const nx = 7;
  const nz = 5;
  const at = (i: number, j: number) => j * nx + i;
  const grown = (solid: Uint8Array): string[] => {
    const rows: string[] = [];
    for (let j = 0; j < nz; j++) {
      let r = '';
      for (let i = 0; i < nx; i++) r += solid[at(i, j)] ? '#' : '.';
      rows.push(r);
    }
    return rows;
  };
  // A post in the middle of its cell, clear of every side.
  const flags = new Uint8Array(nx * nz);
  const near = new Uint8Array(nx * nz);
  flags[at(3, 2)] = NAV_FLAGS.object;
  near[at(3, 2)] = edgesNear(0.5, 0.5, 0.35 / CELL);
  ok(grown(growMargin(nx, nz, flags, near, 1)).join('|') === '.......|.......|...#...|.......|.......', 'an object in the middle of its cell blocks that cell and nothing round it');
  ok(grown(growMargin(nx, nz, flags, near, 1, false)).join('|') === '.......|...#...|..###..|...#...|.......', '... where the whole-cell margin blocked a plus ten metres across');
  // A wall standing along the east side of its cell.
  near[at(3, 2)] = edgesNear(0.95, 0.5, 0.35 / CELL);
  ok(near[at(3, 2)] === EDGE.east, 'geometry within a body\'s half-width of a side hugs that side and no other');
  ok(grown(growMargin(nx, nz, flags, near, 1)).join('|') === '.......|.......|...##..|.......|.......', '... and grows across it alone');
  // A corner.
  near[at(3, 2)] = edgesNear(0.05, 0.05, 0.35 / CELL);
  ok(near[at(3, 2)] === (EDGE.west | EDGE.north), 'geometry in a corner hugs both its sides');
  // The ground's own reasons grow whole, as they always did.
  const steep = new Uint8Array(nx * nz);
  steep[at(3, 2)] = NAV_FLAGS.slope;
  ok(grown(growMargin(nx, nz, steep, new Uint8Array(nx * nz), 1)).join('|') === '.......|...#...|..###..|...#...|.......', 'a cell too steep grows by the whole margin');
  const wet = new Uint8Array(nx * nz);
  wet[at(3, 2)] = NAV_FLAGS.water | NAV_FLAGS.object;
  ok(grown(growMargin(nx, nz, wet, new Uint8Array(nx * nz), 1)).join('|') === '.......|...#...|..###..|...#...|.......', '... and so does one too deep, whatever stands in it');
  // A lane between two walls: the wall cells a lane apart, each wall hugging the lane's side. The lane
  // is one cell, a cell's width plus the two half-widths clear, and it stays open.
  const lane = new Uint8Array(nx * nz);
  const laneNear = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    lane[at(2, j)] = NAV_FLAGS.object;
    laneNear[at(2, j)] = edgesNear(0.5, 0.5, 0.35 / CELL);
    lane[at(4, j)] = NAV_FLAGS.object;
    laneNear[at(4, j)] = edgesNear(0.5, 0.5, 0.35 / CELL);
  }
  ok(grown(growMargin(nx, nz, lane, laneNear, 1)).every((r) => r === '..#.#..'), 'a lane between two walls standing clear of it stays a lane');
  ok(grown(growMargin(nx, nz, lane, laneNear, 1, false)).every((r) => r === '.#####.'), '... which the whole-cell margin closed');
  for (let j = 0; j < nz; j++) laneNear[at(4, j)] = edgesNear(0.1, 0.5, 0.35 / CELL);
  ok(grown(growMargin(nx, nz, lane, laneNear, 1)).every((r) => r === '..###..'), 'and a wall hugging the lane closes it, since a body in it would be inside the half-width');
  // The property the rebake rests on: grown by the side, the margin never blocks a cell the whole-cell
  // margin left open, so a grid of `rules: 2` can only have gained ground. Tried over worlds scattered
  // at random with every reason and every side a cell can hug.
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  let subset = true;
  let fewer = 0;
  for (let n = 0; n < 200; n++) {
    const W = 12;
    const H = 9;
    const f = new Uint8Array(W * H);
    const e = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) {
      const r = rnd();
      f[k] = r < 0.08 ? NAV_FLAGS.slope : r < 0.12 ? NAV_FLAGS.water : r < 0.35 ? NAV_FLAGS.object : 0;
      e[k] = Math.floor(rnd() * 16);
    }
    const bySide = growMargin(W, H, f, e, 1);
    const whole = growMargin(W, H, f, e, 1, false);
    for (let k = 0; k < W * H; k++) {
      if (bySide[k] && !whole[k]) subset = false;
      if (whole[k] && !bySide[k]) fewer++;
    }
  }
  ok(subset && fewer > 0, `the margin by the side blocks only cells the whole-cell margin blocked, and fewer of them (${fewer} cells opened over 200 drawn worlds)`);
  // The sampling is the other half of that property, and only half: the same samples find the same
  // object cells, so the margin can only open ground and the rise can only take footprints away. The
  // whole of it -- no cell a body could walk on under the older rules is closed under these -- is
  // shown on drawn buildings baked both ways below.
  ok(SAMPLES_PER_CELL === 2, 'and the bake samples a triangle a metre apart, as it always has, so a rebake finds the very object cells the older grid found');
  // At a cell under the half-width the margin is two cells, and one neighbour across a side would be
  // too little: there an object's cell grows the whole diamond, as it always did.
  const fine = growMargin(nx, nz, flags, near, 2);
  ok(fine[at(3, 0)] === 1 && fine[at(1, 2)] === 1 && fine[at(4, 3)] === 1 && fine[at(0, 2)] === 0, 'with a margin of two cells an object\'s cell grows the whole diamond, whatever sides it hugs');
}

// ---- the bake's rasteriser, over buildings drawn by hand -----------------------------------------
// `rasterPlacement` is the whole of what a placed object does to the grid, and `bakeRules` which rules
// a bake runs by; `buildNavGrid` is those two, `growMargin` and `packGrid` over a planet's models. So
// a world drawn here -- flat ground, and a model of triangles a portal cell each -- baked through the
// very same calls says what a planet's bake does with the same shapes.
{
  const W = 32;
  const H = 8;
  /** A triangle soup a portal cell a triangle, in the converter's own layout. */
  const soup = (): { pos: number[]; cells: number[]; tri: (a: number[], b: number[], c: number[], cell: number) => void; quad: (a: number[], b: number[], c: number[], d: number[], cell: number) => void; box: (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, cell: number) => void } => {
    const pos: number[] = [];
    const cells: number[] = [];
    const tri = (a: number[], b: number[], c: number[], cell: number): void => {
      pos.push(...a, ...b, ...c);
      cells.push(cell);
    };
    const quad = (a: number[], b: number[], c: number[], d: number[], cell: number): void => {
      tri(a, b, c, cell);
      tri(a, c, d, cell);
    };
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, cell: number): void => {
      quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], cell);
      quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], cell);
      quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], cell);
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], cell);
      quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], cell);
      quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], cell);
    };
    return { pos, cells, tri, quad, box };
  };
  /** A fence: a wall along z at `x`, from 0.6 to 1.4 m up, which is all of it between the autostep and a body's top. */
  const fence = (s: ReturnType<typeof soup>, x: number, z0: number, z1: number): void => s.quad([x, 0.6, z0], [x, 1.4, z0], [x, 1.4, z1], [x, 0.6, z1], 0);
  // A: a courtyard over a cellar -- a room whose ceiling is 1.28 m under the ground, Fort Tusken's
  // eleventh room's own depth, and nothing of the building over it.
  const cellar = soup();
  cellar.box(2.2, 7.8, -4, -1.28, 2.2, 7.8, 1);
  // B: a hall on the ground, four metres to its ceiling.
  const hall = soup();
  hall.box(12.2, 17.8, 0, 4, 2.2, 7.8, 1);
  // C: a stair down under a roof: the room is all under the ground, and only the building's shell, a
  // roof three metres up, rises over it.
  const stair = soup();
  stair.box(22.2, 25.8, -3.5, -1, 2.2, 5.8, 1);
  stair.quad([22, 3, 2], [22, 3, 6], [26, 3, 6], [26, 3, 2], 0);
  // D: fences, not a building, in the row of cells from z 10 to 16: one standing in the middle of its
  // cell, one hugging its cell's east side, and two a lane apart.
  const fences = soup();
  fence(fences, 5.0, 10.2, 15.8);
  fence(fences, 13.9, 10.2, 15.8);
  fence(fences, 21.0, 10.2, 15.8);
  fence(fences, 27.0, 10.2, 15.8);
  const bakeWith = (opts: Record<string, string>): { flags: Uint8Array; solid: Uint8Array; rules: ReturnType<typeof bakeRules>; opened: number; objects: number; indoor: number } => {
    const rules = bakeRules(opts);
    const flags = new Uint8Array(W * H);
    const edgeNear = new Uint8Array(W * H);
    const bake = { nx: W, nz: H, x0: 0, z0: 0, cell: CELL, flags, edgeNear, heightAt: () => 0, byBand: rules.byBand, nearGround: new Set<number>(), highest: new Map<number, number>() };
    let opened = 0;
    let objects = 0;
    let indoor = 0;
    for (const [s, building] of [[cellar, true], [hall, true], [stair, true], [fences, false]] as const) {
      const r = rasterPlacement(bake, Float32Array.from(s.pos), Int32Array.from(s.cells), building, IDENTITY_FRAME);
      opened += r.opened;
      objects += r.objectCells;
      indoor += r.indoorCells;
    }
    const solid = growMargin(W, H, flags, edgeNear, Math.ceil(0.35 / CELL), rules.byEdge);
    return { flags, solid, rules, opened, objects, indoor };
  };
  const cellOfXZ = (x: number, z: number): number => Math.floor(z / CELL) * W + Math.floor(x / CELL);
  const now = bakeWith({});
  const was = bakeWith({ margin: 'cell', footprint: 'band' });
  const F = NAV_FLAGS;
  ok(now.rules.stamp === NAV_BAKE_RULES && now.rules.byEdge && !now.rules.byBand, `a bake with no options runs by the rules it stamps, ${NAV_BAKE_RULES}: the margin by the side and the footprint by the rise`);
  ok(was.rules.stamp === 1 && bakeRules({ margin: 'cell' }).stamp === 1 && bakeRules({ footprint: 'band' }).stamp === 1, '... and one that runs by either older rule is stamped 1, so `status` asks for it again');
  const overCellar = [cellOfXZ(3, 3), cellOfXZ(5, 5), cellOfXZ(7, 7)];
  ok(overCellar.every((k) => now.flags[k] & F.near && !(now.flags[k] & F.indoor) && !now.solid[k]), 'A: the ground over a cellar whose ceiling is under it is a room come near the ground and not a footprint: open ground');
  ok(overCellar.every((k) => was.flags[k] & F.indoor) && now.opened >= overCellar.length, `... which the band alone called a footprint (${now.opened} cells opened here)`);
  const inHall = [cellOfXZ(13, 3), cellOfXZ(15, 5), cellOfXZ(17, 7)];
  ok(inHall.every((k) => now.flags[k] & F.indoor), 'B: a hall on the ground is its building\'s footprint');
  const underRoof = [cellOfXZ(23, 3), cellOfXZ(25, 5)];
  ok(underRoof.every((k) => now.flags[k] & F.indoor), 'C: a stair down under a roof is a footprint too, since the building\'s shell rises over it though no room does');
  const row = 6;
  const at6 = (i: number): number => row * W + i;
  ok(now.solid[at6(2)] === 1 && now.solid[at6(1)] === 0 && now.solid[at6(3)] === 0, 'D: a fence standing in the middle of its cell blocks that cell and neither beside it');
  ok(was.solid[at6(1)] === 1 && was.solid[at6(3)] === 1, '... where the whole-cell margin blocked both');
  ok(now.solid[at6(6)] === 1 && now.solid[at6(7)] === 1 && now.solid[at6(5)] === 0, '... a fence hugging its cell\'s east side blocks the cell east of it, which is the side it hugs, and not the one west');
  ok(now.solid[at6(11)] === 0 && now.solid[at6(12)] === 0 && was.solid[at6(11)] === 1 && was.solid[at6(12)] === 1, '... and two fences a lane apart, each in the middle of its cell, leave the two cells of the lane open, which the whole-cell margin closed');
  ok(now.objects === was.objects && now.objects > 0, `the same samples find the same object cells under either rules (${now.objects})`);
  // No cell a body could walk on under the older rules is closed under these: every cell open in the
  // older grid -- not blocked and not a footprint -- is open in this one. A footprint opened can show a
  // blocked cell under it, which was never walkable either.
  const open = (b: typeof now, k: number): boolean => !b.solid[k] && !(b.flags[k] & F.indoor);
  let lost = 0;
  let gained = 0;
  for (let k = 0; k < W * H; k++) {
    if (open(was, k) && !open(now, k)) lost++;
    if (!open(was, k) && open(now, k)) gained++;
  }
  ok(lost === 0 && gained > 0, `baked both ways, not one cell open under the older rules is closed under these, and ${gained} more are open`);
  // The converter's own bake is these same calls, under the same rules, and stamps what it ran by.
  const here = dirname(fileURLToPath(import.meta.url));
  const navgridSrc = readFileSync(join(here, '..', 'navgrid.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const bakeSrc = navgridSrc.slice(navgridSrc.indexOf('export async function buildNavGrid('));
  ok(/const rules = bakeRules\(opts\);/.test(bakeSrc) && /byBand: rules\.byBand/.test(bakeSrc) && /rasterPlacement\(bake, positions, cells, isBuilding, placementFrame\(o, cx, cz\)\)/.test(bakeSrc), '`buildNavGrid` rasterises every placement through `rasterPlacement`, under `bakeRules`\' footprint rule');
  ok(/growMargin\(nx, nz, flags, edgeNear, grow, rules\.byEdge\)/.test(bakeSrc) && /rules: rules\.stamp,/.test(bakeSrc), '... grows its margin by `bakeRules`\' margin rule, and stamps the rules it ran by');
  // A placement's own frame: the X mirror of the runtime's placed objects.
  const pf = placementFrame({ x: 5, y: 1, z: 7, q: [1, 0, 0, 0] }, 10, 3);
  ok(pf.gx === 5 && pf.gz === 4 && pf.y === 1 && pf.r00 === 1 && pf.r11 === 1 && pf.r22 === 1 && pf.r01 === 0, 'a placement unturned stands at the pack\'s centre less its x, and its z less the centre\'s');
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
  // The berth's own three, and the one relation between them that is not arbitrary: the room a
  // string-pull leg insists on must be inside the berth the search bought, or the pull would refuse
  // every leg of a route the search itself thought good enough and fall back to hugging every time.
  ok(t.berth > 0 && t.berthCost > 0, 'a body gives something it cannot walk on a wide berth');
  ok(t.berthPull > 0 && t.berthPull <= t.berth, `and the pull keeps ${t.berthPull} m of the ${t.berth} m the search bought`);
  ok(t.berth <= CLEARANCE_MAX * 2, `the berth (${t.berth} m) is inside what the bake stores (${CLEARANCE_MAX} cells at 2 m)`);
}

// ---- the angle the grid calls climbable ----------------------------------------------------------
// It is the owner's choice and not a fact about the game, so what is pinned is the choice: a
// catalogue mobile is stopped between about 45 degrees at a walk and 49 at a run, and the grid is
// cut to the body that can do least -- a mobile at a walk, since the world's people and creatures
// were given it to walk (the NPC pass's D8) -- rather than to the fighter's own 55.
{
  ok(SLOPE_CLIMB_DEGREES === 45, `the grid calls ${SLOPE_CLIMB_DEGREES} degrees climbable`);
  ok(SLOPE_CLIMB_DEGREES >= 45 && SLOPE_CLIMB_DEGREES < 50, 'which is inside the span a dynamic body was measured at, and under the 50 that stopped every one of them');
  ok(SLOPE_CLIMB_DEGREES <= MOBILE_CLIMB_DEGREES, `and no steeper than the ${MOBILE_CLIMB_DEGREES} the game hands a mobile a grid at, so a fresh bake is walked by everyone`);

  // The grid's own stamp decides who is handed it, never an assumption about what is on disk.
  const stamped = (slope: number | undefined): OutdoorNav => {
    const d = draw(['....', '....', '....', '....']);
    const n = new OutdoorNav();
    n.adopt('drawn', { ...d.header, ...(slope === undefined ? {} : { slopeDegrees: slope }) }, d.bytes);
    return n;
  };
  ok(stamped(45).forMobiles, 'a grid baked at 45 degrees is handed to the people and creatures');
  ok(!stamped(47).forMobiles && stamped(47).ready, '... one still carrying the 47-degree bake of the pass before is not, though the fighters go on using it');
  ok(!stamped(undefined).forMobiles, '... nor one that does not say what it was baked at');
  const off = stamped(45);
  off.set({ mobiles: false });
  ok(!off.forMobiles && off.status().mobiles === false, 'and the console switch takes it off them for a comparison');
  ok(!new OutdoorNav().forMobiles, 'no grid at all is handed to nobody');

  // Who else it is kept from: a body wider than half a cell. A wide body's pulled legs keep its own
  // width off everything not open (`legInset`, above), and where none does it walks the path's own
  // steps, cell middle to cell middle, half a cell off both sides -- so half a cell is the widest
  // body every route fits, and that is the whole of the number.
  ok(MOBILE_GRID_ACROSS === CELL / 2, `a mobile is handed the grid only up to ${MOBILE_GRID_ACROSS} m across, the half cell the path's own steps keep off both sides`);
  ok(MOBILE_GRID_ACROSS < 1.5, '... which a person, a womp rat, a kaadu and a bol are inside and a bantha is not');
  ok(legInset({ ...draw(['....', '....', '....', '....']).header, rules: 2 }, MOBILE_GRID_ACROSS) <= 0.45 * CELL, '... and the width that widest body asks its legs to keep is one the three-line test can vouch for');
}

// ---- how the stamp gets from the converter to the game, and how status asks for a new one ---------
// The converter writes the angle into the grid's header under a key the game reads by name; renamed on
// one side only, every grid in every pack would read as unstamped and be taken off every mobile with
// nothing to say so. And `status` asks for a re-bake of a grid baked steeper than the converter now
// bakes, and of no other -- read here out of a pack drawn in a scratch folder, through the real CLI.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const navgridSrc = readFileSync(join(here, '..', 'navgrid.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const headerAt = navgridSrc.indexOf('const header = {');
  const stampAt = navgridSrc.indexOf('slopeDegrees: Number(opts.slope ?? SLOPE_CLIMB_DEGREES),', headerAt);
  ok(headerAt > 0 && stampAt > headerAt && stampAt - headerAt < 3000, 'the converter writes the angle it baked at into the header as `slopeDegrees`');
  ok(/const out = \{ \.\.\.header,/.test(navgridSrc), '... which goes into nav.json whole, under the very key the game reads it by (the block above hands `forMobiles` a header stamped that way and no other)');

  const dir = mkdtempSync(join(tmpdir(), 'navstamp-'));
  try {
    const world = join(dir, 'tatooine');
    mkdirSync(world, { recursive: true });
    writeFileSync(join(world, 'manifest.json'), '{}');
    writeFileSync(join(world, 'terrain.trn'), '');
    writeFileSync(join(world, 'layout.json'), JSON.stringify({ objects: [{ template: 'object/tangible/furniture/shared_drawn.iff' }] }));
    const statusAt = (slope: number | undefined, rules: number | null = NAV_BAKE_RULES): { command: string; reasons: string[] }[] => {
      writeFileSync(join(world, 'nav.json'), JSON.stringify({ version: NAV_GRID_VERSION, planet: 'tatooine', nx: 4, nz: 4, cell: 2, ...(slope === undefined ? {} : { slopeDegrees: slope }), ...(rules === null ? {} : { rules }) }));
      const r = spawnSync(process.execPath, [join(here, '..', 'cli.mjs'), 'status', dir, '--json'], { encoding: 'utf8' });
      assert.equal(r.status, 0, `status runs over the drawn pack: ${r.stderr}`);
      return (JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as { steps: { command: string; reasons: string[] }[] }).steps;
    };
    const navSteps = (steps: { command: string; reasons: string[] }[]) => steps.filter((s) => s.command === 'navgrid');
    const steep = navSteps(statusAt(47));
    ok(steep.length === 1 && steep[0].reasons.some((w) => /steeper than the 45/.test(w)), 'status asks for the grid again over a world still carrying the 47-degree bake, and says why');
    ok(navSteps(statusAt(undefined)).length === 1, '... and over one that does not say what it was baked at');
    ok(navSteps(statusAt(SLOPE_CLIMB_DEGREES)).length === 0, `... and not over one baked at ${SLOPE_CLIMB_DEGREES}`);
    ok(navSteps(statusAt(40)).length === 0, '... nor over one baked gentler, which is only more careful and would be asked for for ever');
    const oldRules = navSteps(statusAt(SLOPE_CLIMB_DEGREES, null));
    ok(oldRules.length === 1 && oldRules[0].reasons.some((w) => /older rules/.test(w)), 'and asks again over a grid that does not say it was baked by the rules this build bakes by, since nothing else about it would say so');
    ok(navSteps(statusAt(SLOPE_CLIMB_DEGREES, 1)).length === 1, '... or says it was baked by the older ones');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${checks} checks passed`);
