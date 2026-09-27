// Which streamed building a body stood where the data put it is in, when the data names its room.
//
// A standing person's row says which room of its building it stands in (the emulator's cell, turned
// into the room's index by the converter). `LayoutStreamer.buildingAt` cannot give that answer: it takes
// the smallest room box holding the point, and rooms overhang one another, so the box that reaches over
// a person at a cantina's bar is as often the corridor behind it. This takes the data's room instead:
// of the buildings near the point that have a room of that index, the one whose room's box holds the
// point, or lies within `ROOM_SLACK` of it (a place the converter carried out of the room's own frame
// and rounded), the nearest box winning where two buildings both have one.
//
// Pure of the streamer: it takes the buildings as it finds them, so a node test hands it two made up
// by hand. Three is imported for its matrix, which loads under node.
import * as THREE from 'three';

/** How far outside its room's box a person the data put in that room may stand and still be in it, metres. Ours. */
export const ROOM_SLACK = 2;

/** One room of a building as the pack carries it: its index and its box in the building's own frame. */
export interface RoomBox {
  index: number;
  bounds: { min: readonly number[]; max: readonly number[] };
}

/** A building as far as finding a room in it needs: where it stands, how far it reaches, the way into its own frame and its rooms. */
export interface RoomBuilding {
  x: number;
  z: number;
  radius: number;
  inverse: THREE.Matrix4;
  model: { def: { cells?: readonly RoomBox[] } };
}

/**
 * How far a point in the building's own frame lies outside a room's box, nought inside it. Taken
 * componentwise, whichever corner the pack wrote first (a mesh's BOX holds the larger corner first, and
 * a pack converted before that was read right carries the swap).
 */
export function offRoomBox(x: number, y: number, z: number, bounds: RoomBox['bounds']): number {
  const lo = bounds.min;
  const hi = bounds.max;
  const dx = Math.max(Math.min(lo[0], hi[0]) - x, 0, x - Math.max(lo[0], hi[0]));
  const dy = Math.max(Math.min(lo[1], hi[1]) - y, 0, y - Math.max(lo[1], hi[1]));
  const dz = Math.max(Math.min(lo[2], hi[2]) - z, 0, z - Math.max(lo[2], hi[2]));
  return Math.hypot(dx, dy, dz);
}

const local = new THREE.Vector3();

/**
 * The building near `pos` whose room `room` holds it, or null where none near has such a room within
 * `slack` of the point, which leaves the caller to ask for the smallest box instead. Room nought is a
 * building's outside and is no room. Allocates nothing.
 */
export function buildingWithRoomIn<B extends RoomBuilding>(buildings: Iterable<B>, pos: THREE.Vector3, room: number, slack = ROOM_SLACK): B | null {
  if (!(room > 0)) return null;
  let best: B | null = null;
  let bestOff = slack;
  for (const b of buildings) {
    if (Math.abs(b.x - pos.x) > b.radius + 4 || Math.abs(b.z - pos.z) > b.radius + 4) continue;
    const cells = b.model.def.cells;
    if (!cells) continue;
    let c: RoomBox | null = null;
    for (const cell of cells) {
      if (cell.index === room) {
        c = cell;
        break;
      }
    }
    if (!c) continue;
    local.copy(pos).applyMatrix4(b.inverse);
    const off = offRoomBox(local.x, local.y, local.z, c.bounds);
    if (off <= bestOff) {
      bestOff = off;
      best = b;
    }
  }
  return best;
}
