// The Force's knock travelling with its wave (the volumetrics pass's third wave; the owner's answer of 2026-10-24 to the
// design's Q16: "It would make it something someone could dodge or prepare for. Let's make it both, and we can dial the
// speed of them"). A push, a pull or a repulse no longer lands on every body at the press: it begins a wave here, and a
// body is knocked when the wave's front reaches it -- the very front the moving air draws (`frontRadiusIn`, the same
// times, starts and eases, over the one speed `FORCE_WAVE.speed`), so the dust's wave and the knock arrive together.
// One who steps out of the cone, or outruns a push, before the front arrives is missed.
//
// **Only when, never how hard**: the knock's own arithmetic (how far, how hard, the damage) is the power's as it was,
// worked out at the moment of arrival from where the body stands then (`jedi.ts`). With `FORCE_WAVE.travels` off the
// power is the instant knock of before, its code untouched.
//
// **Gameplay, never graphics**: nothing here reads a graphics setting; the wave runs with the volumetrics master, the
// dust and Effects off alike (only nothing is drawn then).
//
// Pure: no three, nothing of the page. The jedi kit steps it every frame on the simulation's own `dt`, so it stands still
// behind a panel as everything else simulated does.
import { FRONT_KIND, frontRadiusIn, newFrontAt } from '../world/volumetrics/airMath.ts';

/** Waves alive at once (a press makes one; the powers' own costs keep it to a few). */
export const WAVE_MOST = 8;

/**
 * How far behind the front a body may stand and still be met this step, metres [ours]: what a body running across the
 * front in one step can cover, so one that meets it moving is not missed, while one that steps in behind a front long
 * gone by is.
 */
export const WAVE_BAND_SLACK = 1.5;

/** One wave: its kind (`FRONT_KIND`), where it began, the way it was aimed, its reach, its age and this step's band. */
export interface ForceWave {
  kind: number;
  /** The origin bodies and vehicles are measured from (the player's `pos`, as the instant knock measures them). */
  ox: number;
  oy: number;
  oz: number;
  /** The origin in the world's frame (the player's `worldPos`): the loose props are measured from it, as before. */
  wx: number;
  wy: number;
  wz: number;
  /** The aim at the press (the camera's forward, unit, with its height): the cone a push and a pull keep to. */
  ax: number;
  ay: number;
  az: number;
  reach: number;
  age: number;
  /** The front's radius at the start and the end of this step, metres from the origin. */
  r0: number;
  r1: number;
  /** This is the wave's last step: a pull's front closes to nought, so whoever it never crossed inside its stop is reached. */
  closing: boolean;
  /** What it has knocked already: each body, vehicle and prop once. */
  readonly struck: Set<object>;
  /** The distance `reaches` last measured, metres. */
  d: number;
}

export class ForceWaves {
  readonly waves: ForceWave[] = [];
  /** Waves begun, and dropped for a full list, since the console last read them. */
  begun = 0;
  dropped = 0;
  private readonly fa = newFrontAt();

  /** A wave begun at the press; null (and counted) with the list full. */
  begin(kind: number, ox: number, oy: number, oz: number, wx: number, wy: number, wz: number, ax: number, ay: number, az: number, reach: number): ForceWave | null {
    if (this.waves.length >= WAVE_MOST) {
      this.dropped++;
      return null;
    }
    const w: ForceWave = { kind, ox, oy, oz, wx, wy, wz, ax, ay, az, reach, age: 0, r0: 0, r1: 0, closing: false, struck: new Set(), d: 0 };
    this.waves.push(w);
    this.begun++;
    return w;
  }

  /**
   * Every wave one step of `dt` seconds on: its age and the band its front crosses this step, `r0` to `r1` by the air's
   * own front (`frontRadiusIn`, over `FORCE_WAVE.speed`). The step that takes a wave past its time is its last
   * (`closing`): an outward front stands at its reach, and a pull's front closes to nought.
   */
  step(dt: number): void {
    const fa = this.fa;
    const step = dt > 0 && Number.isFinite(dt) ? dt : 0;
    for (const w of this.waves) {
      fa.kind = w.kind;
      fa.reach = w.reach;
      fa.age = w.age;
      frontRadiusIn(fa);
      // A wave's first step starts at the press itself: an outward one from the feet (a body nearer than where its front
      // begins is met at once, as the instant knock met it), a pull from as far as it reaches.
      const first = w.age === 0;
      w.r0 = first ? (w.kind === FRONT_KIND.pull ? Infinity : 0) : fa.r;
      w.age += step;
      fa.age = w.age;
      frontRadiusIn(fa);
      w.r1 = fa.r;
      // Its share of the way is held at one once its time (over the wave's speed) has passed.
      w.closing = fa.s >= 1;
      if (w.closing && w.kind === FRONT_KIND.pull) w.r1 = 0;
    }
  }

  /**
   * Whether `w`'s front reaches a point this step, measured from `(fx, fy, fz)` (the wave's own origin for the frame
   * the point is in): within `range` metres, inside the cone (`cone`: a push's and a pull's, the instant knock's own rule
   * -- near at hand anything goes, further off it must be ahead), and in the band the front crosses this step -- an
   * outward front's from where it stood to where it stands, a pull's from where it stood in to where it stands -- give or
   * take `WAVE_BAND_SLACK` behind it, so a body that steps in behind a front gone by is not knocked by it. The distance
   * is left in `w.d`.
   */
  reaches(w: ForceWave, px: number, py: number, pz: number, fx: number, fy: number, fz: number, range: number, cone: boolean): boolean {
    const dx = px - fx;
    const dy = py - fy;
    const dz = pz - fz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    w.d = d;
    if (d > range) return false;
    if (cone && d > 3 && (dx * w.ax + dy * w.ay + dz * w.az) / (d > 1e-9 ? d : 1e-9) < 0.35) return false;
    return w.kind === FRONT_KIND.pull ? d >= w.r1 && d <= w.r0 + WAVE_BAND_SLACK : d <= w.r1 && d >= w.r0 - WAVE_BAND_SLACK;
  }

  /** The waves whose last step this was, let go. */
  sweep(): void {
    let n = 0;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      if (w.closing) continue;
      this.waves[n++] = w;
    }
    this.waves.length = n;
  }

  /** Every wave let go (a new world, the kit going). */
  clear(): void {
    this.waves.length = 0;
  }
}
