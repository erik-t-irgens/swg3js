// The buildings players have put down: who owns each one, where it stands, and who is told about it.
//
// A house placed in play was one browser's, in one session, and gone the moment you left the world.
// This is the half that makes one real: the server writes it down beside the characters and the
// items, tells whoever is standing on that world, and tells them again the next time they arrive.
// `world.json` has had an empty `houses` slot since the store was written for exactly this.
//
// **What the server can decide and what it cannot.** It has no terrain: there is no ground here to
// test, so whether a spot will take a house is the browser's answer and the height comes up the wire
// with the rest of the place. That is the same trust the server already gives a player's own
// position and it is said out loud rather than discovered. What the server *can* decide is
// everything that is about the world rather than about one browser -- how many houses there are, how
// many one character may have, and that two of them are not put in the same place -- and it decides
// all three, because those are the ones a second browser can disagree with.
//
// Two houses are kept apart by the circles they asked for: the browser sends the radius its own
// building wanted clear of flora, the server keeps it, capped, and refuses a house whose circle
// reaches into one already standing. Nothing here knows what a building is -- the model is a string,
// kept and never parsed -- so a new kind of structure is a new id in a pack and no new code.
//
// Identity is the server's and never the browser's: a browser-chosen id could collide with another
// player's, and could be one of the language's own names. Ids are the world's own counter.
//
// What is the game's and what is ours: none of it is the game's. The real server had lots, deeds,
// maintenance and city zoning, and not one number of that is in the archives the converter reads.
// Everything below is invented, lives in `HOME_TUNING` with a line saying what it is for, is printed
// on the status page, and moves for a run with `--set home.<name>=<n>`.
//
// How it is used. Nothing in here touches a socket or a clock of its own: the relay says who is here
// and on what world, and every decision answers `{ ok, why, tell }`, where `tell` is a list of
// `{ to: <connection>, msg }` for the relay to fan out, exactly as the ledger, the duels and the
// creatures do. Writing to the disk is one callback handed in, so the tests run the whole of this
// over a plain object and read the log back.
//
// Dependency-free, and shared with tools/swg/tests/homes.test.ts.

/**
 * Every number this file invents. None of them is from the game.
 */
export const HOME_TUNING = {
  /** How many buildings one character may have standing at once, over all worlds. */
  mine: 10,
  /** How many one world may hold, so one player cannot fill a planet. */
  world: 2000,
  /** How many this server holds at once. */
  rows: 20000,
  /** How many placing or removing words one browser may send in a second. */
  perSecond: 4,
  /**
   * The largest circle a building may keep to itself, metres. The widest one in the pack asks for
   * about forty; this is the cap that stops a browser claiming a square kilometre by saying so.
   */
  clear: 64,
  /** The smallest, so a building that sends nothing sensible still keeps something clear. */
  least: 4,
  /** How far apart two circles must stand on top of what they each asked for, metres. */
  apart: 2,
};

/** The shape of a model id: what the packs' own ids are made of, never parsed here. */
const MODEL = /^[A-Za-z0-9_.-]{1,96}$/;
/**
 * The longest a world key may be. There is no pattern on it, deliberately: the key is not a
 * browser's word, it is what `rooms.mjs` made of one, and a pattern here would be this file having
 * an opinion about another file's keys -- which it did, and which refused every world whose name
 * has a space in it. Nor does it need a prototype guard: worlds are held in real Maps, and the only
 * plain object a house ever becomes a key of is the store's, under an id this file made up itself.
 */
const WORLD_KEY = 128;
/** Names a key may not have: the three that mean something to every object in the language. */
const RESERVED = ['__proto__', 'constructor', 'prototype'];

/** A number that is really one, and within a world's own reach. */
function metres(x) {
  return typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 100000 ? Math.round(x * 100) / 100 : undefined;
}

/**
 * A cleaned copy of a `placeHome`, or undefined when it is not one. As everywhere else, anything
 * that fails is dropped and never answered: a browser sending nonsense hears nothing back.
 */
export function cleanHome(x, tuning = HOME_TUNING) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.model !== 'string' || !MODEL.test(x.model) || RESERVED.includes(x.model)) return undefined;
  const px = metres(x.x);
  const py = metres(x.y);
  const pz = metres(x.z);
  if (px === undefined || py === undefined || pz === undefined) return undefined;
  if (typeof x.h !== 'number' || !Number.isFinite(x.h)) return undefined;
  // The turn is kept in the half-open turn, so two browsers that name the same heading differently
  // (a full turn apart) write the same number down.
  const turn = Math.PI * 2;
  const h = Math.round((((x.h % turn) + turn) % turn) * 1000) / 1000;
  const r = Math.min(tuning.clear, Math.max(tuning.least, metres(x.r) ?? tuning.least));
  return { model: x.model, x: px, y: py, z: pz, h, r };
}

/** A cleaned copy of a `removeHome`, or undefined. */
export function cleanRemove(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(x.id) || RESERVED.includes(x.id)) return undefined;
  return { id: x.id };
}

/**
 * Whether this browser may send another placing word this second. The same window the spots and the
 * creatures use, written in place so that asking allocates nothing. A dropped word here is safe to
 * drop in silence, unlike a dock claim: a house that did not go up is a house the browser never saw
 * appear, and the next press asks again.
 */
export function mayPlace(window, now, tuning = HOME_TUNING) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= tuning.perSecond;
}

/**
 * Apply one change about a house to the world in memory. The same function runs when a house is put
 * down and when the log is replayed on start, so a replayed world and a live one cannot drift apart.
 * Returns true when the record was understood; anything else is a record from a newer server, which
 * is kept in the log, not understood here, and not an error.
 */
export function applyHomes(data, rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.t === 'home') {
    if (typeof rec.id !== 'string' || !rec.id || RESERVED.includes(rec.id)) return false;
    if (!rec.home || typeof rec.home !== 'object') return false;
    data.houses ??= Object.create(null);
    data.houses[rec.id] = { ...data.houses[rec.id], ...rec.home, id: rec.id };
    // The counter is kept with the houses so a restart never hands out an id it has used.
    if (typeof rec.id === 'string' && /^h[0-9]+$/.test(rec.id)) {
      const n = Number(rec.id.slice(1));
      if (Number.isFinite(n) && n >= (data.houseSeq ?? 0)) data.houseSeq = n + 1;
    }
    return true;
  }
  if (rec.t === 'homeGone') {
    if (typeof rec.id !== 'string' || !rec.id) return false;
    if (data.houses) delete data.houses[rec.id];
    return true;
  }
  return false;
}

/** What goes over the wire for one house: everything a browser needs to stand it and nothing else. */
function wireOf(h) {
  return { id: h.id, owner: h.owner, model: h.model, x: h.x, y: h.y, z: h.z, h: h.h, r: h.r, at: h.at };
}

export class Homes {
  /**
   * @param {{ now?: () => number, tuning?: Record<string, number>,
   *           write?: (rec: object) => void }} options the clock to read so a test can hand in its
   * own, the numbers to work to, and where a change goes to be written down.
   */
  constructor({ now = () => Date.now(), tuning = HOME_TUNING, write = () => {} } = {}) {
    this.now = now;
    this.tuning = tuning;
    this.write = write;
    /** @type {Map<string, object>} every house standing, by its id */
    this.rows = new Map();
    /** @type {Map<string, Set<string>>} world key to the ids standing on it */
    this.byWorld = new Map();
    /** @type {Map<string, Set<string>>} character to the ids it owns */
    this.byOwner = new Map();
    /** The next id, which a load carries forward so a restart never repeats one. */
    this.seq = 1;
    this.placed = 0;
    this.removed = 0;
    this.refusals = 0;
  }

  /** Take the world the store read back. Called once, before anybody is connected. */
  load(data) {
    for (const id of Object.keys(data?.houses ?? {})) this.adopt({ ...data.houses[id], id });
    if (Number.isFinite(data?.houseSeq)) this.seq = Math.max(this.seq, data.houseSeq);
  }

  /** Put a row into the three indexes. Used by `load` and by a grant, so there is one such place. */
  adopt(row) {
    this.rows.set(row.id, row);
    const w = this.byWorld.get(row.world) ?? new Set();
    w.add(row.id);
    this.byWorld.set(row.world, w);
    const o = this.byOwner.get(row.owner) ?? new Set();
    o.add(row.id);
    this.byOwner.set(row.owner, o);
  }

  /** How many one character owns, for the cap and the status page. */
  ownedBy(character) {
    return this.byOwner.get(character)?.size ?? 0;
  }

  /** The houses standing on one world, as they go over the wire. */
  forWorld(world) {
    const out = [];
    for (const id of this.byWorld.get(world) ?? []) {
      const row = this.rows.get(id);
      if (row) out.push(wireOf(row));
    }
    return out;
  }

  /**
   * The house already standing whose circle this one would reach into, or null.
   *
   * It is a walk of the world's own list rather than a grid: a world holds at most `world` of them,
   * a placing is a keypress and not a frame, and a grid would be a second thing to keep right.
   */
  overlapping(world, x, z, r) {
    for (const id of this.byWorld.get(world) ?? []) {
      const row = this.rows.get(id);
      if (!row) continue;
      const want = row.r + r + this.tuning.apart;
      if ((row.x - x) ** 2 + (row.z - z) ** 2 < want * want) return row;
    }
    return null;
  }

  /**
   * Put one down. `sessions` is a list of the connections standing on that world, which is how the
   * others are told; the one who placed it is told by the same message as everybody else, since what
   * they need to hear is the id the server gave it.
   */
  place(character, session, world, want, sessions = []) {
    const no = (why) => {
      this.refusals++;
      return { ok: false, why, tell: [{ to: session, msg: { t: 'homeNo', why } }] };
    };
    if (!character) return no('a character has to be claimed before it can own anything');
    if (typeof world !== 'string' || !world || world.length > WORLD_KEY) return no('there is nowhere to put it');
    if (this.rows.size >= this.tuning.rows) return no('this server is holding as many buildings as it can');
    if ((this.byWorld.get(world)?.size ?? 0) >= this.tuning.world) return no('this world is holding as many buildings as it can');
    if (this.ownedBy(character) >= this.tuning.mine) return no(`you already have ${this.tuning.mine} buildings standing, which is as many as one character may have`);
    const clash = this.overlapping(world, want.x, want.z, want.r);
    if (clash) return no('something is already standing there');
    const id = `h${this.seq++}`;
    const row = { id, owner: character, world, model: want.model, x: want.x, y: want.y, z: want.z, h: want.h, r: want.r, at: this.now() };
    this.adopt(row);
    this.write({ t: 'home', id, home: { owner: row.owner, world: row.world, model: row.model, x: row.x, y: row.y, z: row.z, h: row.h, r: row.r, at: row.at } });
    this.placed++;
    const msg = { t: 'homeUp', home: wireOf(row) };
    const tell = [{ to: session, msg }];
    for (const s of sessions) if (s !== session) tell.push({ to: s, msg });
    return { ok: true, id, tell };
  }

  /**
   * Take one away. Only whoever owns it, or the server's admin, may; and a house that is not there
   * is not an error, because a browser that pressed twice is being careful rather than wrong.
   */
  remove(character, session, id, sessions = [], admin = false) {
    const row = this.rows.get(id);
    if (!row) return { ok: true, tell: [{ to: session, msg: { t: 'homeDown', id } }] };
    if (row.owner !== character && !admin) {
      this.refusals++;
      const why = 'that is not yours to take down';
      return { ok: false, why, tell: [{ to: session, msg: { t: 'homeNo', why } }] };
    }
    this.forget(id, row);
    this.write({ t: 'homeGone', id });
    this.removed++;
    const msg = { t: 'homeDown', id };
    const tell = [{ to: session, msg }];
    for (const s of sessions) if (s !== session) tell.push({ to: s, msg });
    return { ok: true, tell };
  }

  /** Out of all three indexes at once, which is the only way a row ever leaves. */
  forget(id, row) {
    this.rows.delete(id);
    this.byWorld.get(row.world)?.delete(id);
    this.byOwner.get(row.owner)?.delete(id);
    if (this.byWorld.get(row.world)?.size === 0) this.byWorld.delete(row.world);
    if (this.byOwner.get(row.owner)?.size === 0) this.byOwner.delete(row.owner);
  }

  /** What the status page prints. */
  describe() {
    return { standing: this.rows.size, worlds: this.byWorld.size, owners: this.byOwner.size, placed: this.placed, removed: this.removed, refusals: this.refusals, tuning: this.tuning };
  }
}
