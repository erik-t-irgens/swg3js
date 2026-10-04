// Every character's story book, held by the server: the one copy that stands while a browser plays here.
//
// **One rule book, two hosts.** What a book is and how it changes is `src/story/book.ts`, which this file
// imports as it is, under node's own type stripping, exactly as the converter imports the game's terrain;
// the browser runs the very same file when it holds the book itself. So a change is applied by one
// function wherever it is applied, and a book the server writes down is one the browser reads back
// without a second opinion about what it means. What is here is only what the server does with that:
// whose book it is, when to ask a browser for its copy and when to hand it the server's, and writing
// every change down before anybody is told.
//
// **Settling, like the rest of the character.** A browser that has just claimed says what its copy holds
// (`sync`). With no book of the server's own, a browser that has one is asked for it (`want`) -- the
// first copy handed up is the one written down, as the ledger takes a backpack -- and one that has none
// is given a new, empty book. With a book of the server's own, the browser's copy is taken only when the
// character's own change counter settled the browser's way (`c.keep`, which the relay keeps on the line
// for exactly this) and the browser made changes with nobody holding the book; otherwise the server's
// stands and is handed down. A book taken is never merged with the one it replaces: the old one goes to
// the archive whole, and every reward the browser's says it paid is marked as the browser's, so the
// server never pays it again. An empty book from a browser that believes a server already holds this
// character, and that counts no change of its own to it, is a cleared cache and never written down over
// anything; one emptied by hand counts the changes that emptied it and is a story like any other. Nothing
// is settled while the character itself is still a question put to the player.
//
// **In pieces.** A browser's input is dropped past 64 KB a second, so a book goes up in pieces
// (`src/story/storyWire.ts`) and is put back together here, no larger than `offerMax` and with no longer
// than `offerWait` between one piece and the next. It comes down in pieces of the same size.
//
// What is the game's and what is ours: none of it is the game's. Every number below is ours, lives in
// `STORY_TUNING`, is printed on the status page and moves for a run with `--set story.<name>=n`.
//
// How it is used: nothing in here touches a socket. The relay hands in the line (its id, its character
// and how that character was settled) and every decision answers `{ ok, why, tell }`, where `tell` is a
// list of `{ to: <connection>, msg }` for the relay to send, as the purse, the homes and the ledger do.
// Writing is one callback handed in, which must apply the record as well as keep it (the store's
// `change` does both), because the books this reads are the store's own.

import { BACKSTOP_LIMITS, BOOK_LIMITS, applyChanges, bookIsEmpty, bookSummary, cleanBook, emptyBook, isCharacterId, markPaidBy, whyNot } from '../src/story/book.ts';
import { Reassembly, STORY_WIRE, bookText, chunkText, cleanStoryWord } from '../src/story/storyWire.ts';

/**
 * The story this server holds, as its hail says it: 1 is the book and its waypoints. A browser never
 * says a story word to a server whose hail does not carry one, so a newer browser never asks an older
 * server for a word it does not know.
 */
export const STORY_WIRE_VERSION = 1;

/** Every number this file invents. None of them is from the game. */
export const STORY_TUNING = {
  /** The piece a book is cut into, both ways, in characters (a book on the wire is ASCII, so bytes). */
  offerChunk: 24000,
  /** The largest book a browser may hand up, in characters. */
  offerMax: 4000000,
  /** The longest wait between one piece of a book and the next before it is given up, in milliseconds. */
  offerWait: 60000,
  /** How many books a character's archive keeps: the copies a taken book replaced, newest last. */
  archive: 3,
  /** How many waypoints a character keeps that it set itself (the owner's own number). */
  waypoints: 100,
  /** Waypoint words one browser may send in a second. */
  wpRate: 4,
  /** The largest book this server holds for one character, in characters. */
  bookMax: 8000000,
  /** `sync` words one browser may send in a second: each is answered with the whole book. */
  syncRate: 1,
};

/**
 * The caps a book is held to here: the book's own, with the server's waypoint number in place of its own.
 * That number may be moved for a run, but never past what a browser will hold a server's book to
 * (`BACKSTOP_LIMITS`), or a browser would read back a copy cut shorter than the one written down here.
 */
function limitsOf(tuning = STORY_TUNING) {
  const waypoints = Math.max(0, Math.min(BACKSTOP_LIMITS.waypoints, Math.floor(Number(tuning.waypoints)) || 0));
  return { ...BOOK_LIMITS, waypoints };
}

/**
 * The piece a book is cut into, as the tuning says, held under the longest piece a browser will read
 * (`STORY_WIRE.partMax`): past that every piece the server sent would be dropped as malformed, and the
 * browser would ask again every few seconds for a book it could never be handed.
 */
function chunkOf(tuning = STORY_TUNING) {
  return Math.max(1, Math.min(STORY_WIRE.partMax, Math.floor(Number(tuning.offerChunk)) || 1));
}

/** Whether this browser may send another word of a kind this second. The same window the purse uses. */
export function mayStory(window, now, perSecond) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= perSecond;
}

/**
 * Apply one record about a story to the world in memory. The same function runs when the record is
 * made and when the log is replayed on start, so a replayed world and a live one cannot drift apart:
 * a batch of changes (`story`) goes through the very `applyChanges` the browser uses, a book taken whole
 * (`storyBook`) and a book put away (`storyArchive`) are cleaned again on the way in.
 */
export function applyStory(data, rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.t !== 'story' && rec.t !== 'storyBook' && rec.t !== 'storyArchive') return false;
  if (!isCharacterId(rec.id)) return false;
  data.stories ??= Object.create(null);
  data.storyArchive ??= Object.create(null);
  if (rec.t === 'story') {
    const book = data.stories[rec.id];
    if (!book) return false;
    applyChanges(book, rec.ch, limitsOf());
    return true;
  }
  const book = cleanBook(rec.book, limitsOf());
  if (!book || book.char !== rec.id) return false;
  if (rec.t === 'storyBook') {
    data.stories[rec.id] = book;
    return true;
  }
  const list = Array.isArray(data.storyArchive[rec.id]) ? data.storyArchive[rec.id] : [];
  list.push(book);
  while (list.length > Math.max(1, STORY_TUNING.archive)) list.shift();
  data.storyArchive[rec.id] = list;
  return true;
}

/**
 * The books of a world just read back from its file, rebuilt as the rules expect them. `JSON.parse` hands
 * back plain objects all the way down, and a book's own tables (its flags, quests, steps and rewards) are
 * keyed by what a browser chose: left as they are, `toString` would read as a flag the server's copy has
 * set and the browser's copy has not. So every book, and every book put away, goes through the same
 * `cleanBook` a book handed up does, held only to the backstop caps (a server run with caps of its own,
 * then started without them, must never cut what it wrote down). A book that will not clean -- one written
 * by a newer server -- is kept exactly as it was. Runs before the log is played back and again when the
 * stories take the world, so whichever reads it first, nothing reads it raw.
 */
export function readStories(data) {
  const books = Object.create(null);
  for (const id of Object.keys(data.stories ?? {})) books[id] = cleanBook(data.stories[id], BACKSTOP_LIMITS) ?? data.stories[id];
  const archive = Object.create(null);
  for (const id of Object.keys(data.storyArchive ?? {})) {
    const list = data.storyArchive[id];
    archive[id] = Array.isArray(list) ? list.map((b) => cleanBook(b, BACKSTOP_LIMITS) ?? b) : list;
  }
  data.stories = books;
  data.storyArchive = archive;
  return data;
}

export class Stories {
  /**
   * @param {{ tuning?: Record<string, number>, write?: (rec: object) => void, now?: () => number }} options
   * the numbers to work to, where a record goes to be applied and kept, and the shared clock a waypoint's
   * time is written in.
   */
  constructor({ tuning = STORY_TUNING, write = () => {}, now = () => Date.now() } = {}) {
    this.tuning = tuning;
    this.write = write;
    this.now = now;
    this.data = { stories: Object.create(null), storyArchive: Object.create(null) };
    /** @type {Map<number, string>} a line asked for its book, and whose book it is */
    this.wanting = new Map();
    /** @type {Map<number, Reassembly>} a book coming up, by line */
    this.offers = new Map();
    /** @type {Map<number, { wp: { at: number, lines: number }, sync: { at: number, lines: number } }>} each line's allowances */
    this.windows = new Map();
    this.bookId = 1;
    this.taken = 0;
    this.guarded = 0;
    this.changes = 0;
    this.refusals = 0;
  }

  /** Take the world the store read back, its books rebuilt as the rules expect them. They are its own, read and written in place. */
  load(data) {
    readStories(data);
    this.data = data;
    return this;
  }

  /** A character's book, or null. */
  bookOf(character) {
    return (character && this.data.stories[character]) || null;
  }

  /** A character's book, written down empty first when it has none. */
  ensure(character) {
    if (!this.bookOf(character)) this.write({ t: 'storyBook', id: character, book: emptyBook(character) });
    return this.bookOf(character);
  }

  windowsOf(session) {
    let w = this.windows.get(session);
    if (!w) {
      w = { wp: { at: 0, lines: 0 }, sync: { at: 0, lines: 0 } };
      this.windows.set(session, w);
    }
    return w;
  }

  no(session, why) {
    this.refusals++;
    return { ok: false, why, tell: [{ to: session, msg: { t: 'story', do: 'no', why } }] };
  }

  /** The server's book handed down, in pieces, with whose copy it is. A character with none is handed an empty one, not written down. */
  answer(session, character, take) {
    const book = this.bookOf(character) ?? emptyBook(character);
    const parts = chunkText(bookText(book), chunkOf(this.tuning));
    const id = this.bookId++;
    return { ok: true, take, tell: parts.map((part, n) => ({ to: session, msg: { t: 'story', do: 'book', id, n, of: parts.length, part, take } })) };
  }

  /** Ask a line for its book. Only a book asked for is ever taken. */
  want(session, character) {
    this.wanting.set(session, character);
    this.offers.delete(session);
    return { ok: true, tell: [{ to: session, msg: { t: 'story', do: 'want', chunk: chunkOf(this.tuning) } }] };
  }

  /**
   * One word from a line, already past the relay's character guard: cleaned here, and handed to what
   * answers it. `c` is the line: `{ id, character, keep, asking }`, `asking` set while a tie between two
   * copies of the character is still waiting on the player.
   */
  hear(c, msg) {
    const word = cleanStoryWord(msg, 'up');
    if (!word || !c?.character) return { ok: false, why: 'not a story word', tell: [] };
    if (word.do === 'sync') return this.sync(c, word);
    if (word.do === 'offer') return this.offer(c, word);
    return this.waypoint(c, word);
  }

  /**
   * What a browser holds, and the server's answer: its own book, a new one, or a request for the browser's.
   * Not while the character itself is still a question put to the player (`c.asking`, and `c.keep` still
   * `ask`, which the answer and the wait running out each rewrite): the answer is read off how the
   * character settled, and a `sync` that came ahead of the answer would settle the book the server's way
   * before the player had said which copy stands. A browser asks again once it is answered.
   */
  sync(c, word) {
    const character = c.character;
    if (c.asking || c.keep === 'ask') return { ok: false, why: 'the character is still being settled', tell: [] };
    if (!mayStory(this.windowsOf(c.id).sync, Date.now(), this.tuning.syncRate)) return { ok: false, why: 'too often', tell: [] };
    this.offers.delete(c.id);
    this.wanting.delete(c.id);
    const mine = this.bookOf(character);
    if (!mine) {
      // The first copy handed up is the one written down, as the ledger takes a backpack.
      if (word.has) return this.want(c.id, character);
      this.ensure(character);
      return this.answer(c.id, character, 'server');
    }
    // The character itself settled the browser's way, and the browser changed its book with nobody
    // holding it: that copy is the newer, and it is asked for. Anything else, the server's stands.
    if (c.keep === 'browser' && word.has && word.local > 0) return this.want(c.id, character);
    return this.answer(c.id, character, 'server');
  }

  /**
   * A piece of a browser's book, asked for. Once the last piece is in, it is cleaned and taken: the
   * server's own goes to the archive, the browser's is written down at a revision past both, and the
   * browser is handed back what was written so the two copies are one.
   */
  offer(c, word) {
    const character = c.character;
    if (this.wanting.get(c.id) !== character) return { ok: false, why: 'not asked for', tell: [] };
    let pieces = this.offers.get(c.id);
    if (!pieces) {
      pieces = new Reassembly(this.tuning.offerMax, this.tuning.offerWait);
      this.offers.set(c.id, pieces);
    }
    pieces.max = Math.min(this.tuning.offerMax, this.tuning.bookMax);
    pieces.wait = this.tuning.offerWait;
    const got = pieces.add(word, Date.now());
    if (!got) return { ok: true, tell: [] };
    this.offers.delete(c.id);
    if ('why' in got) {
      // Pieces out of order or too slow come again: the browser asks once more when its own wait runs
      // out, and is asked for its book again. A book too large never will fit, so the server's stands.
      if (/larger/.test(got.why)) return this.refuse(c.id, character, got.why);
      this.wanting.delete(c.id);
      return this.no(c.id, got.why);
    }
    this.wanting.delete(c.id);
    let raw;
    try {
      raw = JSON.parse(got.text);
    } catch {
      return this.refuse(c.id, character, 'that book could not be read');
    }
    const offered = cleanBook(raw, limitsOf(this.tuning));
    if (!offered || offered.char !== character) return this.refuse(c.id, character, 'that book could not be read');
    const mine = this.bookOf(character);
    // An empty book from a browser that believes a server holds this character already, and that counts
    // no change of its own to it: a cache that was cleared, not a story. The server's own stands, or with
    // none an empty one, never written down. One emptied by hand counts the changes that emptied it, and is
    // a story with nothing left in it, taken like any other.
    if (bookIsEmpty(offered) && offered.local === 0 && word.known) {
      this.guarded++;
      return this.answer(c.id, character, 'server');
    }
    if (mine) this.write({ t: 'storyArchive', id: character, book: mine });
    offered.rev = Math.max(mine?.rev ?? 0, offered.rev) + 1;
    offered.base = 0;
    offered.local = 0;
    markPaidBy(offered, 'browser');
    this.write({ t: 'storyBook', id: character, book: offered });
    this.taken++;
    return this.answer(c.id, character, 'browser');
  }

  /** Nothing of the browser's is taken: the server's own book stands, handed down so the two agree. */
  refuse(session, character, why) {
    this.wanting.delete(session);
    const no = this.no(session, why);
    return { ok: false, why, tell: [...no.tell, ...this.answer(session, character, 'server').tell] };
  }

  /**
   * A waypoint set, renamed, recoloured, switched, taken away or tracked. The id of a new one is the
   * server's, from the book's own counter, and so is its time; the change is written down, applied, and
   * the batch sent back at the revision it made.
   */
  waypoint(c, word) {
    const character = c.character;
    if (c.asking || c.keep === 'ask' || this.wanting.has(c.id) || this.offers.has(c.id)) return this.no(c.id, 'this character’s story is being settled with the server');
    if (!mayStory(this.windowsOf(c.id).wp, Date.now(), this.tuning.wpRate)) return this.no(c.id, 'too many waypoint changes at once: wait a moment');
    const book = this.ensure(character);
    if (!book) return this.no(c.id, 'this character has no story here');
    let change;
    if (word.op === 'set') change = { k: 'wpSet', wp: { id: `w${book.nextWp}`, ...word.wp, made: this.now() } };
    else if (word.op === 'edit') change = { k: 'wpEdit', id: word.id, ...(word.name !== undefined ? { name: word.name } : {}), ...(word.colour !== undefined ? { colour: word.colour } : {}) };
    else if (word.op === 'on' || word.op === 'off') change = { k: 'wpOn', id: word.id, on: word.op === 'on' };
    else if (word.op === 'gone') change = { k: 'wpGone', id: word.id };
    else change = { k: 'trackWp', id: word.id };
    const why = whyNot(book, change, limitsOf(this.tuning));
    if (why) return this.no(c.id, why);
    this.write({ t: 'story', id: character, ch: [change] });
    this.changes++;
    const after = this.bookOf(character);
    return { ok: true, id: change.wp?.id, tell: [{ to: c.id, msg: { t: 'story', do: 'ch', rev: after.rev, ch: [change] } }] };
  }

  /** A book half up for longer than the wait is given up, and its browser told. */
  tick(now = Date.now()) {
    const tell = [];
    for (const [session, pieces] of this.offers) {
      if (!pieces.expire(now)) continue;
      this.offers.delete(session);
      this.wanting.delete(session);
      this.refusals++;
      tell.push({ to: session, msg: { t: 'story', do: 'no', why: 'the pieces stopped coming' } });
    }
    return { ok: true, tell };
  }

  /** A line has closed: whatever it was handing up is forgotten. */
  gone(session) {
    this.wanting.delete(session);
    this.offers.delete(session);
    this.windows.delete(session);
  }

  /** What the status page prints. */
  describe() {
    let waypoints = 0;
    let books = 0;
    for (const id of Object.keys(this.data.stories)) {
      books++;
      waypoints += bookSummary(this.data.stories[id])?.waypoints ?? 0;
    }
    let archived = 0;
    for (const id of Object.keys(this.data.storyArchive)) archived += Array.isArray(this.data.storyArchive[id]) ? this.data.storyArchive[id].length : 0;
    return { v: STORY_WIRE_VERSION, books, waypoints, archived, asking: this.wanting.size, coming: this.offers.size, taken: this.taken, guarded: this.guarded, changes: this.changes, refusals: this.refusals, tuning: this.tuning };
  }
}
