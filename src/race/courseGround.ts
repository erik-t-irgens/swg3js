// A drawn course's own ground (the race drawer's wave 3b, `A:\swg3js\racedrawer\DESIGN.md` §5b): shapes and brush strokes kept
// in the track and laid in the carve after the road's cut, in the road's own frame, so they bend and move with the road.
//
// **Shapes** (`course.ground`): a hole, a mound, a ramp (rising along its own length to a lip, its far side a drop or a slope
// `back` metres long) and a trench (a rounded channel across), each anchored to a path as a gate is (`path`, `e`, `t`: the
// edge's node and the share along it, so an insert or a delete remaps it and it keeps its place on the road), `off` metres to
// the driver's right of the spine, turned `turn` degrees off the road's way (toward the right), `l` long, `w` wide, `h` deep
// or high, its edges eased over `soft` metres by the spine's own smooth step.
//
// **The brush** (`course.brush`): the sculpt brush's "This track" strokes kept as deltas on a lattice along and across the
// road: a cell every `BRUSH_CELL` (2 m) of the path's own arclength from its node 0 and every 2 m across from the spine, in
// sparse chunks of `BRUSH_ALONG` (16) cells along (`BRUSH_CHUNK`, 32 m), each holding `n` cells across from cell `a`, written
// as the heights tiles are (little-endian float32, deflate-raw, base64). A chunk is read bilinear on the one lattice (a chunk
// missing reads nought), so two chunks side by side meet with no seam.
//
// **The lattice is anchored to the nodes** (the review round of wave 3b): the lattice's coordinate (m) at each node is the
// node's `bs` (and a closed path's period its `bl`), written on every node of a path once its first stroke is written, and
// linear in each edge's own arclength between two nodes; with none (a path never stroked), each node's arclength from node 0
// to the millimetre (`brushLattice`). So a stroke is kept by its edge and its share of it, as a shape is: a node moved
// stretches the cells on its two edges with them, a node put in takes its lattice coordinate where it stands, a node taken out
// joins its two edges' spans, and nothing elsewhere on the path moves.
//
// The deltas are inflated once, where the file is read (`primeBrush`, a browser's `DecompressionStream` or node's `zlib`), and
// kept by their text (`brushCells`), so the carve reads them synchronously; a chunk not yet inflated is laid as nothing.
//
// Pure: imports nothing. Rule for this file (node runs it with type stripping): no enum, no namespace, no constructor
// parameter properties.

/** What a shape is. */
export type GroundKind = 'hole' | 'mound' | 'ramp' | 'trench';
export const GROUND_KINDS: readonly GroundKind[] = ['hole', 'mound', 'ramp', 'trench'];

/** One shape of a course's own ground, in the road's frame (see the header). */
export interface GroundShape {
  kind: GroundKind;
  path: string;
  e: number;
  t: number;
  off: number;
  turn: number;
  l: number;
  w: number;
  h: number;
  soft: number;
  /** A ramp's far side: absent a drop, else a slope this many metres long behind the lip. */
  back?: number;
}

/** One chunk of a path's brush deltas (see the header). */
export interface BrushChunk {
  path: string;
  k: number;
  a: number;
  n: number;
  d: string;
}

/** The brush lattice's step (m), a chunk's cells along and its length (m). Constants: they change bits. */
export const BRUSH_CELL = 2;
export const BRUSH_ALONG = 16;
export const BRUSH_CHUNK = BRUSH_CELL * BRUSH_ALONG;

/** The reader's and the endpoint's limits for a course's own ground. Ours. */
export const GROUND_LIMITS = {
  shapes: 200,
  chunks: 4000,
  length: [0.5, 2000] as const,
  width: [0.5, 400] as const,
  height: [0, 200] as const,
  soft: [0, 200] as const,
  back: [0, 400] as const,
  off: 400,
  turn: 180,
  /** A brush cell's across index either way, and how many a chunk may hold. */
  across: 200,
  /** The most a brush delta may be either way (m): the heights' own backstop. */
  delta: 1000,
  /** A chunk's index along at the most (a path is at most 400 edges of 4 km). */
  k: 60000,
};

/** Base64's alphabet, padded. */
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const SHAPE_FIELDS = new Set(['kind', 'path', 'e', 't', 'off', 'turn', 'l', 'w', 'h', 'soft', 'back']);
const CHUNK_FIELDS = new Set(['path', 'k', 'a', 'n', 'd']);

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function within(v: unknown, lo: number, hi: number): number | undefined {
  const n = num(v);
  return n !== undefined && n >= lo && n <= hi ? n : undefined;
}

/** What the readers need of the course a field belongs to: each path's id and its edges' count. */
export interface GroundPaths {
  ids: readonly string[];
  edges: readonly number[];
}

/**
 * A course's shapes cleaned, or why refused (an empty list is none). Fields this build does not read go into `unknown` as
 * `<prefix>[<i>].<field>`.
 */
export function readGround(v: unknown, paths: GroundPaths, unknown: string[], prefix: string): GroundShape[] | string {
  if (!Array.isArray(v)) return "its course's ground is a list";
  const L = GROUND_LIMITS;
  if (v.length > L.shapes) return `its course's ground holds ${L.shapes} shapes at most`;
  const out: GroundShape[] = [];
  for (let i = 0; i < v.length; i++) {
    const o = v[i] as Record<string, unknown>;
    const what = `ground shape ${i}`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return `${what} is an object`;
    for (const k of Object.keys(o)) if (!SHAPE_FIELDS.has(k)) unknown.push(`${prefix}[${i}].${k}`);
    if (!GROUND_KINDS.includes(o.kind as GroundKind)) return `${what}'s kind is ${GROUND_KINDS.join(', ')}`;
    const p = paths.ids.indexOf(o.path as string);
    if (p < 0) return `${what} stands on ${String(o.path)}, which is no path of the course`;
    const e = o.e;
    if (typeof e !== 'number' || !Number.isInteger(e) || e < 0 || e >= paths.edges[p]) return `${what}'s e is a node of path ${paths.ids[p]} whose edge it stands on`;
    const t = within(o.t, 0, 1);
    const off = within(o.off, -L.off, L.off);
    const turn = within(o.turn, -L.turn, L.turn);
    const l = within(o.l, L.length[0], L.length[1]);
    const w = within(o.w, L.width[0], L.width[1]);
    const h = within(o.h, L.height[0], L.height[1]);
    const soft = within(o.soft, L.soft[0], L.soft[1]);
    if (t === undefined) return `${what}'s t is a share of its edge, 0 to 1`;
    if (off === undefined) return `${what}'s off is ${L.off} m either way at most`;
    if (turn === undefined) return `${what}'s turn is ${L.turn} degrees either way at most`;
    if (l === undefined || w === undefined) return `${what} is ${L.length[0]} to ${L.length[1]} m long and ${L.width[0]} to ${L.width[1]} m wide`;
    if (h === undefined) return `${what}'s h is ${L.height[0]} to ${L.height[1]} m`;
    if (soft === undefined) return `${what}'s soft is ${L.soft[0]} to ${L.soft[1]} m`;
    const s: GroundShape = { kind: o.kind as GroundKind, path: o.path as string, e, t, off, turn, l, w, h, soft };
    if (o.back !== undefined) {
      const b = within(o.back, L.back[0], L.back[1]);
      if (b === undefined) return `${what}'s back is ${L.back[0]} to ${L.back[1]} m`;
      if (b > 0) s.back = b;
    }
    out.push(s);
  }
  return out;
}

/** A course's brush chunks cleaned (their shape only: the deltas are inflated where the file is read), or why refused. */
export function readBrush(v: unknown, paths: GroundPaths, unknown: string[], prefix: string): BrushChunk[] | string {
  if (!Array.isArray(v)) return "its course's brush is a list";
  const L = GROUND_LIMITS;
  if (v.length > L.chunks) return `its course's brush holds ${L.chunks} chunks at most`;
  const out: BrushChunk[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < v.length; i++) {
    const o = v[i] as Record<string, unknown>;
    const what = `brush chunk ${i}`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return `${what} is an object`;
    for (const k of Object.keys(o)) if (!CHUNK_FIELDS.has(k)) unknown.push(`${prefix}[${i}].${k}`);
    if (!paths.ids.includes(o.path as string)) return `${what} lies on ${String(o.path)}, which is no path of the course`;
    const k = o.k;
    const a = o.a;
    const n = o.n;
    if (typeof k !== 'number' || !Number.isInteger(k) || k < 0 || k > L.k) return `${what}'s k is a chunk along the path, 0 to ${L.k}`;
    if (typeof a !== 'number' || !Number.isInteger(a) || typeof n !== 'number' || !Number.isInteger(n) || n < 1 || a < -L.across || a + n - 1 > L.across) return `${what}'s cells across are within ${L.across} either way`;
    if (typeof o.d !== 'string' || !o.d || !B64.test(o.d)) return `${what}'s deltas are not base64`;
    const key = `${o.path as string}\u0000${k}`;
    if (seen.has(key)) return `${what} is a second chunk ${k} of path ${o.path as string}`;
    seen.add(key);
    out.push({ path: o.path as string, k, a, n, d: o.d });
  }
  return out;
}

const SHAPE_ORDER: readonly (keyof GroundShape)[] = ['kind', 'path', 'e', 't', 'off', 'turn', 'l', 'w', 'h', 'soft', 'back'];

/** One shape a line (the writer's). */
export function shapeLine(s: GroundShape): string {
  return `{ ${SHAPE_ORDER.filter((k) => s[k] !== undefined).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(s[k])}`).join(', ')} }`;
}

/** One chunk a line (the writer's). */
export function chunkLine(c: BrushChunk): string {
  return `{ "path": ${JSON.stringify(c.path)}, "k": ${c.k}, "a": ${c.a}, "n": ${c.n}, "d": ${JSON.stringify(c.d)} }`;
}

// ---- The deltas, inflated once and kept by their text. ----

/** A chunk's deltas by their text, inflated (`primeBrush`) or put by the editor that made them (`keepBrushCells`). */
const CELLS = new Map<string, Float32Array>();
/** How many the keep holds at the most: past it, the oldest no held track names are let go (never one a track names). */
export const CELLS_MOST = 8192;
/** Each held track's chunk texts as its last prime named them, and how many tracks name each text: a named text is never let go. */
const NAMED = new Map<string, string[]>();
const NAMES = new Map<string, number>();

/** A chunk's deltas as the carve reads them, or null where they were never inflated. */
export function brushCells(d: string): Float32Array | null {
  return CELLS.get(d) ?? null;
}

/** A track's chunk texts named as held (its last prime's), the texts it named before no longer counted for it. */
function nameTrack(id: string, keys: string[]): void {
  for (const k of NAMED.get(id) ?? []) {
    const c = (NAMES.get(k) ?? 1) - 1;
    if (c > 0) NAMES.set(k, c);
    else NAMES.delete(k);
  }
  if (keys.length) NAMED.set(id, keys);
  else NAMED.delete(id);
  for (const k of keys) NAMES.set(k, (NAMES.get(k) ?? 0) + 1);
}

/** Whether a held track names a chunk's text (the review round: the keep never lets one go). */
export function brushNamed(d: string): boolean {
  return NAMES.has(d);
}

/**
 * A chunk's deltas kept under their text (the editor's own write, a test). Past `CELLS_MOST`, the oldest text no held track
 * names is let go: never one a track names, or a stroke over it would start the chunk from noughts and write them over it.
 */
export function keepBrushCells(d: string, cells: Float32Array): void {
  CELLS.delete(d);
  CELLS.set(d, cells);
  if (CELLS.size > CELLS_MOST) {
    for (const k of CELLS.keys()) {
      if (k === d || NAMES.has(k)) continue;
      CELLS.delete(k);
      break;
    }
  }
}

/** A chunk's deltas let go (a stroke's preview key once the next tick or the write has taken its place). */
export function dropBrushCells(d: string): void {
  CELLS.delete(d);
}

/** A chunk's inflated bytes as its deltas (exactly `16 n` finite float32 within the backstop), or why not. */
export function cellsOfBytes(bytes: Uint8Array | null, n: number): Float32Array | string {
  if (!bytes) return 'its deltas do not inflate';
  if (bytes.byteLength !== BRUSH_ALONG * n * 4) return `its deltas are ${bytes.byteLength} bytes, where ${BRUSH_ALONG} by ${n} cells are ${BRUSH_ALONG * n * 4}`;
  const copy = new Uint8Array(bytes);
  const d = new Float32Array(copy.buffer, 0, BRUSH_ALONG * n);
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i]) || Math.abs(d[i]) > GROUND_LIMITS.delta) return `a delta is not a number of metres within ${GROUND_LIMITS.delta} either way`;
  return new Float32Array(d);
}

/** A chunk's deltas as the bytes deflated (a nought always +0). */
export function cellBytes(d: Float32Array): Uint8Array {
  const c = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) c[i] = d[i] === 0 ? 0 : d[i];
  return new Uint8Array(c.buffer);
}

type PrimeTrack = { id: string; course?: { brush?: readonly BrushChunk[] } };

/**
 * Every brush chunk of the tracks inflated and kept, where it is not kept already: what a track file read is handed through
 * before anything carves it. Each track's texts are named as held (never let go while it names them); `whole` (a world's file
 * read whole: an arrival, the dev server's word) names these tracks alone, letting go every other track's names. Answers how
 * many were inflated and the chunks that would not be (by `<track>/<path>/<k>`).
 */
export async function primeBrush(tracks: readonly PrimeTrack[], inflate: (b64: string) => Promise<Uint8Array | null>, whole = false): Promise<{ inflated: number; failed: string[] }> {
  if (whole) for (const id of [...NAMED.keys()]) nameTrack(id, []);
  let inflated = 0;
  const failed: string[] = [];
  for (const t of tracks) {
    const keys: string[] = [];
    for (const c of t.course?.brush ?? []) {
      keys.push(c.d);
      const had = CELLS.get(c.d);
      if (had) {
        keepBrushCells(c.d, had);
        continue;
      }
      const cells = cellsOfBytes(await inflate(c.d), c.n);
      if (typeof cells === 'string') failed.push(`${t.id}/${c.path}/${c.k}: ${cells}`);
      else {
        keepBrushCells(c.d, cells);
        inflated++;
      }
    }
    nameTrack(t.id, keys);
  }
  return { inflated, failed };
}

/** `primeBrush` with an inflate that answers at once (node's `zlib`: the walk grid's bake, which is synchronous). */
export function primeBrushNow(tracks: readonly PrimeTrack[], inflate: (b64: string) => Uint8Array | null): { inflated: number; failed: string[] } {
  let inflated = 0;
  const failed: string[] = [];
  for (const t of tracks) {
    const keys: string[] = [];
    for (const c of t.course?.brush ?? []) {
      keys.push(c.d);
      const had = CELLS.get(c.d);
      if (had) {
        keepBrushCells(c.d, had);
        continue;
      }
      const cells = cellsOfBytes(inflate(c.d), c.n);
      if (typeof cells === 'string') failed.push(`${t.id}/${c.path}/${c.k}: ${cells}`);
      else {
        keepBrushCells(c.d, cells);
        inflated++;
      }
    }
    nameTrack(t.id, keys);
  }
  return { inflated, failed };
}

// ---- The lattice, anchored to the nodes (the review round). ----

/** A lattice coordinate as a node's `bs` is written: to the millimetre (plus nought: never a negative nought). */
export const latticeRound = (v: number): number => Math.round(v * 1000) / 1000 + 0;

/**
 * A path's brush lattice into `out` (grown as it needs): the coordinate (m) at each node `0..E-1` and at the end of its last
 * edge (`E` the path's edge count; a closed path's end is node 0's coordinate one period `bl` on). From the nodes' own `bs`
 * where they carry it (all or none: the reader's rule), else each node's arclength along the spine to the millimetre, the
 * end the spine's length. `start` the spine's edges' starting arclengths, `length` its length.
 */
export function brushLattice(nodes: readonly { bs?: number }[], start: ArrayLike<number>, length: number, closed: boolean, bl: number | undefined, out?: Float64Array): Float64Array {
  const E = closed ? nodes.length : nodes.length - 1;
  const lam = out && out.length >= E + 1 ? out : new Float64Array(Math.max(1, E + 1));
  if (E < 1) {
    lam[0] = 0;
    return lam;
  }
  if (nodes[0].bs !== undefined) {
    for (let i = 0; i < nodes.length; i++) lam[i] = nodes[i].bs ?? 0;
    if (closed) lam[E] = lam[0] + (bl ?? 0);
  } else {
    for (let i = 0; i < E; i++) lam[i] = latticeRound(start[i]);
    lam[E] = latticeRound(length);
  }
  return lam;
}

/**
 * Where a lattice coordinate falls on a path, into `out`: the edge and the share of it (`lam` as `brushLattice` made it, `E`
 * its edge count). A closed path's coordinate is taken round its period into `[lam[0], lam[E])`; an open path's outside its
 * ends answers false.
 */
export function latticeEdge(lam: ArrayLike<number>, E: number, closed: boolean, v: number, out: { e: number; t: number }): boolean {
  if (E < 1) return false;
  let x = v;
  if (closed) {
    const P = lam[E] - lam[0];
    if (!(P > 0)) return false;
    x = lam[0] + ((((x - lam[0]) % P) + P) % P);
  } else if (x < lam[0] || x > lam[E]) return false;
  let lo = 0;
  let hi = E - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lam[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  const span = lam[lo + 1] - lam[lo];
  out.e = lo;
  out.t = span > 0 ? Math.max(0, Math.min(1, (x - lam[lo]) / span)) : 0;
  return true;
}

// ---- A shape's height, in its own frame. ----

/** The spine's smooth step over a share. */
export function smoothShare(q: number): number {
  const t = q <= 0 ? 0 : q >= 1 ? 1 : q;
  return t * t * (3 - 2 * t);
}

/** An edge eased over `soft` metres: 0 at and past the edge, 1 `soft` metres inside it. */
export function easedEdge(x: number, soft: number): number {
  if (!(x > 0)) return 0;
  if (!(soft > 0) || x >= soft) return 1;
  return smoothShare(x / soft);
}

/** A shape's kind as the carve keeps it. */
export const KIND_CODE: Record<GroundKind, number> = { hole: 0, mound: 1, ramp: 2, trench: 3 };

/**
 * A shape's height (m, up) at a point of its own frame (`u` along its length, `v` across), with half its length `hl`, half
 * its width `hw`, its `h`, `soft` and `back`: the one rule the carve lays (written out there, in line) and the tests hold.
 */
export function shapeHeight(kind: number, u: number, v: number, hl: number, hw: number, h: number, soft: number, back: number): number {
  const across = easedEdge(hw - Math.abs(v), soft);
  if (!(across > 0)) return 0;
  if (kind === 2) {
    if (u < -hl) return 0;
    if (u <= hl) return hl > 0 ? (h * (u + hl)) / (2 * hl) * across : 0;
    if (back > 0 && u < hl + back) return h * (1 - (u - hl) / back) * across;
    return 0;
  }
  if (kind === 3) {
    const au = Math.abs(u);
    return au >= hl ? 0 : -h * smoothShare(1 - au / hl) * across;
  }
  const along = easedEdge(hl - Math.abs(u), soft);
  return (kind === 0 ? -h : h) * along * across;
}

/** The numbers the carve keeps a shape by, a stride of them: its place along (filled by the carve), its off, turn's cos and sin, half length, half width, h, soft, back, kind and reach. */
export const SHAPE_STRIDE = 11;
