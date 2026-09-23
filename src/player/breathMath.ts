// Breath: what holding one costs, what running out of one costs, and when each of the two lines
// falls due. Pure, and it imports nothing, so a node test runs exactly what the game runs.
//
// **Every number in this file is ours, and there was nothing to copy.** You could not go under water
// in Star Wars Galaxies at all -- not swim under, not dive, not drown -- so the archives are silent
// about breath in the way a book is silent about a chapter it does not have. This game already dives
// (the head goes under at 1.9 m and the camera follows), which is itself past what the client did, so
// the whole of what follows is invented: how long a lungful lasts, how fast it comes back, what
// running out takes off you and how often.
//
// Why a separate file, when the number could sit in `Player.update` as a field and a subtraction:
// because it is felt. It locks the regeneration out, it flashes the screen, it says two lines and
// exactly two, it must come back at a different rate from the one it goes at, and it must be exactly
// full on dry land or the display's row would never go away. That is a handful of rules with edges,
// and rules with edges belong somewhere a node test can reach them. It is deliberately the same shape
// as `src/combat/burnMath.ts`, which owns the player's fire for the same reason.
//
// Nothing in here knows about a player, a world or a message line: `Player` holds the record, spends
// it beside the regeneration delay in `update` and says the words.

/**
 * One breath, all of it. A plain record, so the game's lives on the `Player` (which is what knows
 * whether the head is under) with no second object in between.
 */
export interface Breath {
  /** Seconds of air left. `BREATH.seconds` is a full lungful; 0 is drowning. */
  left: number;
  /** Seconds since the last drowning blow; what turns a fraction a frame into a blow a second. */
  clock: number;
  /**
   * Whether the "you are holding your breath" line has been said for this dive. It is here rather
   * than in the caller so that a dive begun and ended between two steps can never say the second
   * line without the first, and so that putting the record back (a death, a travel) is silent by
   * construction.
   */
  said: boolean;
  /**
   * Whether the head was under on the last step. It is kept so that the display can ask one thing --
   * "is there anything to show" -- without re-deriving the verdict the step has already made, and so
   * that a row is up on the very first frame under rather than on the second.
   */
  under: boolean;
  /**
   * Seconds the head has been **where it is**: under, on a dive; in air, between them. It goes back
   * to nothing on the step the head changes sides of the surface and on nothing else, and it is the
   * one clock both lines are timed off, at their own ends of the dive.
   *
   * It is here rather than being derived from the air because the air is not a clock: a swimmer on
   * short lungs is already past any patience you could measure in air spent before they go under at
   * all, so timing the first line off `max - left` said it afresh on every bob, and clearing `said`
   * the instant the head broke the surface said the other one afresh in between. Two lines a bob,
   * alternating, which the message line's merge cannot fold because the words differ. Seconds under
   * *this* dive is the thing the line is actually about.
   */
  since: number;
}

/**
 * Ours, all six, live through `__debug.breath`.
 *
 * There is deliberately nothing here pretending to be the client's: there was no going under water
 * in the game these numbers are for, so there is no table, no column and no default to be faithful
 * to. What each one is chosen for is on its own doc comment, so the owner can move it knowing what
 * it was traded against.
 */
export const BREATH = {
  /**
   * The switch. Off, the breath is always full, nothing is ever spent, nobody drowns and the display
   * has nothing to show -- so the game is exactly what it was before this, which is the same shape
   * the lava's and the fire's switches have.
   */
  on: true,
  /**
   * A full lungful, in seconds. The game swims at 2.475 m a second (0.45 of its own run) and rises
   * at that same rate with the jump key held, so thirty seconds is a climb of about seventy-five
   * metres straight up: a dive to the bed of a lake and back is well inside it, with the air left
   * over being what makes looking around down there possible at all. Short enough, meanwhile, that
   * the row is a real clock rather than decoration. It is also the row's `max`, so moving it moves
   * the bar's full length.
   */
  seconds: 30,
  /**
   * Seconds to fill an empty pair of lungs in air, from nothing to full. Five times faster than it
   * goes, so breaking the surface for a moment is a real reprieve -- and not instant, so a run of
   * quick dives really does get harder, which is the only thing that makes a breath a resource
   * rather than a timer.
   */
  recoverSeconds: 6,
  /** Seconds between one drowning blow and the next, once the air is gone. */
  tick: 1,
  /**
   * What one drowning blow takes. Against the hundred health the player has, and with every blow
   * setting the regeneration delay to five seconds afresh, this is thirteen seconds from a full bar
   * to dead: thirty metres of swimming straight up at the game's own swimming speed, which is what
   * makes running out of air a fright and a scramble rather than an execution. Set it to 0 and the
   * breath is a clock that costs nothing.
   */
  damage: 8,
  /**
   * The patience, in seconds, at **both** ends of a dive: how long the head must have been under
   * before the first line is said, and how long it must have been back up before the second one is.
   * A duck under a wave, a dive off a bank and straight back up, a step into a lake and out again:
   * all of those are under this and say nothing at all. Once the air has run out the first line is
   * said whatever this is set to, because at that point it is not a warning, it is a fact.
   *
   * It has to hold at both ends or it holds at neither. A swimmer bobbing for mouthfuls breaks the
   * surface for a quarter of a second at a time: with patience only on the way down, every one of
   * those bobs ends the dive, says so, and then says the head has gone under again -- one dive with
   * twenty bobs in it becomes forty lines, and because the two lines alternate the message line's
   * merge (the same words within two seconds) never folds them. A bob is not the end of a dive, and
   * this is the number that says so.
   */
  sayAfter: 1.5,
};

/** The keys `__debug.breath` may write. */
export type BreathTune = Partial<Pick<typeof BREATH, 'on' | 'seconds' | 'recoverSeconds' | 'tick' | 'damage' | 'sayAfter'>>;

/**
 * A full lungful, guarded. The knob is live, so `seconds` can be anything the console types between
 * one frame and the next; everything that reads the maximum reads it through here, and `left` is
 * clamped to it on every step, or a bar lowered from 30 to 10 while the player held 25 would draw
 * two and a half times its own length.
 */
export function maxBreath(): number {
  const s = BREATH.seconds;
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/** A full pair of lungs, in air. */
export function newBreath(): Breath {
  return { left: maxBreath(), clock: 0, said: false, under: false, since: 0 };
}

/**
 * Everything back as it was, in **silence**: a death, a respawn, a travel, an arrival, the switch
 * going off. `said` and `under` go back with the rest, which is what makes the silence structural --
 * the next dive says its own first line and nothing says a last one for a dive that ended because
 * the body did.
 */
export function resetBreath(b: Breath): void {
  b.left = maxBreath();
  b.clock = 0;
  b.said = false;
  b.under = false;
  b.since = 0;
}

/** What one step of a breath came to. One kept object: see `stepBreath`. */
export interface BreathStep {
  /** Damage to hand to the player's own damage path this step; 0 on every step but a drowning one. */
  damage: number;
  /** The head has been under long enough to say so: say it, once. */
  started: boolean;
  /** The head is out of the water again: say so, once. A record put back rather than surfaced is silent. */
  ended: boolean;
}

/**
 * The one result, refilled. `stepBreath` is called once a frame from one place, so a kept object is
 * right and a fresh one would be a small allocation every frame of the session (not merely of a
 * dive: the breath is stepped in air too, because that is where it comes back). The one rule it
 * imposes is that the caller reads it before calling again, and the only caller does.
 */
const stepResult: BreathStep = { damage: 0, started: false, ended: false };

/**
 * Spend or recover `dt` seconds of breath, given whether the head is under water right now. Returns
 * what this step owes and which of the two lines, if either, falls due.
 *
 * The arithmetic in one breath. Under: the air goes at a second a second, and once it is gone a blow
 * of `damage` lands every `tick` of airless time. In air: the air comes back at
 * `seconds / recoverSeconds` a second, the drowning clock is dropped, and whoever said the first
 * line says the second.
 *
 * The clock counts **airless seconds under**, not seconds since the dive began, and dropping it at
 * the surface is what makes bobbing up for a mouthful behave the way it should. A player who can
 * reach the surface every second is not drowning, and this is what says so; the other reading --
 * where the first blow lands the instant the last of the air goes, on a lungful however small -- was
 * written first and thrown away, because a body bobbing at the surface with empty lungs took a blow
 * on every bob, which is to say that going up for air hurt more than staying down.
 *
 * The two lines run off a second counter, `since`, which is seconds in the present state and goes
 * back to nothing whenever the head changes sides of the surface. The first line waits `sayAfter`
 * seconds **under**, the second waits the same `sayAfter` seconds **up**, and a bob reaches neither,
 * so a dive with twenty bobs in it is still one dive and still two lines. The same bug in two halves
 * was here first: timing the first line off the air *spent* said it again on every bob (a swimmer on
 * short lungs is past any such patience before they go under), and clearing `said` on the step the
 * head broke the surface said the other one in between.
 *
 * The clock is **put down** rather than wound back, which is the opposite of what a burn does and
 * for the opposite reason: a burn has a total it was promised and must come to it, while drowning
 * charges for *being somewhere*, so one long frame (a stall, a hidden tab, a console step) pays for
 * one blow and not for as many as it covered. That is the lava's rule, and drowning is the same kind
 * of thing as standing in lava.
 */
export function stepBreath(b: Breath, dt: number, under: boolean): BreathStep {
  const r = stepResult;
  r.damage = 0;
  r.started = false;
  r.ended = false;
  // Switched off, with or without a dive under way: full, in silence, and nothing to show. The same
  // as the fire's switch, which forgets what it was doing rather than announcing an end it did not
  // bring about.
  if (!BREATH.on) {
    if (b.left !== maxBreath() || b.said || b.under || b.since !== 0) resetBreath(b);
    return r;
  }
  const max = maxBreath();
  // The knob is live: a maximum lowered under a lungful already drawn is honoured at once.
  if (b.left > max) b.left = max;
  // The head changing sides of the surface, and nothing else, starts the patience afresh -- at
  // whichever end of the dive it happens to be. It is written before the `dt` guard because the
  // change is a fact about the frame even on a frame of no time at all.
  if (b.under !== under) b.since = 0;
  b.under = under;
  if (!Number.isFinite(dt) || dt <= 0) return r;
  b.since += dt;

  if (under) {
    if (b.left > 0) {
      // Only the airless part of a frame goes on the clock. On an ordinary frame that is none of it;
      // on the one frame that crosses the line it is whatever was left over after the last of the
      // air, which is what makes a single frame of a hundred seconds pay rather than pass free.
      const spent = Math.min(b.left, dt);
      b.left -= spent;
      if (b.left <= 0) {
        b.left = 0;
        b.clock += dt - spent;
      }
    } else {
      b.clock += dt;
    }
    // The line: once **this dive** has lasted long enough to be worth saying, or at the latest the
    // moment the air is gone, whatever `sayAfter` is set to. Seconds under this dive, never air
    // spent: a swimmer who went down on half a lungful has already spent more than any patience
    // worth having, and would say the line on the first frame of every bob for the rest of the swim.
    if (!b.said && (b.left <= 0 || b.since >= BREATH.sayAfter)) {
      b.said = true;
      r.started = true;
    }
    if (b.left <= 0 && b.clock >= tickSeconds()) {
      b.clock = 0;
      if (BREATH.damage > 0 && Number.isFinite(BREATH.damage)) r.damage = BREATH.damage;
    }
    return r;
  }

  // In air. The drowning clock goes rather than being kept: surfacing for a moment and going back
  // under must not land a blow the instant the head goes down again.
  b.clock = 0;
  if (b.left < max) b.left = Math.min(max, b.left + recoverRate(max) * dt);
  // The second line waits the same patience the first one did, from the other side. A head that
  // breaks the surface for a quarter of a second has not come back up, it has taken a mouthful, and
  // announcing the end of a dive that is still going on is half of how one dive became forty lines.
  // Whoever said the first line says this one, once, when they have really been up.
  if (b.said && b.since >= BREATH.sayAfter) {
    b.said = false;
    r.ended = true;
  }
  return r;
}

/** The tick, guarded: a tick of nothing or of no number at all would divide the clock by itself for ever. */
function tickSeconds(): number {
  return Number.isFinite(BREATH.tick) && BREATH.tick > 0 ? BREATH.tick : 1;
}

/** Air a second in air, from a full lungful and how long a full one takes to come back. */
function recoverRate(max: number): number {
  const s = BREATH.recoverSeconds;
  // A recovery of nothing is instant rather than infinite: `max` in one step, which is what "no time
  // at all" ought to mean and is a real answer for the knob.
  if (!Number.isFinite(s) || s <= 0) return Infinity;
  return max / s;
}

/** Write the knobs, ignoring anything that is not a finite number (or a boolean where one goes). */
export function tuneBreath(t: BreathTune | undefined): typeof BREATH {
  if (!t) return BREATH;
  if (typeof t.on === 'boolean') BREATH.on = t.on;
  const num = (v: number | undefined, min: number): boolean => typeof v === 'number' && Number.isFinite(v) && v >= min;
  // A lungful of no seconds at all is not a real answer, and is refused like a tick of nothing: it
  // would leave `maxBreath()` at 0, the air already gone on the first frame under, a blow every tick
  // from there, and a bar with no length for the display to draw. The switch (`on: false`) is how to
  // have no breath; `seconds: 1` is how to have almost none.
  if (num(t.seconds, 0) && t.seconds! > 0) BREATH.seconds = t.seconds!;
  if (num(t.recoverSeconds, 0)) BREATH.recoverSeconds = t.recoverSeconds!;
  if (num(t.tick, 0) && t.tick! > 0) BREATH.tick = t.tick!;
  // 0 is a real answer for both of these: a breath that costs nothing to run out of, and a line said
  // the instant the head goes under.
  if (num(t.damage, 0)) BREATH.damage = t.damage!;
  if (num(t.sayAfter, 0)) BREATH.sayAfter = t.sayAfter!;
  return BREATH;
}

/** The breath as it stands and the numbers in force, for the console. */
export function breathReport(b: Breath): {
  on: boolean;
  /** The head was under on the last step. */
  under: boolean;
  /** Seconds of air left. */
  left: number;
  /** A full lungful, which is the display row's `max`. */
  max: number;
  /** What the bar draws: 1 full, 0 empty. */
  share: number;
  /** Out of air and under: every `tick` from here costs `damage`. */
  drowning: boolean;
  /** The first line has been said for this dive. */
  said: boolean;
  /** Seconds the head has been where it is -- under on a dive, up between them. Both lines wait `sayAfter` of it. */
  since: number;
  /** Seconds until the next drowning blow, or null when none is coming. */
  nextBlow: number | null;
  seconds: number;
  recoverSeconds: number;
  tick: number;
  damage: number;
  sayAfter: number;
} {
  const max = maxBreath();
  const tick = tickSeconds();
  const drowning = b.under && b.left <= 0;
  return {
    on: BREATH.on,
    under: b.under,
    left: b.left,
    max,
    share: max > 0 ? Math.max(0, Math.min(1, b.left / max)) : 0,
    drowning,
    said: b.said,
    since: b.since,
    nextBlow: drowning ? Math.max(0, tick - b.clock) : b.under ? b.left : null,
    seconds: BREATH.seconds,
    recoverSeconds: BREATH.recoverSeconds,
    tick,
    damage: BREATH.damage,
    sayAfter: BREATH.sayAfter,
  };
}
