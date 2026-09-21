// What a character owns, and how two players hand something over.
//
// Until now a character and everything in its backpack lived in one browser's local storage: clear
// that storage and the character is gone, and two browsers swapping an item had to trust each other
// not to keep both halves of the swap. The owner's decision 7(a) is that the server holds every
// connected character's items and the browser's copy is a cache. This file is that ledger, and the
// trade that moves a row from one character to another.
//
// The one sentence everything here exists for: **an item may never be duplicated and may never be
// lost.** So:
//
//   - A row is one item: which character owns it, what kind it is (the pack it comes out of: a
//     wardrobe piece or a weapon off the rack), what it is (the catalogue's own id), and when it was
//     got. A character holds at most one row of a kind and an id, which is exactly what the backpack
//     itself holds (`normalizeOwned` in src/core/inventory.ts drops a second copy), so the cache and
//     the truth can never disagree about how many of a thing you have.
//   - A character hands its list up the first time it is claimed and the server writes it down. From
//     then on the server's list is the truth: a browser whose list disagrees is told the server's
//     rather than merged with, because a merge is the one thing that can put an item back in a
//     backpack after it has been given away, which is a duplicate. An evening played offline keeps
//     its character (wave 1's change counter decides that) and not the items it picked up in it; that
//     is the price of never duplicating, and it is said out loud here rather than discovered later.
//   - The hand-over is **one step**: every row in it changes owner in one record, written to the log
//     and flushed before either browser is told a word. Either both sides' rows move or neither does,
//     whatever happens to the two lines in the moment after. A trade that ends any other way ends
//     with the items exactly where they started.
//
// What is the game's and what is ours. The distance is the game's: `datatables/player/radial_menu.iff`
// gives TRADE_START and TRADE_ACCEPT 8 m, which is the row `server/groups.mjs` already reads its own
// distances from, so it is imported from there rather than typed again. Everything else -- how many
// rows a character may hold, how long an invitation to trade stands, how many trades the server
// holds at once -- is invented here, lives in `LEDGER_TUNING` with a line saying what it is for, is
// printed on the status page and moves for a run with `--set item.<name>=<n>`.
//
// How it is used. Nothing in here touches a socket or a clock of its own: the relay says who is here
// (`here`), when a line closes (`gone`), calls `tick` once a second, and hands every decision the
// pair `{ ok, why, tell }`, where `tell` is a list of `{ to: <connection>, msg }` for it to fan out,
// exactly as the duels and the creatures do. Writing to the disk is one callback handed in, so the
// tests can run the whole ledger over a plain object and read the log back.
//
// Dependency-free, and shared with tools/swg/tests/ledger.test.ts.

import { GROUP_RANGES } from './groups.mjs';

/**
 * Every number this file invents, in one place. None of them is from the game: the game's own is the
 * 8 m above, which is imported. Caps and patiences chosen here because something had to be chosen.
 */
export const LEDGER_TUNING = {
  /** How many things one character may own. Well past a backpack anyone fills by playing. */
  items: 400,
  /** How many rows the whole server may hold, so nothing grows without bound. */
  rows: 20000,
  /** How many rows one side may put up in one trade. */
  offer: 40,
  /** How long an invitation to trade stands before it is taken back, in ms. */
  'ask.wait': 30000,
  /** How long a trade nobody touches stands before it is broken off, in ms. */
  wait: 300000,
  /** How many trades this server holds at once. */
  trades: 32,
  /** How many words about items or a trade one browser may send in a second. */
  'ask.perSecond': 8,
  /** How often the invitations and the idle trades are looked at, in ms. */
  tick: 1000,
};

/** The two packs an item can come out of, which is what the backpack itself knows. */
const KINDS = ['wear', 'weapon'];
/** What a browser may ask about its own list. */
const DOES = ['list', 'get', 'add', 'drop', 'using'];
/** The steps of a trade a browser may ask for. */
const STEPS = ['ask', 'accept', 'decline', 'offer', 'ready', 'unready', 'cancel'];
/** A catalogue id, and a row id, are keys in the tables below: plain, short and nothing else. */
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
/**
 * Names an id may not have: they mean something to every object in the language rather than being a
 * key. The same belt wire.mjs and ownership.mjs wear.
 */
const RESERVED = ['__proto__', 'constructor', 'prototype'];

/** An id a browser sent, or '' when it is not one this server would use as a key. */
export function cleanItemId(x) {
  if (typeof x !== 'string' || !ID.test(x) || RESERVED.includes(x)) return '';
  return x;
}

/** A list of row ids, capped, with the repeats and the nonsense taken out. */
function idList(x, cap) {
  if (!Array.isArray(x)) return [];
  const out = [];
  for (const one of x) {
    const id = cleanItemId(one);
    if (!id || out.includes(id)) continue;
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * A cleaned copy of an `items`, or undefined when it is not one. As everywhere else, anything that
 * fails is dropped and never answered, so a browser on another build can neither grow the message nor
 * put a word through that nothing here knows.
 */
export function cleanItems(x, tuning = LEDGER_TUNING) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.do !== 'string' || !DOES.includes(x.do)) return undefined;
  if (x.do === 'get') return { do: 'get' };
  if (x.do === 'list') {
    // What a browser brings on its first claim: its whole backpack, worn and held included. The row
    // ids are the server's to mint, so any a browser sends are ignored rather than trusted.
    const rows = [];
    for (const one of Array.isArray(x.rows) ? x.rows : []) {
      const row = cleanRow(one);
      if (row) rows.push(row);
      if (rows.length >= tuning.items) break;
    }
    // What the browser's own record says about itself: that a server has taken this character down
    // before. It is a claim and not a proof -- it decides nothing about who owns what -- but an
    // empty list under it is a cache that was cleared, which is the one list that must never be
    // written down as the truth.
    const rev = Number(x.rev);
    return { do: 'list', rows, known: x.known === 1 || x.known === true, rev: Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 0 };
  }
  if (x.do === 'add') {
    const row = cleanRow(x);
    if (!row) return undefined;
    return { do: 'add', ...row };
  }
  if (x.do === 'drop') {
    const id = cleanItemId(x.id);
    if (!id) return undefined;
    return { do: 'drop', id };
  }
  // What is on the body and in the hands, by row id: the whole of it each time, so anything not in
  // it is free again and nothing has to be unset.
  return { do: 'using', worn: idList(x.worn, tuning.items), held: idList(x.held, tuning.items) };
}

/** One line of a backpack a browser handed up: its kind and its catalogue id, and when it was got. */
function cleanRow(x) {
  if (!x || typeof x !== 'object') return undefined;
  if (typeof x.kind !== 'string' || !KINDS.includes(x.kind)) return undefined;
  const what = cleanItemId(x.what);
  if (!what) return undefined;
  const got = Number(x.got);
  return { kind: x.kind, what, got: Number.isFinite(got) && got >= 0 ? Math.floor(got) : 0 };
}

/** A cleaned copy of a `trade`, or undefined. */
export function cleanTrade(x, tuning = LEDGER_TUNING) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.do !== 'string' || !STEPS.includes(x.do)) return undefined;
  if (x.do === 'ask') {
    const to = Number(x.to);
    if (!Number.isInteger(to) || to <= 0) return undefined;
    return { do: 'ask', to };
  }
  if (x.do === 'offer') return { do: 'offer', rows: idList(x.rows, tuning.offer) };
  return { do: x.do };
}

/**
 * Whether this browser may send another word about its items or its trade this second. The
 * window is the shape the groups' and the creatures' own limits use: a second's worth counted, and a
 * new second starts the count again. The caller's own little record is written in place, so nothing
 * is allocated to ask.
 */
export function mayItems(window, now, perSecond = LEDGER_TUNING['ask.perSecond']) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= perSecond;
}

// ------------------------------------------------------------------------------------------------
// What the store keeps
//
// The rows are part of the world the server already persists: the snapshot plus the append log
// (store.mjs). Four records say everything that can happen to one -- it exists, it is gone, it has
// changed hands, and a whole character's list at once -- and the last two carry a list rather than
// one row, because a hand-over and a backpack handed up are each one step: the log holds both halves
// of a swap, and a whole first settle, in one line, flushed once, so a machine that loses power in
// the middle of either comes back with all of it done or none of it, and so that a full backpack is
// one flush on the socket read path rather than one per thing in it.

/**
 * Apply one item record to the world in memory. `store.mjs` hands anything it does not know itself
 * here, so this is the only place that decides what a row looks like on disk, and the same function
 * runs when a change is made and when the log is replayed. Returns true when it was understood.
 */
export function applyItems(data, rec) {
  if (!data || !rec || typeof rec.t !== 'string') return false;
  switch (rec.t) {
    case 'item': {
      if (typeof rec.id !== 'string' || !rec.id) return false;
      const was = data.items[rec.id] ?? {};
      data.items[rec.id] = { ...was, ...rec.item, id: rec.id };
      return true;
    }
    case 'itemGone': {
      if (typeof rec.id !== 'string' || !rec.id) return false;
      delete data.items[rec.id];
      return true;
    }
    case 'itemSet': {
      // A character's whole list in one record: what it had is gone and these are what it has now.
      // It is written once, when a backpack is handed up for the first time, and replayed the same
      // way, so a settle is one line in the log rather than one per row.
      if (typeof rec.owner !== 'string' || !rec.owner || !Array.isArray(rec.rows)) return false;
      for (const id of Object.keys(data.items)) if (data.items[id]?.owner === rec.owner) delete data.items[id];
      for (const one of rec.rows) {
        if (!one || typeof one.id !== 'string' || !one.id) continue;
        data.items[one.id] = { id: one.id, owner: rec.owner, kind: one.kind, what: one.what, got: one.got };
      }
      return true;
    }
    case 'itemMove': {
      if (!Array.isArray(rec.moves)) return false;
      for (const move of rec.moves) {
        if (!move || typeof move.id !== 'string') continue;
        const row = data.items[move.id];
        if (!row) continue;
        row.owner = move.owner;
        if (Number.isFinite(move.got)) row.got = move.got;
      }
      return true;
    }
    default:
      return false;
  }
}

/** One row as every browser is sent it. */
function rowOf(r) {
  return { id: r.id, kind: r.kind, what: r.what, got: r.got };
}

/** The key a character's own table holds a row under: one of a kind and an id, and no more. */
function keyOf(kind, what) {
  return `${kind}:${what}`;
}

export class Ledger {
  /**
   * @param {{ now?: () => number, tuning?: Record<string, number>, write?: (rec: object) => void }} options
   * the clock to read, so a test can hand in its own and step it; the numbers to work to; and where a
   * change goes to be written down, which the relay wires to the store and a test wires to a plain
   * object, so every rule in here can be run without a disk.
   */
  constructor({ now = () => Date.now(), tuning = LEDGER_TUNING, write = () => {} } = {}) {
    this.now = now;
    this.tuning = tuning;
    this.write = write;
    /** @type {Map<string, object>} row id to the row */
    this.rows = new Map();
    /** @type {Map<string, Map<string, object>>} character to its rows by kind and id */
    this.byOwner = new Map();
    /** @type {Set<string>} the characters whose list the server has been handed and now holds */
    this.settled = new Set();
    /** @type {Map<string, object>} character to the browser playing it just now */
    this.people = new Map();
    /** @type {Map<number, string>} connection to the character it is playing */
    this.bySession = new Map();
    /** @type {Map<string, object>} trade id to the trade */
    this.trades = new Map();
    /** @type {Map<string, string>} character to the one trade it is in */
    this.byWho = new Map();
    /** @type {Map<string, string>} row id to the trade it is up in, so nothing is offered twice */
    this.inTrade = new Map();
    this.nextRow = 1;
    this.nextTrade = 1;
    /** How many items have changed hands since the server started, for the status page. */
    this.handed = 0;
  }

  // -- reading the world back -----------------------------------------------------------------------

  /**
   * Read the rows out of a world the store has loaded (its snapshot with the log replayed over it).
   * A character is "settled" -- the server holds its list rather than being about to be handed one --
   * when its own record says so, which is one field on the record wave 1 already writes.
   */
  load(data) {
    this.rows.clear();
    this.byOwner.clear();
    this.settled.clear();
    let high = 0;
    for (const id of Object.keys(data?.items ?? {})) {
      // The high-water mark is taken from every id the file holds, kept or not, and before anything
      // below can skip a row: a row this reader will not keep is still a key in the file, and minting
      // over it would write a fresh item on top of one that is on the disk -- which is the loss this
      // whole file exists to make impossible.
      const n = /^i(\d+)$/.exec(id);
      if (n) high = Math.max(high, Number(n[1]));
      const kept = data.items[id];
      if (!kept || typeof kept !== 'object') continue;
      const kind = KINDS.includes(kept.kind) ? kept.kind : '';
      const owner = typeof kept.owner === 'string' ? kept.owner : '';
      const what = cleanItemId(kept.what);
      if (!kind || !owner || !what) continue;
      const mine = this.table(owner);
      // Two rows of one thing for one character cannot happen through anything here, and if a file
      // ever held them the later one is dropped rather than carried: the backpack itself holds one.
      if (mine.has(keyOf(kind, what))) continue;
      this.keep({ id, owner, kind, what, got: Number(kept.got) || 0, use: '' });
    }
    for (const id of Object.keys(data?.characters ?? {})) if (data.characters[id]?.items === 1) this.settled.add(id);
    this.nextRow = high + 1;
    return this;
  }

  // -- who is connected -------------------------------------------------------------------------------

  /**
   * A browser is here playing this character. The same character opened in a second browser is the
   * newer one's from this instant (wave 1's takeover), and whatever trade the older line had is
   * broken off: the two browsers would otherwise both hold a window over one backpack.
   */
  here(character, { session = 0, name = '' } = {}) {
    const tell = [];
    if (!character) return { ok: false, why: 'nobody to be here', tell };
    // This line may have been playing somebody else a moment ago: a browser that goes back to the
    // select screen and picks a second character claims again on the same socket, which is a shape
    // wave 1's `Sessions.take` already handles (`if (had && had !== character)`). Without the same
    // here, the first character is left "here" on a live line with whatever trade it had open still
    // standing -- a window with nobody at it, which the other side could press through, and whose
    // answer would be delivered to a browser now playing somebody else.
    const before = session ? this.bySession.get(session) : '';
    if (before && before !== character) {
      const was = this.people.get(before);
      // Its session is let go first, so the "off" for that window is not addressed to this line,
      // which is about to be somebody else's.
      if (was && was.session === session) was.session = 0;
      this.cancelOf(before, tell, 'that character was put down');
      if (was && !was.session) this.people.delete(before);
    }
    const had = this.people.get(character);
    if (had && had.session && had.session !== session) {
      this.bySession.delete(had.session);
      this.cancelOf(character, tell, 'that character was opened in another browser');
    }
    const person = had ?? { character, session: 0, name: '' };
    person.session = session;
    if (name) person.name = name;
    this.people.set(character, person);
    if (session) this.bySession.set(session, character);
    return { ok: true, tell };
  }

  /**
   * A line closed. Whatever trade that browser was in is broken off with the items exactly where they
   * started, and the docks it held are let go by the relay's own word to `spots.mjs`. A line that has
   * already been taken over by a newer one gives up nothing: it is a stale line and the character is
   * somebody else's now.
   */
  gone(session) {
    const tell = [];
    const character = this.bySession.get(session);
    if (!character) return { ok: true, tell };
    this.bySession.delete(session);
    const person = this.people.get(character);
    if (person && person.session !== session) return { ok: true, tell };
    if (person) person.session = 0;
    this.cancelOf(character, tell, 'the other player has gone');
    // Nobody is playing this character now, so the little record of who is reading for it goes: what
    // it owns is in the tables and on the disk, and this map is only ever about a live line.
    if (person && !person.session) this.people.delete(character);
    return { ok: true, tell };
  }

  /** The connection a character is being played on, or 0. */
  sessionOf(character) {
    return this.people.get(character)?.session ?? 0;
  }

  /** What a character is called, for the words the other side reads. */
  nameOf(character) {
    return this.people.get(character)?.name || 'someone';
  }

  /** The character a connection is playing, or ''. */
  characterOf(session) {
    return this.bySession.get(session) ?? '';
  }

  // -- the list ----------------------------------------------------------------------------------------

  /**
   * A browser has handed its backpack up. The first time for a character the server writes it down and
   * that is the list; every time after, the server's list stands and the browser is told it rather than
   * merged with -- a merge is the one thing that can put an item back after it has been given away.
   * Either way the answer carries the settled list, so the browser always learns the row ids.
   *
   * The claim is what the browser's own record says about itself: that a server has taken this
   * character's list down before. It proves nothing and decides nothing about who owns what, but an
   * empty list under it is a browser whose storage was cleared rather than a character that owns
   * nothing, and that is the one list that must never be written down as the truth.
   */
  settle(character, rows = [], claim = { known: false, rev: 0 }) {
    const tell = [];
    if (!character) return { ok: false, why: 'nobody to settle for', tell, take: 'server', rows: [] };
    // Anything in flight is broken off first: the list is about to be replaced, and a trade offering a
    // row that is no longer there is the shape of a lost item.
    this.cancelOf(character, tell, 'that backpack was settled with the server');
    const known = this.settled.has(character);
    // The character stays unsettled, so the next browser with a real list still settles it, and this
    // one is answered with what is here (nothing) rather than being taken at its word.
    if (!known && claim && claim.known && rows.length === 0) return { ok: true, take: 'server', rows: [], tell };
    if (!known) {
      this.replace(character, rows);
      this.settled.add(character);
      // One field on the character's own record, which the store already understands and merges, so
      // that a restart can tell "the server holds this list" from "this character owns nothing".
      this.write({ t: 'character', id: character, character: { items: 1 } });
    }
    return { ok: true, take: known ? 'server' : 'browser', rows: this.listFor(character), tell };
  }

  /** What a character owns, as a browser is sent it. */
  listFor(character) {
    const out = [];
    for (const row of (this.owned(character)?.values() ?? [])) out.push(rowOf(row));
    out.sort((a, b) => a.got - b.got || (a.id < b.id ? -1 : 1));
    return out;
  }

  /** Whether the server holds this character's list at all. */
  holds(character) {
    return this.settled.has(character);
  }

  /** The row a character has of one thing, or null. */
  rowFor(character, kind, what) {
    return this.owned(character)?.get(keyOf(kind, what)) ?? null;
  }

  /** How many rows there are altogether, for the status page and for the tests to count. */
  get size() {
    return this.rows.size;
  }

  /**
   * Something has come into a character's hands that nothing else gave it: the starting kit, the give
   * tab, a reward. A second of a thing it already has is not an error and is not a second row.
   */
  add(character, kind, what, got = 0) {
    if (!character || !KINDS.includes(kind) || !cleanItemId(what)) return { ok: false, why: 'that is not a thing to own' };
    const mine = this.owned(character);
    const had = mine?.get(keyOf(kind, what));
    if (had) return { ok: true, row: rowOf(had), already: true };
    if ((mine?.size ?? 0) >= this.tuning.items) return { ok: false, why: `a character carries ${this.tuning.items} things` };
    if (this.rows.size >= this.tuning.rows) return { ok: false, why: 'this server is holding as many things as it can' };
    const row = { id: this.mint(), owner: character, kind, what, got: Number(got) || this.now(), use: '' };
    this.keep(row);
    this.write({ t: 'item', id: row.id, item: { owner: row.owner, kind: row.kind, what: row.what, got: row.got } });
    return { ok: true, row: rowOf(row) };
  }

  /** Something is gone for good: destroyed, or a browser saying it no longer has it. */
  drop(character, id) {
    const row = this.rows.get(id);
    if (!row || row.owner !== character) return { ok: false, why: 'you do not have that' };
    if (this.inTrade.has(id)) return { ok: false, why: 'that is up in a trade' };
    this.forget(row);
    this.write({ t: 'itemGone', id });
    return { ok: true, row: rowOf(row) };
  }

  /**
   * What this character is wearing and holding, by row id, the whole of it each time: anything not in
   * it is free again. It is not written down -- what is worn is on the character's own record already,
   * and a line in the log every time somebody changes a shirt would be a flush for nothing -- so after
   * a restart nothing is in use until the browser says so again, which it does on its first hello.
   */
  using(character, worn = [], held = []) {
    const mine = this.owned(character);
    if (!mine) return { ok: true, tell: [] };
    const on = new Map();
    for (const id of worn) on.set(id, 'worn');
    for (const id of held) on.set(id, 'held');
    for (const row of mine.values()) row.use = on.get(row.id) ?? '';
    return { ok: true, tell: [] };
  }

  /** Whether a row is on the body or in a hand, which is what may not be put up in a trade. */
  inUse(id) {
    return this.rows.get(id)?.use ?? '';
  }

  // -- a trade -------------------------------------------------------------------------------------------

  /**
   * Ask somebody to trade. The distance is measured by the caller, which is the only thing that knows
   * where two players are standing, and the rule it is held to is the game's own TRADE_START.
   */
  ask(from, to, distance) {
    const tell = [];
    if (!from || !to || from === to) return this.refuse(from, tell, 'there is nobody there to trade with');
    if (!this.sessionOf(from)) return { ok: false, why: 'you are not here', tell };
    if (!this.sessionOf(to)) return this.refuse(from, tell, `${this.nameOf(to)} is not here`);
    if (!this.settled.has(from)) return this.refuse(from, tell, 'this server does not hold your things yet');
    if (!this.settled.has(to)) return this.refuse(from, tell, `this server does not hold ${this.nameOf(to)}'s things yet`);
    if (this.byWho.has(from)) return this.refuse(from, tell, 'you are already trading');
    if (this.byWho.has(to)) return this.refuse(from, tell, `${this.nameOf(to)} is already trading`);
    if (this.trades.size >= this.tuning.trades) return this.refuse(from, tell, 'this server is holding as many trades as it can');
    if (!(Number(distance) <= GROUP_RANGES.trade)) return this.refuse(from, tell, `${this.nameOf(to)} is too far away to trade with`);
    const until = this.now() + this.tuning['ask.wait'];
    const trade = { id: `t${this.nextTrade++}`, a: from, b: to, state: 'asked', until, offers: new Map([[from, []], [to, []]]), ready: new Set() };
    this.trades.set(trade.id, trade);
    this.byWho.set(from, trade.id);
    this.byWho.set(to, trade.id);
    this.say(tell, to, { t: 'trade', do: 'asked', id: trade.id, from: this.sessionOf(from), name: this.nameOf(from), until });
    this.say(tell, from, { t: 'trade', do: 'sent', id: trade.id, to: this.sessionOf(to), name: this.nameOf(to), until });
    return { ok: true, tell };
  }

  /** Say yes to the asking. Both windows open on this, with nothing in either pane. */
  accept(character) {
    const tell = [];
    const trade = this.tradeOf(character);
    if (!trade || trade.state !== 'asked') return { ok: false, why: 'there is nothing to accept', tell };
    if (trade.b !== character) return { ok: false, why: 'you are the one who asked', tell };
    trade.state = 'open';
    trade.until = this.now() + this.tuning.wait;
    this.both(trade, tell);
    return { ok: true, tell };
  }

  /** Say no, or shut the window: either ends it, and the items are where they started. */
  decline(character) {
    const tell = [];
    const trade = this.tradeOf(character);
    if (!trade) return { ok: false, why: 'there is nothing to decline', tell };
    this.end(trade, tell, trade.state === 'asked' ? `${this.nameOf(character)} would rather not` : `${this.nameOf(character)} closed the trade`);
    return { ok: true, tell };
  }

  /**
   * What this side is putting in: the whole of its pane each time, so taking something down is the
   * same message as putting something up. Every row is checked -- owned by this side, not on the body
   * or in a hand, and not up in another trade -- and anything that fails takes the whole offer with it
   * rather than being quietly left out, since a pane that does not say what it holds is worse than a
   * refusal. Either side changing anything takes both sides' word back, as the game's own window did.
   */
  offer(character, ids = []) {
    const tell = [];
    const trade = this.tradeOf(character);
    if (!trade || trade.state !== 'open') return { ok: false, why: 'you are not trading', tell };
    if (ids.length > this.tuning.offer) return this.refuse(character, tell, `you can put up ${this.tuning.offer} things at once`);
    for (const id of ids) {
      const row = this.rows.get(id);
      if (!row || row.owner !== character) return this.refuse(character, tell, 'you do not have that to give');
      if (row.use) return this.refuse(character, tell, `you are ${row.use === 'held' ? 'holding' : 'wearing'} that: take it off first`);
      const other = this.inTrade.get(id);
      if (other && other !== trade.id) return this.refuse(character, tell, 'that is already up in another trade');
    }
    for (const id of trade.offers.get(character) ?? []) this.inTrade.delete(id);
    trade.offers.set(character, [...ids]);
    for (const id of ids) this.inTrade.set(id, trade.id);
    trade.ready.clear();
    trade.until = this.now() + this.tuning.wait;
    this.both(trade, tell);
    return { ok: true, tell };
  }

  /**
   * This side is happy. When both sides are, the swap happens here and now -- one record, written
   * before either browser is told. The distance is checked again on the press, which is the game's own
   * TRADE_ACCEPT: two people who have walked apart while the window was open do not trade.
   */
  ready(character, distance) {
    const tell = [];
    const trade = this.tradeOf(character);
    if (!trade || trade.state !== 'open') return { ok: false, why: 'you are not trading', tell };
    if (!(Number(distance) <= GROUP_RANGES.trade)) return this.refuse(character, tell, 'you have walked too far apart to trade');
    trade.ready.add(character);
    trade.until = this.now() + this.tuning.wait;
    if (trade.ready.has(trade.a) && trade.ready.has(trade.b)) return this.finish(trade, tell);
    this.both(trade, tell);
    return { ok: true, tell };
  }

  /** Take that back. Nothing else changes; the panes stand as they are. */
  unready(character) {
    const tell = [];
    const trade = this.tradeOf(character);
    if (!trade || trade.state !== 'open') return { ok: false, why: 'you are not trading', tell };
    trade.ready.delete(character);
    this.both(trade, tell);
    return { ok: true, tell };
  }

  /** Break it off from either side, for any reason at all. */
  cancel(character, why = 'the trade was called off') {
    const tell = [];
    const trade = this.tradeOf(character);
    if (!trade) return { ok: false, why: 'you are not trading', tell };
    this.end(trade, tell, why);
    return { ok: true, tell };
  }

  /** The trade a character is in, or null. */
  tradeOf(character) {
    const id = this.byWho.get(character);
    return id ? this.trades.get(id) ?? null : null;
  }

  /**
   * Expire what has a life on it: an invitation nobody answered, and a trade nobody has touched for a
   * long while. With nobody trading it walks an empty table.
   */
  tick(into = null) {
    const tell = into ?? [];
    const now = this.now();
    for (const trade of [...this.trades.values()]) {
      if (trade.until > now) continue;
      this.end(trade, tell, trade.state === 'asked' ? 'nobody answered' : 'the trade was left too long');
    }
    return { ok: true, tell };
  }

  // -- the pieces the above is made of ------------------------------------------------------------------

  /**
   * A character's own table of rows as it stands, or null. Everything that only *reads* a list goes
   * through this rather than through `table`, which makes one: a character merely looked at -- asked
   * about by somebody standing near it, named in a refusal -- would otherwise leave an empty table
   * behind for the life of the server, and be counted on the status page as somebody who owns things.
   */
  owned(character) {
    return this.byOwner.get(character) ?? null;
  }

  /** A character's own table of rows, made if it is not there yet. Only ever for putting one in. */
  table(character) {
    let mine = this.byOwner.get(character);
    if (!mine) {
      mine = new Map();
      this.byOwner.set(character, mine);
    }
    return mine;
  }

  /** Put a row in the tables. */
  keep(row) {
    this.rows.set(row.id, row);
    this.table(row.owner).set(keyOf(row.kind, row.what), row);
  }

  /** Take a row out of the tables, and the table itself when it was the last row in it. */
  forget(row) {
    this.rows.delete(row.id);
    const mine = this.byOwner.get(row.owner);
    if (mine && mine.get(keyOf(row.kind, row.what)) === row) mine.delete(keyOf(row.kind, row.what));
    if (mine && !mine.size) this.byOwner.delete(row.owner);
    this.inTrade.delete(row.id);
  }

  /** A fresh row id. They run `i1`, `i2` and are never used twice, this run or any after it. */
  mint() {
    let key = `i${this.nextRow++}`;
    while (this.rows.has(key)) key = `i${this.nextRow++}`;
    return key;
  }

  /**
   * Write a character's whole list down for the first time: one row per line, and nothing of that
   * character's kept that is not in it. It is only ever reached for a character the server has never
   * held a list for, so nothing anybody else owns can be touched by it.
   */
  replace(character, rows) {
    let had = 0;
    for (const row of [...(this.owned(character)?.values() ?? [])]) {
      this.forget(row);
      had++;
    }
    const kept = [];
    for (const one of rows ?? []) {
      const row = cleanRow(one);
      if (!row) continue;
      const mine = this.owned(character);
      if (mine?.has(keyOf(row.kind, row.what))) continue;
      if ((mine?.size ?? 0) >= this.tuning.items) break;
      if (this.rows.size >= this.tuning.rows) break;
      const made = { id: this.mint(), owner: character, kind: row.kind, what: row.what, got: row.got || this.now(), use: '' };
      this.keep(made);
      kept.push({ id: made.id, kind: made.kind, what: made.what, got: made.got });
    }
    // One record for the whole list rather than a line per row. Two reasons, and the second is the
    // one that matters: a settle with a full backpack would otherwise be four hundred writes and four
    // hundred flushes on the socket read path, with every other browser's news, clock and trade press
    // waiting behind them on the one thread; and a crash partway through that would leave a character
    // with its old rows deleted and its new ones not yet written, which is a backpack lost. This way
    // it is the same shape as the hand-over: one line in the log, flushed once, all of it or none.
    if (had || kept.length) this.write({ t: 'itemSet', owner: character, rows: kept });
  }

  /** A refusal goes back to whoever asked, and to nobody else. */
  refuse(character, tell, why) {
    this.say(tell, character, { t: 'trade', do: 'refused', why });
    return { ok: false, why, tell };
  }

  /** A line for one character's browser, when there is one reading. */
  say(tell, character, msg) {
    const session = this.sessionOf(character);
    if (session) tell.push({ to: session, msg });
  }

  /** What one side of a trade is looking at: its own pane, the other's, and who has said they are happy. */
  view(trade, who) {
    const other = who === trade.a ? trade.b : trade.a;
    const rows = (character) => (trade.offers.get(character) ?? []).map((id) => this.rows.get(id)).filter(Boolean).map(rowOf);
    return {
      t: 'trade',
      do: 'state',
      id: trade.id,
      with: this.sessionOf(other),
      name: this.nameOf(other),
      yours: { rows: rows(who), ready: trade.ready.has(who) ? 1 : 0 },
      theirs: { rows: rows(other), ready: trade.ready.has(other) ? 1 : 0 },
    };
  }

  /** Both sides are told the whole trade, each from its own end, so neither has to work it out. */
  both(trade, tell) {
    this.say(tell, trade.a, this.view(trade, trade.a));
    this.say(tell, trade.b, this.view(trade, trade.b));
  }

  /**
   * The hand-over. Every row is checked once more against the tables as they are this instant -- still
   * owned by the side offering it, still not on a body or in a hand -- and what each side would end up
   * holding is worked out before anything moves, so a swap that would leave somebody with two of one
   * thing, or past what a character may carry, is refused whole rather than half done.
   *
   * Then one record with every move in it, written and flushed before either browser is told a word:
   * that is what makes "both rows change owner together or neither does" true through a power cut, a
   * line dropping and a browser closing in the same instant.
   */
  finish(trade, tell) {
    const moves = [];
    const now = this.now();
    /** @type {Map<string, Set<string>>} what each side will be holding, by kind and id */
    const after = new Map();
    for (const side of [trade.a, trade.b]) after.set(side, new Set([...(this.owned(side)?.keys() ?? [])]));
    for (const side of [trade.a, trade.b]) {
      const other = side === trade.a ? trade.b : trade.a;
      for (const id of trade.offers.get(side) ?? []) {
        const row = this.rows.get(id);
        if (!row || row.owner !== side) return this.end(trade, tell, 'one of the things is no longer there to give');
        if (row.use) return this.end(trade, tell, 'one of the things is being worn or held');
        after.get(side).delete(keyOf(row.kind, row.what));
        moves.push({ id, owner: other, got: now, kind: row.kind, what: row.what });
      }
    }
    for (const move of moves) {
      const taking = after.get(move.owner);
      const key = keyOf(move.kind, move.what);
      if (taking.has(key)) return this.end(trade, tell, `${this.nameOf(move.owner)} already has one of those`);
      taking.add(key);
    }
    for (const side of [trade.a, trade.b]) {
      if (after.get(side).size > this.tuning.items) return this.end(trade, tell, `${this.nameOf(side)} cannot carry that much`);
    }
    // Nothing above has changed anything. From here it is one step.
    //
    // The trade leaves the tables first, before the record is written: from this instant it is a
    // hand-over that has been decided, and a line closing in the middle of it can no longer cancel a
    // trade that is half done. The names both sides are told are read here too, for the same reason.
    const names = { a: this.nameOf(trade.a), b: this.nameOf(trade.b) };
    this.close(trade);
    // Two players who both pressed with nothing in either pane have agreed to nothing: the window
    // closes and no line is written, since a record that moves no row is a flush for nothing.
    if (moves.length) this.write({ t: 'itemMove', moves: moves.map((m) => ({ id: m.id, owner: m.owner, got: m.got })) });
    for (const move of moves) {
      const row = this.rows.get(move.id);
      this.forget(row);
      row.owner = move.owner;
      row.got = move.got;
      row.use = '';
      this.keep(row);
    }
    this.handed += moves.length;
    const gave = (side) => (trade.offers.get(side) ?? []).map((id) => rowOf(this.rows.get(id))).filter(Boolean);
    const forA = { gave: gave(trade.a), got: gave(trade.b) };
    const forB = { gave: gave(trade.b), got: gave(trade.a) };
    this.say(tell, trade.a, { t: 'trade', do: 'done', with: names.b, ...forA });
    this.say(tell, trade.b, { t: 'trade', do: 'done', with: names.a, ...forB });
    return { ok: true, tell, moved: moves.length };
  }

  /** End a trade with nothing moved, and tell both sides why. */
  end(trade, tell, why) {
    if (!this.trades.has(trade.id)) return { ok: false, why, tell };
    this.close(trade);
    this.say(tell, trade.a, { t: 'trade', do: 'off', why });
    this.say(tell, trade.b, { t: 'trade', do: 'off', why });
    return { ok: false, why, tell };
  }

  /** Take a trade out of the tables, which frees every row it was holding. */
  close(trade) {
    for (const ids of trade.offers.values()) for (const id of ids) this.inTrade.delete(id);
    if (this.byWho.get(trade.a) === trade.id) this.byWho.delete(trade.a);
    if (this.byWho.get(trade.b) === trade.id) this.byWho.delete(trade.b);
    this.trades.delete(trade.id);
  }

  /** Break off whatever trade this character is in, wherever the call came from. */
  cancelOf(character, tell, why) {
    const trade = this.tradeOf(character);
    if (trade) this.end(trade, tell, why);
  }

  /** What to print on the status page: how much the world holds and what is going on in it. */
  describe() {
    if (!this.rows.size && !this.trades.size) return 'nothing owned';
    const live = [...this.trades.values()].filter((t) => t.state === 'open').length;
    return `${this.rows.size} things owned by ${this.byOwner.size} characters, ${this.trades.size} trade(s) going (${live} open), ${this.handed} handed over`;
  }
}
