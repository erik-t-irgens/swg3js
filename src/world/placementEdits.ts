// The rules of the placement editor's one endpoint on the dev server (`POST /__dev/placements`): who may ask,
// and what one ask does to a world's two files of permanent placements (`src/story/placements.ts`). The glue
// that reads the request and writes the files is `tools/dev/placementsEndpoint.mjs`, which the dev server's
// config loads at the first ask and nothing else ever does; nothing here touches a file or a socket, so a
// node test runs every rule as it stands.
//
// **Who may ask.** Only a POST, from this very machine (the dev server listens on every interface), from the
// game's own page (its Origin is the Host it asked), carrying the editor's own header (which no form and no
// other site can send without a preflight the dev server never answers), with a JSON body under the cap.
//
// **What an ask does.** One row at a time, never a whole file: the file is read as it stands, the one row put,
// taken out, moved to the other layer or renamed by its id, and the file written back, so a row edited by
// hand meanwhile is never written over -- every other row goes back exactly as it was read, fields this build
// does not read included. A file that does not read, or holds a row that does not, is refused until it is
// mended by hand, since writing it back would lose what could not be read. One id names one row across both
// layers. A layer left with no rows has its file taken away rather than left empty, so a dressing tried and
// taken back leaves nothing behind for git to carry.
//
// Here rather than beside the reader in `src/story/`, whose every file ships with the server in every release:
// a release carries none of the editor. Pure: no fs, no DOM. Rule for this file (node runs it with type
// stripping): every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { PLACEMENT_FIELDS, PLACEMENT_LIMITS, isPlacementId, mintPlacementId, placementsFileText, placementsPath, readPlacementRow, readPlacementsFile, readPlacementsFileRaw, rowHash, type PlacementLayer, type PlacementRead, type PlacementRow } from '../story/placements.ts';

/** Every number of the endpoint, all ours. Read where the dev server runs it, and not moved from the browser. */
export const PLACEMENTS_ENDPOINT_TUNE = {
  /** The largest body an ask may carry, bytes. */
  bodyMax: 262144,
  /** How many times a file is put in place over one another program holds open, and how long apart, ms. */
  renameTries: 6,
  renameWaitMs: 50,
};

/** The header the editor's own asks carry, and what it says. */
export const EDITOR_HEADER = 'x-swg3js-dev';
export const EDITOR_HEADER_VALUE = 'placements';

/** What kind of world a pack id is: decides the frame its files are written in, and the copies take none. */
export type EditWorldKind = 'ground' | 'space' | 'copies';

/** What an ask is judged against: every world there is, and the moment, which a written row is stamped with. */
export interface PlacementCtx {
  worlds: ReadonlyMap<string, EditWorldKind>;
  now: number;
}

/** What is known of a request before its body is read. */
export interface RequestMeta {
  method?: string | null;
  remoteAddress?: string | null;
  origin?: string | null;
  host?: string | null;
  /** The editor's header (`EDITOR_HEADER`). */
  dev?: string | null;
  contentType?: string | null;
  /** The body's length as its header says, or null when it says none. */
  length?: number | null;
}

/** What one ask came to: on success the id and layer it left the row in, the file, and both layers as they read now. */
export interface PlacementReplyOk {
  ok: true;
  op: 'put' | 'delete' | 'move' | 'rename';
  id: string;
  layer: PlacementLayer;
  file: string;
  story: PlacementRead | null;
  world: PlacementRead | null;
}
export interface PlacementReplyNo {
  ok: false;
  why: string;
}
export type PlacementReply = PlacementReplyOk | PlacementReplyNo;

/** An ask's answer: its status, its body, and what to write -- a file's whole text, or null to take the file away. */
export interface PlacementAnswer {
  status: number;
  body: PlacementReply;
  writes: { layer: PlacementLayer; text: string | null }[];
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** A pack id, as the files are named: the watcher's own rule (`placementFileOf`). */
const WORLD = /^[a-z0-9_]{1,40}$/;
const LAYERS: readonly PlacementLayer[] = ['story', 'world'];
const OWN_FIELDS = new Set(PLACEMENT_FIELDS);

/** The file a layer is kept in for a world, as the owner reads it. */
export function editFile(layer: PlacementLayer, world: string): string {
  return `public/${placementsPath(layer, world)}`;
}

/** A layer in words. */
function layerWords(layer: PlacementLayer): string {
  return layer === 'story' ? "the story's dressing" : 'the world edits';
}

/**
 * Whether a request may be heard at all, before its body is read: null, or the status and why not. Refused
 * unless it is a POST from this machine (`127.0.0.1`, `::1`, or the first as IPv6 writes it), whose Origin is
 * `http://<Host>`, carrying the editor's own header, saying it is JSON and no longer than the cap.
 */
export function refuseRequest(meta: RequestMeta, tune: typeof PLACEMENTS_ENDPOINT_TUNE = PLACEMENTS_ENDPOINT_TUNE): { status: number; why: string } | null {
  if ((meta.method ?? '').toUpperCase() !== 'POST') return { status: 405, why: 'the placement editor takes a POST and nothing else' };
  if (!meta.remoteAddress || !LOOPBACK.has(meta.remoteAddress)) return { status: 403, why: 'the placement editor answers this machine alone' };
  if (!meta.host || !meta.origin || meta.origin !== `http://${meta.host}`) return { status: 403, why: "the placement editor answers the game's own page alone" };
  if (meta.dev !== EDITOR_HEADER_VALUE) return { status: 403, why: 'the placement editor answers its own asks alone' };
  if (!/^application\/json(\s*;|\s*$)/i.test(meta.contentType ?? '')) return { status: 415, why: 'an ask is JSON' };
  if (meta.length !== null && meta.length !== undefined && !(meta.length >= 0 && meta.length <= tune.bodyMax)) return { status: 413, why: `an ask is ${tune.bodyMax} bytes at most` };
  return null;
}

/** One layer's file as it stands: each row read, beside the very object it was read from. */
interface Held {
  rows: { row: PlacementRow; raw: Record<string, unknown> }[];
  read: PlacementRead | null;
  text: string | null;
}

/**
 * A layer's file opened, or why the editor will not write it. Read **once**: the reader hands each row back beside the
 * very object it was read from (`readPlacementsFileRaw`), where this used to parse the file a second time to get them.
 */
function openLayer(text: string | null, layer: PlacementLayer, world: string, kind: 'ground' | 'space'): Held | string {
  if (text === null) return { rows: [], read: null, text: null };
  const file = editFile(layer, world);
  const full = readPlacementsFileRaw(text, world, kind);
  const read: PlacementRead = { rows: full.rows, skipped: full.skipped, unknown: full.unknown, problem: full.problem };
  if (read.problem) return `${file} does not read (${read.problem}): mend it by hand first`;
  if (read.skipped.length) return `${file} holds rows this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
  // Nothing was skipped, so the rows read are the file's rows, one for one and in order.
  return { rows: read.rows.map((row, i) => ({ row, raw: full.raws[i] })), read, text };
}

/** A row cleaned as the reader cleans one, under the id given and stamped now, or why it is refused. */
function cleanRow(v: unknown, id: string, now: number): PlacementRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'its row is an object';
  const unknown: string[] = [];
  const row = readPlacementRow({ ...(v as Record<string, unknown>), id, at: now }, unknown);
  if (typeof row === 'string') return row;
  if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
  return row;
}

/** A cleaned row to write, carrying whatever the row it replaces held that this build does not read. */
function withExtras(row: PlacementRow, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (was) for (const k of Object.keys(was)) if (!OWN_FIELDS.has(k) && !(k in out)) out[k] = was[k];
  return out;
}

/** Two rows that stand and read the same: everything that stands, and the words. */
function sameRow(a: PlacementRow, b: PlacementRow): boolean {
  return a.id === b.id && rowHash(a) === rowHash(b) && a.ground === b.ground && a.name === b.name && a.note === b.note && a.at === b.at;
}

function no(status: number, why: string): PlacementAnswer {
  return { status, body: { ok: false, why }, writes: [] };
}

/**
 * One ask, against both layers' files as they stand (`current`, a file's text or null for none): what to
 * write, and the answer. The ops:
 *
 * - `{ op: 'put', layer, world, row }` puts a row in, or replaces the one of its id; a row with no id is given
 *   one from its thing or model (`mintPlacementId`), unique across both layers.
 * - `{ op: 'delete', layer, world, id }` takes one out.
 * - `{ op: 'move', from, layer, world, id, row? }` takes one out of `from` and puts it in `layer`, with the row
 *   given (a new place) or as it was.
 * - `{ op: 'rename', layer, world, id, to }` gives one a new id, taken in neither layer.
 *
 * Every row written is stamped with `ctx.now` and must read back exactly as it was cleaned, or nothing is
 * written. A refusal writes nothing.
 */
export function applyPlacementOp(op: unknown, current: { story: string | null; world: string | null }, ctx: PlacementCtx): PlacementAnswer {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return no(400, 'an ask is an object');
  const o = op as Record<string, unknown>;
  const kind = o.op;
  if (kind !== 'put' && kind !== 'delete' && kind !== 'move' && kind !== 'rename') return no(400, 'an ask is a put, a delete, a move or a rename');
  if (o.layer !== 'story' && o.layer !== 'world') return no(400, 'its layer is story or world');
  const layer: PlacementLayer = o.layer;
  if (typeof o.world !== 'string' || !WORLD.test(o.world)) return no(400, 'its world is a pack id: a-z, 0-9 and _, 40 at most');
  const world = o.world;
  const wk = ctx.worlds.get(world);
  if (!wk) return no(404, `there is no world called ${world}`);
  if (wk === 'copies') return no(409, "nothing stands for good in the dungeons' world of copies");
  const readKind = wk === 'space' ? 'space' : 'ground';
  const frame = wk === 'space' ? 'game' : 'raw';
  const held = {} as Record<PlacementLayer, Held>;
  for (const l of LAYERS) {
    const h = openLayer(current[l], l, world, readKind);
    if (typeof h === 'string') return no(409, h);
    held[l] = h;
  }
  const other = (l: PlacementLayer): PlacementLayer => (l === 'story' ? 'world' : 'story');
  const at = (l: PlacementLayer, id: string) => held[l].rows.findIndex((e) => e.row.id === id);
  const full = (l: PlacementLayer) => held[l].rows.length >= PLACEMENT_LIMITS.rows;
  const cap = (l: PlacementLayer) => no(409, `${editFile(l, world)} holds ${PLACEMENT_LIMITS.rows} rows, as many as a file may`);
  const touched = new Set<PlacementLayer>();
  let id: string;

  if (kind === 'put') {
    const asked = o.row;
    if (!asked || typeof asked !== 'object' || Array.isArray(asked)) return no(400, 'a put carries a row');
    const r = asked as Record<string, unknown>;
    let rid = r.id;
    if (rid === undefined || rid === null || rid === '') {
      const taken = new Set([...held.story.rows, ...held.world.rows].map((e) => e.row.id));
      rid = mintPlacementId(typeof r.thing === 'string' ? r.thing : typeof r.model === 'string' ? r.model : 'place', taken);
    }
    if (!isPlacementId(rid)) return no(400, 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)');
    const row = cleanRow(r, rid, ctx.now);
    if (typeof row === 'string') return no(400, `that row is refused: ${row}`);
    if (at(other(layer), row.id) >= 0) return no(409, `that id is in ${layerWords(other(layer))}`);
    const i = at(layer, row.id);
    if (i >= 0) held[layer].rows[i] = { row, raw: withExtras(row, held[layer].rows[i].raw) };
    else {
      if (full(layer)) return cap(layer);
      held[layer].rows.push({ row, raw: withExtras(row, null) });
    }
    touched.add(layer);
    id = row.id;
  } else if (kind === 'delete') {
    if (!isPlacementId(o.id)) return no(400, 'a delete names the row by its id');
    const i = at(layer, o.id);
    if (i < 0) return no(404, `${o.id} is not in ${editFile(layer, world)}`);
    held[layer].rows.splice(i, 1);
    touched.add(layer);
    id = o.id;
  } else if (kind === 'move') {
    if (o.from !== 'story' && o.from !== 'world') return no(400, 'a move says which layer it is from');
    const from: PlacementLayer = o.from;
    if (from === layer) return no(400, 'a move is to the other layer; a put moves a row within one');
    if (!isPlacementId(o.id)) return no(400, 'a move names the row by its id');
    const i = at(from, o.id);
    if (i < 0) return no(404, `${o.id} is not in ${editFile(from, world)}`);
    if (at(layer, o.id) >= 0) return no(409, `${o.id} is in ${layerWords(layer)} already`);
    if (full(layer)) return cap(layer);
    const was = held[from].rows[i];
    const row = cleanRow(o.row !== undefined ? o.row : was.row, o.id, ctx.now);
    if (typeof row === 'string') return no(400, `that row is refused: ${row}`);
    held[from].rows.splice(i, 1);
    held[layer].rows.push({ row, raw: withExtras(row, was.raw) });
    touched.add(from);
    touched.add(layer);
    id = o.id;
  } else {
    if (!isPlacementId(o.id)) return no(400, 'a rename names the row by its id');
    if (!isPlacementId(o.to)) return no(400, 'its new id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)');
    const i = at(layer, o.id);
    if (i < 0) return no(404, `${o.id} is not in ${editFile(layer, world)}`);
    if (o.to !== o.id && (at('story', o.to) >= 0 || at('world', o.to) >= 0)) return no(409, `${o.to} is taken already`);
    const was = held[layer].rows[i];
    const row = cleanRow(was.row, o.to, ctx.now);
    if (typeof row === 'string') return no(400, `that row is refused: ${row}`);
    held[layer].rows[i] = { row, raw: withExtras(row, was.raw) };
    touched.add(layer);
    id = o.to;
  }

  const writes: { layer: PlacementLayer; text: string | null }[] = [];
  const reads: Record<PlacementLayer, PlacementRead | null> = { story: held.story.read, world: held.world.read };
  for (const l of LAYERS) {
    if (!touched.has(l)) continue;
    const list = held[l].rows;
    if (!list.length) {
      if (held[l].text !== null) writes.push({ layer: l, text: null });
      reads[l] = null;
      continue;
    }
    const text = placementsFileText(world, frame, list.map((e) => e.raw as unknown as PlacementRow));
    // Read back before anything is written: every row, the one written and the ones carried, as it was. Looked up in a
    // map by id, so a put is linear in the file: one `find` a row was 669 ms at 10,000 rows and two seconds at 20,000.
    const back = readPlacementsFile(text, world, readKind);
    const lost = back.problem ?? (back.skipped.length ? back.skipped.map((s) => `${s.id}: ${s.why}`).join('; ') : null);
    if (lost) return no(500, `${editFile(l, world)} would not read back as the editor wrote it (${lost})`);
    const backById = new Map<string, PlacementRow>();
    for (const r of back.rows) backById.set(r.id, r);
    for (const e of list) {
      const b = backById.get(e.row.id);
      if (!b || !sameRow(b, e.row)) return no(500, `${e.row.id} would not read back as the editor wrote it`);
    }
    writes.push({ layer: l, text });
    reads[l] = back;
  }
  return { status: 200, body: { ok: true, op: kind, id, layer, file: editFile(layer, world), story: reads.story, world: reads.world }, writes };
}
