// The world editor's clipboard (DESIGN.md §2.6): rows relative to the selection's pivot, kept in memory and written to the
// system clipboard as JSON, so a set pastes into another world, another tab or a text file.
//
// What it holds is **ids of models, turns, scales, looks and attachments, never game content**: each row as a row writes
// itself, less its id, its `at` and its `ground` (a paste is a new row, stamped when it is written and judged on the
// ground it stands on then), with its place and its turn in the game's frame **relative to the pivot** (`x`, `y`, `z` and
// `q` as a row holds them, so the JSON carries no field a row does not have; the header says the frame). A paste stands
// the set at the aim's hit keeping each row's own turn, or with Shift turned to face the camera as a whole.
//
// **A paste reads the document's own `paste` event** (`clipboardData`, which needs no permission): its text when it is
// the editor's JSON, else the set kept in memory. Never `navigator.clipboard.readText`, which Chrome puts behind a
// permission prompt even on localhost.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

import { readPlacementRow, type PlacementRow } from '../story/placements.ts';

/** What the clipboard's JSON says it is. */
export const CLIP_KIND = 'swg3js-editor-rows';
export const CLIP_VERSION = 1;

/** A row as the clipboard holds it: a row's own fields less its id, its `at` and its `ground`, its place and turn relative to the pivot in the game's frame. */
export type ClipRow = Omit<PlacementRow, 'id' | 'at' | 'ground'>;

/** The clipboard: a set of rows about a pivot. */
export interface ClipSet {
  kind: typeof CLIP_KIND;
  version: number;
  /** The frame its places and turns are in: always the game's, relative to the pivot. */
  frame: 'pivot-game';
  /** Where it was copied from, for words only. */
  world: string;
  rows: ClipRow[];
}

/** A row's place in the game's frame and its turn (three's order), beside the row: what a copy takes it from. */
export interface PlacedRow {
  row: PlacementRow;
  x: number;
  y: number;
  z: number;
  /** Three's order `[x, y, z, w]`, the game's frame. */
  q: readonly [number, number, number, number];
}

/**
 * Rows copied relative to `pivot`, each a row's own fields less id, `at` and `ground`, its place and turn the game's (`q`
 * as a row holds it, `[w, x, y, z]`). **A world model names the world it comes from**: a row of the copying world's own
 * pack carries no `from` in its file, so the copy is given `from: world`, or pasted into another world it would be looked
 * for in that world's pack (missing there, or another model of the same id).
 */
export function copyRows(rows: readonly PlacedRow[], pivot: { x: number; y: number; z: number }, world: string): ClipSet {
  const out: ClipRow[] = [];
  for (const p of rows) {
    const { id: _id, at: _at, ground: _ground, ...rest } = p.row;
    const row: ClipRow = { ...rest, x: round(p.x - pivot.x), y: round(p.y - pivot.y), z: round(p.z - pivot.z), q: [p.q[3], p.q[0], p.q[1], p.q[2]] };
    if (row.pack === 'world' && !row.from && world) row.from = world;
    out.push(row);
  }
  return { kind: CLIP_KIND, version: CLIP_VERSION, frame: 'pivot-game', world, rows: out };
}

/**
 * One clipboard row as it is written into the world `here`: a world model's `from` is the world it comes from (its own,
 * else the set's for a clipboard copied before rows named it), written absent where that is `here`, as a row of a world's
 * own pack is written. Every other field as copied. A new object; the clipboard's row is left as it is.
 */
export function pastedRow(row: ClipRow, setWorld: string, here: string): ClipRow {
  const out: ClipRow = { ...row };
  if (out.pack !== 'world') return out;
  const from = out.from ?? (setWorld || undefined);
  if (!from || from === here) delete out.from;
  else out.from = from;
  return out;
}

/** A number to the tenth of a millimetre, so a copied set's JSON reads. */
function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/** The clipboard's JSON text. */
export function clipText(set: ClipSet): string {
  return JSON.stringify(set);
}

/**
 * The editor's clipboard read out of a text, or null for any other text (a paste of words into the window, an image's
 * name): the header must say it is the editor's, and every row must read as a row does (each checked by the shipped
 * reader, under a stand-in id), or none is taken.
 */
export function readClip(text: string): ClipSet | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== CLIP_KIND || o.version !== CLIP_VERSION || o.frame !== 'pivot-game' || !Array.isArray(o.rows) || !o.rows.length) return null;
  const rows: ClipRow[] = [];
  for (const r of o.rows) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const unknown: string[] = [];
    // The place is relative, so any number reads; the reader's own reach is no rule here.
    const read = readPlacementRow({ ...(r as Record<string, unknown>), id: 'clip', x: 0, y: 0, z: 0 }, unknown);
    if (typeof read === 'string' || unknown.length) return null;
    const rr = r as Record<string, unknown>;
    if (typeof rr.x !== 'number' || typeof rr.y !== 'number' || typeof rr.z !== 'number' || !Number.isFinite(rr.x + rr.y + rr.z)) return null;
    const { id: _id, at: _at, ground: _ground, ...rest } = read;
    rows.push({ ...rest, x: rr.x, y: rr.y, z: rr.z });
  }
  return { kind: CLIP_KIND, version: CLIP_VERSION, frame: 'pivot-game', world: typeof o.world === 'string' ? o.world : '', rows };
}

/** Which set a paste takes: the event's text when it is the editor's JSON, else the one kept in memory (null for none). */
export function pasteSource(eventText: string | null | undefined, memory: ClipSet | null): ClipSet | null {
  if (eventText) {
    const read = readClip(eventText);
    if (read) return read;
  }
  return memory;
}

/** One pasted row's place and turn in the game's frame, before it is written into the file's. */
export interface PastedPlace {
  row: ClipRow;
  x: number;
  y: number;
  z: number;
  /** Three's order. */
  q: [number, number, number, number];
}

/**
 * A set stood at a point of the game's frame (the aim's hit): each row at its place about the pivot, its own turn kept;
 * with `turn` (radians about up, Shift's turn to the camera) the whole set turned about the pivot by it.
 */
export function pasteAt(set: ClipSet, at: { x: number; y: number; z: number }, turn = 0): PastedPlace[] {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const hw = Math.cos(turn / 2);
  const hy = Math.sin(turn / 2);
  const out: PastedPlace[] = [];
  for (const r of set.rows) {
    // The offset turned about up by `turn` (three's sense: x' = x cos + z sin, z' = -x sin + z cos).
    const ox = r.x * c + r.z * s;
    const oz = -r.x * s + r.z * c;
    const [w, x, y, z] = r.q;
    // The set's turn about up laid over the row's own, in the world's frame (r * q).
    const qx = hw * x + hy * z;
    const qy = hw * y + hy * w;
    const qz = hw * z - hy * x;
    const qw = hw * w - hy * y;
    out.push({ row: r, x: at.x + ox, y: at.y + r.y, z: at.z + oz, q: [qx, qy, qz, qw] });
  }
  return out;
}
