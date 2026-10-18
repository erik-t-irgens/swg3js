// A world's race tracks: read out of one plain file that ships with the build, `public/tracks/<world>.json`, shaped
// after the permanent placements' files (`src/story/placements.ts`) in every way but what a row is. A row here is a
// track -- a grid to start from and gates in order -- not a prop or a building, so it is a file of its own and never a
// third placements layer, which the streamer, the checker and the placements editor all read.
//
// **The frame is the file's.** On a planet a track is in the raw frame, the one `/loc` and a placement row are written
// in, carried into the game's by the very `toGame` the placements use; a space zone's file says `game`. `y` is absolute.
// A world is its pack id, and a real-elevation world, which has no pack of its own, keeps its tracks under the planet's
// own id (`public/tracks/monument.json`), which is the pack id the game gives it anyway, and its raw frame is centred on
// nought, as its `/loc` is.
//
// **A bad track is skipped and named; a file is refused whole only for a bad header** (its version, its world, its
// frame), since every track in it would be read in the wrong place. A track is one row: a bad gate makes the whole
// track bad, because a course with one gate missing is another course.
//
// Pure: imports the placements' reader for its JSON with comments and its frames, and `trackPath.ts`; no page, no
// three. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no
// namespace, no constructor parameter properties.

import { parseJsonc } from '../story/jsonc.ts';
import { toGame, type GamePlace, type PlacementFrame } from '../story/placements.ts';

export { trackFileOf, tracksPath } from './trackPath.ts';

/** The kinds a track may be raced as: what a vehicle was spawned as, never what it is. */
export type RaceKind = 'podracer' | 'speederbike';
export const RACE_KINDS: readonly RaceKind[] = ['podracer', 'speederbike'];
export type TrackKind = 'circuit' | 'sprint';
export const TRACK_VERSION = 1;

/**
 * The limits one shared reader holds every file to, and the dev server's editor with it. Ours. Not moved from the
 * browser: a limit the page moved and the endpoint did not would let the page write a file the reader then refuses.
 */
export const TRACK_LIMITS = {
  tracks: 50,
  gates: 200,
  /** A circuit and a sprint both need a start and somewhere to go. */
  gatesLeast: 2,
  widthLeast: 4,
  widthMost: 80,
  heightLeast: 5,
  heightMost: 100,
  /** The most `clear` may be, metres either side of the gate-to-gate line. */
  clearMost: 32,
  lapsMost: 99,
  /** Metres either way across the ground, and up or down. */
  reach: 100000,
  height: 20000,
  /** How far a turn's length may be off one before it is not a turn at all. */
  unit: 1e-3,
  name: 80,
  note: 400,
};

/** A place as the file holds it: `q` is `[w, x, y, z]` in the file's frame, as a placement row's. */
export interface TrackPlace {
  x: number;
  y: number;
  z: number;
  q: [number, number, number, number];
}

export interface TrackGate extends TrackPlace {
  /** Width and height of its window, metres. */
  w: number;
  h: number;
}

export interface TrackDef {
  /** `^[a-z0-9][a-z0-9_-]{0,63}$`, unique in its file. */
  id: string;
  name: string;
  note?: string;
  kind: TrackKind;
  /** Laps of a circuit; a sprint is one. */
  laps: number;
  /** The kinds it is raced as, read against the kind a vehicle was spawned as. */
  for: RaceKind[];
  /** Metres of plants kept off either side of the gate-to-gate line. */
  clear: number;
  grid: TrackPlace;
  /** Gate 0 is a circuit's start and finish; a sprint starts at gate 0 and ends at the last. */
  gates: TrackGate[];
  /** When it was written, milliseconds since the epoch. */
  at?: number;
}

/** What reading one file gave. */
export interface TrackRead {
  tracks: TrackDef[];
  /** Tracks refused, by id (or `#<index>` when the id itself is the trouble), each with why. */
  skipped: { id: string; why: string }[];
  /** Fields this build does not read, as `<id>.<field>` (a gate's as `<id>.gates[<i>].<field>`): never a refusal. */
  unknown: string[];
  /** Why the whole file was refused, or null. */
  problem: string | null;
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Names the language's own objects answer to: never a key in a record keyed by track. */
const FORBIDDEN = new Set(['constructor', 'prototype']);
const CONTROL = /[\u0000-\u001f\u007f]/;
const TRACK_FIELDS = new Set(['id', 'name', 'note', 'kind', 'laps', 'for', 'clear', 'grid', 'gates', 'at']);
const PLACE_FIELDS = new Set(['x', 'y', 'z', 'q']);
const GATE_FIELDS = new Set(['x', 'y', 'z', 'q', 'w', 'h']);

/** Whether an id is one a track may carry. */
export function isTrackId(id: unknown): id is string {
  return typeof id === 'string' && ID.test(id) && !FORBIDDEN.has(id);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** A place cleaned, or why not. The turn is renormalised within the limit of a unit turn, refused past it. */
function readPlace(v: unknown, what: string, fields: Set<string>, unknown: string[], prefix: string): TrackPlace | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `its ${what} is an object`;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!fields.has(k)) unknown.push(`${prefix}.${k}`);
  const x = num(o.x);
  const y = num(o.y);
  const z = num(o.z);
  if (x === undefined || y === undefined || z === undefined) return `its ${what}'s place is not three numbers`;
  const L = TRACK_LIMITS;
  if (Math.abs(x) > L.reach || Math.abs(z) > L.reach) return `its ${what} is more than ${L.reach} m out`;
  if (Math.abs(y) > L.height) return `its ${what}'s height is more than ${L.height} m off`;
  const q = o.q;
  if (!Array.isArray(q) || q.length !== 4 || q.some((c) => num(c) === undefined)) return `its ${what}'s turn is not four numbers [w, x, y, z]`;
  const len = Math.hypot(q[0] as number, q[1] as number, q[2] as number, q[3] as number);
  if (!(Math.abs(len - 1) <= L.unit)) return `its ${what}'s turn is not a turn (its length is not one)`;
  // Renormalised only when it is off by more than rounding, so a file written from tracks already read reads back
  // to the very same numbers.
  const n = Math.abs(len - 1) > 1e-12 ? len : 1;
  return { x, y, z, q: [(q[0] as number) / n, (q[1] as number) / n, (q[2] as number) / n, (q[3] as number) / n] };
}

/**
 * One track cleaned, or why it is refused. `least` is how few gates it may have: the file's own rule, or nought for the
 * editor's track in hand while it is being laid (it is held to the file's rule again when it is saved).
 */
export function readTrack(v: unknown, unknown: string[] = [], least: number = TRACK_LIMITS.gatesLeast): TrackDef | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a track is an object';
  const o = v as Record<string, unknown>;
  if (!isTrackId(o.id)) return 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)';
  const id = o.id;
  for (const k of Object.keys(o)) if (!TRACK_FIELDS.has(k)) unknown.push(`${id}.${k}`);
  const L = TRACK_LIMITS;
  if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > L.name || CONTROL.test(o.name)) return `its name is words of ${L.name} characters at most`;
  if (o.note !== undefined && (typeof o.note !== 'string' || o.note.length > L.note)) return `its note is words of ${L.note} characters at most`;
  if (o.kind !== 'circuit' && o.kind !== 'sprint') return 'its kind is neither circuit nor sprint';
  let laps = 1;
  if (o.kind === 'circuit') {
    if (typeof o.laps !== 'number' || !Number.isInteger(o.laps) || o.laps < 1 || o.laps > L.lapsMost) return `a circuit's laps is a whole number from 1 to ${L.lapsMost}`;
    laps = o.laps;
  } else if (o.laps !== undefined && o.laps !== 1) return 'a sprint is one lap';
  if (!Array.isArray(o.for) || !o.for.length || o.for.some((k) => !RACE_KINDS.includes(k as RaceKind)) || new Set(o.for).size !== o.for.length) return `its for is a list of ${RACE_KINDS.join(' and ')}, each once`;
  let clear = 0;
  if (o.clear !== undefined) {
    const c = num(o.clear);
    if (c === undefined || c < 0 || c > L.clearMost) return `its clear is a number of metres from 0 to ${L.clearMost}`;
    clear = c;
  }
  const grid = readPlace(o.grid, 'grid', PLACE_FIELDS, unknown, `${id}.grid`);
  if (typeof grid === 'string') return grid;
  if (!Array.isArray(o.gates)) return 'it has no gates list';
  if (o.gates.length < least || o.gates.length > L.gates) return `it has ${o.gates.length} gates, and a track has ${least} to ${L.gates}`;
  const gates: TrackGate[] = [];
  for (let i = 0; i < o.gates.length; i++) {
    const g = o.gates[i];
    const place = readPlace(g, `gate ${i}`, GATE_FIELDS, unknown, `${id}.gates[${i}]`);
    if (typeof place === 'string') return place;
    const go = g as Record<string, unknown>;
    const w = num(go.w);
    const h = num(go.h);
    if (w === undefined || w < L.widthLeast || w > L.widthMost) return `gate ${i}'s width is ${L.widthLeast} to ${L.widthMost} m`;
    if (h === undefined || h < L.heightLeast || h > L.heightMost) return `gate ${i}'s height is ${L.heightLeast} to ${L.heightMost} m`;
    gates.push({ ...place, w, h });
  }
  const t: TrackDef = { id, name: o.name, kind: o.kind, laps, for: [...(o.for as RaceKind[])], clear, grid, gates };
  if (o.note !== undefined) t.note = o.note as string;
  if (o.at !== undefined) {
    const at = num(o.at);
    if (at === undefined || at < 0) return 'its at is a time in milliseconds';
    t.at = at;
  }
  return t;
}

/**
 * Read a world's track file. A space zone's is written in the game's frame and any other world's in the raw. A file
 * that does not read, or whose header is not this world's, is refused whole; a bad track, a track past the cap and a
 * second track under one id are skipped and named.
 */
export function readTrackFile(text: string, world: string, kindOfWorld: 'ground' | 'space'): TrackRead {
  const out: TrackRead = { tracks: [], skipped: [], unknown: [], problem: null };
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
  if (f.version !== TRACK_VERSION) {
    out.problem = `its version is not ${TRACK_VERSION}`;
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
  if (!Array.isArray(f.tracks)) {
    out.problem = 'it has no tracks list';
    return out;
  }
  const seen = new Set<string>();
  for (let i = 0; i < f.tracks.length; i++) {
    const raw = f.tracks[i];
    const named = raw && typeof raw === 'object' && isTrackId((raw as { id?: unknown }).id) ? (raw as { id: string }).id : `#${i}`;
    if (out.tracks.length >= TRACK_LIMITS.tracks) {
      out.skipped.push({ id: named, why: `past the ${TRACK_LIMITS.tracks} tracks a file may hold` });
      continue;
    }
    const t = readTrack(raw, out.unknown);
    if (typeof t === 'string') {
      out.skipped.push({ id: named, why: t });
      continue;
    }
    if (seen.has(t.id)) {
      out.skipped.push({ id: t.id, why: 'a second track under the same id' });
      continue;
    }
    seen.add(t.id);
    out.tracks.push(t);
  }
  return out;
}

const TRACK_ORDER: (keyof TrackDef)[] = ['id', 'name', 'note', 'kind', 'laps', 'for', 'clear', 'at'];
const ORDERED = new Set<string>([...TRACK_ORDER, 'grid', 'gates']);

function placeText(p: TrackPlace | TrackGate, withSize: boolean): string {
  const parts = [`"x": ${JSON.stringify(p.x)}`, `"y": ${JSON.stringify(p.y)}`, `"z": ${JSON.stringify(p.z)}`, `"q": ${JSON.stringify(p.q)}`];
  if (withSize) parts.push(`"w": ${JSON.stringify((p as TrackGate).w)}`, `"h": ${JSON.stringify((p as TrackGate).h)}`);
  return `{ ${parts.join(', ')} }`;
}

/**
 * A whole file's text: its header a field a line, then each track sorted by id, its own fields on one line in a
 * fixed order, its grid on the next, and one line a gate, so a gate moved is one line changed and git shows exactly
 * what moved. No comment: the file is JSON, and `note` is where a track's words go. A track handed over as the very
 * object a file was read into (the editor writing back tracks it did not touch) keeps every field it carries that
 * this build does not read, after the rest.
 */
export function trackFileText(world: string, frame: PlacementFrame, tracks: readonly TrackDef[]): string {
  const sorted = [...tracks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const blocks = sorted.map((t) => {
    const head: string[] = [];
    for (const k of TRACK_ORDER) {
      const v = t[k];
      if (v === undefined) continue;
      head.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    }
    const all = t as unknown as Record<string, unknown>;
    for (const k of Object.keys(all)) {
      if (ORDERED.has(k) || all[k] === undefined) continue;
      head.push(`${JSON.stringify(k)}: ${JSON.stringify(all[k])}`);
    }
    const gates = t.gates.map((g) => `        ${placeText(g, true)}`).join(',\n');
    return `    {\n      ${head.join(', ')},\n      "grid": ${placeText(t.grid, false)},\n      "gates": [\n${gates}\n      ]\n    }`;
  });
  const body = blocks.length ? `[\n${blocks.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${TRACK_VERSION},\n  "world": ${JSON.stringify(world)},\n  "frame": ${JSON.stringify(frame)},\n  "tracks": ${body}\n}\n`;
}

/** Everything about a track that changes how it is raced, as one string: two tracks with the same answer race the same. */
export function trackHash(t: TrackDef): string {
  return JSON.stringify([t.kind, t.laps, t.for, t.clear, t.grid, t.gates]);
}

/** Which tracks a file read again added, took away and changed, against the tracks read before. */
export function trackSync(before: readonly TrackDef[], now: readonly TrackDef[]): { added: string[]; removed: string[]; changed: string[] } {
  const was = new Map(before.map((t) => [t.id, trackHash(t)]));
  const added: string[] = [];
  const changed: string[] = [];
  const named = new Set<string>();
  for (const t of now) {
    named.add(t.id);
    const h = was.get(t.id);
    if (h === undefined) added.push(t.id);
    else if (h !== trackHash(t)) changed.push(t.id);
  }
  const removed = before.filter((t) => !named.has(t.id)).map((t) => t.id);
  return { added, removed, changed };
}

/** A gate's or the grid's place carried into the game's frame (the placements' own `toGame`), with its window. */
export interface GameGate extends GamePlace {
  w: number;
  h: number;
}

/** The grid and every gate of a track in the game's frame. `centre` is the world's layout centre (null: nought). */
export function trackInGame(t: TrackDef, centre: { x: number; z: number } | null, frame: PlacementFrame): { grid: GamePlace; gates: GameGate[] } {
  return {
    grid: toGame(t.grid, centre, frame),
    gates: t.gates.map((g) => ({ ...toGame(g, centre, frame), w: g.w, h: g.h })),
  };
}

/** A course's straight legs in order on the ground: grid to gate 0, gate to gate, and a circuit's last gate back to 0. */
export interface CourseLeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Metres either side of the line it is checked over: the track's `clear`, or half the narrower of its two gates. */
  half: number;
}

/** The legs of a course from its places (in any one frame), for the corridor's check and its circles. */
export function courseLegs(t: Pick<TrackDef, 'kind' | 'clear'>, grid: { x: number; z: number }, gates: readonly { x: number; z: number; w: number }[]): CourseLeg[] {
  const legs: CourseLeg[] = [];
  if (!gates.length) return legs;
  const leg = (a: { x: number; z: number }, b: { x: number; z: number }, wa: number, wb: number) => legs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, half: Math.max(t.clear, Math.min(wa, wb) / 2) });
  leg(grid, gates[0], gates[0].w, gates[0].w);
  for (let i = 1; i < gates.length; i++) leg(gates[i - 1], gates[i], gates[i - 1].w, gates[i].w);
  if (t.kind === 'circuit' && gates.length > 1) leg(gates[gates.length - 1], gates[0], gates[gates.length - 1].w, gates[0].w);
  return legs;
}

/** The distance on the ground from a point to a leg's line. */
export function legDistance(l: CourseLeg, x: number, z: number): number {
  const dx = l.bx - l.ax;
  const dz = l.bz - l.az;
  const len2 = dx * dx + dz * dz;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((x - l.ax) * dx + (z - l.az) * dz) / len2)) : 0;
  const px = l.ax + dx * k - x;
  const pz = l.az + dz * k - z;
  return Math.sqrt(px * px + pz * pz);
}

/** Something standing on the ground that a racing hull would meet: where, how wide (its radius), and in words what. */
export interface CourseThing {
  x: number;
  z: number;
  r: number;
  what: string;
}

/**
 * Everything standing in a course's corridor (the check's pure part): each thing whose own circle comes within a
 * leg's half-width of the gate-to-gate line, with the leg it stands on and how far off the line it is. At racing
 * speed each one is a crash. The legs and the things must be in one frame.
 */
export function corridorHits(legs: readonly CourseLeg[], things: readonly CourseThing[]): { thing: CourseThing; leg: number; off: number }[] {
  const out: { thing: CourseThing; leg: number; off: number }[] = [];
  for (const thing of things) {
    for (let i = 0; i < legs.length; i++) {
      const off = legDistance(legs[i], thing.x, thing.z);
      if (off < legs[i].half + thing.r) {
        out.push({ thing, leg: i, off });
        break;
      }
    }
  }
  return out;
}

/**
 * The circles that keep the plants off a course's corridor: along each leg, a circle every `clear` metres of radius
 * `clear` times the square root of 1.25, which keeps at least `clear` metres either side of the line clear between any
 * two of them; none for a track that asks for none. In the frame its places are in (the raw one, on a planet), as a
 * placement row's `clear` is.
 */
export function corridorCircles(t: Pick<TrackDef, 'kind' | 'clear'>, grid: { x: number; z: number }, gates: readonly { x: number; z: number; w: number }[]): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  const c = Math.min(TRACK_LIMITS.clearMost, t.clear);
  if (!(c > 0)) return out;
  const step = Math.max(1, c);
  const r = c * Math.sqrt(1.25);
  for (const l of courseLegs(t, grid, gates)) {
    const len = Math.hypot(l.bx - l.ax, l.bz - l.az);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) out.push({ x: l.ax + ((l.bx - l.ax) * i) / n, z: l.az + ((l.bz - l.az) * i) / n, r });
  }
  return out;
}

/** A lap's length on the ground (m): the gate-to-gate lines from gate 0 round to gate 0, or a sprint's to its last gate. */
export function lapLength(t: Pick<TrackDef, 'kind'>, gates: readonly { x: number; z: number }[]): number {
  let d = 0;
  for (let i = 1; i < gates.length; i++) d += Math.hypot(gates[i].x - gates[i - 1].x, gates[i].z - gates[i - 1].z);
  if (t.kind === 'circuit' && gates.length > 1) d += Math.hypot(gates[0].x - gates[gates.length - 1].x, gates[0].z - gates[gates.length - 1].z);
  return d;
}
