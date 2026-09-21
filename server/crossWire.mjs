// Checking and shaping for the one word a group says about crossing between worlds: "I am on my way
// there" and "I came out here". It is the same `cleanX` pattern as `wire.mjs`, `shipWire.mjs` and
// `combatWire.mjs` -- a word is matched against a list, a name is cut to length, a number is checked
// finite and then clamped, and anything that fails is dropped rather than answered.
//
// Why it exists at all: a group's offer to travel together carries a world, and that is enough to
// send everybody to the same planet, but not enough to put them beside each other when they get
// there. Where a player actually came out is known only to their own browser, and a member on
// another world is sent nothing that would say -- `state` goes to the world a player is on and no
// further. So this word goes to the group, and only to the group.
//
// Dependency-free, shared with tools/swg/tests/crossing.test.ts.

import { WIRE, cleanWord } from './wire.mjs';

/**
 * The caps. Both of these are ours, invented here; none of them is from the game. The place is
 * clamped exactly as a group's trip is, and for the same reason: it is passed on to everybody
 * else's browser, and a browser handed 1e308 as a place to stand has no good answer.
 */
export const CROSS_WIRE = {
  /** How far from a world's middle a place may be, in metres. No world is anywhere near this wide. */
  limit: 10000000,
  /** A word for how somebody crossed, which the server passes on without reading. */
  how: 16,
  /**
   * Invented: how many of these words one browser may send in a second. A crossing says two things,
   * it takes seconds, and nobody crosses twice in one; four leaves room for a browser whose
   * crossings overlap and still stands between a browser on another build and the server writing to
   * a whole group as fast as it can read. It is a budget of its own rather than the group's own
   * allowance for decisions, because a member who crosses in the same second as an invitation or a
   * promotion would otherwise have the word that says where they came out silently dropped, and the
   * group would scatter with nothing to say why.
   */
  perSecond: 4,
};

/**
 * Whether this browser may send another crossing word now. The window is the same shape the group's
 * own limits use: a second's worth counted, and a new second starts the count again. `window` is the
 * caller's own little record and is written in place, so nothing is allocated to ask.
 */
export function mayCross(window, now, caps = CROSS_WIRE) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= caps.perSecond;
}

/** Where a player is in the crossing: on their way, or arrived. */
const PHASES = ['going', 'here'];
/** The kinds of crossing, the same list a group's trip offer holds. */
const HOWS = ['ground', 'space', 'jump', 'travel'];

/**
 * A cleaned copy of a `cross`, or undefined when it is not one: which part of the crossing this is,
 * the world being crossed to, how, and where the player came out when they know it. The place is
 * optional: the word sent as a crossing begins usually has none, since nobody knows yet.
 */
export function cleanCross(x, caps = CROSS_WIRE) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.phase !== 'string' || !PHASES.includes(x.phase)) return undefined;
  const planet = cleanWord(x.planet, '', WIRE.place);
  const zone = x.zone ? cleanWord(x.zone, '', WIRE.place) : '';
  // A crossing to a zone of no world is not a crossing: the far end looks a world up by name and
  // drops a word without one, so the two ends agree here about what a word has to carry.
  if (!planet) return undefined;
  const out = { phase: x.phase, planet, zone, how: HOWS.includes(x.how) ? x.how : 'travel' };
  const at = Array.isArray(x.at) && x.at.length === 3 ? x.at.map(Number) : null;
  if (at && at.every((v) => Number.isFinite(v))) out.at = at.map((v) => Math.max(-caps.limit, Math.min(caps.limit, v)));
  return out;
}
