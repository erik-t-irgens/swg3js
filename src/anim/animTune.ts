// Every number of feel the imported animations have, in one table. The owner decides these by hand: each is live
// through `__debug.anim({ tune: { ... } })` and a slider in the debug menu when `anim` is picked (`animDials.ts`), and
// nothing here was chosen by measuring. A start is the brief's own number where it gave one, and otherwise the
// plainest thing that could be said for it, with the reason beside it.
//
// Pure: no three.js and nothing of the page, so the node tests move it as the console does.

/** The one-offs whose start the brief trims, by the pack's clip id. A trim is where the game starts the clip, seconds. */
export type TrimId = 'falling_flat_impact' | 'falling_to_landing' | 'hard_landing' | 'jumping_down' | 'jumping_up';

export interface AnimTune {
  land: {
    /**
     * A landing slower than this plays no landing clip at all, m/s. The game's own line, kept: it has always played
     * its landing only past a landing "delta" of 2, which is just under 3.6 m/s, so stepping off a kerb or down a
     * slope's bumps never bobs the knees.
     */
    min: number;
    /**
     * Under this a landing from the falling loop is the short one (`jumping_down`); from this up, and with no harm
     * done, the longer one (`falling_to_landing`), m/s. The brief gives the short one to hops and to falls that are
     * "not very fast". A plain hop on level ground comes down at the speed it left at, 5.7 m/s. A Force user's is
     * lifted for as long as the key is down, until it becomes a Force jump at about 0.12 s (whose landing is Jedi
     * Academy's own), and comes down at 7.4 to 9.6 m/s by how long the tap was (the game's own movement, stepped at
     * 20 to 1,000 frames a second: animBody.test.ts). Started at 9.8, just over that, so every hop of every class
     * lands in the short one, and the longer one is for the drops beyond a hop that do no harm (from about 2.4 m),
     * which only a Force user has: a body with no Force is hurt from 8.5 m/s (1.7 m) and lands those in the hard one.
     */
    soft: number;
    /** How long a landing clip takes to fade in over the falling loop, seconds. The game's own landing fades in over 0.06. */
    fade: number;
    /**
     * How much of a landing clip plays before holding a move key ends it, seconds. A clip never moves the body, so a
     * landing held to its end under a body the keys are already running slides its feet for as long as it has left,
     * which is two seconds of the hard one. Started at the length of the short landing (0.35 s), so every landing
     * shows at least what the short one shows; at 3 no landing is ever cut.
     */
    moveCut: number;
    /** How long a landing cut short takes to fade into the run, seconds: the game's own fade back from a one-off (0.15), a little longer, since it is cut mid-pose. */
    moveFade: number;
  };
  jump: {
    /** How long the jump's start takes to fade in, seconds: the game's own 0.05. */
    fade: number;
  };
  impact: {
    /**
     * How much of the thrown fall's impact the keys are held for, as a share of what is played of the clip: 1 is until
     * it ends, as the brief asks ("once done playing, put into regular prone idle stance"), 0 never.
     */
    lock: number;
    /** How long the impact takes to fade in over the fall, seconds. Short: the ground does not ease in. */
    fade: number;
  };
  /**
   * Where each one-off starts, seconds. The three the brief trims start where it says, counted at 30 frames a second
   * (11 or 12 frames, 7 and 16); the two it does not trim start at their beginning. The importer prints where each
   * clip's feet are at its trim and when they come down.
   */
  trim: Record<TrimId, number>;
}

export const ANIM_TUNE: AnimTune = {
  land: { min: 3.6, soft: 9.8, fade: 0.06, moveCut: 0.35, moveFade: 0.2 },
  jump: { fade: 0.05 },
  impact: { lock: 1, fade: 0.05 },
  trim: { falling_flat_impact: 0.38, falling_to_landing: 0.233, hard_landing: 0.533, jumping_down: 0, jumping_up: 0 },
};

/** What the game shipped with: what a reset puts back. */
export const ANIM_TUNE_SHIPPED: AnimTune = JSON.parse(JSON.stringify(ANIM_TUNE)) as AnimTune;

/** Each number's range: what a typed value is held to, and a slider's ends. */
export const ANIM_RANGES: Record<string, { min: number; max: number }> = {
  'land.min': { min: 0, max: 12 },
  'land.soft': { min: 0, max: 20 },
  'land.fade': { min: 0, max: 0.5 },
  'land.moveCut': { min: 0, max: 3 },
  'land.moveFade': { min: 0, max: 0.6 },
  'jump.fade': { min: 0, max: 0.5 },
  'impact.lock': { min: 0, max: 1 },
  'impact.fade': { min: 0, max: 0.5 },
  'trim.falling_flat_impact': { min: 0, max: 1.4 },
  'trim.falling_to_landing': { min: 0, max: 0.9 },
  'trim.hard_landing': { min: 0, max: 2.2 },
  'trim.jumping_down': { min: 0, max: 0.3 },
  'trim.jumping_up': { min: 0, max: 0.18 },
};

/** The trims that moved, for whoever holds fitted clips (a clip's travel is stripped from its trim on): told once a `tuneAnim` call. */
let onTrims: ((ids: TrimId[]) => void) | null = null;
export function watchTrims(fn: ((ids: TrimId[]) => void) | null): void {
  onTrims = fn;
}

/**
 * Set numbers of the table from a nested object (`{ land: { soft: 8 }, trim: { hard_landing: 0.6 } }`), each held to
 * its range. Answers words for anything held, refused or not known; nothing is saved.
 */
export function tuneAnim(patch: unknown): string[] {
  const words: string[] = [];
  if (!patch || typeof patch !== 'object') return ['tune takes an object: { land: { soft: 8 } }'];
  const moved: TrimId[] = [];
  const table = ANIM_TUNE as unknown as Record<string, Record<string, number>>;
  for (const [group, values] of Object.entries(patch as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(table, group)) {
      words.push(`no group ${group} (land, jump, impact, trim)`);
      continue;
    }
    if (!values || typeof values !== 'object') {
      words.push(`${group} takes an object of its numbers`);
      continue;
    }
    for (const [key, raw] of Object.entries(values as Record<string, unknown>)) {
      const range = ANIM_RANGES[`${group}.${key}`];
      if (!range || !Object.prototype.hasOwnProperty.call(table[group], key)) {
        words.push(`no ${group}.${key}`);
        continue;
      }
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        words.push(`${group}.${key} takes a number`);
        continue;
      }
      const v = Math.min(range.max, Math.max(range.min, raw));
      if (v !== raw) words.push(`${group}.${key} held to ${v} (${range.min} to ${range.max})`);
      if (table[group][key] === v) continue;
      table[group][key] = v;
      if (group === 'trim') moved.push(key as TrimId);
    }
  }
  if (moved.length) onTrims?.(moved);
  return words;
}
