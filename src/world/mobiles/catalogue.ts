// The creature, droid and NPC catalogue (`assets-private/mobiles/catalogue.json`, about 8 MB of
// JSON, five thousand entries): fetched once per page and indexed once, behind the loading screen.
//
// Nothing in a frame may wait on it. The fetch starts at boot, before a character is chosen, and
// on a cold disk it can land after the first planet is up: every caller treats a catalogue that
// has not landed as absent (`loaded` gives null), and the one parsed object is the only copy.
//
// The owner's own looks (Map-maker II's thirteenth wave, `public/placements/looks/all.json`) are read beside it, once a
// session, and merged in as dressed entries of their own (`own:<id>`, `ownLooks.ts`) after the converter's; with no looks
// file the entries are the file's own list, untouched. On the dev server the world editor's writes land on it as they go
// (`setOwnLooks`), which is an edit's cost: the index and the spawner's tree are made again.
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension, no
// constructor parameter properties.
import type { MobileAppearance, MobileCatalogueFile, MobileEntry, MobileKind, PackSummary } from './types';
import { CATALOGUE_COMMAND, buildIndex, failedModelsOf, groupTree, readinessOf, resolveEntry, searchEntries, type Indexed, type KindNode } from './catalogueIndex.ts';
import { mergeOwnLooks, ownBodies } from './ownLooks.ts';
import { readLooksFile, type OwnLookRow } from '../editFiles/looksFile.ts';
import { fetchPublic } from '../packFiles.ts';
import { editFilePath } from '../../story/placementPath.ts';

/** The format this game reads. */
export const CATALOGUE_FORMAT = 1;
/** What to run when there is no catalogue (kept beside the readiness rule, which says it too). */
export { CATALOGUE_COMMAND };

const loads = new Map<string, Promise<MobileCatalogue | null>>();
const landed = new Map<string, MobileCatalogue | null>();

/** The looks file as this boot read it: its rows, and what could not be read (a file that does not read is no looks). */
export interface OwnLooksLoaded {
  rows: OwnLookRow[];
  skipped: { id: string; why: string }[];
  problem: string | null;
  bytes: number;
}

/**
 * The owner's own looks file (a built game asks only for one its own list ships; the dev server answers from the disk): null
 * for none, `'unread'` for one that could not be fetched (as the other edit files' readers tell them apart), its rows
 * otherwise. Never thrown: a file that does not read is said on the console and is no looks, so nobody stands in one and
 * every wearer is skipped as a row with no body is.
 */
export async function readOwnLooks(baseUrl: string): Promise<OwnLooksLoaded | null | 'unread'> {
  const path = editFilePath('looks', 'all');
  let text: string;
  try {
    const res = await fetchPublic(path, { cache: 'no-store' }, baseUrl);
    if (!res || res.status === 404) return null;
    const type = res.headers.get('content-type') ?? '';
    // A missing public file is answered with the page and a 200: no file.
    if (res.ok && type.includes('text/html')) return null;
    if (!res.ok || !(type.includes('json') || type.includes('text/plain'))) return 'unread';
    text = await res.text();
  } catch {
    return 'unread';
  }
  const read = readLooksFile(text);
  if (read.problem) console.warn(`looks: public/${path} does not read (${read.problem}): nobody stands in a look of yours`);
  if (read.skipped.length) console.warn(`looks: public/${path}: ${read.skipped.map((s) => `${s.id}: ${s.why}`).join('; ')}`);
  if (read.unknown.length) console.warn(`looks: public/${path}: fields this build does not read: ${read.unknown.join(', ')}`);
  return { rows: read.rows, skipped: read.skipped, problem: read.problem, bytes: text.length };
}

/** The species packs this machine holds, from the species index (`characters/index.json`); null when it has none to ask. */
async function speciesHere(baseUrl: string): Promise<Set<string> | null> {
  try {
    const res = await fetch(`${baseUrl}assets-private/characters/index.json`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const list = ((await res.json()) as { species?: { id?: unknown }[] }).species ?? [];
    return new Set(list.map((s) => s?.id).filter((id): id is string => typeof id === 'string'));
  } catch {
    return null;
  }
}

export class MobileCatalogue {
  readonly file: MobileCatalogueFile;
  readonly baseUrl: string;
  /** Every entry: the converter's own, then the owner's own looks (none, and this is the file's very list). */
  entries: readonly MobileEntry[];
  private ids = new Map<string, MobileEntry>();
  private index: Indexed[];
  private tree: KindNode[] | null = null;
  private readonly failedModels: Set<string>;
  /** The owner's own looks in force (the file's rows), those left out and why, and the wearers' stand-ins (`ownLooks.ts`). */
  ownRows: readonly OwnLookRow[] = [];
  ownSkipped: { id: string; why: string }[] = [];
  private standIns = new Map<string, MobileEntry>();
  /** The species packs this machine holds, as the looks were merged against (null: every species taken as there). */
  private species: Set<string> | null = null;
  private speciesAsked: Promise<void> | null = null;
  /** What the boot's read of the looks file said (null: no file, or one that could not be fetched), for the console. */
  ownFile: { rows: number; skipped: { id: string; why: string }[]; problem: string | null; bytes: number } | null = null;

  /** The species index asked for once (a landing of the looks file asks it before its first merge, as the boot does). */
  knowSpecies(): Promise<void> {
    this.speciesAsked ??= speciesHere(this.baseUrl).then((s) => {
      this.species = s;
    });
    return this.speciesAsked;
  }

  private constructor(file: MobileCatalogueFile, baseUrl: string) {
    this.file = file;
    this.baseUrl = baseUrl;
    this.entries = file.entries;
    for (const e of file.entries) this.ids.set(e.id, e);
    this.index = buildIndex(file.entries);
    this.failedModels = failedModelsOf(file);
  }

  /** Fetched and indexed once per base URL; null when the pack has no catalogue (or one of another format). */
  static load(baseUrl: string): Promise<MobileCatalogue | null> {
    let p = loads.get(baseUrl);
    if (!p) {
      p = (async () => {
        const url = `${baseUrl}assets-private/mobiles/catalogue.json`;
        // The owner's own looks beside it, asked for at the same moment (none asked in a build that ships none).
        const looks = readOwnLooks(baseUrl);
        let file: MobileCatalogueFile;
        // Timed from the response to the index: the body's download, its parse and the index. Past
        // about 60 ms on the owner's machine the parse belongs in a worker.
        let t0 = 0;
        try {
          const res = await fetch(url);
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
            console.info(`mobiles: no creature and NPC catalogue (run ${CATALOGUE_COMMAND})`);
            return null;
          }
          t0 = performance.now();
          file = (await res.json()) as MobileCatalogueFile;
        } catch (err) {
          console.warn(`mobiles: the catalogue would not load (${String((err as Error)?.message ?? err)}); run ${CATALOGUE_COMMAND}`);
          return null;
        }
        if (file?.format !== CATALOGUE_FORMAT || !Array.isArray(file.entries)) {
          console.warn(`mobiles: the catalogue is format ${String(file?.format)}, this game reads format ${CATALOGUE_FORMAT} (run ${CATALOGUE_COMMAND} again)`);
          return null;
        }
        const t1 = performance.now();
        const cat = new MobileCatalogue(file, baseUrl);
        const t2 = performance.now();
        console.info(`mobiles: catalogue parsed and indexed in ${(t2 - t0).toFixed(0)} ms (read and parse ${(t1 - t0).toFixed(0)}, index ${(t2 - t1).toFixed(0)})`);
        const own = await looks;
        if (own && own !== 'unread') cat.ownFile = { rows: own.rows.length, skipped: own.skipped, problem: own.problem, bytes: own.bytes };
        if (own && own !== 'unread' && own.rows.length) {
          await cat.knowSpecies();
          cat.setOwnLooks(own.rows);
        }
        return cat;
      })().then((c) => {
        landed.set(baseUrl, c);
        return c;
      });
      loads.set(baseUrl, p);
    }
    return p;
  }

  /** The one already loaded, or null: for code that must not wait (a spawn, a record that arrives before it). */
  static loaded(baseUrl: string): MobileCatalogue | null {
    return landed.get(baseUrl) ?? null;
  }

  /**
   * The owner's own looks put in force (the boot's read, a write of the world editor's landing, the file read again): the
   * entries made again as the converter's then the looks' (`mergeOwnLooks`), and the index, the ids and the spawner's tree
   * with them. An edit's cost. Answers the looks left out, each with why.
   */
  setOwnLooks(rows: readonly OwnLookRow[]): { id: string; why: string }[] {
    const m = mergeOwnLooks(this.file.entries, rows, this.species ? { species: (s) => this.species!.has(s) } : {});
    this.ownRows = [...rows];
    this.ownSkipped = m.skipped;
    for (const s of m.skipped) console.warn(`looks: ${s.id}: ${s.why}`);
    this.standIns = m.standIns;
    this.entries = m.entries;
    this.ids = new Map();
    for (const e of this.entries) this.ids.set(e.id, e);
    this.index = buildIndex(this.entries);
    this.tree = null;
    return m.skipped;
  }

  /** The owner's own looks' entries, in the file's order. */
  ownEntries(): MobileEntry[] {
    return this.entries.filter((e) => !!e.own);
  }

  /** What every body of the owner's own looks stands as now, by body (`ownBodies`): what a landing compares (`looksMoved`). */
  ownBodies(): Map<string, string> {
    return ownBodies(this.ownEntries(), this.standIns);
  }

  byId(id: string): MobileEntry | undefined {
    // A look of the owner's own left out for want of its species pack: whoever wears it stands in its `from`'s body.
    return this.ids.get(id) ?? this.standIns.get(id);
  }

  /** A name or an id to the one entry it means: `'Lava Flea'` is `som/lava_flea`, `'rancor'` the rancor and not its hologram. */
  resolve(nameOrId: string): MobileEntry | undefined {
    return resolveEntry(this.index, nameOrId);
  }

  search(query: string, opts?: { kind?: MobileKind; readyOnly?: boolean; limit?: number }): MobileEntry[] {
    return searchEntries(this.index, query, opts);
  }

  /** The spawner's tree, built once and kept. */
  groups(): KindNode[] {
    this.tree ??= groupTree(this.entries);
    return this.tree;
  }

  appearanceOf(e: MobileEntry): MobileAppearance | null {
    return e.appearance ? (this.file.appearances[e.appearance] ?? null) : null;
  }

  packOf(e: MobileEntry): PackSummary | null {
    const id = e.pack ?? this.appearanceOf(e)?.pack ?? null;
    return id ? (this.file.packs[id] ?? null) : null;
  }

  /** The model file: the entry's colour variant when it has one that differs, else the base. Null for anything not a plain model. */
  modelFile(e: MobileEntry): string | null {
    const a = this.appearanceOf(e);
    if (!a || a.form !== 'glb') return null;
    const v = e.variant ? a.variants?.[e.variant] : undefined;
    if (v && !v.same && v.file) return v.file;
    return a.file;
  }

  /** Whether the pack holds what the entry needs, and if not, why, in a sentence (`readinessOf`, the one rule). */
  ready(e: MobileEntry): { ok: boolean; why: string | null } {
    return readinessOf(e, this.file, this.failedModels);
  }

  /** The URL of a file the catalogue names (paths are under assets-private/). */
  url(path: string): string {
    return `${this.baseUrl}assets-private/${path}`;
  }
}
