// This browser's half of a character's progress: the copy it keeps of the character in play, who holds it just
// now, and the batches applied to it.
//
// **Who holds it.** The story book's rule in its shape: with no server, an old relay or a server whose greeting
// says nothing of progress, this browser does (`local`): a batch is applied here at once, kept in storage and
// counted in `local`, which the character's change counter reads, so an evening of progress offline settles this
// browser's way as the rest of the character does. With a server whose greeting says `progress` the server does
// (`server`): this browser only claims, and shows what the server's batch (`ch`) says. In between -- the claim not
// yet answered, a tie still put to the player, a line that has dropped and is coming back -- nobody changes it
// (`held`), and what would have changed it waits in a queue for whoever holds it next.
//
// **Settling.** Once the server has this browser's claim (or the player has answered a tie), it says what it holds
// (`sync`): whether its copy has anything in it, its revision, the server revision it last matched and how many
// batches it made alone. The server answers with its own record (`rec`) or asks for this one (`want`), which goes up
// in pieces, the first no sooner than `offerDelay` after the claim was answered and one each `offerGap` after, so
// it never lands in the second the item list and the story book's first piece do. A copy with batches of its own
// that the server did not take is set aside in storage, never thrown away, and the player is told once.
//
// **With a server this browser never adds XP.** A fight closed, a landing roll, a node learnt or given back go up
// as words, and the record moves only when the server's batch comes back, applied at the revision it made under the
// backstop, so the two copies stay one whatever either side's limits. A claim unanswered for `claimWait` is sent
// once more with the same id (the server's `paid` makes that safe), and one never answered is given up and said.
//
// **Whose count.** `localOf(char)` answers for the character asked about, never for whoever is held: its own
// count while it holds that character, else the stored record's, since a character's mark is sometimes worked
// out (behind a loading screen, for a record rewritten once) before its record is the one held here.
//
// Nothing in here touches the page, three or a socket: the storage, the clocks, the game's table and the line it
// speaks on are handed in, so the node tests drive it over a map and against the relay itself, and the whole folder
// ships with the release by one rule. Nothing runs in a frame: the wiring steps it four times a second.

import { grantChanges, learnChanges, questBonus, resetChanges, surrenderChanges, unlearnChanges, xpChanges, whyNotSurrender } from './learn.ts';
import { progressNotes, snapOf, type NoteKind, type ProgressSnap } from './notes.ts';
import { XpBuckets, payClaim, payTask, type EncounterClaim, type PayResult, type ProgressTask } from './payout.ts';
import { CORE_SKILLS, POOLS, RECORD_MAX, applyProgress, cleanRecord, copyRecord, emptyRecord, recordIsEmpty, recordSummary, recordText, secondsOf, type ProgressChange, type ProgressRecord } from './record.ts';
import { loadRecord, localOf, saveRecordText, setAside, type ProgressStorage } from './progressStore.ts';
import type { ConTable } from './challenge.ts';
import { nodeById } from './disciplines.ts';
import { PROGRESS_BACKSTOP, PROGRESS_LIMITS, PROGRESS_RULES, PROGRESS_RULE_BACKSTOP, PROGRESS_TUNE, tuneProgress } from './tune.ts';
import { chunkText, cleanProgressDown, recordWireText, type ProgressDown } from './wire.ts';

export type ProgressHost = 'local' | 'server' | 'held';

/**
 * Why the record changed, as its listeners are told: a character's record read in (`use`), a batch applied here
 * with nobody else holding it (`mine`), a server's batch (`server`), or the copy a server settled on (`settled`),
 * which is not a change to the character though it moves `local` back to nought.
 */
export type ProgressWhy = 'use' | 'mine' | 'server' | 'settled';

/** What the line is doing, as the session and the socket say it (`src/net/session.ts`, `src/net/net.ts`). */
export interface ProgressLine {
  authority: 'me' | 'server';
  /** The progress a server's hail said it holds; 0 for none, which is every far end before this. */
  progress: number;
  status: 'off' | 'connecting' | 'online' | 'reconnecting';
  mode: 'off' | 'waiting' | 'relay' | 'server';
}

export interface ProgressDeps {
  store: ProgressStorage;
  /** The shared clock, in milliseconds: what every time in a record is written on, in whole seconds. */
  now(): number;
  /** The game's own challenge table, or null until it lands (and for good without it). */
  levels?(): ConTable | null;
  /** One line for the message line. */
  say?(line: string): void;
  /** A word to the server. Absent, nothing is ever sent. */
  send?(msg: Record<string, unknown>): void;
  /** What the line is doing. Absent, this browser always holds the record. */
  line?(): ProgressLine;
  /** The wall clock, in milliseconds: what the pacing and the waits run on. */
  wall?(): number;
  /** Whether the character's own record says a server has held it before. */
  known?(): boolean;
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
  /** Say what this copy holds to the server again, and wait for its answer. */
  sync?: boolean;
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
  /** Gone to the server, which answers with its batch (or in words); nothing has changed here yet. */
  sent?: boolean;
  /** Waiting for whoever holds the record next: nobody may change it just now. */
  queued?: boolean;
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

/** Something that would change the record, waiting for whoever holds it next. */
type Waiting = { kind: 'claim'; c: EncounterClaim } | { kind: 'task'; t: ProgressTask } | { kind: 'learn'; node: string; teacher: string | null };

/** A claim or a task gone to the server and not yet answered: when it went, and whether it has gone twice. */
interface Pending {
  w: Waiting;
  at: number;
  resent: boolean;
}

export class ProgressClient {
  private readonly deps: ProgressDeps;
  private rec: ProgressRecord | null = null;
  private readonly listeners = new Set<(why: ProgressWhy, localWas: number) => void>();
  private readonly answerers = new Set<(id: string, paid: Record<string, number>, why?: string) => void>();
  readonly stats = { batches: 0, changes: 0, refused: 0, lastWhy: '', syncs: 0, offers: 0, pieces: 0, records: 0, taken: 0, setAside: 0, served: 0, gaps: 0, refusals: 0, sent: 0, resent: 0, unanswered: 0, queued: 0, dropped: 0 };
  private kind: ProgressHost = 'local';
  /** Whether the line that has us now (or had, while it comes back) holds progress. */
  private progressLine = false;
  /** Whether the server's record has arrived on this line: until it has, nobody changes anything. */
  private settled = false;
  /** A `sync` gone and not answered, and when it went (the wall clock). */
  private settling = false;
  private syncAt = 0;
  /** When the claim was last answered, which the first piece of a record handed up waits `offerDelay` after. */
  private claimedAt = 0;
  /** This record going up, a piece at a time, each due at its own moment. */
  private offer: { id: number; parts: string[]; next: number; due: number } | null = null;
  private offerId = 1;
  /** What waits for whoever holds the record next, oldest first, and when the last went up. */
  private readonly queue: Waiting[] = [];
  private lastSent = 0;
  /** Claims and tasks gone up and not yet answered, by their ids. */
  private readonly pending = new Map<string, Pending>();
  /** The last refusal the server said, and the XP rate it says it pays at. */
  private lastNo = '';
  private serverRate: number | null = null;

  constructor(deps: ProgressDeps) {
    this.deps = deps;
  }

  /** The record as this browser holds it, or null with no character in play. Read, never written to. */
  get record(): ProgressRecord | null {
    return this.rec;
  }

  /** Who holds the record just now, worked out from the line as it is this moment. */
  get host(): ProgressHost {
    this.derive();
    return this.kind;
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

  /**
   * Be told what a claim or a task sent to a server came to: what each pool gained, or why nothing was (the
   * console's fight list keeps it beside the claim). With this browser holding the record the answer is the
   * outcome `claim` hands back at once, and nothing is told here.
   */
  onAnswer(fn: (id: string, paid: Record<string, number>, why?: string) => void): () => void {
    this.answerers.add(fn);
    return () => this.answerers.delete(fn);
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

  private answer(id: string, paid: Record<string, number>, why?: string): void {
    for (const fn of this.answerers) {
      try {
        fn(id, paid, why);
      } catch (err) {
        console.warn('progress: a listener failed', err);
      }
    }
  }

  private wall(): number {
    return this.deps.wall ? this.deps.wall() : Date.now();
  }

  /** The character in play, whose record is read from storage; null when there is none (the select screen, the creator). */
  use(char: string | null): void {
    if ((this.rec?.char ?? null) === char) return;
    this.offer = null;
    this.queue.length = 0;
    this.pending.clear();
    this.settled = false;
    this.settling = false;
    this.rec = char ? (loadRecord(this.deps.store, char) ?? emptyRecord(char)) : null;
    this.derive();
    this.emit('use', this.rec?.local ?? 0);
  }

  // ---- the line ---------------------------------------------------------------------------------------------

  /**
   * Work out who holds the record from what the line is doing. Cheap, and asked at every step. Leaving the server
   * puts what went up unanswered back at the front of the queue, for whoever holds the record next: a server that
   * paid one already finds its id in `paid` and pays nothing, and this browser alone pays it once in its own copy.
   */
  private derive(): void {
    const l = this.deps.line?.();
    const was = this.kind;
    if (l && l.authority === 'server' && l.progress >= 1) {
      this.progressLine = true;
      this.kind = this.settled ? 'server' : 'held';
    } else if (l && l.authority !== 'server' && this.progressLine && l.status !== 'off' && l.mode !== 'relay') {
      // The line that held progress has dropped and is coming back: nobody changes the record meanwhile, or two
      // copies would part ways. A `sync` that was waiting on an answer is forgotten with the line it went on.
      this.settled = false;
      this.settling = false;
      this.kind = 'held';
    } else {
      this.progressLine = false;
      this.settled = false;
      this.settling = false;
      this.kind = 'local';
    }
    if (was === 'server' && this.kind !== 'server') {
      this.offer = null;
      if (this.pending.size) {
        const back = [...this.pending.values()].map((p) => p.w);
        this.pending.clear();
        this.queue.unshift(...back);
      }
    }
    if (this.kind !== 'held' && this.kind !== 'server') this.offer = null;
  }

  /**
   * A server has this browser's claim. When its hail spoke of progress the record is settled now, unless the two
   * copies of the character tie and the player has still to say which stands (`tieWaiting`), which waits for their
   * answer (`answered`). A tie answered from memory is answered before the claim is, so it is the question still
   * standing that is asked, never the server's word for how it settled.
   */
  claimed(tieWaiting: boolean): void {
    this.settled = false;
    this.settling = false;
    this.offer = null;
    this.claimedAt = this.wall();
    this.derive();
    if (this.progressLine && !tieWaiting) this.sync();
  }

  /** The tie was answered, by the player or for them: the record is settled now. */
  answered(): void {
    this.claimedAt = this.wall();
    this.derive();
    if (this.progressLine) this.sync();
  }

  /** Whether the character's own record, or this copy, says a server has held it before. */
  private known(): boolean {
    return !!this.deps.known?.() || (this.rec?.base ?? 0) > 0;
  }

  /**
   * Say what this copy holds, and wait for the server's answer with nobody changing anything. Only on a line the
   * server has claimed: what a `sync` is answered with is read off how the claim settled, so one that went ahead of
   * the claim's answer would be answered for a question the player had not yet been put.
   */
  private sync(): void {
    const rec = this.rec;
    const l = this.deps.line?.();
    if (!rec || !l || l.authority !== 'server' || !this.deps.send) return;
    this.settled = false;
    this.settling = true;
    this.offer = null;
    this.syncAt = this.wall();
    this.derive();
    this.stats.syncs++;
    this.deps.send({ t: 'progress', do: 'sync', has: recordIsEmpty(rec) && rec.local === 0 ? 0 : 1, rev: rec.rev, base: rec.base, local: rec.local, known: this.known() ? 1 : 0 });
  }

  /** A progress word from the server, handed over whole. */
  word(msg: Record<string, unknown>): void {
    const w = cleanProgressDown(msg);
    if (!w || !this.rec) return;
    this.derive();
    if (!this.progressLine) return;
    if (w.do === 'want') this.startOffer();
    else if (w.do === 'rec') this.takeRecord(w);
    else if (w.do === 'ch') this.serverBatch(w);
    else this.refusal(w);
  }

  /** The server asked for this record: it goes up in pieces, the first `offerDelay` after the claim and the rest a gap apart. */
  private startOffer(): void {
    if (!this.settling || !this.rec) return;
    const now = this.wall();
    this.offer = { id: this.offerId++, parts: chunkText(recordWireText(this.rec), PROGRESS_TUNE.offerChunk), next: 0, due: Math.max(now, this.claimedAt + PROGRESS_TUNE.offerDelay) };
    if (now >= this.offer.due) this.sendPiece(now);
  }

  private sendPiece(now: number): void {
    const o = this.offer;
    if (!o || !this.deps.send) return;
    this.deps.send({ t: 'progress', do: 'offer', id: o.id, n: o.next, of: o.parts.length, part: o.parts[o.next], known: this.known() ? 1 : 0 });
    o.next++;
    o.due = now + PROGRESS_TUNE.offerGap;
    this.stats.pieces++;
    if (o.next >= o.parts.length) {
      this.offer = null;
      this.stats.offers++;
      // The answer is waited on from the last piece, not from the question.
      this.syncAt = now;
    }
  }

  /**
   * The server's record. Only one this browser is waiting on is taken: every one it is handed answers a `sync` it
   * sent. Once taken it is this browser's copy from then on, matched to the server's revision with nothing made
   * alone; a copy with batches made here that the server did not take is set aside first, and the player told.
   */
  private takeRecord(w: Extract<ProgressDown, { do: 'rec' }>): void {
    if (!this.settling) return;
    const mine = this.rec!;
    // Under the backstops alone, the rules' caps as well as the lists': the server may pay to caps of its own,
    // and a record cut here to this browser's would part from the server's at the very revision it was handed.
    const got = cleanRecord(w.rec, PROGRESS_BACKSTOP, PROGRESS_RULE_BACKSTOP);
    if (!got || got.char !== mine.char) {
      this.stats.lastWhy = 'the server’s record could not be read';
      return;
    }
    if (w.rate !== undefined) this.serverRate = w.rate;
    this.stats.records++;
    if (w.take === 'browser') this.stats.taken++;
    else if (mine.local > 0) {
      // Played in two places: the server's copy stands, and this one is kept aside, never thrown away.
      if (setAside(this.deps.store, mine)) this.stats.setAside++;
      this.deps.say?.('This character’s progress was made in two places; the server’s copy stands, and this browser’s is kept aside.');
    }
    const localWas = mine.local;
    got.base = got.rev;
    got.local = 0;
    this.rec = got;
    saveRecordText(this.deps.store, got.char, recordText(got));
    this.settled = true;
    this.settling = false;
    this.derive();
    this.emit('settled', localWas);
  }

  /**
   * A batch of the server's at a revision: applied when it is the next one, under the backstop (it was made under
   * the server's own limits, its trims written into it), and asked for again whole when it is not. What it came to
   * is said on the message line in words worked out from the record before it and after, as a batch made here is.
   */
  private serverBatch(w: Extract<ProgressDown, { do: 'ch' }>): void {
    const rec = this.rec;
    // Before the record has come, a batch is not this copy's to apply: the record that answers the sync has it.
    if (!rec || !this.settled) return;
    if (w.rev <= rec.rev) return;
    if (w.rev !== rec.rev + 1) {
      this.stats.gaps++;
      this.sync();
      return;
    }
    const before = snapOf(rec);
    const draft = copyRecord(rec);
    const out = applyProgress(draft, w.ch, PROGRESS_BACKSTOP);
    this.stats.refused += out.why.length;
    const localWas = draft.local;
    draft.rev = w.rev;
    draft.base = w.rev;
    draft.local = 0;
    this.rec = draft;
    saveRecordText(this.deps.store, draft.char, recordText(draft));
    this.stats.served++;
    this.stats.changes += out.changed;
    const kind: NoteKind = w.kind === 'admin' ? 'claim' : w.kind;
    for (const n of progressNotes(kind, before, draft, PROGRESS_RULES, w.fee ?? 0)) this.deps.say?.(n);
    this.emit('server', localWas);
    if (w.of && this.pending.delete(w.of)) this.answer(w.of, gainsOf(before, draft));
  }

  /** The server said no: about a claim or a task gone up, kept quiet and handed to whoever asked what it came to; about anything else, said. */
  private refusal(w: Extract<ProgressDown, { do: 'no' }>): void {
    this.stats.refusals++;
    this.lastNo = w.why;
    if (w.of && this.pending.delete(w.of)) {
      this.answer(w.of, {}, w.why);
      return;
    }
    this.deps.say?.(w.why);
  }

  /**
   * The pacing and the waits, four times a second off the frame: a record going up a piece at a time, a `sync`
   * or a claim unanswered asked again once, and the queue sent to whoever holds the record now -- the server a
   * claim every `claimGap`, or this browser all at once.
   */
  step(now: number): void {
    this.derive();
    if (!this.rec) return;
    if (this.kind === 'local') {
      this.flush(now);
      return;
    }
    if (this.offer) {
      if (now >= this.offer.due) this.sendPiece(now);
    } else if (this.settling && now - this.syncAt > PROGRESS_TUNE.claimWait) this.sync();
    if (this.kind !== 'server') return;
    for (const [id, p] of this.pending) {
      if (now - p.at < PROGRESS_TUNE.claimWait) continue;
      if (!p.resent) {
        p.resent = true;
        p.at = now;
        this.stats.resent++;
        this.sendWaiting(p.w);
      } else {
        this.pending.delete(id);
        this.stats.unanswered++;
        this.answer(id, {}, 'the server never answered');
      }
    }
    this.flush(now);
  }

  /** What waits goes to whoever holds the record: this browser all at once, the server one every `claimGap`. */
  private flush(now: number): void {
    if (!this.queue.length || this.kind === 'held') return;
    if (this.kind === 'local') {
      while (this.queue.length) this.runHere(this.queue.shift()!);
      return;
    }
    if (now - this.lastSent < PROGRESS_TUNE.claimGap) return;
    const w = this.queue.shift()!;
    this.lastSent = now;
    const id = w.kind === 'claim' ? w.c.id : w.kind === 'task' ? w.t.id : '';
    if (id) this.pending.set(id, { w, at: now, resent: false });
    this.sendWaiting(w);
  }

  private sendWaiting(w: Waiting): void {
    if (!this.deps.send) return;
    this.stats.sent++;
    if (w.kind === 'claim') this.deps.send({ t: 'progress', do: 'claim', c: w.c });
    else if (w.kind === 'task') this.deps.send({ t: 'progress', do: 'task', k: w.t });
    else this.deps.send({ t: 'progress', do: 'learn', node: w.node, teacher: w.teacher });
  }

  /** Something that waited, done here now that this browser holds the record, and what it came to told as a server's answer would be. */
  private runHere(w: Waiting): void {
    if (w.kind === 'claim') {
      const o = this.claim(w.c);
      this.answer(w.c.id, o.paid ?? {}, o.why);
    } else if (w.kind === 'task') {
      const o = this.task(w.t);
      this.answer(w.t.id, o.paid ?? {}, o.why);
    } else {
      const o = this.learn(w.node, w.teacher);
      if (!o.ok && o.why) this.deps.say?.(o.why);
    }
  }

  /**
   * Hand something up to the server, or keep it for whoever holds the record next: it waits its turn in the queue,
   * the server's words a gap apart so a fight's claims never pass what a server takes from one line in a second.
   */
  private goUp(w: Waiting): ProgressOutcome {
    if (this.queue.length >= PROGRESS_TUNE.claimQueue) {
      this.stats.dropped++;
      return { ok: false, changed: 0, why: `${this.queue.length} things are already waiting on the server`, notes: [] };
    }
    this.queue.push(w);
    this.stats.queued++;
    if (this.kind === 'server') {
      this.flush(this.wall());
      return { ok: true, changed: 0, sent: true, why: 'asked of the server', notes: [] };
    }
    return { ok: true, changed: 0, queued: true, why: 'waiting for the server', notes: [] };
  }

  /** Why nothing may change the record just now: a line that has the claim is settling it, one that has not is not answering. */
  private held(): ProgressOutcome {
    return { ok: false, changed: 0, why: this.deps.line?.().authority === 'server' ? 'this character’s progress is being settled with the server' : 'held by the server, which is not answering', notes: [] };
  }

  // ---- this browser alone -----------------------------------------------------------------------------------

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

  /** Who holds the record may change it here: this browser, alone, whenever a character is in play. */
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

  /** A fight closed (`encounter.ts`): what it pays, worked out here and applied, or handed up to the server that holds the record. */
  claim(c: EncounterClaim): ProgressOutcome {
    if (!this.rec) return { ok: false, changed: 0, why: 'there is no character in play', notes: [] };
    if (this.host !== 'local') return this.goUp({ kind: 'claim', c });
    const r = payClaim(this.rec, c, { now: this.deps.now(), levels: this.deps.levels?.() ?? null, rules: PROGRESS_RULES, limits: PROGRESS_LIMITS, bucket: this.buckets });
    return this.settle('claim', r as { ch: ProgressChange[]; why?: string; paid?: Record<string, number>; pools?: PayResult['pools'] });
  }

  /** A landing roll that saved some of a fall: what it pays into Acrobatics. */
  task(t: ProgressTask): ProgressOutcome {
    if (!this.rec) return { ok: false, changed: 0, why: 'there is no character in play', notes: [] };
    if (this.host !== 'local') return this.goUp({ kind: 'task', t });
    const r = payTask(this.rec, t, { now: this.deps.now(), levels: null, rules: PROGRESS_RULES, limits: PROGRESS_LIMITS, bucket: this.buckets });
    return this.settle('task', r as { ch: ProgressChange[]; why?: string; paid?: Record<string, number> });
  }

  /** A node learnt from a teacher (the kind of person in reach, or null), by the rule the record's host applies. */
  learn(node: string, teacher: string | null): ProgressOutcome {
    if (!this.rec) return { ok: false, changed: 0, why: 'there is no character in play', notes: [] };
    if (this.host !== 'local') return this.goUp({ kind: 'learn', node, teacher });
    return this.settle('learn', learnChanges(this.rec, node, teacher, this.at(), PROGRESS_RULES));
  }

  /**
   * A node given back to a teacher, for its fee: the rule asked first, then the purse asked for the fee, and only
   * once the money really went is the node given back -- worked out again then, against the record as it stands,
   * so nothing that happened while the purse answered can be undone. `done` hears what it came to. With a server
   * holding the record the server does both in one step, the fee through its own purse and the node in the same
   * breath, so this asks it and the answer is its batch.
   *
   * **One at a time.** A server's purse keeps one answer waiting, and a second spend asked before the first is
   * answered takes its place: both fees would go and only the second's `then` would run, against a record the
   * first had not yet changed, and be refused. So nothing is given back while the purse is still answering for
   * anything (`busy`), and a refusal after the fee went -- the node learnt upon or the character gone meanwhile --
   * is said, in words that say the fee went, rather than dropped.
   */
  surrender(node: string, teacher: string | null, purse: FeePurse, done?: (o: ProgressOutcome) => void): ProgressOutcome {
    if (!this.rec) return { ok: false, changed: 0, why: 'there is no character in play', notes: [] };
    if (purse.busy?.()) return { ok: false, changed: 0, why: 'the purse is still answering for the last thing asked of it: give it a moment', notes: [] };
    const host = this.host;
    if (host === 'held') return this.held();
    if (host === 'server') {
      const why = whyNotSurrender(this.rec, node, teacher);
      if (why) return { ok: false, changed: 0, why, notes: [] };
      this.deps.send?.({ t: 'progress', do: 'surrender', node, teacher });
      this.stats.sent++;
      return { ok: true, changed: 0, sent: true, why: 'asked of the server', notes: [] };
    }
    const first = surrenderChanges(this.rec, node, teacher, this.at(), PROGRESS_RULES);
    if (first.why) return { ok: false, changed: 0, why: first.why, notes: [] };
    const char = this.rec.char;
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

  /** A quest's bonus, paid into the skills used since its run began (`since`, the shared clock's milliseconds). A server holding the record pays its own. */
  bonus(key: string, xp: number, since: number): ProgressOutcome {
    if (!this.mine) return { ok: false, changed: 0, why: this.rec ? 'the server that holds this character’s progress pays it' : 'there is no character in play', notes: [] };
    return this.settle('bonus', questBonus(this.rec!, key, xp, since, { now: this.deps.now(), rules: PROGRESS_RULES, limits: PROGRESS_LIMITS }));
  }

  /** Now on the shared clock, in the whole seconds a record keeps. */
  private at(): number {
    return secondsOf(this.deps.now());
  }

  /**
   * The console's asks, each through the same `applyProgress` as everything else: a node granted (with what it
   * needs above it), one taken away (with what stands on it), XP given, the record emptied, the rules moved, or
   * the XP rate. With a server holding the record the grant, the XP and the emptying are the admin's and go to the
   * server, the rate is the server's to say, and asking again for its copy is `sync`. Answers what each came to.
   */
  debug(op: ProgressDebugAsk): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    const host = this.rec ? this.host : 'local';
    if (op.rules) {
      tuneProgress({ rules: op.rules });
      results.push(host === 'local' ? { rules: 'moved' } : { rules: 'moved here', why: 'the server pays by its own rules: --set progress.rules.<name>=<n> when it starts' });
    }
    if (typeof op.rate === 'number' && Number.isFinite(op.rate)) {
      if (host === 'local') {
        tuneProgress({ rules: { xpRate: op.rate } });
        results.push({ rate: PROGRESS_RULES.xpRate });
      } else results.push({ rate: this.serverRate, why: `the server pays at its own rate${this.serverRate === null ? '' : ` (${this.serverRate})`}: --set progress.rules.xpRate=<n> when it starts` });
    }
    const rec = this.rec;
    const want = op.grant !== undefined || op.surrender !== undefined || op.xp !== undefined || op.reset || op.learn !== undefined;
    if (want && !rec) {
      results.push({ ok: false, why: 'there is no character in play' });
      return results;
    }
    if (!rec) return results;
    if (op.sync) {
      if (this.progressLine && this.deps.line?.().authority === 'server') {
        this.sync();
        results.push({ do: 'sync', sent: true });
      } else results.push({ do: 'sync', ok: false, why: 'no server holds this character’s progress' });
    }
    if (host !== 'local') {
      if (host === 'held' && want) {
        results.push({ ok: false, why: this.held().why });
        return results;
      }
      const send = (msg: Record<string, unknown>, what: string): void => {
        this.deps.send?.({ t: 'progress', ...msg });
        results.push({ do: what, sent: true, why: 'the admin’s alone: anybody else is refused in words' });
      };
      if (op.reset) send({ do: 'reset' }, 'reset');
      if (typeof op.surrender === 'string') results.push({ do: `surrender ${op.surrender}`, ok: false, why: 'with a server, a node is given back at a trainer, for its fee' });
      if (typeof op.grant === 'string') send({ do: 'grant', node: op.grant }, `grant ${op.grant}`);
      if (op.xp && typeof op.xp === 'object') for (const k of Object.keys(op.xp)) if (typeof op.xp[k] === 'number') send({ do: 'xp', src: k, n: op.xp[k] }, `xp ${k}`);
      if (typeof op.learn === 'string') {
        const o = this.learn(op.learn, op.teacher ?? null);
        results.push({ do: `learn ${op.learn}`, ok: o.ok, ...(o.why ? { why: o.why } : {}) });
      }
      return results;
    }
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

  /** What `__debug.progress()` prints of the record, its host and the line. */
  report(): Record<string, unknown> {
    const host = this.host;
    return {
      host,
      line: {
        progress: this.progressLine,
        settled: this.settled,
        settling: this.settling,
        offering: this.offer ? `${this.offer.next} of ${this.offer.parts.length}` : null,
        queued: this.queue.length,
        waiting: [...this.pending.keys()],
        lastNo: this.lastNo || null,
        serverRate: this.serverRate,
      },
      ...(recordSummary(this.rec) ?? { char: null }),
      stats: { ...this.stats },
    };
  }
}

/** What each core skill and pool gained between a record before a batch and after it, whole. */
function gainsOf(before: ProgressSnap, after: ProgressRecord): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of CORE_SKILLS) {
    const d = (after.core[s] ?? 0) - (before.core[s] ?? 0);
    if (d > 0) out[s] = d;
  }
  for (const p of POOLS) {
    const d = (after.pools[p] ?? 0) - (before.pools[p] ?? 0);
    if (d > 0) out[p] = d;
  }
  return out;
}
