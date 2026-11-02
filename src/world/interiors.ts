// The client's own furniture in its buildings' rooms, as the game stands it.
//
// The client dressed a building's rooms from the interior layout file its template names (`interiorlayout/*.ilf`): the
// Mos Eisley cantina's seats, tables, glasses and the band's instruments, Jabba's palace, the starports' chairs and couches,
// the guild halls' desks. No server ever sent them, and no snapshot holds them. The converter's `interiors` pass
// (`tools/swg/ilf.mjs`) writes, beside each pack's manifest, the pieces each building template's file stands -- keyed by
// that template, each piece its template, its model (the pack's own, else the props catalogue's), its room by index and its
// place and turn in the building's frame -- and which of the world's own buildings carry one, with the pieces left out of
// each as standing where the world's own data stands the same thing (`skip`) or standing only in the state where that copy
// does not (`states`, SOE's earlier objects).
//
// They are stood through the very path a building's own contained furniture takes: appended after every object of the
// world's layout as contained objects naming their building's row and room (`furnishLayout`), so no index of the layout
// moves, the streamer files and hosts them as it files the snapshot's own (`furnitureHost.ts`), instances them by model
// within their tier, draws them with their building's rooms, collides them by the indoor rule and lets a dormant building
// take its furniture with it (`fileByState`). A pack with no file stands exactly what it stood.
//
// A building the world editor puts down (a permanent row) is furnished by its template from the table of the pack its model
// comes from (`piecesInGame`), unless its row says `furnish: false`.
//
// Pure: no three, no fetch, no DOM. Rule for this file (node runs it with type stripping for the tests): every import with
// its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import type { LayoutObject, PackModelDef } from './assetPack.ts';
import type { DressingStand } from './permanent.ts';
import { fromGame, type PlacementFrame, type PlacementRow } from '../story/placements.ts';
import { rowFromEditor } from './permanentEdit.ts';
import { isSeat, isTableTemplate } from './rowSolid.ts';

/**
 * Whether a piece stands solid, three ways as a placement's: never a seat or a table (the person the data seats there is a
 * dynamic body a collider under them pushes off, the permanent rows' and the seats of ours' rule, `rowSolid.ts`), else
 * absent, which the radius below makes solid and the owner's walk-through file can still overrule (`collidesByRule`).
 */
export function pieceSolid(template: string): false | undefined {
  return isSeat(template) || isTableTemplate(template) ? false : undefined;
}

/** The shape of `interiors.json` this reads: the converter's `INTERIORS_PACK_VERSION` (`tools/swg/ilf.mjs`), which a test holds equal. */
export const INTERIORS_PACK_VERSION = 1;

/**
 * One piece of a template's file, as the pack writes it: its index in the file, its template, its model, where its model is
 * (`own` the pack's, `props` the props folder's, `snd` a sound object: no model, the sounds pass's), its room's index in the
 * building, its place in the building's frame (the client's, X unmirrored) and its turn `[w, x, y, z]`.
 */
export type InteriorPiece = [number, string, string, 'own' | 'props' | 'snd', number, number, number, number, number, number, number, number];

/** One template's file, as the pack writes it: the file, its building's model, and its pieces. */
export interface InteriorTemplate {
  file: string;
  model: string;
  pieces: InteriorPiece[];
}

/** One of the world's own buildings that names a file: its layout row, its key, its template, and its pieces' exceptions. */
export interface InteriorBuilding {
  row: number;
  key: string;
  template: string;
  /** Pieces (by their index in the file) standing where the world's own data stands the same thing: never stood. */
  skip?: number[];
  /** Pieces (by index) standing only in one state, where the world's own copy of them does not (`<key>=<value>`). */
  states?: Record<string, string>;
  /** Its own state, where it stands in one only. */
  state?: string;
}

export interface InteriorsFile {
  version: number;
  planet?: string;
  templates: Record<string, InteriorTemplate>;
  buildings: InteriorBuilding[];
  /** The props folder's defs the pieces name (models, and the effects the files stand), for the guest pack they stand out of. */
  defs: PackModelDef[];
  counts?: Record<string, number>;
}

/** Whether a parsed `interiors.json` is one this build reads. */
export function interiorsReadable(v: unknown): v is InteriorsFile {
  if (!v || typeof v !== 'object') return false;
  const f = v as Partial<InteriorsFile>;
  return f.version === INTERIORS_PACK_VERSION && !!f.templates && typeof f.templates === 'object' && Array.isArray(f.buildings) && Array.isArray(f.defs);
}

/**
 * The radius a piece is filed with: the snapshot's own least for a contained object (32, measured over every converted
 * world), so the collider sweep's size rule makes every piece solid as it makes the snapshot's own furniture (the owner's
 * ruling: furniture solid), the walk-through file still winning per template (`collidesByRule`). Its tier is its model's
 * own size, as every object's is (`modelTier`), so this is no load distance.
 */
export const FURNITURE_RADIUS = 32;

/** `[w, x, y, z]` turning `v`. */
function turn(q: readonly number[], v: readonly number[]): [number, number, number] {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** `a * b`, both `[w, x, y, z]`. */
function mul(a: readonly number[], b: readonly number[]): [number, number, number, number] {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw];
}

/** A layout object of the world's own buildings' furniture: the layout's own fields, and the piece's key (`ilf`). */
export interface FurnitureObject extends LayoutObject {
  /** The piece's key: its building's (`InteriorBuilding.key`), a slash and its index in the file. */
  ilf: string;
  /**
   * Its building's index in the layout, on every piece (one in no room carries no `in`): what a removal of the building takes
   * it away by (`compileRemovals`, Map-maker II's twelfth wave). Read by nothing else; the streamer never copies it.
   */
  ilfRow: number;
}

/** What `furnishLayout` came to: the objects to append, and what of the file it could not stand, by why. */
export interface Furnished {
  objects: FurnitureObject[];
  /** Buildings whose row the layout does not hold as the file says (a pack converted again since): every piece of it left out. */
  moved: number;
  /** Pieces left out as standing twice (`skip`). */
  twice: number;
  /** Sound objects: the placed sounds' (`sounds.json`), never stood as things. */
  sounds: number;
}

/**
 * The world's own buildings' furniture, as layout objects to append after every object of the layout (`objects`, the
 * layout's own list, which is read and never written): each piece of each building's file not left out, at its building's
 * place and turn carrying its own (the snapshot's frame, as the layout writes an object: the streamer mirrors it with the
 * rest), contained in its building's row and room, in its building's state or the state the file gives it, under its key.
 * A building whose row no longer holds its template (the layout converted again after the file) stands none.
 */
export function furnishLayout(objects: readonly LayoutObject[], file: InteriorsFile): Furnished {
  const out: FurnitureObject[] = [];
  let moved = 0;
  let twice = 0;
  let sounds = 0;
  for (const b of file.buildings) {
    const o = objects[b.row];
    const t = file.templates[b.template];
    if (!o || !t || o.template !== b.template || o.contained) {
      moved++;
      continue;
    }
    const skip = b.skip?.length ? new Set(b.skip) : null;
    for (const p of t.pieces) {
      if (skip?.has(p[0])) {
        twice++;
        continue;
      }
      if (p[3] === 'snd') {
        sounds++;
        continue;
      }
      const at = turn(o.q, [p[5], p[6], p[7]]);
      const q = mul(o.q, [p[8], p[9], p[10], p[11]]);
      const state = b.states?.[String(p[0])] ?? b.state ?? o.state;
      const piece: FurnitureObject = { template: p[1], model: p[2], x: o.x + at[0], y: o.y + at[1], z: o.z + at[2], q, radius: FURNITURE_RADIUS, contained: p[4] > 0, ilf: `${b.key}/${p[0]}`, ilfRow: b.row };
      if (p[4] > 0) {
        piece.cell = p[4];
        piece.in = b.row;
      }
      if (state) piece.state = state;
      if (pieceSolid(p[1]) === false) piece.solid = false;
      out.push(piece);
    }
  }
  return { objects: out, moved, twice, sounds };
}

/** One piece of a permanent building's furniture in the game's frame (`piecesInGame`): what it is, where, and its room. */
export interface GamePiece {
  index: number;
  template: string;
  model: string;
  from: 'own' | 'props';
  cell: number;
  x: number;
  y: number;
  z: number;
  /** Three's order, `[x, y, z, w]`. */
  q: [number, number, number, number];
}

/**
 * The pieces of a template's file in the game's frame, for a building standing at `at` with three's turn `q` (`[x, y, z,
 * w]`, the game's frame, as a permanent row stands): each piece's place in the building's frame mirrored into the game's
 * (X across, the turn's y and z with it: the very mirror the layout's objects take, `(x, -y, -z, w)`) and carried by the
 * building's place and turn. Sound objects are left out (no model; the placed sounds are the world's own buildings').
 */
export function piecesInGame(t: InteriorTemplate, at: { x: number; y: number; z: number }, q: readonly [number, number, number, number]): GamePiece[] {
  const out: GamePiece[] = [];
  const bq: [number, number, number, number] = [q[3], q[0], q[1], q[2]];
  for (const p of t.pieces) {
    if (p[3] === 'snd') continue;
    const local = turn(bq, [-p[5], p[6], p[7]]);
    const pq = mul(bq, [p[8], p[9], -p[10], -p[11]]);
    out.push({ index: p[0], template: p[1], model: p[2], from: p[3], cell: p[4], x: at.x + local[0], y: at.y + local[1], z: at.z + local[2], q: [pq[1], pq[2], pq[3], pq[0]] });
  }
  return out;
}

/** A template's table in a file, by the template as a row names it (`shared_` or not, any case): null for none. */
export function templateEntry(file: InteriorsFile | null | undefined, template: string | undefined): InteriorTemplate | null {
  if (!file || !template) return null;
  const direct = file.templates[template];
  if (direct) return direct;
  const want = sameName(template);
  for (const [k, t] of Object.entries(file.templates)) if (sameName(k) === want) return t;
  return null;
}

/** A template as a name to compare: lower case, forward slashes, the client's `shared_` taken off its file's name. */
function sameName(t: string): string {
  return t.replace(/\\/g, '/').toLowerCase().replace(/\/shared_([^/]+)$/, '/$1');
}

/**
 * The numbers a post standing inside a solid piece is moved clear by (`clearSpotNear`), every one ours (the client stood its
 * people by the server, which never met its furniture): live through `__debug.interiors({ tune })`.
 */
export const POST_CLEAR_TUNE = {
  /** Whether a post inside a solid piece is moved clear at all (off: every post stands where the data put it). */
  on: true,
  /** How far round a post a clear spot is looked for, metres, and the step of the rings it is looked for on. */
  reach: 4,
  step: 0.25,
  /** A body's own half-width (the player's 0.35): a clear spot keeps every solid piece this far off. */
  body: 0.35,
  /** A post whose feet stand within this of a piece's top stands on it, not in it (a stage, a dais). */
  top: 0.15,
  /** Pieces lower than this, or wider than `widest` across, are no place to be stuck in (a rug; a whole room's dressing). */
  least: 0.3,
  widest: 8,
};

/** A solid piece as a post's clearing reads it: its place, its turn (three's order) and its model's box in its own frame. */
export interface PieceBox {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  min: readonly number[];
  max: readonly number[];
}

/**
 * Whether a point of the game's frame stands inside a piece's box: carried into the box's own frame (its turn undone), within
 * its span across grown by `pad`, and between its bottom and its top less `top` (feet on its top stand on it). A box lower
 * than `least` or wider than `widest` across is never stood in. Either corner of the box may come first (the BOX lesson).
 */
export function insidePiece(b: PieceBox, x: number, y: number, z: number, pad: number, tune: typeof POST_CLEAR_TUNE = POST_CLEAR_TUNE): boolean {
  const x0 = Math.min(b.min[0], b.max[0]);
  const x1 = Math.max(b.min[0], b.max[0]);
  const y0 = Math.min(b.min[1], b.max[1]);
  const y1 = Math.max(b.min[1], b.max[1]);
  const z0 = Math.min(b.min[2], b.max[2]);
  const z1 = Math.max(b.min[2], b.max[2]);
  if (y1 - y0 < tune.least || Math.max(x1 - x0, z1 - z0) > tune.widest) return false;
  // The point less the piece's place, turned by the turn's conjugate.
  const px = x - b.x;
  const py = y - b.y;
  const pz = z - b.z;
  const qx = -b.qx;
  const qy = -b.qy;
  const qz = -b.qz;
  const qw = b.qw;
  const tx = 2 * (qy * pz - qz * py);
  const ty = 2 * (qz * px - qx * pz);
  const tz = 2 * (qx * py - qy * px);
  const lx = px + qw * tx + (qy * tz - qz * ty);
  const ly = py + qw * ty + (qz * tx - qx * tz);
  const lz = pz + qw * tz + (qx * ty - qy * tx);
  return lx >= x0 - pad && lx <= x1 + pad && lz >= z0 - pad && lz <= z1 + pad && ly >= y0 - 1e-3 && ly < y1 - tune.top;
}

/**
 * The nearest spot to a post clear of every box (each grown by the body's half-width) on the same room's floor (`floorAt`:
 * the floor's height at a point near the post's own, or null where the room has none there), looked for on rings `step`
 * apart out to `reach`, twelve points a metre of ring; null where none is found. The post itself is never answered: the
 * caller asks only of a post that stands inside one.
 */
export function clearSpotNear(post: { x: number; y: number; z: number }, boxes: readonly PieceBox[], floorAt: (x: number, y: number, z: number) => number | null, tune: typeof POST_CLEAR_TUNE = POST_CLEAR_TUNE): { x: number; y: number; z: number } | null {
  for (let r = tune.step; r <= tune.reach + 1e-9; r += tune.step) {
    const n = Math.max(8, Math.ceil(2 * Math.PI * r * 12));
    let best: { x: number; y: number; z: number } | null = null;
    let bestDy = Infinity;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = post.x + Math.cos(a) * r;
      const z = post.z + Math.sin(a) * r;
      const y = floorAt(x, post.y, z);
      if (y === null) continue;
      let clear = true;
      for (const b of boxes) {
        if (insidePiece(b, x, y, z, tune.body, tune)) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      // Of a ring's clear points, the one whose floor stands nearest the post's own height.
      const dy = Math.abs(y - post.y);
      if (dy < bestDy) {
        bestDy = dy;
        best = { x, y, z };
      }
    }
    if (best) return best;
  }
  return null;
}

/** The streamer key of one piece of a permanent building's furniture: its building's key, `.f` and its index in the file. */
export function pieceKeyOf(buildingKey: string, index: number): string {
  return `${buildingKey}.f${index}`;
}

/**
 * A piece's key taken apart (`<buildingKey>.f<index>`): its building's key and its index, or null for a key that is no piece's.
 * A row's id holds no `.` (`isPlacementId`), so no row's key is ever read as a piece's.
 */
export function pieceOfKey(key: string): { building: string; index: number } | null {
  const m = /^(.+)\.f(\d+)$/.exec(key);
  return m ? { building: m[1], index: Number(m[2]) } : null;
}

/**
 * How one piece of a permanent building's template furniture is stood (`App.furnishDressing`): under its own key
 * (`pieceKeyOf`), at its place and turn in the game's frame, in its building's rooms where its room is one, its client
 * data's effects by its own template, filed at the snapshot's own least radius for a contained thing so the size rule
 * makes it solid as the world's own furniture is, a seat or a table never (`pieceSolid`), and a model of the building's
 * own pack out of the world it names (`from`) where that pack is another world's.
 */
export function pieceStand(p: GamePiece, buildingKey: string, row: Pick<PlacementRow, 'pack' | 'from'>): DressingStand {
  return {
    key: pieceKeyOf(buildingKey, p.index),
    model: p.model,
    x: p.x,
    y: p.y,
    z: p.z,
    q: p.q,
    inside: p.cell > 0,
    effectsOf: p.template,
    radius: FURNITURE_RADIUS,
    ...(pieceSolid(p.template) === false ? { solid: false } : {}),
    ...(p.from === 'own' && row.from && row.pack === 'world' ? { from: row.from } : {}),
  };
}

/** One row a make-own writes (`pieceRow`): the base its id is minted from, the piece's index in the file and the row. */
export interface PieceRow {
  base: string;
  index: number;
  row: Omit<PlacementRow, 'id'>;
}

/**
 * One piece of a furnished building row's template furniture as an ordinary row of the building's own file (the world
 * editor's make-own, the owner's words of 2026-11-01: "if I edit the furniture in one place it won't affect other copies or
 * spawns of that same building"), standing in its room (`inside`) at its place and turn in the file's frame (`centre`,
 * `frame`), so `toGame` of the row is where the piece stood: a model of the building's own pack by its id and template (and
 * the world it comes from, on a world row naming one), never solid where it is a seat or a table, as it stood; an effect
 * of the props folder a mark carrying it (`props:<file>`); anything else the props catalogue's thing for its template
 * (`thingOf`). Or why not, in words.
 */
export function pieceRow(
  p: GamePiece,
  building: Pick<PlacementRow, 'pack' | 'from'>,
  ctx: { centre: { x: number; z: number } | null; frame: PlacementFrame; here: string; defOf: (model: string) => PackModelDef | null | undefined; thingOf: (template: string) => string | null | undefined },
): PieceRow | string {
  const at = { x: p.x, y: p.y, z: p.z };
  const turn: [number, number, number, number] = [p.q[0], p.q[1], p.q[2], p.q[3]];
  const opts = { here: ctx.here, mm: 0.001, turnDigits: 6 };
  if (p.from === 'own') {
    const src = { kind: 'prop' as const, pack: building.pack === 'gallery' ? ('gallery' as const) : ('world' as const), model: p.model, template: p.template, from: building.pack === 'world' ? (building.from ?? null) : null };
    const r = rowFromEditor(src, at, turn, true, ctx.centre, ctx.frame, opts) as Omit<PlacementRow, 'id'>;
    if (pieceSolid(p.template) === false) r.solid = false;
    return { base: p.model, index: p.index, row: r };
  }
  const def = ctx.defOf(p.model);
  if (def?.particle && def.file) {
    const g = fromGame({ x: p.x, y: p.y, z: p.z, q: turn }, ctx.centre, ctx.frame);
    const q = g.q.map((n) => Math.round(n * 1e6) / 1e6 || 0) as PlacementRow['q'];
    return { base: 'mark', index: p.index, row: { kind: 'mark', x: Math.round(g.x * 1000) / 1000, y: Math.round(g.y * 1000) / 1000, z: Math.round(g.z * 1000) / 1000, q, inside: true, attach: [{ fx: `props:${def.file}` }] } };
  }
  const thing = ctx.thingOf(p.template);
  if (!thing) return `the props catalogue has no thing for ${p.template}: convert the props again (\`props\`) and the furniture can be made its own`;
  const r = rowFromEditor({ kind: 'prop', pack: 'props', thing }, at, turn, true, ctx.centre, ctx.frame, opts) as Omit<PlacementRow, 'id'>;
  return { base: thing, index: p.index, row: r };
}

/** A permanent row as `carriedRowIds` reads it: its id, its file, its kind, whether it stands in a room and its place (the game's). */
export interface CarryRow {
  id: string;
  layer: string;
  kind: string;
  inside?: boolean;
  x: number;
  y: number;
  z: number;
}

/**
 * The rows a building row whose furniture is its own carries when the world editor moves, copies or takes it out (the
 * interior layout files' wave): every row of the building's own file (`layer`, never another's: a story prop the owner stood
 * in it stays the story's) that stands in a room, is no building, and whose place the building's rooms hold by the very rule
 * a thing put down there is hosted (`hostAt`, `LayoutStreamer.hostKeyAt`) -- a mark, which nothing files, as much as a
 * prop, and one in a doorway as much as one in the middle of a room. In the order `rows` gives them. Asked of an edit.
 */
export function carriedRowIds(building: { id: string; key: string; layer: string }, rows: Iterable<CarryRow>, hostAt: (x: number, y: number, z: number) => string | null): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.id === building.id || r.layer !== building.layer || r.kind === 'building' || !r.inside) continue;
    if (hostAt(r.x, r.y, r.z) === building.key) out.push(r.id);
  }
  return out;
}
