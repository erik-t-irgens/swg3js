// This browser's half of the story book: the copy it keeps of the character in play, who holds that
// book just now, and the waypoints the player sets, renames, recolours, switches and takes away.
//
// **Who holds it.** With no server, an old relay, or a server whose hail says nothing of a story, this
// browser does (`local`): a change is applied here at once, kept in storage, and counted in `local`,
// which is what the character's change counter reads. With a server whose hail carries `story`, the
// server does (`server`): a change is asked for, and shown when the server's batch (`ch`) comes back.
// In between -- the moment after a claim while the two copies are being settled, and a line that has
// dropped and is coming back -- nobody may change it (`held`), which is what keeps the book one timeline
// rather than two that would have to be merged.
//
// **Settling.** Once the server has the claim (or the player has answered a tie), this says what it
// holds (`sync`): whether its copy has anything in it, the server revision it last matched and how many
// changes it made since. The server answers with its own book, or asks for this one (`want`), which goes
// up in pieces a little apart so the relay never takes it for a browser shouting. A copy with changes of
// its own that the server did not take is set aside in storage, never thrown away, and the player is
// told so on the message line.
//
// Nothing in here touches the page, three or a socket: what it needs is handed in (`BookDeps`), so the
// node tests drive it against a fake and against the relay itself. Nothing runs in a frame: the wiring
// steps it four times a second for its pacing and its waits.

import { BACKSTOP_LIMITS, BOOK_LIMITS, applyChanges, bookIsEmpty, bookSummary, cleanBook, emptyBook, type StoryBook, type StoryChange } from './book.ts';
import { Reassembly, STORY_WIRE, bookText, chunkText, cleanStoryWord } from './storyWire.ts';
import { loadBook, saveBook, setAside, type StoryStorage } from './storyStore.ts';
import { cleanWaypointAsk, cleanWaypointName, isWaypointColour, type Waypoint, type WaypointColour } from './waypoints.ts';

/** The browser's own numbers, every one ours. The sizes a server takes are the server's (`STORY_TUNING`). */
export const STORY_TUNE = {
  /** Milliseconds between two pieces of a book going up: under the relay's 64 KB a second with room to spare. */
  chunkGap: 500,
  /** Milliseconds to wait for a server's answer to `sync` before asking again, and between pieces coming down. */
  syncWait: 10000,
  /** Waypoint words a second sent to a server, under the four it allows; more wait their turn rather than being refused. */
  wpPerSecond: 3,
  /** The piece a book is cut into when a server asks for it without saying (one that does says so in its `want`). */
  offerChunk: 24000,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneStory(o: Partial<typeof STORY_TUNE>): typeof STORY_TUNE {
  if (typeof o.chunkGap === 'number' && Number.isFinite(o.chunkGap)) STORY_TUNE.chunkGap = Math.max(50, Math.min(10000, Math.round(o.chunkGap)));
  if (typeof o.syncWait === 'number' && Number.isFinite(o.syncWait)) STORY_TUNE.syncWait = Math.max(500, Math.min(120000, Math.round(o.syncWait)));
  if (typeof o.wpPerSecond === 'number' && Number.isFinite(o.wpPerSecond)) STORY_TUNE.wpPerSecond = Math.max(1, Math.min(20, Math.round(o.wpPerSecond)));
  if (typeof o.offerChunk === 'number' && Number.isFinite(o.offerChunk)) STORY_TUNE.offerChunk = Math.max(1000, Math.min(STORY_WIRE.partMax, Math.round(o.offerChunk)));
  return STORY_TUNE;
}

/** The largest book this browser takes down from a server, in characters. */
const BOOK_DOWN_MAX = 16000000;

export type StoryHost = 'local' | 'server' | 'held';

/**
 * Why the book changed, as its listeners are told: a character's book read in (`use`), a change made here
 * with nobody else holding it (`mine`), a server's batch (`server`), or the copy a server settled on just
 * now (`settled`). A settle is the one that is not a change to the character, though it moves the count of
 * changes made alone back to nought: the wiring tells the session so, or the change counter would rise for
 * a record that moved only because the server and this browser came to agree about it.
 */
export type StoryWhy = 'use' | 'mine' | 'server' | 'settled';

/** What the line is doing, as the session and the socket say it (`src/net/session.ts`, `src/net/net.ts`). */
export interface StoryLine {
  authority: 'me' | 'server';
  /** The story a server's hail said it holds; 0 for none. */
  story: number;
  status: 'off' | 'connecting' | 'online' | 'reconnecting';
  mode: 'off' | 'waiting' | 'relay' | 'server';
}

export interface BookDeps {
  store: StoryStorage;
  /** A word to the server. */
  send(msg: Record<string, unknown>): void;
  /** A line on the message line. */
  say(text: string): void;
  /** The shared clock, in milliseconds: what a waypoint's time is written in. */
  now(): number;
  /** The wall clock, in milliseconds: what the pacing and the waits run on. */
  wall(): number;
  line(): StoryLine;
  /** Whether the character's own record says a server has held it before. */
  known(): boolean;
}

/** What asking for a change came to. `sent` is a change gone to the server: it shows when the server's answer does. */
export interface StoryResult {
  ok: boolean;
  why?: string;
  id?: string;
  sent?: boolean;
}

export class BookClient {
  private readonly deps: BookDeps;
  private bk: StoryBook | null = null;
  private kind: StoryHost = 'local';
  /** Whether the line that has us now (or had, while it comes back) holds the story. */
  private storyLine = false;
  /** Whether the server's book has arrived on this line: until it has, nobody changes anything. */
  private settled = false;
  /** A `sync` gone and not answered, and when it went. */
  private settling = false;
  private syncAt = 0;
  /** This book going up, a piece at a time. */
  private offer: { id: number; parts: string[]; next: number; at: number } | null = null;
  private offerId = 1;
  private readonly incoming = new Reassembly(BOOK_DOWN_MAX, STORY_TUNE.syncWait);
  /** Waypoint words waiting their turn, and the second they are being counted in. */
  private readonly queue: Record<string, unknown>[] = [];
  private window = 0;
  private sentInWindow = 0;
  private readonly listeners = new Set<(why: StoryWhy, localWas: number) => void>();
  readonly stats = { syncs: 0, offers: 0, pieces: 0, books: 0, taken: 0, setAside: 0, changes: 0, gaps: 0, refusals: 0, dropped: 0, lastWhy: '' };

  constructor(deps: BookDeps) {
    this.deps = deps;
  }

  // ---- what everything else asks --------------------------------------------------------------------

  /** The book as this browser holds it, or null with no character in play. Read, never written to. */
  get book(): StoryBook | null {
    return this.bk;
  }

  /** Who holds the book just now. */
  get host(): StoryHost {
    return this.kind;
  }

  /** Changes made here with nobody else holding the book, since a server last matched it. */
  get local(): number {
    return this.bk?.local ?? 0;
  }

  /**
   * Be told whenever the book changes, why, and how many changes made alone it held just before (which a
   * settle moves back to nought). Answers the way to stop being told.
   */
  onChange(fn: (why: StoryWhy, localWas: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(why: StoryWhy, localWas: number): void {
    for (const fn of this.listeners) {
      try {
        fn(why, localWas);
      } catch (err) {
        console.warn('story: a listener failed', err);
      }
    }
  }

  // ---- the character and the line ---------------------------------------------------------------------

  /** The character in play, whose book is read from storage; null when there is none (the select screen). */
  use(char: string | null): void {
    if ((this.bk?.char ?? null) === char) return;
    this.offer = null;
    this.incoming.clear();
    this.queue.length = 0;
    this.settled = false;
    this.settling = false;
    this.bk = char ? (loadBook(this.deps.store, char) ?? emptyBook(char)) : null;
    this.derive();
    this.emit('use', this.bk?.local ?? 0);
  }

  /** Work out who holds the book from what the line is doing. Cheap, and asked at every step. */
  private derive(): void {
    const l = this.deps.line();
    const was = this.kind;
    if (l.authority === 'server' && l.story >= 1) {
      this.storyLine = true;
      this.kind = this.settled ? 'server' : 'held';
    } else if (l.authority !== 'server' && this.storyLine && l.status !== 'off' && l.mode !== 'relay') {
      // The line that held the story has dropped and is coming back: nobody changes the book meanwhile,
      // or two copies would part ways and one would have to be thrown away. A `sync` that was waiting on
      // an answer is forgotten with the line it went on: the next one goes once the new line has the
      // claim, never ahead of it, where it could reach the server after the claim and before a tie on that
      // claim was answered and settle the book before the player had said which copy stands.
      this.settled = false;
      this.settling = false;
      this.kind = 'held';
    } else {
      this.storyLine = false;
      this.settled = false;
      this.kind = 'local';
    }
    if (was === 'server' && this.kind !== 'server') {
      this.offer = null;
      this.incoming.clear();
      if (this.queue.length) {
        this.deps.say(`${this.queue.length} waypoint ${this.queue.length === 1 ? 'change was' : 'changes were'} not sent: the server stopped answering`);
        this.stats.dropped += this.queue.length;
        this.queue.length = 0;
      }
    }
  }

  /**
   * A server has this browser's claim. When its hail spoke of a story the book is settled now, unless
   * the two copies of the character tie and the player has still to say which stands (`tieWaiting`),
   * which waits for their answer (`answered`). A tie answered from memory is answered before the claim
   * is, so it is the question still standing that is asked, never the server's word for how it settled.
   */
  claimed(tieWaiting: boolean): void {
    this.settled = false;
    this.settling = false;
    this.offer = null;
    this.incoming.clear();
    this.derive();
    if (this.storyLine && !tieWaiting) this.sync();
  }

  /** The tie was answered, by the player or for them: the book is settled now. */
  answered(): void {
    this.derive();
    if (this.storyLine) this.sync();
  }

  /** Whether the record or the book says a server has held this character's story before. */
  private known(): boolean {
    return this.deps.known() || (this.bk?.base ?? 0) > 0;
  }

  /**
   * Say what this copy holds, and wait for the server's answer with nobody changing anything. Only on a
   * line the server has claimed: what a `sync` is answered with is read off how the claim settled, so one
   * that went ahead of the claim's answer would be answered for a question the player had not yet been
   * put. A copy with nothing in it still `has` something when it was emptied here by hand (`local`): it
   * is a story whose waypoints were all taken away, not a cache that was cleared, and is offered like any
   * other.
   */
  private sync(): void {
    const bk = this.bk;
    if (!bk || this.deps.line().authority !== 'server') return;
    this.settled = false;
    this.settling = true;
    this.syncAt = this.deps.wall();
    this.derive();
    this.stats.syncs++;
    this.deps.send({ t: 'story', do: 'sync', has: bookIsEmpty(bk) && bk.local === 0 ? 0 : 1, base: bk.base, local: bk.local, known: this.known() ? 1 : 0 });
  }

  /** A story word from the server, handed over whole. */
  word(msg: Record<string, unknown>): void {
    const w = cleanStoryWord(msg, 'down');
    if (!w || !this.bk) return;
    this.derive();
    if (!this.storyLine) return;
    if (w.do === 'want') this.startOffer(msg.chunk);
    else if (w.do === 'book') this.piece(w);
    else if (w.do === 'ch') this.changes(w.rev, w.ch, w.whole);
    else {
      this.stats.refusals++;
      this.stats.lastWhy = w.why;
      this.offer = null;
      this.deps.say(w.why);
    }
  }

  /** The server asked for this book: it goes up in pieces, the first at once and the rest a gap apart. */
  private startOffer(chunk: unknown): void {
    const size = typeof chunk === 'number' && Number.isFinite(chunk) ? Math.max(1000, Math.min(STORY_WIRE.partMax, Math.floor(chunk))) : STORY_TUNE.offerChunk;
    this.offer = { id: this.offerId++, parts: chunkText(bookText(this.bk), size), next: 0, at: 0 };
    this.sendPiece(this.deps.wall());
  }

  private sendPiece(now: number): void {
    const o = this.offer;
    if (!o) return;
    this.deps.send({ t: 'story', do: 'offer', id: o.id, n: o.next, of: o.parts.length, part: o.parts[o.next], known: this.known() ? 1 : 0 });
    o.next++;
    o.at = now;
    this.stats.pieces++;
    if (o.next >= o.parts.length) {
      this.offer = null;
      this.stats.offers++;
      // The answer is waited on from the last piece, not from the question.
      this.syncAt = now;
    }
  }

  /**
   * A piece of the server's book. Once the last is in, it is this browser's copy from then on. Only a book
   * this browser is waiting on is taken: every one it is handed answers a `sync` it sent, so a book that
   * arrives with none outstanding answers a question nobody is asking any more.
   */
  private piece(w: { id: number; n: number; of: number; part: string; take: 'browser' | 'server' }): void {
    if (!this.settling) return;
    const got = this.incoming.add(w, this.deps.wall());
    if (!got) return;
    if ('why' in got) {
      this.stats.lastWhy = got.why;
      this.sync();
      return;
    }
    let book: StoryBook | null = null;
    try {
      book = cleanBook(JSON.parse(got.text), BACKSTOP_LIMITS);
    } catch {
      book = null;
    }
    const mine = this.bk;
    if (!mine || !book || book.char !== mine.char) {
      this.stats.lastWhy = 'the server’s book could not be read';
      return;
    }
    this.stats.books++;
    if (w.take === 'browser') this.stats.taken++;
    else if (mine.local > 0) {
      // Played in two places: the server's copy stands, and this one is kept aside, never thrown away --
      // an empty one included, since a book emptied here by hand is a story the server did not take.
      if (setAside(this.deps.store, mine)) this.stats.setAside++;
      this.deps.say('This character’s story was played in two places; the server’s copy stands, and this browser’s is kept aside.');
    }
    const localWas = mine.local;
    book.base = book.rev;
    book.local = 0;
    this.bk = book;
    saveBook(this.deps.store, book);
    this.settled = true;
    this.settling = false;
    this.derive();
    this.emit('settled', localWas);
  }

  /** A batch of the server's changes at a revision: applied when it is the next one, asked for again when it is not. */
  private changes(rev: number, ch: StoryChange[], whole: boolean): void {
    const bk = this.bk;
    // Before the book has come, a batch is not this copy's to apply: the book that answers the sync has it.
    if (!bk || !this.settled) return;
    if (rev <= bk.rev) return;
    if (rev !== bk.rev + 1 || !whole) {
      this.stats.gaps++;
      this.sync();
      return;
    }
    applyChanges(bk, ch, BACKSTOP_LIMITS);
    const localWas = bk.local;
    bk.rev = rev;
    bk.base = rev;
    bk.local = 0;
    saveBook(this.deps.store, bk);
    this.stats.changes++;
    this.emit('server', localWas);
  }

  /** The pacing and the waits: four times a second is plenty. */
  step(now: number): void {
    this.derive();
    if (!this.bk || this.kind === 'local') return;
    this.incoming.wait = STORY_TUNE.syncWait;
    if (this.offer && now - this.offer.at >= STORY_TUNE.chunkGap) this.sendPiece(now);
    if (this.incoming.expire(now)) this.sync();
    else if (this.settling && !this.offer && !this.incoming.busy && now - this.syncAt > STORY_TUNE.syncWait) this.sync();
    this.flush(now);
  }

  /** Send what is waiting, no more than the allowance a second. */
  private flush(now: number): void {
    if (this.kind !== 'server') return;
    if (now - this.window >= 1000) {
      this.window = now;
      this.sentInWindow = 0;
    }
    while (this.queue.length && this.sentInWindow < STORY_TUNE.wpPerSecond) {
      this.deps.send(this.queue.shift()!);
      this.sentInWindow++;
    }
  }

  // ---- the waypoints --------------------------------------------------------------------------------

  /** Why nothing may change the book just now: a line that has the claim is settling it, one that has not is not answering. */
  private held(): StoryResult {
    return { ok: false, why: this.deps.line().authority === 'server' ? 'this character’s story is being settled with the server' : 'held by the server, which is not answering' };
  }

  /** One change: applied here when this browser holds the book, asked of the server when it does. */
  private change(op: string, wp: Record<string, unknown>, c: StoryChange | null): StoryResult {
    this.derive();
    const bk = this.bk;
    if (!bk) return { ok: false, why: 'there is no character in play' };
    if (this.kind === 'held') return this.held();
    if (this.kind === 'server') {
      this.queue.push({ t: 'story', do: 'wp', op, wp });
      this.flush(this.deps.wall());
      return { ok: true, sent: true };
    }
    if (!c) return { ok: false, why: 'that is not a change' };
    const out = applyChanges(bk, [c], BOOK_LIMITS);
    if (!out.applied.length) return { ok: false, why: out.refused[0]?.why ?? 'the book would not take that' };
    bk.local++;
    saveBook(this.deps.store, bk);
    this.emit('mine', bk.local - 1);
    return { ok: true, ...(c.k === 'wpSet' ? { id: c.wp.id } : {}) };
  }

  /**
   * Set a waypoint: a name, a world, the frame and the place, and optionally a room, a colour and
   * whether it starts switched on. The id and the time are the host's to give.
   */
  addWaypoint(ask: unknown): StoryResult {
    const wp = cleanWaypointAsk(ask);
    if (!wp) return { ok: false, why: 'that is not a place to mark' };
    const bk = this.bk;
    const made: Waypoint | null = bk ? { id: `w${bk.nextWp}`, ...wp, made: this.deps.now() } : null;
    return this.change('set', wp as unknown as Record<string, unknown>, made ? { k: 'wpSet', wp: made } : null);
  }

  renameWaypoint(id: string, name: string): StoryResult {
    const clean = cleanWaypointName(name);
    if (!clean) return { ok: false, why: 'a waypoint needs a name' };
    return this.change('edit', { id, name: clean }, { k: 'wpEdit', id, name: clean });
  }

  recolourWaypoint(id: string, colour: string): StoryResult {
    if (!isWaypointColour(colour)) return { ok: false, why: 'that is not one of the waypoint colours' };
    return this.change('edit', { id, colour }, { k: 'wpEdit', id, colour: colour as WaypointColour });
  }

  switchWaypoint(id: string, on: boolean): StoryResult {
    return this.change(on ? 'on' : 'off', { id }, { k: 'wpOn', id, on });
  }

  removeWaypoint(id: string): StoryResult {
    return this.change('gone', { id }, { k: 'wpGone', id });
  }

  /** Track one waypoint, a personal one or a quest's, or none. */
  trackWaypoint(id: string | null): StoryResult {
    return this.change('track', { id }, { k: 'trackWp', id });
  }

  /** What `__debug.story()` prints. */
  report(): Record<string, unknown> {
    return {
      host: this.kind,
      storyLine: this.storyLine,
      settled: this.settled,
      settling: this.settling,
      offering: this.offer ? `${this.offer.next} of ${this.offer.parts.length}` : null,
      receiving: this.incoming.busy ? this.incoming.received : 0,
      queued: this.queue.length,
      ...(bookSummary(this.bk) ?? { char: null }),
      stats: { ...this.stats },
      tune: { ...STORY_TUNE },
    };
  }
}
