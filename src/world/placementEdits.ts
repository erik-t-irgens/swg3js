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
// **The world editor's one write is a batch** (`applyPlacementBatch`, DESIGN.md §2.11): every row an action changed,
// in every file it touched, checked all or nothing -- each file read as it stands, every edit applied in order, every
// row read back -- and any refusal writes nothing. Each edit may carry `was`, the row as the endpoint last answered it
// (or null for a row that must not be there): a row edited by hand or by another tab since is refused by its id, which
// is what keeps an undo from writing over somebody's work. One marked `keepAt` keeps the row's own `at` rather than the
// moment's, so an undo puts a file back to its text before the action byte for byte. The answer carries only what
// changed: for each file its revision (twelve hex of the SHA-1 of its text as written, handed in as `ctx.hash`), the
// rows put as they were stamped and the ids taken out, never both layers read whole.
//
// Here rather than beside the reader in `src/story/`, whose every file ships with the server in every release:
// a release carries none of the editor. Pure: no fs, no DOM. Rule for this file (node runs it with type
// stripping): every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { EDIT_FILE_KINDS, PLACEMENT_FIELDS, PLACEMENT_LIMITS, editFilePath, isPlacementId, mintPlacementId, placementsFileText, placementsPath, readPlacementRow, readPlacementsFile, readPlacementsFileRaw, rowHash, type EditFileKind, type PlacementLayer, type PlacementRead, type PlacementRow } from '../story/placements.ts';

/** Every number of the endpoint, all ours. Read where the dev server runs it, and not moved from the browser. */
export const PLACEMENTS_ENDPOINT_TUNE = {
  /**
   * The largest body an ask may carry, bytes: a backstop tied to the row backstop (a batch of every row of a file is a
   * few tens of megabytes), since it guards an endpoint that answers this machine's own page alone. It was 262,144 while
   * every ask was one row.
   */
  bodyMax: 64 * 1024 * 1024,
  /** How many times a file is put in place over one another program holds open, and how long apart, ms. */
  renameTries: 6,
  renameWaitMs: 50,
};

/** The most edits one batch may carry: twice the rows a file may hold (a whole file moved to the other layer), a backstop. */
export const BATCH_MOST = 2 * PLACEMENT_LIMITS.rows;

/** The header the editor's own asks carry, and what it says. */
export const EDITOR_HEADER = 'x-swg3js-dev';
export const EDITOR_HEADER_VALUE = 'placements';

/** What kind of world a pack id is: decides the frame its files are written in, and the copies take none. */
export type EditWorldKind = 'ground' | 'space' | 'copies';

/**
 * What an ask is judged against: every world there is, and the moment, which a written row is stamped with. `hash`, where
 * handed in (the dev server's glue hands node's SHA-1), names a file's revision from the text written: twelve hex of its
 * SHA-1. Absent, every revision is ''.
 */
export interface PlacementCtx {
  worlds: ReadonlyMap<string, EditWorldKind>;
  now: number;
  hash?: (text: string) => string;
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
  /** Each file written's revision ('' for one taken away), so the page drops the dev server's word about what it has landed. */
  revs?: Partial<Record<PlacementLayer, string>>;
}
export interface PlacementReplyNo {
  ok: false;
  why: string;
}
export type PlacementReply = PlacementReplyOk | PlacementReplyNo;

/** What a batch did to one file: its revision as written ('' taken away), how many rows it holds now, the rows put as stamped and the ids taken out. */
export interface BatchFileAnswer {
  file: string;
  rev: string;
  rows: number;
  put: PlacementRow[];
  deleted: string[];
}

/** A batch answered: each file it touched, and (the glue's) the endpoint's own milliseconds. */
export interface PlacementBatchOk {
  ok: true;
  op: 'batch';
  world: string;
  files: Partial<Record<PlacementLayer, BatchFileAnswer>>;
  ms?: number;
}
export type PlacementBatchReply = PlacementBatchOk | PlacementReplyNo;

/** One edit of a batch: a row put into (or replacing one in) a file, or an id taken out of one, `was` its row as last answered. */
export interface BatchEdit {
  file: EditFileKind;
  put?: Record<string, unknown>;
  delete?: string;
  /** The row as the endpoint last answered it (the cleaned row, `at` included), or null for a row that must not be there; absent asks nothing. */
  was?: Record<string, unknown> | null;
  /** The row's own `at` kept rather than the moment's: what an undo and a redo send, so a file goes back byte for byte. */
  keepAt?: boolean;
}

/** An ask's answer: its status, its body, and what to write -- a file's whole text, or null to take the file away. */
export interface PlacementAnswer {
  status: number;
  body: PlacementReply | PlacementBatchOk;
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
  if (kind === 'batch') return applyPlacementBatch(o, current, ctx);
  if (kind !== 'put' && kind !== 'delete' && kind !== 'move' && kind !== 'rename') return no(400, 'an ask is a put, a delete, a move, a rename or a batch');
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
  const revs: Partial<Record<PlacementLayer, string>> = {};
  for (const l of LAYERS) {
    if (!touched.has(l)) continue;
    const out = writeBack(held[l], l, world, frame, readKind);
    if (typeof out === 'string') return no(500, out);
    if (out.write) writes.push(out.write);
    reads[l] = out.back;
    revs[l] = out.write?.text ? (ctx.hash?.(out.write.text) ?? '') : '';
  }
  return { status: 200, body: { ok: true, op: kind, id, layer, file: editFile(layer, world), story: reads.story, world: reads.world, revs }, writes };
}

/**
 * One layer's rows written back as a file's text and read back before anything is written: every row, the ones written
 * and the ones carried, as it was. Looked up in a map by id, so a write is linear in the file (one `find` a row was 669 ms
 * at 10,000 rows and two seconds at 20,000). A layer left with no rows is taken away (`text` null, `back` null), and one
 * that was never there and is still empty writes nothing. Answers why not in words.
 */
function writeBack(h: Held, l: PlacementLayer, world: string, frame: 'raw' | 'game', readKind: 'ground' | 'space'): { write: { layer: PlacementLayer; text: string | null } | null; back: PlacementRead | null } | string {
  const list = h.rows;
  if (!list.length) return { write: h.text !== null ? { layer: l, text: null } : null, back: null };
  const text = placementsFileText(world, frame, list.map((e) => e.raw as unknown as PlacementRow));
  const back = readPlacementsFile(text, world, readKind);
  const lost = back.problem ?? (back.skipped.length ? back.skipped.map((s) => `${s.id}: ${s.why}`).join('; ') : null);
  if (lost) return `${editFile(l, world)} would not read back as the editor wrote it (${lost})`;
  const backById = new Map<string, PlacementRow>();
  for (const r of back.rows) backById.set(r.id, r);
  for (const e of list) {
    const b = backById.get(e.row.id);
    if (!b || !sameRow(b, e.row)) return `${e.row.id} would not read back as the editor wrote it`;
  }
  return { write: { layer: l, text }, back };
}

/**
 * The world editor's one write (`{ op: 'batch', world, edits }`, DESIGN.md §2.11): every edit applied in order to both
 * layers as they stand, each file read back, and nothing written unless all of it holds. An edit is
 * `{ file, put: row }` (a row put in, or replacing the one of its id in that file; a row with no id is given one from
 * its thing or model, unique across both layers as they stand at that edit, and a given id is kept, refused only where
 * the other layer holds it) or `{ file, delete: id }`, either with `was` (the row as the endpoint last answered it, or
 * null for one that must not be there: a row that differs is refused by its id) and a put with `keepAt` (the row's own
 * `at` kept). The kinds of file the editor's fifth wave writes (`removed`, `people`) are refused in words until it does.
 * The answer names, for each file touched, its revision as written ('' for one taken away), how many rows it holds, the
 * rows put as they were stamped (the last put of an id winning) and the ids taken out.
 */
export function applyPlacementBatch(o: Record<string, unknown>, current: { story: string | null; world: string | null }, ctx: PlacementCtx): PlacementAnswer {
  if (typeof o.world !== 'string' || !WORLD.test(o.world)) return no(400, 'its world is a pack id: a-z, 0-9 and _, 40 at most');
  const world = o.world;
  const wk = ctx.worlds.get(world);
  if (!wk) return no(404, `there is no world called ${world}`);
  const edits = o.edits;
  if (!Array.isArray(edits) || !edits.length) return no(400, 'a batch carries a list of edits');
  if (edits.length > BATCH_MOST) return no(413, `a batch is ${BATCH_MOST} edits at most`);
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
  // Each layer's rows by id, kept in step with the list, so a batch of thousands is linear.
  const index = {} as Record<PlacementLayer, Map<string, number>>;
  const reindex = (l: PlacementLayer): void => {
    const m = new Map<string, number>();
    held[l].rows.forEach((e, i) => m.set(e.row.id, i));
    index[l] = m;
  };
  for (const l of LAYERS) reindex(l);
  const taken = new Set<string>([...index.story.keys(), ...index.world.keys()]);
  const touched = new Set<PlacementLayer>();
  const put = { story: new Map<string, PlacementRow>(), world: new Map<string, PlacementRow>() } as Record<PlacementLayer, Map<string, PlacementRow>>;
  const deleted = { story: new Set<string>(), world: new Set<string>() } as Record<PlacementLayer, Set<string>>;
  // Rows taken out wait to be spliced out together, once, at the end: a splice an edit is quadratic in a big file.
  const gone = { story: new Set<number>(), world: new Set<number>() } as Record<PlacementLayer, Set<number>>;
  for (let n = 0; n < edits.length; n++) {
    const e = edits[n] as BatchEdit | null;
    const at = `edit ${n + 1}`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) return no(400, `${at} is not an edit`);
    if (!(EDIT_FILE_KINDS as readonly unknown[]).includes(e.file)) return no(400, `${at}'s file is story, world, removed or people`);
    if (e.file !== 'story' && e.file !== 'world') return no(400, `${at}: the ${e.file} file is the world editor's fifth wave's, which this endpoint does not write yet`);
    const l: PlacementLayer = e.file;
    const hasPut = e.put !== undefined;
    const hasDel = e.delete !== undefined;
    if (hasPut === hasDel) return no(400, `${at} is a put or a delete`);
    // What stands under the id in this file now (an earlier edit of this batch included), for `was`.
    const now = (id: string): PlacementRow | null => {
      const i = index[l].get(id);
      return i === undefined || gone[l].has(i) ? null : held[l].rows[i].row;
    };
    const wasHolds = (id: string): string | null => {
      if (e.was === undefined) return null;
      const cur = now(id);
      if (e.was === null) return cur ? `${id} is in ${editFile(l, world)} already` : null;
      if (!cur) return `${id} is not in ${editFile(l, world)} any more`;
      const w = readPlacementRow({ ...e.was, id });
      if (typeof w === 'string' || !sameRow(w, cur)) return `${id} has changed in ${editFile(l, world)} since the editor read it: undo refuses to write over it`;
      return null;
    };
    if (hasDel) {
      if (!isPlacementId(e.delete)) return no(400, `${at}: a delete names the row by its id`);
      const id = e.delete;
      const i = index[l].get(id);
      if (i === undefined || gone[l].has(i)) return no(404, `${id} is not in ${editFile(l, world)}`);
      const why = wasHolds(id);
      if (why) return no(409, why);
      gone[l].add(i);
      index[l].delete(id);
      taken.delete(id);
      put[l].delete(id);
      deleted[l].add(id);
      touched.add(l);
      continue;
    }
    const asked = e.put;
    if (!asked || typeof asked !== 'object' || Array.isArray(asked)) return no(400, `${at}: a put carries a row`);
    let rid = asked.id;
    if (rid === undefined || rid === null || rid === '') rid = mintPlacementId(typeof asked.thing === 'string' ? asked.thing : typeof asked.model === 'string' ? asked.model : 'place', taken);
    if (!isPlacementId(rid)) return no(400, `${at}: its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)`);
    const id = rid;
    const otherAt = index[other(l)].get(id);
    if (otherAt !== undefined && !gone[other(l)].has(otherAt)) return no(409, `${id} is in ${layerWords(other(l))}`);
    const why = wasHolds(id);
    if (why) return no(409, why);
    let stamp = ctx.now;
    if (e.keepAt) {
      if (typeof asked.at !== 'number' || !Number.isFinite(asked.at) || asked.at < 0) return no(400, `${at}: keepAt asks for a row carrying its own at`);
      stamp = asked.at;
    }
    const row = cleanRow(asked, id, stamp);
    if (typeof row === 'string') return no(400, `${id} is refused: ${row}`);
    const i = index[l].get(id);
    if (i !== undefined && !gone[l].has(i)) held[l].rows[i] = { row, raw: withExtras(row, held[l].rows[i].raw) };
    else {
      if (held[l].rows.length - gone[l].size >= PLACEMENT_LIMITS.rows) return no(409, `${editFile(l, world)} holds ${PLACEMENT_LIMITS.rows} rows, as many as a file may`);
      index[l].set(id, held[l].rows.length);
      held[l].rows.push({ row, raw: withExtras(row, null) });
    }
    taken.add(id);
    deleted[l].delete(id);
    put[l].set(id, row);
    touched.add(l);
  }
  const writes: { layer: PlacementLayer; text: string | null }[] = [];
  const files: Partial<Record<PlacementLayer, BatchFileAnswer>> = {};
  for (const l of LAYERS) {
    if (!touched.has(l)) continue;
    if (gone[l].size) held[l].rows = held[l].rows.filter((_, i) => !gone[l].has(i));
    const out = writeBack(held[l], l, world, frame, readKind);
    if (typeof out === 'string') return no(500, out);
    if (out.write) writes.push(out.write);
    files[l] = { file: editFile(l, world), rev: out.write?.text ? (ctx.hash?.(out.write.text) ?? '') : '', rows: held[l].rows.length, put: [...put[l].values()], deleted: [...deleted[l]] };
  }
  return { status: 200, body: { ok: true, op: 'batch', world, files }, writes };
}

/**
 * What a file is to git, from the read-only answers the dev server's glue gathers (`git status --porcelain`, whether it is
 * in HEAD, whether it differs from main): `none` (no file, and none in HEAD), `untracked` (a file git has never been
 * told of), `modified` (saved, not committed: changed, added or taken away since HEAD), `committed` (on this branch as it
 * stands) or `main` (the same on main). Pure; the glue runs git, every call `--no-optional-locks`, so the editor never
 * writes the index under the owner's own git.
 */
export type FileState = 'none' | 'untracked' | 'modified' | 'committed' | 'main';
export function fileStateOf(f: { exists: boolean; inHead: boolean; porcelain: string | null; sameAsMain: boolean | null }): FileState {
  const code = f.porcelain;
  if (code === '??') return 'untracked';
  if (code && code.trim()) return 'modified';
  if (!f.exists) return f.inHead ? 'modified' : 'none';
  if (!f.inHead) return 'untracked';
  return f.sameAsMain ? 'main' : 'committed';
}

/** The files the status op asks git about for a world, relative to the checkout: its four kinds of placement file and its track file. */
export function statusFiles(world: string): { kind: EditFileKind | 'track'; path: string }[] {
  return [...EDIT_FILE_KINDS.map((k) => ({ kind: k, path: `public/${editFilePath(k, world)}` })), { kind: 'track' as const, path: `public/tracks/${world}.json` }];
}

/** Whether a status ask names a world it may be answered for: the world's pack id, or why not. */
export function statusAsk(o: unknown, ctx: { worlds: ReadonlyMap<string, EditWorldKind> }): { world: string } | { status: number; why: string } {
  const a = o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
  if (!a || typeof a.world !== 'string' || !WORLD.test(a.world)) return { status: 400, why: 'its world is a pack id: a-z, 0-9 and _, 40 at most' };
  if (!ctx.worlds.has(a.world)) return { status: 404, why: `there is no world called ${a.world}` };
  return { world: a.world };
}
