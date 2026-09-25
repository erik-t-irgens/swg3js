// What a character has to spend.
//
// Credits are **a number on a character and not a thing in a backpack**, which is the owner's own
// call and is also what the game did: you never carried a stack of coins about, and nothing in the
// archives gives credits an object template. So this is the smallest module in the server: a number
// per character, written down beside the items and the houses, moved only by whole amounts and
// never below zero.
//
// The one rule everything here exists for: **a balance may not be spent twice.** So a spend is one
// record, written and flushed before anybody is told a word, and a spend that would go below zero
// moves nothing at all rather than going as far as it can. There is no overdraft and no reservation:
// a fare either comes out whole or it does not come out.
//
// What is the game's and what is ours: the fares are the game's (the shuttle routes' own prices,
// which the converter reads) and every number **here** is ours -- what a new character starts with,
// the most one may hold, and how often a browser may ask. The game's own starting money is nowhere
// in the archives: it was the server's, and the emulator's own figure is a choice that server made
// rather than something the game shipped, so ours is a choice too and is said to be one.
//
// How it is used: nothing in here touches a socket or a clock. The relay says who is here, and
// every decision answers `{ ok, why, tell }` as the ledger, the homes and the duels do. Writing to
// the disk is one callback handed in.
//
// Dependency-free, and shared with tools/swg/tests/purse.test.ts.

/** Every number this file invents. None of them is from the game. */
export const PURSE_TUNING = {
  /**
   * What a character has the first time the server ever sees it.
   *
   * Nothing in this game earns credits yet, so this is the whole of anybody's money and is set to
   * cover a good many shuttle fares rather than to be a challenge -- the fares are 100 within a
   * world and 500 to 4,000 between them.
   */
  start: 25000,
  /** The most one character may hold, so nothing can overflow what a browser will show. */
  most: 1000000000,
  /** How many purse words one browser may send in a second. */
  perSecond: 4,
};

const RESERVED = ['__proto__', 'constructor', 'prototype'];

/** A whole number of credits, or null when it is not one. */
export function credits(x, tuning = PURSE_TUNING) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  const n = Math.floor(x);
  if (n < 0 || n > tuning.most) return null;
  return n;
}

/**
 * Apply one change about a purse to the world in memory. The same function runs when money moves
 * and when the log is replayed on start, so a replayed world and a live one cannot drift apart.
 */
export function applyPurse(data, rec) {
  if (!rec || typeof rec !== 'object' || rec.t !== 'purse') return false;
  if (typeof rec.id !== 'string' || !rec.id || RESERVED.includes(rec.id)) return false;
  const n = credits(rec.credits);
  if (n === null) return false;
  data.purses ??= Object.create(null);
  data.purses[rec.id] = n;
  return true;
}

/** Whether this browser may send another purse word this second. Dropping one is safe: it asks again. */
export function mayPurse(window, now, tuning = PURSE_TUNING) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= tuning.perSecond;
}

export class Purses {
  /**
   * @param {{ tuning?: Record<string, number>, write?: (rec: object) => void }} options the numbers
   * to work to, and where a change goes to be written down.
   */
  constructor({ tuning = PURSE_TUNING, write = () => {} } = {}) {
    this.tuning = tuning;
    this.write = write;
    /** @type {Map<string, number>} character to what it has */
    this.held = new Map();
    this.spent = 0;
    this.given = 0;
    this.refusals = 0;
  }

  /** Take the world the store read back. Called once, before anybody is connected. */
  load(data) {
    for (const id of Object.keys(data?.purses ?? {})) {
      const n = credits(data.purses[id], this.tuning);
      if (n !== null) this.held.set(id, n);
    }
  }

  /**
   * What a character has. A character the world has never seen is **opened** here with the starting
   * amount and written down, because a balance that is only in memory would be a different number
   * every restart and a fare would be free after one.
   */
  of(character) {
    if (!character) return 0;
    const had = this.held.get(character);
    if (had !== undefined) return had;
    this.held.set(character, this.tuning.start);
    this.write({ t: 'purse', id: character, credits: this.tuning.start });
    return this.tuning.start;
  }

  /**
   * Take an amount, or refuse it whole.
   *
   * `why` is the caller's own words for what the money was for, which goes back to the browser so
   * that a refusal says what could not be paid for rather than only that something could not.
   */
  spend(character, amount, session, what = 'that') {
    const n = credits(amount, this.tuning);
    if (n === null) return this.no(session, 'that is not an amount');
    if (!character) return this.no(session, 'a character has to be claimed before it can hold anything');
    const had = this.of(character);
    if (n > had) return this.no(session, `${what} costs ${n.toLocaleString('en-GB')} and you have ${had.toLocaleString('en-GB')}`);
    const left = had - n;
    this.held.set(character, left);
    this.write({ t: 'purse', id: character, credits: left });
    this.spent += n;
    return { ok: true, left, tell: [{ to: session, msg: { t: 'purse', credits: left, spent: n, what } }] };
  }

  /** Put an amount in, capped at the most one may hold. Nothing in the game does this yet but an admin. */
  give(character, amount, session) {
    const n = credits(amount, this.tuning);
    if (n === null || !character) return this.no(session, 'that is not an amount');
    const left = Math.min(this.tuning.most, this.of(character) + n);
    this.held.set(character, left);
    this.write({ t: 'purse', id: character, credits: left });
    this.given += n;
    return { ok: true, left, tell: [{ to: session, msg: { t: 'purse', credits: left, given: n } }] };
  }

  /** What a browser is told when it asks. */
  tell(character, session) {
    return { ok: true, left: this.of(character), tell: [{ to: session, msg: { t: 'purse', credits: this.of(character) } }] };
  }

  no(session, why) {
    this.refusals++;
    return { ok: false, why, tell: [{ to: session, msg: { t: 'purse', why } }] };
  }

  /** What the status page prints. */
  describe() {
    let total = 0;
    for (const n of this.held.values()) total += n;
    return { purses: this.held.size, total, spent: this.spent, given: this.given, refusals: this.refusals, tuning: this.tuning };
  }
}
