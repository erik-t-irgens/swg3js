// Where a world brings a player in and back when nothing else says: a place the world's own definition names
// (`PlanetDef.arrival`), turned into the game's frame from the world's own places file.
//
// Mustafar is the one world that names one. Its layout centre, where every other world's arrival is looked for
// (`World.spawnPoint`, the flattest dry spot within 200 m of it), is wilderness 5.3 km from the Mensix Mining
// Facility and among SOE's own aggressive people, and Mustafar has no cloning facility, so a death came round
// there as well. The facility's landing deck is where the game brought a visitor in: cell 0's own floor of
// `thm_must_mining_outpost`, 1,510 square metres at a height of 230.06, measured in fix round 2 off
// `floors.json`. The deck hangs about 125 m over the generated terrain, whose height under its middle is 104.8
// (98.5 to 122.6 under its edges), so an arrival there is stood at its own height and never lifted to, or dropped
// onto, the ground.
//
// The arithmetic is the teleport's own (`placeFromPois`): a raw place is mirrored in x about the layout centre the
// places file carries, `x = -(raw.x - centre.x)`, `z = raw.z - centre.z`; the height is absolute, as a placement
// row's is. A heading is in the game's frame, a body facing `(sin h, cos h)`.
//
// Rule for this file (node runs it with type stripping for the tests): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties.

import type { WorldArrival } from '../data/planets.ts';

export type { WorldArrival };

/** A world's arrival in the game's frame: where to stand and which way to face (null: as an arrival always has). */
export interface ArrivalPlace {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number | null;
  /** A room to stand in once its building is in (`WorldArrival.room`), else absent: the place itself is where to stand. */
  readonly room?: WorldArrival['room'];
}

/** The arrival in the game's frame, from the layout centre the world's places file carries. */
export function arrivalInGame(a: WorldArrival, centre: { readonly x: number; readonly z: number }): ArrivalPlace {
  return { x: -(a.raw.x - centre.x), y: a.y, z: a.raw.z - centre.z, heading: typeof a.heading === 'number' && Number.isFinite(a.heading) ? a.heading : null, ...(a.room ? { room: a.room } : {}) };
}

/**
 * Which building a room arrival stands in, of those standing (`template` theirs, or the template a permanent row of ours
 * stands as): the one of the arrival's template nearest its place, within `reach` metres. Pure, so the node test asks it.
 */
export function arrivalBuilding<T extends { readonly x: number; readonly z: number; readonly template: string; readonly object?: { readonly effectsOf?: string } | null }>(
  buildings: Iterable<T>,
  place: { readonly x: number; readonly z: number },
  template: string,
  reach = ARRIVAL_ROOM_REACH,
): T | null {
  let best: T | null = null;
  let bestD = reach;
  for (const b of buildings) {
    if (b.template !== template && b.object?.effectsOf !== template) continue;
    const d = Math.hypot(b.x - place.x, b.z - place.z);
    if (d > bestD) continue;
    bestD = d;
    best = b;
  }
  return best;
}

/**
 * How far from a room arrival's own place its building may stand and still be the one meant, metres: a room's middle
 * stands within its building's own reach of the building's origin (Echo Base's Main Hangar is 600 m from the base's own),
 * and the next copy of a heroic stands kilometres off. Ours.
 */
export const ARRIVAL_ROOM_REACH = 1500;

/**
 * Whether a port's own place on a world (`kind` a starport's or a shuttleport's) comes out at the world's own arrival:
 * a world whose arrival says its port lands people there (`WorldArrival.port`, Mustafar's deck) and is a place, not a
 * room. A port's row in the places list stands at its building's origin, which on Mustafar is the mining facility's,
 * over the valley floor about 125 m under the landing deck: stood there on the ground, or in the facility's way in, a
 * player never reached the deck its transport lands on. Pure, so the node test asks it.
 */
export function portArrivesHome(planet: { readonly arrival?: WorldArrival; readonly space?: string; readonly zones?: readonly unknown[] }, kind: string): boolean {
  return (kind === 'starport' || kind === 'shuttleport') && hasOwnArrival(planet) && !!planet.arrival?.port && !planet.arrival.room;
}

/**
 * Whether a world brings a player in at its own arrival: one that names it, has ground (no space zone) and no zones
 * of its own (a zoned world's arrival would be one per zone, and none names one).
 */
export function hasOwnArrival(planet: { readonly arrival?: WorldArrival; readonly space?: string; readonly zones?: readonly unknown[] }): boolean {
  return !!planet.arrival && !planet.space && !planet.zones?.length;
}
