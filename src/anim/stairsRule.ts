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
  /**
   * The stairs wave: the longest run's risers, along the window in samples (each riser's middle, the first sample 0), the
   * ground's height on the side it is come to from (`from`) and the side it goes to (`to`), and the samples it spans
   * (`lo`, `hi`: the last sample before it and the first after it). As many as `risers` (and no more than `RUN_MOST`).
   */
  readonly mids = new Float64Array(RUN_MOST);
  readonly from = new Float64Array(RUN_MOST);
  readonly to = new Float64Array(RUN_MOST);
  readonly lo = new Int32Array(RUN_MOST);
  readonly hi = new Int32Array(RUN_MOST);
  /**
   * Stairs II: every riser in the window, whatever run it is of (its middle in samples and its way, +1 up and -1 down), as
   * many as `all` (at most `RUN_MOST`): what the hold reads for a riser of its way ahead of the body.
   */
  all = 0;
  readonly allMid = new Float64Array(RUN_MOST);
  readonly allWay = new Int8Array(RUN_MOST);
  /**
   * Stairs II, the console's: the last run the window broke, and why (0 none; 1 a rise over `riserMax` over less than
   * `riserRun`, a step but no stair; 2 a tread over `treadMax` between two risers of one way), with that rise or tread in metres.
   */
  refused = 0;
  refusedBy = 0.5;
  /** Stairs II: every riser in the window was placed exactly by the sampler (`stairsIn`'s `exact`), so its treads and the hold's distances are known to the millimetre. */
  placed = false;
}

/**
 * Stairs II: how far past `treadMax` a tread between two risers placed exactly may read and still be a stair's, metres
 * (the sampler places a face to a hair, and the base flight's 2.5x tread, 0.7875 m, must never be refused for 0.79; one of 0.795 always is).
 */
export const PLACED_SLACK = 0.003;

/**
 * Stairs II: a foot lands on the floor beyond a riser once its ankle lands this far past the riser along the travel, metres:
 * its heel clear of the riser's line (the ankle stands about 0.05 m ahead of the heel).
 */
export const FOOT_PAST = 0.06;

/** Stairs II: the stairs end at the footfall that lands the second foot in a row on the floor beyond the last riser (StairEnd). */
export const BEYOND_FEET = 2;


/** Why a run was broken, as the console says it (`StairsFound.refused`). */
export const REFUSED_WORDS: readonly string[] = ['', 'a riser over riserMax', 'a tread over treadMax'];

/** The most risers of one run kept (a window of 4 m at 0.03 a sample holds no more than a 0.18 m tread's 22). */
export const RUN_MOST = 64;
/** The run being read, kept beside the longest: copied over it when it grows past it. */
const curMid = new Float64Array(RUN_MOST);
const curFrom = new Float64Array(RUN_MOST);
const curTo = new Float64Array(RUN_MOST);
const curLo = new Int32Array(RUN_MOST);
const curHi = new Int32Array(RUN_MOST);

/**
 * The rule over one window: `h[0..n-1]` the ground's heights `step` apart along the travel, the first the farthest
 * behind, NaN where no ground was found (which breaks the window there). Into `out`; the answer's `way` handed back.
 */
export function stairsIn(h: ArrayLike<number>, n: number, step: number, tune: LocoTune['stairs'], out: StairsFound, exact?: ArrayLike<number>): number {
  out.way = 0;
  out.risers = 0;
  out.ups = 0;
  out.downs = 0;
  out.all = 0;
  out.refused = 0;
  out.placed = exact !== undefined;
  const level = tune.level;
  const treadMax = tune.treadMax;
  const count = Math.max(1, Math.round(tune.count));
  // The run of stairs being read: its sign, how many risers, the middle of the last riser (in samples), and whether the
  // gaps since that riser have all been level.
  let runSign = 0;
  let runRisers = 0;
  let lastMid = 0;
  let lastExact = false;
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
    // Stairs II: a riser within one gap placed exactly where the sampler found its face (`exact`, in samples), else the gap's
    // middle, known to half a sample.
    const ex = exact !== undefined && gaps === 1 ? exact[k] : Number.NaN;
    const isExact = ex === ex;
    const mid = isExact ? ex : k + gaps * 0.5;
    if (rise >= tune.riserMin && rise <= tune.riserMax && run < tune.riserRun) {
      if (sign > 0) out.ups++;
      else out.downs++;
      // Stairs II: every riser kept, with its way.
      if (out.all < RUN_MOST) {
        out.allMid[out.all] = mid;
        out.allWay[out.all] = sign;
        out.all++;
      }
      if (!isExact) out.placed = false;
      // A riser: it joins the run when it keeps the run's way and a tread long enough, and (Stairs II) no longer than
      // `treadMax`, stands between it and the last. Two risers placed exactly (`exact`) measure their tread to the
      // millimetre, and a tread over `treadMax` by more than `PLACED_SLACK` breaks the run. Otherwise a riser's middle is
      // known to half a sample either way, so a tread over the samples to a sample's step: it is over `treadMax` once it
      // passes it by more than half a step (with the samples a tenth of a metre apart, a tread up to 0.8 m is a stair's
      // wherever the lattice falls and one of 0.9 m or more never is; between them it hung on where the lattice fell, which
      // read one tread of a flight of 0.82 m treads as too long and the next as a stair's: the review of Stairs II).
      const tread = (mid - lastMid) * step;
      const longest = treadMax + (isExact && lastExact ? PLACED_SLACK : step * 0.5);
      if (runSign === sign && levelSince && tread >= tune.treadMin && tread <= longest) runRisers++;
      else {
        if (runSign === sign && levelSince && tread > longest) {
          out.refused = 2;
          out.refusedBy = tread;
        }
        runSign = sign;
        runRisers = 1;
      }
      lastMid = mid;
      lastExact = isExact;
      levelSince = true;
      // The stairs wave: where the riser stands and its two treads' heights, kept with its run.
      if (runRisers <= RUN_MOST) {
        const r = runRisers - 1;
        curMid[r] = mid;
        curFrom[r] = a;
        curTo[r] = h[e];
        curLo[r] = k;
        curHi[r] = e;
      }
      if (runRisers > best) {
        best = runRisers;
        bestSign = runSign;
        const m = runRisers < RUN_MOST ? runRisers : RUN_MOST;
        for (let r = 0; r < m; r++) {
          out.mids[r] = curMid[r];
          out.from[r] = curFrom[r];
          out.to[r] = curTo[r];
          out.lo[r] = curLo[r];
          out.hi[r] = curHi[r];
        }
      }
    } else {
      // Not a riser (a ramp's rise, a bump, a wall): the run ends here. Stairs II: one over `riserMax` that a riser's run
      // would have been (a step the step-up takes, but no stair) is said.
      if (rise > tune.riserMax && run < tune.riserRun) {
        out.refused = 1;
        out.refusedBy = rise;
      }
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
 * Stairs II: the risers about the body for the hold under 'ahead', worked out by the sampler from a window's `all` (metres
 * along the travel from the body's middle; Infinity for none): for each way the nearest riser ahead, how far the next riser
 * of that way stands beyond it (its tread), and the nearest riser of that way behind. Declared as fractions.
 */
export class StairsAhead {
  up = 0.5;
  upGap = 0.5;
  upBehind = 0.5;
  down = 0.5;
  downGap = 0.5;
  downBehind = 0.5;
  constructor() {
    this.clear();
  }
  clear(): void {
    this.up = Number.POSITIVE_INFINITY;
    this.upGap = Number.POSITIVE_INFINITY;
    this.upBehind = Number.POSITIVE_INFINITY;
    this.down = Number.POSITIVE_INFINITY;
    this.downGap = Number.POSITIVE_INFINITY;
    this.downBehind = Number.POSITIVE_INFINITY;
  }
  /** From a window's risers (`f.all`), the body `body` samples along it, the samples `step` apart. */
  fill(f: StairsFound, body: number, step: number): void {
    this.clear();
    for (let r = 0; r < f.all; r++) {
      const d = (f.allMid[r] - body) * step;
      if (f.allWay[r] > 0) {
        if (d <= 0) this.upBehind = -d;
        else if (this.up === Number.POSITIVE_INFINITY) this.up = d;
        else if (this.upGap === Number.POSITIVE_INFINITY) this.upGap = d - this.up;
      } else if (d <= 0) this.downBehind = -d;
      else if (this.down === Number.POSITIVE_INFINITY) this.down = d;
      else if (this.downGap === Number.POSITIVE_INFINITY) this.downGap = d - this.down;
    }
  }
}

/** The risers about the body, for the console (`__debug.loco`'s `stairs.aheadM`): metres to the millimetre, null for none. */
export function aheadReport(a: StairsAhead): Record<string, number | null> {
  const m = (v: number) => (v === Number.POSITIVE_INFINITY ? null : Math.round(v * 1000) / 1000);
  return { up: m(a.up), upTread: m(a.upGap), upBehind: m(a.upBehind), down: m(a.down), downTread: m(a.downGap), downBehind: m(a.downBehind) };
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

  /**
   * Stairs II (`stairs.hold` 'ahead'): the way is held but no riser of it stands ahead within `treadMax` any more (the last
   * riser passed, or a landing longer than a tread begun): the stride under way finishes on the floor beyond and the
   * regular clip takes over at its footfall (`StairEnd`), the hold letting go by itself `treadMax` further on.
   */
  ending = false;

  constructor() {
    this.since = 0;
  }

  /**
   * Stairs II, the hold under `stairs.hold` 'ahead' (the risers about the body in `a`: `StairsAhead`): stairs are held while
   * a riser of their way stands ahead of the body within `treadMax` and the tread the body stands on (from the riser behind
   * it to that one) is no longer than `treadMax`; once not (the last riser passed, or a landing longer than a tread begun),
   * the hold is `ending` until `treadMax` more is travelled or stairs are taken on again. They are taken on (from the floor,
   * a landing, or while ending) once a run is found with its first riser ahead within one of its own treads (and within
   * `treadMax`): the walk carries on to the stride that steps onto it. The way held now.
   */
  stepAhead(found: StairsFound, travelled: number, tune: LocoTune['stairs'], a: StairsAhead): number {
    // A riser's middle is known to half a sample (`stairsIn`): a distance between two of them, or from the body to one, to a
    // sample's step, and so a tread up to `treadMax` may read half a step more. Placed exactly (`found.placed`), a hair.
    const slack = found.placed ? PLACED_SLACK : tune.step * 0.5;
    const most = tune.treadMax + slack;
    const fw = found.way;
    const fAhead = fw > 0 ? a.up : a.down;
    const fGap = fw > 0 ? a.upGap : a.downGap;
    // A run's first tread is known only where the riser after its first stands in the window too (`look` reaches far enough
    // ahead for a tread of `treadMax`: see its note). It is taken on within one of its treads, or `takeOn` where that is
    // further (before the capsule meets its first riser).
    const fresh = fw !== 0 && fAhead <= most && fGap < Number.POSITIVE_INFINITY && fAhead <= (fGap > tune.takeOn ? fGap : tune.takeOn) + slack;
    if (fresh && (this.way === 0 || this.ending || fw !== this.way)) {
      this.way = fw;
      this.ending = false;
      this.since = 0;
      return this.way;
    }
    if (this.way === 0) return 0;
    // On a tread of the stairs: the riser ahead within `treadMax`, and either the tread from the riser behind to it no longer
    // than `treadMax`, or the riser ahead a run's first within one of its treads (taken on from the floor or a landing).
    const ahead = this.way > 0 ? a.up : a.down;
    const behind = this.way > 0 ? a.upBehind : a.downBehind;
    const gap = this.way > 0 ? a.upGap : a.downGap;
    if (!this.ending && ahead <= most && (ahead + behind <= most || (gap < Number.POSITIVE_INFINITY && ahead <= (gap > tune.takeOn ? gap : tune.takeOn) + slack))) {
      this.since = 0;
      return this.way;
    }
    if (!this.ending) {
      this.ending = true;
      this.since = 0;
    } else this.since += travelled;
    if (this.since >= most) {
      this.way = 0;
      this.ending = false;
      this.since = 0;
    }
    return this.way;
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
    this.ending = false;
  }
}

/**
 * Stairs II: what a body's legs hand `StairEnd.note` after the step, field by field (a kept record: no number crosses a
 * call). The clip's time and this frame's advance of it (seconds), the facts' rate, the body's ground speed (m/s), the
 * stair step's stride and the figure's scale; the risers of the way held about the body's middle, along the travel
 * (`StairsAhead`: the nearest ahead, the tread from it to the next, the nearest behind; Infinity for none); the hold's
 * `ending` and `treadMax`; and the foot the feet hold planted furthest along the travel (0 left, 1 right, -1 none).
 */
export class EndAsk {
  time = 0.5;
  adv = 0.5;
  rate = 0.5;
  speed = 0.5;
  stride = 0.5;
  scale = 0.5;
  ahead = 0.5;
  gap = 0.5;
  behind = 0.5;
  ending = false;
  treadMax = 0.5;
  /** The hold's `takeOn`, metres. */
  takeOn = 0.5;
  lead = -1;
  /** Under `stairs.hold` 'ahead' (the landing foot is judged); else only the hold's own ending is. */
  judge = false;
  /** The stair clip's facts: how far a footfall reaches along the stride, the cycle's length and how many footfalls it has (fields, so no number crosses `note`'s call: two handed to it were 32 bytes a frame). */
  fwd = 0.5;
  len = 0.5;
  steps = 0;
  constructor() {
    this.time = 0;
    this.adv = 0;
    this.rate = 1;
    this.speed = 0;
    this.stride = 1;
    this.scale = 1;
    this.ahead = Number.POSITIVE_INFINITY;
    this.gap = Number.POSITIVE_INFINITY;
    this.behind = Number.POSITIVE_INFINITY;
    this.treadMax = 0.79;
    this.takeOn = 0.5;
    this.fwd = 0;
    this.len = 1;
  }
}

/**
 * Stairs II: the stair clip given way at the footfall that lands a foot on the floor beyond the last riser (the owner's
 * "end the last 'step' with a foot to be the bottom ... then switch to regular animations"). Kept by whatever plays a body's
 * legs (the player's `BodyLoco`, another player's `PeerLoco`): `plays` asked in the plan (whether the stairs held are still
 * played), `note` after the step with an `EndAsk`. A footfall of the clip inside this frame's advance hands the legs to the
 * regular clip when the foot it lands (the facts' landing place, at the stride and scale, from where the body's middle will
 * be by then) stands past the last riser of the flight (the nearest riser ahead within it by `FOOT_PAST`, and the tread
 * from that riser to the next over `treadMax`, or none beyond): judged by where the foot lands and never by when the body's
 * middle passes the riser, which landed on one footfall at 30 frames a second and the next at 60 (the review of Stairs II).
 * Once the hold is `ending` too, the clip's next footfall hands over whatever it lands on. The change is made at a footfall,
 * never in the middle of a stance, where the regular clip's foot would stand far from the planted one: switched by the feet's
 * own plant instead, a walk up slid its planted foot 8 to 12 cm. And for the stances after (`carry`, counted by `foot` from
 * the foot the feet hold planted furthest along the travel): a planted foot is held where its sole stands (`stairs.pin`)
 * through each foot's first stance under the regular clip, so the change slides no foot along the floor more than the stairs
 * did. One kept a body; nothing made.
 */
export class StairEnd {
  /** The stairs held have given way: they are walked off by the regular clip until the hold lets go or takes stairs on again. */
  landed = false;
  /** Feet still to be planted under the pin after the hand-over (each foot's first stance under the regular clip). */
  carry = 0;
  /** The foot planted furthest along the travel when `carry` last counted (0 left, 1 right, -1 none). */
  private carryLead = -1;
  /** The hold has been seen ending since the stairs gave way (a later frame not ending is the stairs taken on again). */
  private endSeen = false;
  /** Footfalls of the clip in a row that landed past the last riser (BEYOND_FEET of them end the stairs). */
  private beyond = 0;

  /** Whether the stairs held (`stairs`, the hold's `ending`) are still played this frame. */
  plays(stairs: number, ending: boolean): boolean {
    if (stairs === 0) {
      this.landed = false;
      this.endSeen = false;
      this.beyond = 0;
      return false;
    }
    if (ending) this.endSeen = this.landed;
    else if (this.endSeen) {
      // Ending seen and then not: stairs taken on again (the next flight past a landing).
      this.landed = false;
      this.endSeen = false;
      this.beyond = 0;
    }
    return !this.landed;
  }

  /** Every frame, the foot the feet hold planted furthest along the travel (0 left, 1 right, -1 none): the hand-over's pin carried until each foot has planted once more under the regular clip. */
  foot(lead: number): void {
    if (this.carry > 0 && lead >= 0 && lead !== this.carryLead) {
      this.carry--;
      this.carryLead = lead;
    }
  }

  /** After the step, with the stair clip's footfalls (`at`, `off`; `q.steps` of them in a cycle of `q.len`): whether a footfall in this frame's advance ends the stairs. */
  note(q: EndAsk, at: Float64Array, off: Float64Array): void {
    const fwd = q.fwd;
    const steps = q.steps;
    const len = q.len;
    if (this.landed || !(q.time === q.time) || !(len > 0) || !(q.adv > 0)) return;
    if (!q.judge && !q.ending) return;
    const t = q.time - Math.floor(q.time / len) * len;
    const end = t + q.adv;
    for (let k = 0; k < steps; k++) {
      let a = at[k];
      // The footfall's next time after `t` (a cycle on where it already went by).
      if (a <= t) a += len * Math.ceil((t - a) / len + 1e-12);
      if (!(a > t && a <= end)) continue;
      let ends = q.ending;
      if (q.judge) {
        // Where the foot lands, from the body's middle as it will stand at the footfall, and the risers from there: past the
        // last riser of the flight, and the footfall before it too (both feet on the floor beyond, so the regular clip starts
        // from a stride on the floor: started from the first, while the other foot stood a long tread back on the stairs, the
        // owner's longest treads slid the walk's first planted foot 16 to 28 cm).
        // (The risers are measured from where the body stands after the frame's move, which is where the clip stands at the
        // end of its advance: the body's middle at the footfall stands what the clip goes on after it short of there. Measured
        // from the frame's start instead, every foot was judged a frame's travel too far along, 7 cm at a jog at 30 frames a
        // second and 1 at 240, and the hand-over came a footfall earlier or later by rate.)
        const moved = q.rate > 0 ? (q.speed * (a - end)) / q.rate : 0;
        const lands = (off[k] + (q.stride - 1) * fwd * 0.5) * q.scale;
        // The tread the foot lands on: from the riser just behind it (one it has stepped past: none, and it is no flight's end)
        // to the one just ahead of it (none ahead, or further than `treadMax`: past the flight).
        const r1 = q.ahead - moved;
        const over = r1 <= lands - FOOT_PAST;
        const back = over ? r1 : q.behind;
        const tread = over ? q.gap : r1 + q.behind;
        // And never where the hold would take the next flight on again by the clip's next footfall (its first riser within one
        // of its treads, or `takeOn`, of where the body's middle will stand then: a landing too short for a stride of the regular
        // clip, where handing over flickered to it and back for a frame or two, at some rates and not others).
        const next = (over ? r1 + q.gap : r1) - (q.rate > 0 && steps > 0 ? (q.speed * len) / steps / q.rate : 0);
        const nextGap = over ? Number.POSITIVE_INFINITY : q.gap;
        const taking = next <= (nextGap < Number.POSITIVE_INFINITY && nextGap > q.takeOn ? nextGap : q.takeOn) + PLACED_SLACK;
        const past = back < Number.POSITIVE_INFINITY && !(tread <= q.treadMax + PLACED_SLACK) && !taking;
        this.beyond = past ? this.beyond + 1 : 0;
        ends = this.beyond >= BEYOND_FEET;
      }
      if (ends) {
        this.landed = true;
        this.endSeen = q.ending;
        this.carry = 2;
        this.carryLead = q.lead;
        return;
      }
    }
  }

  /** Whether a foot planted now is held where its sole stands (the stairs' own pin carried over the hand-over). */
  get pins(): boolean {
    return this.carry > 0;
  }

  reset(): void {
    this.landed = false;
    this.endSeen = false;
    this.beyond = 0;
    this.carry = 0;
    this.carryLead = -1;
  }
}
