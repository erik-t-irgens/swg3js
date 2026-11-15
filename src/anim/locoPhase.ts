// A walking or running clip's stride, and the rule that keeps two of them in step while one fades into the other.
//
// A clip's phase is how far it is through a stride, counted from its left foot's landing (the pack's own foot
// marks): 0 as the left foot comes down, 0.5 about where the right does. A clip that fades in over another starts at
// the other's phase, and while both play they advance at one shared phase rate, so the left feet of the two land
// together all the way through the fade and the legs never scissor. A clip with no marks (the game's own) has no
// phase and fades plain.
//
// Pure: the rig (src/player/rig.ts) and the node tests call these very functions.

/** What a rig knows of a clip's stride. */
export interface ClipFacts {
  /** The ground speed the clip's feet were made for, m/s, on the skeleton it was fitted to (before the figure's own scale). */
  speed: number;
  /** When the left foot first lands, seconds into the clip. */
  leftAt: number;
  /** One stride, left landing to left landing, seconds (a clip may hold more than one). */
  cycle: number;
}

/**
 * A clip's stride from its index row and the scale it was fitted at; null for a clip that is no loop (a landing has
 * feet and no stride), has no left-foot mark, or has no speed.
 */
export function factsOf(row: { duration: number; speed: number; loop: boolean; feet: readonly { t: number; foot: string }[] }, scale: number): ClipFacts | null {
  if (!row.loop || !(row.duration > 0) || !(row.speed > 0.05)) return null;
  const lefts = row.feet.filter((m) => m.foot === 'L').map((m) => m.t).sort((a, b) => a - b);
  if (!lefts.length) return null;
  const cycle = row.duration / lefts.length;
  return { speed: row.speed * scale, leftAt: lefts[0] % cycle, cycle };
}

/** How far through its stride a clip is at `time`, 0 (the left foot landing) up to 1. */
export function phaseAt(time: number, facts: ClipFacts): number {
  const p = ((time - facts.leftAt) / facts.cycle) % 1;
  return p < 0 ? p + 1 : p;
}

/** The first time in a clip of `duration` seconds at which its stride is at `phase`. */
export function timeAtPhase(phase: number, facts: ClipFacts, duration: number): number {
  // Within one stride of the left foot's first landing; past the clip's end it is the same phase a stride earlier.
  let t = facts.leftAt + phase * facts.cycle;
  if (t >= duration) t -= facts.cycle;
  return t < 0 ? 0 : t;
}

/** How far apart two phases are, the short way round: 0 to 0.5 of a stride. */
export function phaseGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

/**
 * The rate a clip plays at so that its feet match the ground: the ground speed over the speed the clip's feet were
 * made for, held inside the band (`min` to `max`; `stretch` widens the top, which Force Speed's own factor does).
 * A clip of unknown speed plays at 1.
 */
export function rateFor(ground: number, natural: number, min: number, max: number, stretch = 1): number {
  if (!(natural > 0)) return 1;
  const r = ground / natural;
  const top = max * (stretch > 1 ? stretch : 1);
  return r < min ? min : r > top ? top : r;
}

/**
 * The phase rate two clips share part way through a fade, strides a second: the outgoing clip's own as the fade
 * began, eased to the incoming clip's own as it ends (`w` 0 to 1).
 */
export function sharedRate(fromRate: number, toRate: number, w: number): number {
  const k = w < 0 ? 0 : w > 1 ? 1 : w;
  return fromRate + (toRate - fromRate) * k;
}
