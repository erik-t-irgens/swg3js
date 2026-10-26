// The world editor's library (DESIGN.md §2.5): everything it can put down, in sources and groups, searchable, a page at a
// time, with the developer's own Recent and Favourites. Read from the `library` pass's index
// (`assets-private/library/library.json`, `tools/swg/library.mjs`), and without one from the packs the game already
// reads -- the props catalogue, the gallery's list and this world's manifest -- with initials for pictures, the give
// screen's own fallback.
//
// An entry is what a row writes (`EditorSource`): a props thing, a gallery building, a model of a world's own pack (this
// world's, or another's, named in `from`), or a planted model of any world.
//
// Recent and Favourites are per developer and never committed: kept in local storage inside a `try`, read through a
// storage port that may throw (a private window, cleared site data), and answering the session's own copy when it does.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

import { LIBRARY_TUNE } from './editorTune.ts';

/** The index's shape this reads; the pass's `LIBRARY_FORMAT`, held equal by a node test. */
export const LIBRARY_VERSION = 1;

/** The sources, in the order the window lists them. */
export const LIBRARY_SOURCES = ['props', 'buildings', 'world', 'flora'] as const;
export type LibrarySource = (typeof LIBRARY_SOURCES)[number];

/** A source in words. */
export const SOURCE_WORDS: Record<LibrarySource, string> = { props: 'Props', buildings: 'Buildings', world: 'World models', flora: 'Flora' };

/** An entry's flags, the pass's own (`LIBRARY_FLAG`). */
export const ENTRY_FLAG = { building: 1, walkIn: 2, flora: 4, tree: 8, particle: 16, standing: 32, solid3d: 64, loop: 128 };

/** One entry as the index holds it. */
export interface LibraryEntry {
  /** Its source. */
  s: LibrarySource;
  /** The pack it is read out of: `props`, `gallery`, or a world's pack id. */
  p: string;
  /** Its id in its source (a props thing's id; a template's stem; a model's id). */
  id: string;
  /** Its model's id. */
  m: string;
  /** Its name, or null for none known. */
  n: string | null;
  /** Its group within its source. */
  g: string;
  /** The object template it really is, or null. */
  t: string | null;
  /** Its size, [w, h, d] metres. */
  sz: number[];
  /** Its triangles. */
  tri: number;
  /** Its picture, relative to `assets-private/`, or null (initials). */
  pic: string | null;
  /** `ENTRY_FLAG` bits. */
  f: number;
}

/** The index, as read. */
export interface LibraryIndex {
  version: number;
  made: string;
  packs: Record<string, { manifest: string; mtime: number }>;
  entries: LibraryEntry[];
}

/** An index read, or null for one of another shape. */
export function readLibraryIndex(v: unknown): LibraryIndex | null {
  const o = v as Partial<LibraryIndex> | null;
  if (!o || typeof o !== 'object' || o.version !== LIBRARY_VERSION || !Array.isArray(o.entries)) return null;
  const entries: LibraryEntry[] = [];
  for (const e of o.entries as unknown[]) {
    const r = e as Partial<LibraryEntry>;
    if (!r || typeof r.id !== 'string' || typeof r.m !== 'string' || typeof r.p !== 'string' || !(LIBRARY_SOURCES as readonly string[]).includes(r.s as string)) continue;
    entries.push({ s: r.s as LibrarySource, p: r.p, id: r.id, m: r.m, n: typeof r.n === 'string' ? r.n : null, g: typeof r.g === 'string' ? r.g : 'other', t: typeof r.t === 'string' ? r.t : null, sz: Array.isArray(r.sz) ? r.sz : [0, 0, 0], tri: typeof r.tri === 'number' ? r.tri : 0, pic: typeof r.pic === 'string' ? r.pic : null, f: typeof r.f === 'number' ? r.f : 0 });
  }
  return { version: LIBRARY_VERSION, made: typeof o.made === 'string' ? o.made : '', packs: (o.packs as LibraryIndex['packs']) ?? {}, entries };
}

/** What the fallback reads with no index: the props catalogue, the gallery's list, and this world's manifest. */
export interface FallbackSources {
  props?: { id: string; model: string; name?: string | null; group: string; template: string | null; size?: { w: number; h: number; d: number }; icon?: string | null }[] | null;
  gallery?: { sections?: { id: string; items?: { label?: string; template?: string; model: string }[] }[] } | null;
  world?: { id: string; manifest: { categories: Record<string, { id: string; cells?: unknown[]; particle?: boolean; bounds?: { min: number[]; max: number[] }; familyName?: string }[]> } } | null;
}

/** A template's last part as words, and its stem. */
function stemOf(template: string | null | undefined): string {
  return String(template ?? '').split('/').pop()?.replace(/^shared_/, '').replace(/\.iff$/, '') ?? '';
}

/**
 * The library without an index: the props catalogue's things (their own pictures), every gallery house and interior,
 * this world's models and its flora, with no picture where none exists. What the window shows until the `library` pass
 * has run, so the editor is never empty.
 */
export function fallbackEntries(src: FallbackSources): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const p of src.props ?? []) out.push({ s: 'props', p: 'props', id: p.id, m: p.model, n: p.name ?? null, g: p.group, t: p.template, sz: p.size ? [p.size.w, p.size.h, p.size.d] : [0, 0, 0], tri: 0, pic: p.icon ? `props/${p.icon}` : null, f: 0 });
  const seen = new Set<string>();
  for (const section of src.gallery?.sections ?? []) {
    if (section.id !== 'houses' && section.id !== 'interiors') continue;
    for (const item of section.items ?? []) {
      let id = item.template ? stemOf(item.template) : item.model;
      while (seen.has(id)) id = `${id}_`;
      seen.add(id);
      out.push({ s: 'buildings', p: 'gallery', id, m: item.model, n: item.label ?? null, g: section.id, t: item.template ?? null, sz: [0, 0, 0], tri: 0, pic: null, f: ENTRY_FLAG.building });
    }
  }
  const w = src.world;
  if (w) {
    for (const d of w.manifest.categories.layout ?? []) {
      if (d.particle) continue;
      out.push({ s: 'world', p: w.id, id: d.id, m: d.id, n: null, g: 'layout', t: null, sz: [0, 0, 0], tri: 0, pic: null, f: d.cells?.length ? ENTRY_FLAG.building : 0 });
    }
    for (const d of w.manifest.categories.flora ?? []) out.push({ s: 'flora', p: w.id, id: d.id, m: d.id, n: d.familyName ? `${d.id} (${d.familyName})` : null, g: 'flora', t: null, sz: [0, 0, 0], tri: 0, pic: null, f: ENTRY_FLAG.flora });
  }
  return out;
}

/** An entry's key, as `editor({ take })` names one: `props:<id>`, `buildings:<id>`, a world's `world:<pack>:<id>`, a planting `flora:<pack>:<id>`. */
export function entryKey(e: Pick<LibraryEntry, 's' | 'p' | 'id'>): string {
  return e.s === 'world' || e.s === 'flora' ? `${e.s}:${e.p}:${e.id}` : `${e.s}:${e.id}`;
}

/** What an entry is called in words: its name, else its id as words. */
export function entryName(e: LibraryEntry): string {
  return e.n ?? e.id.replace(/_/g, ' ');
}

/** The one string a search reads of an entry, lower-cased once: its name, its id, its group and its pack. */
export function haystackOf(e: LibraryEntry): string {
  return `${e.n ?? ''} ${e.id} ${e.g} ${e.p} ${e.t ?? ''}`.toLowerCase();
}

/** The library made searchable: the entries and their haystacks, worked out once. */
export interface LibraryView {
  entries: LibraryEntry[];
  hay: string[];
  byKey: Map<string, LibraryEntry>;
}

/** Worked out once a library: a haystack an entry and the keys. */
export function libraryView(entries: LibraryEntry[]): LibraryView {
  const hay = entries.map(haystackOf);
  const byKey = new Map<string, LibraryEntry>();
  for (const e of entries) byKey.set(entryKey(e), e);
  return { entries, hay, byKey };
}

/**
 * The entries of a source (and, for a world's or a planting's, one pack: null for every pack) whose haystack holds every
 * word of `query`, in the index's own order. An empty query is the whole source.
 */
export function searchLibrary(v: LibraryView, source: LibrarySource | null, query: string, pack: string | null = null): LibraryEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out: LibraryEntry[] = [];
  for (let i = 0; i < v.entries.length; i++) {
    const e = v.entries[i];
    if (source && e.s !== source) continue;
    if (pack && e.p !== pack) continue;
    if (words.length) {
      const h = v.hay[i];
      let all = true;
      for (const w of words) {
        if (!h.includes(w)) {
          all = false;
          break;
        }
      }
      if (!all) continue;
    }
    out.push(e);
  }
  return out;
}

/** The groups of a list of entries, each with its count, most first and then by name. */
export function groupsOf(list: readonly LibraryEntry[]): { id: string; count: number }[] {
  const by = new Map<string, number>();
  for (const e of list) by.set(e.g, (by.get(e.g) ?? 0) + 1);
  return [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, count]) => ({ id, count }));
}

/** One page of a list: page `n` (from nought) of `size`. */
export function pageOf<T>(list: readonly T[], n: number, size = LIBRARY_TUNE.page): T[] {
  const start = Math.max(0, n) * size;
  return list.slice(start, start + size);
}

/** The packs a source's entries come from, sorted, for the Flora and World models sources' choice of world. */
export function packsOf(list: readonly LibraryEntry[], source: LibrarySource): string[] {
  const s = new Set<string>();
  for (const e of list) if (e.s === source) s.add(e.p);
  return [...s].sort();
}

/** What a row of a world's files writes, as `Used here` reads it: its pack and what it names there. */
export interface UsedRow {
  pack: string;
  thing?: string;
  model?: string;
  template?: string;
  from?: string;
}

/**
 * **Used here**: the library's entries that this world's files already stand (`rows`, both layers), most used first and
 * then by name: a props row's thing, a gallery row's building (by its model, and its template where it names one), a
 * world row's model of this world (`here`) or of the world it names in `from` (a template's entry where the row names the
 * template, else any of that model, else the planting of it). A row no entry answers is left out.
 */
export function usedHereKeys(v: LibraryView, rows: readonly UsedRow[], here: string): string[] {
  const byModel = new Map<string, LibraryEntry[]>();
  for (const e of v.entries) {
    if (e.s === 'props') continue;
    const k = `${e.s === 'buildings' ? 'gallery' : e.p}|${e.m}`;
    const list = byModel.get(k);
    if (list) list.push(e);
    else byModel.set(k, [e]);
  }
  const count = new Map<string, number>();
  const note = (e: LibraryEntry | undefined) => {
    if (!e) return;
    const k = entryKey(e);
    count.set(k, (count.get(k) ?? 0) + 1);
  };
  for (const r of rows) {
    if (r.pack === 'props') {
      note(r.thing ? v.byKey.get(`props:${r.thing}`) : undefined);
      continue;
    }
    if (!r.model) continue;
    const pack = r.pack === 'gallery' ? 'gallery' : (r.from ?? here);
    const list = byModel.get(`${pack}|${r.model}`);
    if (!list) continue;
    const kind = r.pack === 'gallery' ? 'buildings' : 'world';
    note(list.find((e) => e.s === kind && !!r.template && e.t === r.template) ?? list.find((e) => e.s === kind) ?? list.find((e) => e.s === 'flora'));
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

/** What the library keeps per developer in local storage, through a port a test stands in for (and which may throw). */
export interface LibraryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const RECENT_KEY = 'swg.editor.recent';
const FAV_KEY = 'swg.editor.favourites';
const HOTBAR_KEY = 'swg.editor.hotbar';

/**
 * Recent, Favourites and the hotbar, kept in local storage inside a `try` (a per-developer convenience, never state that
 * must persist), with the session's own copy answering whenever storage will not.
 */
export class LibraryKeep {
  private readonly store: LibraryStorage | null;
  recent: string[] = [];
  favourites: string[] = [];
  hotbar: (string | null)[] = [null, null, null, null, null, null, null, null, null];

  constructor(store: LibraryStorage | null) {
    this.store = store;
    this.recent = this.read(RECENT_KEY, []);
    this.favourites = this.read(FAV_KEY, []);
    const hb = this.read<(string | null)[]>(HOTBAR_KEY, []);
    for (let i = 0; i < 9; i++) this.hotbar[i] = typeof hb[i] === 'string' ? (hb[i] as string) : null;
  }

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.store?.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? (v.filter((x) => typeof x === 'string' || x === null) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.store?.setItem(key, JSON.stringify(value));
    } catch {
      /* storage refused: the session's copy stands */
    }
  }

  /** A thing put down: first in Recent, the list held to `LIBRARY_TUNE.recent`. */
  noteUsed(key: string): void {
    this.recent = [key, ...this.recent.filter((k) => k !== key)].slice(0, Math.max(1, LIBRARY_TUNE.recent));
    this.write(RECENT_KEY, this.recent);
  }

  /** A star turned on or off; answers whether it is a favourite now. */
  toggleFavourite(key: string): boolean {
    const on = !this.favourites.includes(key);
    this.favourites = on ? [...this.favourites, key] : this.favourites.filter((k) => k !== key);
    this.write(FAV_KEY, this.favourites);
    return on;
  }

  /** A hotbar slot (1 to 9) set to an entry, or emptied. */
  setHotbar(slot: number, key: string | null): void {
    if (!(slot >= 1 && slot <= 9)) return;
    this.hotbar[slot - 1] = key;
    this.write(HOTBAR_KEY, this.hotbar);
  }
}
