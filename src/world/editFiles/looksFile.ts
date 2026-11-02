// The owner's own looks (Map-maker II's thirteenth wave): `public/placements/looks/all.json`, one file every world shares, a
// row a look he dressed in the world editor's Looks tab, read at boot beside the mobile catalogue and merged into it as a
// dressed body of its own (`own:<id>`, src/world/mobiles/ownLooks.ts) that any placed person or story cast member can wear.
//
//   { "version": 1,
//     "rows": [
//       { "id": "farmhand-red", "from": "dressed_fs_village_farmer", "species": "human_male",
//         "morphs": { "blend_muscle": 0.4 }, "custom": { "index_color_skin": 6 },
//         "outfit": [ { "part": "jacket_s11_m_l0", "item": "jacket_s11", "wardrobe": "wardrobe/human_male", "values": { "index_color_1": 114 } } ],
//         "name": "Farmhand in red", "at": 1793000000000 }
//     ] }
//
// **A look is a dressed catalogue entry's own look and nothing else**: its species (the body, `characters/<species>/`), its
// shape sliders (`morphs`), its shared colours (`custom`, by bare name, as the catalogue keeps them) and its outfit, a piece a
// mesh (`part`, the wardrobe's own part name; `item`, the wardrobe's catalogue id; `wardrobe`, its folder under
// `assets-private/`; `values`, the piece's own colours by bare name, as `tintValues` keys a thing's) -- the very fields
// `buildLook` dresses a body by. `from` names the dressed catalogue entry whose size, move, stats, animation pack and flags it
// takes. It names catalogue, wardrobe and palette ids only, as a placement names models: content of ours, nothing of the
// game's carried.
//
// **A colour is clamped as the customizer takes it**: a whole number, from a colour carried whole's least (white) up to an
// index past every palette, whose last colour the customizer takes for anything past its end as it renders; a shape slider
// from nought to one, as `Character.setMorph` holds it. A piece the appearance table blocks for the species is refused in
// words wherever the cleaner is handed the wardrobe's word on it (the dresser's own save); the endpoint, which reads no
// wardrobe, takes the row as it is.
//
// Pure: imports only the story's JSONC reader and the shared hash. Shipped: the library pass draws each look's picture from
// it (`tools/swg/library.mjs`), so it is on the release's source list. Rule for this file (node runs it with type stripping):
// every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { parseJsonc } from '../../story/jsonc.ts';
import { hashText } from '../../net/hash.ts';

export const LOOKS_FILE_VERSION = 1;

/** A look worn as a body: the catalogue id its merged entry carries. */
export const OWN_LOOK_PREFIX = 'own:';

/** The reader's backstops (ours): every build holds a file to them alike, so none is live. */
export const LOOKS_LIMITS = {
  rows: 1024,
  /** Pieces of an outfit (a piece a mesh): the catalogue's busiest dressed entry wears about twenty. */
  outfit: 64,
  /** Colours of one piece, and the shared colours and shape sliders of one look. */
  values: 64,
  custom: 128,
  morphs: 256,
  name: 80,
  note: 400,
  /**
   * The greatest palette index or choice a value may be: past every palette the game ships (the widest holds 256), whose
   * last colour the customizer takes for anything past its end as it renders.
   */
  value: 65535,
};

/** A colour carried whole's least (white): `RAW_COLOUR_MIN` in src/player/texrender.ts, held equal by the node test. */
export const LOOK_COLOUR_MIN = -16777216;

/** One piece of a look's outfit: one mesh of a wardrobe item, and its own colours by bare name. */
export interface OwnLookPiece {
  part: string;
  item: string;
  wardrobe: string;
  values: Record<string, number>;
}

/** One row of the file, as read and cleaned. */
export interface OwnLookRow {
  id: string;
  from: string;
  species: string;
  morphs: Record<string, number>;
  custom: Record<string, number>;
  outfit: OwnLookPiece[];
  name?: string;
  note?: string;
  at?: number;
}

export interface LooksRead {
  rows: OwnLookRow[];
  skipped: { id: string; why: string }[];
  unknown: string[];
  problem: string | null;
}

/**
 * What the cleaner may be told of the wardrobe (the dresser's own save): a piece's word for the look's species -- `ok`,
 * `block` (the appearance table says the species cannot wear it), `hide` (worn unseen) -- or null for a piece it cannot find.
 */
export interface LookRules {
  fitOf?(wardrobe: string, item: string): 'ok' | 'block' | 'hide' | null;
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CATALOGUE = /^[A-Za-z0-9_./-]{1,160}$/;
const SPECIES = /^[a-z0-9_]{1,40}$/;
const NAME = /^[A-Za-z0-9_]{1,64}$/;
const ITEM = /^[A-Za-z0-9_./-]{1,96}$/;
const PART = /^[A-Za-z0-9_.-]{1,96}$/;
const WARDROBE = /^(wardrobe|mobiles\/wearables)\/[a-z0-9_]{1,40}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Names a plain record of ours must never take: the language's own, which an object key would reach through. */
const NOT_A_NAME = new Set(['__proto__', 'constructor', 'prototype']);
const ORDER: (keyof OwnLookRow)[] = ['id', 'from', 'species', 'morphs', 'custom', 'outfit', 'name', 'note', 'at'];
const FIELDS = new Set<string>(ORDER);
const PIECE_FIELDS = new Set(['part', 'item', 'wardrobe', 'values']);

/** Whether an id is one a row may carry. */
export function isLookId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v);
}

/** The body a look is worn as (`own:<id>`). */
export function ownBodyOf(id: string): string {
  return `${OWN_LOOK_PREFIX}${id}`;
}

/** The look a body names, or null for a body that is no look of ours. */
export function lookIdOfBody(body: string): string | null {
  if (!body.startsWith(OWN_LOOK_PREFIX)) return null;
  const id = body.slice(OWN_LOOK_PREFIX.length);
  return isLookId(id) ? id : null;
}

/** A fresh id from a name, unique among `taken`: its words in lower case joined by `-`, numbered from 1 where taken. */
export function mintLookId(base: string, taken: ReadonlySet<string>): string {
  const stem = (base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'look').slice(0, 56);
  const s = /^[a-z0-9]/.test(stem) ? stem : `look-${stem}`;
  for (let n = 1; ; n++) {
    const id = `${s}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** A colour or a choice as the customizer takes it: a whole number from a colour carried whole's least to `LOOKS_LIMITS.value`. */
export function lookValue(v: number): number {
  const n = Math.round(v);
  return n < LOOK_COLOUR_MIN ? LOOK_COLOUR_MIN : n > LOOKS_LIMITS.value ? LOOKS_LIMITS.value : n;
}

/** A shape slider as `Character.setMorph` holds it: nought to one. */
export function lookMorph(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

/** A record of numbers by name, each cleaned by `clean`, or why not. */
function readNumbers(v: unknown, most: number, what: string, clean: (n: number) => number): Record<string, number> | string {
  if (v === undefined) return {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `its ${what} are a record of numbers by name`;
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!NAME.test(k) || NOT_A_NAME.has(k)) return `its ${what} name ${JSON.stringify(k.slice(0, 40))}, which is no variable's name`;
    if (typeof x !== 'number' || !Number.isFinite(x)) return `its ${what}' ${k} is not a number`;
    if (++n > most) return `its ${what} are ${most} at most`;
    out[k] = clean(x);
  }
  return out;
}

/** One row cleaned, or why it is refused. A field this build does not read is kept out and named in `unknown`. */
export function readLookRow(v: unknown, unknown: string[] = [], rules: LookRules = {}): OwnLookRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a row is an object';
  const o = v as Record<string, unknown>;
  if (!isLookId(o.id)) return 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)';
  const id = o.id;
  for (const k of Object.keys(o)) if (!FIELDS.has(k)) unknown.push(`${id}.${k}`);
  if (typeof o.from !== 'string' || !CATALOGUE.test(o.from) || o.from.startsWith(OWN_LOOK_PREFIX)) return 'its from is a dressed catalogue entry (never a look of ours)';
  if (typeof o.species !== 'string' || !SPECIES.test(o.species)) return 'its species is a species pack (human_male, wookiee_female)';
  const L = LOOKS_LIMITS;
  const morphs = readNumbers(o.morphs, L.morphs, 'shape sliders', lookMorph);
  if (typeof morphs === 'string') return morphs;
  const custom = readNumbers(o.custom, L.custom, 'shared colours', lookValue);
  if (typeof custom === 'string') return custom;
  if (o.outfit !== undefined && !Array.isArray(o.outfit)) return 'its outfit is a list of pieces';
  const list = (o.outfit ?? []) as unknown[];
  if (list.length > L.outfit) return `its outfit is ${L.outfit} pieces at most`;
  const outfit: OwnLookPiece[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i] as Record<string, unknown> | null;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return `its outfit's piece ${i + 1} is not an object`;
    for (const k of Object.keys(p)) if (!PIECE_FIELDS.has(k)) unknown.push(`${id}.outfit.${i}.${k}`);
    if (typeof p.part !== 'string' || !PART.test(p.part)) return `its outfit's piece ${i + 1} names no part (a wardrobe's part name)`;
    if (typeof p.item !== 'string' || !ITEM.test(p.item)) return `its outfit's piece ${i + 1} names no item (a wardrobe's catalogue id)`;
    if (typeof p.wardrobe !== 'string' || !WARDROBE.test(p.wardrobe)) return `its outfit's piece ${i + 1} names no wardrobe folder (wardrobe/<species> or mobiles/wearables/<folder>)`;
    const values = readNumbers(p.values, L.values, `${p.item}'s colours`, lookValue);
    if (typeof values === 'string') return values;
    // The species' own rule, where the cleaner is told it: a piece the appearance table blocks is refused in words.
    if (rules.fitOf?.(p.wardrobe, p.item) === 'block') return `${p.item} is a piece ${o.species.replace(/_/g, ' ')} cannot wear (the appearance table blocks it)`;
    outfit.push({ part: p.part, item: p.item, wardrobe: p.wardrobe, values });
  }
  const row: OwnLookRow = { id, from: o.from, species: o.species, morphs, custom, outfit };
  if (o.name !== undefined) {
    if (typeof o.name !== 'string' || o.name.length > L.name || CONTROL.test(o.name)) return `its name is words of ${L.name} characters at most`;
    if (o.name) row.name = o.name;
  }
  if (o.note !== undefined) {
    if (typeof o.note !== 'string' || o.note.length > L.note) return `its note is words of ${L.note} characters at most`;
    if (o.note) row.note = o.note;
  }
  if (o.at !== undefined) {
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0) return 'its at is a time in milliseconds';
    row.at = o.at;
  }
  return row;
}

/** Read the file: every row a look, a row past the backstop or a second of an id skipped and named. */
export function readLooksFile(text: string, raws?: Record<string, unknown>[], rules: LookRules = {}): LooksRead {
  const out: LooksRead = { rows: [], skipped: [], unknown: [], problem: null };
  const doc = parseJsonc(text);
  if (doc.error) {
    out.problem = `it does not read (line ${doc.error.line}, column ${doc.error.col}: ${doc.error.message})`;
    return out;
  }
  const v = doc.value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    out.problem = 'it is not an object';
    return out;
  }
  if (v.version !== LOOKS_FILE_VERSION) {
    out.problem = `its version is not ${LOOKS_FILE_VERSION}`;
    return out;
  }
  if (!Array.isArray(v.rows)) {
    out.problem = 'it has no rows list';
    return out;
  }
  const seen = new Set<string>();
  for (let i = 0; i < v.rows.length; i++) {
    const raw = v.rows[i];
    const named = raw && typeof raw === 'object' && isLookId((raw as { id?: unknown }).id) ? (raw as { id: string }).id : `#${i}`;
    if (out.rows.length >= LOOKS_LIMITS.rows) {
      out.skipped.push({ id: named, why: `past the ${LOOKS_LIMITS.rows} rows a file may hold` });
      continue;
    }
    const row = readLookRow(raw, out.unknown, rules);
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

/** A whole file's text: one line a row, sorted by id, each row's fields in one fixed order (extras after them). */
export function looksFileText(rows: readonly Record<string, unknown>[]): string {
  const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const lines = sorted.map((r) => {
    const parts: string[] = [];
    for (const k of ORDER) if (r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    for (const k of Object.keys(r)) if (!FIELDS.has(k) && r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    return `    { ${parts.join(', ')} }`;
  });
  const body = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${LOOKS_FILE_VERSION},\n  "rows": ${body}\n}\n`;
}

/** A record's entries sorted by name: what a comparison and a hash read, whatever order the record was written in. */
function sortedEntries(r: Record<string, number>): [string, number][] {
  return Object.entries(r).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** What a look dresses a body by, in one canonical form: its body, its sliders, its colours, its pieces. */
function lookContent(r: Pick<OwnLookRow, 'from' | 'species' | 'morphs' | 'custom' | 'outfit'>): string {
  return JSON.stringify([r.from, r.species, sortedEntries(r.morphs), sortedEntries(r.custom), r.outfit.map((p) => [p.part, p.item, p.wardrobe, sortedEntries(p.values)])]);
}

/**
 * Eight hex of a look's content (its body, sliders, colours and pieces; never its name, note or time): what its merged
 * entry's look is cached under (`look:own:<id>@<hash8>`), so an edited look is never served from the cache, and what its
 * library picture is named by.
 */
export function lookHash(r: Pick<OwnLookRow, 'from' | 'species' | 'morphs' | 'custom' | 'outfit'>): string {
  return hashText(lookContent(r)).slice(0, 8);
}

/** Two rows that dress and read the same. */
export function sameLookRow(a: OwnLookRow, b: OwnLookRow): boolean {
  return a.id === b.id && lookContent(a) === lookContent(b) && (a.name ?? '') === (b.name ?? '') && (a.note ?? '') === (b.note ?? '') && (a.at ?? null) === (b.at ?? null);
}

/** A cleaned row to write, carrying what the row it replaces held that this build does not read. */
export function lookWithExtras(row: OwnLookRow, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (was) for (const k of Object.keys(was)) if (!FIELDS.has(k) && !(k in out)) out[k] = was[k];
  return out;
}
