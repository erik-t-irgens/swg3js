// The hyperspace jump's arithmetic: the timeline from the jump scene, the speed curves, and where a
// jump ends. Pure: no three; the node tests import it. Every position in and out is in the GAME frame;
// callers convert the pack's client-frame coordinates with `toGame`.
//
// The scene's own numbers (scene/hyperspace.iff's stage lengths, STG2's speed, fade and limit, and the
// warp effects' timings the converter reads) arrive through `sceneOf`; the constants below are ours.
import type { SpacePack, Vec3 } from './spaceData.ts';

/** Seconds of countdown before a jump; ours ("a short countdown"). */
export const JUMP_COUNTDOWN = 5;
/** Seconds from the leaving speed down to the ship's own at the exit; ours. */
export const EXIT_BRAKE = 1.0;
/** The brake starts this long before the exit's stars burst past; ours. */
export const BURST_LEAD = 0.2;
/** Seconds: how fast the exit's position error is taken out; ours. */
export const TRACK = 0.15;
/** Metres: a jump inside a system that would end this close to the ship is refused. */
export const ALREADY_THERE = 1000;
/** Metres beyond a station's radius where a jump to it ends. */
export const STATION_STANDOFF = 400;

export interface JumpScene {
  /** STG1's seconds: the enter stage (the ship accelerates to `speed` over it). */
  enterSeconds: number;
  /** STG3's seconds: the exit stage. */
  exitSeconds: number;
  /** STG2's speed reading: what the ship leaves at, m/s. */
  speed: number;
  /** STG2's fade reading: the white's rise and fall, seconds. */
  fade: number;
  /** STG2's limit reading: the longest wait for the destination, seconds. */
  limit: number;
  /** The enter streaks' brightest stretch ends (the white may come up). */
  enterPeak: number;
  /** The exit's stars burst past. */
  exitBurstAt: number;
  /** The exit's tunnel starts to dissolve (control returns). */
  exitClearAt: number;
}

/** Our own round numbers, for a pack converted before the scene or its timings were read. */
export const FALLBACK_SCENE: JumpScene = { enterSeconds: 2, exitSeconds: 5, speed: 800, fade: 0.5, limit: 30, enterPeak: 3, exitBurstAt: 3.5, exitClearAt: 4.5 };

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const nonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** The jump's scene, field by field: the pack's value when it has a usable one, else the fallback's. */
export function sceneOf(pack: SpacePack | null): JumpScene {
  const hs = pack?.hyperspace;
  const sc = hs?.scene;
  const t = hs?.effects?.timing;
  const f = FALLBACK_SCENE;
  return {
    enterSeconds: positive(sc?.enter?.seconds) ? sc.enter.seconds : f.enterSeconds,
    exitSeconds: positive(sc?.exit?.seconds) ? sc.exit.seconds : f.exitSeconds,
    speed: positive(sc?.transit?.speed) ? sc.transit.speed : f.speed,
    fade: nonNegative(sc?.transit?.fade) ? sc.transit.fade : f.fade,
    limit: positive(sc?.transit?.limit) ? sc.transit.limit : f.limit,
    enterPeak: nonNegative(t?.enterPeak) ? t.enterPeak : f.enterPeak,
    exitBurstAt: nonNegative(t?.exitBurstAt) ? t.exitBurstAt : f.exitBurstAt,
    exitClearAt: nonNegative(t?.exitClearAt) ? t.exitClearAt : f.exitClearAt,
  };
}

/** A client-frame position in the game's frame: X mirrored (never a negative zero). */
export function toGame(p: Vec3): Vec3 {
  return [p[0] === 0 ? 0 : -p[0], p[1], p[2]];
}

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** When the white comes up, seconds into the enter stage. */
export function veilUpAt(s: JumpScene): number {
  return s.enterPeak;
}
/** When the transit (the move) starts, seconds into the enter stage: the white is up by then. */
export function transitAt(s: JumpScene): number {
  return s.enterPeak + s.fade;
}
/** When the brake starts, seconds into the exit stage. */
export function brakeAt(s: JumpScene): number {
  return Math.max(0, s.exitBurstAt - BURST_LEAD);
}
/** When control returns, seconds into the exit stage: after the brake, and not before the tunnel dissolves. */
export function releaseAt(s: JumpScene): number {
  return Math.max(brakeAt(s) + EXIT_BRAKE, s.exitClearAt);
}
/** When the exit stage is over, seconds into it. */
export function exitEnd(s: JumpScene): number {
  return Math.max(s.exitSeconds, releaseAt(s));
}

/** The enter stage's speed `t` seconds in, from the ship's own `from` up to the leaving speed. */
export function enterSpeed(t: number, from: number, s: JumpScene): number {
  const k = clamp01(t / (s.enterSeconds > 0 ? s.enterSeconds : 1));
  return from + (s.speed - from) * k * k * k;
}

/** The exit's speed `u` seconds after the brake began, from the leaving speed down to the ship's own `to`. */
export function exitSpeed(u: number, to: number, s: JumpScene): number {
  const k = 1 - clamp01(u / EXIT_BRAKE);
  return to + (s.speed - to) * k * k;
}

/** How far the exit's speed carries the ship in the `u` seconds after the brake began (the integral of exitSpeed). */
export function exitTravelled(u: number, to: number, s: JumpScene): number {
  const t = Math.max(0, u);
  const k = 1 - clamp01(t / EXIT_BRAKE);
  return to * t + ((s.speed - to) * EXIT_BRAKE * (1 - k * k * k)) / 3;
}

/** How far the whole brake carries the ship. */
export function exitDistance(to: number, s: JumpScene): number {
  return exitTravelled(EXIT_BRAKE, to, s);
}

/** The cruise to command this frame so the hull stays on the braking curve, `done` metres being what it has covered: never below 0. */
export function trackedCruise(u: number, done: number, to: number, s: JumpScene): number {
  return Math.max(0, exitSpeed(u, to, s) + (exitTravelled(u, to, s) - done) / TRACK);
}

export interface ArrivalPose {
  start: Vec3;
  end: Vec3;
  forward: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** A landmark nearer than this to a point is not what the ship faces there. */
const FACE_MIN = 100;

/**
 * Where a jump ends and where the ship must appear so that braking brings it there. All inputs game frame.
 * - a station: `end` is radius + STATION_STANDOFF short of it on the line from `approach` (the ship's own
 *   position for a jump inside the system, the destination zone's arrival for one from another);
 *   straight along +Z from the station when `approach` is null or sits on it; facing the station;
 * - a point or a launch point: `end` is the point, facing the nearest landmark more than 100 m off,
 *   else the origin (when more than 100 m off), else +Z.
 * `start = end - forward * exitDistance(cruise, scene)`.
 */
export function arrivalPose(
  dest: { kind: 'point' | 'station' | 'launch'; at: Vec3; radius: number },
  landmarks: { at: Vec3; radius: number }[],
  approach: Vec3 | null,
  cruise: number,
  s: JumpScene,
): ArrivalPose {
  const at: Vec3 = [dest.at[0], dest.at[1], dest.at[2]];
  let end: Vec3;
  let forward: Vec3;
  if (dest.kind === 'station') {
    const off = (dest.radius || 0) + STATION_STANDOFF;
    const d = approach ? sub(at, approach) : null;
    const l = d ? len(d) : 0;
    if (!d || l < 1e-3) {
      end = [at[0], at[1], at[2] + off];
      forward = [0, 0, -1];
    } else {
      forward = scale(d, 1 / l);
      end = sub(at, scale(forward, off));
    }
  } else {
    end = at;
    let best: Vec3 | null = null;
    let bestDist = Infinity;
    for (const m of landmarks) {
      const dist = len(sub(m.at, end));
      if (dist > FACE_MIN && dist < bestDist) {
        bestDist = dist;
        best = m.at;
      }
    }
    if (best) forward = scale(sub(best, end), 1 / bestDist);
    else if (len(end) > FACE_MIN) forward = scale(end, -1 / len(end));
    else forward = [0, 0, 1];
  }
  const back = exitDistance(cruise, s);
  return { start: sub(end, scale(forward, back)), end, forward };
}

/**
 * The turn that points a ship's nose (+Z) along `forward`, with no roll: yaw = atan2(fx, fz),
 * pitch = -asin(fy), q = qYaw * qPitch, as [x, y, z, w].
 */
export function lookRotation(forward: Vec3): [number, number, number, number] {
  const l = len(forward) || 1;
  const fx = forward[0] / l;
  const fy = Math.max(-1, Math.min(1, forward[1] / l));
  const fz = forward[2] / l;
  const yaw = Math.atan2(fx, fz);
  const pitch = -Math.asin(fy);
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

/** A distance for the panel: '850 m', '12.3 km'. */
export function distanceText(metres: number): string {
  if (!Number.isFinite(metres)) return '';
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}
