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
// kind named by its wave: the heights from Map-maker II's first (`heightsKind`), the paint from its second (`paintKind`), the
// rest refused in their wave's words. And from the race drawer's first wave a world's track file (`tracksKind`), a kind kept
// outside the placements folder (`OUTSIDE_KINDS`, `batchKindOf`), so a drawn course and its gates are one undo entry too.
//
// Here rather than beside the reader in `src/story/`, whose every file ships with the server in every release:
// a release carries none of the editor. Pure: no fs, no DOM. Rule for this file (node runs it with type
// stripping): every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { BATCH_FILE_KINDS, EDIT_FILE_KINDS, PLACEMENT_FIELDS, PLACEMENT_LIMITS, attachHash, editFilePath, isPlacementId, mintPlacementId, outsideFilePath, placementsFileText, placementsPath, readPlacementRow, readPlacementsFile, readPlacementsFileRaw, rowHash, type BatchFileKind, type EditFileKind, type OutsideFileKind, type PlacementLayer, type PlacementRead, type PlacementRow } from '../story/placements.ts';
import { TRACK_LIMITS, isTrackId, readTrack, readTrackFile, readTrackFileRaw, trackFileText, trackHash, type TrackDef } from '../race/trackFile.ts';
import { HEIGHTS_LIMITS, heightsFileText, isTileId, readHeightsFile, readTileRow, sameTile, tileWithExtras, type HeightTileRow } from './editFiles/heightsFile.ts';
import { PAINT_LIMITS, isPaintId, paintFileText, paintRowsWhole, paintWithExtras, readPaintFile, readPaintRow, samePaintRow, type PaintRow } from './editFiles/paintFile.ts';
import { WATER_LIMITS, isWaterId, mintWaterId, readWaterFile, readWaterRow, sameWaterRow, waterFileText, waterWithExtras, type WaterRow } from './editFiles/waterFile.ts';
import { LOCATION_LIMITS, isLocationId, locationsFileText, locationsWithExtras, mintLocationId, readLocationRow, readLocationsFile, sameLocationRow, type LocationRow } from './editFiles/locationsFile.ts';
import { REMOVAL_LIMITS, isRemovalId, mintZoneId, readRemovalRow, readRemovalsFile, removalWithExtras, removalsFileText, sameRemovalRow, type RemovalRow } from '../story/removals.ts';
import { PEOPLE_LIMITS, isPersonId, mintPersonId, peopleFileText, personWithExtras, readPeopleFile, readPersonRow, samePersonRow, type PlacedPersonRow } from '../story/placedPeople.ts';
import { isSolidFileId, readSolidFileRow, readSolidFileRows, solidFileText, type SolidFileRow } from './walkThrough.ts';
import { LOOKS_LIMITS, isLookId, lookWithExtras, looksFileText, mintLookId, readLookRow, readLooksFile, sameLookRow, type OwnLookRow } from './editFiles/looksFile.ts';
import { ALL_ID_PREFIX, LIGHTS_LIMITS, isLightId, lightWithExtras, lightsFileText, mintLightId, readLightRow, readLightsFile, sameLightRow, type LightRow } from './editFiles/lightsFile.ts';

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
export type BatchFiles = { story?: BatchFileAnswer<PlacementRow>; world?: BatchFileAnswer<PlacementRow> } & { [K in Exclude<BatchFileKind, PlacementLayer>]?: BatchFileAnswer<EditRow> };

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
  file: BatchFileKind;
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
  writes: { layer: BatchFileKind; text: string | null }[];
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

/** What a row put with no id is named from: its thing, else its model, else a mark's word (the seventh wave), else `place`. */
function mintBase(r: Record<string, unknown>): string {
  return typeof r.thing === 'string' ? r.thing : typeof r.model === 'string' ? r.model : r.kind === 'mark' ? 'mark' : 'place';
}

/** Two rows that stand and read the same: everything that stands, what hangs on them (not in the stand's hash), and the words. */
function sameRow(a: PlacementRow, b: PlacementRow): boolean {
  return a.id === b.id && rowHash(a) === rowHash(b) && attachHash(a) === attachHash(b) && a.ground === b.ground && a.name === b.name && a.note === b.note && a.at === b.at;
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
export function applyPlacementOp(op: unknown, current: Partial<Record<BatchFileKind, string | null>>, ctx: PlacementCtx): PlacementAnswer {
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
      rid = mintPlacementId(mintBase(r), taken);
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
  readonly kind: BatchFileKind;
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
  /**
   * A row cleaned as the reader cleans one, under the id given and stamped `stamp`, or why it is refused. `wk` is the world's
   * kind, which a kind whose reader asks it (the tracks: a space zone's track refuses a course) reads; the rest step over it.
   */
  clean(asked: Record<string, unknown>, id: string, stamp: number, ctx: PlacementCtx, wk?: 'ground' | 'space'): R | string;
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
  /**
   * Why the file's rows as a batch would leave them do not hang together, in words, or null (the paint's: a family cell
   * naming an entry past the palette, two cells in one file): refused as the asker's, before the read-back's own net.
   */
  whole?(rows: readonly R[]): string | null;
  /** The file it is kept in for a world, as the owner reads it. */
  file(world: string): string;
}

/** One file as it stands: each row read, beside the very object it was read from. */
export interface Held<R extends EditRow = PlacementRow> {
  rows: { row: R; raw: Record<string, unknown> }[];
  read: { rows: R[] } | null;
  text: string | null;
}

/**
 * The words a kind of file of a later wave is refused in, by kind: none since Map-maker II's thirteenth wave wrote its last
 * (`looks`), and kept for whatever kind a later pass names before it writes it.
 */
export const NOT_YET: Partial<Record<EditFileKind, string>> = {};

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
    mint: (asked, taken) => mintPlacementId(mintBase(asked), taken),
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
 * The paint (Map-maker II's second wave, `editFiles/paintFile.ts`): its world row, its palette and a row a layer a tile,
 * each named by what it is (`world`, `palette`, `fam:tx,tz`, `col:tx,tz`), a tile of nothing refused (it is taken out
 * instead), a ground world's alone. A tile's runs are held to some cell's count as it is cleaned, and the file read back
 * whole holds every tile to its header's cell and every family cell to the palette, so a write that would leave a cell
 * naming an entry the palette has not got is refused. No id is minted: a row is named by what it is.
 */
export const paintKind: EditKind<PaintRow> = {
  kind: 'paint',
  group: null,
  groundOnly: true,
  most: PAINT_LIMITS.rows,
  idOk: isPaintId,
  idWords: 'its id is world, palette, or a tile\'s ("fam:tx,tz", "col:tx,tz")',
  open(text, world, wk) {
    if (text === null) return { rows: [], read: null, text: null };
    const file = paintFile(world);
    const raws: Record<string, unknown>[] = [];
    const read = readPaintFile(text, world, wk, raws);
    if (read.problem) return `${file} does not read (${read.problem}): mend it by hand first`;
    if (read.skipped.length) return `${file} holds rows this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
    return { rows: read.rows.map((row, i) => ({ row, raw: raws[i] })), read, text };
  },
  clean(asked, id, stamp) {
    const unknown: string[] = [];
    const row = readPaintRow({ ...asked, id, at: stamp }, unknown);
    if (typeof row === 'string') return row;
    if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
    return row;
  },
  parse: (v) => readPaintRow(v),
  same: samePaintRow,
  extras: paintWithExtras,
  text: (world, _frame, rows) => paintFileText(world, rows),
  read: (text, world, wk) => readPaintFile(text, world, wk),
  whole: paintRowsWhole,
  file: paintFile,
};

/** The paint file for a world, as the owner reads it. */
function paintFile(world: string): string {
  return `public/${editFilePath('paint', world)}`;
}

/**
 * The water (Map-maker II's fifth wave, `editFiles/waterFile.ts`): a lake or (the sixth wave) a river a row, named by an id
 * of its own (minted from its name where a put names none), its outline and height or its spine, width and velocity checked
 * as the reader checks them, a ground world's alone (a real-elevation world's among them; a space zone's is refused).
 */
export const waterKind: EditKind<WaterRow> = {
  kind: 'water',
  group: null,
  groundOnly: true,
  most: WATER_LIMITS.rows,
  idOk: isWaterId,
  idWords: 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)',
  open(text, world, wk) {
    if (text === null) return { rows: [], read: null, text: null };
    const file = waterFile(world);
    const raws: Record<string, unknown>[] = [];
    const read = readWaterFile(text, world, wk, raws);
    if (read.problem) return `${file} does not read (${read.problem}): mend it by hand first`;
    if (read.skipped.length) return `${file} holds rows this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
    return { rows: read.rows.map((row, i) => ({ row, raw: raws[i] })), read, text };
  },
  clean(asked, id, stamp) {
    const unknown: string[] = [];
    const row = readWaterRow({ ...asked, id, at: stamp }, unknown);
    if (typeof row === 'string') return row;
    if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
    return row;
  },
  parse: (v) => readWaterRow(v),
  same: sameWaterRow,
  extras: waterWithExtras,
  text: (world, _frame, rows) => waterFileText(world, rows),
  read: (text, world, wk) => readWaterFile(text, world, wk),
  mint: (asked, taken) => mintWaterId(typeof asked.name === 'string' ? asked.name : asked.kind === 'river' ? 'river' : 'lake', taken),
  file: waterFile,
};

/** The water file for a world, as the owner reads it. */
function waterFile(world: string): string {
  return `public/${editFilePath('water', world)}`;
}

/**
 * The places (Map-maker II's eighth wave, `editFiles/locationsFile.ts`): the world's own row (id `world`) and a place a row,
 * named by an id of its own (minted from its name where a put names none), its shape checked as the reader checks it. Not
 * the ground's alone: a space zone's file is kept in the game's frame (drawn nowhere this pass); the world of copies keeps
 * none, as it keeps no file. The fields kept for later waves (the sky's, Light and shadow's `light`) are refused from a put
 * as fields this build does not write, and carried across one from the file as it stands (`locationsWithExtras`).
 */
export const locationsKind: EditKind<LocationRow> = {
  kind: 'locations',
  group: null,
  groundOnly: false,
  most: LOCATION_LIMITS.rows,
  idOk: isLocationId,
  idWords: 'its id is world (the world row) or a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)',
  open(text, world, wk) {
    if (text === null) return { rows: [], read: null, text: null };
    const file = locationsFile(world);
    const raws: Record<string, unknown>[] = [];
    const read = readLocationsFile(text, world, wk, raws);
    if (read.problem) return `${file} does not read (${read.problem}): mend it by hand first`;
    if (read.skipped.length) return `${file} holds rows this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
    return { rows: read.rows.map((row, i) => ({ row, raw: raws[i] })), read, text };
  },
  clean(asked, id, stamp) {
    const unknown: string[] = [];
    const row = readLocationRow({ ...asked, id, at: stamp }, unknown);
    if (typeof row === 'string') return row;
    if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
    return row;
  },
  parse: (v) => readLocationRow(v),
  same: sameLocationRow,
  extras: locationsWithExtras,
  text: (world, frame, rows) => locationsFileText(world, frame, rows),
  read: (text, world, wk) => readLocationsFile(text, world, wk),
  mint: (asked, taken) => mintLocationId(typeof asked.name === 'string' ? asked.name : typeof asked.kind === 'string' ? asked.kind : 'place', taken),
  file: locationsFile,
};

/** The locations file for a world, as the owner reads it. */
function locationsFile(world: string): string {
  return `public/${editFilePath('locations', world)}`;
}

/**
 * What a world takes away (Map-maker II's twelfth wave, `src/story/removals.ts`): a row named by what it takes away (an
 * object by its content key, a template, a person by its key, a site by its key, a zone by an id of its own minted from its
 * name where a put names none), checked as the reader checks it. Every world's, a space zone's (in the game's frame) and the
 * world of copies' among them: a copy's crew member and a copy's own object are taken away there, where nothing else is
 * written (Map-maker I §2.9).
 */
export const removedKind: EditKind<RemovalRow> = {
  kind: 'removed',
  group: null,
  groundOnly: false,
  most: REMOVAL_LIMITS.rows,
  idOk: isRemovalId,
  idWords: 'its id names what it takes away: o:<template>@x,y,z, t:<template>, p:<key>, s:<world>:<i>:<j> or z:<id>',
  open(text, world, wk) {
    if (text === null) return { rows: [], read: null, text: null };
    const file = removedFile(world);
    const raws: Record<string, unknown>[] = [];
    const read = readRemovalsFile(text, world, wk, raws);
    if (read.problem) return `${file} does not read (${read.problem}): mend it by hand first`;
    if (read.skipped.length) return `${file} holds rows this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
    return { rows: read.rows.map((row, i) => ({ row, raw: raws[i] })), read, text };
  },
  clean(asked, id, stamp) {
    const unknown: string[] = [];
    const row = readRemovalRow({ ...asked, id, at: stamp }, unknown);
    if (typeof row === 'string') return row;
    if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
    return row;
  },
  parse: (v) => readRemovalRow(v),
  same: sameRemovalRow,
  extras: removalWithExtras,
  text: (world, frame, rows) => removalsFileText(world, frame, rows),
  read: (text, world, wk) => readRemovalsFile(text, world, wk),
  // Only a zone is minted (from its name): every other row is named by what it takes away.
  mint: (asked, taken) => mintZoneId(typeof asked.name === 'string' ? asked.name : 'zone', taken),
  file: removedFile,
};

/** The removal file for a world, as the owner reads it. */
function removedFile(world: string): string {
  return `public/${editFilePath('removed', world)}`;
}

/**
 * The owner's own people (Map-maker II's twelfth wave, `src/story/placedPeople.ts`): a row a person, named by an id of its
 * own (minted from its name, else its body), every world's but the world of copies'.
 */
export const peopleKind: EditKind<PlacedPersonRow> = {
  kind: 'people',
  group: null,
  groundOnly: false,
  most: PEOPLE_LIMITS.rows,
  idOk: isPersonId,
  idWords: 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)',
  open(text, world, wk) {
    if (text === null) return { rows: [], read: null, text: null };
    const file = peopleFile(world);
    const raws: Record<string, unknown>[] = [];
    const read = readPeopleFile(text, world, wk, raws);
    if (read.problem) return `${file} does not read (${read.problem}): mend it by hand first`;
    if (read.skipped.length) return `${file} holds rows this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
    return { rows: read.rows.map((row, i) => ({ row, raw: raws[i] })), read, text };
  },
  clean(asked, id, stamp) {
    const unknown: string[] = [];
    const row = readPersonRow({ ...asked, id, at: stamp }, unknown);
    if (typeof row === 'string') return row;
    if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
    return row;
  },
  parse: (v) => readPersonRow(v),
  same: samePersonRow,
  extras: personWithExtras,
  text: (world, frame, rows) => peopleFileText(world, frame, rows),
  read: (text, world, wk) => readPeopleFile(text, world, wk),
  mint: (asked, taken) => mintPersonId(typeof asked.name === 'string' ? asked.name : typeof asked.body === 'string' ? asked.body : 'person', taken),
  file: peopleFile,
};

/** The people file for a world, as the owner reads it. */
function peopleFile(world: string): string {
  return `public/${editFilePath('people', world)}`;
}

/**
 * The owner's shared walk-through file (`public/placements/solid.json`, the map fixes' third wave, `walkThrough.ts`), its
 * editor over it from Map-maker II's twelfth wave: a template a row, keyed by the template itself, its word `solid`. One file
 * every world reads, written in its own order (a new template after the rest), never stamped with a time (the owner's file
 * carries none), so a put and its undo give the file back byte for byte. Never minted: a row is named by its template.
 */
export const solidKind: EditKind<SolidFileRow> = {
  kind: 'solid',
  group: null,
  groundOnly: false,
  most: 100000,
  idOk: isSolidFileId,
  idWords: 'its id is an object template (object/...iff)',
  open(text) {
    if (text === null) return { rows: [], read: null, text: null };
    const raws: Record<string, unknown>[] = [];
    const read = readSolidFileRows(text, raws);
    if (read.problem) return `${solidFile()} does not read (${read.problem}): mend it by hand first`;
    if (read.skipped.length) return `${solidFile()} holds rows this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
    return { rows: read.rows.map((row, i) => ({ row, raw: raws[i] })), read, text };
  },
  // Never stamped: the time handed is not written.
  clean(asked, id) {
    return readSolidFileRow({ ...asked, id });
  },
  parse: (v) => readSolidFileRow(v),
  same: (a, b) => a.id === b.id && a.solid === b.solid,
  extras: (row, was) => {
    const out: Record<string, unknown> = { id: row.id, solid: row.solid };
    if (was) for (const k of Object.keys(was)) if (!(k in out) && k !== 'at') out[k] = was[k];
    return out;
  },
  text: (_world, _frame, rows) => solidFileText(rows),
  read: (text) => readSolidFileRows(text),
  file: () => solidFile(),
};

/** The shared walk-through file, as the owner reads it. */
function solidFile(): string {
  return `public/${editFilePath('solid', 'all')}`;
}

/**
 * The owner's own looks (Map-maker II's thirteenth wave, `editFiles/looksFile.ts`): one file every world shares
 * (`looks/all.json`), a look a row, named by an id of its own (minted from its name, else its species, where a put names
 * none), every world's alike -- a space zone and the world of copies among them, since a look is worn wherever a person
 * stands. The endpoint reads no wardrobe, so a piece the species cannot wear is refused by the dresser's own save, not here.
 */
export const looksKind: EditKind<OwnLookRow> = {
  kind: 'looks',
  group: null,
  groundOnly: false,
  most: LOOKS_LIMITS.rows,
  idOk: isLookId,
  idWords: 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)',
  open(text) {
    if (text === null) return { rows: [], read: null, text: null };
    const raws: Record<string, unknown>[] = [];
    const read = readLooksFile(text, raws);
    if (read.problem) return `${looksFile()} does not read (${read.problem}): mend it by hand first`;
    if (read.skipped.length) return `${looksFile()} holds rows this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
    return { rows: read.rows.map((row, i) => ({ row, raw: raws[i] })), read, text };
  },
  clean(asked, id, stamp) {
    const unknown: string[] = [];
    const row = readLookRow({ ...asked, id, at: stamp }, unknown);
    if (typeof row === 'string') return row;
    if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
    return row;
  },
  parse: (v) => readLookRow(v),
  same: sameLookRow,
  extras: lookWithExtras,
  text: (_world, _frame, rows) => looksFileText(rows),
  read: (text) => readLooksFile(text),
  mint: (asked, taken) => mintLookId(typeof asked.name === 'string' && asked.name ? asked.name : typeof asked.species === 'string' ? asked.species : 'look', taken),
  file: () => looksFile(),
};

/** The shared looks file, as the owner reads it. */
function looksFile(): string {
  return `public/${editFilePath('looks', 'all')}`;
}

/**
 * The rooms' lights edited (Map-maker II's wave of the rooms' lights, `editFiles/lightsFile.ts`): a world's file (`lights`, one
 * copy's and every copy on this world's rows, and lights standing outdoors) and the shared one (`lightsAll`, every copy
 * everywhere's, `lights.json`), a row an edit, a fill or a light added, named by an id of its own (minted from its name, else
 * its kind, where a put names none; the shared file's begin `all-`). Every world's, a space zone's (its outdoor rows in the
 * game's frame) and the world of copies' among them: a dungeon's rooms are rooms.
 */
function lightsKindOf(kind: 'lights' | 'lightsAll'): EditKind<LightRow> {
  const shared = kind === 'lightsAll';
  const file = (world: string): string => `public/${editFilePath(kind, shared ? 'all' : world)}`;
  return {
    kind,
    group: null,
    groundOnly: false,
    most: LIGHTS_LIMITS.rows,
    idOk: (id: unknown): id is string => isLightId(id, shared),
    idWords: shared ? `its id is ${ALL_ID_PREFIX} and then a-z, 0-9, _ and - (64 at most)` : `its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit, never ${ALL_ID_PREFIX})`,
    open(text, world, wk) {
      if (text === null) return { rows: [], read: null, text: null };
      const raws: Record<string, unknown>[] = [];
      const read = readLightsFile(text, shared ? null : world, wk, raws);
      if (read.problem) return `${file(world)} does not read (${read.problem}): mend it by hand first`;
      if (read.skipped.length) return `${file(world)} holds rows this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
      return { rows: read.rows.map((row, i) => ({ row, raw: raws[i] })), read, text };
    },
    clean(asked, id, stamp) {
      const unknown: string[] = [];
      const row = readLightRow({ ...asked, id, at: stamp }, shared, unknown);
      if (typeof row === 'string') return row;
      if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
      return row;
    },
    parse: (v) => readLightRow(v, shared),
    same: sameLightRow,
    extras: lightWithExtras,
    text: (world, frame, rows) => lightsFileText(shared ? null : world, frame, rows),
    read: (text, world, wk) => readLightsFile(text, shared ? null : world, wk),
    mint: (asked, taken) => mintLightId(typeof asked.name === 'string' && asked.name ? asked.name : typeof asked.kind === 'string' ? asked.kind : 'light', taken, shared),
    file,
  };
}
export const lightsKind = lightsKindOf('lights');
export const lightsAllKind = lightsKindOf('lightsAll');

/** Two tracks that race and read the same: the tracks endpoint's own likeness (`trackEdits.ts`). */
function sameTrackRow(a: TrackDef, b: TrackDef): boolean {
  return a.id === b.id && trackHash(a) === trackHash(b) && a.name === b.name && a.note === b.note && a.at === b.at;
}

/** A track's own fields, which a track written over one keeps nothing of; anything else the one it replaces held is kept. */
const TRACK_OWN = new Set(['id', 'name', 'note', 'kind', 'laps', 'for', 'clear', 'grid', 'gates', 'at', 'course', 'walls']);

/** A cleaned track to write, carrying what the track it replaces held at its head that this build does not read. */
function trackWithExtras(row: TrackDef, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (was) for (const k of Object.keys(was)) if (!TRACK_OWN.has(k) && !(k in out)) out[k] = was[k];
  return out;
}

/**
 * Whether a field this build does not read is one it would drop on writing (§2.2 of the race drawer's design): any field of
 * a gate, of the grid, of a course or of a wall or its point (the third wave's), which the writer writes field by field, where a field at a track's head is kept on its
 * head line. Answers the first such field, as `<id>.<where>`, or null. The reader names a gate's field `<id>.gates[<i>].<field>`:
 * after the bracket a dot follows, and between `]` and `.` there is no word boundary, so the pattern ends in a dot (or the
 * name's end), never `\b`, which let every gate's field through and wrote it lossy.
 */
export function droppedField(unknown: readonly string[]): string | null {
  return unknown.find((u) => /^[^.]+\.(grid|gates\[\d+\]|course|walls\[\d+\])(\.|$)/.test(u)) ?? null;
}

/** The track file for a world, as the owner reads it. */
function tracksFile(world: string): string {
  return `public/${outsideFilePath('tracks', world)}`;
}

/**
 * A world's tracks (the race drawer's first wave, `src/race/trackFile.ts`): a track a row, named by its id, read, cleaned,
 * written and held as the tracks endpoint holds one (`applyTrackOp`: its fields this build does not read refused on a put,
 * the head's carried over from the track it replaces), so its drawn course and its gates are written through the batch
 * and an edit of them is one undo entry. Kept outside the placements folder (`public/tracks/`, `OUTSIDE_EDIT_FILES`). Every
 * world's but the copies', a space zone's among them (its gate tracks; a course there is refused by the reader). A file
 * holding a track whose gates, grid or course carry a field this build does not read is refused for writing, never written
 * lossy: a later pass's gate rules are never dropped by an older page's save. No id is minted: the tool names a new track.
 */
export const tracksKind: EditKind<TrackDef> = {
  kind: 'tracks',
  group: null,
  groundOnly: false,
  most: TRACK_LIMITS.tracks,
  idOk: isTrackId,
  idWords: 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)',
  open(text, world, wk) {
    if (text === null) return { rows: [], read: null, text: null };
    const file = tracksFile(world);
    // One parse of the file: each track read beside the very object it was read from (the reader skips none here: a skip
    // refuses the file below).
    const { read, raws } = readTrackFileRaw(text, world, wk);
    if (read.problem) return `${file} does not read (${read.problem}): mend it by hand first`;
    if (read.skipped.length) return `${file} holds tracks this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`;
    const lost = droppedField(read.unknown);
    if (lost) return `${file}: this build would drop ${lost.slice(lost.indexOf('.') + 1)}: update first`;
    return { rows: read.tracks.map((row, i) => ({ row, raw: raws[i] })), read: { rows: read.tracks }, text };
  },
  clean(asked, id, stamp, _ctx, wk) {
    const unknown: string[] = [];
    const row = readTrack({ ...asked, id, at: stamp }, unknown, TRACK_LIMITS.gatesLeast, wk ?? 'ground');
    if (typeof row === 'string') return row;
    if (unknown.length) return `it carries fields this build does not write: ${unknown.join(', ')}`;
    return row;
  },
  parse: (v) => readTrack(v),
  same: sameTrackRow,
  extras: trackWithExtras,
  text: (world, frame, rows) => trackFileText(world, frame, rows as unknown as TrackDef[]),
  read: (text, world, wk) => {
    const r = readTrackFile(text, world, wk);
    return { rows: r.tracks, skipped: r.skipped, problem: r.problem };
  },
  file: tracksFile,
};

/** The kinds kept outside the placements folder, by name (`OUTSIDE_EDIT_FILES`). */
export const OUTSIDE_KINDS: Record<OutsideFileKind, EditKind<EditRow>> = {
  tracks: tracksKind as unknown as EditKind<EditRow>,
};

/** The kind a batch's edit names: a placements kind (`EDIT_KINDS`) or an outside one (`OUTSIDE_KINDS`); undefined for a kind not written yet. */
export function batchKindOf(l: BatchFileKind): EditKind<EditRow> | undefined {
  return Object.hasOwn(OUTSIDE_KINDS, l) ? OUTSIDE_KINDS[l as OutsideFileKind] : EDIT_KINDS[l as EditFileKind];
}

/**
 * Whether a refusal is an endpoint's from before the tracks went through the batch (the race drawer's first wave), which a
 * dev server not restarted keeps: it names the kinds it knew, ending in "lights or lightsAll", where today's end in "lightsAll
 * or tracks". What the tool and the Gates view say of it: stop the dev server and start it again.
 */
export function olderTracksEndpoint(why: string): boolean {
  return /'s file is story, world, removed, people, heights, paint, water, locations, looks, solid, lights or lightsAll$/.test(why);
}

/** The words for it (the editor's own `OLDER_ENDPOINT`'s, said for the tracks). */
export const TRACKS_OLDER_ENDPOINT = 'the dev server is running an older endpoint, from before tracks were written through the batch: stop npm run dev and start it again (its own restart keeps the old one)';

/**
 * Every kind the batch writes now, by name: the two row layers, from Map-maker II's first wave the heights, from its
 * second the paint, from its fifth the water, from its eighth the places, from its twelfth what is taken away, the people
 * and the shared walk-through file, and from its thirteenth the looks. A kind named in `EDIT_FILE_KINDS` and missing here
 * is refused in its wave's words (`NOT_YET`).
 */
export const EDIT_KINDS: Partial<Record<EditFileKind, EditKind<EditRow>>> = {
  story: ROW_KINDS.story as unknown as EditKind<EditRow>,
  world: ROW_KINDS.world as unknown as EditKind<EditRow>,
  heights: heightsKind as unknown as EditKind<EditRow>,
  paint: paintKind as unknown as EditKind<EditRow>,
  water: waterKind as unknown as EditKind<EditRow>,
  locations: locationsKind as unknown as EditKind<EditRow>,
  removed: removedKind as unknown as EditKind<EditRow>,
  people: peopleKind as unknown as EditKind<EditRow>,
  solid: solidKind as unknown as EditKind<EditRow>,
  looks: looksKind as unknown as EditKind<EditRow>,
  lights: lightsKind as unknown as EditKind<EditRow>,
  lightsAll: lightsAllKind as unknown as EditKind<EditRow>,
};

/**
 * The kinds the dungeons' world of copies takes (Map-maker I §2.9): a copy's crew member and its own objects taken away, and
 * (Map-maker II's thirteenth wave) the looks every world shares, which are no world's own and are saved wherever the editor
 * stands; and (the wave of the rooms' lights) the rooms' lights, a dungeon's rooms being rooms like any other's.
 */
export const COPIES_KINDS: readonly EditFileKind[] = ['removed', 'looks', 'lights', 'lightsAll'];

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
export function applyPlacementBatch(o: Record<string, unknown>, current: Partial<Record<BatchFileKind, string | null>>, ctx: PlacementCtx): PlacementAnswer {
  if (typeof o.world !== 'string' || !WORLD.test(o.world)) return no(400, 'its world is a pack id: a-z, 0-9 and _, 40 at most');
  const world = o.world;
  const wk = ctx.worlds.get(world);
  if (!wk) return no(404, `there is no world called ${world}`);
  const edits = o.edits;
  if (!Array.isArray(edits) || !edits.length) return no(400, 'a batch carries a list of edits');
  if (edits.length > BATCH_MOST) return no(413, `a batch is ${BATCH_MOST} edits at most`);
  // The world of copies takes what is taken away and nothing else (Map-maker II's twelfth wave): every other kind refused
  // there, edit by edit, before any file is read, in the very words it always was.
  if (wk === 'copies') {
    for (const e of edits as (BatchEdit | null)[]) {
      if (!e || typeof e !== 'object' || !(COPIES_KINDS as readonly BatchFileKind[]).includes(e.file)) return no(409, "nothing stands for good in the dungeons' world of copies");
    }
  }
  const readKind = wk === 'space' ? 'space' : 'ground';
  const frame = wk === 'space' ? 'game' : 'raw';
  // Each file a kind keeps, opened the first time an edit names it (the two row layers always, as before the kinds).
  const held = new Map<BatchFileKind, Held<EditRow>>();
  // Each file's rows by id, kept in step with the list, so a batch of thousands is linear.
  const index = new Map<BatchFileKind, Map<string, number>>();
  // Rows taken out wait to be spliced out together, once, at the end: a splice an edit is quadratic in a big file.
  const gone = new Map<BatchFileKind, Set<number>>();
  const put = new Map<BatchFileKind, Map<string, EditRow>>();
  const deleted = new Map<BatchFileKind, Set<string>>();
  const touched = new Set<BatchFileKind>();
  /** The ids taken in each group of kinds that share theirs (the two row layers'), or in a kind's own. */
  const taken = new Map<string, Set<string>>();
  const groupOf = (k: EditKind<EditRow>): string => k.group ?? k.kind;
  const openKind = (kind: BatchFileKind, k: EditKind<EditRow>): string | null => {
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
  const heldElsewhere = (kind: BatchFileKind, k: EditKind<EditRow>, id: string): BatchFileKind | null => {
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
    // Every kind a batch may name: the placements folder's, then the ones kept outside it (the race drawer's tracks).
    if (!(BATCH_FILE_KINDS as readonly unknown[]).includes(e.file)) return no(400, `${at}'s file is ${BATCH_FILE_KINDS.slice(0, -1).join(', ')} or ${BATCH_FILE_KINDS[BATCH_FILE_KINDS.length - 1]}`);
    const l: BatchFileKind = e.file;
    const k = batchKindOf(l);
    if (!k) return no(400, `${at}: the ${l} file is ${NOT_YET[l as EditFileKind] ?? 'a later wave\'s'}, which this endpoint does not write yet`);
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
    const row = k.clean(asked, id, stamp, ctx, readKind);
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
  const writes: { layer: BatchFileKind; text: string | null }[] = [];
  const files: Partial<Record<BatchFileKind, BatchFileAnswer<EditRow>>> = {};
  // In the order the kinds are named, so the two row layers come first and in their old order, and the outside kinds last.
  for (const l of BATCH_FILE_KINDS) {
    if (!touched.has(l)) continue;
    const k = batchKindOf(l)!;
    const h = held.get(l)!;
    const gn = gone.get(l)!;
    if (gn.size) h.rows = h.rows.filter((_, i) => !gn.has(i));
    const unwhole = k.whole?.(h.rows.map((e) => e.row)) ?? null;
    if (unwhole) return no(409, `${k.file(world)}: ${unwhole}`);
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
function writeKindBack(k: EditKind<EditRow>, h: Held<EditRow>, l: BatchFileKind, world: string, frame: 'raw' | 'game', readKind: 'ground' | 'space', ctx: PlacementCtx): { write: { layer: BatchFileKind; text: string | null } | null } | string {
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
