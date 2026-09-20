// Checking and shaping for everything the server is told, the same way `shipWire.mjs` and
// `vehicleWire.mjs` already do for a ship's fit and a vehicle's state: a name is matched against a
// class of characters and cut to length, a number is checked finite and clamped, a list has a hard
// cap, and anything that fails is dropped rather than answered. A browser on another build can
// therefore neither grow a message nor put anything unexpected through, and the relay itself stays
// a switch with no checking in it.
//
// Dependency-free, shared by the server and by tools/swg/tests/netWire.test.ts.

import { cleanShip } from './shipWire.mjs';
import { cleanRide, quat } from './vehicleWire.mjs';

/**
 * The caps. Every one of these is ours, invented for this pass and kept here together so there is
 * one place to change them; the server prints them on the status page and `--set wire.<name>=<n>`
 * moves one for a run. None of them is from the game.
 */
export const WIRE = {
  /** A display name, as the relay has always cut it. */
  name: 24,
  /** A species or a rig state name. */
  word: 40,
  /** A planet or a zone id. */
  place: 24,
  /** An emote clip's name. */
  clip: 48,
  /** A character id as the browser makes them (a uuid, or a time and some random characters). */
  character: 64,
  /** The look, as JSON, which the relay has always held to a few kilobytes. */
  look: 16384,
  /** How many shaped numbers a look may carry, in each of its two sets. */
  lookNumbers: 120,
  /** How many pieces of clothing a look may name. */
  outfit: 40,
  /** A weapon id in a hand. */
  held: 80,
  /** How high a character's change counter may go before it is nonsense. */
  counter: 1e9,
};

const NAME_CONTROL = /[\u0000-\u001f\u007f]/g;
const CHARACTER_ID = /^[A-Za-z0-9_.-]+$/;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CLASSES = ['jedi', 'bounty_hunter'];
const TAKES = ['browser', 'server'];
/**
 * Names a character id may not have. A character id is used as a key in the table the server keeps,
 * and these three are the ones that mean something to every object in the language rather than being
 * a key. The tables the store keeps have no prototype for the same reason; this is the near half of
 * it, so nothing further in has to think about it.
 */
const RESERVED = ['__proto__', 'constructor', 'prototype'];

/** A character id as the browser makes them: safe characters, not too long, and not a reserved name. */
function goodCharacter(x) {
  return typeof x === 'string' && !!x && x.length <= WIRE.character && CHARACTER_ID.test(x) && !RESERVED.includes(x);
}

/** A display name: control characters out, cut to length, never empty. */
export function cleanName(x, fallback = 'someone') {
  if (typeof x !== 'string') return fallback;
  const out = x.replace(NAME_CONTROL, '').trim().slice(0, WIRE.name);
  return out || fallback;
}

/** A short word (a species, a rig state), cut to length. */
export function cleanWord(x, fallback, cap = WIRE.word) {
  if (typeof x !== 'string') return fallback;
  return x.replace(NAME_CONTROL, '').slice(0, cap);
}

/** A finite number, or the fallback. */
export function cleanNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * A cleaned copy of a `hello`, or undefined when there is nothing usable in it: who the player is,
 * where they are, how they look, what is in their hands and the ship they fly. This is what the
 * relay has always kept, lifted out of the switch so it can be tested.
 */
export function cleanHello(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const hello = {
    name: cleanName(x.name),
    species: cleanWord(x.species, 'human_male'),
    class: CLASSES.includes(x.class) ? x.class : 'jedi',
    planet: cleanWord(x.planet, '', WIRE.place),
    zone: x.zone ? cleanWord(x.zone, '', WIRE.place) : undefined,
  };
  // The look: numbers by name and the outfit's names, kept within a few kilobytes.
  const look = x.look;
  if (look && typeof look === 'object' && JSON.stringify(look).length <= WIRE.look) {
    const numbers = (o) =>
      Object.fromEntries(
        Object.entries(o && typeof o === 'object' ? o : {})
          .filter(([k, v]) => k.length <= 80 && Number.isFinite(Number(v)))
          .slice(0, WIRE.lookNumbers)
          .map(([k, v]) => [k, Number(v)]),
      );
    hello.look = {
      morphs: numbers(look.morphs),
      values: numbers(look.values),
      height: Number(look.height) || 0,
      outfit: (Array.isArray(look.outfit) ? look.outfit : []).slice(0, WIRE.outfit).map((s) => String(s).slice(0, 80)),
    };
  }
  // The weapons in hand, by id: kept short, and only when a hand holds something.
  const held = x.held;
  if (held && typeof held === 'object' && !Array.isArray(held)) {
    const h = {};
    if (typeof held.r === 'string' && held.r) h.r = held.r.slice(0, WIRE.held);
    if (typeof held.l === 'string' && held.l) h.l = held.l.slice(0, WIRE.held);
    if (h.r || h.l) hello.held = h;
  }
  // The ship they fly, with its fit: names and numbers checked and kept within their limits.
  // The colour their blade is lit in: a colour and nothing else, so a client on another build
  // cannot put a string, a huge number or a fraction of one through as one.
  const saber = Number(x.saber);
  if (Number.isFinite(saber) && saber >= 0 && saber <= 0xffffff) hello.saber = Math.round(saber) >>> 0;
  const ship = cleanShip(x.ship);
  if (ship) hello.ship = ship;
  return hello;
}

/**
 * A cleaned copy of a `state`, or undefined when the place in it is not three numbers: where the
 * player is, which way they face, what their rig is playing, how fast, mounted, the saber lit, the
 * whole turn when a heading is not enough, a jump in progress and the vehicle they are on.
 */
export function cleanState(x, self = 0) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const p = Array.isArray(x.p) && x.p.length === 3 ? x.p.map(Number) : null;
  if (!p || p.some((v) => !Number.isFinite(v))) return undefined;
  const state = {
    p,
    h: cleanNumber(x.h),
    s: typeof x.s === 'string' ? x.s.slice(0, 32) : 'idle',
    v: cleanNumber(x.v),
    m: !!x.m,
    sab: !!x.sab,
  };
  const q = quat(x.q);
  if (q) state.q = q;
  // In a hyperspace jump: the others hide this player and their ship until a state comes without it.
  if (x.j === 1) state.j = 1;
  // Their blade out of their hand: where it is and how far it has spun, kept only when all four
  // numbers are real. It is a place in the world, so it is not otherwise bounded -- a hull's frame
  // and a clamp's place already are not.
  if (Array.isArray(x.tb) && x.tb.length === 4) {
    const tb = x.tb.map(Number);
    if (!tb.some((v) => !Number.isFinite(v))) state.tb = tb;
  }
  // The vehicle they ride or fly, or the hull of somebody else's ship they are standing in, never
  // both: whoever flies a hull is the one who sends it, so a watcher draws one hull with people in
  // it rather than one hull per person aboard.
  const ride = cleanRide(x, self);
  if (ride.veh) state.veh = ride.veh;
  if (ride.in) state.in = ride.in;
  return state;
}

/** An emote's clip name, or undefined. An empty one is kept: it ends a dance or a sit. */
export function cleanEmote(x) {
  if (!x || typeof x !== 'object' || typeof x.clip !== 'string') return undefined;
  return x.clip.replace(NAME_CONTROL, '').slice(0, WIRE.clip);
}

/**
 * A cleaned copy of a `claim`, or undefined when it is not one. This is how a browser says which
 * player it is and which of that player's characters it is playing:
 *
 * - `player`: the public id, the first sixteen hex characters of SHA-256 of the browser's key;
 * - `key`: the verifier derived from that key, sent once when the server has never seen the player
 *   (the key itself never crosses the wire, and the server never learns it);
 * - `proof`: HMAC-SHA-256 of the hail's nonce under that verifier, as hex;
 * - `word`: the same over the join word, when the server asked for one;
 * - `character`, `name`, `about` and `counter`: which character, what it is called, a summary the
 *   merge compares and its change counter (decision 4: the higher counter wins).
 */
export function cleanClaim(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.player !== 'string' || !HEX16.test(x.player)) return undefined;
  if (typeof x.proof !== 'string' || !HEX64.test(x.proof)) return undefined;
  if (!goodCharacter(x.character)) return undefined;
  const out = { player: x.player, proof: x.proof, character: x.character, name: cleanName(x.name), counter: 0 };
  if (typeof x.key === 'string' && HEX64.test(x.key)) out.key = x.key;
  if (typeof x.word === 'string' && HEX64.test(x.word)) out.word = x.word;
  const counter = Number(x.counter);
  if (Number.isFinite(counter) && counter >= 0) out.counter = Math.min(Math.floor(counter), WIRE.counter);
  const about = x.about;
  if (about && typeof about === 'object' && !Array.isArray(about)) {
    out.about = {
      species: cleanWord(about.species, 'human_male'),
      class: CLASSES.includes(about.class) ? about.class : 'jedi',
      planet: cleanWord(about.planet, '', WIRE.place),
      zone: about.zone ? cleanWord(about.zone, '', WIRE.place) : '',
    };
  }
  return out;
}

/**
 * A cleaned copy of a `ping`, or undefined: the browser's own clock reading, which comes back
 * untouched in the pong beside the server's so the browser can work the offset out.
 */
export function cleanPing(x) {
  if (!x || typeof x !== 'object') return undefined;
  const c = Number(x.c);
  if (!Number.isFinite(c)) return undefined;
  return { c };
}

/**
 * A cleaned copy of a `settle`, the answer to a character whose change counters tie and whose two
 * copies differ: which copy to keep, the browser's or the server's.
 */
export function cleanSettle(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (!goodCharacter(x.character)) return undefined;
  if (!TAKES.includes(x.take)) return undefined;
  return { character: x.character, take: x.take };
}
