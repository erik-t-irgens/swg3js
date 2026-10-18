// Checking and shaping for the one word a group says about racing together: the leader calling a race on a track of
// the world's file at a moment of the shared clock, a member joining it, each member's laps and finish, and a member
// dropping out. It is `crossWire.mjs`'s shape -- a word matched against a list, a name cut to length, a number checked
// finite and then bounded, anything that fails dropped rather than answered -- and goes, like `cross`, to the sender's
// group and to nobody else.
//
// Nothing here is judged: whether a member may race, where each stands and who won are worked out in every member's
// own browser from the same words (`src/race/raceGroup.ts`, `src/net/raceNet.ts`). The server only carries them.
//
// Dependency-free, shared with tools/swg/tests/raceTogether.test.ts and raceRelay.test.ts.

import { cleanWord } from './wire.mjs';

/** What this relay carries of a race, as its hail says it (`race`): a browser against a relay with none offers no race. */
export const RACE_VERSION = 1;

/**
 * The caps. Ours, invented here; none of them is from the game. A race's own numbers (laps, the gates, how long a lap
 * may take) are bounded so a browser on another build cannot hand every member a number with no good answer.
 */
export const RACE_WIRE = {
  /**
   * How many of these words one browser may send in a second. A race says a lap a minute or so, a join and a finish
   * once; six leaves room for a call and a join in one second and still stands between a browser on another build and
   * the server writing to a whole group as fast as it can read. Its own budget, as the crossing's is.
   */
  perSecond: 6,
  /** The most members a call lists: a group holds eight. */
  members: 8,
  /** A world's pack id, as a track file names it. */
  world: 48,
  /** The most laps a race may run (the track file's own limit). */
  lapsMost: 99,
  /** The longest a lap or a race may take, seconds: a day. */
  timeMost: 86400,
};

/** The shared clock's own years: a start before or after them is no clock this game shares. */
const EARLIEST = Date.UTC(2020, 0, 1);
const LATEST = Date.UTC(2100, 0, 1);
/** A track's id, as the track file holds it (`isTrackId` in `src/race/trackFile.ts`). */
const TRACK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED = ['__proto__', 'constructor', 'prototype'];
/** A track's gates as one short digest (`trackDigest`): eight hex characters. */
const DIGEST = /^[0-9a-f]{8}$/;

/** Which part of a race a word is. */
const PHASES = ['call', 'join', 'lap', 'finish', 'out'];
/** Why a member dropped out, as a word every browser says in its own way. */
const OUTS = ['left', 'world', 'vehicle', 'crashed', 'died', 'stopped', 'group', 'other'];

/**
 * Whether this browser may send another race word now: a second's worth counted, and a new second starts the count
 * again. `window` is the caller's own little record, written in place, so nothing is allocated to ask.
 */
export function mayRace(window, now, caps = RACE_WIRE) {
  if (now - window.at >= 1000) {
    window.at = now;
    window.lines = 0;
  }
  window.lines++;
  return window.lines <= caps.perSecond;
}

/** A time a lap or a race took, seconds, or undefined. */
function seconds(x, caps) {
  const n = Number(x);
  return typeof x === 'number' && Number.isFinite(n) && n > 0 && n <= caps.timeMost ? n : undefined;
}

/**
 * A cleaned copy of a `race`, or undefined when it is not one. Every word names its race by the world, the track and
 * the start moment (`world`, `track`, `at`); a call carries the track's digest, its laps and the members in the order
 * their grid slots are given; a lap its number, how long it took and the time from go; a finish the time from go; an
 * out why, in one of a short list of words.
 */
export function cleanRace(x, caps = RACE_WIRE) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  if (typeof x.phase !== 'string' || !PHASES.includes(x.phase)) return undefined;
  if (typeof x.track !== 'string' || !TRACK_ID.test(x.track) || RESERVED.includes(x.track)) return undefined;
  const world = cleanWord(x.world, '', caps.world);
  if (!world) return undefined;
  const at = Number(x.at);
  if (typeof x.at !== 'number' || !Number.isFinite(at) || at < EARLIEST || at > LATEST) return undefined;
  const out = { phase: x.phase, track: x.track, world, at };
  if (x.phase === 'call') {
    if (typeof x.digest !== 'string' || !DIGEST.test(x.digest)) return undefined;
    const laps = Number(x.laps);
    if (!Number.isInteger(laps) || laps < 1 || laps > caps.lapsMost) return undefined;
    if (!Array.isArray(x.members) || !x.members.length || x.members.length > caps.members) return undefined;
    const members = [];
    for (const m of x.members) {
      const id = Number(m);
      if (!Number.isInteger(id) || id <= 0 || members.includes(id)) return undefined;
      members.push(id);
    }
    return { ...out, digest: x.digest, laps, members };
  }
  if (x.phase === 'lap') {
    const n = Number(x.n);
    const time = seconds(x.time, caps);
    const total = seconds(x.total, caps);
    if (!Number.isInteger(n) || n < 1 || n > caps.lapsMost || time === undefined || total === undefined) return undefined;
    return { ...out, n, time, total };
  }
  if (x.phase === 'finish') {
    const total = seconds(x.total, caps);
    if (total === undefined) return undefined;
    return { ...out, total };
  }
  if (x.phase === 'out') return { ...out, why: OUTS.includes(x.why) ? x.why : 'other' };
  return out;
}
