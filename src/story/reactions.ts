// How the game's own people greet you and say goodbye when they have no conversation to hold: in the client's
// own reaction lines, the `npc_reaction` tables. A way of speaking (a diction: `military`, `stormtrooper`,
// `fancy`, `slang`, `townperson`, and six for droids) is a table of its own, and each has sixteen greetings
// and sixteen farewells at each of three warmths -- `hi_nice_1` to `hi_nice_16`, `hi_mid_*`, `hi_mean_*`, and
// `bye_*` the same -- which is the client's own arrangement. The server gave each of its people a diction
// (`reactionStf`), and the Core3 reference keeps which (`conversation-speakers.json`).
//
// **How warm.** Ours, on the bible's two axes rather than the server's one: nice when the player's Standing
// on the speaker's track is `niceAt` or more; mean when that track has burned them, or its Trust is
// `meanTrust` or less; otherwise mid. The track is the speaker's faction's -- the Rebellion's for a rebel,
// the Empire's for an imperial, and the freelance track for anybody else. Until this pass's last wave moves
// Standing at all, everybody greets at mid.
//
// **Which line.** Drawn from the speaker's own key and the shared clock's `every`, so the same person says the
// same thing for a while and then something else, the same in every browser, with nothing kept and nothing
// sent. A table whose line the draw lands on is not there (a few keys are missing from a few tables) gives
// the next that is, when the table has come; before it has, the draw stands.
//
// Pure, the game's own lines named and never written here.

import { hashText } from '../net/hash.ts';
import type { StoryBook, Track } from './book.ts';

/** Every number of ours. */
export const REACTION_TUNE = {
  /** Standing on the speaker's track at or past which they greet warmly (the design's, beside its `STANDING_TUNE`). */
  niceAt: 2500,
  /** Trust on the speaker's track at or below which they greet coldly. */
  meanTrust: -3,
  /** Milliseconds of the shared clock a person keeps to one greeting before the draw moves on. */
  every: 600000,
  /** Lines a table holds of each kind and warmth: the client's own number. */
  lines: 16,
};

/** Move any of those, live; a number is only ever replaced by a finite one, and the line count stays the client's. */
export function tuneReactions(o: Partial<typeof REACTION_TUNE> | null | undefined): typeof REACTION_TUNE {
  if (o && typeof o.niceAt === 'number' && Number.isFinite(o.niceAt)) REACTION_TUNE.niceAt = o.niceAt;
  if (o && typeof o.meanTrust === 'number' && Number.isFinite(o.meanTrust)) REACTION_TUNE.meanTrust = o.meanTrust;
  if (o && typeof o.every === 'number' && Number.isFinite(o.every)) REACTION_TUNE.every = Math.max(1, Math.round(o.every));
  return REACTION_TUNE;
}

export type Warmth = 'nice' | 'mid' | 'mean';

/** The client's table a diction speaks from. */
export function reactionTable(diction: string): string {
  return `npc_reaction/${diction}`;
}

/** The track a speaker's faction stands on: the Rebellion's, the Empire's, or the freelance track for anybody else. */
export function trackOfFaction(faction: string | null | undefined): Track {
  const f = (faction ?? '').toLowerCase();
  if (f === 'rebel' || f === 'rebellion') return 'rebellion';
  if (f === 'imperial' || f === 'empire') return 'empire';
  return 'freelance';
}

/** How warmly somebody on a track greets the character this book is: nice, mid or mean (the head of this file). */
export function warmthOf(book: Pick<StoryBook, 'tracks'> | null | undefined, track: Track): Warmth {
  const t = book?.tracks?.[track] as { standing?: number; trust?: number; status?: string } | undefined;
  if (!t) return 'mid';
  if (t.status === 'burned' || (typeof t.trust === 'number' && t.trust <= REACTION_TUNE.meanTrust)) return 'mean';
  if (typeof t.standing === 'number' && t.standing >= REACTION_TUNE.niceAt) return 'nice';
  return 'mid';
}

/** A number in [0, n) that depends on nothing but `seed`. */
function draw(seed: string, n: number): number {
  return parseInt(hashText(seed).slice(0, 8), 16) % Math.max(1, n);
}

/**
 * One of a diction's lines, as a client string reference (`@npc_reaction/military:hi_mid_7`): `kind` is a
 * greeting or a farewell, `warmth` how warm, and `seed` who says it and when (`reactionSeed`). `has` says
 * whether the table holds a key, once it has come (null before): the draw then moves on past a key that is
 * not there, and gives null when none of the sixteen is.
 */
export function reactionLine(diction: string, kind: 'hi' | 'bye', warmth: Warmth, seed: string, has?: (key: string) => boolean | null): string | null {
  const n = REACTION_TUNE.lines;
  const first = draw(`${seed}|${kind}|${warmth}`, n);
  for (let i = 0; i < n; i++) {
    const key = `${kind}_${warmth}_${((first + i) % n) + 1}`;
    const there = has ? has(key) : null;
    if (there === false) continue;
    return `@${reactionTable(diction)}:${key}`;
  }
  return null;
}

/** What a greeting is drawn from: who says it, and which stretch of the shared clock it is. */
export function reactionSeed(speaker: string, now: number): string {
  return `${speaker}|${Math.floor(now / Math.max(1, REACTION_TUNE.every))}`;
}

/** A speaker as the greeting needs them: their way of speaking and their faction. */
export interface ReactionVoice {
  diction?: string | null;
  faction?: string | null;
}

/** A greeting and a farewell, with how warm and on which track; null for somebody with no way of speaking. */
export interface Reaction {
  hi: string;
  bye: string;
  warmth: Warmth;
  track: Track;
  table: string;
}

/**
 * How one of the game's own people greets this character and says goodbye, or null when they have no
 * diction (they say the game's invented lines, as before). `has(table, key)` answers whether a table holds a
 * key once it has come, null before.
 */
export function reactionFor(voice: ReactionVoice | null | undefined, book: Pick<StoryBook, 'tracks'> | null | undefined, speaker: string, now: number, has?: (table: string, key: string) => boolean | null): Reaction | null {
  const diction = voice?.diction;
  if (!diction || !/^[A-Za-z0-9_]{1,40}$/.test(diction)) return null;
  const track = trackOfFaction(voice?.faction);
  const warmth = warmthOf(book, track);
  const table = reactionTable(diction);
  const seed = reactionSeed(speaker, now);
  const keyHas = has ? (key: string) => has(table, key) : undefined;
  const hi = reactionLine(diction, 'hi', warmth, seed, keyHas);
  const bye = reactionLine(diction, 'bye', warmth, seed, keyHas);
  return hi && bye ? { hi, bye, warmth, track, table } : null;
}
