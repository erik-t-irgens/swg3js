// The creature, droid and NPC catalogue (`assets-private/mobiles/catalogue.json`, about 8 MB of
// JSON, five thousand entries): fetched once per page and indexed once, behind the loading screen.
//
// Nothing in a frame may wait on it. The fetch starts at boot, before a character is chosen, and
// on a cold disk it can land after the first planet is up: every caller treats a catalogue that
// has not landed as absent (`loaded` gives null), and the one parsed object is the only copy.
import type { MobileAppearance, MobileCatalogueFile, MobileEntry, MobileKind, PackSummary } from './types';
import { buildIndex, groupTree, resolveEntry, searchEntries, type Indexed, type KindNode } from './catalogueIndex';

/** The format this game reads. */
export const CATALOGUE_FORMAT = 1;
/** What to run when there is no catalogue. */
export const CATALOGUE_COMMAND = 'npm run swg -- mobiles @SWG assets-private --retail-only';

const loads = new Map<string, Promise<MobileCatalogue | null>>();
const landed = new Map<string, MobileCatalogue | null>();

export class MobileCatalogue {
  readonly entries: readonly MobileEntry[];
  private readonly ids = new Map<string, MobileEntry>();
  private readonly index: Indexed[];
  private tree: KindNode[] | null = null;
  private readonly failedModels = new Set<string>();

  private constructor(readonly file: MobileCatalogueFile, readonly baseUrl: string) {
    this.entries = file.entries;
    for (const e of file.entries) this.ids.set(e.id, e);
    this.index = buildIndex(file.entries);
    for (const f of file.failed ?? []) if (f.what === 'model') this.failedModels.add(f.id);
  }

  /** Fetched and indexed once per base URL; null when the pack has no catalogue (or one of another format). */
  static load(baseUrl: string): Promise<MobileCatalogue | null> {
    let p = loads.get(baseUrl);
    if (!p) {
      p = (async () => {
        const url = `${baseUrl}assets-private/mobiles/catalogue.json`;
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
        return cat;
      })().then((c) => {
        landed.set(baseUrl, c);
        return c;
      });
      loads.set(baseUrl, p);
    }
    return p;
  }

  /** The one already loaded, or null: for code that must not wait (a spawn, the ambient wildlife on arrival). */
  static loaded(baseUrl: string): MobileCatalogue | null {
    return landed.get(baseUrl) ?? null;
  }

  byId(id: string): MobileEntry | undefined {
    return this.ids.get(id);
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

  /** Whether the pack holds what the entry needs, and if not, why, in a sentence. */
  ready(e: MobileEntry): { ok: boolean; why: string | null } {
    if (!e.ready) return { ok: false, why: e.notReady ?? 'the converter marked it not ready' };
    if (e.kind !== 'dressed') {
      if (!e.appearance) return { ok: false, why: 'it names no appearance' };
      if (this.failedModels.has(e.appearance)) return { ok: false, why: `its model (${e.appearance}) is not in the game's archives` };
      const a = this.appearanceOf(e);
      if (!a) return { ok: false, why: `its model ${e.appearance} is not in the catalogue` };
      if (!a.ready) return { ok: false, why: `its model ${e.appearance} was not converted (run ${CATALOGUE_COMMAND})` };
    }
    const p = this.packOf(e);
    if (!p) return { ok: false, why: 'it has no animation pack' };
    if (!p.ready) return { ok: false, why: `its animation pack ${p.id} was not converted (run ${CATALOGUE_COMMAND})` };
    return { ok: true, why: null };
  }

  /** The URL of a file the catalogue names (paths are under assets-private/). */
  url(path: string): string {
    return `${this.baseUrl}assets-private/${path}`;
  }
}
