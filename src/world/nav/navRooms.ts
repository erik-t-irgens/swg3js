// Which way out of this room. The doorway polygons a portal building already carries are a
// room-to-room graph on their own: every cell lists the portals it owns, each portal names the cell
// on the other side, and the polygon itself says where the doorway is. Nothing here needs the floor
// meshes, so this half works against a pack converted long before they existed -- which is the
// whole of the fallback: with no floor a body still knows which doorway to head for, and walks at
// it in the straight line it always walked.
//
// Cell 0 is the world outside. A door with cell 0 on one side is a way out of the building.
//
// Pure: plain numbers in, plain numbers out, in the building's own model frame, so the node test
// draws a building by hand and checks the route.

/** The cells as the pack writes them; only these fields are read. */
export interface CellDef {
  index: number;
  name?: string;
  bounds: { min: number[]; max: number[] };
  portals?: { geometry: number; target: number; passable: boolean }[];
}

/** The doorway polygons as the pack writes them: vertices in model space, triangle indices. */
export interface PortalDef {
  v: number[][];
  i: number[];
}

export interface RoomDoor {
  /** Its index in the pack's portal list. */
  geometry: number;
  /** The two cells it joins, as the cells themselves list it. */
  a: number;
  b: number;
  passable: boolean;
  /** The polygon's middle, in the building's model frame. */
  x: number;
  y: number;
  z: number;
  /**
   * The flat part of the polygon's own normal, normalised, or (0, 0) for a doorway lying flat (a
   * hatch in a floor). Which side of it is which is not stored: `throughPoint` turns it away from
   * whichever room the body is standing in, because a doorway is crossed both ways.
   */
  nx: number;
  nz: number;
  /** Half the polygon's widest span: how wide the way through is, roughly. */
  half: number;
}

export interface RoomGraph {
  doors: RoomDoor[];
  /** Cell index to the doors that touch it. */
  byCell: Map<number, number[]>;
  /** Cell index to the middle of its box, which is where a route aims when nothing better is known. */
  centres: Map<number, { x: number; y: number; z: number }>;
  /** Every room's box, with the space it holds: a list, so saying which room a point is in walks it plainly. */
  boxes: { cell: number; min: number[]; max: number[]; volume: number }[];
  /**
   * The rooms that are lift shafts. A shaft's stops are its doorways and it has no floor at its
   * upper levels (`lifts.ts`), so its doorways are not a way from one storey to another for
   * anything that walks: a route may end at one and never passes through it.
   */
  shafts: Set<number>;
  /** The route search's working room, made with the graph and written over on every search. */
  work: { cost: Float64Array; first: Int32Array; done: Uint8Array };
}

/**
 * The room graph of one building. Unpassable doorways are kept but never routed through, and
 * neither are the rooms `isShaft` names (the lift shafts: see `shafts`).
 *
 * Cell 0 -- the world outside -- is routed **through**, on purpose: a body in one wing whose only
 * way to another is the front door and round is a body that should go out of the front door. It
 * costs the step door middle to door middle with no ground in between, which is a guess and named
 * as one; once the body is really outside there is no room and no mesh, `corner` answers nothing,
 * and it steers at its goal exactly as it does on any open ground.
 */
export function buildRoomGraph(cells: readonly CellDef[] | undefined, portals: readonly PortalDef[] | undefined, isShaft?: (cell: CellDef) => boolean): RoomGraph {
  const doors: RoomDoor[] = [];
  const byCell = new Map<number, number[]>();
  const centres = new Map<number, { x: number; y: number; z: number }>();
  const boxes: { cell: number; min: number[]; max: number[]; volume: number }[] = [];
  const shafts = new Set<number>();
  const seen = new Map<number, number>();
  for (const c of cells ?? []) {
    const { min, max } = c.bounds;
    if (c.index > 0 && isShaft?.(c)) shafts.add(c.index);
    centres.set(c.index, { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: (min[2] + max[2]) / 2 });
    if (c.index > 0) boxes.push({ cell: c.index, min, max, volume: Math.abs(max[0] - min[0]) * Math.abs(max[1] - min[1]) * Math.abs(max[2] - min[2]) });
    for (const link of c.portals ?? []) {
      const poly = (portals ?? [])[link.geometry];
      const already = seen.get(link.geometry);
      if (already !== undefined) {
        // The far cell lists the same polygon: it says nothing new but its own passability.
        if (!link.passable) doors[already].passable = false;
        continue;
      }
      if (!poly || !poly.v || poly.v.length < 3) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const v of poly.v) {
        x += v[0];
        y += v[1];
        z += v[2];
      }
      x /= poly.v.length;
      y /= poly.v.length;
      z /= poly.v.length;
      let half = 0;
      for (const v of poly.v) {
        const d = Math.hypot(v[0] - x, v[2] - z);
        if (d > half) half = d;
      }
      // The polygon's own normal, by Newell's method so a doorway of any number of corners and any
      // winding answers the same. Only its flat part is kept: what it is for is pushing a point
      // through the opening, and a body walks in x and z.
      let nx = 0;
      let nz = 0;
      for (let k = 0; k < poly.v.length; k++) {
        const p = poly.v[k];
        const q = poly.v[(k + 1) % poly.v.length];
        nx += (p[1] - q[1]) * (p[2] + q[2]);
        nz += (p[0] - q[0]) * (p[1] + q[1]);
      }
      const nl = Math.hypot(nx, nz);
      const door: RoomDoor = { geometry: link.geometry, a: c.index, b: link.target, passable: link.passable !== false, x, y, z, nx: nl > 1e-6 ? nx / nl : 0, nz: nl > 1e-6 ? nz / nl : 0, half };
      seen.set(link.geometry, doors.length);
      doors.push(door);
    }
  }
  for (let i = 0; i < doors.length; i++) {
    for (const cell of [doors[i].a, doors[i].b]) {
      const list = byCell.get(cell);
      if (list) list.push(i);
      else byCell.set(cell, [i]);
    }
  }
  return { doors, byCell, centres, boxes, shafts, work: { cost: new Float64Array(doors.length), first: new Int32Array(doors.length), done: new Uint8Array(doors.length) } };
}

/** The cell on the other side of a door from `cell`, or -1 when the door does not touch it. */
export function acrossFrom(door: RoomDoor, cell: number): number {
  if (door.a === cell) return door.b;
  if (door.b === cell) return door.a;
  return -1;
}

/**
 * The first doorway of the shortest way from one room to another, measured door middle to door
 * middle, or null when there is no passable way. Dijkstra over the doors rather than the cells,
 * because what a body wants back is a door and not a room; the biggest building in the game has a
 * few dozen of them, so the open set is scanned rather than heaped.
 */
export function nextDoor(graph: RoomGraph, from: number, to: number): RoomDoor | null {
  if (from === to) return null;
  const n = graph.doors.length;
  if (n === 0) return null;
  const { cost, first, done } = graph.work;
  cost.fill(Infinity);
  first.fill(-1);
  done.fill(0);
  const start = graph.byCell.get(from);
  if (!start) return null;
  const home = graph.centres.get(from);
  for (const i of start) {
    const d = graph.doors[i];
    if (!d.passable || acrossFrom(d, from) < 0) continue;
    cost[i] = home ? Math.hypot(d.x - home.x, d.z - home.z) : 0;
    first[i] = i;
  }
  for (;;) {
    let best = -1;
    for (let i = 0; i < n; i++) if (!done[i] && cost[i] < Infinity && (best < 0 || cost[i] < cost[best])) best = i;
    if (best < 0) break;
    done[best] = 1;
    const door = graph.doors[best];
    // A door is the node and two doors are neighbours when they share a room, which is the graph a
    // body really walks; both of this door's rooms are stepped into, and the one it was reached
    // through costs nothing to cross back, exactly as it would on the floor.
    if (door.a === to || door.b === to) return graph.doors[first[best]];
    if (!graph.shafts.has(door.a)) relax(graph, best, door.a, cost, first, done);
    if (!graph.shafts.has(door.b)) relax(graph, best, door.b, cost, first, done);
  }
  return null;
}

/** Every other door of one room, measured from the door just settled. Never allocates. */
function relax(graph: RoomGraph, best: number, cell: number, cost: Float64Array, first: Int32Array, done: Uint8Array): void {
  const list = graph.byCell.get(cell);
  if (!list) return;
  const door = graph.doors[best];
  for (const j of list) {
    if (j === best || done[j]) continue;
    const next = graph.doors[j];
    if (!next.passable) continue;
    const c = cost[best] + Math.hypot(next.x - door.x, next.z - door.z);
    if (c >= cost[j]) continue;
    cost[j] = c;
    first[j] = first[best];
  }
}

/**
 * Which room a point is in: the smallest cell box that holds it, or 0 for the world outside. The
 * rooms of a building are often larger than the hull around them and overlap each other, which is
 * why the smallest wins; a point in none of them is outside.
 */
export function cellOfPoint(graph: RoomGraph, x: number, y: number, z: number, pad: number = 0): number {
  let best = 0;
  let bestVol = Infinity;
  for (let i = 0; i < graph.boxes.length; i++) {
    const box = graph.boxes[i];
    const min = box.min;
    const max = box.max;
    if (x < min[0] - pad || x > max[0] + pad || y < min[1] - pad || y > max[1] + pad || z < min[2] - pad || z > max[2] + pad) continue;
    if (box.volume >= bestVol) continue;
    bestVol = box.volume;
    best = box.cell;
  }
  return best;
}

/**
 * Where a body aims to cross a doorway: its middle, pushed `through` metres out the far side.
 * Stopped at the doorway's own middle a body stands in the opening for ever, because the room it is
 * in only changes when its path crosses the polygon.
 *
 * Which way is "the far side" is the doorway's own normal, turned to point away from the middle of
 * the room the body is standing in. It is emphatically **not** the middle of the cell on the other
 * side: cell 0 is the exterior shell, whose box is the whole building, so for every way *out* of a
 * building that middle lies back inside the room the body is already in and the point came out
 * behind it -- a body walking out of a door aimed at a spot behind the door, reaching it, and
 * asking again for ever.
 *
 * A doorway lying flat has no flat normal, and a room whose middle sits on the doorway's own plane
 * says nothing about which side is which; both fall back to pushing away from that middle, which is
 * the same answer wherever it can be told apart.
 */
export function throughPoint(graph: RoomGraph, door: RoomDoor, fromCell: number, through: number, out: { x: number; y: number; z: number }): void {
  out.x = door.x;
  out.y = door.y;
  out.z = door.z;
  if (through <= 0) return;
  const near = graph.centres.get(fromCell);
  let dx = 0;
  let dz = 0;
  if (near && (door.nx !== 0 || door.nz !== 0)) {
    const side = (door.x - near.x) * door.nx + (door.z - near.z) * door.nz;
    if (Math.abs(side) > 1e-4) {
      dx = side > 0 ? door.nx : -door.nx;
      dz = side > 0 ? door.nz : -door.nz;
    }
  }
  if (dx === 0 && dz === 0) {
    if (!near) return;
    dx = door.x - near.x;
    dz = door.z - near.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    dx /= len;
    dz /= len;
  }
  out.x += dx * through;
  out.z += dz * through;
}
