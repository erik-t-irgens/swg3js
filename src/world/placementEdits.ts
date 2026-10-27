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
// **A batch writes any kind of edit file** (Map-maker II, DESIGN.md §2.2): each kind is a module of its reader, cleaner,
// writer, id rule and likeness (`EditKind`), the two row layers kinds over the very functions above (so what a batch of
// theirs answers is what it answered before the kinds, which a test holds against e6c2578's own rules), and every other
// kind named by its wave: the heights from Map-maker II's first (`heightsKind`), the rest refused in their wave's words.
//
// Here rather than beside the reader in `src/story/`, whose every file ships with the server in every release:
// a release carries none of the editor. Pure: no fs, no DOM. Rule for this file (node runs it with type
// stripping): every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { EDIT_FILE_KINDS, PLACEMENT_FIELDS, PLACEMENT_LIMITS, editFilePath, isPlacementId, mintPlacementId, placementsFileText, placementsPath, readPlacementRow, readPlacementsFile, readPlacementsFileRaw, rowHash, type EditFileKind, type PlacementLayer, type PlacementRead, type PlacementRow } from '../story/placements.ts';
import { HEIGHTS_LIMITS, heightsFileText, isTileId, readHeightsFile, readTileRow, sameTile, tileWithExtras, type HeightTileRow } from './editFiles/heightsFile.ts';

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
  /**
   * The bytes of a row a kind keeps deflated (a tile of heights' deltas: deflate-raw, base64), inflated: node's own zlib,
   * handed in by the dev server's glue, or null for bytes that do not inflate. Absent, a kind that needs it refuses in
   * words rather than writing what it cannot read back.
   */
  inflate?: (b64: string) => Uint8Array | null;
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

/**
 * A row of any kind of edit file (DESIGN.md §2.2 of Map-maker II): its id, the moment the endpoint wrote it, and whatever
 * its kind keeps beside them. A placement row is one; a tile of heights is one.
 */
export interface EditRow {
  id: string;
  at?: number;
}

/** What a batch did to one file: its revision as written ('' taken away), how many rows it holds now, the rows put as stamped and the ids taken out. */
export interface BatchFileAnswer<R extends EditRow = PlacementRow> {
  file: string;
  rev: string;
  rows: number;
  put: R[];
  deleted: string[];
}

/** Each file a batch touched: the two row layers' rows are placement rows, every other kind's rows its own. */
export type BatchFiles = { story?: BatchFileAnswer<PlacementRow>; world?: BatchFileAnswer<PlacementRow> } & { [K in Exclude<EditFileKind, PlacementLayer>]?: BatchFileAnswer<EditRow> };

/** A batch answered: each file it touched, and (the glue's) the endpoint's own milliseconds. */
export interface PlacementBatchOk {
  ok: true;
  op: 'batch';
  world: string;
  files: BatchFiles;
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

/**
 * An ask's answer: its status, its body, and what to write -- a file's whole text, or null to take the file away. `layer` is
 * the kind of file (a row layer, or any other kind a batch writes), the name kept from when only the two layers were written.
 */
export interface PlacementAnswer {
  status: number;
  body: PlacementReply | PlacementBatchOk;
  writes: { layer: EditFileKind; text: string | null }[];
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
interface HeldRows {
  rows: { row: PlacementRow; raw: Record<string, unknown> }[];
  read: PlacementRead | null;
  text: string | null;
}

/**
 * A layer's file opened, or why the editor will not write it. Read **once**: the reader hands each row back beside the
 * very object it was read from (`readPlacementsFileRaw`), where this used to parse the file a second time to get them.
 */
function openLayer(text: string | null, layer: PlacementLayer, world: string, kind: 'ground' | 'space'): HeldRows | string {
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
export function applyPlacementOp(op: unknown, current: Partial<Record<EditFileKind, string | null>>, ctx: PlacementCtx): PlacementAnswer {
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
  const held = {} as Record<PlacementLayer, HeldRows>;
  for (const l of LAYERS) {
    const h = openLayer(current[l] ?? null, l, world, readKind);
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
function writeBack(h: HeldRows, l: PlacementLayer, world: string, frame: 'raw' | 'game', readKind: 'ground' | 'space'): { write: { layer: PlacementLayer; text: string | null } | null; back: PlacementRead | null } | string {
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
 * One kind of file the batch writes (Map-maker II's DESIGN.md §2.2): its shipped reader, an id rule, a cleaner, a writer,
 * when two of its rows read alike, how many rows its file may hold, and which kinds share its ids. The two row layers are
 * one kind each over the very functions the batch used before the kinds (`ROW_KINDS`), so what a batch of theirs answers
 * is what it answered; every other kind adds one of these, and a kind whose wave has not come is refused in that wave's
 * words (`EDIT_KINDS`' `notYet`).
 */
export interface EditKind<R extends EditRow = EditRow> {
  readonly kind: EditFileKind;
  /** The kinds whose ids are one space with this kind's: `rows` for the two row layers, null for a kind of its own. */
  readonly group: 'rows' | null;
  /** Whether a ground world alone keeps it (heights, paint, water): refused in a space zone, its pass a later one. */
  readonly groundOnly: boolean;
  /** The most rows its file may hold, a backstop every build agrees on. */
  readonly most: number;
  /** Whether an id is one its rows carry, and the words for one that is not. */
  idOk(id: unknown): id is string;
  readonly idWords: string;
  /** A file opened as it stands, each row beside the very object it was read from, or why the editor will not write it. */
  open(text: string | null, world: string, wk: 'ground' | 'space', ctx: PlacementCtx): Held<R> | string;
  /** A row cleaned as the reader cleans one, under the id given and stamped `stamp`, or why it is refused. */
  clean(asked: Record<string, unknown>, id: string, stamp: number, ctx: PlacementCtx): R | string;
  /** A row read as the reader reads one (the `was` an edit carries), or why not. */
  parse(v: Record<string, unknown>, ctx: PlacementCtx): R | string;
  /** Two rows that stand and read the same. */
  same(a: R, b: R): boolean;
  /** A cleaned row to write, carrying what the row it replaces held that this build does not read. */
  extras(row: R, was: Record<string, unknown> | null): Record<string, unknown>;
  /** The rows as the file's text (one row a line, sorted by id). */
  text(world: string, frame: 'raw' | 'game', rows: readonly Record<string, unknown>[]): string;
  /** The file's text read back as the shipped reader reads it. */
  read(text: string, world: string, wk: 'ground' | 'space', ctx: PlacementCtx): { rows: R[]; skipped: { id: string; why: string }[]; problem: string | null };
  /** A fresh id for a put that names none, unique among `taken`: the row layers' own rule (`mintPlacementId`); a kind with none refuses an id-less put. */
  mint?(asked: Record<string, unknown>, taken: ReadonlySet<string>): string;
  /** The file it is kept in for a world, as the owner reads it. */
  file(world: string): string;
}

/** One file as it stands: each row read, beside the very object it was read from. */
export interface Held<R extends EditRow = PlacementRow> {
  rows: { row: R; raw: Record<string, unknown> }[];
  read: { rows: R[] } | null;
  text: string | null;
}

/** The words a kind of file of a later wave is refused in, by kind: the batch writes none of them yet. */
export const NOT_YET: Partial<Record<EditFileKind, string>> = {
  removed: "the world editor's fifth wave's",
  people: "the world editor's fifth wave's",
  paint: "Map-maker II's second wave's",
  water: "Map-maker II's fifth wave's",
  locations: "Map-maker II's eighth wave's",
  looks: "Map-maker II's thirteenth wave's",
};

/** A placement row layer as a kind of edit file: the very reader, cleaner, writer and likeness the batch used before the kinds. */
function rowKind(layer: PlacementLayer): EditKind<PlacementRow> {
  return {
    kind: layer,
    group: 'rows',
    groundOnly: false,
    // Read as the batch asks, as it always was: the backstop is one table every reader holds a file to.
    get most() {
      return PLACEMENT_LIMITS.rows;
    },
    idOk: isPlacementId,
    idWords: 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)',
    open: (text, world, wk) => openLayer(text, layer, world, wk),
    clean: (asked, id, stamp) => cleanRow(asked, id, stamp),
    parse: (v) => readPlacementRow(v),
    same: sameRow,
    extras: withExtras,
    text: (world, frame, rows) => placementsFileText(world, frame, rows as unknown as PlacementRow[]),
    read: (text, world, wk) => readPlacementsFile(text, world, wk),
    mint: (asked, taken) => mintPlacementId(typeof asked.thing === 'string' ? asked.thing : typeof asked.model === 'string' ? asked.model : 'place', taken),
    file: (world) => editFile(layer, world),
  };
}

/** The two row layers, kinds of edit file over the rules the batch has always run. */
export const ROW_KINDS: Record<PlacementLayer, EditKind<PlacementRow>> = { story: rowKind('story'), world: rowKind('world') };

/**
 * The heights (Map-maker II's first wave, `editFiles/heightsFile.ts`): a tile a row, named by its place, its deltas checked
 * through the inflate the glue hands in (node's zlib), a nought tile refused (it is taken out instead), a ground world's
 * alone. No id is minted: a tile is named by where it lies.
 */
export const heightsKind: EditKind<HeightTileRow> = {
  kind: 'heights',
  group: null,
  groundOnly: true,
  most: HEIGHTS_LIMITS.tiles,
  idOk: isTileId,
  idWords: 'its id is not a tile\'s place ("tx,tz")',
  open(text, world, wk, ctx) {
    if (text === null) return { rows: [], read: null, text: null };
    const file = heightsFile(world);
    if (!ctx.inflate) return `${file} cannot be read here: the endpoint was handed no way to inflate a tile`;
    const raws: Record<string, unknown>[] = [];
    const read = readHeightsFile(text, world, wk, ctx.inflate, raws);
    if (read.problem) return `${file} does not read (${read.problem}): mend it by hand first`;
    if (read.skipped.length) return `${file} holds tiles this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
    return { rows: read.rows.map((row, i) => ({ row, raw: raws[i] })), read, text };
  },
  clean(asked, id, stamp, ctx) {
    if (!ctx.inflate) return 'the endpoint was handed no way to inflate a tile';
    const unknown: string[] = [];
    const row = readTileRow({ ...asked, id, at: stamp }, unknown, ctx.inflate);
    if (typeof row === 'string') return row;
    if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
    return row;
  },
  parse: (v, ctx) => readTileRow(v, [], ctx.inflate),
  same: sameTile,
  extras: tileWithExtras,
  text: (world, _frame, rows) => heightsFileText(world, rows),
  read: (text, world, wk, ctx) => readHeightsFile(text, world, wk, ctx.inflate),
  file: heightsFile,
};

/** The heights file for a world, as the owner reads it. */
function heightsFile(world: string): string {
  return `public/${editFilePath('heights', world)}`;
}

/**
 * Every kind the batch writes now, by name: the two row layers, and from Map-maker II's first wave the heights. A kind
 * named in `EDIT_FILE_KINDS` and missing here is refused in its wave's words (`NOT_YET`).
 */
export const EDIT_KINDS: Partial<Record<EditFileKind, EditKind<EditRow>>> = { story: ROW_KINDS.story as unknown as EditKind<EditRow>, world: ROW_KINDS.world as unknown as EditKind<EditRow>, heights: heightsKind as unknown as EditKind<EditRow> };

/**
 * The world editor's one write (`{ op: 'batch', world, edits }`, DESIGN.md §2.11): every edit applied in order to every
 * file it names as they stand (the two row layers always opened, as before the kinds), each file read back, and nothing
 * written unless all of it holds. An edit is `{ file, put: row }` (a row put in, or replacing the one of its id in that
 * file; for the two row layers a row with no id is given one from its thing or model, unique across both layers as they
 * stand at that edit, and a given id is kept, refused only where the other layer holds it) or `{ file, delete: id }`,
 * either with `was` (the row as the endpoint last answered it, or null for one that must not be there: a row that differs
 * is refused by its id) and a put with `keepAt` (the row's own `at` kept). A kind of file whose wave has not come is
 * refused in its words (`NOT_YET`); a kind kept for the ground alone (heights, paint, water) in a space zone. The answer
 * names, for each file touched, its revision as written ('' for one taken away), how many rows it holds, the rows put as
 * they were stamped (the last put of an id winning) and the ids taken out.
 */
export function applyPlacementBatch(o: Record<string, unknown>, current: Partial<Record<EditFileKind, string | null>>, ctx: PlacementCtx): PlacementAnswer {
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
  // Each file a kind keeps, opened the first time an edit names it (the two row layers always, as before the kinds).
  const held = new Map<EditFileKind, Held<EditRow>>();
  // Each file's rows by id, kept in step with the list, so a batch of thousands is linear.
  const index = new Map<EditFileKind, Map<string, number>>();
  // Rows taken out wait to be spliced out together, once, at the end: a splice an edit is quadratic in a big file.
  const gone = new Map<EditFileKind, Set<number>>();
  const put = new Map<EditFileKind, Map<string, EditRow>>();
  const deleted = new Map<EditFileKind, Set<string>>();
  const touched = new Set<EditFileKind>();
  /** The ids taken in each group of kinds that share theirs (the two row layers'), or in a kind's own. */
  const taken = new Map<string, Set<string>>();
  const groupOf = (k: EditKind<EditRow>): string => k.group ?? k.kind;
  const openKind = (kind: EditFileKind, k: EditKind<EditRow>): string | null => {
    if (held.has(kind)) return null;
    const h = k.open(current[kind] ?? null, world, readKind, ctx);
    if (typeof h === 'string') return h;
    held.set(kind, h);
    const m = new Map<string, number>();
    h.rows.forEach((e, i) => m.set(e.row.id, i));
    index.set(kind, m);
    gone.set(kind, new Set());
    put.set(kind, new Map());
    deleted.set(kind, new Set());
    const g = groupOf(k);
    let t = taken.get(g);
    if (!t) taken.set(g, (t = new Set()));
    for (const id of m.keys()) t.add(id);
    return null;
  };
  for (const l of LAYERS) {
    const why = openKind(l, EDIT_KINDS[l]!);
    if (why) return no(409, why);
  }
  /** The other kinds of a kind's group whose files hold an id now (the row layers' clash). */
  const heldElsewhere = (kind: EditFileKind, k: EditKind<EditRow>, id: string): EditFileKind | null => {
    if (!k.group) return null;
    for (const [other, ok] of Object.entries(EDIT_KINDS) as [EditFileKind, EditKind<EditRow>][]) {
      if (other === kind || ok.group !== k.group) continue;
      const i = index.get(other)?.get(id);
      if (i !== undefined && !gone.get(other)!.has(i)) return other;
    }
    return null;
  };
  for (let n = 0; n < edits.length; n++) {
    const e = edits[n] as BatchEdit | null;
    const at = `edit ${n + 1}`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) return no(400, `${at} is not an edit`);
    if (!(EDIT_FILE_KINDS as readonly unknown[]).includes(e.file)) return no(400, `${at}'s file is ${EDIT_FILE_KINDS.slice(0, -1).join(', ')} or ${EDIT_FILE_KINDS[EDIT_FILE_KINDS.length - 1]}`);
    const l: EditFileKind = e.file;
    const k = EDIT_KINDS[l];
    if (!k) return no(400, `${at}: the ${l} file is ${NOT_YET[l] ?? 'a later wave\'s'}, which this endpoint does not write yet`);
    if (k.groundOnly && wk === 'space') return no(409, `${at}: the ${l} file is the ground's: space maps are a later pass`);
    const opened = openKind(l, k);
    if (opened) return no(409, opened);
    const rows = held.get(l)!;
    const ix = index.get(l)!;
    const gn = gone.get(l)!;
    const pt = put.get(l)!;
    const dl = deleted.get(l)!;
    const tk = taken.get(groupOf(k))!;
    const hasPut = e.put !== undefined;
    const hasDel = e.delete !== undefined;
    if (hasPut === hasDel) return no(400, `${at} is a put or a delete`);
    // What stands under the id in this file now (an earlier edit of this batch included), for `was`.
    const now = (id: string): EditRow | null => {
      const i = ix.get(id);
      return i === undefined || gn.has(i) ? null : rows.rows[i].row;
    };
    const wasHolds = (id: string): string | null => {
      if (e.was === undefined) return null;
      const cur = now(id);
      if (e.was === null) return cur ? `${id} is in ${k.file(world)} already` : null;
      if (!cur) return `${id} is not in ${k.file(world)} any more`;
      const w = k.parse({ ...e.was, id }, ctx);
      if (typeof w === 'string' || !k.same(w, cur)) return `${id} has changed in ${k.file(world)} since the editor read it: undo refuses to write over it`;
      return null;
    };
    if (hasDel) {
      if (!k.idOk(e.delete)) return no(400, `${at}: a delete names the row by its id`);
      const id = e.delete;
      const i = ix.get(id);
      if (i === undefined || gn.has(i)) return no(404, `${id} is not in ${k.file(world)}`);
      const why = wasHolds(id);
      if (why) return no(409, why);
      gn.add(i);
      ix.delete(id);
      tk.delete(id);
      pt.delete(id);
      dl.add(id);
      touched.add(l);
      continue;
    }
    const asked = e.put;
    if (!asked || typeof asked !== 'object' || Array.isArray(asked)) return no(400, `${at}: a put carries a row`);
    let rid = asked.id;
    if ((rid === undefined || rid === null || rid === '') && k.mint) rid = k.mint(asked, tk);
    if (!k.idOk(rid)) return no(400, `${at}: ${k.idWords}`);
    const id = rid;
    const clash = heldElsewhere(l, k, id);
    if (clash) return no(409, `${id} is in ${clash === 'story' || clash === 'world' ? layerWords(clash) : `the ${clash} file`}`);
    const why = wasHolds(id);
    if (why) return no(409, why);
    let stamp = ctx.now;
    if (e.keepAt) {
      if (typeof asked.at !== 'number' || !Number.isFinite(asked.at) || asked.at < 0) return no(400, `${at}: keepAt asks for a row carrying its own at`);
      stamp = asked.at;
    }
    const row = k.clean(asked, id, stamp, ctx);
    if (typeof row === 'string') return no(400, `${id} is refused: ${row}`);
    const i = ix.get(id);
    if (i !== undefined && !gn.has(i)) rows.rows[i] = { row, raw: k.extras(row, rows.rows[i].raw) };
    else {
      if (rows.rows.length - gn.size >= k.most) return no(409, `${k.file(world)} holds ${k.most} rows, as many as a file may`);
      ix.set(id, rows.rows.length);
      rows.rows.push({ row, raw: k.extras(row, null) });
    }
    tk.add(id);
    dl.delete(id);
    pt.set(id, row);
    touched.add(l);
  }
  const writes: { layer: EditFileKind; text: string | null }[] = [];
  const files: Partial<Record<EditFileKind, BatchFileAnswer<EditRow>>> = {};
  // In the order the kinds are named, so the two row layers come first and in their old order.
  for (const l of EDIT_FILE_KINDS) {
    if (!touched.has(l)) continue;
    const k = EDIT_KINDS[l]!;
    const h = held.get(l)!;
    const gn = gone.get(l)!;
    if (gn.size) h.rows = h.rows.filter((_, i) => !gn.has(i));
    const out = writeKindBack(k, h, l, world, frame, readKind, ctx);
    if (typeof out === 'string') return no(500, out);
    if (out.write) writes.push(out.write);
    files[l] = { file: k.file(world), rev: out.write?.text ? (ctx.hash?.(out.write.text) ?? '') : '', rows: h.rows.length, put: [...put.get(l)!.values()], deleted: [...deleted.get(l)!] };
  }
  return { status: 200, body: { ok: true, op: 'batch', world, files: files as BatchFiles }, writes };
}

/**
 * One kind's file written back as its text and read back before anything is written: every row, the ones written and the
 * ones carried, as it was. The two row layers' is `writeBack` itself; every other kind's the same steps through its own
 * writer and reader. A file left with no rows is taken away, and one that was never there and is still empty writes nothing.
 */
function writeKindBack(k: EditKind<EditRow>, h: Held<EditRow>, l: EditFileKind, world: string, frame: 'raw' | 'game', readKind: 'ground' | 'space', ctx: PlacementCtx): { write: { layer: EditFileKind; text: string | null } | null } | string {
  if (l === 'story' || l === 'world') return writeBack(h as unknown as HeldRows, l, world, frame, readKind);
  const list = h.rows;
  if (!list.length) return { write: h.text !== null ? { layer: l, text: null } : null };
  const text = k.text(world, frame, list.map((e) => e.raw));
  const back = k.read(text, world, readKind, ctx);
  const lost = back.problem ?? (back.skipped.length ? back.skipped.map((s) => `${s.id}: ${s.why}`).join('; ') : null);
  if (lost) return `${k.file(world)} would not read back as the editor wrote it (${lost})`;
  const byId = new Map<string, EditRow>();
  for (const r of back.rows) byId.set(r.id, r);
  for (const e of list) {
    const b = byId.get(e.row.id);
    if (!b || !k.same(b, e.row)) return `${e.row.id} would not read back as the editor wrote it`;
  }
  return { write: { layer: l, text } };
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

/**
 * The files the status op asks git about for a world, relative to the checkout: every kind of edit file (`EDIT_FILE_KINDS`:
 * a kind every world shares by its one file) and its track file.
 */
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
