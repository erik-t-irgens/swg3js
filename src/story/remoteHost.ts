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
// **Conversations (story 3).** A server whose hail says 3 or more keeps where a conversation stands for the
// line and is asked for each turn (`talk`); the node it reaches comes back (`node`) and is handed to whoever
// listens, exactly as this browser's own host hands its own. A server that says less is never asked, and the
// window falls back on the game's own greeting there; so it does for somebody the server's view says has nothing
// to say. An opening or an answer goes up no sooner than `talkGap` after the last, under the server's own
// allowance, so a click through short nodes is paced here rather than refused there.
//
// **Documents and the journal (story 4).** A server whose hail says 4 or more opens a document it handed over
// when asked (`read`), and the page it read comes back (`doc`) to whoever listens, as a node does. The words of
// the journal live beside the book: this browser keeps the ones it was shown (`texts`), asks the server for a
// stretch it has not got (`journal`), and, when the server took a book played here and lacks words of it, is
// asked for them (`need`) and sends them up in pieces a little apart (`texts`), never faster than the relay
// takes. A note of the player's own is kept here as it goes up, since nothing else would ever bring its words
// back. Those words go up no sooner than `docGap` after the last, so the server, which drops one past its
// allowance without answering, is never sent one it would drop. A server that says less is asked for none of it.
//
// Nothing in here touches the page, three or a socket: what it needs is handed in (`RemoteDeps`), so the node
// tests drive it against a fake and against the relay itself. Every number here is ours.

import { STORY_TUNE } from './bookClient.ts';
import { isUnkeptView, type DocWord } from './docRules.ts';
import { cleanMine, journalHashes, textHash } from './journal.ts';
import type { TextKeep } from './localHost.ts';
import type { StoryEvent } from './quests.ts';
import type { HostAnswer, NodeWord, StoryHost } from './storyHost.ts';
import { bookText, chunkText, cleanStoryWord, cleanTexts, STORY_WIRE, type StoryAt, type StoryNoteDown } from './storyWire.ts';
import type { StoryView } from './view.ts';

/** The browser's own numbers for the server's host. Ours. */
export const REMOTE_TUNE = {
  /** Words a second sent up, under the server's ten (`story.evRate`); the rest wait their turn. */
  evPerSecond: 8,
  /** The most words that may wait their turn: past it the oldest event is dropped and counted. */
  queueMax: 60,
  /**
   * The least milliseconds between two conversation words that work something out (an opening or an answer;
   * a close goes at once), under the server's four a second (`story.talkRate`) even when the two clocks'
   * seconds do not line up: spaced this far apart no second holds more than three.
   */
  talkGap: 350,
  /**
   * The least milliseconds between two words about documents and the journal (`read`, `journal`, `mine`), under
   * the server's six a second (`story.docRate`), which also counts the pieces of words handed up (`texts`, two a
   * second at `chunkGap`): spaced this far apart no second holds more than three, so the two together stay under
   * six, and nothing the server would drop without a word is ever sent.
   */
  docGap: 350,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneRemote(o: Partial<typeof REMOTE_TUNE>): typeof REMOTE_TUNE {
  if (typeof o.evPerSecond === 'number' && Number.isFinite(o.evPerSecond)) REMOTE_TUNE.evPerSecond = Math.max(1, Math.min(20, Math.round(o.evPerSecond)));
  if (typeof o.queueMax === 'number' && Number.isFinite(o.queueMax)) REMOTE_TUNE.queueMax = Math.max(4, Math.min(1000, Math.round(o.queueMax)));
  if (typeof o.talkGap === 'number' && Number.isFinite(o.talkGap)) REMOTE_TUNE.talkGap = Math.max(0, Math.min(5000, Math.round(o.talkGap)));
  if (typeof o.docGap === 'number' && Number.isFinite(o.docGap)) REMOTE_TUNE.docGap = Math.max(0, Math.min(5000, Math.round(o.docGap)));
  return REMOTE_TUNE;
}

/** The story a server must say it holds before its jobs' words are spoken to it. */
export const JOBS_STORY = 2;
/** The story a server must say it holds before a conversation is asked of it. */
export const TALK_STORY = 3;
/** The story a server must say it holds before a document, the journal's words or a note of the player's own is asked of it. */
export const DOCS_STORY = 4;
/** The story a server must say it holds before it is told the companion went down or got up (Standing, the people and the companion). */
export const PEOPLE_STORY = 5;

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
  /**
   * Whether one of the game's own people, stood as this creature, has a conversation this browser knows the
   * game gives them (`voices` of the conversations it folded): what decides whether the server is asked for
   * one. The server holds the same reference and answers for itself. Absent: nobody of the game's is asked.
   */
  voiced?(who: string): boolean;
  /** Where the journal's words are kept in this browser: what a server's `journal` answer is put into and its `need` read from. */
  texts?: TextKeep;
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
  private readonly nodeListeners = new Set<(node: NodeWord) => void>();
  /** Words waiting their turn, and the kills that wait a tick before they join them. */
  private readonly queue: Record<string, unknown>[] = [];
  private readonly nextTick: Record<string, unknown>[] = [];
  private window = 0;
  private sentInWindow = 0;
  /** When the last conversation word that works something out went up (`talkGap`), on the wall clock. */
  private lastTalk = Number.NEGATIVE_INFINITY;
  /** When the last word about documents or the journal went up (`docGap`), on the wall clock. */
  private lastDoc = Number.NEGATIVE_INFINITY;
  private readonly docListeners = new Set<(doc: DocWord) => void>();
  private readonly journalListeners = new Set<(from: number, answered: readonly string[]) => void>();
  /** Words the server asked for, going up a piece at a time, and when the last piece went. */
  private textsOut: { id: number; parts: string[]; next: number } | null = null;
  private textsId = 1;
  private lastPiece = Number.NEGATIVE_INFINITY;
  readonly stats = { events: 0, sent: 0, dropped: 0, overflow: 0, ops: 0, views: 0, notes: 0, refusals: 0, talks: 0, nodes: 0, docs: 0, journals: 0, needs: 0, pieces: 0, lastWhy: '' };

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
    // A server from before the companion would refuse word of one as something no browser says happened.
    if (ev.k === 'companion' && this.deps.line().story < PEOPLE_STORY) {
      this.stats.dropped++;
      return { ok: false, why: 'this server keeps no companion' };
    }
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

  /**
   * Whether a server can be asked to speak for somebody just now: it runs this character's jobs, says it holds
   * conversations, and its last view says that person has something to say (`CastView.talk`). Somebody of the
   * story with no conversation of their own is never asked for one, so the window does not wait a round trip
   * on a server that can only say they have nothing to say.
   */
  canTalk(speaker: string, who: string | null = null): boolean {
    if (!this.ready || this.deps.line().story < TALK_STORY) return false;
    // One of the game's own people: asked of the server when the game gives them a conversation, which the
    // server, holding the same reference, answers for whether or not it reads a story set (the game's own
    // conversations need none); one from before them refuses, and the window falls back on a greeting.
    if (speaker.startsWith('row:')) return !!who && !!this.deps.voiced?.(who);
    if (!this.setsRead) return false;
    const v = this.view();
    return !!v && v.cast.some((c) => c.id === speaker && c.talk);
  }

  /**
   * A conversation's turn, asked of the server, which answers with the node it reached (`word`). One of the
   * game's own people goes up with the creature they are stood as (`who`), which a server from before them
   * leaves unread and answers that they have nothing to say.
   */
  talk(op: 'open' | 'pick' | 'close', speaker: string, reply: string | null = null, who: string | null = null, close?: { read: Record<string, string>; name: string | null }): HostAnswer {
    const why = this.whyNot() ?? (this.deps.line().story < TALK_STORY ? 'this server holds no conversations' : null);
    if (why) return { ok: false, why };
    this.stats.talks++;
    // A close carries what the window read out of the client's own lines and the name it showed, for the
    // transcript, to a server that keeps a journal; one from before it is told nothing it would not read.
    const words = op === 'close' && close && this.deps.line().story >= DOCS_STORY ? { read: Object.keys(close.read).map((ref) => ({ ref, text: close.read[ref] })), ...(close.name ? { name: close.name } : {}) } : {};
    this.push({ t: 'story', do: 'talk', op, speaker, ...(op === 'pick' && reply ? { reply } : {}), ...(op === 'open' && who ? { who } : {}), ...words, at: this.deps.at() });
    return { ok: true };
  }

  onNode(fn: (node: NodeWord) => void): () => void {
    this.nodeListeners.add(fn);
    return () => this.nodeListeners.delete(fn);
  }

  /** Why a document or the journal's words cannot be asked of the server just now, or null. */
  private whyNotDocs(): string | null {
    return this.whyNot() ?? (this.deps.line().story < DOCS_STORY ? 'this server keeps no documents or journal' : null);
  }

  /** A document asked of the server: opened, read to its end, or chosen on at its foot. The page comes back as `doc`. */
  read(doc: string, opts: { end?: boolean; pick?: string | null } = {}): HostAnswer {
    const why = this.whyNotDocs();
    if (why) return { ok: false, why };
    this.push({ t: 'story', do: 'read', doc, ...(opts.end ? { end: 1 } : {}), ...(opts.pick ? { pick: opts.pick } : {}), at: this.deps.at() });
    return { ok: true };
  }

  onDoc(fn: (doc: DocWord) => void): () => void {
    this.docListeners.add(fn);
    return () => this.docListeners.delete(fn);
  }

  /**
   * A note of the player's own on a journal entry, asked of the server, which writes it. Its words are kept here
   * at once, under the hash the server will write them by (both clean them with `cleanMine`), so the note shows in
   * its own words the moment its entry comes down rather than waiting on a server that is never asked for them.
   */
  mine(ref: string, text: string): HostAnswer {
    const why = this.whyNotDocs();
    if (why) return { ok: false, why };
    const words = cleanMine(text);
    if (!words) return { ok: false, why: 'a note says something' };
    this.deps.texts?.put({ [textHash(words)]: words });
    this.push({ t: 'story', do: 'mine', ref, text: words, at: this.deps.at() });
    return { ok: true };
  }

  /**
   * The words of a stretch of the journal (`from`, counted from nought, `count` entries, no more than one word
   * carries) asked of the server, which this browser has not got. The answer names the entries it carried.
   */
  askJournal(from: number, count: number): HostAnswer {
    const why = this.whyNotDocs();
    if (why) return { ok: false, why };
    this.stats.journals++;
    this.push({ t: 'story', do: 'journal', from: Math.max(0, Math.floor(from)), count: Math.max(1, Math.min(STORY_WIRE.journalMax, Math.floor(count))) });
    return { ok: true };
  }

  /** Be told whenever the words of a stretch of the journal have come: where it began, and the hashes of the entries it carried. */
  onJournal(fn: (from: number, answered: readonly string[]) => void): () => void {
    this.journalListeners.add(fn);
    return () => this.journalListeners.delete(fn);
  }

  /** Words the server asked for (`need`), out of this browser's own store, sent up a piece at a time. */
  private offerTexts(hashes: readonly string[]): void {
    const keep = this.deps.texts;
    if (!keep) return;
    const out: Record<string, string> = {};
    for (const h of hashes) {
      const t = keep.get(h);
      // Only words that are what their hash says: a store is a browser's and may hold anything.
      if (t !== undefined && textHash(t) === h) out[h] = t;
    }
    if (!Object.keys(out).length) return;
    this.textsOut = { id: this.textsId++, parts: chunkText(bookText(out), STORY_TUNE.offerChunk), next: 0 };
  }

  /** One piece of the words going up, no sooner than `chunkGap` after the last: under the relay's allowance a second. */
  private sendPiece(now: number): void {
    const o = this.textsOut;
    if (!o || now - this.lastPiece < STORY_TUNE.chunkGap || !this.ready) return;
    this.deps.send({ t: 'story', do: 'texts', id: o.id, n: o.next, of: o.parts.length, part: o.parts[o.next] });
    this.lastPiece = now;
    this.stats.pieces++;
    o.next++;
    if (o.next >= o.parts.length) this.textsOut = null;
  }

  /**
   * Send what is waiting, no more than the allowance a second, and a conversation's opening or answer no sooner
   * than `talkGap` after the last: one sent past the server's own allowance would be answered only with a
   * refusal, so it waits its turn at the head of the queue instead (the words behind it wait with it, which keeps
   * them in the order they were said).
   */
  private flush(now: number): void {
    if (!this.ready) return;
    if (now - this.window >= 1000) {
      this.window = now;
      this.sentInWindow = 0;
    }
    while (this.queue.length && this.sentInWindow < REMOTE_TUNE.evPerSecond) {
      const m = this.queue[0];
      const paced = m.do === 'talk' && m.op !== 'close';
      if (paced && now - this.lastTalk < REMOTE_TUNE.talkGap) break;
      const doc = m.do === 'read' || m.do === 'journal' || m.do === 'mine';
      if (doc && now - this.lastDoc < REMOTE_TUNE.docGap) break;
      this.queue.shift();
      this.deps.send(m);
      if (paced) this.lastTalk = now;
      if (doc) this.lastDoc = now;
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
      this.textsOut = null;
    }
    const wall = this.deps.wall();
    this.flush(wall);
    this.sendPiece(wall);
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
    } else if (w.do === 'node') {
      this.stats.nodes++;
      if (w.why) this.stats.lastWhy = w.why;
      for (const fn of this.nodeListeners) {
        try {
          fn({ speaker: w.speaker, view: w.view, why: w.why });
        } catch (err) {
          console.warn('story: a node listener failed', err);
        }
      }
    } else if (w.do === 'doc') {
      this.stats.docs++;
      if (w.why) this.stats.lastWhy = w.why;
      // The page as read is the journal's words too: kept by its hash, so reading it again here needs no word. A
      // page saying its words were not kept is not words of anybody's.
      if (w.view && this.deps.texts && !isUnkeptView(w.view)) {
        const text = JSON.stringify(w.view);
        this.deps.texts.put({ [textHash(text)]: text });
      }
      const word: DocWord = { doc: w.doc, view: w.view, foot: w.foot, entry: w.entry, why: w.why, ...(w.from ? { from: w.from } : {}), ...(w.end ? { end: true as const } : {}) };
      for (const fn of this.docListeners) {
        try {
          fn(word);
        } catch (err) {
          console.warn('story: a document listener failed', err);
        }
      }
    } else if (w.do === 'journal') {
      // Only words that are what their hash says are kept.
      const texts = cleanTexts(w.texts, textHash);
      if (this.deps.texts && Object.keys(texts).length) this.deps.texts.put(texts);
      // What this answer settles: the words of the entries it carried, kept or not; nothing it did not carry.
      const answered = journalHashes(w.entries);
      for (const fn of this.journalListeners) {
        try {
          fn(w.from, answered);
        } catch (err) {
          console.warn('story: a journal listener failed', err);
        }
      }
    } else if (w.do === 'need') {
      this.stats.needs++;
      this.offerTexts(w.hashes);
    }
  }

  /** Another character, or none: the view in hand is nobody's now. */
  reset(): void {
    this.queue.length = 0;
    this.nextTick.length = 0;
    this.textsOut = null;
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
