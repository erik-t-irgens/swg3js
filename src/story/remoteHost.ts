// The story held by a server: the browser's half of it. With a server whose hail says `story.v` 2 or more,
// the server runs the character's jobs and is their only payer (`server/stories.mjs`), and this is what the
// game's detectors, the tracker and the console speak to in place of the browser's own host
// (`localHost.ts`); both answer to one shape (`storyHost.ts`).
//
// **What goes up.** Everything the detectors see, as an event with where the player stood (`ev`); a job
// taken, turned down, dropped, started over, followed or not (`q`); and the console's own operations, which
// the server takes from its admin alone (`admin`). Nothing is applied here: the server's batches come back
// through the book (`bookClient.ts`), its payments through the purse and the ledger, and its view and its
// notes through here. Words go up no faster than `evPerSecond`, under the server's own allowance, and a kill
// waits one tick before it goes, so a keeper's own word of the death -- sent by the creature's code as it
// falls -- reaches the server ahead of the claim on it.
//
// **What comes down.** The view the interface reads (`view`, whenever it changed), with how far the admin has
// moved the story's clock on so the tracker's countdowns read the server's time; and the message line's facts
// (`note`), whose words are made by whoever says them, with the client's own strings this browser can read.
//
// **Held.** While the book is being settled after a claim, or the line that held it is coming back, nothing
// can be asked: an event is dropped and counted (the detectors raise what stays true again, so a drop costs
// nothing that is still true when the line is back; a kill in that moment is lost), and the last view stands so
// the tracker can say the jobs are held. A server whose hail says only `story.v` 1 holds the book and runs no
// jobs at all; there they wait, in words. So they do on a server that runs jobs but reads no story set (its
// view says `read` nought): what the detectors see is dropped, and only the console's words go up, since the
// admin's `reload` is how a set comes to be read.
//
// Nothing in here touches the page, three or a socket: what it needs is handed in (`RemoteDeps`), so the node
// tests drive it against a fake and against the relay itself. Every number here is ours.

import type { StoryEvent } from './quests.ts';
import type { HostAnswer, StoryHost } from './storyHost.ts';
import { cleanStoryWord, type StoryAt, type StoryNoteDown } from './storyWire.ts';
import type { StoryView } from './view.ts';

/** The browser's own numbers for the server's host. Ours. */
export const REMOTE_TUNE = {
  /** Words a second sent up, under the server's ten (`story.evRate`); the rest wait their turn. */
  evPerSecond: 8,
  /** The most words that may wait their turn: past it the oldest event is dropped and counted. */
  queueMax: 60,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneRemote(o: Partial<typeof REMOTE_TUNE>): typeof REMOTE_TUNE {
  if (typeof o.evPerSecond === 'number' && Number.isFinite(o.evPerSecond)) REMOTE_TUNE.evPerSecond = Math.max(1, Math.min(20, Math.round(o.evPerSecond)));
  if (typeof o.queueMax === 'number' && Number.isFinite(o.queueMax)) REMOTE_TUNE.queueMax = Math.max(4, Math.min(1000, Math.round(o.queueMax)));
  return REMOTE_TUNE;
}

/** The story a server must say it holds before its jobs' words are spoken to it. */
export const JOBS_STORY = 2;

/** Why a server's jobs wait, when it holds the book and runs none (a relay from before the jobs). */
export const JOBS_WAIT_OLD = 'this server keeps your story but runs no jobs yet, so your jobs wait';
/** Why they wait on a server that runs jobs but reads no story set at all (the view says `read` nought). */
export const JOBS_WAIT_UNREAD = 'this server keeps your story but reads no story set, so your jobs wait';
/** Why nothing can be asked while the line that held the story has dropped and is coming back. */
export const JOBS_HELD = 'held by the server, which is not answering';
/** Why nothing can be asked while a server that runs jobs settles this character's story on a line just claimed. */
export const JOBS_SETTLING = 'held while the server settles this character’s story';

export interface RemoteDeps {
  /** A word to the server. */
  send(msg: Record<string, unknown>): void;
  /** Who holds the book just now (`BookClient.host`) and the story the server's hail says it holds. */
  line(): { host: 'local' | 'server' | 'held'; story: number };
  /** The character in play, or null. */
  char(): string | null;
  /** Where the player stands, as an event carries it (`StoryAt`). */
  at(): StoryAt;
  /** The shared clock, in milliseconds. */
  now(): number;
  /** The wall clock, in milliseconds: what the pacing runs on. */
  wall(): number;
  /** One fact for the message line, with whether its thing arrived; its words are the caller's to make. */
  note(note: StoryNoteDown, given: boolean): void;
}

export class RemoteHost implements StoryHost {
  readonly kind = 'server';
  private readonly deps: RemoteDeps;
  private current: StoryView | null = null;
  /** The character the view in hand is about. */
  private viewChar: string | null = null;
  /** How far the admin has moved the server's story clock on, in milliseconds. */
  private off = 0;
  /** Whether the server reads a story set at all, as its last view said. */
  private setsRead = true;
  private readonly listeners = new Set<(view: StoryView | null) => void>();
  /** Words waiting their turn, and the kills that wait a tick before they join them. */
  private readonly queue: Record<string, unknown>[] = [];
  private readonly nextTick: Record<string, unknown>[] = [];
  private window = 0;
  private sentInWindow = 0;
  readonly stats = { events: 0, sent: 0, dropped: 0, overflow: 0, ops: 0, views: 0, notes: 0, refusals: 0, lastWhy: '' };

  constructor(deps: RemoteDeps) {
    this.deps = deps;
  }

  /** Whether a server runs this character's jobs just now: it holds the book, has settled it on this line, and says it runs jobs. */
  get ready(): boolean {
    const l = this.deps.line();
    return l.host === 'server' && l.story >= JOBS_STORY;
  }

  /** Whether the line holds a story at all (settled or not): the server's host is the one to ask, not the browser's own. */
  get active(): boolean {
    return this.deps.line().host !== 'local';
  }

  /**
   * Why nothing can be asked just now, or null. Held is asked before the server's story: a line that has
   * dropped reads story nought (`Session.storyVersion` is the server's only while it has this browser), so
   * asked the other way round an ordinary reconnect said the server ran no jobs. Held with a story is a line
   * just claimed whose book is being settled, on a server that runs jobs or on one from before them.
   */
  whyNot(): string | null {
    const l = this.deps.line();
    if (!this.deps.char()) return 'there is no character in play';
    if (l.host === 'local') return 'no server holds this character’s story';
    if (l.host === 'held') return l.story <= 0 ? JOBS_HELD : l.story < JOBS_STORY ? JOBS_WAIT_OLD : JOBS_SETTLING;
    if (l.story < JOBS_STORY) return JOBS_WAIT_OLD;
    return null;
  }

  /**
   * Why the jobs stand still, for the tracker and the console, or null: whatever stops a word going up, and
   * then a server that runs jobs but reads no story set. That last is not a reason to hold the console's
   * words, since the admin's `reload` is how a set is read at all.
   */
  waits(): string | null {
    return this.whyNot() ?? (this.setsRead ? null : JOBS_WAIT_UNREAD);
  }

  // ---- what goes up ------------------------------------------------------------------------------------

  /** Something the detectors saw, sent with where the player stood; a kill waits one tick (above). */
  event(ev: StoryEvent): HostAnswer {
    // A server reading no set works nothing out, so what the detectors see is dropped here rather than sent.
    const why = this.waits();
    if (why) {
      this.stats.dropped++;
      return { ok: false, why };
    }
    if (ev.k === 'tick') return { ok: true };
    this.stats.events++;
    const msg = { t: 'story', do: 'ev', ev, at: this.deps.at() };
    if (ev.k === 'kill') this.nextTick.push(msg);
    else this.push(msg);
    return { ok: true };
  }

  private push(msg: Record<string, unknown>): void {
    // A full queue gives up its oldest event, never a job's word or the console's.
    if (this.queue.length >= REMOTE_TUNE.queueMax) {
      const at = this.queue.findIndex((m) => m.do === 'ev');
      if (at >= 0) {
        this.queue.splice(at, 1);
        this.stats.overflow++;
      }
    }
    this.queue.push(msg);
    this.flush(this.deps.wall());
  }

  /** A job's word or the console's, sent with where the player stood, which a job begun by it is measured from. */
  private op(msg: Record<string, unknown>): HostAnswer {
    const why = this.whyNot();
    if (why) return { ok: false, why };
    this.stats.ops++;
    this.push({ ...msg, at: this.deps.at() });
    return { ok: true };
  }

  accept(quest: string): HostAnswer {
    return this.op({ t: 'story', do: 'q', op: 'accept', quest });
  }

  decline(quest: string): HostAnswer {
    return this.op({ t: 'story', do: 'q', op: 'decline', quest });
  }

  drop(quest: string): HostAnswer {
    return this.op({ t: 'story', do: 'q', op: 'drop', quest });
  }

  restart(quest: string): HostAnswer {
    return this.op({ t: 'story', do: 'q', op: 'restart', quest });
  }

  track(quest: string, on: boolean): HostAnswer {
    return this.op({ t: 'story', do: 'q', op: on ? 'track' : 'untrack', quest });
  }

  /** The console's: grant a job (the server's admin only, as every operation below is). */
  grant(quest: string): HostAnswer {
    return this.op({ t: 'story', do: 'admin', op: 'grant', quest });
  }

  offer(quest: string): HostAnswer {
    return this.op({ t: 'story', do: 'admin', op: 'offer', quest });
  }

  unstick(quest: string): HostAnswer {
    return this.op({ t: 'story', do: 'admin', op: 'unstick', quest });
  }

  /** Finish one step of a job, as an action would. */
  complete(quest: string, step: string): HostAnswer {
    return this.op({ t: 'story', do: 'admin', op: 'complete', quest, step });
  }

  /** Raise a signal for this character, as the console does. */
  signal(name: string): HostAnswer {
    return this.op({ t: 'story', do: 'admin', op: 'signal', name });
  }

  /** Move the server's story clock on by that many milliseconds, or back onto the shared clock with null. */
  clock(ms: number | null): HostAnswer {
    return this.op({ t: 'story', do: 'admin', op: 'clock', ms });
  }

  /** Have the server read its story sets again. */
  reload(): HostAnswer {
    return this.op({ t: 'story', do: 'admin', op: 'reload' });
  }

  /** Send what is waiting, no more than the allowance a second. */
  private flush(now: number): void {
    if (!this.ready) return;
    if (now - this.window >= 1000) {
      this.window = now;
      this.sentInWindow = 0;
    }
    while (this.queue.length && this.sentInWindow < REMOTE_TUNE.evPerSecond) {
      this.deps.send(this.queue.shift()!);
      this.sentInWindow++;
      this.stats.sent++;
    }
  }

  /** A few times a second from the frame loop: the kills that waited a tick join the queue, and the queue is sent. */
  tick(): void {
    if (this.nextTick.length) {
      for (const m of this.nextTick) this.queue.push(m);
      this.nextTick.length = 0;
    }
    if (!this.ready && this.queue.length && !this.active) {
      // The line no longer holds a story at all (the server went, or another character): nothing waiting is
      // anybody's now.
      this.stats.dropped += this.queue.length;
      this.queue.length = 0;
    }
    this.flush(this.deps.wall());
  }

  // ---- what comes down -----------------------------------------------------------------------------------

  /** A story word from the server, handed over whole: its view and its notes are this host's. */
  word(msg: Record<string, unknown>): void {
    const w = cleanStoryWord(msg, 'down');
    if (!w) return;
    if (w.do === 'view') {
      this.stats.views++;
      this.off = w.off;
      this.setsRead = w.read;
      this.current = w.view;
      this.viewChar = this.deps.char();
      this.tellView();
    } else if (w.do === 'note') {
      this.stats.notes++;
      this.deps.note(w.note, w.given);
    } else if (w.do === 'no' && w.of === 'job') {
      this.stats.refusals++;
      this.stats.lastWhy = w.why;
    }
  }

  /** Another character, or none: the view in hand is nobody's now. */
  reset(): void {
    this.queue.length = 0;
    this.nextTick.length = 0;
    this.off = 0;
    this.setsRead = true;
    if (this.current) {
      this.current = null;
      this.viewChar = null;
      this.tellView();
    }
  }

  private tellView(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.current);
      } catch (err) {
        console.warn('story: a view listener failed', err);
      }
    }
  }

  /** The view the server last sent for the character in play: kept while the line is held, so the tracker can say the jobs are held. */
  view(): StoryView | null {
    if (this.current && this.viewChar !== this.deps.char()) {
      this.current = null;
      this.viewChar = null;
    }
    return this.current;
  }

  onView(fn: (view: StoryView | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The story's clock as the server keeps it: the shared clock with the admin's move of it. */
  now(): number {
    return this.deps.now() + this.off;
  }

  get clockOffset(): number {
    return this.off;
  }

  /** What `__debug.story()` and `__debug.quests()` print of this host. */
  report(): Record<string, unknown> {
    const v = this.current;
    return {
      kind: this.kind,
      ready: this.ready,
      why: this.waits(),
      setsRead: this.setsRead,
      clock: this.off,
      queued: this.queue.length + this.nextTick.length,
      view: v ? { quests: v.quests.length, watch: v.watch.length, waypoints: v.waypoints.length, objects: v.objects.length } : null,
      stats: { ...this.stats },
      tune: { ...REMOTE_TUNE },
    };
  }
}
