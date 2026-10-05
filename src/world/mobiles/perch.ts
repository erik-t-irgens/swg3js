// A person the game's data stands on something raised -- an Ewok on its tree village, a Gondula on a
// lake hut, a sniper on a bridge, an officer on a balcony, a townsperson on a step -- held in the air
// at the row's own height until the solid thing under it has been built, and then set down on it.
//
// The row's height is right (the emulator wrote where the server stood them), but a height alone is
// not enough. A placed object is solid only within the collider sweep's reach of the player, only
// once its tier has loaded and the sweep has run since, and a physics query sees nothing until the
// world has stepped once after that. A body given its height before its floor exists falls to the
// terrain, and when the floor then appears round it the body is pushed out of it. So a body standing
// more than `lift` over the terrain is stood **perched**: held in the air, as a body in a room with no
// floor built is held (`airless.ts`), while one probe a frame looks for what it stands on.
//
// What becomes of it is one of three answers a frame (`perchStep`):
//   - `land`: the probe found a surface under its feet. It is set down on it and gravity returns.
//   - `fall`: nothing was found, and near the player the streamer says nothing that could be under it
//     is still to come (`LayoutStreamer.builtAt` answering `built`), so it is let down at once onto
//     whatever is under it, which is the terrain. Or the wait ran out near the player: the safety net,
//     whose clock runs only while the streamer says something is on its way (`coming`) and the world
//     is not behind a loading screen, where tiers take as long as they take.
//   - `hold`: anything else. Far from the player neither the wait nor the release counts, and nor
//     does it where the streamer says the player is too far off to want what is under it (`far`).
//
// A body that has landed can lose its floor again while the world goes on -- the object's collision is
// taken away when the player walks off, its tier unloads at a short object reach -- and it is perched
// again where it stands (`perchesAgain`), so it waits for the floor to come back instead of falling
// through to the terrain and having the floor built round it later.
//
// Every number is ours (`PERCH_TUNE`, live through `__debug.mobileTune({ perch })`). Pure: no rapier,
// no three and no page, so a node test runs every rule here as the manager and the body run it.
import type { FloorAnswer } from '../placedTiers.ts';

export interface PerchTune {
  /** Metres over the terrain a body must stand to count as perched; under it, it is on the ground. */
  lift: number;
  /** The probe starts this far above the feet... */
  up: number;
  /** ...and looks this far below them. */
  down: number;
  /** The safety net: seconds near the player before a body nothing has been found under is let down. */
  wait: number;
  /**
   * The wait and the release count only within this many metres of the player, which is under the
   * collider sweep's own reach (170 m from an object's edge): farther out, nothing is built to find.
   */
  countWithin: number;
  /** Seconds between one asking of "is everything built here" and the next, per body. */
  builtEvery: number;
  /** A person who lands on a raised object keeps to its spot rather than stepping off it (its post becomes `still`). */
  stillOnTop: boolean;
}

export const PERCH_TUNE: PerchTune = { lift: 0.3, up: 0.5, down: 1.5, wait: 6, countWithin: 150, builtEvery: 0.25, stillOnTop: true };

/** What a perched body carries between frames: one kept record each, written in place. */
export interface PerchState {
  /** Seconds waited near the player, while something was coming, with nothing found under it. */
  waited: number;
  /** Seconds since the streamer was last asked whether everything here is built. */
  asked: number;
  /** Its last answer. */
  built: FloorAnswer;
}

/** A fresh record, asked at once on the first frame it is near. */
export function newPerchState(): PerchState {
  return { waited: 0, asked: Infinity, built: 'coming' };
}

/** The record put back to fresh in place, for a body perched again. */
export function resetPerchState(s: PerchState): void {
  s.waited = 0;
  s.asked = Infinity;
  s.built = 'coming';
}

/**
 * The height a row is stood at outdoors: its own, unless that is under the terrain, where it is the
 * terrain's. A row under the ground is a row whose height is wrong, never one standing in a pit.
 */
export function standHeight(y: number, terrain: number): number {
  return y > terrain ? y : terrain;
}

/**
 * Whether a body stood at `y` over ground at `terrain` is perched. Never indoors (a room's floor is
 * found another way and held another way), never a flyer (it hovers) and never a swimmer (it floats).
 */
export function isPerched(y: number, terrain: number, inside: boolean, flyer: boolean, swimmer: boolean, tune: PerchTune = PERCH_TUNE): boolean {
  if (inside || flyer || swimmer) return false;
  return y - terrain > tune.lift;
}

/** Where a body handed a height out of doors is stood, and whether it is perched there (`perchSpawn`). */
export interface PerchSpawn {
  y: number;
  perch: boolean;
}

/**
 * Where a body handed a height out of doors is stood and whether it is perched, from the row's height, the
 * ground under it and the water's surface there. The ground is null when it is far off and the world holds
 * nothing there (`groundUnder`), which is never made on the spot: the row's height is kept and the body is
 * perched, since a perched body far from the player is held and decides once it is near. One stood under
 * the water's surface is a swimmer and floats rather than perching. Made on a spawn, never in a frame.
 */
export function perchSpawn(y: number, ground: number | null, water: number, tune: PerchTune = PERCH_TUNE): PerchSpawn {
  if (ground === null) return { y, perch: !(water > y) };
  const at = standHeight(y, ground);
  return { y: at, perch: isPerched(at, ground, false, false, water > at, tune) };
}

/**
 * Whether a body standing at `y` out of doors is far enough over the ground to be perched again where it
 * stands (a body handed back by another browser, a body whose floor has just been taken away). Unknown
 * ground (null, far off and nothing held there) says nothing, and nothing is done on it.
 */
export function perchesAgain(y: number, ground: number | null, tune: PerchTune = PERCH_TUNE): boolean {
  return ground !== null && y - ground > tune.lift;
}

/** Whether a body this far from the player on the ground counts its wait and asks the streamer (`countWithin`). */
export function perchNear(dx: number, dz: number, tune: PerchTune = PERCH_TUNE): boolean {
  return dx * dx + dz * dz <= tune.countWithin * tune.countWithin;
}

/**
 * What the probe found, as the perch counts it: a surface more than `lift` under the terrain is something
 * buried -- a basement's floor, a sunk foundation -- and not what the body stands on, so it is nothing. The
 * ground is asked only once something is found, and unknown ground keeps the hit.
 */
export function perchSurface(hit: number | null, ground: number | null, tune: PerchTune = PERCH_TUNE): number | null {
  if (hit === null || ground === null) return hit;
  return hit < ground - tune.lift ? null : hit;
}

/**
 * Whether a person who has just landed on `top` keeps to its spot from now on: one with a `near` post (it
 * steps about it) on something raised more than `lift` over the ground, which would otherwise step off the
 * edge of it. Its post becomes `still`.
 */
export function keepsSpot(post: string | null | undefined, top: number, ground: number | null, tune: PerchTune = PERCH_TUNE): boolean {
  return tune.stillOnTop && post === 'near' && ground !== null && top - ground > tune.lift;
}

/** The body's middle set down on a surface at `top`, its feet `feet` under its middle, as `liftToGround` sets one down. */
export function landTop(top: number, feet: number): number {
  return top + feet + 0.05;
}

/**
 * One frame of a perched body. `hit` is the height of what the probe found under its feet, or null;
 * `near` whether it is within `countWithin` of the player; `built` the streamer's last answer
 * (`LayoutStreamer.builtAt`); `paused` whether the world is behind a loading screen, where tiers load as
 * slowly as they load and the safety net must not give up on them. Writes only `state.waited`.
 */
export function perchStep(state: PerchState, hit: number | null, near: boolean, built: FloorAnswer, dt: number, tune: PerchTune = PERCH_TUNE, paused = false): 'hold' | 'land' | 'fall' {
  if (hit !== null) return 'land';
  if (!near) return 'hold';
  if (built === 'built') return 'fall';
  if (built === 'far' || paused) return 'hold';
  state.waited += dt;
  return state.waited >= tune.wait ? 'fall' : 'hold';
}

/** Whether `perchStep`'s fall was the wait running out, rather than the streamer saying nothing is there. */
export function perchTimedOut(state: PerchState, tune: PerchTune = PERCH_TUNE): boolean {
  return state.waited >= tune.wait;
}

/** The console's knob: any number of `PERCH_TUNE` moved live, each kept to a sense it can have. */
export function tunePerch(t: Partial<PerchTune>): PerchTune {
  const num = (v: unknown, floor: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(floor, v) : null);
  const lift = num(t.lift, 0);
  if (lift !== null) PERCH_TUNE.lift = lift;
  const up = num(t.up, 0);
  if (up !== null) PERCH_TUNE.up = up;
  const down = num(t.down, 0.05);
  if (down !== null) PERCH_TUNE.down = down;
  const wait = num(t.wait, 0);
  if (wait !== null) PERCH_TUNE.wait = wait;
  const within = num(t.countWithin, 0);
  if (within !== null) PERCH_TUNE.countWithin = within;
  const every = num(t.builtEvery, 0);
  if (every !== null) PERCH_TUNE.builtEvery = every;
  if (typeof t.stillOnTop === 'boolean') PERCH_TUNE.stillOnTop = t.stillOnTop;
  return PERCH_TUNE;
}
