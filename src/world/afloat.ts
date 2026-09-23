// How a body lies on water it is floating in: the player swimming, and every creature whose pack
// has swimming clips. One spring, so a person and a rancor on the same wave ride it the same way.
//
// It exists because of the swell. The sea has been drawn as a moving surface since the hulls
// learned to ride it, but everything floating in it read the **flat** table underneath, so a crest
// rose over a swimmer's head and a trough dropped out from under its feet while the body itself
// never moved. Reading the drawn surface is only half of it: a target that moves needs something
// that chases it, and holding the surface stops being the same thing as standing still in y.
//
// Why the numbers are not the creatures' own, which is the obvious thing to have done. A swimming
// creature has held its line with `(want - y) * 2.5 - vy * 0.3` since that code was written, and
// 2.5 is a perfectly good number **for a target that does not move** -- a flyer's hover height,
// which is what it was really tuned against, and a flat lake. Against a real swell it is a first
// order lag of about half a second, which on an eight second wave a metre and a half trough to
// crest leaves the body 29 cm out of step: visibly low on the crest and high in the trough. The
// flyers keep 2.5, because nothing about a hover changed; floating gets a stiffer chase.

/** The float spring's numbers. Every one of them is ours; `__debug.afloat` moves them for a run. */
export interface AfloatTune {
  /** How hard a body chases its own line, per second. Higher rides the crest closer. */
  track: number;
  /** How much of the rise it already has is taken back out. It divides the chase rather than
   *  fighting it, because the answer is a velocity that is written straight onto the body. */
  damp: number;
  /** The fastest it will chase, in metres a second. A surface that *jumps* must not fling it. */
  speed: number;
}

export const AFLOAT: AfloatTune = { track: 8, damp: 0.3, speed: 6 };

/** Move one of them for a run; anything else is left as it stands. */
export function tuneAfloat(patch?: Partial<AfloatTune>): AfloatTune {
  if (patch) {
    for (const k of Object.keys(patch) as (keyof AfloatTune)[]) {
      const v = patch[k];
      if (typeof v === 'number' && Number.isFinite(v)) AFLOAT[k] = v;
    }
  }
  return AFLOAT;
}

/**
 * The vertical speed a floating body should be asking for to lie at `want`, given where it is, how
 * fast it is already rising, and how long the step is.
 *
 * The answer is written straight onto the body rather than accelerated toward, so this is a first
 * order chase and not a mass on a spring: it cannot ring, and `damp` only softens it. Two things
 * are guarded all the same.
 *
 * The **cap** matters because `want` is a drawn surface and it can move a long way between two
 * frames for reasons that are not a wave at all -- a travel to another world, the sea being
 * switched on, a body crossing from a lake to the open sea. Uncapped, a chase turns a fifty metre
 * step into a fifty metre a second launch; capped, the body swims up to its new line over a second
 * or two and nothing is thrown anywhere.
 *
 * And it never commands a step that would carry the body **past** the line, which is what keeps a
 * knob turned up from ringing instead of settling: an explicit step whose gain times the frame is
 * over two oscillates, and this is a knob somebody types into a console.
 *
 * A `want` that is not a real number (no water over this point at all) asks for nothing and leaves
 * the body doing whatever it was doing, so a caller need not test before asking.
 */
export function afloatVelocity(want: number, y: number, vy: number, dt: number, tune: AfloatTune = AFLOAT): number {
  if (!Number.isFinite(want) || !Number.isFinite(y)) return vy;
  const gap = want - y;
  let v = gap * tune.track - (Number.isFinite(vy) ? vy : 0) * tune.damp;
  v = Math.max(-tune.speed, Math.min(tune.speed, v));
  if (Number.isFinite(dt) && dt > 0) {
    const reach = gap / dt;
    v = gap >= 0 ? Math.min(v, Math.max(0, reach)) : Math.max(v, Math.min(0, reach));
  }
  return v;
}
