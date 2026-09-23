// Floor meshes (.flr): the walkable triangles the client authored for every cell of a portal
// building, in the cell's own frame, with the node graph it walked them by. The cell names the
// file; `pob.mjs` already reads that name and this reads what it points at.
//
//   FORM FLOR > FORM 000N
//     VERT        the vertices, three float32 each
//     TRIS        the triangles, 60 bytes each
//     FORM BTRE   a search tree over the triangles (NODS, 40 bytes a node): rebuilt at run time by
//                 anything that wants one, so it is not read here
//     BEDG        the boundary edges, 9 bytes each
//     FORM PGRF > FORM 0001   META, PNOD, PEDG, ECNT, ESTR: the node graph
//
// From 0006 on, VERT and TRIS begin with an int32 count; 0003, 0004 and 0005 write the records
// straight to the end of the chunk. The record itself never changed: all 1,013 older files in the
// retail archives parse with the same 60 bytes, every triangle's own index matching its place,
// every corner and neighbour in range, every normal a unit vector but eight degenerates, so the
// only thing the older versions cost is the count. `arrayIn` tells the two apart by the chunk's
// length, which is 4 more than a whole number of records when the count is there.
//
// A 60-byte TRIS record, every field of it checked against all 499,007 retail 0006 triangles:
//   +0   int32 corner[3]     indices into VERT, wound so (b-a) x (c-a) points up (497,972 of them;
//                            the rest are degenerate). The stored normal is the other way round.
//   +12  int32 index         the triangle's own index; matched its place 499,007 times of 499,007
//   +16  int32 neighbour[3]  the triangle across edge k (corner k to corner k+1), or -1
//   +28  float normal[3]     the plane normal, pointing the opposite way to the winding
//   +40  uint8 crossable[3]  may edge k be walked over. Every edge with a neighbour is non-zero
//                            (1,323,919 of 1,323,919); of the 173,102 edges with none, 20,082 are
//                            (a doorway, or a step across to another part of the same floor). 904
//                            of those carry 2 rather than 1, always on an edge with no neighbour
//                            and no portal, and what the client made of the difference is not known
//                            -- anything non-zero is read as crossable here.
//   +43  uint8              set on 17,440 triangles (3.5%). Not the boundary, not a slope, not a
//                            portal: undecoded, and not carried into the pack.
//   +44  int32 part          which connected piece of this mesh the triangle is in: constant over
//                            every piece in 307 of the 313 files that use more than one value.
//                            Derivable from the neighbours, so it is not carried either.
//   +48  int32 portal[3]     edge k leads out through the cell's portal link of that index, else -1.
//                            Set on 14,569 edges over 274 of the 281 retail portal objects, every
//                            one of them an edge with no neighbour that is also marked crossable.
//                            *Which* list it indexes cannot be settled by a range test: both the
//                            cell's own link list and the building's whole portal list are in range
//                            on all 14,569, so the test that settles it is where the edge lies.
//                            Measured as the distance from the edge's midpoint to the polygon each
//                            reading names: as the cell's own link the median is 0.00 m and the
//                            90th 0.03 m (the edge is ON the doorway); as the building's portal the
//                            median is 91.83 m. The two name a different polygon on 13,327 edges
//                            and the cell reading is the nearer on all 13,327, the building reading
//                            on none. The cell reading's tail is 1.79 m at the 99th and 19.69 m at
//                            worst, 209 edges past 1.5 m.
//
// A 32-byte PNOD record: int32 index, int32 (-1 on all 30,610), int32 portal, int32 type, three
// float32 position, float32 radius. Type 1 is an ordinary node, radius 0.5, portal -1; type 0
// stands in a doorway with radius 0, and its `portal` is the *building's* portal index -- which is
// the `geometry` field of one of the cell's own links, matched on 14,197 of 14,197 nodes. The
// converter turns it into the cell's own link index so that one word means one thing in the pack.
//
// A 16-byte PEDG record: int32 from, int32 to, int32 (0 on all 69,006), float32 (0 on all 69,006).
// Every edge is stored both ways (69,006 of 69,006), so the adjacency is rebuilt from PEDG and the
// ECNT/ESTR pair -- a per-node count and start into PEDG -- is not read: it is a clean index on
// 2,744 of the 3,285 retail graphs and off on 541, and in every one of those 541 the mismatch is a
// start written for a node with no edges at all, so nothing is lost by ignoring it.
//
// Where the graph lives moved with the version, and the only reason to care is that reporting it
// honestly means looking in the right place. Counted over all 4,589 retail floors: 0006 has a
// `FORM PGRF` with a version form inside on 3,285 of 3,576 and no graph at all on 291; 0005 the
// same on 240 of 366, none on 126; 0003 has none on all 470; and **0004 keeps PNOD and PEDG as
// chunks of the floor's own version form with no `FORM PGRF` at all** on all 177, 154 of them with
// an empty PNOD (no nodes) and 23 with 37-byte records this reader does not decode. Not one of the
// 4,589 writes PGRF's chunks bare, and not one 0004 PNOD would be mistaken for 32-byte records.
// A floor that is read and has no graph is ordinary: 17 of the 3,332 the game's cells name.
import { childrenOf, isForm } from './iff.mjs';

/** What a pack's floors.json says about itself, so the game can tell an old shape from a new one. */
export const FLOOR_PACK_VERSION = 1;

const TRI = 60;
const NODE = 32;
const EDGE = 16;

/** Where a chunk's records start and how many there are: a leading int32 count, or straight in. */
function arrayIn(data, stride) {
  if (!data) return null;
  if (data.length % stride === 0) return { start: 0, count: data.length / stride };
  if (data.length >= 4 && (data.length - 4) % stride === 0) {
    const n = data.readInt32LE(0);
    if (n === (data.length - 4) / stride) return { start: 4, count: n };
  }
  return null;
}

function chunk(form, tag) {
  const c = (form.children ?? []).find((x) => !isForm(x) && x.tag === tag);
  return c ? c.data : null;
}

/**
 * Read a floor file. Returns { version, vertices, triangles, graph, warnings }, all of it in the
 * cell's own frame and untouched: no flip, no rounding, no reordering.
 *   vertices   [[x, y, z], ...]
 *   triangles  [{ corners: [a, b, c], neighbours: [n0, n1, n2], crossable: [c0, c1, c2],
 *                 portals: [p0, p1, p2] }, ...]   edge k runs from corner k to corner k+1
 *   graph      { nodes: [{ portal, type, position: [x, y, z] }, ...], edges: [[a, b], ...] } | null
 */
export function parseFloor(root) {
  if (!isForm(root) || root.type !== 'FLOR') throw new Error(`Not a floor mesh (got ${root.type ?? root.tag})`);
  const form = root.children.find(isForm);
  if (!form) throw new Error('FLOR without a version form');
  const version = form.type;
  const warnings = [];

  const vd = chunk(form, 'VERT');
  const vRange = arrayIn(vd, 12);
  if (!vRange) throw new Error(`FLOR ${version}: VERT is ${vd ? `${vd.length} bytes, not a whole number of vertices` : 'missing'}`);
  const vertices = [];
  for (let i = 0; i < vRange.count; i++) {
    const o = vRange.start + i * 12;
    vertices.push([vd.readFloatLE(o), vd.readFloatLE(o + 4), vd.readFloatLE(o + 8)]);
  }

  const td = chunk(form, 'TRIS');
  const tRange = arrayIn(td, TRI);
  if (!tRange) throw new Error(`FLOR ${version}: TRIS is ${td ? `${td.length} bytes, not a whole number of triangles` : 'missing'}`);
  const triangles = [];
  let badCorner = 0;
  let badNeighbour = 0;
  const walledOff = new Set();
  for (let t = 0; t < tRange.count; t++) {
    const o = tRange.start + t * TRI;
    const corners = [td.readInt32LE(o), td.readInt32LE(o + 4), td.readInt32LE(o + 8)];
    const neighbours = [td.readInt32LE(o + 16), td.readInt32LE(o + 20), td.readInt32LE(o + 24)];
    const crossable = [td[o + 40] !== 0, td[o + 41] !== 0, td[o + 42] !== 0];
    const portals = [td.readInt32LE(o + 48), td.readInt32LE(o + 52), td.readInt32LE(o + 56)];
    // No retail triangle is out of range either way, but a reader that hands one on gives whatever
    // walks these floors an index into nothing. A bad neighbour becomes no neighbour; a triangle
    // with a bad corner is not the room's shape at all and is walled off.
    let walled = false;
    for (let k = 0; k < 3; k++) {
      if (corners[k] < 0 || corners[k] >= vertices.length) {
        badCorner++;
        corners[k] = 0;
        walled = true;
      }
      if (neighbours[k] < -1 || neighbours[k] >= tRange.count) {
        badNeighbour++;
        neighbours[k] = -1;
      }
    }
    if (walled) {
      walledOff.add(t);
      crossable[0] = crossable[1] = crossable[2] = false;
      portals[0] = portals[1] = portals[2] = -1;
    }
    triangles.push({ corners, neighbours, crossable, portals });
  }
  // Clearing a triangle's own three flags walls nothing off. Crossing an edge is decided from the
  // flag of the triangle being *left*, and every retail edge that has a neighbour is crossable
  // (1,323,919 of 1,323,919), so every neighbour would still lead straight in and a body that
  // stepped on could never step off again -- a trap, which is worse than the gap. The way in is
  // therefore shut from the other side too, which is the only thing that makes it a wall.
  if (walledOff.size) {
    for (const tri of triangles) {
      for (let k = 0; k < 3; k++) {
        if (!walledOff.has(tri.neighbours[k])) continue;
        tri.crossable[k] = false;
        tri.neighbours[k] = -1;
      }
    }
  }
  if (badCorner) warnings.push(`${badCorner} corner index/indices outside the vertex list; ${walledOff.size} triangle(s) walled off, from both sides`);
  if (badNeighbour) warnings.push(`${badNeighbour} neighbour index/indices outside the triangle list, read as no neighbour`);

  let graph = null;
  // The graph's chunks are inside a `FORM PGRF`'s own version form on 0005 and 0006, and are
  // chunks of the floor's version form itself on 0004, which writes no PGRF at all. Looking only
  // inside a PGRF left the report below unreachable on every file in the archives: `pgrf` was
  // undefined for all 177 of them and the whole block was stepped over in silence.
  const pgrf = childrenOf(form, 'PGRF')[0];
  const holder = (pgrf ? pgrf.children.find(isForm) : null) ?? pgrf ?? form;
  const nd = chunk(holder, 'PNOD');
  const ed = chunk(holder, 'PEDG');
  const nRange = arrayIn(nd, NODE);
  const eRange = arrayIn(ed, EDGE);
  if (nRange && nRange.count) {
    const nodes = [];
    for (let i = 0; i < nRange.count; i++) {
      const o = nRange.start + i * NODE;
      nodes.push({
        portal: nd.readInt32LE(o + 8),
        type: nd.readInt32LE(o + 12),
        position: [nd.readFloatLE(o + 16), nd.readFloatLE(o + 20), nd.readFloatLE(o + 24)],
      });
    }
    const edges = [];
    let badEdge = 0;
    if (eRange) {
      for (let i = 0; i < eRange.count; i++) {
        const o = eRange.start + i * EDGE;
        const a = ed.readInt32LE(o);
        const b = ed.readInt32LE(o + 4);
        if (a < 0 || a >= nodes.length || b < 0 || b >= nodes.length || a === b) badEdge++;
        else edges.push([a, b]);
      }
    }
    if (badEdge) warnings.push(`${badEdge} graph edge(s) naming a node that is not there`);
    // A graph with nodes and no edges is ordinary (287 of the 3,520 retail graphs are one), so it
    // is not reported -- but an unreadable PEDG would come out looking exactly like one, and every
    // retail PEDG is a whole number of 16-byte records, so the one case that is not is said.
    if (ed && ed.length && !eRange) warnings.push(`FLOR ${version}: graph edges that are not ${EDGE}-byte records (PEDG is ${ed.length} bytes), left out`);
    graph = { nodes, edges };
  } else if (nd && nd.length && !nRange) {
    // 0004's own graph layout: 37-byte node records with no count in front, not 32. The mesh is
    // read and the graph is left out -- but said out loud, so a floor whose graph this could not
    // decode is never mistaken for one of the 17 that genuinely have none. 23 of the 177 retail
    // 0004 files are this. An empty PNOD is the other case and says nothing, because there is
    // nothing there to say: 154 of the 177 write a zero-length chunk and five 0005 files write a
    // four-byte one holding the count 0, and both read as a graph with no nodes.
    warnings.push(`FLOR ${version}: a path graph whose nodes are not ${NODE}-byte records (PNOD is ${nd.length} bytes), left out`);
  }
  return { version, vertices, triangles, graph, warnings };
}

const round = (v, places) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

/**
 * One cell's floor as the pack carries it, flat arrays of plain numbers so that the file stays
 * readable and compresses as text.
 *
 *   floor.v   x, y, z a vertex, in the model's frame (X already flipped with the meshes)
 *   floor.t   ten numbers a triangle: three corners, three neighbours (-1 for none), three portal
 *             link indices (-1 for none) and a three-bit mask of which edges may be crossed
 *             (bit k is edge k, corner k to corner k+1)
 *   graph.n   five numbers a node: x, y, z, type (1 ordinary, 0 standing in a doorway) and the
 *             cell's portal link index for a doorway node, -1 otherwise
 *   graph.e   two node indices an edge; the file stores each edge both ways and so does this
 *
 * `flipX` mirrors X as the meshes are mirrored, which reverses a triangle's winding, so the corners
 * are re-ordered (a, c, b) and everything hanging on an edge is permuted with them (2, 1, 0).
 * `links` is the cell's own portal list. It turns a doorway node's building-wide portal number
 * into the cell's own link index, so that "portal" means one thing throughout the pack, and it is
 * what a triangle's three per-edge portal ids are checked against: they become
 * `def.cells[i].portals[p]` in the game, so one past the end is an index into nothing.
 */
export function floorBlock(floor, { flipX = true, links = [], places = 3, mesh = true } = {}) {
  const notes = [];
  const sx = flipX ? -1 : 1;
  const out = {};
  let badPortal = 0;
  // A mesh with no triangles is no floor: written as a block it would tell a reader that this cell
  // can be pathed when there is nothing in it to path over. None exist in the retail archives.
  if (mesh && floor.triangles.length) {
    const v = new Array(floor.vertices.length * 3);
    for (let i = 0; i < floor.vertices.length; i++) {
      const p = floor.vertices[i];
      v[i * 3] = round(sx * p[0], places);
      v[i * 3 + 1] = round(p[1], places);
      v[i * 3 + 2] = round(p[2], places);
    }
    const t = new Array(floor.triangles.length * 10);
    for (let i = 0; i < floor.triangles.length; i++) {
      const tri = floor.triangles[i];
      const order = flipX ? [0, 2, 1] : [0, 1, 2];
      const edge = flipX ? [2, 1, 0] : [0, 1, 2];
      const o = i * 10;
      for (let k = 0; k < 3; k++) {
        t[o + k] = tri.corners[order[k]];
        t[o + 3 + k] = tri.neighbours[edge[k]];
        const p = tri.portals[edge[k]];
        if (p >= links.length) {
          badPortal++;
          t[o + 6 + k] = -1;
        } else t[o + 6 + k] = p < 0 ? -1 : p;
      }
      t[o + 9] = (tri.crossable[edge[0]] ? 1 : 0) | (tri.crossable[edge[1]] ? 2 : 0) | (tri.crossable[edge[2]] ? 4 : 0);
    }
    if (badPortal) notes.push(`${badPortal} doorway edge(s) named a portal link this cell has not got, carried as none`);
    out.floor = { v, t };
  }
  if (floor.graph && floor.graph.nodes.length) {
    const n = new Array(floor.graph.nodes.length * 5);
    let unmatched = 0;
    for (let i = 0; i < floor.graph.nodes.length; i++) {
      const nd = floor.graph.nodes[i];
      const o = i * 5;
      n[o] = round(sx * nd.position[0], places);
      n[o + 1] = round(nd.position[1], places);
      n[o + 2] = round(nd.position[2], places);
      n[o + 3] = nd.type;
      let link = -1;
      if (nd.portal >= 0) {
        link = links.findIndex((l) => l.geometry === nd.portal);
        if (link < 0) unmatched++;
      }
      n[o + 4] = link;
    }
    if (unmatched) notes.push(`${unmatched} doorway node(s) named a portal this cell does not list`);
    const e = new Array(floor.graph.edges.length * 2);
    for (let i = 0; i < floor.graph.edges.length; i++) {
      e[i * 2] = floor.graph.edges[i][0];
      e[i * 2 + 1] = floor.graph.edges[i][1];
    }
    out.graph = { n, e };
  }
  return { block: out, notes };
}

/** Totals for a run's summary line. */
export function floorSize(floor) {
  return {
    vertices: floor.vertices.length,
    triangles: floor.triangles.length,
    nodes: floor.graph ? floor.graph.nodes.length : 0,
    edges: floor.graph ? floor.graph.edges.length : 0,
  };
}
