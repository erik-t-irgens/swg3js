// Where the sun's three shadow maps end, as three's cascades ask for it (`CSM`'s `customSplitsCallback`, `mode: 'custom'`).
//
// Three's own `practical` split puts every break at a share of the whole shadow distance (half uniform, half logarithmic),
// so the near map grows with the distance: about 14 m at the Graphics page's 80 m, 54 m at its 320 m default and 134 m at
// 800 m, and a map is 2048 texels whatever it covers, so near shadows went from about 2 cm a texel to 15 as the slider rose.
// The owner kept every shadow slider at its bottom to keep the shadows round him sharp, and lost every shadow past a short
// range to do it (his words: "a near shadow would look good, a mid shadow would look OK, and a far shadow would be a
// suggestion - but right now all shadows are affected in quality"). So the near map ends at a reach of its own, whatever
// the distance; the middle map ends where the near reach and the whole distance meet on a log scale (their geometric
// mean, about 72 m at 320 m and 113 m at 800 m) unless a reach is given; and the far map takes the rest. Each map's blur
// is the page's softness times a share of its own, so how quality falls off with distance is the owner's to set.
//
// Every number here is ours and the owner's eye (CLAUDE.md, "Feel is the owner's"): live through
// `__debug.shadowPass({ splits })` and the `shadowPass` sliders in the debug menu. `scheme: 'practical'` is three's split
// exactly as it was, to compare. Pure: no three, so node's tests run it as the game does.

export type SplitScheme = 'near' | 'practical';

export interface ShadowSplitTune {
  /** 'near' (ships): the near map at a reach of its own. 'practical': three's own split over the whole distance, as before. */
  scheme: SplitScheme;
  /** Metres from the eye the near map ends at, whatever the shadow distance: 16 m is about 2 cm a texel at 2048. */
  nearReach: number;
  /** Metres the middle map ends at; 0 is the geometric mean of the near reach and the shadow distance. */
  midReach: number;
  /** Each map's blur as a share of the page's softness (in that map's own texels), near to far. */
  soft: number[];
}

export const SHADOW_SPLIT_TUNE: ShadowSplitTune = {
  scheme: 'near',
  nearReach: 16,
  midReach: 0,
  soft: [1, 1, 1],
};

/** How far a break may be pushed toward its neighbours (shares of the next break) so the maps stay in order. */
const ORDER_GAP = 1.15;
/** The near reach and the middle reach are held inside these, metres. */
const NEAR_MOST = 200;
const NEAR_LEAST = 2;
const MID_MOST = 4000;
const SOFT_LEAST = 0.25;
const SOFT_MOST = 4;

let version = 0;

/** Moves each time the tune does, so the world refits its cascades once on the next frame (`World.updateShadows`). */
export function shadowSplitsVersion(): number {
  return version;
}

/**
 * The cascades' breaks as three's `CSM` keeps them: each map's far end as a share of `far` (the lesser of the camera's far
 * plane and the shadow distance), ascending, the last always 1. `target` is three's own array, written in place.
 */
export function splitBreaks(amount: number, near: number, far: number, tune: ShadowSplitTune, target: number[]): void {
  target.length = 0;
  const reach = tune.nearReach;
  // The near rule needs room for the maps after it: with the whole distance under twice the near reach the old split is
  // the right one (the maps are short enough to be sharp already).
  if (tune.scheme === 'near' && amount >= 2 && far > reach * 2) {
    let prev = 0;
    for (let i = 1; i < amount; i++) {
      let d: number;
      if (i === 1) d = reach;
      else if (i === 2 && amount === 3 && tune.midReach > 0) d = tune.midReach;
      else d = reach * (far / reach) ** ((i - 1) / (amount - 1));
      // In order, and short of the next: each break at least a share past the last, the last before the far end.
      const least = prev * ORDER_GAP;
      const most = far / ORDER_GAP ** (amount - i);
      d = Math.min(Math.max(d, least), most);
      prev = d;
      target.push(d / far);
    }
    target.push(1);
    return;
  }
  // Three's own `practical` split, written out as its `_getBreaks` writes it (lambda 0.5).
  for (let i = 1; i < amount; i++) {
    const uniform = (near + ((far - near) * i) / amount) / far;
    const log = (near * (far / near) ** (i / amount)) / far;
    target.push(uniform + (log - uniform) * 0.5);
  }
  target.push(1);
}

/** Each map's far end in metres for a shadow distance (the far plane assumed beyond it), for the console and the tests. */
export function splitEnds(amount: number, near: number, distance: number, tune: ShadowSplitTune = SHADOW_SPLIT_TUNE): number[] {
  const breaks: number[] = [];
  splitBreaks(amount, near, distance, tune, breaks);
  return breaks.map((b) => b * distance);
}

/** A map's share of the page's softness (1 past the table's end). */
export function softShare(i: number, tune: ShadowSplitTune = SHADOW_SPLIT_TUNE): number {
  const s = tune.soft[i];
  return typeof s === 'number' && Number.isFinite(s) ? s : 1;
}

/**
 * Move the split tune in memory (never saved), as `__debug.shadowPass({ splits })` and the sliders do: `scheme`,
 * `nearReach`, `midReach` and `soft` (an array near to far, or an object by index). Answers words for anything refused or
 * held, and moves the version only when something really changed.
 */
export function tuneShadowSplits(patch: Record<string, unknown>): string[] {
  const words: string[] = [];
  const t = SHADOW_SPLIT_TUNE;
  let moved = false;
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (k === 'scheme') {
      if (v === 'near' || v === 'practical') {
        if (t.scheme !== v) (t.scheme = v), (moved = true);
      } else words.push("scheme is 'near' (the near map at a reach of its own) or 'practical' (three's split, as before)");
      continue;
    }
    if (k === 'nearReach' || k === 'midReach') {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        words.push(`${k} must be a number of metres`);
        continue;
      }
      const least = k === 'nearReach' ? NEAR_LEAST : 0;
      const most = k === 'nearReach' ? NEAR_MOST : MID_MOST;
      const held = Math.min(most, Math.max(least, v));
      if (held !== v) words.push(`${k} held at ${held} (${least} to ${most} m${k === 'midReach' ? '; 0 is the near reach and the distance met halfway on a log scale' : ''})`);
      if (t[k] !== held) (t[k] = held), (moved = true);
      continue;
    }
    if (k === 'soft') {
      if (!v || typeof v !== 'object') {
        words.push('soft is an array of shares near to far, or an object of them by index');
        continue;
      }
      for (const key of Object.keys(v as object)) {
        const i = Number(key);
        const n = (v as Record<string, unknown>)[key];
        if (!Number.isInteger(i) || i < 0 || i > 7) {
          words.push(`soft has no map ${key}`);
          continue;
        }
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          words.push(`soft[${i}] must be a number`);
          continue;
        }
        const held = Math.min(SOFT_MOST, Math.max(SOFT_LEAST, n));
        if (held !== n) words.push(`soft[${i}] held at ${held} (${SOFT_LEAST} to ${SOFT_MOST})`);
        while (t.soft.length <= i) t.soft.push(1);
        if (t.soft[i] !== held) (t.soft[i] = held), (moved = true);
      }
      continue;
    }
    words.push(`splits has no ${k} (scheme, nearReach, midReach, soft)`);
  }
  if (moved) version++;
  return words;
}
