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

import { COURSE_LIMITS, TRACK_LIMITS, courseSpines, readTrack, type CourseCurve, type CourseNode, type CourseWall, type RaceKind, type TrackCourse, type TrackDef, type TrackGate, type TrackPlace } from '../race/trackFile.ts';
import { buildSpine, edgeCrossesItself, foldingEdges, nearestOn, spineAt, spineNear, spinePoint, type Spine } from '../race/coursePath.ts';
import { CourseCarve, deckAsk } from '../swg/terrain/courseCarve.ts';
import { alongOf, deleteMap, followCourse, followGate, gateRules, gatesAgain, gridOnSpine, insertMap, locateAlong, placeGates, remapAnchors, roadTurn, roundShare, type DeckAt, type GateRules } from '../race/courseGates.ts';
import { BRUSH_CELL, BRUSH_CHUNK, GROUND_KINDS, GROUND_LIMITS, brushLattice, latticeRound, type BrushChunk, type GroundKind, type GroundShape } from '../race/courseGround.ts';
import { COURSE_TUNE, type CourseTune } from '../race/courseTune.ts';
import { deleteGate, moveGateTo, nudgeGate, resizeGate } from '../race/trackEdits.ts';
import { gridSlot } from '../race/raceGroup.ts';
import { turnHeading } from '../race/gates.ts';
import { fromGame, toGame } from '../story/placements.ts';
import { GROUP_TUNE } from '../net/groups.ts';
import { RACE_BASE } from '../vehicles/raceTune.ts';
import { WALL_LIMITS, arcRefusal, type RaceWall } from '../race/raceWalls.ts';

/** What an edit is judged with: the gates' rules, the land under a point of the file's frame (NaN for none known), a deck. */
export interface CourseCtx {
  rules: GateRules;
  /** The land under a point of the file's (raw) frame: the generator's ground and the sculpt's delta there; NaN for none known. */
  land: (x: number, z: number) => number;
  /** The water's surface over a point of the file's frame (-Infinity for none): a node's road under it is noted. */
  water?: (x: number, z: number) => number;
  deckAt?: DeckAt;
  /**
   * The race drawer's second wave: the gates under a crossing held under its deck as the course itself carves it
   * (`deckAtOf`, worked out from the very course being settled). Absent (a test's, the first wave's), no deck is asked.
   */
  decks?: boolean;
}

/**
 * The deck rule's one store (and its records), kept for the session and refilled at every call: a held drag settles the
 * course at `previewHz`, and a store made each call (with its spines built fresh and the same spines built again for the
 * points) was about 2.4 MB a preview tick of a 400-node course, where refilled its spines are built into their own spare
 * arrays and its buckets in place (`CourseCarve.set`).
 */
const deckStore = new CourseCarve();
const deckP = spinePoint();
const deckQ = deckAsk();

/**
 * Where a course's own carve stands a deck over a point of one of its paths (§2.6), or -Infinity: the gates' `DeckAt` from a
 * store of the track alone (a figure eight's crossing is the course's own; a crossing with another track is that track's own
 * business when it is placed), its spines the store's own, found by path id. **Good only until the next `deckAtOf`**, which
 * refills the store: every caller (`settle`, `placeGatesAgain`, `followGate`, `gatesAgain`) asks it within the one call.
 */
export function deckAtOf(t: TrackDef): DeckAt | undefined {
  if (!t.course) return undefined;
  const store = deckStore;
  store.set([t]);
  if (store.empty) return undefined;
  const held = store.spines();
  return (path, e, share) => {
    let sp: Spine | null = null;
    for (let k = 0; k < held.length; k++) if (held[k].path === path) sp = held[k].spine;
    if (!sp || !spineAt(sp, e, share, deckP)) return -Infinity;
    deckQ.x = deckP.x;
    deckQ.z = deckP.z;
    deckQ.edge = -1;
    store.deckOf(deckQ);
    return deckQ.out;
  };
}

/** The deck rule an edit settles with: the context's own, else the course's own carve where the context asks for decks. */
function deckFor(ctx: CourseCtx, t: TrackDef): DeckAt | undefined {
  return ctx.deckAt ?? (ctx.decks ? deckAtOf(t) : undefined);
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

/**
 * Node `i` of path `p` taken out of a track (anchors remapped), with nothing checked: the merge's and the delete's work. An
 * open path's end taken out takes the stretch it ended (wave 3b): the shapes standing on it go with it, and the brush chunks
 * past the path's new length.
 */
/**
 * A path's brush lattice written on its nodes (wave 3b's review round, `courseGround.ts`): where the path carries brush chunks
 * and its nodes no `bs` yet, each node's lattice coordinate as it stands now (its arclength to the millimetre, the very one a
 * stroke over it was made on) and a closed path's period, so whatever is edited after keeps every stroke with its stretch.
 */
function markLattice(t: TrackDef, p: number): void {
  const c = t.course!;
  const path = c.paths[p];
  if (path.nodes[0]?.bs !== undefined || !c.brush?.some((b) => b.path === path.id)) return;
  const closed = closedPath(t, p);
  const sp = buildSpine(path.nodes, closed);
  const lam = brushLattice(path.nodes, sp.start, sp.length, closed, undefined);
  for (let i = 0; i < path.nodes.length; i++) path.nodes[i].bs = lam[i];
  if (closed) path.bl = latticeRound(lam[path.nodes.length] - lam[0]);
}

function dropNode(t: TrackDef, p: number, i: number): TrackDef {
  markLattice(t, p);
  const path = t.course!.paths[p];
  const n = path.nodes.length;
  const closed = closedPath(t, p);
  const { lens } = lensOf(t, p);
  const c = t.course!;
  if (!closed && (i === 0 || i === n - 1) && c.ground?.length) {
    const lost = i === 0 ? 0 : n - 2;
    const kept = c.ground.filter((s) => s.path !== path.id || s.e !== lost);
    if (kept.length) c.ground = kept;
    else delete c.ground;
  }
  const out = remapAnchors(t, path.id, deleteMap(i, n, closed, lens));
  out.course!.paths[p].nodes.splice(i, 1);
  // An open path's end taken out takes the brush chunks wholly past its new ends on the lattice (the nodes keep their `bs`, so
  // every other stroke stays where it stood); a straddling chunk is kept, its cells past the end never read but within a cell.
  if (!closed && (i === 0 || i === n - 1) && out.course!.brush?.length) {
    const ns = out.course!.paths[p].nodes;
    const sp = buildSpine(ns, false);
    const lam = brushLattice(ns, sp.start, sp.length, false, undefined);
    const lo = lam[0];
    const hi = lam[ns.length - 1];
    const kept = out.course!.brush.filter((b) => b.path !== path.id || ((b.k + 1) * BRUSH_CHUNK > lo && b.k * BRUSH_CHUNK < hi + BRUSH_CELL));
    if (kept.length) out.course!.brush = kept;
    else delete out.course!.brush;
  }
  return out;
}

/** A node put into path `p` after node `e`, at `u` of edge `e`'s arclength, its road's numbers there (anchors remapped). */
function putNode(t: TrackDef, p: number, e: number, u: number): TrackDef {
  markLattice(t, p);
  const path = t.course!.paths[p];
  const closed = closedPath(t, p);
  const before = buildSpine(path.nodes, closed);
  const P = spinePoint();
  spineAt(before, e, u, P);
  const from = path.nodes[e];
  const node: CourseNode = { x: r2(P.x), y: r2(P.y), z: r2(P.z), w: r2(P.hw * 2), b: r2((Math.atan(P.tb) * 180) / Math.PI), sh: r2(P.sh), c: from.c };
  // Put in on a stretch that follows the ground (wave 3b), it follows too.
  if (from.cut === false) node.cut = false;
  if (from.wall) node.wall = from.wall;
  // Its brush lattice coordinate where it stands on its edge (the review round), so no cell of the path moves.
  if (from.bs !== undefined) {
    const lam = brushLattice(path.nodes, before.start, before.length, closed, path.bl);
    const lo = lam[e];
    const hi = lam[e + 1];
    const v = lo + u * (hi - lo);
    const r = latticeRound(v);
    node.bs = r > lo && r < hi ? r : v;
  }
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
  const followed = followCourse(cur, ctx.rules, deckFor(ctx, cur), ctx.land);
  return readTrack(followed, [], 0);
}

/** A track's path index by its id (the main line's when none is named), or -1. */
export function pathIndex(t: TrackDef, path?: string): number {
  if (!t.course) return -1;
  if (path === undefined) return 0;
  return t.course.paths.findIndex((p) => p.id === path);
}

/**
 * Whether `now` numbers its nodes (`what` 'nodes') or its gates ('gates') as `base` did, so that an index taken on `base`
 * names the same node or gate in `now`: what the Course tool asks before its wheel steps are written to the index they were
 * taken on (`EditorCourse.size`), whatever landed meanwhile (an edit of the tool's, an undo, the dev server's word). Nodes:
 * the same paths in the same order, as many nodes on each, and every node but `path`'s node `index` (the one the steps were
 * taken on, which a drag moves) and a shortcut's joined ends (which stand where their road puts them) where it stood, so a
 * node put in or taken out before it, or a merge and a split that leave the count as it was, number it again. Gates: as
 * many, and every gate but `index` on the same anchor (a following gate's place moves with the road) or, pinned, in the
 * same place. Read conservatively: a node put in remaps the following gates' anchors, so it numbers the gates again here
 * although their order holds. A loop over the rows that makes nothing (a frame asks it while steps wait).
 */
export function keepsNumbering(base: TrackDef, now: TrackDef, what: 'nodes' | 'gates', path: number, index: number): boolean {
  if (what === 'gates') {
    const bg = base.gates;
    const ng = now.gates;
    if (bg.length !== ng.length) return false;
    for (let i = 0; i < bg.length; i++) {
      if (i === index) continue;
      const a = bg[i];
      const b = ng[i];
      if (a.path !== undefined) {
        if (b.path !== a.path || b.e !== a.e || b.t !== a.t) return false;
      } else if (b.path !== undefined || b.x !== a.x || b.z !== a.z) return false;
    }
    return true;
  }
  const bc = base.course;
  const nc = now.course;
  if (!bc || !nc || bc.paths.length !== nc.paths.length) return false;
  for (let p = 0; p < bc.paths.length; p++) {
    const bp = bc.paths[p];
    const np = nc.paths[p];
    if (bp.id !== np.id || bp.nodes.length !== np.nodes.length) return false;
    for (let i = 0; i < bp.nodes.length; i++) {
      if (p === path && i === index) continue;
      const a = bp.nodes[i];
      const b = np.nodes[i];
      if (a.j !== undefined || b.j !== undefined) continue;
      if (a.x !== b.x || a.z !== b.z) return false;
    }
  }
  return true;
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
  const placed = placeGates(s, ctx.rules, deckFor(ctx, s), ctx.land);
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
  const put = putNode(copy(t), p, e, cu);
  // Put in on a stretch that follows the ground, it stands on the land there (the review round), as a node made to follow does.
  const made = put.course!.paths[p].nodes[e + 1];
  if (made.cut === false) followLand(made, ctx);
  return settle(put, ctx, { path: p, i: e + 1 });
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
  // A node that follows the ground (wave 3b) takes the land's height where it is put.
  if (n.cut === false) followLand(n, ctx);
  return settle(c, ctx, { path: r.p, i });
}

/** A following node's height set to the land under it (the raw ground and the sculpt's delta), where the land is known. */
function followLand(n: CourseNode, ctx: CourseCtx): void {
  const y = ctx.land(n.x, n.z);
  if (Number.isFinite(y)) n.y = Math.max(-TRACK_LIMITS.height, Math.min(TRACK_LIMITS.height, y));
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
  /** Whether the road cuts the ground here (wave 3b): false follows it, its height then the land's. */
  cut?: boolean;
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
  if (f.cut === true) delete n.cut;
  else if (f.cut === false) {
    n.cut = false;
    if (!fin(f.y)) followLand(n, ctx);
  }
  return settle(c, ctx, { path: r.p, i });
}

/**
 * Nodes `from` to `to` of a path made to cut the ground or to follow it (wave 3b, "Cut the ground" and "Follow the land" over
 * a picked range; on a closed path a range whose end is before its start wraps through node 0): one action.
 */
export function cutRange(t: TrackDef, path: string | undefined, from: number, to: number, cut: boolean, ctx: CourseCtx): CourseEdit {
  const a = nodeRef(t, path, from);
  if (typeof a === 'string') return a;
  const b = nodeRef(t, path, to);
  if (typeof b === 'string') return b;
  const c = copy(t);
  const ns = c.course!.paths[a.p].nodes;
  const closed = closedPath(c, a.p);
  const lo = closed ? from : Math.min(from, to);
  const hi = closed ? to : Math.max(from, to);
  const count = closed ? ((hi - lo + ns.length) % ns.length) + 1 : hi - lo + 1;
  for (let k = 0; k < count; k++) {
    const n = ns[(lo + k) % ns.length];
    if (cut) delete n.cut;
    else {
      n.cut = false;
      followLand(n, ctx);
    }
  }
  return settle(c, ctx);
}

// ---- The start and the finish (wave 3b) ----

/**
 * The grid laid again behind gate 0 (wave 3b): on a drawn course `gridBack` (a circuit) or `gridAhead` (a sprint) back along
 * the main line from where gate 0 stands on it (never before an open road begins), anchored; on a gate-only track as far back
 * along the gate's own way, at the land's height there (else the gate's own less `gateLift`).
 */
function gridBehind(t: TrackDef, g: TrackGate, ctx: CourseCtx): TrackPlace {
  const back = t.kind === 'circuit' ? ctx.rules.gridBack : ctx.rules.gridAhead;
  if (t.course) {
    const sp = courseSpines(t)[0];
    const main = t.course.paths[0].id;
    let s: number;
    if (g.path === main) s = alongOf(sp, g.e ?? 0, g.t ?? 0);
    else {
      const near = spineNear();
      s = nearestOn(sp, g.x, g.z, near) ? alongOf(sp, near.e, near.t) : 0;
    }
    s -= back;
    if (!sp.closed) s = Math.max(0, s);
    const at = { e: 0, t: 0 };
    locateAlong(sp, s, at);
    return gridOnSpine(sp, main, at.e, at.t, undefined, ctx.land);
  }
  const q = g.q;
  // The gate's own way: its +Z turned (a gate faces along the road).
  const fx = 2 * (q[1] * q[3] + q[0] * q[2]);
  const fz = 1 - 2 * (q[1] * q[1] + q[2] * q[2]);
  const fl = Math.sqrt(fx * fx + fz * fz) || 1;
  const x = g.x - (fx / fl) * back;
  const z = g.z - (fz / fl) * back;
  const land = ctx.land(x, z);
  return { x: r2(x), y: r2(Number.isFinite(land) ? land : g.y - ctx.rules.gateLift), z: r2(z), q: roadTurn(fx / fl, fz / fl, 0) };
}

/**
 * Start here (wave 3b, the owner's "Delete any outside of start and finish, not between"): gate `i` made gate 0. On a circuit
 * the gates are numbered again from it in their order round the course, nothing taken out; on a sprint the gates before it
 * are taken out. Either way the grid is laid again behind it, a following gate's anchor kept as it is: one action.
 */
export function startHere(t: TrackDef, i: number, ctx: CourseCtx): CourseEdit {
  if (!Number.isInteger(i) || !t.gates[i]) return `there is no gate ${i}: the gates are 0 to ${t.gates.length - 1}`;
  if (i === 0) return 'gate 0 is the start already';
  const sprint = t.kind === 'sprint';
  const gates = sprint ? t.gates.slice(i) : [...t.gates.slice(i), ...t.gates.slice(0, i)];
  if (gates.length < TRACK_LIMITS.gatesLeast) return `a track keeps ${TRACK_LIMITS.gatesLeast} gates at least: start a sprint before its last gate`;
  const c = copy(t);
  c.gates = gates.map((g) => ({ ...g, q: [...g.q] as TrackGate['q'] }));
  c.grid = gridBehind(c, c.gates[0], ctx);
  return readTrack(c, [], 0);
}

/** Finish here (wave 3b): a sprint's gates after gate `i` taken out, so it finishes there (a circuit finishes where it starts). One action. */
export function finishHere(t: TrackDef, i: number): CourseEdit {
  if (!Number.isInteger(i) || !t.gates[i]) return `there is no gate ${i}: the gates are 0 to ${t.gates.length - 1}`;
  if (t.kind !== 'sprint') return 'a circuit finishes where it starts: Start here moves both';
  if (i === t.gates.length - 1) return `gate ${i} is the finish already`;
  if (i + 1 < TRACK_LIMITS.gatesLeast) return `a track keeps ${TRACK_LIMITS.gatesLeast} gates at least: finish a sprint after its first gate`;
  const c = copy(t);
  c.gates = c.gates.slice(0, i + 1);
  return readTrack(c, [], 0);
}

// ---- The course's own ground (wave 3b) ----

/** What a ground shape's fields may be set to (each held to its limit as it is written). */
export interface ShapeFields {
  kind?: GroundKind;
  off?: number;
  turn?: number;
  l?: number;
  w?: number;
  h?: number;
  soft?: number;
  back?: number;
  /** A new anchor: the path and the place along it (edge and share). */
  path?: string;
  e?: number;
  t?: number;
}

/** A shape's numbers held to their limits and rounded as written (a share to the millionth, the rest to the hundredth). */
function cleanShape(s: GroundShape): GroundShape {
  const L = GROUND_LIMITS;
  const held = (v: number, lo: number, hi: number) => r2(Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo)));
  const out: GroundShape = { kind: s.kind, path: s.path, e: s.e, t: roundShare(s.t), off: held(s.off, -L.off, L.off), turn: held(s.turn, -L.turn, L.turn), l: held(s.l, L.length[0], L.length[1]), w: held(s.w, L.width[0], L.width[1]), h: held(s.h, L.height[0], L.height[1]), soft: held(s.soft, L.soft[0], L.soft[1]) };
  if (s.kind === 'ramp' && s.back !== undefined && s.back > 0) out.back = held(s.back, L.back[0], L.back[1]);
  return out;
}

/**
 * A new shape where a click of the file's frame lands on the picked track's road: on the path whose spine is nearest, its
 * place along it (edge, share) and across it (`off`), turned square to the road, of the tune's kind and size.
 */
export function shapeAt(t: TrackDef, x: number, z: number, tune: CourseTune = COURSE_TUNE): GroundShape | string {
  if (!t.course) return `${t.id} has no course to lay ground on`;
  const spines = courseSpines(t);
  const near = spineNear();
  let best = -1;
  let bd = Infinity;
  let be = 0;
  let bt = 0;
  let bo = 0;
  for (let p = 0; p < spines.length; p++) {
    if (!nearestOn(spines[p], x, z, near) || near.d >= bd) continue;
    bd = near.d;
    best = p;
    be = near.e;
    bt = near.t;
    bo = near.o;
  }
  if (best < 0) return 'no road to lay it on';
  return cleanShape({ kind: tune.shapeKind, path: t.course.paths[best].id, e: be, t: bt, off: bo, turn: 0, l: tune.shapeLength, w: tune.shapeWidth, h: tune.shapeHeight, soft: tune.shapeSoft, back: tune.shapeKind === 'ramp' ? tune.shapeBack : undefined });
}

/** A shape added to a track's course. One action. */
export function shapeAdded(t: TrackDef, s: GroundShape): CourseEdit {
  if (!t.course) return `${t.id} has no course to lay ground on`;
  if ((t.course.ground?.length ?? 0) >= GROUND_LIMITS.shapes) return `a course holds ${GROUND_LIMITS.shapes} shapes at most`;
  const c = copy(t);
  c.course!.ground = [...(c.course!.ground ?? []), cleanShape(s)];
  return readTrack(c, [], 0);
}

/** Shape `i`'s fields set (its kind, place along and across, turn, size, depth or height, softness, a ramp's far side). One action. */
export function shapeSet(t: TrackDef, i: number, f: ShapeFields): CourseEdit {
  const s = t.course?.ground?.[i];
  if (!s) return `there is no shape ${i}`;
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const n: GroundShape = { ...s };
  if (f.kind && GROUND_KINDS.includes(f.kind)) n.kind = f.kind;
  if (typeof f.path === 'string') n.path = f.path;
  if (fin(f.e)) n.e = Math.round(f.e);
  if (fin(f.t)) n.t = f.t;
  for (const k of ['off', 'turn', 'l', 'w', 'h', 'soft', 'back'] as const) if (fin(f[k])) n[k] = f[k];
  const c = copy(t);
  c.course!.ground![i] = cleanShape(n);
  return readTrack(c, [], 0);
}

/** Shape `i` taken out. One action. */
export function shapeRemoved(t: TrackDef, i: number): CourseEdit {
  if (!t.course?.ground?.[i]) return `there is no shape ${i}`;
  const c = copy(t);
  c.course!.ground!.splice(i, 1);
  if (!c.course!.ground!.length) delete c.course!.ground;
  return readTrack(c, [], 0);
}

/**
 * A track's brush chunks of one path changed (the sculpt brush's "This track" stroke, written once as it ends): each chunk
 * index given its new chunk, or null for none. One action.
 */
export function brushChanged(t: TrackDef, path: string, chunks: ReadonlyMap<number, BrushChunk | null>): CourseEdit {
  if (!t.course) return `${t.id} has no course`;
  const c = copy(t);
  const kept = (c.course!.brush ?? []).filter((b) => b.path !== path || !chunks.has(b.k));
  for (const b of chunks.values()) if (b) kept.push({ path: b.path, k: b.k, a: b.a, n: b.n, d: b.d });
  kept.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : x.k - y.k));
  if (kept.length) c.course!.brush = kept;
  else delete c.course!.brush;
  // The path's lattice written on its nodes with its first stroke (the review round): the very coordinates the stroke was made on.
  const p = pathIndex(c, path);
  if (p >= 0) markLattice(c, p);
  return readTrack(c, [], 0);
}

/** What a change took of a course's own ground (a stretch or a path taken out), in words, or '' (said with the write). */
export function groundTakenWords(before: TrackDef | null, after: TrackDef | null): string {
  // Only where road was taken away (a node or a path fewer): a shape or a stroke taken out by hand says so itself.
  const nodes = (t: TrackDef | null) => (t?.course?.paths ?? []).reduce((n, p) => n + p.nodes.length, 0);
  if (!(nodes(after) < nodes(before))) return '';
  const sb = before?.course?.ground?.length ?? 0;
  const sa = after?.course?.ground?.length ?? 0;
  const bb = before?.course?.brush?.length ?? 0;
  const ba = after?.course?.brush?.length ?? 0;
  const said: string[] = [];
  if (sa < sb) said.push(`${sb - sa} shape${sb - sa === 1 ? '' : 's'}`);
  if (ba < bb) said.push(`${bb - ba} brush chunk${bb - ba === 1 ? '' : 's'}`);
  return said.length ? `the stretch taken out took ${said.join(' and ')} of its own ground with it` : '';
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
  // Its own ground goes with it (wave 3b).
  const k = c.course!;
  if (k.ground) {
    k.ground = k.ground.filter((s) => s.path !== path);
    if (!k.ground.length) delete k.ground;
  }
  if (k.brush) {
    k.brush = k.brush.filter((b) => b.path !== path);
    if (!k.brush.length) delete k.brush;
  }
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

/** Gate `i`'s window set by hand (wave 3b: up to `gateWidthMost` wide and `gateHeightMost` tall, past the road's own width). */
export function gateSized(t: TrackDef, i: number, size: { w?: number; h?: number }): CourseEdit {
  return resizeGate(t, i, size);
}

/** Gate `i` taken out (refused at `TRACK_LIMITS.gatesLeast`). */
export function gateDeleted(t: TrackDef, i: number): CourseEdit {
  return deleteGate(t, i);
}

/** Gate `i` anchored again to the road nearest it (Follow): its width the road's again. */
export function gateFollowed(t: TrackDef, i: number, ctx: CourseCtx): CourseEdit {
  const f = followGate(t, i, ctx.rules, deckFor(ctx, t), ctx.land);
  return typeof f === 'string' ? f : readTrack(f, [], 0);
}

/** Place gates again: every following gate placed again, the spacing's and the apexes' added where none stands within `gateMin`. */
export function placeGatesAgain(t: TrackDef, ctx: CourseCtx): CourseEdit {
  if (!t.course) return `${t.id} has no course to place gates along`;
  return readTrack(gatesAgain(t, ctx.rules, deckFor(ctx, t), ctx.land), [], 0);
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
 * The slots of a full group's race behind a track's grid that stand off its drawn main line (§2.9: "the tool notes when the
 * slots' rows leave the road"), for each kind the track is raced as: every slot `gridSlot` stands a member at (as
 * `App.standOnCourse` stands them, the grid carried into the game's frame and its heading `turnHeading`'s), carried back
 * into the file's frame and measured against the road's half width at its nearest point, and on an open road (a sprint's)
 * against its ends too: a slot whose nearest point is where the road begins and that stands behind it (or past where it
 * ends) is off the road however near. A full group is the owner's eight (`GROUP_TUNE.max`), the worst case. Answers each
 * kind's slots off the road, numbered from 1; none for a track with no course.
 */
export function gridSlotsOff(t: TrackDef, most: number = GROUP_TUNE.max): { kind: RaceKind; slots: number[] }[] {
  const out: { kind: RaceKind; slots: number[] }[] = [];
  if (!t.course) return out;
  const sp = courseSpines(t)[0];
  const g = toGame(t.grid, null, 'raw');
  const grid = { x: g.x, y: g.y, z: g.z, heading: turnHeading(g.q) };
  const near = spineNear();
  const end = spinePoint();
  const last = sp.edges.length - 1;
  for (const kind of t.for) {
    const slots: number[] = [];
    for (let i = 0; i < most; i++) {
      const s = gridSlot(grid, i, kind);
      const raw = fromGame({ x: s.x, y: s.y, z: s.z, q: [0, 0, 0, 1] }, null, 'raw');
      if (!nearestOn(sp, raw.x, raw.z, near)) continue;
      let off = near.d > near.hw;
      // An open road's ends: before its first node or past its last, along the road's own way there.
      if (!off && !sp.closed && ((near.e === 0 && near.t <= 0) || (near.e === last && near.t >= 1))) {
        const atEnd = near.e === last && near.t >= 1;
        spineAt(sp, near.e, atEnd ? 1 : 0, end);
        const along = (raw.x - end.x) * end.tx + (raw.z - end.z) * end.tz;
        off = atEnd ? along > 0.5 : along < -0.5;
      }
      if (off) slots.push(i + 1);
    }
    if (slots.length) out.push({ kind, slots });
  }
  return out;
}

/**
 * The notes a course's shape gives (§2.11), as words, never a refusal: a turn whose inside edge folds over itself, a curve
 * that crosses itself, a road narrower than the widest box raced with room either side, a shoulder at a node steeper than
 * `steepNote` against the land, a node's road under water, and a full group's slots behind the grid that stand off the road
 * (`gridSlotsOff`). (What the road meets and keeps away, a crossing's clearance and the touch-ups a move leaves are the
 * carve's, its second wave.)
 */
export function courseNotes(t: TrackDef, ctx: CourseCtx, tune: CourseTune = COURSE_TUNE): string[] {
  const out: string[] = [];
  if (!t.course) return out;
  for (const o of gridSlotsOff(t)) out.push(`a full group's slot${o.slots.length === 1 ? '' : 's'} ${o.slots.join(', ')} (raced as ${o.kind === 'podracer' ? 'pods' : 'bikes'}) stand${o.slots.length === 1 ? 's' : ''} off the road behind the grid`);
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
  // A shape reaching past its road's shoulder (wave 3b's review round): laid only within the road and eased out across the
  // shoulder as the cut is, so said rather than clipped.
  const sb = spinePoint();
  const byId = new Map(t.course.paths.map((p, i) => [p.id, i]));
  (t.course.ground ?? []).forEach((s, i) => {
    const p = byId.get(s.path);
    if (p === undefined || !spineAt(spines[p], Math.min(s.e, spines[p].edges.length - 1), s.t, sb)) return;
    const half = Math.max(s.w, s.l) / 2 + Math.abs(s.off);
    if (half > sb.hw + sb.sh + 0.01) out.push(`ground shape ${i} reaches ${(half - sb.hw - sb.sh).toFixed(1)} m past its road's shoulder: laid only to it, easing out across it`);
  });
  return out;
}

/**
 * Fit to land (§2.11, the race drawer's second wave): every node of a path set to the land under it, and, every `fitStep`
 * metres along each edge where the land departs from the road's line by more than `fitTol`, a node put in at the worst such
 * point at the land's height, so a course follows the dunes. Repeated until nothing departs past the tolerance or the path
 * holds its most nodes. One edit, one action. The land is the generator's ground and the sculpt's delta (never a carve).
 */
export function fitToLand(t: TrackDef, path: string | undefined, ctx: CourseCtx, tune: CourseTune = COURSE_TUNE): CourseEdit {
  const p = pathIndex(t, path);
  if (p < 0) return t.course ? `no path called ${path}` : `${t.id} has no course`;
  let cur = copy(t);
  const ns = cur.course!.paths[p].nodes;
  for (const n of ns) {
    if (n.j !== undefined) continue;
    const y = ctx.land(n.x, n.z);
    if (!Number.isFinite(y)) return `the land under node (${n.x}, ${n.z}) is not known yet: fly nearer`;
    n.y = y;
  }
  const P = spinePoint();
  for (let round = 0; round < 64; round++) {
    const nodes = cur.course!.paths[p].nodes;
    if (nodes.length >= COURSE_LIMITS.nodes) break;
    const sp = buildSpine(nodes, closedPath(cur, p));
    let worst = 0;
    let we = -1;
    let wu = 0.5;
    for (let e = 0; e < sp.edges.length; e++) {
      const ed = sp.edges[e];
      const steps = Math.floor(ed.len / Math.max(2, tune.fitStep));
      for (let k = 1; k <= steps; k++) {
        const u = (k * Math.max(2, tune.fitStep)) / ed.len;
        if (u >= 0.98 || u <= 0.02) continue;
        if (!spineAt(sp, e, u, P)) continue;
        const land = ctx.land(P.x, P.z);
        if (!Number.isFinite(land)) continue;
        const off = Math.abs(land - P.y);
        if (off > tune.fitTol && off > worst) {
          worst = off;
          we = e;
          wu = u;
        }
      }
    }
    if (we < 0) break;
    const put = putNode(cur, p, we, wu);
    const nn = put.course!.paths[p].nodes[we + 1];
    const y = ctx.land(nn.x, nn.z);
    if (Number.isFinite(y)) nn.y = y;
    cur = put;
  }
  return settle(cur, ctx);
}

/** How near parallel two legs of one path must lie over a lower slot to be a hairpin's (the cosine of 30 degrees; ours). */
export const HAIRPIN_WAY = 0.866;
/** How far inside the gap its ends are read (m, a pole; ours, a constant of the measure): never on the abutment's wall. */
export const CROSSING_INSET = 2;

/** One crossing of a course's carve: its middle on the upper road, the deck and the lower road there, and the gap's span. */
export interface CourseCrossing {
  /** The upper path's id and the lower's (one id for a hairpin whose legs overlap: an underpass by the rule). */
  upper: string;
  lower: string;
  hairpin: boolean;
  x: number;
  z: number;
  /**
   * The upper road's surface at the gap's middle and near its two ends (a pole inside each, `CROSSING_INSET`; `A` the earlier
   * along the upper path) with those two places of the raw frame, the lower road's under it, and the clearance between.
   */
  deck: number;
  deckA: number;
  deckB: number;
  xA: number;
  zA: number;
  xB: number;
  zB: number;
  low: number;
  clearance: number;
  /** The upper road's way at the middle (a unit vector of the raw frame), the gap's span along it, and its width there. */
  ux: number;
  uz: number;
  span: number;
  width: number;
}

/**
 * Where a course's own carve makes a crossing (§2.6): along each path, the runs of its samples where its road stands over a
 * lower slot it crosses (the store's own rule, `over`), each a crossing with its gap's span, deck and clearance. Worked out
 * from a store of the track alone; an edit's work, never a frame's.
 */
export function courseCrossings(t: TrackDef): CourseCrossing[] {
  const out: CourseCrossing[] = [];
  if (!t.course) return out;
  const store = new CourseCarve();
  store.set([t]);
  if (store.empty) return out;
  const spines = courseSpines(t);
  const P = spinePoint();
  for (let p = 0; p < spines.length; p++) {
    const id = t.course.paths[p].id;
    const sp = spines[p];
    // A run of samples in a gap: its first and last place along the path and the lower pass's numbers (its way's right).
    let run: { s0: number; s1: number; e0: number; t0: number; e1: number; t1: number; low: number; lower: string; rx: number; rz: number } | null = null;
    /** The spine's point at a place along the path (its edge and share from the path's own starts), into `P`. */
    const atArc = (s: number): void => {
      let me = 0;
      while (me + 1 < sp.edges.length && sp.start[me + 1] <= s) me++;
      const mt = sp.edges[me].len > 0 ? (s - sp.start[me]) / sp.edges[me].len : 0;
      spineAt(sp, me, Math.min(1, Math.max(0, mt)), P);
    };
    const close = (): void => {
      if (!run) return;
      const mid = (run.s0 + run.s1) / 2;
      atArc(mid);
      const midP = { x: P.x, z: P.z, y: P.y, tx: P.tx, tz: P.tz, hw: P.hw };
      // Each end of the gap a little inside it (`CROSSING_INSET`, a pole), where a ray down meets the bridge and never the
      // abutment's own wall the 2 m heightfield slopes between its last two poles.
      const inset = Math.min(CROSSING_INSET, (run.s1 - run.s0) / 4);
      atArc(run.s0 + inset);
      const a = P.y;
      const xA = P.x;
      const zA = P.z;
      atArc(run.s1 - inset);
      const b = P.y;
      const xB = P.x;
      const zB = P.z;
      // A hairpin is one path's legs lying along each other (their ways within `HAIRPIN_WAY` of parallel); one path crossing
      // itself at an angle (a figure eight) is a crossing like any other.
      const tl = Math.sqrt(midP.tx * midP.tx + midP.tz * midP.tz);
      const along = tl > 0 ? Math.abs((midP.tx * -run.rz + midP.tz * run.rx) / tl) : 0;
      const hairpin = run.lower === id && along >= HAIRPIN_WAY;
      out.push({ upper: id, lower: run.lower, hairpin, x: midP.x, z: midP.z, deck: midP.y, deckA: a, deckB: b, xA, zA, xB, zB, low: run.low, clearance: midP.y - run.low, ux: midP.tx, uz: midP.tz, span: run.s1 - run.s0, width: midP.hw * 2 });
      run = null;
    };
    for (let e = 0; e < sp.edges.length; e++) {
      const ed = sp.edges[e];
      for (let i = 0; i < ed.count; i++) {
        const n = store.passesAt(ed.x[i], ed.z[i]);
        let over = false;
        let low = Infinity;
        let lower = '';
        for (let k = 0; k < n; k++) {
          const q = store.passAt(k);
          // This sample's own pass: of this path, through the sample, at its own height (where one path crosses itself the
          // other leg's pass runs through the very same point, at the other leg's height).
          if (CourseCarve.pathOf(q) === id && q.d < 1e-6 && Math.abs(q.y - ed.y[i]) < 1e-6 && q.over >= 0.5) over = true;
        }
        let lrx = 0;
        let lrz = 0;
        if (over) {
          for (let k = 0; k < n; k++) {
            const q = store.passAt(k);
            if (q.join >= 0.5 && q.T < low) {
              low = q.T;
              lower = CourseCarve.pathOf(q);
              lrx = q.rx;
              lrz = q.rz;
            }
          }
        }
        const s = sp.start[e] + ed.s[i];
        if (over && Number.isFinite(low)) {
          const sh = ed.len > 0 ? ed.s[i] / ed.len : 0;
          if (!run) run = { s0: s, s1: s, e0: e, t0: sh, e1: e, t1: sh, low, lower, rx: lrx, rz: lrz };
          else {
            run.s1 = s;
            run.e1 = e;
            run.t1 = sh;
            if (low < run.low) run.low = low;
          }
        } else close();
      }
    }
    close();
  }
  return out;
}

// ---- Fit a bridge (the race drawer's second wave, §2.11): pure, so a node test runs what the editor writes. ----

/** A geometry as the bridge's fit reads it (three's `BufferGeometry` answers it): its positions and its index. */
export interface BridgeGeometry {
  getAttribute(name: 'position'): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } | undefined;
  index: { count: number; getX(i: number): number } | null;
}

/** What a bridge is fitted over: the crossing's middle (raw frame), the upper road's surface there and its way, the span. */
export interface BridgeSpan {
  x: number;
  z: number;
  deck: number;
  ux: number;
  uz: number;
  span: number;
  /** The upper road's surface near each end of the gap (`CourseCrossing.deckA`, `deckB`), where known. */
  deckA?: number;
  deckB?: number;
}

/** Where a bridge stands: its origin and turn in the game's frame, its scale, and what decided them. */
export interface BridgeFit {
  at: { x: number; y: number; z: number };
  q: [number, number, number, number];
  scale: [number, number, number];
  /** The scale along its length, its length at its own size, its walkable top over its origin, and which axis is its length. */
  s: number;
  length: number;
  top: number;
  axis: 'x' | 'z';
  /**
   * How far the bridge's top at each end (its end rays, `walkableTops`) stands off the upper road near that end of the gap
   * (`deckA` at its axis's minimum end, which the turn lays toward the path's earlier side, `deckB` at its other): positive
   * proud of the road. NaN where an end has no top or no road was handed over. A flat bridge over a climbing road stands off
   * it at one end, which the race box meets as a scrape: the words say so.
   */
  offA: number;
  offB: number;
}

/** How far out along its length a bridge's end rays stand from its middle (a share of its length): inside its ends. Ours, a constant of the measure. */
export const BRIDGE_END_SHARE = 0.45;

/**
 * A model's walkable top over its origin, measured by rays down onto its own triangles at its middle and at its two ends along
 * its longer horizontal axis (§2.11), each the highest upward face (normal at least half up, either winding) a vertical line
 * there meets: the median of the three, so a beam, a tower or a roof over one of them (read alone, a crossbeam over mid-span
 * was taken for the deck) never decides it; of two the middle's, else the one; else its box's top. Rails stand at a bridge's
 * sides, so the lines meet the deck.
 */
export function walkableTop(bounds: { min: number[]; max: number[] }, geos: readonly BridgeGeometry[]): number {
  const t = walkableTops(bounds, geos);
  const hits = [t.a, t.mid, t.b].filter((v) => Number.isFinite(v));
  if (hits.length === 3) return hits.sort((p, q) => p - q)[1];
  if (Number.isFinite(t.mid)) return t.mid;
  if (hits.length) return hits[0];
  return bounds.max[1];
}

/** A model's top along its middle line and its two end lines (`walkableTop`'s three rays), -Infinity where a line meets no upward face; `a` the end toward its axis's minimum. */
export function walkableTops(bounds: { min: number[]; max: number[] }, geos: readonly BridgeGeometry[]): { mid: number; a: number; b: number } {
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  const lx = Math.abs(bounds.max[0] - bounds.min[0]);
  const lz = Math.abs(bounds.max[2] - bounds.min[2]);
  const ex = lx >= lz ? lx * BRIDGE_END_SHARE : 0;
  const ez = lx >= lz ? 0 : lz * BRIDGE_END_SHARE;
  return { mid: topAlong(geos, cx, cz), a: topAlong(geos, cx - ex, cz - ez), b: topAlong(geos, cx + ex, cz + ez) };
}

/** The highest upward face a vertical line through (`cx`, `cz`) of a model's own frame meets, or -Infinity. */
function topAlong(geos: readonly BridgeGeometry[], cx: number, cz: number): number {
  let best = -Infinity;
  for (const g of geos) {
    const p = g.getAttribute('position');
    if (!p) continue;
    const idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let k = 0; k + 2 < n; k += 3) {
      const a = idx ? idx.getX(k) : k;
      const b = idx ? idx.getX(k + 1) : k + 1;
      const c = idx ? idx.getX(k + 2) : k + 2;
      const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
      const bx = p.getX(b), by = p.getY(b), bz = p.getZ(b);
      const qx = p.getX(c), qy = p.getY(c), qz = p.getZ(c);
      // The face's normal, either winding: its up share of its length.
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = qx - ax, vy = qy - ay, vz = qz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!(len > 0) || Math.abs(ny) / len < 0.5) continue;
      // Barycentric in the plan.
      const d = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((bz - qz) * (cx - qx) + (qx - bx) * (cz - qz)) / d;
      const l2 = ((qz - az) * (cx - qx) + (ax - qx) * (cz - qz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const y = l1 * ay + l2 * by + l3 * qy;
      if (y > best) best = y;
    }
  }
  return best;
}

/**
 * A bridge fitted over a crossing: its longer horizontal axis turned along the upper road (the raw frame's way mirrored
 * into the game's, x negated), scaled along it to the span (held to the placements' backstops), its box's middle on the
 * crossing's middle and its walkable top on the deck. `centre` is the layout's centre the raw frame is written about.
 */
export function bridgeFit(bounds: { min: number[]; max: number[] }, geos: readonly BridgeGeometry[], ask: BridgeSpan, centre: { x: number; z: number } | null): BridgeFit {
  const lx = Math.abs(bounds.max[0] - bounds.min[0]);
  const lz = Math.abs(bounds.max[2] - bounds.min[2]);
  const axis: 'x' | 'z' = lx >= lz ? 'x' : 'z';
  const length = Math.max(1e-3, axis === 'x' ? lx : lz);
  const s = Math.min(1000, Math.max(0.001, Math.round((ask.span / length) * 1000) / 1000));
  const scale: [number, number, number] = axis === 'x' ? [s, 1, 1] : [1, 1, s];
  // The road's way in the game's frame (x mirrored), and the yaw that lays the length axis along it: three's turn about up
  // takes +X to (cos t, -sin t) and +Z to (sin t, cos t).
  const gx = -ask.ux;
  const gz = ask.uz;
  const t = axis === 'x' ? Math.atan2(-gz, gx) : Math.atan2(gx, gz);
  const q: [number, number, number, number] = [0, Math.sin(t / 2), 0, Math.cos(t / 2)];
  const top = walkableTop(bounds, geos);
  const ends = walkableTops(bounds, geos);
  const offA = Number.isFinite(ends.a) && typeof ask.deckA === 'number' ? ask.deck - top + ends.a - ask.deckA : Number.NaN;
  const offB = Number.isFinite(ends.b) && typeof ask.deckB === 'number' ? ask.deck - top + ends.b - ask.deckB : Number.NaN;
  // The box's middle, scaled and turned, taken off the crossing's middle (game frame).
  const mx = ((bounds.min[0] + bounds.max[0]) / 2) * scale[0];
  const mz = ((bounds.min[2] + bounds.max[2]) / 2) * scale[2];
  const c = Math.cos(t);
  const sn = Math.sin(t);
  const ox = mx * c + mz * sn;
  const oz = -mx * sn + mz * c;
  const cgx = (centre?.x ?? 0) - ask.x;
  const cgz = ask.z - (centre?.z ?? 0);
  return { at: { x: cgx - ox, y: ask.deck - top, z: cgz - oz }, q, scale, s, length, top, axis, offA, offB };
}

/** What a fitted bridge's ends come to, in words: '' where both stand within `lip` (`deckLip`) of the road or are not known. */
export function bridgeEndWords(fit: BridgeFit, lip: number = COURSE_TUNE.deckLip): string {
  let worst = 0;
  for (const v of [fit.offA, fit.offB]) if (Number.isFinite(v) && Math.abs(v) > Math.abs(worst)) worst = v;
  if (!(Math.abs(worst) > lip)) return '';
  return `; it stands ${worst.toFixed(2)} m off the upper road at one end (more than ${lip} m: the road climbs across the gap, so tip it with Shift+R or flatten the upper road over the crossing)`;
}

// ---- The race walls (the race drawer's third wave): each edit one track's whole row, settled as the file is written. ----

/** A wall's numbers held to their limits and rounded as written, and an arc held to its least radius where a moved point outran it. */
function settleWalls(walls: RaceWall[]): void {
  const L = WALL_LIMITS;
  for (const w of walls) {
    w.high = r2(Math.min(L.highMost, Math.max(L.highLeast, w.high)));
    w.lean = r2(Math.min(L.leanMost, Math.max(-L.leanMost, w.lean)));
    for (const p of w.points) {
      p.x = r2(p.x);
      p.y = r2(p.y);
      p.z = r2(p.z);
    }
    for (let j = 0; j < w.points.length; j++) {
      const p = w.points[j];
      if (p.r === undefined) continue;
      const q = w.points[j + 1];
      if (!q) {
        delete p.r;
        continue;
      }
      const half = Math.hypot(q.x - p.x, q.z - p.z) / 2;
      // Up to the hundredth past half the chord, so the rounded radius is never under it.
      const least = Math.ceil(half * 100) / 100;
      const r = Math.sign(p.r) * Math.min(L.radiusMost, Math.max(least, Math.abs(p.r)));
      p.r = r2(r);
    }
  }
}

/** A track with its walls changed by `edit` (on a copy), settled and read back as the reader cleans it, or why it would be refused. */
function withWalls(t: TrackDef, edit: (walls: RaceWall[]) => string | null): CourseEdit {
  const cur = copy(t);
  const walls = cur.walls ?? [];
  const no = edit(walls);
  if (no) return no;
  settleWalls(walls);
  // No wall left is no walls at all, so the track is what it was before any was drawn.
  if (walls.length) cur.walls = walls;
  else delete cur.walls;
  return readTrack(cur, [], 0);
}

/** A wall drawn onto a track (its points in the file's frame, each `r` the edge leaving it, or none). */
export function wallAdded(t: TrackDef, wall: RaceWall): CourseEdit {
  return withWalls(t, (ws) => {
    if (ws.length >= WALL_LIMITS.walls) return `a track holds ${WALL_LIMITS.walls} walls at most`;
    ws.push(JSON.parse(JSON.stringify(wall)) as RaceWall);
    return null;
  });
}

/** A wall's own numbers set: its name, height and lean. */
export function wallSet(t: TrackDef, i: number, f: { name?: string; high?: number; lean?: number }): CourseEdit {
  return withWalls(t, (ws) => {
    const w = ws[i];
    if (!w) return `no wall ${i}`;
    if (f.name !== undefined) w.name = String(f.name);
    if (f.high !== undefined) w.high = Number(f.high);
    if (f.lean !== undefined) w.lean = Number(f.lean);
    return null;
  });
}

/** A wall taken out. */
export function wallRemoved(t: TrackDef, i: number): CourseEdit {
  return withWalls(t, (ws) => {
    if (!ws[i]) return `no wall ${i}`;
    ws.splice(i, 1);
    return null;
  });
}

/** A point of a wall moved (its place and its foot's height, any of them); an arc either side held to its least radius. */
export function wallPointSet(t: TrackDef, i: number, j: number, p: { x?: number; y?: number; z?: number }): CourseEdit {
  return withWalls(t, (ws) => {
    const q = ws[i]?.points[j];
    if (!q) return `no point ${j} on wall ${i}`;
    if (p.x !== undefined) q.x = p.x;
    if (p.y !== undefined) q.y = p.y;
    if (p.z !== undefined) q.z = p.z;
    return null;
  });
}

/** A point put into a wall after point `j` (its place in the file's frame); the edge it splits leaves both halves straight. */
export function wallPointAdded(t: TrackDef, i: number, j: number, p: { x: number; y: number; z: number }): CourseEdit {
  return withWalls(t, (ws) => {
    const w = ws[i];
    if (!w || !w.points[j]) return `no point ${j} on wall ${i}`;
    if (w.points.length >= WALL_LIMITS.points) return `a wall holds ${WALL_LIMITS.points} points at most`;
    delete w.points[j].r;
    w.points.splice(j + 1, 0, { x: p.x, y: p.y, z: p.z });
    return null;
  });
}

/** A point taken out of a wall: a wall left with one point goes with it. */
export function wallPointRemoved(t: TrackDef, i: number, j: number): CourseEdit {
  return withWalls(t, (ws) => {
    const w = ws[i];
    if (!w || !w.points[j]) return `no point ${j} on wall ${i}`;
    if (w.points.length <= WALL_LIMITS.pointsLeast) {
      ws.splice(i, 1);
      return null;
    }
    // The edge before it keeps its curve only where it still has one to keep (the last point's has none).
    w.points.splice(j, 1);
    if (j === w.points.length && j > 0) delete w.points[j - 1].r;
    return null;
  });
}

/** An edge of a wall made an arc of signed radius `r` (bulging to its right as seen in the game for a positive one), or straight (undefined); a radius under half its chord is refused in words. */
export function wallEdgeRadius(t: TrackDef, i: number, j: number, r: number | undefined): CourseEdit {
  return withWalls(t, (ws) => {
    const w = ws[i];
    const p = w?.points[j];
    const q = w?.points[j + 1];
    if (!p || !q) return `no edge ${j} on wall ${i}`;
    if (r === undefined || r === 0) {
      delete p.r;
      return null;
    }
    const c = Math.hypot(q.x - p.x, q.z - p.z);
    if (!Number.isFinite(r) || Math.abs(r) < c / 2 - 1e-9) return `wall ${i}'s edge ${j}: ${arcRefusal(c)}`;
    p.r = r;
    return null;
  });
}