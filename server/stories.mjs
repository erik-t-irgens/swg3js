// Every character's story book, held by the server: the one copy that stands while a browser plays here,
// and from the second story the jobs in it, run here and paid from here.
//
// **One rule book, two hosts.** What a book is and how it changes is `src/story/book.ts`, and how a job
// moves is `src/story/quests.ts` through the host loop both hosts share (`src/story/hostCore.ts`); this
// file imports them as they are, under node's own type stripping, exactly as the converter imports the
// game's terrain, and the browser runs the very same files when it holds the book itself. So a change is
// applied by one function wherever it is applied, a job moves by one machine, and a book the server writes
// down is one the browser reads back without a second opinion about what it means. What is here is only
// what the server does with that: whose book it is, when to ask a browser for its copy and when to hand it
// the server's, what it believes of what a browser says happened, paying, and writing every change down
// before anybody is told.
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
// **Paying for what was done alone.** A browser that played a character with nobody holding its story paid
// that character's rewards out of its own purse and backpack -- and neither crosses to a server, which opens
// a purse at its own starting amount and holds the backpack it was first handed. So when such a book is
// taken, every credit and every thing it says the browser paid that the server's own copy never paid is paid
// here now, once (`by: 'settle'`), up to `settleCreditsMax` credits a settle; what is over the cap stays the
// browser's in the book and is owed at the next. The amount is always read back off the server's own set
// (`rewardOfKey`), never off the browser, and a reward for a completion the book does not reach is not paid.
//
// **The jobs.** Once a line's book is settled the server runs that character's jobs (`HostCore` over the
// store's own book, which the store applies each batch to as it writes it): the book is read in as for a
// character not yet in the world -- revisions carried, every deadline that fell while nobody was looking
// settled in the order it fell -- and the character brought in. What the browser's detectors see comes up
// as events (`ev`), each with where the player stood; the server checks what it can before it believes one
// (below) and is the only payer: credits through the purse, things through the ledger's own `add`, never
// through the browser's word that it has something. Every batch is written down and then sent (`ch`, at the
// revision it made), and the view the interface reads is sent whenever it changed (`view`); the message
// line's facts go as notes, whose words the browser makes. A view says too whether a set is read here at
// all (`read`), so a browser on a server that reads none says its jobs wait rather than showing them as
// nothing, and a line settled then is brought into the world by the first set the admin's reload reads.
// The game hour a condition reads is the server's own, worked out from the shared clock and the planet's
// place in the day exactly as every browser's sky is (`hourOf`). A counter moving (a kill counted, a watch begun)
// is written lazily, so a fight is not an fsync a kill: the next change that is not lazy flushes it, and so
// do the sweep's `coalesce` and a line closing.
//
// **What the server checks.** An arrival: a step waits for it, on the world the player stands on, and --
// where the server knows the world's layout centre and so where the player really is -- within the step's
// radius and `arriveSlack` of its place, in the room the browser last said it was in. A use: the object is
// one a step waits on or one that gives a job the character may take, on that world, within its reach and
// `talkSlack` of it (and the `useFind` the browser looks for the thing in round its point). A room: a step
// waits on it -- a goto whose place names it, checked as that arrival is, or a signal step waiting on the
// room alone, which names no place and so is the browser's word. A kill of one of
// the world's shared creatures: the server's own word of that death names this line among those who struck
// it, or as its keeper; a report that comes before the death is parked for `killPark`; a body nobody else
// knows is taken on the browser's word, up to `killsPerMinute`. Its catalogue id is the browser's, since the
// server holds no creature's species. An area entered: inside it, with the slack. A world: the one stood on.
// A console signal: only the admin's. Timers: the server's own clock. Everything else a job does, the step
// machine itself refuses when it may not.
//
// **Conversations (story 3).** A line asks to open a conversation with somebody, gives answers and closes it
// (`talk`), no more than `talkRate` openings and answers a second (a close is never counted, and one over the
// allowance is answered with no node and why); the server keeps where it stands for that line (`line.talk`)
// and never in the book, so a reload or a dropped line starts it again at its entry, and a set read again
// under somebody mid-conversation starts it again there too. A cast member with a place in the story is
// spoken to only from within `talkReach` and `talkSlack` of it, on its world, while its `stand` holds; one
// of the game's own people is taken on the browser's word, with the creature the browser says they are stood
// as (`who`), which is what gives them one of the game's own conversations: the Core3 reference's structure,
// folded with the adoptions of ours (`core3Story.mjs`) and joined to whatever sets are read, never counting as
// one, and spoken even with no set read at all (`talkCoreOf`). Each turn runs through the same host loop as everything else -- written down, paid (a `charge`
// through the purse's own spend), its notes and view sent -- and the node it reached goes back to that line
// alone (`node`).
//
// **In pieces.** A browser's input is dropped past 64 KB a second, so a book goes up in pieces
// (`src/story/storyWire.ts`) and is put back together here, no larger than `offerMax` and with no longer
// than `offerWait` between one piece and the next. It comes down in pieces of the same size.
//
// What is the game's and what is ours: none of it is the game's. Every number below is ours, lives in
// `STORY_TUNING`, is printed on the status page and moves for a run with `--set story.<name>=n`.
//
// How it is used: nothing in here touches a socket. The relay hands in the line (its id, its character,
// how that character was settled, its hello and its last state) and every decision answers `{ ok, why,
// tell }`, where `tell` is a list of `{ to: <connection>, msg }` for the relay to send, as the purse, the
// homes and the ledger do. Writing is one callback handed in, which must apply the record as well as keep it
// (the store's `change` does both), because the books this reads are the store's own. What the server knows
// of the worlds, the sets' files, the purse and the ledger, who is the admin, who is grouped and which
// creatures the world shares are all handed in too, so the tests run every rule here without a relay.

import { BACKSTOP_LIMITS, BOOK_LIMITS, applyChanges, bookIsEmpty, bookSummary, cleanBook, emptyBook, isCharacterId, markPaidBy, ownOf, whyNot } from '../src/story/book.ts';
import { HostCore } from '../src/story/hostCore.ts';
import { noteForWire } from '../src/story/notes.ts';
import { awaits, evalCond, placeOf, rewardOfKey, whyNotGrant } from '../src/story/quests.ts';
import { emptySet, joinSets, loadSet } from '../src/story/set.ts';
import { Reassembly, STORY_WIRE, bookText, chunkText, cleanStoryWord, nodeWord } from '../src/story/storyWire.ts';
import { viewHash } from '../src/story/view.ts';
import { gameToRawX, gameToRawZ, isQuestWaypoint } from '../src/story/waypoints.ts';

/**
 * The story this server holds, as its hail says it: 1 was the book and its waypoints; 2 the jobs, run and
 * paid here; 3 is the conversations, played here. A browser never says a story word to a server whose hail
 * does not carry one, the jobs' words only to one that says 2, and a conversation only to one that says 3,
 * so a newer browser never asks an older server for a word it does not know.
 */
export const STORY_WIRE_VERSION = 3;

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
  /** Events, job words and console words one browser may send in a second. */
  evRate: 10,
  /** Metres past a step's own radius within which an arrival is believed: a position comes up ten times a second and the player keeps walking. */
  arriveSlack: 25,
  /** Metres past an object's reach, or a cast member's `talkReach`, within which using it or speaking to them is believed, for the same reason. */
  talkSlack: 6,
  /** Metres from a cast member's place within which a browser speaks to them (the browser's own reach, `TALK_TUNE.reach`). */
  talkReach: 3,
  /** Conversation words (an opening or an answer; a close is never counted) one browser may send in a second. */
  talkRate: 4,
  /** Metres round an object's point the browser looks for the thing of its template in (`STAND_TUNE.find`), which a use is measured past. */
  useFind: 30,
  /**
   * Milliseconds a browser's word of the game hour stands, on a world whose hour the server cannot work out
   * for itself (one the game's list of planets does not know): one hour of the game's own day. Past it the
   * hour is not known at all, rather than known wrong.
   */
  hourKeep: 30000,
  /** Milliseconds the server's word of a shared creature's death is kept for the strikers' reports of it. */
  deathGrace: 10000,
  /** Milliseconds a report of a kill that came before the server's word of the death waits for it. */
  killPark: 2000,
  /** Kills of bodies nobody else knows that one character may report in a minute. */
  killsPerMinute: 60,
  /** Milliseconds between two sweeps of the connected characters' deadlines. */
  sweep: 1000,
  /** Milliseconds a counter's change may wait unflushed in the log. */
  coalesce: 5000,
  /** The most credits a settle pays for rewards earned with nobody holding the book; the rest are owed at the next. */
  settleCreditsMax: 50000,
  /** Jobs a character keeps a record of. */
  questMax: 4000,
  /** Flags a character keeps. */
  flagMax: 2000,
  /** Steps one job's record may hold. */
  stepsMax: 64,
};

/** What an opening or an answer over the allowance is told, as its node's reason. */
export const TALK_TOO_OFTEN = 'too much said at once: wait a moment';

/** A number off the tuning, held between nought and a cap; the fallback when it is not a number at all. */
function capped(v, fallback, cap) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(cap, n)) : fallback;
}

/**
 * The caps a book is held to here: the book's own, with the server's numbers in place of its own. Those may
 * be moved for a run, but never past what a browser will hold a server's book to (`BACKSTOP_LIMITS`), or a
 * browser would read back a copy cut shorter than the one written down here.
 */
function limitsOf(tuning = STORY_TUNING) {
  return {
    ...BOOK_LIMITS,
    waypoints: capped(tuning.waypoints, BOOK_LIMITS.waypoints, BACKSTOP_LIMITS.waypoints),
    quests: capped(tuning.questMax, BOOK_LIMITS.quests, BACKSTOP_LIMITS.quests),
    flags: capped(tuning.flagMax, BOOK_LIMITS.flags, BACKSTOP_LIMITS.flags),
    steps: capped(tuning.stepsMax, BOOK_LIMITS.steps, BACKSTOP_LIMITS.steps),
  };
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
 * Whether a batch is only counters moving: every change in it a step still running (a kill counted, a
 * signal counted, an observe step's watch opened or closed). Such a batch is written lazily (`Store.change`);
 * anything that finishes a step, ends a job or pays is flushed at once, with whatever lazy lines came before.
 */
export function lazyBatch(ch) {
  return Array.isArray(ch) && ch.length > 0 && ch.every((c) => c?.k === 'step' && c.rec?.state === 'active');
}

/**
 * Whether a point is in a shape (a circle, a rectangle or a polygon, one frame throughout), or within `slack`
 * metres of its edge. The browser's detectors ask the shape alone; the server's position runs a little
 * behind theirs, which the slack is for.
 */
export function nearShape(shape, x, z, slack = 0) {
  if (!shape) return false;
  if (shape.kind === 'circle') return Math.hypot(x - shape.c[0], z - shape.c[1]) <= shape.r + slack;
  if (shape.kind === 'rect') return x >= shape.min[0] - slack && x <= shape.max[0] + slack && z >= shape.min[1] - slack && z <= shape.max[1] + slack;
  if (shape.kind !== 'poly' || !Array.isArray(shape.pts)) return false;
  const p = shape.pts;
  let inside = false;
  let nearest = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i];
    const [xj, zj] = p[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    // How far the point is from this edge, for the slack.
    const dx = xj - xi;
    const dz = zj - zi;
    const len = dx * dx + dz * dz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / len)) : 0;
    nearest = Math.min(nearest, Math.hypot(x - (xi + t * dx), z - (zi + t * dz)));
  }
  return inside || nearest <= slack;
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

/** A line's room, as a step names one: the cell, and the template where the step names one too. */
function sameRoom(want, room) {
  if (!want) return true;
  return !!room && room.cell === want.cell && (!want.template || room.template === want.template);
}

/** What the relay's knowledge of the worlds answers when it hands in none: every world unknown, so every place is taken on the browser's word, and every hour too. */
const NO_WORLDS = { worldOf: (planet) => (typeof planet === 'string' && planet ? planet : null), kindOf: () => '', centreOf: () => null, hourOf: () => null, describe: () => ({ assets: 'none' }) };

export class Stories {
  /**
   * @param {{
   *   tuning?: Record<string, number>,
   *   write?: (rec: object, lazy?: boolean) => void,
   *   flush?: () => boolean | void,
   *   now?: () => number,
   *   purses?: { give(character: string, n: number, session: number): { ok: boolean, tell: object[] }, of(character: string): number } | null,
   *   ledger?: { add(character: string, kind: string, what: string): { ok: boolean, already?: boolean, row?: object, why?: string }, holds(character: string): boolean, rowFor(character: string, kind: string, what: string): object | null } | null,
   *   worlds?: { worldOf(planet: string, zone: string): string | null, kindOf(world: string): string, centreOf(world: string): { x: number, z: number } | null, hourOf?(world: string): number | null, describe(): object },
   *   read?: () => { test: { path: string, text: string }[] | null, own: { path: string, text: string }[] | null, refused?: string[] },
   *   admin?: (c: object) => boolean,
   *   grouped?: (c: object) => boolean,
   *   shared?: (npc: string) => boolean,
   *   tests?: boolean,
   *   core3?: (() => { set: object, report: object, errors: object[] } | null) | null,
   * }} options the numbers to work to; where a record goes to be applied and kept (and whether it is a
   * counter's, to be flushed lazily) and how the log is flushed; the shared clock a story's times are
   * written in; who pays; what the server knows of the worlds; how the sets' files are read; who is the
   * admin, who is grouped and which creatures the world shares; and how the game's own conversations are
   * read (`core3Story.mjs`), which are joined to whatever sets are read and never make one of their own.
   */
  constructor({ tuning = STORY_TUNING, write = () => {}, flush = () => {}, now = () => Date.now(), purses = null, ledger = null, worlds = NO_WORLDS, read = null, admin = () => false, grouped = () => false, shared = () => false, tests = false, core3 = null } = {}) {
    this.tuning = tuning;
    this.write = write;
    this.flushLog = flush;
    this.now = now;
    this.purses = purses;
    this.ledger = ledger;
    this.worlds = worlds;
    this.read = read;
    this.isAdmin = admin;
    this.grouped = grouped;
    this.shared = shared;
    this.tests = !!tests;
    this.core3Read = core3;
    /** How the game's own conversations were last read: the trees folded and played, and the adoptions' problems. */
    this.core3 = null;
    this.data = { stories: Object.create(null), storyArchive: Object.create(null) };
    /** The sets in use, joined, and how each read came out. */
    this.lib = emptySet();
    this.sets = [];
    /** Added to the shared clock: the admin's console moving the story's time on. */
    this.offset = 0;
    /** @type {Map<number, string>} a line asked for its book, and whose book it is */
    this.wanting = new Map();
    /** @type {Map<number, Reassembly>} a book coming up, by line */
    this.offers = new Map();
    /** @type {Map<number, { wp: { at: number, lines: number }, sync: { at: number, lines: number }, ev: { at: number, lines: number }, talk: { at: number, lines: number } }>} each line's allowances */
    this.windows = new Map();
    /** @type {Map<number, object>} each line whose book is settled here, and its jobs */
    this.lines = new Map();
    /** @type {Map<string, { by: Set<number>, keeper: number, world: string, at: number, credited: Set<string> }>} the world's shared creatures' deaths, kept for their strikers' reports */
    this.deaths = new Map();
    /** @type {{ session: number, character: string, ev: object, at: number }[]} reports of a kill that came before the death */
    this.parked = [];
    /** @type {{ character: string, kind: string, id: string, at: number }[]} things owed while the ledger does not yet hold a character's backpack */
    this.owed = [];
    this.lastSweep = 0;
    this.lastFlush = 0;
    this.bookId = 1;
    this.taken = 0;
    this.guarded = 0;
    this.changes = 0;
    this.refusals = 0;
    this.stats = { events: 0, refused: 0, batches: 0, lazy: 0, flushed: 0, paidCredits: 0, paidItems: 0, charged: 0, settled: 0, settleCredits: 0, settleItems: 0, owedLater: 0, parked: 0, sweeps: 0, sweepMs: 0, views: 0, talks: 0, lastWhy: '' };
    /** Why events were refused, by kind, for the status page. */
    this.refusedBy = Object.create(null);
  }

  /** Take the world the store read back, its books rebuilt as the rules expect them. They are its own, read and written in place. */
  load(data) {
    readStories(data);
    this.data = data;
    return this;
  }

  // ---- the sets -------------------------------------------------------------------------------------------

  /**
   * Read the sets as the relay's reader hands them over: the owner's folder (`own`, read as the owner's) and,
   * with `--story-tests`, the committed test set (read as the test set, where relative places and console
   * signals are allowed). Answers how each read came out. A set with problems is used as far as it read; a
   * server with no set at all works nothing out, as the browser's host does not before it has read one.
   */
  readSets() {
    const files = this.read ? this.read() : { test: null, own: null };
    const loaded = [];
    const reports = [];
    const take = (list, test) => {
      if (!list || !list.length) return;
      const r = loadSet(list, { test });
      reports.push({ name: r.set.prefix || (test ? 'test' : 'own'), hash: r.hash, quests: Object.keys(r.set.quests).length, errors: r.errors.length, warnings: r.warnings.length, first: r.errors.slice(0, 5).map((i) => `${i.file}:${i.line}: ${i.message}`) });
      if (r.set.prefix) loaded.push(r.set);
    };
    take(files.own, false);
    if (this.tests) take(files.test, true);
    for (const why of files.refused ?? []) reports.push({ name: 'refused', hash: '', quests: 0, errors: 1, warnings: 0, first: [why] });
    this.sets = reports;
    // The game's own conversations join whatever sets were read. They list no set, so a server that reads
    // none is still one that reads no story and works no job out for anybody; its heralds still speak, through
    // a loop that only ever talks (`talkCoreOf`).
    let core3 = null;
    try {
      core3 = this.core3Read ? this.core3Read() : null;
    } catch (err) {
      core3 = { set: null, report: null, errors: [{ file: 'core3', line: 1, message: err instanceof Error ? err.message : String(err) }] };
    }
    this.core3 = core3 ? { report: core3.report ?? null, errors: (core3.errors ?? []).map((i) => `${i.file}:${i.line}: ${i.message}`) } : null;
    if (core3?.set) loaded.push(core3.set);
    this.lib = loaded.length ? joinSets(loaded) : emptySet();
    return reports;
  }

  /** Whether a set has been read at all: until one has, no job is worked out. */
  get ready() {
    return this.lib.sets.length > 0;
  }

  /** What the hail says of the story this server holds. */
  hail() {
    return { v: STORY_WIRE_VERSION, sets: this.lib.sets.map((s) => ({ name: s.name, hash: s.hash })), tests: this.tests ? 1 : 0 };
  }

  /**
   * The sets read again (the admin's `reload`), and every book in play held to them at once by the revision
   * rules: a job whose steps all still exist carries on, one that cannot restarts where it may, and the rest
   * are held as revised. A book not in play is held to them the next time it is settled. A line settled while
   * no set was read at all was never brought into the world (there was nothing to work out), so the first set
   * read brings it in now exactly as a claim would (`settled`): its book read in as for a character away, then
   * the character entered, so a played clock counts and its line closing is a leave. Every line is told
   * whether a set is read now, which is what its tracker says when it is not.
   */
  reload() {
    const reports = this.readSets();
    const tell = [];
    for (const line of this.orderedLines()) {
      if (!line.ready) continue;
      if (this.ready && line.unread) {
        this.settled(line.c, tell);
        continue;
      }
      const core = this.ready ? this.coreOf(line) : null;
      if (core) this.finish(line, core.setLibrary(this.lib, this.ctxOf(line)), tell);
      else this.sendView(line, tell);
    }
    return { ok: true, reports, tell };
  }

  // ---- the books ------------------------------------------------------------------------------------------

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
      w = { wp: { at: 0, lines: 0 }, sync: { at: 0, lines: 0 }, ev: { at: 0, lines: 0 }, talk: { at: 0, lines: 0 } };
      this.windows.set(session, w);
    }
    return w;
  }

  no(session, why, of = '') {
    this.refusals++;
    return { ok: false, why, tell: [{ to: session, msg: of ? { t: 'story', do: 'no', why, of } : { t: 'story', do: 'no', why } }] };
  }

  /** The server's book handed down, in pieces, with whose copy it is. A character with none is handed an empty one, not written down. */
  answer(session, character, take) {
    const book = this.bookOf(character) ?? emptyBook(character);
    const parts = chunkText(bookText(book), chunkOf(this.tuning));
    const id = this.bookId++;
    return { ok: true, take, tell: parts.map((part, n) => ({ to: session, msg: { t: 'story', do: 'book', id, n, of: parts.length, part, take } })) };
  }

  /** The book handed down, and the jobs in it begun on this line straight after it (`settled`). */
  answerAndRun(c, take) {
    const out = this.answer(c.id, c.character, take);
    this.settled(c, out.tell);
    return out;
  }

  /** Ask a line for its book. Only a book asked for is ever taken. */
  want(session, character) {
    this.wanting.set(session, character);
    this.offers.delete(session);
    return { ok: true, tell: [{ to: session, msg: { t: 'story', do: 'want', chunk: chunkOf(this.tuning) } }] };
  }

  /**
   * One word from a line, already past the relay's character guard: cleaned here, and handed to what
   * answers it. `c` is the line: `{ id, character, keep, asking, hello, state, member }`, `asking` set while
   * a tie between two copies of the character is still waiting on the player.
   */
  hear(c, msg) {
    const word = cleanStoryWord(msg, 'up');
    if (!word || !c?.character) return { ok: false, why: 'not a story word', tell: [] };
    if (word.do === 'sync') return this.sync(c, word);
    if (word.do === 'offer') return this.offer(c, word);
    if (word.do === 'wp') return this.waypoint(c, word);
    if (word.do === 'talk') return this.talk(c, word);
    // The jobs' words: each counts against one allowance, and none is heard from a line whose book is not
    // settled here (it is being settled, or the line has only just been taken over by another browser).
    if (!mayStory(this.windowsOf(c.id).ev, Date.now(), this.tuning.evRate)) return { ok: false, why: 'too often', tell: [] };
    const line = this.lines.get(c.id);
    if (!line || line.character !== c.character || !line.ready) {
      this.stats.refused++;
      return word.do === 'ev' ? { ok: false, why: 'this character’s story is being settled with the server', tell: [] } : this.no(c.id, 'this character’s story is being settled with the server', 'job');
    }
    line.c = c;
    // Every job word says where the player stood: what a place a job begins is measured from, and what an
    // event is checked against where the server cannot say for itself.
    this.takeAt(line, word.at);
    if (word.do === 'ev') return this.event(line, word.ev);
    if (word.do === 'q') return this.questOp(line, word);
    return this.adminOp(line, word);
  }

  /**
   * Where a browser says its player stood, kept for the line: the place, the room and the hour, the hour
   * with when it was said, since it is only the fallback for a world whose hour the server cannot work out
   * itself and goes stale (`hourOf`).
   */
  takeAt(line, at) {
    if (!at) return;
    if (at.p) line.here = at.p;
    if (at.room !== undefined) line.room = at.room ?? null;
    if (typeof at.hour === 'number') {
      line.hour = at.hour;
      line.hourAt = this.now();
    }
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
    // Whatever this line was running is put down while the book is settled again: the copy that comes out
    // of it may be another object altogether.
    const was = this.lines.get(c.id);
    if (was) was.ready = false;
    const mine = this.bookOf(character);
    if (!mine) {
      // The first copy handed up is the one written down, as the ledger takes a backpack.
      if (word.has) return this.want(c.id, character);
      this.ensure(character);
      return this.answerAndRun(c, 'server');
    }
    // The character itself settled the browser's way, and the browser changed its book with nobody
    // holding it: that copy is the newer, and it is asked for. Anything else, the server's stands.
    if (c.keep === 'browser' && word.has && word.local > 0) return this.want(c.id, character);
    return this.answerAndRun(c, 'server');
  }

  /**
   * A piece of a browser's book, asked for. Once the last piece is in, it is cleaned and taken: the
   * server's own goes to the archive, the browser's is written down at a revision past both, the rewards it
   * paid alone are paid here (`settlePay`), and the browser is handed back what was written so the two
   * copies are one.
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
      if (/larger/.test(got.why)) return this.refuse(c, got.why);
      this.wanting.delete(c.id);
      return this.no(c.id, got.why);
    }
    this.wanting.delete(c.id);
    let raw;
    try {
      raw = JSON.parse(got.text);
    } catch {
      return this.refuse(c, 'that book could not be read');
    }
    const offered = cleanBook(raw, limitsOf(this.tuning));
    if (!offered || offered.char !== character) return this.refuse(c, 'that book could not be read');
    const mine = this.bookOf(character);
    // An empty book from a browser that believes a server holds this character already, and that counts
    // no change of its own to it: a cache that was cleared, not a story. The server's own stands, or with
    // none an empty one, never written down. One emptied by hand counts the changes that emptied it, and is
    // a story with nothing left in it, taken like any other.
    if (bookIsEmpty(offered) && offered.local === 0 && word.known) {
      this.guarded++;
      return this.answerAndRun(c, 'server');
    }
    if (mine) this.write({ t: 'storyArchive', id: character, book: mine });
    offered.rev = Math.max(mine?.rev ?? 0, offered.rev) + 1;
    offered.base = 0;
    offered.local = 0;
    markPaidBy(offered, 'browser');
    // What the browser paid alone is paid here, once: marked in the book before the book is written down
    // and before anything is handed over, so a reward is never paid twice whatever happens between.
    const owed = this.settleOwed(offered, mine);
    this.write({ t: 'storyBook', id: character, book: offered });
    this.taken++;
    const out = this.answer(c.id, character, 'browser');
    this.payOwed(c, owed, out.tell);
    this.settled(c, out.tell);
    return out;
  }

  /** Nothing of the browser's is taken: the server's own book stands, handed down so the two agree. */
  refuse(c, why) {
    this.wanting.delete(c.id);
    const no = this.no(c.id, why);
    return { ok: false, why, tell: [...no.tell, ...this.answerAndRun(c, 'server').tell] };
  }

  /**
   * The rewards a taken book says the browser paid that the server never did, marked in the book as the
   * settle's (`by: 'settle'`) up to the cap and answered as what to hand over. A row the server's own copy
   * says it paid keeps that word, whatever the browser's copy says of it. The amount is the server's set's,
   * never the browser's; a key the set cannot read back, or for a completion the book's own record of the job
   * does not reach, is left as it was and pays nothing. With no set read nothing is worked out, and all of it
   * stays owed. Credits are paid oldest first until `settleCreditsMax`; past it a reward stays the browser's,
   * owed at the next settle, which reads it the same way.
   */
  settleOwed(offered, mine) {
    const owed = { credits: 0, items: [], keys: 0 };
    const paid = offered.paid;
    if (!paid || !this.ready) return owed;
    const keys = Object.keys(paid).sort((a, b) => (paid[a].at ?? 0) - (paid[b].at ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
    let room = Math.max(0, Math.floor(Number(this.tuning.settleCreditsMax)) || 0);
    for (const key of keys) {
      const row = paid[key];
      const theirs = ownOf(mine?.paid, key);
      if (theirs && (theirs.by === 'server' || theirs.by === 'settle')) {
        row.by = theirs.by;
        continue;
      }
      if (row.by !== 'browser') continue;
      const r = rewardOfKey(key, this.lib);
      if (!r) continue;
      // A conversation's reward is once to a character, with no job's completion for it to reach.
      const rec = r.talk ? null : ownOf(offered.quests, r.quest);
      if (!r.talk && (!rec || r.n > rec.completions + 1)) continue;
      if (r.credits > room) {
        this.stats.owedLater++;
        continue;
      }
      room -= r.credits;
      owed.credits += r.credits;
      for (const it of r.items) owed.items.push(it);
      owed.keys++;
      row.by = 'settle';
    }
    return owed;
  }

  /** What a settle owes, handed over: the credits as one payment, each thing through the ledger, and the player told. */
  payOwed(c, owed, tell) {
    if (!owed.keys) return;
    this.stats.settled++;
    if (owed.credits > 0 && this.purses) {
      const r = this.purses.give(c.character, owed.credits, c.id);
      tell.push(...r.tell);
      this.stats.settleCredits += owed.credits;
      tell.push({ to: c.id, msg: { t: 'story', do: 'note', note: { k: 'say', text: `Paid ${owed.credits.toLocaleString('en-GB')} credits for jobs done away from this server` }, given: 1 } });
    }
    for (const it of owed.items) {
      if (this.giveItem(c.character, c.id, it.kind, it.id, tell)) this.stats.settleItems++;
    }
  }

  // ---- the jobs ---------------------------------------------------------------------------------------------

  /** Every line in play, in the order of their characters: what the sweep walks, so two runs sweep alike. */
  orderedLines() {
    return [...this.lines.values()].sort((a, b) => (a.character < b.character ? -1 : a.character > b.character ? 1 : 0));
  }

  /**
   * A line's book is settled: its jobs are begun here. The book is read in as for a character not yet in the
   * world -- revisions carried, every deadline that fell while nobody was looking settled in the order it fell,
   * each at its own time -- and then the character is brought in, so a played clock counts from now. Any other
   * line that was running the same character (a browser it was opened in before) is put down without a word:
   * the character is this line's now.
   */
  settled(c, tell) {
    for (const [session, other] of this.lines) if (session !== c.id && other.character === c.character) this.lines.delete(session);
    let line = this.lines.get(c.id);
    if (!line || line.character !== c.character) {
      line = { session: c.id, character: c.character, c, core: null, talkCore: null, ready: false, entered: false, unread: false, hash: '', here: null, room: null, hour: null, hourAt: 0, areas: new Set(), kills: new Map(), killTimes: [], talk: null };
      this.lines.set(c.id, line);
    }
    line.c = c;
    line.core = null;
    line.talkCore = null;
    // A conversation is the book's it began on: a book settled again starts none.
    line.talk = null;
    line.entered = false;
    line.hash = '';
    line.ready = true;
    // With no set read nothing can be worked out: the line is told so, and is brought into the world by the
    // first set the admin's reload reads (`reload`).
    line.unread = !this.ready;
    if (line.unread) {
      this.sendView(line, tell);
      return;
    }
    const core = this.coreOf(line);
    if (!core) return;
    this.finish(line, core.load({ ...this.ctxOf(line), away: true }), tell);
    line.entered = true;
    this.finish(line, core.event({ k: 'enter' }, this.ctxOf(line)), tell);
  }

  /** The host loop over a line's book, made again whenever the store's book is another object (a book taken whole). */
  coreOf(line) {
    const book = this.bookOf(line.character);
    if (!book || !this.ready) return null;
    if (line.core && line.core.book === book) return line.core;
    line.core = new HostCore({ book, lib: this.lib, payer: 'server', limits: limitsOf(this.tuning), apply: (ch) => this.writeBatch(line.character, ch) });
    return line.core;
  }

  /**
   * The host loop a line speaks to one of the game's own people through while no story set is read: the
   * library is the game's own conversations alone (`core3`, which list no set, so `ready` stays false and no
   * job is worked out for anybody), and nothing but a conversation is ever opened or answered on it -- never a
   * load, a sweep or a new library, which would hold every job in the book to a library that has none of them
   * and read each as revised away. What a turn changes (heard, met, a herald's waypoint) is written down and
   * sent as any batch is. Null when there are no such conversations to speak, or no book.
   */
  talkCoreOf(line) {
    const book = this.bookOf(line.character);
    if (!book || !this.lib.voices || !Object.keys(this.lib.voices).length) return null;
    if (line.talkCore && line.talkCore.book === book && line.talkCore.lib === this.lib) return line.talkCore;
    line.talkCore = new HostCore({ book, lib: this.lib, payer: 'server', limits: limitsOf(this.tuning), apply: (ch) => this.writeBatch(line.character, ch) });
    return line.talkCore;
  }

  /** A batch the rules worked out, written down (and so applied, by the store): lazily when it is only counters. */
  writeBatch(character, ch) {
    const lazy = lazyBatch(ch);
    this.write({ t: 'story', id: character, ch }, lazy);
    this.stats.batches++;
    if (lazy) this.stats.lazy++;
  }

  /** The story's clock: the shared clock, with the admin's move of it. */
  storyNow() {
    return this.now() + this.offset;
  }

  /** The world a line stands on, as a story names it, or null. */
  worldOf(c) {
    return c?.hello ? this.worlds.worldOf(c.hello.planet, c.hello.zone) : null;
  }

  /**
   * Where the server itself holds this player as standing, in the frame a story writes places in, or null
   * when it cannot say: no state yet, standing in another player's hull (whose `in` place is in that hull's
   * own frame and whose hull is somebody else's word), a dungeon's copies, or a planet whose layout centre
   * the server was not told. A state's own `p` is always the figure's place in the world -- aboard one's own
   * hull's rooms too, where the browser carries the place through the hull's turn before it sends it
   * (`Player.worldPos`) -- so it is what is measured, never the hull's middle.
   */
  ownPlace(c, world) {
    const s = c?.state;
    if (!world || !Array.isArray(s?.p) || s.in) return null;
    const p = s.p;
    const kind = this.worlds.kindOf(world);
    if (kind === 'space') return [p[0], p[2]];
    if (kind === 'copies') return null;
    const centre = this.worlds.centreOf(world);
    if (!centre) return null;
    return [gameToRawX(centre.x, p[0]), gameToRawZ(centre.z, p[2])];
  }

  /**
   * The game hour where a line's player stands, 0 to 23, or null when it is not known. The server's own,
   * worked out from the one clock it hands every browser, the day's length and the planet's own place in the
   * shared day (`storyWorlds.hourOf`), which is the very hour every browser on that world draws its sky at:
   * known at a claim before any word has come, during an offline settle and on every sweep, and never stale.
   * Only for a world the game's list of planets does not know is the browser's word taken, and only while it
   * is fresh (`hourKeep`). The admin's move of the story's clock does not move it, as the browser's own host's
   * console move does not move the day.
   */
  hourOf(line, world) {
    const h = world && this.worlds.hourOf ? this.worlds.hourOf(world) : null;
    if (typeof h === 'number' && Number.isFinite(h)) return h;
    return typeof line.hour === 'number' && this.now() - (line.hourAt ?? 0) <= this.tuning.hourKeep ? line.hour : null;
  }

  /** What is true just now for a line's character, as the server knows it. */
  ctxOf(line) {
    const c = line.c;
    const world = this.worldOf(c);
    const own = this.ownPlace(c, world);
    const character = line.character;
    return {
      now: this.storyNow(),
      world,
      here: own ?? line.here,
      room: line.room,
      areas: [...line.areas],
      hour: this.hourOf(line, world),
      grouped: !!this.grouped(c),
      species: c?.hello?.species ?? null,
      credits: this.purses ? this.purses.of(character) : null,
      has: this.ledger ? (kind, id) => (this.ledger.rowFor(character, kind, id) ? 1 : 0) : null,
      away: !line.entered,
    };
  }

  /**
   * Something a line's detectors saw (where the player stood taken in already), checked as the server can
   * check it, and run. A refused event is counted and answered with nothing: the detectors raise what stays
   * true again every two seconds, and a word back for each would fill the message line.
   */
  event(line, ev) {
    const tell = [];
    const core = this.coreOf(line);
    if (!core) return { ok: false, why: 'no story is read here', tell };
    if (ev.k === 'kill') return this.kill(line, ev, tell);
    const why = this.check(line, ev);
    if (why) return this.refuseEvent(ev, why, tell);
    if (ev.k === 'room') line.room = { cell: ev.cell, template: ev.template };
    if (ev.k === 'area') {
      if (ev.inside) line.areas.add(ev.area);
      else line.areas.delete(ev.area);
    }
    if (ev.k === 'enter') {
      if (line.entered) return { ok: true, tell };
      line.entered = true;
    }
    if (ev.k === 'leave') {
      if (!line.entered) return { ok: true, tell };
      line.entered = false;
    }
    this.stats.events++;
    this.finish(line, core.event(ev, ev.k === 'leave' ? { ...this.ctxOf(line), away: true } : this.ctxOf(line)), tell);
    return { ok: true, tell };
  }

  refuseEvent(ev, why, tell) {
    this.stats.refused++;
    this.stats.lastWhy = why;
    this.refusedBy[ev.k] = (this.refusedBy[ev.k] ?? 0) + 1;
    return { ok: false, why, tell };
  }

  /** Why the server does not believe an event, or null when it does. */
  check(line, ev) {
    const world = this.worldOf(line.c);
    const book = line.core.book;
    const lib = this.lib;
    switch (ev.k) {
      case 'arrive': {
        if (!world || ev.world !== world) return 'that is not the world you stand on';
        const own = this.ownPlace(line.c, world);
        let waited = false;
        for (const q of Object.keys(book.quests ?? {})) {
          const rec = book.quests[q];
          if (rec.state !== 'active' || (ev.quest && ev.quest !== q)) continue;
          const def = lib.quests[q];
          if (!def) continue;
          for (const s of Object.keys(rec.steps)) {
            const cur = rec.steps[s];
            const step = def.steps[s];
            if (!step || cur.state !== 'active' || step.type !== 'goto' || (ev.step && ev.step !== s)) continue;
            waited = true;
            const place = placeOf(rec, step, cur);
            if (!place || place.world !== world) continue;
            if (own && Math.hypot(own[0] - place.p[0], own[1] - place.p[1]) > step.radius + this.tuning.arriveSlack) continue;
            if (!sameRoom(place.room, line.room)) continue;
            return null;
          }
        }
        return waited ? 'you are not where that step waits for you' : 'no step of yours waits on arriving there';
      }
      case 'room': {
        // A room is believed when a running step waits on it. A goto whose place names that room is checked
        // as an arrival there is: on this world, and where the server knows the world's centre within the
        // step's radius and the slack of the room's place. A signal step waiting on the room alone
        // (`room:<template>#<cell>`) names no place at all -- the building is whichever nearby one has that
        // cell, which only the browser can find, and the server holds no building's place -- so there the
        // room is taken on the browser's word, as every position on a world with no centre is.
        if (!world) return 'you stand on no world';
        const own = this.ownPlace(line.c, world);
        const room = { cell: ev.cell, template: ev.template };
        const signal = `room:${ev.template}#${ev.cell}`;
        let waited = false;
        for (const q of Object.keys(book.quests ?? {})) {
          const rec = book.quests[q];
          const def = rec.state === 'active' ? lib.quests[q] : null;
          if (!def) continue;
          for (const s of Object.keys(rec.steps)) {
            const cur = rec.steps[s];
            const step = def.steps[s];
            if (!step || cur.state !== 'active') continue;
            if (awaits(step) === signal) return null;
            if (step.type !== 'goto') continue;
            const place = placeOf(rec, step, cur);
            if (!place?.room || place.world !== world || !sameRoom(place.room, room)) continue;
            waited = true;
            if (own && Math.hypot(own[0] - place.p[0], own[1] - place.p[1]) > step.radius + this.tuning.arriveSlack) continue;
            return null;
          }
        }
        return waited ? 'you are not where that room is' : 'no step of yours waits on that room';
      }
      case 'area': {
        const a = lib.areas[ev.area];
        if (!a) return 'there is no such area';
        if (!ev.inside) return null;
        if (!world || a.world !== world) return 'that area is not on the world you stand on';
        const own = this.ownPlace(line.c, world);
        if (own && !nearShape(a.shape, own[0], own[1], this.tuning.arriveSlack)) return 'you are not in that area';
        if (a.room && !sameRoom(a.room, line.room)) return 'you are not in that area’s room';
        return null;
      }
      case 'use': {
        const o = lib.objects[ev.object];
        if (!o) return 'there is no such thing';
        if (!world || o.world !== world) return 'that is not on the world you stand on';
        if (!this.usable(book, ev.object, line)) return 'nothing of yours waits on that';
        const own = this.ownPlace(line.c, world);
        if (own && Math.hypot(own[0] - o.near[0], own[1] - o.near[1]) > o.reach + this.tuning.talkSlack + this.tuning.useFind) return 'you are too far from that to use it';
        return null;
      }
      case 'world':
        return world && ev.world === world ? null : 'that is not the world you stand on';
      case 'signal':
        return 'a signal is raised by the world’s admin, at the console';
      case 'death':
      case 'enter':
      case 'leave':
        return null;
      default:
        return 'that is not something a browser says happened';
    }
  }

  /** Whether an object is one a running step waits on, or one that gives a job this character may take now. */
  usable(book, object, line) {
    const lib = this.lib;
    for (const q of Object.keys(book.quests ?? {})) {
      const rec = book.quests[q];
      if (rec.state !== 'active') continue;
      const def = lib.quests[q];
      if (!def) continue;
      for (const s of Object.keys(rec.steps)) {
        const step = def.steps[s];
        if (step && rec.steps[s].state === 'active' && awaits(step) === `used:${object}`) return true;
      }
    }
    const ctx = { ...this.ctxOf(line), char: line.character, payer: 'server' };
    for (const id of Object.keys(lib.quests)) {
      for (const g of lib.quests[id].givers) if (g.kind === 'use' && g.object === object && !whyNotGrant(book, lib, id, ctx)) return true;
    }
    return false;
  }

  /**
   * A kill a line reports. One of the world's shared creatures is credited only on the server's own word of
   * its death naming this line among its strikers, or as its keeper, and once to a character; a report that
   * came before that word waits `killPark` for it. A body nobody else knows (one this browser keeps for
   * itself, or one the world has forgotten) is believed, once, up to `killsPerMinute`.
   */
  kill(line, ev, tell) {
    const npc = ev.npc ?? '';
    const now = Date.now();
    if (!npc || !this.shared(npc)) {
      for (const [k, at] of line.kills) if (now - at > this.tuning.deathGrace) line.kills.delete(k);
      if (npc && line.kills.has(npc)) return this.refuseEvent(ev, 'that kill is counted already', tell);
      while (line.killTimes.length && now - line.killTimes[0] > 60000) line.killTimes.shift();
      if (line.killTimes.length >= this.tuning.killsPerMinute) return this.refuseEvent(ev, 'more kills than anybody makes in a minute', tell);
      line.killTimes.push(now);
      if (npc) line.kills.set(npc, now);
      return this.runKill(line, ev, tell);
    }
    const death = this.deaths.get(npc);
    if (!death) {
      // Before the server's word of it: kept a moment, and run when the word comes or given up.
      if (!this.parked.some((p) => p.session === line.session && p.ev.npc === npc)) {
        this.parked.push({ session: line.session, character: line.character, ev, at: now });
        this.stats.parked++;
        while (this.parked.length > 500) this.parked.shift();
      }
      return { ok: true, parked: true, tell };
    }
    if (!death.by.has(line.session) && death.keeper !== line.session) return this.refuseEvent(ev, 'you did not strike that one', tell);
    if (death.credited.has(line.character)) return this.refuseEvent(ev, 'that kill is counted already', tell);
    death.credited.add(line.character);
    return this.runKill(line, ev, tell);
  }

  runKill(line, ev, tell) {
    this.stats.events++;
    this.finish(line, line.core.event(ev, this.ctxOf(line)), tell);
    return { ok: true, tell };
  }

  /**
   * The relay's own word of a shared creature's death, with who struck it in its last moments (relay line
   * ids) and the line that was keeping it: kept for `deathGrace`, and every report of it already waiting run.
   */
  death(npc, by, keeper, world) {
    const tell = [];
    if (typeof npc !== 'string' || !npc) return { ok: false, tell };
    this.deaths.set(npc, { by: new Set(Array.isArray(by) ? by : []), keeper: keeper || 0, world: world ?? '', at: Date.now(), credited: new Set() });
    const waiting = this.parked.filter((p) => p.ev.npc === npc);
    if (waiting.length) this.parked = this.parked.filter((p) => p.ev.npc !== npc);
    for (const p of waiting) {
      const line = this.lines.get(p.session);
      if (line && line.character === p.character && line.ready && this.coreOf(line)) this.kill(line, p.ev, tell);
    }
    return { ok: true, tell };
  }

  /**
   * A job as a player names one: with its set's prefix as it is, or by its name alone, found in this server's
   * own sets as the browser's host finds one in its own (`own:` first, then `test:`, then any set's).
   */
  resolveQuest(q) {
    if (typeof q !== 'string' || q.includes(':')) return q;
    for (const prefix of ['own', 'test']) if (this.lib.quests[`${prefix}:${q}`]) return `${prefix}:${q}`;
    for (const id of Object.keys(this.lib.quests)) if (id.endsWith(`:${q}`)) return id;
    return q;
  }

  /** A job taken, turned down, dropped, started over, followed or not: any player's, of their own book. */
  questOp(line, word) {
    const tell = [];
    const core = this.coreOf(line);
    if (!core) return this.no(line.session, 'no story is read here', 'job');
    const ctx = this.ctxOf(line);
    const quest = this.resolveQuest(word.quest);
    let r;
    if (word.op === 'accept') r = core.accept(quest, ctx);
    else if (word.op === 'decline') r = core.decline(quest, ctx);
    else if (word.op === 'drop') r = core.drop(quest, ctx);
    else if (word.op === 'restart') r = core.restart(quest, ctx);
    else r = core.track(quest, word.op === 'track', ctx);
    this.finish(line, r, tell, true);
    return { ok: !r.why, why: r.why ?? undefined, tell };
  }

  /**
   * A conversation's word from a line: open one with somebody, give an answer (or let a node go on), close it.
   * Not from a line whose book is not settled here; a cast member only from within reach of where the story
   * stands them, on their world, while their `stand` holds (checked again at every answer, since a player may
   * walk off); and no faster than `talkRate`. The node reached goes back to the line, or none with why.
   */
  talk(c, word) {
    const node = (why) => ({ ok: false, why, tell: [{ to: c.id, msg: nodeWord(word.speaker, null, why) }] });
    const line = this.lines.get(c.id);
    // Closing works nothing out and only lets go of what the line holds, so it is never counted against the
    // allowance: a close spent there would cost the very next opening.
    if (word.op === 'close') {
      if (line && line.character === c.character) line.talk = null;
      return { ok: true, tell: [] };
    }
    // Over the allowance an opening or an answer is answered with no node and why, as every other refusal
    // here is, so the window says so at once rather than waiting out its own clock in silence.
    if (!mayStory(this.windowsOf(c.id).talk, Date.now(), this.tuning.talkRate)) return { ...node(TALK_TOO_OFTEN), why: 'too often' };
    if (!line || line.character !== c.character || !line.ready) return node('this character’s story is being settled with the server');
    line.c = c;
    this.takeAt(line, word.at);
    // One of the game's own people speaks the game's own conversations, which need no story set: with none read
    // they are spoken through a loop that only ever talks (`talkCoreOf`).
    const core = this.coreOf(line) ?? (word.speaker.startsWith('row:') ? this.talkCoreOf(line) : null);
    if (!core) return node('no story is read here');
    if (word.op === 'pick' && (!line.talk || line.talk.speaker !== word.speaker)) return node('you are not talking to them');
    const why = this.whyNotTalk(line, word.speaker);
    if (why) {
      line.talk = null;
      return node(why);
    }
    const out = word.op === 'open' ? core.talkOpen(word.speaker, this.ctxOf(line), word.who ?? null) : core.talkPick(line.talk, word.reply, this.ctxOf(line));
    this.stats.talks++;
    line.talk = out.turn.state;
    const tell = [];
    this.finish(line, out.r, tell);
    tell.push({ to: line.session, msg: nodeWord(word.speaker, out.turn.view, out.turn.why) });
    return { ok: !out.turn.why, why: out.turn.why ?? undefined, tell };
  }

  /**
   * Why a line may not speak to somebody just now, or null. A game person (`row:`) is taken on the browser's
   * word, and so is the creature it says they are stood as, which is what gives them a conversation: the
   * server knows none of the game's people, and every one they could be speaks only what the game's own
   * conversations (`core3`) give that creature.
   */
  whyNotTalk(line, speaker) {
    if (speaker.startsWith('row:')) return null;
    const cast = Object.hasOwn(this.lib.cast, speaker) ? this.lib.cast[speaker] : null;
    if (!cast) return 'there is nobody of that name in this story';
    const world = this.worldOf(line.c);
    if (!world || cast.world !== world) return 'they are not on the world you stand on';
    const ctx = { ...this.ctxOf(line), char: line.character, payer: 'server' };
    if (cast.stand && !evalCond(cast.stand, line.core.book, ctx)) return 'they are not here just now';
    const own = this.ownPlace(line.c, world);
    if (own && Math.hypot(own[0] - cast.at[0], own[1] - cast.at[1]) > this.tuning.talkReach + this.tuning.talkSlack) return 'you are too far from them to talk';
    return null;
  }

  /**
   * The console's own operations, which only the world's admin may use, and only on their own character:
   * read the sets again, grant or offer a job, put a held one back, finish a step, raise a signal, and move
   * the story's clock on (for every character, since it is the server's one clock).
   */
  adminOp(line, word) {
    if (!this.isAdmin(line.c)) return this.no(line.session, 'only this world’s admin can do that', 'job');
    const tell = [];
    if (word.op === 'reload') {
      const r = this.reload();
      const said = r.reports.map((s) => `${s.name} (${s.quests} jobs${s.errors ? `, ${s.errors} problems` : ''})`).join(', ') || 'no set at all';
      return { ok: true, tell: [...r.tell, { to: line.session, msg: { t: 'story', do: 'note', note: { k: 'say', text: `The server read its story again: ${said}` }, given: 1 } }] };
    }
    if (word.op === 'clock') {
      this.offset = word.ms === null ? 0 : Math.max(0, this.offset + word.ms);
      this.sweepAll(tell, true);
      tell.push({ to: line.session, msg: { t: 'story', do: 'note', note: { k: 'say', text: this.offset ? `The story’s clock is ${Math.round(this.offset / 1000)} s ahead` : 'The story’s clock is the shared clock again' }, given: 1 } });
      return { ok: true, offset: this.offset, tell };
    }
    const core = this.coreOf(line);
    if (!core) return this.no(line.session, 'no story is read here', 'job');
    const ctx = this.ctxOf(line);
    const quest = this.resolveQuest(word.quest);
    let r;
    if (word.op === 'grant') r = core.grant(quest, ctx);
    else if (word.op === 'offer') r = core.offer(quest, ctx);
    else if (word.op === 'unstick') r = core.unstick(quest, ctx);
    else if (word.op === 'complete') r = quest.includes(':') ? core.run([`complete(${quest}, ${word.step})`], ctx, quest.slice(0, quest.indexOf(':'))) : { ch: [], pay: [], notes: [], docs: [], why: 'there is no such job', unbuilt: 0, misses: 0 };
    else r = core.event({ k: 'signal', name: word.name }, ctx);
    this.finish(line, r, tell, true);
    return { ok: !r.why, why: r.why ?? undefined, tell };
  }

  /**
   * What a worked-out answer comes to on a line: the batch (written down already) sent at the revision it
   * made, every payment made, every note sent with whether its thing arrived, a refusal said when the line
   * asked for something, and the view sent when it changed.
   */
  finish(line, r, tell, asked = false) {
    const book = this.bookOf(line.character);
    if (r.ch.length && book) tell.push({ to: line.session, msg: { t: 'story', do: 'ch', rev: book.rev, ch: r.ch } });
    const failed = new Set();
    for (const o of r.pay) {
      if (this.pay(line, o, tell)) continue;
      if (o.item) failed.add(`${o.item.kind}:${o.item.id}`);
      else if (o.credits) failed.add(`credits:${o.credits}`);
      else if (o.charge) failed.add(`charge:${o.charge}`);
    }
    for (const n of r.notes) {
      const not = (n.k === 'item' && failed.has(`${n.kind}:${n.id}`)) || (n.k === 'paid' && failed.has(`credits:${n.credits}`)) || (n.k === 'charged' && failed.has(`charge:${n.credits}`));
      tell.push({ to: line.session, msg: { t: 'story', do: 'note', note: noteForWire(n, this.lib), given: not ? 0 : 1 } });
    }
    if (r.why) this.stats.lastWhy = r.why;
    if (asked && r.why) tell.push({ to: line.session, msg: { t: 'story', do: 'no', why: r.why, of: 'job' } });
    this.sendView(line, tell);
  }

  /**
   * The view sent to a line when it is not the one the line has, with whether this server reads a story set
   * at all (`read`): with none, every job stands still, and the browser's tracker says why rather than
   * showing the running jobs as nothing.
   */
  sendView(line, tell) {
    if (!line.ready) return;
    const core = this.coreOf(line);
    const book = this.bookOf(line.character);
    const view = core ? core.view(this.ctxOf(line)) : { rev: book?.rev ?? 0, quests: [], waypoints: [], watch: [], cast: [], objects: [], tracked: [...(book?.tracked ?? [])], trackWp: book?.trackWp ?? null };
    const read = this.ready ? 1 : 0;
    const hash = `${viewHash(view)}:${this.offset}:${read}`;
    if (hash === line.hash) return;
    line.hash = hash;
    this.stats.views++;
    tell.push({ to: line.session, msg: { t: 'story', do: 'view', view, off: this.offset, read } });
  }

  /** One payment: credits through the purse, a thing through the ledger, a price through the purse's own spend. False when nothing was handed over. */
  pay(line, o, tell) {
    if (o.charge) {
      if (!this.purses) return false;
      const r = this.purses.spend(line.character, o.charge, line.session, 'that');
      tell.push(...r.tell);
      if (r.ok) this.stats.charged += o.charge;
      return r.ok;
    }
    if (o.credits) {
      if (!this.purses) return false;
      const r = this.purses.give(line.character, o.credits, line.session);
      tell.push(...r.tell);
      if (r.ok) this.stats.paidCredits += o.credits;
      return r.ok;
    }
    if (o.item) {
      const given = this.giveItem(line.character, line.session, o.item.kind, o.item.id, tell);
      if (given) this.stats.paidItems++;
      return given;
    }
    return true;
  }

  /**
   * A thing handed over through the ledger's own `add`, which the browser is told of as the ledger tells it
   * of anything (`items added`), and never through the browser's word that it has something. A character
   * holds one of each, so one owned already is said rather than given twice. While the ledger does not yet
   * hold the character's backpack -- it is about to be handed up, and the first one handed up replaces
   * whatever is there -- the thing is owed and handed over the moment it does (`held`, and the sweep).
   */
  giveItem(character, session, kind, id, tell) {
    if (!this.ledger) return false;
    if (!this.ledger.holds(character)) {
      if (this.owed.length < 1000) this.owed.push({ character, kind, id, at: Date.now() });
      return true;
    }
    const made = this.ledger.add(character, kind, id);
    if (!made.ok || made.already) return false;
    tell.push({ to: session, msg: { t: 'items', do: 'added', row: made.row } });
    return true;
  }

  /** The ledger holds a character's backpack now: whatever was owed it is handed over. */
  held(character) {
    const tell = [];
    if (!this.ledger || !this.owed.length) return { ok: true, tell };
    const keep = [];
    for (const o of this.owed) {
      if (o.character !== character || !this.ledger.holds(character)) {
        keep.push(o);
        continue;
      }
      const made = this.ledger.add(o.character, o.kind, o.id);
      const session = this.sessionOf(o.character);
      if (made.ok && !made.already && session) tell.push({ to: session, msg: { t: 'items', do: 'added', row: made.row } });
    }
    this.owed = keep;
    return { ok: true, tell };
  }

  /** The line a character is played on here, or 0. */
  sessionOf(character) {
    for (const line of this.lines.values()) if (line.character === character) return line.session;
    return 0;
  }

  /** Every line's deadlines settled now, in its character's order. */
  sweepAll(tell, force = false) {
    if (!this.ready) return;
    const t0 = Date.now();
    for (const line of this.orderedLines()) {
      if (!line.ready) continue;
      const core = this.coreOf(line);
      if (!core) continue;
      this.finish(line, core.sweep(this.ctxOf(line)), tell);
    }
    this.stats.sweeps++;
    this.stats.sweepMs = Date.now() - t0;
    if (force) this.lastSweep = t0;
  }

  // ---- the waypoints ---------------------------------------------------------------------------------------

  /**
   * A waypoint set, renamed, recoloured, switched, taken away or tracked. The id of a new one is the
   * server's, from the book's own counter, and so is its time; the change is written down, applied, and
   * the batch sent back at the revision it made. A job's own waypoint, switched, is remembered by its key.
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
    else if ((word.op === 'on' || word.op === 'off') && isQuestWaypoint(word.id)) change = { k: 'qwpOn', key: word.id, on: word.op === 'on' };
    else if (word.op === 'on' || word.op === 'off') change = { k: 'wpOn', id: word.id, on: word.op === 'on' };
    else if (word.op === 'gone') change = { k: 'wpGone', id: word.id };
    else change = { k: 'trackWp', id: word.id };
    const why = whyNot(book, change, limitsOf(this.tuning));
    if (why) return this.no(c.id, why);
    this.write({ t: 'story', id: character, ch: [change] });
    this.changes++;
    const after = this.bookOf(character);
    const tell = [{ to: c.id, msg: { t: 'story', do: 'ch', rev: after.rev, ch: [change] } }];
    // A job's waypoint switched, and what is tracked, are the view's too.
    const line = this.lines.get(c.id);
    if (line && line.character === character) this.sendView(line, tell);
    return { ok: true, id: change.wp?.id, tell };
  }

  // ---- time ------------------------------------------------------------------------------------------------

  /**
   * Once a second: a book half up for longer than the wait given up and its browser told; reports of a kill
   * that waited too long for the death given up, and deaths past their grace forgotten; things owed handed
   * over where the ledger now holds the backpack; every connected character's deadlines swept every `sweep`;
   * and the counters' lazy lines flushed every `coalesce`.
   */
  tick(now = Date.now()) {
    const tell = [];
    for (const [session, pieces] of this.offers) {
      if (!pieces.expire(now)) continue;
      this.offers.delete(session);
      this.wanting.delete(session);
      this.refusals++;
      tell.push({ to: session, msg: { t: 'story', do: 'no', why: 'the pieces stopped coming' } });
    }
    if (this.parked.length) {
      const late = this.parked.filter((p) => now - p.at > this.tuning.killPark);
      if (late.length) {
        this.parked = this.parked.filter((p) => now - p.at <= this.tuning.killPark);
        for (const p of late) this.refuseEvent(p.ev, 'the server never heard of that death', tell);
      }
    }
    for (const [npc, d] of this.deaths) if (now - d.at > this.tuning.deathGrace) this.deaths.delete(npc);
    if (this.owed.length && this.ledger) {
      const ready = new Set(this.owed.filter((o) => this.ledger.holds(o.character)).map((o) => o.character));
      for (const character of ready) tell.push(...this.held(character).tell);
    }
    if (now - this.lastSweep >= this.tuning.sweep) {
      this.lastSweep = now;
      this.sweepAll(tell);
    }
    if (now - this.lastFlush >= this.tuning.coalesce) {
      this.lastFlush = now;
      // The store answers true when it had lazy lines to flush: counted, so the status page shows the
      // counters really do go in lazily and really are flushed.
      if (this.flushLog() === true) this.stats.flushed++;
    }
    return { ok: true, tell };
  }

  /**
   * A line has closed: whatever it was handing up is forgotten, and its character leaves the world here -- a
   * clock that counts only time played stops -- with nobody left to tell. Its lazy lines are flushed with it.
   */
  gone(session) {
    this.wanting.delete(session);
    this.offers.delete(session);
    this.windows.delete(session);
    const line = this.lines.get(session);
    if (line) {
      this.lines.delete(session);
      const core = line.ready && line.entered ? this.coreOf(line) : null;
      if (core) {
        line.entered = false;
        this.finish(line, core.event({ k: 'leave' }, { ...this.ctxOf(line), away: true }), []);
      }
    }
    this.parked = this.parked.filter((p) => p.session !== session);
    if (this.flushLog() === true) this.stats.flushed++;
  }

  /** What the status page prints. */
  describe() {
    let waypoints = 0;
    let books = 0;
    let active = 0;
    for (const id of Object.keys(this.data.stories)) {
      books++;
      const s = bookSummary(this.data.stories[id]);
      waypoints += s?.waypoints ?? 0;
      active += s?.active ?? 0;
    }
    let archived = 0;
    for (const id of Object.keys(this.data.storyArchive)) archived += Array.isArray(this.data.storyArchive[id]) ? this.data.storyArchive[id].length : 0;
    return {
      v: STORY_WIRE_VERSION,
      sets: this.sets.map((s) => ({ ...s })),
      tests: this.tests,
      jobs: Object.keys(this.lib.quests).length,
      // The story's own conversations; the game's own are counted beside them.
      talks: Object.keys(this.lib.talks).filter((id) => !id.startsWith('core3:')).length,
      cast: Object.keys(this.lib.cast).length,
      // The game's own conversations: how many were folded, which may be played and by how many creatures.
      core3: this.core3?.report ? { trees: this.core3.report.trees, played: this.core3.report.played.length, voiced: this.core3.report.voiced, adopted: this.core3.report.adopted.length, errors: this.core3.errors } : null,
      talking: [...this.lines.values()].filter((l) => l.talk).length,
      books,
      active,
      waypoints,
      archived,
      playing: this.lines.size,
      asking: this.wanting.size,
      coming: this.offers.size,
      taken: this.taken,
      guarded: this.guarded,
      changes: this.changes,
      refusals: this.refusals,
      clock: this.offset,
      sweep: { every: this.tuning.sweep, sweeps: this.stats.sweeps, lastMs: this.stats.sweepMs },
      parked: this.parked.length,
      deaths: this.deaths.size,
      owed: this.owed.length,
      refusedBy: { ...this.refusedBy },
      stats: { ...this.stats },
      worlds: this.worlds.describe(),
      tuning: this.tuning,
    };
  }
}
