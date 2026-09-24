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
  CLEARANCE_MAX,
  COARSE,
  GOAL_SNAP,
  INDOOR,
  INDOOR_ABOVE,
  INDOOR_BELOW,
  NAV_GRID_VERSION,
  OTHER_REGION,
  RANKS,
  SLOPE_CLIMB_DEGREES,
  TOWN_LOOK,
  TOWN_RING,
  clearanceNibbles,
  indoorFootprint,
  isBuildingDef,
  packGrid,
  readGlbTriangles,
  townStanding,
} from '../navgrid.mjs';
import {
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
  isIndoor,
  isOpen,
  lineClear,
  lineClearance,
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
// cut to the body that can do least rather than to the fighter's own 55.
{
  ok(SLOPE_CLIMB_DEGREES === 47, `the grid calls ${SLOPE_CLIMB_DEGREES} degrees climbable`);
  ok(SLOPE_CLIMB_DEGREES >= 45 && SLOPE_CLIMB_DEGREES < 50, 'which is inside the span a dynamic body was measured at, and under the 50 that stopped every one of them');
}

console.log(`\n${checks} checks passed`);
