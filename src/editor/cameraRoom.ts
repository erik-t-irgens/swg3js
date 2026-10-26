// The world editor's camera room rule (DESIGN.md §2.2): a free camera flies through walls, and the streamer follows the
// player's room only by its portal crossings (`trackCell`), which a camera flown in through a wall never makes -- and
// which keeps a tracked room while the point is anywhere in its building's boxes, so a camera flown from one room through
// a wall into the next stays in the first. Room boxes alone will not do either: rooms overhang their hull, and the
// portal renderer, drawing from inside a room with no exit in sight, draws no world at all, so a camera taken to be in
// a room it is only beside blanks the outdoors.
//
// So while the editor is on, the room is re-decided every frame with no memory: of the streamed buildings near the
// camera, the smallest room whose box holds it **and whose own walkable floor (the cell's `.flr`) has a triangle under
// it within the box's height**. The walk is the streamer's (`LayoutStreamer.cameraRoomAt`); the floor test is this
// file's `floorUnder`, which the world is handed while the editor flies. A building whose pack carries no floors is taken
// by its box alone, and `editor().room` says so. Noclip, every player and every body keep the portals.
//
// The floor is read by the one reader of the format the game has (`navMesh.ts`'s `buildFloor`, which tells the
// converter's ten-number records from bare corners by the numbers themselves, never by the length: 30 numbers are both),
// once a floor and kept by its object, so a frame's ask reads typed arrays and makes nothing.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

import { buildFloor, type FloorSource, type NavFloor } from '../world/nav/navMesh.ts';

/** How far over a floor's surface the camera may be and still be over it, metres: anywhere up to the room's own top. */
const ABOVE = Infinity;

/** Each floor the camera has been over, read once by the nav's reader (null for one that does not read), by its object. */
const READ = new WeakMap<object, NavFloor | null>();

/**
 * Whether a cell's walkable floor (as the pack carries it, read by `buildFloor`) has a triangle under the point `x, y, z`
 * of the building's own frame, whose height there is at or under `y` and at or over `low` (the room box's floor, less a
 * pad). A floor that does not read has none; a triangle with no area in plan has no one height and is passed over.
 * Nothing is made past the first ask of a floor.
 */
export function floorUnder(floor: object, x: number, y: number, z: number, low: number): boolean {
  let f = READ.get(floor);
  if (f === undefined) {
    f = buildFloor(floor as FloorSource);
    READ.set(floor, f);
  }
  if (!f) return false;
  if (x < f.min[0] || x > f.max[0] || z < f.min[2] || z > f.max[2]) return false;
  const v = f.verts;
  const tris = f.tris;
  const boxes = f.boxes;
  for (let i = 0; i < f.count; i++) {
    // Its flat box first: four comparisons throw out all but a handful of a room's triangles.
    if (x < boxes[i * 4] || x > boxes[i * 4 + 2] || z < boxes[i * 4 + 1] || z > boxes[i * 4 + 3]) continue;
    const a = tris[i * 3] * 3;
    const b = tris[i * 3 + 1] * 3;
    const c = tris[i * 3 + 2] * 3;
    const ax = v[a];
    const ay = v[a + 1];
    const az = v[a + 2];
    const bx = v[b];
    const by = v[b + 1];
    const bz = v[b + 2];
    const cx = v[c];
    const cy = v[c + 1];
    const cz = v[c + 2];
    const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(det) < 1e-9) continue;
    const u = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / det;
    const w = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / det;
    if (u < -1e-6 || w < -1e-6 || u + w > 1 + 1e-6) continue;
    const h = ay + u * (by - ay) + w * (cy - ay);
    if (h <= y + 1e-3 && h >= low && y - h <= ABOVE) return true;
  }
  return false;
}

/** What `editor().room` says of a room answer: its building's model and room, or outside, and "by box" where no floor said. */
export function roomWords(a: { building: { model: { def: { id: string } } } | null; cell: number; byBox: boolean }): string {
  if (!a.building) return 'outside';
  return `${a.building.model.def.id} room ${a.cell}${a.byBox ? ' (by box: its pack carries no floors)' : ''}`;
}
