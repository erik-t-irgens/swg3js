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
// **A drawn course** (the race drawer's first wave, `A:\swg3js\racedrawer\DESIGN.md` §2.2) is a field of its track,
// `course`: the road's nodes path by path in the file's frame, with the course's own numbers, written after the gates as a
// block of its own one node a line. A gate and the grid may carry an anchor (`path`, `e`, `t`: the path they follow, the
// edge they stand on by the node it leaves, and their share of that edge's own arclength) and a gate `ow` (its width is
// its own), in their objects only where present. A track carrying none of these reads, hashes and writes exactly as it did
// before the course: the new fields are read, hashed and written only where present. A course is ground, so a space zone's
// file refuses one ("a course is carved into ground: space is a later pass").
//
// Pure: imports the placements' reader for its JSON with comments and its frames, `trackPath.ts` and `coursePath.ts`'s
// lengths; no page, no three. Rule for this file (node runs it with type stripping): every import with its `.ts`
// extension, no enum, no namespace, no constructor parameter properties.

import { parseJsonc } from '../story/jsonc.ts';
import { toGame, type GamePlace, type PlacementFrame } from '../story/placements.ts';
import { buildSpine, spineLegs } from './coursePath.ts';

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

/**
 * A drawn course's limits (§2.2), the reader's and the endpoint's, never moved from the browser: a limit the page moved and
 * the endpoint did not would let the page write a course the reader then refuses. Ours.
 */
export const COURSE_LIMITS = {
  /** The course's own version. */
  version: 1,
  /** Paths a course may hold: the main line and its shortcuts. */
  paths: 8,
  /** Nodes a path holds: two at least (a closed path three), four hundred at most. */
  nodesLeast: 2,
  closedLeast: 3,
  nodes: 400,
  /** Two consecutive nodes stand this far apart on the ground at least and at most (m): nearer are merged on write, further split. */
  edgeLeast: 2,
  edgeMost: 4000,
  /** A node's bank either way (degrees), its shoulder (m). The width is the gates' own `widthLeast` to `widthMost`. */
  bankMost: 45,
  shoulderMost: 64,
  /** The course's own numbers (m). */
  marginMost: 16,
  levelMost: 5,
  wallOutMost: 8,
  wallHighLeast: 1,
  wallHighMost: 50,
};

/** How an edge leaving a node is drawn: a natural curve, or a straight line. */
export type CourseCurve = 'smooth' | 'straight';
export const COURSE_CURVES: readonly CourseCurve[] = ['smooth', 'straight'];
/** Which side of the edge leaving a node carries a race wall (from the race drawer's third wave; read from its first). */
export type CourseWall = 'left' | 'right' | 'both';
export const COURSE_WALLS: readonly (CourseWall | 'none')[] = ['none', 'left', 'right', 'both'];
/** The client's road falloffs, `generator.ts`'s `FeatherFunction` by name. */
export type CourseFeather = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
export const COURSE_FEATHERS: readonly CourseFeather[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
export type CourseCrossing = 'wall' | 'slope';
export type CourseGrass = 'clear' | 'keep';

/** One node of a drawn path, in the file's frame: its place (`y` the road's surface there), width, bank (degrees, the driver's right up), shoulder and the edge leaving it. */
export interface CourseNode {
  x: number;
  y: number;
  z: number;
  w: number;
  b: number;
  sh: number;
  c: CourseCurve;
  /** The race walls on the edge leaving it (absent for none). */
  wall?: CourseWall;
  /** A shortcut's first or last node: the id of the path it joins, whose road it stands on. */
  j?: string;
}

export interface CoursePath {
  /** `^[a-z0-9][a-z0-9_-]{0,31}$`, unique in its course. */
  id: string;
  nodes: CourseNode[];
}

/** A track's drawn road (§2.2): the course's own numbers, then its paths, the first the main line (closed exactly on a circuit). */
export interface TrackCourse {
  v: number;
  feather: CourseFeather;
  crossing: CourseCrossing;
  margin: number;
  level: number;
  grass: CourseGrass;
  wallOut: number;
  wallHigh: number;
  paths: CoursePath[];
}

/** A place as the file holds it: `q` is `[w, x, y, z]` in the file's frame, as a placement row's. */
export interface TrackPlace {
  x: number;
  y: number;
  z: number;
  q: [number, number, number, number];
  /** The grid's anchor on a drawn course (all three or none): the path, the node its edge leaves, the share of that edge. */
  path?: string;
  e?: number;
  t?: number;
}

export interface TrackGate extends TrackPlace {
  /** Width and height of its window, metres. */
  w: number;
  h: number;
  /** 1: a following gate's width is its own (set by hand), so following moves its place and turn and never its width. */
  ow?: 1;
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
  /** Its drawn road, where one is drawn (the race drawer); on a track with a course, `clear` is metres past the road's edge. */
  course?: TrackCourse;
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
const TRACK_FIELDS = new Set(['id', 'name', 'note', 'kind', 'laps', 'for', 'clear', 'grid', 'gates', 'at', 'course']);
const PLACE_FIELDS = new Set(['x', 'y', 'z', 'q', 'path', 'e', 't']);
const GATE_FIELDS = new Set(['x', 'y', 'z', 'q', 'w', 'h', 'path', 'e', 't', 'ow']);
const COURSE_FIELDS = new Set(['v', 'feather', 'crossing', 'margin', 'level', 'grass', 'wallOut', 'wallHigh', 'paths']);
const PATH_FIELDS = new Set(['id', 'nodes']);
const NODE_FIELDS = new Set(['x', 'y', 'z', 'w', 'b', 'sh', 'c', 'wall', 'j']);
const PATH_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Whether an id is one a path of a course may carry. */
export function isCoursePathId(id: unknown): id is string {
  return typeof id === 'string' && PATH_ID.test(id) && !FORBIDDEN.has(id);
}

/** The words a course in a space zone's file is refused in. */
export const COURSE_IN_SPACE = 'a course is carved into ground: space is a later pass';

/** A number held to a range, or undefined for one that is no number or out of it. */
function within(v: unknown, lo: number, hi: number): number | undefined {
  const n = num(v);
  return n !== undefined && n >= lo && n <= hi ? n : undefined;
}

/**
 * One node cleaned, or why it is refused. Fields this build does not read are named into `unknown` (never a refusal on
 * their own: the editor's kind refuses to write a file carrying any, so a later field is never dropped by this build).
 */
function readCourseNode(v: unknown, what: string, unknown: string[], prefix: string): CourseNode | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `${what} is an object`;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!NODE_FIELDS.has(k)) unknown.push(`${prefix}.${k}`);
  const L = TRACK_LIMITS;
  const C = COURSE_LIMITS;
  const x = num(o.x);
  const y = num(o.y);
  const z = num(o.z);
  if (x === undefined || y === undefined || z === undefined) return `${what}'s place is not three numbers`;
  if (Math.abs(x) > L.reach || Math.abs(z) > L.reach) return `${what} is more than ${L.reach} m out`;
  if (Math.abs(y) > L.height) return `${what}'s height is more than ${L.height} m off`;
  const w = within(o.w, L.widthLeast, L.widthMost);
  if (w === undefined) return `${what}'s width is ${L.widthLeast} to ${L.widthMost} m`;
  const b = within(o.b, -C.bankMost, C.bankMost);
  if (b === undefined) return `${what}'s bank is ${C.bankMost} degrees either way at most`;
  const sh = within(o.sh, 0, C.shoulderMost);
  if (sh === undefined) return `${what}'s shoulder is 0 to ${C.shoulderMost} m`;
  if (o.c !== 'smooth' && o.c !== 'straight') return `${what}'s c (the edge leaving it) is smooth or straight`;
  const n: CourseNode = { x, y, z, w, b, sh, c: o.c };
  if (o.wall !== undefined) {
    if (!COURSE_WALLS.includes(o.wall as CourseWall)) return `${what}'s wall is none, left, right or both`;
    if (o.wall !== 'none') n.wall = o.wall as CourseWall;
  }
  if (o.j !== undefined) {
    if (!isCoursePathId(o.j)) return `${what}'s j names no path`;
    n.j = o.j;
  }
  return n;
}

/**
 * A track's course cleaned, or why it is refused: its numbers within their limits, each path's id, nodes and edges (two
 * consecutive nodes `edgeLeast` to `edgeMost` apart on the ground, the closing edge of the main line on a circuit too), the
 * main line closed exactly on a circuit, a join only on a shortcut's first or last node and naming another path.
 */
function readCourse(v: unknown, kind: TrackKind, unknown: string[], prefix: string): TrackCourse | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'its course is an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!COURSE_FIELDS.has(k)) unknown.push(`${prefix}.${k}`);
  const C = COURSE_LIMITS;
  if (o.v !== C.version) return `its course's v is not ${C.version}`;
  if (!COURSE_FEATHERS.includes(o.feather as CourseFeather)) return `its course's feather is ${COURSE_FEATHERS.join(', ')}`;
  if (o.crossing !== 'wall' && o.crossing !== 'slope') return "its course's crossing is wall or slope";
  const margin = within(o.margin, 0, C.marginMost);
  if (margin === undefined) return `its course's margin is 0 to ${C.marginMost} m`;
  const level = within(o.level, 0, C.levelMost);
  if (level === undefined) return `its course's level is 0 to ${C.levelMost} m`;
  if (o.grass !== 'clear' && o.grass !== 'keep') return "its course's grass is clear or keep";
  const wallOut = within(o.wallOut, 0, C.wallOutMost);
  if (wallOut === undefined) return `its course's wallOut is 0 to ${C.wallOutMost} m`;
  const wallHigh = within(o.wallHigh, C.wallHighLeast, C.wallHighMost);
  if (wallHigh === undefined) return `its course's wallHigh is ${C.wallHighLeast} to ${C.wallHighMost} m`;
  if (!Array.isArray(o.paths) || !o.paths.length || o.paths.length > C.paths) return `its course holds 1 to ${C.paths} paths`;
  const paths: CoursePath[] = [];
  const ids = new Set<string>();
  for (let p = 0; p < o.paths.length; p++) {
    const pv = o.paths[p];
    const pre = `${prefix}.paths[${p}]`;
    if (!pv || typeof pv !== 'object' || Array.isArray(pv)) return `its course's path ${p} is an object`;
    const po = pv as Record<string, unknown>;
    for (const k of Object.keys(po)) if (!PATH_FIELDS.has(k)) unknown.push(`${pre}.${k}`);
    if (!isCoursePathId(po.id)) return `its course's path ${p}'s id is not a-z, 0-9, _ and - (32 at most, starting with a letter or a digit)`;
    if (ids.has(po.id)) return `its course has two paths called ${po.id}`;
    ids.add(po.id);
    const closed = p === 0 && kind === 'circuit';
    const least = closed ? C.closedLeast : C.nodesLeast;
    if (!Array.isArray(po.nodes) || po.nodes.length < least || po.nodes.length > C.nodes) return `its course's path ${po.id} has ${Array.isArray(po.nodes) ? po.nodes.length : 'no'} nodes, and a${closed ? ' closed' : 'n open'} path has ${least} to ${C.nodes}`;
    const nodes: CourseNode[] = [];
    for (let i = 0; i < po.nodes.length; i++) {
      const n = readCourseNode(po.nodes[i], `path ${po.id}'s node ${i}`, unknown, `${pre}.nodes[${i}]`);
      if (typeof n === 'string') return n;
      nodes.push(n);
    }
    const edges = closed ? nodes.length : nodes.length - 1;
    for (let i = 0; i < edges; i++) {
      const a = nodes[i];
      const b = nodes[(i + 1) % nodes.length];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (!(d >= C.edgeLeast) || d > C.edgeMost) return `path ${po.id}'s nodes ${i} and ${(i + 1) % nodes.length} stand ${d.toFixed(2)} m apart, and two consecutive nodes stand ${C.edgeLeast} to ${C.edgeMost} m apart`;
    }
    paths.push({ id: po.id, nodes });
  }
  for (let p = 0; p < paths.length; p++) {
    const ns = paths[p].nodes;
    for (let i = 0; i < ns.length; i++) {
      const j = ns[i].j;
      if (j === undefined) continue;
      if (p === 0) return `the main line (path ${paths[0].id}) joins nothing: only a shortcut's ends are joined`;
      if (i !== 0 && i !== ns.length - 1) return `path ${paths[p].id}'s node ${i} is joined, and only a shortcut's first or last node is`;
      if (j === paths[p].id || !ids.has(j)) return `path ${paths[p].id}'s node ${i} joins ${j}, which is no other path of the course`;
    }
  }
  return { v: C.version, feather: o.feather as CourseFeather, crossing: o.crossing, margin, level, grass: o.grass, wallOut, wallHigh, paths };
}

/** How many edges a path of a course has: one a node on a closed path, one fewer on an open one. */
export function pathEdges(course: TrackCourse, p: number, kind: TrackKind): number {
  const n = course.paths[p].nodes.length;
  return p === 0 && kind === 'circuit' ? n : n - 1;
}

/**
 * An anchor read off a gate or the grid (`path`, `e`, `t`: all three or none), held to the course, or why not. Absent:
 * null. `o` is the raw object; `course` the track's cleaned course (or none).
 */
function readAnchor(o: Record<string, unknown>, what: string, course: TrackCourse | undefined, kind: TrackKind): { path: string; e: number; t: number } | null | string {
  const has = o.path !== undefined || o.e !== undefined || o.t !== undefined;
  if (!has) return null;
  if (o.path === undefined || o.e === undefined || o.t === undefined) return `${what}'s anchor is path, e and t together`;
  if (!course) return `${what} follows a path, and the track has no course`;
  const p = course.paths.findIndex((x) => x.id === o.path);
  if (p < 0) return `${what} follows ${String(o.path)}, which is no path of the course`;
  const e = o.e;
  if (typeof e !== 'number' || !Number.isInteger(e) || e < 0 || e >= pathEdges(course, p, kind)) return `${what}'s e is a node of path ${course.paths[p].id} whose edge it stands on`;
  const t = within(o.t, 0, 1);
  if (t === undefined) return `${what}'s t is a share of its edge, 0 to 1`;
  return { path: course.paths[p].id, e, t };
}

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
 * editor's track in hand while it is being laid (it is held to the file's rule again when it is saved). `kindOfWorld` is the
 * file's world's kind: a space zone's track refuses a course. A track carrying no course and no anchor builds exactly the
 * object it built before the course was read.
 */
export function readTrack(v: unknown, unknown: string[] = [], least: number = TRACK_LIMITS.gatesLeast, kindOfWorld: 'ground' | 'space' = 'ground'): TrackDef | string {
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
  // The course first, since the anchors of the grid and the gates are held to it.
  let course: TrackCourse | undefined;
  if (o.course !== undefined) {
    if (kindOfWorld === 'space') return COURSE_IN_SPACE;
    const c = readCourse(o.course, o.kind, unknown, `${id}.course`);
    if (typeof c === 'string') return c;
    course = c;
  }
  const grid = readPlace(o.grid, 'grid', PLACE_FIELDS, unknown, `${id}.grid`);
  if (typeof grid === 'string') return grid;
  const gridAnchor = readAnchor(o.grid as Record<string, unknown>, 'its grid', course, o.kind);
  if (typeof gridAnchor === 'string') return gridAnchor;
  if (gridAnchor) {
    grid.path = gridAnchor.path;
    grid.e = gridAnchor.e;
    grid.t = gridAnchor.t;
  }
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
    const gate: TrackGate = { ...place, w, h };
    const anchor = readAnchor(go, `gate ${i}`, course, o.kind);
    if (typeof anchor === 'string') return anchor;
    if (anchor) {
      gate.path = anchor.path;
      gate.e = anchor.e;
      gate.t = anchor.t;
    }
    if (go.ow !== undefined) {
      if (go.ow !== 1) return `gate ${i}'s ow is 1 or absent`;
      if (!anchor) return `gate ${i}'s ow is 1 only on a gate that follows the course`;
      gate.ow = 1;
    }
    gates.push(gate);
  }
  const t: TrackDef = { id, name: o.name, kind: o.kind, laps, for: [...(o.for as RaceKind[])], clear, grid, gates };
  if (o.note !== undefined) t.note = o.note as string;
  if (o.at !== undefined) {
    const at = num(o.at);
    if (at === undefined || at < 0) return 'its at is a time in milliseconds';
    t.at = at;
  }
  if (course) t.course = course;
  return t;
}

/**
 * Read a world's track file. A space zone's is written in the game's frame and any other world's in the raw. A file
 * that does not read, or whose header is not this world's, is refused whole; a bad track, a track past the cap and a
 * second track under one id are skipped and named.
 */
export function readTrackFile(text: string, world: string, kindOfWorld: 'ground' | 'space'): TrackRead {
  return readTracksOf(text, world, kindOfWorld, null);
}

/**
 * `readTrackFile` with, beside each track read, the very object it was read from (`raws[i]` is `read.tracks[i]`'s): what the
 * world editor's batch keeps a track's fields this build does not read from (the race drawer's first wave, `tracksKind`),
 * from the one parse of the file.
 */
export function readTrackFileRaw(text: string, world: string, kindOfWorld: 'ground' | 'space'): { read: TrackRead; raws: Record<string, unknown>[] } {
  const raws: Record<string, unknown>[] = [];
  return { read: readTracksOf(text, world, kindOfWorld, raws), raws };
}

function readTracksOf(text: string, world: string, kindOfWorld: 'ground' | 'space', raws: Record<string, unknown>[] | null): TrackRead {
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
    const t = readTrack(raw, out.unknown, TRACK_LIMITS.gatesLeast, kindOfWorld);
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
    raws?.push(raw as Record<string, unknown>);
  }
  return out;
}

const TRACK_ORDER: (keyof TrackDef)[] = ['id', 'name', 'note', 'kind', 'laps', 'for', 'clear', 'at'];
const ORDERED = new Set<string>([...TRACK_ORDER, 'grid', 'gates', 'course']);

function placeText(p: TrackPlace | TrackGate, withSize: boolean): string {
  const parts = [`"x": ${JSON.stringify(p.x)}`, `"y": ${JSON.stringify(p.y)}`, `"z": ${JSON.stringify(p.z)}`, `"q": ${JSON.stringify(p.q)}`];
  if (withSize) parts.push(`"w": ${JSON.stringify((p as TrackGate).w)}`, `"h": ${JSON.stringify((p as TrackGate).h)}`);
  // An anchor, and a gate's own width, only where present: a place carrying none writes exactly what it wrote before.
  if (p.path !== undefined) parts.push(`"path": ${JSON.stringify(p.path)}`, `"e": ${JSON.stringify(p.e)}`, `"t": ${JSON.stringify(p.t)}`);
  if (withSize && (p as TrackGate).ow !== undefined) parts.push(`"ow": ${JSON.stringify((p as TrackGate).ow)}`);
  return `{ ${parts.join(', ')} }`;
}

/** The course's own numbers in their written order, then its paths. */
const COURSE_ORDER: readonly (keyof TrackCourse)[] = ['v', 'feather', 'crossing', 'margin', 'level', 'grass', 'wallOut', 'wallHigh'];
const NODE_ORDER: readonly (keyof CourseNode)[] = ['x', 'y', 'z', 'w', 'b', 'sh', 'c', 'wall', 'j'];

/**
 * A course as its block of the file (§2.2): its own numbers on one line, each path's header on a line of its own and one
 * node a line, so a node moved is one line changed. Written from whatever object it is handed (a course as read or as the
 * editor made it), each field in its fixed order and only where present.
 */
function courseText(c: TrackCourse): string {
  const head = COURSE_ORDER.filter((k) => c[k] !== undefined).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(c[k])}`);
  const paths = (c.paths ?? []).map((p) => {
    const nodes = (p.nodes ?? []).map((n) => `            { ${NODE_ORDER.filter((k) => n[k] !== undefined).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(n[k])}`).join(', ')} }`).join(',\n');
    return `          { "id": ${JSON.stringify(p.id)}, "nodes": [\n${nodes}\n          ] }`;
  });
  return `{ ${head.join(', ')},\n        "paths": [\n${paths.join(',\n')}\n        ] }`;
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
    // A drawn course after the gates as a block of its own (only where one is drawn: a track with none is written as before).
    const course = t.course !== undefined ? `,\n      "course": ${courseText(t.course)}` : '';
    return `    {\n      ${head.join(', ')},\n      "grid": ${placeText(t.grid, false)},\n      "gates": [\n${gates}\n      ]${course}\n    }`;
  });
  const body = blocks.length ? `[\n${blocks.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${TRACK_VERSION},\n  "world": ${JSON.stringify(world)},\n  "frame": ${JSON.stringify(frame)},\n  "tracks": ${body}\n}\n`;
}

/**
 * Everything about a track that changes how it is raced, as one string: two tracks with the same answer race the same. A
 * drawn course is pushed onto the end only where one is drawn (and an anchor is in its gate's object only where present), so
 * a track with neither answers exactly what it answered before the course: a moved node is a changed track, and a group
 * race's digest (`trackDigest`) covers the road as it covers the gates.
 */
export function trackHash(t: TrackDef): string {
  const parts: unknown[] = [t.kind, t.laps, t.for, t.clear, t.grid, t.gates];
  if (t.course !== undefined) parts.push(t.course);
  return JSON.stringify(parts);
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

/**
 * The tracks a batch's answer leaves (the world editor's `tracks` kind landed by difference, `App.landTracks`): the tracks
 * read before with every id `deleted` dropped and every track `put` laid over the one of its id where it stands, a track put
 * that was not there going at the end in the order put; nothing else moves. Never sorted: the race's list keeps its order.
 */
export function landedTracks(before: readonly TrackDef[], put: readonly TrackDef[], deleted: readonly string[]): TrackDef[] {
  const gone = new Set(deleted);
  const byId = new Map(put.map((t) => [t.id, t] as const));
  const now: TrackDef[] = [];
  for (const t of before) {
    if (gone.has(t.id)) continue;
    now.push(byId.get(t.id) ?? t);
    byId.delete(t.id);
  }
  for (const t of byId.values()) if (!gone.has(t.id)) now.push(t);
  return now;
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
  /**
   * Along a drawn road only (§2.3): the index of the course's path it lies on and its start's arclength along that path (m),
   * what names it in words (`legName`). Absent on a gate-to-gate leg, so a track with no course gives exactly the legs it gave.
   */
  path?: number;
  s?: number;
}

/**
 * A leg of a track's corridor named in words (`track({ check })`'s hits): along a drawn road by its path and how far along it
 * ("the road at 312 m", "shortcut cut at 40 m"), since the legs there are pieces of the road every `COURSE_LEG_STEP` and not
 * gate to gate; on a gate-only track by the gates either end, as ever.
 */
export function legName(t: Pick<TrackDef, 'gates'> & { course?: TrackCourse }, leg: CourseLeg | undefined, i: number): string {
  if (leg && leg.path !== undefined && t.course) {
    const along = `at ${Math.round(leg.s ?? 0)} m`;
    return leg.path === 0 ? `the road ${along}` : `shortcut ${t.course.paths[leg.path]?.id ?? leg.path} ${along}`;
  }
  return i === 0 ? 'grid to gate 0' : i <= t.gates.length - 1 ? `gate ${i - 1} to ${i}` : `gate ${t.gates.length - 1} to 0`;
}

/** Each path of a track's drawn course as its sampled spine (`coursePath.ts`), the main line first; none for a track with no course. */
export function courseSpines(t: Pick<TrackDef, 'kind' | 'course'>): ReturnType<typeof buildSpine>[] {
  if (!t.course) return [];
  return t.course.paths.map((p, i) => buildSpine(p.nodes, i === 0 && t.kind === 'circuit'));
}

/** How far apart the legs along a drawn road stand (m): §2.3's corridor. Ours, a constant of the corridor's own. */
export const COURSE_LEG_STEP = 8;

/**
 * The legs of a course from its places (in any one frame), for the corridor's check and its circles. Where a road is
 * drawn (§2.3) they follow it instead: along every path's spine every `COURSE_LEG_STEP` metres, each `half` the road's half
 * width there plus the track's `clear` (metres past the road's edge on a track with a course). The spine is in the file's
 * frame, so `place` carries a point of it into the frame the grid and the gates were handed in (absent: the file's own).
 */
export function courseLegs(t: Pick<TrackDef, 'kind' | 'clear'> & { course?: TrackCourse }, grid: { x: number; z: number }, gates: readonly { x: number; z: number; w: number }[], place?: (x: number, z: number) => { x: number; z: number }): CourseLeg[] {
  const legs: CourseLeg[] = [];
  if (t.course) {
    const spines = courseSpines(t as Pick<TrackDef, 'kind' | 'course'>);
    for (let p = 0; p < spines.length; p++) {
      for (const l of spineLegs(spines[p], t.clear, COURSE_LEG_STEP)) {
        const a = place ? place(l.ax, l.az) : { x: l.ax, z: l.az };
        const b = place ? place(l.bx, l.bz) : { x: l.bx, z: l.bz };
        legs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, half: l.half, path: p, s: l.s });
      }
    }
    return legs;
  }
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
export function corridorCircles(t: Pick<TrackDef, 'kind' | 'clear'> & { course?: TrackCourse }, grid: { x: number; z: number }, gates: readonly { x: number; z: number; w: number }[]): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  // A track with a drawn road lays none (§2.2): its `clear` is metres past the road's edge, and the road's own mask keeps the
  // plants off it (the race drawer's second wave), never circles along the gate-to-gate line.
  if (t.course) return out;
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

/**
 * A lap's length on the ground (m): the gate-to-gate lines from gate 0 round to gate 0, or a sprint's to its last gate; on a
 * drawn course its main line's own arclength (§2.3), which no mirror or move of the frame changes.
 */
export function lapLength(t: Pick<TrackDef, 'kind'> & { course?: TrackCourse }, gates: readonly { x: number; z: number }[]): number {
  if (t.course) return buildSpine(t.course.paths[0].nodes, t.kind === 'circuit').length;
  let d = 0;
  for (let i = 1; i < gates.length; i++) d += Math.hypot(gates[i].x - gates[i - 1].x, gates[i].z - gates[i - 1].z);
  if (t.kind === 'circuit' && gates.length > 1) d += Math.hypot(gates[0].x - gates[gates.length - 1].x, gates[0].z - gates[gates.length - 1].z);
  return d;
}
