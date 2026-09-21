// The places two players can both want, and who has each of them.
//
// A station's dock lane, and the spot on a hull that one ship rides another on. Both were local
// claims until now and said so: one browser, one ship, decided in the browser that asked. Two players
// flying at the same dock therefore both believed they had it, and both were flown onto it.
//
// This is the whole of the server's half, and it is small on purpose. A spot is a name, a world and
// a connection: the first browser to ask for one holds it, the next is refused by name, and a line
// that closes gives back everything it held. Nothing here is persisted -- a claim means "a ship is
// flying at this right now", which nothing about a restart can still be true of -- and nothing here
// knows what a lane or a hull is: the name is the browser's, kept as a string and never parsed, so a
// hangar bay or anything else two people can want later is a new `kind` and no new code.
//
// What is the game's and what is ours: none of it is the game's. The client has no docking procedure
// at all (`src/space/dockingMath.ts` says so at length), so the caps and the rate below are invented
// here, they are all in `SPOT_TUNING`, the server prints them on its status page, and
// `--set spot.<name>=<n>` moves one for a run.
//
// How it is used. Nothing in here touches a socket or a clock. The relay hands it what a browser
// asked for, what world that browser is standing on, and when a line closes; everything that decides
// something answers `{ ok, why, tell }`, where `tell` is a list of `{ to: <connection>, msg }` for
// the relay to fan out, exactly as the creatures' own half and the duels do.
//
// Dependency-free, and shared with tools/swg/tests/spots.test.ts.

/**
 * Every number this file invents. None of them is from the game.
 */
export const SPOT_TUNING = {
  /** How long a spot's name may be. The longest a browser sends is a hull, a place and a lane letter. */
  what: 96,
  /** How many spots one browser may hold at once. One ship holds one dock and one place on a back. */
  held: 8,
  /** How many spots one world may hold at once, so a browser cannot fill the table by naming places. */
  world: 400,
  /** How many claim words one browser may send in a second. */
  perSecond: 8,
};

/**
 * What a claim can be for. A dock is a station's own lane; a carrier is the spot on a hull's back
 * that one ship rides another on. Anything else is a browser on a build this server does not know,
 * and is dropped rather than answered.
 */
const KINDS = ['dock', 'carrier'];

/**
 * The shape of a name: what the browser's own keys are made of (a model's id, a place rounded to the
 * metre, a lane letter, a connection number, and the bars and at-signs between them). It is never
 * parsed here -- it is a key and nothing else -- so this only has to keep out what would make it one
 * of the language's own names or a line of something else.
 */
const WHAT = /^[A-Za-z0-9_.:@|,+-]{1,96}$/;

/** Names a key may not have: the three that mean something to every object in the language. */
const RESERVED = ['__proto__', 'constructor', 'prototype'];

/**
 * A cleaned copy of a `claimSpot`, or undefined when it is not one. As everywhere else, anything that
 * fails is dropped and never answered: a browser sending nonsense hears nothing back.
 */
export function cleanSpot(x, tuning = SPOT_TUNING) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const take = x.do === 'take' ? true : x.do === 'free' ? false : undefined;
  if (take === undefined) return undefined;
  if (typeof x.kind !== 'string' || !KINDS.includes(x.kind)) return undefined;
  if (typeof x.what !== 'string' || x.what.length > tuning.what || !WHAT.test(x.what) || RESERVED.includes(x.what)) return undefined;
  return { do: take ? 'take' : 'free', kind: x.kind, what: x.what };
}

/**
 * Whether this browser may send another claim word this second. The same window the creatures' own
 * rate uses, written in place so that asking allocates nothing.
 *
 * What the caller must do with a `false` is the one thing this file is unlike the others in: a claim
 * word may never be dropped in silence. The browser reads silence as consent -- it flies on its own
 * answer and takes the lane when the wait runs out -- so a `take` nobody answers is a lane the server
 * has no record of and will hand to the next ship that asks. The caller answers a dropped `take` with
 * `Spots.tooFast`, which is one line and ends correctly. A `free` is never asked this at all: it can
 * only ever give something back, and dropping one leaves a lane held by a browser that does not
 * believe it holds it, shut until that line closes.
 */
export function mayClaim(window, now, tuning = SPOT_TUNING) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= tuning.perSecond;
}

/** The one key a spot is held under: its world, its kind and its name, which cannot run into each other. */
function keyOf(world, kind, what) {
  return `${world}\0${kind}\0${what}`;
}

export class Spots {
  /**
   * @param {{ now?: () => number, tuning?: Record<string, number> }} options the clock to read, so a
   * test can hand in its own, and the numbers to work to.
   */
  constructor({ now = () => Date.now(), tuning = SPOT_TUNING } = {}) {
    this.now = now;
    this.tuning = tuning;
    /** @type {Map<string, { world: string, kind: string, what: string, session: number, at: number }>} */
    this.held = new Map();
    /** @type {Map<number, Set<string>>} connection to the keys it holds, so a line closing is one walk */
    this.bySession = new Map();
    /** @type {Map<string, number>} world to how many spots are held in it */
    this.byWorld = new Map();
    /** How many have been granted and how many refused, for the status page. */
    this.grants = 0;
    this.refusals = 0;
  }

  /**
   * Who holds a spot, or 0. The server's answer, and the only one: a browser's own is what it flies
   * on until this comes back, and what it gives back the moment this disagrees.
   */
  holderOf(world, kind, what) {
    return this.held.get(keyOf(world, kind, what))?.session ?? 0;
  }

  /** How many spots a browser holds, for the status page and for the cap. */
  heldBy(session) {
    return this.bySession.get(session)?.size ?? 0;
  }

  /**
   * Ask for one. The first to ask holds it; asking again for what you already hold is granted, since
   * a browser that never heard the answer must be able to ask again rather than being told its own
   * spot is taken. Everything else is refused by name, and the asker is the only one told anything:
   * whoever holds it is not disturbed, and nobody else has anything to do about it.
   */
  take(session, world, kind, what) {
    if (!session || !world || !what) return { ok: false, why: 'there is nowhere to claim', tell: [] };
    const key = keyOf(world, kind, what);
    const had = this.held.get(key);
    if (had) {
      if (had.session === session) {
        this.grants++;
        return { ok: true, tell: [{ to: session, msg: { t: 'spot', kind, what, granted: 1 } }] };
      }
      this.refusals++;
      return { ok: false, why: this.refusalFor(kind), tell: [{ to: session, msg: { t: 'spot', kind, what, granted: 0, why: this.refusalFor(kind) } }] };
    }
    if (this.heldBy(session) >= this.tuning.held) {
      const why = 'you are holding as many places as one ship can';
      this.refusals++;
      return { ok: false, why, tell: [{ to: session, msg: { t: 'spot', kind, what, granted: 0, why } }] };
    }
    if ((this.byWorld.get(world) ?? 0) >= this.tuning.world) {
      const why = 'this world is holding as many places as it can';
      this.refusals++;
      return { ok: false, why, tell: [{ to: session, msg: { t: 'spot', kind, what, granted: 0, why } }] };
    }
    this.held.set(key, { world, kind, what, session, at: this.now() });
    this.mine(session).add(key);
    this.byWorld.set(world, (this.byWorld.get(world) ?? 0) + 1);
    this.grants++;
    return { ok: true, tell: [{ to: session, msg: { t: 'spot', kind, what, granted: 1 } }] };
  }

  /**
   * The answer to a `take` this server would not act on: asked for faster than `perSecond`. It is a
   * refusal like any other and is counted as one, because the browser must hear *something* -- a
   * claim word answered with nothing is read as a grant when the wait runs out, and that is the one
   * way this server can put two ships in one lane. Nothing is written down: the spot is left exactly
   * as it was, and the pilot's next press asks again.
   */
  tooFast(session, kind, what) {
    const why = 'asking for places faster than one ship can need them';
    this.refusals++;
    return { ok: false, why, tell: [{ to: session, msg: { t: 'spot', kind, what, granted: 0, why } }] };
  }

  /**
   * Give one back. Nothing is answered: the browser that let go knows it has, and the next ship to
   * want the place finds it free when it asks. A browser giving back something it does not hold is
   * not an error -- it is a browser being careful, and the whole of the browser's side is careful.
   */
  free(session, world, kind, what) {
    const key = keyOf(world, kind, what);
    const had = this.held.get(key);
    if (!had || had.session !== session) return { ok: false, why: 'that is not yours to give back', tell: [] };
    this.drop(key, had);
    return { ok: true, tell: [] };
  }

  /**
   * A line closed, or that browser went to another world: everything it held is given back at once.
   * A dock nobody is flying at is a dock the next ship may have, and a claim that outlived the
   * browser holding it would keep a station's lane shut for the rest of the server's life.
   */
  gone(session) {
    const keys = this.bySession.get(session);
    if (!keys) return { ok: true, freed: 0, tell: [] };
    let freed = 0;
    for (const key of keys) {
      const had = this.held.get(key);
      if (!had) continue;
      this.held.delete(key);
      this.countDown(had.world);
      freed++;
    }
    this.bySession.delete(session);
    return { ok: true, freed, tell: [] };
  }

  /**
   * That browser has gone to another world. Only what it held there is given back: a spot in the
   * world it has arrived on is one it has only just asked for.
   */
  left(session, world) {
    const keys = this.bySession.get(session);
    if (!keys || !world) return { ok: true, freed: 0, tell: [] };
    let freed = 0;
    for (const key of [...keys]) {
      const had = this.held.get(key);
      if (!had || had.world !== world) continue;
      this.drop(key, had);
      freed++;
    }
    return { ok: true, freed, tell: [] };
  }

  /** What is held, for the status page. */
  describe() {
    return { held: this.held.size, browsers: this.bySession.size, worlds: this.byWorld.size, granted: this.grants, refused: this.refusals };
  }

  // -- the pieces the above is made of ---------------------------------------------------------------

  /** Why a spot was refused, in the words for the kind it is: the pilot reads this one. */
  refusalFor(kind) {
    return kind === 'carrier' ? 'another ship got aboard that hull first' : 'another ship took that dock first';
  }

  /** The set of keys a connection holds, made if it is not there yet. */
  mine(session) {
    let set = this.bySession.get(session);
    if (!set) {
      set = new Set();
      this.bySession.set(session, set);
    }
    return set;
  }

  /** One spot out of all three tables. */
  drop(key, had) {
    this.held.delete(key);
    const keys = this.bySession.get(had.session);
    if (keys) {
      keys.delete(key);
      if (!keys.size) this.bySession.delete(had.session);
    }
    this.countDown(had.world);
  }

  countDown(world) {
    const n = (this.byWorld.get(world) ?? 0) - 1;
    if (n > 0) this.byWorld.set(world, n);
    else this.byWorld.delete(world);
  }
}
