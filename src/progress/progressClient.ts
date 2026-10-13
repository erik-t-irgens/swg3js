// This browser's half of a character's progress: the copy it keeps of the character in play, who holds it just
// now, and the batches applied to it.
//
// **Who holds it.** The story book's rule in its shape: with no server, an old relay or a server whose greeting
// says nothing of progress, this browser does (`local`): a batch is applied here at once, kept in storage and
// counted in `local`, which the character's change counter reads, so an evening of progress offline settles this
// browser's way as the rest of the character does. With a server whose greeting holds progress the server will
// (`server`), and in between nobody changes it (`held`); both are the line's, which a later wave builds: until
// then this browser always holds it.
//
// **Whose count.** `localOf(char)` answers for the character asked about, never for whoever is held: its own
// count while it holds that character, else the stored record's, since a character's mark is sometimes worked
// out (behind a loading screen, for a record rewritten once) before its record is the one held here.
//
// Nothing in here touches the page, three or a socket: the storage and the clock are handed in, so the node
// tests drive it over a map, and the whole folder ships with the release by one rule.

import { grantChanges, resetChanges, unlearnChanges, xpChanges } from './learn.ts';
import { applyProgress, emptyRecord, recordSummary, secondsOf, type ProgressChange, type ProgressRecord } from './record.ts';
import { loadRecord, localOf, saveRecord, type ProgressStorage } from './progressStore.ts';
import { PROGRESS_LIMITS, PROGRESS_RULES, tuneProgress } from './tune.ts';

export type ProgressHost = 'local' | 'server' | 'held';

/**
 * Why the record changed, as its listeners are told: a character's record read in (`use`), a batch applied here
 * with nobody else holding it (`mine`), a server's batch (`server`), or the copy a server settled on (`settled`),
 * which is not a change to the character though it moves `local` back to nought.
 */
export type ProgressWhy = 'use' | 'mine' | 'server' | 'settled';

export interface ProgressDeps {
  store: ProgressStorage;
  /** The shared clock, in milliseconds: what every time in a record is written on, in whole seconds. */
  now(): number;
}

/** What the console asks of the record held here (`__debug.progress`). */
export interface ProgressDebugAsk {
  grant?: string;
  surrender?: string;
  xp?: Record<string, unknown>;
  reset?: boolean;
  rules?: Record<string, unknown>;
  rate?: number;
}

export class ProgressClient {
  private readonly deps: ProgressDeps;
  private rec: ProgressRecord | null = null;
  private readonly listeners = new Set<(why: ProgressWhy, localWas: number) => void>();
  readonly stats = { batches: 0, changes: 0, refused: 0, lastWhy: '' };

  constructor(deps: ProgressDeps) {
    this.deps = deps;
  }

  /** The record as this browser holds it, or null with no character in play. Read, never written to. */
  get record(): ProgressRecord | null {
    return this.rec;
  }

  /** Who holds the record just now: this browser, until the line that hands it to a server is built. */
  get host(): ProgressHost {
    return 'local';
  }

  /** Batches applied here with nobody else holding the record, since a server last matched it. */
  get local(): number {
    return this.rec?.local ?? 0;
  }

  /** The same count for any character: this browser's own while it holds that one, else the stored record's. */
  localOf(char: string): number {
    if (this.rec && this.rec.char === char) return this.rec.local;
    return localOf(this.deps.store, char);
  }

  /** Be told whenever the record changes, why, and the count of batches made alone it held just before. */
  onChange(fn: (why: ProgressWhy, localWas: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(why: ProgressWhy, localWas: number): void {
    for (const fn of this.listeners) {
      try {
        fn(why, localWas);
      } catch (err) {
        console.warn('progress: a listener failed', err);
      }
    }
  }

  /** The character in play, whose record is read from storage; null when there is none (the select screen, the creator). */
  use(char: string | null): void {
    if ((this.rec?.char ?? null) === char) return;
    this.rec = char ? (loadRecord(this.deps.store, char) ?? emptyRecord(char)) : null;
    this.emit('use', this.rec?.local ?? 0);
  }

  /**
   * A batch worked out here, applied to the record held as a change made here: under this browser's own limits,
   * kept, counted in `local` and told. Answers how many changes it took and why it would not take the rest.
   */
  apply(ch: ProgressChange[], why: ProgressWhy = 'mine'): { changed: number; why: string[] } {
    const rec = this.rec;
    if (!rec) return { changed: 0, why: ['there is no character in play'] };
    if (!ch.length) return { changed: 0, why: [] };
    const out = applyProgress(rec, ch, PROGRESS_LIMITS);
    this.stats.refused += out.why.length;
    if (!out.changed) return out;
    const was = rec.local;
    rec.local++;
    saveRecord(this.deps.store, rec);
    this.stats.batches++;
    this.stats.changes += out.changed;
    this.stats.lastWhy = why;
    this.emit(why, was);
    return out;
  }

  /** Now on the shared clock, in the whole seconds a record keeps. */
  private at(): number {
    return secondsOf(this.deps.now());
  }

  /**
   * The console's asks, each through the same `applyProgress` as everything else: a node granted (with what it
   * needs above it), one taken away (with what stands on it), XP given, the record emptied, the rules moved, or
   * the XP rate. Answers what each came to.
   */
  debug(op: ProgressDebugAsk): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    if (op.rules) {
      tuneProgress({ rules: op.rules });
      results.push({ rules: 'moved' });
    }
    if (typeof op.rate === 'number' && Number.isFinite(op.rate)) {
      tuneProgress({ rules: { xpRate: op.rate } });
      results.push({ rate: PROGRESS_RULES.xpRate });
    }
    const rec = this.rec;
    const want = op.grant !== undefined || op.surrender !== undefined || op.xp !== undefined || op.reset;
    if (want && !rec) {
      results.push({ ok: false, why: 'there is no character in play' });
      return results;
    }
    if (!rec) return results;
    const run = (what: string, r: { ch: ProgressChange[]; why?: string }): void => {
      if (r.why && !r.ch.length) {
        results.push({ do: what, ok: false, why: r.why });
        return;
      }
      const out = this.apply(r.ch);
      results.push({ do: what, ok: out.changed > 0, changed: out.changed, ...(r.why || out.why.length ? { why: [r.why, ...out.why].filter(Boolean).join('; ') } : {}) });
    };
    if (op.reset) run('reset', { ch: resetChanges(rec) });
    if (typeof op.surrender === 'string') run(`surrender ${op.surrender}`, unlearnChanges(rec, op.surrender, this.at()));
    if (typeof op.grant === 'string') run(`grant ${op.grant}`, grantChanges(rec, op.grant, this.at(), PROGRESS_RULES));
    if (op.xp && typeof op.xp === 'object') run('xp', xpChanges(rec, op.xp, PROGRESS_RULES));
    return results;
  }

  /** What `__debug.progress()` prints of the record and its host. */
  report(): Record<string, unknown> {
    return { host: this.host, ...(recordSummary(this.rec) ?? { char: null }), stats: { ...this.stats } };
  }
}
