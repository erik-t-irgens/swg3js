// One step a stair (the stairs wave, part C; the owner's 2026-11-15: "make sure every step gets to the next stair and moves
// the gait at a certain speed to match correctly").
//
// On stairs the sampler has measured (src/player/stairSense.ts: their tread, their riser, where the next riser stands),
// under `stairs.stepRule` 'stairs', with a stair clip's facts measured on the figure's own skeleton (src/anim/stairCycle.ts):
//  - how many treads a step takes, `n`: under 'auto' the n whose n treads and n risers are nearest the clip's own step
//    (its forward travel and its rise, at the figure's size; a clip whose rise is all in its legs counts its travel alone),
//    then one more while the clip's rate at the speed asked would pass `upAt` and the next n's would not fall under
//    `rateLow`; held while on the same flight (chosen again only for another clip, the other way, or a tread or riser
//    changed by `resize`); or '1', '2', '3' forced (never past `nMost` under 'auto');
//  - the speed (the owner's "combo of a and b"): the clip's own pace for these stairs (one clip step every n treads at its
//    own rate) eased toward the class's by `pace`, then held so the clip's rate stays within `rateLow` to `rateHigh`;
//  - the clip's phase driven by the distance gone along the stairs, each of the cycle's steps (from a footfall to the next,
//    which need not be even: the walk up's are 0.73 and 0.63 s) over n treads (its own clip seconds a metre), each footfall
//    steered so its foot lands `land` of the way along a tread: the footfall at least `steer` of a step ahead (held until
//    it has happened) has its landing worked out from the phase and the foot's own place as it lands, and each frame's move
//    takes its share of what it would miss by (the move over what is left to go), so it lands on the spot as it happens;
//    the spot is n treads on from the last footfall's (`spot`, carried along by the move), so the two feet of a cycle never
//    land 1 and 3 treads apart; a clip just taken on is started at the phase that lands so;
//  - the stride the feet are reached by (`stride`): n treads over the clip's own step, so a planted foot stays where it
//    landed while the body goes n treads a step (the feet's placement, src/player/footIk.ts, moves each foot along the
//    stairs by it about the middle of its own stance, `pivotL` and `pivotR`: about the body's middle a foot that lands
//    further ahead in the clip landed further still, the run up's right foot 15 cm past its left at two treads a step).
// Pure: numbers in a kept record and out in fields, nothing made.

import type { LocoTune } from './locoTune.ts';
import type { StairCycleFacts } from './stairCycle.ts';

/** A frame of the stairs and the body as the step needs it (written by the caller; declared as fractions). */
export class StairStepIn {
  dt = 0.5;
  /** The sampler's measure: whether it stands, the way (+1 up), the tread and riser, how far ahead the next riser stands (NaN none). */
  known = false;
  way = 0;
  tread = 0.5;
  riser = 0.5;
  next = 0.5;
  /** The speed the class asks, m/s. */
  asked = 0.5;
  /** The figure's scale (its rig's root). */
  scale = 1.5;
  /** How far behind the body's middle the last riser stands, metres (NaN: none in the sampler's window: the floor before a flight). */
  prev = 0.5;
  /** How far the body went along the stairs' travel since last frame, metres. */
  moved = 0.5;
  /** The clip's time now, seconds (NaN: it is not playing yet). */
  time = 0.5;
  /**
   * The foot planted furthest along the travel last frame (0 left, 1 right, -1 none: the feet's `leadSide`) and its ankle's
   * place along the travel from the body's middle then, metres (`leadAt`): what a clip just taken on keeps where it stands.
   */
  lead = -1;
  leadAt = 0.5;
}

/** A clip step a fall of under this, metres, counts its travel alone (its rise is all in its legs). */
const RISE_LEAST = 0.05;

export class StairStep {
  /** Treads a step. */
  n = 1;
  /** The answers: the speed (m/s), the clip's rate, the stride's scale along the stairs, a time to start the clip at (NaN: none). (Declared as fractions.) */
  speed = 0.5;
  rate = 0.5;
  stride = 1.5;
  snap = 0.5;
  /** What the next footfall would miss its tread's spot by this frame, metres (the console's). */
  miss = 0.5;
  /** The clip's own pace for these stairs (m/s), and the rate the speed asked would need (the console's). */
  own = 0.5;
  wanted = 0.5;
  /** The middle of each foot's stance along the travel from the body's middle (left, right), metres at the figure's size: what the stride scales a foot about. */
  pivotL = 0.5;
  pivotR = 0.5;
  /** The spot the footfall being steered lands on, along the travel from the body's middle, metres (NaN: none yet). Carried by the move. */
  spot = 0.5;
  /** What `n` was chosen for. */
  private heldFor: StairCycleFacts | null = null;
  private heldWay = 0;
  private heldT = 0.5;
  private heldR = 0.5;
  private heldRule = '';
  /** The footfall being steered (its place in the facts, -1 none), the facts it is of, and its distance to go last frame. */
  private steerK = -1;
  private steerFor: StairCycleFacts | null = null;
  private steerWas = 0.5;
  /** `reach`'s question (a clip time, metres a step) and answers (clip seconds a metre, the distances to the two footfalls). */
  private qT = 0.5;
  private qD = 0.5;
  private qC = 0.5;
  private q0 = 0.5;
  private q1 = 0.5;

  constructor() {
    this.speed = 0;
    this.rate = 1;
    this.stride = 1;
    this.snap = Number.NaN;
    this.miss = 0;
    this.own = 0;
    this.wanted = 0;
    this.heldT = 0;
    this.heldR = 0;
    this.pivotL = 0;
    this.pivotR = 0;
    this.spot = Number.NaN;
  }

  /** Off the stairs: `n` chosen afresh next time. */
  reset(): void {
    this.heldFor = null;
    this.heldWay = 0;
    this.stride = 1;
    this.snap = Number.NaN;
    this.miss = 0;
    this.steerK = -1;
    this.steerFor = null;
    this.pivotL = 0;
    this.pivotR = 0;
    this.spot = Number.NaN;
  }

  /** The rate a speed asks of the clip with n treads a step (the share eased toward the class's), its pace one clip step every n treads. */
  private rateAt(f: StairStepIn, facts: StairCycleFacts, n: number, tune: LocoTune['stairs']): number {
    const own = (n * f.tread * facts.steps) / facts.len;
    return own > 0 ? 1 + tune.pace * (f.asked / own - 1) : 1;
  }

  /** How many treads a step takes, chosen afresh where the flight, the clip or the rule changed (see the header). */
  private choose(f: StairStepIn, facts: StairCycleFacts, tune: LocoTune['stairs']): void {
    const rule = tune.perStep;
    const T = f.tread;
    const R = f.riser;
    const same = this.heldFor === facts && this.heldWay === f.way && this.heldRule === rule && this.heldT > 0 && Math.abs(T - this.heldT) <= tune.resize * this.heldT && (this.heldR <= 0 || Math.abs(R - this.heldR) <= tune.resize * this.heldR);
    if (same) return;
    // Another flight, clip or size: the spot carried from the last footfall is of the old measure (a landing's long tread
    // averaged in made the tread half again too long, and steering on to n of those treads stalled the clip).
    this.spot = Number.NaN;
    this.steerK = -1;
    this.heldFor = facts;
    this.heldWay = f.way;
    this.heldRule = rule;
    this.heldT = T;
    this.heldR = R;
    if (rule !== 'auto') {
      this.n = rule === '1' ? 1 : rule === '2' ? 2 : 3;
      return;
    }
    const most = Math.max(1, Math.min(3, Math.round(tune.nMost)));
    const fwd = facts.fwd * f.scale;
    const rise = (facts.rise < 0 ? -facts.rise : facts.rise) * f.scale;
    let best = 1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let n = 1; n <= most; n++) {
      let cost = fwd > 0 ? Math.abs(n * T - fwd) / fwd : 0;
      if (rise >= RISE_LEAST) cost += Math.abs(n * R - rise) / rise;
      if (cost < bestCost) {
        bestCost = cost;
        best = n;
      }
    }
    // Running fast (a running clip: the walk's speed is held to the band instead): a longer step while the clip would outrun
    // the band's top at this one, and the next would not fall under its foot.
    while (facts.run && best < most && this.rateAt(f, facts, best, tune) > tune.upAt && this.rateAt(f, facts, best + 1, tune) >= tune.rateLow) best++;
    this.n = best;
  }

  /**
   * The speed on these stairs (before the move): `n` chosen, the clip's own pace, the share toward the class's speed, held
   * to the rate band. With the stairs' size not measured, the clip's own step is the tread.
   */
  plan(f: StairStepIn, facts: StairCycleFacts, tune: LocoTune['stairs']): void {
    const T = f.known && f.tread > 0 ? f.tread : facts.fwd * f.scale;
    if (f.known && f.tread > 0) this.choose(f, facts, tune);
    else this.n = 1;
    const own = (this.n * T * facts.steps) / facts.len;
    this.own = own;
    let speed = own + tune.pace * (f.asked - own);
    const lo = tune.rateLow * own;
    const hi = tune.rateHigh * own;
    if (speed < lo) speed = lo;
    else if (speed > hi) speed = hi;
    this.speed = speed;
    this.wanted = own > 0 ? f.asked / own : 1;
    const fwd = facts.fwd * f.scale;
    let k = fwd > 0 ? (this.n * T) / fwd : 1;
    if (k < 0.5) k = 0.5;
    else if (k > 3) k = 3;
    this.stride = k;
    // Each foot's stance's middle: where it lands in the clip less half the clip's step (a cycle's footfalls are one of each
    // foot; a one-footfall clip's both feet the one's).
    const half = facts.fwd * 0.5;
    const s0 = facts.side[0];
    const p0 = (facts.off[0] - half) * f.scale;
    const p1 = facts.steps > 1 ? (facts.off[1] - half) * f.scale : p0;
    this.pivotL = s0 === 0 ? p0 : p1;
    this.pivotR = s0 === 0 ? p1 : p0;
  }

  /**
   * The step the clip is in at `qT` (from a footfall to the next: a cycle's two need not be even) and its clip seconds a
   * metre along the stairs (`qC`), `qD` metres a step; and how far the body goes from there to each footfall (`q0`, `q1`,
   * metres: the phase is the distance), the step's end at this step's pace, the other footfall a step on (Infinity none).
   */
  private reach(facts: StairCycleFacts): void {
    const t = this.qT;
    const D = this.qD;
    const len = facts.len;
    const a0 = facts.at[0];
    const a1 = facts.at[1];
    let c = D > 0 ? len / facts.steps / D : 0;
    let d0 = Number.POSITIVE_INFINITY;
    let d1 = Number.POSITIVE_INFINITY;
    if (c > 0) {
      if (facts.steps > 1) {
        const first = t >= a0 && t < a1;
        c = (first ? a1 - a0 : len - (a1 - a0)) / D;
        if (first) {
          d1 = (a1 - t) / c;
          d0 = d1 + D;
        } else {
          let r = a0 - t;
          r -= Math.floor(r / len) * len;
          d0 = r / c;
          d1 = d0 + D;
        }
      } else {
        let r = a0 - t;
        r -= Math.floor(r / len) * len;
        d0 = r / c;
      }
    }
    this.qC = c;
    this.q0 = d0;
    this.q1 = d1;
  }

  /**
   * The clip's rate this frame (after the move): the distance gone along the stairs at the clip's seconds a metre, and this
   * move's share of what the steered footfall would miss its tread by; a clip not yet playing is started (`snap`) where its
   * next footfall lands on a tread's spot.
   */
  step(f: StairStepIn, facts: StairCycleFacts, tune: LocoTune['stairs']): void {
    const T = f.known && f.tread > 0 ? f.tread : facts.fwd * f.scale;
    const n = f.known && f.tread > 0 ? this.n : 1;
    const len = facts.len;
    const D = n * T;
    this.snap = Number.NaN;
    this.miss = 0;
    let corr = 0;
    const playing = f.time === f.time;
    let t = playing ? f.time : 0;
    t -= Math.floor(t / len) * len;
    const moved = f.moved > 0 ? f.moved : 0;
    // The spot being steered for, carried along with the body's move.
    if (this.spot === this.spot) this.spot -= f.moved;
    const steps = facts.steps;
    const a0 = facts.at[0];
    const a1 = facts.at[1];
    this.qT = t;
    this.qD = D;
    this.reach(facts);
    const c = this.qC;
    const d0 = this.q0;
    const d1 = this.q1;
    if (f.known && f.next === f.next && c > 0) {
      // The footfall steered: the next one at least `steer` of a step ahead (one nearer lands where it lands), how far the
      // body goes till it, and its foot.
      const least = tune.steer * D;
      let k = this.steerK;
      let toGo = Number.POSITIVE_INFINITY;
      // The footfall being steered is kept until it has happened (its distance to go jumps back up a cycle).
      if (playing && k >= 0 && k < steps && this.steerFor === facts) {
        const m = k === 0 ? d0 : d1;
        if (m <= this.steerWas + 1e-6) toGo = m;
      }
      let fresh = false;
      if (toGo === Number.POSITIVE_INFINITY) {
        fresh = true;
        k = -1;
        if (d0 >= least) {
          toGo = d0;
          k = 0;
        }
        if (steps > 1 && d1 >= least && d1 < toGo) {
          toGo = d1;
          k = 1;
        }
        if (k < 0) {
          // A one-footfall clip's footfall nearer than `least`: the same one a cycle on.
          toGo = d0 + D;
          k = 0;
        }
      }
      this.steerK = k;
      this.steerFor = facts;
      this.steerWas = toGo;
      // The clip's time is where the body stood before this frame's move (the rate below catches it up), so the body reaches
      // the footfall `toGo` less this move from where it stands now; its foot's middle lands there (the ankle carried by the
      // stride about the middle of its own stance, which puts it half the stride's gain on a step ahead of where the clip
      // lands it, the foot itself its own length).
      const lands = toGo - moved + (facts.off[k] + (this.stride - 1) * facts.fwd * 0.5 + facts.mid[k]) * f.scale;
      if (fresh) {
        // The spot: n treads on from the last footfall's (as many steps on as the landing lies), so the cycle's two feet
        // keep n treads apart however unevenly the clip lands them; with no last footfall (or one gone by more than half a
        // step from this one's measure), the spot nearest where it lands.
        let want = lands;
        const prev = this.spot;
        if (prev === prev && D > 0) {
          const s = Math.round((lands - prev) / D);
          const w = prev + (s < 1 ? 1 : s) * D;
          if (w - lands <= 0.5 * D && lands - w <= 0.5 * D) want = w;
        }
        this.spot = want;
      }
      // On the tread nearest it: `land` of the way along a tread (the treads begin at the next riser and every tread from
      // it), found again each frame so the sampler's measure keeps it on its tread.
      // With no riser behind (the floor before a flight, up or down) the floor is no tread: the spot is past the next riser.
      let j = Math.round((this.spot - f.next) / T - tune.land);
      if (j < 0 && f.prev !== f.prev) j = 0;
      this.spot = f.next + (j + tune.land) * T;
      const miss = this.spot - lands;
      this.miss = miss;
      if (!playing) {
        const ls = f.lead;
        const kk = ls < 0 ? -1 : facts.side[0] === ls ? 0 : steps > 1 && facts.side[1] === ls ? 1 : -1;
        t = Number.NaN;
        if (kk >= 0) {
          // A foot already planted where the clip is taken on (the walk put it down, or the step before a landing) is kept
          // where it stands: the clip starts in that foot's stance, as far past its footfall as the foot now stands behind
          // where the clip lands it (so the change of clip slides no planted foot; the next footfall is steered as ever).
          // A foot ahead of where the clip lands one is held by the feet for what it is ahead (the walk waits for it first:
          // `BodyLoco`); one already past its stance's end is about to lift, and the next footfall is put on a spot instead.
          const span = steps > 1 ? (kk === 0 ? a1 - a0 : len - (a1 - a0)) : len;
          let back = (facts.off[kk] + (this.stride - 1) * facts.fwd * 0.5) * f.scale - (f.leadAt - f.moved);
          if (back < 0) back = 0;
          if (back < D) t = facts.at[kk] + (back * span) / D;
        }
        if (t !== t) {
          // The next footfall at least `least` ahead of the phase taken lands on a tread's spot: from the first guess, each
          // try moved by its miss at its own step's pace (the step it falls in can change as the phase moves).
          t = -miss * c;
          for (let i = 0; i < 4; i++) {
            t -= Math.floor(t / len) * len;
            this.qT = t;
            this.reach(facts);
            let go = this.q0;
            let kq = 0;
            if (!(go >= least)) go = Number.POSITIVE_INFINITY;
            if (steps > 1 && this.q1 >= least && this.q1 < go) {
              go = this.q1;
              kq = 1;
            }
            if (go === Number.POSITIVE_INFINITY) go = this.q0 + D;
            const lq = go - moved + (facts.off[kq] + (this.stride - 1) * facts.fwd * 0.5 + facts.mid[kq]) * f.scale;
            // Never short of the next riser: a stair clip is taken on before a flight or a landing, and its first step goes
            // onto the tread past it (a step up put down on the floor short of the flight stood a riser over it).
            let jq = Math.round((lq - f.next) / T - tune.land);
            if (jq < 0) jq = 0;
            const mq = f.next + (jq + tune.land) * T - lq;
            if (mq < 1e-4 && mq > -1e-4) break;
            t -= mq * this.qC;
          }
        }
        t -= Math.floor(t / len) * len;
        this.snap = t;
        // Steered afresh from the phase taken.
        this.steerK = -1;
        this.spot = Number.NaN;
      } else if (toGo > 1e-6) {
        // This frame's move takes its share of the miss (the move over what is left to go), so the footfall lands on its
        // spot as it happens, whatever the body's speed does on the way.
        corr = -miss * c * (moved >= toGo ? 1 : moved / toGo);
      }
    }
    let r = f.dt > 0 ? (f.moved * c + corr) / f.dt : 1;
    // Never under `rateLow` of the distance's own rate while the body goes on (a big miss steered out in one go stopped the
    // clip dead while the body walked on, and the planted foot with it), nor over twice the band's top.
    const floor = f.dt > 0 && f.moved > 0 ? (tune.rateLow * f.moved * c) / f.dt : 0;
    if (r < floor) r = floor;
    if (r < 0) r = 0;
    else if (r > tune.rateHigh * 2) r = tune.rateHigh * 2;
    this.rate = r;
  }
}
