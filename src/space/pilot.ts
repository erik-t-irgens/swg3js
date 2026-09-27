// Flying a ship by hand for an NPC: the stick that puts the nose on a direction, a formation slot's
// place, the lead on a moving target, the cruise that holds a slot. INVENTED (the server flew the
// game's NPCs), in flyShip's own senses so the brain's stick means what the mouse's does:
// flyShip turns at `-stick.x` about the ship's Y (so stick.x > 0 swings the nose toward -X, the ship's
// right: +X is its left with Y up and Z the nose), pitches at `stick.y` about +X (stick.y > 0 takes the
// nose toward -Y, down) and rolls at `steer` about +Z (steer > 0 takes +Y toward -X, the right wing down).
//
// Pure: no three, no rapier; node's tests import it straight from source. Every function fills an
// `out` and allocates nothing. The tiers' skill lives here too, so the duel tests can fly it.
import { interceptTime } from '../combat/intercept.ts';

export interface V3 {
  x: number;
  y: number;
  z: number;
}
export interface Q4 {
  x: number;
  y: number;
  z: number;
  w: number;
}
export interface Stick {
  x: number;
  y: number;
  roll: number;
}

/** How hard the stick answers an error (per radian), and how far a roll error rolls (invented). */
export const STICK_GAIN = { yaw: 3, pitch: 3, roll: 2.5, level: 1.5 };

/** How well an NPC tier flies and shoots. */
export interface PilotSkill {
  /** Seconds between target choices. */
  reaction: number;
  /** The scatter of a shot and the cone off the nose it fires within (degrees). */
  scatterDeg: number;
  gunConeDeg: number;
  /** The share of the full lead it takes. */
  lead: number;
  /** How near it lets a target come before it breaks off (metres, over both hulls' radii). */
  breakRange: number;
  /** The chance it jinks when shot from behind. */
  evadeChance: number;
  /** The most of the stick it ever uses (0..1): a tier-1 pilot never pulls as hard as the ship can turn. */
  stickMax: number;
  /** Seconds its hand takes to move the stick from the middle to full on an axis (0: at once). */
  response: number;
}

/**
 * Every tier's skill, all INVENTED (the server flew the game's NPCs and none of it shipped). Kept together to be tuned,
 * and live through `__debug.flight({ npc: { 1: { stickMax: 0.8 } } })`: each brain holds its tier's object, so a change
 * reaches the pilots already flying. The shot goes at the pilot's aim (as the player's guns take the lead), so the cone
 * only says how far off the nose that aim may be for it to pull the trigger; the scatter and the lead are what make a
 * tier miss. The stick's cap and its response make a low tier turn wider and later than its hull could, so a player who
 * keeps the cursor on it can out-turn it (the owner found them "incredibly good pilots" with neither).
 */
export const PILOT_SKILL: Record<number, PilotSkill> = {
  1: { reaction: 0.9, scatterDeg: 2.4, gunConeDeg: 14, lead: 0.6, breakRange: 140, evadeChance: 0.2, stickMax: 0.7, response: 0.35 },
  2: { reaction: 0.7, scatterDeg: 2.0, gunConeDeg: 13, lead: 0.7, breakRange: 120, evadeChance: 0.3, stickMax: 0.76, response: 0.3 },
  3: { reaction: 0.5, scatterDeg: 1.6, gunConeDeg: 12, lead: 0.8, breakRange: 100, evadeChance: 0.45, stickMax: 0.82, response: 0.24 },
  4: { reaction: 0.35, scatterDeg: 1.2, gunConeDeg: 12, lead: 0.88, breakRange: 90, evadeChance: 0.6, stickMax: 0.88, response: 0.18 },
  5: { reaction: 0.25, scatterDeg: 0.9, gunConeDeg: 12, lead: 0.95, breakRange: 80, evadeChance: 0.75, stickMax: 0.94, response: 0.12 },
};

/** A tier's skill (clamped to 1..5, rounded). */
export function skillOfTier(tier: number): PilotSkill {
  return PILOT_SKILL[Math.min(5, Math.max(1, Math.round(tier)))] ?? PILOT_SKILL[1];
}

const clamp1 = (n: number): number => (n > 1 ? 1 : n < -1 ? -1 : n);

/**
 * The pilot's hand on the stick: `want` (steerToward's) capped to the skill's `stickMax`, and `held` (the stick as it
 * stands, kept by the caller) moved toward that at no more than full travel in the skill's `response` seconds on each
 * axis. Fills and returns `held`.
 *
 * The hand is a limit on how fast the stick moves, not a lag: a first-order lag inside the steering loop (steerToward's
 * gain, flyShip's inertia) took the loop's phase margin to nothing, and a tier-1 pilot holding a heading swung 15 degrees
 * either side of it for as long as it flew. A rate limit only slows the big moves, and the loop settles as it did.
 *
 * The cap is on the turn's whole reach, not each axis: steerToward fills yaw and pitch to 1 each, so a turn off both
 * axes was 1.41 of the hull's rate. The player's stick was clamped per axis as well, so a diagonal was theirs too; capped
 * by its length, a pilot's diagonal is no faster than its straight turn, as the player's cursor now is.
 *
 * `urgent` (pulling out of a collision or off the ground): the whole stick at once, uncapped, as every pilot flew before
 * the tiers had a hand, so no tier flies into what it is avoiding any later than it did.
 */
export function skillStick(want: Stick, skill: PilotSkill, dt: number, held: Stick, urgent = false): Stick {
  const x = clamp1(want.x);
  const y = clamp1(want.y);
  if (urgent) {
    held.x = x;
    held.y = y;
    held.roll = clamp1(want.roll);
    return held;
  }
  const cap = Math.max(0, Math.min(1, skill.stickMax));
  const step = skill.response > 1e-4 ? dt / skill.response : Infinity;
  const len = Math.hypot(x, y);
  const s = len > cap && len > 0 ? cap / len : 1;
  held.x += Math.max(-step, Math.min(step, x * s - held.x));
  held.y += Math.max(-step, Math.min(step, y * s - held.y));
  held.roll += Math.max(-step, Math.min(step, clamp1(want.roll) * cap - held.roll));
  return held;
}

/** v rotated by the quaternion (x, y, z, w), or by its inverse with `sign` -1. */
function rotate(q: Q4, sign: 1 | -1, v: V3, out: V3): V3 {
  const qx = q.x * sign;
  const qy = q.y * sign;
  const qz = q.z * sign;
  const qw = q.w;
  // t = 2 (q × v); v' = v + w t + q × t
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  const x = v.x + qw * tx + (qy * tz - qz * ty);
  const y = v.y + qw * ty + (qz * tx - qx * tz);
  const z = v.z + qw * tz + (qx * ty - qy * tx);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** Rotate a world vector into the ship's frame (x left, y up, z the nose). */
export function toLocal(q: Q4, v: V3, out: V3): V3 {
  return rotate(q, -1, v, out);
}

/** Rotate a vector in the ship's frame into the world. */
export function toWorld(q: Q4, v: V3, out: V3): V3 {
  return rotate(q, 1, v, out);
}

/** Radians between the nose (+Z) and a local direction. */
export function offNose(local: V3): number {
  return Math.atan2(Math.hypot(local.x, local.y), local.z);
}

/**
 * The stick that turns the nose onto a local direction, in flyShip's own senses: x > 0 turns right,
 * y > 0 pushes the nose down, roll > 0 rolls right. Past `bankBeyond` (radians off the nose) the ship
 * rolls the target overhead and pulls, as a fighter turns; inside it the nose is put on with yaw and
 * pitch and the roll levels to `levelUp` (a planet's up in the ship's frame) or holds (null, in space).
 */
export function steerToward(local: V3, bankBeyond: number, levelUp: V3 | null, out: Stick): Stick {
  const off = offNose(local);
  const yawErr = Math.atan2(-local.x, local.z);
  const pitchErr = Math.atan2(-local.y, Math.hypot(local.x, local.z));
  if (off > bankBeyond) {
    // Roll the target overhead (straight behind it is already as good as overhead) and pull hard; the pull
    // waits while the target is still below the wings, so the ship does not pull away from it mid-roll.
    const lat = Math.hypot(local.x, local.y);
    const overhead = lat < 1e-6 ? 1 : local.y / lat;
    out.roll = lat < 1e-6 ? 0 : clamp1(Math.atan2(-local.x, local.y) * STICK_GAIN.roll);
    out.y = -Math.min(1, off * 2) * Math.max(0, Math.min(1, 0.25 + 0.75 * overhead));
    out.x = clamp1(yawErr * STICK_GAIN.yaw * 0.5);
    return out;
  }
  out.x = clamp1(yawErr * STICK_GAIN.yaw);
  out.y = clamp1(pitchErr * STICK_GAIN.pitch);
  out.roll = levelUp ? clamp1(Math.atan2(-levelUp.x, levelUp.y) * STICK_GAIN.level) : 0;
  return out;
}

/** A formation slot's point in the world, the slot in the leader's frame. */
export function formationPoint(leaderPos: V3, leaderQ: Q4, slot: V3, out: V3): V3 {
  toWorld(leaderQ, slot, out);
  out.x += leaderPos.x;
  out.y += leaderPos.y;
  out.z += leaderPos.z;
  return out;
}

const rel: V3 = { x: 0, y: 0, z: 0 };
const relVel: V3 = { x: 0, y: 0, z: 0 };

/** Where to aim for a bolt at `boltSpeed` (over the shooter's own velocity) to meet the target, `lead` 0..1 of the full lead; null when it can never meet it. */
export function aimPoint(from: V3, fromVel: V3, at: V3, atVel: V3, boltSpeed: number, lead: number, out: V3): V3 | null {
  rel.x = at.x - from.x;
  rel.y = at.y - from.y;
  rel.z = at.z - from.z;
  relVel.x = atVel.x - fromVel.x;
  relVel.y = atVel.y - fromVel.y;
  relVel.z = atVel.z - fromVel.z;
  const t = interceptTime(rel, relVel, boltSpeed);
  if (t === null) return null;
  const k = t * Math.max(0, Math.min(1, lead));
  out.x = at.x + relVel.x * k;
  out.y = at.y + relVel.y * k;
  out.z = at.z + relVel.z * k;
  return out;
}

/**
 * How a pilot keeps clear of what is ahead and of other ships, INVENTED as every NPC number is: the
 * look ahead for anything solid and how long it turns away after seeing it, the gap it keeps from
 * another hull, and the collision course it dodges. Moved here out of the NPC brain unchanged, so the
 * shuttles' own pilot (`src/world/shuttleCourse.ts`) keeps clear by the very same numbers.
 */
export const AVOID_TUNE = {
  /** The obstacle look ahead: how often (s), how far (seconds of flight, and at least this many metres), and how long the pilot turns away. */
  rayEvery: 0.25,
  rayAhead: 2.5,
  rayMin: 60,
  avoidSeconds: 1.5,
  /** Another ship nearer than this (metres, between the hulls) is turned away from. */
  separation: 40,
  /** Ships within this (metres) are checked for a collision course, dodged when passing nearer than the hulls and this margin. */
  dodgeLook: 400,
  dodgeMargin: 15,
  /** Any ship's closest approach within this many seconds nearer than the hulls and `dodgeMargin` is dodged. */
  collideSeconds: 1.5,
};

const WORLD_UP: V3 = { x: 0, y: 1, z: 0 };

/** `v` scaled to unit length in place, or left alone when it has none (three's own `normalize`). */
function unit(v: V3): void {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= len;
  v.y /= len;
  v.z /= len;
}

/**
 * One other ship's pull on where a pilot wants to go: a hull within the separation gap pushes `want`
 * straight away from it, harder the nearer it is, and one on a collision course (its closest approach
 * within `collideSeconds`, nearer than the two hulls and a margin) pushes it away from where that
 * approach would be -- along `up` for a dead-centre one. `want` is a direction and is left unit length;
 * says whether it was pulled at all. Every velocity is a ship's nose times its speed. Allocates nothing.
 */
export function pushApart(pos: V3, vel: V3, radius: number, otherPos: V3, otherVel: V3, otherRadius: number, want: V3, tune = AVOID_TUNE, up: V3 = WORLD_UP): boolean {
  let pulled = false;
  const gap = tune.separation + radius + otherRadius;
  const ox = otherPos.x - pos.x;
  const oy = otherPos.y - pos.y;
  const oz = otherPos.z - pos.z;
  const d2 = ox * ox + oy * oy + oz * oz;
  if (d2 < gap * gap && d2 > 1e-6) {
    const d = Math.sqrt(d2);
    const k = (3 * (1 - d / gap)) / d;
    want.x -= ox * k;
    want.y -= oy * k;
    want.z -= oz * k;
    unit(want);
    pulled = true;
  }
  if (d2 > tune.dodgeLook * tune.dodgeLook) return pulled;
  // The closest approach: its time from the relative motion, and how near it passes.
  const rx = otherVel.x - vel.x;
  const ry = otherVel.y - vel.y;
  const rz = otherVel.z - vel.z;
  const rv2 = rx * rx + ry * ry + rz * rz;
  if (rv2 < 1) return pulled;
  const tca = -(ox * rx + oy * ry + oz * rz) / rv2;
  if (tca <= 0 || tca > tune.collideSeconds) return pulled;
  let mx = ox + rx * tca;
  let my = oy + ry * tca;
  let mz = oz + rz * tca;
  const miss = Math.hypot(mx, my, mz);
  const room = radius + otherRadius + tune.dodgeMargin;
  if (miss >= room) return pulled;
  // Away from the point of closest approach (straight up past a dead-centre one).
  if (miss < 1e-3) {
    mx = up.x;
    my = up.y;
    mz = up.z;
  } else {
    mx /= -miss;
    my /= -miss;
    mz /= -miss;
  }
  const k = 4 * (1 - miss / room);
  want.x += mx * k;
  want.y += my * k;
  want.z += mz * k;
  unit(want);
  return true;
}

/** The least cruise a flying NPC keeps (m/s): under 4 a ship lands. */
export const MIN_CRUISE = 8;

/** Cruise to hold a slot: the leader's speed plus a pull toward the slot along the leader's nose (`aheadOfSlot` metres the wingman is ahead of it), within MIN_CRUISE..top. */
export function slotCruise(leaderSpeed: number, aheadOfSlot: number, top: number): number {
  const want = leaderSpeed - aheadOfSlot * 0.8;
  const low = Math.min(MIN_CRUISE, top);
  return want < low ? low : want > top ? top : want;
}
