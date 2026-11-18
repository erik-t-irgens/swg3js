// Climbing II, Smoothness II, item 1 (`climb.hopFlight` 'timed'): where in each hop's, grab's and drop's clip the hands come
// off the held lip (or the feet off the ground) and where they touch the new lip (or the feet the ground), so the body is
// carried through the air between those two frames and the hands are on the new lip exactly as the clip's own hands touch it.
//
// Two sources, the owner's first: his own timings (DESIGN-CLIMB2.md, "The owner's hand timings", 2026-11-17, seconds into each
// clip) win wherever he gave one; every other moment is the clip's own measure by the hands' (and the feet's) own speed
// (`measureHands`, the rule below), on the human male the pack fits its clips for, and held to that measurement by
// `handTimes.test.ts`, which measures every clip again from the pack and reports each clip whose measure differs from his by
// more than two of the clip's own frames, with both numbers. The measuring is node's, from the pack, as `LEDGE_FACTS` is.
//
// The speeds are the clip's original world's: the pack strips each clip's level travel as a straight ramp over its length
// (src/anim/fit.ts), so a hand resting on a lip in the original drifts back along the ramp in the fitted clip; the ramp is
// added back before a speed is taken (`driftX`, `driftZ`: the clip's level `net` over its length).
//
// Pure: numbers only.

/** One clip's two moments, seconds into the clip (NaN: none, the clip starts already in the air). */
export interface HandMoments {
  readonly leave: number;
  readonly touch: number;
}

/**
 * The owner's timings, his words beside them in the design (NaN where he wrote that the clip starts already approaching).
 * Clips the game does not play (`jump_to_freehang`, `braced_hang_drop`) are kept, since they are his, and measured too.
 */
export const HAND_OWNER: Readonly<Record<string, HandMoments>> = {
  braced_hang_hop_left: { leave: 0.42, touch: 0.7 },
  braced_hang_hop_right: { leave: 0.34, touch: 0.61 },
  braced_hang_hop_up: { leave: 0.46, touch: 0.78 },
  // "Both hands never leave the ledge, but we can use 0.65 as the moment they both do"; 0.75 the leading hand.
  free_hang_hop_left: { leave: 0.65, touch: 0.75 },
  free_hang_hop_right: { leave: 0.65, touch: 0.75 },
  jump_to_hang: { leave: Number.NaN, touch: 0.26 },
  jump_to_freehang: { leave: 0.7, touch: 1.07 },
  jumping_to_hanging: { leave: Number.NaN, touch: 0.28 },
  idle_to_braced_hang: { leave: 0.5, touch: 0.68 },
  stand_to_freehang: { leave: 0.58, touch: 0.91 },
  // The drops: "leave" the hands fully released, "touch" the (first) foot on the ground.
  braced_hang_drop: { leave: 0.35, touch: 0.81 },
  braced_hang_drop_1: { leave: 0.36, touch: 0.61 },
  drop_to_freehang: { leave: 0.73, touch: 0.92 },
};

/** What a clip starts and ends with, which says what its two moments are read off. */
export type HandKind = 'hop' | 'air' | 'ground' | 'drop';

/**
 * Each measured clip's kind: `hop` hands on a lip to hands on another (leave and touch both the hands'); `air` a grab arriving
 * in the air (no leave; touch the hands'); `ground` a grab from standing (leave the feet off the ground; touch the hands');
 * `drop` hands on a lip to the feet on the ground (leave the hands fully off; touch the feet's).
 */
export const HAND_KINDS: Readonly<Record<string, HandKind>> = {
  braced_hang_hop_left: 'hop',
  braced_hang_hop_right: 'hop',
  braced_hang_hop_up: 'hop',
  free_hang_hop_left: 'hop',
  free_hang_hop_right: 'hop',
  jump_to_hang: 'air',
  jump_to_freehang: 'ground',
  jumping_to_hanging: 'air',
  idle_to_braced_hang: 'ground',
  stand_to_freehang: 'ground',
  braced_hang_drop: 'drop',
  braced_hang_drop_1: 'drop',
  drop_to_freehang: 'ground',
  braced_hang: 'air',
  freehang_drop: 'drop',
};

/**
 * The measure (`measureHands` on the pack's clips on the human male; `handTimes.test.ts` measures it again): each clip's
 * moments by its hands' and feet's own speed.
 */
export const HAND_MEASURED: Readonly<Record<string, HandMoments>> = {
  braced_hang_hop_left: { leave: 0.3, touch: 0.7 },
  braced_hang_hop_right: { leave: 0.167, touch: 0.633 },
  braced_hang_hop_up: { leave: 0.5, touch: 0.767 },
  free_hang_hop_left: { leave: 0.504, touch: 0.706 },
  free_hang_hop_right: { leave: 0.504, touch: 0.706 },
  jump_to_hang: { leave: Number.NaN, touch: 0.167 },
  jump_to_freehang: { leave: 0.629, touch: 1.093 },
  jumping_to_hanging: { leave: Number.NaN, touch: 0.233 },
  idle_to_braced_hang: { leave: 0.461, touch: 0.691 },
  stand_to_freehang: { leave: 0.5, touch: 0.7 },
  braced_hang_drop: { leave: 0.367, touch: 0.8 },
  braced_hang_drop_1: { leave: 0.34, touch: 0.713 },
  drop_to_freehang: { leave: 0.463, touch: 0.927 },
  braced_hang: { leave: Number.NaN, touch: 0.3 },
  freehang_drop: { leave: 0.233, touch: 0.533 },
};
/** A hand or the feet faster than this (m/s, in the clip's original world) are moving: off a lip or the ground, or not yet on one (a mechanic: about a hand's length in a tenth of a second). */
export const HAND_MOVING = 1;

/** Each hand's grip point and the ankles' middle at the clip's own frames, in the fitted clip's frame (metres), and the ramp the pack took off. */
export interface HandSamples {
  /** Seconds between two samples. */
  readonly dt: number;
  /** x, y, z of the left hand's grip at each sample, the right's, and the ankles' middle (three numbers a sample). */
  readonly l: ArrayLike<number>;
  readonly r: ArrayLike<number>;
  readonly a: ArrayLike<number>;
  /** The level travel the pack stripped, a second (x, z in the clip's frame): added back so the speed is the original's. */
  readonly driftX: number;
  readonly driftZ: number;
  readonly kind: HandKind;
}

/** A point's speed into sample `k` in the clip's original world (the ramp added back), m/s. */
function speedAt(s: HandSamples, p: ArrayLike<number>, k: number): number {
  const dx = p[k * 3] - p[(k - 1) * 3] + s.driftX * s.dt;
  const dy = p[k * 3 + 1] - p[(k - 1) * 3 + 1];
  const dz = p[k * 3 + 2] - p[(k - 1) * 3 + 2] + s.driftZ * s.dt;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / s.dt;
}

/** The sample before the first from `from` on whose speed passes `HAND_MOVING` (-1 for none). */
function firstMoving(s: HandSamples, p: ArrayLike<number>, from: number, n: number): number {
  for (let k = Math.max(1, from + 1); k < n; k++) if (speedAt(s, p, k) > HAND_MOVING) return k - 1;
  return -1;
}

/** After its fastest sample past `from`, the sample before the first one under `HAND_MOVING` (-1 for none). */
function cameToRest(s: HandSamples, p: ArrayLike<number>, from: number, n: number): number {
  let peak = -1;
  let peakK = -1;
  for (let k = Math.max(1, from + 1); k < n; k++) {
    const v = speedAt(s, p, k);
    if (v > peak) {
      peak = v;
      peakK = k;
    }
  }
  if (peakK < 0 || peak <= HAND_MOVING) return -1;
  for (let k = peakK + 1; k < n; k++) if (speedAt(s, p, k) < HAND_MOVING) return k - 1;
  return -1;
}

/**
 * The rule, by the clip's kind. Leave: a hop's, the sample before either hand first passes `HAND_MOVING`; a drop's, the later
 * of the two hands' (both off); a grab from standing's, the feet's (the ankles' middle). Touch: a hop's and a grab's, the
 * earlier of the two hands' coming to rest after its fastest sample past the leave (the first hand on the new lip); a drop's,
 * the feet's. NaN where nothing is found (and a grab arriving in the air has no leave).
 */
export function measureHands(s: HandSamples): HandMoments {
  const n = Math.min(s.l.length, s.r.length, s.a.length) / 3;
  let leaveK = 0;
  let leave = Number.NaN;
  if (s.kind !== 'air') {
    const kl = s.kind === 'ground' ? firstMoving(s, s.a, 0, n) : firstMoving(s, s.l, 0, n);
    const kr = s.kind === 'ground' ? kl : firstMoving(s, s.r, 0, n);
    if (kl < 0 || kr < 0) return { leave: Number.NaN, touch: Number.NaN };
    leaveK = s.kind === 'drop' ? Math.max(kl, kr) : Math.min(kl, kr);
    leave = leaveK * s.dt;
  }
  let touchK = -1;
  if (s.kind === 'drop') touchK = cameToRest(s, s.a, leaveK, n);
  else {
    const tl = cameToRest(s, s.l, leaveK, n);
    const tr = cameToRest(s, s.r, leaveK, n);
    touchK = tl < 0 ? tr : tr < 0 ? tl : Math.min(tl, tr);
  }
  return { leave, touch: touchK < 0 ? Number.NaN : touchK * s.dt };
}

/** A clip's own moment as the game uses it: the owner's where he gave one, else the measure's, else NaN. */
export function handMoment(id: string, which: 'leave' | 'touch'): number {
  const o = HAND_OWNER[id];
  const v = o ? o[which] : Number.NaN;
  if (v === v) return v;
  const m = HAND_MEASURED[id];
  return m ? m[which] : Number.NaN;
}
