// The looks' bake cache (the GPU port's pass 2, wave 4a; the design's 2.10, "load time", and the brief's item 8): what a look
// bakes (a body's air tables today; a generated look's pictures through the viewer's one hook, `build.js`) is kept in the
// browser's storage by the look's hash, so only a first arrival bakes, and that within a time budget behind the loading
// screen: a bake that would start past the budget is not made, its look shows its fallback (a body's Painted form, SWG's
// picture) until the next loading screen, which bakes it then.
//
// The storage is the page's own IndexedDB (one database, one store, the look's hash its key), every call of it wrapped, so a
// private window, blocked storage or a node test simply keeps the session's own memo and bakes again next session. Nothing
// here runs in a frame: `take` is called behind a loading screen.
//
// Pure apart from the storage it is handed (`idbStore` makes the page's): the node test drives it with a store of its own.

/**
 * The cache's numbers:
 *   - **budgetMs: 200.** The brief's default ("a first arrival's bakes within about 200 ms behind the loading screen"): a bake
 *     begun once 200 ms of baking have gone by on this screen is put off to the next. A body's air tables take some 90 ms.
 *   - **version: 1.** Part of every key: moved when what a bake makes changes, so a stored bake of the old kind is never read.
 */
export const BAKE_TUNE = { budgetMs: 200, version: 1 };

/** Where bakes are kept between sessions. */
export interface BakeStore {
  get(key: string): Promise<ArrayBuffer[] | null>;
  put(key: string, parts: ArrayBuffer[]): Promise<void>;
}

/** How a look's bake was had. */
export type BakeHow = 'memo' | 'stored' | 'baked' | 'fallback';

/** A short stable hash of a look's numbers or words (FNV-1a over its text, two 32-bit lanes), the cache's key. */
export function lookHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** What the cache did, for the console. */
export interface BakeStats {
  memo: number;
  stored: number;
  baked: number;
  fallback: number;
  /** Milliseconds baked on the current screen, and in all. */
  screenMs: number;
  bakedMs: number;
  /** The looks waiting on the next screen. */
  waiting: string[];
  /** Whether a store is there to keep bakes between sessions. */
  kept: boolean;
}

export class BakeCache {
  private readonly memo = new Map<string, Float32Array[]>();
  private readonly waiting = new Set<string>();
  readonly stats: BakeStats;
  private readonly store: BakeStore | null;
  private readonly now: () => number;

  constructor(store: BakeStore | null, now: () => number = () => performance.now()) {
    this.store = store;
    this.now = now;
    this.stats = { memo: 0, stored: 0, baked: 0, fallback: 0, screenMs: 0, bakedMs: 0, waiting: [], kept: store !== null };
  }

  /** A loading screen begins: its budget is whole again, and what waited is baked if asked. */
  beginScreen(): void {
    this.stats.screenMs = 0;
  }

  /** The key a look's bake is filed under: its kind, the cache's version and the look's hash. */
  static keyOf(kind: string, look: string): string {
    return `${kind}:v${BAKE_TUNE.version}:${lookHash(look)}`;
  }

  /**
   * A look's bake: from this session's memo, else the store, else made now (`make`, which answers its parts) where the
   * screen's budget has room, kept in the memo and the store; else nothing, and the look waits for the next screen (its
   * caller draws its fallback). `make` is never called once the budget is spent.
   */
  async take(key: string, make: () => Float32Array[]): Promise<{ parts: Float32Array[] | null; how: BakeHow }> {
    const m = this.memo.get(key);
    if (m) {
      this.stats.memo++;
      return { parts: m, how: 'memo' };
    }
    if (this.store) {
      let got: ArrayBuffer[] | null = null;
      try {
        got = await this.store.get(key);
      } catch {
        got = null;
      }
      if (got && got.length) {
        const parts = got.map((b) => new Float32Array(b));
        this.memo.set(key, parts);
        this.waiting.delete(key);
        this.stats.stored++;
        this.stats.waiting = [...this.waiting];
        return { parts, how: 'stored' };
      }
    }
    if (this.stats.screenMs >= BAKE_TUNE.budgetMs) {
      this.waiting.add(key);
      this.stats.fallback++;
      this.stats.waiting = [...this.waiting];
      return { parts: null, how: 'fallback' };
    }
    const t0 = this.now();
    const parts = make();
    const ms = this.now() - t0;
    this.stats.screenMs += ms;
    this.stats.bakedMs += ms;
    this.stats.baked++;
    this.memo.set(key, parts);
    this.waiting.delete(key);
    this.stats.waiting = [...this.waiting];
    if (this.store) {
      try {
        await this.store.put(
          key,
          parts.map((p) => p.slice().buffer as ArrayBuffer),
        );
      } catch {
        /* kept for this session only */
      }
    }
    return { parts, how: 'baked' };
  }

  /** Whether a look's bake is in this session's memo (so it draws in full). */
  has(key: string): boolean {
    return this.memo.has(key) || this.bytes.has(key);
  }

  /** The session's memo let go (the console's: the next screen reads the store, or bakes again). */
  forgetMemo(): void {
    this.memo.clear();
    this.bytes.clear();
  }

  // ---------------------------------------------------------------- pictures (pass 2, wave 4b, maker A)

  /** The pictures' memo: a generated look's baked texels (bytes), by the same kind of key. */
  private readonly bytes = new Map<string, Uint8Array[]>();

  /**
   * A look's pictures (pass 2, wave 4b): `take`'s rule for a bake made on the card, which answers its parts as bytes and
   * takes some milliseconds of awaiting (the bake's passes and its read-back). From this session's memo, else the store, else
   * made now where the screen's budget has room (its awaited time counted against the budget, so a slow card's first bake
   * puts the next look off), kept in the memo and the store; else nothing, and the look waits for the next screen (its caller
   * draws SWG's picture). `make` is never called once the budget is spent; a `make` that answers null (no card, a bake
   * refused) leaves nothing kept and the look not waiting.
   */
  async takeBytes(key: string, make: () => Promise<Uint8Array[] | null>): Promise<{ parts: Uint8Array[] | null; how: BakeHow }> {
    const m = this.bytes.get(key);
    if (m) {
      // (read from the storage ahead by `holds`: it is the storage's)
      if (this.readAhead.delete(key)) {
        this.stats.stored++;
        return { parts: m, how: 'stored' };
      }
      this.stats.memo++;
      return { parts: m, how: 'memo' };
    }
    if (this.store) {
      let got: ArrayBuffer[] | null = null;
      try {
        got = await this.store.get(key);
      } catch {
        got = null;
      }
      if (got && got.length) {
        const parts = got.map((b) => new Uint8Array(b));
        this.bytes.set(key, parts);
        this.inStore.add(key);
        this.waiting.delete(key);
        this.stats.stored++;
        this.stats.waiting = [...this.waiting];
        return { parts, how: 'stored' };
      }
    }
    if (this.stats.screenMs >= BAKE_TUNE.budgetMs) {
      this.waiting.add(key);
      this.stats.fallback++;
      this.stats.waiting = [...this.waiting];
      return { parts: null, how: 'fallback' };
    }
    const t0 = this.now();
    let parts: Uint8Array[] | null = null;
    try {
      parts = await make();
    } catch {
      parts = null;
    }
    const ms = this.now() - t0;
    this.stats.screenMs += ms;
    this.stats.bakedMs += ms;
    if (!parts) return { parts: null, how: 'fallback' };
    this.stats.baked++;
    this.bytes.set(key, parts);
    this.waiting.delete(key);
    this.stats.waiting = [...this.waiting];
    if (this.store) {
      try {
        await this.store.put(
          key,
          parts.map((p) => p.slice().buffer as ArrayBuffer),
        );
        this.inStore.add(key);
      } catch {
        /* kept for this session only */
      }
    }
    return { parts, how: 'baked' };
  }

  /** A look's pictures where this session's memo has them (never a bake, never the store): for a reader in play. */
  bytesIfHad(key: string): Uint8Array[] | null {
    return this.bytes.get(key) ?? null;
  }

  /** Keys this session put into the store or read out of it: pictures the next screen can read again. */
  private readonly inStore = new Set<string>();

  /**
   * A look's pictures let go from the session's memo once their reader has made what it draws (the fixer of pass 2, wave 4b: the
   * memo kept every bake at every size for the session, 16 MB a space planet), where the store holds them, so the next screen
   * reads them back (some tens of milliseconds); kept where the store refused them, so the session never loses a look.
   * Answers whether they were let go.
   */
  dropBytes(key: string): boolean {
    if (!this.inStore.has(key) || !this.bytes.has(key)) return false;
    this.bytes.delete(key);
    this.readAhead.delete(key);
    return true;
  }

  /** Keys read from the storage ahead by `holds`, answered as the storage's by the next `takeBytes`. */
  private readonly readAhead = new Set<string>();

  /**
   * Whether a look's pictures are had without a bake (this session's memo, or the storage, read into the memo here): what a
   * screen's start asks before it asks for a kit's pipelines, so a stored look compiles nothing.
   */
  async holds(key: string): Promise<boolean> {
    if (this.bytes.has(key)) return true;
    if (!this.store) return false;
    let got: ArrayBuffer[] | null = null;
    try {
      got = await this.store.get(key);
    } catch {
      got = null;
    }
    if (!got || !got.length) return false;
    this.bytes.set(key, got.map((b) => new Uint8Array(b)));
    this.inStore.add(key);
    this.readAhead.add(key);
    return true;
  }
}

/** The page's IndexedDB as a bake store (one database `swg-bakes`, one store), or null where there is none or it is refused. */
export function idbStore(name = 'swg-bakes'): BakeStore | null {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) return null;
  let db: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => {
    if (!db) {
      db = new Promise((resolve) => {
        try {
          const req = idb.open(name, 1);
          req.onupgradeneeded = () => {
            try {
              req.result.createObjectStore('bakes');
            } catch {
              /* made already */
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return db;
  };
  return {
    async get(key: string): Promise<ArrayBuffer[] | null> {
      const d = await open();
      if (!d) return null;
      return new Promise((resolve) => {
        try {
          const req = d.transaction('bakes', 'readonly').objectStore('bakes').get(key);
          req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as ArrayBuffer[]) : null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    },
    async put(key: string, parts: ArrayBuffer[]): Promise<void> {
      const d = await open();
      if (!d) return;
      await new Promise<void>((resolve) => {
        try {
          const tx = d.transaction('bakes', 'readwrite');
          tx.objectStore('bakes').put(parts, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
    },
  };
}
