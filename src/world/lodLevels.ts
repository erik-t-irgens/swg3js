// The client's own detail levels, at run time (steps 7 and 8 of the frame-time wave).
//
// A placed model or a plant carries the finest level, the lowest, and on a long chain the middle one
// (`tools/swg/lodlevels.mjs`), each with the distance the client itself switched to it at. Each copy of
// a model is drawn at the level its distance from the eye picks, and every copy at one level of one group
// is one instanced draw, so a far street of props costs the lowest level's draws (often one) and a
// fraction of its triangles. The pick has a band of hysteresis either side of each switch distance, so a
// copy standing on a line does not flicker, and a copy's level is only ever looked at a few times a second
// or when the eye has moved a few metres (`sweepMetres`, `sweepSeconds`).
//
// Step 8 divides the switch distances (and the plant reach) by a bias that grows with how fast the eye is
// moving: on a shuttle ride or in a fast ship the detail comes in nearer, where nobody can see it go.
//
// Every number here is ours except the switch distances themselves, which are the client's. Pure: three is
// not imported, so the node test drives the pick, the packing and the bias directly.

/** How the levels are picked and swept. */
export interface LodLevelTune {
  /** False draws every copy at its finest, as before any level was carried. */
  on: boolean;
  /** The client's switch distances are multiplied by this: over 1 keeps each level out farther. */
  bias: number;
  /** The share of a switch distance a copy must pass back beyond before its level changes back. */
  hysteresis: number;
  /** The sweep runs once the eye has moved this far, metres... */
  sweepMetres: number;
  /** ...or this long has gone by, seconds. */
  sweepSeconds: number;
  /**
   * How far up from the lowest carried level the shadow rule reaches: a level it reaches casts no shadow once its
   * switch distance is beyond where the second shadow cascade ends, since every copy drawn at it is then too far
   * for anything but the last cascade. 0 is the design's rule, the lowest level alone: the finest and the middle
   * cast as the finest does. 1 takes the middle too; the finest is never reached. Below 0 the rule is off and
   * every level casts as the finest does.
   */
  shadowLevelMax: number;
  /** The flora's region batches rebuilt a frame at most (a region whose plantings or levels changed). */
  regionsPerFrame: number;
  /** Draw nothing of a copy past its chain's last far, which is inferred to be the client's own draw limit. */
  hideBeyond: boolean;
}

export const LOD_LEVEL_DEFAULTS: Readonly<LodLevelTune> = Object.freeze({ on: true, bias: 1, hysteresis: 0.1, sweepMetres: 8, sweepSeconds: 0.25, shadowLevelMax: 0, regionsPerFrame: 2, hideBeyond: false });

export const LOD_LEVEL_TUNE: LodLevelTune = { ...LOD_LEVEL_DEFAULTS };

/**
 * The level a copy at distance `d` is drawn at: the last of `count` levels whose switch distance
 * (`nears[k] × scale`; `nears[0]` is ignored, the finest starting at the eye) it has reached, held at
 * `prev` while `d` is inside the band `[near(prev) × (1 − h), near(prev + 1) × (1 + h))`, so walking back
 * and forth across a line changes nothing until the whole band is crossed. `count` itself is answered
 * for a copy past `beyond × scale` (its chain's last far with `hideBeyond`; Infinity never), which is the
 * "draw nothing" bucket. `prev` below 0 has no history. Nothing allocated.
 */
export function levelOf(d: number, nears: ArrayLike<number>, count: number, scale: number, h: number, prev: number, beyond = Number.POSITIVE_INFINITY): number {
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1;
  const band = h > 0 && Number.isFinite(h) ? h : 0;
  if (count <= 1) {
    if (!(beyond < Number.POSITIVE_INFINITY)) return 0;
    const cut = beyond * s;
    if (prev === count) return d >= cut * (1 - band) ? count : 0;
    return d >= cut * (1 + band) ? count : 0;
  }
  if (beyond < Number.POSITIVE_INFINITY) {
    const cut = beyond * s;
    if (prev === count) {
      if (d >= cut * (1 - band)) return count;
    } else if (d >= cut * (1 + band)) return count;
  }
  let raw = 0;
  for (let k = 1; k < count; k++) if (d >= nears[k] * s) raw = k;
  if (prev >= 0 && prev < count && raw !== prev) {
    const lo = prev === 0 ? 0 : nears[prev] * s * (1 - band);
    const hi = prev + 1 < count ? nears[prev + 1] * s * (1 + band) : Number.POSITIVE_INFINITY;
    if (d >= lo && d < hi) return prev;
  }
  return raw;
}

/**
 * Sort `n` copies by level (a counting sort, stable): `order` gets the copies' indices, bucket after bucket,
 * and `start[b]` where bucket `b` begins (`start[buckets]` is `n`). Levels outside `[0, buckets)` are put in
 * the last bucket. Nothing allocated: `start` holds `buckets + 1` and `order` holds `n`.
 */
export function packLevels(levels: ArrayLike<number>, n: number, buckets: number, start: Int32Array, order: Int32Array): void {
  for (let b = 0; b <= buckets; b++) start[b] = 0;
  for (let i = 0; i < n; i++) {
    let b = levels[i];
    if (!(b >= 0 && b < buckets)) b = buckets - 1;
    start[b + 1]++;
  }
  for (let b = 0; b < buckets; b++) start[b + 1] += start[b];
  // `start[b]` is used as the write cursor, then put back.
  for (let i = 0; i < n; i++) {
    let b = levels[i];
    if (!(b >= 0 && b < buckets)) b = buckets - 1;
    order[start[b]++] = i;
  }
  for (let b = buckets; b > 0; b--) start[b] = start[b - 1];
  start[0] = 0;
}

/** Whether a sweep is due: never run yet, the eye moved `sweepMetres` since the last, or `sweepSeconds` went by. */
export function sweepDue(age: number, moved: number, tune: LodLevelTune = LOD_LEVEL_TUNE): boolean {
  return age >= tune.sweepSeconds || moved >= tune.sweepMetres;
}

/**
 * Whether a carried level (at `position` in the carried list of `count`, 0 the finest) casts a shadow, given
 * whether the finest would (`base`), its switch distance scaled (`near`) and where the second shadow cascade
 * ends (`cascadeFar`; Infinity or NaN with no cascades known, which keeps every level casting). Only the levels
 * `shadowLevelMax` reaches from the lowest are ever held back, and never the finest.
 */
export function levelCasts(base: boolean, position: number, count: number, near: number, cascadeFar: number, tune: LodLevelTune = LOD_LEVEL_TUNE): boolean {
  if (!base) return false;
  const reach = tune.shadowLevelMax;
  if (!(reach >= 0) || position <= 0 || position < count - 1 - reach) return true;
  return !(near >= cascadeFar);
}

/**
 * Which of a chain's carried levels can ever be drawn, as indices into `nears` (the switch distances, finest
 * first, `nears[0]` ignored): the pick takes the last level whose switch a copy has reached, so a level whose
 * switch is not strictly beyond the finer one kept before it and strictly short of the coarser one kept after
 * it is never picked, and neither is one whose switch is at the eye. Walked from the lowest up, keeping the
 * coarser of two that clash, which is the one the pick already draws there; the finest is always kept. A chain
 * that comes to the finest alone (every switch at 0) is drawn at its finest everywhere. Allocates its answer:
 * run once per model as it loads, never on a frame.
 */
export function drawnLevels(nears: ArrayLike<number>): number[] {
  const kept: number[] = [];
  let next = Number.POSITIVE_INFINITY;
  for (let k = nears.length - 1; k >= 1; k--) {
    const n = nears[k];
    if (n > 0 && n < next) {
      kept.push(k);
      next = n;
    }
  }
  kept.push(0);
  return kept.reverse();
}

// ---------------------------------------------------------------------------------------------
// Step 8: detail comes in nearer while the eye moves fast.

/** How the ride bias grows with the eye's speed. Every number is ours. */
export interface RideLodTune {
  /** False: no bias at any speed. */
  on: boolean;
  /** Metres a second under which there is no bias. */
  from: number;
  /** Metres a second over `from` for each whole step of bias... */
  per: number;
  /** ...up to this. */
  max: number;
  /** How quickly the measured speed follows the eye's, seconds (a teleport is one frame and is not a speed). */
  smoothing: number;
  /**
   * The bias in force moves only in steps of this (`steppedBias`): every change of it re-sweeps every level group
   * and planting whatever their clocks say, and an unstepped bias changed on every frame of a speed change.
   */
  step: number;
}

/**
 * Shipped off, by the design's own rule (on only if it saved 1 ms at the median or 5 ms at the 95th percentile on
 * a flown trip): it saved nothing, and on the ride it cost. Measured on the owner's machine: a passenger ride Theed
 * to Keren at 150 m/s, twelve-frame blocks alternating, 7.0 ms off against 8.7 on at the median (15.8 against 18.7
 * at the 95th) with the same draws either way, 635 and 640 calls -- the ride's eye is 190 m up and every plant and
 * prop under it is at its lowest already, so the bias had nothing left to take and its cost was the sweeping,
 * which then ran on every frame the smoothed speed moved (the bias is stepped since, `step`, and the same ride
 * measured again stepped came to 11.3 off against 12.2 on at the median, 20.1 against 22.8 at the 95th, 1,813 and
 * 1,795 calls: still nothing saved); and a flight at 150 m/s, 30 m over the ground, twice each way, 12.1 and 12.5
 * off against 11.6 and 12.2 on, within the noise.
 * `__debug.ride({ lodBias: { on: true } })` or the frame report's `rideLodBias` puts it on.
 */
export const RIDE_LOD_DEFAULTS: Readonly<RideLodTune> = Object.freeze({ on: false, from: 20, per: 30, max: 5, smoothing: 0.5, step: 0.25 });

export const RIDE_LOD_TUNE: RideLodTune = { ...RIDE_LOD_DEFAULTS };

/** The ride bias at `speed` metres a second: `1 + max(0, speed − from) / per`, at most `max`; 1 when off. */
export function rideLodBias(speed: number, tune: RideLodTune = RIDE_LOD_TUNE): number {
  if (!tune.on || !(speed > tune.from)) return 1;
  const per = tune.per > 0 ? tune.per : 1;
  const top = tune.max >= 1 ? tune.max : 1;
  return Math.min(top, 1 + (speed - tune.from) / per);
}

/**
 * The bias to put in force, from the one worked out now (`raw`) and the one in force (`applied`): kept while the
 * two are within `step` of each other, else `raw` rounded to a whole step; and 1 the moment `raw` is back to 1, so
 * slowing down gives every level back at once rather than a step short. A step of 0 or less follows `raw` exactly.
 */
export function steppedBias(raw: number, applied: number, step: number): number {
  if (!(raw > 1)) return 1;
  if (!(step > 0)) return raw;
  if (Math.abs(raw - applied) < step) return applied;
  return Math.max(1, Math.round(raw / step) * step);
}

/**
 * The eye's speed, smoothed: `prev` eased toward `step / dt` over `smoothing` seconds. A step longer than
 * `jump` metres in one frame is a teleport (a travel, a noclip hop, a jump's arrival) and leaves the speed
 * where it was. A frame of no time changes nothing.
 */
export function eyeSpeed(prev: number, step: number, dt: number, tune: RideLodTune = RIDE_LOD_TUNE, jump = 500): number {
  if (!(dt > 0) || !(step >= 0) || step > jump) return prev;
  const v = step / dt;
  const k = tune.smoothing > 0 ? Math.min(1, dt / tune.smoothing) : 1;
  return prev + (v - prev) * k;
}
