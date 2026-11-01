// The water file (Map-maker II, DESIGN.md §2.7): `public/placements/water/<world>.json`, the lakes of ours a world
// stands, as plain JSON a build ships and every browser reads, written only by the dev server's batch.
//
//   { "version": 1, "world": "helens", "frame": "raw",
//     "rows": [
//       { "id": "spirit-lake", "kind": "lake", "name": "Spirit Lake", "h": 749.82, "points": [[1204, -3302.5], ...],
//         "shader": null, "look": { "color": "#2f6f8a", "opacity": 0.8, "ripple": 1, "drift": 1 }, "at": 1793000000000 }
//     ] }
//
// A row is one lake: a level surface at `h` metres over an outline of points in the world's raw frame (the terrain's own
// frame on a converted world, `gx = cx - x`, `gz = z - cz`; raw about (0, 0) on a real-elevation world), drawn with the
// look of the world's own water shader `shader` names (a key as the terrain names one, `wter_spec`) or, with none, the
// planet's own water; `look` moves any of its four numbers of its own over that (the basins' shape). A lake of ours is to
// the game exactly a client lake (`ourWater.ts`).
//
// Or one river (the sixth wave): `{ "id", "kind": "river", "points": [[x, z, h], ...], "width", "velocity", "shader",
// "look", "fallFrom" }`, a spine of at least two points in the same raw frame each carrying the surface's own height there,
// the strip's width in metres, how fast it runs from its first point to its last in metres a second, and the angle past
// which a reach between two points is a fall rather than water (absent: `RIVER_TUNE.slopeMax`). The terrain's own wet
// rivers (`AffectorRiver` with a local water table) are made rows of this very shape and read by this very reader
// (`soeRiverRows`), so SOE's test rivers and ours are one thing to the game.
//
// **Backstops, not live** (`WATER_LIMITS`): every build agrees on what a committed file means, so a row past one is skipped
// and named by every build alike; the editor's own soft lines are notes on its bar.
//
// Pure: imports only the story's JSONC reader (shipped whole). The release carries it (`tools/launcher/pack.mjs`'s source
// list), since the walk grid's bake reads a world's lakes through it. Rule for this file (node runs it with type stripping):
// every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { parseJsonc } from '../../story/jsonc.ts';

export const WATER_VERSION = 1;

/** The reader's backstops (ours), far past any use: every build holds a file to them alike, so none is live. */
export const WATER_LIMITS = {
  /** Lakes a file holds. */
  rows: 4096,
  /** Points an outline holds (a traced one is held far under this by the editor, `WATER_TUNE.mostPoints`). */
  points: 4096,
  /** Metres either way across the ground a point may stand. */
  reach: 100000,
  /** Metres up or down a surface may stand. */
  height: 20000,
  /** The longest a name or a note may be. */
  words: 200,
  /** A river's width, metres (at least `widthLeast`). */
  width: 2000,
  widthLeast: 0.25,
  /** How fast a river may run, metres a second either way. */
  velocity: 100,
  /** The largest slope limit a river may name, degrees. */
  fallFrom: 89,
};

/** A lake's look of its own, each number moving the look its shader (or the planet) gives it; absent, that look's. */
export interface WaterLookRow {
  /** sRGB hex, "#rrggbb". */
  color?: string;
  /** 0 to 1. */
  opacity?: number;
  /** Multiplier on the fine ripples' slopes, 0 to 8. */
  ripple?: number;
  /** Multiplier on how fast the fine ripples drift, 0 to 8. */
  drift?: number;
}

/** One lake of the file, as read and cleaned. */
export interface WaterLakeRow {
  id: string;
  kind: 'lake';
  name?: string;
  note?: string;
  /** The surface's height, metres. */
  h: number;
  /** The outline in the world's raw frame, `[x, z]` a point, 3 to `WATER_LIMITS.points` of them. */
  points: [number, number][];
  /** The world's own water shader whose look it wears (a key, `wter_spec`), or null for the planet's own water. */
  shader: string | null;
  look?: WaterLookRow;
  at?: number;
}

/** One river of the file (the sixth wave), as read and cleaned. */
export interface WaterRiverRow {
  id: string;
  kind: 'river';
  name?: string;
  note?: string;
  /** The spine in the world's raw frame, `[x, z, h]` a point (h the surface's height there), 2 to `WATER_LIMITS.points` of them. */
  points: [number, number, number][];
  /** The strip's width, metres. */
  width: number;
  /** How fast it runs from its first point to its last, metres a second (its detail drifts at it, the moving air's liquid pulls toward it). */
  velocity: number;
  /** The world's own water shader whose look it wears, or null for the planet's own water. */
  shader: string | null;
  look?: WaterLookRow;
  /** Degrees past which a reach between two points is a fall rather than water; absent, `RIVER_TUNE.slopeMax`. */
  fallFrom?: number;
  at?: number;
}

/** A row of the water file: a lake or a river. */
export type WaterRow = WaterLakeRow | WaterRiverRow;

/** What reading a file gave. */
export interface WaterRead {
  rows: WaterRow[];
  skipped: { id: string; why: string }[];
  unknown: string[];
  problem: string | null;
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEX = /^#[0-9a-f]{6}$/i;
/** A shader key as the terrain writes one (`shaderKey`): a name of letters, digits, `_`, `-` and `.`. */
const SHADER = /^[a-z0-9_.-]{1,80}$/i;
const FIELDS = new Set(['id', 'kind', 'name', 'note', 'h', 'points', 'shader', 'look', 'at']);
/** A river's fields (the sixth wave). */
const RIVER_FIELDS = new Set(['id', 'kind', 'name', 'note', 'points', 'width', 'velocity', 'shader', 'look', 'fallFrom', 'at']);
/** The order a row's fields are written in: a lake's are the fields it always had in the order it always had them. */
const ORDER: string[] = ['id', 'kind', 'name', 'note', 'h', 'width', 'velocity', 'fallFrom', 'shader', 'look', 'points', 'at'];
const LOOK_FIELDS = new Set(['color', 'opacity', 'ripple', 'drift']);

/** The fields a row of this kind carries (a river's, else a lake's). */
function fieldsOf(kind: unknown): ReadonlySet<string> {
  return kind === 'river' ? RIVER_FIELDS : FIELDS;
}

/** Whether a row read is a river. */
export function isRiverRow(r: WaterRow): r is WaterRiverRow {
  return r.kind === 'river';
}

/** Whether a row read is a lake. */
export function isLakeRow(r: WaterRow): r is WaterLakeRow {
  return r.kind === 'lake';
}

/** Whether an id names a lake. */
export function isWaterId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v);
}

/** A fresh id from a name, unique among `taken`: its words in lower case, joined by `-`, with a number where it is taken. */
export function mintWaterId(base: string, taken: ReadonlySet<string>): string {
  const stem = (base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'lake').slice(0, 56);
  const s = /^[a-z0-9]/.test(stem) ? stem : `lake-${stem}`;
  if (!taken.has(s)) return s;
  for (let n = 2; ; n++) {
    const id = `${s}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** A look read as the reader reads one, or why not. */
export function readWaterLook(v: unknown): WaterLookRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'its look is an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!LOOK_FIELDS.has(k)) return `its look carries ${k}, which is none of color, opacity, ripple and drift`;
  const out: WaterLookRow = {};
  if (o.color !== undefined) {
    if (typeof o.color !== 'string' || !HEX.test(o.color)) return 'its look\'s colour is not "#rrggbb"';
    out.color = o.color.toLowerCase();
  }
  const number = (k: 'opacity' | 'ripple' | 'drift', most: number): string | null => {
    const n = o[k];
    if (n === undefined) return null;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > most) return `its look's ${k} is a number from 0 to ${most}`;
    out[k] = n;
    return null;
  };
  const why = number('opacity', 1) ?? number('ripple', 8) ?? number('drift', 8);
  if (why) return why;
  return out;
}

/** A shader, a look, a name, a note and a moment, read onto a row as either kind reads them; why not, or null. */
function readCommon(o: Record<string, unknown>, row: { shader: string | null; name?: string; note?: string; look?: WaterLookRow; at?: number }): string | null {
  if (o.shader !== undefined && o.shader !== null) {
    if (typeof o.shader !== 'string' || !SHADER.test(o.shader)) return 'its shader is a water shader\'s key (letters, digits, _, - and .) or null';
    row.shader = o.shader;
  }
  for (const k of ['name', 'note'] as const) {
    const w = o[k];
    if (w === undefined) continue;
    if (typeof w !== 'string' || w.length > WATER_LIMITS.words || /[\u0000-\u001f]/.test(w)) return `its ${k} is words, ${WATER_LIMITS.words} at most`;
    row[k] = w;
  }
  if (o.look !== undefined) {
    const look = readWaterLook(o.look);
    if (typeof look === 'string') return look;
    if (Object.keys(look).length) row.look = look;
  }
  if (o.at !== undefined) {
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0) return 'its at is a time in milliseconds';
    row.at = o.at;
  }
  return null;
}

/**
 * A river cleaned (the sixth wave), or why it is refused: a spine of 2 to `WATER_LIMITS.points` finite points `[x, z, h]`
 * within the reach and the height, a width and a velocity within the limits, a slope limit within them, and what a lake
 * carries besides (a shader key or null, a look, a name, a note, a moment). Fields this build does not read go into `unknown`.
 */
function readRiverRow(o: Record<string, unknown> & { id: string }, unknown: string[]): WaterRiverRow | string {
  for (const k of Object.keys(o)) if (!RIVER_FIELDS.has(k)) unknown.push(`${o.id}.${k}`);
  if (!Array.isArray(o.points)) return 'its points are a list of [x, z, h]';
  if (o.points.length < 2) return 'a river has two points at least';
  if (o.points.length > WATER_LIMITS.points) return `a river has ${WATER_LIMITS.points} points at most`;
  const points: [number, number, number][] = [];
  for (const p of o.points) {
    if (!Array.isArray(p) || p.length !== 3) return "a river's point is [x, z, h]";
    const [x, z, h] = p as unknown[];
    if (typeof x !== 'number' || typeof z !== 'number' || typeof h !== 'number' || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(h)) return "a river's point is three numbers of metres";
    if (Math.abs(x) > WATER_LIMITS.reach || Math.abs(z) > WATER_LIMITS.reach) return `a point stands within ${WATER_LIMITS.reach} m either way`;
    if (Math.abs(h) > WATER_LIMITS.height) return `a point's height is within ${WATER_LIMITS.height} m either way`;
    points.push([x, z, h]);
  }
  if (typeof o.width !== 'number' || !Number.isFinite(o.width) || o.width < WATER_LIMITS.widthLeast || o.width > WATER_LIMITS.width) return `its width is a number of metres from ${WATER_LIMITS.widthLeast} to ${WATER_LIMITS.width}`;
  if (typeof o.velocity !== 'number' || !Number.isFinite(o.velocity) || Math.abs(o.velocity) > WATER_LIMITS.velocity) return `its velocity is a number of metres a second within ${WATER_LIMITS.velocity} either way`;
  const row: WaterRiverRow = { id: o.id, kind: 'river', points, width: o.width, velocity: o.velocity, shader: null };
  if (o.fallFrom !== undefined) {
    if (typeof o.fallFrom !== 'number' || !Number.isFinite(o.fallFrom) || o.fallFrom < 0 || o.fallFrom > WATER_LIMITS.fallFrom) return `its fallFrom is degrees from 0 to ${WATER_LIMITS.fallFrom}`;
    row.fallFrom = o.fallFrom;
  }
  const why = readCommon(o, row);
  if (why) return why;
  return row;
}

/**
 * One row cleaned, or why it is refused: an id, `kind` a lake or a river (`readRiverRow`), a lake's surface height and an
 * outline of 3 to `WATER_LIMITS.points` finite points within the reach, a shader key or null, a look, a name and a note of
 * words, a moment. Fields this build does not read go into `unknown`.
 */
export function readWaterRow(v: unknown, unknown: string[] = []): WaterRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a lake is an object';
  const o = v as Record<string, unknown>;
  if (!isWaterId(o.id)) return 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)';
  if (o.kind === 'river') return readRiverRow(o as Record<string, unknown> & { id: string }, unknown);
  if (o.kind !== 'lake') return 'its kind is lake or river';
  for (const k of Object.keys(o)) if (!FIELDS.has(k)) unknown.push(`${o.id}.${k}`);
  if (typeof o.h !== 'number' || !Number.isFinite(o.h) || Math.abs(o.h) > WATER_LIMITS.height) return `its height (h) is a number of metres within ${WATER_LIMITS.height} either way`;
  if (!Array.isArray(o.points)) return 'its points are a list of [x, z]';
  if (o.points.length < 3) return 'an outline has three points at least';
  if (o.points.length > WATER_LIMITS.points) return `an outline has ${WATER_LIMITS.points} points at most`;
  const points: [number, number][] = [];
  for (const p of o.points) {
    if (!Array.isArray(p) || p.length !== 2) return 'a point is [x, z]';
    const [x, z] = p as unknown[];
    if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > WATER_LIMITS.reach || Math.abs(z) > WATER_LIMITS.reach) return `a point is two numbers of metres within ${WATER_LIMITS.reach} either way`;
    points.push([x, z]);
  }
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  if (!(Math.abs(area) > 1e-6)) return 'its outline has no area';
  let shader: string | null = null;
  if (o.shader !== undefined && o.shader !== null) {
    if (typeof o.shader !== 'string' || !SHADER.test(o.shader)) return 'its shader is a water shader\'s key (letters, digits, _, - and .) or null';
    shader = o.shader;
  }
  const row: WaterLakeRow = { id: o.id, kind: 'lake', h: o.h, points, shader };
  for (const k of ['name', 'note'] as const) {
    const w = o[k];
    if (w === undefined) continue;
    if (typeof w !== 'string' || w.length > WATER_LIMITS.words || /[\u0000-\u001f]/.test(w)) return `its ${k} is words, ${WATER_LIMITS.words} at most`;
    row[k] = w;
  }
  if (o.look !== undefined) {
    const look = readWaterLook(o.look);
    if (typeof look === 'string') return look;
    if (Object.keys(look).length) row.look = look;
  }
  if (o.at !== undefined) {
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0) return 'its at is a time in milliseconds';
    row.at = o.at;
  }
  return row;
}

/** Two looks that read the same. */
function sameLook(a: WaterLookRow | undefined, b: WaterLookRow | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.color === b.color && a.opacity === b.opacity && a.ripple === b.ripple && a.drift === b.drift;
}

/** Two rows that read the same: every field, their points to the bit and their moment (a lake's and a river's alike). */
export function sameWaterRow(a: WaterRow, b: WaterRow): boolean {
  if (a.kind === 'river' || b.kind === 'river') {
    if (a.kind !== 'river' || b.kind !== 'river') return false;
    if (a.id !== b.id || a.width !== b.width || a.velocity !== b.velocity || a.fallFrom !== b.fallFrom || a.shader !== b.shader || a.name !== b.name || a.note !== b.note || a.at !== b.at) return false;
    if (!sameLook(a.look, b.look) || a.points.length !== b.points.length) return false;
    for (let i = 0; i < a.points.length; i++) if (a.points[i][0] !== b.points[i][0] || a.points[i][1] !== b.points[i][1] || a.points[i][2] !== b.points[i][2]) return false;
    return true;
  }
  if (a.id !== b.id || a.kind !== b.kind || a.h !== b.h || a.shader !== b.shader || a.name !== b.name || a.note !== b.note || a.at !== b.at) return false;
  if (!sameLook(a.look, b.look) || a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i++) if (a.points[i][0] !== b.points[i][0] || a.points[i][1] !== b.points[i][1]) return false;
  return true;
}

/**
 * Read a world's water file. A file whose header is not this world's, or not the shape this build writes (its version, its
 * frame), is refused whole, since every lake in it would stand in the wrong place; a ground world alone keeps one (a space
 * zone's: "space maps are a later pass"). A bad row, a row past the backstop and a second row under one id are skipped
 * and named. Its rows are lakes and rivers, in the file's order.
 */
export function readWaterFile(text: string, world: string, kindOfWorld: 'ground' | 'space', raws?: Record<string, unknown>[]): WaterRead {
  const out: WaterRead = { rows: [], skipped: [], unknown: [], problem: null };
  if (kindOfWorld === 'space') {
    out.problem = 'a space zone keeps no water: space maps are a later pass';
    return out;
  }
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
  if (f.version !== WATER_VERSION) {
    out.problem = `its version is not ${WATER_VERSION}`;
    return out;
  }
  if (f.world !== world) {
    out.problem = `it says it is ${typeof f.world === 'string' ? f.world : 'no world'}'s, and its name says ${world}'s`;
    return out;
  }
  if (f.frame !== 'raw') {
    out.problem = `a world's water is written in the raw frame, and it says ${typeof f.frame === 'string' ? f.frame : 'none'}`;
    return out;
  }
  if (!Array.isArray(f.rows)) {
    out.problem = 'it has no rows list';
    return out;
  }
  const seen = new Set<string>();
  for (let i = 0; i < f.rows.length; i++) {
    const raw = f.rows[i];
    const named = raw && typeof raw === 'object' && isWaterId((raw as { id?: unknown }).id) ? (raw as { id: string }).id : `#${i}`;
    if (out.rows.length >= WATER_LIMITS.rows) {
      out.skipped.push({ id: named, why: `past the ${WATER_LIMITS.rows} lakes a file may hold` });
      continue;
    }
    const row = readWaterRow(raw, out.unknown);
    if (typeof row === 'string') {
      out.skipped.push({ id: named, why: row });
      continue;
    }
    if (seen.has(row.id)) {
      out.skipped.push({ id: row.id, why: 'a second lake under the same id' });
      continue;
    }
    seen.add(row.id);
    out.rows.push(row);
    if (raws) raws.push(raw as Record<string, unknown>);
  }
  return out;
}

/**
 * A whole file's text: its header a field a line, then one line a lake, sorted by id, each lake's fields in one fixed order
 * (its points last, since they are the long part), and after them whatever a row read from the file carried that this
 * build does not read. A change to one lake is a change to one line.
 */
export function waterFileText(world: string, rows: readonly Record<string, unknown>[]): string {
  const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const lines = sorted.map((r) => {
    const parts: string[] = [];
    // A row's own kind's fields in the one order (a lake's are the order it always had), then whatever else it carried.
    const known = fieldsOf(r.kind);
    for (const k of ORDER) {
      const v = r[k];
      if (v === undefined || !known.has(k)) continue;
      parts.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    }
    for (const k of Object.keys(r)) {
      if (known.has(k) || r[k] === undefined) continue;
      parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    }
    return `    { ${parts.join(', ')} }`;
  });
  const body = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${WATER_VERSION},\n  "world": ${JSON.stringify(world)},\n  "frame": "raw",\n  "rows": ${body}\n}\n`;
}

/** A row's own fields, for the batch's write-back: the cleaned row, with whatever the row it replaces held that this build does not read. */
export function waterWithExtras(row: WaterRow, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  const known = fieldsOf(row.kind);
  if (was) for (const k of Object.keys(was)) if (!known.has(k) && !(k in out)) out[k] = was[k];
  return out;
}

/** What a page or the bake read of a world's water file: its lakes and rivers, its bytes, what it skipped and why it was not read. */
export interface WaterLoaded {
  rows: WaterRow[];
  bytes: number;
  skipped: { id: string; why: string }[];
  problem: string | null;
  rev: string | null;
}
