// A world's drawn race courses carved into its ground (the race drawer's second wave, `A:\swg3js\racedrawer\DESIGN.md`
// §2.4 to §2.6): one store over every drawn course of the world, laid under the sculpt's height edits wherever they are laid.
//
// **Where it is laid**: over a generated grid as it enters a cache on the main thread (a block, a far grid), and through a
// pole grid of its own on a world with no converted terrain (`CourseGrid`), exactly where Map-maker II lays a height edit,
// and never inside the generator or its worker, which stay the client's ground. Every write is from raw: a pole is
// `fround(carve(raw))`, and the heights laid over that, so a carved block, a block generated afresh and carved, and one
// undone are the same bits by construction.
//
// **The cross-section** (§2.5) of one pass of a path past a pole: its nearest point on the spine, the road's half width
// `hw`, bank's tan `tb`, shoulder `sh` and surface `y` there, and the pole's signed offset `o` toward the driver's right. On
// the road (`|o| <= hw`) the surface `y + o tb` at weight 1; on the shoulder the near edge's height at the client's own road
// ramp (`feather(fn, 1 - (|o| - hw) / sh)`, `AffectorRoad.rampedHeight`'s form, `feather` imported, never copied); past it
// nothing. An open end's `|o|` is the distance to the end node (a round cap); a joined end has no cap.
//
// **Where passes meet** (§2.6, `choose`): a pass is a run of consecutive samples of one path within reach (a closed path
// wrapping). A higher pass whose road crosses a lower pass's slot (its road widened by the course's `margin`) leaves the
// blend there and the lower joins at weight 1 (the lower road wins where roads overlap, its margins with it); a higher road
// not over a lower slot drops the lower shoulders it stands on (the abutment, `crossing: 'wall'`; `'slope'` keeps them); the
// rest blend by weight (each pass's share `w^4 / sum w^4`, the target the shares' mean, the weight the greatest); both rules
// fade in over the band `level / 2` to `level` (smoothstep), so a difference crossing the band along the road never steps.
// Read so (§2.6 rule 1 says "whose road covers the pole"), the upper road's own embankment beside the crossing spilled half
// its height onto the lower road: a pass whose shoulder covers a lower slot leaves the blend too, where its spine crosses that
// slot here (`crossesSlot`, the two passes' local lines), never where two roads merely run side by side.
//
// **Order-free**: every pass is keyed by intrinsic things (its track's id, its path's id, the first sample of its run) and
// the blend sums them in one sorted order, so the tracks permuted, the shortcuts permuted and a closed path's nodes rotated
// give the same bits.
//
// **The index** is a bucket grid of 16 m cells (a constant) in the raw frame, each a kept typed array of the segment runs of
// every edge whose reach meets it, refilled in place, looked up by number; a pole outside every bucket costs one lookup.
//
// Pure: imports `generator.ts`'s `feather` and `coursePath.ts` alone (the release ships all three: `tools/launcher/pack.mjs`).
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties. Nothing on a frame's path makes anything: numbers ride kept records and fields.

import { feather } from './generator.ts';
import { buildSpine, sameEdge, type Spine, type SpineEdge, type SpineNode } from '../../race/coursePath.ts';
import { BRUSH_ALONG, BRUSH_CELL, BRUSH_CHUNK, KIND_CODE, SHAPE_STRIDE, brushCells, brushLattice, latticeEdge, type BrushChunk, type GroundShape } from '../../race/courseGround.ts';

/** The carve's own version: the walk grid's key folds it in (a change of these constants changes bits). */
export const CARVE_VERSION = 1;
/** The index's cell (m): a constant. */
export const CARVE_BUCKET = 16;
/** The blend's exponent: a strong road beats a faint shoulder. A constant. */
export const CARVE_GAMMA = 4;
/** The no-spawn zones' pieces along a road (m): a constant. */
export const CARVE_PIECE = 32;
/** How far past the road a far grid's sample still takes its surface (half a far step, 16 / 2): a constant. */
export const CARVE_FAR_WIDEN = 8;

/** A round cap's and a round join's outline: how many steps a half circle (a constant of the zones' shape). */
const CAP_STEPS = 12;
/** A node whose two chords turn by more than this (their dot product under it) takes a round join's disc (about 8°). */
const CAP_TURN = 0.99;

/**
 * A disc's outline about (`x`, `z`) holding every point within `r` (its vertices on the circle about it that circumscribes
 * it): `halves` 2 the whole disc, 1 the half toward (`ux`, `uz`), closed along its diameter through the middle.
 */
function discOf(x: number, z: number, r: number, ux: number, uz: number, steps: number, halves: number): [number, number][] {
  const span = halves >= 2 ? Math.PI * 2 : Math.PI;
  const d = span / steps;
  const R = r / Math.cos(d / 2);
  const rx = uz;
  const rz = -ux;
  const pts: [number, number][] = [];
  const count = halves >= 2 ? steps : steps + 1;
  for (let k = 0; k < count; k++) {
    const a = -Math.PI / 2 + k * d;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // From the right round through the way out (and on round, for the whole disc).
    pts.push([x + (ux * c + rx * s) * R, z + (uz * c + rz * s) * R]);
  }
  return pts;
}

/** The client's four road falloffs by name, as `generator.ts`'s `FeatherFunction` numbers them. */
const FEATHER_FN: Record<string, number> = { linear: 0, easeIn: 1, easeOut: 2, easeInOut: 3 };

/** A node as the carve reads it: the spine's numbers and a shortcut's join. */
export interface CarveNode extends SpineNode {
  j?: string;
  /** The brush lattice's coordinate here (wave 3b's review round, `courseGround.ts`). */
  bs?: number;
}
/** A course as the carve reads it (a track's `course`, `trackFile.ts`, read structurally). */
export interface CarveCourseDef {
  feather: string;
  crossing: string;
  margin: number;
  level: number;
  grass: string;
  paths: readonly { id: string; bl?: number; nodes: readonly CarveNode[] }[];
  /** Its own ground (wave 3b, `courseGround.ts`), laid after the road's cut in the road's own frame. */
  ground?: readonly GroundShape[];
  brush?: readonly BrushChunk[];
}
/** A track as the carve reads it: its id, kind, `clear` and course (absent: a gate-only track, carved nothing). */
export interface CarveTrack {
  id: string;
  kind: string;
  clear: number;
  course?: CarveCourseDef;
}

/** A rectangle of the raw frame. */
export interface CarveRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * How much bigger than the larger of two rectangles their union may be for `foldCourseRect` to keep one rectangle for both:
 * a constant of the bookkeeping (a held drag's tick after tick of one edge nearly coincide; two stretches apart never do).
 */
export const CARVE_RECT_FOLD = 1.25;

/**
 * A change's rectangle `q` kept in a list of the first `n` of `rects` (the world's end's list): grown into the first kept
 * rectangle their union stays within `CARVE_RECT_FOLD` of the larger of, else appended (a record made only when the list
 * outgrows itself). Answers the list's new count. Every rectangle handed in stays inside a kept one.
 */
export function foldCourseRect(rects: CarveRect[], n: number, q: CarveRect): number {
  const qa = (q.x1 - q.x0) * (q.z1 - q.z0);
  for (let m = 0; m < n; m++) {
    const g = rects[m];
    const ux0 = g.x0 < q.x0 ? g.x0 : q.x0;
    const ux1 = g.x1 > q.x1 ? g.x1 : q.x1;
    const uz0 = g.z0 < q.z0 ? g.z0 : q.z0;
    const uz1 = g.z1 > q.z1 ? g.z1 : q.z1;
    const ga = (g.x1 - g.x0) * (g.z1 - g.z0);
    if ((ux1 - ux0) * (uz1 - uz0) <= CARVE_RECT_FOLD * (ga > qa ? ga : qa)) {
      g.x0 = ux0;
      g.x1 = ux1;
      g.z0 = uz0;
      g.z1 = uz1;
      return n;
    }
  }
  let r = rects[n];
  if (!r) {
    r = { x0: 0.5, z0: 0.5, x1: 0.5, z1: 0.5 };
    rects.push(r);
  }
  r.x0 = q.x0;
  r.z0 = q.z0;
  r.x1 = q.x1;
  r.z1 = q.z1;
  return n + 1;
}

/** A grid laid over: `raw` the generator's heights, `out` where the carved heights go (may be `raw` itself), its samples' places, and how far past the road a sample takes the road (a far grid's widening). A kept record. */
export interface CarveAsk {
  raw: Float32Array | null;
  out: Float32Array | null;
  x0: number;
  dx: number;
  z0: number;
  dz: number;
  nx: number;
  nz: number;
  widen: number;
}

/** A lay's ask, made once. */
export function carveAsk(): CarveAsk {
  return { raw: null, out: null, x0: 0.5, dx: 2.5, z0: 0.5, dz: 2.5, nx: 0, nz: 0, widen: 0.5 };
}

/** One path of one track as the store keeps it. */
interface PathRec {
  track: string;
  pathId: string;
  closed: boolean;
  joinStart: boolean;
  joinEnd: boolean;
  fn: number;
  margin: number;
  level: number;
  slope: boolean;
  clear: number;
  grassClear: boolean;
  spine: Spine;
  /** The spine before the last change, kept so the next change is built into its arrays (double buffered). */
  spare: Spine | null;
  /** The first global edge of this path in the index. */
  base: number;
  /** Its edges' count now. */
  edges: number;
  /** The node list it was last built from (a change handing the very same list moves nothing). */
  nodesRef: readonly CarveNode[];
  /**
   * Its own ground (wave 3b): its shapes packed `SHAPE_STRIDE` numbers each (their place along the path worked out from their
   * anchors on this spine), its brush chunks by their index along, the text both were made from (a change compares it), and
   * the stretches of the path they reach (pairs of arclengths), for a change's rectangles. None: `shapeN` 0 and `brush` null.
   */
  shapes: Float64Array;
  shapeN: number;
  brush: Map<number, BrushRec> | null;
  /** The brush lattice at its nodes and its last edge's end (`brushLattice`), and the lattice's period on a closed path. */
  lam: Float64Array;
  lamP: number;
  groundSig: string;
  groundAt: number[];
  /** Each stretch's key (a shape's text, a chunk's `k,a,n,d`), beside `groundAt`'s pairs: a change marks only the ones that moved. */
  groundKeys: string[];
  /** Brush chunks it names that were not inflated when it was built (laid as nothing until a later set finds them). */
  missing: number;
}

/** One brush chunk as the carve keeps it: its first cell across, its count across and its deltas (16 along by `n`). */
interface BrushRec {
  a: number;
  n: number;
  cells: Float32Array;
}

const NO_SHAPES = new Float64Array(0);

/** One pass past a pole: its path, the run's first and last segment, its nearest point and the road there. */
export class CarvePass {
  rec: PathRec | null = null;
  firstG = 0;
  firstI = 0;
  firstX = 0.5;
  firstZ = 0.5;
  lastG = 0;
  lastI = 0;
  /** The nearest segment's global edge and index, the share along it, the distance, the signed offset, its spine point and right. */
  g = 0;
  i = 0;
  f = 0.5;
  d = 0.5;
  o = 0.5;
  px = 0.5;
  pz = 0.5;
  rx = 0.5;
  rz = 0.5;
  y = 0.5;
  hw = 0.5;
  tb = 0.5;
  sh = 0.5;
  /** How much it cuts at its nearest point (wave 3b: 1 cutting, 0 following the ground). */
  k = 0.5;
  /** Its surface and weight at the pole (`w` times how much it cuts; `w0` the road's own weight before that), whether its road and its slot cover the pole, and the rules' factors. */
  T = 0.5;
  w = 0.5;
  w0 = 0.5;
  road = false;
  slot = false;
  over = 0.5;
  join = 0.5;
  drop = 0.5;
  we = 0.5;
  gone = false;
  /** Its nearest point is past a joined end (no cap there): left out of the blend. */
  capped = false;
  /** Its own ground's weight through the rules (wave 3b). */
  ga = 0.5;
}

/** A pass's own surface and weight at a pole read back (`sampleAt`): the target, the weight, and the deck there where one stands. */
export interface CarveSample {
  T: number;
  W: number;
  /** The course's own ground laid over the carve there (wave 3b; nought with none). */
  D: number;
}

/** What a tracker or the deck asks of the store at a point: kept, its numbers fields. */
export interface DeckAsk {
  x: number;
  z: number;
  /**
   * The tracked pass (`courseTrack.ts`): its track and path ids, its edge (global index), or `edge` -1 for none, and its place
   * along its path (m, `arcOf`): of that path's passes at the place asked, the one nearest that place along the path is the
   * tracked leg (one path crossing itself, a figure eight, has two passes at its crossing, and only the leg the hull is on
   * may give it a deck).
   */
  track: string;
  path: string;
  edge: number;
  arc: number;
  /** The deck surface found, or -Infinity. */
  out: number;
}

/** A deck ask, made once (its numbers fractions from the first, so their fields hold numbers of their own). */
export function deckAsk(): DeckAsk {
  return { x: 0.5, z: 0.5, track: '', path: '', edge: -1, arc: 0.5, out: -Infinity };
}

/**
 * A bucket's key: a small integer (under 2^30 for every cell within +-16383 of nought, 262 km at 16 m, past every world), so a
 * map's lookup and an append box nothing (`CourseGrid`'s `gridTileNumber`, Map-maker II's `tileNumber`). A cell outside the
 * range answers -2 (never -1, which `lastCell` begins as), and is filed nowhere and read as empty.
 */
const CELL_HALF = 16384;
const CELL_SPAN = 32768;
const cellNumber = (cx: number, cz: number): number => (cx < -(CELL_HALF - 1) || cx > CELL_HALF - 1 || cz < -(CELL_HALF - 1) || cz > CELL_HALF - 1 ? -2 : (cx + CELL_HALF) * CELL_SPAN + (cz + CELL_HALF));
const smooth = (a: number, b: number, v: number): number => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};
/** The rules' fade for a height difference over a band: smoothstep from half the band to the band; with no band, a step past nought. */
export function bandShare(diff: number, level: number): number {
  if (!(level > 0)) return diff > 0 ? 1 : 0;
  return smooth(level / 2, level, diff);
}

/** One path's own ground as text (its shapes, then its chunks' keys and deltas, then its lattice): what a change compares. '' with none. */
function groundSigOf(c: CarveCourseDef, path: { id: string; bl?: number; nodes: readonly CarveNode[] }): string {
  let sig = '';
  for (const s of c.ground ?? []) if (s.path === path.id) sig += JSON.stringify(s);
  let brush = false;
  for (const b of c.brush ?? []) {
    if (b.path !== path.id) continue;
    sig += `|${b.k},${b.a},${b.n},${b.d}`;
    brush = true;
  }
  // The lattice the chunks lie on (the review round): a node's `bs` moved moves every cell after it.
  if (brush && path.nodes[0]?.bs !== undefined) {
    sig += `#${path.bl ?? ''}`;
    for (const n of path.nodes) sig += `,${n.bs}`;
  }
  return sig;
}

/** The store. */
export class CourseCarve {
  /** Moved by every change (`set`), so anything that keeps a laid copy can ask whether the store moved. */
  version = 0;
  /** The paths, in the file's order (only the global index depends on it). */
  private recs: PathRec[] = [];
  private gRec: PathRec[] = [];
  private gIdx: Int32Array = new Int32Array(16);
  private gCount = 0;
  /** The bucket index: by cell number, `[count, (g, i0, i1) * count]`. */
  private readonly buckets = new Map<number, Int32Array>();
  /** The extent of every bucket held, in the raw frame. */
  private ex0 = Infinity;
  private ez0 = Infinity;
  private ex1 = -Infinity;
  private ez1 = -Infinity;
  /** The last bucket looked up (a run of poles in one cell asks the map once). */
  private lastCell = -1;
  private lastArr: Int32Array | null = null;
  /** The passes at the pole asked last, in a pool that grows. */
  private readonly pool: CarvePass[] = [];
  passN = 0;
  /** The passes' indices in the blend's one order. */
  private order = new Int32Array(16);
  /** The query's place and widening (fields, so nothing crosses a call as a number). */
  private qx = 0.5;
  private qz = 0.5;
  private qWiden = 0.5;
  /** 0 the carve's reach (road, shoulder, margin, widening), 1 the masks' (road plus clear). */
  private qMode = 0;
  /** The blend's answer: the target surface and the weight; and the course's own ground laid over it (wave 3b). */
  outT = 0.5;
  outW = 0.5;
  outD = 0.5;
  /** Whether any path held carries ground of its own (wave 3b): with none the blend's ground is never asked, and every pole is as before. */
  private groundAny = false;
  /** Brush chunks named and not yet inflated where the store was last set (`primeBrush` comes first): laid as nothing. */
  brushMissing = 0;
  /** A pass's own ground worked out (`groundAt`) and a brush cell read (`cell`): fields and a register, so no number crosses a call. */
  private gOut = 0.5;
  private readonly gReg = new Float64Array(2);
  /** The dirty rectangles the last change made (raw frame), the first `rectN` of them. */
  readonly rects: CarveRect[] = [];
  rectN = 0;

  /** Whether the store holds no drawn course at all. */
  get empty(): boolean {
    return this.gCount === 0;
  }

  /** The paths held (track, path), for the console. */
  paths(): { track: string; path: string; edges: number; length: number; closed: boolean }[] {
    return this.recs.map((r) => ({ track: r.track, path: r.pathId, edges: r.edges, length: r.spine.length, closed: r.closed }));
  }

  /** How many buckets the index holds (for the console). */
  get bucketCount(): number {
    let n = 0;
    for (const a of this.buckets.values()) if (a[0] > 0) n++;
    return n;
  }

  /** Every path's spine by track and path, in order (the tracker's and the notes'). */
  spines(): { track: string; path: string; spine: Spine; base: number }[] {
    return this.recs.map((r) => ({ track: r.track, path: r.pathId, spine: r.spine, base: r.base }));
  }

  /**
   * The courses put in force (`tracks`: every track of the world's file, those with no course carved nothing). Answers the
   * count of dirty rectangles (in `rects`, the raw frame, old and new, each grown by its edge's reach): the edges whose
   * samples moved bit for bit (`sameEdge`), every edge of a path whose own numbers moved (feather, margin, level, crossing,
   * clear, grass, joins), and every edge of a path added or taken out. `prune` drops the buckets a change emptied (a
   * landing's; a drag's preview keeps them, so refilling makes nothing).
   */
  set(tracks: readonly CarveTrack[], prune = true): number {
    const old = new Map<string, PathRec>();
    for (const r of this.recs) old.set(`${r.track}\u0000${r.pathId}`, r);
    const recs: PathRec[] = [];
    this.rectN = 0;
    for (const t of tracks) {
      const c = t.course;
      if (!c || !c.paths.length) continue;
      const fn = FEATHER_FN[c.feather] ?? 3;
      const clear = Number.isFinite(t.clear) ? Math.max(0, t.clear) : 0;
      for (let p = 0; p < c.paths.length; p++) {
        const path = c.paths[p];
        const nodes = path.nodes;
        if (nodes.length < 2) continue;
        const key = `${t.id}\u0000${path.id}`;
        const closed = p === 0 && t.kind === 'circuit' && nodes.length >= 3;
        const joinStart = p > 0 && typeof nodes[0].j === 'string';
        const joinEnd = p > 0 && typeof nodes[nodes.length - 1].j === 'string';
        const was = old.get(key);
        let rec: PathRec;
        // Its own ground's text (wave 3b): '' with none, so a course with no ground compares and builds as before.
        const sig = c.ground || c.brush ? groundSigOf(c, path) : '';
        if (was) {
          old.delete(key);
          const same = was.closed === closed && was.joinStart === joinStart && was.joinEnd === joinEnd && was.fn === fn && was.margin === c.margin && was.level === c.level && was.slope === (c.crossing === 'slope') && was.clear === clear && was.grassClear === (c.grass === 'clear');
          // The very node list it was built from, with the same numbers and the same ground (every chunk of it inflated): nothing
          // to build or compare (a drag's other paths).
          if (same && was.nodesRef === nodes && was.groundSig === sig && was.missing === 0) {
            recs.push(was);
            continue;
          }
          const into = was.spare ?? undefined;
          const now = buildSpine(nodes, closed, into);
          const most = Math.max(was.spine.edges.length, now.edges.length);
          let moved = false;
          for (let e = 0; e < most; e++) {
            const a = was.spine.edges[e];
            const b = now.edges[e];
            if (same && a && b && sameEdge(a, b)) continue;
            moved = true;
            if (a) this.addRect(a, Math.max(was.margin, was.clear));
            if (b) this.addRect(b, Math.max(c.margin, clear));
          }
          // Its ground's stretches before (on the spine as it was) and after: every one where the road under it moved, its lattice
          // moved or a chunk of it was waiting to be inflated; else (the review round) only the stretches whose shape or chunk
          // changed, so a stroke's preview or one shape edited marks what it touched and not the whole path.
          if (was.groundSig !== sig || was.missing > 0 || (moved && (was.groundSig !== '' || sig !== ''))) {
            const oldAt = was.groundAt;
            const oldKeys = was.groundKeys;
            const oldLam = was.lam;
            const all = moved || was.missing > 0;
            const keep = was.spine;
            was.spine = now;
            this.buildGround(was, c, path, sig);
            was.spine = keep;
            let lamMoved = oldLam.length !== was.lam.length;
            for (let i = 0; !lamMoved && i < oldLam.length; i++) if (oldLam[i] !== was.lam[i]) lamMoved = true;
            if (all || lamMoved) {
              this.rangeRects(was.spine, oldAt, Math.max(was.margin, was.clear));
              this.rangeRects(now, was.groundAt, Math.max(c.margin, clear));
            } else {
              this.changedRects(was.spine, oldAt, oldKeys, was.groundKeys, Math.max(was.margin, was.clear));
              this.changedRects(now, was.groundAt, was.groundKeys, oldKeys, Math.max(c.margin, clear));
            }
          }
          rec = was;
          rec.spare = was.spine;
          rec.spine = now;
          rec.closed = closed;
          rec.joinStart = joinStart;
          rec.joinEnd = joinEnd;
          rec.fn = fn;
          rec.margin = c.margin;
          rec.level = c.level;
          rec.slope = c.crossing === 'slope';
          rec.clear = clear;
          rec.grassClear = c.grass === 'clear';
        } else {
          const spine = buildSpine(nodes, closed);
          rec = { track: t.id, pathId: path.id, closed, joinStart, joinEnd, fn, margin: c.margin, level: c.level, slope: c.crossing === 'slope', clear, grassClear: c.grass === 'clear', spine, spare: null, base: 0, edges: spine.edges.length, nodesRef: nodes, shapes: NO_SHAPES, shapeN: 0, brush: null, lam: NO_SHAPES, lamP: 0, groundSig: '', groundAt: [], groundKeys: [], missing: 0 };
          for (const e of spine.edges) this.addRect(e, Math.max(c.margin, clear));
          if (sig !== '') this.buildGround(rec, c, path, sig);
        }
        rec.nodesRef = nodes;
        rec.edges = rec.spine.edges.length;
        recs.push(rec);
      }
    }
    for (const r of old.values()) for (const e of r.spine.edges) this.addRect(e, Math.max(r.margin, r.clear));
    this.recs = recs;
    let any = false;
    let missing = 0;
    for (const r of recs) {
      if (r.shapeN > 0 || r.brush) any = true;
      missing += r.missing;
    }
    this.groundAny = any;
    this.brushMissing = missing;
    this.fill(prune);
    this.version++;
    this.lastCell = -1;
    this.lastArr = null;
    return this.rectN;
  }

  /** Every edge's rectangle as the dirty list (a store handed to a ground that had none: everything to lay). Answers the count. */
  allRects(): number {
    this.rectN = 0;
    for (const r of this.recs) for (const e of r.spine.edges) this.addRect(e, Math.max(r.margin, r.clear));
    return this.rectN;
  }

  /** An edge's rectangle (raw frame) grown by its reach, pushed onto the dirty list. */
  private addRect(ed: SpineEdge, extra: number): void {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    let reach = 0;
    for (let i = 0; i < ed.count; i++) {
      const x = ed.x[i];
      const z = ed.z[i];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
      const r = ed.hw[i] + Math.max(ed.sh[i], extra, CARVE_FAR_WIDEN);
      if (r > reach) reach = r;
    }
    if (!(x0 <= x1)) return;
    const g = reach + 2;
    let r = this.rects[this.rectN];
    if (!r) {
      r = { x0: 0.5, z0: 0.5, x1: 0.5, z1: 0.5 };
      this.rects.push(r);
    }
    r.x0 = x0 - g;
    r.z0 = z0 - g;
    r.x1 = x1 + g;
    r.z1 = z1 + g;
    this.rectN++;
  }

  /** Every edge of a spine a stretch of its own ground reaches (pairs of arclengths, a closed path's wrapping), pushed onto the dirty list. */
  private rangeRects(sp: Spine, ranges: readonly number[], extra: number): void {
    for (let r = 0; r + 1 < ranges.length; r += 2) this.rangeRect(sp, ranges[r], ranges[r + 1], extra);
  }

  /** Every edge of a spine one stretch (two arclengths, a closed path's wrapping) reaches, pushed onto the dirty list. */
  private rangeRect(sp: Spine, lo: number, hi: number, extra: number): void {
    const L = sp.length;
    for (let e = 0; e < sp.edges.length; e++) {
      const a = sp.start[e];
      const b = a + sp.edges[e].len;
      let hit = lo <= b && hi >= a;
      if (!hit && sp.closed && L > 0) hit = (lo - L <= b && hi - L >= a) || (lo + L <= b && hi + L >= a);
      if (hit) this.addRect(sp.edges[e], extra);
    }
  }

  /**
   * The stretches of `ranges` (keyed by `keys`, a pair each) that `other` holds fewer of (a shape or a chunk changed, added or
   * taken out), pushed onto the dirty list: counted, so one of two like shapes taken out still marks its stretch.
   */
  private changedRects(sp: Spine, ranges: readonly number[], keys: readonly string[], other: readonly string[], extra: number): void {
    const left = new Map<string, number>();
    for (const k of other) left.set(k, (left.get(k) ?? 0) + 1);
    for (let r = 0; r < keys.length && 2 * r + 1 < ranges.length; r++) {
      const c = left.get(keys[r]) ?? 0;
      if (c > 0) left.set(keys[r], c - 1);
      else this.rangeRect(sp, ranges[2 * r], ranges[2 * r + 1], extra);
    }
  }

  /**
   * A path's own ground built from its course (wave 3b) on the spine it holds: each shape's place along the path worked out
   * from its anchor (an anchor past the path's edges at the end of its last, as a gate's), packed; each brush chunk with its
   * inflated deltas (one never inflated, or of the wrong size, counted and laid as nothing); and the stretches they reach.
   */
  private buildGround(rec: PathRec, c: CarveCourseDef, path: { id: string; bl?: number; nodes: readonly CarveNode[] }, sig: string): void {
    const pathId = path.id;
    const sp = rec.spine;
    const E = sp.edges.length;
    const at: number[] = [];
    const keys: string[] = [];
    let n = 0;
    for (const s of c.ground ?? []) if (s.path === pathId) n++;
    const S = SHAPE_STRIDE;
    const arr = rec.shapes.length >= n * S ? rec.shapes : new Float64Array(n * S);
    let j = 0;
    for (const s of c.ground ?? []) {
      if (s.path !== pathId) continue;
      const e = Math.min(s.e, E - 1);
      const share = s.e > E - 1 ? 1 : s.t;
      const s0 = E > 0 && e >= 0 ? sp.start[e] + share * sp.edges[e].len : 0;
      const th = (s.turn * Math.PI) / 180;
      const hl = s.l / 2;
      const hw = s.w / 2;
      const back = s.back ?? 0;
      const R = Math.sqrt((hl + back) * (hl + back) + hw * hw);
      const o = j * S;
      arr[o] = s0;
      arr[o + 1] = s.off;
      arr[o + 2] = Math.cos(th);
      arr[o + 3] = Math.sin(th);
      arr[o + 4] = hl;
      arr[o + 5] = hw;
      arr[o + 6] = s.h;
      arr[o + 7] = s.soft;
      arr[o + 8] = back;
      arr[o + 9] = KIND_CODE[s.kind] ?? 0;
      arr[o + 10] = R;
      at.push(s0 - R, s0 + R);
      keys.push(JSON.stringify(s));
      j++;
    }
    rec.shapes = n ? arr : NO_SHAPES;
    rec.shapeN = n;
    let map: Map<number, BrushRec> | null = null;
    let missing = 0;
    // The brush lattice on this spine (the review round): from the nodes' own `bs`, else their arclengths.
    const has = c.brush?.some((b) => b.path === pathId) ?? false;
    const lam = has ? brushLattice(path.nodes, sp.start, sp.length, rec.closed, path.bl) : NO_SHAPES;
    rec.lam = lam;
    rec.lamP = has && rec.closed ? lam[E] - lam[0] : 0;
    const where = { e: 0, t: 0 };
    const arcOf = (v: number): number => {
      const x = rec.closed ? v : Math.max(lam[0], Math.min(lam[E], v));
      return latticeEdge(lam, E, rec.closed, x, where) ? sp.start[where.e] + where.t * sp.edges[where.e].len : 0;
    };
    for (const b of c.brush ?? []) {
      if (b.path !== pathId) continue;
      const cells = brushCells(b.d);
      if (!cells || cells.length !== BRUSH_ALONG * b.n) {
        missing++;
        continue;
      }
      if (!map) map = new Map();
      map.set(b.k, { a: b.a, n: b.n, cells });
      const a0 = arcOf(b.k * BRUSH_CHUNK - BRUSH_CELL);
      let a1 = arcOf((b.k + 1) * BRUSH_CHUNK);
      if (rec.closed && a1 < a0) a1 += sp.length;
      at.push(a0, a1);
      keys.push(`${b.k},${b.a},${b.n},${b.d}`);
    }
    rec.brush = map;
    rec.missing = missing;
    rec.groundSig = sig;
    rec.groundAt = at;
    rec.groundKeys = keys;
  }

  /** The global edge table and every bucket filled again in place from the paths now held. */
  private fill(prune: boolean): void {
    let g = 0;
    for (const r of this.recs) {
      r.base = g;
      g += r.edges;
    }
    this.gCount = g;
    if (this.gIdx.length < g) this.gIdx = new Int32Array(Math.max(g, this.gIdx.length * 2));
    this.gRec.length = g;
    for (const r of this.recs) for (let e = 0; e < r.edges; e++) {
      this.gRec[r.base + e] = r;
      this.gIdx[r.base + e] = e;
    }
    for (const a of this.buckets.values()) a[0] = 0;
    this.ex0 = Infinity;
    this.ez0 = Infinity;
    this.ex1 = -Infinity;
    this.ez1 = -Infinity;
    const B = CARVE_BUCKET;
    for (let gi = 0; gi < g; gi++) {
      const rec = this.gRec[gi];
      const ed = rec.spine.edges[this.gIdx[gi]];
      const extra = Math.max(rec.margin, rec.clear, CARVE_FAR_WIDEN);
      for (let i = 0; i + 1 < ed.count; i++) {
        const ra = ed.hw[i] + Math.max(ed.sh[i], extra);
        const rb = ed.hw[i + 1] + Math.max(ed.sh[i + 1], extra);
        const reach = (ra > rb ? ra : rb) + 2;
        const ax = ed.x[i];
        const bx = ed.x[i + 1];
        const az = ed.z[i];
        const bz = ed.z[i + 1];
        const lx = (ax < bx ? ax : bx) - reach;
        const hx = (ax < bx ? bx : ax) + reach;
        const lz = (az < bz ? az : bz) - reach;
        const hz = (az < bz ? bz : az) + reach;
        if (lx < this.ex0) this.ex0 = lx;
        if (hx > this.ex1) this.ex1 = hx;
        if (lz < this.ez0) this.ez0 = lz;
        if (hz > this.ez1) this.ez1 = hz;
        const cx0 = Math.floor(lx / B);
        const cx1 = Math.floor(hx / B);
        const cz0 = Math.floor(lz / B);
        const cz1 = Math.floor(hz / B);
        for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.append(cellNumber(cx, cz), gi, i);
      }
    }
    if (prune) for (const [k, a] of this.buckets) if (a[0] === 0) this.buckets.delete(k);
  }

  /** A segment added to a bucket's list: the run it continues extended, else a new run (the list grown by doubling). */
  private append(cell: number, g: number, i: number): void {
    if (cell < 0) return;
    let a = this.buckets.get(cell);
    if (!a) {
      a = new Int32Array(1 + 3 * 4);
      this.buckets.set(cell, a);
    }
    const n = a[0];
    if (n > 0) {
      const k = 1 + (n - 1) * 3;
      if (a[k] === g && a[k + 2] === i - 1) {
        a[k + 2] = i;
        return;
      }
    }
    if (1 + (n + 1) * 3 > a.length) {
      const b = new Int32Array(a.length * 2);
      b.set(a);
      a = b;
      this.buckets.set(cell, a);
      if (this.lastCell === cell) this.lastArr = a;
    }
    const k = 1 + n * 3;
    a[k] = g;
    a[k + 1] = i;
    a[k + 2] = i;
    a[0] = n + 1;
  }

  /** Whether any road's reach meets a rectangle of the raw frame (its poles at the edges included). */
  touches(x0: number, z0: number, x1: number, z1: number): boolean {
    if (this.gCount === 0) return false;
    const lx = x0 < x1 ? x0 : x1;
    const hx = x0 < x1 ? x1 : x0;
    const lz = z0 < z1 ? z0 : z1;
    const hz = z0 < z1 ? z1 : z0;
    if (hx < this.ex0 || lx > this.ex1 || hz < this.ez0 || lz > this.ez1) return false;
    const B = CARVE_BUCKET;
    const cx0 = Math.floor(lx / B);
    const cx1 = Math.floor(hx / B);
    const cz0 = Math.floor(lz / B);
    const cz1 = Math.floor(hz / B);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = cellNumber(cx, cz);
      if (k < 0) continue;
      const a = this.buckets.get(k);
      if (a && a[0] > 0) return true;
    }
    return false;
  }

  /** The cells (16 m) a non-empty bucket names, for the pole grid's tiles: each as `[cx, cz]` (`cellNumber` read back). A change's work. */
  cells(): [number, number][] {
    const out: [number, number][] = [];
    for (const [k, a] of this.buckets) if (a[0] > 0) out.push([Math.floor(k / CELL_SPAN) - CELL_HALF, (k % CELL_SPAN) - CELL_HALF]);
    return out;
  }

  /** A pass out of the pool. */
  private passOf(k: number): CarvePass {
    let p = this.pool[k];
    if (!p) {
      p = new CarvePass();
      this.pool.push(p);
    }
    return p;
  }

  /**
   * The passes at the query's place (`qx`, `qz`) within the query's reach (`qMode`: the carve's, or the masks'), into the pool
   * (`passN`); each its run's nearest point and the road there, its surface and weight worked out. Nothing made once the pool
   * is big enough.
   */
  private scan(): number {
    this.passN = 0;
    if (this.gCount === 0) return 0;
    const x = this.qx;
    const z = this.qz;
    if (x < this.ex0 || x > this.ex1 || z < this.ez0 || z > this.ez1) return 0;
    const B = CARVE_BUCKET;
    const cell = cellNumber(Math.floor(x / B), Math.floor(z / B));
    let a: Int32Array | null | undefined;
    if (cell === this.lastCell) a = this.lastArr;
    else {
      a = cell < 0 ? null : (this.buckets.get(cell) ?? null);
      this.lastCell = cell;
      this.lastArr = a;
    }
    if (!a || a[0] === 0) return 0;
    const runs = a[0];
    const mode = this.qMode;
    const widen = this.qWiden;
    let cur: CarvePass | null = null;
    for (let r = 0; r < runs; r++) {
      const k = 1 + r * 3;
      const g = a[k];
      const i0 = a[k + 1];
      const i1 = a[k + 2];
      const rec = this.gRec[g];
      const e = this.gIdx[g];
      const ed = rec.spine.edges[e];
      const lastSeg = ed.count - 2;
      const firstEdge = e === 0;
      const lastEdge = e === rec.edges - 1;
      for (let i = i0; i <= i1; i++) {
        const ax = ed.x[i];
        const az = ed.z[i];
        const dx = ed.x[i + 1] - ax;
        const dz = ed.z[i + 1] - az;
        const l2 = dx * dx + dz * dz;
        const u = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
        // A joined end has no cap: a pass whose nearest point is past it (`capped`, below) is left out, and the road it joins
        // answers. Left in the run, so the nearest is the end itself and never a later sample clamped to its own start.
        const past = (rec.joinStart && firstEdge && i === 0 && u < 0) || (rec.joinEnd && lastEdge && i === lastSeg && u > 1);
        const f = u < 0 ? 0 : u > 1 ? 1 : u;
        const px = ax + dx * f;
        const pz = az + dz * f;
        const ex = x - px;
        const ez = z - pz;
        const d = Math.sqrt(ex * ex + ez * ez);
        const hw = ed.hw[i] + (ed.hw[i + 1] - ed.hw[i]) * f;
        const sh = ed.sh[i] + (ed.sh[i + 1] - ed.sh[i]) * f;
        let reach: number;
        if (mode === 0) {
          reach = sh > rec.margin ? sh : rec.margin;
          if (widen > reach) reach = widen;
          reach += hw;
        } else reach = hw + rec.clear;
        if (!(d <= reach)) {
          cur = null;
          continue;
        }
        const cont = cur !== null && cur.rec === rec && ((cur.lastG === g && cur.lastI === i - 1) || (cur.lastG === g - 1 && i === 0 && cur.lastI === rec.spine.edges[this.gIdx[g - 1]].count - 2));
        if (!cont) {
          cur = this.passOf(this.passN++);
          cur.rec = rec;
          cur.firstG = g;
          cur.firstI = i;
          cur.firstX = ax;
          cur.firstZ = az;
          cur.d = Infinity;
          cur.gone = false;
        }
        const p = cur!;
        p.lastG = g;
        p.lastI = i;
        // The nearest of the run's segments (a tie to the one starting further down x, then z: intrinsic, so a closed path
        // rotated finds the same).
        if (d < p.d || (d === p.d && (ax < p.px || (ax === p.px && az < p.pz)))) {
          const l = Math.sqrt(l2);
          const cr = ex * dz - ez * dx;
          p.g = g;
          p.i = i;
          p.f = f;
          p.capped = past;
          p.d = d;
          p.o = cr >= 0 ? d : -d;
          p.px = px;
          p.pz = pz;
          p.rx = l > 0 ? dz / l : 0;
          p.rz = l > 0 ? -dx / l : 0;
          p.y = ed.y[i] + (ed.y[i + 1] - ed.y[i]) * f;
          p.hw = hw;
          p.tb = ed.tb[i] + (ed.tb[i + 1] - ed.tb[i]) * f;
          p.sh = sh;
          // 1 + (1 - 1) f is 1 exactly: a course that cuts everywhere is carved as before to the bit.
          p.k = ed.k[i] + (ed.k[i + 1] - ed.k[i]) * f;
        }
      }
      // A run is cut where the next list entry does not carry it on (the check is the continuation test above).
    }
    // A closed path's run across its node 0 is one pass: the run ending at its last segment and the run starting at its
    // first merged (the first sample kept as the earlier run's, which is where the run begins along the path).
    let n = this.passN;
    for (let k = 0; k < n; k++) {
      const s = this.pool[k];
      const rec = s.rec!;
      if (!rec.closed || s.gone || s.firstG !== rec.base || s.firstI !== 0) continue;
      const lastG = rec.base + rec.edges - 1;
      const lastI = rec.spine.edges[rec.edges - 1].count - 2;
      for (let m = 0; m < n; m++) {
        const t = this.pool[m];
        if (m === k || t.gone || t.rec !== rec || t.lastG !== lastG || t.lastI !== lastI) continue;
        if (t.d < s.d || (t.d === s.d && (t.px < s.px || (t.px === s.px && t.pz < s.pz)))) this.copyNearest(t, s);
        s.firstG = t.firstG;
        s.firstI = t.firstI;
        s.firstX = t.firstX;
        s.firstZ = t.firstZ;
        t.gone = true;
      }
    }
    // The pool compacted, each pass's surface and weight worked out.
    let w = 0;
    for (let k = 0; k < n; k++) {
      const s = this.pool[k];
      if (s.gone || s.capped) continue;
      if (w !== k) {
        this.pool[k] = this.pool[w];
        this.pool[w] = s;
      }
      this.crossSection(s);
      w++;
    }
    n = w;
    this.passN = n;
    return n;
  }

  /** The nearest point's numbers of one pass copied onto another (the wrap's merge). */
  private copyNearest(from: CarvePass, to: CarvePass): void {
    to.g = from.g;
    to.i = from.i;
    to.f = from.f;
    to.capped = from.capped;
    to.d = from.d;
    to.o = from.o;
    to.px = from.px;
    to.pz = from.pz;
    to.rx = from.rx;
    to.rz = from.rz;
    to.y = from.y;
    to.hw = from.hw;
    to.tb = from.tb;
    to.sh = from.sh;
    to.k = from.k;
  }

  /** One pass's surface, weight, road and slot at the query (§2.5), the far widening counted as road. */
  private crossSection(p: CarvePass): void {
    const rec = p.rec!;
    const d = p.d;
    const hw = p.hw;
    const widen = this.qMode === 0 ? this.qWiden : 0;
    p.road = d <= hw + widen;
    p.slot = d <= hw + rec.margin;
    if (d <= hw) p.T = p.y + p.o * p.tb;
    else p.T = p.y + (p.o >= 0 ? hw : -hw) * p.tb;
    if (p.road) p.w = 1;
    else if (p.sh > 0 && d < hw + p.sh) p.w = feather(rec.fn, 1 - (d - hw) / p.sh);
    else p.w = 0;
    // The road's own weight before how much it cuts (wave 3b), what its own ground is faded by: never the far widening (the
    // review round: a far tile lays the ground no wider than a near one).
    p.w0 = widen > 0 && d > hw ? (p.sh > 0 && d < hw + p.sh ? feather(rec.fn, 1 - (d - hw) / p.sh) : 0) : p.w;
    // Where the road follows the ground (wave 3b), it carves by how much it cuts there: nought at a following node.
    if (p.k !== 1) p.w = p.w * p.k;
    p.over = 0;
    p.join = 0;
    p.drop = 0;
    p.we = p.w;
  }

  /**
   * Whether a higher pass `a` crosses a lower pass `b`'s slot here: its road covers the pole, or its spine point nearest the
   * pole lies within `b`'s slot by the two passes' local lines (`b`'s offset of `a`'s spine point, `o_b - o_a (r_a . r_b)`).
   */
  private static crossesSlot(a: CarvePass, b: CarvePass): boolean {
    if (a.road) return true;
    const ob = b.o - a.o * (a.rx * b.rx + a.rz * b.rz);
    const lim = b.hw + b.rec!.margin;
    return ob <= lim && ob >= -lim;
  }

  /**
   * The rules over the passes at the pole (§2.6), into `outT` and `outW`: the lower road's slot under a higher pass, the
   * abutment, the blend by weight in one sorted order. With no pass, `outW` 0.
   */
  private choose(): void {
    const n = this.passN;
    const P = this.pool;
    if (n === 0) {
      this.outT = 0;
      this.outW = 0;
      this.outD = 0;
      return;
    }
    if (n > 1) {
      // Rule 1: a higher pass over a lower slot it crosses.
      for (let a = 0; a < n; a++) {
        const A = P[a];
        if (!(A.w > 0)) continue;
        for (let b = 0; b < n; b++) {
          if (a === b) continue;
          const B = P[b];
          if (!B.slot) continue;
          const diff = A.T - B.T;
          const lv = A.rec!.level > B.rec!.level ? A.rec!.level : B.rec!.level;
          if (!(diff > lv / 2) && !(lv <= 0 && diff > 0)) continue;
          if (!CourseCarve.crossesSlot(A, B)) continue;
          const s = bandShare(diff, lv);
          if (s > A.over) A.over = s;
          if (s > B.join) B.join = s;
        }
      }
      // Rule 2: a higher road not over a lower slot drops the lower shoulders it stands on (a wall), unless its course's
      // crossing is a slope.
      for (let a = 0; a < n; a++) {
        const A = P[a];
        if (!A.road || A.rec!.slope || A.over >= 1) continue;
        for (let b = 0; b < n; b++) {
          if (a === b) continue;
          const B = P[b];
          if (B.road || B.slot || !(B.w > 0)) continue;
          const diff = A.T - B.T;
          const lv = A.rec!.level > B.rec!.level ? A.rec!.level : B.rec!.level;
          if (!(diff > lv / 2) && !(lv <= 0 && diff > 0)) continue;
          // A road following the ground (wave 3b) drops nothing by how much it follows (times 1 where it cuts: as before).
          const s = bandShare(diff, lv) * (1 - A.over) * A.k;
          if (s > B.drop) B.drop = s;
        }
      }
      // Rule 3 (ours, beside §2.6): a road keeps its surface under a higher pass's shoulder that stands beside it rather than
      // over it (two passes side by side, a hairpin's legs): the higher shoulder is dropped on the road, so the bank of the one
      // never spills onto the other's road. Faded over the same band, so a level pair still blends.
      for (let b = 0; b < n; b++) {
        const B = P[b];
        if (!B.road) continue;
        for (let a = 0; a < n; a++) {
          if (a === b) continue;
          const A = P[a];
          if (A.road || !(A.w > 0)) continue;
          const diff = A.T - B.T;
          const lv = A.rec!.level > B.rec!.level ? A.rec!.level : B.rec!.level;
          if (!(diff > lv / 2) && !(lv <= 0 && diff > 0)) continue;
          const s = bandShare(diff, lv) * B.k;
          if (s > A.drop) A.drop = s;
        }
      }
      for (let k = 0; k < n; k++) {
        const p = P[k];
        // A lower road joined under a higher one carves its slot by how much it cuts (1 - w where it cuts: as before).
        const joined = p.w + (p.k - p.w) * p.join;
        p.we = joined * (1 - p.over) * (1 - p.drop);
      }
    }
    // The blend, summed in one order of intrinsic keys.
    if (this.order.length < n) this.order = new Int32Array(Math.max(n, this.order.length * 2));
    const ord = this.order;
    for (let k = 0; k < n; k++) ord[k] = k;
    for (let k = 1; k < n; k++) {
      const v = ord[k];
      let m = k - 1;
      while (m >= 0 && CourseCarve.before(P[v], P[ord[m]])) {
        ord[m + 1] = ord[m];
        m--;
      }
      ord[m + 1] = v;
    }
    // The course's own ground (wave 3b), laid over the carve: each pass's shapes and brush cells at its place along and across
    // its road, shared by where its carve wins (its road's own weight through the rules, before how much it cuts: a road that
    // follows the ground still carries its holes), and faded by that same weight (the review round), so it eases out across
    // the shoulder as the cut does and never stands as a cliff at the shoulder's edge; inside a lone road the weight is 1 and
    // the ground its own to the bit. Never asked where no path carries any.
    let D = 0;
    if (this.groundAny) {
      let gsum = 0;
      let gonly = -1;
      for (let k = 0; k < n; k++) {
        const p = P[ord[k]];
        const ga = (p.w0 + (1 - p.w0) * p.join) * (1 - p.over) * (1 - p.drop);
        p.ga = ga;
        if (!(ga > 0)) continue;
        gsum += ga * ga * ga * ga;
        gonly = gonly === -1 ? ord[k] : -2;
      }
      if (gsum > 0) {
        for (let k = 0; k < n; k++) {
          const p = P[ord[k]];
          const rec = p.rec!;
          if (rec.shapeN === 0 && rec.brush === null) continue;
          const ga = p.ga;
          if (!(ga > 0)) continue;
          this.groundAt(p);
          const g = this.gOut;
          if (g === 0) continue;
          D += gonly >= 0 ? (ga === 1 ? g : ga * g) : ((ga * ga * ga * ga) / gsum) * ga * g;
        }
      }
    }
    this.outD = D;
    let sum = 0;
    let sumT = 0;
    let W = 0;
    for (let k = 0; k < n; k++) {
      const p = P[ord[k]];
      const we = p.we;
      if (!(we > 0)) continue;
      const s = we * we * we * we;
      sum += s;
      sumT += s * p.T;
      if (we > W) W = we;
    }
    if (!(sum > 0)) {
      this.outT = 0;
      this.outW = 0;
      return;
    }
    // A single pass is its own surface to the bit.
    let only = -1;
    for (let k = 0; k < n; k++) {
      if (!(P[k].we > 0)) continue;
      if (only >= 0) {
        only = -2;
        break;
      }
      only = k;
    }
    this.outT = only >= 0 ? P[only].T : sumT / sum;
    this.outW = W > 1 ? 1 : W;
  }

  /** The blend's order: by surface, then the track's and the path's ids, then the run's first sample (x, then z). */
  private static before(a: CarvePass, b: CarvePass): boolean {
    if (a.T !== b.T) return a.T < b.T;
    const ra = a.rec!;
    const rb = b.rec!;
    if (ra.track !== rb.track) return ra.track < rb.track;
    if (ra.pathId !== rb.pathId) return ra.pathId < rb.pathId;
    if (a.firstX !== b.firstX) return a.firstX < b.firstX;
    return a.firstZ < b.firstZ;
  }

  /**
   * A pass's own ground at the query (wave 3b, into `gOut`): its shapes and its brush cells at its place along its path and
   * across its road, `courseGround.ts`'s rules written out in line (no number crosses a call). Nothing made.
   */
  private groundAt(p: CarvePass): void {
    const rec = p.rec!;
    const e = this.gIdx[p.g];
    const ed = rec.spine.edges[e];
    const s = rec.spine.start[e] + ed.s[p.i] + (ed.s[p.i + 1] - ed.s[p.i]) * p.f;
    const o = p.o;
    const L = rec.spine.length;
    let g = 0;
    const A = rec.shapes;
    for (let j = 0; j < rec.shapeN; j++) {
      const q = j * SHAPE_STRIDE;
      let a = s - A[q];
      if (rec.closed && L > 0) a -= L * Math.round(a / L);
      const R = A[q + 10];
      if (a > R || a < -R) continue;
      const c = o - A[q + 1];
      if (c > R || c < -R) continue;
      const u = a * A[q + 2] + c * A[q + 3];
      const v = -a * A[q + 3] + c * A[q + 2];
      const hl = A[q + 4];
      const hw = A[q + 5];
      const h = A[q + 6];
      const soft = A[q + 7];
      const kind = A[q + 9];
      // Across: eased over `soft` inside the edge (`easedEdge`).
      const xv = hw - (v < 0 ? -v : v);
      if (!(xv > 0)) continue;
      let across = 1;
      if (soft > 0 && xv < soft) {
        const t = xv / soft;
        across = t * t * (3 - 2 * t);
      }
      if (kind === 2) {
        // A ramp: rising along its length to its lip, then a drop or a slope `back` long.
        const back = A[q + 8];
        if (u < -hl) continue;
        if (u <= hl) g += hl > 0 ? ((h * (u + hl)) / (2 * hl)) * across : 0;
        else if (back > 0 && u < hl + back) g += h * (1 - (u - hl) / back) * across;
      } else if (kind === 3) {
        // A trench: a rounded channel, deepest along its middle.
        const au = u < 0 ? -u : u;
        if (au >= hl) continue;
        const t = 1 - au / hl;
        g -= h * (t * t * (3 - 2 * t)) * across;
      } else {
        const xu = hl - (u < 0 ? -u : u);
        if (!(xu > 0)) continue;
        let along = 1;
        if (soft > 0 && xu < soft) {
          const t = xu / soft;
          along = t * t * (3 - 2 * t);
        }
        g += (kind === 0 ? -h : h) * along * across;
      }
    }
    const map = rec.brush;
    if (map) {
      // The brush lattice (2 m along the lattice the nodes anchor, linear in each edge's own arclength; 2 m across from the
      // spine), bilinear; a closed path's lattice taken round its period, its last partial span reaching back to cell 0.
      const lam = rec.lam;
      const m = ed.s[p.i] + (ed.s[p.i + 1] - ed.s[p.i]) * p.f;
      let lat = lam[e] + (lam[e + 1] - lam[e]) * (ed.len > 0 ? m / ed.len : 0);
      const LP = rec.lamP;
      if (rec.closed && LP > 0) lat -= LP * Math.floor(lat / LP);
      const fi = lat / BRUSH_CELL;
      const I0 = Math.floor(fi);
      let fu = fi - I0;
      let I1 = I0 + 1;
      if (rec.closed && LP > 0) {
        const N = Math.ceil(LP / BRUSH_CELL);
        if (I1 >= N) {
          I1 = 0;
          const span = LP - I0 * BRUSH_CELL;
          fu = span > 0 ? (lat - I0 * BRUSH_CELL) / span : 0;
        }
      }
      const fj = o / BRUSH_CELL;
      const J0 = Math.floor(fj);
      const fv = fj - J0;
      const R = this.gReg;
      this.cell(map, I0, J0);
      const c00 = R[0];
      this.cell(map, I1, J0);
      const c10 = R[0];
      this.cell(map, I0, J0 + 1);
      const c01 = R[0];
      this.cell(map, I1, J0 + 1);
      const c11 = R[0];
      if (c00 !== 0 || c10 !== 0 || c01 !== 0 || c11 !== 0) g += (c00 * (1 - fu) + c10 * fu) * (1 - fv) + (c01 * (1 - fu) + c11 * fu) * fv;
    }
    this.gOut = g;
  }

  /** A brush cell (along `I`, across `J`) of a path's chunks into `gReg[0]`: nought where no chunk holds it. */
  private cell(map: Map<number, BrushRec>, I: number, J: number): void {
    const k = Math.floor(I / BRUSH_ALONG);
    const b = map.get(k);
    if (!b) {
      this.gReg[0] = 0;
      return;
    }
    const j = J - b.a;
    this.gReg[0] = j < 0 || j >= b.n ? 0 : b.cells[(I - k * BRUSH_ALONG) * b.n + j];
  }

  /** The carve at a point of the raw frame over a raw height: `raw + (T - raw) W`, the surface itself at weight 1, raw at none. */
  carveAt(raw: number, x: number, z: number): number {
    this.qx = x;
    this.qz = z;
    this.qWiden = 0;
    this.qMode = 0;
    if (this.scan() === 0) return raw;
    this.choose();
    const W = this.outW;
    // The course's own ground over the carve (wave 3b), only where any is laid: else as before to the bit.
    const D = this.outD;
    const h = !(W > 0) ? raw : W >= 1 ? this.outT : raw + (this.outT - raw) * W;
    return D !== 0 ? h + D : h;
  }

  /** The target and weight at a point (`raw + (T - raw) W`), into `out`: what the pole grid keeps. */
  sampleAt(x: number, z: number, out: CarveSample): CarveSample {
    this.qx = x;
    this.qz = z;
    this.qWiden = 0;
    this.qMode = 0;
    if (this.scan() === 0) {
      out.T = 0;
      out.W = 0;
      out.D = 0;
      return out;
    }
    this.choose();
    out.T = this.outT;
    out.W = this.outW;
    out.D = this.outD;
    return out;
  }

  /**
   * A grid laid from raw (`ask`): every sample `out[k] = carve(raw[k])` (rounded into the float32 `out` once) where a road
   * reaches it, and `raw[k]` itself where none does. Answers whether any sample took the carve. Nothing made.
   */
  layIn(ask: CarveAsk): boolean {
    const raw = ask.raw;
    const out = ask.out;
    if (!raw || !out) return false;
    const nx = ask.nx;
    const nz = ask.nz;
    this.qWiden = ask.widen > 0 ? ask.widen : 0;
    this.qMode = 0;
    let moved = false;
    for (let j = 0; j < nz; j++) {
      this.qz = ask.z0 + j * ask.dz;
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        const k = row + i;
        this.qx = ask.x0 + i * ask.dx;
        if (this.scan() === 0) {
          out[k] = raw[k];
          continue;
        }
        this.choose();
        const W = this.outW;
        const D = this.outD;
        if (!(W > 0)) {
          // The course's own ground (wave 3b) where the carve takes nothing (a road that follows the ground): over raw.
          if (D !== 0) {
            out[k] = raw[k] + D;
            moved = true;
          } else out[k] = raw[k];
        } else {
          const h = W >= 1 ? this.outT : raw[k] + (this.outT - raw[k]) * W;
          out[k] = D !== 0 ? h + D : h;
          moved = true;
        }
      }
    }
    this.qWiden = 0;
    return moved;
  }

  /**
   * Whether a point of the raw frame lies on a drawn road: `what` 0 its road plus its track's `clear` (what plants, props
   * and life keep off), 1 its road alone on a course whose `grass` is `clear` (what the grass and the far cards keep off), 2
   * its road alone on any course (what the notes count standing on a road). Nothing made.
   */
  roadAt(x: number, z: number, what: number): boolean {
    this.qx = x;
    this.qz = z;
    this.qWiden = 0;
    this.qMode = 1;
    const n = this.scan();
    this.qMode = 0;
    for (let k = 0; k < n; k++) {
      const p = this.pool[k];
      const rec = p.rec!;
      if (what === 0) {
        if (p.d <= p.hw + rec.clear) return true;
      } else if (p.d <= p.hw && (what === 2 || rec.grassClear)) return true;
    }
    return false;
  }

  /** `deckOf`'s nearest leg found so far (a kept register, so a running best of fractions is never a boxed local). */
  private readonly legGap = new Float64Array(1);

  /**
   * The deck of the asked pass at the ask's place (§2.6, `ask.out`): its road surface where it is over a lower slot there and
   * the chosen ground stands more than its course's `level` under it, else -Infinity. With no pass asked (`edge` -1), any
   * pass's deck, the highest.
   *
   * With a pass asked, only the tracked leg may give a deck (§2.6 "for one named pass", §2.8 "a hull tracked on the lower road
   * never reads the upper road's deck"): of the asked path's passes at the place, the one whose place along the path is
   * nearest the tracked place (`ask.arc`, a closed path's gap folded by its length, as the tracker keeps a pass) is the leg.
   * One path crossing itself has both legs here, and filtered by track and path alone the lower leg read the upper leg's
   * deck: a pod on the lower road rose into a bridge standing on the upper. Chosen by place and never by edge, so a deck on
   * the next edge (the far ray's sample up to `rayReach` ahead, a footprint's corner across a node) is still the leg's.
   * A self-crossing loop shorter than about twice the far ray's reach could still take the other leg ahead. Nothing made.
   */
  deckOf(ask: DeckAsk): void {
    ask.out = -Infinity;
    this.qx = ask.x;
    this.qz = ask.z;
    this.qWiden = 0;
    this.qMode = 0;
    const n = this.scan();
    if (n < 2) return;
    this.choose();
    if (!(this.outW >= 1)) return;
    const ground = this.outT;
    let leg = -1;
    if (ask.edge >= 0) {
      const gap = this.legGap;
      gap[0] = Infinity;
      for (let k = 0; k < n; k++) {
        const p = this.pool[k];
        const rec = p.rec!;
        if (rec.track !== ask.track || rec.pathId !== ask.path) continue;
        const e = this.gIdx[p.g];
        const ed = rec.spine.edges[e];
        let d = rec.spine.start[e] + ed.s[p.i] + (ed.s[p.i + 1] - ed.s[p.i]) * p.f - ask.arc;
        if (d < 0) d = -d;
        const len = rec.spine.length;
        if (rec.closed && len > 0 && len - d < d) d = len - d;
        if (d < gap[0]) {
          gap[0] = d;
          leg = k;
        }
      }
      if (leg < 0) return;
    }
    for (let k = 0; k < n; k++) {
      if (leg >= 0 && k !== leg) continue;
      const p = this.pool[k];
      if (!p.road || !(p.over >= 0.5)) continue;
      const rec = p.rec!;
      if (!(p.T - ground > rec.level)) continue;
      if (p.T > ask.out) ask.out = p.T;
    }
  }

  /** The passes at a point, for the tracker (`courseTrack.ts`): how many, each read by `passAt`. Nothing made. */
  passesAt(x: number, z: number): number {
    this.qx = x;
    this.qz = z;
    this.qWiden = 0;
    this.qMode = 0;
    const n = this.scan();
    if (n) this.choose();
    return n;
  }

  /** One of the passes `passesAt` found. */
  passAt(k: number): CarvePass {
    return this.pool[k];
  }

  /** A pass's place along its path (m from node 0): its nearest point's arclength. */
  arcOf(p: CarvePass): number {
    const rec = p.rec!;
    const e = this.gIdx[p.g];
    const ed = rec.spine.edges[e];
    return rec.spine.start[e] + ed.s[p.i] + (ed.s[p.i + 1] - ed.s[p.i]) * p.f;
  }
  /** Its path's length, and whether it is closed (a circuit's main line wraps). */
  lengthOf(p: CarvePass): number {
    return p.rec!.spine.length;
  }
  closedOf(p: CarvePass): boolean {
    return p.rec!.closed;
  }

  /** A pass's path's ids (the tracker's keys). */
  static trackOf(p: CarvePass): string {
    return p.rec!.track;
  }
  static pathOf(p: CarvePass): string {
    return p.rec!.pathId;
  }

  /**
   * What decided a point, in words and numbers, for the console (`course({ at })`): every pass with its surface, weight,
   * share and what the rules did to it, the target and the weight. Allocates (never a frame's).
   */
  explain(x: number, z: number): { passes: Record<string, unknown>[]; T: number; W: number; rule: string; deck: number; ground?: number } {
    this.qx = x;
    this.qz = z;
    this.qWiden = 0;
    this.qMode = 0;
    const n = this.scan();
    if (!n) return { passes: [], T: 0, W: 0, rule: 'no road reaches here', deck: -Infinity };
    this.choose();
    let sum = 0;
    for (let k = 0; k < n; k++) sum += this.pool[k].we ** 4;
    const passes: Record<string, unknown>[] = [];
    let rule = 'blend';
    for (let k = 0; k < n; k++) {
      const p = this.pool[k];
      const rec = p.rec!;
      if (p.over > 0) rule = 'lower road wins';
      else if (p.drop > 0 && rule === 'blend') rule = 'abutment';
      passes.push({ track: rec.track, path: rec.pathId, edge: this.gIdx[p.g], offset: +p.o.toFixed(3), surface: +p.T.toFixed(3), weight: +p.w.toFixed(4), cuts: +p.k.toFixed(3), share: sum > 0 ? +((p.we ** 4) / sum).toFixed(4) : 0, road: p.road, slot: p.slot, over: +p.over.toFixed(3), joined: +p.join.toFixed(3), dropped: +p.drop.toFixed(3) });
    }
    const T = this.outT;
    const W = this.outW;
    const D = this.outD;
    const a = deckAsk();
    a.x = x;
    a.z = z;
    this.deckOf(a);
    return { passes, T, W, rule, deck: a.out, ground: D };
  }

  /**
   * Each road plus its track's `clear` cut into pieces of `CARVE_PIECE` metres of spine, each an outline (its left edge
   * forward, its right edge back) in the raw frame: the no-spawn zones (§2.7). A change's work.
   */
  outlines(): { id: string; pts: [number, number][] }[] {
    const out: { id: string; pts: [number, number][] }[] = [];
    // A unit chord of an edge (segment h to h + 1), into `c`.
    const c = { x: 0.5, z: 0.5 };
    const chordOf = (ed: SpineEdge, h: number): void => {
      const dx = ed.x[h + 1] - ed.x[h];
      const dz = ed.z[h + 1] - ed.z[h];
      const l = Math.sqrt(dx * dx + dz * dz);
      c.x = l > 0 ? dx / l : 0;
      c.z = l > 0 ? dz / l : 0;
    };
    for (const rec of this.recs) {
      const sp = rec.spine;
      const n = sp.edges.length;
      /** The way along the road at a sample: the mean of the chords either side (the neighbouring edge's at a node). */
      const wayAt = (e: number, i: number, way: { x: number; z: number; turn: number }): void => {
        const ed = sp.edges[e];
        let px = 0;
        let pz = 0;
        let has = false;
        if (i > 0) {
          chordOf(ed, i - 1);
          has = true;
        } else if (e > 0 || rec.closed) {
          const pe = sp.edges[e > 0 ? e - 1 : n - 1];
          chordOf(pe, pe.count - 2);
          has = true;
        }
        if (has) {
          px = c.x;
          pz = c.z;
        }
        let nx = 0;
        let nz = 0;
        let hasN = false;
        if (i < ed.count - 1) {
          chordOf(ed, i);
          hasN = true;
        } else if (e < n - 1 || rec.closed) {
          chordOf(sp.edges[e < n - 1 ? e + 1 : 0], 0);
          hasN = true;
        }
        if (hasN) {
          nx = c.x;
          nz = c.z;
        }
        const sx = px + nx;
        const sz = pz + nz;
        const l = Math.sqrt(sx * sx + sz * sz);
        way.x = l > 0 ? sx / l : nx || px;
        way.z = l > 0 ? sz / l : nz || pz;
        way.turn = has && hasN ? px * nx + pz * nz : 1;
      };
      const way = { x: 0.5, z: 0.5, turn: 0.5 };
      let piece = 0;
      for (let e = 0; e < n; e++) {
        const ed = sp.edges[e];
        const per = Math.max(1, Math.ceil(ed.len / CARVE_PIECE));
        const step = (ed.count - 1) / per;
        for (let q = 0; q < per; q++) {
          const a = Math.floor(q * step);
          const b = q === per - 1 ? ed.count - 1 : Math.floor((q + 1) * step);
          const left: [number, number][] = [];
          const right: [number, number][] = [];
          for (let i = a; i <= b; i++) {
            // The mean of the chords either side of the sample (across a node, the next edge's), so two pieces meeting at a
            // sample or a node offset it to the very same points and leave no wedge between them.
            wayAt(e, i, way);
            const rx = way.z;
            const rz = -way.x;
            const r = ed.hw[i] + rec.clear;
            left.push([ed.x[i] - rx * r, ed.z[i] - rz * r]);
            right.push([ed.x[i] + rx * r, ed.z[i] + rz * r]);
          }
          right.reverse();
          if (left.length + right.length < 3) continue;
          out.push({ id: `course:${rec.track}:${rec.pathId}:${piece++}`, pts: [...left, ...right] });
        }
        // A node where the road turns sharply (two straights meeting): a disc about it, the road's own round join.
        wayAt(e, ed.count - 1, way);
        if (way.turn < CAP_TURN && (e < n - 1 || rec.closed)) out.push({ id: `course:${rec.track}:${rec.pathId}:join${e}`, pts: discOf(ed.x[ed.count - 1], ed.z[ed.count - 1], ed.hw[ed.count - 1] + rec.clear, 1, 0, CAP_STEPS * 2, 2) });
      }
      // An open end's round cap (the road's own, `scan`): a half disc past the end node at the road plus its clear. A joined
      // end and a circuit's main line have none.
      if (!rec.closed && n) {
        if (!rec.joinStart) {
          const ed = sp.edges[0];
          chordOf(ed, 0);
          out.push({ id: `course:${rec.track}:${rec.pathId}:start`, pts: discOf(ed.x[0], ed.z[0], ed.hw[0] + rec.clear, -c.x, -c.z, CAP_STEPS, 1) });
        }
        if (!rec.joinEnd) {
          const ed = sp.edges[n - 1];
          chordOf(ed, ed.count - 2);
          const k = ed.count - 1;
          out.push({ id: `course:${rec.track}:${rec.pathId}:end`, pts: discOf(ed.x[k], ed.z[k], ed.hw[k] + rec.clear, c.x, c.z, CAP_STEPS, 1) });
        }
      }
    }
    return out;
  }

  /** Whether a rectangle (raw frame) holds any sample of a spine at all (the notes' ask of what a stretch reaches). */
  extent(): CarveRect | null {
    return this.gCount ? { x0: this.ex0, z0: this.ez0, x1: this.ex1, z1: this.ez1 } : null;
  }
}

/** The carve's tiles on a world with no converted terrain: 64 m in the raw frame about (0, 0), aligned with the heights' tiles. */
export const GRID_TILE = 64;
export const GRID_POLE = 2;
const GRID_POLES = GRID_TILE / GRID_POLE;
const gridTileNumber = (tx: number, tz: number): number => (tx < -4095 || tx > 4095 || tz < -4095 || tz > 4095 ? -1 : (tx + 4096) * 8192 + (tz + 4096));

/** What `CourseGrid.carveIn` asks (the raw height, the place in the raw frame) and answers (`out`). */
export interface GridAsk {
  raw: number;
  x: number;
  z: number;
  out: number;
}
/** An ask, made once (its numbers fractions from the first, so their fields hold numbers of their own). */
export const gridAsk = (): GridAsk => ({ raw: 0.5, x: 0.5, z: 0.5, out: 0.5 });

/**
 * A world with no converted terrain has no block cache, so the carve is laid once into a pole grid (§2.4): two float32 a 2 m
 * pole, the target times the weight and the weight (`A`, `W`), so a point between poles reads `raw (1 - W) + A` bilinear,
 * what the 2 m mesh draws, and a pole exactly `raw (1 - W) + A`. Made for every tile a road's reach meets when the course is
 * installed and again for the changed tiles when it moves, a budget at a time (`step`).
 */
export class CourseGrid {
  readonly carve: CourseCarve;
  private readonly tiles = new Map<number, Float32Array>();
  /** Tiles waiting to be made again, by number, and their places. */
  private readonly waiting = new Map<number, number>();
  private readonly sample: CarveSample = { T: 0.5, W: 0.5, D: 0.5 };
  private ext0 = Infinity;
  private ext1 = -Infinity;
  private ezt0 = Infinity;
  private ezt1 = -Infinity;

  constructor(carve: CourseCarve) {
    this.carve = carve;
  }

  /** How many tiles it holds and how many wait. */
  get size(): number {
    return this.tiles.size;
  }
  get pending(): number {
    return this.waiting.size;
  }

  /** Every tile a road's reach meets put on the waiting list (an install), and every tile no longer met let go. */
  all(): void {
    const want = new Set<number>();
    for (const [cx, cz] of this.carve.cells()) {
      const tx = Math.floor((cx * 16) / GRID_TILE);
      const tz = Math.floor((cz * 16) / GRID_TILE);
      const n = gridTileNumber(tx, tz);
      if (n >= 0) want.add(n);
    }
    for (const n of this.tiles.keys()) if (!want.has(n)) this.tiles.delete(n);
    for (const n of want) this.waiting.set(n, n);
    this.extent();
  }

  /** The tiles under rectangles of the raw frame put on the waiting list (a change). */
  later(rects: readonly CarveRect[], n: number): void {
    for (let k = 0; k < n; k++) {
      const r = rects[k];
      for (let tz = Math.floor(r.z0 / GRID_TILE); tz <= Math.floor(r.z1 / GRID_TILE); tz++) for (let tx = Math.floor(r.x0 / GRID_TILE); tx <= Math.floor(r.x1 / GRID_TILE); tx++) {
        const t = gridTileNumber(tx, tz);
        if (t >= 0) this.waiting.set(t, t);
      }
    }
  }

  /** One tile made from the store now (or let go where no road reaches it). Answers whether it holds a tile there. */
  private make(n: number): boolean {
    const tx = Math.floor(n / 8192) - 4096;
    const tz = (n % 8192) - 4096;
    const x0 = tx * GRID_TILE;
    const z0 = tz * GRID_TILE;
    if (!this.carve.touches(x0 - GRID_POLE, z0 - GRID_POLE, x0 + GRID_TILE, z0 + GRID_TILE)) {
      this.tiles.delete(n);
      return false;
    }
    let t = this.tiles.get(n);
    if (!t) {
      t = new Float32Array(GRID_POLES * GRID_POLES * 2);
      this.tiles.set(n, t);
    }
    const s = this.sample;
    let any = false;
    for (let j = 0; j < GRID_POLES; j++) {
      for (let i = 0; i < GRID_POLES; i++) {
        this.carve.sampleAt(x0 + i * GRID_POLE, z0 + j * GRID_POLE, s);
        const k = (j * GRID_POLES + i) * 2;
        // The course's own ground (wave 3b) rides in `A`: a pole reads `raw (1 - W) + A`. Added only where any is laid.
        const a = s.W > 0 ? s.T * s.W : 0;
        t[k] = s.D !== 0 ? a + s.D : a;
        t[k + 1] = s.W;
        if (s.W > 0 || s.D !== 0) any = true;
      }
    }
    if (!any) {
      this.tiles.delete(n);
      return false;
    }
    return true;
  }

  /**
   * The waiting tiles made, nearest `(fx, fz)` (raw frame) first, until `budgetMs` of `now()` is spent (one at the least);
   * `done` told each tile's raw rectangle. Answers how many it made. Every tile at once with `budgetMs` Infinity.
   */
  step(budgetMs: number, fx: number, fz: number, now: () => number, done?: (x0: number, z0: number, x1: number, z1: number) => void): number {
    if (!this.waiting.size) return 0;
    const t0 = now();
    let made = 0;
    while (this.waiting.size) {
      let best = -1;
      let bd = Infinity;
      for (const n of this.waiting.keys()) {
        const tx = Math.floor(n / 8192) - 4096;
        const tz = (n % 8192) - 4096;
        const dx = (tx + 0.5) * GRID_TILE - fx;
        const dz = (tz + 0.5) * GRID_TILE - fz;
        const d = Number.isFinite(dx * dx + dz * dz) ? dx * dx + dz * dz : 0;
        if (d < bd || best < 0) {
          bd = d;
          best = n;
        }
      }
      this.waiting.delete(best);
      this.make(best);
      made++;
      const tx = Math.floor(best / 8192) - 4096;
      const tz = (best % 8192) - 4096;
      done?.(tx * GRID_TILE, tz * GRID_TILE, (tx + 1) * GRID_TILE, (tz + 1) * GRID_TILE);
      if (now() - t0 >= budgetMs) break;
    }
    this.extent();
    return made;
  }

  private extent(): void {
    this.ext0 = Infinity;
    this.ext1 = -Infinity;
    this.ezt0 = Infinity;
    this.ezt1 = -Infinity;
    for (const n of this.tiles.keys()) {
      const tx = Math.floor(n / 8192) - 4096;
      const tz = (n % 8192) - 4096;
      if (tx < this.ext0) this.ext0 = tx;
      if (tx > this.ext1) this.ext1 = tx;
      if (tz < this.ezt0) this.ezt0 = tz;
      if (tz > this.ezt1) this.ezt1 = tz;
    }
  }

  /** A pole's `A` and `W` (0, 0 off every tile), into the two kept numbers. */
  private aw = new Float64Array(2);
  private pole(px: number, pz: number): void {
    const tx = Math.floor(px / GRID_POLES);
    const tz = Math.floor(pz / GRID_POLES);
    const t = this.tiles.get(gridTileNumber(tx, tz));
    if (!t) {
      this.aw[0] = 0;
      this.aw[1] = 0;
      return;
    }
    const k = ((pz - tz * GRID_POLES) * GRID_POLES + (px - tx * GRID_POLES)) * 2;
    this.aw[0] = t[k];
    this.aw[1] = t[k + 1];
  }

  /** `carveAt`'s own kept ask. */
  private readonly ask: GridAsk = gridAsk();

  /**
   * The carve over a raw height at a point of the raw frame: `raw (1 - W) + A`, bilinear over the four poles round it (on a
   * pole, its own exactly); `raw` itself off every tile. Nothing made but the answer handed back (`carveIn` makes none).
   */
  carveAt(raw: number, x: number, z: number): number {
    const q = this.ask;
    q.raw = raw;
    q.x = x;
    q.z = z;
    this.carveIn(q);
    return q.out;
  }

  /** `carveAt` with its numbers in a kept record (`q.raw`, `q.x`, `q.z` in, `q.out` out), for a caller whose every number stays off a call. */
  carveIn(q: GridAsk): void {
    const raw = q.raw;
    q.out = raw;
    if (!this.tiles.size) return;
    const fx = q.x / GRID_POLE;
    const fz = q.z / GRID_POLE;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const ti = Math.floor(i / GRID_POLES);
    const tj = Math.floor(j / GRID_POLES);
    if (ti + 1 < this.ext0 || ti > this.ext1 || tj + 1 < this.ezt0 || tj > this.ezt1) return;
    const u = fx - i;
    const v = fz - j;
    this.pole(i, j);
    const a00 = this.aw[0];
    const w00 = this.aw[1];
    // `A` alone where the road follows the ground and carries ground of its own (wave 3b: `W` nought, `A` the ground).
    if (u === 0 && v === 0) {
      if (w00 > 0 || a00 !== 0) q.out = raw * (1 - w00) + a00;
      return;
    }
    this.pole(i + 1, j);
    const a10 = this.aw[0];
    const w10 = this.aw[1];
    this.pole(i, j + 1);
    const a01 = this.aw[0];
    const w01 = this.aw[1];
    this.pole(i + 1, j + 1);
    const a11 = this.aw[0];
    const w11 = this.aw[1];
    if (w00 === 0 && w10 === 0 && w01 === 0 && w11 === 0 && a00 === 0 && a10 === 0 && a01 === 0 && a11 === 0) return;
    const W = (w00 * (1 - u) + w10 * u) * (1 - v) + (w01 * (1 - u) + w11 * u) * v;
    const A = (a00 * (1 - u) + a10 * u) * (1 - v) + (a01 * (1 - u) + a11 * u) * v;
    q.out = raw * (1 - W) + A;
  }

  /** Every tile let go. */
  clear(): void {
    this.tiles.clear();
    this.waiting.clear();
    this.extent();
  }
}
