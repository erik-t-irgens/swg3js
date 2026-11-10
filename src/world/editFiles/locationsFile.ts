// The locations file (Map-maker II, DESIGN.md §2.10, its eighth wave): `public/placements/locations/<world>.json`, the
// places of ours a world draws on its maps, says as you walk into them, keeps players from building in and names on its
// loading screens, as plain JSON a build ships and every browser reads, written only by the dev server's batch.
//
//   { "version": 1, "world": "tatooine", "frame": "raw",
//     "rows": [
//       { "id": "world", "kind": "world", "cities": "noBuild", "loading": ["..."], "at": 1793000000000 },
//       { "id": "dune-town", "kind": "city", "name": "Dune Town", "shape": { "kind": "circle", "c": [-1250, -3600], "r": 300 },
//         "build": false, "loading": ["Sand gets everywhere."], "at": 1793000000000 }
//     ] }
//
// A row is one place: its `kind` (`city`, `place`, `landmark`, `area`, or a `zone` that is never on the map), its words
// (`name`, `desc` the card's tooltip, `note` never shown), its `shape` -- the story's own `Shape` exactly (`set.ts`): a
// circle `{ c, r }`, a rectangle `{ min, max }` or an outline `{ pts }`, in the world's raw frame (the terrain's own on a
// converted world, about (0, 0) on a real-elevation one; a space zone's file is in the game's frame and is drawn nowhere
// this pass) -- whether it is drawn on the maps (`map`, absent: true but for a zone), its name said walking in (`say`,
// absent: true for a city), whether players may put houses and props down in it (`build`, absent: true), the lines its
// loading screens draw one of (`loading`), and the world state it stands in (`state`, Restuss's). One row, id `world`,
// kind `world` and no shape, carries the world's own: its loading lines for a destination in no place, and `cities`
// (`'noBuild'`: the game's own cities, Core3's no-build areas and the client's no-build radii keep players off too).
//
// **The sky per place** (its ninth wave, DESIGN.md §2.11): any row may name `env` (one of the environment families of the
// sky the world draws, by name: its light, fog, clouds, weather effect, wind and beds), `weather` (a forced kind, `rain`,
// `dust` or `snow`, at the world's own level) and `grade` (a colour-grade look laid over the planet's own, eased in); the
// world row alone carries `climate` (the weather levels' weights in place of the code's table), `fog` (a whole fog look in
// place of the code's), `wind` (the unified wind's six multipliers, each where it is set) and `clouds` (multipliers on the
// volumetrics' cloud decks' cover, height, depth and density, each where it is set). The world row's `env`, `weather` and
// `grade` stand under every place's.
//
// **A field kept and not read** (`light`: the Light and shadow pass's) is left out of the row read and carried across
// every put by the batch's extras, so a row the editor writes never loses it.
//
// **Backstops, not live** (`LOCATION_LIMITS`): every build agrees on what a committed file means, so a row past one is
// skipped and named by every build alike.
//
// Pure: imports only the story's JSONC reader (shipped whole). Rule for this file (node runs it with type stripping): every
// import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { parseJsonc } from '../../story/jsonc.ts';

export const LOCATIONS_VERSION = 1;

/** The reader's backstops (ours), far past any use: every build holds a file to them alike, so none is live. */
export const LOCATION_LIMITS = {
  /** Places a file holds. */
  rows: 4096,
  /** Points an outline holds. */
  points: 1024,
  /** Metres either way across the ground a point may stand. */
  reach: 100000,
  /** The longest a name, a tooltip or a note may be. */
  words: 200,
  /** Loading lines a place carries, and the longest one. */
  lines: 32,
  lineWords: 400,
  /** The smallest a circle's radius may be, metres. */
  radiusLeast: 0.1,
};

/** A place's kind: the world's own row, or a place of ours. */
export type LocationKind = 'world' | 'city' | 'place' | 'landmark' | 'area' | 'zone';
export const LOCATION_KINDS: readonly LocationKind[] = ['world', 'city', 'place', 'landmark', 'area', 'zone'];

/** A forced weather kind a place may name (the weather's own `ForcedKind`, written out: this file imports nothing of the game's). */
export type LocationWeather = 'rain' | 'dust' | 'snow';
export const LOCATION_WEATHERS: readonly LocationWeather[] = ['rain', 'dust', 'snow'];

/**
 * A colour-grade look (`GradeLook`, `gradeMath.ts`, written out the same), each field the backstop it is held to: what
 * the grade's own derivation would clamp anyway, so a file can name nothing the grade cannot take.
 */
export interface LocationGrade {
  gloom?: number;
  heat?: number;
  warmth?: number;
  cool?: number;
  saturation?: number;
  contrast?: number;
  strength?: number;
}
export const GRADE_RANGES: Readonly<Record<keyof LocationGrade, readonly [number, number]>> = {
  gloom: [0, 1],
  heat: [0, 1],
  warmth: [-1, 1],
  cool: [0, 1],
  saturation: [-0.5, 0.5],
  contrast: [-0.2, 0.2],
  strength: [0, 4],
};
export const GRADE_KEYS = Object.keys(GRADE_RANGES) as (keyof LocationGrade)[];

/** A fog look (`FogLook`, `airTune.ts`, written out the same): all seven numbers, each held to its backstop. */
export interface LocationFog {
  morning: number;
  evening: number;
  morningLo: number;
  morningHi: number;
  eveningLo: number;
  eveningHi: number;
  top: number;
}
export const FOG_RANGES: Readonly<Record<keyof LocationFog, readonly [number, number]>> = {
  morning: [0, 1],
  evening: [0, 1],
  morningLo: [0, 4],
  morningHi: [0, 4],
  eveningLo: [0, 4],
  eveningHi: [0, 4],
  top: [0, 100],
};
export const FOG_KEYS = Object.keys(FOG_RANGES) as (keyof LocationFog)[];

/** The unified wind's world multipliers (`WIND_WORLDS`' six, `windMath.ts`'s `WORLD_KEYS`), each where it is set. */
export interface LocationWind {
  floor?: number;
  gust?: number;
  cover?: number;
  size?: number;
  wander?: number;
  devils?: number;
}
/** The wind's own console's ends for a world multiplier (`tuneWind`'s `0..20`). */
export const WIND_RANGE: readonly [number, number] = [0, 20];
export const WIND_KEYS: readonly (keyof LocationWind)[] = ['floor', 'gust', 'cover', 'size', 'wander', 'devils'];

/** Multipliers on the volumetrics' cloud decks (the feed's), each where it is set. */
export interface LocationClouds {
  cover?: number;
  height?: number;
  depth?: number;
  density?: number;
  /**
   * The sky's flat cloud sheets (`SwgSky`, at 1,500 and 2,300 m): a multiplier on both their heights, the deck's own
   * `height` where this is absent, else one; and on the size of their pictures (and the decks' pictures, which are the same).
   */
  sheetHeight?: number;
  sheetScale?: number;
}
export const CLOUD_RANGES: Readonly<Record<keyof LocationClouds, readonly [number, number]>> = {
  cover: [0, 4],
  height: [0.05, 20],
  depth: [0.05, 20],
  density: [0, 20],
  sheetHeight: [0.01, 20],
  sheetScale: [0.05, 20],
};
/** The sheets' height and picture-size multipliers a world row's clouds ask for (both one with none). */
export function sheetMultipliers(c: LocationClouds | null | undefined): { height: number; scale: number } {
  return { height: c?.sheetHeight ?? c?.height ?? 1, scale: c?.sheetScale ?? 1 };
}
export const CLOUD_KEYS = Object.keys(CLOUD_RANGES) as (keyof LocationClouds)[];

/** The most weather levels a climate names (a world's schedule pads a shorter one with its last weight and cuts a longer). */
export const CLIMATE_MOST = 8;

/** The story's own shape (`set.ts`'s `Shape`), written as it writes one. */
export type LocationShape = { kind: 'circle'; c: [number, number]; r: number } | { kind: 'rect'; min: [number, number]; max: [number, number] } | { kind: 'poly'; pts: [number, number][] };

/** One row of the file, as read and cleaned. */
export interface LocationRow {
  id: string;
  kind: LocationKind;
  name?: string;
  desc?: string;
  note?: string;
  /** Every row but the world's. */
  shape?: LocationShape;
  map?: boolean;
  say?: boolean;
  build?: boolean;
  loading?: string[];
  /** The world row only: `'noBuild'` keeps players off the game's own cities, no-build areas and no-build radii. */
  cities?: 'noBuild';
  state?: string;
  /** An environment family of the sky the world draws, by name (the ninth wave). */
  env?: string;
  /** A forced weather kind at the world's own level. */
  weather?: LocationWeather;
  /** A colour-grade look laid over the planet's own. */
  grade?: LocationGrade;
  /** The world row only: the weather levels' weights, in place of the code's table. */
  climate?: number[];
  /** The world row only: the ground fog's look, in place of the code's. */
  fog?: LocationFog;
  /** The world row only: the unified wind's world multipliers, each where it is set. */
  wind?: LocationWind;
  /** The world row only: multipliers on the cloud decks, each where it is set. */
  clouds?: LocationClouds;
  at?: number;
}

/** What reading a file gave. */
export interface LocationsRead {
  rows: LocationRow[];
  skipped: { id: string; why: string }[];
  unknown: string[];
  problem: string | null;
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const STATE = /^[a-z0-9_]+=[a-z0-9_]+$/;
/** The fields this build reads; every other is kept on the file and carried across a put, never read. */
const FIELDS = new Set(['id', 'kind', 'name', 'desc', 'note', 'shape', 'map', 'say', 'build', 'loading', 'cities', 'state', 'env', 'weather', 'grade', 'climate', 'fog', 'wind', 'clouds', 'at']);
/** The fields kept for a later pass (Light and shadow's `light`): carried, never refused as strange. */
export const LOCATION_LATER_FIELDS: readonly string[] = ['light'];
/** The order a row's fields are written in: its words first, its sky after its switches, its shape last (the long part). */
const ORDER: string[] = ['id', 'kind', 'name', 'desc', 'note', 'map', 'say', 'build', 'cities', 'state', 'env', 'weather', 'grade', 'climate', 'fog', 'wind', 'clouds', 'loading', 'shape', 'at'];
/** An environment family's name as a file may write it: words with no control characters, 64 at most. */
const FAMILY = /^[^\u0000-\u001f]{1,64}$/;

/** Whether an id names a row: the world's own, or a place's. */
export function isLocationId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v);
}

/** A fresh id from a name, unique among `taken`: its words in lower case, joined by `-`, with a number where it is taken. */
export function mintLocationId(base: string, taken: ReadonlySet<string>): string {
  const stem = (base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'place').slice(0, 56);
  let s = /^[a-z0-9]/.test(stem) ? stem : `place-${stem}`;
  // `world` is the world row's own id, never a place's.
  if (s === 'world') s = 'world-place';
  if (!taken.has(s)) return s;
  for (let n = 2; ; n++) {
    const id = `${s}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** A point read as `[x, z]` within the reach, or null. */
function pointOf(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [x, z] = v as unknown[];
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (Math.abs(x) > LOCATION_LIMITS.reach || Math.abs(z) > LOCATION_LIMITS.reach) return null;
  return [x, z];
}

/** A shape read as the story reads one (a rectangle's corners put in order), within the limits, or why not. */
export function readLocationShape(v: unknown): LocationShape | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'its shape is { "kind": "circle", "c": [x, z], "r": n }, a rect { "min", "max" } or a poly { "pts" }';
  const o = v as Record<string, unknown>;
  if (o.kind === 'circle') {
    const c = pointOf(o.c);
    if (!c) return `a circle's middle is [x, z] within ${LOCATION_LIMITS.reach} m`;
    if (typeof o.r !== 'number' || !Number.isFinite(o.r) || o.r < LOCATION_LIMITS.radiusLeast || o.r > LOCATION_LIMITS.reach) return `a circle's radius is ${LOCATION_LIMITS.radiusLeast} to ${LOCATION_LIMITS.reach} m`;
    return { kind: 'circle', c, r: o.r };
  }
  if (o.kind === 'rect') {
    const a = pointOf(o.min);
    const b = pointOf(o.max);
    if (!a || !b) return 'a rect is "min": [x, z] and "max": [x, z]';
    const min: [number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
    const max: [number, number] = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    if (!(max[0] - min[0] > 0) || !(max[1] - min[1] > 0)) return 'a rect has an area';
    return { kind: 'rect', min, max };
  }
  if (o.kind === 'poly') {
    if (!Array.isArray(o.pts)) return 'a poly is three or more [x, z] points';
    if (o.pts.length < 3) return 'a poly is three or more [x, z] points';
    if (o.pts.length > LOCATION_LIMITS.points) return `a poly has ${LOCATION_LIMITS.points} points at most`;
    const pts: [number, number][] = [];
    for (const p of o.pts) {
      const q = pointOf(p);
      if (!q) return `a poly's point is [x, z] within ${LOCATION_LIMITS.reach} m`;
      pts.push(q);
    }
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    if (!(Math.abs(area) > 1e-6)) return 'its outline has no area';
    return { kind: 'poly', pts };
  }
  return "a shape's kind is circle, rect or poly";
}

/** Words of a row's (a name, a tooltip, a note, a line), or why not. */
function wordsOf(v: unknown, most: number, what: string): string | { bad: string } {
  if (typeof v !== 'string' || v.length > most || /[\u0000-\u001f]/.test(v)) return { bad: `its ${what} is words, ${most} at most` };
  return v;
}

/**
 * Named numbers read in a fixed order (each finite and within its backstop), or why not. `whole` asks for every key; an
 * object naming none of them, or naming one it has not got, is refused.
 */
function numbersOf<K extends string>(v: unknown, keys: readonly K[], ranges: (k: K) => readonly [number, number], what: string, whole: boolean): Partial<Record<K, number>> | { bad: string } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { bad: `its ${what} is an object of ${keys.join(', ')}` };
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(keys as readonly string[]).includes(k)) return { bad: `its ${what} has no ${k} (${keys.join(', ')})` };
  const out: Partial<Record<K, number>> = {};
  let n = 0;
  for (const k of keys) {
    const x = o[k];
    if (x === undefined) {
      if (whole) return { bad: `its ${what} names all of ${keys.join(', ')}` };
      continue;
    }
    const [lo, hi] = ranges(k);
    if (typeof x !== 'number' || !Number.isFinite(x) || x < lo || x > hi) return { bad: `its ${what}'s ${k} is a number from ${lo} to ${hi}` };
    out[k] = x;
    n++;
  }
  if (!n) return { bad: `its ${what} names one of ${keys.join(', ')} at least` };
  return out;
}

/**
 * The sky's fields of a row (the ninth wave): `env`, `weather` and `grade` on any row, `climate`, `fog`, `wind` and
 * `clouds` on the world row alone, each cleaned onto `row`. Null, or why the row is refused.
 */
function readSkyFields(o: Record<string, unknown>, kind: LocationKind, row: LocationRow): string | null {
  if (o.env !== undefined) {
    if (typeof o.env !== 'string' || !FAMILY.test(o.env.trim())) return "its env is an environment family's name (64 characters at most)";
    row.env = o.env.trim();
  }
  if (o.weather !== undefined) {
    if (typeof o.weather !== 'string' || !(LOCATION_WEATHERS as readonly string[]).includes(o.weather)) return `its weather is ${LOCATION_WEATHERS.join(', ')} or absent (the area's own)`;
    row.weather = o.weather as LocationWeather;
  }
  if (o.grade !== undefined) {
    const g = numbersOf(o.grade, GRADE_KEYS, (k) => GRADE_RANGES[k], 'grade', false);
    if ('bad' in g) return g.bad as string;
    row.grade = g as LocationGrade;
  }
  for (const k of ['climate', 'fog', 'wind', 'clouds'] as const) if (o[k] !== undefined && kind !== 'world') return `${k} is the world row's alone`;
  if (o.climate !== undefined) {
    const c = o.climate;
    if (!Array.isArray(c) || c.length < 1 || c.length > CLIMATE_MOST) return `its climate is a list of 1 to ${CLIMATE_MOST} weights, one a weather level`;
    let any = false;
    for (const w of c) {
      if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 1e6) return "its climate's weights are numbers of nought or more";
      if (w > 0) any = true;
    }
    if (!any) return 'its climate gives some level a weight above nought';
    row.climate = [...(c as number[])];
  }
  if (o.fog !== undefined) {
    const f = numbersOf(o.fog, FOG_KEYS, (k) => FOG_RANGES[k], 'fog', true);
    if ('bad' in f) return f.bad as string;
    row.fog = f as LocationFog;
  }
  if (o.wind !== undefined) {
    const w = numbersOf(o.wind, WIND_KEYS, () => WIND_RANGE, 'wind', false);
    if ('bad' in w) return w.bad as string;
    row.wind = w as LocationWind;
  }
  if (o.clouds !== undefined) {
    const c = numbersOf(o.clouds, CLOUD_KEYS, (k) => CLOUD_RANGES[k], 'clouds', false);
    if ('bad' in c) return c.bad as string;
    row.clouds = c as LocationClouds;
  }
  return null;
}

/** Two of a row's sky fields that read the same (each cleaned in a fixed order, so their text is the same). */
function sameSky(a: LocationRow, b: LocationRow): boolean {
  if (a.env !== b.env || a.weather !== b.weather) return false;
  for (const k of ['grade', 'climate', 'fog', 'wind', 'clouds'] as const) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  return true;
}

/**
 * One row cleaned, or why it is refused: an id, a kind, the world row with no shape and every other with one, its words,
 * its three switches as booleans, its loading lines, the world row's `cities`, a state tag and a moment. Fields this build
 * does not read go into `unknown` (the later waves' among them, which the batch carries across a put).
 */
export function readLocationRow(v: unknown, unknown: string[] = []): LocationRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a place is an object';
  const o = v as Record<string, unknown>;
  if (!isLocationId(o.id)) return 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)';
  if (typeof o.kind !== 'string' || !(LOCATION_KINDS as readonly string[]).includes(o.kind)) return `its kind is ${LOCATION_KINDS.join(', ')}`;
  const kind = o.kind as LocationKind;
  if ((kind === 'world') !== (o.id === 'world')) return kind === 'world' ? "the world's own row is id world" : 'the id world is the world row\'s alone';
  for (const k of Object.keys(o)) if (!FIELDS.has(k)) unknown.push(`${o.id}.${k}`);
  const row: LocationRow = { id: o.id, kind };
  for (const k of ['name', 'desc', 'note'] as const) {
    if (o[k] === undefined) continue;
    const w = wordsOf(o[k], LOCATION_LIMITS.words, k);
    if (typeof w !== 'string') return w.bad;
    row[k] = w;
  }
  if (kind === 'world') {
    if (o.shape !== undefined) return "the world's own row has no shape";
  } else {
    if (o.shape === undefined) return 'a place has a shape';
    const shape = readLocationShape(o.shape);
    if (typeof shape === 'string') return shape;
    row.shape = shape;
  }
  for (const k of ['map', 'say', 'build'] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'boolean') return `its ${k} is true or false`;
    if (kind === 'world') return `the world's own row has no ${k}`;
    row[k] = o[k] as boolean;
  }
  if (o.loading !== undefined) {
    if (!Array.isArray(o.loading)) return 'its loading is a list of lines';
    if (o.loading.length > LOCATION_LIMITS.lines) return `it has ${LOCATION_LIMITS.lines} loading lines at most`;
    const lines: string[] = [];
    for (const l of o.loading) {
      const w = wordsOf(l, LOCATION_LIMITS.lineWords, 'loading line');
      if (typeof w !== 'string') return w.bad;
      lines.push(w);
    }
    if (lines.length) row.loading = lines;
  }
  if (o.cities !== undefined) {
    if (kind !== 'world') return "cities is the world row's alone";
    if (o.cities !== 'noBuild') return 'its cities is "noBuild" or absent';
    row.cities = 'noBuild';
  }
  if (o.state !== undefined) {
    if (typeof o.state !== 'string' || !STATE.test(o.state)) return 'its state is a world state\'s tag, "key=value"';
    row.state = o.state;
  }
  const sky = readSkyFields(o, kind, row);
  if (sky) return sky;
  if (o.at !== undefined) {
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0) return 'its at is a time in milliseconds';
    row.at = o.at;
  }
  return row;
}

/** Two shapes that read the same, to the bit. */
function sameShape(a: LocationShape | undefined, b: LocationShape | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'circle' && b.kind === 'circle') return a.c[0] === b.c[0] && a.c[1] === b.c[1] && a.r === b.r;
  if (a.kind === 'rect' && b.kind === 'rect') return a.min[0] === b.min[0] && a.min[1] === b.min[1] && a.max[0] === b.max[0] && a.max[1] === b.max[1];
  if (a.kind === 'poly' && b.kind === 'poly') {
    if (a.pts.length !== b.pts.length) return false;
    for (let i = 0; i < a.pts.length; i++) if (a.pts[i][0] !== b.pts[i][0] || a.pts[i][1] !== b.pts[i][1]) return false;
    return true;
  }
  return false;
}

/** Two rows that read the same: every field, the shape to the bit, the lines in order and the moment. */
export function sameLocationRow(a: LocationRow, b: LocationRow): boolean {
  if (a.id !== b.id || a.kind !== b.kind || a.name !== b.name || a.desc !== b.desc || a.note !== b.note || a.map !== b.map || a.say !== b.say || a.build !== b.build || a.cities !== b.cities || a.state !== b.state || a.at !== b.at) return false;
  if (!sameShape(a.shape, b.shape) || !sameSky(a, b)) return false;
  const la = a.loading ?? [];
  const lb = b.loading ?? [];
  if (la.length !== lb.length) return false;
  for (let i = 0; i < la.length; i++) if (la[i] !== lb[i]) return false;
  return true;
}

/**
 * Read a world's locations file. A file whose header is not this world's, or not the shape this build writes (its version,
 * its frame: the raw frame on a ground world, the game's in a space zone), is refused whole, since every place in it would
 * stand in the wrong place. A bad row, a row past the backstop, a second row under one id and a second world row are skipped
 * and named. Its rows are in the file's order.
 */
export function readLocationsFile(text: string, world: string, kindOfWorld: 'ground' | 'space', raws?: Record<string, unknown>[]): LocationsRead {
  const out: LocationsRead = { rows: [], skipped: [], unknown: [], problem: null };
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
  if (f.version !== LOCATIONS_VERSION) {
    out.problem = `its version is not ${LOCATIONS_VERSION}`;
    return out;
  }
  if (f.world !== world) {
    out.problem = `it says it is ${typeof f.world === 'string' ? f.world : 'no world'}'s, and its name says ${world}'s`;
    return out;
  }
  const frame = kindOfWorld === 'space' ? 'game' : 'raw';
  if (f.frame !== frame) {
    out.problem = `a ${kindOfWorld === 'space' ? "space zone's places are written in the game's" : "world's places are written in the raw"} frame, and it says ${typeof f.frame === 'string' ? f.frame : 'none'}`;
    return out;
  }
  if (!Array.isArray(f.rows)) {
    out.problem = 'it has no rows list';
    return out;
  }
  const seen = new Set<string>();
  for (let i = 0; i < f.rows.length; i++) {
    const raw = f.rows[i];
    const named = raw && typeof raw === 'object' && isLocationId((raw as { id?: unknown }).id) ? (raw as { id: string }).id : `#${i}`;
    if (out.rows.length >= LOCATION_LIMITS.rows) {
      out.skipped.push({ id: named, why: `past the ${LOCATION_LIMITS.rows} places a file may hold` });
      continue;
    }
    const unknown: string[] = [];
    const row = readLocationRow(raw, unknown);
    if (typeof row === 'string') {
      out.skipped.push({ id: named, why: row });
      continue;
    }
    if (seen.has(row.id)) {
      out.skipped.push({ id: row.id, why: 'a second place under the same id' });
      continue;
    }
    seen.add(row.id);
    out.rows.push(row);
    // The later waves' fields are kept quietly; anything else is said.
    for (const u of unknown) if (!LOCATION_LATER_FIELDS.includes(u.slice(row.id.length + 1))) out.unknown.push(u);
    if (raws) raws.push(raw as Record<string, unknown>);
  }
  return out;
}

/**
 * A whole file's text: its header a field a line, then one line a place, sorted by id (the world row among them, under its
 * id), each place's fields in one fixed order (its shape last but its moment), and after them whatever a row read from the
 * file carried that this build does not read. A change to one place is a change to one line.
 */
export function locationsFileText(world: string, frame: 'raw' | 'game', rows: readonly Record<string, unknown>[]): string {
  const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const lines = sorted.map((r) => {
    const parts: string[] = [];
    for (const k of ORDER) {
      const v = r[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    }
    for (const k of Object.keys(r)) {
      if (FIELDS.has(k) || r[k] === undefined) continue;
      parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    }
    return `    { ${parts.join(', ')} }`;
  });
  const body = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${LOCATIONS_VERSION},\n  "world": ${JSON.stringify(world)},\n  "frame": ${JSON.stringify(frame)},\n  "rows": ${body}\n}\n`;
}

/** A row's own fields, for the batch's write-back: the cleaned row, with whatever the row it replaces held that this build does not read. */
export function locationsWithExtras(row: LocationRow, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (was) for (const k of Object.keys(was)) if (!FIELDS.has(k) && !(k in out)) out[k] = was[k];
  return out;
}

/** What a page read of a world's locations file: its rows, its bytes, what it skipped and why it was not read. */
export interface LocationsLoaded {
  rows: LocationRow[];
  bytes: number;
  skipped: { id: string; why: string }[];
  problem: string | null;
  rev: string | null;
}

// ---- What a place is to the maps: its middle and reach, whether it is drawn, said and built in. ----

/** Whether a row is drawn on the maps: `map`, absent true but for a zone (and never the world row). */
export function drawnOnMap(r: LocationRow): boolean {
  if (r.kind === 'world' || !r.shape) return false;
  return r.map ?? r.kind !== 'zone';
}

/** Whether a row's name is said walking into it: `say`, absent true for a city. */
export function saidOnEntry(r: LocationRow): boolean {
  if (r.kind === 'world' || !r.shape) return false;
  return r.say ?? r.kind === 'city';
}

/** Whether players may build in a row: `build`, absent true. */
export function buildable(r: LocationRow): boolean {
  return r.build ?? true;
}

/** A shape's middle (a circle's own, a rectangle's, an outline's mean point) and its reach from there (to its furthest point). */
export function shapeMiddle(s: LocationShape): { x: number; z: number; r: number } {
  if (s.kind === 'circle') return { x: s.c[0], z: s.c[1], r: s.r };
  if (s.kind === 'rect') {
    const x = (s.min[0] + s.max[0]) / 2;
    const z = (s.min[1] + s.max[1]) / 2;
    return { x, z, r: Math.sqrt((s.max[0] - x) ** 2 + (s.max[1] - z) ** 2) };
  }
  let x = 0;
  let z = 0;
  for (const p of s.pts) {
    x += p[0];
    z += p[1];
  }
  x /= s.pts.length;
  z /= s.pts.length;
  let r = 0;
  for (const p of s.pts) r = Math.max(r, Math.sqrt((p[0] - x) ** 2 + (p[1] - z) ** 2));
  return { x, z, r };
}

/** A shape's area, square metres (an outline's by its own crossings, whichever way round it is wound). */
export function shapeArea(s: LocationShape): number {
  if (s.kind === 'circle') return Math.PI * s.r * s.r;
  if (s.kind === 'rect') return (s.max[0] - s.min[0]) * (s.max[1] - s.min[1]);
  let a = 0;
  const p = s.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
}
