// Who thinks for a creature, and how it is handed over.
//
// The world's automatic wildlife is switched off: nothing appears on its own, ever. What stands in a
// world is what an admin stood there by hand, and what an admin stands is the world's -- everyone
// connected is told about it, one browser thinks for it, and it is handed between browsers as people
// walk about. This file holds both halves of that: the list of what has been stood, and the rule that
// says whose browser is keeping each of them this half-second.
//
// The rule, in words. A creature is kept by the nearest player within 180 m of it, and by nobody at
// all when there is no such player: it simply stands where it was until somebody comes back, because
// keeping one means really building it -- a model, a pack of clips, `prepareActor`, a body -- and
// nothing should pay that for an animal nobody can see. It changes hands only when a challenger has
// been a quarter nearer than the keeper for three seconds together, so two players walking either
// side of one do not pass it back and forth; two players the same distance away never move it at all.
// A keeper whose line closes, or that has said nothing for a minute (a tab put to sleep says so
// outright), loses everything it kept at once and the server picks again. Nothing is ever kept by two
// browsers: the keeper is one field, the server's answer is the only truth, and a browser that was
// not granted a creature never thinks for it.
//
// What is the game's and what is ours: none of this is the game's. The ranges, the patiences and the
// caps are all invented -- the 180 m and the quarter-for-three-seconds are the design's -- and every
// one of them is in `OWN_TUNING` with a line saying what it is for. The server prints them on its
// status page and `--set own.<name>=<n>` moves one for a run.
//
// How it is used. Nothing in here touches a socket or a clock of its own. The relay says where each
// browser is (`here`), when one goes (`gone`), and calls `tick` twice a second; everything that
// decides something answers `{ ok, why, tell }`, where `tell` is a list of `{ to: <connection>, msg }`
// for the relay to fan out, exactly as the duels do. Which browsers hear about a spawn is the relay's
// business, not this file's: it knows who is on which world and this does not.
//
// Dependency-free, and shared with tools/swg/tests/ownership.test.ts.

import { WIRE, cleanWord } from './wire.mjs';

/**
 * Every number this file invents, in one place. None of them is from the game. The first four are the
 * design's; the rest are caps chosen here because something had to be chosen.
 */
export const OWN_TUNING = {
  /**
   * How near a player must be to keep a creature, in metres. A creature nobody is within this of is
   * kept by nobody and is simulated by nobody: it stands where it was.
   */
  range: 180,
  /** How much nearer a challenger must be than the keeper, as a share: a quarter nearer. */
  nearer: 0.25,
  /** How long it must stay that much nearer before the creature changes hands, in ms. */
  steady: 3000,
  /** How often the keepers are worked out and the grants go out, in ms: twice a second. */
  grant: 500,
  /**
   * How long a browser may say nothing before whatever it was keeping is taken off it, in ms. A tab
   * put to sleep says so outright and is taken at once; this is the backstop for one that does not.
   */
  silence: 60000,
  /**
   * How long after a creature has been taken off a browser that browser's word about it is still
   * taken, in ms. It is for one thing only: a death. A keeper drops a creature to nothing and says so
   * in the same breath, and the grants go out twice a second, so the two can cross -- the word arrives
   * a moment after the creature has been handed to somebody else, and with no grace at all the kill
   * would simply be dropped and the creature stood back up whole by whoever took it. Nothing else a
   * browser can say is taken inside it: it cannot move, hurt or take down what it no longer keeps.
   */
  grace: 5000,
  /** How many creatures one world may hold at once. */
  world: 200,
  /** How many creatures the whole server may hold at once, the dead among them. */
  total: 2000,
  /** How many spawn words one browser may send in a second. */
  'spawn.perSecond': 8,
  /** How many ids go in one grant message before the rest go in another. */
  ids: 64,
  /** How far from a world's middle a creature may be stood, in metres. No world is anywhere near this wide. */
  limit: 10000000,
  /**
   * How long a browser that has said it cannot keep a creature is not offered that one again, in ms
   * -- the same clock every other number here is on. Without a wait the next pass hands it straight
   * back (it is still the nearest) and the creature spends the life of the world frozen between two
   * messages a second. Ours, invented with the word itself.
   */
  refusal: 120000,
};

/** What a browser may ask about the list. `clear` takes down everything in the world it is on. */
const DOES = ['add', 'remove', 'dead', 'clear'];
/**
 * An id the browser proposes for a creature it is asking to have stood. It is worked out from the
 * world, the spawner and a counter, so two browsers never mint the same one; it is taken here only
 * when it is free, and the server mints its own when it is not.
 */
const ID = /^[A-Za-z0-9_.:-]{1,48}$/;
/**
 * Names an id may not have. An id is a key in the tables below, and these three mean something to
 * every object in the language rather than being a key. The same belt wire.mjs wears.
 */
const RESERVED = ['__proto__', 'constructor', 'prototype'];

/** A finite number inside a range, or the fallback. */
function num(x, low, high, fallback = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(high, Math.max(low, n));
}

/** Three finite numbers, each inside the world's reach, or null. */
function point(x, limit) {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const out = [Number(x[0]), Number(x[1]), Number(x[2])];
  if (out.some((v) => !Number.isFinite(v) || Math.abs(v) > limit)) return null;
  return out;
}

/** An id a browser proposed, or '' when it is not one this server would use as a key. */
export function cleanId(x) {
  if (typeof x !== 'string' || !ID.test(x) || RESERVED.includes(x)) return '';
  return x;
}

/**
 * A cleaned copy of a `spawn`, or undefined when it is not one: what the admin is asking for, and
 * what it is asking about. Anything that fails is dropped and never answered, as everywhere else.
 */
export function cleanSpawn(x, tuning = OWN_TUNING) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.do !== 'string' || !DOES.includes(x.do)) return undefined;
  if (x.do === 'clear') return { do: 'clear' };
  if (x.do === 'remove' || x.do === 'dead') {
    const id = cleanId(x.id);
    if (!id) return undefined;
    return { do: x.do, id };
  }
  const species = cleanWord(x.species, '', WIRE.word);
  const at = point(x.at, tuning.limit);
  if (!species || !at) return undefined;
  const out = { do: 'add', species, at, h: num(x.h, -Math.PI * 2, Math.PI * 2, 0), seed: 0 };
  // Whether it was stood in a building's rooms. It decides the creature's cell and its collider
  // filter on every browser, and it is the one thing about a spawn that cannot be worked out again
  // from the place: rooms overhang their hull and a point inside one is often outdoors.
  if (x.inside) out.inside = true;
  const seed = Number(x.seed);
  if (Number.isFinite(seed) && seed >= 0) out.seed = Math.floor(seed) >>> 0;
  const id = cleanId(x.id);
  if (id) out.id = id;
  return out;
}

/**
 * A cleaned copy of a `keep`, which is the one thing a browser says about keeping: whether it is
 * awake. A tab put to sleep stops drawing frames and stops sending anything at all, so it says so on
 * its way out rather than being found a minute later by the silence above.
 */
export function cleanKeep(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (x.do !== 'awake') return undefined;
  return { do: 'awake', a: x.a === 0 || x.a === false ? 0 : 1 };
}

/**
 * Whether this browser may send another spawn word this second. The window is the shape the group's
 * own limits use: a second's worth counted, and a new second starts the count again. The caller's own
 * little record is written in place, so nothing is allocated to ask.
 */
export function maySpawn(window, now, tuning = OWN_TUNING) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= tuning['spawn.perSecond'];
}

/**
 * One creature's line as every browser is sent it: what to stand, where, and what it rolls from --
 * and, once anybody has said so, how much of it is left, as a share of a whole one. The share is
 * there so that a browser handed a creature it has never seen does not stand it up whole: the spawn
 * list is what a newcomer builds from, and a creature that has been fought is not the creature that
 * was stood. It is left out of the line entirely until a keeper has said something about it, so a
 * browser reading the list can tell "nobody has said" from "it is full".
 */
function rowOf(c) {
  const row = { id: c.id, world: c.world, species: c.species, at: c.at, h: c.h, seed: c.seed };
  // Stood in a building's rooms: it is the one thing about a spawn that cannot be worked out again
  // from the place, and without it a creature an admin stood in a cantina comes back outdoors on
  // every browser, the admin's own included.
  if (c.inside) row.inside = true;
  if (c.hp >= 0) row.hp = c.hp;
  return row;
}

export class Ownership {
  /**
   * @param {{ now?: () => number, tuning?: Record<string, number> }} options the clock to read, so a
   * test can hand in its own and step it, and the numbers to work to.
   */
  constructor({ now = () => Date.now(), tuning = OWN_TUNING } = {}) {
    this.now = now;
    this.tuning = tuning;
    /** @type {Map<string, object>} id to the creature: where it is, who stood it, and who keeps it */
    this.creatures = new Map();
    /** @type {Map<string, Set<string>>} world key to the ids standing in it */
    this.byWorld = new Map();
    /** @type {Map<number, object>} connection to where that browser is and when it last said so */
    this.people = new Map();
    this.nextId = 1;
    /** How many times a creature has changed hands, for the status page. */
    this.handovers = 0;
    /**
     * Creatures taken out of the tables whose keeper has not been told to let go yet, as
     * `{ session, id }`. A row is gone from `creatures` the moment an admin takes it down, so the
     * pass below cannot find it to say so -- and a keeper nobody tells is a browser left running a
     * brain for something that is not there. They are folded into the next pass's grants, which is
     * the same breath everything else about keeping goes out in.
     * @type {{ session: number, id: string }[]}
     */
    this.pending = [];
  }

  // -- where the browsers are -----------------------------------------------------------------------

  /**
   * Where a browser is now. It is called with every state that arrives, which is also what says the
   * browser is alive: a tab that has stopped drawing has stopped sending, and the silence above is
   * what takes its creatures off it.
   */
  here(session, world, p) {
    let person = this.people.get(session);
    if (!person) {
      person = { session, world: '', x: 0, y: 0, z: 0, seen: 0, awake: true, placed: false };
      this.people.set(session, person);
    }
    const key = world ?? '';
    // A browser that has arrived on a world but not yet said where it is standing on it is nowhere:
    // the place it last sent belongs to the world it came from, and taken for this one it would make
    // it the nearest thing to whatever happens to stand at those metres here.
    if (key !== person.world) {
      person.world = key;
      person.placed = false;
    }
    if (Array.isArray(p) && p.length === 3) {
      person.x = Number(p[0]) || 0;
      person.y = Number(p[1]) || 0;
      person.z = Number(p[2]) || 0;
      person.placed = true;
    }
    person.seen = this.now();
    return person;
  }

  /** A browser saying it has been put to sleep, or woken. Asleep, it keeps nothing. */
  awake(session, on) {
    const person = this.people.get(session);
    if (!person) return { ok: false, why: 'nobody there', tell: [] };
    person.awake = !!on;
    person.seen = this.now();
    return { ok: true, tell: this.assign() };
  }

  /**
   * A line closed. Whatever that browser kept is taken off it at once and the server picks again;
   * the creatures themselves stay, because they belong to the world and not to anybody in it.
   */
  gone(session) {
    this.people.delete(session);
    for (const c of this.creatures.values()) if (c.keeper === session) this.release(c);
    return { ok: true, tell: this.assign() };
  }

  // -- the list -------------------------------------------------------------------------------------

  /**
   * Stand a creature. The id the browser proposed is taken when it is free, so the browser that asked
   * can recognise its own; otherwise one is minted here. Nothing is stood twice under one id.
   */
  spawn({ world = '', species = '', at = [0, 0, 0], h = 0, seed = 0, by = '', id = '', inside = false } = {}) {
    if (!species) return { ok: false, why: 'nothing to stand', tell: [] };
    if (this.creatures.size >= this.tuning.total) this.pruneDead();
    if (this.creatures.size >= this.tuning.total) return { ok: false, why: 'this server is holding as many creatures as it can', tell: [] };
    const inWorld = this.byWorld.get(world);
    if (inWorld && inWorld.size >= this.tuning.world) return { ok: false, why: `a world holds ${this.tuning.world} of these`, tell: [] };
    let key = cleanId(id);
    if (!key || this.creatures.has(key)) key = this.mint();
    const c = {
      id: key,
      world,
      species,
      at: [Number(at[0]) || 0, Number(at[1]) || 0, Number(at[2]) || 0],
      h: Number(h) || 0,
      seed: Number(seed) >>> 0,
      // Stood in a building's rooms rather than on the ground: carried with the rest so that every
      // browser, the one that asked included, stands it in the room the admin stood it in.
      inside: !!inside,
      by,
      born: this.now(),
      dead: 0,
      keeper: 0,
      since: 0,
      rival: 0,
      rivalAt: 0,
      // Who kept it last and when they stopped: a death is a keeper's word and the grants go out
      // twice a second, so a word about one can arrive a moment after it has changed hands.
      lastKeeper: 0,
      lastKeeperAt: 0,
      // How much of it is left, as a share of a whole one. -1 until a keeper has said.
      hp: -1,
    };
    this.creatures.set(key, c);
    this.world(world).add(key);
    return { ok: true, row: rowOf(c), tell: this.assign() };
  }

  /** Take one down: the admin's doing, and it is gone rather than dead. */
  remove(id) {
    const c = this.creatures.get(id);
    if (!c) return { ok: false, why: 'there is nothing there', tell: [] };
    this.forget(c);
    return { ok: true, row: rowOf(c), world: c.world, tell: this.assign() };
  }

  /**
   * One died. The row is kept rather than forgotten, and kept dead: a death happens once and stays,
   * so a creature that changes hands after it cannot be stood again by the browser that takes it.
   */
  died(id) {
    const c = this.creatures.get(id);
    if (!c || c.dead) return { ok: false, why: 'there is nothing there to die', tell: [] };
    c.dead = this.now();
    // The grant is not taken back here but in the pass below, so that whoever was keeping it is told
    // to let go in the same breath -- which is what makes a death in the middle of a hand-over safe:
    // the challenge goes with it and the browser that was about to take it over never does.
    const inWorld = this.byWorld.get(c.world);
    if (inWorld) {
      inWorld.delete(c.id);
      if (!inWorld.size) this.byWorld.delete(c.world);
    }
    return { ok: true, row: rowOf(c), world: c.world, tell: this.assign() };
  }

  /** Take down everything standing in one world. */
  clearWorld(world) {
    const ids = [...(this.byWorld.get(world) ?? [])];
    for (const id of ids) {
      const c = this.creatures.get(id);
      if (c) this.forget(c);
    }
    return { ok: true, ids, tell: this.assign() };
  }

  /** What is standing in a world, as a browser arriving there is sent it. The dead are not in it. */
  listFor(world) {
    const out = [];
    for (const id of this.byWorld.get(world) ?? []) {
      const c = this.creatures.get(id);
      if (c && !c.dead) out.push(rowOf(c));
    }
    return out;
  }

  /** Whether a creature is there and alive; what a batch from a keeper is checked against. */
  alive(id) {
    const c = this.creatures.get(id);
    return !!c && !c.dead;
  }

  /** The world a creature stands in, or ''. */
  worldOf(id) {
    return this.creatures.get(id)?.world ?? '';
  }

  /** Who keeps a creature, or 0. The server's answer, and the only one. */
  keeperOf(id) {
    return this.creatures.get(id)?.keeper ?? 0;
  }

  /** Whether that browser is the one keeping it: what a batch and a blow are held to. */
  keeps(session, id) {
    const c = this.creatures.get(id);
    return !!c && !c.dead && c.keeper === session;
  }

  /**
   * Whether that browser's word that this creature has died is taken. It is the keeper's word, and
   * the keeper's a moment ago as well: a browser drops one to nothing and says so in the same breath,
   * the grants go out twice a second, and the two cross often enough that "the keeper this instant"
   * would lose kills -- and a lost kill is a creature the player watched fall standing up again in
   * whoever's hands it landed in. Nothing else is taken inside the grace: a browser cannot move, hurt
   * or take down what it no longer keeps, only finish what it had already finished.
   */
  mayKill(session, id) {
    if (!session) return false;
    const c = this.creatures.get(id);
    if (!c || c.dead) return false;
    if (c.keeper === session) return true;
    return c.lastKeeper === session && this.now() - c.lastKeeperAt < this.tuning.grace;
  }

  /**
   * How much of a creature is left, as a share of a whole one, said by whoever is keeping it. It is
   * held so that the list a browser is handed on arriving carries it: a creature that has been fought
   * and then changes hands, or is built for the first time by somebody who has just walked up, must
   * not be stood up whole. Anything from a browser that is not the keeper is ignored.
   */
  health(session, id, share) {
    const c = this.creatures.get(id);
    if (!c || c.dead || c.keeper !== session) return false;
    const n = Number(share);
    if (!Number.isFinite(n)) return false;
    c.hp = Math.min(1, Math.max(0, n));
    return true;
  }

  /** How many a browser keeps, for the status page. */
  keptBy(session) {
    let n = 0;
    for (const c of this.creatures.values()) if (c.keeper === session) n++;
    return n;
  }

  // -- the clock ------------------------------------------------------------------------------------

  /**
   * Work the keepers out and send what changed. Called twice a second by the relay, which is what
   * makes "grants go out at most twice a second" true without anything here counting.
   */
  tick() {
    return { ok: true, tell: this.assign() };
  }

  // -- the pieces the above is made of ---------------------------------------------------------------

  /** The set of ids in a world, made if it is not there yet. */
  world(key) {
    let set = this.byWorld.get(key);
    if (!set) {
      set = new Set();
      this.byWorld.set(key, set);
    }
    return set;
  }

  /** A fresh id for a creature nobody proposed a usable one for. */
  mint() {
    let key = `k${this.nextId++}`;
    while (this.creatures.has(key)) key = `k${this.nextId++}`;
    return key;
  }

  /**
   * Nobody keeps this now, and nobody is challenging for it. Who had it is remembered with the
   * moment they lost it, which is what `mayKill` above reads: the word about a creature and the
   * grant that takes it away cross on the wire often enough that it has to be.
   */
  release(c) {
    if (c.keeper) {
      c.lastKeeper = c.keeper;
      c.lastKeeperAt = this.now();
    }
    c.keeper = 0;
    c.since = 0;
    c.rival = 0;
    c.rivalAt = 0;
  }

  /**
   * Out of the tables altogether: an admin took it down. Whoever was keeping it is put on the list
   * the next pass tells to let go -- the row is gone by then, so the pass itself could never find it,
   * and a keeper nobody tells goes on running a brain for something that is not there.
   */
  forget(c) {
    if (c.keeper) this.pending.push({ session: c.keeper, id: c.id });
    this.release(c);
    this.creatures.delete(c.id);
    const inWorld = this.byWorld.get(c.world);
    if (inWorld) {
      inWorld.delete(c.id);
      if (!inWorld.size) this.byWorld.delete(c.world);
    }
  }

  /**
   * A browser saying it cannot keep one: it has no body for that creature and cannot build one, or
   * its model never landed. The grant goes back at once and that browser is not offered this
   * creature again for `refusal`. It is a word about one browser and one creature and nothing else:
   * everybody else still gets it, and this browser still gets everything else.
   */
  refuse(session, id) {
    const c = this.creatures.get(id);
    if (!c) return { ok: false, why: 'there is nothing there', tell: [] };
    if (!c.refused) c.refused = new Map();
    c.refused.set(session, this.now());
    if (c.keeper === session) this.release(c);
    return { ok: true, tell: this.assign() };
  }

  /** Room for another: the oldest deaths go first, and only ever the dead. */
  pruneDead() {
    const dead = [];
    for (const c of this.creatures.values()) if (c.dead) dead.push(c);
    dead.sort((a, b) => a.dead - b.dead);
    for (let i = 0; i < dead.length && this.creatures.size >= this.tuning.total; i++) this.creatures.delete(dead[i].id);
  }

  /** Whether a browser can keep anything at all just now: here, placed, awake, and not silent. */
  keen(person, now) {
    if (!person || !person.awake || !person.placed) return false;
    return now - person.seen < this.tuning.silence;
  }

  /**
   * The whole rule, run over every creature: who is nearest, whether a challenger has been near
   * enough for long enough, and what that means for the grants going out. Every change is collected
   * per browser and sent as one `keep { add, drop }`, so a hundred creatures changing hands at once
   * is two messages and not two hundred.
   */
  assign() {
    const now = this.now();
    /** @type {Map<number, { add: string[], drop: string[] }>} */
    const moves = new Map();
    const note = (session, which, id) => {
      if (!session) return;
      let m = moves.get(session);
      if (!m) {
        m = { add: [], drop: [] };
        moves.set(session, m);
      }
      m[which].push(id);
    };
    // The ones an admin took down since the last pass. They are gone from the table below, so this
    // is the only place their keeper can be told, and it is the same message everything else goes in.
    for (const p of this.pending) note(p.session, 'drop', p.id);
    this.pending.length = 0;
    for (const c of this.creatures.values()) {
      if (c.dead) {
        if (c.keeper) {
          note(c.keeper, 'drop', c.id);
          this.release(c);
        }
        continue;
      }
      let best = 0;
      let bestAway = Infinity;
      let keeperAway = Infinity;
      for (const person of this.people.values()) {
        if (person.world !== c.world || !this.keen(person, now)) continue;
        // One this browser has already said it cannot keep is not offered to it again for a while;
        // somebody else takes it, and if nobody can it simply stands where it is, which is what it
        // was doing anyway and is at least the same on every screen.
        const refusedAt = c.refused ? c.refused.get(person.session) : undefined;
        if (refusedAt !== undefined && now - refusedAt < this.tuning.refusal) continue;
        const away = Math.hypot(person.x - c.at[0], person.y - c.at[1], person.z - c.at[2]);
        if (away > this.tuning.range) continue;
        if (person.session === c.keeper) keeperAway = away;
        if (away < bestAway) {
          bestAway = away;
          best = person.session;
        }
      }
      // The keeper has gone, fallen silent, gone to sleep or walked out of range: it is taken off at
      // once and whoever is nearest, if anybody is, has it from now.
      if (c.keeper && !(keeperAway <= this.tuning.range)) {
        note(c.keeper, 'drop', c.id);
        this.release(c);
      }
      if (!c.keeper) {
        if (best) {
          c.keeper = best;
          c.since = now;
          c.rival = 0;
          c.rivalAt = 0;
          note(best, 'add', c.id);
        }
        continue;
      }
      // Somebody is nearer. It only means anything when they are a quarter nearer, and only when
      // they have been for three seconds together: two players walking either side of one creature
      // would otherwise pass it back and forth all the way down the street, and two the same
      // distance away would never let go of it at all.
      if (best && best !== c.keeper && bestAway <= keeperAway * (1 - this.tuning.nearer)) {
        if (c.rival !== best) {
          c.rival = best;
          c.rivalAt = now;
        }
        if (now - c.rivalAt >= this.tuning.steady) {
          note(c.keeper, 'drop', c.id);
          note(best, 'add', c.id);
          // Who had it, and when they stopped: a death they had already decided on is still theirs
          // to say for a moment after this, which is the one thing that crosses on the wire here.
          c.lastKeeper = c.keeper;
          c.lastKeeperAt = now;
          c.keeper = best;
          c.since = now;
          c.rival = 0;
          c.rivalAt = 0;
          this.handovers++;
        }
      } else if (c.rival) {
        c.rival = 0;
        c.rivalAt = 0;
      }
    }
    const tell = [];
    const cap = this.tuning.ids;
    for (const [session, m] of moves) {
      // Cut into messages of a size rather than sent whole: a browser arriving beside a crowd of
      // them would otherwise be handed one message with every id in the world in it.
      for (let i = 0; i < Math.max(m.add.length, m.drop.length); i += cap) {
        const add = m.add.slice(i, i + cap);
        const drop = m.drop.slice(i, i + cap);
        if (!add.length && !drop.length) continue;
        tell.push({ to: session, msg: { t: 'keep', add, drop } });
      }
    }
    return tell;
  }

  /** What to print on the status page: how many are standing, how many are kept, and by how many. */
  describe() {
    if (!this.creatures.size) return 'nothing stood';
    let alive = 0;
    let kept = 0;
    const keepers = new Set();
    for (const c of this.creatures.values()) {
      if (c.dead) continue;
      alive++;
      if (!c.keeper) continue;
      kept++;
      keepers.add(c.keeper);
    }
    return `${alive} standing in ${this.byWorld.size} world(s), ${kept} kept by ${keepers.size}, ${this.handovers} handed over`;
  }
}
