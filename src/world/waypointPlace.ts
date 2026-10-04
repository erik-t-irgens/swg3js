// Where a waypoint's mark stands in the world, worked out a few times a second and kept, so the frame
// that draws the marks only projects points it already has.
//
// A waypoint's height is never trusted (617 of the client's own 2,456 waypoints sit at nought), so on
// a planet a mark is stood on whatever is under it when it is drawn:
//
//   - **The ground**, for a waypoint within `groundReach`. The world's own already-built ground is asked
//     first, which costs nothing and generates nothing (`World.groundIfCached`); only where it has none
//     is the ground made on the spot (`World.groundAt`), and that is held to `probesPerTick` a gather and
//     kept per waypoint for `regroundEvery` seconds, because making a block of ground far off is a
//     millisecond or more on the main thread.
//   - **Your eye's height**, past that reach or until the ground answers: a mark a kilometre and a half
//     off is a bearing, and its height does not matter.
//   - **A room**: a waypoint set in a building names the room it was set in, and the building is the
//     nearest one streamed in that has a room of that name. From inside that building the mark stands
//     on the room's own floor; from outside it, at the building's way in -- the first doorway of the way
//     from the world outside to that room through the building's own room-to-room graph -- because a
//     mark floating in a wall says nothing about how to get there. Until the building has streamed in,
//     the mark stands on the ground under the point like any other.
//   - **Its own height**, in a space zone, where a waypoint keeps one and there is no ground; one there
//     with no height of its own (a quest's will name only a place across) stands at the eye, and the
//     ground is never asked, since a space zone's is an unbuilt plane three kilometres down.
//
// Which marks are worked out at all is the nearest `marksMax` that are switched on, and the tracked
// one whatever its distance, since it is the one whose arrow points off the screen.
//
// It also says when a waypoint of your own is reached -- within `reachSay` of the mark as it stands,
// once per approach -- which is the one thing in this wave said on the message line about a waypoint.
//
// Pure: the world is asked through `PlaceDeps`, so the node test hands it a ground and a building of its
// own. Nothing is allocated once its pools have grown to what a world asks of them.

import { WAYPOINT_TUNE } from '../story/waypoints.ts';
import { nextDoor, type RoomDoor, type RoomGraph } from './nav/navRooms.ts';

/** What one waypoint is, as the gather reads it: in the game's frame, filled in place by whoever holds the book. */
export interface WaypointSpot {
  id: string;
  name: string;
  /** One of the palette's names (`WAYPOINT_COLOURS`). */
  colour: string;
  tracked: boolean;
  /** A quest's waypoint (`q:<quest>#<step>`), which later waves hand in; drawn with a dot in its middle. */
  quest: boolean;
  x: number;
  z: number;
  /** The height it keeps itself (a space zone's), or NaN where the ground or a floor is to say it. */
  y: number;
  /** The room it names: the cell's name, and the building's template where one was kept; '' for none. */
  cell: string;
  template: string;
}

/** The waypoints a gather reads, written into entries this list owns, so filling it makes nothing. */
export class WaypointSpots {
  readonly items: WaypointSpot[] = [];
  private n = 0;
  made = 0;

  begin(): void {
    this.n = 0;
  }

  get length(): number {
    return this.n;
  }

  add(id: string, name: string, colour: string, tracked: boolean, quest: boolean, x: number, z: number, y: number, cell: string, template: string): void {
    if (this.n === this.items.length) {
      this.items.push({ id: '', name: '', colour: '', tracked: false, quest: false, x: 0, z: 0, y: Number.NaN, cell: '', template: '' });
      this.made++;
    }
    const s = this.items[this.n++];
    s.id = id;
    s.name = name;
    s.colour = colour;
    s.tracked = tracked;
    s.quest = quest;
    s.x = x;
    s.z = z;
    s.y = y;
    s.cell = cell;
    s.template = template;
  }
}

/** The three shapes a mark is drawn as. */
export const MARK_PERSONAL = 0;
export const MARK_QUEST = 1;
export const MARK_ROOM = 2;

/** How a mark's place was found, for `__debug.waypoints({ marks: true })`. */
export type PlaceHow = 'given' | 'ground' | 'eye' | 'door' | 'room';

/** One mark worked out: what it is and where it stands in the world. Kept and refilled. */
export interface PlacedMark {
  id: string;
  name: string;
  colour: string;
  tracked: boolean;
  kind: number;
  x: number;
  y: number;
  z: number;
  how: PlaceHow;
  /** How far from you at the gather, in metres: across the ground on a planet, straight in space. */
  d: number;
}

/** What the world says about the room a waypoint names. Filled in place by `PlaceDeps.room`. */
export interface RoomAnswer {
  /** A streamed building near the point has a room of that name. */
  found: boolean;
  /** You are standing in that building's rooms. */
  inside: boolean;
  /** You are standing in that very room. */
  inRoom: boolean;
  /** The way in, in the world, when there is one. */
  door: boolean;
  doorX: number;
  doorY: number;
  doorZ: number;
  /** A height inside the room to look down for its floor from (its middle), in the world. */
  top: number;
}

export function makeRoomAnswer(): RoomAnswer {
  return { found: false, inside: false, inRoom: false, door: false, doorX: 0, doorY: 0, doorZ: 0, top: 0 };
}

/** What a gather asks of the world. */
export interface PlaceDeps {
  /**
   * Whether the world is a space zone. There the ground is never asked at all: a space zone's ground is a
   * plane three kilometres down that is never built (CLAUDE.md), and a heightless mark stood on it would
   * hang 3 km under the ship. A mark there with no height of its own stands at the eye, as a bearing.
   */
  space(): boolean;
  /** The ground's height where the world already holds it, or null: never makes any. */
  groundCached(x: number, z: number): number | null;
  /** The ground's height, made on the spot if it must be; null where there is none to make. */
  ground(x: number, z: number): number | null;
  /** The first floor straight down from a height inside a room, or null. */
  floor(x: number, y: number, z: number): number | null;
  /** The room a waypoint names, as `RoomAnswer` says. */
  room(cell: string, template: string, x: number, z: number, out: RoomAnswer): void;
}

/** A waypoint's ground as last found, and when, so it is not asked for again every gather. */
interface Grounded {
  x: number;
  z: number;
  y: number;
  at: number;
}

/**
 * How far past `reachSay` you must go before a waypoint can be reached again: twice it. Ours; a share
 * rather than a number so that moving `reachSay` moves both.
 */
const REARM = 2;

/**
 * The nearest `max` of `n` distances, by index into `out`, nearest first; then `tracked` (an index, or -1)
 * after them if it is not among them already. Answers how many were written. A selection run over the
 * front of the list, which for a hundred waypoints and ten marks is a thousand comparisons and nothing
 * made: the heap that would beat it would have to be built.
 */
export function pickNearest(dist: ArrayLike<number>, n: number, max: number, tracked: number, out: Int32Array, used: Uint8Array): number {
  const want = Math.min(max, n, out.length);
  used.fill(0, 0, n);
  let k = 0;
  for (; k < want; k++) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      if (best < 0 || dist[i] < dist[best]) best = i;
    }
    if (best < 0) break;
    used[best] = 1;
    out[k] = best;
  }
  if (tracked >= 0 && tracked < n && !used[tracked] && k < out.length) out[k++] = tracked;
  return k;
}

/**
 * The way into a building toward one of its rooms: the first doorway of the shortest way from the world
 * outside (cell 0) to that room, through the building's own room-to-room graph, in its model frame. Null
 * when no passable way reaches it. One search, made when asked; the caller keeps what it found.
 */
export function wayIn(graph: RoomGraph, cell: number): RoomDoor | null {
  if (cell <= 0) return null;
  return nextDoor(graph, 0, cell);
}

/** The marks: worked out a few times a second, read every frame. */
export class WaypointPlaces {
  /** The marks worked out, nearest first and the tracked one last if it was not among them. */
  readonly marks: PlacedMark[] = [];
  count = 0;
  /** Each waypoint's ground as last found, by id. */
  private readonly grounds = new Map<string, Grounded>();
  /** Whether each waypoint of yours may be said to be reached when you next come within reach of it. */
  private readonly armed = new Map<string, boolean>();
  private order = new Int32Array(16);
  private used = new Uint8Array(128);
  private dist = new Float64Array(128);
  private readonly roomOut = makeRoomAnswer();
  /** What the last gather spent and what it said, for the console. */
  readonly stats = { gathers: 0, probes: 0, probesLast: 0, reached: 0 };

  /**
   * One gather. `px, py, pz` is where you stand in the world, `eyeY` the height a mark with no ground yet
   * stands at, `now` seconds on any clock that runs. `onReached` is told of a waypoint of your own you
   * have just come within reach of, once per approach.
   */
  gather(spots: WaypointSpots, px: number, py: number, pz: number, eyeY: number, now: number, deps: PlaceDeps, onReached?: (m: PlacedMark) => void): void {
    const T = WAYPOINT_TUNE;
    const n = spots.length;
    this.stats.gathers++;
    if (this.dist.length < n) {
      this.dist = new Float64Array(n * 2);
      this.used = new Uint8Array(n * 2);
    }
    let tracked = -1;
    for (let i = 0; i < n; i++) {
      const s = spots.items[i];
      const dx = s.x - px;
      const dz = s.z - pz;
      this.dist[i] = Number.isFinite(s.y) ? Math.hypot(dx, s.y - py, dz) : Math.hypot(dx, dz);
      if (s.tracked) tracked = i;
    }
    const cap = Math.max(1, Math.round(T.marksMax)) + 1;
    if (this.order.length < cap) this.order = new Int32Array(cap);
    const picked = pickNearest(this.dist, n, cap - 1, tracked, this.order, this.used);
    while (this.marks.length < picked) this.marks.push({ id: '', name: '', colour: '', tracked: false, kind: MARK_PERSONAL, x: 0, y: 0, z: 0, how: 'eye', d: 0 });
    let probes = 0;
    for (let k = 0; k < picked; k++) {
      const s = spots.items[this.order[k]];
      const m = this.marks[k];
      m.id = s.id;
      m.name = s.name;
      m.colour = s.colour;
      m.tracked = s.tracked;
      m.kind = s.quest ? MARK_QUEST : s.cell ? MARK_ROOM : MARK_PERSONAL;
      m.x = s.x;
      m.z = s.z;
      m.d = this.dist[this.order[k]];
      let inRoom = false;
      if (Number.isFinite(s.y)) {
        m.y = s.y;
        m.how = 'given';
      } else {
        let placed = false;
        if (s.cell) {
          const r = this.roomOut;
          r.found = r.inside = r.inRoom = r.door = false;
          deps.room(s.cell, s.template, s.x, s.z, r);
          inRoom = r.found && r.inRoom;
          if (r.found && !r.inside && r.door) {
            // From outside the building: at its way in, which the world has already put in its frame.
            m.x = r.doorX;
            m.y = r.doorY;
            m.z = r.doorZ;
            m.how = 'door';
            placed = true;
          } else if (r.found && r.inside) {
            // From inside it: on the room's own floor under the point, found from the room's middle down.
            const had = this.grounds.get(s.id);
            if (had && had.x === s.x && had.z === s.z && now - had.at < T.regroundEvery) m.y = had.y;
            else if (probes < T.probesPerTick) {
              probes++;
              const y = deps.floor(s.x, r.top, s.z);
              m.y = y ?? r.top;
              if (y !== null) this.keep(s, y, now);
            } else m.y = had ? had.y : r.top;
            m.how = 'room';
            placed = true;
          }
        }
        if (!placed) probes += this.ground(m, s, eyeY, now, deps, probes);
      }
      if (!s.quest && onReached) this.reach(m, px, py, pz, s.cell ? inRoom : true, onReached);
    }
    this.count = picked;
    this.stats.probesLast = probes;
    this.stats.probes += probes;
  }

  /** A mark on the ground under its point, or at the eye's height; answers the probes it spent. */
  private ground(m: PlacedMark, s: WaypointSpot, eyeY: number, now: number, deps: PlaceDeps, spent: number): number {
    const T = WAYPOINT_TUNE;
    if (m.d > T.groundReach || deps.space()) {
      m.y = eyeY;
      m.how = 'eye';
      return 0;
    }
    const cached = deps.groundCached(s.x, s.z);
    if (cached !== null) {
      m.y = cached;
      m.how = 'ground';
      this.keep(s, cached, now);
      return 0;
    }
    const had = this.grounds.get(s.id);
    const same = !!had && had.x === s.x && had.z === s.z;
    if (same && now - had!.at < T.regroundEvery) {
      m.y = had!.y;
      m.how = 'ground';
      return 0;
    }
    if (spent < T.probesPerTick) {
      const y = deps.ground(s.x, s.z);
      if (y !== null) {
        this.keep(s, y, now);
        m.y = y;
        m.how = 'ground';
        return 1;
      }
      m.y = same ? had!.y : eyeY;
      m.how = same ? 'ground' : 'eye';
      return 1;
    }
    // Out of probes this gather: the last answer if there is one, and the eye's height until there is.
    m.y = same ? had!.y : eyeY;
    m.how = same ? 'ground' : 'eye';
    return 0;
  }

  private keep(s: WaypointSpot, y: number, now: number): void {
    const g = this.grounds.get(s.id);
    if (g) {
      g.x = s.x;
      g.z = s.z;
      g.y = y;
      g.at = now;
    } else this.grounds.set(s.id, { x: s.x, z: s.z, y, at: now });
  }

  /**
   * Reached, once per approach: within `reachSay` (and, for a room's, standing in that room) says so and
   * disarms; past twice that arms it again. A waypoint first seen from inside its reach starts disarmed,
   * so setting one where you stand does not say at once that you have reached it.
   *
   * Measured to the mark as it stands wherever its height is known -- on the ground, on a room's floor, or
   * the height it carries -- so a ship flying three hundred metres over a marked spot, or somebody on the
   * floor above it, has not reached it. A mark at the eye has no height worth the name (past the ground's
   * reach, or a bearing in space), and is measured across.
   */
  private reach(m: PlacedMark, px: number, py: number, pz: number, roomOk: boolean, onReached: (m: PlacedMark) => void): void {
    const T = WAYPOINT_TUNE;
    const d = m.how === 'ground' || m.how === 'room' || m.how === 'given' ? Math.hypot(m.x - px, m.y - py, m.z - pz) : m.d;
    const near = d <= T.reachSay && roomOk;
    const was = this.armed.get(m.id);
    if (was === undefined) {
      this.armed.set(m.id, d > T.reachSay * REARM);
      return;
    }
    if (was && near) {
      this.armed.set(m.id, false);
      this.stats.reached++;
      onReached(m);
    } else if (!was && d > T.reachSay * REARM) this.armed.set(m.id, true);
  }

  /** Another world, or another character: every ground found and every approach forgotten. */
  reset(): void {
    this.grounds.clear();
    this.armed.clear();
    this.count = 0;
  }
}
