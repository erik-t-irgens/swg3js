// The indoor pathing (src/world/nav/): the floor a room is walked on, the search across it, the
// funnel that straightens the corridor into corners, the corner check for a body wider than the
// one the mesh is walked for, the room-to-room graph the doorway polygons already are, and the
// per-body path with its clock.
//
// Every floor here is drawn by hand in this file: a grid of unit squares with some of them left
// out. Nothing is read from the owner's archives, and nothing needs a pack. The shapes are chosen
// so that the answers can be written down rather than computed -- a straight strip has exactly one
// corner (its end), and an L has exactly two, the first of them the L's own inside corner, which
// is a vertex of the mesh and so is an exact number.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  NAV_TUNE,
  buildFloor,
  findCorridor,
  fitsAt,
  funnel,
  heightIn,
  insetCorner,
  insetPath,
  locate,
  pathIn,
  type FloorSource,
  type NavFloor,
} from '../../../src/world/nav/navMesh.ts';
import { buildRoomGraph, cellOfPoint, nextDoor, throughPoint, type CellDef, type PortalDef } from '../../../src/world/nav/navRooms.ts';
import { NavAgent } from '../../../src/world/nav/navAgent.ts';
import { WorldNav } from '../../../src/world/nav/nav.ts';
import { LIFT_CELL } from '../../../src/world/lifts.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** A floor of unit squares: `filled(cx, cz)` says which are walkable, `height` lifts them. */
function gridFloor(cols: number, rows: number, filled: (cx: number, cz: number) => boolean, height = 0): { v: number[]; t: number[] } {
  const v: number[] = [];
  const index = new Map<string, number>();
  const vid = (cx: number, cz: number): number => {
    const k = `${cx},${cz}`;
    let i = index.get(k);
    if (i === undefined) {
      i = v.length / 3;
      v.push(cx, height, cz);
      index.set(k, i);
    }
    return i;
  };
  const t: number[] = [];
  for (let cz = 0; cz < rows; cz++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!filled(cx, cz)) continue;
      const a = vid(cx, cz);
      const b = vid(cx + 1, cz);
      const c = vid(cx + 1, cz + 1);
      const d = vid(cx, cz + 1);
      t.push(a, b, c, a, c, d);
    }
  }
  return { v, t };
}

/**
 * The same floor written the way the converter really writes one: ten numbers a triangle, three
 * corners, three neighbours, three portal link ids and a three-bit crossable mask. The neighbours
 * are taken from a floor already read, which is what the file's own are.
 */
function fileRecords(g: { v: number[]; t: number[] }): { v: number[]; t: number[] } {
  const read = buildFloor(g) as NavFloor;
  const t: number[] = [];
  for (let i = 0; i < read.count; i++) {
    for (let c = 0; c < 3; c++) t.push(read.tris[i * 3 + c]);
    for (let e = 0; e < 3; e++) t.push(read.adj[i * 3 + e]);
    for (let e = 0; e < 3; e++) t.push(-1);
    t.push(7);
  }
  return { v: g.v.slice(), t };
}

/** Two floors in one mesh, sharing no vertex: two storeys, or two islands with no way between. */
function merge(a: { v: number[]; t: number[] }, b: { v: number[]; t: number[] }): { v: number[]; t: number[] } {
  const off = a.v.length / 3;
  return { v: [...a.v, ...b.v], t: [...a.t, ...b.t.map((k) => k + off)] };
}

const strip = buildFloor(gridFloor(1, 6, () => true)) as NavFloor;
const ell = buildFloor(gridFloor(5, 5, (cx, cz) => cx === 0 || cz === 0)) as NavFloor;

// --- 1: the floor is read, and its adjacency rebuilt ---------------------------------------------
{
  ok(strip !== null && strip.count === 12, 'a 1 by 6 strip of squares reads as 12 triangles');
  ok(near(strip.min[0], 0) && near(strip.max[0], 1) && near(strip.min[2], 0) && near(strip.max[2], 6), "the strip's own bounds come off its vertices");
  // Every triangle edge with no partner is a metre of the shape's own outline, and no other edge is.
  ok(strip.openEdges === 14, "the strip's unmatched edges are exactly its 14 metres of outline");
  ok(ell.count === 18 && ell.openEdges === 20, "an L of 9 squares reads as 18 triangles with its 20 metres of outline open");
  ok(!strip.adjFromFile, 'with no adjacency in the file it is rebuilt from the shared edges');
  // Every link is mutual, which is the whole of what the search needs of it.
  let mutual = true;
  for (let t = 0; t < strip.count; t++) {
    for (let e = 0; e < 3; e++) {
      const n = strip.adj[t * 3 + e];
      if (n < 0) continue;
      let back = false;
      for (let k = 0; k < 3; k++) if (strip.adj[n * 3 + k] === t) back = true;
      if (!back) mutual = false;
    }
  }
  ok(mutual, 'every rebuilt link names the triangle that named it');
}

// --- 2: the converter's own adjacency, taken or refused ------------------------------------------
{
  const g = gridFloor(1, 2, () => true);
  const rebuilt = buildFloor(g) as NavFloor;
  const mine: number[] = [];
  for (let i = 0; i < rebuilt.adj.length; i++) mine.push(rebuilt.adj[i]);
  const taken = buildFloor({ ...g, adj: mine }) as NavFloor;
  ok(taken.adjFromFile, "an adjacency that is mutual and names the right corners is the converter's own");
  let same = true;
  for (let i = 0; i < taken.adj.length; i++) if (taken.adj[i] !== rebuilt.adj[i]) same = false;
  ok(same, 'and it is the same adjacency the rebuild finds');
  // One link knocked out on one side only: a path through it would walk through a wall.
  const oneSided = mine.slice();
  for (let i = 0; i < oneSided.length; i++) {
    if (oneSided[i] < 0) continue;
    oneSided[i] = -1;
    break;
  }
  const refused = buildFloor({ ...g, adj: oneSided }) as NavFloor;
  ok(!refused.adjFromFile, 'a one-sided link is refused and the whole adjacency is rebuilt instead');
  ok(buildFloor({ ...g, adj: [0, 0, 0] }) !== null && !(buildFloor({ ...g, adj: [0, 0, 0] }) as NavFloor).adjFromFile, 'an adjacency of the wrong length is ignored, not believed');
}

// --- 2b: the record the converter really writes ---------------------------------------------------
{
  // Ten numbers a triangle, which is what `tools/swg/flr.mjs` puts in the pack's floors.json. Read
  // as three, a ten-wide record is 10/3 of the triangles it really holds and its -1 neighbour and
  // portal fields are corner indices no mesh has, which is the bug this pins: the game read the
  // pack's own floors as rubbish and answered nothing.
  const wide = fileRecords(gridFloor(5, 5, (cx, cz) => cx === 0 || cz === 0));
  const read = buildFloor(wide) as NavFloor;
  ok(read !== null && read.count === 18, "the converter's ten-wide triangle record reads as 18 triangles, not 60");
  ok(read.openEdges === ell.openEdges, 'with the same outline the same floor written three-wide has');
  ok(read.adjFromFile, "and the record's own neighbours are taken as the adjacency");
  let same = true;
  for (let i = 0; i < read.adj.length; i++) if (read.adj[i] !== ell.adj[i]) same = false;
  ok(same, 'which is the adjacency the rebuild from the shared edges finds');
  const out = new Float64Array(NAV_TUNE.corners * 2);
  const n = pathIn(read, 0.5, 0, 4.5, 4.5, 0, 0.5, out, 0.35);
  ok(n === 2 && near(out[2], 4.5) && near(out[3], 0.5), 'and a body walks a path across it, corner for corner');
  // 30 numbers are both three records of ten and ten of three; the numbers themselves say which.
  const ten = buildFloor(gridFloor(1, 5, () => true)) as NavFloor;
  ok(ten !== null && ten.count === 10, 'a hand-written floor of exactly ten triangles is not mistaken for three wide ones');
  ok((buildFloor({ ...wide, stride: 10 }) as NavFloor).count === 18, 'and a writer that states its stride is believed');
}

// --- 3: rubbish in, nothing out ------------------------------------------------------------------
{
  ok(buildFloor(null) === null, 'no floor at all reads as no floor');
  ok(buildFloor({} as FloorSource) === null, 'a floor block with neither vertices nor triangles reads as none');
  ok(buildFloor({ v: [0, 0, 0, 1, 0, 0, 0, 0, 1], t: [0, 1, 9] }) === null, 'a triangle naming a vertex that is not there refuses the whole floor');
  const triples = buildFloor({ v: [[0, 0, 0], [1, 0, 0], [1, 0, 1]], t: [[0, 1, 2]] }) as NavFloor;
  ok(triples !== null && triples.count === 1, 'vertices and triangles written as triples read the same as flat ones');
  const typed = buildFloor({ v: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1]), t: new Uint16Array([0, 1, 2]) }) as NavFloor;
  ok(typed !== null && typed.count === 1, 'and so do typed arrays');
}

// --- 4: where a body is standing -----------------------------------------------------------------
{
  const t = locate(strip, 0.5, 0, 0.5);
  ok(t >= 0 && near(heightIn(strip, t, 0.5, 0.5), 0), 'a point on the floor finds its triangle and the floor\'s own height there');
  ok(locate(strip, 0.5, 0, 5.9) >= 0, 'so does a point at the far end');
  ok(locate(strip, 1.2, 0, 3) >= 0, 'a body standing a hand\'s breadth off the edge is put on the nearest triangle');
  ok(locate(strip, 4, 0, 3) < 0, 'a body well off the mesh is on no triangle at all');
  ok(locate(strip, 0.5, 9, 0.5) < 0, 'and neither is one standing nine metres above it');
  const storeys = buildFloor(merge(gridFloor(2, 2, () => true, 0), gridFloor(2, 2, () => true, 3))) as NavFloor;
  const lower = locate(storeys, 0.5, 0.1, 0.5);
  const upper = locate(storeys, 0.5, 3.1, 0.5);
  ok(lower >= 0 && near(heightIn(storeys, lower, 0.5, 0.5), 0), 'with two floors one over the other, a body on the lower is put on the lower');
  ok(upper >= 0 && near(heightIn(storeys, upper, 0.5, 0.5), 3), 'and a body on the upper is put on the upper');
  ok(findCorridor(storeys, lower, upper) === 0, 'and there is no way from one to the other, because the mesh joins them nowhere');
}

// --- 5: the search --------------------------------------------------------------------------------
{
  const a = locate(strip, 0.5, 0, 0.5);
  const b = locate(strip, 0.5, 0, 5.5);
  const n = findCorridor(strip, a, b);
  ok(n >= 6 && n <= 12, `a walk up the strip crosses ${n} of its 12 triangles`);
  ok(strip.work.corridor[0] === a && strip.work.corridor[n - 1] === b, 'the corridor starts where the body is and ends where it is going');
  let joined = true;
  for (let i = 0; i + 1 < n; i++) {
    let touch = false;
    for (let e = 0; e < 3; e++) if (strip.adj[strip.work.corridor[i] * 3 + e] === strip.work.corridor[i + 1]) touch = true;
    if (!touch) joined = false;
  }
  ok(joined, 'and every step of it shares an edge with the one before');
  ok(findCorridor(strip, a, a) === 1, 'a walk to the triangle already stood on is one triangle long');
  ok(findCorridor(strip, a, b, 3) === 0, 'a search allowed to open only three triangles gives up rather than spending the frame');
  ok(strip.work.opened > 0, 'and says how many it opened');
}

// --- 6: the funnel ---------------------------------------------------------------------------------
const corners = new Float64Array(NAV_TUNE.corners * 2);
{
  findCorridor(strip, locate(strip, 0.5, 0, 0.5), locate(strip, 0.5, 0, 5.5));
  const n = funnel(strip, 0.5, 0.5, 0.5, 5.5, corners);
  ok(n === 1 && near(corners[0], 0.5) && near(corners[1], 5.5), 'a straight corridor has one corner: the far end');

  const s = locate(ell, 0.5, 0, 4.5);
  const e = locate(ell, 4.5, 0, 0.5);
  ok(s >= 0 && e >= 0, 'both ends of the L are on its mesh');
  findCorridor(ell, s, e);
  const m = funnel(ell, 0.5, 4.5, 4.5, 0.5, corners);
  ok(m === 2, `an L bends once: ${m} corners`);
  ok(near(corners[0], 1) && near(corners[1], 1), "and it bends at the L's own inside corner, exactly (1, 1)");
  ok(near(corners[2], 4.5) && near(corners[3], 0.5), 'the last corner is always the point asked for');
}

// --- 7: the corner check for a body wider than the mesh was walked for -----------------------------
{
  const out = { x: 0, z: 0 };
  // The obstacle at the L's corner sits in the wedge between the two legs; the corner moves the
  // other way, into the open quarter.
  ok(insetCorner(0.5, 4.5, 1, 1, 4.5, 0.5, 0.35, out), 'a corner with two legs is pulled off its wall');
  ok(out.x < 1 && out.z < 1, 'and it is pulled away from the wedge its two legs shut, not into it');
  ok(near(Math.hypot(out.x - 1, out.z - 1), 0.35, 1e-6), 'by exactly the body\'s own half-width when the legs are long');
  ok(fitsAt(ell, out.x, 0, out.z, 0.35), 'and a body of that width standing there is wholly on the floor');
  ok(!fitsAt(ell, 1, 0, 1, 0.35), 'which it is not at the corner itself');
  ok(!insetCorner(0, 0, 1, 0, 2, 0, 0.35, out) && near(out.x, 1) && near(out.z, 0), 'a "corner" on a straight line has no open side and is left where it is');
  insetCorner(0, 0, 1, 1, 0.2, 0.2, 0.35, out);
  ok(Math.hypot(out.x - 1, out.z - 1) <= 0.4 * Math.hypot(0.8, 0.8) + 1e-9, 'and a corner is never moved more than two-fifths of its shorter leg');

  // The whole path, inset for one width and then for one nothing fits through.
  const s = locate(ell, 0.5, 0, 4.5);
  const e = locate(ell, 4.5, 0, 0.5);
  findCorridor(ell, s, e);
  const n = funnel(ell, 0.5, 4.5, 4.5, 0.5, corners);
  ok(insetPath(ell, 0.5, 4.5, corners, n, 0, 0.35) === 0, 'at the size the mesh is walked at, every corner of the L fits');
  ok(corners[0] < 1 && corners[1] < 1, 'and the corner really moved');
  funnel(ell, 0.5, 4.5, 4.5, 0.5, corners);
  ok(insetPath(ell, 0.5, 4.5, corners, n, 0, 1.2) === 1, 'a body with a 1.2 m half-width does not fit round it, and that is counted');
  ok(near(corners[0], 1) && near(corners[1], 1), 'and its corner is left exactly where the funnel put it rather than moved through a wall');
}

// --- 8: the whole of one room ----------------------------------------------------------------------
{
  const n = pathIn(ell, 0.5, 0, 4.5, 4.5, 0, 0.5, corners, 0.35);
  ok(n === 2, 'a path across the L is two corners end to end');
  ok(corners[2] === 4.5 && corners[3] === 0.5, 'ending at the point asked for');
  ok(pathIn(ell, 40, 0, 40, 4.5, 0, 0.5, corners, 0.35) === 0, 'a body nowhere near the mesh gets no path at all');
  ok(pathIn(ell, 0.5, 0, 4.5, 40, 0, 40, corners, 0.35) === 0, 'and neither does one sent somewhere off it');
}

// --- 9: the doorways alone are a room graph ---------------------------------------------------------
const quad = (x: number): PortalDef => ({ v: [[x, 0, -1], [x, 0, 1], [x, 2.5, 1], [x, 2.5, -1]], i: [0, 1, 2, 0, 2, 3] });
function rooms(passable = [true, true, true]): CellDef[] {
  return [
    { index: 0, bounds: { min: [-100, -100, -100], max: [100, 100, 100] }, portals: [{ geometry: 0, target: 1, passable: passable[0] }] },
    { index: 1, bounds: { min: [0, 0, -2], max: [4, 3, 2] }, portals: [{ geometry: 0, target: 0, passable: passable[0] }, { geometry: 1, target: 2, passable: passable[1] }] },
    { index: 2, bounds: { min: [4, 0, -2], max: [8, 3, 2] }, portals: [{ geometry: 1, target: 1, passable: passable[1] }, { geometry: 2, target: 3, passable: passable[2] }] },
    { index: 3, bounds: { min: [8, 0, -2], max: [12, 3, 2] }, portals: [{ geometry: 2, target: 2, passable: passable[2] }] },
  ];
}
const polys = [quad(0), quad(4), quad(8)];
{
  const g = buildRoomGraph(rooms(), polys);
  ok(g.doors.length === 3, 'three doorways listed twice each are three doors');
  ok(near(g.doors[1].x, 4) && near(g.doors[1].z, 0), "and a door stands at its own polygon's middle");
  ok(near(g.doors[1].y, 1.25), 'at the middle of its height too');
  ok(nextDoor(g, 1, 3)?.geometry === 1, 'from the first room to the third, the first door to walk at is the one between the first and the second');
  ok(nextDoor(g, 3, 0)?.geometry === 2, 'and on the way out of the building it is the one nearest the room you are in');
  ok(nextDoor(g, 1, 1) === null, 'a room you are already in needs no door');
  ok(nextDoor(g, 1, 0)?.geometry === 0, 'the way out of the first room is the outside door');
  const shut = buildRoomGraph(rooms([true, false, true]), polys);
  ok(nextDoor(shut, 1, 3) === null, 'with the middle doorway impassable there is no way to the third room at all');
  ok(nextDoor(shut, 1, 0)?.geometry === 0, 'but the way out is still the way out');
  ok(cellOfPoint(g, 2, 1, 0) === 1 && cellOfPoint(g, 10, 1, 0) === 3, 'a point in a room is in that room');
  ok(cellOfPoint(g, 50, 50, 50) === 0, 'and a point in none of them is outside');
  const nested = buildRoomGraph([...rooms(), { index: 4, bounds: { min: [9, 0, -1], max: [10, 2, 1] }, portals: [] }], polys);
  ok(cellOfPoint(nested, 9.5, 1, 0) === 4, 'where two room boxes hold a point, the smaller one wins');
  const at = { x: 0, y: 0, z: 0 };
  throughPoint(g, g.doors[1], 1, 0.6, at);
  ok(near(at.x, 4.6), 'a path through a doorway aims past its middle, into the room on the far side');
  throughPoint(g, g.doors[1], 2, 0.6, at);
  ok(near(at.x, 3.4), 'and the other way round from the other side');

  // The way OUT. Cell 0 is the exterior shell and its box is the whole building, so its middle is
  // inside the building: aimed at that middle, every exit put the point back in the room the body
  // was already standing in. The doorway's own normal is what says which side is which.
  const shelled = rooms();
  shelled[0].bounds = { min: [-0.5, -0.5, -2.5], max: [12.5, 3.5, 2.5] };
  const out = buildRoomGraph(shelled, polys);
  ok(near(out.centres.get(0)?.x ?? 0, 6), "the exterior shell's own middle really is deep inside the building");
  throughPoint(out, out.doors[0], 1, 0.6, at);
  ok(near(at.x, -0.6), 'and a body leaving by the front door is still aimed out of it, not back past it');
  throughPoint(out, out.doors[1], 1, 0.6, at);
  ok(near(at.x, 4.6), 'while a door between two rooms is unchanged');
  // A doorway lying flat has no flat normal at all; the room's own middle is the fallback.
  const hatch: PortalDef = { v: [[2, 3, -1], [3, 3, -1], [3, 3, 1], [2, 3, 1]], i: [0, 1, 2, 0, 2, 3] };
  const flat = buildRoomGraph([{ index: 1, bounds: { min: [0, 0, -2], max: [4, 3, 2] }, portals: [{ geometry: 0, target: 2, passable: true }] }, { index: 2, bounds: { min: [0, 3, -2], max: [4, 6, 2] }, portals: [{ geometry: 0, target: 1, passable: true }] }], [hatch]);
  ok(near(flat.doors[0].nx, 0) && near(flat.doors[0].nz, 0), 'a doorway lying flat has no flat normal');
  throughPoint(flat, flat.doors[0], 1, 0.6, at);
  ok(near(at.x, 2.5 + 0.6) && near(at.z, 0), 'and is pushed away from the middle of the room the body is in instead');
}

// --- 10: one body's path and its clock ----------------------------------------------------------------
{
  const a = new NavAgent();
  const b1 = {};
  ok(a.wants(b1, 1, 0, 0, 0), 'a body with no path at all wants one');
  a.corners[0] = 5;
  a.corners[1] = 0;
  a.corners[2] = 10;
  a.corners[3] = 0;
  a.took(b1, 1, 10, 0, 0, 2);
  ok(a.plans === 1 && !a.failed, 'a search that found corners is a plan');
  ok(!a.wants(b1, 1, 10, 0, 0.2), 'and nothing is asked again on the next frame');
  ok(a.advance(0, 0) && a.corner()?.x === 5, 'the corner to walk at is the first one not yet reached');
  ok(a.advance(5.2, 0) && a.corner()?.x === 10, 'a corner reached is dropped and the next one is handed back');
  ok(!a.advance(10, 0) && a.corner() === null, 'and a path walked out answers with nothing');
  // A body sitting on the end of its path is the commonest steady state there is, so the clock
  // holds it: read as a trigger rather than a rate, `every` would fire on every single frame.
  ok(!a.wants(b1, 1, 10, 0, 0.2), 'a body that has walked its path out does not ask again on the next frame');
  ok(a.wants(b1, 1, 10, 0, NAV_TUNE.every), 'it asks once the clock is up, and that is twice a second at the most');
  a.took(b1, 1, 10, 0, 0.2, 2);
  ok(a.wants(b1, 2, 10, 0, 0.3), 'a body that has changed room throws its path away at once, clock or no clock');
  ok(a.wants({}, 1, 10, 0, 0.3), 'and so does one that has changed building');
  ok(!a.wants(b1, 1, 40, 0, 0.3), 'a goal that has moved further than the tuning does not jump the clock either');
  ok(a.wants(b1, 1, 40, 0, 0.2 + NAV_TUNE.every + 1e-6), 'but it does ask the moment the clock lets it');
  ok(!a.wants(b1, 1, 11, 0, 0.3), 'one that has moved a stride does not');
  ok(!a.wants(b1, 1, 11, 0, 0.2 + NAV_TUNE.every + 1e-6), 'and a body with a path in hand and a goal that has not moved asks for nothing at all, however long it stands there');
  a.took(b1, 1, 10, 0, 5, 0);
  ok(a.failed && a.failures === 1, 'a search that found nothing is remembered as one');
  ok(!a.wants(b1, 1, 10, 0, 5 + NAV_TUNE.retry - 0.01), 'and is not tried again at once');
  ok(a.wants(b1, 1, 10, 0, 5 + NAV_TUNE.retry), 'but is tried again after the retry');
  a.clear();
  ok(a.corner() === null && a.count === 0, 'and clearing a body leaves it with no path');
}

// --- 11: the three steps it degrades in, through the game's own seam ------------------------------------
function fakeBuilding(cells: CellDef[], portals: PortalDef[], offsetX = 0): { building: unknown; cellState: (cell: number) => unknown } {
  const matrix = new THREE.Matrix4().makeTranslation(offsetX, 0, 0);
  const building = { model: { def: { cells, portals }, portals: [] }, matrix, inverse: matrix.clone().invert(), x: offsetX, z: 0, radius: 20, template: '', interior: [], interiorBuilt: false };
  return { building, cellState: (cell: number) => ({ building, cell }) };
}
{
  const nav = new WorldNav();
  const plain = fakeBuilding([], []);
  const agent0 = new NavAgent();
  ok(nav.corner(agent0, plain.cellState(1) as never, 0, 0, 0, 5, 0, 0, 0.35, 0) === null, 'a model with no rooms and no doorways answers with nothing, and the body steers as it always did');

  // A pack converted before any of this: doorways in every room, no floor anywhere. It must play
  // EXACTLY as it plays today, so nothing is answered at all -- not even the doorway, which the
  // polygons alone could give and which would change what every creature indoors does.
  const noFloors = fakeBuilding(rooms(), polys);
  const agent1 = new NavAgent();
  ok(nav.corner(agent1, noFloors.cellState(1) as never, 2, 0, 0, 10, 0, 0, 0.35, 0) === null, 'a building with doorways but no floors answers nothing: an unreconverted pack steers exactly as it always did');
  ok(nav.status().asked === 0 && nav.status().doorOnly === 0, 'and no search is even asked for in one');
  ok(nav.status().floors === false && nav.status().converted === false, 'the pack is reported as one converted before the floors were read');

  // A pack converted with `--floors-graph-only` has been reconverted and carries no mesh at all.
  // It is not an old pack, so it takes the doorway answer; it has no floor, so that is all it gets.
  const graphOnly = rooms();
  (graphOnly[1] as unknown as { graph: unknown }).graph = { n: [1, 0, 0, 1, -1], e: [] };
  const thin = fakeBuilding(graphOnly, polys, 300);
  const agent2 = new NavAgent();
  const thinDoor = nav.corner(agent2, thin.cellState(1) as never, 302, 0, 0, 310, 0, 0, 0.35, 0);
  ok(thinDoor !== null && near(thinDoor.x, 304 + NAV_TUNE.through, 1e-4), 'a pack written with the graphs and no meshes still sends a body at its doorway');
  ok(nav.status().floors === false && nav.status().converted === true, 'and is reported as converted, with no floor meshes in it');

  // Step three: a floor, in a building standing 100 m down the street.
  const withFloor = rooms();
  (withFloor[1] as unknown as { floor: unknown }).floor = gridFloor(5, 5, (cx, cz) => cx === 0 || cz === 0);
  const built = fakeBuilding(withFloor, polys, 100);
  const agent3 = new NavAgent();
  const c = nav.corner(agent3, built.cellState(1) as never, 100.5, 0, 4.5, 104.5, 0, 0.5, 0.35, 0);
  ok(c !== null, 'a room with a floor answers with a corner');
  ok(c !== null && c.x > 100 && c.x < 101 && c.z > 0 && c.z < 1, `and it is the L's inside corner, in the world's own frame: ${c ? `${c.x.toFixed(2)}, ${c.z.toFixed(2)}` : ''}`);
  ok(nav.status().found === 1 && nav.status().floors === true, 'which is counted as a path, and the pack is now one that has floors');
  const d = nav.describe(built.building as never);
  ok(d.withFloor === 1 && d.without === 2 && d.triangles === 18 && d.doors === 3, 'and the console can say what the building came out as');
  const before = nav.status().asked;
  nav.corner(agent3, built.cellState(1) as never, 100.5, 0, 4.4, 104.5, 0, 0.5, 0.35, 0.1);
  ok(nav.status().asked === before, 'a body walking the path it already has asks for no search at all');

  // Step two, which is a room's fallback and not a pack's: this building has a floor, so a room of
  // it that has none still answers with its doorway rather than with nothing.
  const agent4 = new NavAgent();
  const doorsBefore = nav.status().doorOnly;
  const door = nav.corner(agent4, built.cellState(2) as never, 106, 0, 0, 110, 0, 0, 0.35, 1);
  ok(door !== null && near(door.x, 108 + NAV_TUNE.through, 1e-4), 'a room with no floor in a building that has one is still sent at its doorway');
  ok(nav.status().doorOnly === doorsBefore + 1, 'and that is counted as a doorway answer rather than a path');
}

// --- 11b: two copies of one building are two places, not one --------------------------------------------
{
  // The floors are cached on the model, which both copies share; the path is keyed on the placed
  // building, because its corners are in the world's frame and the other copy is down the street.
  const cells = rooms();
  (cells[1] as unknown as { floor: unknown }).floor = gridFloor(5, 5, (cx, cz) => cx === 0 || cz === 0);
  const model = { def: { cells, portals: polys }, portals: [] };
  const place = (offsetX: number): { building: unknown; cellState: (cell: number) => unknown } => {
    const matrix = new THREE.Matrix4().makeTranslation(offsetX, 0, 0);
    const building = { model, matrix, inverse: matrix.clone().invert(), x: offsetX, z: 0, radius: 20, template: '', interior: [], interiorBuilt: false };
    return { building, cellState: (cell: number) => ({ building, cell }) };
  };
  const here = place(0);
  const street = place(200);
  const nav = new WorldNav();
  const a = new NavAgent();
  const first = nav.corner(a, here.cellState(1) as never, 0.5, 0, 4.5, 4.5, 0, 0.5, 0.35, 0);
  ok(first !== null && first.x < 10, 'a body in the first copy is given a corner in the first copy');
  const second = nav.corner(a, street.cellState(1) as never, 200.5, 0, 4.5, 204.5, 0, 0.5, 0.35, 0.01);
  ok(second !== null && second.x > 190, 'and the same body stepping into the second is given one in the second, at once');
  ok(nav.status().asked === 2 && nav.status().cellsBuilt === 1, "which cost a second search and no second reading of the model's floor");
}

// --- 12: a lift shaft is not a staircase --------------------------------------------------------------
{
  // Rooms 1 and 3 are two storeys of a building; room 2 between them is the shaft, with a doorway
  // onto each. Nothing that walks can get from one to the other, whatever the doorways say.
  const shafted: CellDef[] = [
    { index: 0, name: '', bounds: { min: [-100, -100, -100], max: [100, 100, 100] }, portals: [{ geometry: 0, target: 1, passable: true }] },
    { index: 1, name: 'lobby', bounds: { min: [0, 0, -2], max: [4, 3, 2] }, portals: [{ geometry: 0, target: 0, passable: true }, { geometry: 1, target: 2, passable: true }] },
    { index: 2, name: 'elevator1', bounds: { min: [4, 0, -2], max: [8, 12, 2] }, portals: [{ geometry: 1, target: 1, passable: true }, { geometry: 2, target: 3, passable: true }] },
    { index: 3, name: 'upper_hall', bounds: { min: [8, 9, -2], max: [12, 12, 2] }, portals: [{ geometry: 2, target: 2, passable: true }] },
  ];
  // The rule is the lift menu's own, imported rather than restated: written out again here, a
  // change to `LIFT_CELL` would leave this passing while the game routed bodies into shafts.
  const shaftAware = buildRoomGraph(shafted, polys, (c) => LIFT_CELL.test(c.name ?? ''));
  ok(shaftAware.shafts.has(2) && !shaftAware.shafts.has(1), "a room named for a lift is a shaft by the lift menu's own rule, and a lobby is not");
  ok(!LIFT_CELL.test('elevator_room'), 'and the room beside a shaft is not one either');
  ok(nextDoor(shaftAware, 1, 2)?.geometry === 1, "a body sent to the shaft itself is sent to the shaft's own doorway");
  ok(nextDoor(shaftAware, 1, 3) === null, 'but no route goes up through it, because nothing that walks can');
  const blind = buildRoomGraph(shafted, polys);
  ok(nextDoor(blind, 1, 3)?.geometry === 1, 'which is a rule of its own: with no shaft rule the same graph routes a body straight into it');

  // And the game's own seam, which is where the rule is really applied: a floored building whose
  // middle room is a shaft gives a body standing in that shaft no path at all.
  (shafted[1] as unknown as { floor: unknown }).floor = gridFloor(4, 4, () => true);
  (shafted[2] as unknown as { floor: unknown }).floor = gridFloor(4, 4, () => true);
  const lift = fakeBuilding(shafted, polys);
  const nav = new WorldNav();
  const a = new NavAgent();
  ok(nav.corner(a, lift.cellState(2) as never, 6, 0, 0, 10, 10, 0, 0.35, 0) === null, 'a body standing in a lift shaft is given no path, whatever its doorways say');
  ok(nav.corner(a, lift.cellState(1) as never, 2, 0, 0, 10, 10, 0, 0.35, 0) === null, 'and no route out of the lobby goes up through it either');
}

// --- 13: a floor is read only when somebody walks that room, and only so many searches a step --------------
{
  const withFloor = rooms();
  (withFloor[1] as unknown as { floor: unknown }).floor = gridFloor(5, 5, (cx, cz) => cx === 0 || cz === 0);
  const built = fakeBuilding(withFloor, polys);
  const nav = new WorldNav();
  nav.forBuilding(built.building as never);
  ok(nav.status().cellsWithFloor === 1 && nav.status().cellsBuilt === 0, 'a building says which of its rooms name a floor without reading one of them');
  const a = new NavAgent();
  nav.corner(a, built.cellState(1) as never, 0.5, 0, 4.5, 4.5, 0, 0.5, 0.35, 0);
  ok(nav.status().cellsBuilt === 1, 'and reads a room\'s floor the first time a body walks that room');

  const crowd: NavAgent[] = [];
  for (let i = 0; i < 8; i++) crowd.push(new NavAgent());
  const budget = new WorldNav();
  // The step that reads a room's floor for the first time pays for that and nothing else: reading
  // one is the only millisecond-scale thing in here, and four of them on one step is a hitch.
  for (const one of crowd) budget.corner(one, built.cellState(1) as never, 0.5, 0, 4.5, 4.5, 0, 0.5, 0.35, 1);
  ok(budget.status().cellsBuilt === 1 && budget.status().asked === 1, 'the step that reads a floor runs one search and no more');
  ok(budget.status().deferred === 7, 'and the seven behind it are put off rather than dropped');
  for (const one of crowd) budget.corner(one, built.cellState(1) as never, 0.5, 0, 4.5, 4.5, 0, 0.5, 0.35, 1.016);
  ok(budget.status().asked === 1 + NAV_TUNE.perStep, `on the next step, with the floor already read, ${NAV_TUNE.perStep} of them run`);
  for (const one of crowd) budget.corner(one, built.cellState(1) as never, 0.5, 0, 4.5, 4.5, 0, 0.5, 0.35, 1.032);
  ok(budget.status().asked === 8, 'and the last of them on the step after that');
  const settled = budget.status().asked;
  for (const one of crowd) budget.corner(one, built.cellState(1) as never, 0.5, 0, 4.5, 4.5, 0, 0.5, 0.35, 1.048);
  ok(budget.status().asked === settled, 'after which eight bodies standing on their paths cost nothing at all');
}

// --- 14: the mesh is walked at the player's own width ---------------------------------------------------
{
  const player = src('../../../src/player/player.ts');
  const m = /const CAPSULE_RADIUS = ([\d.]+);/.exec(player);
  ok(m !== null, "the player's capsule radius is still one named number in player.ts");
  ok(m !== null && Number(m[1]) === NAV_TUNE.agent, `the floors are walked at the player's own ${m?.[1]} m, not a number of the nav's own`);
}

// --- 15: the seam in the creatures' own files ------------------------------------------------------------
{
  // `mobile.ts` and `manager.ts` cannot be imported here: they pull in three and half the world,
  // and their own relative imports are extensionless, so node's type stripping will not load them.
  // What can be pinned is the shape of the seam, which is the whole of what this package put in
  // them -- and the one rule that must never be broken, that a corner is a thing a body FACES and
  // never the goal it is measured as having arrived at.
  const mobile = src('../../../src/world/mobiles/mobile.ts');
  const manager = src('../../../src/world/mobiles/manager.ts');
  const hook = /if \(moveTo && pace !== 'stand' && this\.navCell[^}]*?\n\s*\}/.exec(mobile);
  ok(hook !== null, 'a creature asks for its corner only with somewhere to go, a pace to go at, and a room to be in');
  ok(hook !== null && /if \(corner\) face = corner;/.test(hook[0]), 'and only what it faces is taken from the path');
  ok(hook !== null && !/moveTo\s*=/.test(hook[0]), 'the goal it is measured against is never overridden, so it cannot stop a stride short of every corner');
  ok(hook !== null && /!this\.flyer/.test(hook[0]), 'and nothing that flies is pathed across a floor');
  ok(/this\.navAgent\.clear\(\)/.test(mobile), 'a creature that respawns drops the corners it was walking');
  ok(/m\.navCell = held\.cell;/.test(manager) && /m\.navCell = null;/.test(manager), "the manager writes the room the path is keyed on beside the room it already wrote, and clears it on open ground");
  ok((manager.match(/m\.navCell/g) ?? []).length === 3, 'in the three places it writes the room and nowhere else');
}

console.log(`\n${checks} checks passed`);
