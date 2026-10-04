// The client's own words, as the browser has them: each string table the `conversations` command wrote
// (`assets-private/conversations/strings/<the client's path>.json`), fetched the first time something asks
// for it and kept for the session. A conversation's lines, a greeting from a reaction table and a herald's
// waypoint are all references to these (`@conversation/heraldcorellia2:s_17f4a48e`, `text.ts`); this is what
// answers them.
//
// **Nothing waits on it.** Asking for a line that has not come answers null at once and sets the table on
// its way, so whatever shows the words shows `[…]` for the moment and is told when the table lands
// (`onLoad`), which a conversation uses to say the line again. To make that moment rare, the game asks for
// the tables of whoever stands near (`want`) well before anybody is spoken to (`STRINGS_TUNE.fetchReach`).
// A table that will not come is asked for again only after `retry`, and is said once in the console.
//
// `%TU` and `%NU` are the player's name in the client's lines (and in its taunts), which only the page knows,
// so they are filled where the words are shown (`fillName`).
//
// Pure of the page: `fetch` is handed in, so a node test can be the server. Every number here is ours.

/** Every number of ours the strings read. */
export const STRINGS_TUNE = {
  /** Metres within which a standing person's tables are fetched before anybody speaks to them. */
  fetchReach: 30,
  /** Milliseconds before a table that would not come is asked for again. */
  retry: 30000,
  /** The most tables fetched at once. */
  inFlight: 4,
};

/** A table path the converter writes: the client's own (`conversation/heraldcorellia1`), with nothing that climbs. */
const TABLE = /^[A-Za-z0-9_][A-Za-z0-9_/.-]{0,160}$/;
/** A part of a path that is `.` or `..`, an empty part, or a path ending in a slash: what a table never has. */
const NOT_A_PART = /(?:^|\/)\.{1,2}(?:\/|$)|\/\/|\/$/;

/** Whether a path is one the converter writes. Two tests and nothing made, since the nearby people's tables are asked for four times a second. */
export function isTablePath(t: string): boolean {
  return TABLE.test(t) && !NOT_A_PART.test(t);
}

/** The player's own name where the client's words write `%TU` or `%NU`. */
export function fillName(words: string, name: string): string {
  return words.includes('%') ? words.replace(/%TU|%NU/g, name) : words;
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

export class ClientStrings {
  private readonly base: string;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly tables = new Map<string, Map<string, string>>();
  /** Tables on their way, and those that would not come, with when they last failed. */
  private readonly loading = new Set<string>();
  private readonly failed = new Map<string, number>();
  private readonly queue: string[] = [];
  private readonly listeners = new Set<(table: string) => void>();
  readonly stats = { loaded: 0, failed: 0, asked: 0, misses: 0 };

  /** `base` is the page's own base (`import.meta.env.BASE_URL`). */
  constructor(base: string, fetcher: Fetcher, now: () => number = () => Date.now()) {
    this.base = `${base.endsWith('/') ? base : `${base}/`}assets-private/conversations/strings/`;
    this.fetcher = fetcher;
    this.now = now;
  }

  /** The words of a key of a table, or null while the table has not come (it is asked for) or has no such key. */
  look(table: string, key: string): string | null {
    const t = this.tables.get(table);
    if (!t) {
      this.want(table);
      this.stats.misses++;
      return null;
    }
    const words = t.get(key);
    return words === undefined || words === '' ? null : words;
  }

  /** Whether a table has come. */
  has(table: string): boolean {
    return this.tables.has(table);
  }

  /** Whether a table holds a key with words, once it has come; null while it has not. */
  hasKey(table: string, key: string): boolean | null {
    const t = this.tables.get(table);
    return t ? !!t.get(key) : null;
  }

  /**
   * Set a table on its way, unless it is here, coming or failed a moment ago. Asked four times a second for
   * every table of everybody near, nearly always for one already here, so that is asked first.
   */
  want(table: string): void {
    if (this.tables.has(table) || this.loading.has(table) || !isTablePath(table) || this.queue.includes(table)) return;
    const failed = this.failed.get(table);
    if (failed !== undefined && this.now() - failed < STRINGS_TUNE.retry) return;
    this.queue.push(table);
    this.pump();
  }

  /** Be told whenever a table lands. Answers the way to stop being told. */
  onLoad(fn: (table: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private pump(): void {
    while (this.queue.length && this.loading.size < STRINGS_TUNE.inFlight) {
      const table = this.queue.shift()!;
      this.loading.add(table);
      this.stats.asked++;
      void this.fetchOne(table);
    }
  }

  private async fetchOne(table: string): Promise<void> {
    try {
      const res = await this.fetcher(`${this.base}${table.split('/').map(encodeURIComponent).join('/')}.json`);
      if (!res.ok) throw new Error(`${res.status ?? 'no answer'}`);
      const raw = (await res.json()) as Record<string, unknown>;
      const map = new Map<string, string>();
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const k of Object.keys(raw)) if (typeof raw[k] === 'string') map.set(k, raw[k] as string);
      this.tables.set(table, map);
      this.failed.delete(table);
      this.stats.loaded++;
      for (const fn of this.listeners) {
        try {
          fn(table);
        } catch (err) {
          console.warn('strings: a listener failed', err);
        }
      }
    } catch (err) {
      if (!this.failed.has(table)) console.info(`strings: the client's table ${table} did not come (${err instanceof Error ? err.message : String(err)}); run the conversations command`);
      this.failed.set(table, this.now());
      this.stats.failed++;
    } finally {
      this.loading.delete(table);
      this.pump();
    }
  }

  /** For the console. */
  report(): Record<string, unknown> {
    return { tables: [...this.tables.keys()].sort(), loading: [...this.loading], waiting: [...this.queue], failed: [...this.failed.keys()], stats: { ...this.stats }, tune: { ...STRINGS_TUNE } };
  }
}
