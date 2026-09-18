// How fast a mobile walks and runs, and which clip its feet play at what rate, so they do not
// slide: the template's speeds held near the pack's own clip speeds, and a gait chosen by the
// ratio of what is wanted to what each clip was animated at. Also the two weights the animator
// sets by hand every frame. Pure, node-tested.
//
// Rule for this file (it is run by node with type stripping): relative imports only as
// `import type`, no enum, no namespace, no constructor parameter properties.
import type { Gait, Roles } from './types';

export interface GaitLimits {
  /** The slowest and fastest a clip is played against its own speed. */
  slow: number;
  fast: number;
  /** No mobile moves faster than this, metres a second. */
  maxSpeed: number;
  /** A clip more than this many times the template's speed is not believed (a few packs carry 25 to 55 m/s runs). */
  trust: number;
  /** Below this a mobile stands. */
  still: number;
}

export const GAIT_LIMITS: GaitLimits = { slow: 0.5, fast: 1.8, maxSpeed: 16, trust: 2.2, still: 0.05 };

/** The walk is held within these of its clip's speed, the run within the next two. */
const WALK_BAND: [number, number] = [0.8, 1.4];
const RUN_BAND: [number, number] = [0.8, 1.5];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The template's speed kept near a clip's: in the band when the clip is believable, as it is otherwise. */
function held(template: number, clip: number | null, band: [number, number], limits: GaitLimits): number {
  if (!(template > 0)) return clip && clip > 0 ? Math.min(clip, limits.maxSpeed) : 0;
  if (!clip || clip <= 0 || clip > limits.trust * template) return Math.min(template, limits.maxSpeed);
  return Math.min(clamp(template, band[0] * clip, band[1] * clip), limits.maxSpeed);
}

/** The clip speed of a role's clip, from the gait list it appears in. */
function speedOf(gaits: readonly Gait[], clip: string | null): number | null {
  if (!clip) return null;
  for (const g of gaits) if (g.clip === clip) return g.speed;
  return null;
}

/**
 * The walk and the run a mobile will move at, scaled to its size: the template's, held within
 * [0.8, 1.4] of the walk clip's speed and [0.8, 1.5] of the run clip's, capped at `maxSpeed`. A
 * clip over `trust` times the template's speed is not believed and the template's is used. A
 * pack with no gait at all gives zero for both: a static mobile turns and attacks but never moves.
 */
export function moveSpeeds(roles: Roles, scale: number, template: { run: number; walk: number }, limits: GaitLimits = GAIT_LIMITS): { walk: number; run: number } {
  const gaits = roles.gaits ?? [];
  if (!gaits.some((g) => g.speed > 0)) return { walk: 0, run: 0 };
  const s = scale > 0 ? scale : 1;
  const walkClip = speedOf(gaits, roles.walk);
  const runClip = speedOf(gaits, roles.run);
  const walk = held(template.walk, walkClip !== null ? walkClip * s : null, WALK_BAND, limits);
  let run = held(template.run, runClip !== null ? runClip * s : null, RUN_BAND, limits);
  if (run < walk) run = walk;
  return { walk, run };
}

/**
 * The clip to play for a wanted ground speed: the idle below `still`, else the gait whose scaled
 * speed is nearest in ratio, at `timeScale = clamp(wanted / (speed * scale), slow, fast)`. The
 * speed the body then moves at is what that clip shows, `timeScale * speed * scale`, so the feet
 * never slide by more than the clamp -- unless the clip itself is not believable (over `trust`
 * times what is wanted, or past `maxSpeed`), in which case the body goes at what was wanted.
 */
export interface GaitChoice {
  clip: string | null;
  timeScale: number;
  speed: number;
}

function choice(out: GaitChoice | undefined, clip: string | null, timeScale: number, speed: number): GaitChoice {
  if (!out) return { clip, timeScale, speed };
  out.clip = clip;
  out.timeScale = timeScale;
  out.speed = speed;
  return out;
}

export function chooseGait(gaits: readonly Gait[], idle: string | null, wanted: number, scale: number, limits: GaitLimits = GAIT_LIMITS, out?: GaitChoice): GaitChoice {
  if (!(wanted > limits.still)) return choice(out, idle, 1, 0);
  const s = scale > 0 ? scale : 1;
  let best: Gait | null = null;
  let bestRatio = Infinity;
  for (const g of gaits) {
    if (!(g.speed > 0)) continue;
    const r = Math.abs(Math.log(wanted / (g.speed * s)));
    if (r < bestRatio) {
      bestRatio = r;
      best = g;
    }
  }
  if (!best) {
    // Moving clips with no measured speed: play the first at its own rate and move as wanted.
    const first = gaits[0];
    return choice(out, first ? first.clip : idle, 1, Math.min(wanted, limits.maxSpeed));
  }
  const clipSpeed = best.speed * s;
  const timeScale = clamp(wanted / clipSpeed, limits.slow, limits.fast);
  const shown = timeScale * clipSpeed;
  const speed = shown <= limits.maxSpeed && shown <= wanted * limits.trust ? shown : Math.min(wanted, limits.maxSpeed);
  return choice(out, best.clip, timeScale, speed);
}

/** One frame of a mobile's speed: the ramp's new value, and the gait that shows it (whose `speed` the body moves at). */
export interface GaitStep extends GaitChoice {
  ramp: number;
}

/**
 * One frame of the speed-up and slow-down. The ramp is the template's acceleration toward what is
 * wanted (and twice it down), kept in its own value; the gait is chosen from the ramp, and the
 * body moves at what that gait's feet show. The two must never share one number: `chooseGait`
 * caps a clip at `fast` times its speed, and a ramp overwritten with that cap every frame never
 * reaches the point where the next clip is nearer, so a two-gait pack could never break out of its
 * walk. Below `still` the ramp stands the body (speed 0), so a mobile told to stand does stop.
 */
export function stepGait(ramp: number, wanted: number, accel: number, dt: number, gaits: readonly Gait[], idle: string | null, scale: number, limits: GaitLimits = GAIT_LIMITS, out?: GaitStep): GaitStep {
  const next = wanted > ramp ? Math.min(wanted, ramp + accel * dt) : Math.max(wanted, ramp - accel * 2 * dt);
  const o = out ?? { clip: null, timeScale: 1, speed: 0, ramp: 0 };
  chooseGait(gaits, idle, next, scale, limits, o);
  o.ramp = next;
  if (!(o.clip && o.speed > 0)) o.speed = next > limits.still ? next : 0;
  return o;
}

/**
 * A one-shot's weight at `time` into it: up from 0 over `fadeIn`, held, and (unless `hold`) back
 * to 0 over the last `fadeOut`. A zero fade is a step. The loop under it takes `1 - weight`.
 */
export function oneShotWeight(time: number, duration: number, fadeIn: number, fadeOut: number, hold: boolean): number {
  if (!(duration > 0)) return hold ? 1 : time > 0 ? 0 : 1;
  const up = fadeIn > 0 ? clamp(time / fadeIn, 0, 1) : 1;
  let down = 1;
  if (!hold) down = fadeOut > 0 ? clamp((duration - time) / fadeOut, 0, 1) : time >= duration ? 0 : 1;
  return Math.min(up, down);
}

/** A cross-fade's progress: 0 to 1 over `over` seconds, a step when `over` is 0. */
export function blendWeight(t: number, over: number): number {
  if (!(over > 0)) return t >= 0 ? 1 : 0;
  return clamp(t / over, 0, 1);
}

/** How long a one-shot's fades may be: a quarter of the clip each, and none at all for a clip under four frames. */
export function clampFades(duration: number, fadeIn: number, fadeOut: number, fps = 30): { fadeIn: number; fadeOut: number } {
  if (duration < 4 / fps) return { fadeIn: 0, fadeOut: 0 };
  return { fadeIn: Math.min(fadeIn, 0.25 * duration), fadeOut: Math.min(fadeOut, 0.25 * duration) };
}
