// Shots, hits, health and death, checked and shaped the way `wire.mjs`, `shipWire.mjs` and
// `vehicleWire.mjs` already check everything else the server is told: a name is matched against a
// class of characters and cut to length, a number is checked finite and clamped, and anything that
// fails is dropped rather than answered. A browser on another build can therefore neither grow one
// of these messages nor put anything unexpected through.
//
// Who decides a hit is the shooter, so what arrives here is a claim, not a measurement: the server
// checks that the one named is real, is on the same world and may be hurt at all, and passes it on.
// It does not fly bolts and it does not check physics (the trust model is written out in the design:
// among friends the server holds what is decided, not what is observed).
//
// Whether one player may hurt another is two things together: the switch the server was started with
// (`--friendly-fire`, off unless it is given) and, while that switch is off, a duel the two of them
// agreed to. The duel is the game's own word at the game's own distance -- `COMBAT_DUEL` and
// `COMBAT_PEACE`, 128 m, out of `datatables/player/radial_menu.iff` -- which is why the range is
// handed in from the table the groups already read rather than invented here.
//
// Dependency-free, shared by the server and by tools/swg/tests/combatWire.test.ts.

/**
 * The caps. Every one of these is ours, invented for this pass and kept here together so there is
 * one place to read and one place to change them; the server prints them on its status page and
 * `--set combat.<name>=<n>` moves one for a run. None of them is from the game.
 */
export const COMBAT_WIRE = {
  /** The fastest bolt that will be passed on, metres a second (a ship's gun is 600). */
  speed: 6000,
  /** The longest a bolt may claim to live, seconds. */
  life: 30,
  /** How wide a bolt may be, over the plain blaster's. */
  size: 16,
  /**
   * The most damage one blow may claim. It is a bound on nonsense and not a rule about fighting: a
   * browser that may hurt another at all may end them, and that is what agreeing to a duel or
   * switching damage between players on means. It is set well above a ship's heaviest gun so that
   * nothing anybody really fires is ever quietly cut down.
   */
  damage: 100000,
  /** The most walls a bolt may claim it can still glance off. */
  bounces: 64,
  /** How far from the middle of the world a point may be before it is nonsense, metres. */
  reach: 1e7,
  /** How far ahead of its own point a bolt's drawn tip may reach, metres. */
  tip: 200,
  /** The fall on a bolt that drops, metres a second squared. */
  gravity: 200,
  /** A particle effect's path inside its pack. */
  effect: 120,
  /** A word for what was struck (a surface, a ship's layer). */
  what: 16,
  /** A shot's own number, which counts up in the browser that fired it and wraps here. */
  shot: 1e9,
  /** How long two players stay in a duel with nothing said, seconds; an unanswered challenge lapses in a fifth of it. */
  duel: 3600,
  /** How often the duels are looked over for one that has lapsed, milliseconds. */
  tick: 60000,
};

/**
 * The top of the head's pitch field on a `state`, which is simply what a byte holds. It is a shape
 * and not a tuning, so it is **not** in `COMBAT_WIRE`: the relay maps `--set combat.<name>=<number>`
 * straight onto that object, and `--set combat.pitch=0` would quietly pin every player's head byte
 * to nought for the whole run, which every browser reads as a head looking hard down, with nothing
 * anywhere saying why. What a step of the byte is worth in degrees is the browser's
 * (`src/player/lookAt.ts`'s `PITCH_WIRE`) and is deliberately not repeated here -- the server passes
 * a byte on and has no opinion about where anybody is looking.
 */
export const HEAD_PITCH_BYTE = 255;

// Written as escapes, as server/groups.mjs writes the same class: the bytes themselves in a
// source file do not survive being copied about, a lint pass, or an editor that strips them, and
// one of them is a NUL.
const CONTROL = /[\u0000-\u001f\u007f]/g;
const EFFECT = /^[A-Za-z0-9_./-]+$/;
const PACKS = ['ships', 'weapons'];
const DUEL_WORDS = ['ask', 'accept', 'decline', 'end'];

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
  if (out.some((v) => !Number.isFinite(v) || Math.abs(v) > COMBAT_WIRE.reach)) return null;
  return out;
}

/** A direction: three finite numbers that are not all zero, made unit length here so nothing downstream has to. */
function heading(x) {
  const p = point(x);
  if (!p) return null;
  const len = Math.hypot(p[0], p[1], p[2]);
  if (!(len > 1e-6)) return null;
  return [p[0] / len, p[1] / len, p[2] / len];
}

/** A shot's own number: a whole number the browser counts up, wrapped rather than refused. */
function shotNumber(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n) % COMBAT_WIRE.shot;
}

/**
 * A particle effect's path inside its pack, or undefined: safe characters, not too long, and inside
 * the pack -- a path that climbs out of it (`..`) or begins at the root is refused, because what it
 * names on the other side is a file a browser is going to ask for.
 */
function effectPath(x) {
  if (typeof x !== 'string' || !x || x.length > COMBAT_WIRE.effect || !EFFECT.test(x)) return undefined;
  if (x.startsWith('/') || x.split('/').includes('..')) return undefined;
  return x;
}

/** A relay id: a whole number above zero, or 0 for nobody. */
function who(x) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * A cleaned copy of a `shot`, or undefined: everything needed to fly the same bolt on another
 * screen, and nothing that could not be written down. A bolt's options in the game carry live
 * objects -- the body it flies out through, what to do where it lands, the room's own physics -- and
 * none of those crosses: a copy on another browser is a picture of a bolt and hurts nothing.
 *
 * The speed and heading are the ones the bolt really left with, the shooter's own velocity already
 * in them, so the copy is fired with no velocity of its own to add and flies the same line.
 */
export function cleanShot(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const p = point(x.p);
  const d = heading(x.d);
  if (!p || !d) return undefined;
  const out = {
    n: shotNumber(x.n),
    p,
    d,
    s: num(x.s, 0, COMBAT_WIRE.speed, 0),
    l: num(x.l, 0, COMBAT_WIRE.life, 1),
    c: Math.floor(num(x.c, 0, 0xffffff, 0xff4a2a)),
    z: num(x.z, 1 / COMBAT_WIRE.size, COMBAT_WIRE.size, 1),
  };
  const g = num(x.g, 0, COMBAT_WIRE.gravity, 0);
  if (g > 0) out.g = g;
  // What the bolt would take off what it struck. Nothing anywhere subtracts it from this message --
  // a hit is its own message and the one hurt is the only place a number comes off -- but a lit
  // blade turning this bolt away fires one back in its place, and that one carries the same blow.
  const a = num(x.a, 0, COMBAT_WIRE.damage, 0);
  if (a > 0) out.a = a;
  // Walls it may still glance off, so a bouncing bolt bounces on every screen rather than only the
  // one it was fired on.
  const b = Math.floor(num(x.b, 0, COMBAT_WIRE.bounces, 0));
  if (b > 0) out.b = b;
  // The game's own projectile effect the bolt is drawn as, by the path it has inside its pack: a
  // browser without that pack loaded draws its own bolt instead, which is what it does already.
  const fx = effectPath(x.fx);
  if (fx) {
    out.fx = fx;
    out.rc = num(x.rc, 0, COMBAT_WIRE.tip, 0);
    const hx = effectPath(x.hx);
    if (hx) out.hx = hx;
    out.pk = PACKS.includes(x.pk) ? x.pk : 'ships';
  }
  // Fired inside a hull's rooms: whose hull, so a browser standing in that same hull flies the copy
  // in the hull's own frame and one that is not simply lets the shot alone.
  const inHull = who(x.in);
  if (inHull) out.in = inHull;
  return out;
}

/**
 * A cleaned copy of an `end`: the shot's number and where it stopped. Because each browser traces
 * its own streamed world -- tiers built by distance, a door open here and shut there -- a copy
 * cannot be relied on to stop in the same place as the shot it copies, so it does not decide: the
 * browser that fired says where its bolt landed and every copy is cut short there.
 */
export function cleanEnd(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const at = point(x.at);
  if (!at) return undefined;
  return { n: shotNumber(x.n), at };
}

/**
 * The head's pitch as it crosses on a `state`, or undefined: a whole number inside one byte, the
 * middle of it level. It is checked exactly as every other field is -- a browser on another build
 * can neither send a fraction, a string nor a number outside the byte -- and it is passed on
 * without being read: what a step is worth in degrees belongs to the browser that packed it.
 *
 * A state with no pitch in it (a browser built before the head followed the view) is not an error
 * and is left alone, so a peer's head is simply level, as it always was.
 */
export function cleanHeadPitch(x) {
  // A number, and nothing that merely turns into one: `null`, `true` and an empty string all read
  // as 0 through `Number`, and a head forced level by a field that was never a pitch is a fault
  // that would never be looked for.
  if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
  return Math.min(HEAD_PITCH_BYTE, Math.max(0, Math.round(x)));
}

/**
 * A cleaned copy of a `hit`: who was hurt, how much, where, and what was struck. The shooter's
 * browser decides this (the owner's decision: a shot that looked like a hit on the shooter's screen
 * counts) and the one hurt is the only place a number is ever subtracted, so the two sides cannot
 * come to disagree about how much health anybody has.
 */
export function cleanHit(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const to = who(x.to);
  if (!to) return undefined;
  const at = point(x.at) ?? [0, 0, 0];
  const a = num(x.a, 0, COMBAT_WIRE.damage, 0);
  if (!(a > 0)) return undefined;
  const out = { to, a, at };
  if (typeof x.w === 'string' && x.w) out.w = x.w.replace(CONTROL, '').slice(0, COMBAT_WIRE.what);
  return out;
}

/**
 * A cleaned copy of a `blocked`: a bolt turned away by a lit blade. A block cannot be "the bolt
 * becomes mine" across the wire -- the shooter's browser sees a peer's body where the blade is, not
 * a blade -- so it is a word: whose shot, which shot, and where. Every browser cuts that shot short
 * there, the shooter's included, and whoever blocked it announces a new shot of their own from the
 * same point. One bolt in, one bolt out, on every screen.
 */
export function cleanBlocked(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const of = who(x.of);
  const at = point(x.at);
  if (!of || !at) return undefined;
  return { of, n: shotNumber(x.n), at };
}

/**
 * A cleaned copy of a `health`: how much of this player's own health is left, as a share of the
 * whole, and whether they are down. It goes only when it changes, never in a frame, so it is a few
 * bytes a fight rather than a number on the back of every state.
 */
export function cleanHealth(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const hp = Number(x.hp);
  if (!Number.isFinite(hp)) return undefined;
  const out = { hp: Math.round(Math.min(1, Math.max(0, hp)) * 1000) / 1000 };
  if (x.d === 1) out.d = 1;
  return out;
}

/**
 * A cleaned copy of a `died`: the one who fell says so, with whoever struck the blow. It is always
 * the one who died who announces it, so no two browsers can disagree that somebody is dead.
 */
export function cleanDied(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const by = who(x.by);
  return by ? { by } : {};
}

/**
 * A cleaned copy of a `duel`: the game's own words. `ask` and `accept` are `COMBAT_DUEL`, `end` is
 * `COMBAT_PEACE`, and the distance they are held to is the client's table's 128 m, handed in from
 * the one place that table's rows are kept.
 */
export function cleanDuel(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (!DUEL_WORDS.includes(x.do)) return undefined;
  const out = { do: x.do };
  const to = who(x.to);
  if (to) out.to = to;
  return out;
}

/**
 * Whether one player may hurt another here: the switch the server was started with, or a duel the
 * two of them agreed to while it is off. Nobody may hurt themselves through this path, which is
 * what keeps a browser from reporting its own bolts back onto itself.
 */
export function mayHurt(friendlyFire, duels, from, to) {
  if (!from || !to || from === to) return false;
  if (friendlyFire) return true;
  return !!duels && duels.between(from, to);
}

/**
 * The duels: who has asked whom, and who has agreed. They are held by connection and die with the
 * line, because a duel is something two people are doing this minute and not a thing the world
 * remembers. Nothing here knows about sockets; the relay looks a connection up and sends.
 */
export class Duels {
  /** `range` is the client's own 128 m; `seconds` is how long a duel stands with nothing said. */
  constructor({ range = 128, seconds = COMBAT_WIRE.duel, now = () => Date.now() } = {}) {
    this.range = range;
    this.seconds = seconds;
    this.now = now;
    /** @type {Map<string, { a: number, b: number, at: number }>} the pairs fighting, by their two ids */
    this.on = new Map();
    /** @type {Map<number, { from: number, at: number }>} who has been asked, and by whom */
    this.asked = new Map();
  }

  /** The name of a pair, whichever way round it is named. */
  static pair(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  /** Whether these two have agreed to fight. */
  between(a, b) {
    return this.on.has(Duels.pair(a, b));
  }

  /**
   * One asks another. The answer is what to say and to whom: `tell` is a list of `{ to, msg }`, the
   * same shape the groups answer in, so the relay's job is only to turn an id into a socket.
   */
  ask(from, to, metres) {
    if (!from || !to || from === to) return this.refuse(from, 'there is nobody there to fight');
    if (this.between(from, to)) return this.refuse(from, 'you are already fighting');
    if (!(Number(metres) <= this.range)) return this.refuse(from, `too far off to ask for a duel: a duel reaches ${this.range} m`);
    // Asked by the one you were about to ask: that is an agreement, and the two words meeting in
    // the middle should not leave both of them waiting on the other for ever.
    const already = this.asked.get(from);
    if (already?.from === to) return this.accept(from);
    // Somebody else asked them first and has not been answered. The first challenge stands: two
    // people cannot both be waiting on one answer, and the one who asked first would otherwise be
    // left waiting on a challenge that had quietly been thrown away.
    const waiting = this.asked.get(to);
    if (waiting && waiting.from !== from) return this.refuse(from, 'somebody has already asked them for a duel');
    this.asked.set(to, { from, at: this.now() });
    return { tell: [{ to, msg: { t: 'duel', do: 'asked', id: from } }, { to: from, msg: { t: 'duel', do: 'sent', id: to } }] };
  }

  accept(me) {
    const ask = this.asked.get(me);
    if (!ask) return this.refuse(me, 'nobody has asked you for a duel');
    this.asked.delete(me);
    this.on.set(Duels.pair(me, ask.from), { a: me, b: ask.from, at: this.now() });
    return { tell: [{ to: me, msg: { t: 'duel', do: 'on', id: ask.from } }, { to: ask.from, msg: { t: 'duel', do: 'on', id: me } }] };
  }

  decline(me) {
    const ask = this.asked.get(me);
    if (!ask) return { tell: [] };
    this.asked.delete(me);
    // Both of them: the one who asked hears no, and the one who said it is told the challenge is
    // gone, or their own browser would go on believing somebody was waiting on an answer it had
    // already given.
    return { tell: [{ to: ask.from, msg: { t: 'duel', do: 'declined', id: me } }, { to: me, msg: { t: 'duel', do: 'off', id: ask.from } }] };
  }

  /** `COMBAT_PEACE`: every duel this player is in ends, and both sides are told. */
  end(me) {
    const tell = [];
    for (const [key, duel] of [...this.on]) {
      if (duel.a !== me && duel.b !== me) continue;
      this.on.delete(key);
      const other = duel.a === me ? duel.b : duel.a;
      tell.push({ to: me, msg: { t: 'duel', do: 'off', id: other } });
      tell.push({ to: other, msg: { t: 'duel', do: 'off', id: me } });
    }
    return { tell };
  }

  /** A line closed, or a player went to another world: their duels and their challenges go with them. */
  drop(me) {
    const answer = this.end(me);
    this.asked.delete(me);
    for (const [key, ask] of [...this.asked]) {
      if (ask.from !== me) continue;
      this.asked.delete(key);
      // The one who was asked is told the challenge has gone with the line that made it. Without
      // this their browser waits for an answer for ever, and their own /duel is refused because it
      // is still holding somebody who is no longer there.
      answer.tell.push({ to: key, msg: { t: 'duel', do: 'off', id: me } });
    }
    // Whoever was told their duel is off is told; the one who left needs nothing.
    answer.tell = answer.tell.filter((line) => line.to !== me);
    return answer;
  }

  /** A challenge nobody answered, and a duel nobody has said anything about for an hour, both lapse. */
  tick() {
    const now = this.now();
    const tell = [];
    for (const [me, ask] of [...this.asked]) {
      if (now - ask.at < (this.seconds * 1000) / 5) continue;
      this.asked.delete(me);
      tell.push({ to: ask.from, msg: { t: 'duel', do: 'off', id: me } });
      tell.push({ to: me, msg: { t: 'duel', do: 'off', id: ask.from } });
    }
    for (const [key, duel] of [...this.on]) {
      if (now - duel.at < this.seconds * 1000) continue;
      this.on.delete(key);
      tell.push({ to: duel.a, msg: { t: 'duel', do: 'off', id: duel.b } });
      tell.push({ to: duel.b, msg: { t: 'duel', do: 'off', id: duel.a } });
    }
    return { tell };
  }

  /** A blow landed between two people fighting: their duel is alive, whatever the clock says. */
  touch(a, b) {
    const duel = this.on.get(Duels.pair(a, b));
    if (duel) duel.at = this.now();
  }

  refuse(to, why) {
    return { tell: to ? [{ to, msg: { t: 'duel', do: 'refused', why } }] : [] };
  }

  /** What to print on the status page. */
  describe() {
    return { fighting: this.on.size, asked: this.asked.size };
  }
}
