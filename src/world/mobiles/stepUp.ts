// A walking body's way up a step.
//
// A mobile is a dynamic body with its rotations locked, driven by setting its velocity every frame,
// and a dynamic body has no step-up: the solver decides what it can walk over, and it decides by the
// round of the capsule's foot against the edge in front of it, with the capsule's friction against
// that edge on the other side of the scales. A riser much under the foot's radius it rides over; a
// real step it walks into and stops, which is how a Tusken chasing somebody up the Mos Eisley
// hospital's front steps stood short of the door until its stuck watch gave up: the street rises to
// the porch and the porch's own edge stands half a metre over the ground there, twice the round of a
// small body's foot. The fighters never met it, because a fighter has the player's own character
// controller and its 0.5 m autostep.
//
// Two ways to give it one were open, and this is the second of them on purpose.
//
//   - **A character controller for walking only**, its answer turned into the dynamic body's
//     velocity. It would climb what the player climbs, but it moves one collider and a long creature
//     is several; it casts its shape several times a call for every walking body, where most bodies
//     most of the time are on flat ground and need nothing; its answer is handed back as a new object
//     a call; and the lift it makes would arrive as a vertical velocity the next step's gravity and
//     damping then fight.
//   - **A probe and a lift**, which is this. Nothing is asked while the body goes where it is sent.
//     Only when the step has left it well short of the pace it was pushed at (`heldBack`) are up to
//     six rays cast against what stands still: one or two low, which must meet a face too steep to
//     walk up (the second, at half the step, for a body standing on ground that rises to the riser,
//     where the first meets the rising ground instead); one down just short of that face, for the
//     riser's own foot, which is what the step is measured from; one down just past it, which must
//     find a tread to stand on no higher than the body's step over that foot; one across just over the
//     tread, which must meet nothing for as deep as a foot needs -- the one that refuses a porch too
//     tall whose hollow shell the ray down passed straight through; and one across over the height of
//     any next step, which must find room for the body's whole round over the tread. Then the body is
//     set **on the tread** -- up by the step and along until its support stands over the spot the ray
//     down found -- and a body refused does not ask again for a quarter of a second. Everything the
//     dynamic body is for is untouched -- a knock, a push of the Force, a corpse's ragdoll and its
//     contact filter, being walked into -- because the body is still the solver's in every frame but
//     the one it is lifted.
//
// **Why along as well as up.** The lift used to set the body straight up, its axis still about a rim
// short of the face. That leaves the step's edge under the side of the capsule's round foot, not under
// its bottom, and three things then go wrong, all measured in a real physics world: a body walking
// slowly, or a big one whose foot is wide, falls straight back down past the edge before it has moved
// far enough to land on it (a 0.88 m foot lifted onto a 0.45 m ledge at 0.9 m/s fell 0.27 m back
// down the face three times over and gave up); a person at 0.9 to 3.5 m/s on a ledge of 0.42 to 0.48 m
// came down on the lip itself, where the ground ray (`plan.feet + 0.4` down from its origin) reaches
// neither the tread nor the ground below, so `Mobile.act` set it no pace and friction held it on the
// lip for good; and the stuck watch was handed a commanded speed of nothing and never fired. Set over
// the tread, the ground ray finds the tread on the next frame and none of it can happen. The drawn body
// is eased after the snap (`Mobile` holds it back and lets it catch up over `STEP_TUNE.ease`), so what
// is seen is a body stepping up, not one jumping half a metre.
//
// Measured at the hospital itself, a person-sized body stalled at 4.63 m in front of the 5.18 m
// porch with the step-up off and gave the door up; with it on, it was set on the porch once and was in
// the entrance room five seconds after its quarry. A dulok, whose template gives it 0.37 m at its size,
// is refused there and goes round to the hospital's other door, whose sill is 0.18 m over the street.
//
// How high is the body's own: the template's `stepHeight` (0.5 on 4,362 of the catalogue's 5,067
// entries), at its size, capped at `most`, which is the player's own autostep and the height the
// outdoor grid already calls something a body walks over (`AUTOSTEP` in `tools/swg/navgrid.mjs`), so
// the grid's promise and the body's reach are one number. A ledge past it is refused and the stuck
// watch and the grid carry on as before.
//
// No three and no rapier in here, and nothing imported at all, so the node test drives the very
// functions the game runs against a real physics world -- `walkStep` and `onFeet` are the whole of what
// `Mobile.act` does about steps, and the test's walk calls the same two. Nothing is made in a frame:
// the rays' answers go into one struct the caller keeps, and the lift is written through another; only
// the console's trace (`__debug.stepProbe`) keeps anything.

/** Every invented number of the step-up, live through `__debug.mobileTune({ step: { … } })`. */
export interface StepTune {
  /** The switch: off, a mobile walks into a step exactly as it did before it could climb one. */
  on: boolean;
  /**
   * The highest step any body climbs, metres, whatever its template says: the player's autostep,
   * and the grid's own line between walked over and walked into.
   */
  most: number;
  /**
   * The lower probe's height over the feet, metres: the first riser of a flight is met here. Anything
   * lower the capsule's rounded foot rides over by itself.
   */
  low: number;
  /** How far past the body's own rim the probes look ahead, metres. */
  reach: number;
  /**
   * How deep a tread must be clear over the step for a foot to go on it, metres: the player's own
   * autostep width. The tread is sampled half of this past the face, and that spot is where the lift
   * sets the body's support.
   */
  width: number;
  /** How far over the step height the ray down starts, metres, so a tread exactly at the step is still found under it. */
  over: number;
  /**
   * How far over the tread the way onto it must be clear, metres: low enough to pass under a door's
   * lintel and over a tread's own lip, high enough that the ray is not grazing the tread itself. The
   * room the whole body needs is asked this far over the height of any next step.
   */
  above: number;
  /** How far over the tread the body is set, metres: a hair, so it is not set into the tread. */
  clear: number;
  /**
   * The largest upward share of a face's normal that still counts as a riser: 0.5 is a face steeper
   * than sixty degrees. Anything gentler is a slope, which the solver walks and the grid judges.
   */
  riser: number;
  /** The smallest upward share of a tread's normal a foot can go on: 0.7 is the grid's own 45 degrees. */
  tread: number;
  /**
   * The share of the speed it was pushed at, along its heading, below which the step left the body
   * held back and the probes are asked. A slope the solver walks keeps more than this (the cosine
   * squared of its angle, a half at 45 degrees); a riser or a wall keeps next to nothing.
   */
  blocked: number;
  /**
   * How long a body that asked and was refused waits before it asks again, seconds. A body held back by
   * a crowd or pressed against a wall is held back on every frame, and forty Tuskens round one player
   * asked five hundred times a second when every frame asked; nothing about a wall changes in a quarter
   * of a second, and a step it has only just come to is asked about on the first frame it is met.
   */
  retry: number;
  /**
   * How quickly the drawn body catches up with a lift, seconds: the time constant the offset it is
   * held back by falls away over, so it covers most of the step in about three of these. Only the
   * picture: the physics body is on the tread at once.
   */
  ease: number;
}

export const STEP_TUNE: StepTune = {
  on: true,
  most: 0.5,
  low: 0.1,
  reach: 0.3,
  width: 0.2,
  over: 0.05,
  above: 0.15,
  clear: 0.02,
  riser: 0.5,
  tread: 0.7,
  blocked: 0.5,
  retry: 0.25,
  ease: 0.07,
};

/** What the probes found and refused, since the session began, for the console. */
export interface StepStats {
  /** Times a held-back body asked. */
  asked: number;
  /** Times it was set on a step. */
  lifted: number;
  /** Nothing in the way at a riser's height: held back by something else (a body, a slope's end). */
  clear: number;
  /** In the way at a riser's height, and gentle enough to be a slope rather than a step. */
  slope: number;
  /** A ledge too tall, no room over the tread for a foot, or none for the body: a wall. */
  wall: number;
  /** No tread just past the face, or one too steep, or none higher than the ground it stands on. */
  noTread: number;
}

export const STEP_STATS: StepStats = { asked: 0, lifted: 0, clear: 0, slope: 0, wall: 0, noTread: 0 };

/** One ray's answer, written in place: how far along it the hit was, and the upward share of the surface's normal there. */
export interface StepRay {
  toi: number;
  ny: number;
}

/**
 * What the last probe that found a step found, written in place by `stepAhead` and read at once by
 * its caller: how far ahead of the support's axis the riser's face stood, the tread's height, which of
 * the two low rays met the face (0 the first, a tenth over the feet; 1 the second, at half the step),
 * and the height of the riser's own foot the step was measured from.
 */
export const STEP_FOUND = { face: 0, top: 0, low: 0, foot: 0 };

/**
 * The one question the probes ask of the physics (`Physics.standingHit`): the first thing that
 * **stands still** along a ray within `len`, under the body's own collision filter. Nothing that
 * moves may answer, or a body steps up onto the womp rat in front of it.
 */
export interface StepProbe {
  standingHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, filter: number, out: StepRay): boolean;
}

/** The body the lift is written to: a rapier rigid body, through the one call it needs. */
export interface StepBody {
  setTranslation(at: { x: number; y: number; z: number }, wake: boolean): void;
}

/** How high a step a body climbs: its template's own at its size, capped at `most`; 0 for a template that says none. */
export function stepHeightOf(templateStep: number | undefined, scale: number, tune: StepTune = STEP_TUNE): number {
  const own = (Number.isFinite(templateStep) ? (templateStep as number) : 0.5) * (scale > 0 ? scale : 1);
  return Math.max(0, Math.min(tune.most, own));
}

/**
 * Whether the last step left a body well short of where it was pushed: its velocity along its
 * heading now, against the speed it was set to go at before the step. The cheap gate in front of the
 * probes, so a body walking where it is sent casts nothing.
 */
export function heldBack(vx: number, vz: number, dirX: number, dirZ: number, pushed: number, tune: StepTune = STEP_TUNE): boolean {
  if (!tune.on || !(pushed > 0.05)) return false;
  return vx * dirX + vz * dirZ < tune.blocked * pushed;
}

/** One ray of a probe, for the console's account of why a body did or did not climb (`__debug.stepProbe`). */
export interface StepTrace {
  ray: 'low' | 'foot' | 'down' | 'across' | 'room';
  from: [number, number, number];
  dir: [number, number, number];
  len: number;
  hit: boolean;
  toi: number;
  ny: number;
}

/** Cast one ray through the probe, and write it down when a trace is being kept. */
function cast(probe: StepProbe, trace: StepTrace[] | null, ray: StepTrace['ray'], ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, filter: number, hit: StepRay): boolean {
  const got = probe.standingHit(ox, oy, oz, dx, dy, dz, len, filter, hit);
  if (trace) trace.push({ ray, from: [ox, oy, oz], dir: [dx, dy, dz], len, hit: got, toi: got ? hit.toi : Number.NaN, ny: got ? hit.ny : Number.NaN });
  return got;
}

/**
 * The height of the step in front of a body to stand on, or NaN for none: its feet at `x, footY, z`,
 * walking along the unit `dirX, dirZ`, its rim `rim` out from its axis, able to climb `step`.
 * `filter` is its own collision filter, so a body indoors probes the rooms and not the shells.
 * `trace`, for the console and the node test only, is handed every ray cast; in play it is null and
 * nothing is kept. What it found goes into `STEP_FOUND`.
 */
export function stepAhead(probe: StepProbe, x: number, footY: number, z: number, dirX: number, dirZ: number, rim: number, step: number, filter: number, hit: StepRay, tune: StepTune = STEP_TUNE, trace: StepTrace[] | null = null): number {
  STEP_STATS.asked++;
  if (!(step > tune.low)) {
    STEP_STATS.wall++;
    return Number.NaN;
  }
  const look = rim + tune.reach;
  // 1. Low: a face it cannot walk up, in the way at a first riser's height. The normal's size and not
  //    its sign: a building's steps are a triangle soup, and which way round a face was wound is the
  //    modeller's, not the step's. A body standing on ground that rises to the riser meets that ground
  //    first, so a gentle face at the first height is asked again at half the step.
  let face = Number.NaN;
  let faceUp = 0;
  let faceRay = 0;
  let sloped = false;
  for (let k = 0; k < 2 && Number.isNaN(face); k++) {
    const up = k === 0 ? tune.low : step * 0.5;
    if (k === 1 && !(up > tune.low)) break;
    if (!cast(probe, trace, 'low', x, footY + up, z, dirX, 0, dirZ, look, filter, hit)) continue;
    if (Math.abs(hit.ny) > tune.riser) sloped = true;
    else {
      face = hit.toi;
      faceUp = up;
      faceRay = k;
    }
  }
  if (Number.isNaN(face)) {
    if (sloped) STEP_STATS.slope++;
    else STEP_STATS.clear++;
    return Number.NaN;
  }
  // 2. The riser's own foot, just short of the face: how high a step is is how high it stands over the
  //    ground it rises from, and a body on ground climbing to the riser stands lower than that, by as
  //    much as the ground climbs under its own round foot. On level ground this is the feet.
  let foot = footY;
  const short = Math.max(0, face - tune.width / 4);
  if (cast(probe, trace, 'foot', x + dirX * short, footY + faceUp, z + dirZ * short, 0, -1, 0, faceUp + tune.low, filter, hit) && hit.toi > 1e-3) {
    foot = Math.max(footY, footY + faceUp - hit.toi);
  }
  // 3. Down, just past the face: a tread, gentle enough to stand on, higher than the riser's foot and
  //    no higher than the body's step over it. A ray that starts inside something, or finds a top over
  //    the step, has met a ledge too tall: a wall.
  const high = foot + step + tune.over;
  const into = face + tune.width / 2;
  if (!cast(probe, trace, 'down', x + dirX * into, high, z + dirZ * into, 0, -1, 0, high - footY, filter, hit)) {
    STEP_STATS.noTread++;
    return Number.NaN;
  }
  const top = high - hit.toi;
  if (hit.toi < 1e-3 || top > foot + step + 1e-6) {
    STEP_STATS.wall++;
    return Number.NaN;
  }
  if (Math.abs(hit.ny) < tune.tread || !(top > foot + tune.low * 0.5)) {
    STEP_STATS.noTread++;
    return Number.NaN;
  }
  // 4. Across, just over that tread: room for a foot, as deep as the width past the face.
  if (cast(probe, trace, 'across', x, top + tune.above, z, dirX, 0, dirZ, face + tune.width, filter, hit)) {
    STEP_STATS.wall++;
    return Number.NaN;
  }
  // 5. Across again, over the height of any next step: room for the whole of the body's round where the
  //    lift is going to set it, which is its support over the spot the ray down found. Asked above the
  //    next riser, since a flight's next step stands within a rim of the tread and the body is lifted
  //    onto that one in its turn; what this refuses is a wall standing close behind a narrow tread.
  if (cast(probe, trace, 'room', x, top + step + tune.above, z, dirX, 0, dirZ, into + rim, filter, hit)) {
    STEP_STATS.wall++;
    return Number.NaN;
  }
  STEP_FOUND.face = face;
  STEP_FOUND.top = top;
  STEP_FOUND.low = faceRay;
  STEP_FOUND.foot = foot;
  return top;
}

/** The lift, written through here and never made. */
const liftTo = { x: 0, y: 0, z: 0 };

/**
 * Ask, and climb: the step in front of a body held back by it, and the body set on its tread if there
 * is one -- up to the tread and along until its support stands over the spot the probe found it, half
 * the probe's width past the face. `feet` is how far the rigid body's origin sits over its feet
 * (`BodyPlan.feet`), and `bodyX`, `bodyZ` where that origin is -- the support can stand off it along a
 * long creature, and moves with it. True when it was lifted, and the caller then drops any fall it
 * was carrying so it does not come down through the tread it has just been put on. How far it went
 * up and along is left in `STEP_FOUND` (`top`, `face`) for the caller to ease the picture over.
 */
export function climbStep(probe: StepProbe, body: StepBody, bodyX: number, bodyZ: number, x: number, footY: number, z: number, dirX: number, dirZ: number, rim: number, step: number, feet: number, filter: number, hit: StepRay, tune: StepTune = STEP_TUNE, trace: StepTrace[] | null = null): boolean {
  if (!tune.on) return false;
  const top = stepAhead(probe, x, footY, z, dirX, dirZ, rim, step, filter, hit, tune, trace);
  if (!(top > footY)) return false;
  const ahead = liftAhead(tune);
  liftTo.x = bodyX + dirX * ahead;
  liftTo.y = top + feet + tune.clear;
  liftTo.z = bodyZ + dirZ * ahead;
  body.setTranslation(liftTo, true);
  STEP_STATS.lifted++;
  return true;
}

/** How far along its heading the last lift carried a body: to the spot the tread was found at. */
function liftAhead(tune: StepTune): number {
  return STEP_FOUND.face + tune.width * 0.5;
}

/**
 * What one walking body keeps of the step-up between frames, as plain fields a body holds one of for
 * its life (`stepWalker`) and `resetStepWalker` puts back on a respawn or a change of hands.
 */
export interface StepWalker {
  /** The speed it was set walking at last frame, 0 when it was not: what `heldBack` measures the step against. */
  pushed: number;
  /** The simulated second before which a body the probes just refused does not ask them again. */
  retryAt: number;
  /** Lifted onto a step and its ground ray not yet on anything (`onFeet`). */
  footing: boolean;
  /** Its feet's height before the last lift, and the tread's. */
  liftFrom: number;
  liftTop: number;
  /** How many times it has been lifted, and how far up and along the last lift took it: what the picture is eased over. */
  lifts: number;
  rise: number;
  ahead: number;
}

export function stepWalker(): StepWalker {
  return { pushed: 0, retryAt: 0, footing: false, liftFrom: 0, liftTop: 0, lifts: 0, rise: 0, ahead: 0 };
}

export function resetStepWalker(w: StepWalker): void {
  w.pushed = 0;
  w.retryAt = 0;
  w.footing = false;
}

/**
 * The body a walker climbs with, written in place by its owner (nothing here keeps one): how far its
 * support stands along its heading from its origin (off it only on a long creature), the support's
 * rim, the step it climbs (`stepHeightOf`) and how far its origin sits over its feet.
 */
export interface StepShape {
  along: number;
  rim: number;
  step: number;
  feet: number;
}

/**
 * Whether a body walks on its own feet this frame: on the ground, or just lifted onto a step and not
 * yet found it with its ground ray. `footY` is its feet.
 *
 * The lift sets a body's support over the tread, so for nearly every body the ground ray, which is
 * cast from its origin, finds the tread on the very next frame and this is the ground check and
 * nothing more. The footing is for the rest: a long creature whose origin stands behind its support,
 * so its ray is still over the ground below when its support is on the step, would otherwise be set
 * on the step with no pace at all. It holds until the ray finds something, or until the feet have
 * fallen back below halfway between where they were lifted from and the tread, since then the body is
 * off the step and on its own again: falling, or on the ground it came from.
 */
export function onFeet(w: StepWalker, grounded: boolean, footY: number): boolean {
  if (w.footing) {
    if (grounded || footY <= (w.liftFrom + w.liftTop) * 0.5) w.footing = false;
    else return true;
  }
  return grounded;
}

/**
 * One frame of a body walking on its feet, as `Mobile.act` runs it and the node test runs it: asked
 * only when it is on the ground itself (`ground`: not a flyer, not a swimmer, and not merely carried by
 * a footing), was held back by the last step, and was not lately refused. Lifted, any fall it carried
 * is dropped and the lift is counted with how far it went up and along (`lifts`, `rise`, `ahead`),
 * for the picture; refused, it waits `retry`. Answers the vertical speed to walk on, and notes the pace
 * it is being set at for the next frame's gate. `footY` is its feet, `bodyX`, `bodyZ` its origin,
 * `sx`, `sz` its heading.
 */
export function walkStep(
  probe: StepProbe,
  body: StepBody,
  w: StepWalker,
  now: number,
  ground: boolean,
  speed: number,
  vx: number,
  vy: number,
  vz: number,
  sx: number,
  sz: number,
  shape: StepShape,
  bodyX: number,
  footY: number,
  bodyZ: number,
  filter: number,
  hit: StepRay,
  tune: StepTune = STEP_TUNE,
  trace: StepTrace[] | null = null,
): number {
  let out = vy;
  if (ground && now >= w.retryAt && heldBack(vx, vz, sx, sz, w.pushed, tune)) {
    const x = bodyX + sx * shape.along;
    const z = bodyZ + sz * shape.along;
    if (climbStep(probe, body, bodyX, bodyZ, x, footY, z, sx, sz, shape.rim, shape.step, shape.feet, filter, hit, tune, trace)) {
      out = Math.max(0, vy);
      w.footing = true;
      w.liftFrom = footY;
      w.liftTop = STEP_FOUND.top;
      w.lifts++;
      w.rise = STEP_FOUND.top + tune.clear - footY;
      w.ahead = liftAhead(tune);
    } else w.retryAt = now + tune.retry;
  }
  w.pushed = speed;
  return out;
}

/** A frame the body was not set walking: the next frame's gate has no pace to measure against. */
export function stoodStill(w: StepWalker): void {
  w.pushed = 0;
}

/**
 * How much of a lift the picture still lags behind by after `dt`, as a share: the offset the drawn body
 * is held back by is multiplied by this each frame, and dropped once it is under a millimetre.
 */
export function easeShare(dt: number, tune: StepTune = STEP_TUNE): number {
  return tune.ease > 0 ? Math.exp(-dt / tune.ease) : 0;
}

/** Move any number of the step-up live; a switch only by a switch, a number only by a finite number. */
export function tuneStep(values: Partial<StepTune>): StepTune {
  for (const k of Object.keys(values) as (keyof StepTune)[]) {
    const val = values[k];
    const had = STEP_TUNE[k];
    if (typeof had === 'boolean' && typeof val === 'boolean') (STEP_TUNE as unknown as Record<string, unknown>)[k] = val;
    else if (typeof had === 'number' && typeof val === 'number' && Number.isFinite(val)) (STEP_TUNE as unknown as Record<string, unknown>)[k] = val;
  }
  return STEP_TUNE;
}
