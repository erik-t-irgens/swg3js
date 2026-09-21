// The world's creatures as they cross between browsers: one browser thinks for each, and what it
// thinks reaches everyone else through here. Four words, checked and shaped the way `wire.mjs`,
// `combatWire.mjs`, `shipWire.mjs` and `vehicleWire.mjs` already check everything else the server is
// told -- a name matched against a class of characters and cut to length, a number checked finite
// and clamped, a word matched against a list, and anything that fails dropped rather than answered.
// A browser on another build can therefore neither grow one of these messages nor put anything
// unexpected through.
//
// What crosses is what the keeper decided, not what anybody measured: the server does not run
// brains, does not step physics and does not check that a creature could really have walked from
// where it was to where it says it is. That is the same trust model the shots between players are
// written under, and the line that matters is the same one: a browser can say where a creature
// stands, and it cannot take health off anything it does not keep. A blow arrives as a **claim**
// addressed to whoever keeps that creature, and the keeper is the only place a number comes off.
//
// Damage to a creature is deliberately not behind the server's `--friendly-fire` switch. That switch
// is about two *players* hurting each other; killing an animal is what the game does with no server
// at all, and gating it would make a peaceful world one where nothing can be hunted. The cap below
// is a bound on nonsense, not a rule about fighting.
//
// Dependency-free, shared by the server and by tools/swg/tests/npcWire.test.ts. The relay's own
// `npcState`, `npcHit` and `npcDrop` cases are what call it, and the browser's half is
// src/net/npcNet.ts.

/**
 * The caps. Every one of these is ours, invented for this pass and kept here together so there is
 * one place to read and one place to change them. None of them is from the game.
 */
export const NPC_WIRE = {
  /** How long a creature's id may be. It is made from the world, the admin who stood it and a count. */
  id: 64,
  /** How many creatures one batch may carry; a keeper with more sends the rest in the next batch. */
  rows: 64,
  /** How far from the middle of the world a point may be before it is nonsense, metres. */
  reach: 1e7,
  /** The fastest a creature may claim to be moving, metres a second (a speeder is 30). */
  speed: 200,
  /**
   * The most damage one blow may claim. As with a blow between players it is a bound on nonsense
   * rather than a rule: anything that may strike a creature at all may finish it.
   */
  damage: 100000,
  /** A word for what was struck, or what struck. */
  what: 16,
  /** How many creatures' last places the server keeps for one world, so a newcomer is told where things are. */
  remember: 4096,
};

/** What a creature may be doing: the game's own list of states (src/world/mobiles/types.ts). */
const STATES = ['loading', 'idle', 'wander', 'alert', 'chase', 'attack', 'flee', 'return', 'knockdown', 'dying', 'dead'];

/**
 * The things that must be seen once rather than eased into: it was struck, and it left the ground.
 *
 * A death is deliberately not one of them. It has a word of its own (the spawn list's `dead`, which
 * every browser hears from the server), a row is never sent for a creature that is already dead, and
 * a mark that nothing can produce is a rule nothing can reach: two ways to say one death is exactly
 * what this wave is written not to have.
 */
const MARKS = ['hit', 'leap'];

/** Why a creature is gone: it died, or it was taken away (an admin cleared it, or the world let it go). */
const WHYS = ['dead', 'gone'];

/**
 * What an id may be made of. Written as a class rather than as a length alone because what it names
 * is looked up in a map on every other browser: letters, digits and the few separators a made id
 * uses, and nothing else.
 */
const ID = /^[A-Za-z0-9_.:-]+$/;

/**
 * The characters a word may not carry: the control range and the delete character, matched by the
 * escapes for them and never by the bytes themselves, exactly as `combatWire.mjs` writes the same
 * class. The escapes are the point. A file holding a NUL byte is a binary file to git -- no usable
 * diff and no blame for the one module that checks everything coming off the wire -- and an editor
 * save, a lint autofix or an encoding pass can change what such a class means without showing a
 * change in the diff at all.
 */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** A finite number inside a range, or the fallback. */
function num(x, low, high, fallback = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(high, Math.max(low, n));
}

/** Three finite numbers, each inside the world's reach, or null. */
function point(x) {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const out = [Number(x[0]), Number(x[1]), Number(x[2])];
  if (out.some((v) => !Number.isFinite(v) || Math.abs(v) > NPC_WIRE.reach)) return null;
  return out;
}

/** A creature's id, or an empty string: it is a key on every other browser, so it is checked hard. */
export function npcId(x) {
  if (typeof x !== 'string' || !x || x.length > NPC_WIRE.id || !ID.test(x)) return '';
  return x;
}

/** A word, cut to length and stripped of anything that is not text. */
function word(x, max) {
  if (typeof x !== 'string' || !x) return '';
  return x.replace(CONTROL, '').slice(0, max);
}

/**
 * A cleaned copy of one creature's row, or undefined. It is everything another browser needs to
 * draw a creature it is not thinking for: where it stands, which way it faces, what it is doing,
 * how fast its feet are going, how much of it is left, and anything that has to be seen once.
 *
 * Health crosses as a share of the whole rather than as a number, exactly as a player's does: both
 * browsers stood the creature from the same record and so agree about how much a whole one is, and
 * a share cannot be made to mean "more than full" by a browser on another build.
 */
export function cleanNpcRow(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const i = npcId(x.i);
  const p = point(x.p);
  if (!i || !p) return undefined;
  const out = {
    i,
    p,
    h: num(x.h, -Math.PI * 4, Math.PI * 4, 0),
    s: STATES.includes(x.s) ? x.s : 'idle',
    v: num(x.v, 0, NPC_WIRE.speed, 0),
    hp: num(x.hp, 0, 1, 1),
  };
  if (MARKS.includes(x.f)) out.f = x.f;
  return out;
}

/**
 * A cleaned copy of a whole batch: at most `NPC_WIRE.rows` rows, each of them checked, with
 * anything that fails dropped and the rest passed on. A batch with nothing left in it is not a
 * message, so it comes back undefined rather than as an empty list nobody can do anything with.
 */
export function cleanNpcBatch(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || !Array.isArray(x.r)) return undefined;
  const rows = [];
  for (const raw of x.r) {
    if (rows.length >= NPC_WIRE.rows) break;
    const row = cleanNpcRow(raw);
    if (row) rows.push(row);
  }
  return rows.length ? { r: rows } : undefined;
}

/**
 * A cleaned copy of a blow asked of a keeper: which creature, how much, where, and a word for what
 * struck. Nothing here decides whether it lands -- the keeper does, on its own copy, with its own
 * rules about who may hurt what -- and nothing here subtracts anything.
 */
export function cleanNpcHit(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const i = npcId(x.i);
  if (!i) return undefined;
  const a = num(x.a, 0, NPC_WIRE.damage, 0);
  if (!(a > 0)) return undefined;
  const out = { i, a, at: point(x.at) ?? [0, 0, 0] };
  const w = word(x.w, NPC_WIRE.what);
  if (w) out.w = w;
  // Whether the player at that browser struck it themselves. It is the whole of what crosses about
  // who struck, and it is one flag rather than a name because a name would be a lie: the only thing
  // one browser can point at on another is that browser's own player. A creature of theirs, an NPC
  // fighter of theirs or a turret of theirs is nobody this side can name, and blaming the browser
  // for what its own wildlife did would turn the keeper's creature -- and its whole pack -- on a
  // player who did nothing. Unset, the blow lands with nobody to blame, which is the honest answer.
  if (x.b) out.b = 1;
  return out;
}

/**
 * A cleaned copy of a browser saying it cannot keep one: it has no body for that creature and cannot
 * build one (its catalogue does not know the species), or its model has still not landed. It is a
 * word and not a claim -- it asks for nothing but to be let go of -- so it carries the id alone.
 *
 * Without it a grant to a browser that cannot build the body is a creature frozen for everyone for
 * the life of the world: the browser is talking normally, so the server's own silence rule never
 * reaches it, and it is the nearest, so the next pass hands it straight back.
 */
export function cleanNpcDrop(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const i = npcId(x.i);
  return i ? { i } : undefined;
}

/**
 * A cleaned copy of a creature going: it died, or it was taken away. It is never dropped for being
 * behind, because there is no later message to put it right -- a browser that missed it would draw
 * a creature standing where it fell for as long as the world lasts.
 */
export function cleanNpcGone(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const i = npcId(x.i);
  if (!i) return undefined;
  return { i, why: WHYS.includes(x.why) ? x.why : 'gone' };
}

/**
 * The last place of every creature on every world, so that a browser arriving is told where things
 * are rather than waiting up to a quarter of a second for the first batch -- and so that a creature
 * nobody is near, which no keeper is sending rows for, is still somewhere rather than nowhere.
 *
 * It holds a picture and nothing else. Whether a creature exists at all, whose it is and whether it
 * is alive belong to the spawn list (`server/ownership.mjs`); this is the place that list's rows are
 * last known to have been at, and it is thrown away with the world it belongs to.
 */
export class NpcPlaces {
  constructor({ remember = NPC_WIRE.remember } = {}) {
    this.remember = remember;
    /** @type {Map<string, Map<string, object>>} world key to id to its last row */
    this.worlds = new Map();
    /** Rows dropped because one world was already holding as many as it may. */
    this.dropped = 0;
  }

  /** A keeper's batch, remembered. Rows are copied in place, so nothing here grows with the traffic. */
  note(key, rows) {
    if (!key || !rows?.length) return;
    let held = this.worlds.get(key);
    if (!held) {
      held = new Map();
      this.worlds.set(key, held);
    }
    for (const row of rows) {
      const had = held.get(row.i);
      if (had) {
        had.p = row.p;
        had.h = row.h;
        had.s = row.s;
        had.v = row.v;
        had.hp = row.hp;
        // A mark is a thing that happened once: it is not kept, or a newcomer would be told about a
        // blow struck before they arrived and would play it as though it had just landed.
        continue;
      }
      if (held.size >= this.remember) {
        this.dropped++;
        continue;
      }
      held.set(row.i, { i: row.i, p: row.p, h: row.h, s: row.s, v: row.v, hp: row.hp });
    }
  }

  /** A creature that died or was taken away is no longer anywhere. */
  gone(key, id) {
    this.worlds.get(key)?.delete(id);
  }

  /** Where everything on one world was last seen, as a batch's rows; an empty list when nothing is. */
  rows(key) {
    const held = this.worlds.get(key);
    if (!held?.size) return [];
    return [...held.values()];
  }

  /** Nobody is left on that world: what was remembered of it goes with them. */
  forget(key) {
    this.worlds.delete(key);
  }

  /** What to print on the status page. */
  describe() {
    let rows = 0;
    for (const held of this.worlds.values()) rows += held.size;
    return { worlds: this.worlds.size, rows, dropped: this.dropped };
  }
}
