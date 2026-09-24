// How a body moves now that **where it is pointed and where it is going are two numbers**.
//
// Until this wave every body in this game moved along its own heading: a creature set its velocity
// from it and a fighter set its wish from it, so keeping a gun on you and going anywhere were the
// same act, and the only sidestep anything had was a twist of the whole body for a second. Splitting
// them is most of the risk in this wave and none of its arithmetic, which is why the arithmetic is
// here: a handful of invented numbers in a file with no three, no rapier and no browser in it, so a
// node test reads the very object the game runs on.
//
// The first number is the one the whole split stands on, and it is a limit rather than a target.
// **There is no strafe clip in either game** -- none among a species rig's named clips and none in
// Jedi Academy's -- so a body sliding sideways is drawn walking along its legs whatever its gun is
// doing, and the only honest sidestep is Jedi Academy's own angled-legs one: its `CG_PlayerAngles`
// puts the legs at the movement offset and the torso at a quarter of it. Held to `legMax`, a
// tier-3 body's whole slide fits inside the aim's own spine fold (`STANCE_TUNE.spineMax`, 0.6 rad)
// and its legs point exactly where it is really going; only the top of the ladder leans, and it
// leans about as far as a Jedi Academy strafe does. Past `legMax` the gun gives way and the whole
// body turns to walk, which is what every body in this game has always done.
//
// Every number is invented, and all of it is live: `__debug.fighters({ step: { legMax: 0 } })` is a
// body that never lets its feet leave its gun, which is the comparison to make by eye.

export interface GroundStep {
  /**
   * The most the travel may sit off the facing, radians. Past it the body turns to walk and the gun
   * goes with it.
   *
   * It is a ceiling over every body and not the figure any one of them uses: a **slide** is held to
   * its own tier's share as well (`asin(GroundSkill.strafe)`, which is the angle at which exactly
   * that share of its speed goes sideways), so the ladder really leans by different amounts --
   * nothing at the bottom two rungs, about twenty degrees at the third, thirty-seven at the fourth
   * and fifty-eight at the top, which is where this ceiling starts to bite. Without that the slide
   * on the ring was a right angle at every tier and was clamped to this one number, so a tier-3 body
   * and a tier-5 body slid at the same speed in the same direction and only the duty cycle differed.
   */
  legMax: number;
  /**
   * The share of a gun's own range a gunner holds off at, and the share of **that** ring inside
   * which it backs away again. Both are shares rather than metres, so moving the range moves the
   * ring with it and a short-ranged weapon does not stand its holder off at a rifle's distance.
   *
   * `closeIn` is high on purpose. A slide held to `legMax` is a diagonal, so a body circling its
   * ring closes on it a little all the time and eventually has to walk back out -- and walking back
   * out is the one thing it does with its back turned, since there is no backpedal pose to draw.
   * Tight, that happens often and briefly; loose, it happens rarely and for several seconds at a
   * time, which is far more noticeable.
   */
  standoff: number;
  closeIn: number;
  /**
   * How far round that ring a body's own slot may put it, radians. The slot is one number off the
   * body's own key, so two bodies never pick the same line and nothing is shared or negotiated --
   * which is the whole of the spacing that needed no plumbing.
   */
  ringSpread: number;
  /**
   * How often a body decides whether to slide at all, seconds, and how long one slide lasts.
   *
   * The slide is a **duty cycle** and not a state, and that is the thing to understand about it. A
   * gunner that slid whenever it could would be walking on every frame it was shooting, and a body
   * that is walking never kneels (`postureFor` only ever puts a body down while it is holding its
   * ground) -- so a continuous slide would have quietly taken the whole of the kneeling away. At
   * each boundary the body rolls its tier's `strafe` for whether to slide for `slideFor` seconds or
   * to stand where it is and shoot; a top-tier body therefore slides most of the time and a middle
   * one a third of it, and both still go down on one knee between slides. It may swap sides at the
   * same boundary, so a fight does not become a carousel.
   */
  flipEvery: number;
  slideFor: number;
  /**
   * How near an ally stands before it is pushed off, metres, and the most of the travel that push
   * may be. It is a nudge and not a solver: a fighter's character controller passes straight through
   * another fighter on purpose, since a crowd jammed on itself would each report itself stuck and
   * give the fight up.
   */
  spacing: number;
  spacingPush: number;
  /** Seconds a cover spot is walked at before it is given up as somewhere this body cannot reach. */
  coverHold: number;
  /**
   * Seconds a body stays in cover it **cannot shoot out of**, once it is standing in it, and
   * seconds afterwards during which it will not take another such spot.
   *
   * These two exist because hard cover is a one-way door without them, and that was the one real
   * bug in the first cut of this wave. A spot blocked at a standing chest as well as a crouched one
   * stops the body's own bolts as surely as it stops the ones coming at it, and `postureFor` puts a
   * body standing in one into a crouch -- which in the client's own data carries no actions at all.
   * So such a body fires nothing; and since the hold was renewed on every look while the spot still
   * tested as cover, and every tier above the bottom looks oftener than the hold is long, it renewed
   * for ever. A tier-5 gunner ducked behind a wall and stayed there for the rest of the evening,
   * with the player unable to shoot it either, because hard cover is hard both ways.
   *
   * So a hole is a **duck and not a position**: it is held for `hardFor` from the moment the body
   * is really in it, and then given up, and for `hardRest` after that a hole is worth nothing to the
   * search at any price, so the body presses forward or finds somewhere it can shoot from instead.
   * Cover it *can* shoot out of is the other thing entirely and is renewed for as long as it holds,
   * because that is a firing position and a body should stay in one.
   */
  hardFor: number;
  hardRest: number;
}

export const GROUND_STEP: GroundStep = {
  legMax: 1.05,
  standoff: 0.7,
  closeIn: 0.85,
  ringSpread: 0.5,
  flipEvery: 2.5,
  slideFor: 1.2,
  spacing: 2.2,
  spacingPush: 0.5,
  coverHold: 6,
  hardFor: 3,
  hardRest: 8,
};

/** Nothing here goes negative: a lean of nought is a body that turns to walk, which is legible. */
const STEP_FLOOR: Record<keyof GroundStep, number> = { legMax: 0, standoff: 0, closeIn: 0, ringSpread: 0, flipEvery: 0, slideFor: 0, spacing: 0, spacingPush: 0, coverHold: 0, hardFor: 0, hardRest: 0 };

/** Move the movement's own numbers live; returns what is in force. `__debug.fighters({ step: { legMax: 0 } })`. */
export function tuneGroundStep(opts?: Partial<GroundStep> | null): GroundStep {
  if (!opts) return GROUND_STEP;
  for (const key of Object.keys(GROUND_STEP) as (keyof GroundStep)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) GROUND_STEP[key] = Math.max(STEP_FLOOR[key], v);
  }
  return GROUND_STEP;
}
