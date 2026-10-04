// Where this browser keeps the journal's words: IndexedDB `swg-story`, store `texts`, a text a row under its
// hash. Every access is guarded: with no IndexedDB (a private window, a blocked store) the words last the
// session in memory, and an entry whose words were lost with an earlier session shows as not kept rather than as
// a guess. The words are the same for every character who saw them, so the store is keyed by hash alone.
//
// What the game reads is memory: every word kept is read in when the store opens (`load`), once, behind the
// first loading screen, and a word put is in memory at once and written behind. Nothing here is awaited on any
// path that draws.
//
// Browser only, and never reached by the server (`storyImports.test.ts`).

/** The database, its store and its version. Ours. */
const DB = 'swg-story';
const STORE = 'texts';
const VERSION = 1;

export class StoryTexts {
  private readonly mem = new Map<string, string>();
  private db: IDBDatabase | null = null;
  /** Whether the store opened at all, and whether its words are read in. */
  state: 'closed' | 'opening' | 'open' | 'none' = 'closed';
  readonly stats = { loaded: 0, put: 0, written: 0, failed: 0 };

  /** Open the store and read every word kept into memory. Answers once it has, or once it could not. */
  load(): Promise<void> {
    if (this.state !== 'closed') return Promise.resolve();
    this.state = 'opening';
    return new Promise<void>((done) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB, VERSION);
      } catch {
        this.state = 'none';
        done();
        return;
      }
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        } catch {
          /* the open fails below */
        }
      };
      req.onerror = () => {
        this.state = 'none';
        done();
      };
      req.onblocked = () => {
        this.state = 'none';
        done();
      };
      req.onsuccess = () => {
        this.db = req.result;
        try {
          const tx = this.db.transaction(STORE, 'readonly');
          const cur = tx.objectStore(STORE).openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c) {
              this.state = 'open';
              done();
              return;
            }
            if (typeof c.key === 'string' && typeof c.value === 'string' && !this.mem.has(c.key)) {
              this.mem.set(c.key, c.value);
              this.stats.loaded++;
            }
            c.continue();
          };
          cur.onerror = () => {
            this.state = 'open';
            done();
          };
        } catch {
          this.state = 'none';
          done();
        }
      };
    });
  }

  get(h: string): string | undefined {
    return this.mem.get(h);
  }

  has(h: string): boolean {
    return this.mem.has(h);
  }

  /** Words kept: in memory at once, and written behind when the store is open. */
  put(texts: Record<string, string>): void {
    const fresh: [string, string][] = [];
    for (const h of Object.keys(texts)) {
      const t = texts[h];
      if (typeof t !== 'string' || this.mem.get(h) === t) continue;
      this.mem.set(h, t);
      this.stats.put++;
      fresh.push([h, t]);
    }
    if (!fresh.length || !this.db) return;
    try {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [h, t] of fresh) store.put(t, h);
      tx.oncomplete = () => {
        this.stats.written += fresh.length;
      };
      tx.onerror = () => {
        this.stats.failed += fresh.length;
      };
    } catch {
      this.stats.failed += fresh.length;
    }
  }

  /** How many words are in memory just now. */
  get size(): number {
    return this.mem.size;
  }

  report(): Record<string, unknown> {
    return { state: this.state, held: this.mem.size, ...this.stats };
  }
}
