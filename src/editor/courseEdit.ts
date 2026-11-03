// The race drawer's edits of a track's drawn course (`A:\swg3js\racedrawer\DESIGN.md` §2.9, §2.11), each answering a new
// track or why not, as the track editor's gate edits do (`src/race/trackEdits.ts`): drawn new, a node put in, taken out,
// moved, raised, widened, banked, its shoulder and its curve, a shortcut drawn and joined to its road, the course's own
// numbers, and the gates moved, turned, raised, widened, followed again and placed again. The track handed over is never
// changed.
//
// **Every edit settles the course in the same row** (`settle`): every number rounded to the hundredth as the writer rounds
// it (so the course in memory is the course written), two consecutive nodes nearer than `COURSE_LIMITS.edgeLeast` merged
// (the river's `spacingMin` rule) and an edge past `edgeMost` split, a shortcut's joined ends moved onto their road's spine
// at its surface, every gate and the grid that follows the road placed again (`followCourse`), and the whole read back by
// the reader (`readTrack`), so an edit can never leave the file it is saved into unreadable. An insert or a delete remaps the
// anchors of the edges it splits or merges by arclength and renumbers the later ones (`remapAnchors`), so a following gate
// keeps its place along the road.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties. The dev server's alone: reached only through the editor's own
// dynamic import.

import { COURSE_LIMITS, TRACK_LIMITS, courseSpines, readTrack, type CourseCurve, type CourseNode, type CourseWall, type RaceKind, type TrackCourse, type TrackDef, type TrackPlace } from '../race/trackFile.ts';
import { buildSpine, edgeCrossesItself, foldingEdges, nearestOn, spineAt, spineNear, spinePoint, type Spine } from '../race/coursePath.ts';
import { deleteMap, followCourse, followGate, gateRules, gatesAgain, insertMap, placeGates, remapAnchors, type DeckAt, type GateRules } from '../race/courseGates.ts';
import { COURSE_TUNE, type CourseTune } from '../race/courseTune.ts';
import { deleteGate, moveGateTo, nudgeGate, resizeGate } from '../race/trackEdits.ts';
import { RACE_BASE } from '../vehicles/raceTune.ts';

/** What an edit is judged with: the gates' rules, the land under a point of the file's frame (NaN for none known), a deck. */
export interface CourseCtx {
  rules: GateRules;
  /** The land under a point of the file's (raw) frame: the generator's ground and the sculpt's delta there; NaN for none known. */
  land: (x: number, z: number) => number;
  /** The water's surface over a point of the file's frame (-Infinity for none): a node's road under it is noted. */
  water?: (x: number, z: number) => number;
  deckAt?: DeckAt;
}

/** A context of the tune's rules and no land (a test's, the console's with nothing under it). */
export function courseCtx(land: (x: number, z: number) => number = () => Number.NaN): CourseCtx {
  return { rules: gateRules(), land };
}

export type CourseEdit = TrackDef | string;

// Plus nought: a negative nought written is read back a positive one, and the track read would differ from the one written.
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

/** A node made where the tool puts one: its place, its height, the tool's width, bank, shoulder and curve. */
export function nodeOf(x: number, z: number, y: number, tune: CourseTune = COURSE_TUNE): CourseNode {
  return { x: r2(x), y: r2(y), z: r2(z), w: r2(tune.width), b: r2(tune.bank), sh: r2(tune.shoulder), c: tune.curve };
}

/** A new course's own numbers (§2.15): the tune's. */
export function courseNumbers(tune: CourseTune = COURSE_TUNE): Omit<TrackCourse, 'paths'> {
  return { v: COURSE_LIMITS.version, feather: tune.feather, crossing: tune.crossing, margin: r2(tune.margin), level: r2(tune.level), grass: tune.grass, wallOut: r2(tune.wallOut), wallHigh: r2(tune.wallHigh) };
}

/** The kinds a new track is raced as: the tool's switches (both, if both are off). */
export function kindsOf(tune: CourseTune = COURSE_TUNE): RaceKind[] {
  const out: RaceKind[] = [];
  if (tune.forPods) out.push('podracer');
  if (tune.forBikes) out.push('speederbike');
  return out.length ? out : ['podracer', 'speederbike'];
}

/** A new track's id and name, free in the file: `course_<n>` and "Course <n>", the least free `n`. */
export function mintTrack(tracks: readonly TrackDef[]): { id: string; name: string } {
  const ids = new Set(tracks.map((t) => t.id));
  const names = new Set(tracks.map((t) => t.name));
  for (let n = 1; ; n++) if (!ids.has(`course_${n}`) && !names.has(`Course ${n}`)) return { id: `course_${n}`, name: `Course ${n}` };
}

/** A path id free in a course: `cut`, `cut_2`, ... */
export function mintPath(course: TrackCourse, base = 'cut'): string {
  const ids = new Set(course.paths.map((p) => p.id));
  if (!ids.has(base)) return base;
  for (let n = 2; ; n++) if (!ids.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** A track copied deep enough to change its course and its gates (never its words). */
function copy(t: TrackDef): TrackDef {
  return JSON.parse(JSON.stringify(t)) as TrackDef;
}

/** Whether a path of a track's course is closed: its main line on a circuit. */
function closedPath(t: TrackDef, p: number): boolean {
  return p === 0 && t.kind === 'circuit';
}

/** Every node of a course rounded as written: the place, height, width, bank and shoulder to the hundredth. */
function roundNodes(c: TrackCourse): void {
  for (const p of c.paths)
    for (const n of p.nodes) {
      n.x = r2(n.x);
      n.y = r2(n.y);
      n.z = r2(n.z);
      n.w = r2(Math.min(TRACK_LIMITS.widthMost, Math.max(TRACK_LIMITS.widthLeast, n.w)));
      n.b = r2(Math.min(COURSE_LIMITS.bankMost, Math.max(-COURSE_LIMITS.bankMost, n.b)));
      n.sh = r2(Math.min(COURSE_LIMITS.shoulderMost, Math.max(0, n.sh)));
    }
}

/** A path's edges' lengths along its spine as it stands. */
function lensOf(t: TrackDef, p: number): { lens: number[]; spine: Spine } {
  const spine = buildSpine(t.course!.paths[p].nodes, closedPath(t, p));
  return { lens: spine.edges.map((e) => e.len), spine };
}

/** Node `i` of path `p` taken out of a track (anchors remapped), with nothing checked: the merge's and the delete's work. */
function dropNode(t: TrackDef, p: number, i: number): TrackDef {
  const path = t.course!.paths[p];
  const n = path.nodes.length;
  const closed = closedPath(t, p);
  const { lens } = lensOf(t, p);
  const out = remapAnchors(t, path.id, deleteMap(i, n, closed, lens));
  out.course!.paths[p].nodes.splice(i, 1);
  return out;
}

/** A node put into path `p` after node `e`, at `u` of edge `e`'s arclength, its road's numbers there (anchors remapped). */
function putNode(t: TrackDef, p: number, e: number, u: number): TrackDef {
  const path = t.course!.paths[p];
  const closed = closedPath(t, p);
  const before = buildSpine(path.nodes, closed);
  const P = spinePoint();
  spineAt(before, e, u, P);
  const from = path.nodes[e];
  const node: CourseNode = { x: r2(P.x), y: r2(P.y), z: r2(P.z), w: r2(P.hw * 2), b: r2((Math.atan(P.tb) * 180) / Math.PI), sh: r2(P.sh), c: from.c };
  if (from.wall) node.wall = from.wall;
  const nodes = [...path.nodes.slice(0, e + 1), node, ...path.nodes.slice(e + 1)];
  const after = buildSpine(nodes, closed);
  const oldLen = before.edges[e].len;
  const out = remapAnchors(t, path.id, insertMap(e, u, oldLen, after.edges[e].len, after.edges[e + 1].len));
  out.course!.paths[p].nodes = nodes;
  return out;
}

/**
 * A course settled (the file's header): rounded, near nodes merged (the one `keep` names kept where it is one of a pair),
 * long edges split, joined ends moved onto their roads, the following gates and the grid placed again, and read back.
 * Answers the track as the reader cleans it, or why it would be refused.
 */
export function settle(t: TrackDef, ctx: CourseCtx, keep: { path: number; i: number } | null = null): CourseEdit {
  if (!t.course) return readTrack(t, [], 0);
  let cur = copy(t);
  roundNodes(cur.course!);
  // Two passes: a join's move may bring a node near its neighbour, and a later path may join an earlier one.
  for (let pass = 0; pass < 2; pass++) {
    for (let p = 0; p < cur.course!.paths.length; p++) {
      // Near nodes merged, the later of a pair taken out unless it is the one kept.
      let k = keep && keep.path === p ? keep.i : -1;
      for (let guard = 0; guard < 1000; guard++) {
        const ns = cur.course!.paths[p].nodes;
        const closed = closedPath(cur, p);
        const least = closed ? COURSE_LIMITS.closedLeast : COURSE_LIMITS.nodesLeast;
        const edges = closed ? ns.length : ns.length - 1;
        let hit = -1;
        for (let i = 0; i < edges; i++) {
          const a = ns[i];
          const b = ns[(i + 1) % ns.length];
          if (Math.hypot(b.x - a.x, b.z - a.z) < COURSE_LIMITS.edgeLeast) {
            hit = i;
            break;
          }
        }
        if (hit < 0) break;
        if (ns.length <= least) return `path ${cur.course!.paths[p].id} would have fewer than ${least} nodes ${COURSE_LIMITS.edgeLeast} m apart`;
        const j = (hit + 1) % ns.length;
        // A path's joined end is never the one merged away: its neighbour goes.
        const joinedJ = ns[j].j !== undefined;
        const drop = j === k || joinedJ ? hit : j;
        cur = dropNode(cur, p, drop);
        if (k > drop) k--;
      }
      // Edges past the most split at their middle.
      for (let guard = 0; guard < 1000; guard++) {
        const ns = cur.course!.paths[p].nodes;
        const closed = closedPath(cur, p);
        const edges = closed ? ns.length : ns.length - 1;
        let hit = -1;
        for (let i = 0; i < edges; i++) {
          const a = ns[i];
          const b = ns[(i + 1) % ns.length];
          if (Math.hypot(b.x - a.x, b.z - a.z) > COURSE_LIMITS.edgeMost) {
            hit = i;
            break;
          }
        }
        if (hit < 0) break;
        if (ns.length >= COURSE_LIMITS.nodes) return `path ${cur.course!.paths[p].id} has an edge past ${COURSE_LIMITS.edgeMost} m and ${COURSE_LIMITS.nodes} nodes already`;
        cur = putNode(cur, p, hit, 0.5);
        if (k > hit) k++;
      }
    }
    // A shortcut's joined ends moved onto their road's spine at its nearest point, at its surface there.
    const spines = courseSpines(cur);
    const byId = new Map(cur.course!.paths.map((p, i) => [p.id, i]));
    const near = spineNear();
    for (let p = 1; p < cur.course!.paths.length; p++) {
      const ns = cur.course!.paths[p].nodes;
      for (const i of [0, ns.length - 1]) {
        const n = ns[i];
        if (n.j === undefined) continue;
        const q = byId.get(n.j);
        if (q === undefined || q === p) continue;
        if (!nearestOn(spines[q], n.x, n.z, near)) continue;
        n.x = r2(near.x);
        n.z = r2(near.z);
        n.y = r2(near.y);
      }
    }
  }
  const followed = followCourse(cur, ctx.rules, ctx.deckAt);
  return readTrack(followed, [], 0);
}

/** A track's path index by its id (the main line's when none is named), or -1. */
export function pathIndex(t: TrackDef, path?: string): number {
  if (!t.course) return -1;
  if (path === undefined) return 0;
  return t.course.paths.findIndex((p) => p.id === path);
}

function nodeRef(t: TrackDef, path: string | undefined, i: number): { p: number } | string {
  const p = pathIndex(t, path);
  if (p < 0) return t.course ? `no path called ${path} in ${t.id}'s course` : `${t.id} has no course`;
  const n = t.course!.paths[p].nodes.length;
  if (!Number.isInteger(i) || i < 0 || i >= n) return `there is no node ${i}: path ${t.course!.paths[p].id}'s nodes are 0 to ${n - 1}`;
  return { p };
}

/**
 * A new track drawn (§2.11): the points in the file's frame with their heights (each already the land's, or a drawn road's
 * surface where it was dropped on one), the tool's width, bank, shoulder and curve, closed into a circuit of three laps or
 * open as a sprint, raced as the tool's kinds with its `clear`, its gates and grid placed for it.
 */
export function drawTrack(id: string, name: string, points: readonly { x: number; z: number; y: number; c?: CourseCurve }[], closed: boolean, ctx: CourseCtx, tune: CourseTune = COURSE_TUNE): CourseEdit {
  const least = closed ? COURSE_LIMITS.closedLeast : COURSE_LIMITS.nodesLeast;
  if (points.length < least) return `a${closed ? ' closed' : 'n open'} course has ${least} nodes at least`;
  if (points.some((p) => !Number.isFinite(p.y))) return 'the ground under a node is not known: fly nearer and draw again';
  const nodes = points.map((p) => ({ ...nodeOf(p.x, p.z, p.y, tune), c: p.c ?? tune.curve }));
  const t: TrackDef = { id, name, kind: closed ? 'circuit' : 'sprint', laps: closed ? 3 : 1, for: kindsOf(tune), clear: r2(tune.clear), grid: { x: nodes[0].x, y: nodes[0].y, z: nodes[0].z, q: [1, 0, 0, 0] }, gates: [], course: { ...courseNumbers(tune), paths: [{ id: 'main', nodes }] } };
  const s = settle(t, ctx);
  if (typeof s === 'string') return s;
  const placed = placeGates(s, ctx.rules, ctx.deckAt);
  return readTrack({ ...s, grid: placed.grid, gates: placed.gates });
}

/** A node put in on path `path`'s edge `e` at `u` of its arclength (a click on the road between two nodes). */
export function insertNode(t: TrackDef, path: string | undefined, e: number, u: number, ctx: CourseCtx): CourseEdit {
  const p = pathIndex(t, path);
  if (p < 0) return t.course ? `no path called ${path}` : `${t.id} has no course`;
  const n = t.course!.paths[p].nodes.length;
  if (n >= COURSE_LIMITS.nodes) return `a path has ${COURSE_LIMITS.nodes} nodes at most`;
  const edges = closedPath(t, p) ? n : n - 1;
  if (!Number.isInteger(e) || e < 0 || e >= edges) return `there is no edge ${e}`;
  const cu = Math.max(0.001, Math.min(0.999, u));
  return settle(putNode(copy(t), p, e, cu), ctx, { path: p, i: e + 1 });
}

/** Node `i` of a path taken out (refused below two, three on a closed path). */
export function deleteNode(t: TrackDef, path: string | undefined, i: number, ctx: CourseCtx): CourseEdit {
  const r = nodeRef(t, path, i);
  if (typeof r === 'string') return r;
  const closed = closedPath(t, r.p);
  const least = closed ? COURSE_LIMITS.closedLeast : COURSE_LIMITS.nodesLeast;
  if (t.course!.paths[r.p].nodes.length <= least) return `a${closed ? ' closed' : 'n open'} path keeps ${least} nodes at least`;
  return settle(dropNode(copy(t), r.p, i), ctx);
}

/** Node `i` moved over the ground to `(x, z)` of the file's frame, its height kept (a joined node slides along its road). */
export function moveNode(t: TrackDef, path: string | undefined, i: number, x: number, z: number, ctx: CourseCtx): CourseEdit {
  const r = nodeRef(t, path, i);
  if (typeof r === 'string') return r;
  const c = copy(t);
  const n = c.course!.paths[r.p].nodes[i];
  n.x = x;
  n.z = z;
  return settle(c, ctx, { path: r.p, i });
}

/** What a node's fields may be set to (each held to its limit as it is written). */
export interface NodeFields {
  x?: number;
  z?: number;
  y?: number;
  w?: number;
  b?: number;
  sh?: number;
  c?: CourseCurve;
  wall?: CourseWall | 'none';
}

/** Node `i`'s fields set (its place, height, width, bank, shoulder, curve, walls), each held to its limits. */
export function setNode(t: TrackDef, path: string | undefined, i: number, f: NodeFields, ctx: CourseCtx): CourseEdit {
  const r = nodeRef(t, path, i);
  if (typeof r === 'string') return r;
  const c = copy(t);
  const n = c.course!.paths[r.p].nodes[i];
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (fin(f.x)) n.x = f.x;
  if (fin(f.z)) n.z = f.z;
  if (fin(f.y)) n.y = Math.max(-TRACK_LIMITS.height, Math.min(TRACK_LIMITS.height, f.y));
  if (fin(f.w)) n.w = f.w;
  if (fin(f.b)) n.b = f.b;
  if (fin(f.sh)) n.sh = f.sh;
  if (f.c === 'smooth' || f.c === 'straight') n.c = f.c;
  if (f.wall === 'none') delete n.wall;
  else if (f.wall === 'left' || f.wall === 'right' || f.wall === 'both') n.wall = f.wall;
  return settle(c, ctx, { path: r.p, i });
}

/** The edge leaving node `i` turned from a curve into a straight or back (V). */
export function toggleCurve(t: TrackDef, path: string | undefined, i: number, ctx: CourseCtx): CourseEdit {
  const r = nodeRef(t, path, i);
  if (typeof r === 'string') return r;
  const n = t.course!.paths[r.p].nodes[i];
  return setNode(t, path, i, { c: n.c === 'smooth' ? 'straight' : 'smooth' }, ctx);
}

/**
 * A shortcut drawn (§2.11): its points in the file's frame with their heights, the tool's numbers, its first node joined to
 * `joinStart` and its last to `joinEnd` where named (each then stands on that road's spine at its surface).
 */
export function addShortcut(t: TrackDef, points: readonly { x: number; z: number; y: number; c?: CourseCurve }[], joinStart: string | null, joinEnd: string | null, ctx: CourseCtx, tune: CourseTune = COURSE_TUNE): CourseEdit {
  if (!t.course) return `${t.id} has no course to add a shortcut to`;
  if (t.course.paths.length >= COURSE_LIMITS.paths) return `a course holds ${COURSE_LIMITS.paths} paths at most`;
  if (points.length < COURSE_LIMITS.nodesLeast) return `a shortcut has ${COURSE_LIMITS.nodesLeast} nodes at least`;
  if (points.some((p) => !Number.isFinite(p.y))) return 'the ground under a node is not known: fly nearer and draw again';
  const c = copy(t);
  const nodes = points.map((p) => ({ ...nodeOf(p.x, p.z, p.y, tune), c: p.c ?? tune.curve }) as CourseNode);
  const ids = new Set(c.course!.paths.map((p) => p.id));
  if (joinStart !== null && ids.has(joinStart)) nodes[0].j = joinStart;
  if (joinEnd !== null && ids.has(joinEnd)) nodes[nodes.length - 1].j = joinEnd;
  c.course!.paths.push({ id: mintPath(c.course!), nodes });
  return settle(c, ctx);
}

/** A path of a course taken out whole (never the main line): its gates and the grid on it pinned where they stand. */
export function deletePath(t: TrackDef, path: string, ctx: CourseCtx): CourseEdit {
  const p = pathIndex(t, path);
  if (p < 0) return `no path called ${path}`;
  if (p === 0) return 'the main line is the course: take the track out instead';
  const c = copy(t);
  const pin = <P extends TrackPlace>(g: P): P => {
    if (g.path !== path) return g;
    const { path: _p, e: _e, t: _t, ...rest } = g as P & { ow?: 1 };
    delete (rest as { ow?: 1 }).ow;
    return rest as P;
  };
  c.gates = c.gates.map(pin);
  c.grid = pin(c.grid);
  c.course!.paths.splice(p, 1);
  // A path joined to the one taken out keeps its node where it stands, no longer joined.
  for (const q of c.course!.paths) for (const n of q.nodes) if (n.j === path) delete n.j;
  return settle(c, ctx);
}

/** The course's own numbers set (its falloff, crossing, margin, level, grass, walls' place and height), each held to its limit. */
export function setCourse(t: TrackDef, f: Partial<Omit<TrackCourse, 'paths' | 'v'>>, ctx: CourseCtx): CourseEdit {
  if (!t.course) return `${t.id} has no course`;
  const c = copy(t);
  const k = c.course!;
  const L = COURSE_LIMITS;
  const held = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? r2(Math.max(lo, Math.min(hi, v))) : undefined);
  if (f.feather === 'linear' || f.feather === 'easeIn' || f.feather === 'easeOut' || f.feather === 'easeInOut') k.feather = f.feather;
  if (f.crossing === 'wall' || f.crossing === 'slope') k.crossing = f.crossing;
  if (f.grass === 'clear' || f.grass === 'keep') k.grass = f.grass;
  k.margin = held(f.margin, 0, L.marginMost) ?? k.margin;
  k.level = held(f.level, 0, L.levelMost) ?? k.level;
  k.wallOut = held(f.wallOut, 0, L.wallOutMost) ?? k.wallOut;
  k.wallHigh = held(f.wallHigh, L.wallHighLeast, L.wallHighMost) ?? k.wallHigh;
  return settle(c, ctx);
}

/** A track's own words and numbers set (its name, laps, kinds raced, `clear`); a drawn course's kind is set as it is drawn. */
export function setTrack(t: TrackDef, f: { name?: string; laps?: number; for?: RaceKind[]; clear?: number; kind?: string }): CourseEdit {
  const c = copy(t);
  if (f.kind !== undefined && f.kind !== t.kind) {
    if (t.course) return "a drawn course's kind is set as it is drawn: closed it is a circuit, open a sprint";
    if (f.kind !== 'circuit' && f.kind !== 'sprint') return 'a track is a circuit or a sprint';
    c.kind = f.kind;
    if (f.kind === 'sprint') c.laps = 1;
  }
  if (typeof f.name === 'string' && f.name.trim()) c.name = f.name.slice(0, TRACK_LIMITS.name);
  if (typeof f.laps === 'number' && c.kind === 'circuit') c.laps = Math.max(1, Math.min(TRACK_LIMITS.lapsMost, Math.round(f.laps)));
  if (Array.isArray(f.for)) {
    const kinds = (['podracer', 'speederbike'] as RaceKind[]).filter((k) => f.for!.includes(k));
    if (!kinds.length) return 'a track is raced as a pod, a bike, or both';
    c.for = kinds;
  }
  if (typeof f.clear === 'number' && Number.isFinite(f.clear)) c.clear = r2(Math.max(0, Math.min(TRACK_LIMITS.clearMost, f.clear)));
  return readTrack(c, [], 0);
}

// ---- The gates (§2.9) ----

/** Gate `i` moved to a place of the file's frame by hand: it stays where it is put (its anchor dropped). */
export function gateMoved(t: TrackDef, i: number, place: TrackPlace): CourseEdit {
  return moveGateTo(t, i, place);
}

/** Gate `i` turned by hand `yaw` degrees to the left (pinned). */
export function gateTurned(t: TrackDef, i: number, yaw: number): CourseEdit {
  return nudgeGate(t, i, { yaw }, 'raw');
}

/** Gate `i` raised by hand (pinned). */
export function gateRaised(t: TrackDef, i: number, dy: number): CourseEdit {
  return nudgeGate(t, i, { y: dy }, 'raw');
}

/** Gate `i` nudged in its own frame by hand (pinned): metres to the driver's right, up and ahead. */
export function gateNudged(t: TrackDef, i: number, move: { x?: number; y?: number; z?: number }): CourseEdit {
  return nudgeGate(t, i, move, 'raw');
}

/** Gate `i` widened by hand: a following gate keeps following and keeps this width as its own (`ow`). */
export function gateWidened(t: TrackDef, i: number, w: number): CourseEdit {
  return resizeGate(t, i, { w });
}

/** Gate `i` taken out (refused at `TRACK_LIMITS.gatesLeast`). */
export function gateDeleted(t: TrackDef, i: number): CourseEdit {
  return deleteGate(t, i);
}

/** Gate `i` anchored again to the road nearest it (Follow): its width the road's again. */
export function gateFollowed(t: TrackDef, i: number, ctx: CourseCtx): CourseEdit {
  const f = followGate(t, i, ctx.rules, ctx.deckAt);
  return typeof f === 'string' ? f : readTrack(f, [], 0);
}

/** Place gates again: every following gate placed again, the spacing's and the apexes' added where none stands within `gateMin`. */
export function placeGatesAgain(t: TrackDef, ctx: CourseCtx): CourseEdit {
  if (!t.course) return `${t.id} has no course to place gates along`;
  return readTrack(gatesAgain(t, ctx.rules, ctx.deckAt), [], 0);
}

/**
 * Draw its course from its gates (§2.9): one node under each gate at the land's height there and the tool's width (never the
 * gate's own), the gates and the grid left exactly as they are (none gains an anchor); a circuit's main line closed. Answers
 * the track and the notes: each gate standing further off the land than `gateLift + deckBand`.
 */
export function courseFromGates(t: TrackDef, ctx: CourseCtx, tune: CourseTune = COURSE_TUNE): { track: TrackDef; notes: string[] } | string {
  if (t.course) return `${t.id} has a course drawn already`;
  const closed = t.kind === 'circuit';
  const least = closed ? COURSE_LIMITS.closedLeast : COURSE_LIMITS.nodesLeast;
  if (t.gates.length < least) return `${t.id} has ${t.gates.length} gates, and a${closed ? ' closed' : 'n open'} course has ${least} nodes at least`;
  const notes: string[] = [];
  const nodes: CourseNode[] = t.gates.map((g, i) => {
    const land = ctx.land(g.x, g.z);
    const y = Number.isFinite(land) ? land : g.y - tune.gateLift;
    if (Number.isFinite(land) && Math.abs(g.y - land) > tune.gateLift + tune.deckBand) notes.push(`gate ${i} stands ${(g.y - land).toFixed(1)} m off the land under it`);
    return nodeOf(g.x, g.z, y, tune);
  });
  const c = copy(t);
  c.course = { ...courseNumbers(tune), paths: [{ id: 'main', nodes }] };
  const s = settle(c, ctx);
  if (typeof s === 'string') return s;
  return { track: s, notes };
}

/** Where a point of the file's frame lies on a drawn road of a track: its track, path, edge and share, and the surface there. */
export interface OnRoad {
  track: string;
  path: string;
  e: number;
  t: number;
  y: number;
  d: number;
}

/**
 * The drawn road a point stands on, nearest first among the tracks' (within its half width): what a node dropped on a road
 * takes its height from, and where a shortcut starting or ending there is joined. Null for none.
 */
export function onRoad(tracks: readonly TrackDef[], x: number, z: number): OnRoad | null {
  const near = spineNear();
  let best: OnRoad | null = null;
  for (const t of tracks) {
    if (!t.course) continue;
    const spines = courseSpines(t);
    for (let p = 0; p < spines.length; p++) {
      if (!nearestOn(spines[p], x, z, near)) continue;
      if (near.d > near.hw) continue;
      if (!best || near.d < best.d) best = { track: t.id, path: t.course.paths[p].id, e: near.e, t: near.t, y: near.y, d: near.d };
    }
  }
  return best;
}

/** The widest race box of the kinds a track is raced as (m): the pod's 7, the bike's 1 (`raceTune.ts`'s boxes). */
export function widestBox(t: Pick<TrackDef, 'for'>): number {
  const pod = RACE_BASE.podracer.box[0];
  const bike = RACE_BASE.speederbike.box[0];
  return t.for.includes('podracer') ? Math.max(pod, t.for.includes('speederbike') ? bike : 0) : bike;
}

/**
 * The notes a course's shape gives (§2.11), as words, never a refusal: a turn whose inside edge folds over itself, a curve
 * that crosses itself, a road narrower than the widest box raced with room either side, a shoulder at a node steeper than
 * `steepNote` against the land, a node's road under water. (What the road meets and keeps away, a crossing's clearance and
 * the touch-ups a move leaves are the carve's, its second wave.)
 */
export function courseNotes(t: TrackDef, ctx: CourseCtx, tune: CourseTune = COURSE_TUNE): string[] {
  const out: string[] = [];
  if (!t.course) return out;
  const spines = courseSpines(t);
  const box = widestBox(t);
  for (let p = 0; p < spines.length; p++) {
    const path = t.course.paths[p];
    const sp = spines[p];
    const label = p === 0 ? 'node' : `${path.id}'s node`;
    for (const e of foldingEdges(sp)) out.push(`${label} ${e}'s inside edge folds over itself: widen the turn or narrow the road`);
    for (let e = 0; e < sp.edges.length; e++) if (!sp.edges[e].straight && edgeCrossesItself(sp.edges[e])) out.push(`the curve leaving ${label} ${e} crosses itself`);
    for (let i = 0; i < path.nodes.length; i++) {
      const n = path.nodes[i];
      if (n.w < box + 2 * tune.narrowRoom) out.push(`${label} ${i}'s road is ${n.w} m wide, under the widest box raced (${box} m) with ${tune.narrowRoom} m either side`);
      if (ctx.water) {
        const w = ctx.water(n.x, n.z);
        if (Number.isFinite(w) && w > n.y) out.push(`${label} ${i}'s road is ${(w - n.y).toFixed(1)} m under the water`);
      }
      if (n.sh > 0) {
        // The shoulder's outer edge either side, against the land there: its slope from the road's edge.
        const tangent = spinePoint();
        const e = i < sp.edges.length ? i : sp.edges.length - 1;
        spineAt(sp, e, i < sp.edges.length ? 0 : 1, tangent);
        const rx = tangent.tz;
        const rz = -tangent.tx;
        const tb = Math.tan((n.b * Math.PI) / 180);
        for (const side of [1, -1]) {
          const ox = n.x + rx * side * (n.w / 2 + n.sh);
          const oz = n.z + rz * side * (n.w / 2 + n.sh);
          const land = ctx.land(ox, oz);
          if (!Number.isFinite(land)) continue;
          const edge = n.y + side * (n.w / 2) * tb;
          const deg = (Math.atan(Math.abs(edge - land) / n.sh) * 180) / Math.PI;
          if (deg > tune.steepNote) out.push(`${label} ${i}'s ${side > 0 ? 'right' : 'left'} shoulder stands at ${Math.round(deg)}°: widen it or add a node`);
        }
      }
    }
  }
  return out;
}
