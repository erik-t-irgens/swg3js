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
// **What earns.** A fight closed (`claim`), a landing roll that saved some of a fall (`task`), a node learnt or
// given back at a trainer, a quest's bonus: each worked out here by the very rules a server will run
// (`payout.ts`, `learn.ts`) against the record as it stands, applied as one batch, and said on the message line
// in words worked out from the record before it and after (`notes.ts`). The buckets that hold each pool to so
// much a minute live here, in memory, by character.
//
// Nothing in here touches the page, three or a socket: the storage, the clock, the game's table and the line it
// speaks on are handed in, so the node tests drive it over a map, and the whole folder ships with the release by
// one rule.

import { grantChanges, learnChanges, questBonus, resetChanges, surrenderChanges, unlearnChanges, xpChanges, whyNotSurrender } from './learn.ts';
import { progressNotes, snapOf, type NoteKind } from './notes.ts';
import { XpBuckets, payClaim, payTask, type EncounterClaim, type PayResult, type ProgressTask } from './payout.ts';
import { RECORD_MAX, applyProgress, copyRecord, emptyRecord, recordSummary, recordText, secondsOf, type ProgressChange, type ProgressRecord } from './record.ts';
import { loadRecord, localOf, saveRecordText, type ProgressStorage } from './progressStore.ts';
import type { ConTable } from './challenge.ts';
import { nodeById } from './disciplines.ts';
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
  /** The game's own challenge table, or null until it lands (and for good without it). */
  levels?(): ConTable | null;
  /** One line for the message line. */
  say?(line: string): void;
}

/** What the console asks of the record held here (`__debug.progress`). */
export interface ProgressDebugAsk {
  grant?: string;
  surrender?: string;
  xp?: Record<string, unknown>;
  reset?: boolean;
  rules?: Record<string, unknown>;
  rate?: number;
  /** Learn a node through the real rule, from this teacher (the game hands in the one in reach, or the developer's). */
  learn?: string;
  teacher?: string | null;
}

/** What a payout, a learning or a giving back came to: how many changes went in, what each pool gained, why not. */
export interface ProgressOutcome {
  ok: boolean;
  changed: number;
  paid?: Record<string, number>;
  why?: string;
  /** The payout's working, for the console. */
  pools?: PayResult['pools'];
  notes: string[];
}

/**
 * What a purse is asked, for a fee: take it, and run `then` only once it really went (`src/net/purse.ts`); and
 * whether a spend is still waiting on its answer (`busy`), since a server's purse keeps one answer waiting at a
 * time and a second spend asked meanwhile takes the first one's place: both fees go, and only one `then` runs.
 */
export interface FeePurse {
  spend(amount: number, what: string, then: () => void): void;
  busy?(): boolean;
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
    // Tried on a copy, so a batch that would take the record past the most it may be written out as is refused
    // whole and leaves the record as it was (`RECORD_MAX`, the line a server will not take one past).
    const draft = copyRecord(rec);
    const out = applyProgress(draft, ch, PROGRESS_LIMITS);
    this.stats.refused += out.why.length;
    if (!out.changed) return out;
    const was = draft.local;
    draft.local++;
    const text = recordText(draft);
    if (text.length > RECORD_MAX) {
      this.stats.refused++;
      return { changed: 0, why: [...out.why, `the record would be ${text.length.toLocaleString('en-GB')} characters, past the ${RECORD_MAX.toLocaleString('en-GB')} it may be`] };
    }
    this.rec = draft;
    saveRecordText(this.deps.store, draft.char, text);
    this.stats.batches++;
    this.stats.changes += out.changed;
    this.stats.lastWhy = why;
    this.emit(why, was);
    return out;
  }

  /** The buckets each pool's pay is held to, by character, in memory: a reload empties them, and the record's `paid` keeps a claim from paying twice. */
  readonly buckets = new XpBuckets();

  /** Who holds the record may change it: this browser, in this wave, whenever a character is in play. */
  private get mine(): boolean {
    return !!this.rec && this.host === 'local';
  }

  /** A batch worked out by the rules, applied, and said: what it came to. */
  private settle(kind: NoteKind, r: { ch: ProgressChange[]; why?: string; paid?: Record<string, number>; pools?: PayResult['pools'] }, fee = 0): ProgressOutcome {
    const rec = this.rec;
    if (!rec) return { ok: false, changed: 0, why: 'there is no character in play', notes: [] };
    if (!r.ch.length) return { ok: false, changed: 0, ...(r.why ? { why: r.why } : {}), ...(r.pools ? { pools: r.pools } : {}), notes: [] };
    const before = snapOf(rec);
    const out = this.apply(r.ch);
    if (!out.changed) return { ok: false, changed: 0, why: out.why.join('; ') || 'the record would not take it', notes: [] };
    const notes = progressNotes(kind, before, this.rec!, PROGRESS_RULES, fee);
    for (const n of notes) this.deps.say?.(n);
    return { ok: true, changed: out.changed, ...(r.paid ? { paid: r.paid } : {}), ...(r.pools ? { pools: r.pools } : {}), ...(out.why.length ? { why: out.why.join('; ') } : {}), notes };
  }

  /** A fight closed (`encounter.ts`): what it pays, worked out here and applied. */
  claim(c: EncounterClaim): ProgressOutcome {
    if (!this.mine) return { ok: false, changed: 0, why: 'there is no character in play', notes: [] };
    const r = payClaim(this.rec!, c, { now: this.deps.now(), levels: this.deps.levels?.() ?? null, rules: PROGRESS_RULES, limits: PROGRESS_LIMITS, bucket: this.buckets });
    return this.settle('claim', r as { ch: ProgressChange[]; why?: string; paid?: Record<string, number>; pools?: PayResult['pools'] });
  }

  /** A landing roll that saved some of a fall: what it pays into Acrobatics. */
  task(t: ProgressTask): ProgressOutcome {
    if (!this.mine) return { ok: false, changed: 0, why: 'there is no character in play', notes: [] };
    const r = payTask(this.rec!, t, { now: this.deps.now(), levels: null, rules: PROGRESS_RULES, limits: PROGRESS_LIMITS, bucket: this.buckets });
    return this.settle('task', r as { ch: ProgressChange[]; why?: string; paid?: Record<string, number> });
  }

  /** A node learnt from a teacher (the kind of person in reach, or null), by the rule a server will apply. */
  learn(node: string, teacher: string | null): ProgressOutcome {
    if (!this.mine) return { ok: false, changed: 0, why: 'there is no character in play', notes: [] };
    return this.settle('learn', learnChanges(this.rec!, node, teacher, this.at(), PROGRESS_RULES));
  }

  /**
   * A node given back to a teacher, for its fee: the rule asked first, then the purse asked for the fee, and only
   * once the money really went is the node given back -- worked out again then, against the record as it stands,
   * so nothing that happened while the purse answered can be undone. `done` hears what it came to.
   *
   * **One at a time.** A server's purse keeps one answer waiting, and a second spend asked before the first is
   * answered takes its place: both fees would go and only the second's `then` would run, against a record the
   * first had not yet changed, and be refused. So nothing is given back while the purse is still answering for
   * anything (`busy`), and a refusal after the fee went -- the node learnt upon or the character gone meanwhile --
   * is said, in words that say the fee went, rather than dropped.
   */
  surrender(node: string, teacher: string | null, purse: FeePurse, done?: (o: ProgressOutcome) => void): ProgressOutcome {
    if (!this.mine) return { ok: false, changed: 0, why: 'there is no character in play', notes: [] };
    if (purse.busy?.()) return { ok: false, changed: 0, why: 'the purse is still answering for the last thing asked of it: give it a moment', notes: [] };
    const first = surrenderChanges(this.rec!, node, teacher, this.at(), PROGRESS_RULES);
    if (first.why) return { ok: false, changed: 0, why: first.why, notes: [] };
    const char = this.rec!.char;
    const name = nodeById(node)?.name ?? node;
    purse.spend(first.fee, `Giving back ${name}`, () => {
      // Still this character, and still allowed: the purse may answer after anything at all has happened.
      const why = !this.mine || this.rec!.char !== char ? 'the character changed' : whyNotSurrender(this.rec!, node, teacher);
      if (why) {
        const said = `The fee for ${name} went, and it was not given back: ${why}`;
        if (done) done({ ok: false, changed: 0, why: said, notes: [] });
        else this.deps.say?.(said);
        return;
      }
      const again = surrenderChanges(this.rec!, node, teacher, this.at(), PROGRESS_RULES);
      // Settled first and handed over after: `done?.(this.settle(...))` would never settle at all with no `done`,
      // since an optional call that is not made does not work out its arguments either.
      const out = this.settle('surrender', again, again.fee);
      if (done) done(out);
      else if (!out.ok && out.why) this.deps.say?.(`The fee for ${name} went, and it was not given back: ${out.why}`);
    });
    return { ok: true, changed: 0, why: 'asked the purse for the fee', notes: [] };
  }

  /** A quest's bonus, paid into the skills used since its run began (`since`, the shared clock's milliseconds). */
  bonus(key: string, xp: number, since: number): ProgressOutcome {
    if (!this.mine) return { ok: false, changed: 0, why: 'there is no character in play', notes: [] };
    return this.settle('bonus', questBonus(this.rec!, key, xp, since, { now: this.deps.now(), rules: PROGRESS_RULES, limits: PROGRESS_LIMITS }));
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
    const want = op.grant !== undefined || op.surrender !== undefined || op.xp !== undefined || op.reset || op.learn !== undefined;
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
    // Each asked of the record as the one before it left it: a batch applied is a new record object (`apply`).
    if (op.reset) run('reset', { ch: resetChanges(this.rec!) });
    if (typeof op.surrender === 'string') run(`surrender ${op.surrender}`, unlearnChanges(this.rec!, op.surrender, this.at()));
    if (typeof op.grant === 'string') run(`grant ${op.grant}`, grantChanges(this.rec!, op.grant, this.at(), PROGRESS_RULES));
    if (op.xp && typeof op.xp === 'object') run('xp', xpChanges(this.rec!, op.xp, PROGRESS_RULES));
    // Through the player's own rule, after any XP given in the same ask, so `{ xp, trainer, learn }` learns.
    if (typeof op.learn === 'string') {
      const o = this.learn(op.learn, op.teacher ?? null);
      results.push({ do: `learn ${op.learn}`, ok: o.ok, changed: o.changed, ...(o.why ? { why: o.why } : {}), ...(o.notes.length ? { said: o.notes } : {}) });
    }
    return results;
  }

  /** What `__debug.progress()` prints of the record and its host. */
  report(): Record<string, unknown> {
    return { host: this.host, ...(recordSummary(this.rec) ?? { char: null }), stats: { ...this.stats } };
  }
}
