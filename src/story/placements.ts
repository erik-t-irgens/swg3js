// The permanent placements: things a world stands for every player, read out of two plain files that ship
// with the build, and never picked up in play.
//
// **Two layers, one shape.** `public/placements/story/<world>.json` is the story's dressing (a quest's yard,
// the locker a job sends somebody to) and `public/placements/world/<world>.json` the map's own edits (a house
// that was not there, a wall that was missing). Both are tracked files, plain JSON (a kind of file a release
// may carry), fetched by every browser from the build it runs; neither carries a comment, so `note` is where
// a row's words go. One id names one row across both: where both layers hold it, the world edit is kept and
// the story's skipped as a clash.
//
// **A row is filed under `place/<id>`,** a name no snapshot and nothing a player puts down ever has, so a
// story object can name it (`"template": "place/<id>"`) with nothing in the story changed, and a removal is
// one lookup that can never reach anything else.
//
// **The frame is the file's.** On a planet a row is in the raw frame -- what `/loc` prints, what a story's
// `near`, an area and a waypoint are written in -- so the owner copies numbers straight across, and the
// layout's centre (a conversion's, not the file's) is taken off only when it is stood. A space zone has no
// raw frame of its own, and its file says `game`. `y` is absolute and never measured again, as a server
// home's is.
//
// **A bad row is skipped and named; a file is never thrown away for one.** A file whose header is wrong (its
// version, its world, its frame) is refused whole, since every row in it would be read in the wrong place.
//
// Pure: imports only `./jsonc.ts`, `./waypoints.ts` and `./placementPath.ts` (where the files live, which the
// dev server's watcher reads on its own), so the browser, the checker and the server read a file the same way. Rule for this file (node runs it with type stripping): every import with its `.ts`
// extension, no enum, no namespace, no constructor parameter properties.

import { parseJsonc } from './jsonc.ts';
import type { PlacementLayer } from './placementPath.ts';
import { gameToRawX, gameToRawZ, rawToGameX, rawToGameZ } from './waypoints.ts';

export { placementFileOf, placementsPath, type PlacementLayer } from './placementPath.ts';
export const PLACEMENT_LAYERS: readonly PlacementLayer[] = ['story', 'world'];
/** Which pack a row's model is found in: the props catalogue (by `thing`), the gallery's buildings, or this world's own. */
export type PlacementPack = 'props' | 'gallery' | 'world';
/** The frame a file's places are written in: raw on a planet, the game's own in a space zone. */
export type PlacementFrame = 'raw' | 'game';

/** One permanent placement, as the file holds it (once read and cleaned). */
export interface PlacementRow {
  /** `^[a-z0-9][a-z0-9_-]{0,63}$`, unique in its world across both layers; filed under `place/<id>`. */
  id: string;
  kind: 'prop' | 'building';
  pack: PlacementPack;
  /** The props catalogue's id (`pack: 'props'`). */
  thing?: string;
  /** The model's id in the gallery or this world's pack (`pack: 'gallery'` or `'world'`). */
  model?: string;
  /** A building's deed, for its name and its footprint when the editor takes it up again. */
  deed?: string;
  x: number;
  y: number;
  z: number;
  /** `[w, x, y, z]` in the file's frame: the layout's own order. */
  q: [number, number, number, number];
  /**
   * Solid by default, and `false` never collides. Absent on a props row whose thing is a seat or a table, it
   * is never solid either: a permanent one stands in for the seats of ours, and the person the data sits on it
   * would be pushed off by a collider under them (`dressingStandOf`). `true` makes one solid all the same.
   */
  solid?: boolean;
  /** Standing in a room rather than out in the open. */
  inside?: boolean;
  /** Metres of flora kept off round it. */
  clear?: number;
  /** Metres round it a player's own thing may not stand; absent, `DRESSING_TUNE.guard` on a story row and none on a world edit. */
  guard?: number;
  /**
   * The ground's height under it when it was put there, out in the open: what the editor's list measures the
   * ground under it against now, so one raised or sunk on purpose is not taken for one the ground moved under.
   * Says nothing about how it stands.
   */
  ground?: number;
  /**
   * The world state it stands in, as `<key>=<value>` (`restuss=ruins`): rubble placed for Restuss's ruins stands in
   * the ruins only, and in the living city it is filed nowhere (`src/world/worldState.ts`). Absent, every state.
   * Cleaned only for its shape here, since this folder knows nothing of a world's states.
   */
  state?: string;
  /**
   * What a gallery or world row really is, as an object template (`object/...iff`): what its client data hangs on it
   * (a world's brazier burns) and what counts a permanent chair as the world's own. Absent, its model is all it is. On a
   * props row the thing's own template says it, and one written there is kept out as a field this build does not read.
   */
  template?: string;
  /**
   * The ground world a `pack: 'world'` row's model comes from, by its pack id: a Naboo tree on Tatooine or on Monument.
   * Absent, this world's own pack (the editor writes it absent when it is this world). Only a row naming one is looked up
   * in that pack first; on any other pack it is kept out as a field this build does not read.
   */
  from?: string;
  name?: string;
  note?: string;
  /** When it was written, milliseconds since the epoch. */
  at?: number;
}

/** What reading one file gave. */
export interface PlacementRead {
  rows: PlacementRow[];
  /** Rows refused, by id (or `#<index>` when the id itself is the trouble), each with why. */
  skipped: { id: string; why: string }[];
  /** Fields a row carried that this build does not read, as `<id>.<field>`: kept out of the row, never a refusal. */
  unknown: string[];
  /** Why the whole file was refused, or null. */
  problem: string | null;
}

/** A row joined with the layer it came from. */
export interface PlacementEntry {
  row: PlacementRow;
  layer: PlacementLayer;
}

/**
 * The limits one shared reader holds every file to. Ours. **The number limits are backstops**, far past any use, where
 * every build agrees on what a committed file means (a row past one is skipped by every build): the developer's own soft
 * lines are the world editor's notes (`EDITOR_TUNE`, dev only), never this reader's. Not live, for that reason: a backstop
 * moved on one machine would make a file stand differently on another. The shape rules (the reach, the height, a unit
 * turn, the words' lengths) are where a row stops being a row at all.
 */
export const PLACEMENT_LIMITS = {
  /** Rows a file holds; the 2,001st and on stood from the world editor's pass on (it was 2,000). */
  rows: 100000,
  /** Metres either way across the ground. */
  reach: 100000,
  /** Metres up or down. */
  height: 20000,
  /** How far a turn's length may be off one before it is not a turn at all. */
  unit: 1e-3,
  name: 80,
  note: 400,
  /** The most `clear` and `guard` may be, metres (64 before the world editor; its note stands at 64 still). */
  circle: 2000,
  /** The longest `template` a row may name. */
  template: 400,
};

/** The prefix every permanent row is filed under in the streamer. */
export const PLACEMENT_KEY_PREFIX = 'place/';
export const PLACEMENT_VERSION = 1;

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** A catalogue id or a model's: the server's own pattern for a home's model. */
const NAME_ID = /^[A-Za-z0-9_.-]{1,96}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** The fields a row may carry; the reserved ones are read and set aside. */
const FIELDS = new Set(['id', 'kind', 'pack', 'thing', 'model', 'deed', 'x', 'y', 'z', 'q', 'solid', 'inside', 'clear', 'guard', 'ground', 'state', 'template', 'from', 'name', 'note', 'at']);
/** A world state's tag: its key and its value, each lower-case words. */
const STATE = /^[a-z0-9_]+=[a-z0-9_]+$/;
/** An object template, as a row names one. */
const TEMPLATE = /^object\/[a-z0-9_/.-]+\.iff$/;
/** A ground world's pack id, as the endpoint's world names one. */
const WORLD_ID = /^[a-z0-9_]{1,40}$/;
/**
 * Read and set aside. `cut` is Map-maker II's (ground cut away under a placed piece, a cave's mouth): reserved now so a row
 * written with one keeps it across the editor's put and moves nothing in a build that does not read it.
 */
const RESERVED = new Set(['fill', 'locked', 'effectsOf', 'cut']);

/** The streamer's key for a row's id. */
export function placementKey(id: string): string {
  return PLACEMENT_KEY_PREFIX + id;
}

/** The id a streamer key names, or null for a key that is not a permanent row's. */
export function placementIdOf(key: string): string | null {
  return key.startsWith(PLACEMENT_KEY_PREFIX) ? key.slice(PLACEMENT_KEY_PREFIX.length) : null;
}

/** Whether an id is one a row may carry. */
export function isPlacementId(id: unknown): id is string {
  return typeof id === 'string' && ID.test(id);
}

/** A finite number, or undefined. */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * One row cleaned, or why it is refused. The turn is renormalised when it is within the limit of a unit
 * turn, and refused past it, since a turn that far off is a typing mistake rather than rounding.
 */
export function readPlacementRow(v: unknown, unknown: string[] = []): PlacementRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a row is an object';
  const o = v as Record<string, unknown>;
  if (!isPlacementId(o.id)) return 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)';
  const id = o.id;
  for (const k of Object.keys(o)) if (!FIELDS.has(k) && !RESERVED.has(k)) unknown.push(`${id}.${k}`);
  if (o.kind !== 'prop' && o.kind !== 'building') return 'its kind is neither prop nor building';
  if (o.pack !== 'props' && o.pack !== 'gallery' && o.pack !== 'world') return 'its pack is not props, gallery or world';
  if (o.kind === 'building' && o.pack === 'props') return 'a building comes out of the gallery or the world\'s own pack, not the props';
  const row: PlacementRow = { id, kind: o.kind, pack: o.pack, x: 0, y: 0, z: 0, q: [1, 0, 0, 0] };
  if (o.pack === 'props') {
    if (typeof o.thing !== 'string' || !NAME_ID.test(o.thing)) return 'a props row names its thing (the props catalogue\'s id)';
    row.thing = o.thing;
  } else {
    if (typeof o.model !== 'string' || !NAME_ID.test(o.model)) return 'it names no model';
    row.model = o.model;
  }
  if (o.deed !== undefined) {
    if (typeof o.deed !== 'string' || !NAME_ID.test(o.deed)) return 'its deed is not an id';
    row.deed = o.deed;
  }
  const x = num(o.x);
  const y = num(o.y);
  const z = num(o.z);
  if (x === undefined || y === undefined || z === undefined) return 'its place is not three numbers';
  const L = PLACEMENT_LIMITS;
  if (Math.abs(x) > L.reach || Math.abs(z) > L.reach) return `its place is more than ${L.reach} m out`;
  if (Math.abs(y) > L.height) return `its height is more than ${L.height} m off`;
  row.x = x;
  row.y = y;
  row.z = z;
  const q = o.q;
  if (!Array.isArray(q) || q.length !== 4 || q.some((c) => num(c) === undefined)) return 'its turn is not four numbers [w, x, y, z]';
  const len = Math.hypot(q[0] as number, q[1] as number, q[2] as number, q[3] as number);
  if (!(Math.abs(len - 1) <= L.unit)) return 'its turn is not a turn (its length is not one)';
  // Renormalised only when it is off by more than rounding, so a file written from rows already read reads
  // back to the very same numbers.
  const n = Math.abs(len - 1) > 1e-12 ? len : 1;
  row.q = [(q[0] as number) / n, (q[1] as number) / n, (q[2] as number) / n, (q[3] as number) / n];
  for (const flag of ['solid', 'inside'] as const) {
    if (o[flag] === undefined) continue;
    if (typeof o[flag] !== 'boolean') return `${flag} is true or false`;
    row[flag] = o[flag] as boolean;
  }
  for (const circle of ['clear', 'guard'] as const) {
    if (o[circle] === undefined) continue;
    const r = num(o[circle]);
    if (r === undefined || r < 0 || r > L.circle) return `${circle} is a number of metres from 0 to ${L.circle}`;
    row[circle] = r;
  }
  if (o.ground !== undefined) {
    const g = num(o.ground);
    if (g === undefined || Math.abs(g) > L.height) return `its ground is a height of ${L.height} m at most either way`;
    row.ground = g;
  }
  // A state of the wrong shape is kept out of the row as a field this build does not read is, with its note: the row
  // then stands in every state, which is what it did before anybody wrote one.
  if (o.state !== undefined) {
    if (typeof o.state === 'string' && STATE.test(o.state)) row.state = o.state;
    else unknown.push(`${id}.state`);
  }
  // The template and the world a model comes from, read the way `state` is: one of the wrong shape, or on a pack it
  // says nothing of (a props row's thing has its own template; only a world row names another world), is kept out of
  // the row as a field this build does not read, with its note, and the row stands as it did without it.
  if (o.template !== undefined) {
    if (o.pack !== 'props' && typeof o.template === 'string' && o.template.length <= L.template && TEMPLATE.test(o.template)) row.template = o.template;
    else unknown.push(`${id}.template`);
  }
  if (o.from !== undefined) {
    if (o.pack === 'world' && typeof o.from === 'string' && WORLD_ID.test(o.from)) row.from = o.from;
    else unknown.push(`${id}.from`);
  }
  if (o.name !== undefined) {
    if (typeof o.name !== 'string' || o.name.length > L.name || CONTROL.test(o.name)) return `its name is words of ${L.name} characters at most`;
    row.name = o.name;
  }
  if (o.note !== undefined) {
    if (typeof o.note !== 'string' || o.note.length > L.note) return `its note is words of ${L.note} characters at most`;
    row.note = o.note;
  }
  if (o.at !== undefined) {
    const at = num(o.at);
    if (at === undefined || at < 0) return 'its at is a time in milliseconds';
    row.at = at;
  }
  return row;
}

/**
 * Read one layer's file for a world. `kindOfWorld` decides the frame the file must say it is in: a space
 * zone's is the game's own, any other world's the raw. A file that does not read, or whose header is not
 * this world's, is refused whole; a bad row, a row past the cap and a second row under one id are skipped
 * and named.
 */
export function readPlacementsFile(text: string, world: string, kindOfWorld: 'ground' | 'space'): PlacementRead {
  return readFileOf(text, world, kindOfWorld, null);
}

/**
 * The same read, with each row kept beside the very object it was read from (`raws[i]` for `rows[i]`): what the dev
 * server's endpoint writes back as it found it, fields this build does not read included. One parse, where the endpoint
 * used to parse a file a second time to get them.
 */
export function readPlacementsFileRaw(text: string, world: string, kindOfWorld: 'ground' | 'space'): PlacementRead & { raws: Record<string, unknown>[] } {
  const raws: Record<string, unknown>[] = [];
  const read = readFileOf(text, world, kindOfWorld, raws);
  return { ...read, raws };
}

function readFileOf(text: string, world: string, kindOfWorld: 'ground' | 'space', raws: Record<string, unknown>[] | null): PlacementRead {
  const out: PlacementRead = { rows: [], skipped: [], unknown: [], problem: null };
  const doc = parseJsonc(text);
  if (doc.error) {
    out.problem = `it does not read (line ${doc.error.line}, column ${doc.error.col}: ${doc.error.message})`;
    return out;
  }
  const v = doc.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    out.problem = 'it is not an object';
    return out;
  }
  const f = v as Record<string, unknown>;
  if (f.version !== PLACEMENT_VERSION) {
    out.problem = `its version is not ${PLACEMENT_VERSION}`;
    return out;
  }
  if (f.world !== world) {
    out.problem = `it says it is ${typeof f.world === 'string' ? f.world : 'no world'}'s, and its name says ${world}'s`;
    return out;
  }
  const frame = kindOfWorld === 'space' ? 'game' : 'raw';
  if (f.frame !== frame) {
    out.problem = `a ${kindOfWorld === 'space' ? 'space zone' : 'world on the ground'} is written in the ${frame} frame, and it says ${typeof f.frame === 'string' ? f.frame : 'none'}`;
    return out;
  }
  if (!Array.isArray(f.rows)) {
    out.problem = 'it has no rows list';
    return out;
  }
  const seen = new Set<string>();
  for (let i = 0; i < f.rows.length; i++) {
    const raw = f.rows[i];
    const named = raw && typeof raw === 'object' && isPlacementId((raw as { id?: unknown }).id) ? (raw as { id: string }).id : `#${i}`;
    if (out.rows.length >= PLACEMENT_LIMITS.rows) {
      out.skipped.push({ id: named, why: `past the ${PLACEMENT_LIMITS.rows} rows a file may hold` });
      continue;
    }
    const row = readPlacementRow(raw, out.unknown);
    if (typeof row === 'string') {
      out.skipped.push({ id: named, why: row });
      continue;
    }
    if (seen.has(row.id)) {
      out.skipped.push({ id: row.id, why: 'a second row under the same id' });
      continue;
    }
    seen.add(row.id);
    out.rows.push(row);
    if (raws) raws.push(raw as Record<string, unknown>);
  }
  return out;
}

/** A row's place in the game's frame: x, y, z and its turn as `[x, y, z, w]`, which is three's order. */
export interface GamePlace {
  x: number;
  y: number;
  z: number;
  q: [number, number, number, number];
}

/**
 * A row's place in the game's frame. From the raw frame that is the layout's own mirror -- `gx = cx - x`,
 * `gz = z - cz`, `y` as written -- and the turn `[w, x, y, z]` taken as three's `(x, -y, -z, w)`, exactly as the
 * streamer reads the layout (`new Quaternion(q[1], -q[2], -q[3], q[0])`). A file in the game's frame is read
 * as it stands. Written into `out` when one is handed over.
 */
export function toGame(row: Pick<PlacementRow, 'x' | 'y' | 'z' | 'q'>, centre: { x: number; z: number } | null, frame: PlacementFrame = 'raw', out?: GamePlace): GamePlace {
  const o = out ?? { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] };
  const [w, x, y, z] = row.q;
  if (frame === 'game') {
    o.x = row.x;
    o.z = row.z;
    o.q[0] = x;
    o.q[1] = y;
    o.q[2] = z;
  } else {
    const c = centre ?? { x: 0, z: 0 };
    o.x = rawToGameX(c.x, row.x);
    o.z = rawToGameZ(c.z, row.z);
    o.q[0] = x;
    o.q[1] = -y;
    o.q[2] = -z;
  }
  o.y = row.y;
  o.q[3] = w;
  return o;
}

/** The other way: a place in the game's frame as a row writes it, in `frame`. */
export function fromGame(place: GamePlace, centre: { x: number; z: number } | null, frame: PlacementFrame = 'raw'): Pick<PlacementRow, 'x' | 'y' | 'z' | 'q'> {
  const [x, y, z, w] = place.q;
  if (frame === 'game') return { x: place.x, y: place.y, z: place.z, q: [w, x, y, z] };
  const c = centre ?? { x: 0, z: 0 };
  return { x: gameToRawX(c.x, place.x), y: place.y, z: gameToRawZ(c.z, place.z), q: [w, x, -y, -z] };
}

/**
 * Half the wider of a box's two spans on the ground: the radius a model's own box gives it, which files its
 * size tier and sizes its room range. **Spans, never corners**: a pack converted before the mesh reader took a
 * BOX chunk's corners componentwise carries them the other way round.
 */
export function radiusOfBounds(b: { min: readonly number[]; max: readonly number[] } | null | undefined): number {
  if (!b || b.min.length < 3 || b.max.length < 3) return 0;
  return Math.max(Math.abs(b.max[0] - b.min[0]), Math.abs(b.max[2] - b.min[2])) / 2;
}

/**
 * What a row stands as, as one string: every field that moves what stands, and none of `ground`, `name`,
 * `note` and `at`, which only say things about it. Two rows with the same answer stand the same, so a change to a
 * row's words re-stands nothing. Exact rather than a digest, since a sync compares at most a few thousand.
 */
export function rowHash(row: PlacementRow): string {
  // The state only where a row has one, so a row with none answers exactly what it did before rows could carry one.
  // Every field after it is **tagged** and only where present: with several optional appendices an untagged position
  // could let one field's value pass for another's. The state keeps its untagged place as the first appendix, which is
  // safe because a state always holds `=` and no tag does.
  return JSON.stringify([
    row.kind,
    row.pack,
    row.thing ?? null,
    row.model ?? null,
    row.deed ?? null,
    row.x,
    row.y,
    row.z,
    row.q,
    row.solid ?? null,
    row.inside ?? null,
    row.clear ?? null,
    row.guard ?? null,
    ...(row.state ? [row.state] : []),
    ...(row.template !== undefined ? ['template', row.template] : []),
    ...(row.from !== undefined ? ['from', row.from] : []),
  ]);
}

/**
 * What to do to bring what stands to what the rows say, over both layers at once: the rows to stand that
 * stand nowhere (`add`), the keys standing that no row names any more (`remove`), and the rows whose stand
 * changed (`change`, to be taken down and stood again). A building is stood before any prop, so what stands
 * inside it finds its host at once; ties keep the rows' own order.
 */
export function syncPlan(standing: ReadonlyMap<string, string>, rows: readonly PlacementEntry[]): { add: PlacementEntry[]; remove: string[]; change: PlacementEntry[] } {
  const add: PlacementEntry[] = [];
  const change: PlacementEntry[] = [];
  const named = new Set<string>();
  for (const e of rows) {
    const key = placementKey(e.row.id);
    named.add(key);
    const was = standing.get(key);
    if (was === undefined) add.push(e);
    else if (was !== rowHash(e.row)) change.push(e);
  }
  const remove: string[] = [];
  for (const key of standing.keys()) if (!named.has(key)) remove.push(key);
  return { add: buildingsFirst(add), remove, change: buildingsFirst(change) };
}

/** Buildings ahead of props, each kind in the order it came. */
function buildingsFirst(list: PlacementEntry[]): PlacementEntry[] {
  return [...list.filter((e) => e.row.kind === 'building'), ...list.filter((e) => e.row.kind !== 'building')];
}

/** Both layers as one list, the world edit kept where both hold an id and the story's row named as a clash. */
export function mergeLayers(story: readonly PlacementRow[], world: readonly PlacementRow[]): { rows: PlacementEntry[]; clashes: string[] } {
  const taken = new Set(world.map((r) => r.id));
  const rows: PlacementEntry[] = [];
  const clashes: string[] = [];
  for (const row of story) {
    if (taken.has(row.id)) clashes.push(row.id);
    else rows.push({ row, layer: 'story' });
  }
  for (const row of world) rows.push({ row, layer: 'world' });
  return { rows, clashes };
}

/**
 * A new id from a name (a thing's id, a model's): lower-cased, everything but a-z, 0-9, `_` and `-` turned to
 * `-`, cut to leave room for a number, then `-1`, `-2` and on until it is one `taken` does not hold.
 */
export function mintPlacementId(base: string, taken: ReadonlySet<string>): string {
  let stem = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 56);
  if (!stem) stem = 'place';
  for (let n = 1; ; n++) {
    const id = `${stem}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** The field order a row is written in, so one row is always one line spelled the same way. */
const ORDER: (keyof PlacementRow)[] = ['id', 'kind', 'pack', 'thing', 'model', 'deed', 'x', 'y', 'z', 'q', 'solid', 'inside', 'clear', 'guard', 'ground', 'state', 'template', 'from', 'name', 'note', 'at'];
/** Every field a row of this build reads, in the order it is written. */
export const PLACEMENT_FIELDS: readonly string[] = ORDER;
const ORDERED = new Set<string>(ORDER);

/**
 * A whole file's text: its header a field a line, then one line a row, sorted by id, each row's fields in
 * one fixed order. A change to one row is a change to one line, so git shows exactly what moved. No
 * comment, in either layer: the file is JSON, and `note` is where a row's words go. A row handed over as
 * the very object a file was read into (the editor writing back rows it did not touch) keeps every field
 * it carries that this build does not read, after the rest, so a word written by hand is never lost.
 */
export function placementsFileText(world: string, frame: PlacementFrame, rows: readonly PlacementRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines = sorted.map((r) => {
    const parts: string[] = [];
    for (const k of ORDER) {
      const v = r[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    }
    const all = r as unknown as Record<string, unknown>;
    for (const k of Object.keys(all)) {
      if (ORDERED.has(k) || all[k] === undefined) continue;
      parts.push(`${JSON.stringify(k)}: ${JSON.stringify(all[k])}`);
    }
    return `    { ${parts.join(', ')} }`;
  });
  const body = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${PLACEMENT_VERSION},\n  "world": ${JSON.stringify(world)},\n  "frame": ${JSON.stringify(frame)},\n  "rows": ${body}\n}\n`;
}

/** A row's raw `near` on the ground, as a story object and an area are written: its own place, rounded to the decimetre. */
function nearOf(row: PlacementRow): [number, number] {
  return [Math.round(row.x * 10) / 10, Math.round(row.z * 10) / 10];
}

/**
 * A story object naming a row, ready to paste into a story's `objects/` folder: its template is the row's
 * key, its `near` the row's own place (raw on a planet, as a story is written), in the shape of the test
 * set's own `objects/test-terminal.jsonc`.
 */
export function storyObjectSnippet(row: PlacementRow, world: string, label: string, reach = 2): string {
  return `{\n  "id": ${JSON.stringify(row.id)},\n  "world": ${JSON.stringify(world)},\n  "template": ${JSON.stringify(placementKey(row.id))},\n  "near": ${JSON.stringify(nearOf(row))},\n  "reach": ${reach},\n  "label": ${JSON.stringify(label)},\n}\n`;
}

/** A circle of `r` metres round a row, ready to paste into a story's `areas/` folder, in the shape of `areas/test-square.jsonc`. */
export function storyAreaSnippet(row: PlacementRow, world: string, r: number, label: string): string {
  return `{\n  "id": ${JSON.stringify(`${row.id}-area`.slice(0, 64))},\n  "world": ${JSON.stringify(world)},\n  "shape": { "kind": "circle", "c": ${JSON.stringify(nearOf(row))}, "r": ${r} },\n  "label": ${JSON.stringify(label)},\n}\n`;
}
