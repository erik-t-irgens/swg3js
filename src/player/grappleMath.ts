// The grapple's arithmetic that needs nothing but numbers: the rope's words (whether the body is on the
// rope or on its feet, and how), the dart's aim, the drawn sag, which marks the dart may bite, what the
// hook mutes, the gravity knob's add-back, the clip of a velocity into a surface, the swim's lift test,
// the wading drag, the teleport guard, the wall friction that spares the sway, and the ribbon's least
// width; and from wave 2 the danger (a slam's harm, what counts as one, the stagger's shake and daze, the
// fast flight after a let-go, the catch's jolt) and the look and the sound (the arm's reach, the camera's
// scale, the lean and its ease, the ratchet's rate, the wind); and from wave 3 the mass rule (`whoMoves`, who a
// rope moves) and a point carried into a prop's own frame and back. No three, no Rapier, no page: a node test
// calls every one of these as the game does.
//
// Every number these read is the caller's (`GRAPPLE_TUNE` in `grapple.ts`, handed in); none is kept here.

/** The controller's climb limit as a normal's upward share: a face this level or more is walkable (cos 55°). */
export const WALKABLE = Math.cos((55 * Math.PI) / 180);

/**
 * The length of (x, y) and of (x, y, z), by `Math.sqrt`. Every length the hook works out a frame goes through
 * these and never `Math.hypot`, which hands back a fresh number even from optimised code (measured: about 5 bytes
 * a call), and the hook's frame allocates nothing.
 */
export function len2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
export function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * The words every rule of the rope uses, worked out once a frame by `ropeModes` and nowhere else, so the
 * movement's command, the mutes, the boost, the bar and the gravity knob can never disagree about which
 * state the body is in.
 */
export interface RopeModes {
  /** The rope is fastened to an anchor. */
  attached: boolean;
  /** The character controller found ground on the last move, and the body is not afloat. */
  onGround: boolean;
  /** The constraint's own answer: at its length within `tautEps`, or it took outward speed off. */
  taut: boolean;
  /**
   * Taut, or inside its length by no more than `latchSlack`: what the slide reads. A swing scraping the ground
   * is held a few centimetres inside its length by the ground itself, and is still the rope's.
   */
  held: boolean;
  /** Attached, and the swim ran this frame: never hanging, sliding, swinging or on the ground. */
  afloat: boolean;
  /** Attached, not afloat, not on the ground. */
  hanging: boolean;
  /** Attached, not afloat, on the ground, held, latched and faster than `slideOver` across the ground. */
  sliding: boolean;
  /** Hanging or sliding: the keys sway, Space boosts, the snap is off. */
  swinging: boolean;
  /** The slide latch as it stands after this frame's words (afloat clears it). */
  latch: boolean;
}

export function newRopeModes(): RopeModes {
  return { attached: false, onGround: false, taut: false, held: false, afloat: false, hanging: false, sliding: false, swinging: false, latch: false };
}

/** The words of the rope from what the frame knows, into a kept record. Nothing else decides them. */
export function ropeModes(attached: boolean, onGround: boolean, swimming: boolean, taut: boolean, held: boolean, latch: boolean, horizSpeed: number, tune: { slideOver: number }, out: RopeModes): RopeModes {
  const afloat = attached && swimming;
  out.attached = attached;
  out.afloat = afloat;
  out.onGround = afloat ? false : onGround;
  out.taut = attached && taut;
  out.held = attached && (taut || held);
  out.latch = attached && !afloat && latch;
  out.hanging = attached && !afloat && !onGround;
  out.sliding = attached && !afloat && onGround && out.held && out.latch && horizSpeed > tune.slideOver;
  out.swinging = out.hanging || out.sliding;
  return out;
}

/**
 * The dart's launch direction, aimed true: `d` chosen so that `u·d + v` points along the unit vector `e`
 * toward the mark, `v` the shooter's velocity relative to the target (the player's own until a target
 * moves). `d = normalize(k·e − v)` with `k = e·v + √((e·v)² − |v|² + u²)`, the speed along the line.
 * Writes `d` into `out` and answers `k`, or 0 when no such aim exists (the shooter as fast as the dart).
 */
export function aimTrue(ex: number, ey: number, ez: number, vx: number, vy: number, vz: number, u: number, out: { x: number; y: number; z: number }): number {
  const ev = ex * vx + ey * vy + ez * vz;
  const vv = vx * vx + vy * vy + vz * vz;
  const disc = ev * ev - vv + u * u;
  if (!(disc >= 0) || !(vv < u * u)) return 0;
  const k = ev + Math.sqrt(disc);
  if (!(k > 0)) return 0;
  let dx = k * ex - vx;
  let dy = k * ey - vy;
  let dz = k * ez - vz;
  const l = len3(dx, dy, dz);
  if (!(l > 0)) return 0;
  dx /= l;
  dy /= l;
  dz /= l;
  out.x = dx;
  out.y = dy;
  out.z = dz;
  return k;
}

/**
 * How far a free span of length `span` sags at its middle with `slack` of rope over the straight line:
 * a shallow parabola's √(3·span·slack/8). Nothing for no slack. The ribbon hands it the slack less the
 * taut band, so a rope inside the band is drawn straight and one past it sags from nought, never jumping.
 */
export function sagOf(span: number, slack: number): number {
  if (!(slack > 0) || !(span > 0)) return 0;
  return Math.sqrt((3 * span * slack) / 8);
}

/**
 * What the mark's point is: the kinds the dart may hold (`terrain`, `still`, and from wave 3 a `vehicle`'s hull, moving or
 * not), hook (`prop`), and the ones it refuses (a rideable `creature`, which is a creature to the rope this pass).
 */
export type MarkKind = 'none' | 'terrain' | 'still' | 'pane' | 'water' | 'door' | 'prop' | 'moving' | 'vehicle' | 'creature';

/** Whether a kind holds the dart as an anchor: something that stands still, or a vehicle's hull. */
export function kindHolds(kind: MarkKind): boolean {
  return kind === 'terrain' || kind === 'still' || kind === 'vehicle';
}

/** Whether the dart bites a kind at all: an anchor, or a loose prop it hooks (wave 3), which the mass rule then judges. */
export function kindBites(kind: MarkKind): boolean {
  return kindHolds(kind) || kind === 'prop';
}

/**
 * Who the rope moves (the progression doc's mass rule, §3.14): the player for anything still; the thing when its
 * mass is at or under the tether's strength; both, a tug-of-war, up to `heavyRatio` times the player's mass; the
 * player past that. This pass reaches `thing` (a loose prop) and `player` (anything still); nothing yet answers `both`.
 */
export type WhoMoves = 'player' | 'thing' | 'both';

export function whoMoves(still: boolean, mass: number, strength: number, playerMass: number, tune: { heavyRatio: number }): WhoMoves {
  if (still) return 'player';
  if (mass <= strength) return 'thing';
  if (mass <= tune.heavyRatio * playerMass) return 'both';
  return 'player';
}

/**
 * A point `v` turned by a unit quaternion `q` (or by its inverse, `inverse` true), into `out` (which may be `v`): how a
 * point kept in a prop's own frame is carried onto the prop as it lies, and back. The point comes in a kept record, as
 * the lean's direction does, since the hook's frame calls this every frame it holds a prop.
 */
export function turnByQuat(
  q: { readonly x: number; readonly y: number; readonly z: number; readonly w: number },
  v: { readonly x: number; readonly y: number; readonly z: number },
  inverse: boolean,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const x = v.x;
  const y = v.y;
  const z = v.z;
  const qx = inverse ? -q.x : q.x;
  const qy = inverse ? -q.y : q.y;
  const qz = inverse ? -q.z : q.z;
  const qw = q.w;
  // t = 2 (q × v); v' = v + w t + q × t.
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out.x = x + qw * tx + (qy * tz - qz * ty);
  out.y = y + qw * ty + (qz * tx - qx * tz);
  out.z = z + qw * tz + (qx * ty - qy * tx);
  return out;
}

/**
 * Whether a point stands under the drawn water: a column of water over it (`flat`, the world's `waterColumnAt`,
 * -Infinity where there is none) whose surface, with the swell over that flat added, is above the point. The
 * game's mark asks this first and a flow's depth after it (`World.lavaAt`); the swell is the caller's to read,
 * and only where there is a column.
 */
export function underWater(y: number, flat: number, swell: number): boolean {
  return Number.isFinite(flat) && flat + swell > y;
}

/**
 * What the mark's range test reads: the point's distance from the hand and the range, which the caller reads through
 * the stat table (`grapple.range`, the tune's own while nothing grants it). A kept record the probe writes in place
 * before it asks, because the probe runs every frame for a player who never fires and a number handed to a call that
 * is not built into the caller is a fresh number; whether this one is built in is the compiler's budget's to decide,
 * and the probe's budget is spent on the casts and the getters round it (wave 3 put the range's read in it).
 */
export interface MarkReach {
  dist: number;
  range: number;
}

/** Whether the mark shows: a kind the dart bites, no nearer than `minRange` and no further than the range. */
export function markShows(kind: MarkKind, reach: { readonly dist: number; readonly range: number }, tune: { minRange: number }): boolean {
  return kindBites(kind) && reach.dist >= tune.minRange && reach.dist <= reach.range;
}

/**
 * What the hook mutes for the frame, by action, into a kept list: nothing while it is not out; while it
 * is, the walk, the crouch and the torch (whose keys the reels and the haul borrow), the two postures and
 * the emotes, and the jump only while swinging (Space is the boost then; on the ground it jumps, and in
 * water it swims up). On a loose prop (`holding`, wave 3) the reels do nothing and the body is on its feet
 * as ever, so only the torch (F is the yank) and the emotes (refused while the rope is out) are muted: the
 * walk, the crouch and its landing roll, and the postures are the player's. Answers how many it wrote.
 */
export function grappleMutes(out: string[], isOut: boolean, swinging: boolean, holding = false): number {
  const list = !isOut ? null : holding ? HOLD_MUTES : OUT_MUTES;
  const n = list === null ? 0 : list === OUT_MUTES && swinging ? OUT_MUTES.length + 1 : list.length;
  // The kept list holds one of four lists, each its own length and its own first word: written only when it changes,
  // since emptying an array and pushing into it again hands it a new backing store often enough to cost a byte a frame.
  if (out.length !== n || (list !== null && out[0] !== list[0])) {
    out.length = 0;
    if (list !== null) {
      for (let i = 0; i < list.length; i++) out.push(list[i]);
      if (list === OUT_MUTES && swinging) out.push('jump');
    }
  }
  return n;
}

/** What the hook mutes for as long as it is out on an anchor or in flight, whatever it is doing. */
const OUT_MUTES: readonly string[] = ['walk', 'crouch', 'flashlight', 'prone', 'kneel', 'emoteWheel', 'emote1', 'emote2', 'emote3', 'emote4'];

/** What it mutes while the rope holds a loose prop: the torch, whose key is the yank, and the emotes, which the game refuses while the rope is out. */
const HOLD_MUTES: readonly string[] = ['flashlight', 'emoteWheel', 'emote1', 'emote2', 'emote3', 'emote4'];

/** What every let-go mutes until its keys are up: a held Space would hop on landing, a held F light the torch, a held Shift walk. Never the crouch, which is the landing roll. */
export const GRAPPLE_RELEASE_MUTES: readonly string[] = ['jump', 'flashlight', 'walk'];

/**
 * What a let-go of a loose prop mutes until its keys are up: only the torch, whose key was the yank. The jump and the
 * walk were the player's own all the while the prop was on the line, so a Space or a Shift held through the let-go is
 * the jump and the walk it already was.
 */
export const THING_RELEASE_MUTES: readonly string[] = ['flashlight'];

/**
 * What the gravity knob puts back on the vertical speed a frame: `(1 − scale)·g·dt`. The caller never
 * asks at a scale of 1 (`+= 0` would turn a −0 into +0) and asks only while attached and swinging.
 */
export function gravityAddBack(scale: number, g: number, dt: number): number {
  return (1 - scale) * g * dt;
}

/**
 * The velocity's part into a surface the controller refused, taken off: the speed into it measured
 * relative to the surface's own point velocity `sv` (null for anything fixed or bodiless, which is never
 * read and so is the old arithmetic to the bit), or absolute with `relative` off. Writes the clipped
 * velocity into `out` (which may be `v` itself) and answers the speed into the surface, nought when the
 * body was not moving into it.
 */
export function clipInto(
  v: { x: number; y: number; z: number },
  n: { x: number; y: number; z: number },
  sv: { x: number; y: number; z: number } | null,
  relative: boolean,
  out: { x: number; y: number; z: number },
): number {
  clipIntoRec(v, n, sv, relative, out, CLIP_ANSWER);
  return CLIP_ANSWER.into;
}

/** `clipInto`'s answer, written into a kept record: what a caller asks that runs too seldom for the call to be built into it, where a number handed back would be a fresh one. */
export interface ClipAnswer {
  into: number;
}
const CLIP_ANSWER: ClipAnswer = { into: 0.5 };

/** `clipInto` with its answer written into `res` (the arithmetic is this function's; `clipInto` hands it back). */
export function clipIntoRec(
  v: { x: number; y: number; z: number },
  n: { x: number; y: number; z: number },
  sv: { x: number; y: number; z: number } | null,
  relative: boolean,
  out: { x: number; y: number; z: number },
  res: ClipAnswer,
): void {
  const rel = relative && sv !== null;
  const rx = rel ? v.x - sv.x : v.x;
  const ry = rel ? v.y - sv.y : v.y;
  const rz = rel ? v.z - sv.z : v.z;
  const into = -(rx * n.x + ry * n.y + rz * n.z);
  if (into > 0) {
    out.x = v.x + n.x * into;
    out.y = v.y + n.y * into;
    out.z = v.z + n.z * into;
    res.into = into;
    return;
  }
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  res.into = 0;
}

/**
 * Whether a reel takes the swim's vertical: reel-in held and the free span rising more than `swimLift`
 * degrees from the rope point to its pivot. `was` is last frame's answer, which the band (nought by
 * default) widens either way about the line should a swell make the rise hover on it.
 */
export function swimLifts(riseDeg: number, reelingIn: boolean, tune: { swimLift: number; swimLiftBand: number }, was = false): boolean {
  if (!reelingIn) return false;
  const line = tune.swimLift + (was ? -tune.swimLiftBand : tune.swimLiftBand);
  return riseDeg > line;
}

/**
 * The wading drag's rate (1/s) at a depth of the feet under the surface: nought out of water, `wadeDrag` at the swim's
 * depth (`swimStep.ts`'s `SWIM_DEPTH`, handed in so there is one copy of it) and below it.
 */
export function wadeDragOf(depth: number, tune: { wadeDrag: number }, swimDepth: number): number {
  if (!(depth > 0)) return 0;
  return tune.wadeDrag * Math.min(1, depth / swimDepth);
}

/** The teleport guard: the hand moved further in one frame than its speed, the correction asked for and the margin allow. */
export function teleported(moved: number, speed: number, dt: number, corr: number, tune: { teleportMargin: number }): boolean {
  return moved > speed * dt + corr + tune.teleportMargin;
}

/**
 * The wall friction on the speed along a wall, sparing the sway: `along` is the velocity in the wall's
 * plane and `sway` the unit direction the move keys push (nought with none held), already in that plane
 * or not. The part of `along` in the sway's own direction is left alone; the rest is slowed by at most
 * `friction·dt`. Writes the velocity in the plane after it into `out`.
 */
export function wallFrictionSpare(
  along: { x: number; y: number; z: number },
  sway: { x: number; y: number; z: number },
  friction: number,
  dt: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const sl = len3(sway.x, sway.y, sway.z);
  let kx = 0;
  let ky = 0;
  let kz = 0;
  if (sl > 1e-9) {
    const sx = sway.x / sl;
    const sy = sway.y / sl;
    const sz = sway.z / sl;
    const k = along.x * sx + along.y * sy + along.z * sz;
    if (k > 0) {
      kx = sx * k;
      ky = sy * k;
      kz = sz * k;
    }
  }
  const rx = along.x - kx;
  const ry = along.y - ky;
  const rz = along.z - kz;
  const rl = len3(rx, ry, rz);
  const f = rl > 1e-12 ? Math.max(0, rl - friction * dt) / rl : 0;
  out.x = kx + rx * f;
  out.y = ky + ry * f;
  out.z = kz + rz * f;
  return out;
}

/**
 * The ribbon's width at a distance: its own `ropeWidth`, and never under `minPx` pixels on a screen
 * `screenH` pixels tall through a vertical field of view `fovDeg`.
 */
export function ribbonWidth(dist: number, fovDeg: number, screenH: number, tune: { ropeWidth: number; minPx: number }): number {
  const perPx = (2 * Math.max(0, dist) * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, screenH);
  return Math.max(tune.ropeWidth, tune.minPx * perPx);
}

/** The rope's rise from the hand to its pivot, in degrees above level (90 straight up, negative below). */
export function riseOf(dx: number, dy: number, dz: number): number {
  const l = len3(dx, dy, dz);
  if (!(l > 1e-9)) return 0;
  return (Math.asin(Math.max(-1, Math.min(1, dy / l))) * 180) / Math.PI;
}

// --- the danger (wave 2) ------------------------------------------------------------------------------

/**
 * Whether a contact the controller refused can be a slam: only a surface steeper than the controller's own climb
 * (a walkable floor is the fall rule's), and never while F hauls (the haul sets its velocity into whatever it is
 * hauled at every frame, so its own push is measured and costs nothing).
 */
export function slamCounts(normalY: number, hauling: boolean): boolean {
  return normalY < WALKABLE && !hauling;
}

/**
 * What a slam at `v` m/s into what it struck costs: nothing up to `slamFrom`, `slamPer` a m/s over it rounded and
 * held to `slamMax`, and the whole of the health `hp` past `slamKill`, as a fall that kills does.
 */
export function slamHarm(v: number, hp: number, tune: { slamFrom: number; slamPer: number; slamMax: number; slamKill: number }): number {
  if (!(v > tune.slamFrom)) return 0;
  if (v >= tune.slamKill) return Math.max(0, hp);
  return Math.min(tune.slamMax, Math.round(tune.slamPer * (v - tune.slamFrom)));
}

/** How long a slam at `v` m/s staggers: the tune's `stagger` above `staggerFrom`, else nothing. */
export function staggerFor(v: number, tune: { staggerFrom: number; stagger: number }): number {
  return v > tune.staggerFrom ? tune.stagger : 0;
}

/**
 * The daze `t` seconds into a stagger: the vignette's kick, rising to `daze` over `dazeIn` and falling as (1 − u)² to
 * nought at the stagger's end. Nothing before it began, after it ended, or with the daze at nought.
 */
export function dazeAt(t: number, tune: { daze: number; dazeIn: number; stagger: number }): number {
  if (!(t >= 0) || !(t < tune.stagger) || !(tune.daze > 0)) return 0;
  const rise = Math.max(0, Math.min(tune.dazeIn, tune.stagger));
  if (t < rise) return (tune.daze * t) / rise;
  const u = (t - rise) / Math.max(1e-9, tune.stagger - rise);
  const f = 1 - u;
  return tune.daze * f * f;
}

/** The stagger's shake `t` seconds into it: `shake` at its start, falling straight to nought over `shakeTime`. */
export function shakeAt(t: number, tune: { shake: number; shakeTime: number }): number {
  if (!(t >= 0) || !(t < tune.shakeTime) || !(tune.shake > 0)) return 0;
  return tune.shake * (1 - t / tune.shakeTime);
}

/** Whether the fast flight after a let-go goes on: while the body is still faster than `slamFrom`. */
export function releasedHolds(speed: number, tune: { slamFrom: number }): boolean {
  return speed > tune.slamFrom;
}

/** The camera's jolt for a catch that took `caught` m/s off the rope point: nothing under `joltFrom`, never past `joltMax`. */
export function joltFor(caught: number, tune: { joltFrom: number; joltPer: number; joltMax: number }): number {
  if (!(caught > tune.joltFrom)) return 0;
  return Math.min(tune.joltMax, tune.joltPer * (caught - tune.joltFrom));
}

// --- the look (wave 2) --------------------------------------------------------------------------------

/**
 * Where the left arm is aimed, given the direction to the rope's first point in the figure's own frame (+Z ahead, +Y
 * up): a direction leaning back past `armReach` degrees behind straight up, where no shoulder reaches, is turned
 * forward to that line about the shoulders' own axis, its sideways share kept; one hanging back past the same
 * angle behind straight down is turned to that line instead, whichever is nearer. Everything else is left alone.
 * Writes into `out`, which may not be the input.
 */
export function armAimFor(dx: number, dy: number, dz: number, tune: { armReach: number }, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  out.x = dx;
  out.y = dy;
  out.z = dz;
  if (!(dz < 0)) return out;
  const r = Math.sqrt(dy * dy + dz * dz);
  if (!(r > 1e-9)) return out;
  const reach = (Math.max(0, Math.min(90, tune.armReach)) * Math.PI) / 180;
  // How far behind straight up, about the shoulders' axis: 0 up, 90 straight back, 180 straight down.
  const back = Math.atan2(-dz, dy);
  if (back <= reach || back >= Math.PI - reach) return out;
  const to = back < Math.PI / 2 ? reach : Math.PI - reach;
  out.y = r * Math.cos(to);
  out.z = -r * Math.sin(to);
  return out;
}

/** The camera's orbit scale at a speed: 1 up to `camFrom`, `camScale` from `camTo`, straight between. */
export function camScaleFor(speed: number, tune: { camFrom: number; camTo: number; camScale: number }): number {
  if (!(speed > tune.camFrom)) return 1;
  if (!(speed < tune.camTo)) return tune.camScale;
  return 1 + ((tune.camScale - 1) * (speed - tune.camFrom)) / (tune.camTo - tune.camFrom);
}

/** A quaternion, as the lean keeps one: (x, y, z) the axis times the sine of half the turn, w its cosine. */
export interface LeanQuat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** The identity, written into `q`. */
export function leanIdentity(q: LeanQuat): LeanQuat {
  q.x = 0;
  q.y = 0;
  q.z = 0;
  q.w = 1;
  return q;
}

/**
 * The drawn body's lean toward the rope: the turn that tips straight up toward the rope's direction (`d`, from the
 * rope point to its first point, any length) by `tilt` of the angle between them, that angle held to 90 degrees, in
 * the world's frame. The identity exactly at a tilt of nought or with the rope straight up or down. The direction comes
 * in a kept record rather than as numbers, since the hook's frame calls this every frame it swings and a number handed
 * to a call the engine does not build into its caller is a fresh number.
 */
export function leanOf(d: { readonly x: number; readonly y: number; readonly z: number }, tune: { readonly tilt: number }, out: LeanQuat): LeanQuat {
  const dx = d.x;
  const dy = d.y;
  const dz = d.z;
  const tilt = tune.tilt;
  const l = len3(dx, dy, dz);
  // The axis is straight up crossed with the rope: (dz, 0, -dx), which turns up toward the rope.
  const al = len2(dz, dx);
  if (!(l > 1e-9) || !(al > 1e-9 * l)) return leanIdentity(out);
  const angle = Math.acos(Math.max(-1, Math.min(1, dy / l)));
  const a = tilt * Math.min(angle, Math.PI / 2);
  if (!(a > 0)) return leanIdentity(out);
  const s = Math.sin(a / 2) / al;
  out.x = dz * s;
  out.y = 0;
  out.z = -dx * s;
  out.w = Math.cos(a / 2);
  return out;
}

/** How far a lean `q` turns the body from upright, radians. */
export function leanAngleOf(q: LeanQuat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
}

/**
 * How fast the lean may move, radians a second: the largest lean there is (`tilt` of a quarter turn) in `leanOut`, so a
 * let-go eases the body upright from any lean within `leanOut` and never in one frame. A tilt tuned to nought still
 * eases a lean left standing back (a tenth of the quarter turn is the least it moves by).
 */
export function leanRate(tune: { tilt: number; leanOut: number }): number {
  return (Math.max(0.1, tune.tilt) * (Math.PI / 2)) / Math.max(1e-3, tune.leanOut);
}

/** A lean of `from` radians eased back toward upright over a frame of `dt` seconds. */
export function leanEase(from: number, dt: number, tune: { tilt: number; leanOut: number }): number {
  return Math.max(0, from - leanRate(tune) * Math.max(0, dt));
}

/** The step a lean may turn by this frame (radians, written by the caller) and the angle left after it (written back). */
export interface LeanStep {
  step: number;
  left: number;
}

/**
 * The lean `cur` turned toward `target` by at most `io.step` radians, into `out` (which may be `cur`): the spherical ease
 * between the two, held to the step. Writes the angle left between them into `io.left`. The numbers go in and come
 * back in the kept record for the reason `leanOf`'s direction does.
 */
export function leanToward(cur: LeanQuat, target: LeanQuat, io: LeanStep, out: LeanQuat): void {
  const step = io.step;
  let tx = target.x;
  let ty = target.y;
  let tz = target.z;
  let tw = target.w;
  let dot = cur.x * tx + cur.y * ty + cur.z * tz + cur.w * tw;
  if (dot < 0) {
    dot = -dot;
    tx = -tx;
    ty = -ty;
    tz = -tz;
    tw = -tw;
  }
  const half = Math.acos(Math.min(1, dot));
  const angle = 2 * half;
  if (!(angle > 1e-12) || !(step < angle)) {
    out.x = target.x;
    out.y = target.y;
    out.z = target.z;
    out.w = target.w;
    io.left = 0;
    return;
  }
  const t = Math.max(0, step) / angle;
  const s = Math.sin(half);
  const a = Math.sin((1 - t) * half) / s;
  const b = Math.sin(t * half) / s;
  const x = cur.x * a + tx * b;
  const y = cur.y * a + ty * b;
  const z = cur.z * a + tz * b;
  const w = cur.w * a + tw * b;
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  out.x = x / l;
  out.y = y / l;
  out.z = z / l;
  out.w = w / l;
  io.left = angle - Math.max(0, step);
}

// --- the sound (wave 2) -------------------------------------------------------------------------------

/**
 * Whether a ratchet play is due: `reeled` metres of rope reeled by the held reel since the last one, at least
 * `tickEvery` of it, and at least a `tickMax`th of a second since the last, so a reel however fast never asks for
 * more than `tickMax` a second.
 */
export function ratchetDue(reeled: number, sinceLast: number, tune: { tickEvery: number; tickMax: number }): boolean {
  return reeled >= tune.tickEvery && sinceLast + 1e-9 >= 1 / Math.max(1, tune.tickMax);
}

/** The speed wind's gain: nothing under `windFrom`, rising straight to `windGain` at `windTo`. */
export function windGainFor(speed: number, tune: { windGain: number; windFrom: number; windTo: number }): number {
  if (!(tune.windGain > 0) || !(speed > tune.windFrom)) return 0;
  if (!(speed < tune.windTo)) return tune.windGain;
  return (tune.windGain * (speed - tune.windFrom)) / Math.max(1e-6, tune.windTo - tune.windFrom);
}

// --- vehicles on the rope (wave 3) -----------------------------------------------------------------------

/**
 * The hull's share of a catch on a rope between the player (mass `m`) and a hull (mass `M`), by the reduced mass
 * `μ = m·M/(m + M)` (§3.14): the relative speed the rope takes off splits as `m/(m + M)` to the hull and the rest to the
 * player. A bike of 320 kg takes a fifth of a catch from an 80 kg player, a pod of 900 a twelfth, a walker a
 * thirty-fourth; something that takes no pull (`M` infinite) takes nothing and the player all of it.
 */
export function reducedShare(m: number, M: number): number {
  const n = NUMS;
  n[0] = m;
  n[1] = M;
  reducedShareIn(n);
  return n[0];
}

// The hull's rules below are each written once, over a kept record of numbers (`n`, its slots named on each): the hook
// calls those every frame from methods too big for the compiler to build every call into, and a number handed to a call
// that is not built in, or handed back by one, is a fresh number (measured: one run in five made 6 to 30 B a frame, as
// whichever of them the compiler left out turned on when it reached them). The plain forms are the same rules for
// anything that is not every frame (a test, the console), through a record of this file's own.
const NUMS = new Float64Array(5);

/** `reducedShare` over a record: `n[0]` the player's mass, `n[1]` the hull's (infinite: it takes no pull); the share into `n[0]`. */
export function reducedShareIn(n: Float64Array): void {
  const M = n[1];
  n[0] = M < Infinity ? n[0] / (n[0] + M) : 0;
}

/** The slip's numbers a rope touching a hull reads (§3.18), each `GRAPPLE_TUNE`'s. */
export interface SlipTune {
  slipKeep: number;
  slipDecel: number;
  slipTurn: number;
  slipReel: number;
  slipCorr: number;
}

/**
 * The slip's catch (§3.18, 1): of `take` m/s the constraint would take off the relative speed in a frame of `dt`, what
 * the rope takes: whole up to the allowance `left` (which starts at `slipKeep` and comes back once the rope stops pulling)
 * and `slipDecel` a second past it. The rest pays out. `slipLeft` is the allowance after it.
 */
export function slipCatch(take: number, left: number, tune: SlipTune, dt: number): number {
  const n = NUMS;
  n[0] = take;
  n[1] = left;
  n[2] = dt;
  slipCatchIn(n, tune);
  return n[0];
}

/** `slipCatch` over a record: `n[0]` the take, `n[1]` the allowance left, `n[2]` the frame; what the rope takes into `n[0]`. */
export function slipCatchIn(n: Float64Array, tune: SlipTune): void {
  n[0] = Math.min(n[0], n[1] + tune.slipDecel * n[2]);
}

/** What is left of the catch's whole allowance once `took` was taken in a frame of `dt` (§3.18, 1). */
export function slipLeft(took: number, left: number, tune: SlipTune, dt: number): number {
  const n = NUMS;
  n[0] = took;
  n[1] = left;
  n[2] = dt;
  slipLeftIn(n, tune);
  return n[0];
}

/** `slipLeft` over a record: `n[0]` what was taken, `n[1]` the allowance left, `n[2]` the frame; the allowance after into `n[0]`. */
export function slipLeftIn(n: Float64Array, tune: SlipTune): void {
  n[0] = Math.max(0, n[1] - Math.max(0, n[0] - tune.slipDecel * n[2]));
}

/**
 * Whether a turn slips (§3.18, 2): the relative speed across the rope (its square `vt2`) asks more than `slipTurn` m/s²
 * of centripetal pull on a free span `dist` long. A swing from level asks 40.6 and one pumped to 120 degrees 61, so no
 * swing under a hull slips; a whip round a hull at 40 m/s on 10 m asks 160.
 */
export function slipsTurn(vt2: number, dist: number, tune: SlipTune): boolean {
  const n = NUMS;
  n[0] = vt2;
  n[1] = dist;
  return slipsTurnIn(n, tune);
}

/** `slipsTurn` over a record: `n[0]` the square of the speed across the rope, `n[1]` the free span. */
export function slipsTurnIn(n: Float64Array, tune: SlipTune): boolean {
  return n[1] > 0.5 && n[0] / n[1] > tune.slipTurn;
}

/** How much of the free span a hull dragging a bend or the anchor away shortened it by past `slipReel` (§3.18, 3): paid out. */
export function slipReelExcess(grow: number, tune: SlipTune, dt: number): number {
  const n = NUMS;
  n[0] = grow;
  n[1] = dt;
  slipReelExcessIn(n, tune);
  return n[0];
}

/** `slipReelExcess` over a record: `n[0]` what the free span grew by, `n[1]` the frame; the excess into `n[0]`. */
export function slipReelExcessIn(n: Float64Array, tune: SlipTune): void {
  n[0] = Math.max(0, n[0] - tune.slipReel * n[1]);
}

/**
 * The parked brake's budget (§3.18): refilled by `parkHold × M × g × dt` every frame and holding at most
 * `parkHold × M × g × max(dt, 1/60)`, one physics step's worth at 144 fps and the frame's at 30, so a pull that arrives
 * only on the frames that carry a step meets the same brake a second as one that arrives on every frame.
 */
export function brakeBudget(budget: number, mass: number, g: number, dt: number, tune: { parkHold: number }): number {
  const n = NUMS;
  n[0] = budget;
  n[1] = mass;
  n[2] = g;
  n[3] = dt;
  brakeBudgetIn(n, tune);
  return n[0];
}

/** `brakeBudget` over a record: `n[0]` the budget, `n[1]` the hull's mass, `n[2]` gravity, `n[3]` the frame; the budget into `n[0]`. */
export function brakeBudgetIn(n: Float64Array, tune: { parkHold: number }): void {
  const per = tune.parkHold * n[1] * n[2];
  const dt = n[3];
  n[0] = Math.min(n[0] + per * dt, per * Math.max(dt, 1 / 60));
}

/** A pull's level part, what the brake holds of it, and the budget left (`parkedLevel`), written in place. */
export interface ParkedPull {
  x: number;
  z: number;
  budget: number;
  /** What the brake held of the pull (N·s). */
  held: number;
}

/**
 * The level part of a pull `J` (an impulse, N·s) that gets past the parked brake: with the hull `braked` (at rest at the
 * rope's first pull, nothing driving it), the kept `budget` holds as much of it as it can, and only the rest goes to the
 * hull. Writes the level parts left and the budget left into `out`; answers what the brake held.
 */
export function parkedLevel(J: { readonly x: number; readonly z: number }, braked: boolean, budget: number, out: ParkedPull): number {
  out.budget = budget;
  parkedLevelIn(J, braked, out);
  return out.held;
}

/**
 * `parkedLevel` with the budget going in where it comes out (`out.budget`, the kept record the hook hands every frame)
 * and what the brake held in `out.held`: nothing handed over or back is a bare number.
 */
export function parkedLevelIn(J: { readonly x: number; readonly z: number }, braked: boolean, out: ParkedPull): void {
  const budget = out.budget;
  const level = Math.sqrt(J.x * J.x + J.z * J.z);
  const held = braked && level > 0 ? Math.min(level, budget) : 0;
  const k = level > 0 ? (level - held) / level : 0;
  out.x = J.x * k;
  out.z = J.z * k;
  out.budget = budget - held;
  out.held = held;
}

/** A tow (§3.18): a rope touching a hull that pulled within `towHold` counts as taut for the slide, and the tow's friction and damping apply. */
export function towing(onHull: boolean, sincePull: number, tune: { towHold: number }): boolean {
  const n = NUMS;
  n[0] = sincePull;
  return towingIn(onHull, n, tune);
}

/** `towing` over a record: `n[0]` the time since the rope last pulled. */
export function towingIn(onHull: boolean, n: Float64Array, tune: { towHold: number }): boolean {
  return onHull && n[0] < tune.towHold;
}

/**
 * Whether a roped hull is still (§3.18): its lag over the frame, `(|v| + |ω|·r)·(acc + dt)`, under `hullLag`, or under
 * half of it once it was taken for moving (`marked`), so it never flickers. A still hull stays with the character
 * controller and takes the still haul; a moving one is met by the hull test.
 */
export function hullStill(lag: number, marked: boolean, tune: { hullLag: number }): boolean {
  const n = NUMS;
  n[0] = lag;
  return hullStillIn(n, marked, tune);
}

/** `hullStill` over a record: `n[0]` the hull's lag over the frame. */
export function hullStillIn(n: Float64Array, marked: boolean, tune: { hullLag: number }): boolean {
  const lag = n[0];
  return !(lag > tune.hullLag || (marked && lag > tune.hullLag / 2));
}

// --- poses, in kept arrays (a turn is x, y, z, w) -------------------------------------------------------

/**
 * `v` turned by the unit turn `q` (or by its inverse), into `out` (which may be `v`): three numbers from `vo` in `v` to
 * `oo` in `out`. Arrays and offsets rather than numbers, since the rope's every-frame mapping calls this and a number
 * handed to a call the engine does not build into its caller is a fresh number.
 */
export function turnBy(q: Float64Array, inverse: boolean, v: Float64Array, vo: number, out: Float64Array, oo: number): void {
  const x = v[vo];
  const y = v[vo + 1];
  const z = v[vo + 2];
  const qx = inverse ? -q[0] : q[0];
  const qy = inverse ? -q[1] : q[1];
  const qz = inverse ? -q[2] : q[2];
  const qw = q[3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[oo] = x + qw * tx + (qy * tz - qz * ty);
  out[oo + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[oo + 2] = z + qw * tz + (qx * ty - qy * tx);
}

/**
 * A pose led forward by `tau` seconds of its velocity `v` and turn rate `w` (the clamp's own `leadPose`): `p + v·tau`,
 * and the turn by `|w|·tau` about `w`, then `q`. Everything in kept arrays; `lead[0]` is `tau`.
 */
export function leadPose(p: Float64Array, q: Float64Array, v: Float64Array, w: Float64Array, lead: Float64Array, outP: Float64Array, outQ: Float64Array): void {
  const tau = lead[0];
  outP[0] = p[0] + v[0] * tau;
  outP[1] = p[1] + v[1] * tau;
  outP[2] = p[2] + v[2] * tau;
  const wl = len3(w[0], w[1], w[2]);
  const ang = wl * tau;
  if (!(ang > 1e-12)) {
    outQ[0] = q[0];
    outQ[1] = q[1];
    outQ[2] = q[2];
    outQ[3] = q[3];
    return;
  }
  const s = Math.sin(ang / 2) / wl;
  const ax = w[0] * s;
  const ay = w[1] * s;
  const az = w[2] * s;
  const aw = Math.cos(ang / 2);
  // (a) * (q)
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  const qw = q[3];
  outQ[0] = aw * qx + ax * qw + ay * qz - az * qy;
  outQ[1] = aw * qy - ax * qz + ay * qw + az * qx;
  outQ[2] = aw * qz + ax * qy - ay * qx + az * qw;
  outQ[3] = aw * qw - ax * qx - ay * qy - az * qz;
}

/** The turn a share `share[0]` of the way from `a` to `b` (the spherical ease, the shorter way round), into `out`. */
export function slerpTurn(a: Float64Array, b: Float64Array, share: Float64Array, out: Float64Array): void {
  const t = share[0];
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka: number;
  let kb: number;
  if (dot > 0.9995) {
    ka = 1 - t;
    kb = t;
  } else {
    const half = Math.acos(dot);
    const s = Math.sin(half);
    ka = Math.sin((1 - t) * half) / s;
    kb = Math.sin(t * half) / s;
  }
  const x = a[0] * ka + bx * kb;
  const y = a[1] * ka + by * kb;
  const z = a[2] * ka + bz * kb;
  const w = a[3] * ka + bw * kb;
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  out[3] = w / l;
}
