// The ship terminal: what your own ship will do for you from where you are standing.
//
// This is the other half of travel, and unlike the shuttle it is **yours**. The game placed a
// `terminal_space` in its starports -- 130 of them over the ten ground worlds, every one of them
// inside a building and every one at a real place in the snapshot -- and what it was for was the
// player's own ship: launching it, and flying it where a shuttle would otherwise take you.
//
// So a ship terminal offers exactly two things, and neither of them is a shuttle:
//
//   - **fly to a starport on this world**, which lands your own ship on that starport's pad; and
//   - **launch into this world's orbit**, where the world has one.
//
// Both are free, because it is your ship and nobody is selling you a seat on it, and both need a
// ship. That is the whole difference from the shuttle beside it: a shuttle has a timetable, a fare,
// a ticket and a collector, and your own ship has none of those and never did.
//
// **A shuttleport has no ship terminal**, which is the game's own arrangement rather than a rule
// invented here: the terminals are placed objects and the world's own snapshot is what says where
// they stand. Nothing here decides that; it is answered by what is near the player.
//
// Pure: no three, no fetch, no DOM. Rule for this file (node runs it with type stripping for the
// tests): relative imports only as `import type`, no enum, no namespace, no constructor parameter
// properties.

import type { Port } from './shuttle.ts';

/**
 * The id the orbit trip carries, which is not a port's name.
 *
 * It is spelt with a character no place name can hold, so a world that ever names a starport
 * "orbit" still cannot be mistaken for the sky over it.
 */
export const SHIP_TRIP_ORBIT = '\u0000orbit';

/** The templates the game places a ship terminal under. */
export const SHIP_TERMINAL_TEMPLATES: ReadonlySet<string> = new Set([
  'object/tangible/terminal/shared_terminal_space.iff',
  'object/tangible/terminal/terminal_space.iff',
]);

/** Every number of the ship terminal that is ours. Live through `__debug.terminal`. */
export const SHIP_TERMINAL_TUNE = {
  /**
   * How near one you have to stand to use it, metres.
   *
   * Tighter than the shuttle's forty, and deliberately so: a shuttleport's reach is "you are at the
   * port", while this is "you are at that terminal", and a starport stands several of them in a row
   * a few metres apart.
   */
  reach: 4,
};

/** Something a ship terminal will do for you. */
export interface ShipTrip {
  /** A starport on this world, or this world's orbit. */
  kind: 'port' | 'orbit';
  /** What to call it on the panel. */
  name: string;
  /** A port: where the ship lands, in the world's own frame. */
  to?: { x: number; z: number };
  /** How far off it is, metres, for a port. */
  away?: number;
  /** Why it cannot be taken, or empty. */
  why: string;
}

/** What a ship terminal knows about the player, so the rules can be tried with no game at all. */
export interface ShipTerminalState {
  /**
   * Whether a ship can be flown from here at all.
   *
   * It is the game's own answer and not a new idea of ownership: arriving in space puts you in the
   * ship last flown, else the fitted one last stood out, else an X-wing, so a character always has
   * one. A build with no garage converted has none, which is what this is false for.
   */
  hasShip: boolean;
  /** The zone this world's sky leads to, or null where it leads nowhere. */
  orbit: string | null;
  /** What to call that zone. */
  orbitName: string;
  /** Whether the player is in a state to fly at all (not dead, not already flying, not aboard). */
  canFly: boolean;
  /** Why not, if not. */
  whyNot: string;
}

/**
 * Everywhere a ship terminal will send you from `from`.
 *
 * Only **starports** are offered: a ship lands on a starport's pad, and a shuttleport is a shelter
 * with a bench. That is the same division the packs already name the two kinds apart for, and the
 * same one `ridesFrom` uses to decide which ports can leave the world.
 *
 * A trip that cannot be taken is **listed with its reason** rather than left out, because a player
 * who owns no ship should be told that is why the list is empty rather than shown an empty list.
 */
export function shipTripsFrom(from: Port, ports: readonly Port[], state: ShipTerminalState, near = 5): ShipTrip[] {
  const why = !state.hasShip ? 'you have no ship' : !state.canFly ? state.whyNot || 'not from here' : '';
  const out: ShipTrip[] = [];
  for (const p of ports) {
    if (p.kind !== 'starport') continue;
    const away = Math.hypot(p.x - from.x, p.z - from.z);
    if (away <= near) continue;
    out.push({ kind: 'port', name: p.name, to: { x: p.x, z: p.z }, away, why });
  }
  out.sort((a, b) => (a.away ?? 0) - (b.away ?? 0));
  if (state.orbit) out.unshift({ kind: 'orbit', name: state.orbitName || 'orbit', why });
  return out;
}

/** What the panel says under the list when there is nothing on it, or nothing that can be taken. */
export function shipTripsNote(trips: readonly ShipTrip[], state: ShipTerminalState): string {
  if (!state.hasShip) return 'this terminal is for your own ship, and this build has no ships converted';
  const blocked = trips.find((t) => t.why);
  if (blocked) return blocked.why;
  if (!trips.length) return 'nowhere on this world for a ship to land, and no orbit above it';
  return 'your own ship, and nothing to pay: it is yours';
}
