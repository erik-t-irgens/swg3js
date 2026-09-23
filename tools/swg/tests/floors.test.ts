// The walkable floors a portal building's cells name (.flr): the reader, and what the pack carries.
// Everything here is built by hand, byte for byte, so the test says nothing about anybody's archives.
//
// The fixture is one small room's floor: six vertices and four triangles in two quads side by side,
// wound the way the retail files are (the cross product of the corners in order points up), with a
// doorway edge at each end, one crossable edge with no portal behind it, and a three-node graph
// whose two doorway nodes name the building's portals rather than the cell's own links.
import assert from 'node:assert/strict';
import { chunk, encode, form, W } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import { FLOOR_PACK_VERSION, floorBlock, floorSize, parseFloor } from '../flr.mjs';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const same = (a: unknown, b: unknown, msg: string) => {
  assert.deepStrictEqual(a, b, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

// ---- the fixture ---------------------------------------------------------------
const THIRD = new Float32Array([1 / 3])[0]; // what a float32 in the file really holds
const VERTS: [number, number, number][] = [
  [1, 0, 0],
  [5, 0, 0],
  [5, 0, 4],
  [1, 0.25, 4],
  [9, THIRD, 0],
  [9, 0, 4],
];
type Tri = { corners: [number, number, number]; neighbours: [number, number, number]; cross: [number, number, number]; portals: [number, number, number]; spare: number };
const TRIS: Tri[] = [
  { corners: [0, 2, 1], neighbours: [1, 2, -1], cross: [1, 1, 0], portals: [-1, -1, -1], spare: 0 },
  { corners: [0, 3, 2], neighbours: [-1, -1, 0], cross: [1, 0, 1], portals: [0, -1, -1], spare: 0 },
  // The one edge marked 2 rather than 1, which the retail files carry on 904 edges: crossable, no
  // neighbour and no portal. And the undecoded byte at +43 set, to prove nothing reads it.
  { corners: [1, 2, 5], neighbours: [0, -1, 3], cross: [1, 2, 1], portals: [-1, -1, -1], spare: 1 },
  { corners: [1, 5, 4], neighbours: [2, -1, -1], cross: [1, 1, 0], portals: [-1, 1, -1], spare: 0 },
];
// The cell's own portal links, as the portal file lists them: the building's portal number, and
// which cell is on the other side.
const LINKS = [
  { geometry: 7, target: 2 },
  { geometry: 3, target: 0 },
];
const NODES = [
  { portal: -1, type: 1, p: [3, 0, 2], radius: 0.5 },
  { portal: 7, type: 0, p: [1, 0, 2], radius: 0 },
  { portal: 3, type: 0, p: [9, 0, 2], radius: 0 },
];
const EDGES: [number, number][] = [[0, 1], [1, 0], [0, 2], [2, 0]];

const vertBytes = (counted: boolean) => {
  const w = new W();
  if (counted) w.i32(VERTS.length);
  for (const v of VERTS) w.f32(v[0]).f32(v[1]).f32(v[2]);
  return w.bytes();
};
const triBytes = (counted: boolean) => {
  const w = new W();
  if (counted) w.i32(TRIS.length);
  TRIS.forEach((t, i) => {
    w.i32(t.corners[0]).i32(t.corners[1]).i32(t.corners[2]);
    w.i32(i);
    w.i32(t.neighbours[0]).i32(t.neighbours[1]).i32(t.neighbours[2]);
    // The file stores the plane normal pointing the opposite way to the winding.
    w.f32(0).f32(-1).f32(0);
    w.u8(t.cross[0]).u8(t.cross[1]).u8(t.cross[2]).u8(t.spare);
    w.i32(0); // the part id, which is derivable from the neighbours and is not carried
    w.i32(t.portals[0]).i32(t.portals[1]).i32(t.portals[2]);
  });
  return w.bytes();
};
const graphForm = (edgeBytes?: Uint8Array) => {
  const n = new W().i32(NODES.length);
  NODES.forEach((nd, i) => {
    n.i32(i).i32(-1).i32(nd.portal).i32(nd.type).f32(nd.p[0]).f32(nd.p[1]).f32(nd.p[2]).f32(nd.radius);
  });
  const e = new W().i32(EDGES.length);
  for (const [a, b] of EDGES) e.i32(a).i32(b).i32(0).f32(0);
  if (edgeBytes) return form('PGRF', form('0001', chunk('PNOD', n.bytes()), chunk('PEDG', edgeBytes)));
  // ECNT and ESTR are written the way the client does and are deliberately never read: the start
  // for the node with no edges is nonsense here, as it is in 541 of the retail graphs.
  const cnt = new W().i32(NODES.length).i32(2).i32(1).i32(1);
  const str = new W().i32(NODES.length).i32(0).i32(2).i32(99);
  return form('PGRF', form('0001', chunk('META', new W().i32(3).bytes()), chunk('PNOD', n.bytes()), chunk('PEDG', e.bytes()), chunk('ECNT', cnt.bytes()), chunk('ESTR', str.bytes())));
};
// How FLOR 0004 writes its graph: PNOD and PEDG as chunks of the floor's own version form, with no
// FORM PGRF at all, and node records that are not 32 bytes. All 177 of the retail 0004 files are
// this shape; 154 of them have an empty PNOD, which is no graph rather than one that cannot be read.
const bareNodes = (bytes: number) => chunk('PNOD', new Uint8Array(bytes));
// A PGRF whose PNOD and PEDG are a count of nought and nothing else: a graph with no nodes, which
// five of the retail 0005 files write and which must not be reported as one that cannot be read.
const emptyGraphForm = () => form('PGRF', form('0001', chunk('PNOD', new W().i32(0).bytes()), chunk('PEDG', new W().i32(0).bytes())));
const floorFile = (version: string, opts: { graph?: boolean; tris?: Uint8Array; bare?: number; empty?: boolean; edges?: Uint8Array } = {}) => {
  const counted = Number(version) >= 6;
  const kids = [chunk('VERT', vertBytes(counted)), chunk('TRIS', opts.tris ?? triBytes(counted))];
  if (opts.bare !== undefined) kids.push(bareNodes(opts.bare));
  else if (opts.empty) kids.push(emptyGraphForm());
  else if (opts.graph !== false) kids.push(graphForm(opts.edges));
  return parseIff(Buffer.from(encode(form('FLOR', form(version, ...kids)))));
};

/** The rule a walled-off triangle must satisfy, stated rather than restated from the code. */
const reachable = (f: ReturnType<typeof parseFloor>, bad: number) =>
  f.triangles.some((t, i) => i !== bad && t.neighbours.some((n, k) => n === bad && t.crossable[k]));

// ---- the reader ----------------------------------------------------------------
{
  const f = parseFloor(floorFile('0006'));
  ok(f.version === '0006' && f.warnings.length === 0, 'a 0006 floor reads with nothing to report');
  same(f.vertices, VERTS.map((v) => [v[0], v[1], v[2]]), 'every vertex comes back exactly as it went in');
  ok(f.triangles.length === 4, 'four triangles');
  same(f.triangles[2].corners, [1, 2, 5], 'a triangle keeps its three corners in order');
  same(f.triangles[2].neighbours, [0, -1, 3], 'a neighbour is the triangle across edge k, -1 where the mesh ends');
  same(f.triangles[2].crossable, [true, true, true], 'an edge marked 2 is read as crossable, like one marked 1');
  same(f.triangles[0].crossable, [true, true, false], 'an edge marked 0 is not crossable');
  same(f.triangles[1].portals, [0, -1, -1], "a doorway edge names one of the cell's portal links");
  same(floorSize(f), { vertices: 6, triangles: 4, nodes: 3, edges: 4 }, 'the totals a run counts');
  ok(f.graph !== null && f.graph.nodes.length === 3 && f.graph.edges.length === 4, 'the path graph comes with it');
  same(f.graph!.nodes[1], { portal: 7, type: 0, position: [1, 0, 2] }, "a doorway node keeps the building's portal number and its place");
  same(f.graph!.edges, EDGES, 'the edges come through both ways round, as the file stores them');
}

// The older versions differ in one thing only: no count in front of VERT and TRIS.
for (const version of ['0003', '0004', '0005']) {
  const older = parseFloor(floorFile(version, { graph: version === '0005' }));
  const newer = parseFloor(floorFile('0006'));
  same(older.vertices, newer.vertices, `FLOR ${version}: the vertices read the same as ${version === '0005' ? 'a 0006 file' : 'a counted file'} without a count in front of them`);
  same(older.triangles, newer.triangles, `FLOR ${version}: the triangles read the same without a count in front of them`);
  if (version !== '0005') ok(older.graph === null, `FLOR ${version} with no PGRF: no graph, and the mesh still reads`);
}

// A file with no graph at all: the mesh is still the answer. 17 of the 3,332 floors the game's own
// cells name are this, so it is an ordinary case and not an error.
{
  const f = parseFloor(floorFile('0006', { graph: false }));
  ok(f.graph === null && f.triangles.length === 4, 'a floor with no path graph reads its mesh and says it has no graph');
  ok(f.warnings.length === 0, 'and says nothing, because there is nothing there to report');
}

// FLOR 0004's own graph layout: PNOD as a chunk of the floor's version form with no FORM PGRF at
// all. Its records are 37 bytes, which this reader does not decode -- so it must SAY so, or a file
// whose graph was dropped is indistinguishable from one of the 17 that genuinely have none.
{
  const f = parseFloor(floorFile('0004', { bare: 37 * 3 }));
  ok(f.graph === null && f.triangles.length === 4, 'a 0004 graph is left out and the mesh still reads');
  ok(f.warnings.length === 1 && /not 32-byte records \(PNOD is 111 bytes\)/.test(f.warnings[0]), 'and the run is told, with the size that was there');
}
// An empty PNOD is the other 154 of the 177: no nodes, so nothing to report.
{
  const f = parseFloor(floorFile('0004', { bare: 0 }));
  ok(f.graph === null && f.warnings.length === 0, 'a 0004 file with an empty PNOD has no graph and nothing to say about it');
}
// And a counted graph of nought nodes, which five retail 0005 files write, is the same thing.
{
  const f = parseFloor(floorFile('0005', { empty: true }));
  ok(f.graph === null && f.warnings.length === 0, 'a graph counted as nought nodes has no graph and nothing to say about it either');
}
// Nodes with edges that cannot be read come out looking exactly like the 287 retail graphs that
// have nodes and no edges, so the one case that is not ordinary says so.
{
  const f = parseFloor(floorFile('0006', { edges: new Uint8Array(7) }));
  ok(f.graph !== null && f.graph!.nodes.length === 3 && f.graph!.edges.length === 0, 'a graph whose edges cannot be read keeps its nodes');
  ok(f.warnings.length === 1 && /PEDG is 7 bytes/.test(f.warnings[0]), 'and says so, rather than passing as a graph that simply has none');
}

// A neighbour pointing past the end of the triangle list is read as no neighbour and reported,
// rather than handed on to something that would walk off the end of an array.
{
  const w = new W().i32(TRIS.length);
  TRIS.forEach((t, i) => {
    w.i32(t.corners[0]).i32(t.corners[1]).i32(t.corners[2]).i32(i);
    w.i32(i === 0 ? 99 : t.neighbours[0]).i32(t.neighbours[1]).i32(t.neighbours[2]);
    w.f32(0).f32(-1).f32(0).u8(t.cross[0]).u8(t.cross[1]).u8(t.cross[2]).u8(0).i32(0).i32(t.portals[0]).i32(t.portals[1]).i32(t.portals[2]);
  });
  const f = parseFloor(floorFile('0006', { tris: w.bytes() }));
  ok(f.triangles[0].neighbours[0] === -1 && f.warnings.length === 1, 'a neighbour past the end of the list becomes no neighbour, and the run is told');
}

// A corner index pointing past the end of the vertex list is pulled into the list and its triangle
// is walled off, so nothing that walks the floor can ever index into nothing. Clearing the
// triangle's own three flags is not enough: crossing is decided from the flag of the triangle being
// left, so the fixture's triangle 2 (neighbours [0, -1, 3], every edge crossable) would still lead
// straight onto it and a body that stepped on could never step off.
{
  const w = new W().i32(TRIS.length);
  TRIS.forEach((t, i) => {
    w.i32(i === 3 ? 42 : t.corners[0]).i32(t.corners[1]).i32(t.corners[2]).i32(i);
    w.i32(t.neighbours[0]).i32(t.neighbours[1]).i32(t.neighbours[2]);
    w.f32(0).f32(-1).f32(0).u8(t.cross[0]).u8(t.cross[1]).u8(t.cross[2]).u8(0).i32(0).i32(t.portals[0]).i32(t.portals[1]).i32(t.portals[2]);
  });
  // The fixture is only worth anything if the way in really is there to shut.
  const clean = parseFloor(floorFile('0006'));
  ok(reachable(clean, 3), 'the fixture really does lead into triangle 3 across a crossable edge');
  const f = parseFloor(floorFile('0006', { tris: w.bytes() }));
  same(f.triangles[3].corners, [0, 5, 4], 'a corner past the end of the vertex list is pulled into it');
  same(f.triangles[3].crossable, [false, false, false], 'and its triangle is walled off from its own side');
  ok(!reachable(f, 3), 'and from every other side: no triangle names a walled triangle across a crossable edge');
  same(f.triangles[2].crossable, [true, true, false], 'the neighbour that led in has that one edge shut and keeps its others');
  same(f.triangles[2].neighbours, [0, -1, -1], 'and no longer names it as a neighbour at all');
  same(f.triangles[3].portals, [-1, -1, -1], 'a walled triangle leads out through no portal either');
  ok(f.warnings.length === 1 && /walled off, from both sides/.test(f.warnings[0]), 'and the run is told');
}

// Not a floor at all.
{
  let threw = '';
  try {
    parseFloor(parseIff(Buffer.from(encode(form('PRTO', form('0004', chunk('DATA', new W().i32(0).bytes())))))));
  } catch (err) {
    threw = (err as Error).message;
  }
  ok(/Not a floor mesh/.test(threw), 'something that is not a floor is refused by name');
}

// ---- what the pack carries -----------------------------------------------------
{
  const f = parseFloor(floorFile('0006'));
  const { block, notes } = floorBlock(f, { flipX: true, links: LINKS });
  ok(notes.length === 0, 'the fixture converts with nothing to report');
  same(block.floor!.v, [-1, 0, 0, -5, 0, 0, -5, 0, 4, -1, 0.25, 4, -9, 0.333, 0, -9, 0, 4], 'X is mirrored as the meshes are, and the rest is rounded to the millimetre');
  // Corners go (a, c, b) under the mirror so the winding survives; everything on an edge is
  // permuted (2, 1, 0) with them.
  same(block.floor!.t.slice(0, 10), [0, 1, 2, -1, 2, 1, -1, -1, -1, 6], 'the first triangle: corners re-ordered, neighbours and portals permuted, the crossable edges as a mask');
  same(block.floor!.t.slice(10, 20), [0, 2, 3, 0, -1, -1, -1, -1, 0, 5], "the doorway triangle keeps its portal link on the edge it moved to");
  same(block.floor!.t.slice(20, 30), [1, 5, 2, 3, -1, 0, -1, -1, -1, 7], 'a triangle whose three edges are all crossable');
  same(block.floor!.t.slice(30, 40), [1, 4, 5, -1, -1, 2, -1, 1, -1, 6], 'the far doorway triangle');

  // The two things a walker needs of the mirrored mesh: the winding still says which way is up,
  // and a neighbour still names this triangle back across the same two corners.
  const v = block.floor!.v;
  const t = block.floor!.t;
  let up = 0;
  let back = 0;
  let pairs = 0;
  for (let i = 0; i < 4; i++) {
    const o = i * 10;
    const c = [t[o], t[o + 1], t[o + 2]];
    const P = (k: number) => [v[k * 3], v[k * 3 + 1], v[k * 3 + 2]];
    const a = P(c[0]);
    const b = P(c[1]);
    const d = P(c[2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    if (u[2] * w2[0] - u[0] * w2[2] > 0) up++;
    for (let k = 0; k < 3; k++) {
      const nb = t[o + 3 + k];
      if (nb < 0) continue;
      pairs++;
      const p = nb * 10;
      const oc = [t[p], t[p + 1], t[p + 2]];
      let j = -1;
      for (let q = 0; q < 3; q++) if (t[p + 3 + q] === i) j = q;
      if (j < 0) continue;
      const mine = [c[k], c[(k + 1) % 3]].sort((x, y) => x - y).join(',');
      const theirs = [oc[j], oc[(j + 1) % 3]].sort((x, y) => x - y).join(',');
      if (mine === theirs) back++;
    }
  }
  ok(up === 4, 'after the mirror every triangle still winds so the cross product points up');
  ok(pairs === 6 && back === 6, 'after the mirror every neighbour still names this triangle back across the same two corners');

  // A doorway node arrives carrying the building's portal number; the pack carries the cell's own
  // link index instead, so "portal" means the same thing on a triangle and on a node.
  same(block.graph!.n, [-3, 0, 2, 1, -1, -1, 0, 2, 0, 0, -9, 0, 2, 0, 1], "a doorway node's building portal becomes the cell's own link index, and an ordinary node keeps -1");
  same(block.graph!.e, [0, 1, 1, 0, 0, 2, 2, 0], 'the graph edges are carried as they stand');
}

// Without the mirror nothing moves at all.
{
  const f = parseFloor(floorFile('0006'));
  const { block } = floorBlock(f, { flipX: false, links: LINKS });
  same(block.floor!.t.slice(0, 10), [0, 2, 1, 1, 2, -1, -1, -1, -1, 3], 'with no mirror the corners, neighbours and portals stay exactly as the file has them');
  same(block.floor!.v.slice(0, 3), [1, 0, 0], 'and so does X');
}

// A mesh with no triangles is no floor: written as a block it would tell a reader that this cell
// can be walked when there is nothing in it to walk on. (None exist in the retail archives.)
{
  const f = parseFloor(floorFile('0006', { tris: new W().i32(0).bytes() }));
  ok(f.triangles.length === 0 && f.vertices.length === 6, 'a floor with no triangles reads without complaint');
  const { block } = floorBlock(f, { flipX: true, links: LINKS });
  ok(block.floor === undefined, 'and is not carried as a floor');
  ok(block.graph !== undefined, 'though its path graph still is');
}

// The graph on its own, for a pack that does not want the triangles.
{
  const f = parseFloor(floorFile('0006'));
  const { block } = floorBlock(f, { flipX: true, links: LINKS, mesh: false });
  ok(block.floor === undefined && block.graph !== undefined, 'graph only: no mesh in the block, and the graph is still there');
}

// A triangle's three per-edge portal ids index the cell's own link list and become
// `def.cells[i].portals[p]` in the game, so one past the end is an index into nothing. It is
// checked against the same links the doorway nodes are, and carried as no portal rather than
// passed on. (On the retail archives it never fires: 14,569 portal edges over 274 buildings, none
// out of range under this reading -- which is also why the range test settles nothing about which
// list they index, and the reading rests on where the edge lies instead.)
{
  const f = parseFloor(floorFile('0006'));
  const { block, notes } = floorBlock(f, { flipX: true, links: [{ geometry: 7, target: 2 }] });
  ok(notes.some((n) => /named a portal link this cell has not got/.test(n)), 'a triangle edge naming a link the cell has not got is reported');
  ok(block.floor!.t[37] === -1, 'and is carried as no portal');
  ok(block.floor!.t.every((v, i) => i % 10 < 6 || i % 10 > 8 || v < 1), 'and every portal id that survives is one the cell really lists');
}

// A doorway node naming a portal this cell does not list is carried as no portal and said out loud.
{
  const f = parseFloor(floorFile('0006'));
  const { block, notes } = floorBlock(f, { flipX: true, links: [{ geometry: 7, target: 2 }] });
  ok(notes.some((n) => /named a portal this cell does not list/.test(n)), 'a node naming a portal the cell has not got is reported');
  ok(block.graph!.n[14] === -1, 'and is carried as no portal rather than as a number that means nothing');
}

// Rounding is a choice a caller can make, and the floor block says which version wrote it.
{
  const f = parseFloor(floorFile('0006'));
  const { block } = floorBlock(f, { flipX: true, links: LINKS, places: 1 });
  ok(block.floor!.v[13] === 0.3, 'the number of decimals is the caller\'s');
  ok(FLOOR_PACK_VERSION === 1, 'the pack version the converter stamps on floors.json');
}

console.log(`\n${passed} checks passed`);
