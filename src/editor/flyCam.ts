// The world editor's free camera (DESIGN.md §2.2): an eye that flies, carrying the player's hidden body with it as the
// world's anchor, so the terrain, the placed tiers, the rooms, the living, the weather and the water all follow the camera
// with no code of their own. It implements the flight port `Player.update` hands its editor branch (`EditorFlight` in
// `src/player/player.ts`), which runs ahead of noclip's and in which nothing else of the body runs.
//
// **The look** is the orbit camera's own yaw and pitch, at the game's own sensitivity and invert, so the hand feels the
// same and leaving hands the orbit back a view that does not jump: `dir` is (sin yaw cos pitch, sin pitch, cos yaw cos
// pitch), pointing from the eye **back** over the shoulder as the orbit's does, and the eye looks down `-dir`.
//
// **The flight is the same path at every frame rate.** The velocity eases toward what the keys ask by
// `1 - exp(-dt / ease)`, and the place moves by that ease's own integral over the step (`easeStep`) rather than by the end
// velocity times the step, which is exact for a step over which the keys did not change: a node test flies 3 s at 20, 60
// and 144 frames a second and finds the three within a millimetre.
//
// Every number is `EDITOR_TUNE.cam`'s, read live. Nothing in a frame is made.
//
// Pure: no three, no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension,
// no enum, no namespace, no constructor parameter properties.

import { EDITOR_TUNE } from './editorTune.ts';

/** What the editor's key block asks of the flight this frame, written before the mutes take the keys it reads. */
export interface FlightAsk {
  /** Along the look (+1 forward), across it (+1 right) and up the world (+1 up). */
  fwd: number;
  side: number;
  up: number;
  /** Shift (fast) and Alt (slow) held. */
  fast: boolean;
  slow: boolean;
  /** Whether the mouse turns the eye this frame: Fly mode with the pointer locked and no hold key taking the mouse. */
  look: boolean;
}

/** Just enough of the game's input for the flight: the mouse's movement, spent as it is read. */
export interface FlightInput {
  mouseDX: number;
  mouseDY: number;
  locked: boolean;
}

/** A place the flight moves in place: the body's own `pos`. */
export interface FlightPlace {
  x: number;
  y: number;
  z: number;
}

/** What the camera's sensitivity and invert are, read live: the orbit camera's own fields. */
export interface FlightLookOf {
  sensitivity: number;
  invertY: boolean;
}

/**
 * One ease of a velocity component over `dt` seconds toward `want` with time constant `tau`, written into `out`: the
 * velocity at the step's end and the distance covered over it, both exact for a constant `want`. A `tau` of nought is
 * noclip's instant: the velocity is `want` at once and the distance `want * dt`.
 */
export function easeStep(v: number, want: number, dt: number, tau: number, out: { v: number; d: number }): { v: number; d: number } {
  if (!(tau > 0)) {
    out.v = want;
    out.d = want * dt;
    return out;
  }
  const k = Math.exp(-dt / tau);
  out.v = want + (v - want) * k;
  out.d = want * dt + (v - want) * tau * (1 - k);
  return out;
}

/** The speed a wheel's notches (or `=` and `-`) step to: times `wheelStep` a notch, held between `min` and `max`. */
export function stepSpeed(speed: number, notches: number, tune = EDITOR_TUNE.cam): number {
  const s = speed * Math.pow(tune.wheelStep, notches);
  return Math.min(tune.max, Math.max(tune.min, s));
}

/** The free camera. */
export class FlyCam {
  // Every field that holds a fraction starts as one and is set in the constructor: a field that starts whole boxes every
  // fraction written into it after.
  /** The look, the orbit camera's own angles. */
  yaw = Math.PI;
  pitch = 0.5;
  /** The flight's velocity, metres a second, eased toward what is asked. */
  vx = 0.5;
  vy = 0.5;
  vz = 0.5;
  /** Metres a second with nothing held (`EDITOR_TUNE.cam.speed` at entry, the wheel's after). */
  speed = 0.5;
  /** What the keys ask this frame (the editor's key block writes it). */
  readonly ask: FlightAsk = { fwd: 0, side: 0, up: 0, fast: false, slow: false, look: false };
  /** The camera's sensitivity and invert, read live. */
  lookOf: FlightLookOf = { sensitivity: 1, invertY: false };
  private readonly ease = { v: 0.5, d: 0.5 };

  constructor() {
    this.pitch = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.speed = EDITOR_TUNE.cam.speed;
  }

  /** The speed the eye is moving now, metres a second: what holds the living still past `livingAbove`. */
  get moving(): number {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
  }

  /** Take the look of a camera already in place (its world direction `dx, dy, dz`, where it looks), so nothing jumps. */
  lookAlong(dx: number, dy: number, dz: number): void {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 1e-9)) return;
    // The orbit's `dir` points back from the eye: the look negated.
    const bx = -dx / len;
    const by = -dy / len;
    const bz = -dz / len;
    this.yaw = Math.atan2(bx, bz);
    const lim = Math.PI / 2 - EDITOR_TUNE.cam.pitchMargin;
    this.pitch = Math.min(lim, Math.max(-lim, Math.asin(Math.min(1, Math.max(-1, by)))));
  }

  /** The look as a direction, into `out` (where the eye looks: `-dir`). */
  lookDir(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = -Math.sin(this.pitch);
    out.z = -Math.cos(this.yaw) * cp;
    return out;
  }

  /** Stop at once (an entry, a leave, a teleport). */
  stop(): void {
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
  }

  /**
   * One frame of flight: the look from the mouse when the key block says the mouse is the eye's, the velocity eased
   * toward what the keys ask, and `pos` moved by the ease's own integral. The flight port `Player.update` calls.
   */
  step(dt: number, input: FlightInput, pos: FlightPlace): void {
    const t = EDITOR_TUNE.cam;
    const a = this.ask;
    if (a.look && input.locked) {
      const k = 0.0025 * this.lookOf.sensitivity * t.look;
      this.yaw -= input.mouseDX * k;
      const lim = Math.PI / 2 - t.pitchMargin;
      this.pitch = Math.min(lim, Math.max(-lim, this.pitch + input.mouseDY * k * (this.lookOf.invertY ? -1 : 1)));
    }
    if (a.look) {
      input.mouseDX = 0;
      input.mouseDY = 0;
    }
    // The ask in the world: along the look (three axes, as noclip flies), across it on the level, and straight up.
    const cp = Math.cos(this.pitch);
    const fx = -Math.sin(this.yaw) * cp;
    const fy = -Math.sin(this.pitch);
    const fz = -Math.cos(this.yaw) * cp;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let wx = fx * a.fwd + rx * a.side;
    let wy = fy * a.fwd + a.up;
    let wz = fz * a.fwd + rz * a.side;
    const len = Math.sqrt(wx * wx + wy * wy + wz * wz);
    const speed = this.speed * (a.fast ? t.fast : 1) * (a.slow ? t.slow : 1);
    if (len > 1e-9) {
      const s = speed / len;
      wx *= s;
      wy *= s;
      wz *= s;
    } else {
      wx = 0;
      wy = 0;
      wz = 0;
    }
    const e = this.ease;
    easeStep(this.vx, wx, dt, t.ease, e);
    this.vx = e.v;
    pos.x += e.d;
    easeStep(this.vy, wy, dt, t.ease, e);
    this.vy = e.v;
    pos.y += e.d;
    easeStep(this.vz, wz, dt, t.ease, e);
    this.vz = e.v;
    pos.z += e.d;
  }
}
