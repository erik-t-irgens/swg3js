// A waypoint: a named place a character keeps in its story book, on one world, in that world's own
// frame. Pure: no DOM, no three, nothing imported, so the server and the node tests run every line of
// it exactly as the browser does.
//
// **Where a waypoint is.** On a planet it is kept in the raw frame -- the snapshot's, which is the
// frame the client's own waypoints and every `pois.json` row are in -- and turned into the game's
// frame only when it is drawn (`rawToGame`), so a pack whose layout centre moves needs nothing
// rewritten. In a space zone it is kept in the space pack's own game frame, as everything there is.
// `f` says which. Its height is never trusted: on a planet it is null and the point stands on the
// ground, or on a room's floor, when it is drawn; in space, where there is no ground to stand on, the
// height is kept.
//
// **What it looks like.** One of the palette's thirteen opaque colours, by name (`WAYPOINT_COLOURS`);
// the four translucent entries and `void` are left out because a mark in them would not be seen. The
// colour is a name and never a value, so a waypoint follows the palette if the palette ever moves.
//
// Every number here is ours. The hundred is the owner's own; the rest are invented.

/** The thirteen palette names a waypoint may wear. `storyBook.test.ts` checks each is in `PALETTE_NAMES`. */
export const WAYPOINT_COLOURS = ['accent', 'ink', 'muted', 'good', 'warn', 'bad', 'hot', 'shield', 'armour', 'chassis', 'component', 'health', 'pool'] as const;

export type WaypointColour = (typeof WAYPOINT_COLOURS)[number];

/**
 * The numbers of a waypoint: its own data first (what the book keeps, which the server reads too), then
 * how one is shown in the world (`src/ui/waypointHud.ts`, `src/world/waypointPlace.ts`). Nothing here is
 * the game's. The view's numbers are live through `__debug.waypoints({ tune })`, which takes them and
 * never the data's, since a hundred moved in one browser would be a book the server refuses.
 */
export const WAYPOINT_TUNE = {
  /** How many waypoints a character keeps that it set itself (the owner's number). A quest's do not count. */
  max: 100,
  /** The longest name, in characters. */
  nameMax: 48,
  /** The colour a waypoint you set yourself starts in. */
  defaultPersonal: 'accent' as WaypointColour,
  /** The colour a quest's waypoint starts in. */
  defaultQuest: 'component' as WaypointColour,
  /**
   * How far from a named place, in metres past its own radius, a waypoint set on the map is still
   * named for it ("Near Mos Eisley"); further off it is "Waypoint <n>". Ours.
   */
  nearName: 1000,
  // ---- the view: every one of these is ours ----------------------------------------------------------
  // A mark's own size is not here: it is `HUD_SIZES.waypointMark`, the one table every size on the
  // screen is kept in, which the stylesheet states again for the label under it.
  /** The dot in the middle of a quest's mark, in pixels at scale 1. */
  questDotPx: 2,
  /** The caret over or under a mark that stands well above or below you, in pixels at scale 1. */
  caretPx: 4,
  /** Metres above or below your feet past which a mark carries that caret. */
  heightHint: 4,
  /** The most marks drawn at once: the nearest that are switched on, and the tracked one whatever its distance. */
  marksMax: 10,
  /** Distance labels: the tracked waypoint's and the nearest one in view. A pool, read once when it is built. */
  labelsMax: 2,
  /** Metres from a waypoint of your own at which the message line says it is reached, once per approach. */
  reachSay: 8,
  /** Metres within which a mark is stood on the ground under it; past that its bearing is what matters. */
  groundReach: 1500,
  /** The most ground probes that may generate ground, a gather (eight a second); the rest wait their turn. */
  probesPerTick: 2,
  /** Seconds before a mark's ground is asked for again. */
  regroundEvery: 5,
  /** A distance under `farFrom` is said to this many metres. */
  nearRound: 10,
  /** Metres from which a distance is said in kilometres. */
  farFrom: 1000,
  /** A distance in kilometres is said to this many of them. */
  farRound: 0.1,
};

/** The view's numbers, which `tuneWaypointView` may move. The data's above them are left alone. */
const VIEW_KEYS = ['questDotPx', 'caretPx', 'heightHint', 'marksMax', 'labelsMax', 'reachSay', 'groundReach', 'probesPerTick', 'regroundEvery', 'nearRound', 'farFrom', 'farRound'] as const;

/** Move any of the view's numbers, each held to something that makes sense; the answer is the table as it stands. */
export function tuneWaypointView(o: Partial<Record<(typeof VIEW_KEYS)[number], number>>): typeof WAYPOINT_TUNE {
  const t = WAYPOINT_TUNE as unknown as Record<string, number>;
  for (const k of VIEW_KEYS) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    // Counts are whole and at least one; a size, a distance or a time may not be negative; the rounding
    // steps may not be nought, or a distance would be divided by nothing.
    if (k === 'marksMax' || k === 'labelsMax' || k === 'probesPerTick') t[k] = Math.max(k === 'probesPerTick' ? 0 : 1, Math.min(64, Math.round(v)));
    else if (k === 'nearRound' || k === 'farRound') t[k] = Math.max(1e-3, v);
    else t[k] = Math.max(0, v);
  }
  return WAYPOINT_TUNE;
}

/**
 * One waypoint. `p` is where it stands: x and z across the ground in the frame `f` names, then the
 * height, or null where the ground or a room's floor is to say it.
 */
export interface Waypoint {
  id: string;
  name: string;
  /** The world it is on: the pack id the game loads for it (a planet, a zone of one, a space zone). */
  world: string;
  f: 'raw' | 'game';
  p: [number, number, number | null];
  /** A room in a building: the cell's name, and the building's template where the place alone is not enough. */
  room?: { cell: string; template?: string };
  colour: WaypointColour;
  on: boolean;
  /** When it was set, in shared-clock milliseconds. */
  made: number;
}

/** What a browser may ask for when it sets one: everything but the id and the time, which the host gives it. */
export type WaypointAsk = Omit<Waypoint, 'id' | 'made'>;

/** Names a key or an id may not have: the three that mean something to every object in the language. */
export const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** A personal waypoint's id: `w` and the host's own counter. Never a browser's choice while a server holds the book. */
const WAYPOINT_ID = /^w[0-9]{1,9}$/;
/** A quest's waypoint is never stored: it is `q:<quest>#<step>`, worked out from the quest it belongs to. */
const QUEST_WAYPOINT = /^q:[A-Za-z0-9_:./-]{1,96}#[A-Za-z0-9_.-]{1,48}$/;
/** A cell's name, as the models write them (`cantina`, `elevator_e3_up`, `foyer1`). */
const CELL_NAME = /^[A-Za-z0-9_ .-]{1,64}$/;
/** A building's template: a path of plain characters. */
const TEMPLATE = /^[A-Za-z0-9_./-]{1,160}$/;
const CONTROL = /[\u0000-\u001f\u007f]/g;
/** How far from a world's middle a point may be before it is nonsense, in metres. A space zone reaches about 10 km. */
const REACH = 1e7;

export function isWaypointId(x: unknown): x is string {
  return typeof x === 'string' && WAYPOINT_ID.test(x);
}

export function isQuestWaypoint(x: unknown): x is string {
  return typeof x === 'string' && QUEST_WAYPOINT.test(x);
}

export function isWaypointColour(x: unknown): x is WaypointColour {
  return typeof x === 'string' && (WAYPOINT_COLOURS as readonly string[]).includes(x);
}

/** A name: control characters out, trimmed, cut to length. Empty is null. */
export function cleanWaypointName(x: unknown, max = WAYPOINT_TUNE.nameMax): string | null {
  if (typeof x !== 'string') return null;
  const out = x.replace(CONTROL, '').trim().slice(0, max).trim();
  return out || null;
}

/**
 * A world key: any short line of plain text. It is not matched against a class of characters on
 * purpose -- the server has refused a world for having a space in its name before -- and it is never a
 * key of an object, only a string compared with another.
 */
export function cleanWorld(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const out = x.replace(CONTROL, '').trim();
  return out && out.length <= 64 && !FORBIDDEN_KEYS.includes(out) ? out : null;
}

function finite(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= REACH ? x : null;
}

/** A room, or null when what is given is not one. */
export function cleanRoom(x: unknown): { cell: string; template?: string } | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.cell !== 'string' || !CELL_NAME.test(o.cell)) return null;
  const out: { cell: string; template?: string } = { cell: o.cell };
  if (typeof o.template === 'string' && TEMPLATE.test(o.template)) out.template = o.template;
  return out;
}

/** Where a waypoint stands, or null: two numbers across the ground and a height or null. */
export function cleanPlace(x: unknown): [number, number, number | null] | null {
  if (!Array.isArray(x) || x.length < 2 || x.length > 3) return null;
  const a = finite(x[0]);
  const b = finite(x[1]);
  if (a === null || b === null) return null;
  const h = x.length === 3 && x[2] !== null ? finite(x[2]) : null;
  if (x.length === 3 && x[2] !== null && h === null) return null;
  return [a, b, h];
}

/**
 * What a browser asked to set, cleaned, or null. Everything is rebuilt field by field, so nothing a
 * browser adds to the object is ever carried on: an unknown field, a `__proto__`, a second name.
 */
export function cleanWaypointAsk(x: unknown): WaypointAsk | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const world = cleanWorld(o.world);
  const p = cleanPlace(o.p);
  if (!world || !p) return null;
  const f = o.f === 'game' ? 'game' : o.f === 'raw' ? 'raw' : null;
  if (!f) return null;
  const out: WaypointAsk = {
    name: cleanWaypointName(o.name) ?? 'Waypoint',
    world,
    f,
    p,
    colour: isWaypointColour(o.colour) ? o.colour : WAYPOINT_TUNE.defaultPersonal,
    on: o.on !== false,
  };
  const room = o.room === undefined ? null : cleanRoom(o.room);
  if (room) out.room = room;
  return out;
}

/** A stored waypoint, cleaned, or null: an ask with its id and its time. */
export function cleanWaypoint(x: unknown): Waypoint | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!isWaypointId(o.id)) return null;
  const ask = cleanWaypointAsk(o);
  if (!ask) return null;
  const made = typeof o.made === 'number' && Number.isFinite(o.made) && o.made >= 0 ? o.made : 0;
  return { id: o.id, ...ask, made };
}

/** The counter a personal waypoint's id was minted from. */
export function waypointNumber(id: string): number {
  return isWaypointId(id) ? Number(id.slice(1)) : 0;
}

// ---- Frames ------------------------------------------------------------------------------------------
//
// A planet's game frame mirrors X and takes the layout's centre off (`World.layoutCenter`): this is the
// same algebra `mapFromGameX` and `mapFromGameZ` are on the map's side, the other way round, written one
// number at a time so a frame that turns a hundred of them makes nothing.

/** A raw x into the game's frame, about the world's layout centre. */
export function rawToGameX(centreX: number, x: number): number {
  return -(x - centreX);
}

/** A raw z into the game's frame. */
export function rawToGameZ(centreZ: number, z: number): number {
  return z - centreZ;
}

/** A game x into the raw frame. */
export function gameToRawX(centreX: number, x: number): number {
  return centreX - x;
}

/** A game z into the raw frame. */
export function gameToRawZ(centreZ: number, z: number): number {
  return z + centreZ;
}

/** A raw point into the game's frame, as a pair. */
export function rawToGame(x: number, z: number, centre: { x: number; z: number } | null): { x: number; z: number } {
  const c = centre ?? { x: 0, z: 0 };
  return { x: rawToGameX(c.x, x), z: rawToGameZ(c.z, z) };
}

/** A game point into the raw frame, as a pair. */
export function gameToRaw(x: number, z: number, centre: { x: number; z: number } | null): { x: number; z: number } {
  const c = centre ?? { x: 0, z: 0 };
  return { x: gameToRawX(c.x, x), z: gameToRawZ(c.z, z) };
}

/**
 * What a waypoint set on the map is called: after the named place nearest it when that is close enough
 * to mean something, else by its number. `metres` is how far past the place's own radius it is.
 */
export function waypointName(near: string | null, metres: number, n: number): string {
  if (near && Number.isFinite(metres) && metres <= WAYPOINT_TUNE.nearName) return cleanWaypointName(`Near ${near}`) ?? `Waypoint ${n}`;
  return `Waypoint ${n}`;
}
