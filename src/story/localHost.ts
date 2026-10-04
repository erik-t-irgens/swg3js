// The story held by this browser alone: with no server, against a relay whose greeting says nothing of a
// story, or with playing together switched off. It is the shared host loop (`hostCore.ts`) over the book
// this browser keeps (`bookClient.ts`) and the sets read here -- the committed test set and the owner's
// own folder -- and it pays what the rules say to pay out of this browser's own purse and backpack.
//
// **What it is handed.** Everything outside the rules comes in through `LocalDeps`: the book in hand and
// whether this browser holds it, the way a batch is applied to it (kept, counted as a change made here,
// told to whoever listens), the purse and the backpack, the message line, where the player is and the
// clock. Nothing here touches the page, three or a socket, so the node test runs it over the test set
// against a fake of each. The sets are read by whoever can read them (the browser fetches them, the
// test reads the folder) and handed in as files (`setSets`).
//
// **When it runs.** Only while this browser holds the book and a set has been read: before the sets
// arrive a book's quests would read as revised away and be held, so nothing is worked out until they
// have. A book newly in hand is settled at once -- revisions carried, deadlines that fell while nobody was
// looking settled in the order they fell -- as for a character not yet in the world, and the character
// is brought in (`enter`) the moment it is; going back to the select screen takes it out (`leave`), so a
// clock that counts only time played stops. While a server holds the book, or the line is coming back,
// what the detectors see is dropped and counted: a server holds that character's story, and from a later
// wave runs it. So it is, too, against a server that keeps the character's credits and holds no story (a
// relay from before the stories): only its admin may put credits in, so a job paid here would be recorded
// as paid and never arrive. The jobs wait for a server that holds both, or for none (`jobsWait`, which the
// wiring hands in as `holds` and `whyNot`).
//
// **Paying.** The book records a reward before anything is handed over, so a reward is never paid twice
// whatever happens between the two: credits go to the purse, a thing to the backpack (a character keeps
// one of each, so one already owned is said rather than given twice), experience is recorded and pays for
// nothing yet. A conversation's price (`charge`) is taken out of the purse each time it is charged.
//
// **Conversations.** Where one stands is kept here (`TalkState`), for this browser alone and never in the
// book, so a reload starts it cleanly; each node it reaches is handed to whoever listens (`onNode`) the
// moment it is worked out, which is how the window hears this host and a server's alike.
//
// Every number here is ours.

import type { StoryBook, StoryChange } from './book.ts';
import { STORY_TUNE } from './bookClient.ts';
import { HostCore, type HostCtx } from './hostCore.ts';
import type { PayOrder, StoryEvent, StoryNote, StoryResult } from './quests.ts';
import { emptySet, joinSets, loadSet, type Issue, type StorySet } from './set.ts';
import type { HostAnswer, NodeWord, StoryHost } from './storyHost.ts';
import { treeFor, type TalkState } from './talkRules.ts';
import { viewHash, type StoryView } from './view.ts';

/** One file of a set, as whoever read it hands it over. */
export interface SetFile {
  path: string;
  text: string;
}

/** What decides whether this browser works a character's jobs out just now, besides the sets. */
export interface JobsLine {
  /** A character is in play: not the select screen, not the creator. */
  inPlay: boolean;
  /** This browser holds that character's story book (`BookClient.holdsHere`). */
  holdsBook: boolean;
  /** Who decides what the character has: this browser alone, or a server that is answering. */
  authority: 'me' | 'server';
}

/** Why the jobs wait on a server that keeps the character's credits but holds no story. */
export const JOBS_WAIT_CREDITS = 'this server keeps your credits but not your story, so your jobs wait for one that keeps both';

/**
 * Why the jobs are not worked out here just now, or null when they are. The design's table hands the
 * jobs to this browser against a relay whose greeting holds no story; but every such server that answers
 * as a server keeps the character's credits, and lets only its admin put credits in, so a reward worked out
 * here would be recorded as paid and never arrive -- and the book refuses to pay a reward twice, so it could
 * never arrive later either. The jobs wait there instead, said in words, until a server that holds both or
 * none at all; the waypoints, which pay nothing, are this browser's as the table says. A line that has dropped
 * or is coming back keeps the credits here, as the purse itself does.
 */
export function jobsWait(l: JobsLine): string | null {
  if (!l.inPlay) return 'there is no character in play';
  if (!l.holdsBook) return 'a server holds this character’s story';
  if (l.authority === 'server') return JOBS_WAIT_CREDITS;
  return null;
}

/** What paying out of this browser's own purse and backpack asks of them (`payLocally`). */
export interface LocalWallet {
  /** Whether a server keeps this character's credits: then nothing here may put credits in or take them out. */
  serverKeeps(): boolean;
  /** What the character has. */
  credits(): number;
  /** Put credits in. */
  give(n: number): void;
  /** Take credits out, calling `then` only if they really went (with no server, before this returns). */
  spend(n: number, then: () => void): void;
  /** One thing into the backpack; false for one owned already, which is said rather than given twice. */
  item(kind: 'wear' | 'weapon', id: string): boolean;
}

/**
 * One payment of the story's, out of this browser's own purse and backpack: what the game's `pay` dep is. A
 * price (`charge`) is taken only when the money is there and really moves, and false says it did not, which
 * the host turns into "could not be spent" rather than "Spent"; credits are put in; a thing goes into the
 * backpack. Never into or out of a purse a server keeps, where only its admin may put credits in and only its
 * own answer may take them out.
 */
export function payLocally(order: PayOrder, w: LocalWallet): boolean {
  if (order.charge) {
    if (w.serverKeeps() || w.credits() < order.charge) return false;
    let taken = false;
    w.spend(order.charge, () => {
      taken = true;
    });
    return taken;
  }
  if (order.credits) {
    if (w.serverKeeps()) return false;
    w.give(order.credits);
    return true;
  }
  if (order.item) return w.item(order.item.kind, order.item.id);
  return true;
}

export interface LocalDeps {
  /** The book in hand, or null with no character in play. */
  book(): StoryBook | null;
  /**
   * Whether this browser works that book's jobs out just now: a character is in play, no server holds its
   * story, and nothing it pays would go astray (a server that keeps the character's credits but no story
   * would never let a browser put credits in, so a reward recorded as paid there would never arrive).
   */
  holds(): boolean;
  /** Why the jobs are not worked out here just now, in words, when `holds` says they are not; the host's own reason otherwise. */
  whyNot?(): string | null;
  /**
   * A batch the rules worked out, applied to that very book: kept, counted as a change made here, and told.
   * False when the book would not take it (a server took it over a moment ago): then nothing is paid.
   */
  apply(ch: StoryChange[]): boolean;
  /** One payment (the game's is `payLocally`). False when nothing moved: a thing owned already, a price the purse would not give. */
  pay(order: PayOrder): boolean;
  /** One note for the message line; `given` is false for a thing that could not be handed over. */
  note(note: StoryNote, given: boolean): void;
  /** What is true just now, the clock and whether the character is away left out (they are the host's). */
  ctx(): Omit<HostCtx, 'now' | 'away'>;
  /** The shared clock, in milliseconds (`Date.now()` with no server). */
  now(): number;
  /** The wall clock, in milliseconds: what the sweep's pace runs on. */
  wall(): number;
  /** Whether the character is in the world: not on the select screen, not behind the first loading screen. */
  inWorld(): boolean;
}

/** How one set read came out, for the console. */
export interface SetReport {
  name: string;
  hash: string;
  quests: number;
  errors: number;
  warnings: number;
  /** The first few problems, as `file:line: message`. */
  first: string[];
}

function issueText(i: Issue): string {
  return `${i.file}:${i.line}: ${i.message}`;
}

export class LocalHost implements StoryHost {
  readonly kind = 'local';
  private readonly deps: LocalDeps;
  private lib: StorySet = emptySet();
  /** Whether a set has been read at all: until then nothing is worked out. */
  private ready = false;
  private core: HostCore | null = null;
  /** Whether the character has been brought into the world for the book in hand. */
  private entered = false;
  /** Added to the shared clock: the console's way to let a timer run out in a tab that draws no frames. */
  private offset = 0;
  private lastSweep = 0;
  private current: StoryView | null = null;
  private currentHash = '';
  /** Something outside the rules changed the book (a waypoint switched, a settle): the view is worked out again at the next tick. */
  private dirty = true;
  private readonly listeners = new Set<(view: StoryView | null) => void>();
  private sets: SetReport[] = [];
  /** Set when the book would not take the batch just worked out: what `finish` pays nothing for. */
  private refused = false;
  /** Whether the last batch `finish` saw was refused, for a conversation's turn, which then shows nothing it did not keep. */
  private refusedLast = false;
  /** Whether this browser held a book at the last tick. */
  private heldWas = false;
  /** Where the conversation under way stands, or null: this browser's alone, never the book's. */
  private talking: TalkState | null = null;
  private readonly nodeListeners = new Set<(node: NodeWord) => void>();
  readonly stats = { events: 0, dropped: 0, batches: 0, refused: 0, paid: 0, notes: 0, unbuilt: 0, misses: 0, sweeps: 0, talks: 0, picks: 0, lastWhy: '' };

  constructor(deps: LocalDeps) {
    this.deps = deps;
  }

  // ---- the sets ---------------------------------------------------------------------------------------

  /**
   * The sets read: the committed test set (`test`, read as the test set, where relative places and
   * console signals are allowed) and the owner's folder (`own`), either of which may be absent. A set
   * with problems is used as far as it read, and its problems are reported; `npm run story:check` is
   * where they are meant to be found first.
   */
  setSets(parts: { test?: readonly SetFile[] | null; own?: readonly SetFile[] | null }): SetReport[] {
    const loaded: StorySet[] = [];
    const reports: SetReport[] = [];
    const read = (files: readonly SetFile[], test: boolean): void => {
      if (!files.length) return;
      const r = loadSet([...files], { test });
      if (!r.set.prefix) {
        reports.push({ name: test ? 'test' : 'own', hash: r.hash, quests: 0, errors: r.errors.length, warnings: r.warnings.length, first: r.errors.slice(0, 5).map(issueText) });
        return;
      }
      loaded.push(r.set);
      reports.push({ name: r.set.prefix, hash: r.hash, quests: Object.keys(r.set.quests).length, errors: r.errors.length, warnings: r.warnings.length, first: r.errors.slice(0, 5).map(issueText) });
    };
    if (parts.own) read(parts.own, false);
    if (parts.test) read(parts.test, true);
    this.sets = reports;
    this.useLibrary(loaded.length ? joinSets(loaded) : emptySet());
    return reports;
  }

  /**
   * A set already read, in place of whatever was in use: the book is held to it at once, or, when this
   * browser does not hold the book just now, the moment it does (`ensure` hands no loop over with a set
   * older than this one).
   */
  useLibrary(lib: StorySet): void {
    this.lib = lib;
    this.ready = true;
    this.ensure();
    this.refresh();
  }

  /** The set in use (the two joined). */
  get library(): StorySet {
    return this.lib;
  }

  // ---- the book in hand ---------------------------------------------------------------------------------

  /** The shared clock as the story reads it: the server's, or this machine's, with the console's offset. */
  now(): number {
    return this.deps.now() + this.offset;
  }

  /** Move the story clock on (or back, never before the shared clock itself), and settle what fell due. */
  shiftClock(ms: number): number {
    if (Number.isFinite(ms)) this.offset = Math.max(0, this.offset + ms);
    this.sweep();
    return this.offset;
  }

  /** Put the story clock back on the shared clock. */
  resetClock(): void {
    this.offset = 0;
  }

  get clockOffset(): number {
    return this.offset;
  }

  private ctx(): HostCtx {
    return { ...this.deps.ctx(), now: this.now(), away: !this.deps.inWorld() };
  }

  /**
   * The host loop over the book in hand, made when the book changes (a character played, a settle with
   * a server) and settled at once; null while there is nothing to work with.
   */
  private ensure(): HostCore | null {
    const book = this.deps.book();
    if (!book || !this.ready || !this.deps.holds()) return null;
    if (this.core && this.core.book === book) {
      // The sets were read again while this browser did not hold the book (a line coming back, a claim
      // not settled yet): the loop it kept is held to the new ones before it works anything out, or its
      // jobs would run against one set while the message line and the console read the other.
      if (this.core.lib !== this.lib) this.finish(this.core.setLibrary(this.lib, this.ctx()), true);
      return this.core;
    }
    this.core = new HostCore({
      book,
      lib: this.lib,
      payer: 'browser',
      apply: (ch) => {
        if (!this.deps.apply(ch)) this.refused = true;
      },
    });
    this.entered = false;
    this.dirty = true;
    // A conversation is the book's it began on, and never carries over to another.
    this.talking = null;
    // Read in as for a character not yet in the world, so a played clock begun by the settling keeps its
    // time; brought in at once when the character already is.
    this.finish(this.core.load({ ...this.ctx(), away: true }), true);
    if (this.deps.inWorld()) this.enter();
    return this.core;
  }

  private enter(): void {
    const core = this.core;
    if (!core || this.entered) return;
    this.entered = true;
    this.finish(core.event({ k: 'enter' }, this.ctx()));
  }

  /**
   * The character leaves the world (the select screen, the page going): every clock that counts only time
   * played stops. Only the loop the character was brought in with, over the very book in hand and while
   * this browser still holds it: leaving never makes a loop of its own, since a book a server held until a
   * moment ago (the line put down on the way out) would otherwise be worked out here with nobody in play to
   * pay, and its rewards recorded as paid to no one.
   */
  leave(): void {
    const core = this.core;
    if (!core || !this.entered || core.book !== this.deps.book() || !this.deps.holds()) return;
    this.entered = false;
    this.finish(core.event({ k: 'leave' }, { ...this.ctx(), away: true }));
  }

  /** The book changed outside the rules (a waypoint, a settle, another character): the view follows at the next tick. */
  changed(): void {
    this.dirty = true;
  }

  /**
   * A few times a second from the frame loop: the character brought into the world or out of it, the
   * deadlines swept once a second, and the view worked out again when something outside it changed.
   */
  tick(): void {
    // A server taking the book over, or giving it back, changes what there is to show.
    const holds = !!this.deps.book() && this.deps.holds();
    if (holds !== this.heldWas) {
      this.heldWas = holds;
      this.dirty = true;
    }
    const core = this.ensure();
    if (core) {
      const inWorld = this.deps.inWorld();
      if (inWorld && !this.entered) this.enter();
      else if (!inWorld && this.entered) this.leave();
      const wall = this.deps.wall();
      if (wall - this.lastSweep >= STORY_TUNE.sweep) {
        this.lastSweep = wall;
        this.sweep();
        return;
      }
    }
    if (this.dirty) this.refresh();
  }

  /** Settle every deadline that has fallen due, now; the view follows, since its counters and clocks move with time. */
  sweep(): void {
    const core = this.ensure();
    if (!core) return;
    this.stats.sweeps++;
    this.finish(core.sweep(this.ctx()));
    this.refresh();
  }

  // ---- what happens ---------------------------------------------------------------------------------------

  private finish(r: StoryResult, refresh = false): HostAnswer {
    this.stats.unbuilt += r.unbuilt;
    this.stats.misses += r.misses;
    this.refusedLast = this.refused;
    if (this.refused) {
      // The book did not take the batch, so nothing it records was recorded: nothing is paid or said, or a
      // reward could be paid that the book would pay again.
      this.refused = false;
      this.stats.refused++;
      this.dirty = true;
      return { ok: false, why: 'the book would not take that just now' };
    }
    if (r.ch.length) this.stats.batches++;
    // The book took the batch, and the rewards in it are recorded, before anything is handed over. A
    // payment that did not go through is said as one that did not, rather than as one that did.
    const refused = new Set<string>();
    for (const o of r.pay) {
      if (this.deps.pay(o)) this.stats.paid++;
      else if (o.item) refused.add(`${o.item.kind}:${o.item.id}`);
      else if (o.credits) refused.add(`credits:${o.credits}`);
      else if (o.charge) refused.add(`charge:${o.charge}`);
    }
    for (const n of r.notes) {
      this.stats.notes++;
      const failed = (n.k === 'item' && refused.has(`${n.kind}:${n.id}`)) || (n.k === 'paid' && refused.has(`credits:${n.credits}`)) || (n.k === 'charged' && refused.has(`charge:${n.credits}`));
      this.deps.note(n, !failed);
    }
    if (r.why) this.stats.lastWhy = r.why;
    if (r.ch.length || refresh) this.refresh();
    return r.why ? { ok: false, why: r.why } : { ok: true };
  }

  /** Why nothing can be done just now, or null when the host can work. */
  private notNow(): string | null {
    if (!this.deps.book()) return 'there is no character in play';
    if (!this.ready) return 'the story has not been read yet';
    if (!this.deps.holds()) return this.deps.whyNot?.() || 'a server holds this character’s story';
    return null;
  }

  private op(f: (core: HostCore, ctx: HostCtx) => StoryResult): HostAnswer {
    const core = this.ensure();
    if (!core) return { ok: false, why: this.notNow() ?? 'nothing can be done just now' };
    return this.finish(f(core, this.ctx()));
  }

  event(ev: StoryEvent): HostAnswer {
    const core = this.ensure();
    if (!core) {
      this.stats.dropped++;
      return { ok: false, why: this.notNow() ?? 'nothing can be done just now' };
    }
    this.stats.events++;
    return this.finish(core.event(ev, this.ctx()));
  }

  /** A quest id as the console writes it: with its prefix, or without one when only one set has it. */
  questId(q: string): string {
    if (q.includes(':')) return q;
    for (const prefix of ['own', 'test']) if (this.lib.quests[`${prefix}:${q}`]) return `${prefix}:${q}`;
    for (const id of Object.keys(this.lib.quests)) if (id.endsWith(`:${q}`)) return id;
    return q;
  }

  grant(q: string): HostAnswer {
    return this.op((core, ctx) => core.grant(this.questId(q), ctx));
  }

  offer(q: string): HostAnswer {
    return this.op((core, ctx) => core.offer(this.questId(q), ctx));
  }

  accept(q: string): HostAnswer {
    return this.op((core, ctx) => core.accept(this.questId(q), ctx));
  }

  decline(q: string): HostAnswer {
    return this.op((core, ctx) => core.decline(this.questId(q), ctx));
  }

  drop(q: string): HostAnswer {
    return this.op((core, ctx) => core.drop(this.questId(q), ctx));
  }

  restart(q: string): HostAnswer {
    return this.op((core, ctx) => core.restart(this.questId(q), ctx));
  }

  unstick(q: string): HostAnswer {
    return this.op((core, ctx) => core.unstick(this.questId(q), ctx));
  }

  track(q: string, on: boolean): HostAnswer {
    return this.op((core, ctx) => core.track(this.questId(q), on, ctx));
  }

  /** Actions written at the console (`complete(test:goto, outdoor)`), each read and checked as a file's would be. */
  run(actions: readonly string[]): HostAnswer {
    return this.op((core, ctx) => core.run(actions, ctx));
  }

  // ---- conversations --------------------------------------------------------------------------------------

  /** Whether this browser can speak for somebody just now: it works the jobs out here, and they have a tree in the sets read. */
  canTalk(speaker: string): boolean {
    return !this.notNow() && !!treeFor(this.lib, speaker);
  }

  /**
   * Open a conversation, give an answer (null lets a node go on by itself), or close it. The node it reaches
   * is worked out on the book with the very rules a server uses, applied and paid as any batch is, and handed
   * to every node listener before this answers; a refusal is handed over too, with no node and its reason.
   */
  talk(op: 'open' | 'pick' | 'close', speaker: string, reply: string | null = null): HostAnswer {
    if (op === 'close') {
      this.talking = null;
      return { ok: true };
    }
    const core = this.ensure();
    if (!core) {
      const why = this.notNow() ?? 'nothing can be done just now';
      this.tellNode({ speaker, view: null, why });
      return { ok: false, why };
    }
    if (op === 'pick' && (!this.talking || this.talking.speaker !== speaker)) {
      const why = 'you are not talking to them';
      this.tellNode({ speaker, view: null, why });
      return { ok: false, why };
    }
    const out = op === 'open' ? core.talkOpen(speaker, this.ctx()) : core.talkPick(this.talking!, reply, this.ctx());
    if (op === 'open') this.stats.talks++;
    else this.stats.picks++;
    const answer = this.finish(out.r);
    this.talking = this.refusedLast ? this.talking : out.turn.state;
    this.tellNode({ speaker, view: this.refusedLast ? null : out.turn.view, why: this.refusedLast ? (answer.why ?? null) : out.turn.why });
    return out.turn.why ? { ok: false, why: out.turn.why } : answer;
  }

  /** Where the conversation under way stands, for the console. */
  get talkState(): TalkState | null {
    return this.talking;
  }

  onNode(fn: (node: NodeWord) => void): () => void {
    this.nodeListeners.add(fn);
    return () => this.nodeListeners.delete(fn);
  }

  private tellNode(node: NodeWord): void {
    for (const fn of this.nodeListeners) {
      try {
        fn(node);
      } catch (err) {
        console.warn('story: a node listener failed', err);
      }
    }
  }

  // ---- the view ---------------------------------------------------------------------------------------

  view(): StoryView | null {
    if (this.dirty) {
      this.ensure();
      this.refresh();
    }
    return this.current;
  }

  onView(fn: (view: StoryView | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The view worked out again, and everyone told when it is not the one they have. */
  private refresh(): void {
    this.dirty = false;
    this.heldWas = !!this.deps.book() && this.deps.holds();
    const core = this.core && this.core.book === this.deps.book() && this.heldWas && this.ready ? this.core : null;
    const next = core ? core.view(this.ctx()) : null;
    const hash = next ? viewHash(next) : '';
    this.current = next;
    if (hash === this.currentHash) return;
    this.currentHash = hash;
    for (const fn of this.listeners) {
      try {
        fn(next);
      } catch (err) {
        console.warn('story: a view listener failed', err);
      }
    }
  }

  /** What `__debug.story()` and `__debug.quests()` print of the host itself. */
  report(): Record<string, unknown> {
    const book = this.deps.book();
    let active = 0;
    for (const q of Object.keys(book?.quests ?? {})) if (book!.quests![q].state === 'active') active++;
    return {
      kind: this.kind,
      ready: this.ready,
      holds: this.deps.holds(),
      entered: this.entered,
      sets: this.sets.map((s) => ({ ...s })),
      quests: Object.keys(this.lib.quests).length,
      active,
      clock: this.offset,
      talks: Object.keys(this.lib.talks).length,
      cast: Object.keys(this.lib.cast).length,
      talking: this.talking ? { ...this.talking, path: [...this.talking.path] } : null,
      view: this.current ? { quests: this.current.quests.length, watch: this.current.watch.length, waypoints: this.current.waypoints.length, objects: this.current.objects.length, cast: this.current.cast.length } : null,
      stats: { ...this.stats },
    };
  }
}
