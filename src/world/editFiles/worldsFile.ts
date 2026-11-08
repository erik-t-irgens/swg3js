// The worlds of yours (the race drawer's fourth wave, DESIGN.md §5c): `public/placements/worlds/all.json`, one file every
// world shares as the looks file is, a world a row. A row is a world made in the world editor, either new (`kind: 'new'`: a
// flat, test or raster ground, a converted pack's ground pictures borrowed, a sky in parts, water colours, gravity, an
// arrival) or a copy of a world of the game's (`kind: 'copy'`: that world's converted terrain and its buildings, nothing
// else). Its id is `ours_<name>` and can never be a world's or a pack's of the game's, so every edit file it gets is its own.
// Merged into the planet list after the game's own (`src/data/ourWorlds.ts`); with no file the list is the game's.
//
// Pure: imports only the story's JSONC reader. Rule for this file (node runs it with type stripping): every import with its
// `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { parseJsonc } from '../../story/jsonc.ts';

export const WORLDS_FILE_VERSION = 1;

/** The prefix every world of yours carries, which no world or pack of the game's does. */
export const OUR_WORLD_PREFIX = 'ours_';

/** The reader's backstops (ours): every build holds a file to them alike, so none is live. */
export const WORLDS_LIMITS = {
  rows: 256,
  name: 60,
  desc: 400,
  note: 400,
  /** Metres a side: 1 to 32 km, the design's. */
  sizeLeast: 1000,
  sizeMost: 32768,
  /** Suns and moons: the owner's counts. */
  suns: 3,
  moons: 4,
  /** A body's size, in the sky's own units (the converted skies' run about 0.05 to 0.6). */
  bodyMost: 4,
  /** The climate's weights (the world row's own most). */
  climate: 8,
  /** Heights and lifts, metres either way. */
  height: 20000,
};

/** A body of the sky: its picture (`<pack>/<body>`: sun, sun2, moon, moon2 or c<n> of that pack's sky), where and how big. */
export interface WorldBody {
  pic: string;
  /** Degrees over the horizon. */
  el: number;
  /** Degrees round from north, clockwise. */
  az: number;
  size: number;
}

/** A world's sky in parts. */
export interface WorldSky {
  /** The converted pack whose sky's colours (gradient, ramp, fog, skybox, stars) it takes; absent for the procedural dome. */
  colours?: string;
  /** The procedural dome's own colours (no `colours`), as colour numbers. */
  dome?: { top: number; horizon: number; sun: number; fog: number };
  /** The converted pack whose cloud layers it takes, or `none`; absent, the colours' own. */
  clouds?: string;
  /** The suns (the first is the light's) and moons; absent, the sky's own. */
  suns?: WorldBody[];
  moons?: WorldBody[];
}

/** A new world's ground to start from. */
export type WorldStart =
  | { kind: 'flat'; height: number }
  | { kind: 'noise'; base: number; amplitude: number; frequency: number; octaves: number; ridged: number; flatten: number; detail: number }
  | { kind: 'raster'; of: string };

export interface WorldRow {
  id: string;
  kind: 'new' | 'copy';
  /** A copy: the world copied (a world of the game's with a pack). */
  of?: string;
  name: string;
  desc?: string;
  note?: string;
  /** On the creator's start list (off by default). */
  listed?: boolean;
  /** A new world: metres a side. */
  size?: number;
  start?: WorldStart;
  /** The ground's pictures: a converted pack, its base family, and optionally a world whose elevation rules it takes. */
  ground?: { pack: string; base: string; rules?: string };
  sky?: WorldSky;
  /** The world row's weather (laid under the locations file's own world row): the levels' weights and a forced kind. */
  weather?: { climate?: number[]; kind?: 'rain' | 'dust' | 'snow' };
  /** The colour and opacity the world's own water is drawn in, and a new lake of ours starts with. */
  water?: { color: number; opacity: number };
  gravity?: number;
  /** Where it brings a player in: a raw place, a height and a heading. */
  arrival?: { x: number; z: number; y: number; heading?: number };
  at?: number;
}

export interface WorldsRead {
  rows: WorldRow[];
  skipped: { id: string; why: string }[];
  unknown: string[];
  problem: string | null;
}

const ID = /^ours_[a-z0-9_]{1,35}$/;
const PACK = /^[a-z0-9_]{1,40}$/;
const FAMILY = /^[^\u0000-\u001f\u007f"\\]{1,80}$/;
const PIC = /^[a-z0-9_]{1,40}\/(sun|sun2|moon|moon2|c[0-9]{1,2})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ORDER: (keyof WorldRow)[] = ['id', 'kind', 'of', 'name', 'desc', 'note', 'listed', 'size', 'start', 'ground', 'sky', 'weather', 'water', 'gravity', 'arrival', 'at'];
const FIELDS = new Set<string>(ORDER);
const KINDS = new Set(['rain', 'dust', 'snow']);

/** Whether a string is a world of yours' id: `ours_` and then a-z, 0-9 and _ (40 at most in all, a pack id's own room). */
export function isWorldId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v);
}

/** A fresh id from a name, unique among `taken`: `ours_` and the name's letters and digits, a number after it where taken. */
export function mintWorldId(name: string, taken: ReadonlySet<string>): string {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'world';
  let id = `${OUR_WORLD_PREFIX}${stem}`;
  for (let n = 2; taken.has(id); n++) id = `${OUR_WORLD_PREFIX}${stem}_${n}`;
  return id;
}

function num(v: unknown, lo: number, hi: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

function colour(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : null;
}

function readBody(v: unknown, what: string): WorldBody | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `${what} is not an object`;
  const o = v as Record<string, unknown>;
  if (typeof o.pic !== 'string' || !PIC.test(o.pic)) return `${what}'s pic is <pack>/<sun, sun2, moon, moon2 or c<n>>`;
  const el = num(o.el, -90, 90);
  const az = num(o.az, -360, 360);
  const size = num(o.size, 0.001, WORLDS_LIMITS.bodyMost);
  if (el === null) return `${what}'s el is degrees, -90 to 90`;
  if (az === null) return `${what}'s az is degrees, -360 to 360`;
  if (size === null) return `${what}'s size is a number over 0, ${WORLDS_LIMITS.bodyMost} at most`;
  return { pic: o.pic, el, az, size };
}

function readSky(v: unknown): WorldSky | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'its sky is not an object';
  const o = v as Record<string, unknown>;
  const sky: WorldSky = {};
  if (o.colours !== undefined) {
    if (typeof o.colours !== 'string' || !PACK.test(o.colours)) return "its sky's colours name a pack";
    sky.colours = o.colours;
  }
  if (o.dome !== undefined) {
    const d = o.dome as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') return "its sky's dome is an object";
    const top = colour(d.top);
    const horizon = colour(d.horizon);
    const sun = colour(d.sun);
    const fog = colour(d.fog);
    if (top === null || horizon === null || sun === null || fog === null) return "its sky's dome is four colours (top, horizon, sun, fog)";
    sky.dome = { top, horizon, sun, fog };
  }
  if (o.clouds !== undefined) {
    if (typeof o.clouds !== 'string' || !PACK.test(o.clouds)) return "its sky's clouds name a pack, or none";
    sky.clouds = o.clouds;
  }
  for (const k of ['suns', 'moons'] as const) {
    const list = o[k];
    if (list === undefined) continue;
    const most = k === 'suns' ? WORLDS_LIMITS.suns : WORLDS_LIMITS.moons;
    if (!Array.isArray(list) || list.length > most) return `its sky's ${k} are a list of ${most} at most`;
    const out: WorldBody[] = [];
    for (let i = 0; i < list.length; i++) {
      const b = readBody(list[i], `its sky's ${k}[${i}]`);
      if (typeof b === 'string') return b;
      out.push(b);
    }
    sky[k] = out;
  }
  return sky;
}

function readStart(v: unknown): WorldStart | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'its start is not an object';
  const o = v as Record<string, unknown>;
  const H = WORLDS_LIMITS.height;
  if (o.kind === 'flat') {
    const h = num(o.height, -H, H);
    return h === null ? `a flat start's height is metres, ${H} either way` : { kind: 'flat', height: h };
  }
  if (o.kind === 'noise') {
    const base = num(o.base, -H, H);
    const amplitude = num(o.amplitude, 0, 4000);
    const frequency = num(o.frequency, 0.00001, 0.1);
    const octaves = num(o.octaves, 1, 8);
    const ridged = num(o.ridged, 0, 1);
    const flatten = num(o.flatten, 0.1, 4);
    const detail = num(o.detail, 0, 20);
    if (base === null || amplitude === null || frequency === null || octaves === null || ridged === null || flatten === null || detail === null) {
      return 'a test start is base, amplitude (0 to 4000), frequency (0.00001 to 0.1), octaves (1 to 8), ridged (0 to 1), flatten (0.1 to 4) and detail (0 to 20)';
    }
    return { kind: 'noise', base, amplitude, frequency, octaves: Math.round(octaves), ridged, flatten, detail };
  }
  if (o.kind === 'raster') {
    if (typeof o.of !== 'string' || !PACK.test(o.of)) return "a raster start names a real-elevation world's id";
    return { kind: 'raster', of: o.of };
  }
  return 'its start is flat, noise or raster';
}

/** A row read as the shipped reader reads one, under the rules every build agrees on, or why not. */
export function readWorldRow(v: unknown, unknown: string[] = []): WorldRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'it is not an object';
  const o = v as Record<string, unknown>;
  if (!isWorldId(o.id)) return `its id is ${OUR_WORLD_PREFIX} and then a-z, 0-9 and _ (40 at most)`;
  for (const k of Object.keys(o)) if (!FIELDS.has(k)) unknown.push(`${o.id}.${k}`);
  if (o.kind !== 'new' && o.kind !== 'copy') return 'its kind is new or copy';
  const L = WORLDS_LIMITS;
  if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > L.name || CONTROL.test(o.name)) return `its name is words of ${L.name} characters at most`;
  const row: WorldRow = { id: o.id, kind: o.kind, name: o.name };
  if (o.kind === 'copy') {
    if (typeof o.of !== 'string' || !PACK.test(o.of)) return "a copy names the world it copies (of)";
    row.of = o.of;
    for (const k of ['size', 'start', 'ground'] as const) if (o[k] !== undefined) return `a copy takes its source's terrain and ground, never its own ${k}`;
  } else if (o.of !== undefined) return 'only a copy names a world it copies';
  for (const k of ['desc', 'note'] as const) {
    if (o[k] === undefined) continue;
    const s = o[k];
    if (typeof s !== 'string' || s.length > L[k] || CONTROL.test(s)) return `its ${k} is words of ${L[k]} characters at most`;
    if (s) row[k] = s;
  }
  if (o.listed !== undefined) {
    if (typeof o.listed !== 'boolean') return 'its listed is true or false';
    if (o.listed) row.listed = true;
  }
  if (o.kind === 'new') {
    const size = num(o.size, L.sizeLeast, L.sizeMost);
    if (size === null) return `a new world's size is metres a side, ${L.sizeLeast} to ${L.sizeMost}`;
    row.size = Math.round(size);
    const start = readStart(o.start ?? { kind: 'flat', height: 0 });
    if (typeof start === 'string') return start;
    row.start = start;
    if (o.ground !== undefined) {
      const g = o.ground as Record<string, unknown> | null;
      if (!g || typeof g !== 'object' || typeof g.pack !== 'string' || !PACK.test(g.pack) || typeof g.base !== 'string' || !FAMILY.test(g.base)) return "its ground is a pack and a base family's name";
      row.ground = { pack: g.pack, base: g.base };
      if (g.rules !== undefined) {
        if (typeof g.rules !== 'string' || !PACK.test(g.rules)) return "its ground's rules name a world whose rules it takes";
        row.ground.rules = g.rules;
      }
    }
  }
  if (o.sky !== undefined) {
    const s = readSky(o.sky);
    if (typeof s === 'string') return s;
    row.sky = s;
  }
  if (o.weather !== undefined) {
    const w = o.weather as Record<string, unknown> | null;
    if (!w || typeof w !== 'object' || Array.isArray(w)) return 'its weather is an object';
    const out: NonNullable<WorldRow['weather']> = {};
    if (w.climate !== undefined) {
      if (!Array.isArray(w.climate) || !w.climate.length || w.climate.length > L.climate || w.climate.some((x) => num(x, 0, 1000) === null)) return `its climate is up to ${L.climate} weights, 0 to 1000`;
      // The locations world row's own rule: a climate of noughts would have the schedule pick its heaviest level for ever.
      if (!(w.climate as number[]).some((x) => x > 0)) return 'its climate gives some level a weight above nought';
      out.climate = (w.climate as number[]).slice();
    }
    if (w.kind !== undefined) {
      if (typeof w.kind !== 'string' || !KINDS.has(w.kind)) return "its weather's kind is rain, dust or snow";
      out.kind = w.kind as 'rain' | 'dust' | 'snow';
    }
    row.weather = out;
  }
  if (o.water !== undefined) {
    const w = o.water as Record<string, unknown> | null;
    const c = w && typeof w === 'object' ? colour(w.color) : null;
    const op = w && typeof w === 'object' ? num(w.opacity, 0, 1) : null;
    if (c === null || op === null) return 'its water is a colour and an opacity (0 to 1)';
    row.water = { color: c, opacity: op };
  }
  if (o.gravity !== undefined) {
    const g = num(o.gravity, 0, 100);
    if (g === null) return 'its gravity is metres a second squared, 0 to 100';
    row.gravity = g;
  }
  if (o.arrival !== undefined) {
    const a = o.arrival as Record<string, unknown> | null;
    const H = L.height * 4;
    const x = a && typeof a === 'object' ? num(a.x, -H, H) : null;
    const z = a && typeof a === 'object' ? num(a.z, -H, H) : null;
    const y = a && typeof a === 'object' ? num(a.y, -L.height, L.height) : null;
    if (x === null || z === null || y === null) return 'its arrival is a raw x and z and a height y';
    row.arrival = { x, z, y };
    if (a!.heading !== undefined) {
      const h = num(a!.heading, -10, 10);
      if (h === null) return "its arrival's heading is radians";
      row.arrival.heading = h;
    }
  }
  if (o.at !== undefined) {
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0) return 'its at is a time in milliseconds';
    row.at = o.at;
  }
  return row;
}

/** Read the file: every row a world, a row past the backstop or a second of an id skipped and named. */
export function readWorldsFile(text: string, raws?: Record<string, unknown>[]): WorldsRead {
  const out: WorldsRead = { rows: [], skipped: [], unknown: [], problem: null };
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
  if (v.version !== WORLDS_FILE_VERSION) {
    out.problem = `its version is not ${WORLDS_FILE_VERSION}`;
    return out;
  }
  if (!Array.isArray(v.rows)) {
    out.problem = 'it has no rows list';
    return out;
  }
  const seen = new Set<string>();
  for (let i = 0; i < v.rows.length; i++) {
    const raw = v.rows[i];
    const named = raw && typeof raw === 'object' && isWorldId((raw as { id?: unknown }).id) ? (raw as { id: string }).id : `#${i}`;
    if (out.rows.length >= WORLDS_LIMITS.rows) {
      out.skipped.push({ id: named, why: `past the ${WORLDS_LIMITS.rows} rows a file may hold` });
      continue;
    }
    const row = readWorldRow(raw, out.unknown);
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
export function worldsFileText(rows: readonly Record<string, unknown>[]): string {
  const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const lines = sorted.map((r) => {
    const parts: string[] = [];
    for (const k of ORDER) if (r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    for (const k of Object.keys(r)) if (!FIELDS.has(k) && r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    return `    { ${parts.join(', ')} }`;
  });
  const body = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${WORLDS_FILE_VERSION},\n  "rows": ${body}\n}\n`;
}

/** What a world is made from, in one canonical form (never its name, note or time). */
export function worldContent(r: WorldRow): string {
  return JSON.stringify([r.kind, r.of ?? null, r.size ?? null, r.start ?? null, r.ground ?? null, r.sky ?? null, r.weather ?? null, r.water ?? null, r.gravity ?? null, r.arrival ?? null, r.listed ?? false, r.desc ?? '']);
}

/** Two rows that make and read the same. */
export function sameWorldRow(a: WorldRow, b: WorldRow): boolean {
  return a.id === b.id && worldContent(a) === worldContent(b) && a.name === b.name && (a.note ?? '') === (b.note ?? '') && (a.at ?? null) === (b.at ?? null);
}

/** A cleaned row to write, carrying what the row it replaces held that this build does not read. */
export function worldWithExtras(row: WorldRow, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (was) for (const k of Object.keys(was)) if (!FIELDS.has(k) && !(k in out)) out[k] = was[k];
  return out;
}
