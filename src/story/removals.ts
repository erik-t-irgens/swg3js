// What a world takes away, and what of it the owner walks through (Map-maker II's twelfth wave, Map-maker I's §2.9 as built
// here): `public/placements/removed/<world>.json`, read by every browser at an arrival and by the walk grid's bake, written
// only by the world editor's batch.
//
//   { "version": 1, "world": "tatooine", "frame": "raw",
//     "rows": [
//       { "id": "o:object/building/tatooine/shared_house.iff@3519.25,5,-4811.5", "hide": true, "at": 1793000000000 },
//       { "id": "o:object/building/kashyyyk/shared_fern.iff@12.5,3.1,40#2", "solid": true, "at": 1793000000000 },
//       { "id": "t:object/static/flora/shared_flora_bush.iff", "solid": false, "at": 1793000000000 },
//       { "id": "p:2b2c346e6abc", "at": 1793000000000 },
//       { "id": "s:tatooine:-3:12", "at": 1793000000000 },
//       { "id": "z:quiet-flats", "name": "Quiet flats", "shape": { "kind": "circle", "c": [-1200, -3400], "r": 80 }, "at": 1793000000000 }
//     ] }
//
// One list of rows, one a line sorted by id, as every file of this pass is, each row named by **what it takes away** and
// never by a number of its own (Map-maker II §2.13 item 3): the batch and undo key a row by its id, so the id is the
// identity.
//
// - `o:` one of the world's own placed objects, by its **content**: its template and its place in the layout's own frame
//   to the centimetre, and `#n` past the first of its exact twins in layout order, the very key the interior layout files'
//   pass gives a building (`buildingKey`, `tools/swg/ilf.mjs`); a piece of a building's own furniture is that building's key,
//   `/` and the piece's index in its file (the piece's own key, `ilf`). A layout index is no key: it moves whenever one
//   model fails to convert. Found again as the object of that template **nearest** the key's place within `HIDE_TUNE.match`
//   and then its `n`th exact twin (`ObjectKeyIndex.find`), so a key whose numbers a conversion rounded a hair the other way
//   still finds its object; one that finds nothing hides nothing and is named. Carrying `hide: true` the object stands
//   nowhere for any player (and with `ground: 'drop'` the ground its building's own terrain layer flattened goes with it);
//   carrying `solid` it stands, walked through (`false`) or solid (`true`) whatever its template's rules say, the owner's
//   switch on one thing (his amendment of 2026-10-31); a row may carry both.
// - `t:` a template, for **this world**: every copy of it solid or walked through (`solid`), between the thing's own row and
//   the shared file every world reads (`public/placements/solid.json`, `walkThrough.ts`). The narrowest row wins.
// - `p:` one of the world's standing people, by its row's own key: dormant for everyone, never taken off the list, so no
//   other `stood:` name moves (Map-maker I §2.9).
// - `s:` one of the wildlife's grid sites, by its key (`<world>:<i>:<j>`, `lairs.ts`): never laid.
// - `z:` a no-spawn zone, its shape the story's own (a circle, a rectangle or an outline, as a place of ours is drawn), in
//   the file's frame, with what it keeps away (`keeps`: absent, all three of `wild`, `people` and `ours`).
//
// **Backstops, not live** (`REMOVAL_LIMITS`): every build agrees on what a committed file means. A row that does not read is
// skipped and named, never the file.
//
// Pure: imports only this folder's JSONC reader. It ships with the server by the story's own rule (`STORY_SOURCE`) and
// `story:check` reads it. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no
// enum, no namespace, no constructor parameter properties.

import { parseJsonc } from './jsonc.ts';

export const REMOVALS_VERSION = 1;

/** The reader's backstops (ours), far past any use: every build holds a file to them alike, so none is live. */
export const REMOVAL_LIMITS = {
  /** Rows a file holds. */
  rows: 20000,
  /** Points a zone's outline holds. */
  points: 1024,
  /** Metres either way across the ground a zone's point may stand. */
  reach: 100000,
  /** The smallest a zone's circle may be, metres. */
  radiusLeast: 0.1,
  /** The longest a zone's name or a row's note may be. */
  name: 80,
  note: 400,
};

/**
 * How near a content key's own place an object of its template must stand to be the one it names, metres (Map-maker I's
 * `HIDE_TUNE.match`, [ours]): research4 measured only about sixty of 101,235 objects with a same-template neighbour inside
 * five centimetres that is not an exact twin. Live through `__debug.removals({ tune })`; a match is made at an arrival and
 * at each landing, never in a frame.
 */
export const HIDE_TUNE = { match: 0.05 };

/** What a zone keeps from standing in it: the wildlife's sites, the people of the data's (and his own), the people of ours. */
export type ZoneKeep = 'wild' | 'people' | 'ours';
export const ZONE_KEEPS: readonly ZoneKeep[] = ['wild', 'people', 'ours'];

/** A zone's shape: the story's own (`set.ts`'s `Shape`), as a place of ours writes one (`locationsFile.ts`). */
export type ZoneShapeRow = { kind: 'circle'; c: [number, number]; r: number } | { kind: 'rect'; min: [number, number]; max: [number, number] } | { kind: 'poly'; pts: [number, number][] };

/** One row of the file, as read and cleaned. */
export interface RemovalRow {
  id: string;
  /** An object row: taken away for everyone. */
  hide?: true;
  /** An object row: what its building's own terrain layer flattened goes with it (`'drop'`); absent, the ground stays as it was. */
  ground?: 'drop';
  /** An object or a template row: solid (`true`) or walked through (`false`), over every rule below it. */
  solid?: boolean;
  /** A zone row: what it keeps away; absent, all three. */
  keeps?: ZoneKeep[];
  /** A zone row's name, for the editor's lists. */
  name?: string;
  note?: string;
  /** A zone row's shape, in the file's frame. */
  shape?: ZoneShapeRow;
  at?: number;
}

/** What reading a file gave. */
export interface RemovalsRead {
  rows: RemovalRow[];
  skipped: { id: string; why: string }[];
  unknown: string[];
  problem: string | null;
}

/** A number written as the layout's own frame to the centimetre (`buildingKey`'s own spelling). */
const NUM = '-?\\d+(?:\\.\\d+)?';
const OBJECT_ID = new RegExp(`^o:(object/[A-Za-z0-9_/.-]+\\.iff)@(${NUM}),(${NUM}),(${NUM})(?:#(\\d+))?(?:/(\\d+))?$`);
const TEMPLATE_ID = /^t:(object\/[A-Za-z0-9_/.-]+\.iff)$/;
const PERSON_ID = /^p:([A-Za-z0-9_.:-]{1,80})$/;
const SITE_ID = /^s:([a-z0-9_]{1,40}:-?\d{1,6}:-?\d{1,6})$/;
const ZONE_ID = /^z:([a-z0-9][a-z0-9_-]{0,63})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** The fields a row may carry. */
const FIELDS = new Set(['id', 'hide', 'ground', 'solid', 'keeps', 'name', 'note', 'shape', 'at']);
/** The order a row's fields are written in: its switches first, a zone's long shape last. */
const ORDER: (keyof RemovalRow)[] = ['id', 'hide', 'ground', 'solid', 'keeps', 'name', 'note', 'shape', 'at'];

/** A row's kind by its id's first letter: an object, a template, a person, a site, a zone, or none. */
export type RemovalKind = 'object' | 'template' | 'person' | 'site' | 'zone';
export function removalKindOf(id: string): RemovalKind | null {
  if (OBJECT_ID.test(id)) return 'object';
  if (TEMPLATE_ID.test(id)) return 'template';
  if (PERSON_ID.test(id)) return 'person';
  if (SITE_ID.test(id)) return 'site';
  if (ZONE_ID.test(id)) return 'zone';
  return null;
}

/** Whether an id names a row of the file. */
export function isRemovalId(v: unknown): v is string {
  return typeof v === 'string' && removalKindOf(v) !== null;
}

/** A centimetre's number as the key writes it: rounded, and `-0` written `0`. */
function cm(v: number): string {
  const r = Math.round(v * 100) / 100;
  return (r === 0 ? 0 : r).toString();
}

/**
 * The content key of a placed object of the layout (`o:<template>@x,y,z`, the layout's own frame to the centimetre), and
 * `#n` past the first of its exact twins: the very spelling of the interior layout files' `buildingKey`.
 */
export function objectKey(template: string, x: number, y: number, z: number, n = 1): string {
  return `o:${template}@${cm(x)},${cm(y)},${cm(z)}${n > 1 ? `#${n}` : ''}`;
}

/** A content key taken apart: its template, its place, its twin's number (1 for the first) and a piece's index in its building's file. */
export function parseObjectKey(id: string): { template: string; x: number; y: number; z: number; n: number; piece: number | null } | null {
  const m = OBJECT_ID.exec(id);
  if (!m) return null;
  return { template: m[1], x: Number(m[2]), y: Number(m[3]), z: Number(m[4]), n: m[5] ? Math.max(1, Number(m[5])) : 1, piece: m[6] !== undefined ? Number(m[6]) : null };
}

/** The template a template row names, or null. */
export function templateOfRow(id: string): string | null {
  const m = TEMPLATE_ID.exec(id);
  return m ? m[1] : null;
}

/** The key a person row names, or null. */
export function personOfRow(id: string): string | null {
  const m = PERSON_ID.exec(id);
  return m ? m[1] : null;
}

/** The site key a site row names (`<world>:<i>:<j>`), or null. */
export function siteOfRow(id: string): string | null {
  const m = SITE_ID.exec(id);
  return m ? m[1] : null;
}

/** A fresh zone id from a name, unique among `taken`: `z:` and its words in lower case, joined by `-`, numbered where taken. */
export function mintZoneId(base: string, taken: ReadonlySet<string>): string {
  const stem = (base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'zone').slice(0, 56);
  const s = /^[a-z0-9]/.test(stem) ? stem : `zone-${stem}`;
  if (!taken.has(`z:${s}`)) return `z:${s}`;
  for (let n = 2; ; n++) {
    const id = `z:${s}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** A point read as `[x, z]` within the reach, or null. */
function pointOf(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [x, z] = v as unknown[];
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (Math.abs(x) > REMOVAL_LIMITS.reach || Math.abs(z) > REMOVAL_LIMITS.reach) return null;
  return [x, z];
}

/** A zone's shape read as the story and a place of ours read one (a rectangle's corners put in order), or why not. */
export function readZoneShape(v: unknown): ZoneShapeRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'its shape is { "kind": "circle", "c": [x, z], "r": n }, a rect { "min", "max" } or a poly { "pts" }';
  const o = v as Record<string, unknown>;
  const L = REMOVAL_LIMITS;
  if (o.kind === 'circle') {
    const c = pointOf(o.c);
    if (!c) return `a circle's middle is [x, z] within ${L.reach} m`;
    if (typeof o.r !== 'number' || !Number.isFinite(o.r) || o.r < L.radiusLeast || o.r > L.reach) return `a circle's radius is ${L.radiusLeast} to ${L.reach} m`;
    return { kind: 'circle', c, r: o.r };
  }
  if (o.kind === 'rect') {
    const a = pointOf(o.min);
    const b = pointOf(o.max);
    if (!a || !b) return 'a rect is "min": [x, z] and "max": [x, z]';
    const min: [number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
    const max: [number, number] = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    if (!(max[0] - min[0] > 0) || !(max[1] - min[1] > 0)) return 'a rect has an area';
    return { kind: 'rect', min, max };
  }
  if (o.kind === 'poly') {
    if (!Array.isArray(o.pts) || o.pts.length < 3) return 'a poly is three or more [x, z] points';
    if (o.pts.length > L.points) return `a poly has ${L.points} points at most`;
    const pts: [number, number][] = [];
    for (const p of o.pts) {
      const q = pointOf(p);
      if (!q) return `a poly's point is [x, z] within ${L.reach} m`;
      pts.push(q);
    }
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    if (!(Math.abs(area) > 1e-6)) return 'its outline has no area';
    return { kind: 'poly', pts };
  }
  return "a shape's kind is circle, rect or poly";
}

/** What a zone row keeps away: its own list, else all three. */
export function zoneKeeps(row: Pick<RemovalRow, 'keeps'>): readonly ZoneKeep[] {
  return row.keeps && row.keeps.length ? row.keeps : ZONE_KEEPS;
}

/**
 * One row cleaned, or why it is refused. A field another kind of row carries is refused (a person row naming a shape is a
 * mistake, not a row to guess at); one this build does not read is kept out and named in `unknown`.
 */
export function readRemovalRow(v: unknown, unknown: string[] = []): RemovalRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a row is an object';
  const o = v as Record<string, unknown>;
  if (!isRemovalId(o.id)) return 'its id names what it takes away: o:<template>@x,y,z, t:<template>, p:<key>, s:<world>:<i>:<j> or z:<id>';
  const id = o.id;
  const kind = removalKindOf(id)!;
  for (const k of Object.keys(o)) if (!FIELDS.has(k)) unknown.push(`${id}.${k}`);
  const row: RemovalRow = { id };
  const only = (field: string, kinds: RemovalKind[]): string | null => (o[field] !== undefined && !kinds.includes(kind) ? `a ${kind} row carries no ${field}` : null);
  for (const [f, k] of [['hide', ['object']], ['ground', ['object']], ['solid', ['object', 'template']], ['keeps', ['zone']], ['name', ['zone']], ['shape', ['zone']]] as [string, RemovalKind[]][]) {
    const why = only(f, k);
    if (why) return why;
  }
  if (o.hide !== undefined) {
    if (o.hide !== true) return 'hide is true, or absent';
    row.hide = true;
  }
  if (o.ground !== undefined) {
    if (o.ground !== 'drop') return "ground is 'drop', or absent";
    if (o.hide !== true) return "ground: 'drop' goes with a hide";
    row.ground = 'drop';
  }
  if (o.solid !== undefined) {
    if (typeof o.solid !== 'boolean') return 'solid is true or false';
    row.solid = o.solid;
  }
  if (kind === 'object' && row.hide === undefined && row.solid === undefined) return 'an object row hides it, or says whether it is solid';
  if (kind === 'template' && row.solid === undefined) return 'a template row says whether its every copy here is solid';
  if (kind === 'zone') {
    const s = readZoneShape(o.shape);
    if (typeof s === 'string') return s;
    row.shape = s;
    if (o.keeps !== undefined) {
      if (!Array.isArray(o.keeps) || !o.keeps.length) return `keeps is a list of ${ZONE_KEEPS.join(', ')}`;
      const keeps: ZoneKeep[] = [];
      for (const k of o.keeps) {
        if (!(ZONE_KEEPS as readonly unknown[]).includes(k)) return `keeps names ${ZONE_KEEPS.join(', ')} and nothing else`;
        if (!keeps.includes(k as ZoneKeep)) keeps.push(k as ZoneKeep);
      }
      // All three is the meaning of absent, and written so: one meaning, one spelling.
      if (keeps.length < ZONE_KEEPS.length) row.keeps = ZONE_KEEPS.filter((k) => keeps.includes(k));
    }
    if (o.name !== undefined) {
      if (typeof o.name !== 'string' || o.name.length > REMOVAL_LIMITS.name || CONTROL.test(o.name)) return `its name is words of ${REMOVAL_LIMITS.name} characters at most`;
      row.name = o.name;
    }
  }
  if (o.note !== undefined) {
    if (typeof o.note !== 'string' || o.note.length > REMOVAL_LIMITS.note) return `its note is words of ${REMOVAL_LIMITS.note} characters at most`;
    row.note = o.note;
  }
  if (o.at !== undefined) {
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0) return 'its at is a time in milliseconds';
    row.at = o.at;
  }
  return row;
}

/**
 * Read a world's file. `kindOfWorld` decides the frame the file must say it is in: a space zone's is the game's own, any
 * other world's the raw (the world of copies is written raw: its copies are ground). A file that does not read, or whose
 * header is not this world's, is refused whole; a bad row, a row past the cap and a second row under one id are skipped and
 * named. With `raws`, each row's very object is kept beside it (what the dev server's endpoint writes back as it found it).
 */
export function readRemovalsFile(text: string, world: string, kindOfWorld: 'ground' | 'space', raws?: Record<string, unknown>[]): RemovalsRead {
  const out: RemovalsRead = { rows: [], skipped: [], unknown: [], problem: null };
  const doc = parseJsonc(text);
  if (doc.error) {
    out.problem = `it does not read (line ${doc.error.line}, column ${doc.error.col}: ${doc.error.message})`;
    return out;
  }
  const v = doc.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    out.problem = 'it is not an object';
    return out;
  }
  const f = v as Record<string, unknown>;
  if (f.version !== REMOVALS_VERSION) {
    out.problem = `its version is not ${REMOVALS_VERSION}`;
    return out;
  }
  if (f.world !== world) {
    out.problem = `it says it is ${typeof f.world === 'string' ? f.world : 'no world'}'s, and its name says ${world}'s`;
    return out;
  }
  const frame = kindOfWorld === 'space' ? 'game' : 'raw';
  if (f.frame !== frame) {
    out.problem = `a ${kindOfWorld === 'space' ? 'space zone' : 'world on the ground'} is written in the ${frame} frame, and it says ${typeof f.frame === 'string' ? f.frame : 'none'}`;
    return out;
  }
  if (!Array.isArray(f.rows)) {
    out.problem = 'it has no rows list';
    return out;
  }
  const seen = new Set<string>();
  for (let i = 0; i < f.rows.length; i++) {
    const raw = f.rows[i];
    const named = raw && typeof raw === 'object' && isRemovalId((raw as { id?: unknown }).id) ? (raw as { id: string }).id : `#${i}`;
    if (out.rows.length >= REMOVAL_LIMITS.rows) {
      out.skipped.push({ id: named, why: `past the ${REMOVAL_LIMITS.rows} rows a file may hold` });
      continue;
    }
    const row = readRemovalRow(raw, out.unknown);
    if (typeof row === 'string') {
      out.skipped.push({ id: named, why: row });
      continue;
    }
    if (seen.has(row.id)) {
      out.skipped.push({ id: row.id, why: 'a second row under the same id' });
      continue;
    }
    seen.add(row.id);
    out.rows.push(row);
    raws?.push(raw as Record<string, unknown>);
  }
  return out;
}

/**
 * A whole file's text: its header a field a line, then one line a row, sorted by id, each row's fields in one fixed order;
 * a row handed over as the very object a file was read into keeps every field it carries that this build does not read,
 * after the rest.
 */
export function removalsFileText(world: string, frame: 'raw' | 'game', rows: readonly Record<string, unknown>[]): string {
  const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const ordered = new Set<string>(ORDER);
  const lines = sorted.map((r) => {
    const parts: string[] = [];
    for (const k of ORDER) if (r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    for (const k of Object.keys(r)) if (!ordered.has(k) && r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    return `    { ${parts.join(', ')} }`;
  });
  const body = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${REMOVALS_VERSION},\n  "world": ${JSON.stringify(world)},\n  "frame": ${JSON.stringify(frame)},\n  "rows": ${body}\n}\n`;
}

/**
 * A file's rows in force after a write's answer (the world editor's batch, landed by difference): the rows put laid over the
 * rows by id (a new id after the rest), the ids taken out dropped. Sorted by id, as every file of this pass is. Pure.
 */
export function landRows<T extends { id: string }>(rows: readonly T[], put: readonly T[], deleted: readonly string[]): T[] {
  const byId = new Map<string, T>();
  for (const r of rows) byId.set(r.id, r);
  for (const id of deleted) byId.delete(id);
  for (const r of put) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Two rows that take away and read the same. */
export function sameRemovalRow(a: RemovalRow, b: RemovalRow): boolean {
  return JSON.stringify(ORDER.map((k) => a[k] ?? null)) === JSON.stringify(ORDER.map((k) => b[k] ?? null));
}

/** A cleaned row to write, carrying what the row it replaces held that this build does not read. */
export function removalWithExtras(row: RemovalRow, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (was) for (const k of Object.keys(was)) if (!FIELDS.has(k) && !(k in out)) out[k] = was[k];
  return out;
}

// ---- finding the world's own objects by their content keys -----------------------------------------------------------

/** Just enough of a layout object to key it: its template, its place in the layout's own frame, and a piece's own key. */
export interface KeyedObject {
  template: string;
  x: number;
  y: number;
  z: number;
  /** A piece of a building's own furniture (`interiors.ts`): its key, which names it whatever its place. */
  ilf?: string;
  /** That piece's building's index in the same list, in a room or not: a hide of the building takes it (`compileRemovals`). */
  ilfRow?: number;
}

/**
 * The world's objects by their content keys, worked out once a world and asked at an arrival and at each landing, never in
 * a frame: a piece of a building's furniture by its own key; anything else as the object of that template **nearest** the
 * key's place within `match` (`HIDE_TUNE.match`), and then that object's `n`th exact twin in layout order (twins: one
 * template at one place to the centimetre). A key that finds nothing answers -1.
 */
export class ObjectKeyIndex {
  private readonly objects: readonly KeyedObject[];
  private byTemplate: Map<string, number[]> | null = null;
  private byPiece: Map<string, number> | null = null;

  constructor(objects: ReadonlyArray<KeyedObject>) {
    this.objects = objects;
  }

  private templates(): Map<string, number[]> {
    if (!this.byTemplate) {
      const m = new Map<string, number[]>();
      for (let i = 0; i < this.objects.length; i++) {
        const o = this.objects[i];
        if (o.ilf) continue;
        const list = m.get(o.template);
        if (list) list.push(i);
        else m.set(o.template, [i]);
      }
      this.byTemplate = m;
    }
    return this.byTemplate;
  }

  private pieces(): Map<string, number> {
    if (!this.byPiece) {
      const m = new Map<string, number>();
      for (let i = 0; i < this.objects.length; i++) {
        const k = this.objects[i].ilf;
        if (k && !m.has(k)) m.set(k, i);
      }
      this.byPiece = m;
    }
    return this.byPiece;
  }

  /** The index of the object an object row's id names, or -1. */
  find(id: string, match: number = HIDE_TUNE.match): number {
    const k = parseObjectKey(id);
    if (!k) return -1;
    // A piece's own key is its building's and its index (`o:<template>@x,y,z/<n>`), the row's id itself.
    if (k.piece !== null) return this.pieces().get(id) ?? -1;
    const list = this.templates().get(k.template);
    if (!list) return -1;
    let best = -1;
    let bestD = match * match;
    for (const i of list) {
      const o = this.objects[i];
      const d = (o.x - k.x) ** 2 + (o.y - k.y) ** 2 + (o.z - k.z) ** 2;
      // Nearest; a tie keeps the first in layout order.
      if (d < bestD || (d === bestD && best < 0)) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return -1;
    if (k.n === 1) return this.firstTwin(best);
    const twins = this.twinsOf(best);
    return twins[k.n - 1] ?? -1;
  }

  /**
   * The exact twins of an object in layout order, itself among them. A template's copies are grouped by their content key the
   * first time any of them is asked, once (`twins`), so asking every copy of a forest's one tree is one key a copy, never a
   * key of every copy for each.
   */
  private twinsOf(i: number): number[] {
    const o = this.objects[i];
    let groups = this.twins.get(o.template);
    if (!groups) {
      groups = new Map();
      for (const j of this.templates().get(o.template) ?? []) {
        const p = this.objects[j];
        const k = objectKey(p.template, p.x, p.y, p.z);
        const list = groups.get(k);
        if (list) list.push(j);
        else groups.set(k, [j]);
      }
      this.twins.set(o.template, groups);
    }
    return groups.get(objectKey(o.template, o.x, o.y, o.z)) ?? [];
  }
  private readonly twins = new Map<string, Map<string, number[]>>();

  private firstTwin(i: number): number {
    return this.twinsOf(i)[0] ?? i;
  }

  /** An object's own key: a piece's, else its content key with its twin's number. */
  keyOf(i: number): string {
    const o = this.objects[i];
    if (!o) return '';
    if (o.ilf) return o.ilf;
    const twins = this.twinsOf(i);
    return objectKey(o.template, o.x, o.y, o.z, Math.max(1, twins.indexOf(i) + 1));
  }
}

/**
 * What a landing of the removal file moves in the streamer (`World.landRemovals`), by difference between what the rows came to
 * before and after: the objects to stand again (hidden before, not now), the objects to take away (hidden now, not before),
 * the per-thing switches to take off (switched before, not now), the switches to set (new or moved, with their value), and the
 * templates whose row of this world moved (set, moved or taken off). Everything still hidden and every switch kept is in none
 * of them, so a landing never stands again what is still hidden nor drops a switch still in force. Pure.
 */
export interface RemovalLandingPlan {
  show: number[];
  hide: number[];
  unswitch: number[];
  switch: [number, boolean][];
  templatesMoved: Set<string>;
}

export function removalLandingPlan(before: Pick<CompiledRemovals, 'hidden' | 'solid' | 'templates'>, after: Pick<CompiledRemovals, 'hidden' | 'solid' | 'templates'>): RemovalLandingPlan {
  const plan: RemovalLandingPlan = { show: [], hide: [], unswitch: [], switch: [], templatesMoved: new Set() };
  for (const li of before.hidden) if (!after.hidden.has(li)) plan.show.push(li);
  for (const li of after.hidden) if (!before.hidden.has(li)) plan.hide.push(li);
  for (const li of before.solid.keys()) if (!after.solid.has(li)) plan.unswitch.push(li);
  for (const [li, v] of after.solid) if (before.solid.get(li) !== v) plan.switch.push([li, v]);
  for (const [t, v] of after.templates) if (before.templates.get(t) !== v) plan.templatesMoved.add(t);
  for (const t of before.templates.keys()) if (!after.templates.has(t)) plan.templatesMoved.add(t);
  return plan;
}

/** What a world's removal rows come to over its layout's objects: what each kind of reader asks. */
export interface CompiledRemovals {
  /** The layout indices taken away, and the object rows' ids beside them. */
  hidden: Set<number>;
  /** Those whose building's own terrain layer goes with them. */
  groundDrop: Set<number>;
  /** The owner's switch on one thing, by layout index. */
  solid: Map<number, boolean>;
  /** The owner's switch on every copy of a template here. */
  templates: Map<string, boolean>;
  /** The people taken away, by their rows' keys. */
  people: Set<string>;
  /** The wildlife's sites never laid, by key. */
  sites: Set<string>;
  /** The no-spawn zones, as read. */
  zones: RemovalRow[];
  /** Object rows whose key finds nothing in this layout, by id. */
  missing: string[];
  /** Each object row's id and the layout index it found (-1 for none). */
  found: Map<string, number>;
}

/** Nothing taken away: what a world with no file comes to. */
export function noRemovals(): CompiledRemovals {
  return { hidden: new Set(), groundDrop: new Set(), solid: new Map(), templates: new Map(), people: new Set(), sites: new Set(), zones: [], missing: [], found: new Map() };
}

/** Whether a compiled set takes nothing away and switches nothing. */
export function removalsEmpty(c: CompiledRemovals): boolean {
  return !c.hidden.size && !c.solid.size && !c.templates.size && !c.people.size && !c.sites.size && !c.zones.length;
}

/**
 * A world's rows over its layout's objects (`objects`, the very list the streamer files, its own furniture appended): each
 * object row matched by its content key (`ObjectKeyIndex.find`), a piece of a building's furniture by its own. A row that
 * finds nothing takes nothing away and is named in `missing`. `index` may be handed over to reuse one already made.
 */
export function compileRemovals(rows: readonly RemovalRow[], objects: readonly KeyedObject[], match: number = HIDE_TUNE.match, index: ObjectKeyIndex = new ObjectKeyIndex(objects)): CompiledRemovals {
  const out = noRemovals();
  for (const r of rows) {
    const kind = removalKindOf(r.id);
    if (kind === 'object') {
      const i = index.find(r.id, match);
      out.found.set(r.id, i);
      if (i < 0) {
        out.missing.push(r.id);
        continue;
      }
      if (r.hide) out.hidden.add(i);
      if (r.hide && r.ground === 'drop') out.groundDrop.add(i);
      if (r.solid !== undefined) out.solid.set(i, r.solid);
    } else if (kind === 'template') {
      const t = templateOfRow(r.id);
      if (t && r.solid !== undefined) out.templates.set(t, r.solid);
    } else if (kind === 'person') {
      const k = personOfRow(r.id);
      if (k) out.people.add(k);
    } else if (kind === 'site') {
      const s = siteOfRow(r.id);
      if (s) out.sites.add(s);
    } else if (kind === 'zone') out.zones.push(r);
  }
  // A building taken away takes every piece of its own furniture with it, one standing in no room as well as one in a room (a
  // thing in a room goes with its building by the snapshot's own word, `in`, which a piece in no room does not carry).
  if (out.hidden.size) {
    for (let i = 0; i < objects.length; i++) {
      const b = objects[i].ilfRow;
      if (b !== undefined && out.hidden.has(b)) out.hidden.add(i);
    }
  }
  return out;
}
