// Standing in a flow: how far it draws a body down, how fast, and how much of its walk that costs.
// Pure, and it imports nothing, so a node test runs exactly what the game runs.
//
// **Every number in this file is ours, and there was nothing to copy.** The client's terrain water
// values say what lava *does* to whatever stands in it -- how often and how much -- and those are
// read out of the archives into a planet's pack and applied by `src/world/lavaHarmMath.ts`, which is
// where they belong and where they stay. They say nothing whatever about a body sinking into a flow,
// because in the game these numbers are for nobody ever stood in one: the server killed you and that
// was the whole of it. So the sink, its two rates, where a waist is on a body and what being held by
// the legs costs a walk are all invented here and all tunable.
//
// Why a separate file rather than three fields and a subtraction in `Player.update`: it is felt and
// it has edges. It must cap somewhere (the waist, and never over the eyes, whatever posture the body
// is in), it must go down slowly and come back quickly, it must leave the body able to walk out, and
// it must not touch the harm's clock in either direction. That is a handful of rules with edges, and
// rules with edges belong somewhere a node test can reach them. It is deliberately the same shape as
// `breathMath.ts` and `../combat/burnMath.ts`, which own the other two things that happen to a body
// over time.
//
// Nothing in here knows about a player, a world or a flow: `Player` holds the record, asks
// `World.lavaAt` how deep the feet stand, steps the **world's own** verdict record for the answer
// (`LavaHold`/`stepLavaHold` in `src/world/lavaHarmMath.ts`, which the hazard tick steps too, so the
// sink and the burn cannot be in the flow on different steps), and steps this beside the breath and
// the fire.

/**
 * One body's sink, all of it. A plain record, so the game's lives on the `Player` (which is what
 * knows where its feet are) with no second object in between.
 */
export interface LavaSink {
  /**
   * Metres the **drawn** figure stands below where its feet really are. The physics body never moves
   * for this: a capsule pushed into the bed would be shoved straight back out by the controller, and
   * the harm tick measures the real feet, so a sink that moved them would change how fast a flow
   * kills. This is a drop applied to the figure and to the view together and to nothing else.
   */
  sink: number;
  /**
   * Whether the body counted as being in a flow on the last step, as this file saw it. The verdict
   * itself is **not** drawn here and its memory is not kept here either: the caller steps the world's
   * own `LavaHold` (`src/world/lavaHarmMath.ts`), band, bridge and all, and hands the answer in. This
   * is a mirror of it for the console, and the guard that a depth of nothing is not a flow whatever
   * the caller said.
   */
  in: boolean;
  /**
   * How far up the drawn body the flow reaches: the real depth plus the sink. Kept so the console can
   * read it and so the pace is worked out once rather than twice.
   */
  immersion: number;
}

/**
 * Ours, all six, live through `__debug.lava({ sink: { … } })`.
 *
 * There is deliberately nothing here pretending to be the client's. The one number with any claim to
 * being read rather than chosen is `bodyHeight`, and even that is this repository's own note beside
 * the run speed ("the character stands about 1.75 m") rather than anything out of the archives: the
 * game carries no per-species figure height anywhere the player can read, so one number stands for
 * every body and the owner can move it.
 */
export const LAVA_SINK = {
  /**
   * The switch. Off, nothing sinks, nothing slows, and the figure and the view are exactly where they
   * were before any of this -- put back there and then rather than eased, which is the same shape the
   * breath's switch has, because a switch that took a second to be believed would read as a bug.
   */
  on: true,
  /**
   * How tall the body is taken to be, in metres. The waist below is a share of it. The game has no
   * figure height of its own to read (the capsule is 1.6 m, the standing eye 1.5, the dive line 1.9;
   * they disagree because each was chosen for its own job), so this is the note already written
   * beside the run speed in `player.ts` -- about 1.75 m -- standing in for all of them.
   */
  bodyHeight: 1.75,
  /**
   * Where the waist is, as a share of the height: 0.52 of 1.75 m is 0.91 m off the ground, which is
   * about where a belt sits. It is the **cap** on the sink and not a target to be reached from below:
   * a body already standing in lava deeper than this sinks no further, because the flow has already
   * passed its waist without any help.
   */
  waistShare: 0.52,
  /**
   * Metres a second the body is drawn down while it stands in a flow. From the lip of one (where the
   * feet are a margin under the surface) to the waist is about 0.76 m, so at this rate it takes about
   * two and a half seconds -- which is inside the three a flow takes to kill, so the sink is a thing
   * that happens to you rather than a thing that is interrupted. Slower and nobody ever sees it;
   * faster and it stops reading as thick.
   */
  sinkRate: 0.3,
  /**
   * Metres a second the body comes back up, once it is out of the flow. Four times the going rate, so
   * pulling free takes about three quarters of a second from a full waist: long enough to be a pull,
   * short enough that nobody walks about the desert drawn low. It applies **only** on the way out; a
   * sink that shrinks while the body is still in a flow (a step from a shallow part into a deep one,
   * where the flow itself has risen up the body) eases at `sinkRate` in that direction too, or the
   * figure would be yanked upward every time the bed dropped away.
   */
  riseRate: 1.2,
  /**
   * What is left of the walk when the flow is at the waist: a little over a third. Against the game's
   * own 5.5 m/s run that is 1.93 m/s, a shade under its walk -- slow enough to feel held, fast enough
   * that the way out is always a real option, which is the owner's call ("it should be walkable out
   * of just for gameplay purposes"). Set it to 0 and a flow at the waist is a trap rather than a
   * hazard; set it to 1 and the sink is a picture with no weight behind it.
   */
  slowest: 0.35,
};

/** The keys `__debug.lava({ sink: … })` may write. */
export type LavaSinkTune = Partial<Pick<typeof LAVA_SINK, 'on' | 'bodyHeight' | 'waistShare' | 'sinkRate' | 'riseRate' | 'slowest'>>;

const finite = (v: number): boolean => typeof v === 'number' && Number.isFinite(v);

/**
 * Where the waist is on a body of this height, in metres off its own feet. Guarded, because the two
 * numbers behind it are live: a height or a share of nothing at all is no waist, and then nothing
 * sinks and nothing slows, which is the honest reading of "this body has no waist to be caught by".
 */
export function waistHeight(height: number = LAVA_SINK.bodyHeight, share: number = LAVA_SINK.waistShare): number {
  if (!finite(height) || height <= 0 || !finite(share) || share <= 0) return 0;
  return height * share;
}

/**
 * How far the body wants to be drawn down, given how deep its real feet stand under the flow and how
 * high its eyes are in the posture it holds.
 *
 * The rule is the owner's in one line: the flow ends up at the waist. So the sink is whatever is left
 * of the waist once the depth the body is *already* standing in is taken off, and a body standing in
 * a flow deeper than its own waist asks for none at all -- the lava got there by itself.
 *
 * `eyeOver` is the second cap and it exists for one posture. Standing, kneeling and crouched, the
 * eyes are higher than the waist and it never binds; lying down they are at 0.45 m, well under it,
 * and without this the flow would close over a prone body's head and the view with it. The eyes come
 * to rest exactly on the surface instead, which is a face in the lava rather than a camera inside an
 * opaque mesh. Pass `Infinity` for no such cap.
 */
export function sinkTarget(depth: number, eyeOver: number = Infinity, height: number = LAVA_SINK.bodyHeight, share: number = LAVA_SINK.waistShare): number {
  const waist = waistHeight(height, share);
  if (waist <= 0) return 0;
  const d = finite(depth) ? depth : 0;
  const cap = finite(eyeOver) || eyeOver === Infinity ? Math.min(waist, eyeOver) : waist;
  const want = cap - d;
  return want > 0 ? want : 0;
}

/**
 * What is left of the body's walking speed, 0 to 1, when the flow stands `immersion` metres up it.
 * Straight line from whole at the surface to `slowest` at the waist and no lower, because past the
 * waist there is nothing further to be caught by -- the legs are the whole of what the lava holds.
 *
 * It is worked out from how far up the body the flow **is drawn**, which is the real depth plus the
 * sink, and not from the sink alone: wading into a deep flow is being held by it whether or not the
 * sink has had time to do anything, and that is also what makes the slow arrive gradually as the
 * owner asked rather than the moment a foot crosses the line.
 */
export function lavaPace(immersion: number, height: number = LAVA_SINK.bodyHeight, share: number = LAVA_SINK.waistShare, slowest: number = LAVA_SINK.slowest): number {
  const waist = waistHeight(height, share);
  if (waist <= 0 || !finite(immersion) || immersion <= 0) return 1;
  const floor = finite(slowest) ? Math.min(1, Math.max(0, slowest)) : 0;
  const t = Math.min(1, immersion / waist);
  return 1 - (1 - floor) * t;
}

/** Nothing sunk, nothing in, walking whole. */
export function newLavaSink(): LavaSink {
  return { sink: 0, in: false, immersion: 0 };
}

/**
 * Everything back as it was, at once: a death, a respawn, a travel, an arrival, the switch going off.
 * Silent by construction -- there is nothing here that says a word, and the figure and the view are
 * put back together because they are the same number.
 */
export function resetLavaSink(s: LavaSink): void {
  s.sink = 0;
  s.in = false;
  s.immersion = 0;
}

/** What one step of a sink came to. One kept object: see `stepLavaSink`. */
export interface LavaSinkStep {
  /** Metres the drawn figure stands below its real feet after this step. */
  sink: number;
  /** How far up the drawn body the flow reaches after it. */
  immersion: number;
  /** What is left of the walking speed, 0 to 1. */
  pace: number;
}

/**
 * The one result, refilled. `stepLavaSink` is called once a frame from one place -- every frame of the
 * session, not merely the ones spent in a flow, because that is where the sink comes back out -- so a
 * kept object is right and a fresh one would be a small allocation a frame for ever. The one rule it
 * imposes is that the caller reads it before calling again, and the only caller does.
 */
const stepResult: LavaSinkStep = { sink: 0, immersion: 0, pace: 1 };

/**
 * Move the sink on by `dt` seconds.
 *
 * `depth` is metres under the flow's surface, negative above it, and -Infinity where there is no flow
 * over the point at all. It is **not** simply `World.lavaAt`'s answer for this step: across a step
 * the verdict bridges (the column stops being the flow's for a moment, which on the lava planet reads
 * as a depth metres below the feet rather than as no depth at all) the caller hands in the last depth
 * that really was in the flow, so the sink goes on toward the target it had instead of chasing a
 * surface that is not there and then climbing out at the rising rate.
 * `inFlow` is the caller's verdict about whether this body counts as standing in one, and it is
 * deliberately not re-derived here: the game steps the harm's own `LavaHold`, so the sink is in the
 * flow on exactly the steps the burn is -- the same margin, the same hysteresis band and the same
 * bridge across a gap no distance can span.
 * `eyeOver` is the posture's own eye height over the feet, which caps the sink for a body lying down.
 *
 * Nothing here decides whether anybody is hurt, and nothing here touches the harm's clock. The flow
 * kills in the seconds the client's own table says it does, from the first step the real feet were in
 * it, whatever this is doing.
 */
export function stepLavaSink(s: LavaSink, dt: number, depth: number, inFlow: boolean, eyeOver = Infinity): LavaSinkStep {
  const r = stepResult;
  // Switched off, mid-sink or not: up, out and whole, there and then. Easing it back would mean the
  // switch took a second to be believed, and a switch whose whole job is "make the game exactly what
  // it was" has to be believed at once.
  if (!LAVA_SINK.on) {
    if (s.sink !== 0 || s.in || s.immersion !== 0) resetLavaSink(s);
    r.sink = 0;
    r.immersion = 0;
    r.pace = 1;
    return r;
  }
  const held = inFlow && finite(depth);
  s.in = held;
  const target = held ? sinkTarget(depth, eyeOver) : 0;
  // Down at the going rate, and up at it too while the body is still in a flow (a step into a deeper
  // part, where the lava has risen up the body by itself and the sink must give way to it). Only
  // getting clear pulls at the fast rate, which is what the owner asked for: a slow sink, and out
  // over a moment.
  const rate = held ? LAVA_SINK.sinkRate : LAVA_SINK.riseRate;
  const step = finite(rate) && rate > 0 && finite(dt) && dt > 0 ? rate * dt : 0;
  if (s.sink < target) s.sink = Math.min(target, s.sink + step);
  else if (s.sink > target) s.sink = Math.max(target, s.sink - step);
  // How far up the drawn body the flow stands. Out of one there is no surface to measure against, but
  // a body that has walked out still carries whatever sink has not come back yet, and it is still
  // held by it -- which is what makes climbing out of a flow a pull rather than a step.
  const under = held ? Math.max(0, depth) : 0;
  s.immersion = under + s.sink;
  r.sink = s.sink;
  r.immersion = s.immersion;
  r.pace = lavaPace(s.immersion);
  return r;
}

/** Write the knobs, ignoring anything that is not a finite number (or a boolean where one goes). */
export function tuneLavaSink(t: LavaSinkTune | undefined): typeof LAVA_SINK {
  if (!t) return LAVA_SINK;
  if (typeof t.on === 'boolean') LAVA_SINK.on = t.on;
  const n = (v: number | undefined): boolean => typeof v === 'number' && Number.isFinite(v);
  // A height or a share of nothing is a real answer and means "no waist": `waistHeight` reads it as
  // none, so nothing sinks and nothing slows. Negative ones are not an answer at all.
  if (n(t.bodyHeight) && t.bodyHeight! >= 0) LAVA_SINK.bodyHeight = t.bodyHeight!;
  if (n(t.waistShare) && t.waistShare! >= 0) LAVA_SINK.waistShare = t.waistShare!;
  // A rate of nothing is a real answer too: the sink stands still where it is.
  if (n(t.sinkRate) && t.sinkRate! >= 0) LAVA_SINK.sinkRate = t.sinkRate!;
  if (n(t.riseRate) && t.riseRate! >= 0) LAVA_SINK.riseRate = t.riseRate!;
  if (n(t.slowest)) LAVA_SINK.slowest = Math.min(1, Math.max(0, t.slowest!));
  return LAVA_SINK;
}

/**
 * The sink as it stands and the numbers in force, for the console.
 *
 * Two numbers come in rather than being written down here, because both belong to other files and a
 * second copy of either would drift. `lip` is how far under a surface a body has to stand before it
 * counts as being in the flow at all -- `LAVA_HARM.margin`, the harm's, and the line the sink starts
 * on -- and it is what `secondsToWaist` is measured **from**: a body at the lip has 0.76 m to go and
 * not the whole 0.91 m waist, which is the difference between 2.53 s and 3.03 s and so the difference
 * between a sink that finishes inside the three seconds a flow takes to kill and one that does not.
 * `runSpeed` is the game's own run, and only turns a fraction into a number that can be felt.
 *
 * The defaults are honest for a caller that has neither to hand (no lip, and the run speed as it
 * stands today); the game passes both.
 */
export function lavaSinkReport(s: LavaSink, lip = 0, runSpeed = 5.5): {
  on: boolean;
  /** The body counted as standing in a flow on the last step. */
  in: boolean;
  /** Metres the drawn figure stands below its real feet. */
  sink: number;
  /** How far up the drawn body the flow reaches. */
  immersion: number;
  /** What is left of its walking speed, 0 to 1. */
  pace: number;
  /** And in metres a second, against the game's own run, so the number means something without arithmetic. */
  paceSpeed: number;
  /** Where the waist is on this body, which is the cap on the sink. */
  waist: number;
  /** How far under a surface the feet must stand to be in the flow at all: the harm's own margin, and where the sink starts. */
  lip: number;
  /**
   * Seconds from the lip of a flow to the waist at the rate in force -- the whole of the sink a body
   * walking in really does -- which is the figure to hold against how fast a flow kills.
   */
  secondsToWaist: number;
  /** Seconds to come back out from where it stands now. */
  secondsBack: number;
  bodyHeight: number;
  waistShare: number;
  sinkRate: number;
  riseRate: number;
  slowest: number;
} {
  const waist = waistHeight();
  const rate = LAVA_SINK.sinkRate;
  const from = finite(lip) ? Math.min(Math.max(0, lip), waist) : 0;
  const run = finite(runSpeed) ? runSpeed : 0;
  return {
    on: LAVA_SINK.on,
    in: s.in,
    sink: s.sink,
    immersion: s.immersion,
    pace: lavaPace(s.immersion),
    paceSpeed: lavaPace(s.immersion) * run,
    waist,
    lip: from,
    secondsToWaist: waist > 0 && finite(rate) && rate > 0 ? (waist - from) / rate : Infinity,
    secondsBack: s.sink > 0 && finite(LAVA_SINK.riseRate) && LAVA_SINK.riseRate > 0 ? s.sink / LAVA_SINK.riseRate : 0,
    bodyHeight: LAVA_SINK.bodyHeight,
    waistShare: LAVA_SINK.waistShare,
    sinkRate: LAVA_SINK.sinkRate,
    riseRate: LAVA_SINK.riseRate,
    slowest: LAVA_SINK.slowest,
  };
}
