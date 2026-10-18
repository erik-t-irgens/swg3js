// The track editor's rules: who may ask the dev server's one endpoint (`POST /__dev/tracks`) and what one ask does to
// a world's track file, and the editor's own edits to a track in hand (a gate moved to where you stand, one put in
// after another, nudged, resized, taken out). The glue that reads the request and writes the file is
// `tools/dev/tracksEndpoint.mjs`, which the dev server's config loads at the first ask and nothing else ever does;
// nothing here touches a file or a socket, so a node test runs every rule as it stands.
//
// **Who may ask** is the placements editor's rule exactly (`src/world/placementEdits.ts`): only a POST, from this very
// machine, from the game's own page (its Origin is the Host it asked), carrying the editor's own header, with a JSON
// body under the cap.
//
// **What an ask does.** One track at a time, never a whole file: the file is read as it stands, the one track put or
// taken out by its id, and the file written back, so a track written by hand meanwhile is never written over -- every
// other track goes back exactly as it was read, fields this build does not read included. A file that does not read,
// or holds a track that does not, is refused until it is mended by hand. A file left with no tracks is taken away
// rather than left empty.
//
// Pure: no fs, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

import { parseJsonc } from '../story/jsonc.ts';
import { fromGame, toGame } from '../story/placements.ts';
import { TRACK_LIMITS, isTrackId, readTrack, readTrackFile, trackFileText, trackHash, tracksPath, type TrackDef, type TrackGate, type TrackPlace, type TrackRead } from './trackFile.ts';

/** Every number of the endpoint, all ours. Read where the dev server runs it, and not moved from the browser. */
export const TRACKS_ENDPOINT_TUNE = {
  /** The largest body an ask may carry, bytes: a track of two hundred gates is about 30 KB. */
  bodyMax: 262144,
  /** How many times a file is put in place over one another program holds open, and how long apart, ms. */
  renameTries: 6,
  renameWaitMs: 50,
};

/** The header the editor's own asks carry (the placements editor's), and what it says for tracks. */
export const TRACK_EDITOR_HEADER = 'x-swg3js-dev';
export const TRACK_EDITOR_HEADER_VALUE = 'tracks';

/** What kind of world a pack id is: decides the frame its file is written in, and the copies take none. */
export type TrackWorldKind = 'ground' | 'space' | 'copies';

export interface TrackCtx {
  worlds: ReadonlyMap<string, TrackWorldKind>;
  now: number;
}

/** What is known of a request before its body is read. */
export interface TrackRequestMeta {
  method?: string | null;
  remoteAddress?: string | null;
  origin?: string | null;
  host?: string | null;
  dev?: string | null;
  contentType?: string | null;
  length?: number | null;
}

export interface TrackReplyOk {
  ok: true;
  op: 'put' | 'delete';
  id: string;
  file: string;
  /** The file as it reads now, or null once it is taken away. */
  read: TrackRead | null;
}
export interface TrackReplyNo {
  ok: false;
  why: string;
}
export type TrackReply = TrackReplyOk | TrackReplyNo;

/** An ask's answer: its status, its body, and what to write (the file's whole text, null to take it away, undefined for nothing). */
export interface TrackAnswer {
  status: number;
  body: TrackReply;
  write?: string | null;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const WORLD = /^[a-z0-9_]{1,40}$/;

/** The file a world's tracks are kept in, as the owner reads it. */
export function trackEditFile(world: string): string {
  return `public/${tracksPath(world)}`;
}

/** Whether a request may be heard at all, before its body is read: null, or the status and why not. */
export function refuseTrackRequest(meta: TrackRequestMeta, tune: typeof TRACKS_ENDPOINT_TUNE = TRACKS_ENDPOINT_TUNE): { status: number; why: string } | null {
  if ((meta.method ?? '').toUpperCase() !== 'POST') return { status: 405, why: 'the track editor takes a POST and nothing else' };
  if (!meta.remoteAddress || !LOOPBACK.has(meta.remoteAddress)) return { status: 403, why: 'the track editor answers this machine alone' };
  if (!meta.host || !meta.origin || meta.origin !== `http://${meta.host}`) return { status: 403, why: "the track editor answers the game's own page alone" };
  if (meta.dev !== TRACK_EDITOR_HEADER_VALUE) return { status: 403, why: 'the track editor answers its own asks alone' };
  if (!/^application\/json(\s*;|\s*$)/i.test(meta.contentType ?? '')) return { status: 415, why: 'an ask is JSON' };
  if (meta.length !== null && meta.length !== undefined && !(meta.length >= 0 && meta.length <= tune.bodyMax)) return { status: 413, why: `an ask is ${tune.bodyMax} bytes at most` };
  return null;
}

function no(status: number, why: string): TrackAnswer {
  return { status, body: { ok: false, why } };
}

/** Two tracks that race and read the same. */
function sameTrack(a: TrackDef, b: TrackDef): boolean {
  return a.id === b.id && trackHash(a) === trackHash(b) && a.name === b.name && a.note === b.note && a.at === b.at;
}

const OWN = new Set(['id', 'name', 'note', 'kind', 'laps', 'for', 'clear', 'grid', 'gates', 'at']);

/**
 * One ask against the world's file as it stands (`current`, its text or null for none): what to write and the answer.
 *
 * - `{ op: 'put', world, track }` puts a track in, or replaces the one of its id, stamped with `ctx.now`.
 * - `{ op: 'delete', world, id }` takes one out; the file goes with its last track.
 *
 * What is written must read back exactly as it was cleaned, or nothing is written. A refusal writes nothing.
 */
export function applyTrackOp(op: unknown, current: string | null, ctx: TrackCtx): TrackAnswer {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return no(400, 'an ask is an object');
  const o = op as Record<string, unknown>;
  if (o.op !== 'put' && o.op !== 'delete') return no(400, 'an ask is a put or a delete');
  if (typeof o.world !== 'string' || !WORLD.test(o.world)) return no(400, 'its world is a pack id: a-z, 0-9 and _, 40 at most');
  const world = o.world;
  const wk = ctx.worlds.get(world);
  if (!wk) return no(404, `there is no world called ${world}`);
  if (wk === 'copies') return no(409, "no track is laid in the dungeons' world of copies");
  const kind = wk === 'space' ? 'space' : 'ground';
  const frame = wk === 'space' ? 'game' : 'raw';
  const file = trackEditFile(world);
  // The file as it stands, every track beside the very object it was read from.
  let held: { t: TrackDef; raw: Record<string, unknown> }[] = [];
  if (current !== null) {
    const read = readTrackFile(current, world, kind);
    if (read.problem) return no(409, `${file} does not read (${read.problem}): mend it by hand first`);
    if (read.skipped.length) return no(409, `${file} holds tracks this build cannot read (${read.skipped.slice(0, 3).map((s) => `${s.id}: ${s.why}`).join('; ')}): mend them by hand first, or the editor would write over them`);
    const raws = ((parseJsonc(current).value as { tracks: unknown[] }).tracks ?? []) as Record<string, unknown>[];
    held = read.tracks.map((t, i) => ({ t, raw: raws[i] }));
  }
  let id: string;
  if (o.op === 'put') {
    const asked = o.track;
    if (!asked || typeof asked !== 'object' || Array.isArray(asked)) return no(400, 'a put carries a track');
    const unknown: string[] = [];
    const t = readTrack({ ...(asked as Record<string, unknown>), at: ctx.now }, unknown);
    if (typeof t === 'string') return no(400, `that track is refused: ${t}`);
    if (unknown.length) return no(400, `it carries fields this build does not write: ${unknown.join(', ')}`);
    const i = held.findIndex((e) => e.t.id === t.id);
    // The track it replaces keeps whatever it carried that this build does not read.
    const raw: Record<string, unknown> = { ...t };
    if (i >= 0) for (const k of Object.keys(held[i].raw)) if (!OWN.has(k) && !(k in raw)) raw[k] = held[i].raw[k];
    if (i >= 0) held[i] = { t, raw };
    else {
      if (held.length >= TRACK_LIMITS.tracks) return no(409, `${file} holds ${TRACK_LIMITS.tracks} tracks, as many as a file may`);
      held.push({ t, raw });
    }
    id = t.id;
  } else {
    if (!isTrackId(o.id)) return no(400, 'a delete names the track by its id');
    const i = held.findIndex((e) => e.t.id === o.id);
    if (i < 0) return no(404, `${o.id} is not in ${file}`);
    held.splice(i, 1);
    id = o.id;
  }
  if (!held.length) return { status: 200, body: { ok: true, op: o.op, id, file, read: null }, write: current !== null ? null : undefined };
  const text = trackFileText(world, frame, held.map((e) => e.raw as unknown as TrackDef));
  // Read back before anything is written: every track, the one written and the ones carried, as it was.
  const back = readTrackFile(text, world, kind);
  const lost = back.problem ?? (back.skipped.length ? back.skipped.map((s) => `${s.id}: ${s.why}`).join('; ') : null);
  if (lost) return no(500, `${file} would not read back as the editor wrote it (${lost})`);
  for (const e of held) {
    const b = back.tracks.find((t) => t.id === e.t.id);
    if (!b || !sameTrack(b, e.t)) return no(500, `${e.t.id} would not read back as the editor wrote it`);
  }
  return { status: 200, body: { ok: true, op: o.op, id, file, read: back }, write: text };
}

// ---- the editor's own edits to a track in hand -------------------------------------------------------------------
// Each answers a new track (the one handed over is never changed) or why not; every answer is a track the reader
// takes, so an edit can never leave the file the editor saves unreadable. Places are in the file's frame.

/** A place rounded to the centimetre and its turn to five places: what the editor writes, so a file stays readable. */
export function roundPlace<T extends TrackPlace>(p: T): T {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
  return { ...p, x: r2(p.x), y: r2(p.y), z: r2(p.z), q: [r5(p.q[0]), r5(p.q[1]), r5(p.q[2]), r5(p.q[3])] };
}

/** A track checked by the reader, or why it would be refused: every rule but the gates' least, which a track being laid has not reached yet. */
function checked(t: TrackDef): TrackDef | string {
  return readTrack(t, [], 0);
}

function gateIndex(t: TrackDef, i: number): string | null {
  return Number.isInteger(i) && i >= 0 && i < t.gates.length ? null : `there is no gate ${i}: the gates are 0 to ${t.gates.length - 1}`;
}

/** Gate `i` moved to a place (its window kept). */
export function moveGateTo(t: TrackDef, i: number, place: TrackPlace): TrackDef | string {
  const bad = gateIndex(t, i);
  if (bad) return bad;
  const gates = t.gates.map((g, k) => (k === i ? { ...roundPlace({ ...place, w: g.w, h: g.h }) } : g));
  return checked({ ...t, gates });
}

/** A new gate put in after gate `i` (`-1`: before gate 0), at a place and of a size. */
export function insertGate(t: TrackDef, i: number, place: TrackPlace, size: { w: number; h: number }): TrackDef | string {
  if (!(Number.isInteger(i) && i >= -1 && i < t.gates.length)) return `there is no gate ${i} to put one in after`;
  if (t.gates.length >= TRACK_LIMITS.gates) return `a track has ${TRACK_LIMITS.gates} gates at most`;
  const g: TrackGate = roundPlace({ ...place, w: clampW(size.w), h: clampH(size.h) });
  const gates = [...t.gates.slice(0, i + 1), g, ...t.gates.slice(i + 1)];
  return checked({ ...t, gates });
}

/** Gate `i` taken out. A track that has `gatesLeast` gates keeps them, so a file it is saved into stays one the reader takes. */
export function deleteGate(t: TrackDef, i: number): TrackDef | string {
  const bad = gateIndex(t, i);
  if (bad) return bad;
  if (t.gates.length === TRACK_LIMITS.gatesLeast) return `a track keeps ${TRACK_LIMITS.gatesLeast} gates at least`;
  return checked({ ...t, gates: t.gates.filter((_, k) => k !== i) });
}

const clampW = (w: number) => Math.min(TRACK_LIMITS.widthMost, Math.max(TRACK_LIMITS.widthLeast, Number.isFinite(w) ? w : TRACK_LIMITS.widthLeast));
const clampH = (h: number) => Math.min(TRACK_LIMITS.heightMost, Math.max(TRACK_LIMITS.heightLeast, Number.isFinite(h) ? h : TRACK_LIMITS.heightLeast));

/** Gate `i`'s window set (held to the reader's limits). */
export function resizeGate(t: TrackDef, i: number, size: { w?: number; h?: number }): TrackDef | string {
  const bad = gateIndex(t, i);
  if (bad) return bad;
  const gates = t.gates.map((g, k) => (k === i ? { ...g, w: size.w !== undefined ? clampW(size.w) : g.w, h: size.h !== undefined ? clampH(size.h) : g.h } : g));
  return checked({ ...t, gates });
}

/**
 * Gate `i` nudged in its own frame as a driver through it sees it: `x` metres to the right, `y` up, `z` ahead, and
 * turned `yaw` degrees to the left (its heading grows, as the game counts a heading). Worked in the game's frame and
 * carried back into the file's, so the buttons mean the same on every world whichever frame its file is in.
 */
export function nudgeGate(t: TrackDef, i: number, move: { x?: number; y?: number; z?: number; yaw?: number }, frame: 'raw' | 'game'): TrackDef | string {
  const bad = gateIndex(t, i);
  if (bad) return bad;
  const g = t.gates[i];
  const p = toGame(g, null, frame);
  const [qx, qy, qz, qw] = p.q;
  // The gate's own ahead (+Z turned) and the driver's right (-X turned: the models stand mirrored), on the ground.
  const ax = 2 * (qx * qz + qw * qy);
  const az = 1 - 2 * (qx * qx + qy * qy);
  const rx = -(1 - 2 * (qy * qy + qz * qz));
  const rz = -(2 * (qx * qz - qw * qy));
  const dx = move.x ?? 0;
  const dy = move.y ?? 0;
  const dz = move.z ?? 0;
  p.x += rx * dx + ax * dz;
  p.z += rz * dx + az * dz;
  p.y += dy;
  const yaw = ((move.yaw ?? 0) * Math.PI) / 180;
  if (yaw) {
    // A turn about the world's up, laid on first: q' = yaw * q.
    const s = Math.sin(yaw / 2);
    const c = Math.cos(yaw / 2);
    p.q = [c * qx + s * qz, c * qy + s * qw, c * qz - s * qx, c * qw - s * qy];
  }
  const back = fromGame(p, null, frame);
  return moveGateTo(t, i, back);
}
