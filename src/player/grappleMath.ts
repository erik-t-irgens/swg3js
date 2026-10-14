// The grapple's arithmetic that needs nothing but numbers: the rope's words (whether the body is on the
// rope or on its feet, and how), the dart's aim, the drawn sag, which marks the dart may bite, what the
// hook mutes, the gravity knob's add-back, the clip of a velocity into a surface, the swim's lift test,
// the wading drag, the teleport guard, the wall friction that spares the sway, and the ribbon's least
// width. No three, no Rapier, no page: a node test calls every one of these as the game does.
//
// Every number these read is the caller's (`GRAPPLE_TUNE` in `grapple.ts`, handed in); none is kept here.

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

/** What the mark's point is: the kinds the dart may hold (`terrain`, `still`), and the ones it refuses. */
export type MarkKind = 'none' | 'terrain' | 'still' | 'pane' | 'water' | 'door' | 'prop' | 'moving';

/** Whether a kind holds the dart at all. */
export function kindHolds(kind: MarkKind): boolean {
  return kind === 'terrain' || kind === 'still';
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

/** Whether the mark shows: a kind the dart holds, no nearer than `minRange` and no further than `range`. */
export function markShows(dist: number, kind: MarkKind, tune: { minRange: number; range: number }): boolean {
  return kindHolds(kind) && dist >= tune.minRange && dist <= tune.range;
}

/**
 * What the hook mutes for the frame, by action, into a kept list: nothing while it is not out; while it
 * is, the walk, the crouch and the torch (whose keys the reels and the haul borrow), the two postures and
 * the emotes, and the jump only while swinging (Space is the boost then; on the ground it jumps, and in
 * water it swims up). Answers how many it wrote.
 */
export function grappleMutes(out: string[], isOut: boolean, swinging: boolean): number {
  const n = !isOut ? 0 : swinging ? OUT_MUTES.length + 1 : OUT_MUTES.length;
  // The kept list holds one of three lists, each its own length: written only when it changes, since emptying an
  // array and pushing into it again hands it a new backing store often enough to cost a byte a frame.
  if (out.length !== n) {
    out.length = 0;
    if (n > 0) {
      for (let i = 0; i < OUT_MUTES.length; i++) out.push(OUT_MUTES[i]);
      if (swinging) out.push('jump');
    }
  }
  return n;
}

/** What the hook mutes for as long as it is out, whatever it is doing. */
const OUT_MUTES: readonly string[] = ['walk', 'crouch', 'flashlight', 'prone', 'kneel', 'emoteWheel', 'emote1', 'emote2', 'emote3', 'emote4'];

/** What every let-go mutes until its keys are up: a held Space would hop on landing, a held F light the torch, a held Shift walk. Never the crouch, which is the landing roll. */
export const GRAPPLE_RELEASE_MUTES: readonly string[] = ['jump', 'flashlight', 'walk'];

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
  const rel = relative && sv !== null;
  const rx = rel ? v.x - sv.x : v.x;
  const ry = rel ? v.y - sv.y : v.y;
  const rz = rel ? v.z - sv.z : v.z;
  const into = -(rx * n.x + ry * n.y + rz * n.z);
  if (into > 0) {
    out.x = v.x + n.x * into;
    out.y = v.y + n.y * into;
    out.z = v.z + n.z * into;
    return into;
  }
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return 0;
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
