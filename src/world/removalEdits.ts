// The changes the removal file takes (Map-maker II's twelfth wave), worked out once for the console (`__debug.removals`) and
// the world editor (`EditorRemovals`): a world object hidden or shown again, the owner's switch on one thing or on this
// world's models, a person or a site taken away or given back, a no-spawn zone put down or taken up. Each is a row before and
// after (null for none), checked by the file's own reader before anything is sent, so what the endpoint writes is what the
// game reads; an object row that would say nothing more is taken out rather than written empty.
//
// Pure: imports the story folder's reader and a type. Rule for this file (node runs it with type stripping): every import
// with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { ZONE_KEEPS, mintZoneId, readRemovalRow, removalKindOf, type RemovalRow, type ZoneKeep, type ZoneShapeRow } from '../story/removals.ts';
import type { BatchEdit } from './placementEdits.ts';

/** One row of the file before and after a change (null for none). */
export interface RemovalChange {
  id: string;
  before: RemovalRow | null;
  after: RemovalRow | null;
}

/** A row by its id in the rows in force, or null. */
export function removalRowOf(rows: readonly RemovalRow[], id: string): RemovalRow | null {
  for (const r of rows) if (r.id === id) return r;
  return null;
}

/** A draft read by the file's own reader: the row, or why it is refused. The row's `at` is the endpoint's to stamp. */
function cleaned(draft: Record<string, unknown>): RemovalRow | string {
  const { at: _at, ...rest } = draft;
  return readRemovalRow(rest);
}

/** An object row's change to a draft, taken out where it says nothing more. */
function objectChange(before: RemovalRow | null, id: string, draft: Record<string, unknown>): RemovalChange | string {
  if (draft.hide !== true && draft.solid === undefined) return before ? { id, before, after: null } : `${id} is not in this world's removal file`;
  const row = cleaned(draft);
  if (typeof row === 'string') return `${id}: ${row}`;
  return { id, before, after: row };
}

/** One of the world's own objects hidden for everyone (`ground` takes the ground its building's own layer flattened with it). */
export function hideChange(rows: readonly RemovalRow[], id: string, ground = false): RemovalChange | string {
  if (removalKindOf(id) !== 'object') return `${id} is no object's key (o:<template>@x,y,z)`;
  const before = removalRowOf(rows, id);
  const draft: Record<string, unknown> = { ...(before ?? {}), id, hide: true };
  if (ground) draft.ground = 'drop';
  else delete draft.ground;
  return objectChange(before, id, draft);
}

/** One hidden object shown again (its switch on being solid, where it has one, kept). */
export function unhideChange(rows: readonly RemovalRow[], id: string): RemovalChange | string {
  const before = removalRowOf(rows, id);
  if (!before || !before.hide) return `${id} is not hidden here`;
  const draft: Record<string, unknown> = { ...before };
  delete draft.hide;
  delete draft.ground;
  return objectChange(before, id, draft);
}

/**
 * The owner's switch on one thing (an object's key) or on this world's every copy of a model (`t:<template>`): solid (true),
 * walked through (false), or null to take the switch off (the rules below it decide again).
 */
export function solidChange(rows: readonly RemovalRow[], id: string, solid: boolean | null): RemovalChange | string {
  const kind = removalKindOf(id);
  if (kind !== 'object' && kind !== 'template') return `${id} names neither a thing (o:...) nor a model (t:...)`;
  const before = removalRowOf(rows, id);
  const draft: Record<string, unknown> = { ...(before ?? {}), id };
  if (solid === null) delete draft.solid;
  else draft.solid = solid;
  if (kind === 'object') return objectChange(before, id, draft);
  if (solid === null) return before ? { id, before, after: null } : `${id} switches nothing here`;
  const row = cleaned(draft);
  return typeof row === 'string' ? `${id}: ${row}` : { id, before, after: row };
}

/** One of the people taken away by its row's key, or given back (`restore`). */
export function personChange(rows: readonly RemovalRow[], key: string, restore = false): RemovalChange | string {
  const id = `p:${key}`;
  const before = removalRowOf(rows, id);
  if (restore) return before ? { id, before, after: null } : `${key} is not taken away here`;
  if (before) return `${key} is taken away already`;
  const row = cleaned({ id });
  return typeof row === 'string' ? `${key}: ${row}` : { id, before: null, after: row };
}

/** One of the wildlife's sites taken away by its key (`<world>:<i>:<j>`), or given back. */
export function siteChange(rows: readonly RemovalRow[], key: string, restore = false): RemovalChange | string {
  const id = `s:${key}`;
  const before = removalRowOf(rows, id);
  if (restore) return before ? { id, before, after: null } : `${key} is not taken away here`;
  if (before) return `${key} is taken away already`;
  const row = cleaned({ id });
  return typeof row === 'string' ? `${key}: ${row}` : { id, before: null, after: row };
}

/** A centimetre, as the file keeps every point (divided by the steps a metre). */
function cm(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A zone's shape to the centimetre, in the file's frame. */
export function zoneCentimetres(s: ZoneShapeRow): ZoneShapeRow {
  if (s.kind === 'circle') return { kind: 'circle', c: [cm(s.c[0]), cm(s.c[1])], r: cm(s.r) };
  if (s.kind === 'rect') return { kind: 'rect', min: [cm(s.min[0]), cm(s.min[1])], max: [cm(s.max[0]), cm(s.max[1])] };
  return { kind: 'poly', pts: s.pts.map((p) => [cm(p[0]), cm(p[1])] as [number, number]) };
}

/** A new no-spawn zone of a shape (the file's frame), keeping `keeps` (all three for none), named `name` (`Zone <n>` for none). */
export function zoneChange(rows: readonly RemovalRow[], shape: ZoneShapeRow, keeps: readonly string[] | null, name: string | null): RemovalChange | string {
  const taken = new Set(rows.map((r) => r.id));
  const n = rows.filter((r) => r.id.startsWith('z:')).length + 1;
  const words = (name ?? '').trim() || `Zone ${n}`;
  const id = mintZoneId(words, taken);
  const draft: Record<string, unknown> = { id, name: words, shape: zoneCentimetres(shape) };
  if (keeps && keeps.length && keeps.length < ZONE_KEEPS.length) draft.keeps = [...keeps];
  const row = cleaned(draft);
  return typeof row === 'string' ? `the zone: ${row}` : { id, before: null, after: row };
}

/** A zone's fields written: its name, what it keeps, a new shape. */
export function zoneSetChange(rows: readonly RemovalRow[], id: string, fields: { name?: string | null; keeps?: readonly ZoneKeep[] | null; shape?: ZoneShapeRow }): RemovalChange | string {
  const before = removalRowOf(rows, id);
  if (!before || !id.startsWith('z:')) return `no zone ${id} here`;
  const draft: Record<string, unknown> = { ...before };
  if ('name' in fields) {
    const v = (fields.name ?? '').trim();
    if (v) draft.name = v;
    else delete draft.name;
  }
  if ('keeps' in fields) {
    const k = fields.keeps ?? [];
    if (k.length && k.length < ZONE_KEEPS.length) draft.keeps = [...k];
    else delete draft.keeps;
  }
  if (fields.shape) draft.shape = zoneCentimetres(fields.shape);
  const row = cleaned(draft);
  return typeof row === 'string' ? `${id}: ${row}` : { id, before, after: row };
}

/** A zone taken up. */
export function unzoneChange(rows: readonly RemovalRow[], id: string): RemovalChange | string {
  const before = removalRowOf(rows, id);
  return before && id.startsWith('z:') ? { id, before, after: null } : `no zone ${id} here`;
}

/** A change as one of the batch's edits, asking nothing of the row before (the console's): a put, or a delete. */
export function editOf(c: RemovalChange): BatchEdit {
  return c.after ? { file: 'removed', put: { ...c.after } } : { file: 'removed', delete: c.id };
}

/** What the console's writes need of the game. */
export interface RemovalEditCtx {
  rows: readonly RemovalRow[];
  /** The world editor's picked world thing, by its content key, or null. */
  picked(): string | null;
  /** Where the player stands, the game's frame. */
  here(): { x: number; z: number };
  /** A point of the game's frame in the file's (raw) frame, or null where the world has no frame for its rows. */
  toRaw(x: number, z: number): { x: number; z: number } | null;
  /** A place of ours by its id (its shape in the raw frame), for a zone made from it. */
  location(id: string): { id: string; name?: string; shape?: unknown } | null;
  space: boolean;
}

/** The console's asks as the batch's edits (`__debug.removals`), what each did said into `said`. */
export function makeRemovalEdits(ctx: RemovalEditCtx, o: Record<string, unknown>, said: string[]): BatchEdit[] {
  const out: BatchEdit[] = [];
  const take = (c: RemovalChange | string, words: string): void => {
    if (typeof c === 'string') said.push(c);
    else {
      out.push(editOf(c));
      said.push(words);
    }
  };
  const restore = o.restore === true;
  if (typeof o.hide === 'string') {
    const key = o.hide === 'selected' ? ctx.picked() : o.hide;
    if (!key) said.push("nothing of the world's own is picked in the world editor (its World's own filter on, a click on a thing)");
    else take(hideChange(ctx.rows, key, o.ground === 'drop'), `${key} hidden${o.ground === 'drop' ? ' with its ground (from the next arrival)' : ''}`);
  }
  if (typeof o.unhide === 'string') take(unhideChange(ctx.rows, o.unhide), `${o.unhide} shown again`);
  // The owner's walk-through switch (his amendment of 2026-10-31): `{ solid: { thing: '<key>' | 'selected', value } }` on one
  // thing, `{ solid: { model: '<template>', value } }` on this world's every copy of it, `{ solid: { everywhere: '<template>',
  // value } }` on every world's (the shared `solid.json`); `value` true solid, false walked through, null the switch off.
  const s = o.solid as { thing?: unknown; model?: unknown; everywhere?: unknown; value?: unknown } | undefined;
  if (s && typeof s === 'object') {
    const value = s.value === true ? true : s.value === false ? false : s.value === null ? null : undefined;
    const words = value === null ? 'by its rules again' : value ? 'solid' : 'walked through';
    if (value === undefined) said.push('a switch says value: true (solid), false (walked through) or null (off)');
    else if (typeof s.thing === 'string') {
      const key = s.thing === 'selected' ? ctx.picked() : s.thing;
      if (!key) said.push("nothing of the world's own is picked in the world editor");
      else take(solidChange(ctx.rows, key, value), `${key} ${words}`);
    } else if (typeof s.model === 'string') take(solidChange(ctx.rows, `t:${s.model}`, value), `${s.model} on this world ${words}`);
    else if (typeof s.everywhere === 'string') {
      if (!/^object\/[A-Za-z0-9_/.-]+\.iff$/.test(s.everywhere)) said.push(`${s.everywhere} is no object template`);
      else {
        out.push(value === null ? { file: 'solid', delete: s.everywhere } : { file: 'solid', put: { id: s.everywhere, solid: value } });
        said.push(`${s.everywhere} everywhere ${words}`);
      }
    } else said.push('a switch names a thing, a model or everywhere');
  }
  if (typeof o.person === 'string') take(personChange(ctx.rows, o.person, restore), restore ? `${o.person} given back` : `${o.person} taken away`);
  if (typeof o.site === 'string') take(siteChange(ctx.rows, o.site, restore), restore ? `site ${o.site} given back` : `site ${o.site} taken away`);
  if (typeof o.unzone === 'string') take(unzoneChange(ctx.rows, o.unzone), `${o.unzone} taken up`);
  const z = o.zone as Record<string, unknown> | undefined;
  if (z && typeof z === 'object') {
    if (ctx.space) said.push("a space zone's zones keep nothing this pass");
    else {
      const keeps = Array.isArray(z.keeps) ? (z.keeps as string[]) : null;
      const name = typeof z.name === 'string' ? z.name : null;
      let shape: ZoneShapeRow | string | null = null;
      if (typeof z.from === 'string') {
        const loc = ctx.location(z.from);
        if (!loc || !loc.shape) shape = `no place of ours ${z.from} on this world`;
        else shape = loc.shape as ZoneShapeRow;
        if (typeof shape !== 'string' && !name && loc?.name) z.name = loc.name;
      } else if (Array.isArray(z.pts)) {
        const pts: [number, number][] = [];
        for (const p of z.pts as [number, number][]) {
          const raw = ctx.toRaw(p[0], p[1]);
          if (raw) pts.push([raw.x, raw.z]);
        }
        shape = pts.length >= 3 ? { kind: 'poly', pts } : 'an outline is three points or more, and the world has a frame';
      } else if (Array.isArray(z.min) && Array.isArray(z.max)) {
        const a = ctx.toRaw((z.min as number[])[0], (z.min as number[])[1]);
        const b = ctx.toRaw((z.max as number[])[0], (z.max as number[])[1]);
        shape = a && b ? { kind: 'rect', min: [Math.min(a.x, b.x), Math.min(a.z, b.z)], max: [Math.max(a.x, b.x), Math.max(a.z, b.z)] } : 'the world has no frame for its rows';
      } else {
        const here = ctx.here();
        const x = typeof z.x === 'number' ? z.x : here.x;
        const zz = typeof z.z === 'number' ? z.z : here.z;
        const r = typeof z.r === 'number' ? z.r : NaN;
        const raw = ctx.toRaw(x, zz);
        shape = !raw ? 'the world has no frame for its rows' : r > 0 ? { kind: 'circle', c: [raw.x, raw.z], r } : 'a circle wants r, metres';
      }
      if (typeof shape === 'string') said.push(shape);
      else take(zoneChange(ctx.rows, shape, keeps, typeof z.name === 'string' ? z.name : name), 'a no-spawn zone put down');
    }
  }
  return out;
}
