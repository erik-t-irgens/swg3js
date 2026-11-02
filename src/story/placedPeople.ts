// The owner's own people (Map-maker II's twelfth wave, Map-maker I's §2.10 as built here): `public/placements/people/<world>.json`,
// a row a person placed for every player, read at an arrival and written only by the world editor's batch.
//
//   { "version": 1, "world": "tatooine", "frame": "raw",
//     "rows": [
//       { "id": "kael-smuggler", "body": "<a catalogue id>", "who": "<a Core3 creature, optional>", "x": 3512.4, "y": 5.1,
//         "z": -4820, "heading": 135, "room": 3, "mood": "npc_sitting_chair", "still": true, "peaceful": true, "respawn": 300,
//         "name": "Kael", "at": 1793000000000 }
//     ] }
//
// **A row is shaped like a standing row of the data's** (`StandingRow`, `src/world/standingPeople.ts`), so the very people
// the data stands stand his (`placedStandingRow`): posts, rounds, moods, seated idles, perches, the two caps of forty, the
// memory budget, sharing by "seen", deaths held by the server and respawn. `heading` is degrees in the file's frame
// (`atan2(x, z)`, the data's convention), carried into the game's as the data's rows are; `who` lends a Core3 creature's
// numbers where the world's spawns pack holds it, else the body's own answer; `respawn` absent is the data's common five
// minutes, nought stays down (the data's own rule); `body` takes a catalogue id now and a look of his own (`own:<id>`) from
// the thirteenth wave. Named by its own id (`stood:<world>:p<11 hex>`, `stoodName`), never its place in the list.
//
// Pure: imports only this folder's JSONC reader; it ships with the server by the story's own rule. Rule for this file (node
// runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no constructor parameter
// properties.

import { parseJsonc } from './jsonc.ts';

export const PEOPLE_FILE_VERSION = 1;

/** The reader's backstops (ours): every build holds a file to them alike, so none is live. */
export const PEOPLE_LIMITS = {
  rows: 4096,
  reach: 100000,
  height: 20000,
  points: 64,
  name: 80,
  note: 400,
  /** The longest respawn a row may ask for, seconds (a day). */
  respawn: 86400,
  /** The farthest a row may wander about its post, metres. */
  roam: 200,
};

/** The data's common wait before somebody killed stands again, seconds (four in five of the towns' rows) [emu]. */
export const PLACED_RESPAWN = 300;

/** One point of a placed person's round, in the file's frame. */
export interface PlacedRoutePoint {
  x: number;
  y: number;
  z: number;
  room?: number;
  linger?: boolean;
}

/** One row of the file, as read and cleaned. */
export interface PlacedPersonRow {
  id: string;
  /** A catalogue id (the body it stands as), or a look of his own (`own:<id>`, the thirteenth wave). */
  body: string;
  /** A Core3 creature whose numbers it takes where the world's spawns pack holds it. */
  who?: string;
  x: number;
  y: number;
  z: number;
  /** Degrees, `atan2(x, z)` in the file's frame. */
  heading: number;
  /** The room of the building it stands in, by index; absent out in the open. */
  room?: number;
  mood?: string;
  still?: boolean;
  peaceful?: boolean;
  respawn?: number;
  route?: PlacedRoutePoint[];
  roam?: number;
  state?: string;
  name?: string;
  note?: string;
  at?: number;
}

export interface PeopleRead {
  rows: PlacedPersonRow[];
  skipped: { id: string; why: string }[];
  unknown: string[];
  problem: string | null;
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const BODY = /^[A-Za-z0-9_.:-]{1,96}$/;
const MOOD = /^[a-z0-9_]{1,64}$/;
const STATE = /^[a-z0-9_]+=[a-z0-9_]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ORDER: (keyof PlacedPersonRow)[] = ['id', 'body', 'who', 'x', 'y', 'z', 'heading', 'room', 'mood', 'still', 'peaceful', 'respawn', 'roam', 'state', 'name', 'note', 'route', 'at'];
const FIELDS = new Set<string>(ORDER);

/** Whether an id is one a row may carry. */
export function isPersonId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v);
}

/** A fresh id from a name, unique among `taken`: its words in lower case joined by `-`, numbered from 1 where taken. */
export function mintPersonId(base: string, taken: ReadonlySet<string>): string {
  const stem = (base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'person').slice(0, 56);
  const s = /^[a-z0-9]/.test(stem) ? stem : `person-${stem}`;
  for (let n = 1; ; n++) {
    const id = `${s}-${n}`;
    if (!taken.has(id)) return id;
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** One row cleaned, or why it is refused. A field this build does not read is kept out and named in `unknown`. */
export function readPersonRow(v: unknown, unknown: string[] = []): PlacedPersonRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a row is an object';
  const o = v as Record<string, unknown>;
  if (!isPersonId(o.id)) return 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)';
  const id = o.id;
  for (const k of Object.keys(o)) if (!FIELDS.has(k)) unknown.push(`${id}.${k}`);
  if (typeof o.body !== 'string' || !BODY.test(o.body)) return 'its body is a catalogue id (or own:<id>)';
  const L = PEOPLE_LIMITS;
  const x = num(o.x);
  const y = num(o.y);
  const z = num(o.z);
  if (x === undefined || y === undefined || z === undefined) return 'its place is three numbers';
  if (Math.abs(x) > L.reach || Math.abs(z) > L.reach || Math.abs(y) > L.height) return 'its place is too far out';
  const heading = num(o.heading) ?? 0;
  const row: PlacedPersonRow = { id, body: o.body, x, y, z, heading: ((heading % 360) + 360) % 360 };
  if (o.who !== undefined) {
    if (typeof o.who !== 'string' || !BODY.test(o.who)) return 'its who is a creature\'s name';
    row.who = o.who;
  }
  if (o.room !== undefined) {
    const r = num(o.room);
    if (r === undefined || !Number.isInteger(r) || r < 1 || r > 4096) return 'its room is a room\'s index (1 and on)';
    row.room = r;
  }
  if (o.mood !== undefined) {
    if (typeof o.mood !== 'string' || !MOOD.test(o.mood)) return 'its mood is a mood\'s name';
    row.mood = o.mood;
  }
  for (const flag of ['still', 'peaceful'] as const) {
    if (o[flag] === undefined) continue;
    if (typeof o[flag] !== 'boolean') return `${flag} is true or false`;
    row[flag] = o[flag] as boolean;
  }
  if (o.respawn !== undefined) {
    const r = num(o.respawn);
    if (r === undefined || r < 0 || r > L.respawn) return `its respawn is 0 to ${L.respawn} seconds`;
    row.respawn = r;
  }
  if (o.roam !== undefined) {
    const r = num(o.roam);
    if (r === undefined || r < 0 || r > L.roam) return `its roam is 0 to ${L.roam} m`;
    row.roam = r;
  }
  if (o.state !== undefined) {
    if (typeof o.state === 'string' && STATE.test(o.state)) row.state = o.state;
    else unknown.push(`${id}.state`);
  }
  if (o.route !== undefined) {
    if (!Array.isArray(o.route) || o.route.length > L.points) return `its route is a list of at most ${L.points} points`;
    const route: PlacedRoutePoint[] = [];
    for (const p of o.route) {
      const q = p as Record<string, unknown>;
      const px = num(q?.x);
      const py = num(q?.y);
      const pz = num(q?.z);
      if (px === undefined || py === undefined || pz === undefined) return 'a route point is { x, y, z }';
      const pt: PlacedRoutePoint = { x: px, y: py, z: pz };
      if (q.room !== undefined) {
        const r = num(q.room);
        if (r === undefined || !Number.isInteger(r) || r < 1) return "a route point's room is a room's index";
        pt.room = r;
      }
      if (q.linger === true) pt.linger = true;
      route.push(pt);
    }
    if (route.length) row.route = route;
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

/** Read a world's file (the frame as every placements file's: raw on the ground, the game's in a space zone). */
export function readPeopleFile(text: string, world: string, kindOfWorld: 'ground' | 'space', raws?: Record<string, unknown>[]): PeopleRead {
  const out: PeopleRead = { rows: [], skipped: [], unknown: [], problem: null };
  const doc = parseJsonc(text);
  if (doc.error) {
    out.problem = `it does not read (line ${doc.error.line}, column ${doc.error.col}: ${doc.error.message})`;
    return out;
  }
  const v = doc.value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    out.problem = 'it is not an object';
    return out;
  }
  if (v.version !== PEOPLE_FILE_VERSION) {
    out.problem = `its version is not ${PEOPLE_FILE_VERSION}`;
    return out;
  }
  if (v.world !== world) {
    out.problem = `it says it is ${typeof v.world === 'string' ? v.world : 'no world'}'s, and its name says ${world}'s`;
    return out;
  }
  const frame = kindOfWorld === 'space' ? 'game' : 'raw';
  if (v.frame !== frame) {
    out.problem = `a ${kindOfWorld === 'space' ? 'space zone' : 'world on the ground'} is written in the ${frame} frame, and it says ${typeof v.frame === 'string' ? v.frame : 'none'}`;
    return out;
  }
  if (!Array.isArray(v.rows)) {
    out.problem = 'it has no rows list';
    return out;
  }
  const seen = new Set<string>();
  for (let i = 0; i < v.rows.length; i++) {
    const raw = v.rows[i];
    const named = raw && typeof raw === 'object' && isPersonId((raw as { id?: unknown }).id) ? (raw as { id: string }).id : `#${i}`;
    if (out.rows.length >= PEOPLE_LIMITS.rows) {
      out.skipped.push({ id: named, why: `past the ${PEOPLE_LIMITS.rows} rows a file may hold` });
      continue;
    }
    const row = readPersonRow(raw, out.unknown);
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
    raws?.push(raw as Record<string, unknown>);
  }
  return out;
}

/** A whole file's text: one line a row, sorted by id, each row's fields in one fixed order (extras after them). */
export function peopleFileText(world: string, frame: 'raw' | 'game', rows: readonly Record<string, unknown>[]): string {
  const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const lines = sorted.map((r) => {
    const parts: string[] = [];
    for (const k of ORDER) if (r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    for (const k of Object.keys(r)) if (!FIELDS.has(k) && r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    return `    { ${parts.join(', ')} }`;
  });
  const body = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${PEOPLE_FILE_VERSION},\n  "world": ${JSON.stringify(world)},\n  "frame": ${JSON.stringify(frame)},\n  "rows": ${body}\n}\n`;
}

/** Two rows that stand and read the same. */
export function samePersonRow(a: PlacedPersonRow, b: PlacedPersonRow): boolean {
  return JSON.stringify(ORDER.map((k) => a[k] ?? null)) === JSON.stringify(ORDER.map((k) => b[k] ?? null));
}

/** A cleaned row to write, carrying what the row it replaces held that this build does not read. */
export function personWithExtras(row: PlacedPersonRow, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (was) for (const k of Object.keys(was)) if (!FIELDS.has(k) && !(k in out)) out[k] = was[k];
  return out;
}

/**
 * A placed row as the standing people read one (`StandingRow`, written out here: this folder imports nothing of the world's):
 * its body as the row's `id`, its creature as `who` (empty: the body answers), its place and heading in the file's frame (the
 * heading in radians, as the data's are), `cell` 1 in a room (any number past nought says indoors), its own key, and
 * `src: 'placed'`, which names it by its key and stands it after everybody else.
 */
export interface PlacedStandingRow {
  who: string;
  id: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  cell: number;
  room?: number;
  respawn: number;
  where: string;
  still?: boolean;
  peaceful?: boolean;
  key: string;
  mood?: string;
  route?: { x: number; y: number; z: number; room?: number; linger?: boolean }[];
  roam?: number;
  state?: string;
  src: 'placed';
  name?: string;
}

export function placedStandingRow(r: PlacedPersonRow): PlacedStandingRow {
  const out: PlacedStandingRow = { who: r.who ?? '', id: r.body, x: r.x, y: r.y, z: r.z, heading: (r.heading * Math.PI) / 180, cell: r.room !== undefined ? 1 : 0, respawn: r.respawn ?? PLACED_RESPAWN, where: 'placed', key: r.id, src: 'placed' };
  if (r.room !== undefined) out.room = r.room;
  if (r.still !== undefined) out.still = r.still;
  if (r.peaceful !== undefined) out.peaceful = r.peaceful;
  if (r.mood) out.mood = r.mood;
  if (r.route) out.route = r.route.map((p) => ({ ...p }));
  if (r.roam !== undefined) out.roam = r.roam;
  if (r.state) out.state = r.state;
  if (r.name) out.name = r.name;
  return out;
}

/**
 * What a placed person hands over to paste into a story's cast file (Map-maker I's "Copy as cast"): its world, the raw
 * frame, its place, heading (degrees), room and mood, in the shape a cast file's `at` takes.
 */
export function castSnippet(r: PlacedPersonRow, world: string): string {
  const at: Record<string, unknown> = { world, f: 'raw', at: [Math.round(r.x * 100) / 100, Math.round(r.y * 100) / 100, Math.round(r.z * 100) / 100], heading: Math.round(r.heading) };
  if (r.room !== undefined) at.room = r.room;
  if (r.mood) at.mood = r.mood;
  return `${JSON.stringify(at, null, 2)}\n`;
}
