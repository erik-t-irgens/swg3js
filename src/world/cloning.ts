// Where you come back after dying: the facilities the world already places, found by the object
// template the snapshot carries for every one of them, offered nearest first with the distance from
// where you fell, and the room inside each to stand up in.
//
// The rule is here rather than in the world or the page because it is the whole of the decision and
// it can then be tried by itself: nothing in this file touches three, the physics, the page or a
// pack on disk, so the node test runs the rule and not a mirror of it, and the game's own paths call
// these functions rather than keeping a second copy of them (`LayoutStreamer.namedEntryOf` picks a
// cell with `namedCellIndex`; the card's distances are the interface's own words). What each
// facility is called comes from the pack's own list of named places (the map's), which is handed in;
// a facility with no named place near it is offered under a plain word instead.
//
// Which list a world's own server offered, and in what order, was the server's and did not ship, so
// every number below is ours and says so.

/** A placed object as the streamer holds it: enough to find a facility and measure it. */
export interface PlacedLike {
  template: string;
  x: number;
  y: number;
  z: number;
  contained?: boolean;
}

/** A named place from a pack's own list, in the same frame as the placed objects. */
export interface NamedPlace {
  name: string;
  x: number;
  z: number;
  /** How far the place reaches, where the list says; 0 or absent for a point. */
  r?: number;
}

/** A cell of a portal building, as the pack's manifest lists it. */
export interface CellLike {
  index: number;
  name: string;
}

/** One row of the death card. */
export interface FacilityChoice {
  /** Where it stands, in the world's own frame (what the streamer holds). */
  x: number;
  y: number;
  z: number;
  /** The object template, which is how the streamed building is found again. */
  template: string;
  /** What to call it: the named place it stands in, else the plain word. */
  name: string;
  /** Metres from where the player fell, measured on the ground plane. */
  d: number;
}

/**
 * Ours, every one of them. The client's own choice of where the dead come back was the server's and
 * is in none of the archives, so this is a reading of what the world itself places and nothing more.
 */
export const CLONING_TUNE = {
  /** How many facilities the card offers. A short list to read at a glance, not a directory. */
  shown: 6,
  /** How near a named place with no reach of its own must be for a facility to take its name. */
  placeRange: 500,
  /**
   * The most of a named place's own reach that may claim a facility. A region row can cover a
   * quarter of a world, and a facility named for the continent it is on tells nobody anything.
   */
  placeMaxReach: 1500,
  /** What a facility with no named place near it is called. */
  unnamed: 'Cloning facility',
};

/**
 * The mark in an object template that says "the dead come back here": the whole word `cloning`,
 * between separators rather than anywhere in the path, and only under the world's own buildings.
 *
 * Two tests, and each earns its place. The folder is what keeps the tubes, the signs, the floor
 * terminals and the tents out: those are scenery standing beside a facility, and the game places
 * them under its static furniture rather than its buildings. The whole word is what keeps the lava
 * world's mining marker post out: a post carries the word in its other form (`clone`, in a compound)
 * and is not a building anybody comes round inside -- it has no rooms at all, which is how it was
 * found. So nothing here is a list of the templates that happen to be on the worlds converted today:
 * the rule is the shape of the name, and a world converted later is read by the same rule.
 *
 * Measured over every converted pack on this machine: forty-three placed objects match and every one
 * of them is a building with rooms, so there is always somewhere to put the player. Thirty-six stand
 * on the ten played worlds and the other seven in the showroom pack, which is a world of this game's
 * own that can be stood and died on like any other. Everything else in any pack that carries the
 * word in either form -- the vessels, the signs, the floor terminals, the tents and the marker post
 * -- is refused, and the lava world is left with none, which is the fallback the card wants.
 */
const FACILITY_WORD = /(?:^|[^a-z])cloning(?:[^a-z]|$)/i;

/** Whether an object template is one of the world's own facilities. */
export function isCloningFacility(template: string): boolean {
  if (!template || !template.includes('/building/')) return false;
  return FACILITY_WORD.test(template);
}

/**
 * What to call a spot: the nearest named place that reaches it, or null. A place with a reach of its
 * own is believed up to `placeMaxReach`; one with none reaches `placeRange`.
 */
export function placeNameAt(x: number, z: number, places: readonly NamedPlace[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const p of places) {
    if (!p || !p.name) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= bestD) continue;
    const reach = p.r && p.r > 0 ? Math.min(p.r, CLONING_TUNE.placeMaxReach) : CLONING_TUNE.placeRange;
    if (d > reach) continue;
    bestD = d;
    best = p.name;
  }
  return best;
}

/**
 * The facilities this world places, nearest the point given first. The distance is measured on the
 * ground plane, as every other "near me" in the game is: a facility two floors down in the same town
 * is not farther away than one across the valley.
 */
export function facilitiesNear(
  objects: readonly PlacedLike[],
  from: { x: number; z: number },
  places: readonly NamedPlace[] = [],
  limit: number = CLONING_TUNE.shown,
): FacilityChoice[] {
  const out: FacilityChoice[] = [];
  for (const o of objects) {
    if (o.contained || !isCloningFacility(o.template)) continue;
    out.push({
      x: o.x,
      y: o.y,
      z: o.z,
      template: o.template,
      name: placeNameAt(o.x, o.z, places) ?? CLONING_TUNE.unnamed,
      d: Math.hypot(o.x - from.x, o.z - from.z),
    });
  }
  out.sort((a, b) => a.d - b.d);
  return limit > 0 ? out.slice(0, limit) : out;
}

/**
 * The room to stand the dead up in, where a facility has one.
 *
 * The **word** is the archive's: the purpose-built facilities carry a cell their own layout names
 * `spawn`, and eighteen of the thirty-six on the played worlds do. What it is *for* is **ours**: the
 * word is a general-purpose room name in the client's layouts and nothing in the archives ties it to
 * the dead. Measured over every converted pack, five of the models actually placed on the worlds
 * carry a cell of that name and only four of them are facilities; the fifth is an ordinary structure
 * standing fifty-five times over nine of the played worlds and the showroom, and nobody comes back
 * to life in it. So this is a reading -- a room of that name *inside a cloning facility* is where we
 * stand somebody up -- and the buildings with no such room use their way in instead, which is what
 * the rest of the game already does for a doorless building.
 */
export const SPAWN_CELL_NAME = 'spawn';

/**
 * The index of a building's room of that name, or 0 where it has none. The shell is cell 0 and is
 * never a room to stand in whatever it is called, the name is compared as a name (trimmed, in one
 * case, and through `String` so a manifest that ever carries something other than a string is a
 * miss rather than a thrown TypeError in the middle of a respawn), and 0 is the caller's cue to fall
 * back on the building's way in.
 *
 * This is the whole of the pick: `LayoutStreamer.namedEntryOf` calls it, so the rule the node test
 * runs is the rule the game runs.
 */
export function namedCellIndex(cells: readonly CellLike[] | undefined, name: string): number {
  if (!cells) return 0;
  const wanted = String(name).trim().toLowerCase();
  if (!wanted) return 0;
  for (const c of cells) {
    if (c.index > 0 && String(c.name).trim().toLowerCase() === wanted) return c.index;
  }
  return 0;
}
