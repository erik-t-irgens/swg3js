// Checking and shaping for the one word a group says about a dungeon's copy: "this room of our copy is
// open now". It is the same `cleanX` pattern as `wire.mjs` and `crossWire.mjs` -- a word is matched
// against a class of characters and cut to length, a number is checked finite and then clamped, and
// anything that fails is dropped rather than answered.
//
// Why it exists at all: a group shares one copy of a dungeon, which every member works out for
// themselves with nothing sent (`copyIndex` in src/world/instances.ts), and a copy's locked rooms are
// opened at a keypad. Kept in each browser alone, one member's keypad left the door shut on every other
// screen, and the one who opened it walked through a shut door there. So the keypad's word goes to the
// group, and only to the group: the server holds nothing of it, and a member who comes into the copy
// after it was said finds the room locked, as the server that stood the copies would not have done.
//
// Dependency-free, shared with tools/swg/tests/instances.test.ts.

import { cleanWord } from './wire.mjs';

/** The caps. Every one of these is ours, invented here; none of them is from the game. */
export const COPY_WIRE = {
  /** A dungeon's kind, as `INSTANCES` names them ('corvette_rebel'). */
  kind: 32,
  /** How far from a world's middle a copy may stand, in metres; no world is anywhere near this wide. */
  limit: 10000000,
  /** The highest room index a copy's cell may have. The busiest layout has a few hundred. */
  cell: 4096,
  /** How many of these one browser may send in a second. A keypad is pressed by hand. */
  perSecond: 8,
};

const KIND = /^[a-z0-9_]+$/;

/**
 * Whether this browser may send another word about a copy now: a second's worth counted, and a new second
 * starts the count again. `window` is the caller's own little record, written in place.
 */
export function mayOpen(window, now, caps = COPY_WIRE) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= caps.perSecond;
}

/**
 * A cleaned copy of an `unlock`, or undefined when it is not one: which dungeon, where its copy stands
 * (the building's place in the world, `[x, z]`, which is the same in every browser on that world), and
 * which of its rooms is open now.
 */
export function cleanUnlock(x, caps = COPY_WIRE) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const kind = cleanWord(x.kind, '', caps.kind);
  if (!kind || !KIND.test(kind)) return undefined;
  if (!Array.isArray(x.at) || x.at.length !== 2) return undefined;
  const at = x.at.map(Number);
  if (!at.every((v) => Number.isFinite(v))) return undefined;
  const cell = Number(x.cell);
  if (!Number.isInteger(cell) || cell < 1 || cell > caps.cell) return undefined;
  return { kind, at: at.map((v) => Math.max(-caps.limit, Math.min(caps.limit, v))), cell };
}
