// The props players have put down on a server's world: whose each one is, where it stands, and who is
// told about it.
//
// A prop put down with no server is this browser's own, kept per world in its storage
// (`src/world/propsPlaced.ts`). With a server that keeps them, a player's props are the server's: like
// the houses beside them (`homes.mjs`), everybody standing on that world sees every one of them, and
// only whoever put one down -- or the server's admin -- may move it or take it away. That is the owner's
// own word: a friend joining his server sees what he placed, and he sees what they place.
//
// **What the server decides and what it does not.** It has no terrain, and a prop's rules are not the
// ground's anyway: whether a thing is buried under the floor, swallowed by a wall or inside a quest's
// guarded yard is the placing browser's answer (`propPlace.ts`), and the place comes up the wire with
// the rest, exactly as a house's height does. What the server decides is what a second browser could
// disagree with -- how many there are, whose they are, and which one an id names. There is no overlap
// test: furniture may touch, and a chair pushed against a table is the point of a chair.
//
// Identity is the server's and never the browser's: ids are `p<n>`, the world's own counter, carried in
// the world file by the very records that write a row (`propSeq`, as the houses keep `houseSeq`), so a
// restart -- or a dropped newest row and a restart -- never hands one out again.
//
// What is the game's and what is ours: none of it is the game's. Every number below is invented, lives
// in `PROP_TUNING` with a line saying what it is for, is printed on the status page, and moves for a run
// with `--set prop.<name>=<n>`.
//
// How it is used, as `homes.mjs` is: nothing here touches a socket or a clock of its own. Every decision
// answers `{ ok, why, tell }`, `tell` a list of `{ to: <connection>, msg }` for the relay to fan out, and
// writing to the disk is one callback handed in, so the tests run all of it over a plain object.
//
// Dependency-free, and shared with tools/swg/tests/propsKept.test.ts.

/**
 * What a server's hail says when it keeps a player's props: 1. A browser hands a prop to the server only
 * when the hail says so, and keeps its props itself against any server that says nothing.
 */
export const PROPS_VERSION = 1;

/** Every number this file invents. None of them is from the game. */
export const PROP_TUNING = {
  /**
   * How many one character may have standing on one world: the browser's own cap for the props it
   * keeps itself (`PLACED_TUNE.most`), so a player's furniture is bounded the same way with or without
   * a server.
   */
  mine: 500,
  /** How many one world may hold, so a handful of players cannot fill a planet with crates. */
  world: 5000,
  /** How many this server holds at once. */
  rows: 100000,
  /** How many placing, moving or removing words one browser may send in a second. */
  perSecond: 8,
};

/** The shape of a prop id: what the props catalogue's own ids are made of, never parsed here. */
const MODEL = /^[A-Za-z0-9_.-]{1,96}$/;
/** The shape of a row id this server hands out, as a browser sends it back. */
const ID = /^[A-Za-z0-9_-]{1,40}$/;
/** The longest a world key may be; no pattern, for the reason `homes.mjs` gives. */
const WORLD_KEY = 128;
/** Names a key may not have: the three that mean something to every object in the language. */
const RESERVED = ['__proto__', 'constructor', 'prototype'];

/**
 * The farthest from a world's middle a prop may stand, metres. Wider than a house's: a prop may be put down out in
 * space as well as on the ground, and the made-up system of ours (`space_sandbox`) reaches 125 km either way.
 */
const PROP_REACH = 1000000;

/** A number that is really one, and within a world's own reach. */
function metres(x) {
  return typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= PROP_REACH ? Math.round(x * 100) / 100 : undefined;
}

/**
 * What a browser is told when a word about a prop is not acted on, in the server's own words. A move or a removal
 * is never refused in silence: the browser that sent it has already taken that prop down in its own world, and
 * stands it again only on hearing back, so a word dropped without an answer would leave it gone from that screen
 * while it stands on every other.
 */
export const PROP_SAYS = {
  nowhere: 'there is nowhere to put it',
  tooFast: 'that was more than the server takes in a second: wait a moment and try again',
  unread: 'the server could not read that',
};

/** The row a word names, when it is a move or a removal naming one this server could have handed out, else undefined. */
function rowOf(msg) {
  if (!msg || typeof msg !== 'object' || (msg.t !== 'moveProp' && msg.t !== 'removeProp')) return undefined;
  return typeof msg.id === 'string' && ID.test(msg.id) && !RESERVED.includes(msg.id) ? msg.id : undefined;
}

/** The refusal a word gets: `propNo` with the server's words, naming the row a move or a removal was about. */
export function propRefusal(msg, why) {
  const id = rowOf(msg);
  return { t: 'propNo', why, ...(id ? { id } : {}) };
}

/**
 * A turn, three's order (`[x, y, z, w]`), as four finite numbers made whole again, or undefined. A turn of
 * no length says nothing about which way a thing faces and is not one.
 */
function turn(q) {
  if (!Array.isArray(q) || q.length !== 4) return undefined;
  if (!q.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 2)) return undefined;
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(len > 1e-6)) return undefined;
  return q.map((v) => Math.round((v / len) * 1e6) / 1e6);
}

/** Where a word puts a prop: its place, its turn and whether it stands in a room, or undefined. */
function placeOf(x) {
  const px = metres(x.x);
  const py = metres(x.y);
  const pz = metres(x.z);
  if (px === undefined || py === undefined || pz === undefined) return undefined;
  const q = turn(x.q);
  if (!q) return undefined;
  return { x: px, y: py, z: pz, q, inside: x.inside === true };
}

/**
 * A cleaned copy of a `placeProp`, or undefined when it is not one. Unlike a house's word, one that fails is
 * answered (`PropsKept.refuse`): see `PROP_SAYS`.
 */
export function cleanPropPlace(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.prop !== 'string' || !MODEL.test(x.prop) || RESERVED.includes(x.prop)) return undefined;
  const at = placeOf(x);
  return at ? { prop: x.prop, ...at } : undefined;
}

/** A cleaned copy of a `moveProp` (which one, and where it goes now), or undefined. */
export function cleanPropMove(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.id !== 'string' || !ID.test(x.id) || RESERVED.includes(x.id)) return undefined;
  const at = placeOf(x);
  return at ? { id: x.id, ...at } : undefined;
}

/** A cleaned copy of a `removeProp`, or undefined. */
export function cleanPropRemove(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.id !== 'string' || !ID.test(x.id) || RESERVED.includes(x.id)) return undefined;
  return { id: x.id };
}

/**
 * Whether this browser may send another word about a prop this second: the homes' own window, written
 * in place so asking allocates nothing, with an allowance of its own. A word over it is answered rather
 * than dropped in silence (`PropsKept.tooFast`).
 */
export function mayProp(window, now, tuning = PROP_TUNING) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= tuning.perSecond;
}

/**
 * Apply one change about a prop to the world in memory. The same function runs when a prop is put down
 * and when the log is replayed on start, so a replayed world and a live one cannot drift apart. Returns
 * true when the record was understood; anything else is a record from a newer server, kept in the log and
 * not understood here, which is not an error.
 */
export function applyProps(data, rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.t === 'prop') {
    if (typeof rec.id !== 'string' || !rec.id || RESERVED.includes(rec.id)) return false;
    if (!rec.prop || typeof rec.prop !== 'object') return false;
    data.props ??= Object.create(null);
    data.props[rec.id] = { ...data.props[rec.id], ...rec.prop, id: rec.id };
    // The counter is carried past every id a record writes, so a restart never hands out one it has used,
    // even one whose row has since been taken away.
    if (/^p[0-9]+$/.test(rec.id)) {
      const n = Number(rec.id.slice(1));
      if (Number.isFinite(n) && n >= (data.propSeq ?? 0)) data.propSeq = n + 1;
    }
    return true;
  }
  if (rec.t === 'propGone') {
    if (typeof rec.id !== 'string' || !rec.id) return false;
    if (data.props) delete data.props[rec.id];
    return true;
  }
  return false;
}

/** What goes over the wire for one prop: everything a browser needs to stand it and nothing else. */
function wireOf(r) {
  return { id: r.id, owner: r.owner, prop: r.prop, x: r.x, y: r.y, z: r.z, q: r.q, ...(r.inside ? { inside: true } : {}), at: r.at };
}

export class PropsKept {
  /**
   * @param {{ now?: () => number, tuning?: Record<string, number>,
   *           write?: (rec: object) => void }} options the clock to read so a test can hand in its
   * own, the numbers to work to, and where a change goes to be written down.
   */
  constructor({ now = () => Date.now(), tuning = PROP_TUNING, write = () => {} } = {}) {
    this.now = now;
    this.tuning = tuning;
    this.write = write;
    /** @type {Map<string, object>} every prop standing, by its id */
    this.rows = new Map();
    /** @type {Map<string, Set<string>>} world key to the ids standing on it */
    this.byWorld = new Map();
    /** @type {Map<string, Set<string>>} character to the ids it owns, every world */
    this.byOwner = new Map();
    /** The next id, which a load carries forward so a restart never repeats one. */
    this.seq = 1;
    this.placed = 0;
    this.moved = 0;
    this.removed = 0;
    this.refusals = 0;
  }

  /** Take the world the store read back. Called once, before anybody is connected. */
  load(data) {
    for (const id of Object.keys(data?.props ?? {})) {
      const row = data.props[id];
      if (row && typeof row === 'object') this.adopt({ ...row, id });
    }
    if (Number.isFinite(data?.propSeq)) this.seq = Math.max(this.seq, data.propSeq);
  }

  /** Put a row into the three indexes; `load` and a placing are the only callers, so there is one such place. */
  adopt(row) {
    this.rows.set(row.id, row);
    const w = this.byWorld.get(row.world) ?? new Set();
    w.add(row.id);
    this.byWorld.set(row.world, w);
    const o = this.byOwner.get(row.owner) ?? new Set();
    o.add(row.id);
    this.byOwner.set(row.owner, o);
  }

  /** How many one character has standing on one world, for the cap. */
  ownedOn(character, world) {
    let n = 0;
    for (const id of this.byOwner.get(character) ?? []) if (this.rows.get(id)?.world === world) n++;
    return n;
  }

  /** The props standing on one world, as they go over the wire. */
  forWorld(world) {
    const out = [];
    for (const id of this.byWorld.get(world) ?? []) {
      const row = this.rows.get(id);
      if (row) out.push(wireOf(row));
    }
    return out;
  }

  /** Everybody on the world told the same word, the one who asked first. */
  everyone(session, sessions, msg) {
    const tell = [{ to: session, msg }];
    for (const s of sessions) if (s !== session) tell.push({ to: s, msg });
    return tell;
  }

  /** A refusal, to the one who asked and to nobody else, naming the row when it is about one (a move, a removal). */
  no(session, why, id) {
    this.refusals++;
    return { ok: false, why, tell: [{ to: session, msg: { t: 'propNo', why, ...(id ? { id } : {}) } }] };
  }

  /** A word not acted on before it reached the rules (nowhere to put it, or not readable), answered all the same. */
  refuse(session, msg, why) {
    this.refusals++;
    return { ok: false, why, tell: [{ to: session, msg: propRefusal(msg, why) }] };
  }

  /**
   * A word over this browser's allowance for the second (`mayProp` said no, so `window.lines` is past it). A move
   * or a removal is answered every time, naming its row; a placing only the first time in the window, since
   * nothing of it stood anywhere and one word says what all of them need to hear.
   */
  tooFast(session, msg, window) {
    const no = propRefusal(msg, PROP_SAYS.tooFast);
    if (!no.id && window.lines !== this.tuning.perSecond + 1) return { ok: false, why: PROP_SAYS.tooFast, tell: [] };
    this.refusals++;
    return { ok: false, why: PROP_SAYS.tooFast, tell: [{ to: session, msg: no }] };
  }

  /**
   * Put one down. `sessions` is the connections standing on that world, which is how the others are
   * told; the one who placed it is told by the same word, since what it needs to hear is the id the
   * server gave it.
   */
  place(character, session, world, want, sessions = []) {
    if (!character) return this.no(session, 'a character has to be claimed before it can own anything');
    if (typeof world !== 'string' || !world || world.length > WORLD_KEY) return this.no(session, 'there is nowhere to put it');
    if (this.rows.size >= this.tuning.rows) return this.no(session, 'this server is holding as many things as it can');
    if ((this.byWorld.get(world)?.size ?? 0) >= this.tuning.world) return this.no(session, 'this world is holding as many things as it can');
    if (this.ownedOn(character, world) >= this.tuning.mine) return this.no(session, `${this.tuning.mine} things is as many as one world will hold of yours`);
    const id = `p${this.seq++}`;
    const row = { id, owner: character, world, prop: want.prop, x: want.x, y: want.y, z: want.z, q: want.q, ...(want.inside ? { inside: true } : {}), at: this.now() };
    this.adopt(row);
    this.write({ t: 'prop', id, prop: { owner: row.owner, world: row.world, prop: row.prop, x: row.x, y: row.y, z: row.z, q: row.q, inside: !!want.inside, at: row.at } });
    this.placed++;
    return { ok: true, id, tell: this.everyone(session, sessions, { t: 'propUp', prop: wireOf(row) }) };
  }

  /**
   * Move one: picked back up and put down somewhere else on the same world, by whoever owns it or the
   * server's admin. A prop that is not there any more is not an error: the one who asked is told it is
   * down, which is what they need to know to stop holding its place.
   */
  move(character, session, world, id, want, sessions = [], admin = false) {
    const row = this.rows.get(id);
    if (!row) return { ok: true, tell: [{ to: session, msg: { t: 'propDown', id } }] };
    if (row.owner !== character && !admin) return this.no(session, 'that is not yours to move', id);
    if (row.world !== world) return this.no(session, 'that stands on another world', id);
    row.x = want.x;
    row.y = want.y;
    row.z = want.z;
    row.q = want.q;
    if (want.inside) row.inside = true;
    else delete row.inside;
    row.at = this.now();
    this.write({ t: 'prop', id, prop: { x: row.x, y: row.y, z: row.z, q: row.q, inside: !!want.inside, at: row.at } });
    this.moved++;
    return { ok: true, tell: this.everyone(session, sessions, { t: 'propMoved', prop: wireOf(row) }) };
  }

  /**
   * Take one away, by whoever owns it or the server's admin; one that is not there is not an error,
   * because a browser that pressed twice is being careful rather than wrong.
   */
  remove(character, session, id, sessions = [], admin = false) {
    const row = this.rows.get(id);
    if (!row) return { ok: true, tell: [{ to: session, msg: { t: 'propDown', id } }] };
    if (row.owner !== character && !admin) return this.no(session, 'that is not yours to take away', id);
    this.forget(id, row);
    this.write({ t: 'propGone', id });
    this.removed++;
    return { ok: true, tell: this.everyone(session, sessions, { t: 'propDown', id }) };
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
    return { standing: this.rows.size, worlds: this.byWorld.size, owners: this.byOwner.size, placed: this.placed, moved: this.moved, removed: this.removed, refusals: this.refusals, tuning: this.tuning };
  }
}
