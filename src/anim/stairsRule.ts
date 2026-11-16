// Stairs found by a rule (wave 3 of the animations, the owner's brief's line 52: "Surfaces that have multiple jagged stair
// shapes at a maximum/minimum height each should trigger stair animations"), never by a mesh's name: the ground's
// heights sampled along the travel, behind the body and ahead of it, and read for risers and treads.
//
//  - a riser is a rise or a fall between `riserMin` and `riserMax` over less than `riserRun` of ground (the gaps between
//    samples that are not level, taken together while they keep one sign);
//  - a tread is ground level within `level` between two risers, at least `treadMin` long (measured from the middle of
//    one riser to the middle of the next, every gap between them level);
//  - stairs are at least `count` risers the same way, each pair with a tread between, up or down by their sign along the
//    travel. A ramp rises in every gap or in none, so it has no riser; a kerb is one riser alone; a wall is a rise past
//    `riserMax`, which breaks the stairs where it stands.
//
// And held (`StairsHold`): on stairs until `leave` is travelled with no riser of their way in the window, so a landing
// halfway up, or a riser missed between two samples, does not flick the clip off.
//
// Pure: the heights come in a kept array, the answer goes out in a kept record, and nothing is made.

import type { LocoTune } from './locoTune.ts';

/** The rule's answer for one window. (Declared as fractions where it holds one.) */
export class StairsFound {
  /** +1 stairs going up along the travel, -1 going down, 0 none. */
  way = 0;
  /** How many risers of that way stand in the longest run of stairs found (0 with none). */
  risers = 0;
  /** Risers of any kind in the window, going up and going down (what the hold reads: a riser of its way keeps it). */
  ups = 0;
  downs = 0;
}

/**
 * The rule over one window: `h[0..n-1]` the ground's heights `step` apart along the travel, the first the farthest
 * behind, NaN where no ground was found (which breaks the window there). Into `out`; the answer's `way` handed back.
 */
export function stairsIn(h: ArrayLike<number>, n: number, step: number, tune: LocoTune['stairs'], out: StairsFound): number {
  out.way = 0;
  out.risers = 0;
  out.ups = 0;
  out.downs = 0;
  const level = tune.level;
  const count = Math.max(1, Math.round(tune.count));
  // The run of stairs being read: its sign, how many risers, the middle of the last riser (in samples), and whether the
  // gaps since that riser have all been level.
  let runSign = 0;
  let runRisers = 0;
  let lastMid = 0;
  let levelSince = true;
  let best = 0;
  let bestSign = 0;
  let k = 0;
  while (k < n - 1) {
    const a = h[k];
    const b = h[k + 1];
    if (!(a === a) || !(b === b)) {
      // No ground here: whatever run was being read ends.
      runSign = 0;
      runRisers = 0;
      levelSince = true;
      k++;
      continue;
    }
    const d = b - a;
    if (d <= level && d >= -level) {
      k++;
      continue;
    }
    // A change: the gaps from k that are not level and keep one sign, taken together.
    const sign = d > 0 ? 1 : -1;
    let total = d;
    let e = k + 1;
    while (e < n - 1) {
      const c = h[e + 1];
      const p = h[e];
      if (!(c === c) || !(p === p)) break;
      const dd = c - p;
      if ((dd <= level && dd >= -level) || (dd > 0 ? 1 : -1) !== sign) break;
      total += dd;
      e++;
    }
    const gaps = e - k;
    const rise = total < 0 ? -total : total;
    const run = gaps * step;
    const mid = k + gaps * 0.5;
    if (rise >= tune.riserMin && rise <= tune.riserMax && run < tune.riserRun) {
      if (sign > 0) out.ups++;
      else out.downs++;
      // A riser: it joins the run when it keeps the run's way and a tread long enough stands between it and the last.
      if (runSign === sign && levelSince && (mid - lastMid) * step >= tune.treadMin) runRisers++;
      else {
        runSign = sign;
        runRisers = 1;
      }
      lastMid = mid;
      levelSince = true;
      if (runRisers > best) {
        best = runRisers;
        bestSign = runSign;
      }
    } else {
      // Not a riser (a ramp's rise, a bump, a wall): the run ends here.
      runSign = 0;
      runRisers = 0;
      levelSince = true;
    }
    k = e;
  }
  if (best >= count) {
    out.way = bestSign;
    out.risers = best;
  }
  return out.way;
}

/**
 * The hold: on stairs from the first window that finds them until `leave` is travelled with no riser of their way in the
 * window (or a window finds stairs the other way). One kept a body; nothing made.
 */
export class StairsHold {
  /** +1 up, -1 down, 0 off stairs. */
  way = 0;
  /** How far has been travelled with no riser of the way held, metres. (Declared as a fraction.) */
  since = 0.5;

  constructor() {
    this.since = 0;
  }

  /** One window's answer, after `travelled` metres since the last: the way held now. */
  step(found: StairsFound, travelled: number, tune: LocoTune['stairs']): number {
    if (found.way !== 0) {
      this.way = found.way;
      this.since = 0;
      return this.way;
    }
    if (this.way === 0) return 0;
    const mine = this.way > 0 ? found.ups : found.downs;
    if (mine > 0) this.since = 0;
    else {
      this.since += travelled;
      if (this.since >= tune.leave) {
        this.way = 0;
        this.since = 0;
      }
    }
    return this.way;
  }

  reset(): void {
    this.way = 0;
    this.since = 0;
  }
}
