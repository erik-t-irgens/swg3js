// One host of a story: a character's book, the story set it runs against, and the loop that turns what
// happened into changes and applies them. The browser's host (with no server) and the server's host both
// are this, so there is one rule book and two hosts of it rather than two rule books. Pure: no clock of
// its own, no storage, no socket and no purse; what a host does with the answer -- keeping the book,
// paying the credits, saying the notes -- is the host's.
//
// **The loop.** Every call works out its changes on a copy of the book (`quests.ts`), runs the watchdog
// over the result (`signals.ts`), and then applies the changes: with the book's own `applyChanges` by
// default, or through the host's own `apply` where applying is something else as well (the server writes
// each batch to its log, and the store applies it as it writes). Either way the book moves one revision
// for a batch that changed anything, and the answer's `ch` is exactly what was applied.
//
// **What it is told.** `ctx` is what is true just now (`StoryCtx`): the shared-clock time, where the
// player is, and whether the character is in the world at all (`away`). The character and who pays are
// the host's own and are filled in here.

import { BOOK_LIMITS, applyChanges, type BookLimits, type StoryBook, type StoryChange } from './book.ts';
import { CIRCLE, plan, type Draft, type StoryCtx, type StoryEvent, type StoryResult } from './quests.ts';
import { readAction, type StorySet } from './set.ts';
import { watchdog } from './signals.ts';
import { nodeView, talkOpenWork, talkPickWork, type NodeView, type TalkPending, type TalkState, type TalkTurn } from './talkRules.ts';
import { viewOf, type StoryView } from './view.ts';

/** A conversation's turn worked out and applied: what it changed and paid, and the node it reached. */
export interface TalkResult {
  r: StoryResult;
  turn: TalkTurn;
}

/** What a host is told about the moment: everything in a `StoryCtx` but the character and the payer, which are its own. */
export type HostCtx = Omit<StoryCtx, 'char' | 'payer'>;

export interface HostOptions {
  book: StoryBook;
  lib: StorySet;
  payer: 'server' | 'browser';
  limits?: BookLimits;
  /** How a batch is applied, when that is more than `applyChanges` (the server writes it down first). */
  apply?: (ch: StoryChange[]) => void;
}

/**
 * A plan with the watchdog run over what it left, so a step that can never be done is moved on at once.
 * `after` reads the worked-out copy of the book once everything has run (a conversation's node is shown as
 * the book stands after the node's own actions and whatever they set off).
 */
function planned(book: StoryBook, lib: StorySet, ctx: StoryCtx, work: (d: Draft) => void, limits?: BookLimits, after?: (d: Draft) => void): StoryResult {
  return plan(
    book,
    lib,
    ctx,
    (d) => {
      work(d);
      d.run();
      watchdog(d);
      after?.(d);
    },
    limits,
  );
}

/** G1's `event(book, set, ev, ctx)`: one event's changes, payments and notes, worked out and never applied. */
export function storyEvent(book: StoryBook, lib: StorySet, ev: StoryEvent, ctx: StoryCtx, limits?: BookLimits): StoryResult {
  return planned(book, lib, ctx, (d) => d.event(ev), limits);
}

export class HostCore {
  book: StoryBook;
  lib: StorySet;
  payer: 'server' | 'browser';
  limits: BookLimits;
  private readonly applyBatch: ((ch: StoryChange[]) => void) | null;

  constructor(o: HostOptions) {
    this.book = o.book;
    this.lib = o.lib;
    this.payer = o.payer;
    this.limits = o.limits ?? BOOK_LIMITS;
    this.applyBatch = o.apply ?? null;
  }

  private ctxOf(ctx: HostCtx): StoryCtx {
    return { ...ctx, char: this.book.char, payer: this.payer };
  }

  /** Work something out, apply what it changed, and hand the answer back. */
  private go(ctx: HostCtx, work: (d: Draft) => void): StoryResult {
    const r = planned(this.book, this.lib, this.ctxOf(ctx), work, this.limits);
    if (r.ch.length) {
      if (this.applyBatch) this.applyBatch(r.ch);
      else applyChanges(this.book, r.ch, this.limits);
    }
    return r;
  }

  /** Something happened. */
  event(ev: StoryEvent, ctx: HostCtx): StoryResult {
    return this.go(ctx, (d) => d.event(ev));
  }

  /**
   * The book was just read in, or the set changed under it: quests whose definitions moved are carried on,
   * restarted or held as revised, and every deadline that passed meanwhile is settled in the order it fell.
   * A host loading a book before its character comes into the world says `away: true`, so a step on the
   * played clock that the settling begins keeps its time until `enter`, rather than spending it offline.
   */
  load(ctx: HostCtx): StoryResult {
    return this.go(ctx, (d) => {
      d.revise();
      d.run();
      d.settle(ctx.now);
    });
  }

  /** A new story set: the book is held to it at once. */
  setLibrary(lib: StorySet, ctx: HostCtx): StoryResult {
    this.lib = lib;
    return this.load(ctx);
  }

  /** Settle what fell due: the host's sweep, once a second. */
  sweep(ctx: HostCtx): StoryResult {
    return this.go(ctx, (d) => d.settle(ctx.now));
  }

  private op(ctx: HostCtx, f: (d: Draft) => string | null): StoryResult {
    return this.go(ctx, (d) => {
      const why = f(d);
      if (why) d.why = why;
    });
  }

  grant(quest: string, ctx: HostCtx): StoryResult {
    return this.op(ctx, (d) => d.grant(quest, 'grant'));
  }

  offer(quest: string, ctx: HostCtx): StoryResult {
    return this.op(ctx, (d) => d.grant(quest, 'offer'));
  }

  accept(quest: string, ctx: HostCtx): StoryResult {
    return this.op(ctx, (d) => d.accept(quest));
  }

  decline(quest: string, ctx: HostCtx): StoryResult {
    return this.op(ctx, (d) => d.decline(quest));
  }

  drop(quest: string, ctx: HostCtx): StoryResult {
    return this.op(ctx, (d) => d.drop(quest));
  }

  restart(quest: string, ctx: HostCtx): StoryResult {
    return this.op(ctx, (d) => d.restart(quest));
  }

  /** A held quest put back on its feet (the console's and an admin's). */
  unstick(quest: string, ctx: HostCtx): StoryResult {
    return this.op(ctx, (d) => d.unstick(quest));
  }

  /** Track a quest on the screen, or stop. */
  track(quest: string, on: boolean, ctx: HostCtx): StoryResult {
    return this.op(ctx, (d) => (d.change({ k: 'track', quest, on }) ? null : d.why));
  }

  /**
   * Actions written outside any file, as the console writes them (`"complete(test:goto, outdoor)"`), each
   * read and checked as a file's would be. Ids without a prefix are taken as the test set's.
   */
  run(actions: readonly unknown[], ctx: HostCtx, prefix = 'test'): StoryResult {
    return this.go(ctx, (d) => {
      for (const a of actions) {
        const act = readAction(a, prefix);
        if (typeof act === 'string') {
          d.why ??= act;
          continue;
        }
        d.actions([act], {});
      }
    });
  }

  /** What the interface is shown. */
  view(ctx: HostCtx): StoryView {
    return viewOf(this.book, this.lib, this.ctxOf(ctx));
  }

  /**
   * One turn of a conversation, worked out on a copy, applied like any other batch, and the node it reached
   * shown as the copy stood once everything had run. A circle in the data is stopped as any event's is, and
   * then nothing is shown and nothing is kept.
   */
  private converse(ctx: HostCtx, work: (d: Draft) => TalkPending): TalkResult {
    const out: { pending: TalkPending; view: NodeView | null } = { pending: { state: null, why: 'nothing was said' }, view: null };
    const c = this.ctxOf(ctx);
    const r = planned(
      this.book,
      this.lib,
      c,
      (d) => {
        out.pending = work(d);
      },
      this.limits,
      (d) => {
        out.view = out.pending.state ? nodeView(d.book, this.lib, out.pending.state, d.ctx, d.tally) : null;
      },
    );
    if (r.ch.length) {
      if (this.applyBatch) this.applyBatch(r.ch);
      else applyChanges(this.book, r.ch, this.limits);
    }
    if (r.why === CIRCLE) return { r, turn: { state: null, view: null, why: CIRCLE } };
    const { pending, view } = out;
    const turn: TalkTurn = { state: view ? pending.state : null, view, why: pending.why ?? (view ? null : r.why) };
    if (pending.restarted) turn.restarted = true;
    return { r, turn };
  }

  /**
   * Open a conversation with somebody: where their tree starts for this character. One of the game's own
   * people comes with the creature they are stood as (`who`); `tree` is the console's review, which opens a
   * conversation whoever speaks it.
   */
  talkOpen(speaker: string, ctx: HostCtx, who: string | null = null, tree: string | null = null): TalkResult {
    return this.converse(ctx, (d) => talkOpenWork(d, speaker, who, tree));
  }

  /** An answer given where a conversation stands (`reply`), or the node going on by itself (null). */
  talkPick(state: TalkState, reply: string | null, ctx: HostCtx): TalkResult {
    return this.converse(ctx, (d) => talkPickWork(d, state, reply));
  }
}
