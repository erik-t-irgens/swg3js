// Climbing II, phase 3: the bar's clip (the owner's `Run And Swing.fbx`, `run_and_swing`: a run, a leap, the hands on the bar,
// the swing, the release, the flight and the landing in one take) and what the game reads of it.
//
// The owner's frames (DESIGN-CLIMB2.md's clip table, at 30 a second): 17 off the ground (0.57 s); 21-24 reaching for the bar
// (0.70-0.80); 25 the hands on it (0.83); 25-51 the swing (0.83-1.70); 52 the release, the body near level (1.73); 52-62 in the
// air (1.73-2.07); 63 the landing (2.10). Measured on the human male (climbBars.test.ts measures them again from the pack): the
// hands come to rest on the bar at frame 25 and leave it at 52, the clip's whole swing is one swing forward, the hips from 41
// degrees behind the bar (frame 25) through straight down (1.258 s) to 84 degrees ahead (frame 51), 1.03 m under the hands
// straight down. The import's report agrees with his table: 74 frames, 2.417 s, 5.84 m of travel.
//
// What the swing plays of it is the pendulum's own angle (src/player/barSwing.ts): each angle the time in the swing window
// where the clip's hips stand at that angle about its hands (`BarSwingTable`, measured off the rig's own clip once, at its first
// use, since every skeleton's fit of the clip is its own), played forward as the swing goes forward and backward as it comes
// back; a still hang holds the frame where the body hangs straight down.
//
// Pure: numbers and names only.

/** The bar's clip, the pack's id. */
export const BAR_CLIP = 'run_and_swing';

/** Every clip the bars ask the pack for (`PackIo.also`, beside the ledges'). */
export const BAR_IDS: readonly string[] = [BAR_CLIP];

/** Each one's rig name (the pack's `mx_` prefix), made once (nothing names a clip anew on a frame). */
export const BAR_CLIP_NAMES: Readonly<Record<string, string>> = Object.fromEntries(BAR_IDS.map((id) => [id, `mx_${id}`]));

/** The owner's seconds (his frames at 30 a second), each held to the clip's own measure by climbBars.test.ts. */
export const BAR_TIMES = {
  /** The feet leave the ground (frame 17). */
  off: 17 / 30,
  /** The arms reach for the bar (frame 21). */
  reach: 21 / 30,
  /** The hands on the bar (frame 25): the swing window's start. */
  touch: 25 / 30,
  /** The swing window's end (frame 51). */
  swingEnd: 51 / 30,
  /** The release, the body near level (frame 52). */
  release: 52 / 30,
  /** The flight's end (frame 62). */
  flightEnd: 62 / 30,
  /** The landing (frame 63). */
  land: 63 / 30,
} as const;

/**
 * Measured on the human male (the pack's clip fitted to him, climbBars.test.ts measures it again): the hips' distance under the
 * hands where the body hangs straight down (what the swing's pendulum hangs at, scaled by the figure), the time it does, and the
 * hips' angle about the hands at the swing window's two ends (degrees, ahead of the bar positive).
 */
export const BAR_FACTS = { radius: 1.026, still: 1.258, from: -40.6, to: 83.8 } as const;

/** The swing table's step between two samples, seconds (four to a frame of the clip's own 30). */
export const BAR_TABLE_STEP = 1 / 120;

/**
 * Climbing II, phase 3 (maker B, `climb.barFlight` 'fly'): the bar's clip's twin, the same tracks under a name of their own
 * (`CharacterRig.twinClip`, made once a rig), which the flight off a bar plays: a clip cannot be crossfaded into itself, and
 * the flight's pose (the release on) is crossfaded from the swing's and back into the reach's at a catch. Made once.
 */
export const BAR_FLIGHT_NAME = `${BAR_CLIP_NAMES[BAR_CLIP]}~fly`;

/** The flight table's step between two samples, seconds (two to a frame of the clip's own 30). */
export const BAR_FLIGHT_STEP = 1 / 60;
/** How far into the clip the flight table runs, seconds: past the landing to the clip's last frames (its own end is 2.417). */
const BAR_FLIGHT_TO = 2.4;

let FLY_TIMES: Float64Array | null = null;
let FLY_SAMPLES: Float64Array | null = null;
const FLY_JOINTS: readonly string[] = [''];

/**
 * The flight's part of the bar's clip measured off a rig (its own fit, once, as the swing's table): where the clip's hips stand
 * in the rig root's frame from the release (frame 52) to its last frames, so the flight off a bar draws the clip's hips where
 * the flying body's middle is (src/player/barSwing.ts's `placeFigure`). Null where the rig has not the clip (yet).
 */
export function measureBarFlight(rig: BarRig): BarFlightTable | null {
  if (!FLY_TIMES) {
    const n = Math.round((BAR_FLIGHT_TO - BAR_TIMES.release) / BAR_FLIGHT_STEP) + 1;
    FLY_TIMES = new Float64Array(n);
    for (let i = 0; i < n; i++) FLY_TIMES[i] = Math.min(BAR_FLIGHT_TO, BAR_TIMES.release + i * BAR_FLIGHT_STEP);
  }
  if (!FLY_SAMPLES) FLY_SAMPLES = new Float64Array(FLY_TIMES.length * 3);
  if (!rig.sampleJoints(BAR_CLIP_NAMES[BAR_CLIP], FLY_JOINTS, FLY_TIMES, FLY_SAMPLES)) return null;
  return new BarFlightTable(FLY_SAMPLES);
}

/** The flight's hips in the rig root's frame, between two samples (`hipsAt` writes `x`, `y`, `z`: no number crosses a call). */
export class BarFlightTable {
  readonly n: number;
  readonly hx: Float64Array;
  readonly hy: Float64Array;
  readonly hz: Float64Array;
  x = 0.5;
  y = 0.5;
  z = 0.5;
  constructor(samples: Float64Array) {
    const n = Math.floor(samples.length / 3);
    this.n = n;
    this.hx = new Float64Array(n);
    this.hy = new Float64Array(n);
    this.hz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.hx[i] = samples[i * 3];
      this.hy[i] = samples[i * 3 + 1];
      this.hz[i] = samples[i * 3 + 2];
    }
    this.x = 0;
    this.y = 0;
    this.z = 0;
  }

  /** The hips at `t` seconds into the clip (held to the table's span) into `x`, `y`, `z`. */
  hipsAt(t: number): void {
    let f = (t - BAR_TIMES.release) / BAR_FLIGHT_STEP;
    if (!(f > 0)) f = 0;
    if (f > this.n - 1) f = this.n - 1;
    const i = Math.min(this.n - 2, Math.floor(f));
    const u = f - i;
    this.x = this.hx[i] + (this.hx[i + 1] - this.hx[i]) * u;
    this.y = this.hy[i] + (this.hy[i + 1] - this.hy[i]) * u;
    this.z = this.hz[i] + (this.hz[i + 1] - this.hz[i]) * u;
  }
}

/** The joints the table is measured off: the skeleton's root (the hips), and each hand's wrist and index knuckle (its grip between them). */
export const BAR_JOINTS: readonly string[] = ['', 'lWrist', 'lIndex01', 'rWrist', 'rIndex01'];

/** What a rig answers the table's samples from (the rig's `sampleJoints`: src/player/rig.ts). */
export interface BarRig {
  sampleJoints(clip: string, joints: readonly string[], times: ArrayLike<number>, out: Float64Array): boolean;
}

let TIMES: Float64Array | null = null;
let SAMPLES: Float64Array | null = null;

/**
 * The bar's clip measured off a rig (its own fit of the clip: every skeleton's is its own), once, at the first frame on a bar:
 * null where the rig has not the clip (yet; asked again the next frame, which makes nothing: the samples' arrays are kept).
 */
export function measureBarTable(rig: BarRig): BarSwingTable | null {
  if (!TIMES) TIMES = BarSwingTable.times();
  if (!SAMPLES) SAMPLES = new Float64Array(TIMES.length * BAR_JOINTS.length * 3);
  if (!rig.sampleJoints(BAR_CLIP_NAMES[BAR_CLIP], BAR_JOINTS, TIMES, SAMPLES)) return null;
  return BarSwingTable.build(SAMPLES);
}

/** A pose of the table at a time: the anchor (where the bar stands in the clip's frame) and the hips' angle and distance about it. */
export class BarPose {
  ax = 0.5;
  ay = 0.5;
  az = 0.5;
  /** The hips' angle about the anchor, radians: nought straight down, positive ahead (+z). */
  angle = 0.5;
  radius = 0.5;
  constructor() {
    this.ax = 0;
    this.ay = 0;
    this.az = 0;
    this.angle = 0;
    this.radius = 0;
  }
}

/**
 * The swing's clip measured off a rig (`build` from the joints' samples at `times`): from the reach to the swing window's end,
 * each sample's anchor (the hands' grip on the bar: from the touch on the live grip, so the drawn hands stay on the bar; before
 * it the touch's grip carried back along the clip's own drift through the window, where the bar stands in the fitted clip's
 * frame while the hands come up to it) and the hips' angle and distance about it; and the angle's inverse over the swing window
 * (the angle made never to fall, so the inverse is one time an angle).
 */
export class BarSwingTable {
  readonly t0: number;
  readonly n: number;
  /** The first sample of the swing window (the touch) and its last. */
  readonly w0: number;
  readonly w1: number;
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly az: Float64Array;
  readonly ang: Float64Array;
  readonly rad: Float64Array;
  /** The window's angle made never to fall (each sample the largest so far), for the inverse. */
  readonly mono: Float64Array;
  /** The window's ends' angles, and the time the hips hang straight down (NaN where the window never passes it). */
  from: number;
  to: number;
  still: number;
  constructor(n: number, t0: number, w0: number, w1: number) {
    this.n = n;
    this.t0 = t0;
    this.w0 = w0;
    this.w1 = w1;
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.az = new Float64Array(n);
    this.ang = new Float64Array(n);
    this.rad = new Float64Array(n);
    this.mono = new Float64Array(n);
    this.from = 0;
    this.to = 0;
    this.still = Number.NaN;
  }

  /** The table's sample times, from the reach to the swing window's end (what a rig is asked to sample). */
  static times(): Float64Array {
    const t0 = BAR_TIMES.reach;
    const n = Math.round((BAR_TIMES.swingEnd - t0) / BAR_TABLE_STEP) + 1;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.min(BAR_TIMES.swingEnd, t0 + i * BAR_TABLE_STEP);
    return out;
  }

  /**
   * The table from the joints' samples (`BAR_JOINTS` at `times()`, three numbers a joint a time, the rig root's own frame: the
   * rig's `sampleJoints`). Null where the samples do not make a swing (no window found).
   */
  static build(samples: Float64Array): BarSwingTable | null {
    const times = BarSwingTable.times();
    const n = times.length;
    const nj = BAR_JOINTS.length;
    if (samples.length < n * nj * 3) return null;
    const w0 = Math.round((BAR_TIMES.touch - BAR_TIMES.reach) / BAR_TABLE_STEP);
    const w1 = n - 1;
    if (w0 <= 0 || w0 >= w1) return null;
    const T = new BarSwingTable(n, times[0], w0, w1);
    const at = (i: number, j: number, k: number) => samples[(i * nj + j) * 3 + k];
    const grip = (i: number, k: number) => (at(i, 1, k) + at(i, 2, k) + at(i, 3, k) + at(i, 4, k)) / 4;
    // The drift of the bar in the fitted clip's frame through the window (the level travel the pack strips, as a ramp).
    const span = times[w1] - times[w0];
    const dx = (grip(w1, 0) - grip(w0, 0)) / span;
    const dz = (grip(w1, 2) - grip(w0, 2)) / span;
    for (let i = 0; i < n; i++) {
      if (i >= w0) {
        T.ax[i] = grip(i, 0);
        T.ay[i] = grip(i, 1);
        T.az[i] = grip(i, 2);
      } else {
        const back = times[w0] - times[i];
        T.ax[i] = grip(w0, 0) - dx * back;
        T.ay[i] = grip(w0, 1);
        T.az[i] = grip(w0, 2) - dz * back;
      }
      const hy = at(i, 0, 1) - T.ay[i];
      const hz = at(i, 0, 2) - T.az[i];
      T.ang[i] = Math.atan2(hz, -hy);
      T.rad[i] = Math.sqrt(hy * hy + hz * hz);
    }
    let m = -Infinity;
    let still = Number.NaN;
    for (let i = w0; i <= w1; i++) {
      m = Math.max(m, T.ang[i]);
      T.mono[i] = m;
      if (still !== still && i > w0 && T.ang[i - 1] < 0 && T.ang[i] >= 0) {
        const u = -T.ang[i - 1] / (T.ang[i] - T.ang[i - 1]);
        still = times[i - 1] + u * (times[i] - times[i - 1]);
      }
    }
    if (!(T.mono[w1] > T.mono[w0])) return null;
    T.from = T.mono[w0];
    T.to = T.mono[w1];
    T.still = still;
    return T;
  }

  /** The time in the swing window where the clip's hips stand at `angle` (radians), the window's ends past its own. */
  timeAt(angle: number): number {
    const w0 = this.w0;
    const w1 = this.w1;
    const M = this.mono;
    if (!(angle > M[w0])) return this.t0 + w0 * BAR_TABLE_STEP;
    if (angle >= M[w1]) return this.t0 + w1 * BAR_TABLE_STEP;
    let lo = w0;
    let hi = w1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (M[mid] <= angle) lo = mid;
      else hi = mid;
    }
    const d = M[hi] - M[lo];
    const u = d > 1e-12 ? (angle - M[lo]) / d : 0;
    return this.t0 + (lo + u) * BAR_TABLE_STEP;
  }

  /** The table at `t` (seconds into the clip, held to the table's own span) into `out`, between its two samples. */
  at(t: number, out: BarPose): void {
    let f = (t - this.t0) / BAR_TABLE_STEP;
    if (!(f > 0)) f = 0;
    if (f > this.n - 1) f = this.n - 1;
    const i = Math.min(this.n - 2, Math.floor(f));
    const u = f - i;
    out.ax = this.ax[i] + (this.ax[i + 1] - this.ax[i]) * u;
    out.ay = this.ay[i] + (this.ay[i + 1] - this.ay[i]) * u;
    out.az = this.az[i] + (this.az[i + 1] - this.az[i]) * u;
    out.angle = this.ang[i] + (this.ang[i + 1] - this.ang[i]) * u;
    out.radius = this.rad[i] + (this.rad[i + 1] - this.rad[i]) * u;
  }
}
